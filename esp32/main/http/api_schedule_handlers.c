#include "http/api_schedule_handlers.h"
#include "http/http_server.h"
#include "services/scheduler.h"
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
        if (entries[i].target_gh_id[0] != '\0') {
            cJSON_AddStringToObject(item, "targetGhId", entries[i].target_gh_id);
        } else {
            cJSON_AddNullToObject(item, "targetGhId");
        }
        cJSON_AddStringToObject(item, "type", entries[i].interval_min == 0 ? "DAILY" : "INTERVAL");
        cJSON_AddStringToObject(item, "action", entries[i].resolved_action[0] ? entries[i].resolved_action : "UNKNOWN");
        cJSON_AddNumberToObject(item, "configurationVersion", entries[i].configuration_version);
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
    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) == ESP_OK && json) {
        cJSON_Delete(json);
    }
    return http_send_error(req, 405, "METHOD_NOT_ALLOWED", 
                           "Direct raw schedule creation is deprecated and rejected. Schedules must be submitted as ScheduleIntents compiled within versioned Configuration Candidates (/api/v1/configuration).", NULL);
}

static esp_err_t api_schedule_delete_handler(httpd_req_t *req)
{
    const char *uri = req->uri;
    const char *prefix = "/api/v1/schedules/";
    const char *id_ptr = strstr(uri, prefix);
    if (!id_ptr) {
        return http_send_error(req, 400, "BAD_REQUEST", "Missing schedule ID in path", NULL);
    }
    id_ptr += strlen(prefix);

    char id_buf[32] = {0};
    const char *q = strchr(id_ptr, '?');
    if (q) {
        strncpy(id_buf, id_ptr, q - id_ptr);
    } else {
        strncpy(id_buf, id_ptr, sizeof(id_buf) - 1);
    }

    esp_err_t err = scheduler_remove_entry(id_buf);
    if (err != ESP_OK) {
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to delete schedule", NULL);
    }

    cJSON *resp_data = cJSON_CreateObject();
    cJSON_AddStringToObject(resp_data, "status", "deleted");
    cJSON_AddStringToObject(resp_data, "id", id_buf);
    return http_send_enveloped_response(req, 200, NULL, resp_data);
}

void register_api_schedule_handlers(httpd_handle_t server)
{
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
