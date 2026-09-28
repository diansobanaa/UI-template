#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "services/crop_cycle_mgr.h"
#include "cJSON.h"
#include "esp_log.h"
#include <string.h>
#include <stdbool.h>

static const char *TAG = "CROPCYCLE_API";

static esp_err_t validate_gh_id(httpd_req_t *req, char *gh_id, size_t max_len) {
    const char *prefix = "/api/v1/greenhouses/";
    if (strncmp(req->uri, prefix, strlen(prefix)) != 0) return ESP_FAIL;
    const char *start = req->uri + strlen(prefix);
    const char *end = strchr(start, '/');
    if (!end) end = start + strlen(start);
    size_t len = end - start;
    if (len == 0 || len >= max_len) return ESP_FAIL;
    strncpy(gh_id, start, len);
    gh_id[len] = '\0';

    /* GH identity is configuration-driven; the manager stores state per GH. */
    return ESP_OK;
}

esp_err_t handler_get_crop_cycle(httpd_req_t *req)
{
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    cJSON *root = crop_cycle_mgr_to_json(&record);
    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_list_crop_cycles(httpd_req_t *req)
{
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    cJSON *items = NULL;
    if (crop_cycle_mgr_list(gh_id, &items) != ESP_OK || !items) return http_send_error(req, 500, "HISTORY_UNAVAILABLE", "Failed to load crop cycle history", NULL);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddItemToObject(root, "items", items);
    cJSON_AddNumberToObject(root, "total", (double)cJSON_GetArraySize(items));
    cJSON_AddNullToObject(root, "nextCursor");
    return http_send_enveloped_response(req, 200, NULL, root);
}

esp_err_t handler_start_crop_cycle(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK; // Response already sent
    }
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    char req_id[64] = "";
    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id_ptr);
    }

    cJSON *tanam = cJSON_GetObjectItem(payload, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required in payload", req_id_ptr);
    }

    const char *variety = NULL;
    cJSON *v = cJSON_GetObjectItem(payload, "variety");
    if (v && cJSON_IsString(v)) variety = v->valuestring;

    uint32_t count = 0;
    cJSON *p = cJSON_GetObjectItem(payload, "plantCount");
    if (p && cJSON_IsNumber(p)) count = (uint32_t)p->valuedouble;

    const char *notes = NULL;
    cJSON *n = cJSON_GetObjectItem(payload, "notes");
    if (n && cJSON_IsString(n)) notes = n->valuestring;

    err = crop_cycle_mgr_start(gh_id, tanam->valuestring, variety, count, notes);
    cJSON_Delete(body);

    if (err == ESP_ERR_INVALID_STATE) {
        return http_send_error(req, 409, "CONFLICT", "An active cycle already exists in this greenhouse", req_id_ptr);
    } else if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to start cycle", req_id_ptr);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 201, req_id_ptr, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_import_active_crop_cycle(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK;
    }
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    char req_id[64] = "";
    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id_ptr);
    }

    cJSON *tanam = cJSON_GetObjectItem(payload, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required in payload", req_id_ptr);
    }

    const char *pol = NULL;
    cJSON *p = cJSON_GetObjectItem(payload, "tanggalPolinasi");
    if (p && cJSON_IsString(p)) pol = p->valuestring;

    const char *variety = NULL;
    cJSON *v = cJSON_GetObjectItem(payload, "variety");
    if (v && cJSON_IsString(v)) variety = v->valuestring;

    uint32_t count = 0;
    cJSON *pc = cJSON_GetObjectItem(payload, "plantCount");
    if (pc && cJSON_IsNumber(pc)) count = (uint32_t)pc->valuedouble;

    const char *notes = NULL;
    cJSON *n = cJSON_GetObjectItem(payload, "notes");
    if (n && cJSON_IsString(n)) notes = n->valuestring;

    err = crop_cycle_mgr_import_active(gh_id, tanam->valuestring, pol, variety, count, notes);
    cJSON_Delete(body);

    if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to import active cycle", req_id_ptr);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 201, req_id_ptr, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_record_pollination(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK;
    }
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    char req_id[64] = "";
    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id_ptr);
    }

    cJSON *pol = cJSON_GetObjectItem(payload, "tanggalPolinasi");
    if (!pol || !cJSON_IsString(pol)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalPolinasi is required in payload", req_id_ptr);
    }

    const char *method = "manual";
    cJSON *m = cJSON_GetObjectItem(payload, "pollinationMethod");
    if (m && cJSON_IsString(m)) method = m->valuestring;

    // Parse expectedVersion for optimistic concurrency (ESP32_BACKEND_SPEC §28).
    cJSON *ev = cJSON_GetObjectItem(payload, "expectedVersion");
    uint32_t expected_version = (ev && cJSON_IsNumber(ev)) ? (uint32_t)ev->valuedouble : 0;

    err = crop_cycle_mgr_set_pollination_with_version(gh_id, pol->valuestring, method, expected_version);
    cJSON_Delete(body);

    if (err == ESP_ERR_INVALID_VERSION) {
        return http_send_error(req, 409, "VERSION_CONFLICT",
                               "Crop cycle version mismatch — another update occurred. Refresh and retry.", req_id_ptr);
    }
    if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalPolinasi cannot be earlier than tanggalTanam", req_id_ptr);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id_ptr, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_update_pollination(httpd_req_t *req)
{
    return handler_record_pollination(req);
}

