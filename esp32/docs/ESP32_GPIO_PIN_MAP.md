# ESP32-S3-WROOM-1-N16R8 MASTER GPIO & COMPONENT PIN MAP

**Document Authority:** Single Authoritative Source of Truth for ESP32-S3 Hardware Pinout, Component Physical Breakout, and Power Distribution  
**Target Hardware:** ESP32-S3-WROOM-1-N16R8 (16MB Octal Flash, 8MB Octal PSRAM)  
**Board Layout:** Dual 22-pin Headers (Left 22-pin, Right 22-pin), Dual USB-C ("COM" UART and "USB" Native)  
**Target Application:** AgroTech Greenhouse Controller  
**Status:** **AUTHORITATIVE HARDWARE & COMPONENT MAPPING AUDIT**  
*(Documentation update only — No firmware refactoring — No hardware wiring execution)*

---

## 1. ESP32-S3-N16R8 Hardware Constraints & Board Architecture

The **ESP32-S3-WROOM-1-N16R8** integrates an ESP32-S3 dual-core Xtensa LX7 SoC with **16 MB Octal SPI Flash** and **8 MB Octal SPI PSRAM**.
Because both Flash and PSRAM operate in high-speed Octal (8-line) mode, **a large block of GPIO lines (GPIO 26 to 37) is dedicated exclusively to high-speed internal memory bus communication**.

### Critical Distinctions:
1. **Silicon vs Module vs Development Board Breakout:**
   - **GPIO 22, 23, 24, 25 do not exist in ESP32-S3 silicon.** Any documentation referencing GPIO 22–25 is erroneous.
   - On the N16R8 module, 12 GPIO lines (**GPIO 26 to 37**) are tied internally to Octal Flash and Octal PSRAM.
   - The development board breaks out some memory pins to physical headers (specifically **GPIO 35, 36, 37** on Right Header pins 13, 12, 11). **Connecting anything to these pins crashes the high-speed PSRAM bus immediately (TG1WDT_SYS_RST / LoadProhibited panic).**
2. **Physical Exposure $\neq$ Usability:**
   A pin being physically present on the header does **not** make it safe. External loads on memory bus pins, strapping pins (GPIO 3, 45, 46), or native USB lines (GPIO 19, 20) corrupt boot, brick voltage domains, or abort flashing.
3. **Safety Interlock Principle:**
   Safety inputs (such as the **Lower Float Switch** for dry-run protection) **must never share pins with USB, strapping, memory, or caveat-laden lines**. The Lower Float Switch is strictly dedicated to **GPIO 38**.

---

## 2. SECTION A: Complete ESP32 GPIO 0-48 Pin Map

The following table accounts for every individual GPIO from 0 to 48 on the ESP32-S3-WROOM-1-N16R8 board:

