#include "http/api_schedule_handlers.h"
#include "http/http_server.h"
#include "services/scheduler.h"
#include "storage/storage_mgr.h"
#include "esp_log.h"
#include "cJSON.h"
#include <string.h>
#include <stdlib.h>

static const char *TAG = "API_SCHED";

static const char *type_to_str(schedule_type_t t)
{
    switch (t) {
        case SCHED_TYPE_DAILY: return "DAILY";
        case SCHED_TYPE_INTERVAL: return "INTERVAL";
        case SCHED_TYPE_ONCE: return "ONCE";
        default: return "DAILY";
    }
}

static schedule_type_t str_to_type(const char *s)
{
    if (!s) return SCHED_TYPE_DAILY;
    if (strcmp(s, "INTERVAL") == 0) return SCHED_TYPE_INTERVAL;
    if (strcmp(s, "ONCE") == 0) return SCHED_TYPE_ONCE;
    return SCHED_TYPE_DAILY;
}

static const char *action_to_str(schedule_action_t a)
{
    switch (a) {
        case SCHED_ACTION_FERTIGATION: return "FERTIGATION";
        case SCHED_ACTION_WATER_PUMP: return "WATER_PUMP";
        case SCHED_ACTION_FAN_TOGGLE: return "FAN_TOGGLE";
        default: return "CUSTOM";
    }
}

static schedule_action_t str_to_action(const char *s)
{
    if (!s) return SCHED_ACTION_FERTIGATION;
    if (strcmp(s, "WATER_PUMP") == 0 || strcmp(s, "WELL_PUMP") == 0 || strcmp(s, "WATER_TRANSFER") == 0) return SCHED_ACTION_WATER_PUMP;
    if (strcmp(s, "FAN_TOGGLE") == 0 || strcmp(s, "FAN") == 0) return SCHED_ACTION_FAN_TOGGLE;
    if (strcmp(s, "FERTIGATION") == 0) return SCHED_ACTION_FERTIGATION;
    return SCHED_ACTION_CUSTOM;
}

static esp_err_t api_schedule_get_all_handler(httpd_req_t *req)
{
    schedule_entry_t entries[16];
    size_t count = 0;
    esp_err_t err = scheduler_get_all(entries, 16, &count);
    if (err != ESP_OK) {
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to retrieve schedules", NULL);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");
    for (size_t i = 0; i < count; i++) {
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "id", entries[i].id);
        cJSON_AddBoolToObject(item, "enabled", entries[i].enabled);
        cJSON_AddStringToObject(item, "type", type_to_str(entries[i].type));
        cJSON_AddStringToObject(item, "action", action_to_str(entries[i].action));
        cJSON_AddNumberToObject(item, "durationSec", entries[i].duration_sec);
        cJSON_AddNumberToObject(item, "hour", entries[i].hour);
        cJSON_AddNumberToObject(item, "minute", entries[i].minute);
        cJSON_AddNumberToObject(item, "daysOfWeek", entries[i].days_of_week);
        cJSON_AddNumberToObject(item, "intervalMin", entries[i].interval_min);
        cJSON_AddNumberToObject(item, "lastExecutionTimestamp", entries[i].last_execution_timestamp);
        cJSON_AddBoolToObject(item, "isRunning", entries[i].is_running);
        cJSON_AddItemToArray(items, item);
    }
    cJSON_AddNumberToObject(root, "total", (double)count);

    return http_send_enveloped_response(req, 200, NULL, root);
}

static esp_err_t api_schedule_add_handler(httpd_req_t *req)
{
    return http_send_error(req, 410, "RAW_SCHEDULES_RETIRED", "Raw schedules are no longer executable. Compile and deploy through /api/v1/schedules/compiled.", NULL);
}

static esp_err_t api_schedule_delete_handler(httpd_req_t *req)
{
    return http_send_error(req, 410, "RAW_SCHEDULES_RETIRED", "Raw schedules are no longer executable. Remove them from the backend schedule intent store and redeploy the compiled set.", NULL);
}

