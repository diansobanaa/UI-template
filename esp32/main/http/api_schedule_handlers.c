#include "http/api_schedule_handlers.h"
#include "http/http_server.h"
#include "services/scheduler.h"
#include "storage/storage_mgr.h"
#include "esp_log.h"
#include "cJSON.h"
#include "nvs.h"
#include <string.h>
#include <ctype.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>

static const char *TAG = "API_SCHED";

#define NVS_NAMESPACE_AGROTECH "agrotech"
#define NVS_KEY_SCHEDULE_INTENTS "sched_intents"
#define SPIFFS_SCHEDULE_INTENTS_FILE "/spiffs/sched_intents.json"
#define MAX_SCHEDULE_INTENTS 32
#define MAX_INTENTS_BLOB_SIZE 16384

static const char *type_to_str(schedule_type_t t)
{
    switch (t) {
        case SCHED_TYPE_DAILY: return "DAILY";
        case SCHED_TYPE_INTERVAL: return "INTERVAL";
        case SCHED_TYPE_ONCE: return "ONCE";
        default: return "DAILY";
    }
}

static const char *action_to_str(schedule_action_t a)
{
    switch (a) {
        case SCHED_ACTION_FERTIGATION: return "FERTIGATION";
        case SCHED_ACTION_WATER_PUMP: return "WATER_PUMP";
        case SCHED_ACTION_FAN_TOGGLE: return "FAN_TOGGLE";
        default: return "CUSTOM";
    }
}

/* ------------------- Authoritative Schedule Intent Store (SPIFFS Primary + NVS Mirror) ------------------- */

static cJSON *load_schedule_intents_from_spiffs(void)
{
    int fd = open(SPIFFS_SCHEDULE_INTENTS_FILE, O_RDONLY);
    if (fd < 0) return NULL;

    struct stat st;
    if (fstat(fd, &st) != 0 || st.st_size <= 0 || st.st_size > MAX_INTENTS_BLOB_SIZE) {
        close(fd);
        return NULL;
    }

    char *buf = malloc(st.st_size + 1);
    if (!buf) {
        close(fd);
        return NULL;
    }

    ssize_t n = read(fd, buf, st.st_size);
    close(fd);
    if (n <= 0) {
        free(buf);
        return NULL;
    }
    buf[n] = '\0';

    cJSON *parsed = cJSON_Parse(buf);
    free(buf);
    if (!parsed || !cJSON_IsObject(parsed)) {
        if (parsed) cJSON_Delete(parsed);
        return NULL;
    }

    cJSON *items = cJSON_GetObjectItem(parsed, "items");
    if (!items || !cJSON_IsArray(items)) {
        cJSON_DeleteItemFromObject(parsed, "items");
        cJSON_AddArrayToObject(parsed, "items");
    }
    return parsed;
}

