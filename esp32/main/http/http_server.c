#include "http/http_server.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "http/api_device_handlers.h"
#include "http/api_telemetry_handlers.h"
#include "http/setup_handlers.h"
#include <stdlib.h>
#include <string.h>
#include <time.h>

static const char *TAG = "HTTP_SERVER";
static httpd_handle_t s_server = NULL;

extern void register_api_calibration_handlers(httpd_handle_t server);
extern void register_api_schedule_handlers(httpd_handle_t server);
extern void register_api_fertigation_handlers(httpd_handle_t server);
extern void register_api_recipe_handlers(httpd_handle_t server);
extern void register_api_export_handlers(httpd_handle_t server);

#include "nvs.h"
#include "nvs_flash.h"

esp_err_t http_check_auth(httpd_req_t *req) {
  // PRD-NET-001 / ESP32_BACKEND_SPEC §8 / §39 (Explicit Non-Goal):
  //   "no authentication; trusted local network" (MVP).
  // The previous implementation enforced a hardcoded Bearer token
  //   "agrotech-secret-key" (or NVS-overridden "api_key") on 39 endpoints,
  //   which silently blocked all UI POST/PUT/PATCH/DELETE that did not
  //   send an Authorization header — including first-time onboarding,
  //   equipment commissioning, schedule deployment and crop-cycle edits.
  //
  // Per spec, authentication is an Explicit Non-Goal for the MVP runtime,
  //   and topology-pool peer auth (POST /topology-pool/sync & /mutate) is
  //   the ONLY place where a Bearer token is mandated (see
  //   api_device_handlers.c register_api_topology_pool_handlers — those
  //   routes still call http_check_auth_peer() below).
  //
  // This function is now a no-op for the public API surface. Peer auth is
  //   retained separately via http_check_auth_peer() so topology mutations
  //   remain protected.
  (void)req;
  return ESP_OK;
}

esp_err_t http_check_auth_peer(httpd_req_t *req) {
  // Peer auth for topology-pool /sync & /mutate only.
  // Token comes exclusively from NVS key "api_key" (provisioned via
  //   /setup embedded web UI during factory first-boot). There is NO
  //   default token — if "api_key" is not provisioned, peer mutation is
  //   rejected with 503 SERVICE_UNAVAILABLE so the operator knows to
  //   complete provisioning.
  char buf[128];
  esp_err_t err =
      httpd_req_get_hdr_value_str(req, "Authorization", buf, sizeof(buf));
  if (err != ESP_OK) {
    http_send_error(req, 401, "UNAUTHORIZED",
                    "Missing Authorization header for peer mutation", NULL);
    return ESP_FAIL;
  }

  if (strncmp(buf, "Bearer ", 7) != 0) {
    http_send_error(req, 401, "UNAUTHORIZED", "Invalid token format", NULL);
    return ESP_FAIL;
  }

  const char *token = buf + 7;

  char stored_token[64] = {0};
  bool has_token = false;
  nvs_handle_t handle;
  if (nvs_open("agrotech", NVS_READONLY, &handle) == ESP_OK) {
    size_t len = sizeof(stored_token);
    if (nvs_get_str(handle, "api_key", stored_token, &len) == ESP_OK &&
        stored_token[0] != '\0') {
      has_token = true;
    }
    nvs_close(handle);
  }

  if (!has_token) {
    http_send_error(req, 503, "PEER_AUTH_NOT_PROVISIONED",
                    "Peer auth not provisioned; complete /setup first", NULL);
    return ESP_FAIL;
  }

  if (strcmp(token, stored_token) != 0) {
    http_send_error(req, 401, "UNAUTHORIZED", "Invalid peer API key", NULL);
    return ESP_FAIL;
  }

  return ESP_OK;
}

esp_err_t http_send_cors_headers(httpd_req_t *req) {
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Methods",
                     "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Headers",
                     "Content-Type, Authorization, X-Request-ID, Accept, "
                     "Cache-Control, Pragma");
  httpd_resp_set_hdr(req, "Access-Control-Max-Age", "86400");
  return ESP_OK;
}

esp_err_t handler_options_preflight(httpd_req_t *req) {
  http_send_cors_headers(req);
  httpd_resp_set_status(req, "204 No Content");
  httpd_resp_send(req, NULL, 0);
  return ESP_OK;
}

