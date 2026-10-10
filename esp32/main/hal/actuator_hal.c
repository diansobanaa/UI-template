#include "hal/actuator_hal.h"
#include "services/event_mgr.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include "services/alarm_mgr.h"
#include "esp_timer.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "ACTUATOR_HAL";

typedef struct {
    const char *name;
    gpio_num_t gpio;
    bool state;
    actuator_owner_t owner;
    uint8_t active_level;
} actuator_descriptor_t;

/* Default active level referenced from centralized pin_config.h (0 = Active-LOW). */
#define DEFAULT_ACTIVE_LEVEL ACTUATOR_ACTIVE_LEVEL

static actuator_descriptor_t s_actuators[ACTUATOR_MAX_COUNT] = {
    [ACTUATOR_WELL_PUMP]       = { .name = "Well Pump",        .gpio = PIN_OUT_WELL_PUMP,       .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = RELAY_ACTIVE_LEVEL },
    [ACTUATOR_DIST_PUMP]       = { .name = "Dist Pump",        .gpio = PIN_OUT_DIST_PUMP,       .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = RELAY_ACTIVE_LEVEL },
    [ACTUATOR_RAW_SUBMERSIBLE] = { .name = "Raw Submersible",  .gpio = PIN_OUT_RAW_SUBMERSIBLE, .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = RAW_SUBMERSIBLE_ACTIVE_LEVEL },
    [ACTUATOR_DOSING_A]        = { .name = "Dosing Pump A",    .gpio = PIN_OUT_DOSING_A,        .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DOSING_ACTIVE_LEVEL },
    [ACTUATOR_DOSING_B]        = { .name = "Dosing Pump B",    .gpio = PIN_OUT_DOSING_B,        .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DOSING_ACTIVE_LEVEL },
    [ACTUATOR_COOLING_FAN]     = { .name = "Cooling Fan (PSU Direct)", .gpio = -1,                      .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = 0 },
    [ACTUATOR_BLOWER_FAN]      = { .name = "Blower Fan",       .gpio = PIN_OUT_BLOWER_FAN,      .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = BLOWER_ACTIVE_LEVEL },
    [ACTUATOR_MIXING_PUMP]     = { .name = "Mixing Pump",      .gpio = PIN_OUT_MIXING_PUMP,     .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = RELAY_ACTIVE_LEVEL },
    [ACTUATOR_GH_LIGHT]        = { .name = "Greenhouse Lighting", .gpio = PIN_OUT_GH_LIGHT,    .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = LIGHTING_ACTIVE_LEVEL },
    [ACTUATOR_ERROR_LAMP]      = { .name = "Error Lamp",       .gpio = PIN_OUT_ERROR_LAMP,      .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = RELAY_ACTIVE_LEVEL },
    [ACTUATOR_BUZZER]          = { .name = "Alarm Buzzer",     .gpio = PIN_OUT_BUZZER,          .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = BUZZER_ACTIVE_LEVEL },
};

static bool s_emergency_stop_latched = false;
static SemaphoreHandle_t s_lock = NULL;

static const char *source_name(actuator_source_t source)
{
    switch (source) {
        case ACTUATOR_SOURCE_STARTUP: return "STARTUP";
        case ACTUATOR_SOURCE_MANUAL: return "MANUAL";
        case ACTUATOR_SOURCE_SCHEDULER: return "SCHEDULER";
        case ACTUATOR_SOURCE_FERTIGATION: return "FERTIGATION";
        case ACTUATOR_SOURCE_TRANSFER: return "TRANSFER";
        case ACTUATOR_SOURCE_CALIBRATION: return "CALIBRATION";
        case ACTUATOR_SOURCE_SAFETY: return "SAFETY";
        case ACTUATOR_SOURCE_ALARM: return "ALARM";
        default: return "UNKNOWN";
    }
}

static void log_request(const char *component_id, bool requested_on,
                        actuator_source_t source, const char *reason,
                        esp_err_t result)
{
    char message[128];
    const bool success = result == ESP_OK;
    snprintf(message, sizeof(message),
             "requested=%s source=%s reason=%s result=%s err=0x%x",
             requested_on ? "ON" : "OFF", source_name(source),
             reason && reason[0] ? reason : "unspecified",
             success ? "SUCCESS" : "REJECTED", (unsigned)result);
    (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", "ACTUATOR_REQUEST",
                        message, component_id ? component_id : "");
}

#define MAX_DYNAMIC_RUNTIME 64
typedef struct {
    bool valid;
    char component_id[40];
    bool on;
    actuator_owner_t owner;
    int64_t started_at_us;
} component_runtime_state_t;
static component_runtime_state_t s_component_runtime[MAX_DYNAMIC_RUNTIME];

static component_runtime_state_t *runtime_find_locked(const char *component_id, bool create)
{
    component_runtime_state_t *free_slot = NULL;
    for (size_t i = 0; i < MAX_DYNAMIC_RUNTIME; ++i) {
        if (s_component_runtime[i].valid && strcmp(s_component_runtime[i].component_id, component_id) == 0) return &s_component_runtime[i];
        if (!s_component_runtime[i].valid && !free_slot) free_slot = &s_component_runtime[i];
    }
    if (!create || !free_slot) return NULL;
    memset(free_slot, 0, sizeof(*free_slot));
    free_slot->valid = true;
    strncpy(free_slot->component_id, component_id, sizeof(free_slot->component_id) - 1);
    free_slot->component_id[sizeof(free_slot->component_id) - 1] = '\0';
    return free_slot;
}

static void runtime_set_locked(const char *component_id, bool on, actuator_owner_t owner)
{
    component_runtime_state_t *state = runtime_find_locked(component_id, true);
    if (!state) return;
    if (on && !state->on) state->started_at_us = esp_timer_get_time();
    if (!on) state->started_at_us = 0;
    state->on = on;
    state->owner = owner;
}

static uint8_t resolve_active_level(const hw_component_info_t *info, uint8_t fallback);