static cJSON *load_schedule_intents_from_nvs(void)
{
    /* 1. Try SPIFFS primary storage first */
    cJSON *spiffs_data = load_schedule_intents_from_spiffs();
    if (spiffs_data) {
        return spiffs_data;
    }

    /* 2. Fallback to NVS blob for backward compatibility / migration */
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE_AGROTECH, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        cJSON *root = cJSON_CreateObject();
        cJSON_AddNumberToObject(root, "revision", 1);
        cJSON_AddNumberToObject(root, "total", 0);
        cJSON_AddArrayToObject(root, "items");
        return root;
    }

    size_t length = 0;
    err = nvs_get_blob(handle, NVS_KEY_SCHEDULE_INTENTS, NULL, &length);
    if (err != ESP_OK || length == 0 || length > MAX_INTENTS_BLOB_SIZE) {
        nvs_close(handle);
        cJSON *root = cJSON_CreateObject();
        cJSON_AddNumberToObject(root, "revision", 1);
        cJSON_AddNumberToObject(root, "total", 0);
        cJSON_AddArrayToObject(root, "items");
        return root;
    }

    char *buf = malloc(length + 1);
    if (!buf) {
        nvs_close(handle);
        cJSON *root = cJSON_CreateObject();
        cJSON_AddNumberToObject(root, "revision", 1);
        cJSON_AddNumberToObject(root, "total", 0);
        cJSON_AddArrayToObject(root, "items");
        return root;
    }

    err = nvs_get_blob(handle, NVS_KEY_SCHEDULE_INTENTS, buf, &length);
    nvs_close(handle);
    buf[length] = '\0';

    if (err != ESP_OK) {
        free(buf);
        cJSON *root = cJSON_CreateObject();
        cJSON_AddNumberToObject(root, "revision", 1);
        cJSON_AddNumberToObject(root, "total", 0);
        cJSON_AddArrayToObject(root, "items");
        return root;
    }

    cJSON *parsed = cJSON_Parse(buf);
    free(buf);

    if (!parsed || !cJSON_IsObject(parsed)) {
        if (parsed) cJSON_Delete(parsed);
        cJSON *root = cJSON_CreateObject();
        cJSON_AddNumberToObject(root, "revision", 1);
        cJSON_AddNumberToObject(root, "total", 0);
        cJSON_AddArrayToObject(root, "items");
        return root;
    }

    cJSON *items = cJSON_GetObjectItem(parsed, "items");
    if (!items || !cJSON_IsArray(items)) {
        cJSON_DeleteItemFromObject(parsed, "items");
        cJSON_AddArrayToObject(parsed, "items");
    }
    return parsed;
}

static esp_err_t save_schedule_intents_to_spiffs(const char *json_str)
{
    if (!json_str) return ESP_ERR_INVALID_ARG;
    int fd = open(SPIFFS_SCHEDULE_INTENTS_FILE, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) return ESP_FAIL;
    size_t len = strlen(json_str);
    ssize_t written = write(fd, json_str, (int)len);
    close(fd);
    return ((size_t)written == len) ? ESP_OK : ESP_FAIL;
}

static esp_err_t save_schedule_intents_to_nvs(cJSON *root)
{
    if (!root) return ESP_ERR_INVALID_ARG;

    cJSON *items = cJSON_GetObjectItem(root, "items");
    int count = items && cJSON_IsArray(items) ? cJSON_GetArraySize(items) : 0;
    cJSON_ReplaceItemInObject(root, "total", cJSON_CreateNumber((double)count));

    cJSON *rev_item = cJSON_GetObjectItem(root, "revision");
    int rev = rev_item && cJSON_IsNumber(rev_item) ? rev_item->valueint + 1 : 1;
    cJSON_ReplaceItemInObject(root, "revision", cJSON_CreateNumber((double)rev));

    char *json_str = cJSON_PrintUnformatted(root);
    if (!json_str) return ESP_ERR_NO_MEM;

    size_t len = strlen(json_str) + 1;
    if (len > MAX_INTENTS_BLOB_SIZE) {
        free(json_str);
        return ESP_ERR_NO_MEM;
    }

    /* 1. Primary flash persistence: SPIFFS (resilient against 24KB NVS partition exhaustion) */
    esp_err_t spiffs_err = save_schedule_intents_to_spiffs(json_str);
    if (spiffs_err == ESP_OK) {
        ESP_LOGI(TAG, "Schedule intents successfully persisted to SPIFFS flash (size=%u)", (unsigned)len);
    } else {
        ESP_LOGW(TAG, "SPIFFS schedule intents save failed (err=%d)", spiffs_err);
    }

    /* 2. Secondary/mirror persistence: NVS (erase old key first to avoid fragmentation/double-allocation) */
    nvs_handle_t handle;
    esp_err_t nvs_err = nvs_open(NVS_NAMESPACE_AGROTECH, NVS_READWRITE, &handle);
    if (nvs_err == ESP_OK) {
        (void)nvs_erase_key(handle, NVS_KEY_SCHEDULE_INTENTS);
        (void)nvs_commit(handle);
        nvs_err = nvs_set_blob(handle, NVS_KEY_SCHEDULE_INTENTS, json_str, len);
        if (nvs_err == ESP_OK) {
            nvs_err = nvs_commit(handle);
        }
        nvs_close(handle);
    }

    free(json_str);

    /* If either storage layer succeeded, the intent is safely persisted in hardware flash! */
    if (spiffs_err == ESP_OK || nvs_err == ESP_OK) {
        return ESP_OK;
    }

    ESP_LOGE(TAG, "Both SPIFFS and NVS persistence failed (spiffs=%d, nvs=%d)", spiffs_err, nvs_err);
    return ESP_FAIL;
}

