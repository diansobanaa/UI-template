#include "hal/tft_hal.h"
#include "hal/sensor_hal.h"
#include "hal/actuator_hal.h"
#include "network/network_mgr.h"
#include "storage/storage_mgr.h"
#include "services/telemetry_mgr.h"
#include "services/fertigation_mgr.h"
#include "services/scheduler.h"
#include "hal/hardware_registry.h"
#include "hal/rtc_ds3231.h"
#include "config/pin_config.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <time.h>

static const char *TAG = "TFT_HAL";

static spi_device_handle_t s_spi_dev = NULL;
static bool s_tft_available = false;
static tft_screen_id_t s_current_screen = TFT_SCREEN_HOME;
static TaskHandle_t s_tft_task_handle = NULL;
static bool s_need_full_redraw = false;

/* Custom 7x7 High-Density Vector Icons */
static const uint8_t s_icon_leaf[7]     = { 0x1C, 0x3E, 0x7E, 0x7C, 0x38, 0x10, 0x30 };
static const uint8_t s_icon_wifi[7]     = { 0x3C, 0x42, 0x99, 0x24, 0x00, 0x18, 0x18 };
static const uint8_t s_icon_thermo[7]   = { 0x10, 0x28, 0x28, 0x28, 0x7C, 0x7C, 0x38 };
static const uint8_t s_icon_drop[7]     = { 0x10, 0x38, 0x7C, 0x7C, 0xFE, 0x7C, 0x38 };
static const uint8_t s_icon_sun[7]      = { 0x28, 0x82, 0x38, 0xBA, 0x38, 0x82, 0x28 };
static const uint8_t s_icon_wave[7]     = { 0x00, 0x66, 0x99, 0x00, 0x66, 0x99, 0x00 };
static const uint8_t s_icon_pump[7]     = { 0x78, 0x30, 0xFE, 0xC6, 0x10, 0x38, 0x10 };
static const uint8_t s_icon_faucet[7]   = { 0x1C, 0x14, 0x7C, 0x70, 0x70, 0x00, 0x20 };
static const uint8_t s_icon_flask[7]    = { 0x38, 0x10, 0x28, 0x44, 0xFE, 0xDE, 0xFE };
static const uint8_t s_icon_dosa[7]     = { 0x38, 0x10, 0x7C, 0x54, 0x7C, 0x44, 0x7C };
static const uint8_t s_icon_dosb[7]     = { 0x38, 0x10, 0x7C, 0x64, 0x7C, 0x64, 0x7C };
static const uint8_t s_icon_calendar[7] = { 0xAA, 0xFE, 0x82, 0xAA, 0x82, 0xAA, 0xFE };
static const uint8_t s_icon_fan[7]      = { 0x60, 0x6C, 0x18, 0x38, 0x30, 0x6C, 0x0C };
static const uint8_t s_icon_bulb[7]     = { 0x38, 0x44, 0x44, 0x28, 0x38, 0x38, 0x10 };
static const uint8_t s_icon_play[7]     = { 0x80, 0xC0, 0xE0, 0xF0, 0xE0, 0xC0, 0x80 };
static const uint8_t s_icon_clock[7]    = { 0x38, 0x44, 0x54, 0x54, 0x4C, 0x44, 0x38 };
static const uint8_t s_icon_signal[7]   = { 0x02, 0x06, 0x0E, 0x1E, 0x3E, 0x7E, 0xFE };
static const uint8_t s_icon_sprout[7]   = { 0x10, 0x38, 0x54, 0x10, 0x10, 0x10, 0x10 };

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
        .flags = SPI_TRANS_USE_TXDATA,
        .length = 8,
        .tx_data = { cmd }
    };
    return spi_device_polling_transmit(s_spi_dev, &t);
}

static esp_err_t tft_write_data(const uint8_t *data, size_t len)
{
    if (!s_spi_dev || !data || len == 0) return ESP_ERR_INVALID_STATE;
    gpio_set_level(PIN_TFT_DC, 1); // Data mode
    if (len <= 4) {
        spi_transaction_t t = {
            .flags = SPI_TRANS_USE_TXDATA,
            .length = len * 8
        };
        memcpy(t.tx_data, data, len);
        return spi_device_polling_transmit(s_spi_dev, &t);
    }
    WORD_ALIGNED_ATTR static uint8_t s_dma_buf[256];
    while (len > 0) {
        size_t chunk = (len > sizeof(s_dma_buf)) ? sizeof(s_dma_buf) : len;
        memcpy(s_dma_buf, data, chunk);
        spi_transaction_t t = {
            .length = chunk * 8,
            .tx_buffer = s_dma_buf
        };
        esp_err_t ret = spi_device_polling_transmit(s_spi_dev, &t);
        if (ret != ESP_OK) return ret;
        data += chunk;
        len -= chunk;
    }
    return ESP_OK;
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

    WORD_ALIGNED_ATTR static uint8_t s_pixel_buf[256];
    size_t chunk_pixels = (w > 128) ? 128 : w;
    for (size_t i = 0; i < chunk_pixels; i++) {
        s_pixel_buf[i * 2] = color_high;
        s_pixel_buf[i * 2 + 1] = color_low;
    }

    size_t total_pixels = (size_t)w * h;
    while (total_pixels > 0) {
        size_t batch = (total_pixels > chunk_pixels) ? chunk_pixels : total_pixels;
        tft_write_data(s_pixel_buf, batch * 2);
        total_pixels -= batch;
    }
}

void tft_fill_screen(uint16_t color)
{
    tft_fill_rect(0, 0, TFT_WIDTH_PX, TFT_HEIGHT_PX, color);
}

void tft_draw_rect(uint16_t x, uint16_t y, uint16_t w, uint16_t h, uint16_t color)
{
    if (!s_tft_available || w == 0 || h == 0) return;
    tft_fill_rect(x, y, w, 1, color);
    tft_fill_rect(x, y + h - 1, w, 1, color);
    tft_fill_rect(x, y, 1, h, color);
    tft_fill_rect(x + w - 1, y, 1, h, color);
}