esp_err_t actuator_hal_bootstrap_safe_off(void)
{
    const struct {
        gpio_num_t pin;
        uint8_t active_level;
    } outputs[] = {
        { PIN_OUT_WELL_PUMP, RELAY_ACTIVE_LEVEL },
        { PIN_OUT_DIST_PUMP, RELAY_ACTIVE_LEVEL },
        { PIN_OUT_RAW_SUBMERSIBLE, RAW_SUBMERSIBLE_ACTIVE_LEVEL },
        { PIN_OUT_DOSING_A, DOSING_ACTIVE_LEVEL },
        { PIN_OUT_DOSING_B, DOSING_ACTIVE_LEVEL },
        { PIN_OUT_COOLING_FAN, COOLING_FAN_ACTIVE_LEVEL },
        { PIN_OUT_BLOWER_FAN, BLOWER_ACTIVE_LEVEL },
        { PIN_OUT_MIXING_PUMP, RELAY_ACTIVE_LEVEL },
        { PIN_OUT_GH_LIGHT, LIGHTING_ACTIVE_LEVEL },
        { PIN_OUT_BUZZER, BUZZER_ACTIVE_LEVEL },
        { PIN_OUT_ERROR_LAMP, RELAY_ACTIVE_LEVEL },
    };
    esp_err_t result = ESP_OK;
    for (size_t i = 0; i < sizeof(outputs) / sizeof(outputs[0]); ++i) {
        if (outputs[i].pin < 0) continue;
        const int off_level = !outputs[i].active_level;
        gpio_config_t config = {
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = off_level ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
            .pull_down_en = off_level ? GPIO_PULLDOWN_DISABLE : GPIO_PULLDOWN_ENABLE,
            .intr_type = GPIO_INTR_DISABLE,
            .pin_bit_mask = 1ULL << outputs[i].pin,
        };
        esp_err_t err = gpio_config(&config);
        if (err != ESP_OK) {
            result = err;
            ESP_LOGE(TAG, "Failed to configure GPIO %d safe OFF (err=0x%x)",
                     (int)outputs[i].pin, (unsigned)err);
            continue;
        }
        gpio_set_level(outputs[i].pin, off_level);
    }
    return result;
}

esp_err_t actuator_hal_init(void)
{
    if (!s_lock) {
        s_lock = xSemaphoreCreateMutex();
    }

    xSemaphoreTake(s_lock, portMAX_DELAY);
    esp_err_t err = ESP_OK;

    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        s_actuators[i].state = false;
        if (s_actuators[i].gpio >= 0) {
            uint8_t off_lvl = !s_actuators[i].active_level;
            gpio_set_level(s_actuators[i].gpio, off_lvl);
            gpio_config_t io_conf = {
                .mode = GPIO_MODE_OUTPUT,
                .pull_up_en = (off_lvl == 1) ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
                .pull_down_en = (off_lvl == 0) ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
                .intr_type = GPIO_INTR_DISABLE,
                .pin_bit_mask = (1ULL << s_actuators[i].gpio)
            };
            esp_err_t cfg_err = gpio_config(&io_conf);
            if (cfg_err != ESP_OK) {
                err = cfg_err;
            }
            gpio_set_level(s_actuators[i].gpio, off_lvl);
        }
    }

    /* Once the active registry exists, explicitly drive every configured GPIO
     * to its inactive state as well. This covers configured safety outputs that
     * are not represented by the legacy compatibility enum. */
    for (size_t i = 0; i < hardware_registry_get_count(); ++i) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) != ESP_OK) continue;
        if (info.wiring.interface == HW_INTERFACE_GPIO && info.wiring.gpio >= 0) {
            const uint8_t active = resolve_active_level(&info, DEFAULT_ACTIVE_LEVEL);
            const uint8_t off_lvl = !active;
            gpio_reset_pin((gpio_num_t)info.wiring.gpio);
            gpio_set_direction((gpio_num_t)info.wiring.gpio, GPIO_MODE_OUTPUT);
            gpio_set_level((gpio_num_t)info.wiring.gpio, off_lvl);
            runtime_set_locked(info.component_id, false, ACTUATOR_OWNER_NONE);
        }
    }
    xSemaphoreGive(s_lock);

    /* Initialize E-Stop state from persistent storage */
    s_emergency_stop_latched = storage_mgr_get_estop();
    if (s_emergency_stop_latched) {
        ESP_LOGE(TAG, "Actuator HAL initialized in latched EMERGENCY STOP state!");
    }

    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Actuator HAL initialized with %d channels in safe OFF state.", ACTUATOR_MAX_COUNT);
    } else {
        ESP_LOGE(TAG, "Actuator HAL initialization failed (0x%x)", err);
    }

    return err;
}

static const char *actuator_role_for_id(actuator_id_t id)
{
    switch (id) {
        case ACTUATOR_WELL_PUMP: return "WELL_PUMP";
        case ACTUATOR_DIST_PUMP: return "DISTRIBUTION_PUMP";
        case ACTUATOR_RAW_SUBMERSIBLE: return "RAW_SUBMERSIBLE";
        case ACTUATOR_DOSING_A: return "DOSING_A";
        case ACTUATOR_DOSING_B: return "DOSING_B";
        case ACTUATOR_COOLING_FAN: return NULL;
        case ACTUATOR_BLOWER_FAN: return "BLOWER_FAN";
        case ACTUATOR_MIXING_PUMP: return "MIXING_PUMP";
        case ACTUATOR_GH_LIGHT: return "GH_LIGHT";
        case ACTUATOR_ERROR_LAMP: return "ERROR_LAMP";
        case ACTUATOR_BUZZER: return "BUZZER";
        default: return NULL;
    }
}