esp_err_t handler_delete_pollination(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK;
    }
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    char req_id_buf[64] = "none";
    if (httpd_req_get_url_query_str(req, req_id_buf, sizeof(req_id_buf)) == ESP_OK) {
        char val[64];
        if (httpd_query_key_value(req_id_buf, "requestId", val, sizeof(val)) == ESP_OK) {
            strncpy(req_id_buf, val, sizeof(req_id_buf) - 1);
        } else {
            strcpy(req_id_buf, "none");
        }
    }
    const char *req_id = (strcmp(req_id_buf, "none") != 0) ? req_id_buf : NULL;

    // delete_pollination may also receive an expectedVersion via query param or body.
    // For DELETE, body is optional; parse if present.
    uint32_t expected_version = 0;
    cJSON *body = NULL;
    if (http_parse_json_body(req, &body) == ESP_OK && body) {
        cJSON *payload = cJSON_GetObjectItem(body, "payload");
        cJSON *ev = cJSON_GetObjectItem(payload ? payload : body, "expectedVersion");
        if (ev && cJSON_IsNumber(ev)) expected_version = (uint32_t)ev->valuedouble;
        cJSON_Delete(body);
    }

    esp_err_t err = crop_cycle_mgr_delete_pollination_with_version(gh_id, expected_version);
    if (err == ESP_ERR_INVALID_VERSION) {
        return http_send_error(req, 409, "VERSION_CONFLICT",
                               "Crop cycle version mismatch — another update occurred. Refresh and retry.", req_id);
    }
    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_update_planting_date(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK;
    }
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    char req_id[64] = "";
    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id_ptr);
    }

    cJSON *tanam = cJSON_GetObjectItem(payload, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required in payload", req_id_ptr);
    }

    // Parse expectedVersion for optimistic concurrency (ESP32_BACKEND_SPEC §28, UI_ESP32_COMMUNICATION_SPEC:821).
    // If absent or zero, the check is skipped (legacy behavior).
    cJSON *ev = cJSON_GetObjectItem(payload, "expectedVersion");
    uint32_t expected_version = (ev && cJSON_IsNumber(ev)) ? (uint32_t)ev->valuedouble : 0;

    err = crop_cycle_mgr_update_planting_date_with_version(gh_id, tanam->valuestring, expected_version);
    cJSON_Delete(body);

    if (err == ESP_ERR_INVALID_VERSION) {
        return http_send_error(req, 409, "VERSION_CONFLICT",
                               "Crop cycle version mismatch — another update occurred. Refresh and retry.", req_id_ptr);
    }
    if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to update planting date", req_id_ptr);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id_ptr, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_update_cycle_metadata(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK;
    }
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    char req_id[64] = "";
    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id_ptr);
    }

    const char *variety = NULL;
    cJSON *v = cJSON_GetObjectItem(payload, "variety");
    if (v && cJSON_IsString(v)) variety = v->valuestring;

    uint32_t count = 0;
    cJSON *p = cJSON_GetObjectItem(payload, "plantCount");
    if (p && cJSON_IsNumber(p)) count = (uint32_t)p->valuedouble;

    const char *notes = NULL;
    cJSON *n = cJSON_GetObjectItem(payload, "notes");
    if (n && cJSON_IsString(n)) notes = n->valuestring;

    uint32_t target_harvest_hst = 0;
    cJSON *th = cJSON_GetObjectItem(payload, "targetHarvestHst");
    if (th && cJSON_IsNumber(th) && th->valuedouble > 0) {
        target_harvest_hst = (uint32_t)th->valuedouble;
    }

    char *timeline_json_str = NULL;
    cJSON *tl = cJSON_GetObjectItem(payload, "cropTimelineConfig");
    if (tl && cJSON_IsObject(tl)) {
        timeline_json_str = cJSON_PrintUnformatted(tl);
    }

    // Parse expectedVersion for optimistic concurrency (ESP32_BACKEND_SPEC §28).
    cJSON *ev_meta = cJSON_GetObjectItem(payload, "expectedVersion");
    uint32_t expected_version_meta = (ev_meta && cJSON_IsNumber(ev_meta)) ? (uint32_t)ev_meta->valuedouble : 0;

    esp_err_t meta_err = crop_cycle_mgr_update_metadata_v2_with_version(gh_id, variety, count, notes, target_harvest_hst, timeline_json_str, expected_version_meta);
    if (timeline_json_str) {
        free(timeline_json_str);
    }
    cJSON_Delete(body);

    if (meta_err == ESP_ERR_INVALID_VERSION) {
        return http_send_error(req, 409, "VERSION_CONFLICT",
                               "Crop cycle version mismatch — another update occurred. Refresh and retry.", req_id_ptr);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id_ptr, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_cancel_crop_cycle(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK;
    }
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    cJSON *body = NULL;
    http_parse_json_body(req, &body);

    char req_id[64] = "";
    if (body) {
        cJSON *rq = cJSON_GetObjectItem(body, "requestId");
        if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
    }
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    uint32_t expected_version = 0;
    if (body) {
        cJSON *payload = cJSON_GetObjectItem(body, "payload");
        cJSON *ev = cJSON_GetObjectItem(payload ? payload : body, "expectedVersion");
        if (ev && cJSON_IsNumber(ev)) expected_version = (uint32_t)ev->valuedouble;
    }

    esp_err_t cancel_err = crop_cycle_mgr_cancel_with_version(gh_id, expected_version);
    if (body) cJSON_Delete(body);

    if (cancel_err == ESP_ERR_INVALID_VERSION) {
        return http_send_error(req, 409, "VERSION_CONFLICT",
                               "Crop cycle version mismatch — another update occurred. Refresh and retry.", req_id_ptr);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id_ptr, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_harvest_crop_cycle(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) {
        return ESP_OK;
    }
    char gh_id[32];
    esp_err_t err_gh = validate_gh_id(req, gh_id, sizeof(gh_id));
    if (err_gh == ESP_ERR_NOT_FOUND) {
        return http_send_error(req, 404, "NOT_FOUND", "Greenhouse ID not found or unsupported in Phase 1 topology", NULL);
    } else if (err_gh != ESP_OK) {
        return http_send_error(req, 400, "BAD_REQUEST", "Invalid greenhouse ID in URI", NULL);
    }
    cJSON *body = NULL;
    http_parse_json_body(req, &body);

    char req_id[64] = "";
    cJSON *payload = NULL;
    if (body) {
        cJSON *rq = cJSON_GetObjectItem(body, "requestId");
        if (rq && cJSON_IsString(rq)) snprintf(req_id, sizeof(req_id), "%s", rq->valuestring);
        payload = cJSON_GetObjectItem(body, "payload");
        if (!payload) {
            cJSON_Delete(body);
            return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id[0] ? req_id : NULL);
        }
    }
    const char *req_id_ptr = req_id[0] ? req_id : NULL;

    const char *harvest_date = NULL;
    float yield_kg = 0.0f;
    bool has_yield = false;
    const char *grade = NULL;
    const char *notes = NULL;

    uint32_t expected_version = 0;
    if (payload) {
        cJSON *d = cJSON_GetObjectItem(payload, "harvestDate");
        if (d && cJSON_IsString(d)) harvest_date = d->valuestring;
        cJSON *y = cJSON_GetObjectItem(payload, "yieldKg");
        if (y && cJSON_IsNumber(y)) { yield_kg = (float)y->valuedouble; has_yield = yield_kg >= 0.0f; }
        cJSON *g = cJSON_GetObjectItem(payload, "grade");
        if (g && cJSON_IsString(g)) grade = g->valuestring;
        cJSON *n = cJSON_GetObjectItem(payload, "notes");
        if (n && cJSON_IsString(n)) notes = n->valuestring;
        // Parse expectedVersion for optimistic concurrency (ESP32_BACKEND_SPEC §28).
        cJSON *ev = cJSON_GetObjectItem(payload, "expectedVersion");
        if (ev && cJSON_IsNumber(ev)) expected_version = (uint32_t)ev->valuedouble;
    }
    esp_err_t harvest_err = crop_cycle_mgr_harvest_with_version(gh_id, harvest_date, yield_kg, has_yield, grade, notes, expected_version);
    if (harvest_err == ESP_ERR_INVALID_VERSION) {
        if (body) cJSON_Delete(body);
        return http_send_error(req, 409, "VERSION_CONFLICT",
                               "Crop cycle version mismatch — another update occurred. Refresh and retry.", req_id_ptr);
    }
    if (harvest_err != ESP_OK) {
        if (body) cJSON_Delete(body);
        return http_send_error(req, 422, "HARVEST_FAILED", "No active crop cycle is available for harvest", req_id_ptr);
    }
    if (body) cJSON_Delete(body);

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id_ptr, crop_cycle_mgr_to_json(&record));
}
