#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "services/crop_cycle_mgr.h"
#include "cJSON.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "CROPCYCLE_API";

esp_err_t handler_get_crop_cycle(httpd_req_t *req)
{
    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    cJSON *root = crop_cycle_mgr_to_json(&record);
    return http_send_json_response(req, 200, root);
}

esp_err_t handler_list_crop_cycles(httpd_req_t *req)
{
    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);

    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");
    cJSON_AddItemToArray(items, crop_cycle_mgr_to_json(&record));
    cJSON_AddNumberToObject(root, "total", 1);
    cJSON_AddNullToObject(root, "nextCursor");

    return http_send_json_response(req, 200, root);
}

esp_err_t handler_start_crop_cycle(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *tanam = cJSON_GetObjectItem(body, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required", NULL);
    }

    const char *variety = NULL;
    cJSON *v = cJSON_GetObjectItem(body, "variety");
    if (v && cJSON_IsString(v)) variety = v->valuestring;

    uint32_t count = 0;
    cJSON *p = cJSON_GetObjectItem(body, "plantCount");
    if (p && cJSON_IsNumber(p)) count = (uint32_t)p->valuedouble;

    const char *notes = NULL;
    cJSON *n = cJSON_GetObjectItem(body, "notes");
    if (n && cJSON_IsString(n)) notes = n->valuestring;

    err = crop_cycle_mgr_start("gh-01", tanam->valuestring, variety, count, notes);
    cJSON_Delete(body);

    if (err == ESP_ERR_INVALID_STATE) {
        return http_send_error(req, 409, "CONFLICT", "An active cycle already exists in this greenhouse", NULL);
    } else if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to start cycle", NULL);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    return http_send_json_response(req, 201, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_import_active_crop_cycle(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *tanam = cJSON_GetObjectItem(body, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required", NULL);
    }

    const char *pol = NULL;
    cJSON *p = cJSON_GetObjectItem(body, "tanggalPolinasi");
    if (p && cJSON_IsString(p)) pol = p->valuestring;

    const char *variety = NULL;
    cJSON *v = cJSON_GetObjectItem(body, "variety");
    if (v && cJSON_IsString(v)) variety = v->valuestring;

    uint32_t count = 0;
    cJSON *pc = cJSON_GetObjectItem(body, "plantCount");
    if (pc && cJSON_IsNumber(pc)) count = (uint32_t)pc->valuedouble;

    const char *notes = NULL;
    cJSON *n = cJSON_GetObjectItem(body, "notes");
    if (n && cJSON_IsString(n)) notes = n->valuestring;

    err = crop_cycle_mgr_import_active("gh-01", tanam->valuestring, pol, variety, count, notes);
    cJSON_Delete(body);

    if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to import active cycle", NULL);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    return http_send_json_response(req, 201, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_record_pollination(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *pol = cJSON_GetObjectItem(body, "tanggalPolinasi");
    if (!pol || !cJSON_IsString(pol)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalPolinasi is required", NULL);
    }

    const char *method = "manual";
    cJSON *m = cJSON_GetObjectItem(body, "pollinationMethod");
    if (m && cJSON_IsString(m)) method = m->valuestring;

    err = crop_cycle_mgr_set_pollination("gh-01", pol->valuestring, method);
    cJSON_Delete(body);

    if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalPolinasi cannot be earlier than tanggalTanam", NULL);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    return http_send_json_response(req, 200, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_update_pollination(httpd_req_t *req)
{
    return handler_record_pollination(req);
}

esp_err_t handler_delete_pollination(httpd_req_t *req)
{
    crop_cycle_mgr_delete_pollination("gh-01");
    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    return http_send_json_response(req, 200, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_update_planting_date(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *tanam = cJSON_GetObjectItem(body, "tanggalTanam");
    if (!tanam || !cJSON_IsString(tanam)) {
        cJSON_Delete(body);
        return http_send_error(req, 422, "VALIDATION_FAILED", "tanggalTanam is required", NULL);
    }

    err = crop_cycle_mgr_update_planting_date("gh-01", tanam->valuestring);
    cJSON_Delete(body);

    if (err != ESP_OK) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Failed to update planting date", NULL);
    }

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    return http_send_json_response(req, 200, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_update_cycle_metadata(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    const char *variety = NULL;
    cJSON *v = cJSON_GetObjectItem(body, "variety");
    if (v && cJSON_IsString(v)) variety = v->valuestring;

    uint32_t count = 0;
    cJSON *p = cJSON_GetObjectItem(body, "plantCount");
    if (p && cJSON_IsNumber(p)) count = (uint32_t)p->valuedouble;

    const char *notes = NULL;
    cJSON *n = cJSON_GetObjectItem(body, "notes");
    if (n && cJSON_IsString(n)) notes = n->valuestring;

    crop_cycle_mgr_update_metadata("gh-01", variety, count, notes);
    cJSON_Delete(body);

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    return http_send_json_response(req, 200, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_cancel_crop_cycle(httpd_req_t *req)
{
    crop_cycle_mgr_cancel("gh-01");
    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    return http_send_json_response(req, 200, crop_cycle_mgr_to_json(&record));
}

esp_err_t handler_harvest_crop_cycle(httpd_req_t *req)
{
    cJSON *body = NULL;
    http_parse_json_body(req, &body);

    const char *harvest_date = "2026-09-13";
    float yield_kg = 325.0f;
    const char *grade = "A";
    const char *notes = "Harvest completed";

    if (body) {
        cJSON *d = cJSON_GetObjectItem(body, "harvestDate");
        if (d && cJSON_IsString(d)) harvest_date = d->valuestring;
        cJSON *y = cJSON_GetObjectItem(body, "yieldKg");
        if (y && cJSON_IsNumber(y)) yield_kg = (float)y->valuedouble;
        cJSON *g = cJSON_GetObjectItem(body, "grade");
        if (g && cJSON_IsString(g)) grade = g->valuestring;
        cJSON *n = cJSON_GetObjectItem(body, "notes");
        if (n && cJSON_IsString(n)) notes = n->valuestring;
    }

    crop_cycle_mgr_harvest("gh-01", harvest_date, yield_kg, grade, notes);
    if (body) cJSON_Delete(body);

    crop_cycle_record_t record;
    crop_cycle_mgr_get_current("gh-01", &record);
    return http_send_json_response(req, 200, crop_cycle_mgr_to_json(&record));
}
