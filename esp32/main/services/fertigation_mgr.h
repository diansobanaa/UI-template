#pragma once
#include "esp_err.h"
#include "cJSON.h"
#include <stdint.h>
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    FERT_STATE_IDLE = 0,
    FERT_STATE_RECOVERY_HOLD,
    FERT_STATE_PRECHECK,
    FERT_STATE_FILLING,
    FERT_STATE_DOSING,
    FERT_STATE_FINAL_MIXING,
    FERT_STATE_DELIVERY,
    FERT_STATE_COMPLETE,
    FERT_STATE_INTERRUPTED,
    FERT_STATE_FAULTED,
    FERT_STATE_ABORTED
} fertigation_state_t;

#define FERT_MAX_DOSING_CHANNELS 7

typedef struct {
    char component_id[40];
    int32_t requested_ml;
    float rate_ml_sec;
    uint32_t runtime_ms;
    uint32_t calibration_version;
    char calibration_id[40];
} fertigation_channel_t;

typedef struct {
    char run_id[40];
    char complex_id[40];
    char gh_id[40];
    char trigger_type[24];
    char schedule_id[40];
    char recipe_id[40];
    uint32_t recipe_version;
    uint32_t configuration_version;
    char configuration_hash[80];
    int32_t target_water_ml;
    int32_t tolerance_ml;
    uint32_t mixing_duration_sec;
    char delivery_mode[20];
    int32_t delivery_target_ml;
    float target_flow_lpm;
    float target_pressure_kpa;
    uint32_t delivery_duration_sec;
    bool allow_duration_fallback;
    uint32_t min_dosing_runtime_sec;
    uint32_t max_dosing_runtime_sec;
    uint32_t fill_timeout_sec;
    uint32_t delivery_timeout_sec;
    uint32_t max_runtime_sec;
    uint32_t channel_count;
    fertigation_channel_t channels[FERT_MAX_DOSING_CHANNELS];
    char raw_water_component_id[40];
    char raw_flow_sensor_id[40];
    char level_sensor_id[40];
    char mixing_tank_id[40];
    char mixing_pump_id[40];
    char delivery_pump_id[40];
    char delivery_flow_sensor_id[40];
    char pressure_sensor_id[40];
    char raw_flow_calibration_id[40];
    uint32_t raw_flow_calibration_version;
    char delivery_flow_calibration_id[40];
    uint32_t delivery_flow_calibration_version;
    char operator_id[48];
    char source[24];
    char recipe_snapshot_json[2048];
    char execution_plan_json[4096];
} fertigation_batch_config_t;

typedef struct {
    fertigation_state_t state;
    char run_id[40];
    int64_t start_timestamp_ms;
    int64_t end_timestamp_ms;
} fertigation_runtime_snapshot_t;

esp_err_t fertigation_mgr_init(void);
esp_err_t fertigation_mgr_start_from_json(const char *json_payload);
esp_err_t fertigation_mgr_cancel_batch(void);
esp_err_t fertigation_mgr_get_status(fertigation_runtime_snapshot_t *out);
fertigation_state_t fertigation_mgr_get_state(void);
esp_err_t fertigation_mgr_get_active_snapshot(cJSON **out_json);
#ifdef __cplusplus
}
#endif
