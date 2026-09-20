#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
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
    CMD_TYPE_COMPONENT_TIMED,
    CMD_TYPE_CUSTOM
} cmd_type_t;

typedef enum {
    CMD_STATUS_PENDING = 0,
    CMD_STATUS_RUNNING,
    CMD_STATUS_COMPLETED,
    CMD_STATUS_FAILED,
    CMD_STATUS_REJECTED,
    CMD_STATUS_CANCELLED
} cmd_status_enum_t;

typedef struct {
    char command_id[40];
    cmd_type_t type;
    int32_t param_duration_sec;
    int32_t param_volume_ml;
    int32_t param_raw_volume_ml;
    bool param_on;
    char component_id[40];
    char resource_id[40];
    char target_complex_id[40];
    char target_gh_id[40];
    char source[24];
    uint32_t configuration_version;
    uint32_t max_runtime_sec;
    /* Deprecated numeric IDs retained only for wire compatibility; runtime transfer requires logical component IDs. */
    uint8_t param_source_id;
    uint8_t param_dest_id;
    char source_component_id[40];
    char destination_component_id[40];
    cmd_status_enum_t status;
    int64_t submitted_at;
    int64_t started_at;
    int64_t completed_at;
    char result_code[48];
    char message[96];
    char fertigation_payload_json[6144];
} command_item_t;

esp_err_t command_mgr_init(void);
esp_err_t command_mgr_submit(const command_item_t *cmd, command_item_t *out_receipt);
esp_err_t command_mgr_get(const char *command_id, command_item_t *out_receipt);
esp_err_t command_mgr_cancel(const char *command_id);

/** Mark all pending/running commands failed after a global safety trip. */
esp_err_t command_mgr_notify_safety_trip(const char *reason_code, const char *reason);

/** Mark the command affecting a component failed after a targeted safety trip. */
esp_err_t command_mgr_notify_component_safety_fault(const char *component_id, const char *reason_code, const char *reason);

#ifdef __cplusplus
}
#endif
