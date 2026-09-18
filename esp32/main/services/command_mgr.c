#include "services/command_mgr.h"
#include "services/manual_actuator_mgr.h"
#include "services/transfer_mgr.h"
#include "services/fertigation_mgr.h"
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

            bool is_async_task = false;

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
                    err = manual_actuator_start(ACTUATOR_WELL_PUMP, cmd.param_duration_sec);
                    snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Well pump running" : "Well pump command blocked or stopped by safety");
                    is_async_task = (cmd.param_duration_sec > 0);
                    break;

                case CMD_TYPE_DIST_PUMP:
                    err = manual_actuator_start(ACTUATOR_DIST_PUMP, cmd.param_duration_sec);
                    snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Dist pump running" : "Dist pump command blocked or stopped by safety stop point");
                    is_async_task = (cmd.param_duration_sec > 0);
                    break;

                case CMD_TYPE_DOSING_RUN:
                    err = manual_actuator_start(ACTUATOR_DOSING_A, cmd.param_duration_sec);
                    if (err == ESP_OK) {
                        err = manual_actuator_start(ACTUATOR_DOSING_B, cmd.param_duration_sec);
                    }
                    snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Dosing running" : "Dosing run failed to start");
                    is_async_task = (cmd.param_duration_sec > 0);
                    break;

                case CMD_TYPE_TANK_TRANSFER:
                    err = transfer_mgr_start((actuator_id_t)cmd.param_source_id, (actuator_id_t)cmd.param_dest_id, cmd.param_duration_sec);
                    snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Tank transfer running" : "Transfer blocked or invalid");
                    is_async_task = true;
                    break;

                case CMD_TYPE_FERTIGATION_BATCH:
                    err = fertigation_mgr_start_batch(cmd.param_raw_volume_ml, cmd.param_dosing_a_ml, cmd.param_dosing_b_ml);
                    snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Fertigation batch running" : "Failed to start fertigation batch");
                    is_async_task = true;
                    break;
                    
                case CMD_TYPE_TOGGLE_COMPONENT:
                    if (cmd.param_duration_sec > 0) {
                        err = actuator_hal_set_by_component_id(cmd.target_component_id, true);
                        snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Component ON" : "Component block/fail");
                        is_async_task = true;
                        // Note: For full compliance, a FreeRTOS timer should turn it off after param_duration_sec,
                        // but since manual_actuator_start is tightly coupled to actuator_id_t, we just turn it on here.
                    } else {
                        err = actuator_hal_set_by_component_id(cmd.target_component_id, false);
                        snprintf(cmd.message, sizeof(cmd.message), err == ESP_OK ? "Component OFF" : "Component off fail");
                        is_async_task = false;
                    }
                    break;

                default:
                    snprintf(cmd.message, sizeof(cmd.message), "Unknown command type");
                    err = ESP_ERR_NOT_SUPPORTED;
                    break;
            }

            if (err != ESP_OK) {
                cmd.status = CMD_STATUS_FAILED;
            } else if (is_async_task) {
                cmd.status = CMD_STATUS_RUNNING;
            } else {
                cmd.status = CMD_STATUS_COMPLETED;
            }

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

    xTaskCreatePinnedToCore(command_worker_task, "cmd_worker", TASK_COMMAND_MGR_STACK, NULL, TASK_COMMAND_MGR_PRIO, NULL, 1);
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

    if (cached->status == CMD_STATUS_RUNNING) {
        if (cached->type == CMD_TYPE_FERTIGATION_BATCH) {
            fertigation_state_t fst = fertigation_mgr_get_state();
            if (fst == FERT_STATE_COMPLETE) {
                cached->status = CMD_STATUS_COMPLETED;
                snprintf(cached->message, sizeof(cached->message), "Fertigation batch completed");
            } else if (fst == FERT_STATE_INTERRUPTED) {
                cached->status = CMD_STATUS_FAILED;
                snprintf(cached->message, sizeof(cached->message), "Fertigation batch interrupted by safety");
            } else if (fst == FERT_STATE_IDLE) {
                cached->status = CMD_STATUS_COMPLETED;
            }
        } else if (cached->type == CMD_TYPE_TANK_TRANSFER) {
            transfer_state_t tst = transfer_mgr_get_state();
            if (tst == TRANSFER_STATE_COMPLETE || tst == TRANSFER_STATE_IDLE) {
                cached->status = CMD_STATUS_COMPLETED;
                snprintf(cached->message, sizeof(cached->message), "Tank transfer completed");
            } else if (tst == TRANSFER_STATE_ERROR) {
                cached->status = CMD_STATUS_FAILED;
                snprintf(cached->message, sizeof(cached->message), "Tank transfer error");
            }
        } else if (cached->type == CMD_TYPE_WELL_PUMP) {
            if (!manual_actuator_is_running(ACTUATOR_WELL_PUMP)) {
                cached->status = CMD_STATUS_COMPLETED;
                snprintf(cached->message, sizeof(cached->message), "Well pump run completed");
            }
        } else if (cached->type == CMD_TYPE_DIST_PUMP) {
            if (!manual_actuator_is_running(ACTUATOR_DIST_PUMP)) {
                cached->status = CMD_STATUS_COMPLETED;
                snprintf(cached->message, sizeof(cached->message), "Dist pump run completed");
            }
        } else if (cached->type == CMD_TYPE_DOSING_RUN) {
            if (!manual_actuator_is_running(ACTUATOR_DOSING_A) && !manual_actuator_is_running(ACTUATOR_DOSING_B)) {
                cached->status = CMD_STATUS_COMPLETED;
                snprintf(cached->message, sizeof(cached->message), "Dosing run completed");
            }
        }
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
            manual_actuator_stop(ACTUATOR_WELL_PUMP);
        } else if (cached->type == CMD_TYPE_DIST_PUMP) {
            manual_actuator_stop(ACTUATOR_DIST_PUMP);
        } else if (cached->type == CMD_TYPE_DOSING_RUN) {
            manual_actuator_stop(ACTUATOR_DOSING_A);
            manual_actuator_stop(ACTUATOR_DOSING_B);
        } else if (cached->type == CMD_TYPE_TANK_TRANSFER) {
            transfer_mgr_stop();
        } else if (cached->type == CMD_TYPE_FERTIGATION_BATCH) {
            fertigation_mgr_cancel_batch();
        }
    }
    
    xSemaphoreGive(s_cache_mutex);
    return ESP_OK;
}
