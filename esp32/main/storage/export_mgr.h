#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

#define EXPORT_DIR_PENDING   "/sdcard/agrotech/exports/pending"
#define EXPORT_DIR_COMPLETED "/sdcard/agrotech/exports/completed"
#define EXPORT_DEFAULT_CHUNK_BYTES 16384U
#define EXPORT_MAX_CHUNK_BYTES     32768U

typedef enum {
    EXPORT_STATE_PENDING = 0,
    EXPORT_STATE_READY,
    EXPORT_STATE_STREAMING,
    EXPORT_STATE_ACKNOWLEDGED,
    EXPORT_STATE_COMPLETED,
    EXPORT_STATE_FAILED
} export_job_state_t;

typedef struct {
    char export_id[48];
    char dataset[32];          /* "crop_cycles", "plants", "telemetry", "events", "fertigation_runs", "system_logs" */
    char complex_id[32];
    char gh_id[32];
    char from_timestamp[32];
    char to_timestamp[32];
    uint32_t limit;
    export_job_state_t state;
    size_t record_count;
    size_t total_bytes;
    uint32_t checksum_crc32;
    char created_at[32];
    char target_file[128];     /* Primary file or dir exported */
    bool deletion_eligible;
} export_job_t;

/**
 * @brief Initialize export manager directories and recovery state.
 */
esp_err_t export_mgr_init(void);

/**
 * @brief Get JSON object describing supported export datasets and capabilities.
 */
cJSON *export_mgr_get_capabilities(void);

/**
 * @brief Create a new export job for a requested dataset.
 * Gathers record count, byte count, and computes CRC32 checksum.
 * Saves job manifest under /sdcard/agrotech/exports/pending/<exportId>.json.
 * 
 * @param req JSON envelope specifying dataset, complexId, ghId, from, to, limit.
 * @param out_job Pointer to receive created job descriptor.
 * @return ESP_OK on success, ESP_ERR_NOT_FOUND if storage unavailable.
 */
esp_err_t export_mgr_create_job(const cJSON *req, export_job_t *out_job);

/**
 * @brief Retrieve an existing export job by ID.
 */
esp_err_t export_mgr_get_job(const char *export_id, export_job_t *out_job);

/**
 * @brief Generate manifest JSON object for an export job.
 */
cJSON *export_mgr_get_manifest(const char *export_id);

/**
 * @brief Read a bounded chunk of export data without loading entire dataset into RAM.
 * 
 * @param export_id Identifier of the export job.
 * @param chunk_index Zero-indexed chunk number.
 * @param chunk_size Requested chunk size (capped at EXPORT_MAX_CHUNK_BYTES).
 * @param out_buf Output buffer for chunk bytes.
 * @param max_buf Maximum capacity of out_buf.
 * @param out_len Actual bytes read.
 * @param is_last Set to true if this is the final chunk.
 * @param chunk_crc CRC32 of this specific chunk.
 * @return ESP_OK on success.
 */
esp_err_t export_mgr_read_chunk(const char *export_id, uint32_t chunk_index, size_t chunk_size,
                                char *out_buf, size_t max_buf, size_t *out_len,
                                bool *is_last, uint32_t *chunk_crc);

/**
 * @brief Acknowledge receipt of exported data and trigger scoped deletion.
 * IDEMPOTENT: If already completed, returns ESP_OK without re-deleting or failing.
 * Deletes ONLY the specific historical files/records associated with this export job.
 * Active operational state in NVS or active runtime is NEVER touched.
 * 
 * @param export_id Identifier of the export job.
 * @param out_deleted_records Output count of deleted records.
 * @param out_deleted_bytes Output count of freed bytes.
 * @return ESP_OK on success.
 */
esp_err_t export_mgr_ack_job(const char *export_id, size_t *out_deleted_records, size_t *out_deleted_bytes);

#ifdef __cplusplus
}
#endif
