#include "http/api_export_handlers.h"
#include "http/http_server.h"
#include "storage/export_mgr.h"
#include "hal/sdcard_hal.h"
#include "cJSON.h"
#include "esp_log.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

static const char *TAG = "API_EXPORT";

extern esp_err_t http_check_auth(httpd_req_t *req);

static esp_err_t get_capabilities_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    cJSON *caps = export_mgr_get_capabilities();
    return http_send_enveloped_response(req, 200, NULL, caps);
}

static esp_err_t post_jobs_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    if (!sdcard_hal_is_mounted()) {
        return http_send_error(req, 503, "STORAGE_UNAVAILABLE",
                               "MicroSD card is absent or unmounted; historical export is unavailable", NULL);
    }

    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON body", NULL);
    }

    char req_id[64] = "";
    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    const cJSON *job_req = payload ? payload : body;

    export_job_t job;
    err = export_mgr_create_job(job_req, &job);
    cJSON_Delete(body);

    if (err == ESP_ERR_INVALID_ARG) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing or invalid dataset in export request", req_id_ptr);
    } else if (err != ESP_OK) {
        return http_send_error(req, 500, "EXPORT_CREATION_FAILED", "Failed to initialize export job on SD storage", req_id_ptr);
    }

    cJSON *manifest = export_mgr_get_manifest(job.export_id);
    return http_send_enveloped_response(req, 201, req_id_ptr, manifest);
}

/* Parses /api/v1/export/jobs/<exportId>/[manifest|data|ack] */
static bool parse_job_uri(const char *uri, char *export_id, size_t max_id, char *action, size_t max_action)
{
    const char *prefix = "/api/v1/export/jobs/";
    if (strncmp(uri, prefix, strlen(prefix)) != 0) return false;
    const char *p = uri + strlen(prefix);
    const char *slash = strchr(p, '/');

    if (!slash) {
        /* /api/v1/export/jobs/<exportId> */
        const char *q = strchr(p, '?');
        size_t len = q ? (size_t)(q - p) : strlen(p);
        if (len >= max_id) len = max_id - 1;
        strncpy(export_id, p, len);
        export_id[len] = '\0';
        action[0] = '\0';
        return true;
    }

    size_t id_len = (size_t)(slash - p);
    if (id_len >= max_id) id_len = max_id - 1;
    strncpy(export_id, p, id_len);
    export_id[id_len] = '\0';

    const char *act_start = slash + 1;
    const char *q = strchr(act_start, '?');
    size_t act_len = q ? (size_t)(q - act_start) : strlen(act_start);
    if (act_len >= max_action) act_len = max_action - 1;
    strncpy(action, act_start, act_len);
    action[act_len] = '\0';
    return true;
}

