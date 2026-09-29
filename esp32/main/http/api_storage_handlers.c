#include "http/api_storage_handlers.h"
#include "http/http_server.h"
#include "hal/sdcard_hal.h"
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

    sdcard_card_info_t info;
    sdcard_hal_get_card_info(&info);

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

/* Format result stored by the background task so the status endpoint
 * can report success/failure after format completes. */
static volatile int s_format_result = -1; /* -1 = no result, 0 = OK, >0 = error */
static volatile bool s_format_running = false;

static void format_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "Format task started on dedicated stack.");
    esp_err_t ret = sdcard_hal_format_fat32();
    s_format_result = (ret == ESP_OK) ? 0 : (int)ret;
    s_format_running = false;
    ESP_LOGI(TAG, "Format task finished: %s (0x%x)", esp_err_to_name(ret), (int)ret);
    vTaskDelete(NULL);
}

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
    sdcard_card_info_t info;
    sdcard_hal_get_card_info(&info);

    if (info.format_in_progress || s_format_running) {
        return http_send_error(req, 409, "FORMAT_IN_PROGRESS",
                               "A format operation is already running.", req_id_ptr);
    }

    if (!info.detected) {
        return http_send_error(req, 503, "CARD_NOT_DETECTED",
                               "No MicroSD card detected. Insert card and retry.", req_id_ptr);
    }

    if (!info.mounted) {
        return http_send_error(req, 503, "CARD_NOT_MOUNTED",
                               "Card detected but filesystem not mounted. "
                               "Card may need physical reinsertion.", req_id_ptr);
    }

    /* Launch format in a dedicated task with sufficient stack.
     * The HTTP handler returns 202 Accepted immediately;
     * the client polls GET /api/v1/storage/status to track progress. */
    s_format_result = -1;
    s_format_running = true;

    BaseType_t created = xTaskCreate(format_task, "sd_fmt", 4096, NULL, 3, NULL);
    if (created != pdPASS) {
        s_format_running = false;
        return http_send_error(req, 503, "TASK_CREATE_FAILED",
                               "Cannot start format task (insufficient memory).", req_id_ptr);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "status", "FORMATTING");
    cJSON_AddStringToObject(root, "message",
        "Format started. Poll GET /api/v1/storage/status to track progress.");
    return http_send_enveloped_response(req, 202, req_id_ptr, root);
}

/* ---------- GET /api/v1/storage/format/result ---------- */

static esp_err_t handler_get_format_result(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    sdcard_card_info_t info;
    sdcard_hal_get_card_info(&info);

    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "formatInProgress", info.format_in_progress || s_format_running);

    if (s_format_result == -1) {
        cJSON_AddNullToObject(root, "result");
        cJSON_AddStringToObject(root, "status",
            (info.format_in_progress || s_format_running) ? "FORMATTING" : "IDLE");
    } else if (s_format_result == 0) {
        cJSON_AddStringToObject(root, "result", "SUCCESS");
        cJSON_AddStringToObject(root, "status", "FORMAT_SUCCESS");
        cJSON_AddBoolToObject(root, "mounted", info.mounted);
        cJSON_AddNumberToObject(root, "capacityMb", (double)info.capacity_mb);
    } else {
        cJSON_AddStringToObject(root, "result", "FAILED");
        cJSON_AddStringToObject(root, "status", "FORMAT_FAILED");
        char err_buf[32];
        snprintf(err_buf, sizeof(err_buf), "0x%x", s_format_result);
        cJSON_AddStringToObject(root, "errorCode", err_buf);
    }

    return http_send_enveloped_response(req, 200, NULL, root);
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

    ESP_LOGI(TAG, "Registered Storage API endpoints (/api/v1/storage/*)");
}
