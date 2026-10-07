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
/* Shared SPI2_HOST Bus: SCK (11), MOSI (12), MISO (13)                      */
/* Peripherals:                                                               */
/*  - TFT ST7735 Display: CS = GPIO 14                                        */
/*  - MicroSD Card Adapter Module (EasyWare Part#: EP000094): CS = GPIO 48     */
/*  - No W5500 CS is defined by the canonical hardware wiring contract.    */
/* ========================================================================== */
#define PIN_SPI_SCK                 11
#define PIN_SPI_MOSI                12
#define PIN_SPI_MISO                13

/* MicroSD Card Adapter Signals (EasyWare Part#: EP000094, 6-Pin SPI Module) */
/* VCC: 4.5V-5.5V (Connect to 5V Rail), GND: Signal GND, Level Converter Onboard */
#define PIN_MICROSD_SCK             PIN_SPI_SCK
#define PIN_MICROSD_MOSI            PIN_SPI_MOSI
#define PIN_MICROSD_MISO            PIN_SPI_MISO
#define PIN_MICROSD_CS              48

/* Backward compatibility aliases */
#define PIN_SD_SCK                  PIN_MICROSD_SCK
#define PIN_SD_MOSI                 PIN_MICROSD_MOSI
#define PIN_SD_MISO                 PIN_MICROSD_MISO
#define PIN_SD_CS                   PIN_MICROSD_CS


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
/* RTC: DS3231 HIGH-PRECISION I2C BUS                                         */
/* Pins: SDA (GPIO 8), SCL (GPIO 9), 32K/SQW (NC). GPIO 47 is LIBERATED.      */
/* ========================================================================== */
#define PIN_I2C_SDA                 8
#define PIN_I2C_SCL                 9
#define I2C_PORT_NUM                0   /* I2C_NUM_0 */
#define I2C_FREQ_HZ                 100000

/* ========================================================================== */
/* OUTPUT ACTUATORS (RELAYS & MOSFET DRIVERS)                                 */
/* Canonical Relay Channel Assignment (4-Channel Optocoupled Relay Board):    */
/*   Relay Channel 1 (IN1): Well Pump (GPIO 1)                                */
/*   Relay Channel 2 (IN2): Distribution Pump (GPIO 2)                        */
/*   Relay Channel 3 (IN3): Blower Fans Contactor Trigger (GPIO 10)           */
/*   Relay Channel 4 (IN4): Mixing Pond Pumps (GPIO 40)                       */
/* Canonical MOSFET Driver Modules (High-Power N-Channel MOSFET Drivers):     */
/*   MOSFET Output 1: Raw Submersible Pump 1 (GPIO 4)                         */
/*   MOSFET Output 2: Peristaltic Dosing Pump A (GPIO 5)                      */
/*   MOSFET Output 3: Peristaltic Dosing Pump B (GPIO 6)                      */
/*   MOSFET Output 4: Cabinet Exhaust Cooling Fan (GPIO 7)                    */
/*   MOSFET Output 5: Active Alarm Buzzer Sounder (GPIO 18)                   */
/* ========================================================================== */
#define PIN_RELAY_CH1               1   /* Relay Channel 1: Well Pump */
#define PIN_RELAY_CH2               2   /* Relay Channel 2: Distribution Pump */
#define PIN_RELAY_CH3               10  /* Relay Channel 3: Greenhouse Blower Fans */
#define PIN_RELAY_CH4               40  /* Relay Channel 4: Mixing Pond Pumps */

#define PIN_OUT_WELL_PUMP           PIN_RELAY_CH1
#define PIN_OUT_DIST_PUMP           PIN_RELAY_CH2
#define PIN_OUT_BLOWER_FAN          PIN_RELAY_CH3
#define PIN_OUT_MIXING_PUMP         PIN_RELAY_CH4

#define PIN_MOSFET_RAW_SUBMERSIBLE_1 4  /* MOSFET Output 1: Raw Submersible Pump 1 (12V DC) */
#define PIN_OUT_RAW_SUBMERSIBLE     PIN_MOSFET_RAW_SUBMERSIBLE_1
#define PIN_OUT_RAW_SUBMERSIBLE_1   PIN_MOSFET_RAW_SUBMERSIBLE_1

#define PIN_OUT_DOSING_A            5   /* MOSFET Output 2: Peristaltic Dosing Pump A (12V DC) */
#define PIN_OUT_DOSING_B            6   /* MOSFET Output 3: Peristaltic Dosing Pump B (12V DC) */
#define PIN_OUT_COOLING_FAN         -1  /* Cabinet Fan is powered directly from PSU +/- (no MCU GPIO control) */
#define PIN_OUT_BUZZER              18  /* MOSFET Output 5: Active Alarm Buzzer (5V DC, ~30mA) */
#define PIN_OUT_ERROR_LAMP          -1  /* Error lamp unmapped; alarm annunciator handled by PIN_OUT_BUZZER (GPIO 18) */

#define RELAY_ACTIVE_LEVEL          0   /* 0 = Active-LOW (4-Channel Relay Board: Well Pump, Dist Pump, Blower Fans, Mixing Pump) */
#define MOSFET_ACTIVE_LEVEL         1   /* 1 = Active-HIGH (N-channel MOSFET modules: Raw Submersible 1, Dosing A/B, Fan, Buzzer) */

#define ACTUATOR_ACTIVE_LEVEL       RELAY_ACTIVE_LEVEL
#define ACTUATOR_LEVEL_ON           (ACTUATOR_ACTIVE_LEVEL)
#define ACTUATOR_LEVEL_OFF          (!ACTUATOR_ACTIVE_LEVEL)

