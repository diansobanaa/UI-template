#include "http/api_storage_handlers.h"
#include "http/http_server.h"
#include "hal/microsd_hal.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "cJSON.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "API_STORAGE";

extern esp_err_t http_check_auth(httpd_req_t *req);

/* ---------- GET /api/v1/storage/status ---------- */

static esp_err_t handler_get_storage_status(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    microsd_card_info_t info;
    microsd_hal_get_card_info(&info);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "detected", info.detected);
    cJSON_AddBoolToObject(root, "mounted", info.mounted);
    cJSON_AddBoolToObject(root, "formatInProgress", info.format_in_progress);
    cJSON_AddNumberToObject(root, "capacityMb", (double)info.capacity_mb);
    cJSON_AddNumberToObject(root, "capacityGb", (double)(info.capacity_mb / 1024));
    if (info.detected && info.card_name[0]) {
        cJSON_AddStringToObject(root, "cardName", info.card_name);
    } else {
        cJSON_AddNullToObject(root, "cardName");
    }

    const char *status = "NOT_DETECTED";
    if (info.format_in_progress) {
        status = "FORMATTING";
    } else if (info.mounted) {
        status = "READY";
    } else if (info.detected) {
        status = "DETECTED_NOT_MOUNTED";
    }
    cJSON_AddStringToObject(root, "status", status);

    return http_send_enveloped_response(req, 200, NULL, root);
}

/* ---------- POST /api/v1/storage/format ---------- */

static esp_err_t handler_post_storage_format(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    /* Parse body for confirmation flag */
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED",
                               "JSON body with confirm:true required", NULL);
    }

    char req_id[64] = "";
    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    if (rq && cJSON_IsString(rq)) {
        snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
    }
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    /* Extract confirm from payload envelope or top level */
    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    cJSON *confirm_src = payload ? payload : body;
    cJSON *confirm = cJSON_GetObjectItem(confirm_src, "confirm");

    if (!confirm || !cJSON_IsBool(confirm) || !cJSON_IsTrue(confirm)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "CONFIRMATION_REQUIRED",
                               "Set confirm:true in payload to format. "
                               "This will ERASE ALL DATA on the MicroSD card.", req_id_ptr);
    }
    cJSON_Delete(body);

    /* Check card state */
    microsd_card_info_t info;
    microsd_hal_get_card_info(&info);

    if (info.format_in_progress) {
        return http_send_error(req, 409, "FORMAT_IN_PROGRESS",
                               "A format operation is already running.", req_id_ptr);
    }

    /* Request runtime format via HAL (runs in background FreeRTOS task, zero reboot) */
    esp_err_t ret = microsd_hal_format_fat32();
    if (ret != ESP_OK) {
        return http_send_error(req, 500, "FORMAT_FAILED",
                               "Failed to initiate MicroSD card format.", req_id_ptr);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "status", "FORMATTING");
    cJSON_AddStringToObject(root, "message",
        "MicroSD FAT32 format initiated in background task. Poll /api/v1/storage/format/result for completion.");
    return http_send_enveloped_response(req, 202, req_id_ptr, root);
}

/* ---------- GET /api/v1/storage/format/result ---------- */

static esp_err_t handler_get_format_result(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    microsd_card_info_t info;
    microsd_hal_get_card_info(&info);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "formatInProgress", info.format_in_progress);

    if (info.format_in_progress) {
        cJSON_AddNullToObject(root, "result");
        cJSON_AddStringToObject(root, "status", "FORMATTING");
    } else if (strcmp(info.last_format_result, "FAILED") == 0) {
        cJSON_AddStringToObject(root, "result", "FAILED");
        cJSON_AddStringToObject(root, "status", "FORMAT_FAILED");
        cJSON_AddStringToObject(root, "errorCode", info.last_format_error[0] ? info.last_format_error : "VERIFICATION_FAILED");
        cJSON_AddBoolToObject(root, "mounted", info.mounted);
    } else if (info.mounted) {
        cJSON_AddStringToObject(root, "result", "SUCCESS");
        cJSON_AddStringToObject(root, "status", "FORMAT_SUCCESS");
        cJSON_AddBoolToObject(root, "mounted", true);
        cJSON_AddNumberToObject(root, "capacityMb", (double)info.capacity_mb);
    } else if (info.detected) {
        cJSON_AddNullToObject(root, "result");
        cJSON_AddStringToObject(root, "status", "IDLE");
    } else {
        cJSON_AddStringToObject(root, "result", "FAILED");
        cJSON_AddStringToObject(root, "status", "CARD_NOT_DETECTED");
    }

    return http_send_enveloped_response(req, 200, NULL, root);
}

/* ---------- GET /api/v1/storage/test ---------- */

static esp_err_t handler_get_storage_test(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    char log_buf[256] = {0};
    esp_err_t test_ret = microsd_hal_test_file_io(log_buf, sizeof(log_buf));

    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "success", test_ret == ESP_OK);
    cJSON_AddStringToObject(root, "result", test_ret == ESP_OK ? "PASS" : "FAIL");
    cJSON_AddStringToObject(root, "log", log_buf);

    return http_send_enveloped_response(req, test_ret == ESP_OK ? 200 : 500, NULL, root);
}

/* ---------- Registration ---------- */

void register_api_storage_handlers(httpd_handle_t server)
{
    httpd_uri_t uri_status = {
        .uri = "/api/v1/storage/status",
        .method = HTTP_GET,
        .handler = handler_get_storage_status,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_status);

    httpd_uri_t uri_format = {
        .uri = "/api/v1/storage/format",
        .method = HTTP_POST,
        .handler = handler_post_storage_format,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_format);

    httpd_uri_t uri_format_result = {
        .uri = "/api/v1/storage/format/result",
        .method = HTTP_GET,
        .handler = handler_get_format_result,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_format_result);

    httpd_uri_t uri_test = {
        .uri = "/api/v1/storage/test",
        .method = HTTP_GET,
        .handler = handler_get_storage_test,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_test);

    ESP_LOGI(TAG, "Registered Storage API endpoints (/api/v1/storage/*)");
}
