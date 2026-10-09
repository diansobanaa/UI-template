#include "services/scheduler.h"
#include "cJSON.h"
#include "config/system_config.h"
#include "esp_attr.h"
#include "esp_log.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "hal/sensor_hal.h"
#include "nvs.h"
#include "services/command_mgr.h"
#include "services/event_mgr.h"
#include "services/safety_monitor.h"
#include "services/topology_capability.h"
#include "services/fertigation_mgr.h"
#include "services/well_pump_mgr.h"
#include "storage/storage_mgr.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>

static const char *TAG = "SCHEDULER";

#define MAX_COMPILED_SCHEDULES 32
#define MAX_RUNTIME_COMPONENTS 16
#define MAX_RUNTIME_RESOURCES 16
#define MAX_COMPILED_JSON 12288
#define NVS_NAMESPACE "agrotech"
#define NVS_KEY_COMPILED "compiled_sched"
#define NVS_KEY_MARKERS "sched_marks"
#define SPIFFS_SCHEDULE_INTENTS_FILE "/spiffs/sched_intents.json"
#define SPIFFS_SCHEDULE_MARKERS_FILE "/spiffs/sched_markers.bin"
#define SCHEDULER_TICK_MS 1000U
#define CLOCK_VALID_YEAR 120

typedef enum {
  MARKER_EMPTY = 0,
  MARKER_PENDING,
  MARKER_RUNNING,
  MARKER_COMPLETE,
  MARKER_SKIPPED,
  MARKER_RECOVERY_HOLD
} marker_state_t;

typedef struct {
  uint8_t valid;
  uint8_t state;
  uint16_t reserved;
  char compiled_id[72];
  uint32_t configuration_version;
  int64_t last_occurrence_timestamp;
  int64_t last_execution_timestamp;
  int64_t pending_occurrence_timestamp;
  char command_id[40];
} scheduler_marker_t;

typedef struct {
  char resource_id[40];
  bool shared;
} resource_claim_t;

typedef struct {
  bool valid;
  char resource_id[40];
  char exclusive_owner[72];
  uint16_t shared_count;
} scheduler_resource_lock_t;

typedef struct {
  bool valid;
  uint32_t configuration_version;
  char compiled_id[72];
  char schedule_id[40];
  char owner_id[40];
  char complex_id[40];
  char gh_id[40];
  char action[24];
  uint32_t priority;
  time_t start_timestamp;
  time_t end_timestamp;
  schedule_type_t type;
  uint8_t hour;
  uint8_t minute;
  uint8_t days_of_week;
  uint32_t interval_min;
  int64_t once_timestamp;
  int32_t duration_sec;
  int32_t raw_water_ml;
  char timezone[64];
  char missed_policy[8];
  uint32_t recovery_window_sec;
  bool fallback_enabled;
  char fallback_schedule_id[40];
  char fertigation_payload_json[6144];
  char component_ids[MAX_RUNTIME_COMPONENTS][40];
  size_t component_count;
  resource_claim_t resources[MAX_RUNTIME_RESOURCES];
  size_t resource_count;
  bool running;
  bool pending;
  int64_t pending_occurrence_timestamp;
  int64_t last_occurrence_timestamp;
  int64_t last_execution_timestamp;
  marker_state_t marker_state;
  char current_command_id[40];
} runtime_schedule_t;

static EXT_RAM_BSS_ATTR runtime_schedule_t s_runtime[MAX_COMPILED_SCHEDULES];
static size_t s_runtime_count = 0;
static EXT_RAM_BSS_ATTR scheduler_marker_t s_markers[MAX_COMPILED_SCHEDULES];
static scheduler_resource_lock_t s_resource_locks[MAX_RUNTIME_RESOURCES];
static SemaphoreHandle_t s_mutex = NULL;
static bool s_initialized = false;

// RC-1: Decouple NVS marker persistence from s_mutex critical section.
// s_marker_persist_pending dilindungi oleh portENTER_CRITICAL singkat; persist
// task memproses tulisan NVS di luar s_mutex (NVS write 100-500ms tidak boleh
// memblok HTTP handler / scheduler_evaluate_at berikutnya).
// BUILD-FIX: ESP-IDF 5.5.5 (FreeRTOS SMP) memerlukan spinlock argumen pada
// portENTER_CRITICAL/portEXIT_CRITICAL. taskENTER_CRITICAL() tanpa argumen
// tidak valid di ESP-IDF 5.x.
static volatile bool s_marker_persist_pending = false;
static portMUX_TYPE s_marker_spinlock = portMUX_INITIALIZER_UNLOCKED;
static TaskHandle_t s_marker_persist_task_handle = NULL;
#define MARKER_PERSIST_TASK_STACK 3072
#define MARKER_PERSIST_TASK_PRIO  2
#define MARKER_PERSIST_NOTIFY_BIT 0x01

#define MAX_TODAY_OCCURRENCES 32
#define MAX_DOSING_QUEUE 8

static EXT_RAM_BSS_ATTR today_occurrence_t s_today_occurrences[MAX_TODAY_OCCURRENCES];
static EXT_RAM_BSS_ATTR today_occurrence_t s_preserved_occurrences[MAX_TODAY_OCCURRENCES];
static size_t s_today_occurrence_count = 0;
static int s_today_yday = -1;
static int s_daily_trigger_completed_yday = -1;
static int s_daily_trigger_completed_year = -1;

static EXT_RAM_BSS_ATTR dosing_queue_entry_t s_dosing_queue[MAX_DOSING_QUEUE];
static size_t s_dosing_queue_count = 0;
static uint32_t s_next_queue_seq = 1;

static void materialize_today_schedule(time_t now);
static void try_enqueue_pending_preparations(time_t now);
static void rebuild_dosing_queue_on_boot(time_t now);
static void reconcile_dosing_queue_on_config_change(uint32_t new_config_version);
// RC-1: Forward declaration untuk marker_persist_task (definisi di bawah).
static void marker_persist_task(void *pvParameters);
static esp_err_t persist_markers_from_buffer(const scheduler_marker_t *buf);

static void copy_string(char *dst, size_t dst_size, const char *src) {
  if (!dst || dst_size == 0)
    return;
  dst[0] = '\0';
  if (!src)
    return;
  strncpy(dst, src, dst_size - 1);
  dst[dst_size - 1] = '\0';
}

static uint32_t stable_hash(const char *text) {
  uint32_t h = 2166136261u;
  if (!text)
    return h;
  while (*text) {
    h ^= (uint8_t)*text++;
    h *= 16777619u;
  }
  return h;
}

static bool local_clock_valid(time_t now) {
  struct tm tm_now;
  if (!localtime_r(&now, &tm_now))
    return false;
  return tm_now.tm_year >= CLOCK_VALID_YEAR;
}

static void apply_timezone_from_active_config(void) {
  char *cfg_buf = calloc(1, 8192);
  if (!cfg_buf)
    return;
  size_t len = 0;
  if (storage_mgr_load_config(cfg_buf, 8192, &len) == ESP_OK && len > 0) {
    cJSON *cfg = cJSON_ParseWithLength(cfg_buf, len);
    if (cfg) {
      cJSON *tz = cJSON_GetObjectItem(cfg, "timezone");
      if (tz && cJSON_IsString(tz) && tz->valuestring[0]) {
        (void)setenv("TZ", tz->valuestring, 1);
        tzset();
      }
      cJSON_Delete(cfg);
    }
  }
  free(cfg_buf);
}

static const char *json_string(cJSON *obj, const char *key) {
  cJSON *item = obj ? cJSON_GetObjectItem(obj, key) : NULL;
  return item && cJSON_IsString(item) ? item->valuestring : NULL;
}

static int64_t json_i64(cJSON *obj, const char *key, int64_t fallback) {
  cJSON *item = obj ? cJSON_GetObjectItem(obj, key) : NULL;
  return item && cJSON_IsNumber(item) ? (int64_t)item->valuedouble : fallback;
}

static uint32_t json_u32(cJSON *obj, const char *key, uint32_t fallback) {
  int64_t v = json_i64(obj, key, (int64_t)fallback);
  return (v >= 0 && v <= UINT32_MAX) ? (uint32_t)v : fallback;
}

/* Compiled Schedule Format v1 timestamps are Unix epoch milliseconds.
 * ESP32 scheduler clock/time_t operates in Unix epoch seconds. Normalize at the
 * boundary so recurrence comparisons and duration calculations use one unit. */
static int64_t normalize_epoch_seconds(int64_t timestamp) {
  if (timestamp >= 100000000000LL)
    return timestamp / 1000;
  return timestamp;
}

static bool json_bool(cJSON *obj, const char *key, bool fallback) {
  cJSON *item = obj ? cJSON_GetObjectItem(obj, key) : NULL;
  return item ? cJSON_IsTrue(item) : fallback;
}

static bool resource_is_operational(const char *resource_id) {
  if (!resource_id || !resource_id[0])
    return false;
  const size_t count = hardware_registry_get_count();
  for (size_t i = 0; i < count; ++i) {
    hw_component_info_t info;
    if (hardware_registry_get_by_index(i, &info) == ESP_OK &&
        info.resource_id[0] && strcmp(info.resource_id, resource_id) == 0 &&
        (info.lifecycle_state == HW_LIFECYCLE_COMMISSIONED ||
         info.lifecycle_state == HW_LIFECYCLE_ENABLED)) {
      return true;
    }
  }
  return false;
}

/* command_mgr + fertigation_mgr parse_payload require {"executionPlan":{...}} */
static bool store_fertigation_plan(runtime_schedule_t *out, cJSON *plan) {
  char *s = plan ? cJSON_PrintUnformatted(plan) : NULL;
  if (!s)
    return false;
  int n = snprintf(out->fertigation_payload_json,
                   sizeof(out->fertigation_payload_json),
                   "{\"executionPlan\":%s}", s);
  free(s);
  if (n <= 0 || (size_t)n >= sizeof(out->fertigation_payload_json)) {
    out->fertigation_payload_json[0] = '\0';
    return false;
  }
  return true;
}

static bool parse_runtime_schedule(cJSON *item, runtime_schedule_t *out) {
  if (!item || !out || !cJSON_IsObject(item))
    return false;
  memset(out, 0, sizeof(*out));

  const char *status = json_string(item, "status");
  const char *activation = json_string(item, "activationState");
  const char *compiled_id = json_string(item, "compiledId");
  const char *schedule_id = json_string(item, "scheduleId");
  const char *complex_id = json_string(item, "complexId");
  const char *action = json_string(item, "action");
  const char *owner_id = json_string(item, "ownerId");
  if (!status || strcmp(status, "ACTIVE") != 0 || !activation ||
      strcmp(activation, "ACTIVE") != 0 || !compiled_id || !compiled_id[0] ||
      !schedule_id || !schedule_id[0] || !complex_id || !complex_id[0] ||
      !action || !action[0])
    return false;

  const system_storage_state_t *storage = storage_mgr_get_state();
  if (!storage || strcmp(complex_id, storage->complex_id) != 0)
    return false;

  copy_string(out->compiled_id, sizeof(out->compiled_id), compiled_id);
  copy_string(out->schedule_id, sizeof(out->schedule_id), schedule_id);
  copy_string(out->owner_id, sizeof(out->owner_id),
              owner_id ? owner_id : schedule_id);
  copy_string(out->complex_id, sizeof(out->complex_id), complex_id);
  copy_string(out->gh_id, sizeof(out->gh_id), json_string(item, "ghId"));
  copy_string(out->action, sizeof(out->action), action);
  copy_string(out->missed_policy, sizeof(out->missed_policy),
              json_string(item, "missedRunPolicy")
                  ? json_string(item, "missedRunPolicy")
                  : "SKIP");
  out->recovery_window_sec = json_u32(item, "recoveryWindowSec", 7200);
  if (out->recovery_window_sec == 0)
    out->recovery_window_sec = 7200;
  copy_string(out->timezone, sizeof(out->timezone),
              json_string(item, "timezone"));
  out->priority = json_u32(item, "priority", 100);
  const int64_t raw_start_timestamp = json_i64(item, "startTimestamp", 0);
  const int64_t raw_end_timestamp = json_i64(item, "endTimestamp", 0);
  const int64_t normalized_start = normalize_epoch_seconds(raw_start_timestamp);
  const int64_t normalized_end = normalize_epoch_seconds(raw_end_timestamp);
  out->start_timestamp = (time_t)normalized_start;
  out->end_timestamp = (time_t)normalized_end;
  const int64_t duration_seconds = normalized_end - normalized_start;
  out->duration_sec = duration_seconds > 0 && duration_seconds <= INT32_MAX
                          ? (int32_t)duration_seconds
                          : 60;
  out->fallback_enabled = false;
  cJSON *fallback = cJSON_GetObjectItem(item, "fallback");
  if (fallback && cJSON_IsObject(fallback)) {
    out->fallback_enabled = json_bool(fallback, "enabled", false);
    copy_string(out->fallback_schedule_id, sizeof(out->fallback_schedule_id),
                json_string(fallback, "scheduleId"));
  }

  cJSON *trigger = cJSON_GetObjectItem(item, "trigger");
  if (!trigger || !cJSON_IsObject(trigger)) {
    trigger = cJSON_GetObjectItem(item, "recurrence");
  }
  const char *trigger_type = json_string(trigger, "type");
  if (!trigger_type)
    return false;
  if (strcmp(trigger_type, "DAILY") == 0) {
    out->type = SCHED_TYPE_DAILY;
    out->hour = (uint8_t)json_u32(trigger, "hour", 0);
    out->minute = (uint8_t)json_u32(trigger, "minute", 0);
    out->days_of_week = (uint8_t)json_u32(trigger, "daysOfWeek", 0);
    if (out->hour > 23 || out->minute > 59 || out->days_of_week == 0 ||
        out->days_of_week > 127)
      return false;
  } else if (strcmp(trigger_type, "INTERVAL") == 0) {
    out->type = SCHED_TYPE_INTERVAL;
    out->interval_min = json_u32(trigger, "intervalMin", 0);
    if (out->interval_min == 0)
      return false;
  } else if (strcmp(trigger_type, "ONCE") == 0) {
    out->type = SCHED_TYPE_ONCE;
    out->once_timestamp =
        normalize_epoch_seconds(json_i64(item, "startTimestamp", 0));
    if (out->once_timestamp <= 0)
      return false;
  } else {
    return false;
  }

  if (strcmp(action, "FERTIGATION") == 0) {
    cJSON *ep = cJSON_GetObjectItem(item, "executionPlan");
    if (!ep && cJSON_IsObject(cJSON_GetObjectItem(item, "parameters"))) {
      ep = cJSON_GetObjectItem(cJSON_GetObjectItem(item, "parameters"),
                               "executionPlan");
    }
    if (!ep || !cJSON_IsObject(ep))
      return false;
    if (!store_fertigation_plan(out, ep))
      return false;
  }

  cJSON *params = cJSON_GetObjectItem(item, "parameters");
  if (params && cJSON_IsObject(params)) {
    out->duration_sec =
        (int32_t)json_i64(params, "durationSec", out->duration_sec);
    out->raw_water_ml = (int32_t)json_i64(params, "rawWaterVolumeMl", 0);
    if (strcmp(action, "FERTIGATION") != 0 && out->duration_sec <= 0)
      out->duration_sec = 60;
  }

  cJSON *components = cJSON_GetObjectItem(item, "componentIds");
  if (components && cJSON_IsArray(components)) {
    cJSON *value = NULL;
    cJSON_ArrayForEach(value, components) {
      if (out->component_count >= MAX_RUNTIME_COMPONENTS ||
          !cJSON_IsString(value) || !value->valuestring[0])
        return false;
      copy_string(out->component_ids[out->component_count++],
                  sizeof(out->component_ids[0]), value->valuestring);
      if (!hardware_registry_is_operational(value->valuestring))
        return false;
    }
  }

  cJSON *resources = cJSON_GetObjectItem(item, "resourceLocks");
  if (!resources)
    resources = cJSON_GetObjectItem(item, "resourceClaims");
  if (resources && cJSON_IsArray(resources)) {
    cJSON *claim = NULL;
    cJSON_ArrayForEach(claim, resources) {
      if (out->resource_count >= MAX_RUNTIME_RESOURCES ||
          !cJSON_IsObject(claim))
        return false;
      const char *rid = json_string(claim, "resourceId");
      if (!rid || !rid[0])
        return false;
      if (!resource_is_operational(rid))
        return false;
      for (size_t existing = 0; existing < out->resource_count; ++existing) {
        if (strcmp(out->resources[existing].resource_id, rid) == 0)
          return false;
      }
      copy_string(out->resources[out->resource_count].resource_id,
                  sizeof(out->resources[0].resource_id), rid);
      const char *lock_type = json_string(claim, "lockType");
      out->resources[out->resource_count].shared =
          lock_type && strcmp(lock_type, "SHARED") == 0;
      out->resource_count++;
    }
  } else {
    cJSON *ids = cJSON_GetObjectItem(item, "resourceIds");
    if (ids && cJSON_IsArray(ids)) {
      cJSON *rid = NULL;
      cJSON_ArrayForEach(rid, ids) {
        if (out->resource_count >= MAX_RUNTIME_RESOURCES ||
            !cJSON_IsString(rid) || !rid->valuestring[0])
          return false;
        if (!resource_is_operational(rid->valuestring))
          return false;
        for (size_t existing = 0; existing < out->resource_count; ++existing) {
          if (strcmp(out->resources[existing].resource_id, rid->valuestring) ==
              0)
            return false;
        }
        copy_string(out->resources[out->resource_count].resource_id,
                    sizeof(out->resources[0].resource_id), rid->valuestring);
        out->resources[out->resource_count].shared = false;
        out->resource_count++;
      }
    }
  }

  out->valid = true;
  return true;
}

static int find_marker(const char *compiled_id) {
  if (!compiled_id || !compiled_id[0])
    return -1;
  for (size_t i = 0; i < MAX_COMPILED_SCHEDULES; ++i) {
    if (s_markers[i].valid &&
        strcmp(s_markers[i].compiled_id, compiled_id) == 0)
      return (int)i;
  }
  return -1;
}

static int find_free_marker(void) {
  for (size_t i = 0; i < MAX_COMPILED_SCHEDULES; ++i) {
    if (!s_markers[i].valid)
      return (int)i;
  }
  return -1;
}

