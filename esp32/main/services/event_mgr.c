#include "services/event_mgr.h"
#include "storage/storage_mgr.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <string.h>
#include <time.h>
#include <stdio.h>
#include <stdlib.h>
#include <inttypes.h>
#include <errno.h>

static const char *TAG = "EVENT_MGR";

#define EVENT_RING_BUFFER_SIZE 64
#define EVENT_SEQUENCE_BLOCK 256U
#define EVENT_HISTORY_BUFFER_BYTES (256U * 1024U)

typedef struct {
    uint64_t seq;
    char id[80];
    char timestamp[32];
    event_level_t level;
    char category[24];
    char code[48];
    char message[128];
    char component_id[40];
    char command_id[40];
    char complex_id[32];
    char gh_id[32];
    char resource_id[40];
    uint32_t configuration_version;
} system_event_t;

static system_event_t s_events[EVENT_RING_BUFFER_SIZE];
static size_t s_head = 0;
static size_t s_count = 0;
static uint64_t s_next_seq = 1;
static uint64_t s_sequence_end = 0;
static SemaphoreHandle_t s_evt_mutex = NULL;
static bool s_storage_degraded = false;
static bool s_initialized = false;

static const char *level_to_str(event_level_t l)
{
    switch (l) {
        case LOG_LEVEL_INFO: return "INFO";
        case LOG_LEVEL_WARNING: return "WARNING";
        case LOG_LEVEL_ERROR: return "ERROR";
        case LOG_LEVEL_CRITICAL: return "CRITICAL";
        default: return "INFO";
    }
}

static uint64_t allocate_sequence_locked(void)
{
    if (s_next_seq > s_sequence_end) {
        uint64_t first = 0;
        if (storage_mgr_reserve_sequence_block("event_seq_end", EVENT_SEQUENCE_BLOCK, &first) == ESP_OK) {
            s_next_seq = first;
            s_sequence_end = first + EVENT_SEQUENCE_BLOCK - 1U;
        } else {
            /* Keep RAM operation alive but surface degraded persistence through the API. */
            s_storage_degraded = true;
        }
    }
    return s_next_seq++;
}

