#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "hal/actuator_hal.h"
#include "cJSON.h"
#include "services/command_mgr.h"
#include <string.h>

esp_err_t handler_emergency_stop(httpd_req_t *req)
{

    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK; // Response already sent
    }
    cJSON *body = NULL;
    http_parse_json_body(req, &body);

    const char *reason = "Emergency Stop triggered from REST API";
    const char *req_id = NULL;
    const char *cmd_id = "estop-active";

    if (body) {
        cJSON *rq = cJSON_GetObjectItem(body, "requestId");
        if (rq && cJSON_IsString(rq)) req_id = rq->valuestring;

        cJSON *payload = cJSON_GetObjectItem(body, "payload");
        if (payload) {
            cJSON *r = cJSON_GetObjectItem(payload, "reason");
            if (r && cJSON_IsString(r)) reason = r->valuestring;
            cJSON *ci = cJSON_GetObjectItem(payload, "commandId");
            if (ci && cJSON_IsString(ci)) cmd_id = ci->valuestring;
        }
    }

    actuator_hal_emergency_stop();
    (void)reason;

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "commandId", cmd_id);
    cJSON_AddStringToObject(root, "status", "COMPLETED");

    if (body) cJSON_Delete(body);
    return http_send_enveloped_response(req, 202, req_id, root);
}

esp_err_t handler_post_command(httpd_req_t *req)
{

    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK; // Response already sent
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid command JSON payload", NULL);
    }

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *cmd_id = cJSON_GetObjectItem(payload, "commandId");
    cJSON *type = cJSON_GetObjectItem(payload, "type");

    if (!cmd_id || !cJSON_IsString(cmd_id) || !type || !cJSON_IsString(type)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "commandId and type are required in payload", req_id);
    }

    command_item_t cmd = {0};
    strncpy(cmd.command_id, cmd_id->valuestring, sizeof(cmd.command_id) - 1);
    
    if (strcmp(type->valuestring, "RESUME_SYSTEM") == 0) {
        cmd.type = CMD_TYPE_RESUME;
    } else if (strcmp(type->valuestring, "EMERGENCY_STOP") == 0) {
        cmd.type = CMD_TYPE_EMERGENCY_STOP;
    } else if (strcmp(type->valuestring, "WELL_PUMP_START") == 0) {
        cmd.type = CMD_TYPE_WELL_PUMP;
        cmd.param_duration_sec = 600; /* Default 10 min */
    } else if (strcmp(type->valuestring, "WELL_PUMP_STOP") == 0) {
        cmd.type = CMD_TYPE_WELL_PUMP;
        cmd.param_duration_sec = 0; /* Stop immediately */
    } else {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Unsupported command type", NULL);
    }
    
    cJSON *dur = cJSON_GetObjectItem(payload, "durationSeconds");
    if (dur && cJSON_IsNumber(dur)) {
        cmd.param_duration_sec = dur->valueint;
    }
    err = command_mgr_submit(&cmd, NULL);
    if (err != ESP_OK) {
        cJSON_Delete(body);
        return http_send_error(req, 503, "QUEUE_FULL", "Command queue is full", req_id);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "commandId", cmd_id->valuestring);
    cJSON_AddStringToObject(root, "status", "ACCEPTED");
    cJSON_AddStringToObject(root, "message", "Command accepted for processing");

    cJSON_Delete(body);
    return http_send_enveloped_response(req, 202, req_id, root); 
}

esp_err_t handler_get_command(httpd_req_t *req)
{
    /* Extract commandId from URI: /api/v1/commands/{commandId} */
    const char *uri = req->uri;
    const char *prefix = "/api/v1/commands/";
    const char *cmd_id = strstr(uri, prefix);
    
    if (!cmd_id) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing command ID", NULL);
    }
    cmd_id += strlen(prefix);
    
    char cmd_id_buf[64] = {0};
    const char *query_pos = strchr(cmd_id, '?');
    if (query_pos) {
        strncpy(cmd_id_buf, cmd_id, query_pos - cmd_id);
    } else {
        strncpy(cmd_id_buf, cmd_id, sizeof(cmd_id_buf) - 1);
    }
    
    command_item_t cmd;
    esp_err_t err = command_mgr_get(cmd_id_buf, &cmd);
    
    if (err == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Command not found", NULL);
    } else if (err != ESP_OK) {
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to get command", NULL);
    }

    const char *status_str = "PENDING";
    switch (cmd.status) {
        case CMD_STATUS_RUNNING: status_str = "RUNNING"; break;
        case CMD_STATUS_COMPLETED: status_str = "COMPLETED"; break;
        case CMD_STATUS_FAILED: status_str = "FAILED"; break;
        case CMD_STATUS_REJECTED: status_str = "REJECTED"; break;
        default: break;
    }

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "commandId", cmd_id_buf);
    cJSON_AddStringToObject(root, "status", status_str);
    cJSON_AddStringToObject(root, "message", cmd.message[0] ? cmd.message : "Command status fetched");

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_delete_command(httpd_req_t *req)
{

    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK; // Response already sent
    }
    /* Extract commandId from URI: /api/v1/commands/{commandId} */
    const char *uri = req->uri;
    const char *prefix = "/api/v1/commands/";
    const char *cmd_id = strstr(uri, prefix);
    
    if (!cmd_id) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing command ID", NULL);
    }
    cmd_id += strlen(prefix);
    
    char cmd_id_buf[64] = {0};
    const char *query_pos = strchr(cmd_id, '?');
    if (query_pos) {
        strncpy(cmd_id_buf, cmd_id, query_pos - cmd_id);
    } else {
        strncpy(cmd_id_buf, cmd_id, sizeof(cmd_id_buf) - 1);
    }
    
    esp_err_t err = command_mgr_cancel(cmd_id_buf);
    
    if (err == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Command not found", NULL);
    } else if (err != ESP_OK) {
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to cancel command", NULL);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "commandId", cmd_id_buf);
    cJSON_AddStringToObject(root, "status", "CANCELLED");
    cJSON_AddStringToObject(root, "message", "Command cancellation requested");

    return http_send_enveloped_response(req, 200, NULL, root);
}
