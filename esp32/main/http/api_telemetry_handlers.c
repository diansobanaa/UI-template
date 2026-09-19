#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "services/telemetry_mgr.h"
#include "services/event_mgr.h"
#include "cJSON.h"
#include <string.h>
#include <stdlib.h>

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

esp_err_t handler_get_telemetry(httpd_req_t *req)
{
    char gh_id[40] = {0};
    char after[32] = {0};
    char limit_buf[16] = {0};
    const char *gh = query_value(req, "ghId", gh_id, sizeof(gh_id));
    const char *cursor = query_value(req, "afterSequence", after, sizeof(after));
    const char *limit_text = query_value(req, "limit", limit_buf, sizeof(limit_buf));
    if (cursor && cursor[0]) {
        cJSON *history = telemetry_mgr_get_history_json(gh, cursor, limit_text ? atoi(limit_text) : 50);
        return http_send_enveloped_response(req, 200, NULL, history);
    }
    cJSON *root = telemetry_mgr_to_json(gh);
    return http_send_enveloped_response(req, 200, NULL, root);
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
