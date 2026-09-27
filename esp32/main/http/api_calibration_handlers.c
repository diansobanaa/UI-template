#include "http_server.h"
#include "services/calibration_mgr.h"
#include "esp_log.h"
#include "cJSON.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include <string.h>
#include <strings.h>
#include <stdlib.h>

static const char *TAG = "API_CALIB";
static calibration_record_state_t parse_record_state(const char *s)
{
    if (!s) return CAL_RECORD_NOT_CALIBRATED;
    if (strcasecmp(s, "CALIBRATED") == 0) return CAL_RECORD_CALIBRATED;
    if (strcasecmp(s, "VERIFIED") == 0) return CAL_RECORD_VERIFIED;
    if (strcasecmp(s, "EXPIRED") == 0) return CAL_RECORD_EXPIRED;
    if (strcasecmp(s, "SUSPECT") == 0) return CAL_RECORD_SUSPECT;
    if (strcasecmp(s, "RECALIBRATED") == 0) return CAL_RECORD_RECALIBRATED;
    if (strcasecmp(s, "REMOVED") == 0) return CAL_RECORD_REMOVED;
    return CAL_RECORD_NOT_CALIBRATED;
}

static bool supported_record_type(const char *s)
{
    if (!s) return false;
    return strcasecmp(s, "DOSING_RATE") == 0 || strcasecmp(s, "FLOW") == 0 ||
           strcasecmp(s, "LEVEL") == 0 || strcasecmp(s, "PH") == 0 || strcasecmp(s, "EC") == 0;
}

static bool complex_matches_device(cJSON *target)
{
    const char *expected = storage_mgr_get_state() ? storage_mgr_get_state()->complex_id : NULL;
    cJSON *cid = cJSON_GetObjectItem(target, "complexId");
    if (!expected || !expected[0] || !cid || !cJSON_IsString(cid)) return false;
    return strcmp(expected, cid->valuestring) == 0;
}

static bool calibration_component_compatible(const hw_component_info_t *info, const char *cal_type)
{
    if (!info || !cal_type || !cal_type[0]) return false;
    if (info->lifecycle_state == HW_LIFECYCLE_REMOVED) return false;
    char text[160];
    snprintf(text, sizeof(text), "%s %s %s %s", info->supported_type_id, info->role, info->name, info->component_id);
    if (strcasecmp(cal_type, "DOSING_RATE") == 0) return strcasestr(text, "DOSING") != NULL;
    if (strcasecmp(cal_type, "FLOW") == 0) return strcasestr(text, "FLOW") != NULL;
    if (strcasecmp(cal_type, "LEVEL") == 0) return strcasestr(text, "LEVEL") || strcasestr(text, "RADAR") || strcasestr(text, "FLOAT");
    if (strcasecmp(cal_type, "PH") == 0) return strcasestr(text, "PH") != NULL;
    if (strcasecmp(cal_type, "EC") == 0) return strcasestr(text, "EC") || strcasestr(text, "CONDUCTIVITY");
    return false;
}

static bool calibration_component_scoped_to_device(const char *component_id)
{
    if (!component_id || !component_id[0]) return false;
    const system_storage_state_t *state = storage_mgr_get_state();
    if (!state || !state->complex_id[0]) return false;
    hw_component_info_t info;
    if (hardware_registry_find_by_id(component_id, &info) != ESP_OK) return false;
    return info.assignment.complex_id[0] && strcmp(info.assignment.complex_id, state->complex_id) == 0;
}

static esp_err_t api_calibration_start_handler(httpd_req_t *req)
{
    cJSON *json=NULL; if(http_parse_json_body(req,&json)!=ESP_OK||!json){http_send_error(req,400,"BAD_REQUEST","Invalid JSON",NULL);return ESP_FAIL;}
    cJSON *payload=cJSON_GetObjectItem(json,"payload"); cJSON *target=payload?payload:json;
    cJSON *comp=cJSON_GetObjectItem(target,"componentId"); cJSON *type=cJSON_GetObjectItem(target,"type"); cJSON *dur=cJSON_GetObjectItem(target,"duration_sec");
    if(!comp||!cJSON_IsString(comp)||!type||!cJSON_IsString(type)||!dur||!cJSON_IsNumber(dur)||dur->valueint<=0){cJSON_Delete(json);http_send_error(req,422,"VALIDATION_FAILED","componentId, type and positive duration_sec are required",NULL);return ESP_FAIL;}
    if(strcasecmp(type->valuestring,"VOLUMETRIC")!=0){cJSON_Delete(json);http_send_error(req,422,"CALIBRATION_TYPE_UNSUPPORTED","Only VOLUMETRIC dosing calibration execution is supported on-device.",NULL);return ESP_FAIL;}
    if (!calibration_component_scoped_to_device(comp->valuestring)) { cJSON_Delete(json); http_send_error(req,409,"COMPONENT_COMPLEX_MISMATCH","Calibration target component belongs to another Complex.",NULL); return ESP_FAIL; }
    hw_component_info_t component_info;
    if (hardware_registry_find_by_id(comp->valuestring, &component_info) != ESP_OK || !calibration_component_compatible(&component_info, "DOSING_RATE")) { cJSON_Delete(json); http_send_error(req,422,"CALIBRATION_COMPONENT_TYPE_MISMATCH","Calibration target is not a dosing-capable component.",NULL); return ESP_FAIL; }
    esp_err_t err=calibration_mgr_start_volumetric_component(comp->valuestring,(uint32_t)dur->valueint);cJSON_Delete(json);
    if(err!=ESP_OK){http_send_error(req,err==ESP_ERR_INVALID_STATE?409:422,"CALIBRATION_START_FAILED","Calibration start rejected by local hardware/safety policy.",NULL);return ESP_FAIL;}
    cJSON *resp=cJSON_CreateObject();cJSON_AddStringToObject(resp,"status","RUNNING");cJSON_AddStringToObject(resp,"componentId",comp->valuestring);cJSON_AddNumberToObject(resp,"durationSec",dur->valueint);return http_send_enveloped_response(req,202,NULL,resp);
}

