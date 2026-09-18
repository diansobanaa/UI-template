#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    CMD_TYPE_WELL_PUMP = 0,
    CMD_TYPE_DIST_PUMP,
    CMD_TYPE_DOSING_RUN,
    CMD_TYPE_TANK_TRANSFER,
    CMD_TYPE_FERTIGATION_BATCH,
    CMD_TYPE_EMERGENCY_STOP,
    CMD_TYPE_RESUME,
    CMD_TYPE_TOGGLE_COMPONENT,
    CMD_TYPE_CUSTOM
} cmd_type_t;

typedef enum {
    CMD_STATUS_PENDING = 0,
    CMD_STATUS_RUNNING,
    CMD_STATUS_COMPLETED,
    CMD_STATUS_FAILED,
    CMD_STATUS_REJECTED
} cmd_status_enum_t;

typedef struct {
    char command_id[40];
    cmd_type_t type;
    char target_gh_id[32];
    char target_component_id[32];
    int32_t param_duration_sec;
    int32_t param_volume_ml;
    int32_t param_raw_volume_ml;
    int32_t param_dosing_a_ml;
    int32_t param_dosing_b_ml;
    uint8_t param_source_id;
    uint8_t param_dest_id;
    cmd_status_enum_t status;
    int64_t submitted_at;
    char message[64];
} command_item_t;

/**
 * @brief Initialize the FreeRTOS command dispatcher queue and task.
 */
esp_err_t command_mgr_init(void);

/**
 * @brief Submit a command. Enforces idempotency: if command_id exists in cache, returns cached status without re-executing.
 */
esp_err_t command_mgr_submit(const command_item_t *cmd, command_item_t *out_receipt);

/**
 * @brief Look up a command by command_id.
 */
esp_err_t command_mgr_get(const char *command_id, command_item_t *out_receipt);

/**
 * @brief Cancel a command (lifecycle termination).
 */
esp_err_t command_mgr_cancel(const char *command_id);

#ifdef __cplusplus
}
#endif
