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

static hw_component_info_t s_active_components[MAX_HW_COMPONENTS];
static size_t s_active_count = 0;

static hw_lifecycle_state_t parse_lifecycle(const char *state) {
    if (!state) return HW_LIFECYCLE_REGISTERED;
    if (strcmp(state, "REGISTERED") == 0) return HW_LIFECYCLE_REGISTERED;
    if (strcmp(state, "NOT_COMMISSIONED") == 0) return HW_LIFECYCLE_NOT_COMMISSIONED;
    if (strcmp(state, "COMMISSIONED") == 0) return HW_LIFECYCLE_COMMISSIONED;
    if (strcmp(state, "ENABLED") == 0) return HW_LIFECYCLE_ENABLED;
    if (strcmp(state, "DISABLED") == 0) return HW_LIFECYCLE_DISABLED;
    if (strcmp(state, "FAULTED") == 0) return HW_LIFECYCLE_FAULTED;
    if (strcmp(state, "REMOVED") == 0) return HW_LIFECYCLE_REMOVED;
    return HW_LIFECYCLE_REGISTERED;
}

static hw_deployment_status_t parse_deployment(const char *status) {
    if (!status) return HW_DEPLOYMENT_UNKNOWN;
    if (strcmp(status, "PENDING") == 0) return HW_DEPLOYMENT_PENDING;
    if (strcmp(status, "APPLIED") == 0) return HW_DEPLOYMENT_APPLIED;
    if (strcmp(status, "FAILED") == 0) return HW_DEPLOYMENT_FAILED;
    return HW_DEPLOYMENT_UNKNOWN;
}

