#include "services/crop_cycle_mgr.h"
#include "esp_log.h"
#include "nvs.h"
#include <string.h>
#include <time.h>
#include <stdio.h>

static const char *TAG = "CROPCYCLE_MGR";
static const char *NVS_NAMESPACE = "agrotech_cc";

static crop_cycle_record_t s_active_cycle = {
    .cycle_id = "",
    .gh_id = "gh-01",
    .status = CYCLE_STATE_NO_CYCLE,
    .tanggal_tanam = "",
    .tanggal_polinasi = "",
    .variety = "",
    .plant_count = 0,
    .notes = "No active crop cycle initially",
    .version = 0,
    .has_harvest = false,
    .hst = -1,
    .hsp = -1,
    .has_hsp = false
};

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

static esp_err_t persist_cycle(void)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;

    nvs_set_blob(h, "active_cc", &s_active_cycle, sizeof(crop_cycle_record_t));
    nvs_commit(h);
    nvs_close(h);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_init(void)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &h);
    if (err == ESP_OK) {
        size_t sz = sizeof(crop_cycle_record_t);
        if (nvs_get_blob(h, "active_cc", &s_active_cycle, &sz) == ESP_OK) {
            ESP_LOGI(TAG, "Restored active crop cycle from NVS (ID='%s', Status=%d)",
                     s_active_cycle.cycle_id, s_active_cycle.status);
        }
        nvs_close(h);
    }

    recompute_hst_hsp(&s_active_cycle);
    ESP_LOGI(TAG, "Crop Cycle Manager initialized: HST=%ld, HSP=%ld (hasHsp=%d)",
             (long)s_active_cycle.hst, (long)s_active_cycle.hsp, s_active_cycle.has_hsp);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_get_current(const char *gh_id, crop_cycle_record_t *out_record)
{
    if (!out_record) return ESP_ERR_INVALID_ARG;
    recompute_hst_hsp(&s_active_cycle);
    *out_record = s_active_cycle;
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_start(const char *gh_id, const char *tanggal_tanam, const char *variety, uint32_t plant_count, const char *notes)
{
    if (!tanggal_tanam || strlen(tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;

    /* Disallow start if already active */
    if (s_active_cycle.status == CYCLE_STATE_ACTIVE) {
        ESP_LOGW(TAG, "Refused to start cycle: A cycle is already ACTIVE in %s", gh_id ? gh_id : "gh-01");
        return ESP_ERR_INVALID_STATE;
    }

    snprintf(s_active_cycle.cycle_id, sizeof(s_active_cycle.cycle_id), "cc-%lu", (unsigned long)time(NULL));
    strncpy(s_active_cycle.gh_id, gh_id ? gh_id : "gh-01", sizeof(s_active_cycle.gh_id) - 1);
    s_active_cycle.status = CYCLE_STATE_ACTIVE;
    strncpy(s_active_cycle.tanggal_tanam, tanggal_tanam, sizeof(s_active_cycle.tanggal_tanam) - 1);
    s_active_cycle.tanggal_polinasi[0] = '\0';
    if (variety) strncpy(s_active_cycle.variety, variety, sizeof(s_active_cycle.variety) - 1);
    s_active_cycle.plant_count = plant_count;
    if (notes) strncpy(s_active_cycle.notes, notes, sizeof(s_active_cycle.notes) - 1);
    s_active_cycle.version++;
    s_active_cycle.has_harvest = false;

    recompute_hst_hsp(&s_active_cycle);
    persist_cycle();

    ESP_LOGI(TAG, "Started new crop cycle: %s, Tanam=%s", s_active_cycle.cycle_id, s_active_cycle.tanggal_tanam);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_import_active(const char *gh_id, const char *tanggal_tanam, const char *tanggal_polinasi, const char *variety, uint32_t plant_count, const char *notes)
{
    if (!tanggal_tanam || strlen(tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;

    snprintf(s_active_cycle.cycle_id, sizeof(s_active_cycle.cycle_id), "import-%lu", (unsigned long)time(NULL));
    strncpy(s_active_cycle.gh_id, gh_id ? gh_id : "gh-01", sizeof(s_active_cycle.gh_id) - 1);
    s_active_cycle.status = CYCLE_STATE_ACTIVE;
    strncpy(s_active_cycle.tanggal_tanam, tanggal_tanam, sizeof(s_active_cycle.tanggal_tanam) - 1);

    if (tanggal_polinasi && strlen(tanggal_polinasi) >= 10) {
        strncpy(s_active_cycle.tanggal_polinasi, tanggal_polinasi, sizeof(s_active_cycle.tanggal_polinasi) - 1);
    } else {
        s_active_cycle.tanggal_polinasi[0] = '\0';
    }

    if (variety) strncpy(s_active_cycle.variety, variety, sizeof(s_active_cycle.variety) - 1);
    s_active_cycle.plant_count = plant_count;
    if (notes) strncpy(s_active_cycle.notes, notes, sizeof(s_active_cycle.notes) - 1);
    s_active_cycle.version++;
    s_active_cycle.has_harvest = false;

    recompute_hst_hsp(&s_active_cycle);
    persist_cycle();

    ESP_LOGI(TAG, "Imported active cycle: %s, HST=%ld, HSP=%ld", s_active_cycle.cycle_id, (long)s_active_cycle.hst, (long)s_active_cycle.hsp);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_set_pollination(const char *gh_id, const char *tanggal_polinasi, const char *method)
{
    if (!tanggal_polinasi || strlen(tanggal_polinasi) < 10) return ESP_ERR_INVALID_ARG;

    /* Validate pollination date >= planting date */
    if (strcmp(tanggal_polinasi, s_active_cycle.tanggal_tanam) < 0) {
        ESP_LOGE(TAG, "Validation failed: pollination date cannot be earlier than planting date");
        return ESP_ERR_INVALID_ARG;
    }

    strncpy(s_active_cycle.tanggal_polinasi, tanggal_polinasi, sizeof(s_active_cycle.tanggal_polinasi) - 1);
    s_active_cycle.version++;

    recompute_hst_hsp(&s_active_cycle);
    persist_cycle();

    ESP_LOGI(TAG, "Pollination recorded: %s (HSP=%ld)", tanggal_polinasi, (long)s_active_cycle.hsp);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_delete_pollination(const char *gh_id)
{
    s_active_cycle.tanggal_polinasi[0] = '\0';
    s_active_cycle.hsp = 0;
    s_active_cycle.has_hsp = false;
    s_active_cycle.version++;

    persist_cycle();
    ESP_LOGI(TAG, "Pollination date removed; HSP reset to NULL.");
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_update_planting_date(const char *gh_id, const char *new_tanggal_tanam)
{
    if (!new_tanggal_tanam || strlen(new_tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;

    strncpy(s_active_cycle.tanggal_tanam, new_tanggal_tanam, sizeof(s_active_cycle.tanggal_tanam) - 1);
    s_active_cycle.version++;

    recompute_hst_hsp(&s_active_cycle);
    persist_cycle();

    ESP_LOGI(TAG, "Updated planting date to %s (HST=%ld)", new_tanggal_tanam, (long)s_active_cycle.hst);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_update_metadata(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes)
{
    if (variety) strncpy(s_active_cycle.variety, variety, sizeof(s_active_cycle.variety) - 1);
    if (plant_count > 0) s_active_cycle.plant_count = plant_count;
    if (notes) strncpy(s_active_cycle.notes, notes, sizeof(s_active_cycle.notes) - 1);

    s_active_cycle.version++;
    persist_cycle();
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_cancel(const char *gh_id)
{
    s_active_cycle.status = CYCLE_STATE_CANCELLED;
    s_active_cycle.version++;
    persist_cycle();
    ESP_LOGI(TAG, "Cycle %s cancelled.", s_active_cycle.cycle_id);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_harvest(const char *gh_id, const char *harvest_date, float yield_kg, const char *grade, const char *notes)
{
    s_active_cycle.status = CYCLE_STATE_HARVESTED;
    s_active_cycle.has_harvest = true;
    if (harvest_date) strncpy(s_active_cycle.harvest_date, harvest_date, sizeof(s_active_cycle.harvest_date) - 1);
    s_active_cycle.yield_kg = (yield_kg > 0) ? yield_kg : 300.0f;
    if (grade) strncpy(s_active_cycle.grade, grade, sizeof(s_active_cycle.grade) - 1);
    if (notes) strncpy(s_active_cycle.harvest_notes, notes, sizeof(s_active_cycle.harvest_notes) - 1);

    s_active_cycle.version++;
    persist_cycle();
    ESP_LOGI(TAG, "Cycle %s harvested. Yield: %.1f kg, Grade: %s",
             s_active_cycle.cycle_id, s_active_cycle.yield_kg, s_active_cycle.grade);
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
