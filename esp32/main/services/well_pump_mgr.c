#include "services/well_pump_mgr.h"
#include "services/scheduler.h"
#include "services/safety_monitor.h"
#include "services/event_mgr.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "utils/psram_task.h"
#include <string.h>

static const char *TAG = "WELL_PUMP_MGR";
static const char *NVS_NAMESPACE = "agrotech";
static const char *NVS_KEY_MODE = "wp_mode";

static SemaphoreHandle_t s_mutex = NULL;
static well_pump_mode_t s_mode = WELL_PUMP_MODE_AUTO;
static bool s_manual_session_active = false;
static int64_t s_manual_start_us = 0;
static uint32_t s_max_runtime_sec = WELL_PUMP_MAX_MANUAL_RUNTIME_SEC;
static char s_stop_reason[48] = {0};
static char s_active_schedule_id[40] = {0};
static bool s_initialized = false;

extern void telemetry_mgr_trigger_transition(const char *reason);

static void load_persisted_mode(void)
{
    s_mode = WELL_PUMP_MODE_AUTO;
}

static void persist_mode(well_pump_mode_t mode)
{
    (void)mode;
}

static esp_err_t well_pump_apply_relay(bool on, actuator_owner_t owner)
{
    /* Actuator HAL manages GPIO 1 (Relay Channel 1, Active LOW) */
    esp_err_t err = ESP_OK;
    if (on) {
        (void)actuator_hal_acquire_component("pump_well", owner);
        err = actuator_hal_set_by_component_id("pump_well", true);
        if (err != ESP_OK) {
            /* Fallback to direct actuator ID if component registry lookup differs */
            err = actuator_hal_set(ACTUATOR_WELL_PUMP, true);
        }
    } else {
        err = actuator_hal_stop_component("pump_well", owner);
        if (err != ESP_OK) {
            err = actuator_hal_set(ACTUATOR_WELL_PUMP, false);
        }
        (void)actuator_hal_release_component("pump_well", owner);
    }
    return err;
}

static void well_pump_monitor_task(void *pvParameters)
{
    (void)pvParameters;
    ESP_LOGI(TAG, "Well Pump monitor task active (250ms non-blocking check).");
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(250));

        if (!s_mutex || xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) {
            continue;
        }

        bool e_stopped = actuator_hal_is_emergency_stopped();
        bool safety_block = !safety_monitor_allows_commands();

        /* Safety Precedence Check (Priority 1) */
        if (e_stopped || safety_block) {
            if (actuator_hal_get_state(ACTUATOR_WELL_PUMP)) {
                well_pump_apply_relay(false, ACTUATOR_OWNER_SAFETY);
                if (s_manual_session_active) {
                    s_manual_session_active = false;
                    strncpy(s_stop_reason, e_stopped ? "SAFETY_ESTOP" : "SAFETY_LOCK", sizeof(s_stop_reason) - 1);
                }
                s_active_schedule_id[0] = '\0';
                ESP_LOGW(TAG, "Well Pump forced OFF by emergency stop / safety interlock.");
                telemetry_mgr_trigger_transition("WELL_PUMP_SAFETY_STOP");
            }
            xSemaphoreGive(s_mutex);
            continue;
        }

        /* 15-Minute Monotonic Runtime Limit Enforcement (Priority 2) */
        if (s_manual_session_active) {
            int64_t now_us = esp_timer_get_time();
            int64_t elapsed_us = now_us - s_manual_start_us;
            uint32_t elapsed_sec = (uint32_t)(elapsed_us / 1000000LL);

            if (elapsed_sec >= s_max_runtime_sec) {
                /* Maximum continuous manual runtime reached */
                well_pump_apply_relay(false, ACTUATOR_OWNER_MANUAL);
                s_manual_session_active = false;
                strncpy(s_stop_reason, "MANUAL_RUNTIME_LIMIT_REACHED", sizeof(s_stop_reason) - 1);
                s_active_schedule_id[0] = '\0';

                ESP_LOGW(TAG, "MANUAL_RUNTIME_LIMIT_REACHED: Well Pump automatically stopped after %u seconds (15-min limit).",
                         (unsigned)s_max_runtime_sec);
                (void)event_mgr_log(LOG_LEVEL_WARNING, "ACTUATOR", "MANUAL_RUNTIME_LIMIT_REACHED",
                                    "Well pump stopped: maximum manual runtime of 15 minutes reached.", "pump_well");
                telemetry_mgr_trigger_transition("WELL_PUMP_TIMEOUT");
            }
        }

        xSemaphoreGive(s_mutex);
    }
}

