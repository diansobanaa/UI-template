#include "rtc_ds3231.h"
#include "config/pin_config.h"
#include "driver/i2c.h"
#include "esp_log.h"
#include <sys/time.h>
#include "esp_sntp.h"

static const char *TAG = "RTC_DS3231";

#define DS3231_ADDR 0x68

static esp_err_t ds3231_i2c_init(void)
{
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
        return err;
    }
    err = i2c_driver_install(I2C_PORT_NUM, conf.mode, 0, 0, 0);
    if (err != ESP_OK) {
        return err;
    }

    /* Bounded ACK/NACK probe to detect if DS3231 hardware is present */
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (DS3231_ADDR << 1) | I2C_MASTER_WRITE, true /* check ACK */);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(I2C_PORT_NUM, cmd, pdMS_TO_TICKS(50));
    i2c_cmd_link_delete(cmd);

    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "DS3231 RTC not detected on I2C bus (probe err=0x%x). Operating in degraded mode.", ret);
        i2c_driver_delete(I2C_PORT_NUM);
        return ESP_ERR_NOT_FOUND;
    }

    ESP_LOGI(TAG, "DS3231 RTC acknowledged at 0x%02x.", DS3231_ADDR);
    return ESP_OK;
}

static uint8_t bcd2dec(uint8_t val)
{
    return (val >> 4) * 10 + (val & 0x0F);
}

static esp_err_t ds3231_get_time(struct tm *timeinfo)
{
    uint8_t data[7];
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (DS3231_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, 0x00, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (DS3231_ADDR << 1) | I2C_MASTER_READ, true);
    i2c_master_read(cmd, data, 6, I2C_MASTER_ACK);
    i2c_master_read_byte(cmd, data + 6, I2C_MASTER_NACK);
    i2c_master_stop(cmd);
    
    esp_err_t err = i2c_master_cmd_begin(I2C_PORT_NUM, cmd, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(cmd);

    if (err != ESP_OK) {
        return err;
    }

    timeinfo->tm_sec = bcd2dec(data[0] & 0x7F);
    timeinfo->tm_min = bcd2dec(data[1]);
    timeinfo->tm_hour = bcd2dec(data[2] & 0x3F);
    timeinfo->tm_wday = bcd2dec(data[3]) - 1;
    timeinfo->tm_mday = bcd2dec(data[4]);
    timeinfo->tm_mon = bcd2dec(data[5] & 0x1F) - 1;
    timeinfo->tm_year = bcd2dec(data[6]) + 100; // Since 1900

    return ESP_OK;
}

esp_err_t rtc_ds3231_init(void)
{
    esp_err_t err = ds3231_i2c_init();
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "DS3231 I2C driver initialized.");
    } else {
        ESP_LOGE(TAG, "Failed to initialize DS3231 I2C driver: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t rtc_ds3231_sync_to_system(void)
{
    struct tm timeinfo = { 0 };
    esp_err_t err = ds3231_get_time(&timeinfo);
    
    if (err == ESP_OK) {
        time_t t = mktime(&timeinfo);
        struct timeval now = { .tv_sec = t, .tv_usec = 0 };
        settimeofday(&now, NULL);
        ESP_LOGI(TAG, "System time synced from DS3231: %s", asctime(&timeinfo));
        
        // Also init SNTP for network sync fallback later
        esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
        esp_sntp_setservername(0, "pool.ntp.org");
        esp_sntp_init();
    } else {
        ESP_LOGE(TAG, "Failed to read time from DS3231: %s", esp_err_to_name(err));
    }
    return err;
}
