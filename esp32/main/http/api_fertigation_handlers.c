#include "http_server.h"
#include "services/fertigation_mgr.h"
#include "services/command_mgr.h"
#include "services/scheduler.h"
#include "storage/storage_mgr.h"
#include "services/safety_monitor.h"
#include "cJSON.h"
#include <string.h>
#include <stdlib.h>
#include "esp_timer.h"

static esp_err_t start_handler(httpd_req_t *req){
    if(http_check_auth(req)!=ESP_OK)return ESP_OK;
    cJSON *body=NULL; if(http_parse_json_body(req,&body)!=ESP_OK||!body){http_send_error(req,422,"VALIDATION_FAILED","Invalid JSON",NULL);return ESP_FAIL;}
    cJSON *payload=cJSON_GetObjectItem(body,"payload"); cJSON *target=payload?payload:body;
    cJSON *gh=cJSON_GetObjectItem(target,"ghId"); cJSON *cid=cJSON_GetObjectItem(target,"commandId");
    const system_storage_state_t *ss=storage_mgr_get_state();
    /* STACK-FIX: command_item_t is ~6.5KB. Heap-allocate to avoid httpd stack overflow. */
    command_item_t *cmd = calloc(1, sizeof(command_item_t));
    if(!cmd){cJSON_Delete(body);http_send_error(req,500,"NO_MEM","Out of memory for command",NULL);return ESP_FAIL;}
    if(cid&&cJSON_IsString(cid)&&cid->valuestring[0]) strncpy(cmd->command_id,cid->valuestring,sizeof(cmd->command_id)-1); else snprintf(cmd->command_id,sizeof(cmd->command_id),"fert-%llu",(unsigned long long)(esp_timer_get_time()));
    cmd->type=CMD_TYPE_FERTIGATION_BATCH; cmd->param_on=true; strncpy(cmd->source,"HTTP",sizeof(cmd->source)-1);
    if(ss){strncpy(cmd->target_complex_id,ss->complex_id,sizeof(cmd->target_complex_id)-1);cmd->configuration_version=ss->config_version;}
    if(gh&&cJSON_IsString(gh))strncpy(cmd->target_gh_id,gh->valuestring,sizeof(cmd->target_gh_id)-1);
    char *serialized=cJSON_PrintUnformatted(target); if(!serialized){free(cmd);cJSON_Delete(body);http_send_error(req,500,"NO_MEM","Unable to serialize fertigation command.",NULL);return ESP_FAIL;}
    strncpy(cmd->fertigation_payload_json,serialized,sizeof(cmd->fertigation_payload_json)-1); cmd->fertigation_payload_json[sizeof(cmd->fertigation_payload_json)-1]='\0'; free(serialized); cJSON_Delete(body);
    command_item_t *receipt = calloc(1, sizeof(command_item_t));
    if(!receipt){free(cmd);http_send_error(req,500,"NO_MEM","Out of memory for receipt",NULL);return ESP_FAIL;}
    esp_err_t err=command_mgr_submit(cmd,receipt);
    if(err!=ESP_OK){http_send_error(req,err==ESP_ERR_INVALID_STATE?409:422,"FERTIGATION_START_REJECTED",receipt->message[0]?receipt->message:"Fertigation command rejected by local validation.",NULL);free(receipt);free(cmd);return ESP_FAIL;}
    cJSON *out=cJSON_CreateObject(); cJSON_AddStringToObject(out,"status",receipt->status==CMD_STATUS_RUNNING?"RUNNING":"ACCEPTED"); cJSON_AddStringToObject(out,"commandId",receipt->command_id); cJSON_AddStringToObject(out,"resultCode",receipt->result_code); free(receipt);free(cmd); return http_send_enveloped_response(req,202,NULL,out);
}

