#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "driver/gpio.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DHT22_OK = 0,
    DHT22_ERR_TIMEOUT,
    DHT22_ERR_CHECKSUM,
    DHT22_ERR_INVALID_DATA,
    DHT22_ERR_NOT_RESPONDING
} dht22_status_t;

typedef struct {
    float temperature_c;
    float humidity_rh;
    int64_t last_read_ms;
    dht22_status_t last_status;
    bool valid;
    uint32_t consecutive_errors;
} dht22_data_t;

/**
 * @brief Initialize DHT22 GPIO pin (sets as open-drain/bidirectional with pull-up enabled).
 * @param gpio Pin number for DHT22 DATA line.
 */
esp_err_t dht22_init(gpio_num_t gpio);

/**
 * @brief Perform a single non-blocking measurement cycle from DHT22.
 * @param gpio Pin number for DHT22 DATA line.
 * @param[out] out_temp_c Pointer to store temperature in Celsius.
 * @param[out] out_humidity_rh Pointer to store relative humidity in % RH.
 * @return ESP_OK on success, ESP_ERR_TIMEOUT on no response, ESP_ERR_INVALID_CRC on checksum mismatch.
 */
esp_err_t dht22_read(gpio_num_t gpio, float *out_temp_c, float *out_humidity_rh);

#ifdef __cplusplus
}
#endif
