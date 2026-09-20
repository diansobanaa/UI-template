#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <time.h>
#include "esp_err.h"
#include "services/command_mgr.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SCHED_TYPE_DAILY = 0,
    SCHED_TYPE_INTERVAL,
    SCHED_TYPE_ONCE
} schedule_type_t;

typedef enum {
    SCHED_ACTION_FERTIGATION = 0,
    SCHED_ACTION_WATER_PUMP,
    SCHED_ACTION_FAN_TOGGLE,
    SCHED_ACTION_CUSTOM
} schedule_action_t;

/* Summary used by the legacy read-only schedule endpoint. Runtime authority is
 * the deployed compiled schedule set, not these writable legacy entries. */
typedef struct {
    char id[40];
    bool enabled;
    schedule_type_t type;
    schedule_action_t action;
    uint32_t duration_sec;
    uint8_t hour;
    uint8_t minute;
    uint8_t days_of_week;
    uint32_t interval_min;
    int64_t last_execution_timestamp;
    bool is_running;
    char current_command_id[40];
} schedule_entry_t;

/** Initialize the local ESP32 runtime scheduler. */
esp_err_t scheduler_init(void);

/** Legacy write APIs are retained only for source compatibility; they are not executable. */
esp_err_t scheduler_add_entry(const schedule_entry_t *entry);
esp_err_t scheduler_remove_entry(const char *id);
esp_err_t scheduler_get_all(schedule_entry_t *out_entries, size_t max_entries, size_t *out_count);
esp_err_t scheduler_clear_all(void);

/**
 * Persist and activate a validated compiled schedule set for the current
 * Active Configuration. Runtime parsing is performed before commit so a bad
 * payload cannot replace the previously active compiled set.
 */
esp_err_t scheduler_deploy_compiled_json(const char *json_str);
esp_err_t scheduler_get_compiled_json(char *out_buf, size_t max_len, size_t *out_len);
esp_err_t scheduler_clear_compiled(void);

/** One deterministic scheduler evaluation pass. Useful for host/simulation tests. */
esp_err_t scheduler_evaluate_at(time_t now);

#ifdef __cplusplus
}
#endif
