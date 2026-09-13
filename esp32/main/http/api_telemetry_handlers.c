#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "hal/sensor_hal.h"
#include "hal/actuator_hal.h"
#include "storage/storage_mgr.h"
#include "cJSON.h"
#include <time.h>
#include <string.h>

esp_err_t handler_get_telemetry(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "complexId", st->complex_id);
    cJSON_AddStringToObject(root, "greenhouseId", "gh-01");

    char time_str[32];
    time_t now = time(NULL);
    strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    cJSON_AddStringToObject(root, "recordedAt", time_str);
    cJSON_AddNumberToObject(root, "staleAfterSeconds", 15);

    /* Values object */
    sensor_readings_t sensors;
    sensor_hal_get_readings(&sensors);

    cJSON *vals = cJSON_AddObjectToObject(root, "values");
    if (sensors.temp_valid) {
        cJSON_AddNumberToObject(vals, "temperatureC", sensors.temperature_c);
    } else {
        cJSON_AddNullToObject(vals, "temperatureC");
    }
    cJSON_AddNumberToObject(vals, "humidityPct", 68.5);
    cJSON_AddNumberToObject(vals, "lightLux", 45000);
    cJSON_AddNumberToObject(vals, "waterLevelPct", sensors.float_lower_ok ? 85.0 : 15.0);
    cJSON_AddNumberToObject(vals, "flowRateLpm", sensors.flow_rate_fs400a_lpm);

    /* Components object */
    cJSON *comps = cJSON_AddObjectToObject(root, "components");
    cJSON *pump = cJSON_AddObjectToObject(comps, "wellPump");
    cJSON_AddBoolToObject(pump, "value", actuator_hal_get_state(ACTUATOR_WELL_PUMP));
    cJSON_AddStringToObject(pump, "state", actuator_hal_get_state(ACTUATOR_WELL_PUMP) ? "RUNNING" : "STOPPED");
    cJSON_AddStringToObject(pump, "recordedAt", time_str);

    return http_send_json_response(req, 200, root);
}

esp_err_t handler_get_events(httpd_req_t *req)
{
    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");

    char time_str[32];
    time_t now = time(NULL);
    strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));

    /* Provide baseline system event */
    cJSON *evt = cJSON_CreateObject();
    cJSON_AddStringToObject(evt, "id", "evt-boot");
    cJSON_AddStringToObject(evt, "at", time_str);
    cJSON_AddStringToObject(evt, "level", "INFO");
    cJSON_AddStringToObject(evt, "code", "SYS_BOOT_SAFE");
    cJSON_AddStringToObject(evt, "message", "System booted into fail-safe state with all outputs OFF");
    cJSON_AddItemToArray(items, evt);

    cJSON_AddNullToObject(root, "nextCursor");

    return http_send_json_response(req, 200, root);
}
