#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "services/command_mgr.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SCHED_TYPE_DAILY,       /* Runs every specified day at given time */
    SCHED_TYPE_INTERVAL,    /* Runs every N minutes */
    SCHED_TYPE_ONCE         /* Runs exactly once at a specific date/time */
} schedule_type_t;

typedef enum {
    SCHED_ACTION_FERTIGATION,
    SCHED_ACTION_WATER_PUMP,
    SCHED_ACTION_FAN_TOGGLE,
    SCHED_ACTION_CUSTOM
} schedule_action_t;

typedef struct {
    char id[16];
    bool enabled;
    schedule_type_t type;
    schedule_action_t action;
    uint32_t duration_sec;
    
    /* Time specifiers */
    uint8_t hour;           /* 0-23 */
    uint8_t minute;         /* 0-59 */
    uint8_t days_of_week;   /* Bitmask: 1<<0=Sun, 1<<1=Mon, ..., 1<<6=Sat */
    
    /* Interval specifiers */
    uint32_t interval_min;
    
    /* Execution state (Runtime, not persisted) */
    uint32_t last_execution_timestamp; /* Unix epoch */
    bool is_running;
    char current_command_id[40];
} schedule_entry_t;

/**
 * @brief Initialize the automated schedule runner. Loads schedules from NVS and starts task.
 */
esp_err_t scheduler_init(void);

/**
 * @brief Add or update a schedule entry in memory and NVS.
 */
esp_err_t scheduler_add_entry(const schedule_entry_t *entry);

/**
 * @brief Remove a schedule entry by ID from memory and NVS.
 */
esp_err_t scheduler_remove_entry(const char *id);

/**
 * @brief Get all schedule entries.
 */
esp_err_t scheduler_get_all(schedule_entry_t *out_entries, size_t max_entries, size_t *out_count);

/**
 * @brief Clear all schedule entries.
 */
esp_err_t scheduler_clear_all(void);

#ifdef __cplusplus
}
#endif
