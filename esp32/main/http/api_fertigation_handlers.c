#include "http_server.h"
#include "services/fertigation_mgr.h"
#include "services/command_mgr.h"
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
static esp_err_t status_handler(httpd_req_t *req){
    if(http_check_auth(req)!=ESP_OK)return ESP_OK;
    cJSON *out=NULL; if(fertigation_mgr_get_active_snapshot(&out)!=ESP_OK||!out){http_send_error(req,500,"FERTIGATION_STATUS_FAILED","Unable to read fertigation state.",NULL);return ESP_FAIL;} return http_send_enveloped_response(req,200,NULL,out);
}
static esp_err_t stop_handler(httpd_req_t *req){
    if(http_check_auth(req)!=ESP_OK)return ESP_OK; if(fertigation_mgr_cancel_batch()!=ESP_OK){http_send_error(req,409,"FERTIGATION_STOP_FAILED","Fertigation is not in a stoppable state.",NULL);return ESP_FAIL;} cJSON *o=cJSON_CreateObject();cJSON_AddStringToObject(o,"status","ABORTED");return http_send_enveloped_response(req,200,NULL,o);
}
void register_api_fertigation_handlers(httpd_handle_t server){
    httpd_uri_t a={.uri="/api/v1/fertigation/start",.method=HTTP_POST,.handler=start_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&a);
    httpd_uri_t b={.uri="/api/v1/fertigation/status",.method=HTTP_GET,.handler=status_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&b);
    httpd_uri_t c={.uri="/api/v1/fertigation/stop",.method=HTTP_POST,.handler=stop_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&c);
}
