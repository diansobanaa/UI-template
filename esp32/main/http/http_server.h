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
 * @brief Check Bearer token in Authorization header against NVS stored token.
 * Returns ESP_OK if valid, or sends 401 response and returns ESP_FAIL.
 */
esp_err_t http_check_auth(httpd_req_t *req);

#ifdef __cplusplus
}
#endif