static void attach_queue_and_today_schedule(cJSON *out) {
    if (!out) return;
    dosing_queue_entry_t q_entries[8];
    size_t q_count = 0;
    if (scheduler_get_dosing_queue(q_entries, 8, &q_count) == ESP_OK) {
        cJSON *qb = cJSON_GetObjectItem(out, "queuedBatches");
        if (!qb) qb = cJSON_AddArrayToObject(out, "queuedBatches");
        else {
            while (cJSON_GetArraySize(qb) > 0) cJSON_DeleteItemFromArray(qb, 0);
        }
        for (size_t i = 0; i < q_count; i++) {
            cJSON *item = cJSON_CreateObject();
            cJSON_AddStringToObject(item, "queueId", q_entries[i].queue_id);
            cJSON_AddStringToObject(item, "occurrenceId", q_entries[i].occurrence_id);
            cJSON_AddStringToObject(item, "scheduleId", q_entries[i].schedule_id);
            cJSON_AddStringToObject(item, "ghId", q_entries[i].gh_id);
            cJSON_AddStringToObject(item, "batchId", q_entries[i].batch_id);
            const char *st_str = "PENDING";
            if (q_entries[i].state == QUEUE_STATE_DISPATCHED) st_str = "DISPATCHED";
            else if (q_entries[i].state == QUEUE_STATE_ACTIVE) st_str = "ACTIVE";
            else if (q_entries[i].state == QUEUE_STATE_COMPLETED) st_str = "COMPLETED";
            else if (q_entries[i].state == QUEUE_STATE_FAILED) st_str = "FAILED";
            cJSON_AddStringToObject(item, "status", st_str);
            if (q_entries[i].error_code[0]) {
                cJSON_AddStringToObject(item, "errorCode", q_entries[i].error_code);
            }
            if (q_entries[i].affected_component_id[0]) {
                cJSON_AddStringToObject(item, "affectedComponent", q_entries[i].affected_component_id);
            }
            cJSON_AddItemToArray(qb, item);
        }
    }

    today_occurrence_t *occs = malloc(sizeof(today_occurrence_t) * 32);
    size_t occ_count = 0;
    if (occs && scheduler_get_today_occurrences(occs, 32, &occ_count) == ESP_OK) {
        cJSON *ts = cJSON_GetObjectItem(out, "todaySchedule");
        if (!ts) ts = cJSON_AddArrayToObject(out, "todaySchedule");
        else {
            while (cJSON_GetArraySize(ts) > 0) cJSON_DeleteItemFromArray(ts, 0);
        }
        for (size_t i = 0; i < occ_count; i++) {
            cJSON *item = cJSON_CreateObject();
            cJSON_AddStringToObject(item, "occurrenceId", occs[i].occurrence_id);
            cJSON_AddStringToObject(item, "scheduleId", occs[i].schedule_id);
            cJSON_AddStringToObject(item, "complexId", occs[i].complex_id);
            cJSON_AddStringToObject(item, "ghId", occs[i].gh_id);
            cJSON_AddNumberToObject(item, "scheduledTimestamp", (double)occs[i].scheduled_timestamp);
            const char *st_str = "PENDING";
            if (occs[i].state == OCC_STATE_PREPARING) st_str = "PREPARING";
            else if (occs[i].state == OCC_STATE_WAITING_BATCH) st_str = "WAITING_BATCH";
            else if (occs[i].state == OCC_STATE_READY_TO_SEND) st_str = "READY_TO_SEND";
            else if (occs[i].state == OCC_STATE_DISTRIBUTING) st_str = "DISTRIBUTING";
            else if (occs[i].state == OCC_STATE_COMPLETED) st_str = "COMPLETED";
            else if (occs[i].state == OCC_STATE_FAILED) st_str = "FAILED";
            else if (occs[i].state == OCC_STATE_AWAITING_DECISION) st_str = "AWAITING_DECISION";
            cJSON_AddStringToObject(item, "status", st_str);
            cJSON_AddStringToObject(item, "queueId", occs[i].queue_id);
            cJSON_AddStringToObject(item, "batchId", occs[i].batch_id);
            if (occs[i].error_code[0]) {
                cJSON_AddStringToObject(item, "errorCode", occs[i].error_code);
            }
            if (occs[i].affected_component_id[0]) {
                cJSON_AddStringToObject(item, "affectedComponent", occs[i].affected_component_id);
            }
            cJSON_AddItemToArray(ts, item);
        }
    }
    if (occs) free(occs);

    delivery_slot_t dslots[FERT_MAX_DELIVERY_SLOTS];
    size_t dslot_count = 0;
    if (fertigation_mgr_get_delivery_slots(dslots, FERT_MAX_DELIVERY_SLOTS, &dslot_count) == ESP_OK) {
        cJSON *ds_arr = cJSON_GetObjectItem(out, "activeDeliveries");
        if (!ds_arr) ds_arr = cJSON_AddArrayToObject(out, "activeDeliveries");
        else {
            while (cJSON_GetArraySize(ds_arr) > 0) cJSON_DeleteItemFromArray(ds_arr, 0);
        }
        for (size_t i = 0; i < dslot_count; i++) {
            cJSON *ds_item = cJSON_CreateObject();
            cJSON_AddStringToObject(ds_item, "ghId", dslots[i].gh_id);
            cJSON_AddStringToObject(ds_item, "occurrenceId", dslots[i].occurrence_id);
            cJSON_AddStringToObject(ds_item, "batchId", dslots[i].batch_id);
            const char *st = "IDLE";
            if (dslots[i].state == DELIVERY_SLOT_READY_TO_SEND) st = "READY_TO_SEND";
            else if (dslots[i].state == DELIVERY_SLOT_DISTRIBUTING) st = "DISTRIBUTING";
            else if (dslots[i].state == DELIVERY_SLOT_COMPLETE) st = "COMPLETED";
            else if (dslots[i].state == DELIVERY_SLOT_FAULTED) st = "FAILED";
            cJSON_AddStringToObject(ds_item, "status", st);
            cJSON_AddStringToObject(ds_item, "deliveryPumpId", dslots[i].delivery_pump_id);
            cJSON_AddItemToArray(ds_arr, ds_item);
        }
    }
    cJSON_AddBoolToObject(out, "dailyTriggerExecuted", scheduler_is_daily_triggered_today());
}

