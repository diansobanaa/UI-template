#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "services/telemetry_mgr.h"
#include "services/event_mgr.h"
#include "cJSON.h"

esp_err_t handler_get_telemetry(httpd_req_t *req)
{
    cJSON *root = telemetry_mgr_to_json("gh-01");
    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_get_events(httpd_req_t *req)
{
    cJSON *root = event_mgr_get_events_json(NULL, 50);
    return http_send_enveloped_response(req, 200, NULL, root);
}
