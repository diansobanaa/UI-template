#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    FERT_STATE_IDLE = 0,
    FERT_STATE_FILLING,
    FERT_STATE_DOSING,
    FERT_STATE_FINAL_MIXING,
    FERT_STATE_DELIVERY,
    FERT_STATE_COMPLETE,
    FERT_STATE_INTERRUPTED
} fertigation_state_t;

/**
 * @brief Initialize the Fertigation Manager.
 *        Starts the non-blocking state machine task.
 */
esp_err_t fertigation_mgr_init(void);

/**
 * @brief Start a new fertigation batch with specified volumes in mL.
 *        Will only start if the current state is IDLE or COMPLETE.
 */
esp_err_t fertigation_mgr_start_batch(int32_t raw_volume_ml, int32_t dosing_a_ml, int32_t dosing_b_ml);

/**
 * @brief Get the current state of the fertigation batch.
 */
fertigation_state_t fertigation_mgr_get_state(void);

/**
 * @brief Cancel the current batch and return to IDLE.
 */
esp_err_t fertigation_mgr_cancel_batch(void);

#ifdef __cplusplus
}
#endif
