#include "storage/storage_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_random.h"
#include "nvs.h"
#include "esp_rom_crc.h"
#include "esp_spiffs.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include "hal/sdcard_hal.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "STORAGE_MGR";
static const char *NVS_NAMESPACE = "agrotech";
static const char *EVENT_LOG_FILE = "/sdcard/events.log";
static const char *EVENT_LOG_FALLBACK_FILE = "/spiffs/events.log";
static const char *TELEMETRY_LOG_FILE = "/sdcard/telemetry.jsonl";
static const char *TELEMETRY_LOG_FALLBACK_FILE = "/spiffs/telemetry.jsonl";
static const char *FERTIGATION_RUN_FILE = "/sdcard/fertigation_runs.jsonl";
static const char *FERTIGATION_RUN_FALLBACK_FILE = "/spiffs/fertigation_runs.jsonl";
static const char *COMPONENTS_JSON_FILE = "/spiffs/components.json";

#define MAX_EVENT_LOG_BYTES (512 * 1024)
#define MAX_TELEMETRY_LOG_BYTES (1024 * 1024)

static system_storage_state_t s_state = {0};
static bool s_initialized = false;
static SemaphoreHandle_t s_event_mutex = NULL;

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

    /* 3. Configuration Metadata.  The active snapshot remains the runtime
     * authority. Candidate/previous metadata is only deployment state. */
    nvs_get_u32(handle, "cfg_ver", &s_state.config_version);
    nvs_get_u32(handle, "cfg_crc", &s_state.config_crc);
    len = sizeof(s_state.config_hash);
    if (nvs_get_str(handle, "cfg_hash", s_state.config_hash, &len) != ESP_OK) s_state.config_hash[0] = '\0';
    nvs_get_u32(handle, "prev_ver", &s_state.previous_config_version);
    nvs_get_u32(handle, "prev_crc", &s_state.previous_config_crc);
    len = sizeof(s_state.previous_config_hash);
    if (nvs_get_str(handle, "prev_hash", s_state.previous_config_hash, &len) != ESP_OK) s_state.previous_config_hash[0] = '\0';
    nvs_get_u32(handle, "cand_ver", &s_state.candidate_config_version);
    nvs_get_u32(handle, "cand_crc", &s_state.candidate_config_crc);
    len = sizeof(s_state.candidate_config_hash);
    if (nvs_get_str(handle, "cand_hash", s_state.candidate_config_hash, &len) != ESP_OK) s_state.candidate_config_hash[0] = '\0';
    len = sizeof(s_state.active_deployment_id);
    if (nvs_get_str(handle, "dep_id", s_state.active_deployment_id, &len) != ESP_OK) s_state.active_deployment_id[0] = '\0';
    len = sizeof(s_state.candidate_deployment_id);
    if (nvs_get_str(handle, "cand_dep", s_state.candidate_deployment_id, &len) != ESP_OK) s_state.candidate_deployment_id[0] = '\0';
    len = sizeof(s_state.config_deployment_status);
    if (nvs_get_str(handle, "dep_status", s_state.config_deployment_status, &len) != ESP_OK) {
        strncpy(s_state.config_deployment_status, s_state.config_version ? "ACTIVE" : "EMPTY", sizeof(s_state.config_deployment_status) - 1);
    }

    /* 4. E-Stop Latch */
    uint8_t estop = 0;
    nvs_get_u8(handle, "estop", &estop);
    s_state.e_stop_latched = (estop != 0);

    /* Safe boot is always considered active at process start. The main
     * initialization path explicitly clears it only after safety/runtime
     * services are ready. */
    uint8_t safe_boot = 1;
    (void)nvs_get_u8(handle, "safe_boot", &safe_boot);
    (void)safe_boot;

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
    s_event_mutex = xSemaphoreCreateMutex();
    if (!s_event_mutex) return ESP_ERR_NO_MEM;
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

