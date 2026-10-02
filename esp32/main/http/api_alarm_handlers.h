#pragma once

#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t handler_get_alarms(httpd_req_t *req);
esp_err_t handler_post_alarm_acknowledge(httpd_req_t *req);
esp_err_t handler_post_alarm_silence(httpd_req_t *req);
esp_err_t handler_post_alarm_test(httpd_req_t *req);

void register_api_alarm_handlers(httpd_handle_t server);

#ifdef __cplusplus
}
#endif
