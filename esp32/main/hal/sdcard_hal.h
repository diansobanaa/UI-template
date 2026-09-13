#pragma once

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize microSD SPI driver on CS GPIO 47.
 * Returns ESP_OK if mounted, or ESP_ERR_NOT_FOUND if card not inserted.
 */
esp_err_t sdcard_hal_init(void);

/**
 * @brief Check if microSD card is currently mounted.
 */
bool sdcard_hal_is_mounted(void);

#ifdef __cplusplus
}
#endif
