#include "hal/actuator_hal.h"
#include "services/event_mgr.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include "esp_timer.h"
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
    [ACTUATOR_WELL_PUMP]       = { .name = "Well Pump",        .gpio = PIN_OUT_WELL_PUMP,       .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_DIST_PUMP]       = { .name = "Dist Pump",        .gpio = PIN_OUT_DIST_PUMP,       .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_RAW_SUBMERSIBLE] = { .name = "Raw Submersible",  .gpio = PIN_OUT_RAW_SUBMERSIBLE, .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_DOSING_A]        = { .name = "Dosing Pump A",    .gpio = PIN_OUT_DOSING_A,        .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_DOSING_B]        = { .name = "Dosing Pump B",    .gpio = PIN_OUT_DOSING_B,        .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_COOLING_FAN]     = { .name = "Cooling Fan",      .gpio = PIN_OUT_COOLING_FAN,     .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_BLOWER_FAN]      = { .name = "Blower Fan",       .gpio = PIN_OUT_BLOWER_FAN,      .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_MIXING_PUMP]     = { .name = "Mixing Pump",      .gpio = PIN_OUT_MIXING_PUMP,     .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_ERROR_LAMP]      = { .name = "Error Lamp",       .gpio = PIN_OUT_ERROR_LAMP,      .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_BUZZER]          = { .name = "Alarm Buzzer",     .gpio = PIN_OUT_BUZZER,          .state = false, .owner = ACTUATOR_OWNER_NONE, .active_level = BUZZER_ACTIVE_LEVEL },
};

static bool s_emergency_stop_latched = false;
static SemaphoreHandle_t s_lock = NULL;

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

esp_err_t actuator_hal_init(void)
{
    if (!s_lock) {
        s_lock = xSemaphoreCreateMutex();
    }

    xSemaphoreTake(s_lock, portMAX_DELAY);

    /* Configure pull mode to bias towards inactive level (ACTUATOR_LEVEL_OFF) during reset/hi-z */
    gpio_config_t io_conf = {
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = (ACTUATOR_LEVEL_OFF == 1) ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
        .pull_down_en = (ACTUATOR_LEVEL_OFF == 0) ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
        .pin_bit_mask = 0
    };

    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        s_actuators[i].state = false;
        if (s_actuators[i].gpio >= 0) {
            // Output inactive level is the opposite of active_level
            gpio_set_level(s_actuators[i].gpio, !s_actuators[i].active_level);
            io_conf.pin_bit_mask |= (1ULL << s_actuators[i].gpio);
        }
    }

    esp_err_t err = gpio_config(&io_conf);

    /* Once the active registry exists, explicitly drive every configured GPIO
     * to its inactive state as well. This covers configured safety outputs that
     * are not represented by the legacy compatibility enum. */
    for (size_t i = 0; i < hardware_registry_get_count(); ++i) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) != ESP_OK) continue;
        if (info.wiring.interface == HW_INTERFACE_GPIO && info.wiring.gpio >= 0) {
            const uint8_t active = (strcmp(info.wiring.polarity, "ACTIVE_HIGH") == 0) ? 1U : 0U;
            gpio_reset_pin((gpio_num_t)info.wiring.gpio);
            gpio_set_direction((gpio_num_t)info.wiring.gpio, GPIO_MODE_OUTPUT);
            gpio_set_level((gpio_num_t)info.wiring.gpio, !active);
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
        case ACTUATOR_COOLING_FAN: return "COOLING_FAN";
        case ACTUATOR_BLOWER_FAN: return "BLOWER_FAN";
        case ACTUATOR_MIXING_PUMP: return "MIXING_PUMP";
        case ACTUATOR_ERROR_LAMP: return "ERROR_LAMP";
        case ACTUATOR_BUZZER: return "BUZZER";
        default: return NULL;
    }
}

