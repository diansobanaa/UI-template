#include "services/configuration_mgr.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include "cJSON.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "CONFIG_MGR";

static active_configuration_t s_active_config = {0};
static active_configuration_t s_candidate_config = {0};
static bool s_candidate_valid = false;

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

static void parse_schedules(cJSON *sched_arr, active_configuration_t *cfg) {
    if (!sched_arr || !cJSON_IsArray(sched_arr)) return;
    int count = cJSON_GetArraySize(sched_arr);
    if (count > 16) count = 16;
    cfg->schedule_count = 0;
    
    for (int i = 0; i < count; i++) {
        cJSON *item = cJSON_GetArrayItem(sched_arr, i);
        if (!item) continue;
        
        cfg_schedule_t *s = &cfg->schedules[cfg->schedule_count];
        memset(s, 0, sizeof(cfg_schedule_t));
        
        cJSON *sid = cJSON_GetObjectItem(item, "scheduleId");
        if (sid && cJSON_IsString(sid)) strncpy(s->schedule_id, sid->valuestring, sizeof(s->schedule_id) - 1);
        
        cJSON *oid = cJSON_GetObjectItem(item, "ownerId");
        if (oid && cJSON_IsString(oid)) strncpy(s->owner_id, oid->valuestring, sizeof(s->owner_id) - 1);
        
        cJSON *prio = cJSON_GetObjectItem(item, "priority");
        if (prio && cJSON_IsNumber(prio)) s->priority = prio->valueint;
        
        cJSON *type = cJSON_GetObjectItem(item, "type");
        if (type && cJSON_IsString(type)) {
            if (strcmp(type->valuestring, "DAILY") == 0) s->type = CFG_SCHED_TYPE_DAILY;
            else if (strcmp(type->valuestring, "INTERVAL") == 0) s->type = CFG_SCHED_TYPE_INTERVAL;
            else if (strcmp(type->valuestring, "ONCE") == 0) s->type = CFG_SCHED_TYPE_ONCE;
        }
        
        cJSON *act = cJSON_GetObjectItem(item, "action");
        if (act && cJSON_IsString(act)) {
            if (strcmp(act->valuestring, "FERTIGATION") == 0) s->action = CFG_SCHED_ACTION_FERTIGATION;
            else if (strcmp(act->valuestring, "WATER_PUMP") == 0) s->action = CFG_SCHED_ACTION_WATER_PUMP;
            else if (strcmp(act->valuestring, "FAN_TOGGLE") == 0) s->action = CFG_SCHED_ACTION_FAN_TOGGLE;
            else if (strcmp(act->valuestring, "CUSTOM") == 0) s->action = CFG_SCHED_ACTION_CUSTOM;
        }
        
        cJSON *rid = cJSON_GetObjectItem(item, "recipeId");
        if (rid && cJSON_IsString(rid)) strncpy(s->recipe_id, rid->valuestring, sizeof(s->recipe_id) - 1);
        
        cJSON *en = cJSON_GetObjectItem(item, "enabled");
        if (en && cJSON_IsBool(en)) s->enabled = cJSON_IsTrue(en);
        
        cJSON *hr = cJSON_GetObjectItem(item, "hour");
        if (hr && cJSON_IsNumber(hr)) s->hour = hr->valueint;
        
        cJSON *min = cJSON_GetObjectItem(item, "minute");
        if (min && cJSON_IsNumber(min)) s->minute = min->valueint;
        
        cJSON *dow = cJSON_GetObjectItem(item, "daysOfWeek");
        if (dow && cJSON_IsNumber(dow)) s->days_of_week = dow->valueint;
        
        cJSON *intm = cJSON_GetObjectItem(item, "intervalMin");
        if (intm && cJSON_IsNumber(intm)) s->interval_min = intm->valueint;
        
        cJSON *dur = cJSON_GetObjectItem(item, "durationSec");
        if (dur && cJSON_IsNumber(dur)) s->duration_sec = dur->valueint;
        
        cfg->schedule_count++;
    }
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
        cfg_schedule_t *s = &s_candidate_config.schedules[i];
        if (s->recipe_id[0] != '\0') {
            bool found = false;
            for (size_t j = 0; j < s_candidate_config.recipe_count; j++) {
                if (strcmp(s->recipe_id, s_candidate_config.recipes[j].recipe_id) == 0) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                ESP_LOGE(TAG, "Schedule %s refers to unknown recipe %s", s->schedule_id, s->recipe_id);
                return ESP_ERR_NOT_FOUND;
            }
        }
    }
    
    // Validate assignments exist in hardware_registry (M3.3 / M3.6 strict checks)
    for (size_t i = 0; i < s_candidate_config.assignment_count; i++) {
        hw_component_info_t hw;
        if (hardware_registry_find_by_id(s_candidate_config.assignments[i].resource_id, &hw) != ESP_OK) {
            ESP_LOGE(TAG, "Validation failed: Assignment refers to unknown hardware '%s'", s_candidate_config.assignments[i].resource_id);
            return ESP_ERR_NOT_FOUND; // Strict rejection per M3 PRD
        }
    }
    
    // Validate topology edges
    for (size_t i = 0; i < s_candidate_config.topology_count; i++) {
        cfg_topology_edge_t *e = &s_candidate_config.topology[i];
        if (strcmp(e->source_resource_id, e->target_resource_id) == 0) {
            ESP_LOGE(TAG, "Validation failed: Topology edge creates self-loop on '%s'", e->source_resource_id);
            return ESP_ERR_INVALID_ARG;
        }
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
    
    parse_recipes(cJSON_GetObjectItem(cfg, "recipes"), &s_candidate_config);
    parse_schedules(cJSON_GetObjectItem(cfg, "schedules"), &s_candidate_config);
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
    
    ESP_LOGI(TAG, "Candidate configuration applied as ACTIVE.");
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
