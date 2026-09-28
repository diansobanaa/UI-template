#include "services/telemetry_mgr.h"
#include "hal/sensor_hal.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "hal/sdcard_hal.h"
#include "storage/storage_mgr.h"
#include "services/event_mgr.h"
#include "storage/telemetry_store.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_task_wdt.h"
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
#define TELEMETRY_HISTORY_BUFFER_BYTES (64U * 1024U)

static telemetry_snapshot_t s_snapshot = {0};
static StaticSemaphore_t s_snap_mutex_buf;
static SemaphoreHandle_t s_snap_mutex = NULL;
static uint64_t s_next_sequence = 1;
static uint64_t s_sequence_end = 0;
static bool s_storage_degraded = false;
typedef struct {
    char sensor_id[32];
    uint8_t fail_streak;      /* Consecutive failure count */
    bool fault_latched;       /* True if SENSOR_FAULT event has been logged */
    bool ever_seen;           /* True if sensor has been sampled at least once */
} sensor_fault_latch_t;

#define MAX_SENSOR_LATCHES 32
static sensor_fault_latch_t s_sensor_latches[MAX_SENSOR_LATCHES];

static sensor_fault_latch_t *get_sensor_latch(const char *sensor_id)
{
    if (!sensor_id || !sensor_id[0]) return NULL;
    for (size_t i = 0; i < MAX_SENSOR_LATCHES; ++i) {
        if (s_sensor_latches[i].sensor_id[0] &&
            strncmp(s_sensor_latches[i].sensor_id, sensor_id, sizeof(s_sensor_latches[i].sensor_id)) == 0) {
            return &s_sensor_latches[i];
        }
    }
    for (size_t i = 0; i < MAX_SENSOR_LATCHES; ++i) {
        if (!s_sensor_latches[i].sensor_id[0]) {
            strncpy(s_sensor_latches[i].sensor_id, sensor_id, sizeof(s_sensor_latches[i].sensor_id) - 1);
            s_sensor_latches[i].sensor_id[sizeof(s_sensor_latches[i].sensor_id) - 1] = '\0';
            return &s_sensor_latches[i];
        }
    }
    return NULL;
}

/* Bounded RAM Ring Buffer */
static telemetry_snapshot_t s_ring_buffer[TELEMETRY_RING_CAPACITY];
static size_t s_ring_head = 0;
static size_t s_ring_count = 0;
static uint32_t s_dropped_samples = 0;
static StaticSemaphore_t s_ring_mutex_buf;
static SemaphoreHandle_t s_ring_mutex = NULL;

/* Process active state tracker */
static bool s_prev_process_active = false;

/* Daily Temperature Tracking for TFT Overview */
static float s_today_temp_min = 999.0f;
static float s_today_temp_max = -999.0f;
static bool s_today_temp_valid = false;
static int s_today_temp_day = -1;

/* External hook for WebSocket immediate frame trigger */
extern void telemetry_stream_on_transition(const char *reason);

void telemetry_mgr_trigger_transition(const char *reason)
{
    ESP_LOGI(TAG, "Telemetry cadence transition triggered: %s", reason ? reason : "unknown");
    telemetry_stream_on_transition(reason);
}

uint32_t telemetry_mgr_get_dropped_count(void)
{
    return s_dropped_samples;
}

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

