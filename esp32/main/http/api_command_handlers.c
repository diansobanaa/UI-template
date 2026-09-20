#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "hal/actuator_hal.h"
#include "storage/storage_mgr.h"
#include "cJSON.h"
#include "services/command_mgr.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

static const char *json_string(cJSON *obj, const char *key)
{
    cJSON *v = obj ? cJSON_GetObjectItem(obj, key) : NULL;
    return (v && cJSON_IsString(v)) ? v->valuestring : NULL;
}

static void copy_json_string(char *dst, size_t n, cJSON *obj, const char *key)
{
    const char *value = json_string(obj, key);
    if (!dst || n == 0) return;
    dst[0] = '\0';
    if (value) {
        strncpy(dst, value, n - 1);
        dst[n - 1] = '\0';
    }
}

static int command_error_http_status(esp_err_t err, const char *code)
{
    if (err == ESP_ERR_TIMEOUT || (code && strcmp(code, "QUEUE_FULL") == 0)) return 503;
    if (err == ESP_ERR_NOT_FOUND) return 404;
    if (err == ESP_ERR_INVALID_STATE || (code && (strcmp(code, "EMERGENCY_STOP_ACTIVE") == 0 ||
        strcmp(code, "SAFETY_FAULT_ACTIVE") == 0 || strcmp(code, "RESOURCE_BUSY") == 0 ||
        strcmp(code, "SAFETY_LOCK_ACTIVE") == 0 || strcmp(code, "STALE_CONFIGURATION_VERSION") == 0 ||
        strcmp(code, "TARGET_GH_COMPONENT_MISMATCH") == 0 || strcmp(code, "TARGET_COMPLEX_MISMATCH") == 0))) return 409;
    if (err == ESP_ERR_NOT_SUPPORTED) return 422;
    return 422;
}

static const char *status_string(cmd_status_enum_t status)
{
    switch (status) {
        case CMD_STATUS_RUNNING: return "RUNNING";
        case CMD_STATUS_COMPLETED: return "COMPLETED";
        case CMD_STATUS_FAILED: return "FAILED";
        case CMD_STATUS_REJECTED: return "REJECTED";
        case CMD_STATUS_CANCELLED: return "CANCELLED";
        case CMD_STATUS_PENDING: default: return "ACCEPTED";
    }
}

static cJSON *command_receipt_json(const command_item_t *cmd)
{
    cJSON *root = cJSON_CreateObject();
    if (!root || !cmd) return root;
    cJSON_AddStringToObject(root, "commandId", cmd->command_id);
    cJSON_AddStringToObject(root, "status", status_string(cmd->status));
    cJSON_AddStringToObject(root, "message", cmd->message[0] ? cmd->message : "Command status");
    if (cmd->component_id[0]) cJSON_AddStringToObject(root, "componentId", cmd->component_id);
    if (cmd->target_complex_id[0]) cJSON_AddStringToObject(root, "targetComplexId", cmd->target_complex_id);
    if (cmd->target_gh_id[0]) cJSON_AddStringToObject(root, "targetGhId", cmd->target_gh_id);
    if (cmd->resource_id[0]) cJSON_AddStringToObject(root, "resourceId", cmd->resource_id);
    if (cmd->configuration_version) cJSON_AddNumberToObject(root, "configurationVersion", cmd->configuration_version);
    if (cmd->submitted_at) cJSON_AddNumberToObject(root, "submittedAtMs", (double)cmd->submitted_at);
    if (cmd->started_at) cJSON_AddNumberToObject(root, "startedAtMs", (double)cmd->started_at);
    if (cmd->completed_at) cJSON_AddNumberToObject(root, "completedAtMs", (double)cmd->completed_at);
    if (cmd->result_code[0]) cJSON_AddStringToObject(root, "resultCode", cmd->result_code);
    return root;
}

