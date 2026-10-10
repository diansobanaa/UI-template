#include "http_server.h"
#include "services/calibration_mgr.h"
#include "services/protocol_mixing.h"
#include "esp_log.h"
#include "cJSON.h"
#include "storage/storage_mgr.h"
#include "hal/hardware_registry.h"
#include <string.h>
#include <strings.h>
#include <stdlib.h>

static const char *TAG __attribute__((unused)) = "API_CALIB";
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
    return strcasecmp(s, "DOSING_RATE") == 0 || strcasecmp(s, "PUMP_RATE") == 0 ||
           strcasecmp(s, "FLOW") == 0 || strcasecmp(s, "LEVEL") == 0 ||
           strcasecmp(s, "PH") == 0 || strcasecmp(s, "EC") == 0;
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
    if (strcasecmp(cal_type, "DOSING_RATE") == 0 || strcasecmp(cal_type, "PUMP_RATE") == 0) {
        return strcasestr(text, "DOSING") != NULL || strcasestr(text, "RAW_SUBMERSIBLE") != NULL || strcasestr(text, "SUBMERSIBLE") != NULL || strcasestr(text, "RAW_WATER") != NULL || strcasestr(text, "PUMP_RAW") != NULL;
    }
    if (strcasecmp(cal_type, "FLOW") == 0) return strcasestr(text, "FLOW") != NULL;
    if (strcasecmp(cal_type, "LEVEL") == 0) {
        // Lower Float Switch is a binary dry-run safety switch, not a continuous calibratable level sensor
        return (strcasestr(text, "LEVEL") || strcasestr(text, "RADAR")) && strcasestr(text, "FLOAT") == NULL;
    }
    if (strcasecmp(cal_type, "PH") == 0) return strcasestr(text, "PH") != NULL;
    if (strcasecmp(cal_type, "EC") == 0) return strcasestr(text, "EC") || strcasestr(text, "CONDUCTIVITY");
    return false;
}

static bool calibration_component_scoped_to_device(const char *component_id)
{
    if (!component_id || !component_id[0]) return false;
    const system_storage_state_t *state = storage_mgr_get_state();
    hw_component_info_t info;
    if (hardware_registry_find_by_id(component_id, &info) != ESP_OK) {
        if (strcasecmp(component_id, "pump_submersible") == 0 ||
            strcasecmp(component_id, "RAW_SUBMERSIBLE") == 0 ||
            strcasecmp(component_id, "pump_raw") == 0 ||
            strcasecmp(component_id, "raw_water_pump") == 0 ||
            strcasecmp(component_id, "pump_dosing_a") == 0 ||
            strcasecmp(component_id, "dosingA") == 0 ||
            strcasecmp(component_id, "pump_dosing_b") == 0 ||
            strcasecmp(component_id, "dosingB") == 0) {
            return true;
        }
        return false;
    }
    if (!state || !state->complex_id[0] || !info.assignment.complex_id[0]) return true;
    return strcmp(info.assignment.complex_id, state->complex_id) == 0;
}