static bool actuator_role_matches(actuator_id_t id, const char *role)
{
    if (!role || !role[0]) return false;
    const char *canonical = actuator_role_for_id(id);
    if (canonical && strcmp(role, canonical) == 0) return true;
    if (id == ACTUATOR_DIST_PUMP && strcmp(role, "DIST_PUMP") == 0) return true;
    if (id == ACTUATOR_MIXING_PUMP && strcmp(role, "MIX_PUMP") == 0) return true;
    if (id == ACTUATOR_ERROR_LAMP && (strcmp(role, "ALARM_LAMP") == 0 || strcmp(role, "ERROR_BEACON") == 0)) return true;
    if (id == ACTUATOR_BUZZER && strcmp(role, "ALARM_BUZZER") == 0) return true;
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
    if (!info || info->wiring.polarity[0] == '\0') return fallback;
    if (strcmp(info->wiring.polarity, "ACTIVE_HIGH") == 0) return 1;
    if (strcmp(info->wiring.polarity, "ACTIVE_LOW") == 0) return 0;
    return fallback;
}

esp_err_t actuator_hal_set(actuator_id_t id, bool on)
{
    if (id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
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
    s_actuators[id].active_level = resolve_active_level(&comp_info, DEFAULT_ACTIVE_LEVEL);
    bool was_on = s_actuators[id].state;
    s_actuators[id].state = on;
    gpio_set_level(s_actuators[id].gpio, on ? s_actuators[id].active_level : !s_actuators[id].active_level);
    runtime_set_locked(comp_info.component_id, on, s_actuators[id].owner);

    ESP_LOGI(TAG, "Configured component '%s' (%s) -> %s (GPIO %d)",
             comp_info.component_id, comp_info.role, on ? "ON" : "OFF", s_actuators[id].gpio);

    xSemaphoreGive(s_lock);
    if (was_on != on && id == ACTUATOR_BUZZER) {
        (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM", on ? "ALARM_BUZZER_ON" : "ALARM_BUZZER_OFF",
                            on ? "Alarm buzzer activated." : "Alarm buzzer deactivated.", comp_info.component_id);
    }
    return ESP_OK;
}

esp_err_t actuator_hal_set_by_component_id(const char *component_id, bool on)
{
    if (!component_id || component_id[0] == '\0') return ESP_ERR_INVALID_ARG;
    if (!s_lock) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_lock, portMAX_DELAY);

    hw_component_info_t info;
    if (hardware_registry_find_by_id(component_id, &info) != ESP_OK) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_NOT_FOUND;
    }

    if (on && s_emergency_stop_latched) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked component '%s' ON: System in EMERGENCY STOP.", component_id);
        return ESP_ERR_INVALID_STATE;
    }

    if (on && (strcmp(info.role, "DISTRIBUTION_PUMP") == 0)) {
        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) {
            xSemaphoreGive(s_lock);
            ESP_LOGW(TAG, "Blocked component '%s' ON: lower-float dry-run interlock active.", component_id);
            return ESP_ERR_INVALID_STATE;
        }
    }

    if (on && info.lifecycle_state != HW_LIFECYCLE_COMMISSIONED &&
        info.lifecycle_state != HW_LIFECYCLE_ENABLED) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked component '%s' ON: lifecycle state %d is not operational.", component_id, (int)info.lifecycle_state);
        return ESP_ERR_INVALID_STATE;
    }

    if (info.wiring.interface != HW_INTERFACE_GPIO && info.wiring.interface != HW_INTERFACE_I2C) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Component '%s' has unsupported interface %d.", component_id, (int)info.wiring.interface);
        return ESP_ERR_NOT_SUPPORTED;
    }

    uint8_t active_level = resolve_active_level(&info, DEFAULT_ACTIVE_LEVEL);
    component_runtime_state_t *runtime = runtime_find_locked(component_id, true);
    actuator_owner_t owner = runtime ? runtime->owner : ACTUATOR_OWNER_NONE;
    bool was_on = runtime ? runtime->on : false;
    if (on && owner == ACTUATOR_OWNER_SAFETY) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked component '%s' ON: safety lock is active.", component_id);
        return ESP_ERR_INVALID_STATE;
    }

    if (info.wiring.interface == HW_INTERFACE_I2C) {
        // Pathway B (DYNAMIC_HARDWARE_REGISTRY_ARCHITECTURE.md §3 Pathway B):
        // PCA9685 16-channel I2C PWM driver for dosing C..G expansion.
        // Driver implementation pending hardware validation; until then we
        // return ESP_ERR_NOT_SUPPORTED with a clear log so the calling
        // fertigation_mgr fault path emits DOSING_ACTUATOR_REJECTED.
        //
        // When the PCA9685 driver is added (hal/pca9685.c), this branch
        // should call (parse address string to int first):
        //   int i2c_addr = (int)strtol(info.wiring.address, NULL, 0);
        //   esp_err_t err = pca9685_set_channel(i2c_addr,
        //                                        info.wiring.channel,
        //                                        on ? active_level : !active_level);
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Component '%s' (role=%s) uses I2C channel %d @ addr '%s' — driver pending.",
                 component_id, info.role, info.wiring.channel, info.wiring.address);
        return ESP_ERR_NOT_SUPPORTED;
    }

    // Pathway A: GPIO direct drive
    if (info.wiring.gpio < 0) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Component '%s' has invalid GPIO %d.", component_id, info.wiring.gpio);
        return ESP_ERR_NOT_SUPPORTED;
    }

    gpio_num_t gpio = (gpio_num_t)info.wiring.gpio;
    gpio_reset_pin(gpio);
    gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
    gpio_set_level(gpio, on ? active_level : !active_level);
    runtime_set_locked(component_id, on, owner);

    xSemaphoreGive(s_lock);
    ESP_LOGI(TAG, "Configured component '%s' (%s) -> %s (GPIO %d)",
             info.component_id, info.role, on ? "ON" : "OFF", gpio);
    if (was_on != on) {
        if (strcasestr(info.role, "PUMP") || strcasestr(info.supported_type_id, "PUMP")) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", on ? "PUMP_STARTED" : "PUMP_STOPPED",
                                on ? "Configured pump switched ON." : "Configured pump switched OFF.", info.component_id);
        } else if (strcmp(info.role, "BUZZER") == 0 || strcmp(info.role, "ALARM_BUZZER") == 0 || strstr(info.supported_type_id, "buzzer")) {
            (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM", on ? "ALARM_BUZZER_ON" : "ALARM_BUZZER_OFF",
                                on ? "Alarm buzzer activated." : "Alarm buzzer deactivated.", info.component_id);
        }
        extern void telemetry_mgr_trigger_transition(const char *reason);
        telemetry_mgr_trigger_transition("ACTUATOR_STATE_CHANGE");
    }
    return ESP_OK;
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
    if (err != ESP_OK) return err;
    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        if (actuator_role_matches((actuator_id_t)i, info.role)) {
            *out_id = (actuator_id_t)i;
            return ESP_OK;
        }
    }
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t actuator_hal_get_component_status(const char *component_id, bool *out_on, actuator_owner_t *out_owner, uint32_t *out_runtime_seconds)
{
    if (!component_id || !out_on || !out_owner || !out_runtime_seconds || !s_lock) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    component_runtime_state_t *state = runtime_find_locked(component_id, false);
    hw_component_info_t info;
    if (hardware_registry_find_by_id(component_id, &info) != ESP_OK || !state) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_NOT_FOUND;
    }
    *out_on = state->on;
    *out_owner = state->owner;
    *out_runtime_seconds = state->on && state->started_at_us > 0 ? (uint32_t)((esp_timer_get_time() - state->started_at_us) / 1000000LL) : 0U;
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t actuator_hal_acquire_component(const char *component_id, actuator_owner_t owner)
{
    if (!component_id || !component_id[0] || !s_lock || owner == ACTUATOR_OWNER_NONE) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err != ESP_OK) { xSemaphoreGive(s_lock); return err; }
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
    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t actuator_hal_release_component(const char *component_id, actuator_owner_t owner)
{
    if (!component_id || !component_id[0] || !s_lock) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    component_runtime_state_t *state = runtime_find_locked(component_id, false);
    if (!state) { xSemaphoreGive(s_lock); return ESP_ERR_NOT_FOUND; }
    if (state->owner == owner || owner == ACTUATOR_OWNER_SAFETY) {
        state->owner = ACTUATOR_OWNER_NONE;
        xSemaphoreGive(s_lock);
        return ESP_OK;
    }
    xSemaphoreGive(s_lock);
    return ESP_ERR_INVALID_STATE;
}