static void tft_draw_char(uint16_t x, uint16_t y, char c, uint16_t color, uint16_t bg, uint8_t size)
{
    if (c < 0x20 || c > 0x7E) c = '?';
    const uint8_t *bitmap = s_font5x7[c - 0x20];

    if (size == 1) {
        if (x + 6 > TFT_WIDTH_PX || y + 8 > TFT_HEIGHT_PX) return;
        tft_set_addr_window(x, y, x + 5, y + 7);
        WORD_ALIGNED_ATTR static uint8_t char_bytes[6 * 8 * 2];
        for (uint8_t row = 0; row < 8; row++) {
            for (uint8_t col = 0; col < 5; col++) {
                uint8_t line = bitmap[col];
                bool bit = (row < 7) ? ((line & (1 << row)) != 0) : false;
                uint16_t pcolor = bit ? color : bg;
                char_bytes[(row * 6 + col) * 2] = (pcolor >> 8) & 0xFF;
                char_bytes[(row * 6 + col) * 2 + 1] = pcolor & 0xFF;
            }
            char_bytes[(row * 6 + 5) * 2] = (bg >> 8) & 0xFF;
            char_bytes[(row * 6 + 5) * 2 + 1] = bg & 0xFF;
        }
        tft_write_data(char_bytes, sizeof(char_bytes));
        return;
    }

    for (uint8_t col = 0; col < 5; col++) {
        uint8_t line = bitmap[col];
        for (uint8_t row = 0; row < 7; row++) {
            uint16_t pixel_color = (line & (1 << row)) ? color : bg;
            tft_fill_rect(x + (col * size), y + (row * size), size, size, pixel_color);
        }
    }
    tft_fill_rect(x + (5 * size), y, size, 7 * size, bg);
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

void tft_draw_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color)
{
    if (!s_tft_available) return;
    int16_t dx = abs(x1 - x0);
    int16_t dy = -abs(y1 - y0);
    int16_t sx = (x0 < x1) ? 1 : -1;
    int16_t sy = (y0 < y1) ? 1 : -1;
    int16_t err = dx + dy;

    while (1) {
        if (x0 >= 0 && x0 < TFT_WIDTH_PX && y0 >= 0 && y0 < TFT_HEIGHT_PX) {
            tft_fill_rect(x0, y0, 1, 1, color);
        }
        if (x0 == x1 && y0 == y1) break;
        int16_t e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

void tft_draw_bitmap(uint16_t x, uint16_t y, const uint8_t *bitmap, uint8_t w, uint8_t h, uint16_t color, uint16_t bg)
{
    if (!s_tft_available || !bitmap || w == 0 || h == 0) return;
    if (x + w > TFT_WIDTH_PX || y + h > TFT_HEIGHT_PX) return;

    if (w <= 8 && h <= 8 && bg != TFT_COLOR_TRANSPARENT) {
        tft_set_addr_window(x, y, x + w - 1, y + h - 1);
        WORD_ALIGNED_ATTR static uint8_t icon_bytes[64 * 2];
        for (uint8_t r = 0; r < h; r++) {
            uint8_t line = bitmap[r];
            for (uint8_t c = 0; c < w; c++) {
                bool on = (line & (1 << (7 - c))) != 0;
                uint16_t pcolor = on ? color : bg;
                icon_bytes[(r * w + c) * 2] = (pcolor >> 8) & 0xFF;
                icon_bytes[(r * w + c) * 2 + 1] = pcolor & 0xFF;
            }
        }
        tft_write_data(icon_bytes, w * h * 2);
        return;
    }

    for (uint8_t r = 0; r < h; r++) {
        uint8_t line = bitmap[r];
        for (uint8_t c = 0; c < w; c++) {
            bool on = (line & (1 << (7 - c))) != 0;
            if (on) {
                tft_fill_rect(x + c, y + r, 1, 1, color);
            } else if (bg != TFT_COLOR_TRANSPARENT) {
                tft_fill_rect(x + c, y + r, 1, 1, bg);
            }
        }
    }
}

static void get_complex_gh_ids(char *out_str, size_t out_len)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    char c_code[12] = "C-01";
    if (st && st->complex_id[0]) {
        if (strncmp(st->complex_id, "complex-", 8) == 0) {
            snprintf(c_code, sizeof(c_code), "C-%.4s", st->complex_id + 8);
        } else {
            snprintf(c_code, sizeof(c_code), "%.5s", st->complex_id);
        }
    }
    char gh_code[12] = "GH-01";
    size_t count = hardware_registry_get_count();
    for (size_t i = 0; i < count; i++) {
        hw_component_info_t info;
        if (hardware_registry_get_by_index(i, &info) == ESP_OK && info.assignment.gh_id[0]) {
            if (strncmp(info.assignment.gh_id, "gh-", 3) == 0) {
                snprintf(gh_code, sizeof(gh_code), "GH-01");
            } else {
                snprintf(gh_code, sizeof(gh_code), "%.5s", info.assignment.gh_id);
            }
            break;
        }
    }
    snprintf(out_str, out_len, "%s|%s", c_code, gh_code);
}

static int s_prev_net_state = -1;
static int s_prev_header_mday = -1;
static schedule_entry_t s_sched_entries[16];
static int s_prev_timeline_marker_x = -1;
static int s_prev_marker_min = -1;

static void tft_draw_mini_wave(uint16_t x, uint16_t y, uint16_t w, uint16_t color)
{
    static const int8_t wave_offsets[24] = {
        0, 1, 2, 2, 1, 0, -1, -2, -2, -1, 0, 1, 2, 2, 1, 0, -1, -2, -2, -1, 0, 1, 2, 2
    };
    int prev_x = -1, prev_y = -1;
    for (uint16_t i = 0; i < w && i < 24; i++) {
        int px = x + i;
        int py = y + wave_offsets[i];
        if (prev_x >= 0) {
            tft_draw_line(prev_x, prev_y, px, py, color);
        }
        prev_x = px;
        prev_y = py;
    }
}

/* =========================================================================
 * SCREEN 1 (GAMBAR 1): OVERVIEW & LINGKUNGAN (HOME SCREEN UTAMA)
 * ========================================================================= */

static void draw_screen1_header(const struct tm *ti, bool full)
{
    if (full) {
        tft_fill_rect(0, 0, TFT_WIDTH_PX, 2, TFT_COLOR_GREEN);
        tft_draw_bitmap(2, 3, s_icon_leaf, 7, 7, TFT_COLOR_GREEN, TFT_COLOR_BLACK);
        tft_draw_string(11, 3, "AGRO", TFT_COLOR_GREEN, TFT_COLOR_BLACK, 1);
        char cgh[24];
        get_complex_gh_ids(cgh, sizeof(cgh));
        tft_draw_string(2, 13, cgh, TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);
        tft_draw_bitmap(54, 3, s_icon_wifi, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_BLACK);
        tft_fill_rect(63, 4, 3, 3, TFT_COLOR_GREEN);
        tft_fill_rect(0, 22, TFT_WIDTH_PX, 1, TFT_COLOR_DARKGRAY);
        s_prev_net_state = -1;
        s_prev_header_mday = -1;
    }

    int cur_net = network_mgr_is_connected() ? 2 : (network_mgr_is_setup_active() ? 1 : 0);
    if (full || cur_net != s_prev_net_state) {
        s_prev_net_state = cur_net;
        if (cur_net == 2) {
            tft_draw_string(52, 13, "STA", TFT_COLOR_GREEN, TFT_COLOR_BLACK, 1);
        } else if (cur_net == 1) {
            tft_draw_string(52, 13, "AP ", TFT_COLOR_YELLOW, TFT_COLOR_BLACK, 1);
        } else {
            tft_draw_string(52, 13, "OFF", TFT_COLOR_DARKGRAY, TFT_COLOR_BLACK, 1);
        }
    }

    if (full || ti->tm_mday != s_prev_header_mday) {
        s_prev_header_mday = ti->tm_mday;
        char date_str[16];
        strftime(date_str, sizeof(date_str), "%d %b", ti);
        tft_draw_string(78, 3, date_str, TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    }

    char time_str[16];
    strftime(time_str, sizeof(time_str), "%H:%M:%S", ti);
    tft_draw_string(74, 13, time_str, TFT_COLOR_CYAN, TFT_COLOR_BLACK, 1);
}

static void draw_screen1_process(bool full)
{
    fertigation_state_t fstate = fertigation_mgr_get_state();
    bool f_active = (fstate == FERT_STATE_PRECHECK || fstate == FERT_STATE_FILLING ||
                     fstate == FERT_STATE_DOSING || fstate == FERT_STATE_FINAL_MIXING ||
                     fstate == FERT_STATE_MIX_READY || fstate == FERT_STATE_DELIVERY);
    bool pump_on = actuator_hal_get_state(ACTUATOR_WELL_PUMP);

    if (full) {
        tft_fill_rect(1, 24, 126, 32, TFT_COLOR_CARD_BG);
        tft_draw_rect(1, 24, 126, 32, 0x03E0);
        tft_fill_rect(0, 57, TFT_WIDTH_PX, 1, TFT_COLOR_DARKGRAY);
    }

    if (f_active) {
        tft_draw_bitmap(4, 27, s_icon_play, 7, 7, TFT_COLOR_GREEN, TFT_COLOR_CARD_BG);
        tft_draw_string(14, 27, "FERTIGASI", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(14, 37, "Vegetatif-1", TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);

        fertigation_runtime_snapshot_t rsnap;
        fertigation_mgr_get_status(&rsnap);
        uint32_t elapsed_min = (rsnap.start_timestamp_ms > 0) ? (uint32_t)((time(NULL) - rsnap.start_timestamp_ms/1000) / 60) : 0;
        char pbuf[16];
        snprintf(pbuf, sizeof(pbuf), "%2lu/30", (unsigned long)elapsed_min);
        tft_draw_string(76, 27, pbuf, TFT_COLOR_GREEN, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(76, 37, "menit", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);

        tft_fill_rect(106, 27, 19, 8, TFT_COLOR_GREEN);
        tft_draw_string(107, 27, "RUN", TFT_COLOR_BLACK, TFT_COLOR_GREEN, 1);

        uint32_t total_min = 30;
        uint32_t fill_px = (elapsed_min >= total_min) ? 46 : (elapsed_min * 46 / total_min);
        if (fill_px < 2) fill_px = 2;
        tft_fill_rect(76, 48, fill_px, 3, TFT_COLOR_CYAN);
        if (fill_px < 46) tft_fill_rect(76 + fill_px, 48, 46 - fill_px, 3, TFT_COLOR_DARKGRAY);
    } else if (pump_on) {
        tft_draw_bitmap(4, 27, s_icon_faucet, 7, 7, TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG);
        tft_draw_string(14, 27, "WELL PUMP", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(14, 37, "MANUAL RUN ", TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG, 1);

        tft_fill_rect(106, 27, 19, 8, TFT_COLOR_YELLOW);
        tft_draw_string(107, 27, "RUN", TFT_COLOR_BLACK, TFT_COLOR_YELLOW, 1);
        tft_fill_rect(76, 48, 46, 3, TFT_COLOR_YELLOW);
    } else {
        tft_draw_bitmap(4, 27, s_icon_play, 7, 7, TFT_COLOR_GRAY, TFT_COLOR_CARD_BG);
        tft_draw_string(14, 28, "FERTIGASI: IDLE ", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(14, 40, "Standby / Ready ", TFT_COLOR_DARKGRAY, TFT_COLOR_CARD_BG, 1);
        tft_fill_rect(106, 27, 19, 8, TFT_COLOR_CARD_BG);
        tft_fill_rect(76, 48, 46, 3, TFT_COLOR_DARKGRAY);
    }
}

static void draw_screen1_sensors(bool full)
{
    telemetry_snapshot_t snap;
    telemetry_mgr_get_snapshot(&snap);
    char sbuf[16];

    const uint16_t card_xs[4] = { 1, 33, 65, 97 };
    const uint16_t card_w = 30;
    const uint16_t card_h = 42;
    const uint16_t card_y = 59;

    if (full) {
        for (int i = 0; i < 4; i++) {
            tft_fill_rect(card_xs[i], card_y, card_w, card_h, TFT_COLOR_CARD_BG);
            tft_draw_rect(card_xs[i], card_y, card_w, card_h, 0x18C3);
        }
        // Card icons
        tft_draw_bitmap(card_xs[0] + 2, card_y + 2, s_icon_thermo, 7, 7, 0xFD20, TFT_COLOR_CARD_BG);
        tft_draw_bitmap(card_xs[1] + 2, card_y + 2, s_icon_drop, 7, 7, 0x05BF, TFT_COLOR_CARD_BG);
        tft_draw_bitmap(card_xs[2] + 2, card_y + 2, s_icon_sun, 7, 7, TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG);
        tft_draw_bitmap(card_xs[3] + 2, card_y + 2, s_icon_wave, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG);

        // Mini wave visual flourishes at bottom of each card
        tft_draw_bitmap(card_xs[0] + 2, card_y + 32, s_icon_sprout, 7, 7, TFT_COLOR_GREEN, TFT_COLOR_CARD_BG);
        tft_draw_mini_wave(card_xs[0] + 11, card_y + 34, 17, TFT_COLOR_GREEN);
        tft_draw_mini_wave(card_xs[1] + 3, card_y + 34, 24, TFT_COLOR_CYAN);
        tft_draw_mini_wave(card_xs[2] + 3, card_y + 34, 24, TFT_COLOR_YELLOW);
        tft_draw_mini_wave(card_xs[3] + 3, card_y + 34, 24, 0x05BF);

        tft_fill_rect(0, 102, TFT_WIDTH_PX, 1, TFT_COLOR_DARKGRAY);
    }

    // Col 1: Air Temp
    if (snap.temp_valid) snprintf(sbuf, sizeof(sbuf), "%4.1f", snap.temperature_c);
    else snprintf(sbuf, sizeof(sbuf), "--.-");
    tft_draw_string(card_xs[0] + 2, card_y + 13, sbuf, TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
    tft_draw_string(card_xs[0] + 8, card_y + 23, "C", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);

    // Col 2: Air Humidity
    if (snap.humidity_valid) snprintf(sbuf, sizeof(sbuf), "%4.1f", snap.humidity_pct);
    else snprintf(sbuf, sizeof(sbuf), "--.-");
    tft_draw_string(card_xs[1] + 2, card_y + 13, sbuf, TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
    tft_draw_string(card_xs[1] + 10, card_y + 23, "%", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);

    // Col 3: Light Lux
    if (snap.light_valid) snprintf(sbuf, sizeof(sbuf), "%4.0f", snap.light_lux);
    else snprintf(sbuf, sizeof(sbuf), "----");
    tft_draw_string(card_xs[2] + 2, card_y + 13, sbuf, TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG, 1);
    tft_draw_string(card_xs[2] + 8, card_y + 23, "lx", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);

    // Col 4: Water Temp (DS18B20 live probe)
    if (snap.temp_water_valid) snprintf(sbuf, sizeof(sbuf), "%4.1f", snap.temperature_water_c);
    else snprintf(sbuf, sizeof(sbuf), "--.-");
    tft_draw_string(card_xs[3] + 2, card_y + 13, sbuf, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);
    tft_draw_string(card_xs[3] + 8, card_y + 23, "C", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);
}

static void draw_screen1_temp_trend(bool full)
{
    float t_min = 0, t_max = 0;
    float t_series[60];
    size_t t_count = 0;
    esp_err_t terr = telemetry_mgr_get_temp_history(&t_min, &t_max, t_series, 60, &t_count);

    const uint16_t gx = 54, gy = 116, gw = 71, gh = 32;
    const uint16_t floor_y = gy + gh - 4; // 144

    if (full) {
        tft_draw_bitmap(2, 105, s_icon_thermo, 7, 7, TFT_COLOR_RED, TFT_COLOR_BLACK);
        tft_draw_string(11, 105, "Suhu GH Hari Ini", TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);

        // Chart floor baseline
        tft_fill_rect(gx, floor_y, gw, 1, TFT_COLOR_DARKGRAY);

        // Dotted gridlines
        for (uint16_t x = gx; x < gx + gw; x += 3) {
            tft_fill_rect(x, gy + 2, 1, 1, 0x3186);
            tft_fill_rect(x, gy + 14, 1, 1, 0x3186);
        }
        for (uint16_t y = gy + 2; y < floor_y; y += 3) {
            tft_fill_rect(gx + (gw / 2), y, 1, 1, 0x3186);
        }

        // Y-axis labels
        tft_draw_string(41, gy, "34", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        tft_draw_string(41, gy + 12, "28", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        tft_draw_string(41, gy + 24, "22", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);

        // X-axis milestone labels
        tft_draw_string(gx - 2, gy + gh - 1, "06:00", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        tft_draw_string(gx + (gw / 2) - 14, gy + gh - 1, "12:00", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        tft_draw_string(gx + gw - 28, gy + gh - 1, "18:00", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);

        // Labels MIN / MAX
        tft_draw_string(2, 126, "MIN", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        tft_draw_string(2, 147, "MAX", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    }

    // Min and Max numbers on left
    char mbuf[12];
    if (terr == ESP_OK) {
        snprintf(mbuf, sizeof(mbuf), "%4.1f", t_min);
        tft_draw_string(2, 116, mbuf, TFT_COLOR_CYAN, TFT_COLOR_BLACK, 1);
        snprintf(mbuf, sizeof(mbuf), "%4.1f", t_max);
        tft_draw_string(2, 137, mbuf, TFT_COLOR_ORANGE, TFT_COLOR_BLACK, 1);
    } else {
        tft_draw_string(2, 116, "--.-", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        tft_draw_string(2, 137, "--.-", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    }

    // Draw curve & shaded gradient fill
    if (t_count >= 2 && (t_max - t_min) >= 0.05f) {
        tft_fill_rect(gx, gy + 1, gw, gh - 5, TFT_COLOR_BLACK);
        // Re-draw dotted gridlines
        for (uint16_t x = gx; x < gx + gw; x += 3) {
            tft_fill_rect(x, gy + 2, 1, 1, 0x3186);
            tft_fill_rect(x, gy + 14, 1, 1, 0x3186);
        }
        for (uint16_t y = gy + 2; y < floor_y; y += 3) {
            tft_fill_rect(gx + (gw / 2), y, 1, 1, 0x3186);
        }

        int prev_px = -1, prev_py = -1;
        for (size_t i = 0; i < t_count; i++) {
            int px = gx + (int)((i * (gw - 2)) / (t_count - 1));
            int py = floor_y - 1 - (int)(((t_series[i] - t_min) / (t_max - t_min)) * (floor_y - gy - 4));
            if (py < gy + 1) py = gy + 1;
            if (py > floor_y - 1) py = floor_y - 1;

            // Shaded vertical fill under curve down to floor (single fast vertical bar)
            if (px >= gx && px < gx + gw && floor_y > (py + 1)) {
                tft_fill_rect(px, py + 1, 1, floor_y - (py + 1), 0x3800);
            }

            if (prev_px >= 0) {
                tft_draw_line(prev_px, prev_py, px, py, TFT_COLOR_ORANGE);
            }
            prev_px = px;
            prev_py = py;
        }
        if (prev_px >= 0) {
            tft_fill_rect(prev_px - 1, prev_py - 1, 2, 2, TFT_COLOR_WHITE);
        }
    }
}

void tft_show_home_screen(void)
{
    if (!s_tft_available) return;
    tft_fill_screen(TFT_COLOR_BLACK);
    time_t now = time(NULL);
    struct tm ti;
    localtime_r(&now, &ti);
    draw_screen1_header(&ti, true);
    draw_screen1_process(true);
    draw_screen1_sensors(true);
    draw_screen1_temp_trend(true);
}

static void tft_update_home_dynamic(void)
{
    if (!s_tft_available) return;
    time_t now = time(NULL);
    struct tm ti;
    localtime_r(&now, &ti);
    draw_screen1_header(&ti, false);
    draw_screen1_process(false);
    draw_screen1_sensors(false);
    draw_screen1_temp_trend(false);
}

/* =========================================================================
 * SCREEN 2 (GAMBAR 2): OPERASIONAL, AKTUATOR & JADWAL
 * ========================================================================= */

static void draw_screen2_fert_stats(bool full)
{
    fertigation_daily_stats_t dstats;
    fertigation_mgr_get_daily_stats(&dstats);

    if (full) {
        // Card 1: Fertigasi Hari Ini
        tft_fill_rect(1, 1, 62, 35, TFT_COLOR_CARD_BG);
        tft_draw_rect(1, 1, 62, 35, 0x2965);
        tft_draw_bitmap(4, 4, s_icon_flask, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG);
        tft_draw_string(14, 4, "Fertigasi", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        // Card 2: Target Hari Ini
        tft_fill_rect(65, 1, 62, 35, TFT_COLOR_CARD_BG);
        tft_draw_rect(65, 1, 62, 35, 0x2965);
        tft_draw_bitmap(68, 4, s_icon_drop, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG);
        tft_draw_string(78, 4, "Target", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        tft_fill_rect(0, 37, TFT_WIDTH_PX, 1, TFT_COLOR_DARKGRAY);
    }

    char fbuf[16];
    // Card 1 dynamic
    snprintf(fbuf, sizeof(fbuf), "%2lu", (unsigned long)dstats.run_count_today);
    tft_draw_string(6, 14, fbuf, TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
    tft_draw_string(20, 14, "kali", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);

    snprintf(fbuf, sizeof(fbuf), "%3lu", (unsigned long)dstats.delivered_liters_today);
    tft_draw_string(6, 24, fbuf, TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
    tft_draw_string(28, 24, "liter", TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);

    // Card 2 dynamic
    uint32_t target_l = 600;
    snprintf(fbuf, sizeof(fbuf), "%3lu", (unsigned long)target_l);
    tft_draw_string(70, 14, fbuf, TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
    tft_draw_string(92, 14, "liter", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);

    uint32_t pct = (target_l > 0) ? (dstats.delivered_liters_today * 100 / target_l) : 0;
    if (pct > 100) pct = 100;
    uint32_t bar_w = (pct * 36) / 100;
    if (bar_w < 2 && pct > 0) bar_w = 2;
    tft_fill_rect(68, 25, bar_w, 4, TFT_COLOR_CYAN);
    if (bar_w < 36) tft_fill_rect(68 + bar_w, 25, 36 - bar_w, 4, TFT_COLOR_DARKGRAY);

    snprintf(fbuf, sizeof(fbuf), "%2lu%%", (unsigned long)pct);
    tft_draw_string(106, 24, fbuf, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);
}

static void draw_screen2_actuator_matrix(bool full)
{
    fertigation_state_t fstate = fertigation_mgr_get_state();
    bool f_active = (fstate == FERT_STATE_PRECHECK || fstate == FERT_STATE_FILLING ||
                     fstate == FERT_STATE_DOSING || fstate == FERT_STATE_FINAL_MIXING ||
                     fstate == FERT_STATE_MIX_READY || fstate == FERT_STATE_DELIVERY);

    bool p_on = actuator_hal_get_state(ACTUATOR_WELL_PUMP);
    bool f_on = f_active || actuator_hal_get_state(ACTUATOR_DIST_PUMP);
    bool da_on = actuator_hal_get_state(ACTUATOR_DOSING_A);
    bool db_on = actuator_hal_get_state(ACTUATOR_DOSING_B);
    bool fan_on = actuator_hal_get_state(ACTUATOR_COOLING_FAN) || actuator_hal_get_state(ACTUATOR_BLOWER_FAN);
    bool lamp_on = actuator_hal_get_state(ACTUATOR_ERROR_LAMP);

    sensor_readings_t sread;
    sensor_hal_get_readings(&sread);

    const uint16_t col_xs[3] = { 1, 43, 85 };
    const uint16_t row_ys[2] = { 39, 68 };
    const uint16_t tile_w = 41;
    const uint16_t tile_h = 27;

    if (full) {
        for (int r = 0; r < 2; r++) {
            for (int c = 0; c < 3; c++) {
                tft_fill_rect(col_xs[c], row_ys[r], tile_w, tile_h, TFT_COLOR_CARD_BG);
                tft_draw_rect(col_xs[c], row_ys[r], tile_w, tile_h, 0x2965);
            }
        }

        // Row 1 Icons & Titles
        tft_draw_bitmap(col_xs[0] + 3, row_ys[0] + 3, s_icon_faucet, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG);
        tft_draw_string(col_xs[0] + 11, row_ys[0] + 3, "Well", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        tft_draw_bitmap(col_xs[1] + 3, row_ys[0] + 3, s_icon_pump, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG);
        tft_draw_string(col_xs[1] + 11, row_ys[0] + 3, "Fert", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        tft_draw_bitmap(col_xs[2] + 3, row_ys[0] + 3, s_icon_dosa, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG);
        tft_draw_string(col_xs[2] + 11, row_ys[0] + 3, "DosA", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        // Row 2 Icons & Titles
        tft_draw_bitmap(col_xs[0] + 3, row_ys[1] + 3, s_icon_dosb, 7, 7, TFT_COLOR_WHITE, TFT_COLOR_CARD_BG);
        tft_draw_string(col_xs[0] + 11, row_ys[1] + 3, "DosB", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        tft_draw_bitmap(col_xs[1] + 3, row_ys[1] + 3, s_icon_fan, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG);
        tft_draw_string(col_xs[1] + 11, row_ys[1] + 3, "Fan", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        tft_draw_bitmap(col_xs[2] + 3, row_ys[1] + 3, s_icon_bulb, 7, 7, TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG);
        tft_draw_string(col_xs[2] + 11, row_ys[1] + 3, "Lamp", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        tft_fill_rect(0, 97, TFT_WIDTH_PX, 1, TFT_COLOR_DARKGRAY);
    }

    // Tile 1: Well Pump
    tft_fill_rect(col_xs[0] + 26, row_ys[0] + 3, 13, 8, p_on ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY);
    tft_draw_string(col_xs[0] + 27, row_ys[0] + 3, p_on ? "ON" : "OF", p_on ? TFT_COLOR_BLACK : TFT_COLOR_GRAY, p_on ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, 1);
    char fbuf[16];
    snprintf(fbuf, sizeof(fbuf), "%4.1fL", sread.flow_rate_raw_zjb1_lpm);
    tft_draw_string(col_xs[0] + 2, row_ys[0] + 15, fbuf, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);
    tft_draw_bitmap(col_xs[0] + 31, row_ys[0] + 15, s_icon_signal, 7, 7, p_on ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, TFT_COLOR_CARD_BG);

    // Tile 2: Fertigasi
    tft_fill_rect(col_xs[1] + 26, row_ys[0] + 3, 13, 8, f_on ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY);
    tft_draw_string(col_xs[1] + 27, row_ys[0] + 3, f_on ? "ON" : "OF", f_on ? TFT_COLOR_BLACK : TFT_COLOR_GRAY, f_on ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, 1);
    snprintf(fbuf, sizeof(fbuf), "%4.1fL", sread.flow_rate_fert_fs400a_lpm);
    tft_draw_string(col_xs[1] + 2, row_ys[0] + 15, fbuf, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);
    tft_draw_bitmap(col_xs[1] + 31, row_ys[0] + 15, s_icon_signal, 7, 7, f_on ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, TFT_COLOR_CARD_BG);

    fertigation_queue_summary_t qsum;
    fertigation_mgr_get_queue_summary(&qsum);
    bool da_dosing = (da_on || (qsum.is_active && strcmp(qsum.runtime_state, "DOSING") == 0 && strcmp(qsum.active_channel, "A") == 0));
    bool db_dosing = (db_on || (qsum.is_active && strcmp(qsum.runtime_state, "DOSING") == 0 && strcmp(qsum.active_channel, "B") == 0));

    // Tile 3: Dosing A
    tft_fill_rect(col_xs[2] + 26, row_ys[0] + 3, 13, 8, da_dosing ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY);
    tft_draw_string(col_xs[2] + 27, row_ys[0] + 3, da_dosing ? "ON" : "OF", da_dosing ? TFT_COLOR_BLACK : TFT_COLOR_GRAY, da_dosing ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, 1);
    tft_draw_string(col_xs[2] + 2, row_ys[0] + 15, da_dosing ? "DOSE" : "0.0m", da_dosing ? TFT_COLOR_CYAN : TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);
    tft_draw_bitmap(col_xs[2] + 31, row_ys[0] + 15, s_icon_signal, 7, 7, da_dosing ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, TFT_COLOR_CARD_BG);

    // Tile 4: Dosing B
    tft_fill_rect(col_xs[0] + 26, row_ys[1] + 3, 13, 8, db_dosing ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY);
    tft_draw_string(col_xs[0] + 27, row_ys[1] + 3, db_dosing ? "ON" : "OF", db_dosing ? TFT_COLOR_BLACK : TFT_COLOR_GRAY, db_dosing ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, 1);
    tft_draw_string(col_xs[0] + 2, row_ys[1] + 15, db_dosing ? "DOSE" : "0.0m", db_dosing ? TFT_COLOR_CYAN : TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);
    tft_draw_bitmap(col_xs[0] + 31, row_ys[1] + 15, s_icon_signal, 7, 7, db_dosing ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, TFT_COLOR_CARD_BG);

    // Tile 5: Cooling Fan
    tft_fill_rect(col_xs[1] + 26, row_ys[1] + 3, 13, 8, fan_on ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY);
    tft_draw_string(col_xs[1] + 27, row_ys[1] + 3, fan_on ? "ON" : "OF", fan_on ? TFT_COLOR_BLACK : TFT_COLOR_GRAY, fan_on ? TFT_COLOR_GREEN : TFT_COLOR_DARKGRAY, 1);
    tft_draw_string(col_xs[1] + 4, row_ys[1] + 15, fan_on ? "RUN " : "AUTO", fan_on ? TFT_COLOR_GREEN : TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);

    // Tile 6: Error Lamp
    tft_fill_rect(col_xs[2] + 26, row_ys[1] + 3, 13, 8, lamp_on ? TFT_COLOR_RED : TFT_COLOR_DARKGRAY);
    tft_draw_string(col_xs[2] + 27, row_ys[1] + 3, lamp_on ? "ON" : "OF", lamp_on ? TFT_COLOR_BLACK : TFT_COLOR_GRAY, lamp_on ? TFT_COLOR_RED : TFT_COLOR_DARKGRAY, 1);
    tft_draw_string(col_xs[2] + 4, row_ys[1] + 15, lamp_on ? "ALRM" : "SAFE", lamp_on ? TFT_COLOR_RED : TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);
}

static void draw_screen2_next_fert(const struct tm *ti, bool full)
{
    (void)ti;
    if (full) {
        tft_fill_rect(1, 99, 126, 23, TFT_COLOR_CARD_BG);
        tft_draw_rect(1, 99, 126, 23, 0x2965);
        tft_draw_bitmap(4, 102, s_icon_clock, 7, 7, TFT_COLOR_ORANGE, TFT_COLOR_CARD_BG);
        tft_fill_rect(0, 123, TFT_WIDTH_PX, 1, TFT_COLOR_DARKGRAY);
    }

    today_occurrence_t next_occ;
    esp_err_t err = scheduler_get_next_occurrence(&next_occ);

    if (err == ESP_OK) {
        time_t occ_time = (time_t)next_occ.scheduled_timestamp;
        struct tm tm_sched;
        localtime_r(&occ_time, &tm_sched);

        tft_fill_rect(13, 102, 112, 8, TFT_COLOR_CARD_BG);
        tft_draw_string(13, 102, "NEXT", TFT_COLOR_ORANGE, TFT_COLOR_CARD_BG, 1);

        char gh_str[16];
        snprintf(gh_str, sizeof(gh_str), "%.15s", next_occ.gh_id[0] ? next_occ.gh_id : "GH");
        for (char *p = gh_str; *p; p++) {
            if (*p >= 'a' && *p <= 'z') *p -= 32;
        }
        tft_draw_string(44, 102, gh_str, TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG, 1);

        char time_str[12];
        snprintf(time_str, sizeof(time_str), "%02d:%02d", tm_sched.tm_hour, tm_sched.tm_min);
        tft_draw_string(92, 102, time_str, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);

        tft_fill_rect(13, 112, 112, 9, TFT_COLOR_CARD_BG);
        time_t now = time(NULL);
        int32_t diff_sec = (int32_t)(occ_time - now);

        char status_buf[32];
        if (next_occ.state == OCC_STATE_PREPARING) {
            snprintf(status_buf, sizeof(status_buf), "PREPARING BATCH");
            tft_draw_string(13, 112, status_buf, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);
        } else if (next_occ.state == OCC_STATE_READY_TO_SEND) {
            snprintf(status_buf, sizeof(status_buf), "READY TO SEND");
            tft_draw_string(13, 112, status_buf, TFT_COLOR_GREEN, TFT_COLOR_CARD_BG, 1);
        } else if (diff_sec > 60) {
            long mins = (long)(diff_sec / 60);
            if (mins >= 60) {
                snprintf(status_buf, sizeof(status_buf), "in %ldh %ldm", mins / 60, mins % 60);
            } else {
                snprintf(status_buf, sizeof(status_buf), "in %ld menit", mins);
            }
            tft_draw_string(13, 112, status_buf, TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
        } else if (diff_sec >= 0) {
            tft_draw_string(13, 112, "DUE NOW", TFT_COLOR_GREEN, TFT_COLOR_CARD_BG, 1);
        } else {
            tft_draw_string(13, 112, "PENDING", TFT_COLOR_ORANGE, TFT_COLOR_CARD_BG, 1);
        }
        tft_draw_bitmap(116, 112, s_icon_drop, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG);
    } else {
        tft_fill_rect(13, 102, 112, 8, TFT_COLOR_CARD_BG);
        tft_draw_string(13, 102, "NEXT: NONE", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(92, 102, "--:--", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);

        tft_fill_rect(13, 112, 112, 9, TFT_COLOR_CARD_BG);
        tft_draw_string(13, 112, "No schedule today", TFT_COLOR_DARKGRAY, TFT_COLOR_CARD_BG, 1);
    }
}

static void draw_screen2_timeline(const struct tm *ti, bool full)
{
    static today_occurrence_t today_occs[16];
    size_t occ_count = 0;
    memset(today_occs, 0, sizeof(today_occs));
    scheduler_get_today_occurrences(today_occs, 16, &occ_count);

    size_t legacy_count = 0;
    scheduler_get_all(s_sched_entries, 16, &legacy_count);

    int now_sec = ti->tm_hour * 3600 + ti->tm_min * 60 + ti->tm_sec;
    uint16_t bx = 4, by = 141, bw = 118, bh = 5;

    if (full) {
        tft_draw_bitmap(2, 125, s_icon_calendar, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_BLACK);
        tft_draw_string(11, 125, "Jadwal", TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);

        today_occurrence_t next_occ;
        if (scheduler_get_next_occurrence(&next_occ) == ESP_OK) {
            time_t occ_time = (time_t)next_occ.scheduled_timestamp;
            struct tm tm_sched;
            localtime_r(&occ_time, &tm_sched);
            char next_buf[20];
            char gh_short[10];
            snprintf(gh_short, sizeof(gh_short), "%.9s", next_occ.gh_id[0] ? next_occ.gh_id : "GH");
            for (char *p = gh_short; *p; p++) {
                if (*p >= 'a' && *p <= 'z') *p -= 32;
            }
            snprintf(next_buf, sizeof(next_buf), "%s %02d:%02d", gh_short, tm_sched.tm_hour, tm_sched.tm_min);
            tft_draw_string(52, 125, next_buf, TFT_COLOR_YELLOW, TFT_COLOR_BLACK, 1);
            tft_draw_bitmap(118, 125, s_icon_drop, 7, 7, TFT_COLOR_CYAN, TFT_COLOR_BLACK);
        } else {
            tft_draw_string(52, 125, "Next: None  ", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        }

        // Timeline Bar Background
        tft_fill_rect(bx, by, bw, bh, TFT_COLOR_DARKGRAY);

        // Render schedule blocks from authoritative today occurrences
        if (occ_count > 0) {
            for (size_t i = 0; i < occ_count; i++) {
                if (today_occs[i].scheduled_timestamp <= 0) continue;
                time_t t_occ = (time_t)today_occs[i].scheduled_timestamp;
                struct tm tm_o;
                localtime_r(&t_occ, &tm_o);
                int sched_sec = tm_o.tm_hour * 3600 + tm_o.tm_min * 60;
                int sx = bx + (sched_sec * bw) / 86400;
                int sw = 4; // 4-pixel width for fertigation batch block
                if (sx + sw > bx + bw) sw = bx + bw - sx;
                uint16_t color = TFT_COLOR_CYAN;
                if (today_occs[i].state == OCC_STATE_COMPLETED) color = TFT_COLOR_GREEN;
                else if (today_occs[i].state == OCC_STATE_FAILED) color = TFT_COLOR_RED;
                else if (today_occs[i].state == OCC_STATE_DISTRIBUTING) color = TFT_COLOR_CYAN;
                else color = TFT_COLOR_ORANGE;
                tft_fill_rect(sx, by, sw, bh, color);
            }
        } else {
            // Fallback to legacy entries if occurrences not compiled
            for (size_t i = 0; i < legacy_count; i++) {
                if (s_sched_entries[i].enabled && s_sched_entries[i].type == SCHED_TYPE_DAILY) {
                    int sched_sec = s_sched_entries[i].hour * 3600 + s_sched_entries[i].minute * 60;
                    int sx = bx + (sched_sec * bw) / 86400;
                    int sw = (s_sched_entries[i].duration_sec * bw) / 86400;
                    if (sw < 2) sw = 2;
                    if (sx + sw > bx + bw) sw = bx + bw - sx;
                    uint16_t color = TFT_COLOR_PURPLE;
                    if (s_sched_entries[i].action == SCHED_ACTION_FERTIGATION) color = TFT_COLOR_CYAN;
                    else if (s_sched_entries[i].action == SCHED_ACTION_WATER_PUMP) color = TFT_COLOR_ORANGE;
                    else if (s_sched_entries[i].action == SCHED_ACTION_FAN_TOGGLE) color = TFT_COLOR_GREEN;
                    tft_fill_rect(sx, by, sw, bh, color);
                }
            }
        }

        // Milestones
        tft_draw_string(20, 148, "06:00", 0x632C, TFT_COLOR_BLACK, 1);
        tft_draw_string(50, 148, "12:00", 0x632C, TFT_COLOR_BLACK, 1);
        tft_draw_string(80, 148, "18:00", 0x632C, TFT_COLOR_BLACK, 1);
        tft_fill_rect(bx + 30, by + bh, 1, 2, 0x632C);
        tft_fill_rect(bx + 60, by + bh, 1, 2, 0x632C);
        tft_fill_rect(bx + 90, by + bh, 1, 2, 0x632C);
    }

    int marker_x = bx + (now_sec * bw) / 86400;
    if (marker_x >= bx + bw) marker_x = bx + bw - 1;

    if (s_prev_timeline_marker_x != marker_x || s_prev_marker_min != ti->tm_min || full) {
        // Clear previous marker time label and pin
        tft_fill_rect(2, 134, 122, 7, TFT_COLOR_BLACK);
        // Restore timeline bar slice under previous marker
        if (s_prev_timeline_marker_x >= (int)bx && s_prev_timeline_marker_x < (int)(bx + bw)) {
            uint16_t restore_color = TFT_COLOR_DARKGRAY;
            if (occ_count > 0) {
                for (size_t i = 0; i < occ_count; i++) {
                    if (today_occs[i].scheduled_timestamp <= 0) continue;
                    time_t t_occ = (time_t)today_occs[i].scheduled_timestamp;
                    struct tm tm_o;
                    localtime_r(&t_occ, &tm_o);
                    int sched_sec = tm_o.tm_hour * 3600 + tm_o.tm_min * 60;
                    int sx = bx + (sched_sec * bw) / 86400;
                    int sw = 4;
                    if (s_prev_timeline_marker_x >= sx && s_prev_timeline_marker_x < sx + sw) {
                        if (today_occs[i].state == OCC_STATE_COMPLETED) restore_color = TFT_COLOR_GREEN;
                        else if (today_occs[i].state == OCC_STATE_FAILED) restore_color = TFT_COLOR_RED;
                        else restore_color = TFT_COLOR_CYAN;
                        break;
                    }
                }
            }
            tft_fill_rect(s_prev_timeline_marker_x, by, 1, bh, restore_color);
        }

        // Draw new red time label
        char cur_time_str[8];
        snprintf(cur_time_str, sizeof(cur_time_str), "%02d:%02d", ti->tm_hour, ti->tm_min);
        int tx = marker_x - 14;
        if (tx < 2) tx = 2;
        if (tx > 94) tx = 94;
        tft_draw_string(tx, 134, cur_time_str, TFT_COLOR_RED, TFT_COLOR_BLACK, 1);

        // Downward pointer ▼
        tft_fill_rect(marker_x - 1, 139, 3, 1, TFT_COLOR_RED);
        tft_fill_rect(marker_x, 140, 1, 1, TFT_COLOR_RED);

        // Vertical tick through timeline bar
        tft_fill_rect(marker_x, by, 1, bh, TFT_COLOR_RED);

        s_prev_timeline_marker_x = marker_x;
        s_prev_marker_min = ti->tm_min;
    }
}

void tft_show_operations_screen(void)
{
    if (!s_tft_available) return;
    tft_fill_screen(TFT_COLOR_BLACK);
    time_t now = time(NULL);
    struct tm ti;
    localtime_r(&now, &ti);
    s_prev_timeline_marker_x = -1;
    draw_screen2_fert_stats(true);
    draw_screen2_actuator_matrix(true);
    draw_screen2_next_fert(&ti, true);
    draw_screen2_timeline(&ti, true);
}

static void tft_update_operations_dynamic(void)
{
    if (!s_tft_available) return;
    time_t now = time(NULL);
    struct tm ti;
    localtime_r(&now, &ti);
    draw_screen2_fert_stats(false);
    draw_screen2_actuator_matrix(false);
    draw_screen2_next_fert(&ti, false);
    draw_screen2_timeline(&ti, false);
}

/* =========================================================================
 * SCREEN 3: COMPLEX DOSING BATCH QUEUE & SERIAL EXECUTION
 * ========================================================================= */

static void draw_screen3_active_batch(bool full)
{
    fertigation_queue_summary_t q;
    fertigation_mgr_get_queue_summary(&q);

    const uint16_t card_x = 1, card_y = 24, card_w = 126, card_h = 66;

    if (full) {
        tft_fill_rect(card_x, card_y, card_w, card_h, TFT_COLOR_CARD_BG);
        tft_draw_rect(card_x, card_y, card_w, card_h, 0x03E0);
        tft_draw_bitmap(card_x + 3, card_y + 3, s_icon_play, 7, 7, TFT_COLOR_GREEN, TFT_COLOR_CARD_BG);
        tft_draw_string(card_x + 13, card_y + 3, "BATCH AKTIF:", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
        tft_fill_rect(0, 92, TFT_WIDTH_PX, 1, TFT_COLOR_DARKGRAY);
    }

    if (q.is_active) {
        char gh_buf[64];
        snprintf(gh_buf, sizeof(gh_buf), "GH: %s", q.gh_id[0] ? q.gh_id : "GH-A");
        tft_draw_string(card_x + 13, card_y + 14, gh_buf, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);

        uint16_t st_col = TFT_COLOR_YELLOW;
        if (strcmp(q.runtime_state, "DOSING") == 0) st_col = TFT_COLOR_GREEN;
        else if (strcmp(q.runtime_state, "READY") == 0) st_col = TFT_COLOR_CYAN;
        tft_draw_string(card_x + 68, card_y + 14, q.runtime_state, st_col, TFT_COLOR_CARD_BG, 1);

        char raw_buf[64];
        snprintf(raw_buf, sizeof(raw_buf), "Air: %lu/%lu ml", (unsigned long)q.raw_water_actual_ml, (unsigned long)q.raw_water_target_ml);
        tft_draw_string(card_x + 4, card_y + 26, raw_buf, TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);

        uint16_t bx = card_x + 4, by = card_y + 37, bw = 118, bh = 6;
        tft_fill_rect(bx, by, bw, bh, TFT_COLOR_DARKGRAY);
        uint32_t target = q.raw_water_target_ml > 0 ? q.raw_water_target_ml : 1;
        uint32_t fill_w = (q.raw_water_actual_ml * bw) / target;
        if (fill_w > bw) fill_w = bw;
        tft_fill_rect(bx, by, fill_w, bh, TFT_COLOR_CYAN);

        uint32_t notch_x = bx + (q.threshold_percent * bw) / 100;
        if (notch_x < bx + bw) {
            tft_fill_rect(notch_x, by - 2, 2, bh + 4, TFT_COLOR_YELLOW);
        }

        if (strcmp(q.runtime_state, "DOSING") == 0) {
            char dose_buf[64];
            snprintf(dose_buf, sizeof(dose_buf), "DOSE: Channel %s (ON)", q.active_channel[0] ? q.active_channel : "A");
            tft_draw_string(card_x + 4, card_y + 48, dose_buf, TFT_COLOR_GREEN, TFT_COLOR_CARD_BG, 1);
        } else if (strcmp(q.runtime_state, "RAW_WATER") == 0) {
            tft_draw_string(card_x + 4, card_y + 48, "Isi Air Baku -> 20%", TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);
        } else if (strcmp(q.runtime_state, "READY") == 0) {
            tft_draw_string(card_x + 4, card_y + 48, "Batch Selesai - READY", TFT_COLOR_GREEN, TFT_COLOR_CARD_BG, 1);
        } else {
            tft_draw_string(card_x + 4, card_y + 48, "Eksekusi Batch Aktif", TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG, 1);
        }
    } else {
        tft_draw_string(card_x + 13, card_y + 16, "Status: IDLE / STANDBY", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(card_x + 4, card_y + 30, "Central Dosing Siap.", TFT_COLOR_DARKGRAY, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(card_x + 4, card_y + 44, "Tidak ada batch aktif.", TFT_COLOR_DARKGRAY, TFT_COLOR_CARD_BG, 1);
    }
}

static void draw_screen3_queue_list(bool full)
{
    const uint16_t card_x = 1, card_y = 95, card_w = 126, card_h = 47;

    if (full) {
        tft_fill_rect(card_x, card_y, card_w, card_h, TFT_COLOR_CARD_BG);
        tft_draw_rect(card_x, card_y, card_w, card_h, 0x18C3);
        tft_draw_bitmap(card_x + 3, card_y + 3, s_icon_calendar, 7, 7, TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG);
        tft_draw_string(card_x + 13, card_y + 3, "ANTREAN (COMPLEX):", TFT_COLOR_WHITE, TFT_COLOR_CARD_BG, 1);
    }

    static dosing_queue_entry_t q_entries[8];
    size_t q_count = 0;
    memset(q_entries, 0, sizeof(q_entries));
    scheduler_get_dosing_queue(q_entries, 8, &q_count);

    if (q_count > 0) {
        char line1[64];
        const char *st_str = "QUEUED";
        if (q_entries[0].state == QUEUE_STATE_DISPATCHED) st_str = "DISPATCH";
        else if (q_entries[0].state == QUEUE_STATE_ACTIVE) st_str = "ACTIVE";
        snprintf(line1, sizeof(line1), "1. %s [%s]", q_entries[0].gh_id[0] ? q_entries[0].gh_id : "GH", st_str);
        tft_draw_string(card_x + 4, card_y + 16, line1, TFT_COLOR_YELLOW, TFT_COLOR_CARD_BG, 1);

        char line2[64];
        snprintf(line2, sizeof(line2), "Total Antrean: %u batch", (unsigned)q_count);
        tft_draw_string(card_x + 4, card_y + 28, line2, TFT_COLOR_CYAN, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(card_x + 4, card_y + 37, "FIFO Serial Dosing", 0x03E0, TFT_COLOR_CARD_BG, 1);
    } else {
        tft_draw_string(card_x + 4, card_y + 16, "Antrean: KOSONG (0) ", TFT_COLOR_GREEN, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(card_x + 4, card_y + 28, "Serial: 1 Batch / Waktu", TFT_COLOR_GRAY, TFT_COLOR_CARD_BG, 1);
        tft_draw_string(card_x + 4, card_y + 37, "Interlock Dosing Aman", 0x03E0, TFT_COLOR_CARD_BG, 1);
    }
}

void tft_show_dosing_queue_screen(void)
{
    if (!s_tft_available) return;
    tft_fill_screen(TFT_COLOR_BLACK);

    // Header (Y: 0..22)
    tft_fill_rect(0, 0, TFT_WIDTH_PX, 22, 0x01A8);
    tft_draw_string(4, 5, "DOSING QUEUE", TFT_COLOR_WHITE, 0x01A8, 1);
    tft_draw_string(82, 5, "[SERIAL]", TFT_COLOR_YELLOW, 0x01A8, 1);
    tft_fill_rect(0, 22, TFT_WIDTH_PX, 1, TFT_COLOR_GREEN);

    draw_screen3_active_batch(true);
    draw_screen3_queue_list(true);

    // Footer (Y: 144..160)
    tft_fill_rect(0, 144, TFT_WIDTH_PX, 16, TFT_COLOR_DARKGRAY);
    tft_draw_string(8, 148, "[BTN1] SCREEN 3/4", TFT_COLOR_WHITE, TFT_COLOR_DARKGRAY, 1);
}

static void tft_update_dosing_queue_dynamic(void)
{
    if (!s_tft_available) return;
    draw_screen3_active_batch(false);
    draw_screen3_queue_list(false);
}

/* =========================================================================
 * SCREEN 4: SYSTEM, NETWORK & DIAGNOSTICS
 * ========================================================================= */

void tft_show_diagnostic_screen(const char *device_id, const char *fw_version)
{
    (void)device_id;
    (void)fw_version;
    s_current_screen = TFT_SCREEN_HOME;
    tft_show_home_screen();
}

static void tft_show_diagnostic_screen_full(void)
{
    if (!s_tft_available) return;

    tft_fill_screen(TFT_COLOR_BLACK);
    tft_fill_rect(0, 0, TFT_WIDTH_PX, 24, 0x01A8);
    tft_draw_string(8, 6, "SYSTEM/NET", TFT_COLOR_WHITE, 0x01A8, 2);
    tft_fill_rect(0, 24, TFT_WIDTH_PX, 1, TFT_COLOR_GREEN);

    tft_draw_string(8, 30, "WIFI STATUS:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    const char *net_state = network_mgr_get_state_string();
    if (network_mgr_is_connected()) tft_draw_string(8, 42, "CONNECTED (STA)", TFT_COLOR_GREEN, TFT_COLOR_BLACK, 1);
    else if (network_mgr_is_provisioning()) tft_draw_string(8, 42, "PROVISIONING", TFT_COLOR_YELLOW, TFT_COLOR_BLACK, 1);
    else tft_draw_string(8, 42, net_state, TFT_COLOR_YELLOW, TFT_COLOR_BLACK, 1);

    char ipbuf[24] = {0};
    if (network_mgr_is_setup_active()) {
        tft_draw_string(8, 56, "AP:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        tft_draw_string(28, 56, network_mgr_get_setup_ssid(), TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);
        tft_draw_string(8, 68, "CODE:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        tft_draw_string(40, 68, network_mgr_get_setup_pop(), TFT_COLOR_YELLOW, TFT_COLOR_BLACK, 1);
    } else {
        tft_draw_string(8, 56, "IP:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        if (network_mgr_get_ip(ipbuf, sizeof(ipbuf)) == ESP_OK) tft_draw_string(28, 56, ipbuf, TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);
        else tft_draw_string(28, 56, "NO IP          ", TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);
        tft_draw_string(8, 68, "SSID:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
        char ssidbuf[22] = {0};
        if (network_mgr_get_sta_ssid(ssidbuf, sizeof(ssidbuf)) == ESP_OK) tft_draw_string(38, 68, ssidbuf, TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);
        else tft_draw_string(38, 68, "NOT SET       ", TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);
    }

    tft_draw_string(8, 82, "HOST:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    char hostbuf[64];
    snprintf(hostbuf, sizeof(hostbuf), "%.23s.local", network_mgr_get_hostname());
    tft_draw_string(38, 82, hostbuf, TFT_COLOR_CYAN, TFT_COLOR_BLACK, 1);

    tft_draw_string(8, 96, "SYSTEM TIME:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    time_t now = time(NULL);
    struct tm ti;
    localtime_r(&now, &ti);
    char tbuf[32];
    strftime(tbuf, sizeof(tbuf), "%Y-%m-%d", &ti);
    tft_draw_string(8, 108, tbuf, TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);
    strftime(tbuf, sizeof(tbuf), "%H:%M:%S", &ti);
    tft_draw_string(8, 120, tbuf, TFT_COLOR_CYAN, TFT_COLOR_BLACK, 1);

    tft_draw_string(8, 132, "SAFETY:", TFT_COLOR_GRAY, TFT_COLOR_BLACK, 1);
    if (actuator_hal_is_emergency_stopped()) {
        tft_draw_string(52, 132, "E-STOP", TFT_COLOR_RED, TFT_COLOR_BLACK, 1);
    } else {
        tft_draw_string(52, 132, "SAFE  ", TFT_COLOR_GREEN, TFT_COLOR_BLACK, 1);
    }

    tft_fill_rect(0, 144, TFT_WIDTH_PX, 16, TFT_COLOR_DARKGRAY);
    tft_draw_string(8, 148, "[BTN1] SCREEN 4/4", TFT_COLOR_WHITE, TFT_COLOR_DARKGRAY, 1);
}

static void tft_update_diagnostic_dynamic(void)
{
    if (!s_tft_available) return;
    time_t now = time(NULL);
    struct tm ti;
    localtime_r(&now, &ti);
    char tbuf[32];
    strftime(tbuf, sizeof(tbuf), "%Y-%m-%d", &ti);
    tft_draw_string(8, 108, tbuf, TFT_COLOR_WHITE, TFT_COLOR_BLACK, 1);
    strftime(tbuf, sizeof(tbuf), "%H:%M:%S", &ti);
    tft_draw_string(8, 120, tbuf, TFT_COLOR_CYAN, TFT_COLOR_BLACK, 1);

    if (actuator_hal_is_emergency_stopped()) {
        tft_draw_string(52, 132, "E-STOP", TFT_COLOR_RED, TFT_COLOR_BLACK, 1);
    } else {
        tft_draw_string(52, 132, "SAFE  ", TFT_COLOR_GREEN, TFT_COLOR_BLACK, 1);
    }
}

static void tft_render_current_screen_full(void)
{
    switch (s_current_screen) {
        case TFT_SCREEN_HOME:
            tft_show_home_screen();
            break;
        case TFT_SCREEN_OPERATIONS:
            tft_show_operations_screen();
            break;
        case TFT_SCREEN_DOSING_QUEUE:
            tft_show_dosing_queue_screen();
            break;
        case TFT_SCREEN_DIAGNOSTICS:
            tft_show_diagnostic_screen_full();
            break;
        default:
            tft_show_home_screen();
            break;
    }
}

static void tft_render_current_screen_dynamic(void)
{
    switch (s_current_screen) {
        case TFT_SCREEN_HOME:
            tft_update_home_dynamic();
            break;
        case TFT_SCREEN_OPERATIONS:
            tft_update_operations_dynamic();
            break;
        case TFT_SCREEN_DOSING_QUEUE:
            tft_update_dosing_queue_dynamic();
            break;
        case TFT_SCREEN_DIAGNOSTICS:
            tft_update_diagnostic_dynamic();
            break;
        default:
            tft_update_home_dynamic();
            break;
    }
}

static void tft_screen_task(void *pvParameters)
{
    (void)pvParameters;
    ESP_LOGI(TAG, "TFT dynamic refresh task started (1s cadence, zero busy-wait).");
    while (1) {
        if (s_tft_available) {
            if (s_need_full_redraw) {
                s_need_full_redraw = false;
                ESP_LOGI(TAG, "TFT rendering screen %d (full redraw)", (int)s_current_screen);
                tft_render_current_screen_full();
            } else {
                tft_render_current_screen_dynamic();
            }
        }
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000));
    }
}

void tft_show_screen(tft_screen_id_t screen_id)
{
    if (!s_tft_available) return;
    s_current_screen = screen_id % TFT_SCREEN_COUNT;
    s_need_full_redraw = true;
    if (s_tft_task_handle) {
        xTaskNotifyGive(s_tft_task_handle);
    } else {
        tft_render_current_screen_full();
    }
}

void tft_show_next_screen(void)
{
    tft_show_screen((s_current_screen + 1) % TFT_SCREEN_COUNT);
}

tft_screen_id_t tft_get_current_screen(void)
{
    return s_current_screen;
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
    s_need_full_redraw = true;
    xTaskCreatePinnedToCore(tft_screen_task, "tft_screen_task", 5120, NULL, 2, &s_tft_task_handle, 1);
    ESP_LOGI(TAG, "ST7735 1.8\" TFT SPI display initialized successfully (128x160). Dynamic refresh task spawned on Core 1.");
    return ESP_OK;
}
