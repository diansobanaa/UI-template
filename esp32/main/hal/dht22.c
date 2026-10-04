#include "hal/dht22.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>

static const char *TAG = "DHT22";

/* DHT22 / AM2302 High-Precision Single-Wire Driver
 * Timing specification:
 * - Start signal: MCU pulls LOW for 20ms, then releases to HIGH.
 * - Sensor response:
 *   Phase B: DHT pulls signal LOW after 20-40us (detect response)
 *   Phase C: DHT holds signal LOW for ~80us
 *   Phase D: DHT lets signal float HIGH for ~80us
 * - 40 Data Bits:
 *   Each bit begins with 50us LOW.
 *   Logic '0' is 26-28us HIGH.
 *   Logic '1' is 70us HIGH.
 *
 * Critical Section:
 * portENTER_CRITICAL is entered immediately BEFORE releasing the start signal to HIGH,
 * guaranteeing zero task-scheduling jitter across the entire 40-bit transmission (~5ms total).
 */

#define DHT_TIMER_INTERVAL 2
#define DHT_DATA_BITS 40
#define DHT_DATA_BYTES 5

static portMUX_TYPE s_dht22_mux = portMUX_INITIALIZER_UNLOCKED;

esp_err_t dht22_init(gpio_num_t gpio) {
  if (gpio < 0 || gpio > 48)
    return ESP_ERR_INVALID_ARG;

  gpio_config_t io_conf = {
      .pin_bit_mask = (1ULL << gpio),
      .mode = GPIO_MODE_INPUT_OUTPUT_OD,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  esp_err_t err = gpio_config(&io_conf);
  if (err == ESP_OK) {
    gpio_set_pull_mode(gpio, GPIO_PULLUP_ONLY);
    gpio_set_level(gpio, 1);
    ESP_LOGI(TAG,
             "Initialized DHT22 pin on GPIO %d (Input/Output Open-Drain with Pull-Up)",
             gpio);
  }
  return err;
}

static inline esp_err_t dht_await_pin_state(gpio_num_t pin, uint32_t timeout_us,
                                            int expected_pin_state,
                                            uint32_t *duration) {
  for (uint32_t i = 0; i < timeout_us; i += DHT_TIMER_INTERVAL) {
    esp_rom_delay_us(DHT_TIMER_INTERVAL);
    if (gpio_get_level(pin) == expected_pin_state) {
      if (duration)
        *duration = i;
      return ESP_OK;
    }
  }
  return ESP_ERR_TIMEOUT;
}

esp_err_t dht22_read(gpio_num_t gpio, float *out_temp_c,
                     float *out_humidity_rh) {
  if (gpio < 0 || gpio > 48 || !out_temp_c || !out_humidity_rh) {
    return ESP_ERR_INVALID_ARG;
  }

  uint8_t data[DHT_DATA_BYTES] = {0};
  uint32_t low_duration = 0;
  uint32_t high_duration = 0;

  /* 1. Host sends Start Signal: Pull line LOW for 20ms in Open-Drain mode */
  gpio_set_direction(gpio, GPIO_MODE_INPUT_OUTPUT_OD);
  gpio_set_level(gpio, 0);
  vTaskDelay(pdMS_TO_TICKS(20)); // Yield FreeRTOS during 20ms low pulse

  /* 2. Enter critical section BEFORE releasing to HIGH to eliminate timing jitter */
  portENTER_CRITICAL(&s_dht22_mux);

  /* Release line to HIGH (open-drain pull-up) */
  gpio_set_level(gpio, 1);

  /* 3. Sensor Handshake:
   * Phase B: MCU waits 20-40us for DHT to pull LOW
   * Phase C: DHT holds LOW for ~80us
   * Phase D: DHT holds HIGH for ~80us (ends when bit 0 LOW begins)
   */
  if (dht_await_pin_state(gpio, 60, 0, NULL) != ESP_OK) {
    portEXIT_CRITICAL(&s_dht22_mux);
    gpio_set_level(gpio, 1);
    ESP_LOGW(TAG, "DHT22 timeout Phase B (wait low). cur_lvl=%d", gpio_get_level(gpio));
    return ESP_ERR_TIMEOUT;
  }
  if (dht_await_pin_state(gpio, 100, 1, NULL) != ESP_OK) {
    portEXIT_CRITICAL(&s_dht22_mux);
    gpio_set_level(gpio, 1);
    ESP_LOGW(TAG, "DHT22 timeout Phase C (wait high). cur_lvl=%d", gpio_get_level(gpio));
    return ESP_ERR_TIMEOUT;
  }
  if (dht_await_pin_state(gpio, 100, 0, NULL) != ESP_OK) {
    portEXIT_CRITICAL(&s_dht22_mux);
    gpio_set_level(gpio, 1);
    ESP_LOGW(TAG, "DHT22 timeout Phase D (wait data start). cur_lvl=%d", gpio_get_level(gpio));
    return ESP_ERR_TIMEOUT;
  }

  /* 4. Read 40 data bits */
  for (int i = 0; i < DHT_DATA_BITS; i++) {
    if (dht_await_pin_state(gpio, 70, 1, &low_duration) != ESP_OK) {
      portEXIT_CRITICAL(&s_dht22_mux);
      gpio_set_level(gpio, 1);
      ESP_LOGW(TAG, "DHT22 timeout waiting for bit %d low-to-high", i);
      return ESP_ERR_TIMEOUT;
    }
    if (dht_await_pin_state(gpio, 90, 0, &high_duration) != ESP_OK) {
      portEXIT_CRITICAL(&s_dht22_mux);
      gpio_set_level(gpio, 1);
      ESP_LOGW(TAG, "DHT22 timeout waiting for bit %d high-to-low", i);
      return ESP_ERR_TIMEOUT;
    }

    uint8_t byte_idx = i / 8;
    uint8_t bit_idx = 7 - (i % 8);
    if (high_duration > low_duration) {
      data[byte_idx] |= (1 << bit_idx);
    }
  }

  portEXIT_CRITICAL(&s_dht22_mux);

  /* Restore idle open-drain HIGH state */
  gpio_set_level(gpio, 1);

  /* 5. Verify Checksum: (byte0 + byte1 + byte2 + byte3) & 0xFF == byte4 */
  uint8_t checksum = (uint8_t)((data[0] + data[1] + data[2] + data[3]) & 0xFF);
  if (checksum != data[4]) {
    ESP_LOGW(TAG,
             "DHT22 checksum error: computed 0x%02X != received 0x%02X (raw: %02X %02X %02X %02X %02X)",
             checksum, data[4], data[0], data[1], data[2], data[3], data[4]);
    return ESP_ERR_INVALID_CRC;
  }

  /* 6. Parse Humidity (% RH) */
  uint16_t raw_hum = (uint16_t)((data[0] << 8) | data[1]);
  float hum = (float)raw_hum * 0.1f;

  /* 7. Parse Temperature (Celsius) */
  int16_t raw_temp = (int16_t)(((data[2] & 0x7F) << 8) | data[3]);
  float temp = (float)raw_temp * 0.1f;
  if (data[2] & 0x80) {
    temp = -temp;
  }

  /* 8. Range Validation (-40C to 80C, 0% to 100% RH; note: 0.0 is explicitly VALID) */
  if (hum < 0.0f || hum > 100.0f || temp < -40.0f || temp > 80.0f) {
    ESP_LOGW(TAG, "DHT22 range fail: temp=%.1fC, hum=%.1f%%", temp, hum);
    return ESP_ERR_INVALID_RESPONSE;
  }

  *out_temp_c = temp;
  *out_humidity_rh = hum;
  return ESP_OK;
}