static bool actuator_role_matches(actuator_id_t id, const char *role)
{
    if (!role || !role[0]) return false;
    const char *canonical = actuator_role_for_id(id);
    if (canonical && strcasecmp(role, canonical) == 0) return true;
    if (id == ACTUATOR_RAW_SUBMERSIBLE &&
        (strcasecmp(role, "RAW_SUBMERSIBLE") == 0 ||
         strcasecmp(role, "RAW_SUBMERSIBLE_PUMP_1") == 0 ||
         strcasecmp(role, "RAW_SUBMERSIBLE_PUMP") == 0 ||
         strcasecmp(role, "RAW_WATER") == 0 ||
         strcasecmp(role, "PUMP_SUBMERSIBLE") == 0 ||
         strcasecmp(role, "PUMP_RAW") == 0 ||
         strcasecmp(role, "raw_water_pump") == 0)) return true;
    if (id == ACTUATOR_DOSING_A &&
        (strcasecmp(role, "DOSING_A") == 0 ||
         strcasecmp(role, "pump_dosing_a") == 0 ||
         strcasecmp(role, "dosingA") == 0)) return true;
    if (id == ACTUATOR_DOSING_B &&
        (strcasecmp(role, "DOSING_B") == 0 ||
         strcasecmp(role, "pump_dosing_b") == 0 ||
         strcasecmp(role, "dosingB") == 0)) return true;
    if (id == ACTUATOR_DIST_PUMP && (strcasecmp(role, "DIST_PUMP") == 0 || strcasecmp(role, "DISTRIBUTION_PUMP") == 0)) return true;
    if (id == ACTUATOR_MIXING_PUMP && (strcasecmp(role, "MIX_PUMP") == 0 || strcasecmp(role, "MIXING_PUMP") == 0 || strcasecmp(role, "MIXING_POND_PUMPS") == 0 || strcasecmp(role, "MIXING_POND_PUMP") == 0)) return true;
    if (id == ACTUATOR_GH_LIGHT &&
        (strcasecmp(role, "GH_LIGHT") == 0 ||
         strcasecmp(role, "LIGHTING") == 0 ||
         strcasecmp(role, "gh_lighting") == 0 ||
         strcasecmp(role, "gh_light") == 0 ||
         strcasecmp(role, "light") == 0)) return true;
    if (id == ACTUATOR_ERROR_LAMP && (strcasecmp(role, "ALARM_LAMP") == 0 || strcasecmp(role, "ERROR_BEACON") == 0 || strcasecmp(role, "ERROR_LAMP") == 0)) return true;
    if (id == ACTUATOR_BUZZER && (strcasecmp(role, "ALARM_BUZZER") == 0 || strcasecmp(role, "BUZZER") == 0)) return true;
    if (id == ACTUATOR_BLOWER_FAN &&
        (strcasecmp(role, "BLOWER_FAN") == 0 ||
         strcasecmp(role, "fan_blower") == 0 ||
         strcasecmp(role, "blower_fan") == 0 ||
         strcasecmp(role, "fan-blower") == 0 ||
         strcasecmp(role, "blower") == 0)) return true;
    return false;
}

static esp_err_t resolve_configured_actuator(actuator_id_t id, hw_component_info_t *out)
{
    if (!out) return ESP_ERR_INVALID_ARG;
    const char *role = actuator_role_for_id(id);
    if (!role) return ESP_ERR_INVALID_ARG;

    size_t count = hardware_registry_get_count();
    bool found = false;
    for (size_t i = 0; i < count; ++i) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) != ESP_OK) continue;
        if (!actuator_role_matches(id, info.role)) continue;
        if (found) {
            ESP_LOGE(TAG, "Multiple active components resolve to actuator role '%s'", role);
            return ESP_ERR_INVALID_STATE;
        }
        *out = info;
        found = true;
    }
    return found ? ESP_OK : ESP_ERR_NOT_FOUND;
}

static uint8_t resolve_active_level(const hw_component_info_t *info, uint8_t fallback)
{
    if (info) {
        /* Physical hardware authority: Native MOSFET channels (GPIO 4, 5, 6, 7, 18) are
         * physically N-channel MOSFET gate drivers and MUST operate Active-HIGH (1=ON, 0=OFF).
         * Even if legacy SPIFFS JSON or old config has ACTIVE_LOW, override to ACTIVE_HIGH
         * to prevent dangerous physical pump / fan / buzzer activation at boot. */
        if (strcmp(info->role, "GH_LIGHT") == 0 || strcmp(info->role, "LIGHTING") == 0 ||
            info->wiring.gpio == PIN_OUT_GH_LIGHT) {
            return RELAY_ACTIVE_LEVEL; /* 0 = Active-LOW */
        }
        if (strcmp(info->role, "BLOWER_FAN") == 0 || info->wiring.gpio == PIN_OUT_BLOWER_FAN) {
            return BLOWER_ACTIVE_LEVEL; /* 1 = Active-HIGH */
        }
        if (strcmp(info->role, "RAW_SUBMERSIBLE") == 0 || strcmp(info->role, "RAW_SUBMERSIBLE_PUMP_1") == 0 ||
            strcmp(info->role, "DOSING_A") == 0 || strcmp(info->role, "DOSING_B") == 0 ||
            strcmp(info->role, "COOLING_FAN") == 0 || strcmp(info->role, "BUZZER") == 0 ||
            strcmp(info->role, "ALARM_BUZZER") == 0 ||
            info->wiring.gpio == PIN_OUT_RAW_SUBMERSIBLE ||
            info->wiring.gpio == PIN_OUT_DOSING_A || info->wiring.gpio == PIN_OUT_DOSING_B ||
            info->wiring.gpio == PIN_OUT_COOLING_FAN || info->wiring.gpio == PIN_OUT_BUZZER) {
            return MOSFET_ACTIVE_LEVEL; /* 1 = Active-HIGH */
        }
        if (info->wiring.polarity[0] != '\0') {
            if (strcmp(info->wiring.polarity, "ACTIVE_HIGH") == 0) return 1;
            if (strcmp(info->wiring.polarity, "ACTIVE_LOW") == 0) return 0;
        }
    }
    return fallback;
}

