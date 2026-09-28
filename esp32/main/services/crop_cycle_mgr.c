#include "services/crop_cycle_mgr.h"
#include "storage/crop_history_storage.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "nvs.h"
#include <string.h>
#include <time.h>
#include <stdio.h>
#include <stdlib.h>

static const char *TAG = "CROPCYCLE_MGR";
static const char *NVS_NAMESPACE = "agrotech_cc";

static void get_nvs_key(const char *gh_id, char *out_key, size_t max_len)
{
    if (!gh_id || !gh_id[0]) {
        snprintf(out_key, max_len, "cc_default");
        return;
    }
    snprintf(out_key, max_len, "cc_%.12s", gh_id);
}

static void clear_record(crop_cycle_record_t *c, const char *gh_id)
{
    if (!c) return;
    memset(c, 0, sizeof(*c));
    c->status = CYCLE_STATE_NO_CYCLE;
    c->hst = -1;
    c->hsp = -1;
    c->target_harvest_hst = 0;
    if (gh_id) snprintf(c->gh_id, sizeof(c->gh_id), "%s", gh_id);
}

static int days_between(const char *date_str)
{
    if (!date_str || strlen(date_str) < 10) return -1;
    int y = 0, m = 0, d = 0;
    if (sscanf(date_str, "%d-%d-%d", &y, &m, &d) != 3) return -1;
    struct tm t = {
        .tm_year = y - 1900,
        .tm_mon = m - 1,
        .tm_mday = d,
        .tm_hour = 12,
        .tm_isdst = -1
    };
    time_t target = mktime(&t);
    time_t now = time(NULL);
    if (target == (time_t)-1 || now == (time_t)-1) return -1;
    double diff = difftime(now, target);
    return diff < 0 ? 0 : (int)(diff / 86400.0);
}

static void now_iso(char out[32])
{
    time_t now = time(NULL);
    if (now > 1600000000) {
        strftime(out, 32, "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    } else {
        snprintf(out, 32, "1970-01-01T00:00:00Z");
    }
}

static void now_date(char out[16])
{
    time_t now = time(NULL);
    if (now > 1600000000) {
        strftime(out, 16, "%Y-%m-%d", gmtime(&now));
    } else {
        snprintf(out, 16, "1970-01-01");
    }
}

static void recompute(crop_cycle_record_t *c)
{
    if (!c) return;
    c->hst = (c->status == CYCLE_STATE_ACTIVE && c->tanggal_tanam[0]) ? days_between(c->tanggal_tanam) : -1;
    c->hsp = (c->status == CYCLE_STATE_ACTIVE && c->tanggal_polinasi[0]) ? days_between(c->tanggal_polinasi) : -1;
    c->has_hsp = c->hsp >= 0;
}

/* Load strictly the active cycle for a single GH from NVS */
static esp_err_t load_active_nvs(const char *gh_id, crop_cycle_record_t *out)
{
    if (!gh_id || !out) return ESP_ERR_INVALID_ARG;
    clear_record(out, gh_id);

    char key[16];
    get_nvs_key(gh_id, key, sizeof(key));

    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &h);
    if (err != ESP_OK) return err;

    size_t sz = sizeof(*out);
    err = nvs_get_blob(h, key, out, &sz);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        /* Check legacy single key active_cc if gh_id matches */
        crop_cycle_record_t leg;
        size_t lsz = sizeof(leg);
        if (nvs_get_blob(h, "active_cc", &leg, &lsz) == ESP_OK && strcmp(leg.gh_id, gh_id) == 0) {
            *out = leg;
            err = ESP_OK;
        }
    }
    nvs_close(h);

    if (err == ESP_OK && out->status == CYCLE_STATE_ACTIVE) {
        recompute(out);
        return ESP_OK;
    }
    clear_record(out, gh_id);
    return ESP_ERR_NOT_FOUND;
}

/* Save strictly the active cycle (~466 bytes) to NVS */
static esp_err_t save_active_nvs(const char *gh_id, const crop_cycle_record_t *rec)
{
    if (!gh_id || !rec) return ESP_ERR_INVALID_ARG;
    char key[16];
    get_nvs_key(gh_id, key, sizeof(key));

    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;

    err = nvs_set_blob(h, key, rec, sizeof(*rec));
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    return err;
}

