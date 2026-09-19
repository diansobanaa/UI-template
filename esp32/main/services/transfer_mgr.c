#include "services/transfer_mgr.h"
#include "config/pin_config.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <strings.h>
#include <string.h>

static const char *TAG = "TRANSFER_MGR";

#define DRAINING_DURATION_SEC 5

typedef struct {
    transfer_state_t state;
    char source_component_id[40];
    char destination_component_id[40];
    uint32_t start_tick;
    uint32_t duration_ticks;
    uint32_t draining_start_tick;
} transfer_mgr_t;

static transfer_mgr_t s_ctx;
static SemaphoreHandle_t s_mutex = NULL;

static void set_state(transfer_state_t new_state)
{
    if (s_ctx.state != new_state) {
        ESP_LOGI(TAG, "State changed: %d -> %d", s_ctx.state, new_state);
        s_ctx.state = new_state;
    }
}

static void turn_off_actuators(void)
{
    if (s_ctx.source_component_id[0]) {
        actuator_hal_set_by_component_id(s_ctx.source_component_id, false);
        actuator_hal_release_component(s_ctx.source_component_id, ACTUATOR_OWNER_TRANSFER);
    }
    if (s_ctx.destination_component_id[0]) {
        actuator_hal_set_by_component_id(s_ctx.destination_component_id, false);
        actuator_hal_release_component(s_ctx.destination_component_id, ACTUATOR_OWNER_TRANSFER);
    }
}

static void transfer_worker_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Transfer Manager task started.");
    
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        
        if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
            uint32_t current_tick = xTaskGetTickCount();
            bool e_stopped = actuator_hal_is_emergency_stopped();
            
            if (e_stopped && s_ctx.state != TRANSFER_STATE_IDLE && s_ctx.state != TRANSFER_STATE_ERROR) {
                turn_off_actuators();
                set_state(TRANSFER_STATE_ERROR);
                ESP_LOGW(TAG, "Transfer interrupted by Emergency Stop.");
            } else {
                switch (s_ctx.state) {
                    case TRANSFER_STATE_IDLE:
                    case TRANSFER_STATE_COMPLETE:
                    case TRANSFER_STATE_ERROR:
                        // Nothing to do.
                        break;
                        
                    case TRANSFER_STATE_TRANSFERRING:
                        if ((current_tick - s_ctx.start_tick) >= s_ctx.duration_ticks) {
                            ESP_LOGI(TAG, "Transfer duration reached. Moving to DRAINING.");
                            // Turn off source pump, leave dest_valve open if any
                            if (s_ctx.source_component_id[0]) {
                                actuator_hal_set_by_component_id(s_ctx.source_component_id, false);
                                actuator_hal_release_component(s_ctx.source_component_id, ACTUATOR_OWNER_TRANSFER);
                            }
                            s_ctx.draining_start_tick = current_tick;
                            set_state(TRANSFER_STATE_DRAINING);
                        } else {
                            // Check interlocks (e.g. float sensors if applicable)
                            // Generic float switch check could be added here based on configuration
                            // For Phase 1, we rely on time.
                        }
                        break;
                        
                    case TRANSFER_STATE_DRAINING:
                        if ((current_tick - s_ctx.draining_start_tick) >= pdMS_TO_TICKS(DRAINING_DURATION_SEC * 1000)) {
                            ESP_LOGI(TAG, "Draining complete. Transfer finished.");
                            turn_off_actuators();
                            set_state(TRANSFER_STATE_COMPLETE);
                        }
                        break;
                }
            }
            xSemaphoreGive(s_mutex);
        }
    }
}

esp_err_t transfer_mgr_init(void)
{
    if (s_mutex) return ESP_OK;
    s_mutex = xSemaphoreCreateMutex();
    
    s_ctx.state = TRANSFER_STATE_IDLE;
    s_ctx.source_component_id[0] = '\0';
    s_ctx.destination_component_id[0] = '\0';
    
    xTaskCreatePinnedToCore(transfer_worker_task, "transfer_mgr", 3072, NULL, 3, NULL, 1);
    return ESP_OK;
}

static bool role_contains(const char *role, const char *needle)
{
    return role && needle && strcasestr(role, needle) != NULL;
}

