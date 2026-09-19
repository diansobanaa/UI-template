#include "services/topology_capability.h"
#include "hal/hardware_registry.h"
#include "storage/storage_mgr.h"
#include "esp_log.h"
#include <string.h>
#include <strings.h>
#include <stdlib.h>
#include <stdio.h>

static const char *TAG = "TOPOLOGY_CAP";
#define TOPOLOGY_CFG_MAX 16384
#define MAX_GH 32
#define MAX_COMPONENTS 32

typedef struct {
    char gh_id[32];
    bool configured;
} gh_ref_t;

static bool operational_component(const cJSON *component)
{
    cJSON *life = cJSON_GetObjectItem(component, "lifecycleState");
    if (!life || !cJSON_IsString(life)) return false;
    return strcmp(life->valuestring, "COMMISSIONED") == 0 || strcmp(life->valuestring, "ENABLED") == 0;
}

static const cJSON *find_component_by_resource(const cJSON *components, const char *resource_id)
{
    if (!components || !cJSON_IsArray(components) || !resource_id || !resource_id[0]) return NULL;
    cJSON *item = NULL;
    cJSON_ArrayForEach(item, components) {
        cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
        if (rid && cJSON_IsString(rid) && strcmp(rid->valuestring, resource_id) == 0) return item;
    }
    return NULL;
}

static const char *component_text(const cJSON *component, char *buf, size_t len)
{
    if (!buf || len == 0) return "";
    buf[0] = '\0';
    if (!component) return buf;
    const cJSON *role = cJSON_GetObjectItem(component, "role");
    const cJSON *type = cJSON_GetObjectItem(component, "supportedTypeId");
    const cJSON *name = cJSON_GetObjectItem(component, "name");
    snprintf(buf, len, "%s %s %s",
             cJSON_IsString(role) ? role->valuestring : "",
             cJSON_IsString(type) ? type->valuestring : "",
             cJSON_IsString(name) ? name->valuestring : "");
    return buf;
}

static bool text_has(const char *text, const char *needle)
{
    if (!text || !needle || !needle[0]) return false;
    const size_t n = strlen(needle);
    for (const char *p = text; *p; ++p) {
        if (strncasecmp(p, needle, n) == 0) return true;
    }
    return false;
}

static bool gh_assigned(const cJSON *component, const char *gh_id)
{
    cJSON *assignment = cJSON_GetObjectItem(component, "assignment");
    if (!assignment || !cJSON_IsObject(assignment)) return false;
    cJSON *gh = cJSON_GetObjectItem(assignment, "ghId");
    return gh && cJSON_IsString(gh) && strcmp(gh->valuestring, gh_id) == 0;
}

static bool is_complex_component(const cJSON *component)
{
    cJSON *assignment = cJSON_GetObjectItem(component, "assignment");
    if (!assignment || !cJSON_IsObject(assignment)) return true;
    cJSON *gh = cJSON_GetObjectItem(assignment, "ghId");
    return !gh || !cJSON_IsString(gh) || gh->valuestring[0] == '\0';
}

static bool resource_is_operational(const cJSON *components, const char *resource_id)
{
    const cJSON *component = find_component_by_resource(components, resource_id);
    return operational_component(component);
}

static bool component_role_for_gh(const cJSON *components, const char *gh_id, const char *needle, bool include_complex)
{
    if (!components || !cJSON_IsArray(components)) return false;
    cJSON *component = NULL;
    cJSON_ArrayForEach(component, components) {
        if (!operational_component(component)) continue;
        if (!(gh_assigned(component, gh_id) || (include_complex && is_complex_component(component)))) continue;
        char text[160];
        component_text(component, text, sizeof(text));
        if (text_has(text, needle)) return true;
    }
    return false;
}

