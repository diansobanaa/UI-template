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

static bool parse_lifecycle(const char *state, hw_lifecycle_state_t *out)
{
    if (!state || !out) return false;
    if (strcmp(state, "REGISTERED") == 0) *out = HW_LIFECYCLE_REGISTERED;
    else if (strcmp(state, "NOT_COMMISSIONED") == 0) *out = HW_LIFECYCLE_NOT_COMMISSIONED;
    else if (strcmp(state, "COMMISSIONED") == 0) *out = HW_LIFECYCLE_COMMISSIONED;
    else if (strcmp(state, "ENABLED") == 0) *out = HW_LIFECYCLE_ENABLED;
    else if (strcmp(state, "DISABLED") == 0) *out = HW_LIFECYCLE_DISABLED;
    else if (strcmp(state, "FAULTED") == 0) *out = HW_LIFECYCLE_FAULTED;
    else if (strcmp(state, "REMOVED") == 0) *out = HW_LIFECYCLE_REMOVED;
    else return false;
    return true;
}

static bool parse_deployment(const char *status, hw_deployment_status_t *out)
{
    if (!status || !out) return false;
    if (strcmp(status, "PENDING") == 0) *out = HW_DEPLOYMENT_PENDING;
    else if (strcmp(status, "APPLIED") == 0) *out = HW_DEPLOYMENT_APPLIED;
    else if (strcmp(status, "FAILED") == 0) *out = HW_DEPLOYMENT_FAILED;
    else if (strcmp(status, "UNKNOWN") == 0) *out = HW_DEPLOYMENT_UNKNOWN;
    else return false;
    return true;
}

static bool parse_interface(const char *iface, hw_interface_type_t *out)
{
    if (!iface || !out) return false;
    if (strcmp(iface, "GPIO") == 0) *out = HW_INTERFACE_GPIO;
    else if (strcmp(iface, "I2C") == 0) *out = HW_INTERFACE_I2C;
    else if (strcmp(iface, "UART") == 0) *out = HW_INTERFACE_UART;
    else if (strcmp(iface, "SPI") == 0) *out = HW_INTERFACE_SPI;
    else if (strcmp(iface, "ONE_WIRE") == 0) *out = HW_INTERFACE_ONE_WIRE;
    else if (strcmp(iface, "ANALOG") == 0) *out = HW_INTERFACE_ANALOG;
    else if (strcmp(iface, "VIRTUAL") == 0) *out = HW_INTERFACE_VIRTUAL;
    else return false;
    return true;
}

static bool is_string_within(const cJSON *item, size_t max_len)
{
    return item && cJSON_IsString(item) && item->valuestring &&
           strlen(item->valuestring) > 0 && strlen(item->valuestring) < max_len;
}

static bool is_nonnegative_integer(const cJSON *item)
{
    return item && cJSON_IsNumber(item) && item->valuedouble >= 0.0 &&
           item->valuedouble == (double)item->valueint;
}


static void validation_reason(char *reason, size_t reason_len, const char *msg)
{
    if (!reason || reason_len == 0) return;
    if (!msg) msg = "hardware wiring validation failed";
    strncpy(reason, msg, reason_len - 1);
    reason[reason_len - 1] = '\0';
}

static bool lifecycle_is_operational_text(const char *state)
{
    return state && (strcmp(state, "COMMISSIONED") == 0 || strcmp(state, "ENABLED") == 0);
}

