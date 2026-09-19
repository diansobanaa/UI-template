#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char device_id[32];
    char complex_id[32];
    char boot_id[37];       /* UUID string */
    uint32_t boot_count;
    uint32_t config_version;
    uint32_t config_crc;
    char config_hash[80];
    uint32_t previous_config_version;
    uint32_t previous_config_crc;
    char previous_config_hash[80];
    uint32_t candidate_config_version;
    uint32_t candidate_config_crc;
    char candidate_config_hash[80];
    char active_deployment_id[64];
    char candidate_deployment_id[64];
    char config_deployment_status[24];
    bool safe_boot_active;
    bool e_stop_latched;
} system_storage_state_t;

/**
 * @brief Initialize NVS, SPIFFS file systems and update boot counters.
 */
esp_err_t storage_mgr_init(void);

/**
 * @brief Get read-only snapshot of system storage metadata.
 */
const system_storage_state_t *storage_mgr_get_state(void);

/**
 * @brief Load the Last Valid Configuration (LVC) JSON string from NVS.
 * @param out_buf Target buffer
 * @param max_len Maximum buffer capacity
 * @param out_len Pointer to receive actual string length
 */
esp_err_t storage_mgr_load_config(char *out_buf, size_t max_len, size_t *out_len);

/**
 * @brief Atomically save and commit a validated configuration JSON string to NVS.
 * @param json_str Validated configuration JSON
 * @param version New configuration version number
 */
esp_err_t storage_mgr_save_config(const char *json_str, uint32_t version);

/** Stage a configuration without changing the active runtime configuration. */
esp_err_t storage_mgr_stage_candidate(const char *json_str, uint32_t version, const char *deployment_id);

/** Atomically promote the staged candidate to active and retain the previous active snapshot. */
esp_err_t storage_mgr_activate_candidate(void);

/** Clear a staged candidate without changing the active configuration. */
esp_err_t storage_mgr_clear_candidate(void);

/** Mark the staged deployment as failed while retaining the active configuration and candidate for reconciliation/retry. */
esp_err_t storage_mgr_mark_candidate_failed(void);

/** Load the staged candidate JSON. */
esp_err_t storage_mgr_load_candidate(char *out_buf, size_t max_len, size_t *out_len);

/** Load the previous active configuration JSON retained for rollback. */
esp_err_t storage_mgr_load_previous_config(char *out_buf, size_t max_len, size_t *out_len);

/**
 * @brief Append an event log entry to persistent SPIFFS storage.
 */
esp_err_t storage_mgr_append_event_log(const char *event_json);

/** Append one durable telemetry snapshot as JSONL. */
esp_err_t storage_mgr_append_telemetry_log(const char *telemetry_json);

/**
 * @brief Read recent event logs from SPIFFS storage.
 */
esp_err_t storage_mgr_read_event_logs(char *out_buf, size_t max_len, size_t *out_len);

/** Read the durable telemetry JSONL log. */
esp_err_t storage_mgr_read_telemetry_logs(char *out_buf, size_t max_len, size_t *out_len);

/** Reserve a persistent, device-monotonic sequence-number block. */
esp_err_t storage_mgr_reserve_sequence_block(const char *nvs_key, uint32_t block_size, uint64_t *out_first_sequence);
esp_err_t storage_mgr_get_sync_cursor(const char *key, uint64_t *out_cursor);
esp_err_t storage_mgr_set_sync_cursor(const char *key, uint64_t cursor);

/**
 * @brief Clear event logs.
 */
esp_err_t storage_mgr_clear_event_logs(void);
esp_err_t storage_mgr_append_fertigation_run(const char *run_json);

/** Mark safe boot complete after all local safety/runtime services are initialized. */
esp_err_t storage_mgr_set_safe_boot_active(bool active);

/**
 * @brief Set and persist the E-Stop latch state to NVS.
 */
esp_err_t storage_mgr_set_estop(bool latched);

/**
 * @brief Read the current E-Stop latch state.
 */
bool storage_mgr_get_estop(void);

/**
 * @brief Load legacy components.json migration input. Not an operational fallback.
 * @param out_buf Target buffer
 * @param max_len Maximum buffer capacity
 * @param out_len Pointer to receive actual string length
 */
esp_err_t storage_mgr_load_components_json(char *out_buf, size_t max_len, size_t *out_len);

/**
 * @brief Persist legacy components.json migration input. Does not define active runtime authority.
 * @param json_str Components JSON string to save
 */
esp_err_t storage_mgr_save_components_json(const char *json_str);

/**
 * @brief Load calibration JSON from NVS.
 */
esp_err_t storage_mgr_load_calibration(char *out_buf, size_t max_len, size_t *out_len);

/**
 * @brief Save calibration JSON to NVS.
 */
esp_err_t storage_mgr_save_calibration(const char *json_str);

#ifdef __cplusplus
}
#endif
