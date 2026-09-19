#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include "hal/sensor_hal.h"
#include "cJSON.h"
#include "services/event_mgr.h"
#include <string.h>

static cJSON *extract_configuration(cJSON *payload)
{
    if (!payload || !cJSON_IsObject(payload)) return NULL;
    cJSON *cfg = cJSON_GetObjectItem(payload, "configuration");
    if (cfg && cJSON_IsObject(cfg)) return cfg;
    return payload;
}

static bool is_positive_identifier(const cJSON *item, size_t max_len)
{
    if (!item || !cJSON_IsString(item) || !item->valuestring) return false;
    size_t len = strlen(item->valuestring);
    if (len == 0 || len >= max_len) return false;
    for (size_t i = 0; i < len; ++i) {
        if (item->valuestring[i] == '\r' || item->valuestring[i] == '\n' || item->valuestring[i] == '\t') return false;
    }
    return true;
}

static bool validate_config_payload(cJSON *payload, cJSON *errors)
{
    bool valid = true;
    cJSON *cfg = extract_configuration(payload);
    const system_storage_state_t *st = storage_mgr_get_state();
    if (!cfg) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("Missing configuration object"));
        return false;
    }

    cJSON *version = cJSON_GetObjectItem(cfg, "version");
    if (!version || !cJSON_IsNumber(version) || version->valuedouble < 0.0 || version->valuedouble != (double)version->valueint) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("Configuration version must be a non-negative integer"));
        valid = false;
    }
    cJSON *updated_at = cJSON_GetObjectItem(cfg, "updatedAt");
    if (!updated_at || !cJSON_IsString(updated_at) || strlen(updated_at->valuestring) == 0) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("Configuration missing valid 'updatedAt'"));
        valid = false;
    }
    cJSON *complex_id = cJSON_GetObjectItem(cfg, "complexId");
    if (!is_positive_identifier(complex_id, 32)) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("Configuration missing valid 'complexId'"));
        valid = false;
    } else if (st && st->complex_id[0] != '\0' && strcmp(complex_id->valuestring, st->complex_id) != 0) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("Configuration complexId does not match this ESP32's assigned Complex"));
        valid = false;
    }

    const char *required_arrays[] = {"components", "assignments", "schedules", "recipes", "topology"};
    for (size_t i = 0; i < sizeof(required_arrays) / sizeof(required_arrays[0]); ++i) {
        cJSON *arr = cJSON_GetObjectItem(cfg, required_arrays[i]);
        if (!arr || !cJSON_IsArray(arr)) {
            char msg[96];
            snprintf(msg, sizeof(msg), "Configuration missing required '%s' array", required_arrays[i]);
            cJSON_AddItemToArray(errors, cJSON_CreateString(msg));
            valid = false;
        }
    }

    cJSON *settings = cJSON_GetObjectItem(cfg, "settings");
    if (settings && !cJSON_IsObject(settings)) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("Configuration 'settings' must be an object when provided"));
        valid = false;
    }

    cJSON *tz = cJSON_GetObjectItem(cfg, "timezone");
    if (tz && (!cJSON_IsString(tz) || strlen(tz->valuestring) > 64)) {
        cJSON_AddItemToArray(errors, cJSON_CreateString("timezone must be a string no longer than 64 characters"));
        valid = false;
    }

    cJSON *schedules = cJSON_GetObjectItem(cfg, "schedules");
    if (schedules && cJSON_IsArray(schedules)) {
        int arr_size = cJSON_GetArraySize(schedules);
        if (arr_size > 16) {
            cJSON_AddItemToArray(errors, cJSON_CreateString("Too many schedules (max 16)"));
            valid = false;
        }
        for (int i = 0; i < arr_size; ++i) {
            cJSON *item = cJSON_GetArrayItem(schedules, i);
            if (!item || !cJSON_IsObject(item)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule item must be an object"));
                valid = false;
                continue;
            }
            cJSON *sid = cJSON_GetObjectItem(item, "scheduleId");
            cJSON *owner = cJSON_GetObjectItem(item, "ownerId");
            cJSON *priority = cJSON_GetObjectItem(item, "priority");
            cJSON *type = cJSON_GetObjectItem(item, "type");
            cJSON *action = cJSON_GetObjectItem(item, "action");
            if (!is_positive_identifier(sid, 40) || !is_positive_identifier(owner, 40) ||
                !priority || !cJSON_IsNumber(priority) || priority->valuedouble != (double)priority->valueint ||
                !type || !cJSON_IsString(type) || !action || !cJSON_IsString(action)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule missing required canonical fields"));
                valid = false;
            }
            cJSON *duration = cJSON_GetObjectItem(item, "durationSec");
            if (duration && cJSON_IsNumber(duration) && (duration->valuedouble < 0 || duration->valuedouble > 86400)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Schedule duration out of bounds [0, 86400]"));
                valid = false;
            }
        }
    }

    cJSON *components = cJSON_GetObjectItem(cfg, "components");
    if (components && cJSON_IsArray(components)) {
        int comp_count = cJSON_GetArraySize(components);
        if (comp_count > 32) {
            cJSON_AddItemToArray(errors, cJSON_CreateString("Too many components (max 32)"));
            valid = false;
        }
        for (int i = 0; i < comp_count; ++i) {
            cJSON *c = cJSON_GetArrayItem(components, i);
            if (!c || !cJSON_IsObject(c)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component item must be an object"));
                valid = false;
                continue;
            }
            cJSON *cid = cJSON_GetObjectItem(c, "componentId");
            cJSON *stype = cJSON_GetObjectItem(c, "supportedTypeId");
            cJSON *name = cJSON_GetObjectItem(c, "name");
            cJSON *life = cJSON_GetObjectItem(c, "lifecycleState");
            cJSON *dep = cJSON_GetObjectItem(c, "deploymentStatus");
            cJSON *params = cJSON_GetObjectItem(c, "parameters");

            if (!is_positive_identifier(cid, 32)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component missing valid canonical 'componentId'"));
                valid = false;
            }
            if (!is_positive_identifier(stype, 32)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component missing valid canonical 'supportedTypeId'"));
                valid = false;
            }
            if (!is_positive_identifier(name, 48)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component missing valid canonical 'name'"));
                valid = false;
            }
            if (!life || !cJSON_IsString(life) ||
                (strcmp(life->valuestring, "REGISTERED") != 0 && strcmp(life->valuestring, "NOT_COMMISSIONED") != 0 &&
                 strcmp(life->valuestring, "COMMISSIONED") != 0 && strcmp(life->valuestring, "ENABLED") != 0 &&
                 strcmp(life->valuestring, "DISABLED") != 0 && strcmp(life->valuestring, "FAULTED") != 0 &&
                 strcmp(life->valuestring, "REMOVED") != 0)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component lifecycleState is required and must be canonical"));
                valid = false;
            }
            if (!dep || !cJSON_IsString(dep) ||
                (strcmp(dep->valuestring, "PENDING") != 0 && strcmp(dep->valuestring, "APPLIED") != 0 &&
                 strcmp(dep->valuestring, "FAILED") != 0 && strcmp(dep->valuestring, "UNKNOWN") != 0)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component deploymentStatus is required and must be canonical"));
                valid = false;
            }
            if (!params || !cJSON_IsObject(params)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component parameters must be an object"));
                valid = false;
            }

            for (int j = 0; j < i; ++j) {
                cJSON *prev = cJSON_GetArrayItem(components, j);
                cJSON *prev_id = prev && cJSON_IsObject(prev) ? cJSON_GetObjectItem(prev, "componentId") : NULL;
                if (cid && prev_id && cJSON_IsString(cid) && cJSON_IsString(prev_id) && strcmp(cid->valuestring, prev_id->valuestring) == 0) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Duplicate componentId found in configuration"));
                    valid = false;
                    break;
                }
            }

            cJSON *role = cJSON_GetObjectItem(c, "role");
            if (role && (!cJSON_IsString(role) || strlen(role->valuestring) >= 32)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component role is invalid"));
                valid = false;
            }
            cJSON *resource_id = cJSON_GetObjectItem(c, "resourceId");
            if (resource_id && (!cJSON_IsString(resource_id) || strlen(resource_id->valuestring) >= 32)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Component resourceId is invalid"));
                valid = false;
            }

            cJSON *asgn = cJSON_GetObjectItem(c, "assignment");
            if (asgn) {
                cJSON *cplx = cJSON_GetObjectItem(asgn, "complexId");
                if (!cJSON_IsObject(asgn) || !is_positive_identifier(cplx, 32)) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Component assignment must contain a valid complexId"));
                    valid = false;
                } else if (st && st->complex_id[0] != '\0' && strcmp(cplx->valuestring, st->complex_id) != 0) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Component assignment complexId does not belong to this ESP32"));
                    valid = false;
                }
                cJSON *gh = cJSON_GetObjectItem(asgn, "ghId");
                if (gh && !cJSON_IsString(gh)) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Component assignment ghId must be a string when provided"));
                    valid = false;
                }
            }

            char wiring_reason[160] = {0};
            if (hardware_registry_validate_component_json(c, wiring_reason, sizeof(wiring_reason)) != ESP_OK) {
                cJSON_AddItemToArray(errors, cJSON_CreateString(wiring_reason[0] ? wiring_reason : "Component wiring violates canonical hardware pin contract"));
                valid = false;
            }

            cJSON *wiring = cJSON_GetObjectItem(c, "wiring");
            if (wiring) {
                cJSON *iface = cJSON_GetObjectItem(wiring, "interface");
                if (!cJSON_IsObject(wiring) || !iface || !cJSON_IsString(iface)) {
                    cJSON_AddItemToArray(errors, cJSON_CreateString("Component wiring must contain a valid interface"));
                    valid = false;
                } else {
                    const char *is = iface->valuestring;
                    if (strcmp(is, "GPIO") != 0 && strcmp(is, "I2C") != 0 && strcmp(is, "UART") != 0 &&
                        strcmp(is, "SPI") != 0 && strcmp(is, "ONE_WIRE") != 0 && strcmp(is, "ANALOG") != 0 && strcmp(is, "VIRTUAL") != 0) {
                        cJSON_AddItemToArray(errors, cJSON_CreateString("Invalid wiring interface"));
                        valid = false;
                    }
                    if (strcmp(is, "GPIO") == 0) {
                        cJSON *gpio = cJSON_GetObjectItem(wiring, "gpio");
                        if (!gpio || !cJSON_IsNumber(gpio) || gpio->valuedouble != (double)gpio->valueint || gpio->valueint < 0 || gpio->valueint > 48) {
                            cJSON_AddItemToArray(errors, cJSON_CreateString("GPIO interface requires valid gpio in range [0, 48]"));
                            valid = false;
                        }
                    }
                    cJSON *pol = cJSON_GetObjectItem(wiring, "polarity");
                    if (pol && (!cJSON_IsString(pol) || (strcmp(pol->valuestring, "ACTIVE_HIGH") != 0 && strcmp(pol->valuestring, "ACTIVE_LOW") != 0))) {
                        cJSON_AddItemToArray(errors, cJSON_CreateString("Invalid wiring polarity"));
                        valid = false;
                    }
                }
            } else if (life && cJSON_IsString(life) &&
                       (strcmp(life->valuestring, "COMMISSIONED") == 0 || strcmp(life->valuestring, "ENABLED") == 0)) {
                cJSON_AddItemToArray(errors, cJSON_CreateString("Operational component requires wiring metadata"));
                valid = false;
            }
        }
    }

    return valid;
}

