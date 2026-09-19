#include "services/crop_cycle_mgr.h"
#include "esp_log.h"
#include "nvs.h"
#include <string.h>
#include <time.h>
#include <stdio.h>
#include <stdlib.h>

static const char *TAG = "CROPCYCLE_MGR";
static const char *NVS_NAMESPACE = "agrotech_cc";
#define MAX_CROP_CYCLES 12U
#define NVS_KEY "cycles_v2"
#define NVS_MAGIC 0x43435632UL

typedef struct {
    uint32_t magic;
    uint32_t count;
    crop_cycle_record_t items[MAX_CROP_CYCLES];
} crop_cycle_store_t;

static crop_cycle_store_t s_store;

static void clear_record(crop_cycle_record_t *c, const char *gh_id) {
    if (!c) return; memset(c, 0, sizeof(*c));
    c->status = CYCLE_STATE_NO_CYCLE; c->hst = -1; c->hsp = -1;
    if (gh_id) snprintf(c->gh_id, sizeof(c->gh_id), "%s", gh_id);
}

static int days_between(const char *date_str) {
    if (!date_str || strlen(date_str) < 10) return -1;
    int y=0,m=0,d=0; if (sscanf(date_str, "%d-%d-%d", &y,&m,&d) != 3) return -1;
    struct tm t = {.tm_year=y-1900,.tm_mon=m-1,.tm_mday=d,.tm_hour=12,.tm_isdst=-1};
    time_t target=mktime(&t), now=time(NULL); if (target==(time_t)-1 || now==(time_t)-1) return -1;
    double diff=difftime(now,target); return diff<0 ? 0 : (int)(diff/86400.0);
}

static void now_iso(char out[32]) { time_t now=time(NULL); if (now>0) strftime(out,32,"%Y-%m-%dT%H:%M:%SZ",gmtime(&now)); else snprintf(out,32,"1970-01-01T00:00:00Z"); }

static void recompute(crop_cycle_record_t *c) {
    if (!c) return;
    c->hst = (c->status==CYCLE_STATE_ACTIVE && c->tanggal_tanam[0]) ? days_between(c->tanggal_tanam) : -1;
    c->hsp = (c->status==CYCLE_STATE_ACTIVE && c->tanggal_polinasi[0]) ? days_between(c->tanggal_polinasi) : -1;
    c->has_hsp = c->hsp >= 0;
}

static esp_err_t persist(void) {
    nvs_handle_t h; esp_err_t err=nvs_open(NVS_NAMESPACE,NVS_READWRITE,&h); if(err!=ESP_OK)return err;
    s_store.magic=NVS_MAGIC; err=nvs_set_blob(h,NVS_KEY,&s_store,sizeof(s_store)); if(err==ESP_OK)err=nvs_commit(h); nvs_close(h); return err;
}

static esp_err_t load(void) {
    memset(&s_store,0,sizeof(s_store));
    nvs_handle_t h; esp_err_t err=nvs_open(NVS_NAMESPACE,NVS_READONLY,&h); if(err!=ESP_OK)return ESP_OK;
    size_t sz=sizeof(s_store);
    if(nvs_get_blob(h,NVS_KEY,&s_store,&sz)==ESP_OK && s_store.magic==NVS_MAGIC && s_store.count<=MAX_CROP_CYCLES) { nvs_close(h); return ESP_OK; }
    /* Migrate the previous single-cycle key, if it exists. */
    crop_cycle_record_t legacy; memset(&legacy,0,sizeof(legacy)); size_t lsz=sizeof(legacy);
    if(nvs_get_blob(h,"active_cc",&legacy,&lsz)==ESP_OK && legacy.gh_id[0]) { s_store.magic=NVS_MAGIC; s_store.count=1; s_store.items[0]=legacy; recompute(&s_store.items[0]); }
    nvs_close(h); return ESP_OK;
}

static crop_cycle_record_t *find_record(const char *gh_id, bool active_only) {
    if(!gh_id || !gh_id[0])return NULL;
    for(uint32_t i=0;i<s_store.count && i<MAX_CROP_CYCLES;i++) if(strcmp(s_store.items[i].gh_id,gh_id)==0 && (!active_only || s_store.items[i].status==CYCLE_STATE_ACTIVE)) return &s_store.items[i];
    return NULL;
}

static crop_cycle_record_t *allocate_record(const char *gh_id) {
    crop_cycle_record_t *slot=find_record(gh_id,false);
    /* Prefer an empty slot, otherwise reuse the oldest non-active record. */
    for(uint32_t i=0;i<MAX_CROP_CYCLES;i++) if(i>=s_store.count || s_store.items[i].status==CYCLE_STATE_NO_CYCLE) { if(i>=s_store.count)s_store.count=i+1; clear_record(&s_store.items[i],gh_id); return &s_store.items[i]; }
    int idx=-1;
    for(uint32_t i=0;i<s_store.count;i++) {
        if(s_store.items[i].status!=CYCLE_STATE_ACTIVE) { idx=(int)i; break; }
    }
    if(idx<0)return NULL; clear_record(&s_store.items[idx],gh_id); return &s_store.items[idx];
}

