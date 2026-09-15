#include "storage/storage_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_random.h"
#include "nvs.h"
#include "esp_rom_crc.h"
#include "esp_spiffs.h"
#include <string.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include "hal/sdcard_hal.h"

static const char *TAG = "STORAGE_MGR";
static const char *NVS_NAMESPACE = "agrotech";
static const char *EVENT_LOG_FILE = "/sdcard/events.log";
static const char *COMPONENTS_JSON_FILE = "/spiffs/components.json";

#define MAX_EVENT_LOG_BYTES (128 * 1024)

static system_storage_state_t s_state = {0};
static bool s_initialized = false;

static void generate_boot_id(char *out_uuid, size_t max_len)
{
    uint32_t r1 = esp_random();
    uint32_t r2 = esp_random();
    uint32_t r3 = esp_random();
    uint32_t r4 = esp_random();

    snprintf(out_uuid, max_len, "%08lx-%04lx-4%03lx-%04lx-%08lx%04lx",
             (unsigned long)r1,
             (unsigned long)(r2 >> 16),
             (unsigned long)(r2 & 0x0FFF),
             (unsigned long)((r3 >> 16) & 0x3FFF) | 0x8000,
             (unsigned long)(r3 & 0xFFFF),
             (unsigned long)(r4 & 0xFFFF));
}

esp_err_t storage_mgr_init(void)
{
    if (s_initialized) return ESP_OK;

    generate_boot_id(s_state.boot_id, sizeof(s_state.boot_id));

    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS namespace (0x%x)", err);
        return err;
    }

    /* 1. Device & Complex ID */
    size_t len = sizeof(s_state.device_id);
    if (nvs_get_str(handle, "dev_id", s_state.device_id, &len) != ESP_OK) {
        strncpy(s_state.device_id, DEFAULT_DEVICE_ID, sizeof(s_state.device_id) - 1);
        nvs_set_str(handle, "dev_id", s_state.device_id);
    }

    len = sizeof(s_state.complex_id);
    if (nvs_get_str(handle, "cplx_id", s_state.complex_id, &len) != ESP_OK) {
        strncpy(s_state.complex_id, DEFAULT_COMPLEX_ID, sizeof(s_state.complex_id) - 1);
        nvs_set_str(handle, "cplx_id", s_state.complex_id);
    }

    /* 2. Boot Counter */
    uint32_t boots = 0;
    nvs_get_u32(handle, "boot_cnt", &boots);
    boots++;
    s_state.boot_count = boots;
    nvs_set_u32(handle, "boot_cnt", boots);

    /* 3. Configuration Metadata */
    nvs_get_u32(handle, "cfg_ver", &s_state.config_version);
    nvs_get_u32(handle, "cfg_crc", &s_state.config_crc);

    /* 4. E-Stop Latch */
    uint8_t estop = 0;
    nvs_get_u8(handle, "estop", &estop);
    s_state.e_stop_latched = (estop != 0);

    nvs_commit(handle);
    nvs_close(handle);

    /* 5. Initialize & Mount SPIFFS storage */
    esp_vfs_spiffs_conf_t spiffs_conf = {
        .base_path = "/spiffs",
        .partition_label = "storage",
        .max_files = 8,
        .format_if_mount_failed = true
    };
    esp_err_t spiffs_ret = esp_vfs_spiffs_register(&spiffs_conf);
    if (spiffs_ret != ESP_OK) {
        ESP_LOGW(TAG, "SPIFFS mount failed (%s), will rely on NVS for components", esp_err_to_name(spiffs_ret));
    } else {
        ESP_LOGI(TAG, "SPIFFS mounted successfully at /spiffs");
    }

    s_state.safe_boot_active = true;
    s_initialized = true;

    ESP_LOGI(TAG, "Storage manager ready (NVS & SPIFFS persistent): Device='%s', Complex='%s', BootId='%s', Boots=%lu, ConfigVer=%lu",
             s_state.device_id, s_state.complex_id, s_state.boot_id,
             (unsigned long)s_state.boot_count, (unsigned long)s_state.config_version);

    return ESP_OK;
}

const system_storage_state_t *storage_mgr_get_state(void)
{
    return &s_state;
}

esp_err_t storage_mgr_load_config(char *out_buf, size_t max_len, size_t *out_len)
{
    if (!out_buf || max_len == 0) return ESP_ERR_INVALID_ARG;

    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) return err;

    size_t required_len = 0;
    err = nvs_get_str(handle, "lvc_json", NULL, &required_len);
    if (err != ESP_OK) {
        nvs_close(handle);
        return err;
    }

    if (required_len > max_len) {
        nvs_close(handle);
        return ESP_ERR_NO_MEM;
    }

    err = nvs_get_str(handle, "lvc_json", out_buf, &required_len);
    nvs_close(handle);

    if (err == ESP_OK) {
        /* Verify CRC */
        uint32_t calc_crc = esp_rom_crc32_le(0, (const uint8_t *)out_buf, strlen(out_buf));
        if (s_state.config_crc != 0 && calc_crc != s_state.config_crc) {
            ESP_LOGE(TAG, "CRC MISMATCH on loaded configuration! (expected 0x%08lx, calculated 0x%08lx)",
                     (unsigned long)s_state.config_crc, (unsigned long)calc_crc);
            return ESP_ERR_INVALID_CRC;
        }
        if (out_len) *out_len = strlen(out_buf);
    }

    return err;
}