static cJSON *configuration_deployment_data(const cJSON *payload)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *data = cJSON_CreateObject();
    if (!data || !st) return data;
    cJSON_AddNumberToObject(data, "configurationVersion", st->config_version);
    char hash_str[16];
    snprintf(hash_str, sizeof(hash_str), "%08lx", (unsigned long)st->config_crc);
    cJSON_AddStringToObject(data, "configurationHash", hash_str);
    cJSON_AddNumberToObject(data, "inventoryVersion", st->config_version);
    cJSON_AddNumberToObject(data, "schemaVersion", 1);
    cJSON_AddStringToObject(data, "deploymentStatus", st->config_deployment_status[0] ? st->config_deployment_status : "UNKNOWN");
    if (st->active_deployment_id[0]) cJSON_AddStringToObject(data, "deploymentId", st->active_deployment_id);
    cJSON_AddNumberToObject(data, "previousConfigurationVersion", st->previous_config_version);
    cJSON_AddNumberToObject(data, "candidateConfigurationVersion", st->candidate_config_version);
    if (st->candidate_deployment_id[0]) cJSON_AddStringToObject(data, "candidateDeploymentId", st->candidate_deployment_id);
    if (payload) {
        cJSON *copy = cJSON_Duplicate((cJSON *)payload, 1);
        if (copy) cJSON_AddItemToObject(data, "payload", copy);
    }
    return data;
}

