#include "services/safety_monitor.h"
#include "services/command_mgr.h"
#include "services/event_mgr.h"
#include "services/transfer_mgr.h"
#include "services/fertigation_mgr.h"
#include "hal/sensor_hal.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "storage/storage_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "cJSON.h"
#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <stdlib.h>

static const char *TAG = "SAFETY_MONITOR";
#define SAFETY_SENSOR_STALE_MS          3000ULL
#define SAFETY_DEFAULT_FLOW_TIMEOUT_SEC 30U
#define SAFETY_DEFAULT_PUMP_MAX_SEC     900U
#define SAFETY_DEFAULT_FAN_MAX_SEC      1800U
#define SAFETY_DEFAULT_DOSING_MAX_SEC   300U
#define SAFETY_DEFAULT_VALVE_MAX_SEC    300U
#define MAX_FLOW_WATCH 64

typedef struct {
    bool valid;
    char component_id[40];
    int64_t start_us;
    uint32_t baseline_pulses;
    uint32_t last_pulses;
    bool flow_seen;
} flow_watch_t;

static safety_state_t s_state = SAFETY_STATE_NORMAL;
static bool s_fault_latched = false;
static bool s_maintenance_required = false;
static char s_fault_code[48] = {0};
static char s_fault_message[128] = {0};
static SemaphoreHandle_t s_mutex = NULL;
static flow_watch_t s_flow_watch[MAX_FLOW_WATCH];

static void copy_out(char *dst, size_t dst_len, const char *src)
{
    if (!dst || dst_len == 0) return;
    dst[0] = '\0';
    if (!src) return;
    strncpy(dst, src, dst_len - 1);
    dst[dst_len - 1] = '\0';
}

static bool role_has(const hw_component_info_t *component, const char *needle)
{
    if (!component || !needle) return false;
    return strcasecmp(component->role, needle) == 0 ||
           strcasecmp(component->supported_type_id, needle) == 0;
}

static bool is_pump_role(const hw_component_info_t *component)
{
    if (!component) return false;
    const char *r = component->role;
    const char *t = component->supported_type_id;
    return (r && (strcasestr(r, "PUMP") || strcasestr(r, "FERTIGATION"))) ||
           (t && strcasestr(t, "PUMP"));
}

static bool is_fan_role(const hw_component_info_t *component)
{
    if (!component) return false;
    return (component->role[0] && (strcasestr(component->role, "FAN") || strcasestr(component->role, "BLOWER"))) ||
           (component->supported_type_id[0] && (strcasestr(component->supported_type_id, "FAN") || strcasestr(component->supported_type_id, "BLOWER")));
}

static bool is_valve_role(const hw_component_info_t *component)
{
    if (!component) return false;
    return (component->role[0] && strcasestr(component->role, "VALVE")) ||
           (component->supported_type_id[0] && strcasestr(component->supported_type_id, "VALVE"));
}

static bool role_needs_flow(const hw_component_info_t *component)
{
    if (!component) return false;
    return strcasestr(component->role, "WELL_PUMP") ||
           strcasestr(component->role, "RAW_SUBMERSIBLE") ||
           strcasestr(component->role, "DISTRIBUTION_PUMP") ||
           strcasestr(component->role, "DELIVERY_PUMP") ||
           strcasestr(component->role, "FERTIGATION_PUMP") ||
           strcasestr(component->supported_type_id, "WELL_PUMP") ||
           strcasestr(component->supported_type_id, "RAW_SUBMERSIBLE");
}

static uint32_t json_u32(const cJSON *obj, const char *key, uint32_t fallback)
{
    cJSON *item = obj ? cJSON_GetObjectItem(obj, key) : NULL;
    if (!item || !cJSON_IsNumber(item) || item->valuedouble < 0.0 || item->valuedouble > 4294967295.0) return fallback;
    return (uint32_t)item->valuedouble;
}

static bool json_bool(const cJSON *obj, const char *key, bool fallback)
{
    cJSON *item = obj ? cJSON_GetObjectItem(obj, key) : NULL;
    return item ? cJSON_IsTrue(item) : fallback;
}

