#include "services/scheduler.h"
#include "services/command_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "hal/hardware_registry.h"
#include "services/topology_capability.h"
#include "services/event_mgr.h"
#include "services/safety_monitor.h"
#include "storage/storage_mgr.h"
#include "hal/actuator_hal.h"
#include "cJSON.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>

static const char *TAG = "SCHEDULER";

#define MAX_COMPILED_SCHEDULES 16
#define MAX_RUNTIME_COMPONENTS 16
#define MAX_RUNTIME_RESOURCES 16
#define MAX_COMPILED_JSON 12288
#define NVS_NAMESPACE "agrotech"
#define NVS_KEY_COMPILED "compiled_sched"
#define NVS_KEY_MARKERS "sched_marks"
#define SCHEDULER_TICK_MS 1000U
#define CLOCK_VALID_YEAR 120

typedef enum {
    MARKER_EMPTY = 0,
    MARKER_PENDING,
    MARKER_RUNNING,
    MARKER_COMPLETE,
    MARKER_SKIPPED,
    MARKER_RECOVERY_HOLD
} marker_state_t;

typedef struct {
    uint8_t valid;
    uint8_t state;
    uint16_t reserved;
    char compiled_id[72];
    uint32_t configuration_version;
    int64_t last_occurrence_timestamp;
    int64_t last_execution_timestamp;
    int64_t pending_occurrence_timestamp;
    char command_id[40];
} scheduler_marker_t;

typedef struct {
    char resource_id[40];
    bool shared;
} resource_claim_t;

typedef struct {
    bool valid;
    char resource_id[40];
    char exclusive_owner[72];
    uint16_t shared_count;
} scheduler_resource_lock_t;

typedef struct {
    bool valid;
    char compiled_id[72];
    char schedule_id[40];
    char owner_id[40];
    char complex_id[40];
    char gh_id[40];
    char action[24];
    uint32_t priority;
    time_t start_timestamp;
    time_t end_timestamp;
    schedule_type_t type;
    uint8_t hour;
    uint8_t minute;
    uint8_t days_of_week;
    uint32_t interval_min;
    int64_t once_timestamp;
    int32_t duration_sec;
    int32_t raw_water_ml;
    char timezone[64];
    char missed_policy[8];
    uint32_t recovery_window_sec;
    bool fallback_enabled;
    char fallback_schedule_id[40];
    char fertigation_payload_json[6144];
    char component_ids[MAX_RUNTIME_COMPONENTS][40];
    size_t component_count;
    resource_claim_t resources[MAX_RUNTIME_RESOURCES];
    size_t resource_count;
    bool running;
    bool pending;
    int64_t pending_occurrence_timestamp;
    int64_t last_occurrence_timestamp;
    int64_t last_execution_timestamp;
    marker_state_t marker_state;
    char current_command_id[40];
} runtime_schedule_t;

static runtime_schedule_t s_runtime[MAX_COMPILED_SCHEDULES];
static size_t s_runtime_count = 0;
static scheduler_marker_t s_markers[MAX_COMPILED_SCHEDULES];
static scheduler_resource_lock_t s_resource_locks[MAX_RUNTIME_RESOURCES];
static SemaphoreHandle_t s_mutex = NULL;
static bool s_initialized = false;

static void copy_string(char *dst, size_t dst_size, const char *src)
{
    if (!dst || dst_size == 0) return;
    dst[0] = '\0';
    if (!src) return;
    strncpy(dst, src, dst_size - 1);
    dst[dst_size - 1] = '\0';
}

static uint32_t stable_hash(const char *text)
{
    uint32_t h = 2166136261u;
    if (!text) return h;
    while (*text) {
        h ^= (uint8_t)*text++;
        h *= 16777619u;
    }
    return h;
}


static bool local_clock_valid(time_t now)
{
    struct tm tm_now;
    if (!localtime_r(&now, &tm_now)) return false;
    return tm_now.tm_year >= CLOCK_VALID_YEAR;
}

static void apply_timezone_from_active_config(void)
{
    char *cfg_buf = calloc(1, 8192);
    if (!cfg_buf) return;
    size_t len = 0;
    if (storage_mgr_load_config(cfg_buf, 8192, &len) == ESP_OK && len > 0) {
        cJSON *cfg = cJSON_ParseWithLength(cfg_buf, len);
        if (cfg) {
            cJSON *tz = cJSON_GetObjectItem(cfg, "timezone");
            if (tz && cJSON_IsString(tz) && tz->valuestring[0]) {
                (void)setenv("TZ", tz->valuestring, 1);
                tzset();
            }
            cJSON_Delete(cfg);
        }
    }
    free(cfg_buf);
}

static const char *json_string(cJSON *obj, const char *key)
{
    cJSON *item = obj ? cJSON_GetObjectItem(obj, key) : NULL;
    return item && cJSON_IsString(item) ? item->valuestring : NULL;
}

static int64_t json_i64(cJSON *obj, const char *key, int64_t fallback)
{
    cJSON *item = obj ? cJSON_GetObjectItem(obj, key) : NULL;
    return item && cJSON_IsNumber(item) ? (int64_t)item->valuedouble : fallback;
}

static uint32_t json_u32(cJSON *obj, const char *key, uint32_t fallback)
{
    int64_t v = json_i64(obj, key, (int64_t)fallback);
    return (v >= 0 && v <= UINT32_MAX) ? (uint32_t)v : fallback;
}

/* Compiled Schedule Format v1 timestamps are Unix epoch milliseconds.
 * ESP32 scheduler clock/time_t operates in Unix epoch seconds. Normalize at the
 * boundary so recurrence comparisons and duration calculations use one unit. */
static int64_t normalize_epoch_seconds(int64_t timestamp)
{
    if (timestamp >= 100000000000LL) return timestamp / 1000;
    return timestamp;
}

static bool json_bool(cJSON *obj, const char *key, bool fallback)
{
    cJSON *item = obj ? cJSON_GetObjectItem(obj, key) : NULL;
    return item ? cJSON_IsTrue(item) : fallback;
}

static bool resource_is_operational(const char *resource_id)
{
    if (!resource_id || !resource_id[0]) return false;
    const size_t count = hardware_registry_get_count();
    for (size_t i = 0; i < count; ++i) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) == ESP_OK &&
            info.resource_id[0] && strcmp(info.resource_id, resource_id) == 0 &&
            (info.lifecycle_state == HW_LIFECYCLE_COMMISSIONED || info.lifecycle_state == HW_LIFECYCLE_ENABLED)) {
            return true;
        }
    }
    return false;
}

