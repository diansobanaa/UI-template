#include "http/http_server.h"
#include "http/api_device_handlers.h"
#include "config/system_config.h"
#include "esp_log.h"
#include <string.h>
#include <stdlib.h>

static const char *TAG = "HTTP_SERVER";
static httpd_handle_t s_server = NULL;


#include "nvs_flash.h"
#include "nvs.h"

esp_err_t http_check_auth(httpd_req_t *req)
{
    char buf[128];
    esp_err_t err = httpd_req_get_hdr_value_str(req, "Authorization", buf, sizeof(buf));
    if (err != ESP_OK) {
        http_send_error(req, 401, "UNAUTHORIZED", "Missing Authorization header", NULL);
        return ESP_FAIL;
    }

    if (strncmp(buf, "Bearer ", 7) != 0) {
        http_send_error(req, 401, "UNAUTHORIZED", "Invalid token format", NULL);
        return ESP_FAIL;
    }

    const char *token = buf + 7;
    char stored_token[64] = "agrotech-secret-key"; // Default token

    nvs_handle_t handle;
    if (nvs_open("agrotech", NVS_READONLY, &handle) == ESP_OK) {
        size_t len = sizeof(stored_token);
        nvs_get_str(handle, "api_key", stored_token, &len);
        nvs_close(handle);
    }

    if (strcmp(token, stored_token) != 0) {
        http_send_error(req, 401, "UNAUTHORIZED", "Invalid API key", NULL);
        return ESP_FAIL;
    }

    return ESP_OK;
}
\nesp_err_t http_send_cors_headers(httpd_req_t *req)
{
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, Accept");
    httpd_resp_set_hdr(req, "Access-Control-Max-Age", "86400");
    return ESP_OK;
}

esp_err_t handler_options_preflight(httpd_req_t *req)
{
    http_send_cors_headers(req);
    httpd_resp_set_status(req, "204 No Content");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

esp_err_t http_send_error(httpd_req_t *req, int status_code, const char *code, const char *message, const char *request_id)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "code", code ? code : "INTERNAL_ERROR");
    cJSON_AddStringToObject(root, "message", message ? message : "An error occurred");
    if (request_id) {
        cJSON_AddStringToObject(root, "requestId", request_id);
    }

    return http_send_json_response(req, status_code, root);
}

esp_err_t http_send_json_response(httpd_req_t *req, int status_code, cJSON *json_root)
{
    http_send_cors_headers(req);
    httpd_resp_set_type(req, "application/json");

    char status_str[32];
    snprintf(status_str, sizeof(status_str), "%d %s", status_code,
             status_code == 200 ? "OK" :
             status_code == 201 ? "Created" :
             status_code == 202 ? "Accepted" :
             status_code == 204 ? "No Content" :
             status_code == 400 ? "Bad Request" :
             status_code == 404 ? "Not Found" :
             status_code == 409 ? "Conflict" :
             status_code == 422 ? "Unprocessable Entity" : "Error");
    httpd_resp_set_status(req, status_str);

    char *rendered = cJSON_PrintUnformatted(json_root);
    cJSON_Delete(json_root);

    if (!rendered) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    esp_err_t ret = httpd_resp_send(req, rendered, strlen(rendered));
    free(rendered);
    return ret;
}

esp_err_t http_parse_json_body(httpd_req_t *req, cJSON **out_json)
{
    if (!out_json) return ESP_ERR_INVALID_ARG;
    *out_json = NULL;

    size_t total_len = req->content_len;
    if (total_len == 0) return ESP_ERR_INVALID_SIZE;
    if (total_len > 4096) return ESP_ERR_NO_MEM; // SP-REMED-004 Memory Bounds

    char *buf = (char *)malloc(total_len + 1);
    if (!buf) return ESP_ERR_NO_MEM;

    int received = 0;
    while (received < total_len) {
        int r = httpd_req_recv(req, buf + received, total_len - received);
        if (r <= 0) {
            free(buf);
            return ESP_FAIL;
        }
        received += r;
    }
    buf[total_len] = '\0';

    cJSON *parsed = cJSON_Parse(buf);
    free(buf);

    if (!parsed) {
        return ESP_ERR_INVALID_ARG;
    }

    *out_json = parsed;
    return ESP_OK;
}

