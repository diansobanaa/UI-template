#include "hal/sensor_hal.h"
#include "config/pin_config.h"
#include "config/system_config.h"
#include "services/calibration_mgr.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "driver/adc.h"
#include "rom/ets_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "SENSOR_HAL";

/* Flow meter specifications:
 * 1. RAW WATER FLOW METER: Model ZJ-B1 (Flow range 1-25 L/min, pressure <= 1.75 MPa)
 *    Pulse-frequency characteristic: UNVERIFIED / CALIBRATION REQUIRED.
 *    DO NOT invent pulse-per-liter or assume a constant without calibration.
 *    Default factor: 0.0f (CALIBRATION REQUIRED).
 * 2. FERTIGATION FLOW METER: Model FS400A G1" (Plastic, 1-60 L/min, pressure <= 1.75 MPa)
 *    Canonical contract characteristic: F = 4.8 * Q (Hz, with Q in L/min).
 *    Canonical volume relationship: 4.8 * 60 = 288.0 pulses/L.
 *    Physical acceptance still requires calibration evidence; this is only the SSOT nominal characteristic.
 */
#define FS400A_PULSES_PER_LITER_DEFAULT    288.0f
#define ZJB1_PULSES_PER_LITER_DEFAULT      0.0f   /* CALIBRATION REQUIRED / UNVERIFIED */

/* Backward compatibility aliases (OBSOLETE) */
#define YFB1_PULSES_PER_LITER              ZJB1_PULSES_PER_LITER_DEFAULT
#define FS400A_PULSES_PER_LITER            FS400A_PULSES_PER_LITER_DEFAULT

static volatile uint32_t s_pulses_raw_zjb1 = 0;
static volatile uint32_t s_pulses_fert_fs400a = 0;
#define s_pulses_yfb1 s_pulses_raw_zjb1
#define s_pulses_fs400a s_pulses_fert_fs400a

static uint32_t s_last_pulses_zjb1 = 0;
static uint32_t s_last_pulses_fs400a = 0;
static int64_t s_last_flow_calc_us = 0;

static sensor_readings_t s_current_readings = {0};
static SemaphoreHandle_t s_sensor_lock = NULL;

#define MAX_GENERIC_SENSOR_SAMPLES 32
#define MAX_GENERIC_FLOW_SENSORS 8

typedef struct {
    bool used;
    char sensor_id[40];
    sensor_component_sample_t sample;
} generic_sensor_sample_slot_t;

static generic_sensor_sample_slot_t s_generic_samples[MAX_GENERIC_SENSOR_SAMPLES];

typedef struct {
    bool used;
    char sensor_id[40];
    int gpio;
    volatile uint32_t pulses;
    uint32_t last_pulses;
    int64_t last_calc_us;
    float flow_lpm;
} generic_flow_runtime_t;

static generic_flow_runtime_t s_generic_flows[MAX_GENERIC_FLOW_SENSORS];

static bool generic_parse_descriptor(const hw_component_info_t *info, sensor_descriptor_t *out);

static void IRAM_ATTR generic_flow_isr(void *arg)
{
    generic_flow_runtime_t *slot = (generic_flow_runtime_t *)arg;
    if (slot) slot->pulses++;
}

typedef enum {
    DS18B20_STATE_IDLE = 0,
    DS18B20_STATE_WAIT_CONV
} ds18b20_state_t;

static ds18b20_state_t s_ds18b20_state = DS18B20_STATE_IDLE;
static uint32_t s_ds18b20_start_tick = 0;

static void IRAM_ATTR zjb1_isr_handler(void *arg)
{
    s_pulses_raw_zjb1++;
}

static void IRAM_ATTR fs400a_isr_handler(void *arg)
{
    s_pulses_fert_fs400a++;
}

#define yfb1_isr_handler zjb1_isr_handler

/* Minimal 1-Wire DS18B20 Driver */
static esp_err_t ds18b20_reset(gpio_num_t pin)
{
    gpio_set_direction(pin, GPIO_MODE_OUTPUT);
    gpio_set_level(pin, 0);
    ets_delay_us(480);
    gpio_set_direction(pin, GPIO_MODE_INPUT);
    ets_delay_us(70);
    int presence = gpio_get_level(pin);
    ets_delay_us(410);
    return (presence == 0) ? ESP_OK : ESP_ERR_NOT_FOUND;
}

static void ds18b20_write_bit(gpio_num_t pin, int bit)
{
    gpio_set_direction(pin, GPIO_MODE_OUTPUT);
    gpio_set_level(pin, 0);
    if (bit) {
        ets_delay_us(6);
        gpio_set_direction(pin, GPIO_MODE_INPUT);
        ets_delay_us(64);
    } else {
        ets_delay_us(60);
        gpio_set_direction(pin, GPIO_MODE_INPUT);
        ets_delay_us(10);
    }
}

static int ds18b20_read_bit(gpio_num_t pin)
{
    gpio_set_direction(pin, GPIO_MODE_OUTPUT);
    gpio_set_level(pin, 0);
    ets_delay_us(2);
    gpio_set_direction(pin, GPIO_MODE_INPUT);
    ets_delay_us(10);
    int bit = gpio_get_level(pin);
    ets_delay_us(55);
    return bit;
}

static void ds18b20_write_byte(gpio_num_t pin, uint8_t byte)
{
    for (int i = 0; i < 8; i++) {
        ds18b20_write_bit(pin, (byte >> i) & 1);
    }
}

static uint8_t ds18b20_read_byte(gpio_num_t pin)
{
    uint8_t byte = 0;
    for (int i = 0; i < 8; i++) {
        if (ds18b20_read_bit(pin)) {
            byte |= (1 << i);
        }
    }
    return byte;
}