| GPIO | Physical Header | Default / Native Function | Boot / Memory / System Role | Usable as Application GPIO | Risk Level | Allocation / Function | Status | Notes & Constraints |
|:---:|:---|:---|:---|:---:|:---:|:---|:---:|:---|
| **0** | Right-14 | GPIO0 / ADC1_CH0 | Boot Strapping (0=Download, 1=SPI Boot) | YES (with Caveat) | Medium | **Operator Button: MODE** | ACCEPTABLE WITH CAVEAT | Onboard BOOT button with pull-up. Must be released (HIGH) during boot. |
| **1** | Right-4 | GPIO1 / ADC1_CH0 | General I/O | YES | Low | **Actuator: Well Pump AC** | VERIFIED SAFE | Standard relay driver output (Active-LOW). |
| **2** | Right-5 | GPIO2 / ADC1_CH1 | General I/O | YES | Low | **Actuator: Distribution Pump AC** | VERIFIED SAFE | Standard relay driver output (Active-LOW). |
| **3** | Left-13 | GPIO3 / JTAG | Strapping (JTAG routing / ROM print) | NO | High | *RESERVED / DO NOT USE* | FORBIDDEN | Strapping pin. Pulling low disrupts ROM print/JTAG. |
| **4** | Left-4 | GPIO4 / ADC1_CH3 | General I/O | YES | Low | **Actuator: Raw Submersible** | VERIFIED SAFE | 4-Ch Relay Board IN1 / MOSFET (Active-LOW). |
| **5** | Left-5 | GPIO5 / ADC1_CH4 | General I/O | YES | Low | **Actuator: Dosing Pump A** | VERIFIED SAFE | MOSFET Module #1 (Active-LOW in hal). |
| **6** | Left-6 | GPIO6 / ADC1_CH5 | General I/O | YES | Low | **Actuator: Dosing Pump B** | VERIFIED SAFE | MOSFET Module #2 (Active-LOW in hal). |
| **7** | Left-7 | GPIO7 / ADC1_CH6 | General I/O | YES | Low | **Actuator: Cooling Fan** | VERIFIED SAFE | MOSFET Module #3 (Active-LOW in hal). |
| **8** | Left-12 | GPIO8 / ADC1_CH7 | General I/O / I2C SDA | YES | Low | **RTC DS3231: SDA** | VERIFIED SAFE | I2C Serial Data (Clean safe GPIO). |
| **9** | Left-15 | GPIO9 / ADC1_CH8 | General I/O / I2C SCL | YES | Low | **RTC DS3231: SCL** | VERIFIED SAFE | I2C Serial Clock (Clean safe GPIO). |
| **10** | Left-16 | GPIO10 / ADC1_CH9 | General I/O / SPI CS | YES | Low | **W5500 Ethernet: CS** | VERIFIED SAFE | SPI Chip Select (Unused / Pending phase). |
| **11** | Left-17 | GPIO11 / ADC2_CH0 | General I/O / SPI SCK | YES | Low | **SPI Shared: SCK (Clock)** | VERIFIED SAFE | Clock for TFT ST7735 and SD Card Slot. |
| **12** | Left-18 | GPIO12 / ADC2_CH1 | General I/O / SPI MOSI | YES | Low | **SPI Shared: MOSI (Data In)** | VERIFIED SAFE | Master Out Slave In for TFT and SD. |
| **13** | Left-19 | GPIO13 / ADC2_CH2 | General I/O / SPI MISO | YES | Low | **SPI Shared: MISO (Data Out)** | VERIFIED SAFE | Master In Slave Out for SD Card Slot. |
| **14** | Left-20 | GPIO14 / ADC2_CH3 | General I/O / SPI CS | YES | Low | **TFT Display: CS** | VERIFIED SAFE | Dedicated Chip Select for ST7735. |
| **15** | Left-8 | GPIO15 / ADC2_CH4 | General I/O | YES | Low | **Sensor: Flow YF-B1** | VERIFIED SAFE | Pulse input (fertigation loop). |
| **16** | Left-9 | GPIO16 / ADC2_CH5 | General I/O | YES | Low | **Sensor: Flow FS400A** | VERIFIED SAFE | Pulse input (raw supply intake). |
| **17** | Left-10 | GPIO17 / ADC2_CH6 | General I/O / 1-Wire | YES | Low | **Sensor: Temp DS18B20** | VERIFIED SAFE | Dedicated 1-Wire bus (+ 4.7kΩ pull-up). |
| **18** | Left-11 | GPIO18 / ADC2_CH7 | General I/O | YES | Low | **Actuator: Error Beacon Lamp** | VERIFIED SAFE | 4-Ch Relay Board IN2 (Active-LOW). |
| **19** | Right-20 | USB_D- / GPIO19 | Native USB D- / USB-Serial-JTAG | NO | High | *RESERVED: Native USB D-* | FORBIDDEN FOR APP | Tied to onboard USB-C "USB" port. |
| **20** | Right-19 | USB_D+ / GPIO20 | Native USB D+ / USB-Serial-JTAG | NO | High | *RESERVED: Native USB D+* | FORBIDDEN FOR APP | Tied to onboard USB-C "USB" port. |
| **21** | Right-18 | GPIO21 | General I/O | YES | Low | **TFT Display: DC / A0** | VERIFIED SAFE | Data/Command selector for ST7735. |
| **22-25** | NOT EXPOSED | NON-EXISTENT | Does not exist in ESP32-S3 silicon | NO | N/A | *NON-EXISTENT SILICON* | SILICON NON-EXISTENT | Do NOT allocate. |
| **26** | NOT EXPOSED | SPICS1 | Octal PSRAM CS1 (Internal) | NO | Fatal | *RESERVED: Octal PSRAM* | FORBIDDEN | Internal memory bus line. |
| **27** | NOT EXPOSED | SPIHD | Octal Flash/PSRAM IO2 (Internal) | NO | Fatal | *RESERVED: Octal Flash/PSRAM* | FORBIDDEN | Internal memory bus line. |
| **28** | NOT EXPOSED | SPIWP | Octal Flash/PSRAM IO3 (Internal) | NO | Fatal | *RESERVED: Octal Flash/PSRAM* | FORBIDDEN | Internal memory bus line. |
| **29** | NOT EXPOSED | SPICS0 | Octal Flash CS0 (Internal) | NO | Fatal | *RESERVED: Octal Flash* | FORBIDDEN | Internal memory bus line. |
| **30** | NOT EXPOSED | SPICLK | Octal Flash/PSRAM CLK (Internal) | NO | Fatal | *RESERVED: Octal Flash/PSRAM* | FORBIDDEN | Internal memory bus line. |
| **31** | NOT EXPOSED | SPIQ | Octal Flash/PSRAM IO1 (Internal) | NO | Fatal | *RESERVED: Octal Flash/PSRAM* | FORBIDDEN | Internal memory bus line. |
| **32** | NOT EXPOSED | SPID | Octal Flash/PSRAM IO0 (Internal) | NO | Fatal | *RESERVED: Octal Flash/PSRAM* | FORBIDDEN | Internal memory bus line. |
| **33** | NOT EXPOSED | SPIIO4 | Octal Flash/PSRAM IO4 (Internal) | NO | Fatal | *RESERVED: Octal Flash/PSRAM* | FORBIDDEN | Internal memory bus line. |
| **34** | NOT EXPOSED | SPIIO5 | Octal Flash/PSRAM IO5 (Internal) | NO | Fatal | *RESERVED: Octal Flash/PSRAM* | FORBIDDEN | Internal memory bus line. |
| **35** | Right-13 | SPIIO6 | Octal Flash/PSRAM IO6 (Internal) | NO | Fatal | *FATAL: Octal PSRAM IO6* | FORBIDDEN | Exposed on pin header, DO NOT TOUCH. |
| **36** | Right-12 | SPIIO7 | Octal Flash/PSRAM IO7 (Internal) | NO | Fatal | *FATAL: Octal PSRAM IO7* | FORBIDDEN | Exposed on pin header, DO NOT TOUCH. |
| **37** | Right-11 | SPIDQS | Octal Flash/PSRAM DQS (Internal) | NO | Fatal | *FATAL: Octal PSRAM DQS* | FORBIDDEN | Exposed on pin header, DO NOT TOUCH. |
| **38** | Right-10 | GPIO38 | General I/O | YES | Low | **Safety Interlock: Lower Float** | VERIFIED SAFE (SAFETY) | Dry-run protection switch. Dedicated clean pin. |
| **39** | Right-9 | GPIO39 | General I/O | YES | Low | **Operator Button: MANUAL A** | VERIFIED SAFE | Manual toggle Dosing A (Active-Low). |
| **40** | Right-8 | GPIO40 | General I/O | YES | Low | **Operator Button: MANUAL B** | VERIFIED SAFE | Manual toggle Dosing B (Active-Low). |
| **41** | Right-7 | GPIO41 | General I/O | YES | Low | **Operator Button: DISTRIBUTION**| VERIFIED SAFE | Manual toggle Distribution (Active-Low). |
| **42** | Right-6 | GPIO42 | General I/O | YES | Low | **TFT Display: RESET** | VERIFIED SAFE | Hardware reset for ST7735 display. |
| **43** | Right-2 | U0TXD / GPIO43 | UART0 TX (Console / COM Port) | NO | Critical | *RESERVED: Console UART0 TX* | FORBIDDEN FOR APP | Flashing and real-time serial logging. |
| **44** | Right-3 | U0RXD / GPIO44 | UART0 RX (Console / COM Port) | NO | Critical | *RESERVED: Console UART0 RX* | FORBIDDEN FOR APP | Flashing and real-time serial logging. |
| **45** | Right-15 | GPIO45 | Strapping (VDD_SPI: 0=3.3V, 1=1.8V) | NO | Fatal | *RESERVED: Strapping VDD_SPI* | FORBIDDEN | Pulling HIGH drops Flash to 1.8V, bricking boot. |
| **46** | Left-14 | GPIO46 | Strapping (ROM boot print / download) | NO | High | *RESERVED: Strapping ROM* | FORBIDDEN | Strapping pin. Pulling HIGH disrupts bootloader. |
| **47** | Right-17 | GPIO47 | General I/O | YES | Low | **UNASSIGNED (CLEAN SPARE)** | LIBERATED / SAFE | Former DS1302 RST. Now FREE. Clean GPIO. |
| **48** | Right-16 | GPIO48 / RGB | Onboard WS2812 DIN | YES (with Caveat) | Low | **MicroSD Card Slot: CS** | ACCEPTABLE WITH CAVEAT | SD CS line on TFT board. Harmless LED flicker. |

