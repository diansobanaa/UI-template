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
    FERT_STATE_MIX_READY,
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
    bool fallback_enabled;
    uint8_t raw_water_start_threshold_percent;
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
    char queue_id[48];
    char occurrence_id[48];
    char batch_id[48];
    char routing_valve_ids[4][40];
    uint32_t routing_valve_count;
    char recipe_snapshot_json[2048];
    char execution_plan_json[4096];
} fertigation_batch_config_t;

typedef struct {
    fertigation_state_t state;
    char run_id[40];
    int64_t start_timestamp_ms;
    int64_t end_timestamp_ms;
} fertigation_runtime_snapshot_t;

typedef struct {
    char run_id[40];
    fertigation_state_t state;
    char fault[48];
    int64_t completed_at_ms;
} fertigation_last_terminal_t;

esp_err_t fertigation_mgr_init(void);
esp_err_t fertigation_mgr_start_from_json(const char *json_payload);
esp_err_t fertigation_mgr_cancel_batch(void);
esp_err_t fertigation_mgr_get_status(fertigation_runtime_snapshot_t *out);
fertigation_state_t fertigation_mgr_get_state(void);
esp_err_t fertigation_mgr_get_active_snapshot(cJSON **out_json);
esp_err_t fertigation_mgr_get_last_terminal(fertigation_last_terminal_t *out);
esp_err_t fertigation_mgr_get_correlation(char *out_queue_id, size_t queue_id_len,
                                          char *out_occurrence_id, size_t occ_id_len,
                                          char *out_batch_id, size_t batch_id_len,
                                          char *out_gh_id, size_t gh_id_len);
bool fertigation_mgr_is_batch_ready(const char *gh_id, const char *occurrence_id);
esp_err_t fertigation_mgr_trigger_distribution(const char *gh_id, const char *occurrence_id);

typedef struct {
    uint32_t run_count_today;
    uint32_t delivered_liters_today;
    uint32_t target_liters_today;
} fertigation_daily_stats_t;

esp_err_t fertigation_mgr_get_daily_stats(fertigation_daily_stats_t *out_stats);

typedef struct {
    char batch_id[40];
    char gh_id[40];
    char runtime_state[24];
    char active_channel[8];
    uint32_t raw_water_actual_ml;
    uint32_t raw_water_target_ml;
    uint8_t threshold_percent;
    bool is_active;
    uint32_t queued_count;
} fertigation_queue_summary_t;

esp_err_t fertigation_mgr_get_queue_summary(fertigation_queue_summary_t *out_summary);

typedef enum {
    DELIVERY_SLOT_FREE = 0,
    DELIVERY_SLOT_READY_TO_SEND,
    DELIVERY_SLOT_DISTRIBUTING,
    DELIVERY_SLOT_COMPLETE,
    DELIVERY_SLOT_FAULTED
} delivery_slot_state_t;

#define FERT_MAX_DELIVERY_SLOTS 8

typedef struct {
    bool occupied;
    delivery_slot_state_t state;
    char gh_id[40];
    char occurrence_id[48];
    char batch_id[48];
    char run_id[48];
    char schedule_id[40];
    char delivery_pump_id[40];
    char delivery_flow_sensor_id[40];
    char delivery_mode[20];
    int32_t delivery_target_ml;
    uint32_t delivery_duration_sec;
    uint32_t delivery_timeout_sec;
    uint32_t delivery_start_ml;
    uint32_t delivery_start_ms;
    uint32_t configuration_version;
    char complex_id[40];
    char fault[48];
    int64_t completed_at_ms;
} delivery_slot_t;

bool fertigation_mgr_is_gh_busy(const char *gh_id);
esp_err_t fertigation_mgr_get_delivery_slot_status(const char *gh_id, const char *occurrence_id, delivery_slot_state_t *out_state);
esp_err_t fertigation_mgr_acknowledge_delivery(const char *gh_id, const char *occurrence_id);
size_t fertigation_mgr_get_active_delivery_count(void);
esp_err_t fertigation_mgr_get_delivery_slots(delivery_slot_t *out_slots, size_t max_count, size_t *out_count);

#ifdef __cplusplus
}
#endif