esp_err_t handler_get_configuration(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    char *buf = (char *)malloc(4096);
    size_t len = 0;
    if (!buf) return http_send_error(req, 503, "UNAVAILABLE", "Configuration storage buffer unavailable", NULL);

    esp_err_t err = storage_mgr_load_config(buf, 4096, &len);
    if (err != ESP_OK || len == 0) {
        free(buf);
        return http_send_error(req, 404, "NOT_FOUND", "No active configuration is installed", NULL);
    }

    cJSON *payload = cJSON_Parse(buf);
    free(buf);
    if (!payload) return http_send_error(req, 500, "INTERNAL_ERROR", "Persisted configuration is not valid JSON", NULL);

    cJSON *data = configuration_deployment_data(payload);
    cJSON_Delete(payload);
    if (!data) return http_send_error(req, 500, "INTERNAL_ERROR", "Unable to build configuration response", NULL);
    return http_send_enveloped_response(req, 200, NULL, data);
}

static esp_err_t deploy_configuration_json(httpd_req_t *req, cJSON *body, cJSON *cfg, const char *req_id, const char *deployment_id_override)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *expected_ver = cJSON_GetObjectItem(body, "expectedVersion");
    if (!expected_ver) expected_ver = cJSON_GetObjectItem(cfg, "expectedVersion");
    if (expected_ver && cJSON_IsNumber(expected_ver) && (uint32_t)expected_ver->valuedouble != st->config_version) {
        return http_send_error(req, 409, "CONFLICT", "Configuration version conflict", req_id);
    }

    uint32_t new_version = st->config_version + 1;
    cJSON *canonical = cJSON_Duplicate(cfg, 1);
    if (!canonical) return http_send_error(req, 503, "UNAVAILABLE", "Unable to stage configuration in memory", req_id);
    cJSON_ReplaceItemInObject(canonical, "version", cJSON_CreateNumber((double)new_version));

    char deployment_id[64] = {0};
    const char *candidate_dep = deployment_id_override;
    if (!candidate_dep || !candidate_dep[0]) {
        cJSON *did = cJSON_GetObjectItem(body, "deploymentId");
        if (did && cJSON_IsString(did)) candidate_dep = did->valuestring;
    }
    if (!candidate_dep || !candidate_dep[0]) candidate_dep = req_id && req_id[0] ? req_id : "configuration-deployment";
    strncpy(deployment_id, candidate_dep, sizeof(deployment_id)-1);

    char *json_text = cJSON_PrintUnformatted(canonical);
    if (!json_text) {
        cJSON_Delete(canonical);
        return http_send_error(req, 503, "UNAVAILABLE", "Unable to serialize configuration", req_id);
    }

    esp_err_t err = storage_mgr_stage_candidate(json_text, new_version, deployment_id);
    if (err != ESP_OK) {
        free(json_text); cJSON_Delete(canonical);
        (void)event_mgr_log_context(LOG_LEVEL_ERROR, "CONFIGURATION", "CONFIGURATION_REJECTED", "Validated configuration could not be staged.",
                                    st->complex_id, NULL, NULL, NULL, new_version);
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to stage configuration", req_id);
    }

    /* Runtime registry must validate the exact staged JSON before it can become active. */
    err = hardware_registry_load_from_json(json_text);
    if (err != ESP_OK) {
        (void)storage_mgr_mark_candidate_failed();
        free(json_text); cJSON_Delete(canonical);
        (void)event_mgr_log_context(LOG_LEVEL_ERROR, "CONFIGURATION", "CONFIGURATION_REJECTED", "Staged configuration could not be applied to the runtime registry; active configuration was preserved.",
                                    st->complex_id, NULL, NULL, NULL, new_version);
        return http_send_error(req, 422, "RUNTIME_VALIDATION_FAILED", "Configuration cannot be applied to the runtime registry; active configuration was preserved", req_id);
    }

    /* Only after runtime validation succeeds do we atomically commit the staged snapshot as active. */
    err = storage_mgr_activate_candidate();
    if (err == ESP_OK) {
        (void)sensor_hal_reconfigure_from_registry();
    }
    if (err != ESP_OK) {
        /* Restore the previous runtime registry from the old active snapshot. */
        char old_json[4096]; size_t old_len = 0;
        if (storage_mgr_load_previous_config(old_json, sizeof(old_json), &old_len) == ESP_OK) {
            /* Previous snapshot is only the safety net; active NVS remains authoritative. */
            (void)hardware_registry_load_from_json(old_json);
        }
        free(json_text); cJSON_Delete(canonical);
        (void)storage_mgr_mark_candidate_failed();
        (void)event_mgr_log_context(LOG_LEVEL_ERROR, "CONFIGURATION", "CONFIGURATION_DEPLOY_FAILED", "Configuration activation commit failed; previous active configuration remains authoritative.",
                                    st->complex_id, NULL, NULL, NULL, new_version);
        return http_send_error(req, 503, "DEPLOYMENT_FAILED", "Configuration activation failed; previous active configuration is retained", req_id);
    }

    free(json_text);
    const system_storage_state_t *st2 = storage_mgr_get_state();
    (void)event_mgr_log_context(LOG_LEVEL_INFO, "CONFIGURATION", "CONFIGURATION_DEPLOYED", "Configuration was staged, validated, and atomically activated.",
                                st2->complex_id, NULL, NULL, NULL, st2->config_version);
    cJSON *data = configuration_deployment_data(canonical);
    cJSON_Delete(canonical);
    return http_send_enveloped_response(req, 200, req_id, data);
}

