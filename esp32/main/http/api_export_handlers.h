#pragma once

#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Register all Export Pipeline API endpoints with the HTTP server.
 * 
 * Routes registered:
 * - GET  /api/v1/export/capabilities
 * - POST /api/v1/export/jobs
 * - GET  /api/v1/export/jobs/{exportId}
 * - POST /api/v1/export/jobs/{exportId}/ack
 */
void register_api_export_handlers(httpd_handle_t server);

#ifdef __cplusplus
}
#endif