static void parse_common_fields(cJSON *payload, command_item_t *cmd)
{
    copy_json_string(cmd->component_id, sizeof(cmd->component_id), payload, "componentId");
    copy_json_string(cmd->resource_id, sizeof(cmd->resource_id), payload, "resourceId");
    copy_json_string(cmd->target_complex_id, sizeof(cmd->target_complex_id), payload, "targetComplexId");
    if (!cmd->target_complex_id[0]) copy_json_string(cmd->target_complex_id, sizeof(cmd->target_complex_id), payload, "complexId");
    copy_json_string(cmd->target_gh_id, sizeof(cmd->target_gh_id), payload, "targetGhId");
    if (!cmd->target_gh_id[0]) copy_json_string(cmd->target_gh_id, sizeof(cmd->target_gh_id), payload, "ghId");
    copy_json_string(cmd->source, sizeof(cmd->source), payload, "source");

    cJSON *version = cJSON_GetObjectItem(payload, "configurationVersion");
    if (version && cJSON_IsNumber(version) && version->valuedouble >= 0.0) cmd->configuration_version = (uint32_t)version->valuedouble;
    cJSON *max_runtime = cJSON_GetObjectItem(payload, "maxRuntimeSec");
    if (max_runtime && cJSON_IsNumber(max_runtime) && max_runtime->valuedouble >= 0.0) cmd->max_runtime_sec = (uint32_t)max_runtime->valuedouble;
    cJSON *duration = cJSON_GetObjectItem(payload, "durationSeconds");
    if (duration && cJSON_IsNumber(duration)) cmd->param_duration_sec = duration->valueint;
}

static esp_err_t parse_command_payload(cJSON *payload, command_item_t *cmd, char *code, size_t code_len, char *message, size_t message_len)
{
    if (!payload || !cmd) return ESP_ERR_INVALID_ARG;
    memset(cmd, 0, sizeof(*cmd));
    const char *command_id = json_string(payload, "commandId");
    const char *type = json_string(payload, "type");
    if (!command_id || !type || !command_id[0] || !type[0]) {
        snprintf(code, code_len, "COMMAND_ID_OR_TYPE_REQUIRED");
        snprintf(message, message_len, "commandId and type are required in payload.");
        return ESP_ERR_INVALID_ARG;
    }
    strncpy(cmd->command_id, command_id, sizeof(cmd->command_id) - 1);
    parse_common_fields(payload, cmd);

    if (strcmp(type, "RESUME_SYSTEM") == 0 || strcmp(type, "RESUME_CYCLE") == 0 || strcmp(type, "RESUME") == 0) {
        cmd->type = CMD_TYPE_RESUME;
    } else if (strcmp(type, "EMERGENCY_STOP") == 0) {
        cmd->type = CMD_TYPE_EMERGENCY_STOP;
    } else if (strcmp(type, "WELL_PUMP_START") == 0 || strcmp(type, "WATER_PUMP_START") == 0) {
        cmd->type = CMD_TYPE_WELL_PUMP;
        cmd->param_on = true;
    } else if (strcmp(type, "WELL_PUMP_STOP") == 0 || strcmp(type, "WATER_PUMP_STOP") == 0) {
        cmd->type = CMD_TYPE_WELL_PUMP;
        cmd->param_on = false;
    } else if (strcmp(type, "DIST_PUMP_START") == 0) {
        cmd->type = CMD_TYPE_DIST_PUMP;
        cmd->param_on = true;
    } else if (strcmp(type, "DIST_PUMP_STOP") == 0) {
        cmd->type = CMD_TYPE_DIST_PUMP;
        cmd->param_on = false;
    } else if (strcmp(type, "DOSING_RUN_START") == 0 || strcmp(type, "MANUAL_PUMP_START") == 0) {
        cmd->type = CMD_TYPE_DOSING_RUN;
        cmd->param_on = true;
    } else if (strcmp(type, "DOSING_RUN_STOP") == 0 || strcmp(type, "MANUAL_PUMP_STOP") == 0) {
        cmd->type = CMD_TYPE_DOSING_RUN;
        cmd->param_on = false;
    } else if (strcmp(type, "TANK_TRANSFER_START") == 0) {
        cmd->type = CMD_TYPE_TANK_TRANSFER;
        cmd->param_on = true;
        const char *src_component = json_string(payload, "sourceComponentId");
        const char *dst_component = json_string(payload, "destinationComponentId");
        if (!src_component || !dst_component || !src_component[0] || !dst_component[0]) {
            snprintf(code, code_len, "TRANSFER_COMPONENT_IDS_REQUIRED");
            snprintf(message, message_len, "Tank transfer requires sourceComponentId and destinationComponentId.");
            return ESP_ERR_INVALID_ARG;
        }
        strncpy(cmd->source_component_id, src_component, sizeof(cmd->source_component_id) - 1);
        strncpy(cmd->destination_component_id, dst_component, sizeof(cmd->destination_component_id) - 1);
        cmd->source_component_id[sizeof(cmd->source_component_id) - 1] = '\0';
        cmd->destination_component_id[sizeof(cmd->destination_component_id) - 1] = '\0';
    } else if (strcmp(type, "TANK_TRANSFER_STOP") == 0) {
        cmd->type = CMD_TYPE_TANK_TRANSFER;
        cmd->param_on = false;
    } else if (strcmp(type, "FERTIGATION_START") == 0 || strcmp(type, "START_FERTIGATION") == 0) {
        cmd->type = CMD_TYPE_FERTIGATION_BATCH;
        cmd->param_on = true;
        cJSON *execution_plan = cJSON_GetObjectItem(payload, "executionPlan");
        cJSON *params = cJSON_GetObjectItem(payload, "parameters");
        if ((!execution_plan || !cJSON_IsObject(execution_plan)) && params && cJSON_IsObject(params)) {
            execution_plan = cJSON_GetObjectItem(params, "executionPlan");
        }
        if (!execution_plan || !cJSON_IsObject(execution_plan)) {
            snprintf(code, code_len, "FERTIGATION_EXECUTION_PLAN_REQUIRED");
            snprintf(message, message_len, "Automatic fertigation requires a resolved executionPlan.");
            return ESP_ERR_INVALID_STATE;
        }
        cJSON *raw = cJSON_GetObjectItem(payload, "rawWaterVolumeMl");
        if (raw && cJSON_IsNumber(raw) && raw->valuedouble >= 0) cmd->param_raw_volume_ml = raw->valueint;
        char *fert_json = cJSON_PrintUnformatted(payload);
        if (fert_json) { strncpy(cmd->fertigation_payload_json, fert_json, sizeof(cmd->fertigation_payload_json) - 1); cmd->fertigation_payload_json[sizeof(cmd->fertigation_payload_json) - 1] = '\0'; free(fert_json); }
        if (params && cJSON_IsObject(params)) {
            cJSON *p_target_water = cJSON_GetObjectItem(params, "targetWaterL");
            if (p_target_water && cJSON_IsNumber(p_target_water) && cmd->param_raw_volume_ml == 0) cmd->param_raw_volume_ml = (int32_t)(p_target_water->valuedouble * 1000.0);
        }
    } else if (strcmp(type, "FERTIGATION_STOP") == 0) {
        cmd->type = CMD_TYPE_FERTIGATION_BATCH;
        cmd->param_on = false;
    } else if (strcmp(type, "COMPONENT_TIMED") == 0) {
        cmd->type = CMD_TYPE_COMPONENT_TIMED;
        cmd->param_on = true;
    } else {
        snprintf(code, code_len, "UNSUPPORTED_COMMAND_TYPE");
        snprintf(message, message_len, "Unsupported command type '%s'.", type);
        return ESP_ERR_NOT_SUPPORTED;
    }
    return ESP_OK;
}