static esp_err_t status_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *out = NULL;
    if (fertigation_mgr_get_active_snapshot(&out) != ESP_OK || !out) {
        http_send_error(req, 500, "FERTIGATION_STATUS_FAILED", "Unable to read fertigation state.", NULL);
        return ESP_FAIL;
    }
    attach_queue_and_today_schedule(out);

    // ITEM-4: Wire dailyStats to /fertigation/status response.
    // Firmware has fertigation_mgr_get_daily_stats() (fertigation_mgr.h:152)
    // but it wasn't exposed via HTTP. Web UI TodayFertigationStatsCard was
    // computing client-side approximation; now it can use authoritative data.
    fertigation_daily_stats_t stats = {0};
    if (fertigation_mgr_get_daily_stats(&stats) == ESP_OK) {
        cJSON *ds = cJSON_AddObjectToObject(out, "dailyStats");
        cJSON_AddNumberToObject(ds, "runCountToday", stats.run_count_today);
        cJSON_AddNumberToObject(ds, "deliveredLitersToday", stats.delivered_liters_today);
        cJSON_AddNumberToObject(ds, "targetLitersToday", stats.target_liters_today);
    }

    return http_send_enveloped_response(req, 200, NULL, out);
}

static esp_err_t queue_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *out = cJSON_CreateObject();
    if (!out) {
        http_send_error(req, 500, "NO_MEM", "Out of memory", NULL);
        return ESP_FAIL;
    }
    cJSON *active_batch = NULL;
    if (fertigation_mgr_get_active_snapshot(&active_batch) == ESP_OK && active_batch) {
        cJSON_AddItemToObject(out, "activeBatch", active_batch);
    }
    attach_queue_and_today_schedule(out);

    // ITEM-4: Wire dailyStats to /fertigation/queue response too (same data).
    fertigation_daily_stats_t stats = {0};
    if (fertigation_mgr_get_daily_stats(&stats) == ESP_OK) {
        cJSON *ds = cJSON_AddObjectToObject(out, "dailyStats");
        cJSON_AddNumberToObject(ds, "runCountToday", stats.run_count_today);
        cJSON_AddNumberToObject(ds, "deliveredLitersToday", stats.delivered_liters_today);
        cJSON_AddNumberToObject(ds, "targetLitersToday", stats.target_liters_today);
    }

    return http_send_enveloped_response(req, 200, NULL, out);
}

static esp_err_t deliver_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *body = NULL;
    if (http_parse_json_body(req, &body) != ESP_OK || !body) {
        http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON", NULL);
        return ESP_FAIL;
    }
    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    cJSON *target = payload ? payload : body;
    cJSON *gh = cJSON_GetObjectItem(target, "ghId");
    if (!gh) gh = cJSON_GetObjectItem(target, "targetGhId");
    cJSON *occ = cJSON_GetObjectItem(target, "occurrenceId");
    const char *gh_id = (gh && cJSON_IsString(gh)) ? gh->valuestring : NULL;
    const char *occ_id = (occ && cJSON_IsString(occ)) ? occ->valuestring : NULL;
    esp_err_t err = fertigation_mgr_trigger_distribution(gh_id, occ_id);
    cJSON_Delete(body);
    if (err != ESP_OK) {
        http_send_error(req, err == ESP_ERR_NOT_FOUND ? 404 : 409, "DISTRIBUTION_FAILED",
                        "No batch in MIX_READY state found to distribute.", NULL);
        return ESP_FAIL;
    }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "status", "DISTRIBUTING");
    return http_send_enveloped_response(req, 200, NULL, o);
}

static esp_err_t stop_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    if (fertigation_mgr_cancel_batch() != ESP_OK) {
        http_send_error(req, 409, "FERTIGATION_STOP_FAILED", "Fertigation is not in a stoppable state.", NULL);
        return ESP_FAIL;
    }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "status", "ABORTED");
    return http_send_enveloped_response(req, 200, NULL, o);
}