esp_err_t http_send_error(httpd_req_t *req, int status_code, const char *code,
                          const char *message, const char *request_id) {
  cJSON *root = cJSON_CreateObject();

  char req_id_buf[64] = "none";
  if (request_id) {
    strncpy(req_id_buf, request_id, sizeof(req_id_buf) - 1);
    req_id_buf[sizeof(req_id_buf) - 1] = '\0';
  } else {
    if (httpd_req_get_hdr_value_str(req, "X-Request-ID", req_id_buf,
                                    sizeof(req_id_buf)) != ESP_OK) {
      static uint32_t s_err_req_counter = 0;
      snprintf(req_id_buf, sizeof(req_id_buf), "req-%lu",
               (unsigned long)++s_err_req_counter);
    }
    req_id_buf[sizeof(req_id_buf) - 1] = '\0';
  }
  for (int i = 0; req_id_buf[i] != '\0'; i++) {
    if ((unsigned char)req_id_buf[i] < 32 ||
        (unsigned char)req_id_buf[i] > 126) {
      req_id_buf[i] = '?';
    }
  }
  cJSON_AddStringToObject(root, "requestId", req_id_buf);
  cJSON_AddBoolToObject(root, "success", false);

  char time_str[32] = "1970-01-01T00:00:00Z";
  time_t now;
  time(&now);
  struct tm tm_info;
  gmtime_r(&now, &tm_info);
  strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", &tm_info);
  cJSON_AddStringToObject(root, "deviceTimestamp", time_str);

  cJSON *err_obj = cJSON_AddObjectToObject(root, "error");
  cJSON_AddStringToObject(err_obj, "code", code ? code : "INTERNAL_ERROR");
  cJSON_AddStringToObject(err_obj, "message",
                          message ? message : "An error occurred");
  cJSON_AddBoolToObject(err_obj, "retryable",
                        (status_code >= 500) || (status_code == 429) ||
                            (status_code == 503));
  cJSON_AddBoolToObject(err_obj, "reconcileRequired", (status_code == 409));

  return http_send_json_response(req, status_code, root);
}

esp_err_t http_send_json_response(httpd_req_t *req, int status_code,
                                  cJSON *json_root) {
  http_send_cors_headers(req);
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Cache-Control",
                     "no-store, no-cache, must-revalidate, max-age=0");
  httpd_resp_set_hdr(req, "Pragma", "no-cache");

  char status_str[32];
  snprintf(status_str, sizeof(status_str), "%d %s", status_code,
           status_code == 200   ? "OK"
           : status_code == 201 ? "Created"
           : status_code == 202 ? "Accepted"
           : status_code == 204 ? "No Content"
           : status_code == 400 ? "Bad Request"
           : status_code == 404 ? "Not Found"
           : status_code == 409 ? "Conflict"
           : status_code == 422 ? "Unprocessable Entity"
                                : "Error");
  httpd_resp_set_status(req, status_str);

  char *rendered = cJSON_PrintUnformatted(json_root);
  cJSON_Delete(json_root);

  if (!rendered) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  esp_err_t ret = httpd_resp_send(req, rendered, strlen(rendered));
  free(rendered);
  return ret;
}

esp_err_t http_send_enveloped_response(httpd_req_t *req, int status_code,
                                       const char *req_id,
                                       cJSON *data_payload) {
  cJSON *root = cJSON_CreateObject();

  char req_id_buf[64] = "none";
  if (req_id) {
    strncpy(req_id_buf, req_id, sizeof(req_id_buf) - 1);
    req_id_buf[sizeof(req_id_buf) - 1] = '\0';
  } else {
    if (httpd_req_get_hdr_value_str(req, "X-Request-ID", req_id_buf,
                                    sizeof(req_id_buf)) != ESP_OK) {
      static uint32_t s_req_counter = 0;
      snprintf(req_id_buf, sizeof(req_id_buf), "req-%lu",
               (unsigned long)++s_req_counter);
    }
    req_id_buf[sizeof(req_id_buf) - 1] = '\0';
  }
  for (int i = 0; req_id_buf[i] != '\0'; i++) {
    if ((unsigned char)req_id_buf[i] < 32 ||
        (unsigned char)req_id_buf[i] > 126) {
      req_id_buf[i] = '?';
    }
  }
  cJSON_AddStringToObject(root, "requestId", req_id_buf);
  cJSON_AddBoolToObject(root, "success", true);

  char time_str[32] = "1970-01-01T00:00:00Z";
  time_t now;
  time(&now);
  struct tm tm_info;
  gmtime_r(&now, &tm_info);
  strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", &tm_info);
  cJSON_AddStringToObject(root, "deviceTimestamp", time_str);

  if (data_payload) {
    cJSON_AddItemToObject(root, "data", data_payload);
  } else {
    cJSON_AddNullToObject(root, "data");
  }

  return http_send_json_response(req, status_code, root);
}

