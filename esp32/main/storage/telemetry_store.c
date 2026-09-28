#include "storage/telemetry_store.h"
#include "utils/psram_task.h"
#include "hal/sdcard_hal.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_rom_crc.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <time.h>
#include <inttypes.h>

static const char *TAG = "TELEM_STORE";

#define BATCH_BUFFER_CAPACITY 32
#define TELEM_DIR_PRIMARY     "/sdcard/telemetry"
#define TELEM_PATH_PRIMARY    "/sdcard/telemetry/tlm_%08d.dat"
#define TELEM_PATH_FALLBACK   "/sdcard/tlm_%08d.dat"

/* Static semaphore allocations to prevent heap corruption */
static StaticSemaphore_t s_store_mutex_buf;
static SemaphoreHandle_t s_store_mutex = NULL;

static StaticSemaphore_t s_cache_mutex_buf;
static SemaphoreHandle_t s_cache_mutex = NULL;

static TaskHandle_t s_store_task_handle = NULL;

/* In-memory staging batch buffer for SD batch writes */
static telemetry_record_t s_batch_buffer[BATCH_BUFFER_CAPACITY];
static size_t s_batch_count = 0;

/* Full 24-hour daily history in fast RAM */
static telemetry_daily_history_t s_daily_history;

/* Subsystem status */
static telemetry_store_status_t s_status = {
    .is_mounted = false,
    .is_degraded = false,
    .total_written = 0,
    .total_recovered = 0,
    .last_flush_ms = 0,
    .current_date_int = 0
};

static void get_segment_path(int date_int, char *out_path, size_t max_len)
{
    struct stat st;
    if (stat(TELEM_DIR_PRIMARY, &st) != 0) {
        mkdir(TELEM_DIR_PRIMARY, 0777);
    }
    if (stat(TELEM_DIR_PRIMARY, &st) == 0 && S_ISDIR(st.st_mode)) {
        snprintf(out_path, max_len, TELEM_PATH_PRIMARY, date_int);
    } else {
        snprintf(out_path, max_len, TELEM_PATH_FALLBACK, date_int);
    }
}

static int get_current_date_int(void)
{
    time_t now = time(NULL);
    if (now < 1700000000) {
        /* Device time not yet synchronized or initialized */
        return 0;
    }
    struct tm tm_buf;
    localtime_r(&now, &tm_buf);
    return (tm_buf.tm_year + 1900) * 10000 + (tm_buf.tm_mon + 1) * 100 + tm_buf.tm_mday;
}

static void reset_daily_history(int date_int)
{
    memset(&s_daily_history, 0, sizeof(s_daily_history));
    s_daily_history.date_int = date_int;
    s_daily_history.temp_air_min = 999.0f;
    s_daily_history.temp_air_max = -999.0f;
    s_daily_history.temp_water_min = 999.0f;
    s_daily_history.temp_water_max = -999.0f;
    s_daily_history.latest_slot = -1;
    s_daily_history.has_data = false;
    for (int i = 0; i < TELEMETRY_DAILY_SLOTS; i++) {
        s_daily_history.buckets[i].valid = false;
    }
    ESP_LOGI(TAG, "Initialized fresh 288-slot RAM history for date: %08d", date_int);
}

static void snapshot_to_record(const telemetry_snapshot_t *snap, telemetry_record_t *rec)
{
    memset(rec, 0, sizeof(*rec));
    rec->magic = TELEMETRY_RECORD_MAGIC;
    rec->version = TELEMETRY_RECORD_VERSION;
    rec->sequence = snap->sequence;
    rec->timestamp_ms = snap->timestamp_ms;
    rec->temperature_air_c = snap->temperature_c;
    rec->temperature_water_c = snap->temperature_water_c;
    rec->humidity_pct = snap->humidity_pct;
    rec->light_lux = snap->light_lux;
    rec->water_level_pct = snap->water_level_pct;
    rec->flow_rate_lpm = snap->flow_rate_lpm;
    rec->total_liters = snap->total_liters;

    uint16_t flags = 0;
    if (snap->temp_valid) flags |= TELEMETRY_FLAG_TEMP_AIR_VALID;
    if (snap->temp_water_valid) flags |= TELEMETRY_FLAG_TEMP_WATER_VALID;
    if (snap->humidity_valid) flags |= TELEMETRY_FLAG_HUM_VALID;
    if (snap->light_valid) flags |= TELEMETRY_FLAG_LIGHT_VALID;
    if (snap->float_lower_ok) flags |= TELEMETRY_FLAG_FLOAT_LOWER_OK;
    rec->flags = flags;

    uint16_t mask = 0;
    if (snap->well_pump_on) mask |= (1U << 0);
    if (snap->dist_pump_on) mask |= (1U << 1);
    if (snap->raw_submersible_on) mask |= (1U << 2);
    if (snap->mixing_pump_on) mask |= (1U << 3);
    if (snap->dosing_a_on) mask |= (1U << 4);
    if (snap->dosing_b_on) mask |= (1U << 5);
    if (snap->fan_on) mask |= (1U << 6);
    if (snap->error_lamp_on) mask |= (1U << 7);
    if (snap->buzzer_on) mask |= (1U << 8);
    rec->actuator_mask = mask;

    rec->crc32 = esp_rom_crc32_le(0, (const uint8_t *)rec, offsetof(telemetry_record_t, crc32));
}

