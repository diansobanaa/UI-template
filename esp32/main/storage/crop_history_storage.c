#include "storage/crop_history_storage.h"
#include "hal/sdcard_hal.h"
#include "esp_log.h"
#include "cJSON.h"
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <dirent.h>
#include <unistd.h>
#include <stdlib.h>

static const char *TAG = "CROP_HIST_STORAGE";

static esp_err_t ensure_dir(const char *dir)
{
    if (!dir || strlen(dir) == 0) return ESP_ERR_INVALID_ARG;
    struct stat st;
    if (stat(dir, &st) == 0) {
        if (S_ISDIR(st.st_mode)) return ESP_OK;
        return ESP_FAIL;
    }
    char tmp[256];
    snprintf(tmp, sizeof(tmp), "%s", dir);
    size_t len = strlen(tmp);
    if (tmp[len - 1] == '/') tmp[len - 1] = '\0';

    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            if (stat(tmp, &st) != 0) {
                mkdir(tmp, 0755);
            }
            *p = '/';
        }
    }
    if (mkdir(tmp, 0755) != 0 && stat(tmp, &st) != 0) {
        return ESP_FAIL;
    }
    return ESP_OK;
}

esp_err_t crop_history_storage_init(void)
{
    if (!sdcard_hal_is_mounted()) {
        ESP_LOGI(TAG, "SD card not mounted. Historical storage operating in degraded mode.");
        return ESP_OK;
    }
    sdcard_hal_lock();
    ensure_dir(CROP_HIST_CYCLES_DIR);
    ensure_dir(CROP_HIST_PLANTS_DIR);
    sdcard_hal_unlock();
    ESP_LOGI(TAG, "Crop history SD storage initialized at %s", CROP_HIST_SD_BASE_DIR);
    return ESP_OK;
}

bool crop_history_storage_is_available(void)
{
    return sdcard_hal_is_mounted();
}

esp_err_t crop_history_storage_archive_cycle(const crop_cycle_record_t *record, const char *timeline_json)
{
    if (!record || !record->cycle_id[0] || !record->gh_id[0]) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!sdcard_hal_is_mounted()) {
        ESP_LOGW(TAG, "Cannot archive cycle %s: SD card not mounted (degraded mode)", record->cycle_id);
        return ESP_ERR_NOT_FOUND;
    }

    sdcard_hal_lock();
    ensure_dir(CROP_HIST_CYCLES_DIR);
    ensure_dir(CROP_HIST_PLANTS_DIR);

    /* Build JSON representation for the archived cycle */
    cJSON *root = crop_cycle_mgr_to_json(record);
    if (!root) {
        sdcard_hal_unlock();
        return ESP_ERR_NO_MEM;
    }
    if (timeline_json && timeline_json[0]) {
        cJSON *tl = cJSON_Parse(timeline_json);
        if (tl) {
            cJSON_ReplaceItemInObject(root, "cropTimelineConfig", tl);
        }
    }
    cJSON_AddBoolToObject(root, "isArchived", true);

    char *json_str = cJSON_Print(root);
    cJSON_Delete(root);
    if (!json_str) {
        sdcard_hal_unlock();
        return ESP_ERR_NO_MEM;
    }

    /* Target path: /sdcard/agrotech/crop_cycles/history/<ghId>_<cycleId>.json */
    char path[256];
    char temp_path[264];
    snprintf(path, sizeof(path), "%s/%s_%s.json", CROP_HIST_CYCLES_DIR, record->gh_id, record->cycle_id);
    snprintf(temp_path, sizeof(temp_path), "%s.tmp", path);

    FILE *f = fopen(temp_path, "w");
    if (!f) {
        free(json_str);
        sdcard_hal_unlock();
        ESP_LOGE(TAG, "Failed to open temporary archive file %s", temp_path);
        return ESP_FAIL;
    }

    size_t written = fwrite(json_str, 1, strlen(json_str), f);
    fflush(f);
    fclose(f);
    size_t expected = strlen(json_str);
    free(json_str);

    /* Verify written size matches expected */
    struct stat st;
    if (written != expected || stat(temp_path, &st) != 0 || (size_t)st.st_size != expected) {
        unlink(temp_path);
        sdcard_hal_unlock();
        ESP_LOGE(TAG, "Archive verification failed for %s: written=%zu, expected=%zu", temp_path, written, expected);
        return ESP_FAIL;
    }

    /* Atomic rename */
    if (rename(temp_path, path) != 0) {
        unlink(temp_path);
        sdcard_hal_unlock();
        ESP_LOGE(TAG, "Failed to rename %s to %s", temp_path, path);
        return ESP_FAIL;
    }

    /* Archive plant record separately to /sdcard/agrotech/plants/history/<ghId>_<cycleId>_plants.json */
    char plant_path[256];
    snprintf(plant_path, sizeof(plant_path), "%s/%s_%s_plants.json", CROP_HIST_PLANTS_DIR, record->gh_id, record->cycle_id);
    cJSON *plant_doc = cJSON_CreateObject();
    if (plant_doc) {
        cJSON_AddStringToObject(plant_doc, "ghId", record->gh_id);
        cJSON_AddStringToObject(plant_doc, "cycleId", record->cycle_id);
        cJSON_AddStringToObject(plant_doc, "variety", record->variety);
        cJSON_AddNumberToObject(plant_doc, "totalPlanted", record->plant_count);
        cJSON_AddStringToObject(plant_doc, "harvestDate", record->harvest_date);
        if (record->has_yield) {
            cJSON_AddNumberToObject(plant_doc, "yieldKg", record->yield_kg);
            cJSON_AddStringToObject(plant_doc, "grade", record->grade);
        }
        char *plant_str = cJSON_Print(plant_doc);
        cJSON_Delete(plant_doc);
        if (plant_str) {
            FILE *pf = fopen(plant_path, "w");
            if (pf) {
                fputs(plant_str, pf);
                fclose(pf);
            }
            free(plant_str);
        }
    }

    sdcard_hal_unlock();
    ESP_LOGI(TAG, "Successfully archived cycle %s to SD (%zu bytes verified)", record->cycle_id, expected);
    return ESP_OK;
}

