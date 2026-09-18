#pragma once

#include "esp_err.h"
#include "hal/actuator_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the manual actuator manager and start its background task.
 */
esp_err_t manual_actuator_mgr_init(void);

/**
 * @brief Request a manual run for an actuator.
 * If the actuator is already running manually, this acts as a toggle and turns it OFF.
 * 
 * @param id The actuator to control.
 * @param duration_sec Maximum duration in seconds before auto-shutoff (e.g., 300 for 5 mins).
 * @return esp_err_t ESP_OK on success, or an error if invalid state.
 */
esp_err_t manual_actuator_start(actuator_id_t id, uint32_t duration_sec);

/**
 * @brief Stop a manual run for an actuator.
 * 
 * @param id The actuator to stop.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t manual_actuator_stop(actuator_id_t id);

/**
 * @brief Check if an actuator is currently being managed by manual run.
 */
bool manual_actuator_is_running(actuator_id_t id);

#ifdef __cplusplus
}
#endif
