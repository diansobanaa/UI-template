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
} crop_cycle_record_t;

esp_err_t crop_cycle_mgr_init(void);
esp_err_t crop_cycle_mgr_get_current(const char *gh_id, crop_cycle_record_t *out_record);
esp_err_t crop_cycle_mgr_list(const char *gh_id, cJSON **out_items);
esp_err_t crop_cycle_mgr_start(const char *gh_id, const char *tanggal_tanam, const char *variety, uint32_t plant_count, const char *notes);
esp_err_t crop_cycle_mgr_import_active(const char *gh_id, const char *tanggal_tanam, const char *tanggal_polinasi, const char *variety, uint32_t plant_count, const char *notes);
esp_err_t crop_cycle_mgr_set_pollination(const char *gh_id, const char *tanggal_polinasi, const char *method);
esp_err_t crop_cycle_mgr_delete_pollination(const char *gh_id);
esp_err_t crop_cycle_mgr_update_planting_date(const char *gh_id, const char *new_tanggal_tanam);
esp_err_t crop_cycle_mgr_update_metadata(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes);
esp_err_t crop_cycle_mgr_cancel(const char *gh_id);
esp_err_t crop_cycle_mgr_harvest(const char *gh_id, const char *harvest_date, float yield_kg, bool has_yield, const char *grade, const char *notes);
cJSON *crop_cycle_mgr_to_json(const crop_cycle_record_t *record);

#ifdef __cplusplus
}
#endif
