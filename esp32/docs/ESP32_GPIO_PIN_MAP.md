# ESP32-S3-WROOM-1-N16R8 MASTER GPIO PIN MAP & AUDIT

**Document Authority:** Single Source of Truth for ESP32-S3-WROOM-1-N16R8 Hardware Pinout  
**Target Hardware:** ESP32-S3-WROOM-1-N16R8 (16MB Flash, 8MB Octal PSRAM)  
**Board Layout:** Dual 22-pin Headers (Left 22-pin, Right 22-pin), Dual USB-C ("COM" and "USB")  
**Target Application:** AgroTech Greenhouse Controller  
**Status:** **AUDIT ONLY — NO FIRMWARE CHANGE — NO BUILD — NO FLASH — NO WIRING**

---

## 1. ESP32-S3-N16R8 GPIO Overview

The **ESP32-S3-WROOM-1-N16R8** integrates an ESP32-S3 dual-core Xtensa LX7 SoC with **16 MB Octal SPI Flash** and **8 MB Octal SPI PSRAM**.
Because both Flash and PSRAM run in high-speed Octal (8-line) mode, **a significant number of internal GPIO lines (GPIO 26 to 37) are dedicated exclusively to high-speed memory bus communication**.

### Critical Distinctions:
1. **ESP32-S3 Silicon vs WROOM-1 Module vs Development Board:**
   - Silicon supports 45 physical GPIOs (GPIO 0-21, 26-48). GPIO 22, 23, 24, 25 do not exist in silicon.
   - On the N16R8 module, 12 GPIO lines (GPIO 26-37) are connected to internal Flash and Octal PSRAM.
   - The development board breaks out some pins to physical headers (e.g. GPIO 35, 36, 37) even though they are **strictly forbidden** to be touched because they are connected to Octal PSRAM.
2. **Physical Exposure $\neq$ Usability:**
   A pin being physically present on the header does **not** make it safe. Connecting external loads to memory bus pins or strapping pins causes instant boot failure or silent memory corruption.
3. **Safety Interlock Principle:**
   Safety inputs (such as the **Lower Float Switch** for dry-run protection) **must never share pins with USB, strapping, memory, or caveat-laden lines**.

---

## 2. Complete GPIO 0-48 Map

The following table accounts for every individual GPIO from 0 to 48 on the ESP32-S3-WROOM-1-N16R8.