esp_err_t transfer_mgr_start(const char *source_component_id, const char *destination_component_id, uint32_t duration_sec)
{
    if (!source_component_id || !source_component_id[0] || !destination_component_id || !destination_component_id[0] || duration_sec == 0) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    if (s_ctx.state == TRANSFER_STATE_TRANSFERRING || s_ctx.state == TRANSFER_STATE_DRAINING) {
        xSemaphoreGive(s_mutex);
        ESP_LOGE(TAG, "Transfer already in progress.");
        return ESP_ERR_INVALID_STATE;
    }

    if (actuator_hal_is_emergency_stopped()) {
        xSemaphoreGive(s_mutex);
        ESP_LOGE(TAG, "Cannot start transfer: System is Emergency Stopped.");
        return ESP_ERR_INVALID_STATE;
    }

    hw_component_info_t source = {0};
    hw_component_info_t destination = {0};
    if (hardware_registry_find_by_id(source_component_id, &source) != ESP_OK ||
        hardware_registry_find_by_id(destination_component_id, &destination) != ESP_OK) {
        xSemaphoreGive(s_mutex);
        ESP_LOGW(TAG, "Transfer blocked: source/destination component is not registered.");
        return ESP_ERR_NOT_FOUND;
    }
    if (!role_contains(source.role, "PUMP") || !role_contains(destination.role, "VALVE")) {
        xSemaphoreGive(s_mutex);
        ESP_LOGW(TAG, "Transfer blocked: source '%s' must be a pump and destination '%s' must be a valve.", source.role, destination.role);
        return ESP_ERR_INVALID_ARG;
    }
    if (strcmp(source.assignment.complex_id, destination.assignment.complex_id) != 0) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }
    if (source.resource_id[0] == '\0' || destination.resource_id[0] == '\0') {
        xSemaphoreGive(s_mutex);
        ESP_LOGW(TAG, "Transfer blocked: both components must have resource IDs.");
        return ESP_ERR_INVALID_STATE;
    }
    if (strcmp(source_component_id, destination_component_id) == 0) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = actuator_hal_acquire_component(destination_component_id, ACTUATOR_OWNER_TRANSFER);
    if (err != ESP_OK) {
        xSemaphoreGive(s_mutex);
        return err;
    }
    err = actuator_hal_acquire_component(source_component_id, ACTUATOR_OWNER_TRANSFER);
    if (err != ESP_OK) {
        actuator_hal_release_component(destination_component_id, ACTUATOR_OWNER_TRANSFER);
        xSemaphoreGive(s_mutex);
        return err;
    }
    err = actuator_hal_set_by_component_id(destination_component_id, true);
    if (err != ESP_OK) {
        actuator_hal_release_component(source_component_id, ACTUATOR_OWNER_TRANSFER);
        actuator_hal_release_component(destination_component_id, ACTUATOR_OWNER_TRANSFER);
        xSemaphoreGive(s_mutex);
        return err;
    }
    err = actuator_hal_set_by_component_id(source_component_id, true);
    if (err != ESP_OK) {
        actuator_hal_set_by_component_id(destination_component_id, false);
        actuator_hal_release_component(source_component_id, ACTUATOR_OWNER_TRANSFER);
        actuator_hal_release_component(destination_component_id, ACTUATOR_OWNER_TRANSFER);
        xSemaphoreGive(s_mutex);
        return err;
    }

    strncpy(s_ctx.source_component_id, source_component_id, sizeof(s_ctx.source_component_id) - 1);
    s_ctx.source_component_id[sizeof(s_ctx.source_component_id) - 1] = '\0';
    strncpy(s_ctx.destination_component_id, destination_component_id, sizeof(s_ctx.destination_component_id) - 1);
    s_ctx.destination_component_id[sizeof(s_ctx.destination_component_id) - 1] = '\0';
    s_ctx.duration_ticks = pdMS_TO_TICKS(duration_sec * 1000);
    s_ctx.start_tick = xTaskGetTickCount();
    set_state(TRANSFER_STATE_TRANSFERRING);

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t transfer_mgr_stop(void)
{
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    
    if (s_ctx.state == TRANSFER_STATE_TRANSFERRING || s_ctx.state == TRANSFER_STATE_DRAINING) {
        turn_off_actuators();
        set_state(TRANSFER_STATE_ERROR);
        ESP_LOGI(TAG, "Transfer manually stopped.");
    }
    
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

transfer_state_t transfer_mgr_get_state(void)
{
    transfer_state_t st = TRANSFER_STATE_IDLE;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        st = s_ctx.state;
        xSemaphoreGive(s_mutex);
    }
    return st;
}
