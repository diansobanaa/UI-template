#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    LOG_LEVEL_INFO = 0,
    LOG_LEVEL_WARNING,
    LOG_LEVEL_ERROR,
    LOG_LEVEL_CRITICAL
} event_level_t;

/**
 * @brief Initialize event manager.
 */
esp_err_t event_mgr_init(void);

/**
 * @brief Record and persist a structured system event.
 */
esp_err_t event_mgr_log(event_level_t level, const char *category, const char *code, const char *message, const char *component_id);

/**
 * @brief Get paginated events JSON object matching OpenAPI EventResponse.
 */
cJSON *event_mgr_get_events_json(const char *cursor, int limit);

#ifdef __cplusplus
}
#endif
