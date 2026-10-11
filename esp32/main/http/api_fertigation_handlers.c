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

void register_api_fertigation_handlers(httpd_handle_t server){
    httpd_uri_t a={.uri="/api/v1/fertigation/start",.method=HTTP_POST,.handler=start_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&a);
    httpd_uri_t b={.uri="/api/v1/fertigation/status",.method=HTTP_GET,.handler=status_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&b);
    httpd_uri_t q={.uri="/api/v1/fertigation/queue",.method=HTTP_GET,.handler=queue_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&q);
    httpd_uri_t d={.uri="/api/v1/fertigation/deliver",.method=HTTP_POST,.handler=deliver_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&d);
    httpd_uri_t c={.uri="/api/v1/fertigation/stop",.method=HTTP_POST,.handler=stop_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&c);
    httpd_uri_t res={.uri="/api/v1/fertigation/resume",.method=HTTP_POST,.handler=resume_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&res);
    httpd_uri_t disc={.uri="/api/v1/fertigation/discard",.method=HTTP_POST,.handler=discard_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&disc);
}
