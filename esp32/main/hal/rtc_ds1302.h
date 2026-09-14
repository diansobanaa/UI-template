#pragma once

#include "esp_err.h"
#include <time.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the 3-wire bus and DS1302 RTC hardware.
 * 
 * Configures CLK (GPIO 8), DAT (GPIO 9), and RST/CE (GPIO 47).
 * Probes for DS1302 presence using a non-destructive bounded test.
 * 
 * @return esp_err_t ESP_OK if DS1302 is present and initialized,
 *                   ESP_ERR_NOT_FOUND if not detected (degraded mode).
 */
esp_err_t rtc_ds1302_init(void);

/**
 * @brief Read current date and time from DS1302 hardware clock.
 * 
 * @param[out] timeinfo Pointer to struct tm to populate.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t rtc_ds1302_get_time(struct tm *timeinfo);

/**
 * @brief Set the DS1302 hardware clock date and time.
 * 
 * @param[in] timeinfo Pointer to struct tm containing desired time.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t rtc_ds1302_set_time(const struct tm *timeinfo);

/**
 * @brief Synchronize the ESP32 system time (POSIX time) from the DS1302 clock.
 * 
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t rtc_ds1302_sync_to_system(void);

/**
 * @brief Check if DS1302 RTC hardware was detected and initialized.
 */
bool rtc_ds1302_is_available(void);

#ifdef __cplusplus
}
#endif
