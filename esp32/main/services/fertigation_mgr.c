#include "services/fertigation_mgr.h"
#include "hal/actuator_hal.h"
#include "services/safety_monitor.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "hal/sensor_hal.h"
#include "services/calibration_mgr.h"
#include "storage/storage_mgr.h"

static const char *TAG = "FERT_MGR";

static fertigation_state_t s_current_state = FERT_STATE_IDLE;
static uint32_t s_state_start_ticks = 0;

static int32_t s_target_raw_ml = 0;
static int32_t s_target_dosing_a_ml = 0;
static int32_t s_target_dosing_b_ml = 0;

static uint32_t s_start_raw_ml = 0;
static uint32_t s_start_raw_pulses = 0;
static uint32_t s_dosing_a_duration_ms = 0;
static uint32_t s_dosing_b_duration_ms = 0;

/* 
 * Hardware Mapping per user rules and HARDWARE_INVENTORY.md:
 * FILLING / RAW WATER -> RAW_SUBMERSIBLE (Raw water tank -> Mixing tank)
 * MIXING_PUMP -> MIXING_PUMP (220V AC pond pump for circulation in mixing tank)
 * DISTRIBUTION -> DIST_PUMP (Fertigation booster to greenhouse)
 */

#define DURATION_FINAL_MIXING_MS  (180000)  /* 3 minutes (180s) */
#define DURATION_DELIVERY_MS      (60000)   /* Placeholder: 1m */

static void transition_to(fertigation_state_t new_state)
{
    if (s_current_state == new_state) return;
    ESP_LOGI(TAG, "State transition: %d -> %d", s_current_state, new_state);
    s_current_state = new_state;
    s_state_start_ticks = xTaskGetTickCount();
}

static void stop_all_batch_actuators(void)
{
    actuator_hal_set(ACTUATOR_RAW_SUBMERSIBLE, false);
    actuator_hal_release(ACTUATOR_RAW_SUBMERSIBLE, ACTUATOR_OWNER_FERTIGATION);

    actuator_hal_set(ACTUATOR_MIXING_PUMP, false);
    actuator_hal_release(ACTUATOR_MIXING_PUMP, ACTUATOR_OWNER_FERTIGATION);

    actuator_hal_set(ACTUATOR_DOSING_A, false);
    actuator_hal_release(ACTUATOR_DOSING_A, ACTUATOR_OWNER_FERTIGATION);

    actuator_hal_set(ACTUATOR_DOSING_B, false);
    actuator_hal_release(ACTUATOR_DOSING_B, ACTUATOR_OWNER_FERTIGATION);

    actuator_hal_set(ACTUATOR_DIST_PUMP, false);
    actuator_hal_release(ACTUATOR_DIST_PUMP, ACTUATOR_OWNER_FERTIGATION);
}

