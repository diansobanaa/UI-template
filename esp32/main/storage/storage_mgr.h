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
    bool safe_boot_active;
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

/**
 * @brief Append an event log entry to persistent SPIFFS storage.
 */
esp_err_t storage_mgr_append_event_log(const char *event_json);

/**
 * @brief Read recent event logs from SPIFFS storage.
 */
esp_err_t storage_mgr_read_event_logs(char *out_buf, size_t max_len, size_t *out_len);

/**
 * @brief Clear event logs.
 */
esp_err_t storage_mgr_clear_event_logs(void);

#ifdef __cplusplus
}
#endif