static esp_err_t api_schedule_intents_get_handler(httpd_req_t *req)
{
    cJSON *data = load_schedule_intents_from_nvs();
    if (!data) {
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to retrieve schedule intents", NULL);
    }
    return http_send_enveloped_response(req, 200, NULL, data);
}

/* P2.4: validasi semantik schedule-intent di sisi firmware.
 * Sebelumnya hanya JSON parse + 'id' yang dicek; field lain disimpan
 * verbatim dan interpreter me-wrap/me-default diam-diam (hour%24, dsb).
 * Mengembalikan NULL bila valid, atau kode error UPPER_SNAKE bila tidak. */
static const cJSON *intent_field(const cJSON *intent, const char *a, const char *b) {
    const cJSON *f = cJSON_GetObjectItem(intent, a);
    if (!f && b) f = cJSON_GetObjectItem(intent, b);
    if (!f) {
        const cJSON *trig = cJSON_GetObjectItem(intent, "trigger");
        if (trig && cJSON_IsObject(trig)) {
            f = cJSON_GetObjectItem(trig, a);
            if (!f && b) f = cJSON_GetObjectItem(trig, b);
        }
    }
    return f;
}

static bool intent_is_well_pump(const cJSON *intent) {
    const cJSON *a = cJSON_GetObjectItem(intent, "action");
    if (a && cJSON_IsString(a) && a->valuestring) {
        if (strcasecmp(a->valuestring, "WATER_PUMP") == 0) return true;
        /* case-insensitive substring "WELL" */
        const char *p = a->valuestring;
        char low[64];
        size_t n = strlen(p);
        if (n >= sizeof(low)) n = sizeof(low) - 1;
        for (size_t i = 0; i < n; i++) low[i] = (char)tolower((unsigned char)p[i]);
        low[n] = '\0';
        if (strstr(low, "well") != NULL) return true;
    }
    const cJSON *c = intent_field(intent, "componentId", "component_id");
    if (!c) c = cJSON_GetObjectItem(intent, "component");
    if (c && cJSON_IsString(c) && c->valuestring) {
        if (strcasecmp(c->valuestring, "pump_well") == 0 ||
            strcasecmp(c->valuestring, "well_pump") == 0 ||
            strcasecmp(c->valuestring, "wp-main") == 0) return true;
    }
    return false;
}