static void update_daily_cache_from_record(const telemetry_record_t *rec)
{
    time_t sec = (time_t)(rec->timestamp_ms / 1000);
    if (sec < 1700000000) return;

    struct tm tm_buf;
    localtime_r(&sec, &tm_buf);
    int date_int = (tm_buf.tm_year + 1900) * 10000 + (tm_buf.tm_mon + 1) * 100 + tm_buf.tm_mday;

    if (date_int != s_daily_history.date_int) {
        reset_daily_history(date_int);
    }

    int minute_of_day = tm_buf.tm_hour * 60 + tm_buf.tm_min;
    int slot = minute_of_day / 5;
    if (slot < 0 || slot >= TELEMETRY_DAILY_SLOTS) return;

    telemetry_daily_bucket_t *b = &s_daily_history.buckets[slot];
    bool temp_air_valid = (rec->flags & TELEMETRY_FLAG_TEMP_AIR_VALID) != 0;
    bool temp_water_valid = (rec->flags & TELEMETRY_FLAG_TEMP_WATER_VALID) != 0;
    bool hum_valid = (rec->flags & TELEMETRY_FLAG_HUM_VALID) != 0;

    if (!b->valid) {
        b->valid = true;
        b->temp_air = temp_air_valid ? rec->temperature_air_c : 0.0f;
        b->temp_water = temp_water_valid ? rec->temperature_water_c : 0.0f;
        b->humidity = hum_valid ? rec->humidity_pct : 0.0f;
        b->temp_air_min = temp_air_valid ? rec->temperature_air_c : 999.0f;
        b->temp_air_max = temp_air_valid ? rec->temperature_air_c : -999.0f;
        b->sample_count = 1;
        b->timestamp_ms = rec->timestamp_ms;
    } else {
        uint16_t c = b->sample_count;
        if (temp_air_valid) {
            b->temp_air = (b->temp_air * c + rec->temperature_air_c) / (c + 1);
            if (rec->temperature_air_c < b->temp_air_min) b->temp_air_min = rec->temperature_air_c;
            if (rec->temperature_air_c > b->temp_air_max) b->temp_air_max = rec->temperature_air_c;
        }
        if (temp_water_valid) {
            b->temp_water = (b->temp_water * c + rec->temperature_water_c) / (c + 1);
        }
        if (hum_valid) {
            b->humidity = (b->humidity * c + rec->humidity_pct) / (c + 1);
        }
        b->sample_count++;
        b->timestamp_ms = rec->timestamp_ms;
    }

    if (temp_air_valid) {
        if (!s_daily_history.has_data || rec->temperature_air_c < s_daily_history.temp_air_min) {
            s_daily_history.temp_air_min = rec->temperature_air_c;
        }
        if (!s_daily_history.has_data || rec->temperature_air_c > s_daily_history.temp_air_max) {
            s_daily_history.temp_air_max = rec->temperature_air_c;
        }
        s_daily_history.has_data = true;
    }
    if (temp_water_valid) {
        if (!s_daily_history.has_data || rec->temperature_water_c < s_daily_history.temp_water_min) {
            s_daily_history.temp_water_min = rec->temperature_water_c;
        }
        if (!s_daily_history.has_data || rec->temperature_water_c > s_daily_history.temp_water_max) {
            s_daily_history.temp_water_max = rec->temperature_water_c;
        }
    }
    if (slot > s_daily_history.latest_slot) {
        s_daily_history.latest_slot = slot;
    }
}

