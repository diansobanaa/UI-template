#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "hal/hardware_registry.h"
#include "storage/storage_mgr.h"
#include "config/system_config.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "cJSON.h"
#include <string.h>
#include <time.h>

esp_err_t handler_get_health(httpd_req_t *req)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "status", actuator_hal_is_emergency_stopped() ? "CRITICAL" : "HEALTHY");
    cJSON_AddNumberToObject(root, "uptimeSeconds", (double)(esp_timer_get_time() / 1000000ULL));
    cJSON_AddNumberToObject(root, "freeHeap", (double)esp_get_free_heap_size());
    cJSON_AddNumberToObject(root, "minFreeHeap", (double)esp_get_minimum_free_heap_size());
    cJSON_AddBoolToObject(root, "emergencyStopped", actuator_hal_is_emergency_stopped());

    char time_str[32];
    time_t now = time(NULL);
    strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    cJSON_AddStringToObject(root, "timestamp", time_str);

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_status(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", st->device_id);
    cJSON_AddStringToObject(root, "complexId", st->complex_id);
    cJSON_AddStringToObject(root, "bootId", st->boot_id);
    cJSON_AddNumberToObject(root, "configurationVersion", st->config_version);
    cJSON_AddBoolToObject(root, "emergencyStopped", actuator_hal_is_emergency_stopped());
    cJSON_AddStringToObject(root, "runtimeState", actuator_hal_is_emergency_stopped() ? "EMERGENCY_STOP" : "RUNNING");

    /* Actuators */
    cJSON *actuators = cJSON_AddObjectToObject(root, "actuators");
    cJSON_AddBoolToObject(actuators, "wellPump", actuator_hal_get_state(ACTUATOR_WELL_PUMP));
    cJSON_AddBoolToObject(actuators, "distPump", actuator_hal_get_state(ACTUATOR_DIST_PUMP));
    cJSON_AddBoolToObject(actuators, "rawSubmersible", actuator_hal_get_state(ACTUATOR_RAW_SUBMERSIBLE));
    cJSON_AddBoolToObject(actuators, "dosingA", actuator_hal_get_state(ACTUATOR_DOSING_A));
    cJSON_AddBoolToObject(actuators, "dosingB", actuator_hal_get_state(ACTUATOR_DOSING_B));
    cJSON_AddBoolToObject(actuators, "coolingFan", actuator_hal_get_state(ACTUATOR_COOLING_FAN));
    cJSON_AddBoolToObject(actuators, "errorLamp", actuator_hal_get_state(ACTUATOR_ERROR_LAMP));

    /* Sensors */
    sensor_readings_t sensors;
    sensor_hal_get_readings(&sensors);
    cJSON *s_obj = cJSON_AddObjectToObject(root, "sensors");
    if (sensors.temp_state == SENSOR_STATE_VALID) {
        cJSON_AddNumberToObject(s_obj, "temperatureC", sensors.temperature_c);
    } else {
        cJSON_AddNullToObject(s_obj, "temperatureC");
    }
    cJSON_AddNumberToObject(s_obj, "flowYfb1Lpm", sensors.flow_rate_yfb1_lpm);
    cJSON_AddNumberToObject(s_obj, "totalLitersYfb1", sensors.total_liters_yfb1);
    cJSON_AddNumberToObject(s_obj, "flowFs400aLpm", sensors.flow_rate_fs400a_lpm);
    cJSON_AddNumberToObject(s_obj, "totalLitersFs400a", sensors.total_liters_fs400a);
    cJSON_AddBoolToObject(s_obj, "floatLowerOk", sensors.float_lower_ok);

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_inventory(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", st->device_id);
    cJSON_AddStringToObject(root, "complexId", st->complex_id);
    cJSON_AddStringToObject(root, "firmwareVersion", FIRMWARE_VERSION);
    cJSON_AddStringToObject(root, "hardwareModel", HARDWARE_MODEL);

    cJSON *components = cJSON_AddArrayToObject(root, "components");
    size_t count = hardware_registry_get_count();
    for (size_t i = 0; i < count; i++) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) == ESP_OK) {
            cJSON *item = cJSON_CreateObject();
            cJSON_AddStringToObject(item, "componentId", info.id);
            cJSON_AddStringToObject(item, "name", info.name);
            cJSON_AddStringToObject(item, "type", info.type);
            cJSON_AddStringToObject(item, "role", info.role);
            cJSON_AddNumberToObject(item, "pin", info.pin);
            cJSON_AddStringToObject(item, "safetyClass", info.safety_class);
            cJSON_AddStringToObject(item, "status", info.status);
            cJSON_AddItemToArray(components, item);
        }
    }

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_capabilities(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", st->device_id);
    cJSON_AddStringToObject(root, "model", HARDWARE_MODEL);
    cJSON_AddNumberToObject(root, "maxSchedules", 16);

    cJSON *features = cJSON_AddArrayToObject(root, "features");
    cJSON_AddItemToArray(features, cJSON_CreateString("REST_API_V1"));
    cJSON_AddItemToArray(features, cJSON_CreateString("LOCAL_CORS"));
    cJSON_AddItemToArray(features, cJSON_CreateString("CROP_CYCLE_ENGINE"));
    cJSON_AddItemToArray(features, cJSON_CreateString("STORAGE_NVS_CRC"));
    cJSON_AddItemToArray(features, cJSON_CreateString("SPIFFS_LOGGING"));
    cJSON_AddItemToArray(features, cJSON_CreateString("EMERGENCY_STOP"));

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_context(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", st->device_id);
    cJSON_AddStringToObject(root, "complexId", st->complex_id);

    cJSON *ghs = cJSON_AddArrayToObject(root, "greenhouseIds");
    cJSON_AddItemToArray(ghs, cJSON_CreateString("gh-01"));

    cJSON_AddStringToObject(root, "hostname", "esp32-gh-01.local");
    cJSON_AddStringToObject(root, "ipAddress", "192.168.4.1");

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_clock(httpd_req_t *req)
{
    cJSON *root = cJSON_CreateObject();
    time_t now = time(NULL);
    char time_str[32];
    strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));

    cJSON_AddStringToObject(root, "currentUtc", time_str);
    cJSON_AddStringToObject(root, "currentLocal", time_str);
    cJSON_AddStringToObject(root, "timezone", "Asia/Jakarta");
    cJSON_AddBoolToObject(root, "synced", true);

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_post_clock_sync(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK; // Response already sent
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *ts = cJSON_GetObjectItem(payload, "timestamp");
    if (!ts || !cJSON_IsString(ts)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "timestamp string is required in payload", req_id);
    }

    const char *tz = "Asia/Jakarta";
    cJSON *tz_item = cJSON_GetObjectItem(payload, "timezone");
    if (tz_item && cJSON_IsString(tz_item)) tz = tz_item->valuestring;

    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceTimestamp", ts->valuestring);
    cJSON_AddStringToObject(root, "timezone", tz);
    cJSON_AddNullToObject(root, "synchronizedAt");
    cJSON_AddBoolToObject(root, "rtcAvailable", true);

    cJSON_Delete(body);
    return http_send_enveloped_response(req, 200, req_id, root);
}
