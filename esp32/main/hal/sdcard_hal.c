#include "hal/sdcard_hal.h"
#include "config/pin_config.h"
#include "config/system_config.h"
#include "esp_err.h"
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

    /* 2b. Quiet the shared SPI2 bus before probing the SD card: force the TFT
     * display's CS (GPIO 14) HIGH (deselected). The TFT HAL has not run yet at
     * this point, so its CS pin may float; a floating CS could let the display
     * drive MISO and corrupt the SD card's CMD0/CMD8 identification sequence
     * (which then surfaces as 0x108 timeout). tft_hal_init() reconfigures these
     * pins afterwards, so this is harmless. */
    gpio_set_direction((gpio_num_t)PIN_TFT_CS, GPIO_MODE_OUTPUT);
    gpio_set_level(PIN_TFT_CS, 1);

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
    /* SD-SPEED-FIX (2026-09-28): 20MHz -> 10MHz. Field evidence: CMD0 gets a
     * valid R1 (card is alive) but CMD8 (SEND_IF_COND) returns 0x108
     * (ESP_ERR_INVALID_RESPONSE) on all 3 attempts with card inserted and
     * power OK. A longer R7 response failing after a good R1 points at
     * signal integrity on the shared SPI2 bus (adapter module + wiring),
     * not at a dead card. 10MHz still gives >1MB/s, plenty for telemetry
     * batches. If 0x108 persists at 10MHz, measure the module's 3.3V rail AT
     * THE CARD: many EP000094-class modules have a 5V->3.3V LDO and brown
     * out when fed 3.3V on VCC. */
    host.max_freq_khz = 10000;
    host.command_timeout_ms = 100; // Bounded timeout (100 ms)

    sdspi_device_config_t slot_config = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot_config.gpio_cs = PIN_SD_CS;
    slot_config.host_id = host.slot;

    /* Retry the mount up to 3 times: some cards need extra power-settle time
     * after 3.3V ramp, and the first CMD0/CMD8 sequence can collide with bus
     * noise during early boot. Each attempt is logged with its exact error so
     * a persistent 0x108 (timeout = card not answering at all) can be told
     * apart from transient failures. A persistent 0x108 with a card inserted
     * is a hardware issue (seating, adapter, power, wiring) — not software. */
    /* Silence IDF-internal sdmmc/vfs_fat logs during probing — they emit
     * dozens of identical E-lines per attempt when no card is present.
     * Our own W-lines below still capture the outcome clearly. */
    esp_log_level_set("sdmmc_sd",       ESP_LOG_NONE);
    esp_log_level_set("vfs_fat_sdmmc",  ESP_LOG_NONE);
    esp_log_level_set("sdmmc_common",   ESP_LOG_NONE);

    esp_err_t ret = ESP_FAIL;
    for (int attempt = 1; attempt <= 3; ++attempt) {
        if (attempt > 1) {
            vTaskDelay(pdMS_TO_TICKS(600));
            gpio_set_level(PIN_SD_CS, 1);
            gpio_set_level(PIN_TFT_CS, 1);
        }
        ESP_LOGI(TAG, "SD mount attempt %d/3 ...", attempt);
        ret = esp_vfs_fat_sdspi_mount("/sdcard", &host, &slot_config, &mount_config, &s_card);
        if (ret == ESP_OK) break;
        ESP_LOGW(TAG, "SD mount attempt %d/3 failed: err=0x%x (%s)", attempt, ret, esp_err_to_name(ret));
    }

    /* Restore default log levels */
    esp_log_level_set("sdmmc_sd",       ESP_LOG_INFO);
    esp_log_level_set("vfs_fat_sdmmc",  ESP_LOG_INFO);
    esp_log_level_set("sdmmc_common",   ESP_LOG_INFO);

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
