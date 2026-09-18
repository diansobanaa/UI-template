#include "services/scheduler.h"
#include "services/command_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "nvs_flash.h"
#include "nvs.h"
#include <string.h>
#include <time.h>
#include <sys/time.h>

static const char *TAG = "SCHEDULER";

#define MAX_SCHEDULES 16
#define NVS_NAMESPACE "agrotech"
#define NVS_KEY_SCHED "schedules"

static schedule_entry_t s_schedules[MAX_SCHEDULES];
static size_t s_schedule_count = 0;
static SemaphoreHandle_t s_mutex = NULL;

static esp_err_t load_schedules_from_nvs(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) return err;
    
    size_t length = 0;
    err = nvs_get_blob(handle, NVS_KEY_SCHED, NULL, &length);
    if (err == ESP_OK && length > 0 && length <= sizeof(s_schedules)) {
        err = nvs_get_blob(handle, NVS_KEY_SCHED, s_schedules, &length);
        if (err == ESP_OK) {
            s_schedule_count = length / sizeof(schedule_entry_t);
        }
    }
    nvs_close(handle);
    return err;
}

static esp_err_t save_schedules_to_nvs(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;
    
    err = nvs_set_blob(handle, NVS_KEY_SCHED, s_schedules, s_schedule_count * sizeof(schedule_entry_t));
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);
    return err;
}