esp_err_t crop_cycle_mgr_init(void) { load(); for(uint32_t i=0;i<s_store.count;i++) recompute(&s_store.items[i]); ESP_LOGI(TAG,"Crop cycle store initialized: %lu historical records",(unsigned long)s_store.count); return ESP_OK; }

esp_err_t crop_cycle_mgr_get_current(const char *gh_id, crop_cycle_record_t *out) { if(!out||!gh_id||!gh_id[0])return ESP_ERR_INVALID_ARG; crop_cycle_record_t *c=find_record(gh_id,true); if(!c){clear_record(out,gh_id);return ESP_OK;} recompute(c);*out=*c;return ESP_OK; }

esp_err_t crop_cycle_mgr_list(const char *gh_id, cJSON **out_items) { if(!out_items||!gh_id||!gh_id[0])return ESP_ERR_INVALID_ARG; *out_items=cJSON_CreateArray(); if(!*out_items)return ESP_ERR_NO_MEM; for(uint32_t i=0;i<s_store.count;i++){if(strcmp(s_store.items[i].gh_id,gh_id)!=0)continue; recompute(&s_store.items[i]); cJSON_AddItemToArray(*out_items,crop_cycle_mgr_to_json(&s_store.items[i]));} return ESP_OK; }

esp_err_t crop_cycle_mgr_start(const char *gh_id,const char *tanggal_tanam,const char *variety,uint32_t plant_count,const char *notes) {
    if(!gh_id||!gh_id[0]||!tanggal_tanam||strlen(tanggal_tanam)<10)return ESP_ERR_INVALID_ARG;
    if(find_record(gh_id,true))return ESP_ERR_INVALID_STATE;
    crop_cycle_record_t *c=allocate_record(gh_id); if(!c)return ESP_ERR_NO_MEM;
    snprintf(c->cycle_id,sizeof(c->cycle_id),"cc-%llu",(unsigned long long)time(NULL)); c->status=CYCLE_STATE_ACTIVE; snprintf(c->tanggal_tanam,sizeof(c->tanggal_tanam),"%s",tanggal_tanam); if(variety)snprintf(c->variety,sizeof(c->variety),"%s",variety); c->plant_count=plant_count; if(notes)snprintf(c->notes,sizeof(c->notes),"%s",notes); c->version++; c->has_harvest=false;c->has_yield=false;recompute(c); if(persist()!=ESP_OK)return ESP_FAIL; return ESP_OK;
}

esp_err_t crop_cycle_mgr_import_active(const char *gh_id,const char *tanggal_tanam,const char *tanggal_polinasi,const char *variety,uint32_t plant_count,const char *notes) {
    if(!gh_id||!gh_id[0]||!tanggal_tanam||strlen(tanggal_tanam)<10)return ESP_ERR_INVALID_ARG; if(find_record(gh_id,true))return ESP_ERR_INVALID_STATE; crop_cycle_record_t *c=allocate_record(gh_id);if(!c)return ESP_ERR_NO_MEM; snprintf(c->cycle_id,sizeof(c->cycle_id),"import-%llu",(unsigned long long)time(NULL));c->status=CYCLE_STATE_ACTIVE;snprintf(c->tanggal_tanam,sizeof(c->tanggal_tanam),"%s",tanggal_tanam);if(tanggal_polinasi&&strlen(tanggal_polinasi)>=10)snprintf(c->tanggal_polinasi,sizeof(c->tanggal_polinasi),"%s",tanggal_polinasi);if(variety)snprintf(c->variety,sizeof(c->variety),"%s",variety);c->plant_count=plant_count;if(notes)snprintf(c->notes,sizeof(c->notes),"%s",notes);c->version++;recompute(c);return persist();
}