static esp_err_t api_compiled_schedule_get_handler(httpd_req_t *req)
{
    char *buf = calloc(1, 12288);
    if (!buf) return http_send_error(req, 503, "NO_MEMORY", "Unable to allocate compiled schedule buffer", NULL);
    size_t len = 0;
    esp_err_t err = scheduler_get_compiled_json(buf, 12288, &len);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        free(buf);
        cJSON *empty = cJSON_CreateObject();
        cJSON_AddNumberToObject(empty, "configurationVersion", storage_mgr_get_state()->config_version);
        cJSON_AddArrayToObject(empty, "compiled");
        return http_send_enveloped_response(req, 200, NULL, empty);
    }
    if (err != ESP_OK) {
        free(buf);
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to read deployed compiled schedules", NULL);
    }
    cJSON *data = cJSON_ParseWithLength(buf, len);
    free(buf);
    if (!data) return http_send_error(req, 500, "CORRUPT_COMPILED_SCHEDULE", "Stored compiled schedule JSON is invalid", NULL);
    return http_send_enveloped_response(req, 200, NULL, data);
}

static esp_err_t api_compiled_schedule_deploy_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) != ESP_OK || !json) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }
    cJSON *request_id_item = cJSON_GetObjectItem(json, "requestId");
    const char *request_id = request_id_item && cJSON_IsString(request_id_item) ? request_id_item->valuestring : NULL;
    cJSON *payload = cJSON_GetObjectItem(json, "payload");
    cJSON *target = payload && cJSON_IsObject(payload) ? payload : json;
    char *normalized = cJSON_PrintUnformatted(target);
    cJSON_Delete(json);
    if (!normalized) return http_send_error(req, 503, "NO_MEMORY", "Unable to normalize compiled schedule payload", request_id);

    esp_err_t err = scheduler_deploy_compiled_json(normalized);
    free(normalized);
    if (err != ESP_OK) {
        int status = (err == ESP_ERR_INVALID_STATE) ? 409 : 422;
        return http_send_error(req, status, status == 409 ? "CONFIGURATION_CONFLICT" : "COMPILED_SCHEDULE_INVALID", "Compiled schedule deployment was rejected by the active runtime configuration", request_id);
    }

    cJSON *response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "status", "DEPLOYED");
    cJSON_AddNumberToObject(response, "configurationVersion", storage_mgr_get_state()->config_version);
    return http_send_enveloped_response(req, 200, request_id, response);
}

static esp_err_t api_compiled_schedule_delete_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    esp_err_t err = scheduler_clear_compiled();
    if (err != ESP_OK) return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to clear deployed compiled schedules", NULL);
    cJSON *response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "status", "CLEARED");
    return http_send_enveloped_response(req, 200, NULL, response);
}

void register_api_schedule_handlers(httpd_handle_t server)
{
    httpd_uri_t compiled_get_uri = {
        .uri = "/api/v1/schedules/compiled",
        .method = HTTP_GET,
        .handler = api_compiled_schedule_get_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &compiled_get_uri);

    httpd_uri_t compiled_post_uri = {
        .uri = "/api/v1/schedules/compiled",
        .method = HTTP_POST,
        .handler = api_compiled_schedule_deploy_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &compiled_post_uri);

    httpd_uri_t compiled_delete_uri = {
        .uri = "/api/v1/schedules/compiled",
        .method = HTTP_DELETE,
        .handler = api_compiled_schedule_delete_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &compiled_delete_uri);
    httpd_uri_t get_all_uri = {
        .uri       = "/api/v1/schedules",
        .method    = HTTP_GET,
        .handler   = api_schedule_get_all_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &get_all_uri);

    httpd_uri_t add_uri = {
        .uri       = "/api/v1/schedules",
        .method    = HTTP_POST,
        .handler   = api_schedule_add_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &add_uri);

    httpd_uri_t delete_uri = {
        .uri       = "/api/v1/schedules/*",
        .method    = HTTP_DELETE,
        .handler   = api_schedule_delete_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &delete_uri);
}
