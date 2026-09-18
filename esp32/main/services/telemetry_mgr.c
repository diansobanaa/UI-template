#include "services/telemetry_mgr.h"
#include "hal/sensor_hal.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "storage/storage_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <string.h>
#include <time.h>

static const char *TAG = "TELEMETRY_MGR";

static telemetry_snapshot_t s_snapshot = {0};
static SemaphoreHandle_t s_snap_mutex = NULL;

static void telemetry_sampler_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Telemetry sampler task started at priority %d", TASK_TELEMETRY_PRIO);

    while (1) {
        sensor_hal_poll();

        sensor_readings_t sensors;
        sensor_hal_get_readings(&sensors);

        xSemaphoreTake(s_snap_mutex, portMAX_DELAY);
        s_snapshot.sequence++;

        time_t now = time(NULL);
        strftime(s_snapshot.timestamp, sizeof(s_snapshot.timestamp), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));

        s_snapshot.temp_valid = (sensors.temp_state == SENSOR_STATE_VALID);
        s_snapshot.temperature_c = sensors.temperature_c;
        s_snapshot.humidity_pct = 0.0f;
        s_snapshot.humidity_valid = false;
        s_snapshot.light_lux = 0.0f;
        s_snapshot.light_valid = false;
        s_snapshot.float_lower_ok = sensors.float_lower_ok;
        s_snapshot.water_level_pct = sensors.float_lower_ok ? 100.0f : 0.0f;
        s_snapshot.flow_rate_lpm = sensors.flow_rate_fs400a_lpm;
        s_snapshot.total_liters = sensors.total_liters_fs400a;

        s_snapshot.well_pump_on = actuator_hal_get_state(ACTUATOR_WELL_PUMP);
        s_snapshot.dist_pump_on = actuator_hal_get_state(ACTUATOR_DIST_PUMP);
        s_snapshot.raw_submersible_on = actuator_hal_get_state(ACTUATOR_RAW_SUBMERSIBLE);
        s_snapshot.mixing_pump_on = actuator_hal_get_state(ACTUATOR_MIXING_PUMP);
        s_snapshot.dosing_a_on = actuator_hal_get_state(ACTUATOR_DOSING_A);
        s_snapshot.dosing_b_on = actuator_hal_get_state(ACTUATOR_DOSING_B);
        s_snapshot.fan_on = actuator_hal_get_state(ACTUATOR_COOLING_FAN);
        s_snapshot.error_lamp_on = actuator_hal_get_state(ACTUATOR_ERROR_LAMP);

        xSemaphoreGive(s_snap_mutex);

        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

esp_err_t telemetry_mgr_init(void)
{
    if (s_snap_mutex) return ESP_OK;

    s_snap_mutex = xSemaphoreCreateMutex();
    xTaskCreatePinnedToCore(telemetry_sampler_task, "telemetry_task", TASK_TELEMETRY_STACK, NULL, TASK_TELEMETRY_PRIO, NULL, 1);
    ESP_LOGI(TAG, "Telemetry manager initialized.");
    return ESP_OK;
}

esp_err_t telemetry_mgr_get_snapshot(telemetry_snapshot_t *out_snap)
{
    if (!out_snap) return ESP_ERR_INVALID_ARG;
    if (!s_snap_mutex) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_snap_mutex, portMAX_DELAY);
    *out_snap = s_snapshot;
    xSemaphoreGive(s_snap_mutex);

    return ESP_OK;
}

cJSON *telemetry_mgr_to_json(const char *greenhouse_id)
{
    telemetry_snapshot_t snap;
    telemetry_mgr_get_snapshot(&snap);

    const system_storage_state_t *st = storage_mgr_get_state();
    
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "complexId", st->complex_id);
    if (greenhouse_id && strlen(greenhouse_id) > 0) {
        cJSON_AddStringToObject(root, "ghId", greenhouse_id);
    } else {
        cJSON_AddNullToObject(root, "ghId");
    }
    cJSON_AddStringToObject(root, "timestamp", snap.timestamp);
    
    cJSON *samples = cJSON_AddArrayToObject(root, "samples");

    size_t count = hardware_registry_get_count();
    for (size_t i = 0; i < count; i++) {
        hw_component_info_t hw;
        if (hardware_registry_get_by_index(i, &hw) != ESP_OK) continue;

        if (greenhouse_id && strlen(greenhouse_id) > 0) {
            if (strcmp(hw.assignment.gh_id, greenhouse_id) != 0) {
                continue;
            }
        }

        if (hw.lifecycle_state == HW_LIFECYCLE_REGISTERED || 
            hw.lifecycle_state == HW_LIFECYCLE_NOT_COMMISSIONED || 
            hw.lifecycle_state == HW_LIFECYCLE_REMOVED) {
            continue;
        }

        cJSON *sample = cJSON_CreateObject();
        cJSON_AddNumberToObject(sample, "sequence", snap.sequence);
        cJSON_AddStringToObject(sample, "deviceTimestamp", snap.timestamp);
        cJSON_AddStringToObject(sample, "componentId", hw.component_id);

        double val = 0.0;
        const char *unit = "";
        bool valid = false;

        // Map dynamic components to our fixed HAL layer variables
        if (strcmp(hw.role, "dist-pump") == 0) {
            val = snap.dist_pump_on ? 1.0 : 0.0;
            unit = "bool";
            valid = true;
        } else if (strcmp(hw.role, "well-pump") == 0) {
            val = snap.well_pump_on ? 1.0 : 0.0;
            unit = "bool";
            valid = true;
        } else if (strcmp(hw.role, "raw-submersible") == 0) {
            val = snap.raw_submersible_on ? 1.0 : 0.0;
            unit = "bool";
            valid = true;
        } else if (strcmp(hw.role, "mixing-pump") == 0) {
            val = snap.mixing_pump_on ? 1.0 : 0.0;
            unit = "bool";
            valid = true;
        } else if (strcmp(hw.role, "dosing-a") == 0) {
            val = snap.dosing_a_on ? 1.0 : 0.0;
            unit = "bool";
            valid = true;
        } else if (strcmp(hw.role, "dosing-b") == 0) {
            val = snap.dosing_b_on ? 1.0 : 0.0;
            unit = "bool";
            valid = true;
        } else if (strcmp(hw.role, "cooling-fan") == 0) {
            val = snap.fan_on ? 1.0 : 0.0;
            unit = "bool";
            valid = true;
        } else if (strcmp(hw.role, "air-temp") == 0) {
            val = snap.temperature_c;
            unit = "C";
            valid = snap.temp_valid;
        } else if (strcmp(hw.role, "flow-raw") == 0) {
            val = snap.flow_rate_lpm;
            unit = "L/min";
            valid = true;
        } else {
            // Unmapped component, emit zero
            val = 0.0;
            unit = "unknown";
            valid = true;
        }

        cJSON_AddNumberToObject(sample, "value", val);
        cJSON_AddStringToObject(sample, "unit", unit);
        cJSON_AddStringToObject(sample, "quality", valid ? "GOOD" : "BAD");
        cJSON_AddStringToObject(sample, "measurementType", "MEASURED");
        
        cJSON_AddItemToArray(samples, sample);
    }
    
    return root;
}
