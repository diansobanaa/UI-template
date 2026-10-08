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

static const char *TAG = "MIXING_CORE";

#define DEFAULT_NO_FLOW_GRACE_SEC       15
#define DEFAULT_MIN_SAFETY_MARGIN_SEC   30
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
        default:
            return "MIXING_UNKNOWN_ERROR";
    }
}

static esp_err_t resolve_and_acquire_actuator(const char *component_id, actuator_owner_t owner)
{
    if (!component_id || !component_id[0]) return ESP_ERR_INVALID_ARG;
    esp_err_t err = actuator_hal_acquire_component(component_id, owner);
    if (err != ESP_OK) {
        actuator_id_t fallback_aid = ACTUATOR_MAX_COUNT;
        if (actuator_hal_find_id_by_component_id(component_id, &fallback_aid) == ESP_OK) {
            err = actuator_hal_acquire(fallback_aid, owner);
        }
    }
    return err;
}

static esp_err_t set_actuator_state(const char *component_id, bool on)
{
    if (!component_id || !component_id[0]) return ESP_ERR_INVALID_ARG;
    esp_err_t err = actuator_hal_set_by_component_id(component_id, on);
    if (err != ESP_OK) {
        actuator_id_t fallback_aid = ACTUATOR_MAX_COUNT;
        if (actuator_hal_find_id_by_component_id(component_id, &fallback_aid) == ESP_OK) {
            err = actuator_hal_set(fallback_aid, on);
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
    const char *raw_pump = (config && config->raw_water_component_id[0])
                           ? config->raw_water_component_id : "pump_submersible";
    const char *mixing_pump = (config && config->mixing_pump_id[0])
                             ? config->mixing_pump_id : "mixing_pump";

    // Stop raw water pump
    (void)set_actuator_state(raw_pump, false);
    (void)release_actuator(raw_pump, ACTUATOR_OWNER_FERTIGATION);
    (void)actuator_hal_set(ACTUATOR_RAW_SUBMERSIBLE, false);
    (void)actuator_hal_release(ACTUATOR_RAW_SUBMERSIBLE, ACTUATOR_OWNER_FERTIGATION);

    // Stop mixing pump
    (void)set_actuator_state(mixing_pump, false);
    (void)release_actuator(mixing_pump, ACTUATOR_OWNER_FERTIGATION);
    (void)actuator_hal_set(ACTUATOR_MIXING_PUMP, false);
    (void)actuator_hal_release(ACTUATOR_MIXING_PUMP, ACTUATOR_OWNER_FERTIGATION);

    // Stop all configured dosing channels
    if (config) {
        for (uint32_t i = 0; i < config->channel_count && i < MAX_MIXING_DOSING_CHANNELS; ++i) {
            if (config->channels[i].component_id[0]) {
                (void)set_actuator_state(config->channels[i].component_id, false);
                (void)release_actuator(config->channels[i].component_id, ACTUATOR_OWNER_FERTIGATION);
            }
        }
    }

    // Safety fallback: ensure legacy dosing pumps are unconditionally OFF
    (void)actuator_hal_set(ACTUATOR_DOSING_A, false);
    (void)actuator_hal_release(ACTUATOR_DOSING_A, ACTUATOR_OWNER_FERTIGATION);
    (void)actuator_hal_set(ACTUATOR_DOSING_B, false);
    (void)actuator_hal_release(ACTUATOR_DOSING_B, ACTUATOR_OWNER_FERTIGATION);

    ESP_LOGI(TAG, "Safe Stop: all mixing protocol actuators forced OFF and released.");
    return ESP_OK;
}

mixing_result_t protocol_mixing(const mixing_protocol_config_t *config)
{
    mixing_result_t result;
    memset(&result, 0, sizeof(result));

    /* -------------------------------------------------------------
     * 1. PRECHECK - CONFIGURATION VALIDATION
     * ------------------------------------------------------------- */
    if (!config) {
        result.status = MIXING_RESULT_INVALID_CONFIG;
        result.error_code = mixing_status_to_string(result.status);
        snprintf(result.message, sizeof(result.message), "Config pointer is NULL.");
        return result;
    }

    if (config->raw_water_target_ml == 0) {
        result.status = MIXING_RESULT_INVALID_CONFIG;
        result.error_code = mixing_status_to_string(result.status);
        snprintf(result.message, sizeof(result.message), "raw_water_target_ml must be greater than 0.");
        return result;
    }

    if (config->threshold_percent > 100) {
        result.status = MIXING_RESULT_INVALID_CONFIG;
        result.error_code = mixing_status_to_string(result.status);
        snprintf(result.message, sizeof(result.message), "threshold_percent (%u) exceeds 100%%.", (unsigned)config->threshold_percent);
        return result;
    }

    if (config->channel_count > MAX_MIXING_DOSING_CHANNELS) {
        result.status = MIXING_RESULT_INVALID_CONFIG;
        result.error_code = mixing_status_to_string(result.status);
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
            snprintf(result.message, sizeof(result.message), "Channel %u component_id is empty.", (unsigned)i);
            return result;
        }
        if (config->channels[i].target_volume_ml == 0) {
            result.status = MIXING_RESULT_INVALID_CONFIG;
            result.error_code = mixing_status_to_string(result.status);
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
        snprintf(result.message, sizeof(result.message), "Raw water flow sensor (ZJ-B1) has no valid pulse calibration.");
        ESP_LOGE(TAG, "%s", result.message);
        return result;
    }

    sensor_readings_t initial_readings;
    if (sensor_hal_get_readings(&initial_readings) != ESP_OK || !initial_readings.raw_zjb1_calibrated) {
        result.status = MIXING_RESULT_RAW_WATER_SENSOR_ERROR;
        result.error_code = mixing_status_to_string(result.status);
        snprintf(result.message, sizeof(result.message), "Sensor HAL indicates raw flow sensor is unverified/error.");
        ESP_LOGE(TAG, "%s", result.message);
        return result;
    }

    /* -------------------------------------------------------------
     * 4. PRECHECK - RAW WATER PUMP CALIBRATION AUDIT
     * ------------------------------------------------------------- */
    const char *raw_pump_id = config->raw_water_component_id[0]
                             ? config->raw_water_component_id : "pump_submersible";
    float raw_rate_ml_sec = get_pump_calibration_rate(raw_pump_id, ACTUATOR_RAW_SUBMERSIBLE);
    if (raw_rate_ml_sec <= 0.0f) {
        result.status = MIXING_RESULT_CALIBRATION_MISSING;
        result.error_code = mixing_status_to_string(result.status);
        snprintf(result.message, sizeof(result.message), "Raw water pump '%s' calibration missing or <= 0 ml/s.", raw_pump_id);
        ESP_LOGE(TAG, "%s", result.message);
        return result;
    }

    // Expected runtime in seconds
    uint32_t expected_raw_sec = (uint32_t)ceilf((float)config->raw_water_target_ml / raw_rate_ml_sec);
    result.raw_water_expected_runtime_sec = expected_raw_sec;

    // Timeout: expected + safety margin
    uint32_t safety_margin_sec = config->timeout_safety_margin_sec;
    if (safety_margin_sec == 0) {
        safety_margin_sec = expected_raw_sec / 2;
        if (safety_margin_sec < DEFAULT_MIN_SAFETY_MARGIN_SEC) {
            safety_margin_sec = DEFAULT_MIN_SAFETY_MARGIN_SEC;
        }
    }
    uint32_t max_raw_runtime_sec = expected_raw_sec + safety_margin_sec;

    /* -------------------------------------------------------------
     * 5. PRECHECK - DOSING CHANNELS CALIBRATION AUDIT
     * ------------------------------------------------------------- */
    channel_execution_state_t exec_channels[MAX_MIXING_DOSING_CHANNELS];
    memset(exec_channels, 0, sizeof(exec_channels));

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
            snprintf(result.message, sizeof(result.message), "Dosing pump '%s' calibration missing or <= 0 ml/s.", ch_id);
            ESP_LOGE(TAG, "%s", result.message);
            return result;
        }

        uint32_t req_ml = config->channels[i].target_volume_ml;
        uint32_t run_ms = (uint32_t)roundf(((float)req_ml / d_rate) * 1000.0f);
        if (run_ms == 0) run_ms = 100; // minimum tick

        strncpy(exec_channels[i].component_id, ch_id, sizeof(exec_channels[i].component_id) - 1);
        exec_channels[i].target_volume_ml = req_ml;
        exec_channels[i].rate_ml_sec = d_rate;
        exec_channels[i].expected_runtime_ms = run_ms;
        exec_channels[i].max_runtime_ms = (uint32_t)(run_ms * 1.5f) + 5000U;

        strncpy(result.channels[i].component_id, ch_id, sizeof(result.channels[i].component_id) - 1);
        result.channels[i].target_volume_ml = req_ml;
        result.channels[i].calibration_rate_ml_sec = d_rate;
        result.channels[i].expected_runtime_ms = run_ms;
        result.channels[i].completed = false;
    }

    /* -------------------------------------------------------------
     * 6. PRECHECK - ACTUATOR ACQUISITION
     * ------------------------------------------------------------- */
    const char *mixing_pump_id = config->mixing_pump_id[0]
                                ? config->mixing_pump_id : "mixing_pump";

    if (resolve_and_acquire_actuator(raw_pump_id, ACTUATOR_OWNER_FERTIGATION) != ESP_OK) {
        result.status = MIXING_RESULT_ACTUATOR_ERROR;
        result.error_code = mixing_status_to_string(result.status);
        snprintf(result.message, sizeof(result.message), "Failed to acquire raw water pump '%s'.", raw_pump_id);
        stop_mixing_protocol_actuators(config);
        return result;
    }

    if (resolve_and_acquire_actuator(mixing_pump_id, ACTUATOR_OWNER_FERTIGATION) != ESP_OK) {
        result.status = MIXING_RESULT_ACTUATOR_ERROR;
        result.error_code = mixing_status_to_string(result.status);
        snprintf(result.message, sizeof(result.message), "Failed to acquire mixing pump '%s'.", mixing_pump_id);
        stop_mixing_protocol_actuators(config);
        return result;
    }

    for (uint32_t i = 0; i < config->channel_count; ++i) {
        if (resolve_and_acquire_actuator(exec_channels[i].component_id, ACTUATOR_OWNER_FERTIGATION) != ESP_OK) {
            result.status = MIXING_RESULT_ACTUATOR_ERROR;
            result.error_code = mixing_status_to_string(result.status);
            snprintf(result.message, sizeof(result.message), "Failed to acquire dosing pump '%s'.", exec_channels[i].component_id);
            stop_mixing_protocol_actuators(config);
            return result;
        }
    }

    /* -------------------------------------------------------------
     * 7. BASELINE & THRESHOLD SETUP
     * ------------------------------------------------------------- */
    uint32_t start_flow_ml = initial_readings.total_ml_raw_zjb1;
    uint32_t threshold_volume_ml = (uint32_t)(((uint64_t)config->raw_water_target_ml * config->threshold_percent) / 100ULL);

    uint32_t no_flow_grace_sec = config->no_flow_grace_period_sec > 0
                                 ? config->no_flow_grace_period_sec : DEFAULT_NO_FLOW_GRACE_SEC;
    uint32_t poll_delay_ms = config->poll_interval_ms > 0
                             ? config->poll_interval_ms : DEFAULT_POLL_INTERVAL_MS;

    ESP_LOGI(TAG, "Starting Mixing Protocol: Target=%u mL, Threshold=%u%% (%u mL), RawRate=%.2f mL/s, ExpectedRun=%u s, MaxRun=%u s",
             (unsigned)config->raw_water_target_ml, (unsigned)config->threshold_percent, (unsigned)threshold_volume_ml,
             raw_rate_ml_sec, (unsigned)expected_raw_sec, (unsigned)max_raw_runtime_sec);

    /* -------------------------------------------------------------
     * 8. START RAW WATER PUMP
     * ------------------------------------------------------------- */
    if (set_actuator_state(raw_pump_id, true) != ESP_OK) {
        result.status = MIXING_RESULT_ACTUATOR_ERROR;
        result.error_code = mixing_status_to_string(result.status);
        snprintf(result.message, sizeof(result.message), "Failed to turn ON raw water pump '%s'.", raw_pump_id);
        stop_mixing_protocol_actuators(config);
        return result;
    }

    int64_t protocol_start_us = esp_timer_get_time();
    int64_t raw_water_start_us = protocol_start_us;
    int64_t mixing_start_us = 0;

    bool raw_water_running = true;
    bool threshold_reached = false;
    bool mixing_running = false;
    bool all_dosing_done = (config->channel_count == 0);
    bool mixing_duration_done = (config->mixing_duration_sec == 0);

    /* -------------------------------------------------------------
     * 9. ORCHESTRATION LOOP
     * ------------------------------------------------------------- */
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(poll_delay_ms));

        int64_t now_us = esp_timer_get_time();
        uint32_t total_elapsed_ms = (uint32_t)((now_us - protocol_start_us) / 1000LL);
        uint32_t raw_elapsed_sec = (uint32_t)((now_us - raw_water_start_us) / 1000000LL);

        // A. Emergency Stop supervision
        if (actuator_hal_is_emergency_stopped() || (config->abort_check && config->abort_check(config->user_ctx))) {
            result.status = MIXING_RESULT_EMERGENCY_STOP;
            result.error_code = mixing_status_to_string(result.status);
            snprintf(result.message, sizeof(result.message), "Emergency Stop latched during mixing execution.");
            ESP_LOGW(TAG, "%s", result.message);
            stop_mixing_protocol_actuators(config);
            break;
        }

        // B. Flow sensor measurement (Source of Truth)
        sensor_readings_t curr_readings;
        if (sensor_hal_get_readings(&curr_readings) != ESP_OK) {
            result.status = MIXING_RESULT_RAW_WATER_SENSOR_ERROR;
            result.error_code = mixing_status_to_string(result.status);
            snprintf(result.message, sizeof(result.message), "Failed to read flow sensor during execution.");
            ESP_LOGE(TAG, "%s", result.message);
            stop_mixing_protocol_actuators(config);
            break;
        }

        uint32_t current_sensor_ml = curr_readings.total_ml_raw_zjb1;
        uint32_t actual_raw_water_ml = (current_sensor_ml >= start_flow_ml)
                                       ? (current_sensor_ml - start_flow_ml) : 0;
        result.actual_raw_water_ml = actual_raw_water_ml;

        // C. No-flow protection while raw water pump is active
        if (raw_water_running && raw_elapsed_sec >= no_flow_grace_sec && actual_raw_water_ml == 0) {
            result.status = MIXING_RESULT_RAW_WATER_NO_FLOW;
            result.error_code = mixing_status_to_string(result.status);
            snprintf(result.message, sizeof(result.message),
                     "NO FLOW detected: Raw water pump active for %u s with 0 mL measured flow.",
                     (unsigned)raw_elapsed_sec);
            ESP_LOGE(TAG, "%s", result.message);
            stop_mixing_protocol_actuators(config);
            break;
        }

        // D. Raw water maximum runtime timeout check
        if (raw_water_running && raw_elapsed_sec > max_raw_runtime_sec &&
            actual_raw_water_ml < config->raw_water_target_ml) {
            result.status = MIXING_RESULT_RAW_WATER_TIMEOUT;
            result.error_code = mixing_status_to_string(result.status);
            snprintf(result.message, sizeof(result.message),
                     "Raw water timeout: Elapsed %u s exceeded max %u s (delivered %u/%u mL).",
                     (unsigned)raw_elapsed_sec, (unsigned)max_raw_runtime_sec,
                     (unsigned)actual_raw_water_ml, (unsigned)config->raw_water_target_ml);
            ESP_LOGE(TAG, "%s", result.message);
            stop_mixing_protocol_actuators(config);
            break;
        }

        // E. Threshold check: Start Mixing & Dosing
        if (!threshold_reached && actual_raw_water_ml >= threshold_volume_ml) {
            threshold_reached = true;
            mixing_start_us = now_us;
            mixing_running = true;

            ESP_LOGI(TAG, "Threshold reached (%u mL >= %u mL). Starting mixing pump and %u dosing channel(s). RAW WATER REMAINS ACTIVE.",
                     (unsigned)actual_raw_water_ml, (unsigned)threshold_volume_ml, (unsigned)config->channel_count);

            // Start mixing pump
            if (set_actuator_state(mixing_pump_id, true) != ESP_OK) {
                result.status = MIXING_RESULT_ACTUATOR_ERROR;
                result.error_code = mixing_status_to_string(result.status);
                snprintf(result.message, sizeof(result.message), "Failed to start mixing pump '%s'.", mixing_pump_id);
                stop_mixing_protocol_actuators(config);
                break;
            }

            // Start all dosing channels concurrently
            uint32_t now_ms = (uint32_t)(now_us / 1000LL);
            bool dosing_start_failed = false;
            for (uint32_t i = 0; i < config->channel_count; ++i) {
                exec_channels[i].start_time_ms = now_ms;
                exec_channels[i].is_running = true;
                if (set_actuator_state(exec_channels[i].component_id, true) != ESP_OK) {
                    result.status = MIXING_RESULT_ACTUATOR_ERROR;
                    result.error_code = mixing_status_to_string(result.status);
                    snprintf(result.message, sizeof(result.message), "Failed to start dosing pump '%s'.", exec_channels[i].component_id);
                    dosing_start_failed = true;
                    break;
                }
            }
            if (dosing_start_failed) {
                stop_mixing_protocol_actuators(config);
                break;
            }
        }

        // F. Raw water target completion (DO NOT stop at threshold; stop ONLY when actual >= target)
        if (raw_water_running && actual_raw_water_ml >= config->raw_water_target_ml) {
            (void)set_actuator_state(raw_pump_id, false);
            (void)release_actuator(raw_pump_id, ACTUATOR_OWNER_FERTIGATION);
            raw_water_running = false;
            result.raw_water_actual_runtime_ms = (uint32_t)((now_us - raw_water_start_us) / 1000LL);
            ESP_LOGI(TAG, "Raw water target reached: %u mL in %u ms. Raw water pump OFF.",
                     (unsigned)actual_raw_water_ml, (unsigned)result.raw_water_actual_runtime_ms);
        }

        // G. Dosing channels supervision
        if (threshold_reached && !all_dosing_done) {
            uint32_t now_ms = (uint32_t)(now_us / 1000LL);
            bool all_done = true;
            bool channel_fault = false;

            for (uint32_t i = 0; i < config->channel_count; ++i) {
                if (exec_channels[i].is_running) {
                    uint32_t elapsed_ch_ms = now_ms - exec_channels[i].start_time_ms;
                    exec_channels[i].observed_runtime_ms = elapsed_ch_ms;

                    if (elapsed_ch_ms >= exec_channels[i].expected_runtime_ms) {
                        // Finished calibrated dosage
                        (void)set_actuator_state(exec_channels[i].component_id, false);
                        (void)release_actuator(exec_channels[i].component_id, ACTUATOR_OWNER_FERTIGATION);
                        exec_channels[i].is_running = false;
                        exec_channels[i].completed = true;
                        exec_channels[i].observed_runtime_ms = exec_channels[i].expected_runtime_ms;
                        result.channels[i].actual_runtime_ms = exec_channels[i].observed_runtime_ms;
                        result.channels[i].completed = true;
                        ESP_LOGI(TAG, "Dosing channel '%s' completed target (%u mL, %u ms).",
                                 exec_channels[i].component_id, (unsigned)exec_channels[i].target_volume_ml,
                                 (unsigned)exec_channels[i].observed_runtime_ms);
                    } else if (elapsed_ch_ms > exec_channels[i].max_runtime_ms) {
                        // Safety timeout trip for dosing channel
                        result.status = MIXING_RESULT_DOSING_TIMEOUT;
                        result.error_code = mixing_status_to_string(result.status);
                        snprintf(result.message, sizeof(result.message),
                                 "Dosing pump '%s' exceeded safety timeout (%u ms > max %u ms).",
                                 exec_channels[i].component_id, (unsigned)elapsed_ch_ms,
                                 (unsigned)exec_channels[i].max_runtime_ms);
                        ESP_LOGE(TAG, "%s", result.message);
                        channel_fault = true;
                        break;
                    } else {
                        all_done = false;
                    }
                } else if (!exec_channels[i].completed) {
                    all_done = false;
                }
            }

            if (channel_fault) {
                stop_mixing_protocol_actuators(config);
                break;
            }

            if (all_done) {
                all_dosing_done = true;
                ESP_LOGI(TAG, "All %u dosing channel(s) completed successfully.", (unsigned)config->channel_count);
            }
        }

        // H. Mixing duration supervision
        if (mixing_running) {
            uint32_t mixing_elapsed_sec = (uint32_t)((now_us - mixing_start_us) / 1000000LL);
            result.mixing_actual_runtime_ms = (uint32_t)((now_us - mixing_start_us) / 1000LL);
            if (mixing_elapsed_sec >= config->mixing_duration_sec) {
                mixing_duration_done = true;
            }
        }

        // I. Success Evaluation: ALL 3 criteria satisfied
        if (!raw_water_running && all_dosing_done && mixing_duration_done) {
            // Turn OFF mixing pump
            (void)set_actuator_state(mixing_pump_id, false);
            (void)release_actuator(mixing_pump_id, ACTUATOR_OWNER_FERTIGATION);
            mixing_running = false;

            result.status = MIXING_RESULT_SUCCESS;
            result.error_code = mixing_status_to_string(result.status);
            result.total_runtime_ms = total_elapsed_ms;
            snprintf(result.message, sizeof(result.message),
                     "Mixing protocol successfully completed: %u mL raw water, %u dosing channel(s), %u s mixing.",
                     (unsigned)actual_raw_water_ml, (unsigned)config->channel_count, (unsigned)config->mixing_duration_sec);

            ESP_LOGI(TAG, "%s", result.message);
            break;
        }
    }

    // Ensure actuators are fully cleaned up
    stop_mixing_protocol_actuators(config);

    int64_t end_us = esp_timer_get_time();
    result.total_runtime_ms = (uint32_t)((end_us - protocol_start_us) / 1000LL);
    return result;
}