static esp_err_t ds18b20_start_conversion(gpio_num_t pin)
{
    if (ds18b20_reset(pin) != ESP_OK) return ESP_ERR_NOT_FOUND;
    ds18b20_write_byte(pin, 0xCC); /* Skip ROM */
    ds18b20_write_byte(pin, 0x44); /* Start Convert */
    return ESP_OK;
}

static sensor_state_t ds18b20_read_result(gpio_num_t pin, float *out_temp)
{
    if (ds18b20_reset(pin) != ESP_OK) return SENSOR_STATE_DISCONNECTED;
    ds18b20_write_byte(pin, 0xCC); /* Skip ROM */
    ds18b20_write_byte(pin, 0xBE); /* Read Scratchpad */

    uint8_t lsb = ds18b20_read_byte(pin);
    uint8_t msb = ds18b20_read_byte(pin);

    int16_t raw = (int16_t)((msb << 8) | lsb);
    *out_temp = (float)raw / 16.0f;
    
    if (*out_temp <= -55.0f || *out_temp >= 125.0f) {
        return SENSOR_STATE_OUT_OF_RANGE;
    }
    
    return SENSOR_STATE_VALID;
}


static int gpio_to_adc1_channel(int gpio)
{
    /* M17: the canonical hardware wiring contract does not assign any
     * physical humidity/light/pressure/pH/EC sensor to an ADC GPIO.
     * Never infer a sensor pin from the generic ESP32 ADC numbering because
     * GPIO1..10 are already owned by mapped actuators/I2C in this design. */
    (void)gpio;
    return -1;
}

static generic_sensor_sample_slot_t *generic_sample_slot(const char *sensor_id)
{
    if (!sensor_id || !sensor_id[0]) return NULL;
    for (size_t i = 0; i < MAX_GENERIC_SENSOR_SAMPLES; ++i) {
        if (s_generic_samples[i].used && strcmp(s_generic_samples[i].sensor_id, sensor_id) == 0) return &s_generic_samples[i];
    }
    for (size_t i = 0; i < MAX_GENERIC_SENSOR_SAMPLES; ++i) {
        if (!s_generic_samples[i].used) {
            s_generic_samples[i].used = true;
            strncpy(s_generic_samples[i].sensor_id, sensor_id, sizeof(s_generic_samples[i].sensor_id) - 1);
            s_generic_samples[i].sensor_id[sizeof(s_generic_samples[i].sensor_id) - 1] = '\0';
            return &s_generic_samples[i];
        }
    }
    return NULL;
}

static generic_flow_runtime_t *generic_flow_slot(const char *sensor_id)
{
    if (!sensor_id || !sensor_id[0]) return NULL;
    for (size_t i = 0; i < MAX_GENERIC_FLOW_SENSORS; ++i) {
        if (s_generic_flows[i].used && strcmp(s_generic_flows[i].sensor_id, sensor_id) == 0) return &s_generic_flows[i];
    }
    return NULL;
}

static bool is_fixed_flow_gpio(int gpio)
{
    return gpio == PIN_IN_FLOW_RAW_ZJB1 || gpio == PIN_IN_FLOW_FERT_FS400A;
}

static bool analog_sensor_type(sensor_type_t type)
{
    return type == SENSOR_TYPE_HUMIDITY || type == SENSOR_TYPE_LIGHT ||
           type == SENSOR_TYPE_PRESSURE || type == SENSOR_TYPE_PH ||
           type == SENSOR_TYPE_EC;
}

static bool generic_sensor_requires_linear_calibration(sensor_type_t type)
{
    return type == SENSOR_TYPE_HUMIDITY || type == SENSOR_TYPE_LIGHT ||
           type == SENSOR_TYPE_PRESSURE || type == SENSOR_TYPE_PH ||
           type == SENSOR_TYPE_EC || type == SENSOR_TYPE_LEVEL;
}

static esp_err_t read_generic_analog_sample(const hw_component_info_t *info,
                                             const sensor_descriptor_t *descriptor,
                                             sensor_component_sample_t *sample)
{
    int gpio = info ? info->wiring.gpio : -1;
    int channel = gpio_to_adc1_channel(gpio);
    if (info && info->wiring.channel >= 0 && info->wiring.channel <= 9) channel = info->wiring.channel;
    if (channel < 0 || channel > 9) {
        sample->state = SENSOR_STATE_UNAVAILABLE;
        sample->has_value = false;
        return ESP_ERR_NOT_SUPPORTED;
    }
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten((adc1_channel_t)channel, ADC_ATTEN_DB_11);
    int raw = adc1_get_raw((adc1_channel_t)channel);
    if (raw < 0 || raw > 4095) {
        sample->state = SENSOR_STATE_DISCONNECTED;
        sample->has_value = false;
        return ESP_ERR_INVALID_STATE;
    }
    float value = (float)raw;
    cJSON *params = cJSON_Parse(info->parameters_json[0] ? info->parameters_json : "{}");
    if (params) {
        cJSON *v = cJSON_GetObjectItem(params, "rawScale");
        if (v && cJSON_IsNumber(v)) value *= (float)v->valuedouble;
        v = cJSON_GetObjectItem(params, "rawOffset");
        if (v && cJSON_IsNumber(v)) value += (float)v->valuedouble;
        cJSON_Delete(params);
    }

    if (generic_sensor_requires_linear_calibration(descriptor->sensor_type)) {
        if (!descriptor->calibration_reference[0] || !descriptor->calibration_type[0] || descriptor->calibration_version == 0) {
            sample->state = SENSOR_STATE_UNAVAILABLE;
            sample->has_value = false;
            return ESP_ERR_INVALID_STATE;
        }
        calibration_record_t cal;
        if (calibration_mgr_get_record_exact(info->component_id, descriptor->calibration_type,
                                             descriptor->calibration_reference, descriptor->calibration_version, &cal) != ESP_OK ||
            calibration_mgr_is_usable(&cal) != ESP_OK || !cal.has_linear ||
            strcmp(cal.calibration_id, descriptor->calibration_reference) != 0 ||
            cal.version != descriptor->calibration_version) {
            sample->state = SENSOR_STATE_UNAVAILABLE;
            sample->has_value = false;
            return ESP_ERR_INVALID_STATE;
        }
        value = cal.slope * value + cal.offset;
    }
    sample->value = value;
    sample->has_value = true;
    sample->state = SENSOR_STATE_VALID;
    return ESP_OK;
}

