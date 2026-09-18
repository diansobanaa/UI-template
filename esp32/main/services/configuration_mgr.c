#include "services/configuration_mgr.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include "services/storage_mgr.h"
#include "services/scheduler.h"
#include "services/topology_mgr.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "CONFIG_MGR";

static active_configuration_t s_active_config = {0};
static active_configuration_t s_candidate_config = {0};
static bool s_candidate_valid = false;

static void parse_greenhouses(cJSON *gh_arr, active_configuration_t *cfg) {
    if (!gh_arr || !cJSON_IsArray(gh_arr)) return;
    int count = cJSON_GetArraySize(gh_arr);
    if (count > MAX_GREENHOUSES) count = MAX_GREENHOUSES;
    cfg->greenhouse_count = 0;
    
    for (int i = 0; i < count; i++) {
        cJSON *item = cJSON_GetArrayItem(gh_arr, i);
        if (!item) continue;
        
        cfg_greenhouse_t *g = &cfg->greenhouses[cfg->greenhouse_count];
        memset(g, 0, sizeof(cfg_greenhouse_t));
        
        cJSON *ghid = cJSON_GetObjectItem(item, "ghId");
        if (ghid && cJSON_IsString(ghid)) strncpy(g->gh_id, ghid->valuestring, sizeof(g->gh_id) - 1);
        
        cJSON *name = cJSON_GetObjectItem(item, "name");
        if (name && cJSON_IsString(name)) strncpy(g->name, name->valuestring, sizeof(g->name) - 1);
        
        cfg->greenhouse_count++;
    }
}

static void parse_recipes(cJSON *recipes_arr, active_configuration_t *cfg) {
    if (!recipes_arr || !cJSON_IsArray(recipes_arr)) return;
    int count = cJSON_GetArraySize(recipes_arr);
    if (count > 16) count = 16;
    cfg->recipe_count = 0;
    
    for (int i = 0; i < count; i++) {
        cJSON *item = cJSON_GetArrayItem(recipes_arr, i);
        if (!item) continue;
        
        cfg_recipe_t *r = &cfg->recipes[cfg->recipe_count];
        memset(r, 0, sizeof(cfg_recipe_t));
        
        cJSON *rid = cJSON_GetObjectItem(item, "recipeId");
        if (rid && cJSON_IsString(rid)) strncpy(r->recipe_id, rid->valuestring, sizeof(r->recipe_id) - 1);
        
        cJSON *name = cJSON_GetObjectItem(item, "name");
        if (name && cJSON_IsString(name)) strncpy(r->name, name->valuestring, sizeof(r->name) - 1);
        
        cJSON *type = cJSON_GetObjectItem(item, "type");
        if (type && cJSON_IsString(type)) {
            if (strcmp(type->valuestring, "FERTIGATION") == 0) r->type = CFG_RECIPE_TYPE_FERTIGATION;
            else if (strcmp(type->valuestring, "IRRIGATION") == 0) r->type = CFG_RECIPE_TYPE_IRRIGATION;
            else if (strcmp(type->valuestring, "MIXING") == 0) r->type = CFG_RECIPE_TYPE_MIXING;
        }
        
        cJSON *tec = cJSON_GetObjectItem(item, "targetEc");
        if (tec && cJSON_IsNumber(tec)) r->target_ec = tec->valuedouble;
        
        cJSON *tph = cJSON_GetObjectItem(item, "targetPh");
        if (tph && cJSON_IsNumber(tph)) r->target_ph = tph->valuedouble;
        
        cJSON *ra = cJSON_GetObjectItem(item, "ratioA");
        if (ra && cJSON_IsNumber(ra)) r->ratio_a = ra->valuedouble;
        
        cJSON *rb = cJSON_GetObjectItem(item, "ratioB");
        if (rb && cJSON_IsNumber(rb)) r->ratio_b = rb->valuedouble;
        
        cJSON *dur = cJSON_GetObjectItem(item, "durationSec");
        if (dur && cJSON_IsNumber(dur)) r->duration_sec = dur->valueint;
        
        cJSON *vol = cJSON_GetObjectItem(item, "volumeMl");
        if (vol && cJSON_IsNumber(vol)) r->volume_ml = vol->valueint;
        
        cfg->recipe_count++;
    }
}