esp_err_t crop_history_storage_list_historical(const char *gh_id, cJSON **out_array, size_t limit, size_t offset)
{
    if (!out_array) return ESP_ERR_INVALID_ARG;
    *out_array = cJSON_CreateArray();
    if (!*out_array) return ESP_ERR_NO_MEM;

    if (!sdcard_hal_is_mounted()) {
        return ESP_ERR_NOT_FOUND;
    }

    sdcard_hal_lock();
    DIR *d = opendir(CROP_HIST_CYCLES_DIR);
    if (!d) {
        sdcard_hal_unlock();
        return ESP_OK;
    }

    if (limit == 0) limit = 20;
    size_t matched_count = 0;
    size_t added_count = 0;
    struct dirent *entry;

    char prefix[64] = "";
    if (gh_id && gh_id[0]) {
        snprintf(prefix, sizeof(prefix), "%s_", gh_id);
    }

    while ((entry = readdir(d)) != NULL && added_count < limit) {
        if (entry->d_name[0] == '.') continue;
        if (!strstr(entry->d_name, ".json")) continue;
        if (prefix[0] && strncmp(entry->d_name, prefix, strlen(prefix)) != 0) continue;

        if (matched_count < offset) {
            matched_count++;
            continue;
        }

        char filepath[512];
        snprintf(filepath, sizeof(filepath), "%s/%s", CROP_HIST_CYCLES_DIR, entry->d_name);

        FILE *f = fopen(filepath, "r");
        if (f) {
            fseek(f, 0, SEEK_END);
            long sz = ftell(f);
            fseek(f, 0, SEEK_SET);

            if (sz > 0 && sz < 16384) {
                char *buf = malloc(sz + 1);
                if (buf) {
                    size_t r = fread(buf, 1, sz, f);
                    buf[r] = '\0';
                    cJSON *item = cJSON_Parse(buf);
                    if (item) {
                        cJSON_AddItemToArray(*out_array, item);
                        added_count++;
                    }
                    free(buf);
                }
            }
            fclose(f);
        }
        matched_count++;
    }

    closedir(d);
    sdcard_hal_unlock();
    return ESP_OK;
}

esp_err_t crop_history_storage_delete_cycle(const char *gh_id, const char *cycle_id)
{
    if (!gh_id || !cycle_id || !sdcard_hal_is_mounted()) {
        return ESP_ERR_INVALID_ARG;
    }

    sdcard_hal_lock();
    char path[256];
    snprintf(path, sizeof(path), "%s/%s_%s.json", CROP_HIST_CYCLES_DIR, gh_id, cycle_id);
    int rc = unlink(path);

    char plant_path[256];
    snprintf(plant_path, sizeof(plant_path), "%s/%s_%s_plants.json", CROP_HIST_PLANTS_DIR, gh_id, cycle_id);
    unlink(plant_path);

    sdcard_hal_unlock();
    return rc == 0 ? ESP_OK : ESP_FAIL;
}

size_t crop_history_storage_count_historical(const char *gh_id)
{
    if (!sdcard_hal_is_mounted()) return 0;

    sdcard_hal_lock();
    DIR *d = opendir(CROP_HIST_CYCLES_DIR);
    if (!d) {
        sdcard_hal_unlock();
        return 0;
    }

    size_t count = 0;
    char prefix[32] = "";
    if (gh_id && gh_id[0]) {
        snprintf(prefix, sizeof(prefix), "%s_", gh_id);
    }

    struct dirent *entry;
    while ((entry = readdir(d)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        if (!strstr(entry->d_name, ".json")) continue;
        if (prefix[0] && strncmp(entry->d_name, prefix, strlen(prefix)) != 0) continue;
        count++;
    }

    closedir(d);
    sdcard_hal_unlock();
    return count;
}
