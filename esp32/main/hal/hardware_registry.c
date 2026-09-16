#include "hal/hardware_registry.h"
#include "hal/button_hal.h"
#include "storage/storage_mgr.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "driver/spi_master.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>

static const char *TAG = "HW_REGISTRY";

#define MAX_HW_COMPONENTS 32

static const hw_component_info_t s_default_components[] = {
    { "pump_well",        "Well Pump",             "PUMP",        "WELL_PUMP",        "GPIO",     PIN_OUT_WELL_PUMP,       0, "CRITICAL",   "AVAILABLE" },
    { "pump_dist",        "Distribution Pump",     "PUMP",        "DIST_PUMP",        "GPIO",     PIN_OUT_DIST_PUMP,       0, "CRITICAL",   "AVAILABLE" },
    { "pump_submersible", "Raw Submersible Pump",  "PUMP",        "RAW_SUBMERSIBLE",  "GPIO",     PIN_OUT_RAW_SUBMERSIBLE, 0, "NORMAL",     "AVAILABLE" },
    { "pump_dosing_a",    "Dosing Pump A",         "PUMP",        "DOSING_A",         "GPIO",     PIN_OUT_DOSING_A,        0, "CRITICAL",   "AVAILABLE" },
    { "pump_dosing_b",    "Dosing Pump B",         "PUMP",        "DOSING_B",         "GPIO",     PIN_OUT_DOSING_B,        0, "CRITICAL",   "AVAILABLE" },
    { "fan_cooling",      "Cooling Fan",           "ACTUATOR",    "COOLING_FAN",      "GPIO",     PIN_OUT_COOLING_FAN,     0, "NORMAL",     "AVAILABLE" },
    { "lamp_error",       "Error Lamp",            "INDICATOR",   "ERROR_LAMP",       "GPIO",     PIN_OUT_ERROR_LAMP,      0, "MONITORING", "AVAILABLE" },
    { "flow_yfb1",        "YF-B1 Flow Meter",      "FLOW_METER",  "FLOW_DOSING",      "PULSE",    PIN_IN_FLOW_YFB1,        0, "MONITORING", "AVAILABLE" },
    { "flow_fs400a",      "FS400A Flow Meter",     "FLOW_METER",  "FLOW_DIST",        "PULSE",    PIN_IN_FLOW_FS400A,      0, "MONITORING", "AVAILABLE" },
    { "temp_ds18b20",     "DS18B20 Temp Sensor",   "SENSOR",      "WATER_TEMP",       "ONE_WIRE", PIN_IN_TEMP_DS18B20,     0, "MONITORING", "AVAILABLE" },
    { "float_lower",      "Lower Float Switch",    "SENSOR",      "TANK_LEVEL_LOW",   "GPIO",     PIN_IN_FLOAT_LOWER,      0, "CRITICAL",   "AVAILABLE" },
    { "btn_mode",         "TFT Display Switch",    "INPUT",       "TFT_SWITCH",       "GPIO",     PIN_BTN_MODE,            0, "NORMAL",     "AVAILABLE" },
    { "btn_manual_a",     "Well Pump Toggle",      "INPUT",       "WELL_PUMP_TOGGLE", "GPIO",     PIN_BTN_MANUAL_A,        0, "NORMAL",     "AVAILABLE" },
    { "btn_manual_b",     "Reserved Button 3",     "INPUT",       "RESERVED",         "GPIO",     PIN_BTN_MANUAL_B,        0, "NORMAL",     "AVAILABLE" },
    { "btn_dist",         "Reserved Button 4",     "INPUT",       "RESERVED",         "GPIO",     PIN_BTN_DISTRIBUTION,    0, "NORMAL",     "AVAILABLE" },
};

static hw_component_info_t s_active_components[MAX_HW_COMPONENTS];
static size_t s_active_count = 0;

