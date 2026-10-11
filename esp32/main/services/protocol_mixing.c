#include "services/protocol_mixing.h"
#include "hal/actuator_hal.h"
#include "hal/sensor_hal.h"
#include "services/calibration_mgr.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <math.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include "esp_rom_crc.h"
#include "hal/microsd_hal.h"

static const char *TAG = "MIXING_CORE";

#define DEFAULT_NO_FLOW_GRACE_SEC       15
#define DEFAULT_POLL_INTERVAL_MS        100

typedef struct {
    char component_id[40];
    uint32_t target_volume_ml;
    float rate_ml_sec;
    uint32_t expected_runtime_ms;
    uint32_t max_runtime_ms;
    uint32_t start_time_ms;
    uint32_t observed_runtime_ms;
    bool is_running;
    bool completed;
} channel_execution_state_t;

typedef struct {
    char component_id[40];
    actuator_id_t fallback_aid;
    bool acquired_by_component;
    bool acquired_by_fallback;
    bool is_on;
} scoped_actuator_t;

typedef struct {
    scoped_actuator_t raw_water;
    scoped_actuator_t mixing_pump;
    scoped_actuator_t dosing[MAX_MIXING_DOSING_CHANNELS];
    uint32_t channel_count;
} mixing_job_actuators_t;

const char *mixing_status_to_string(mixing_status_code_t status)
{
    switch (status) {
        case MIXING_RESULT_SUCCESS:
            return "MIXING_SUCCESS";
        case MIXING_RESULT_INVALID_CONFIG:
            return "MIXING_INVALID_CONFIG";
        case MIXING_RESULT_CALIBRATION_MISSING:
            return "MIXING_CALIBRATION_MISSING";
        case MIXING_RESULT_RAW_WATER_SENSOR_ERROR:
            return "MIXING_RAW_WATER_SENSOR_ERROR";
        case MIXING_RESULT_RAW_WATER_NO_FLOW:
            return "MIXING_RAW_WATER_NO_FLOW";
        case MIXING_RESULT_RAW_WATER_TIMEOUT:
            return "MIXING_RAW_WATER_TIMEOUT";
        case MIXING_RESULT_DOSING_ERROR:
            return "MIXING_DOSING_ERROR";
        case MIXING_RESULT_DOSING_TIMEOUT:
            return "MIXING_DOSING_TIMEOUT";
        case MIXING_RESULT_ACTUATOR_ERROR:
            return "MIXING_ACTUATOR_ERROR";
        case MIXING_RESULT_EMERGENCY_STOP:
            return "MIXING_EMERGENCY_STOP";
        case MIXING_RESULT_POST_MIX_DURATION_SEMANTICS_UNDEFINED:
            return "POST_MIX_DURATION_SEMANTICS_UNDEFINED";
        default:
            return "MIXING_UNKNOWN_ERROR";
    }
}

const char *mixing_phase_to_string(mixing_phase_t phase)
{
    switch (phase) {
        case MIXING_PHASE_IDLE:
            return "IDLE";
        case MIXING_PHASE_PRECHECK:
            return "PRECHECK";
        case MIXING_PHASE_RAW_WATER_FILL:
            return "RAW_WATER_FILL";
        case MIXING_PHASE_THRESHOLD_REACHED:
            return "THRESHOLD_REACHED";
        case MIXING_PHASE_MIXING_AND_DOSING:
            return "MIXING_AND_DOSING";
        case MIXING_PHASE_RAW_WATER_COMPLETE:
            return "RAW_WATER_COMPLETE";
        case MIXING_PHASE_DOSING_COMPLETION:
            return "DOSING_COMPLETION";
        case MIXING_PHASE_POST_MIX:
            return "POST_MIX";
        case MIXING_PHASE_STOP:
            return "STOP";
        case MIXING_PHASE_SUCCESS:
            return "SUCCESS";
        case MIXING_PHASE_ERROR:
            return "ERROR";
        default:
            return "UNKNOWN";
    }
}

static esp_err_t set_actuator_state(const char *component_id, bool on)
{
    if (!component_id || !component_id[0]) return ESP_ERR_INVALID_ARG;
    esp_err_t err = actuator_hal_request_component(component_id, on,
                                                   ACTUATOR_SOURCE_FERTIGATION,
                                                   on ? "mixing_on" : "mixing_off");
    if (err != ESP_OK) {
        actuator_id_t fallback_aid = ACTUATOR_MAX_COUNT;
        if (actuator_hal_find_id_by_component_id(component_id, &fallback_aid) == ESP_OK) {
            err = actuator_hal_request(fallback_aid, on,
                                       ACTUATOR_SOURCE_FERTIGATION,
                                       on ? "mixing_on_legacy" : "mixing_off_legacy");
        }
    }
    return err;
}

static esp_err_t release_actuator(const char *component_id, actuator_owner_t owner)
{
    if (!component_id || !component_id[0]) return ESP_ERR_INVALID_ARG;
    actuator_hal_release_component(component_id, owner);
    actuator_id_t fallback_aid = ACTUATOR_MAX_COUNT;
    if (actuator_hal_find_id_by_component_id(component_id, &fallback_aid) == ESP_OK) {
        actuator_hal_release(fallback_aid, owner);
    }
    return ESP_OK;
}

static esp_err_t acquire_scoped_actuator(scoped_actuator_t *act, const char *component_id, actuator_id_t default_fallback)
{
    if (!act || !component_id || !component_id[0]) return ESP_ERR_INVALID_ARG;
    memset(act, 0, sizeof(*act));
    strncpy(act->component_id, component_id, sizeof(act->component_id) - 1);
    act->fallback_aid = default_fallback;

    esp_err_t err = actuator_hal_acquire_component(component_id, ACTUATOR_OWNER_FERTIGATION);
    if (err == ESP_OK) {
        act->acquired_by_component = true;
        return ESP_OK;
    }

    actuator_id_t resolved_aid = ACTUATOR_MAX_COUNT;
    if (actuator_hal_find_id_by_component_id(component_id, &resolved_aid) == ESP_OK) {
        act->fallback_aid = resolved_aid;
    }

    if (act->fallback_aid < ACTUATOR_MAX_COUNT) {
        err = actuator_hal_acquire(act->fallback_aid, ACTUATOR_OWNER_FERTIGATION);
        if (err == ESP_OK) {
            act->acquired_by_fallback = true;
            return ESP_OK;
        }
    }

    return err;
}

