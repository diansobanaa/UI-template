#include "services/telemetry_mgr.h"
#include "hal/sensor_hal.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "storage/storage_mgr.h"
#include "services/event_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "cJSON.h"
#include <string.h>
#include <strings.h>
#include <time.h>
#include <stdio.h>
#include <stdlib.h>
#include <inttypes.h>
#include <errno.h>

static const char *TAG = "TELEMETRY_MGR";
#define TELEMETRY_SEQUENCE_BLOCK 4096U
#define TELEMETRY_HISTORY_BUFFER_BYTES (512U * 1024U)

static telemetry_snapshot_t s_snapshot = {0};
static SemaphoreHandle_t s_snap_mutex = NULL;
static uint64_t s_next_sequence = 1;
static uint64_t s_sequence_end = 0;
static bool s_storage_degraded = false;
static sensor_state_t s_prev_sensor_state[64];
static bool s_prev_sensor_seen[64];

static const char *sensor_type_name(sensor_type_t type)
{
    switch (type) {
        case SENSOR_TYPE_TEMPERATURE: return "TEMPERATURE";
        case SENSOR_TYPE_HUMIDITY: return "HUMIDITY";
        case SENSOR_TYPE_LIGHT: return "LIGHT";
        case SENSOR_TYPE_LEVEL: return "LEVEL";
        case SENSOR_TYPE_FLOW: return "FLOW";
        case SENSOR_TYPE_PRESSURE: return "PRESSURE";
        case SENSOR_TYPE_PH: return "PH";
        case SENSOR_TYPE_EC: return "EC";
        case SENSOR_TYPE_DOSING_OUTPUT: return "DOSING_OUTPUT";
        default: return "UNKNOWN";
    }
}

static const char *quality_name(sensor_state_t state)
{
    return state == SENSOR_STATE_VALID ? "GOOD" : "BAD";
}

static const char *measurement_name(sensor_state_t state, bool has_value)
{
    if (state == SENSOR_STATE_VALID && has_value) return "MEASURED";
    if (state == SENSOR_STATE_OUT_OF_RANGE || state == SENSOR_STATE_INVALID) return "INVALID";
    return "UNAVAILABLE";
}

