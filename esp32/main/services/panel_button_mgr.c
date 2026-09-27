#include "services/panel_button_mgr.h"
#include "hal/button_hal.h"
#include "hal/actuator_hal.h"
#include "hal/tft_hal.h"
#include "network/network_mgr.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
#include "driver/gpio.h"
#include "esp_timer.h"

static const char *TAG = "PANEL_BTN_MGR";

#define WELL_PUMP_MANUAL_TIMEOUT_MS   (5 * 60 * 1000) /* 5 minutes */
#define BUTTON4_QUICK_PRESS_MAX_MS    800
#define BUTTON4_PRESS_WINDOW_MS       3000
#define BUTTON4_REQUIRED_PRESSES      3
#define BUTTON4_FORCE_CONNECT_PRESSES  2

static TimerHandle_t s_well_pump_timer = NULL;
static bool s_manual_active = false;
static TickType_t s_start_tick = 0;
static uint8_t s_button4_press_count = 0;
static int64_t s_button4_window_start_us = 0;
static TimerHandle_t s_button4_action_timer = NULL;

static void well_pump_timer_callback(TimerHandle_t xTimer)
{
    ESP_LOGI(TAG, "Well Pump 5-minute manual runtime completed: turning OFF automatically.");
    s_manual_active = false;
    actuator_hal_set(ACTUATOR_WELL_PUMP, false);
}

static void reset_button4_sequence(void)
{
    s_button4_press_count = 0;
    s_button4_window_start_us = 0;
}

static void button4_action_timer_callback(TimerHandle_t xTimer)
{
    (void)xTimer;
    if (s_button4_press_count == BUTTON4_FORCE_CONNECT_PRESSES && s_button4_window_start_us != 0) {
        reset_button4_sequence();
        esp_err_t err = network_mgr_force_router_connect();
        if (err == ESP_OK) ESP_LOGI(TAG, "Button 4 double-press: forced immediate router connection attempt.");
        else ESP_LOGW(TAG, "Button 4 double-press: router connection attempt unavailable (0x%x).", err);
        return;
    }
    reset_button4_sequence();
}

static void toggle_direct_local_mode(void)
{
    if (network_mgr_is_direct_local_mode()) {
        esp_err_t err = network_mgr_exit_direct_local_mode();
        if (err == ESP_OK) ESP_LOGI(TAG, "Button 4 triple-press: Direct Local Mode OFF.");
        else ESP_LOGW(TAG, "Button 4 triple-press: Direct Local Mode could not exit (0x%x).", err);
    } else {
        esp_err_t err = network_mgr_enter_direct_local_mode();
        if (err == ESP_OK) ESP_LOGI(TAG, "Button 4 triple-press: Direct Local Mode ON.");
        else ESP_LOGW(TAG, "Button 4 triple-press: Direct Local Mode could not start (0x%x).", err);
    }
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
    if (btn == BUTTON_RESERVED) {
        if (!pressed) {
            uint32_t duration_ms = button_hal_get_last_press_duration_ms(btn);
            int64_t now_us = esp_timer_get_time();
            if (duration_ms > BUTTON4_QUICK_PRESS_MAX_MS) {
                if (s_button4_action_timer) xTimerStop(s_button4_action_timer, 0);
                reset_button4_sequence();
                ESP_LOGI(TAG, "Button 4 ignored: press was %lu ms, not a quick press.", (unsigned long)duration_ms);
                return;
            }
            if (s_button4_window_start_us == 0 || now_us - s_button4_window_start_us > ((int64_t)BUTTON4_PRESS_WINDOW_MS * 1000LL)) {
                s_button4_window_start_us = now_us;
                s_button4_press_count = 1;
            } else {
                s_button4_press_count++;
            }
            ESP_LOGI(TAG, "Button 4 quick press %u/%u.", s_button4_press_count, BUTTON4_REQUIRED_PRESSES);
            if (s_button4_press_count >= BUTTON4_REQUIRED_PRESSES) {
                if (s_button4_action_timer) xTimerStop(s_button4_action_timer, 0);
                reset_button4_sequence();
                toggle_direct_local_mode();
            } else if (s_button4_action_timer) {
                xTimerStop(s_button4_action_timer, 0);
                xTimerStart(s_button4_action_timer, 0);
            }
        }
        return;
    }

    /* Only trigger other buttons on press leading edge. */
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

        case BUTTON_RESERVED:
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

    s_button4_action_timer = xTimerCreate(
        "btn4_action",
        pdMS_TO_TICKS(BUTTON4_PRESS_WINDOW_MS),
        pdFALSE,
        NULL,
        button4_action_timer_callback
    );
    if (!s_button4_action_timer) {
        ESP_LOGE(TAG, "Failed to create Button 4 multi-click action timer");
        return ESP_ERR_NO_MEM;
    }

    /* 2. Register callback with button_hal (starts polling daemon on Core 1) */
    esp_err_t err = button_hal_init(on_panel_button_event);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize button_hal: %s", esp_err_to_name(err));
        return err;
    }

    if (PIN_BTN_RESERVED >= 0) {
        ESP_LOGI(TAG, "  Button 4 (GPIO %d): 2x force router connect, 3x toggle Direct Local Mode", PIN_BTN_RESERVED);
    } else {
        ESP_LOGI(TAG, "  Button 4: Disabled / Unassigned (Liberated for DHT22 on GPIO 41)");
    }

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
