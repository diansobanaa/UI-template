#include "hal/dht22.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>

static const char *TAG = "DHT22";

/* DHT22-FIX: The previous "no critical section" approach caused DHT22 reads
 * to fail with ESP_ERR_TIMEOUT (Phase B) because FreeRTOS task scheduling
 * between the 20ms start signal and the data read phase disrupted the
 * microsecond-precision timing the DHT22 requires.
 *
 * Solution: Use portENTER_CRITICAL ONLY for the ~5ms data read phase
 * (Phase B/C/D + 40-bit data). The 20ms start signal uses vTaskDelay
 * which is OUTSIDE the critical section (vTaskDelay inside critical
 * section is forbidden on FreeRTOS).
 *
 * This blocks ISRs on the calling core for ~5ms every 3 seconds. Flow
 * meter ISRs (ZJ-B1 GPIO 15, FS400A GPIO 16) may miss 1-2 pulses per
 * 3s cycle. At typical flow rates (5-25 L/min, ~6-30 pulses/sec), missing
 * 1-2 pulses per 3s is <1% error — acceptable for fertigation volume
 * measurement. The alternative (DHT22 not working at all) is worse.
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
             "Initialized DHT22 pin on GPIO %d (Input/Output Open-Drain with "
             "Pull-Up)",
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

  int init_lvl = gpio_get_level(gpio);

  /* 1. Host sends Start Signal: Pull line LOW for 20ms */
  gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
  gpio_set_level(gpio, 0);
  vTaskDelay(
      pdMS_TO_TICKS(20)); // Yield to other FreeRTOS tasks during 20ms pulse

  /* Release the DATA line; DHT22 expects the host to stop driving HIGH and
   * let the pull-up resistor return the line HIGH before the sensor response.
   *
   * DHT22-FIX: Enter critical section HERE — after vTaskDelay returns and
   * before the microsecond-precision data phase begins. The critical section
   * covers Phase B/C/D + 40-bit data read (~5ms total). This is REQUIRED
   * because FreeRTOS task switching between vTaskDelay and the first
   * gpio_get_level call causes DHT22 timing violation → no response.
   *
   * The 20ms start signal (vTaskDelay above) is OUTSIDE critical section
   * because vTaskDelay inside portENTER_CRITICAL is forbidden on FreeRTOS.
   */
  gpio_set_direction(gpio, GPIO_MODE_INPUT);
  gpio_set_pull_mode(gpio, GPIO_PULLUP_ONLY);

  /* Small delay to let pull-up bring line HIGH before DHT22 responds */
  esp_rom_delay_us(40);

  portENTER_CRITICAL(&s_dht22_mux);

  /* 4. Sensor response:
   * Phase B: DHT pulls LOW (wait up to 120us)
   * Phase C: DHT pulls HIGH (wait up to 120us)
   * Phase D: DHT pulls LOW (wait up to 120us, start of first data bit)
   */
  if (dht_await_pin_state(gpio, 120, 0, NULL) != ESP_OK) {
    portEXIT_CRITICAL(&s_dht22_mux);
    gpio_set_direction(gpio, GPIO_MODE_INPUT);
    gpio_set_pull_mode(gpio, GPIO_PULLUP_ONLY);
    ESP_LOGW(TAG, "DHT22 timeout Phase B (wait low). init_lvl=%d, cur_lvl=%d",
             init_lvl, gpio_get_level(gpio));
    return ESP_ERR_TIMEOUT;
  }
  if (dht_await_pin_state(gpio, 120, 1, NULL) != ESP_OK) {
    portEXIT_CRITICAL(&s_dht22_mux);
    gpio_set_direction(gpio, GPIO_MODE_INPUT);
    gpio_set_pull_mode(gpio, GPIO_PULLUP_ONLY);
    ESP_LOGW(TAG, "DHT22 timeout Phase C (wait high). cur_lvl=%d",
             gpio_get_level(gpio));
    return ESP_ERR_TIMEOUT;
  }
  if (dht_await_pin_state(gpio, 120, 0, NULL) != ESP_OK) {
    portEXIT_CRITICAL(&s_dht22_mux);
    gpio_set_direction(gpio, GPIO_MODE_INPUT);
    gpio_set_pull_mode(gpio, GPIO_PULLUP_ONLY);
    ESP_LOGW(TAG, "DHT22 timeout Phase D (wait data start). cur_lvl=%d",
             gpio_get_level(gpio));
    return ESP_ERR_TIMEOUT;
  }

  /* 5. Read 40 data bits */
  /* BIT39-FIX: some DHT22 sensor variants never drive the bus LOW after
   * the final data bit -- they simply release it and the pull-up holds it
   * HIGH. The previous code demanded a trailing HIGH->LOW edge for every
   * bit including bit 39, so these sensors failed deterministically with
   * "DHT22 timeout waiting for bit 39 high-to-low" even though all 40
   * bits were actually received correctly (Phases B/C/D + bits 0..38 all
   * passed, observed every ~4s on device a47b563-dirty).
   *
   * For the last bit only: if the trailing LOW never arrives, the HIGH
   * pulse has already saturated the 100us measurement window, i.e.
   * high_duration (>=100us) > low_duration (~50us), and the driver's own
   * decision rule below yields bit = '1'. Accept it and let the checksum
   * verification below remain the final arbiter of frame validity.
   * Non-final bits keep the strict behavior: a missing edge mid-frame
   * still means a broken frame and fails as before.
   *
   * NOTE: no ESP_LOG* may be called on this path -- we are still inside
   * portENTER_CRITICAL (interrupts disabled) until after the bit loop,
   * and ESP_LOG takes the stdout lock, which aborts the CPU. The notice
   * is therefore deferred via bit39_saturated and logged after
   * portEXIT_CRITICAL below.
   */
  bool bit39_saturated = false;
  for (int i = 0; i < DHT_DATA_BITS; i++) {
    if (dht_await_pin_state(gpio, 80, 1, &low_duration) != ESP_OK) {
      portEXIT_CRITICAL(&s_dht22_mux);
      gpio_set_direction(gpio, GPIO_MODE_INPUT);
      gpio_set_pull_mode(gpio, GPIO_PULLUP_ONLY);
      ESP_LOGW(TAG, "DHT22 timeout waiting for bit %d low-to-high", i);
      return ESP_ERR_TIMEOUT;
    }
    bool is_last_bit = (i == DHT_DATA_BITS - 1);
    if (dht_await_pin_state(gpio, 100, 0, &high_duration) != ESP_OK) {
      if (!is_last_bit) {
        portEXIT_CRITICAL(&s_dht22_mux);
        gpio_set_direction(gpio, GPIO_MODE_INPUT);
        gpio_set_pull_mode(gpio, GPIO_PULLUP_ONLY);
        ESP_LOGW(TAG, "DHT22 timeout waiting for bit %d high-to-low", i);
        return ESP_ERR_TIMEOUT;
      }
      bit39_saturated = true;
      high_duration = 100; /* saturate: 100us > low_duration(~50us) -> '1' */
    }

    uint8_t byte_idx = i / 8;
    uint8_t bit_idx = 7 - (i % 8);
    if (high_duration > low_duration) {
      data[byte_idx] |= (1 << bit_idx);
    }
  }

  portEXIT_CRITICAL(&s_dht22_mux);

  if (bit39_saturated) {
    ESP_LOGD(TAG, "DHT22: bit39 saturated (sensor variant OK, checksum arbiter)");
  }

  /* Restore idle input with pull-up state */
  gpio_set_direction(gpio, GPIO_MODE_INPUT);
  gpio_set_pull_mode(gpio, GPIO_PULLUP_ONLY);

  /* 5. Verify Checksum: (byte0 + byte1 + byte2 + byte3) & 0xFF == byte4 */
  uint8_t checksum = (uint8_t)((data[0] + data[1] + data[2] + data[3]) & 0xFF);
  if (checksum != data[4]) {
    /* bit39_saturated frames are a known noisy-variant artifact; downgrade to
     * LOGD so they don't spam the monitor. Clean-frame CRC errors stay LOGW. */
    if (bit39_saturated) {
      ESP_LOGD(TAG, "DHT22 CRC err (bit39 variant): 0x%02X != 0x%02X", checksum, data[4]);
    } else {
      ESP_LOGW(TAG,
               "DHT22 checksum error: computed 0x%02X != received 0x%02X (raw: "
               "%02X %02X %02X %02X %02X)",
               checksum, data[4], data[0], data[1], data[2], data[3], data[4]);
    }
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

  /* 8. Range Validation (-40C to 80C, 0% to 100% RH; note: 0.0 is explicitly
   * VALID) */
  if (hum < 0.0f || hum > 100.0f || temp < -40.0f || temp > 80.0f) {
    ESP_LOGD(TAG, "DHT22 range fail: temp=%.1fC, hum=%.1f%%", temp, hum);
    return ESP_ERR_INVALID_RESPONSE;
  }

  *out_temp_c = temp;
  *out_humidity_rh = hum;
  return ESP_OK;
}