esp_err_t scheduler_add_entry(const schedule_entry_t *entry)
{
    if (!entry) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    
    int existing_idx = -1;
    for (size_t i = 0; i < s_schedule_count; i++) {
        if (strcmp(s_schedules[i].id, entry->id) == 0) {
            existing_idx = i;
            break;
        }
    }
    
    if (existing_idx >= 0) {
        // Update, keeping runtime state
        uint32_t last_exec = s_schedules[existing_idx].last_execution_timestamp;
        bool is_run = s_schedules[existing_idx].is_running;
        char cmd_id[40];
        strncpy(cmd_id, s_schedules[existing_idx].current_command_id, sizeof(cmd_id));
        
        s_schedules[existing_idx] = *entry;
        
        s_schedules[existing_idx].last_execution_timestamp = last_exec;
        s_schedules[existing_idx].is_running = is_run;
        strncpy(s_schedules[existing_idx].current_command_id, cmd_id, sizeof(s_schedules[existing_idx].current_command_id));
    } else {
        if (s_schedule_count >= MAX_SCHEDULES) {
            xSemaphoreGive(s_mutex);
            return ESP_ERR_NO_MEM;
        }
        s_schedules[s_schedule_count] = *entry;
        s_schedules[s_schedule_count].last_execution_timestamp = 0;
        s_schedules[s_schedule_count].is_running = false;
        s_schedules[s_schedule_count].current_command_id[0] = '\0';
        s_schedule_count++;
    }
    
    esp_err_t err = save_schedules_to_nvs();
    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t scheduler_remove_entry(const char *id)
{
    if (!id) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    
    int existing_idx = -1;
    for (size_t i = 0; i < s_schedule_count; i++) {
        if (strcmp(s_schedules[i].id, id) == 0) {
            existing_idx = i;
            break;
        }
    }
    
    if (existing_idx >= 0) {
        if (s_schedules[existing_idx].is_running) {
            command_mgr_cancel(s_schedules[existing_idx].current_command_id);
        }
        for (size_t i = existing_idx; i < s_schedule_count - 1; i++) {
            s_schedules[i] = s_schedules[i + 1];
        }
        s_schedule_count--;
        save_schedules_to_nvs();
    }
    
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t scheduler_get_all(schedule_entry_t *out_entries, size_t max_entries, size_t *out_count)
{
    if (!out_entries || !out_count) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    
    size_t count = (s_schedule_count < max_entries) ? s_schedule_count : max_entries;
    memcpy(out_entries, s_schedules, count * sizeof(schedule_entry_t));
    *out_count = count;
    
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t scheduler_clear_all(void)
{
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    for (size_t i = 0; i < s_schedule_count; i++) {
        if (s_schedules[i].is_running) {
            command_mgr_cancel(s_schedules[i].current_command_id);
        }
    }
    s_schedule_count = 0;
    save_schedules_to_nvs();
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

static void dispatch_schedule(schedule_entry_t *sched, time_t now)
{
    command_item_t cmd = {0};
    snprintf(cmd.command_id, sizeof(cmd.command_id), "sched-%s-%ld", sched->id, (long)now);
    
    if (sched->action == SCHED_ACTION_FERTIGATION) {
        cmd.type = CMD_TYPE_DOSING_RUN;
    } else if (sched->action == SCHED_ACTION_WATER_PUMP) {
        cmd.type = CMD_TYPE_WELL_PUMP;
    } else {
        cmd.type = CMD_TYPE_CUSTOM; // simplified for Phase 1
    }
    
    strncpy(cmd.target_gh_id, sched->target_gh_id, sizeof(cmd.target_gh_id) - 1);
    cmd.param_duration_sec = sched->duration_sec;
    cmd.status = CMD_STATUS_PENDING;
    cmd.submitted_at = now;
    
    command_item_t receipt;
    esp_err_t err = command_mgr_submit(&cmd, &receipt);
    if (err == ESP_OK) {
        sched->last_execution_timestamp = now;
        sched->is_running = true;
        strncpy(sched->current_command_id, receipt.command_id, sizeof(sched->current_command_id));
        ESP_LOGI(TAG, "Dispatched schedule %s -> command %s", sched->id, receipt.command_id);
    }
}

static void scheduler_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Scheduler background task active. Interval: 60s");

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(60000)); // Evaluate every 1 minute
        
        if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
            time_t now;
            time(&now);
            struct tm timeinfo;
            localtime_r(&now, &timeinfo);
            
            // Wait for time to be synchronized (e.g. year > 2020)
            if (timeinfo.tm_year < 120) {
                xSemaphoreGive(s_mutex);
                continue;
            }
            
            for (size_t i = 0; i < s_schedule_count; i++) {
                schedule_entry_t *sched = &s_schedules[i];
                if (!sched->enabled) continue;
                
                // Idempotency / running check
                if (sched->is_running) {
                    command_item_t receipt;
                    if (command_mgr_get(sched->current_command_id, &receipt) == ESP_OK) {
                        if (receipt.status == CMD_STATUS_COMPLETED || receipt.status == CMD_STATUS_FAILED || receipt.status == CMD_STATUS_REJECTED) {
                            sched->is_running = false; // finished
                        }
                    } else {
                        sched->is_running = false; // not found, assume finished/cleared
                    }
                    if (sched->is_running) continue; // still running, skip
                }
                
                bool due = false;
                if (sched->type == SCHED_TYPE_DAILY) {
                    // Check day of week
                    uint8_t today_bit = 1 << timeinfo.tm_wday;
                    if ((sched->days_of_week & today_bit) != 0) {
                        // Check time (minute resolution)
                        if (timeinfo.tm_hour == sched->hour && timeinfo.tm_min == sched->minute) {
                            // Check if already executed today to prevent duplicates
                            if (now - sched->last_execution_timestamp > 60) {
                                due = true;
                            }
                        }
                    }
                } else if (sched->type == SCHED_TYPE_INTERVAL) {
                    if (sched->last_execution_timestamp == 0) {
                        due = true;
                    } else if (now - sched->last_execution_timestamp >= (sched->interval_min * 60)) {
                        due = true;
                    }
                }
                
                if (due) {
                    dispatch_schedule(sched, now);
                }
            }
            
            xSemaphoreGive(s_mutex);
        }
    }
}

esp_err_t scheduler_init(void)
{
    s_mutex = xSemaphoreCreateMutex();
    if (!s_mutex) return ESP_ERR_NO_MEM;
    
    esp_err_t err = load_schedules_from_nvs();
    if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGE(TAG, "Failed to load schedules from NVS: %s", esp_err_to_name(err));
    }
    
    // Reset volatile state on boot
    for (size_t i = 0; i < s_schedule_count; i++) {
        s_schedules[i].is_running = false;
        s_schedules[i].current_command_id[0] = '\0';
    }
    
    xTaskCreatePinnedToCore(scheduler_task, "scheduler", 4096, NULL, 3, NULL, 1);
    return ESP_OK;
}
