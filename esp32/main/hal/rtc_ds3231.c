#include "hal/rtc_ds3231.h"
#include "config/pin_config.h"
#include "driver/i2c.h"
#include "esp_log.h"
#include <sys/time.h>
#include "esp_sntp.h"

static const char *TAG = "RTC_DS3231";

#define DS3231_I2C_ADDR             0x68
#define DS3231_REG_TIME             0x00

static bool s_ds3231_available = false;

static uint8_t dec2bcd(uint8_t val)
{
    return ((val / 10) << 4) | (val % 10);
}

static uint8_t bcd2dec(uint8_t val)
{
    return ((val >> 4) * 10) + (val & 0x0F);
}

bool rtc_ds3231_is_available(void)
{
    return s_ds3231_available;
}

esp_err_t rtc_ds3231_init(void)
{
    s_ds3231_available = false;

    ESP_LOGI(TAG, "Initializing I2C bus for DS3231 RTC (SDA=%d, SCL=%d)...", PIN_I2C_SDA, PIN_I2C_SCL);

    i2c_config_t conf = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = PIN_I2C_SDA,
        .scl_io_num = PIN_I2C_SCL,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = I2C_FREQ_HZ,
    };

    esp_err_t err = i2c_param_config(I2C_PORT_NUM, &conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "i2c_param_config failed: %s", esp_err_to_name(err));
        return err;
    }

    err = i2c_driver_install(I2C_PORT_NUM, conf.mode, 0, 0, 0);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "i2c_driver_install failed: %s", esp_err_to_name(err));
        return err;
    }

    /* Bounded ACK/NACK probe to detect if DS3231 hardware is present */
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (DS3231_I2C_ADDR << 1) | I2C_MASTER_WRITE, true /* check ACK */);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(I2C_PORT_NUM, cmd, pdMS_TO_TICKS(50));
    i2c_cmd_link_delete(cmd);

    if (ret != ESP_OK) {
        ESP_LOGI(TAG, "Hardware RTC (DS3231) not present on I2C bus. Operating in degraded time mode (SNTP fallback).");
        i2c_driver_delete(I2C_PORT_NUM);
        return ESP_ERR_NOT_FOUND;
    }

    s_ds3231_available = true;
    ESP_LOGI(TAG, "DS3231 RTC acknowledged at address 0x%02x. Driver initialized.", DS3231_I2C_ADDR);
    return ESP_OK;
}

esp_err_t rtc_ds3231_get_time(struct tm *timeinfo)
{
    if (!s_ds3231_available || timeinfo == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t data[7];
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (DS3231_I2C_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, DS3231_REG_TIME, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (DS3231_I2C_ADDR << 1) | I2C_MASTER_READ, true);
    i2c_master_read(cmd, data, 6, I2C_MASTER_ACK);
    i2c_master_read_byte(cmd, data + 6, I2C_MASTER_NACK);
    i2c_master_stop(cmd);

    esp_err_t err = i2c_master_cmd_begin(I2C_PORT_NUM, cmd, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(cmd);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read time from DS3231: %s", esp_err_to_name(err));
        return err;
    }

    timeinfo->tm_sec  = bcd2dec(data[0] & 0x7F);
    timeinfo->tm_min  = bcd2dec(data[1] & 0x7F);
    timeinfo->tm_hour = bcd2dec(data[2] & 0x3F); // 24-hour mode
    timeinfo->tm_wday = bcd2dec(data[3] & 0x07) - 1;
    timeinfo->tm_mday = bcd2dec(data[4] & 0x3F);
    timeinfo->tm_mon  = bcd2dec(data[5] & 0x1F) - 1; // 0-11
    timeinfo->tm_year = bcd2dec(data[6]) + 100;      // Since 1900 (years 2000-2099)
    timeinfo->tm_isdst = -1;

    return ESP_OK;
}

esp_err_t rtc_ds3231_set_time(const struct tm *timeinfo)
{
    if (!s_ds3231_available || timeinfo == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t data[7];
    data[0] = dec2bcd(timeinfo->tm_sec);
    data[1] = dec2bcd(timeinfo->tm_min);
    data[2] = dec2bcd(timeinfo->tm_hour); // 24-hour format
    data[3] = dec2bcd((timeinfo->tm_wday + 1) & 0x07);
    data[4] = dec2bcd(timeinfo->tm_mday);
    data[5] = dec2bcd((timeinfo->tm_mon + 1) & 0x1F);
    data[6] = dec2bcd((timeinfo->tm_year >= 100) ? (timeinfo->tm_year - 100) : timeinfo->tm_year);

    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (DS3231_I2C_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, DS3231_REG_TIME, true);
    for (int i = 0; i < 7; ++i) {
        i2c_master_write_byte(cmd, data[i], true);
    }
    i2c_master_stop(cmd);

    esp_err_t err = i2c_master_cmd_begin(I2C_PORT_NUM, cmd, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(cmd);

    if (err == ESP_OK) {
        ESP_LOGI(TAG, "DS3231 time updated successfully.");
    } else {
        ESP_LOGE(TAG, "Failed to write time to DS3231: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t rtc_ds3231_sync_to_system(void)
{
    struct tm timeinfo = { 0 };
    esp_err_t err = rtc_ds3231_get_time(&timeinfo);

    if (err == ESP_OK) {
        time_t t = mktime(&timeinfo);
        struct timeval now = { .tv_sec = t, .tv_usec = 0 };
        settimeofday(&now, NULL);
        ESP_LOGI(TAG, "System time synced from DS3231: %s", asctime(&timeinfo));
    } else {
        ESP_LOGI(TAG, "Hardware RTC time not available (%s); relying exclusively on SNTP.", esp_err_to_name(err));
    }

    /* Configure SNTP fallback regardless of hardware RTC presence */
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();

    return err;
}
