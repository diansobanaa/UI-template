#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "esp_http_server.h"
#include "cJSON.h"




#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Start the ESP32 REST HTTP server on configured port.
 */
esp_err_t http_server_start(void);

/**
 * @brief Stop the ESP32 REST HTTP server.
 */
esp_err_t http_server_stop(void);

/**
 * @brief Check if the HTTP server is running.
 */
bool http_server_is_running(void);

/** Return the active HTTPD handle for ESP-IDF SoftAP provisioning. */
httpd_handle_t http_server_get_handle(void);

/**
 * @brief Attach standard CORS headers to response.
 */
esp_err_t http_send_cors_headers(httpd_req_t *req);

/**
 * @brief Send standard JSON error response matching ErrorResponse schema.
 */
esp_err_t http_send_error(httpd_req_t *req, int status_code, const char *code, const char *message, const char *request_id);

/**
 * @brief Send cJSON response, automatically adding CORS headers and freeing the JSON object.
 */
esp_err_t http_send_json_response(httpd_req_t *req, int status_code, cJSON *json_root);

/**
 * @brief Send EnvelopeBase wrapped JSON response, extracting X-Request-ID and system time.
 */
esp_err_t http_send_enveloped_response(httpd_req_t *req, int status_code, const char *req_id, cJSON *data_payload);

/**
 * @brief Read and parse incoming HTTP JSON body.
 */
esp_err_t http_parse_json_body(httpd_req_t *req, cJSON **out_json);


/**
 * @brief Auth check for the public API surface.
 *
 * Per PRD-NET-001 / ESP32_BACKEND_SPEC §8 / §39 (Explicit Non-Goal): the MVP
 * runs on a trusted local network without authentication. This function is
 * intentionally a no-op and exists only so legacy handler code that calls
 * `if (http_check_auth(req) != ESP_OK) return ESP_FAIL;` keeps compiling
 * without altering its control flow.
 *
 * Routes that genuinely require peer authentication (topology-pool /sync and
 * /mutate) must call http_check_auth_peer() instead.
 */
esp_err_t http_check_auth(httpd_req_t *req);

/**
 * @brief Peer auth check for topology-pool mutations only.
 *
 * Validates the Bearer token in the Authorization header against the NVS
 * stored "api_key" (provisioned via /setup embedded web UI). Returns ESP_OK
 * if valid, or sends 401/503 and returns ESP_FAIL. There is NO default token
 * — if api_key is not provisioned, peer mutation is rejected with 503
 * SERVICE_UNAVAILABLE so the operator knows to complete provisioning.
 */
esp_err_t http_check_auth_peer(httpd_req_t *req);

#ifdef __cplusplus
}
#endif