static esp_err_t parse_compiled_schedules(cJSON *sched_arr, active_configuration_t *cfg) {
    if (!sched_arr || !cJSON_IsArray(sched_arr)) return ESP_OK;
    int count = cJSON_GetArraySize(sched_arr);
    if (count > 16) {
        ESP_LOGE(TAG, "Schedule count %d exceeds product limit 16", count);
        return ESP_ERR_INVALID_SIZE;
    }
    cfg->schedule_count = 0;
    
    for (int i = 0; i < count; i++) {
        cJSON *item = cJSON_GetArrayItem(sched_arr, i);
        if (!item) continue;
        
        compiled_schedule_t *s = &cfg->schedules[cfg->schedule_count];
        memset(s, 0, sizeof(compiled_schedule_t));
        
        cJSON *sid = cJSON_GetObjectItem(item, "scheduleId");
        if (sid && cJSON_IsString(sid)) strncpy(s->schedule_id, sid->valuestring, sizeof(s->schedule_id) - 1);
        
        cJSON *tgid = cJSON_GetObjectItem(item, "targetGhId");
        if (tgid && cJSON_IsString(tgid)) strncpy(s->target_gh_id, tgid->valuestring, sizeof(s->target_gh_id) - 1);
        
        cJSON *act = cJSON_GetObjectItem(item, "resolvedAction");
        if (act && cJSON_IsString(act)) strncpy(s->resolved_action, act->valuestring, sizeof(s->resolved_action) - 1);
        
        cJSON *cver = cJSON_GetObjectItem(item, "configurationVersion");
        if (cver && cJSON_IsNumber(cver)) s->configuration_version = cver->valueint;
        
        cJSON *prio = cJSON_GetObjectItem(item, "priority");
        if (prio && cJSON_IsNumber(prio)) s->priority = prio->valueint;
        
        cJSON *st = cJSON_GetObjectItem(item, "status");
        if (st && cJSON_IsString(st)) {
            if (strcmp(st->valuestring, "ACTIVE") == 0) s->status = SCHED_STATUS_ACTIVE;
            else if (strcmp(st->valuestring, "VALIDATING") == 0) s->status = SCHED_STATUS_VALIDATING;
            else if (strcmp(st->valuestring, "BLOCKED") == 0) s->status = SCHED_STATUS_BLOCKED;
            else if (strcmp(st->valuestring, "DISABLED") == 0) s->status = SCHED_STATUS_DISABLED;
            else if (strcmp(st->valuestring, "DRAFT") == 0) s->status = SCHED_STATUS_DRAFT;
            else s->status = SCHED_STATUS_INVALID;
        }

        // Parse recipe snapshot / id
        cJSON *rs = cJSON_GetObjectItem(item, "recipeSnapshot");
        if (rs && cJSON_IsObject(rs)) {
            cJSON *rid = cJSON_GetObjectItem(rs, "recipeId");
            if (rid && cJSON_IsString(rid)) strncpy(s->recipe_id, rid->valuestring, sizeof(s->recipe_id) - 1);
            cJSON *rver = cJSON_GetObjectItem(rs, "recipeVersion");
            if (rver && cJSON_IsNumber(rver)) s->recipe_version = rver->valueint;
        } else {
            cJSON *rid = cJSON_GetObjectItem(item, "recipeId");
            if (rid && cJSON_IsString(rid)) strncpy(s->recipe_id, rid->valuestring, sizeof(s->recipe_id) - 1);
            cJSON *rver = cJSON_GetObjectItem(item, "recipeVersion");
            if (rver && cJSON_IsNumber(rver)) s->recipe_version = rver->valueint;
        }

        // Recurrence / timing
        cJSON *h = cJSON_GetObjectItem(item, "hour");
        if (h && cJSON_IsNumber(h)) s->hour = (uint8_t)h->valueint;
        cJSON *m = cJSON_GetObjectItem(item, "minute");
        if (m && cJSON_IsNumber(m)) s->minute = (uint8_t)m->valueint;
        cJSON *dow = cJSON_GetObjectItem(item, "daysOfWeek");
        if (dow && cJSON_IsNumber(dow)) s->days_of_week = (uint8_t)dow->valueint;
        else s->days_of_week = 0x7F;
        cJSON *imin = cJSON_GetObjectItem(item, "intervalMin");
        if (imin && cJSON_IsNumber(imin)) s->interval_min = imin->valueint;
        cJSON *dur = cJSON_GetObjectItem(item, "durationSec");
        if (dur && cJSON_IsNumber(dur)) s->duration_sec = dur->valueint;

        // Parse resolved resources array
        cJSON *res_arr = cJSON_GetObjectItem(item, "resolvedResources");
        if (res_arr && cJSON_IsArray(res_arr)) {
            int res_count = cJSON_GetArraySize(res_arr);
            if (res_count > CFG_MAX_RESOLVED_RESOURCES) {
                ESP_LOGE(TAG, "Resolved resources count %d exceeds product limit %d (FAIL CLOSED)",
                         res_count, CFG_MAX_RESOLVED_RESOURCES);
                return ESP_ERR_INVALID_SIZE;
            }
            s->resolved_resource_count = 0;
            for (int j = 0; j < res_count; j++) {
                cJSON *res_id = cJSON_GetArrayItem(res_arr, j);
                if (res_id && cJSON_IsString(res_id)) {
                    strncpy(s->resolved_resources[s->resolved_resource_count], res_id->valuestring, 31);
                    s->resolved_resource_count++;
                }
            }
        }
        
        cfg->schedule_count++;
    }
    return ESP_OK;
}