static void timestamp_now(char out[32], int64_t *out_ms)
{
    int64_t now_us = esp_timer_get_time();
    time_t now = time(NULL);
    if (out_ms) *out_ms = (int64_t)now * 1000 + (now_us % 1000000) / 1000;
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

esp_err_t telemetry_mgr_get_active_process(telemetry_active_process_t *out_proc)
{
    if (!out_proc) return ESP_ERR_INVALID_ARG;
    memset(out_proc, 0, sizeof(*out_proc));

    bool dosing_a = actuator_hal_get_state(ACTUATOR_DOSING_A);
    bool dosing_b = actuator_hal_get_state(ACTUATOR_DOSING_B);
    bool well_pump = actuator_hal_get_state(ACTUATOR_WELL_PUMP);
    bool raw_pump = actuator_hal_get_state(ACTUATOR_RAW_SUBMERSIBLE);

    char triggers[128] = {0};
    bool is_active = false;

    if (dosing_a || dosing_b) {
        is_active = true;
        if (dosing_a && dosing_b) strncpy(triggers, "DOSING_PUMP_A_ACTIVE,DOSING_PUMP_B_ACTIVE", sizeof(triggers) - 1);
        else if (dosing_a) strncpy(triggers, "DOSING_PUMP_A_ACTIVE", sizeof(triggers) - 1);
        else strncpy(triggers, "DOSING_PUMP_B_ACTIVE", sizeof(triggers) - 1);
    }
    if (well_pump || raw_pump) {
        is_active = true;
        if (triggers[0]) strncat(triggers, ",", sizeof(triggers) - strlen(triggers) - 1);
        if (well_pump) strncat(triggers, "WELL_PUMP_ACTIVE", sizeof(triggers) - strlen(triggers) - 1);
        if (raw_pump) strncat(triggers, "RAW_PUMP_ACTIVE", sizeof(triggers) - strlen(triggers) - 1);
    }

    out_proc->is_active = is_active;
    out_proc->cadence_sec = is_active ? 3 : 10;
    strncpy(out_proc->stream_mode, is_active ? "PROCESS_ACTIVE" : "IDLE", sizeof(out_proc->stream_mode) - 1);
    strncpy(out_proc->active_triggers, triggers, sizeof(out_proc->active_triggers) - 1);
    return ESP_OK;
}

static cJSON *build_current_json_from_snap(const char *greenhouse_id, const telemetry_snapshot_t *snap)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    const char *device_id = st && st->device_id[0] ? st->device_id : "unknown-device";
    cJSON *root = cJSON_CreateObject();
    if (!root) return NULL;
    char record_id[96];
    snprintf(record_id, sizeof(record_id), "%s:telemetry:%" PRIu64, device_id, snap->sequence);
    cJSON_AddStringToObject(root, "recordType", "TELEMETRY");
    cJSON_AddStringToObject(root, "recordId", record_id);
    cJSON_AddStringToObject(root, "deviceId", device_id);
    cJSON_AddStringToObject(root, "complexId", st && st->complex_id[0] ? st->complex_id : "");
    if (greenhouse_id && greenhouse_id[0]) cJSON_AddStringToObject(root, "ghId", greenhouse_id);
    else cJSON_AddNullToObject(root, "ghId");
    cJSON_AddNumberToObject(root, "sequence", (double)snap->sequence);
    cJSON_AddStringToObject(root, "deviceTimestamp", snap->timestamp);
    cJSON_AddStringToObject(root, "timestamp", snap->timestamp);
    cJSON_AddBoolToObject(root, "clockSynchronized", time(NULL) >= 1704067200);
    cJSON_AddNumberToObject(root, "staleAfterSeconds", 15);
    cJSON_AddBoolToObject(root, "storageAvailable", !s_storage_degraded);

    /* Operational process mode */
    telemetry_active_process_t proc;
    telemetry_mgr_get_active_process(&proc);
    cJSON_AddStringToObject(root, "streamMode", proc.stream_mode);
    cJSON_AddNumberToObject(root, "cadenceSec", proc.cadence_sec);
    if (proc.active_triggers[0]) {
        cJSON *trigs = cJSON_AddArrayToObject(root, "activeTriggers");
        char trigs_copy[128];
        strncpy(trigs_copy, proc.active_triggers, sizeof(trigs_copy) - 1);
        char *saveptr = NULL;
        for (char *tok = strtok_r(trigs_copy, ",", &saveptr); tok; tok = strtok_r(NULL, ",", &saveptr)) {
            cJSON_AddItemToArray(trigs, cJSON_CreateString(tok));
        }
    } else {
        cJSON_AddArrayToObject(root, "activeTriggers");
    }

    cJSON *samples = cJSON_AddArrayToObject(root, "samples");
    sensor_descriptor_t *descriptors = NULL;
    size_t count = 0;
    if (hardware_registry_get_count() > 0) {
        descriptors = calloc(16, sizeof(sensor_descriptor_t));
        if (descriptors) count = sensor_hal_list_configured(descriptors, 16);
    }
    for (size_t i = 0; i < count; ++i) {
        hw_component_info_t info;
        if (hardware_registry_find_by_id(descriptors[i].sensor_id, &info) != ESP_OK) continue;
        if (!component_matches_gh(&info, greenhouse_id)) continue;
        sensor_component_sample_t sample;
        if (sensor_hal_get_component_sample(descriptors[i].sensor_id, &sample) != ESP_OK) {
            memset(&sample, 0, sizeof(sample));
            sample.state = SENSOR_STATE_INVALID;
        }
        add_sensor_sample(samples, &descriptors[i], &sample, &info, snap->timestamp);
    }

    /* Actuator states */
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
    if (snap->temp_valid) {
        cJSON_AddNumberToObject(values, "temperatureC", snap->temperature_c);
        cJSON_AddNumberToObject(values, "temperatureAirC", snap->temperature_c);
    } else {
        cJSON_AddNullToObject(values, "temperatureC");
        cJSON_AddNullToObject(values, "temperatureAirC");
    }
    if (snap->temp_water_valid) cJSON_AddNumberToObject(values, "temperatureWaterC", snap->temperature_water_c);
    else cJSON_AddNullToObject(values, "temperatureWaterC");
    if (snap->humidity_valid) cJSON_AddNumberToObject(values, "humidityPct", snap->humidity_pct);
    else cJSON_AddNullToObject(values, "humidityPct");
    if (snap->light_valid) cJSON_AddNumberToObject(values, "lightLux", snap->light_lux);
    else cJSON_AddNullToObject(values, "lightLux");
    cJSON_AddNumberToObject(values, "waterLevelPct", snap->water_level_pct);
    cJSON_AddNumberToObject(values, "flowRateLpm", snap->flow_rate_lpm);
    cJSON_AddNumberToObject(values, "totalLiters", snap->total_liters);

    if (descriptors) free(descriptors);
    return root;
}