static void configure_generic_sensor_inputs(void)
{
    size_t count = hardware_registry_get_count();
    for (size_t i = 0; i < count; ++i) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) != ESP_OK) continue;
        if (info.lifecycle_state != HW_LIFECYCLE_COMMISSIONED && info.lifecycle_state != HW_LIFECYCLE_ENABLED) continue;
        sensor_descriptor_t d;
        if (!generic_parse_descriptor(&info, &d)) continue;

        if (d.sensor_type == SENSOR_TYPE_FLOW && info.wiring.gpio >= 0 && !is_fixed_flow_gpio(info.wiring.gpio)) {
            if (generic_flow_slot(info.component_id)) continue;
            generic_flow_runtime_t *slot = NULL;
            for (size_t k = 0; k < MAX_GENERIC_FLOW_SENSORS; ++k) {
                if (!s_generic_flows[k].used) { slot = &s_generic_flows[k]; break; }
            }
            if (!slot) continue;
            memset(slot, 0, sizeof(*slot));
            slot->used = true;
            strncpy(slot->sensor_id, info.component_id, sizeof(slot->sensor_id) - 1);
            slot->gpio = info.wiring.gpio;
            gpio_config_t flow_conf = {
                .mode = GPIO_MODE_INPUT,
                .pull_up_en = GPIO_PULLUP_ENABLE,
                .pull_down_en = GPIO_PULLDOWN_DISABLE,
                .intr_type = GPIO_INTR_NEGEDGE,
                .pin_bit_mask = (1ULL << slot->gpio)
            };
            if (gpio_config(&flow_conf) == ESP_OK) {
                gpio_isr_handler_add(slot->gpio, generic_flow_isr, slot);
            }
        } else if (d.sensor_type == SENSOR_TYPE_LEVEL && info.wiring.interface == HW_INTERFACE_GPIO &&
                   info.wiring.gpio >= 0 && info.wiring.gpio != PIN_IN_FLOAT_LOWER) {
            gpio_config_t level_conf = {
                .mode = GPIO_MODE_INPUT,
                .pull_up_en = GPIO_PULLUP_ENABLE,
                .pull_down_en = GPIO_PULLDOWN_DISABLE,
                .intr_type = GPIO_INTR_DISABLE,
                .pin_bit_mask = (1ULL << info.wiring.gpio)
            };
            (void)gpio_config(&level_conf);
        } else if (analog_sensor_type(d.sensor_type) ||
                   (d.sensor_type == SENSOR_TYPE_LEVEL && info.wiring.interface == HW_INTERFACE_ANALOG)) {
            /* ADC configuration is done per read because the channel may be selected by config. */
        }
    }
}