static esp_err_t set_scoped_actuator_state(scoped_actuator_t *act, bool on)
{
    if (!act || (!act->acquired_by_component && !act->acquired_by_fallback)) {
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = ESP_FAIL;
    if (act->acquired_by_component) {
        err = actuator_hal_request_component(act->component_id, on,
                                             ACTUATOR_SOURCE_FERTIGATION,
                                             on ? "scoped_on" : "scoped_off");
    }
    if (err != ESP_OK && act->acquired_by_fallback && act->fallback_aid < ACTUATOR_MAX_COUNT) {
        err = actuator_hal_request(act->fallback_aid, on,
                                   ACTUATOR_SOURCE_FERTIGATION,
                                   on ? "scoped_on_legacy" : "scoped_off_legacy");
    }
    if (err == ESP_OK) {
        act->is_on = on;
    }
    return err;
}

static void release_scoped_actuator(scoped_actuator_t *act)
{
    if (!act) return;
    if (act->is_on) {
        (void)set_scoped_actuator_state(act, false);
    }
    if (act->acquired_by_component) {
        actuator_hal_release_component(act->component_id, ACTUATOR_OWNER_FERTIGATION);
        act->acquired_by_component = false;
    }
    if (act->acquired_by_fallback && act->fallback_aid < ACTUATOR_MAX_COUNT) {
        actuator_hal_release(act->fallback_aid, ACTUATOR_OWNER_FERTIGATION);
        act->acquired_by_fallback = false;
    }
    act->is_on = false;
}

static void stop_job_scoped_actuators(mixing_job_actuators_t *job)
{
    if (!job) return;
    release_scoped_actuator(&job->raw_water);
    release_scoped_actuator(&job->mixing_pump);
    for (uint32_t i = 0; i < job->channel_count && i < MAX_MIXING_DOSING_CHANNELS; ++i) {
        release_scoped_actuator(&job->dosing[i]);
    }
    ESP_LOGI(TAG, "Safe Stop: job-scoped actuators forced OFF and released.");
}

static float get_pump_calibration_rate(const char *component_id, actuator_id_t fallback_id)
{
    float rate = 0.0f;
    if (component_id && component_id[0]) {
        if (calibration_mgr_get_rate_by_component(component_id, &rate) == ESP_OK && rate > 0.0f) {
            return rate;
        }
    }
    if (fallback_id < ACTUATOR_MAX_COUNT) {
        rate = calibration_mgr_get_rate_ml_per_sec(fallback_id);
        if (rate > 0.0f) return rate;
    }
    return 0.0f;
}

esp_err_t stop_mixing_protocol_actuators(const mixing_protocol_config_t *config)
{
    if (!config) return ESP_ERR_INVALID_ARG;

    const char *raw_pump = config->raw_water_component_id[0]
                           ? config->raw_water_component_id : "pump_submersible";
    const char *mixing_pump = config->mixing_pump_id[0]
                             ? config->mixing_pump_id : "mixing_pump";

    // Stop and release raw water pump configured for this job
    (void)set_actuator_state(raw_pump, false);
    (void)release_actuator(raw_pump, ACTUATOR_OWNER_FERTIGATION);

    // Stop and release mixing pump configured for this job
    (void)set_actuator_state(mixing_pump, false);
    (void)release_actuator(mixing_pump, ACTUATOR_OWNER_FERTIGATION);

    // Stop and release ONLY the dosing pumps configured for this job
    for (uint32_t i = 0; i < config->channel_count && i < MAX_MIXING_DOSING_CHANNELS; ++i) {
        if (config->channels[i].component_id[0]) {
            (void)set_actuator_state(config->channels[i].component_id, false);
            (void)release_actuator(config->channels[i].component_id, ACTUATOR_OWNER_FERTIGATION);
        }
    }

    ESP_LOGI(TAG, "Safe Stop: protocol actuators for configured job forced OFF and released without affecting unowned actuators.");
    return ESP_OK;
}

static inline void sync_live_result(const mixing_protocol_config_t *config, const mixing_result_t *res)
{
    if (config && config->live_result) {
        *config->live_result = *res;
    }
}

esp_err_t mixing_pool_save(const mixing_pool_t *pool)
{
    if (!pool) return ESP_ERR_INVALID_ARG;
    mixing_pool_t cp = *pool;
    cp.crc32 = esp_rom_crc32_le(0, (const uint8_t *)&cp, offsetof(mixing_pool_t, crc32));

    const char *paths[] = { MIXING_POOL_FILE, MIXING_POOL_FALLBACK_FILE };
    esp_err_t ret = ESP_FAIL;

    for (size_t p = 0; p < 2; ++p) {
        if (p == 0 && !microsd_hal_is_mounted()) continue;
        FILE *f = fopen(paths[p], "wb");
        if (f) {
            size_t written = fwrite(&cp, 1, sizeof(cp), f);
            fclose(f);
            if (written == sizeof(cp)) {
                ret = ESP_OK;
            }
        }
    }
    return ret;
}

esp_err_t mixing_pool_load(mixing_pool_t *out_pool)
{
    if (!out_pool) return ESP_ERR_INVALID_ARG;
    const char *paths[] = { MIXING_POOL_FILE, MIXING_POOL_FALLBACK_FILE };
    mixing_pool_t temp;

    for (size_t p = 0; p < 2; ++p) {
        if (p == 0 && !microsd_hal_is_mounted()) continue;
        FILE *f = fopen(paths[p], "rb");
        if (!f) continue;
        size_t n = fread(&temp, 1, sizeof(temp), f);
        fclose(f);
        if (n == sizeof(temp) &&
            temp.magic == MIXING_POOL_MAGIC &&
            temp.version == MIXING_POOL_VERSION &&
            temp.is_active) {
            uint32_t expected_crc = esp_rom_crc32_le(0, (const uint8_t *)&temp, offsetof(mixing_pool_t, crc32));
            if (temp.crc32 == expected_crc) {
                *out_pool = temp;
                return ESP_OK;
            } else {
                ESP_LOGW(TAG, "Mixing pool CRC mismatch on %s", paths[p]);
            }
        }
    }
    return ESP_ERR_NOT_FOUND;
}

esp_err_t mixing_pool_delete(void)
{
    if (microsd_hal_is_mounted()) {
        unlink(MIXING_POOL_FILE);
    }
    unlink(MIXING_POOL_FALLBACK_FILE);
    ESP_LOGI(TAG, "Mixing checkpoint pool unlinked and deleted.");
    return ESP_OK;
}

bool mixing_pool_exists(void)
{
    mixing_pool_t temp;
    return (mixing_pool_load(&temp) == ESP_OK);
}

esp_err_t mixing_pool_get_status_json(cJSON **out_json)
{
    if (!out_json) return ESP_ERR_INVALID_ARG;
    *out_json = NULL;

    mixing_pool_t pool;
    if (mixing_pool_load(&pool) != ESP_OK) {
        return ESP_ERR_NOT_FOUND;
    }

    cJSON *root = cJSON_CreateObject();
    if (!root) return ESP_ERR_NO_MEM;

    cJSON_AddBoolToObject(root, "isTest", pool.is_test);
    cJSON_AddBoolToObject(root, "isActive", pool.is_active);
    cJSON_AddNumberToObject(root, "sequence", pool.sequence);
    cJSON_AddNumberToObject(root, "timestampMs", (double)pool.timestamp_ms);
    cJSON_AddStringToObject(root, "batchId", pool.batch_id);
    cJSON_AddStringToObject(root, "complexId", pool.complex_id);
    cJSON_AddStringToObject(root, "ghId", pool.gh_id);
    cJSON_AddStringToObject(root, "recipeId", pool.recipe_id);
    cJSON_AddNumberToObject(root, "targetRawWaterMl", pool.target_raw_water_ml);
    cJSON_AddNumberToObject(root, "actualRawWaterMl", pool.actual_raw_water_ml);
    uint32_t rem_water = pool.target_raw_water_ml > pool.actual_raw_water_ml
                         ? (pool.target_raw_water_ml - pool.actual_raw_water_ml) : 0;
    cJSON_AddNumberToObject(root, "remainingRawWaterMl", rem_water);
    cJSON_AddNumberToObject(root, "thresholdPercent", pool.threshold_percent);
    cJSON_AddBoolToObject(root, "thresholdReached", pool.threshold_reached);
    cJSON_AddBoolToObject(root, "rawWaterCompleted", pool.raw_water_completed);
    cJSON_AddStringToObject(root, "currentPhase", mixing_phase_to_string((mixing_phase_t)pool.current_phase));

    cJSON *ch_arr = cJSON_AddArrayToObject(root, "channels");
    for (uint32_t i = 0; i < pool.channel_count && i < MAX_MIXING_DOSING_CHANNELS; ++i) {
        cJSON *ch = cJSON_CreateObject();
        cJSON_AddStringToObject(ch, "componentId", pool.channels[i].component_id);
        cJSON_AddNumberToObject(ch, "targetVolumeMl", pool.channels[i].target_volume_ml);
        cJSON_AddNumberToObject(ch, "expectedRuntimeMs", pool.channels[i].expected_runtime_ms);
        cJSON_AddNumberToObject(ch, "observedRuntimeMs", pool.channels[i].observed_runtime_ms);
        uint32_t rem_ms = pool.channels[i].expected_runtime_ms > pool.channels[i].observed_runtime_ms
                          ? (pool.channels[i].expected_runtime_ms - pool.channels[i].observed_runtime_ms) : 0;
        cJSON_AddNumberToObject(ch, "remainingRuntimeMs", rem_ms);
        cJSON_AddBoolToObject(ch, "completed", pool.channels[i].completed);
        cJSON_AddItemToArray(ch_arr, ch);
    }

    cJSON_AddNumberToObject(root, "postMixDurationSec", pool.post_mix_duration_sec);
    cJSON_AddNumberToObject(root, "postMixElapsedMs", pool.post_mix_elapsed_ms);
    cJSON_AddBoolToObject(root, "postMixCompleted", pool.post_mix_completed);

    *out_json = root;
    return ESP_OK;
}

mixing_result_t protocol_mixing(const mixing_protocol_config_t *config)
{
    mixing_result_t result;
    memset(&result, 0, sizeof(result));
    result.current_phase = MIXING_PHASE_PRECHECK;
    result.final_phase = MIXING_PHASE_PRECHECK;
    sync_live_result(config, &result);

    /* -------------------------------------------------------------
     * 1. PRECHECK - CONFIGURATION VALIDATION
     * ------------------------------------------------------------- */
    if (!config) {
        result.status = MIXING_RESULT_INVALID_CONFIG;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "Config pointer is NULL.");
        return result;
    }

    if (config->raw_water_target_ml == 0) {
        result.status = MIXING_RESULT_INVALID_CONFIG;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "raw_water_target_ml must be greater than 0.");
        return result;
    }

    if (config->post_mix_duration_sec == 0) {
        result.status = MIXING_RESULT_POST_MIX_DURATION_SEMANTICS_UNDEFINED;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "post_mix_duration_sec is 0: semantics undefined.");
        return result;
    }

    if (config->channel_count > MAX_MIXING_DOSING_CHANNELS) {
        result.status = MIXING_RESULT_INVALID_CONFIG;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "channel_count (%u) exceeds maximum (%d).",
                 (unsigned)config->channel_count, MAX_MIXING_DOSING_CHANNELS);
        return result;
    }

    result.target_raw_water_ml = config->raw_water_target_ml;
    result.channel_count = config->channel_count;

    for (uint32_t i = 0; i < config->channel_count; ++i) {
        if (!config->channels[i].component_id[0]) {
            result.status = MIXING_RESULT_INVALID_CONFIG;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message), "Channel %u component_id is empty.", (unsigned)i);
            return result;
        }
        if (config->channels[i].target_volume_ml == 0) {
            result.status = MIXING_RESULT_INVALID_CONFIG;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message), "Channel %u target_volume_ml must be greater than 0.", (unsigned)i);
            return result;
        }
    }

    /* -------------------------------------------------------------
     * 2. PRECHECK - EMERGENCY STOP CHECK
     * ------------------------------------------------------------- */
    if (actuator_hal_is_emergency_stopped() || (config->abort_check && config->abort_check(config->user_ctx))) {
        result.status = MIXING_RESULT_EMERGENCY_STOP;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "Emergency stop is active before protocol start.");
        stop_mixing_protocol_actuators(config);
        return result;
    }

    /* -------------------------------------------------------------
     * 3. PRECHECK - FLOW SENSOR CALIBRATION AUDIT
     * ------------------------------------------------------------- */
    if (!calibration_mgr_is_flow_raw_calibrated() || calibration_mgr_get_flow_raw_pulses_per_l() <= 0.0f) {
        result.status = MIXING_RESULT_CALIBRATION_MISSING;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "Raw water flow sensor (ZJ-B1) has no valid pulse calibration.");
        ESP_LOGE(TAG, "%s", result.message);
        return result;
    }

    sensor_readings_t initial_readings;
    if (sensor_hal_get_readings(&initial_readings) != ESP_OK || !initial_readings.raw_zjb1_calibrated) {
        result.status = MIXING_RESULT_RAW_WATER_SENSOR_ERROR;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "Sensor HAL indicates raw flow sensor is unverified/error.");
        ESP_LOGE(TAG, "%s", result.message);
        return result;
    }

    /* -------------------------------------------------------------
     * 4. PRECHECK - RAW WATER PUMP CALIBRATION AUDIT
     * ------------------------------------------------------------- */
    const char *raw_pump_id = config->raw_water_component_id[0]
                             ? config->raw_water_component_id : "pump_submersible";
    const char *raw_sensor_id = config->raw_flow_sensor_id[0]
                               ? config->raw_flow_sensor_id : "sensor_flow_raw";
    float raw_rate_ml_sec = get_pump_calibration_rate(raw_pump_id, ACTUATOR_RAW_SUBMERSIBLE);
    if (raw_rate_ml_sec <= 0.0f) {
        result.status = MIXING_RESULT_CALIBRATION_MISSING;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "Raw water pump '%s' calibration missing or <= 0 ml/s.", raw_pump_id);
        ESP_LOGE(TAG, "%s", result.message);
        return result;
    }

    // Expected runtime in seconds
    float expected_raw_sec_f = (float)config->raw_water_target_ml / raw_rate_ml_sec;
    uint32_t expected_raw_sec = (uint32_t)ceilf(expected_raw_sec_f);
    result.raw_water_expected_runtime_sec = expected_raw_sec;

    // Timeout: strictly expected_time * 1.5
    float max_raw_sec_f = expected_raw_sec_f * 1.5f;
    uint32_t max_raw_runtime_ms = (uint32_t)roundf(max_raw_sec_f * 1000.0f);
    uint32_t max_raw_runtime_sec = (uint32_t)ceilf(max_raw_sec_f);

    /* -------------------------------------------------------------
     * 5. PRECHECK - DOSING CHANNELS CALIBRATION AUDIT & RESUME RESTORATION
     * ------------------------------------------------------------- */
    channel_execution_state_t exec_channels[MAX_MIXING_DOSING_CHANNELS];
    memset(exec_channels, 0, sizeof(exec_channels));

    mixing_pool_t pool;
    memset(&pool, 0, sizeof(pool));
    bool is_resuming = config->resume_from_pool;
    if (is_resuming) {
        if (mixing_pool_load(&pool) == ESP_OK) {
            ESP_LOGI(TAG, "Safe Resume: Loaded existing mixing pool checkpoint seq=%u for batch=%s",
                     (unsigned)pool.sequence, pool.batch_id);
        } else {
            ESP_LOGW(TAG, "Safe Resume requested but pool checkpoint not found or invalid. Fallback to fresh run.");
            is_resuming = false;
        }
    }

    for (uint32_t i = 0; i < config->channel_count; ++i) {
        const char *ch_id = config->channels[i].component_id;
        actuator_id_t fallback_aid = (strcasecmp(ch_id, "pump_dosing_a") == 0 || strcasecmp(ch_id, "dosingA") == 0)
                                     ? ACTUATOR_DOSING_A
                                     : (strcasecmp(ch_id, "pump_dosing_b") == 0 || strcasecmp(ch_id, "dosingB") == 0)
                                     ? ACTUATOR_DOSING_B : ACTUATOR_MAX_COUNT;

        float d_rate = get_pump_calibration_rate(ch_id, fallback_aid);
        if (d_rate <= 0.0f) {
            result.status = MIXING_RESULT_CALIBRATION_MISSING;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message), "Dosing pump '%s' calibration missing or <= 0 ml/s.", ch_id);
            ESP_LOGE(TAG, "%s", result.message);
            return result;
        }

        uint32_t req_ml = config->channels[i].target_volume_ml;
        float expected_dosing_sec_f = (float)req_ml / d_rate;
        uint32_t run_ms = (uint32_t)roundf(expected_dosing_sec_f * 1000.0f);
        if (run_ms == 0) run_ms = 1; // minimum tick

        // Timeout: strictly expected_time * 1.5
        uint32_t max_run_ms = (uint32_t)roundf((float)run_ms * 1.5f);

        strncpy(exec_channels[i].component_id, ch_id, sizeof(exec_channels[i].component_id) - 1);
        exec_channels[i].target_volume_ml = req_ml;
        exec_channels[i].rate_ml_sec = d_rate;
        exec_channels[i].expected_runtime_ms = run_ms;
        exec_channels[i].max_runtime_ms = max_run_ms;

        strncpy(result.channels[i].component_id, ch_id, sizeof(result.channels[i].component_id) - 1);
        result.channels[i].target_volume_ml = req_ml;
        result.channels[i].calibration_rate_ml_sec = d_rate;
        result.channels[i].expected_runtime_ms = run_ms;
        result.channels[i].completed = false;

        // If resuming, restore observed runtime and completed status from pool
        if (is_resuming) {
            for (uint32_t p = 0; p < pool.channel_count; ++p) {
                if (strcmp(pool.channels[p].component_id, exec_channels[i].component_id) == 0) {
                    exec_channels[i].observed_runtime_ms = pool.channels[p].observed_runtime_ms;
                    exec_channels[i].completed = pool.channels[p].completed ||
                                                 (exec_channels[i].observed_runtime_ms >= exec_channels[i].expected_runtime_ms);
                    result.channels[i].actual_runtime_ms = exec_channels[i].observed_runtime_ms;
                    result.channels[i].completed = exec_channels[i].completed;
                    ESP_LOGI(TAG, "Resume channel '%s': observed=%u ms / target=%u ms, completed=%d",
                             exec_channels[i].component_id, (unsigned)exec_channels[i].observed_runtime_ms,
                             (unsigned)exec_channels[i].expected_runtime_ms, (int)exec_channels[i].completed);
                    break;
                }
            }
        }
    }

    /* -------------------------------------------------------------
     * 6. PRECHECK - ACTUATOR ACQUISITION (SCOPED OWNERSHIP)
     * ------------------------------------------------------------- */
    const char *mixing_pump_id = config->mixing_pump_id[0]
                                ? config->mixing_pump_id : "mixing_pump";

    mixing_job_actuators_t job_actuators;
    memset(&job_actuators, 0, sizeof(job_actuators));
    job_actuators.channel_count = config->channel_count;

    if (acquire_scoped_actuator(&job_actuators.raw_water, raw_pump_id, ACTUATOR_RAW_SUBMERSIBLE) != ESP_OK) {
        result.status = MIXING_RESULT_ACTUATOR_ERROR;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "Failed to acquire raw water pump '%s'.", raw_pump_id);
        stop_job_scoped_actuators(&job_actuators);
        return result;
    }

    if (acquire_scoped_actuator(&job_actuators.mixing_pump, mixing_pump_id, ACTUATOR_MIXING_PUMP) != ESP_OK) {
        result.status = MIXING_RESULT_ACTUATOR_ERROR;
        result.error_code = mixing_status_to_string(result.status);
        result.current_phase = MIXING_PHASE_ERROR;
        result.final_phase = MIXING_PHASE_ERROR;
        snprintf(result.message, sizeof(result.message), "Failed to acquire mixing pump '%s'.", mixing_pump_id);
        stop_job_scoped_actuators(&job_actuators);
        return result;
    }

    for (uint32_t i = 0; i < config->channel_count; ++i) {
        actuator_id_t fallback_aid = (strcasecmp(exec_channels[i].component_id, "pump_dosing_a") == 0 ||
                                      strcasecmp(exec_channels[i].component_id, "dosingA") == 0)
                                     ? ACTUATOR_DOSING_A
                                     : (strcasecmp(exec_channels[i].component_id, "pump_dosing_b") == 0 ||
                                        strcasecmp(exec_channels[i].component_id, "dosingB") == 0)
                                     ? ACTUATOR_DOSING_B : ACTUATOR_MAX_COUNT;

        if (acquire_scoped_actuator(&job_actuators.dosing[i], exec_channels[i].component_id, fallback_aid) != ESP_OK) {
            result.status = MIXING_RESULT_ACTUATOR_ERROR;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message), "Failed to acquire dosing pump '%s'.", exec_channels[i].component_id);
            stop_job_scoped_actuators(&job_actuators);
            return result;
        }
    }

    /* -------------------------------------------------------------
     * 7. BASELINE, THRESHOLD & PERSISTENT POOL INITIALIZATION
     * ------------------------------------------------------------- */
    uint32_t prev_delivered_ml = is_resuming ? pool.actual_raw_water_ml : 0;
    uint32_t current_sensor_ml = initial_readings.total_ml_raw_zjb1;
    uint32_t start_flow_ml = (current_sensor_ml >= prev_delivered_ml)
                             ? (current_sensor_ml - prev_delivered_ml)
                             : 0;

    uint32_t threshold_volume_ml = (uint32_t)(((uint64_t)config->raw_water_target_ml * config->threshold_percent) / 100ULL);

    uint32_t no_flow_grace_sec = config->no_flow_grace_period_sec > 0
                                 ? config->no_flow_grace_period_sec : DEFAULT_NO_FLOW_GRACE_SEC;
    uint32_t poll_delay_ms = config->poll_interval_ms > 0
                             ? config->poll_interval_ms : DEFAULT_POLL_INTERVAL_MS;

    if (!is_resuming) {
        memset(&pool, 0, sizeof(pool));
        pool.magic = MIXING_POOL_MAGIC;
        pool.version = MIXING_POOL_VERSION;
        pool.is_test = config->is_test;
        pool.is_active = true;
        pool.sequence = 1;
        pool.timestamp_ms = esp_timer_get_time() / 1000LL;
        strncpy(pool.batch_id, config->batch_id, sizeof(pool.batch_id) - 1);
        strncpy(pool.complex_id, config->complex_id, sizeof(pool.complex_id) - 1);
        strncpy(pool.gh_id, config->gh_id, sizeof(pool.gh_id) - 1);
        strncpy(pool.recipe_id, config->recipe_id, sizeof(pool.recipe_id) - 1);
        pool.target_raw_water_ml = config->raw_water_target_ml;
        pool.threshold_percent = config->threshold_percent;
        pool.post_mix_duration_sec = config->post_mix_duration_sec;
        strncpy(pool.raw_water_component_id, raw_pump_id, sizeof(pool.raw_water_component_id) - 1);
        strncpy(pool.raw_flow_sensor_id, raw_sensor_id, sizeof(pool.raw_flow_sensor_id) - 1);
        strncpy(pool.mixing_pump_id, mixing_pump_id, sizeof(pool.mixing_pump_id) - 1);
        pool.channel_count = config->channel_count;
        for (uint32_t i = 0; i < config->channel_count; ++i) {
            strncpy(pool.channels[i].component_id, exec_channels[i].component_id, sizeof(pool.channels[i].component_id) - 1);
            pool.channels[i].target_volume_ml = exec_channels[i].target_volume_ml;
            pool.channels[i].rate_ml_sec = exec_channels[i].rate_ml_sec;
            pool.channels[i].expected_runtime_ms = exec_channels[i].expected_runtime_ms;
            pool.channels[i].observed_runtime_ms = 0;
            pool.channels[i].completed = false;
        }
        pool.current_phase = MIXING_PHASE_PRECHECK;
        mixing_pool_save(&pool);
    }

    ESP_LOGI(TAG, "Starting Mixing Protocol: Target=%u mL, Threshold=%u%% (%u mL), RawRate=%.2f mL/s, ExpectedRun=%u s, Timeout=%u s (is_resuming=%d)",
             (unsigned)config->raw_water_target_ml, (unsigned)config->threshold_percent, (unsigned)threshold_volume_ml,
             raw_rate_ml_sec, (unsigned)expected_raw_sec, (unsigned)max_raw_runtime_sec, (int)is_resuming);

    /* -------------------------------------------------------------
     * 8. START RAW WATER PUMP (IF NOT ALREADY COMPLETED)
     * ------------------------------------------------------------- */
    bool raw_water_running = false;
    bool threshold_reached = is_resuming ? pool.threshold_reached : false;
    bool mixing_running = false;
    bool all_dosing_done = true;
    for (uint32_t i = 0; i < config->channel_count; ++i) {
        if (!exec_channels[i].completed) {
            all_dosing_done = false;
            break;
        }
    }
    bool post_mix_started = false;
    bool post_mix_done = false;
    int64_t post_mix_start_us = 0;

    if (prev_delivered_ml >= config->raw_water_target_ml || (is_resuming && pool.raw_water_completed)) {
        raw_water_running = false;
        result.actual_raw_water_ml = config->raw_water_target_ml;
        result.raw_water_actual_runtime_ms = expected_raw_sec * 1000U;
        result.current_phase = MIXING_PHASE_RAW_WATER_COMPLETE;
        ESP_LOGI(TAG, "Resume: Raw water target was already reached (%u mL). Pump remains OFF.", (unsigned)result.actual_raw_water_ml);
    } else {
        if (set_scoped_actuator_state(&job_actuators.raw_water, true) != ESP_OK) {
            result.status = MIXING_RESULT_ACTUATOR_ERROR;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message), "Failed to turn ON raw water pump '%s'.", raw_pump_id);
            stop_job_scoped_actuators(&job_actuators);
            return result;
        }
        raw_water_running = true;
        result.current_phase = MIXING_PHASE_RAW_WATER_FILL;
    }

    sync_live_result(config, &result);

    int64_t protocol_start_us = esp_timer_get_time();
    int64_t raw_water_start_us = protocol_start_us;
    int64_t mixing_start_us = 0;
    int64_t last_flow_progress_us = raw_water_start_us;
    uint32_t last_flow_volume_ml = prev_delivered_ml;
    int64_t last_pool_sync_us = protocol_start_us;

    // If resuming and threshold was already reached: start mixing pump and incomplete dosing pumps immediately
    if (is_resuming && threshold_reached) {
        mixing_start_us = protocol_start_us;
        mixing_running = true;
        if (set_scoped_actuator_state(&job_actuators.mixing_pump, true) != ESP_OK) {
            result.status = MIXING_RESULT_ACTUATOR_ERROR;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message), "Failed to restart mixing pump '%s'.", mixing_pump_id);
            stop_job_scoped_actuators(&job_actuators);
            return result;
        }

        uint32_t now_ms = (uint32_t)(protocol_start_us / 1000LL);
        bool dosing_start_failed = false;
        for (uint32_t i = 0; i < config->channel_count; ++i) {
            if (!exec_channels[i].completed) {
                exec_channels[i].start_time_ms = now_ms - exec_channels[i].observed_runtime_ms;
                exec_channels[i].is_running = true;
                if (set_scoped_actuator_state(&job_actuators.dosing[i], true) != ESP_OK) {
                    result.status = MIXING_RESULT_ACTUATOR_ERROR;
                    result.error_code = mixing_status_to_string(result.status);
                    result.current_phase = MIXING_PHASE_ERROR;
                    result.final_phase = MIXING_PHASE_ERROR;
                    snprintf(result.message, sizeof(result.message), "Failed to restart dosing pump '%s'.", exec_channels[i].component_id);
                    dosing_start_failed = true;
                    break;
                }
                ESP_LOGI(TAG, "Resume: Dosing pump '%s' restarted for remainder (%u ms remaining).",
                         exec_channels[i].component_id,
                         (unsigned)(exec_channels[i].expected_runtime_ms - exec_channels[i].observed_runtime_ms));
            }
        }
        if (dosing_start_failed) {
            stop_job_scoped_actuators(&job_actuators);
            return result;
        }
        result.current_phase = raw_water_running ? MIXING_PHASE_MIXING_AND_DOSING : MIXING_PHASE_DOSING_COMPLETION;
    }

    // If resuming and post-mix was already running
    if (is_resuming && !raw_water_running && all_dosing_done && pool.post_mix_elapsed_ms > 0) {
        post_mix_started = true;
        post_mix_start_us = protocol_start_us - ((int64_t)pool.post_mix_elapsed_ms * 1000LL);
        result.current_phase = MIXING_PHASE_POST_MIX;
        result.post_mix_actual_runtime_ms = pool.post_mix_elapsed_ms;
        ESP_LOGI(TAG, "Resume: Post-mix restarted (%u ms already elapsed).", (unsigned)pool.post_mix_elapsed_ms);
    }

    /* -------------------------------------------------------------
     * 9. ORCHESTRATION LOOP
     * ------------------------------------------------------------- */
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(poll_delay_ms));

        if (config->tick_cb) {
            config->tick_cb(config->user_ctx);
        }

        int64_t now_us = esp_timer_get_time();
        uint32_t total_elapsed_ms = (uint32_t)((now_us - protocol_start_us) / 1000LL);

        // A. Emergency Stop supervision
        if (actuator_hal_is_emergency_stopped() || (config->abort_check && config->abort_check(config->user_ctx))) {
            result.status = MIXING_RESULT_EMERGENCY_STOP;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message), "Emergency Stop latched during mixing execution.");
            ESP_LOGW(TAG, "%s", result.message);
            stop_job_scoped_actuators(&job_actuators);
            break;
        }

        // B. Flow sensor measurement (Source of Truth)
        sensor_readings_t curr_readings;
        if (sensor_hal_get_readings(&curr_readings) != ESP_OK) {
            result.status = MIXING_RESULT_RAW_WATER_SENSOR_ERROR;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message), "Failed to read flow sensor during execution.");
            ESP_LOGE(TAG, "%s", result.message);
            stop_job_scoped_actuators(&job_actuators);
            break;
        }

        uint32_t current_sensor_ml = curr_readings.total_ml_raw_zjb1;
        uint32_t actual_raw_water_ml = (current_sensor_ml >= start_flow_ml)
                                       ? (current_sensor_ml - start_flow_ml) : 0;
        result.actual_raw_water_ml = actual_raw_water_ml;

        // Update flow progress tracker
        if (actual_raw_water_ml > last_flow_volume_ml) {
            last_flow_volume_ml = actual_raw_water_ml;
            last_flow_progress_us = now_us;
        }

        // C. Progress-based No-Flow protection while raw water pump is active
        if (raw_water_running && actual_raw_water_ml < config->raw_water_target_ml) {
            uint32_t sec_since_progress = (uint32_t)((now_us - last_flow_progress_us) / 1000000LL);
            if (sec_since_progress >= no_flow_grace_sec) {
                result.status = MIXING_RESULT_RAW_WATER_NO_FLOW;
                result.error_code = mixing_status_to_string(result.status);
                result.current_phase = MIXING_PHASE_ERROR;
                result.final_phase = MIXING_PHASE_ERROR;
                snprintf(result.message, sizeof(result.message),
                         "NO FLOW detected: No flow progress for %u s (stalled at %u/%u mL).",
                         (unsigned)sec_since_progress, (unsigned)actual_raw_water_ml,
                         (unsigned)config->raw_water_target_ml);
                ESP_LOGE(TAG, "%s", result.message);
                stop_job_scoped_actuators(&job_actuators);
                break;
            }
        }

        // D. Raw water maximum runtime timeout check (strictly 1.5x expected calibration time)
        uint32_t raw_elapsed_ms = (uint32_t)((now_us - raw_water_start_us) / 1000LL);
        if (raw_water_running && raw_elapsed_ms > max_raw_runtime_ms &&
            actual_raw_water_ml < config->raw_water_target_ml) {
            result.status = MIXING_RESULT_RAW_WATER_TIMEOUT;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_ERROR;
            result.final_phase = MIXING_PHASE_ERROR;
            snprintf(result.message, sizeof(result.message),
                     "Raw water timeout: %ums > %ums (%u/%u mL).",
                     (unsigned)raw_elapsed_ms, (unsigned)max_raw_runtime_ms,
                     (unsigned)actual_raw_water_ml, (unsigned)config->raw_water_target_ml);
            ESP_LOGE(TAG, "%s", result.message);
            stop_job_scoped_actuators(&job_actuators);
            break;
        }

        // E. Threshold check: Start Mixing & Dosing
        if (!threshold_reached && actual_raw_water_ml >= threshold_volume_ml) {
            threshold_reached = true;
            result.current_phase = MIXING_PHASE_THRESHOLD_REACHED;
            mixing_start_us = now_us;
            mixing_running = true;

            ESP_LOGI(TAG, "Threshold reached (%u mL >= %u mL). Starting mixing pump and %u dosing channel(s). RAW WATER REMAINS ACTIVE.",
                     (unsigned)actual_raw_water_ml, (unsigned)threshold_volume_ml, (unsigned)config->channel_count);

            // Start mixing pump
            if (set_scoped_actuator_state(&job_actuators.mixing_pump, true) != ESP_OK) {
                result.status = MIXING_RESULT_ACTUATOR_ERROR;
                result.error_code = mixing_status_to_string(result.status);
                result.current_phase = MIXING_PHASE_ERROR;
                result.final_phase = MIXING_PHASE_ERROR;
                snprintf(result.message, sizeof(result.message), "Failed to start mixing pump '%s'.", mixing_pump_id);
                stop_job_scoped_actuators(&job_actuators);
                break;
            }

            // Start all dosing channels simultaneously
            uint32_t now_ms = (uint32_t)(now_us / 1000LL);
            bool dosing_start_failed = false;
            for (uint32_t i = 0; i < config->channel_count; ++i) {
                exec_channels[i].start_time_ms = now_ms;
                exec_channels[i].is_running = true;
                if (set_scoped_actuator_state(&job_actuators.dosing[i], true) != ESP_OK) {
                    result.status = MIXING_RESULT_ACTUATOR_ERROR;
                    result.error_code = mixing_status_to_string(result.status);
                    result.current_phase = MIXING_PHASE_ERROR;
                    result.final_phase = MIXING_PHASE_ERROR;
                    snprintf(result.message, sizeof(result.message), "Failed to start dosing pump '%s'.", exec_channels[i].component_id);
                    dosing_start_failed = true;
                    break;
                }
            }
            if (dosing_start_failed) {
                stop_job_scoped_actuators(&job_actuators);
                break;
            }
            result.current_phase = MIXING_PHASE_MIXING_AND_DOSING;
        }

        // F. Raw water target completion (DO NOT stop at threshold; stop ONLY when actual >= target)
        if (raw_water_running && actual_raw_water_ml >= config->raw_water_target_ml) {
            esp_err_t off_err = set_scoped_actuator_state(&job_actuators.raw_water, false);
            if (off_err != ESP_OK) {
                result.status = MIXING_RESULT_ACTUATOR_ERROR;
                result.error_code = mixing_status_to_string(result.status);
                result.current_phase = MIXING_PHASE_ERROR;
                result.final_phase = MIXING_PHASE_ERROR;
                snprintf(result.message, sizeof(result.message),
                         "Failed to turn OFF raw water pump '%.20s' (err=%d).",
                         job_actuators.raw_water.component_id, off_err);
                ESP_LOGE(TAG, "%s", result.message);
                stop_job_scoped_actuators(&job_actuators);
                break;
            }
            raw_water_running = false;
            release_scoped_actuator(&job_actuators.raw_water);
            result.raw_water_actual_runtime_ms = (uint32_t)((now_us - raw_water_start_us) / 1000LL);
            result.current_phase = MIXING_PHASE_RAW_WATER_COMPLETE;
            ESP_LOGI(TAG, "Raw water target reached: %u mL in %u ms. Raw water pump OFF.",
                     (unsigned)actual_raw_water_ml, (unsigned)result.raw_water_actual_runtime_ms);
        }

        // G. Dosing channels supervision & immediate OFF failure handling
        if (threshold_reached && !all_dosing_done) {
            uint32_t now_ms = (uint32_t)(now_us / 1000LL);
            bool all_done = true;
            bool channel_fault = false;

            for (uint32_t i = 0; i < config->channel_count; ++i) {
                if (exec_channels[i].is_running && !exec_channels[i].completed) {
                    uint32_t elapsed_ch_ms = now_ms - exec_channels[i].start_time_ms;
                    exec_channels[i].observed_runtime_ms = elapsed_ch_ms;

                    // 1. Expected runtime reached: Request OFF
                    if (elapsed_ch_ms >= exec_channels[i].expected_runtime_ms) {
                        esp_err_t off_err = set_scoped_actuator_state(&job_actuators.dosing[i], false);
                        if (off_err == ESP_OK) {
                            release_scoped_actuator(&job_actuators.dosing[i]);
                            exec_channels[i].is_running = false;
                            exec_channels[i].completed = true;
                            exec_channels[i].observed_runtime_ms = exec_channels[i].expected_runtime_ms;
                            result.channels[i].actual_runtime_ms = exec_channels[i].observed_runtime_ms;
                            result.channels[i].completed = true;
                            ESP_LOGI(TAG, "Dosing channel '%s' completed target (%u mL, %u ms).",
                                     exec_channels[i].component_id, (unsigned)exec_channels[i].target_volume_ml,
                                     (unsigned)exec_channels[i].observed_runtime_ms);
                        } else {
                            // Section 9: OFF command failed! Do NOT wait for 1.5x timeout. Immediate ACTUATOR_ERROR!
                            result.status = MIXING_RESULT_ACTUATOR_ERROR;
                            result.error_code = mixing_status_to_string(result.status);
                            result.current_phase = MIXING_PHASE_ERROR;
                            result.final_phase = MIXING_PHASE_ERROR;
                            snprintf(result.message, sizeof(result.message),
                                     "Failed to turn OFF dosing pump '%.20s' (err=%d).",
                                     exec_channels[i].component_id, off_err);
                            ESP_LOGE(TAG, "%s", result.message);
                            stop_job_scoped_actuators(&job_actuators);
                            channel_fault = true;
                            break;
                        }
                    } else {
                        all_done = false;
                    }

                    // 2. Watchdog timeout check: elapsed exceeded max_runtime_ms (1.5x expected)
                    if (!exec_channels[i].completed && elapsed_ch_ms > exec_channels[i].max_runtime_ms) {
                        result.status = MIXING_RESULT_DOSING_TIMEOUT;
                        result.error_code = mixing_status_to_string(result.status);
                        result.current_phase = MIXING_PHASE_ERROR;
                        result.final_phase = MIXING_PHASE_ERROR;
                        snprintf(result.message, sizeof(result.message),
                                 "Dosing '%.20s' timeout: %ums > max %ums",
                                 exec_channels[i].component_id, (unsigned)elapsed_ch_ms,
                                 (unsigned)exec_channels[i].max_runtime_ms);
                        ESP_LOGE(TAG, "%s", result.message);
                        channel_fault = true;
                        break;
                    }
                } else if (!exec_channels[i].completed) {
                    all_done = false;
                }
            }

            if (channel_fault) {
                stop_job_scoped_actuators(&job_actuators);
                break;
            }

            if (all_done) {
                all_dosing_done = true;
                result.current_phase = MIXING_PHASE_DOSING_COMPLETION;
                ESP_LOGI(TAG, "All %u dosing channel(s) completed successfully.", (unsigned)config->channel_count);
            }
        }

        // H. Post-mix duration supervision
        // Begins strictly AFTER raw water target is reached (pump OFF) AND all dosing pumps are complete
        if (!raw_water_running && all_dosing_done) {
            if (!post_mix_started) {
                post_mix_started = true;
                post_mix_start_us = now_us;
                result.current_phase = MIXING_PHASE_POST_MIX;
                ESP_LOGI(TAG, "Raw water target reached (%u mL) and all %u dosing pump(s) complete. Starting post-mix duration (%u s).",
                         (unsigned)actual_raw_water_ml, (unsigned)config->channel_count, (unsigned)config->post_mix_duration_sec);
            } else if (!post_mix_done) {
                result.current_phase = MIXING_PHASE_POST_MIX;
                uint32_t post_mix_elapsed_ms = (uint32_t)((now_us - post_mix_start_us) / 1000LL);
                result.post_mix_actual_runtime_ms = post_mix_elapsed_ms;
                if (post_mix_elapsed_ms >= config->post_mix_duration_sec * 1000U) {
                    post_mix_done = true;
                    ESP_LOGI(TAG, "Post-mix duration complete (%u s).", (unsigned)config->post_mix_duration_sec);
                }
            }
        }

        // Track total time mixing pump has been running
        if (mixing_running) {
            result.mixing_actual_runtime_ms = (uint32_t)((now_us - mixing_start_us) / 1000LL);
        }

        for (uint32_t c = 0; c < config->channel_count; ++c) {
            result.channels[c].actual_runtime_ms = exec_channels[c].observed_runtime_ms;
            result.channels[c].completed = exec_channels[c].completed;
        }
        sync_live_result(config, &result);

        // J. 1-Second Persistent Checkpoint Pool Save (Updated every second until completed)
        if (now_us - last_pool_sync_us >= 1000000LL) {
            last_pool_sync_us = now_us;
            pool.sequence++;
            pool.timestamp_ms = now_us / 1000LL;
            pool.actual_raw_water_ml = result.actual_raw_water_ml;
            pool.threshold_reached = threshold_reached;
            pool.raw_water_completed = !raw_water_running;
            pool.current_phase = (uint8_t)result.current_phase;
            for (uint32_t c = 0; c < config->channel_count; ++c) {
                pool.channels[c].observed_runtime_ms = exec_channels[c].observed_runtime_ms;
                pool.channels[c].completed = exec_channels[c].completed;
            }
            pool.post_mix_elapsed_ms = result.post_mix_actual_runtime_ms;
            pool.post_mix_completed = post_mix_done;
            mixing_pool_save(&pool);
        }

        // I. Success Evaluation: Raw water done + All dosing done + Post-mix duration complete
        if (!raw_water_running && all_dosing_done && post_mix_done) {
            result.current_phase = MIXING_PHASE_STOP;

            // Turn OFF mixing pump
            esp_err_t off_err = set_scoped_actuator_state(&job_actuators.mixing_pump, false);
            if (off_err != ESP_OK) {
                result.status = MIXING_RESULT_ACTUATOR_ERROR;
                result.error_code = mixing_status_to_string(result.status);
                result.current_phase = MIXING_PHASE_ERROR;
                result.final_phase = MIXING_PHASE_ERROR;
                snprintf(result.message, sizeof(result.message),
                         "Failed to turn OFF mixing pump '%.20s' (err=%d).",
                         job_actuators.mixing_pump.component_id, off_err);
                ESP_LOGE(TAG, "%s", result.message);
                stop_job_scoped_actuators(&job_actuators);
                break;
            }
            mixing_running = false;
            release_scoped_actuator(&job_actuators.mixing_pump);

            result.status = MIXING_RESULT_SUCCESS;
            result.error_code = mixing_status_to_string(result.status);
            result.current_phase = MIXING_PHASE_SUCCESS;
            result.final_phase = MIXING_PHASE_SUCCESS;
            result.total_runtime_ms = total_elapsed_ms;
            snprintf(result.message, sizeof(result.message),
                     "Mixing protocol successfully completed: %u mL raw water, %u dosing channel(s) parallel, %u s post-mix.",
                     (unsigned)actual_raw_water_ml, (unsigned)config->channel_count, (unsigned)config->post_mix_duration_sec);

            // Pool is deleted ONLY when protocol mixing completes successfully
            mixing_pool_delete();

            ESP_LOGI(TAG, "%s", result.message);
            break;
        }
    }

    // Ensure job-scoped actuators are fully cleaned up
    stop_job_scoped_actuators(&job_actuators);

    int64_t end_us = esp_timer_get_time();
    result.total_runtime_ms = (uint32_t)((end_us - protocol_start_us) / 1000LL);
    if (result.status != MIXING_RESULT_SUCCESS) {
        result.final_phase = MIXING_PHASE_ERROR;
    }
    sync_live_result(config, &result);
    return result;
}