static esp_err_t api_calibration_status_handler(httpd_req_t *req)
{
    calibration_status_t st;
    calibration_mgr_get_status(&st);
    
    cJSON *resp = cJSON_CreateObject();
    
    const char *state_str = "IDLE";
    if (st.state == CALIBRATION_STATE_RUNNING) state_str = "RUNNING";
    else if (st.state == CALIBRATION_STATE_COMPLETE) state_str = "COMPLETE";
    else if (st.state == CALIBRATION_STATE_ERROR) state_str = "ERROR";
    
    cJSON_AddStringToObject(resp, "state", state_str);
    cJSON_AddNumberToObject(resp, "remaining_sec", st.remaining_sec);
    
    return http_send_enveloped_response(req, 200, NULL, resp);
}

static esp_err_t api_calibration_set_rate_handler(httpd_req_t *req)
{
    cJSON *json=NULL; if(http_parse_json_body(req,&json)!=ESP_OK||!json){http_send_error(req,400,"BAD_REQUEST","Invalid JSON",NULL);return ESP_FAIL;}
    cJSON *payload=cJSON_GetObjectItem(json,"payload"); cJSON *target=payload?payload:json;
    cJSON *comp=cJSON_GetObjectItem(target,"componentId"); cJSON *rate=cJSON_GetObjectItem(target,"rateMlPerSec"); cJSON *ver=cJSON_GetObjectItem(target,"version"); cJSON *op=cJSON_GetObjectItem(target,"operator"); cJSON *cid=cJSON_GetObjectItem(target,"calibrationId");
    if(!comp||!cJSON_IsString(comp)||!rate||!cJSON_IsNumber(rate)||rate->valuedouble<=0){cJSON_Delete(json);http_send_error(req,422,"VALIDATION_FAILED","componentId and positive rateMlPerSec are required",NULL);return ESP_FAIL;}
    uint32_t version=(ver&&cJSON_IsNumber(ver)&&ver->valuedouble>0)?(uint32_t)ver->valuedouble:1;
    const char *operator_id=(op&&cJSON_IsString(op))?op->valuestring:"technician"; const char *cal_id=(cid&&cJSON_IsString(cid))?cid->valuestring:"device-calibration";
    esp_err_t err=calibration_mgr_set_dosing_rate(comp->valuestring,(float)rate->valuedouble,version,CAL_RECORD_CALIBRATED,operator_id,0,cal_id);cJSON_Delete(json);
    if(err!=ESP_OK){http_send_error(req,err==ESP_ERR_INVALID_STATE?409:422,"CALIBRATION_SAVE_FAILED","Calibration record was not accepted.",NULL);return ESP_FAIL;}
    cJSON *resp=cJSON_CreateObject();cJSON_AddStringToObject(resp,"status","APPLIED");cJSON_AddStringToObject(resp,"componentId",comp->valuestring);cJSON_AddNumberToObject(resp,"rateMlPerSec",rate->valuedouble);cJSON_AddNumberToObject(resp,"version",version);return http_send_enveloped_response(req,200,NULL,resp);
}