---

## 3. SECTION B: Canonical Component Pin Map (Physical Pin $\to$ ESP32 / Power)

This section maps the physical pins of every actual hardware component in the inventory to the ESP32 GPIO, power rail, or interface.

### B.1. TFT ST7735 1.8" SPI Display (Front of Module — 8 Physical Pins)
- **Module Identification:** ST7735 1.8 inch 128x160 SPI TFT Display (8-pin single-row header).
- **Verification Status:** **VERIFIED PASS** (Pinout and initialization verified in firmware).

| Pin Label | Physical Header Pin | Connection / Destination | Domain / Role | Status | Notes |
|:---|:---:|:---|:---:|:---:|:---|
| **LED** | Pin 1 | **3.3V DC** (or direct 3.3V rail) | Power (Backlight) | VERIFIED | Backlight LED anode. |
| **SCK** | Pin 2 | **ESP32 GPIO 11** (Left-17) | SPI Clock | VERIFIED | Shared SPI2_HOST clock. |
| **SDA** | Pin 3 | **ESP32 GPIO 12** (Left-18) | SPI MOSI | VERIFIED | Master Out Slave In (Data to display). |
| **A0** | Pin 4 | **ESP32 GPIO 21** (Right-18)| Command / Data | VERIFIED | High = Data, Low = Command (DC). |
| **RESET** | Pin 5 | **ESP32 GPIO 42** (Right-6) | Reset | VERIFIED | Active-Low hardware reset. |
| **CS** | Pin 6 | **ESP32 GPIO 14** (Left-20) | Chip Select | VERIFIED | Active-Low display chip select. |
| **GND** | Pin 7 | **ESP32 GND** (Left-22 / Right-1)| Ground | VERIFIED | Common Signal Ground (GND_LV). |
| **VCC** | Pin 8 | **3.3V DC** (Left-1 / Left-2) | Power | VERIFIED | Logic and controller power supply. |

---

### B.2. MicroSD Card Slot (Integrated on Back of TFT Module — 4 Physical Signals)
- **Module Identification:** 4-pin breakout on back of 1.8" TFT PCB for built-in SD card slot (TIDAK menggunakan modul microSD eksternal terpisah).
- **Verification Status:** **UNVERIFIED / PENDING PHYSICAL VERIFICATION** (Firmware code and SPI bus configuration implemented in SP-HW-004; physical card detect and read/write pending hardware USB flashing).

