#include "services/fertigation_mgr.h"
#include "services/event_mgr.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "hal/sensor_hal.h"
#include "services/calibration_mgr.h"
#include "services/safety_monitor.h"
#include "storage/storage_mgr.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <math.h>
#include <nvs.h>

static const char *TAG="FERT_MGR";
static fertigation_state_t s_state=FERT_STATE_IDLE;
static fertigation_batch_config_t s_batch;
static SemaphoreHandle_t s_mutex=NULL;
static int64_t s_run_start_ms=0, s_run_end_ms=0;
static int64_t s_phase_ts[10]={0};
static uint32_t s_state_start_ms=0;
static uint32_t s_raw_start_ml=0, s_delivery_start_ml=0;
static uint32_t s_dosing_start_ms[FERT_MAX_DOSING_CHANNELS]={0};
static uint32_t s_dosing_runtime_observed_ms[FERT_MAX_DOSING_CHANNELS]={0};
#define FERT_RECOVERY_NS "agrotech_fert"
#define FERT_RECOVERY_KEY "recovery_run"

static void cp(char *d,size_t n,const char *s){if(!d||!n)return;d[0]=0;if(s){strncpy(d,s,n-1);d[n-1]=0;}}
static const char *state_name(fertigation_state_t s){switch(s){case FERT_STATE_IDLE:return "IDLE";case FERT_STATE_RECOVERY_HOLD:return "RECOVERY_HOLD";case FERT_STATE_PRECHECK:return "PRECHECK";case FERT_STATE_FILLING:return "FILLING";case FERT_STATE_DOSING:return "DOSING";case FERT_STATE_FINAL_MIXING:return "FINAL_MIXING";case FERT_STATE_DELIVERY:return "DELIVERY";case FERT_STATE_COMPLETE:return "COMPLETE";case FERT_STATE_INTERRUPTED:return "INTERRUPTED";case FERT_STATE_FAULTED:return "FAULTED";case FERT_STATE_ABORTED:return "ABORTED";default:return "UNKNOWN";}}
static int phase_index(fertigation_state_t s){switch(s){case FERT_STATE_PRECHECK:return 0;case FERT_STATE_FILLING:return 1;case FERT_STATE_DOSING:return 2;case FERT_STATE_FINAL_MIXING:return 3;case FERT_STATE_DELIVERY:return 4;case FERT_STATE_COMPLETE:return 5;default:return -1;}}
static bool active_run_state(fertigation_state_t s){return s==FERT_STATE_PRECHECK||s==FERT_STATE_FILLING||s==FERT_STATE_DOSING||s==FERT_STATE_FINAL_MIXING||s==FERT_STATE_DELIVERY;}
static bool op_component(const char *id){return id&&id[0]&&hardware_registry_is_operational(id);}
static bool text_has(const char *a,const char *b){return a&&b&&strcasestr(a,b)!=NULL;}
static bool assigned_to(const hw_component_info_t *c,const char *gh){if(!c)return false;return !c->assignment.gh_id[0]||strcasecmp(c->assignment.gh_id,gh)==0;}
static uint32_t now_ms(void){return (uint32_t)(esp_timer_get_time()/1000ULL);}
static int64_t wallclock_ms(void){time_t t=time(NULL);return t>0?(int64_t)t*1000LL:0;}

