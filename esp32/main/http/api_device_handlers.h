#pragma once

#include "esp_http_server.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Device & System Handlers */
esp_err_t handler_get_health(httpd_req_t *req);
esp_err_t handler_get_status(httpd_req_t *req);
esp_err_t handler_get_inventory(httpd_req_t *req);
esp_err_t handler_get_capabilities(httpd_req_t *req);
esp_err_t handler_get_context(httpd_req_t *req);
esp_err_t handler_get_clock(httpd_req_t *req);
esp_err_t handler_post_clock_sync(httpd_req_t *req);

/* Configuration Handlers */
esp_err_t handler_get_configuration(httpd_req_t *req);
esp_err_t handler_put_configuration(httpd_req_t *req);
esp_err_t handler_validate_configuration(httpd_req_t *req);
esp_err_t handler_commit_configuration(httpd_req_t *req);
esp_err_t handler_rollback_configuration(httpd_req_t *req);

esp_err_t handler_post_command(httpd_req_t *req);
esp_err_t handler_get_command(httpd_req_t *req);
esp_err_t handler_delete_command(httpd_req_t *req);
esp_err_t handler_emergency_stop(httpd_req_t *req);

/* Crop Cycle Handlers */
esp_err_t handler_get_crop_cycle(httpd_req_t *req);
esp_err_t handler_list_crop_cycles(httpd_req_t *req);
esp_err_t handler_start_crop_cycle(httpd_req_t *req);
esp_err_t handler_import_active_crop_cycle(httpd_req_t *req);
esp_err_t handler_record_pollination(httpd_req_t *req);
esp_err_t handler_update_pollination(httpd_req_t *req);
esp_err_t handler_delete_pollination(httpd_req_t *req);
esp_err_t handler_update_planting_date(httpd_req_t *req);
esp_err_t handler_update_cycle_metadata(httpd_req_t *req);
esp_err_t handler_cancel_crop_cycle(httpd_req_t *req);
esp_err_t handler_harvest_crop_cycle(httpd_req_t *req);

/* Telemetry & Events Handlers */
esp_err_t handler_get_telemetry(httpd_req_t *req);
esp_err_t handler_get_events(httpd_req_t *req);

/* Universal OPTIONS Preflight Handler */
esp_err_t handler_options_preflight(httpd_req_t *req);

#ifdef __cplusplus
}
#endif
