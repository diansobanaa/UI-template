#include "services/fertigation_mgr.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "hal/sdcard_hal.h"
#include "hal/sensor_hal.h"
#include "services/calibration_mgr.h"
#include "services/command_mgr.h"
#include "services/event_mgr.h"
#include "services/safety_monitor.h"
#include "storage/storage_mgr.h"
#include "config/pin_config.h"
#include "driver/gpio.h"
#include <math.h>
#include <nvs.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>

static const char *TAG = "FERT_MGR";
static fertigation_state_t s_state = FERT_STATE_IDLE;
static fertigation_batch_config_t s_batch;
static delivery_slot_t s_delivery_slots[FERT_MAX_DELIVERY_SLOTS] = {0};
static SemaphoreHandle_t s_mutex = NULL;
static int64_t s_run_start_ms = 0, s_run_end_ms = 0;
static int64_t s_phase_ts[10] = {0};
static uint32_t s_state_start_ms = 0;
static uint32_t s_raw_start_ml = 0, s_delivery_start_ml = 0;
static uint32_t s_dosing_start_ms[FERT_MAX_DOSING_CHANNELS] = {0};
static uint32_t s_dosing_runtime_observed_ms[FERT_MAX_DOSING_CHANNELS] = {0};
static uint32_t s_active_dosing_channel_idx = 0;
static bool s_raw_water_filling_done = false;
static fertigation_last_terminal_t s_last_terminal = {0};
static uint32_t s_today_run_count = 0;
static uint32_t s_today_delivered_ml = 0;
static int s_today_fert_day = -1;
#define FERT_RECOVERY_NS "agrotech_fert"
#define FERT_RECOVERY_KEY "recovery_run"

static void cp(char *d, size_t n, const char *s) {
  if (!d || !n)
    return;
  d[0] = 0;
  if (s) {
    strncpy(d, s, n - 1);
    d[n - 1] = 0;
  }
}
static const char *state_name(fertigation_state_t s) {
  switch (s) {
  case FERT_STATE_IDLE:
    return "IDLE";
  case FERT_STATE_RECOVERY_HOLD:
    return "RECOVERY_HOLD";
  case FERT_STATE_PRECHECK:
    return "PRECHECK";
  case FERT_STATE_FILLING:
    return "FILLING";
  case FERT_STATE_DOSING:
    return "DOSING";
  case FERT_STATE_FINAL_MIXING:
    return "FINAL_MIXING";
  case FERT_STATE_MIX_READY:
    return "MIX_READY";
  case FERT_STATE_DELIVERY:
    return "DELIVERY";
  case FERT_STATE_COMPLETE:
    return "COMPLETE";
  case FERT_STATE_INTERRUPTED:
    return "INTERRUPTED";
  case FERT_STATE_FAULTED:
    return "FAULTED";
  case FERT_STATE_ABORTED:
    return "ABORTED";
  default:
    return "UNKNOWN";
  }
}
static int phase_index(fertigation_state_t s) {
  switch (s) {
  case FERT_STATE_PRECHECK:
    return 0;
  case FERT_STATE_FILLING:
    return 1;
  case FERT_STATE_DOSING:
    return 2;
  case FERT_STATE_FINAL_MIXING:
    return 3;
  case FERT_STATE_MIX_READY:
    return 4;
  case FERT_STATE_DELIVERY:
    return 5;
  case FERT_STATE_COMPLETE:
    return 6;
  default:
    return -1;
  }
}
static bool active_run_state(fertigation_state_t s) {
  return s == FERT_STATE_PRECHECK || s == FERT_STATE_FILLING ||
         s == FERT_STATE_DOSING || s == FERT_STATE_FINAL_MIXING ||
         s == FERT_STATE_MIX_READY || s == FERT_STATE_DELIVERY;
}
static bool op_component(const char *id) {
  return id && id[0] && hardware_registry_is_operational(id);
}
static bool text_has(const char *a, const char *b) {
  return a && b && strcasestr(a, b) != NULL;
}
static bool assigned_to(const hw_component_info_t *c, const char *gh) {
  if (!c)
    return false;
  return !c->assignment.gh_id[0] || strcasecmp(c->assignment.gh_id, gh) == 0;
}
static uint32_t now_ms(void) {
  return (uint32_t)(esp_timer_get_time() / 1000ULL);
}
static int64_t wallclock_ms(void) {
  time_t t = time(NULL);
  return t > 0 ? (int64_t)t * 1000LL : 0;
}