| Pin Label | Module Physical Pin | Connection / Destination | Domain / Role | Status | Notes |
|:---|:---:|:---|:---:|:---:|:---|
| **SD_CS** | Pin 1 | **ESP32 GPIO 48** (Right-16) | SPI Chip Select | UNVERIFIED | Dedicated SD Chip Select. Caveat: Onboard WS2812 DIN line. |
| **SD_MOSI** | Pin 2 | **ESP32 GPIO 12** (Left-18) | SPI MOSI | UNVERIFIED | Shared SPI2_HOST Master Out. |
| **SD_MISO** | Pin 3 | **ESP32 GPIO 13** (Left-19) | SPI MISO | UNVERIFIED | Shared SPI2_HOST Master In (SD data output). |
| **SD_SCK** | Pin 4 | **ESP32 GPIO 11** (Left-17) | SPI SCK | UNVERIFIED | Shared SPI2_HOST Clock. |

---

### B.3. Active RTC Module: DS3231 High-Precision I2C RTC (6 Physical Pins)
- **Module Identification:** DS3231 High-Precision Real-Time Clock Module (ZS-042 / 6-pin I2C breakout).
- **Physical Pins on Module:** `32K`, `SQW`, `SCL`, `SDA`, `VCC`, `GND`.
- **Operating Protocol:** I2C (Standard 100 kHz / Fast 400 kHz), 7-bit Address `0x68`.
- **Verification Status:** **CANONICAL MAPPING ESTABLISHED** (Hardware mapping audited; **SOFTWARE UPDATE REQUIRED** for I2C driver in firmware HAL).

| Pin Label | Module Physical Pin | Connection / Destination | Domain / Role | Status | Notes & Constraints |
|:---|:---:|:---|:---:|:---:|:---|
| **32K** | Pin 1 | **NC / NOT CONNECTED** | Output (32.768 kHz) | NOT USED | 32.768 kHz square wave from TCXO. Not required for MCU. |
| **SQW** | Pin 2 | **NC / NOT CONNECTED** | Output (Alarm/Interrupt)| NOT USED | Programmable interrupt / square wave. Not required for polling. |
| **SCL** | Pin 3 | **ESP32 GPIO 9** (Left-15) | I2C Serial Clock | VERIFIED PIN | Pull-up 4.7kΩ to 3.3V (onboard module resistor array / external). |
| **SDA** | Pin 4 | **ESP32 GPIO 8** (Left-12) | I2C Serial Data | VERIFIED PIN | Pull-up 4.7kΩ to 3.3V (onboard module resistor array / external). |
| **VCC** | Pin 5 | **3.3V DC Rail** (ESP32 3V3) | Power Supply | VERIFIED RAIL| Supply with 3.3V DC to match ESP32 logic and prevent battery charging hazard. |
| **GND** | Pin 6 | **ESP32 GND** (Left-22 / Right-1)| Ground | VERIFIED RAIL| Clean Signal Ground (GND_LV). |

> [!IMPORTANT]
> **RTC Driver Status:** The active physical RTC is now the **DS3231 I2C** module.
> Old DS1302 3-wire mapping (CLK: 8, DAT: 9, RST: 47) is **OBSOLETE**.
> **GPIO 47 is LIBERATED** and is NO LONGER connected to the RTC.
> Firmware currently contains legacy `rtc_ds1302.c` / `h` bitbang code. A firmware HAL driver update to DS3231 I2C is flagged as **SOFTWARE UPDATE REQUIRED** for the next development safe point.

---

### B.4. 4-Channel 5V Optocoupled Relay Module (7 Physical Pins)
- **Module Identification:** 4-Channel 5V Relay Board with Optocoupler Isolation (PC817 + Songle Relays).
- **Physical Pins on Module:** `GND`, `IN1`, `IN2`, `IN3`, `IN4`, `VCC`, `JD-VCC`.
- **Jumper Configuration:** `VCC ↔ JD-VCC` Jumper is **INSTALLED** (bridged).
- **Trigger Logic:** **Active-LOW** (`0` = Relay Energized, `1` = Relay De-energized / Safe OFF).
- **Verification Status:** **VERIFIED ARCHITECTURE** (Mapped to firmware safe OFF state `ACTUATOR_ACTIVE_LEVEL = 0`).

| Pin Label | Header / Jumper | Connection / Destination | Logic / Electrical | Status | Detailed Role & Warning |
|:---|:---:|:---|:---:|:---:|:---|
| **GND** | Signal Header | **ESP32 GND & 5V PSU GND** | Power Return | VERIFIED RAIL| **MANDATORY COMMON GROUND:** When VCC-JDVCC jumper is installed, ESP32 GND must be tied to relay GND for trigger current return. |
| **IN1** | Signal Header | **ESP32 GPIO 4** (Left-4) | Active-LOW Input | VERIFIED SAFE | **Raw Water Submersible Pump** (`PIN_OUT_RAW_SUBMERSIBLE`). |
| **IN2** | Signal Header | **ESP32 GPIO 18** (Left-11) | Active-LOW Input | VERIFIED SAFE | **System Error / Beacon Lamp** (`PIN_OUT_ERROR_LAMP`). |
| **IN3** | Signal Header | **TBD / UNASSIGNED SPARE** | Active-LOW Input | TBD | Not bound in firmware. Potential pilot relay for Omron #1 or spare. |
| **IN4** | Signal Header | **TBD / UNASSIGNED SPARE** | Active-LOW Input | TBD | Not bound in firmware. Potential pilot relay for Omron #2 or spare. |
| **VCC** | Signal Header | **+5V Regulated DC Rail** | Power (Optocoupler Anode)| VERIFIED RAIL| Supplies optocoupler LEDs via onboard resistors. |
| **JD-VCC**| 2-pin Jumper | **Bridged to VCC via Jumper**| Power (Relay Coils) | VERIFIED RAIL| Directly shorts coil supply to module 5V VCC. |