cJSON *telemetry_mgr_get_current_ram_json(const char *greenhouse_id)
{
    telemetry_snapshot_t snap;
    if (telemetry_mgr_get_snapshot(&snap) != ESP_OK) return NULL;
    return build_current_json_from_snap(greenhouse_id, &snap);
}

cJSON *telemetry_mgr_to_json(const char *greenhouse_id)
{
    return telemetry_mgr_get_current_ram_json(greenhouse_id);
}

cJSON *telemetry_mgr_build_stream_batch_json(const char *greenhouse_id, uint64_t from_seq, int max_samples)
{
    if (max_samples <= 0 || max_samples > 64) max_samples = 16;

    const system_storage_state_t *st = storage_mgr_get_state();
    const char *device_id = st && st->device_id[0] ? st->device_id : "unknown-device";
    const char *complex_id = st && st->complex_id[0] ? st->complex_id : "";

    telemetry_active_process_t proc;
    telemetry_mgr_get_active_process(&proc);

    cJSON *root = cJSON_CreateObject();
    if (!root) return NULL;

    cJSON_AddStringToObject(root, "type", "telemetry_batch");
    cJSON_AddNumberToObject(root, "schemaVersion", 1);
    cJSON_AddStringToObject(root, "deviceId", device_id);
    cJSON_AddStringToObject(root, "complexId", complex_id);
    cJSON_AddStringToObject(root, "streamMode", proc.stream_mode);
    cJSON_AddNumberToObject(root, "cadenceSec", proc.cadence_sec);

    cJSON *trigs = cJSON_AddArrayToObject(root, "activeTriggers");
    if (proc.active_triggers[0]) {
        char trigs_copy[128];
        strncpy(trigs_copy, proc.active_triggers, sizeof(trigs_copy) - 1);
        char *saveptr = NULL;
        for (char *tok = strtok_r(trigs_copy, ",", &saveptr); tok; tok = strtok_r(NULL, ",", &saveptr)) {
            cJSON_AddItemToArray(trigs, cJSON_CreateString(tok));
        }
    }

    cJSON *samples_arr = cJSON_AddArrayToObject(root, "samples");
    uint64_t start_seq = 0;
    uint64_t end_seq = 0;
    char from_ts[32] = {0};
    char to_ts[32] = {0};
    int gathered = 0;

    /* Pull from RAM ring buffer.
     * HEAP-FIX (audit 2026-09-28): telemetry_snapshot_t local_items[16]
     * (1728 B) lived on the caller's stack (tele_stream_task and the httpd
     * worker both run on 4096-byte stacks). Move it to PSRAM heap.
     * Deliberately, NO task stack size is changed by this patch. */
    telemetry_snapshot_t *local_items =
        (telemetry_snapshot_t *)heap_caps_malloc(16 * sizeof(telemetry_snapshot_t),
                                                 MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    int local_count = 0;

    if (local_items && s_ring_mutex && xSemaphoreTake(s_ring_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        size_t count = s_ring_count;
        size_t head = s_ring_head;
        size_t start_idx = (head + TELEMETRY_RING_CAPACITY - count) % TELEMETRY_RING_CAPACITY;

        for (size_t i = 0; i < count && local_count < max_samples && local_count < 16; i++) {
            size_t idx = (start_idx + i) % TELEMETRY_RING_CAPACITY;
            if (from_seq > 0 && s_ring_buffer[idx].sequence <= from_seq) continue;
            local_items[local_count++] = s_ring_buffer[idx];
        }
        xSemaphoreGive(s_ring_mutex);
    }

    for (int i = 0; i < local_count; i++) {
        const telemetry_snapshot_t *item = &local_items[i];
        if (start_seq == 0) {
            start_seq = item->sequence;
            strncpy(from_ts, item->timestamp, sizeof(from_ts) - 1);
        }
        end_seq = item->sequence;
        strncpy(to_ts, item->timestamp, sizeof(to_ts) - 1);

        cJSON *sample_obj = cJSON_CreateObject();
        cJSON_AddNumberToObject(sample_obj, "sequence", (double)item->sequence);
        cJSON_AddStringToObject(sample_obj, "timestamp", item->timestamp);
        cJSON_AddStringToObject(sample_obj, "deviceTimestamp", item->timestamp);
        if (item->temp_valid) {
            cJSON_AddNumberToObject(sample_obj, "temperatureC", item->temperature_c);
            cJSON_AddNumberToObject(sample_obj, "temperatureAirC", item->temperature_c);
        } else {
            cJSON_AddNullToObject(sample_obj, "temperatureC");
            cJSON_AddNullToObject(sample_obj, "temperatureAirC");
        }
        if (item->temp_water_valid) cJSON_AddNumberToObject(sample_obj, "temperatureWaterC", item->temperature_water_c);
        else cJSON_AddNullToObject(sample_obj, "temperatureWaterC");
        if (item->humidity_valid) cJSON_AddNumberToObject(sample_obj, "humidityPct", item->humidity_pct);
        else cJSON_AddNullToObject(sample_obj, "humidityPct");
        if (item->light_valid) cJSON_AddNumberToObject(sample_obj, "lightLux", item->light_lux);
        else cJSON_AddNullToObject(sample_obj, "lightLux");
        cJSON_AddNumberToObject(sample_obj, "waterLevelPct", item->water_level_pct);
        cJSON_AddNumberToObject(sample_obj, "flowRateLpm", item->flow_rate_lpm);
        cJSON_AddNumberToObject(sample_obj, "totalLiters", item->total_liters);

        cJSON *actuators = cJSON_AddObjectToObject(sample_obj, "actuators");
        cJSON_AddBoolToObject(actuators, "wellPump", item->well_pump_on);
        cJSON_AddBoolToObject(actuators, "distPump", item->dist_pump_on);
        cJSON_AddBoolToObject(actuators, "rawSubmersible", item->raw_submersible_on);
        cJSON_AddBoolToObject(actuators, "mixingPump", item->mixing_pump_on);
        cJSON_AddBoolToObject(actuators, "dosingA", item->dosing_a_on);
        cJSON_AddBoolToObject(actuators, "dosingB", item->dosing_b_on);
        cJSON_AddBoolToObject(actuators, "coolingFan", item->fan_on);

        cJSON_AddItemToArray(samples_arr, sample_obj);
        gathered++;
    }

    /* Fallback: if ring had no newer sample, include the latest snapshot */
    if (gathered == 0) {
        telemetry_snapshot_t latest;
        if (telemetry_mgr_get_snapshot(&latest) == ESP_OK) {
            start_seq = latest.sequence;
            end_seq = latest.sequence;
            strncpy(from_ts, latest.timestamp, sizeof(from_ts) - 1);
            strncpy(to_ts, latest.timestamp, sizeof(to_ts) - 1);

            cJSON *sample_obj = cJSON_CreateObject();
            cJSON_AddNumberToObject(sample_obj, "sequence", (double)latest.sequence);
            cJSON_AddStringToObject(sample_obj, "timestamp", latest.timestamp);
            cJSON_AddStringToObject(sample_obj, "deviceTimestamp", latest.timestamp);
            if (latest.temp_valid) {
                cJSON_AddNumberToObject(sample_obj, "temperatureC", latest.temperature_c);
                cJSON_AddNumberToObject(sample_obj, "temperatureAirC", latest.temperature_c);
            } else {
                cJSON_AddNullToObject(sample_obj, "temperatureC");
                cJSON_AddNullToObject(sample_obj, "temperatureAirC");
            }
            if (latest.temp_water_valid) cJSON_AddNumberToObject(sample_obj, "temperatureWaterC", latest.temperature_water_c);
            else cJSON_AddNullToObject(sample_obj, "temperatureWaterC");
            if (latest.humidity_valid) cJSON_AddNumberToObject(sample_obj, "humidityPct", latest.humidity_pct);
            else cJSON_AddNullToObject(sample_obj, "humidityPct");
            cJSON_AddNumberToObject(sample_obj, "waterLevelPct", latest.water_level_pct);
            cJSON_AddNumberToObject(sample_obj, "flowRateLpm", latest.flow_rate_lpm);
            cJSON_AddNumberToObject(sample_obj, "totalLiters", latest.total_liters);

            cJSON *actuators = cJSON_AddObjectToObject(sample_obj, "actuators");
            cJSON_AddBoolToObject(actuators, "wellPump", latest.well_pump_on);
            cJSON_AddBoolToObject(actuators, "distPump", latest.dist_pump_on);
            cJSON_AddBoolToObject(actuators, "rawSubmersible", latest.raw_submersible_on);
            cJSON_AddBoolToObject(actuators, "dosingA", latest.dosing_a_on);
            cJSON_AddBoolToObject(actuators, "dosingB", latest.dosing_b_on);
            cJSON_AddBoolToObject(actuators, "coolingFan", latest.fan_on);

            cJSON_AddItemToArray(samples_arr, sample_obj);
        }
    }

    cJSON_AddNumberToObject(root, "sequenceStart", (double)start_seq);
    cJSON_AddNumberToObject(root, "sequenceEnd", (double)end_seq);
    cJSON_AddStringToObject(root, "fromTs", from_ts[0] ? from_ts : "");
    cJSON_AddStringToObject(root, "toTs", to_ts[0] ? to_ts : "");
    cJSON_AddNumberToObject(root, "droppedBeforeSequence", (double)s_dropped_samples);
    heap_caps_free(local_items); /* safe when NULL; then the fallback latest-snapshot path was used */
    return root;
}

static TaskHandle_t s_tele_persist_task_handle = NULL;

void telemetry_mgr_trigger_persistence(void)
{
    telemetry_store_trigger_flush();
    if (s_tele_persist_task_handle) {
        xTaskNotifyGive(s_tele_persist_task_handle);
    }
}

/* Dedicated Storage Persistence Task (Asynchronous Event Log Drain + Telemetry Flush) */
static void telemetry_persistence_task(void *pvParameters)
{
    (void)pvParameters;
    s_tele_persist_task_handle = xTaskGetCurrentTaskHandle();
    ESP_LOGI(TAG, "Storage persistence worker started (isolated stack for disk I/O).");
    vTaskDelay(pdMS_TO_TICKS(2000));

    /* Drain any boot events immediately */
    (void)event_mgr_flush_to_storage();

    uint32_t cycle = 0;
    while (1) {
        /* Wait up to 5s for an event notification or next periodic check */
        (void)ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5000));

        /* Always drain any pending events to storage first */
        (void)event_mgr_flush_to_storage();

        /* Flush queued telemetry batch to segmented microSD storage */
        (void)telemetry_store_flush();

        /* HEAP-AUDIT (2026-09-28): report stack high-water mark + internal
         * heap watermarks every ~60s. A stack_hwm of 0 means this task has
         * PROVABLY overflowed its stack -- that is the evidence required
         * before any task stack size may be changed. */
        if (++cycle % 12 == 0) {
            UBaseType_t hwm = uxTaskGetStackHighWaterMark(NULL);
            ESP_LOGW(TAG, "MEM tele_persist_task stack_hwm=%u B free_int=%u largest=%u min_free=%u",
                     (unsigned)(hwm * sizeof(StackType_t)),
                     (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                     (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL),
                     (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL));
        }
    }
}

/* Sensor Sampler Task (Fast, Non-Blocking, Zero Filesystem I/O) */
static void telemetry_sampler_task(void *pvParameters)
{
    (void)pvParameters;
    ESP_LOGI(TAG, "Telemetry sampler task started at priority %d", TASK_TELEMETRY_PRIO);
    // RC-7: Register to Task WDT for diagnostics.
    esp_task_wdt_add(NULL);
    vTaskDelay(pdMS_TO_TICKS(2000));

    while (1) {
        esp_task_wdt_reset();  // RC-7: Feed WDT each iteration
        sensor_hal_poll();
        sensor_readings_t sensors;
        sensor_hal_get_readings(&sensors);

        static sensor_descriptor_t s_descriptors[16];
        size_t descriptor_count = 0;
        if (hardware_registry_get_count() > 0) {
            descriptor_count = sensor_hal_list_configured(s_descriptors, 16);
        }
        const system_storage_state_t *storage = storage_mgr_get_state();
        const char *complex_id = storage && storage->complex_id[0] ? storage->complex_id : NULL;

        for (size_t i = 0; i < descriptor_count; ++i) {
            sensor_component_sample_t sample;
            esp_err_t sample_err = sensor_hal_get_component_sample(s_descriptors[i].sensor_id, &sample);
            sensor_state_t current_state = (sample_err == ESP_OK) ? sample.state : SENSOR_STATE_INVALID;
            sensor_fault_latch_t *latch = get_sensor_latch(s_descriptors[i].sensor_id);
            if (!latch) continue;

            if (current_state == SENSOR_STATE_VALID) {
                /* Reading is healthy */
                latch->fail_streak = 0;
                latch->ever_seen = true;
                if (latch->fault_latched) {
                    /* Recover from previous latched fault - log SENSOR_RECOVERED EXACTLY ONCE */
                    latch->fault_latched = false;
                    hw_component_info_t info;
                    const char *gh_id = NULL;
                    const char *resource_id = NULL;
                    if (hardware_registry_find_by_id(s_descriptors[i].sensor_id, &info) == ESP_OK) {
                        gh_id = info.assignment.gh_id[0] ? info.assignment.gh_id : NULL;
                        resource_id = info.resource_id[0] ? info.resource_id : NULL;
                    }
                    (void)event_mgr_log_context(LOG_LEVEL_INFO, "SENSOR", "SENSOR_RECOVERED",
                                                "Sensor returned to a valid reading state.",
                                                complex_id, gh_id, s_descriptors[i].sensor_id, resource_id,
                                                storage ? storage->config_version : 0);
                }
            } else if (current_state == SENSOR_STATE_INVALID ||
                       current_state == SENSOR_STATE_DISCONNECTED ||
                       current_state == SENSOR_STATE_TIMEOUT ||
                       current_state == SENSOR_STATE_OUT_OF_RANGE) {
                /* Boot grace: don't fault a sensor that has never succeeded yet.
                 * Slow-start sensors (e.g. DHT22 at 60s poll) fail their first
                 * read, and telemetry_mgr samples state every 2s — without this
                 * guard, fail_streak hits 3 in 6s before the sensor can retry. */
                if (!latch->ever_seen) continue;

                if (latch->fail_streak < 255) latch->fail_streak++;

                /* Hysteresis: Require at least 3 consecutive failures before logging SENSOR_FAULT */
                if (latch->fail_streak >= 3 && !latch->fault_latched) {
                    latch->fault_latched = true;
                    hw_component_info_t info;
                    const char *gh_id = NULL;
                    const char *resource_id = NULL;
                    if (hardware_registry_find_by_id(s_descriptors[i].sensor_id, &info) == ESP_OK) {
                        gh_id = info.assignment.gh_id[0] ? info.assignment.gh_id : NULL;
                        resource_id = info.resource_id[0] ? info.resource_id : NULL;
                    }
                    char message[128];
                    snprintf(message, sizeof(message), "Sensor '%s' transitioned to state %d.", s_descriptors[i].sensor_id, (int)current_state);
                    (void)event_mgr_log_context(LOG_LEVEL_ERROR, "SENSOR", "SENSOR_FAULT", message,
                                                complex_id, gh_id, s_descriptors[i].sensor_id, resource_id,
                                                storage ? storage->config_version : 0);
                }
            }
        }

        /* Update in-memory latest snapshot */
        xSemaphoreTake(s_snap_mutex, portMAX_DELAY);
        s_snapshot.sequence = allocate_sequence();
        timestamp_now(s_snapshot.timestamp, &s_snapshot.timestamp_ms);
        /* Water temperature from DS18B20 */
        s_snapshot.temp_water_valid = (sensors.temp_state == SENSOR_STATE_VALID);
        s_snapshot.temperature_water_c = sensors.temperature_c;

        /* Air temperature & Humidity from DHT22 */
        if (sensors.dht22_state == SENSOR_STATE_VALID) {
            s_snapshot.temperature_c = sensors.dht22_temperature_c;
            s_snapshot.temp_valid = true;
            s_snapshot.humidity_pct = sensors.dht22_humidity_rh;
            s_snapshot.humidity_valid = true;
        } else {
            /* DHT22 not available: air temperature and humidity are both unavailable.
             * Do NOT fall back to DS18B20 (water temperature) for temperatureAirC.
             * temperatureWaterC is served independently from temperature_water_c. */
            s_snapshot.humidity_valid = false;
            s_snapshot.temp_valid = false;
        }

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
        s_snapshot.buzzer_on = actuator_hal_get_state(ACTUATOR_BUZZER);
        telemetry_snapshot_t copy_snap = s_snapshot;
        xSemaphoreGive(s_snap_mutex);

        /* Update daily min/max temperature tracking */
        if (copy_snap.temp_valid) {
            time_t now_t = time(NULL);
            struct tm ti_now;
            localtime_r(&now_t, &ti_now);
            if (ti_now.tm_yday != s_today_temp_day) {
                s_today_temp_day = ti_now.tm_yday;
                s_today_temp_min = copy_snap.temperature_c;
                s_today_temp_max = copy_snap.temperature_c;
                s_today_temp_valid = true;
            } else {
                if (!s_today_temp_valid) {
                    s_today_temp_min = copy_snap.temperature_c;
                    s_today_temp_max = copy_snap.temperature_c;
                    s_today_temp_valid = true;
                } else {
                    if (copy_snap.temperature_c < s_today_temp_min) s_today_temp_min = copy_snap.temperature_c;
                    if (copy_snap.temperature_c > s_today_temp_max) s_today_temp_max = copy_snap.temperature_c;
                }
            }
        }

        /* Enqueue into bounded RAM ring buffer */
        if (s_ring_mutex && xSemaphoreTake(s_ring_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            if (s_ring_count >= TELEMETRY_RING_CAPACITY) {
                s_dropped_samples++;
            } else {
                s_ring_count++;
            }
            s_ring_buffer[s_ring_head] = copy_snap;
            s_ring_head = (s_ring_head + 1) % TELEMETRY_RING_CAPACITY;
            xSemaphoreGive(s_ring_mutex);
        } else {
            s_dropped_samples++;
        }

        /* Forward to persistent TelemetryStore (updates 288-slot RAM cache + stages SD batch) */
        (void)telemetry_store_append(&copy_snap);

        /* Detect pump active process state transition */
        telemetry_active_process_t proc;
        telemetry_mgr_get_active_process(&proc);
        if (proc.is_active != s_prev_process_active) {
            s_prev_process_active = proc.is_active;
            telemetry_mgr_trigger_transition(proc.is_active ? "PROCESS_START" : "PROCESS_STOP");
        }
        UBaseType_t hwm = uxTaskGetStackHighWaterMark(NULL);
        ESP_LOGD(TAG, "telemetry_task stack high water: %u bytes", (unsigned)(hwm * sizeof(StackType_t)));

        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

esp_err_t telemetry_mgr_init(void)
{
    if (s_snap_mutex) return ESP_OK;
    s_snap_mutex = xSemaphoreCreateMutexStatic(&s_snap_mutex_buf);
    s_ring_mutex = xSemaphoreCreateMutexStatic(&s_ring_mutex_buf);
    if (!s_snap_mutex || !s_ring_mutex) return ESP_ERR_NO_MEM;

    uint64_t first = 0;
    if (storage_mgr_reserve_sequence_block("telemetry_seq_end", TELEMETRY_SEQUENCE_BLOCK, &first) == ESP_OK) {
        s_next_sequence = first;
        s_sequence_end = first + TELEMETRY_SEQUENCE_BLOCK - 1U;
    } else {
        s_storage_degraded = true;
    }

    /* Initialize persistent TelemetryStore (microSD segmented storage + 288-slot RAM cache) */
    (void)telemetry_store_init();

    xTaskCreatePinnedToCore(telemetry_sampler_task, "telemetry_task", TASK_TELEMETRY_STACK, NULL, TASK_TELEMETRY_PRIO, NULL, 1);
    xTaskCreatePinnedToCore(telemetry_persistence_task, "tele_persist_task", 4096, NULL, TASK_TELEMETRY_PRIO - 1, &s_tele_persist_task_handle, 1);
    ESP_LOGI(TAG, "Telemetry manager V2 initialized (RAM ring: %d, unified persistence worker).", TELEMETRY_RING_CAPACITY);
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
    telemetry_store_status_t store_status;
    bool store_ok = (telemetry_store_get_status(&store_status) == ESP_OK && !store_status.is_degraded);
    cJSON_AddBoolToObject(root, "storageAvailable", store_ok);

    /* 1. Add Full 24-Hour 288-Slot Daily Model (00:00 to 23:59, 5-minute buckets) */
    cJSON *daily_arr = cJSON_AddArrayToObject(root, "dailyHistory");
    const telemetry_daily_history_t *hist = telemetry_store_lock_daily_history();
    if (hist != NULL) {
        cJSON_AddNumberToObject(root, "date", hist->date_int);
        cJSON_AddNumberToObject(root, "dailySlots", TELEMETRY_DAILY_SLOTS);
        for (int s = 0; s < TELEMETRY_DAILY_SLOTS; s++) {
            cJSON *slot_obj = cJSON_CreateObject();
            cJSON_AddNumberToObject(slot_obj, "slot", s);
            int min_of_day = s * 5;
            char time_str[8];
            snprintf(time_str, sizeof(time_str), "%02d:%02d", min_of_day / 60, min_of_day % 60);
            cJSON_AddStringToObject(slot_obj, "time", time_str);
            cJSON_AddBoolToObject(slot_obj, "valid", hist->buckets[s].valid);
            if (hist->buckets[s].valid) {
                cJSON_AddNumberToObject(slot_obj, "temperatureC", hist->buckets[s].temp_air);
                cJSON_AddNumberToObject(slot_obj, "temperatureAirC", hist->buckets[s].temp_air);
                cJSON_AddNumberToObject(slot_obj, "temperatureWaterC", hist->buckets[s].temp_water);
                cJSON_AddNumberToObject(slot_obj, "humidityPct", hist->buckets[s].humidity);
            } else {
                cJSON_AddNullToObject(slot_obj, "temperatureC");
                cJSON_AddNullToObject(slot_obj, "temperatureAirC");
                cJSON_AddNullToObject(slot_obj, "temperatureWaterC");
                cJSON_AddNullToObject(slot_obj, "humidityPct");
            }
            cJSON_AddItemToArray(daily_arr, slot_obj);
        }
        telemetry_store_unlock_daily_history();
    }

    /* 2. Populate items / samples from fast RAM ring buffer */
    uint64_t last = after;
    uint64_t earliest = 0;
    bool more = false;
    size_t returned = 0;

    if (s_ring_mutex && xSemaphoreTake(s_ring_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        size_t count = s_ring_count;
        size_t head = s_ring_head;
        size_t start_idx = (head + TELEMETRY_RING_CAPACITY - count) % TELEMETRY_RING_CAPACITY;

        for (size_t i = 0; i < count; i++) {
            size_t idx = (start_idx + i) % TELEMETRY_RING_CAPACITY;
            const telemetry_snapshot_t *item = &s_ring_buffer[idx];
            if (item->sequence == 0) continue;
            if (earliest == 0 || item->sequence < earliest) earliest = item->sequence;
            if (item->sequence <= after) continue;
            if (returned >= (size_t)limit) {
                more = true;
                break;
            }
            cJSON *snap_json = build_current_json_from_snap(greenhouse_id, item);
            if (snap_json) {
                cJSON_AddItemToArray(items, snap_json);
                returned++;
                last = item->sequence;
            }
        }
        xSemaphoreGive(s_ring_mutex);
    }

    if (returned == 0) {
        telemetry_snapshot_t live;
        if (telemetry_mgr_get_snapshot(&live) == ESP_OK && live.sequence > after) {
            if (earliest == 0 || live.sequence < earliest) earliest = live.sequence;
            cJSON *snap_json = build_current_json_from_snap(greenhouse_id, &live);
            if (snap_json) {
                cJSON_AddItemToArray(items, snap_json);
                returned++;
                last = live.sequence;
            }
        }
    }

    cJSON_AddNumberToObject(root, "nextSequence", (double)last);
    cJSON_AddNumberToObject(root, "earliestSequence", (double)earliest);
    cJSON_AddNumberToObject(root, "latestSequence", (double)(s_next_sequence > 1 ? s_next_sequence - 1 : 0));
    cJSON_AddBoolToObject(root, "hasMore", more);
    if (more) {
        char cursor[32];
        snprintf(cursor, sizeof(cursor), "%" PRIu64, last);
        cJSON_AddStringToObject(root, "nextCursor", cursor);
    } else {
        cJSON_AddNullToObject(root, "nextCursor");
    }
    return root;
}

esp_err_t telemetry_mgr_get_temp_history(float *out_min, float *out_max, float *out_series, size_t max_series, size_t *out_count)
{
    if (!out_min || !out_max) return ESP_ERR_INVALID_ARG;

    if (telemetry_store_get_temp_series(out_min, out_max, out_series, max_series, out_count) == ESP_OK) {
        return ESP_OK;
    }

    if (s_today_temp_valid) {
        *out_min = s_today_temp_min;
        *out_max = s_today_temp_max;
    } else {
        *out_min = 0.0f;
        *out_max = 0.0f;
    }

    if (out_series && max_series > 0 && out_count) {
        *out_count = 0;
        if (s_ring_mutex && xSemaphoreTake(s_ring_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            size_t available = (s_ring_count < TELEMETRY_RING_CAPACITY) ? s_ring_count : TELEMETRY_RING_CAPACITY;
            size_t valid_collected = 0;
            for (size_t i = 0; i < available && valid_collected < max_series; i++) {
                size_t idx = (s_ring_head + TELEMETRY_RING_CAPACITY - 1 - i) % TELEMETRY_RING_CAPACITY;
                if (s_ring_buffer[idx].temp_valid) {
                    out_series[valid_collected++] = s_ring_buffer[idx].temperature_c;
                }
            }
            xSemaphoreGive(s_ring_mutex);
            // Reverse in-place so series is oldest to newest
            for (size_t i = 0; i < valid_collected / 2; i++) {
                float tmp = out_series[i];
                out_series[i] = out_series[valid_collected - 1 - i];
                out_series[valid_collected - 1 - i] = tmp;
            }
            *out_count = valid_collected;
        }
    }
    return s_today_temp_valid ? ESP_OK : ESP_ERR_NOT_FOUND;
}