static void parse_assignments(cJSON *assign_arr, active_configuration_t *cfg) {
    if (!assign_arr || !cJSON_IsArray(assign_arr)) return;
    int count = cJSON_GetArraySize(assign_arr);
    if (count > 32) count = 32;
    cfg->assignment_count = 0;
    
    for (int i = 0; i < count; i++) {
        cJSON *item = cJSON_GetArrayItem(assign_arr, i);
        if (!item) continue;
        
        cfg_assignment_t *a = &cfg->assignments[cfg->assignment_count];
        memset(a, 0, sizeof(cfg_assignment_t));
        
        cJSON *aid = cJSON_GetObjectItem(item, "assignmentId");
        if (aid && cJSON_IsString(aid)) strncpy(a->assignment_id, aid->valuestring, sizeof(a->assignment_id) - 1);
        
        cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
        if (rid && cJSON_IsString(rid)) strncpy(a->resource_id, rid->valuestring, sizeof(a->resource_id) - 1);
        
        cJSON *scp = cJSON_GetObjectItem(item, "scope");
        if (scp && cJSON_IsString(scp)) {
            if (strcmp(scp->valuestring, "GREENHOUSE") == 0) a->scope = CFG_SCOPE_GREENHOUSE;
            else a->scope = CFG_SCOPE_COMPLEX;
        }
        
        cJSON *ghid = cJSON_GetObjectItem(item, "ghId");
        if (ghid && cJSON_IsString(ghid)) strncpy(a->gh_id, ghid->valuestring, sizeof(a->gh_id) - 1);
        
        cfg->assignment_count++;
    }
}

static void parse_topology(cJSON *topo_arr, active_configuration_t *cfg) {
    if (!topo_arr || !cJSON_IsArray(topo_arr)) return;
    int count = cJSON_GetArraySize(topo_arr);
    if (count > 32) count = 32;
    cfg->topology_count = 0;
    
    for (int i = 0; i < count; i++) {
        cJSON *item = cJSON_GetArrayItem(topo_arr, i);
        if (!item) continue;
        
        cfg_topology_edge_t *t = &cfg->topology[cfg->topology_count];
        memset(t, 0, sizeof(cfg_topology_edge_t));
        
        cJSON *src = cJSON_GetObjectItem(item, "sourceResourceId");
        if (src && cJSON_IsString(src)) strncpy(t->source_resource_id, src->valuestring, sizeof(t->source_resource_id) - 1);
        
        cJSON *tgt = cJSON_GetObjectItem(item, "targetResourceId");
        if (tgt && cJSON_IsString(tgt)) strncpy(t->target_resource_id, tgt->valuestring, sizeof(t->target_resource_id) - 1);
        
        cJSON *conn = cJSON_GetObjectItem(item, "connectionType");
        if (conn && cJSON_IsString(conn)) strncpy(t->connection_type, conn->valuestring, sizeof(t->connection_type) - 1);
        
        cfg->topology_count++;
    }
}