static bool component_role_any_for_gh(const cJSON *components, const char *gh_id, const char *const *needles, size_t needle_count, bool include_complex)
{
    if (!components || !cJSON_IsArray(components)) return false;
    cJSON *component = NULL;
    cJSON_ArrayForEach(component, components) {
        if (!operational_component(component)) continue;
        if (!(gh_assigned(component, gh_id) || (include_complex && is_complex_component(component)))) continue;
        char text[160];
        component_text(component, text, sizeof(text));
        for (size_t i = 0; i < needle_count; ++i) {
            if (text_has(text, needles[i])) return true;
        }
    }
    return false;
}

static bool is_tank_for_gh(const cJSON *component, const char *gh_id)
{
    if (!operational_component(component) || !gh_assigned(component, gh_id)) return false;
    char text[160];
    component_text(component, text, sizeof(text));
    return text_has(text, "TANK") && (text_has(text, "MIX") || text_has(text, "MIXING"));
}

static bool route_references_operational_aux(const cJSON *components, const cJSON *path)
{
    const char *keys[] = {"valveResourceId", "pumpResourceId", "tankResourceId"};
    for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); ++i) {
        cJSON *item = cJSON_GetObjectItem(path, keys[i]);
        if (item && cJSON_IsString(item) && item->valuestring[0] && !resource_is_operational(components, item->valuestring)) return false;
    }
    return true;
}

static bool delivery_path_reachable(const cJSON *components, const cJSON *topology, const char *gh_id)
{
    if (!components || !topology || !cJSON_IsArray(topology) || !gh_id || !gh_id[0]) return false;
    cJSON *path = NULL;
    cJSON_ArrayForEach(path, topology) {
        cJSON *enabled = cJSON_GetObjectItem(path, "enabled");
        if (enabled && cJSON_IsFalse(enabled)) continue;
        cJSON *source = cJSON_GetObjectItem(path, "sourceResourceId");
        cJSON *target = cJSON_GetObjectItem(path, "targetResourceId");
        if (!source || !cJSON_IsString(source) || !target || !cJSON_IsString(target)) continue;
        const cJSON *source_component = find_component_by_resource(components, source->valuestring);
        const cJSON *target_component = find_component_by_resource(components, target->valuestring);
        if (!source_component || !target_component || !is_tank_for_gh(source_component, gh_id) || !gh_assigned(target_component, gh_id) || !operational_component(target_component)) continue;
        char text[160];
        component_text(target_component, text, sizeof(text));
        if (!(text_has(text, "DISTRIBUTION_PUMP") || text_has(text, "DELIVERY_PUMP") || text_has(text, "DIST_PUMP") || text_has(text, "FERTIGATION_PUMP"))) continue;
        if (!resource_is_operational(components, source->valuestring) || !resource_is_operational(components, target->valuestring)) continue;
        if (!route_references_operational_aux(components, path)) continue;
        return true;
    }
    return false;
}

static bool string_in_ghs(const gh_ref_t *ghs, size_t count, const char *gh_id)
{
    for (size_t i = 0; i < count; ++i) if (strcmp(ghs[i].gh_id, gh_id) == 0) return true;
    return false;
}

static bool source_feeds_other_gh(const cJSON *components, const cJSON *topology, const gh_ref_t *ghs, size_t gh_count,
                                   const char *current_gh, const char *current_target, const char *source_resource_id)
{
    if (!components || !topology || !cJSON_IsArray(topology) || !current_gh || !current_target || !source_resource_id || gh_count < 2) return false;
    cJSON *path = NULL;
    cJSON_ArrayForEach(path, topology) {
        cJSON *enabled = cJSON_GetObjectItem(path, "enabled");
        if (enabled && cJSON_IsFalse(enabled)) continue;
        cJSON *source = cJSON_GetObjectItem(path, "sourceResourceId");
        cJSON *target = cJSON_GetObjectItem(path, "targetResourceId");
        if (!source || !cJSON_IsString(source) || !target || !cJSON_IsString(target)) continue;
        if (strcmp(source->valuestring, source_resource_id) != 0) continue;
        if (strcmp(target->valuestring, current_target) == 0) continue;
        for (size_t gi = 0; gi < gh_count; ++gi) {
            if (strcmp(ghs[gi].gh_id, current_gh) == 0) continue;
            const cJSON *target_component = find_component_by_resource(components, target->valuestring);
            if (target_component && is_tank_for_gh(target_component, ghs[gi].gh_id)) return true;
        }
    }
    return false;
}

