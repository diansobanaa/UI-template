#include "services/panel_button_mgr.h"
#include "hal/button_hal.h"
#include "hal/actuator_hal.h"
#include "hal/tft_hal.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
#include "driver/gpio.h"

static const char *TAG = "PANEL_BTN_MGR";

#define WELL_PUMP_MANUAL_TIMEOUT_MS   (5 * 60 * 1000) /* 5 minutes */

static TimerHandle_t s_well_pump_timer = NULL;
static bool s_manual_active = false;
static TickType_t s_start_tick = 0;

static void well_pump_timer_callback(TimerHandle_t xTimer)
{
    ESP_LOGI(TAG, "Well Pump 5-minute manual runtime completed: turning OFF automatically.");
    s_manual_active = false;
    actuator_hal_set(ACTUATOR_WELL_PUMP, false);
}

static void toggle_well_pump_manual(void)
{
    bool currently_on = actuator_hal_get_state(ACTUATOR_WELL_PUMP);

    if (!currently_on) {
        /* Check safety interlocks first before attempting to start */
        if (actuator_hal_is_emergency_stopped()) {
            ESP_LOGW(TAG, "Button 2 press rejected: System in EMERGENCY STOP.");
            return;
        }
        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) {
            ESP_LOGW(TAG, "Button 2 press rejected: Lower float dry-run interlock active (Tank dry).");
            return;
        }

        esp_err_t err = actuator_hal_set(ACTUATOR_WELL_PUMP, true);
        if (err == ESP_OK) {
            s_manual_active = true;
            s_start_tick = xTaskGetTickCount();
            if (s_well_pump_timer) {
                xTimerStop(s_well_pump_timer, 0);
                xTimerStart(s_well_pump_timer, 0);
            }
            ESP_LOGI(TAG, "STATE 1: Well Pump turned ON manually (5-minute timer started).");
        } else {
            ESP_LOGW(TAG, "Failed to activate Well Pump: err=0x%x", err);
        }
    } else {
        /* STATE 2: Turn OFF immediately and cancel timer */
        if (s_well_pump_timer) {
            xTimerStop(s_well_pump_timer, 0);
        }
        s_manual_active = false;
        actuator_hal_set(ACTUATOR_WELL_PUMP, false);
        ESP_LOGI(TAG, "STATE 2: Well Pump turned OFF manually by operator press (5-minute timer cancelled).");
    }
}

static void on_panel_button_event(button_id_t btn, bool pressed)
{
    /* Only trigger on press leading edge */
    if (!pressed) return;

    switch (btn) {
        case BUTTON_MODE: /* Button 1: GPIO 0 */
            ESP_LOGI(TAG, "Button 1 pressed: Switching TFT display screen...");
            tft_show_next_screen();
            break;

        case BUTTON_MANUAL_A: /* Button 2: GPIO 39 */
            ESP_LOGI(TAG, "Button 2 pressed: Toggling Well Pump manual 5-minute run...");
            toggle_well_pump_manual();
            break;

        case BUTTON_MANUAL_B: /* Button 3: GPIO 40 */
            ESP_LOGI(TAG, "Button 3 (GPIO %d) pressed: RESERVED / TBD (No action assigned).", PIN_BTN_MANUAL_B);
            break;

        case BUTTON_DISTRIBUTION: /* Button 4: GPIO 41 */
            ESP_LOGI(TAG, "Button 4 (GPIO %d) pressed: RESERVED / TBD (No action assigned).", PIN_BTN_DISTRIBUTION);
            break;

        default:
            break;
    }
}

esp_err_t panel_button_mgr_init(void)
{
    ESP_LOGI(TAG, "Initializing Panel Button Manager...");

    /* 1. Create FreeRTOS one-shot timer for 5-minute Well Pump manual timeout */
    s_well_pump_timer = xTimerCreate(
        "well_pump_tmr",
        pdMS_TO_TICKS(WELL_PUMP_MANUAL_TIMEOUT_MS),
        pdFALSE, /* One-shot */
        NULL,
        well_pump_timer_callback
    );

    if (!s_well_pump_timer) {
        ESP_LOGE(TAG, "Failed to create Well Pump FreeRTOS timer");
        return ESP_ERR_NO_MEM;
    }

    /* 2. Register callback with button_hal (starts polling daemon on Core 1) */
    esp_err_t err = button_hal_init(on_panel_button_event);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize button_hal: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "Panel Button Manager initialized successfully.");
    ESP_LOGI(TAG, "  Button 1 (GPIO %d): TFT Display Switch", PIN_BTN_MODE);
    ESP_LOGI(TAG, "  Button 2 (GPIO %d): Well Pump Manual 5-min Toggle", PIN_BTN_MANUAL_A);
    ESP_LOGI(TAG, "  Button 3 (GPIO %d): RESERVED", PIN_BTN_MANUAL_B);
    ESP_LOGI(TAG, "  Button 4 (GPIO %d): RESERVED", PIN_BTN_DISTRIBUTION);

    return ESP_OK;
}

bool panel_button_is_well_pump_manual_active(void)
{
    return s_manual_active && actuator_hal_get_state(ACTUATOR_WELL_PUMP);
}

uint32_t panel_button_get_well_pump_remaining_sec(void)
{
    if (!s_manual_active || !actuator_hal_get_state(ACTUATOR_WELL_PUMP)) return 0;
    TickType_t elapsed = xTaskGetTickCount() - s_start_tick;
    uint32_t elapsed_ms = pdTICKS_TO_MS(elapsed);
    if (elapsed_ms >= WELL_PUMP_MANUAL_TIMEOUT_MS) return 0;
    return (WELL_PUMP_MANUAL_TIMEOUT_MS - elapsed_ms) / 1000;
}
