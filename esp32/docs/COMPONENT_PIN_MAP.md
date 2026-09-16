# COMPONENT PIN MAP

**Document Role:** Component-Centric Physical Pin Breakdown  
**Target Hardware:** Physical Sensor, Display, Actuator, and Power Breakout Modules  
**Parent Contract:** [HARDWARE_WIRING_MAP.md](file:///d:/template/docs/HARDWARE_WIRING_MAP.md) (Canonical Hardware Wiring Contract)  
**Status:** **AUTHORITATIVE COMPONENT PIN REGISTRY**

---

## 1. Overview

This document specifies the exact mapping from the physical pins of each discrete module to the corresponding ESP32-S3 GPIO pin or power rail. Every pin is accompanied by its interface protocol, signal direction, active logic level, and verification status.

---

## 2. Component Pin Breakdown Tables

### 2.1. Real-Time Clock: DS3231 High-Precision I2C RTC Module
- **Physical Module:** 6-Pin I2C Breakout Board (ZS-042 / DS3231).
- **Status:** **ACTIVE CANONICAL RTC** (Replaces obsolete DS1302 3-wire module).
- **Firmware Status:** **SOFTWARE UPDATE REQUIRED** (Firmware driver update to I2C DS3231 pending).

| Component | Physical Pin | Pin Function | ESP32 GPIO / Power Rail | Interface | Direction | Active Level | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **DS3231 RTC** | **32K** | 32.768 kHz TCXO Output | *NC / NOT CONNECTED* | Clock Out | Output | Push-Pull | **NOT USED** |
| **DS3231 RTC** | **SQW** | Square Wave / Alarm Int | *NC / NOT CONNECTED* | Interrupt | Output | Active-LOW (OD) | **NOT USED** |
| **DS3231 RTC** | **SCL** | I2C Serial Clock | **ESP32 GPIO 9** (Left-15) | I2C Bus | Input (from MCU) | Clock (Max 400kHz) | **VERIFIED** |
| **DS3231 RTC** | **SDA** | I2C Serial Data | **ESP32 GPIO 8** (Left-12) | I2C Bus | Bi-directional | Open-Drain | **VERIFIED** |
| **DS3231 RTC** | **VCC** | Power Supply (3.3V) | **3.3V DC Rail** (ESP32 3V3) | DC Power | Power Input | 3.3V DC Nominal | **VERIFIED** |
| **DS3231 RTC** | **GND** | Ground | **ESP32 GND** (Left-22/Right-1)| Ground Return | Power Ground | 0V Reference | **VERIFIED** |

*Note: Powering the module from 3.3V DC matches ESP32 logic levels and eliminates battery overcharging hazard on boards with trickle-charge circuits.*

---

### 2.2. Display: 1.8" ST7735 SPI TFT Display (Front Header)
- **Physical Module:** 8-Pin Single-Row Header on front of 1.8" TFT board.
- **Resolution / Controller:** 128 × 160 pixels, Sitronix ST7735 controller.

| Component | Physical Pin | Pin Function | ESP32 GPIO / Power Rail | Interface | Direction | Active Level | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **ST7735 TFT** | **LED** | Backlight Anode | **3.3V DC Rail** | DC Power | Power Input | 3.3V Constant ON | **VERIFIED** |
| **ST7735 TFT** | **SCK** | SPI Bus Clock | **ESP32 GPIO 11** (Left-17) | SPI Clock | Input (from MCU) | SPI Mode 0 (Rising) | **VERIFIED** |
| **ST7735 TFT** | **SDA** | SPI Master Out (MOSI) | **ESP32 GPIO 12** (Left-18) | SPI MOSI | Input (from MCU) | Serial Data | **VERIFIED** |
| **ST7735 TFT** | **A0** | Data / Command Select | **ESP32 GPIO 21** (Right-18) | Control Line | Input (from MCU) | High=Data, Low=Cmd | **VERIFIED** |
| **ST7735 TFT** | **RESET** | Hardware Reset | **ESP32 GPIO 42** (Right-6) | Control Line | Input (from MCU) | Active-LOW (0=Reset) | **VERIFIED** |
| **ST7735 TFT** | **CS** | Display Chip Select | **ESP32 GPIO 14** (Left-20) | SPI CS | Input (from MCU) | Active-LOW (0=Select)| **VERIFIED** |
| **ST7735 TFT** | **GND** | Ground | **ESP32 GND** | Ground Return | Power Ground | 0V Reference | **VERIFIED** |
| **ST7735 TFT** | **VCC** | Power Supply (3.3V) | **3.3V DC Rail** (ESP32 3V3) | DC Power | Power Input | 3.3V DC Nominal | **VERIFIED** |

---

### 2.3. Storage: MicroSD Card Slot (Integrated on Back of TFT Module)
- **Physical Module:** 4-Pin Breakout Header on reverse side of 1.8" TFT PCB.
- **Bus:** Shared SPI2_HOST with ST7735 display.

| Component | Physical Pin | Pin Function | ESP32 GPIO / Power Rail | Interface | Direction | Active Level | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **MicroSD Slot** | **SD_CS** | SD Chip Select | **ESP32 GPIO 48** (Right-16) | SPI CS | Input (from MCU) | Active-LOW (0=Select)| **UNVERIFIED** |
| **MicroSD Slot** | **SD_MOSI** | SPI Master Out | **ESP32 GPIO 12** (Left-18) | SPI MOSI | Input (from MCU) | Serial Data In | **UNVERIFIED** |
| **MicroSD Slot** | **SD_MISO** | SPI Master In | **ESP32 GPIO 13** (Left-19) | SPI MISO | Output (to MCU) | Serial Data Out | **UNVERIFIED** |
| **MicroSD Slot** | **SD_SCK** | SPI Clock | **ESP32 GPIO 11** (Left-17) | SPI Clock | Input (from MCU) | SPI Mode 0 | **UNVERIFIED** |

*Note: GPIO 48 is also connected to the onboard WS2812 DIN line, resulting in harmless LED flicker when SD transactions occur. Hardware execution is UNVERIFIED pending physical USB boot verification.*

---

### 2.4. Temperature Sensor: Dallas DS18B20 Probe
- **Physical Module:** 3-Wire Waterproof Stainless Steel Probe.

| Component | Physical Pin / Wire | Pin Function | ESP32 GPIO / Power Rail | Interface | Direction | Active Level | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **DS18B20** | **GND** (Black) | Sensor Ground | **ESP32 GND** | Ground Return | Power Ground | 0V Reference | **VERIFIED** |
| **DS18B20** | **VCC** (Red) | Power Supply (3.3V) | **3.3V DC Rail** (ESP32 3V3) | DC Power | Power Input | 3.3V DC Nominal | **VERIFIED** |
| **DS18B20** | **DAT** (Yellow/White)| 1-Wire Serial Data | **ESP32 GPIO 17** (Left-10) | 1-Wire Bus | Bi-directional | Open-Drain (+4.7kΩ) | **VERIFIED** |

*Note: Requires a 4.7 kΩ pull-up resistor connected between DAT (GPIO 17) and the 3.3V DC rail.*

---

### 2.5. Intermediate Actuator Driver: 4-Channel 5V Optocoupled Relay Board
- **Physical Module:** 4-Channel Relay Board with Songle Relays & PC817 Optocouplers.
- **Hardware Configuration:** Jumper `VCC ↔ JD-VCC` is **INSTALLED**.
- **Power Requirement:** 5V DC (Relay coils require 5V to actuate).

| Component | Physical Pin | Pin Function | ESP32 GPIO / Power Rail | Interface | Direction | Active Level | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **4-Ch Relay** | **GND** | Module Ground | **ESP32 GND & 5V PSU GND** | Common Ground | Ground Return | 0V Reference | **VERIFIED** |
| **4-Ch Relay** | **IN1** | Channel 1 Opto Trigger | **ESP32 GPIO 4** (Left-4) | Digital Logic | Input (from MCU) | Active-LOW (0V=ON) | **VERIFIED** |
| **4-Ch Relay** | **IN2** | Channel 2 Opto Trigger | **ESP32 GPIO 18** (Left-11) | Digital Logic | Input (from MCU) | Active-LOW (0V=ON) | **VERIFIED** |
| **4-Ch Relay** | **IN3** | Channel 3 Opto Trigger | **ESP32 GPIO 10** (Left-16) | Digital Logic | Input (from MCU) | Active-LOW (0V=ON) | **BOOKED (STANDBY)** |
| **4-Ch Relay** | **IN4** | Channel 4 Opto Trigger | *TBD / Unassigned Spare* | Digital Logic | Input (from MCU) | Active-LOW (0V=ON) | **TBD** |
| **4-Ch Relay** | **VCC** | Optocoupler Anode Supply| **+5V DC Rail** | DC Power | Power Input | 5.0V DC Nominal | **VERIFIED** |
| **4-Ch Relay** | **JD-VCC** | Relay Coil Power | *Bridged to VCC via Jumper* | DC Power | Power Input | 5.0V DC (via Jumper)| **VERIFIED** |

*Caution: Jumper closed configuration requires common ground with ESP32. Cutoff margin at 3.3V logic high must be verified with multimeter.*

---

### 2.6. DC Switching Drivers: 3x High-Power MOSFET Modules
- **Physical Module:** 3 Units of High-Power MOSFET Driver Modules (15A / 400W).
- **Physical Pin Status:** **VERIFIED** (Physical trigger markings provided by operator: `TRIG-PWM` / `TRIG/PWM` and `GND`).

| Component | Physical Pin | Pin Function | ESP32 GPIO / Power Rail | Interface | Direction | Active Level | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **MOSFET #1** | **TRIG-PWM** | Gate Trigger / PWM Input | **ESP32 GPIO 5** (Left-5) | Digital Logic | Input (from MCU) | Active-LOW (in hal) | **VERIFIED** |
| **MOSFET #1** | **GND** | Logic Ground Return | **ESP32 GND** (Common Ground) | Ground Return | Return to MCU | 0V Ground | **VERIFIED** |
| **MOSFET #1** | **VIN+ / VIN-**| DC Power Input Terminals | 12V DC Rail from PSU 1 | DC Power Rail | Power Supply | 12V DC & GND_12V | **VERIFIED** |
| **MOSFET #1** | **OUT+ / OUT-**| DC Load Terminals | Dosing Pump A (Nutrient) | DC Load Switch | Power Output | Switched 12V DC | **VERIFIED** |
| **MOSFET #2** | **TRIG-PWM** | Gate Trigger / PWM Input | **ESP32 GPIO 6** (Left-6) | Digital Logic | Input (from MCU) | Active-LOW (in hal) | **VERIFIED** |
| **MOSFET #2** | **GND** | Logic Ground Return | **ESP32 GND** (Common Ground) | Ground Return | Return to MCU | 0V Ground | **VERIFIED** |
| **MOSFET #2** | **VIN+ / VIN-**| DC Power Input Terminals | 12V DC Rail from PSU 1 | DC Power Rail | Power Supply | 12V DC & GND_12V | **VERIFIED** |
| **MOSFET #2** | **OUT+ / OUT-**| DC Load Terminals | Dosing Pump B (pH/Buffer) | DC Load Switch | Power Output | Switched 12V DC | **VERIFIED** |
| **MOSFET #3** | **TRIG-PWM** | Gate Trigger / PWM Input | **ESP32 GPIO 7** (Left-7) | Digital Logic | Input (from MCU) | Active-LOW (in hal) | **VERIFIED** |
| **MOSFET #3** | **GND** | Logic Ground Return | **ESP32 GND** (Common Ground) | Ground Return | Return to MCU | 0V Ground | **VERIFIED** |
| **MOSFET #3** | **VIN+ / VIN-**| DC Power Input Terminals | 12V DC Rail from PSU 1 | DC Power Rail | Power Supply | 12V DC & GND_12V | **VERIFIED** |
| **MOSFET #3** | **OUT+ / OUT-**| DC Load Terminals | Cabinet Exhaust Cooling Fan | DC Load Switch | Power Output | Switched 12V DC | **VERIFIED** |

---

### 2.7. Step-Down Voltage Regulator: LM2596 DC-DC Buck Converter
- **Physical Module:** LM2596 Step-down Switching Regulator Board with Trimpot.
- **Role:** **POWER COMPONENT** (Converts 12V DC primary power to 5.05V logic rail).

| Component | Physical Pin | Pin Function | Connected Source / Destination | Interface | Direction | Voltage Rating | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **LM2596** | **IN+** | DC Positive Input | **12V DC PSU 1 Output** | DC Power Rail | Power Input | +12.0V DC | **VERIFIED** |
| **LM2596** | **IN-** | DC Negative Input | **12V DC PSU 1 Return** | Ground Rail | Power Return | 0V (GND_12V) | **VERIFIED** |
| **LM2596** | **OUT+** | DC Positive Output | **ESP32 5V (Vin) & 5V Rail** | DC Power Rail | Power Output | **5.05V DC (VERIFY DMM)**| **VERIFY DMM** |
| **LM2596** | **OUT-** | DC Negative Output | **ESP32 GND & GND_LV** | Ground Rail | Ground Return | 0V (GND_LV) | **VERIFIED** |

---

### 2.8. Safety Interlock & Operator Push-Buttons

| Component | Physical Pin | Pin Function / Operational Role | ESP32 GPIO / Power Rail | Interface | Direction | Active Level | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **Lower Float** | Terminal A | Reed Switch Contact A (Safety Interlock) | **ESP32 GPIO 38** (Right-10) | Dry Contact In | Input | Low=DRY, High=OK | **VERIFIED SAFE** |
| **Lower Float** | Terminal B | Reed Switch Contact B | **ESP32 GND** | Ground Return | Ground | 0V Reference | **VERIFIED SAFE** |
| **Button 1 (MODE)** | Terminal 1 | **TFT Display Screen Switch** (Cycles Screens)| **ESP32 GPIO 0** (Right-14) | Tactile Switch | Input | Active-LOW (0=Push) | **ACCEPTABLE CAVEAT** |
| **Button 1 (MODE)** | Terminal 2 | Ground Return | **ESP32 GND** | Ground Return | Ground | 0V Reference | **VERIFIED** |
| **Button 2 (MAN A)**| Terminal 1 | **Manual Well Pump Toggle** (5-Min Auto-Off)  | **ESP32 GPIO 39** (Right-9) | Tactile Switch | Input | Active-LOW (0=Push) | **VERIFIED SAFE** |
| **Button 2 (MAN A)**| Terminal 2 | Ground Return | **ESP32 GND** | Ground Return | Ground | 0V Reference | **VERIFIED** |
| **Button 3 (MAN B)**| Terminal 1 | **Reserved Button 3** (TBD / Unassigned)     | **ESP32 GPIO 40** (Right-8) | Tactile Switch | Input | Active-LOW (0=Push) | **VERIFIED SAFE** |
| **Button 3 (MAN B)**| Terminal 2 | Ground Return | **ESP32 GND** | Ground Return | Ground | 0V Reference | **VERIFIED** |
| **Button 4 (DIST)** | Terminal 1 | **Reserved Button 4** (TBD / Unassigned)     | **ESP32 GPIO 41** (Right-7) | Tactile Switch | Input | Active-LOW (0=Push) | **VERIFIED SAFE** |
| **Button 4 (DIST)** | Terminal 2 | Ground Return | **ESP32 GND** | Ground Return | Ground | 0V Reference | **VERIFIED** |

*Button Functional Rules:*
- **Button 1 (GPIO 0):** Advances ST7735 display to the next diagnostic view on each press (Diagnostic $\to$ Sensors $\to$ Actuators $\to$ Network/Time). Disconnected from old Auto/Manual mode toggle.
- **Button 2 (GPIO 39):** Manual toggle for Deep Well Pump. State 1 (OFF $\to$ ON) starts a non-blocking 5-minute software timer. State 2 (ON $\to$ OFF) shuts down immediately and cancels the timer. If 5 minutes elapses, automatically turns OFF. Strictly blocked if Lower Float is DRY (`PIN_IN_FLOAT_LOWER` = 0) or Emergency Stop is latched.
- **Buttons 3 & 4 (GPIO 40, 41):** Maintained with internal pull-up and 40ms software debounce. Reserved for future assignment.

---

### 2.9. Pulse Flow Sensors: YF-B1 (Fertigation) & FS400A (Supply)

| Component | Physical Wire | Wire Function | ESP32 GPIO / Power Rail | Interface | Direction | Electrical Domain | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **YF-B1 (DN15)**| **Red** | Power Input (5V) | **+5V DC Rail** | DC Power | Power Input | 5V DC Nominal | **VERIFIED** |
| **YF-B1 (DN15)**| **Black** | Sensor Ground | **ESP32 GND** | Ground Return | Ground | 0V Reference | **VERIFIED** |
| **YF-B1 (DN15)**| **Yellow** | Hall Pulse Output | **ESP32 GPIO 15** (Left-8) | Pulse Counter | Output (to MCU) | 3.3V Divided Pulse | **VERIFIED** |
| **FS400A (G1")** | **Red** | Power Input (5V) | **+5V DC Rail** | DC Power | Power Input | 5V DC Nominal | **VERIFIED** |
| **FS400A (G1")** | **Black** | Sensor Ground | **ESP32 GND** | Ground Return | Ground | 0V Reference | **VERIFIED** |
| **FS400A (G1")** | **Yellow** | Hall Pulse Output | **ESP32 GPIO 16** (Left-9) | Pulse Counter | Output (to MCU) | 3.3V Divided Pulse | **VERIFIED** |

*Note: Pulse signals are scaled via 2.2kΩ / 3.3kΩ resistive voltage dividers to ensure maximum voltage into GPIO 15 and 16 does not exceed 3.3V.*

### 2.10. Anti-Theft Pump Security Loop (Tamper Wire)

| Component | Physical Wire | Wire Function | ESP32 GPIO / Power Rail | Interface | Direction | Electrical Domain | Status |
|:---|:---:|:---|:---|:---:|:---:|:---:|:---:|
| **Tamper Loop** | **Signal Lead** | Closed-Loop Sense | **ESP32 GPIO 47** (Right-17) | Digital Input | Input (to MCU) | 3.3V Logic (Internal Pull-Up) | **VERIFIED SAFE (SECURITY)** |
| **Tamper Loop** | **Return Wire** | Ground Return | **ESP32 GND** (Signal GND_LV) | DC Ground | Return Path | 0V Reference | **VERIFIED SAFE (SECURITY)** |

*Notes:*
- *Physical loop passes through the AC pump chassis bracket or inside the power cable sheath.*
- *Closed loop to GND holds GPIO 47 at 0V (Normal).*
- *If severed or disconnected, internal pull-up brings GPIO 47 to 3.3V (Trip = 1), triggering Rule 4 Emergency Stop.*
- *Return wire MUST connect to DC Signal Ground (`GND_LV`), NEVER to AC Protective Earth (PE) or AC Neutral.*

---

### 2.11. Obsolete Hardware (Do Not Connect)
- **DS1302 RTC Module:** 3-wire bitbang (`CLK: 8`, `DAT: 9`, `RST: 47`) is **OBSOLETE**. Hardware is replaced by DS3231 I2C RTC (`SDA: 8`, `SCL: 9`). GPIO 47 has been reassigned to the Anti-Theft Tamper Loop.
- **Upper Float Switch:** Tank full sensor is **NOT USED / REMOVED** (tank capacity boundary enforced in software).