static esp_err_t load_nvs_string_checked(const char *key, const char *crc_key, uint32_t expected_crc,
                                          char *out_buf, size_t max_len, size_t *out_len)
{
    if (!key || !out_buf || max_len < 2) return ESP_ERR_INVALID_ARG;
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) return err;
    size_t required_len = 0;
    err = nvs_get_str(handle, key, NULL, &required_len);
    if (err != ESP_OK) { nvs_close(handle); return err; }
    if (required_len > max_len) { nvs_close(handle); return ESP_ERR_NO_MEM; }
    err = nvs_get_str(handle, key, out_buf, &required_len);
    nvs_close(handle);
    if (err != ESP_OK) return err;
    uint32_t crc = esp_rom_crc32_le(0, (const uint8_t *)out_buf, strlen(out_buf));
    if (expected_crc != 0 && crc != expected_crc) return ESP_ERR_INVALID_CRC;
    if (out_len) *out_len = strlen(out_buf);
    (void)crc_key;
    return ESP_OK;
}

esp_err_t storage_mgr_load_config(char *out_buf, size_t max_len, size_t *out_len)
{
    esp_err_t err = load_nvs_string_checked("lvc_json", "cfg_crc", s_state.config_crc, out_buf, max_len, out_len);
    if (err == ESP_ERR_INVALID_CRC) {
        ESP_LOGE(TAG, "Active configuration CRC mismatch; attempting previous snapshot recovery.");
        char prev[4096]; size_t prev_len = 0;
        esp_err_t perr = load_nvs_string_checked("prev_json", "prev_crc", s_state.previous_config_crc, prev, sizeof(prev), &prev_len);
        if (perr == ESP_OK) {
            nvs_handle_t h;
            if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h) == ESP_OK) {
                uint32_t crc = esp_rom_crc32_le(0, (const uint8_t *)prev, strlen(prev));
                esp_err_t r = nvs_set_str(h, "lvc_json", prev);
                if (r == ESP_OK) r = nvs_set_u32(h, "cfg_ver", s_state.previous_config_version);
                if (r == ESP_OK) r = nvs_set_u32(h, "cfg_crc", crc);
                if (r == ESP_OK && s_state.previous_config_hash[0]) r = nvs_set_str(h, "cfg_hash", s_state.previous_config_hash);
                if (r == ESP_OK) r = nvs_set_str(h, "dep_status", "ROLLED_BACK");
                if (r == ESP_OK) r = nvs_commit(h);
                nvs_close(h);
                if (r == ESP_OK) {
                    s_state.config_version = s_state.previous_config_version;
                    s_state.config_crc = crc;
                    strncpy(s_state.config_hash, s_state.previous_config_hash, sizeof(s_state.config_hash)-1);
                    strncpy(s_state.config_deployment_status, "ROLLED_BACK", sizeof(s_state.config_deployment_status)-1);
                    err = ESP_OK;
                    if (out_len) *out_len = prev_len;
                    memcpy(out_buf, prev, prev_len + 1);
                    ESP_LOGW(TAG, "Recovered active configuration from previous snapshot v%lu.", (unsigned long)s_state.config_version);
                }
            }
        }
    }
    return err;
}

esp_err_t storage_mgr_load_candidate(char *out_buf, size_t max_len, size_t *out_len)
{
    return load_nvs_string_checked("cand_json", "cand_crc", s_state.candidate_config_crc, out_buf, max_len, out_len);
}

esp_err_t storage_mgr_load_previous_config(char *out_buf, size_t max_len, size_t *out_len)
{
    return load_nvs_string_checked("prev_json", "prev_crc", s_state.previous_config_crc, out_buf, max_len, out_len);
}

static void extract_config_hash(const char *json_str, char *out_hash, size_t hash_len)
{
    if (!out_hash || hash_len == 0) return;
    out_hash[0] = '\0';
    cJSON *cfg = cJSON_Parse(json_str);
    if (!cfg) return;
    cJSON *h = cJSON_GetObjectItem(cfg, "configurationHash");
    if (h && cJSON_IsString(h)) strncpy(out_hash, h->valuestring, hash_len - 1);
    cJSON_Delete(cfg);
}

static esp_err_t nvs_erase_key_optional(nvs_handle_t handle, const char *key)
{
    esp_err_t err = nvs_erase_key(handle, key);
    return err == ESP_ERR_NVS_NOT_FOUND ? ESP_OK : err;
}

