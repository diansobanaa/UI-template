#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

#define TELEMETRY_RING_CAPACITY 256

typedef struct {
    uint64_t sequence;
    int64_t timestamp_ms;
    char timestamp[32];
    float temperature_c;
    bool temp_valid;
    float temperature_water_c;
    bool temp_water_valid;
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
    bool buzzer_on;
} telemetry_snapshot_t;

typedef struct {
    bool is_active;
    int cadence_sec;
    char stream_mode[24];
    char active_triggers[128];
} telemetry_active_process_t;

/** Initialize and start background telemetry sampling + durable history capture. */
esp_err_t telemetry_mgr_init(void);

/** Get latest telemetry snapshot from RAM. */
esp_err_t telemetry_mgr_get_snapshot(telemetry_snapshot_t *out_snap);

/** Fast-path: serialize the current measured RAM snapshot (zero storage locks or disk I/O). */
cJSON *telemetry_mgr_get_current_ram_json(const char *greenhouse_id);

/** Legacy compatibility alias. */
cJSON *telemetry_mgr_to_json(const char *greenhouse_id);

/** Return durable telemetry history after a device sequence cursor. */
cJSON *telemetry_mgr_get_history_json(const char *greenhouse_id, const char *after_sequence, int limit);

/** Get current active process status and adaptive cadence. */
esp_err_t telemetry_mgr_get_active_process(telemetry_active_process_t *out_proc);

/** Build a bounded telemetry batch frame from the RAM ring buffer. */
cJSON *telemetry_mgr_build_stream_batch_json(const char *greenhouse_id, uint64_t from_seq, int max_samples);

/** Get dropped sample count. */
uint32_t telemetry_mgr_get_dropped_count(void);

/** Trigger immediate dispatch of WebSocket telemetry frame (on state transition). */
void telemetry_mgr_trigger_transition(const char *reason);

/** Trigger immediate persistence cycle (e.g. when an event is recorded). */
void telemetry_mgr_trigger_persistence(void);

/** Retrieve today's min and max measured temperature and recent chronological samples for TFT display. */
esp_err_t telemetry_mgr_get_temp_history(float *out_min, float *out_max, float *out_series, size_t max_series, size_t *out_count);

#ifdef __cplusplus
}
#endif