esp_err_t crop_cycle_mgr_set_pollination(const char *gh_id,const char *tanggal_polinasi,const char *method) { (void)method; if(!tanggal_polinasi||strlen(tanggal_polinasi)<10)return ESP_ERR_INVALID_ARG; crop_cycle_record_t *c=find_record(gh_id,true);if(!c)return ESP_ERR_NOT_FOUND; if(strcmp(tanggal_polinasi,c->tanggal_tanam)<0)return ESP_ERR_INVALID_ARG;snprintf(c->tanggal_polinasi,sizeof(c->tanggal_polinasi),"%s",tanggal_polinasi);c->version++;recompute(c);return persist(); }
esp_err_t crop_cycle_mgr_delete_pollination(const char *gh_id){crop_cycle_record_t*c=find_record(gh_id,true);if(!c)return ESP_ERR_NOT_FOUND;c->tanggal_polinasi[0]='\0';c->version++;recompute(c);return persist();}
esp_err_t crop_cycle_mgr_update_planting_date(const char *gh_id,const char *new_tanggal_tanam){if(!new_tanggal_tanam||strlen(new_tanggal_tanam)<10)return ESP_ERR_INVALID_ARG;crop_cycle_record_t*c=find_record(gh_id,true);if(!c)return ESP_ERR_NOT_FOUND;if(c->tanggal_polinasi[0]&&strcmp(c->tanggal_polinasi,new_tanggal_tanam)<0)return ESP_ERR_INVALID_ARG;snprintf(c->tanggal_tanam,sizeof(c->tanggal_tanam),"%s",new_tanggal_tanam);c->version++;recompute(c);return persist();}
esp_err_t crop_cycle_mgr_update_metadata(const char *gh_id,const char *variety,uint32_t plant_count,const char *notes){crop_cycle_record_t*c=find_record(gh_id,true);if(!c)return ESP_ERR_NOT_FOUND;if(variety)snprintf(c->variety,sizeof(c->variety),"%s",variety);if(plant_count>0)c->plant_count=plant_count;if(notes)snprintf(c->notes,sizeof(c->notes),"%s",notes);c->version++;return persist();}
esp_err_t crop_cycle_mgr_cancel(const char *gh_id){crop_cycle_record_t*c=find_record(gh_id,true);if(!c)return ESP_ERR_NOT_FOUND;c->status=CYCLE_STATE_CANCELLED;c->version++;recompute(c);return persist();}
esp_err_t crop_cycle_mgr_harvest(const char *gh_id,const char *harvest_date,float yield_kg,bool has_yield,const char *grade,const char *notes){crop_cycle_record_t*c=find_record(gh_id,true);if(!c)return ESP_ERR_NOT_FOUND;c->status=CYCLE_STATE_HARVESTED;c->has_harvest=true;c->has_yield=has_yield&&yield_kg>=0;if(harvest_date&&strlen(harvest_date)>=10)snprintf(c->harvest_date,sizeof(c->harvest_date),"%s",harvest_date);else now_iso(c->harvest_date);if(grade)snprintf(c->grade,sizeof(c->grade),"%s",grade);if(notes)snprintf(c->harvest_notes,sizeof(c->harvest_notes),"%s",notes);c->yield_kg=yield_kg;c->version++;recompute(c);now_iso(c->harvest_recorded_at);return persist();}

cJSON *crop_cycle_mgr_to_json(const crop_cycle_record_t*c){if(!c)return NULL;cJSON*r=cJSON_CreateObject();if(!r)return NULL;cJSON_AddStringToObject(r,"cycleId",c->cycle_id);cJSON_AddStringToObject(r,"ghId",c->gh_id);const char*ss="NO_CYCLE";if(c->status==CYCLE_STATE_ACTIVE)ss="ACTIVE";else if(c->status==CYCLE_STATE_HARVESTED)ss="HARVESTED";else if(c->status==CYCLE_STATE_CANCELLED)ss="CANCELLED";cJSON_AddStringToObject(r,"status",ss);if(c->tanggal_tanam[0])cJSON_AddStringToObject(r,"tanggalTanam",c->tanggal_tanam);else cJSON_AddNullToObject(r,"tanggalTanam");if(c->tanggal_polinasi[0])cJSON_AddStringToObject(r,"tanggalPolinasi",c->tanggal_polinasi);else cJSON_AddNullToObject(r,"tanggalPolinasi");cJSON_AddStringToObject(r,"variety",c->variety);cJSON_AddNumberToObject(r,"plantCount",c->plant_count);cJSON_AddStringToObject(r,"notes",c->notes);if(c->status==CYCLE_STATE_ACTIVE){cJSON_AddNumberToObject(r,"hst",c->hst);if(c->has_hsp)cJSON_AddNumberToObject(r,"hsp",c->hsp);else cJSON_AddNullToObject(r,"hsp");}else{cJSON_AddNullToObject(r,"hst");cJSON_AddNullToObject(r,"hsp");}cJSON_AddNumberToObject(r,"version",c->version);if(c->has_harvest){cJSON*s=cJSON_AddObjectToObject(r,"lastHarvestSummary");if(c->harvest_date[0])cJSON_AddStringToObject(s,"harvestDate",c->harvest_date);else cJSON_AddNullToObject(s,"harvestDate");cJSON_AddStringToObject(s,"tanggalTanam",c->tanggal_tanam);if(c->tanggal_polinasi[0])cJSON_AddStringToObject(s,"tanggalPolinasi",c->tanggal_polinasi);else cJSON_AddNullToObject(s,"tanggalPolinasi");if(c->has_yield)cJSON_AddNumberToObject(s,"yieldKg",c->yield_kg);else cJSON_AddNullToObject(s,"yieldKg");if(c->grade[0])cJSON_AddStringToObject(s,"grade",c->grade);else cJSON_AddNullToObject(s,"grade");if(c->harvest_notes[0])cJSON_AddStringToObject(s,"notes",c->harvest_notes);else cJSON_AddNullToObject(s,"notes");cJSON_AddNumberToObject(s,"hstAtHarvest",c->hst>=0?c->hst:0);cJSON_AddNumberToObject(s,"hspAtHarvest",c->hsp>=0?c->hsp:0);if(c->harvest_recorded_at[0])cJSON_AddStringToObject(s,"recordedAt",c->harvest_recorded_at);}
else cJSON_AddNullToObject(r,"lastHarvestSummary");return r;}