esp_err_t well_pump_mgr_init(void)
{
    if (s_initialized) return ESP_OK;

    s_mutex = xSemaphoreCreateMutex();
    if (!s_mutex) return ESP_ERR_NO_MEM;

    /* Initialize relay to safe OFF state at boot */
    well_pump_apply_relay(false, ACTUATOR_OWNER_NONE);
    s_manual_session_active = false;
    s_manual_start_us = 0;
    s_max_runtime_sec = WELL_PUMP_MAX_MANUAL_RUNTIME_SEC;
    s_stop_reason[0] = '\0';
    s_active_schedule_id[0] = '\0';

    load_persisted_mode();

    psram_task_create_pinned(well_pump_monitor_task, "well_pump_mon", 2048, NULL, 5, NULL, 1);
    s_initialized = true;
    ESP_LOGI(TAG, "Well Pump Manager initialized (Mode: %s, Safe OFF).",
             s_mode == WELL_PUMP_MODE_MANUAL ? "MANUAL" : "AUTO");
    return ESP_OK;
}

well_pump_mode_t well_pump_get_mode(void)
{
    return s_manual_session_active ? WELL_PUMP_MODE_MANUAL : WELL_PUMP_MODE_AUTO;
}

esp_err_t well_pump_set_mode(well_pump_mode_t mode)
{
    if (!s_mutex || xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_ERR_INVALID_STATE;

    if (s_mode == mode) {
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    s_mode = mode;
    persist_mode(s_mode);
    ESP_LOGI(TAG, "Operating mode transitioned to %s", mode == WELL_PUMP_MODE_MANUAL ? "MANUAL" : "AUTO");

    if (s_mode == WELL_PUMP_MODE_AUTO) {
        /* Transitioning MANUAL -> AUTO:
         * 1. Invalidate any active manual session.
         * 2. Immediately evaluate current schedule state without confirmation.
         * 3. Apply correct output state immediately. */
        s_manual_session_active = false;
        strncpy(s_stop_reason, "MODE_SWITCH_AUTO", sizeof(s_stop_reason) - 1);

        time_t now;
        time(&now);
        uint32_t rem_sec = 0;
        char sched_id[40] = {0};
        bool is_active = scheduler_is_well_pump_schedule_active(now, &rem_sec, sched_id, sizeof(sched_id));

        if (is_active) {
            if (!actuator_hal_is_emergency_stopped() && safety_monitor_allows_commands()) {
                well_pump_apply_relay(true, ACTUATOR_OWNER_SCHEDULER);
                strncpy(s_active_schedule_id, sched_id, sizeof(s_active_schedule_id) - 1);
                ESP_LOGI(TAG, "MANUAL -> AUTO: Active schedule '%s' detected (%u s remaining). Relay energizing ON immediately.",
                         sched_id, (unsigned)rem_sec);
            } else {
                well_pump_apply_relay(false, ACTUATOR_OWNER_NONE);
                s_active_schedule_id[0] = '\0';
                ESP_LOGW(TAG, "MANUAL -> AUTO: Active schedule detected but blocked by safety.");
            }
        } else {
            /* Outside active interval: turn pump OFF immediately */
            well_pump_apply_relay(false, ACTUATOR_OWNER_NONE);
            s_active_schedule_id[0] = '\0';
            ESP_LOGI(TAG, "MANUAL -> AUTO: No active schedule currently due. Pump set to OFF.");
        }
        telemetry_mgr_trigger_transition("WELL_PUMP_MODE_AUTO");
    } else {
        /* Transitioning AUTO -> MANUAL:
         * Authority transfers to manual control.
         * Preserve current output state until explicit operator action. */
        s_active_schedule_id[0] = '\0';
        strncpy(s_stop_reason, "MODE_SWITCH_MANUAL", sizeof(s_stop_reason) - 1);
        ESP_LOGI(TAG, "AUTO -> MANUAL: Operator authority active. Current output preserved.");
        telemetry_mgr_trigger_transition("WELL_PUMP_MODE_MANUAL");
    }

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t well_pump_manual_start(uint32_t duration_sec)
{
    if (!s_mutex || xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_ERR_INVALID_STATE;

    /* Validate safety protections */
    if (actuator_hal_is_emergency_stopped() || !safety_monitor_allows_commands()) {
        xSemaphoreGive(s_mutex);
        ESP_LOGW(TAG, "Manual ON rejected: Emergency Stop or safety lock active.");
        return ESP_ERR_INVALID_STATE;
    }

    /* Clamp maximum runtime to mandatory 15-minute ceiling */
    if (duration_sec == 0 || duration_sec > WELL_PUMP_MAX_MANUAL_RUNTIME_SEC) {
        duration_sec = WELL_PUMP_MAX_MANUAL_RUNTIME_SEC;
    }

    /* Idempotent check: if already running in manual session, do not reset deadline */
    if (s_manual_session_active && actuator_hal_get_state(ACTUATOR_WELL_PUMP)) {
        ESP_LOGI(TAG, "Manual ON command received while pump is already running. Preserving original deadline.");
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    /* Energize relay and start bounded manual session */
    esp_err_t err = well_pump_apply_relay(true, ACTUATOR_OWNER_MANUAL);
    if (err == ESP_OK) {
        s_manual_session_active = true;
        s_manual_start_us = esp_timer_get_time();
        s_max_runtime_sec = duration_sec;
        s_stop_reason[0] = '\0';
        s_active_schedule_id[0] = '\0';
        ESP_LOGI(TAG, "Manual Well Pump turned ON for up to %u seconds (deadline initialized).", (unsigned)duration_sec);
        telemetry_mgr_trigger_transition("WELL_PUMP_MANUAL_ON");
    } else {
        ESP_LOGE(TAG, "Failed to energize Well Pump relay: 0x%x", err);
    }

    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t well_pump_manual_stop(const char *reason)
{
    if (!s_mutex || xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_ERR_INVALID_STATE;

    /* Immediate relay de-energization */
    esp_err_t err = well_pump_apply_relay(false, ACTUATOR_OWNER_MANUAL);
    s_manual_session_active = false;
    s_active_schedule_id[0] = '\0';
    if (reason && reason[0]) {
        strncpy(s_stop_reason, reason, sizeof(s_stop_reason) - 1);
    } else {
        strncpy(s_stop_reason, "OPERATOR_OFF", sizeof(s_stop_reason) - 1);
    }

    ESP_LOGI(TAG, "Manual Well Pump turned OFF (reason: %s). Manual timer cancelled.", s_stop_reason);
    telemetry_mgr_trigger_transition("WELL_PUMP_MANUAL_OFF");

    xSemaphoreGive(s_mutex);
    return err;
}

void well_pump_toggle_physical(void)
{
    if (!s_mutex || xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return;

    if (actuator_hal_is_emergency_stopped()) {
        ESP_LOGW(TAG, "Physical toggle ignored: System in EMERGENCY STOP.");
        xSemaphoreGive(s_mutex);
        return;
    }

    bool currently_on = actuator_hal_get_state(ACTUATOR_WELL_PUMP);

    if (!currently_on) {
        esp_err_t err = well_pump_apply_relay(true, ACTUATOR_OWNER_MANUAL);
        if (err == ESP_OK) {
            s_manual_session_active = true;
            s_manual_start_us = esp_timer_get_time();
            s_max_runtime_sec = WELL_PUMP_MAX_MANUAL_RUNTIME_SEC;
            s_stop_reason[0] = '\0';
            s_active_schedule_id[0] = '\0';
            ESP_LOGI(TAG, "Physical Toggle -> ON: Started 15-minute manual session.");
            telemetry_mgr_trigger_transition("WELL_PUMP_PHYSICAL_ON");
        }
    } else {
        /* Physical toggle turning OFF */
        well_pump_apply_relay(false, ACTUATOR_OWNER_MANUAL);
        s_manual_session_active = false;
        s_active_schedule_id[0] = '\0';
        strncpy(s_stop_reason, "PHYSICAL_TOGGLE_OFF", sizeof(s_stop_reason) - 1);
        ESP_LOGI(TAG, "Physical Toggle -> OFF: Stopped manually.");
        telemetry_mgr_trigger_transition("WELL_PUMP_PHYSICAL_OFF");
    }

    xSemaphoreGive(s_mutex);
}

void well_pump_emergency_stop(void)
{
    if (!s_mutex) return;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        well_pump_apply_relay(false, ACTUATOR_OWNER_SAFETY);
        s_manual_session_active = false;
        s_active_schedule_id[0] = '\0';
        strncpy(s_stop_reason, "SAFETY_ESTOP", sizeof(s_stop_reason) - 1);
        xSemaphoreGive(s_mutex);
    }
}

esp_err_t well_pump_reconcile_auto_schedule(time_t now)
{
    if (!s_mutex || xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_ERR_INVALID_STATE;

    if (s_mode != WELL_PUMP_MODE_AUTO) {
        xSemaphoreGive(s_mutex);
        return ESP_OK; /* MANUAL mode prevents schedule reconciliation */
    }

    if (actuator_hal_is_emergency_stopped() || !safety_monitor_allows_commands()) {
        well_pump_apply_relay(false, ACTUATOR_OWNER_SAFETY);
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    uint32_t rem_sec = 0;
    char sched_id[40] = {0};
    bool is_active = scheduler_is_well_pump_schedule_active(now, &rem_sec, sched_id, sizeof(sched_id));

    bool currently_on = actuator_hal_get_state(ACTUATOR_WELL_PUMP);

    if (is_active) {
        if (!currently_on) {
            well_pump_apply_relay(true, ACTUATOR_OWNER_SCHEDULER);
            strncpy(s_active_schedule_id, sched_id, sizeof(s_active_schedule_id) - 1);
            ESP_LOGI(TAG, "AUTO Schedule activated: '%s' ON (%u s remaining).", sched_id, (unsigned)rem_sec);
            telemetry_mgr_trigger_transition("WELL_PUMP_AUTO_ON");
        }
    } else {
        if (currently_on) {
            well_pump_apply_relay(false, ACTUATOR_OWNER_SCHEDULER);
            s_active_schedule_id[0] = '\0';
            strncpy(s_stop_reason, "SCHEDULE_STOP", sizeof(s_stop_reason) - 1);
            ESP_LOGI(TAG, "AUTO Schedule window ended: Well Pump OFF.");
            telemetry_mgr_trigger_transition("WELL_PUMP_AUTO_OFF");
        }
    }

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t well_pump_get_status(well_pump_status_t *out_status)
{
    if (!out_status) return ESP_ERR_INVALID_ARG;
    if (!s_mutex || xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_ERR_INVALID_STATE;

    out_status->mode = s_mode;
    out_status->on = actuator_hal_get_state(ACTUATOR_WELL_PUMP);
    out_status->is_manual_session_active = s_manual_session_active;
    out_status->max_runtime_sec = s_max_runtime_sec;

    if (s_manual_session_active && out_status->on) {
        int64_t now_us = esp_timer_get_time();
        uint32_t elapsed = (uint32_t)((now_us - s_manual_start_us) / 1000000LL);
        out_status->elapsed_sec = elapsed;
        out_status->remaining_sec = (elapsed < s_max_runtime_sec) ? (s_max_runtime_sec - elapsed) : 0;
    } else {
        out_status->elapsed_sec = 0;
        out_status->remaining_sec = 0;
    }

    strncpy(out_status->stop_reason, s_stop_reason, sizeof(out_status->stop_reason) - 1);
    out_status->stop_reason[sizeof(out_status->stop_reason) - 1] = '\0';

    strncpy(out_status->active_schedule_id, s_active_schedule_id, sizeof(out_status->active_schedule_id) - 1);
    out_status->active_schedule_id[sizeof(out_status->active_schedule_id) - 1] = '\0';

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}
