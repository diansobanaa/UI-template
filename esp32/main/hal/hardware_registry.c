#include "hal/hardware_registry.h"
#include "hal/button_hal.h"
#include "config/pin_config.h"
#include "esp_log.h"

static const char *TAG = "HW_REGISTRY";

static const hw_component_info_t s_components[] = {
    { "pump_well",        "Well Pump",             "PUMP",        "WELL_PUMP",        PIN_OUT_WELL_PUMP,       "CRITICAL",   "AVAILABLE" },
    { "pump_dist",        "Distribution Pump",     "PUMP",        "DIST_PUMP",        PIN_OUT_DIST_PUMP,       "CRITICAL",   "AVAILABLE" },
    { "pump_submersible", "Raw Submersible Pump",  "PUMP",        "RAW_SUBMERSIBLE",  PIN_OUT_RAW_SUBMERSIBLE, "NORMAL",     "AVAILABLE" },
    { "pump_dosing_a",    "Dosing Pump A",         "PUMP",        "DOSING_A",         PIN_OUT_DOSING_A,        "CRITICAL",   "AVAILABLE" },
    { "pump_dosing_b",    "Dosing Pump B",         "PUMP",        "DOSING_B",         PIN_OUT_DOSING_B,        "CRITICAL",   "AVAILABLE" },
    { "fan_cooling",      "Cooling Fan",           "ACTUATOR",    "COOLING_FAN",      PIN_OUT_COOLING_FAN,     "NORMAL",     "AVAILABLE" },
    { "lamp_error",       "Error Lamp",            "INDICATOR",   "ERROR_LAMP",       PIN_OUT_ERROR_LAMP,      "MONITORING", "AVAILABLE" },
    { "flow_yfb1",        "YF-B1 Flow Meter",      "FLOW_METER",  "FLOW_DOSING",      PIN_IN_FLOW_YFB1,        "MONITORING", "AVAILABLE" },
    { "flow_fs400a",      "FS400A Flow Meter",     "FLOW_METER",  "FLOW_DIST",        PIN_IN_FLOW_FS400A,      "MONITORING", "AVAILABLE" },
    { "temp_ds18b20",     "DS18B20 Temp Sensor",   "SENSOR",      "WATER_TEMP",       PIN_IN_TEMP_DS18B20,     "MONITORING", "AVAILABLE" },
    { "float_lower",      "Lower Float Switch",    "SENSOR",      "TANK_LEVEL_LOW",   PIN_IN_FLOAT_LOWER,      "CRITICAL",   "AVAILABLE" },
    { "btn_mode",         "Mode Button",           "INPUT",       "BTN_MODE",         PIN_BTN_MODE,            "NORMAL",     "AVAILABLE" },
    { "btn_manual_a",     "Manual A Button",       "INPUT",       "BTN_MAN_A",        PIN_BTN_MANUAL_A,        "NORMAL",     "AVAILABLE" },
    { "btn_manual_b",     "Manual B Button",       "INPUT",       "BTN_MAN_B",        PIN_BTN_MANUAL_B,        "NORMAL",     "AVAILABLE" },
    { "btn_dist",         "Distribution Button",   "INPUT",       "BTN_DIST",         PIN_BTN_DISTRIBUTION,    "NORMAL",     "AVAILABLE" },
};

static void on_button_event(button_id_t btn, bool pressed)
{
    ESP_LOGI(TAG, "Hardware Button %d event: %s", btn, pressed ? "PRESSED" : "RELEASED");
}

esp_err_t hardware_hal_init_all(void)
{
    ESP_LOGI(TAG, "Initializing all hardware HAL subsystems...");

    ESP_ERROR_CHECK(actuator_hal_init());
    ESP_ERROR_CHECK(sensor_hal_init());
    ESP_ERROR_CHECK(button_hal_init(on_button_event));

    ESP_LOGI(TAG, "Hardware HAL initialization complete. Total components: %d", (int)(sizeof(s_components) / sizeof(s_components[0])));
    return ESP_OK;
}

size_t hardware_registry_get_count(void)
{
    return sizeof(s_components) / sizeof(s_components[0]);
}

esp_err_t hardware_registry_get_by_index(size_t index, hw_component_info_t *out_info)
{
    if (index >= hardware_registry_get_count() || !out_info) return ESP_ERR_INVALID_ARG;
    *out_info = s_components[index];
    return ESP_OK;
}