esp_err_t handler_emergency_stop(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *body = NULL;
    esp_err_t parse_err = http_parse_json_body(req, &body);
    if (parse_err != ESP_OK || !body) return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid emergency-stop JSON payload", NULL);
    const char *req_id = json_string(body, "requestId");
    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload || !cJSON_IsObject(payload)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    command_item_t cmd = {0};
    const char *command_id = json_string(payload, "commandId");
    const char *reason = json_string(payload, "reason");
    if (!command_id || !command_id[0]) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "COMMAND_ID_REQUIRED", "Emergency stop requires a commandId for idempotency.", req_id);
    }
    strncpy(cmd.command_id, command_id, sizeof(cmd.command_id) - 1);
    strncpy(cmd.source, "HTTP", sizeof(cmd.source) - 1);
    cmd.type = CMD_TYPE_EMERGENCY_STOP;
    esp_err_t err = command_mgr_submit(&cmd, NULL);
    if (err != ESP_OK) {
        cJSON_Delete(body);
        return http_send_error(req, command_error_http_status(err, "EMERGENCY_STOP_FAILED"), "EMERGENCY_STOP_FAILED", reason ? reason : "Emergency stop request failed.", req_id);
    }
    (void)reason;
    command_item_t receipt = {0};
    if (command_mgr_get(cmd.command_id, &receipt) != ESP_OK) receipt = cmd;
    cJSON *root = command_receipt_json(&receipt);
    cJSON_Delete(body);
    return http_send_enveloped_response(req, 202, req_id, root);
}

