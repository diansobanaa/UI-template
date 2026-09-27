#pragma once

#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

/* REST Telemetry Handlers */
esp_err_t handler_get_telemetry_current(httpd_req_t *req);
esp_err_t handler_get_telemetry_history(httpd_req_t *req);
esp_err_t handler_get_telemetry(httpd_req_t *req);
esp_err_t handler_get_events(httpd_req_t *req);

/* WebSocket Telemetry Stream Handler */
esp_err_t handler_telemetry_stream_ws(httpd_req_t *req);

/* Initialize WebSocket Telemetry Streaming worker */
void telemetry_stream_init(httpd_handle_t server);

/* Trigger an immediate snapshot push to all connected WS clients on state transition */
void telemetry_stream_on_transition(const char *reason);

#ifdef __cplusplus
}
#endif