esp_err_t storage_mgr_save_config(const char *json_str, uint32_t version)
{
    /* Backward-compatible direct save is now an atomic active activation path. */
    esp_err_t err = storage_mgr_stage_candidate(json_str, version, "legacy-direct-save");
    if (err != ESP_OK) return err;
    return storage_mgr_activate_candidate();
}

esp_err_t storage_mgr_stage_candidate(const char *json_str, uint32_t version, const char *deployment_id)
{
    if (!json_str || !json_str[0]) return ESP_ERR_INVALID_ARG;
    if (version == 0) return ESP_ERR_INVALID_ARG;
    if (!s_event_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    uint32_t crc = esp_rom_crc32_le(0, (const uint8_t *)json_str, strlen(json_str));
    char hash[80] = {0};
    extract_config_hash(json_str, hash, sizeof(hash));
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        err = nvs_set_str(handle, "cand_json", json_str);
        if (err == ESP_OK) err = nvs_set_u32(handle, "cand_ver", version);
        if (err == ESP_OK) err = nvs_set_u32(handle, "cand_crc", crc);
        if (err == ESP_OK) {
            if (hash[0]) err = nvs_set_str(handle, "cand_hash", hash);
            else err = nvs_erase_key_optional(handle, "cand_hash");
        }
        if (err == ESP_OK) {
            if (deployment_id && deployment_id[0]) err = nvs_set_str(handle, "cand_dep", deployment_id);
            else err = nvs_erase_key_optional(handle, "cand_dep");
        }
        if (err == ESP_OK) err = nvs_set_str(handle, "dep_status", "CANDIDATE_STAGED");
        if (err == ESP_OK) err = nvs_commit(handle);
        nvs_close(handle);
    }
    if (err == ESP_OK) {
        s_state.candidate_config_version = version;
        s_state.candidate_config_crc = crc;
        strncpy(s_state.candidate_config_hash, hash, sizeof(s_state.candidate_config_hash)-1);
        s_state.candidate_deployment_id[0] = '\0';
        if (deployment_id) strncpy(s_state.candidate_deployment_id, deployment_id, sizeof(s_state.candidate_deployment_id)-1);
        strncpy(s_state.config_deployment_status, "CANDIDATE_STAGED", sizeof(s_state.config_deployment_status)-1);
    }
    xSemaphoreGive(s_event_mutex);
    return err;
}

