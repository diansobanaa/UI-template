#include "services/scheduler.h"
#include "hal/actuator_hal.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "SCHEDULER";

static void scheduler_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Scheduler background task active.");

    while (1) {
        /* Periodically check scheduled windows (every 10 seconds) */
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}

esp_err_t scheduler_init(void)
{
    xTaskCreate(scheduler_task, "scheduler", 4096, NULL, 3, NULL);
    return ESP_OK;
}