static bool parse_runtime_schedule(cJSON *item, runtime_schedule_t *out)
{
    if (!item || !out || !cJSON_IsObject(item)) return false;
    memset(out, 0, sizeof(*out));

    const char *status = json_string(item, "status");
    const char *activation = json_string(item, "activationState");
    const char *compiled_id = json_string(item, "compiledId");
    const char *schedule_id = json_string(item, "scheduleId");
    const char *complex_id = json_string(item, "complexId");
    const char *action = json_string(item, "action");
    const char *owner_id = json_string(item, "ownerId");
    if (!status || strcmp(status, "ACTIVE") != 0 ||
        !activation || strcmp(activation, "ACTIVE") != 0 ||
        !compiled_id || !compiled_id[0] || !schedule_id || !schedule_id[0] ||
        !complex_id || !complex_id[0] || !action || !action[0]) return false;

    const system_storage_state_t *storage = storage_mgr_get_state();
    if (!storage || strcmp(complex_id, storage->complex_id) != 0) return false;

    copy_string(out->compiled_id, sizeof(out->compiled_id), compiled_id);
    copy_string(out->schedule_id, sizeof(out->schedule_id), schedule_id);
    copy_string(out->owner_id, sizeof(out->owner_id), owner_id ? owner_id : schedule_id);
    copy_string(out->complex_id, sizeof(out->complex_id), complex_id);
    copy_string(out->gh_id, sizeof(out->gh_id), json_string(item, "ghId"));
    copy_string(out->action, sizeof(out->action), action);
    copy_string(out->missed_policy, sizeof(out->missed_policy), json_string(item, "missedRunPolicy") ? json_string(item, "missedRunPolicy") : "SKIP");
    out->recovery_window_sec = json_u32(item, "recoveryWindowSec", 7200);
    if (out->recovery_window_sec == 0) out->recovery_window_sec = 7200;
    copy_string(out->timezone, sizeof(out->timezone), json_string(item, "timezone"));
    out->priority = json_u32(item, "priority", 100);
    const int64_t raw_start_timestamp = json_i64(item, "startTimestamp", 0);
    const int64_t raw_end_timestamp = json_i64(item, "endTimestamp", 0);
    const int64_t normalized_start = normalize_epoch_seconds(raw_start_timestamp);
    const int64_t normalized_end = normalize_epoch_seconds(raw_end_timestamp);
    out->start_timestamp = (time_t)normalized_start;
    out->end_timestamp = (time_t)normalized_end;
    const int64_t duration_seconds = normalized_end - normalized_start;
    out->duration_sec = duration_seconds > 0 && duration_seconds <= INT32_MAX ? (int32_t)duration_seconds : 60;
    out->fallback_enabled = false;
    cJSON *fallback = cJSON_GetObjectItem(item, "fallback");
    if (fallback && cJSON_IsObject(fallback)) {
        out->fallback_enabled = json_bool(fallback, "enabled", false);
        copy_string(out->fallback_schedule_id, sizeof(out->fallback_schedule_id), json_string(fallback, "scheduleId"));
    }

    cJSON *trigger = cJSON_GetObjectItem(item, "trigger");
    if (!trigger || !cJSON_IsObject(trigger)) {
        trigger = cJSON_GetObjectItem(item, "recurrence");
    }
    const char *trigger_type = json_string(trigger, "type");
    if (!trigger_type) return false;
    if (strcmp(trigger_type, "DAILY") == 0) {
        out->type = SCHED_TYPE_DAILY;
        out->hour = (uint8_t)json_u32(trigger, "hour", 0);
        out->minute = (uint8_t)json_u32(trigger, "minute", 0);
        out->days_of_week = (uint8_t)json_u32(trigger, "daysOfWeek", 0);
        if (out->hour > 23 || out->minute > 59 || out->days_of_week == 0 || out->days_of_week > 127) return false;
    } else if (strcmp(trigger_type, "INTERVAL") == 0) {
        out->type = SCHED_TYPE_INTERVAL;
        out->interval_min = json_u32(trigger, "intervalMin", 0);
        if (out->interval_min == 0) return false;
    } else if (strcmp(trigger_type, "ONCE") == 0) {
        out->type = SCHED_TYPE_ONCE;
        out->once_timestamp = normalize_epoch_seconds(json_i64(item, "startTimestamp", 0));
        if (out->once_timestamp <= 0) return false;
    } else {
        return false;
    }

    if (strcmp(action, "FERTIGATION") == 0) {
        cJSON *ep = cJSON_GetObjectItem(item, "executionPlan");
        if (!ep && cJSON_IsObject(cJSON_GetObjectItem(item, "parameters"))) {
            ep = cJSON_GetObjectItem(cJSON_GetObjectItem(item, "parameters"), "executionPlan");
        }
        if (!ep || !cJSON_IsObject(ep)) return false;
        char *serialized_plan = cJSON_PrintUnformatted(ep);
        if (!serialized_plan || strlen(serialized_plan) >= sizeof(out->fertigation_payload_json)) {
            if (serialized_plan) free(serialized_plan);
            return false;
        }
        copy_string(out->fertigation_payload_json, sizeof(out->fertigation_payload_json), serialized_plan);
        free(serialized_plan);
    }

    cJSON *params = cJSON_GetObjectItem(item, "parameters");
    if (params && cJSON_IsObject(params)) {
        out->duration_sec = (int32_t)json_i64(params, "durationSec", out->duration_sec);
        out->raw_water_ml = (int32_t)json_i64(params, "rawWaterVolumeMl", 0);
        if (strcmp(action, "FERTIGATION") != 0 && out->duration_sec <= 0) out->duration_sec = 60;
    }

    cJSON *components = cJSON_GetObjectItem(item, "componentIds");
    if (components && cJSON_IsArray(components)) {
        cJSON *value = NULL;
        cJSON_ArrayForEach(value, components) {
            if (out->component_count >= MAX_RUNTIME_COMPONENTS || !cJSON_IsString(value) || !value->valuestring[0]) return false;
            copy_string(out->component_ids[out->component_count++], sizeof(out->component_ids[0]), value->valuestring);
            if (!hardware_registry_is_operational(value->valuestring)) return false;
        }
    }

    cJSON *resources = cJSON_GetObjectItem(item, "resourceLocks");
    if (!resources) resources = cJSON_GetObjectItem(item, "resourceClaims");
    if (resources && cJSON_IsArray(resources)) {
        cJSON *claim = NULL;
        cJSON_ArrayForEach(claim, resources) {
            if (out->resource_count >= MAX_RUNTIME_RESOURCES || !cJSON_IsObject(claim)) return false;
            const char *rid = json_string(claim, "resourceId");
            if (!rid || !rid[0]) return false;
            if (!resource_is_operational(rid)) return false;
            for (size_t existing = 0; existing < out->resource_count; ++existing) {
                if (strcmp(out->resources[existing].resource_id, rid) == 0) return false;
            }
            copy_string(out->resources[out->resource_count].resource_id, sizeof(out->resources[0].resource_id), rid);
            const char *lock_type = json_string(claim, "lockType");
            out->resources[out->resource_count].shared = lock_type && strcmp(lock_type, "SHARED") == 0;
            out->resource_count++;
        }
    } else {
        cJSON *ids = cJSON_GetObjectItem(item, "resourceIds");
        if (ids && cJSON_IsArray(ids)) {
            cJSON *rid = NULL;
            cJSON_ArrayForEach(rid, ids) {
                if (out->resource_count >= MAX_RUNTIME_RESOURCES || !cJSON_IsString(rid) || !rid->valuestring[0]) return false;
                if (!resource_is_operational(rid->valuestring)) return false;
                for (size_t existing = 0; existing < out->resource_count; ++existing) {
                    if (strcmp(out->resources[existing].resource_id, rid->valuestring) == 0) return false;
                }
                copy_string(out->resources[out->resource_count].resource_id, sizeof(out->resources[0].resource_id), rid->valuestring);
                out->resources[out->resource_count].shared = false;
                out->resource_count++;
            }
        }
    }

    out->valid = true;
    return true;
}

