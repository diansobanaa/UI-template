#include "http/api_telemetry_handlers.h"
#include "utils/psram_task.h"
#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "services/telemetry_mgr.h"
#include "services/event_mgr.h"
#include "cJSON.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "config/system_config.h"
#include <string.h>
#include <stdlib.h>

static const char *TAG = "API_TELEMETRY";

#define MAX_WS_CLIENTS 4

typedef struct {
    int fd;
    bool active;
    uint64_t last_seq_sent;
} ws_client_entry_t;

typedef struct {
    char *json_str;
    size_t len;
} ws_async_frame_t;

static ws_client_entry_t s_ws_clients[MAX_WS_CLIENTS];
static SemaphoreHandle_t s_ws_mutex = NULL;
static httpd_handle_t s_server_handle = NULL;
static TaskHandle_t s_stream_task_handle = NULL;
static uint64_t s_last_broadcast_seq = 0;

static const char *query_value(httpd_req_t *req, const char *key, char *buf, size_t cap)
{
    if (!req || !key || !buf || cap == 0) return NULL;
    size_t total = httpd_req_get_url_query_len(req);
    if (total == 0 || total >= 512) return NULL;
    char query[512];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) return NULL;
    if (httpd_query_key_value(query, key, buf, cap) != ESP_OK) return NULL;
    return buf;
}

/* ---------------- REST Handlers ---------------- */

esp_err_t handler_get_telemetry_current(httpd_req_t *req)
{
    char gh_id[40] = {0};
    const char *gh = query_value(req, "ghId", gh_id, sizeof(gh_id));
    cJSON *root = telemetry_mgr_get_current_ram_json(gh);
    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_telemetry_history(httpd_req_t *req)
{
    char gh_id[40] = {0};
    char after[32] = {0};
    char limit_buf[16] = {0};
    const char *gh = query_value(req, "ghId", gh_id, sizeof(gh_id));
    const char *cursor = query_value(req, "afterSequence", after, sizeof(after));
    if (!cursor) cursor = query_value(req, "cursor", after, sizeof(after));
    const char *limit_text = query_value(req, "limit", limit_buf, sizeof(limit_buf));
    int limit = limit_text ? atoi(limit_text) : 50;
    if (limit <= 0) limit = 50;
    if (limit > 100) limit = 100;

    cJSON *history = telemetry_mgr_get_history_json(gh, cursor, limit);
    return http_send_enveloped_response(req, 200, NULL, history);
}

esp_err_t handler_get_telemetry(httpd_req_t *req)
{
    char after[32] = {0};
    const char *cursor = query_value(req, "afterSequence", after, sizeof(after));
    if (!cursor) cursor = query_value(req, "cursor", after, sizeof(after));
    if (cursor && cursor[0]) {
        return handler_get_telemetry_history(req);
    }
    return handler_get_telemetry_current(req);
}

esp_err_t handler_get_events(httpd_req_t *req)
{
    char cursor[32] = {0};
    char limit_buf[16] = {0};
    const char *after = query_value(req, "afterSequence", cursor, sizeof(cursor));
    if (!after) after = query_value(req, "cursor", cursor, sizeof(cursor));
    const char *limit_text = query_value(req, "limit", limit_buf, sizeof(limit_buf));
    cJSON *root = event_mgr_get_events_json(after, limit_text ? atoi(limit_text) : 50);
    return http_send_enveloped_response(req, 200, NULL, root);
}

/* ---------------- WebSocket Telemetry Stream Implementation ---------------- */

static void ws_transfer_complete_cb(esp_err_t err, int socket, void *arg)
{
    ws_async_frame_t *frame = (ws_async_frame_t *)arg;
    if (frame) {
        if (frame->json_str) {
            free(frame->json_str);
        }
        free(frame);
    }
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "WS async send error %d on socket %d", err, socket);
    }
}