static esp_err_t stop_component(const char *id){if(!id||!id[0])return ESP_OK;actuator_hal_stop_component(id,ACTUATOR_OWNER_FERTIGATION);return ESP_OK;}
static void stop_all(void){stop_component(s_batch.raw_water_component_id);stop_component(s_batch.mixing_pump_id);for(uint32_t i=0;i<s_batch.channel_count&&i<FERT_MAX_DOSING_CHANNELS;i++)stop_component(s_batch.channels[i].component_id);stop_component(s_batch.delivery_pump_id);}
static void persist_run(const char *final_fault){
    const char *event_code = final_fault ? "FERTIGATION_INTERRUPTED" : "FERTIGATION_COMPLETED";
    event_level_t event_level = final_fault ? LOG_LEVEL_ERROR : LOG_LEVEL_INFO;
    const char *event_message = final_fault ? final_fault : "Fertigation batch completed.";
    (void)event_mgr_log_command(event_level, event_code, event_message, s_batch.run_id, s_batch.complex_id, s_batch.gh_id,
                                s_batch.delivery_pump_id, NULL, s_batch.configuration_version);
    cJSON *r=cJSON_CreateObject();if(!r)return;
    cJSON_AddStringToObject(r,"runId",s_batch.run_id);cJSON_AddStringToObject(r,"complexId",s_batch.complex_id);cJSON_AddStringToObject(r,"ghId",s_batch.gh_id);cJSON_AddStringToObject(r,"triggerType",s_batch.trigger_type);if(s_batch.schedule_id[0])cJSON_AddStringToObject(r,"scheduleId",s_batch.schedule_id);cJSON_AddStringToObject(r,"recipeId",s_batch.recipe_id);cJSON_AddNumberToObject(r,"recipeVersion",s_batch.recipe_version);cJSON_AddNumberToObject(r,"configurationVersion",s_batch.configuration_version);cJSON_AddStringToObject(r,"configurationHash",s_batch.configuration_hash);cJSON_AddNumberToObject(r,"targetWaterMl",s_batch.target_water_ml);cJSON_AddNumberToObject(r,"actualWaterMl",s_batch.target_water_ml > 0 ? (double)(s_raw_start_ml ? 0 : s_batch.target_water_ml) : 0);
    uint32_t actual_raw=0, actual_del=0;
    bool raw_measured = sensor_hal_get_component_accumulated_ml(s_batch.raw_flow_sensor_id,&actual_raw)==ESP_OK;
    bool delivery_measured = strcasecmp(s_batch.delivery_mode,"DURATION")==0 || sensor_hal_get_component_accumulated_ml(s_batch.delivery_flow_sensor_id,&actual_del)==ESP_OK;
    if(actual_raw>=s_raw_start_ml) actual_raw-=s_raw_start_ml; else actual_raw=0;
    if(actual_del>=s_delivery_start_ml) actual_del-=s_delivery_start_ml; else actual_del=0;
    cJSON_ReplaceItemInObject(r,"actualWaterMl",cJSON_CreateNumber((double)actual_raw));
    cJSON_AddStringToObject(r,"actualWaterMeasurementSource",raw_measured?"CONFIGURED_FLOW_SENSOR":"UNAVAILABLE");
    cJSON_AddStringToObject(r,"actualWaterMeasurementQuality",raw_measured?"MEASURED":"UNAVAILABLE");
    cJSON_AddNumberToObject(r,"deliveryTargetMl",s_batch.delivery_target_ml);
    cJSON_AddNumberToObject(r,"actualDeliveredMl",actual_del);
    cJSON *channels=cJSON_AddArrayToObject(r,"dosingChannels");for(uint32_t i=0;i<s_batch.channel_count&&i<FERT_MAX_DOSING_CHANNELS;i++){cJSON *x=cJSON_CreateObject();cJSON_AddStringToObject(x,"componentId",s_batch.channels[i].component_id);cJSON_AddNumberToObject(x,"requestedMl",s_batch.channels[i].requested_ml);cJSON_AddNumberToObject(x,"actualRuntimeMs",s_dosing_runtime_observed_ms[i]);cJSON_AddNumberToObject(x,"actualRuntimeSec",s_dosing_runtime_observed_ms[i]/1000.0);cJSON_AddNumberToObject(x,"actualDosedMl",(s_dosing_runtime_observed_ms[i]/1000.0)*s_batch.channels[i].rate_ml_sec);cJSON_AddStringToObject(x,"actualDosedMeasurementSource","CALIBRATION_RATE_X_OBSERVED_RUNTIME");cJSON_AddStringToObject(x,"actualDosedMeasurementQuality","CALCULATED");cJSON_AddNumberToObject(x,"rateMlPerSec",s_batch.channels[i].rate_ml_sec);cJSON_AddNumberToObject(x,"calibrationVersion",s_batch.channels[i].calibration_version);cJSON_AddStringToObject(x,"calibrationId",s_batch.channels[i].calibration_id);cJSON_AddItemToArray(channels,x);}
    double mixed_volume = (double)actual_raw;
    for(uint32_t i=0;i<s_batch.channel_count&&i<FERT_MAX_DOSING_CHANNELS;i++) mixed_volume += ((double)s_dosing_runtime_observed_ms[i] / 1000.0) * (double)s_batch.channels[i].rate_ml_sec;
    cJSON_AddNumberToObject(r,"actualMixedVolumeMl",mixed_volume);
    cJSON_AddStringToObject(r,"mixedVolumeMeasurementSource","CALCULATED_FROM_MEASURED_WATER_AND_CALIBRATED_DOSING");
    cJSON_AddStringToObject(r,"mixedVolumeMeasurementQuality","CALCULATED");
    cJSON *sensor_cals = cJSON_AddObjectToObject(r,"sensorCalibrationReferences");
    cJSON *raw_cal = cJSON_CreateObject(); cJSON_AddStringToObject(raw_cal,"sensorId",s_batch.raw_flow_sensor_id); cJSON_AddStringToObject(raw_cal,"calibrationId",s_batch.raw_flow_calibration_id); cJSON_AddNumberToObject(raw_cal,"version",s_batch.raw_flow_calibration_version); cJSON_AddItemToObject(sensor_cals,"rawFlow",raw_cal);
    if (s_batch.delivery_flow_sensor_id[0]) { cJSON *del_cal = cJSON_CreateObject(); cJSON_AddStringToObject(del_cal,"sensorId",s_batch.delivery_flow_sensor_id); cJSON_AddStringToObject(del_cal,"calibrationId",s_batch.delivery_flow_calibration_id); cJSON_AddNumberToObject(del_cal,"version",s_batch.delivery_flow_calibration_version); cJSON_AddItemToObject(sensor_cals,"deliveryFlow",del_cal); }
    cJSON_AddBoolToObject(r,"deliveredVolumeVerified",strcasecmp(s_batch.delivery_mode,"DURATION")!=0 && delivery_measured && actual_del >= (uint32_t)s_batch.delivery_target_ml);
    cJSON_AddStringToObject(r,"deliveredVolumeMeasurementSource",strcasecmp(s_batch.delivery_mode,"DURATION")==0?"DURATION_TIMER":(delivery_measured?"CONFIGURED_FLOW_SENSOR":"UNAVAILABLE"));
    cJSON_AddStringToObject(r,"deliveredVolumeMeasurementQuality",strcasecmp(s_batch.delivery_mode,"DURATION")==0?"DERIVED":(delivery_measured?"MEASURED":"UNAVAILABLE"));
    sensor_component_sample_t delivery_flow_sample={0};
    if (s_batch.delivery_flow_sensor_id[0] && sensor_hal_get_component_sample(s_batch.delivery_flow_sensor_id,&delivery_flow_sample)==ESP_OK && delivery_flow_sample.has_value && delivery_flow_sample.state==SENSOR_STATE_VALID) {
        cJSON_AddNumberToObject(r,"actualFlowLpm",delivery_flow_sample.value);
        cJSON_AddStringToObject(r,"actualFlowMeasurementQuality","MEASURED");
    } else {
        cJSON_AddNullToObject(r,"actualFlowLpm");
        cJSON_AddStringToObject(r,"actualFlowMeasurementQuality","UNAVAILABLE");
    }
    sensor_component_sample_t pressure_sample={0};
    if (s_batch.pressure_sensor_id[0] && sensor_hal_get_component_sample(s_batch.pressure_sensor_id,&pressure_sample)==ESP_OK && pressure_sample.has_value && pressure_sample.state==SENSOR_STATE_VALID) {
        cJSON_AddNumberToObject(r,"actualPressureKpa",pressure_sample.value);
        cJSON_AddStringToObject(r,"actualPressureMeasurementQuality","MEASURED");
    } else {
        cJSON_AddNullToObject(r,"actualPressureKpa");
        cJSON_AddStringToObject(r,"actualPressureMeasurementQuality","UNAVAILABLE");
    }
    cJSON_AddNumberToObject(r,"mixingDurationSec",s_batch.mixing_duration_sec);cJSON_AddStringToObject(r,"deliveryMode",s_batch.delivery_mode);cJSON_AddNumberToObject(r,"targetFlowLpm",s_batch.target_flow_lpm);cJSON_AddNumberToObject(r,"targetPressureKpa",s_batch.target_pressure_kpa);
    if(s_batch.execution_plan_json[0]){cJSON *ep=cJSON_Parse(s_batch.execution_plan_json);if(ep)cJSON_AddItemToObject(r,"executionPlan",ep);}
    cJSON_AddNumberToObject(r,"startTimestampMs",(double)s_run_start_ms);cJSON_AddNumberToObject(r,"endTimestampMs",(double)s_run_end_ms);cJSON_AddNumberToObject(r,"monotonicStartMs",(double)s_run_start_ms);cJSON_AddNumberToObject(r,"monotonicEndMs",(double)s_run_end_ms);cJSON_AddStringToObject(r,"finalStatus",state_name(s_state));cJSON_AddStringToObject(r,"operator",s_batch.operator_id);cJSON_AddStringToObject(r,"source",s_batch.source);if(final_fault)cJSON_AddStringToObject(r,"fault",final_fault);else cJSON_AddNullToObject(r,"fault");
    cJSON *ph=cJSON_AddObjectToObject(r,"phaseTimestamps");const char *names[]={"PRECHECK","FILLING","DOSING","FINAL_MIXING","DELIVERY","COMPLETE"};for(int i=0;i<6;i++)if(s_phase_ts[i]>0)cJSON_AddNumberToObject(ph,names[i],(double)s_phase_ts[i]);if(s_batch.recipe_snapshot_json[0]){cJSON *snap=cJSON_Parse(s_batch.recipe_snapshot_json);if(snap)cJSON_AddItemToObject(r,"recipeSnapshot",snap);}
    char *str=cJSON_PrintUnformatted(r);if(str){storage_mgr_append_fertigation_run(str);free(str);}cJSON_Delete(r);
}
static void clear_recovery(void){nvs_handle_t h;if(nvs_open(FERT_RECOVERY_NS,NVS_READWRITE,&h)==ESP_OK){nvs_erase_key(h,FERT_RECOVERY_KEY);nvs_commit(h);nvs_close(h);}}
static void persist_recovery(void){cJSON*r=cJSON_CreateObject();if(!r)return;cJSON_AddStringToObject(r,"runId",s_batch.run_id);cJSON_AddStringToObject(r,"complexId",s_batch.complex_id);cJSON_AddStringToObject(r,"ghId",s_batch.gh_id);cJSON_AddStringToObject(r,"state",state_name(s_state));cJSON_AddNumberToObject(r,"startTimestampMs",(double)s_run_start_ms);cJSON_AddNumberToObject(r,"configurationVersion",s_batch.configuration_version);if(s_batch.recipe_id[0])cJSON_AddStringToObject(r,"recipeId",s_batch.recipe_id);if(s_batch.execution_plan_json[0]){cJSON*ep=cJSON_Parse(s_batch.execution_plan_json);if(ep)cJSON_AddItemToObject(r,"executionPlan",ep);}char*str=cJSON_PrintUnformatted(r);cJSON_Delete(r);if(!str)return;nvs_handle_t h;if(nvs_open(FERT_RECOVERY_NS,NVS_READWRITE,&h)==ESP_OK){nvs_set_str(h,FERT_RECOVERY_KEY,str);nvs_commit(h);nvs_close(h);}free(str);}
static bool restore_recovery(void){nvs_handle_t h;if(nvs_open(FERT_RECOVERY_NS,NVS_READONLY,&h)!=ESP_OK)return false;size_t len=0;if(nvs_get_str(h,FERT_RECOVERY_KEY,NULL,&len)!=ESP_OK||len<2||len>8192){nvs_close(h);return false;}char*str=calloc(1,len);if(!str){nvs_close(h);return false;}bool ok=nvs_get_str(h,FERT_RECOVERY_KEY,str,&len)==ESP_OK;nvs_close(h);if(!ok){free(str);return false;}cJSON*r=cJSON_Parse(str);free(str);if(!r)return false;snprintf(s_batch.run_id,sizeof(s_batch.run_id),"%s",cJSON_GetStringValue(cJSON_GetObjectItem(r,"runId"))?:"");snprintf(s_batch.complex_id,sizeof(s_batch.complex_id),"%s",cJSON_GetStringValue(cJSON_GetObjectItem(r,"complexId"))?:"");snprintf(s_batch.gh_id,sizeof(s_batch.gh_id),"%s",cJSON_GetStringValue(cJSON_GetObjectItem(r,"ghId"))?:"");snprintf(s_batch.recipe_id,sizeof(s_batch.recipe_id),"%s",cJSON_GetStringValue(cJSON_GetObjectItem(r,"recipeId"))?:"");s_run_start_ms=(int64_t)cJSON_GetNumberValue(cJSON_GetObjectItem(r,"startTimestampMs"));s_batch.configuration_version=(uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(r,"configurationVersion"));cJSON*ep=cJSON_GetObjectItem(r,"executionPlan");if(ep){char*js=cJSON_PrintUnformatted(ep);if(js){cp(s_batch.execution_plan_json,sizeof(s_batch.execution_plan_json),js);free(js);}}cJSON_Delete(r);s_state=FERT_STATE_RECOVERY_HOLD;return true;}
static void transition(fertigation_state_t next){if(s_state==next)return;s_state=next;s_state_start_ms=now_ms();int idx=phase_index(next);if(idx>=0)s_phase_ts[idx]=(int64_t)s_state_start_ms;if(active_run_state(next))persist_recovery();else if(next==FERT_STATE_COMPLETE||next==FERT_STATE_INTERRUPTED||next==FERT_STATE_FAULTED||next==FERT_STATE_ABORTED||next==FERT_STATE_IDLE)clear_recovery();ESP_LOGI(TAG,"State -> %s",state_name(next));}

