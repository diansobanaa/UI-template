#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/* RGB565 Basic Color Definitions */
#define TFT_COLOR_BLACK       0x0000
#define TFT_COLOR_WHITE       0xFFFF
#define TFT_COLOR_RED         0xF800
#define TFT_COLOR_GREEN       0x07E0
#define TFT_COLOR_DARKGREEN   0x03E0
#define TFT_COLOR_BLUE        0x001F
#define TFT_COLOR_YELLOW      0xFFE0
#define TFT_COLOR_CYAN        0x07FF
#define TFT_COLOR_GRAY        0x8410
#define TFT_COLOR_DARKGRAY    0x2104

/**
 * @brief Initialize ST7735 1.8" TFT display on shared SPI2_HOST bus.
 *
 * Configures CS (GPIO14), DC (GPIO21), and RST (GPIO42) as an SPI device on SPI2_HOST.
 * Performs bounded reset and initialization sequence.
 *
 * @note Non-blocking / degraded mode: If display is not attached or SPI transmission
 * fails, returns ESP_OK (marked as degraded) or ESP_ERR_NOT_FOUND without crashing or blocking boot.
 *
 * @return ESP_OK on success or degraded handling.
 */
esp_err_t tft_hal_init(void);

/**
 * @brief Check if the TFT display was successfully detected and initialized.
 */
bool tft_hal_is_available(void);

/**
 * @brief Fill the entire 128x160 display area with a solid color.
 *
 * @param color 16-bit RGB565 color value.
 */
void tft_fill_screen(uint16_t color);

/**
 * @brief Fill a rectangular region on the display.
 *
 * @param x Start X coordinate (0 to 127)
 * @param y Start Y coordinate (0 to 159)
 * @param w Width in pixels
 * @param h Height in pixels
 * @param color 16-bit RGB565 color value
 */
void tft_fill_rect(uint16_t x, uint16_t y, uint16_t w, uint16_t h, uint16_t color);

/**
 * @brief Render a string of text using embedded 5x7 ASCII bitmap font.
 *
 * @param x Start X coordinate
 * @param y Start Y coordinate
 * @param str Null-terminated string to render
 * @param color Text color (RGB565)
 * @param bg Background color (RGB565)
 * @param size Font scale factor (1 = 6x8 px per char, 2 = 12x16 px per char)
 */
void tft_draw_string(uint16_t x, uint16_t y, const char *str, uint16_t color, uint16_t bg, uint8_t size);

/**
 * @brief Render simple system diagnostic screen.
 *
 * Displays:
 * - AGROTECH
 * - ESP32
 * - TFT OK
 * - 128x160
 * - deviceId
 * - firmwareVersion
 *
 * @param device_id Device identifier string
 * @param fw_version Firmware version string
 */
void tft_show_diagnostic_screen(const char *device_id, const char *fw_version);

#ifdef __cplusplus
}
#endif