static esp_err_t stop_component(const char *id) {
  if (!id || !id[0])
    return ESP_OK;
  actuator_hal_stop_component(id, ACTUATOR_OWNER_FERTIGATION);
  return ESP_OK;
}
static void stop_all(void) {
  stop_component(s_batch.raw_water_component_id);
  stop_component(s_batch.mixing_pump_id);
  for (uint32_t i = 0;
       i < s_batch.channel_count && i < FERT_MAX_DOSING_CHANNELS; i++)
    stop_component(s_batch.channels[i].component_id);
  stop_component(s_batch.delivery_pump_id);
  for (uint32_t i = 0; i < s_batch.routing_valve_count; i++) {
    if (s_batch.routing_valve_ids[i][0]) {
      actuator_hal_set_by_component_id(s_batch.routing_valve_ids[i], false);
      actuator_hal_release_component(s_batch.routing_valve_ids[i], ACTUATOR_OWNER_FERTIGATION);
    }
  }
  for (size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s++) {
    if (s_delivery_slots[s].occupied && s_delivery_slots[s].delivery_pump_id[0]) {
      stop_component(s_delivery_slots[s].delivery_pump_id);
    }
  }
}
static void persist_run(const char *final_fault) {
  const char *event_code =
      final_fault ? "BATCH_FAILED" : "FERTIGATION_RUN_COMPLETED";
  event_level_t event_level = final_fault ? LOG_LEVEL_ERROR : LOG_LEVEL_INFO;
  const char *event_message =
      final_fault ? final_fault : "Fertigation batch completed.";
  (void)event_mgr_log_command(event_level, event_code, event_message,
                              s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
                              s_batch.delivery_pump_id, NULL,
                              s_batch.configuration_version);

  s_last_terminal.state = s_state;
  cp(s_last_terminal.run_id, sizeof(s_last_terminal.run_id), s_batch.run_id);
  cp(s_last_terminal.fault, sizeof(s_last_terminal.fault),
     final_fault ? final_fault : "");
  s_last_terminal.completed_at_ms = wallclock_ms();

  (void)command_mgr_notify_fertigation_status(
      final_fault ? CMD_STATUS_FAILED : CMD_STATUS_COMPLETED,
      final_fault ? final_fault : "COMPLETED", event_message);

  cJSON *r = cJSON_CreateObject();
  if (!r)
    return;
  cJSON_AddStringToObject(r, "runId", s_batch.run_id);
  cJSON_AddStringToObject(r, "complexId", s_batch.complex_id);
  cJSON_AddStringToObject(r, "ghId", s_batch.gh_id);
  cJSON_AddStringToObject(r, "triggerType", s_batch.trigger_type);
  if (s_batch.schedule_id[0])
    cJSON_AddStringToObject(r, "scheduleId", s_batch.schedule_id);
  cJSON_AddStringToObject(r, "recipeId", s_batch.recipe_id);
  cJSON_AddNumberToObject(r, "recipeVersion", s_batch.recipe_version);
  cJSON_AddNumberToObject(r, "configurationVersion",
                          s_batch.configuration_version);
  cJSON_AddStringToObject(r, "configurationHash", s_batch.configuration_hash);
  cJSON_AddNumberToObject(r, "targetWaterMl", s_batch.target_water_ml);
  cJSON_AddNumberToObject(
      r, "actualWaterMl",
      s_batch.target_water_ml > 0
          ? (double)(s_raw_start_ml ? 0 : s_batch.target_water_ml)
          : 0);
  uint32_t actual_raw = 0, actual_del = 0;
  bool raw_measured = sensor_hal_get_component_accumulated_ml(
                          s_batch.raw_flow_sensor_id, &actual_raw) == ESP_OK;
  bool delivery_measured =
      strcasecmp(s_batch.delivery_mode, "DURATION") == 0 ||
      sensor_hal_get_component_accumulated_ml(s_batch.delivery_flow_sensor_id,
                                              &actual_del) == ESP_OK;
  if (actual_raw >= s_raw_start_ml)
    actual_raw -= s_raw_start_ml;
  else
    actual_raw = 0;
  if (actual_del >= s_delivery_start_ml)
    actual_del -= s_delivery_start_ml;
  else
    actual_del = 0;

  time_t now_t = time(NULL);
  struct tm ti_now;
  localtime_r(&now_t, &ti_now);
  if (ti_now.tm_yday != s_today_fert_day) {
    s_today_fert_day = ti_now.tm_yday;
    s_today_run_count = 0;
    s_today_delivered_ml = 0;
  }
  if (!final_fault) {
    s_today_run_count++;
    s_today_delivered_ml += actual_del;
  }

  cJSON_ReplaceItemInObject(r, "actualWaterMl",
                            cJSON_CreateNumber((double)actual_raw));
  cJSON_AddStringToObject(r, "actualWaterMeasurementSource",
                          raw_measured ? "CONFIGURED_FLOW_SENSOR"
                                       : "UNAVAILABLE");
  cJSON_AddStringToObject(r, "actualWaterMeasurementQuality",
                          raw_measured ? "MEASURED" : "UNAVAILABLE");
  cJSON_AddNumberToObject(r, "deliveryTargetMl", s_batch.delivery_target_ml);
  cJSON_AddNumberToObject(r, "actualDeliveredMl", actual_del);
  cJSON *channels = cJSON_AddArrayToObject(r, "dosingChannels");
  for (uint32_t i = 0;
       i < s_batch.channel_count && i < FERT_MAX_DOSING_CHANNELS; i++) {
    cJSON *x = cJSON_CreateObject();
    cJSON_AddStringToObject(x, "componentId", s_batch.channels[i].component_id);
    cJSON_AddNumberToObject(x, "requestedMl", s_batch.channels[i].requested_ml);
    cJSON_AddNumberToObject(x, "actualRuntimeMs",
                            s_dosing_runtime_observed_ms[i]);
    cJSON_AddNumberToObject(x, "actualRuntimeSec",
                            s_dosing_runtime_observed_ms[i] / 1000.0);
    cJSON_AddNumberToObject(x, "actualDosedMl",
                            (s_dosing_runtime_observed_ms[i] / 1000.0) *
                                s_batch.channels[i].rate_ml_sec);
    cJSON_AddStringToObject(x, "actualDosedMeasurementSource",
                            "CALIBRATION_RATE_X_OBSERVED_RUNTIME");
    cJSON_AddStringToObject(x, "actualDosedMeasurementQuality", "CALCULATED");
    cJSON_AddNumberToObject(x, "rateMlPerSec", s_batch.channels[i].rate_ml_sec);
    cJSON_AddNumberToObject(x, "calibrationVersion",
                            s_batch.channels[i].calibration_version);
    cJSON_AddStringToObject(x, "calibrationId",
                            s_batch.channels[i].calibration_id);
    cJSON_AddItemToArray(channels, x);
  }
  double mixed_volume = (double)actual_raw;
  for (uint32_t i = 0;
       i < s_batch.channel_count && i < FERT_MAX_DOSING_CHANNELS; i++)
    mixed_volume += ((double)s_dosing_runtime_observed_ms[i] / 1000.0) *
                    (double)s_batch.channels[i].rate_ml_sec;
  cJSON_AddNumberToObject(r, "actualMixedVolumeMl", mixed_volume);
  cJSON_AddStringToObject(
      r, "mixedVolumeMeasurementSource",
      "CALCULATED_FROM_MEASURED_WATER_AND_CALIBRATED_DOSING");
  cJSON_AddStringToObject(r, "mixedVolumeMeasurementQuality", "CALCULATED");
  cJSON *sensor_cals =
      cJSON_AddObjectToObject(r, "sensorCalibrationReferences");
  cJSON *raw_cal = cJSON_CreateObject();
  cJSON_AddStringToObject(raw_cal, "sensorId", s_batch.raw_flow_sensor_id);
  cJSON_AddStringToObject(raw_cal, "calibrationId",
                          s_batch.raw_flow_calibration_id);
  cJSON_AddNumberToObject(raw_cal, "version",
                          s_batch.raw_flow_calibration_version);
  cJSON_AddItemToObject(sensor_cals, "rawFlow", raw_cal);
  if (s_batch.delivery_flow_sensor_id[0]) {
    cJSON *del_cal = cJSON_CreateObject();
    cJSON_AddStringToObject(del_cal, "sensorId",
                            s_batch.delivery_flow_sensor_id);
    cJSON_AddStringToObject(del_cal, "calibrationId",
                            s_batch.delivery_flow_calibration_id);
    cJSON_AddNumberToObject(del_cal, "version",
                            s_batch.delivery_flow_calibration_version);
    cJSON_AddItemToObject(sensor_cals, "deliveryFlow", del_cal);
  }
  cJSON_AddBoolToObject(r, "deliveredVolumeVerified",
                        strcasecmp(s_batch.delivery_mode, "DURATION") != 0 &&
                            delivery_measured &&
                            actual_del >= (uint32_t)s_batch.delivery_target_ml);
  cJSON_AddStringToObject(
      r, "deliveredVolumeMeasurementSource",
      strcasecmp(s_batch.delivery_mode, "DURATION") == 0
          ? "DURATION_TIMER"
          : (delivery_measured ? "CONFIGURED_FLOW_SENSOR" : "UNAVAILABLE"));
  cJSON_AddStringToObject(
      r, "deliveredVolumeMeasurementQuality",
      strcasecmp(s_batch.delivery_mode, "DURATION") == 0
          ? "DERIVED"
          : (delivery_measured ? "MEASURED" : "UNAVAILABLE"));
  sensor_component_sample_t delivery_flow_sample = {0};
  if (s_batch.delivery_flow_sensor_id[0] &&
      sensor_hal_get_component_sample(s_batch.delivery_flow_sensor_id,
                                      &delivery_flow_sample) == ESP_OK &&
      delivery_flow_sample.has_value &&
      delivery_flow_sample.state == SENSOR_STATE_VALID) {
    cJSON_AddNumberToObject(r, "actualFlowLpm", delivery_flow_sample.value);
    cJSON_AddStringToObject(r, "actualFlowMeasurementQuality", "MEASURED");
  } else {
    cJSON_AddNullToObject(r, "actualFlowLpm");
    cJSON_AddStringToObject(r, "actualFlowMeasurementQuality", "UNAVAILABLE");
  }
  sensor_component_sample_t pressure_sample = {0};
  if (s_batch.pressure_sensor_id[0] &&
      sensor_hal_get_component_sample(s_batch.pressure_sensor_id,
                                      &pressure_sample) == ESP_OK &&
      pressure_sample.has_value &&
      pressure_sample.state == SENSOR_STATE_VALID) {
    cJSON_AddNumberToObject(r, "actualPressureKpa", pressure_sample.value);
    cJSON_AddStringToObject(r, "actualPressureMeasurementQuality", "MEASURED");
  } else {
    cJSON_AddNullToObject(r, "actualPressureKpa");
    cJSON_AddStringToObject(r, "actualPressureMeasurementQuality",
                            "UNAVAILABLE");
  }
  cJSON_AddNumberToObject(r, "mixingDurationSec", s_batch.mixing_duration_sec);
  cJSON_AddStringToObject(r, "deliveryMode", s_batch.delivery_mode);
  cJSON_AddNumberToObject(r, "targetFlowLpm", s_batch.target_flow_lpm);
  cJSON_AddNumberToObject(r, "targetPressureKpa", s_batch.target_pressure_kpa);
  if (s_batch.execution_plan_json[0]) {
    cJSON *ep = cJSON_Parse(s_batch.execution_plan_json);
    if (ep)
      cJSON_AddItemToObject(r, "executionPlan", ep);
  }
  cJSON_AddNumberToObject(r, "startTimestampMs", (double)s_run_start_ms);
  cJSON_AddNumberToObject(r, "endTimestampMs", (double)s_run_end_ms);
  cJSON_AddNumberToObject(r, "monotonicStartMs", (double)s_run_start_ms);
  cJSON_AddNumberToObject(r, "monotonicEndMs", (double)s_run_end_ms);
  cJSON_AddStringToObject(r, "finalStatus", state_name(s_state));
  cJSON_AddStringToObject(r, "operator", s_batch.operator_id);
  cJSON_AddStringToObject(r, "source", s_batch.source);
  if (final_fault)
    cJSON_AddStringToObject(r, "fault", final_fault);
  else
    cJSON_AddNullToObject(r, "fault");
  cJSON *ph = cJSON_AddObjectToObject(r, "phaseTimestamps");
  const char *names[] = {"PRECHECK",  "FILLING",  "DOSING",  "FINAL_MIXING",
                         "MIX_READY", "DELIVERY", "COMPLETE"};
  for (int i = 0; i < 7; i++)
    if (s_phase_ts[i] > 0)
      cJSON_AddNumberToObject(ph, names[i], (double)s_phase_ts[i]);
  if (s_batch.recipe_snapshot_json[0]) {
    cJSON *snap = cJSON_Parse(s_batch.recipe_snapshot_json);
    if (snap)
      cJSON_AddItemToObject(r, "recipeSnapshot", snap);
  }

  const char *mixing_status = "NOT_STARTED";
  const char *delivery_status = "NOT_STARTED";
  if (s_state == FERT_STATE_COMPLETE) {
    mixing_status = "COMPLETED";
    delivery_status = "COMPLETED";
  } else if (s_phase_ts[4] > 0 || s_state == FERT_STATE_DELIVERY) {
    mixing_status = "COMPLETED";
    delivery_status = final_fault ? "FAILED" : "COMPLETED";
  } else if (final_fault) {
    mixing_status = "FAILED";
    delivery_status = "NOT_STARTED";
  } else if (s_phase_ts[1] > 0) {
    mixing_status = "IN_PROGRESS";
  }
  cJSON *mix_obj = cJSON_AddObjectToObject(r, "mixing");
  cJSON_AddStringToObject(mix_obj, "status", mixing_status);
  cJSON *del_obj = cJSON_AddObjectToObject(r, "delivery");
  cJSON_AddStringToObject(del_obj, "status", delivery_status);
  cJSON_AddStringToObject(r, "phase", state_name(s_state));

  char *str = cJSON_PrintUnformatted(r);
  if (str) {
    storage_mgr_append_fertigation_run(str);
    free(str);
  }
  cJSON_Delete(r);
}
static void clear_recovery(void) {
  nvs_handle_t h;
  if (nvs_open(FERT_RECOVERY_NS, NVS_READWRITE, &h) == ESP_OK) {
    nvs_erase_key(h, FERT_RECOVERY_KEY);
    nvs_commit(h);
    nvs_close(h);
  }
}
static void persist_recovery(void) {
  cJSON *r = cJSON_CreateObject();
  if (!r)
    return;
  cJSON_AddStringToObject(r, "runId", s_batch.run_id);
  cJSON_AddStringToObject(r, "complexId", s_batch.complex_id);
  cJSON_AddStringToObject(r, "ghId", s_batch.gh_id);
  cJSON_AddStringToObject(r, "state", state_name(s_state));
  cJSON_AddNumberToObject(r, "startTimestampMs", (double)s_run_start_ms);
  cJSON_AddNumberToObject(r, "configurationVersion",
                          s_batch.configuration_version);
  if (s_batch.recipe_id[0])
    cJSON_AddStringToObject(r, "recipeId", s_batch.recipe_id);
  if (s_batch.execution_plan_json[0]) {
    cJSON *ep = cJSON_Parse(s_batch.execution_plan_json);
    if (ep)
      cJSON_AddItemToObject(r, "executionPlan", ep);
  }
  char *str = cJSON_PrintUnformatted(r);
  cJSON_Delete(r);
  if (!str)
    return;
  nvs_handle_t h;
  if (nvs_open(FERT_RECOVERY_NS, NVS_READWRITE, &h) == ESP_OK) {
    nvs_set_str(h, FERT_RECOVERY_KEY, str);
    nvs_commit(h);
    nvs_close(h);
  }
  free(str);
}
static bool restore_recovery(void) {
  nvs_handle_t h;
  if (nvs_open(FERT_RECOVERY_NS, NVS_READONLY, &h) != ESP_OK)
    return false;
  size_t len = 0;
  if (nvs_get_str(h, FERT_RECOVERY_KEY, NULL, &len) != ESP_OK || len < 2 ||
      len > 8192) {
    nvs_close(h);
    return false;
  }
  char *str = calloc(1, len);
  if (!str) {
    nvs_close(h);
    return false;
  }
  bool ok = nvs_get_str(h, FERT_RECOVERY_KEY, str, &len) == ESP_OK;
  nvs_close(h);
  if (!ok) {
    free(str);
    return false;
  }
  cJSON *r = cJSON_Parse(str);
  free(str);
  if (!r)
    return false;
  snprintf(s_batch.run_id, sizeof(s_batch.run_id), "%s",
           cJSON_GetStringValue(cJSON_GetObjectItem(r, "runId")) ?: "");
  snprintf(s_batch.complex_id, sizeof(s_batch.complex_id), "%s",
           cJSON_GetStringValue(cJSON_GetObjectItem(r, "complexId")) ?: "");
  snprintf(s_batch.gh_id, sizeof(s_batch.gh_id), "%s",
           cJSON_GetStringValue(cJSON_GetObjectItem(r, "ghId")) ?: "");
  snprintf(s_batch.recipe_id, sizeof(s_batch.recipe_id), "%s",
           cJSON_GetStringValue(cJSON_GetObjectItem(r, "recipeId")) ?: "");
  s_run_start_ms =
      (int64_t)cJSON_GetNumberValue(cJSON_GetObjectItem(r, "startTimestampMs"));
  s_batch.configuration_version = (uint32_t)cJSON_GetNumberValue(
      cJSON_GetObjectItem(r, "configurationVersion"));
  cJSON *ep = cJSON_GetObjectItem(r, "executionPlan");
  if (ep) {
    char *js = cJSON_PrintUnformatted(ep);
    if (js) {
      cp(s_batch.execution_plan_json, sizeof(s_batch.execution_plan_json), js);
      free(js);
    }
  }
  cJSON_Delete(r);
  s_state = FERT_STATE_RECOVERY_HOLD;
  return true;
}
static void transition(fertigation_state_t next) {
  if (s_state == next)
    return;
  s_state = next;
  s_state_start_ms = now_ms();
  int idx = phase_index(next);
  if (idx >= 0)
    s_phase_ts[idx] = (int64_t)s_state_start_ms;
  if (active_run_state(next))
    persist_recovery();
  else if (next == FERT_STATE_COMPLETE || next == FERT_STATE_INTERRUPTED ||
           next == FERT_STATE_FAULTED || next == FERT_STATE_ABORTED ||
           next == FERT_STATE_IDLE)
    clear_recovery();
  ESP_LOGI(TAG, "State -> %s", state_name(next));
}

static bool plan_sensor_calibration_match(cJSON *sensor_cals, const char *key,
                                          const char *expected_component,
                                          char *out_id, size_t out_id_len,
                                          uint32_t *out_version) {
  if (!sensor_cals || !expected_component || !out_id || !out_version)
    return false;
  cJSON *entry = cJSON_GetObjectItem(sensor_cals, key);
  if (!entry || !cJSON_IsObject(entry))
    return false;
  cJSON *sid = cJSON_GetObjectItem(entry, "sensorId");
  cJSON *cid = cJSON_GetObjectItem(entry, "componentId");
  cJSON *calid = cJSON_GetObjectItem(entry, "calibrationId");
  cJSON *ver = cJSON_GetObjectItem(entry, "version");
  if ((sid && !cJSON_IsString(sid)) || (cid && !cJSON_IsString(cid)) ||
      !calid || !cJSON_IsString(calid) || !calid->valuestring[0] || !ver ||
      !cJSON_IsNumber(ver) || ver->valuedouble < 1)
    return false;
  const char *resolved =
      (sid && cJSON_IsString(sid) && sid->valuestring[0])
          ? sid->valuestring
          : (cid && cJSON_IsString(cid) ? cid->valuestring : "");
  if (strcmp(resolved, expected_component) != 0)
    return false;
  cp(out_id, out_id_len, calid->valuestring);
  *out_version = (uint32_t)ver->valuedouble;
  return true;
}

static bool precheck(void) {
  const system_storage_state_t *ss = storage_mgr_get_state();
  if (!ss || !ss->config_version)
    return false;
  if (s_batch.configuration_version &&
      ss->config_version != s_batch.configuration_version)
    return false;
  if (!op_component(s_batch.mixing_tank_id) ||
      !op_component(s_batch.raw_water_component_id) ||
      !op_component(s_batch.raw_flow_sensor_id) ||
      !op_component(s_batch.level_sensor_id) ||
      !op_component(s_batch.delivery_pump_id))
    return false;
  if (s_batch.mixing_duration_sec > 0 && !op_component(s_batch.mixing_pump_id))
    return false;
  if (strcasecmp(s_batch.delivery_mode, "DURATION") != 0 &&
      !op_component(s_batch.delivery_flow_sensor_id))
    return false;
  if (strcasecmp(s_batch.delivery_mode, "PRESSURE_FLOW") == 0 &&
      (!op_component(s_batch.pressure_sensor_id) ||
       s_batch.target_pressure_kpa <= 0.0f))
    return false;
  if (strcasecmp(s_batch.delivery_mode, "FLOW") == 0 &&
      s_batch.target_flow_lpm <= 0.0f)
    return false;
  if (strcasecmp(s_batch.delivery_mode, "DURATION") == 0 &&
      (!s_batch.allow_duration_fallback || s_batch.delivery_duration_sec == 0))
    return false;
  if (!safety_monitor_allows_commands() || actuator_hal_is_emergency_stopped())
    return false;
  if (s_batch.raw_flow_calibration_id[0] == 0 ||
      s_batch.raw_flow_calibration_version == 0)
    return false;
  calibration_record_t raw_flow_cal;
  if (calibration_mgr_get_record_exact(
          s_batch.raw_flow_sensor_id, "FLOW", s_batch.raw_flow_calibration_id,
          s_batch.raw_flow_calibration_version, &raw_flow_cal) != ESP_OK ||
      calibration_mgr_is_usable(&raw_flow_cal) != ESP_OK ||
      !raw_flow_cal.has_pulses_per_liter)
    return false;
  if (strcasecmp(s_batch.delivery_mode, "DURATION") != 0) {
    if (s_batch.delivery_flow_calibration_id[0] == 0 ||
        s_batch.delivery_flow_calibration_version == 0)
      return false;
    calibration_record_t delivery_flow_cal;
    if (calibration_mgr_get_record_exact(
            s_batch.delivery_flow_sensor_id, "FLOW",
            s_batch.delivery_flow_calibration_id,
            s_batch.delivery_flow_calibration_version,
            &delivery_flow_cal) != ESP_OK ||
        calibration_mgr_is_usable(&delivery_flow_cal) != ESP_OK ||
        !delivery_flow_cal.has_pulses_per_liter)
      return false;
  }
  if (s_batch.max_runtime_sec == 0)
    return false;
  if (s_batch.channel_count == 0 ||
      s_batch.channel_count > FERT_MAX_DOSING_CHANNELS)
    return false;
  for (uint32_t i = 0; i < s_batch.channel_count; i++) {
    if (!op_component(s_batch.channels[i].component_id) ||
        s_batch.channels[i].requested_ml <= 0 ||
        s_batch.channels[i].rate_ml_sec <= 0)
      return false;
    if (s_batch.channels[i].runtime_ms == 0 ||
        s_batch.channels[i].runtime_ms > s_batch.max_runtime_sec * 1000U)
      return false;
  }
  sensor_component_sample_t level = {0};
  if (sensor_hal_get_component_sample(s_batch.level_sensor_id, &level) !=
          ESP_OK ||
      level.state != SENSOR_STATE_VALID || level.has_value == false ||
      level.value < 1.0f)
    return false;
  return true;
}

