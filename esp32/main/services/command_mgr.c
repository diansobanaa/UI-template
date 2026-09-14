#include "services/command_mgr.h"
#include "hal/actuator_hal.h"
#include "config/system_config.h"
#include "config/pin_config.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <string.h>

static const char *TAG = "CMD_MGR";

#define IDEMPOTENCY_CACHE_SIZE 32

static command_item_t s_cache[IDEMPOTENCY_CACHE_SIZE];
static size_t s_cache_head = 0;
static size_t s_cache_count = 0;
static SemaphoreHandle_t s_cache_mutex = NULL;
static QueueHandle_t s_cmd_queue = NULL;

static void cache_insert(const command_item_t *cmd)
{
    s_cache[s_cache_head] = *cmd;
    s_cache_head = (s_cache_head + 1) % IDEMPOTENCY_CACHE_SIZE;
    if (s_cache_count < IDEMPOTENCY_CACHE_SIZE) {
        s_cache_count++;
    }
}

static command_item_t *cache_find(const char *cmd_id)
{
    for (size_t i = 0; i < s_cache_count; i++) {
        if (strcmp(s_cache[i].command_id, cmd_id) == 0) {
            return &s_cache[i];
        }
    }
    return NULL;
}

static void command_worker_task(void *pvParameters)
{
    command_item_t cmd;
    ESP_LOGI(TAG, "Command manager worker task started.");

    while (1) {
        if (xQueueReceive(s_cmd_queue, &cmd, portMAX_DELAY) == pdTRUE) {
            ESP_LOGI(TAG, "Executing command %s (type=%d)", cmd.command_id, cmd.type);

            xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
            command_item_t *cached = cache_find(cmd.command_id);
            bool cancelled = (cached && cached->status == CMD_STATUS_REJECTED);
            if (cached && !cancelled) {
                cached->status = CMD_STATUS_RUNNING;
            }
            xSemaphoreGive(s_cache_mutex);

            if (cancelled) {
                ESP_LOGI(TAG, "Command %s was cancelled in queue, skipping execution.", cmd.command_id);
                continue;
            }

            esp_err_t err = ESP_OK;

            switch (cmd.type) {
                case CMD_TYPE_EMERGENCY_STOP:
                    actuator_hal_emergency_stop();
                    snprintf(cmd.message, sizeof(cmd.message), "Emergency stop triggered");
                    break;

                case CMD_TYPE_RESUME:
                    actuator_hal_resume();
                    snprintf(cmd.message, sizeof(cmd.message), "System resumed");
                    break;

                case CMD_TYPE_WELL_PUMP:
                    err = actuator_hal_set(ACTUATOR_WELL_PUMP, cmd.param_duration_sec > 0);
                    if (err == ESP_OK && cmd.param_duration_sec > 0) {
                        for (int s = 0; s < cmd.param_duration_sec; s++) {
                            if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY || actuator_hal_is_emergency_stopped()) {
                                actuator_hal_set(ACTUATOR_WELL_PUMP, false);
                                err = ESP_ERR_INVALID_STATE;
                                ESP_LOGW(TAG, "Well pump run stopped: Lower float reached dry state.");
                                break;
                            }
                            vTaskDelay(pdMS_TO_TICKS(1000));
                        }
                        actuator_hal_set(ACTUATOR_WELL_PUMP, false);
                    }
                    snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Well pump run complete" : "Well pump command blocked or stopped by safety");
                    break;

                case CMD_TYPE_DIST_PUMP:
                    err = actuator_hal_set(ACTUATOR_DIST_PUMP, cmd.param_duration_sec > 0);
                    if (err == ESP_OK && cmd.param_duration_sec > 0) {
                        for (int s = 0; s < cmd.param_duration_sec; s++) {
                            if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY || actuator_hal_is_emergency_stopped()) {
                                actuator_hal_set(ACTUATOR_DIST_PUMP, false);
                                err = ESP_ERR_INVALID_STATE;
                                ESP_LOGW(TAG, "Distribution pump run STOPPED: Lower float reached minimum stop point.");
                                break;
                            }
                            vTaskDelay(pdMS_TO_TICKS(1000));
                        }
                        actuator_hal_set(ACTUATOR_DIST_PUMP, false);
                    }
                    snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Dist pump run complete" : "Dist pump command blocked or stopped by safety stop point");
                    break;

                case CMD_TYPE_DOSING_RUN:
                    actuator_hal_set(ACTUATOR_DOSING_A, true);
                    actuator_hal_set(ACTUATOR_DOSING_B, true);
                    vTaskDelay(pdMS_TO_TICKS(cmd.param_duration_sec > 0 ? cmd.param_duration_sec * 1000 : 2000));
                    actuator_hal_set(ACTUATOR_DOSING_A, false);
                    actuator_hal_set(ACTUATOR_DOSING_B, false);
                    snprintf(cmd.message, sizeof(cmd.message), "Dosing run complete");
                    break;

                default:
                    snprintf(cmd.message, sizeof(cmd.message), "Unknown command type");
                    err = ESP_ERR_NOT_SUPPORTED;
                    break;
            }

            cmd.status = (err == ESP_OK) ? CMD_STATUS_COMPLETED : CMD_STATUS_FAILED;

            xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
            cached = cache_find(cmd.command_id);
            if (cached) {
                cached->status = cmd.status;
                strncpy(cached->message, cmd.message, sizeof(cached->message) - 1);
            }
            xSemaphoreGive(s_cache_mutex);
        }
    }
}

