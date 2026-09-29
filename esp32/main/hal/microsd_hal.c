#include "hal/microsd_hal.h"
#include "hal/tft_hal.h"
#include "config/pin_config.h"
#include "config/system_config.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_vfs_fat.h"
#include "driver/sdspi_host.h"
#include "driver/spi_common.h"
#include "sdmmc_cmd.h"
#include "driver/gpio.h"
#include "nvs_flash.h"
#include "nvs.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#include <stdio.h>
#include <string.h>

static const char *TAG = "MICROSD_HAL";
static bool s_microsd_mounted = false;
static bool s_microsd_detected = false;
static bool s_format_in_progress = false;
static SemaphoreHandle_t s_microsd_lock = NULL;

#if FEATURE_MICROSD_ENABLED
static sdmmc_card_t *s_card = NULL;
#endif

#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"

#define WS2812_RMT_RES_HZ 10000000 // 10MHz -> 1 tick = 0.1us

/**
 * @brief Send 24 exact hardware-timed zero-bits (RGB=0,0,0) to turn off onboard WS2812 RGB LED.
 * Uses ESP32-S3 RMT hardware peripheral at 10MHz resolution (0.3us HIGH, 0.9us LOW).
 * This eliminates all bus/CPU timing jitter and turns the LED completely OFF.
 */
static void ws2812_clear(gpio_num_t pin)
{
    if (pin < 0 || pin > 48) return;

    rmt_channel_handle_t chan = NULL;
    rmt_tx_channel_config_t tx_cfg = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .gpio_num = pin,
        .mem_block_symbols = 64,
        .resolution_hz = WS2812_RMT_RES_HZ,
        .trans_queue_depth = 4,
    };

    if (rmt_new_tx_channel(&tx_cfg, &chan) != ESP_OK) {
        return;
    }

    rmt_encoder_handle_t encoder = NULL;
    rmt_copy_encoder_config_t copy_cfg = {};
    if (rmt_new_copy_encoder(&copy_cfg, &encoder) != ESP_OK) {
        rmt_del_channel(chan);
        return;
    }

    if (rmt_enable(chan) != ESP_OK) {
        rmt_del_encoder(encoder);
        rmt_del_channel(chan);
        return;
    }

    // 24 bits of '0' (RGB = 0, 0, 0) + Reset for WS2812
    rmt_symbol_word_t symbols[25];
    for (int i = 0; i < 24; i++) {
        symbols[i].level0 = 1;
        symbols[i].duration0 = 3; // 0.3us HIGH
        symbols[i].level1 = 0;
        symbols[i].duration1 = 9; // 0.9us LOW
    }
    // Latch / Reset (>280us LOW)
    symbols[24].level0 = 0;
    symbols[24].duration0 = 1500; // 150us LOW
    symbols[24].level1 = 0;
    symbols[24].duration1 = 1500; // 150us LOW (total 300us LOW)

    rmt_transmit_config_t tx_data_cfg = {
        .loop_count = 0,
    };

    rmt_transmit(chan, encoder, symbols, sizeof(symbols), &tx_data_cfg);
    rmt_tx_wait_all_done(chan, portMAX_DELAY);

    rmt_disable(chan);
    rmt_del_encoder(encoder);
    rmt_del_channel(chan);

    // Keep pin output and idle HIGH for MicroSD CS
    gpio_reset_pin(pin);
    gpio_set_direction(pin, GPIO_MODE_OUTPUT);
    gpio_set_level(pin, 1);
}

void microsd_hal_clear_onboard_led(void)
{
    ws2812_clear((gpio_num_t)PIN_MICROSD_CS);
    // Keep CS high (inactive for MicroSD card, steady DC without pulses does not affect WS2812)
    gpio_set_direction((gpio_num_t)PIN_MICROSD_CS, GPIO_MODE_OUTPUT);
    gpio_set_level((gpio_num_t)PIN_MICROSD_CS, 1);
}