esp_err_t handler_post_command(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid command JSON payload", NULL);
    const char *req_id = json_string(body, "requestId");
    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload || !cJSON_IsObject(payload)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    command_item_t cmd = {0};
    char parse_code[48] = {0};
    char parse_message[128] = {0};
    err = parse_command_payload(payload, &cmd, parse_code, sizeof(parse_code), parse_message, sizeof(parse_message));
    if (err != ESP_OK) {
        cJSON_Delete(body);
        return http_send_error(req, command_error_http_status(err, parse_code), parse_code[0] ? parse_code : "VALIDATION_FAILED", parse_message[0] ? parse_message : "Invalid command", req_id);
    }

    err = command_mgr_submit(&cmd, NULL);
    if (err != ESP_OK) {
        command_item_t cached = {0};
        const char *code = "COMMAND_REJECTED";
        const char *message = "Command rejected by device safety/validation policy.";
        if (command_mgr_get(cmd.command_id, &cached) == ESP_OK && cached.result_code[0]) {
            code = cached.result_code;
            message = cached.message;
        }
        cJSON_Delete(body);
        return http_send_error(req, command_error_http_status(err, code), code, message, req_id);
    }

    command_item_t receipt = {0};
    if (command_mgr_get(cmd.command_id, &receipt) != ESP_OK) receipt = cmd;
    cJSON *root = command_receipt_json(&receipt);
    cJSON_Delete(body);
    return http_send_enveloped_response(req, 202, req_id, root);
}

esp_err_t handler_get_command(httpd_req_t *req)
{
    const char *uri = req->uri;
    const char *prefix = "/api/v1/commands/";
    const char *cmd_id = strstr(uri, prefix);
    if (!cmd_id) return http_send_error(req, 422, "VALIDATION_FAILED", "Missing command ID", NULL);
    cmd_id += strlen(prefix);

    char cmd_id_buf[64] = {0};
    const char *query_pos = strchr(cmd_id, '?');
    size_t copy_len = query_pos ? (size_t)(query_pos - cmd_id) : strlen(cmd_id);
    if (copy_len >= sizeof(cmd_id_buf)) copy_len = sizeof(cmd_id_buf) - 1;
    memcpy(cmd_id_buf, cmd_id, copy_len);
    cmd_id_buf[copy_len] = '\0';

    command_item_t cmd;
    esp_err_t err = command_mgr_get(cmd_id_buf, &cmd);
    if (err == ESP_ERR_NOT_FOUND) return http_send_error(req, 404, "NOT_FOUND", "Command not found", NULL);
    if (err != ESP_OK) return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to get command", NULL);
    return http_send_enveloped_response(req, 200, NULL, command_receipt_json(&cmd));
}

esp_err_t handler_delete_command(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    const char *uri = req->uri;
    const char *prefix = "/api/v1/commands/";
    const char *cmd_id = strstr(uri, prefix);
    if (!cmd_id) return http_send_error(req, 422, "VALIDATION_FAILED", "Missing command ID", NULL);
    cmd_id += strlen(prefix);
    char cmd_id_buf[64] = {0};
    const char *query_pos = strchr(cmd_id, '?');
    size_t copy_len = query_pos ? (size_t)(query_pos - cmd_id) : strlen(cmd_id);
    if (copy_len >= sizeof(cmd_id_buf)) copy_len = sizeof(cmd_id_buf) - 1;
    memcpy(cmd_id_buf, cmd_id, copy_len);
    cmd_id_buf[copy_len] = '\0';

    esp_err_t err = command_mgr_cancel(cmd_id_buf);
    if (err == ESP_ERR_NOT_FOUND) return http_send_error(req, 404, "NOT_FOUND", "Command not found", NULL);
    if (err != ESP_OK) return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to cancel command", NULL);
    command_item_t cmd = {0};
    (void)command_mgr_get(cmd_id_buf, &cmd);
    return http_send_enveloped_response(req, 200, NULL, command_receipt_json(&cmd));
}