esp_err_t command_mgr_init(void)
{
    if (s_cache_mutex) return ESP_OK;

    s_cache_mutex = xSemaphoreCreateMutex();
    s_cmd_queue = xQueueCreate(COMMAND_QUEUE_LENGTH, sizeof(command_item_t));
    if (!s_cmd_queue) {
        ESP_LOGE(TAG, "Failed to create command queue");
        return ESP_ERR_NO_MEM;
    }

    xTaskCreate(command_worker_task, "cmd_worker", TASK_COMMAND_MGR_STACK, NULL, TASK_COMMAND_MGR_PRIO, NULL);
    ESP_LOGI(TAG, "Command Manager initialized with idempotency queue.");

    return ESP_OK;
}

esp_err_t command_mgr_submit(const command_item_t *cmd, command_item_t *out_receipt)
{
    if (!cmd || !cmd->command_id[0]) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);

    /* Idempotency check: if command exists, return cached item */
    command_item_t *cached = cache_find(cmd->command_id);
    if (cached) {
        if (out_receipt) *out_receipt = *cached;
        xSemaphoreGive(s_cache_mutex);
        ESP_LOGI(TAG, "Idempotent hit for commandId='%s', returning status=%d", cmd->command_id, cached->status);
        return ESP_OK;
    }

    /* Insert as pending */
    command_item_t item = *cmd;
    item.status = CMD_STATUS_PENDING;
    item.submitted_at = esp_timer_get_time() / 1000ULL;
    cache_insert(&item);

    xSemaphoreGive(s_cache_mutex);

    /* Dispatch to FreeRTOS worker queue */
    if (xQueueSend(s_cmd_queue, &item, pdMS_TO_TICKS(50)) != pdTRUE) {
        ESP_LOGE(TAG, "Command queue full, dropped %s", item.command_id);
        return ESP_ERR_TIMEOUT;
    }

    if (out_receipt) *out_receipt = item;
    return ESP_OK;
}

esp_err_t command_mgr_get(const char *command_id, command_item_t *out_receipt)
{
    if (!command_id || !out_receipt) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
    command_item_t *cached = cache_find(command_id);
    if (!cached) {
        xSemaphoreGive(s_cache_mutex);
        return ESP_ERR_NOT_FOUND;
    }

    *out_receipt = *cached;
    xSemaphoreGive(s_cache_mutex);
    return ESP_OK;
}

esp_err_t command_mgr_cancel(const char *command_id)
{
    if (!command_id) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
    command_item_t *cached = cache_find(command_id);
    if (!cached) {
        xSemaphoreGive(s_cache_mutex);
        return ESP_ERR_NOT_FOUND;
    }

    if (cached->status == CMD_STATUS_PENDING || cached->status == CMD_STATUS_RUNNING) {
        cached->status = CMD_STATUS_REJECTED;
        strncpy(cached->message, "Command cancelled", sizeof(cached->message) - 1);
        ESP_LOGI(TAG, "Command %s cancelled", command_id);
        
        /* Stop actuators if it was a pump command */
        if (cached->type == CMD_TYPE_WELL_PUMP) {
            actuator_hal_set(ACTUATOR_WELL_PUMP, false);
        } else if (cached->type == CMD_TYPE_DIST_PUMP) {
            actuator_hal_set(ACTUATOR_DIST_PUMP, false);
        } else if (cached->type == CMD_TYPE_DOSING_RUN) {
            actuator_hal_set(ACTUATOR_DOSING_A, false);
            actuator_hal_set(ACTUATOR_DOSING_B, false);
        }
    }
    
    xSemaphoreGive(s_cache_mutex);
    return ESP_OK;
}
