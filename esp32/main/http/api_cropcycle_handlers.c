#include "http/api_device_handlers.h"
#include "http/http_server.h"
#include "cJSON.h"
#include "esp_log.h"
#include <string.h>
#include <time.h>
#include <stdlib.h>
#include <stdio.h>

static const char *TAG = "CROPCYCLE_API";

typedef struct {
    char cycle_id[32];
    char gh_id[16];
    char status[16];           /* "ACTIVE", "NO_CYCLE", "HARVESTED", "CANCELLED" */
    char tanggal_tanam[16];    /* "YYYY-MM-DD" */
    char tanggal_polinasi[16]; /* "YYYY-MM-DD" */
    char variety[32];
    uint32_t plant_count;
    char notes[128];
    uint32_t version;

    /* Harvest summary */
    bool has_harvest_summary;
    char harvest_date[16];
    float yield_kg;
    char grade[8];
    char harvest_notes[128];
} active_crop_cycle_t;

/* Active in-memory/persisted cycle representation for GH-01 */
static active_crop_cycle_t s_cycle = {
    .cycle_id = "cycle-gh01-01",
    .gh_id = "gh-01",
    .status = "ACTIVE",
    .tanggal_tanam = "2026-06-02",
    .tanggal_polinasi = "2026-07-07",
    .variety = "Tomat San Marzano",
    .plant_count = 1200,
    .notes = "Initial baseline cycle",
    .version = 1,
    .has_harvest_summary = false
};

static int calculate_days_since(const char *date_str)
{
    if (!date_str || strlen(date_str) < 10) return -1;

    int y = 0, m = 0, d = 0;
    if (sscanf(date_str, "%d-%d-%d", &y, &m, &d) != 3) return -1;

    struct tm target_tm = {
        .tm_year = y - 1900,
        .tm_mon = m - 1,
        .tm_mday = d,
        .tm_hour = 12,
        .tm_min = 0,
        .tm_sec = 0,
        .tm_isdst = -1
    };

    time_t target_time = mktime(&target_tm);
    if (target_time == (time_t)-1) return -1;

    time_t now = time(NULL);
    double diff_sec = difftime(now, target_time);
    if (diff_sec < 0) return 0;

    return (int)(diff_sec / 86400.0);
}

static cJSON *build_cycle_response_json(const active_crop_cycle_t *cycle)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "cycleId", cycle->cycle_id);
    cJSON_AddStringToObject(root, "ghId", cycle->gh_id);
    cJSON_AddStringToObject(root, "status", cycle->status);

    if (strlen(cycle->tanggal_tanam) > 0) {
        cJSON_AddStringToObject(root, "tanggalTanam", cycle->tanggal_tanam);
    } else {
        cJSON_AddNullToObject(root, "tanggalTanam");
    }

    if (strlen(cycle->tanggal_polinasi) > 0) {
        cJSON_AddStringToObject(root, "tanggalPolinasi", cycle->tanggal_polinasi);
    } else {
        cJSON_AddNullToObject(root, "tanggalPolinasi");
    }

    cJSON_AddStringToObject(root, "variety", cycle->variety);
    cJSON_AddNumberToObject(root, "plantCount", cycle->plant_count);
    cJSON_AddStringToObject(root, "notes", cycle->notes);

    /* Authoritative HST & HSP calculation based on device clock */
    int hst = calculate_days_since(cycle->tanggal_tanam);
    if (hst >= 0 && strcmp(cycle->status, "ACTIVE") == 0) {
        cJSON_AddNumberToObject(root, "hst", hst);
    } else {
        cJSON_AddNullToObject(root, "hst");
    }

    int hsp = calculate_days_since(cycle->tanggal_polinasi);
    if (hsp >= 0 && strcmp(cycle->status, "ACTIVE") == 0 && strlen(cycle->tanggal_polinasi) > 0) {
        cJSON_AddNumberToObject(root, "hsp", hsp);
    } else {
        cJSON_AddNullToObject(root, "hsp");
    }

    cJSON_AddNumberToObject(root, "version", cycle->version);

    if (cycle->has_harvest_summary) {
        cJSON *summary = cJSON_AddObjectToObject(root, "lastHarvestSummary");
        cJSON_AddStringToObject(summary, "harvestDate", cycle->harvest_date);
        cJSON_AddStringToObject(summary, "tanggalTanam", cycle->tanggal_tanam);
        cJSON_AddNumberToObject(summary, "yieldKg", cycle->yield_kg);
        cJSON_AddStringToObject(summary, "grade", cycle->grade);
        cJSON_AddStringToObject(summary, "notes", cycle->harvest_notes);
        cJSON_AddNumberToObject(summary, "hstAtHarvest", hst >= 0 ? hst : 92);
        cJSON_AddNumberToObject(summary, "hspAtHarvest", hsp >= 0 ? hsp : 45);
        cJSON_AddStringToObject(summary, "recordedAt", "2026-09-13T12:00:00Z");
    } else {
        cJSON_AddNullToObject(root, "lastHarvestSummary");
    }

    return root;
}

esp_err_t handler_get_crop_cycle(httpd_req_t *req)
{
    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 200, root);
}