static int find_marker(const char *compiled_id)
{
    if (!compiled_id || !compiled_id[0]) return -1;
    for (size_t i = 0; i < MAX_COMPILED_SCHEDULES; ++i) {
        if (s_markers[i].valid && strcmp(s_markers[i].compiled_id, compiled_id) == 0) return (int)i;
    }
    return -1;
}

static int find_free_marker(void)
{
    for (size_t i = 0; i < MAX_COMPILED_SCHEDULES; ++i) {
        if (!s_markers[i].valid) return (int)i;
    }
    return -1;
}

static void hydrate_runtime_markers(void)
{
    for (size_t i = 0; i < s_runtime_count; ++i) {
        int idx = find_marker(s_runtime[i].compiled_id);
        if (idx < 0) {
            s_runtime[i].marker_state = MARKER_EMPTY;
            continue;
        }
        s_runtime[i].marker_state = (marker_state_t)s_markers[idx].state;
        s_runtime[i].last_occurrence_timestamp = s_markers[idx].last_occurrence_timestamp;
        s_runtime[i].last_execution_timestamp = s_markers[idx].last_execution_timestamp;
        s_runtime[i].pending_occurrence_timestamp = s_markers[idx].pending_occurrence_timestamp;
        copy_string(s_runtime[i].current_command_id, sizeof(s_runtime[i].current_command_id), s_markers[idx].command_id);
        s_runtime[i].pending = s_runtime[i].pending_occurrence_timestamp > 0 && s_runtime[i].marker_state == MARKER_PENDING;
        if (s_runtime[i].marker_state == MARKER_RUNNING) {
            /* The command manager cache is RAM-only. After reboot we deliberately do
             * not replay an unknown in-flight physical command because that could
             * duplicate a real operation. The occurrence is considered consumed and
             * placed in a recovery hold until M14 reconciliation. */
            s_runtime[i].marker_state = MARKER_RECOVERY_HOLD;
            s_runtime[i].running = false;
            s_runtime[i].pending = false;
        }
    }
}

static esp_err_t persist_markers(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;
    err = nvs_set_blob(handle, NVS_KEY_MARKERS, s_markers, sizeof(s_markers));
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}

static void load_markers(void)
{
    memset(s_markers, 0, sizeof(s_markers));
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) return;
    size_t length = sizeof(s_markers);
    if (nvs_get_blob(handle, NVS_KEY_MARKERS, s_markers, &length) != ESP_OK || length != sizeof(s_markers)) {
        memset(s_markers, 0, sizeof(s_markers));
    }
    nvs_close(handle);
}

static esp_err_t load_compiled_runtime_json(char *out_buf, size_t max_len, size_t *out_len)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) return err;
    size_t length = 0;
    err = nvs_get_blob(handle, NVS_KEY_COMPILED, NULL, &length);
    if (err == ESP_OK) {
        if (length == 0 || length > max_len) err = ESP_ERR_NO_MEM;
        else err = nvs_get_blob(handle, NVS_KEY_COMPILED, out_buf, &length);
    }
    nvs_close(handle);
    if (err == ESP_OK && out_len) *out_len = length > 0 ? length - 1 : 0;
    return err;
}

static esp_err_t parse_runtime_set(const char *json_str, runtime_schedule_t *out_runtime, size_t *out_count)
{
    if (!json_str || !out_runtime || !out_count) return ESP_ERR_INVALID_ARG;
    *out_count = 0;
    cJSON *root = cJSON_ParseWithLength(json_str, strlen(json_str));
    if (!root) return ESP_ERR_INVALID_ARG;
    cJSON *payload = cJSON_GetObjectItem(root, "payload");
    cJSON *target = payload && cJSON_IsObject(payload) ? payload : root;
    cJSON *items = cJSON_GetObjectItem(target, "compiled");
    cJSON *cfg_ver = cJSON_GetObjectItem(target, "configurationVersion");
    const system_storage_state_t *storage = storage_mgr_get_state();
    if (!items || !cJSON_IsArray(items) || !storage) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_ARG;
    }
    if (cfg_ver && cJSON_IsNumber(cfg_ver) && (uint32_t)cfg_ver->valueint != storage->config_version) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_STATE;
    }
    int count = cJSON_GetArraySize(items);
    if (count < 0 || count > MAX_COMPILED_SCHEDULES) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_SIZE;
    }
    for (int i = 0; i < count; ++i) {
        if (!parse_runtime_schedule(cJSON_GetArrayItem(items, i), &out_runtime[*out_count])) {
            cJSON_Delete(root);
            return ESP_ERR_INVALID_ARG;
        }
        for (size_t j = 0; j < *out_count; ++j) {
            if (strcmp(out_runtime[j].compiled_id, out_runtime[*out_count].compiled_id) == 0 ||
                strcmp(out_runtime[j].schedule_id, out_runtime[*out_count].schedule_id) == 0) {
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
        }
        (*out_count)++;
    }
    cJSON_Delete(root);
    return ESP_OK;
}