esp_err_t actuator_hal_set(actuator_id_t id, bool on)
{
    if (id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    if (id == ACTUATOR_BUZZER) {
        ESP_LOGW(TAG, "Direct actuator_hal_set for buzzer blocked: alarm_mgr is authoritative owner.");
        return ESP_ERR_NOT_SUPPORTED;
    }

    if (!s_lock) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_lock, portMAX_DELAY);

    if (on && s_emergency_stop_latched) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked %s ON: System in EMERGENCY STOP.", s_actuators[id].name);
        return ESP_ERR_INVALID_STATE;
    }

    if (on && (id == ACTUATOR_DIST_PUMP)) {
        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) {
            xSemaphoreGive(s_lock);
            ESP_LOGW(TAG, "Blocked %s ON: lower-float dry-run interlock active.", s_actuators[id].name);
            return ESP_ERR_INVALID_STATE;
        }
    }

    hw_component_info_t comp_info;
    esp_err_t resolve_err = resolve_configured_actuator(id, &comp_info);
    if (resolve_err != ESP_OK) {
        if (s_actuators[id].gpio >= 0) {
            bool was_on = s_actuators[id].state;
            s_actuators[id].state = on;
            gpio_set_level(s_actuators[id].gpio, on ? s_actuators[id].active_level : !s_actuators[id].active_level);
            ESP_LOGI(TAG, "Static actuator '%s' -> %s (GPIO %d)",
                     s_actuators[id].name, on ? "ON" : "OFF", (int)s_actuators[id].gpio);
            xSemaphoreGive(s_lock);
            if (was_on != on) {
                if (id == ACTUATOR_BUZZER) {
                    (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM", on ? "ALARM_BUZZER_ON" : "ALARM_BUZZER_OFF",
                                        on ? "Alarm buzzer activated." : "Alarm buzzer deactivated.", "buzzer");
                } else if (id == ACTUATOR_GH_LIGHT) {
                    (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", on ? "LIGHTING_ON" : "LIGHTING_OFF",
                                        on ? "Greenhouse lighting switched ON." : "Greenhouse lighting switched OFF.", "gh_lighting");
                }
            }
            return ESP_OK;
        }
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked %s: no unique active configured component for role '%s'",
                 s_actuators[id].name, actuator_role_for_id(id) ? actuator_role_for_id(id) : "?");
        return resolve_err;
    }

    if (on && comp_info.lifecycle_state != HW_LIFECYCLE_COMMISSIONED &&
        comp_info.lifecycle_state != HW_LIFECYCLE_ENABLED) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked %s ON: component '%s' is not operational (lifecycle: %d)",
                 s_actuators[id].name, comp_info.component_id, (int)comp_info.lifecycle_state);
        return ESP_ERR_INVALID_STATE;
    }

    if (comp_info.wiring.interface != HW_INTERFACE_GPIO || comp_info.wiring.gpio < 0) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked %s: component '%s' has no configured GPIO binding (interface=%d)",
                 s_actuators[id].name, comp_info.component_id, (int)comp_info.wiring.interface);
        // Legacy enum path supports GPIO only; I2C components must be driven
        // via actuator_hal_set_by_component_id() which has the PCA9685 hook.
        return ESP_ERR_NOT_SUPPORTED;
    }

    gpio_num_t new_gpio = (gpio_num_t)comp_info.wiring.gpio;
    if (new_gpio != s_actuators[id].gpio) {
        gpio_reset_pin(new_gpio);
        gpio_set_direction(new_gpio, GPIO_MODE_OUTPUT);
        s_actuators[id].gpio = new_gpio;
    }
    s_actuators[id].active_level = resolve_active_level(&comp_info, s_actuators[id].active_level);
    bool was_on = s_actuators[id].state;
    s_actuators[id].state = on;
    gpio_set_level(s_actuators[id].gpio, on ? s_actuators[id].active_level : !s_actuators[id].active_level);
    runtime_set_locked(comp_info.component_id, on, s_actuators[id].owner);

    ESP_LOGI(TAG, "Configured component '%s' (%s) -> %s (GPIO %d)",
             comp_info.component_id, comp_info.role, on ? "ON" : "OFF", s_actuators[id].gpio);

    xSemaphoreGive(s_lock);
    if (was_on != on) {
        if (id == ACTUATOR_BUZZER) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM", on ? "ALARM_BUZZER_ON" : "ALARM_BUZZER_OFF",
                                on ? "Alarm buzzer activated." : "Alarm buzzer deactivated.", comp_info.component_id);
        } else if (id == ACTUATOR_COOLING_FAN || id == ACTUATOR_BLOWER_FAN) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", on ? "FAN_STARTED" : "FAN_STOPPED",
                                on ? "Fan switched ON." : "Fan switched OFF.", comp_info.component_id);
        } else if (id == ACTUATOR_GH_LIGHT) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", on ? "LIGHTING_ON" : "LIGHTING_OFF",
                                on ? "Greenhouse lighting switched ON." : "Greenhouse lighting switched OFF.", comp_info.component_id);
        }
    }
    return ESP_OK;
}