static void component_safety_policy(const hw_component_info_t *component,
                                    uint32_t *out_max_runtime,
                                    uint32_t *out_flow_timeout,
                                    bool *out_high_level_required,
                                    bool *out_external_high_level_ok)
{
    uint32_t max_runtime = SAFETY_DEFAULT_PUMP_MAX_SEC;
    if (is_fan_role(component)) max_runtime = SAFETY_DEFAULT_FAN_MAX_SEC;
    else if (is_valve_role(component)) max_runtime = SAFETY_DEFAULT_VALVE_MAX_SEC;
    else if (strcasestr(component->role, "DOSING")) max_runtime = SAFETY_DEFAULT_DOSING_MAX_SEC;

    uint32_t flow_timeout = SAFETY_DEFAULT_FLOW_TIMEOUT_SEC;
    bool high_required = false;
    bool external_high_ok = false;

    cJSON *params = cJSON_Parse(component->parameters_json[0] ? component->parameters_json : "{}");
    if (params) {
        cJSON *safety = cJSON_GetObjectItem(params, "safety");
        if (!safety) safety = params; /* backward-compatible parameter placement */
        max_runtime = json_u32(safety, "maxRuntimeSec", max_runtime);
        flow_timeout = json_u32(safety, "flowTimeoutSec", flow_timeout);
        high_required = json_bool(safety, "requireHighLevelProtection", false);
        external_high_ok = json_bool(safety, "externalHighLevelInterlock", false);
        cJSON_Delete(params);
    }

    if (max_runtime == 0) max_runtime = 1;
    if (flow_timeout == 0) flow_timeout = 1;
    if (out_max_runtime) *out_max_runtime = max_runtime;
    if (out_flow_timeout) *out_flow_timeout = flow_timeout;
    if (out_high_level_required) *out_high_level_required = high_required;
    if (out_external_high_level_ok) *out_external_high_level_ok = external_high_ok;
}

static flow_watch_t *flow_watch_find(const char *component_id, bool create)
{
    flow_watch_t *free_slot = NULL;
    for (size_t i = 0; i < MAX_FLOW_WATCH; ++i) {
        if (s_flow_watch[i].valid && strcmp(s_flow_watch[i].component_id, component_id) == 0) return &s_flow_watch[i];
        if (!s_flow_watch[i].valid && !free_slot) free_slot = &s_flow_watch[i];
    }
    if (!create || !free_slot) return NULL;
    memset(free_slot, 0, sizeof(*free_slot));
    free_slot->valid = true;
    strncpy(free_slot->component_id, component_id, sizeof(free_slot->component_id) - 1);
    return free_slot;
}

static void safety_set_fault(const char *code, const char *message, bool global_estop, bool maintenance_required)
{
    bool new_fault = false;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return;
    const char *fault_code = code ? code : "SAFETY_FAULT";
    if (!s_fault_latched || strcmp(s_fault_code, fault_code) != 0) {
        copy_out(s_fault_code, sizeof(s_fault_code), fault_code);
        copy_out(s_fault_message, sizeof(s_fault_message), message ? message : "Safety fault");
        new_fault = true;
    }
    s_fault_latched = true;
    if (maintenance_required) s_maintenance_required = true;
    s_state = global_estop ? SAFETY_STATE_EMERGENCY_STOP : SAFETY_STATE_FAULT;
    xSemaphoreGive(s_mutex);

    if (global_estop) {
        actuator_hal_emergency_stop();
    }
    (void)command_mgr_notify_safety_trip(fault_code, message ? message : "Safety fault");
    if (new_fault) {
        const char *msg = message ? message : "Safety fault";
        (void)event_mgr_log(maintenance_required ? LOG_LEVEL_CRITICAL : LOG_LEVEL_ERROR,
                            "SAFETY", fault_code, msg, NULL);
        if (strstr(fault_code, "SENSOR") || strstr(fault_code, "FLOW_TIMEOUT")) {
            (void)event_mgr_log(LOG_LEVEL_ERROR, "SENSOR", "SENSOR_FAULT", msg, NULL);
        }
    }
}

static bool sensor_snapshot_fresh(const sensor_readings_t *sensors)
{
    if (!sensors) return false;
    const int64_t now_ms = esp_timer_get_time() / 1000LL;
    if (sensors->last_sample_timestamp <= 0) return false;
    return (now_ms - sensors->last_sample_timestamp) <= (int64_t)SAFETY_SENSOR_STALE_MS;
}