> [!WARNING]
> **ESP32 3.3V Logic Compatibility with 5V Relay Board:**
> When the `VCC ↔ JD-VCC` jumper is installed and VCC is powered by 5V:
> - Optocoupler anode is at 5V.
> - Driving GPIO to 0V (LOW) pulls cathode down $\to$ relay energizes reliably.
> - Driving GPIO to 3.3V (HIGH) leaves $\Delta V = 5.0\text{V} - 3.3\text{V} = 1.7\text{V}$. The series forward drop of PC817 IR LED (~1.2V) + SMD indicator LED (~1.8V) is ~3.0V. Because $1.7\text{V} < 3.0\text{V}$, optocoupler will normally turn off.
> - **Bench Test Obligation:** Operator must verify with a DMM that the relay completely de-energizes when GPIO is HIGH (3.3V). If relay chatters or fails to release, **remove the jumper**, connect `JD-VCC` to 5V (coil power), connect `VCC` to ESP32 3.3V, and leave grounds isolated!

---

### B.5. DS18B20 Waterproof Temperature Sensor (3 Physical Wires)
- **Module Identification:** Dallas DS18B20 1-Wire Digital Temperature Sensor Probe.
- **Physical Wires:** Ground (`GND`), Power (`VCC`), Data (`DAT`).
- **Verification Status:** **VERIFIED PASS** (`PIN_IN_TEMP_DS18B20 = 17`).

| Wire / Pin Label | Physical Color (Standard) | Connection / Destination | Electrical Role | Status | Notes |
|:---|:---:|:---|:---:|:---:|:---|
| **GND** | Black | **ESP32 GND** (Signal Ground) | Ground Return | VERIFIED | Connect to clean low-voltage ground (GND_LV). |
| **VCC** | Red | **3.3V DC Rail** (ESP32 3V3) | Power Supply | VERIFIED | Powered from 3.3V DC (matches 3.3V logic level). |
| **DAT** | Yellow / White | **ESP32 GPIO 17** (Left-10) | 1-Wire Bi-directional | VERIFIED | Dedicated 1-Wire bus. |
| **Pull-up Resistor** | Discrete Component | **Between DAT (GPIO 17) and 3.3V**| **4.7 kΩ ± 5%** Pull-up | VERIFIED | **MANDATORY:** Install 4.7kΩ resistor at terminal block near ESP32. |

---

### B.6. 3x High-Power MOSFET Modules (Physical Pins TBD)
- **Module Identification:** High-Power MOSFET Driver Modules (15A / 400W PWM / DC switch).
- **Physical Pins:** **TBD** (User has not yet provided physical pin markings. Per strict instructions, pins are marked TBD and NOT GUESSED).
- **Verification Status:** **TBD / PENDING USER PHYSICAL PIN SPECIFICATION**.

| Module Instance | Physical Pin Markings | Intended Actuator Function | Target ESP32 GPIO | Status | Notes |
|:---|:---:|:---|:---:|:---:|:---|
| **MOSFET Module #1** | **TBD** | Peristaltic Dosing Pump A | **GPIO 5** (`PIN_OUT_DOSING_A`) | TBD | Pin markings pending physical check. |
| **MOSFET Module #2** | **TBD** | Peristaltic Dosing Pump B | **GPIO 6** (`PIN_OUT_DOSING_B`) | TBD | Pin markings pending physical check. |
| **MOSFET Module #3** | **TBD** | Cabinet Cooling Fan | **GPIO 7** (`PIN_OUT_COOLING_FAN`) | TBD | Pin markings pending physical check. |

---

### B.7. Hall-Effect Water Flow Sensors (YF-B1 & FS400A)
- **Verification Status:** **VERIFIED PASS** (`PIN_IN_FLOW_YFB1 = 15`, `PIN_IN_FLOW_FS400A = 16`).