esp_err_t handler_get_configuration_deployment(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    if (!st) return http_send_error(req, 503, "UNAVAILABLE", "Storage state unavailable", NULL);
    cJSON *data = cJSON_CreateObject();
    if (!data) return http_send_error(req, 503, "UNAVAILABLE", "Unable to build deployment status", NULL);
    cJSON_AddStringToObject(data, "status", st->config_deployment_status[0] ? st->config_deployment_status : "UNKNOWN");
    cJSON_AddNumberToObject(data, "activeVersion", st->config_version);
    cJSON_AddNumberToObject(data, "activeCrc", st->config_crc);
    cJSON_AddNumberToObject(data, "candidateVersion", st->candidate_config_version);
    cJSON_AddNumberToObject(data, "previousVersion", st->previous_config_version);
    if (st->active_deployment_id[0]) cJSON_AddStringToObject(data, "deploymentId", st->active_deployment_id);
    if (st->candidate_deployment_id[0]) cJSON_AddStringToObject(data, "candidateDeploymentId", st->candidate_deployment_id);
    return http_send_enveloped_response(req, 200, NULL, data);
}

esp_err_t handler_put_configuration(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid configuration JSON payload", NULL);
    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;
    cJSON *request_payload = cJSON_GetObjectItem(body, "payload");
    if (!request_payload || !cJSON_IsObject(request_payload)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }
    cJSON *cfg = extract_configuration(request_payload);
    cJSON *errors = cJSON_CreateArray();
    if (!validate_config_payload(request_payload, errors)) {
        cJSON_Delete(errors); cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Configuration payload failed schema or bounds validation", req_id);
    }
    cJSON_Delete(errors);
    esp_err_t result = deploy_configuration_json(req, request_payload, cfg, req_id, NULL);
    cJSON_Delete(body);
    return result;
}

