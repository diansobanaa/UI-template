#include "services/calibration_mgr.h"
#include "services/protocol_mixing.h"
#include "services/fertigation_mgr.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "cJSON.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include "hal/sensor_hal.h"
#include "services/event_mgr.h"
#include <time.h>
#include <sys/time.h>
#include <string.h>
#include <strings.h>
#include <stdlib.h>

static const char *TAG = "CALIB_MGR";
#define MAX_CAL_RECORDS 32
#define CALIBRATION_TASK_STACK 4096

static calibration_status_t s_ctx;
static SemaphoreHandle_t s_mutex = NULL;
static uint32_t s_start_tick = 0;
static uint32_t s_start_raw_flow_ml = 0;
static uint32_t s_last_pulse_count = 0;
static int64_t s_last_pulse_sample_us = 0;
static calibration_record_t s_records[MAX_CAL_RECORDS];
static size_t s_record_count = 0;
static float s_flow_raw_pulses_per_l = ZJB1_PULSES_PER_LITER_DEFAULT;
static float s_flow_fert_pulses_per_l = FS400A_PULSES_PER_LITER_DEFAULT;
static bool s_calibration_running_component = false;

/* Canonical Mixing & Dosing hardware test state */
static SemaphoreHandle_t s_mixing_test_mutex = NULL;
static bool s_mixing_test_running = false;
static bool s_mixing_test_abort_requested = false;
static mixing_protocol_config_t s_mixing_test_cfg;
static mixing_result_t s_mixing_test_live_res;
static mixing_result_t s_mixing_test_final_res;
static bool s_mixing_test_has_result = false;
static TaskHandle_t s_mixing_test_task_handle = NULL;

static void log_calibration_stack(const char *point)
{
    UBaseType_t free_words = uxTaskGetStackHighWaterMark(NULL);
    ESP_LOGI(TAG, "calib_mgr stack_hwm_%s=%u B", point,
             (unsigned)(free_words * sizeof(StackType_t)));
}

static void copy_str(char *dst, size_t len, const char *src)
{
    if (!dst || len == 0) return;
    dst[0] = '\0';
    if (!src) return;
    strncpy(dst, src, len - 1);
    dst[len - 1] = '\0';
}

static const char *device_complex_id(void)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    return (st && st->complex_id[0]) ? st->complex_id : NULL;
}

static bool record_in_current_complex(const calibration_record_t *record)
{
    const char *complex_id = device_complex_id();
    return record && complex_id && record->complex_id[0] && strcmp(record->complex_id, complex_id) == 0;
}

static bool calibration_type_supported(const char *type)
{
    if (!type || !type[0]) return false;
    return strcasecmp(type, "DOSING_RATE") == 0 || strcasecmp(type, "PUMP_RATE") == 0 ||
           strcasecmp(type, "FLOW") == 0 || strcasecmp(type, "LEVEL") == 0 ||
           strcasecmp(type, "PH") == 0 || strcasecmp(type, "EC") == 0;
}

static bool state_usable(calibration_record_state_t state)
{
    return state == CAL_RECORD_CALIBRATED || state == CAL_RECORD_VERIFIED || state == CAL_RECORD_RECALIBRATED;
}

static calibration_record_state_t parse_state(const char *s)
{
    if (!s) return CAL_RECORD_NOT_CALIBRATED;
    if (strcasecmp(s, "CALIBRATED") == 0) return CAL_RECORD_CALIBRATED;
    if (strcasecmp(s, "VERIFIED") == 0) return CAL_RECORD_VERIFIED;
    if (strcasecmp(s, "EXPIRED") == 0) return CAL_RECORD_EXPIRED;
    if (strcasecmp(s, "SUSPECT") == 0) return CAL_RECORD_SUSPECT;
    if (strcasecmp(s, "RECALIBRATED") == 0) return CAL_RECORD_RECALIBRATED;
    if (strcasecmp(s, "REMOVED") == 0) return CAL_RECORD_REMOVED;
    return CAL_RECORD_NOT_CALIBRATED;
}

static const char *state_name(calibration_record_state_t s)
{
    switch (s) {
        case CAL_RECORD_CALIBRATED: return "CALIBRATED";
        case CAL_RECORD_VERIFIED: return "VERIFIED";
        case CAL_RECORD_EXPIRED: return "EXPIRED";
        case CAL_RECORD_SUSPECT: return "SUSPECT";
        case CAL_RECORD_RECALIBRATED: return "RECALIBRATED";
        case CAL_RECORD_REMOVED: return "REMOVED";
        default: return "NOT_CALIBRATED";
    }
}

static bool component_id_matches(const char *rec_id, const char *query_id)
{
    if (!rec_id || !query_id) return false;
    if (strcasecmp(rec_id, query_id) == 0) return true;
    // Transparently resolve dosingA / DOSING_A <-> pump_dosing_a
    if ((strcasecmp(rec_id, "dosingA") == 0 || strcasecmp(rec_id, "DOSING_A") == 0 || strcasecmp(rec_id, "pump_dosing_a") == 0) &&
        (strcasecmp(query_id, "dosingA") == 0 || strcasecmp(query_id, "DOSING_A") == 0 || strcasecmp(query_id, "pump_dosing_a") == 0)) {
        return true;
    }
    // Transparently resolve dosingB / DOSING_B <-> pump_dosing_b
    if ((strcasecmp(rec_id, "dosingB") == 0 || strcasecmp(rec_id, "DOSING_B") == 0 || strcasecmp(rec_id, "pump_dosing_b") == 0) &&
        (strcasecmp(query_id, "dosingB") == 0 || strcasecmp(query_id, "DOSING_B") == 0 || strcasecmp(query_id, "pump_dosing_b") == 0)) {
        return true;
    }
    // Transparently resolve 12V DC Raw Water Pump: pump_submersible <-> RAW_SUBMERSIBLE <-> pump_raw <-> raw_water_pump
    // Note: NEVER match pump_well / WELL_PUMP (which is 220V AC Well Pump)
    bool rec_is_raw = (strcasecmp(rec_id, "pump_submersible") == 0 || strcasecmp(rec_id, "RAW_SUBMERSIBLE") == 0 ||
                       strcasecmp(rec_id, "pump_raw") == 0 || strcasecmp(rec_id, "raw_water_pump") == 0);
    bool query_is_raw = (strcasecmp(query_id, "pump_submersible") == 0 || strcasecmp(query_id, "RAW_SUBMERSIBLE") == 0 ||
                         strcasecmp(query_id, "pump_raw") == 0 || strcasecmp(query_id, "raw_water_pump") == 0);
    if (rec_is_raw && query_is_raw) {
        return true;
    }
    return false;
}

static int find_latest_record_locked(const char *component_id, const char *type)
{
    if (!component_id || !type) return -1;
    int best = -1;
    uint32_t best_version = 0;
    for (size_t i = 0; i < s_record_count; ++i) {
        if (record_in_current_complex(&s_records[i]) &&
            component_id_matches(s_records[i].component_id, component_id) &&
            strcasecmp(s_records[i].calibration_type, type) == 0) {
            if (best < 0 || s_records[i].version > best_version) {
                best = (int)i;
                best_version = s_records[i].version;
            }
        }
    }
    return best;
}

static int find_exact_record_locked(const char *component_id, const char *type, const char *calibration_id, uint32_t version)
{
    if (!component_id || !type || !calibration_id || !calibration_id[0] || version == 0) return -1;
    for (size_t i = 0; i < s_record_count; ++i) {
        if (record_in_current_complex(&s_records[i]) &&
            component_id_matches(s_records[i].component_id, component_id) &&
            strcasecmp(s_records[i].calibration_type, type) == 0 &&
            (strcmp(s_records[i].calibration_id, calibration_id) == 0 || strcmp(calibration_id, "any") == 0) &&
            s_records[i].version == version) return (int)i;
    }
    return -1;
}

/* Records with >=2 newer versions of the same complex/component/type are superseded. */
static bool record_superseded_locked(size_t i)
{
    int newer = 0;
    const calibration_record_t *a = &s_records[i];
    for (size_t j = 0; j < s_record_count; ++j) {
        const calibration_record_t *b = &s_records[j];
        if (j != i && b->version > a->version && strcmp(a->complex_id, b->complex_id) == 0 &&
            strcmp(a->component_id, b->component_id) == 0 && strcasecmp(a->calibration_type, b->calibration_type) == 0) newer++;
    }
    return newer >= 2;
}

static void compact_superseded_locked(void)
{
    size_t w = 0;
    for (size_t i = 0; i < s_record_count; ++i) {
        if (record_superseded_locked(i)) continue;
        if (w != i) s_records[w] = s_records[i];
        w++;
    }
    for (size_t i = w; i < s_record_count; ++i) memset(&s_records[i], 0, sizeof(s_records[i]));
    s_record_count = w;
}