static void poll_generic_sensor_inputs(void)
{
    size_t count = hardware_registry_get_count();
    const int64_t now_ms = esp_timer_get_time() / 1000LL;
    for (size_t i = 0; i < count; ++i) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) != ESP_OK) continue;
        if (info.lifecycle_state != HW_LIFECYCLE_COMMISSIONED && info.lifecycle_state != HW_LIFECYCLE_ENABLED) continue;
        sensor_descriptor_t d;
        if (!generic_parse_descriptor(&info, &d)) continue;
        if (d.sensor_type == SENSOR_TYPE_TEMPERATURE ||
            d.sensor_type == SENSOR_TYPE_FLOW ||
            (d.sensor_type == SENSOR_TYPE_LEVEL && info.wiring.gpio == PIN_IN_FLOAT_LOWER)) continue;

        generic_sensor_sample_slot_t *slot = generic_sample_slot(info.component_id);
        if (!slot) continue;
        memset(&slot->sample, 0, sizeof(slot->sample));
        strncpy(slot->sample.sensor_id, info.component_id, sizeof(slot->sample.sensor_id) - 1);
        strncpy(slot->sample.unit, d.unit, sizeof(slot->sample.unit) - 1);
        strncpy(slot->sample.calibration_reference, d.calibration_reference, sizeof(slot->sample.calibration_reference) - 1);
        strncpy(slot->sample.calibration_type, d.calibration_type, sizeof(slot->sample.calibration_type) - 1);
        slot->sample.timestamp_ms = now_ms;
        if (!d.installed) {
            slot->sample.state = SENSOR_STATE_UNAVAILABLE;
            continue;
        }

        if (d.sensor_type == SENSOR_TYPE_LEVEL && info.wiring.interface == HW_INTERFACE_GPIO) {
            int level = gpio_get_level(info.wiring.gpio);
            int active_level = 1;
            cJSON *params = cJSON_Parse(info.parameters_json[0] ? info.parameters_json : "{}");
            if (params) {
                cJSON *v = cJSON_GetObjectItem(params, "activeLevel");
                if (v && cJSON_IsNumber(v)) active_level = v->valueint ? 1 : 0;
                cJSON_Delete(params);
            }
            slot->sample.value = level == active_level ? 1.0f : 0.0f;
            slot->sample.has_value = true;
            slot->sample.state = SENSOR_STATE_VALID;
        } else if (info.wiring.interface == HW_INTERFACE_ANALOG) {
            (void)read_generic_analog_sample(&info, &d, &slot->sample);
        } else {
            slot->sample.state = SENSOR_STATE_UNAVAILABLE;
        }
        if (slot->sample.has_value && d.has_validity_range &&
            (slot->sample.value < d.min_value || slot->sample.value > d.max_value)) {
            slot->sample.has_value = false;
            slot->sample.state = SENSOR_STATE_OUT_OF_RANGE;
        }
    }

    for (size_t i = 0; i < MAX_GENERIC_FLOW_SENSORS; ++i) {
        if (!s_generic_flows[i].used) continue;
        int64_t now_us = esp_timer_get_time();
        if (s_generic_flows[i].last_calc_us == 0) {
            s_generic_flows[i].last_calc_us = now_us;
            s_generic_flows[i].last_pulses = s_generic_flows[i].pulses;
            continue;
        }
        double dt = (double)(now_us - s_generic_flows[i].last_calc_us) / 1000000.0;
        if (dt < 1.0) continue;
        uint32_t pulses = s_generic_flows[i].pulses;
        uint32_t delta = pulses - s_generic_flows[i].last_pulses;
        s_generic_flows[i].last_pulses = pulses;
        s_generic_flows[i].last_calc_us = now_us;
        hw_component_info_t info;
        if (hardware_registry_find_by_id(s_generic_flows[i].sensor_id, &info) != ESP_OK) continue;
        sensor_descriptor_t d;
        if (!generic_parse_descriptor(&info, &d)) continue;
        generic_sensor_sample_slot_t *slot = generic_sample_slot(info.component_id);
        if (!slot) continue;
        memset(&slot->sample, 0, sizeof(slot->sample));
        strncpy(slot->sample.sensor_id, info.component_id, sizeof(slot->sample.sensor_id) - 1);
        strncpy(slot->sample.unit, d.unit, sizeof(slot->sample.unit) - 1);
        strncpy(slot->sample.calibration_reference, d.calibration_reference, sizeof(slot->sample.calibration_reference) - 1);
        strncpy(slot->sample.calibration_type, d.calibration_type, sizeof(slot->sample.calibration_type) - 1);
        slot->sample.timestamp_ms = now_ms;
        if (!d.calibration_reference[0] || !d.calibration_type[0] || d.calibration_version == 0 || strcasecmp(d.calibration_type, "FLOW") != 0) {
            slot->sample.state = SENSOR_STATE_UNAVAILABLE;
            continue;
        }
        calibration_record_t cal;
        if (calibration_mgr_get_record_exact(info.component_id, "FLOW", d.calibration_reference, d.calibration_version, &cal) != ESP_OK ||
            calibration_mgr_is_usable(&cal) != ESP_OK || !cal.has_pulses_per_liter || cal.pulses_per_liter <= 0) {
            slot->sample.state = SENSOR_STATE_UNAVAILABLE;
            continue;
        }
        s_generic_flows[i].flow_lpm = (float)(((double)delta / dt) * 60.0 / cal.pulses_per_liter);
        slot->sample.value = s_generic_flows[i].flow_lpm;
        slot->sample.has_value = true;
        slot->sample.state = SENSOR_STATE_VALID;
    }
}

esp_err_t sensor_hal_init(void)
{
    if (!s_sensor_lock) {
        s_sensor_lock = xSemaphoreCreateMutex();
    }

#if !FEATURE_SENSORS_ENABLED
    s_current_readings.temp_state = SENSOR_STATE_DISCONNECTED;
    s_current_readings.temperature_c = 0.0f;
    s_current_readings.float_lower_ok = true;
    s_current_readings.flow_rate_yfb1_lpm = 0.0f;
    s_current_readings.flow_rate_fs400a_lpm = 0.0f;
    s_current_readings.total_liters_yfb1 = 0.0f;
    s_current_readings.total_liters_fs400a = 0.0f;
    s_current_readings.tamper_loop_ok = true;
    s_current_readings.last_sample_timestamp = esp_timer_get_time() / 1000ULL;

    ESP_LOGW(TAG, "Sensor HAL DISABLED_FOR_BRINGUP (FEATURE_SENSORS_ENABLED=0). Operating in degraded mode.");
    return ESP_OK;
#else
    /* 1. Configure Pulse Inputs for Flow Meters */
    gpio_config_t flow_conf = {
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_NEGEDGE,
        .pin_bit_mask = (1ULL << PIN_IN_FLOW_RAW_ZJB1) | (1ULL << PIN_IN_FLOW_FERT_FS400A)
    };
    ESP_ERROR_CHECK(gpio_config(&flow_conf));

    /* Install ISR service if not already installed */
    gpio_install_isr_service(0);
    gpio_isr_handler_add(PIN_IN_FLOW_RAW_ZJB1, zjb1_isr_handler, NULL);
    gpio_isr_handler_add(PIN_IN_FLOW_FERT_FS400A, fs400a_isr_handler, NULL);

    configure_generic_sensor_inputs();

    /* 2. Configure Float Switch (active low or high depending on float orientation) */
    gpio_config_t float_conf = {
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
        .pin_bit_mask = (1ULL << PIN_IN_FLOAT_LOWER)
    };
    ESP_ERROR_CHECK(gpio_config(&float_conf));

    /* 3. Configure 1-Wire DS18B20 pin */
    gpio_set_direction(PIN_IN_TEMP_DS18B20, GPIO_MODE_INPUT);
    gpio_set_pull_mode(PIN_IN_TEMP_DS18B20, GPIO_PULLUP_ENABLE);

    /* 4. Configure Tamper Loop Security Pin */
    gpio_config_t tamper_conf = {
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
        .pin_bit_mask = (1ULL << PIN_IN_TAMPER_LOOP)
    };
    ESP_ERROR_CHECK(gpio_config(&tamper_conf));

    ESP_LOGI(TAG, "Sensor HAL initialized: ZJ-B1 Raw (GPIO %d), FS400A Fert (GPIO %d), DS18B20 (GPIO %d), Float (GPIO %d), Tamper (GPIO %d)",
             PIN_IN_FLOW_RAW_ZJB1, PIN_IN_FLOW_FERT_FS400A, PIN_IN_TEMP_DS18B20, PIN_IN_FLOAT_LOWER, PIN_IN_TAMPER_LOOP);

    return ESP_OK;
#endif
}