esp_err_t storage_mgr_save_config(const char *json_str, uint32_t version)
{
    if (!json_str) return ESP_ERR_INVALID_ARG;

    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    uint32_t crc = esp_rom_crc32_le(0, (const uint8_t *)json_str, strlen(json_str));

    err = nvs_set_str(handle, "lvc_json", json_str);
    if (err == ESP_OK) {
        nvs_set_u32(handle, "cfg_ver", version);
        nvs_set_u32(handle, "cfg_crc", crc);
        err = nvs_commit(handle);
    }
    nvs_close(handle);

    if (err == ESP_OK) {
        s_state.config_version = version;
        s_state.config_crc = crc;
        ESP_LOGI(TAG, "Committed new Last Valid Configuration v%lu (CRC=0x%08lx)",
                 (unsigned long)version, (unsigned long)crc);
    }

    return err;
}

esp_err_t storage_mgr_append_event_log(const char *event_json)
{
    if (!event_json) return ESP_ERR_INVALID_ARG;

    if (!sdcard_hal_is_mounted()) return ESP_ERR_NOT_FOUND;

    sdcard_hal_lock();
    struct stat st;
    if (stat(EVENT_LOG_FILE, &st) == 0 && st.st_size > MAX_EVENT_LOG_BYTES) {
        unlink(EVENT_LOG_FILE);
        ESP_LOGW(TAG, "Event log exceeded %d bytes; rotated.", MAX_EVENT_LOG_BYTES);
    }

    FILE *f = fopen(EVENT_LOG_FILE, "a");
    if (!f) {
        sdcard_hal_unlock();
        return ESP_FAIL;
    }

    fprintf(f, "%s\n", event_json);
    fclose(f);
    sdcard_hal_unlock();

    return ESP_OK;
}

esp_err_t storage_mgr_read_event_logs(char *out_buf, size_t max_len, size_t *out_len)
{
    if (!sdcard_hal_is_mounted()) return ESP_ERR_NOT_FOUND;

    sdcard_hal_lock();
    FILE *f = fopen(EVENT_LOG_FILE, "r");
    if (!f) {
        out_buf[0] = '\0';
        if (out_len) *out_len = 0;
        sdcard_hal_unlock();
        return ESP_OK;
    }

    size_t bytes_read = fread(out_buf, 1, max_len - 1, f);
    out_buf[bytes_read] = '\0';
    fclose(f);
    sdcard_hal_unlock();

    if (out_len) *out_len = bytes_read;
    return ESP_OK;
}

esp_err_t storage_mgr_clear_event_logs(void)
{
    if (sdcard_hal_is_mounted()) {
        sdcard_hal_lock();
        unlink(EVENT_LOG_FILE);
        sdcard_hal_unlock();
    }
    return ESP_OK;
}

esp_err_t storage_mgr_set_estop(bool latched)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    err = nvs_set_u8(handle, "estop", latched ? 1 : 0);
    if (err == ESP_OK) {
        nvs_commit(handle);
        s_state.e_stop_latched = latched;
        ESP_LOGW(TAG, "E-Stop latch persisted to NVS: %d", latched);
    }
    nvs_close(handle);
    return err;
}

bool storage_mgr_get_estop(void)
{
    return s_state.e_stop_latched;
}

esp_err_t storage_mgr_load_components_json(char *out_buf, size_t max_len, size_t *out_len)
{
    if (!out_buf || max_len == 0) return ESP_ERR_INVALID_ARG;

    /* 1. Try reading from SPIFFS */
    FILE *f = fopen(COMPONENTS_JSON_FILE, "r");
    if (f) {
        size_t read_bytes = fread(out_buf, 1, max_len - 1, f);
        out_buf[read_bytes] = '\0';
        fclose(f);
        if (read_bytes > 0) {
            if (out_len) *out_len = read_bytes;
            ESP_LOGI(TAG, "Loaded components.json from SPIFFS (%u bytes)", (unsigned)read_bytes);
            return ESP_OK;
        }
    }

    /* 2. Fallback to NVS */
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) == ESP_OK) {
        size_t len = max_len;
        esp_err_t err = nvs_get_str(handle, "comp_json", out_buf, &len);
        nvs_close(handle);
        if (err == ESP_OK) {
            if (out_len) *out_len = len;
            ESP_LOGI(TAG, "Loaded components.json from NVS (%u bytes)", (unsigned)len);
            return ESP_OK;
        }
    }

    return ESP_ERR_NOT_FOUND;
}

esp_err_t storage_mgr_save_components_json(const char *json_str)
{
    if (!json_str) return ESP_ERR_INVALID_ARG;

    /* 1. Write to SPIFFS */
    FILE *f = fopen(COMPONENTS_JSON_FILE, "w");
    if (f) {
        fputs(json_str, f);
        fclose(f);
        ESP_LOGI(TAG, "Saved components.json to SPIFFS");
    } else {
        ESP_LOGW(TAG, "Could not open %s for write", COMPONENTS_JSON_FILE);
    }

    /* 2. Also persist to NVS as durable backup */
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_set_str(handle, "comp_json", json_str);
        nvs_commit(handle);
        nvs_close(handle);
        ESP_LOGI(TAG, "Saved components.json to NVS backup");
    }

    return ESP_OK;
}
