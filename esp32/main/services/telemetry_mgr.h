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
    bool humidity_valid;
    float light_lux;
    bool light_valid;
    float water_level_pct;
    bool float_lower_ok;
    float flow_rate_lpm;
    float total_liters;

    /* Actuator states retained for compatibility with the operational overview. */
    bool well_pump_on;
    bool dist_pump_on;
    bool raw_submersible_on;
    bool mixing_pump_on;
    bool dosing_a_on;
    bool dosing_b_on;
    bool fan_on;
    bool error_lamp_on;
} telemetry_snapshot_t;

/** Initialize and start background telemetry sampling + durable history capture. */
esp_err_t telemetry_mgr_init(void);

/** Get latest telemetry snapshot. */
esp_err_t telemetry_mgr_get_snapshot(telemetry_snapshot_t *out_snap);

/** Serialize the current measured snapshot. No fabricated sensor values are emitted. */
cJSON *telemetry_mgr_to_json(const char *greenhouse_id);

/** Return durable telemetry history after a device sequence cursor. */
cJSON *telemetry_mgr_get_history_json(const char *greenhouse_id, const char *after_sequence, int limit);

#ifdef __cplusplus
}
#endif