static esp_err_t resume_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    if (req && req->content_len > 0) {
        cJSON *drain = NULL;
        (void)http_parse_json_body(req, &drain);
        if (drain) cJSON_Delete(drain);
    }
    esp_err_t err = fertigation_mgr_resume();
    if (err == ESP_ERR_INVALID_STATE) {
        http_send_error(req, 409, "NOT_IN_RECOVERY_HOLD", "Fertigation is not in RECOVERY_HOLD state to resume.", NULL);
        return ESP_FAIL;
    }
    if (err != ESP_OK) {
        http_send_error(req, 422, "FERTIGATION_RESUME_FAILED", "Unable to resume fertigation batch.", NULL);
        return ESP_FAIL;
    }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "status", "RESUMED");
    cJSON_AddStringToObject(o, "state", "MIXING");
    return http_send_enveloped_response(req, 200, NULL, o);
}

static esp_err_t discard_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    if (req && req->content_len > 0) {
        cJSON *drain = NULL;
        (void)http_parse_json_body(req, &drain);
        if (drain) cJSON_Delete(drain);
    }
    esp_err_t err = fertigation_mgr_discard();
    if (err == ESP_ERR_INVALID_STATE) {
        http_send_error(req, 409, "NOT_IN_RECOVERY_HOLD", "Fertigation is not in RECOVERY_HOLD state to discard.", NULL);
        return ESP_FAIL;
    }
    if (err != ESP_OK) {
        http_send_error(req, 422, "FERTIGATION_DISCARD_FAILED", "Unable to discard fertigation batch.", NULL);
        return ESP_FAIL;
    }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "status", "DISCARDED");
    cJSON_AddStringToObject(o, "state", "IDLE");
    return http_send_enveloped_response(req, 200, NULL, o);
}

/* P2.2: operator acknowledge untuk delivery yang terinterupsi reboot
 * (atau slot delivery yang selesai). Membebaskan blokir GH. */
static esp_err_t delivery_ack_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *body = NULL;
    const char *gh_id = NULL;
    const char *occ_id = NULL;
    if (http_parse_json_body(req, &body) == ESP_OK && body) {
        cJSON *payload = cJSON_GetObjectItem(body, "payload");
        cJSON *target = payload ? payload : body;
        cJSON *gh = cJSON_GetObjectItem(target, "ghId");
        if (!gh) gh = cJSON_GetObjectItem(target, "targetGhId");
        cJSON *occ = cJSON_GetObjectItem(target, "occurrenceId");
        gh_id = (gh && cJSON_IsString(gh)) ? gh->valuestring : NULL;
        occ_id = (occ && cJSON_IsString(occ)) ? occ->valuestring : NULL;
    }
    esp_err_t err = fertigation_mgr_acknowledge_delivery(gh_id, occ_id);
    if (body) cJSON_Delete(body);
    if (err != ESP_OK) {
        http_send_error(req, 404, "DELIVERY_ACK_FAILED",
                        "No delivery slot or interrupted delivery found to acknowledge.", NULL);
        return ESP_FAIL;
    }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "status", "ACKNOWLEDGED");
    return http_send_enveloped_response(req, 200, NULL, o);
}

