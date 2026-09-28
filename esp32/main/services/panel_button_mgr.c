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

/* SOFTAP-BTN: GPIO 0 (BOOT/MODE) long-press detection for SoftAP toggle.
 * Since ALL 49 GPIOs (0-48) on ESP32-S3-WROOM-1-N16R8 are in use or reserved,
 * there is NO free GPIO for a dedicated SoftAP button. Instead, we reuse
 * GPIO 0 (BOOT/MODE button) with press-duration discrimination:
 *   - Short press (< 500ms): cycle TFT screen (existing behavior, unchanged)
 *   - Long press (>= 3000ms): toggle SoftAP / Direct Local Mode
 *   - Medium press (500-3000ms): ignored (dead zone, prevents accidental trigger)
 *
 * Implementation: FreeRTOS one-shot timer started on press-down. If timer
 * fires (button still held after 3s), SoftAP is toggled immediately — operator
 * gets instant feedback without waiting for release. On release, if long-press
 * was already triggered, TFT switch is suppressed.
 *
 * Safety: toggle_direct_local_mode() does NOT reboot, does NOT erase config,
 * does NOT reset schedules/recipes/crop data. It only enables/disables SoftAP
 * WiFi interface. All local operations and safety interlocks remain active.
 */
#define MODE_BTN_SOFTAP_HOLD_MS   3000  /* 3 second hold to toggle SoftAP */
#define MODE_BTN_SHORT_PRESS_MAX  500   /* < 500ms = short press (TFT switch) */

static TimerHandle_t s_well_pump_timer = NULL;
static bool s_manual_active = false;
static TickType_t s_start_tick = 0;
static uint8_t s_button4_press_count = 0;
static int64_t s_button4_window_start_us = 0;
static TimerHandle_t s_button4_action_timer = NULL;

/* SOFTAP-BTN: Long-press timer + flag for BUTTON_MODE (GPIO 0) */
static TimerHandle_t s_softap_btn_timer = NULL;
static bool s_mode_long_fired = false;

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
        if (err == ESP_OK) ESP_LOGI(TAG, "Direct Local Mode / SoftAP OFF.");
        else ESP_LOGW(TAG, "Direct Local Mode / SoftAP could not exit (0x%x).", err);
    } else {
        esp_err_t err = network_mgr_enter_direct_local_mode();
        if (err == ESP_OK) ESP_LOGI(TAG, "Direct Local Mode / SoftAP ON. Connect to AGROTECH-SETUP-XXXX and open 192.168.4.1/setup");
        else ESP_LOGW(TAG, "Direct Local Mode / SoftAP could not start (0x%x).", err);
    }
}

/* SOFTAP-BTN: Timer callback — fires when MODE button (GPIO 0) is held 3s.
 * Toggles SoftAP / Direct Local Mode immediately (no need to wait for release).
 * Safety: verifies button is still pressed to avoid false trigger from
 * release event not yet processed by polling task (20ms poll interval). */
static void softap_btn_timer_callback(TimerHandle_t xTimer)
{
    (void)xTimer;
    if (button_hal_is_pressed(BUTTON_MODE)) {
        s_mode_long_fired = true;
        ESP_LOGI(TAG, "MODE button long-press (3s) — toggling SoftAP / Direct Local Mode");
        toggle_direct_local_mode();
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
    /* SOFTAP-BTN: BUTTON_RESERVED (Button 4) handler — disabled when PIN_BTN_RESERVED < 0.
     * Kept for backward compat; the code is unreachable when PIN=-1 because
     * button_hal skips GPIO config for negative pins and never generates events. */
    if (btn == BUTTON_RESERVED) {
        if (PIN_BTN_RESERVED < 0) return;  /* Button 4 disabled — DHT22 owns GPIO 41 */
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

    /* SOFTAP-BTN: BUTTON_MODE (GPIO 0) — dual-function via press duration.
     * Short press (< 500ms): TFT screen switch (existing behavior)
     * Long press (>= 3000ms): toggle SoftAP / Direct Local Mode
     * Medium press (500-3000ms): ignored (dead zone)
     *
     * This replaces the old Button 4 (GPIO 41) Network Change Mode trigger
     * which was disabled when GPIO 41 was reclaimed by DHT22.
     */
    if (btn == BUTTON_MODE) {
        if (pressed) {
            /* Press leading edge: start long-press timer */
            s_mode_long_fired = false;
            if (s_softap_btn_timer) {
                xTimerStop(s_softap_btn_timer, 0);  /* cancel any pending */
                xTimerStart(s_softap_btn_timer, 0);
            }
        } else {
            /* Release trailing edge: stop timer, decide action */
            if (s_softap_btn_timer) xTimerStop(s_softap_btn_timer, 0);
            if (s_mode_long_fired) {
                /* Long-press already triggered SoftAP — suppress TFT switch */
                ESP_LOGI(TAG, "MODE button released after long-press (SoftAP toggled).");
            } else {
                uint32_t duration_ms = button_hal_get_last_press_duration_ms(btn);
                if (duration_ms < MODE_BTN_SHORT_PRESS_MAX) {
                    /* Short press: TFT screen switch (existing behavior) */
                    ESP_LOGI(TAG, "Button 1 short press (%lu ms): Switching TFT display screen...", (unsigned long)duration_ms);
                    tft_show_next_screen();
                } else {
                    /* Medium press: dead zone — prevents accidental SoftAP from medium-length TFT presses */
                    ESP_LOGI(TAG, "Button 1 medium press (%lu ms): Ignored (dead zone 500-3000ms).", (unsigned long)duration_ms);
                }
            }
        }
        return;
    }

    /* Other buttons: only trigger on press leading edge. */
    if (!pressed) return;

    switch (btn) {
        case BUTTON_MANUAL_A: /* Button 2: GPIO 39 */
            ESP_LOGI(TAG, "Button 2 pressed: Toggling Well Pump manual 5-minute run...");
            toggle_well_pump_manual();
            break;

        case BUTTON_MODE:
            /* Already handled above — this case is unreachable but kept for compiler completeness */
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

    /* SOFTAP-BTN: Create one-shot timer for MODE button long-press detection.
     * When MODE (GPIO 0) is held for 3 seconds, this timer fires and toggles
     * SoftAP / Direct Local Mode. Timer is started on press-down, stopped on
     * release. Uses existing FreeRTOS timer infrastructure (same as well_pump_timer). */
    s_softap_btn_timer = xTimerCreate(
        "softap_btn",
        pdMS_TO_TICKS(MODE_BTN_SOFTAP_HOLD_MS),
        pdFALSE,  /* One-shot */
        NULL,
        softap_btn_timer_callback
    );
    if (!s_softap_btn_timer) {
        ESP_LOGE(TAG, "Failed to create SoftAP button long-press timer");
        return ESP_ERR_NO_MEM;
    }

    /* 2. Register callback with button_hal (starts polling daemon on Core 1) */
    esp_err_t err = button_hal_init(on_panel_button_event);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize button_hal: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "  Button 1 (GPIO 0 / BOOT): short press = TFT screen switch, long press 3s = SoftAP toggle");

    if (PIN_BTN_RESERVED >= 0) {
        ESP_LOGI(TAG, "  Button 4 (GPIO %d): 2x force router connect, 3x toggle Direct Local Mode", PIN_BTN_RESERVED);
    } else {
        ESP_LOGI(TAG, "  Button 4: Disabled (GPIO 41 owned by DHT22). SoftAP via Button 1 long-press or /setup web UI.");
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