static void timestamp_now(char out[32])
{
    time_t now = time(NULL);
    if (now > 0) strftime(out, 32, "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    else strncpy(out, "1970-01-01T00:00:00Z", 32);
}

static uint64_t allocate_sequence(void)
{
    if (s_next_sequence > s_sequence_end) {
        uint64_t first = 0;
        if (storage_mgr_reserve_sequence_block("telemetry_seq_end", TELEMETRY_SEQUENCE_BLOCK, &first) == ESP_OK) {
            s_next_sequence = first;
            s_sequence_end = first + TELEMETRY_SEQUENCE_BLOCK - 1U;
        } else {
            s_storage_degraded = true;
        }
    }
    return s_next_sequence++;
}

static bool component_matches_gh(const hw_component_info_t *info, const char *greenhouse_id)
{
    if (!greenhouse_id || !greenhouse_id[0]) return true;
    return info && strcmp(info->assignment.gh_id, greenhouse_id) == 0;
}

static void add_sensor_sample(cJSON *samples, const sensor_descriptor_t *descriptor,
                              const sensor_component_sample_t *sample,
                              const hw_component_info_t *info,
                              const char *device_timestamp)
{
    cJSON *item = cJSON_CreateObject();
    cJSON_AddStringToObject(item, "componentId", descriptor->sensor_id);
    cJSON_AddStringToObject(item, "metricId", sensor_type_name(descriptor->sensor_type));
    if (info && info->assignment.gh_id[0]) cJSON_AddStringToObject(item, "ghId", info->assignment.gh_id);
    cJSON_AddStringToObject(item, "deviceTimestamp", device_timestamp);
    cJSON_AddStringToObject(item, "source", descriptor->source);
    cJSON_AddStringToObject(item, "unit", descriptor->unit);
    cJSON_AddStringToObject(item, "quality", quality_name(sample->state));
    cJSON_AddStringToObject(item, "measurementType", measurement_name(sample->state, sample->has_value));
    if (sample->has_value && sample->state == SENSOR_STATE_VALID) cJSON_AddNumberToObject(item, "value", sample->value);
    else cJSON_AddNullToObject(item, "value");
    if (descriptor->calibration_reference[0]) cJSON_AddStringToObject(item, "calibrationId", descriptor->calibration_reference);
    else cJSON_AddNullToObject(item, "calibrationId");
    if (descriptor->calibration_version > 0) cJSON_AddNumberToObject(item, "calibrationVersion", descriptor->calibration_version);
    else cJSON_AddNullToObject(item, "calibrationVersion");
    cJSON_AddItemToArray(samples, item);
}

static cJSON *build_current_json(const char *greenhouse_id, uint64_t sequence, const char *timestamp)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    const char *device_id = st && st->device_id[0] ? st->device_id : "unknown-device";
    cJSON *root = cJSON_CreateObject();
    if (!root) return NULL;
    char record_id[96];
    snprintf(record_id, sizeof(record_id), "%s:telemetry:%" PRIu64, device_id, sequence);
    cJSON_AddStringToObject(root, "recordType", "TELEMETRY");
    cJSON_AddStringToObject(root, "recordId", record_id);
    cJSON_AddStringToObject(root, "deviceId", device_id);
    cJSON_AddStringToObject(root, "complexId", st && st->complex_id[0] ? st->complex_id : "");
    if (greenhouse_id && greenhouse_id[0]) cJSON_AddStringToObject(root, "ghId", greenhouse_id);
    else cJSON_AddNullToObject(root, "ghId");
    cJSON_AddNumberToObject(root, "sequence", (double)sequence);
    cJSON_AddStringToObject(root, "deviceTimestamp", timestamp);
    cJSON_AddStringToObject(root, "timestamp", timestamp);
    cJSON_AddBoolToObject(root, "clockSynchronized", time(NULL) >= 1704067200);
    cJSON_AddNumberToObject(root, "staleAfterSeconds", 15);
    cJSON_AddBoolToObject(root, "storageAvailable", !s_storage_degraded);

    cJSON *samples = cJSON_AddArrayToObject(root, "samples");
    sensor_descriptor_t descriptors[64];
    size_t count = sensor_hal_list_configured(descriptors, 64);
    for (size_t i = 0; i < count; ++i) {
        hw_component_info_t info;
        if (hardware_registry_find_by_id(descriptors[i].sensor_id, &info) != ESP_OK) continue;
        if (!component_matches_gh(&info, greenhouse_id)) continue;
        sensor_component_sample_t sample;
        if (sensor_hal_get_component_sample(descriptors[i].sensor_id, &sample) != ESP_OK) {
            memset(&sample, 0, sizeof(sample));
            sample.state = SENSOR_STATE_INVALID;
        }
        add_sensor_sample(samples, &descriptors[i], &sample, &info, timestamp);
    }

    /* Compatibility summary: only measured values are exposed; unavailable is null. */
    cJSON *component_states = cJSON_AddArrayToObject(root, "componentStates");
    for (size_t i = 0; i < hardware_registry_get_count(); ++i) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) != ESP_OK) continue;
        if (greenhouse_id && greenhouse_id[0] && strcmp(info.assignment.gh_id, greenhouse_id) != 0) continue;
        if (!info.role[0]) continue;
        bool on = false; actuator_owner_t owner = ACTUATOR_OWNER_NONE; uint32_t runtime = 0;
        (void)actuator_hal_get_component_status(info.component_id, &on, &owner, &runtime);
        cJSON *state = cJSON_CreateObject();
        cJSON_AddStringToObject(state, "componentId", info.component_id);
        cJSON_AddStringToObject(state, "role", info.role);
        cJSON_AddBoolToObject(state, "on", on);
        cJSON_AddNumberToObject(state, "runtimeSec", runtime);
        if (info.resource_id[0]) cJSON_AddStringToObject(state, "resourceId", info.resource_id);
        if (info.assignment.gh_id[0]) cJSON_AddStringToObject(state, "ghId", info.assignment.gh_id);
        else cJSON_AddNullToObject(state, "ghId");
        cJSON_AddItemToArray(component_states, state);
    }

    cJSON *values = cJSON_AddObjectToObject(root, "values");
    cJSON_AddNullToObject(values, "temperatureC");
    cJSON_AddNullToObject(values, "humidityPct");
    cJSON_AddNullToObject(values, "lightLux");
    cJSON_AddNullToObject(values, "waterLevelPct");
    cJSON_AddNullToObject(values, "flowRateLpm");
    cJSON_AddNullToObject(values, "totalLiters");
    for (size_t i = 0; i < count; ++i) {
        hw_component_info_t info;
        if (hardware_registry_find_by_id(descriptors[i].sensor_id, &info) != ESP_OK || !component_matches_gh(&info, greenhouse_id)) continue;
        sensor_component_sample_t sample;
        if (sensor_hal_get_component_sample(descriptors[i].sensor_id, &sample) != ESP_OK || !sample.has_value || sample.state != SENSOR_STATE_VALID) continue;
        switch (descriptors[i].sensor_type) {
            case SENSOR_TYPE_TEMPERATURE: cJSON_ReplaceItemInObject(values, "temperatureC", cJSON_CreateNumber(sample.value)); break;
            case SENSOR_TYPE_HUMIDITY: cJSON_ReplaceItemInObject(values, "humidityPct", cJSON_CreateNumber(sample.value)); break;
            case SENSOR_TYPE_LIGHT: cJSON_ReplaceItemInObject(values, "lightLux", cJSON_CreateNumber(sample.value)); break;
            case SENSOR_TYPE_LEVEL: cJSON_ReplaceItemInObject(values, "waterLevelPct", cJSON_CreateNumber(sample.value)); break;
            case SENSOR_TYPE_FLOW: cJSON_ReplaceItemInObject(values, "flowRateLpm", cJSON_CreateNumber(sample.value)); break;
            default: break;
        }
    }

    return root;
}