/* P2.3-final: keputusan operator Lanjutkan/Lewati untuk missed occurrence. */
static esp_err_t occurrence_decision_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *body = NULL;
    if (http_parse_json_body(req, &body) != ESP_OK || !body) {
        http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON", NULL);
        return ESP_FAIL;
    }
    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    cJSON *target = (payload && cJSON_IsObject(payload)) ? payload : body;
    cJSON *oid = cJSON_GetObjectItem(target, "occurrenceId");
    if (!oid) oid = cJSON_GetObjectItem(target, "occurrence_id");
    cJSON *dec = cJSON_GetObjectItem(target, "decision");
    const char *occ_id = (oid && cJSON_IsString(oid)) ? oid->valuestring : NULL;
    const char *decision = (dec && cJSON_IsString(dec)) ? dec->valuestring : NULL;
    bool do_continue = false;
    bool dec_valid = false;
    if (decision) {
        if (strcasecmp(decision, "continue") == 0 || strcasecmp(decision, "lanjutkan") == 0) {
            do_continue = true; dec_valid = true;
        } else if (strcasecmp(decision, "skip") == 0 || strcasecmp(decision, "lewati") == 0) {
            do_continue = false; dec_valid = true;
        }
    }
    if (!occ_id || !occ_id[0] || !dec_valid) {
        cJSON_Delete(body);
        http_send_error(req, 422, "VALIDATION_FAILED",
                        "occurrenceId and decision ('continue'|'skip') are required", NULL);
        return ESP_FAIL;
    }
    char err_code[48] = {0};
    /* P2.6: salin occ_id sebelum cJSON_Delete(body) — occ_id menunjuk ke
     * dalam body, use-after-free bila dipakai setelah delete. */
    char occ_id_buf[128] = {0};
    strncpy(occ_id_buf, occ_id, sizeof(occ_id_buf) - 1);
    esp_err_t err = scheduler_decide_occurrence(occ_id_buf, do_continue, err_code, sizeof(err_code));
    cJSON_Delete(body);
    if (err == ESP_ERR_NOT_FOUND) {
        http_send_error(req, 404, "OCCURRENCE_NOT_FOUND", "Occurrence not found", NULL);
        return ESP_FAIL;
    }
    if (err != ESP_OK) {
        http_send_error(req, 409, err_code[0] ? err_code : "DECISION_FAILED",
                        "Operator decision could not be applied", NULL);
        return ESP_FAIL;
    }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "status", do_continue ? "CONTINUED" : "SKIPPED");
    cJSON_AddStringToObject(o, "occurrenceId", occ_id_buf);
    return http_send_enveloped_response(req, 200, NULL, o);
}

/* ===== Otomatisasi fertigasi: auto-trigger distribusi terjadwal =====
 *
 * Task ini mem-poll occurrence hari ini setiap 30 detik. Ketika ada occurrence
 * berstatus READY_TO_SEND (jadwal sudah tiba dan mixing selesai), distribusi
 * dipicu otomatis via fertigation_mgr_trigger_distribution() — setara tombol
 * "Siram" manual di Web UI, tanpa intervensi operator.
 *
 * Safety gate (E-STOP + safety monitor) diperiksa sebelum setiap trigger;
 * GH yang sedang sibuk (batch/delivery aktif) dilewati.
 *
 * Task dimulai sekali dari register_api_fertigation_handlers() (dipanggil saat
 * HTTP server init, setelah semua service siap).
 *
 * Spec: jobs/specs/firmware-delivery-spec.md (repo bridge).
 * Permintaan user 2026-10-13: "if (jadwal tiba) { execute mixing protocol() }".
 */
#include "services/scheduler.h"
#include "services/fertigation_mgr.h"
#include "hal/actuator_hal.h"
#include "services/event_mgr.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <time.h>
#include <string.h>
#include <stdio.h>

#define FERT_AUTO_POLL_MS 30000
#define FERT_AUTO_MAX_OCC 16
#define FERT_UI_MAX_OCC 16

static today_occurrence_t s_auto_occs[FERT_AUTO_MAX_OCC];
static bool s_auto_started = false;

/* Daftar occurrence yang di-clear manual — dilewati auto-trigger agar tidak
 * di-trigger ulang setelah operator membuang hasil racikan. */
#define FERT_CLEARED_MAX 16
static char s_cleared_occs[FERT_CLEARED_MAX][64];
static size_t s_cleared_n = 0;

static bool fert_auto_is_cleared(const char *occurrence_id) {
  if (!occurrence_id || !occurrence_id[0]) {
    return false;
  }
  for (size_t i = 0; i < s_cleared_n; i++) {
    if (strcmp(s_cleared_occs[i], occurrence_id) == 0) {
      return true;
    }
  }
  return false;
}

static void fert_auto_mark_cleared(const char *occurrence_id) {
  if (!occurrence_id || !occurrence_id[0] || fert_auto_is_cleared(occurrence_id)) {
    return;
  }
  if (s_cleared_n >= FERT_CLEARED_MAX) {
    s_cleared_n = 0;
  }
  snprintf(s_cleared_occs[s_cleared_n], sizeof(s_cleared_occs[0]), "%s", occurrence_id);
  s_cleared_n++;
}