static void ws_client_add(int fd)
{
    if (!s_ws_mutex || fd < 0) return;
    xSemaphoreTake(s_ws_mutex, portMAX_DELAY);
    int empty_slot = -1;
    for (int i = 0; i < MAX_WS_CLIENTS; i++) {
        if (s_ws_clients[i].active && s_ws_clients[i].fd == fd) {
            xSemaphoreGive(s_ws_mutex);
            return;
        }
        if (!s_ws_clients[i].active && empty_slot == -1) {
            empty_slot = i;
        }
    }
    if (empty_slot != -1) {
        s_ws_clients[empty_slot].fd = fd;
        s_ws_clients[empty_slot].active = true;
        s_ws_clients[empty_slot].last_seq_sent = 0;
        ESP_LOGI(TAG, "Added WS client fd=%d at slot %d", fd, empty_slot);
    } else {
        ESP_LOGW(TAG, "Max WS clients reached (%d), cannot add fd=%d", MAX_WS_CLIENTS, fd);
    }
    xSemaphoreGive(s_ws_mutex);
}

static void ws_client_remove(int fd)
{
    if (!s_ws_mutex || fd < 0) return;
    xSemaphoreTake(s_ws_mutex, portMAX_DELAY);
    for (int i = 0; i < MAX_WS_CLIENTS; i++) {
        if (s_ws_clients[i].active && s_ws_clients[i].fd == fd) {
            s_ws_clients[i].active = false;
            ESP_LOGI(TAG, "Removed WS client fd=%d from slot %d", fd, i);
            break;
        }
    }
    xSemaphoreGive(s_ws_mutex);
}

static void ws_send_frame_to_fd(int fd, const char *json_str)
{
    if (!s_server_handle || fd < 0 || !json_str) return;

    if (httpd_ws_get_fd_info(s_server_handle, fd) != HTTPD_WS_CLIENT_WEBSOCKET) {
        return;
    }

    size_t len = strlen(json_str);
    ws_async_frame_t *frame_payload = malloc(sizeof(ws_async_frame_t));
    if (!frame_payload) {
        ESP_LOGE(TAG, "OOM allocating ws_async_frame_t");
        return;
    }

    frame_payload->json_str = strdup(json_str);
    if (!frame_payload->json_str) {
        free(frame_payload);
        ESP_LOGE(TAG, "OOM strdup frame payload");
        return;
    }
    frame_payload->len = len;

    httpd_ws_frame_t ws_frame = {
        .final = true,
        .fragmented = false,
        .type = HTTPD_WS_TYPE_TEXT,
        .payload = (uint8_t *)frame_payload->json_str,
        .len = len
    };

    esp_err_t err = httpd_ws_send_data_async(s_server_handle, fd, &ws_frame, ws_transfer_complete_cb, frame_payload);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "httpd_ws_send_data_async failed (0x%x) for fd %d", err, fd);
        free(frame_payload->json_str);
        free(frame_payload);
    }
}

static void ws_broadcast_batch(void)
{
    if (!s_server_handle) return;

    size_t max_clients = 10;
    int client_fds[10];
    if (httpd_get_client_list(s_server_handle, &max_clients, client_fds) != ESP_OK) {
        return;
    }

    /* Identify active WebSocket sessions */
    int ws_fds[MAX_WS_CLIENTS];
    int ws_count = 0;
    for (size_t i = 0; i < max_clients && ws_count < MAX_WS_CLIENTS; i++) {
        if (httpd_ws_get_fd_info(s_server_handle, client_fds[i]) == HTTPD_WS_CLIENT_WEBSOCKET) {
            ws_fds[ws_count++] = client_fds[i];
        }
    }

    if (ws_count == 0) return;

    cJSON *batch = telemetry_mgr_build_stream_batch_json(NULL, s_last_broadcast_seq, 16);
    if (!batch) return;

    cJSON *seq_end = cJSON_GetObjectItem(batch, "sequenceEnd");
    if (seq_end && cJSON_IsNumber(seq_end) && (uint64_t)seq_end->valuedouble > s_last_broadcast_seq) {
        s_last_broadcast_seq = (uint64_t)seq_end->valuedouble;
    }

    char *json_str = cJSON_PrintUnformatted(batch);
    cJSON_Delete(batch);
    if (!json_str) return;

    for (int i = 0; i < ws_count; i++) {
        ws_send_frame_to_fd(ws_fds[i], json_str);
    }

    free(json_str);
}

