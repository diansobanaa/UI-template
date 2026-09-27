#include "http/api_recipe_handlers.h"
#include "http/http_server.h"
#include "storage/recipe_storage.h"
#include "esp_log.h"
#include "cJSON.h"
#include <string.h>
#include <stdlib.h>
#include "esp_timer.h"
#include <time.h>

static const char *TAG = "API_RECIPE";

static bool extract_recipe_id(const char *uri, char *out_id, size_t max_len)
{
    const char *prefix = "/api/v1/recipes/";
    const char *pos = strstr(uri, prefix);
    if (!pos) return false;
    pos += strlen(prefix);

    const char *query = strchr(pos, '?');
    size_t len = query ? (size_t)(query - pos) : strlen(pos);
    if (len == 0 || len >= max_len) return false;

    memcpy(out_id, pos, len);
    out_id[len] = '\0';
    return true;
}

static esp_err_t get_all_recipes_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    cJSON *items = NULL;
    (void)recipe_storage_list(&items);
    if (!items) {
        items = cJSON_CreateArray();
    }

    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "total", (double)cJSON_GetArraySize(items));
    cJSON_AddItemToObject(root, "recipes", items);
    cJSON_AddStringToObject(root, "storageStatus", recipe_storage_is_available() ? "PERSISTED" : "STORAGE_UNAVAILABLE");

    return http_send_enveloped_response(req, 200, NULL, root);
}

static esp_err_t get_recipe_by_id_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    char recipe_id[64] = {0};
    if (!extract_recipe_id(req->uri, recipe_id, sizeof(recipe_id))) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing recipe ID in path", NULL);
    }

    if (!recipe_storage_is_available()) {
        return http_send_error(req, 503, "STORAGE_UNAVAILABLE", "MicroSD recipe storage is unavailable.", NULL);
    }

    cJSON *recipe = NULL;
    esp_err_t err = recipe_storage_get(recipe_id, &recipe);
    if (err != ESP_OK || !recipe) {
        return http_send_error(req, 404, "RECIPE_NOT_FOUND", "Recipe does not exist.", NULL);
    }

    return http_send_enveloped_response(req, 200, NULL, recipe);
}

static esp_err_t post_recipe_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    cJSON *body = NULL;
    if (http_parse_json_body(req, &body) != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    char request_id[64] = {0};
    cJSON *req_id_item = cJSON_GetObjectItem(body, "requestId");
    if (req_id_item && cJSON_IsString(req_id_item) && req_id_item->valuestring) {
        strncpy(request_id, req_id_item->valuestring, sizeof(request_id) - 1);
    }

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    cJSON *target = payload && cJSON_IsObject(payload) ? payload : body;

    cJSON *id_item = cJSON_GetObjectItem(target, "recipeId");
    if (!id_item || !cJSON_IsString(id_item) || !id_item->valuestring[0]) {
        id_item = cJSON_GetObjectItem(target, "id");
    }

    char recipe_id[64] = {0};
    if (id_item && cJSON_IsString(id_item) && id_item->valuestring[0]) {
        strncpy(recipe_id, id_item->valuestring, sizeof(recipe_id) - 1);
    } else {
        snprintf(recipe_id, sizeof(recipe_id), "rcp-%llu", (unsigned long long)(esp_timer_get_time() / 1000));
    }

    cJSON *name_item = cJSON_GetObjectItem(target, "name");
    const char *name = (name_item && cJSON_IsString(name_item)) ? name_item->valuestring : recipe_id;

    // Normalize target object
    if (!cJSON_GetObjectItem(target, "recipeId")) cJSON_AddStringToObject(target, "recipeId", recipe_id);
    if (!cJSON_GetObjectItem(target, "id")) cJSON_AddStringToObject(target, "id", recipe_id);
    if (!cJSON_GetObjectItem(target, "name")) cJSON_AddStringToObject(target, "name", name);
    if (!cJSON_GetObjectItem(target, "version")) cJSON_AddNumberToObject(target, "version", 1);

    char time_str[32] = "1970-01-01T00:00:00Z";
    time_t now;
    time(&now);
    struct tm tm_info;
    gmtime_r(&now, &tm_info);
    strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", &tm_info);
    if (!cJSON_GetObjectItem(target, "updatedAt")) cJSON_AddStringToObject(target, "updatedAt", time_str);
    if (!cJSON_GetObjectItem(target, "createdAt")) cJSON_AddStringToObject(target, "createdAt", time_str);

    // Physical storage check: if SD absent, execute persistence path (WRITE_TO_NOTHING) and report explicit error
    if (!recipe_storage_is_available()) {
        (void)recipe_storage_save(recipe_id, target); // executes write-to-nothing path
        cJSON_Delete(body);
        return http_send_error(req, 503, "STORAGE_UNAVAILABLE", "MicroSD storage is unavailable. Recipe was not persisted.", request_id[0] ? request_id : NULL);
    }

    esp_err_t err = recipe_storage_save(recipe_id, target);
    if (err != ESP_OK) {
        cJSON_Delete(body);
        return http_send_error(req, 500, "PERSISTENCE_FAILED", "Failed to write recipe to MicroSD storage.", request_id[0] ? request_id : NULL);
    }

    cJSON *response = cJSON_Duplicate(target, 1);
    cJSON_AddStringToObject(response, "storageStatus", "PERSISTED");
    cJSON_Delete(body);

    return http_send_enveloped_response(req, 201, request_id[0] ? request_id : NULL, response);
}

