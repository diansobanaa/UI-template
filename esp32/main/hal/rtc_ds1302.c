#include "hal/rtc_ds1302.h"
#include "config/pin_config.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include <sys/time.h>
#include "esp_sntp.h"

static const char *TAG = "RTC_DS1302";

static bool s_ds1302_available = false;

/* DS1302 Register Commands (Read = Write + 1) */
#define DS1302_CMD_SEC_WRITE        0x80
#define DS1302_CMD_SEC_READ         0x81
#define DS1302_CMD_MIN_WRITE        0x82
#define DS1302_CMD_MIN_READ         0x83
#define DS1302_CMD_HOUR_WRITE       0x84
#define DS1302_CMD_HOUR_READ        0x85
#define DS1302_CMD_DATE_WRITE       0x86
#define DS1302_CMD_DATE_READ        0x87
#define DS1302_CMD_MONTH_WRITE      0x88
#define DS1302_CMD_MONTH_READ       0x89
#define DS1302_CMD_DAY_WRITE        0x8A
#define DS1302_CMD_DAY_READ         0x8B
#define DS1302_CMD_YEAR_WRITE       0x8C
#define DS1302_CMD_YEAR_READ        0x8D
#define DS1302_CMD_WP_WRITE         0x8E
#define DS1302_CMD_WP_READ          0x8F
#define DS1302_CMD_RAM_TEST_WRITE   0xC0
#define DS1302_CMD_RAM_TEST_READ    0xC1

static inline uint8_t bcd2dec(uint8_t val)
{
    return ((val >> 4) * 10) + (val & 0x0F);
}

static inline uint8_t dec2bcd(uint8_t val)
{
    return ((val / 10) << 4) | (val % 10);
}

static void ds1302_write_byte(uint8_t val)
{
    gpio_set_direction(PIN_DS1302_DAT, GPIO_MODE_OUTPUT);
    for (int i = 0; i < 8; i++) {
        gpio_set_level(PIN_DS1302_DAT, (val >> i) & 0x01);
        esp_rom_delay_us(2);
        gpio_set_level(PIN_DS1302_CLK, 1);
        esp_rom_delay_us(2);
        gpio_set_level(PIN_DS1302_CLK, 0);
        esp_rom_delay_us(2);
    }
}

static uint8_t ds1302_read_byte(void)
{
    uint8_t val = 0;
    gpio_set_direction(PIN_DS1302_DAT, GPIO_MODE_INPUT);
    for (int i = 0; i < 8; i++) {
        if (gpio_get_level(PIN_DS1302_DAT)) {
            val |= (1 << i);
        }
        gpio_set_level(PIN_DS1302_CLK, 1);
        esp_rom_delay_us(2);
        gpio_set_level(PIN_DS1302_CLK, 0);
        esp_rom_delay_us(2);
    }
    return val;
}

static uint8_t ds1302_read_reg(uint8_t reg_read_cmd)
{
    gpio_set_level(PIN_DS1302_CLK, 0);
    gpio_set_level(PIN_DS1302_RST, 1);
    esp_rom_delay_us(4);

    ds1302_write_byte(reg_read_cmd);
    uint8_t val = ds1302_read_byte();

    gpio_set_level(PIN_DS1302_RST, 0);
    esp_rom_delay_us(4);
    return val;
}

static void ds1302_write_reg(uint8_t reg_write_cmd, uint8_t val)
{
    gpio_set_level(PIN_DS1302_CLK, 0);
    gpio_set_level(PIN_DS1302_RST, 1);
    esp_rom_delay_us(4);

    ds1302_write_byte(reg_write_cmd);
    ds1302_write_byte(val);

    gpio_set_level(PIN_DS1302_RST, 0);
    esp_rom_delay_us(4);
}

bool rtc_ds1302_is_available(void)
{
    return s_ds1302_available;
}