static void fertigation_auto_task(void *arg) {
  (void)arg;
  ESP_LOGI("fertigation_auto", "task started (poll %d ms)", (int)FERT_AUTO_POLL_MS);
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(FERT_AUTO_POLL_MS));
    /* Safety gate: jangan pernah auto-trigger saat E-STOP / safety fault. */
    if (actuator_hal_is_emergency_stopped() || !safety_monitor_allows_commands()) {
      continue;
    }
    size_t n = 0;
    if (scheduler_get_today_occurrences(s_auto_occs, FERT_AUTO_MAX_OCC, &n) != ESP_OK) {
      ESP_LOGW("fertigation_auto", "scheduler_get_today_occurrences failed");
      continue;
    }
    for (size_t i = 0; i < n; i++) {
      today_occurrence_t *o = &s_auto_occs[i];
      if (o->state != OCC_STATE_READY_TO_SEND) {
        continue;
      }
      if (o->gh_id[0] == '\0' || o->occurrence_id[0] == '\0') {
        continue;
      }
      /* Dilewati bila operator sudah clear manual. */
      if (fert_auto_is_cleared(o->occurrence_id)) {
        continue;
      }
      if (fertigation_mgr_is_gh_busy(o->gh_id)) {
        continue;
      }
      ESP_LOGI("fertigation_auto", "auto-trigger gh=%s occ=%s", o->gh_id, o->occurrence_id);
      esp_err_t err = fertigation_mgr_trigger_distribution(o->gh_id, o->occurrence_id);
      if (err == ESP_OK) {
        (void)event_mgr_log_command(LOG_LEVEL_INFO, "FERTIGATION_AUTO_TRIGGER",
                                    "Otomatis: distribusi dimulai (jadwal tiba).",
                                    NULL, NULL, o->gh_id, NULL, NULL, 0);
      } else {
        ESP_LOGW("fertigation_auto", "trigger failed gh=%s occ=%s err=%d",
                 o->gh_id, o->occurrence_id, (int)err);
      }
    }
  }
}

static void fertigation_auto_start(void) {
  if (s_auto_started) {
    return;
  }
  s_auto_started = true;
  if (xTaskCreate(fertigation_auto_task, "fert_auto", 4096, NULL, 5, NULL) != pdPASS) {
    ESP_LOGW("fertigation_auto", "xTaskCreate gagal");
    s_auto_started = false;
  }
}

/* ===== Endpoint UI Fertigasi: daily list, tanks, clear-ready =====
 *
 * Memberi makan panel "Daily Fertigation List" dan tangki di tab Fertigasi
 * Web UI, serta menyediakan POST /clear-ready dengan field `ok` yang
 * diharapkan UI (endpoint ini belum ada di firmware).
 */

static const char *fert_ui_occ_status(const today_occurrence_t *o) {
  switch (o->state) {
    case OCC_STATE_READY_TO_SEND:
      return "ready";
    case OCC_STATE_DISTRIBUTING:
      return "delivering";
    case OCC_STATE_COMPLETED:
      return "selesai";
    case OCC_STATE_FAILED:
      return "gagal";
    case OCC_STATE_PENDING:
    case OCC_STATE_AWAITING_DECISION:
    default:
      /* GH sedang meracik (batch aktif) vs menunggu giliran. */
      if (o->gh_id[0] != '\0' && fertigation_mgr_is_gh_busy(o->gh_id)) {
        return "mixing";
      }
      return "menunggu-mixing";
  }
}

static void fert_ui_format_time(int64_t ts, char *out, size_t out_len) {
  if (!out || out_len == 0) {
    return;
  }
  out[0] = '\0';
  if (ts <= 0) {
    return;
  }
  time_t t = (time_t)ts;
  struct tm tmv;
  if (localtime_r(&t, &tmv) == NULL) {
    return;
  }
  snprintf(out, out_len, "%02d:%02d", tmv.tm_hour, tmv.tm_min);
}

static esp_err_t fertigation_daily_handler(httpd_req_t *req) {
  if (http_check_auth(req) != ESP_OK) return ESP_OK;
  today_occurrence_t *occs = (today_occurrence_t *)calloc(FERT_UI_MAX_OCC, sizeof(today_occurrence_t));
  if (!occs) {
    http_send_error(req, 500, "NO_MEM", "Out of memory", NULL);
    return ESP_FAIL;
  }
  size_t n = 0;
  if (scheduler_get_today_occurrences(occs, FERT_UI_MAX_OCC, &n) != ESP_OK) {
    free(occs);
    http_send_error(req, 500, "DAILY_FETCH_FAILED", "Gagal membaca jadwal hari ini.", NULL);
    return ESP_FAIL;
  }
  cJSON *arr = cJSON_CreateArray();
  if (!arr) {
    free(occs);
    http_send_error(req, 500, "NO_MEM", "Out of memory", NULL);
    return ESP_FAIL;
  }
  for (size_t i = 0; i < n; i++) {
    today_occurrence_t *o = &occs[i];
    char time_s[8];
    fert_ui_format_time(o->scheduled_timestamp, time_s, sizeof(time_s));
    cJSON *it = cJSON_CreateObject();
    if (!it) {
      continue;
    }
    cJSON_AddStringToObject(it, "id", o->occurrence_id);
    cJSON_AddStringToObject(it, "time", time_s);
    cJSON_AddStringToObject(it, "ghId", o->gh_id);
    cJSON_AddStringToObject(it, "ghCode", o->gh_id);
    cJSON_AddStringToObject(it, "recipeName", "");
    cJSON_AddNumberToObject(it, "targetWaterL", 0);
    cJSON_AddStringToObject(it, "status", fert_ui_occ_status(o));
    cJSON_AddBoolToObject(it, "tankReady", o->state == OCC_STATE_READY_TO_SEND);
    cJSON_AddItemToArray(arr, it);
  }
  free(occs);
  return http_send_enveloped_response(req, 200, NULL, arr);
}

