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
    
    cJSON *target_gh = cJSON_GetObjectItem(payload, "targetGhId");
    if (target_gh && cJSON_IsString(target_gh)) {
        strncpy(cmd.target_gh_id, target_gh->valuestring, sizeof(cmd.target_gh_id) - 1);
    }
    
    cJSON *dur = cJSON_GetObjectItem(payload, "durationSeconds");
    if (dur && cJSON_IsNumber(dur)) {
        cmd.param_duration_sec = dur->valueint;
    }

    if (strcmp(type->valuestring, "RESUME_SYSTEM") == 0 || strcmp(type->valuestring, "RESUME_CYCLE") == 0) {
        cmd.type = CMD_TYPE_RESUME;
    } else if (strcmp(type->valuestring, "EMERGENCY_STOP") == 0) {
        cmd.type = CMD_TYPE_EMERGENCY_STOP;
    } else if (strcmp(type->valuestring, "WELL_PUMP_START") == 0) {
        cmd.type = CMD_TYPE_WELL_PUMP;
        if (cmd.param_duration_sec <= 0) cmd.param_duration_sec = 600; /* Default 10 min */
    } else if (strcmp(type->valuestring, "WELL_PUMP_STOP") == 0) {
        cmd.type = CMD_TYPE_WELL_PUMP;
        cmd.param_duration_sec = 0; /* Stop immediately */
    } else if (strcmp(type->valuestring, "DIST_PUMP_START") == 0) {
        cmd.type = CMD_TYPE_DIST_PUMP;
        if (cmd.param_duration_sec <= 0) cmd.param_duration_sec = 300;
    } else if (strcmp(type->valuestring, "DIST_PUMP_STOP") == 0) {
        cmd.type = CMD_TYPE_DIST_PUMP;
        cmd.param_duration_sec = 0;
    } else if (strcmp(type->valuestring, "DOSING_RUN_START") == 0 || strcmp(type->valuestring, "MANUAL_PUMP_START") == 0) {
        cmd.type = CMD_TYPE_DOSING_RUN;
        if (cmd.param_duration_sec <= 0) cmd.param_duration_sec = 30;
    } else if (strcmp(type->valuestring, "DOSING_RUN_STOP") == 0 || strcmp(type->valuestring, "MANUAL_PUMP_STOP") == 0) {
        cmd.type = CMD_TYPE_DOSING_RUN;
        cmd.param_duration_sec = 0;
    } else if (strcmp(type->valuestring, "TANK_TRANSFER_START") == 0) {
        cmd.type = CMD_TYPE_TANK_TRANSFER;
        cmd.param_source_id = ACTUATOR_RAW_SUBMERSIBLE;
        cmd.param_dest_id = ACTUATOR_MAX_COUNT;
        if (cmd.param_duration_sec <= 0) cmd.param_duration_sec = 900; /* 15 min */
    } else if (strcmp(type->valuestring, "TANK_TRANSFER_STOP") == 0) {
        cmd.type = CMD_TYPE_TANK_TRANSFER;
        cmd.param_duration_sec = 0;
    } else if (strcmp(type->valuestring, "FERTIGATION_START") == 0 || strcmp(type->valuestring, "START_FERTIGATION") == 0) {
        cmd.type = CMD_TYPE_FERTIGATION_BATCH;
        cJSON *raw = cJSON_GetObjectItem(payload, "rawWaterVolumeMl");
        if (raw && cJSON_IsNumber(raw)) cmd.param_raw_volume_ml = raw->valueint;
        cJSON *dosA = cJSON_GetObjectItem(payload, "dosingAVolumeMl");
        if (dosA && cJSON_IsNumber(dosA)) cmd.param_dosing_a_ml = dosA->valueint;
        cJSON *dosB = cJSON_GetObjectItem(payload, "dosingBVolumeMl");
        if (dosB && cJSON_IsNumber(dosB)) cmd.param_dosing_b_ml = dosB->valueint;

        /* Support parameters object fallback */
        cJSON *params = cJSON_GetObjectItem(payload, "parameters");
        if (params && cJSON_IsObject(params)) {
            cJSON *p_target_water = cJSON_GetObjectItem(params, "targetWaterL");
            if (p_target_water && cJSON_IsNumber(p_target_water) && cmd.param_raw_volume_ml == 0) {
                cmd.param_raw_volume_ml = (int32_t)(p_target_water->valuedouble * 1000.0);
            }
        }
    } else {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Unsupported command type", NULL);
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
