#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "hal/hardware_registry.h"
#include "services/storage_mgr.h"
#include "services/configuration_mgr.h"
#include "config/system_config.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "cJSON.h"
#include <string.h>
#include <time.h>

esp_err_t handler_get_health(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    
    cJSON_AddStringToObject(root, "apiVersion", "v1");
    cJSON_AddNumberToObject(root, "schemaVersion", 1);
    cJSON_AddStringToObject(root, "deviceId", st->device_id);
    cJSON_AddStringToObject(root, "complexId", st->complex_id);
    cJSON_AddStringToObject(root, "firmwareVersion", FIRMWARE_VERSION);
    cJSON_AddStringToObject(root, "bootId", st->boot_id);
    cJSON_AddNumberToObject(root, "uptimeSec", (double)(esp_timer_get_time() / 1000000ULL));
    
    char time_str[32];
    time_t now = time(NULL);
    strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    cJSON_AddStringToObject(root, "currentTime", time_str);
    cJSON_AddStringToObject(root, "timezone", "UTC");
    
    cJSON_AddNumberToObject(root, "configurationVersion", st->config_version);
    cJSON_AddNumberToObject(root, "inventoryVersion", 1);
    cJSON_AddStringToObject(root, "runtimeState", actuator_hal_is_emergency_stopped() ? "EMERGENCY_STOP" : "RUNNING");
    cJSON_AddStringToObject(root, "health", actuator_hal_is_emergency_stopped() ? "CRITICAL" : "HEALTHY");

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_status(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();

    cJSON *device = cJSON_AddObjectToObject(root, "device");
    cJSON_AddStringToObject(device, "deviceId", st->device_id);
    cJSON_AddStringToObject(device, "complexId", st->complex_id);
    cJSON_AddStringToObject(device, "bootId", st->boot_id);
    cJSON_AddStringToObject(device, "firmwareVersion", FIRMWARE_VERSION);
    cJSON_AddStringToObject(device, "hardwareModel", HARDWARE_MODEL);

    cJSON *network = cJSON_AddObjectToObject(root, "network");
    cJSON_AddStringToObject(network, "ip", "127.0.0.1");
    cJSON_AddStringToObject(network, "mac", "00:00:00:00:00:00");

    cJSON *clock = cJSON_AddObjectToObject(root, "clock");
    char time_str[32];
    time_t now = time(NULL);
    strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    cJSON_AddStringToObject(clock, "currentTime", time_str);
    cJSON_AddStringToObject(clock, "timezone", "UTC");

    cJSON *configuration = cJSON_AddObjectToObject(root, "configuration");
    cJSON_AddNumberToObject(configuration, "version", st->config_version);

    cJSON *inventory = cJSON_AddObjectToObject(root, "inventory");
    cJSON_AddNumberToObject(inventory, "version", 1);

    cJSON *runtime = cJSON_AddObjectToObject(root, "runtime");
    cJSON_AddNumberToObject(runtime, "uptimeSec", (double)(esp_timer_get_time() / 1000000ULL));
    cJSON_AddStringToObject(runtime, "state", actuator_hal_is_emergency_stopped() ? "EMERGENCY_STOP" : "RUNNING");

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
    cJSON_AddNumberToObject(s_obj, "flowRawZjb1Lpm", sensors.flow_rate_raw_zjb1_lpm);
    cJSON_AddNumberToObject(s_obj, "totalLitersRawZjb1", sensors.total_liters_raw_zjb1);
    cJSON_AddNumberToObject(s_obj, "totalPulsesRawZjb1", (double)sensors.total_pulses_raw_zjb1);
    cJSON_AddBoolToObject(s_obj, "rawZjb1Calibrated", sensors.raw_zjb1_calibrated);

    cJSON_AddNumberToObject(s_obj, "flowFertFs400aLpm", sensors.flow_rate_fert_fs400a_lpm);
    cJSON_AddNumberToObject(s_obj, "totalLitersFertFs400a", sensors.total_liters_fert_fs400a);
    cJSON_AddNumberToObject(s_obj, "totalPulsesFertFs400a", (double)sensors.total_pulses_fert_fs400a);

    /* Backward compatibility aliases */
    cJSON_AddNumberToObject(s_obj, "flowYfb1Lpm", sensors.flow_rate_raw_zjb1_lpm);
    cJSON_AddNumberToObject(s_obj, "totalLitersYfb1", sensors.total_liters_raw_zjb1);
    cJSON_AddNumberToObject(s_obj, "flowFs400aLpm", sensors.flow_rate_fert_fs400a_lpm);
    cJSON_AddNumberToObject(s_obj, "totalLitersFs400a", sensors.total_liters_fert_fs400a);
    cJSON_AddBoolToObject(s_obj, "floatLowerOk", sensors.float_lower_ok);

    cJSON *storage = cJSON_AddObjectToObject(root, "storage");
    cJSON_AddNumberToObject(storage, "freeHeap", (double)esp_get_free_heap_size());

    cJSON *safety = cJSON_AddObjectToObject(root, "safety");
    cJSON_AddBoolToObject(safety, "emergencyStopped", actuator_hal_is_emergency_stopped());

    cJSON_AddNullToObject(root, "cropCycle");
    cJSON_AddObjectToObject(root, "queue");
    cJSON_AddObjectToObject(root, "sync");

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_inventory(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "deviceId", st->device_id);
    cJSON_AddStringToObject(root, "complexId", st->complex_id);
    cJSON_AddNumberToObject(root, "inventoryVersion", 1);

    cJSON *components = cJSON_AddArrayToObject(root, "components");
    size_t count = hardware_registry_get_count();
    for (size_t i = 0; i < count; i++) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) == ESP_OK) {
            cJSON *item = cJSON_CreateObject();
            cJSON_AddStringToObject(item, "componentId", info.component_id);
            cJSON_AddStringToObject(item, "supportedTypeId", info.supported_type_id);
            cJSON_AddStringToObject(item, "name", info.name);
            
            const char *life_str = "REGISTERED";
            switch(info.lifecycle_state) {
                case HW_LIFECYCLE_REGISTERED: life_str = "REGISTERED"; break;
                case HW_LIFECYCLE_NOT_COMMISSIONED: life_str = "NOT_COMMISSIONED"; break;
                case HW_LIFECYCLE_COMMISSIONED: life_str = "COMMISSIONED"; break;
                case HW_LIFECYCLE_ENABLED: life_str = "ENABLED"; break;
                case HW_LIFECYCLE_DISABLED: life_str = "DISABLED"; break;
                case HW_LIFECYCLE_FAULTED: life_str = "FAULTED"; break;
                case HW_LIFECYCLE_REMOVED: life_str = "REMOVED"; break;
            }
            cJSON_AddStringToObject(item, "lifecycleState", life_str);
            
            const char *dep_str = "UNKNOWN";
            switch(info.deployment_status) {
                case HW_DEPLOYMENT_PENDING: dep_str = "PENDING"; break;
                case HW_DEPLOYMENT_APPLIED: dep_str = "APPLIED"; break;
                case HW_DEPLOYMENT_FAILED: dep_str = "FAILED"; break;
                case HW_DEPLOYMENT_UNKNOWN: dep_str = "UNKNOWN"; break;
            }
            cJSON_AddStringToObject(item, "deploymentStatus", dep_str);
            
            if (strlen(info.assignment.complex_id) > 0) {
                cJSON *assignment = cJSON_AddObjectToObject(item, "assignment");
                cJSON_AddStringToObject(assignment, "complexId", info.assignment.complex_id);
                if (strlen(info.assignment.gh_id) > 0) {
                    cJSON_AddStringToObject(assignment, "ghId", info.assignment.gh_id);
                } else {
                    cJSON_AddNullToObject(assignment, "ghId");
                }
            } else {
                cJSON_AddNullToObject(item, "assignment");
            }
            
            cJSON *wiring = cJSON_AddObjectToObject(item, "wiring");
            const char *iface_str = "VIRTUAL";
            switch(info.wiring.interface) {
                case HW_INTERFACE_GPIO: iface_str = "GPIO"; break;
                case HW_INTERFACE_I2C: iface_str = "I2C"; break;
                case HW_INTERFACE_UART: iface_str = "UART"; break;
                case HW_INTERFACE_SPI: iface_str = "SPI"; break;
                case HW_INTERFACE_ONE_WIRE: iface_str = "ONE_WIRE"; break;
                case HW_INTERFACE_ANALOG: iface_str = "ANALOG"; break;
                case HW_INTERFACE_VIRTUAL: iface_str = "VIRTUAL"; break;
            }
            cJSON_AddStringToObject(wiring, "interface", iface_str);
            if (info.wiring.gpio >= 0) cJSON_AddNumberToObject(wiring, "gpio", info.wiring.gpio);
            if (info.wiring.channel >= 0) cJSON_AddNumberToObject(wiring, "channel", info.wiring.channel);
            if (strlen(info.wiring.address) > 0) cJSON_AddStringToObject(wiring, "address", info.wiring.address);
            if (strlen(info.wiring.port) > 0) cJSON_AddStringToObject(wiring, "port", info.wiring.port);
            if (strlen(info.wiring.polarity) > 0) cJSON_AddStringToObject(wiring, "polarity", info.wiring.polarity);
            
            cJSON *params = cJSON_Parse(info.parameters_json);
            if (params) {
                cJSON_AddItemToObject(item, "parameters", params);
            } else {
                cJSON_AddObjectToObject(item, "parameters");
            }
            
            if (strlen(info.role) > 0) cJSON_AddStringToObject(item, "role", info.role);
            if (strlen(info.resource_id) > 0) cJSON_AddStringToObject(item, "resourceId", info.resource_id);

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
    cJSON_AddNumberToObject(root, "capabilitiesVersion", 1);

    cJSON *capabilities = cJSON_AddObjectToObject(root, "capabilities");
    cJSON_AddBoolToObject(capabilities, "REST_API_V1", true);
    cJSON_AddBoolToObject(capabilities, "LOCAL_CORS", true);
    cJSON_AddBoolToObject(capabilities, "CROP_CYCLE_ENGINE", true);
    cJSON_AddBoolToObject(capabilities, "STORAGE_NVS_CRC", true);
    cJSON_AddBoolToObject(capabilities, "EVENT_LOGGING", true);
    cJSON_AddBoolToObject(capabilities, "EMERGENCY_STOP", true);

    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_context(httpd_req_t *req)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON *root = cJSON_CreateObject();
    
    cJSON *complex_obj = cJSON_AddObjectToObject(root, "complex");
    cJSON_AddStringToObject(complex_obj, "complexId", st->complex_id);
    cJSON_AddStringToObject(complex_obj, "name", "Default Complex");
    cJSON_AddStringToObject(complex_obj, "location", "System Location");
    cJSON_AddStringToObject(complex_obj, "status", "ACTIVE");
    
    cJSON *ghs = cJSON_AddArrayToObject(root, "greenhouses");
    
    const active_configuration_t *cfg = configuration_mgr_get_active();
    
    if (cfg && cfg->greenhouse_count > 0) {
        for (size_t i = 0; i < cfg->greenhouse_count; i++) {
            cJSON *gh = cJSON_CreateObject();
            cJSON_AddStringToObject(gh, "ghId", cfg->greenhouses[i].gh_id);
            cJSON_AddStringToObject(gh, "complexId", st->complex_id);
            cJSON_AddStringToObject(gh, "name", cfg->greenhouses[i].name);
            cJSON_AddStringToObject(gh, "status", "ACTIVE");
            cJSON_AddItemToArray(ghs, gh);
        }
    } else {
        cJSON *gh01 = cJSON_CreateObject();
        cJSON_AddStringToObject(gh01, "ghId", "gh-01");
        cJSON_AddStringToObject(gh01, "complexId", st->complex_id);
        cJSON_AddStringToObject(gh01, "name", "Greenhouse 01");
        cJSON_AddStringToObject(gh01, "status", "ACTIVE");
        cJSON_AddItemToArray(ghs, gh01);
    }

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
