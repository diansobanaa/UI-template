#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Maximum supported concurrent/sequential dosing pumps in a mixing job. */
#define MAX_MIXING_DOSING_CHANNELS 8

/** Standard error/status codes for the core mixing protocol. */
typedef enum {
    MIXING_RESULT_SUCCESS = 0,
    MIXING_RESULT_INVALID_CONFIG,
    MIXING_RESULT_CALIBRATION_MISSING,
    MIXING_RESULT_RAW_WATER_SENSOR_ERROR,
    MIXING_RESULT_RAW_WATER_NO_FLOW,
    MIXING_RESULT_RAW_WATER_TIMEOUT,
    MIXING_RESULT_DOSING_ERROR,
    MIXING_RESULT_DOSING_TIMEOUT,
    MIXING_RESULT_ACTUATOR_ERROR,
    MIXING_RESULT_EMERGENCY_STOP
} mixing_status_code_t;

/** Dynamic dosing channel specification. */
typedef struct {
    char component_id[40];       /**< Logical ID, e.g. "pump_dosing_a", "pump_dosing_1" */
    uint32_t target_volume_ml;   /**< Target dosage in mL */
} mixing_dosing_channel_config_t;

/** Input configuration for protocol_mixing. */
typedef struct {
    uint32_t raw_water_target_ml;          /**< Target raw water volume in mL (must be > 0) */
    uint8_t threshold_percent;             /**< Threshold % of raw water volume (0-100%) to start mixing & dosing */
    uint32_t mixing_duration_sec;          /**< Required run duration of mixing pump in seconds */

    char raw_water_component_id[40];       /**< Optional: default "pump_submersible" */
    char raw_flow_sensor_id[40];           /**< Optional: default "sensor_flow_raw" */
    char mixing_pump_id[40];               /**< Optional: default "mixing_pump" */

    uint32_t channel_count;                /**< Number of active dosing channels (0 to MAX_MIXING_DOSING_CHANNELS) */
    mixing_dosing_channel_config_t channels[MAX_MIXING_DOSING_CHANNELS];

    /* Timing & Safety margin overrides (0 = use canonical defaults) */
    uint32_t no_flow_grace_period_sec;     /**< Grace period before NO FLOW trip (default: 15s) */
    uint32_t timeout_safety_margin_sec;    /**< Extra margin added to raw water expected runtime (default: 50% or min 30s) */
    uint32_t poll_interval_ms;             /**< Inner loop polling delay (default: 100ms) */

    /* Optional external abort hook (returns true to request immediate abort) */
    bool (*abort_check)(void *user_ctx);
    void *user_ctx;
} mixing_protocol_config_t;

/** Result metrics for an individual dosing channel. */
typedef struct {
    char component_id[40];
    uint32_t target_volume_ml;
    float calibration_rate_ml_sec;
    uint32_t expected_runtime_ms;
    uint32_t actual_runtime_ms;
    bool completed;
} mixing_channel_result_t;

/** Outcome structure returned by protocol_mixing. */
typedef struct {
    mixing_status_code_t status;
    const char *error_code;
    char message[128];

    uint32_t target_raw_water_ml;
    uint32_t actual_raw_water_ml;
    uint32_t raw_water_expected_runtime_sec;
    uint32_t raw_water_actual_runtime_ms;
    uint32_t mixing_actual_runtime_ms;
    uint32_t total_runtime_ms;

    uint32_t channel_count;
    mixing_channel_result_t channels[MAX_MIXING_DOSING_CHANNELS];
} mixing_result_t;

/**
 * @brief Convert a mixing status code to canonical uppercase string identifier.
 */
const char *mixing_status_to_string(mixing_status_code_t status);

/**
 * @brief Emergency/safe-stop helper: immediately turn OFF raw water pump,
 *        all configured dosing pumps, and mixing pump, and release actuator ownership.
 */
esp_err_t stop_mixing_protocol_actuators(const mixing_protocol_config_t *config);

/**
 * @brief Core orchestrator for the mixing and dosing protocol.
 *
 * Sequence:
 * 1. PRECHECK (validate config, E-Stop check, flow sensor calibration check, pump calibration checks, actuator acquisition)
 * 2. START RAW WATER (raw water submersible pump ON)
 * 3. MONITOR FLOW SENSOR (source of truth = actual pulses converted to mL, not timer)
 * 4. THRESHOLD REACHED (actual_raw_water_ml >= threshold_volume -> START MIXING & START DOSING)
 * 5. CONCURRENT RUN (raw water remains ON until target volume reached; dosing channels run concurrently)
 * 6. RAW WATER TARGET REACHED (actual_raw_water_ml >= target -> RAW WATER OFF)
 * 7. DOSING COMPLETE (each dosing pump turns OFF as its calibrated runtime is satisfied)
 * 8. MIXING DURATION COMPLETE (mixing pump turned OFF after required duration)
 * 9. SUCCESS (clean release, returns MIXING_SUCCESS)
 *
 * Safety interlocks enforced throughout:
 * - Immediate safe-stop on emergency stop latch
 * - No flow detection after grace period
 * - Flow sensor health verification
 * - Raw water timeout based on calibration expected runtime + safety margin
 * - Dosing timeout protection (1.5x expected + 5s)
 * - Safe stop on all error pathways with no auto-retry.
 *
 * @param config Protocol input configuration.
 * @return mixing_result_t Full outcome structure with error code and runtime metrics.
 */
mixing_result_t protocol_mixing(const mixing_protocol_config_t *config);

#ifdef __cplusplus
}
#endif