static esp_err_t api_calibration_start_handler(httpd_req_t *req)
{
    cJSON *json=NULL; if(http_parse_json_body(req,&json)!=ESP_OK||!json){http_send_error(req,400,"BAD_REQUEST","Invalid JSON",NULL);return ESP_FAIL;}
    cJSON *payload=cJSON_GetObjectItem(json,"payload"); cJSON *target=payload?payload:json;
    cJSON *comp=cJSON_GetObjectItem(target,"componentId"); cJSON *type=cJSON_GetObjectItem(target,"type"); cJSON *dur=cJSON_GetObjectItem(target,"duration_sec");
    if(!dur) dur=cJSON_GetObjectItem(target,"durationSec");
    if(!comp||!cJSON_IsString(comp)||!type||!cJSON_IsString(type)||!dur||!cJSON_IsNumber(dur)||dur->valueint<=0){cJSON_Delete(json);http_send_error(req,422,"VALIDATION_FAILED","componentId, type and positive duration_sec are required",NULL);return ESP_FAIL;}
    if(strcasecmp(type->valuestring,"VOLUMETRIC")!=0){cJSON_Delete(json);http_send_error(req,422,"CALIBRATION_TYPE_UNSUPPORTED","Only VOLUMETRIC dosing/pump calibration execution is supported on-device.",NULL);return ESP_FAIL;}
    if (!calibration_component_scoped_to_device(comp->valuestring)) { cJSON_Delete(json); http_send_error(req,409,"COMPONENT_COMPLEX_MISMATCH","Calibration target component belongs to another Complex.",NULL); return ESP_FAIL; }
    hw_component_info_t component_info;
    bool comp_ok = (hardware_registry_find_by_id(comp->valuestring, &component_info) == ESP_OK &&
                    (calibration_component_compatible(&component_info, "DOSING_RATE") ||
                     calibration_component_compatible(&component_info, "PUMP_RATE")));
    if (!comp_ok) {
        if (strcasecmp(comp->valuestring, "pump_submersible") == 0 ||
            strcasecmp(comp->valuestring, "RAW_SUBMERSIBLE") == 0 ||
            strcasecmp(comp->valuestring, "pump_raw") == 0 ||
            strcasecmp(comp->valuestring, "raw_water_pump") == 0 ||
            strcasecmp(comp->valuestring, "pump_dosing_a") == 0 ||
            strcasecmp(comp->valuestring, "dosingA") == 0 ||
            strcasecmp(comp->valuestring, "pump_dosing_b") == 0 ||
            strcasecmp(comp->valuestring, "dosingB") == 0) {
            comp_ok = true;
        }
    }
    if (!comp_ok) { cJSON_Delete(json); http_send_error(req,422,"CALIBRATION_COMPONENT_TYPE_MISMATCH","Calibration target is not a pump/dosing-capable component.",NULL); return ESP_FAIL; }
    char comp_id[48] = {0};
    strncpy(comp_id, comp->valuestring, sizeof(comp_id) - 1);
    uint32_t dur_sec = (uint32_t)dur->valueint;
    cJSON_Delete(json);
    esp_err_t err = calibration_mgr_start_volumetric_component(comp_id, dur_sec);
    if(err!=ESP_OK){http_send_error(req,err==ESP_ERR_INVALID_STATE?409:422,"CALIBRATION_START_FAILED","Calibration start rejected by local hardware/safety policy.",NULL);return ESP_FAIL;}
    cJSON *resp=cJSON_CreateObject();cJSON_AddStringToObject(resp,"status","RUNNING");cJSON_AddStringToObject(resp,"componentId",comp_id);cJSON_AddNumberToObject(resp,"durationSec",dur_sec);return http_send_enveloped_response(req,202,NULL,resp);
}

static esp_err_t api_calibration_stop_handler(httpd_req_t *req)
{
    (void)calibration_mgr_stop();
    cJSON *resp = cJSON_CreateObject();
    cJSON_AddStringToObject(resp, "status", "STOPPED");
    return http_send_enveloped_response(req, 200, NULL, resp);
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
    cJSON_AddNumberToObject(resp, "measured_ml", st.measured_ml);
    cJSON_AddNumberToObject(resp, "measured_l", (double)st.measured_ml / 1000.0);
    if (st.error_code[0]) cJSON_AddStringToObject(resp, "errorCode", st.error_code);
    
    return http_send_enveloped_response(req, 200, NULL, resp);
}