static const char *json_string_or_null(cJSON *object, const char *key) {
  cJSON *v = cJSON_GetObjectItem(object, key);
  return (v && cJSON_IsString(v) && v->valuestring[0]) ? v->valuestring : NULL;
}

static bool parse_u32(cJSON *object, const char *key, uint32_t *out,
                      bool required) {
  cJSON *v = cJSON_GetObjectItem(object, key);
  if (!v) {
    return !required;
  }
  if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > 4294967295.0)
    return false;
  *out = (uint32_t)v->valuedouble;
  return true;
}

static bool plan_component_copy(cJSON *components, const char *key, char *out,
                                size_t out_len, bool required) {
  cJSON *v = cJSON_GetObjectItem(components, key);
  if (!v || !cJSON_IsString(v) || !v->valuestring[0])
    return !required;
  cp(out, out_len, v->valuestring);
  return true;
}

static bool validate_component_for_gh(const char *component_id,
                                      const char *gh_id, bool sensor_or_any) {
  if (!component_id || !component_id[0])
    return false;
  hw_component_info_t info;
  if (hardware_registry_find_by_id(component_id, &info) != ESP_OK)
    return false;
  if (!hardware_registry_is_operational(component_id))
    return false;
  if (info.assignment.gh_id[0] && gh_id &&
      strcasecmp(info.assignment.gh_id, gh_id) != 0)
    return false;
  if (!sensor_or_any && info.resource_id[0] == 0 && info.wiring.gpio < 0)
    return false;
  return true;
}

static bool validate_plan_resources(cJSON *plan, const char *gh_id,
                                    cJSON *components) {
  if (!plan || !components || !cJSON_IsObject(components))
    return false;
  cJSON *resources = cJSON_GetObjectItem(plan, "resources");
  if (!resources || !cJSON_IsArray(resources) ||
      cJSON_GetArraySize(resources) <= 0)
    return false;

  cJSON *item = NULL;
  cJSON_ArrayForEach(item, resources) {
    if (!cJSON_IsObject(item))
      return false;
    cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
    cJSON *cid = cJSON_GetObjectItem(item, "componentId");
    if (!rid || !cJSON_IsString(rid) || !rid->valuestring[0] || !cid ||
        !cJSON_IsString(cid) || !cid->valuestring[0])
      return false;
    hw_component_info_t info;
    if (hardware_registry_find_by_id(cid->valuestring, &info) != ESP_OK ||
        !hardware_registry_is_operational(cid->valuestring) ||
        !info.resource_id[0] ||
        strcmp(info.resource_id, rid->valuestring) != 0 ||
        (info.assignment.gh_id[0] && gh_id &&
         strcasecmp(info.assignment.gh_id, gh_id) != 0)) {
      return false;
    }
  }

  /* Every selected component must be represented by the exact same resource
   * identity. */
  cJSON *entry = NULL;
  cJSON_ArrayForEach(entry, components) {
    if (!cJSON_IsString(entry) || !entry->valuestring[0])
      continue;
    hw_component_info_t info;
    if (hardware_registry_find_by_id(entry->valuestring, &info) != ESP_OK ||
        !info.resource_id[0])
      return false;
    bool found = false;
    cJSON_ArrayForEach(item, resources) {
      cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
      cJSON *cid = cJSON_GetObjectItem(item, "componentId");
      if (rid && cid && cJSON_IsString(rid) && cJSON_IsString(cid) &&
          strcmp(cid->valuestring, info.component_id) == 0 &&
          strcmp(rid->valuestring, info.resource_id) == 0) {
        found = true;
        break;
      }
    }
    if (!found)
      return false;
  }

  cJSON *routing_valves = cJSON_GetObjectItem(plan, "routingValves");
  if (routing_valves && cJSON_IsArray(routing_valves)) {
    cJSON_ArrayForEach(entry, routing_valves) {
      if (!cJSON_IsString(entry) || !entry->valuestring[0])
        return false;
      bool found = false;
      cJSON_ArrayForEach(item, resources) {
        cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
        if (rid && cJSON_IsString(rid) &&
            strcmp(rid->valuestring, entry->valuestring) == 0) {
          found = true;
          break;
        }
      }
      if (!found)
        return false;
    }
  }
  return true;
}