static bool plan_sensor_calibration_match(cJSON *sensor_cals, const char *key, const char *expected_component, char *out_id, size_t out_id_len, uint32_t *out_version)
{
    if (!sensor_cals || !expected_component || !out_id || !out_version) return false;
    cJSON *entry=cJSON_GetObjectItem(sensor_cals,key);
    if(!entry||!cJSON_IsObject(entry))return false;
    cJSON *sid=cJSON_GetObjectItem(entry,"sensorId"); cJSON *cid=cJSON_GetObjectItem(entry,"componentId");
    cJSON *calid=cJSON_GetObjectItem(entry,"calibrationId"); cJSON *ver=cJSON_GetObjectItem(entry,"version");
    if((sid&&!cJSON_IsString(sid))||(cid&&!cJSON_IsString(cid))||!calid||!cJSON_IsString(calid)||!calid->valuestring[0]||!ver||!cJSON_IsNumber(ver)||ver->valuedouble<1)return false;
    const char *resolved=(sid&&cJSON_IsString(sid)&&sid->valuestring[0])?sid->valuestring:(cid&&cJSON_IsString(cid)?cid->valuestring:"");
    if(strcmp(resolved,expected_component)!=0)return false;
    cp(out_id,out_id_len,calid->valuestring); *out_version=(uint32_t)ver->valuedouble; return true;
}

