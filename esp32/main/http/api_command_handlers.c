#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "hal/actuator_hal.h"
#include "cJSON.h"
#include <string.h>

esp_err_t handler_emergency_stop(httpd_req_t *req)
{
    cJSON *body = NULL;
    http_parse_json_body(req, &body);

    const char *reason = "Emergency Stop triggered from REST API";
    const char *req_id = NULL;

    if (body) {
        cJSON *r = cJSON_GetObjectItem(body, "reason");
        if (r && cJSON_IsString(r)) reason = r->valuestring;
        cJSON *rq = cJSON_GetObjectItem(body, "requestId");
        if (rq && cJSON_IsString(rq)) req_id = rq->valuestring;
    }

    actuator_hal_emergency_stop();

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "commandId", "estop-active");
    cJSON_AddStringToObject(root, "status", "COMPLETED");
    cJSON_AddStringToObject(root, "message", reason);
    if (req_id) {
        cJSON_AddStringToObject(root, "requestId", req_id);
    }

    if (body) cJSON_Delete(body);
    return http_send_json_response(req, 202, root);
}

esp_err_t handler_post_command(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid command JSON payload", NULL);
    }

    cJSON *cmd_id = cJSON_GetObjectItem(body, "commandId");
    cJSON *type = cJSON_GetObjectItem(body, "type");

    if (!cmd_id || !cJSON_IsString(cmd_id) || !type || !cJSON_IsString(type)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "commandId and type are required", NULL);
    }

    /* Execute direct command if matched */
    if (strcmp(type->valuestring, "RESUME_SYSTEM") == 0) {
        actuator_hal_resume();
    } else if (strcmp(type->valuestring, "EMERGENCY_STOP") == 0) {
        actuator_hal_emergency_stop();
    } else if (strcmp(type->valuestring, "WELL_PUMP_START") == 0) {
        actuator_hal_set(ACTUATOR_WELL_PUMP, true);
    } else if (strcmp(type->valuestring, "WELL_PUMP_STOP") == 0) {
        actuator_hal_set(ACTUATOR_WELL_PUMP, false);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "commandId", cmd_id->valuestring);
    cJSON_AddStringToObject(root, "status", "ACCEPTED");
    cJSON_AddStringToObject(root, "message", "Command accepted for processing");

    cJSON_Delete(body);
    return http_send_json_response(req, 202, root);
}

esp_err_t handler_get_command(httpd_req_t *req)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "commandId", "cmd-latest");
    cJSON_AddStringToObject(root, "status", "COMPLETED");
    cJSON_AddStringToObject(root, "message", "Operation finished");

    return http_send_json_response(req, 200, root);
}