static esp_err_t validate_compiled_payload(const char *json_str)
{
    runtime_schedule_t temp[MAX_COMPILED_SCHEDULES];
    size_t count = 0;
    esp_err_t err = parse_runtime_set(json_str, temp, &count);
    if (err != ESP_OK) return err;

    cJSON *root = cJSON_ParseWithLength(json_str, strlen(json_str));
    if (!root) return ESP_ERR_INVALID_ARG;
    cJSON *payload = cJSON_GetObjectItem(root, "payload");
    cJSON *target = payload && cJSON_IsObject(payload) ? payload : root;
    cJSON *items = cJSON_GetObjectItem(target, "compiled");
    cJSON *topology_view = NULL;
    err = topology_capability_build_json(&topology_view);
    if (err != ESP_OK || !topology_view) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_STATE;
    }
    cJSON *valid = cJSON_GetObjectItem(topology_view, "valid");
    if (valid && cJSON_IsFalse(valid)) {
        cJSON_Delete(topology_view);
        cJSON_Delete(root);
        return ESP_ERR_INVALID_STATE;
    }
    for (int i = 0; i < cJSON_GetArraySize(items); ++i) {
        cJSON *item = cJSON_GetArrayItem(items, i);
        const char *gh_id = json_string(item, "ghId");
        const char *action = json_string(item, "action");
        if (gh_id && gh_id[0]) {
            cJSON *by_gh = cJSON_GetObjectItem(topology_view, "byGh");
            cJSON *gh = by_gh ? cJSON_GetObjectItem(by_gh, gh_id) : NULL;
            cJSON *caps = gh ? cJSON_GetObjectItem(gh, "capabilities") : NULL;
            if (!caps) {
                err = ESP_ERR_NOT_FOUND;
                break;
            }
            const char *required = NULL;
            if (strcmp(action, "FERTIGATION") == 0) required = "CAN_RUN_AUTONOMOUSLY";
            else if (strcmp(action, "FAN_TOGGLE") == 0) required = "CAN_CLIMATE_CONTROL";
            if (required) {
                cJSON *cap = cJSON_GetObjectItem(caps, required);
                if (!cap || !cJSON_IsTrue(cap)) {
                    err = ESP_ERR_NOT_SUPPORTED;
                    break;
                }
            }
        }
    }
    cJSON_Delete(topology_view);
    cJSON_Delete(root);
    return err;
}

static void reset_runtime_from_new_set(runtime_schedule_t *fresh, size_t fresh_count)
{
    s_runtime_count = fresh_count;
    memcpy(s_runtime, fresh, fresh_count * sizeof(runtime_schedule_t));
    memset(s_runtime + fresh_count, 0, sizeof(s_runtime) - fresh_count * sizeof(runtime_schedule_t));
    memset(s_resource_locks, 0, sizeof(s_resource_locks));
    hydrate_runtime_markers();
}

esp_err_t scheduler_deploy_compiled_json(const char *json_str)
{
    if (!json_str) return ESP_ERR_INVALID_ARG;
    runtime_schedule_t fresh[MAX_COMPILED_SCHEDULES];
    size_t fresh_count = 0;
    esp_err_t err = parse_runtime_set(json_str, fresh, &fresh_count);
    if (err != ESP_OK) return err;
    err = validate_compiled_payload(json_str);
    if (err != ESP_OK) return err;

    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    for (size_t i = 0; i < s_runtime_count; ++i) {
        if (s_runtime[i].running) {
            (void)event_mgr_log(LOG_LEVEL_WARNING, "SCHEDULER", "SCHEDULE_DEPLOY_BLOCKED_ACTIVE_RUN", "Compiled schedule deployment is blocked while a physical command is running", NULL);
            xSemaphoreGive(s_mutex);
            return ESP_ERR_INVALID_STATE;
        }
    }

    cJSON *root = cJSON_ParseWithLength(json_str, strlen(json_str));
    if (!root) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_ARG;
    }
    cJSON *payload = cJSON_GetObjectItem(root, "payload");
    cJSON *target = payload && cJSON_IsObject(payload) ? payload : root;
    cJSON *cfg_version = target ? cJSON_GetObjectItem(target, "configurationVersion") : NULL;
    const system_storage_state_t *storage = storage_mgr_get_state();
    const uint32_t cfg_ver = cfg_version && cJSON_IsNumber(cfg_version) ? (uint32_t)cfg_version->valueint : (storage ? storage->config_version : 0);
    cJSON_Delete(root);
    if (!storage) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }

    scheduler_marker_t staged_markers[MAX_COMPILED_SCHEDULES];
    memcpy(staged_markers, s_markers, sizeof(staged_markers));
    for (size_t i = 0; i < MAX_COMPILED_SCHEDULES; ++i) {
        scheduler_marker_t *m = &staged_markers[i];
        if (!m->valid) continue;
        bool keep = false;
        for (size_t j = 0; j < fresh_count; ++j) {
            if (strcmp(m->compiled_id, fresh[j].compiled_id) == 0 && m->configuration_version == cfg_ver) {
                keep = true;
                break;
            }
        }
        if (!keep) memset(m, 0, sizeof(*m));
    }
    for (size_t i = 0; i < fresh_count; ++i) {
        int idx = -1;
        for (size_t j = 0; j < MAX_COMPILED_SCHEDULES; ++j) {
            if (staged_markers[j].valid && strcmp(staged_markers[j].compiled_id, fresh[i].compiled_id) == 0) {
                idx = (int)j;
                break;
            }
        }
        if (idx < 0) {
            for (size_t j = 0; j < MAX_COMPILED_SCHEDULES; ++j) {
                if (!staged_markers[j].valid) {
                    idx = (int)j;
                    break;
                }
            }
        }
        if (idx >= 0 && !staged_markers[idx].valid) {
            memset(&staged_markers[idx], 0, sizeof(staged_markers[idx]));
            staged_markers[idx].valid = 1;
            staged_markers[idx].state = MARKER_EMPTY;
            copy_string(staged_markers[idx].compiled_id, sizeof(staged_markers[idx].compiled_id), fresh[i].compiled_id);
            staged_markers[idx].configuration_version = cfg_ver;
        }
    }

    nvs_handle_t handle;
    err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        const size_t compiled_len = strlen(json_str) + 1;
        err = nvs_set_blob(handle, NVS_KEY_COMPILED, json_str, compiled_len);
        if (err == ESP_OK) err = nvs_set_blob(handle, NVS_KEY_MARKERS, staged_markers, sizeof(staged_markers));
        if (err == ESP_OK) err = nvs_commit(handle);
        nvs_close(handle);
    }
    if (err == ESP_OK) {
        memcpy(s_markers, staged_markers, sizeof(s_markers));
        reset_runtime_from_new_set(fresh, fresh_count);
        apply_timezone_from_active_config();
    }

    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t scheduler_get_compiled_json(char *out_buf, size_t max_len, size_t *out_len)
{
    if (!out_buf || max_len == 0) return ESP_ERR_INVALID_ARG;
    return load_compiled_runtime_json(out_buf, max_len, out_len);
}

