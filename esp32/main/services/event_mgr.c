#include "services/event_mgr.h"
#include "storage/storage_mgr.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <string.h>
#include <time.h>
#include <stdio.h>

static const char *TAG = "EVENT_MGR";

#define EVENT_RING_BUFFER_SIZE 64

typedef struct {
    uint32_t seq;
    char id[24];
    char timestamp[32];
    event_level_t level;
    char category[24];
    char code[32];
    char message[96];
    char component_id[24];
} system_event_t;

static system_event_t s_events[EVENT_RING_BUFFER_SIZE];
static size_t s_head = 0;
static size_t s_count = 0;
static uint32_t s_next_seq = 1;
static SemaphoreHandle_t s_evt_mutex = NULL;

static const char *level_to_str(event_level_t l)
{
    switch (l) {
        case LOG_LEVEL_INFO: return "INFO";
        case LOG_LEVEL_WARNING: return "WARNING";
        case LOG_LEVEL_ERROR: return "ERROR";
        case LOG_LEVEL_CRITICAL: return "CRITICAL";
        default: return "INFO";
    }
}

esp_err_t event_mgr_init(void)
{
    if (s_evt_mutex) return ESP_OK;

    s_evt_mutex = xSemaphoreCreateMutex();
    event_mgr_log(LOG_LEVEL_INFO, "SYSTEM", "SYS_BOOT", "System booted into fail-safe state with all outputs OFF", "esp32");
    ESP_LOGI(TAG, "Event manager initialized.");
    return ESP_OK;
}

esp_err_t event_mgr_log(event_level_t level, const char *category, const char *code, const char *message, const char *component_id)
{
    if (!s_evt_mutex) s_evt_mutex = xSemaphoreCreateMutex();

    xSemaphoreTake(s_evt_mutex, portMAX_DELAY);

    system_event_t *e = &s_events[s_head];
    e->seq = s_next_seq++;
    snprintf(e->id, sizeof(e->id), "evt-%06lu", (unsigned long)e->seq);

    time_t now = time(NULL);
    strftime(e->timestamp, sizeof(e->timestamp), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));

    e->level = level;
    strncpy(e->category, category ? category : "SYSTEM", sizeof(e->category) - 1);
    strncpy(e->code, code ? code : "EVENT", sizeof(e->code) - 1);
    strncpy(e->message, message ? message : "", sizeof(e->message) - 1);
    strncpy(e->component_id, component_id ? component_id : "", sizeof(e->component_id) - 1);

    s_head = (s_head + 1) % EVENT_RING_BUFFER_SIZE;
    if (s_count < EVENT_RING_BUFFER_SIZE) {
        s_count++;
    }

    /* Prepare JSON string for persistent flash storage */
    char json_buf[256];
    snprintf(json_buf, sizeof(json_buf), "{\"id\":\"%s\",\"at\":\"%s\",\"level\":\"%s\",\"code\":\"%s\",\"message\":\"%s\"}",
             e->id, e->timestamp, level_to_str(e->level), e->code, e->message);

    xSemaphoreGive(s_evt_mutex);

    storage_mgr_append_event_log(json_buf);
    ESP_LOGI(TAG, "[%s] %s: %s", level_to_str(level), code, message);

    return ESP_OK;
}

cJSON *event_mgr_get_events_json(const char *cursor, int limit)
{
    if (!s_evt_mutex) s_evt_mutex = xSemaphoreCreateMutex();
    if (limit <= 0 || limit > 50) limit = 50;

    xSemaphoreTake(s_evt_mutex, portMAX_DELAY);

    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");

    size_t returned = 0;
    for (size_t i = 0; i < s_count && returned < (size_t)limit; i++) {
        size_t idx = (s_head + EVENT_RING_BUFFER_SIZE - 1 - i) % EVENT_RING_BUFFER_SIZE;
        system_event_t *e = &s_events[idx];

        cJSON *item = cJSON_CreateObject();
        cJSON_AddStringToObject(item, "id", e->id);
        cJSON_AddStringToObject(item, "at", e->timestamp);
        cJSON_AddStringToObject(item, "level", level_to_str(e->level));
        cJSON_AddStringToObject(item, "code", e->code);
        cJSON_AddStringToObject(item, "message", e->message);
        if (strlen(e->component_id) > 0) {
            cJSON_AddStringToObject(item, "componentId", e->component_id);
        }
        cJSON_AddItemToArray(items, item);
        returned++;
    }

    cJSON_AddNullToObject(root, "nextCursor");

    xSemaphoreGive(s_evt_mutex);
    return root;
}