esp_err_t handler_telemetry_stream_ws(httpd_req_t *req)
{
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "WS handshake established on fd %d", httpd_req_to_sockfd(req));
        return ESP_OK;
    }

    httpd_ws_frame_t ws_pkt;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));
    ws_pkt.type = HTTPD_WS_TYPE_TEXT;

    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) {
        return ret;
    }

    if (ws_pkt.len > 0) {
        uint8_t *buf = calloc(1, ws_pkt.len + 1);
        if (buf) {
            ws_pkt.payload = buf;
            httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
            free(buf);
        }
    }

    cJSON *snap = telemetry_mgr_build_stream_batch_json(NULL, 0, 1);
    if (snap) {
        char *json = cJSON_PrintUnformatted(snap);
        cJSON_Delete(snap);
        if (json) {
            httpd_ws_frame_t resp_frame = {
                .final = true,
                .fragmented = false,
                .type = HTTPD_WS_TYPE_TEXT,
                .payload = (uint8_t *)json,
                .len = strlen(json)
            };
            httpd_ws_send_frame(req, &resp_frame);
            free(json);
        }
    }

    return ESP_OK;
}

void telemetry_stream_on_transition(const char *reason)
{
    ESP_LOGI(TAG, "Telemetry stream transition event: %s", reason ? reason : "unspecified");
    if (s_stream_task_handle) {
        xTaskNotifyGive(s_stream_task_handle);
    }
}

static void telemetry_stream_task(void *pvParameters)
{
    (void)pvParameters;
    ESP_LOGI(TAG, "Telemetry stream worker started.");

    uint32_t cycle = 0;
    while (1) {
        telemetry_active_process_t proc;
        telemetry_mgr_get_active_process(&proc);
        int cadence_sec = (proc.is_active && proc.cadence_sec > 0) ? proc.cadence_sec : 10;

        /* Wait for periodic cadence timeout or immediate notification on state transition */
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(cadence_sec * 1000));

        ws_broadcast_batch();

        /* HEAP-AUDIT (2026-09-28): report stack high-water mark + internal
         * heap watermarks every ~60s. A stack_hwm of 0 means this task has
         * PROVABLY overflowed its stack -- that is the evidence required
         * before any task stack size may be changed. */
        if (++cycle % 6 == 0) {
            UBaseType_t hwm = uxTaskGetStackHighWaterMark(NULL);
            ESP_LOGW(TAG, "MEM tele_stream_task stack_hwm=%u B free_int=%u largest=%u min_free=%u",
                     (unsigned)(hwm * sizeof(StackType_t)),
                     (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                     (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL),
                     (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL));
        }
    }
}

void telemetry_stream_init(httpd_handle_t server)
{
    s_server_handle = server;
    if (!s_ws_mutex) {
        s_ws_mutex = xSemaphoreCreateMutex();
    }

    for (int i = 0; i < MAX_WS_CLIENTS; i++) {
        s_ws_clients[i].fd = -1;
        s_ws_clients[i].active = false;
        s_ws_clients[i].last_seq_sent = 0;
    }

    if (!s_stream_task_handle) {
        psram_task_create_pinned(telemetry_stream_task, "tele_stream_task", 4096, NULL, TASK_TELEMETRY_PRIO, &s_stream_task_handle, 0);
    }
    ESP_LOGI(TAG, "Telemetry WebSocket streaming worker initialized.");
}
