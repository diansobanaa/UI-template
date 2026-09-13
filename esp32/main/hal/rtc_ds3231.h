#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the I2C bus and DS3231 RTC hardware.
 * 
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t rtc_ds3231_init(void);

/**
 * @brief Synchronize the ESP32 system time (POSIX time) from the DS3231 hardware clock.
 * 
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t rtc_ds3231_sync_to_system(void);

#ifdef __cplusplus
}
#endif