static void safety_monitor_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "Safety monitor task running at priority %d", TASK_SAFETY_MONITOR_PRIO);
            while (1) {
                sensor_hal_poll();
                sensor_readings_t sensors;
                if (sensor_hal_get_readings(&sensors) != ESP_OK) {
                    vTaskDelay(pdMS_TO_TICKS(500));
                    continue;
                }

                if (actuator_hal_is_emergency_stopped()) {
                    bool need_sync = false;
                    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
                        need_sync = (s_state != SAFETY_STATE_EMERGENCY_STOP || !s_fault_latched);
                        s_state = SAFETY_STATE_EMERGENCY_STOP;
                        s_fault_latched = true;
                        if (!s_fault_code[0]) copy_out(s_fault_code, sizeof(s_fault_code), "EMERGENCY_STOP_ACTIVE");
                        xSemaphoreGive(s_mutex);
                    }
                    if (need_sync) {
                        (void)command_mgr_notify_safety_trip("EMERGENCY_STOP_ACTIVE", "Physical emergency stop latch is active.");
                    }
                }

                if (!sensors.tamper_loop_ok) {
                    safety_set_fault("TAMPER_LOOP_OPEN", "Tamper loop is open; emergency stop engaged.", true, true);
                }
                if (sensors.temp_state == SENSOR_STATE_VALID && sensors.temperature_c > 45.0f) {
                    safety_set_fault("WATER_TEMP_HIGH", "Water temperature exceeded 45.0 C.", true, false);
                }

                /* Low-level protection is local and targeted: stop all operational
                 * water-moving components when the configured lower-level input says dry. */
                if (!sensors.float_lower_ok) {
                    const size_t count = hardware_registry_get_count();
                    for (size_t i = 0; i < count; ++i) {
                        hw_component_info_t info;
                        if (hardware_registry_get_by_index(i, &info) != ESP_OK || !hardware_registry_is_operational(info.component_id)) continue;
                        if (!role_needs_flow(&info)) continue;
                        bool on = false; actuator_owner_t owner; uint32_t runtime = 0;
                        if (actuator_hal_get_component_status(info.component_id, &on, &owner, &runtime) == ESP_OK && on) {
                            (void)actuator_hal_force_off_component(info.component_id);
                            safety_set_fault("TANK_LOW", "Lower-level protection stopped an active water pump.", false, false);
                            (void)command_mgr_notify_component_safety_fault(info.component_id, "TANK_LOW", "Lower-level protection stopped the component.");
                        }
                    }
                }

                const bool sensors_fresh = sensor_snapshot_fresh(&sensors);
                if (!sensors_fresh) {
                    /* Existing ON commands are failed safe. New commands are rejected by authorization. */
                    const size_t count = hardware_registry_get_count();
                    for (size_t i = 0; i < count; ++i) {
                        hw_component_info_t info;
                        if (hardware_registry_get_by_index(i, &info) != ESP_OK) continue;
                        if (!role_needs_flow(&info)) continue;
                        bool on = false; actuator_owner_t owner; uint32_t runtime = 0;
                        if (actuator_hal_get_component_status(info.component_id, &on, &owner, &runtime) == ESP_OK && on) {
                            (void)actuator_hal_force_off_component(info.component_id);
                            safety_set_fault("SAFETY_SENSOR_STALE", "Safety sensor sample is stale while a protected pump is running.", false, false);
                            (void)command_mgr_notify_component_safety_fault(info.component_id, "SAFETY_SENSOR_STALE", "Safety sensor became stale.");
                        }
                    }
                }

                const size_t count = hardware_registry_get_count();
                for (size_t i = 0; i < count; ++i) {
                    hw_component_info_t info;
                    if (hardware_registry_get_by_index(i, &info) != ESP_OK || !hardware_registry_is_operational(info.component_id)) continue;
                    if (!is_pump_role(&info) && !is_valve_role(&info) && !is_fan_role(&info)) continue;

                    bool on = false; actuator_owner_t owner; uint32_t runtime_sec = 0;
                    if (actuator_hal_get_component_status(info.component_id, &on, &owner, &runtime_sec) != ESP_OK) continue;
                    uint32_t max_runtime = 0, flow_timeout = 0; bool high_required = false, external_high_ok = false;
                    component_safety_policy(&info, &max_runtime, &flow_timeout, &high_required, &external_high_ok);
                    (void)high_required; (void)external_high_ok;

                    if (on && runtime_sec > max_runtime) {
                        (void)actuator_hal_force_off_component(info.component_id);
                        safety_set_fault("ACTUATOR_MAX_RUNTIME", "Configured actuator maximum runtime exceeded; component forced OFF.", false, false);
                        (void)command_mgr_notify_component_safety_fault(info.component_id, "ACTUATOR_MAX_RUNTIME", "Maximum runtime exceeded.");
                        continue;
                    }

                    if (on && role_needs_flow(&info) && sensors_fresh) {
                        flow_watch_t *watch = flow_watch_find(info.component_id, true);
                        if (!watch) continue;
                        uint32_t pulses = 0;
                        if (strcasestr(info.role, "DISTRIBUTION") || strcasestr(info.role, "DELIVERY") || strcasestr(info.role, "FERTIGATION")) {
                            pulses = sensors.total_pulses_fert_fs400a;
                        } else {
                            pulses = sensors.total_pulses_raw_zjb1;
                        }
                        if (watch->start_us == 0) {
                            watch->start_us = esp_timer_get_time();
                            watch->baseline_pulses = pulses;
                            watch->last_pulses = pulses;
                            watch->flow_seen = false;
                        } else if (pulses != watch->last_pulses) {
                            watch->flow_seen = true;
                            watch->last_pulses = pulses;
                        }
                        uint64_t elapsed_sec = (uint64_t)((esp_timer_get_time() - watch->start_us) / 1000000ULL);
                        if (!watch->flow_seen && elapsed_sec >= flow_timeout) {
                            (void)actuator_hal_force_off_component(info.component_id);
                            safety_set_fault("FLOW_TIMEOUT", "Expected flow was not detected before the configured timeout.", false, false);
                            (void)command_mgr_notify_component_safety_fault(info.component_id, "FLOW_TIMEOUT", "No expected flow detected.");
                            watch->start_us = 0;
                        }
                    } else if (!on) {
                        flow_watch_t *watch = flow_watch_find(info.component_id, false);
                        if (watch) memset(watch, 0, sizeof(*watch));
                    }
                }

                vTaskDelay(pdMS_TO_TICKS(500));
            }

}