static void hydrate_runtime_markers(void) {
  for (size_t i = 0; i < s_runtime_count; ++i) {
    int idx = find_marker(s_runtime[i].compiled_id);
    if (idx < 0) {
      s_runtime[i].marker_state = MARKER_EMPTY;
      continue;
    }
    s_runtime[i].marker_state = (marker_state_t)s_markers[idx].state;
    s_runtime[i].last_occurrence_timestamp =
        s_markers[idx].last_occurrence_timestamp;
    s_runtime[i].last_execution_timestamp =
        s_markers[idx].last_execution_timestamp;
    s_runtime[i].pending_occurrence_timestamp =
        s_markers[idx].pending_occurrence_timestamp;
    copy_string(s_runtime[i].current_command_id,
                sizeof(s_runtime[i].current_command_id),
                s_markers[idx].command_id);
    s_runtime[i].pending = s_runtime[i].pending_occurrence_timestamp > 0 &&
                           s_runtime[i].marker_state == MARKER_PENDING;
    if (s_runtime[i].marker_state == MARKER_RUNNING) {
      if (strcmp(s_runtime[i].action, "WATER_PUMP") == 0 ||
          strcmp(s_runtime[i].action, "FAN_TOGGLE") == 0 ||
          (s_runtime[i].component_count > 0 &&
           (strcmp(s_runtime[i].component_ids[0], "pump_well") == 0 ||
            strcasestr(s_runtime[i].component_ids[0], "fan") != NULL ||
            strcasestr(s_runtime[i].component_ids[0], "blower") != NULL))) {
        /* Well Pump and Fan/Blower are schedule-window driven; lazy_start reconciles them. */
        s_runtime[i].marker_state = MARKER_EMPTY;
      } else {
        /* The command manager cache is RAM-only. After reboot we deliberately do
         * not replay an unknown in-flight physical command because that could
         * duplicate a real operation. The occurrence is considered consumed and
         * placed in a recovery hold until M14 reconciliation. */
        s_runtime[i].marker_state = MARKER_RECOVERY_HOLD;
      }
      s_runtime[i].running = false;
      s_runtime[i].pending = false;
    }
  }
}

// RC-1 & RC-NVS-BLOAT: Tulis snapshot marker ke SPIFFS (primary) dan scrub dari NVS
// agar partisi NVS 24KB tidak kehabisan halaman (0x1105).
static esp_err_t persist_markers_from_buffer(const scheduler_marker_t *buf) {
  if (!buf)
    return ESP_ERR_INVALID_ARG;

  /* Primary storage: SPIFFS (9MB) to avoid exhausting 24KB NVS */
  int fd = open(SPIFFS_SCHEDULE_MARKERS_FILE, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd >= 0) {
    size_t to_write = sizeof(scheduler_marker_t) * MAX_COMPILED_SCHEDULES;
    ssize_t written = write(fd, buf, to_write);
    close(fd);
    if ((size_t)written == to_write) {
      /* Ensure legacy sched_marks is scrubbed from NVS */
      nvs_handle_t handle;
      if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        (void)nvs_erase_key(handle, NVS_KEY_MARKERS);
        (void)nvs_commit(handle);
        nvs_close(handle);
      }
      return ESP_OK;
    }
  }

  /* Fallback to NVS only if SPIFFS is unavailable */
  nvs_handle_t handle;
  esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
  if (err != ESP_OK)
    return err;
  err = nvs_set_blob(handle, NVS_KEY_MARKERS, buf, sizeof(scheduler_marker_t) * MAX_COMPILED_SCHEDULES);
  if (err == ESP_OK)
    err = nvs_commit(handle);
  nvs_close(handle);
  return err;
}

// RC-1: Task terpisah yang menangani NVS write untuk s_markers. Marker data
// adalah reconciliation state yang toleran terhadap delay persist 100ms, jadi
// aman untuk memproses secara asynchronous. NVS write 100-500ms tidak boleh
// dijalankan di dalam s_mutex karena akan memblok HTTP handler dan menyebabkan
// IDLE Core 1 starvation -> TWDT reset.
static void marker_persist_task(void *pvParameters) {
  (void)pvParameters;
  ESP_LOGI(TAG, "marker_persist_task running (stack=%d, prio=%d, core=1)",
           MARKER_PERSIST_TASK_STACK, MARKER_PERSIST_TASK_PRIO);
  // P0-FIX: Register to WDT with bounded notification wait.
  // Previously portMAX_DELAY on xTaskNotifyWait → if no notification, task
  // blocks forever without WDT trigger (not registered). Now registered with
  // 5s bounded wait — feeds WDT even when idle.
  esp_task_wdt_add(NULL);
  // Buffer lokal snapshot
  static EXT_RAM_BSS_ATTR scheduler_marker_t s_marker_snapshot[MAX_COMPILED_SCHEDULES];
  while (1) {
    esp_task_wdt_reset();
    // P0-FIX: Bounded wait 5s instead of portMAX_DELAY — feeds WDT even when idle.
    (void)xTaskNotifyWait(0x00, 0xFFFFFFFF, NULL, pdMS_TO_TICKS(5000));

    // Loop untuk memproses multiple pending writes yang mungkin terjadi selama
    // satu siklus persist. Jika flag masih setelah snapshot, ulangi.
    for (;;) {
      // Stage 1: Akuisisi s_mutex singkat hanya untuk menyalin s_markers[] ke
      // buffer lokal. Kritikal section ini hanya berisi memcpy, jadi sangat cepat.
      if (s_mutex && xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        memcpy(s_marker_snapshot, s_markers, sizeof(s_markers));
        xSemaphoreGive(s_mutex);
      } else {
        // Mutex belum siap (init belum selesai?) — coba lagi nanti.
        break;
      }

      // Clear flag setelah snapshot diambil. Jika marker_update() menulis lagi
      // selama NVS I/O, flag akan kembali set dan loop akan mengulang.
      portENTER_CRITICAL(&s_marker_spinlock);
      s_marker_persist_pending = false;
      portEXIT_CRITICAL(&s_marker_spinlock);

      // Stage 2: Tulis NVS di LUAR s_mutex. Bisa memakan 100-500ms.
      (void)persist_markers_from_buffer(s_marker_snapshot);

      // Stage 3: Cek apakah ada update baru yang masuk selama Stage 2. Jika
      // ya, ulangi seluruh siklus; jika tidak, selesai dan tunggu notifikasi
      // berikutnya.
      portENTER_CRITICAL(&s_marker_spinlock);
      bool still_pending = s_marker_persist_pending;
      portEXIT_CRITICAL(&s_marker_spinlock);
      if (!still_pending)
        break;
    }
  }
}

static void load_markers(void) {
  memset(s_markers, 0, sizeof(s_markers));

  /* 1. Try SPIFFS primary storage */
  int fd = open(SPIFFS_SCHEDULE_MARKERS_FILE, O_RDONLY);
  if (fd >= 0) {
    size_t expected_len = sizeof(s_markers);
    ssize_t n = read(fd, s_markers, expected_len);
    close(fd);
    if ((size_t)n == expected_len) {
      ESP_LOGI(TAG, "Loaded schedule markers from SPIFFS (%u bytes)", (unsigned)n);
      return;
    }
    memset(s_markers, 0, sizeof(s_markers));
  }

  /* 2. Fallback to NVS (upgrade migration path) */
  nvs_handle_t handle;
  if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK)
    return;
  size_t length = sizeof(s_markers);
  if (nvs_get_blob(handle, NVS_KEY_MARKERS, s_markers, &length) == ESP_OK &&
      length == sizeof(s_markers)) {
    ESP_LOGI(TAG, "Loaded legacy schedule markers from NVS (%u bytes), migrating to SPIFFS", (unsigned)length);
    (void)persist_markers_from_buffer(s_markers);
  } else {
    memset(s_markers, 0, sizeof(s_markers));
  }
  nvs_close(handle);
}

static esp_err_t load_compiled_runtime_json(char *out_buf, size_t max_len,
                                            size_t *out_len) {
  nvs_handle_t handle;
  esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
  if (err != ESP_OK)
    return err;
  size_t length = 0;
  err = nvs_get_blob(handle, NVS_KEY_COMPILED, NULL, &length);
  if (err == ESP_OK) {
    if (length == 0 || length > max_len)
      err = ESP_ERR_NO_MEM;
    else
      err = nvs_get_blob(handle, NVS_KEY_COMPILED, out_buf, &length);
  }
  nvs_close(handle);
  if (err == ESP_OK && out_len)
    *out_len = length > 0 ? length - 1 : 0;
  return err;
}

static esp_err_t parse_runtime_set(const char *json_str,
                                   runtime_schedule_t *out_runtime,
                                   size_t *out_count) {
  if (!json_str || !out_runtime || !out_count)
    return ESP_ERR_INVALID_ARG;
  *out_count = 0;
  cJSON *root = cJSON_ParseWithLength(json_str, strlen(json_str));
  if (!root)
    return ESP_ERR_INVALID_ARG;
  cJSON *payload = cJSON_GetObjectItem(root, "payload");
  cJSON *target = payload && cJSON_IsObject(payload) ? payload : root;
  cJSON *items = cJSON_GetObjectItem(target, "compiled");
  cJSON *cfg_ver = cJSON_GetObjectItem(target, "configurationVersion");
  const system_storage_state_t *storage = storage_mgr_get_state();
  if (!items || !cJSON_IsArray(items) || !storage) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_ARG;
  }
  if (cfg_ver && cJSON_IsNumber(cfg_ver) &&
      (uint32_t)cfg_ver->valueint != storage->config_version) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  int count = cJSON_GetArraySize(items);
  if (count < 0 || count > MAX_COMPILED_SCHEDULES) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_SIZE;
  }
  for (int i = 0; i < count; ++i) {
    if (!parse_runtime_schedule(cJSON_GetArrayItem(items, i),
                                &out_runtime[*out_count])) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_ARG;
    }
    out_runtime[*out_count].configuration_version =
        cfg_ver && cJSON_IsNumber(cfg_ver) ? (uint32_t)cfg_ver->valueint
                                           : storage->config_version;
    for (size_t j = 0; j < *out_count; ++j) {
      if (strcmp(out_runtime[j].compiled_id,
                 out_runtime[*out_count].compiled_id) == 0 ||
          strcmp(out_runtime[j].schedule_id,
                 out_runtime[*out_count].schedule_id) == 0) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_ARG;
      }
    }
    (*out_count)++;
  }
  cJSON_Delete(root);
  return ESP_OK;
}

static esp_err_t validate_compiled_payload(const char *json_str) {
  runtime_schedule_t *temp =
      calloc(MAX_COMPILED_SCHEDULES, sizeof(runtime_schedule_t));
  if (!temp)
    return ESP_ERR_NO_MEM;
  size_t count = 0;
  esp_err_t err = parse_runtime_set(json_str, temp, &count);
  free(temp);
  if (err != ESP_OK)
    return err;

  cJSON *root = cJSON_ParseWithLength(json_str, strlen(json_str));
  if (!root)
    return ESP_ERR_INVALID_ARG;
  cJSON *payload = cJSON_GetObjectItem(root, "payload");
  cJSON *target = payload && cJSON_IsObject(payload) ? payload : root;
  cJSON *items = cJSON_GetObjectItem(target, "compiled");
  cJSON *topology_view = NULL;
  err = topology_capability_build_json(&topology_view);
  if (err != ESP_OK || !topology_view) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  cJSON *valid = cJSON_GetObjectItem(topology_view, "valid");
  if (valid && cJSON_IsFalse(valid)) {
    cJSON_Delete(topology_view);
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  for (int i = 0; i < cJSON_GetArraySize(items); ++i) {
    cJSON *item = cJSON_GetArrayItem(items, i);
    const char *gh_id = json_string(item, "ghId");
    const char *action = json_string(item, "action");
    if (gh_id && gh_id[0]) {
      cJSON *by_gh = cJSON_GetObjectItem(topology_view, "byGh");
      cJSON *gh = by_gh ? cJSON_GetObjectItem(by_gh, gh_id) : NULL;
      cJSON *caps = gh ? cJSON_GetObjectItem(gh, "capabilities") : NULL;
      if (!caps) {
        err = ESP_ERR_NOT_FOUND;
        break;
      }
      const char *required = NULL;
      if (strcmp(action, "FERTIGATION") == 0)
        required = "CAN_RUN_AUTONOMOUSLY";
      else if (strcmp(action, "FAN_TOGGLE") == 0)
        required = "CAN_CLIMATE_CONTROL";
      if (required) {
        cJSON *cap = cJSON_GetObjectItem(caps, required);
        if (!cap || !cJSON_IsTrue(cap)) {
          err = ESP_ERR_NOT_SUPPORTED;
          break;
        }
      }
    }
  }
  cJSON_Delete(topology_view);
  cJSON_Delete(root);
  return err;
}

static void reset_runtime_from_new_set(runtime_schedule_t *fresh,
                                       size_t fresh_count) {
  s_runtime_count = fresh_count;
  memcpy(s_runtime, fresh, fresh_count * sizeof(runtime_schedule_t));
  memset(s_runtime + fresh_count, 0,
         sizeof(s_runtime) - fresh_count * sizeof(runtime_schedule_t));
  memset(s_resource_locks, 0, sizeof(s_resource_locks));
  hydrate_runtime_markers();
}

esp_err_t scheduler_deploy_compiled_json(const char *json_str) {
  if (!json_str)
    return ESP_ERR_INVALID_ARG;
  runtime_schedule_t *fresh =
      calloc(MAX_COMPILED_SCHEDULES, sizeof(runtime_schedule_t));
  if (!fresh)
    return ESP_ERR_NO_MEM;
  size_t fresh_count = 0;
  esp_err_t err = parse_runtime_set(json_str, fresh, &fresh_count);
  if (err != ESP_OK) {
    free(fresh);
    return err;
  }
  err = validate_compiled_payload(json_str);
  if (err != ESP_OK) {
    free(fresh);
    return err;
  }

  if (!s_mutex) {
    free(fresh);
    return ESP_ERR_INVALID_STATE;
  }
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) {
    free(fresh);
    return ESP_FAIL;
  }

  for (size_t i = 0; i < s_runtime_count; ++i) {
    if (s_runtime[i].running) {
      (void)event_mgr_log(LOG_LEVEL_WARNING, "SCHEDULER",
                          "SCHEDULE_DEPLOY_BLOCKED_ACTIVE_RUN",
                          "Compiled schedule deployment is blocked while a "
                          "physical command is running",
                          NULL);
      xSemaphoreGive(s_mutex);
      free(fresh);
      return ESP_ERR_INVALID_STATE;
    }
  }

  cJSON *root = cJSON_ParseWithLength(json_str, strlen(json_str));
  if (!root) {
    xSemaphoreGive(s_mutex);
    return ESP_ERR_INVALID_ARG;
  }
  cJSON *payload = cJSON_GetObjectItem(root, "payload");
  cJSON *target = payload && cJSON_IsObject(payload) ? payload : root;
  cJSON *cfg_version =
      target ? cJSON_GetObjectItem(target, "configurationVersion") : NULL;
  const system_storage_state_t *storage = storage_mgr_get_state();
  const uint32_t cfg_ver = cfg_version && cJSON_IsNumber(cfg_version)
                               ? (uint32_t)cfg_version->valueint
                               : (storage ? storage->config_version : 0);
  cJSON_Delete(root);
  if (!storage) {
    xSemaphoreGive(s_mutex);
    return ESP_ERR_INVALID_STATE;
  }

  scheduler_marker_t staged_markers[MAX_COMPILED_SCHEDULES];
  memcpy(staged_markers, s_markers, sizeof(staged_markers));
  for (size_t i = 0; i < MAX_COMPILED_SCHEDULES; ++i) {
    scheduler_marker_t *m = &staged_markers[i];
    if (!m->valid)
      continue;
    bool keep = false;
    for (size_t j = 0; j < fresh_count; ++j) {
      if (strcmp(m->compiled_id, fresh[j].compiled_id) == 0 &&
          m->configuration_version == cfg_ver) {
        keep = true;
        break;
      }
    }
    if (!keep)
      memset(m, 0, sizeof(*m));
  }
  for (size_t i = 0; i < fresh_count; ++i) {
    int idx = -1;
    for (size_t j = 0; j < MAX_COMPILED_SCHEDULES; ++j) {
      if (staged_markers[j].valid &&
          strcmp(staged_markers[j].compiled_id, fresh[i].compiled_id) == 0) {
        idx = (int)j;
        break;
      }
    }
    if (idx < 0) {
      for (size_t j = 0; j < MAX_COMPILED_SCHEDULES; ++j) {
        if (!staged_markers[j].valid) {
          idx = (int)j;
          break;
        }
      }
    }
    if (idx >= 0 && !staged_markers[idx].valid) {
      memset(&staged_markers[idx], 0, sizeof(staged_markers[idx]));
      staged_markers[idx].valid = 1;
      staged_markers[idx].state = MARKER_EMPTY;
      copy_string(staged_markers[idx].compiled_id,
                  sizeof(staged_markers[idx].compiled_id),
                  fresh[i].compiled_id);
      staged_markers[idx].configuration_version = cfg_ver;
    }
  }

  nvs_handle_t handle;
  err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
  if (err == ESP_OK) {
    const size_t compiled_len = strlen(json_str) + 1;
    err = nvs_set_blob(handle, NVS_KEY_COMPILED, json_str, compiled_len);
    if (err == ESP_OK) {
      /* Erase legacy NVS markers; markers are persisted to SPIFFS */
      (void)nvs_erase_key(handle, NVS_KEY_MARKERS);
    }
    if (err == ESP_OK)
      err = nvs_commit(handle);
    nvs_close(handle);
    if (err == ESP_OK) {
      (void)persist_markers_from_buffer(staged_markers);
    }
  }
  if (err == ESP_OK) {
    memcpy(s_markers, staged_markers, sizeof(s_markers));
    reset_runtime_from_new_set(fresh, fresh_count);
    apply_timezone_from_active_config();
    time_t now_sec = time(NULL);
    if (local_clock_valid(now_sec)) {
      struct tm tm_dep;
      localtime_r(&now_sec, &tm_dep);
      reconcile_dosing_queue_on_config_change(cfg_ver);
      materialize_today_schedule(now_sec);
      try_enqueue_pending_preparations(now_sec);
      s_daily_trigger_completed_yday = tm_dep.tm_yday;
      s_daily_trigger_completed_year = tm_dep.tm_year;
      s_today_yday = tm_dep.tm_yday;
    }
  }

  free(fresh);
  xSemaphoreGive(s_mutex);
  return err;
}