static const char *validate_schedule_intent(const cJSON *intent) {
    if (!intent || !cJSON_IsObject(intent)) return "INTENT_NOT_AN_OBJECT";

    /* action wajib */
    const cJSON *action = cJSON_GetObjectItem(intent, "action");
    if (!action || !cJSON_IsString(action) || !action->valuestring[0])
        return "INTENT_ACTION_REQUIRED";

    /* trigger type */
    const cJSON *trig = cJSON_GetObjectItem(intent, "trigger");
    char trig_type[16] = "daily";
    if (trig) {
        const char *ts = NULL;
        if (cJSON_IsString(trig)) ts = trig->valuestring;
        else if (cJSON_IsObject(trig)) {
            const cJSON *tt = cJSON_GetObjectItem(trig, "type");
            if (tt && cJSON_IsString(tt)) ts = tt->valuestring;
        } else {
            return "INTENT_TRIGGER_INVALID";
        }
        if (ts && ts[0]) {
            if (strcasecmp(ts, "daily") == 0) strcpy(trig_type, "daily");
            else if (strcasecmp(ts, "interval") == 0) strcpy(trig_type, "interval");
            else if (strcasecmp(ts, "once") == 0) strcpy(trig_type, "once");
            else return "INTENT_TRIGGER_INVALID";
        }
    }

    /* time-of-day: hour/minute atau string "HH:MM" */
    const cJSON *hour_f = intent_field(intent, "hour", NULL);
    const cJSON *min_f = intent_field(intent, "minute", NULL);
    if (hour_f && cJSON_IsNumber(hour_f) && (hour_f->valueint < 0 || hour_f->valueint > 23))
        return "INTENT_TIME_INVALID";
    if (min_f && cJSON_IsNumber(min_f) && (min_f->valueint < 0 || min_f->valueint > 59))
        return "INTENT_TIME_INVALID";
    const cJSON *time_f = intent_field(intent, "time", NULL);
    if (time_f && cJSON_IsString(time_f) && time_f->valuestring[0]) {
        unsigned int h = 99, m = 99;
        if (sscanf(time_f->valuestring, "%u:%u", &h, &m) != 2 || h > 23 || m > 59)
            return "INTENT_TIME_INVALID";
    }

    /* days of week mask 1..127 */
    const cJSON *dow_f = intent_field(intent, "daysOfWeek", "days_of_week");
    if (dow_f && cJSON_IsNumber(dow_f) && (dow_f->valueint < 1 || dow_f->valueint > 127))
        return "INTENT_DAYS_INVALID";

    if (strcmp(trig_type, "interval") == 0) {
        const cJSON *iv = intent_field(intent, "intervalMin", "interval_min");
        if (!iv || !cJSON_IsNumber(iv) || iv->valueint <= 0)
            return "INTENT_INTERVAL_INVALID";
    }
    if (strcmp(trig_type, "once") == 0) {
        const cJSON *ts = intent_field(intent, "timestamp", "startTimestamp");
        if (!ts || !cJSON_IsNumber(ts) || ts->valueint <= 0)
            return "INTENT_TIMESTAMP_INVALID";
    }

    /* time window: start < end */
    const cJSON *st = cJSON_GetObjectItem(intent, "startTimestamp");
    const cJSON *et = cJSON_GetObjectItem(intent, "endTimestamp");
    if (st && cJSON_IsNumber(st) && et && cJSON_IsNumber(et) &&
        st->valueint > 0 && et->valueint > 0 && st->valueint >= et->valueint)
        return "INTENT_TIME_WINDOW_INVALID";

    /* duration bound: umum <= 12 jam; well-pump <= 30 menit (P2.5) */
    const cJSON *dur = intent_field(intent, "durationSec", "duration_sec");
    if (!dur) dur = cJSON_GetObjectItem(intent, "duration");
    if (dur && cJSON_IsNumber(dur)) {
        bool is_wp = intent_is_well_pump(intent);
        int32_t max_dur = is_wp ? 1800 : 43200;
        if (dur->valueint <= 0 || dur->valueint > max_dur)
            return "INTENT_DURATION_INVALID";
    }

    /* missedPolicy: tolak nilai asing (dulu diam-diam jadi SKIP) */
    const cJSON *mp = intent_field(intent, "missedPolicy", "missedRunPolicy");
    if (mp && cJSON_IsString(mp) && mp->valuestring[0] &&
        strcasecmp(mp->valuestring, "execute") != 0 &&
        strcasecmp(mp->valuestring, "skip") != 0)
        return "INTENT_MISSED_POLICY_INVALID";

    return NULL;
}

