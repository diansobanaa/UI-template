#include "hal/tft_hal.h"
#include "config/pin_config.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>

static const char *TAG = "TFT_HAL";

static spi_device_handle_t s_spi_dev = NULL;
static bool s_tft_available = false;

/* Standard 5x7 ASCII Font (ASCII 0x20 ' ' to 0x7E '~') */
static const uint8_t s_font5x7[][5] = {
    {0x00, 0x00, 0x00, 0x00, 0x00}, // Space
    {0x00, 0x00, 0x5F, 0x00, 0x00}, // !
    {0x00, 0x07, 0x00, 0x07, 0x00}, // "
    {0x14, 0x7F, 0x14, 0x7F, 0x14}, // #
    {0x24, 0x2A, 0x7F, 0x2A, 0x12}, // $
    {0x23, 0x13, 0x08, 0x64, 0x62}, // %
    {0x36, 0x49, 0x55, 0x22, 0x50}, // &
    {0x00, 0x05, 0x03, 0x00, 0x00}, // '
    {0x00, 0x1C, 0x22, 0x41, 0x00}, // (
    {0x00, 0x41, 0x22, 0x1C, 0x00}, // )
    {0x14, 0x08, 0x3E, 0x08, 0x14}, // *
    {0x08, 0x08, 0x3E, 0x08, 0x08}, // +
    {0x00, 0x50, 0x30, 0x00, 0x00}, // ,
    {0x08, 0x08, 0x08, 0x08, 0x08}, // -
    {0x00, 0x60, 0x60, 0x00, 0x00}, // .
    {0x20, 0x10, 0x08, 0x04, 0x02}, // /
    {0x3E, 0x51, 0x49, 0x45, 0x3E}, // 0
    {0x00, 0x42, 0x7F, 0x40, 0x00}, // 1
    {0x42, 0x61, 0x51, 0x49, 0x46}, // 2
    {0x21, 0x41, 0x45, 0x4B, 0x31}, // 3
    {0x18, 0x14, 0x12, 0x7F, 0x10}, // 4
    {0x27, 0x45, 0x45, 0x45, 0x39}, // 5
    {0x3C, 0x4A, 0x49, 0x49, 0x30}, // 6
    {0x01, 0x71, 0x09, 0x05, 0x03}, // 7
    {0x36, 0x49, 0x49, 0x49, 0x36}, // 8
    {0x06, 0x49, 0x49, 0x29, 0x1E}, // 9
    {0x00, 0x36, 0x36, 0x00, 0x00}, // :
    {0x00, 0x56, 0x36, 0x00, 0x00}, // ;
    {0x08, 0x14, 0x22, 0x41, 0x00}, // <
    {0x14, 0x14, 0x14, 0x14, 0x14}, // =
    {0x00, 0x41, 0x22, 0x14, 0x08}, // >
    {0x02, 0x01, 0x51, 0x09, 0x06}, // ?
    {0x32, 0x49, 0x79, 0x41, 0x3E}, // @
    {0x7E, 0x11, 0x11, 0x11, 0x7E}, // A
    {0x7F, 0x49, 0x49, 0x49, 0x36}, // B
    {0x3E, 0x41, 0x41, 0x41, 0x22}, // C
    {0x7F, 0x41, 0x41, 0x22, 0x1C}, // D
    {0x7F, 0x49, 0x49, 0x49, 0x41}, // E
    {0x7F, 0x09, 0x09, 0x09, 0x01}, // F
    {0x3E, 0x41, 0x49, 0x49, 0x7A}, // G
    {0x7F, 0x08, 0x08, 0x08, 0x7F}, // H
    {0x00, 0x41, 0x7F, 0x41, 0x00}, // I
    {0x20, 0x40, 0x41, 0x3F, 0x01}, // J
    {0x7F, 0x08, 0x14, 0x22, 0x41}, // K
    {0x7F, 0x40, 0x40, 0x40, 0x40}, // L
    {0x7F, 0x02, 0x0C, 0x02, 0x7F}, // M
    {0x7F, 0x04, 0x08, 0x10, 0x7F}, // N
    {0x3E, 0x41, 0x41, 0x41, 0x3E}, // O
    {0x7F, 0x09, 0x09, 0x09, 0x06}, // P
    {0x3E, 0x41, 0x51, 0x21, 0x5E}, // Q
    {0x7F, 0x09, 0x19, 0x29, 0x46}, // R
    {0x46, 0x49, 0x49, 0x49, 0x31}, // S
    {0x01, 0x01, 0x7F, 0x01, 0x01}, // T
    {0x3F, 0x40, 0x40, 0x40, 0x3F}, // U
    {0x1F, 0x20, 0x40, 0x20, 0x1F}, // V
    {0x3F, 0x40, 0x38, 0x40, 0x3F}, // W
    {0x63, 0x14, 0x08, 0x14, 0x63}, // X
    {0x07, 0x08, 0x70, 0x08, 0x07}, // Y
    {0x61, 0x51, 0x49, 0x45, 0x43}, // Z
    {0x00, 0x7F, 0x41, 0x41, 0x00}, // [
    {0x02, 0x04, 0x08, 0x10, 0x20}, // '\'
    {0x00, 0x41, 0x41, 0x7F, 0x00}, // ]
    {0x04, 0x02, 0x01, 0x02, 0x04}, // ^
    {0x40, 0x40, 0x40, 0x40, 0x40}, // _
    {0x00, 0x01, 0x02, 0x04, 0x00}, // `
    {0x20, 0x54, 0x54, 0x54, 0x78}, // a
    {0x7F, 0x48, 0x44, 0x44, 0x38}, // b
    {0x38, 0x44, 0x44, 0x44, 0x20}, // c
    {0x38, 0x44, 0x44, 0x48, 0x7F}, // d
    {0x38, 0x54, 0x54, 0x54, 0x18}, // e
    {0x08, 0x7E, 0x09, 0x01, 0x02}, // f
    {0x0C, 0x52, 0x52, 0x52, 0x3E}, // g
    {0x7F, 0x08, 0x04, 0x04, 0x78}, // h
    {0x00, 0x44, 0x7D, 0x40, 0x00}, // i
    {0x20, 0x40, 0x44, 0x3D, 0x00}, // j
    {0x7F, 0x10, 0x28, 0x44, 0x00}, // k
    {0x00, 0x41, 0x7F, 0x40, 0x00}, // l
    {0x7C, 0x04, 0x18, 0x04, 0x78}, // m
    {0x7C, 0x08, 0x04, 0x04, 0x78}, // n
    {0x38, 0x44, 0x44, 0x44, 0x38}, // o
    {0x7C, 0x14, 0x14, 0x14, 0x08}, // p
    {0x08, 0x14, 0x14, 0x18, 0x7C}, // q
    {0x7C, 0x08, 0x04, 0x04, 0x08}, // r
    {0x48, 0x54, 0x54, 0x54, 0x20}, // s
    {0x04, 0x3F, 0x44, 0x40, 0x20}, // t
    {0x3C, 0x40, 0x40, 0x20, 0x7C}, // u
    {0x1C, 0x20, 0x40, 0x20, 0x1C}, // v
    {0x3C, 0x40, 0x30, 0x40, 0x3C}, // w
    {0x44, 0x28, 0x10, 0x28, 0x44}, // x
    {0x0C, 0x50, 0x50, 0x50, 0x3C}, // y
    {0x44, 0x64, 0x54, 0x4C, 0x44}, // z
    {0x00, 0x08, 0x36, 0x41, 0x00}, // {
    {0x00, 0x00, 0x7F, 0x00, 0x00}, // |
    {0x00, 0x41, 0x36, 0x08, 0x00}, // }
    {0x08, 0x08, 0x2A, 0x1C, 0x08}, // ~
};