esp_err_t sensor_hal_reconfigure_from_registry(void)
{
#if !FEATURE_SENSORS_ENABLED
    return ESP_OK;
#else
    if (!s_sensor_lock) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_sensor_lock, portMAX_DELAY);
    for (size_t i = 0; i < MAX_GENERIC_FLOW_SENSORS; ++i) {
        if (s_generic_flows[i].used && s_generic_flows[i].gpio >= 0) {
            (void)gpio_isr_handler_remove(s_generic_flows[i].gpio);
        }
    }
    memset(s_generic_flows, 0, sizeof(s_generic_flows));
    memset(s_generic_samples, 0, sizeof(s_generic_samples));
    configure_generic_sensor_inputs();
    xSemaphoreGive(s_sensor_lock);
    return ESP_OK;
#endif
}

esp_err_t sensor_hal_poll(void)
{
    if (!s_sensor_lock) return ESP_ERR_INVALID_STATE;

#if !FEATURE_SENSORS_ENABLED
    xSemaphoreTake(s_sensor_lock, portMAX_DELAY);
    s_current_readings.temp_state = SENSOR_STATE_DISCONNECTED;
    s_current_readings.last_sample_timestamp = esp_timer_get_time() / 1000ULL;
    xSemaphoreGive(s_sensor_lock);
    return ESP_OK;
#else
    xSemaphoreTake(s_sensor_lock, portMAX_DELAY);

    /* Float Switch: Level 1 = OK (float floating), Level 0 = LOW (tank low) */
    s_current_readings.float_lower_ok = (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_OK);

    /* Tamper Loop: Level 0 = OK (closed to GND), Level 1 = LOW (tampered/cut, pulled high) */
    s_current_readings.tamper_loop_ok = (gpio_get_level(PIN_IN_TAMPER_LOOP) == TAMPER_LOOP_OK);

    /* DS18B20 Temperature Reading - Non Blocking */
    float temp_val = 0.0f;
    
    if (s_ds18b20_state == DS18B20_STATE_IDLE) {
        if (ds18b20_start_conversion(PIN_IN_TEMP_DS18B20) == ESP_OK) {
            s_ds18b20_state = DS18B20_STATE_WAIT_CONV;
            s_ds18b20_start_tick = xTaskGetTickCount();
        } else {
            s_current_readings.temp_state = SENSOR_STATE_DISCONNECTED;
        }
    } else if (s_ds18b20_state == DS18B20_STATE_WAIT_CONV) {
        if ((xTaskGetTickCount() - s_ds18b20_start_tick) >= pdMS_TO_TICKS(750)) {
            s_current_readings.temp_state = ds18b20_read_result(PIN_IN_TEMP_DS18B20, &temp_val);
            if (s_current_readings.temp_state == SENSOR_STATE_VALID) {
                s_current_readings.temperature_c = temp_val;
            }
            s_ds18b20_state = DS18B20_STATE_IDLE; // Ready for next cycle
        }
    }

    /* Flow Calculations & Time-Differential Sampling */
    int64_t now_us = esp_timer_get_time();
    float dt_sec = (float)(now_us - s_last_flow_calc_us) / 1000000.0f;

    /* 1. Raw Water Flow Meter (ZJ-B1, 1-25 L/min) */
    s_current_readings.total_pulses_raw_zjb1 = s_pulses_raw_zjb1;
    float zjb1_cal = calibration_mgr_get_flow_raw_pulses_per_l();
    if (zjb1_cal > 0.0f) {
        s_current_readings.total_liters_raw_zjb1 = (float)s_pulses_raw_zjb1 / zjb1_cal;
        s_current_readings.total_ml_raw_zjb1 = (uint32_t)((s_pulses_raw_zjb1 * 1000.0f) / zjb1_cal);
        s_current_readings.raw_zjb1_calibrated = true;
    } else {
        /* CALIBRATION REQUIRED / UNVERIFIED: do not invent volume without physical calibration */
        s_current_readings.total_liters_raw_zjb1 = 0.0f;
        s_current_readings.total_ml_raw_zjb1 = 0;
        s_current_readings.raw_zjb1_calibrated = false;
    }

    /* 2. Fertigation Delivery Flow Meter (FS400A G1") */
    s_current_readings.total_pulses_fert_fs400a = s_pulses_fert_fs400a;
    float fs400a_cal = calibration_mgr_get_flow_fert_pulses_per_l();
    if (fs400a_cal > 0.0f) {
        s_current_readings.total_liters_fert_fs400a = (float)s_pulses_fert_fs400a / fs400a_cal;
        s_current_readings.total_ml_fert_fs400a = (uint32_t)((s_pulses_fert_fs400a * 1000.0f) / fs400a_cal);
        s_current_readings.fert_fs400a_calibrated = true;
    } else {
        s_current_readings.total_liters_fert_fs400a = 0.0f;
        s_current_readings.total_ml_fert_fs400a = 0;
        s_current_readings.fert_fs400a_calibrated = false;
    }

    /* Flow Rate Calculations (L/min) evaluated once per second */
    if (dt_sec >= 1.0f) {
        uint32_t d_pulses_zjb1 = s_pulses_raw_zjb1 - s_last_pulses_zjb1;
        uint32_t d_pulses_fs400a = s_pulses_fert_fs400a - s_last_pulses_fs400a;
        s_last_pulses_zjb1 = s_pulses_raw_zjb1;
        s_last_pulses_fs400a = s_pulses_fert_fs400a;
        s_last_flow_calc_us = now_us;

        if (fs400a_cal > 0.0f) {
            float freq_fs400a = (float)d_pulses_fs400a / dt_sec;
            s_current_readings.flow_rate_fert_fs400a_lpm = (freq_fs400a * 60.0f) / fs400a_cal;
        } else {
            s_current_readings.flow_rate_fert_fs400a_lpm = 0.0f;
        }

        /* ZJ-B1: Q (L/min) = (pulses / dt) * 60 / pulses_per_L */
        if (zjb1_cal > 0.0f) {
            float freq_zjb1 = (float)d_pulses_zjb1 / dt_sec;
            s_current_readings.flow_rate_raw_zjb1_lpm = (freq_zjb1 * 60.0f) / zjb1_cal;
        } else {
            s_current_readings.flow_rate_raw_zjb1_lpm = 0.0f; /* CALIBRATION REQUIRED */
        }
    }

    poll_generic_sensor_inputs();

    s_current_readings.last_sample_timestamp = esp_timer_get_time() / 1000ULL;

    xSemaphoreGive(s_sensor_lock);
    return ESP_OK;
#endif
}