esp_err_t scheduler_clear_compiled(void)
{
    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        err = nvs_erase_key(handle, NVS_KEY_COMPILED);
        if (err == ESP_ERR_NVS_NOT_FOUND) err = ESP_OK;
        if (err == ESP_OK) {
            err = nvs_erase_key(handle, NVS_KEY_MARKERS);
            if (err == ESP_ERR_NVS_NOT_FOUND) err = ESP_OK;
        }
        if (err == ESP_OK) err = nvs_commit(handle);
        nvs_close(handle);
    }
    if (err == ESP_OK) {
        memset(s_runtime, 0, sizeof(s_runtime));
        s_runtime_count = 0;
        memset(s_resource_locks, 0, sizeof(s_resource_locks));
        memset(s_markers, 0, sizeof(s_markers));
    }
    xSemaphoreGive(s_mutex);
    return err;
}

static bool same_resource(const resource_claim_t *a, const resource_claim_t *b)
{
    return a && b && a->resource_id[0] && strcmp(a->resource_id, b->resource_id) == 0;
}

static scheduler_resource_lock_t *find_resource_lock(const char *resource_id)
{
    if (!resource_id || !resource_id[0]) return NULL;
    for (size_t i = 0; i < MAX_RUNTIME_RESOURCES; ++i) {
        if (s_resource_locks[i].valid && strcmp(s_resource_locks[i].resource_id, resource_id) == 0) return &s_resource_locks[i];
    }
    return NULL;
}

static scheduler_resource_lock_t *find_free_resource_lock(void)
{
    for (size_t i = 0; i < MAX_RUNTIME_RESOURCES; ++i) {
        if (!s_resource_locks[i].valid) return &s_resource_locks[i];
    }
    return NULL;
}

static bool resource_conflicts(const runtime_schedule_t *candidate)
{
    if (!candidate) return true;
    for (size_t i = 0; i < candidate->resource_count; ++i) {
        const resource_claim_t *claim = &candidate->resources[i];
        scheduler_resource_lock_t *lock = find_resource_lock(claim->resource_id);
        if (!lock) continue;
        if (claim->shared) {
            if (lock->exclusive_owner[0]) return true;
        } else if (lock->exclusive_owner[0] || lock->shared_count > 0) {
            return true;
        }
    }
    return false;
}

static bool acquire_resource_locks(const runtime_schedule_t *candidate)
{
    if (!candidate || resource_conflicts(candidate)) return false;

    for (size_t i = 0; i < candidate->resource_count; ++i) {
        const resource_claim_t *claim = &candidate->resources[i];
        scheduler_resource_lock_t *lock = find_resource_lock(claim->resource_id);
        if (!lock) {
            lock = find_free_resource_lock();
            if (!lock) return false;
            memset(lock, 0, sizeof(*lock));
            lock->valid = true;
            copy_string(lock->resource_id, sizeof(lock->resource_id), claim->resource_id);
        }
        if (claim->shared) {
            lock->shared_count++;
        } else {
            copy_string(lock->exclusive_owner, sizeof(lock->exclusive_owner), candidate->owner_id);
        }
    }
    return true;
}

static void release_resource_locks(const runtime_schedule_t *owner)
{
    if (!owner) return;
    for (size_t i = 0; i < owner->resource_count; ++i) {
        const resource_claim_t *claim = &owner->resources[i];
        scheduler_resource_lock_t *lock = find_resource_lock(claim->resource_id);
        if (!lock) continue;
        if (claim->shared) {
            if (lock->shared_count > 0) lock->shared_count--;
        } else if (strcmp(lock->exclusive_owner, owner->owner_id) == 0) {
            lock->exclusive_owner[0] = '\0';
        }
        if (lock->shared_count == 0 && !lock->exclusive_owner[0]) memset(lock, 0, sizeof(*lock));
    }
}

static bool schedule_day_selected(const runtime_schedule_t *sched, const struct tm *tm_value)
{
    return sched && tm_value && (sched->days_of_week & (uint8_t)(1U << tm_value->tm_wday)) != 0;
}

static time_t daily_occurrence_at_or_before(const runtime_schedule_t *sched, time_t now, bool *selected)
{
    struct tm local_now;
    if (!sched || !localtime_r(&now, &local_now)) return 0;
    for (int days_back = 0; days_back <= 7; ++days_back) {
        struct tm candidate = local_now;
        candidate.tm_hour = sched->hour;
        candidate.tm_min = sched->minute;
        candidate.tm_sec = 0;
        candidate.tm_mday -= days_back;
        time_t ts = mktime(&candidate);
        if (ts <= now && schedule_day_selected(sched, &candidate)) {
            if (selected) *selected = true;
            return ts;
        }
    }
    if (selected) *selected = false;
    return 0;
}

