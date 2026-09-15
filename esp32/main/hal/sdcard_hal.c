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

esp_err_t sdcard_hal_init(void)
{
    if (!s_sd_lock) {
        s_sd_lock = xSemaphoreCreateMutex();
    }

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

    ESP_LOGI(TAG, "SD Card HAL: Using TFT onboard slot on shared SPI (SCK=%d, MOSI=%d, MISO=%d, CS=%d)",
             PIN_SD_SCK, PIN_SD_MOSI, PIN_SD_MISO, PIN_SD_CS);

#if !FEATURE_SDCARD_ENABLED
    sdcard_hal_lock();
    s_sd_mounted = false;
    sdcard_hal_unlock();
    ESP_LOGW(TAG, "SD Card not mounted (FEATURE_SDCARD_ENABLED=0). Operating in degraded mode.");
    return ESP_OK;
#else
    ESP_LOGI(TAG, "Mounting SD Card from TFT onboard slot (CS GPIO %d)...", PIN_SD_CS);

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
        ESP_LOGI(TAG, "SD Card mounted at /sdcard (Capacity: %llu MB)",
                 ((uint64_t)s_card->csd.capacity) * s_card->csd.sector_size / (1024 * 1024));
    } else {
        sdcard_hal_lock();
        s_sd_mounted = false;
        sdcard_hal_unlock();
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