/* Erase active cycle from NVS when completed/archived */
static esp_err_t erase_active_nvs(const char *gh_id)
{
    if (!gh_id) return ESP_ERR_INVALID_ARG;
    char key[16];
    get_nvs_key(gh_id, key, sizeof(key));

    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;

    nvs_erase_key(h, key);
    nvs_erase_key(h, "active_cc");
    nvs_commit(h);
    nvs_close(h);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_init(void)
{
    /* Initialize historical SD archive storage */
    crop_history_storage_init();
    ESP_LOGI(TAG, "Crop cycle manager initialized (3-tier memory model: NVS active-only, SD historical bulk, RAM transient)");
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_get_current(const char *gh_id, crop_cycle_record_t *out)
{
    if (!gh_id || !out) return ESP_ERR_INVALID_ARG;
    clear_record(out, gh_id);
    esp_err_t err = load_active_nvs(gh_id, out);
    if (err != ESP_OK) {
        clear_record(out, gh_id);
    }
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_list(const char *gh_id, cJSON **out_items)
{
    if (!out_items || !gh_id || !gh_id[0]) return ESP_ERR_INVALID_ARG;
    *out_items = cJSON_CreateArray();
    if (!*out_items) return ESP_ERR_NO_MEM;

    /* 1. Add current active cycle from NVS if one exists */
    crop_cycle_record_t act;
    if (load_active_nvs(gh_id, &act) == ESP_OK && act.status == CYCLE_STATE_ACTIVE) {
        cJSON_AddItemToArray(*out_items, crop_cycle_mgr_to_json(&act));
    }

    /* 2. Read historical cycles from SD storage */
    cJSON *hist = NULL;
    if (crop_history_storage_list_historical(gh_id, &hist, 20, 0) == ESP_OK && hist) {
        int sz = cJSON_GetArraySize(hist);
        for (int i = 0; i < sz; i++) {
            cJSON *item = cJSON_GetArrayItem(hist, i);
            if (item) {
                cJSON_AddItemToArray(*out_items, cJSON_Duplicate(item, 1));
            }
        }
        cJSON_Delete(hist);
    }

    return ESP_OK;
}

esp_err_t crop_cycle_mgr_start(const char *gh_id, const char *tanggal_tanam, const char *variety, uint32_t plant_count, const char *notes)
{
    if (!gh_id || !gh_id[0] || !tanggal_tanam || strlen(tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;

    /* Verify no active cycle in NVS */
    crop_cycle_record_t existing;
    if (load_active_nvs(gh_id, &existing) == ESP_OK && existing.status == CYCLE_STATE_ACTIVE) {
        return ESP_ERR_INVALID_STATE;
    }

    crop_cycle_record_t rec;
    clear_record(&rec, gh_id);
    snprintf(rec.cycle_id, sizeof(rec.cycle_id), "cc-%llu", (unsigned long long)time(NULL));
    rec.status = CYCLE_STATE_ACTIVE;
    snprintf(rec.tanggal_tanam, sizeof(rec.tanggal_tanam), "%s", tanggal_tanam);
    if (variety) snprintf(rec.variety, sizeof(rec.variety), "%s", variety);
    rec.plant_count = plant_count;
    if (notes) snprintf(rec.notes, sizeof(rec.notes), "%s", notes);
    rec.version = 1;
    rec.has_harvest = false;
    rec.has_yield = false;
    recompute(&rec);

    esp_err_t err = save_active_nvs(gh_id, &rec);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to persist new active cycle in NVS (err=0x%x)", err);
        return ESP_FAIL;
    }
    ESP_LOGI(TAG, "Started active cycle %s in %s (Tanam: %s, Variety: %s)", rec.cycle_id, gh_id, rec.tanggal_tanam, rec.variety);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_import_active(const char *gh_id, const char *tanggal_tanam, const char *tanggal_polinasi, const char *variety, uint32_t plant_count, const char *notes)
{
    if (!gh_id || !gh_id[0] || !tanggal_tanam || strlen(tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;

    crop_cycle_record_t existing;
    if (load_active_nvs(gh_id, &existing) == ESP_OK && existing.status == CYCLE_STATE_ACTIVE) {
        return ESP_ERR_INVALID_STATE;
    }

    crop_cycle_record_t rec;
    clear_record(&rec, gh_id);
    snprintf(rec.cycle_id, sizeof(rec.cycle_id), "import-%llu", (unsigned long long)time(NULL));
    rec.status = CYCLE_STATE_ACTIVE;
    snprintf(rec.tanggal_tanam, sizeof(rec.tanggal_tanam), "%s", tanggal_tanam);
    if (tanggal_polinasi && strlen(tanggal_polinasi) >= 10) {
        snprintf(rec.tanggal_polinasi, sizeof(rec.tanggal_polinasi), "%s", tanggal_polinasi);
    }
    if (variety) snprintf(rec.variety, sizeof(rec.variety), "%s", variety);
    rec.plant_count = plant_count;
    if (notes) snprintf(rec.notes, sizeof(rec.notes), "%s", notes);
    rec.version = 1;
    recompute(&rec);

    esp_err_t err = save_active_nvs(gh_id, &rec);
    if (err != ESP_OK) return ESP_FAIL;
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_set_pollination_with_version(const char *gh_id, const char *tanggal_polinasi, const char *method, uint32_t expected_version)
{
    (void)method;
    if (!gh_id || !tanggal_polinasi || strlen(tanggal_polinasi) < 10) return ESP_ERR_INVALID_ARG;

    crop_cycle_record_t rec;
    if (load_active_nvs(gh_id, &rec) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (expected_version != 0 && rec.version != expected_version) {
        ESP_LOGW(TAG, "Pollination update rejected: version mismatch (expected=%lu, actual=%lu) for gh=%s",
                 (unsigned long)expected_version, (unsigned long)rec.version, gh_id);
        return ESP_ERR_INVALID_VERSION;
    }
    if (strcmp(tanggal_polinasi, rec.tanggal_tanam) < 0) return ESP_ERR_INVALID_ARG;

    snprintf(rec.tanggal_polinasi, sizeof(rec.tanggal_polinasi), "%s", tanggal_polinasi);
    rec.version++;
    recompute(&rec);
    return save_active_nvs(gh_id, &rec);
}

esp_err_t crop_cycle_mgr_set_pollination(const char *gh_id, const char *tanggal_polinasi, const char *method)
{
    return crop_cycle_mgr_set_pollination_with_version(gh_id, tanggal_polinasi, method, 0);
}

esp_err_t crop_cycle_mgr_delete_pollination_with_version(const char *gh_id, uint32_t expected_version)
{
    crop_cycle_record_t rec;
    if (load_active_nvs(gh_id, &rec) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (expected_version != 0 && rec.version != expected_version) {
        ESP_LOGW(TAG, "Pollination delete rejected: version mismatch (expected=%lu, actual=%lu) for gh=%s",
                 (unsigned long)expected_version, (unsigned long)rec.version, gh_id);
        return ESP_ERR_INVALID_VERSION;
    }

    rec.tanggal_polinasi[0] = '\0';
    rec.version++;
    recompute(&rec);
    return save_active_nvs(gh_id, &rec);
}

esp_err_t crop_cycle_mgr_delete_pollination(const char *gh_id)
{
    return crop_cycle_mgr_delete_pollination_with_version(gh_id, 0);
}

esp_err_t crop_cycle_mgr_update_planting_date_with_version(const char *gh_id, const char *new_tanggal_tanam, uint32_t expected_version)
{
    if (!gh_id || !new_tanggal_tanam || strlen(new_tanggal_tanam) < 10) return ESP_ERR_INVALID_ARG;

    crop_cycle_record_t rec;
    if (load_active_nvs(gh_id, &rec) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (expected_version != 0 && rec.version != expected_version) {
        ESP_LOGW(TAG, "Planting date update rejected: version mismatch (expected=%lu, actual=%lu) for gh=%s",
                 (unsigned long)expected_version, (unsigned long)rec.version, gh_id);
        return ESP_ERR_INVALID_VERSION;
    }
    if (rec.tanggal_polinasi[0] && strcmp(rec.tanggal_polinasi, new_tanggal_tanam) < 0) {
        return ESP_ERR_INVALID_ARG;
    }

    snprintf(rec.tanggal_tanam, sizeof(rec.tanggal_tanam), "%s", new_tanggal_tanam);
    rec.version++;
    recompute(&rec);

    esp_err_t err = save_active_nvs(gh_id, &rec);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to save active planting date to NVS (err=0x%x)", err);
        return err;
    }
    ESP_LOGI(TAG, "Updated active planting date to %s for %s (HST=%ld, v=%lu)", rec.tanggal_tanam, gh_id, (long)rec.hst, (unsigned long)rec.version);
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_update_planting_date(const char *gh_id, const char *new_tanggal_tanam)
{
    return crop_cycle_mgr_update_planting_date_with_version(gh_id, new_tanggal_tanam, 0);
}

esp_err_t crop_cycle_mgr_save_timeline(const char *gh_id, const char *timeline_json_str)
{
    if (!gh_id || !gh_id[0] || !timeline_json_str) return ESP_ERR_INVALID_ARG;
    char nvs_key[16];
    snprintf(nvs_key, sizeof(nvs_key), "tl_%.12s", gh_id);
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_str(h, nvs_key, timeline_json_str);
        nvs_commit(h);
        nvs_close(h);
    }
    char filepath[64];
    snprintf(filepath, sizeof(filepath), "/spiffs/tl_%s.json", gh_id);
    FILE *f = fopen(filepath, "w");
    if (f) {
        fputs(timeline_json_str, f);
        fclose(f);
    }
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_get_timeline(const char *gh_id, char *out_buf, size_t max_len)
{
    if (!gh_id || !gh_id[0] || !out_buf || max_len < 2) return ESP_ERR_INVALID_ARG;

    // CRASH-FIX: fopen needs internal heap for FILE struct. When internal heap
    // is critically low (<8KB), fopen can crash inside VFS/SPIFFS layer.
    // Skip fopen and return NOT_FOUND — timeline is optional, not safety-critical.
    if (heap_caps_get_free_size(MALLOC_CAP_INTERNAL) < 8192) {
        return ESP_ERR_NOT_FOUND;
    }

    char nvs_key[16];
    snprintf(nvs_key, sizeof(nvs_key), "tl_%.12s", gh_id);
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &h) == ESP_OK) {
        size_t required_size = max_len;
        if (nvs_get_str(h, nvs_key, out_buf, &required_size) == ESP_OK && out_buf[0]) {
            nvs_close(h);
            return ESP_OK;
        }
        nvs_close(h);
    }
    char filepath[64];
    snprintf(filepath, sizeof(filepath), "/spiffs/tl_%s.json", gh_id);
    FILE *f = fopen(filepath, "r");
    if (f) {
        size_t r = fread(out_buf, 1, max_len - 1, f);
        out_buf[r] = '\0';
        fclose(f);
        if (r > 0) return ESP_OK;
    }
    return ESP_ERR_NOT_FOUND;
}

esp_err_t crop_cycle_mgr_update_metadata_v2_with_version(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes, uint32_t target_harvest_hst, const char *timeline_json_str, uint32_t expected_version)
{
    crop_cycle_record_t rec;
    if (load_active_nvs(gh_id, &rec) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (expected_version != 0 && rec.version != expected_version) {
        ESP_LOGW(TAG, "Metadata update rejected: version mismatch (expected=%lu, actual=%lu) for gh=%s",
                 (unsigned long)expected_version, (unsigned long)rec.version, gh_id);
        return ESP_ERR_INVALID_VERSION;
    }

    if (variety && variety[0]) snprintf(rec.variety, sizeof(rec.variety), "%s", variety);
    if (plant_count > 0) rec.plant_count = plant_count;
    if (notes) snprintf(rec.notes, sizeof(rec.notes), "%s", notes);
    if (target_harvest_hst > 0) rec.target_harvest_hst = target_harvest_hst;
    rec.version++;

    if (timeline_json_str && timeline_json_str[0]) {
        crop_cycle_mgr_save_timeline(gh_id, timeline_json_str);
    }
    return save_active_nvs(gh_id, &rec);
}

esp_err_t crop_cycle_mgr_update_metadata_v2(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes, uint32_t target_harvest_hst, const char *timeline_json_str)
{
    return crop_cycle_mgr_update_metadata_v2_with_version(gh_id, variety, plant_count, notes, target_harvest_hst, timeline_json_str, 0);
}

esp_err_t crop_cycle_mgr_update_metadata(const char *gh_id, const char *variety, uint32_t plant_count, const char *notes)
{
    return crop_cycle_mgr_update_metadata_v2(gh_id, variety, plant_count, notes, 0, NULL);
}

esp_err_t crop_cycle_mgr_cancel_with_version(const char *gh_id, uint32_t expected_version)
{
    crop_cycle_record_t rec;
    if (load_active_nvs(gh_id, &rec) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (expected_version != 0 && rec.version != expected_version) {
        ESP_LOGW(TAG, "Cancel rejected: version mismatch (expected=%lu, actual=%lu) for gh=%s",
                 (unsigned long)expected_version, (unsigned long)rec.version, gh_id);
        return ESP_ERR_INVALID_VERSION;
    }

    rec.status = CYCLE_STATE_CANCELLED;
    rec.version++;
    recompute(&rec);

    /* Archive to SD */
    char tl_buf[2048] = "";
    crop_cycle_mgr_get_timeline(gh_id, tl_buf, sizeof(tl_buf));
    esp_err_t arch_err = crop_history_storage_archive_cycle(&rec, tl_buf[0] ? tl_buf : NULL);

    /* Only erase active NVS if archived or if running in degraded mode */
    if (arch_err == ESP_OK || !crop_history_storage_is_available()) {
        erase_active_nvs(gh_id);
        ESP_LOGI(TAG, "Cycle %s cancelled and archived", rec.cycle_id);
    } else {
        ESP_LOGW(TAG, "Cycle %s cancelled but archive failed; retaining NVS state for recovery", rec.cycle_id);
        save_active_nvs(gh_id, &rec);
    }
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_cancel(const char *gh_id)
{
    return crop_cycle_mgr_cancel_with_version(gh_id, 0);
}

esp_err_t crop_cycle_mgr_harvest_with_version(const char *gh_id, const char *harvest_date, float yield_kg, bool has_yield, const char *grade, const char *notes, uint32_t expected_version)
{
    crop_cycle_record_t rec;
    if (load_active_nvs(gh_id, &rec) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (expected_version != 0 && rec.version != expected_version) {
        ESP_LOGW(TAG, "Harvest rejected: version mismatch (expected=%lu, actual=%lu) for gh=%s",
                 (unsigned long)expected_version, (unsigned long)rec.version, gh_id);
        return ESP_ERR_INVALID_VERSION;
    }

    rec.status = CYCLE_STATE_HARVESTED;
    rec.has_harvest = true;
    rec.has_yield = has_yield && yield_kg >= 0;
    if (harvest_date && strlen(harvest_date) >= 10) snprintf(rec.harvest_date, sizeof(rec.harvest_date), "%s", harvest_date);
    else now_date(rec.harvest_date);
    if (grade) snprintf(rec.grade, sizeof(rec.grade), "%s", grade);
    if (notes) snprintf(rec.harvest_notes, sizeof(rec.harvest_notes), "%s", notes);
    rec.yield_kg = yield_kg;
    rec.version++;
    recompute(&rec);
    now_iso(rec.harvest_recorded_at);

    /* Archive to SD */
    char tl_buf[2048] = "";
    crop_cycle_mgr_get_timeline(gh_id, tl_buf, sizeof(tl_buf));
    esp_err_t arch_err = crop_history_storage_archive_cycle(&rec, tl_buf[0] ? tl_buf : NULL);

    /* Only erase active NVS if archived or if running in degraded mode */
    if (arch_err == ESP_OK || !crop_history_storage_is_available()) {
        erase_active_nvs(gh_id);
        ESP_LOGI(TAG, "Cycle %s harvested and archived (Yield: %.1f kg)", rec.cycle_id, rec.yield_kg);
    } else {
        ESP_LOGW(TAG, "Cycle %s harvested but archive failed; retaining NVS state for recovery", rec.cycle_id);
        save_active_nvs(gh_id, &rec);
    }
    return ESP_OK;
}

esp_err_t crop_cycle_mgr_harvest(const char *gh_id, const char *harvest_date, float yield_kg, bool has_yield, const char *grade, const char *notes)
{
    return crop_cycle_mgr_harvest_with_version(gh_id, harvest_date, yield_kg, has_yield, grade, notes, 0);
}

cJSON *crop_cycle_mgr_to_json(const crop_cycle_record_t *c)
{
    if (!c) return NULL;
    cJSON *r = cJSON_CreateObject();
    if (!r) return NULL;
    cJSON_AddStringToObject(r, "cycleId", c->cycle_id);
    cJSON_AddStringToObject(r, "ghId", c->gh_id);
    const char *ss = "NO_CYCLE";
    if (c->status == CYCLE_STATE_ACTIVE) ss = "ACTIVE";
    else if (c->status == CYCLE_STATE_HARVESTED) ss = "HARVESTED";
    else if (c->status == CYCLE_STATE_CANCELLED) ss = "CANCELLED";
    cJSON_AddStringToObject(r, "status", ss);

    if (c->tanggal_tanam[0]) cJSON_AddStringToObject(r, "tanggalTanam", c->tanggal_tanam);
    else cJSON_AddNullToObject(r, "tanggalTanam");

    if (c->tanggal_polinasi[0]) cJSON_AddStringToObject(r, "tanggalPolinasi", c->tanggal_polinasi);
    else cJSON_AddNullToObject(r, "tanggalPolinasi");

    cJSON_AddStringToObject(r, "variety", c->variety);
    cJSON_AddNumberToObject(r, "plantCount", c->plant_count);
    cJSON_AddStringToObject(r, "notes", c->notes);

    if (c->status == CYCLE_STATE_ACTIVE) {
        cJSON_AddNumberToObject(r, "hst", c->hst);
        if (c->has_hsp) cJSON_AddNumberToObject(r, "hsp", c->hsp);
        else cJSON_AddNullToObject(r, "hsp");
    } else {
        cJSON_AddNullToObject(r, "hst");
        cJSON_AddNullToObject(r, "hsp");
    }

    if (c->target_harvest_hst > 0) {
        cJSON_AddNumberToObject(r, "targetHarvestHst", c->target_harvest_hst);
    } else {
        cJSON_AddNullToObject(r, "targetHarvestHst");
    }

    /* HEAP-FIX (audit 2026-09-28): char tl_buf[2048] lived on the httpd
     * worker stack (4096 B) underneath the SPIFFS fopen chain -- estimated
     * peak ~5 KB, the overflow path behind the observed
     * "xTaskPriorityDisinherit (pxTCB->uxMutexesHeld)" panic in
     * handler_get_crop_cycle. Move it to PSRAM heap. Deliberately, NO task
     * stack size is changed by this patch. */
    char *tl_buf = (char *)heap_caps_malloc(2048, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (tl_buf && crop_cycle_mgr_get_timeline(c->gh_id, tl_buf, 2048) == ESP_OK) {
        cJSON *tl_obj = cJSON_Parse(tl_buf);
        if (tl_obj) {
            cJSON_AddItemToObject(r, "cropTimelineConfig", tl_obj);
        } else {
            cJSON_AddNullToObject(r, "cropTimelineConfig");
        }
    } else {
        cJSON_AddNullToObject(r, "cropTimelineConfig");
    }
    heap_caps_free(tl_buf); /* safe when NULL */

    cJSON_AddNumberToObject(r, "version", c->version);

    if (c->has_harvest) {
        cJSON *s = cJSON_AddObjectToObject(r, "lastHarvestSummary");
        if (c->harvest_date[0]) cJSON_AddStringToObject(s, "harvestDate", c->harvest_date);
        else cJSON_AddNullToObject(s, "harvestDate");
        cJSON_AddStringToObject(s, "tanggalTanam", c->tanggal_tanam);
        if (c->tanggal_polinasi[0]) cJSON_AddStringToObject(s, "tanggalPolinasi", c->tanggal_polinasi);
        else cJSON_AddNullToObject(s, "tanggalPolinasi");
        if (c->has_yield) cJSON_AddNumberToObject(s, "yieldKg", c->yield_kg);
        else cJSON_AddNullToObject(s, "yieldKg");
        if (c->grade[0]) cJSON_AddStringToObject(s, "grade", c->grade);
        else cJSON_AddNullToObject(s, "grade");
        if (c->harvest_notes[0]) cJSON_AddStringToObject(s, "notes", c->harvest_notes);
        else cJSON_AddNullToObject(s, "notes");
        cJSON_AddNumberToObject(s, "hstAtHarvest", c->hst >= 0 ? c->hst : 0);
        cJSON_AddNumberToObject(s, "hspAtHarvest", c->hsp >= 0 ? c->hsp : 0);
        if (c->harvest_recorded_at[0]) cJSON_AddStringToObject(s, "recordedAt", c->harvest_recorded_at);
    } else {
        cJSON_AddNullToObject(r, "lastHarvestSummary");
    }
    return r;
}