esp_err_t safety_monitor_init(void)
{
    if (!s_mutex) s_mutex = xSemaphoreCreateMutex();
    if (!s_mutex) return ESP_ERR_NO_MEM;

    memset(s_flow_watch, 0, sizeof(s_flow_watch));
    if (storage_mgr_get_estop()) {
        s_state = SAFETY_STATE_EMERGENCY_STOP;
        s_fault_latched = true;
        copy_out(s_fault_code, sizeof(s_fault_code), "EMERGENCY_STOP_LATCHED");
        copy_out(s_fault_message, sizeof(s_fault_message), "Emergency stop remains latched from previous boot");
    }

    BaseType_t task_result = xTaskCreatePinnedToCore(
        safety_monitor_task,
        "safety_mon", TASK_SAFETY_MONITOR_STACK, NULL, TASK_SAFETY_MONITOR_PRIO, NULL, 1);


    if (task_result != pdPASS) return ESP_ERR_NO_MEM;
    ESP_LOGI(TAG, "Safety monitor task launched.");
    return ESP_OK;
}

bool safety_monitor_has_fault(void)
{
    if (!s_mutex) return s_fault_latched;
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    bool value = s_fault_latched;
    xSemaphoreGive(s_mutex);
    return value;
}

bool safety_monitor_allows_commands(void)
{
    if (!s_mutex) return false;
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    bool allowed = !s_fault_latched && !actuator_hal_is_emergency_stopped() && s_state == SAFETY_STATE_NORMAL;
    xSemaphoreGive(s_mutex);
    return allowed;
}

bool safety_monitor_allows_scheduler(void)
{
    return safety_monitor_allows_commands();
}

safety_state_t safety_monitor_get_state(void)
{
    if (!s_mutex) return SAFETY_STATE_RECOVERY;
    xSemaphoreTake(s_mutex, portMAX_DELAY);
    safety_state_t state = s_state;
    xSemaphoreGive(s_mutex);
    return state;
}

const char *safety_monitor_get_fault_code(void)
{
    return s_fault_code;
}