static esp_err_t tft_write_cmd(uint8_t cmd)
{
    if (!s_spi_dev) return ESP_ERR_INVALID_STATE;
    gpio_set_level(PIN_TFT_DC, 0); // Command mode
    spi_transaction_t t = {
        .length = 8,
        .tx_buffer = &cmd
    };
    return spi_device_polling_transmit(s_spi_dev, &t);
}

static esp_err_t tft_write_data(const uint8_t *data, size_t len)
{
    if (!s_spi_dev || !data || len == 0) return ESP_ERR_INVALID_STATE;
    gpio_set_level(PIN_TFT_DC, 1); // Data mode
    spi_transaction_t t = {
        .length = len * 8,
        .tx_buffer = data
    };
    return spi_device_polling_transmit(s_spi_dev, &t);
}

static esp_err_t tft_write_data_byte(uint8_t val)
{
    return tft_write_data(&val, 1);
}

static void tft_set_addr_window(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1)
{
    if (x0 >= TFT_WIDTH_PX) x0 = TFT_WIDTH_PX - 1;
    if (x1 >= TFT_WIDTH_PX) x1 = TFT_WIDTH_PX - 1;
    if (y0 >= TFT_HEIGHT_PX) y0 = TFT_HEIGHT_PX - 1;
    if (y1 >= TFT_HEIGHT_PX) y1 = TFT_HEIGHT_PX - 1;

    uint8_t data[4];

    // Column Address Set
    tft_write_cmd(0x2A);
    data[0] = (x0 >> 8) & 0xFF;
    data[1] = x0 & 0xFF;
    data[2] = (x1 >> 8) & 0xFF;
    data[3] = x1 & 0xFF;
    tft_write_data(data, 4);

    // Row Address Set
    tft_write_cmd(0x2B);
    data[0] = (y0 >> 8) & 0xFF;
    data[1] = y0 & 0xFF;
    data[2] = (y1 >> 8) & 0xFF;
    data[3] = y1 & 0xFF;
    tft_write_data(data, 4);

    // Memory Write
    tft_write_cmd(0x2C);
}