static bool precheck(void){
    const system_storage_state_t *ss=storage_mgr_get_state();if(!ss||!ss->config_version)return false;if(s_batch.configuration_version&&ss->config_version!=s_batch.configuration_version)return false;
    if(!op_component(s_batch.mixing_tank_id)||!op_component(s_batch.raw_water_component_id)||!op_component(s_batch.raw_flow_sensor_id)||!op_component(s_batch.level_sensor_id)||!op_component(s_batch.delivery_pump_id))return false;
    if(s_batch.mixing_duration_sec>0 && !op_component(s_batch.mixing_pump_id))return false;
    if(strcasecmp(s_batch.delivery_mode,"DURATION")!=0 && !op_component(s_batch.delivery_flow_sensor_id))return false;
    if(strcasecmp(s_batch.delivery_mode,"PRESSURE_FLOW")==0 && (!op_component(s_batch.pressure_sensor_id) || s_batch.target_pressure_kpa<=0.0f))return false;
    if(strcasecmp(s_batch.delivery_mode,"FLOW")==0 && s_batch.target_flow_lpm<=0.0f)return false;
    if(strcasecmp(s_batch.delivery_mode,"DURATION")==0 && (!s_batch.allow_duration_fallback || s_batch.delivery_duration_sec==0))return false;
    if(!safety_monitor_allows_commands()||actuator_hal_is_emergency_stopped())return false;
    if(s_batch.raw_flow_calibration_id[0]==0 || s_batch.raw_flow_calibration_version==0)return false;
    calibration_record_t raw_flow_cal; if(calibration_mgr_get_record_exact(s_batch.raw_flow_sensor_id,"FLOW",s_batch.raw_flow_calibration_id,s_batch.raw_flow_calibration_version,&raw_flow_cal)!=ESP_OK||calibration_mgr_is_usable(&raw_flow_cal)!=ESP_OK||!raw_flow_cal.has_pulses_per_liter)return false;
    if(strcasecmp(s_batch.delivery_mode,"DURATION")!=0){ if(s_batch.delivery_flow_calibration_id[0]==0 || s_batch.delivery_flow_calibration_version==0)return false; calibration_record_t delivery_flow_cal; if(calibration_mgr_get_record_exact(s_batch.delivery_flow_sensor_id,"FLOW",s_batch.delivery_flow_calibration_id,s_batch.delivery_flow_calibration_version,&delivery_flow_cal)!=ESP_OK||calibration_mgr_is_usable(&delivery_flow_cal)!=ESP_OK||!delivery_flow_cal.has_pulses_per_liter)return false; }
    if(s_batch.max_runtime_sec==0)return false;
    if(s_batch.channel_count==0 || s_batch.channel_count>FERT_MAX_DOSING_CHANNELS)return false;
    for(uint32_t i=0;i<s_batch.channel_count;i++){if(!op_component(s_batch.channels[i].component_id)||s_batch.channels[i].requested_ml<=0||s_batch.channels[i].rate_ml_sec<=0)return false;if(s_batch.channels[i].runtime_ms==0||s_batch.channels[i].runtime_ms>s_batch.max_runtime_sec*1000U)return false;}
    sensor_component_sample_t level={0};if(sensor_hal_get_component_sample(s_batch.level_sensor_id,&level)!=ESP_OK||level.state!=SENSOR_STATE_VALID||level.has_value==false||level.value<1.0f)return false;
    return true;
}

static const char *json_string_or_null(cJSON *object, const char *key)
{
    cJSON *v = cJSON_GetObjectItem(object, key);
    return (v && cJSON_IsString(v) && v->valuestring[0]) ? v->valuestring : NULL;
}

static bool parse_u32(cJSON *object, const char *key, uint32_t *out, bool required)
{
    cJSON *v = cJSON_GetObjectItem(object, key);
    if(!v){ return !required; }
    if(!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > 4294967295.0) return false;
    *out=(uint32_t)v->valuedouble;
    return true;
}

static bool plan_component_copy(cJSON *components, const char *key, char *out, size_t out_len, bool required)
{
    cJSON *v=cJSON_GetObjectItem(components,key);
    if(!v || !cJSON_IsString(v) || !v->valuestring[0]) return !required;
    cp(out,out_len,v->valuestring);
    return true;
}

static bool validate_component_for_gh(const char *component_id, const char *gh_id, bool sensor_or_any)
{
    if(!component_id || !component_id[0]) return false;
    hw_component_info_t info;
    if(hardware_registry_find_by_id(component_id,&info)!=ESP_OK) return false;
    if(!hardware_registry_is_operational(component_id)) return false;
    if(info.assignment.gh_id[0] && gh_id && strcasecmp(info.assignment.gh_id,gh_id)!=0) return false;
    if(!sensor_or_any && info.resource_id[0]==0 && info.wiring.gpio<0) return false;
    return true;
}

static bool validate_plan_resources(cJSON *plan, const char *gh_id, cJSON *components)
{
    if (!plan || !components || !cJSON_IsObject(components)) return false;
    cJSON *resources = cJSON_GetObjectItem(plan, "resources");
    if (!resources || !cJSON_IsArray(resources) || cJSON_GetArraySize(resources) <= 0) return false;

    cJSON *item = NULL;
    cJSON_ArrayForEach(item, resources) {
        if (!cJSON_IsObject(item)) return false;
        cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
        cJSON *cid = cJSON_GetObjectItem(item, "componentId");
        if (!rid || !cJSON_IsString(rid) || !rid->valuestring[0] ||
            !cid || !cJSON_IsString(cid) || !cid->valuestring[0]) return false;
        hw_component_info_t info;
        if (hardware_registry_find_by_id(cid->valuestring, &info) != ESP_OK ||
            !hardware_registry_is_operational(cid->valuestring) ||
            !info.resource_id[0] || strcmp(info.resource_id, rid->valuestring) != 0 ||
            (info.assignment.gh_id[0] && gh_id && strcasecmp(info.assignment.gh_id, gh_id) != 0)) {
            return false;
        }
    }

    /* Every selected component must be represented by the exact same resource identity. */
    cJSON *entry = NULL;
    cJSON_ArrayForEach(entry, components) {
        if (!cJSON_IsString(entry) || !entry->valuestring[0]) continue;
        hw_component_info_t info;
        if (hardware_registry_find_by_id(entry->valuestring, &info) != ESP_OK || !info.resource_id[0]) return false;
        bool found = false;
        cJSON_ArrayForEach(item, resources) {
            cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
            cJSON *cid = cJSON_GetObjectItem(item, "componentId");
            if (rid && cid && cJSON_IsString(rid) && cJSON_IsString(cid) &&
                strcmp(cid->valuestring, info.component_id) == 0 && strcmp(rid->valuestring, info.resource_id) == 0) {
                found = true; break;
            }
        }
        if (!found) return false;
    }

    cJSON *routing_valves = cJSON_GetObjectItem(plan, "routingValves");
    if (routing_valves && cJSON_IsArray(routing_valves)) {
        cJSON_ArrayForEach(entry, routing_valves) {
            if (!cJSON_IsString(entry) || !entry->valuestring[0]) return false;
            bool found = false;
            cJSON_ArrayForEach(item, resources) {
                cJSON *rid = cJSON_GetObjectItem(item, "resourceId");
                if (rid && cJSON_IsString(rid) && strcmp(rid->valuestring, entry->valuestring) == 0) { found = true; break; }
            }
            if (!found) return false;
        }
    }
    return true;
}