esp_err_t safety_monitor_trigger_emergency_stop(const char *reason_code, const char *reason)
{
    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    const char *code = reason_code && reason_code[0] ? reason_code : "EMERGENCY_STOP_ACTIVE";
    const char *message = reason && reason[0] ? reason : "Emergency stop activated by operator or safety policy.";

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    s_state = SAFETY_STATE_EMERGENCY_STOP;
    s_fault_latched = true;
    s_maintenance_required = false;
    copy_out(s_fault_code, sizeof(s_fault_code), code);
    copy_out(s_fault_message, sizeof(s_fault_message), message);
    xSemaphoreGive(s_mutex);

    storage_mgr_set_estop(true);
    actuator_hal_emergency_stop();
    (void)command_mgr_notify_safety_trip(code, message);
    (void)event_mgr_log(LOG_LEVEL_CRITICAL, "SAFETY", code, message, NULL);
    return ESP_OK;
}

esp_err_t safety_monitor_authorize_component(
    const char *component_id,
    const char *target_gh_id,
    uint32_t duration_sec,
    safety_command_class_t command_class,
    char *out_reason_code,
    size_t reason_code_len,
    char *out_reason,
    size_t reason_len)
{
    copy_out(out_reason_code, reason_code_len, "");
    copy_out(out_reason, reason_len, "");

    if (!component_id || !component_id[0]) {
        copy_out(out_reason_code, reason_code_len, "TARGET_COMPONENT_REQUIRED");
        copy_out(out_reason, reason_len, "Physical command requires a target component.");
        return ESP_ERR_INVALID_ARG;
    }
    if (!safety_monitor_allows_commands()) {
        copy_out(out_reason_code, reason_code_len, actuator_hal_is_emergency_stopped() ? "EMERGENCY_STOP_ACTIVE" : "SAFETY_FAULT_ACTIVE");
        copy_out(out_reason, reason_len, actuator_hal_is_emergency_stopped() ? "Emergency stop is latched." : "A safety fault is latched.");
        return ESP_ERR_INVALID_STATE;
    }

    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err != ESP_OK) {
        copy_out(out_reason_code, reason_code_len, "UNKNOWN_COMPONENT");
        copy_out(out_reason, reason_len, "Target component is not present in the active registry.");
        return ESP_ERR_NOT_FOUND;
    }
    if (!hardware_registry_is_operational(component_id)) {
        copy_out(out_reason_code, reason_code_len, "COMPONENT_NOT_OPERATIONAL");
        copy_out(out_reason, reason_len, "Target component is not commissioned/enabled.");
        return ESP_ERR_INVALID_STATE;
    }
    if (target_gh_id && target_gh_id[0] && info.assignment.gh_id[0] && strcmp(target_gh_id, info.assignment.gh_id) != 0) {
        copy_out(out_reason_code, reason_code_len, "TARGET_GH_MISMATCH");
        copy_out(out_reason, reason_len, "Target GH does not match the component assignment.");
        return ESP_ERR_INVALID_STATE;
    }

    uint32_t max_runtime = 0, flow_timeout = 0; bool high_required = false, external_high_ok = false;
    component_safety_policy(&info, &max_runtime, &flow_timeout, &high_required, &external_high_ok);
    (void)flow_timeout;

    if (duration_sec == 0 && command_class != SAFETY_COMMAND_NORMAL) {
        copy_out(out_reason_code, reason_code_len, "DURATION_REQUIRED");
        copy_out(out_reason, reason_len, "A physical start command requires a positive duration.");
        return ESP_ERR_INVALID_ARG;
    }
    if (duration_sec > max_runtime) {
        copy_out(out_reason_code, reason_code_len, "MAX_RUNTIME_EXCEEDED");
        snprintf(out_reason, reason_len, "Requested runtime exceeds the component safety limit of %lu seconds.", (unsigned long)max_runtime);
        return ESP_ERR_INVALID_STATE;
    }

    if (role_needs_flow(&info)) {
        sensor_readings_t sensors;
        if (sensor_hal_get_readings(&sensors) != ESP_OK || !sensor_snapshot_fresh(&sensors)) {
            copy_out(out_reason_code, reason_code_len, "SAFETY_SENSOR_STALE");
            copy_out(out_reason, reason_len, "Safety sensor data is stale/unavailable for this protected pump.");
            return ESP_ERR_INVALID_STATE;
        }
        if (!sensors.float_lower_ok) {
            copy_out(out_reason_code, reason_code_len, "TANK_LOW");
            copy_out(out_reason, reason_len, "Lower-level protection is active; water-moving pump is blocked.");
            return ESP_ERR_INVALID_STATE;
        }
    }

    if (high_required && !external_high_ok) {
        const char *msg = "High-level tank-full protection is required but no verified protection path is declared; start blocked.";
        copy_out(out_reason_code, reason_code_len, "HIGH_LEVEL_PROTECTION_UNAVAILABLE");
        copy_out(out_reason, reason_len, msg);
        (void)event_mgr_log_context(LOG_LEVEL_ERROR, "SAFETY", "TANK_FULL_PROTECTION", msg,
                                    info.assignment.complex_id, info.assignment.gh_id[0] ? info.assignment.gh_id : NULL,
                                    component_id, info.resource_id, storage_mgr_get_state() ? storage_mgr_get_state()->config_version : 0);
        return ESP_ERR_INVALID_STATE;
    }

    bool on = false; actuator_owner_t owner = ACTUATOR_OWNER_NONE; uint32_t runtime = 0;
    if (actuator_hal_get_component_status(component_id, &on, &owner, &runtime) == ESP_OK && on) {
        copy_out(out_reason_code, reason_code_len, "RESOURCE_BUSY");
        copy_out(out_reason, reason_len, "Target component is already running.");
        return ESP_ERR_INVALID_STATE;
    }
    if (owner == ACTUATOR_OWNER_SAFETY) {
        copy_out(out_reason_code, reason_code_len, "SAFETY_LOCK_ACTIVE");
        copy_out(out_reason, reason_len, "Target component is safety-locked until explicit recovery.");
        return ESP_ERR_INVALID_STATE;
    }

    return ESP_OK;
}

