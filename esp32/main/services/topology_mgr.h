#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "services/configuration_mgr.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    bool can_deliver;
    bool can_auto_fill;
    bool can_auto_dose;
    bool can_auto_mix;
    bool can_auto_route;
    bool can_monitor_flow;
    bool can_monitor_level;
    bool can_monitor_ec;
    bool can_monitor_ph;
    bool can_climate_control;
    bool can_run_autonomously;
} gh_capability_t;

typedef struct {
    char gh_id[32];
    bool configured;
    bool hydraulically_reachable;
    bool automatically_routable;
    bool manually_routable;
    char current_shared_target[32];
    char blocking_reason[128];
    gh_capability_t capabilities;
} gh_topology_state_t;

typedef struct {
    gh_topology_state_t gh_states[MAX_GREENHOUSES];
    size_t count;
} topology_status_t;

/**
 * @brief Validates the topological integrity of the candidate configuration.
 * Detects missing sources, missing pumps, broken paths, and ownership conflicts.
 */
esp_err_t topology_mgr_validate_candidate(const active_configuration_t *candidate);

/**
 * @brief Computes the deterministic capabilities and topology state of the current configuration.
 */
esp_err_t topology_mgr_compute_status(const active_configuration_t *cfg, topology_status_t *out_status);

#ifdef __cplusplus
}
#endif