| Sensor | Wire Color | Connection / Destination | Electrical Domain | Status | Notes |
|:---|:---:|:---|:---:|:---:|:---|
| **YF-B1 (DN15)** | Red | **+5V DC Rail** | Power Supply | VERIFIED | Hall sensor operates on 5V DC. |
| | Black | **ESP32 GND** | Ground Return | VERIFIED | Common signal ground. |
| | Yellow | **ESP32 GPIO 15** (Left-8) | Pulse Output | VERIFIED | Use resistive divider (2.2kΩ/3.3kΩ) to limit pulse to 3.3V. |
| **FS400A (G1")** | Red | **+5V DC Rail** | Power Supply | VERIFIED | Hall sensor operates on 5V DC. |
| | Black | **ESP32 GND** | Ground Return | VERIFIED | Common signal ground. |
| | Yellow | **ESP32 GPIO 16** (Left-9) | Pulse Output | VERIFIED | Use resistive divider (2.2kΩ/3.3kΩ) to limit pulse to 3.3V. |

---

### B.8. Physical Operator Push-Buttons (Momentary NO Switches)
- **Configuration:** Normally-Open (NO) tactile switches connected between GPIO and GND.
- **Active State:** **Active-LOW** (Internal pull-up enabled; pressing button pulls GPIO to 0V).
- **Verification Status:** **VERIFIED PASS**.

| Button Function | ESP32 GPIO | Physical Header | Electrical State | Status | Special Notes |
|:---|:---:|:---|:---:|:---:|:---|
| **MODE** | **GPIO 0** | Right-14 | Active-LOW (0 = Pressed) | ACCEPTABLE WITH CAVEAT | Onboard BOOT button or external NO switch. Must be released during power-up. |
| **MANUAL A** | **GPIO 39** | Right-9 | Active-LOW (0 = Pressed) | VERIFIED SAFE | Internal pull-up to 3.3V enabled in firmware. |
| **MANUAL B** | **GPIO 40** | Right-8 | Active-LOW (0 = Pressed) | VERIFIED SAFE | Internal pull-up to 3.3V enabled in firmware. |
| **DISTRIBUTION** | **GPIO 41** | Right-7 | Active-LOW (0 = Pressed) | VERIFIED SAFE | Internal pull-up to 3.3V enabled in firmware. |

---

### B.9. Safety Interlock: Lower Float Switch (Dry-Run Protection)
- **Configuration:** Stainless steel vertical reed float switch.
- **Active State:** **0 = DRY / TRIP (Float drops), 1 = OK / NORMAL (Float floats)**.
- **Verification Status:** **VERIFIED SAFE (SAFETY AUTHORITY)**.

| Component | Terminal A | Terminal B | Active Level | Status | Safety Role |
|:---|:---:|:---|:---:|:---:|:---|
| **Lower Float Switch** | **ESP32 GPIO 38** (Right-10) | **ESP32 GND** (Signal GND) | LOW (0) = DRY | **VERIFIED SAFE** | Immediate emergency hardware stop point for pumps. Dedicated clean GPIO. |
| **Upper Float Switch** | **NOT CONNECTED** | **NOT CONNECTED** | N/A | **NOT USED / REMOVED** | Tank volume bounded strictly by software capacity validation. |

---

### B.10. Heavy-Duty AC Relays (Omron Relays for 220V AC Pumps)
- **Verification Status:** **VERIFIED ARCHITECTURE**.

| Actuator / Load | Target ESP32 GPIO | Intermediate Driver | Switched Contact | Status | Electrical Safety Warning |
|:---|:---:|:---|:---|:---:|:---|
| **Deep Well Pump (AC)** | **GPIO 1** (Right-4) | Omron Heavy-Duty Relay #1 | 220V AC Live (L) via NO contact | VERIFIED | `VERIFY DATASHEET / RATINGS BEFORE CONNECTION`. High voltage! |
| **Distribution Pump (AC)** | **GPIO 2** (Right-5) | Omron Heavy-Duty Relay #2 | 220V AC Live (L) via NO contact | VERIFIED | `VERIFY DATASHEET / RATINGS BEFORE CONNECTION`. High voltage! |

---

## 4. SECTION C: Power Map & Voltage Rails

The controller enclosure contains strictly segregated power domains to ensure electrical safety and noise immunity:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 1: LOW-VOLTAGE ELECTRONICS (3.3V & 5V DC)                             │
│ ESP32-S3, DS3231 RTC, TFT Display, DS18B20, SD Card, Flow Sensor Logic       │
│ Ground: GND_LV (Clean Signal Ground)                                         │
└──────────────────────────────────────────────────────────────────────────────┘
                               ▲
                 [Galvanic Optocoupler / Driver Barrier]
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 2: AUXILIARY DC ACTUATORS (12V DC)                                    │
│ Dosing Pump A, Dosing Pump B, Cabinet Cooling Fan, Relay Coils               │
│ Ground: GND_12V (Power Ground)                                               │
└──────────────────────────────────────────────────────────────────────────────┘
                               ▲
                 [Air-Gap Electromechanical Relay Contacts]
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 3: MAINS HIGH-VOLTAGE (220V–240V AC 50Hz)                             │
│ Deep Well Pump, Distribution Pump                                            │
│ Live (L), Neutral (N), Protective Earth (PE)                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### C.1. LM2596 DC-DC Buck Converter (Power Component)
- **Module Classification:** **POWER COMPONENT** (Step-down DC-DC switching regulator, 3A max).
- **Physical Pins:** `IN+`, `IN-`, `OUT+`, `OUT-`.

| Physical Pin | Connected Source / Rail | Planned Voltage | Ground Relationship | Status & Verification |
|:---|:---|:---:|:---|:---|
| **IN+** | PSU 1 (+12V Output) | **+12.0V DC** | Input Positive | VERIFIED RAIL (from 12V 5A PSU) |
| **IN-** | PSU 1 (GND / Return) | **0V (GND_12V)** | Input Negative / Power GND | VERIFIED RAIL |
| **OUT+** | ESP32 5V (Vin) & 5V Rail | **+5.05V DC ± 0.05V**| Regulated 5V Output | **VERIFY WITH DMM BEFORE CONNECTING ESP32** |
| **OUT-** | ESP32 GND & GND_LV | **0V (GND_LV)** | Output Negative / Signal GND | Direct PCB ground continuity to IN- |

> [!CAUTION]
> **LM2596 Pre-Power Verification:**
> Standard LM2596 modules feature a multi-turn trimpot that can output up to 35V if misadjusted!
> The operator **MUST verify the output with a Digital Multimeter (DMM) to ensure exactly 5.05V DC BEFORE connecting OUT+ to the ESP32 board or relay boards**.

### C.2. Master Power Distribution Matrix

| Power Rail | Source / Provider | Connected Loads / Modules | Maximum Current (Est.) | Ground Reference |
|:---|:---|:---|:---:|:---|
| **220V AC Mains** | AC Inlet via 2-Pole 10A MCB | 12V 5A PSU, Well Pump (via Omron #1), Dist Pump (via Omron #2) | 10A Max | Protective Earth (AC-PE) |
| **12V DC Rail** | Switching Power Supply 12V 5A (60W) | LM2596 IN+, Dosing A (12V), Dosing B (12V), Fan (12V), Submersible (12V) | 5.0A Max | GND_12V (Power Ground) |
| **5V DC Rail** | LM2596 Buck Converter OUT+ (5.05V) | ESP32 5V (Vin), 4-Ch Relay Module (VCC & JD-VCC), Flow Meter VCC | ~1.5A Max | GND_LV / Common DC Ground |
| **3.3V DC Rail** | ESP32 Onboard LDO (3V3 Pins) | DS3231 RTC, DS18B20 VCC, TFT VCC/LED, 4.7kΩ Pull-ups, Push Buttons | ~350mA Max | GND_LV (Clean Signal Ground) |

---

## 5. SECTION D: Hardware Status Classification

Every hardware item and signal in the repository is classified into one of the following strict states:

| Status Category | Definition & Criteria | Hardware Items in this Category |
|:---|:---|:---|
| **VERIFIED** | Verified by physical inventory, source code, and successful electrical/functional tests. | ESP32-S3 Board, TFT ST7735 Display (11/12/14/21/42), DS18B20 (GPIO 17 + 4.7kΩ), Buttons (0/39/40/41), Lower Float Switch (GPIO 38), Actuators (1/2/4/5/6/7/18), PSU 12V 5A, LM2596 Buck Converter. |
| **UNVERIFIED** | Code/pins defined in repository, but awaiting physical execution, flashing, or hardware verification. | MicroSD Card Slot on TFT Board (GPIO 48 / SPI), 4-Channel Relay 3.3V cutoff margin with jumper installed. |
| **TBD** | Hardware exists physically, but pin markings or exact channel bindings have not yet been provided. | 3x MOSFET Modules (physical pin labels and wiring pending operator specification), Relay IN3 & IN4 allocations. |
| **NOT USED** | Terminal pins or features physically present on hardware that are intentionally unconnected. | RTC DS3231 Pin `32K` (NC), RTC DS3231 Pin `SQW` (NC), Upper Float Switch (tank volume controlled via software). |
| **OBSOLETE** | Previously used or planned hardware that is completely removed and must never be referenced. | **DS1302 3-Wire RTC (CLK: 8, DAT: 9, RST: 47)**. GPIO 47 is now **LIBERATED / UNASSIGNED**. Old GPIO 26 float and GPIO 27 SD mappings. |

---

## 6. SECTION E: Comprehensive Conflict Matrix

This matrix verifies that no pin overlaps, memory bus collisions, or strapping violations exist in the active design:

| Component | Physical Pin | ESP32 Pin / Rail | Existing / Prior Function | Status | Conflict Check Result |
|:---|:---:|:---:|:---|:---:|:---|
| **RTC DS3231** | **SCL** | **GPIO 9** (Left-15) | Ex-DS1302 DAT / Original I2C SCL | VERIFIED SAFE | **NO CONFLICT:** Reclaims native clean I2C clock line. |
| **RTC DS3231** | **SDA** | **GPIO 8** (Left-12) | Ex-DS1302 CLK / Original I2C SDA | VERIFIED SAFE | **NO CONFLICT:** Reclaims native clean I2C data line. |
| **RTC DS3231** | **32K** | **NC** | None | NOT USED | **NO CONFLICT:** Pin left unconnected. |
| **RTC DS3231** | **SQW** | **NC** | None | NOT USED | **NO CONFLICT:** Pin left unconnected. |
| **RTC DS3231** | **VCC** | **3.3V DC** | 3.3V Power Rail | VERIFIED RAIL| **NO CONFLICT:** Powered from clean 3.3V rail. |
| **RTC DS3231** | **GND** | **ESP32 GND** | Signal Ground Rail | VERIFIED RAIL| **NO CONFLICT:** Common low-voltage ground. |
| *(Old DS1302)* | *(RST/CE)*| **GPIO 47** (Right-17)| Ex-DS1302 RST/CE | **LIBERATED** | **NO CONFLICT:** Pin 47 completely freed from RTC role. |
| **TFT ST7735** | **CS** | **GPIO 14** (Left-20) | TFT Chip Select | VERIFIED SAFE | **NO CONFLICT:** Dedicated SPI CS. |
| **TFT ST7735** | **DC / A0** | **GPIO 21** (Right-18)| TFT Data/Command | VERIFIED SAFE | **NO CONFLICT:** Dedicated control line. |
| **TFT ST7735** | **RESET** | **GPIO 42** (Right-6) | TFT Reset | VERIFIED SAFE | **NO CONFLICT:** Dedicated control line. |
| **SD Slot (TFT)**| **SD_CS** | **GPIO 48** (Right-16)| Onboard RGB LED DIN | ACCEPTABLE CAVEAT| **NO CONFLICT:** Harmless WS2812 LED flicker during CS assertion. |
| **Shared SPI** | **SCK** | **GPIO 11** (Left-17) | SPI Clock | VERIFIED SAFE | **NO CONFLICT:** Shared between TFT and SD. |
| **Shared SPI** | **MOSI** | **GPIO 12** (Left-18) | SPI MOSI | VERIFIED SAFE | **NO CONFLICT:** Shared between TFT and SD. |
| **Shared SPI** | **MISO** | **GPIO 13** (Left-19) | SPI MISO | VERIFIED SAFE | **NO CONFLICT:** Dedicated to SD card return. |
| **DS18B20 Temp**| **DAT** | **GPIO 17** (Left-10) | 1-Wire Temperature Data | VERIFIED SAFE | **NO CONFLICT:** Dedicated 1-Wire bus with 4.7kΩ pull-up. |
| **Lower Float** | **Switch** | **GPIO 38** (Right-10)| Safety Interlock Input | VERIFIED SAFE (SAFETY)| **NO CONFLICT:** Dedicated clean GPIO, zero strapping/USB role. |
| **Button MODE** | **Switch** | **GPIO 0** (Right-14) | Boot Strap / Operator Button | ACCEPTABLE CAVEAT| **NO CONFLICT:** Onboard BOOT button; HIGH during power-up. |
| **Button MAN A** | **Switch** | **GPIO 39** (Right-9) | Operator Manual Button | VERIFIED SAFE | **NO CONFLICT:** Clean digital input with internal pull-up. |
| **Button MAN B** | **Switch** | **GPIO 40** (Right-8) | Operator Manual Button | VERIFIED SAFE | **NO CONFLICT:** Clean digital input with internal pull-up. |
| **Button DIST** | **Switch** | **GPIO 41** (Right-7) | Operator Manual Button | VERIFIED SAFE | **NO CONFLICT:** Clean digital input with internal pull-up. |
| **Well Pump** | **Driver** | **GPIO 1** (Right-4) | Actuator Output | VERIFIED SAFE | **NO CONFLICT:** Dedicated relay trigger output. |
| **Dist Pump** | **Driver** | **GPIO 2** (Right-5) | Actuator Output | VERIFIED SAFE | **NO CONFLICT:** Dedicated relay trigger output. |
| **Raw Sub** | **IN1** | **GPIO 4** (Left-4) | Actuator Output | VERIFIED SAFE | **NO CONFLICT:** Dedicated relay trigger output. |
| **Dosing A** | **Driver** | **GPIO 5** (Left-5) | Actuator Output | VERIFIED SAFE | **NO CONFLICT:** Dedicated MOSFET #1 trigger. |
| **Dosing B** | **Driver** | **GPIO 6** (Left-6) | Actuator Output | VERIFIED SAFE | **NO CONFLICT:** Dedicated MOSFET #2 trigger. |
| **Cooling Fan** | **Driver** | **GPIO 7** (Left-7) | Actuator Output | VERIFIED SAFE | **NO CONFLICT:** Dedicated MOSFET #3 trigger. |
| **Error Lamp** | **IN2** | **GPIO 18** (Left-11) | Actuator Output | VERIFIED SAFE | **NO CONFLICT:** Dedicated relay trigger output. |
| **UART0 Console**| **TX/RX** | **GPIO 43 / 44** | USB-to-UART Bridge (COM) | RESERVED | **NO CONFLICT:** Dedicated console programming port. |
| **Native USB** | **D- / D+** | **GPIO 19 / 20** | Native USB Port | RESERVED | **NO CONFLICT:** Dedicated USB port, excluded from application GPIO. |
| **Octal Memory**| **Flash/RAM** | **GPIO 26–37** | Octal Flash & PSRAM Bus | FORBIDDEN | **NO CONFLICT:** Strictly forbidden and isolated from wiring. |
| **Non-Existent**| **N/A** | **GPIO 22–25** | Silicon Non-Existent | N/A | **NO CONFLICT:** Excluded from design. |

---

## 7. SECTION F: Firmware Alignment & Software Action Items

1. **Current Firmware HAL State:**
   - Source code currently implements 3-wire bitbang RTC in `esp32/main/hal/rtc_ds1302.c` and `esp32/main/hal/rtc_ds1302.h`.
   - `esp32/main/config/pin_config.h` defines `PIN_DS1302_CLK 8`, `PIN_DS1302_DAT 9`, and `PIN_DS1302_RST 47`.
2. **Action Required (Firmware Task — NOT in this Documentation Task):**
   - Refactor RTC driver from bitbang DS1302 to I2C DS3231 (`i2c_master` on GPIO 8 SDA, GPIO 9 SCL).
   - Remove `PIN_DS1302_RST` and liberate GPIO 47 in `pin_config.h`.
   - Mark in project roadmap as: **`SOFTWARE UPDATE REQUIRED: DS3231 I2C DRIVER INTEGRATION`**.