static esp_err_t get_job_dispatcher_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    char export_id[48] = "";
    char action[32] = "";
    if (!parse_job_uri(req->uri, export_id, sizeof(export_id), action, sizeof(action))) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid export job URI", NULL);
    }

    if (!sdcard_hal_is_mounted()) {
        return http_send_error(req, 503, "STORAGE_UNAVAILABLE", "MicroSD card unmounted", NULL);
    }

    export_job_t job;
    esp_err_t err = export_mgr_get_job(export_id, &job);
    if (err != ESP_OK) {
        return http_send_error(req, 404, "NOT_FOUND", "Export job not found", NULL);
    }

    if (strcmp(action, "manifest") == 0) {
        cJSON *manifest = export_mgr_get_manifest(export_id);
        return http_send_enveloped_response(req, 200, NULL, manifest);
    }

    if (strcmp(action, "data") == 0) {
        uint32_t chunk_idx = 0;
        size_t chunk_sz = EXPORT_DEFAULT_CHUNK_BYTES;

        char query[128] = "";
        if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
            char val[32];
            if (httpd_query_key_value(query, "chunk", val, sizeof(val)) == ESP_OK) {
                chunk_idx = (uint32_t)atoi(val);
            }
            if (httpd_query_key_value(query, "chunkSize", val, sizeof(val)) == ESP_OK) {
                chunk_sz = (size_t)atoi(val);
            }
        }

        char *buf = malloc(EXPORT_MAX_CHUNK_BYTES);
        if (!buf) {
            return http_send_error(req, 500, "NO_MEMORY", "Insufficient RAM for chunk buffer", NULL);
        }

        size_t out_len = 0;
        bool is_last = false;
        uint32_t chunk_crc = 0;

        err = export_mgr_read_chunk(export_id, chunk_idx, chunk_sz, buf, EXPORT_MAX_CHUNK_BYTES,
                                    &out_len, &is_last, &chunk_crc);
        if (err != ESP_OK) {
            free(buf);
            return http_send_error(req, 500, "CHUNK_READ_FAILED", "Failed to read chunk from SD", NULL);
        }

        cJSON *resp = cJSON_CreateObject();
        cJSON_AddStringToObject(resp, "exportId", export_id);
        cJSON_AddNumberToObject(resp, "chunkIndex", chunk_idx);
        cJSON_AddNumberToObject(resp, "chunkBytes", (double)out_len);
        cJSON_AddBoolToObject(resp, "isLastChunk", is_last);
        cJSON_AddNumberToObject(resp, "chunkChecksumCrc32", chunk_crc);

        /* Wrap text/json content */
        buf[out_len] = '\0';
        cJSON *data_parsed = cJSON_Parse(buf);
        if (data_parsed) {
            cJSON_AddItemToObject(resp, "data", data_parsed);
        } else {
            cJSON_AddStringToObject(resp, "rawPayload", buf);
        }
        free(buf);

        return http_send_enveloped_response(req, 200, NULL, resp);
    }

    /* Base job status: /api/v1/export/jobs/<exportId> */
    cJSON *manifest = export_mgr_get_manifest(export_id);
    return http_send_enveloped_response(req, 200, NULL, manifest);
}

static esp_err_t post_job_ack_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    char export_id[48] = "";
    char action[32] = "";
    if (!parse_job_uri(req->uri, export_id, sizeof(export_id), action, sizeof(action)) || strcmp(action, "ack") != 0) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid ACK endpoint URI", NULL);
    }

    if (!sdcard_hal_is_mounted()) {
        return http_send_error(req, 503, "STORAGE_UNAVAILABLE", "MicroSD card unmounted", NULL);
    }

    cJSON *body = NULL;
    http_parse_json_body(req, &body);

    char req_id[64] = "";
    if (body) {
        cJSON *rq = cJSON_GetObjectItem(body, "requestId");
        if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
        cJSON_Delete(body);
    }
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    size_t del_records = 0;
    size_t del_bytes = 0;
    esp_err_t err = export_mgr_ack_job(export_id, &del_records, &del_bytes);
    if (err == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Export job not found", req_id_ptr);
    } else if (err != ESP_OK) {
        return http_send_error(req, 500, "ACK_FAILED", "Failed to commit export acknowledgement and deletion", req_id_ptr);
    }

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddStringToObject(resp, "exportId", export_id);
    cJSON_AddStringToObject(resp, "status", "COMPLETED");
    cJSON_AddNumberToObject(resp, "deletedRecords", (double)del_records);
    cJSON_AddNumberToObject(resp, "deletedBytes", (double)del_bytes);
    cJSON_AddStringToObject(resp, "message", "Historical data successfully deleted following explicit backend ACK.");

    return http_send_enveloped_response(req, 200, req_id_ptr, resp);
}

void register_api_export_handlers(httpd_handle_t server)
{
    httpd_uri_t uri_caps = {
        .uri = "/api/v1/export/capabilities",
        .method = HTTP_GET,
        .handler = get_capabilities_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_caps);

    httpd_uri_t uri_jobs_post = {
        .uri = "/api/v1/export/jobs",
        .method = HTTP_POST,
        .handler = post_jobs_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_jobs_post);

    httpd_uri_t uri_ack_post = {
        .uri = "/api/v1/export/jobs/*/ack",
        .method = HTTP_POST,
        .handler = post_job_ack_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_ack_post);

    httpd_uri_t uri_jobs_get = {
        .uri = "/api/v1/export/jobs/*",
        .method = HTTP_GET,
        .handler = get_job_dispatcher_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &uri_jobs_get);

    ESP_LOGI(TAG, "Registered canonical Export Pipeline endpoints (/api/v1/export/*)");
}
