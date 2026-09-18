#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#include "system_config.h"

/* Canonical M3 Structs */

typedef struct {
    char gh_id[32];
    char name[48];
} cfg_greenhouse_t;

typedef enum {
    CFG_RECIPE_TYPE_FERTIGATION,
    CFG_RECIPE_TYPE_IRRIGATION,
    CFG_RECIPE_TYPE_MIXING
} cfg_recipe_type_t;

typedef struct {
    char recipe_id[32];
    char name[48];
    cfg_recipe_type_t type;
    float target_ec;
    float target_ph;
    float ratio_a;
    float ratio_b;
    uint32_t duration_sec;
    uint32_t volume_ml;
} cfg_recipe_t;

typedef enum {
    CFG_SCHED_TYPE_DAILY,
    CFG_SCHED_TYPE_INTERVAL,
    CFG_SCHED_TYPE_ONCE
} cfg_sched_type_t;

typedef enum {
    CFG_SCHED_ACTION_FERTIGATION,
    CFG_SCHED_ACTION_WATER_PUMP,
    CFG_SCHED_ACTION_FAN_TOGGLE,
    CFG_SCHED_ACTION_CUSTOM
} cfg_sched_action_t;

// Product-level defined limit: 16 maximum resolved resources per scheduled action to fit within predictable SRAM envelopes.
#define CFG_MAX_RESOLVED_RESOURCES 16

typedef enum {
    SCHED_STATUS_DRAFT,
    SCHED_STATUS_VALIDATING,
    SCHED_STATUS_ACTIVE,
    SCHED_STATUS_BLOCKED,
    SCHED_STATUS_DISABLED,
    SCHED_STATUS_INVALID
} cfg_sched_status_t;

typedef struct {
    char schedule_id[32];
    char target_gh_id[32];
    char resolved_action[32];
    char resolved_resources[CFG_MAX_RESOLVED_RESOURCES][32];
    size_t resolved_resource_count;
    char recipe_id[32];
    uint32_t recipe_version;
    uint32_t safety_dependencies; // Bitmask: 1=ESTOP, 2=FLOW_VALID, 4=LEVEL_VALID, etc.
    uint32_t configuration_version;
    uint8_t priority;
    cfg_sched_status_t status;
    
    // Recurrence/Trigger fields can be added here or resolved by the runtime scheduler
    uint8_t hour;       
    uint8_t minute;     
    uint8_t days_of_week; 
    uint32_t interval_min; 
    uint32_t duration_sec;
} compiled_schedule_t;

typedef enum {
    CFG_SCOPE_COMPLEX,
    CFG_SCOPE_GREENHOUSE
} cfg_scope_t;

typedef struct {
    char assignment_id[32];
    char resource_id[32];
    cfg_scope_t scope;
    char gh_id[32]; // Optional if scope is GREENHOUSE
} cfg_assignment_t;

typedef struct {
    char source_resource_id[32];
    char target_resource_id[32];
    char connection_type[32];
} cfg_topology_edge_t;

typedef struct {
    uint32_t version;
    char complex_id[32];
    char updated_at[32];
    
    cfg_greenhouse_t greenhouses[MAX_GREENHOUSES];
    size_t greenhouse_count;
    
    cfg_recipe_t recipes[16];
    size_t recipe_count;
    
    compiled_schedule_t schedules[16];
    size_t schedule_count;
    
    cfg_assignment_t assignments[32];
    size_t assignment_count;
    
    cfg_topology_edge_t topology[32];
    size_t topology_count;
} active_configuration_t;

/**
 * @brief Parse JSON configuration into the candidate configuration buffer.
 */
esp_err_t configuration_mgr_parse_candidate(const char *json_str);

/**
 * @brief Promote the candidate configuration to the active configuration.
 */
esp_err_t configuration_mgr_apply_candidate(void);

/**
 * @brief Load the active configuration directly from NVS persistent storage (lvc_json).
 */
esp_err_t configuration_mgr_load_active(void);

/**
 * @brief Clear the active runtime configuration.
 */
esp_err_t configuration_mgr_clear_active(void);

/**
 * @brief Get a read-only pointer to the active configuration.
 */
const active_configuration_t *configuration_mgr_get_active(void);

#ifdef __cplusplus
}
#endif