static esp_err_t parse_payload(const char *payload_json) {
  if (!payload_json)
    return ESP_ERR_INVALID_ARG;
  cJSON *root = cJSON_Parse(payload_json);
  if (!root)
    return ESP_ERR_INVALID_ARG;
  memset(&s_batch, 0, sizeof(s_batch));
  cJSON *p = cJSON_GetObjectItem(root, "parameters");
  if (!p || !cJSON_IsObject(p))
    p = root;
  cJSON *plan = cJSON_GetObjectItem(root, "executionPlan");
  if (!plan || !cJSON_IsObject(plan))
    plan = cJSON_GetObjectItem(p, "executionPlan");
  if (!plan || !cJSON_IsObject(plan)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }

#define STRF(k, dst)                                                           \
  do {                                                                         \
    cJSON *vv = cJSON_GetObjectItem(root, k);                                  \
    if (!vv)                                                                   \
      vv = cJSON_GetObjectItem(p, k);                                          \
    if (vv && cJSON_IsString(vv))                                              \
      cp(dst, sizeof(dst), vv->valuestring);                                   \
  } while (0)
  STRF("runId", s_batch.run_id);
  STRF("complexId", s_batch.complex_id);
  STRF("ghId", s_batch.gh_id);
  if (!s_batch.gh_id[0])
    STRF("targetGhId", s_batch.gh_id);
  STRF("triggerType", s_batch.trigger_type);
  STRF("scheduleId", s_batch.schedule_id);
  STRF("recipeId", s_batch.recipe_id);
  STRF("source", s_batch.source);
  STRF("queueId", s_batch.queue_id);
  if (!s_batch.queue_id[0]) STRF("queue_id", s_batch.queue_id);
  STRF("occurrenceId", s_batch.occurrence_id);
  if (!s_batch.occurrence_id[0]) STRF("occurrence_id", s_batch.occurrence_id);
  STRF("batchId", s_batch.batch_id);
  if (!s_batch.batch_id[0]) STRF("batch_id", s_batch.batch_id);
  if (!s_batch.batch_id[0] && s_batch.run_id[0]) {
    cp(s_batch.batch_id, sizeof(s_batch.batch_id), s_batch.run_id);
  }
  cJSON *v = cJSON_GetObjectItem(plan, "configurationVersion");
  if (v && cJSON_IsNumber(v))
    s_batch.configuration_version = (uint32_t)v->valuedouble;
  v = cJSON_GetObjectItem(plan, "configurationHash");
  if (v && cJSON_IsString(v))
    cp(s_batch.configuration_hash, sizeof(s_batch.configuration_hash),
       v->valuestring);
  if (!s_batch.complex_id[0]) {
    const system_storage_state_t *ss = storage_mgr_get_state();
    if (ss)
      cp(s_batch.complex_id, sizeof(s_batch.complex_id), ss->complex_id);
  }
  const system_storage_state_t *ss = storage_mgr_get_state();
  if (!ss || !ss->complex_id[0] ||
      strcmp(s_batch.complex_id, ss->complex_id) != 0) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (!s_batch.configuration_version ||
      ss->config_version != s_batch.configuration_version) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (!ss->config_hash[0] || !s_batch.configuration_hash[0] ||
      strcmp(s_batch.configuration_hash, ss->config_hash) != 0) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }

  cJSON *delivery_plan = cJSON_GetObjectItem(plan, "delivery");
  if (!delivery_plan || !cJSON_IsObject(delivery_plan)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  cJSON *timeouts = cJSON_GetObjectItem(plan, "timeouts");
  if (!timeouts || !cJSON_IsObject(timeouts)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  cJSON *safety = cJSON_GetObjectItem(plan, "safety");
  if (!safety || !cJSON_IsObject(safety)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  v = cJSON_GetObjectItem(plan, "targetWaterMl");
  if (!v || !cJSON_IsNumber(v)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  s_batch.target_water_ml = (int32_t)v->valuedouble;
  if (!parse_u32(delivery_plan, "toleranceMl",
                 (uint32_t *)&s_batch.tolerance_ml, true)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_ARG;
  }
  {
    cJSON *mixing = cJSON_GetObjectItem(plan, "mixing");
    if (!mixing) mixing = cJSON_GetObjectItem(p, "mixing");
    uint32_t thresh = 20;
    if (mixing && cJSON_IsObject(mixing)) {
      cJSON *tv = cJSON_GetObjectItem(mixing, "rawWaterStartThresholdPercent");
      if (tv && cJSON_IsNumber(tv) && tv->valuedouble >= 1.0 && tv->valuedouble <= 100.0) {
        thresh = (uint32_t)tv->valuedouble;
      }
    } else {
      cJSON *tv = cJSON_GetObjectItem(plan, "rawWaterStartThresholdPercent");
      if (!tv) tv = cJSON_GetObjectItem(p, "rawWaterStartThresholdPercent");
      if (tv && cJSON_IsNumber(tv) && tv->valuedouble >= 1.0 && tv->valuedouble <= 100.0) {
        thresh = (uint32_t)tv->valuedouble;
      }
    }
    s_batch.raw_water_start_threshold_percent = (uint8_t)thresh;
  }
  v = cJSON_GetObjectItem(plan, "mixingDurationSec");
  if (!v || !cJSON_IsNumber(v) || v->valuedouble < 0) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_ARG;
  }
  s_batch.mixing_duration_sec = (uint32_t)v->valuedouble;
  if (!parse_u32(delivery_plan, "durationSec", &s_batch.delivery_duration_sec,
                 false)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_ARG;
  }
  v = cJSON_GetObjectItem(delivery_plan, "targetFlowLpm");
  if (v && cJSON_IsNumber(v))
    s_batch.target_flow_lpm = (float)v->valuedouble;
  v = cJSON_GetObjectItem(delivery_plan, "targetPressureKpa");
  if (v && cJSON_IsNumber(v))
    s_batch.target_pressure_kpa = (float)v->valuedouble;
  v = cJSON_GetObjectItem(delivery_plan, "allowDurationFallback");
  s_batch.allow_duration_fallback = v && cJSON_IsTrue(v);
  cJSON *fb = cJSON_GetObjectItem(plan, "fallback");
  if (!fb)
    fb = cJSON_GetObjectItem(root, "fallback");
  if (!fb)
    fb = cJSON_GetObjectItem(p, "fallback");
  if (fb && cJSON_IsObject(fb)) {
    cJSON *en = cJSON_GetObjectItem(fb, "enabled");
    s_batch.fallback_enabled = en && cJSON_IsTrue(en);
  }
  v = cJSON_GetObjectItem(timeouts, "maxRuntimeSec");
  if (!v || !cJSON_IsNumber(v)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  s_batch.max_runtime_sec = (uint32_t)v->valuedouble;
  v = cJSON_GetObjectItem(timeouts, "minDosingRuntimeSec");
  if (!v || !cJSON_IsNumber(v)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  s_batch.min_dosing_runtime_sec = (uint32_t)v->valuedouble;
  v = cJSON_GetObjectItem(timeouts, "maxDosingRuntimeSec");
  if (!v || !cJSON_IsNumber(v)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  s_batch.max_dosing_runtime_sec = (uint32_t)v->valuedouble;
  v = cJSON_GetObjectItem(timeouts, "fillTimeoutSec");
  if (!v || !cJSON_IsNumber(v)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  s_batch.fill_timeout_sec = (uint32_t)v->valuedouble;
  v = cJSON_GetObjectItem(timeouts, "deliveryTimeoutSec");
  if (!v || !cJSON_IsNumber(v)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  s_batch.delivery_timeout_sec = (uint32_t)v->valuedouble;
  if (s_batch.min_dosing_runtime_sec > s_batch.max_dosing_runtime_sec ||
      s_batch.max_dosing_runtime_sec == 0) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (!s_batch.max_runtime_sec || !s_batch.fill_timeout_sec ||
      !s_batch.delivery_timeout_sec) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  v = cJSON_GetObjectItem(safety, "safetyAcknowledged");
  if (!v || !cJSON_IsTrue(v)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (s_batch.target_water_ml <= 0 || !s_batch.gh_id[0]) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_ARG;
  }
  v = cJSON_GetObjectItem(delivery_plan, "mode");
  if (!v || !cJSON_IsString(v) || !v->valuestring[0]) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  cp(s_batch.delivery_mode, sizeof(s_batch.delivery_mode), v->valuestring);
  v = cJSON_GetObjectItem(delivery_plan, "targetDeliveredMl");
  if (!v || !cJSON_IsNumber(v) || v->valuedouble <= 0) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  s_batch.delivery_target_ml = (int32_t)v->valuedouble;
  if (!s_batch.trigger_type[0])
    cp(s_batch.trigger_type, sizeof(s_batch.trigger_type), "MANUAL");
  if (!s_batch.source[0])
    cp(s_batch.source, sizeof(s_batch.source), "UI");

  s_batch.routing_valve_count = 0;
  cJSON *rv_arr = cJSON_GetObjectItem(plan, "routingValves");
  if (!rv_arr) rv_arr = cJSON_GetObjectItem(root, "routingValves");
  if (rv_arr && cJSON_IsArray(rv_arr)) {
    for (int i = 0; i < cJSON_GetArraySize(rv_arr) && i < 4; i++) {
      cJSON *vi = cJSON_GetArrayItem(rv_arr, i);
      if (vi && cJSON_IsString(vi) && vi->valuestring[0]) {
        cp(s_batch.routing_valve_ids[s_batch.routing_valve_count++],
           sizeof(s_batch.routing_valve_ids[0]), vi->valuestring);
      }
    }
  }

  cJSON *components = cJSON_GetObjectItem(plan, "components");
  if (!components || !cJSON_IsObject(components)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (!validate_plan_resources(plan, s_batch.gh_id, components)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (!plan_component_copy(components, "mixingTank", s_batch.mixing_tank_id,
                           sizeof(s_batch.mixing_tank_id), true) ||
      !plan_component_copy(components, "rawWater",
                           s_batch.raw_water_component_id,
                           sizeof(s_batch.raw_water_component_id), true) ||
      !plan_component_copy(components, "rawFlow", s_batch.raw_flow_sensor_id,
                           sizeof(s_batch.raw_flow_sensor_id), true) ||
      !plan_component_copy(components, "level", s_batch.level_sensor_id,
                           sizeof(s_batch.level_sensor_id), true) ||
      !plan_component_copy(components, "deliveryPump", s_batch.delivery_pump_id,
                           sizeof(s_batch.delivery_pump_id), true)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (strcasecmp(s_batch.delivery_mode, "DURATION") != 0 &&
      !plan_component_copy(components, "deliveryFlow",
                           s_batch.delivery_flow_sensor_id,
                           sizeof(s_batch.delivery_flow_sensor_id), true)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (strcasecmp(s_batch.delivery_mode, "PRESSURE_FLOW") == 0 &&
      !plan_component_copy(components, "pressure", s_batch.pressure_sensor_id,
                           sizeof(s_batch.pressure_sensor_id), true)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (s_batch.mixing_duration_sec > 0 &&
      !plan_component_copy(components, "mixingPump", s_batch.mixing_pump_id,
                           sizeof(s_batch.mixing_pump_id), true)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }

  const char *required_ids[] = {
      s_batch.mixing_tank_id, s_batch.raw_water_component_id,
      s_batch.raw_flow_sensor_id, s_batch.level_sensor_id,
      s_batch.delivery_pump_id};
  for (size_t i = 0; i < sizeof(required_ids) / sizeof(required_ids[0]); i++)
    if (!validate_component_for_gh(required_ids[i], s_batch.gh_id, true)) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_STATE;
    }
  if (s_batch.mixing_duration_sec > 0 &&
      !validate_component_for_gh(s_batch.mixing_pump_id, s_batch.gh_id,
                                 false)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (strcasecmp(s_batch.delivery_mode, "DURATION") != 0 &&
      !validate_component_for_gh(s_batch.delivery_flow_sensor_id, s_batch.gh_id,
                                 true)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  if (strcasecmp(s_batch.delivery_mode, "PRESSURE_FLOW") == 0 &&
      !validate_component_for_gh(s_batch.pressure_sensor_id, s_batch.gh_id,
                                 true)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }

  cJSON *sensor_cals = cJSON_GetObjectItem(plan, "sensorCalibrations");
  if (!plan_sensor_calibration_match(sensor_cals, "rawFlow",
                                     s_batch.raw_flow_sensor_id,
                                     s_batch.raw_flow_calibration_id,
                                     sizeof(s_batch.raw_flow_calibration_id),
                                     &s_batch.raw_flow_calibration_version)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_STATE;
  }
  {
    sensor_descriptor_t d = {0};
    if (sensor_hal_get_descriptor(s_batch.raw_flow_sensor_id, &d) != ESP_OK ||
        strcasecmp(d.calibration_type, "FLOW") != 0 ||
        strcmp(d.calibration_reference, s_batch.raw_flow_calibration_id) != 0 ||
        d.calibration_version != s_batch.raw_flow_calibration_version) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_STATE;
    }
  }
  if (strcasecmp(s_batch.delivery_mode, "DURATION") != 0) {
    if (!plan_sensor_calibration_match(
            sensor_cals, "deliveryFlow", s_batch.delivery_flow_sensor_id,
            s_batch.delivery_flow_calibration_id,
            sizeof(s_batch.delivery_flow_calibration_id),
            &s_batch.delivery_flow_calibration_version)) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_STATE;
    }
    sensor_descriptor_t d = {0};
    if (sensor_hal_get_descriptor(s_batch.delivery_flow_sensor_id, &d) !=
            ESP_OK ||
        strcasecmp(d.calibration_type, "FLOW") != 0 ||
        strcmp(d.calibration_reference, s_batch.delivery_flow_calibration_id) !=
            0 ||
        d.calibration_version != s_batch.delivery_flow_calibration_version) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_STATE;
    }
  }

  cJSON *channels = cJSON_GetObjectItem(plan, "dosingChannels");
  if (!channels || !cJSON_IsArray(channels)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_ARG;
  }
  s_batch.channel_count = (uint32_t)cJSON_GetArraySize(channels);
  if (s_batch.channel_count == 0 ||
      s_batch.channel_count > FERT_MAX_DOSING_CHANNELS) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_SIZE;
  }
  for (uint32_t i = 0; i < s_batch.channel_count; i++) {
    cJSON *x = cJSON_GetArrayItem(channels, (int)i);
    if (!x || !cJSON_IsObject(x)) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_ARG;
    }
    cJSON *cid = cJSON_GetObjectItem(x, "componentId");
    cJSON *q = cJSON_GetObjectItem(x, "requestedMl");
    cJSON *ratev = cJSON_GetObjectItem(x, "rateMlPerSec");
    cJSON *calid = cJSON_GetObjectItem(x, "calibrationId");
    cJSON *calver = cJSON_GetObjectItem(x, "calibrationVersion");
    if (!cid || !cJSON_IsString(cid) || !cid->valuestring[0] || !q ||
        !cJSON_IsNumber(q) || q->valuedouble <= 0 || !ratev ||
        !cJSON_IsNumber(ratev) || ratev->valuedouble <= 0 || !calid ||
        !cJSON_IsString(calid) || !calid->valuestring[0] || !calver ||
        !cJSON_IsNumber(calver) || calver->valuedouble < 1) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_ARG;
    }
    for (uint32_t j = 0; j < i; j++)
      if (strcmp(s_batch.channels[j].component_id, cid->valuestring) == 0) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_STATE;
      }
    if (!validate_component_for_gh(cid->valuestring, s_batch.gh_id, false)) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_STATE;
    }
    calibration_record_t rec;
    if (calibration_mgr_get_record_exact(
            cid->valuestring, "DOSING_RATE", calid->valuestring,
            (uint32_t)calver->valuedouble, &rec) != ESP_OK ||
        calibration_mgr_is_usable(&rec) != ESP_OK) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_STATE;
    }
    float rate = (float)ratev->valuedouble;
    if (fabsf(rate - rec.rate_ml_sec) > 0.0001f) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_STATE;
    }
    cp(s_batch.channels[i].component_id,
       sizeof(s_batch.channels[i].component_id), cid->valuestring);
    s_batch.channels[i].requested_ml = (int32_t)q->valuedouble;
    s_batch.channels[i].rate_ml_sec = rec.rate_ml_sec;
    s_batch.channels[i].calibration_version = rec.version;
    cp(s_batch.channels[i].calibration_id,
       sizeof(s_batch.channels[i].calibration_id), rec.calibration_id);
    s_batch.channels[i].runtime_ms =
        (uint32_t)((s_batch.channels[i].requested_ml / rec.rate_ml_sec) *
                       1000.0f +
                   0.5f);
    if (s_batch.channels[i].runtime_ms == 0 ||
        s_batch.channels[i].runtime_ms >
            s_batch.max_dosing_runtime_sec * 1000U ||
        (s_batch.min_dosing_runtime_sec > 0 &&
         s_batch.channels[i].runtime_ms <
             s_batch.min_dosing_runtime_sec * 1000U)) {
      cJSON_Delete(root);
      return ESP_ERR_INVALID_STATE;
    }
  }
  cJSON *recipe = cJSON_GetObjectItem(plan, "recipe");
  if (recipe && cJSON_IsObject(recipe) && !cJSON_IsNull(recipe)) {
    cJSON *rid = cJSON_GetObjectItem(recipe, "recipeId"),
          *rv = cJSON_GetObjectItem(recipe, "version"),
          *rs = cJSON_GetObjectItem(recipe, "snapshot");
    if (rid && cJSON_IsString(rid) && rid->valuestring[0]) {
      if (s_batch.recipe_id[0] &&
          strcmp(s_batch.recipe_id, rid->valuestring) != 0) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_STATE;
      }
      cp(s_batch.recipe_id, sizeof(s_batch.recipe_id), rid->valuestring);
      if (rv && cJSON_IsNumber(rv))
        s_batch.recipe_version = (uint32_t)rv->valuedouble;
      if (rs && cJSON_IsObject(rs)) {
        char *snap = cJSON_PrintUnformatted(rs);
        if (snap) {
          cp(s_batch.recipe_snapshot_json, sizeof(s_batch.recipe_snapshot_json),
             snap);
          free(snap);
        }
      }
    }
  } else {
    s_batch.recipe_id[0] = '\0';
    s_batch.recipe_version = 0;
    s_batch.recipe_snapshot_json[0] = '\0';
  }
  char *plan_json = cJSON_PrintUnformatted(plan);
  if (plan_json) {
    cp(s_batch.execution_plan_json, sizeof(s_batch.execution_plan_json),
       plan_json);
    free(plan_json);
  } else {
    cJSON_Delete(root);
    return ESP_ERR_NO_MEM;
  }
  cJSON_Delete(root);
  return ESP_OK;
#undef STRF
}

static void task(void *arg) {
  (void)arg;
  while (1) {
    if (active_run_state(s_state) &&
        (safety_monitor_has_fault() || actuator_hal_is_emergency_stopped())) {
      if (s_state == FERT_STATE_DELIVERY &&
          strcmp(safety_monitor_get_fault_code(), "TANK_LOW") == 0) {
        stop_component(s_batch.delivery_pump_id);
        (void)event_mgr_log_command(
            LOG_LEVEL_INFO, "FERTIGATION_DELIVERED",
            "Fertigation delivery completed upon lower level boundary sensor trip.",
            s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
            s_batch.delivery_pump_id, NULL, s_batch.configuration_version);
        transition(FERT_STATE_COMPLETE);
        vTaskDelay(pdMS_TO_TICKS(100));
        continue;
      }
      if (actuator_hal_is_emergency_stopped()) {
        (void)event_mgr_log_command(
            LOG_LEVEL_ERROR, "EMERGENCY_STOP",
            "Emergency stop engaged during fertigation execution.",
            s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
            NULL, NULL, s_batch.configuration_version);
      }
      stop_all();
      s_run_end_ms = wallclock_ms();
      s_state = FERT_STATE_INTERRUPTED;
      persist_run("SAFETY");
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }
    uint32_t elapsed = now_ms() - s_state_start_ms;
    if (s_state != FERT_STATE_IDLE && s_state != FERT_STATE_PRECHECK &&
        s_state != FERT_STATE_COMPLETE && s_batch.max_runtime_sec > 0 &&
        s_run_start_ms > 0) {
      int64_t elapsed_run_wall = wallclock_ms();
      if (elapsed_run_wall > 0 &&
          elapsed_run_wall - s_run_start_ms >
              ((int64_t)s_batch.max_runtime_sec * 1000LL)) {
        stop_all();
        s_state = FERT_STATE_FAULTED;
        s_run_end_ms = elapsed_run_wall;
        persist_run("MAX_RUNTIME_EXCEEDED");
        vTaskDelay(pdMS_TO_TICKS(250));
        continue;
      }
    }
    switch (s_state) {
    case FERT_STATE_PRECHECK:
      if (!precheck()) {
        s_state = FERT_STATE_FAULTED;
        s_run_end_ms = wallclock_ms();
        persist_run("PRECHECK_FAILED");
      } else {
        if (sensor_hal_get_component_accumulated_ml(
                s_batch.raw_flow_sensor_id, &s_raw_start_ml) != ESP_OK ||
            (strcasecmp(s_batch.delivery_mode, "DURATION") != 0 &&
             sensor_hal_get_component_accumulated_ml(
                 s_batch.delivery_flow_sensor_id, &s_delivery_start_ml) !=
                 ESP_OK)) {
          s_state = FERT_STATE_FAULTED;
          s_run_end_ms = wallclock_ms();
          persist_run("FLOW_COUNTER_UNAVAILABLE");
        } else {
          (void)event_mgr_log_command(LOG_LEVEL_INFO, "MIXING_STARTED",
                                      "Fertigation mixing phase started.",
                                      s_batch.run_id, s_batch.complex_id,
                                      s_batch.gh_id, s_batch.mixing_tank_id,
                                      NULL, s_batch.configuration_version);
          (void)event_mgr_log_command(
              LOG_LEVEL_INFO, "FILL_STARTED", "Raw water filling initiated.",
              s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
              s_batch.raw_water_component_id, NULL,
              s_batch.configuration_version);
          transition(FERT_STATE_FILLING);
        }
      }
      break;
    case FERT_STATE_FILLING:
      for (uint32_t i = 0; i < s_batch.routing_valve_count; i++) {
        if (s_batch.routing_valve_ids[i][0]) {
          if (actuator_hal_acquire_component(s_batch.routing_valve_ids[i],
                                             ACTUATOR_OWNER_FERTIGATION) != ESP_OK ||
              actuator_hal_set_by_component_id(s_batch.routing_valve_ids[i], true) != ESP_OK) {
            stop_all();
            s_state = FERT_STATE_FAULTED;
            s_run_end_ms = wallclock_ms();
            persist_run("ROUTING_VALVE_ACTUATOR_REJECTED");
            break;
          }
        }
      }
      if (s_state == FERT_STATE_FAULTED) break;

      if (actuator_hal_acquire_component(s_batch.raw_water_component_id,
                                         ACTUATOR_OWNER_FERTIGATION) !=
          ESP_OK) {
        stop_all();
        s_state = FERT_STATE_FAULTED;
        s_run_end_ms = wallclock_ms();
        persist_run("RAW_WATER_RESOURCE_LOCKED");
        break;
      }
      if (actuator_hal_set_by_component_id(s_batch.raw_water_component_id,
                                           true) != ESP_OK) {
        stop_all();
        s_state = FERT_STATE_FAULTED;
        s_run_end_ms = wallclock_ms();
        persist_run("RAW_WATER_ACTUATOR_REJECTED");
        break;
      }
      uint32_t current = 0;
      if (sensor_hal_get_component_accumulated_ml(s_batch.raw_flow_sensor_id,
                                                  &current) != ESP_OK) {
        stop_all();
        s_state = FERT_STATE_FAULTED;
        s_run_end_ms = wallclock_ms();
        persist_run("RAW_FLOW_MEASUREMENT_UNAVAILABLE");
        break;
      }
      current = current >= s_raw_start_ml ? current - s_raw_start_ml : 0;
      uint32_t thresh_pct = s_batch.raw_water_start_threshold_percent > 0
                                ? s_batch.raw_water_start_threshold_percent
                                : 20;
      if (thresh_pct > 100)
        thresh_pct = 100;
      uint32_t thresh_vol =
          (uint32_t)(((uint64_t)s_batch.target_water_ml * thresh_pct) / 100ULL);
      if (current >= thresh_vol) {
        if (current + s_batch.tolerance_ml >= (uint32_t)s_batch.target_water_ml) {
          stop_component(s_batch.raw_water_component_id);
          s_raw_water_filling_done = true;
        } else {
          s_raw_water_filling_done = false;
        }
        if (s_batch.mixing_pump_id[0]) {
          if (actuator_hal_acquire_component(s_batch.mixing_pump_id,
                                             ACTUATOR_OWNER_FERTIGATION) == ESP_OK) {
            actuator_hal_set_by_component_id(s_batch.mixing_pump_id, true);
          }
        }
        s_active_dosing_channel_idx = 0;
        memset(s_dosing_start_ms, 0, sizeof(s_dosing_start_ms));
        memset(s_dosing_runtime_observed_ms, 0,
               sizeof(s_dosing_runtime_observed_ms));
        (void)event_mgr_log_command(
            LOG_LEVEL_INFO, "DOSING_STARTED", "Nutrient dosing initiated.",
            s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
            s_batch.channel_count > 0 ? s_batch.channels[0].component_id : NULL,
            NULL, s_batch.configuration_version);
        transition(FERT_STATE_DOSING);
      } else if (elapsed > (s_batch.fill_timeout_sec * 1000U)) {
        stop_all();
        s_state = FERT_STATE_FAULTED;
        s_run_end_ms = wallclock_ms();
        persist_run("FILL_TIMEOUT");
      }
      break;
    case FERT_STATE_DOSING:
      if (!s_raw_water_filling_done) {
        uint32_t raw_current = 0;
        if (sensor_hal_get_component_accumulated_ml(
                s_batch.raw_flow_sensor_id, &raw_current) == ESP_OK) {
          raw_current =
              raw_current >= s_raw_start_ml ? raw_current - s_raw_start_ml : 0;
          if (raw_current + s_batch.tolerance_ml >=
              (uint32_t)s_batch.target_water_ml) {
            stop_component(s_batch.raw_water_component_id);
            s_raw_water_filling_done = true;
          }
        }
      }
      if (elapsed > (s_batch.max_dosing_runtime_sec * 1000U)) {
        for (uint32_t c = 0; c < s_batch.channel_count; c++)
          stop_component(s_batch.channels[c].component_id);
        if (!s_raw_water_filling_done) {
          stop_component(s_batch.raw_water_component_id);
          s_raw_water_filling_done = true;
        }
        if (s_batch.fallback_enabled) {
          stop_all();
          s_state = FERT_STATE_FAULTED;
          s_run_end_ms = wallclock_ms();
          persist_run("DOSING_TIMEOUT");
          break;
        } else {
          ESP_LOGW(TAG, "Dosing timeout reached; continuing to mixing & "
                        "delivery as-is (fallback disabled)");
          transition(FERT_STATE_FINAL_MIXING);
          break;
        }
      }
      if (s_active_dosing_channel_idx < s_batch.channel_count) {
        uint32_t ch = s_active_dosing_channel_idx;
        uint32_t runtime = s_batch.channels[ch].runtime_ms;
        if (runtime == 0) {
          s_dosing_runtime_observed_ms[ch] = 0;
          s_active_dosing_channel_idx++;
        } else {
          if (s_dosing_start_ms[ch] == 0)
            s_dosing_start_ms[ch] = now_ms();
          uint32_t channel_elapsed = now_ms() - s_dosing_start_ms[ch];
          if (channel_elapsed < runtime) {
            if (actuator_hal_acquire_component(s_batch.channels[ch].component_id,
                                               ACTUATOR_OWNER_FERTIGATION) !=
                ESP_OK) {
              if (s_batch.fallback_enabled) {
                stop_all();
                s_state = FERT_STATE_FAULTED;
                s_run_end_ms = wallclock_ms();
                persist_run("DOSING_RESOURCE_LOCKED");
                break;
              } else {
                ESP_LOGW(TAG,
                         "Channel %s locked; skipping (fallback disabled)",
                         s_batch.channels[ch].component_id);
                s_dosing_runtime_observed_ms[ch] = runtime;
                s_active_dosing_channel_idx++;
              }
            } else if (actuator_hal_set_by_component_id(
                           s_batch.channels[ch].component_id, true) != ESP_OK) {
              if (s_batch.fallback_enabled) {
                stop_all();
                s_state = FERT_STATE_FAULTED;
                s_run_end_ms = wallclock_ms();
                persist_run("DOSING_ACTUATOR_REJECTED");
                break;
              } else {
                ESP_LOGW(TAG,
                         "Channel %s rejected; skipping (fallback disabled)",
                         s_batch.channels[ch].component_id);
                s_dosing_runtime_observed_ms[ch] = runtime;
                s_active_dosing_channel_idx++;
              }
            } else {
              s_dosing_runtime_observed_ms[ch] = channel_elapsed;
            }
          } else {
            stop_component(s_batch.channels[ch].component_id);
            s_dosing_runtime_observed_ms[ch] = runtime;
            s_active_dosing_channel_idx++;
          }
        }
      } else {
        for (uint32_t c = 0; c < s_batch.channel_count; c++)
          stop_component(s_batch.channels[c].component_id);
        if (s_raw_water_filling_done) {
          (void)event_mgr_log_command(
              LOG_LEVEL_INFO, "DOSING_COMPLETED", "Nutrient dosing completed.",
              s_batch.run_id, s_batch.complex_id, s_batch.gh_id, NULL, NULL,
              s_batch.configuration_version);
          transition(FERT_STATE_FINAL_MIXING);
        }
      }
      break;
    case FERT_STATE_FINAL_MIXING:
      if (s_batch.mixing_pump_id[0]) {
        if (actuator_hal_acquire_component(
                s_batch.mixing_pump_id, ACTUATOR_OWNER_FERTIGATION) != ESP_OK ||
            actuator_hal_set_by_component_id(s_batch.mixing_pump_id, true) !=
                ESP_OK) {
          stop_all();
          s_state = FERT_STATE_FAULTED;
          s_run_end_ms = wallclock_ms();
          persist_run("MIXING_ACTUATOR_REJECTED");
          break;
        }
      }
      if (elapsed >= s_batch.mixing_duration_sec * 1000U) {
        stop_component(s_batch.mixing_pump_id);
        stop_component(s_batch.raw_water_component_id);
        for (uint32_t i = 0; i < s_batch.routing_valve_count; i++) {
          if (s_batch.routing_valve_ids[i][0]) {
            actuator_hal_set_by_component_id(s_batch.routing_valve_ids[i], false);
            actuator_hal_release_component(s_batch.routing_valve_ids[i], ACTUATOR_OWNER_FERTIGATION);
          }
        }
        (void)event_mgr_log_command(LOG_LEVEL_INFO, "MIXING_COMPLETED",
                                    "Nutrient solution mixing completed.",
                                    s_batch.run_id, s_batch.complex_id,
                                    s_batch.gh_id, s_batch.mixing_pump_id, NULL,
                                    s_batch.configuration_version);
        (void)event_mgr_log_command(LOG_LEVEL_INFO, "MIX_READY",
            "Nutrient solution prepared and ready for delivery.", s_batch.run_id,
            s_batch.complex_id, s_batch.gh_id, s_batch.mixing_tank_id, NULL,
            s_batch.configuration_version);

        /* Transfer completed preparation into persistent per-GH delivery slot */
        delivery_slot_t *slot = NULL;
        for (size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s++) {
          if (s_delivery_slots[s].occupied && strcasecmp(s_delivery_slots[s].gh_id, s_batch.gh_id) == 0) {
            slot = &s_delivery_slots[s];
            break;
          }
        }
        if (!slot) {
          for (size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s++) {
            if (!s_delivery_slots[s].occupied) {
              slot = &s_delivery_slots[s];
              break;
            }
          }
        }
        if (slot) {
          memset(slot, 0, sizeof(*slot));
          slot->occupied = true;
          slot->state = DELIVERY_SLOT_READY_TO_SEND;
          cp(slot->gh_id, sizeof(slot->gh_id), s_batch.gh_id);
          cp(slot->occurrence_id, sizeof(slot->occurrence_id), s_batch.occurrence_id);
          cp(slot->batch_id, sizeof(slot->batch_id), s_batch.batch_id[0] ? s_batch.batch_id : s_batch.run_id);
          cp(slot->run_id, sizeof(slot->run_id), s_batch.run_id);
          cp(slot->schedule_id, sizeof(slot->schedule_id), s_batch.schedule_id);
          cp(slot->delivery_pump_id, sizeof(slot->delivery_pump_id), s_batch.delivery_pump_id);
          cp(slot->delivery_flow_sensor_id, sizeof(slot->delivery_flow_sensor_id), s_batch.delivery_flow_sensor_id);
          cp(slot->delivery_mode, sizeof(slot->delivery_mode), s_batch.delivery_mode);
          slot->delivery_target_ml = s_batch.delivery_target_ml;
          slot->delivery_duration_sec = s_batch.delivery_duration_sec;
          slot->delivery_timeout_sec = s_batch.delivery_timeout_sec;
          slot->configuration_version = s_batch.configuration_version;
          cp(slot->complex_id, sizeof(slot->complex_id), s_batch.complex_id);
        }

        s_run_end_ms = wallclock_ms();
        persist_run(NULL);
        transition(FERT_STATE_IDLE);
      }
      break;
    case FERT_STATE_MIX_READY:
      /* Genuine holding state: READY_TO_SEND.
       * All central preparation pumps are OFF, routing valves CLOSED, resources released.
       * Nutrient solution remains held in the mixing tank.
       * Distribution is triggered by the scheduler when the occurrence is due. */
      break;
    case FERT_STATE_DELIVERY:
      if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) {
        stop_component(s_batch.delivery_pump_id);
        (void)event_mgr_log_command(
            LOG_LEVEL_INFO, "FERTIGATION_DELIVERED",
            "Fertigation delivery completed upon lower level boundary sensor trip.",
            s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
            s_batch.delivery_pump_id, NULL, s_batch.configuration_version);
        (void)event_mgr_log_command(LOG_LEVEL_INFO, "DELIVERY_COMPLETED",
            "Delivery completed upon lower level boundary sensor trip.",
            s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
            s_batch.delivery_pump_id, NULL, s_batch.configuration_version);
        transition(FERT_STATE_COMPLETE);
        break;
      }
      if (actuator_hal_acquire_component(
              s_batch.delivery_pump_id, ACTUATOR_OWNER_FERTIGATION) != ESP_OK) {
        stop_all();
        s_state = FERT_STATE_FAULTED;
        s_run_end_ms = wallclock_ms();
        persist_run("DELIVERY_RESOURCE_LOCKED");
        break;
      }
      if (actuator_hal_set_by_component_id(s_batch.delivery_pump_id, true) !=
          ESP_OK) {
        stop_all();
        s_state = FERT_STATE_FAULTED;
        s_run_end_ms = wallclock_ms();
        persist_run("DELIVERY_ACTUATOR_REJECTED");
        break;
      }
      if (strcasecmp(s_batch.delivery_mode, "DURATION") == 0) {
        if (elapsed >= s_batch.delivery_duration_sec * 1000U) {
          stop_component(s_batch.delivery_pump_id);
          (void)event_mgr_log_command(LOG_LEVEL_INFO, "FERTIGATION_DELIVERED",
                                      "Delivery completed by duration.",
                                      s_batch.run_id, s_batch.complex_id,
                                      s_batch.gh_id, s_batch.delivery_pump_id,
                                      NULL, s_batch.configuration_version);
          transition(FERT_STATE_COMPLETE);
        }
      } else {
        sensor_component_sample_t flow = {0};
        bool flow_ok = sensor_hal_get_component_sample(
                           s_batch.delivery_flow_sensor_id, &flow) == ESP_OK &&
                       flow.state == SENSOR_STATE_VALID && flow.has_value;
        if (!flow_ok) {
          stop_all();
          s_state = FERT_STATE_FAULTED;
          s_run_end_ms = wallclock_ms();
          persist_run("DELIVERY_FLOW_SENSOR_NOT_VALID");
          break;
        }
        if (elapsed > 5000 && flow.value <= 0.0001f) {
          (void)event_mgr_log_command(LOG_LEVEL_ERROR, "FLOW_FAULT",
                                      "Delivery pump is active but flow sensor "
                                      "reads zero (flow fault).",
                                      s_batch.run_id, s_batch.complex_id,
                                      s_batch.gh_id, s_batch.delivery_pump_id,
                                      s_batch.delivery_flow_sensor_id,
                                      s_batch.configuration_version);
          stop_all();
          s_state = FERT_STATE_FAULTED;
          s_run_end_ms = wallclock_ms();
          persist_run("FLOW_FAULT");
          break;
        }
        sensor_component_sample_t pressure = {0};
        bool pressure_target_ok = true;
        if (strcasecmp(s_batch.delivery_mode, "PRESSURE_FLOW") == 0) {
          if (sensor_hal_get_component_sample(s_batch.pressure_sensor_id,
                                              &pressure) != ESP_OK ||
              pressure.state != SENSOR_STATE_VALID || !pressure.has_value) {
            stop_all();
            s_state = FERT_STATE_FAULTED;
            s_run_end_ms = wallclock_ms();
            persist_run("PRESSURE_SENSOR_NOT_VALID");
            break;
          }
          pressure_target_ok = pressure.value >= s_batch.target_pressure_kpa;
          if (flow.value <= 0) {
            stop_all();
            s_state = FERT_STATE_FAULTED;
            s_run_end_ms = wallclock_ms();
            persist_run("DELIVERY_FLOW_NOT_READY");
            break;
          }
        }
        uint32_t current_del = 0;
        if (sensor_hal_get_component_accumulated_ml(
                s_batch.delivery_flow_sensor_id, &current_del) != ESP_OK) {
          stop_all();
          s_state = FERT_STATE_FAULTED;
          s_run_end_ms = wallclock_ms();
          persist_run("DELIVERY_VOLUME_MEASUREMENT_UNAVAILABLE");
          break;
        }
        current_del = current_del >= s_delivery_start_ml
                          ? current_del - s_delivery_start_ml
                          : 0;
        bool flow_target_ok = strcasecmp(s_batch.delivery_mode, "FLOW") != 0 ||
                              flow.value >= s_batch.target_flow_lpm;
        bool target_complete = current_del + s_batch.tolerance_ml >=
                               (uint32_t)s_batch.delivery_target_ml;
        if (target_complete && flow_target_ok && pressure_target_ok) {
          stop_component(s_batch.delivery_pump_id);
          (void)event_mgr_log_command(
              LOG_LEVEL_INFO, "FERTIGATION_DELIVERED",
              "Delivery completed by target volume verification.",
              s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
              s_batch.delivery_pump_id, NULL, s_batch.configuration_version);
          transition(FERT_STATE_COMPLETE);
        } else if (elapsed > (s_batch.delivery_timeout_sec * 1000U)) {
          stop_component(s_batch.delivery_pump_id);
          s_state = FERT_STATE_FAULTED;
          s_run_end_ms = wallclock_ms();
          persist_run(flow_target_ok && pressure_target_ok
                          ? "DELIVERY_TIMEOUT"
                          : "DELIVERY_TARGET_NOT_REACHED");
        }
      }
      break;
    case FERT_STATE_COMPLETE:
      stop_all();
      s_run_end_ms = wallclock_ms();
      persist_run(NULL);
      transition(FERT_STATE_IDLE);
      break;
    default:
      break;
    }

    /* Decoupled Parallel Multi-GH Delivery Monitor */
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      for (size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s++) {
        delivery_slot_t *slot = &s_delivery_slots[s];
        if (!slot->occupied || slot->state != DELIVERY_SLOT_DISTRIBUTING) {
          continue;
        }
        uint32_t elapsed = now_ms() - slot->delivery_start_ms;

        // 1. Emergency stop check
        if (safety_monitor_has_fault() || actuator_hal_is_emergency_stopped()) {
          stop_component(slot->delivery_pump_id);
          slot->state = DELIVERY_SLOT_FAULTED;
          cp(slot->fault, sizeof(slot->fault), "EMERGENCY_STOP");
          slot->completed_at_ms = wallclock_ms();
          (void)event_mgr_log_command(LOG_LEVEL_ERROR, "DELIVERY_FAULT",
                                      "Delivery faulted due to emergency stop / safety trip.",
                                      slot->run_id, slot->complex_id, slot->gh_id,
                                      slot->delivery_pump_id, NULL, slot->configuration_version);
          continue;
        }

        // 2. Terminal completion: Lower float dry level switch
        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) {
          stop_component(slot->delivery_pump_id);
          (void)event_mgr_log_command(
              LOG_LEVEL_INFO, "FERTIGATION_DELIVERED",
              "Fertigation delivery completed upon lower level boundary sensor trip.",
              slot->run_id, slot->complex_id, slot->gh_id,
              slot->delivery_pump_id, NULL, slot->configuration_version);
          (void)event_mgr_log_command(
              LOG_LEVEL_INFO, "DELIVERY_COMPLETED",
              "Delivery completed upon lower level boundary sensor trip.",
              slot->run_id, slot->complex_id, slot->gh_id,
              slot->delivery_pump_id, NULL, slot->configuration_version);
          slot->state = DELIVERY_SLOT_COMPLETE;
          slot->completed_at_ms = wallclock_ms();
          s_today_run_count++;
          continue;
        }

        // 3. Duration mode completion
        if (strcasecmp(slot->delivery_mode, "DURATION") == 0) {
          if (slot->delivery_duration_sec > 0 && elapsed >= slot->delivery_duration_sec * 1000U) {
            stop_component(slot->delivery_pump_id);
            (void)event_mgr_log_command(LOG_LEVEL_INFO, "FERTIGATION_DELIVERED",
                                        "Delivery completed by duration.",
                                        slot->run_id, slot->complex_id,
                                        slot->gh_id, slot->delivery_pump_id,
                                        NULL, slot->configuration_version);
            (void)event_mgr_log_command(LOG_LEVEL_INFO, "DELIVERY_COMPLETED",
                                        "Delivery completed by duration.",
                                        slot->run_id, slot->complex_id,
                                        slot->gh_id, slot->delivery_pump_id,
                                        NULL, slot->configuration_version);
            slot->state = DELIVERY_SLOT_COMPLETE;
            slot->completed_at_ms = wallclock_ms();
            s_today_run_count++;
            continue;
          }
        } else {
          // Flow mode
          sensor_component_sample_t flow = {0};
          bool flow_ok = sensor_hal_get_component_sample(
                             slot->delivery_flow_sensor_id, &flow) == ESP_OK &&
                         flow.state == SENSOR_STATE_VALID && flow.has_value;
          if (!flow_ok) {
            stop_component(slot->delivery_pump_id);
            slot->state = DELIVERY_SLOT_FAULTED;
            cp(slot->fault, sizeof(slot->fault), "DELIVERY_FLOW_SENSOR_NOT_VALID");
            slot->completed_at_ms = wallclock_ms();
            continue;
          }
          if (elapsed > 5000 && flow.value <= 0.0001f) {
            (void)event_mgr_log_command(LOG_LEVEL_ERROR, "FLOW_FAULT",
                                        "Delivery pump is active but flow sensor reads zero (flow fault).",
                                        slot->run_id, slot->complex_id,
                                        slot->gh_id, slot->delivery_pump_id,
                                        slot->delivery_flow_sensor_id,
                                        slot->configuration_version);
            stop_component(slot->delivery_pump_id);
            slot->state = DELIVERY_SLOT_FAULTED;
            cp(slot->fault, sizeof(slot->fault), "FLOW_FAULT");
            slot->completed_at_ms = wallclock_ms();
            continue;
          }
          uint32_t current = 0;
          if (sensor_hal_get_component_accumulated_ml(
                  slot->delivery_flow_sensor_id, &current) == ESP_OK) {
            int32_t delivered = (int32_t)(current - slot->delivery_start_ml);
            if (delivered >= slot->delivery_target_ml) {
              stop_component(slot->delivery_pump_id);
              (void)event_mgr_log_command(LOG_LEVEL_INFO, "FERTIGATION_DELIVERED",
                                          "Delivery completed by volume target.",
                                          slot->run_id, slot->complex_id,
                                          slot->gh_id, slot->delivery_pump_id,
                                          slot->delivery_flow_sensor_id,
                                          slot->configuration_version);
              (void)event_mgr_log_command(LOG_LEVEL_INFO, "DELIVERY_COMPLETED",
                                          "Delivery completed by volume target.",
                                          slot->run_id, slot->complex_id,
                                          slot->gh_id, slot->delivery_pump_id,
                                          slot->delivery_flow_sensor_id,
                                          slot->configuration_version);
              slot->state = DELIVERY_SLOT_COMPLETE;
              slot->completed_at_ms = wallclock_ms();
              s_today_run_count++;
              s_today_delivered_ml += delivered;
              continue;
            }
          }
        }

        // 4. Timeout check
        if (slot->delivery_timeout_sec > 0 && elapsed >= slot->delivery_timeout_sec * 1000U) {
          stop_component(slot->delivery_pump_id);
          (void)event_mgr_log_command(LOG_LEVEL_ERROR, "DELIVERY_TIMEOUT",
                                      "Delivery timeout exceeded.",
                                      slot->run_id, slot->complex_id,
                                      slot->gh_id, slot->delivery_pump_id,
                                      NULL, slot->configuration_version);
          slot->state = DELIVERY_SLOT_FAULTED;
          cp(slot->fault, sizeof(slot->fault), "DELIVERY_TIMEOUT");
          slot->completed_at_ms = wallclock_ms();
          continue;
        }
      }
      xSemaphoreGive(s_mutex);
    }
    vTaskDelay(pdMS_TO_TICKS(200));
  }
}

