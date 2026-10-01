#include "utils/psram_task.h"

#include "esp_heap_caps.h"
#include "esp_log.h"

static const char *TAG = "PSRAM_TASK";

TaskHandle_t psram_task_create_pinned(TaskFunction_t task_func,
                                      const char *name,
                                      uint32_t stack_bytes,
                                      void *param,
                                      UBaseType_t prio,
                                      TaskHandle_t *out_handle,
                                      BaseType_t core_id)
{
    TaskHandle_t handle = NULL;

    if (task_func && name && stack_bytes > 0) {
        /* xTaskCreateStaticPinnedToCore takes the depth in WORDS; this firmware
         * expresses xTaskCreate sizes in BYTES, so convert. */
        const size_t stack_words =
            (stack_bytes + sizeof(StackType_t) - 1U) / sizeof(StackType_t);

        StackType_t *stack_buf = (StackType_t *)heap_caps_malloc(
            stack_words * sizeof(StackType_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        /* TCB deliberately stays in internal RAM: the scheduler touches it
         * from ISR context, where PSRAM access is not guaranteed. ~104 B. */
        StaticTask_t *tcb_buf = (StaticTask_t *)heap_caps_malloc(
            sizeof(StaticTask_t), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);

        if (stack_buf && tcb_buf) {
            handle = xTaskCreateStaticPinnedToCore(task_func, name,
                                                   (uint32_t)stack_words,
                                                   param, prio,
                                                   stack_buf, tcb_buf, core_id);
        }
        if (handle) {
            ESP_LOGI(TAG, "task '%s': %u B stack -> PSRAM (TCB internal)",
                     name, (unsigned)stack_bytes);
        } else {
            /* Either the PSRAM allocation failed or the static create failed:
             * release partial allocations before falling back. */
            if (stack_buf) heap_caps_free(stack_buf);
            if (tcb_buf) heap_caps_free(tcb_buf);
            stack_buf = NULL;
            tcb_buf = NULL;
            ESP_LOGW(TAG, "task '%s': PSRAM stack unavailable, falling back to internal RAM",
                     name);
            if (xTaskCreatePinnedToCore(task_func, name, stack_bytes, param,
                                        prio, &handle, core_id) != pdPASS) {
                handle = NULL;
                ESP_LOGE(TAG, "task '%s': creation FAILED entirely", name);
            }
        }
    }

    if (out_handle) *out_handle = handle;
    return handle;
}