esp_err_t topology_capability_build_json(cJSON **out_json)
{
    if (!out_json) return ESP_ERR_INVALID_ARG;
    *out_json = NULL;

    char *cfg_buf = calloc(1, TOPOLOGY_CFG_MAX);
    if (!cfg_buf) return ESP_ERR_NO_MEM;
    size_t cfg_len = 0;
    esp_err_t err = storage_mgr_load_config(cfg_buf, TOPOLOGY_CFG_MAX, &cfg_len);
    if (err != ESP_OK) {
        free(cfg_buf);
        return err;
    }

    cJSON *cfg = cJSON_ParseWithLength(cfg_buf, cfg_len);
    free(cfg_buf);
    if (!cfg) return ESP_ERR_INVALID_ARG;

    cJSON *components = cJSON_GetObjectItem(cfg, "components");
    cJSON *topology = cJSON_GetObjectItem(cfg, "topology");
    cJSON *greenhouses = cJSON_GetObjectItem(cfg, "greenhouses");
    if (!components || !cJSON_IsArray(components)) {
        cJSON_Delete(cfg);
        return ESP_ERR_INVALID_STATE;
    }

    gh_ref_t ghs[MAX_GH] = {0};
    size_t gh_count = 0;
    if (greenhouses && cJSON_IsArray(greenhouses)) {
        cJSON *gh = NULL;
        cJSON_ArrayForEach(gh, greenhouses) {
            cJSON *id = cJSON_GetObjectItem(gh, "ghId");
            if (id && cJSON_IsString(id) && id->valuestring[0] && gh_count < MAX_GH && !string_in_ghs(ghs, gh_count, id->valuestring)) {
                strncpy(ghs[gh_count].gh_id, id->valuestring, sizeof(ghs[gh_count].gh_id) - 1);
                ghs[gh_count].configured = true;
                gh_count++;
            }
        }
    }
    cJSON *component = NULL;
    cJSON_ArrayForEach(component, components) {
        cJSON *assignment = cJSON_GetObjectItem(component, "assignment");
        cJSON *gh = assignment ? cJSON_GetObjectItem(assignment, "ghId") : NULL;
        if (gh && cJSON_IsString(gh) && gh->valuestring[0] && gh_count < MAX_GH && !string_in_ghs(ghs, gh_count, gh->valuestring)) {
            strncpy(ghs[gh_count].gh_id, gh->valuestring, sizeof(ghs[gh_count].gh_id) - 1);
            ghs[gh_count].configured = false;
            gh_count++;
        }
    }

    cJSON *root = cJSON_CreateObject();
    if (!root) { cJSON_Delete(cfg); return ESP_ERR_NO_MEM; }
    cJSON *version = cJSON_GetObjectItem(cfg, "version");
    cJSON_AddNumberToObject(root, "topologyVersion", version && cJSON_IsNumber(version) ? version->valuedouble : 0);
    cJSON_AddNumberToObject(root, "capabilitiesVersion", version && cJSON_IsNumber(version) ? version->valuedouble : 0);
    cJSON_AddBoolToObject(root, "valid", true);
    cJSON *issues = cJSON_AddArrayToObject(root, "issues");
    cJSON *by_gh = cJSON_AddObjectToObject(root, "byGh");
    (void)issues;

    for (size_t gi = 0; gi < gh_count; ++gi) {
        const char *gh_id = ghs[gi].gh_id;
        bool configured = ghs[gi].configured;
        bool hydraulic = false;
        bool delivery_reachable = delivery_path_reachable(components, topology, gh_id);
        bool auto_route = false;
        bool manual_route = false;
        bool shared_path = false;
        bool routing_control_required = false;
        char manual_owner[32] = {0};
        bool mix_tank = component_role_for_gh(components, gh_id, "MIXING_TANK", false) || component_role_for_gh(components, gh_id, "MIX_TANK", false);
        const char *dose_needles[] = {"DOSING"};
        bool dosing = component_role_any_for_gh(components, gh_id, dose_needles, 1, true);
        const char *deliver_needles[] = {"DISTRIBUTION_PUMP", "DELIVERY_PUMP", "DIST_PUMP", "FERTIGATION_PUMP"};
        bool deliver = component_role_any_for_gh(components, gh_id, deliver_needles, 4, false);
        const char *raw_needles[] = {"WELL_PUMP", "RAW_WATER", "RAW_SUBMERSIBLE"};
        bool raw_source = component_role_any_for_gh(components, gh_id, raw_needles, 3, true);
        const char *flow_needles[] = {"FLOW_METER", "FLOW_SENSOR"};
        const char *level_needles[] = {"LEVEL", "FLOAT", "RADAR", "TANK_SENSOR"};
        const char *ec_needles[] = {"EC", "CONDUCTIVITY"};
        const char *ph_needles[] = {"PH"};
        const char *climate_needles[] = {"FAN", "BLOWER", "CLIMATE", "TEMPERATURE", "HUMIDITY"};
        bool monitor_flow = component_role_any_for_gh(components, gh_id, flow_needles, 2, false);
        bool monitor_level = component_role_any_for_gh(components, gh_id, level_needles, 4, false);
        bool monitor_ec = component_role_any_for_gh(components, gh_id, ec_needles, 2, false);
        bool monitor_ph = component_role_any_for_gh(components, gh_id, ph_needles, 1, false);
        bool climate = component_role_any_for_gh(components, gh_id, climate_needles, 5, false);

        /* Find source→GH mixing tank paths only. Delivery edges are not routing edges. */
        if (topology && cJSON_IsArray(topology)) {
            cJSON *path = NULL;
            cJSON_ArrayForEach(path, topology) {
                cJSON *enabled = cJSON_GetObjectItem(path, "enabled");
                if (enabled && cJSON_IsFalse(enabled)) continue;
                cJSON *target = cJSON_GetObjectItem(path, "targetResourceId");
                if (!target || !cJSON_IsString(target)) continue;
                const cJSON *target_component = find_component_by_resource(components, target->valuestring);
                if (!target_component || !is_tank_for_gh(target_component, gh_id)) continue;

                cJSON *source = cJSON_GetObjectItem(path, "sourceResourceId");
                if (!source || !cJSON_IsString(source) || !resource_is_operational(components, source->valuestring) || !resource_is_operational(components, target->valuestring)) continue;
                if (!route_references_operational_aux(components, path)) continue;
                hydraulic = true;

                cJSON *mode = cJSON_GetObjectItem(path, "mode");
                const bool auto_mode = !mode || !cJSON_IsString(mode) || strcasecmp(mode->valuestring, "AUTOMATIC") == 0;
                cJSON *shared = cJSON_GetObjectItem(path, "shared");
                const bool shared_mode = shared && cJSON_IsTrue(shared);
                cJSON *valve = cJSON_GetObjectItem(path, "valveResourceId");
                const bool has_routing_valve = valve && cJSON_IsString(valve) && valve->valuestring[0];
                const bool source_is_shared_without_control = source_feeds_other_gh(components, topology, ghs, gh_count, gh_id, target->valuestring, source->valuestring) && !has_routing_valve;
                const bool independent_auto_allowed = !source_is_shared_without_control;
                if (source_is_shared_without_control) routing_control_required = true;
                if (auto_mode && independent_auto_allowed) auto_route = true;
                if (!auto_mode || shared_mode) {
                    manual_route = true;
                    cJSON *owner = cJSON_GetObjectItem(path, "routeOwnerGhId");
                    if (owner && cJSON_IsString(owner) && owner->valuestring[0] && !manual_owner[0]) strncpy(manual_owner, owner->valuestring, sizeof(manual_owner) - 1);
                    if (shared_mode) shared_path = true;
                }
            }
        }

        cJSON *global_owner = cJSON_GetObjectItem(cfg, "manualRouteOwnerGhId");
        if (global_owner && cJSON_IsString(global_owner) && global_owner->valuestring[0]) strncpy(manual_owner, global_owner->valuestring, sizeof(manual_owner) - 1);
        if (manual_route) shared_path = true;

        const bool can_deliver = deliver && delivery_reachable;
        const bool can_auto_route = auto_route;
        const bool manual_granted = manual_owner[0] && strcmp(manual_owner, gh_id) == 0;
        const bool current_route_active = can_auto_route || manual_granted;
        const bool can_auto_fill = raw_source && hydraulic && current_route_active;
        const bool can_auto_dose = dosing;
        const bool can_auto_mix = mix_tank && can_auto_dose && hydraulic;
        const bool route_ok = current_route_active || (!shared_path && !routing_control_required);
        const bool can_run = configured && can_deliver && can_auto_dose && can_auto_mix && route_ok;

        cJSON *state = cJSON_CreateObject();
        cJSON_AddStringToObject(state, "ghId", gh_id);
        cJSON_AddBoolToObject(state, "configured", configured);
        cJSON_AddBoolToObject(state, "hydraulicallyReachable", hydraulic);
        cJSON_AddBoolToObject(state, "deliveryReachable", delivery_reachable);
        cJSON_AddBoolToObject(state, "automaticallyRoutable", can_auto_route);
        cJSON_AddBoolToObject(state, "manuallyRoutable", manual_route || can_auto_route);
        if (manual_granted) cJSON_AddStringToObject(state, "currentSharedManualTarget", gh_id); else cJSON_AddNullToObject(state, "currentSharedManualTarget");
        cJSON_AddBoolToObject(state, "sharedPath", shared_path);
        cJSON_AddBoolToObject(state, "routingControlRequired", routing_control_required);

        cJSON *caps = cJSON_AddObjectToObject(state, "capabilities");
        cJSON_AddBoolToObject(caps, "CAN_DELIVER", can_deliver);
        cJSON_AddBoolToObject(caps, "CAN_AUTO_FILL", can_auto_fill);
        cJSON_AddBoolToObject(caps, "CAN_AUTO_DOSE", can_auto_dose);
        cJSON_AddBoolToObject(caps, "CAN_AUTO_MIX", can_auto_mix);
        cJSON_AddBoolToObject(caps, "CAN_AUTO_ROUTE", can_auto_route);
        cJSON_AddBoolToObject(caps, "CAN_MONITOR_FLOW", monitor_flow);
        cJSON_AddBoolToObject(caps, "CAN_MONITOR_LEVEL", monitor_level);
        cJSON_AddBoolToObject(caps, "CAN_MONITOR_EC", monitor_ec);
        cJSON_AddBoolToObject(caps, "CAN_MONITOR_PH", monitor_ph);
        cJSON_AddBoolToObject(caps, "CAN_CLIMATE_CONTROL", climate);
        cJSON_AddBoolToObject(caps, "CAN_RUN_AUTONOMOUSLY", can_run);
        cJSON_AddItemToObject(by_gh, gh_id, state);
    }

    *out_json = root;
    cJSON_Delete(cfg);
    ESP_LOGI(TAG, "Built topology/capability view for %u GH(s)", (unsigned)gh_count);
    return ESP_OK;
}