static int expected_gpio_for_component(const char *role, const char *type)
{
    const char *r = role ? role : "";
    const char *t = type ? type : "";
    if (strcmp(r, "WELL_PUMP") == 0 || strcmp(r, "WATER_PUMP") == 0) return PIN_OUT_WELL_PUMP;
    if (strcmp(r, "DIST_PUMP") == 0 || strcmp(r, "DISTRIBUTION_PUMP") == 0 || strcmp(r, "DELIVERY_PUMP") == 0 || strcmp(r, "FERTIGATION_PUMP") == 0) return PIN_OUT_DIST_PUMP;
    if (strcmp(r, "RAW_SUBMERSIBLE") == 0 || strcmp(r, "RAW_WATER") == 0) return PIN_OUT_RAW_SUBMERSIBLE;
    if (strcmp(r, "DOSING_A") == 0) return PIN_OUT_DOSING_A;
    if (strcmp(r, "DOSING_B") == 0) return PIN_OUT_DOSING_B;
    if (strcmp(r, "COOLING_FAN") == 0 || strcmp(r, "FAN") == 0 && strcmp(t, "cooling-fan") == 0) return PIN_OUT_COOLING_FAN;
    if (strcmp(r, "BLOWER_FAN") == 0) return PIN_OUT_BLOWER_FAN;
    if (strcmp(r, "MIXING_PUMP") == 0 || strcmp(r, "MIX_PUMP") == 0) return PIN_OUT_MIXING_PUMP;
    if (strcmp(r, "ERROR_LAMP") == 0 || strcmp(r, "ALARM_LAMP") == 0 || strcmp(r, "ERROR_BEACON") == 0) return PIN_OUT_ERROR_LAMP;
    if (strcmp(r, "TFT_SWITCH") == 0) return PIN_BTN_MODE;
    if (strcmp(r, "WELL_PUMP_TOGGLE") == 0 || strcmp(r, "MANUAL_WELL_PUMP") == 0) return PIN_BTN_MANUAL_A;
    if (strcmp(r, "RESERVED") == 0 || strcmp(r, "RESERVED_BUTTON") == 0 || strcmp(r, "BUTTON_4") == 0) return PIN_BTN_RESERVED;
    if (strcmp(r, "FLOW_RAW") == 0 || strcmp(r, "RAW_FLOW") == 0 || strcmp(t, "flow-meter-zjb1") == 0) return PIN_IN_FLOW_RAW_ZJB1;
    if (strcmp(r, "FLOW_FERT") == 0 || strcmp(r, "DELIVERY_FLOW_SENSOR") == 0 || strcmp(t, "flow-meter-fs400a") == 0) return PIN_IN_FLOW_FERT_FS400A;
    if (strcmp(r, "TEMPERATURE") == 0 || strcmp(r, "TEMP") == 0 || strcmp(t, "temperature-ds18b20") == 0) return PIN_IN_TEMP_DS18B20;
    if (strcmp(r, "LOWER_FLOAT") == 0 || strcmp(r, "LEVEL_SENSOR") == 0 && strcmp(t, "lower-float") == 0) return PIN_IN_FLOAT_LOWER;
    if (strcmp(r, "TAMPER_LOOP") == 0 || strcmp(r, "ANTI_THEFT_LOOP") == 0) return PIN_IN_TAMPER_LOOP;
    return -1;
}

static bool expected_role_is_actuator(const char *role)
{
    if (!role) return false;
    return strcmp(role, "WELL_PUMP") == 0 || strcmp(role, "WATER_PUMP") == 0 ||
           strcmp(role, "DIST_PUMP") == 0 || strcmp(role, "DISTRIBUTION_PUMP") == 0 ||
           strcmp(role, "DELIVERY_PUMP") == 0 || strcmp(role, "FERTIGATION_PUMP") == 0 ||
           strcmp(role, "RAW_SUBMERSIBLE") == 0 || strcmp(role, "RAW_WATER") == 0 ||
           strcmp(role, "DOSING_A") == 0 || strcmp(role, "DOSING_B") == 0 ||
           strcmp(role, "COOLING_FAN") == 0 || strcmp(role, "BLOWER_FAN") == 0 ||
           strcmp(role, "MIXING_PUMP") == 0 || strcmp(role, "MIX_PUMP") == 0 ||
           strcmp(role, "ERROR_LAMP") == 0 || strcmp(role, "ALARM_LAMP") == 0 || strcmp(role, "ERROR_BEACON") == 0;
}