esp_err_t http_parse_json_body(httpd_req_t *req, cJSON **out_json) {
  if (!out_json)
    return ESP_ERR_INVALID_ARG;
  *out_json = NULL;

  size_t total_len = req->content_len;
  if (total_len == 0)
    return ESP_ERR_INVALID_SIZE;
  if (total_len > 16384)
    return ESP_ERR_NO_MEM; // SP-REMED-004 Memory Bounds — 16KB for
                           // configuration payloads

  char *buf = (char *)heap_caps_malloc(total_len + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!buf) {
    buf = (char *)malloc(total_len + 1);
  }
  if (!buf)
    return ESP_ERR_NO_MEM;

  int received = 0;
  while (received < total_len) {
    int r = httpd_req_recv(req, buf + received, total_len - received);
    if (r <= 0) {
      free(buf);
      return ESP_FAIL;
    }
    received += r;
  }
  buf[total_len] = '\0';

  cJSON *parsed = cJSON_Parse(buf);
  free(buf);

  if (!parsed) {
    return ESP_ERR_INVALID_ARG;
  }

  *out_json = parsed;
  return ESP_OK;
}

static bool http_uri_match_wildcard_custom(const char *pattern, const char *uri,
                                           size_t match_upto) {
  (void)match_upto;
  if (!pattern || !uri)
    return false;
  while (*pattern && *uri) {
    if (*pattern == '?') {
      pattern++;
      if (*uri == '/')
        uri++;
    } else if (*pattern == '*') {
      pattern++;
      if (!*pattern)
        return true;
      while (*uri) {
        if (http_uri_match_wildcard_custom(pattern, uri, 0))
          return true;
        uri++;
      }
      return false;
    } else if (*pattern == *uri) {
      pattern++;
      uri++;
    } else {
      return false;
    }
  }
  while (*pattern == '*')
    pattern++;
  if (*pattern == '\0' && (*uri == '\0' || *uri == '?'))
    return true;
  return (*pattern == '\0' && *uri == '\0');
}