static esp_err_t fertigation_tanks_handler(httpd_req_t *req) {
  if (http_check_auth(req) != ESP_OK) return ESP_OK;
  today_occurrence_t *occs = (today_occurrence_t *)calloc(FERT_UI_MAX_OCC, sizeof(today_occurrence_t));
  if (!occs) {
    http_send_error(req, 500, "NO_MEM", "Out of memory", NULL);
    return ESP_FAIL;
  }
  size_t n = 0;
  if (scheduler_get_today_occurrences(occs, FERT_UI_MAX_OCC, &n) != ESP_OK) {
    free(occs);
    http_send_error(req, 500, "TANKS_FETCH_FAILED", "Gagal membaca status tong.", NULL);
    return ESP_FAIL;
  }
  /* Kumpulkan gh_id unik (maks 8 GH). */
  char seen_gh[8][64];
  size_t seen_n = 0;
  for (size_t i = 0; i < n && seen_n < 8; i++) {
    const char *gh = occs[i].gh_id;
    if (gh[0] == '\0') {
      continue;
    }
    bool dup = false;
    for (size_t k = 0; k < seen_n; k++) {
      if (strcmp(seen_gh[k], gh) == 0) {
        dup = true;
        break;
      }
    }
    if (dup) {
      continue;
    }
    snprintf(seen_gh[seen_n], sizeof(seen_gh[0]), "%s", gh);
    seen_n++;
  }
  cJSON *arr = cJSON_CreateArray();
  if (!arr) {
    free(occs);
    http_send_error(req, 500, "NO_MEM", "Out of memory", NULL);
    return ESP_FAIL;
  }
  for (size_t k = 0; k < seen_n; k++) {
    const char *gh = seen_gh[k];
    const char *state = "kosong";
    int pct = 0;
    for (size_t i = 0; i < n; i++) {
      if (strcmp(occs[i].gh_id, gh) != 0) {
        continue;
      }
      if (occs[i].state == OCC_STATE_READY_TO_SEND) {
        state = "ready";
        pct = 100;
        break;
      }
    }
    if (pct == 0 && fertigation_mgr_is_gh_busy(gh)) {
      state = "mixing";
      pct = 50;
    }
    cJSON *t = cJSON_CreateObject();
    if (!t) {
      continue;
    }
    cJSON_AddStringToObject(t, "ghId", gh);
    cJSON_AddStringToObject(t, "ghCode", gh);
    cJSON_AddStringToObject(t, "state", state);
    cJSON_AddNumberToObject(t, "levelPct", pct);
    cJSON_AddItemToArray(arr, t);
  }
  free(occs);
  return http_send_enveloped_response(req, 200, NULL, arr);
}

