#include "services/manual_actuator_mgr.h"
#include "config/system_config.h"
#include "config/pin_config.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

static const char *TAG = "MANUAL_MGR";

typedef struct {
    bool is_active;
    uint32_t start_tick;
    uint32_t duration_ticks;
} manual_state_t;

static manual_state_t s_states[ACTUATOR_MAX_COUNT];
static SemaphoreHandle_t s_mutex = NULL;

static void manual_actuator_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Manual Actuator Manager task started.");
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        
        if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
            uint32_t current_tick = xTaskGetTickCount();
            bool e_stopped = actuator_hal_is_emergency_stopped();
            
            for (int i = 0; i < ACTUATOR_MAX_COUNT; i++) {
                if (s_states[i].is_active) {
                    bool should_stop = false;
                    
                    // 1. Timeout Check
                    if ((current_tick - s_states[i].start_tick) >= s_states[i].duration_ticks) {
                        should_stop = true;
                        ESP_LOGI(TAG, "Manual run for actuator %d timed out.", i);
                    }
                    
                    // 2. Safety Interlock Check
                    if (e_stopped) {
                        should_stop = true;
                        ESP_LOGW(TAG, "Manual run for actuator %d stopped due to E-Stop.", i);
                    } else if (i == ACTUATOR_WELL_PUMP || i == ACTUATOR_DIST_PUMP || i == ACTUATOR_RAW_SUBMERSIBLE) {
                        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) {
                            should_stop = true;
                            ESP_LOGW(TAG, "Manual run for pump %d stopped due to lower float dry state.", i);
                        }
                    }
                    
                    if (should_stop) {
                        actuator_hal_set((actuator_id_t)i, false);
                        actuator_hal_release((actuator_id_t)i, ACTUATOR_OWNER_MANUAL);
                        s_states[i].is_active = false;
                    }
                }
            }
            xSemaphoreGive(s_mutex);
        }
    }
}

esp_err_t manual_actuator_mgr_init(void)
{
    if (s_mutex) return ESP_OK;
    s_mutex = xSemaphoreCreateMutex();
    for (int i = 0; i < ACTUATOR_MAX_COUNT; i++) {
        s_states[i].is_active = false;
    }
    xTaskCreatePinnedToCore(manual_actuator_task, "manual_actuator", 3072, NULL, 3, NULL, 1);
    return ESP_OK;
}

esp_err_t manual_actuator_start(actuator_id_t id, uint32_t duration_sec)
{
    if (id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    
    esp_err_t err = ESP_OK;
    
    // Toggle behavior: if already active, turn it off.
    if (s_states[id].is_active) {
        actuator_hal_set(id, false);
        actuator_hal_release(id, ACTUATOR_OWNER_MANUAL);
        s_states[id].is_active = false;
        ESP_LOGI(TAG, "Manual toggle: actuator %d turned OFF early.", id);
    } else {
        err = actuator_hal_acquire(id, ACTUATOR_OWNER_MANUAL);
        if (err == ESP_OK) {
            err = actuator_hal_set(id, true);
            if (err == ESP_OK) {
                s_states[id].is_active = true;
                s_states[id].start_tick = xTaskGetTickCount();
                s_states[id].duration_ticks = pdMS_TO_TICKS(duration_sec * 1000);
                ESP_LOGI(TAG, "Manual start: actuator %d turned ON for %u seconds.", id, (unsigned)duration_sec);
            } else {
                actuator_hal_release(id, ACTUATOR_OWNER_MANUAL);
                ESP_LOGW(TAG, "Failed to start actuator %d (safety block).", id);
            }
        } else {
            ESP_LOGW(TAG, "Failed to start actuator %d (already owned).", id);
        }
    }
    
    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t manual_actuator_stop(actuator_id_t id)
{
    if (id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    
    if (s_states[id].is_active) {
        actuator_hal_set(id, false);
        actuator_hal_release(id, ACTUATOR_OWNER_MANUAL);
        s_states[id].is_active = false;
        ESP_LOGI(TAG, "Manual stop: actuator %d turned OFF.", id);
    }
    
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

bool manual_actuator_is_running(actuator_id_t id)
{
    if (id >= ACTUATOR_MAX_COUNT) return false;
    bool active = false;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        active = s_states[id].is_active;
        xSemaphoreGive(s_mutex);
    }
    return active;
}
