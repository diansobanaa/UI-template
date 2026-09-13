#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SENSOR_STATE_VALID = 0,
    SENSOR_STATE_INVALID,
    SENSOR_STATE_STALE,
    SENSOR_STATE_TIMEOUT,
    SENSOR_STATE_DISCONNECTED,
    SENSOR_STATE_OUT_OF_RANGE
} sensor_state_t;

typedef struct {
    float temperature_c;
    sensor_state_t temp_state;

    float flow_rate_yfb1_lpm;
    uint32_t total_pulses_yfb1;
    float total_liters_yfb1;

    float flow_rate_fs400a_lpm;
    uint32_t total_pulses_fs400a;
    float total_liters_fs400a;

    bool float_lower_ok;
    int64_t last_sample_timestamp;
} sensor_readings_t;

/**
 * @brief Initialize sensor inputs (flow meter pulse counters, DS18B20 1-Wire, float switch).
 */
esp_err_t sensor_hal_init(void);

/**
 * @brief Poll and update all sensor readings.
 */
esp_err_t sensor_hal_poll(void);

/**
 * @brief Get latest snapshot of sensor readings.
 */
esp_err_t sensor_hal_get_readings(sensor_readings_t *out_readings);

/**
 * @brief Reset accumulated pulse / volume counters.
 */
void sensor_hal_reset_counters(void);

#ifdef __cplusplus
}
#endif
