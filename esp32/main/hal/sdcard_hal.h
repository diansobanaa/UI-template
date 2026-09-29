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

/**
 * @brief Card status information returned by sdcard_hal_get_card_info().
 */
typedef struct {
    bool detected;              /**< true if card is physically detected and SPI communication succeeded */
    bool mounted;               /**< true if FAT filesystem is mounted at /sdcard */
    bool format_in_progress;    /**< true while a format operation is running */
    uint64_t capacity_mb;       /**< card capacity in megabytes (0 if not detected) */
    char card_name[8];          /**< card product name from CID register */
} sdcard_card_info_t;

/**
 * @brief Get current MicroSD card status (non-blocking, thread-safe).
 */
void sdcard_hal_get_card_info(sdcard_card_info_t *out);

/**
 * @brief Runtime FAT32 format of the MicroSD card (callable from any task).
 *
 * Thread-safe: acquires the SD mutex, sets s_sd_mounted=false to block
 * concurrent writers, performs unmount → format → remount → write/read
 * verification, then restores s_sd_mounted=true on success.
 *
 * MUST be called from a task with sufficient stack (≥4096). Do NOT call
 * from the HTTP server worker thread directly — use a dedicated task.
 *
 * @return ESP_OK on success (format + write/read verify both passed).
 *         ESP_ERR_INVALID_STATE if card not detected.
 *         ESP_FAIL if format or verification failed.
 */
esp_err_t sdcard_hal_format_fat32(void);

#ifdef __cplusplus
}
#endif