static bool synthesize_fertigation_plan_from_intent(runtime_schedule_t *rs, cJSON *it, const char *sched_id) {
  const system_storage_state_t *ss = storage_mgr_get_state();
  if (!ss || !ss->config_hash[0]) {
    ESP_LOGW(TAG, "Cannot synthesize plan for '%s': no active configuration", sched_id ? sched_id : "?");
    return false;
  }

  cJSON *prm = cJSON_GetObjectItem(it, "parameters");
  cJSON *tw_item = cJSON_GetObjectItem(it, "targetWaterL");
  if (!tw_item && prm) tw_item = cJSON_GetObjectItem(prm, "targetWaterL");
  cJSON *tw_ml_item = cJSON_GetObjectItem(it, "targetWaterMl");
  if (!tw_ml_item && prm) tw_ml_item = cJSON_GetObjectItem(prm, "targetWaterMl");

  double water_ml = 80000.0;
  if (tw_ml_item && cJSON_IsNumber(tw_ml_item)) {
    water_ml = tw_ml_item->valuedouble;
  } else if (tw_item && cJSON_IsNumber(tw_item)) {
    water_ml = tw_item->valuedouble * 1000.0;
  }
  if (water_ml <= 0.0) water_ml = 80000.0;

  cJSON *da_item = cJSON_GetObjectItem(it, "dosingAml");
  if (!da_item && prm) da_item = cJSON_GetObjectItem(prm, "dosingAml");
  cJSON *db_item = cJSON_GetObjectItem(it, "dosingBml");
  if (!db_item && prm) db_item = cJSON_GetObjectItem(prm, "dosingBml");

  double da_ml = da_item && cJSON_IsNumber(da_item) ? da_item->valuedouble : 150.0;
  double db_ml = db_item && cJSON_IsNumber(db_item) ? db_item->valuedouble : 150.0;

  cJSON *plan = cJSON_CreateObject();
  if (!plan) return false;

  cJSON_AddNumberToObject(plan, "configurationVersion", ss->config_version);
  cJSON_AddStringToObject(plan, "configurationHash", ss->config_hash);
  cJSON_AddNumberToObject(plan, "targetWaterMl", water_ml);
  cJSON_AddNumberToObject(plan, "mixingDurationSec", 0);
  cJSON_AddNumberToObject(plan, "rawWaterStartThresholdPercent", 20);

  cJSON *delivery = cJSON_CreateObject();
  cJSON_AddStringToObject(delivery, "mode", "VOLUME");
  cJSON_AddNumberToObject(delivery, "toleranceMl", 2000);
  cJSON_AddNumberToObject(delivery, "durationSec", 900);
  cJSON_AddNumberToObject(delivery, "targetFlowLpm", 10.0);
  cJSON_AddNumberToObject(delivery, "targetPressureKpa", 100.0);
  cJSON_AddBoolToObject(delivery, "allowDurationFallback", true);
  cJSON_AddItemToObject(plan, "delivery", delivery);

  cJSON *timeouts = cJSON_CreateObject();
  cJSON_AddNumberToObject(timeouts, "maxRuntimeSec", 1800);
  cJSON_AddNumberToObject(timeouts, "minDosingRuntimeSec", 1);
  cJSON_AddNumberToObject(timeouts, "maxDosingRuntimeSec", 600);
  cJSON_AddNumberToObject(timeouts, "fillTimeoutSec", 600);
  cJSON_AddNumberToObject(timeouts, "deliveryTimeoutSec", 900);
  cJSON_AddItemToObject(plan, "timeouts", timeouts);

  cJSON *safety = cJSON_CreateObject();
  cJSON_AddBoolToObject(safety, "pressureReliefEnabled", true);
  cJSON_AddNumberToObject(safety, "maxContinuousSec", 1800);
  cJSON_AddItemToObject(plan, "safety", safety);

  cJSON *channels = cJSON_CreateArray();
  char dosing_ids[2][32] = { {0}, {0} };
  size_t count = hardware_registry_get_count();
  int found_dosing = 0;
  for (size_t i = 0; i < count && found_dosing < 2; i++) {
    hw_component_info_t info;
    if (hardware_registry_get_by_index(i, &info) == ESP_OK) {
      if (strstr(info.role, "DOSING") != NULL || strstr(info.supported_type_id, "DOSING") != NULL || strstr(info.component_id, "dosing") != NULL) {
        if (info.lifecycle_state == HW_LIFECYCLE_COMMISSIONED || info.lifecycle_state == HW_LIFECYCLE_ENABLED) {
          copy_string(dosing_ids[found_dosing++], 32, info.component_id);
        }
      }
    }
  }
  if (found_dosing == 0) {
    copy_string(dosing_ids[0], 32, "dosing_pump_a");
    copy_string(dosing_ids[1], 32, "dosing_pump_b");
  } else if (found_dosing == 1) {
    copy_string(dosing_ids[1], 32, dosing_ids[0]);
  }

  cJSON *in_channels = cJSON_GetObjectItem(it, "dosingChannels");
  if (!in_channels && prm) in_channels = cJSON_GetObjectItem(prm, "dosingChannels");

  if (in_channels && cJSON_IsArray(in_channels) && cJSON_GetArraySize(in_channels) > 0) {
    cJSON *ch_item = NULL;
    int idx = 0;
    cJSON_ArrayForEach(ch_item, in_channels) {
      const char *cid = json_string(ch_item, "componentId");
      if (!cid || !cid[0] || strcmp(cid, "dosing_a") == 0 || strcmp(cid, "dosing_b") == 0) {
        cid = dosing_ids[idx < 2 ? idx : 0];
      }
      cJSON *vol = cJSON_GetObjectItem(ch_item, "requestedMl");
      if (!vol) vol = cJSON_GetObjectItem(ch_item, "targetVolumeMl");
      double vml = vol && cJSON_IsNumber(vol) ? vol->valuedouble : (idx == 0 ? da_ml : db_ml);
      cJSON *new_ch = cJSON_CreateObject();
      cJSON_AddStringToObject(new_ch, "componentId", cid);
      cJSON_AddNumberToObject(new_ch, "targetVolumeMl", vml);
      cJSON_AddItemToArray(channels, new_ch);
      idx++;
    }
  } else {
    cJSON *chA = cJSON_CreateObject();
    cJSON_AddStringToObject(chA, "componentId", dosing_ids[0]);
    cJSON_AddNumberToObject(chA, "targetVolumeMl", da_ml);
    cJSON_AddItemToArray(channels, chA);

    cJSON *chB = cJSON_CreateObject();
    cJSON_AddStringToObject(chB, "componentId", dosing_ids[1]);
    cJSON_AddNumberToObject(chB, "targetVolumeMl", db_ml);
    cJSON_AddItemToArray(channels, chB);
  }
  cJSON_AddItemToObject(plan, "dosingChannels", channels);

  bool ok = store_fertigation_plan(rs, plan);
  cJSON_Delete(plan);
  if (ok) {
    ESP_LOGI(TAG, "Synthesized fertigation plan for '%s': water=%.1fL, doseA=%.1fml, doseB=%.1fml",
             sched_id ? sched_id : "?", water_ml / 1000.0, da_ml, db_ml);
  }
  return ok;
}

static esp_err_t sync_intents_locked(void) {
  int fd = open(SPIFFS_SCHEDULE_INTENTS_FILE, O_RDONLY);
  if (fd < 0) {
    return ESP_ERR_NOT_FOUND;
  }
  struct stat st;
  if (fstat(fd, &st) != 0 || st.st_size <= 0 || st.st_size > 16384) {
    close(fd);
    return ESP_ERR_INVALID_SIZE;
  }
  char *buf = malloc(st.st_size + 1);
  if (!buf) {
    close(fd);
    return ESP_ERR_NO_MEM;
  }
  ssize_t n = read(fd, buf, st.st_size);
  close(fd);
  if (n <= 0) {
    free(buf);
    return ESP_FAIL;
  }
  buf[n] = '\0';

  cJSON *root = cJSON_Parse(buf);
  free(buf);
  if (!root) return ESP_ERR_INVALID_ARG;

  cJSON *items = cJSON_GetObjectItem(root, "items");
  if (!items || !cJSON_IsArray(items)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_ARG;
  }

  const system_storage_state_t *storage = storage_mgr_get_state();
  const uint32_t cfg_ver = storage ? storage->config_version : 0;
  const char *default_complex_id = (storage && storage->complex_id[0]) ? storage->complex_id : "complex-01";

  runtime_schedule_t *fresh = calloc(MAX_COMPILED_SCHEDULES, sizeof(runtime_schedule_t));
  if (!fresh) {
    cJSON_Delete(root);
    return ESP_ERR_NO_MEM;
  }
  size_t fresh_count = 0;

  int total_items = cJSON_GetArraySize(items);
  for (int i = 0; i < total_items && fresh_count < MAX_COMPILED_SCHEDULES; i++) {
    cJSON *it = cJSON_GetArrayItem(items, i);
    if (!it || !cJSON_IsObject(it)) continue;

    cJSON *en_item = cJSON_GetObjectItem(it, "enabled");
    bool enabled = en_item ? cJSON_IsTrue(en_item) : true;
    if (!enabled) continue;

    const char *sched_id = json_string(it, "id");
    if (!sched_id || !sched_id[0]) sched_id = json_string(it, "scheduleId");
    if (!sched_id || !sched_id[0]) continue;

    runtime_schedule_t *rs = &fresh[fresh_count];
    memset(rs, 0, sizeof(*rs));
    rs->valid = true;
    rs->configuration_version = cfg_ver;
    copy_string(rs->schedule_id, sizeof(rs->schedule_id), sched_id);
    snprintf(rs->compiled_id, sizeof(rs->compiled_id), "int-%s", sched_id);
    copy_string(rs->owner_id, sizeof(rs->owner_id), sched_id);

    const char *cid = json_string(it, "complexId");
    copy_string(rs->complex_id, sizeof(rs->complex_id), (cid && cid[0]) ? cid : default_complex_id);

    const char *gh = json_string(it, "ghId");
    if (gh && gh[0]) copy_string(rs->gh_id, sizeof(rs->gh_id), gh);

    const char *act = json_string(it, "action");
    const char *kind = json_string(it, "kind");
    const char *type = json_string(it, "type");
    const char *task = json_string(it, "task");
    const char *comp_id = json_string(it, "componentId");
    if (!comp_id || !comp_id[0]) comp_id = json_string(it, "pump");
    if (!comp_id || !comp_id[0]) comp_id = json_string(it, "fan");
    if (comp_id && (strcmp(comp_id, "wp-main") == 0 || strcasecmp(comp_id, "well_pump") == 0)) {
      comp_id = "pump_well";
    } else if (comp_id && (strcasecmp(comp_id, "fan-blower") == 0 || strcasecmp(comp_id, "blower_fan") == 0 ||
                           strcasecmp(comp_id, "blower-fan") == 0 || strcasecmp(comp_id, "blower") == 0 ||
                           strcasecmp(comp_id, "fan_blower") == 0)) {
      comp_id = "fan_blower";
    }

    if (act && act[0]) {
      copy_string(rs->action, sizeof(rs->action), act);
    } else if ((kind && strcasestr(kind, "well")) || (type && strcasestr(type, "well")) ||
               (task && strcasestr(task, "well")) || (comp_id && strcasestr(comp_id, "well"))) {
      copy_string(rs->action, sizeof(rs->action), "WATER_PUMP");
    } else if ((kind && strcasestr(kind, "fan")) || (type && strcasestr(type, "fan")) ||
               (task && strcasestr(task, "fan")) || (comp_id && strcasestr(comp_id, "fan"))) {
      copy_string(rs->action, sizeof(rs->action), "FAN_TOGGLE");
    } else if ((kind && strcasestr(kind, "fert")) || (type && strcasestr(type, "fert"))) {
      copy_string(rs->action, sizeof(rs->action), "FERTIGATION");
    } else {
      copy_string(rs->action, sizeof(rs->action), "WATER_PUMP");
    }

    if (strcmp(rs->action, "FERTIGATION") == 0) {
      cJSON *ep = cJSON_GetObjectItem(it, "executionPlan");
      if (!ep || !cJSON_IsObject(ep)) {
        cJSON *prm = cJSON_GetObjectItem(it, "parameters");
        ep = prm ? cJSON_GetObjectItem(prm, "executionPlan") : NULL;
      }
      bool stored = (ep && cJSON_IsObject(ep) && store_fertigation_plan(rs, ep));
      if (!stored) {
        stored = synthesize_fertigation_plan_from_intent(rs, it, sched_id);
      }
      if (!stored) {
        ESP_LOGW(TAG, "Fertigation intent '%s' could not obtain valid executionPlan; not executable", sched_id);
        continue;
      }
    }

    if (comp_id && comp_id[0]) {
      copy_string(rs->component_ids[0], sizeof(rs->component_ids[0]), comp_id);
      rs->component_count = 1;
    } else if (strcmp(rs->action, "WATER_PUMP") == 0) {
      copy_string(rs->component_ids[0], sizeof(rs->component_ids[0]), "pump_well");
      rs->component_count = 1;
    } else if (strcmp(rs->action, "FAN_TOGGLE") == 0) {
      copy_string(rs->component_ids[0], sizeof(rs->component_ids[0]), "fan_blower");
      rs->component_count = 1;
    }

    if (rs->component_count > 0 && rs->resource_count < MAX_RUNTIME_RESOURCES) {
      char comp_temp[32] = {0};
      copy_string(comp_temp, sizeof(comp_temp), rs->component_ids[0]);
      snprintf(rs->resources[0].resource_id, sizeof(rs->resources[0].resource_id), "res-%.30s", comp_temp);
      rs->resources[0].shared = false;
      rs->resource_count = 1;
    }

    const char *trig = json_string(it, "trigger");
    const char *time_str = json_string(it, "time");
    if (!time_str || !time_str[0]) {
      cJSON *trig_obj = cJSON_GetObjectItem(it, "trigger");
      if (trig_obj && cJSON_IsObject(trig_obj)) {
        time_str = json_string(trig_obj, "time");
      }
    }

    int32_t dur_sec = (int32_t)json_i64(it, "durationSec", 0);
    if (dur_sec <= 0) {
      cJSON *params = cJSON_GetObjectItem(it, "parameters");
      if (params && cJSON_IsObject(params)) {
        dur_sec = (int32_t)json_i64(params, "durationSec", 0);
      }
    }
    if (dur_sec <= 0) {
      double dur_min = 0;
      cJSON *dm = cJSON_GetObjectItem(it, "durationMin");
      if (dm && cJSON_IsNumber(dm)) dur_min = dm->valuedouble;
      if (dur_min > 0) dur_sec = (int32_t)(dur_min * 60.0 + 0.5);
    }
    /* Parse to-time / endTime if explicit stop time is specified (e.g. time: "06:00", to-time: "06:01") */
    const char *to_time = json_string(it, "to-time");
    if (!to_time || !to_time[0]) to_time = json_string(it, "toTime");
    if (!to_time || !to_time[0]) to_time = json_string(it, "endTime");
    if (to_time && to_time[0] && time_str && time_str[0]) {
      unsigned int sh = 0, sm = 0, eh = 0, em = 0;
      if (sscanf(time_str, "%u:%u", &sh, &sm) == 2 && sscanf(to_time, "%u:%u", &eh, &em) == 2) {
        int start_sec = (sh % 24) * 3600 + (sm % 60) * 60;
        int end_sec = (eh % 24) * 3600 + (em % 60) * 60;
        int diff = end_sec - start_sec;
        if (diff > 0) {
          dur_sec = diff;
        }
      }
    }
    if (dur_sec <= 0) dur_sec = 60;
    rs->duration_sec = dur_sec;

    /* Parse days of week: support days array, daysOfWeek number/array */
    uint8_t dow_mask = 0;
    cJSON *days_arr = cJSON_GetObjectItem(it, "days");
    if (!days_arr) days_arr = cJSON_GetObjectItem(it, "daysOfWeek");
    if (days_arr && cJSON_IsArray(days_arr) && cJSON_GetArraySize(days_arr) > 0) {
      int num_days = cJSON_GetArraySize(days_arr);
      for (int d = 0; d < num_days; d++) {
        cJSON *de = cJSON_GetArrayItem(days_arr, d);
        if (de && cJSON_IsString(de) && de->valuestring) {
          const char *ds = de->valuestring;
          if (strncasecmp(ds, "sun", 3) == 0 || strncasecmp(ds, "min", 3) == 0) dow_mask |= (1 << 0);
          else if (strncasecmp(ds, "mon", 3) == 0 || strncasecmp(ds, "sen", 3) == 0) dow_mask |= (1 << 1);
          else if (strncasecmp(ds, "tue", 3) == 0 || strncasecmp(ds, "sel", 3) == 0) dow_mask |= (1 << 2);
          else if (strncasecmp(ds, "wed", 3) == 0 || strncasecmp(ds, "rab", 3) == 0) dow_mask |= (1 << 3);
          else if (strncasecmp(ds, "thu", 3) == 0 || strncasecmp(ds, "kam", 3) == 0) dow_mask |= (1 << 4);
          else if (strncasecmp(ds, "fri", 3) == 0 || strncasecmp(ds, "jum", 3) == 0) dow_mask |= (1 << 5);
          else if (strncasecmp(ds, "sat", 3) == 0 || strncasecmp(ds, "sab", 3) == 0) dow_mask |= (1 << 6);
        } else if (de && cJSON_IsNumber(de)) {
          int dn = de->valueint;
          if (dn >= 0 && dn <= 6) dow_mask |= (1 << dn);
        }
      }
    } else if (days_arr && cJSON_IsNumber(days_arr)) {
      dow_mask = (uint8_t)days_arr->valueint;
    }
    rs->days_of_week = dow_mask ? dow_mask : 127;

    if (trig && strcasecmp(trig, "interval") == 0) {
      rs->type = SCHED_TYPE_INTERVAL;
      rs->interval_min = json_u32(it, "intervalMin", 60);
      if (rs->interval_min == 0) rs->interval_min = 60;
      if (time_str && strchr(time_str, ':')) {
        unsigned int h = 0, m = 0;
        sscanf(time_str, "%u:%u", &h, &m);
        rs->hour = (uint8_t)(h % 24);
        rs->minute = (uint8_t)(m % 60);
      }
    } else if (trig && strcasecmp(trig, "once") == 0) {
      rs->type = SCHED_TYPE_ONCE;
      rs->once_timestamp = normalize_epoch_seconds(json_i64(it, "timestamp", 0));
    } else {
      rs->type = SCHED_TYPE_DAILY;
      if (time_str && strchr(time_str, ':')) {
        unsigned int h = 0, m = 0;
        sscanf(time_str, "%u:%u", &h, &m);
        rs->hour = (uint8_t)(h % 24);
        rs->minute = (uint8_t)(m % 60);
      } else {
        cJSON *trig_obj = cJSON_GetObjectItem(it, "trigger");
        rs->hour = (uint8_t)json_u32(it, "hour", trig_obj ? json_u32(trig_obj, "hour", 0) : 0);
        rs->minute = (uint8_t)json_u32(it, "minute", trig_obj ? json_u32(trig_obj, "minute", 0) : 0);
      }
    }

    const char *mp = json_string(it, "missedPolicy");
    if (!mp || !mp[0]) mp = json_string(it, "missedRunPolicy");
    copy_string(rs->missed_policy, sizeof(rs->missed_policy), (mp && strcasecmp(mp, "execute") == 0) ? "EXECUTE" : "SKIP");
    rs->recovery_window_sec = json_u32(it, "recoveryWindowSec", 7200);
    if (rs->recovery_window_sec == 0) rs->recovery_window_sec = 7200;

    rs->priority = json_u32(it, "priority", 100);

    fresh_count++;
  }

  cJSON_Delete(root);

  reset_runtime_from_new_set(fresh, fresh_count);
  ESP_LOGI(TAG, "Synchronized %u schedule intent(s) from SPIFFS into active runtime scheduler", (unsigned)fresh_count);

  time_t now = time(NULL);
  if (local_clock_valid(now)) {
    materialize_today_schedule(now);
    try_enqueue_pending_preparations(now);
  }

  free(fresh);
  return ESP_OK;
}