static esp_err_t put_recipe_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    char recipe_id[64] = {0};
    if (!extract_recipe_id(req->uri, recipe_id, sizeof(recipe_id))) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing recipe ID in path", NULL);
    }

    cJSON *body = NULL;
    if (http_parse_json_body(req, &body) != ESP_OK || !body) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Invalid JSON payload", NULL);
    }

    char request_id[64] = {0};
    cJSON *req_id_item = cJSON_GetObjectItem(body, "requestId");
    if (req_id_item && cJSON_IsString(req_id_item) && req_id_item->valuestring) {
        strncpy(request_id, req_id_item->valuestring, sizeof(request_id) - 1);
    }

    cJSON *payload = cJSON_GetObjectItem(body, "payload");
    cJSON *target = payload && cJSON_IsObject(payload) ? payload : body;

    if (!recipe_storage_is_available()) {
        (void)recipe_storage_save(recipe_id, target);
        cJSON_Delete(body);
        return http_send_error(req, 503, "STORAGE_UNAVAILABLE", "MicroSD storage is unavailable. Recipe was not persisted.", request_id[0] ? request_id : NULL);
    }

    if (!cJSON_GetObjectItem(target, "recipeId")) cJSON_AddStringToObject(target, "recipeId", recipe_id);
    if (!cJSON_GetObjectItem(target, "id")) cJSON_AddStringToObject(target, "id", recipe_id);

    cJSON *ver = cJSON_GetObjectItem(target, "version");
    if (ver && cJSON_IsNumber(ver)) {
        cJSON_SetNumberValue(ver, ver->valuedouble + 1.0);
    } else {
        cJSON_AddNumberToObject(target, "version", 1);
    }

    char time_str[32] = "1970-01-01T00:00:00Z";
    time_t now;
    time(&now);
    struct tm tm_info;
    gmtime_r(&now, &tm_info);
    strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%SZ", &tm_info);
    cJSON_DeleteItemFromObject(target, "updatedAt");
    cJSON_AddStringToObject(target, "updatedAt", time_str);

    esp_err_t err = recipe_storage_save(recipe_id, target);
    if (err != ESP_OK) {
        cJSON_Delete(body);
        return http_send_error(req, 500, "PERSISTENCE_FAILED", "Failed to update recipe on MicroSD storage.", request_id[0] ? request_id : NULL);
    }

    cJSON *response = cJSON_Duplicate(target, 1);
    cJSON_AddStringToObject(response, "storageStatus", "PERSISTED");
    cJSON_Delete(body);

    return http_send_enveloped_response(req, 200, request_id[0] ? request_id : NULL, response);
}

static esp_err_t delete_recipe_handler(httpd_req_t *req)
{
    if (http_check_auth(req) != ESP_OK) return ESP_OK;

    char recipe_id[64] = {0};
    if (!extract_recipe_id(req->uri, recipe_id, sizeof(recipe_id))) {
        return http_send_error(req, 422, "VALIDATION_FAILED", "Missing recipe ID in path", NULL);
    }

    if (!recipe_storage_is_available()) {
        return http_send_error(req, 503, "STORAGE_UNAVAILABLE", "MicroSD storage is unavailable.", NULL);
    }

    esp_err_t err = recipe_storage_delete(recipe_id);
    if (err != ESP_OK) {
        return http_send_error(req, 404, "RECIPE_NOT_FOUND", "Recipe does not exist or failed to delete.", NULL);
    }

    cJSON *response = cJSON_CreateObject();
    cJSON_AddBoolToObject(response, "deleted", true);
    cJSON_AddStringToObject(response, "recipeId", recipe_id);

    return http_send_enveloped_response(req, 200, NULL, response);
}

void register_api_recipe_handlers(httpd_handle_t server)
{
    httpd_uri_t get_all_uri = {
        .uri = "/api/v1/recipes",
        .method = HTTP_GET,
        .handler = get_all_recipes_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &get_all_uri);

    httpd_uri_t post_uri = {
        .uri = "/api/v1/recipes",
        .method = HTTP_POST,
        .handler = post_recipe_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &post_uri);

    httpd_uri_t get_one_uri = {
        .uri = "/api/v1/recipes/*",
        .method = HTTP_GET,
        .handler = get_recipe_by_id_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &get_one_uri);

    httpd_uri_t put_uri = {
        .uri = "/api/v1/recipes/*",
        .method = HTTP_PUT,
        .handler = put_recipe_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &put_uri);

    httpd_uri_t delete_uri = {
        .uri = "/api/v1/recipes/*",
        .method = HTTP_DELETE,
        .handler = delete_recipe_handler,
        .user_ctx = NULL
    };
    httpd_register_uri_handler(server, &delete_uri);

    ESP_LOGI(TAG, "Registered canonical Recipe CRUD endpoints (/api/v1/recipes).");
}
