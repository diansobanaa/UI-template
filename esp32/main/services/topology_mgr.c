#include "services/topology_mgr.h"
#include "hal/hardware_registry.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "TOPOLOGY_MGR";

static bool is_resource_operational(const char *resource_id, hw_component_info_t *out_hw) {
    hw_component_info_t hw;
    if (hardware_registry_find_by_id(resource_id, &hw) != ESP_OK) {
        return false;
    }
    if (out_hw) {
        *out_hw = hw;
    }
    return hardware_registry_is_operational(resource_id);
}

esp_err_t topology_mgr_validate_candidate(const active_configuration_t *candidate) {
    // Basic topological validation (M7.12)
    for (size_t i = 0; i < candidate->topology_count; i++) {
        const cfg_topology_edge_t *e = &candidate->topology[i];
        
        // Prevent self loop
        if (strcmp(e->source_resource_id, e->target_resource_id) == 0) {
            ESP_LOGE(TAG, "Topology edge creates self-loop on '%s'", e->source_resource_id);
            return ESP_ERR_INVALID_ARG;
        }

        hw_component_info_t src_hw, tgt_hw;
        if (hardware_registry_find_by_id(e->source_resource_id, &src_hw) != ESP_OK) {
            ESP_LOGW(TAG, "Topology edge source '%s' not found", e->source_resource_id);
            return ESP_ERR_NOT_FOUND;
        }
        if (hardware_registry_find_by_id(e->target_resource_id, &tgt_hw) != ESP_OK) {
            ESP_LOGW(TAG, "Topology edge target '%s' not found", e->target_resource_id);
            return ESP_ERR_NOT_FOUND;
        }
    }
    return ESP_OK;
}

// Helper to check if a component is owned by a specific GH or by COMPLEX
static bool is_owned_by_gh_or_complex(const active_configuration_t *cfg, const char *resource_id, const char *gh_id) {
    for (size_t i = 0; i < cfg->assignment_count; i++) {
        if (strcmp(cfg->assignments[i].resource_id, resource_id) == 0) {
            if (cfg->assignments[i].scope == CFG_SCOPE_COMPLEX) return true;
            if (strcmp(cfg->assignments[i].gh_id, gh_id) == 0) return true;
            return false;
        }
    }
    return false; // Not assigned at all
}