static bool occurrence_is_due(runtime_schedule_t *sched, time_t now, int64_t *occurrence, bool *missed)
{
    if (!sched || !occurrence || !missed) return false;
    *occurrence = 0;
    *missed = false;
    if (!local_clock_valid(now)) return false;

    if (sched->type == SCHED_TYPE_ONCE) {
        const int64_t ts = sched->once_timestamp > 0 ? sched->once_timestamp : (int64_t)sched->start_timestamp;
        if (ts <= 0 || (sched->last_occurrence_timestamp >= ts)) return false;
        if ((int64_t)now >= ts) {
            *occurrence = ts;
            *missed = ((int64_t)now - ts) >= 60;
            return true;
        }
        return false;
    }

    if (sched->type == SCHED_TYPE_DAILY) {
        bool selected = false;
        const time_t ts = daily_occurrence_at_or_before(sched, now, &selected);
        if (!selected || ts <= 0) return false;
        if ((int64_t)ts < (int64_t)sched->start_timestamp) return false;
        if (sched->last_occurrence_timestamp >= (int64_t)ts) return false;
        *occurrence = ts;
        *missed = ((int64_t)now - (int64_t)ts) >= 60;
        return true;
    }

    const int64_t interval_sec = (int64_t)sched->interval_min * 60;
    if (interval_sec <= 0) return false;
    int64_t candidate = sched->last_execution_timestamp > 0
        ? sched->last_execution_timestamp + interval_sec
        : (int64_t)sched->start_timestamp;
    if (candidate <= 0 || (int64_t)now < candidate) return false;
    *occurrence = candidate;
    *missed = ((int64_t)now - candidate) >= 1;
    return true;
}

static void marker_update(runtime_schedule_t *sched, marker_state_t state, int64_t occurrence, int64_t execution, const char *command_id)
{
    int idx = find_marker(sched->compiled_id);
    if (idx < 0) idx = find_free_marker();
    if (idx < 0) return;
    scheduler_marker_t *m = &s_markers[idx];
    memset(m, 0, sizeof(*m));
    m->valid = 1;
    m->state = (uint8_t)state;
    copy_string(m->compiled_id, sizeof(m->compiled_id), sched->compiled_id);
    m->configuration_version = storage_mgr_get_state()->config_version;
    m->last_occurrence_timestamp = occurrence > 0 ? occurrence : sched->last_occurrence_timestamp;
    m->last_execution_timestamp = execution > 0 ? execution : sched->last_execution_timestamp;
    m->pending_occurrence_timestamp = sched->pending ? sched->pending_occurrence_timestamp : 0;
    copy_string(m->command_id, sizeof(m->command_id), command_id ? command_id : sched->current_command_id);
    (void)persist_markers();

    sched->marker_state = state;
}

static void build_command_id(const runtime_schedule_t *sched, int64_t occurrence, char out[40])
{
    const uint32_t hash = stable_hash(sched->compiled_id);
    snprintf(out, 40, "sch-%08lx-%lld", (unsigned long)hash, (long long)occurrence);
}

static esp_err_t dispatch_runtime_schedule(runtime_schedule_t *sched, int64_t occurrence, time_t now)
{
    if (!sched) return ESP_ERR_INVALID_ARG;
    if (!safety_monitor_allows_scheduler()) return ESP_ERR_INVALID_STATE;

    command_item_t cmd;
    memset(&cmd, 0, sizeof(cmd));
    build_command_id(sched, occurrence, cmd.command_id);
    cmd.status = CMD_STATUS_PENDING;
    cmd.param_duration_sec = sched->duration_sec;
    cmd.param_raw_volume_ml = sched->raw_water_ml;
    cmd.configuration_version = storage_mgr_get_state()->config_version;
    copy_string(cmd.source, sizeof(cmd.source), "SCHEDULER");
    copy_string(cmd.target_complex_id, sizeof(cmd.target_complex_id), sched->complex_id);
    copy_string(cmd.target_gh_id, sizeof(cmd.target_gh_id), sched->gh_id);
    if (sched->resource_count > 0) copy_string(cmd.resource_id, sizeof(cmd.resource_id), sched->resources[0].resource_id);
    cmd.param_on = true;
    if (sched->component_count > 0) copy_string(cmd.component_id, sizeof(cmd.component_id), sched->component_ids[0]);
    cmd.submitted_at = (int64_t)now;

    if (strcmp(sched->action, "FERTIGATION") == 0) {
        if (!sched->fertigation_payload_json[0]) return ESP_ERR_INVALID_ARG;
        copy_string(cmd.fertigation_payload_json, sizeof(cmd.fertigation_payload_json), sched->fertigation_payload_json);
        cmd.type = CMD_TYPE_FERTIGATION_BATCH;
    } else if (strcmp(sched->action, "WATER_PUMP") == 0) {
        cmd.type = CMD_TYPE_COMPONENT_TIMED;
    } else if (strcmp(sched->action, "FAN_TOGGLE") == 0) {
        cmd.type = CMD_TYPE_COMPONENT_TIMED;
    } else {
        return ESP_ERR_NOT_SUPPORTED;
    }

    /* Reserve the occurrence before submitting to the physical command queue so
     * a reboot or duplicate scheduler evaluation cannot generate a second ID. */
    sched->pending = true;
    sched->pending_occurrence_timestamp = occurrence;
    sched->current_command_id[0] = '\0';
    marker_update(sched, MARKER_PENDING, occurrence, 0, cmd.command_id);

    command_item_t receipt;
    esp_err_t err = command_mgr_submit(&cmd, &receipt);
    if (err != ESP_OK) {
        /* Submission did not reach the command queue. Keep the occurrence pending
         * for the next evaluation rather than declaring it executed. */
        sched->marker_state = MARKER_PENDING;
        sched->pending = true;
        (void)marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp, sched->last_execution_timestamp, NULL);
        return err;
    }

    sched->last_occurrence_timestamp = occurrence;
    sched->last_execution_timestamp = (int64_t)now;
    sched->pending = false;
    sched->pending_occurrence_timestamp = 0;
    sched->running = true;
    copy_string(sched->current_command_id, sizeof(sched->current_command_id), receipt.command_id);
    marker_update(sched, MARKER_RUNNING, occurrence, now, receipt.command_id);
    (void)event_mgr_log_command(LOG_LEVEL_INFO, "SCHEDULE_TRIGGERED",
                                 "Active schedule occurrence dispatched to command queue.",
                                 sched->current_command_id, sched->complex_id, sched->gh_id,
                                 sched->component_count > 0 ? sched->component_ids[0] : NULL,
                                 sched->resource_count > 0 ? sched->resources[0].resource_id : NULL,
                                 sched->configuration_version);
    ESP_LOGI(TAG, "Schedule '%s' dispatched: occurrence=%lld command=%s priority=%lu",
             sched->schedule_id, (long long)occurrence, sched->current_command_id, (unsigned long)sched->priority);
    return ESP_OK;
}

