#pragma once

#include "esp_err.h"
#include "hal/actuator_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    TRANSFER_STATE_IDLE = 0,
    TRANSFER_STATE_TRANSFERRING,
    TRANSFER_STATE_DRAINING,
    TRANSFER_STATE_COMPLETE,
    TRANSFER_STATE_ERROR
} transfer_state_t;

/**
 * @brief Initialize the tank transfer manager.
 */
esp_err_t transfer_mgr_init(void);

/**
 * @brief Start a liquid transfer.
 * 
 * @param source_pump The pump to turn ON (e.g. ACTUATOR_RAW_SUBMERSIBLE).
 * @param dest_valve Optional destination valve (use ACTUATOR_MAX_COUNT if none).
 * @param duration_sec Maximum duration of the transfer in seconds.
 * @return esp_err_t ESP_OK if started successfully.
 */
esp_err_t transfer_mgr_start(actuator_id_t source_pump, actuator_id_t dest_valve, uint32_t duration_sec);

/**
 * @brief Stop any ongoing transfer.
 */
esp_err_t transfer_mgr_stop(void);

/**
 * @brief Get the current state of the transfer manager.
 */
transfer_state_t transfer_mgr_get_state(void);

#ifdef __cplusplus
}
#endif