esp_err_t microsd_hal_init(void)
{
    if (!s_microsd_lock) {
        s_microsd_lock = xSemaphoreCreateMutex();
    }

    // 1. Configure MicroSD_CS (GPIO 48) and TFT_CS (GPIO 14) as outputs set HIGH (inactive)
    gpio_config_t cs_cfg = {
        .pin_bit_mask = (1ULL << PIN_MICROSD_CS) | (1ULL << PIN_TFT_CS),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&cs_cfg);
    gpio_set_level((gpio_num_t)PIN_MICROSD_CS, 1);
    gpio_set_level((gpio_num_t)PIN_TFT_CS, 1);

    // 2. Enable pull-up on MISO line only (do NOT alter SCK/MOSI SPI peripheral routing)
    gpio_pullup_en((gpio_num_t)PIN_MICROSD_MISO);

    ESP_LOGI(TAG, "MicroSD HAL: Using MicroSD Card Adapter Module (EasyWare EP000094) on shared SPI (SCK=%d, MOSI=%d, MISO=%d, CS=%d)",
             PIN_MICROSD_SCK, PIN_MICROSD_MOSI, PIN_MICROSD_MISO, PIN_MICROSD_CS);

#if !FEATURE_MICROSD_ENABLED
    microsd_hal_lock();
    s_microsd_mounted = false;
    s_microsd_detected = false;
    microsd_hal_unlock();
    ESP_LOGW(TAG, "MicroSD Card not mounted (FEATURE_MICROSD_ENABLED=0). Operating in degraded mode.");
    return ESP_OK;
#else
    ESP_LOGI(TAG, "Mounting MicroSD Card Module (EasyWare EP000094, CS GPIO %d)...", PIN_MICROSD_CS);

    esp_vfs_fat_sdmmc_mount_config_t mount_config = {
        .format_if_mount_failed = false, /* Never format on boot to prevent accidental data loss */
        .max_files = 5,
        .allocation_unit_size = 16 * 1024
    };

    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = SPI2_HOST;
    host.max_freq_khz = 10000;      /* 10 MHz operating speed; driver auto-probes at 400 kHz during init */
    host.command_timeout_ms = 1000;

    sdspi_device_config_t slot_config = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot_config.gpio_cs = (gpio_num_t)PIN_MICROSD_CS;
    slot_config.host_id = host.slot;

    // Ensure both CS pins are de-asserted (HIGH) with settling time
    gpio_set_level((gpio_num_t)PIN_MICROSD_CS, 1);
    gpio_set_level((gpio_num_t)PIN_TFT_CS, 1);
    vTaskDelay(pdMS_TO_TICKS(50));

    esp_err_t ret = ESP_FAIL;
    for (int attempt = 1; attempt <= 2; ++attempt) {
        if (attempt > 1) {
            vTaskDelay(pdMS_TO_TICKS(150));
            gpio_set_level((gpio_num_t)PIN_MICROSD_CS, 1);
            gpio_set_level((gpio_num_t)PIN_TFT_CS, 1);
        }

        ESP_LOGI(TAG, "MicroSD mount attempt %d/2 (freq: %d kHz)...", attempt, host.max_freq_khz);
        ret = esp_vfs_fat_sdspi_mount("/sdcard", &host, &slot_config, &mount_config, &s_card);
        if (ret == ESP_OK) break;
        ESP_LOGW(TAG, "MicroSD mount attempt %d/2 failed: err=0x%x (%s)", attempt, ret, esp_err_to_name(ret));
    }

    if (ret == ESP_OK && s_card != NULL) {
        microsd_hal_lock();
        s_microsd_mounted = true;
        s_microsd_detected = true;
        microsd_hal_unlock();

        ws2812_clear((gpio_num_t)PIN_MICROSD_CS);
        gpio_set_direction((gpio_num_t)PIN_MICROSD_CS, GPIO_MODE_OUTPUT);
        gpio_set_level((gpio_num_t)PIN_MICROSD_CS, 1);

        uint64_t capacity_mb = ((uint64_t)s_card->csd.capacity) * s_card->csd.sector_size / (1024 * 1024);
        ESP_LOGI(TAG, "MicroSD Card mounted successfully at /sdcard (Name: %s, Capacity: %llu MB / %llu GB)",
                 s_card->cid.name, capacity_mb, capacity_mb / 1024);
    } else {
        microsd_hal_lock();
        s_microsd_mounted = false;
        /* Accurate hardware detection state: only mark detected if card responded to low-level init */
        s_microsd_detected = (s_card != NULL);
        microsd_hal_unlock();

        ws2812_clear((gpio_num_t)PIN_MICROSD_CS);
        gpio_set_direction((gpio_num_t)PIN_MICROSD_CS, GPIO_MODE_OUTPUT);
        gpio_set_level((gpio_num_t)PIN_MICROSD_CS, 1);

        if (s_microsd_detected) {
            ESP_LOGW(TAG, "MicroSD Card detected via SPI but mount failed (err=0x%x). Card may need FAT32 format.", ret);
        } else {
            ESP_LOGW(TAG, "MicroSD Card absent, unpowered, or communication failed (err=0x%x). Operating in degraded mode.", ret);
        }
    }

    return ESP_OK;
#endif
}