static void refresh_running_state(void)
{
    bool changed = false;
    for (size_t i = 0; i < s_runtime_count; ++i) {
        runtime_schedule_t *sched = &s_runtime[i];
        if (!sched->running || !sched->current_command_id[0]) continue;
        command_item_t receipt;
        if (command_mgr_get(sched->current_command_id, &receipt) != ESP_OK) continue;
        if (receipt.status == CMD_STATUS_COMPLETED || receipt.status == CMD_STATUS_FAILED ||
            receipt.status == CMD_STATUS_REJECTED || receipt.status == CMD_STATUS_CANCELLED) {
            release_resource_locks(sched);
            sched->running = false;
            marker_update(sched, receipt.status == CMD_STATUS_COMPLETED ? MARKER_COMPLETE : MARKER_SKIPPED,
                          sched->last_occurrence_timestamp, sched->last_execution_timestamp, sched->current_command_id);
            changed = true;
            ESP_LOGI(TAG, "Schedule '%s' completed command=%s status=%d", sched->schedule_id, sched->current_command_id, receipt.status);
        }
    }
}

static bool missed_policy_execute(const runtime_schedule_t *sched)
{
    return sched && strcmp(sched->missed_policy, "EXECUTE") == 0;
}

static void mark_skipped(runtime_schedule_t *sched, int64_t occurrence, const char *reason)
{
    sched->last_occurrence_timestamp = occurrence;
    sched->pending = false;
    sched->pending_occurrence_timestamp = 0;
    marker_update(sched, MARKER_SKIPPED, occurrence, 0, "");
    (void)event_mgr_log_command(LOG_LEVEL_WARNING, "SCHEDULE_SKIPPED", reason ? reason : "Missed schedule skipped",
                                 sched->schedule_id, sched->complex_id, sched->gh_id,
                                 sched->component_count ? sched->component_ids[0] : NULL,
                                 sched->resource_count ? sched->resources[0].resource_id : NULL,
                                 sched->configuration_version);
}

static int compare_due_slots(const void *a, const void *b)
{
    const runtime_schedule_t *const *sa = (const runtime_schedule_t *const *)a;
    const runtime_schedule_t *const *sb = (const runtime_schedule_t *const *)b;
    if ((*sa)->priority > (*sb)->priority) return -1;
    if ((*sa)->priority < (*sb)->priority) return 1;
    return strcmp((*sa)->schedule_id, (*sb)->schedule_id);
}

esp_err_t scheduler_evaluate_at(time_t now)
{
    if (!local_clock_valid(now)) return ESP_ERR_INVALID_STATE;
    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    refresh_running_state();

    runtime_schedule_t *due[MAX_COMPILED_SCHEDULES];
    int64_t occurrences[MAX_COMPILED_SCHEDULES];
    bool missed[MAX_COMPILED_SCHEDULES];
    size_t due_count = 0;

    for (size_t i = 0; i < s_runtime_count; ++i) {
        runtime_schedule_t *sched = &s_runtime[i];
        if (!sched->valid || sched->running || sched->marker_state == MARKER_RECOVERY_HOLD) continue;

        int64_t occurrence = 0;
        bool is_missed = false;
        if (sched->pending && sched->pending_occurrence_timestamp > 0) {
            occurrence = sched->pending_occurrence_timestamp;
            is_missed = true;
        } else if (!occurrence_is_due(sched, now, &occurrence, &is_missed)) {
            continue;
        }

        if (sched->type == SCHED_TYPE_ONCE && sched->last_occurrence_timestamp >= occurrence) continue;

        if (is_missed && sched->recovery_window_sec > 0 && ((int64_t)now - occurrence) > (int64_t)sched->recovery_window_sec) {
            mark_skipped(sched, occurrence, "Schedule recovery window expired");
            continue;
        }

        if (is_missed && !missed_policy_execute(sched) && !sched->pending) {
            mark_skipped(sched, occurrence, "Schedule occurrence was missed and policy=SKIP");
            continue;
        }

        due[due_count] = sched;
        occurrences[due_count] = occurrence;
        missed[due_count] = is_missed;
        due_count++;
    }

    /* Higher priority work gets first opportunity to acquire conflicting resources. */
    for (size_t i = 0; i < due_count; ++i) {
        for (size_t j = i + 1; j < due_count; ++j) {
            if (compare_due_slots(&due[i], &due[j]) > 0) {
                runtime_schedule_t *tmp_s = due[i]; due[i] = due[j]; due[j] = tmp_s;
                int64_t tmp_o = occurrences[i]; occurrences[i] = occurrences[j]; occurrences[j] = tmp_o;
                bool tmp_m = missed[i]; missed[i] = missed[j]; missed[j] = tmp_m;
            }
        }
    }

    for (size_t i = 0; i < due_count; ++i) {
        runtime_schedule_t *sched = due[i];
        const int64_t occurrence = occurrences[i];
        (void)missed[i];
        if (!safety_monitor_allows_scheduler()) {
            const bool was_pending = sched->pending;
            sched->pending = true;
            sched->pending_occurrence_timestamp = occurrence;
            if (!was_pending) {
                marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp, sched->last_execution_timestamp, NULL);
                (void)event_mgr_log_command(LOG_LEVEL_WARNING, "SCHEDULE_BLOCKED_SAFETY", "Schedule occurrence held while local safety policy blocks execution.", sched->schedule_id, sched->complex_id, sched->gh_id, sched->component_count ? sched->component_ids[0] : NULL, sched->resource_count ? sched->resources[0].resource_id : NULL, sched->configuration_version);
            }
            continue;
        }
        if (resource_conflicts(sched)) {
            /* Conflict is a runtime queue condition, not a silent skip. Keep the
             * occurrence pending so a later tick can execute it when the resource
             * becomes available. Persist only when the queued state changes to avoid
             * writing flash every scheduler tick. */
            const bool was_pending = sched->pending;
            sched->pending = true;
            sched->pending_occurrence_timestamp = occurrence;
            if (!was_pending) {
                marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp, sched->last_execution_timestamp, "");
                ESP_LOGW(TAG, "Schedule '%s' queued behind a resource conflict", sched->schedule_id);
            }
            continue;
        }
        if (!acquire_resource_locks(sched)) {
            const bool was_pending = sched->pending;
            sched->pending = true;
            sched->pending_occurrence_timestamp = occurrence;
            if (!was_pending) {
                marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp, sched->last_execution_timestamp, NULL);
                (void)event_mgr_log_command(LOG_LEVEL_WARNING, "SCHEDULE_SKIPPED", "Resource lock acquisition failed; occurrence remains queued.", sched->schedule_id, sched->complex_id, sched->gh_id, sched->component_count ? sched->component_ids[0] : NULL, sched->resource_count ? sched->resources[0].resource_id : NULL, sched->configuration_version);
            }
            continue;
        }
        esp_err_t err = dispatch_runtime_schedule(sched, occurrence, now);
        if (err != ESP_OK) {
            release_resource_locks(sched);
            const bool was_pending = sched->pending;
            sched->pending = true;
            sched->pending_occurrence_timestamp = occurrence;
            if (!was_pending) marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp, sched->last_execution_timestamp, NULL);
            if (err == ESP_ERR_INVALID_STATE && actuator_hal_is_emergency_stopped()) {
                if (!was_pending) (void)event_mgr_log_command(LOG_LEVEL_WARNING, "SCHEDULE_SKIPPED", "Schedule held while emergency stop is latched.", sched->schedule_id, sched->complex_id, sched->gh_id, sched->component_count ? sched->component_ids[0] : NULL, sched->resource_count ? sched->resources[0].resource_id : NULL, sched->configuration_version);
            } else if (!was_pending) {
                (void)event_mgr_log_command(LOG_LEVEL_WARNING, "SCHEDULE_SKIPPED", "Command dispatch failed; occurrence remains queued.", sched->schedule_id, sched->complex_id, sched->gh_id, sched->component_count ? sched->component_ids[0] : NULL, sched->resource_count ? sched->resources[0].resource_id : NULL, sched->configuration_version);
            }
        }
    }

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

