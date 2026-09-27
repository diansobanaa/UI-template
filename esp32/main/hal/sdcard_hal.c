#include "hal/sdcard_hal.h"
#include "config/pin_config.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_vfs_fat.h"
#include "driver/sdspi_host.h"
#include "driver/spi_common.h"
#include "sdmmc_cmd.h"
#include "driver/gpio.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "SDCARD_HAL";
static bool s_sd_mounted = false;
static SemaphoreHandle_t s_sd_lock = NULL;
#if FEATURE_SDCARD_ENABLED
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
    // WS2812 '0': 0.3us HIGH (3 ticks), 0.9us LOW (9 ticks)
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

    // Keep pin output and idle HIGH for SD CS
    gpio_reset_pin(pin);
    gpio_set_direction(pin, GPIO_MODE_OUTPUT);
    gpio_set_level(pin, 1);
}

esp_err_t sdcard_hal_init(void)
{
    if (!s_sd_lock) {
        s_sd_lock = xSemaphoreCreateMutex();
    }

    // 0. Turn off onboard WS2812 RGB LED on GPIO 48 before touching SPI
    ws2812_clear(PIN_SD_CS);

    // 1. Configure SD_CS (GPIO 48) as output set HIGH (inactive)
    // This guarantees the SD card bus stays unselected during boot and TFT operations
    gpio_config_t cs_conf = {
        .pin_bit_mask = (1ULL << PIN_SD_CS),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&cs_conf);
    gpio_set_level(PIN_SD_CS, 1);

    // 2. Pull up SPI bus lines to ensure idle HIGH state on shared bus
    gpio_set_pull_mode(PIN_SPI_MISO, GPIO_PULLUP_ONLY);
    gpio_set_pull_mode(PIN_SPI_MOSI, GPIO_PULLUP_ONLY);
    gpio_set_pull_mode(PIN_SPI_SCK, GPIO_PULLUP_ONLY);

    ESP_LOGI(TAG, "SD Card HAL: Using MicroSD Adapter Module (EasyWare EP000094) on shared SPI (SCK=%d, MOSI=%d, MISO=%d, CS=%d)",
             PIN_SD_SCK, PIN_SD_MOSI, PIN_SD_MISO, PIN_SD_CS);

#if !FEATURE_SDCARD_ENABLED
    sdcard_hal_lock();
    s_sd_mounted = false;
    sdcard_hal_unlock();
    ESP_LOGW(TAG, "SD Card not mounted (FEATURE_SDCARD_ENABLED=0). Operating in degraded mode.");
    return ESP_OK;
#else
    ESP_LOGI(TAG, "Mounting MicroSD Card (EasyWare EP000094, CS GPIO %d)...", PIN_SD_CS);

    esp_vfs_fat_sdmmc_mount_config_t mount_config = {
        .format_if_mount_failed = false,
        .max_files = 5,
        .allocation_unit_size = 16 * 1024
    };

    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = SPI2_HOST;
    host.command_timeout_ms = 100; // Bounded timeout (100 ms)

    sdspi_device_config_t slot_config = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot_config.gpio_cs = PIN_SD_CS;
    slot_config.host_id = host.slot;

    esp_err_t ret = esp_vfs_fat_sdspi_mount("/sdcard", &host, &slot_config, &mount_config, &s_card);

    if (ret == ESP_OK) {
        sdcard_hal_lock();
        s_sd_mounted = true;
        sdcard_hal_unlock();
        ws2812_clear(PIN_SD_CS);
        gpio_set_direction(PIN_SD_CS, GPIO_MODE_OUTPUT);
        gpio_set_level(PIN_SD_CS, 1);
        ESP_LOGI(TAG, "SD Card mounted at /sdcard (Capacity: %llu MB)",
                 ((uint64_t)s_card->csd.capacity) * s_card->csd.sector_size / (1024 * 1024));
    } else {
        sdcard_hal_lock();
        s_sd_mounted = false;
        sdcard_hal_unlock();
        // Clear WS2812 pulses latched during mount probe
        ws2812_clear(PIN_SD_CS);
        // Ensure CS is left HIGH / unselected after failed attempt
        gpio_set_direction(PIN_SD_CS, GPIO_MODE_OUTPUT);
        gpio_set_level(PIN_SD_CS, 1);
        ESP_LOGW(TAG, "SD Card absent or mount failed (err=0x%x). Operating in degraded mode.", ret);
    }

    return ESP_OK;
#endif
}

bool sdcard_hal_is_mounted(void)
{
    return s_sd_mounted;
}

void sdcard_hal_lock(void)
{
    if (s_sd_lock) {
        xSemaphoreTake(s_sd_lock, portMAX_DELAY);
    }
}

void sdcard_hal_unlock(void)
{
    if (s_sd_lock) {
        xSemaphoreGive(s_sd_lock);
    }
}

void sdcard_hal_clear_onboard_led(void)
{
    ws2812_clear(PIN_SD_CS);
    // Keep CS high (inactive for SD card, steady DC without pulses does not affect WS2812)
    gpio_set_direction(PIN_SD_CS, GPIO_MODE_OUTPUT);
    gpio_set_level(PIN_SD_CS, 1);
}
