#include "http_server.h"
#include "services/calibration_mgr.h"
#include "esp_log.h"
#include "cJSON.h"
#include <string.h>

static const char *TAG = "API_CALIB";

static esp_err_t api_calibration_start_handler(httpd_req_t *req)
{
    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) != ESP_OK || !json) {
        http_send_error(req, 400, "BAD_REQUEST", "Invalid JSON", NULL);
        return ESP_FAIL;
    }

    cJSON *comp_id = cJSON_GetObjectItem(json, "componentId");
    cJSON *type = cJSON_GetObjectItem(json, "type");
    cJSON *duration = cJSON_GetObjectItem(json, "duration_sec");

    if (!cJSON_IsString(comp_id) || !cJSON_IsString(type) || !cJSON_IsNumber(duration)) {
        cJSON_Delete(json);
        http_send_error(req, 400, "BAD_REQUEST", "Missing required fields", NULL);
        return ESP_FAIL;
    }
    
    if (strcmp(type->valuestring, "VOLUMETRIC") != 0) {
        cJSON_Delete(json);
        http_send_error(req, 400, "BAD_REQUEST", "Only VOLUMETRIC supported", NULL);
        return ESP_FAIL;
    }
    
    actuator_id_t pump = ACTUATOR_MAX_COUNT;
    if (strcmp(comp_id->valuestring, "dp-a") == 0) pump = ACTUATOR_DOSING_A;
    else if (strcmp(comp_id->valuestring, "dp-b") == 0) pump = ACTUATOR_DOSING_B;
    
    if (pump == ACTUATOR_MAX_COUNT) {
        cJSON_Delete(json);
        http_send_error(req, 400, "BAD_REQUEST", "Invalid componentId", NULL);
        return ESP_FAIL;
    }

    esp_err_t err = calibration_mgr_start_volumetric(pump, duration->valueint);
    cJSON_Delete(json);

    if (err == ESP_ERR_INVALID_STATE) {
        http_send_error(req, 409, "CONFLICT", "System not in valid state", NULL);
        return ESP_FAIL;
    }

    cJSON *resp_data = cJSON_CreateObject();
    cJSON_AddStringToObject(resp_data, "status", "ok");
    return http_send_enveloped_response(req, 200, NULL, resp_data);
}

static esp_err_t api_calibration_status_handler(httpd_req_t *req)
{
    calibration_status_t st;
    calibration_mgr_get_status(&st);
    
    cJSON *resp = cJSON_CreateObject();
    
    const char *state_str = "IDLE";
    if (st.state == CALIBRATION_STATE_RUNNING) state_str = "RUNNING";
    else if (st.state == CALIBRATION_STATE_COMPLETE) state_str = "COMPLETE";
    else if (st.state == CALIBRATION_STATE_ERROR) state_str = "ERROR";
    
    cJSON_AddStringToObject(resp, "state", state_str);
    cJSON_AddNumberToObject(resp, "remaining_sec", st.remaining_sec);
    
    return http_send_enveloped_response(req, 200, NULL, resp);
}

static esp_err_t api_calibration_set_rate_handler(httpd_req_t *req)
{
    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) != ESP_OK || !json) {
        http_send_error(req, 400, "BAD_REQUEST", "Invalid JSON", NULL);
        return ESP_FAIL;
    }

    cJSON *payload = cJSON_GetObjectItem(json, "payload");
    cJSON *target = payload ? payload : json;

    cJSON *comp_id = cJSON_GetObjectItem(target, "componentId");
    cJSON *rate = cJSON_GetObjectItem(target, "rateMlPerSec");

    if (!comp_id || !cJSON_IsString(comp_id) || !rate || !cJSON_IsNumber(rate)) {
        cJSON_Delete(json);
        http_send_error(req, 400, "BAD_REQUEST", "componentId and rateMlPerSec required", NULL);
        return ESP_FAIL;
    }

    actuator_id_t pump = ACTUATOR_MAX_COUNT;
    if (strcmp(comp_id->valuestring, "dp-a") == 0 || strcmp(comp_id->valuestring, "dosing_a") == 0) {
        pump = ACTUATOR_DOSING_A;
    } else if (strcmp(comp_id->valuestring, "dp-b") == 0 || strcmp(comp_id->valuestring, "dosing_b") == 0) {
        pump = ACTUATOR_DOSING_B;
    }

    if (pump == ACTUATOR_MAX_COUNT) {
        cJSON_Delete(json);
        http_send_error(req, 400, "BAD_REQUEST", "Invalid componentId (must be dp-a or dp-b)", NULL);
        return ESP_FAIL;
    }

    float rate_val = (float)rate->valuedouble;
    if (rate_val <= 0.0f) {
        cJSON_Delete(json);
        http_send_error(req, 422, "VALIDATION_FAILED", "rateMlPerSec must be positive", NULL);
        return ESP_FAIL;
    }

    calibration_mgr_set_rate_ml_per_sec(pump, rate_val);
    cJSON_Delete(json);

    cJSON *resp_data = cJSON_CreateObject();
    cJSON_AddStringToObject(resp_data, "status", "ok");
    cJSON_AddStringToObject(resp_data, "componentId", comp_id->valuestring);
    cJSON_AddNumberToObject(resp_data, "rateMlPerSec", rate_val);
    return http_send_enveloped_response(req, 200, NULL, resp_data);
}

static esp_err_t api_calibration_get_rate_handler(httpd_req_t *req)
{
    float rate_a = calibration_mgr_get_rate_ml_per_sec(ACTUATOR_DOSING_A);
    float rate_b = calibration_mgr_get_rate_ml_per_sec(ACTUATOR_DOSING_B);

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddNumberToObject(resp, "rateDosingAMlSec", rate_a);
    cJSON_AddNumberToObject(resp, "rateDosingBMlSec", rate_b);
    return http_send_enveloped_response(req, 200, NULL, resp);
}

void register_api_calibration_handlers(httpd_handle_t server)
{
    httpd_uri_t start_uri = {
        .uri       = "/api/v1/calibration",
        .method    = HTTP_POST,
        .handler   = api_calibration_start_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &start_uri);
    
    httpd_uri_t status_uri = {
        .uri       = "/api/v1/calibration/status",
        .method    = HTTP_GET,
        .handler   = api_calibration_status_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &status_uri);

    httpd_uri_t set_rate_uri = {
        .uri       = "/api/v1/calibration/rate",
        .method    = HTTP_POST,
        .handler   = api_calibration_set_rate_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &set_rate_uri);

    httpd_uri_t get_rate_uri = {
        .uri       = "/api/v1/calibration/rate",
        .method    = HTTP_GET,
        .handler   = api_calibration_get_rate_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &get_rate_uri);
}