esp_err_t actuator_hal_stop_component(const char *component_id, actuator_owner_t owner)
{
    if (!component_id || !component_id[0] || !s_lock) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err != ESP_OK) { xSemaphoreGive(s_lock); return err; }
    component_runtime_state_t *state = runtime_find_locked(component_id, false);
    if (state && state->owner != ACTUATOR_OWNER_NONE && state->owner != owner && owner != ACTUATOR_OWNER_SAFETY) {
        xSemaphoreGive(s_lock);
        return ESP_ERR_INVALID_STATE;
    }
    bool was_on = state ? state->on : false;
    if (info.wiring.interface == HW_INTERFACE_GPIO && info.wiring.gpio >= 0) {
        const uint8_t active = resolve_active_level(&info, DEFAULT_ACTIVE_LEVEL);
        gpio_set_level((gpio_num_t)info.wiring.gpio, !active);
    }
    runtime_set_locked(component_id, false, ACTUATOR_OWNER_NONE);
    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        hw_component_info_t mapped;
        if (resolve_configured_actuator((actuator_id_t)i, &mapped) == ESP_OK && strcmp(mapped.component_id, component_id) == 0) {
            s_actuators[i].state = false;
            if (s_actuators[i].owner == owner || owner == ACTUATOR_OWNER_SAFETY) s_actuators[i].owner = ACTUATOR_OWNER_NONE;
        }
    }
    xSemaphoreGive(s_lock);
    if (was_on && (strcasestr(info.role, "PUMP") || strcasestr(info.supported_type_id, "PUMP"))) {
        (void)event_mgr_log(LOG_LEVEL_INFO, "ACTUATOR", "PUMP_STOPPED",
                            "Configured pump stopped.", info.component_id);
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
    gpio_set_level((gpio_num_t)info.wiring.gpio, !active);
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

    /* Turn error lamp and buzzer ON upon emergency stop */
    if (ACTUATOR_ERROR_LAMP < ACTUATOR_MAX_COUNT && s_actuators[ACTUATOR_ERROR_LAMP].gpio >= 0) {
        s_actuators[ACTUATOR_ERROR_LAMP].state = true;
        gpio_set_level(s_actuators[ACTUATOR_ERROR_LAMP].gpio, s_actuators[ACTUATOR_ERROR_LAMP].active_level);
    }
    if (ACTUATOR_BUZZER < ACTUATOR_MAX_COUNT && s_actuators[ACTUATOR_BUZZER].gpio >= 0) {
        s_actuators[ACTUATOR_BUZZER].state = true;
        gpio_set_level(s_actuators[ACTUATOR_BUZZER].gpio, s_actuators[ACTUATOR_BUZZER].active_level);
    }

    ESP_LOGE(TAG, "EMERGENCY STOP EXECUTED: All actuators set to OFF state.");
    xSemaphoreGive(s_lock);
}

void actuator_hal_resume(void)
{
    if (!s_lock) return;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    bool was_latched = s_emergency_stop_latched;
    s_emergency_stop_latched = false;
    if (was_latched) {
        storage_mgr_set_estop(false);
    }
    
    /* Turn error lamp and buzzer OFF */
    if (ACTUATOR_ERROR_LAMP < ACTUATOR_MAX_COUNT && s_actuators[ACTUATOR_ERROR_LAMP].gpio >= 0) {
        s_actuators[ACTUATOR_ERROR_LAMP].state = false;
        gpio_set_level(s_actuators[ACTUATOR_ERROR_LAMP].gpio, !s_actuators[ACTUATOR_ERROR_LAMP].active_level);
    }
    if (ACTUATOR_BUZZER < ACTUATOR_MAX_COUNT && s_actuators[ACTUATOR_BUZZER].gpio >= 0) {
        s_actuators[ACTUATOR_BUZZER].state = false;
        gpio_set_level(s_actuators[ACTUATOR_BUZZER].gpio, !s_actuators[ACTUATOR_BUZZER].active_level);
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
}

bool actuator_hal_is_emergency_stopped(void)
{
    return s_emergency_stop_latched;
}
