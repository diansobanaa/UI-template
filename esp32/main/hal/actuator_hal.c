#include "hal/actuator_hal.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "storage/storage_mgr.h"

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
};

static bool s_emergency_stop_latched = false;
static SemaphoreHandle_t s_lock = NULL;

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
        // Output inactive level is the opposite of active_level
        gpio_set_level(s_actuators[i].gpio, !s_actuators[i].active_level);
        io_conf.pin_bit_mask |= (1ULL << s_actuators[i].gpio);
    }

    esp_err_t err = gpio_config(&io_conf);
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

#include "hal/hardware_registry.h"

static const char *s_actuator_component_ids[ACTUATOR_MAX_COUNT] = {
    [ACTUATOR_WELL_PUMP]       = "well-pump",
    [ACTUATOR_DIST_PUMP]       = "dist-pump",
    [ACTUATOR_RAW_SUBMERSIBLE] = "raw-submersible",
    [ACTUATOR_DOSING_A]        = "dosing-pump-a",
    [ACTUATOR_DOSING_B]        = "dosing-pump-b",
    [ACTUATOR_COOLING_FAN]     = "cooling-fan",
    [ACTUATOR_BLOWER_FAN]      = "blower-fan",
    [ACTUATOR_MIXING_PUMP]     = "mixing-pump",
    [ACTUATOR_ERROR_LAMP]      = "error-lamp",
};

esp_err_t actuator_hal_set(actuator_id_t id, bool on)
{
    if (id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    if (!s_lock) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_lock, portMAX_DELAY);

    /* Interlock 1: Emergency Stop */
    if (on && s_emergency_stop_latched) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked %s ON: System in EMERGENCY STOP.", s_actuators[id].name);
        return ESP_ERR_INVALID_STATE;
    }

    /* Interlock 2: Lower Float Dry-Run Protection (Safety Stop Point for Distribution & Pumps) */
    if (on && (id == ACTUATOR_DIST_PUMP || id == ACTUATOR_WELL_PUMP || id == ACTUATOR_RAW_SUBMERSIBLE)) {
        // Read directly from PIN_IN_FLOAT_LOWER. Level 0 = Dry (Trip), Level 1 = Normal (Water OK).
        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) { 
            xSemaphoreGive(s_lock);
            ESP_LOGW(TAG, "Blocked %s ON: Lower float dry-run interlock active (Tank reached minimum level).", s_actuators[id].name);
            return ESP_ERR_INVALID_STATE;
        }
    }

    /* M2.25: Lifecycle State & Dynamic Resolution Check */
    const char *comp_id = s_actuator_component_ids[id];
    hw_component_info_t comp_info;
    if (comp_id && hardware_registry_find_by_id(comp_id, &comp_info) == ESP_OK) {
        if (on && comp_info.lifecycle_state != HW_LIFECYCLE_COMMISSIONED && 
            comp_info.lifecycle_state != HW_LIFECYCLE_ENABLED) {
            xSemaphoreGive(s_lock);
            ESP_LOGW(TAG, "Blocked %s ON: Component '%s' not operational (lifecycle: %d)",
                     s_actuators[id].name, comp_id, (int)comp_info.lifecycle_state);
            return ESP_ERR_INVALID_STATE;
        }

        /* M2.24: Dynamic GPIO resolution from active configuration */
        if (comp_info.wiring.gpio >= 0 && comp_info.wiring.gpio != (int8_t)s_actuators[id].gpio) {
            gpio_num_t new_gpio = (gpio_num_t)comp_info.wiring.gpio;
            gpio_reset_pin(new_gpio);
            gpio_set_direction(new_gpio, GPIO_MODE_OUTPUT);
            s_actuators[id].gpio = new_gpio;
            ESP_LOGI(TAG, "Dynamic re-binding: %s -> GPIO %d", comp_id, new_gpio);
        }
    }

    s_actuators[id].state = on;
    uint8_t physical_level = on ? s_actuators[id].active_level : !s_actuators[id].active_level;
    gpio_set_level(s_actuators[id].gpio, physical_level);

    ESP_LOGI(TAG, "%s state -> %s (GPIO %d)", s_actuators[id].name, on ? "ON" : "OFF", s_actuators[id].gpio);

    xSemaphoreGive(s_lock);
    return ESP_OK;
}

