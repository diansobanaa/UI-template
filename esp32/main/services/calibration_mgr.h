#pragma once

#include "esp_err.h"
#include "hal/actuator_hal.h"
#include "cJSON.h"
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    CALIBRATION_STATE_IDLE = 0,
    CALIBRATION_STATE_RUNNING,
    CALIBRATION_STATE_COMPLETE,
    CALIBRATION_STATE_ERROR
} calibration_state_t;

typedef enum {
    CAL_RECORD_NOT_CALIBRATED = 0,
    CAL_RECORD_CALIBRATED,
    CAL_RECORD_VERIFIED,
    CAL_RECORD_EXPIRED,
    CAL_RECORD_SUSPECT,
    CAL_RECORD_RECALIBRATED,
    CAL_RECORD_REMOVED
} calibration_record_state_t;

typedef struct {
    calibration_state_t state;
    actuator_id_t pump_id;
    uint32_t duration_sec;
    uint32_t remaining_sec;
    char component_id[40];
} calibration_status_t;

typedef struct {
    char calibration_id[40];
    char component_id[40];
    char complex_id[40];
    char calibration_type[24];
    uint32_t version;
    calibration_record_state_t state;
    int64_t created_at_ms;
    int64_t valid_from_ms;
    int64_t valid_until_ms;
    char operator_id[48];
    float rate_ml_sec;
    float slope;
    float offset;
    float pulses_per_liter;
    bool has_rate;
    bool has_linear;
    bool has_pulses_per_liter;
} calibration_record_t;

esp_err_t calibration_mgr_init(void);
esp_err_t calibration_mgr_start_volumetric(actuator_id_t pump_id, uint32_t duration_sec);
esp_err_t calibration_mgr_start_volumetric_component(const char *component_id, uint32_t duration_sec);
esp_err_t calibration_mgr_stop(void);
esp_err_t calibration_mgr_get_status(calibration_status_t *out_status);

/* Legacy enum API: returns 0 when no usable calibration exists. */
float calibration_mgr_get_rate_ml_per_sec(actuator_id_t pump_id);
esp_err_t calibration_mgr_set_rate_ml_per_sec(actuator_id_t pump_id, float rate_ml_sec);

/* Canonical configuration-driven APIs. */
esp_err_t calibration_mgr_set_dosing_rate(const char *component_id, float rate_ml_sec, uint32_t version,
                                         calibration_record_state_t state, const char *operator_id,
                                         int64_t valid_until_ms, const char *calibration_id);
esp_err_t calibration_mgr_get_rate_by_component(const char *component_id, float *out_rate_ml_sec);
esp_err_t calibration_mgr_get_record(const char *component_id, const char *calibration_type, calibration_record_t *out);
esp_err_t calibration_mgr_get_record_exact(const char *component_id, const char *calibration_type, const char *calibration_id, uint32_t version, calibration_record_t *out);
esp_err_t calibration_mgr_is_usable(const calibration_record_t *record);
esp_err_t calibration_mgr_record_json(const char *component_id, const char *calibration_type, cJSON **out_json);
esp_err_t calibration_mgr_record_json_exact(const char *component_id, const char *calibration_type, const char *calibration_id, uint32_t version, cJSON **out_json);
esp_err_t calibration_mgr_apply_linear(const char *component_id, const char *calibration_type, float slope, float offset,
                                       uint32_t version, calibration_record_state_t state, const char *operator_id,
                                       int64_t valid_until_ms, const char *calibration_id);
esp_err_t calibration_mgr_set_record_rate_or_linear(const char *component_id, const char *calibration_type,
                                       float rate_ml_sec, float slope, float offset, bool use_rate,
                                       uint32_t version, calibration_record_state_t state, const char *operator_id,
                                       int64_t valid_until_ms, const char *calibration_id);
esp_err_t calibration_mgr_set_flow_pulses_calibration(const char *component_id, float pulses_per_liter,
                                       float slope, float offset, bool has_linear, uint32_t version,
                                       calibration_record_state_t state, const char *operator_id,
                                       int64_t valid_until_ms, const char *calibration_id);

float calibration_mgr_get_flow_raw_pulses_per_l(void);
bool calibration_mgr_is_flow_raw_calibrated(void);
esp_err_t calibration_mgr_set_flow_raw_pulses_per_l(float pulses_per_l);
float calibration_mgr_get_flow_fert_pulses_per_l(void);
bool calibration_mgr_is_flow_fert_calibrated(void);
esp_err_t calibration_mgr_set_flow_fert_pulses_per_l(float pulses_per_l);

#ifdef __cplusplus
}
#endif
