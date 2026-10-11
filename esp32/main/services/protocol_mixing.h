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
    MIXING_RESULT_EMERGENCY_STOP,
    MIXING_RESULT_POST_MIX_DURATION_SEMANTICS_UNDEFINED
} mixing_status_code_t;

/** Canonical internal phases of the core mixing protocol. */
typedef enum {
    MIXING_PHASE_IDLE = 0,
    MIXING_PHASE_PRECHECK,
    MIXING_PHASE_RAW_WATER_FILL,
    MIXING_PHASE_THRESHOLD_REACHED,
    MIXING_PHASE_MIXING_AND_DOSING,
    MIXING_PHASE_RAW_WATER_COMPLETE,
    MIXING_PHASE_DOSING_COMPLETION,
    MIXING_PHASE_POST_MIX,
    MIXING_PHASE_STOP,
    MIXING_PHASE_SUCCESS,
    MIXING_PHASE_ERROR
} mixing_phase_t;

/** Dynamic dosing channel specification. */
#include "cJSON.h"

#define MIXING_POOL_MAGIC          0x4D58504CU // "MXPL"
#define MIXING_POOL_VERSION        1
#define MIXING_POOL_FILE           "/sdcard/mixing_pool.bin"
#define MIXING_POOL_FALLBACK_FILE  "/spiffs/mixing_pool.bin"

/** Channel state tracked persistently inside the 1-second mixing pool */
typedef struct __attribute__((packed)) {
    char component_id[40];
    uint32_t target_volume_ml;
    float rate_ml_sec;
    uint32_t expected_runtime_ms;
    uint32_t observed_runtime_ms;
    bool completed;
} mixing_pool_channel_t;

/** Persistent 1-second checkpoint pool structure for mid-stream power loss recovery */
typedef struct __attribute__((packed)) {
    uint32_t magic;                    /**< MIXING_POOL_MAGIC */
    uint16_t version;                  /**< MIXING_POOL_VERSION */
    bool is_test;                      /**< true = test mixing (suppress logs), false = real */
    bool is_active;                    /**< true while mixing is running */
    uint32_t sequence;                 /**< Monotonic checkpoint counter */
    int64_t timestamp_ms;              /**< Wallclock/uptime timestamp */

    char batch_id[48];                 /**< run_id or test ID */
    char complex_id[40];
    char gh_id[40];
    char recipe_id[40];

    /* Targets */
    uint32_t target_raw_water_ml;
    uint8_t threshold_percent;
    uint32_t post_mix_duration_sec;
    char raw_water_component_id[40];
    char raw_flow_sensor_id[40];
    char mixing_pump_id[40];

    /* Dynamic Execution Progress */
    uint32_t actual_raw_water_ml;
    bool threshold_reached;
    bool raw_water_completed;

    uint32_t channel_count;
    mixing_pool_channel_t channels[MAX_MIXING_DOSING_CHANNELS];

    uint32_t post_mix_elapsed_ms;
    bool post_mix_completed;
    uint8_t current_phase;             /**< mixing_phase_t */
    uint32_t crc32;                    /**< Data integrity */
} mixing_pool_t;

typedef struct {
    char component_id[40];       /**< Logical ID, e.g. "pump_dosing_a", "pump_dosing_1" */
    uint32_t target_volume_ml;   /**< Target dosage in mL */
} mixing_dosing_channel_config_t;

typedef struct mixing_result_s mixing_result_t;

/** Input configuration for protocol_mixing. */
typedef struct {
    uint32_t raw_water_target_ml;          /**< Target raw water volume in mL (must be > 0) */
    uint8_t threshold_percent;             /**< Dynamic threshold % (0-100%) from schedule registration to trigger mixing & dosing */
    uint32_t post_mix_duration_sec;        /**< Required agitation duration in seconds AFTER raw water target is reached and all dosing pumps complete */

    char raw_water_component_id[40];       /**< Optional: default "pump_submersible" */
    char raw_flow_sensor_id[40];           /**< Optional: default "sensor_flow_raw" */
    char mixing_pump_id[40];               /**< Optional: default "mixing_pump" */

    uint32_t channel_count;                /**< Dynamic number of active dosing channels (0 to MAX_MIXING_DOSING_CHANNELS) */
    mixing_dosing_channel_config_t channels[MAX_MIXING_DOSING_CHANNELS];

    /* Timing overrides (0 = use canonical defaults) */
    uint32_t no_flow_grace_period_sec;     /**< Grace period before NO FLOW trip (default: 15s) */
    uint32_t poll_interval_ms;             /**< Inner loop polling delay (default: 100ms) */

    /* Optional tick callback executed on each iteration of the orchestration loop */
    void (*tick_cb)(void *user_ctx);

    /* Optional external abort hook (returns true to request immediate abort) */
    bool (*abort_check)(void *user_ctx);
    void *user_ctx;

    /* Optional live progress structure updated on each iteration of the loop */
    mixing_result_t *live_result;          /**< Optional pointer updated with intermediate metrics and phase on each tick */

    /* Identity and Parity flags */
    bool is_test;                          /**< true = test mixing (suppress event logs), false = real fertigation */
    bool resume_from_pool;                 /**< true = resume from existing mixing_pool.bin remainder */
    char batch_id[48];                     /**< Correlation ID */
    char complex_id[40];
    char gh_id[40];
    char recipe_id[40];
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
struct mixing_result_s {
    mixing_status_code_t status;
    const char *error_code;
    char message[128];
    mixing_phase_t current_phase;
    mixing_phase_t final_phase;

    uint32_t target_raw_water_ml;
    uint32_t actual_raw_water_ml;
    uint32_t raw_water_expected_runtime_sec;
    uint32_t raw_water_actual_runtime_ms;
    uint32_t post_mix_actual_runtime_ms;
    uint32_t mixing_actual_runtime_ms;
    uint32_t total_runtime_ms;

    uint32_t channel_count;
    mixing_channel_result_t channels[MAX_MIXING_DOSING_CHANNELS];
};

/**
 * @brief Convert a mixing status code to canonical uppercase string identifier.
 */
const char *mixing_status_to_string(mixing_status_code_t status);

/**
 * @brief Convert a mixing phase code to canonical uppercase string identifier.
 */
const char *mixing_phase_to_string(mixing_phase_t phase);

/**
 * @brief Emergency/safe-stop helper: immediately turn OFF raw water pump,
 *        all configured dosing pumps, and mixing pump, and release actuator ownership.
 */
esp_err_t stop_mixing_protocol_actuators(const mixing_protocol_config_t *config);

/**
 * @brief Checkpoint pool management API (1-second persistent storage for safe resume).
 */
esp_err_t mixing_pool_save(const mixing_pool_t *pool);
esp_err_t mixing_pool_load(mixing_pool_t *out_pool);
esp_err_t mixing_pool_delete(void);
bool mixing_pool_exists(void);
esp_err_t mixing_pool_get_status_json(cJSON **out_json);

/**
 * @brief Core orchestrator for the mixing and dosing protocol.
 */
mixing_result_t protocol_mixing(const mixing_protocol_config_t *config);

#ifdef __cplusplus
}
#endif