static esp_err_t clear_ready_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *body=NULL; if(http_parse_json_body(req,&body)!=ESP_OK||!body){http_send_error(req,422,"VALIDATION_FAILED","Invalid JSON",NULL);return ESP_FAIL;}
    cJSON *payload=cJSON_GetObjectItem(body,"payload"); cJSON *target=payload?payload:body;
    cJSON *occ=cJSON_GetObjectItem(target,"occurrenceId"); cJSON *bat=cJSON_GetObjectItem(target,"batchId");
    const char *occ_id=(occ&&cJSON_IsString(occ)&&occ->valuestring[0])?occ->valuestring:NULL;
    const char *batch_id=(bat&&cJSON_IsString(bat)&&bat->valuestring[0])?bat->valuestring:NULL;
    cJSON_Delete(body);
    if(!occ_id&&!batch_id){http_send_error(req,422,"VALIDATION_FAILED","occurrenceId or batchId is required.",NULL);return ESP_FAIL;}
    /* Cari occurrence untuk dapatkan gh_id. */
    today_occurrence_t *occs=(today_occurrence_t*)calloc(FERT_UI_MAX_OCC,sizeof(today_occurrence_t));
    if(!occs){http_send_error(req,500,"NO_MEM","Out of memory",NULL);return ESP_FAIL;}
    size_t n=0;
    if(scheduler_get_today_occurrences(occs,FERT_UI_MAX_OCC,&n)!=ESP_OK){
      free(occs);
      http_send_error(req,500,"CLEAR_LOOKUP_FAILED","Gagal membaca jadwal.",NULL);
      return ESP_FAIL;
    }
    const char *gh_id=NULL; const char *target_occ=NULL;
    for(size_t i=0;i<n;i++){
      bool match=false;
      if(occ_id&&strcmp(occs[i].occurrence_id,occ_id)==0) match=true;
      if(batch_id&&occs[i].batch_id[0]&&strcmp(occs[i].batch_id,batch_id)==0) match=true;
      if(match){gh_id=occs[i].gh_id;target_occ=occs[i].occurrence_id;break;}
    }
    free(occs);
    /* Jangan clear saat GH sedang sibuk (batch/delivery aktif). */
    if(fertigation_mgr_is_gh_busy(gh_id)){
      http_send_error(req,409,"READY_CLEAR_REFUSED","Batch fisik sedang berjalan.",NULL);
      return ESP_FAIL;
    }
    cJSON *o=cJSON_CreateObject();
    if(!o){http_send_error(req,500,"NO_MEM","Out of memory",NULL);return ESP_FAIL;}
    if(!gh_id||!target_occ){
      cJSON_AddBoolToObject(o,"ok",false);
      cJSON_AddBoolToObject(o,"cleared",false);
      cJSON_AddStringToObject(o,"reason","not_found");
      cJSON_AddStringToObject(o,"message","Jadwal tidak ditemukan hari ini.");
      return http_send_enveloped_response(req,200,NULL,o);
    }
    /* Acknowledge delivery untuk menghapus slot READY (sudah terverifikasi ada). */
    esp_err_t err=fertigation_mgr_acknowledge_delivery(gh_id,target_occ);
    if(err!=ESP_OK&&err!=ESP_ERR_NOT_FOUND){
      cJSON_Delete(o);
      http_send_error(req,500,"READY_CLEAR_FAILED","Gagal clear READY.",NULL);
      return ESP_FAIL;
    }
    bool cleared=(err==ESP_OK||err==ESP_ERR_NOT_FOUND);
    if(cleared){fert_auto_mark_cleared(target_occ);}
    cJSON_AddBoolToObject(o,"ok",cleared);
    cJSON_AddBoolToObject(o,"cleared",cleared);
    cJSON_AddStringToObject(o,"reason",cleared?"ok":"not_ready");
    cJSON_AddStringToObject(o,"clearedOccurrenceId",target_occ);
    if(batch_id) cJSON_AddStringToObject(o,"clearedBatchId",batch_id);
    return http_send_enveloped_response(req,200,NULL,o);
}

void register_api_fertigation_handlers(httpd_handle_t server){
    httpd_uri_t a={.uri="/api/v1/fertigation/start",.method=HTTP_POST,.handler=start_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&a);
    httpd_uri_t b={.uri="/api/v1/fertigation/status",.method=HTTP_GET,.handler=status_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&b);
    httpd_uri_t q={.uri="/api/v1/fertigation/queue",.method=HTTP_GET,.handler=queue_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&q);
    httpd_uri_t d={.uri="/api/v1/fertigation/deliver",.method=HTTP_POST,.handler=deliver_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&d);
    httpd_uri_t c={.uri="/api/v1/fertigation/stop",.method=HTTP_POST,.handler=stop_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&c);
    httpd_uri_t res={.uri="/api/v1/fertigation/resume",.method=HTTP_POST,.handler=resume_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&res);
    httpd_uri_t disc={.uri="/api/v1/fertigation/discard",.method=HTTP_POST,.handler=discard_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&disc);
    httpd_uri_t dack={.uri="/api/v1/fertigation/delivery/ack",.method=HTTP_POST,.handler=delivery_ack_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&dack);
    httpd_uri_t odec={.uri="/api/v1/schedule-occurrences/decision",.method=HTTP_POST,.handler=occurrence_decision_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&odec);
    httpd_uri_t daily={.uri="/api/v1/fertigation/daily",.method=HTTP_GET,.handler=fertigation_daily_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&daily);
    httpd_uri_t tanks={.uri="/api/v1/fertigation/tanks",.method=HTTP_GET,.handler=fertigation_tanks_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&tanks);
    httpd_uri_t cr={.uri="/api/v1/fertigation/clear-ready",.method=HTTP_POST,.handler=clear_ready_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&cr);
    /* Otomatisasi fertigasi: mulai task auto-trigger (sekali saja). */
    fertigation_auto_start();
}