static esp_err_t persist_locked(void)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;
    cJSON_AddNumberToObject(root, "schemaVersion", 3);
    cJSON_AddNumberToObject(root, "flowRawPulsesPerL", s_flow_raw_pulses_per_l);
    cJSON_AddNumberToObject(root, "flowFertPulsesPerL", s_flow_fert_pulses_per_l);
    cJSON *records = cJSON_AddArrayToObject(root, "records");
    for (size_t i = 0; i < s_record_count; ++i) {
        if (record_superseded_locked(i)) continue;
        const calibration_record_t *r = &s_records[i];
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "calibrationId", r->calibration_id);
        cJSON_AddStringToObject(item, "componentId", r->component_id);
        cJSON_AddStringToObject(item, "complexId", r->complex_id);
        cJSON_AddStringToObject(item, "calibrationType", r->calibration_type);
        cJSON_AddNumberToObject(item, "version", r->version);
        cJSON_AddStringToObject(item, "state", state_name(r->state));
        cJSON_AddNumberToObject(item, "createdAtMs", (double)r->created_at_ms);
        cJSON_AddNumberToObject(item, "validFromMs", (double)r->valid_from_ms);
        cJSON_AddNumberToObject(item, "validUntilMs", (double)r->valid_until_ms);
        cJSON_AddStringToObject(item, "operator", r->operator_id);
        if (r->has_rate) cJSON_AddNumberToObject(item, "rateMlPerSec", r->rate_ml_sec);
        if (r->has_linear) {
            cJSON_AddNumberToObject(item, "slope", r->slope);
            cJSON_AddNumberToObject(item, "offset", r->offset);
        }
        if (r->has_pulses_per_liter) cJSON_AddNumberToObject(item, "pulsesPerLiter", r->pulses_per_liter);
        cJSON_AddItemToArray(records, item);
    }
    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!json) return ESP_ERR_NO_MEM;
    esp_err_t err = storage_mgr_save_calibration(json);
    if (err == ESP_OK) {
        compact_superseded_locked();
        ESP_LOGI(TAG, "Calibration persisted: %u records, %u bytes", (unsigned)s_record_count, (unsigned)strlen(json));
    } else {
        ESP_LOGE(TAG, "Calibration NOT persisted (0x%x, %u bytes); in-memory change will be rolled back", err, (unsigned)strlen(json));
    }
    free(json);
    return err;
}

static void load_persisted(void)
{
    s_record_count = 0;
    s_flow_raw_pulses_per_l = ZJB1_PULSES_PER_LITER_DEFAULT;
    s_flow_fert_pulses_per_l = FS400A_PULSES_PER_LITER_DEFAULT;

    char *buf = (char *)malloc(4096);
    if (!buf) return;
    size_t len = 0;
    esp_err_t load_err = storage_mgr_load_calibration(buf, 4096, &len);
    if (load_err != ESP_OK) {
        ESP_LOGW(TAG, "Calibration load did not restore a record (0x%x)", load_err);
        free(buf);
        return;
    }
    cJSON *root = cJSON_ParseWithLength(buf, len);
    free(buf);
    if (!root) {
        ESP_LOGE(TAG, "Calibration data invalid: JSON parse failed");
        return;
    }
    cJSON *schema = cJSON_GetObjectItem(root, "schemaVersion");
    if (schema && cJSON_IsNumber(schema) && schema->valueint > 3) {
        ESP_LOGE(TAG, "Calibration data incompatible: schemaVersion=%d", schema->valueint);
        cJSON_Delete(root);
        return;
    }
    cJSON *raw = cJSON_GetObjectItem(root, "flowRawPulsesPerL");
    cJSON *fert = cJSON_GetObjectItem(root, "flowFertPulsesPerL");
    if (raw && cJSON_IsNumber(raw) && raw->valuedouble > 0) s_flow_raw_pulses_per_l = (float)raw->valuedouble;
    if (fert && cJSON_IsNumber(fert) && fert->valuedouble > 0) s_flow_fert_pulses_per_l = (float)fert->valuedouble;
    cJSON *records = cJSON_GetObjectItem(root, "records");
    if (records && cJSON_IsArray(records)) {
        cJSON *item = NULL;
        cJSON_ArrayForEach(item, records) {
            if (s_record_count >= MAX_CAL_RECORDS || !cJSON_IsObject(item)) break;
            calibration_record_t *r = &s_records[s_record_count];
            memset(r, 0, sizeof(*r));
            cJSON *v;
            v = cJSON_GetObjectItem(item, "calibrationId"); if (v && cJSON_IsString(v)) copy_str(r->calibration_id, sizeof(r->calibration_id), v->valuestring);
            v = cJSON_GetObjectItem(item, "componentId"); if (v && cJSON_IsString(v)) copy_str(r->component_id, sizeof(r->component_id), v->valuestring);
            v = cJSON_GetObjectItem(item, "complexId"); if (v && cJSON_IsString(v)) copy_str(r->complex_id, sizeof(r->complex_id), v->valuestring);
            v = cJSON_GetObjectItem(item, "calibrationType"); if (v && cJSON_IsString(v)) copy_str(r->calibration_type, sizeof(r->calibration_type), v->valuestring);
            v = cJSON_GetObjectItem(item, "version"); if (v && cJSON_IsNumber(v)) r->version = (uint32_t)v->valuedouble;
            v = cJSON_GetObjectItem(item, "state"); if (v && cJSON_IsString(v)) r->state = parse_state(v->valuestring);
            v = cJSON_GetObjectItem(item, "createdAtMs"); if (v && cJSON_IsNumber(v)) r->created_at_ms = (int64_t)v->valuedouble;
            v = cJSON_GetObjectItem(item, "validFromMs"); if (v && cJSON_IsNumber(v)) r->valid_from_ms = (int64_t)v->valuedouble;
            v = cJSON_GetObjectItem(item, "validUntilMs"); if (v && cJSON_IsNumber(v)) r->valid_until_ms = (int64_t)v->valuedouble;
            v = cJSON_GetObjectItem(item, "operator"); if (v && cJSON_IsString(v)) copy_str(r->operator_id, sizeof(r->operator_id), v->valuestring);
            v = cJSON_GetObjectItem(item, "rateMlPerSec"); if (v && cJSON_IsNumber(v) && v->valuedouble > 0) { r->rate_ml_sec = (float)v->valuedouble; r->has_rate = true; }
            v = cJSON_GetObjectItem(item, "slope"); if (v && cJSON_IsNumber(v)) { r->slope = (float)v->valuedouble; r->has_linear = true; }
            v = cJSON_GetObjectItem(item, "offset"); if (v && cJSON_IsNumber(v)) { r->offset = (float)v->valuedouble; r->has_linear = true; }
            v = cJSON_GetObjectItem(item, "pulsesPerLiter"); if (v && cJSON_IsNumber(v) && v->valuedouble > 0) { r->pulses_per_liter = (float)v->valuedouble; r->has_pulses_per_liter = true; }
            if (r->component_id[0] && r->complex_id[0] && r->calibration_type[0] &&
                calibration_type_supported(r->calibration_type) && r->version > 0 && r->calibration_id[0]) ++s_record_count;
        }
    }
    ESP_LOGI(TAG, "Calibration data restored: %u valid records", (unsigned)s_record_count);
    cJSON_Delete(root);
}