static esp_err_t validate_candidate_semantics(void) {
    // M3.3, M3.4, M3.5, M3.6 validations
    for (size_t i = 0; i < s_candidate_config.schedule_count; i++) {
        compiled_schedule_t *s = &s_candidate_config.schedules[i];
        if (s->configuration_version != s_candidate_config.version) {
            ESP_LOGE(TAG, "Schedule %s compiled for version %lu but active is %lu (REJECT / STALE)", 
                     s->schedule_id, 
                     (unsigned long)s->configuration_version, 
                     (unsigned long)s_candidate_config.version);
            return ESP_ERR_INVALID_VERSION;
        }
        if (s->status == SCHED_STATUS_INVALID) {
            ESP_LOGE(TAG, "Schedule %s has INVALID status", s->schedule_id);
            return ESP_ERR_INVALID_STATE;
        }
    }
    
    // Validate assignments exist in hardware_registry (M3.3 / M3.6 strict checks)
    // M6 Resource Assignment / Ownership: An installed resource cannot silently have two exclusive owners.
    for (size_t i = 0; i < s_candidate_config.assignment_count; i++) {
        hw_component_info_t hw;
        if (hardware_registry_find_by_id(s_candidate_config.assignments[i].resource_id, &hw) != ESP_OK) {
            ESP_LOGE(TAG, "Validation failed: Assignment refers to unknown hardware '%s'", s_candidate_config.assignments[i].resource_id);
            return ESP_ERR_NOT_FOUND; // Strict rejection per M3 PRD
        }
        
        for (size_t j = i + 1; j < s_candidate_config.assignment_count; j++) {
            if (strcmp(s_candidate_config.assignments[i].resource_id, s_candidate_config.assignments[j].resource_id) == 0) {
                ESP_LOGE(TAG, "Validation failed: Resource '%s' assigned multiple times (M6 conflict)", s_candidate_config.assignments[i].resource_id);
                return ESP_ERR_INVALID_STATE;
            }
        }
    }
    // Validate topology edges (M7 Topology / Capability)
    esp_err_t err = topology_mgr_validate_candidate(&s_candidate_config);
    if (err != ESP_OK) {
        return err;
    }

    return ESP_OK;
}

esp_err_t configuration_mgr_parse_candidate(const char *json_str)
{
    if (!json_str) return ESP_ERR_INVALID_ARG;
    
    cJSON *root = cJSON_Parse(json_str);
    if (!root) {
        ESP_LOGE(TAG, "Failed to parse candidate JSON");
        return ESP_ERR_INVALID_ARG;
    }
    
    // In some contexts, the payload might be nested under "configuration", or it could be root.
    cJSON *cfg = cJSON_GetObjectItem(root, "configuration");
    if (!cfg) cfg = root; 
    
    memset(&s_candidate_config, 0, sizeof(active_configuration_t));
    
    cJSON *cid = cJSON_GetObjectItem(cfg, "complexId");
    if (cid && cJSON_IsString(cid)) {
        strncpy(s_candidate_config.complex_id, cid->valuestring, sizeof(s_candidate_config.complex_id) - 1);
    }
    
    cJSON *ver = cJSON_GetObjectItem(cfg, "version");
    if (ver && cJSON_IsNumber(ver)) {
        s_candidate_config.version = ver->valueint;
    }
    
    cJSON *upd = cJSON_GetObjectItem(cfg, "updatedAt");
    if (upd && cJSON_IsString(upd)) {
        strncpy(s_candidate_config.updated_at, upd->valuestring, sizeof(s_candidate_config.updated_at) - 1);
    }
    
    parse_greenhouses(cJSON_GetObjectItem(cfg, "greenhouses"), &s_candidate_config);
    parse_recipes(cJSON_GetObjectItem(cfg, "recipes"), &s_candidate_config);
    esp_err_t sched_err = parse_compiled_schedules(cJSON_GetObjectItem(cfg, "compiledSchedules"), &s_candidate_config);
    if (sched_err != ESP_OK) {
        cJSON_Delete(root);
        ESP_LOGE(TAG, "Candidate compiled schedules parse failed (size or format error)");
        return sched_err;
    }
    parse_assignments(cJSON_GetObjectItem(cfg, "assignments"), &s_candidate_config);
    parse_topology(cJSON_GetObjectItem(cfg, "topology"), &s_candidate_config);
    
    cJSON_Delete(root);
    
    if (validate_candidate_semantics() != ESP_OK) {
        ESP_LOGE(TAG, "Candidate semantic validation failed");
        return ESP_ERR_INVALID_ARG;
    }
    
    s_candidate_valid = true;
    ESP_LOGI(TAG, "Candidate configuration parsed and validated (v%lu). Recipes: %u, Schedules: %u, Assignments: %u, Topology: %u",
             (unsigned long)s_candidate_config.version,
             s_candidate_config.recipe_count,
             s_candidate_config.schedule_count,
             s_candidate_config.assignment_count,
             s_candidate_config.topology_count);
             
    return ESP_OK;
}

