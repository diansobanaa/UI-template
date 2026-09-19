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
 * @brief Record an operational event with explicit Complex/GH/component/resource/configuration context.
 */
esp_err_t event_mgr_log_context(event_level_t level, const char *category, const char *code, const char *message,
                                const char *complex_id, const char *gh_id, const char *component_id,
                                const char *resource_id, uint32_t configuration_version);

/**
 * @brief Record a command/safety event with traceable command, target, resource and configuration context.
 */
esp_err_t event_mgr_log_command(event_level_t level, const char *code, const char *message,
                                const char *command_id, const char *complex_id, const char *gh_id,
                                const char *component_id, const char *resource_id, uint32_t configuration_version);

/**
 * @brief Get paginated events JSON object matching OpenAPI EventResponse.
 */
cJSON *event_mgr_get_events_json(const char *cursor, int limit);

#ifdef __cplusplus
}
#endif