static const char DEFAULT_COMPONENTS_JSON[] = 
"{\n"
"  \"version\": 1,\n"
"  \"updatedAt\": \"2026-09-16T00:00:00Z\",\n"
"  \"components\": [\n"
"    { \"componentId\": \"pump_well\",        \"name\": \"Well Pump\",            \"type\": \"PUMP\",       \"role\": \"WELL_PUMP\",       \"interface\": \"GPIO\", \"pin\": 1,  \"safetyClass\": \"CRITICAL\",   \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"pump_dist\",        \"name\": \"Distribution Pump\",    \"type\": \"PUMP\",       \"role\": \"DIST_PUMP\",       \"interface\": \"GPIO\", \"pin\": 2,  \"safetyClass\": \"CRITICAL\",   \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"pump_submersible\", \"name\": \"Raw Submersible Pump\", \"type\": \"PUMP\",       \"role\": \"RAW_SUBMERSIBLE\", \"interface\": \"GPIO\", \"pin\": 4,  \"safetyClass\": \"NORMAL\",     \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"pump_dosing_a\",    \"name\": \"Dosing Pump A\",        \"type\": \"PUMP\",       \"role\": \"DOSING_A\",        \"interface\": \"GPIO\", \"pin\": 5,  \"safetyClass\": \"CRITICAL\",   \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"pump_dosing_b\",    \"name\": \"Dosing Pump B\",        \"type\": \"PUMP\",       \"role\": \"DOSING_B\",        \"interface\": \"GPIO\", \"pin\": 6,  \"safetyClass\": \"CRITICAL\",   \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"fan_cooling\",      \"name\": \"Cooling Fan\",          \"type\": \"ACTUATOR\",   \"role\": \"COOLING_FAN\",     \"interface\": \"GPIO\", \"pin\": 7,  \"safetyClass\": \"NORMAL\",     \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"lamp_error\",       \"name\": \"Error Lamp\",           \"type\": \"INDICATOR\",  \"role\": \"ERROR_LAMP\",      \"interface\": \"GPIO\", \"pin\": 18, \"safetyClass\": \"MONITORING\", \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"flow_yfb1\",        \"name\": \"YF-B1 Flow Meter\",     \"type\": \"FLOW_METER\", \"role\": \"FLOW_DOSING\",     \"interface\": \"PULSE\",\"pin\": 15, \"safetyClass\": \"MONITORING\", \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"flow_fs400a\",      \"name\": \"FS400A Flow Meter\",    \"type\": \"FLOW_METER\", \"role\": \"FLOW_DIST\",       \"interface\": \"PULSE\",\"pin\": 16, \"safetyClass\": \"MONITORING\", \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"temp_ds18b20\",     \"name\": \"DS18B20 Temp Sensor\",  \"type\": \"SENSOR\",     \"role\": \"WATER_TEMP\",      \"interface\": \"ONE_WIRE\", \"pin\": 17, \"safetyClass\": \"MONITORING\", \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"float_lower\",      \"name\": \"Lower Float Switch\",   \"type\": \"SENSOR\",     \"role\": \"TANK_LEVEL_LOW\",  \"interface\": \"GPIO\", \"pin\": 38, \"safetyClass\": \"CRITICAL\",   \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"btn_mode\",         \"name\": \"TFT Display Switch\",   \"type\": \"INPUT\",      \"role\": \"TFT_SWITCH\",      \"interface\": \"GPIO\", \"pin\": 0,  \"safetyClass\": \"NORMAL\",     \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"btn_manual_a\",     \"name\": \"Well Pump Toggle\",     \"type\": \"INPUT\",      \"role\": \"WELL_PUMP_TOGGLE\",\"interface\": \"GPIO\", \"pin\": 39, \"safetyClass\": \"NORMAL\",     \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"btn_manual_b\",     \"name\": \"Reserved Button 3\",    \"type\": \"INPUT\",      \"role\": \"RESERVED\",        \"interface\": \"GPIO\", \"pin\": 40, \"safetyClass\": \"NORMAL\",     \"status\": \"AVAILABLE\" },\n"
"    { \"componentId\": \"btn_dist\",         \"name\": \"Reserved Button 4\",    \"type\": \"INPUT\",      \"role\": \"RESERVED\",        \"interface\": \"GPIO\", \"pin\": 41, \"safetyClass\": \"NORMAL\",     \"status\": \"AVAILABLE\" }\n"
"  ]\n"
"}";

const char *hardware_registry_get_default_json(void)
{
    return DEFAULT_COMPONENTS_JSON;
}

static void safe_copy_str(char *dst, size_t dst_size, const char *src, const char *fallback)
{
    if (src && strlen(src) > 0) {
        strncpy(dst, src, dst_size - 1);
        dst[dst_size - 1] = '\0';
    } else if (fallback) {
        strncpy(dst, fallback, dst_size - 1);
        dst[dst_size - 1] = '\0';
    } else {
        dst[0] = '\0';
    }
}