esp_err_t scheduler_sync_intents(void) {
  if (!s_mutex) return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
  esp_err_t err = sync_intents_locked();
  xSemaphoreGive(s_mutex);
  return err;
}

esp_err_t scheduler_get_compiled_json(char *out_buf, size_t max_len,
                                      size_t *out_len) {
  if (!out_buf || max_len == 0)
    return ESP_ERR_INVALID_ARG;
  esp_err_t err = load_compiled_runtime_json(out_buf, max_len, out_len);
  if (err == ESP_OK && out_len && *out_len > 0) {
    return ESP_OK;
  }
  if (s_runtime_count > 0 && s_mutex) {
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
      cJSON *root = cJSON_CreateObject();
      const system_storage_state_t *storage = storage_mgr_get_state();
      cJSON_AddNumberToObject(root, "configurationVersion", storage ? storage->config_version : 0);
      cJSON *arr = cJSON_AddArrayToObject(root, "compiled");
      for (size_t i = 0; i < s_runtime_count; i++) {
        runtime_schedule_t *rs = &s_runtime[i];
        if (!rs->valid) continue;
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "scheduleId", rs->schedule_id);
        cJSON_AddStringToObject(item, "compiledId", rs->compiled_id);
        cJSON_AddStringToObject(item, "complexId", rs->complex_id);
        if (rs->gh_id[0]) cJSON_AddStringToObject(item, "ghId", rs->gh_id);
        cJSON_AddStringToObject(item, "action", rs->action);
        cJSON_AddNumberToObject(item, "priority", rs->priority);
        cJSON_AddStringToObject(item, "status", "ACTIVE");

        cJSON *trig = cJSON_AddObjectToObject(item, "trigger");
        if (rs->type == SCHED_TYPE_INTERVAL) {
          cJSON_AddStringToObject(trig, "type", "INTERVAL");
          cJSON_AddNumberToObject(trig, "intervalMin", rs->interval_min);
        } else if (rs->type == SCHED_TYPE_ONCE) {
          cJSON_AddStringToObject(trig, "type", "ONCE");
          cJSON_AddNumberToObject(trig, "timestamp", (double)rs->once_timestamp);
        } else {
          cJSON_AddStringToObject(trig, "type", "DAILY");
          cJSON_AddNumberToObject(trig, "hour", rs->hour);
          cJSON_AddNumberToObject(trig, "minute", rs->minute);
          cJSON_AddNumberToObject(trig, "daysOfWeek", rs->days_of_week);
        }

        cJSON *params = cJSON_AddObjectToObject(item, "parameters");
        cJSON_AddNumberToObject(params, "durationSec", rs->duration_sec);

        if (rs->component_count > 0) {
          cJSON *comps = cJSON_AddArrayToObject(item, "componentIds");
          for (size_t c = 0; c < rs->component_count; c++) {
            cJSON_AddItemToArray(comps, cJSON_CreateString(rs->component_ids[c]));
          }
        }
        cJSON_AddItemToArray(arr, item);
      }
      xSemaphoreGive(s_mutex);
      char *printed = cJSON_PrintUnformatted(root);
      cJSON_Delete(root);
      if (printed) {
        size_t slen = strlen(printed);
        if (slen < max_len) {
          memcpy(out_buf, printed, slen + 1);
          if (out_len) *out_len = slen;
          free(printed);
          return ESP_OK;
        }
        free(printed);
      }
    }
  }
  return err;
}

esp_err_t scheduler_clear_compiled(void) {
  if (!s_mutex)
    return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE)
    return ESP_FAIL;
  nvs_handle_t handle;
  esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
  if (err == ESP_OK) {
    err = nvs_erase_key(handle, NVS_KEY_COMPILED);
    if (err == ESP_ERR_NVS_NOT_FOUND)
      err = ESP_OK;
    if (err == ESP_OK) {
      err = nvs_erase_key(handle, NVS_KEY_MARKERS);
      if (err == ESP_ERR_NVS_NOT_FOUND)
        err = ESP_OK;
    }
    if (err == ESP_OK)
      err = nvs_commit(handle);
    nvs_close(handle);
    (void)unlink(SPIFFS_SCHEDULE_MARKERS_FILE);
  }
  if (err == ESP_OK) {
    memset(s_runtime, 0, sizeof(s_runtime));
    s_runtime_count = 0;
    memset(s_resource_locks, 0, sizeof(s_resource_locks));
    memset(s_markers, 0, sizeof(s_markers));
    memset(s_today_occurrences, 0, sizeof(s_today_occurrences));
    s_today_occurrence_count = 0;
    memset(s_dosing_queue, 0, sizeof(s_dosing_queue));
    s_dosing_queue_count = 0;
    // Resynchronize from authoritative schedule intents so the autonomous controller continues running
    (void)sync_intents_locked();
  }
  xSemaphoreGive(s_mutex);
  return err;
}

static scheduler_resource_lock_t *find_resource_lock(const char *resource_id) {
  if (!resource_id || !resource_id[0])
    return NULL;
  for (size_t i = 0; i < MAX_RUNTIME_RESOURCES; ++i) {
    if (s_resource_locks[i].valid &&
        strcmp(s_resource_locks[i].resource_id, resource_id) == 0)
      return &s_resource_locks[i];
  }
  return NULL;
}

static scheduler_resource_lock_t *find_free_resource_lock(void) {
  for (size_t i = 0; i < MAX_RUNTIME_RESOURCES; ++i) {
    if (!s_resource_locks[i].valid)
      return &s_resource_locks[i];
  }
  return NULL;
}

static bool resource_conflicts(const runtime_schedule_t *candidate) {
  if (!candidate)
    return true;
  for (size_t i = 0; i < candidate->resource_count; ++i) {
    const resource_claim_t *claim = &candidate->resources[i];
    scheduler_resource_lock_t *lock = find_resource_lock(claim->resource_id);
    if (!lock)
      continue;
    if (claim->shared) {
      if (lock->exclusive_owner[0])
        return true;
    } else if (lock->exclusive_owner[0] || lock->shared_count > 0) {
      return true;
    }
  }
  return false;
}

static bool acquire_resource_locks(const runtime_schedule_t *candidate) {
  if (!candidate || resource_conflicts(candidate))
    return false;

  for (size_t i = 0; i < candidate->resource_count; ++i) {
    const resource_claim_t *claim = &candidate->resources[i];
    scheduler_resource_lock_t *lock = find_resource_lock(claim->resource_id);
    if (!lock) {
      lock = find_free_resource_lock();
      if (!lock)
        return false;
      memset(lock, 0, sizeof(*lock));
      lock->valid = true;
      copy_string(lock->resource_id, sizeof(lock->resource_id),
                  claim->resource_id);
    }
    if (claim->shared) {
      lock->shared_count++;
    } else {
      copy_string(lock->exclusive_owner, sizeof(lock->exclusive_owner),
                  candidate->owner_id);
    }
  }
  return true;
}

static void release_resource_locks(const runtime_schedule_t *owner) {
  if (!owner)
    return;
  for (size_t i = 0; i < owner->resource_count; ++i) {
    const resource_claim_t *claim = &owner->resources[i];
    scheduler_resource_lock_t *lock = find_resource_lock(claim->resource_id);
    if (!lock)
      continue;
    if (claim->shared) {
      if (lock->shared_count > 0)
        lock->shared_count--;
    } else if (strcmp(lock->exclusive_owner, owner->owner_id) == 0) {
      lock->exclusive_owner[0] = '\0';
    }
    if (lock->shared_count == 0 && !lock->exclusive_owner[0])
      memset(lock, 0, sizeof(*lock));
  }
}

static bool schedule_day_selected(const runtime_schedule_t *sched,
                                  const struct tm *tm_value) {
  return sched && tm_value &&
         (sched->days_of_week & (uint8_t)(1U << tm_value->tm_wday)) != 0;
}

static time_t daily_occurrence_at_or_before(const runtime_schedule_t *sched,
                                            time_t now, bool *selected) {
  struct tm local_now;
  if (!sched || !localtime_r(&now, &local_now))
    return 0;
  for (int days_back = 0; days_back <= 7; ++days_back) {
    struct tm candidate = local_now;
    candidate.tm_hour = sched->hour;
    candidate.tm_min = sched->minute;
    candidate.tm_sec = 0;
    candidate.tm_mday -= days_back;
    time_t ts = mktime(&candidate);
    if (ts <= now && schedule_day_selected(sched, &candidate)) {
      if (selected)
        *selected = true;
      return ts;
    }
  }
  if (selected)
    *selected = false;
  return 0;
}

static bool occurrence_is_due(runtime_schedule_t *sched, time_t now,
                              int64_t *occurrence, bool *missed) {
  if (!sched || !occurrence || !missed)
    return false;
  *occurrence = 0;
  *missed = false;
  if (!local_clock_valid(now))
    return false;

  if (sched->type == SCHED_TYPE_ONCE) {
    const int64_t ts = sched->once_timestamp > 0
                           ? sched->once_timestamp
                           : (int64_t)sched->start_timestamp;
    if (ts <= 0 || (sched->last_occurrence_timestamp >= ts))
      return false;
    if ((int64_t)now >= ts) {
      *occurrence = ts;
      *missed = ((int64_t)now - ts) >= 60;
      return true;
    }
    return false;
  }

  if (sched->type == SCHED_TYPE_DAILY) {
    bool selected = false;
    const time_t ts = daily_occurrence_at_or_before(sched, now, &selected);
    if (!selected || ts <= 0)
      return false;
    if ((int64_t)ts < (int64_t)sched->start_timestamp)
      return false;
    if (sched->last_occurrence_timestamp >= (int64_t)ts)
      return false;
    *occurrence = ts;
    *missed = ((int64_t)now - (int64_t)ts) >= 60;
    return true;
  }

  const int64_t interval_sec = (int64_t)sched->interval_min * 60;
  if (interval_sec <= 0)
    return false;
  int64_t candidate = sched->last_execution_timestamp > 0
                          ? sched->last_execution_timestamp + interval_sec
                          : (int64_t)sched->start_timestamp;
  if (candidate <= 0 || (int64_t)now < candidate)
    return false;
  *occurrence = candidate;
  *missed = ((int64_t)now - candidate) >= 1;
  return true;
}

static void marker_update(runtime_schedule_t *sched, marker_state_t state,
                          int64_t occurrence, int64_t execution,
                          const char *command_id) {
  int idx = find_marker(sched->compiled_id);
  if (idx < 0)
    idx = find_free_marker();
  if (idx < 0)
    return;
  scheduler_marker_t *m = &s_markers[idx];
  memset(m, 0, sizeof(*m));
  m->valid = 1;
  m->state = (uint8_t)state;
  copy_string(m->compiled_id, sizeof(m->compiled_id), sched->compiled_id);
  m->configuration_version = storage_mgr_get_state()->config_version;
  m->last_occurrence_timestamp =
      occurrence > 0 ? occurrence : sched->last_occurrence_timestamp;
  m->last_execution_timestamp =
      execution > 0 ? execution : sched->last_execution_timestamp;
  m->pending_occurrence_timestamp =
      sched->pending ? sched->pending_occurrence_timestamp : 0;
  copy_string(m->command_id, sizeof(m->command_id),
              command_id ? command_id : sched->current_command_id);

  // RC-1: Jangan panggil persist_markers() (NVS write 100-500ms) di dalam
  // s_mutex. Set flag persist pending secara atomik dan kirim notifikasi ke
  // marker_persist_task yang akan melakukan NVS write di luar s_mutex.
  portENTER_CRITICAL(&s_marker_spinlock);
  s_marker_persist_pending = true;
  portEXIT_CRITICAL(&s_marker_spinlock);
  if (s_marker_persist_task_handle) {
    xTaskNotifyGive(s_marker_persist_task_handle);
  }

  sched->marker_state = state;
}

static void build_command_id(const runtime_schedule_t *sched,
                             int64_t occurrence, char out[40]) {
  const uint32_t hash = stable_hash(sched->compiled_id);
  snprintf(out, 40, "sch-%08lx-%lld", (unsigned long)hash,
           (long long)occurrence);
}

static esp_err_t dispatch_runtime_schedule(runtime_schedule_t *sched,
                                           int64_t occurrence, time_t now) {
  if (!sched)
    return ESP_ERR_INVALID_ARG;
  if (!safety_monitor_allows_scheduler())
    return ESP_ERR_INVALID_STATE;

  command_item_t *cmd = calloc(1, sizeof(command_item_t));
  if (!cmd)
    return ESP_ERR_NO_MEM;
  build_command_id(sched, occurrence, cmd->command_id);
  cmd->status = CMD_STATUS_PENDING;
  cmd->param_duration_sec = sched->duration_sec;
  cmd->param_raw_volume_ml = sched->raw_water_ml;
  cmd->configuration_version = storage_mgr_get_state()->config_version;
  copy_string(cmd->source, sizeof(cmd->source), "SCHEDULER");
  copy_string(cmd->target_complex_id, sizeof(cmd->target_complex_id),
              sched->complex_id);
  copy_string(cmd->target_gh_id, sizeof(cmd->target_gh_id), sched->gh_id);
  hw_component_info_t hinfo;
  if (sched->component_count > 0 &&
      hardware_registry_find_by_id(sched->component_ids[0], &hinfo) == ESP_OK &&
      hinfo.resource_id[0]) {
    copy_string(cmd->resource_id, sizeof(cmd->resource_id), hinfo.resource_id);
  }
  cmd->param_on = true;
  if (sched->component_count > 0)
    copy_string(cmd->component_id, sizeof(cmd->component_id),
                sched->component_ids[0]);
  cmd->submitted_at = (int64_t)now;

  if (strcmp(sched->action, "FERTIGATION") == 0) {
    if (!sched->fertigation_payload_json[0]) {
      free(cmd);
      return ESP_ERR_INVALID_ARG;
    }
    copy_string(cmd->fertigation_payload_json,
                sizeof(cmd->fertigation_payload_json),
                sched->fertigation_payload_json);
    cmd->type = CMD_TYPE_FERTIGATION_BATCH;
  } else if (strcmp(sched->action, "WATER_PUMP") == 0) {
    cmd->type = CMD_TYPE_COMPONENT_TIMED;
    if (!cmd->component_id[0]) {
      copy_string(cmd->component_id, sizeof(cmd->component_id), "pump_well");
    }
    cmd->param_duration_sec = sched->duration_sec;
  } else if (strcmp(sched->action, "FAN_TOGGLE") == 0) {
    cmd->type = CMD_TYPE_COMPONENT_TIMED;
  } else {
    free(cmd);
    return ESP_ERR_NOT_SUPPORTED;
  }

  /* Reserve the occurrence before submitting to the physical command queue so
   * a reboot or duplicate scheduler evaluation cannot generate a second ID. */
  sched->pending = true;
  sched->pending_occurrence_timestamp = occurrence;
  sched->current_command_id[0] = '\0';
  marker_update(sched, MARKER_PENDING, occurrence, 0, cmd->command_id);

  esp_err_t err = command_mgr_submit(cmd, NULL);
  if (err != ESP_OK) {
    /* Submission did not reach the command queue. Keep the occurrence pending
     * for the next evaluation rather than declaring it executed. */
    sched->marker_state = MARKER_PENDING;
    sched->pending = true;
    (void)marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp,
                        sched->last_execution_timestamp, NULL);
    ESP_LOGE(TAG, "Schedule '%s' command_mgr_submit failed: %d", sched->schedule_id, err);
    free(cmd);
    return err;
  }

  sched->last_occurrence_timestamp = occurrence;
  sched->last_execution_timestamp = (int64_t)now;
  sched->pending = false;
  sched->pending_occurrence_timestamp = 0;
  sched->running = true;
  copy_string(sched->current_command_id, sizeof(sched->current_command_id),
              cmd->command_id);
  marker_update(sched, MARKER_RUNNING, occurrence, now, cmd->command_id);
  free(cmd);
  (void)event_mgr_log_command(
      LOG_LEVEL_INFO, "SCHEDULE_TRIGGERED",
      "Active schedule occurrence dispatched to command queue.",
      sched->current_command_id, sched->complex_id, sched->gh_id,
      sched->component_count > 0 ? sched->component_ids[0] : NULL,
      sched->resource_count > 0 ? sched->resources[0].resource_id : NULL,
      sched->configuration_version);
  if (strcmp(sched->action, "FERTIGATION") == 0) {
    (void)event_mgr_log_command(
        LOG_LEVEL_INFO, "MIXING_QUEUED",
        "Fertigation batch queued for execution.",
        sched->current_command_id, sched->complex_id, sched->gh_id,
        sched->component_count > 0 ? sched->component_ids[0] : NULL,
        sched->resource_count > 0 ? sched->resources[0].resource_id : NULL,
        sched->configuration_version);
  }
  ESP_LOGI(TAG,
           "Schedule '%s' dispatched: occurrence=%lld command=%s priority=%lu",
           sched->schedule_id, (long long)occurrence, sched->current_command_id,
           (unsigned long)sched->priority);
  return ESP_OK;
}

static runtime_schedule_t *find_schedule_by_id(const char *id) {
  if (!id || !id[0])
    return NULL;
  for (size_t i = 0; i < s_runtime_count; ++i) {
    if (strcmp(s_runtime[i].schedule_id, id) == 0 ||
        strcmp(s_runtime[i].compiled_id, id) == 0) {
      return &s_runtime[i];
    }
  }
  return NULL;
}

