#pragma once

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @file sdcard_hal.h
 * @brief Hardware Abstraction Layer for SD Card Slot on the back of TFT ST7735 display.
 *
 * Signal Mapping (Shared SPI2_HOST Bus):
 *  - SD_SCK  -> GPIO 11 (Shared with TFT SCK)
 *  - SD_MOSI -> GPIO 12 (Shared with TFT MOSI/SDA)
 *  - SD_MISO -> GPIO 13 (Dedicated SPI MISO)
 *  - SD_CS   -> GPIO 48 (Dedicated Chip Select)
 */

/**
 * @brief Initialize SD card SPI driver on TFT onboard slot (CS GPIO 48).
 * Non-blocking / fail-safe: if SD card is not present, falls back gracefully to degraded mode.
 */
esp_err_t sdcard_hal_init(void);

/**
 * @brief Check if microSD card is currently mounted.
 */
bool sdcard_hal_is_mounted(void);

/**
 * @brief Lock microSD access (FreeRTOS mutex).
 */
void sdcard_hal_lock(void);

/**
 * @brief Unlock microSD access.
 */
void sdcard_hal_unlock(void);

#ifdef __cplusplus
}
#endif