static esp_err_t start_component_locked(const char *component_id, uint32_t duration_sec)
{
    if (!component_id || !component_id[0] || duration_sec == 0) return ESP_ERR_INVALID_ARG;
    if (s_ctx.state == CALIBRATION_STATE_RUNNING) return ESP_ERR_INVALID_STATE;
    if (actuator_hal_is_emergency_stopped()) return ESP_ERR_INVALID_STATE;

    bool is_raw_pump = (strcasestr(component_id, "submersible") != NULL ||
                        strcasestr(component_id, "raw") != NULL);
    if (is_raw_pump) {
        /* Preserve maximum raw water pump runtime limit of 30 minutes (1800s) */
        if (duration_sec > 1800) return ESP_ERR_INVALID_ARG;
        /* Ensure dosing pumps and mixing pump are not running */
        if (actuator_hal_get_state(ACTUATOR_DOSING_A) ||
            actuator_hal_get_state(ACTUATOR_DOSING_B) ||
            actuator_hal_get_state(ACTUATOR_MIXING_PUMP)) {
            return ESP_ERR_INVALID_STATE;
        }
    }

    actuator_id_t fallback_aid = ACTUATOR_MAX_COUNT;
    esp_err_t err = actuator_hal_acquire_component(component_id, ACTUATOR_OWNER_CALIBRATION);
    if (err != ESP_OK) {
        if (actuator_hal_find_id_by_component_id(component_id, &fallback_aid) == ESP_OK) {
            err = actuator_hal_acquire(fallback_aid, ACTUATOR_OWNER_CALIBRATION);
        }
        if (err != ESP_OK) return err;
    }

    err = actuator_hal_request_component(component_id, true,
                                         ACTUATOR_SOURCE_CALIBRATION,
                                         "calibration_start");
    if (err != ESP_OK) {
        if (fallback_aid < ACTUATOR_MAX_COUNT || actuator_hal_find_id_by_component_id(component_id, &fallback_aid) == ESP_OK) {
            err = actuator_hal_request(fallback_aid, true,
                                       ACTUATOR_SOURCE_CALIBRATION,
                                       "calibration_start_legacy");
        }
        if (err != ESP_OK) {
            actuator_hal_release_component(component_id, ACTUATOR_OWNER_CALIBRATION);
            if (fallback_aid < ACTUATOR_MAX_COUNT) {
                actuator_hal_release(fallback_aid, ACTUATOR_OWNER_CALIBRATION);
            }
            return err;
        }
    }
    memset(&s_ctx, 0, sizeof(s_ctx));
    s_ctx.state = CALIBRATION_STATE_RUNNING;
    s_ctx.pump_id = fallback_aid;
    s_ctx.duration_sec = duration_sec;
    s_ctx.remaining_sec = duration_sec;
    s_ctx.elapsed_sec = 0;
    copy_str(s_ctx.component_id, sizeof(s_ctx.component_id), component_id);

    s_start_raw_flow_ml = 0;
    uint32_t init_hw_pulses = sensor_hal_get_raw_flow_pulses();
    s_ctx.start_pulses = init_hw_pulses;
    s_ctx.current_pulses = init_hw_pulses;
    s_ctx.session_pulses = 0;
    sensor_readings_t rd;
    if (sensor_hal_get_readings(&rd) == ESP_OK) {
        s_start_raw_flow_ml = rd.total_ml_raw_zjb1;
    }
    s_last_pulse_count = init_hw_pulses;
    s_last_pulse_sample_us = esp_timer_get_time();
    s_ctx.pulse_frequency_hz = 0.0f;

    /* Check calibration status for raw water flow sensor using locked lookup to prevent self-deadlock */
    calibration_record_t flow_rec;
    bool has_cal = false;
    float p_per_l = calibration_mgr_get_flow_raw_pulses_per_l();
    int flow_rec_idx = find_latest_record_locked("flow_raw_zjb1", "FLOW");
    if (flow_rec_idx < 0) {
        flow_rec_idx = find_latest_record_locked("sensor_flow_raw", "FLOW");
    }
    if (flow_rec_idx >= 0) {
        flow_rec = s_records[flow_rec_idx];
        if (flow_rec.has_pulses_per_liter && flow_rec.pulses_per_liter > 0.0f) {
            p_per_l = flow_rec.pulses_per_liter;
        }
        if (flow_rec.state == CAL_RECORD_VERIFIED) {
            copy_str(s_ctx.calibration_status, sizeof(s_ctx.calibration_status), "VERIFIED");
            has_cal = true;
        } else if (flow_rec.state == CAL_RECORD_CALIBRATED) {
            copy_str(s_ctx.calibration_status, sizeof(s_ctx.calibration_status), "CALIBRATION_PENDING");
            has_cal = true;
        } else {
            copy_str(s_ctx.calibration_status, sizeof(s_ctx.calibration_status), "UNCAL");
            has_cal = false;
        }
    } else {
        copy_str(s_ctx.calibration_status, sizeof(s_ctx.calibration_status), "UNCAL");
        has_cal = false;
    }
    s_ctx.pulses_per_liter = p_per_l;
    s_ctx.has_valid_calibration = has_cal;
    s_ctx.estimated_l = 0.0f;
    s_ctx.estimated_ml = 0;
    s_ctx.flow_rate_lpm = 0.0f;
    s_ctx.measured_ml = 0;

    s_start_tick = xTaskGetTickCount();
    s_calibration_running_component = true;
    return ESP_OK;
}

static void calibration_worker_task(void *arg)
{
    (void)arg;
    log_calibration_stack("start");
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(200));
        if (!s_mutex || xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) continue;
        if (s_ctx.state == CALIBRATION_STATE_RUNNING) {
            uint32_t elapsed = (xTaskGetTickCount() - s_start_tick) / pdMS_TO_TICKS(1000);
            s_ctx.elapsed_sec = elapsed;
            uint32_t live_hw_pulses = sensor_hal_get_raw_flow_pulses();
            s_ctx.current_pulses = live_hw_pulses;
            if (live_hw_pulses >= s_ctx.start_pulses) {
                s_ctx.session_pulses = live_hw_pulses - s_ctx.start_pulses;
            } else {
                s_ctx.session_pulses = (UINT32_MAX - s_ctx.start_pulses) + 1 + live_hw_pulses;
            }
            int64_t now_us = esp_timer_get_time();
            float dt_sec = (float)(now_us - s_last_pulse_sample_us) / 1000000.0f;
            if (dt_sec >= 0.8f) {
                uint32_t dp = live_hw_pulses >= s_last_pulse_count ? (live_hw_pulses - s_last_pulse_count) : 0;
                s_ctx.pulse_frequency_hz = (float)dp / dt_sec;
                s_last_pulse_count = live_hw_pulses;
                s_last_pulse_sample_us = now_us;
            }
            if (s_ctx.has_valid_calibration && s_ctx.pulses_per_liter > 0.0f) {
                s_ctx.estimated_l = (float)s_ctx.session_pulses / s_ctx.pulses_per_liter;
                s_ctx.estimated_ml = (uint32_t)((s_ctx.session_pulses * 1000.0f) / s_ctx.pulses_per_liter);
                s_ctx.flow_rate_lpm = (s_ctx.pulse_frequency_hz * 60.0f) / s_ctx.pulses_per_liter;
                s_ctx.measured_ml = s_ctx.estimated_ml;
            } else {
                s_ctx.estimated_l = 0.0f;
                s_ctx.estimated_ml = 0;
                s_ctx.flow_rate_lpm = 0.0f;
                s_ctx.measured_ml = 0;
            }
            if (actuator_hal_is_emergency_stopped()) {
                log_calibration_stack("before_emergency_off");
                actuator_hal_request_component(s_ctx.component_id, false,
                                               ACTUATOR_SOURCE_SAFETY,
                                               "calibration_emergency_stop");
                actuator_hal_release_component(s_ctx.component_id, ACTUATOR_OWNER_CALIBRATION);
                if (s_ctx.pump_id < ACTUATOR_MAX_COUNT) {
                    actuator_hal_request(s_ctx.pump_id, false,
                                         ACTUATOR_SOURCE_SAFETY,
                                         "calibration_emergency_stop_legacy");
                    actuator_hal_release(s_ctx.pump_id, ACTUATOR_OWNER_CALIBRATION);
                }
                log_calibration_stack("after_emergency_off");
                copy_str(s_ctx.error_code, sizeof(s_ctx.error_code), "EMERGENCY_STOP");
                s_ctx.state = CALIBRATION_STATE_ERROR;
                s_ctx.remaining_sec = 0;
            } else if (elapsed >= s_ctx.duration_sec) {
                log_calibration_stack("before_complete_off");
                actuator_hal_request_component(s_ctx.component_id, false,
                                               ACTUATOR_SOURCE_CALIBRATION,
                                               "calibration_complete");
                actuator_hal_release_component(s_ctx.component_id, ACTUATOR_OWNER_CALIBRATION);
                if (s_ctx.pump_id < ACTUATOR_MAX_COUNT) {
                    actuator_hal_request(s_ctx.pump_id, false,
                                         ACTUATOR_SOURCE_CALIBRATION,
                                         "calibration_complete_legacy");
                    actuator_hal_release(s_ctx.pump_id, ACTUATOR_OWNER_CALIBRATION);
                }
                log_calibration_stack("after_complete_off");
                s_ctx.state = CALIBRATION_STATE_COMPLETE;
                s_ctx.remaining_sec = 0;
                copy_str(s_ctx.error_code, sizeof(s_ctx.error_code), "COMPLETED");
            } else {
                s_ctx.remaining_sec = s_ctx.duration_sec - elapsed;
            }
        }
        xSemaphoreGive(s_mutex);
    }
}

esp_err_t calibration_mgr_init(void)
{
    if (!s_mutex) s_mutex = xSemaphoreCreateMutex();
    if (!s_mutex) return ESP_ERR_NO_MEM;
    if (!s_mixing_test_mutex) s_mixing_test_mutex = xSemaphoreCreateMutex();
    if (!s_mixing_test_mutex) return ESP_ERR_NO_MEM;
    memset(&s_ctx, 0, sizeof(s_ctx));
    s_ctx.state = CALIBRATION_STATE_IDLE;
    s_ctx.pump_id = ACTUATOR_MAX_COUNT;
    load_persisted();
    /*
     * The previous 2560-byte tuning predates centralized actuator request
     * logging. The OFF path now includes actuator validation, event creation,
     * and deferred persistence signaling; keep a measured high-water log at
     * those boundaries and provide bounded headroom for that call chain.
     */
    xTaskCreatePinnedToCore(calibration_worker_task, "calib_mgr",
                            CALIBRATION_TASK_STACK, NULL, 3, NULL, 1);
    ESP_LOGI(TAG, "Calibration manager ready with %u versioned records", (unsigned)s_record_count);
    return ESP_OK;
}

