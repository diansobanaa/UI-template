#pragma once

#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "cJSON.h"
#include "services/crop_cycle_mgr.h"

#ifdef __cplusplus
extern "C" {
#endif

#define CROP_HIST_SD_BASE_DIR        "/sdcard/agrotech"
#define CROP_HIST_CYCLES_DIR         "/sdcard/agrotech/crop_cycles/history"
#define CROP_HIST_PLANTS_DIR         "/sdcard/agrotech/plants/history"

/**
 * @brief Initialize crop and plant historical storage subsystem on SD.
 * Safely creates folder hierarchy if SD is mounted; does nothing if SD is absent.
 */
esp_err_t crop_history_storage_init(void);

/**
 * @brief Check if historical SD storage is physically mounted and ready.
 */
bool crop_history_storage_is_available(void);

/**
 * @brief Archive a completed/harvested/cancelled crop cycle and its plant record to SD.
 * Writes to a temporary file first, flushes, verifies byte count, and renames atomically.
 * 
 * @param record The completed crop cycle record.
 * @param timeline_json Optional JSON string of the timeline config (may be NULL).
 * @return ESP_OK if successfully written and verified on SD; error code otherwise.
 */
esp_err_t crop_history_storage_archive_cycle(const crop_cycle_record_t *record, const char *timeline_json);

/**
 * @brief List historical crop cycle records from SD for a given greenhouse.
 * Reads directory entries and parses metadata in bounded chunks.
 * 
 * @param gh_id The greenhouse identifier.
 * @param out_array Pointer to receive cJSON array of historical cycle objects.
 * @param limit Maximum number of records to return (0 for default max 20).
 * @param offset Record offset for pagination.
 * @return ESP_OK on success, or ESP_ERR_NOT_FOUND if SD is absent.
 */
esp_err_t crop_history_storage_list_historical(const char *gh_id, cJSON **out_array, size_t limit, size_t offset);

/**
 * @brief Delete a specific historical crop cycle archive file from SD.
 * Only called after verified export acknowledgement.
 * 
 * @param gh_id Greenhouse identifier.
 * @param cycle_id Cycle identifier.
 * @return ESP_OK on success.
 */
esp_err_t crop_history_storage_delete_cycle(const char *gh_id, const char *cycle_id);

/**
 * @brief Count historical crop cycle records available on SD.
 */
size_t crop_history_storage_count_historical(const char *gh_id);

#ifdef __cplusplus
}
#endif