static void scan_today_runs_from_storage(void) {
  const char *path = sdcard_hal_is_mounted() ? "/sdcard/fertigation_runs.jsonl"
                                             : "/spiffs/fertigation_runs.jsonl";
  FILE *f = fopen(path, "r");
  if (!f)
    return;
  time_t now_t = time(NULL);
  struct tm ti_now;
  localtime_r(&now_t, &ti_now);
  char today_str[16];
  strftime(today_str, sizeof(today_str), "%Y-%m-%d", &ti_now);

  char line[512];
  while (fgets(line, sizeof(line), f)) {
    if (strstr(line, today_str)) {
      char *del_ptr = strstr(line, "\"actualDeliveredMl\":");
      if (del_ptr) {
        uint32_t ml = (uint32_t)strtoul(del_ptr + 20, NULL, 10);
        s_today_run_count++;
        s_today_delivered_ml += ml;
      }
    }
  }
  fclose(f);
  s_today_fert_day = ti_now.tm_yday;
}

esp_err_t fertigation_mgr_init(void) {
  if (s_mutex)
    return ESP_OK;
  s_mutex = xSemaphoreCreateMutex();
  if (!s_mutex)
    return ESP_ERR_NO_MEM;
  s_state = FERT_STATE_IDLE;
  (void)restore_recovery();
  scan_today_runs_from_storage();
  if (s_state == FERT_STATE_RECOVERY_HOLD)
    (void)event_mgr_log_command(
        LOG_LEVEL_WARNING, "FERTIGATION_RECOVERY_HOLD",
        "A previously running fertigation was interrupted by reboot and is "
        "held for explicit operator disposition.",
        s_batch.run_id, s_batch.complex_id, s_batch.gh_id, NULL, NULL,
        s_batch.configuration_version);
  xTaskCreatePinnedToCore(task, "fert_mgr", 6144, NULL, 5, NULL, 1);
  return ESP_OK;
}
esp_err_t fertigation_mgr_start_from_json(const char *json_payload) {
  if (!s_mutex || !json_payload)
    return ESP_ERR_INVALID_ARG;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE)
    return ESP_FAIL;
  if (s_state != FERT_STATE_IDLE) {
    xSemaphoreGive(s_mutex);
    return ESP_ERR_INVALID_STATE;
  }
  esp_err_t e = parse_payload(json_payload);
  if (e == ESP_OK) {
    s_run_start_ms = wallclock_ms();
    s_run_end_ms = 0;
    memset(s_phase_ts, 0, sizeof(s_phase_ts));
    memset(s_dosing_start_ms, 0, sizeof(s_dosing_start_ms));
    memset(s_dosing_runtime_observed_ms, 0,
           sizeof(s_dosing_runtime_observed_ms));
    s_active_dosing_channel_idx = 0;
    s_raw_water_filling_done = false;
    transition(FERT_STATE_PRECHECK);
    (void)event_mgr_log_command(
        LOG_LEVEL_INFO, "MIXING_CREATED", "Fertigation batch created.",
        s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
        s_batch.mixing_tank_id[0] ? s_batch.mixing_tank_id : s_batch.delivery_pump_id,
        NULL, s_batch.configuration_version);
  }
  xSemaphoreGive(s_mutex);
  return e;
}
esp_err_t fertigation_mgr_cancel_batch(void) {
  if (!s_mutex)
    return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE)
    return ESP_FAIL;
  if (s_state != FERT_STATE_IDLE) {
    (void)event_mgr_log_command(
        LOG_LEVEL_WARNING, "BATCH_CANCELLED", "Fertigation batch cancelled by operator.",
        s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
        NULL, NULL, s_batch.configuration_version);
    stop_all();
    if (s_state == FERT_STATE_RECOVERY_HOLD) {
      clear_recovery();
      s_state = FERT_STATE_ABORTED;
    } else {
      s_state = FERT_STATE_ABORTED;
      s_run_end_ms = wallclock_ms();
      persist_run("OPERATOR_ABORT");
    }
    s_state = FERT_STATE_IDLE;
  }
  xSemaphoreGive(s_mutex);
  return ESP_OK;
}
fertigation_state_t fertigation_mgr_get_state(void) { return s_state; }
esp_err_t fertigation_mgr_get_status(fertigation_runtime_snapshot_t *out) {
  if (!out)
    return ESP_ERR_INVALID_ARG;
  memset(out, 0, sizeof(*out));
  out->state = s_state;
  cp(out->run_id, sizeof(out->run_id), s_batch.run_id);
  out->start_timestamp_ms = s_run_start_ms;
  out->end_timestamp_ms = s_run_end_ms;
  return ESP_OK;
}
esp_err_t fertigation_mgr_get_active_snapshot(cJSON **out) {
  if (!out)
    return ESP_ERR_INVALID_ARG;
  *out = NULL;
  cJSON *o = cJSON_CreateObject();
  if (!o)
    return ESP_ERR_NO_MEM;
  cJSON_AddStringToObject(o, "state", state_name(s_state));
  cJSON_AddStringToObject(o, "phase", state_name(s_state));
  cJSON_AddBoolToObject(o, "recoveryRequired",
                        s_state == FERT_STATE_RECOVERY_HOLD);
  if (s_state == FERT_STATE_RECOVERY_HOLD)
    cJSON_AddStringToObject(o, "recoveryDisposition",
                            "OPERATOR_CANCEL_REQUIRED");
  cJSON_AddStringToObject(o, "runId", s_batch.run_id);
  cJSON_AddStringToObject(o, "complexId", s_batch.complex_id);
  cJSON_AddStringToObject(o, "ghId", s_batch.gh_id);
  cJSON_AddStringToObject(o, "recipeId", s_batch.recipe_id);
  cJSON_AddNumberToObject(o, "configurationVersion",
                          s_batch.configuration_version);
  cJSON_AddNumberToObject(o, "targetWaterMl", s_batch.target_water_ml);
  uint32_t live_raw = 0, live_del = 0;
  if (sensor_hal_get_component_accumulated_ml(s_batch.raw_flow_sensor_id,
                                              &live_raw) == ESP_OK &&
      live_raw >= s_raw_start_ml)
    live_raw -= s_raw_start_ml;
  else
    live_raw = 0;
  if (sensor_hal_get_component_accumulated_ml(s_batch.delivery_flow_sensor_id,
                                              &live_del) == ESP_OK &&
      live_del >= s_delivery_start_ml)
    live_del -= s_delivery_start_ml;
  else
    live_del = 0;
  cJSON_AddNumberToObject(o, "actualWaterMl", live_raw);
  cJSON_AddStringToObject(o, "deliveryMode", s_batch.delivery_mode);
  cJSON_AddNumberToObject(o, "deliveryTargetMl", s_batch.delivery_target_ml);
  cJSON_AddNumberToObject(o, "actualDeliveredMl", live_del);
  sensor_component_sample_t flow_sample = {0};
  if (s_batch.delivery_flow_sensor_id[0] &&
      sensor_hal_get_component_sample(s_batch.delivery_flow_sensor_id,
                                      &flow_sample) == ESP_OK &&
      flow_sample.has_value) {
    cJSON_AddNumberToObject(o, "actualFlowLpm", flow_sample.value);
  } else {
    cJSON_AddNumberToObject(o, "actualFlowLpm", 0.0);
  }
  cJSON_AddNumberToObject(o, "targetFlowLpm", s_batch.target_flow_lpm);
  cJSON_AddNumberToObject(o, "targetPressureKpa", s_batch.target_pressure_kpa);
  cJSON_AddNumberToObject(o, "deliveryDurationSec",
                          s_batch.delivery_duration_sec);
  cJSON_AddNumberToObject(o, "mixingDurationSec", s_batch.mixing_duration_sec);

  const char *mixing_status = "NOT_STARTED";
  const char *delivery_status = "NOT_STARTED";
  if (s_state == FERT_STATE_COMPLETE) {
    mixing_status = "COMPLETED";
    delivery_status = "COMPLETED";
  } else if (s_state >= FERT_STATE_MIX_READY) {
    mixing_status = "COMPLETED";
    delivery_status =
        (s_state == FERT_STATE_DELIVERY) ? "IN_PROGRESS" : "NOT_STARTED";
  } else if (s_state >= FERT_STATE_PRECHECK) {
    mixing_status = "IN_PROGRESS";
    delivery_status = "NOT_STARTED";
  }
  cJSON *mix_obj = cJSON_AddObjectToObject(o, "mixing");
  cJSON_AddStringToObject(mix_obj, "status", mixing_status);
  cJSON *del_obj = cJSON_AddObjectToObject(o, "delivery");
  cJSON_AddStringToObject(del_obj, "status", delivery_status);

  cJSON_AddStringToObject(o, "lastTerminalState",
                          state_name(s_last_terminal.state));
  cJSON_AddStringToObject(o, "lastTerminalRunId", s_last_terminal.run_id);
  if (s_last_terminal.fault[0])
    cJSON_AddStringToObject(o, "lastTerminalFault", s_last_terminal.fault);
  else
    cJSON_AddNullToObject(o, "lastTerminalFault");
  cJSON_AddNumberToObject(o, "lastCompletedAtMs",
                          (double)s_last_terminal.completed_at_ms);

  /* Authoritative Section 20 fields (docs/SCHEDULING_AND_MECHANICAL_CONTROL_SPEC.md) */
  cJSON_AddStringToObject(o, "batchId", s_batch.run_id[0] ? s_batch.run_id : "IDLE");
  const char *runtime_state = "IDLE";
  if (s_state == FERT_STATE_FILLING) runtime_state = "MIXING_RAW_WATER";
  else if (s_state == FERT_STATE_DOSING) runtime_state = "DOSING";
  else if (s_state == FERT_STATE_FINAL_MIXING) runtime_state = "MIXING_RAW_WATER";
  else if (s_state == FERT_STATE_MIX_READY) runtime_state = "READY";
  else if (s_state == FERT_STATE_DELIVERY) runtime_state = "DISTRIBUTING";
  else if (s_state == FERT_STATE_COMPLETE) runtime_state = "COMPLETED";
  else if (s_state == FERT_STATE_FAULTED) runtime_state = "FAILED";
  else if (s_state == FERT_STATE_ABORTED) runtime_state = "CANCELLED";
  else {
    for (size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s++) {
      if (s_delivery_slots[s].occupied && s_delivery_slots[s].state == DELIVERY_SLOT_DISTRIBUTING) {
        runtime_state = "DISTRIBUTING";
        break;
      }
    }
  }
  cJSON_AddStringToObject(o, "runtimeState", runtime_state);

  const char *act_ch = "";
  if (s_state == FERT_STATE_DOSING && s_active_dosing_channel_idx < s_batch.channel_count) {
    act_ch = s_batch.channels[s_active_dosing_channel_idx].component_id;
  }
  cJSON_AddStringToObject(o, "activeChannel", act_ch);
  cJSON_AddNumberToObject(o, "rawWaterActualMl", live_raw);
  cJSON_AddNumberToObject(o, "rawWaterTargetMl", s_batch.target_water_ml);
  cJSON_AddNumberToObject(o, "thresholdPercent",
                          s_batch.raw_water_start_threshold_percent > 0
                              ? s_batch.raw_water_start_threshold_percent
                              : 20);
  cJSON_AddArrayToObject(o, "queuedBatches");

  cJSON *deliveries = cJSON_AddArrayToObject(o, "activeDeliveries");
  for (size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s++) {
    if (s_delivery_slots[s].occupied) {
      cJSON *d = cJSON_CreateObject();
      cJSON_AddStringToObject(d, "ghId", s_delivery_slots[s].gh_id);
      cJSON_AddStringToObject(d, "occurrenceId", s_delivery_slots[s].occurrence_id);
      cJSON_AddStringToObject(d, "batchId", s_delivery_slots[s].batch_id);
      const char *dst = "IDLE";
      if (s_delivery_slots[s].state == DELIVERY_SLOT_READY_TO_SEND) dst = "READY_TO_SEND";
      else if (s_delivery_slots[s].state == DELIVERY_SLOT_DISTRIBUTING) dst = "DISTRIBUTING";
      else if (s_delivery_slots[s].state == DELIVERY_SLOT_COMPLETE) dst = "COMPLETED";
      else if (s_delivery_slots[s].state == DELIVERY_SLOT_FAULTED) dst = "FAILED";
      cJSON_AddStringToObject(d, "status", dst);
      cJSON_AddStringToObject(d, "deliveryPumpId", s_delivery_slots[s].delivery_pump_id);
      cJSON_AddItemToArray(deliveries, d);
    }
  }

  *out = o;
  return ESP_OK;
}