bool microsd_hal_is_mounted(void)
{
    return s_microsd_mounted;
}

bool microsd_hal_is_detected(void)
{
    return s_microsd_detected || s_microsd_mounted;
}

void microsd_hal_lock(void)
{
    if (s_microsd_lock) {
        xSemaphoreTake(s_microsd_lock, portMAX_DELAY);
    }
}

void microsd_hal_unlock(void)
{
    if (s_microsd_lock) {
        xSemaphoreGive(s_microsd_lock);
    }
}

void microsd_hal_get_card_info(microsd_card_info_t *out)
{
    if (!out) return;
    memset(out, 0, sizeof(*out));
    out->format_in_progress = s_format_in_progress;
    out->mounted = s_microsd_mounted;
    out->detected = s_microsd_detected || s_microsd_mounted;

#if FEATURE_MICROSD_ENABLED
    if (s_card != NULL) {
        out->detected = true;
        out->capacity_mb = ((uint64_t)s_card->csd.capacity) * s_card->csd.sector_size / (1024 * 1024);
        strncpy(out->card_name, s_card->cid.name, sizeof(out->card_name) - 1);
    }
#endif
}

#if FEATURE_MICROSD_ENABLED
/**
 * @brief Dedicated FreeRTOS background task for non-blocking FAT32 formatting.
 */