esp_err_t sensor_hal_get_readings(sensor_readings_t *out_readings)
{
    if (!out_readings) return ESP_ERR_INVALID_ARG;
    if (!s_sensor_lock) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_sensor_lock, portMAX_DELAY);
    *out_readings = s_current_readings;
    xSemaphoreGive(s_sensor_lock);

    return ESP_OK;
}

void sensor_hal_reset_counters(void)
{
    s_pulses_raw_zjb1 = 0;
    s_pulses_fert_fs400a = 0;
    s_last_pulses_zjb1 = 0;
    s_last_pulses_fs400a = 0;
}

/* ---------------- Generic configuration-driven sensor abstraction (M11) ---------------- */
#include "hal/hardware_registry.h"
#include "cJSON.h"
#include <strings.h>
#include <stdio.h>

static sensor_type_t generic_sensor_type(const hw_component_info_t *info)
{
    char text[96];
    snprintf(text, sizeof(text), "%s %s %s", info->role, info->supported_type_id, info->name);
    if (strcasestr(text, "TEMPERATURE") || strcasestr(text, "DS18B20")) return SENSOR_TYPE_TEMPERATURE;
    if (strcasestr(text, "HUMIDITY") || strcasestr(text, "HUMID")) return SENSOR_TYPE_HUMIDITY;
    if (strcasestr(text, "LIGHT") || strcasestr(text, "LUX")) return SENSOR_TYPE_LIGHT;
    if (strcasestr(text, "LEVEL") || strcasestr(text, "FLOAT") || strcasestr(text, "RADAR")) return SENSOR_TYPE_LEVEL;
    if (strcasestr(text, "FLOW")) return SENSOR_TYPE_FLOW;
    if (strcasestr(text, "PRESSURE")) return SENSOR_TYPE_PRESSURE;
    if (strcasestr(text, "PH")) return SENSOR_TYPE_PH;
    if (strcasestr(text, "EC") || strcasestr(text, "CONDUCTIVITY")) return SENSOR_TYPE_EC;
    if (strcasestr(text, "DOSING_OUTPUT")) return SENSOR_TYPE_DOSING_OUTPUT;
    return SENSOR_TYPE_UNKNOWN;
}

static const char *generic_type_name(sensor_type_t type)
{
    switch (type) {
        case SENSOR_TYPE_TEMPERATURE: return "TEMPERATURE";
        case SENSOR_TYPE_HUMIDITY: return "HUMIDITY";
        case SENSOR_TYPE_LIGHT: return "LIGHT";
        case SENSOR_TYPE_LEVEL: return "LEVEL";
        case SENSOR_TYPE_FLOW: return "FLOW";
        case SENSOR_TYPE_PRESSURE: return "PRESSURE";
        case SENSOR_TYPE_PH: return "PH";
        case SENSOR_TYPE_EC: return "EC";
        case SENSOR_TYPE_DOSING_OUTPUT: return "DOSING_OUTPUT";
        default: return "UNKNOWN";
    }
}

