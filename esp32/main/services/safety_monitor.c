#include "services/safety_monitor.h"
#include "hal/sensor_hal.h"
#include "hal/actuator_hal.h"
#include "storage/storage_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "SAFETY_MONITOR";
static bool s_has_fault = false;
static uint32_t s_last_raw_zjb1 = 0;
static uint32_t s_last_fert_fs400a = 0;
#define s_last_yfb1 s_last_raw_zjb1
#define s_last_fs400a s_last_fert_fs400a

static void safety_monitor_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Safety monitor task running at priority %d", TASK_SAFETY_MONITOR_PRIO);

    while (1) {
        sensor_hal_poll();

        sensor_readings_t sensors;
        sensor_hal_get_readings(&sensors);

        /* Rule 1: Lower float safety STOP POINT for distribution and feed pumps */
        if (!sensors.float_lower_ok) {
            bool stopped_any = false;
            if (actuator_hal_get_state(ACTUATOR_DIST_PUMP)) {
                actuator_hal_set(ACTUATOR_DIST_PUMP, false);
                stopped_any = true;
            }
            if (actuator_hal_get_state(ACTUATOR_MIXING_PUMP)) {
                actuator_hal_set(ACTUATOR_MIXING_PUMP, false);
                stopped_any = true;
            }
            if (actuator_hal_get_state(ACTUATOR_RAW_SUBMERSIBLE)) {
                actuator_hal_set(ACTUATOR_RAW_SUBMERSIBLE, false);
                stopped_any = true;
            }
            if (stopped_any && !s_has_fault) {
                ESP_LOGW(TAG, "SAFETY TRIP: Lower float switch DRY! Shutting down pumps to prevent dry-run.");
                storage_mgr_append_event_log("{\"code\":\"SAFETY_TANK_DRY\",\"level\":\"ERROR\",\"message\":\"Lower float switch dry. Pumps halted to prevent dry-run damage.\"}");
            }
        }

        /* Rule 2: Water Temperature Safety Trip (>45C) */
        if (sensors.temp_state == SENSOR_STATE_VALID) {
            if (sensors.temperature_c > 45.0f && !s_has_fault) {
                ESP_LOGE(TAG, "SAFETY TRIP: Water temperature critical (%.1f C > 45.0 C)", sensors.temperature_c);
                actuator_hal_emergency_stop();
                s_has_fault = true;
                storage_mgr_append_event_log("{\"code\":\"SAFETY_TEMP_HIGH\",\"level\":\"CRITICAL\",\"message\":\"Water temperature exceeded 45.0 C. Emergency stop engaged.\"}");
            }
        }

        /* Rule 3: Stuck/Welded Relay Detection (BS-SENS-001) */
        if (!actuator_hal_get_state(ACTUATOR_WELL_PUMP) && !actuator_hal_get_state(ACTUATOR_RAW_SUBMERSIBLE)) {
            if ((sensors.total_pulses_raw_zjb1 > s_last_raw_zjb1 + 10)) {
                ESP_LOGE(TAG, "SAFETY TRIP: Raw water flow detected while raw pumps are OFF (ZJ-B1). Welded relay or leak!");
                actuator_hal_emergency_stop();
                s_has_fault = true;
                storage_mgr_append_event_log("{\"code\":\"SAFETY_WELDED_RELAY_RAW\",\"level\":\"CRITICAL\",\"message\":\"Raw water flow detected on ZJ-B1 while pumps are OFF\"}");
            }
        }
        if (!actuator_hal_get_state(ACTUATOR_DIST_PUMP)) {
            if ((sensors.total_pulses_fert_fs400a > s_last_fert_fs400a + 10)) {
                ESP_LOGE(TAG, "SAFETY TRIP: Fertigation flow detected while dist pump is OFF (FS400A). Welded relay or leak!");
                actuator_hal_emergency_stop();
                s_has_fault = true;
                storage_mgr_append_event_log("{\"code\":\"SAFETY_WELDED_RELAY_DIST\",\"level\":\"CRITICAL\",\"message\":\"Fertigation flow detected on FS400A while dist pump is OFF\"}");
            }
        }

        /* Rule 4: Anti-Theft Tamper Loop */
        if (!sensors.tamper_loop_ok && !s_has_fault) {
            ESP_LOGE(TAG, "SAFETY TRIP: Tamper loop cut! Possible theft detected.");
            actuator_hal_emergency_stop();
            s_has_fault = true;
            storage_mgr_append_event_log("{\"code\":\"SAFETY_PUMP_THEFT_TAMPER\",\"level\":\"CRITICAL\",\"message\":\"Tamper security wire cut (GPIO 47). Emergency stop engaged.\"}");
        }

        s_last_raw_zjb1 = sensors.total_pulses_raw_zjb1;
        s_last_fert_fs400a = sensors.total_pulses_fert_fs400a;

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

esp_err_t safety_monitor_init(void)
{
    xTaskCreatePinnedToCore(safety_monitor_task, "safety_mon", TASK_SAFETY_MONITOR_STACK, NULL, TASK_SAFETY_MONITOR_PRIO, NULL, 1);
    ESP_LOGI(TAG, "Safety monitor task launched.");
    return ESP_OK;
}

bool safety_monitor_has_fault(void)
{
    return s_has_fault;
}