esp_err_t safety_monitor_request_recovery(char *out_reason_code, size_t reason_code_len,
                                          char *out_reason, size_t reason_len)
{
    copy_out(out_reason_code, reason_code_len, "");
    copy_out(out_reason, reason_len, "");

    sensor_readings_t sensors;
    (void)sensor_hal_poll();
    if (sensor_hal_get_readings(&sensors) != ESP_OK || !sensor_snapshot_fresh(&sensors)) {
        copy_out(out_reason_code, reason_code_len, "SAFETY_SENSOR_STALE");
        copy_out(out_reason, reason_len, "Safety sensors are not fresh enough for recovery.");
        return ESP_ERR_INVALID_STATE;
    }
    if (!sensors.tamper_loop_ok) {
        copy_out(out_reason_code, reason_code_len, "TAMPER_LOOP_OPEN");
        copy_out(out_reason, reason_len, "Tamper loop remains open; maintenance/power-cycle is required.");
        return ESP_ERR_INVALID_STATE;
    }
    if (sensors.temp_state == SENSOR_STATE_VALID && sensors.temperature_c > 45.0f) {
        copy_out(out_reason_code, reason_code_len, "WATER_TEMP_HIGH");
        copy_out(out_reason, reason_len, "Water temperature remains above the safety threshold.");
        return ESP_ERR_INVALID_STATE;
    }
    if (!sensors.float_lower_ok) {
        copy_out(out_reason_code, reason_code_len, "TANK_LOW");
        copy_out(out_reason, reason_len, "Lower-level protection remains active.");
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    if (s_maintenance_required) {
        xSemaphoreGive(s_mutex);
        copy_out(out_reason_code, reason_code_len, "MAINTENANCE_REQUIRED");
        copy_out(out_reason, reason_len, "The safety fault requires maintenance/power-cycle before recovery.");
        return ESP_ERR_INVALID_STATE;
    }
    s_state = SAFETY_STATE_RECOVERY;
    s_fault_latched = false;
    s_fault_code[0] = '\0';
    s_fault_message[0] = '\0';
    s_maintenance_required = false;
    xSemaphoreGive(s_mutex);

    actuator_hal_resume();
    (void)actuator_hal_clear_safety_locks();
    (void)event_mgr_log(LOG_LEVEL_WARNING, "SAFETY", "EMERGENCY_STOP_RELEASED", "Safety latch cleared after validated operator recovery.", NULL);

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        s_state = SAFETY_STATE_NORMAL;
        xSemaphoreGive(s_mutex);
    }
    return ESP_OK;
}
