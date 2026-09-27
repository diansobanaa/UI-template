#include "storage/recipe_storage.h"
#include "hal/sdcard_hal.h"
#include "esp_log.h"
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <dirent.h>
#include <unistd.h>
#include <stdlib.h>
#include <ctype.h>

static const char *TAG = "RECIPE_STORAGE";
static const char *RECIPES_DIR = "/sdcard/recipes";

static bool is_safe_recipe_id(const char *id)
{
    if (!id || strlen(id) == 0 || strlen(id) > 64) return false;
    if (strstr(id, "..") != NULL || strchr(id, '/') != NULL || strchr(id, '\\') != NULL) return false;
    for (size_t i = 0; id[i] != '\0'; i++) {
        unsigned char c = (unsigned char)id[i];
        if (!isalnum(c) && c != '-' && c != '_' && c != '.') {
            return false;
        }
    }
    return true;
}

static esp_err_t ensure_recipes_dir(void)
{
    if (!sdcard_hal_is_mounted()) return ESP_ERR_NOT_FOUND;
    struct stat st;
    if (stat(RECIPES_DIR, &st) != 0) {
        if (mkdir(RECIPES_DIR, 0755) != 0) {
            ESP_LOGW(TAG, "Failed to create directory %s", RECIPES_DIR);
            return ESP_FAIL;
        }
    }
    return ESP_OK;
}

esp_err_t recipe_storage_init(void)
{
    ESP_LOGI(TAG, "Initializing recipe storage subsystem...");
    if (sdcard_hal_is_mounted()) {
        sdcard_hal_lock();
        ensure_recipes_dir();
        sdcard_hal_unlock();
        ESP_LOGI(TAG, "MicroSD mounted. Recipe store active at %s", RECIPES_DIR);
    } else {
        ESP_LOGW(TAG, "MicroSD not mounted. Recipe store in degraded WRITE_TO_NOTHING mode.");
    }
    return ESP_OK;
}

bool recipe_storage_is_available(void)
{
    return sdcard_hal_is_mounted();
}

esp_err_t recipe_storage_list(cJSON **out_array)
{
    if (!out_array) return ESP_ERR_INVALID_ARG;

    if (!sdcard_hal_is_mounted()) {
        *out_array = cJSON_CreateArray();
        return ESP_ERR_NOT_FOUND;
    }

    sdcard_hal_lock();
    ensure_recipes_dir();

    DIR *d = opendir(RECIPES_DIR);
    if (!d) {
        sdcard_hal_unlock();
        *out_array = cJSON_CreateArray();
        return ESP_OK;
    }

    cJSON *arr = cJSON_CreateArray();
    struct dirent *entry;
    while ((entry = readdir(d)) != NULL) {
        size_t len = strlen(entry->d_name);
        if (len > 5 && strcmp(entry->d_name + len - 5, ".json") == 0) {
            char filepath[320];
            snprintf(filepath, sizeof(filepath), "%s/%s", RECIPES_DIR, entry->d_name);
            FILE *f = fopen(filepath, "r");
            if (f) {
                fseek(f, 0, SEEK_END);
                long sz = ftell(f);
                fseek(f, 0, SEEK_SET);
                if (sz > 0 && sz < 32768) {
                    char *buf = malloc((size_t)sz + 1);
                    if (buf) {
                        size_t rd = fread(buf, 1, (size_t)sz, f);
                        buf[rd] = '\0';
                        cJSON *item = cJSON_Parse(buf);
                        if (item) {
                            cJSON_AddItemToArray(arr, item);
                        }
                        free(buf);
                    }
                }
                fclose(f);
            }
        }
    }
    closedir(d);
    sdcard_hal_unlock();

    *out_array = arr;
    return ESP_OK;
}

esp_err_t recipe_storage_get(const char *recipe_id, cJSON **out_recipe)
{
    if (!is_safe_recipe_id(recipe_id) || !out_recipe) return ESP_ERR_INVALID_ARG;

    if (!sdcard_hal_is_mounted()) {
        *out_recipe = NULL;
        return ESP_ERR_NOT_FOUND;
    }

    sdcard_hal_lock();
    char filepath[320];
    snprintf(filepath, sizeof(filepath), "%s/%s.json", RECIPES_DIR, recipe_id);
    FILE *f = fopen(filepath, "r");
    if (!f) {
        sdcard_hal_unlock();
        *out_recipe = NULL;
        return ESP_ERR_NOT_FOUND;
    }

    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (sz <= 0 || sz >= 32768) {
        fclose(f);
        sdcard_hal_unlock();
        *out_recipe = NULL;
        return ESP_ERR_INVALID_SIZE;
    }

    char *buf = malloc((size_t)sz + 1);
    if (!buf) {
        fclose(f);
        sdcard_hal_unlock();
        *out_recipe = NULL;
        return ESP_ERR_NO_MEM;
    }

    size_t rd = fread(buf, 1, (size_t)sz, f);
    buf[rd] = '\0';
    fclose(f);
    sdcard_hal_unlock();

    cJSON *parsed = cJSON_Parse(buf);
    free(buf);
    if (!parsed) {
        *out_recipe = NULL;
        return ESP_ERR_INVALID_STATE;
    }

    *out_recipe = parsed;
    return ESP_OK;
}

esp_err_t recipe_storage_save(const char *recipe_id, const cJSON *recipe_json)
{
    if (!is_safe_recipe_id(recipe_id) || !recipe_json) return ESP_ERR_INVALID_ARG;

    if (!sdcard_hal_is_mounted()) {
        ESP_LOGW(TAG, "SD Card unavailable. Discarding recipe save (WRITE_TO_NOTHING) for '%s'.", recipe_id);
        return ESP_ERR_NOT_FOUND;
    }

    char *serialized = cJSON_PrintUnformatted(recipe_json);
    if (!serialized) return ESP_ERR_NO_MEM;

    sdcard_hal_lock();
    ensure_recipes_dir();

    char filepath[320];
    snprintf(filepath, sizeof(filepath), "%s/%s.json", RECIPES_DIR, recipe_id);

    FILE *f = fopen(filepath, "w");
    if (!f) {
        sdcard_hal_unlock();
        free(serialized);
        ESP_LOGE(TAG, "Failed to open '%s' for writing", filepath);
        return ESP_FAIL;
    }

    size_t len = strlen(serialized);
    size_t written = fwrite(serialized, 1, len, f);
    fclose(f);
    sdcard_hal_unlock();
    free(serialized);

    if (written != len) {
        ESP_LOGE(TAG, "Incomplete write to '%s' (%u of %u bytes)", filepath, (unsigned)written, (unsigned)len);
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Successfully persisted recipe '%s' to MicroSD (%u bytes)", recipe_id, (unsigned)written);
    return ESP_OK;
}

esp_err_t recipe_storage_delete(const char *recipe_id)
{
    if (!is_safe_recipe_id(recipe_id)) return ESP_ERR_INVALID_ARG;

    if (!sdcard_hal_is_mounted()) {
        return ESP_ERR_NOT_FOUND;
    }

    sdcard_hal_lock();
    char filepath[320];
    snprintf(filepath, sizeof(filepath), "%s/%s.json", RECIPES_DIR, recipe_id);

    int ret = unlink(filepath);
    sdcard_hal_unlock();

    if (ret != 0) {
        return ESP_ERR_NOT_FOUND;
    }

    ESP_LOGI(TAG, "Successfully deleted recipe '%s' from MicroSD", recipe_id);
    return ESP_OK;
}
