#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "services/telemetry_mgr.h"
#include "services/event_mgr.h"
#include "cJSON.h"

esp_err_t handler_get_telemetry(httpd_req_t *req)
{
    char gh_id_param[32] = {0};
    const char *gh_id = NULL;
    
    size_t buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len > 1) {
        char *buf = malloc(buf_len);
        if (buf) {
            if (httpd_req_get_url_query_str(req, buf, buf_len) == ESP_OK) {
                if (httpd_query_key_value(buf, "ghId", gh_id_param, sizeof(gh_id_param)) == ESP_OK) {
                    gh_id = gh_id_param;
                }
            }
            free(buf);
        }
    }

    cJSON *root = telemetry_mgr_to_json(gh_id);
    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_events(httpd_req_t *req)
{
    cJSON *root = event_mgr_get_events_json(NULL, 50);
    return http_send_enveloped_response(req, 200, NULL, root);
}
