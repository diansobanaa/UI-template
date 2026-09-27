#pragma once

#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Register canonical recipe storage endpoints on HTTP server.
 *
 * Endpoints:
 *  - GET    /api/v1/recipes
 *  - POST   /api/v1/recipes
 *  - GET    /api/v1/recipes/{id}
 *  - PUT    /api/v1/recipes/{id}
 *  - DELETE /api/v1/recipes/{id}
 */
void register_api_recipe_handlers(httpd_handle_t server);

#ifdef __cplusplus
}
#endif
