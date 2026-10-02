#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <time.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define WELL_PUMP_MAX_MANUAL_RUNTIME_SEC 900U /* 15 minutes hard ceiling per spec */

typedef enum {
    WELL_PUMP_MODE_AUTO = 0,
    WELL_PUMP_MODE_MANUAL = 1
} well_pump_mode_t;

typedef struct {
    well_pump_mode_t mode;
    bool on;
    bool is_manual_session_active;
    uint32_t max_runtime_sec;
    uint32_t elapsed_sec;
    uint32_t remaining_sec;
    char stop_reason[48];      /* e.g. "MANUAL_RUNTIME_LIMIT_REACHED", "OPERATOR_OFF", "SAFETY_ESTOP", "SCHEDULE_STOP" */
    char active_schedule_id[40];
} well_pump_status_t;

/**
 * @brief Initialize the Well Pump centralized manager, load persisted mode, and start monitoring.
 */
esp_err_t well_pump_mgr_init(void);

/**
 * @brief Get current authoritative operating mode.
 */
well_pump_mode_t well_pump_get_mode(void);

/**
 * @brief Change operating mode between AUTO and MANUAL.
 * When switching from MANUAL to AUTO, immediately evaluates current schedule state and applies
 * it to the relay without requiring confirmation.
 */
esp_err_t well_pump_set_mode(well_pump_mode_t mode);

/**
 * @brief Start manual ON operation with 15-minute runtime ceiling.
 * Rejects if in AUTO mode unless mode is changed first.
 * Repeated ON while already running does NOT extend the deadline.
 */
esp_err_t well_pump_manual_start(uint32_t duration_sec);

/**
 * @brief Stop manual operation immediately.
 * Cancels active 15-minute timer and clears manual session.
 */
esp_err_t well_pump_manual_stop(const char *reason);

/**
 * @brief Handle physical panel toggle (GPIO 39 / Button 2).
 * Toggles Well Pump output with 15-minute ceiling on start.
 */
void well_pump_toggle_physical(void);

/**
 * @brief Safety hook: forces Well Pump OFF immediately and invalidates manual session.
 */
void well_pump_emergency_stop(void);

/**
 * @brief Evaluate current schedule and apply to physical relay when in AUTO mode.
 */
esp_err_t well_pump_reconcile_auto_schedule(time_t now);

/**
 * @brief Query current authoritative status of Well Pump.
 */
esp_err_t well_pump_get_status(well_pump_status_t *out_status);

#ifdef __cplusplus
}
#endif