static esp_err_t parse_payload(const char *payload_json){
    if(!payload_json)return ESP_ERR_INVALID_ARG;
    cJSON *root=cJSON_Parse(payload_json); if(!root)return ESP_ERR_INVALID_ARG;
    memset(&s_batch,0,sizeof(s_batch));
    cJSON *p=cJSON_GetObjectItem(root,"parameters"); if(!p||!cJSON_IsObject(p))p=root;
    cJSON *plan=cJSON_GetObjectItem(root,"executionPlan"); if(!plan||!cJSON_IsObject(plan)) plan=cJSON_GetObjectItem(p,"executionPlan");
    if(!plan||!cJSON_IsObject(plan)){ cJSON_Delete(root); return ESP_ERR_INVALID_STATE; }

#define STRF(k,dst) do{cJSON *vv=cJSON_GetObjectItem(root,k);if(!vv)vv=cJSON_GetObjectItem(p,k);if(vv&&cJSON_IsString(vv))cp(dst,sizeof(dst),vv->valuestring);}while(0)
    STRF("runId",s_batch.run_id); STRF("complexId",s_batch.complex_id); STRF("ghId",s_batch.gh_id); if(!s_batch.gh_id[0])STRF("targetGhId",s_batch.gh_id); STRF("triggerType",s_batch.trigger_type); STRF("scheduleId",s_batch.schedule_id); STRF("recipeId",s_batch.recipe_id); STRF("operator",s_batch.operator_id); STRF("source",s_batch.source);
    cJSON *v=cJSON_GetObjectItem(plan,"configurationVersion"); if(v&&cJSON_IsNumber(v))s_batch.configuration_version=(uint32_t)v->valuedouble;
    v=cJSON_GetObjectItem(plan,"configurationHash"); if(v&&cJSON_IsString(v))cp(s_batch.configuration_hash,sizeof(s_batch.configuration_hash),v->valuestring);
    if(!s_batch.complex_id[0]){const system_storage_state_t *ss=storage_mgr_get_state();if(ss)cp(s_batch.complex_id,sizeof(s_batch.complex_id),ss->complex_id);}
    const system_storage_state_t *ss=storage_mgr_get_state();
    if(!ss||!ss->complex_id[0]||strcmp(s_batch.complex_id,ss->complex_id)!=0){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(!s_batch.configuration_version || ss->config_version!=s_batch.configuration_version){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(!ss->config_hash[0] || !s_batch.configuration_hash[0] || strcmp(s_batch.configuration_hash,ss->config_hash)!=0){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}

    cJSON *delivery_plan=cJSON_GetObjectItem(plan,"delivery"); if(!delivery_plan||!cJSON_IsObject(delivery_plan)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    cJSON *timeouts=cJSON_GetObjectItem(plan,"timeouts"); if(!timeouts||!cJSON_IsObject(timeouts)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    cJSON *safety=cJSON_GetObjectItem(plan,"safety"); if(!safety||!cJSON_IsObject(safety)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    v=cJSON_GetObjectItem(plan,"targetWaterMl");if(!v||!cJSON_IsNumber(v)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} s_batch.target_water_ml=(int32_t)v->valuedouble;
    if(!parse_u32(delivery_plan,"toleranceMl",(uint32_t*)&s_batch.tolerance_ml,true)){cJSON_Delete(root);return ESP_ERR_INVALID_ARG;}
    v=cJSON_GetObjectItem(plan,"mixingDurationSec"); if(!v||!cJSON_IsNumber(v)||v->valuedouble<0){cJSON_Delete(root);return ESP_ERR_INVALID_ARG;} s_batch.mixing_duration_sec=(uint32_t)v->valuedouble;
    if(!parse_u32(delivery_plan,"durationSec",&s_batch.delivery_duration_sec,false)){cJSON_Delete(root);return ESP_ERR_INVALID_ARG;}
    v=cJSON_GetObjectItem(delivery_plan,"targetFlowLpm");if(v&&cJSON_IsNumber(v))s_batch.target_flow_lpm=(float)v->valuedouble;
    v=cJSON_GetObjectItem(delivery_plan,"targetPressureKpa");if(v&&cJSON_IsNumber(v))s_batch.target_pressure_kpa=(float)v->valuedouble;
    v=cJSON_GetObjectItem(delivery_plan,"allowDurationFallback");s_batch.allow_duration_fallback=v&&cJSON_IsTrue(v);
    v=cJSON_GetObjectItem(timeouts,"maxRuntimeSec");if(!v||!cJSON_IsNumber(v)) {cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} s_batch.max_runtime_sec=(uint32_t)v->valuedouble;
    v=cJSON_GetObjectItem(timeouts,"minDosingRuntimeSec");if(!v||!cJSON_IsNumber(v)) {cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} s_batch.min_dosing_runtime_sec=(uint32_t)v->valuedouble;
    v=cJSON_GetObjectItem(timeouts,"maxDosingRuntimeSec");if(!v||!cJSON_IsNumber(v)) {cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} s_batch.max_dosing_runtime_sec=(uint32_t)v->valuedouble;
    v=cJSON_GetObjectItem(timeouts,"fillTimeoutSec");if(!v||!cJSON_IsNumber(v)) {cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} s_batch.fill_timeout_sec=(uint32_t)v->valuedouble;
    v=cJSON_GetObjectItem(timeouts,"deliveryTimeoutSec");if(!v||!cJSON_IsNumber(v)) {cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} s_batch.delivery_timeout_sec=(uint32_t)v->valuedouble;
    if(s_batch.min_dosing_runtime_sec > s_batch.max_dosing_runtime_sec || s_batch.max_dosing_runtime_sec == 0){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(!s_batch.max_runtime_sec||!s_batch.fill_timeout_sec||!s_batch.delivery_timeout_sec){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    v=cJSON_GetObjectItem(safety,"safetyAcknowledged"); if(!v||!cJSON_IsTrue(v)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(s_batch.target_water_ml<=0||!s_batch.gh_id[0]){cJSON_Delete(root);return ESP_ERR_INVALID_ARG;}
    v=cJSON_GetObjectItem(delivery_plan,"mode"); if(!v||!cJSON_IsString(v)||!v->valuestring[0]){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} cp(s_batch.delivery_mode,sizeof(s_batch.delivery_mode),v->valuestring);
    v=cJSON_GetObjectItem(delivery_plan,"targetDeliveredMl"); if(!v||!cJSON_IsNumber(v)||v->valuedouble<=0){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} s_batch.delivery_target_ml=(int32_t)v->valuedouble;
    if(!s_batch.trigger_type[0])cp(s_batch.trigger_type,sizeof(s_batch.trigger_type),"MANUAL");
    if(!s_batch.source[0])cp(s_batch.source,sizeof(s_batch.source),"UI");

    cJSON *components=cJSON_GetObjectItem(plan,"components"); if(!components||!cJSON_IsObject(components)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(!validate_plan_resources(plan, s_batch.gh_id, components)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(!plan_component_copy(components,"mixingTank",s_batch.mixing_tank_id,sizeof(s_batch.mixing_tank_id),true) ||
       !plan_component_copy(components,"rawWater",s_batch.raw_water_component_id,sizeof(s_batch.raw_water_component_id),true) ||
       !plan_component_copy(components,"rawFlow",s_batch.raw_flow_sensor_id,sizeof(s_batch.raw_flow_sensor_id),true) ||
       !plan_component_copy(components,"level",s_batch.level_sensor_id,sizeof(s_batch.level_sensor_id),true) ||
       !plan_component_copy(components,"deliveryPump",s_batch.delivery_pump_id,sizeof(s_batch.delivery_pump_id),true)) {cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(strcasecmp(s_batch.delivery_mode,"DURATION")!=0 && !plan_component_copy(components,"deliveryFlow",s_batch.delivery_flow_sensor_id,sizeof(s_batch.delivery_flow_sensor_id),true)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(strcasecmp(s_batch.delivery_mode,"PRESSURE_FLOW")==0 && !plan_component_copy(components,"pressure",s_batch.pressure_sensor_id,sizeof(s_batch.pressure_sensor_id),true)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(s_batch.mixing_duration_sec>0 && !plan_component_copy(components,"mixingPump",s_batch.mixing_pump_id,sizeof(s_batch.mixing_pump_id),true)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}

    const char *required_ids[]={s_batch.mixing_tank_id,s_batch.raw_water_component_id,s_batch.raw_flow_sensor_id,s_batch.level_sensor_id,s_batch.delivery_pump_id};
    for(size_t i=0;i<sizeof(required_ids)/sizeof(required_ids[0]);i++)if(!validate_component_for_gh(required_ids[i],s_batch.gh_id,true)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(s_batch.mixing_duration_sec>0&&!validate_component_for_gh(s_batch.mixing_pump_id,s_batch.gh_id,false)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(strcasecmp(s_batch.delivery_mode,"DURATION")!=0&&!validate_component_for_gh(s_batch.delivery_flow_sensor_id,s_batch.gh_id,true)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(strcasecmp(s_batch.delivery_mode,"PRESSURE_FLOW")==0&&!validate_component_for_gh(s_batch.pressure_sensor_id,s_batch.gh_id,true)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}

    cJSON *sensor_cals=cJSON_GetObjectItem(plan,"sensorCalibrations");
    if(!plan_sensor_calibration_match(sensor_cals,"rawFlow",s_batch.raw_flow_sensor_id,s_batch.raw_flow_calibration_id,sizeof(s_batch.raw_flow_calibration_id),&s_batch.raw_flow_calibration_version)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    { sensor_descriptor_t d={0}; if(sensor_hal_get_descriptor(s_batch.raw_flow_sensor_id,&d)!=ESP_OK || strcasecmp(d.calibration_type,"FLOW")!=0 || strcmp(d.calibration_reference,s_batch.raw_flow_calibration_id)!=0 || d.calibration_version!=s_batch.raw_flow_calibration_version){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;} }
    if(strcasecmp(s_batch.delivery_mode,"DURATION")!=0){
        if(!plan_sensor_calibration_match(sensor_cals,"deliveryFlow",s_batch.delivery_flow_sensor_id,s_batch.delivery_flow_calibration_id,sizeof(s_batch.delivery_flow_calibration_id),&s_batch.delivery_flow_calibration_version)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
        sensor_descriptor_t d={0}; if(sensor_hal_get_descriptor(s_batch.delivery_flow_sensor_id,&d)!=ESP_OK || strcasecmp(d.calibration_type,"FLOW")!=0 || strcmp(d.calibration_reference,s_batch.delivery_flow_calibration_id)!=0 || d.calibration_version!=s_batch.delivery_flow_calibration_version){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    }

    cJSON *channels=cJSON_GetObjectItem(plan,"dosingChannels");
    if(!channels||!cJSON_IsArray(channels)) {cJSON_Delete(root);return ESP_ERR_INVALID_ARG;}
    s_batch.channel_count=(uint32_t)cJSON_GetArraySize(channels); if(s_batch.channel_count==0||s_batch.channel_count>FERT_MAX_DOSING_CHANNELS){cJSON_Delete(root);return ESP_ERR_INVALID_SIZE;}
    for(uint32_t i=0;i<s_batch.channel_count;i++){
        cJSON *x=cJSON_GetArrayItem(channels,(int)i); if(!x||!cJSON_IsObject(x)){cJSON_Delete(root);return ESP_ERR_INVALID_ARG;}
        cJSON *cid=cJSON_GetObjectItem(x,"componentId"); cJSON *q=cJSON_GetObjectItem(x,"requestedMl"); cJSON *ratev=cJSON_GetObjectItem(x,"rateMlPerSec"); cJSON *calid=cJSON_GetObjectItem(x,"calibrationId"); cJSON *calver=cJSON_GetObjectItem(x,"calibrationVersion");
        if(!cid||!cJSON_IsString(cid)||!cid->valuestring[0]||!q||!cJSON_IsNumber(q)||q->valuedouble<=0||!ratev||!cJSON_IsNumber(ratev)||ratev->valuedouble<=0||!calid||!cJSON_IsString(calid)||!calid->valuestring[0]||!calver||!cJSON_IsNumber(calver)||calver->valuedouble<1){cJSON_Delete(root);return ESP_ERR_INVALID_ARG;}
        for(uint32_t j=0;j<i;j++)if(strcmp(s_batch.channels[j].component_id,cid->valuestring)==0){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
        if(!validate_component_for_gh(cid->valuestring,s_batch.gh_id,false)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
        calibration_record_t rec; if(calibration_mgr_get_record_exact(cid->valuestring,"DOSING_RATE",calid->valuestring,(uint32_t)calver->valuedouble,&rec)!=ESP_OK||calibration_mgr_is_usable(&rec)!=ESP_OK){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
        float rate=(float)ratev->valuedouble; if(fabsf(rate-rec.rate_ml_sec)>0.0001f){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
        cp(s_batch.channels[i].component_id,sizeof(s_batch.channels[i].component_id),cid->valuestring);s_batch.channels[i].requested_ml=(int32_t)q->valuedouble;s_batch.channels[i].rate_ml_sec=rec.rate_ml_sec;s_batch.channels[i].calibration_version=rec.version;cp(s_batch.channels[i].calibration_id,sizeof(s_batch.channels[i].calibration_id),rec.calibration_id);s_batch.channels[i].runtime_ms=(uint32_t)((s_batch.channels[i].requested_ml/rec.rate_ml_sec)*1000.0f+0.5f);
        if(s_batch.channels[i].runtime_ms==0 || s_batch.channels[i].runtime_ms > s_batch.max_dosing_runtime_sec*1000U || (s_batch.min_dosing_runtime_sec>0 && s_batch.channels[i].runtime_ms < s_batch.min_dosing_runtime_sec*1000U)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    }
    cJSON *recipe=cJSON_GetObjectItem(plan,"recipe"); if(!recipe||!cJSON_IsObject(recipe)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    cJSON *rid=cJSON_GetObjectItem(recipe,"recipeId"), *rv=cJSON_GetObjectItem(recipe,"version"), *rs=cJSON_GetObjectItem(recipe,"snapshot");
    if(!rid||!cJSON_IsString(rid)||!rid->valuestring[0]||!rv||!cJSON_IsNumber(rv)||rv->valuedouble<1||!rs||!cJSON_IsObject(rs)){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    if(s_batch.recipe_id[0] && strcmp(s_batch.recipe_id,rid->valuestring)!=0){cJSON_Delete(root);return ESP_ERR_INVALID_STATE;}
    cp(s_batch.recipe_id,sizeof(s_batch.recipe_id),rid->valuestring);s_batch.recipe_version=(uint32_t)rv->valuedouble;char *snap=cJSON_PrintUnformatted(rs);if(!snap){cJSON_Delete(root);return ESP_ERR_NO_MEM;}cp(s_batch.recipe_snapshot_json,sizeof(s_batch.recipe_snapshot_json),snap);free(snap);
    char *plan_json=cJSON_PrintUnformatted(plan);if(plan_json){cp(s_batch.execution_plan_json,sizeof(s_batch.execution_plan_json),plan_json);free(plan_json);}else{cJSON_Delete(root);return ESP_ERR_NO_MEM;}
    cJSON_Delete(root);return ESP_OK;
#undef STRF
}

static void task(void *arg){(void)arg;while(1){
    if(active_run_state(s_state) && (safety_monitor_has_fault()||actuator_hal_is_emergency_stopped())){stop_all();s_run_end_ms=wallclock_ms();s_state=FERT_STATE_INTERRUPTED;persist_run("SAFETY");vTaskDelay(pdMS_TO_TICKS(250));continue;}
    uint32_t elapsed=now_ms()-s_state_start_ms;
    if(s_state!=FERT_STATE_IDLE && s_state!=FERT_STATE_PRECHECK && s_state!=FERT_STATE_COMPLETE && s_batch.max_runtime_sec>0 && s_run_start_ms>0){
        int64_t elapsed_run_wall=wallclock_ms();
        if(elapsed_run_wall>0 && elapsed_run_wall-s_run_start_ms>((int64_t)s_batch.max_runtime_sec*1000LL)){
            stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=elapsed_run_wall;persist_run("MAX_RUNTIME_EXCEEDED");vTaskDelay(pdMS_TO_TICKS(250));continue;
        }
    }
    switch(s_state){
      case FERT_STATE_FILLING:
        if(actuator_hal_acquire_component(s_batch.raw_water_component_id,ACTUATOR_OWNER_FERTIGATION)!=ESP_OK){stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("RAW_WATER_RESOURCE_LOCKED");break;}
        if(actuator_hal_set_by_component_id(s_batch.raw_water_component_id,true)!=ESP_OK){stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("RAW_WATER_ACTUATOR_REJECTED");break;}
        uint32_t current=0;
        if(sensor_hal_get_component_accumulated_ml(s_batch.raw_flow_sensor_id,&current)!=ESP_OK){stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("RAW_FLOW_MEASUREMENT_UNAVAILABLE");break;}
        current=current>=s_raw_start_ml?current-s_raw_start_ml:0;
        if(current+ s_batch.tolerance_ml >= (uint32_t)s_batch.target_water_ml){stop_component(s_batch.raw_water_component_id);transition(FERT_STATE_DOSING);}else if(elapsed>(s_batch.fill_timeout_sec*1000U)){stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("FILL_TIMEOUT");}
        break;
      case FERT_STATE_DOSING:
        for(uint32_t i=0;i<s_batch.channel_count;i++){
            uint32_t runtime=s_batch.channels[i].runtime_ms;
            if(s_dosing_start_ms[i]==0) s_dosing_start_ms[i]=now_ms();
            uint32_t channel_elapsed=now_ms()-s_dosing_start_ms[i];
            if(channel_elapsed < runtime){
                if(actuator_hal_acquire_component(s_batch.channels[i].component_id,ACTUATOR_OWNER_FERTIGATION)!=ESP_OK){
                    stop_all(); s_state=FERT_STATE_FAULTED; s_run_end_ms=wallclock_ms(); persist_run("DOSING_RESOURCE_LOCKED"); break;
                }
                if(actuator_hal_set_by_component_id(s_batch.channels[i].component_id,true)!=ESP_OK){
                    stop_all(); s_state=FERT_STATE_FAULTED; s_run_end_ms=wallclock_ms(); persist_run("DOSING_ACTUATOR_REJECTED"); break;
                }
                s_dosing_runtime_observed_ms[i]=channel_elapsed;
            } else {
                stop_component(s_batch.channels[i].component_id);
                s_dosing_runtime_observed_ms[i]=runtime;
            }
        }
        {bool done=true;for(uint32_t i=0;i<s_batch.channel_count;i++)if(s_dosing_runtime_observed_ms[i]<s_batch.channels[i].runtime_ms)done=false;if(done)transition(FERT_STATE_FINAL_MIXING);}
        break;
      case FERT_STATE_FINAL_MIXING:
        if(s_batch.mixing_pump_id[0]){
            if(actuator_hal_acquire_component(s_batch.mixing_pump_id,ACTUATOR_OWNER_FERTIGATION)!=ESP_OK ||
               actuator_hal_set_by_component_id(s_batch.mixing_pump_id,true)!=ESP_OK){
                stop_all(); s_state=FERT_STATE_FAULTED; s_run_end_ms=wallclock_ms(); persist_run("MIXING_ACTUATOR_REJECTED"); break;
            }
        }
        if(elapsed>=s_batch.mixing_duration_sec*1000U){
            stop_component(s_batch.mixing_pump_id);
            uint32_t delivery_start=0;
            if(strcasecmp(s_batch.delivery_mode,"DURATION")!=0&&sensor_hal_get_component_accumulated_ml(s_batch.delivery_flow_sensor_id,&delivery_start)==ESP_OK)s_delivery_start_ml=delivery_start;
            transition(FERT_STATE_DELIVERY);
        }
        break;
      case FERT_STATE_DELIVERY:
        if(actuator_hal_acquire_component(s_batch.delivery_pump_id,ACTUATOR_OWNER_FERTIGATION)!=ESP_OK){stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("DELIVERY_RESOURCE_LOCKED");break;}
        if(actuator_hal_set_by_component_id(s_batch.delivery_pump_id,true)!=ESP_OK){stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("DELIVERY_ACTUATOR_REJECTED");break;}
        if(strcasecmp(s_batch.delivery_mode,"DURATION")==0){if(elapsed>=s_batch.delivery_duration_sec*1000U){stop_component(s_batch.delivery_pump_id);transition(FERT_STATE_COMPLETE);}}
        else {
            sensor_component_sample_t flow={0};
            bool flow_ok=sensor_hal_get_component_sample(s_batch.delivery_flow_sensor_id,&flow)==ESP_OK && flow.state==SENSOR_STATE_VALID && flow.has_value;
            if(!flow_ok){stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("DELIVERY_FLOW_SENSOR_NOT_VALID");break;}
            if(strcasecmp(s_batch.delivery_mode,"FLOW")==0 && flow.value < s_batch.target_flow_lpm){
                /* Flow target is an explicit readiness floor; volume remains the completion criterion. */
            }
            sensor_component_sample_t pressure={0};
            bool pressure_target_ok = true;
            if(strcasecmp(s_batch.delivery_mode,"PRESSURE_FLOW")==0){
                if(sensor_hal_get_component_sample(s_batch.pressure_sensor_id,&pressure)!=ESP_OK||pressure.state!=SENSOR_STATE_VALID||!pressure.has_value){
                    stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("PRESSURE_SENSOR_NOT_VALID");break;
                }
                pressure_target_ok=pressure.value>=s_batch.target_pressure_kpa;
                if(flow.value<=0){
                    stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("DELIVERY_FLOW_NOT_READY");break;
                }
            }
            uint32_t current=0;
            if(sensor_hal_get_component_accumulated_ml(s_batch.delivery_flow_sensor_id,&current)!=ESP_OK){stop_all();s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("DELIVERY_VOLUME_MEASUREMENT_UNAVAILABLE");break;}
            current=current>=s_delivery_start_ml?current-s_delivery_start_ml:0;
            bool flow_target_ok = strcasecmp(s_batch.delivery_mode,"FLOW")!=0 || flow.value >= s_batch.target_flow_lpm;
            bool target_complete = current+s_batch.tolerance_ml >= (uint32_t)s_batch.delivery_target_ml;
            if(target_complete && flow_target_ok && pressure_target_ok){
                stop_component(s_batch.delivery_pump_id);transition(FERT_STATE_COMPLETE);
            }else if(elapsed>(s_batch.delivery_timeout_sec*1000U)){
                stop_component(s_batch.delivery_pump_id);s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run(flow_target_ok&&pressure_target_ok?"DELIVERY_TIMEOUT":"DELIVERY_TARGET_NOT_REACHED");
            }
        }
        break;
      case FERT_STATE_COMPLETE: stop_all();s_run_end_ms=wallclock_ms();persist_run(NULL);transition(FERT_STATE_IDLE);break;
      case FERT_STATE_PRECHECK: if(!precheck()){s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("PRECHECK_FAILED");}else{if(sensor_hal_get_component_accumulated_ml(s_batch.raw_flow_sensor_id,&s_raw_start_ml)!=ESP_OK || (strcasecmp(s_batch.delivery_mode,"DURATION")!=0 && sensor_hal_get_component_accumulated_ml(s_batch.delivery_flow_sensor_id,&s_delivery_start_ml)!=ESP_OK)){s_state=FERT_STATE_FAULTED;s_run_end_ms=wallclock_ms();persist_run("FLOW_COUNTER_UNAVAILABLE");}else transition(FERT_STATE_FILLING);}break;
      default: break;
    }
    vTaskDelay(pdMS_TO_TICKS(200));
}}

esp_err_t fertigation_mgr_init(void){if(s_mutex)return ESP_OK;s_mutex=xSemaphoreCreateMutex();if(!s_mutex)return ESP_ERR_NO_MEM;s_state=FERT_STATE_IDLE;(void)restore_recovery();if(s_state==FERT_STATE_RECOVERY_HOLD)(void)event_mgr_log_command(LOG_LEVEL_WARNING,"FERTIGATION_RECOVERY_HOLD","A previously running fertigation was interrupted by reboot and is held for explicit operator disposition.",s_batch.run_id,s_batch.complex_id,s_batch.gh_id,NULL,NULL,s_batch.configuration_version);xTaskCreatePinnedToCore(task,"fert_mgr",6144,NULL,5,NULL,1);return ESP_OK;}
esp_err_t fertigation_mgr_start_from_json(const char *json_payload){if(!s_mutex||!json_payload)return ESP_ERR_INVALID_ARG;if(xSemaphoreTake(s_mutex,portMAX_DELAY)!=pdTRUE)return ESP_FAIL;if(s_state!=FERT_STATE_IDLE){xSemaphoreGive(s_mutex);return ESP_ERR_INVALID_STATE;}esp_err_t e=parse_payload(json_payload);if(e==ESP_OK){s_run_start_ms=wallclock_ms();s_run_end_ms=0;memset(s_phase_ts,0,sizeof(s_phase_ts));memset(s_dosing_start_ms,0,sizeof(s_dosing_start_ms));memset(s_dosing_runtime_observed_ms,0,sizeof(s_dosing_runtime_observed_ms));transition(FERT_STATE_PRECHECK);(void)event_mgr_log_command(LOG_LEVEL_INFO,"FERTIGATION_STARTED","Fertigation batch started.",s_batch.run_id,s_batch.complex_id,s_batch.gh_id,s_batch.delivery_pump_id,NULL,s_batch.configuration_version);}xSemaphoreGive(s_mutex);return e;}
esp_err_t fertigation_mgr_cancel_batch(void){if(!s_mutex)return ESP_ERR_INVALID_STATE;if(xSemaphoreTake(s_mutex,portMAX_DELAY)!=pdTRUE)return ESP_FAIL;if(s_state!=FERT_STATE_IDLE){stop_all();if(s_state==FERT_STATE_RECOVERY_HOLD){clear_recovery();s_state=FERT_STATE_ABORTED;}else{s_state=FERT_STATE_ABORTED;s_run_end_ms=wallclock_ms();persist_run("OPERATOR_ABORT");}s_state=FERT_STATE_IDLE;}xSemaphoreGive(s_mutex);return ESP_OK;}
fertigation_state_t fertigation_mgr_get_state(void){return s_state;}
esp_err_t fertigation_mgr_get_status(fertigation_runtime_snapshot_t *out){if(!out)return ESP_ERR_INVALID_ARG;memset(out,0,sizeof(*out));out->state=s_state;cp(out->run_id,sizeof(out->run_id),s_batch.run_id);out->start_timestamp_ms=s_run_start_ms;out->end_timestamp_ms=s_run_end_ms;return ESP_OK;}
esp_err_t fertigation_mgr_get_active_snapshot(cJSON **out){if(!out)return ESP_ERR_INVALID_ARG;*out=NULL;cJSON *o=cJSON_CreateObject();if(!o)return ESP_ERR_NO_MEM;cJSON_AddStringToObject(o,"state",state_name(s_state));cJSON_AddBoolToObject(o,"recoveryRequired",s_state==FERT_STATE_RECOVERY_HOLD);if(s_state==FERT_STATE_RECOVERY_HOLD)cJSON_AddStringToObject(o,"recoveryDisposition","OPERATOR_CANCEL_REQUIRED");cJSON_AddStringToObject(o,"runId",s_batch.run_id);cJSON_AddStringToObject(o,"complexId",s_batch.complex_id);cJSON_AddStringToObject(o,"ghId",s_batch.gh_id);cJSON_AddStringToObject(o,"recipeId",s_batch.recipe_id);cJSON_AddNumberToObject(o,"configurationVersion",s_batch.configuration_version);cJSON_AddNumberToObject(o,"targetWaterMl",s_batch.target_water_ml);cJSON_AddStringToObject(o,"deliveryMode",s_batch.delivery_mode);cJSON_AddNumberToObject(o,"deliveryTargetMl",s_batch.delivery_target_ml);cJSON_AddNumberToObject(o,"targetFlowLpm",s_batch.target_flow_lpm);cJSON_AddNumberToObject(o,"targetPressureKpa",s_batch.target_pressure_kpa);cJSON_AddNumberToObject(o,"deliveryDurationSec",s_batch.delivery_duration_sec);cJSON_AddNumberToObject(o,"mixingDurationSec",s_batch.mixing_duration_sec);*out=o;return ESP_OK;}