esp_err_t actuator_hal_set_by_component_id(const char *component_id, bool on)
{
    if (!component_id) return ESP_ERR_INVALID_ARG;

    for (int i = 0; i < ACTUATOR_MAX_COUNT; i++) {
        if (s_actuator_component_ids[i] && strcmp(s_actuator_component_ids[i], component_id) == 0) {
            return actuator_hal_set((actuator_id_t)i, on);
        }
    }

    /* Fallback: lookup in registry directly */
    hw_component_info_t info;
    if (hardware_registry_find_by_id(component_id, &info) != ESP_OK) {
        return ESP_ERR_NOT_FOUND;
    }

    if (on && info.lifecycle_state != HW_LIFECYCLE_COMMISSIONED && 
        info.lifecycle_state != HW_LIFECYCLE_ENABLED) {
        ESP_LOGW(TAG, "Blocked %s ON: Component not commissioned (state: %d)", component_id, (int)info.lifecycle_state);
        return ESP_ERR_INVALID_STATE;
    }

    if (info.wiring.gpio >= 0) {
        gpio_set_direction((gpio_num_t)info.wiring.gpio, GPIO_MODE_OUTPUT);
        gpio_set_level((gpio_num_t)info.wiring.gpio, on ? 1 : 0);
        return ESP_OK;
    }

    return ESP_ERR_NOT_SUPPORTED;
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
                                 ((id == ACTUATOR_DIST_PUMP || id == ACTUATOR_WELL_PUMP || id == ACTUATOR_RAW_SUBMERSIBLE) && gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY);
    out_status->owner = s_actuators[id].owner;
    out_status->run_time_seconds = 0; // Not fully tracked yet
    out_status->active_level = s_actuators[id].active_level;

    return ESP_OK;
}

void actuator_hal_emergency_stop(void)
{
    if (!s_lock) return;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_emergency_stop_latched = true;
    storage_mgr_set_estop(true);

    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        s_actuators[i].state = false;
        s_actuators[i].owner = ACTUATOR_OWNER_SAFETY; // Force lock ownership to safety
        gpio_set_level(s_actuators[i].gpio, !s_actuators[i].active_level);
    }

    /* Turn error lamp ON upon emergency stop */
    if (ACTUATOR_ERROR_LAMP < ACTUATOR_MAX_COUNT) {
        s_actuators[ACTUATOR_ERROR_LAMP].state = true;
        gpio_set_level(s_actuators[ACTUATOR_ERROR_LAMP].gpio, s_actuators[ACTUATOR_ERROR_LAMP].active_level);
    }

    ESP_LOGE(TAG, "EMERGENCY STOP EXECUTED: All actuators set to OFF state.");
    xSemaphoreGive(s_lock);
}

void actuator_hal_resume(void)
{
    if (!s_lock) return;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_emergency_stop_latched = false;
    storage_mgr_set_estop(false);
    
    /* Turn error lamp OFF */
    if (ACTUATOR_ERROR_LAMP < ACTUATOR_MAX_COUNT) {
        s_actuators[ACTUATOR_ERROR_LAMP].state = false;
        gpio_set_level(s_actuators[ACTUATOR_ERROR_LAMP].gpio, !s_actuators[ACTUATOR_ERROR_LAMP].active_level);
    }

    for (int i = 0; i < ACTUATOR_MAX_COUNT; ++i) {
        if (s_actuators[i].owner == ACTUATOR_OWNER_SAFETY) {
            s_actuators[i].owner = ACTUATOR_OWNER_NONE;
        }
    }

    ESP_LOGI(TAG, "Emergency Stop latched cleared. Actuators can now be commanded.");
    xSemaphoreGive(s_lock);
}

bool actuator_hal_is_emergency_stopped(void)
{
    return s_emergency_stop_latched;
}
