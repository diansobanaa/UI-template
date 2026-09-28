#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    CYCLE_STATE_NO_CYCLE = 0,
    CYCLE_STATE_ACTIVE,
    CYCLE_STATE_HARVESTED,
    CYCLE_STATE_CANCELLED
} cycle_state_t;

typedef struct {
    char cycle_id[32];
    char gh_id[16];
    cycle_state_t status;
    char tanggal_tanam[16];
    char tanggal_polinasi[16];
    char variety[32];
    uint32_t plant_count;
    char notes[128];
    uint32_t version;
    int32_t hst;
    int32_t hsp;
    bool has_hsp;
    bool has_harvest;
    char harvest_date[16];
    bool has_yield;
    float yield_kg;
    char grade[16];
    char harvest_notes[128];
    char harvest_recorded_at[32];
    uint32_t target_harvest_hst;
} crop_cycle_record_t;

esp_err_t crop_cycle_mgr_init(void);
esp_err_t crop_cycle_mgr_get_current(const char *gh_id, crop_cycle_record_t *out_record);
esp_err_t crop_cycle_mgr_list(const char *gh_id, cJSON **out_items);
esp_err_t crop_cycle_mgr_start(const char *gh_id, const char *tanggal_tanam, const char *variety, uint32_t plant_count, const char *notes);
esp_err_t crop_cycle_mgr_import_active(const char *gh_id, const char *tanggal_tanam, const char *tanggal_polinasi, const char *variety, uint32_t plant_count, const char *notes);

/**
 * @brief Set pollination date with optimistic concurrency check.
 *
 * Per ESP32_BACKEND_SPEC §28 and UI_ESP32_COMMUNICATION_SPEC:821, callers
 * SHOULD pass `expected_version` from the record they read. If `expected_version`
 * is non-zero and does not match the current `rec.version`, returns
 * ESP_ERR_INVALID_VERSION (HTTP 409 CONFLICT at the handler layer).
 *
 * Passing `expected_version = 0` skips the check (legacy behavior, deprecated).
 */
esp_err_t crop_cycle_mgr_set_pollination_with_version(const char *gh_id, const char *tanggal_polinasi, const char *method, uint32_t expected_version);
esp_err_t crop_cycle_mgr_set_pollination(const char *gh_id, const char *tanggal_polinasi, const char *method); /* backward compat: no version check */

esp_err_t crop_cycle_mgr_delete_pollination_with_version(const char *gh_id, uint32_t expected_version);
esp_err_t crop_cycle_mgr_delete_pollination(const char *gh_id); /* backward compat */

esp_err_t crop_cycle_mgr_update_planting_date_with_version(const char *gh_id, const char *new_tanggal_tanam, uint32_t expected_version);
esp_err_t crop_cycle_mgr_update_planting_date(const char *gh_id, const char *new_tanggal_tanam); /* backward compat */

esp_err_t crop_cycle_mgr_update_metadata(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes);
esp_err_t crop_cycle_mgr_update_metadata_v2(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes, uint32_t target_harvest_hst, const char *timeline_json_str);
esp_err_t crop_cycle_mgr_update_metadata_v2_with_version(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes, uint32_t target_harvest_hst, const char *timeline_json_str, uint32_t expected_version);

esp_err_t crop_cycle_mgr_save_timeline(const char *gh_id, const char *timeline_json_str);
esp_err_t crop_cycle_mgr_get_timeline(const char *gh_id, char *out_buf, size_t max_len);

esp_err_t crop_cycle_mgr_cancel_with_version(const char *gh_id, uint32_t expected_version);
esp_err_t crop_cycle_mgr_cancel(const char *gh_id); /* backward compat */

esp_err_t crop_cycle_mgr_harvest_with_version(const char *gh_id, const char *harvest_date, float yield_kg, bool has_yield, const char *grade, const char *notes, uint32_t expected_version);
esp_err_t crop_cycle_mgr_harvest(const char *gh_id, const char *harvest_date, float yield_kg, bool has_yield, const char *grade, const char *notes); /* backward compat */
cJSON *crop_cycle_mgr_to_json(const crop_cycle_record_t *record);

#ifdef __cplusplus
}
#endif