esp_err_t storage_mgr_activate_candidate(void)
{
    if (!s_event_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    char candidate[4096]; size_t candidate_len = 0;
    esp_err_t err = storage_mgr_load_candidate(candidate, sizeof(candidate), &candidate_len);
    if (err != ESP_OK) { xSemaphoreGive(s_event_mutex); return err; }

    nvs_handle_t handle;
    err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        char previous[4096]; size_t previous_len = 0;
        esp_err_t prev_err = load_nvs_string_checked("lvc_json", "cfg_crc", s_state.config_crc, previous, sizeof(previous), &previous_len);
        if (prev_err == ESP_OK) {
            uint32_t prev_crc = esp_rom_crc32_le(0, (const uint8_t *)previous, previous_len);
            err = nvs_set_str(handle, "prev_json", previous);
            if (err == ESP_OK) err = nvs_set_u32(handle, "prev_ver", s_state.config_version);
            if (err == ESP_OK) err = nvs_set_u32(handle, "prev_crc", prev_crc);
            if (err == ESP_OK) {
                if (s_state.config_hash[0]) err = nvs_set_str(handle, "prev_hash", s_state.config_hash);
                else err = nvs_erase_key_optional(handle, "prev_hash");
            }
        }
        if (err == ESP_OK) err = nvs_set_str(handle, "lvc_json", candidate);
        if (err == ESP_OK) err = nvs_set_u32(handle, "cfg_ver", s_state.candidate_config_version);
        if (err == ESP_OK) err = nvs_set_u32(handle, "cfg_crc", s_state.candidate_config_crc);
        if (err == ESP_OK) {
            if (s_state.candidate_config_hash[0]) err = nvs_set_str(handle, "cfg_hash", s_state.candidate_config_hash);
            else err = nvs_erase_key_optional(handle, "cfg_hash");
        }
        if (err == ESP_OK) {
            if (s_state.candidate_deployment_id[0]) err = nvs_set_str(handle, "dep_id", s_state.candidate_deployment_id);
            else err = nvs_erase_key_optional(handle, "dep_id");
        }
        if (err == ESP_OK) err = nvs_erase_key_optional(handle, "cand_json");
        if (err == ESP_OK) err = nvs_erase_key_optional(handle, "cand_ver");
        if (err == ESP_OK) err = nvs_erase_key_optional(handle, "cand_crc");
        if (err == ESP_OK) err = nvs_erase_key_optional(handle, "cand_hash");
        if (err == ESP_OK) err = nvs_erase_key_optional(handle, "cand_dep");
        if (err == ESP_OK) err = nvs_set_str(handle, "dep_status", "ACTIVE");
        if (err == ESP_OK) err = nvs_commit(handle);
        nvs_close(handle);
    }
    if (err == ESP_OK) {
        s_state.previous_config_version = s_state.config_version;
        s_state.previous_config_crc = s_state.config_crc;
        strncpy(s_state.previous_config_hash, s_state.config_hash, sizeof(s_state.previous_config_hash)-1);
        s_state.config_version = s_state.candidate_config_version;
        s_state.config_crc = s_state.candidate_config_crc;
        strncpy(s_state.config_hash, s_state.candidate_config_hash, sizeof(s_state.config_hash)-1);
        strncpy(s_state.active_deployment_id, s_state.candidate_deployment_id, sizeof(s_state.active_deployment_id)-1);
        s_state.candidate_config_version = 0;
        s_state.candidate_config_crc = 0;
        s_state.candidate_config_hash[0] = '\0';
        s_state.candidate_deployment_id[0] = '\0';
        strncpy(s_state.config_deployment_status, "ACTIVE", sizeof(s_state.config_deployment_status)-1);
    }
    xSemaphoreGive(s_event_mutex);
    return err;
}

esp_err_t storage_mgr_clear_candidate(void)
{
    if (!s_event_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    nvs_handle_t handle; esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        (void)nvs_erase_key_optional(handle, "cand_json");
        (void)nvs_erase_key_optional(handle, "cand_ver");
        (void)nvs_erase_key_optional(handle, "cand_crc");
        (void)nvs_erase_key_optional(handle, "cand_hash");
        (void)nvs_erase_key_optional(handle, "cand_dep");
        err = nvs_set_str(handle, "dep_status", s_state.config_version ? "ACTIVE" : "EMPTY");
        if (err == ESP_OK) err = nvs_commit(handle);
        nvs_close(handle);
    }
    if (err == ESP_OK) {
        s_state.candidate_config_version = 0; s_state.candidate_config_crc = 0;
        s_state.candidate_config_hash[0] = '\0'; s_state.candidate_deployment_id[0] = '\0';
        strncpy(s_state.config_deployment_status, s_state.config_version ? "ACTIVE" : "EMPTY", sizeof(s_state.config_deployment_status)-1);
    }
    xSemaphoreGive(s_event_mutex);
    return err;
}


esp_err_t storage_mgr_mark_candidate_failed(void)
{
    if (!s_event_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    nvs_handle_t handle; esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        err = nvs_set_str(handle, "dep_status", "FAILED");
        if (err == ESP_OK) err = nvs_commit(handle);
        nvs_close(handle);
    }
    if (err == ESP_OK) strncpy(s_state.config_deployment_status, "FAILED", sizeof(s_state.config_deployment_status)-1);
    xSemaphoreGive(s_event_mutex);
    return err;
}