esp_err_t http_server_start(void)
{
    if (s_server) return ESP_OK;

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = DEFAULT_HTTP_PORT;
    config.max_uri_handlers = 32;
    config.stack_size = TASK_HTTP_SERVER_STACK;
    config.uri_match_fn = httpd_uri_match_wildcard;

    ESP_LOGI(TAG, "Starting HTTP Server on port %d...", config.server_port);
    esp_err_t ret = httpd_start(&s_server, &config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server (0x%x)", ret);
        return ret;
    }

    /* ---------------- Register All Canonical Routes ---------------- */

    /* Universal OPTIONS handler for CORS preflight */
    httpd_uri_t uri_options = { .uri = "/api/*", .method = HTTP_OPTIONS, .handler = handler_options_preflight, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_options);

    /* Device / System */
    httpd_uri_t uri_health = { .uri = "/api/v1/health", .method = HTTP_GET, .handler = handler_get_health, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_health);

    httpd_uri_t uri_status = { .uri = "/api/v1/status", .method = HTTP_GET, .handler = handler_get_status, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_status);

    httpd_uri_t uri_inv = { .uri = "/api/v1/inventory", .method = HTTP_GET, .handler = handler_get_inventory, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_inv);

    httpd_uri_t uri_cap = { .uri = "/api/v1/capabilities", .method = HTTP_GET, .handler = handler_get_capabilities, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cap);

    httpd_uri_t uri_ctx = { .uri = "/api/v1/context", .method = HTTP_GET, .handler = handler_get_context, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_ctx);

    httpd_uri_t uri_clock_get = { .uri = "/api/v1/clock", .method = HTTP_GET, .handler = handler_get_clock, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_clock_get);

    httpd_uri_t uri_clock_sync = { .uri = "/api/v1/clock-sync", .method = HTTP_POST, .handler = handler_post_clock_sync, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_clock_sync);

    /* Configuration */
    httpd_uri_t uri_cfg_get = { .uri = "/api/v1/configuration", .method = HTTP_GET, .handler = handler_get_configuration, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cfg_get);

    httpd_uri_t uri_cfg_put = { .uri = "/api/v1/configuration", .method = HTTP_PUT, .handler = handler_put_configuration, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cfg_put);

    httpd_uri_t uri_cfg_val = { .uri = "/api/v1/configuration/validate", .method = HTTP_POST, .handler = handler_validate_configuration, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cfg_val);

    /* Commands */
    httpd_uri_t uri_cmd_post = { .uri = "/api/v1/commands", .method = HTTP_POST, .handler = handler_post_command, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cmd_post);

    httpd_uri_t uri_cmd_estop = { .uri = "/api/v1/commands/emergency-stop", .method = HTTP_POST, .handler = handler_emergency_stop, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cmd_estop);

    httpd_uri_t uri_cmd_get = { .uri = "/api/v1/commands/*", .method = HTTP_GET, .handler = handler_get_command, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cmd_get);

    httpd_uri_t uri_cmd_del = { .uri = "/api/v1/commands/*", .method = HTTP_DELETE, .handler = handler_delete_command, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cmd_del);

    /* Telemetry & Events */
    httpd_uri_t uri_telemetry = { .uri = "/api/v1/telemetry", .method = HTTP_GET, .handler = handler_get_telemetry, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_telemetry);

    httpd_uri_t uri_events = { .uri = "/api/v1/events", .method = HTTP_GET, .handler = handler_get_events, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_events);

    /* Crop Cycle Routes */
    httpd_uri_t uri_cc_get = { .uri = "/api/v1/greenhouses/*/crop-cycle", .method = HTTP_GET, .handler = handler_get_crop_cycle, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_get);

    httpd_uri_t uri_cc_import = { .uri = "/api/v1/greenhouses/*/crop-cycles/import-active", .method = HTTP_POST, .handler = handler_import_active_crop_cycle, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_import);

    httpd_uri_t uri_cc_list = { .uri = "/api/v1/greenhouses/*/crop-cycles", .method = HTTP_GET, .handler = handler_list_crop_cycles, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_list);

    httpd_uri_t uri_cc_start = { .uri = "/api/v1/greenhouses/*/crop-cycles", .method = HTTP_POST, .handler = handler_start_crop_cycle, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_start);

    httpd_uri_t uri_cc_poll_post = { .uri = "/api/v1/greenhouses/*/crop-cycles/*/pollination", .method = HTTP_POST, .handler = handler_record_pollination, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_poll_post);

    httpd_uri_t uri_cc_poll_patch = { .uri = "/api/v1/greenhouses/*/crop-cycles/*/pollination", .method = HTTP_PATCH, .handler = handler_update_pollination, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_poll_patch);

    httpd_uri_t uri_cc_poll_del = { .uri = "/api/v1/greenhouses/*/crop-cycles/*/pollination", .method = HTTP_DELETE, .handler = handler_delete_pollination, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_poll_del);

    httpd_uri_t uri_cc_plant_patch = { .uri = "/api/v1/greenhouses/*/crop-cycles/*/planting-date", .method = HTTP_PATCH, .handler = handler_update_planting_date, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_plant_patch);

    httpd_uri_t uri_cc_meta_patch = { .uri = "/api/v1/greenhouses/*/crop-cycles/*", .method = HTTP_PATCH, .handler = handler_update_cycle_metadata, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_meta_patch);

    httpd_uri_t uri_cc_cancel = { .uri = "/api/v1/greenhouses/*/crop-cycles/*/cancel", .method = HTTP_POST, .handler = handler_cancel_crop_cycle, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_cancel);

    httpd_uri_t uri_cc_harvest = { .uri = "/api/v1/greenhouses/*/crop-cycles/*/harvest", .method = HTTP_POST, .handler = handler_harvest_crop_cycle, .user_ctx = NULL };
    httpd_register_uri_handler(s_server, &uri_cc_harvest);

    ESP_LOGI(TAG, "HTTP Server successfully started with all canonical OpenAPI routes registered.");
    return ESP_OK;
}

esp_err_t http_server_stop(void)
{
    if (s_server) {
        httpd_stop(s_server);
        s_server = NULL;
    }
    return ESP_OK;
}

bool http_server_is_running(void)
{
    return (s_server != NULL);
}
