#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    ALARM_PRIO_NONE = 0,
    ALARM_PRIO_TEST,          /* Lowest: Manual buzzer test (single bounded beep) */
    ALARM_PRIO_SAFETY_FAULT,  /* High: Operational safety faults (TANK_LOW, FLOW_TIMEOUT, ACTUATOR_MAX_RUNTIME, SAFETY_SENSOR_STALE) */
    ALARM_PRIO_CRITICAL       /* Highest: Emergency stop, tamper loop, critical water temp > 45C */
} alarm_priority_t;

typedef enum {
    ALARM_PATTERN_OFF = 0,
    ALARM_PATTERN_TEST,          /* 800ms ON once */
    ALARM_PATTERN_INTERMITTENT,  /* 200ms ON, 150ms OFF, 200ms ON, 2000ms OFF */
    ALARM_PATTERN_CRITICAL       /* 200ms ON, 150ms OFF urgent repeating */
} alarm_pattern_t;

#define MAX_ACTIVE_ALARMS 16

typedef struct {
    char id[32];               /* e.g. "alm-1" */
    char code[48];             /* e.g. "FLOW_TIMEOUT", "TANK_LOW", "EMERGENCY_STOP_ACTIVE" */
    char message[128];         /* Human-readable message */
    char component_id[40];     /* e.g. "pump_well", or empty */
    char gh_id[32];            /* e.g. "gh-01", or empty */
    alarm_priority_t priority;
    bool active;
    bool acknowledged;
    bool silenced;
    int64_t created_at_ms;
    int64_t acknowledged_at_ms;
    int64_t silenced_at_ms;
    int64_t resolved_at_ms;
} alarm_record_t;

/**
 * @brief Initialize the Centralized Alarm Manager and start the non-blocking pattern engine.
 */
esp_err_t alarm_mgr_init(void);

/**
 * @brief Register or update an active alarm condition (debounced, deduplicated).
 */
esp_err_t alarm_mgr_raise(alarm_priority_t priority, const char *code, const char *message,
                          const char *component_id, const char *gh_id);

/**
 * @brief Mark an alarm condition as resolved when normal conditions are restored.
 */
esp_err_t alarm_mgr_resolve(const char *code, const char *component_id);

/**
 * @brief Acknowledge an alarm (operator recognition). Does NOT clear fault or reset E-Stop.
 * If alarm_id is NULL or empty, acknowledges all currently active alarms.
 */
esp_err_t alarm_mgr_acknowledge(const char *alarm_id);

/**
 * @brief Silence the physical buzzer sound for currently active alarms.
 * Does NOT clear alarms from active list. If a new higher-priority alarm occurs, sound reactivates.
 */
esp_err_t alarm_mgr_silence(bool silence);

/**
 * @brief Trigger a manual physical buzzer test for bounded duration (ms).
 * Fails if higher-priority critical or safety fault alarms are active.
 */
esp_err_t alarm_mgr_trigger_test(uint32_t duration_ms);

/**
 * @brief Get highest active alarm priority currently registered.
 */
alarm_priority_t alarm_mgr_get_highest_priority(void);

/**
 * @brief Check if physical buzzer is currently audible (active and not silenced).
 */
bool alarm_mgr_is_audible(void);

/**
 * @brief Check if alarm manager is in silenced state.
 */
bool alarm_mgr_is_silenced(void);

/**
 * @brief Get JSON object of all active and recent alarms + summary statistics.
 */
cJSON *alarm_mgr_get_status_json(void);

/**
 * @brief Get compact summary JSON for inclusion in status & telemetry endpoints.
 */
cJSON *alarm_mgr_get_summary_json(void);

#ifdef __cplusplus
}
#endif
