#include "hal/sdcard_hal.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "esp_vfs_fat.h"
#include "driver/sdspi_host.h"
#include "driver/spi_common.h"
#include "sdmmc_cmd.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "SDCARD_HAL";
static bool s_sd_mounted = false;
static sdmmc_card_t *s_card = NULL;
static SemaphoreHandle_t s_sd_lock = NULL;

esp_err_t sdcard_hal_init(void)
{
    if (!s_sd_lock) {
        s_sd_lock = xSemaphoreCreateMutex();
    }
    ESP_LOGI(TAG, "Checking for microSD card on SPI CS (GPIO %d)...", PIN_MICROSD_CS);

    esp_vfs_fat_sdmmc_mount_config_t mount_config = {
        .format_if_mount_failed = false,
        .max_files = 5,
        .allocation_unit_size = 16 * 1024
    };

    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    sdspi_device_config_t slot_config = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot_config.gpio_cs = PIN_MICROSD_CS;
    slot_config.host_id = host.slot;

    esp_err_t ret = esp_vfs_fat_sdspi_mount("/sdcard", &host, &slot_config, &mount_config, &s_card);
    if (ret == ESP_OK) {
        s_sd_mounted = true;
        ESP_LOGI(TAG, "microSD Card mounted at /sdcard (Capacity: %llu MB)",
                 ((uint64_t)s_card->csd.capacity) * s_card->csd.sector_size / (1024 * 1024));
    } else {
        s_sd_mounted = false;
        ESP_LOGW(TAG, "microSD card not detected (err=0x%x). System continues with internal SPIFFS.", ret);
    }

    return ret;
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
