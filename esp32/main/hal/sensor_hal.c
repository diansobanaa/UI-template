#include "hal/sensor_hal.h"
#include "config/pin_config.h"
#include "config/system_config.h"
#include "services/calibration_mgr.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "rom/ets_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "SENSOR_HAL";

/* Flow meter specifications:
 * 1. RAW WATER FLOW METER: Model ZJ-B1 (Flow range 1-25 L/min, pressure <= 1.75 MPa)
 *    Pulse-frequency characteristic: UNVERIFIED / CALIBRATION REQUIRED.
 *    DO NOT invent pulse-per-liter or assume 486 pulses/L!
 *    Default factor: 0.0f (CALIBRATION REQUIRED).
 * 2. FERTIGATION FLOW METER: Model FS400A G1" (Plastic, 1-60 L/min, pressure <= 1.75 MPa)
 *    Pulse frequency: F = 4.5 * Q (Hz, with Q in L/min).
 *    Volume relationship: Pulses per Liter = 4.5 * 60 = 270.0 pulses/L.
 *    1 pulse = 1000 / 270 ≈ 3.7037 mL.
 */
#define FS400A_PULSES_PER_LITER_DEFAULT    270.0f
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

    /* 2. Fertigation Delivery Flow Meter (FS400A G1", 1-60 L/min, F = 4.5 * Q) */
    s_current_readings.total_pulses_fert_fs400a = s_pulses_fert_fs400a;
    float fs400a_cal = calibration_mgr_get_flow_fert_pulses_per_l();
    if (fs400a_cal <= 0.0f) fs400a_cal = FS400A_PULSES_PER_LITER_DEFAULT;
    s_current_readings.total_liters_fert_fs400a = (float)s_pulses_fert_fs400a / fs400a_cal;
    s_current_readings.total_ml_fert_fs400a = (uint32_t)((s_pulses_fert_fs400a * 1000.0f) / fs400a_cal);

    /* Flow Rate Calculations (L/min) evaluated once per second */
    if (dt_sec >= 1.0f) {
        uint32_t d_pulses_zjb1 = s_pulses_raw_zjb1 - s_last_pulses_zjb1;
        uint32_t d_pulses_fs400a = s_pulses_fert_fs400a - s_last_pulses_fs400a;
        s_last_pulses_zjb1 = s_pulses_raw_zjb1;
        s_last_pulses_fs400a = s_pulses_fert_fs400a;
        s_last_flow_calc_us = now_us;

        /* FS400A: F = 4.5 * Q => Q (L/min) = F / 4.5 = (pulses / dt) / 4.5 */
        float freq_fs400a = (float)d_pulses_fs400a / dt_sec;
        s_current_readings.flow_rate_fert_fs400a_lpm = freq_fs400a / 4.5f;

        /* ZJ-B1: Q (L/min) = (pulses / dt) * 60 / pulses_per_L */
        if (zjb1_cal > 0.0f) {
            float freq_zjb1 = (float)d_pulses_zjb1 / dt_sec;
            s_current_readings.flow_rate_raw_zjb1_lpm = (freq_zjb1 * 60.0f) / zjb1_cal;
        } else {
            s_current_readings.flow_rate_raw_zjb1_lpm = 0.0f; /* CALIBRATION REQUIRED */
        }
    }

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