static hw_interface_type_t parse_interface(const char *iface) {
    if (!iface) return HW_INTERFACE_VIRTUAL;
    if (strcmp(iface, "GPIO") == 0) return HW_INTERFACE_GPIO;
    if (strcmp(iface, "I2C") == 0) return HW_INTERFACE_I2C;
    if (strcmp(iface, "UART") == 0) return HW_INTERFACE_UART;
    if (strcmp(iface, "SPI") == 0) return HW_INTERFACE_SPI;
    if (strcmp(iface, "ONE_WIRE") == 0) return HW_INTERFACE_ONE_WIRE;
    if (strcmp(iface, "ANALOG") == 0) return HW_INTERFACE_ANALOG;
    return HW_INTERFACE_VIRTUAL;
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
        
        // Ensure ID is stable and unique
        if (!j_id || !cJSON_IsString(j_id) || strlen(j_id->valuestring) == 0) {
            ESP_LOGW(TAG, "Component missing ID, skipping.");
            continue;
        }
        
        // Check for duplicates
        bool duplicate = false;
        for (size_t j = 0; j < loaded; j++) {
            if (strcmp(s_active_components[j].component_id, j_id->valuestring) == 0) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) {
            ESP_LOGW(TAG, "Duplicate component ID %s, skipping.", j_id->valuestring);
            continue;
        }

        cJSON *j_type = cJSON_GetObjectItem(item, "supportedTypeId");
        if (!j_type) j_type = cJSON_GetObjectItem(item, "type");
        
        cJSON *j_name = cJSON_GetObjectItem(item, "name");
        cJSON *j_life = cJSON_GetObjectItem(item, "lifecycleState");
        if (!j_life) j_life = cJSON_GetObjectItem(item, "status");
        
        cJSON *j_dep = cJSON_GetObjectItem(item, "deploymentStatus");
        cJSON *j_role = cJSON_GetObjectItem(item, "role");
        cJSON *j_resid = cJSON_GetObjectItem(item, "resourceId");
        
        cJSON *j_assignment = cJSON_GetObjectItem(item, "assignment");
        cJSON *j_wiring = cJSON_GetObjectItem(item, "wiring");
        cJSON *j_params = cJSON_GetObjectItem(item, "parameters");

        hw_component_info_t *dst = &s_active_components[loaded];
        memset(dst, 0, sizeof(hw_component_info_t));

        safe_copy_str(dst->component_id, sizeof(dst->component_id), j_id->valuestring, "");
        safe_copy_str(dst->supported_type_id, sizeof(dst->supported_type_id), j_type ? j_type->valuestring : NULL, "UNKNOWN");
        safe_copy_str(dst->name, sizeof(dst->name), j_name ? j_name->valuestring : NULL, "Unnamed Component");
        safe_copy_str(dst->role, sizeof(dst->role), j_role ? j_role->valuestring : NULL, "");
        safe_copy_str(dst->resource_id, sizeof(dst->resource_id), j_resid ? j_resid->valuestring : NULL, "");
        
        dst->lifecycle_state = parse_lifecycle(j_life ? j_life->valuestring : NULL);
        dst->deployment_status = parse_deployment(j_dep ? j_dep->valuestring : NULL);
        
        if (j_assignment && cJSON_IsObject(j_assignment)) {
            cJSON *j_complex = cJSON_GetObjectItem(j_assignment, "complexId");
            cJSON *j_gh = cJSON_GetObjectItem(j_assignment, "ghId");
            safe_copy_str(dst->assignment.complex_id, sizeof(dst->assignment.complex_id), j_complex ? j_complex->valuestring : NULL, "");
            safe_copy_str(dst->assignment.gh_id, sizeof(dst->assignment.gh_id), j_gh ? j_gh->valuestring : NULL, "");
        } else {
            // Legacy fallback
            cJSON *j_scope = cJSON_GetObjectItem(item, "scope");
            cJSON *j_gh = cJSON_GetObjectItem(item, "ghId");
            safe_copy_str(dst->assignment.complex_id, sizeof(dst->assignment.complex_id), j_scope ? j_scope->valuestring : NULL, "");
            safe_copy_str(dst->assignment.gh_id, sizeof(dst->assignment.gh_id), j_gh ? j_gh->valuestring : NULL, "");
        }
        
        dst->wiring.gpio = -1;
        dst->wiring.channel = -1;
        if (j_wiring && cJSON_IsObject(j_wiring)) {
            cJSON *j_iface = cJSON_GetObjectItem(j_wiring, "interface");
            dst->wiring.interface = parse_interface(j_iface ? j_iface->valuestring : NULL);
            
            cJSON *j_pin = cJSON_GetObjectItem(j_wiring, "gpio");
            if (j_pin) dst->wiring.gpio = (int8_t)j_pin->valueint;
            
            cJSON *j_chan = cJSON_GetObjectItem(j_wiring, "channel");
            if (j_chan) dst->wiring.channel = (int8_t)j_chan->valueint;
            
            cJSON *j_addr = cJSON_GetObjectItem(j_wiring, "address");
            safe_copy_str(dst->wiring.address, sizeof(dst->wiring.address), j_addr ? j_addr->valuestring : NULL, "");
            
            cJSON *j_port = cJSON_GetObjectItem(j_wiring, "port");
            safe_copy_str(dst->wiring.port, sizeof(dst->wiring.port), j_port ? j_port->valuestring : NULL, "");
            
            cJSON *j_pol = cJSON_GetObjectItem(j_wiring, "polarity");
            safe_copy_str(dst->wiring.polarity, sizeof(dst->wiring.polarity), j_pol ? j_pol->valuestring : NULL, "");
        } else {
            // Legacy fallback
            cJSON *j_iface = cJSON_GetObjectItem(item, "interface");
            dst->wiring.interface = parse_interface(j_iface ? j_iface->valuestring : NULL);
            cJSON *j_pin = cJSON_GetObjectItem(item, "pin");
            if (j_pin) dst->wiring.gpio = (int8_t)j_pin->valueint;
        }
        
        if (j_params && cJSON_IsObject(j_params)) {
            char *param_str = cJSON_PrintUnformatted(j_params);
            if (param_str) {
                safe_copy_str(dst->parameters_json, sizeof(dst->parameters_json), param_str, "{}");
                free(param_str);
            }
        } else {
            strcpy(dst->parameters_json, "{}");
        }

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

    /* Attempt loading configuration from Flash storage */
    char *json_buf = (char *)malloc(8192);
    bool load_success = false;
    
    if (json_buf) {
        size_t json_len = 0;
        esp_err_t load_err = storage_mgr_load_config(json_buf, 8192, &json_len);
        if (load_err == ESP_OK && json_len > 0) {
            if (hardware_registry_load_from_json(json_buf) == ESP_OK) {
                ESP_LOGI(TAG, "Dynamic configuration successfully applied to registry.");
                load_success = true;
            } else {
                ESP_LOGW(TAG, "configuration components corrupt or invalid.");
            }
        } else {
            ESP_LOGI(TAG, "No valid configuration found on Flash.");
        }

        /* Fallback: try dedicated components.json if configuration had no components */
        if (!load_success) {
            load_err = storage_mgr_load_components_json(json_buf, 8192, &json_len);
            if (load_err == ESP_OK && json_len > 0) {
                if (hardware_registry_load_from_json(json_buf) == ESP_OK) {
                    ESP_LOGI(TAG, "Dynamic components.json successfully applied to registry.");
                    load_success = true;
                }
            }
        }
        free(json_buf);
    } else {
        ESP_LOGE(TAG, "Failed to allocate memory for configuration.json buffer");
    }

    if (!load_success) {
        ESP_LOGW(TAG, "Running with empty hardware registry until configuration is applied.");
        s_active_count = 0;
    }

    /* Initialize buses & peripherals */
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
        // Continue anyway
    }

    ESP_ERROR_CHECK_WITHOUT_ABORT(actuator_hal_init());
    ESP_ERROR_CHECK_WITHOUT_ABORT(sensor_hal_init());
    ESP_ERROR_CHECK_WITHOUT_ABORT(button_hal_init(NULL));

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