static void format_worker_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "FORMAT: Dedicated format task started.");

    /* 1. Pause TFT refresh task to release shared SPI bus during format */
    tft_hal_pause();

    /* 2. Block all concurrent writers by setting s_microsd_mounted = false */
    microsd_hal_lock();
    s_microsd_mounted = false;
    microsd_hal_unlock();

    /* Allow in-flight disk operations to settle */
    vTaskDelay(pdMS_TO_TICKS(100));

    esp_err_t ret = ESP_FAIL;

    if (s_card != NULL) {
        /* Card is already initialized in SPI mode — unmount VFS and call format */
        ESP_LOGI(TAG, "FORMAT: Unmounting /sdcard...");
        (void)esp_vfs_fat_sdcard_unmount("/sdcard", s_card);
        s_card = NULL;
    }

    /* Remount with format_if_mount_failed = true */
    ESP_LOGI(TAG, "FORMAT: Mounting with format_if_mount_failed=true...");
    esp_vfs_fat_sdmmc_mount_config_t fmt_mount_config = {
        .format_if_mount_failed = true,
        .max_files = 5,
        .allocation_unit_size = 16 * 1024
    };

    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = SPI2_HOST;
    host.max_freq_khz = 10000;
    host.command_timeout_ms = 2000;

    sdspi_device_config_t slot_config = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot_config.gpio_cs = (gpio_num_t)PIN_MICROSD_CS;
    slot_config.host_id = host.slot;

    ret = esp_vfs_fat_sdspi_mount("/sdcard", &host, &slot_config, &fmt_mount_config, &s_card);

    if (ret == ESP_OK && s_card != NULL) {
        /* Run explicit format to ensure fresh FAT32 structures */
        ESP_LOGI(TAG, "FORMAT: Running esp_vfs_fat_sdcard_format()...");
        ret = esp_vfs_fat_sdcard_format("/sdcard", s_card);
        if (ret != ESP_OK) {
            ESP_LOGW(TAG, "FORMAT: esp_vfs_fat_sdcard_format returned 0x%x (mount format may already be complete)", ret);
        }

        /* Write + read verification test */
        static const char *test_path = "/sdcard/_fmt_test.txt";
        static const char *test_data = "AgroTech MicroSD format verification OK";
        bool verify_ok = false;

        FILE *f = fopen(test_path, "w");
        if (f != NULL) {
            fputs(test_data, f);
            fclose(f);

            f = fopen(test_path, "r");
            if (f != NULL) {
                char buf[64] = {0};
                if (fgets(buf, sizeof(buf), f) != NULL) {
                    if (strcmp(buf, test_data) == 0) {
                        verify_ok = true;
                    }
                }
                fclose(f);
            }
            remove(test_path);
        }

        if (verify_ok) {
            microsd_hal_lock();
            s_microsd_mounted = true;
            s_microsd_detected = true;
            microsd_hal_unlock();
            uint64_t cap = ((uint64_t)s_card->csd.capacity) * s_card->csd.sector_size / (1024 * 1024);
            ESP_LOGI(TAG, "FORMAT COMPLETE: MicroSD card ready at /sdcard (Capacity: %llu MB)", cap);
        } else {
            ESP_LOGE(TAG, "FORMAT FAILED: Write+read verification failed.");
        }
    } else {
        ESP_LOGE(TAG, "FORMAT FAILED: Mount+format returned 0x%x (%s)", ret, esp_err_to_name(ret));
    }

    ws2812_clear((gpio_num_t)PIN_MICROSD_CS);
    gpio_set_direction((gpio_num_t)PIN_MICROSD_CS, GPIO_MODE_OUTPUT);
    gpio_set_level((gpio_num_t)PIN_MICROSD_CS, 1);

    /* Resume TFT display refresh */
    tft_hal_resume();

    s_format_in_progress = false;
    vTaskDelete(NULL);
}
#endif

esp_err_t microsd_hal_format_fat32(void)
{
#if !FEATURE_MICROSD_ENABLED
    ESP_LOGE(TAG, "FORMAT: FEATURE_MICROSD_ENABLED=0. Cannot format.");
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (s_format_in_progress) {
        ESP_LOGW(TAG, "FORMAT: Already in progress. Ignoring duplicate request.");
        return ESP_ERR_INVALID_STATE;
    }

    s_format_in_progress = true;

    ESP_LOGW(TAG, "============================================================");
    ESP_LOGW(TAG, "  RUNTIME MICROSD FAT32 FORMAT INITIATED VIA API");
    ESP_LOGW(TAG, "============================================================");

    /* Spawn dedicated worker task on Core 0 with 4KB stack */
    BaseType_t res = xTaskCreatePinnedToCore(
        format_worker_task,
        "microsd_fmt",
        4096,
        NULL,
        3,
        NULL,
        0
    );

    if (res != pdPASS) {
        s_format_in_progress = false;
        ESP_LOGE(TAG, "FORMAT: Failed to spawn format worker task.");
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
#endif
}
