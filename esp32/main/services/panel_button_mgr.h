#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize panel button event manager and 5-minute manual timers.
 *
 * Configures:
 * - Button 1 (GPIO 0): Cycles TFT Display screens.
 * - Button 2 (GPIO 39): Well Pump manual toggle with 5-minute auto-timeout.
 * - Button 3 (GPIO 40): RETIRED; GPIO 40 is Mixing Pump Relay IN4.
 * - Button 4 (GPIO 41): RESERVED.
 *
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t panel_button_mgr_init(void);

/**
 * @brief Check if Well Pump is currently in manual timer mode.
 */
bool panel_button_is_well_pump_manual_active(void);

/**
 * @brief Get remaining manual seconds on Well Pump timer (0 if inactive).
 */
uint32_t panel_button_get_well_pump_remaining_sec(void);

#ifdef __cplusplus
}
#endif
