#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize and start the background safety monitor task.
 */
esp_err_t safety_monitor_init(void);

/**
 * @brief Check if any safety fault is active.
 */
bool safety_monitor_has_fault(void);

#ifdef __cplusplus
}
#endif