static void refresh_running_state(void) {
  bool changed = false;
  (void)changed;
  command_item_t *receipt = calloc(1, sizeof(command_item_t));
  if (!receipt)
    return;
  for (size_t i = 0; i < s_runtime_count; ++i) {
    runtime_schedule_t *sched = &s_runtime[i];
    if (!sched->running || !sched->current_command_id[0])
      continue;
    if (command_mgr_get(sched->current_command_id, receipt) != ESP_OK)
      continue;
    if (receipt->status == CMD_STATUS_COMPLETED ||
        receipt->status == CMD_STATUS_FAILED ||
        receipt->status == CMD_STATUS_REJECTED ||
        receipt->status == CMD_STATUS_CANCELLED) {
      release_resource_locks(sched);
      sched->running = false;
      marker_update(sched,
                    receipt->status == CMD_STATUS_COMPLETED ? MARKER_COMPLETE
                                                           : MARKER_SKIPPED,
                    sched->last_occurrence_timestamp,
                    sched->last_execution_timestamp, sched->current_command_id);
      changed = true;
      ESP_LOGI(TAG, "Schedule '%s' completed command=%s status=%d",
               sched->schedule_id, sched->current_command_id, receipt->status);

      if (receipt->status != CMD_STATUS_COMPLETED && sched->fallback_enabled &&
          sched->fallback_schedule_id[0]) {
        runtime_schedule_t *fb =
            find_schedule_by_id(sched->fallback_schedule_id);
        if (fb && !fb->running) {
          if (acquire_resource_locks(fb)) {
            time_t now_sec = time(NULL);
            esp_err_t fb_err =
                dispatch_runtime_schedule(fb, (int64_t)now_sec, now_sec);
            if (fb_err != ESP_OK) {
              release_resource_locks(fb);
              ESP_LOGE(TAG, "Failed to dispatch fallback schedule '%s': %d",
                       fb->schedule_id, fb_err);
            } else {
              ESP_LOGW(
                  TAG,
                  "Triggered fallback schedule '%s' due to failure of '%s'",
                  fb->schedule_id, sched->schedule_id);
            }
          } else {
            ESP_LOGW(TAG, "Could not acquire locks for fallback schedule '%s'",
                     fb->schedule_id);
          }
        }
      }
    }
  }
  free(receipt);
}

static bool missed_policy_execute(const runtime_schedule_t *sched) {
  return sched && strcmp(sched->missed_policy, "EXECUTE") == 0;
}

static void mark_skipped(runtime_schedule_t *sched, int64_t occurrence,
                         const char *reason) {
  sched->last_occurrence_timestamp = occurrence;
  sched->pending = false;
  sched->pending_occurrence_timestamp = 0;
  marker_update(sched, MARKER_SKIPPED, occurrence, 0, "");
  (void)event_mgr_log_command(
      LOG_LEVEL_WARNING, "SCHEDULE_SKIPPED",
      reason ? reason : "Missed schedule skipped", sched->schedule_id,
      sched->complex_id, sched->gh_id,
      sched->component_count ? sched->component_ids[0] : NULL,
      sched->resource_count ? sched->resources[0].resource_id : NULL,
      sched->configuration_version);
}

static int compare_due_slots(const void *a, const void *b) {
  const runtime_schedule_t *const *sa = (const runtime_schedule_t *const *)a;
  const runtime_schedule_t *const *sb = (const runtime_schedule_t *const *)b;
  if ((*sa)->priority > (*sb)->priority)
    return -1;
  if ((*sa)->priority < (*sb)->priority)
    return 1;
  return strcmp((*sa)->schedule_id, (*sb)->schedule_id);
}

static bool is_gh_in_queue(const char *gh_id) {
  if (!gh_id || !gh_id[0]) return false;
  for (size_t i = 0; i < s_dosing_queue_count; i++) {
    if (strcasecmp(s_dosing_queue[i].gh_id, gh_id) == 0 &&
        s_dosing_queue[i].state != QUEUE_STATE_COMPLETED &&
        s_dosing_queue[i].state != QUEUE_STATE_FAILED) {
      return true;
    }
  }
  return false;
}

static bool is_gh_occupied(const char *gh_id) {
  if (!gh_id || !gh_id[0]) return false;

  /* 1. Global Dosing Queue membership check */
  if (is_gh_in_queue(gh_id)) {
    return true;
  }

  /* 2. Today's occurrences active lifecycle states check */
  for (size_t i = 0; i < s_today_occurrence_count; i++) {
    if (strcasecmp(s_today_occurrences[i].gh_id, gh_id) == 0) {
      occurrence_state_t st = s_today_occurrences[i].state;
      if (st == OCC_STATE_PREPARING || st == OCC_STATE_WAITING_BATCH ||
          st == OCC_STATE_READY_TO_SEND || st == OCC_STATE_DISTRIBUTING) {
        return true;
      }
    }
  }

  /* 3. Physical fertigation manager runtime check */
  if (fertigation_mgr_is_gh_busy(gh_id) || fertigation_mgr_is_batch_ready(gh_id, NULL)) {
    return true;
  }
  fertigation_state_t f_st = fertigation_mgr_get_state();
  if (f_st != FERT_STATE_IDLE && f_st != FERT_STATE_COMPLETE &&
      f_st != FERT_STATE_FAULTED && f_st != FERT_STATE_ABORTED) {
    char q_id[48] = {0}, occ_id[48] = {0}, b_id[48] = {0}, target_gh[48] = {0};
    fertigation_mgr_get_correlation(q_id, sizeof(q_id), occ_id, sizeof(occ_id),
                                    b_id, sizeof(b_id), target_gh, sizeof(target_gh));
    if (strcasecmp(target_gh, gh_id) == 0) {
      return true;
    }
  }

  /* 4. Active runtime schedule or recovery hold check */
  for (size_t i = 0; i < s_runtime_count; i++) {
    if (strcasecmp(s_runtime[i].gh_id, gh_id) == 0) {
      if (s_runtime[i].running || s_runtime[i].marker_state == MARKER_RECOVERY_HOLD) {
        return true;
      }
    }
  }

  return false;
}

static esp_err_t enqueue_preparation(today_occurrence_t *occ) {
  if (!occ) return ESP_ERR_INVALID_ARG;
  if (s_dosing_queue_count >= MAX_DOSING_QUEUE) {
    occ->state = OCC_STATE_PENDING;
    (void)event_mgr_log(LOG_LEVEL_WARNING, "SCHEDULER", "DOSING_QUEUE_FULL",
                        "Dosing queue capacity reached; occurrence held in OCC_STATE_PENDING backpressure",
                        occ->gh_id);
    return ESP_ERR_NO_MEM;
  }
  if (is_gh_occupied(occ->gh_id)) {
    return ESP_ERR_INVALID_STATE;
  }

  dosing_queue_entry_t *q = &s_dosing_queue[s_dosing_queue_count++];
  memset(q, 0, sizeof(*q));
  snprintf(q->queue_id, sizeof(q->queue_id), "q-%04lu", (unsigned long)s_next_queue_seq++);
  copy_string(q->occurrence_id, sizeof(q->occurrence_id), occ->occurrence_id);
  copy_string(q->schedule_id, sizeof(q->schedule_id), occ->schedule_id);
  copy_string(q->gh_id, sizeof(q->gh_id), occ->gh_id);
  snprintf(q->batch_id, sizeof(q->batch_id), "batch-%s-%lld", occ->gh_id, (long long)occ->scheduled_timestamp);
  q->state = QUEUE_STATE_PENDING;
  q->dispatched_at_ms = 0;
  const system_storage_state_t *st = storage_mgr_get_state();
  q->config_version = st ? st->config_version : 0;

  copy_string(occ->queue_id, sizeof(occ->queue_id), q->queue_id);
  copy_string(occ->batch_id, sizeof(occ->batch_id), q->batch_id);
  occ->state = OCC_STATE_PREPARING;

  ESP_LOGI(TAG, "Global Dosing Queue registered: queue_id=%s batch=%s gh=%s (count=%u)",
           q->queue_id, q->batch_id, q->gh_id, (unsigned)s_dosing_queue_count);
  (void)event_mgr_log(LOG_LEVEL_INFO, "SCHEDULER", "MIXING_QUEUED",
                      "Fertigation preparation enqueued into Global Dosing Queue",
                      q->batch_id);
  return ESP_OK;
}

static void reconcile_dosing_queue_on_config_change(uint32_t new_config_version) {
  size_t i = 0;
  while (i < s_dosing_queue_count) {
    dosing_queue_entry_t *q = &s_dosing_queue[i];
    bool physically_started = (q->state == QUEUE_STATE_ACTIVE);

    fertigation_state_t f_st = fertigation_mgr_get_state();
    if (f_st != FERT_STATE_IDLE && f_st != FERT_STATE_COMPLETE &&
        f_st != FERT_STATE_FAULTED && f_st != FERT_STATE_ABORTED) {
      char q_id[48] = {0}, occ_id[48] = {0}, b_id[48] = {0}, gh[48] = {0};
      fertigation_mgr_get_correlation(q_id, sizeof(q_id), occ_id, sizeof(occ_id),
                                      b_id, sizeof(b_id), gh, sizeof(gh));
      if (strcmp(q_id, q->queue_id) == 0 || strcmp(occ_id, q->occurrence_id) == 0) {
        physically_started = true;
      }
    }

    if (physically_started) {
      ESP_LOGI(TAG, "Config change: Preserving in-flight physical batch %s (gh=%s)", q->batch_id, q->gh_id);
      i++;
    } else {
      ESP_LOGI(TAG, "Config change: Invalidating unstarted queue entry %s for occurrence %s to re-evaluate under config v%lu",
               q->queue_id, q->occurrence_id, (unsigned long)new_config_version);
      char cancel_cmd_id[48];
      snprintf(cancel_cmd_id, sizeof(cancel_cmd_id), "cmd-%.30s", q->queue_id);
      (void)command_mgr_cancel(cancel_cmd_id);
      for (size_t j = 0; j < s_today_occurrence_count; j++) {
        if (strcmp(s_today_occurrences[j].occurrence_id, q->occurrence_id) == 0) {
          if (s_today_occurrences[j].state == OCC_STATE_PREPARING ||
              s_today_occurrences[j].state == OCC_STATE_WAITING_BATCH) {
            s_today_occurrences[j].state = OCC_STATE_PENDING;
            s_today_occurrences[j].queue_id[0] = '\0';
            s_today_occurrences[j].batch_id[0] = '\0';
          }
          break;
        }
      }
      for (size_t k = i + 1; k < s_dosing_queue_count; k++) {
        s_dosing_queue[k - 1] = s_dosing_queue[k];
      }
      s_dosing_queue_count--;
    }
  }
}

static void materialize_today_schedule(time_t now) {
  struct tm tm_now;
  if (!localtime_r(&now, &tm_now))
    return;

  today_occurrence_t *preserved = s_preserved_occurrences;
  size_t preserved_count = 0;
  for (size_t i = 0; i < s_today_occurrence_count; i++) {
    today_occurrence_t *occ = &s_today_occurrences[i];
    struct tm occ_tm;
    time_t occ_sec = (time_t)occ->scheduled_timestamp;
    bool is_prev_day = (localtime_r(&occ_sec, &occ_tm) &&
                        (occ_tm.tm_yday != tm_now.tm_yday || occ_tm.tm_year != tm_now.tm_year));

    if (is_prev_day) {
      /* Midnight / Day rollover semantics:
       * Case E: COMPLETED occurrences from yesterday retire and do not occupy new day schedule.
       * Case D: DELIVERY in progress -> PRESERVE under original identity.
       * Case C: READY_TO_SEND batch -> PRESERVE under original identity.
       * Case B: Active physical dosing -> PRESERVE under original identity.
       * Case A: Queued-but-not-started -> Purge from queue; do not silently become new day occurrence.
       */
      bool keep_prev = false;
      if (occ->state == OCC_STATE_DISTRIBUTING || occ->state == OCC_STATE_READY_TO_SEND) {
        keep_prev = true;
      } else if (occ->state == OCC_STATE_PREPARING || occ->state == OCC_STATE_WAITING_BATCH) {
        for (size_t q = 0; q < s_dosing_queue_count; q++) {
          if (strcmp(s_dosing_queue[q].occurrence_id, occ->occurrence_id) == 0 &&
              s_dosing_queue[q].state == QUEUE_STATE_ACTIVE) {
            keep_prev = true;
            break;
          }
        }
        fertigation_state_t f_st = fertigation_mgr_get_state();
        if (f_st != FERT_STATE_IDLE && f_st != FERT_STATE_COMPLETE &&
            f_st != FERT_STATE_FAULTED && f_st != FERT_STATE_ABORTED) {
          char q_id[48] = {0}, occ_id[48] = {0}, b_id[48] = {0}, gh[48] = {0};
          fertigation_mgr_get_correlation(q_id, sizeof(q_id), occ_id, sizeof(occ_id),
                                          b_id, sizeof(b_id), gh, sizeof(gh));
          if (strcmp(occ_id, occ->occurrence_id) == 0) {
            keep_prev = true;
          }
        }
      }

      if (keep_prev) {
        if (preserved_count < MAX_TODAY_OCCURRENCES) {
          preserved[preserved_count++] = *occ;
        }
      } else {
        /* Purge unstarted queue entry from yesterday */
        for (size_t q = 0; q < s_dosing_queue_count; q++) {
          if (strcmp(s_dosing_queue[q].occurrence_id, occ->occurrence_id) == 0 &&
              s_dosing_queue[q].state != QUEUE_STATE_ACTIVE) {
            for (size_t k = q + 1; k < s_dosing_queue_count; k++) {
              s_dosing_queue[k - 1] = s_dosing_queue[k];
            }
            s_dosing_queue_count--;
            break;
          }
        }
      }
    } else {
      /* Same day: preserve completed, active, distributing, or holding occurrences */
      if (occ->state == OCC_STATE_COMPLETED ||
          occ->state == OCC_STATE_DISTRIBUTING ||
          occ->state == OCC_STATE_READY_TO_SEND ||
          occ->state == OCC_STATE_WAITING_BATCH ||
          occ->state == OCC_STATE_PREPARING) {
        if (preserved_count < MAX_TODAY_OCCURRENCES) {
          preserved[preserved_count++] = *occ;
        }
      }
    }
  }

  s_today_occurrence_count = preserved_count;
  if (preserved_count > 0) {
    memcpy(s_today_occurrences, preserved, preserved_count * sizeof(today_occurrence_t));
  }

  for (size_t i = 0; i < s_runtime_count; i++) {
    runtime_schedule_t *rs = &s_runtime[i];
    if (!rs->valid || strcmp(rs->action, "FERTIGATION") != 0)
      continue;

    time_t occ_time = 0;
    if (rs->type == SCHED_TYPE_DAILY) {
      if (!schedule_day_selected(rs, &tm_now))
        continue;
      struct tm occ_tm = tm_now;
      occ_tm.tm_hour = rs->hour;
      occ_tm.tm_min = rs->minute;
      occ_tm.tm_sec = 0;
      occ_time = mktime(&occ_tm);
    } else if (rs->type == SCHED_TYPE_ONCE) {
      struct tm once_tm;
      time_t once_sec = (time_t)rs->once_timestamp;
      if (localtime_r(&once_sec, &once_tm) && once_tm.tm_yday == tm_now.tm_yday &&
          once_tm.tm_year == tm_now.tm_year) {
        occ_time = once_sec;
      } else {
        continue;
      }
    } else if (rs->type == SCHED_TYPE_INTERVAL) {
      if (rs->interval_min == 0)
        continue;
      int64_t step_sec = (int64_t)rs->interval_min * 60;
      struct tm start_of_day = tm_now;
      start_of_day.tm_hour = (rs->hour <= 23) ? rs->hour : 0;
      start_of_day.tm_min = (rs->minute <= 59) ? rs->minute : 0;
      start_of_day.tm_sec = 0;
      time_t t_cur = mktime(&start_of_day);

      struct tm end_of_day = tm_now;
      end_of_day.tm_hour = 23;
      end_of_day.tm_min = 59;
      end_of_day.tm_sec = 59;
      time_t t_end = mktime(&end_of_day);

      while (t_cur <= t_end) {
        if (rs->start_timestamp > 0 && t_cur < rs->start_timestamp) {
          t_cur += step_sec;
          continue;
        }
        if (rs->end_timestamp > 0 && t_cur > rs->end_timestamp) {
          break;
        }

        char occ_id[64];
        snprintf(occ_id, sizeof(occ_id), "occ-%s-%lld", rs->schedule_id, (long long)t_cur);

        bool exists = false;
        for (size_t j = 0; j < s_today_occurrence_count; j++) {
          if (strcmp(s_today_occurrences[j].occurrence_id, occ_id) == 0) {
            exists = true;
            break;
          }
        }
        if (!exists && s_today_occurrence_count < MAX_TODAY_OCCURRENCES) {
          today_occurrence_t *new_occ = &s_today_occurrences[s_today_occurrence_count++];
          memset(new_occ, 0, sizeof(*new_occ));
          copy_string(new_occ->occurrence_id, sizeof(new_occ->occurrence_id), occ_id);
          copy_string(new_occ->schedule_id, sizeof(new_occ->schedule_id), rs->schedule_id);
          copy_string(new_occ->complex_id, sizeof(new_occ->complex_id), rs->complex_id);
          copy_string(new_occ->gh_id, sizeof(new_occ->gh_id), rs->gh_id);
          new_occ->scheduled_timestamp = (int64_t)t_cur;

          int m_idx = find_marker(rs->compiled_id);
          if (m_idx >= 0 && s_markers[m_idx].state == MARKER_COMPLETE &&
              s_markers[m_idx].last_occurrence_timestamp == (int64_t)t_cur) {
            new_occ->state = OCC_STATE_COMPLETED;
          } else if ((int64_t)now > (int64_t)t_cur) {
            new_occ->state = OCC_STATE_FAILED;
          } else {
            new_occ->state = OCC_STATE_PENDING;
          }
        }
        t_cur += step_sec;
      }
      continue;
    } else {
      continue;
    }

    if (occ_time <= 0)
      continue;

    char occ_id[64];
    snprintf(occ_id, sizeof(occ_id), "occ-%s-%lld", rs->schedule_id, (long long)occ_time);

    bool exists = false;
    for (size_t j = 0; j < s_today_occurrence_count; j++) {
      if (strcmp(s_today_occurrences[j].occurrence_id, occ_id) == 0) {
        exists = true;
        break;
      }
    }
    if (exists)
      continue;

    if (s_today_occurrence_count < MAX_TODAY_OCCURRENCES) {
      today_occurrence_t *new_occ = &s_today_occurrences[s_today_occurrence_count++];
      memset(new_occ, 0, sizeof(*new_occ));
      copy_string(new_occ->occurrence_id, sizeof(new_occ->occurrence_id), occ_id);
      copy_string(new_occ->schedule_id, sizeof(new_occ->schedule_id), rs->schedule_id);
      copy_string(new_occ->complex_id, sizeof(new_occ->complex_id), rs->complex_id);
      copy_string(new_occ->gh_id, sizeof(new_occ->gh_id), rs->gh_id);
      new_occ->scheduled_timestamp = (int64_t)occ_time;

      int m_idx = find_marker(rs->compiled_id);
      if (m_idx >= 0 && s_markers[m_idx].state == MARKER_COMPLETE &&
          s_markers[m_idx].last_occurrence_timestamp == (int64_t)occ_time) {
        new_occ->state = OCC_STATE_COMPLETED;
      } else if ((int64_t)now > (int64_t)occ_time) {
        /* Missed schedule after offline / power loss: considered MISSED, do NOT automatically replay. */
        new_occ->state = OCC_STATE_FAILED;
        if (m_idx >= 0 && s_markers[m_idx].state != MARKER_COMPLETE) {
          marker_update(rs, MARKER_SKIPPED, (int64_t)occ_time, now, "Power loss missed schedule skipped");
        }
      } else {
        new_occ->state = OCC_STATE_PENDING;
      }
    }
  }

  for (size_t i = 0; i < s_today_occurrence_count; i++) {
    for (size_t j = i + 1; j < s_today_occurrence_count; j++) {
      bool swap = false;
      if (s_today_occurrences[i].scheduled_timestamp > s_today_occurrences[j].scheduled_timestamp) {
        swap = true;
      } else if (s_today_occurrences[i].scheduled_timestamp == s_today_occurrences[j].scheduled_timestamp) {
        if (strcmp(s_today_occurrences[i].gh_id, s_today_occurrences[j].gh_id) > 0) {
          swap = true;
        }
      }
      if (swap) {
        today_occurrence_t temp = s_today_occurrences[i];
        s_today_occurrences[i] = s_today_occurrences[j];
        s_today_occurrences[j] = temp;
      }
    }
  }
}

