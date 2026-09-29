#pragma once

#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Register MicroSD Storage API endpoints.
 *
 * Routes:
 * - GET  /api/v1/storage/status  — card detection, mount, capacity, format state
 * - POST /api/v1/storage/format  — runtime FAT32 format (requires confirm:true)
 */
void register_api_storage_handlers(httpd_handle_t server);

#ifdef __cplusplus
}
#endif
