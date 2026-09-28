#include "driver/gpio.h"
#include "esp_chip_info.h"
#include "esp_event.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "utils/psram_task.h"
#include <stdio.h>
#include <string.h>

#include "config/pin_config.h"
#include "config/system_config.h"
#include "hal/hardware_registry.h"
#include "hal/rtc_ds3231.h"
#include "hal/sdcard_hal.h"
#include "hal/tft_hal.h"
#include "http/http_server.h"
#include "network/network_mgr.h"
#include "services/calibration_mgr.h"
#include "services/command_mgr.h"
#include "services/crop_cycle_mgr.h"
#include "services/event_mgr.h"
#include "services/fertigation_mgr.h"
#include "services/manual_actuator_mgr.h"
#include "services/offline_sync_mgr.h"
#include "services/panel_button_mgr.h"
#include "services/safety_monitor.h"
#include "services/scheduler.h"
#include "services/telemetry_mgr.h"
#include "services/topology_pool.h"
#include "services/transfer_mgr.h"
#include "storage/recipe_storage.h"
#include "storage/storage_mgr.h"

static const char *TAG = "AGROTECH_MAIN";

/**
 * @brief Enforce immediate fail-safe state on all actuator GPIO outputs.
 *
 * This function executes BEFORE any network, storage, or runtime tasks start.
 * Ensures that reboot, brownout recovery, or crash cannot leave pumps or fans
 * ON.
 */
static void safe_boot_actuators(void) {
  ESP_LOGI(TAG,
           "Executing safe boot: initializing all outputs to OFF state...");

  const gpio_num_t output_pins[] = {
      PIN_OUT_WELL_PUMP,  PIN_OUT_DIST_PUMP,   PIN_OUT_RAW_SUBMERSIBLE,
      PIN_OUT_DOSING_A,   PIN_OUT_DOSING_B,    PIN_OUT_COOLING_FAN,
      PIN_OUT_BLOWER_FAN, PIN_OUT_MIXING_PUMP,
      PIN_OUT_BUZZER, // P0-FIX: Buzzer (GPIO 18, active-HIGH) was missing —
                      // false trigger during boot
      PIN_OUT_ERROR_LAMP // -1 = unmapped, gpio_config skips pins < 0
  };

  gpio_config_t io_conf = {
      .mode = GPIO_MODE_OUTPUT,
      .pull_up_en =
          (ACTUATOR_LEVEL_OFF == 1) ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
      .pull_down_en = (ACTUATOR_LEVEL_OFF == 0) ? GPIO_PULLDOWN_ENABLE
                                                : GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
      .pin_bit_mask = 0};

  for (size_t i = 0; i < sizeof(output_pins) / sizeof(output_pins[0]); ++i) {
    if (output_pins[i] < 0)
      continue;
    /* P0-FIX: Buzzer is active-HIGH (BUZZER_ACTIVE_LEVEL=1), so OFF=0 (LOW).
     * All other actuators are active-LOW (ACTUATOR_ACTIVE_LEVEL=0), so OFF=1
     * (HIGH). Set the correct OFF level per pin before configuring as output.
     */
    int off_level;
    if (output_pins[i] == PIN_OUT_BUZZER) {
      off_level = 0; /* Buzzer OFF = LOW (active-HIGH device) */
    } else {
      off_level =
          ACTUATOR_LEVEL_OFF; /* Standard relay OFF = HIGH (active-LOW) */
    }
    gpio_set_level(output_pins[i], off_level);
    io_conf.pin_bit_mask |= (1ULL << output_pins[i]);
  }

  esp_err_t err = gpio_config(&io_conf);
  if (err == ESP_OK) {
    ESP_LOGI(TAG, "Safe boot complete: mapped actuator channels locked in "
                  "safe-off state.");
  } else {
    ESP_LOGE(TAG,
             "CRITICAL: Failed to configure actuator safe GPIOs (err=0x%x)",
             err);
  }
}

/**
 * @brief Initialize Non-Volatile Storage (NVS).
 */
static esp_err_t init_nvs(void) {
  esp_err_t ret = nvs_flash_init();
  if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
      ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_LOGW(TAG,
             "NVS partition truncated or reformatted. Erasing and retrying...");
    ESP_ERROR_CHECK(nvs_flash_erase());
    ret = nvs_flash_init();
  }
  return ret;
}

/**
 * @brief Print chip hardware diagnostics and memory status.
 */