esp_err_t actuator_hal_request(actuator_id_t id, bool on,
                               actuator_source_t source, const char *reason)
{
    if (id == ACTUATOR_GH_LIGHT && on && source != ACTUATOR_SOURCE_MANUAL) {
        ESP_LOGW(TAG, "Blocked lighting ON: only manual ON is permitted (source=%d, reason=%s)",
                 (int)source, reason ? reason : "unknown");
        log_request("gh_lighting", on, source, reason, ESP_ERR_INVALID_STATE);
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = actuator_hal_set(id, on);
    const char *component_id = (id < ACTUATOR_MAX_COUNT) ? s_actuators[id].name : "invalid";
    log_request(component_id, on, source, reason, err);
    return err;
}

esp_err_t actuator_hal_set_by_component_id(const char *component_id, bool on)
{
    if (!component_id || component_id[0] == '\0') return ESP_ERR_INVALID_ARG;
    if (!s_lock) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_lock, portMAX_DELAY);

    hw_component_info_t info;
    bool has_info = (hardware_registry_find_by_id(component_id, &info) == ESP_OK);
    actuator_id_t fallback_act_id = ACTUATOR_MAX_COUNT;
    if (!has_info) {
        if (actuator_hal_find_id_by_component_id(component_id, &fallback_act_id) != ESP_OK) {
            xSemaphoreGive(s_lock);
            return ESP_ERR_NOT_FOUND;
        }

    }

    if (on && s_emergency_stop_latched) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked component '%s' ON: System in EMERGENCY STOP.", component_id);
        return ESP_ERR_INVALID_STATE;
    }

    if (on && ((has_info && strcmp(info.role, "DISTRIBUTION_PUMP") == 0) || fallback_act_id == ACTUATOR_DIST_PUMP)) {
        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) {
            xSemaphoreGive(s_lock);
            ESP_LOGW(TAG, "Blocked component '%s' ON: lower-float dry-run interlock active.", component_id);
            return ESP_ERR_INVALID_STATE;
        }
    }

    if (has_info && on && info.lifecycle_state != HW_LIFECYCLE_COMMISSIONED &&
        info.lifecycle_state != HW_LIFECYCLE_ENABLED) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked component '%s' ON: lifecycle state %d is not operational.", component_id, (int)info.lifecycle_state);
        return ESP_ERR_INVALID_STATE;
    }

    if (has_info && info.wiring.interface != HW_INTERFACE_GPIO && info.wiring.interface != HW_INTERFACE_I2C) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Component '%s' has unsupported interface %d.", component_id, (int)info.wiring.interface);
        return ESP_ERR_NOT_SUPPORTED;
    }

    uint8_t active_level = has_info ? resolve_active_level(&info, DEFAULT_ACTIVE_LEVEL) :
                           (fallback_act_id < ACTUATOR_MAX_COUNT ? s_actuators[fallback_act_id].active_level : DEFAULT_ACTIVE_LEVEL);
    component_runtime_state_t *runtime = runtime_find_locked(component_id, true);
    actuator_owner_t owner = runtime ? runtime->owner : ACTUATOR_OWNER_NONE;
    if (fallback_act_id < ACTUATOR_MAX_COUNT && owner == ACTUATOR_OWNER_NONE) {
        owner = s_actuators[fallback_act_id].owner;
    }
    bool was_on = runtime ? runtime->on : false;
    if (on && owner == ACTUATOR_OWNER_SAFETY) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked component '%s' ON: safety lock is active.", component_id);
        return ESP_ERR_INVALID_STATE;
    }

    if (has_info && info.wiring.interface == HW_INTERFACE_I2C) {
        // Pathway B: PCA9685 expansion
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Component '%s' (role=%s) uses I2C channel %d @ addr '%s' — driver pending.",
                 component_id, info.role, info.wiring.channel, info.wiring.address);
        return ESP_ERR_NOT_SUPPORTED;
    }

    gpio_num_t gpio = GPIO_NUM_NC;
    if (has_info && info.wiring.gpio >= 0) {
        gpio = (gpio_num_t)info.wiring.gpio;
    } else if (fallback_act_id < ACTUATOR_MAX_COUNT) {
        gpio = s_actuators[fallback_act_id].gpio;
    }
    if (gpio < 0) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Component '%s' has invalid GPIO %d.", component_id, (int)gpio);
        return ESP_ERR_NOT_SUPPORTED;
    }

    if (gpio == PIN_OUT_BUZZER || fallback_act_id == ACTUATOR_BUZZER ||
        (has_info && (strcasecmp(info.role, "ALARM_BUZZER") == 0 || strcasecmp(info.role, "BUZZER") == 0))) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Direct buzzer control blocked for '%s': alarm_mgr is authoritative owner.", component_id);
        return ESP_ERR_NOT_SUPPORTED;
    }

    // Direct GPIO drive - NO gpio_reset_pin to prevent optocoupler/relay glitching!
    gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
    gpio_set_level(gpio, on ? active_level : !active_level);
    runtime_set_locked(component_id, on, owner);

    for (size_t i = 0; i < ACTUATOR_MAX_COUNT; i++) {
        if (s_actuators[i].gpio == gpio) {
            s_actuators[i].state = on;
            s_actuators[i].owner = owner;
            break;
        }
    }

    xSemaphoreGive(s_lock);
    ESP_LOGI(TAG, "Actuator component '%s' -> %s (GPIO %d, active_level=%d)",
             component_id, on ? "ON" : "OFF", (int)gpio, (int)active_level);
    if (was_on != on) {
        const char *role = has_info ? info.role : (fallback_act_id < ACTUATOR_MAX_COUNT ? s_actuators[fallback_act_id].name : "");
        if (strcasestr(role, "PUMP") || (has_info && strcasestr(info.supported_type_id, "PUMP"))) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", on ? "PUMP_STARTED" : "PUMP_STOPPED",
                                on ? "Configured pump switched ON." : "Configured pump switched OFF.", component_id);
        } else if (strcasestr(role, "BUZZER")) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM", on ? "ALARM_BUZZER_ON" : "ALARM_BUZZER_OFF",
                                on ? "Alarm buzzer activated." : "Alarm buzzer deactivated.", component_id);
        } else if (strcasestr(role, "FAN") || strcasestr(role, "BLOWER")) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", on ? "FAN_STARTED" : "FAN_STOPPED",
                                on ? "Configured fan switched ON." : "Configured fan switched OFF.", component_id);
        } else if (strcasestr(role, "LIGHT") || strcasestr(component_id, "light")) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", on ? "LIGHTING_ON" : "LIGHTING_OFF",
                                on ? "Greenhouse lighting switched ON." : "Greenhouse lighting switched OFF.", component_id);
        }
        extern void telemetry_mgr_trigger_transition(const char *reason);
        telemetry_mgr_trigger_transition("ACTUATOR_STATE_CHANGE");
    }
    return ESP_OK;
}