esp_err_t handler_deploy_configuration(httpd_req_t *req)
{
    return handler_put_configuration(req);
}

esp_err_t handler_rollback_configuration(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    const system_storage_state_t *st = storage_mgr_get_state();
    if (!st || st->previous_config_version == 0) return http_send_error(req, 409, "ROLLBACK_UNAVAILABLE", "No previous active configuration is available", NULL);
    char previous[4096]; size_t previous_len = 0;
    esp_err_t err = storage_mgr_load_previous_config(previous, sizeof(previous), &previous_len);
    if (err != ESP_OK || previous_len == 0) return http_send_error(req, 409, "ROLLBACK_UNAVAILABLE", "Previous active configuration is unavailable or corrupt", NULL);
    cJSON *cfg = cJSON_Parse(previous);
    if (!cfg) return http_send_error(req, 409, "ROLLBACK_UNAVAILABLE", "Previous active configuration is not valid JSON", NULL);
    uint32_t rollback_version = st->config_version + 1;
    cJSON_ReplaceItemInObject(cfg, "version", cJSON_CreateNumber((double)rollback_version));
    cJSON *body = cJSON_CreateObject();
    cJSON_AddNumberToObject(body, "expectedVersion", st->config_version);
    char rollback_deployment_id[64];
    snprintf(rollback_deployment_id, sizeof(rollback_deployment_id), "rollback-v%lu", (unsigned long)rollback_version);
    cJSON_AddStringToObject(body, "deploymentId", rollback_deployment_id);
    cJSON *errors = cJSON_CreateArray();
    if (!validate_config_payload(cfg, errors)) {
        cJSON_Delete(errors); cJSON_Delete(cfg); cJSON_Delete(body);
        return http_send_error(req, 422, "ROLLBACK_INVALID", "Previous configuration no longer satisfies the active schema", NULL);
    }
    cJSON_Delete(errors);
    esp_err_t result = deploy_configuration_json(req, body, cfg, NULL, rollback_deployment_id);
    if (result == ESP_OK) {
        const system_storage_state_t *st2 = storage_mgr_get_state();
        (void)event_mgr_log_context(LOG_LEVEL_WARN, "CONFIGURATION", "CONFIGURATION_ROLLED_BACK", "Configuration was explicitly rolled back to the previous active snapshot.",
                                    st2->complex_id, NULL, NULL, NULL, st2->config_version);
    }
    cJSON_Delete(body); cJSON_Delete(cfg);
    return result;
}

esp_err_t handler_validate_configuration(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;
    cJSON *request_payload = cJSON_GetObjectItem(body, "payload");
    if (!request_payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON *errors = cJSON_AddArrayToObject(root, "errors");
    cJSON *warnings = cJSON_AddArrayToObject(root, "warnings");
    bool valid = validate_config_payload(request_payload, errors);
    cJSON_AddBoolToObject(root, "valid", valid);
    cJSON_AddNumberToObject(root, "inventoryVersion", storage_mgr_get_state()->config_version);

    cJSON *issues = cJSON_CreateArray();
    cJSON *e = NULL;
    cJSON_ArrayForEach(e, errors) {
        if (!e || !cJSON_IsString(e)) continue;
        cJSON *issue = cJSON_CreateObject();
        cJSON_AddStringToObject(issue, "code", "VALIDATION_FAILED");
        cJSON_AddStringToObject(issue, "message", e->valuestring);
        cJSON_AddItemToArray(issues, issue);
    }
    cJSON_AddItemToObject(root, "issues", issues);

    cJSON_Delete(body);
    return http_send_enveloped_response(req, 200, req_id, root);
}