static void print_system_diagnostics(void) {
  esp_chip_info_t chip_info;
  esp_chip_info(&chip_info);

  uint32_t flash_size = 0;
  esp_flash_get_size(NULL, &flash_size);

  ESP_LOGI(TAG, "==================================================");
  ESP_LOGI(TAG, " %s v%s", FIRMWARE_NAME, FIRMWARE_VERSION);
  ESP_LOGI(TAG, " Target Hardware : %s", HARDWARE_MODEL);
  ESP_LOGI(TAG, " Contract Spec   : %s", CONTRACT_VERSION);
  ESP_LOGI(TAG, " Cores           : %d (rev %d)", chip_info.cores,
           chip_info.revision);
  ESP_LOGI(TAG, " Flash Size      : %lu MB",
           (unsigned long)(flash_size / (1024 * 1024)));
  ESP_LOGI(TAG, " Free Heap       : %lu bytes",
           (unsigned long)esp_get_free_heap_size());
  ESP_LOGI(TAG, " Min Free Heap   : %lu bytes",
           (unsigned long)esp_get_minimum_free_heap_size());
  ESP_LOGI(TAG, "==================================================");
}

/* BUILD-FIX: Forward declaration for diagnostics_task — called in app_main
 * before its definition. Without this, compiler warns about implicit
 * declaration and the function may not be linked correctly. */
static void diagnostics_task(void *arg);

