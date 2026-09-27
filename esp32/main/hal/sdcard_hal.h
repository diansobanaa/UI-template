#pragma once

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @file sdcard_hal.h
 * @brief Hardware Abstraction Layer for MicroSD Card Adapter Module (EasyWare Part#: EP000094).
 *
 * Signal Mapping (Shared SPI2_HOST Bus):
 *  - SD_SCK  -> GPIO 11 (Shared with TFT SCK)
 *  - SD_MOSI -> GPIO 12 (Shared with TFT MOSI/SDA)
 *  - SD_MISO -> GPIO 13 (Dedicated SPI MISO)
 *  - SD_CS   -> GPIO 48 (Dedicated Chip Select)
 *  - VCC     -> 5V DC Rail (LM2596 OUT+ / 4.5V-5.5V supply for onboard 3.3V LDO regulator)
 *  - GND     -> Clean Signal Ground (GND_LV)
 */

/**
 * @brief Initialize MicroSD SPI driver for EasyWare EP000094 adapter (CS GPIO 48).
 * Non-blocking / fail-safe: if MicroSD card is not present, falls back gracefully to degraded mode.
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

/**
 * @brief Explicitly turn off onboard WS2812 RGB LED sharing GPIO 48.
 */
void sdcard_hal_clear_onboard_led(void);

#ifdef __cplusplus
}
#endif