esp_err_t fertigation_mgr_get_last_terminal(fertigation_last_terminal_t *out) {
  if (!out)
    return ESP_ERR_INVALID_ARG;
  *out = s_last_terminal;
  return ESP_OK;
}

esp_err_t
fertigation_mgr_get_daily_stats(fertigation_daily_stats_t *out_stats) {
  if (!out_stats)
    return ESP_ERR_INVALID_ARG;
  time_t now_t = time(NULL);
  struct tm ti_now;
  localtime_r(&now_t, &ti_now);
  if (ti_now.tm_yday != s_today_fert_day) {
    s_today_fert_day = ti_now.tm_yday;
    s_today_run_count = 0;
    s_today_delivered_ml = 0;
  }
  out_stats->run_count_today = s_today_run_count;
  out_stats->delivered_liters_today = (s_today_delivered_ml + 500) / 1000;
  out_stats->target_liters_today = 0;
  return ESP_OK;
}

esp_err_t fertigation_mgr_get_queue_summary(fertigation_queue_summary_t *out) {
  if (!out)
    return ESP_ERR_INVALID_ARG;
  memset(out, 0, sizeof(*out));
  if (s_batch.run_id[0]) {
    strncpy(out->batch_id, s_batch.run_id, sizeof(out->batch_id) - 1);
    strncpy(out->gh_id, s_batch.gh_id, sizeof(out->gh_id) - 1);
  } else {
    strcpy(out->batch_id, "NONE");
    strcpy(out->gh_id, "-");
  }
  const char *st = "IDLE";
  if (s_state == FERT_STATE_FILLING) st = "RAW_WATER";
  else if (s_state == FERT_STATE_DOSING) st = "DOSING";
  else if (s_state == FERT_STATE_FINAL_MIXING) st = "MIXING";
  else if (s_state == FERT_STATE_MIX_READY) st = "READY";
  else if (s_state == FERT_STATE_DELIVERY) st = "DISTRIBUTING";
  else if (s_state == FERT_STATE_COMPLETE) st = "COMPLETED";
  else if (s_state == FERT_STATE_FAULTED) st = "FAILED";
  else if (s_state == FERT_STATE_ABORTED) st = "CANCELLED";
  else {
    for (size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s++) {
      if (s_delivery_slots[s].occupied && s_delivery_slots[s].state == DELIVERY_SLOT_DISTRIBUTING) {
        st = "DISTRIBUTING";
        if (out->batch_id[0] == '\0' || strcmp(out->batch_id, "NONE") == 0) {
          strncpy(out->batch_id, s_delivery_slots[s].batch_id, sizeof(out->batch_id) - 1);
          strncpy(out->gh_id, s_delivery_slots[s].gh_id, sizeof(out->gh_id) - 1);
        }
        break;
      }
    }
  }
  strncpy(out->runtime_state, st, sizeof(out->runtime_state) - 1);

  if (s_state == FERT_STATE_DOSING && s_active_dosing_channel_idx < s_batch.channel_count) {
    const char *cid = s_batch.channels[s_active_dosing_channel_idx].component_id;
    if (strstr(cid, "dp-a") || strcmp(cid, "A") == 0) strcpy(out->active_channel, "A");
    else if (strstr(cid, "dp-b") || strcmp(cid, "B") == 0) strcpy(out->active_channel, "B");
    else if (strstr(cid, "dp-n") || strcmp(cid, "N") == 0) strcpy(out->active_channel, "N");
    else strncpy(out->active_channel, cid, sizeof(out->active_channel) - 1);
  } else {
    out->active_channel[0] = '\0';
  }

  uint32_t live_raw = 0;
  if (sensor_hal_get_component_accumulated_ml(s_batch.raw_flow_sensor_id, &live_raw) == ESP_OK &&
      live_raw >= s_raw_start_ml) {
    live_raw -= s_raw_start_ml;
  } else {
    live_raw = 0;
  }
  out->raw_water_actual_ml = live_raw;
  out->raw_water_target_ml = s_batch.target_water_ml;
  out->threshold_percent = s_batch.raw_water_start_threshold_percent > 0 ? s_batch.raw_water_start_threshold_percent : 20;
  out->is_active = (s_state > FERT_STATE_IDLE && s_state < FERT_STATE_COMPLETE);
  out->queued_count = 0;
  return ESP_OK;
}