static void try_enqueue_pending_preparations(time_t now) {
  (void)now;
  if (s_dosing_queue_count >= MAX_DOSING_QUEUE) {
    return;
  }
  for (size_t i = 0; i < s_today_occurrence_count; i++) {
    today_occurrence_t *occ = &s_today_occurrences[i];
    if (occ->state == OCC_STATE_PENDING) {
      if (!is_gh_occupied(occ->gh_id)) {
        esp_err_t err = enqueue_preparation(occ);
        if (err == ESP_OK) {
          ESP_LOGI(TAG, "Eager preparation enqueued for GH %s: occurrence %s (sched timestamp %lld)",
                   occ->gh_id, occ->occurrence_id, (long long)occ->scheduled_timestamp);
        }
        if (s_dosing_queue_count >= MAX_DOSING_QUEUE) {
          break;
        }
      }
    }
  }
}

static void rebuild_dosing_queue_on_boot(time_t now) {
  try_enqueue_pending_preparations(now);
}

static void process_dosing_queue(time_t now) {
  if (s_dosing_queue_count == 0)
    return;

  dosing_queue_entry_t *head = &s_dosing_queue[0];
  fertigation_state_t fert_st = fertigation_mgr_get_state();

  if (head->state == QUEUE_STATE_FAILED) {
    ESP_LOGE(TAG, "Queue head %s (GH %s) FAILED (code: %s); removing so next batch can run",
             head->queue_id, head->gh_id, head->error_code[0] ? head->error_code : "UNKNOWN");
    (void)event_mgr_log(LOG_LEVEL_ERROR, "SCHEDULER", "DOSING_QUEUE_HEAD_FAILED",
                        head->error_code[0] ? head->error_code : "Dosing batch could not be dispatched and was removed from the queue",
                        NULL);
    for (size_t i = 0; i < s_today_occurrence_count; i++) {
      if (strcmp(s_today_occurrences[i].occurrence_id, head->occurrence_id) == 0) {
        s_today_occurrences[i].state = OCC_STATE_FAILED;
        copy_string(s_today_occurrences[i].error_code, sizeof(s_today_occurrences[i].error_code), head->error_code);
        copy_string(s_today_occurrences[i].affected_component_id, sizeof(s_today_occurrences[i].affected_component_id), head->affected_component_id);
        break;
      }
    }
    for (size_t i = 1; i < s_dosing_queue_count; i++) {
      s_dosing_queue[i - 1] = s_dosing_queue[i];
    }
    s_dosing_queue_count--;
    try_enqueue_pending_preparations(now);
    return;
  }

  if (head->state == QUEUE_STATE_PENDING) {
    if (fert_st == FERT_STATE_IDLE) {
      runtime_schedule_t *sched = find_schedule_by_id(head->schedule_id);
      if (sched && sched->fertigation_payload_json[0]) {
        command_item_t *cmd = calloc(1, sizeof(command_item_t));
        if (cmd) {
          snprintf(cmd->command_id, sizeof(cmd->command_id), "cmd-%.30s", head->queue_id);
          cmd->type = CMD_TYPE_FERTIGATION_BATCH;
          cmd->status = CMD_STATUS_PENDING;
          const system_storage_state_t *st = storage_mgr_get_state();
          cmd->configuration_version = st ? st->config_version : 0;
          copy_string(cmd->source, sizeof(cmd->source), "SCHEDULER");
          copy_string(cmd->target_complex_id, sizeof(cmd->target_complex_id), sched->complex_id);
          copy_string(cmd->target_gh_id, sizeof(cmd->target_gh_id), head->gh_id);
          cmd->submitted_at = (int64_t)now;

          cJSON *root = cJSON_Parse(sched->fertigation_payload_json);
          if (root) {
            cJSON_AddStringToObject(root, "queueId", head->queue_id);
            cJSON_AddStringToObject(root, "occurrenceId", head->occurrence_id);
            cJSON_AddStringToObject(root, "batchId", head->batch_id);
            cJSON_AddStringToObject(root, "runId", head->batch_id);
            cJSON_AddStringToObject(root, "targetGhId", head->gh_id);
            char *pstr = cJSON_PrintUnformatted(root);
            if (pstr) {
              copy_string(cmd->fertigation_payload_json, sizeof(cmd->fertigation_payload_json), pstr);
              free(pstr);
            }
            cJSON_Delete(root);
          } else {
            copy_string(cmd->fertigation_payload_json, sizeof(cmd->fertigation_payload_json), sched->fertigation_payload_json);
          }

          esp_err_t err = command_mgr_submit(cmd, NULL);
          free(cmd);
          if (err == ESP_OK) {
            head->state = QUEUE_STATE_DISPATCHED;
            head->dispatched_at_ms = (int64_t)(esp_timer_get_time() / 1000ULL);
            ESP_LOGI(TAG, "Global Dosing Queue HEAD %s dispatched (latch set)", head->queue_id);
          } else {
            ESP_LOGE(TAG, "Global Dosing Queue HEAD %s dispatch rejected: %d", head->queue_id, err);
            char rej_code[32] = {0}, rej_comp[32] = {0};
            fertigation_mgr_get_last_rejection(rej_code, sizeof(rej_code), rej_comp, sizeof(rej_comp));
            if (rej_code[0]) {
              copy_string(head->error_code, sizeof(head->error_code), rej_code);
              copy_string(head->affected_component_id, sizeof(head->affected_component_id), rej_comp);
            } else {
              copy_string(head->error_code, sizeof(head->error_code), "DISPATCH_REJECTED");
            }
            head->state = QUEUE_STATE_FAILED;
          }
        } else {
          copy_string(head->error_code, sizeof(head->error_code), "MEMORY_ALLOC_FAILED");
          head->state = QUEUE_STATE_FAILED;
        }
      } else {
        copy_string(head->error_code, sizeof(head->error_code), "INVALID_RECIPE_PARAMETERS");
        head->state = QUEUE_STATE_FAILED;
      }
    }
  } else if (head->state == QUEUE_STATE_DISPATCHED) {
    if (fert_st == FERT_STATE_PRECHECK || fert_st == FERT_STATE_MIXING) {
      char q_id[48] = {0}, occ_id[48] = {0}, b_id[48] = {0}, gh[48] = {0};
      fertigation_mgr_get_correlation(q_id, sizeof(q_id), occ_id, sizeof(occ_id),
                                      b_id, sizeof(b_id), gh, sizeof(gh));
      if (strcmp(q_id, head->queue_id) == 0 &&
          strcmp(occ_id, head->occurrence_id) == 0 &&
          strcasecmp(gh, head->gh_id) == 0) {
        head->state = QUEUE_STATE_ACTIVE;
        ESP_LOGI(TAG, "Queue entry %s confirmed ACTIVE by physical fertigation_mgr", head->queue_id);
      }
    }

    int64_t now_ms = (int64_t)(esp_timer_get_time() / 1000ULL);
    if (head->state == QUEUE_STATE_DISPATCHED && (now_ms - head->dispatched_at_ms > 15000)) {
      ESP_LOGE(TAG, "Queue entry %s physical start watchdog expired", head->queue_id);
      head->state = QUEUE_STATE_FAILED;
      copy_string(head->error_code, sizeof(head->error_code), "WATCHDOG_TIMEOUT");
      for (size_t i = 0; i < s_today_occurrence_count; i++) {
        if (strcmp(s_today_occurrences[i].occurrence_id, head->occurrence_id) == 0) {
          s_today_occurrences[i].state = OCC_STATE_FAILED;
          copy_string(s_today_occurrences[i].error_code, sizeof(s_today_occurrences[i].error_code), "WATCHDOG_TIMEOUT");
          break;
        }
      }
      for (size_t i = 1; i < s_dosing_queue_count; i++) {
        s_dosing_queue[i - 1] = s_dosing_queue[i];
      }
      s_dosing_queue_count--;
    }
  } else if (head->state == QUEUE_STATE_ACTIVE) {
    char q_id[48] = {0}, occ_id[48] = {0}, b_id[48] = {0}, gh[48] = {0};
    fertigation_mgr_get_correlation(q_id, sizeof(q_id), occ_id, sizeof(occ_id),
                                    b_id, sizeof(b_id), gh, sizeof(gh));
    bool correlation_matches = (strcmp(q_id, head->queue_id) == 0 &&
                                strcmp(occ_id, head->occurrence_id) == 0 &&
                                strcasecmp(gh, head->gh_id) == 0);
    (void)correlation_matches;
    if (fertigation_mgr_is_batch_ready(head->gh_id, head->occurrence_id)) {
      head->state = QUEUE_STATE_COMPLETED;
      ESP_LOGI(TAG, "Batch %s completed preparation, reached READY_TO_SEND", head->batch_id);

      for (size_t i = 0; i < s_today_occurrence_count; i++) {
        if (strcmp(s_today_occurrences[i].occurrence_id, head->occurrence_id) == 0) {
          if (s_today_occurrences[i].state == OCC_STATE_WAITING_BATCH) {
            s_today_occurrences[i].state = OCC_STATE_DISTRIBUTING;
            fertigation_mgr_trigger_distribution(head->gh_id, head->occurrence_id);
            ESP_LOGI(TAG, "WAITING_BATCH occurrence %s immediately distributing!", s_today_occurrences[i].occurrence_id);
          } else {
            s_today_occurrences[i].state = OCC_STATE_READY_TO_SEND;
            ESP_LOGI(TAG, "Occurrence %s holding in READY_TO_SEND until due time", s_today_occurrences[i].occurrence_id);
          }
          break;
        }
      }

      for (size_t i = 1; i < s_dosing_queue_count; i++) {
        s_dosing_queue[i - 1] = s_dosing_queue[i];
      }
      s_dosing_queue_count--;
      try_enqueue_pending_preparations(now);
    } else if (fert_st == FERT_STATE_FAULTED || fert_st == FERT_STATE_ABORTED || fert_st == FERT_STATE_INTERRUPTED) {
      head->state = QUEUE_STATE_FAILED;
      fertigation_last_terminal_t term = {0};
      if (fertigation_mgr_get_last_terminal_for_run(head->batch_id, &term) == ESP_OK && term.fault[0]) {
        copy_string(head->error_code, sizeof(head->error_code), term.fault);
      } else {
        copy_string(head->error_code, sizeof(head->error_code), "MIXING_FAULT");
      }
      ESP_LOGE(TAG, "Batch %s preparation faulted: %s", head->batch_id, head->error_code);
      for (size_t i = 0; i < s_today_occurrence_count; i++) {
        if (strcmp(s_today_occurrences[i].occurrence_id, head->occurrence_id) == 0) {
          s_today_occurrences[i].state = OCC_STATE_FAILED;
          copy_string(s_today_occurrences[i].error_code, sizeof(s_today_occurrences[i].error_code), head->error_code);
          break;
        }
      }
      for (size_t i = 1; i < s_dosing_queue_count; i++) {
        s_dosing_queue[i - 1] = s_dosing_queue[i];
      }
      s_dosing_queue_count--;
      try_enqueue_pending_preparations(now);
    }
  }
}

static void evaluate_today_occurrences(time_t now) {
  for (size_t i = 0; i < s_today_occurrence_count; i++) {
    today_occurrence_t *occ = &s_today_occurrences[i];
    if ((int64_t)now >= occ->scheduled_timestamp) {
      if (occ->state == OCC_STATE_READY_TO_SEND) {
        if (fertigation_mgr_is_batch_ready(occ->gh_id, occ->occurrence_id)) {
          esp_err_t err = fertigation_mgr_trigger_distribution(occ->gh_id, occ->occurrence_id);
          if (err == ESP_OK) {
            occ->state = OCC_STATE_DISTRIBUTING;
            ESP_LOGI(TAG, "Occurrence %s scheduled time arrived; triggered distribution for GH %s",
                     occ->occurrence_id, occ->gh_id);
          }
        }
      } else if (occ->state == OCC_STATE_PREPARING) {
        occ->state = OCC_STATE_WAITING_BATCH;
        ESP_LOGI(TAG, "Occurrence %s scheduled time arrived while still preparing -> WAITING_BATCH",
                 occ->occurrence_id);
      }
    }
  }
}

static void check_distribution_completions(void) {
  for (size_t i = 0; i < s_today_occurrence_count; i++) {
    today_occurrence_t *occ = &s_today_occurrences[i];
    if (occ->state == OCC_STATE_DISTRIBUTING) {
      delivery_slot_state_t slot_st;
      if (fertigation_mgr_get_delivery_slot_status(occ->gh_id, occ->occurrence_id, &slot_st) == ESP_OK) {
        if (slot_st == DELIVERY_SLOT_COMPLETE) {
          occ->state = OCC_STATE_COMPLETED;
          ESP_LOGI(TAG, "Occurrence %s distribution completed successfully!", occ->occurrence_id);

          runtime_schedule_t *rs = find_schedule_by_id(occ->schedule_id);
          if (rs) {
            marker_update(rs, MARKER_COMPLETE, occ->scheduled_timestamp, time(NULL), occ->batch_id);
          }

          fertigation_mgr_acknowledge_delivery(occ->gh_id, occ->occurrence_id);

          for (size_t j = 0; j < s_today_occurrence_count; j++) {
            if (strcmp(s_today_occurrences[j].gh_id, occ->gh_id) == 0 &&
                s_today_occurrences[j].state == OCC_STATE_PENDING) {
              esp_err_t eq_err = enqueue_preparation(&s_today_occurrences[j]);
              if (eq_err == ESP_OK) {
                ESP_LOGI(TAG, "Next preparation chained for GH %s: occurrence %s",
                         occ->gh_id, s_today_occurrences[j].occurrence_id);
              }
              break;
            }
          }
        } else if (slot_st == DELIVERY_SLOT_FAULTED) {
          occ->state = OCC_STATE_FAILED;
          ESP_LOGE(TAG, "Occurrence %s distribution failed (slot faulted)", occ->occurrence_id);
          fertigation_mgr_acknowledge_delivery(occ->gh_id, occ->occurrence_id);
        }
      } else {
        fertigation_state_t st = fertigation_mgr_get_state();
        if (st == FERT_STATE_COMPLETE || st == FERT_STATE_IDLE) {
          fertigation_last_terminal_t term;
          // ITEM-2: Use per-run terminal lookup so we get THIS occurrence's
          // terminal state, not whichever slot happened to terminal last.
          // occ->batch_id is the run_id we submitted to fertigation_mgr.
          esp_err_t term_err;
          if (occ->batch_id[0]) {
            term_err = fertigation_mgr_get_last_terminal_for_run(occ->batch_id, &term);
          } else {
            term_err = fertigation_mgr_get_last_terminal(&term);
          }
          if (term_err == ESP_OK && term.state == FERT_STATE_COMPLETE) {
            occ->state = OCC_STATE_COMPLETED;
            ESP_LOGI(TAG, "Occurrence %s distribution completed successfully!", occ->occurrence_id);

            runtime_schedule_t *rs = find_schedule_by_id(occ->schedule_id);
            if (rs) {
              marker_update(rs, MARKER_COMPLETE, occ->scheduled_timestamp, time(NULL), occ->batch_id);
            }

            for (size_t j = 0; j < s_today_occurrence_count; j++) {
              if (strcmp(s_today_occurrences[j].gh_id, occ->gh_id) == 0 &&
                  s_today_occurrences[j].state == OCC_STATE_PENDING) {
                esp_err_t eq_err = enqueue_preparation(&s_today_occurrences[j]);
                if (eq_err == ESP_OK) {
                  ESP_LOGI(TAG, "Next preparation chained for GH %s: occurrence %s",
                           occ->gh_id, s_today_occurrences[j].occurrence_id);
                }
                break;
              }
            }
          } else if (term.state == FERT_STATE_FAULTED || term.state == FERT_STATE_ABORTED) {
            occ->state = OCC_STATE_FAILED;
            ESP_LOGE(TAG, "Occurrence %s distribution failed", occ->occurrence_id);
          }
        }
      }
    }
  }
}

/* Forward declarations for schedule-window reconciliation & lazy_start */
static bool s_lazy_start_done = false;
esp_err_t scheduler_reconcile_fan_schedule(time_t now);
bool scheduler_is_lazy_start_done(void);
static bool is_well_pump_schedule(const runtime_schedule_t *rs);
static bool is_fan_schedule(const runtime_schedule_t *rs, const char *target_component);
static bool has_fertigation_schedules(void);