static esp_err_t api_schedule_intents_post_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) != ESP_OK || !json) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *request_id_item = cJSON_GetObjectItem(json, "requestId");
    const char *request_id = request_id_item && cJSON_IsString(request_id_item) ? request_id_item->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(json, "payload");
    cJSON *target = (payload && cJSON_IsObject(payload)) ? payload : json;
    cJSON *item = cJSON_GetObjectItem(target, "item");
    cJSON *intent_json = (item && cJSON_IsObject(item)) ? item : target;

    const char *uri_prefix = "/api/v1/schedule-intents/";
    const char *uri_pos = strstr(req->uri, uri_prefix);
    char uri_id[64] = {0};
    if (uri_pos) {
        uri_pos += strlen(uri_prefix);
        const char *query_pos = strchr(uri_pos, '?');
        size_t copy_len = query_pos ? (size_t)(query_pos - uri_pos) : strlen(uri_pos);
        if (copy_len >= sizeof(uri_id)) copy_len = sizeof(uri_id) - 1;
        memcpy(uri_id, uri_pos, copy_len);
        uri_id[copy_len] = '\0';
    }

    cJSON *id_item = cJSON_GetObjectItem(intent_json, "id");
    const char *intent_id = (id_item && cJSON_IsString(id_item) && id_item->valuestring[0]) ? id_item->valuestring : (uri_id[0] ? uri_id : NULL);

    if (!intent_id || strlen(intent_id) == 0) {
        cJSON_Delete(json);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Schedule intent 'id' is required", request_id);
    }

    char saved_id[64] = {0};
    strncpy(saved_id, intent_id, sizeof(saved_id) - 1);

    if (!id_item) {
        cJSON_AddStringToObject(intent_json, "id", saved_id);
    }

    /* P2.4: validasi semantik sebelum disimpan */
    const char *verr = validate_schedule_intent(intent_json);
    if (verr) {
        cJSON_Delete(json);
        ESP_LOGW(TAG, "Rejected schedule intent '%s': %s", saved_id, verr);
        return http_send_error(req, 422, verr, "Schedule intent failed semantic validation", request_id);
    }

    cJSON *store = load_schedule_intents_from_nvs();
    if (!store) {
        cJSON_Delete(json);
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to access schedule intent store", request_id);
    }

    cJSON *items = cJSON_GetObjectItem(store, "items");
    if (!items || !cJSON_IsArray(items)) {
        cJSON_DeleteItemFromObject(store, "items");
        items = cJSON_AddArrayToObject(store, "items");
    }

    int existing_idx = -1;
    int size = cJSON_GetArraySize(items);
    for (int i = 0; i < size; i++) {
        cJSON *it = cJSON_GetArrayItem(items, i);
        cJSON *it_id = cJSON_GetObjectItem(it, "id");
        if (it_id && cJSON_IsString(it_id) && strcmp(it_id->valuestring, saved_id) == 0) {
            existing_idx = i;
            break;
        }
    }

    cJSON *cloned_intent = cJSON_Duplicate(intent_json, 1);
    if (!cloned_intent) {
        cJSON_Delete(json);
        cJSON_Delete(store);
        return http_send_error(req, 503, "NO_MEMORY", "Unable to duplicate schedule intent", request_id);
    }

    if (existing_idx >= 0) {
        cJSON_ReplaceItemInArray(items, existing_idx, cloned_intent);
        ESP_LOGI(TAG, "Updated existing schedule intent '%s'", saved_id);
    } else {
        if (size >= MAX_SCHEDULE_INTENTS) {
            cJSON_Delete(cloned_intent);
            cJSON_Delete(json);
            cJSON_Delete(store);
            return http_send_error(req, 409, "LIMIT_EXCEEDED", "Maximum schedule intents limit reached", request_id);
        }
        cJSON_AddItemToArray(items, cloned_intent);
        ESP_LOGI(TAG, "Persisted new schedule intent '%s'", saved_id);
    }

    esp_err_t err = save_schedule_intents_to_nvs(store);
    cJSON_Delete(json);
    if (err != ESP_OK) {
        cJSON_Delete(store);
        return http_send_error(req, 500, "PERSISTENCE_FAILED", "Failed to commit schedule intent to NVS", request_id);
    }

    /* Synchronize local runtime scheduler with the persisted intents and evaluate daily schedule */
    (void)scheduler_sync_intents();
    (void)scheduler_trigger_daily_now();

    cJSON *response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "status", existing_idx >= 0 ? "UPDATED" : "PERSISTED");
    cJSON_AddStringToObject(response, "id", saved_id);
    cJSON *rev_item = cJSON_GetObjectItem(store, "revision");
    cJSON_AddNumberToObject(response, "revision", rev_item && cJSON_IsNumber(rev_item) ? rev_item->valueint : 1);
    cJSON_Delete(store);

    return http_send_enveloped_response(req, 200, request_id, response);
}