esp_err_t fertigation_mgr_get_correlation(char *out_queue_id, size_t queue_id_len,
                                          char *out_occurrence_id, size_t occ_id_len,
                                          char *out_batch_id, size_t batch_id_len,
                                          char *out_gh_id, size_t gh_id_len) {
  if (!s_mutex) return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
  if (out_queue_id && queue_id_len) cp(out_queue_id, queue_id_len, s_batch.queue_id);
  if (out_occurrence_id && occ_id_len) cp(out_occurrence_id, occ_id_len, s_batch.occurrence_id);
  if (out_batch_id && batch_id_len) cp(out_batch_id, batch_id_len, s_batch.batch_id[0] ? s_batch.batch_id : s_batch.run_id);
  if (out_gh_id && gh_id_len) cp(out_gh_id, gh_id_len, s_batch.gh_id);
  xSemaphoreGive(s_mutex);
  return ESP_OK;
}

bool fertigation_mgr_is_batch_ready(const char *gh_id, const char *occurrence_id) {
  if (!s_mutex) return false;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return false;
  for (size_t i = 0; i < FERT_MAX_DELIVERY_SLOTS; i++) {
    if (s_delivery_slots[i].occupied && s_delivery_slots[i].state == DELIVERY_SLOT_READY_TO_SEND) {
      if (gh_id && gh_id[0] && strcasecmp(gh_id, s_delivery_slots[i].gh_id) != 0) continue;
      if (occurrence_id && occurrence_id[0] && strcmp(occurrence_id, s_delivery_slots[i].occurrence_id) != 0) continue;
      xSemaphoreGive(s_mutex);
      return true;
    }
  }
  if (s_state == FERT_STATE_MIX_READY) {
    if ((!gh_id || !gh_id[0] || strcasecmp(gh_id, s_batch.gh_id) == 0) &&
        (!occurrence_id || !occurrence_id[0] || strcmp(occurrence_id, s_batch.occurrence_id) == 0)) {
      xSemaphoreGive(s_mutex);
      return true;
    }
  }
  xSemaphoreGive(s_mutex);
  return false;
}

