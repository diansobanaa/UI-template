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
    char tanggal_tanam[16];    /* YYYY-MM-DD */
    char tanggal_polinasi[16]; /* YYYY-MM-DD */
    char variety[32];
    uint32_t plant_count;
    char notes[128];
    uint32_t version;

    /* Authoritative snapshots */
    int32_t hst;
    int32_t hsp;
    bool has_hsp;

    /* Last harvest summary */
    bool has_harvest;
    char harvest_date[16];
    float yield_kg;
    char grade[8];
    char harvest_notes[128];
} crop_cycle_record_t;

/**
 * @brief Initialize the crop cycle manager, recovering current cycle from NVS if available.
 */
esp_err_t crop_cycle_mgr_init(void);

/**
 * @brief Get current authoritative cycle state.
 */
esp_err_t crop_cycle_mgr_get_current(const char *gh_id, crop_cycle_record_t *out_record);

/**
 * @brief Start a normal cycle. Fails with ESP_ERR_INVALID_STATE if a cycle is already active.
 */
esp_err_t crop_cycle_mgr_start(const char *gh_id, const char *tanggal_tanam, const char *variety, uint32_t plant_count, const char *notes);

/**
 * @brief Import an ongoing cycle.
 */
esp_err_t crop_cycle_mgr_import_active(const char *gh_id, const char *tanggal_tanam, const char *tanggal_polinasi, const char *variety, uint32_t plant_count, const char *notes);

/**
 * @brief Record or update pollination date. Validates tanggal_polinasi >= tanggal_tanam.
 */
esp_err_t crop_cycle_mgr_set_pollination(const char *gh_id, const char *tanggal_polinasi, const char *method);

/**
 * @brief Delete pollination date (resets HSP to null).
 */
esp_err_t crop_cycle_mgr_delete_pollination(const char *gh_id);

/**
 * @brief Update planting date.
 */
esp_err_t crop_cycle_mgr_update_planting_date(const char *gh_id, const char *new_tanggal_tanam);

/**
 * @brief Update metadata (variety, plant count, notes).
 */
esp_err_t crop_cycle_mgr_update_metadata(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes);

/**
 * @brief Cancel / reset active cycle.
 */
esp_err_t crop_cycle_mgr_cancel(const char *gh_id);

/**
 * @brief Harvest active cycle. Archives summary and updates status to HARVESTED.
 */
esp_err_t crop_cycle_mgr_harvest(const char *gh_id, const char *harvest_date, float yield_kg, const char *grade, const char *notes);

/**
 * @brief Serialize record to canonical cJSON response object.
 */
cJSON *crop_cycle_mgr_to_json(const crop_cycle_record_t *record);

#ifdef __cplusplus
}
#endif
