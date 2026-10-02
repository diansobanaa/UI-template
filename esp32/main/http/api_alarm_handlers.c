#include "http/api_alarm_handlers.h"
#include "http/http_server.h"
#include "services/alarm_mgr.h"
#include "esp_log.h"
#include "cJSON.h"
#include <string.h>

static const char *TAG = "api_alarms";

esp_err_t handler_get_alarms(httpd_req_t *req) {
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    cJSON *root = alarm_mgr_get_status_json();
    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_post_alarm_acknowledge(httpd_req_t *req) {
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    char alarm_id_buf[48] = {0};
    cJSON *body = NULL;
    if (req->content_len > 0 && http_parse_json_body(req, &body) == ESP_OK && body) {
        cJSON *payload = cJSON_GetObjectItem(body, "payload");
        cJSON *target = (payload && cJSON_IsObject(payload)) ? payload : body;
        cJSON *id_item = cJSON_GetObjectItem(target, "alarmId");
        if (!id_item) id_item = cJSON_GetObjectItem(target, "alarm_id");
        if (id_item && cJSON_IsString(id_item) && id_item->valuestring) {
            strncpy(alarm_id_buf, id_item->valuestring, sizeof(alarm_id_buf) - 1);
        }
        cJSON_Delete(body);
    }

    esp_err_t err = alarm_mgr_acknowledge(alarm_id_buf[0] ? alarm_id_buf : NULL);
    (void)err;

    cJSON *root = alarm_mgr_get_status_json();
    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_post_alarm_silence(httpd_req_t *req) {
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    bool silence = true;
    cJSON *body = NULL;
    if (req->content_len > 0 && http_parse_json_body(req, &body) == ESP_OK && body) {
        cJSON *payload = cJSON_GetObjectItem(body, "payload");
        cJSON *target = (payload && cJSON_IsObject(payload)) ? payload : body;
        cJSON *silence_item = cJSON_GetObjectItem(target, "silence");
        if (silence_item && cJSON_IsBool(silence_item)) {
            silence = cJSON_IsTrue(silence_item);
        }
        cJSON_Delete(body);
    }

    esp_err_t err = alarm_mgr_silence(silence);
    (void)err;

    cJSON *root = alarm_mgr_get_status_json();
    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_post_alarm_test(httpd_req_t *req) {
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    uint32_t duration_ms = 800;
    cJSON *body = NULL;
    if (req->content_len > 0 && http_parse_json_body(req, &body) == ESP_OK && body) {
        cJSON *payload = cJSON_GetObjectItem(body, "payload");
        cJSON *target = (payload && cJSON_IsObject(payload)) ? payload : body;
        cJSON *dur_item = cJSON_GetObjectItem(target, "durationMs");
        if (!dur_item) dur_item = cJSON_GetObjectItem(target, "duration_ms");
        if (dur_item && cJSON_IsNumber(dur_item) && dur_item->valueint > 0) {
            duration_ms = (uint32_t)dur_item->valueint;
        }
        cJSON_Delete(body);
    }

    esp_err_t err = alarm_mgr_trigger_test(duration_ms);
    if (err == ESP_ERR_INVALID_STATE) {
        return http_send_error(
            req, 409, "SAFETY_ALARM_ACTIVE",
            "Cannot run manual buzzer test while safety alarms are active", NULL
        );
    }

    cJSON *root = alarm_mgr_get_status_json();
    return http_send_enveloped_response(req, 200, NULL, root);
}

void register_api_alarm_handlers(httpd_handle_t server) {
    if (!server) return;

    httpd_uri_t uri_get_alarms = {
        .uri = "/api/v1/alarms",
        .method = HTTP_GET,
        .handler = handler_get_alarms,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_get_alarms);

    httpd_uri_t uri_ack_alarms = {
        .uri = "/api/v1/alarms/acknowledge",
        .method = HTTP_POST,
        .handler = handler_post_alarm_acknowledge,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_ack_alarms);

    httpd_uri_t uri_silence_alarms = {
        .uri = "/api/v1/alarms/silence",
        .method = HTTP_POST,
        .handler = handler_post_alarm_silence,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_silence_alarms);

    httpd_uri_t uri_test_alarm = {
        .uri = "/api/v1/alarms/test",
        .method = HTTP_POST,
        .handler = handler_post_alarm_test,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_test_alarm);

    ESP_LOGI(TAG, "Registered /api/v1/alarms endpoints (GET, acknowledge, silence, test)");
}