#define RAW_SUBMERSIBLE_ACTIVE_LEVEL MOSFET_ACTIVE_LEVEL /* 1 = Active-HIGH for MOSFET Gate trigger (GPIO 4) */
#define DOSING_ACTIVE_LEVEL         MOSFET_ACTIVE_LEVEL  /* 1 = Active-HIGH for MOSFET Gate trigger (GPIO 5 & 6) */
#define COOLING_FAN_ACTIVE_LEVEL    MOSFET_ACTIVE_LEVEL  /* 1 = Active-HIGH for MOSFET Gate trigger (GPIO 7) */
#define BUZZER_ACTIVE_LEVEL         MOSFET_ACTIVE_LEVEL  /* 1 = Active-HIGH for MOSFET Gate trigger (GPIO 18) */

/* ========================================================================== */
/* INPUT SENSORS & FLOATS                                                     */
/* Lower Float Switch (Safety Stop Point / Dry-Run Protection): GPIO 38      */
/* Pulled up internally to 3.3V.                                             */
/* When tank has water: float is up (switch open) -> pin reads 1 (OK/NORMAL)  */
/* When tank reaches min: float drops (switch closes to GND) -> pin reads 0 (DRY) */
/* NOTE: Upper float / tank-full sensor is NOT USED. Tank volume is controlled*/
/* by UI target volume input with capacity boundary validation.              */
/* NOTE: VERIFY FLOAT CONTACT ORIENTATION (NO vs NC) UPON INSTALLATION.       */
/* ========================================================================== */
#define PIN_IN_FLOW_RAW_ZJB1        15   /* Raw Water Flow Meter (ZJ-B1, 1-25 L/min, RAW WATER -> MIXING TANK) */
#define PIN_IN_FLOW_FERT_FS400A     16   /* Fertigation Delivery Flow Meter (FS400A G1", canonical F=4.8*Q; physical calibration required) */
/* Backward compatibility aliases (OBSOLETE: YF-B1 replaced by ZJ-B1) */
#define PIN_IN_FLOW_YFB1            PIN_IN_FLOW_RAW_ZJB1
#define PIN_IN_FLOW_FS400A          PIN_IN_FLOW_FERT_FS400A
#define PIN_IN_TEMP_DS18B20         17   /* 1-Wire Temperature Bus */
/* FIX(FIX-EQUIPMENT-DHT22): DHT22 re-enabled on GPIO 41 per SSOT
 * docs/HARDWARE_WIRING_MAP.md W-23 (GPIO 41 = DHT22 DATA pin). GPIO 41 is
 * owned EXCLUSIVELY by DHT22 — Button 4 / Network Change Mode is disabled
 * (see PIN_BTN_RESERVED = -1 below). Driver gracefully no-ops when pin < 0. */
#define PIN_IN_DHT22                41   /* DHT22 / AM2302 Ambient Temp & Humidity Sensor (Single-Wire Data Pin) */
#define PIN_IN_FLOAT_LOWER          38   /* Digital Lower Float Switch (Safety Interlock) */
#define PIN_IN_TAMPER_LOOP          47   /* Anti-Theft Pump Security Loop */

#define FLOAT_LEVEL_DRY             0    /* 0 = Dry / Min Tank Stop Point (Trip) */
#define FLOAT_LEVEL_OK              1    /* 1 = Water OK / Sufficient Level */
#define TAMPER_LOOP_OK              0    /* 0 = Intact (Closed to GND), 1 = Cut (Pulled High) */

/* ========================================================================== */
/* PHYSICAL OPERATOR BUTTONS                                                  */
/* Active level: Active-Low (Pulled High internally/externally)              */
/* ========================================================================== */
#define PIN_BTN_MODE                0    /* Onboard BOOT Button / External NO Push Button */
#define PIN_BTN_MANUAL_A            39
/* FIX(FIX-EQUIPMENT-DHT22): Button 4 / Network Change Mode DISABLED because
 * GPIO 41 is reclaimed by DHT22 per SSOT docs/HARDWARE_WIRING_MAP.md W-23.
 * Network Change Mode (2x press = force router connect, 3x press = toggle
 * SoftAP) is still accessible via the embedded /setup web UI served by the
 * ESP32 SoftAP — operator connects a phone/laptop to the AGROTECH-SETUP-XXXX
 * SSID and uses the browser-based setup page. Physical Button 4 is
 * intentionally unassigned; do not reassign to any other GPIO without
 * updating the SSOT wiring map first. */
#define PIN_BTN_RESERVED            -1   /* Button 4 DISABLED: GPIO 41 owned by DHT22 (W-23). Network Change Mode still available via embedded /setup web UI on SoftAP. */

#define BUTTON_LEVEL_PRESSED        0
#define BUTTON_LEVEL_RELEASED       1

/* ========================================================================== */
/* RESERVED STRAPPING & SYSTEM PINS (DO NOT REASSIGN)                         */
/* Reserved: GPIO 3, 19, 20, 26-37, 43-44, 45-46                              */
/* ========================================================================== */
#define IS_RESERVED_PIN(pin) ( \
    ((pin) == 3) || ((pin) == 19) || ((pin) == 20) || \
    ((pin) >= 26 && (pin) <= 37) || \
    ((pin) == 43) || ((pin) == 44) || \
    ((pin) == 45) || ((pin) == 46) \
)

/* GPIO22-25 are not bonded on the target ESP32-S3-WROOM-1-N16R8 module. */
#define IS_UNAVAILABLE_GPIO(pin) (IS_RESERVED_PIN(pin) || ((pin) >= 22 && (pin) <= 25))

#ifdef __cplusplus
}
#endif