static void timestamp_now(char out[32])
{
    time_t now = time(NULL);
    if (now > 0) strftime(out, 32, "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    else strncpy(out, "1970-01-01T00:00:00Z", 32);
}

static void resolve_default_context(system_event_t *e, const char *component_id)
{
    const system_storage_state_t *storage = storage_mgr_get_state();
    if (storage) {
        strncpy(e->complex_id, storage->complex_id, sizeof(e->complex_id) - 1);
    }
    if (component_id) strncpy(e->component_id, component_id, sizeof(e->component_id) - 1);
}

static esp_err_t persist_event(const system_event_t *e)
{
    cJSON *json = cJSON_CreateObject();
    if (!json) return ESP_ERR_NO_MEM;
    const system_storage_state_t *storage = storage_mgr_get_state();
    const char *device_id = storage && storage->device_id[0] ? storage->device_id : "unknown-device";
    cJSON_AddStringToObject(json, "recordType", "EVENT");
    cJSON_AddStringToObject(json, "recordId", e->id);
    cJSON_AddStringToObject(json, "eventId", e->id);
    cJSON_AddStringToObject(json, "deviceId", device_id);
    cJSON_AddNumberToObject(json, "sequence", (double)e->seq);
    cJSON_AddStringToObject(json, "deviceTimestamp", e->timestamp);
    cJSON_AddStringToObject(json, "at", e->timestamp);
    cJSON_AddStringToObject(json, "severity", level_to_str(e->level));
    cJSON_AddStringToObject(json, "level", level_to_str(e->level));
    cJSON_AddStringToObject(json, "eventType", e->code);
    cJSON_AddStringToObject(json, "category", e->category);
    cJSON_AddStringToObject(json, "code", e->code);
    cJSON_AddStringToObject(json, "message", e->message);
    if (e->complex_id[0]) cJSON_AddStringToObject(json, "complexId", e->complex_id);
    if (e->gh_id[0]) cJSON_AddStringToObject(json, "ghId", e->gh_id);
    if (e->component_id[0]) cJSON_AddStringToObject(json, "componentId", e->component_id);
    if (e->command_id[0]) cJSON_AddStringToObject(json, "commandId", e->command_id);
    if (e->resource_id[0]) cJSON_AddStringToObject(json, "resourceId", e->resource_id);
    if (e->configuration_version) cJSON_AddNumberToObject(json, "configurationVersion", e->configuration_version);
    cJSON_AddObjectToObject(json, "payload");

    char *json_buf = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (!json_buf) return ESP_ERR_NO_MEM;
    esp_err_t err = storage_mgr_append_event_log(json_buf);
    free(json_buf);
    if (err != ESP_OK) s_storage_degraded = true;
    return err;
}

static void ring_push_locked(const system_event_t *src)
{
    s_events[s_head] = *src;
    s_head = (s_head + 1U) % EVENT_RING_BUFFER_SIZE;
    if (s_count < EVENT_RING_BUFFER_SIZE) s_count++;
}

static esp_err_t log_internal(event_level_t level, const char *category, const char *code,
                              const char *message, const char *command_id, const char *complex_id,
                              const char *gh_id, const char *component_id, const char *resource_id,
                              uint32_t configuration_version)
{
    if (!s_evt_mutex) {
        s_evt_mutex = xSemaphoreCreateMutex();
        if (!s_evt_mutex) return ESP_ERR_NO_MEM;
    }
    if (xSemaphoreTake(s_evt_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    system_event_t e;
    memset(&e, 0, sizeof(e));
    e.seq = allocate_sequence_locked();
    const system_storage_state_t *storage = storage_mgr_get_state();
    const char *device_id = storage && storage->device_id[0] ? storage->device_id : "unknown-device";
    snprintf(e.id, sizeof(e.id), "evt-%s-%" PRIu64, device_id, e.seq);
    timestamp_now(e.timestamp);
    e.level = level;
    strncpy(e.category, category ? category : "SYSTEM", sizeof(e.category) - 1);
    strncpy(e.code, code ? code : "EVENT", sizeof(e.code) - 1);
    strncpy(e.message, message ? message : "", sizeof(e.message) - 1);
    resolve_default_context(&e, component_id);
    if (complex_id && complex_id[0]) strncpy(e.complex_id, complex_id, sizeof(e.complex_id) - 1);
    if (gh_id && gh_id[0]) strncpy(e.gh_id, gh_id, sizeof(e.gh_id) - 1);
    if (command_id && command_id[0]) strncpy(e.command_id, command_id, sizeof(e.command_id) - 1);
    if (resource_id && resource_id[0]) strncpy(e.resource_id, resource_id, sizeof(e.resource_id) - 1);
    e.configuration_version = configuration_version;
    ring_push_locked(&e);
    xSemaphoreGive(s_evt_mutex);

    esp_err_t persist_err = persist_event(&e);
    ESP_LOGI(TAG, "[%s] %s: %s", level_to_str(level), e.code, e.message);
    return persist_err;
}

esp_err_t event_mgr_init(void)
{
    if (!s_evt_mutex) {
        s_evt_mutex = xSemaphoreCreateMutex();
        if (!s_evt_mutex) return ESP_ERR_NO_MEM;
    }
    if (s_initialized) return ESP_OK;
    (void)allocate_sequence_locked();
    esp_err_t err = log_internal(LOG_LEVEL_INFO, "SYSTEM", "SYS_BOOT",
                                  "System booted with local event history enabled", NULL, NULL, NULL, "esp32", NULL, 0);
    if (err != ESP_OK) s_storage_degraded = true;
    s_initialized = true;
    ESP_LOGI(TAG, "Event manager initialized.");
    return ESP_OK;
}

esp_err_t event_mgr_log(event_level_t level, const char *category, const char *code, const char *message, const char *component_id)
{
    const system_storage_state_t *storage = storage_mgr_get_state();
    return log_internal(level, category, code, message, NULL,
                        storage && storage->complex_id[0] ? storage->complex_id : NULL,
                        NULL, component_id, NULL, storage ? storage->config_version : 0);
}

esp_err_t event_mgr_log_context(event_level_t level, const char *category, const char *code, const char *message,
                                const char *complex_id, const char *gh_id, const char *component_id,
                                const char *resource_id, uint32_t configuration_version)
{
    return log_internal(level, category, code, message, NULL, complex_id, gh_id, component_id, resource_id, configuration_version);
}

esp_err_t event_mgr_log_command(event_level_t level, const char *code, const char *message,
                                const char *command_id, const char *complex_id, const char *gh_id,
                                const char *component_id, const char *resource_id, uint32_t configuration_version)
{
    return log_internal(level, "COMMAND", code, message, command_id, complex_id, gh_id, component_id,
                        resource_id, configuration_version);
}

static cJSON *event_to_json(const cJSON *src)
{
    if (!src || !cJSON_IsObject(src)) return NULL;
    cJSON *item = cJSON_CreateObject();
    const cJSON *id = cJSON_GetObjectItem(src, "eventId");
    if (!id) id = cJSON_GetObjectItem(src, "id");
    if (id && cJSON_IsString(id)) {
        cJSON_AddStringToObject(item, "eventId", id->valuestring);
        cJSON_AddStringToObject(item, "id", id->valuestring);
    }
    const cJSON *seq = cJSON_GetObjectItem(src, "sequence");
    if (seq && cJSON_IsNumber(seq)) cJSON_AddNumberToObject(item, "sequence", seq->valuedouble);
    const cJSON *ts = cJSON_GetObjectItem(src, "deviceTimestamp");
    if (!ts) ts = cJSON_GetObjectItem(src, "at");
    if (ts && cJSON_IsString(ts)) {
        cJSON_AddStringToObject(item, "deviceTimestamp", ts->valuestring);
        cJSON_AddStringToObject(item, "at", ts->valuestring);
    }
    const cJSON *type = cJSON_GetObjectItem(src, "eventType");
    if (!type) type = cJSON_GetObjectItem(src, "code");
    if (type && cJSON_IsString(type)) {
        cJSON_AddStringToObject(item, "eventType", type->valuestring);
        cJSON_AddStringToObject(item, "code", type->valuestring);
    }
    const cJSON *sev = cJSON_GetObjectItem(src, "severity");
    if (!sev) sev = cJSON_GetObjectItem(src, "level");
    if (sev && cJSON_IsString(sev)) {
        cJSON_AddStringToObject(item, "severity", sev->valuestring);
        cJSON_AddStringToObject(item, "level", sev->valuestring);
    }
    const char *keys[] = {"message", "complexId", "ghId", "greenhouseId", "componentId", "commandId", "resourceId", "deviceId"};
    for (size_t i = 0; i < sizeof(keys)/sizeof(keys[0]); ++i) {
        const cJSON *v = cJSON_GetObjectItem(src, keys[i]);
        if (v && cJSON_IsString(v)) cJSON_AddStringToObject(item, keys[i], v->valuestring);
    }
    const cJSON *cfg = cJSON_GetObjectItem(src, "configurationVersion");
    if (cfg && cJSON_IsNumber(cfg)) cJSON_AddNumberToObject(item, "configurationVersion", cfg->valuedouble);
    const cJSON *payload = cJSON_GetObjectItem(src, "payload");
    cJSON_AddItemToObject(item, "payload", payload ? cJSON_Duplicate(payload, 1) : cJSON_CreateObject());
    return item;
}

cJSON *event_mgr_get_events_json(const char *cursor, int limit)
{
    if (!s_evt_mutex) s_evt_mutex = xSemaphoreCreateMutex();
    if (!s_evt_mutex) return NULL;
    if (limit <= 0 || limit > 200) limit = 50;

    uint64_t after = 0;
    if (cursor && cursor[0]) {
        char *end = NULL;
        errno = 0;
        unsigned long long parsed = strtoull(cursor, &end, 10);
        if (errno == 0 && end && *end == '\0') after = (uint64_t)parsed;
    }

    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");
    cJSON *events = cJSON_AddArrayToObject(root, "events");
    const system_storage_state_t *storage = storage_mgr_get_state();
    cJSON_AddStringToObject(root, "deviceId", storage && storage->device_id[0] ? storage->device_id : "unknown-device");
    cJSON_AddStringToObject(root, "complexId", storage && storage->complex_id[0] ? storage->complex_id : "");
    cJSON_AddBoolToObject(root, "storageAvailable", !s_storage_degraded);
    cJSON_AddBoolToObject(root, "historyTruncated", false);

    char *buf = calloc(1, EVENT_HISTORY_BUFFER_BYTES + 1U);
    size_t len = 0;
    esp_err_t read_err = buf ? storage_mgr_read_event_logs(buf, EVENT_HISTORY_BUFFER_BYTES + 1U, &len) : ESP_ERR_NO_MEM;
    size_t returned = 0;
    uint64_t last_seq = after;
    uint64_t earliest = 0;
    bool more = false;

    if (read_err == ESP_OK && buf && len > 0) {
        if (len >= EVENT_HISTORY_BUFFER_BYTES && buf[len - 1] != '\n') cJSON_AddBoolToObject(root, "historyTruncated", true);
        char *save = NULL;
        for (char *line = strtok_r(buf, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
            cJSON *raw = cJSON_Parse(line);
            if (!raw) continue;
            cJSON *seq_node = cJSON_GetObjectItem(raw, "sequence");
            uint64_t seq = (seq_node && cJSON_IsNumber(seq_node) && seq_node->valuedouble >= 0) ? (uint64_t)seq_node->valuedouble : 0;
            if (seq > 0 && (earliest == 0 || seq < earliest)) earliest = seq;
            if (seq <= after) { cJSON_Delete(raw); continue; }
            if (returned < (size_t)limit) {
                cJSON *item = event_to_json(raw);
                if (item) {
                    cJSON_AddItemToArray(items, item);
                    cJSON_AddItemToArray(events, cJSON_Duplicate(item, 1));
                    returned++;
                    last_seq = seq;
                }
            } else {
                more = true;
                cJSON_Delete(raw);
                break;
            }
            cJSON_Delete(raw);
        }
    } else if (read_err != ESP_OK) {
        s_storage_degraded = true;
    }
    free(buf);

    if (returned == 0 && read_err != ESP_OK) {
        xSemaphoreTake(s_evt_mutex, portMAX_DELAY);
        for (size_t i = 0; i < s_count; ++i) {
            size_t idx = (s_head + EVENT_RING_BUFFER_SIZE - s_count + i) % EVENT_RING_BUFFER_SIZE;
            system_event_t *e = &s_events[idx];
            if (e->seq <= after) continue;
            cJSON *item = cJSON_CreateObject();
            cJSON_AddStringToObject(item, "eventId", e->id);
            cJSON_AddStringToObject(item, "id", e->id);
            cJSON_AddNumberToObject(item, "sequence", (double)e->seq);
            cJSON_AddStringToObject(item, "deviceTimestamp", e->timestamp);
            cJSON_AddStringToObject(item, "at", e->timestamp);
            cJSON_AddStringToObject(item, "eventType", e->code);
            cJSON_AddStringToObject(item, "code", e->code);
            cJSON_AddStringToObject(item, "severity", level_to_str(e->level));
            cJSON_AddStringToObject(item, "level", level_to_str(e->level));
            cJSON_AddStringToObject(item, "message", e->message);
            if (e->complex_id[0]) cJSON_AddStringToObject(item, "complexId", e->complex_id);
            if (e->gh_id[0]) cJSON_AddStringToObject(item, "ghId", e->gh_id);
            if (e->component_id[0]) cJSON_AddStringToObject(item, "componentId", e->component_id);
            if (e->command_id[0]) cJSON_AddStringToObject(item, "commandId", e->command_id);
            if (e->resource_id[0]) cJSON_AddStringToObject(item, "resourceId", e->resource_id);
            if (e->configuration_version) cJSON_AddNumberToObject(item, "configurationVersion", e->configuration_version);
            cJSON_AddItemToObject(item, "payload", cJSON_CreateObject());
            cJSON_AddItemToArray(items, item);
            cJSON_AddItemToArray(events, cJSON_Duplicate(item, 1));
            returned++;
            last_seq = e->seq;
            if (returned >= (size_t)limit) break;
        }
        xSemaphoreGive(s_evt_mutex);
    }

    cJSON_AddNumberToObject(root, "nextSequence", returned ? (double)last_seq : 0);
    cJSON_AddNumberToObject(root, "earliestSequence", (double)earliest);
    cJSON_AddNumberToObject(root, "latestSequence", (double)(s_next_seq > 1 ? s_next_seq - 1 : 0));
    cJSON_AddBoolToObject(root, "hasMore", more);
    if (more) {
        char cursor[32];
        snprintf(cursor, sizeof(cursor), "%" PRIu64, last_seq);
        cJSON_AddStringToObject(root, "nextCursor", cursor);
    }
    else cJSON_AddNullToObject(root, "nextCursor");
    return root;
}