esp_err_t storage_mgr_append_event_log(const char *event_json)
{
    if (!event_json) return ESP_ERR_INVALID_ARG;
    if (!s_event_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    const char *path = sdcard_hal_is_mounted() ? EVENT_LOG_FILE : EVENT_LOG_FALLBACK_FILE;
    bool sd = (path == EVENT_LOG_FILE);
    if (sd) sdcard_hal_lock();

    struct stat st;
    if (stat(path, &st) == 0 && st.st_size > MAX_EVENT_LOG_BYTES) {
        unlink(path);
        ESP_LOGW(TAG, "Event log exceeded %d bytes; rotated at %s.", MAX_EVENT_LOG_BYTES, path);
    }

    FILE *f = fopen(path, "a");
    if (!f) {
        if (sd) sdcard_hal_unlock();
        xSemaphoreGive(s_event_mutex);
        return ESP_FAIL;
    }
    int rc = fprintf(f, "%s\n", event_json);
    fclose(f);
    if (sd) sdcard_hal_unlock();
    xSemaphoreGive(s_event_mutex);
    return rc < 0 ? ESP_FAIL : ESP_OK;
}


esp_err_t storage_mgr_append_telemetry_log(const char *telemetry_json)
{
    if (!telemetry_json || !telemetry_json[0] || !s_event_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    const char *path = sdcard_hal_is_mounted() ? TELEMETRY_LOG_FILE : TELEMETRY_LOG_FALLBACK_FILE;
    bool sd = (path == TELEMETRY_LOG_FILE);
    if (sd) sdcard_hal_lock();

    struct stat st;
    if (stat(path, &st) == 0 && st.st_size > MAX_TELEMETRY_LOG_BYTES) {
        unlink(path);
        ESP_LOGW(TAG, "Telemetry log exceeded %d bytes; rotated at %s.", MAX_TELEMETRY_LOG_BYTES, path);
    }

    FILE *f = fopen(path, "a");
    if (!f) {
        if (sd) sdcard_hal_unlock();
        xSemaphoreGive(s_event_mutex);
        return ESP_FAIL;
    }
    int rc = fprintf(f, "%s\n", telemetry_json);
    fflush(f);
    fclose(f);
    if (sd) sdcard_hal_unlock();
    xSemaphoreGive(s_event_mutex);
    return rc < 0 ? ESP_FAIL : ESP_OK;
}

esp_err_t storage_mgr_read_telemetry_logs(char *out_buf, size_t max_len, size_t *out_len)
{
    if (!out_buf || max_len < 2 || !s_event_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    const char *path = sdcard_hal_is_mounted() ? TELEMETRY_LOG_FILE : TELEMETRY_LOG_FALLBACK_FILE;
    bool sd = (path == TELEMETRY_LOG_FILE);
    if (sd) sdcard_hal_lock();
    FILE *f = fopen(path, "r");
    if (!f) {
        out_buf[0] = '\0';
        if (out_len) *out_len = 0;
        if (sd) sdcard_hal_unlock();
        xSemaphoreGive(s_event_mutex);
        return ESP_OK;
    }
    size_t bytes_read = fread(out_buf, 1, max_len - 1, f);
    out_buf[bytes_read] = '\0';
    fclose(f);
    if (sd) sdcard_hal_unlock();
    if (out_len) *out_len = bytes_read;
    xSemaphoreGive(s_event_mutex);
    return ESP_OK;
}

esp_err_t storage_mgr_reserve_sequence_block(const char *nvs_key, uint32_t block_size, uint64_t *out_first_sequence)
{
    if (!nvs_key || !nvs_key[0] || block_size == 0 || !out_first_sequence || !s_event_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        xSemaphoreGive(s_event_mutex);
        return err;
    }
    uint64_t current = 0;
    (void)nvs_get_u64(handle, nvs_key, &current);
    if (UINT64_MAX - current < block_size) {
        nvs_close(handle);
        xSemaphoreGive(s_event_mutex);
        return ESP_ERR_INVALID_SIZE;
    }
    uint64_t first = current + 1;
    err = nvs_set_u64(handle, nvs_key, current + block_size);
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);
    if (err == ESP_OK) *out_first_sequence = first;
    xSemaphoreGive(s_event_mutex);
    return err;
}

esp_err_t storage_mgr_get_sync_cursor(const char *key, uint64_t *out_cursor)
{
    if (!key || !key[0] || !out_cursor) return ESP_ERR_INVALID_ARG;
    *out_cursor = 0;
    nvs_handle_t h;
    esp_err_t err = nvs_open("agrotech_sync", NVS_READONLY, &h);
    if (err != ESP_OK) return ESP_OK;
    err = nvs_get_u64(h, key, out_cursor);
    nvs_close(h);
    return err == ESP_ERR_NVS_NOT_FOUND ? ESP_OK : err;
}

esp_err_t storage_mgr_set_sync_cursor(const char *key, uint64_t cursor)
{
    if (!key || !key[0]) return ESP_ERR_INVALID_ARG;
    nvs_handle_t h;
    esp_err_t err = nvs_open("agrotech_sync", NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_set_u64(h, key, cursor);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

esp_err_t storage_mgr_append_fertigation_run(const char *run_json)
{
    if (!run_json || !run_json[0] || !s_event_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    const char *path = sdcard_hal_is_mounted() ? FERTIGATION_RUN_FILE : FERTIGATION_RUN_FALLBACK_FILE;
    bool sd = (path == FERTIGATION_RUN_FILE);
    if (sd) sdcard_hal_lock();
    FILE *f = fopen(path, "a");
    if (!f) { if (sd) sdcard_hal_unlock(); xSemaphoreGive(s_event_mutex); return ESP_FAIL; }
    int rc = fprintf(f, "%s\n", run_json);
    fclose(f);
    if (sd) sdcard_hal_unlock();
    xSemaphoreGive(s_event_mutex);
    return rc < 0 ? ESP_FAIL : ESP_OK;
}

esp_err_t storage_mgr_read_event_logs(char *out_buf, size_t max_len, size_t *out_len)
{
    if (!out_buf || max_len < 2 || !s_event_mutex) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    const char *path = sdcard_hal_is_mounted() ? EVENT_LOG_FILE : EVENT_LOG_FALLBACK_FILE;
    bool sd = (path == EVENT_LOG_FILE);
    if (sd) sdcard_hal_lock();
    FILE *f = fopen(path, "r");
    if (!f) {
        out_buf[0] = '\0';
        if (out_len) *out_len = 0;
        if (sd) sdcard_hal_unlock();
        xSemaphoreGive(s_event_mutex);
        return ESP_OK;
    }
    size_t bytes_read = fread(out_buf, 1, max_len - 1, f);
    out_buf[bytes_read] = '\0';
    fclose(f);
    if (sd) sdcard_hal_unlock();
    if (out_len) *out_len = bytes_read;
    xSemaphoreGive(s_event_mutex);
    return ESP_OK;
}

esp_err_t storage_mgr_clear_event_logs(void)
{
    if (!s_event_mutex) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_event_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    if (sdcard_hal_is_mounted()) {
        sdcard_hal_lock();
        unlink(EVENT_LOG_FILE);
        sdcard_hal_unlock();
    }
    unlink(EVENT_LOG_FALLBACK_FILE);
    xSemaphoreGive(s_event_mutex);
    return ESP_OK;
}

esp_err_t storage_mgr_set_safe_boot_active(bool active)
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;
    err = nvs_set_u8(handle, "safe_boot", active ? 1 : 0);
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);
    if (err == ESP_OK) s_state.safe_boot_active = active;
    return err;
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

esp_err_t storage_mgr_load_calibration(char *out_buf, size_t max_len, size_t *out_len)
{
    if (!out_buf || max_len == 0) return ESP_ERR_INVALID_ARG;

    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) == ESP_OK) {
        size_t len = max_len;
        esp_err_t err = nvs_get_str(handle, "calib_json", out_buf, &len);
        nvs_close(handle);
        if (err == ESP_OK) {
            if (out_len) *out_len = len;
            ESP_LOGI(TAG, "Loaded calib_json from NVS (%u bytes)", (unsigned)len);
            return ESP_OK;
        }
    }
    return ESP_ERR_NOT_FOUND;
}

esp_err_t storage_mgr_save_calibration(const char *json_str)
{
    if (!json_str) return ESP_ERR_INVALID_ARG;

    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_set_str(handle, "calib_json", json_str);
        nvs_commit(handle);
        nvs_close(handle);
        ESP_LOGI(TAG, "Saved calib_json to NVS");
        return ESP_OK;
    }
    return ESP_FAIL;
}
