#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include "services/configuration_mgr.h"
#include "cJSON.h"
#include <string.h>

static bool validate_config_payload(cJSON *body, cJSON *errors)
{
    bool valid = true;
    cJSON *cfg = cJSON_GetObjectItem(body, "configuration");
    if (!cfg || !cJSON_IsObject(cfg)) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("Missing 'configuration' object"));
        return false;
    }

    cJSON *complexId = cJSON_GetObjectItem(cfg, "complexId");
    if (!complexId || !cJSON_IsString(complexId) || strlen(complexId->valuestring) == 0) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("Missing or empty 'complexId'"));
        valid = false;
    }

    cJSON *tz = cJSON_GetObjectItem(cfg, "timezone");
    if (tz && cJSON_IsString(tz)) {
        if (strlen(tz->valuestring) > 64) {
            cJSON_AddItemToArray(errors, cJSON_CreateString("timezone string too long"));
            valid = false;
        }
    }

    cJSON *schedules = cJSON_GetObjectItem(cfg, "schedules");
    if (schedules && cJSON_IsArray(schedules)) {
        int arr_size = cJSON_GetArraySize(schedules);
        if (arr_size > 16) {
            cJSON_AddItemToArray(errors, cJSON_CreateString("Too many schedules (max 16)"));
            valid = false;
        }
        for (int i = 0; i < arr_size; i++) {
            cJSON *item = cJSON_GetArrayItem(schedules, i);
            cJSON *sid = cJSON_GetObjectItem(item, "scheduleId");
            if (!sid || !cJSON_IsString(sid) || strlen(sid->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule missing 'scheduleId'"));
                valid = false;
            }
            cJSON *ownerId = cJSON_GetObjectItem(item, "ownerId");
            if (!ownerId || !cJSON_IsString(ownerId) || strlen(ownerId->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule missing 'ownerId'"));
                valid = false;
            }
            cJSON *prio = cJSON_GetObjectItem(item, "priority");
            if (!prio || !cJSON_IsNumber(prio)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule missing 'priority'"));
                valid = false;
            }
            cJSON *type = cJSON_GetObjectItem(item, "type");
            if (!type || !cJSON_IsString(type)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule missing 'type'"));
                valid = false;
            }
            cJSON *action = cJSON_GetObjectItem(item, "action");
            if (!action || !cJSON_IsString(action)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule missing 'action'"));
                valid = false;
            }
            cJSON *duration = cJSON_GetObjectItem(item, "durationSec");
            if (duration && cJSON_IsNumber(duration)) {
                if (duration->valuedouble < 0 || duration->valuedouble > 86400) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule duration out of bounds [0, 86400]"));
                    valid = false;
                }
            }
        }
    }

    cJSON *recipes = cJSON_GetObjectItem(cfg, "recipes");
    if (recipes && cJSON_IsArray(recipes)) {
        int arr_size = cJSON_GetArraySize(recipes);
        for (int i = 0; i < arr_size; i++) {
            cJSON *item = cJSON_GetArrayItem(recipes, i);
            cJSON *rid = cJSON_GetObjectItem(item, "recipeId");
            if (!rid || !cJSON_IsString(rid) || strlen(rid->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Recipe missing 'recipeId'"));
                valid = false;
            }
            cJSON *name = cJSON_GetObjectItem(item, "name");
            if (!name || !cJSON_IsString(name) || strlen(name->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Recipe missing 'name'"));
                valid = false;
            }
            cJSON *type = cJSON_GetObjectItem(item, "type");
            if (!type || !cJSON_IsString(type)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Recipe missing 'type'"));
                valid = false;
            }
        }
    }

    cJSON *assignments = cJSON_GetObjectItem(cfg, "assignments");
    if (assignments && cJSON_IsArray(assignments)) {
        int arr_size = cJSON_GetArraySize(assignments);
        for (int i = 0; i < arr_size; i++) {
            cJSON *item = cJSON_GetArrayItem(assignments, i);
            cJSON *aid = cJSON_GetObjectItem(item, "assignmentId");
            if (!aid || !cJSON_IsString(aid) || strlen(aid->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Assignment missing 'assignmentId'"));
                valid = false;
            }
            cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
            if (!rid || !cJSON_IsString(rid) || strlen(rid->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Assignment missing 'resourceId'"));
                valid = false;
            }
            cJSON *scope = cJSON_GetObjectItem(item, "scope");
            if (!scope || !cJSON_IsString(scope)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Assignment missing 'scope'"));
                valid = false;
            }
        }
    }

    cJSON *topology = cJSON_GetObjectItem(cfg, "topology");
    if (topology && cJSON_IsArray(topology)) {
        int arr_size = cJSON_GetArraySize(topology);
        for (int i = 0; i < arr_size; i++) {
            cJSON *item = cJSON_GetArrayItem(topology, i);
            cJSON *src = cJSON_GetObjectItem(item, "sourceResourceId");
            if (!src || !cJSON_IsString(src) || strlen(src->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Topology missing 'sourceResourceId'"));
                valid = false;
            }
            cJSON *tgt = cJSON_GetObjectItem(item, "targetResourceId");
            if (!tgt || !cJSON_IsString(tgt) || strlen(tgt->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Topology missing 'targetResourceId'"));
                valid = false;
            }
            cJSON *conn = cJSON_GetObjectItem(item, "connectionType");
            if (!conn || !cJSON_IsString(conn)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Topology missing 'connectionType'"));
                valid = false;
            }
        }
    }

    /* M2.17 - M2.19: Component Registry Validation */
    cJSON *components = cJSON_GetObjectItem(cfg, "components");
    if (!components) {
        components = cJSON_GetObjectItem(body, "components");
    }
    if (components && cJSON_IsArray(components)) {
        int comp_count = cJSON_GetArraySize(components);
        if (comp_count > 32) {
            cJSON_AddItemToArray(errors, cJSON_CreateString("Too many components (max 32)"));
            valid = false;
        }
        for (int i = 0; i < comp_count; i++) {
            cJSON *c = cJSON_GetArrayItem(components, i);
            if (!c || !cJSON_IsObject(c)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component item must be an object"));
                valid = false;
                continue;
            }

            /* M2.17: Validate stable component ID */
            cJSON *cid = cJSON_GetObjectItem(c, "componentId");
            if (!cid) cid = cJSON_GetObjectItem(c, "id");
            if (!cid || !cJSON_IsString(cid) || strlen(cid->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component missing valid 'componentId'"));
                valid = false;
            } else {
                if (strlen(cid->valuestring) > 32) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Component ID exceeds maximum length 32"));
                    valid = false;
                }
                /* Check uniqueness (stable ID collision detection) */
                for (int j = 0; j < i; j++) {
                    cJSON *prev = cJSON_GetArrayItem(components, j);
                    if (prev && cJSON_IsObject(prev)) {
                        cJSON *prev_id = cJSON_GetObjectItem(prev, "componentId");
                        if (!prev_id) prev_id = cJSON_GetObjectItem(prev, "id");
                        if (prev_id && cJSON_IsString(prev_id) && strcmp(prev_id->valuestring, cid->valuestring) == 0) {
                            cJSON_AddItemToArray(errors, cJSON_CreateString("Duplicate componentId found in configuration"));
                            valid = false;
                            break;
                        }
                    }
                }
            }

            /* M2.18: Validate installation metadata */
            cJSON *stype = cJSON_GetObjectItem(c, "supportedTypeId");
            if (!stype) stype = cJSON_GetObjectItem(c, "type");
            if (!stype || !cJSON_IsString(stype) || strlen(stype->valuestring) == 0) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component missing valid 'supportedTypeId'"));
                valid = false;
            }

            cJSON *life = cJSON_GetObjectItem(c, "lifecycleState");
            if (life && cJSON_IsString(life)) {
                const char *ls = life->valuestring;
                if (strcmp(ls, "REGISTERED") != 0 &&
                    strcmp(ls, "NOT_COMMISSIONED") != 0 &&
                    strcmp(ls, "COMMISSIONED") != 0 &&
                    strcmp(ls, "ENABLED") != 0 &&
                    strcmp(ls, "DISABLED") != 0 &&
                    strcmp(ls, "FAULTED") != 0 &&
                    strcmp(ls, "REMOVED") != 0) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Invalid component lifecycleState"));
                    valid = false;
                }
            }

            cJSON *dep = cJSON_GetObjectItem(c, "deploymentStatus");
            if (dep && cJSON_IsString(dep)) {
                const char *ds = dep->valuestring;
                if (strcmp(ds, "PENDING") != 0 &&
                    strcmp(ds, "APPLIED") != 0 &&
                    strcmp(ds, "FAILED") != 0 &&
                    strcmp(ds, "UNKNOWN") != 0) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Invalid component deploymentStatus"));
                    valid = false;
                }
            }

            cJSON *wiring = cJSON_GetObjectItem(c, "wiring");
            if (wiring && cJSON_IsObject(wiring)) {
                cJSON *iface = cJSON_GetObjectItem(wiring, "interface");
                if (iface && cJSON_IsString(iface)) {
                    const char *is = iface->valuestring;
                    if (strcmp(is, "GPIO") != 0 &&
                        strcmp(is, "I2C") != 0 &&
                        strcmp(is, "UART") != 0 &&
                        strcmp(is, "SPI") != 0 &&
                        strcmp(is, "ONE_WIRE") != 0 &&
                        strcmp(is, "ANALOG") != 0 &&
                        strcmp(is, "VIRTUAL") != 0) {
                        cJSON_AddItemToArray(errors, cJSON_CreateString("Invalid wiring interface"));
                        valid = false;
                    }
                    if (strcmp(is, "GPIO") == 0) {
                        cJSON *gpio = cJSON_GetObjectItem(wiring, "gpio");
                        if (gpio && cJSON_IsNumber(gpio)) {
                            if (gpio->valueint < 0 || gpio->valueint > 48) {
                                cJSON_AddItemToArray(errors, cJSON_CreateString("Wiring GPIO pin out of range [0, 48]"));
                                valid = false;
                            }
                        }
                    }
                }
            }

            /* M2.19: Validate assignment metadata */
            cJSON *asgn = cJSON_GetObjectItem(c, "assignment");
            if (asgn && cJSON_IsObject(asgn)) {
                cJSON *cplx = cJSON_GetObjectItem(asgn, "complexId");
                if (!cplx || !cJSON_IsString(cplx) || strlen(cplx->valuestring) == 0) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Component assignment missing valid 'complexId'"));
                    valid = false;
                }
            }
        }
    }
    
    return valid;
}


esp_err_t handler_get_configuration(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "version", st->config_version);

    char hash_str[16];
    snprintf(hash_str, sizeof(hash_str), "%08lx", (unsigned long)st->config_crc);
    cJSON_AddStringToObject(root, "hash", hash_str);

    /* Try to load stored JSON configuration or provide default baseline */
    char *buf = (char *)malloc(4096);
    size_t len = 0;
    if (buf) {
        if (storage_mgr_load_config(buf, 4096, &len) == ESP_OK) {
            cJSON *stored = cJSON_Parse(buf);
            if (stored) {
                cJSON_AddItemToObject(root, "config", stored);
                free(buf);
                return http_send_enveloped_response(req, 200, NULL, root);
            }
        }
        free(buf);
    }

    /* Fallback default config object */
    cJSON *cfg = cJSON_AddObjectToObject(root, "config");
    cJSON_AddStringToObject(cfg, "complexId", st->complex_id);
    cJSON_AddStringToObject(cfg, "timezone", "Asia/Jakarta");
    cJSON_AddArrayToObject(cfg, "schedules");

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_put_configuration(httpd_req_t *req)
{

    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK; // Response already sent
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid configuration JSON payload", NULL);
    }

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *errors = cJSON_CreateArray();
    if (!validate_config_payload(payload, errors)) {
        cJSON_Delete(body);
        cJSON_Delete(errors);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Configuration payload failed schema or bounds validation", req_id);
    }
    cJSON_Delete(errors);

    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *expected_ver = cJSON_GetObjectItem(payload, "expectedVersion");
    if (expected_ver && cJSON_IsNumber(expected_ver)) {
        if ((uint32_t)expected_ver->valuedouble != st->config_version) {
            cJSON_Delete(body);
            return http_send_error(req, 409, "CONFLICT", "Configuration version conflict", req_id);
        }
    }

    uint32_t new_version = st->config_version + 1;
    char *json_text = cJSON_PrintUnformatted(payload);
    if (json_text) {
        if (configuration_mgr_parse_candidate(json_text) == ESP_OK) {
            configuration_mgr_apply_candidate();
            storage_mgr_save_config(json_text, new_version);
            /* M2.20 & M2.26: Synchronize active hardware registry with persisted active configuration */
            hardware_registry_load_from_json(json_text);
        } else {
            free(json_text);
            cJSON_Delete(body);
            return http_send_error(req, 422, "VALIDATION_FAILED", "Semantic validation failed", req_id);
        }
        free(json_text);
    }

    cJSON_Delete(body);

    /* Build configuration response inline to preserve mutation req_id */
    const system_storage_state_t *st2 = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "version", st2->config_version);

    char hash_str[16];
    snprintf(hash_str, sizeof(hash_str), "%08lx", (unsigned long)st2->config_crc);
    cJSON_AddStringToObject(root, "hash", hash_str);

    char *buf = (char *)malloc(4096);
    size_t len = 0;
    if (buf) {
        if (storage_mgr_load_config(buf, 4096, &len) == ESP_OK) {
            cJSON *stored = cJSON_Parse(buf);
            if (stored) {
                cJSON_AddItemToObject(root, "config", stored);
            }
        }
        free(buf);
    }
    if (!cJSON_GetObjectItem(root, "config")) {
        cJSON *cfg = cJSON_AddObjectToObject(root, "config");
        cJSON_AddStringToObject(cfg, "complexId", st2->complex_id);
        cJSON_AddStringToObject(cfg, "timezone", "Asia/Jakarta");
        cJSON_AddArrayToObject(cfg, "schedules");
    }

    return http_send_enveloped_response(req, 200, req_id, root);
}

esp_err_t handler_validate_configuration(httpd_req_t *req)
{

    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK; // Response already sent
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON *errors = cJSON_AddArrayToObject(root, "errors");
    cJSON *warnings = cJSON_AddArrayToObject(root, "warnings");

    bool valid = validate_config_payload(payload, errors);
    
    if (valid) {
        char *json_text = cJSON_PrintUnformatted(payload);
        if (json_text) {
            if (configuration_mgr_parse_candidate(json_text) != ESP_OK) {
                valid = false;
                cJSON_AddItemToArray(errors, cJSON_CreateString("Semantic struct parsing failed"));
            }
            free(json_text);
        } else {
            valid = false;
            cJSON_AddItemToArray(errors, cJSON_CreateString("Internal memory error formatting JSON"));
        }
    }
    
    cJSON_AddBoolToObject(root, "valid", valid);

    cJSON_Delete(body);
    return http_send_enveloped_response(req, 200, req_id, root);
}