static esp_err_t api_calibration_record_handler(httpd_req_t *req)
{
    cJSON *json=NULL; if(http_parse_json_body(req,&json)!=ESP_OK||!json){http_send_error(req,400,"BAD_REQUEST","Invalid JSON",NULL);return ESP_FAIL;}
    cJSON *payload=cJSON_GetObjectItem(json,"payload"); cJSON *target=payload?payload:json;
    cJSON *comp=cJSON_GetObjectItem(target,"componentId"); cJSON *type=cJSON_GetObjectItem(target,"calibrationType"); cJSON *ver=cJSON_GetObjectItem(target,"version");
    if(!complex_matches_device(target)){cJSON_Delete(json);http_send_error(req,409,"COMPLEX_MISMATCH","Calibration record belongs to a different Complex/device.",NULL);return ESP_FAIL;}
    if(!comp||!cJSON_IsString(comp)||!type||!cJSON_IsString(type)||!supported_record_type(type->valuestring)||!ver||!cJSON_IsNumber(ver)||ver->valuedouble<1){cJSON_Delete(json);http_send_error(req,422,"VALIDATION_FAILED","componentId, supported calibrationType and version are required.",NULL);return ESP_FAIL;}
    hw_component_info_t component_info;
    if (hardware_registry_find_by_id(comp->valuestring, &component_info) != ESP_OK) {
        cJSON_Delete(json); http_send_error(req,404,"COMPONENT_NOT_FOUND","Calibration target component is not present in the active registry.",NULL); return ESP_FAIL;
    }
    if (!calibration_component_scoped_to_device(comp->valuestring)) {
        cJSON_Delete(json); http_send_error(req,409,"COMPONENT_COMPLEX_MISMATCH","Calibration target component belongs to another Complex.",NULL); return ESP_FAIL;
    }
    if (!calibration_component_compatible(&component_info, type->valuestring)) {
        cJSON_Delete(json); http_send_error(req,422,"CALIBRATION_COMPONENT_TYPE_MISMATCH","Calibration type is not compatible with the target component.",NULL); return ESP_FAIL;
    }
    const char *op="device"; cJSON *jop=cJSON_GetObjectItem(target,"operator"); if(jop&&cJSON_IsString(jop)&&jop->valuestring[0])op=jop->valuestring;
    const char *cal_id=NULL; cJSON *jcid=cJSON_GetObjectItem(target,"calibrationId"); if(jcid&&cJSON_IsString(jcid)&&jcid->valuestring[0])cal_id=jcid->valuestring;
    if(!cal_id){cJSON_Delete(json);http_send_error(req,422,"CALIBRATION_ID_REQUIRED","calibrationId is required for a persistent calibration record.",NULL);return ESP_FAIL;}
    cJSON *state_item=cJSON_GetObjectItem(target,"state"); calibration_record_state_t state=parse_record_state(state_item&&cJSON_IsString(state_item)?state_item->valuestring:NULL);
    if(state==CAL_RECORD_NOT_CALIBRATED && (!state_item || !cJSON_IsString(state_item))){state=CAL_RECORD_CALIBRATED;}
    if(state==CAL_RECORD_NOT_CALIBRATED){cJSON_Delete(json);http_send_error(req,422,"INVALID_CALIBRATION_STATE","Unsupported calibration lifecycle state.",NULL);return ESP_FAIL;}
    int64_t valid_until=0; cJSON *vu=cJSON_GetObjectItem(target,"validUntilMs"); if(vu&&cJSON_IsNumber(vu)&&vu->valuedouble>0)valid_until=(int64_t)vu->valuedouble;
    esp_err_t err=ESP_ERR_NOT_SUPPORTED; const char *ctype=type->valuestring; uint32_t version=(uint32_t)ver->valuedouble;
    cJSON *rate=cJSON_GetObjectItem(target,"rateMlPerSec"); cJSON *slope=cJSON_GetObjectItem(target,"slope"); cJSON *offset=cJSON_GetObjectItem(target,"offset"); cJSON *ppl=cJSON_GetObjectItem(target,"pulsesPerLiter");
    if(strcasecmp(ctype,"DOSING_RATE")==0){
        if(!rate||!cJSON_IsNumber(rate)||rate->valuedouble<=0){cJSON_Delete(json);http_send_error(req,422,"VALIDATION_FAILED","DOSING_RATE requires positive rateMlPerSec.",NULL);return ESP_FAIL;}
        err=calibration_mgr_set_record_rate_or_linear(comp->valuestring,"DOSING_RATE",(float)rate->valuedouble,0,0,true,version,state,op,valid_until,cal_id);
    }else if(strcasecmp(ctype,"FLOW")==0 && ppl && cJSON_IsNumber(ppl) && ppl->valuedouble > 0){
        bool has_linear = slope && cJSON_IsNumber(slope) && offset && cJSON_IsNumber(offset);
        err=calibration_mgr_set_flow_pulses_calibration(comp->valuestring,(float)ppl->valuedouble,has_linear ? (float)slope->valuedouble : 0.0f,has_linear ? (float)offset->valuedouble : 0.0f,has_linear,version,state,op,valid_until,cal_id);
    }else{
        if(!slope||!cJSON_IsNumber(slope)||!offset||!cJSON_IsNumber(offset)){cJSON_Delete(json);http_send_error(req,422,"VALIDATION_FAILED","Linear calibration requires numeric slope and offset.",NULL);return ESP_FAIL;}
        err=calibration_mgr_set_record_rate_or_linear(comp->valuestring,ctype,0,(float)slope->valuedouble,(float)offset->valuedouble,false,version,state,op,valid_until,cal_id);
    }
    if(err!=ESP_OK){cJSON_Delete(json);http_send_error(req,422,"CALIBRATION_SAVE_FAILED","Unsupported or invalid on-device calibration record.",NULL);return ESP_FAIL;}
    cJSON *record=NULL; calibration_mgr_record_json_exact(comp->valuestring,ctype,cal_id?cal_id:"device-cal",version,&record); if(!record){cJSON_Delete(json);http_send_error(req,500,"CALIBRATION_RECORD_READ_FAILED","Saved record could not be read back.",NULL);return ESP_FAIL;} cJSON_Delete(json); return http_send_enveloped_response(req,200,NULL,record);
}

