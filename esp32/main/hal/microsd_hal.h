#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @file microsd_hal.h
 * @brief Hardware Abstraction Layer for MicroSD Card Adapter Module (EasyWare Part#: EP000094).
 *
 * Signal Mapping (Shared SPI2_HOST Bus):
 *  - MICROSD_SCK  -> GPIO 11 (Shared with TFT SCK)
 *  - MICROSD_MOSI -> GPIO 12 (Shared with TFT MOSI/SDA)
 *  - MICROSD_MISO -> GPIO 13 (Dedicated SPI MISO)
 *  - MICROSD_CS   -> GPIO 48 (Dedicated Chip Select)
 *  - VCC          -> 5V DC Rail (LM2596 OUT+ / 4.5V-5.5V supply for onboard 3.3V LDO regulator)
 *  - GND          -> Clean Signal Ground (GND_LV)
 */

/**
 * @brief Information structure for connected MicroSD card.
 */
typedef struct {
    bool detected;              /**< True if card hardware was acknowledged via SPI */
    bool mounted;               /**< True if FAT32 filesystem is mounted at /sdcard */
    bool format_in_progress;    /**< True if runtime FAT32 format task is actively running */
    uint64_t capacity_mb;       /**< Total capacity in Megabytes (MB) */
    char card_name[32];         /**< Card Product Name from CID register (e.g. "SL08G") */
    char last_format_result[16]; /**< "SUCCESS", "FAILED", or empty */
    char last_format_error[64];  /**< Detailed error string if format failed */
} microsd_card_info_t;

/* Backward-compatibility alias for storage handler */
typedef microsd_card_info_t sdcard_card_info_t;

/**
 * @brief Initialize MicroSD SPI driver for EasyWare EP000094 adapter (CS GPIO 48).
 * Non-blocking / fail-safe: if MicroSD card is not present, falls back gracefully to degraded mode.
 */
esp_err_t microsd_hal_init(void);

/**
 * @brief Run diagnostic file I/O tests (normal write, read, append) to distinguish format from file I/O.
 */
esp_err_t microsd_hal_test_file_io(char *out_log, size_t max_len);

/**
 * @brief Check if MicroSD card is currently mounted.
 */
bool microsd_hal_is_mounted(void);

/**
 * @brief Check if MicroSD card hardware is detected on the SPI bus.
 */
bool microsd_hal_is_detected(void);

/**
 * @brief Lock MicroSD access (FreeRTOS mutex) for thread-safe multi-task I/O.
 */
void microsd_hal_lock(void);

/**
 * @brief Unlock MicroSD access.
 */
void microsd_hal_unlock(void);

/**
 * @brief Explicitly turn off onboard WS2812 RGB LED sharing GPIO 48.
 */
void microsd_hal_clear_onboard_led(void);

/**
 * @brief Populate card information structure for HTTP/UI status endpoints.
 */
void microsd_hal_get_card_info(microsd_card_info_t *out);

/**
 * @brief Format MicroSD card to FAT32 at runtime without rebooting the controller.
 * Executes cleanly in a dedicated background task, pausing concurrent telemetry writes.
 */
esp_err_t microsd_hal_format_fat32(void);

/* ========================================================================== */
/* Backward Compatibility Aliases                                             */
/* ========================================================================== */
#define sdcard_hal_init                 microsd_hal_init
#define sdcard_hal_is_mounted          microsd_hal_is_mounted
#define sdcard_hal_lock                microsd_hal_lock
#define sdcard_hal_unlock              microsd_hal_unlock
#define sdcard_hal_clear_onboard_led   microsd_hal_clear_onboard_led
#define sdcard_hal_get_card_info       microsd_hal_get_card_info
#define sdcard_hal_format_fat32        microsd_hal_format_fat32

#ifdef __cplusplus
}
#endif