void app_main(void) {
  /* 0. Extinguish onboard WS2812 RGB LED (flash) on GPIO 48 immediately at boot
   */
  sdcard_hal_clear_onboard_led();

  /* 1. Safe boot first — outputs locked to safe OFF immediately */
  safe_boot_actuators();

  /* RC-7: Initialize Task Watchdog with 10s timeout (vs IDF default 5s).
   * This gives headroom for legitimate NVS/SD operations while still
   * catching true deadlocks. Critical tasks will register themselves
   * via esp_task_wdt_add(NULL) in their loops.
   *
   * BUILD-FIX: ESP-IDF 5.5.5 changed esp_task_wdt_init() to accept
   * esp_task_wdt_config_t* instead of (timeout, panic) two-arg form.
   * Use esp_task_wdt_reconfigure() which works on both fresh init and
   * already-initialized TWDT (IDF starts TWDT by default via menuconfig). */
  esp_task_wdt_config_t wdt_config = {
      .timeout_ms = 10000,
      .idle_core_mask =
          (1 << portNUM_PROCESSORS) - 1, /* watch IDLE on all cores */
      .trigger_panic = true,
  };
  esp_err_t wdt_err = esp_task_wdt_reconfigure(&wdt_config);
  if (wdt_err == ESP_OK) {
    ESP_LOGI(TAG, "Task Watchdog reconfigured (10s timeout, panic on trigger)");
  } else {
    ESP_LOGW(
        TAG,
        "Task Watchdog reconfigure failed (0x%x) — using IDF default config",
        wdt_err);
  }

  /* RC-7: Log reset reason immediately for post-mortem diagnostics.
   * This appears in serial output before any other subsystem logs,
   * making it easy to identify crash patterns. */
  esp_reset_reason_t rr = esp_reset_reason();
  const char *rr_str = "UNKNOWN";
  switch (rr) {
  case ESP_RST_POWERON:
    rr_str = "POWERON";
    break;
  case ESP_RST_EXT:
    rr_str = "EXTERNAL";
    break;
  case ESP_RST_SW:
    rr_str = "SOFTWARE_RESET";
    break;
  case ESP_RST_PANIC:
    rr_str = "PANIC/GURU_MEDITATION";
    break;
  case ESP_RST_INT_WDT:
    rr_str = "INT_WATCHDOG";
    break;
  case ESP_RST_TASK_WDT:
    rr_str = "TASK_WATCHDOG";
    break;
  case ESP_RST_WDT:
    rr_str = "WATCHDOG";
    break;
  case ESP_RST_BROWNOUT:
    rr_str = "BROWNOUT";
    break;
  case ESP_RST_SDIO:
    rr_str = "SDIO";
    break;
  default:
    break;
  }
  ESP_LOGI(TAG, "=== Boot reset reason: %s (0x%x) ===", rr_str, (int)rr);

  /* 2. Print boot banner and diagnostics */
  print_system_diagnostics();

  /* 3. Initialize core system services */
  ESP_ERROR_CHECK(init_nvs());
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_log_level_set("wifi", ESP_LOG_WARN);

  /* HEAP-FIX: WiFi init must happen EARLY — before heavy subsystem tasks
   * consume internal RAM. WiFi driver needs ~30KB internal RAM for static
   * RX buffers + LWIP structures. If WiFi init is last (after 18 tasks
   * consuming 66KB stack), internal heap is exhausted → ESP_ERR_NO_MEM
   * → abort() → restart loop.
   *
   * New init order: NVS → netif → event_loop → storage → WiFi → HAL →
   * runtime services → TFT → HTTP server.
   *
   * WiFi failure is handled gracefully (no ESP_ERROR_CHECK) — system
   * continues in offline mode with all actuators safe. */
  ESP_LOGI(TAG, "[HEAP] before storage_mgr_init: internal=%u, largest=%u",
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));

  ESP_ERROR_CHECK(storage_mgr_init());

  ESP_LOGI(TAG, "[HEAP] before WiFi init: internal=%u, largest=%u",
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));

  /* HEAP-FIX: Initialize WiFi EARLY — before task-heavy subsystems.
   * WiFi driver allocates ~30KB internal RAM for static RX buffers.
   * If we wait until after all 18 tasks are created (66KB stack),
   * internal heap is exhausted → wifi_nvs_load: no mem → ESP_ERR_NO_MEM.
   *
   * Graceful failure: if WiFi init fails, system continues in offline mode.
   * All actuators remain in safe-off state. Scheduler and fertigation
   * continue operating locally. HTTP server still starts (accessible
   * via direct IP if SoftAP is up, or via later WiFi recovery). */
  esp_err_t wifi_err = network_mgr_init();
  if (wifi_err != ESP_OK) {
    ESP_LOGE(TAG, "WiFi init FAILED (0x%x) — continuing in OFFLINE MODE.",
             wifi_err);
    ESP_LOGE(TAG, "All actuators remain safe-off. Local scheduler/fertigation "
                  "still active.");
    ESP_LOGE(
        TAG,
        "WiFi will retry via reconnect_task if it was partially initialized.");
    (void)event_mgr_log(LOG_LEVEL_WARNING, "NETWORK", "WIFI_INIT_FAILED",
                        "WiFi initialization failed — operating in offline "
                        "mode. All actuators remain safe.",
                        NULL);
    /* Do NOT abort — continue boot in offline mode */
  } else {
    ESP_LOGI(TAG, "WiFi initialized successfully.");
  }

  ESP_LOGI(TAG, "[HEAP] after WiFi init: internal=%u, largest=%u",
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));

  /* 4. Initialize Hardware Abstraction Layer (SP-003) */
  ESP_ERROR_CHECK(hardware_hal_init_all());
  sdcard_hal_init();
  recipe_storage_init();
  setenv("TZ", "WIB-7", 1);
  tzset();
  rtc_ds3231_init();
  rtc_ds3231_sync_to_system();

  /* 5. Initialize Runtime Services & Safety (SP-006) */
  ESP_ERROR_CHECK(event_mgr_init());
  switch (esp_reset_reason()) {
  case ESP_RST_BROWNOUT:
    (void)event_mgr_log(LOG_LEVEL_CRITICAL, "POWER", "POWER_FAILURE",
                        "Boot was caused by brownout/power interruption.",
                        NULL);
    (void)event_mgr_log(LOG_LEVEL_INFO, "POWER", "POWER_RESTORED",
                        "Controller restarted after power interruption and "
                        "outputs remain fail-safe.",
                        NULL);
    break;
#ifdef ESP_RST_INT_WDT
  case ESP_RST_INT_WDT:
    (void)event_mgr_log(LOG_LEVEL_CRITICAL, "SYSTEM", "WATCHDOG_RESET",
                        "Boot was caused by interrupt watchdog reset.", NULL);
    break;
#endif
#ifdef ESP_RST_TASK_WDT
  case ESP_RST_TASK_WDT:
    (void)event_mgr_log(LOG_LEVEL_CRITICAL, "SYSTEM", "WATCHDOG_RESET",
                        "Boot was caused by task watchdog reset.", NULL);
    break;
#endif
#ifdef ESP_RST_WDT
  case ESP_RST_WDT:
    (void)event_mgr_log(LOG_LEVEL_CRITICAL, "SYSTEM", "WATCHDOG_RESET",
                        "Boot was caused by watchdog reset.", NULL);
    break;
#endif
#ifdef ESP_RST_PANIC
  case ESP_RST_PANIC:
    (void)event_mgr_log(LOG_LEVEL_CRITICAL, "SYSTEM", "ABNORMAL_RESET",
                        "Boot followed a panic/abnormal reset.", NULL);
    break;
#endif
  default:
    break;
  }

  ESP_LOGI(TAG, "[HEAP] before runtime tasks: internal=%u, largest=%u",
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));

  ESP_ERROR_CHECK(command_mgr_init());
  ESP_ERROR_CHECK(manual_actuator_mgr_init());
  ESP_ERROR_CHECK(transfer_mgr_init());
  ESP_ERROR_CHECK(calibration_mgr_init());
  ESP_ERROR_CHECK(safety_monitor_init());
  ESP_ERROR_CHECK(scheduler_init());
  ESP_ERROR_CHECK(panel_button_mgr_init());
  ESP_ERROR_CHECK(fertigation_mgr_init());

  ESP_LOGI(TAG, "[HEAP] after runtime tasks: internal=%u, largest=%u",
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));

  ESP_ERROR_CHECK(storage_mgr_set_safe_boot_active(false));
  ESP_LOGI(TAG, "Safe boot active flag cleared in storage.");

  ESP_ERROR_CHECK(crop_cycle_mgr_init());
  ESP_ERROR_CHECK(telemetry_mgr_init());
  ESP_ERROR_CHECK(offline_sync_mgr_init());
  ESP_ERROR_CHECK(topology_pool_init());

  ESP_LOGI(TAG, "[HEAP] before HTTP server: internal=%u, largest=%u",
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));

  /* HEAP-FIX: Start HTTP server BEFORE TFT — HTTP server needs ~5KB internal
   * RAM for task stack. TFT task (5KB) consumes internal RAM that HTTP needs.
   * HTTP server is more critical for remote access than local TFT display.
   * TFT init moved to AFTER HTTP server. */
  esp_err_t http_err = http_server_start();
  if (http_err != ESP_OK) {
    ESP_LOGW(TAG,
             "HTTP server start failed (0x%x) — continuing without REST API.",
             http_err);
  } else {
    ESP_LOGI(TAG, "HTTP server started.");
  }

  /* TFT init AFTER HTTP server — TFT is lowest priority for internal RAM. */
  if (tft_hal_init() == ESP_OK && tft_hal_is_available()) {
    tft_show_screen(TFT_SCREEN_HOME);
  } else {
    ESP_LOGW(TAG, "TFT ST7735 not present or unattached. Operating in degraded "
                  "headless mode.");
  }

  ESP_LOGI(TAG, "[HEAP] final: internal=%u, largest=%u, PSRAM=%u",
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));

  ESP_LOGI(TAG, "AgroTech ESP32-S3 Backend initialized. WiFi: %s",
           (wifi_err == ESP_OK) ? "ONLINE" : "OFFLINE MODE");

  /* RC-7: Spawn a lightweight diagnostics task that logs heap stats + stack
   * high-water marks every 60 seconds. This helps identify memory leaks,
   * heap fragmentation, and stack exhaustion patterns over time.
   * Stack 3072, prio 1 (lowest non-idle), core 0 (to not compete with
   * safety/scheduler on core 1). */
  psram_task_create_pinned(diagnostics_task, "diag_task", 3072, NULL, 1, NULL,
                           0);
}