static void fertigation_mgr_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Fertigation Manager task running.");

    while (1) {
        /* Safety check */
        if (safety_monitor_has_fault() || actuator_hal_is_emergency_stopped()) {
            if (s_current_state != FERT_STATE_IDLE && s_current_state != FERT_STATE_INTERRUPTED) {
                ESP_LOGE(TAG, "Safety fault detected! Interrupting batch.");
                stop_all_batch_actuators();
                transition_to(FERT_STATE_INTERRUPTED);
            }
        }

        uint32_t now_ticks = xTaskGetTickCount();
        uint32_t elapsed_ms = (now_ticks - s_state_start_ticks) * portTICK_PERIOD_MS;

        switch (s_current_state) {
            case FERT_STATE_IDLE:
                /* Waiting for start trigger */
                break;

            case FERT_STATE_FILLING:
            {
                /* RAW WATER FILLING: RAW_SUBMERSIBLE ON, MIXING_PUMP ON */
                if (!actuator_hal_get_state(ACTUATOR_RAW_SUBMERSIBLE)) {
                    if (actuator_hal_acquire(ACTUATOR_RAW_SUBMERSIBLE, ACTUATOR_OWNER_FERTIGATION) == ESP_OK) {
                        actuator_hal_set(ACTUATOR_RAW_SUBMERSIBLE, true);
                    }
                }
                if (!actuator_hal_get_state(ACTUATOR_MIXING_PUMP)) {
                    if (actuator_hal_acquire(ACTUATOR_MIXING_PUMP, ACTUATOR_OWNER_FERTIGATION) == ESP_OK) {
                        actuator_hal_set(ACTUATOR_MIXING_PUMP, true);
                    }
                }
                
                sensor_readings_t readings;
                sensor_hal_get_readings(&readings);
                uint32_t current_pulses = readings.total_pulses_raw_zjb1 - s_start_raw_pulses;

                /* Safety diagnostic timeout: ZJ-B1 flow range 1-25 L/min.
                 * If pump is ON for > 30s and 0 pulses detected, trigger safety stop (dry-run / pipe blockage) */
                if (elapsed_ms > 30000 && current_pulses == 0) {
                    ESP_LOGE(TAG, "SAFETY TIMEOUT: RAW_SUBMERSIBLE ON for %lu ms but 0 pulses from ZJ-B1!", (unsigned long)elapsed_ms);
                    storage_mgr_append_event_log("{\"code\":\"SAFETY_NO_FLOW\",\"level\":\"ERROR\",\"message\":\"ZJ-B1 raw water flow meter reported 0 pulses after 30s transfer\"}");
                    stop_all_batch_actuators();
                    transition_to(FERT_STATE_INTERRUPTED);
                    break;
                }

                if (!readings.raw_zjb1_calibrated) {
                    /* ZJ-B1 requires physical calibration before volumetric conversion.
                     * Log notice once per 5 seconds */
                    if ((elapsed_ms % 5000) < 1000) {
                        ESP_LOGW(TAG, "ZJ-B1 RAW WATER: CALIBRATION REQUIRED. Pulses counted: %lu", (unsigned long)current_pulses);
                    }
                } else {
                    uint32_t current_ml = readings.total_ml_raw_zjb1 - s_start_raw_ml;
                    if ((int32_t)current_ml >= s_target_raw_ml) {
                        ESP_LOGI(TAG, "Raw water filling reached target %ld mL (ZJ-B1: %lu pulses).", (long)s_target_raw_ml, (unsigned long)current_pulses);
                        actuator_hal_set(ACTUATOR_RAW_SUBMERSIBLE, false); // Stop filling mixing tank
                        actuator_hal_release(ACTUATOR_RAW_SUBMERSIBLE, ACTUATOR_OWNER_FERTIGATION);
                        transition_to(FERT_STATE_DOSING);
                    }
                }
                break;
            }

            case FERT_STATE_DOSING:
            {
                /* DOSING: DOSING_A ON, DOSING_B ON, MIXING_PUMP ON */
                if (!actuator_hal_get_state(ACTUATOR_DOSING_A) && elapsed_ms < s_dosing_a_duration_ms) {
                    if (actuator_hal_acquire(ACTUATOR_DOSING_A, ACTUATOR_OWNER_FERTIGATION) == ESP_OK) {
                        actuator_hal_set(ACTUATOR_DOSING_A, true);
                    }
                }
                if (!actuator_hal_get_state(ACTUATOR_DOSING_B) && elapsed_ms < s_dosing_b_duration_ms) {
                    if (actuator_hal_acquire(ACTUATOR_DOSING_B, ACTUATOR_OWNER_FERTIGATION) == ESP_OK) {
                        actuator_hal_set(ACTUATOR_DOSING_B, true);
                    }
                }
                
                if (elapsed_ms >= s_dosing_a_duration_ms && actuator_hal_get_state(ACTUATOR_DOSING_A)) {
                    actuator_hal_set(ACTUATOR_DOSING_A, false);
                    actuator_hal_release(ACTUATOR_DOSING_A, ACTUATOR_OWNER_FERTIGATION);
                }
                if (elapsed_ms >= s_dosing_b_duration_ms && actuator_hal_get_state(ACTUATOR_DOSING_B)) {
                    actuator_hal_set(ACTUATOR_DOSING_B, false);
                    actuator_hal_release(ACTUATOR_DOSING_B, ACTUATOR_OWNER_FERTIGATION);
                }
                
                if (elapsed_ms >= s_dosing_a_duration_ms && elapsed_ms >= s_dosing_b_duration_ms) {
                    transition_to(FERT_STATE_FINAL_MIXING);
                }
                break;
            }

            case FERT_STATE_FINAL_MIXING:
                /* FINAL MIXING: MIXING_PUMP ON for 180s */
                if (!actuator_hal_get_state(ACTUATOR_MIXING_PUMP)) {
                    if (actuator_hal_acquire(ACTUATOR_MIXING_PUMP, ACTUATOR_OWNER_FERTIGATION) == ESP_OK) {
                        actuator_hal_set(ACTUATOR_MIXING_PUMP, true);
                    }
                }

                if (elapsed_ms >= DURATION_FINAL_MIXING_MS) {
                    actuator_hal_set(ACTUATOR_MIXING_PUMP, false); // Stop mixing pump
                    actuator_hal_release(ACTUATOR_MIXING_PUMP, ACTUATOR_OWNER_FERTIGATION);
                    transition_to(FERT_STATE_DELIVERY);
                }
                break;

            case FERT_STATE_DELIVERY:
                /* DELIVERY: DIST_PUMP ON */
                if (!actuator_hal_get_state(ACTUATOR_DIST_PUMP)) {
                    if (actuator_hal_acquire(ACTUATOR_DIST_PUMP, ACTUATOR_OWNER_FERTIGATION) == ESP_OK) {
                        actuator_hal_set(ACTUATOR_DIST_PUMP, true);
                    }
                }
                
                if (elapsed_ms >= DURATION_DELIVERY_MS) {
                    actuator_hal_set(ACTUATOR_DIST_PUMP, false);
                    actuator_hal_release(ACTUATOR_DIST_PUMP, ACTUATOR_OWNER_FERTIGATION);
                    transition_to(FERT_STATE_COMPLETE);
                }
                break;

            case FERT_STATE_COMPLETE:
                stop_all_batch_actuators();
                transition_to(FERT_STATE_IDLE);
                break;

            case FERT_STATE_INTERRUPTED:
                /* Manual reset required. System remains halted until cleared by user. */
                break;

            default:
                break;
        }

        vTaskDelay(pdMS_TO_TICKS(1000)); // Evaluate every 1 second
    }
}

