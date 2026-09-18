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
    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) != ESP_OK || !json) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid JSON", NULL);
    }

    cJSON *payload = cJSON_GetObjectItem(json, "payload");
    cJSON *target = payload ? payload : json;

    cJSON *id_item = cJSON_GetObjectItem(target, "id");
    cJSON *action_item = cJSON_GetObjectItem(target, "action");
    cJSON *type_item = cJSON_GetObjectItem(target, "type");
    cJSON *enabled_item = cJSON_GetObjectItem(target, "enabled");
    cJSON *dur_item = cJSON_GetObjectItem(target, "durationSec");

    if (!id_item || !cJSON_IsString(id_item)) {
        cJSON_Delete(json);
        return http_send_error(req, 400, "BAD_REQUEST", "Schedule id is required", NULL);
    }

    schedule_entry_t entry = {0};
    strncpy(entry.id, id_item->valuestring, sizeof(entry.id) - 1);
    entry.enabled = enabled_item ? cJSON_IsTrue(enabled_item) : true;
    entry.type = type_item && cJSON_IsString(type_item) ? str_to_type(type_item->valuestring) : SCHED_TYPE_DAILY;
    entry.action = action_item && cJSON_IsString(action_item) ? str_to_action(action_item->valuestring) : SCHED_ACTION_FERTIGATION;
    entry.duration_sec = dur_item && cJSON_IsNumber(dur_item) ? dur_item->valueint : 60;

    cJSON *target_gh = cJSON_GetObjectItem(target, "targetGhId");
    if (!target_gh) target_gh = cJSON_GetObjectItem(target, "ghId"); // Backwards compatibility
    if (target_gh && cJSON_IsString(target_gh)) {
        strncpy(entry.target_gh_id, target_gh->valuestring, sizeof(entry.target_gh_id) - 1);
    }

    cJSON *hour_item = cJSON_GetObjectItem(target, "hour");
    if (hour_item && cJSON_IsNumber(hour_item)) entry.hour = (uint8_t)hour_item->valueint;

    cJSON *min_item = cJSON_GetObjectItem(target, "minute");
    if (min_item && cJSON_IsNumber(min_item)) entry.minute = (uint8_t)min_item->valueint;

    cJSON *days_item = cJSON_GetObjectItem(target, "daysOfWeek");
    if (days_item && cJSON_IsNumber(days_item)) entry.days_of_week = (uint8_t)days_item->valueint;
    else entry.days_of_week = 0x7F; /* Default all 7 days */

    cJSON *interval_item = cJSON_GetObjectItem(target, "intervalMin");
    if (interval_item && cJSON_IsNumber(interval_item)) entry.interval_min = interval_item->valueint;

    esp_err_t err = scheduler_add_entry(&entry);
    cJSON_Delete(json);

    if (err != ESP_OK) {
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to save schedule to NVS", NULL);
    }

    cJSON *resp_data = cJSON_CreateObject();
    cJSON_AddStringToObject(resp_data, "status", "ok");
    cJSON_AddStringToObject(resp_data, "id", entry.id);
    return http_send_enveloped_response(req, 200, NULL, resp_data);
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