static void scheduler_task(void *pvParameters)
{
    (void)pvParameters;
    TickType_t last_wake = xTaskGetTickCount();
    ESP_LOGI(TAG, "Production runtime scheduler active: 1 second evaluation tick");
    while (1) {
        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(SCHEDULER_TICK_MS));
        time_t now;
        time(&now);
        esp_err_t err = scheduler_evaluate_at(now);
        if (err == ESP_ERR_INVALID_STATE) {
            ESP_LOGW(TAG, "Local clock not yet valid; schedule evaluation held");
        }
    }
}

esp_err_t scheduler_get_all(schedule_entry_t *out_entries, size_t max_entries, size_t *out_count)
{
    if (!out_entries || !out_count || !s_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    size_t count = s_runtime_count < max_entries ? s_runtime_count : max_entries;
    for (size_t i = 0; i < count; ++i) {
        runtime_schedule_t *src = &s_runtime[i];
        schedule_entry_t *dst = &out_entries[i];
        memset(dst, 0, sizeof(*dst));
        copy_string(dst->id, sizeof(dst->id), src->schedule_id);
        dst->enabled = src->valid;
        dst->type = src->type;
        dst->action = strcmp(src->action, "FERTIGATION") == 0 ? SCHED_ACTION_FERTIGATION :
                      strcmp(src->action, "WATER_PUMP") == 0 ? SCHED_ACTION_WATER_PUMP :
                      strcmp(src->action, "FAN_TOGGLE") == 0 ? SCHED_ACTION_FAN_TOGGLE : SCHED_ACTION_CUSTOM;
        dst->duration_sec = (uint32_t)src->duration_sec;
        dst->hour = src->hour;
        dst->minute = src->minute;
        dst->days_of_week = src->days_of_week;
        dst->interval_min = src->interval_min;
        dst->last_execution_timestamp = src->last_execution_timestamp;
        dst->is_running = src->running || src->pending;
        copy_string(dst->current_command_id, sizeof(dst->current_command_id), src->current_command_id);
    }
    *out_count = count;
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t scheduler_add_entry(const schedule_entry_t *entry)
{
    (void)entry;
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t scheduler_remove_entry(const char *id)
{
    (void)id;
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t scheduler_clear_all(void)
{
    return scheduler_clear_compiled();
}

esp_err_t scheduler_init(void)
{
    if (s_initialized) return ESP_OK;
    s_mutex = xSemaphoreCreateMutex();
    if (!s_mutex) return ESP_ERR_NO_MEM;

    memset(s_runtime, 0, sizeof(s_runtime));
    s_runtime_count = 0;
    load_markers();
    apply_timezone_from_active_config();

    char *compiled = calloc(1, MAX_COMPILED_JSON);
    if (compiled) {
        size_t len = 0;
        if (load_compiled_runtime_json(compiled, MAX_COMPILED_JSON, &len) == ESP_OK && len > 0) {
            runtime_schedule_t parsed[MAX_COMPILED_SCHEDULES];
            size_t count = 0;
            if (parse_runtime_set(compiled, parsed, &count) == ESP_OK) {
                memcpy(s_runtime, parsed, count * sizeof(runtime_schedule_t));
                s_runtime_count = count;
                hydrate_runtime_markers();
            } else {
                ESP_LOGE(TAG, "Persisted compiled schedule set is invalid; scheduler starts with no executable schedules");
            }
        }
        free(compiled);
    }

    const system_storage_state_t *state = storage_mgr_get_state();
    if (state) {
        ESP_LOGI(TAG, "Loaded %u compiled schedule(s), config v%lu, boot #%lu",
                 (unsigned)s_runtime_count, (unsigned long)state->config_version, (unsigned long)state->boot_count);
    }
    if (s_runtime_count > 0) {
        for (size_t i = 0; i < s_runtime_count; ++i) {
            if (s_runtime[i].marker_state == MARKER_RECOVERY_HOLD) {
                (void)event_mgr_log(LOG_LEVEL_WARNING, "SCHEDULER", "SCHEDULE_RECOVERY_HOLD", "A previously running schedule was held after reboot to prevent duplicate physical execution", NULL);
            }
        }
    }

    s_initialized = true;
    if (xTaskCreatePinnedToCore(scheduler_task, "scheduler", 6144, NULL, 4, NULL, 1) != pdPASS) {
        s_initialized = false;
        vSemaphoreDelete(s_mutex);
        s_mutex = NULL;
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}
