#pragma once

#include "esp_err.h"
#include "hal/actuator_hal.h"
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    CALIBRATION_STATE_IDLE = 0,
    CALIBRATION_STATE_RUNNING,
    CALIBRATION_STATE_COMPLETE,
    CALIBRATION_STATE_ERROR
} calibration_state_t;

typedef struct {
    calibration_state_t state;
    actuator_id_t pump_id;
    uint32_t duration_sec;
    uint32_t remaining_sec;
} calibration_status_t;

/**
 * @brief Initialize calibration manager.
 */
esp_err_t calibration_mgr_init(void);

/**
 * @brief Start a volumetric calibration run for a dosing pump.
 * 
 * @param pump_id The actuator ID of the dosing pump.
 * @param duration_sec The run duration in seconds (usually 10s or 30s).
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t calibration_mgr_start_volumetric(actuator_id_t pump_id, uint32_t duration_sec);

/**
 * @brief Stop the current calibration run.
 */
esp_err_t calibration_mgr_stop(void);

/**
 * @brief Get the current status of the calibration run.
 */
esp_err_t calibration_mgr_get_status(calibration_status_t *out_status);

/**
 * @brief Get the configured rate for a pump in mL/sec.
 */
float calibration_mgr_get_rate_ml_per_sec(actuator_id_t pump_id);

/**
 * @brief Set the configured rate for a pump in mL/sec and save to NVS.
 */
esp_err_t calibration_mgr_set_rate_ml_per_sec(actuator_id_t pump_id, float rate_ml_sec);

/**
 * @brief Get calibration factor for Raw Water Flow Meter (ZJ-B1) in pulses/L.
 * Returns 0.0f if not calibrated (CALIBRATION REQUIRED).
 */
float calibration_mgr_get_flow_raw_pulses_per_l(void);

/**
 * @brief Check if Raw Water Flow Meter (ZJ-B1) has been calibrated.
 */
bool calibration_mgr_is_flow_raw_calibrated(void);

/**
 * @brief Set calibration factor for Raw Water Flow Meter (ZJ-B1) in pulses/L and save to NVS.
 */
esp_err_t calibration_mgr_set_flow_raw_pulses_per_l(float pulses_per_l);

/**
 * @brief Get calibration factor for Fertigation Delivery Flow Meter (FS400A) in pulses/L.
 * Reference default is 288.0f (derived from F = 4.8 * Q).
 */
float calibration_mgr_get_flow_fert_pulses_per_l(void);

/**
 * @brief Set calibration factor for Fertigation Delivery Flow Meter (FS400A) in pulses/L and save to NVS.
 */
esp_err_t calibration_mgr_set_flow_fert_pulses_per_l(float pulses_per_l);

#ifdef __cplusplus
}
#endif