static esp_err_t api_calibration_get_rate_handler(httpd_req_t *req)
{
    cJSON *resp=cJSON_CreateObject();cJSON_AddNumberToObject(resp,"rateDosingAMlSec",calibration_mgr_get_rate_ml_per_sec(ACTUATOR_DOSING_A));cJSON_AddNumberToObject(resp,"rateDosingBMlSec",calibration_mgr_get_rate_ml_per_sec(ACTUATOR_DOSING_B));return http_send_enveloped_response(req,200,NULL,resp);
}

static esp_err_t api_calibration_record_get_handler(httpd_req_t *req)
{
    char query[384]={0}, component[48]={0}, type[32]={0}, cal_id[48]={0}, version_s[24]={0};
    size_t qlen=httpd_req_get_url_query_len(req);
    if(qlen==0 || qlen>=sizeof(query)) { http_send_error(req,400,"QUERY_REQUIRED","componentId, calibrationType, calibrationId and version are required.",NULL); return ESP_FAIL; }
    if(httpd_req_get_url_query_str(req,query,sizeof(query))!=ESP_OK) return ESP_FAIL;
    if(httpd_query_key_value(query,"componentId",component,sizeof(component))!=ESP_OK ||
       httpd_query_key_value(query,"calibrationType",type,sizeof(type))!=ESP_OK ||
       httpd_query_key_value(query,"calibrationId",cal_id,sizeof(cal_id))!=ESP_OK ||
       httpd_query_key_value(query,"version",version_s,sizeof(version_s))!=ESP_OK) {
        http_send_error(req,400,"QUERY_REQUIRED","componentId, calibrationType, calibrationId and version are required.",NULL); return ESP_FAIL;
    }
    uint32_t version=(uint32_t)strtoul(version_s,NULL,10);
    if (!calibration_component_scoped_to_device(component)) {
        http_send_error(req,409,"COMPONENT_COMPLEX_MISMATCH","Calibration target component belongs to another Complex/device.",NULL); return ESP_FAIL;
    }
    hw_component_info_t component_info;
    if (hardware_registry_find_by_id(component, &component_info) != ESP_OK) {
        http_send_error(req,404,"COMPONENT_NOT_FOUND","Calibration target component is not present in the active registry.",NULL); return ESP_FAIL;
    }
    if (!calibration_component_compatible(&component_info, type)) {
        http_send_error(req,422,"CALIBRATION_COMPONENT_TYPE_MISMATCH","Calibration type is not compatible with the target component.",NULL); return ESP_FAIL;
    }
    cJSON *record=NULL; esp_err_t err=calibration_mgr_record_json_exact(component,type,cal_id,version,&record);
    if(err!=ESP_OK){http_send_error(req,404,"CALIBRATION_NOT_FOUND","Exact calibration record not found.",NULL);return ESP_FAIL;}
    return http_send_enveloped_response(req,200,NULL,record);
}

void register_api_calibration_handlers(httpd_handle_t server)
{
    httpd_uri_t a={.uri="/api/v1/calibration",.method=HTTP_POST,.handler=api_calibration_start_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&a);
    httpd_uri_t st={.uri="/api/v1/calibration/status",.method=HTTP_GET,.handler=api_calibration_status_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&st);
    httpd_uri_t r={.uri="/api/v1/calibration/rate",.method=HTTP_POST,.handler=api_calibration_set_rate_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&r);
    httpd_uri_t gr={.uri="/api/v1/calibration/rate",.method=HTTP_GET,.handler=api_calibration_get_rate_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&gr);
    httpd_uri_t rec={.uri="/api/v1/calibration/record",.method=HTTP_POST,.handler=api_calibration_record_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&rec);
    httpd_uri_t rec_get={.uri="/api/v1/calibration/record",.method=HTTP_GET,.handler=api_calibration_record_get_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&rec_get);
}