esp_err_t fertigation_mgr_init(void)
{
    s_current_state = FERT_STATE_IDLE;
    xTaskCreatePinnedToCore(fertigation_mgr_task, "fert_mgr", 4096, NULL, 4, NULL, 1);
    return ESP_OK;
}

esp_err_t fertigation_mgr_start_batch(int32_t raw_volume_ml, int32_t dosing_a_ml, int32_t dosing_b_ml)
{
    if (s_current_state == FERT_STATE_IDLE || s_current_state == FERT_STATE_COMPLETE) {
        ESP_LOGI(TAG, "Starting new fertigation batch. Raw: %ld mL, A: %ld mL, B: %ld mL", (long)raw_volume_ml, (long)dosing_a_ml, (long)dosing_b_ml);
        
        s_target_raw_ml = raw_volume_ml;
        s_target_dosing_a_ml = dosing_a_ml;
        s_target_dosing_b_ml = dosing_b_ml;
        
        sensor_readings_t readings;
        sensor_hal_get_readings(&readings);
        s_start_raw_ml = readings.total_ml_raw_zjb1;
        s_start_raw_pulses = readings.total_pulses_raw_zjb1;
        
        float rate_a = calibration_mgr_get_rate_ml_per_sec(ACTUATOR_DOSING_A);
        float rate_b = calibration_mgr_get_rate_ml_per_sec(ACTUATOR_DOSING_B);
        
        if (rate_a <= 0.0f) rate_a = 1.0f; // Safe fallback to avoid div-zero
        if (rate_b <= 0.0f) rate_b = 1.0f; // Safe fallback
        
        s_dosing_a_duration_ms = (uint32_t)((s_target_dosing_a_ml / rate_a) * 1000.0f);
        s_dosing_b_duration_ms = (uint32_t)((s_target_dosing_b_ml / rate_b) * 1000.0f);
        
        transition_to(FERT_STATE_FILLING);
        return ESP_OK;
    }
    ESP_LOGW(TAG, "Cannot start batch: state is %d", s_current_state);
    return ESP_ERR_INVALID_STATE;
}

fertigation_state_t fertigation_mgr_get_state(void)
{
    return s_current_state;
}

esp_err_t fertigation_mgr_cancel_batch(void)
{
    ESP_LOGI(TAG, "Cancelling fertigation batch.");
    stop_all_batch_actuators();
    transition_to(FERT_STATE_IDLE);
    return ESP_OK;
}