esp_err_t actuator_hal_request_component(const char *component_id, bool on,
                                         actuator_source_t source, const char *reason)
{
    actuator_id_t act_id = ACTUATOR_MAX_COUNT;
    bool is_lighting = false;
    if (component_id) {
        if (actuator_hal_find_id_by_component_id(component_id, &act_id) == ESP_OK && act_id == ACTUATOR_GH_LIGHT) {
            is_lighting = true;
        } else if (strcasestr(component_id, "light") != NULL) {
            is_lighting = true;
        }
    }
    if (is_lighting && on && source != ACTUATOR_SOURCE_MANUAL) {
        ESP_LOGW(TAG, "Blocked component '%s' lighting ON: only manual ON is permitted (source=%d, reason=%s)",
                 component_id ? component_id : "?", (int)source, reason ? reason : "unknown");
        log_request(component_id ? component_id : "gh_lighting", on, source, reason, ESP_ERR_INVALID_STATE);
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t err = actuator_hal_set_by_component_id(component_id, on);
    log_request(component_id, on, source, reason, err);
    return err;
}

esp_err_t actuator_hal_acquire(actuator_id_t id, actuator_owner_t owner)
{
    if (id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    if (!s_lock) return ESP_ERR_INVALID_STATE;

    esp_err_t err = ESP_OK;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_actuators[id].owner != ACTUATOR_OWNER_NONE && s_actuators[id].owner != owner) {
        ESP_LOGW(TAG, "Failed to acquire %s. Already owned by %d", s_actuators[id].name, s_actuators[id].owner);
        err = ESP_ERR_INVALID_STATE;
    } else {
        s_actuators[id].owner = owner;
        hw_component_info_t info;
        if (resolve_configured_actuator(id, &info) == ESP_OK) {
            component_runtime_state_t *state = runtime_find_locked(info.component_id, true);
            if (state) {
                state->owner = owner;
            }
        }
    }
    xSemaphoreGive(s_lock);
    return err;
}

esp_err_t actuator_hal_release(actuator_id_t id, actuator_owner_t owner)
{
    if (id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    if (!s_lock) return ESP_ERR_INVALID_STATE;

    esp_err_t err = ESP_OK;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_actuators[id].owner == owner || owner == ACTUATOR_OWNER_SAFETY) {
        s_actuators[id].owner = ACTUATOR_OWNER_NONE;
        hw_component_info_t info;
        if (resolve_configured_actuator(id, &info) == ESP_OK) {
            component_runtime_state_t *state = runtime_find_locked(info.component_id, false);
            if (state && state->owner == owner) state->owner = ACTUATOR_OWNER_NONE;
        }
    } else {
        ESP_LOGW(TAG, "Failed to release %s. Owned by %d, requested by %d", s_actuators[id].name, s_actuators[id].owner, owner);
        err = ESP_ERR_INVALID_STATE;
    }
    xSemaphoreGive(s_lock);
    return err;
}

bool actuator_hal_get_state(actuator_id_t id)
{
    if (id >= ACTUATOR_MAX_COUNT) return false;
    return s_actuators[id].state;
}

esp_err_t actuator_hal_get_status(actuator_id_t id, actuator_status_t *out_status)
{
    if (id >= ACTUATOR_MAX_COUNT || !out_status) return ESP_ERR_INVALID_ARG;

    out_status->id = id;
    out_status->name = s_actuators[id].name;
    out_status->gpio_num = s_actuators[id].gpio;
    out_status->is_on = s_actuators[id].state;
    out_status->is_interlocked = s_emergency_stop_latched || 
                                 (id == ACTUATOR_DIST_PUMP && gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY);
    out_status->owner = s_actuators[id].owner;
    uint32_t runtime_seconds = 0;
    hw_component_info_t mapped;
    if (resolve_configured_actuator(id, &mapped) == ESP_OK) {
        bool on = false;
        actuator_owner_t owner = s_actuators[id].owner;
        uint32_t seconds = 0;
        if (actuator_hal_get_component_status(mapped.component_id, &on, &owner, &seconds) == ESP_OK) {
            runtime_seconds = seconds;
        }
    }
    out_status->run_time_seconds = runtime_seconds;
    out_status->active_level = s_actuators[id].active_level;

    return ESP_OK;
}

esp_err_t actuator_hal_find_id_by_component_id(const char *component_id, actuator_id_t *out_id)
{
    if (!component_id || !out_id) return ESP_ERR_INVALID_ARG;
    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err == ESP_OK) {
        for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
            if (actuator_role_matches((actuator_id_t)i, info.role)) {
                *out_id = (actuator_id_t)i;
                return ESP_OK;
            }
        }
    }
    // Direct match against known canonical component IDs
    if (strcasecmp(component_id, "pump_submersible") == 0 ||
        strcasecmp(component_id, "RAW_SUBMERSIBLE") == 0 ||
        strcasecmp(component_id, "pump_raw") == 0 ||
        strcasecmp(component_id, "raw_water_pump") == 0) {
        *out_id = ACTUATOR_RAW_SUBMERSIBLE;
        return ESP_OK;
    }
    if (strcasecmp(component_id, "pump_well") == 0 || strcasecmp(component_id, "WELL_PUMP") == 0) {
        *out_id = ACTUATOR_WELL_PUMP;
        return ESP_OK;
    }
    if (strcasecmp(component_id, "pump_dosing_a") == 0 || strcasecmp(component_id, "dosingA") == 0 || strcasecmp(component_id, "DOSING_A") == 0) {
        *out_id = ACTUATOR_DOSING_A;
        return ESP_OK;
    }
    if (strcasecmp(component_id, "pump_dosing_b") == 0 || strcasecmp(component_id, "dosingB") == 0 || strcasecmp(component_id, "DOSING_B") == 0) {
        *out_id = ACTUATOR_DOSING_B;
        return ESP_OK;
    }

    if (strcasecmp(component_id, "blower_fan") == 0 || strcasecmp(component_id, "BLOWER_FAN") == 0 ||
        strcasecmp(component_id, "fan_blower") == 0 || strcasecmp(component_id, "fan-blower") == 0 ||
        strcasecmp(component_id, "blower") == 0) {
        *out_id = ACTUATOR_BLOWER_FAN;
        return ESP_OK;
    }
    if (strcasecmp(component_id, "mixing_pump") == 0 || strcasecmp(component_id, "MIXING_PUMP") == 0) {
        *out_id = ACTUATOR_MIXING_PUMP;
        return ESP_OK;
    }
    if (strcasecmp(component_id, "gh_lighting") == 0 || strcasecmp(component_id, "lighting") == 0 ||
        strcasecmp(component_id, "GH_LIGHT") == 0 || strcasecmp(component_id, "gh_light") == 0 ||
        strcasecmp(component_id, "light") == 0) {
        *out_id = ACTUATOR_GH_LIGHT;
        return ESP_OK;
    }
    if (strcasecmp(component_id, "buzzer") == 0 || strcasecmp(component_id, "BUZZER") == 0 || strcasecmp(component_id, "ALARM_BUZZER") == 0) {
        *out_id = ACTUATOR_BUZZER;
        return ESP_OK;
    }
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t actuator_hal_get_component_status(const char *component_id, bool *out_on, actuator_owner_t *out_owner, uint32_t *out_runtime_seconds)
{
    if (!component_id || !out_on || !out_owner || !out_runtime_seconds || !s_lock) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    component_runtime_state_t *state = runtime_find_locked(component_id, false);
    actuator_id_t act_id = ACTUATOR_MAX_COUNT;
    bool has_static = (actuator_hal_find_id_by_component_id(component_id, &act_id) == ESP_OK);
    if (!state && !has_static) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_NOT_FOUND;
    }
    *out_on = state ? state->on : (has_static ? s_actuators[act_id].state : false);
    *out_owner = state ? state->owner : (has_static ? s_actuators[act_id].owner : ACTUATOR_OWNER_NONE);
    *out_runtime_seconds = (state && state->on && state->started_at_us > 0) ? (uint32_t)((esp_timer_get_time() - state->started_at_us) / 1000000LL) : 0U;
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t actuator_hal_acquire_component(const char *component_id, actuator_owner_t owner)
{
    if (!component_id || !component_id[0] || !s_lock || owner == ACTUATOR_OWNER_NONE) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err != ESP_OK) {
        actuator_id_t act_id;
        if (actuator_hal_find_id_by_component_id(component_id, &act_id) == ESP_OK) {
            if (s_actuators[act_id].owner != ACTUATOR_OWNER_NONE && s_actuators[act_id].owner != owner) {
                xSemaphoreGive(s_lock);
                return ESP_ERR_INVALID_STATE;
            }
            s_actuators[act_id].owner = owner;
            component_runtime_state_t *state = runtime_find_locked(component_id, true);
            if (state) state->owner = owner;
            xSemaphoreGive(s_lock);
            return ESP_OK;
        }
        xSemaphoreGive(s_lock);
        return err;
    }
    if (info.lifecycle_state != HW_LIFECYCLE_COMMISSIONED && info.lifecycle_state != HW_LIFECYCLE_ENABLED) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_INVALID_STATE;
    }
    component_runtime_state_t *state = runtime_find_locked(component_id, true);
    if (!state) { xSemaphoreGive(s_lock); return ESP_ERR_NO_MEM; }
    if (state->owner != ACTUATOR_OWNER_NONE && state->owner != owner) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_INVALID_STATE;
    }
    if (state->owner == ACTUATOR_OWNER_SAFETY && owner != ACTUATOR_OWNER_SAFETY) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_INVALID_STATE;
    }
    state->owner = owner;
    actuator_id_t act_id;
    if (actuator_hal_find_id_by_component_id(component_id, &act_id) == ESP_OK) {
        s_actuators[act_id].owner = owner;
    }
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t actuator_hal_release_component(const char *component_id, actuator_owner_t owner)
{
    if (!component_id || !component_id[0] || !s_lock) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    component_runtime_state_t *state = runtime_find_locked(component_id, false);
    if (state && (state->owner == owner || owner == ACTUATOR_OWNER_SAFETY)) {
        state->owner = ACTUATOR_OWNER_NONE;
    }
    actuator_id_t act_id;
    if (actuator_hal_find_id_by_component_id(component_id, &act_id) == ESP_OK) {
        if (s_actuators[act_id].owner == owner || owner == ACTUATOR_OWNER_SAFETY) {
            s_actuators[act_id].owner = ACTUATOR_OWNER_NONE;
        }
    }
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t actuator_hal_stop_component(const char *component_id, actuator_owner_t owner)
{
    if (!component_id || !component_id[0] || !s_lock) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err != ESP_OK) { xSemaphoreGive(s_lock); return err; }
    component_runtime_state_t *state = runtime_find_locked(component_id, false);
    bool is_light = (strcasestr(info.role, "LIGHT") != NULL || strcasestr(component_id, "light") != NULL);
    if (state && state->owner != ACTUATOR_OWNER_NONE && state->owner != owner && owner != ACTUATOR_OWNER_SAFETY &&
        !(owner == ACTUATOR_OWNER_SCHEDULER && is_light)) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_INVALID_STATE;
    }
    bool was_on = state ? state->on : false;
    if (info.wiring.interface == HW_INTERFACE_GPIO && info.wiring.gpio >= 0) {
        if (info.wiring.gpio != PIN_OUT_BUZZER) {
            const uint8_t active = resolve_active_level(&info, DEFAULT_ACTIVE_LEVEL);
            gpio_set_level((gpio_num_t)info.wiring.gpio, !active);
        }
    }
    runtime_set_locked(component_id, false, ACTUATOR_OWNER_NONE);
    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        hw_component_info_t mapped;
        if (resolve_configured_actuator((actuator_id_t)i, &mapped) == ESP_OK && strcmp(mapped.component_id, component_id) == 0) {
            s_actuators[i].state = false;
            if (s_actuators[i].owner == owner || owner == ACTUATOR_OWNER_SAFETY || is_light) s_actuators[i].owner = ACTUATOR_OWNER_NONE;
        }
    }
    xSemaphoreGive(s_lock);
    if (was_on && (strcasestr(info.role, "PUMP") || strcasestr(info.supported_type_id, "PUMP"))) {
        (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", "PUMP_STOPPED",
                            "Configured pump stopped.", info.component_id);
    } else if (was_on && (strcasestr(info.role, "FAN") || strcasestr(info.role, "BLOWER") ||
                          strcasestr(info.supported_type_id, "FAN") || strcasestr(info.supported_type_id, "BLOWER"))) {
        (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", "FAN_STOPPED",
                            "Configured fan stopped.", info.component_id);
    } else if (was_on && (strcasestr(info.role, "LIGHT") || strcasestr(info.component_id, "light"))) {
        (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", "LIGHTING_OFF",
                            "Greenhouse lighting stopped.", info.component_id);
    }
    return ESP_OK;
}