esp_err_t scheduler_evaluate_at(time_t now) {
  if (!local_clock_valid(now))
    return ESP_ERR_INVALID_STATE;
  if (!s_mutex)
    return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE)
    return ESP_FAIL;

  refresh_running_state();

  struct tm tm_now;
  localtime_r(&now, &tm_now);

  bool daily_trigger_needed = false;

  /* Condition 1: Midnight / Day Boundary Rollover */
  if (s_today_yday != tm_now.tm_yday) {
    s_today_yday = tm_now.tm_yday;
    daily_trigger_needed = true;
  }

  /* Condition 2: Untriggered day recovery (Booted mid-day, clock locked, or daily trigger uncompleted for today) */
  if (s_daily_trigger_completed_yday != tm_now.tm_yday ||
      s_daily_trigger_completed_year != tm_now.tm_year) {
    daily_trigger_needed = true;
  }

  /* Condition 3: Missing occurrences recovery (e.g. fertigation schedules loaded/synced after boot or power loss).
   * Only triggers when at least one active FERTIGATION schedule exists in s_runtime[] but produced zero occurrences.
   * Throttled to every 30 minutes (1800s). When all runtime schedules are non-fertigation (WATER_PUMP / FAN_TOGGLE),
   * this path is bypassed to eliminate false 30-minute re-materialization. */
  static time_t s_last_zero_occ_check_sec = 0;
  bool has_fert = has_fertigation_schedules();
  if (has_fert && s_today_occurrence_count == 0 && s_runtime_count > 0) {
    if (s_last_zero_occ_check_sec == 0 || (now - s_last_zero_occ_check_sec >= 1800)) {
      s_last_zero_occ_check_sec = now;
      daily_trigger_needed = true;
    }
  } else if (s_today_occurrence_count > 0 || !has_fert) {
    s_last_zero_occ_check_sec = 0;
  }

  /* Condition 4: Autonomous 2-Hour Periodic Guard (Every 7200 seconds / 2 hours) */
  static time_t s_last_periodic_check_sec = 0;
  if (now - s_last_periodic_check_sec >= 7200) {
    s_last_periodic_check_sec = now;
    if (s_runtime_count > 0) {
      if (has_fert && s_today_occurrence_count == 0) {
        daily_trigger_needed = true;
      } else {
        try_enqueue_pending_preparations(now);
      }
    }
  }

  if (daily_trigger_needed) {
    s_today_yday = tm_now.tm_yday;
    s_daily_trigger_completed_yday = tm_now.tm_yday;
    s_daily_trigger_completed_year = tm_now.tm_year;
    if (s_runtime_count > 0) {
      materialize_today_schedule(now);
      size_t fert_sched_count = 0;
      size_t pump_sched_count = 0;
      size_t fan_sched_count = 0;
      for (size_t i = 0; i < s_runtime_count; i++) {
        runtime_schedule_t *rs = &s_runtime[i];
        if (!rs->valid) continue;
        if (strcmp(rs->action, "FERTIGATION") == 0) {
          fert_sched_count++;
        } else if (is_well_pump_schedule(rs)) {
          pump_sched_count++;
        } else if (is_fan_schedule(rs, NULL)) {
          fan_sched_count++;
        }
      }
      ESP_LOGI(TAG, "Daily schedule trigger executed for yday %d (schedules=%u, fert=%u, pump=%u, fan=%u, fert_occurrences=%u)",
               tm_now.tm_yday, (unsigned)s_runtime_count, (unsigned)fert_sched_count,
               (unsigned)pump_sched_count, (unsigned)fan_sched_count, (unsigned)s_today_occurrence_count);
      try_enqueue_pending_preparations(now);
    }
  }

  /* Eager pre-mix invariant (Spec Section 10.3, 10.4 & 14):
   * When queue has capacity (or is empty) and there are pending occurrences for today,
   * immediately enqueue the next pending occurrence for any unoccupied greenhouse. */
  if (s_dosing_queue_count < MAX_DOSING_QUEUE && s_today_occurrence_count > 0) {
    try_enqueue_pending_preparations(now);
  }

  process_dosing_queue(now);
  evaluate_today_occurrences(now);
  check_distribution_completions();

  runtime_schedule_t *due[MAX_COMPILED_SCHEDULES];
  int64_t occurrences[MAX_COMPILED_SCHEDULES];
  bool missed[MAX_COMPILED_SCHEDULES];
  size_t due_count = 0;

  for (size_t i = 0; i < s_runtime_count; ++i) {
    runtime_schedule_t *sched = &s_runtime[i];
    if (!sched->valid || sched->running ||
        sched->marker_state == MARKER_RECOVERY_HOLD)
      continue;

    /* FERTIGATION schedules are governed by Today's Operational Schedule and Global Dosing Queue */
    if (strcmp(sched->action, "FERTIGATION") == 0)
      continue;

    /* WATER_PUMP and FAN_TOGGLE are state-reconciled directly against the active schedule window */
    if (strcmp(sched->action, "WATER_PUMP") == 0 ||
        strcmp(sched->action, "FAN_TOGGLE") == 0 ||
        (sched->component_count > 0 &&
         (strcmp(sched->component_ids[0], "pump_well") == 0 ||
          strcasestr(sched->component_ids[0], "fan") != NULL ||
          strcasestr(sched->component_ids[0], "blower") != NULL))) {
      continue;
    }

    int64_t occurrence = 0;
    bool is_missed = false;
    if (sched->pending && sched->pending_occurrence_timestamp > 0) {
      occurrence = sched->pending_occurrence_timestamp;
      is_missed = true;
    } else if (!occurrence_is_due(sched, now, &occurrence, &is_missed)) {
      continue;
    }

    if (sched->type == SCHED_TYPE_ONCE &&
        sched->last_occurrence_timestamp >= occurrence)
      continue;

    if (is_missed && sched->recovery_window_sec > 0 &&
        ((int64_t)now - occurrence) > (int64_t)sched->recovery_window_sec) {
      mark_skipped(sched, occurrence, "Schedule recovery window expired");
      continue;
    }

    if (is_missed && !missed_policy_execute(sched) && !sched->pending) {
      mark_skipped(sched, occurrence,
                   "Schedule occurrence was missed and policy=SKIP");
      continue;
    }

    due[due_count] = sched;
    occurrences[due_count] = occurrence;
    missed[due_count] = is_missed;
    due_count++;
  }

  /* Higher priority work gets first opportunity to acquire conflicting
   * resources. */
  for (size_t i = 0; i < due_count; ++i) {
    for (size_t j = i + 1; j < due_count; ++j) {
      if (compare_due_slots(&due[i], &due[j]) > 0) {
        runtime_schedule_t *tmp_s = due[i];
        due[i] = due[j];
        due[j] = tmp_s;
        int64_t tmp_o = occurrences[i];
        occurrences[i] = occurrences[j];
        occurrences[j] = tmp_o;
        bool tmp_m = missed[i];
        missed[i] = missed[j];
        missed[j] = tmp_m;
      }
    }
  }

  for (size_t i = 0; i < due_count; ++i) {
    runtime_schedule_t *sched = due[i];
    const int64_t occurrence = occurrences[i];
    (void)missed[i];
    if (!safety_monitor_allows_scheduler()) {
      const bool was_pending = sched->pending;
      sched->pending = true;
      sched->pending_occurrence_timestamp = occurrence;
      if (!was_pending) {
        marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp,
                      sched->last_execution_timestamp, NULL);
        (void)event_mgr_log_command(
            LOG_LEVEL_WARNING, "SCHEDULE_BLOCKED_SAFETY",
            "Schedule occurrence held while local safety policy blocks "
            "execution.",
            sched->schedule_id, sched->complex_id, sched->gh_id,
            sched->component_count ? sched->component_ids[0] : NULL,
            sched->resource_count ? sched->resources[0].resource_id : NULL,
            sched->configuration_version);
      }
      continue;
    }
    if (resource_conflicts(sched)) {
      /* Conflict is a runtime queue condition, not a silent skip. Keep the
       * occurrence pending so a later tick can execute it when the resource
       * becomes available. Persist only when the queued state changes to avoid
       * writing flash every scheduler tick. */
      const bool was_pending = sched->pending;
      sched->pending = true;
      sched->pending_occurrence_timestamp = occurrence;
      if (!was_pending) {
        marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp,
                      sched->last_execution_timestamp, "");
        ESP_LOGW(TAG, "Schedule '%s' queued behind a resource conflict",
                 sched->schedule_id);
      }
      continue;
    }
    if (!acquire_resource_locks(sched)) {
      const bool was_pending = sched->pending;
      sched->pending = true;
      sched->pending_occurrence_timestamp = occurrence;
      if (!was_pending) {
        marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp,
                      sched->last_execution_timestamp, NULL);
        (void)event_mgr_log_command(
            LOG_LEVEL_WARNING, "SCHEDULE_SKIPPED",
            "Resource lock acquisition failed; occurrence remains queued.",
            sched->schedule_id, sched->complex_id, sched->gh_id,
            sched->component_count ? sched->component_ids[0] : NULL,
            sched->resource_count ? sched->resources[0].resource_id : NULL,
            sched->configuration_version);
      }
      continue;
    }
    esp_err_t err = dispatch_runtime_schedule(sched, occurrence, now);
    if (err != ESP_OK) {
      release_resource_locks(sched);
      const bool was_pending = sched->pending;
      sched->pending = true;
      sched->pending_occurrence_timestamp = occurrence;
      if (!was_pending)
        marker_update(sched, MARKER_PENDING, sched->last_occurrence_timestamp,
                      sched->last_execution_timestamp, NULL);
      if (err == ESP_ERR_INVALID_STATE && actuator_hal_is_emergency_stopped()) {
        if (!was_pending)
          (void)event_mgr_log_command(
              LOG_LEVEL_WARNING, "SCHEDULE_SKIPPED",
              "Schedule held while emergency stop is latched.",
              sched->schedule_id, sched->complex_id, sched->gh_id,
              sched->component_count ? sched->component_ids[0] : NULL,
              sched->resource_count ? sched->resources[0].resource_id : NULL,
              sched->configuration_version);
      } else if (!was_pending) {
        (void)event_mgr_log_command(
            LOG_LEVEL_WARNING, "SCHEDULE_SKIPPED",
            "Command dispatch failed; occurrence remains queued.",
            sched->schedule_id, sched->complex_id, sched->gh_id,
            sched->component_count ? sched->component_ids[0] : NULL,
            sched->resource_count ? sched->resources[0].resource_id : NULL,
            sched->configuration_version);
      }
    }
  }

  xSemaphoreGive(s_mutex);

  /* Reconcile Well Pump and Fan/Blower scheduled states outside s_mutex */
  if (s_lazy_start_done) {
    (void)scheduler_reconcile_fan_schedule(now);
    (void)well_pump_reconcile_schedule(now);
  }

  return ESP_OK;
}

static void scheduler_task(void *pvParameters) {
  (void)pvParameters;
  TickType_t last_wake = xTaskGetTickCount();
  ESP_LOGI(TAG,
           "Production runtime scheduler active: 1 second evaluation tick");
  // RC-7: Register scheduler_task to Task WDT so watchdog resets identify
  // the stuck task by name (vs generic "IDLE (CPU 1)" message).
  esp_task_wdt_add(NULL);
  static bool s_clock_warned = false;
  while (1) {
    vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(SCHEDULER_TICK_MS));
    esp_task_wdt_reset();  // RC-7: Feed WDT each tick
    time_t now;
    time(&now);
    esp_err_t err = scheduler_evaluate_at(now);
    if (err == ESP_ERR_INVALID_STATE) {
      if (!s_clock_warned) {
        ESP_LOGW(TAG, "Local clock not yet valid; schedule evaluation held");
        s_clock_warned = true;
      }
    } else {
      s_clock_warned = false;
    }
  }
}

esp_err_t scheduler_get_all(schedule_entry_t *out_entries, size_t max_entries,
                            size_t *out_count) {
  if (!out_entries || !out_count || !s_mutex)
    return ESP_ERR_INVALID_ARG;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE)
    return ESP_FAIL;
  size_t count = s_runtime_count < max_entries ? s_runtime_count : max_entries;
  for (size_t i = 0; i < count; ++i) {
    runtime_schedule_t *src = &s_runtime[i];
    schedule_entry_t *dst = &out_entries[i];
    memset(dst, 0, sizeof(*dst));
    copy_string(dst->id, sizeof(dst->id), src->schedule_id);
    dst->enabled = src->valid;
    dst->type = src->type;
    dst->action =
        strcmp(src->action, "FERTIGATION") == 0  ? SCHED_ACTION_FERTIGATION
        : strcmp(src->action, "WATER_PUMP") == 0 ? SCHED_ACTION_WATER_PUMP
        : strcmp(src->action, "FAN_TOGGLE") == 0 ? SCHED_ACTION_FAN_TOGGLE
                                                 : SCHED_ACTION_CUSTOM;
    dst->duration_sec = (uint32_t)src->duration_sec;
    dst->hour = src->hour;
    dst->minute = src->minute;
    dst->days_of_week = src->days_of_week;
    dst->interval_min = src->interval_min;
    dst->last_execution_timestamp = src->last_execution_timestamp;
    dst->is_running = src->running || src->pending;
    copy_string(dst->current_command_id, sizeof(dst->current_command_id),
                src->current_command_id);
  }
  *out_count = count;
  xSemaphoreGive(s_mutex);
  return ESP_OK;
}