esp_err_t calibration_mgr_start_volumetric_component(const char *component_id, uint32_t duration_sec)
{
    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    esp_err_t err = start_component_locked(component_id, duration_sec);
    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t calibration_mgr_start_volumetric(actuator_id_t pump_id, uint32_t duration_sec)
{
    if (pump_id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    const char *legacy = pump_id == ACTUATOR_DOSING_A ? "dosingA" : pump_id == ACTUATOR_DOSING_B ? "dosingB" : NULL;
    if (!legacy) return ESP_ERR_NOT_SUPPORTED;
    return calibration_mgr_start_volumetric_component(legacy, duration_sec);
}

esp_err_t calibration_mgr_stop(void)
{
    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    if (s_ctx.state == CALIBRATION_STATE_RUNNING) {
        actuator_hal_request_component(s_ctx.component_id, false,
                                       ACTUATOR_SOURCE_MANUAL,
                                       "calibration_operator_stop");
        actuator_hal_release_component(s_ctx.component_id, ACTUATOR_OWNER_CALIBRATION);
        if (s_ctx.pump_id < ACTUATOR_MAX_COUNT) {
            actuator_hal_request(s_ctx.pump_id, false,
                                 ACTUATOR_SOURCE_MANUAL,
                                 "calibration_operator_stop_legacy");
            actuator_hal_release(s_ctx.pump_id, ACTUATOR_OWNER_CALIBRATION);
        }
        uint32_t final_pulses = sensor_hal_get_raw_flow_pulses();
        s_ctx.current_pulses = final_pulses;
        if (final_pulses >= s_ctx.start_pulses) {
            s_ctx.session_pulses = final_pulses - s_ctx.start_pulses;
        } else {
            s_ctx.session_pulses = (UINT32_MAX - s_ctx.start_pulses) + 1 + final_pulses;
        }
        if (s_ctx.has_valid_calibration && s_ctx.pulses_per_liter > 0.0f) {
            s_ctx.estimated_l = (float)s_ctx.session_pulses / s_ctx.pulses_per_liter;
            s_ctx.estimated_ml = (uint32_t)((s_ctx.session_pulses * 1000.0f) / s_ctx.pulses_per_liter);
            s_ctx.measured_ml = s_ctx.estimated_ml;
        }
        copy_str(s_ctx.error_code, sizeof(s_ctx.error_code), "STOPPED_BY_OPERATOR");
        s_ctx.state = CALIBRATION_STATE_COMPLETE;
        s_ctx.remaining_sec = 0;
    }
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t calibration_mgr_get_status(calibration_status_t *out_status)
{
    if (!out_status || !s_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    if (s_ctx.state == CALIBRATION_STATE_RUNNING) {
        uint32_t live_hw_pulses = sensor_hal_get_raw_flow_pulses();
        s_ctx.current_pulses = live_hw_pulses;
        if (live_hw_pulses >= s_ctx.start_pulses) {
            s_ctx.session_pulses = live_hw_pulses - s_ctx.start_pulses;
        } else {
            s_ctx.session_pulses = (UINT32_MAX - s_ctx.start_pulses) + 1 + live_hw_pulses;
        }
        if (s_ctx.has_valid_calibration && s_ctx.pulses_per_liter > 0.0f) {
            s_ctx.estimated_l = (float)s_ctx.session_pulses / s_ctx.pulses_per_liter;
            s_ctx.estimated_ml = (uint32_t)((s_ctx.session_pulses * 1000.0f) / s_ctx.pulses_per_liter);
            s_ctx.measured_ml = s_ctx.estimated_ml;
        }
    }
    *out_status = s_ctx;
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

static bool version_conflict_locked(const char *component_id, const char *type, uint32_t version)
{
    int latest = find_latest_record_locked(component_id, type);
    return latest >= 0 && s_records[latest].version >= version;
}

esp_err_t calibration_mgr_set_dosing_rate(const char *component_id, float rate_ml_sec, uint32_t version,
                                         calibration_record_state_t state, const char *operator_id,
                                         int64_t valid_until_ms, const char *calibration_id)
{
    if (!s_mutex || !component_id || !component_id[0] || rate_ml_sec <= 0) return ESP_ERR_INVALID_ARG;
    if (state < CAL_RECORD_NOT_CALIBRATED || state > CAL_RECORD_REMOVED) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    int latest = find_latest_record_locked(component_id, "DOSING_RATE");
    uint32_t eff_version = version;
    if (eff_version == 0 || (latest >= 0 && eff_version <= s_records[latest].version)) {
        eff_version = (latest >= 0) ? (s_records[latest].version + 1) : 1;
    }

    int idx = -1;
    bool replaced = false;
    calibration_record_t replaced_backup;
    if (s_record_count < MAX_CAL_RECORDS) {
        idx = (int)s_record_count++;
    } else {
        // Find oldest record to replace
        idx = 0;
        int64_t oldest_time = s_records[0].created_at_ms;
        for (size_t i = 1; i < s_record_count; ++i) {
            if (s_records[i].created_at_ms < oldest_time) {
                oldest_time = s_records[i].created_at_ms;
                idx = (int)i;
            }
        }
        replaced_backup = s_records[idx];
        replaced = true;
    }

    calibration_record_t *r = &s_records[idx];
    memset(r, 0, sizeof(*r));
    char def_cal_id[48];
    snprintf(def_cal_id, sizeof(def_cal_id), "cal-%s-v%u", component_id, (unsigned)eff_version);
    copy_str(r->calibration_id, sizeof(r->calibration_id), calibration_id && calibration_id[0] ? calibration_id : def_cal_id);
    copy_str(r->component_id, sizeof(r->component_id), component_id);
    const char *complex_id = device_complex_id();
    if (!complex_id) {
        if (replaced) *r = replaced_backup;
        else if (idx == (int)s_record_count - 1) s_record_count--;
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }
    copy_str(r->complex_id, sizeof(r->complex_id), complex_id);
    copy_str(r->calibration_type, sizeof(r->calibration_type), "DOSING_RATE");
    r->version = eff_version;
    r->state = state;
    time_t now_sec = time(NULL);
    if (now_sec >= 1704067200) {
        r->created_at_ms = (int64_t)now_sec * 1000LL;
        r->valid_from_ms = r->created_at_ms;
        r->valid_until_ms = valid_until_ms > 0 ? valid_until_ms : (r->created_at_ms + (int64_t)30 * 86400000LL);
    } else {
        r->created_at_ms = (int64_t)esp_timer_get_time() / 1000LL;
        r->valid_from_ms = 0;
        r->valid_until_ms = 0;
    }
    copy_str(r->operator_id, sizeof(r->operator_id), operator_id && operator_id[0] ? operator_id : "device");
    r->rate_ml_sec = rate_ml_sec;
    r->has_rate = true;
    esp_err_t err = persist_locked();
    if (err != ESP_OK) {
        if (replaced) {
            *r = replaced_backup; /* never destroy a previously valid record */
        } else {
            memset(r, 0, sizeof(*r));
            if (idx == (int)s_record_count - 1) s_record_count--;
        }
    }
    xSemaphoreGive(s_mutex);
    if (err == ESP_OK) {
        (void)event_mgr_log_context(LOG_LEVEL_INFO, "CALIBRATION", "CALIBRATION_CHANGED", "Calibration record updated and persisted.",
                                    device_complex_id(), NULL, component_id, NULL, eff_version);
    }
    return err;
}

esp_err_t calibration_mgr_get_record(const char *component_id, const char *calibration_type, calibration_record_t *out)
{
    if (!s_mutex || !out) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    int idx = find_latest_record_locked(component_id, calibration_type);
    if (idx < 0) { xSemaphoreGive(s_mutex); return ESP_ERR_NOT_FOUND; }
    *out = s_records[idx];
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t calibration_mgr_get_record_exact(const char *component_id, const char *calibration_type, const char *calibration_id, uint32_t version, calibration_record_t *out)
{
    if (!s_mutex || !out || !component_id || !calibration_type || !calibration_id || version == 0) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    int idx = find_exact_record_locked(component_id, calibration_type, calibration_id, version);
    if (idx < 0 || !record_in_current_complex(&s_records[idx])) { xSemaphoreGive(s_mutex); return ESP_ERR_NOT_FOUND; }
    *out = s_records[idx];
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t calibration_mgr_is_usable(const calibration_record_t *record)
{
    if (!record || !state_usable(record->state)) return ESP_ERR_INVALID_STATE;
    time_t now_s = time(NULL);
    if (now_s >= 1704067200) {
        const int64_t now_ms = (int64_t)now_s * 1000LL;
        if (record->valid_from_ms >= 1704067200000LL && now_ms < record->valid_from_ms) return ESP_ERR_INVALID_STATE;
        if (record->valid_until_ms >= 1704067200000LL && now_ms > record->valid_until_ms) return ESP_ERR_INVALID_STATE;
    }
    if (record->has_rate && record->rate_ml_sec <= 0) return ESP_ERR_INVALID_STATE;
    if (record->has_pulses_per_liter && record->pulses_per_liter <= 0) return ESP_ERR_INVALID_STATE;
    return ESP_OK;
}

esp_err_t calibration_mgr_get_rate_by_component(const char *component_id, float *out_rate_ml_sec)
{
    if (!out_rate_ml_sec) return ESP_ERR_INVALID_ARG;
    *out_rate_ml_sec = 0.0f;
    calibration_record_t r;
    if (calibration_mgr_get_record(component_id, "DOSING_RATE", &r) != ESP_OK &&
        calibration_mgr_get_record(component_id, "PUMP_RATE", &r) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (calibration_mgr_is_usable(&r) != ESP_OK || !r.has_rate) return ESP_ERR_INVALID_STATE;
    *out_rate_ml_sec = r.rate_ml_sec;
    return ESP_OK;
}

float calibration_mgr_get_rate_ml_per_sec(actuator_id_t pump_id)
{
    float rate = 0.0f;
    if (pump_id == ACTUATOR_DOSING_A) {
        if (calibration_mgr_get_rate_by_component("pump_dosing_a", &rate) != ESP_OK) {
            calibration_mgr_get_rate_by_component("dosingA", &rate);
        }
    } else if (pump_id == ACTUATOR_DOSING_B) {
        if (calibration_mgr_get_rate_by_component("pump_dosing_b", &rate) != ESP_OK) {
            calibration_mgr_get_rate_by_component("dosingB", &rate);
        }
    } else if (pump_id == ACTUATOR_RAW_SUBMERSIBLE) {
        if (calibration_mgr_get_rate_by_component("pump_submersible", &rate) != ESP_OK &&
            calibration_mgr_get_rate_by_component("RAW_SUBMERSIBLE", &rate) != ESP_OK &&
            calibration_mgr_get_rate_by_component("pump_raw", &rate) != ESP_OK) {
            calibration_mgr_get_rate_by_component("raw_water_pump", &rate);
        }
    }
    return rate;
}

esp_err_t calibration_mgr_populate_dosing_rates_json(cJSON *out_obj)
{
    if (!out_obj || !s_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    for (size_t i = 0; i < s_record_count; ++i) {
        const calibration_record_t *r = &s_records[i];
        if (record_in_current_complex(r) &&
            (strcasecmp(r->calibration_type, "DOSING_RATE") == 0 || strcasecmp(r->calibration_type, "PUMP_RATE") == 0) &&
            r->has_rate && r->rate_ml_sec > 0.0f &&
            state_usable(r->state)) {
            int latest = find_latest_record_locked(r->component_id, r->calibration_type);
            if (latest >= 0 && (size_t)latest == i) {
                cJSON_AddNumberToObject(out_obj, r->component_id, r->rate_ml_sec);
            }
        }
    }
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t calibration_mgr_populate_records_json(cJSON *out_array)
{
    if (!out_array || !s_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    for (size_t i = 0; i < s_record_count; ++i) {
        const calibration_record_t *r = &s_records[i];
        if (!record_in_current_complex(r)) continue;
        if (record_superseded_locked(i)) continue;
        cJSON *o = cJSON_CreateObject();
        if (!o) continue;
        cJSON_AddStringToObject(o, "calibrationId", r->calibration_id);
        cJSON_AddStringToObject(o, "componentId", r->component_id);
        cJSON_AddStringToObject(o, "complexId", r->complex_id);
        cJSON_AddStringToObject(o, "calibrationType", r->calibration_type);
        cJSON_AddNumberToObject(o, "version", r->version);
        cJSON_AddStringToObject(o, "state", state_name(r->state));
        cJSON_AddNumberToObject(o, "createdAtMs", (double)r->created_at_ms);
        cJSON_AddNumberToObject(o, "validFromMs", (double)r->valid_from_ms);
        cJSON_AddNumberToObject(o, "validUntilMs", (double)r->valid_until_ms);
        cJSON_AddStringToObject(o, "operator", r->operator_id);
        cJSON *params = cJSON_AddObjectToObject(o, "parameters");
        if (r->has_rate) {
            cJSON_AddNumberToObject(o, "rateMlPerSec", r->rate_ml_sec);
            cJSON_AddNumberToObject(o, "flowRateMlMin", r->rate_ml_sec * 60.0);
            if (params) {
                cJSON_AddNumberToObject(params, "rateMlPerSec", r->rate_ml_sec);
                cJSON_AddNumberToObject(params, "flowRateMlMin", r->rate_ml_sec * 60.0);
                char after_buf[32];
                snprintf(after_buf, sizeof(after_buf), "%.1f ml/min", r->rate_ml_sec * 60.0);
                cJSON_AddStringToObject(params, "after", after_buf);
            }
        }
        if (r->has_linear) {
            cJSON_AddNumberToObject(o, "slope", r->slope);
            cJSON_AddNumberToObject(o, "offset", r->offset);
            if (params) {
                cJSON_AddNumberToObject(params, "slope", r->slope);
                cJSON_AddNumberToObject(params, "offset", r->offset);
            }
        }
        if (r->has_pulses_per_liter) {
            cJSON_AddNumberToObject(o, "pulsesPerLiter", r->pulses_per_liter);
            if (params) cJSON_AddNumberToObject(params, "pulsesPerLiter", r->pulses_per_liter);
        }
        cJSON_AddItemToArray(out_array, o);
    }
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t calibration_mgr_set_rate_ml_per_sec(actuator_id_t pump_id, float rate_ml_sec)
{
    const char *canonical = pump_id == ACTUATOR_DOSING_A ? "pump_dosing_a" :
                            pump_id == ACTUATOR_DOSING_B ? "pump_dosing_b" :
                            pump_id == ACTUATOR_RAW_SUBMERSIBLE ? "pump_submersible" : NULL;
    if (!canonical) return ESP_ERR_NOT_SUPPORTED;
    uint32_t version = 1;
    calibration_record_t existing;
    if (calibration_mgr_get_record(canonical, "DOSING_RATE", &existing) == ESP_OK ||
        calibration_mgr_get_record(canonical, "PUMP_RATE", &existing) == ESP_OK) {
        version = existing.version + 1;
    }
    return calibration_mgr_set_dosing_rate(canonical, rate_ml_sec, version, CAL_RECORD_RECALIBRATED, "legacy-api", 0, NULL);
}

esp_err_t calibration_mgr_apply_linear(const char *component_id, const char *calibration_type, float slope, float offset,
                                       uint32_t version, calibration_record_state_t state, const char *operator_id,
                                       int64_t valid_until_ms, const char *calibration_id)
{
    if (!s_mutex || !component_id || !calibration_type || !component_id[0] || !calibration_type[0] || version == 0) return ESP_ERR_INVALID_ARG;
    if (!calibration_type_supported(calibration_type)) return ESP_ERR_NOT_SUPPORTED;
    if (state < CAL_RECORD_NOT_CALIBRATED || state > CAL_RECORD_REMOVED) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    if (version_conflict_locked(component_id, calibration_type, version) || s_record_count >= MAX_CAL_RECORDS) {
        xSemaphoreGive(s_mutex); return s_record_count >= MAX_CAL_RECORDS ? ESP_ERR_NO_MEM : ESP_ERR_INVALID_STATE;
    }
    int idx = (int)s_record_count++;
    calibration_record_t *r = &s_records[idx]; memset(r, 0, sizeof(*r));
    copy_str(r->calibration_id, sizeof(r->calibration_id), calibration_id ? calibration_id : "device-cal");
    copy_str(r->component_id, sizeof(r->component_id), component_id);
    const char *complex_id = device_complex_id();
    if (!complex_id) { s_record_count--; xSemaphoreGive(s_mutex); return ESP_ERR_INVALID_STATE; }
    copy_str(r->complex_id, sizeof(r->complex_id), complex_id);
    copy_str(r->calibration_type, sizeof(r->calibration_type), calibration_type);
    copy_str(r->operator_id, sizeof(r->operator_id), operator_id ? operator_id : "device");
    r->version=version; r->state=state;
    time_t now_sec = time(NULL);
    if (now_sec >= 1704067200) {
        r->created_at_ms = (int64_t)now_sec * 1000LL;
        r->valid_from_ms = r->created_at_ms;
        r->valid_until_ms = valid_until_ms > 0 ? valid_until_ms : (r->created_at_ms + (int64_t)30 * 86400000LL);
    } else {
        r->created_at_ms = (int64_t)esp_timer_get_time() / 1000LL;
        r->valid_from_ms = 0;
        r->valid_until_ms = 0;
    }
    r->slope=slope; r->offset=offset; r->has_linear=true;
    esp_err_t err=persist_locked();
    if (err != ESP_OK) {
        memset(r, 0, sizeof(*r));
        s_record_count--;
    }
    xSemaphoreGive(s_mutex);
    if (err == ESP_OK) {
        (void)event_mgr_log_context(LOG_LEVEL_INFO, "CALIBRATION", "CALIBRATION_CHANGED", "Calibration record updated and persisted.",
                                    device_complex_id(), NULL, component_id, NULL, version);
    }
    return err;
}

esp_err_t calibration_mgr_set_flow_pulses_calibration(const char *component_id, float pulses_per_liter,
                                       float slope, float offset, bool has_linear, uint32_t version,
                                       calibration_record_state_t state, const char *operator_id,
                                       int64_t valid_until_ms, const char *calibration_id)
{
    if (!component_id || !component_id[0] || pulses_per_liter <= 0) return ESP_ERR_INVALID_ARG;
    if (state < CAL_RECORD_NOT_CALIBRATED || state > CAL_RECORD_REMOVED) return ESP_ERR_INVALID_ARG;
    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    int latest = find_latest_record_locked(component_id, "FLOW");
    uint32_t eff_version = version;
    if (eff_version == 0 || (latest >= 0 && eff_version <= s_records[latest].version)) {
        eff_version = (latest >= 0) ? (s_records[latest].version + 1) : 1;
    }

    if (s_record_count >= MAX_CAL_RECORDS) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_NO_MEM;
    }
    int idx=(int)s_record_count++; calibration_record_t *r=&s_records[idx]; memset(r,0,sizeof(*r));
    copy_str(r->calibration_id,sizeof(r->calibration_id),calibration_id ? calibration_id : "device-calibration");
    copy_str(r->component_id,sizeof(r->component_id),component_id);
    const char *complex_id = device_complex_id();
    if (!complex_id) { s_record_count--; xSemaphoreGive(s_mutex); return ESP_ERR_INVALID_STATE; }
    copy_str(r->complex_id,sizeof(r->complex_id),complex_id);
    copy_str(r->calibration_type,sizeof(r->calibration_type),"FLOW");
    copy_str(r->operator_id,sizeof(r->operator_id),operator_id ? operator_id : "device");
    r->version=eff_version; r->state=state;
    time_t now_sec = time(NULL);
    if (now_sec >= 1704067200) {
        r->created_at_ms = (int64_t)now_sec * 1000LL;
        r->valid_from_ms = r->created_at_ms;
        r->valid_until_ms = valid_until_ms > 0 ? valid_until_ms : (r->created_at_ms + (int64_t)30 * 86400000LL);
    } else {
        r->created_at_ms = (int64_t)esp_timer_get_time() / 1000LL;
        r->valid_from_ms = 0;
        r->valid_until_ms = 0;
    }
    r->pulses_per_liter=pulses_per_liter; r->has_pulses_per_liter=true;
    if(has_linear){r->slope=slope; r->offset=offset; r->has_linear=true;}
    const float old_raw_pulses = s_flow_raw_pulses_per_l;
    const float old_fert_pulses = s_flow_fert_pulses_per_l;
    /* Derived compatibility caches are updated before the single persistence commit. */
    hw_component_info_t info;
    if (hardware_registry_find_by_id(r->component_id,&info)==ESP_OK) {
        if (strcasestr(info.role,"RAW") || strcasestr(info.name,"RAW")) s_flow_raw_pulses_per_l=pulses_per_liter;
        else s_flow_fert_pulses_per_l=pulses_per_liter;
    }
    esp_err_t err=persist_locked();
    if (err != ESP_OK) {
        s_flow_raw_pulses_per_l = old_raw_pulses;
        s_flow_fert_pulses_per_l = old_fert_pulses;
        memset(r, 0, sizeof(*r));
        s_record_count--;
    }
    xSemaphoreGive(s_mutex);
    if (err == ESP_OK) {
        (void)event_mgr_log_context(LOG_LEVEL_INFO, "CALIBRATION", "CALIBRATION_CHANGED", "FLOW calibration record updated and persisted.",
                                    device_complex_id(), NULL, component_id, NULL, eff_version);
    }
    return err;
}

esp_err_t calibration_mgr_set_record_rate_or_linear(const char *component_id, const char *calibration_type,
                                       float rate_ml_sec, float slope, float offset, bool use_rate,
                                       uint32_t version, calibration_record_state_t state, const char *operator_id,
                                       int64_t valid_until_ms, const char *calibration_id)
{
    if (use_rate) return calibration_mgr_set_dosing_rate(component_id, rate_ml_sec, version, state, operator_id, valid_until_ms, calibration_id);
    return calibration_mgr_apply_linear(component_id, calibration_type, slope, offset, version, state, operator_id, valid_until_ms, calibration_id);
}

esp_err_t calibration_mgr_record_json(const char *component_id, const char *calibration_type, cJSON **out_json)
{
    if (!out_json) return ESP_ERR_INVALID_ARG;
    *out_json = NULL;
    calibration_record_t r;
    esp_err_t err=calibration_mgr_get_record(component_id, calibration_type, &r); if (err!=ESP_OK) return err;
    cJSON *o=cJSON_CreateObject(); if(!o) return ESP_ERR_NO_MEM;
    cJSON_AddStringToObject(o,"calibrationId",r.calibration_id); cJSON_AddStringToObject(o,"componentId",r.component_id); cJSON_AddStringToObject(o,"complexId",r.complex_id); cJSON_AddStringToObject(o,"calibrationType",r.calibration_type); cJSON_AddNumberToObject(o,"version",r.version); cJSON_AddStringToObject(o,"state",state_name(r.state)); cJSON_AddNumberToObject(o,"createdAtMs",(double)r.created_at_ms); cJSON_AddNumberToObject(o,"validFromMs",(double)r.valid_from_ms); cJSON_AddNumberToObject(o,"validUntilMs",(double)r.valid_until_ms); cJSON_AddStringToObject(o,"operator",r.operator_id); if(r.has_rate)cJSON_AddNumberToObject(o,"rateMlPerSec",r.rate_ml_sec); if(r.has_linear){cJSON_AddNumberToObject(o,"slope",r.slope);cJSON_AddNumberToObject(o,"offset",r.offset);} *out_json=o; return ESP_OK;
}

esp_err_t calibration_mgr_record_json_exact(const char *component_id, const char *calibration_type, const char *calibration_id, uint32_t version, cJSON **out_json)
{
    if (!out_json) return ESP_ERR_INVALID_ARG;
    *out_json = NULL;
    calibration_record_t r;
    esp_err_t err = calibration_mgr_get_record_exact(component_id, calibration_type, calibration_id, version, &r);
    if (err != ESP_OK) return err;
    cJSON *o = cJSON_CreateObject(); if (!o) return ESP_ERR_NO_MEM;
    cJSON_AddStringToObject(o,"calibrationId",r.calibration_id);
    cJSON_AddStringToObject(o,"componentId",r.component_id);
    cJSON_AddStringToObject(o,"complexId",r.complex_id);
    cJSON_AddStringToObject(o,"calibrationType",r.calibration_type);
    cJSON_AddNumberToObject(o,"version",r.version);
    cJSON_AddStringToObject(o,"state",state_name(r.state));
    cJSON_AddNumberToObject(o,"createdAtMs",(double)r.created_at_ms);
    cJSON_AddNumberToObject(o,"validFromMs",(double)r.valid_from_ms);
    cJSON_AddNumberToObject(o,"validUntilMs",(double)r.valid_until_ms);
    cJSON_AddStringToObject(o,"operator",r.operator_id);
    if(r.has_rate)cJSON_AddNumberToObject(o,"rateMlPerSec",r.rate_ml_sec);
    if(r.has_linear){cJSON_AddNumberToObject(o,"slope",r.slope);cJSON_AddNumberToObject(o,"offset",r.offset);} if(r.has_pulses_per_liter)cJSON_AddNumberToObject(o,"pulsesPerLiter",r.pulses_per_liter);
    *out_json=o; return ESP_OK;
}

float calibration_mgr_get_flow_raw_pulses_per_l(void) { return s_flow_raw_pulses_per_l > 0.0f ? s_flow_raw_pulses_per_l : ZJB1_PULSES_PER_LITER_DEFAULT; }
bool calibration_mgr_is_flow_raw_calibrated(void) { return calibration_mgr_get_flow_raw_pulses_per_l() > 0.0f; }
esp_err_t calibration_mgr_set_flow_raw_pulses_per_l(float pulses_per_l) { if(pulses_per_l<=0)return ESP_ERR_INVALID_ARG; if(!s_mutex)return ESP_ERR_INVALID_STATE; if(xSemaphoreTake(s_mutex,portMAX_DELAY)!=pdTRUE)return ESP_FAIL; float old=s_flow_raw_pulses_per_l; s_flow_raw_pulses_per_l=pulses_per_l; esp_err_t e=persist_locked(); if(e!=ESP_OK)s_flow_raw_pulses_per_l=old; xSemaphoreGive(s_mutex); return e; }
float calibration_mgr_get_flow_fert_pulses_per_l(void) { return s_flow_fert_pulses_per_l > 0.0f ? s_flow_fert_pulses_per_l : FS400A_PULSES_PER_LITER_DEFAULT; }
bool calibration_mgr_is_flow_fert_calibrated(void) { return calibration_mgr_get_flow_fert_pulses_per_l() > 0.0f; }
esp_err_t calibration_mgr_set_flow_fert_pulses_per_l(float pulses_per_l) { if(pulses_per_l<=0)return ESP_ERR_INVALID_ARG; if(!s_mutex)return ESP_ERR_INVALID_STATE; if(xSemaphoreTake(s_mutex,portMAX_DELAY)!=pdTRUE)return ESP_FAIL; float old=s_flow_fert_pulses_per_l; s_flow_fert_pulses_per_l=pulses_per_l; esp_err_t e=persist_locked(); if(e!=ESP_OK)s_flow_fert_pulses_per_l=old; xSemaphoreGive(s_mutex); return e; }

/* -------------------------------------------------------------
 * Canonical Mixing & Dosing hardware test execution via protocol_mixing
 * ------------------------------------------------------------- */
static bool mixing_test_abort_check(void *ctx)
{
    (void)ctx;
    return s_mixing_test_abort_requested || actuator_hal_is_emergency_stopped();
}

static void mixing_test_worker_task(void *pvParameters)
{
    (void)pvParameters;
    ESP_LOGI(TAG, "Mixing & Dosing hardware test worker task started (canonical protocol_mixing).");

    mixing_result_t res = protocol_mixing(&s_mixing_test_cfg);

    if (s_mixing_test_mutex && xSemaphoreTake(s_mixing_test_mutex, portMAX_DELAY) == pdTRUE) {
        s_mixing_test_final_res = res;
        s_mixing_test_has_result = true;
        s_mixing_test_running = false;
        s_mixing_test_task_handle = NULL;
        xSemaphoreGive(s_mixing_test_mutex);
    } else {
        s_mixing_test_running = false;
        s_mixing_test_task_handle = NULL;
    }

    if (res.status == MIXING_RESULT_SUCCESS) {
        ESP_LOGI(TAG, "Mixing & Dosing hardware test COMPLETED successfully.");
    } else {
        ESP_LOGE(TAG, "Mixing & Dosing hardware test FAILED (%s): %s",
                 mixing_status_to_string(res.status), res.message);
    }

    vTaskDelete(NULL);
}

bool calibration_mgr_is_mixing_test_running(void)
{
    return s_mixing_test_running;
}

bool calibration_mgr_is_mixing_test_recovery_required(void)
{
    if (s_mixing_test_running) return false;
    mixing_pool_t pool;
    if (mixing_pool_load(&pool) == ESP_OK && pool.is_test && pool.is_active) {
        return true;
    }
    return false;
}

esp_err_t calibration_mgr_resume_mixing_test(void)
{
    mixing_pool_t pool;
    if (mixing_pool_load(&pool) != ESP_OK || !pool.is_test || !pool.is_active) {
        return ESP_ERR_NOT_FOUND;
    }

    if (!s_mixing_test_mutex) {
        s_mixing_test_mutex = xSemaphoreCreateMutex();
        if (!s_mixing_test_mutex) return ESP_ERR_NO_MEM;
    }

    if (xSemaphoreTake(s_mixing_test_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    if (s_mixing_test_running) {
        xSemaphoreGive(s_mixing_test_mutex);
        return ESP_ERR_INVALID_STATE;
    }

    /* Concurrency protection: reject if fertigation manager is currently active */
    fertigation_state_t f_st = fertigation_mgr_get_state();
    if (f_st != FERT_STATE_IDLE && f_st != FERT_STATE_COMPLETE &&
        f_st != FERT_STATE_FAULTED && f_st != FERT_STATE_ABORTED) {
        xSemaphoreGive(s_mixing_test_mutex);
        ESP_LOGW(TAG, "Cannot resume mixing test: fertigation manager is currently busy (state=%d).", (int)f_st);
        return ESP_ERR_INVALID_STATE;
    }

    /* Safety interlock: reject if E-Stop latched */
    if (actuator_hal_is_emergency_stopped()) {
        xSemaphoreGive(s_mixing_test_mutex);
        ESP_LOGW(TAG, "Cannot resume mixing test: Emergency Stop latched.");
        return ESP_ERR_INVALID_STATE;
    }

    memset(&s_mixing_test_cfg, 0, sizeof(s_mixing_test_cfg));
    s_mixing_test_cfg.raw_water_target_ml = pool.target_raw_water_ml;
    s_mixing_test_cfg.threshold_percent = pool.threshold_percent;
    s_mixing_test_cfg.post_mix_duration_sec = pool.post_mix_duration_sec;
    strncpy(s_mixing_test_cfg.raw_water_component_id, pool.raw_water_component_id, sizeof(s_mixing_test_cfg.raw_water_component_id) - 1);
    strncpy(s_mixing_test_cfg.raw_flow_sensor_id, pool.raw_flow_sensor_id, sizeof(s_mixing_test_cfg.raw_flow_sensor_id) - 1);
    strncpy(s_mixing_test_cfg.mixing_pump_id, pool.mixing_pump_id, sizeof(s_mixing_test_cfg.mixing_pump_id) - 1);
    s_mixing_test_cfg.channel_count = pool.channel_count;
    for (uint32_t i = 0; i < pool.channel_count && i < MAX_MIXING_DOSING_CHANNELS; ++i) {
        strncpy(s_mixing_test_cfg.channels[i].component_id, pool.channels[i].component_id, sizeof(s_mixing_test_cfg.channels[i].component_id) - 1);
        s_mixing_test_cfg.channels[i].target_volume_ml = pool.channels[i].target_volume_ml;
    }
    s_mixing_test_cfg.is_test = true;
    s_mixing_test_cfg.resume_from_pool = true;
    strncpy(s_mixing_test_cfg.batch_id, pool.batch_id, sizeof(s_mixing_test_cfg.batch_id) - 1);
    s_mixing_test_cfg.abort_check = mixing_test_abort_check;
    s_mixing_test_cfg.live_result = &s_mixing_test_live_res;

    memset(&s_mixing_test_live_res, 0, sizeof(s_mixing_test_live_res));
    s_mixing_test_live_res.current_phase = (mixing_phase_t)pool.current_phase;
    s_mixing_test_live_res.target_raw_water_ml = pool.target_raw_water_ml;
    s_mixing_test_live_res.actual_raw_water_ml = pool.actual_raw_water_ml;
    s_mixing_test_live_res.channel_count = pool.channel_count;
    for (uint32_t i = 0; i < pool.channel_count && i < MAX_MIXING_DOSING_CHANNELS; ++i) {
        strncpy(s_mixing_test_live_res.channels[i].component_id, pool.channels[i].component_id, sizeof(s_mixing_test_live_res.channels[i].component_id) - 1);
        s_mixing_test_live_res.channels[i].target_volume_ml = pool.channels[i].target_volume_ml;
        s_mixing_test_live_res.channels[i].actual_runtime_ms = pool.channels[i].observed_runtime_ms;
        s_mixing_test_live_res.channels[i].completed = pool.channels[i].completed;
    }

    s_mixing_test_abort_requested = false;
    s_mixing_test_running = true;
    s_mixing_test_has_result = false;

    BaseType_t ret = xTaskCreatePinnedToCore(
        mixing_test_worker_task, "mix_test", 12288, NULL, 5,
        &s_mixing_test_task_handle, 1);
    if (ret != pdPASS) {
        s_mixing_test_running = false;
        s_mixing_test_task_handle = NULL;
        xSemaphoreGive(s_mixing_test_mutex);
        ESP_LOGE(TAG, "Failed to spawn mixing test resume task");
        return ESP_ERR_NO_MEM;
    }

    xSemaphoreGive(s_mixing_test_mutex);
    ESP_LOGI(TAG, "Safe Resume: mixing test resumed successfully from pool checkpoint.");
    return ESP_OK;
}

esp_err_t calibration_mgr_discard_mixing_test(void)
{
    mixing_pool_t pool;
    if (mixing_pool_load(&pool) == ESP_OK && pool.is_test) {
        mixing_pool_delete();
        ESP_LOGI(TAG, "Interrupted test mixing pool discarded by operator.");
    }
    if (s_mixing_test_mutex && xSemaphoreTake(s_mixing_test_mutex, portMAX_DELAY) == pdTRUE) {
        s_mixing_test_running = false;
        s_mixing_test_has_result = false;
        xSemaphoreGive(s_mixing_test_mutex);
    }
    return ESP_OK;
}

esp_err_t calibration_mgr_start_mixing_test(const mixing_protocol_config_t *config)
{
    if (!config || config->raw_water_target_ml == 0) return ESP_ERR_INVALID_ARG;

    if (!s_mixing_test_mutex) {
        s_mixing_test_mutex = xSemaphoreCreateMutex();
        if (!s_mixing_test_mutex) return ESP_ERR_NO_MEM;
    }

    if (xSemaphoreTake(s_mixing_test_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    if (s_mixing_test_running) {
        xSemaphoreGive(s_mixing_test_mutex);
        return ESP_ERR_INVALID_STATE;
    }

    /* Concurrency protection: reject if fertigation manager is currently active */
    fertigation_state_t f_st = fertigation_mgr_get_state();
    if (f_st != FERT_STATE_IDLE && f_st != FERT_STATE_COMPLETE &&
        f_st != FERT_STATE_FAULTED && f_st != FERT_STATE_ABORTED) {
        xSemaphoreGive(s_mixing_test_mutex);
        ESP_LOGW(TAG, "Cannot start mixing test: fertigation manager is currently busy (state=%d).", (int)f_st);
        return ESP_ERR_INVALID_STATE;
    }

    /* Safety interlock: reject if E-Stop latched */
    if (actuator_hal_is_emergency_stopped()) {
        xSemaphoreGive(s_mixing_test_mutex);
        ESP_LOGW(TAG, "Cannot start mixing test: Emergency Stop latched.");
        return ESP_ERR_INVALID_STATE;
    }

    memset(&s_mixing_test_cfg, 0, sizeof(s_mixing_test_cfg));
    s_mixing_test_cfg = *config;
    s_mixing_test_cfg.is_test = true;
    s_mixing_test_cfg.resume_from_pool = false;
    if (!s_mixing_test_cfg.batch_id[0]) {
        strncpy(s_mixing_test_cfg.batch_id, "test-mixing", sizeof(s_mixing_test_cfg.batch_id) - 1);
    }
    s_mixing_test_cfg.abort_check = mixing_test_abort_check;
    s_mixing_test_cfg.live_result = &s_mixing_test_live_res;

    memset(&s_mixing_test_live_res, 0, sizeof(s_mixing_test_live_res));
    s_mixing_test_live_res.current_phase = MIXING_PHASE_PRECHECK;
    s_mixing_test_live_res.target_raw_water_ml = config->raw_water_target_ml;
    s_mixing_test_live_res.channel_count = config->channel_count;
    for (uint32_t i = 0; i < config->channel_count && i < MAX_MIXING_DOSING_CHANNELS; ++i) {
        strncpy(s_mixing_test_live_res.channels[i].component_id, config->channels[i].component_id, sizeof(s_mixing_test_live_res.channels[i].component_id) - 1);
        s_mixing_test_live_res.channels[i].target_volume_ml = config->channels[i].target_volume_ml;
    }

    s_mixing_test_abort_requested = false;
    s_mixing_test_running = true;
    s_mixing_test_has_result = false;

    BaseType_t ret = xTaskCreatePinnedToCore(
        mixing_test_worker_task, "mix_test", 12288, NULL, 5,
        &s_mixing_test_task_handle, 1);
    if (ret != pdPASS) {
        s_mixing_test_running = false;
        s_mixing_test_task_handle = NULL;
        xSemaphoreGive(s_mixing_test_mutex);
        ESP_LOGE(TAG, "Failed to spawn mixing test task");
        return ESP_ERR_NO_MEM;
    }

    xSemaphoreGive(s_mixing_test_mutex);
    return ESP_OK;
}

esp_err_t calibration_mgr_stop_mixing_test(void)
{
    if (!s_mixing_test_mutex) return ESP_OK;
    if (xSemaphoreTake(s_mixing_test_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    if (!s_mixing_test_running) {
        xSemaphoreGive(s_mixing_test_mutex);
        return ESP_OK;
    }

    s_mixing_test_abort_requested = true;
    (void)stop_mixing_protocol_actuators(&s_mixing_test_cfg);
    xSemaphoreGive(s_mixing_test_mutex);
    ESP_LOGI(TAG, "Mixing & Dosing hardware test abort requested.");
    return ESP_OK;
}

esp_err_t calibration_mgr_get_mixing_test_status(cJSON **out_json)
{
    if (!out_json) return ESP_ERR_INVALID_ARG;
    *out_json = NULL;

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;

    if (!s_mixing_test_mutex) {
        s_mixing_test_mutex = xSemaphoreCreateMutex();
    }
    if (s_mixing_test_mutex) {
        xSemaphoreTake(s_mixing_test_mutex, portMAX_DELAY);
    }

    bool running = s_mixing_test_running;
    bool has_result = s_mixing_test_has_result;
    mixing_result_t snap = running ? s_mixing_test_live_res : s_mixing_test_final_res;
    mixing_protocol_config_t cfg_snap = s_mixing_test_cfg;

    if (s_mixing_test_mutex) {
        xSemaphoreGive(s_mixing_test_mutex);
    }

    bool recovery_required = calibration_mgr_is_mixing_test_recovery_required();
    cJSON_AddBoolToObject(root, "recoveryRequired", recovery_required);
    if (recovery_required) {
        cJSON *pool_json = NULL;
        if (mixing_pool_get_status_json(&pool_json) == ESP_OK && pool_json) {
            cJSON_AddItemToObject(root, "recoveryPool", pool_json);
        }
    }

    const char *state_str = "IDLE";
    if (running) {
        state_str = "RUNNING";
    } else if (recovery_required) {
        state_str = "RECOVERY_HOLD";
    } else if (has_result) {
        state_str = (snap.status == MIXING_RESULT_SUCCESS) ? "SUCCESS" : "ERROR";
    }

    cJSON_AddStringToObject(root, "status", state_str);
    cJSON_AddStringToObject(root, "phase", mixing_phase_to_string(snap.current_phase));
    cJSON_AddNumberToObject(root, "rawWaterTargetMl", (double)(snap.target_raw_water_ml > 0 ? snap.target_raw_water_ml : cfg_snap.raw_water_target_ml));
    cJSON_AddNumberToObject(root, "rawWaterActualMl", (double)snap.actual_raw_water_ml);
    cJSON_AddNumberToObject(root, "thresholdPercent", (double)cfg_snap.threshold_percent);
    cJSON_AddNumberToObject(root, "postMixDurationSec", (double)cfg_snap.post_mix_duration_sec);
    cJSON_AddNumberToObject(root, "totalRuntimeMs", (double)snap.total_runtime_ms);

    if (snap.error_code && snap.error_code[0]) {
        cJSON_AddStringToObject(root, "errorCode", snap.error_code);
    } else if (snap.status != MIXING_RESULT_SUCCESS && has_result) {
        cJSON_AddStringToObject(root, "errorCode", mixing_status_to_string(snap.status));
    } else {
        cJSON_AddNullToObject(root, "errorCode");
    }

    if (snap.message[0]) {
        cJSON_AddStringToObject(root, "message", snap.message);
    } else {
        cJSON_AddStringToObject(root, "message", running ? "Test running" : (recovery_required ? "Test mixing interrupted by power loss. Operator action required." : (has_result ? (snap.status == MIXING_RESULT_SUCCESS ? "Test completed successfully" : "Test failed") : "No test running")));
    }

    cJSON *arr = cJSON_AddArrayToObject(root, "channels");
    uint32_t count = snap.channel_count > 0 ? snap.channel_count : cfg_snap.channel_count;
    for (uint32_t i = 0; i < count && i < MAX_MIXING_DOSING_CHANNELS; ++i) {
        cJSON *ch = cJSON_CreateObject();
        const char *cid = snap.channels[i].component_id[0] ? snap.channels[i].component_id : cfg_snap.channels[i].component_id;
        cJSON_AddStringToObject(ch, "componentId", cid);
        cJSON_AddNumberToObject(ch, "targetVolumeMl", (double)(snap.channels[i].target_volume_ml > 0 ? snap.channels[i].target_volume_ml : cfg_snap.channels[i].target_volume_ml));
        cJSON_AddNumberToObject(ch, "calibrationRateMlSec", (double)snap.channels[i].calibration_rate_ml_sec);
        cJSON_AddNumberToObject(ch, "expectedRuntimeMs", (double)snap.channels[i].expected_runtime_ms);
        cJSON_AddNumberToObject(ch, "actualRuntimeMs", (double)snap.channels[i].actual_runtime_ms);
        cJSON_AddBoolToObject(ch, "completed", snap.channels[i].completed);
        cJSON_AddStringToObject(ch, "status", snap.channels[i].completed ? "COMPLETED" : (running ? "RUNNING" : "PENDING"));
        cJSON_AddItemToArray(arr, ch);
    }

    *out_json = root;
    return ESP_OK;
}
