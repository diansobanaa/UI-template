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
    uint8_t active_level;
} actuator_descriptor_t;

/* Default active level referenced from centralized pin_config.h (0 = Active-LOW). */
#define DEFAULT_ACTIVE_LEVEL ACTUATOR_ACTIVE_LEVEL

static actuator_descriptor_t s_actuators[ACTUATOR_MAX_COUNT] = {
    [ACTUATOR_WELL_PUMP]       = { .name = "Well Pump",        .gpio = PIN_OUT_WELL_PUMP,       .state = false, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_DIST_PUMP]       = { .name = "Dist Pump",        .gpio = PIN_OUT_DIST_PUMP,       .state = false, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_RAW_SUBMERSIBLE] = { .name = "Raw Submersible",  .gpio = PIN_OUT_RAW_SUBMERSIBLE, .state = false, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_DOSING_A]        = { .name = "Dosing Pump A",    .gpio = PIN_OUT_DOSING_A,        .state = false, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_DOSING_B]        = { .name = "Dosing Pump B",    .gpio = PIN_OUT_DOSING_B,        .state = false, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_COOLING_FAN]     = { .name = "Cooling Fan",      .gpio = PIN_OUT_COOLING_FAN,     .state = false, .active_level = DEFAULT_ACTIVE_LEVEL },
    [ACTUATOR_ERROR_LAMP]      = { .name = "Error Lamp",       .gpio = PIN_OUT_ERROR_LAMP,      .state = false, .active_level = DEFAULT_ACTIVE_LEVEL },
};

static bool s_emergency_stop_latched = false;
static bool s_tank_full_interlock = false;
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
        ESP_LOGI(TAG, "Actuator HAL initialized with 7 channels in safe OFF state.");
    } else {
        ESP_LOGE(TAG, "Actuator HAL initialization failed (0x%x)", err);
    }

    return err;
}

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

    /* Interlock 2: Tank Full inhibits Well Pump */
    if (on && id == ACTUATOR_WELL_PUMP && s_tank_full_interlock) {
        xSemaphoreGive(s_lock);
        ESP_LOGW(TAG, "Blocked Well Pump ON: Raw water tank radar full interlock active.");
        return ESP_ERR_INVALID_STATE;
    }

    /* Interlock 3: Dry-Run Protection via Lower Float (BS-SAFE-002) */
    if (on && (id == ACTUATOR_DIST_PUMP || id == ACTUATOR_WELL_PUMP || id == ACTUATOR_RAW_SUBMERSIBLE)) {
        // Read directly from PIN_IN_FLOAT_LOWER. Level 0 = Dry (Trip), Level 1 = Normal (Water OK).
        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) { 
            xSemaphoreGive(s_lock);
            ESP_LOGW(TAG, "Blocked %s ON: Dry-run protection interlock active (Tank empty).", s_actuators[id].name);
            return ESP_ERR_INVALID_STATE;
        }
    }

    s_actuators[id].state = on;
    uint8_t physical_level = on ? s_actuators[id].active_level : !s_actuators[id].active_level;
    gpio_set_level(s_actuators[id].gpio, physical_level);

    ESP_LOGI(TAG, "%s state -> %s (GPIO %d)", s_actuators[id].name, on ? "ON" : "OFF", s_actuators[id].gpio);

    xSemaphoreGive(s_lock);
    return ESP_OK;
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
                                 (id == ACTUATOR_WELL_PUMP && s_tank_full_interlock) ||
                                 ((id == ACTUATOR_DIST_PUMP || id == ACTUATOR_WELL_PUMP || id == ACTUATOR_RAW_SUBMERSIBLE) && gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY);
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

    ESP_LOGI(TAG, "Emergency Stop latched cleared. Actuators can now be commanded.");
    xSemaphoreGive(s_lock);
}

bool actuator_hal_is_emergency_stopped(void)
{
    return s_emergency_stop_latched;
}

void actuator_hal_set_tank_full_interlock(bool full)
{
    if (s_lock) xSemaphoreTake(s_lock, portMAX_DELAY);

    s_tank_full_interlock = full;
    if (full && s_actuators[ACTUATOR_WELL_PUMP].state) {
        /* Kill well pump immediately */
        s_actuators[ACTUATOR_WELL_PUMP].state = false;
        gpio_set_level(s_actuators[ACTUATOR_WELL_PUMP].gpio, !s_actuators[ACTUATOR_WELL_PUMP].active_level);
        ESP_LOGW(TAG, "Well pump automatically turned OFF by radar tank full interlock.");
    }

    if (s_lock) xSemaphoreGive(s_lock);
}