static esp_err_t api_calibration_set_rate_handler(httpd_req_t *req)
{
    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) != ESP_OK || !json) {
        http_send_error(req, 400, "BAD_REQUEST", "Invalid JSON", NULL);
        return ESP_FAIL;
    }
    cJSON *payload = cJSON_GetObjectItem(json, "payload");
    cJSON *target = payload ? payload : json;

    // Check for direct flow meter pulse calibration fields
    cJSON *j_flow_raw = cJSON_GetObjectItem(target, "flowRawPulsesPerL");
    if (!j_flow_raw) j_flow_raw = cJSON_GetObjectItem(target, "flowRawPulses");
    cJSON *j_flow_fert = cJSON_GetObjectItem(target, "flowFertPulsesPerL");
    esp_err_t flow_err = ESP_OK;
    if (j_flow_raw && cJSON_IsNumber(j_flow_raw) && j_flow_raw->valuedouble > 0) {
        flow_err = calibration_mgr_set_flow_raw_pulses_per_l((float)j_flow_raw->valuedouble);
    }
    if (flow_err == ESP_OK && j_flow_fert && cJSON_IsNumber(j_flow_fert) && j_flow_fert->valuedouble > 0) {
        flow_err = calibration_mgr_set_flow_fert_pulses_per_l((float)j_flow_fert->valuedouble);
    }
    if (flow_err != ESP_OK) {
        cJSON_Delete(json);
        http_send_error(req, 422, "CALIBRATION_SAVE_FAILED", "Flow calibration was not persisted.", NULL);
        return ESP_FAIL;
    }

    cJSON *comp = cJSON_GetObjectItem(target, "componentId");
    cJSON *rate = cJSON_GetObjectItem(target, "rateMlPerSec");
    if (!rate) rate = cJSON_GetObjectItem(target, "rateValue");
    bool from_flow_rate_min = false;
    if (!rate) {
        cJSON *frm = cJSON_GetObjectItem(target, "flowRateMlMin");
        if (frm && cJSON_IsNumber(frm) && frm->valuedouble > 0) {
            rate = frm;
            from_flow_rate_min = true;
        }
    }
    cJSON *ppl = cJSON_GetObjectItem(target, "pulsesPerLiter");

    // If request was purely to set flow pulses and no componentId specified
    if ((!comp || !cJSON_IsString(comp)) && (j_flow_raw || j_flow_fert)) {
        cJSON_Delete(json);
        cJSON *resp = cJSON_CreateObject();
        cJSON_AddStringToObject(resp, "status", "APPLIED");
        cJSON_AddNumberToObject(resp, "flowRawPulsesPerL", calibration_mgr_get_flow_raw_pulses_per_l());
        cJSON_AddNumberToObject(resp, "flowFertPulsesPerL", calibration_mgr_get_flow_fert_pulses_per_l());
        return http_send_enveloped_response(req, 200, NULL, resp);
    }

    // If target is raw water flow sensor
    if (comp && cJSON_IsString(comp) &&
        (strcasecmp(comp->valuestring, "sensor_flow_raw") == 0 ||
         strcasecmp(comp->valuestring, "flow_raw") == 0 ||
         strcasecmp(comp->valuestring, "flow_raw_zjb1") == 0 ||
         strcasecmp(comp->valuestring, "RAW_FLOW") == 0 ||
         strcasecmp(comp->valuestring, "flow-meter-zjb1") == 0)) {
        double pval = 0;
        if (ppl && cJSON_IsNumber(ppl) && ppl->valuedouble > 0) pval = ppl->valuedouble;
        else if (rate && cJSON_IsNumber(rate) && rate->valuedouble > 0) pval = rate->valuedouble;
        else if (j_flow_raw && cJSON_IsNumber(j_flow_raw) && j_flow_raw->valuedouble > 0) pval = j_flow_raw->valuedouble;
        if (pval > 0) {
            esp_err_t ferr = calibration_mgr_set_flow_raw_pulses_per_l((float)pval);
            cJSON_Delete(json);
            if (ferr != ESP_OK) {
                http_send_error(req, 422, "CALIBRATION_SAVE_FAILED", "Failed to save flow calibration.", NULL);
                return ESP_FAIL;
            }
            cJSON *resp = cJSON_CreateObject();
            cJSON_AddStringToObject(resp, "status", "APPLIED");
            cJSON_AddStringToObject(resp, "componentId", comp->valuestring);
            cJSON_AddNumberToObject(resp, "pulsesPerLiter", pval);
            cJSON_AddNumberToObject(resp, "flowRawPulsesPerL", pval);
            return http_send_enveloped_response(req, 200, NULL, resp);
        }
    }

    // If target is fertigation delivery flow sensor
    if (comp && cJSON_IsString(comp) &&
        (strcasecmp(comp->valuestring, "sensor_flow_fert") == 0 ||
         strcasecmp(comp->valuestring, "flow_fert") == 0 ||
         strcasecmp(comp->valuestring, "flow_fert_fs400a") == 0 ||
         strcasecmp(comp->valuestring, "FERT_FLOW") == 0 ||
         strcasecmp(comp->valuestring, "flow-meter-fs400a") == 0)) {
        double pval = 0;
        if (ppl && cJSON_IsNumber(ppl) && ppl->valuedouble > 0) pval = ppl->valuedouble;
        else if (rate && cJSON_IsNumber(rate) && rate->valuedouble > 0) pval = rate->valuedouble;
        else if (j_flow_fert && cJSON_IsNumber(j_flow_fert) && j_flow_fert->valuedouble > 0) pval = j_flow_fert->valuedouble;
        if (pval > 0) {
            esp_err_t ferr = calibration_mgr_set_flow_fert_pulses_per_l((float)pval);
            cJSON_Delete(json);
            if (ferr != ESP_OK) {
                http_send_error(req, 422, "CALIBRATION_SAVE_FAILED", "Failed to save flow calibration.", NULL);
                return ESP_FAIL;
            }
            cJSON *resp = cJSON_CreateObject();
            cJSON_AddStringToObject(resp, "status", "APPLIED");
            cJSON_AddStringToObject(resp, "componentId", comp->valuestring);
            cJSON_AddNumberToObject(resp, "pulsesPerLiter", pval);
            cJSON_AddNumberToObject(resp, "flowFertPulsesPerL", pval);
            return http_send_enveloped_response(req, 200, NULL, resp);
        }
    }

    cJSON *ver = cJSON_GetObjectItem(target, "version");
    cJSON *op = cJSON_GetObjectItem(target, "operator");
    cJSON *cid = cJSON_GetObjectItem(target, "calibrationId");

    if (!comp || !cJSON_IsString(comp) || !rate || !cJSON_IsNumber(rate) || rate->valuedouble <= 0) {
        cJSON_Delete(json);
        http_send_error(req, 422, "VALIDATION_FAILED", "componentId and positive rateMlPerSec (or rateValue) are required", NULL);
        return ESP_FAIL;
    }
    uint32_t version = (ver && cJSON_IsNumber(ver) && ver->valuedouble > 0) ? (uint32_t)ver->valuedouble : 0;
    const char *operator_id = (op && cJSON_IsString(op) && op->valuestring[0]) ? op->valuestring : "technician";
    const char *cal_id = (cid && cJSON_IsString(cid) && cid->valuestring[0]) ? cid->valuestring : NULL;

    char saved_comp_id[32] = {0};
    strncpy(saved_comp_id, comp->valuestring, sizeof(saved_comp_id) - 1);
    double saved_rate_val = from_flow_rate_min ? (rate->valuedouble / 60.0) : rate->valuedouble;
    hw_component_info_t component_info;
    bool comp_ok = (hardware_registry_find_by_id(saved_comp_id, &component_info) == ESP_OK &&
                    (calibration_component_compatible(&component_info, "DOSING_RATE") ||
                     calibration_component_compatible(&component_info, "PUMP_RATE")));
    if (!comp_ok) {
        if (strcasecmp(saved_comp_id, "pump_submersible") == 0 ||
            strcasecmp(saved_comp_id, "RAW_SUBMERSIBLE") == 0 ||
            strcasecmp(saved_comp_id, "pump_raw") == 0 ||
            strcasecmp(saved_comp_id, "raw_water_pump") == 0 ||
            strcasecmp(saved_comp_id, "pump_dosing_a") == 0 ||
            strcasecmp(saved_comp_id, "dosingA") == 0 ||
            strcasecmp(saved_comp_id, "pump_dosing_b") == 0 ||
            strcasecmp(saved_comp_id, "dosingB") == 0) {
            comp_ok = true;
        }
    }
    if (!comp_ok || !calibration_component_scoped_to_device(saved_comp_id)) {
        cJSON_Delete(json);
        http_send_error(req, 422, "CALIBRATION_COMPONENT_TYPE_MISMATCH",
                        "Calibration rate target is not a supported dosing or raw-water pump.",
                        NULL);
        return ESP_FAIL;
    }

    esp_err_t err = calibration_mgr_set_dosing_rate(saved_comp_id, (float)saved_rate_val, version, CAL_RECORD_CALIBRATED, operator_id, 0, cal_id);
    cJSON_Delete(json);
    if (err != ESP_OK) {
        http_send_error(req, err == ESP_ERR_INVALID_STATE ? 409 : 422, "CALIBRATION_SAVE_FAILED", "Calibration record was not accepted.", NULL);
        return ESP_FAIL;
    }

    calibration_record_t saved_rec;
    uint32_t eff_version = version > 0 ? version : 1;
    const char *eff_cal_id = cal_id ? cal_id : "device-cal";
    if (calibration_mgr_get_record(saved_comp_id, "DOSING_RATE", &saved_rec) == ESP_OK ||
        calibration_mgr_get_record(saved_comp_id, "PUMP_RATE", &saved_rec) == ESP_OK) {
        eff_version = saved_rec.version;
        eff_cal_id = saved_rec.calibration_id;
    }

    cJSON *resp = cJSON_CreateObject();
    cJSON_AddStringToObject(resp, "status", "APPLIED");
    cJSON_AddStringToObject(resp, "componentId", saved_comp_id);
    cJSON_AddNumberToObject(resp, "rateMlPerSec", saved_rate_val);
    cJSON_AddNumberToObject(resp, "flowRateMlMin", saved_rate_val * 60.0);
    cJSON_AddNumberToObject(resp, "version", eff_version);
    cJSON_AddStringToObject(resp, "calibrationId", eff_cal_id);
    return http_send_enveloped_response(req, 200, NULL, resp);
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
    if(strcasecmp(ctype,"DOSING_RATE")==0 || strcasecmp(ctype,"PUMP_RATE")==0){
        if(!rate||!cJSON_IsNumber(rate)||rate->valuedouble<=0){cJSON_Delete(json);http_send_error(req,422,"VALIDATION_FAILED","DOSING_RATE/PUMP_RATE requires positive rateMlPerSec.",NULL);return ESP_FAIL;}
        err=calibration_mgr_set_record_rate_or_linear(comp->valuestring,ctype,(float)rate->valuedouble,0,0,true,version,state,op,valid_until,cal_id);
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
    cJSON *resp = cJSON_CreateObject();
    cJSON *rates_obj = cJSON_AddObjectToObject(resp, "dosingRates");
    (void)calibration_mgr_populate_dosing_rates_json(rates_obj);

    float rate_a = calibration_mgr_get_rate_ml_per_sec(ACTUATOR_DOSING_A);
    float rate_b = calibration_mgr_get_rate_ml_per_sec(ACTUATOR_DOSING_B);

    if (rate_a > 0.0f && !cJSON_GetObjectItem(rates_obj, "pump_dosing_a")) {
        cJSON_AddNumberToObject(rates_obj, "pump_dosing_a", rate_a);
    }
    if (rate_b > 0.0f && !cJSON_GetObjectItem(rates_obj, "pump_dosing_b")) {
        cJSON_AddNumberToObject(rates_obj, "pump_dosing_b", rate_b);
    }
    float rate_raw = 0.0f;
    if (calibration_mgr_get_rate_by_component("pump_submersible", &rate_raw) != ESP_OK &&
        calibration_mgr_get_rate_by_component("pump_raw", &rate_raw) != ESP_OK &&
        calibration_mgr_get_rate_by_component("raw_water_pump", &rate_raw) != ESP_OK) {
        rate_raw = calibration_mgr_get_rate_ml_per_sec(ACTUATOR_RAW_SUBMERSIBLE);
    }
    if (rate_raw > 0.0f) {
        if (!cJSON_GetObjectItem(rates_obj, "pump_submersible")) {
            cJSON_AddNumberToObject(rates_obj, "pump_submersible", rate_raw);
        }
        cJSON_AddNumberToObject(resp, "rateRawWaterPumpMlSec", rate_raw);
        cJSON_AddNumberToObject(resp, "rateWellPumpMlSec", rate_raw);
    }

    cJSON_AddNumberToObject(resp, "rateDosingAMlSec", rate_a);
    cJSON_AddNumberToObject(resp, "rateDosingBMlSec", rate_b);
    cJSON_AddNumberToObject(resp, "flowRawPulsesPerL", calibration_mgr_get_flow_raw_pulses_per_l());
    cJSON_AddNumberToObject(resp, "flowFertPulsesPerL", calibration_mgr_get_flow_fert_pulses_per_l());

    cJSON *records_arr = cJSON_AddArrayToObject(resp, "records");
    (void)calibration_mgr_populate_records_json(records_arr);

    return http_send_enveloped_response(req, 200, NULL, resp);
}