static bool generic_parse_descriptor(const hw_component_info_t *info, sensor_descriptor_t *out)
{
    if (!info || !out) return false;
    memset(out, 0, sizeof(*out));
    strncpy(out->sensor_id, info->component_id, sizeof(out->sensor_id) - 1);
    out->sensor_type = generic_sensor_type(info);
    out->channel = info->wiring.channel;
    out->installed = info->lifecycle_state != HW_LIFECYCLE_REMOVED && info->lifecycle_state != HW_LIFECYCLE_REGISTERED;
    strncpy(out->source, info->wiring.address[0] ? info->wiring.address : info->wiring.port, sizeof(out->source) - 1);
    if (!out->source[0]) snprintf(out->source, sizeof(out->source), "%s", generic_type_name(out->sensor_type));
    switch (out->sensor_type) {
        case SENSOR_TYPE_TEMPERATURE: strncpy(out->unit, "C", sizeof(out->unit)-1); break;
        case SENSOR_TYPE_HUMIDITY: strncpy(out->unit, "%", sizeof(out->unit)-1); break;
        case SENSOR_TYPE_LIGHT: strncpy(out->unit, "lux", sizeof(out->unit)-1); break;
        case SENSOR_TYPE_LEVEL: strncpy(out->unit, "state", sizeof(out->unit)-1); break;
        case SENSOR_TYPE_FLOW: strncpy(out->unit, "L/min", sizeof(out->unit)-1); break;
        case SENSOR_TYPE_PRESSURE: strncpy(out->unit, "bar", sizeof(out->unit)-1); break;
        case SENSOR_TYPE_PH: strncpy(out->unit, "pH", sizeof(out->unit)-1); break;
        case SENSOR_TYPE_EC: strncpy(out->unit, "mS/cm", sizeof(out->unit)-1); break;
        case SENSOR_TYPE_DOSING_OUTPUT: strncpy(out->unit, "mL/s", sizeof(out->unit)-1); break;
        default: break;
    }
    out->sampling_interval_ms = 1000;
    cJSON *params = cJSON_Parse(info->parameters_json[0] ? info->parameters_json : "{}");
    if (params) {
        cJSON *v = cJSON_GetObjectItem(params, "unit"); if (v && cJSON_IsString(v)) strncpy(out->unit, v->valuestring, sizeof(out->unit)-1);
        v = cJSON_GetObjectItem(params, "samplingIntervalMs"); if (v && cJSON_IsNumber(v) && v->valuedouble > 0) out->sampling_interval_ms = (uint32_t)v->valuedouble;
        v = cJSON_GetObjectItem(params, "calibrationReference"); if (v && cJSON_IsString(v)) strncpy(out->calibration_reference, v->valuestring, sizeof(out->calibration_reference)-1);
        v = cJSON_GetObjectItem(params, "calibrationType"); if (v && cJSON_IsString(v)) strncpy(out->calibration_type, v->valuestring, sizeof(out->calibration_type)-1);
        v = cJSON_GetObjectItem(params, "calibrationVersion"); if (v && cJSON_IsNumber(v) && v->valuedouble > 0) out->calibration_version = (uint32_t)v->valuedouble;
        v = cJSON_GetObjectItem(params, "minValue"); if (v && cJSON_IsNumber(v)) { out->min_value = (float)v->valuedouble; out->has_validity_range = true; }
        v = cJSON_GetObjectItem(params, "maxValue"); if (v && cJSON_IsNumber(v)) { out->max_value = (float)v->valuedouble; out->has_validity_range = true; }
        cJSON_Delete(params);
    }
    return out->sensor_type != SENSOR_TYPE_UNKNOWN;
}

