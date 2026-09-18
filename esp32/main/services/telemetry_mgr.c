#include "services/telemetry_mgr.h"
#include "hal/sensor_hal.h"
#include "hal/actuator_hal.h"
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
        /* No physical humidity or lux sensor in BOM (HARDWARE_INVENTORY.md) -> marked invalid/null */
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
    cJSON_AddStringToObject(root, "greenhouseId", greenhouse_id ? greenhouse_id : "gh-01");
    cJSON_AddNumberToObject(root, "sequence", (double)snap.sequence);
    cJSON_AddStringToObject(root, "recordedAt", snap.timestamp);
    cJSON_AddNumberToObject(root, "staleAfterSeconds", 15);

    /* Values */
    cJSON *vals = cJSON_AddObjectToObject(root, "values");
    if (snap.temp_valid) {
        cJSON_AddNumberToObject(vals, "temperatureC", snap.temperature_c);
    } else {
        cJSON_AddNullToObject(vals, "temperatureC");
    }
    if (snap.humidity_valid) {
        cJSON_AddNumberToObject(vals, "humidityPct", snap.humidity_pct);
    } else {
        cJSON_AddNullToObject(vals, "humidityPct");
    }
    if (snap.light_valid) {
        cJSON_AddNumberToObject(vals, "lightLux", snap.light_lux);
    } else {
        cJSON_AddNullToObject(vals, "lightLux");
    }
    cJSON_AddBoolToObject(vals, "floatLowerOk", snap.float_lower_ok);
    cJSON_AddNumberToObject(vals, "waterLevelPct", snap.water_level_pct);
    cJSON_AddNumberToObject(vals, "flowRateLpm", snap.flow_rate_lpm);
    cJSON_AddNumberToObject(vals, "totalLiters", snap.total_liters);

    /* Components */
    cJSON *comps = cJSON_AddObjectToObject(root, "components");
    cJSON *wp = cJSON_AddObjectToObject(comps, "wellPump");
    cJSON_AddBoolToObject(wp, "value", snap.well_pump_on);
    cJSON_AddStringToObject(wp, "state", snap.well_pump_on ? "RUNNING" : "STOPPED");
    cJSON_AddStringToObject(wp, "recordedAt", snap.timestamp);

    cJSON *dp = cJSON_AddObjectToObject(comps, "distPump");
    cJSON_AddBoolToObject(dp, "value", snap.dist_pump_on);
    cJSON_AddStringToObject(dp, "state", snap.dist_pump_on ? "RUNNING" : "STOPPED");
    cJSON_AddStringToObject(dp, "recordedAt", snap.timestamp);

    cJSON *rs = cJSON_AddObjectToObject(comps, "rawSubmersible");
    cJSON_AddBoolToObject(rs, "value", snap.raw_submersible_on);
    cJSON_AddStringToObject(rs, "state", snap.raw_submersible_on ? "RUNNING" : "STOPPED");
    cJSON_AddStringToObject(rs, "recordedAt", snap.timestamp);

    cJSON *mp = cJSON_AddObjectToObject(comps, "mixingPump");
    cJSON_AddBoolToObject(mp, "value", snap.mixing_pump_on);
    cJSON_AddStringToObject(mp, "state", snap.mixing_pump_on ? "RUNNING" : "STOPPED");
    cJSON_AddStringToObject(mp, "recordedAt", snap.timestamp);

    cJSON *da = cJSON_AddObjectToObject(comps, "dosingA");
    cJSON_AddBoolToObject(da, "value", snap.dosing_a_on);
    cJSON_AddStringToObject(da, "state", snap.dosing_a_on ? "RUNNING" : "STOPPED");
    cJSON_AddStringToObject(da, "recordedAt", snap.timestamp);

    cJSON *db = cJSON_AddObjectToObject(comps, "dosingB");
    cJSON_AddBoolToObject(db, "value", snap.dosing_b_on);
    cJSON_AddStringToObject(db, "state", snap.dosing_b_on ? "RUNNING" : "STOPPED");
    cJSON_AddStringToObject(db, "recordedAt", snap.timestamp);

    cJSON *cf = cJSON_AddObjectToObject(comps, "coolingFan");
    cJSON_AddBoolToObject(cf, "value", snap.fan_on);
    cJSON_AddStringToObject(cf, "state", snap.fan_on ? "RUNNING" : "STOPPED");
    cJSON_AddStringToObject(cf, "recordedAt", snap.timestamp);

    return root;
}