esp_err_t handler_list_crop_cycles(httpd_req_t *req)
{
    cJSON *root = cJSON_CreateObject();
    cJSON *items = cJSON_AddArrayToObject(root, "items");
    cJSON_AddItemToArray(items, build_cycle_response_json(&s_cycle));
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

    snprintf(s_cycle.cycle_id, sizeof(s_cycle.cycle_id), "cycle-%lx", (unsigned long)time(NULL));
    strncpy(s_cycle.status, "ACTIVE", sizeof(s_cycle.status) - 1);
    strncpy(s_cycle.tanggal_tanam, tanam->valuestring, sizeof(s_cycle.tanggal_tanam) - 1);
    s_cycle.tanggal_polinasi[0] = '\0';

    cJSON *variety = cJSON_GetObjectItem(body, "variety");
    if (variety && cJSON_IsString(variety)) strncpy(s_cycle.variety, variety->valuestring, sizeof(s_cycle.variety) - 1);

    cJSON *plants = cJSON_GetObjectItem(body, "plantCount");
    if (plants && cJSON_IsNumber(plants)) s_cycle.plant_count = (uint32_t)plants->valuedouble;

    cJSON *notes = cJSON_GetObjectItem(body, "notes");
    if (notes && cJSON_IsString(notes)) strncpy(s_cycle.notes, notes->valuestring, sizeof(s_cycle.notes) - 1);

    s_cycle.version++;
    s_cycle.has_harvest_summary = false;

    cJSON_Delete(body);
    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 201, root);
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

    snprintf(s_cycle.cycle_id, sizeof(s_cycle.cycle_id), "import-%lx", (unsigned long)time(NULL));
    strncpy(s_cycle.status, "ACTIVE", sizeof(s_cycle.status) - 1);
    strncpy(s_cycle.tanggal_tanam, tanam->valuestring, sizeof(s_cycle.tanggal_tanam) - 1);

    cJSON *pol = cJSON_GetObjectItem(body, "tanggalPolinasi");
    if (pol && cJSON_IsString(pol)) {
        strncpy(s_cycle.tanggal_polinasi, pol->valuestring, sizeof(s_cycle.tanggal_polinasi) - 1);
    } else {
        s_cycle.tanggal_polinasi[0] = '\0';
    }

    s_cycle.version++;
    s_cycle.has_harvest_summary = false;

    cJSON_Delete(body);
    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 201, root);
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

    strncpy(s_cycle.tanggal_polinasi, pol->valuestring, sizeof(s_cycle.tanggal_polinasi) - 1);
    s_cycle.version++;

    cJSON_Delete(body);
    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 200, root);
}

esp_err_t handler_update_pollination(httpd_req_t *req)
{
    return handler_record_pollination(req);
}

esp_err_t handler_delete_pollination(httpd_req_t *req)
{
    s_cycle.tanggal_polinasi[0] = '\0';
    s_cycle.version++;

    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 200, root);
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

    strncpy(s_cycle.tanggal_tanam, tanam->valuestring, sizeof(s_cycle.tanggal_tanam) - 1);
    s_cycle.version++;

    cJSON_Delete(body);
    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 200, root);
}

esp_err_t handler_update_cycle_metadata(httpd_req_t *req)
{
    cJSON *body = NULL;
    esp_err_t err = http_parse_json_body(req, &body);
    if (err != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    cJSON *v = cJSON_GetObjectItem(body, "variety");
    if (v && cJSON_IsString(v)) strncpy(s_cycle.variety, v->valuestring, sizeof(s_cycle.variety) - 1);

    cJSON *p = cJSON_GetObjectItem(body, "plantCount");
    if (p && cJSON_IsNumber(p)) s_cycle.plant_count = (uint32_t)p->valuedouble;

    cJSON *n = cJSON_GetObjectItem(body, "notes");
    if (n && cJSON_IsString(n)) strncpy(s_cycle.notes, n->valuestring, sizeof(s_cycle.notes) - 1);

    s_cycle.version++;

    cJSON_Delete(body);
    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 200, root);
}

esp_err_t handler_cancel_crop_cycle(httpd_req_t *req)
{
    strncpy(s_cycle.status, "CANCELLED", sizeof(s_cycle.status) - 1);
    s_cycle.version++;

    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 200, root);
}

esp_err_t handler_harvest_crop_cycle(httpd_req_t *req)
{
    cJSON *body = NULL;
    http_parse_json_body(req, &body);

    strncpy(s_cycle.status, "HARVESTED", sizeof(s_cycle.status) - 1);
    s_cycle.has_harvest_summary = true;
    strncpy(s_cycle.harvest_date, "2026-09-13", sizeof(s_cycle.harvest_date) - 1);
    s_cycle.yield_kg = 325.5f;
    strncpy(s_cycle.grade, "A", sizeof(s_cycle.grade) - 1);
    strncpy(s_cycle.harvest_notes, "Harvest completed successfully", sizeof(s_cycle.harvest_notes) - 1);

    if (body) {
        cJSON *d = cJSON_GetObjectItem(body, "harvestDate");
        if (d && cJSON_IsString(d)) strncpy(s_cycle.harvest_date, d->valuestring, sizeof(s_cycle.harvest_date) - 1);
        cJSON *y = cJSON_GetObjectItem(body, "yieldKg");
        if (y && cJSON_IsNumber(y)) s_cycle.yield_kg = (float)y->valuedouble;
        cJSON *g = cJSON_GetObjectItem(body, "grade");
        if (g && cJSON_IsString(g)) strncpy(s_cycle.grade, g->valuestring, sizeof(s_cycle.grade) - 1);
        cJSON *n = cJSON_GetObjectItem(body, "notes");
        if (n && cJSON_IsString(n)) strncpy(s_cycle.harvest_notes, n->valuestring, sizeof(s_cycle.harvest_notes) - 1);
        cJSON_Delete(body);
    }

    s_cycle.version++;
    cJSON *root = build_cycle_response_json(&s_cycle);
    return http_send_json_response(req, 200, root);
}
