#pragma once

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Create a FreeRTOS task with its stack in PSRAM (frees internal heap).
 *
 * The task stack is allocated from PSRAM via heap_caps (MALLOC_CAP_SPIRAM);
 * the TCB stays in internal RAM (scheduler touches it from ISR context).
 * Requires CONFIG_FREERTOS_TASK_CREATE_ALLOW_EXT_MEM=y (already set in
 * sdkconfig.defaults) so the FreeRTOS stack-placement check accepts PSRAM.
 *
 * SAFETY — READ BEFORE USE:
 * Only tasks that NEVER write to internal flash (NVS / SPIFFS / OTA) may use
 * this helper. During a flash write/erase the data cache is disabled and PSRAM
 * becomes inaccessible; a task whose stack lives in PSRAM would crash the
 * moment it touches its own stack inside that window. SD-card I/O (separate
 * SPI bus) and flash READS are fine.
 *
 * Verified safe (2026-09-28, by call-graph inspection of each task loop):
 *   - tft_screen_task      (tft_hal.c)            5120 B
 *   - tele_stream_task     (api_telemetry_handlers.c) 4096 B
 *   - diag_task            (main.c)               3072 B
 *   - telem_store_tsk      (telemetry_store.c)    4096 B  (SD-card paths only)
 *   - transfer_mgr         (transfer_mgr.c)       3072 B
 *   - well_pump_mon        (well_pump_mgr.c)      3072 B
 *   - offline_sync         (offline_sync_mgr.c)   4096 B
 *   - panel_btn_worker     (panel_button_mgr.c)   8192 B
 * Deliberately NOT converted (they write NVS/SPIFFS in their core loop):
 *   telemetry_task (NVS sequence block), tele_persist_task (SPIFFS event log),
 *   safety_mon (NVS estop latch), scheduler + mk_persist (NVS), calib_mgr (NVS),
 *   cmd_worker (NVS estop via commands), fert_mgr (NVS), btn_poll_task (internal RAM polling).
 *
 * If the PSRAM allocation fails, falls back to plain xTaskCreatePinnedToCore
 * (internal RAM) so the system still boots.
 *
 * @param task_func   Task entry function (must be an infinite loop; the PSRAM
 *                    stack/TCB are never freed, so do not vTaskDelete it).
 * @param name        Task name for diagnostics.
 * @param stack_bytes Stack size in BYTES (same unit as xTaskCreate in this firmware).
 * @param param       Task parameter.
 * @param prio        FreeRTOS priority.
 * @param out_handle  Optional output for the task handle (may be NULL).
 * @param core_id     Core to pin to (0 or 1).
 * @return Task handle, or NULL if creation failed.
 */
TaskHandle_t psram_task_create_pinned(TaskFunction_t task_func,
                                      const char *name,
                                      uint32_t stack_bytes,
                                      void *param,
                                      UBaseType_t prio,
                                      TaskHandle_t *out_handle,
                                      BaseType_t core_id);

#ifdef __cplusplus
}
#endif