static esp_err_t api_schedule_intents_put_handler(httpd_req_t *req)
{
    return api_schedule_intents_post_handler(req);
}

static esp_err_t api_schedule_intents_delete_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    const char *prefix = "/api/v1/schedule-intents/";
    const char *pos = strstr(req->uri, prefix);
    if (!pos) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing schedule intent ID", NULL);
    }
    pos += strlen(prefix);

    char intent_id[64] = {0};
    const char *query_pos = strchr(pos, '?');
    size_t copy_len = query_pos ? (size_t)(query_pos - pos) : strlen(pos);
    if (copy_len >= sizeof(intent_id)) copy_len = sizeof(intent_id) - 1;
    memcpy(intent_id, pos, copy_len);
    intent_id[copy_len] = '\0';

    if (strlen(intent_id) == 0) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing schedule intent ID", NULL);
    }

    cJSON *store = load_schedule_intents_from_nvs();
    if (!store) {
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to access schedule intent store", NULL);
    }

    cJSON *items = cJSON_GetObjectItem(store, "items");
    int size = items && cJSON_IsArray(items) ? cJSON_GetArraySize(items) : 0;
    int found_idx = -1;
    for (int i = 0; i < size; i++) {
        cJSON *it = cJSON_GetArrayItem(items, i);
        cJSON *it_id = cJSON_GetObjectItem(it, "id");
        if (it_id && cJSON_IsString(it_id) && strcmp(it_id->valuestring, intent_id) == 0) {
            found_idx = i;
            break;
        }
    }

    if (found_idx < 0) {
        cJSON_Delete(store);
        return http_send_error(req, 404, "NOT_FOUND", "Schedule intent not found", NULL);
    }

    cJSON_DeleteItemFromArray(items, found_idx);
    ESP_LOGI(TAG, "Deleted schedule intent '%s'", intent_id);

    esp_err_t err = save_schedule_intents_to_nvs(store);
    if (err != ESP_OK) {
        cJSON_Delete(store);
        return http_send_error(req, 500, "PERSISTENCE_FAILED", "Failed to commit updated schedule intents to NVS", NULL);
    }

    /* Synchronize local runtime scheduler with the updated intents and evaluate daily schedule */
    (void)scheduler_sync_intents();
    (void)scheduler_trigger_daily_now();

    cJSON *response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "status", "DELETED");
    cJSON_AddStringToObject(response, "id", intent_id);
    cJSON *rev_item = cJSON_GetObjectItem(store, "revision");
    cJSON_AddNumberToObject(response, "revision", rev_item && cJSON_IsNumber(rev_item) ? rev_item->valueint : 1);
    cJSON_Delete(store);

    return http_send_enveloped_response(req, 200, NULL, response);
}

/* ------------------- Legacy & Compiled Schedule Handlers ------------------- */