esp_err_t scheduler_add_entry(const schedule_entry_t *entry) {
  (void)entry;
  return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t scheduler_remove_entry(const char *id) {
  (void)id;
  return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t scheduler_clear_all(void) { return scheduler_clear_compiled(); }

esp_err_t scheduler_init(void) {
  if (s_initialized)
    return ESP_OK;
  s_mutex = xSemaphoreCreateMutex();
  if (!s_mutex)
    return ESP_ERR_NO_MEM;

  memset(s_runtime, 0, sizeof(s_runtime));
  s_runtime_count = 0;
  load_markers();
  apply_timezone_from_active_config();

  /* Schedule intents (SPIFFS) are authoritative; they carry the execution plan. */
  (void)sync_intents_locked();

  /* Legacy fallback: compiled runtime set in NVS when no intents exist */
  char *compiled = s_runtime_count == 0 ? calloc(1, MAX_COMPILED_JSON) : NULL;
  if (compiled) {
    size_t len = 0;
    if (load_compiled_runtime_json(compiled, MAX_COMPILED_JSON, &len) ==
            ESP_OK &&
        len > 0) {
      runtime_schedule_t *parsed =
          calloc(MAX_COMPILED_SCHEDULES, sizeof(runtime_schedule_t));
      if (parsed) {
        size_t count = 0;
        if (parse_runtime_set(compiled, parsed, &count) == ESP_OK) {
          memcpy(s_runtime, parsed, count * sizeof(runtime_schedule_t));
          s_runtime_count = count;
          hydrate_runtime_markers();
        } else {
          ESP_LOGE(TAG, "Persisted compiled schedule set is invalid; scheduler "
                        "starts with no executable schedules");
        }
        free(parsed);
      }
    }
    free(compiled);
  }

  const system_storage_state_t *state = storage_mgr_get_state();
  if (state) {
    ESP_LOGI(TAG, "Loaded %u compiled schedule(s), config v%lu, boot #%lu",
             (unsigned)s_runtime_count, (unsigned long)state->config_version,
             (unsigned long)state->boot_count);
  }
  if (s_runtime_count > 0) {
    for (size_t i = 0; i < s_runtime_count; ++i) {
      if (s_runtime[i].marker_state == MARKER_RECOVERY_HOLD) {
        (void)event_mgr_log(LOG_LEVEL_WARNING, "SCHEDULER",
                            "SCHEDULE_RECOVERY_HOLD",
                            "A previously running schedule was held after "
                            "reboot to prevent duplicate physical execution",
                            NULL);
      }
    }
  }

  s_initialized = true;

  time_t init_now;
  time(&init_now);
  if (local_clock_valid(init_now)) {
    struct tm tm_init;
    localtime_r(&init_now, &tm_init);
    s_today_yday = tm_init.tm_yday;
    materialize_today_schedule(init_now);
    rebuild_dosing_queue_on_boot(init_now);
    if (s_runtime_count > 0) {
      s_daily_trigger_completed_yday = tm_init.tm_yday;
      s_daily_trigger_completed_year = tm_init.tm_year;
    }
  }

  /* STACK-HEADROOM: 6144 B stack provides ample margin (>3.5KB) for deep schedule dispatch, command validation and stdio logging. */
  if (xTaskCreatePinnedToCore(scheduler_task, "scheduler", 6144, NULL, 4, NULL,
                              1) != pdPASS) {
    s_initialized = false;
    vSemaphoreDelete(s_mutex);
    s_mutex = NULL;
    return ESP_ERR_NO_MEM;
  }
  // RC-1: Spawn marker_persist_task di Core 1 untuk memproses NVS write marker
  // secara asynchronous (di luar s_mutex). Prioritas 2 lebih rendah dari
  // scheduler_task (prio 4) agar tidak mengganggu evaluation tick.
  if (xTaskCreatePinnedToCore(marker_persist_task, "mk_persist",
                              MARKER_PERSIST_TASK_STACK, NULL,
                              MARKER_PERSIST_TASK_PRIO,
                              &s_marker_persist_task_handle, 1) != pdPASS) {
    ESP_LOGE(TAG, "Failed to create marker_persist_task; "
                  "marker persistence akan tertunda");
    s_marker_persist_task_handle = NULL;
  }
  return ESP_OK;
}

esp_err_t scheduler_get_dosing_queue(dosing_queue_entry_t *out_entries, size_t max_entries, size_t *out_count) {
  if (!out_entries || !out_count) return ESP_ERR_INVALID_ARG;
  if (!s_mutex) return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
  size_t count = s_dosing_queue_count < max_entries ? s_dosing_queue_count : max_entries;
  for (size_t i = 0; i < count; i++) {
    out_entries[i] = s_dosing_queue[i];
  }
  *out_count = count;
  xSemaphoreGive(s_mutex);
  return ESP_OK;
}

esp_err_t scheduler_get_today_occurrences(today_occurrence_t *out_occurrences, size_t max_occurrences, size_t *out_count) {
  if (!out_occurrences || !out_count) return ESP_ERR_INVALID_ARG;
  if (!s_mutex) return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
  size_t count = s_today_occurrence_count < max_occurrences ? s_today_occurrence_count : max_occurrences;
  for (size_t i = 0; i < count; i++) {
    out_occurrences[i] = s_today_occurrences[i];
  }
  *out_count = count;
  xSemaphoreGive(s_mutex);
  return ESP_OK;
}

esp_err_t scheduler_get_next_occurrence(today_occurrence_t *out_occ) {
  if (!out_occ) return ESP_ERR_INVALID_ARG;
  if (!s_mutex) return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

  time_t now = time(NULL);
  struct tm tm_now;
  bool clock_ok = local_clock_valid(now);
  if (clock_ok) {
    localtime_r(&now, &tm_now);
    if (has_fertigation_schedules() && s_today_occurrence_count == 0 && s_runtime_count > 0) {
      materialize_today_schedule(now);
    }
  }

  bool found = false;
  int best_idx = -1;
  int64_t min_timestamp = INT64_MAX;

  for (size_t i = 0; i < s_today_occurrence_count; i++) {
    today_occurrence_t *occ = &s_today_occurrences[i];
    if (occ->scheduled_timestamp <= 0) continue;
    if (occ->state == OCC_STATE_COMPLETED || occ->state == OCC_STATE_FAILED) {
      continue;
    }
    if (occ->state == OCC_STATE_DISTRIBUTING) {
      continue;
    }
    if (clock_ok) {
      time_t occ_sec = (time_t)occ->scheduled_timestamp;
      struct tm tm_occ;
      localtime_r(&occ_sec, &tm_occ);
      if (tm_occ.tm_year != tm_now.tm_year || tm_occ.tm_yday != tm_now.tm_yday) {
        continue;
      }
    }
    if (occ->scheduled_timestamp < min_timestamp) {
      min_timestamp = occ->scheduled_timestamp;
      best_idx = (int)i;
    }
  }

  if (best_idx >= 0) {
    *out_occ = s_today_occurrences[best_idx];
    found = true;
  }

  xSemaphoreGive(s_mutex);
  return found ? ESP_OK : ESP_ERR_NOT_FOUND;
}

bool scheduler_is_daily_triggered_today(void) {
  time_t now = time(NULL);
  if (!local_clock_valid(now)) return false;
  struct tm tm_now;
  localtime_r(&now, &tm_now);
  return (s_daily_trigger_completed_yday == tm_now.tm_yday &&
          s_daily_trigger_completed_year == tm_now.tm_year);
}

esp_err_t scheduler_trigger_daily_now(void) {
  if (!s_mutex) return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
  time_t now = time(NULL);
  if (!local_clock_valid(now)) {
    xSemaphoreGive(s_mutex);
    return ESP_ERR_INVALID_STATE;
  }
  struct tm tm_now;
  localtime_r(&now, &tm_now);
  s_today_yday = tm_now.tm_yday;
  s_daily_trigger_completed_yday = tm_now.tm_yday;
  s_daily_trigger_completed_year = tm_now.tm_year;
  materialize_today_schedule(now);
  try_enqueue_pending_preparations(now);
  xSemaphoreGive(s_mutex);
  return ESP_OK;
}

static bool has_fertigation_schedules(void) {
  for (size_t i = 0; i < s_runtime_count; i++) {
    if (s_runtime[i].valid && strcmp(s_runtime[i].action, "FERTIGATION") == 0) {
      return true;
    }
  }
  return false;
}

static bool is_well_pump_schedule(const runtime_schedule_t *rs) {
  if (!rs || !rs->valid) return false;
  if (strcmp(rs->action, "WATER_PUMP") == 0) return true;
  if (strcasestr(rs->action, "WELL") != NULL) return true;
  if (rs->component_count > 0) {
    if (strcasecmp(rs->component_ids[0], "pump_well") == 0 ||
        strcasecmp(rs->component_ids[0], "well_pump") == 0 ||
        strcasecmp(rs->component_ids[0], "wp-main") == 0 ||
        strcasestr(rs->component_ids[0], "well") != NULL) {
      return true;
    }
  }
  return false;
}

static bool is_fan_schedule(const runtime_schedule_t *rs, const char *target_component) {
  if (!rs || !rs->valid) return false;
  bool is_fan_action = (strcmp(rs->action, "FAN_TOGGLE") == 0 ||
                        strcasestr(rs->action, "FAN") != NULL ||
                        strcasestr(rs->action, "BLOWER") != NULL);
  bool is_fan_comp = (rs->component_count > 0 &&
                      (strcasestr(rs->component_ids[0], "fan") != NULL ||
                       strcasestr(rs->component_ids[0], "blower") != NULL));
  if (!is_fan_action && !is_fan_comp) return false;

  /* Cabinet fan is powered directly from PSU +/- and is not controlled by ESP32 */
  if (rs->component_count > 0 &&
      (strcasestr(rs->component_ids[0], "cooling") != NULL ||
       strcasestr(rs->component_ids[0], "cabinet") != NULL)) {
    return false;
  }
  if (target_component &&
      (strcasestr(target_component, "cooling") != NULL ||
       strcasestr(target_component, "cabinet") != NULL)) {
    return false;
  }

  /* Check greenhouse scope if target component is registered with a greenhouse */
  if (rs->gh_id[0] && target_component && target_component[0]) {
    hw_component_info_t target_info;
    if (hardware_registry_find_by_id(target_component, &target_info) == ESP_OK) {
      if (target_info.assignment.gh_id[0] &&
          strcmp(rs->gh_id, target_info.assignment.gh_id) != 0) {
        return false;
      }
    }
  }

  if (!target_component || !target_component[0]) return true;

  const char *cid = (rs->component_count > 0 && rs->component_ids[0][0]) ? rs->component_ids[0] : NULL;
  if (cid) {
    if (strcasecmp(cid, target_component) == 0) return true;

    /* Resolve both component IDs to physical actuator IDs */
    actuator_id_t cid_act = ACTUATOR_MAX_COUNT;
    actuator_id_t tgt_act = ACTUATOR_MAX_COUNT;
    bool cid_has_act = (actuator_hal_find_id_by_component_id(cid, &cid_act) == ESP_OK);
    bool tgt_has_act = (actuator_hal_find_id_by_component_id(target_component, &tgt_act) == ESP_OK);

    if (cid_has_act && tgt_has_act && cid_act == tgt_act && cid_act != ACTUATOR_MAX_COUNT) {
      return true;
    }

    bool cid_is_blower = (strcasestr(cid, "blower") != NULL || strcasecmp(cid, "fan_blower") == 0);
    bool tgt_is_blower = (strcasestr(target_component, "blower") != NULL || strcasecmp(target_component, "fan_blower") == 0);
    if (cid_is_blower && tgt_is_blower) {
      return true;
    }

    return false;
  }

  /* Schedule action is FAN/BLOWER without specific component -> targets canonical fan_blower */
  return true;
}

bool scheduler_is_well_pump_schedule_active(time_t now, uint32_t *out_remaining_sec, char *out_schedule_id, size_t id_len) {
  if (!s_mutex || !local_clock_valid(now)) return false;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return false;

  struct tm tm_now;
  localtime_r(&now, &tm_now);
  int current_sec_of_day = tm_now.tm_hour * 3600 + tm_now.tm_min * 60 + tm_now.tm_sec;
  int current_dow = tm_now.tm_wday; // 0 = Sunday

  bool active = false;
  for (size_t i = 0; i < s_runtime_count; ++i) {
    runtime_schedule_t *rs = &s_runtime[i];
    if (!rs->valid) continue;
    if (!is_well_pump_schedule(rs)) continue;

    if (rs->type == SCHED_TYPE_DAILY || rs->type == SCHED_TYPE_INTERVAL) {
      if (!(rs->days_of_week & (1 << current_dow))) continue;

      int sched_start_sec = rs->hour * 3600 + rs->minute * 60;
      int sched_end_sec = sched_start_sec + rs->duration_sec;

      // Exact condition: schedule_start <= now < schedule_end
      if (current_sec_of_day >= sched_start_sec && current_sec_of_day < sched_end_sec) {
        active = true;
        if (out_remaining_sec) *out_remaining_sec = (uint32_t)(sched_end_sec - current_sec_of_day);
        if (out_schedule_id && id_len > 0) {
          strncpy(out_schedule_id, rs->schedule_id, id_len - 1);
          out_schedule_id[id_len - 1] = '\0';
        }
        break;
      }
    } else if (rs->type == SCHED_TYPE_ONCE) {
      // Exact condition: schedule_start <= now < schedule_end
      if (now >= rs->once_timestamp && now < (rs->once_timestamp + rs->duration_sec)) {
        active = true;
        if (out_remaining_sec) *out_remaining_sec = (uint32_t)((rs->once_timestamp + rs->duration_sec) - now);
        if (out_schedule_id && id_len > 0) {
          strncpy(out_schedule_id, rs->schedule_id, id_len - 1);
          out_schedule_id[id_len - 1] = '\0';
        }
        break;
      }
    }
  }

  xSemaphoreGive(s_mutex);
  return active;
}

bool scheduler_is_fan_schedule_active(time_t now, const char *target_component, uint32_t *out_remaining_sec, char *out_schedule_id, size_t id_len, char *out_component_id, size_t comp_len) {
  if (!s_mutex || !local_clock_valid(now)) return false;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return false;

  struct tm tm_now;
  localtime_r(&now, &tm_now);
  int current_sec_of_day = tm_now.tm_hour * 3600 + tm_now.tm_min * 60 + tm_now.tm_sec;
  int current_dow = tm_now.tm_wday; // 0 = Sunday

  bool active = false;
  for (size_t i = 0; i < s_runtime_count; ++i) {
    runtime_schedule_t *rs = &s_runtime[i];
    if (!rs->valid) continue;
    if (!is_fan_schedule(rs, target_component)) continue;

    if (rs->type == SCHED_TYPE_DAILY || rs->type == SCHED_TYPE_INTERVAL) {
      if (!(rs->days_of_week & (1 << current_dow))) continue;

      int sched_start_sec = rs->hour * 3600 + rs->minute * 60;
      int sched_end_sec = sched_start_sec + rs->duration_sec;

      // Exact condition: schedule_start <= now < schedule_end
      if (current_sec_of_day >= sched_start_sec && current_sec_of_day < sched_end_sec) {
        active = true;
        if (out_remaining_sec) *out_remaining_sec = (uint32_t)(sched_end_sec - current_sec_of_day);
        if (out_schedule_id && id_len > 0) {
          strncpy(out_schedule_id, rs->schedule_id, id_len - 1);
          out_schedule_id[id_len - 1] = '\0';
        }
        if (out_component_id && comp_len > 0) {
          const char *resolved_comp = (rs->component_count > 0 && rs->component_ids[0][0])
                                      ? rs->component_ids[0]
                                      : "fan_blower";
          strncpy(out_component_id, resolved_comp, comp_len - 1);
          out_component_id[comp_len - 1] = '\0';
        }
        break;
      }
    } else if (rs->type == SCHED_TYPE_ONCE) {
      // Exact condition: schedule_start <= now < schedule_end
      if (now >= rs->once_timestamp && now < (rs->once_timestamp + rs->duration_sec)) {
        active = true;
        if (out_remaining_sec) *out_remaining_sec = (uint32_t)((rs->once_timestamp + rs->duration_sec) - now);
        if (out_schedule_id && id_len > 0) {
          strncpy(out_schedule_id, rs->schedule_id, id_len - 1);
          out_schedule_id[id_len - 1] = '\0';
        }
        if (out_component_id && comp_len > 0) {
          const char *resolved_comp = (rs->component_count > 0 && rs->component_ids[0][0])
                                      ? rs->component_ids[0]
                                      : "fan_blower";
          strncpy(out_component_id, resolved_comp, comp_len - 1);
          out_component_id[comp_len - 1] = '\0';
        }
        break;
      }
    }
  }

  xSemaphoreGive(s_mutex);
  return active;
}

esp_err_t scheduler_reconcile_fan_schedule(time_t now) {
  if (!local_clock_valid(now)) return ESP_ERR_INVALID_STATE;

  char fan_comp_list[MAX_RUNTIME_COMPONENTS][32];
  actuator_id_t seen_actuators[MAX_RUNTIME_COMPONENTS];
  size_t fan_count = 0;

  size_t reg_count = hardware_registry_get_count();
  for (size_t i = 0; i < reg_count && fan_count < MAX_RUNTIME_COMPONENTS; i++) {
    hw_component_info_t info;
    if (hardware_registry_get_by_index(i, &info) != ESP_OK) continue;
    if (!hardware_registry_is_operational(info.component_id)) continue;

    bool is_fan = (strcasestr(info.role, "FAN") != NULL ||
                   strcasestr(info.role, "BLOWER") != NULL ||
                   strcasestr(info.supported_type_id, "fan") != NULL ||
                   strcasestr(info.supported_type_id, "blower") != NULL ||
                   strcasestr(info.component_id, "fan") != NULL ||
                   strcasestr(info.component_id, "blower") != NULL);
    if (!is_fan) continue;

    /* Cabinet fan is directly powered from PSU +/- and must NOT participate in fan reconciliation */
    if (strcasestr(info.role, "cooling") != NULL ||
        strcasestr(info.component_id, "cooling") != NULL ||
        strcasestr(info.component_id, "cabinet") != NULL) {
      continue;
    }

    actuator_id_t act_id = ACTUATOR_MAX_COUNT;
    if (actuator_hal_find_id_by_component_id(info.component_id, &act_id) != ESP_OK) continue;
    if (act_id == ACTUATOR_COOLING_FAN) continue;

    /* Deduplicate by resolved physical actuator ID */
    bool dup = false;
    for (size_t d = 0; d < fan_count; d++) {
      if (seen_actuators[d] == act_id) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      const char *canonical_comp = (act_id == ACTUATOR_BLOWER_FAN) ? "fan_blower" : info.component_id;
      strncpy(fan_comp_list[fan_count], canonical_comp, sizeof(fan_comp_list[fan_count]) - 1);
      fan_comp_list[fan_count][sizeof(fan_comp_list[fan_count]) - 1] = '\0';
      seen_actuators[fan_count] = act_id;
      fan_count++;
    }
  }

  /* Safe fallback to canonical blower fan if none discovered in hardware registry */
  if (fan_count == 0) {
    actuator_id_t act_id = ACTUATOR_MAX_COUNT;
    if (actuator_hal_find_id_by_component_id("fan_blower", &act_id) == ESP_OK) {
      strncpy(fan_comp_list[0], "fan_blower", sizeof(fan_comp_list[0]) - 1);
      fan_comp_list[0][sizeof(fan_comp_list[0]) - 1] = '\0';
      seen_actuators[0] = act_id;
      fan_count = 1;
    }
  }

  for (size_t f = 0; f < fan_count; f++) {
    const char *comp_id = fan_comp_list[f];
    actuator_id_t act_id = ACTUATOR_MAX_COUNT;
    if (actuator_hal_find_id_by_component_id(comp_id, &act_id) != ESP_OK) continue;

    bool safety_ok = !actuator_hal_is_emergency_stopped() && safety_monitor_allows_commands();

    uint32_t rem_sec = 0;
    char sched_id[40] = {0};
    bool is_active = safety_ok && scheduler_is_fan_schedule_active(now, comp_id, &rem_sec, sched_id, sizeof(sched_id), NULL, 0);

    bool currently_on = false;
    actuator_owner_t owner = ACTUATOR_OWNER_NONE;
    uint32_t runtime_sec = 0;
    (void)actuator_hal_get_component_status(comp_id, &currently_on, &owner, &runtime_sec);

    if (is_active) {
      if (!currently_on) {
        if (owner == ACTUATOR_OWNER_NONE || owner == ACTUATOR_OWNER_SCHEDULER) {
          (void)actuator_hal_acquire_component(comp_id, ACTUATOR_OWNER_SCHEDULER);
          esp_err_t set_err = actuator_hal_request_component(comp_id, true,
                                                             ACTUATOR_SOURCE_SCHEDULER,
                                                             "schedule_window_start");
          if (set_err == ESP_OK) {
            ESP_LOGI(TAG, "AUTO Schedule activated: Fan '%s' ON (sched '%s', %u s remaining)",
                     comp_id, sched_id, (unsigned)rem_sec);
          }
        }
      }
    } else {
      if (currently_on && owner == ACTUATOR_OWNER_SCHEDULER) {
        (void)actuator_hal_stop_component(comp_id, ACTUATOR_OWNER_SCHEDULER);
        (void)actuator_hal_release_component(comp_id, ACTUATOR_OWNER_SCHEDULER);
        ESP_LOGI(TAG, "AUTO Schedule window ended: Fan '%s' OFF", comp_id);
      }
    }
  }
  return ESP_OK;
}

static void lazy_start_task(void *pvParameters) {
  (void)pvParameters;
  ESP_LOGI(TAG, "lazy_start: deferred power-loss recovery check starting...");
  time_t now;
  time(&now);

  int retries = 0;
  while (!local_clock_valid(now) && retries < 20) {
    vTaskDelay(pdMS_TO_TICKS(500));
    time(&now);
    retries++;
  }

  if (!local_clock_valid(now)) {
    ESP_LOGW(TAG, "lazy_start: Clock not valid yet; skipping deferred reconciliation");
    s_lazy_start_done = true;
    vTaskDelete(NULL);
    return;
  }

  /* 1. Reconcile Fan / Blower schedules */
  (void)scheduler_reconcile_fan_schedule(now);

  /* 2. Ensure safety sensor readings are polled and fresh before restoring well pump */
  (void)sensor_hal_poll();

  /* 3. Reconcile Well Pump schedules */
  (void)well_pump_reconcile_schedule(now);

  s_lazy_start_done = true;
  ESP_LOGI(TAG, "lazy_start: Power-loss schedule reconciliation complete (one-shot).");

  vTaskDelete(NULL);
}

esp_err_t scheduler_schedule_lazy_start(void) {
  if (s_lazy_start_done) return ESP_OK;
  BaseType_t ret = xTaskCreatePinnedToCore(lazy_start_task, "lazy_start", 7168, NULL, 3, NULL, 1);
  return (ret == pdPASS) ? ESP_OK : ESP_ERR_NO_MEM;
}

bool scheduler_is_lazy_start_done(void) {
  return s_lazy_start_done;
}

bool scheduler_get_well_pump_next_schedule(time_t now, char *out_next_time, size_t len) {
  if (!s_mutex || !local_clock_valid(now) || !out_next_time || len == 0) return false;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return false;

  struct tm tm_now;
  localtime_r(&now, &tm_now);
  int current_sec_of_day = tm_now.tm_hour * 3600 + tm_now.tm_min * 60 + tm_now.tm_sec;
  int current_dow = tm_now.tm_wday;

  int min_diff = 86400 * 7;
  int next_hour = -1, next_min = -1;

  for (size_t i = 0; i < s_runtime_count; ++i) {
    runtime_schedule_t *rs = &s_runtime[i];
    if (!rs->valid) continue;
    if (strcmp(rs->action, "WATER_PUMP") != 0 &&
        !(rs->component_count > 0 && strcmp(rs->component_ids[0], "pump_well") == 0)) {
      continue;
    }
    if (rs->type == SCHED_TYPE_DAILY || rs->type == SCHED_TYPE_INTERVAL) {
      int sched_start_sec = rs->hour * 3600 + rs->minute * 60;
      if ((rs->days_of_week & (1 << current_dow)) && sched_start_sec > current_sec_of_day) {
        int diff = sched_start_sec - current_sec_of_day;
        if (diff < min_diff) {
          min_diff = diff;
          next_hour = rs->hour;
          next_min = rs->minute;
        }
      } else {
        for (int day_offset = 1; day_offset <= 7; day_offset++) {
          int dow = (current_dow + day_offset) % 7;
          if (rs->days_of_week & (1 << dow)) {
            int diff = day_offset * 86400 + (sched_start_sec - current_sec_of_day);
            if (diff < min_diff) {
              min_diff = diff;
              next_hour = rs->hour;
              next_min = rs->minute;
            }
            break;
          }
        }
      }
    }
  }

  xSemaphoreGive(s_mutex);
  if (next_hour >= 0) {
    snprintf(out_next_time, len, "%02d:%02d", next_hour, next_min);
    return true;
  }
  return false;
}
