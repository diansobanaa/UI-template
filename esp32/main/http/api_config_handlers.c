#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "storage/storage_mgr.h"
#include "cJSON.h"
#include <string.h>

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
            return http_send_json_response(req, 200, root);
        }
    }

    /* Fallback default config object */
    cJSON *cfg = cJSON_AddObjectToObject(root, "config");
    cJSON_AddStringToObject(cfg, "complexId", st->complex_id);
    cJSON_AddStringToObject(cfg, "timezone", "Asia/Jakarta");
    cJSON_AddArrayToObject(cfg, "schedules");

    return http_send_json_response(req, 200, root);
}

esp_err_t handler_put_configuration(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid configuration JSON payload", NULL);
    }

    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *expected_ver = cJSON_GetObjectItem(body, "expectedVersion");
    if (expected_ver && cJSON_IsNumber(expected_ver)) {
        if ((uint32_t)expected_ver->valuedouble != st->config_version) {
            cJSON_Delete(body);
            return http_send_error(req, 409, "CONFLICT", "Configuration version conflict", NULL);
        }
    }

    uint32_t new_version = st->config_version + 1;
    char *json_text = cJSON_PrintUnformatted(body);
    if (json_text) {
        storage_mgr_save_config(json_text, new_version);
        free(json_text);
    }

    cJSON_Delete(body);
    return handler_get_configuration(req);
}

esp_err_t handler_validate_configuration(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "valid", true);
    cJSON_AddArrayToObject(root, "errors");
    cJSON_AddArrayToObject(root, "warnings");

    cJSON_Delete(body);
    return http_send_json_response(req, 200, root);
}