esp_err_t fertigation_mgr_trigger_distribution(const char *gh_id, const char *occurrence_id) {
  if (!s_mutex) return ESP_ERR_INVALID_STATE;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

  delivery_slot_t *slot = NULL;
  for (size_t i = 0; i < FERT_MAX_DELIVERY_SLOTS; i++) {
    if (s_delivery_slots[i].occupied && s_delivery_slots[i].state == DELIVERY_SLOT_READY_TO_SEND) {
      if (gh_id && gh_id[0] && strcasecmp(gh_id, s_delivery_slots[i].gh_id) != 0) continue;
      if (occurrence_id && occurrence_id[0] && strcmp(occurrence_id, s_delivery_slots[i].occurrence_id) != 0) continue;
      slot = &s_delivery_slots[i];
      break;
    }
  }

  /* Fallback: if in legacy FERT_STATE_MIX_READY in s_batch */
  if (!slot && s_state == FERT_STATE_MIX_READY) {
    if ((!gh_id || !gh_id[0] || strcasecmp(gh_id, s_batch.gh_id) == 0) &&
        (!occurrence_id || !occurrence_id[0] || strcmp(occurrence_id, s_batch.occurrence_id) == 0)) {
      for (size_t i = 0; i < FERT_MAX_DELIVERY_SLOTS; i++) {
        if (!s_delivery_slots[i].occupied) {
          slot = &s_delivery_slots[i];
          break;
        }
      }
      if (slot) {
        memset(slot, 0, sizeof(*slot));
        slot->occupied = true;
        slot->state = DELIVERY_SLOT_READY_TO_SEND;
        cp(slot->gh_id, sizeof(slot->gh_id), s_batch.gh_id);
        cp(slot->occurrence_id, sizeof(slot->occurrence_id), s_batch.occurrence_id);
        cp(slot->batch_id, sizeof(slot->batch_id), s_batch.batch_id[0] ? s_batch.batch_id : s_batch.run_id);
        cp(slot->run_id, sizeof(slot->run_id), s_batch.run_id);
        cp(slot->schedule_id, sizeof(slot->schedule_id), s_batch.schedule_id);
        cp(slot->delivery_pump_id, sizeof(slot->delivery_pump_id), s_batch.delivery_pump_id);
        cp(slot->delivery_flow_sensor_id, sizeof(slot->delivery_flow_sensor_id), s_batch.delivery_flow_sensor_id);
        cp(slot->delivery_mode, sizeof(slot->delivery_mode), s_batch.delivery_mode);
        slot->delivery_target_ml = s_batch.delivery_target_ml;
        slot->delivery_duration_sec = s_batch.delivery_duration_sec;
        slot->delivery_timeout_sec = s_batch.delivery_timeout_sec;
        slot->configuration_version = s_batch.configuration_version;
        cp(slot->complex_id, sizeof(slot->complex_id), s_batch.complex_id);
        transition(FERT_STATE_IDLE);
      }
    }
  }

  if (!slot) {
    xSemaphoreGive(s_mutex);
    return ESP_ERR_NOT_FOUND;
  }

  // Acquire only this GH's distribution pump
  if (actuator_hal_acquire_component(slot->delivery_pump_id, ACTUATOR_OWNER_FERTIGATION) != ESP_OK) {
    xSemaphoreGive(s_mutex);
    return ESP_ERR_INVALID_STATE;
  }
  if (actuator_hal_set_by_component_id(slot->delivery_pump_id, true) != ESP_OK) {
    actuator_hal_release_component(slot->delivery_pump_id, ACTUATOR_OWNER_FERTIGATION);
    xSemaphoreGive(s_mutex);
    return ESP_ERR_INVALID_STATE;
  }

  slot->delivery_start_ms = now_ms();
  uint32_t delivery_start = 0;
  if (strcasecmp(slot->delivery_mode, "DURATION") != 0 &&
      sensor_hal_get_component_accumulated_ml(slot->delivery_flow_sensor_id, &delivery_start) == ESP_OK) {
    slot->delivery_start_ml = delivery_start;
  } else {
    slot->delivery_start_ml = 0;
  }

  slot->state = DELIVERY_SLOT_DISTRIBUTING;
  (void)event_mgr_log_command(LOG_LEVEL_INFO, "FERTIGATION_START",
                              "Delivery to greenhouse distribution network started.",
                              slot->run_id, slot->complex_id, slot->gh_id,
                              slot->delivery_pump_id, NULL, slot->configuration_version);
  (void)event_mgr_log_command(LOG_LEVEL_INFO, "DELIVERY_STARTED",
                              "Delivery pump activated for distribution.",
                              slot->run_id, slot->complex_id, slot->gh_id,
                              slot->delivery_pump_id, NULL, slot->configuration_version);

  xSemaphoreGive(s_mutex);
  return ESP_OK;
}

bool fertigation_mgr_is_gh_busy(const char *gh_id) {
  if (!gh_id || !gh_id[0] || !s_mutex) return false;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return false;
  if (active_run_state(s_state) && strcasecmp(s_batch.gh_id, gh_id) == 0) {
    xSemaphoreGive(s_mutex);
    return true;
  }
  for (size_t i = 0; i < FERT_MAX_DELIVERY_SLOTS; i++) {
    if (s_delivery_slots[i].occupied &&
        strcasecmp(s_delivery_slots[i].gh_id, gh_id) == 0 &&
        (s_delivery_slots[i].state == DELIVERY_SLOT_READY_TO_SEND ||
         s_delivery_slots[i].state == DELIVERY_SLOT_DISTRIBUTING)) {
      xSemaphoreGive(s_mutex);
      return true;
    }
  }
  xSemaphoreGive(s_mutex);
  return false;
}

esp_err_t fertigation_mgr_get_delivery_slot_status(const char *gh_id, const char *occurrence_id, delivery_slot_state_t *out_state) {
  if (!out_state || !s_mutex) return ESP_ERR_INVALID_ARG;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
  for (size_t i = 0; i < FERT_MAX_DELIVERY_SLOTS; i++) {
    if (s_delivery_slots[i].occupied) {
      if (gh_id && gh_id[0] && strcasecmp(gh_id, s_delivery_slots[i].gh_id) != 0) continue;
      if (occurrence_id && occurrence_id[0] && strcmp(occurrence_id, s_delivery_slots[i].occurrence_id) != 0) continue;
      *out_state = s_delivery_slots[i].state;
      xSemaphoreGive(s_mutex);
      return ESP_OK;
    }
  }
  xSemaphoreGive(s_mutex);
  return ESP_ERR_NOT_FOUND;
}

esp_err_t fertigation_mgr_acknowledge_delivery(const char *gh_id, const char *occurrence_id) {
  if (!s_mutex) return ESP_ERR_INVALID_ARG;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
  for (size_t i = 0; i < FERT_MAX_DELIVERY_SLOTS; i++) {
    if (s_delivery_slots[i].occupied) {
      if (gh_id && gh_id[0] && strcasecmp(gh_id, s_delivery_slots[i].gh_id) != 0) continue;
      if (occurrence_id && occurrence_id[0] && strcmp(occurrence_id, s_delivery_slots[i].occurrence_id) != 0) continue;
      memset(&s_delivery_slots[i], 0, sizeof(s_delivery_slots[i]));
      xSemaphoreGive(s_mutex);
      return ESP_OK;
    }
  }
  xSemaphoreGive(s_mutex);
  return ESP_ERR_NOT_FOUND;
}

size_t fertigation_mgr_get_active_delivery_count(void) {
  if (!s_mutex) return 0;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return 0;
  size_t count = 0;
  for (size_t i = 0; i < FERT_MAX_DELIVERY_SLOTS; i++) {
    if (s_delivery_slots[i].occupied && s_delivery_slots[i].state == DELIVERY_SLOT_DISTRIBUTING) {
      count++;
    }
  }
  xSemaphoreGive(s_mutex);
  return count;
}

esp_err_t fertigation_mgr_get_delivery_slots(delivery_slot_t *out_slots, size_t max_count, size_t *out_count) {
  if (!out_slots || !out_count || !s_mutex) return ESP_ERR_INVALID_ARG;
  if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
  size_t cnt = 0;
  for (size_t i = 0; i < FERT_MAX_DELIVERY_SLOTS && cnt < max_count; i++) {
    if (s_delivery_slots[i].occupied) {
      out_slots[cnt++] = s_delivery_slots[i];
    }
  }
  *out_count = cnt;
  xSemaphoreGive(s_mutex);
  return ESP_OK;
}