esp_err_t hardware_registry_load_from_json(const char *json_str)
{
    if (!json_str) return ESP_ERR_INVALID_ARG;

    cJSON *root = cJSON_Parse(json_str);
    if (!root) {
        ESP_LOGE(TAG, "Failed to parse components JSON: invalid syntax");
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *arr = cJSON_GetObjectItem(root, "components");
    if (!arr || !cJSON_IsArray(arr)) {
        if (cJSON_IsArray(root)) {
            arr = root;
        } else {
            ESP_LOGE(TAG, "JSON missing 'components' array");
            cJSON_Delete(root);
            return ESP_ERR_INVALID_ARG;
        }
    }

    int count = cJSON_GetArraySize(arr);
    if (count <= 0) {
        ESP_LOGW(TAG, "Components array is empty");
        cJSON_Delete(root);
        return ESP_ERR_INVALID_ARG;
    }

    size_t loaded = 0;
    for (int i = 0; i < count && loaded < MAX_HW_COMPONENTS; i++) {
        cJSON *item = cJSON_GetArrayItem(arr, i);
        if (!item || !cJSON_IsObject(item)) continue;

        cJSON *j_id = cJSON_GetObjectItem(item, "componentId");
        if (!j_id) j_id = cJSON_GetObjectItem(item, "id");
        cJSON *j_name = cJSON_GetObjectItem(item, "name");
        cJSON *j_type = cJSON_GetObjectItem(item, "type");
        cJSON *j_role = cJSON_GetObjectItem(item, "role");
        cJSON *j_iface = cJSON_GetObjectItem(item, "interface");
        cJSON *j_pin = cJSON_GetObjectItem(item, "pin");
        cJSON *j_chan = cJSON_GetObjectItem(item, "channel");
        cJSON *j_safety = cJSON_GetObjectItem(item, "safetyClass");
        cJSON *j_status = cJSON_GetObjectItem(item, "status");

        hw_component_info_t *dst = &s_active_components[loaded];
        memset(dst, 0, sizeof(hw_component_info_t));

        safe_copy_str(dst->id, sizeof(dst->id), j_id ? j_id->valuestring : NULL, "unnamed_comp");
        safe_copy_str(dst->name, sizeof(dst->name), j_name ? j_name->valuestring : NULL, "Unnamed Component");
        safe_copy_str(dst->type, sizeof(dst->type), j_type ? j_type->valuestring : NULL, "ACTUATOR");
        safe_copy_str(dst->role, sizeof(dst->role), j_role ? j_role->valuestring : NULL, "GENERIC");
        safe_copy_str(dst->interface, sizeof(dst->interface), j_iface ? j_iface->valuestring : NULL, "GPIO");
        dst->pin = j_pin ? (uint8_t)j_pin->valueint : 255;
        dst->channel = j_chan ? (uint8_t)j_chan->valueint : 0;
        safe_copy_str(dst->safety_class, sizeof(dst->safety_class), j_safety ? j_safety->valuestring : NULL, "NORMAL");
        safe_copy_str(dst->status, sizeof(dst->status), j_status ? j_status->valuestring : NULL, "AVAILABLE");

        loaded++;
    }

    cJSON_Delete(root);

    if (loaded > 0) {
        s_active_count = loaded;
        ESP_LOGI(TAG, "Successfully loaded %u dynamic components from JSON", (unsigned)loaded);
        return ESP_OK;
    }

    return ESP_FAIL;
}

esp_err_t hardware_hal_init_all(void)
{
    ESP_LOGI(TAG, "Initializing all hardware HAL subsystems with Dynamic Registry...");

    /* 1. Preload active components from compile-time default baseline */
    s_active_count = sizeof(s_default_components) / sizeof(s_default_components[0]);
    if (s_active_count > MAX_HW_COMPONENTS) s_active_count = MAX_HW_COMPONENTS;
    memcpy(s_active_components, s_default_components, s_active_count * sizeof(hw_component_info_t));

    /* 2. Attempt loading dynamic components.json from Flash storage (SPIFFS / NVS) */
    char json_buf[4096];
    size_t json_len = 0;
    esp_err_t load_err = storage_mgr_load_components_json(json_buf, sizeof(json_buf), &json_len);
    if (load_err == ESP_OK && json_len > 0) {
        if (hardware_registry_load_from_json(json_buf) == ESP_OK) {
            ESP_LOGI(TAG, "Dynamic components.json successfully applied.");
        } else {
            ESP_LOGW(TAG, "components.json corrupt or invalid; retaining default baseline.");
        }
    } else {
        ESP_LOGI(TAG, "No components.json found on Flash; auto-provisioning baseline components.json to storage.");
        storage_mgr_save_components_json(DEFAULT_COMPONENTS_JSON);
    }

    /* 3. Initialize buses & peripherals */
    spi_bus_config_t buscfg = {
        .miso_io_num = PIN_SPI_MISO,
        .mosi_io_num = PIN_SPI_MOSI,
        .sclk_io_num = PIN_SPI_SCK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 4096
    };
    esp_err_t ret = spi_bus_initialize(SPI2_HOST, &buscfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize SPI bus: %s", esp_err_to_name(ret));
        return ret;
    }

    ESP_ERROR_CHECK(actuator_hal_init());
    ESP_ERROR_CHECK(sensor_hal_init());
    ESP_ERROR_CHECK(button_hal_init(NULL));

    ESP_LOGI(TAG, "Hardware HAL initialization complete. Total active components: %u", (unsigned)s_active_count);
    return ESP_OK;
}

size_t hardware_registry_get_count(void)
{
    return s_active_count;
}

esp_err_t hardware_registry_get_by_index(size_t index, hw_component_info_t *out_info)
{
    if (index >= s_active_count || !out_info) return ESP_ERR_INVALID_ARG;
    *out_info = s_active_components[index];
    return ESP_OK;
}