esp_err_t configuration_mgr_apply_candidate(void)
{
    if (!s_candidate_valid) return ESP_ERR_INVALID_STATE;
    
    s_active_config = s_candidate_config;
    s_candidate_valid = false;
    
    // M8 Schedule Compiler Deployment
    scheduler_clear_all();
    for (size_t i = 0; i < s_active_config.schedule_count; i++) {
        compiled_schedule_t *c_sched = &s_active_config.schedules[i];
        
        // Promote VALIDATING / ACTIVE schedules to ACTIVE in runtime scheduler
        if (c_sched->status != SCHED_STATUS_ACTIVE && c_sched->status != SCHED_STATUS_VALIDATING) continue;
        c_sched->status = SCHED_STATUS_ACTIVE;
        
        schedule_entry_t entry = {0};
        strncpy(entry.id, c_sched->schedule_id, sizeof(entry.id) - 1);
        strncpy(entry.target_gh_id, c_sched->target_gh_id, sizeof(entry.target_gh_id) - 1);
        strncpy(entry.resolved_action, c_sched->resolved_action, sizeof(entry.resolved_action) - 1);
        strncpy(entry.recipe_id, c_sched->recipe_id, sizeof(entry.recipe_id) - 1);
        entry.recipe_version = c_sched->recipe_version;
        entry.enabled = true;
        
        entry.resolved_resource_count = c_sched->resolved_resource_count;
        if (entry.resolved_resource_count > MAX_SCHED_RESOLVED_RESOURCES) {
            entry.resolved_resource_count = MAX_SCHED_RESOLVED_RESOURCES;
        }
        for (size_t j = 0; j < entry.resolved_resource_count; j++) {
            strncpy(entry.resolved_resources[j], c_sched->resolved_resources[j], 31);
        }
        
        entry.safety_dependencies = c_sched->safety_dependencies;
        entry.configuration_version = c_sched->configuration_version;
        entry.priority = c_sched->priority;
        
        entry.hour = c_sched->hour;
        entry.minute = c_sched->minute;
        entry.days_of_week = c_sched->days_of_week;
        entry.interval_min = c_sched->interval_min;
        entry.duration_sec = c_sched->duration_sec;
        
        scheduler_add_entry(&entry);
    }
    
    ESP_LOGI(TAG, "Candidate configuration applied as ACTIVE. Compiled schedules deployed.");
    return ESP_OK;
}

esp_err_t configuration_mgr_load_active(void)
{
    char *buf = (char *)malloc(8192);
    if (!buf) return ESP_ERR_NO_MEM;
    
    size_t len = 0;
    esp_err_t err = storage_mgr_load_config(buf, 8192, &len);
    if (err == ESP_OK) {
        err = configuration_mgr_parse_candidate(buf);
        if (err == ESP_OK) {
            err = configuration_mgr_apply_candidate();
        }
    } else {
        ESP_LOGW(TAG, "No persistent configuration found or CRC failed. Active config remains empty.");
        configuration_mgr_clear_active();
        err = ESP_OK; // It's okay to start empty.
    }
    
    free(buf);
    return err;
}

esp_err_t configuration_mgr_clear_active(void)
{
    memset(&s_active_config, 0, sizeof(active_configuration_t));
    return ESP_OK;
}

const active_configuration_t *configuration_mgr_get_active(void)
{
    return &s_active_config;
}