esp_err_t telemetry_store_append(const telemetry_snapshot_t *snap)
{
    if (!snap || snap->sequence == 0) return ESP_ERR_INVALID_ARG;

    telemetry_record_t rec;
    snapshot_to_record(snap, &rec);

    /* 1. Fast update of the RAM 288-slot daily cache */
    if (s_cache_mutex && xSemaphoreTake(s_cache_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        update_daily_cache_from_record(&rec);
        xSemaphoreGive(s_cache_mutex);
    }

    /* 2. Buffer into the staging batch for asynchronous SD write */
    bool trigger_worker = false;
    if (s_store_mutex && xSemaphoreTake(s_store_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        if (s_batch_count < BATCH_BUFFER_CAPACITY) {
            s_batch_buffer[s_batch_count++] = rec;
        } else {
            /* Circular overwrite: discard oldest buffered item to prevent unbounded memory */
            memmove(&s_batch_buffer[0], &s_batch_buffer[1], (BATCH_BUFFER_CAPACITY - 1) * sizeof(telemetry_record_t));
            s_batch_buffer[BATCH_BUFFER_CAPACITY - 1] = rec;
        }
        if (s_batch_count >= 16) {
            trigger_worker = true;
        }
        xSemaphoreGive(s_store_mutex);
    }

    if (trigger_worker && s_store_task_handle) {
        xTaskNotifyGive(s_store_task_handle);
    }

    return ESP_OK;
}

esp_err_t telemetry_store_flush(void)
{
    if (!s_store_mutex) return ESP_ERR_INVALID_STATE;

    /* HEAP-FIX (audit 2026-09-28): telemetry_record_t local_batch[32]
     * (1920 B) lived on the caller's stack. Both callers -- telem_store_tsk
     * and tele_persist_task -- run on 4096-byte stacks, and this function
     * then enters the deep FatFS fopen/fwrite/fflush chain
     * (CONFIG_FATFS_MAX_LFN=255), pushing peak stack usage to an estimated
     * 4-6 KB: a stack overflow that corrupts the adjacent heap block / TCB
     * (observed in the field as tlsf_walk_pool LoadProhibited and
     * xTaskPriorityDisinherit asserts). Move the batch to PSRAM heap.
     * Deliberately, NO task stack size is changed by this patch. */
    telemetry_record_t *local_batch =
        (telemetry_record_t *)heap_caps_malloc(BATCH_BUFFER_CAPACITY * sizeof(telemetry_record_t),
                                               MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!local_batch) {
        ESP_LOGE(TAG, "Flush batch PSRAM alloc failed; batch kept staged");
        return ESP_ERR_NO_MEM;
    }
    size_t count = 0;

    if (xSemaphoreTake(s_store_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        heap_caps_free(local_batch);
        return ESP_ERR_TIMEOUT;
    }

    if (s_batch_count == 0) {
        xSemaphoreGive(s_store_mutex);
        heap_caps_free(local_batch);
        return ESP_OK;
    }

    count = s_batch_count;
    memcpy(local_batch, s_batch_buffer, count * sizeof(telemetry_record_t));
    s_batch_count = 0;
    xSemaphoreGive(s_store_mutex);

    /* Check physical microSD mount status */
    if (!sdcard_hal_is_mounted()) {
        s_status.is_mounted = false;
        s_status.is_degraded = true;
        heap_caps_free(local_batch);
        return ESP_ERR_NOT_FOUND;
    }

    s_status.is_mounted = true;

    /* Write batch to today's segment file */
    int date_int = get_current_date_int();
    if (date_int == 0) {
        date_int = 19700101;
    }
    s_status.current_date_int = date_int;

    char path[128];
    get_segment_path(date_int, path, sizeof(path));

    sdcard_hal_lock();
    FILE *f = fopen(path, "ab");
    if (!f) {
        sdcard_hal_unlock();
        s_status.is_degraded = true;
        ESP_LOGW(TAG, "Failed to open segment file '%s' for append", path);
        heap_caps_free(local_batch);
        return ESP_FAIL;
    }

    size_t written = fwrite(local_batch, sizeof(telemetry_record_t), count, f);
    fflush(f);
    fclose(f);
    sdcard_hal_unlock();

    if (written < count) {
        s_status.is_degraded = true;
        ESP_LOGE(TAG, "Short write on segment file: %zu/%zu records", written, count);
        heap_caps_free(local_batch);
        return ESP_FAIL;
    }

    s_status.total_written += written;
    s_status.last_flush_ms = esp_timer_get_time() / 1000;
    s_status.is_degraded = false;

    heap_caps_free(local_batch);
    return ESP_OK;
}

esp_err_t telemetry_store_recover(void)
{
    if (!sdcard_hal_is_mounted()) {
        s_status.is_mounted = false;
        s_status.is_degraded = true;
        return ESP_ERR_NOT_FOUND;
    }

    int date_int = get_current_date_int();
    if (date_int == 0) return ESP_OK;

    char path[128];
    get_segment_path(date_int, path, sizeof(path));

    struct stat st;
    if (stat(path, &st) != 0 || st.st_size == 0) {
        /* No file for today yet */
        return ESP_OK;
    }

    sdcard_hal_lock();
    FILE *f = fopen(path, "r+b");
    if (!f) {
        sdcard_hal_unlock();
        return ESP_FAIL;
    }

    long valid_bytes = 0;
    uint32_t valid_count = 0;
    telemetry_record_t rec;

    while (1) {
        size_t n = fread(&rec, 1, sizeof(rec), f);
        if (n == 0) break; /* Clean EOF */
        if (n < sizeof(rec)) {
            ESP_LOGW(TAG, "Partial record tail detected (%zu bytes) at offset %ld. Trimming.", n, valid_bytes);
            break;
        }
        if (rec.magic != TELEMETRY_RECORD_MAGIC || rec.version != TELEMETRY_RECORD_VERSION) {
            ESP_LOGW(TAG, "Corrupt record magic (0x%08" PRIx32 ") at offset %ld. Trimming.", rec.magic, valid_bytes);
            break;
        }
        uint32_t expected_crc = esp_rom_crc32_le(0, (const uint8_t *)&rec, offsetof(telemetry_record_t, crc32));
        if (rec.crc32 != expected_crc) {
            ESP_LOGW(TAG, "CRC32 mismatch (read: 0x%08" PRIx32 ", expected: 0x%08" PRIx32 ") at offset %ld. Trimming.",
                     rec.crc32, expected_crc, valid_bytes);
            break;
        }
        valid_bytes += sizeof(rec);
        valid_count++;
    }

    if (valid_bytes < st.st_size) {
        int fd = fileno(f);
        if (fd >= 0) {
            ftruncate(fd, valid_bytes);
            fflush(f);
            ESP_LOGW(TAG, "File '%s' recovered: preserved %" PRIu32 " valid records, trimmed %ld corrupt bytes",
                     path, valid_count, (long)(st.st_size - valid_bytes));
        }
    }

    fclose(f);
    sdcard_hal_unlock();

    s_status.total_recovered = valid_count;
    ESP_LOGI(TAG, "TelemetryStore recovery complete: %" PRIu32 " valid records in '%s'", valid_count, path);
    return ESP_OK;
}

esp_err_t telemetry_store_load_recent_history(void)
{
    if (!sdcard_hal_is_mounted()) {
        return ESP_ERR_NOT_FOUND;
    }

    int date_int = get_current_date_int();
    if (date_int == 0) return ESP_OK;

    char path[128];
    get_segment_path(date_int, path, sizeof(path));

    struct stat st;
    if (stat(path, &st) != 0 || st.st_size == 0) {
        return ESP_OK;
    }

    sdcard_hal_lock();
    FILE *f = fopen(path, "rb");
    if (!f) {
        sdcard_hal_unlock();
        return ESP_FAIL;
    }

    telemetry_record_t chunk[16];
    size_t loaded = 0;

    if (s_cache_mutex) xSemaphoreTake(s_cache_mutex, portMAX_DELAY);

    while (1) {
        size_t n = fread(chunk, sizeof(telemetry_record_t), 16, f);
        if (n == 0) break;
        for (size_t i = 0; i < n; i++) {
            if (chunk[i].magic == TELEMETRY_RECORD_MAGIC) {
                update_daily_cache_from_record(&chunk[i]);
                loaded++;
            }
        }
    }

    if (s_cache_mutex) xSemaphoreGive(s_cache_mutex);

    fclose(f);
    sdcard_hal_unlock();

    ESP_LOGI(TAG, "Restored %zu historical telemetry records into 288-slot RAM cache from '%s'", loaded, path);
    return ESP_OK;
}

esp_err_t telemetry_store_get_daily_history(telemetry_daily_history_t *out_history)
{
    if (!out_history) return ESP_ERR_INVALID_ARG;
    if (!s_cache_mutex) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_cache_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    *out_history = s_daily_history;
    xSemaphoreGive(s_cache_mutex);
    return ESP_OK;
}

const telemetry_daily_history_t *telemetry_store_lock_daily_history(void)
{
    if (!s_cache_mutex) return NULL;
    if (xSemaphoreTake(s_cache_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return NULL;
    }
    return &s_daily_history;
}

void telemetry_store_unlock_daily_history(void)
{
    if (s_cache_mutex) {
        xSemaphoreGive(s_cache_mutex);
    }
}

esp_err_t telemetry_store_get_temp_series(float *out_min, float *out_max, float *out_series, size_t max_series, size_t *out_count)
{
    if (!out_min || !out_max) return ESP_ERR_INVALID_ARG;
    if (!s_cache_mutex) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_cache_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    if (!s_daily_history.has_data) {
        xSemaphoreGive(s_cache_mutex);
        return ESP_ERR_NOT_FOUND;
    }
    *out_min = s_daily_history.temp_air_min;
    *out_max = s_daily_history.temp_air_max;
    if (out_series && max_series > 0 && out_count) {
        size_t valid_collected = 0;
        for (int i = 0; i <= s_daily_history.latest_slot && valid_collected < max_series; i++) {
            if (s_daily_history.buckets[i].valid) {
                out_series[valid_collected++] = s_daily_history.buckets[i].temp_air;
            }
        }
        *out_count = valid_collected;
    }
    xSemaphoreGive(s_cache_mutex);
    return ESP_OK;
}

esp_err_t telemetry_store_get_status(telemetry_store_status_t *out_status)
{
    if (!out_status) return ESP_ERR_INVALID_ARG;
    *out_status = s_status;
    out_status->is_mounted = sdcard_hal_is_mounted();
    return ESP_OK;
}

void telemetry_store_trigger_flush(void)
{
    if (s_store_task_handle) {
        xTaskNotifyGive(s_store_task_handle);
    }
}

static void telemetry_store_task(void *pvParameters)
{
    (void)pvParameters;
    s_store_task_handle = xTaskGetCurrentTaskHandle();
    ESP_LOGI(TAG, "Dedicated TelemetryStore task started (Core 1, priority %d).", TASK_TELEMETRY_PRIO - 1);
    vTaskDelay(pdMS_TO_TICKS(2000));

    /* Initial boot recovery and cache restoration */
    if (sdcard_hal_is_mounted()) {
        (void)telemetry_store_recover();
        (void)telemetry_store_load_recent_history();
    }

    uint32_t cycle = 0;
    while (1) {
        /* Wait up to 5s for batch timeout or explicit task notification */
        (void)ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5000));

        /* Perform durable batch flush to microSD */
        (void)telemetry_store_flush();

        /* HEAP-AUDIT (2026-09-28): report stack high-water mark + internal
         * heap watermarks every ~60s. A stack_hwm of 0 means this task has
         * PROVABLY overflowed its stack -- that is the evidence required
         * before any task stack size may be changed. */
        if (++cycle % 12 == 0) {
            UBaseType_t hwm = uxTaskGetStackHighWaterMark(NULL);
            ESP_LOGW(TAG, "MEM telem_store_tsk stack_hwm=%u B free_int=%u largest=%u min_free=%u",
                     (unsigned)(hwm * sizeof(StackType_t)),
                     (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                     (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL),
                     (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL));
        }
    }
}

esp_err_t telemetry_store_init(void)
{
    if (s_store_mutex) return ESP_OK;

    s_store_mutex = xSemaphoreCreateMutexStatic(&s_store_mutex_buf);
    s_cache_mutex = xSemaphoreCreateMutexStatic(&s_cache_mutex_buf);
    if (!s_store_mutex || !s_cache_mutex) return ESP_ERR_NO_MEM;

    reset_daily_history(get_current_date_int());

    psram_task_create_pinned(telemetry_store_task, "telem_store_tsk", 4096, NULL, TASK_TELEMETRY_PRIO - 1, &s_store_task_handle, 1);
    ESP_LOGI(TAG, "TelemetryStore initialized (append-oriented, CRC32-validated, 288-slot RAM cache).");
    return ESP_OK;
}