/**
 * @brief Periodic diagnostics task — logs heap + stack stats every 60s.
 *
 * RC-7: This task provides runtime visibility into:
 *   - Free internal heap + largest free block (fragmentation indicator)
 *   - Free PSRAM
 *   - Minimum free heap since boot
 *   - Heap integrity check
 *
 * Output appears in serial log as:
 *   I (60000) AGROTECH_MAIN: [DIAG] heap: internal=123456 free, largest=98765;
 *       PSRAM=7654321 free; min_free=110000; integrity=OK
 */
static void diagnostics_task(void *arg) {
  (void)arg;
  /* WDT-FIX: Do NOT register diagnostics_task to Task WDT.
   * This task sleeps 60s between checks. WDT timeout is 10s.
   * Registering would cause false WDT panic every 10s → restart loop.
   * Diagnostics is non-critical — if it hangs, system should NOT restart.
   * Only safety-critical tasks (scheduler, safety_monitor, fertigation,
   * command_worker, telemetry) are WDT-registered. */
  while (1) {
    vTaskDelay(pdMS_TO_TICKS(60000)); /* 60 second interval */

    uint32_t free_internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    uint32_t largest_internal =
        heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    uint32_t free_psram = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
    uint32_t min_free = esp_get_minimum_free_heap_size();
    bool integrity = heap_caps_check_integrity_all(true);

    ESP_LOGI(TAG,
             "[DIAG] heap: internal=%u free, largest=%u; PSRAM=%u free; "
             "min_free=%u; integrity=%s",
             (unsigned)free_internal, (unsigned)largest_internal,
             (unsigned)free_psram, (unsigned)min_free,
             integrity ? "OK" : "CORRUPT");

    /* Warn if internal heap fragmentation is severe (>40% fragmentation) */
    if (free_internal > 0 && largest_internal < (free_internal * 6 / 10)) {
      ESP_LOGW(
          TAG,
          "[DIAG] Internal heap fragmented: largest block %u < 60%% of free %u",
          (unsigned)largest_internal, (unsigned)free_internal);
    }
    /* Warn if internal heap is low (<30KB) */
    if (free_internal < 30000) {
      ESP_LOGW(TAG, "[DIAG] Internal heap LOW: %u bytes free (<30KB threshold)",
               (unsigned)free_internal);
    }
  }
}
