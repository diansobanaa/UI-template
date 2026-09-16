#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "driver/gpio.h"

#include "config/pin_config.h"
#include "config/system_config.h"
#include "hal/hardware_registry.h"
#include "storage/storage_mgr.h"
#include "http/http_server.h"
#include "network/network_mgr.h"
#include "hal/rtc_ds3231.h"
#include "services/command_mgr.h"
#include "services/safety_monitor.h"
#include "services/scheduler.h"
#include "services/crop_cycle_mgr.h"
#include "services/telemetry_mgr.h"
#include "services/event_mgr.h"
#include "hal/sdcard_hal.h"
#include "hal/tft_hal.h"
#include "services/panel_button_mgr.h"

static const char *TAG = "AGROTECH_MAIN";

/**
 * @brief Enforce immediate fail-safe state on all actuator GPIO outputs.
 *
 * This function executes BEFORE any network, storage, or runtime tasks start.
 * Ensures that reboot, brownout recovery, or crash cannot leave pumps or fans ON.
 */
static void safe_boot_actuators(void)
{
    ESP_LOGI(TAG, "Executing safe boot: initializing all outputs to OFF state...");

    const gpio_num_t output_pins[] = {
        PIN_OUT_WELL_PUMP,
        PIN_OUT_DIST_PUMP,
        PIN_OUT_RAW_SUBMERSIBLE,
        PIN_OUT_DOSING_A,
        PIN_OUT_DOSING_B,
        PIN_OUT_COOLING_FAN,
        PIN_OUT_ERROR_LAMP
    };

    gpio_config_t io_conf = {
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = (ACTUATOR_LEVEL_OFF == 1) ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
        .pull_down_en = (ACTUATOR_LEVEL_OFF == 0) ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
        .pin_bit_mask = 0
    };

    for (size_t i = 0; i < sizeof(output_pins) / sizeof(output_pins[0]); ++i) {
        /* Set level low first before setting as output */
        gpio_set_level(output_pins[i], ACTUATOR_LEVEL_OFF);
        io_conf.pin_bit_mask |= (1ULL << output_pins[i]);
    }

    esp_err_t err = gpio_config(&io_conf);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Safe boot complete: 7 actuator channels locked in safe-off state.");
    } else {
        ESP_LOGE(TAG, "CRITICAL: Failed to configure actuator safe GPIOs (err=0x%x)", err);
    }
}

/**
 * @brief Initialize Non-Volatile Storage (NVS).
 */
static esp_err_t init_nvs(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS partition truncated or reformatted. Erasing and retrying...");
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    return ret;
}

/**
 * @brief Print chip hardware diagnostics and memory status.
 */
static void print_system_diagnostics(void)
{
    esp_chip_info_t chip_info;
    esp_chip_info(&chip_info);

    uint32_t flash_size = 0;
    esp_flash_get_size(NULL, &flash_size);

    ESP_LOGI(TAG, "==================================================");
    ESP_LOGI(TAG, " %s v%s", FIRMWARE_NAME, FIRMWARE_VERSION);
    ESP_LOGI(TAG, " Target Hardware : %s", HARDWARE_MODEL);
    ESP_LOGI(TAG, " Contract Spec   : %s", CONTRACT_VERSION);
    ESP_LOGI(TAG, " Cores           : %d (rev %d)", chip_info.cores, chip_info.revision);
    ESP_LOGI(TAG, " Flash Size      : %lu MB", (unsigned long)(flash_size / (1024 * 1024)));
    ESP_LOGI(TAG, " Free Heap       : %lu bytes", (unsigned long)esp_get_free_heap_size());
    ESP_LOGI(TAG, " Min Free Heap   : %lu bytes", (unsigned long)esp_get_minimum_free_heap_size());
    ESP_LOGI(TAG, "==================================================");
}

void app_main(void)
{
    /* 1. Safe boot first — outputs locked to safe OFF immediately */
    safe_boot_actuators();

    /* 2. Print boot banner and diagnostics */
    print_system_diagnostics();

    /* 3. Initialize core system services */
    ESP_ERROR_CHECK(init_nvs());
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(network_mgr_init());

    /* 4. Initialize Hardware Abstraction Layer (SP-003) */
    ESP_ERROR_CHECK(hardware_hal_init_all());
    sdcard_hal_init();
    if (rtc_ds3231_init() == ESP_OK) {
        rtc_ds3231_sync_to_system();
    } else {
        ESP_LOGW(TAG, "RTC DS3231 not present. Operating in degraded time mode (SNTP/system timer).");
    }

    /* Initialize TFT ST7735 display in degraded-safe mode */
    if (tft_hal_init() == ESP_OK && tft_hal_is_available()) {
        tft_show_diagnostic_screen(DEFAULT_DEVICE_ID, FIRMWARE_VERSION);
    } else {
        ESP_LOGW(TAG, "TFT ST7735 not present or unattached. Operating in degraded headless mode.");
    }

    /* 5. Initialize Durable Storage & Recovery (SP-004) */
    ESP_ERROR_CHECK(storage_mgr_init());
    if (tft_hal_is_available()) {
        const system_storage_state_t *st = storage_mgr_get_state();
        if (st && st->device_id[0] != '\0') {
            tft_show_diagnostic_screen(st->device_id, FIRMWARE_VERSION);
        }
    }

    /* 6. Initialize Runtime Services & Safety (SP-006) */
    ESP_ERROR_CHECK(command_mgr_init());
    ESP_ERROR_CHECK(safety_monitor_init());
    ESP_ERROR_CHECK(scheduler_init());
    ESP_ERROR_CHECK(panel_button_mgr_init());

    /* 7. Initialize Crop Cycle Engine & Persistence (SP-007) */
    ESP_ERROR_CHECK(crop_cycle_mgr_init());

    /* 8. Initialize Telemetry & Event System (SP-008) */
    ESP_ERROR_CHECK(telemetry_mgr_init());
    ESP_ERROR_CHECK(event_mgr_init());

    /* 9. Start REST HTTP Server (SP-005) */
    ESP_ERROR_CHECK(http_server_start());

    ESP_LOGI(TAG, "AgroTech ESP32-S3 Backend fully initialized (SP-008).");
}
