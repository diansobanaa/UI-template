#include "services/crop_cycle_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "nvs.h"
#include <string.h>
#include <time.h>
#include <stdio.h>

static const char *TAG = "CROPCYCLE_MGR";
static const char *NVS_NAMESPACE = "agrotech_cc";

static crop_cycle_record_t s_active_cycles[MAX_GREENHOUSES] = {0};

static crop_cycle_record_t* get_cycle(const char *gh_id) {
    if (!gh_id) return NULL;
    for (int i = 0; i < MAX_GREENHOUSES; i++) {
        if (strcmp(s_active_cycles[i].gh_id, gh_id) == 0) {
            return &s_active_cycles[i];
        }
    }
    return NULL;
}

static crop_cycle_record_t* get_or_create_cycle(const char *gh_id) {
    crop_cycle_record_t* c = get_cycle(gh_id);
    if (c) return c;
    for (int i = 0; i < MAX_GREENHOUSES; i++) {
        if (s_active_cycles[i].gh_id[0] == '\0') {
            strncpy(s_active_cycles[i].gh_id, gh_id, sizeof(s_active_cycles[i].gh_id) - 1);
            s_active_cycles[i].status = CYCLE_STATE_NO_CYCLE;
            return &s_active_cycles[i];
        }
    }
    return NULL; // Array full
}

static int days_between(const char *date_str)
{
    if (!date_str || strlen(date_str) < 10) return -1;
    int y = 0, m = 0, d = 0;
    if (sscanf(date_str, "%d-%d-%d", &y, &m, &d) != 3) return -1;

    struct tm tm_date = {
        .tm_year = y - 1900,
        .tm_mon = m - 1,
        .tm_mday = d,
        .tm_hour = 12,
        .tm_min = 0,
        .tm_sec = 0,
        .tm_isdst = -1
    };

    time_t t_target = mktime(&tm_date);
    if (t_target == (time_t)-1) return -1;

    time_t now = time(NULL);
    double diff = difftime(now, t_target);
    if (diff < 0) return 0;
    return (int)(diff / 86400.0);
}

static void recompute_hst_hsp(crop_cycle_record_t *c)
{
    if (c->status == CYCLE_STATE_ACTIVE && strlen(c->tanggal_tanam) >= 10) {
        c->hst = days_between(c->tanggal_tanam);
    } else {
        c->hst = 0;
    }

    if (c->status == CYCLE_STATE_ACTIVE && strlen(c->tanggal_polinasi) >= 10) {
        c->hsp = days_between(c->tanggal_polinasi);
        c->has_hsp = (c->hsp >= 0);
    } else {
        c->hsp = 0;
        c->has_hsp = false;
    }
}