esp_err_t rtc_ds1302_init(void)
{
    ESP_LOGI(TAG, "Initializing 3-wire interface for DS1302 RTC (CLK=%d, DAT=%d, RST=%d)...",
             PIN_DS1302_CLK, PIN_DS1302_DAT, PIN_DS1302_RST);

    // 1. Configure RST and CLK as push-pull outputs
    gpio_config_t out_conf = {
        .pin_bit_mask = (1ULL << PIN_DS1302_CLK) | (1ULL << PIN_DS1302_RST),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    esp_err_t err = gpio_config(&out_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure DS1302 CLK/RST GPIOs: %s", esp_err_to_name(err));
        return err;
    }

    // 2. Configure DAT as bidirectional line with internal pullup
    gpio_config_t dat_conf = {
        .pin_bit_mask = (1ULL << PIN_DS1302_DAT),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    err = gpio_config(&dat_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure DS1302 DAT GPIO: %s", esp_err_to_name(err));
        return err;
    }

    // Idle states: CLK=0, RST=0
    gpio_set_level(PIN_DS1302_CLK, 0);
    gpio_set_level(PIN_DS1302_RST, 0);

    // 3. Hardware Presence Detection via non-destructive RAM test
    // Disable write-protect (WP=0)
    ds1302_write_reg(DS1302_CMD_WP_WRITE, 0x00);

    // Read original value of RAM test byte
    uint8_t orig_ram = ds1302_read_reg(DS1302_CMD_RAM_TEST_READ);

    // Write pattern 0x5A, then read back
    ds1302_write_reg(DS1302_CMD_RAM_TEST_WRITE, 0x5A);
    uint8_t read_back1 = ds1302_read_reg(DS1302_CMD_RAM_TEST_READ);

    // Write pattern 0xA5, then read back
    ds1302_write_reg(DS1302_CMD_RAM_TEST_WRITE, 0xA5);
    uint8_t read_back2 = ds1302_read_reg(DS1302_CMD_RAM_TEST_READ);

    // Restore original RAM byte
    ds1302_write_reg(DS1302_CMD_RAM_TEST_WRITE, orig_ram);

    if (read_back1 == 0x5A && read_back2 == 0xA5) {
        s_ds1302_available = true;
        ESP_LOGI(TAG, "DS1302 RTC acknowledged on 3-wire bus.");

        // Clear Clock Halt (CH) bit in Seconds register if halted
        uint8_t sec_reg = ds1302_read_reg(DS1302_CMD_SEC_READ);
        if (sec_reg & 0x80) {
            ESP_LOGI(TAG, "Starting DS1302 oscillator (clearing CH bit)...");
            ds1302_write_reg(DS1302_CMD_SEC_WRITE, sec_reg & 0x7F);
        }
        return ESP_OK;
    }

    s_ds1302_available = false;
    ESP_LOGW(TAG, "DS1302 RTC not detected on 3-wire bus (probe patterns: 0x%02x, 0x%02x). Operating in degraded mode.",
             read_back1, read_back2);
    return ESP_ERR_NOT_FOUND;
}

esp_err_t rtc_ds1302_get_time(struct tm *timeinfo)
{
    if (!s_ds1302_available || !timeinfo) return ESP_ERR_INVALID_STATE;

    uint8_t sec_reg  = ds1302_read_reg(DS1302_CMD_SEC_READ);
    uint8_t min_reg  = ds1302_read_reg(DS1302_CMD_MIN_READ);
    uint8_t hour_reg = ds1302_read_reg(DS1302_CMD_HOUR_READ);
    uint8_t date_reg = ds1302_read_reg(DS1302_CMD_DATE_READ);
    uint8_t mon_reg  = ds1302_read_reg(DS1302_CMD_MONTH_READ);
    uint8_t day_reg  = ds1302_read_reg(DS1302_CMD_DAY_READ);
    uint8_t yr_reg   = ds1302_read_reg(DS1302_CMD_YEAR_READ);

    timeinfo->tm_sec  = bcd2dec(sec_reg & 0x7F);
    timeinfo->tm_min  = bcd2dec(min_reg & 0x7F);
    timeinfo->tm_hour = bcd2dec(hour_reg & 0x3F); // 24-hr mode
    timeinfo->tm_mday = bcd2dec(date_reg & 0x3F);
    timeinfo->tm_mon  = bcd2dec(mon_reg & 0x1F) - 1; // 0-based month
    timeinfo->tm_wday = (day_reg & 0x07) - 1;        // 0-based day of week
    timeinfo->tm_year = bcd2dec(yr_reg) + 100;       // Since 1900 (2000+)

    return ESP_OK;
}

esp_err_t rtc_ds1302_set_time(const struct tm *timeinfo)
{
    if (!s_ds1302_available || !timeinfo) return ESP_ERR_INVALID_STATE;

    ds1302_write_reg(DS1302_CMD_WP_WRITE, 0x00); // Disable write-protect

    ds1302_write_reg(DS1302_CMD_SEC_WRITE,   dec2bcd(timeinfo->tm_sec) & 0x7F);
    ds1302_write_reg(DS1302_CMD_MIN_WRITE,   dec2bcd(timeinfo->tm_min));
    ds1302_write_reg(DS1302_CMD_HOUR_WRITE,  dec2bcd(timeinfo->tm_hour) & 0x3F);
    ds1302_write_reg(DS1302_CMD_DATE_WRITE,  dec2bcd(timeinfo->tm_mday));
    ds1302_write_reg(DS1302_CMD_MONTH_WRITE, dec2bcd(timeinfo->tm_mon + 1));
    ds1302_write_reg(DS1302_CMD_DAY_WRITE,   (timeinfo->tm_wday + 1) & 0x07);
    ds1302_write_reg(DS1302_CMD_YEAR_WRITE,  dec2bcd(timeinfo->tm_year % 100));

    return ESP_OK;
}

esp_err_t rtc_ds1302_sync_to_system(void)
{
    if (!s_ds1302_available) return ESP_ERR_NOT_FOUND;

    struct tm timeinfo = { 0 };
    esp_err_t err = rtc_ds1302_get_time(&timeinfo);
    if (err == ESP_OK) {
        time_t t = mktime(&timeinfo);
        struct timeval now = { .tv_sec = t, .tv_usec = 0 };
        settimeofday(&now, NULL);
        ESP_LOGI(TAG, "System time synced from DS1302: %s", asctime(&timeinfo));

        // Start SNTP for network sync fallback
        esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
        esp_sntp_setservername(0, "pool.ntp.org");
        esp_sntp_init();
    } else {
        ESP_LOGE(TAG, "Failed to read time from DS1302: %s", esp_err_to_name(err));
    }
    return err;
}