esp_err_t sensor_hal_get_descriptor(const char *sensor_id, sensor_descriptor_t *out_descriptor)
{
    if (!sensor_id || !out_descriptor) return ESP_ERR_INVALID_ARG;
    hw_component_info_t info;
    if (hardware_registry_find_by_id(sensor_id, &info) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (!generic_parse_descriptor(&info, out_descriptor)) return ESP_ERR_NOT_SUPPORTED;
    return ESP_OK;
}

esp_err_t sensor_hal_get_component_sample(const char *sensor_id, sensor_component_sample_t *out_sample)
{
    if (!out_sample) return ESP_ERR_INVALID_ARG;
    memset(out_sample, 0, sizeof(*out_sample));
    sensor_descriptor_t descriptor;
    if (sensor_hal_get_descriptor(sensor_id, &descriptor) != ESP_OK) return ESP_ERR_NOT_FOUND;
    hw_component_info_t info;
    if (hardware_registry_find_by_id(sensor_id, &info) != ESP_OK) return ESP_ERR_NOT_FOUND;
    strncpy(out_sample->sensor_id, sensor_id, sizeof(out_sample->sensor_id)-1);
    strncpy(out_sample->unit, descriptor.unit, sizeof(out_sample->unit)-1);
    strncpy(out_sample->calibration_reference, descriptor.calibration_reference, sizeof(out_sample->calibration_reference)-1);
    out_sample->timestamp_ms = esp_timer_get_time()/1000LL;
    if (!descriptor.installed) { out_sample->state = SENSOR_STATE_UNAVAILABLE; return ESP_OK; }
    sensor_readings_t readings;
    if (sensor_hal_get_readings(&readings) != ESP_OK) { out_sample->state = SENSOR_STATE_INVALID; return ESP_OK; }
    int64_t age = out_sample->timestamp_ms - readings.last_sample_timestamp;
    if (readings.last_sample_timestamp <= 0 || age > (int64_t)descriptor.sampling_interval_ms * 3) { out_sample->state = SENSOR_STATE_STALE; return ESP_OK; }
    /* Configuration-driven generic physical inputs are updated by sensor_hal_poll(). */
    if (descriptor.sensor_type != SENSOR_TYPE_TEMPERATURE &&
        !(descriptor.sensor_type == SENSOR_TYPE_FLOW &&
          (strcasestr(info.role, "RAW") || strcasestr(info.name, "RAW") || strcasestr(info.role, "FERT") || strcasestr(info.name, "FERT"))) &&
        !(descriptor.sensor_type == SENSOR_TYPE_LEVEL && info.wiring.gpio == PIN_IN_FLOAT_LOWER)) {
        generic_sensor_sample_slot_t *slot = generic_sample_slot(sensor_id);
        if (slot && slot->sample.timestamp_ms > 0) {
            int64_t generic_age = out_sample->timestamp_ms - slot->sample.timestamp_ms;
            if (generic_age > (int64_t)descriptor.sampling_interval_ms * 3) {
                out_sample->state = SENSOR_STATE_STALE;
                return ESP_OK;
            }
            *out_sample = slot->sample;
            return ESP_OK;
        }
    }

    /* Flow is a precision measurement used to control actual volume. It cannot
       become operational from the legacy calibrated flag alone: the active
       sensor descriptor must name the exact versioned FLOW calibration. */
    if (descriptor.sensor_type == SENSOR_TYPE_FLOW &&
        (!descriptor.calibration_reference[0] || descriptor.calibration_version == 0 ||
         strcasecmp(descriptor.calibration_type, "FLOW") != 0)) {
        out_sample->state = SENSOR_STATE_UNAVAILABLE;
        return ESP_OK;
    }
    switch (descriptor.sensor_type) {
        case SENSOR_TYPE_TEMPERATURE:
            if (readings.temp_state != SENSOR_STATE_VALID) { out_sample->state = readings.temp_state; return ESP_OK; }
            out_sample->value = readings.temperature_c; out_sample->has_value = true; out_sample->state = SENSOR_STATE_VALID; break;
        case SENSOR_TYPE_FLOW:
            if (strcasestr(info.role, "RAW") || strcasestr(info.name, "RAW")) {
                if (!readings.raw_zjb1_calibrated) { out_sample->state = SENSOR_STATE_UNAVAILABLE; return ESP_OK; }
                out_sample->value = readings.flow_rate_raw_zjb1_lpm;
            } else {
                if (!readings.fert_fs400a_calibrated) { out_sample->state = SENSOR_STATE_UNAVAILABLE; return ESP_OK; }
                out_sample->value = readings.flow_rate_fert_fs400a_lpm;
            }
            out_sample->has_value = true; out_sample->state = SENSOR_STATE_VALID; break;
        case SENSOR_TYPE_LEVEL:
            out_sample->value = readings.float_lower_ok ? 1.0f : 0.0f; out_sample->has_value = true; out_sample->state = SENSOR_STATE_VALID; break;
        default:
            out_sample->state = SENSOR_STATE_UNAVAILABLE;
            break;
    }
    if (out_sample->has_value && descriptor.calibration_reference[0] && descriptor.calibration_type[0] && descriptor.sensor_type != SENSOR_TYPE_DOSING_OUTPUT) {
        calibration_record_t cal;
        if (descriptor.calibration_version == 0) {
            out_sample->has_value = false;
            out_sample->state = SENSOR_STATE_UNAVAILABLE;
            return ESP_OK;
        }
        esp_err_t cal_err = calibration_mgr_get_record_exact(sensor_id, descriptor.calibration_type, descriptor.calibration_reference, descriptor.calibration_version, &cal);
        if (cal_err != ESP_OK || calibration_mgr_is_usable(&cal) != ESP_OK || !cal.has_linear ||
            (descriptor.calibration_reference[0] && strcmp(cal.calibration_id, descriptor.calibration_reference) != 0) ||
            (descriptor.calibration_version > 0 && cal.version != descriptor.calibration_version)) {
            out_sample->has_value = false;
            out_sample->state = SENSOR_STATE_UNAVAILABLE;
            return ESP_OK;
        }
        out_sample->value = cal.slope * out_sample->value + cal.offset;
    }
    if (out_sample->has_value && descriptor.has_validity_range && (out_sample->value < descriptor.min_value || out_sample->value > descriptor.max_value)) {
        out_sample->has_value = false; out_sample->state = SENSOR_STATE_OUT_OF_RANGE;
    }
    return ESP_OK;
}

esp_err_t sensor_hal_get_component_accumulated_ml(const char *sensor_id, uint32_t *out_ml)
{
    if (!sensor_id || !out_ml) return ESP_ERR_INVALID_ARG;
    *out_ml = 0;
    sensor_descriptor_t descriptor;
    if (sensor_hal_get_descriptor(sensor_id, &descriptor) != ESP_OK) return ESP_ERR_NOT_FOUND;
    if (descriptor.sensor_type != SENSOR_TYPE_FLOW) return ESP_ERR_NOT_SUPPORTED;
    sensor_readings_t readings;
    if (sensor_hal_get_readings(&readings) != ESP_OK) return ESP_FAIL;

    /* Exact versioned FLOW calibration is authoritative for volume accumulation. */
    if (descriptor.calibration_reference[0] && descriptor.calibration_version > 0 &&
        descriptor.calibration_type[0] && strcasecmp(descriptor.calibration_type, "FLOW") == 0) {
        calibration_record_t cal;
        if (calibration_mgr_get_record_exact(sensor_id, "FLOW", descriptor.calibration_reference, descriptor.calibration_version, &cal) != ESP_OK ||
            calibration_mgr_is_usable(&cal) != ESP_OK || !cal.has_pulses_per_liter || cal.pulses_per_liter <= 0.0f) {
            return ESP_ERR_INVALID_STATE;
        }
        uint32_t pulses = 0;
        hw_component_info_t info;
        if (hardware_registry_find_by_id(sensor_id, &info) != ESP_OK) return ESP_ERR_NOT_FOUND;
        if (strcasestr(info.role, "RAW") || strcasestr(info.name, "RAW")) {
            pulses = readings.total_pulses_raw_zjb1;
            *out_ml = (uint32_t)((pulses * 1000.0f) / cal.pulses_per_liter);
            return ESP_OK;
        }
        if (strcasestr(info.role, "FERT") || strcasestr(info.role, "DELIVERY") || strcasestr(info.name, "FERT") || strcasestr(info.name, "DELIVERY")) {
            pulses = readings.total_pulses_fert_fs400a;
            *out_ml = (uint32_t)((pulses * 1000.0f) / cal.pulses_per_liter);
            return ESP_OK;
        }
        for (size_t i = 0; i < MAX_GENERIC_FLOW_SENSORS; ++i) {
            if (s_generic_flows[i].used && strcmp(s_generic_flows[i].sensor_id, sensor_id) == 0) {
                *out_ml = (uint32_t)(((double)s_generic_flows[i].pulses * 1000.0) / cal.pulses_per_liter);
                return ESP_OK;
            }
        }
        return ESP_ERR_NOT_FOUND;
    }

    /* No silent legacy fallback: measured volume is only operational when the
       configured sensor has an exact usable FLOW calibration reference. */
    return ESP_ERR_INVALID_STATE;
}

size_t sensor_hal_list_configured(sensor_descriptor_t *out_descriptors, size_t max_count)
{
    size_t count = hardware_registry_get_count();
    size_t written = 0;
    for (size_t i=0; i<count && written<max_count; ++i) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i,&info) != ESP_OK) continue;
        sensor_descriptor_t d;
        if (generic_parse_descriptor(&info,&d)) out_descriptors[written++]=d;
    }
    return written;
}