| GPIO | Physical Header | Default / Native Function | Memory / USB / Boot Role | Usable as Application GPIO | Risk | Status | Notes |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---|
| **0** | Right-14 | GPIO0 / ADC1_CH0 | Boot Strapping (0=Download, 1=SPI Boot) | YES (with Caveat) | Medium | ACCEPTABLE WITH CAVEAT | Onboard BOOT button with external pull-up. Must be HIGH at power-up. Suitable for operator button (Mode Button). |
| **1** | Right-4 | GPIO1 / ADC1_CH0 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. |
| **2** | Right-5 | GPIO2 / ADC1_CH1 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. |
| **3** | Left-13 | GPIO3 / JTAG | Strapping (JTAG routing / ROM print) | NO | High | DO NOT USE | Strapping pin. Interferes with boot/debug if loaded. |
| **4** | Left-4 | GPIO4 / ADC1_CH3 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. |
| **5** | Left-5 | GPIO5 / ADC1_CH4 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. |
| **6** | Left-6 | GPIO6 / ADC1_CH5 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. |
| **7** | Left-7 | GPIO7 / ADC1_CH6 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. |
| **8** | Left-12 | GPIO8 / ADC1_CH7 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. Former I2C SDA. |
| **9** | Left-15 | GPIO9 / ADC1_CH8 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. Former I2C SCL. |
| **10** | Left-16 | GPIO10 / ADC1_CH9 | General I/O | YES | Low | VERIFIED SAFE | Clean digital/analog pin. Output/Input suitable. |
| **11** | Left-17 | GPIO11 / ADC2_CH0 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. Bus SPI SCK. |
| **12** | Left-18 | GPIO12 / ADC2_CH1 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. Bus SPI MOSI. |
| **13** | Left-19 | GPIO13 / ADC2_CH2 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. Bus SPI MISO. |
| **14** | Left-20 | GPIO14 / ADC2_CH3 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. Output/Input suitable. |
| **15** | Left-8 | GPIO15 / ADC2_CH4 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. Input pulse suitable. |
| **16** | Left-9 | GPIO16 / ADC2_CH5 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. Input pulse suitable. |
| **17** | Left-10 | GPIO17 / ADC2_CH6 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. 1-Wire suitable. |
| **18** | Left-11 | GPIO18 / ADC2_CH7 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. Output suitable. |
| **19** | Right-20 | USB_D- / GPIO19 | Native USB D- / USB-Serial-JTAG | NO (for Safety) | High | DO NOT USE FOR SAFETY | Tied to onboard USB-C "USB" port. Driving or pulling low interferes with USB-JTAG. |
| **20** | Right-19 | USB_D+ / GPIO20 | Native USB D+ / USB-Serial-JTAG | NO (for Safety) | High | DO NOT USE FOR SAFETY | Tied to onboard USB-C "USB" port. Driving or pulling low interferes with USB-JTAG. |
| **21** | Right-18 | GPIO21 | General I/O | YES | Low | VERIFIED SAFE | Clean digital pin. Output/Input suitable. |
| **22-25** | NOT EXPOSED | NON-EXISTENT | Does not exist in ESP32-S3 silicon | NO | N/A | SILICON NON-EXISTENT | These GPIOs do not exist on the ESP32-S3 chip. |
| **26** | NOT EXPOSED | SPICS1 | Octal PSRAM CS1 (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **27** | NOT EXPOSED | SPIHD | Octal Flash/PSRAM IO2 (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **28** | NOT EXPOSED | SPIWP | Octal Flash/PSRAM IO3 (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **29** | NOT EXPOSED | SPICS0 | Octal Flash CS0 (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **30** | NOT EXPOSED | SPICLK | Octal Flash/PSRAM CLK (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **31** | NOT EXPOSED | SPIQ | Octal Flash/PSRAM IO1 (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **32** | NOT EXPOSED | SPID | Octal Flash/PSRAM IO0 (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **33** | NOT EXPOSED | SPIIO4 | Octal Flash/PSRAM IO4 (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **34** | NOT EXPOSED | SPIIO5 | Octal Flash/PSRAM IO5 (Internal) | NO | Fatal | FLASH/PSRAM RESERVED | Internal memory bus line. Forbidden. |
| **35** | Right-13 | SPIIO6 | Octal Flash/PSRAM IO6 (Internal) | NO | Fatal | DO NOT USE (PSRAM) | Physically exposed on header, but connected to Octal PSRAM bus! Touching crashes RAM. |
| **36** | Right-12 | SPIIO7 | Octal Flash/PSRAM IO7 (Internal) | NO | Fatal | DO NOT USE (PSRAM) | Physically exposed on header, but connected to Octal PSRAM bus! Touching crashes RAM. |
| **37** | Right-11 | SPIDQS | Octal Flash/PSRAM DQS (Internal) | NO | Fatal | DO NOT USE (PSRAM) | Physically exposed on header, but connected to Octal PSRAM bus! Touching crashes RAM. |
| **38** | Right-10 | GPIO38 | General I/O | YES | Low | VERIFIED SAFE | Clean digital GPIO. Dedicated, ideal for Safety Interlock. |
| **39** | Right-9 | GPIO39 | General I/O | YES | Low | VERIFIED SAFE | Clean digital GPIO. Input suitable (Internal Pullup supported). |
| **40** | Right-8 | GPIO40 | General I/O | YES | Low | VERIFIED SAFE | Clean digital GPIO. Input suitable (Internal Pullup supported). |
| **41** | Right-7 | GPIO41 | General I/O | YES | Low | VERIFIED SAFE | Clean digital GPIO. Input suitable (Internal Pullup supported). |
| **42** | Right-6 | GPIO42 | General I/O | YES | Low | VERIFIED SAFE | Clean digital GPIO. Output suitable. |
| **43** | Right-2 | U0TXD / GPIO43 | UART0 TX (Console / COM3 Port) | NO | Critical | DO NOT USE (UART) | Dedicated to USB-to-UART bridge for programming and monitoring. |
| **44** | Right-3 | U0RXD / GPIO44 | UART0 RX (Console / COM3 Port) | NO | Critical | DO NOT USE (UART) | Dedicated to USB-to-UART bridge for programming and monitoring. |
| **45** | Right-15 | GPIO45 | Strapping (VDD_SPI voltage: 0=3.3V, 1=1.8V) | NO | Fatal | DO NOT USE (STRAPPING) | Pulling HIGH at boot sets Flash to 1.8V, bricking N16R8 boot. Forbidden. |
| **46** | Left-14 | GPIO46 | Strapping (ROM log print / download) | NO | High | DO NOT USE (STRAPPING) | Strapping pin. Pulling HIGH during boot disrupts bootloader. Forbidden. |
| **47** | Right-17 | GPIO47 | General I/O | YES | Low | VERIFIED SAFE | Clean digital GPIO. Output/Input suitable. |
| **48** | Right-16 | GPIO48 | General I/O / Onboard RGB LED | YES (with Caveat) | Low | ACCEPTABLE WITH CAVEAT | Connected to onboard WS2812 DIN. Usable as CS output; causes harmless LED flicker. |

---

## 3. Physically Exposed GPIO

The board provides two 22-pin headers (total 44 pins). The physical breakout is mapped below:

### Left Header (22 Pins)
- **Pin 1:** 3V3 (Power Output)
- **Pin 2:** 3V3 (Power Output)
- **Pin 3:** RST (EN / Chip Reset)
- **Pin 4:** **GPIO4** (Clean Safe)
- **Pin 5:** **GPIO5** (Clean Safe)
- **Pin 6:** **GPIO6** (Clean Safe)
- **Pin 7:** **GPIO7** (Clean Safe)
- **Pin 8:** **GPIO15** (Clean Safe)
- **Pin 9:** **GPIO16** (Clean Safe)
- **Pin 10:** **GPIO17** (Clean Safe)
- **Pin 11:** **GPIO18** (Clean Safe)
- **Pin 12:** **GPIO8** (Clean Safe)
- **Pin 13:** GPIO3 (*Strapping — DO NOT USE*)
- **Pin 14:** GPIO46 (*Strapping — DO NOT USE*)
- **Pin 15:** **GPIO9** (Clean Safe)
- **Pin 16:** **GPIO10** (Clean Safe)
- **Pin 17:** **GPIO11** (Clean Safe)
- **Pin 18:** **GPIO12** (Clean Safe)
- **Pin 19:** **GPIO13** (Clean Safe)
- **Pin 20:** **GPIO14** (Clean Safe)
- **Pin 21:** 5V (USB VBUS Power Input/Output)
- **Pin 22:** GND (Ground)

### Right Header (22 Pins)
- **Pin 1:** GND (Ground)
- **Pin 2:** TXD0 / GPIO43 (*UART0 Console — DO NOT USE*)
- **Pin 3:** RXD0 / GPIO44 (*UART0 Console — DO NOT USE*)
- **Pin 4:** **GPIO1** (Clean Safe)
- **Pin 5:** **GPIO2** (Clean Safe)
- **Pin 6:** **GPIO42** (Clean Safe)
- **Pin 7:** **GPIO41** (Clean Safe)
- **Pin 8:** **GPIO40** (Clean Safe)
- **Pin 9:** **GPIO39** (Clean Safe)
- **Pin 10:** **GPIO38** (Clean Safe)
- **Pin 11:** GPIO37 (*Octal PSRAM DQS — FATAL DO NOT USE*)
- **Pin 12:** GPIO36 (*Octal PSRAM IO7 — FATAL DO NOT USE*)
- **Pin 13:** GPIO35 (*Octal PSRAM IO6 — FATAL DO NOT USE*)
- **Pin 14:** **GPIO0** (*Strapping / Onboard BOOT Button — Caveat: HIGH at boot*)
- **Pin 15:** GPIO45 (*Strapping VDD_SPI — FATAL DO NOT USE*)
- **Pin 16:** **GPIO48** (*Onboard WS2812 RGB LED — Caveat: Output CS harmless flicker*)
- **Pin 17:** **GPIO47** (Clean Safe)
- **Pin 18:** **GPIO21** (Clean Safe)
- **Pin 19:** GPIO20 (*Native USB D+ — DO NOT USE FOR APPLICATION*)
- **Pin 20:** GPIO19 (*Native USB D- — DO NOT USE FOR APPLICATION*)
- **Pin 21:** GND (Ground)
- **Pin 22:** GND (Ground)

---

## 4. Flash / PSRAM Reserved GPIO

The ESP32-S3-WROOM-1-N16R8 incorporates:
- 16 MB Octal Flash: Uses GPIO 28, 29, 30, 31, 32, 33, 34, 35, 36.
- 8 MB Octal PSRAM: Uses GPIO 26, 27, 33, 34, 35, 36, 37.

**Rules for N16R8:**
1. **GPIO 26 through 34** are routed internally inside the RF shield. They are NOT exposed on this board.
2. **GPIO 35, 36, 37** are routed to the module shield edge and broken out to Right-13, Right-12, Right-11.
   **Crucial Warning:** Although physically accessible with jumper wires, **they are high-frequency data/strobe lines of the PSRAM**. Attaching any capacitive load or pull-up/down will immediately cause memory corruption and system panic (`TG1WDT_SYS_RST` or `LoadProhibited`).
   **Status:** **PERMANENTLY RESERVED — STRICTLY FORBIDDEN.**

---

## 5. Boot / Strapping GPIO

The SoC samples strapping pins on the rising edge of `CHIP_PU` (power-up or reset):
1. **GPIO 0:**
   - Samples boot mode: `1` = Normal SPI Flash Boot, `0` = ROM Serial Download Boot.
   - Has an onboard pull-up resistor and tactile switch.
   - **Application Usability:** Safe for normally-open operator button that is released during power-up.
2. **GPIO 3:**
   - Controls JTAG signal source and early ROM print.
   - Pulling low alters debug logging and JTAG behavior. **Forbidden.**
3. **GPIO 45:**
   - Controls VDD_SPI voltage: `0` = 3.3V, `1` = 1.8V.
   - Internal pull-down. If externally pulled HIGH, VDD_SPI drops to 1.8V, instantly crashing the 3.3V Flash/PSRAM! **Forbidden.**
4. **GPIO 46:**
   - Controls ROM boot message printing and download mode behavior.
   - Internal pull-down. **Forbidden.**

---

## 6. USB / USB-JTAG GPIO

- **GPIO 19:** `USB_D-` (USB OTG / USB-Serial-JTAG)
- **GPIO 20:** `USB_D+` (USB OTG / USB-Serial-JTAG)

The board features two USB-C connectors:
1. **COM:** Routed to an onboard USB-to-UART bridge (CP2102/CH340) connected to GPIO43/44.
2. **USB:** Routed directly to GPIO19 and GPIO20.

**Rejection Rationale for Safety Inputs:**
While ESP-IDF allows switching GPIO19/20 to standard GPIO via software, any connection to the "USB" port or unexpected USB-JTAG hardware driver assertion will override GPIO levels. Under no circumstances may a safety-critical interlock (like the Lower Float dry-run switch) be wired to GPIO19 or GPIO20.

---

## 7. UART / Download GPIO

- **GPIO 43:** `U0TXD` (UART0 Transmit)
- **GPIO 44:** `U0RXD` (UART0 Receive)

Directly connected to the onboard USB-to-UART converter providing the `COM3` connection. Used for firmware flashing, real-time logging, and interactive serial debugging.
**Status:** **PERMANENTLY RESERVED.**

---

## 8. Safe Application GPIO Candidates

The following **24 GPIOs** are 100% verified clean, exposed, general-purpose, and free from memory, strapping, or USB interference:

| Header | Safe GPIO List | Count |
|:---|:---|:---:|
| **Left Header** | GPIO 4, 5, 6, 7, 15, 16, 17, 18, 8, 9, 10, 11, 12, 13, 14 | **15** |
| **Right Header** | GPIO 1, 2, 42, 41, 40, 39, 38, 47, 21 | **9** |
| **Total Clean Safe** | | **24** |

---

## 9. GPIO With Caveats

1. **GPIO 48 (Right-16):**
   - *Hardware Connection:* Wired to the DIN pin of the onboard WS2812 RGB LED.
   - *Suitability:* Usable as an active-low Chip Select (e.g. MicroSD CS). When the SPI driver pulls CS low, the LED data line receives transitions which do not match the WS2812 800kHz protocol, resulting in slight LED flickering or no illumination. 100% electrically safe for CS output.
2. **GPIO 0 (Right-14):**
   - *Hardware Connection:* Wired to the onboard BOOT tactile button with pull-up.
   - *Suitability:* Usable as an active-low operator input (e.g. Mode Button). Must be released (HIGH) during boot. Unsuitable for safety interlocks, but ideal for human operator buttons.

---

## 10. GPIO To Avoid

The following GPIOs must **NEVER** be used for application peripherals:
- **Flash/PSRAM Bus:** GPIO 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37.
- **Strapping:** GPIO 3, 45, 46.
- **Console UART:** GPIO 43, 44.
- **USB PHY:** GPIO 19, 20 (Avoided for application stability).
- **Non-Existent Silicon:** GPIO 22, 23, 24, 25.

---

## 11. Safety-Critical GPIO Candidates

The **Lower Float Switch** protects pumps from dry-run cavitation and tank drainage damage.
Per the safety specification, the pin assigned to Lower Float must satisfy:
1. **Dedicated Pure GPIO:** No shared bus, no USB, no strapping role.
2. **Boot Invariance:** State of the float switch (0 or 1) must have ZERO impact on boot mode or voltage domains.
3. **Internal Pull-Up Reliability:** Must have a robust internal pull-up (~45 kΩ) capable of holding 3.3V when float switch contacts are open.
4. **Physical Location:** Must be easily accessible on a clean terminal header.

**Optimal Candidate: GPIO 38**
- Right Header Pin 10.
- Completely clean general-purpose digital input.
- Zero boot or memory constraints.
- Verified safe for continuous dry-run monitoring.

---

## 12. Current Project Allocation Audit

Audit of existing assignments in `pin_config.h`:

| Function | Baseline GPIO | Status in Current Codebase | Audit Finding | Action Required |
|:---|:---:|:---|:---|:---|
| **Well Pump AC** | 1 | `PIN_OUT_WELL_PUMP` | Verified Safe | Keep GPIO 1 |
| **Distribution Pump AC** | 2 | `PIN_OUT_DIST_PUMP` | Verified Safe | Keep GPIO 2 |
| **Raw Submersible** | 4 | `PIN_OUT_RAW_SUBMERSIBLE` | Verified Safe | Keep GPIO 4 |
| **Dosing Pump A** | 5 | `PIN_OUT_DOSING_A` | Verified Safe | Keep GPIO 5 |
| **Dosing Pump B** | 6 | `PIN_OUT_DOSING_B` | Verified Safe | Keep GPIO 6 |
| **Cooling Fan** | 7 | `PIN_OUT_COOLING_FAN` | Verified Safe | Keep GPIO 7 |
| **Error Lamp** | 18 | `PIN_OUT_ERROR_LAMP` | Verified Safe | Keep GPIO 18 |
| **W5500 CS** | 10 | `PIN_W5500_CS` | Verified Safe | Keep GPIO 10 |
| **SPI SCK** | 11 | `PIN_SPI_SCK` | Verified Safe | Keep GPIO 11 |
| **SPI MOSI** | 12 | `PIN_SPI_MOSI` | Verified Safe | Keep GPIO 12 |
| **SPI MISO** | 13 | `PIN_SPI_MISO` | Verified Safe | Keep GPIO 13 |
| **TFT CS** | 14 | `PIN_TFT_CS` | Verified Safe | Keep GPIO 14 |
| **TFT DC** | 21 | `PIN_TFT_DC` | Verified Safe | Keep GPIO 21 |
| **TFT RST** | 42 | `PIN_TFT_RST` | Verified Safe | Keep GPIO 42 |
| **Flow YF-B1** | 15 | `PIN_IN_FLOW_YFB1` | Verified Safe | Keep GPIO 15 |
| **Flow FS400A** | 16 | `PIN_IN_FLOW_FS400A` | Verified Safe | Keep GPIO 16 |
| **Temp DS18B20** | 17 | `PIN_IN_TEMP_DS18B20` | Verified Safe | Keep GPIO 17 |
| **Btn: Manual A** | 39 | `PIN_BTN_MANUAL_A` | Verified Safe | Keep GPIO 39 |
| **Btn: Manual B** | 40 | `PIN_BTN_MANUAL_B` | Verified Safe | Keep GPIO 40 |
| **Btn: Distribution** | 41 | `PIN_BTN_DISTRIBUTION` | Verified Safe | Keep GPIO 41 |
| **Btn: Mode** | 38 | `PIN_BTN_MODE` | Clean GPIO, but needed for Safety | Reallocate to GPIO 0 |
| **RTC DS3231 SDA** | 8 | `PIN_I2C_SDA` | Obsolete (Replaced by DS1302) | Reallocate to DS1302 CLK |
| **RTC DS3231 SCL** | 9 | `PIN_I2C_SCL` | Obsolete (Replaced by DS1302) | Reallocate to DS1302 DAT |
| **Lower Float Switch** | 26 / 19 | **FATAL CONFLICT** (26=PSRAM, 19=USB) | Unsafe / Invalid | **Reallocate to GPIO 38** |
| **MicroSD CS** | 27 | **FATAL CONFLICT** (27=PSRAM IO2) | Unsafe / Invalid | **Reallocate to GPIO 48** |
| **Upper Float Switch** | N/A | REMOVED from design | Confirmed removed | DO NOT REINTRODUCE |

---

## 13. Proposed Remapping

By applying the resource reallocation rule:
1. **Button Mode** moves from GPIO 38 to **GPIO 0** (utilizing the onboard BOOT button or external NO push-button).
2. **Lower Float Switch** is assigned to the liberated **GPIO 38** (clean, zero-caveat, 100% safety compliant).
3. **DS1302 CLK** is assigned to **GPIO 8** (former SDA).
4. **DS1302 DAT** is assigned to **GPIO 9** (former SCL).
5. **DS1302 RST** is assigned to **GPIO 47** (clean general GPIO).
6. **MicroSD CS** is assigned to **GPIO 48** (general output, onboard RGB LED caveat).

### Master System Pin Assignment Table

| Hardware Function | Direction / Type | Proposed GPIO | Physical Header | Electrical Status | Rationale | Risk |
|:---|:---:|:---:|:---:|:---:|:---|:---:|
| **Well Pump AC** | Output (Active-Low) | **1** | Right-4 | VERIFIED SAFE | Standard relay driver output. | Low |
| **Distribution Pump AC** | Output (Active-Low) | **2** | Right-5 | VERIFIED SAFE | Standard relay driver output. | Low |
| **Raw Submersible** | Output (Active-Low) | **4** | Left-4 | VERIFIED SAFE | Standard relay driver output. | Low |
| **Dosing Pump A** | Output (Active-Low) | **5** | Left-5 | VERIFIED SAFE | Standard relay driver output. | Low |
| **Dosing Pump B** | Output (Active-Low) | **6** | Left-6 | VERIFIED SAFE | Standard relay driver output. | Low |
| **Cooling Fan** | Output (Active-Low) | **7** | Left-7 | VERIFIED SAFE | Standard relay driver output. | Low |
| **Error Lamp** | Output (Active-Low) | **18** | Left-11 | VERIFIED SAFE | Panel indicator output. | Low |
| **W5500 CS** | Output (SPI CS) | **10** | Left-16 | VERIFIED SAFE | Dedicated SPI Chip Select. | Low |
| **SPI SCK** | Output (SPI Clock) | **11** | Left-17 | VERIFIED SAFE | Shared SPI Bus Clock. | Low |
| **SPI MOSI** | Output (SPI Data Out)| **12** | Left-18 | VERIFIED SAFE | Shared SPI Bus Master Out. | Low |
| **SPI MISO** | Input (SPI Data In)  | **13** | Left-19 | VERIFIED SAFE | Shared SPI Bus Master In. | Low |
| **TFT CS** | Output (SPI CS) | **14** | Left-20 | VERIFIED SAFE | ST7735 Display Chip Select. | Low |
| **TFT DC** | Output (Command/Data)| **21** | Right-18 | VERIFIED SAFE | ST7735 Command/Data switch. | Low |
| **TFT RST** | Output (Reset) | **42** | Right-6 | VERIFIED SAFE | ST7735 Hardware Reset. | Low |
| **MicroSD CS** | Output (SPI CS) | **48** | Right-16 | ACCEPTABLE WITH CAVEAT | MicroSD Chip Select (RGB LED line). | Low |
| **Flow YF-B1** | Input (Pulses) | **15** | Left-8 | VERIFIED SAFE | Interrupt-driven pulse counter. | Low |
| **Flow FS400A** | Input (Pulses) | **16** | Left-9 | VERIFIED SAFE | Interrupt-driven pulse counter. | Low |
| **Temp DS18B20** | Bi-directional (1-Wire)| **17** | Left-10 | VERIFIED SAFE | Dedicated 1-Wire bus. | Low |
| **Lower Float Switch** | Input (Pull-Up) | **38** | Right-10 | **VERIFIED SAFE (SAFETY)** | **Dry-Run Interlock — Clean Dedicated GPIO.** | **Zero** |
| **Button: Mode** | Input (Active-Low) | **0** | Right-14 | ACCEPTABLE WITH CAVEAT | Operator button; onboard BOOT switch. | Low |
| **Button: Manual A** | Input (Active-Low) | **39** | Right-9 | VERIFIED SAFE | Operator manual toggle button. | Low |
| **Button: Manual B** | Input (Active-Low) | **40** | Right-8 | VERIFIED SAFE | Operator manual toggle button. | Low |
| **Button: Distribution**| Input (Active-Low) | **41** | Right-7 | VERIFIED SAFE | Operator distribution button. | Low |
| **DS1302 CLK** | Output (Clock) | **8** | Left-12 | VERIFIED SAFE | 3-Wire bit-banged Serial Clock. | Low |
| **DS1302 DAT** | Bi-directional (Data) | **9** | Left-15 | VERIFIED SAFE | 3-Wire bit-banged Serial Data. | Low |
| **DS1302 RST** | Output (Chip Enable) | **47** | Right-17 | VERIFIED SAFE | 3-Wire bit-banged Reset/CE (Active High).| Low |

---

## 15. Shared SPI Bus & Component-to-GPIO Mapping

Dokumentasi ini secara eksplisit membedakan antara pin fisik ESP32 dan pemetaan per komponen:

### A. Shared SPI Bus (SPI2_HOST)
- **SPI SCK:** ESP32 GPIO 11
- **SPI MOSI:** ESP32 GPIO 12
- **SPI MISO:** ESP32 GPIO 13

### B. TFT ST7735 1.8" Display (8 Physical Pins)
Hanya memiliki 8 pin fisik (TIDAK memiliki pin MISO):
1. **LED:** Backlight (Direct supply / 3.3V)
2. **SCK:** ESP32 **GPIO 11**
3. **SDA (MOSI):** ESP32 **GPIO 12**
4. **A0 (DC):** ESP32 **GPIO 21**
5. **RESET:** ESP32 **GPIO 42**
6. **CS:** ESP32 **GPIO 14**
7. **GND:** Ground
8. **VCC:** Power (3.3V / 5V)

### C. SD CARD SLOT BAWAAN TFT (Di Belakang PCB TFT)
Slot SD card terintegrasi pada modul TFT (TIDAK menggunakan external microSD reader):
- **SD_CS:** ESP32 **GPIO 48** (Dedicated Chip Select)
- **SD_MOSI:** ESP32 **GPIO 12** (Shared SPI MOSI)
- **SD_MISO:** ESP32 **GPIO 13** (Shared SPI MISO)
- **SD_SCK:** ESP32 **GPIO 11** (Shared SPI Clock)

### D. RTC DS1302 (3-Wire Interface — BUKAN I2C)
- **CLK:** ESP32 **GPIO 8**
- **DAT:** ESP32 **GPIO 9** (Bidirectional)
- **RST/CE:** ESP32 **GPIO 47** (Active-High Chip Enable)
- **VCC:** 3.3V
- **GND:** Ground

### E. Operator Buttons & Sensors
- **Mode Button:** ESP32 **GPIO 0** (Active-Low / BOOT)
- **Manual A Button:** ESP32 **GPIO 39** (Active-Low)
- **Manual B Button:** ESP32 **GPIO 40** (Active-Low)
- **Distribution Button:** ESP32 **GPIO 41** (Active-Low)
- **Lower Float Switch:** ESP32 **GPIO 38** (Safety Interlock)
- **DS18B20 Temp Sensor:** ESP32 **GPIO 17** (1-Wire + 4.7kΩ pull-up ke 3.3V)
- **YF-B1 Flow Meter:** ESP32 **GPIO 15**
- **FS400A Flow Meter:** ESP32 **GPIO 16**
- **Upper Float Switch:** **REMOVED / TIDAK DIGUNAKAN**

### F. Actuator Relays (Active-LOW)
- **Well Pump:** ESP32 **GPIO 1**
- **Distribution Pump:** ESP32 **GPIO 2**
- **Raw Submersible Pump:** ESP32 **GPIO 4**
- **Dosing Pump A:** ESP32 **GPIO 5**
- **Dosing Pump B:** ESP32 **GPIO 6**
- **Cooling Fan:** ESP32 **GPIO 7**
- **Error Lamp:** ESP32 **GPIO 18**