bool tft_hal_is_available(void)
{
    return s_tft_available;
}

void tft_fill_rect(uint16_t x, uint16_t y, uint16_t w, uint16_t h, uint16_t color)
{
    if (!s_tft_available || w == 0 || h == 0) return;
    if (x >= TFT_WIDTH_PX || y >= TFT_HEIGHT_PX) return;

    if (x + w > TFT_WIDTH_PX) w = TFT_WIDTH_PX - x;
    if (y + h > TFT_HEIGHT_PX) h = TFT_HEIGHT_PX - y;

    tft_set_addr_window(x, y, x + w - 1, y + h - 1);

    uint8_t color_high = (color >> 8) & 0xFF;
    uint8_t color_low = color & 0xFF;

    // Buffer up to 128 pixels (256 bytes) per SPI transaction for fast bounded transfer
    uint8_t line_buffer[256];
    size_t chunk_pixels = (w > 128) ? 128 : w;
    for (size_t i = 0; i < chunk_pixels; i++) {
        line_buffer[i * 2] = color_high;
        line_buffer[i * 2 + 1] = color_low;
    }

    size_t total_pixels = (size_t)w * h;
    while (total_pixels > 0) {
        size_t batch = (total_pixels > chunk_pixels) ? chunk_pixels : total_pixels;
        tft_write_data(line_buffer, batch * 2);
        total_pixels -= batch;
    }
}

void tft_fill_screen(uint16_t color)
{
    tft_fill_rect(0, 0, TFT_WIDTH_PX, TFT_HEIGHT_PX, color);
}

static void tft_draw_char(uint16_t x, uint16_t y, char c, uint16_t color, uint16_t bg, uint8_t size)
{
    if (c < 0x20 || c > 0x7E) c = '?';
    const uint8_t *bitmap = s_font5x7[c - 0x20];

    for (uint8_t col = 0; col < 5; col++) {
        uint8_t line = bitmap[col];
        for (uint8_t row = 0; row < 7; row++) {
            uint16_t pixel_color = (line & (1 << row)) ? color : bg;
            if (size == 1) {
                tft_fill_rect(x + col, y + row, 1, 1, pixel_color);
            } else {
                tft_fill_rect(x + (col * size), y + (row * size), size, size, pixel_color);
            }
        }
    }
    // Draw 1-pixel column spacing
    if (size == 1) {
        tft_fill_rect(x + 5, y, 1, 7, bg);
    } else {
        tft_fill_rect(x + (5 * size), y, size, 7 * size, bg);
    }
}