static esp_err_t api_calibration_list_handler(httpd_req_t *req)
{
    cJSON *arr = cJSON_CreateArray();
    (void)calibration_mgr_populate_records_json(arr);
    cJSON *resp = cJSON_CreateObject();
    cJSON_AddItemToObject(resp, "calibrations", arr);
    return http_send_enveloped_response(req, 200, NULL, resp);
}

static esp_err_t api_calibration_record_get_handler(httpd_req_t *req)
{
    size_t qlen=httpd_req_get_url_query_len(req);
    if(qlen==0) {
        cJSON *arr = cJSON_CreateArray();
        (void)calibration_mgr_populate_records_json(arr);
        cJSON *resp = cJSON_CreateObject();
        cJSON_AddItemToObject(resp, "calibrations", arr);
        return http_send_enveloped_response(req, 200, NULL, resp);
    }
    char query[384]={0}, component[48]={0}, type[32]={0}, cal_id[48]={0}, version_s[24]={0};
    if(qlen>=sizeof(query)) { http_send_error(req,400,"QUERY_REQUIRED","componentId, calibrationType, calibrationId and version are required.",NULL); return ESP_FAIL; }
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

static esp_err_t api_calibration_test_mixing_start_handler(httpd_req_t *req)
{
    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) != ESP_OK || !json) {
        http_send_error(req, 400, "BAD_REQUEST", "Invalid JSON body", NULL);
        return ESP_FAIL;
    }
    cJSON *payload = cJSON_GetObjectItem(json, "payload");
    cJSON *target = payload ? payload : json;

    cJSON *raw_target = cJSON_GetObjectItem(target, "rawWaterTargetMl");
    if (!raw_target) raw_target = cJSON_GetObjectItem(target, "raw_water_target_ml");

    cJSON *thresh = cJSON_GetObjectItem(target, "thresholdPercent");
    if (!thresh) thresh = cJSON_GetObjectItem(target, "threshold_percent");

    cJSON *post_mix = cJSON_GetObjectItem(target, "postMixDurationSec");
    if (!post_mix) post_mix = cJSON_GetObjectItem(target, "post_mix_duration_sec");

    if (!raw_target || !cJSON_IsNumber(raw_target) || raw_target->valueint <= 0) {
        cJSON_Delete(json);
        http_send_error(req, 422, "VALIDATION_FAILED", "rawWaterTargetMl must be a positive integer", NULL);
        return ESP_FAIL;
    }

    mixing_protocol_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.raw_water_target_ml = (uint32_t)raw_target->valueint;
    cfg.threshold_percent = (thresh && cJSON_IsNumber(thresh) && thresh->valueint >= 0 && thresh->valueint <= 100) ? (uint8_t)thresh->valueint : 0;
    cfg.post_mix_duration_sec = (post_mix && cJSON_IsNumber(post_mix) && post_mix->valueint >= 0) ? (uint32_t)post_mix->valueint : 0;

    cJSON *rw_comp = cJSON_GetObjectItem(target, "rawWaterComponentId");
    if (!rw_comp) rw_comp = cJSON_GetObjectItem(target, "raw_water_component_id");
    if (rw_comp && cJSON_IsString(rw_comp) && rw_comp->valuestring[0]) {
        strncpy(cfg.raw_water_component_id, rw_comp->valuestring, sizeof(cfg.raw_water_component_id) - 1);
    }

    cJSON *flow_sensor = cJSON_GetObjectItem(target, "rawFlowSensorId");
    if (!flow_sensor) flow_sensor = cJSON_GetObjectItem(target, "raw_flow_sensor_id");
    if (flow_sensor && cJSON_IsString(flow_sensor) && flow_sensor->valuestring[0]) {
        strncpy(cfg.raw_flow_sensor_id, flow_sensor->valuestring, sizeof(cfg.raw_flow_sensor_id) - 1);
    }

    cJSON *mix_pump = cJSON_GetObjectItem(target, "mixingPumpId");
    if (!mix_pump) mix_pump = cJSON_GetObjectItem(target, "mixing_pump_id");
    if (mix_pump && cJSON_IsString(mix_pump) && mix_pump->valuestring[0]) {
        strncpy(cfg.mixing_pump_id, mix_pump->valuestring, sizeof(cfg.mixing_pump_id) - 1);
    }

    cJSON *channels = cJSON_GetObjectItem(target, "channels");
    if (channels && cJSON_IsArray(channels)) {
        int num_ch = cJSON_GetArraySize(channels);
        if (num_ch > MAX_MIXING_DOSING_CHANNELS) {
            cJSON_Delete(json);
            http_send_error(req, 422, "TOO_MANY_CHANNELS", "Exceeded maximum dosing channels (8)", NULL);
            return ESP_FAIL;
        }
        for (int i = 0; i < num_ch; i++) {
            cJSON *ch_item = cJSON_GetArrayItem(channels, i);
            if (!ch_item || !cJSON_IsObject(ch_item)) continue;
            cJSON *cid = cJSON_GetObjectItem(ch_item, "componentId");
            if (!cid) cid = cJSON_GetObjectItem(ch_item, "component_id");
            cJSON *vol = cJSON_GetObjectItem(ch_item, "targetVolumeMl");
            if (!vol) vol = cJSON_GetObjectItem(ch_item, "target_volume_ml");

            if (!cid || !cJSON_IsString(cid) || !cid->valuestring[0] ||
                !vol || !cJSON_IsNumber(vol) || vol->valueint <= 0) {
                cJSON_Delete(json);
                http_send_error(req, 422, "INVALID_CHANNEL_PARAM", "Each channel must have valid componentId and positive targetVolumeMl", NULL);
                return ESP_FAIL;
            }

            strncpy(cfg.channels[cfg.channel_count].component_id, cid->valuestring, sizeof(cfg.channels[cfg.channel_count].component_id) - 1);
            cfg.channels[cfg.channel_count].target_volume_ml = (uint32_t)vol->valueint;
            cfg.channel_count++;
        }
    }

    cJSON_Delete(json);

    esp_err_t err = calibration_mgr_start_mixing_test(&cfg);
    if (err == ESP_ERR_INVALID_STATE) {
        http_send_error(req, 409, "MIXING_BUSY", "Mixing or fertigation system is currently busy or estop active.", NULL);
        return ESP_FAIL;
    }
    if (err != ESP_OK) {
        http_send_error(req, 422, "MIXING_TEST_START_FAILED", "Failed to start mixing & dosing test", NULL);
        return ESP_FAIL;
    }

    cJSON *resp = NULL;
    calibration_mgr_get_mixing_test_status(&resp);
    return http_send_enveloped_response(req, 202, NULL, resp);
}

