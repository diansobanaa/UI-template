#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    BUTTON_MODE = 0,
    BUTTON_MANUAL_A,
    BUTTON_MANUAL_B,
    BUTTON_DISTRIBUTION,
    BUTTON_MAX_COUNT
} button_id_t;

typedef void (*button_event_cb_t)(button_id_t btn, bool pressed);

/**
 * @brief Initialize button GPIOs with pull-ups and debouncing.
 */
esp_err_t button_hal_init(button_event_cb_t cb);

/**
 * @brief Poll button states and execute debouncing logic (called periodically e.g. every 20-50ms).
 */
void button_hal_poll(void);

/**
 * @brief Check if button is currently pressed.
 */
bool button_hal_is_pressed(button_id_t btn);

#ifdef __cplusplus
}
#endif
