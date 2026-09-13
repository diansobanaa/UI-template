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
static uint32_t s_last_yfb1 = 0;
static uint32_t s_last_fs400a = 0;

static void safety_monitor_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Safety monitor task running at priority %d", TASK_SAFETY_MONITOR_PRIO);

    while (1) {
        sensor_hal_poll();

        sensor_readings_t sensors;
        sensor_hal_get_readings(&sensors);

        /* Rule 1: Dry run protection */
        if (!sensors.float_lower_ok) {
            if (actuator_hal_get_state(ACTUATOR_DIST_PUMP) || actuator_hal_get_state(ACTUATOR_WELL_PUMP)) {
                ESP_LOGE(TAG, "SAFETY TRIP: Float lower switch tripped! Killing pumps to prevent dry run.");
                actuator_hal_set(ACTUATOR_DIST_PUMP, false);
                actuator_hal_set(ACTUATOR_WELL_PUMP, false);
                actuator_hal_set(ACTUATOR_ERROR_LAMP, true);
                s_has_fault = true;

                storage_mgr_append_event_log("{\"code\":\"SAFETY_DRY_RUN\",\"level\":\"CRITICAL\",\"message\":\"Dry-run protection tripped: tank low\"}");
            }
        }

        /* Rule 2: Over-temperature protection (> 45°C) */
        if (sensors.temp_state == SENSOR_STATE_VALID && sensors.temperature_c > 45.0f) {
            if (!actuator_hal_get_state(ACTUATOR_COOLING_FAN)) {
                ESP_LOGW(TAG, "High temperature detected (%.1f C). Activating cooling fan.", sensors.temperature_c);
                actuator_hal_set(ACTUATOR_COOLING_FAN, true);
            }
        } else if (sensors.temp_state == SENSOR_STATE_VALID && sensors.temperature_c < 35.0f) {
            if (actuator_hal_get_state(ACTUATOR_COOLING_FAN)) {
                actuator_hal_set(ACTUATOR_COOLING_FAN, false);
            }
        }

        /* Rule 3: Stuck/Welded Relay Detection (BS-SENS-001) */
        if (!actuator_hal_get_state(ACTUATOR_WELL_PUMP) && !actuator_hal_get_state(ACTUATOR_RAW_SUBMERSIBLE)) {
            if ((sensors.total_pulses_yfb1 > s_last_yfb1 + 10)) {
                ESP_LOGE(TAG, "SAFETY TRIP: Flow detected while pump is OFF. Welded relay!");
                actuator_hal_emergency_stop();
                s_has_fault = true;
                storage_mgr_append_event_log("{\"code\":\"SAFETY_WELDED_RELAY\",\"level\":\"CRITICAL\",\"message\":\"Flow detected while pump is OFF\"}");
            }
        }
        if (!actuator_hal_get_state(ACTUATOR_DIST_PUMP)) {
            if ((sensors.total_pulses_fs400a > s_last_fs400a + 10)) {
                ESP_LOGE(TAG, "SAFETY TRIP: Dist Flow detected while pump is OFF. Welded relay!");
                actuator_hal_emergency_stop();
                s_has_fault = true;
                storage_mgr_append_event_log("{\"code\":\"SAFETY_WELDED_RELAY\",\"level\":\"CRITICAL\",\"message\":\"Dist flow detected while pump is OFF\"}");
            }
        }
        s_last_yfb1 = sensors.total_pulses_yfb1;
        s_last_fs400a = sensors.total_pulses_fs400a;

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

esp_err_t safety_monitor_init(void)
{
    xTaskCreate(safety_monitor_task, "safety_mon", TASK_SAFETY_MONITOR_STACK, NULL, TASK_SAFETY_MONITOR_PRIO, NULL);
    ESP_LOGI(TAG, "Safety monitor task launched.");
    return ESP_OK;
}

bool safety_monitor_has_fault(void)
{
    return s_has_fault;
}