esp_err_t actuator_hal_force_off_component(const char *component_id)
{
    if (!component_id || !s_lock) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err != ESP_OK) { xSemaphoreGive(s_lock); return err; }
    if (info.wiring.interface == HW_INTERFACE_I2C) {
        // PCA9685 I2C force-off: driver pending. Safety path must still
        // mark runtime state so the component is treated as OFF.
        runtime_set_locked(component_id, false, ACTUATOR_OWNER_SAFETY);
        for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
            hw_component_info_t mapped;
            if (resolve_configured_actuator((actuator_id_t)i, &mapped) == ESP_OK && strcmp(mapped.component_id, component_id) == 0) {
                s_actuators[i].state = false;
                s_actuators[i].owner = ACTUATOR_OWNER_SAFETY;
            }
        }
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Component '%s' (I2C) force-off: PCA9685 driver pending; runtime state marked OFF.", component_id);
        return ESP_OK;
    }
    if (info.wiring.interface != HW_INTERFACE_GPIO || info.wiring.gpio < 0) { xSemaphoreGive(s_lock); return ESP_ERR_NOT_SUPPORTED; }
    component_runtime_state_t *state = runtime_find_locked(component_id, false);
    const bool was_on = state ? state->on : false;
    const uint8_t active = resolve_active_level(&info, DEFAULT_ACTIVE_LEVEL);
    if (info.wiring.gpio != PIN_OUT_BUZZER) {
        gpio_set_level((gpio_num_t)info.wiring.gpio, !active);
    }
    runtime_set_locked(component_id, false, ACTUATOR_OWNER_SAFETY);
    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        hw_component_info_t mapped;
        if (resolve_configured_actuator((actuator_id_t)i, &mapped) == ESP_OK && strcmp(mapped.component_id, component_id) == 0) {
            s_actuators[i].state = false;
            s_actuators[i].owner = ACTUATOR_OWNER_SAFETY;
            s_actuators[i].gpio = (gpio_num_t)info.wiring.gpio;
            s_actuators[i].active_level = active;
        }
    }
    xSemaphoreGive(s_lock);
    if (was_on && (strcasestr(info.role, "PUMP") || strcasestr(info.supported_type_id, "PUMP"))) {
        (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", "PUMP_STOPPED",
                            "Configured pump force-stopped by safety authority.", info.component_id);
    } else if (was_on && (strcasestr(info.role, "FAN") || strcasestr(info.role, "BLOWER") ||
                          strcasestr(info.supported_type_id, "FAN") || strcasestr(info.supported_type_id, "BLOWER"))) {
        (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", "FAN_STOPPED",
                            "Configured fan force-stopped by safety authority.", info.component_id);
    }
    return ESP_OK;
}