static esp_err_t api_calibration_test_mixing_get_handler(httpd_req_t *req)
{
    cJSON *resp = NULL;
    esp_err_t err = calibration_mgr_get_mixing_test_status(&resp);
    if (err != ESP_OK || !resp) {
        http_send_error(req, 500, "STATUS_READ_FAILED", "Could not get mixing test status", NULL);
        return ESP_FAIL;
    }
    return http_send_enveloped_response(req, 200, NULL, resp);
}

static esp_err_t api_calibration_test_mixing_stop_handler(httpd_req_t *req)
{
    (void)calibration_mgr_stop_mixing_test();
    cJSON *resp = NULL;
    calibration_mgr_get_mixing_test_status(&resp);
    return http_send_enveloped_response(req, 200, NULL, resp);
}

void register_api_calibration_handlers(httpd_handle_t server)
{
    httpd_uri_t a={.uri="/api/v1/calibration",.method=HTTP_POST,.handler=api_calibration_start_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&a);
    httpd_uri_t get_cal={.uri="/api/v1/calibration",.method=HTTP_GET,.handler=api_calibration_list_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&get_cal);
    httpd_uri_t del={.uri="/api/v1/calibration",.method=HTTP_DELETE,.handler=api_calibration_stop_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&del);
    httpd_uri_t st={.uri="/api/v1/calibration/status",.method=HTTP_GET,.handler=api_calibration_status_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&st);
    httpd_uri_t r={.uri="/api/v1/calibration/rate",.method=HTTP_POST,.handler=api_calibration_set_rate_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&r);
    httpd_uri_t gr={.uri="/api/v1/calibration/rate",.method=HTTP_GET,.handler=api_calibration_get_rate_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&gr);
    httpd_uri_t rec={.uri="/api/v1/calibration/record",.method=HTTP_POST,.handler=api_calibration_record_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&rec);
    httpd_uri_t rec_get={.uri="/api/v1/calibration/record",.method=HTTP_GET,.handler=api_calibration_record_get_handler,.user_ctx=NULL};httpd_register_uri_handler(server,&rec_get);

    httpd_uri_t tmix_start = {.uri = "/api/v1/calibration/test-mixing", .method = HTTP_POST, .handler = api_calibration_test_mixing_start_handler, .user_ctx = NULL};
    httpd_register_uri_handler(server, &tmix_start);

    httpd_uri_t tmix_get = {.uri = "/api/v1/calibration/test-mixing", .method = HTTP_GET, .handler = api_calibration_test_mixing_get_handler, .user_ctx = NULL};
    httpd_register_uri_handler(server, &tmix_get);

    httpd_uri_t tmix_stop = {.uri = "/api/v1/calibration/test-mixing/stop", .method = HTTP_POST, .handler = api_calibration_test_mixing_stop_handler, .user_ctx = NULL};
    httpd_register_uri_handler(server, &tmix_stop);

    httpd_uri_t tmix_del = {.uri = "/api/v1/calibration/test-mixing", .method = HTTP_DELETE, .handler = api_calibration_test_mixing_stop_handler, .user_ctx = NULL};
    httpd_register_uri_handler(server, &tmix_del);
}

