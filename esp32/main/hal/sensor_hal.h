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

    /* RAW WATER FLOW SENSOR (ZJ-B1, GPIO 15) */
    float flow_rate_raw_zjb1_lpm;
    uint32_t total_pulses_raw_zjb1;
    float total_liters_raw_zjb1;
    uint32_t total_ml_raw_zjb1;
    bool raw_zjb1_calibrated;      /* False if unverified / CALIBRATION REQUIRED */

    /* FERTIGATION DELIVERY FLOW SENSOR (FS400A G1", GPIO 16, F = 4.5 * Q) */
    float flow_rate_fert_fs400a_lpm;
    uint32_t total_pulses_fert_fs400a;
    float total_liters_fert_fs400a;
    uint32_t total_ml_fert_fs400a;

    bool float_lower_ok;
    bool tamper_loop_ok;
    int64_t last_sample_timestamp;
} sensor_readings_t;

/* Backward compatibility aliases (OBSOLETE: YF-B1 replaced by ZJ-B1) */
#define flow_rate_yfb1_lpm      flow_rate_raw_zjb1_lpm
#define total_pulses_yfb1       total_pulses_raw_zjb1
#define total_liters_yfb1       total_liters_raw_zjb1
#define total_ml_yfb1           total_ml_raw_zjb1

#define flow_rate_fs400a_lpm    flow_rate_fert_fs400a_lpm
#define total_pulses_fs400a     total_pulses_fert_fs400a
#define total_liters_fs400a     total_liters_fert_fs400a
#define total_ml_fs400a         total_ml_fert_fs400a

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