esp_err_t actuator_hal_clear_safety_locks(void)
{
    if (!s_lock) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        if (s_actuators[i].owner == ACTUATOR_OWNER_SAFETY) s_actuators[i].owner = ACTUATOR_OWNER_NONE;
    }
    for (size_t i = 0; i < MAX_DYNAMIC_RUNTIME; ++i) {
        if (s_component_runtime[i].valid && s_component_runtime[i].owner == ACTUATOR_OWNER_SAFETY) s_component_runtime[i].owner = ACTUATOR_OWNER_NONE;
    }
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

void actuator_hal_emergency_stop(void)
{
    if (!s_lock) return;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    bool was_latched = s_emergency_stop_latched;
    s_emergency_stop_latched = true;
    if (!was_latched) {
        storage_mgr_set_estop(true);
    }

    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        if (i == ACTUATOR_BUZZER) continue;
        s_actuators[i].state = false;
        s_actuators[i].owner = ACTUATOR_OWNER_SAFETY; // Force lock ownership to safety
        if (s_actuators[i].gpio >= 0) {
            gpio_set_level(s_actuators[i].gpio, !s_actuators[i].active_level);
        }
    }
    for (size_t i = 0; i < MAX_DYNAMIC_RUNTIME; ++i) {
        if (!s_component_runtime[i].valid) continue;
        s_component_runtime[i].on = false;
        s_component_runtime[i].owner = ACTUATOR_OWNER_SAFETY;
        s_component_runtime[i].started_at_us = 0;
    }

    /* Turn error lamp ON upon emergency stop if mapped.
     * Physical buzzer is NOT directly manipulated here; it is driven exclusively
     * by alarm_mgr via alarm_mgr_raise(ALARM_PRIO_CRITICAL, "EMERGENCY_STOP_ACTIVE", ...). */
    if (ACTUATOR_ERROR_LAMP < ACTUATOR_MAX_COUNT && s_actuators[ACTUATOR_ERROR_LAMP].gpio >= 0) {
        s_actuators[ACTUATOR_ERROR_LAMP].state = true;
        gpio_set_level(s_actuators[ACTUATOR_ERROR_LAMP].gpio, s_actuators[ACTUATOR_ERROR_LAMP].active_level);
    }

    ESP_LOGE(TAG, "EMERGENCY STOP EXECUTED: All actuators set to OFF state.");
    xSemaphoreGive(s_lock);

    // Notify centralized alarm manager of critical E-Stop condition
    (void)alarm_mgr_raise(ALARM_PRIO_CRITICAL, "EMERGENCY_STOP_ACTIVE", "Emergency stop executed: all actuators forced OFF.", NULL, NULL);
}

void actuator_hal_resume(void)
{
    if (!s_lock) return;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_emergency_stop_latched = false;
    (void)storage_mgr_set_estop(false);
    
    /* Turn error lamp OFF if mapped.
     * Physical buzzer is NOT directly manipulated here; alarm_mgr resolves
     * E-Stop alarms and determines whether any other alarms remain active. */
    if (ACTUATOR_ERROR_LAMP < ACTUATOR_MAX_COUNT && s_actuators[ACTUATOR_ERROR_LAMP].gpio >= 0) {
        s_actuators[ACTUATOR_ERROR_LAMP].state = false;
        gpio_set_level(s_actuators[ACTUATOR_ERROR_LAMP].gpio, !s_actuators[ACTUATOR_ERROR_LAMP].active_level);
    }

    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        if (s_actuators[i].owner == ACTUATOR_OWNER_SAFETY) {
            s_actuators[i].owner = ACTUATOR_OWNER_NONE;
        }
    }
    for (size_t i = 0; i < MAX_DYNAMIC_RUNTIME; ++i) {
        if (s_component_runtime[i].valid && s_component_runtime[i].owner == ACTUATOR_OWNER_SAFETY) {
            s_component_runtime[i].owner = ACTUATOR_OWNER_NONE;
        }
    }

    ESP_LOGI(TAG, "Emergency Stop latched cleared. Actuators can now be commanded.");
    xSemaphoreGive(s_lock);

    // Notify centralized alarm manager that E-Stop conditions are resolved
    (void)alarm_mgr_resolve("EMERGENCY_STOP_ACTIVE", NULL);
    (void)alarm_mgr_resolve("EMERGENCY_STOP_LATCHED", NULL);
}

bool actuator_hal_is_emergency_stopped(void)
{
    return s_emergency_stop_latched;
}

esp_err_t actuator_hal_buzzer_set_raw(bool on)
{
    if (ACTUATOR_BUZZER >= ACTUATOR_MAX_COUNT) return ESP_ERR_NOT_SUPPORTED;
    if (!s_lock) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s_actuators[ACTUATOR_BUZZER].gpio >= 0) {
        s_actuators[ACTUATOR_BUZZER].state = on;
        uint8_t lvl = on ? s_actuators[ACTUATOR_BUZZER].active_level : !s_actuators[ACTUATOR_BUZZER].active_level;
        gpio_set_level((gpio_num_t)s_actuators[ACTUATOR_BUZZER].gpio, lvl);
    }
    xSemaphoreGive(s_lock);
    return ESP_OK;
}