static esp_err_t persist_current(void)
{
    telemetry_snapshot_t snap;
    if (telemetry_mgr_get_snapshot(&snap) != ESP_OK) return ESP_ERR_INVALID_STATE;
    cJSON *root = build_current_json(NULL, snap.sequence, snap.timestamp);
    if (!root) return ESP_ERR_NO_MEM;
    char *serialized = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!serialized) return ESP_ERR_NO_MEM;
    esp_err_t err = storage_mgr_append_telemetry_log(serialized);
    free(serialized);
    if (err != ESP_OK) s_storage_degraded = true;
    return err;
}

static void telemetry_sampler_task(void *pvParameters)
{
    (void)pvParameters;
    ESP_LOGI(TAG, "Telemetry sampler task started at priority %d", TASK_TELEMETRY_PRIO);
    while (1) {
        sensor_hal_poll();
        sensor_readings_t sensors;
        sensor_hal_get_readings(&sensors);

        sensor_descriptor_t descriptors[64];
        size_t descriptor_count = sensor_hal_list_configured(descriptors, 64);
        const system_storage_state_t *storage = storage_mgr_get_state();
        const char *complex_id = storage && storage->complex_id[0] ? storage->complex_id : NULL;
        for (size_t i = 0; i < descriptor_count; ++i) {
            sensor_component_sample_t sample;
            esp_err_t sample_err = sensor_hal_get_component_sample(descriptors[i].sensor_id, &sample);
            sensor_state_t current_state = (sample_err == ESP_OK) ? sample.state : SENSOR_STATE_INVALID;
            if (s_prev_sensor_seen[i] && s_prev_sensor_state[i] == SENSOR_STATE_VALID && current_state != SENSOR_STATE_VALID) {
                hw_component_info_t info;
                const char *gh_id = NULL;
                const char *resource_id = NULL;
                if (hardware_registry_find_by_id(descriptors[i].sensor_id, &info) == ESP_OK) {
                    gh_id = info.assignment.gh_id[0] ? info.assignment.gh_id : NULL;
                    resource_id = info.resource_id[0] ? info.resource_id : NULL;
                }
                char message[128];
                snprintf(message, sizeof(message), "Sensor '%s' transitioned to state %d.", descriptors[i].sensor_id, (int)current_state);
                (void)event_mgr_log_context(LOG_LEVEL_ERROR, "SENSOR", "SENSOR_FAULT", message, complex_id, gh_id, descriptors[i].sensor_id, resource_id, storage ? storage->config_version : 0);
            } else if (s_prev_sensor_seen[i] && s_prev_sensor_state[i] != SENSOR_STATE_VALID && current_state == SENSOR_STATE_VALID) {
                hw_component_info_t info;
                const char *gh_id = NULL;
                const char *resource_id = NULL;
                if (hardware_registry_find_by_id(descriptors[i].sensor_id, &info) == ESP_OK) {
                    gh_id = info.assignment.gh_id[0] ? info.assignment.gh_id : NULL;
                    resource_id = info.resource_id[0] ? info.resource_id : NULL;
                }
                (void)event_mgr_log_context(LOG_LEVEL_INFO, "SENSOR", "SENSOR_RECOVERED", "Sensor returned to a valid reading state.", complex_id, gh_id, descriptors[i].sensor_id, resource_id, storage ? storage->config_version : 0);
            }
            s_prev_sensor_state[i] = current_state;
            s_prev_sensor_seen[i] = true;
        }

        xSemaphoreTake(s_snap_mutex, portMAX_DELAY);
        s_snapshot.sequence = allocate_sequence();
        timestamp_now(s_snapshot.timestamp);
        s_snapshot.temp_valid = (sensors.temp_state == SENSOR_STATE_VALID);
        s_snapshot.temperature_c = sensors.temperature_c;
        s_snapshot.humidity_pct = 0.0f;
        s_snapshot.humidity_valid = false;
        s_snapshot.light_lux = 0.0f;
        s_snapshot.light_valid = false;
        s_snapshot.float_lower_ok = sensors.float_lower_ok;
        s_snapshot.water_level_pct = sensors.float_lower_ok ? 100.0f : 0.0f;
        s_snapshot.flow_rate_lpm = sensors.flow_rate_fert_fs400a_lpm;
        s_snapshot.total_liters = sensors.total_liters_fert_fs400a;
        s_snapshot.well_pump_on = actuator_hal_get_state(ACTUATOR_WELL_PUMP);
        s_snapshot.dist_pump_on = actuator_hal_get_state(ACTUATOR_DIST_PUMP);
        s_snapshot.raw_submersible_on = actuator_hal_get_state(ACTUATOR_RAW_SUBMERSIBLE);
        s_snapshot.mixing_pump_on = actuator_hal_get_state(ACTUATOR_MIXING_PUMP);
        s_snapshot.dosing_a_on = actuator_hal_get_state(ACTUATOR_DOSING_A);
        s_snapshot.dosing_b_on = actuator_hal_get_state(ACTUATOR_DOSING_B);
        s_snapshot.fan_on = actuator_hal_get_state(ACTUATOR_COOLING_FAN);
        s_snapshot.error_lamp_on = actuator_hal_get_state(ACTUATOR_ERROR_LAMP);
        xSemaphoreGive(s_snap_mutex);

        esp_err_t persist_err = persist_current();
        if (persist_err != ESP_OK) ESP_LOGW(TAG, "Telemetry persistence degraded: 0x%x", persist_err);
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

esp_err_t telemetry_mgr_init(void)
{
    if (s_snap_mutex) return ESP_OK;
    s_snap_mutex = xSemaphoreCreateMutex();
    if (!s_snap_mutex) return ESP_ERR_NO_MEM;
    uint64_t first = 0;
    if (storage_mgr_reserve_sequence_block("telemetry_seq_end", TELEMETRY_SEQUENCE_BLOCK, &first) == ESP_OK) {
        s_next_sequence = first;
        s_sequence_end = first + TELEMETRY_SEQUENCE_BLOCK - 1U;
    } else {
        s_storage_degraded = true;
    }
    xTaskCreatePinnedToCore(telemetry_sampler_task, "telemetry_task", TASK_TELEMETRY_STACK, NULL, TASK_TELEMETRY_PRIO, NULL, 1);
    ESP_LOGI(TAG, "Telemetry manager initialized with durable history.");
    return ESP_OK;
}

esp_err_t telemetry_mgr_get_snapshot(telemetry_snapshot_t *out_snap)
{
    if (!out_snap) return ESP_ERR_INVALID_ARG;
    if (!s_snap_mutex) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_snap_mutex, portMAX_DELAY);
    *out_snap = s_snapshot;
    xSemaphoreGive(s_snap_mutex);
    return ESP_OK;
}

cJSON *telemetry_mgr_to_json(const char *greenhouse_id)
{
    telemetry_snapshot_t snap;
    if (telemetry_mgr_get_snapshot(&snap) != ESP_OK) return NULL;
    return build_current_json(greenhouse_id, snap.sequence, snap.timestamp);
}

static uint64_t parse_cursor(const char *value)
{
    if (!value || !value[0]) return 0;
    char *end = NULL;
    errno = 0;
    unsigned long long v = strtoull(value, &end, 10);
    if (errno != 0 || !end || *end != '\0') return 0;
    return (uint64_t)v;
}

cJSON *telemetry_mgr_get_history_json(const char *greenhouse_id, const char *after_sequence, int limit)
{
    if (limit <= 0 || limit > 100) limit = 50;
    uint64_t after = parse_cursor(after_sequence);
    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON_AddStringToObject(root, "deviceId", st && st->device_id[0] ? st->device_id : "unknown-device");
    cJSON_AddStringToObject(root, "complexId", st && st->complex_id[0] ? st->complex_id : "");
    if (greenhouse_id && greenhouse_id[0]) cJSON_AddStringToObject(root, "ghId", greenhouse_id);
    else cJSON_AddNullToObject(root, "ghId");
    cJSON_AddBoolToObject(root, "storageAvailable", !s_storage_degraded);

    char *buf = calloc(1, TELEMETRY_HISTORY_BUFFER_BYTES + 1U);
    size_t len = 0;
    esp_err_t err = buf ? storage_mgr_read_telemetry_logs(buf, TELEMETRY_HISTORY_BUFFER_BYTES + 1U, &len) : ESP_ERR_NO_MEM;
    uint64_t last = after;
    uint64_t earliest = 0;
    bool more = false;
    size_t returned = 0;
    if (err == ESP_OK && buf) {
        if (len >= TELEMETRY_HISTORY_BUFFER_BYTES && len > 0 && buf[len - 1] != '\n') cJSON_AddBoolToObject(root, "historyTruncated", true);
        cJSON_AddBoolToObject(root, "historyTruncated", len >= TELEMETRY_HISTORY_BUFFER_BYTES && len > 0 && buf[len - 1] != '\n');
        char *save = NULL;
        for (char *line = strtok_r(buf, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
            cJSON *raw = cJSON_Parse(line);
            if (!raw) continue;
            cJSON *seq = cJSON_GetObjectItem(raw, "sequence");
            uint64_t sequence = seq && cJSON_IsNumber(seq) ? (uint64_t)seq->valuedouble : 0;
            if (sequence > 0 && (earliest == 0 || sequence < earliest)) earliest = sequence;
            if (sequence <= after) { cJSON_Delete(raw); continue; }
            if (returned >= (size_t)limit) { more = true; cJSON_Delete(raw); break; }
            if (greenhouse_id && greenhouse_id[0]) {
                cJSON *filtered = cJSON_CreateObject();
                cJSON *samples = cJSON_AddArrayToObject(filtered, "samples");
                cJSON *raw_samples = cJSON_GetObjectItem(raw, "samples");
                if (raw_samples && cJSON_IsArray(raw_samples)) {
                    cJSON *sample = NULL;
                    cJSON_ArrayForEach(sample, raw_samples) {
                        cJSON *gh = cJSON_GetObjectItem(sample, "ghId");
                        if (gh && cJSON_IsString(gh) && strcmp(gh->valuestring, greenhouse_id) == 0)
                            cJSON_AddItemToArray(samples, cJSON_Duplicate(sample, 1));
                    }
                }
                const char *copy_keys[] = {"recordType","recordId","deviceId","complexId","ghId","sequence","deviceTimestamp","timestamp","clockSynchronized","staleAfterSeconds","storageAvailable"};
                for (size_t k = 0; k < sizeof(copy_keys)/sizeof(copy_keys[0]); ++k) {
                    cJSON *v = cJSON_GetObjectItem(raw, copy_keys[k]);
                    if (v) cJSON_AddItemToObject(filtered, copy_keys[k], cJSON_Duplicate(v, 1));
                }
                cJSON_Delete(raw);
                raw = filtered;
            }
            cJSON_AddItemToArray(items, raw);
            returned++;
            last = sequence;
        }
    } else if (err != ESP_OK) {
        s_storage_degraded = true;
    }
    free(buf);
    cJSON_AddNumberToObject(root, "nextSequence", (double)last);
    cJSON_AddNumberToObject(root, "earliestSequence", (double)earliest);
    cJSON_AddNumberToObject(root, "latestSequence", (double)(s_next_sequence > 1 ? s_next_sequence - 1 : 0));
    cJSON_AddBoolToObject(root, "hasMore", more);
    if (more) {
        char cursor[32];
        snprintf(cursor, sizeof(cursor), "%" PRIu64, last);
        cJSON_AddStringToObject(root, "nextCursor", cursor);
    } else cJSON_AddNullToObject(root, "nextCursor");
    return root;
}
