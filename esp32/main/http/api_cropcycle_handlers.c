#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "services/crop_cycle_mgr.h"
#include "services/configuration_mgr.h"
#include "cJSON.h"
#include "esp_log.h"
#include <string.h>

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

    const active_configuration_t *cfg = configuration_mgr_get_active();
    if (cfg) {
        bool found = false;
        for (size_t i = 0; i < cfg->greenhouse_count; i++) {
            if (strcmp(cfg->greenhouses[i].gh_id, gh_id) == 0) {
                found = true;
                break;
            }
        }
        if (!found && cfg->greenhouse_count > 0) {
            return ESP_ERR_NOT_FOUND;
        }
    }

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
    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);

    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");
    cJSON_AddItemToArray(items, crop_cycle_mgr_to_json(&record));
    cJSON_AddNumberToObject(root, "total", 1);
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

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *tanam = cJSON_GetObjectItem(payload, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required in payload", req_id);
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
        return http_send_error(req, 409, "CONFLICT", "An active cycle already exists in this greenhouse", req_id);
    } else if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to start cycle", req_id);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 201, req_id, crop_cycle_mgr_to_json(&record));
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

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *tanam = cJSON_GetObjectItem(payload, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required in payload", req_id);
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
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to import active cycle", req_id);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 201, req_id, crop_cycle_mgr_to_json(&record));
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

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *pol = cJSON_GetObjectItem(payload, "tanggalPolinasi");
    if (!pol || !cJSON_IsString(pol)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalPolinasi is required in payload", req_id);
    }

    const char *method = "manual";
    cJSON *m = cJSON_GetObjectItem(payload, "pollinationMethod");
    if (m && cJSON_IsString(m)) method = m->valuestring;

    err = crop_cycle_mgr_set_pollination(gh_id, pol->valuestring, method);
    cJSON_Delete(body);

    if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalPolinasi cannot be earlier than tanggalTanam", req_id);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id, crop_cycle_mgr_to_json(&record));
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

    crop_cycle_mgr_delete_pollination(gh_id);
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

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
    }

    cJSON *tanam = cJSON_GetObjectItem(payload, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required in payload", req_id);
    }

    err = crop_cycle_mgr_update_planting_date(gh_id, tanam->valuestring);
    cJSON_Delete(body);

    if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to update planting date", req_id);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id, crop_cycle_mgr_to_json(&record));
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

    cJSON *rq = cJSON_GetObjectItem(body, "requestId");
    const char *req_id = (rq && cJSON_IsString(rq)) ? rq->valuestring : NULL;

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    if (!payload) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
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

    crop_cycle_mgr_update_metadata(gh_id, variety, count, notes);
    cJSON_Delete(body);

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id, crop_cycle_mgr_to_json(&record));
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

    const char *req_id = NULL;
    if (body) {
        cJSON *rq = cJSON_GetObjectItem(body, "requestId");
        if (rq && cJSON_IsString(rq)) req_id = rq->valuestring;
    }

    crop_cycle_mgr_cancel(gh_id);
    if (body) cJSON_Delete(body);

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id, crop_cycle_mgr_to_json(&record));
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

    cJSON *rq = NULL;
    const char *req_id = NULL;
    cJSON *payload = NULL;
    if (body) {
        rq = cJSON_GetObjectItem(body, "requestId");
        if (rq && cJSON_IsString(rq)) req_id = rq->valuestring;
        
        payload = cJSON_GetObjectItem(body, "payload");
        if (!payload) {
            cJSON_Delete(body);
            return http_send_error(req, 422, "VALIDATION_FAILED", "Missing payload envelope", req_id);
        }
    }

    const char *harvest_date = "2026-09-13";
    float yield_kg = 325.0f;
    const char *grade = "A";
    const char *notes = "Harvest completed";

    if (payload) {
        cJSON *d = cJSON_GetObjectItem(payload, "harvestDate");
        if (d && cJSON_IsString(d)) harvest_date = d->valuestring;
        cJSON *y = cJSON_GetObjectItem(payload, "yieldKg");
        if (y && cJSON_IsNumber(y)) yield_kg = (float)y->valuedouble;
        cJSON *g = cJSON_GetObjectItem(payload, "grade");
        if (g && cJSON_IsString(g)) grade = g->valuestring;
        cJSON *n = cJSON_GetObjectItem(payload, "notes");
        if (n && cJSON_IsString(n)) notes = n->valuestring;
    }

    crop_cycle_mgr_harvest(gh_id, harvest_date, yield_kg, grade, notes);
    if (body) cJSON_Delete(body);

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current(gh_id, &record);
    return http_send_enveloped_response(req, 200, req_id, crop_cycle_mgr_to_json(&record));
}
