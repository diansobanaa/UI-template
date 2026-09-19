#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SAFETY_STATE_NORMAL = 0,
    SAFETY_STATE_FAULT,
    SAFETY_STATE_EMERGENCY_STOP,
    SAFETY_STATE_RECOVERY
} safety_state_t;

typedef enum {
    SAFETY_COMMAND_NORMAL = 0,
    SAFETY_COMMAND_FILL,
    SAFETY_COMMAND_TRANSFER,
    SAFETY_COMMAND_FERTIGATION
} safety_command_class_t;

/** Initialize and start the background local safety monitor. */
esp_err_t safety_monitor_init(void);

/** Whether a safety fault is currently latched. */
bool safety_monitor_has_fault(void);

/** Whether normal physical commands are currently allowed. */
bool safety_monitor_allows_commands(void);

/** Scheduler gate: false while ESTOP/FAULT/RECOVERY blocks autonomous execution. */
bool safety_monitor_allows_scheduler(void);

/** Current safety state. */
safety_state_t safety_monitor_get_state(void);

/** Current latched fault/reason code; empty when none. */
const char *safety_monitor_get_fault_code(void);

/**
 * Authorize a physical command against local safety state, target component
 * state, runtime policy, low-level interlocks, and configured safety metadata.
 */
esp_err_t safety_monitor_authorize_component(
    const char *component_id,
    const char *target_gh_id,
    uint32_t duration_sec,
    safety_command_class_t command_class,
    char *out_reason_code,
    size_t reason_code_len,
    char *out_reason,
    size_t reason_len);

/**
 * Explicitly recover from a latched safety condition. Recovery is denied while
 * any blocking safety input remains active; actuator safety locks are cleared
 * only after the check passes.
 */
esp_err_t safety_monitor_request_recovery(char *out_reason_code, size_t reason_code_len,
                                          char *out_reason, size_t reason_len);

#ifdef __cplusplus
}
#endif