static esp_err_t persist_cycles(void)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;

    nvs_set_blob(h, "active_cc_arr", s_active_cycles, sizeof(s_active_cycles));
    nvs_commit(h);
    nvs_close(h);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_init(void)
{
    // Initialize empty defaults
    memset(s_active_cycles, 0, sizeof(s_active_cycles));
    for (int i=0; i<MAX_GREENHOUSES; i++) {
        s_active_cycles[i].status = CYCLE_STATE_NO_CYCLE;
        s_active_cycles[i].hst = -1;
        s_active_cycles[i].hsp = -1;
    }

    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &h);
    if (err == ESP_OK) {
        size_t sz = sizeof(s_active_cycles);
        if (nvs_get_blob(h, "active_cc_arr", s_active_cycles, &sz) == ESP_OK) {
            ESP_LOGI(TAG, "Restored active crop cycles from NVS");
        } else {
            // Legacy migration: try loading single struct to index 0
            crop_cycle_record_t legacy;
            sz = sizeof(legacy);
            if (nvs_get_blob(h, "active_cc", &legacy, &sz) == ESP_OK) {
                s_active_cycles[0] = legacy;
                ESP_LOGI(TAG, "Migrated legacy active crop cycle to array format");
            }
        }
        nvs_close(h);
    }

    for (int i=0; i<MAX_GREENHOUSES; i++) {
        if (s_active_cycles[i].gh_id[0] != '\0') {
            recompute_hst_hsp(&s_active_cycles[i]);
        }
    }
    
    ESP_LOGI(TAG, "Crop Cycle Manager initialized");
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_get_current(const char *gh_id, crop_cycle_record_t *out_record)
{
    if (!gh_id || !out_record) return ESP_ERR_INVALID_ARG;
    
    crop_cycle_record_t* c = get_cycle(gh_id);
    if (c) {
        recompute_hst_hsp(c);
        *out_record = *c;
    } else {
        // Return a NO_CYCLE dummy record
        memset(out_record, 0, sizeof(crop_cycle_record_t));
        strncpy(out_record->gh_id, gh_id, sizeof(out_record->gh_id)-1);
        out_record->status = CYCLE_STATE_NO_CYCLE;
        out_record->hst = -1;
        out_record->hsp = -1;
    }
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_start(const char *gh_id, const char *tanggal_tanam, const char *variety, uint32_t plant_count, const char *notes)
{
    if (!gh_id || !tanggal_tanam || strlen(tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;

    crop_cycle_record_t* c = get_or_create_cycle(gh_id);
    if (!c) return ESP_ERR_NO_MEM; // Max greenhouses reached

    /* Disallow start if already active */
    if (c->status == CYCLE_STATE_ACTIVE) {
        ESP_LOGW(TAG, "Refused to start cycle: A cycle is already ACTIVE in %s", gh_id);
        return ESP_ERR_INVALID_STATE;
    }

    snprintf(c->cycle_id, sizeof(c->cycle_id), "cc-%lu", (unsigned long)time(NULL));
    c->status = CYCLE_STATE_ACTIVE;
    strncpy(c->tanggal_tanam, tanggal_tanam, sizeof(c->tanggal_tanam) - 1);
    c->tanggal_polinasi[0] = '\0';
    if (variety) strncpy(c->variety, variety, sizeof(c->variety) - 1);
    c->plant_count = plant_count;
    if (notes) strncpy(c->notes, notes, sizeof(c->notes) - 1);
    c->version++;
    c->has_harvest = false;

    recompute_hst_hsp(c);
    persist_cycles();

    ESP_LOGI(TAG, "Started new crop cycle: %s for GH %s, Tanam=%s", c->cycle_id, gh_id, c->tanggal_tanam);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_import_active(const char *gh_id, const char *tanggal_tanam, const char *tanggal_polinasi, const char *variety, uint32_t plant_count, const char *notes)
{
    if (!gh_id || !tanggal_tanam || strlen(tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;

    crop_cycle_record_t* c = get_or_create_cycle(gh_id);
    if (!c) return ESP_ERR_NO_MEM;

    snprintf(c->cycle_id, sizeof(c->cycle_id), "import-%lu", (unsigned long)time(NULL));
    c->status = CYCLE_STATE_ACTIVE;
    strncpy(c->tanggal_tanam, tanggal_tanam, sizeof(c->tanggal_tanam) - 1);

    if (tanggal_polinasi && strlen(tanggal_polinasi) >= 10) {
        strncpy(c->tanggal_polinasi, tanggal_polinasi, sizeof(c->tanggal_polinasi) - 1);
    } else {
        c->tanggal_polinasi[0] = '\0';
    }

    if (variety) strncpy(c->variety, variety, sizeof(c->variety) - 1);
    c->plant_count = plant_count;
    if (notes) strncpy(c->notes, notes, sizeof(c->notes) - 1);
    c->version++;
    c->has_harvest = false;

    recompute_hst_hsp(c);
    persist_cycles();

    ESP_LOGI(TAG, "Imported active cycle: %s for GH %s, HST=%ld", c->cycle_id, gh_id, (long)c->hst);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_set_pollination(const char *gh_id, const char *tanggal_polinasi, const char *method)
{
    if (!gh_id || !tanggal_polinasi || strlen(tanggal_polinasi) < 10) return ESP_ERR_INVALID_ARG;
    
    crop_cycle_record_t* c = get_cycle(gh_id);
    if (!c || c->status != CYCLE_STATE_ACTIVE) return ESP_ERR_INVALID_STATE;

    /* Validate pollination date >= planting date */
    if (strcmp(tanggal_polinasi, c->tanggal_tanam) < 0) {
        ESP_LOGE(TAG, "Validation failed: pollination date cannot be earlier than planting date");
        return ESP_ERR_INVALID_ARG;
    }

    strncpy(c->tanggal_polinasi, tanggal_polinasi, sizeof(c->tanggal_polinasi) - 1);
    c->version++;

    recompute_hst_hsp(c);
    persist_cycles();

    ESP_LOGI(TAG, "Pollination recorded: %s (HSP=%ld) for GH %s", tanggal_polinasi, (long)c->hsp, gh_id);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_delete_pollination(const char *gh_id)
{
    if (!gh_id) return ESP_ERR_INVALID_ARG;
    crop_cycle_record_t* c = get_cycle(gh_id);
    if (!c || c->status != CYCLE_STATE_ACTIVE) return ESP_ERR_INVALID_STATE;

    c->tanggal_polinasi[0] = '\0';
    c->hsp = 0;
    c->has_hsp = false;
    c->version++;

    persist_cycles();
    ESP_LOGI(TAG, "Pollination date removed for GH %s", gh_id);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_update_planting_date(const char *gh_id, const char *new_tanggal_tanam)
{
    if (!gh_id || !new_tanggal_tanam || strlen(new_tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;
    
    crop_cycle_record_t* c = get_cycle(gh_id);
    if (!c || c->status != CYCLE_STATE_ACTIVE) return ESP_ERR_INVALID_STATE;

    strncpy(c->tanggal_tanam, new_tanggal_tanam, sizeof(c->tanggal_tanam) - 1);
    c->version++;

    recompute_hst_hsp(c);
    persist_cycles();

    ESP_LOGI(TAG, "Updated planting date to %s for GH %s", new_tanggal_tanam, gh_id);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_update_metadata(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes)
{
    if (!gh_id) return ESP_ERR_INVALID_ARG;
    crop_cycle_record_t* c = get_cycle(gh_id);
    if (!c || c->status != CYCLE_STATE_ACTIVE) return ESP_ERR_INVALID_STATE;

    if (variety) strncpy(c->variety, variety, sizeof(c->variety) - 1);
    if (plant_count > 0) c->plant_count = plant_count;
    if (notes) strncpy(c->notes, notes, sizeof(c->notes) - 1);

    c->version++;
    persist_cycles();
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_cancel(const char *gh_id)
{
    if (!gh_id) return ESP_ERR_INVALID_ARG;
    crop_cycle_record_t* c = get_cycle(gh_id);
    if (!c || c->status != CYCLE_STATE_ACTIVE) return ESP_ERR_INVALID_STATE;

    c->status = CYCLE_STATE_CANCELLED;
    c->version++;
    persist_cycles();
    ESP_LOGI(TAG, "Cycle %s cancelled for GH %s", c->cycle_id, gh_id);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_harvest(const char *gh_id, const char *harvest_date, float yield_kg, const char *grade, const char *notes)
{
    if (!gh_id) return ESP_ERR_INVALID_ARG;
    crop_cycle_record_t* c = get_cycle(gh_id);
    if (!c || c->status != CYCLE_STATE_ACTIVE) return ESP_ERR_INVALID_STATE;

    c->status = CYCLE_STATE_HARVESTED;
    c->has_harvest = true;
    if (harvest_date) strncpy(c->harvest_date, harvest_date, sizeof(c->harvest_date) - 1);
    c->yield_kg = (yield_kg > 0) ? yield_kg : 300.0f;
    if (grade) strncpy(c->grade, grade, sizeof(c->grade) - 1);
    if (notes) strncpy(c->harvest_notes, notes, sizeof(c->harvest_notes) - 1);

    c->version++;
    persist_cycles();
    ESP_LOGI(TAG, "Cycle %s harvested. Yield: %.1f kg, Grade: %s", c->cycle_id, c->yield_kg, c->grade);
    return ESP_OK;
}

cJSON *crop_cycle_mgr_to_json(const crop_cycle_record_t *c)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "cycleId", c->cycle_id);
    cJSON_AddStringToObject(root, "ghId", c->gh_id);

    const char *status_str = "NO_CYCLE";
    if (c->status == CYCLE_STATE_ACTIVE) status_str = "ACTIVE";
    else if (c->status == CYCLE_STATE_HARVESTED) status_str = "HARVESTED";
    else if (c->status == CYCLE_STATE_CANCELLED) status_str = "CANCELLED";
    cJSON_AddStringToObject(root, "status", status_str);

    if (strlen(c->tanggal_tanam) > 0) {
        cJSON_AddStringToObject(root, "tanggalTanam", c->tanggal_tanam);
    } else {
        cJSON_AddNullToObject(root, "tanggalTanam");
    }

    if (strlen(c->tanggal_polinasi) > 0) {
        cJSON_AddStringToObject(root, "tanggalPolinasi", c->tanggal_polinasi);
    } else {
        cJSON_AddNullToObject(root, "tanggalPolinasi");
    }

    cJSON_AddStringToObject(root, "variety", c->variety);
    cJSON_AddNumberToObject(root, "plantCount", c->plant_count);
    cJSON_AddStringToObject(root, "notes", c->notes);

    if (c->status == CYCLE_STATE_ACTIVE) {
        cJSON_AddNumberToObject(root, "hst", c->hst);
    } else {
        cJSON_AddNullToObject(root, "hst");
    }

    if (c->status == CYCLE_STATE_ACTIVE && c->has_hsp) {
        cJSON_AddNumberToObject(root, "hsp", c->hsp);
    } else {
        cJSON_AddNullToObject(root, "hsp");
    }

    cJSON_AddNumberToObject(root, "version", c->version);

    if (c->has_harvest) {
        cJSON *s = cJSON_AddObjectToObject(root, "lastHarvestSummary");
        cJSON_AddStringToObject(s, "harvestDate", c->harvest_date);
        cJSON_AddStringToObject(s, "tanggalTanam", c->tanggal_tanam);
        cJSON_AddNumberToObject(s, "yieldKg", c->yield_kg);
        cJSON_AddStringToObject(s, "grade", c->grade);
        cJSON_AddStringToObject(s, "notes", c->harvest_notes);
        cJSON_AddNumberToObject(s, "hstAtHarvest", c->hst);
        cJSON_AddNumberToObject(s, "hspAtHarvest", c->hsp);
        cJSON_AddStringToObject(s, "recordedAt", "2026-09-13T12:00:00Z");
    } else {
        cJSON_AddNullToObject(root, "lastHarvestSummary");
    }

    return root;
}
