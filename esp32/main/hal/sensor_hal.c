#include "hal/sensor_hal.h"
#include "config/pin_config.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "rom/ets_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "SENSOR_HAL";

/* Flow meter calibration constants:
 * YF-B1: ~8.1 pulses per second per 1 L/min (F = 8.1 * Q)
 * FS400A: ~4.8 pulses per second per 1 L/min (F = 4.8 * Q)
 * NOTE: VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION.
 */
#define YFB1_PULSES_PER_LITER      486.0f
#define FS400A_PULSES_PER_LITER    288.0f

static volatile uint32_t s_pulses_yfb1 = 0;
static volatile uint32_t s_pulses_fs400a = 0;
static sensor_readings_t s_current_readings = {0};
static SemaphoreHandle_t s_sensor_lock = NULL;

static void IRAM_ATTR yfb1_isr_handler(void *arg)
{
    s_pulses_yfb1++;
}

static void IRAM_ATTR fs400a_isr_handler(void *arg)
{
    s_pulses_fs400a++;
}

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

static sensor_state_t ds18b20_read_temp(gpio_num_t pin, float *out_temp)
{
    if (ds18b20_reset(pin) != ESP_OK) return SENSOR_STATE_DISCONNECTED;
    ds18b20_write_byte(pin, 0xCC); /* Skip ROM */
    ds18b20_write_byte(pin, 0x44); /* Start Convert */

    /* Wait conversion time (12-bit max ~750ms) */
    vTaskDelay(pdMS_TO_TICKS(750));

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
        .pin_bit_mask = (1ULL << PIN_IN_FLOW_YFB1) | (1ULL << PIN_IN_FLOW_FS400A)
    };
    ESP_ERROR_CHECK(gpio_config(&flow_conf));

    /* Install ISR service if not already installed */
    gpio_install_isr_service(0);
    gpio_isr_handler_add(PIN_IN_FLOW_YFB1, yfb1_isr_handler, NULL);
    gpio_isr_handler_add(PIN_IN_FLOW_FS400A, fs400a_isr_handler, NULL);

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

    ESP_LOGI(TAG, "Sensor HAL initialized: YF-B1 (GPIO %d), FS400A (GPIO %d), DS18B20 (GPIO %d), Float (GPIO %d), Tamper (GPIO %d)",
             PIN_IN_FLOW_YFB1, PIN_IN_FLOW_FS400A, PIN_IN_TEMP_DS18B20, PIN_IN_FLOAT_LOWER, PIN_IN_TAMPER_LOOP);

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

    /* DS18B20 Temperature Reading */
    float temp_val = 0.0f;
    s_current_readings.temp_state = ds18b20_read_temp(PIN_IN_TEMP_DS18B20, &temp_val);
    if (s_current_readings.temp_state == SENSOR_STATE_VALID) {
        s_current_readings.temperature_c = temp_val;
    }

    /* Flow Calculations */
    s_current_readings.total_pulses_yfb1 = s_pulses_yfb1;
    s_current_readings.total_liters_yfb1 = (float)s_pulses_yfb1 / YFB1_PULSES_PER_LITER;

    s_current_readings.total_pulses_fs400a = s_pulses_fs400a;
    s_current_readings.total_liters_fs400a = (float)s_pulses_fs400a / FS400A_PULSES_PER_LITER;

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
    s_pulses_yfb1 = 0;
    s_pulses_fs400a = 0;
}
