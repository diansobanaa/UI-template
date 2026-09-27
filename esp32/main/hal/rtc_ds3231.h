#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include <time.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the I2C bus and DS3231 RTC hardware.
 * 
 * Performs a non-blocking bounded ACK/NACK probe on I2C address 0x68.
 * If hardware is missing or bus is floating, gracefully falls back without hanging.
 * 
 * @return esp_err_t ESP_OK on success, ESP_ERR_NOT_FOUND if absent.
 */
esp_err_t rtc_ds3231_init(void);

/**
 * @brief Read current date and time from DS3231 hardware clock.
 * 
 * @param timeinfo Pointer to struct tm to populate with current date/time.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t rtc_ds3231_get_time(struct tm *timeinfo);

/**
 * @brief Set the DS3231 hardware clock date and time.
 * 
 * @param timeinfo Pointer to struct tm containing date/time to write.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t rtc_ds3231_set_time(const struct tm *timeinfo);

/**
 * @brief Synchronize the ESP32 system time (POSIX time) from the DS3231 clock.
 * 
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t rtc_ds3231_sync_to_system(void);

/**
 * @brief Check if DS3231 RTC hardware was detected and initialized.
 * 
 * @return true if DS3231 hardware is active and available.
 */
bool rtc_ds3231_is_available(void);

#ifdef __cplusplus
}
#endif