static esp_err_t api_schedule_get_all_handler(httpd_req_t *req)
{
    schedule_entry_t *entries = calloc(MAX_SCHEDULE_INTENTS, sizeof(schedule_entry_t));
    if (!entries) {
        return http_send_error(req, 500, "NO_MEMORY", "Unable to allocate schedule buffer", NULL);
    }
    size_t count = 0;
    esp_err_t err = scheduler_get_all(entries, MAX_SCHEDULE_INTENTS, &count);
    if (err != ESP_OK) {
        free(entries);
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to retrieve schedules", NULL);
    }

    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");
    for (size_t i = 0; i < count; i++) {
        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "id", entries[i].id);
        cJSON_AddBoolToObject(item, "enabled", entries[i].enabled);
        cJSON_AddStringToObject(item, "type", type_to_str(entries[i].type));
        cJSON_AddStringToObject(item, "action", action_to_str(entries[i].action));
        cJSON_AddNumberToObject(item, "durationSec", entries[i].duration_sec);
        cJSON_AddNumberToObject(item, "hour", entries[i].hour);
        cJSON_AddNumberToObject(item, "minute", entries[i].minute);
        cJSON_AddNumberToObject(item, "daysOfWeek", entries[i].days_of_week);
        cJSON_AddNumberToObject(item, "intervalMin", entries[i].interval_min);
        cJSON_AddNumberToObject(item, "lastExecutionTimestamp", entries[i].last_execution_timestamp);
        cJSON_AddBoolToObject(item, "isRunning", entries[i].is_running);
        cJSON_AddItemToArray(items, item);
    }
    cJSON_AddNumberToObject(root, "total", (double)count);
    free(entries);

    return http_send_enveloped_response(req, 200, NULL, root);
}

static esp_err_t api_schedule_add_handler(httpd_req_t *req)
{
    return http_send_error(req, 410, "RAW_SCHEDULES_RETIRED", "Raw schedules are no longer executable. Use /api/v1/schedule-intents to store intents and deploy compiled schedules via /api/v1/schedules/compiled.", NULL);
}

static esp_err_t api_schedule_delete_handler(httpd_req_t *req)
{
    return http_send_error(req, 410, "RAW_SCHEDULES_RETIRED", "Raw schedules are no longer executable. Delete intents via /api/v1/schedule-intents/{id} and redeploy compiled schedules.", NULL);
}

static esp_err_t api_compiled_schedule_get_handler(httpd_req_t *req)
{
    char *buf = calloc(1, 12288);
    if (!buf) return http_send_error(req, 503, "NO_MEMORY", "Unable to allocate compiled schedule buffer", NULL);
    size_t len = 0;
    esp_err_t err = scheduler_get_compiled_json(buf, 12288, &len);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        free(buf);
        cJSON *empty = cJSON_CreateObject();
        cJSON_AddNumberToObject(empty, "configurationVersion", storage_mgr_get_state()->config_version);
        cJSON_AddArrayToObject(empty, "compiled");
        return http_send_enveloped_response(req, 200, NULL, empty);
    }
    if (err != ESP_OK) {
        free(buf);
        return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to read deployed compiled schedules", NULL);
    }
    cJSON *data = cJSON_ParseWithLength(buf, len);
    free(buf);
    if (!data) return http_send_error(req, 500, "CORRUPT_COMPILED_SCHEDULE", "Stored compiled schedule JSON is invalid", NULL);
    return http_send_enveloped_response(req, 200, NULL, data);
}

static esp_err_t api_compiled_schedule_deploy_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    cJSON *json = NULL;
    if (http_parse_json_body(req, &json) != ESP_OK || !json) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }
    cJSON *request_id_item = cJSON_GetObjectItem(json, "requestId");
    const char *request_id = request_id_item && cJSON_IsString(request_id_item) ? request_id_item->valuestring : NULL;
    cJSON *payload = cJSON_GetObjectItem(json, "payload");
    cJSON *target = payload && cJSON_IsObject(payload) ? payload : json;
    char *normalized = cJSON_PrintUnformatted(target);
    cJSON_Delete(json);
    if (!normalized) return http_send_error(req, 503, "NO_MEMORY", "Unable to normalize compiled schedule payload", request_id);

    esp_err_t err = scheduler_deploy_compiled_json(normalized);
    free(normalized);
    if (err != ESP_OK) {
        int status = (err == ESP_ERR_INVALID_STATE) ? 409 : 422;
        return http_send_error(req, status, status == 409 ? "CONFIGURATION_CONFLICT" : "COMPILED_SCHEDULE_INVALID", "Compiled schedule deployment was rejected by the active runtime configuration", request_id);
    }

    cJSON *response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "status", "DEPLOYED");
    cJSON_AddNumberToObject(response, "configurationVersion", storage_mgr_get_state()->config_version);
    return http_send_enveloped_response(req, 200, request_id, response);
}