void tft_draw_string(uint16_t x, uint16_t y, const char *str, uint16_t color, uint16_t bg, uint8_t size)
{
    if (!s_tft_available || !str) return;

    uint16_t cur_x = x;
    uint16_t cur_y = y;
    uint8_t char_width = 6 * size;
    uint8_t char_height = 8 * size;

    while (*str) {
        if (*str == '\n') {
            cur_x = x;
            cur_y += char_height;
        } else {
            if (cur_x + char_width <= TFT_WIDTH_PX && cur_y + char_height <= TFT_HEIGHT_PX) {
                tft_draw_char(cur_x, cur_y, *str, color, bg, size);
            }
            cur_x += char_width;
        }
        str++;
    }
}

void tft_show_diagnostic_screen(const char *device_id, const char *fw_version)
{
    if (!s_tft_available) return;

    // Background: Dark Gray/Black
    tft_fill_screen(TFT_COLOR_BLACK);

    // Title banner: AgroTech Forest Green
    tft_fill_rect(0, 0, TFT_WIDTH_PX, 24, TFT_COLOR_DARKGREEN);
    tft_draw_string(16, 6, "AGROTECH", TFT_COLOR_WHITE, TFT_COLOR_DARKGREEN, 2);

    // Subtitle / Hardware header
    tft_fill_rect(0, 24, TFT_WIDTH_PX, 1, TFT_COLOR_GREEN);
    tft_draw_string(8, 30, "ESP32 CONTROLLER", TFT_COLOR_YELLOW, TFT_COLOR_BLACK, 1);

    // System Status Line
    tft_fill_rect(6, 44, TFT_WIDTH_PX - 12, 18, TFT_COLOR_DARKGRAY);
    tft_draw_string(14, 49, "STATUS: TFT OK", TFT_COLOR_GREEN, TFT_COLOR_DARKGRAY, 1);

    // Resolution line
    tft_draw_string(8, 70, "RES: 128x160 SPI", TFT_COLOR_CYAN, TFT_COLOR_BLACK, 1);

    // Device Identifier
    tft_draw_string(8, 86, "DEV ID:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    char dev_str[24];
    snprintf(dev_str, sizeof(dev_str), "%.18s", (device_id && device_id[0]) ? device_id : DEFAULT_DEVICE_ID);
    tft_draw_string(8, 98, dev_str, TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);

    // Firmware Version
    tft_draw_string(8, 114, "FIRMWARE:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    char fw_str[24];
    snprintf(fw_str, sizeof(fw_str), "v%.16s", (fw_version && fw_version[0]) ? fw_version : FIRMWARE_VERSION);
    tft_draw_string(8, 126, fw_str, TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);

    // Bottom decorative bar
    tft_fill_rect(0, 156, TFT_WIDTH_PX, 4, TFT_COLOR_DARKGREEN);
}

esp_err_t tft_hal_init(void)
{
    ESP_LOGI(TAG, "Initializing ST7735 1.8\" TFT SPI display (CS=%d, DC=%d, RST=%d)...",
             PIN_TFT_CS, PIN_TFT_DC, PIN_TFT_RST);

    // 1. Configure DC and RST control GPIOs
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << PIN_TFT_DC) | (1ULL << PIN_TFT_RST),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    esp_err_t ret = gpio_config(&io_conf);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "Failed to configure DC/RST GPIOs: %s. Operating in degraded headless mode.", esp_err_to_name(ret));
        s_tft_available = false;
        return ESP_OK;
    }

    // 2. Attach TFT device to existing shared SPI2_HOST bus
    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = 10 * 1000 * 1000, // 10 MHz safe SPI clock
        .mode = 0,                          // SPI mode 0
        .spics_io_num = PIN_TFT_CS,         // CS pin GPIO 14
        .queue_size = 7,
        .flags = SPI_DEVICE_NO_DUMMY
    };

    ret = spi_bus_add_device(SPI2_HOST, &devcfg, &s_spi_dev);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "Failed to attach TFT device to SPI2_HOST: %s. Display degraded/absent.", esp_err_to_name(ret));
        s_tft_available = false;
        return ESP_OK;
    }

    // 3. Hardware Reset Sequence
    gpio_set_level(PIN_TFT_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(PIN_TFT_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(120));

    // 4. ST7735 Initialization Sequence (128x160 resolution)
    tft_write_cmd(0x01); // Software Reset
    vTaskDelay(pdMS_TO_TICKS(120));

    tft_write_cmd(0x11); // Sleep Out
    vTaskDelay(pdMS_TO_TICKS(120));

    // Frame Rate Control
    tft_write_cmd(0xB1);
    tft_write_data_byte(0x01);
    tft_write_data_byte(0x2C);
    tft_write_data_byte(0x2D);

    tft_write_cmd(0xB2);
    tft_write_data_byte(0x01);
    tft_write_data_byte(0x2C);
    tft_write_data_byte(0x2D);

    tft_write_cmd(0xB3);
    tft_write_data_byte(0x01);
    tft_write_data_byte(0x2C);
    tft_write_data_byte(0x2D);
    tft_write_data_byte(0x01);
    tft_write_data_byte(0x2C);
    tft_write_data_byte(0x2D);

    // Display Inversion Control
    tft_write_cmd(0xB4);
    tft_write_data_byte(0x07);

    // Power Control
    tft_write_cmd(0xC0);
    tft_write_data_byte(0xA2);
    tft_write_data_byte(0x02);
    tft_write_data_byte(0x84);

    tft_write_cmd(0xC1);
    tft_write_data_byte(0xC5);

    tft_write_cmd(0xC2);
    tft_write_data_byte(0x0A);
    tft_write_data_byte(0x00);

    tft_write_cmd(0xC3);
    tft_write_data_byte(0x8A);
    tft_write_data_byte(0x2A);

    tft_write_cmd(0xC4);
    tft_write_data_byte(0x8A);
    tft_write_data_byte(0xEE);

    tft_write_cmd(0xC5); // VCOM Control
    tft_write_data_byte(0x0E);

    tft_write_cmd(0x20); // Display Inversion Off

    // Memory Access Control (Orientation: standard portrait 128x160 with BGR color filter)
    tft_write_cmd(0x36);
    tft_write_data_byte(0xC8);

    // Interface Pixel Format: 16-bit RGB565
    tft_write_cmd(0x3A);
    tft_write_data_byte(0x05);

    // Gamma Curve Adjustments
    tft_write_cmd(0xE0);
    const uint8_t gamma_p[] = {
        0x02, 0x1C, 0x07, 0x12, 0x37, 0x32, 0x29, 0x2D,
        0x29, 0x25, 0x2B, 0x39, 0x00, 0x01, 0x03, 0x10
    };
    tft_write_data(gamma_p, sizeof(gamma_p));

    tft_write_cmd(0xE1);
    const uint8_t gamma_n[] = {
        0x03, 0x1D, 0x07, 0x06, 0x2E, 0x2C, 0x29, 0x2D,
        0x2E, 0x2E, 0x37, 0x3F, 0x00, 0x00, 0x02, 0x10
    };
    tft_write_data(gamma_n, sizeof(gamma_n));

    tft_write_cmd(0x13); // Normal Display Mode On
    vTaskDelay(pdMS_TO_TICKS(10));

    tft_write_cmd(0x29); // Display Main Screen On
    vTaskDelay(pdMS_TO_TICKS(100));

    s_tft_available = true;
    ESP_LOGI(TAG, "ST7735 1.8\" TFT SPI display initialized successfully (128x160).");
    return ESP_OK;
}
