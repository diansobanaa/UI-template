#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "storage/storage_mgr.h"
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
    char buf[4096];
    size_t len = 0;
    if (storage_mgr_load_config(buf, sizeof(buf), &len) == ESP_OK) {
        cJSON *stored = cJSON_Parse(buf);
        if (stored) {
            cJSON_AddItemToObject(root, "config", stored);
            return http_send_enveloped_response(req, 200, NULL, root);
        }
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
        storage_mgr_save_config(json_text, new_version);
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

    char buf[4096];
    size_t len = 0;
    if (storage_mgr_load_config(buf, sizeof(buf), &len) == ESP_OK) {
        cJSON *stored = cJSON_Parse(buf);
        if (stored) {
            cJSON_AddItemToObject(root, "config", stored);
        }
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
    cJSON_AddBoolToObject(root, "valid", valid);

    cJSON_Delete(body);
    return http_send_enveloped_response(req, 200, req_id, root);
}