static void compute_gh_status(const active_configuration_t *cfg, const char *gh_id, gh_topology_state_t *st) {
    strncpy(st->gh_id, gh_id, sizeof(st->gh_id) - 1);
    st->configured = true;
    st->hydraulically_reachable = false;
    st->automatically_routable = false;
    st->manually_routable = false;
    st->blocking_reason[0] = '\0';
    st->current_shared_target[0] = '\0';
    memset(&st->capabilities, 0, sizeof(st->capabilities));

    bool has_pump_in_path = false;
    bool has_valve_in_path = false;
    bool has_valid_dest = false;
    bool has_valid_source = false;

    // Step 1: Find all sources owned by COMPLEX or this GH
    for (size_t i = 0; i < cfg->assignment_count; i++) {
        const cfg_assignment_t *a = &cfg->assignments[i];
        if (a->scope == CFG_SCOPE_COMPLEX || strcmp(a->gh_id, gh_id) == 0) {
            hw_component_info_t hw;
            if (is_resource_operational(a->resource_id, &hw)) {
                if (strstr(hw.supported_type_id, "WATER_TANK") || strstr(hw.supported_type_id, "NUTRIENT_SOURCE")) {
                    has_valid_source = true;
                    // DFS / BFS from this source to any destination owned by this GH
                    char queue[32][32];
                    int head = 0, tail = 0;
                    strncpy(queue[tail++], a->resource_id, 32);

                    while (head < tail) {
                        char curr[32];
                        strncpy(curr, queue[head++], 32);

                        // Check if curr is a valid destination for this GH
                        hw_component_info_t curr_hw;
                        if (is_resource_operational(curr, &curr_hw)) {
                            if ((strstr(curr_hw.supported_type_id, "MIXING_TANK") || strstr(curr_hw.supported_type_id, "GH_TARGET")) && 
                                is_owned_by_gh_or_complex(cfg, curr, gh_id)) {
                                has_valid_dest = true;
                                break;
                            }
                        }

                        // Traverse edges
                        for (size_t e = 0; e < cfg->topology_count; e++) {
                            if (strcmp(cfg->topology[e].source_resource_id, curr) == 0) {
                                const char *next = cfg->topology[e].target_resource_id;
                                if (is_owned_by_gh_or_complex(cfg, next, gh_id) && is_resource_operational(next, NULL)) {
                                    // Track path components
                                    hw_component_info_t next_hw;
                                    hardware_registry_find_by_id(next, &next_hw);
                                    if (strstr(next_hw.supported_type_id, "PUMP")) has_pump_in_path = true;
                                    if (strstr(next_hw.supported_type_id, "VALVE")) has_valve_in_path = true;

                                    if (tail < 32) strncpy(queue[tail++], next, 32);
                                }
                            }
                        }
                        if (has_valid_dest) break;
                    }
                }
            }
        }
    }

    // Step 2: Check Sensors in GH assignment
    for (size_t i = 0; i < cfg->assignment_count; i++) {
        if (strcmp(cfg->assignments[i].gh_id, gh_id) == 0) {
            hw_component_info_t hw;
            if (is_resource_operational(cfg->assignments[i].resource_id, &hw)) {
                if (strstr(hw.supported_type_id, "FLOW_METER")) st->capabilities.can_monitor_flow = true;
                if (strstr(hw.supported_type_id, "SENSOR")) {
                    if (strstr(hw.role, "EC")) st->capabilities.can_monitor_ec = true;
                    if (strstr(hw.role, "PH")) st->capabilities.can_monitor_ph = true;
                    if (strstr(hw.role, "LEVEL")) st->capabilities.can_monitor_level = true;
                }
                if (strstr(hw.supported_type_id, "DOSING")) st->capabilities.can_auto_dose = true;
            }
        }
    }

    // Step 3: Determine Reachability and Routability
    if (has_valid_source && has_valid_dest && has_pump_in_path) {
        st->hydraulically_reachable = true;
        st->capabilities.can_deliver = true;

        if (has_valve_in_path) {
            st->automatically_routable = true;
            st->capabilities.can_auto_route = true;
        } else {
            if (cfg->greenhouse_count > 1) {
                st->manually_routable = true;
                strncpy(st->blocking_reason, "No routing valve for shared path.", sizeof(st->blocking_reason)-1);
            } else {
                st->automatically_routable = true;
                st->capabilities.can_auto_route = true;
            }
        }
    } else {
        if (!has_valid_source) strncpy(st->blocking_reason, "Missing valid source.", sizeof(st->blocking_reason)-1);
        else if (!has_valid_dest) strncpy(st->blocking_reason, "Missing valid destination.", sizeof(st->blocking_reason)-1);
        else if (!has_pump_in_path) strncpy(st->blocking_reason, "Missing pump in path.", sizeof(st->blocking_reason)-1);
    }

    // Capability rule: can_run_autonomously
    if (st->capabilities.can_deliver && (st->automatically_routable || cfg->greenhouse_count == 1)) {
        st->capabilities.can_run_autonomously = true;
    }
}

esp_err_t topology_mgr_compute_status(const active_configuration_t *cfg, topology_status_t *out_status) {
    if (!cfg || !out_status) return ESP_ERR_INVALID_ARG;
    
    out_status->count = 0;
    for (size_t i = 0; i < cfg->greenhouse_count; i++) {
        gh_topology_state_t *st = &out_status->gh_states[out_status->count];
        compute_gh_status(cfg, cfg->greenhouses[i].gh_id, st);
        out_status->count++;
    }
    
    return ESP_OK;
}
