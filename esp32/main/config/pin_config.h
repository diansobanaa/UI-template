#pragma once

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @file pin_config.h
 * @brief Centralized Hardware Pin & Component Registry for ESP32-S3 Backend.
 *
 * All GPIO assignments MUST be referenced through this registry.
 * Never hardcode raw GPIO numbers elsewhere in firmware.
 *
 * NOTE: VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION.
 */

/* ========================================================================== */
/* SPI BUS & CHIP SELECT PIN DEFINITIONS                                     */
/* ========================================================================== */
#define PIN_SPI_SCK                 11
#define PIN_SPI_MOSI                12
#define PIN_SPI_MISO                13

#define PIN_W5500_CS                10
#define PIN_TFT_CS                  14
#define PIN_TFT_DC                  21
#define PIN_TFT_RST                 42
#define PIN_MICROSD_CS              27

/* ========================================================================== */
/* I2C BUS (RTC & EXPANDERS)                                                 */
/* ========================================================================== */
#define PIN_I2C_SDA                 8
#define PIN_I2C_SCL                 9
#define I2C_PORT_NUM                0
#define I2C_FREQ_HZ                 100000

/* ========================================================================== */
/* OUTPUT ACTUATORS (RELAYS & SWITCHES)                                       */
/* Active level: Default Active-High (1 = ON, 0 = OFF)                       */
/* ========================================================================== */
#define PIN_OUT_WELL_PUMP           1
#define PIN_OUT_DIST_PUMP           2
#define PIN_OUT_RAW_SUBMERSIBLE     4
#define PIN_OUT_DOSING_A            5
#define PIN_OUT_DOSING_B            6
#define PIN_OUT_COOLING_FAN         7
#define PIN_OUT_ERROR_LAMP          18

#define ACTUATOR_LEVEL_ON           1
#define ACTUATOR_LEVEL_OFF          0

/* ========================================================================== */
/* INPUT SENSORS & FLOATS                                                     */
/* ========================================================================== */
#define PIN_IN_FLOW_YFB1            15   /* Flow pulse input 1 */
#define PIN_IN_FLOW_FS400A          16   /* Flow pulse input 2 */
#define PIN_IN_TEMP_DS18B20         17   /* 1-Wire Temperature Bus */
#define PIN_IN_FLOAT_LOWER          26   /* Digital Lower Float Switch */

/* ========================================================================== */
/* PHYSICAL OPERATOR BUTTONS                                                  */
/* Active level: Active-Low (Pulled High internally/externally)              */
/* ========================================================================== */
#define PIN_BTN_MODE                38
#define PIN_BTN_MANUAL_A            39
#define PIN_BTN_MANUAL_B            40
#define PIN_BTN_DISTRIBUTION        41

#define BUTTON_LEVEL_PRESSED        0
#define BUTTON_LEVEL_RELEASED       1

/* ========================================================================== */
/* RESERVED STRAPPING & SYSTEM PINS (DO NOT REASSIGN)                         */
/* Reserved: GPIO 0, 3, 20, 33-37, 43-44, 45-46, 48                          */
/* ========================================================================== */
#define IS_RESERVED_PIN(pin) ( \
    ((pin) == 0) || ((pin) == 3) || ((pin) == 20) || \
    ((pin) >= 33 && (pin) <= 37) || \
    ((pin) == 43) || ((pin) == 44) || \
    ((pin) == 45) || ((pin) == 46) || \
    ((pin) == 48) \
)

#ifdef __cplusplus
}
#endif
