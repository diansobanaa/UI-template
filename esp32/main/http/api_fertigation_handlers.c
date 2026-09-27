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
    command_item_t cmd; memset(&cmd,0,sizeof(cmd));
    if(cid&&cJSON_IsString(cid)&&cid->valuestring[0]) strncpy(cmd.command_id,cid->valuestring,sizeof(cmd.command_id)-1); else snprintf(cmd.command_id,sizeof(cmd.command_id),"fert-%llu",(unsigned long long)(esp_timer_get_time()));
    cmd.type=CMD_TYPE_FERTIGATION_BATCH; cmd.param_on=true; strncpy(cmd.source,"HTTP",sizeof(cmd.source)-1);
    if(ss){strncpy(cmd.target_complex_id,ss->complex_id,sizeof(cmd.target_complex_id)-1);cmd.configuration_version=ss->config_version;}
    if(gh&&cJSON_IsString(gh))strncpy(cmd.target_gh_id,gh->valuestring,sizeof(cmd.target_gh_id)-1);
    char *serialized=cJSON_PrintUnformatted(target); if(!serialized){cJSON_Delete(body);http_send_error(req,500,"NO_MEM","Unable to serialize fertigation command.",NULL);return ESP_FAIL;}
    strncpy(cmd.fertigation_payload_json,serialized,sizeof(cmd.fertigation_payload_json)-1); cmd.fertigation_payload_json[sizeof(cmd.fertigation_payload_json)-1]='\0'; free(serialized); cJSON_Delete(body);
    command_item_t receipt; esp_err_t err=command_mgr_submit(&cmd,&receipt);
    if(err!=ESP_OK){http_send_error(req,err==ESP_ERR_INVALID_STATE?409:422,"FERTIGATION_START_REJECTED",receipt.message[0]?receipt.message:"Fertigation command rejected by local validation.",NULL);return ESP_FAIL;}
    cJSON *out=cJSON_CreateObject(); cJSON_AddStringToObject(out,"status",receipt.status==CMD_STATUS_RUNNING?"RUNNING":"ACCEPTED"); cJSON_AddStringToObject(out,"commandId",receipt.command_id); cJSON_AddStringToObject(out,"resultCode",receipt.result_code); return http_send_enveloped_response(req,202,NULL,out);
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
}

static esp_err_t status_handler(httpd_req_t *req){
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *out = NULL;
    if (fertigation_mgr_get_active_snapshot(&out) != ESP_OK || !out) {
        http_send_error(req, 500, "FERTIGATION_STATUS_FAILED", "Unable to read fertigation state.", NULL);
        return ESP_FAIL;
    }
    attach_queue_and_today_schedule(out);
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
    return http_send_enveloped_response(req, 200, NULL, out);
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

void register_api_fertigation_handlers(httpd_handle_t server){
    httpd_uri_t a={.uri="/api/v1/fertigation/start",.method=HTTP_POST,.handler=start_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&a);
    httpd_uri_t b={.uri="/api/v1/fertigation/status",.method=HTTP_GET,.handler=status_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&b);
    httpd_uri_t q={.uri="/api/v1/fertigation/queue",.method=HTTP_GET,.handler=queue_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&q);
    httpd_uri_t c={.uri="/api/v1/fertigation/stop",.method=HTTP_POST,.handler=stop_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&c);
}
