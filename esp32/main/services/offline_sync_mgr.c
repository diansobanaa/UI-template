#include "services/offline_sync_mgr.h"
#include "network/network_mgr.h"
#include "storage/storage_mgr.h"
#include "services/telemetry_mgr.h"
#include "services/event_mgr.h"
#include "config/system_config.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "cJSON.h"
#include <string.h>
#include <stdlib.h>
#include <inttypes.h>

static const char *TAG = "OFFLINE_SYNC";
#define SYNC_BATCH_TELEMETRY 20
#define SYNC_BATCH_EVENTS 50
#define SYNC_PERIOD_MS 10000
#define SYNC_RESPONSE_BYTES (16 * 1024)

static uint64_t s_telemetry_cursor = 0;
static uint64_t s_event_cursor = 0;
static bool s_initialized = false;

static const char *backend_url(void)
{
    return AGROTECH_BACKEND_BASE_URL;
}

static esp_err_t post_bundle(cJSON *bundle)
{
    char *body = cJSON_PrintUnformatted(bundle);
    if (!body) return ESP_ERR_NO_MEM;
    char url[256];
    snprintf(url, sizeof(url), "%s/api/ingest/esp32", backend_url());
    esp_http_client_config_t cfg = { .url = url, .method = HTTP_METHOD_POST, .timeout_ms = 7000 };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) { free(body); return ESP_ERR_NO_MEM; }
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, (int)strlen(body));
    esp_err_t err = esp_http_client_perform(client);
    int status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    free(body);
    if (err != ESP_OK) return err;
    return (status >= 200 && status < 300) ? ESP_OK : ESP_FAIL;
}

static uint64_t json_last_sequence(cJSON *items)
{
    uint64_t last = 0;
    if (!items || !cJSON_IsArray(items)) return 0;
    cJSON *x = NULL;
    cJSON_ArrayForEach(x, items) {
        cJSON *seq = cJSON_GetObjectItem(x, "sequence");
        if (seq && cJSON_IsNumber(seq) && seq->valuedouble > (double)last) last = (uint64_t)seq->valuedouble;
    }
    return last;
}

static bool sync_once(void)
{
    if (!network_mgr_is_connected()) return false;
    char tcur[32]; char ecur[32];
    snprintf(tcur, sizeof(tcur), "%" PRIu64, s_telemetry_cursor);
    snprintf(ecur, sizeof(ecur), "%" PRIu64, s_event_cursor);
    cJSON *tele = telemetry_mgr_get_history_json(NULL, tcur, SYNC_BATCH_TELEMETRY);
    cJSON *ev = event_mgr_get_events_json(ecur, SYNC_BATCH_EVENTS);
    if (!tele || !ev) { cJSON_Delete(tele); cJSON_Delete(ev); return false; }
    cJSON *tele_items = cJSON_GetObjectItem(tele, "items");
    cJSON *ev_items = cJSON_GetObjectItem(ev, "items");
    if ((!tele_items || cJSON_GetArraySize(tele_items) == 0) && (!ev_items || cJSON_GetArraySize(ev_items) == 0)) { cJSON_Delete(tele); cJSON_Delete(ev); return true; }
    cJSON *bundle = cJSON_CreateObject(); if (!bundle) { cJSON_Delete(tele); cJSON_Delete(ev); return false; }
    const system_storage_state_t *st = storage_mgr_get_state();
    cJSON_AddStringToObject(bundle, "deviceId", st && st->device_id[0] ? st->device_id : "unknown-device");
    cJSON_AddStringToObject(bundle, "complexId", st && st->complex_id[0] ? st->complex_id : "");
    cJSON_AddItemToObject(bundle, "telemetry", cJSON_Duplicate(tele_items, 1));
    cJSON_AddItemToObject(bundle, "events", cJSON_Duplicate(ev_items, 1));
    esp_err_t post = post_bundle(bundle);
    uint64_t last_t = json_last_sequence(tele_items), last_e = json_last_sequence(ev_items);
    cJSON_Delete(bundle); cJSON_Delete(tele); cJSON_Delete(ev);
    if (post != ESP_OK) return false;
    if (last_t > s_telemetry_cursor) { s_telemetry_cursor = last_t; (void)storage_mgr_set_sync_cursor("telemetry", s_telemetry_cursor); }
    if (last_e > s_event_cursor) { s_event_cursor = last_e; (void)storage_mgr_set_sync_cursor("events", s_event_cursor); }
    return true;
}

static void sync_task(void *arg)
{
    (void)arg;
    for (;;) {
        if (network_mgr_is_connected()) {
            bool ok = sync_once();
            (void)event_mgr_log(LOG_LEVEL_INFO, "COMMUNICATION", ok ? "OFFLINE_SYNC_COMPLETED" : "OFFLINE_SYNC_FAILED", ok ? "Local telemetry/event history synchronized." : "History synchronization will retry while local buffers remain durable.", NULL);
        }
        vTaskDelay(pdMS_TO_TICKS(SYNC_PERIOD_MS));
    }
}

esp_err_t offline_sync_mgr_init(void)
{
    if (s_initialized) return ESP_OK;
    (void)storage_mgr_get_sync_cursor("telemetry", &s_telemetry_cursor);
    (void)storage_mgr_get_sync_cursor("events", &s_event_cursor);
    BaseType_t ok = xTaskCreatePinnedToCore(sync_task, "offline_sync", 7168, NULL, 3, NULL, 1);
    if (ok != pdPASS) return ESP_ERR_NO_MEM;
    s_initialized = true;
    ESP_LOGI(TAG, "Offline sync manager initialized; cursors telemetry=%" PRIu64 " events=%" PRIu64, s_telemetry_cursor, s_event_cursor);
    return ESP_OK;
}