static esp_err_t api_compiled_schedule_delete_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    esp_err_t err = scheduler_clear_compiled();
    if (err != ESP_OK) return http_send_error(req, 500, "INTERNAL_ERROR", "Failed to clear deployed compiled schedules", NULL);
    cJSON *response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "status", "CLEARED");
    return http_send_enveloped_response(req, 200, NULL, response);
}

static esp_err_t api_schedule_trigger_today_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;
    esp_err_t err = scheduler_trigger_daily_now();
    if (err != ESP_OK) {
        return http_send_error(req, 409, "DAILY_TRIGGER_REJECTED", "Unable to trigger daily schedule (clock may be invalid or mutex locked)", NULL);
    }
    cJSON *response = cJSON_CreateObject();
    cJSON_AddStringToObject(response, "status", "TRIGGERED");
    cJSON_AddBoolToObject(response, "dailyTriggerExecuted", scheduler_is_daily_triggered_today());
    return http_send_enveloped_response(req, 200, NULL, response);
}

void register_api_schedule_handlers(httpd_handle_t server)
{
    /* Daily trigger immediate sync endpoint */
    httpd_uri_t trigger_today_uri = {
        .uri = "/api/v1/schedules/trigger-today",
        .method = HTTP_POST,
        .handler = api_schedule_trigger_today_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &trigger_today_uri);
    /* Compiled runtime schedule endpoints (Derived artifact for FreeRTOS scheduler) */
    httpd_uri_t compiled_get_uri = {
        .uri = "/api/v1/schedules/compiled",
        .method = HTTP_GET,
        .handler = api_compiled_schedule_get_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &compiled_get_uri);

    httpd_uri_t compiled_post_uri = {
        .uri = "/api/v1/schedules/compiled",
        .method = HTTP_POST,
        .handler = api_compiled_schedule_deploy_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &compiled_post_uri);

    httpd_uri_t compiled_delete_uri = {
        .uri = "/api/v1/schedules/compiled",
        .method = HTTP_DELETE,
        .handler = api_compiled_schedule_delete_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &compiled_delete_uri);

    /* Authoritative schedule intent endpoints (Persistent configuration in NVS) */
    httpd_uri_t intents_get_uri = {
        .uri = "/api/v1/schedule-intents",
        .method = HTTP_GET,
        .handler = api_schedule_intents_get_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &intents_get_uri);

    httpd_uri_t intents_post_uri = {
        .uri = "/api/v1/schedule-intents",
        .method = HTTP_POST,
        .handler = api_schedule_intents_post_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &intents_post_uri);

    httpd_uri_t intents_put_uri = {
        .uri = "/api/v1/schedule-intents/*",
        .method = HTTP_PUT,
        .handler = api_schedule_intents_put_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &intents_put_uri);

    httpd_uri_t intents_delete_uri = {
        .uri = "/api/v1/schedule-intents/*",
        .method = HTTP_DELETE,
        .handler = api_schedule_intents_delete_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &intents_delete_uri);

    /* Legacy raw schedule endpoints (Retired) */
    httpd_uri_t get_all_uri = {
        .uri       = "/api/v1/schedules",
        .method    = HTTP_GET,
        .handler   = api_schedule_get_all_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &get_all_uri);

    httpd_uri_t add_uri = {
        .uri       = "/api/v1/schedules",
        .method    = HTTP_POST,
        .handler   = api_schedule_add_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &add_uri);

    httpd_uri_t delete_uri = {
        .uri       = "/api/v1/schedules/*",
        .method    = HTTP_DELETE,
        .handler   = api_schedule_delete_handler,
        .user_ctx  = NULL
    };
    httpd_register_uri_handler(server, &delete_uri);
}

