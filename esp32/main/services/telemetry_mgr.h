#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint64_t sequence;
    char timestamp[32];
    float temperature_c;
    bool temp_valid;
    float humidity_pct;
    float light_lux;
    float water_level_pct;
    float flow_rate_lpm;
    float total_liters;

    /* Actuator states */
    bool well_pump_on;
    bool dist_pump_on;
    bool dosing_a_on;
    bool dosing_b_on;
    bool fan_on;
    bool error_lamp_on;
} telemetry_snapshot_t;

/**
 * @brief Initialize and start the background telemetry sampling task.
 */
esp_err_t telemetry_mgr_init(void);

/**
 * @brief Get latest telemetry snapshot.
 */
esp_err_t telemetry_mgr_get_snapshot(telemetry_snapshot_t *out_snap);

/**
 * @brief Serialize current snapshot to canonical cJSON matching TelemetryResponse.
 */
cJSON *telemetry_mgr_to_json(const char *greenhouse_id);

#ifdef __cplusplus
}
#endif