esp_err_t hardware_registry_validate_component_json(const cJSON *component, char *reason, size_t reason_len)
{
    validation_reason(reason, reason_len, NULL);
    if (!component || !cJSON_IsObject(component)) {
        validation_reason(reason, reason_len, "component must be an object");
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *life = cJSON_GetObjectItem(component, "lifecycleState");
    cJSON *type = cJSON_GetObjectItem(component, "supportedTypeId");
    cJSON *role = cJSON_GetObjectItem(component, "role");
    cJSON *wiring = cJSON_GetObjectItem(component, "wiring");
    const char *life_s = cJSON_IsString(life) ? life->valuestring : "";
    const char *type_s = cJSON_IsString(type) ? type->valuestring : "";
    const char *role_s = cJSON_IsString(role) ? role->valuestring : "";
    bool operational = lifecycle_is_operational_text(life_s);

    if (!wiring) {
        if (operational && expected_gpio_for_component(role_s, type_s) >= 0) {
            validation_reason(reason, reason_len, "operational mapped component requires canonical wiring metadata");
            return ESP_ERR_INVALID_ARG;
        }
        return ESP_OK;
    }
    if (!cJSON_IsObject(wiring)) {
        validation_reason(reason, reason_len, "wiring must be an object");
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *iface = cJSON_GetObjectItem(wiring, "interface");
    const char *iface_s = cJSON_IsString(iface) ? iface->valuestring : "";
    cJSON *gpio = cJSON_GetObjectItem(wiring, "gpio");
    if (gpio) {
        if (!cJSON_IsNumber(gpio) || gpio->valuedouble != (double)gpio->valueint || gpio->valueint < 0 || gpio->valueint > 48) {
            validation_reason(reason, reason_len, "GPIO must be an integer in the target device range [0,48]");
            return ESP_ERR_INVALID_ARG;
        }
        int g = gpio->valueint;
        if (IS_UNAVAILABLE_GPIO(g)) {
            validation_reason(reason, reason_len, "GPIO is unavailable/reserved on the authoritative target hardware");
            return ESP_ERR_INVALID_ARG;
        }
        if (strcmp(iface_s, "GPIO") == 0 || strcmp(iface_s, "ANALOG") == 0 || strcmp(iface_s, "ONE_WIRE") == 0) {
            int expected = expected_gpio_for_component(role_s, type_s);
            if (expected >= 0 && g != expected) {
                validation_reason(reason, reason_len, "GPIO deviates from canonical HARDWARE_WIRING_MAP.md");
                return ESP_ERR_INVALID_STATE;
            }
            if (operational && expected < 0 && strcmp(iface_s, "GPIO") == 0) {
                validation_reason(reason, reason_len, "operational GPIO component has no canonical physical mapping; pin is unspecified");
                return ESP_ERR_INVALID_STATE;
            }
        }
    } else if (operational && expected_gpio_for_component(role_s, type_s) >= 0 &&
               (strcmp(iface_s, "GPIO") == 0 || strcmp(iface_s, "ANALOG") == 0 || strcmp(iface_s, "ONE_WIRE") == 0)) {
        validation_reason(reason, reason_len, "operational physical component is missing its canonical GPIO");
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *pol = cJSON_GetObjectItem(wiring, "polarity");
    if (pol && cJSON_IsString(pol) && expected_role_is_actuator(role_s) && strcmp(pol->valuestring, "ACTIVE_LOW") != 0) {
        validation_reason(reason, reason_len, "mapped actuator polarity must be ACTIVE_LOW per canonical wiring contract");
        return ESP_ERR_INVALID_STATE;
    }
    return ESP_OK;
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
        ESP_LOGE(TAG, "Failed to parse active configuration: invalid JSON syntax");
        return ESP_ERR_INVALID_ARG;
    }

    const system_storage_state_t *storage_state = storage_mgr_get_state();
    cJSON *version = cJSON_GetObjectItem(root, "version");
    cJSON *complex_id = cJSON_GetObjectItem(root, "complexId");
    if (!version || !cJSON_IsNumber(version) || version->valuedouble < 1.0 ||
        version->valuedouble != (double)version->valueint) {
        ESP_LOGE(TAG, "Active configuration missing a valid version");
        cJSON_Delete(root);
        return ESP_ERR_INVALID_ARG;
    }
    if (storage_state && storage_state->config_version != 0 &&
        (uint32_t)version->valueint != storage_state->config_version) {
        ESP_LOGE(TAG, "Active configuration version mismatch: JSON=%lu state=%lu",
                 (unsigned long)version->valueint, (unsigned long)storage_state->config_version);
        cJSON_Delete(root);
        return ESP_ERR_INVALID_STATE;
    }
    if (!complex_id || !cJSON_IsString(complex_id) || complex_id->valuestring[0] == '\0' ||
        (storage_state && storage_state->complex_id[0] != '\0' && strcmp(complex_id->valuestring, storage_state->complex_id) != 0)) {
        ESP_LOGE(TAG, "Active configuration complexId is missing or does not match device assignment");
        cJSON_Delete(root);
        return ESP_ERR_INVALID_STATE;
    }

    cJSON *arr = cJSON_GetObjectItem(root, "components");
    if (!arr || !cJSON_IsArray(arr)) {
        ESP_LOGE(TAG, "Active configuration missing required 'components' array");
        cJSON_Delete(root);
        return ESP_ERR_INVALID_ARG;
    }

    int count = cJSON_GetArraySize(arr);
    if (count < 0 || count > MAX_HW_COMPONENTS) {
        ESP_LOGE(TAG, "Active configuration component count out of bounds: %d", count);
        cJSON_Delete(root);
        return ESP_ERR_INVALID_SIZE;
    }

    /* Parse into a temporary registry and commit only after every component
     * passes structural/runtime-binding checks. This prevents a malformed
     * candidate from partially replacing the currently active registry. */
    hw_component_info_t parsed_components[MAX_HW_COMPONENTS] = {0};
    size_t parsed_count = 0;

    for (int i = 0; i < count; ++i) {
        cJSON *item = cJSON_GetArrayItem(arr, i);
        if (!item || !cJSON_IsObject(item)) {
            ESP_LOGE(TAG, "Component[%d] must be an object", i);
            cJSON_Delete(root);
            return ESP_ERR_INVALID_ARG;
        }

        cJSON *j_id = cJSON_GetObjectItem(item, "componentId");
        cJSON *j_type = cJSON_GetObjectItem(item, "supportedTypeId");
        cJSON *j_name = cJSON_GetObjectItem(item, "name");
        cJSON *j_life = cJSON_GetObjectItem(item, "lifecycleState");
        cJSON *j_dep = cJSON_GetObjectItem(item, "deploymentStatus");
        cJSON *j_params = cJSON_GetObjectItem(item, "parameters");
        cJSON *j_assignment = cJSON_GetObjectItem(item, "assignment");
        cJSON *j_wiring = cJSON_GetObjectItem(item, "wiring");
        cJSON *j_role = cJSON_GetObjectItem(item, "role");
        cJSON *j_resid = cJSON_GetObjectItem(item, "resourceId");

        if (!is_string_within(j_id, sizeof(parsed_components[0].component_id)) ||
            !is_string_within(j_type, sizeof(parsed_components[0].supported_type_id)) ||
            !is_string_within(j_name, sizeof(parsed_components[0].name)) ||
            !j_params || !cJSON_IsObject(j_params) ||
            !j_life || !cJSON_IsString(j_life) ||
            !j_dep || !cJSON_IsString(j_dep)) {
            ESP_LOGE(TAG, "Component[%d] missing canonical required fields", i);
            cJSON_Delete(root);
            return ESP_ERR_INVALID_ARG;
        }

        for (size_t j = 0; j < parsed_count; ++j) {
            if (strcmp(parsed_components[j].component_id, j_id->valuestring) == 0) {
                ESP_LOGE(TAG, "Duplicate active componentId '%s'", j_id->valuestring);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
        }

        hw_lifecycle_state_t lifecycle;
        hw_deployment_status_t deployment;
        if (!parse_lifecycle(j_life->valuestring, &lifecycle) ||
            !parse_deployment(j_dep->valuestring, &deployment)) {
            ESP_LOGE(TAG, "Component[%d] has invalid lifecycle/deployment enum", i);
            cJSON_Delete(root);
            return ESP_ERR_INVALID_ARG;
        }

        char wiring_reason[160] = {0};
        esp_err_t wiring_validation = hardware_registry_validate_component_json(item, wiring_reason, sizeof(wiring_reason));
        if (wiring_validation != ESP_OK) {
            ESP_LOGE(TAG, "Component[%d] rejected by canonical hardware pin policy: %s", i, wiring_reason);
            cJSON_Delete(root);
            return wiring_validation;
        }

        cJSON *j_wiring_for_gpio = cJSON_GetObjectItem(item, "wiring");
        cJSON *j_gpio_for_dup = j_wiring_for_gpio ? cJSON_GetObjectItem(j_wiring_for_gpio, "gpio") : NULL;
        if (j_gpio_for_dup && cJSON_IsNumber(j_gpio_for_dup)) {
            for (size_t j = 0; j < parsed_count; ++j) {
                if (parsed_components[j].wiring.gpio >= 0 && parsed_components[j].wiring.gpio == j_gpio_for_dup->valueint) {
                    ESP_LOGE(TAG, "Duplicate physical GPIO %d used by component '%s' and '%s'",
                             j_gpio_for_dup->valueint, parsed_components[j].component_id, j_id->valuestring);
                    cJSON_Delete(root);
                    return ESP_ERR_INVALID_STATE;
                }
            }
        }

        hw_component_info_t *dst = &parsed_components[parsed_count];
        memset(dst, 0, sizeof(*dst));
        safe_copy_str(dst->component_id, sizeof(dst->component_id), j_id->valuestring, NULL);
        safe_copy_str(dst->supported_type_id, sizeof(dst->supported_type_id), j_type->valuestring, NULL);
        safe_copy_str(dst->name, sizeof(dst->name), j_name->valuestring, NULL);
        dst->lifecycle_state = lifecycle;
        dst->deployment_status = deployment;

        if (j_role) {
            if (!cJSON_IsString(j_role) || strlen(j_role->valuestring) >= sizeof(dst->role)) {
                ESP_LOGE(TAG, "Component[%d] role is invalid", i);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
            safe_copy_str(dst->role, sizeof(dst->role), j_role->valuestring, NULL);
        }
        if (j_resid) {
            if (!cJSON_IsString(j_resid) || strlen(j_resid->valuestring) >= sizeof(dst->resource_id)) {
                ESP_LOGE(TAG, "Component[%d] resourceId is invalid", i);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
            safe_copy_str(dst->resource_id, sizeof(dst->resource_id), j_resid->valuestring, NULL);
        }

        if (j_assignment) {
            if (!cJSON_IsObject(j_assignment)) {
                ESP_LOGE(TAG, "Component[%d] assignment must be an object", i);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
            cJSON *j_complex = cJSON_GetObjectItem(j_assignment, "complexId");
            cJSON *j_gh = cJSON_GetObjectItem(j_assignment, "ghId");
            if (!is_string_within(j_complex, sizeof(dst->assignment.complex_id))) {
                ESP_LOGE(TAG, "Component[%d] assignment.complexId is required and invalid", i);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
            if (storage_state && storage_state->complex_id[0] != '\0' &&
                strcmp(j_complex->valuestring, storage_state->complex_id) != 0) {
                ESP_LOGE(TAG, "Component[%d] assignment.complexId does not match device Complex", i);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_STATE;
            }
            if (j_gh && !is_string_within(j_gh, sizeof(dst->assignment.gh_id))) {
                ESP_LOGE(TAG, "Component[%d] assignment.ghId is invalid", i);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
            safe_copy_str(dst->assignment.complex_id, sizeof(dst->assignment.complex_id), j_complex->valuestring, NULL);
            if (j_gh) safe_copy_str(dst->assignment.gh_id, sizeof(dst->assignment.gh_id), j_gh->valuestring, NULL);
        }

        if ((lifecycle == HW_LIFECYCLE_COMMISSIONED || lifecycle == HW_LIFECYCLE_ENABLED) && !j_wiring) {
            ESP_LOGE(TAG, "Component[%d] operational lifecycle requires wiring metadata", i);
            cJSON_Delete(root);
            return ESP_ERR_INVALID_ARG;
        }

        dst->wiring.gpio = -1;
        dst->wiring.channel = -1;
        if (j_wiring) {
            if (!cJSON_IsObject(j_wiring)) {
                ESP_LOGE(TAG, "Component[%d] wiring must be an object", i);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
            cJSON *j_iface = cJSON_GetObjectItem(j_wiring, "interface");
            if (!j_iface || !cJSON_IsString(j_iface) || !parse_interface(j_iface->valuestring, &dst->wiring.interface)) {
                ESP_LOGE(TAG, "Component[%d] has invalid wiring interface", i);
                cJSON_Delete(root);
                return ESP_ERR_INVALID_ARG;
            }
            cJSON *j_gpio = cJSON_GetObjectItem(j_wiring, "gpio");
            cJSON *j_chan = cJSON_GetObjectItem(j_wiring, "channel");
            cJSON *j_addr = cJSON_GetObjectItem(j_wiring, "address");
            cJSON *j_port = cJSON_GetObjectItem(j_wiring, "port");
            cJSON *j_pol = cJSON_GetObjectItem(j_wiring, "polarity");

            if (j_gpio) {
                if (!is_nonnegative_integer(j_gpio) || j_gpio->valueint > 48) {
                    ESP_LOGE(TAG, "Component[%d] GPIO pin is out of range", i);
                    cJSON_Delete(root);
                    return ESP_ERR_INVALID_ARG;
                }
                dst->wiring.gpio = (int8_t)j_gpio->valueint;
            }
            if (j_chan) {
                if (!is_nonnegative_integer(j_chan) || j_chan->valueint > 127) {
                    ESP_LOGE(TAG, "Component[%d] wiring channel is out of range", i);
                    cJSON_Delete(root);
                    return ESP_ERR_INVALID_ARG;
                }
                dst->wiring.channel = (int8_t)j_chan->valueint;
            }
            if (j_addr) {
                if (!cJSON_IsString(j_addr) || strlen(j_addr->valuestring) >= sizeof(dst->wiring.address)) {
                    ESP_LOGE(TAG, "Component[%d] wiring address is invalid", i);
                    cJSON_Delete(root);
                    return ESP_ERR_INVALID_ARG;
                }
                safe_copy_str(dst->wiring.address, sizeof(dst->wiring.address), j_addr->valuestring, NULL);
            }
            if (j_port) {
                if (!cJSON_IsString(j_port) || strlen(j_port->valuestring) >= sizeof(dst->wiring.port)) {
                    ESP_LOGE(TAG, "Component[%d] wiring port is invalid", i);
                    cJSON_Delete(root);
                    return ESP_ERR_INVALID_ARG;
                }
                safe_copy_str(dst->wiring.port, sizeof(dst->wiring.port), j_port->valuestring, NULL);
            }
            if (j_pol) {
                if (!cJSON_IsString(j_pol) ||
                    (strcmp(j_pol->valuestring, "ACTIVE_HIGH") != 0 && strcmp(j_pol->valuestring, "ACTIVE_LOW") != 0)) {
                    ESP_LOGE(TAG, "Component[%d] wiring polarity is invalid", i);
                    cJSON_Delete(root);
                    return ESP_ERR_INVALID_ARG;
                }
                safe_copy_str(dst->wiring.polarity, sizeof(dst->wiring.polarity), j_pol->valuestring, NULL);
            }
        }

        char *param_str = cJSON_PrintUnformatted(j_params);
        if (!param_str || strlen(param_str) >= sizeof(dst->parameters_json)) {
            free(param_str);
            ESP_LOGE(TAG, "Component[%d] parameters exceed runtime buffer", i);
            cJSON_Delete(root);
            return ESP_ERR_NO_MEM;
        }
        safe_copy_str(dst->parameters_json, sizeof(dst->parameters_json), param_str, "{}");
        free(param_str);
        ++parsed_count;
    }

    memcpy(s_active_components, parsed_components, sizeof(parsed_components));
    s_active_count = parsed_count;
    cJSON_Delete(root);
    ESP_LOGI(TAG, "Active configuration registry applied atomically: %u components", (unsigned)s_active_count);
    return ESP_OK;
}

esp_err_t hardware_hal_init_all(void)
{
    ESP_LOGI(TAG, "Initializing all hardware HAL subsystems from active configuration...");

    char *json_buf = (char *)malloc(8192);
    bool load_success = false;
    if (json_buf) {
        size_t json_len = 0;
        esp_err_t load_err = storage_mgr_load_config(json_buf, 8192, &json_len);
        if (load_err == ESP_OK && json_len > 0) {
            if (hardware_registry_load_from_json(json_buf) == ESP_OK) {
                load_success = true;
            } else {
                ESP_LOGE(TAG, "Persisted active configuration is invalid; registry remains unavailable.");
            }
        } else {
            ESP_LOGW(TAG, "No persisted active configuration available (err=0x%x).", (unsigned)load_err);
        }
        free(json_buf);
    } else {
        ESP_LOGE(TAG, "Failed to allocate configuration buffer");
    }

    if (!load_success) {
        /* Safe-empty is the only allowed behavior without a validated active
         * configuration. Legacy components.json is migration input only and is
         * never loaded implicitly by the production boot path. */
        hardware_registry_clear();
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

