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
#define PIN_MICROSD_CS              27

/* ========================================================================== */
/* DISPLAY: ST7735 1.8" TFT SPI (128x160)                                    */
/* Controller: ST7735, Resolution: 128 x 160, Bus: Shared SPI               */
/* Do NOT use 2.4" or 2.8" displays or ILI9341/ST7789 controllers.           */
/* ========================================================================== */
#define TFT_DRIVER_ST7735           1
#define TFT_WIDTH_PX                128
#define TFT_HEIGHT_PX               160
#define PIN_TFT_CS                  14
#define PIN_TFT_DC                  21
#define PIN_TFT_RST                 42

/* ========================================================================== */
/* I2C BUS (RTC & EXPANDERS)                                                 */
/* ========================================================================== */
#define PIN_I2C_SDA                 8
#define PIN_I2C_SCL                 9
#define I2C_PORT_NUM                0
#define I2C_FREQ_HZ                 100000

/* ========================================================================== */
/* OUTPUT ACTUATORS (RELAYS & SWITCHES)                                       */
/* Standard optocoupled relay modules: Active-LOW (0 = ON, 1 = OFF)           */
/* Direct logic / MOSFET driver boards: Active-HIGH (1 = ON, 0 = OFF)         */
/* Default in firmware is Active-LOW (0) for optocoupled relay board.         */
/* NOTE: VERIFY RELAY MODULE DATASHEET / POLARITY BEFORE CONNECTION.          */
/* ========================================================================== */
#define PIN_OUT_WELL_PUMP           1
#define PIN_OUT_DIST_PUMP           2
#define PIN_OUT_RAW_SUBMERSIBLE     4
#define PIN_OUT_DOSING_A            5
#define PIN_OUT_DOSING_B            6
#define PIN_OUT_COOLING_FAN         7
#define PIN_OUT_ERROR_LAMP          18

#define ACTUATOR_ACTIVE_LEVEL       0   /* 0 = Active-LOW (standard relay boards), 1 = Active-HIGH (VERIFY DATASHEET) */
#define ACTUATOR_LEVEL_ON           (ACTUATOR_ACTIVE_LEVEL)
#define ACTUATOR_LEVEL_OFF          (!ACTUATOR_ACTIVE_LEVEL)

/* ========================================================================== */
/* INPUT SENSORS & FLOATS                                                     */
/* Lower Float Switch (Safety Stop Point / Dry-Run Protection): GPIO 26      */
/* Pulled up internally to 3.3V.                                             */
/* When tank has water: float is up (switch open) -> pin reads 1 (OK/NORMAL)  */
/* When tank reaches min: float drops (switch closes to GND) -> pin reads 0 (DRY) */
/* NOTE: Upper float / tank-full sensor is NOT USED. Tank volume is controlled*/
/* by UI target volume input with capacity boundary validation.              */
/* NOTE: VERIFY FLOAT CONTACT ORIENTATION (NO vs NC) UPON INSTALLATION.       */
/* ========================================================================== */
#define PIN_IN_FLOW_YFB1            15   /* Flow pulse input 1 */
#define PIN_IN_FLOW_FS400A          16   /* Flow pulse input 2 */
#define PIN_IN_TEMP_DS18B20         17   /* 1-Wire Temperature Bus */
#define PIN_IN_FLOAT_LOWER          26   /* Digital Lower Float Switch */

#define FLOAT_LEVEL_DRY             0    /* 0 = Dry / Min Tank Stop Point (Trip) */
#define FLOAT_LEVEL_OK              1    /* 1 = Water OK / Sufficient Level */

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