esp_err_t http_server_start(void) {
  if (s_server)
    return ESP_OK;

  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = DEFAULT_HTTP_PORT;
  config.max_uri_handlers =
      80; // Accommodate all ~68 canonical OpenAPI and setup endpoints
  config.stack_size = TASK_HTTP_SERVER_STACK;
  config.uri_match_fn = http_uri_match_wildcard_custom;
  config.core_id = 0;
  config.max_open_sockets = 7;
  config.backlog_conn = 8;
  config.lru_purge_enable = true;
  config.recv_wait_timeout = 5;
  config.send_wait_timeout = 5;

  ESP_LOGI(TAG, "Starting HTTP Server on port %d...", config.server_port);
  esp_err_t ret = httpd_start(&s_server, &config);
  if (ret != ESP_OK) {
    ESP_LOGE(TAG, "Failed to start HTTP server (0x%x)", ret);
    return ret;
  }

  /* ---------------- Register All Canonical Routes ---------------- */

  /* Universal OPTIONS handler for CORS preflight */
  httpd_uri_t uri_options = {.uri = "/api/*",
                             .method = HTTP_OPTIONS,
                             .handler = handler_options_preflight,
                             .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_options);

  /* Device / System */
  httpd_uri_t uri_health = {.uri = "/api/v1/health",
                            .method = HTTP_GET,
                            .handler = handler_get_health,
                            .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_health);

  httpd_uri_t uri_status = {.uri = "/api/v1/status",
                            .method = HTTP_GET,
                            .handler = handler_get_status,
                            .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_status);

  httpd_uri_t uri_bind = {.uri = "/api/v1/device/bind",
                          .method = HTTP_POST,
                          .handler = handler_post_device_bind,
                          .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_bind);

  httpd_uri_t uri_retire = {.uri = "/api/v1/device/retire",
                            .method = HTTP_POST,
                            .handler = handler_post_device_retire,
                            .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_retire);

  httpd_uri_t uri_inv = {.uri = "/api/v1/inventory",
                         .method = HTTP_GET,
                         .handler = handler_get_inventory,
                         .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_inv);

  httpd_uri_t uri_cap = {.uri = "/api/v1/capabilities",
                         .method = HTTP_GET,
                         .handler = handler_get_capabilities,
                         .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cap);

  httpd_uri_t uri_topology_cap = {.uri = "/api/v1/topology-capabilities",
                                  .method = HTTP_GET,
                                  .handler = handler_get_topology_capabilities,
                                  .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_topology_cap);

  httpd_uri_t uri_ctx = {.uri = "/api/v1/context",
                         .method = HTTP_GET,
                         .handler = handler_get_context,
                         .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_ctx);

  /* System Topology Pool */
  httpd_uri_t uri_pool_get = {.uri = "/api/v1/topology-pool",
                              .method = HTTP_GET,
                              .handler = handler_get_topology_pool,
                              .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_pool_get);

  httpd_uri_t uri_pool_meta = {.uri = "/api/v1/topology-pool/meta",
                               .method = HTTP_GET,
                               .handler = handler_get_topology_pool_meta,
                               .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_pool_meta);

  httpd_uri_t uri_pool_sync = {.uri = "/api/v1/topology-pool/sync",
                               .method = HTTP_POST,
                               .handler = handler_post_topology_pool_sync,
                               .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_pool_sync);

  httpd_uri_t uri_pool_mutate = {.uri = "/api/v1/topology-pool/mutate",
                                 .method = HTTP_POST,
                                 .handler = handler_post_topology_pool_mutate,
                                 .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_pool_mutate);

  httpd_uri_t uri_clock_get = {.uri = "/api/v1/clock",
                               .method = HTTP_GET,
                               .handler = handler_get_clock,
                               .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_clock_get);

  httpd_uri_t uri_clock_sync = {.uri = "/api/v1/clock-sync",
                                .method = HTTP_POST,
                                .handler = handler_post_clock_sync,
                                .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_clock_sync);

  /* Configuration */
  httpd_uri_t uri_cfg_get = {.uri = "/api/v1/configuration",
                             .method = HTTP_GET,
                             .handler = handler_get_configuration,
                             .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cfg_get);

  httpd_uri_t uri_cfg_dep = {.uri = "/api/v1/configuration/deployment",
                             .method = HTTP_GET,
                             .handler = handler_get_configuration_deployment,
                             .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cfg_dep);

  httpd_uri_t uri_cfg_put = {.uri = "/api/v1/configuration",
                             .method = HTTP_PUT,
                             .handler = handler_put_configuration,
                             .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cfg_put);

  httpd_uri_t uri_cfg_val = {.uri = "/api/v1/configuration/validate",
                             .method = HTTP_POST,
                             .handler = handler_validate_configuration,
                             .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cfg_val);

  httpd_uri_t uri_cfg_deploy = {.uri = "/api/v1/configuration/deploy",
                                .method = HTTP_POST,
                                .handler = handler_deploy_configuration,
                                .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cfg_deploy);

  httpd_uri_t uri_cfg_rollback = {.uri = "/api/v1/configuration/rollback",
                                  .method = HTTP_POST,
                                  .handler = handler_rollback_configuration,
                                  .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cfg_rollback);

  /* Commands */
  httpd_uri_t uri_cmd_post = {.uri = "/api/v1/commands",
                              .method = HTTP_POST,
                              .handler = handler_post_command,
                              .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cmd_post);

  httpd_uri_t uri_cmd_estop = {.uri = "/api/v1/commands/emergency-stop",
                               .method = HTTP_POST,
                               .handler = handler_emergency_stop,
                               .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cmd_estop);

  httpd_uri_t uri_cmd_get = {.uri = "/api/v1/commands/*",
                             .method = HTTP_GET,
                             .handler = handler_get_command,
                             .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cmd_get);

  httpd_uri_t uri_cmd_del = {.uri = "/api/v1/commands/*",
                             .method = HTTP_DELETE,
                             .handler = handler_delete_command,
                             .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cmd_del);

  /* Telemetry & Events */
  httpd_uri_t uri_telemetry = {.uri = "/api/v1/telemetry",
                               .method = HTTP_GET,
                               .handler = handler_get_telemetry,
                               .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_telemetry);

  httpd_uri_t uri_telemetry_current = {.uri = "/api/v1/telemetry/current",
                                       .method = HTTP_GET,
                                       .handler = handler_get_telemetry_current,
                                       .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_telemetry_current);

  httpd_uri_t uri_telemetry_history = {.uri = "/api/v1/telemetry/history",
                                       .method = HTTP_GET,
                                       .handler = handler_get_telemetry_history,
                                       .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_telemetry_history);

  httpd_uri_t uri_telemetry_stream = {.uri = "/api/v1/telemetry/stream",
                                      .method = HTTP_GET,
                                      .handler = handler_telemetry_stream_ws,
                                      .user_ctx = NULL,
                                      .is_websocket = true};
  httpd_register_uri_handler(s_server, &uri_telemetry_stream);

  httpd_uri_t uri_events = {.uri = "/api/v1/events",
                            .method = HTTP_GET,
                            .handler = handler_get_events,
                            .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_events);

  /* Crop Cycle Routes */
  httpd_uri_t uri_cc_get = {.uri = "/api/v1/greenhouses/*/crop-cycle",
                            .method = HTTP_GET,
                            .handler = handler_get_crop_cycle,
                            .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_get);

  httpd_uri_t uri_cc_import = {
      .uri = "/api/v1/greenhouses/*/crop-cycles/import-active",
      .method = HTTP_POST,
      .handler = handler_import_active_crop_cycle,
      .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_import);

  httpd_uri_t uri_cc_list = {.uri = "/api/v1/greenhouses/*/crop-cycles",
                             .method = HTTP_GET,
                             .handler = handler_list_crop_cycles,
                             .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_list);

  httpd_uri_t uri_cc_start = {.uri = "/api/v1/greenhouses/*/crop-cycles",
                              .method = HTTP_POST,
                              .handler = handler_start_crop_cycle,
                              .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_start);

  httpd_uri_t uri_cc_poll_post = {
      .uri = "/api/v1/greenhouses/*/crop-cycles/*/pollination",
      .method = HTTP_POST,
      .handler = handler_record_pollination,
      .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_poll_post);

  httpd_uri_t uri_cc_poll_patch = {
      .uri = "/api/v1/greenhouses/*/crop-cycles/*/pollination",
      .method = HTTP_PATCH,
      .handler = handler_update_pollination,
      .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_poll_patch);

  httpd_uri_t uri_cc_poll_del = {
      .uri = "/api/v1/greenhouses/*/crop-cycles/*/pollination",
      .method = HTTP_DELETE,
      .handler = handler_delete_pollination,
      .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_poll_del);

  httpd_uri_t uri_cc_plant_patch = {
      .uri = "/api/v1/greenhouses/*/crop-cycles/*/planting-date",
      .method = HTTP_PATCH,
      .handler = handler_update_planting_date,
      .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_plant_patch);

  httpd_uri_t uri_cc_meta_patch = {.uri = "/api/v1/greenhouses/*/crop-cycles/*",
                                   .method = HTTP_PATCH,
                                   .handler = handler_update_cycle_metadata,
                                   .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_meta_patch);

  httpd_uri_t uri_cc_cancel = {.uri =
                                   "/api/v1/greenhouses/*/crop-cycles/*/cancel",
                               .method = HTTP_POST,
                               .handler = handler_cancel_crop_cycle,
                               .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_cancel);

  httpd_uri_t uri_cc_harvest = {
      .uri = "/api/v1/greenhouses/*/crop-cycles/*/harvest",
      .method = HTTP_POST,
      .handler = handler_harvest_crop_cycle,
      .user_ctx = NULL};
  httpd_register_uri_handler(s_server, &uri_cc_harvest);

  register_setup_handlers(s_server);
  register_api_calibration_handlers(s_server);
  register_api_schedule_handlers(s_server);
  register_api_fertigation_handlers(s_server);
  register_api_recipe_handlers(s_server);
  register_api_export_handlers(s_server);
  telemetry_stream_init(s_server);

  ESP_LOGI(TAG, "HTTP Server successfully started with all canonical OpenAPI "
                "routes registered.");
  return ESP_OK;
}

esp_err_t http_server_stop(void) {
  if (s_server) {
    httpd_stop(s_server);
    s_server = NULL;
  }
  return ESP_OK;
}

bool http_server_is_running(void) { return (s_server != NULL); }

httpd_handle_t http_server_get_handle(void) { return s_server; }