esp_err_t hardware_registry_find_by_id(const char *component_id, hw_component_info_t *out_info)
{
    if (!component_id || !out_info) return ESP_ERR_INVALID_ARG;
    for (size_t i = 0; i < s_active_count; i++) {
        if (strcmp(s_active_components[i].component_id, component_id) == 0) {
            *out_info = s_active_components[i];
            return ESP_OK;
        }
    }
    return ESP_ERR_NOT_FOUND;
}

esp_err_t hardware_registry_resolve_gpio(const char *component_id, int8_t *out_gpio)
{
    if (!component_id || !out_gpio) return ESP_ERR_INVALID_ARG;
    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err != ESP_OK) return err;
    if (info.wiring.gpio < 0) return ESP_ERR_NOT_FOUND;
    *out_gpio = info.wiring.gpio;
    return ESP_OK;
}

esp_err_t hardware_registry_resolve_channel(const char *component_id, int8_t *out_channel)
{
    if (!component_id || !out_channel) return ESP_ERR_INVALID_ARG;
    hw_component_info_t info;
    esp_err_t err = hardware_registry_find_by_id(component_id, &info);
    if (err != ESP_OK) return err;
    if (info.wiring.channel < 0) return ESP_ERR_NOT_FOUND;
    *out_channel = info.wiring.channel;
    return ESP_OK;
}

bool hardware_registry_is_operational(const char *component_id)
{
    if (!component_id) return false;
    hw_component_info_t info;
    if (hardware_registry_find_by_id(component_id, &info) != ESP_OK) {
        return false;
    }
    return (info.lifecycle_state == HW_LIFECYCLE_COMMISSIONED || 
            info.lifecycle_state == HW_LIFECYCLE_ENABLED);
}

esp_err_t hardware_registry_update_lifecycle(const char *component_id, hw_lifecycle_state_t new_state)
{
    if (!component_id) return ESP_ERR_INVALID_ARG;
    for (size_t i = 0; i < s_active_count; i++) {
        if (strcmp(s_active_components[i].component_id, component_id) == 0) {
            s_active_components[i].lifecycle_state = new_state;
            ESP_LOGI(TAG, "Component '%s' lifecycle updated to %d", component_id, (int)new_state);
            return ESP_OK;
        }
    }
    return ESP_ERR_NOT_FOUND;
}

esp_err_t hardware_registry_clear(void)
{
    s_active_count = 0;
    return ESP_OK;
}

const char *hardware_registry_get_default_json(void) { return "{\"components\":[]}"; }

