# ESP32-S3-WROOM-1-N16R8 MASTER GPIO PIN MAP

**Document Role:** Hardware Pin Allocation & Header Breakdown  
**Target Board:** ESP32-S3-WROOM-1-N16R8 (16MB Octal Flash, 8MB Octal PSRAM)  
**Board Layout:** Dual 22-Pin Headers (Left 22-Pin, Right 22-Pin), Dual USB-C ("COM" UART and "USB" Native)  
**Parent Contract:** [HARDWARE_WIRING_MAP.md](file:///d:/template/docs/HARDWARE_WIRING_MAP.md) (Canonical Hardware Wiring Contract)  
**Status:** **AUTHORITATIVE GPIO REGISTRY**

---

## 1. Complete ESP32 GPIO 0-48 Allocation Table

The following table accounts for every GPIO (0 to 48) on the ESP32-S3-WROOM-1-N16R8 board:

| ESP32 Header | GPIO | Function | Component | Interface | Direction / Logic | Electrical Status | Notes & Constraints |
|:---|:---:|:---|:---|:---|:---:|:---:|:---|
| **Right-14** | **0** | Mode Switch | Push Button / BOOT | GPIO Digital In | Input (Active-LOW) | ACCEPTABLE WITH CAVEAT | Strapping pin. Has onboard pull-up. Must be HIGH (released) at boot. |
| **Right-4** | **1** | Well Pump AC Trigger | Omron Relay #1 | GPIO Digital Out | Output (Active-LOW) | VERIFIED SAFE | Standard clean GPIO. Controls 220V AC Deep Well Pump. |
| **Right-5** | **2** | Distribution Pump AC Trigger | Omron Relay #2 | GPIO Digital Out | Output (Active-LOW) | VERIFIED SAFE | Standard clean GPIO. Controls 220V AC Booster Pump GH-1. |
| **Left-13** | **3** | *RESERVED: JTAG / Boot* | SoC Internal | JTAG / Strapping | N/A | **DO NOT USE (STRAPPING)** | Strapping pin. Interferes with JTAG & boot if connected. |
| **Left-4** | **4** | Raw Submersible Pump Trigger | 4-Ch Relay Board IN1 | GPIO Digital Out | Output (Active-LOW) | VERIFIED SAFE | Standard clean GPIO. Controls 12V DC Raw Submersible Pump. |
| **Left-5** | **5** | Dosing Pump A Trigger | MOSFET Module #1 | GPIO Digital Out | Output (Active-LOW in hal) | VERIFIED SAFE | Standard clean GPIO. Controls 12V DC Dosing Pump A (Nutrient). |
| **Left-6** | **6** | Dosing Pump B Trigger | MOSFET Module #2 | GPIO Digital Out | Output (Active-LOW in hal) | VERIFIED SAFE | Standard clean GPIO. Controls 12V DC Dosing Pump B (pH/Buffer). |
| **Left-7** | **7** | Cooling Fan Trigger | MOSFET Module #3 | GPIO Digital Out | Output (Active-LOW in hal) | VERIFIED SAFE | Standard clean GPIO. Controls 12V DC Cabinet Exhaust Fan. |
| **Left-12** | **8** | I2C SDA (Data) | RTC DS3231 | I2C Bus | Bi-directional | VERIFIED SAFE | Dedicated I2C Data line (+ 4.7kΩ pull-up to 3.3V). |
| **Left-15** | **9** | I2C SCL (Clock) | RTC DS3231 | I2C Bus | Output | VERIFIED SAFE | Dedicated I2C Clock line (+ 4.7kΩ pull-up to 3.3V). |
| **Left-16** | **10** | Ethernet CS | W5500 SPI Module | SPI Chip Select | Output (Active-LOW) | VERIFIED SAFE | Dedicated SPI CS. **NOT USED IN CURRENT COMMISSIONING**. |
| **Left-17** | **11** | Shared SPI SCK | TFT ST7735 & SD Slot | SPI Clock | Output | VERIFIED SAFE | Shared SPI2_HOST clock for TFT display and built-in SD slot. |
| **Left-18** | **12** | Shared SPI MOSI | TFT ST7735 & SD Slot | SPI Master Out | Output | VERIFIED SAFE | Shared SPI2_HOST data out for TFT display and built-in SD slot. |
| **Left-19** | **13** | Shared SPI MISO | MicroSD Card Slot | SPI Master In | Input | VERIFIED SAFE | Shared SPI2_HOST data in from built-in SD slot. |
| **Left-20** | **14** | TFT Chip Select | TFT ST7735 Display | SPI Chip Select | Output (Active-LOW) | VERIFIED SAFE | Dedicated SPI CS for 1.8" TFT display controller. |
| **Left-8** | **15** | Flow Pulse Fertigation | Sensor YF-B1 (DN15) | Pulse Counter | Input (Interrupt) | VERIFIED SAFE | 5V Hall sensor signal level-shifted to 3.3V. |
| **Left-9** | **16** | Flow Pulse Raw Supply | Sensor FS400A (G1") | Pulse Counter | Input (Interrupt) | VERIFIED SAFE | 5V Hall sensor signal level-shifted to 3.3V. |
| **Left-10** | **17** | 1-Wire Temperature Data | Sensor DS18B20 | 1-Wire Bus | Bi-directional | VERIFIED SAFE | Dedicated 1-Wire bus with mandatory 4.7kΩ pull-up to 3.3V. |
| **Left-11** | **18** | Error Beacon Lamp Trigger | 4-Ch Relay Board IN2 | GPIO Digital Out | Output (Active-LOW) | VERIFIED SAFE | Standard clean GPIO. Controls visual alert beacon/lamp. |
| **Right-20** | **19** | *RESERVED: Native USB D-* | USB-C "USB" Port | USB OTG / JTAG | N/A | **DO NOT USE (USB PHY)** | Hardwired to onboard native USB connector. |
| **Right-19** | **20** | *RESERVED: Native USB D+* | USB-C "USB" Port | USB OTG / JTAG | N/A | **DO NOT USE (USB PHY)** | Hardwired to onboard native USB connector. |
| **Right-18** | **21** | TFT Command / Data (DC) | TFT ST7735 Display | Control Signal | Output (H=Data, L=Cmd)| VERIFIED SAFE | Dedicated DC selector line for ST7735 display controller. |
| **N/A** | **22-25**| *NON-EXISTENT SILICON* | None | N/A | N/A | **NON-EXISTENT** | GPIO 22–25 do not exist in ESP32-S3 silicon. |
| **N/A** | **26-34**| *RESERVED: Flash & PSRAM* | Internal RF Shield | Octal SPI Bus | N/A | **FATAL (INTERNAL MEMORY)**| Connected internally to Octal Flash & PSRAM chips. |
| **Right-13** | **35** | *RESERVED: Octal PSRAM IO6*| Internal PSRAM | Octal Bus IO6 | N/A | **FATAL (DO NOT TOUCH)** | Exposed on pin header, but touching crashes Octal PSRAM! |
| **Right-12** | **36** | *RESERVED: Octal PSRAM IO7*| Internal PSRAM | Octal Bus IO7 | N/A | **FATAL (DO NOT TOUCH)** | Exposed on pin header, but touching crashes Octal PSRAM! |
| **Right-11** | **37** | *RESERVED: Octal PSRAM DQS*| Internal PSRAM | Octal Bus DQS | N/A | **FATAL (DO NOT TOUCH)** | Exposed on pin header, but touching crashes Octal PSRAM! |
| **Right-10** | **38** | Lower Float Switch | Stainless Float Switch | Digital Input | Input (Active-LOW dry) | **VERIFIED SAFE (SAFETY)** | **SAFETY AUTHORITY:** Dedicated clean pin for dry-run protection. |
| **Right-9** | **39** | Manual A Button | Push Button | Digital Input | Input (Active-LOW) | VERIFIED SAFE | Manual operator toggle for Dosing Pump A (internal pull-up). |
| **Right-8** | **40** | Manual B Button | Push Button | Digital Input | Input (Active-LOW) | VERIFIED SAFE | Manual operator toggle for Dosing Pump B (internal pull-up). |
| **Right-7** | **41** | Distribution Button | Push Button | Digital Input | Input (Active-LOW) | VERIFIED SAFE | Manual operator toggle for Distribution Pump (internal pull-up).|
| **Right-6** | **42** | TFT Hardware Reset | TFT ST7735 Display | Control Signal | Output (Active-LOW) | VERIFIED SAFE | Dedicated reset line for ST7735 display controller. |
| **Right-2** | **43** | *RESERVED: UART0 TXD* | USB-UART Bridge | Console UART | Output | **RESERVED (CONSOLE COM)** | Flashing and real-time monitoring console (COM3). |
| **Right-3** | **44** | *RESERVED: UART0 RXD* | USB-UART Bridge | Console UART | Input | **RESERVED (CONSOLE COM)** | Flashing and real-time monitoring console (COM3). |
| **Right-15** | **45** | *RESERVED: Strapping VDD* | SoC Internal | Strapping (VDD_SPI)| N/A | **FATAL (DO NOT USE)** | Pulling HIGH drops Flash voltage to 1.8V, bricking boot. |
| **Left-14** | **46** | *RESERVED: Strapping ROM* | SoC Internal | Strapping (ROM Log)| N/A | **HIGH RISK (DO NOT USE)** | Pulling HIGH alters ROM bootloader debug logging. |
| **Right-17** | **47** | **UNASSIGNED / CLEAN SPARE**| None (Former DS1302)| General I/O | Spare Bi-directional | **LIBERATED / SAFE** | Former DS1302 RST. Now completely free and safe for future use. |
| **Right-16** | **48** | MicroSD Chip Select | Built-in SD Card Slot | SPI Chip Select | Output (Active-LOW) | ACCEPTABLE WITH CAVEAT | Dedicated SD CS line. Caveat: Drives onboard WS2812 DIN line. |

---

## 2. Physical Header Pinout Layout

### Left 22-Pin Header
```text
Pin 1 : 3V3 (Power Output)
Pin 2 : 3V3 (Power Output)
Pin 3 : RST / EN (Chip Reset)
Pin 4 : GPIO4  -> Raw Submersible Pump (Relay IN1)
Pin 5 : GPIO5  -> Dosing Pump A (MOSFET #1)
Pin 6 : GPIO6  -> Dosing Pump B (MOSFET #2)
Pin 7 : GPIO7  -> Cooling Fan Panel (MOSFET #3)
Pin 8 : GPIO15 -> Flow Meter YF-B1 (Fertigation)
Pin 9 : GPIO16 -> Flow Meter FS400A (Supply)
Pin 10: GPIO17 -> Temperature Sensor DS18B20 (1-Wire)
Pin 11: GPIO18 -> Error Beacon Lamp (Relay IN2)
Pin 12: GPIO8  -> RTC DS3231 SDA (I2C Data)
Pin 13: GPIO3  -> [FORBIDDEN: Strapping JTAG]
Pin 14: GPIO46 -> [FORBIDDEN: Strapping ROM]
Pin 15: GPIO9  -> RTC DS3231 SCL (I2C Clock)
Pin 16: GPIO10 -> W5500 Ethernet CS (Not used in commissioning)
Pin 17: GPIO11 -> Shared SPI SCK (TFT & SD)
Pin 18: GPIO12 -> Shared SPI MOSI (TFT & SD)
Pin 19: GPIO13 -> Shared SPI MISO (SD Card)
Pin 20: GPIO14 -> TFT Display CS
Pin 21: 5V (VBUS / Vin Power Input)
Pin 22: GND (Common Signal Ground)
```

### Right 22-Pin Header
```text
Pin 1 : GND (Common Signal Ground)
Pin 2 : GPIO43 / TXD0 -> [RESERVED: UART0 Console TX]
Pin 3 : GPIO44 / RXD0 -> [RESERVED: UART0 Console RX]
Pin 4 : GPIO1  -> Well Pump AC Trigger (Omron #1)
Pin 5 : GPIO2  -> Distribution Pump AC Trigger (Omron #2)
Pin 6 : GPIO42 -> TFT Display RESET
Pin 7 : GPIO41 -> Push Button: DISTRIBUTION
Pin 8 : GPIO40 -> Push Button: MANUAL B
Pin 9 : GPIO39 -> Push Button: MANUAL A
Pin 10: GPIO38 -> Lower Float Switch (Dry-Run Safety Interlock)
Pin 11: GPIO37 -> [FATAL DO NOT TOUCH: Octal PSRAM DQS]
Pin 12: GPIO36 -> [FATAL DO NOT TOUCH: Octal PSRAM IO7]
Pin 13: GPIO35 -> [FATAL DO NOT TOUCH: Octal PSRAM IO6]
Pin 14: GPIO0  -> Push Button: MODE (BOOT Strapping Caveat)
Pin 15: GPIO45 -> [FATAL DO NOT TOUCH: Strapping VDD_SPI]
Pin 16: GPIO48 -> MicroSD Card CS (WS2812 RGB LED Caveat)
Pin 17: GPIO47 -> UNASSIGNED CLEAN SPARE (Liberated from DS1302)
Pin 18: GPIO21 -> TFT Display DC / A0
Pin 19: GPIO20 -> [RESERVED: Native USB D+]
Pin 20: GPIO19 -> [RESERVED: Native USB D-]
Pin 21: GND (Common Signal Ground)
Pin 22: GND (Common Signal Ground)
```

---

## 3. Summary of Reserved & Forbidden GPIOs

1. **Octal Memory Bus (GPIO 26–37):**
   - GPIO 26–34: Routed internally under RF shield.
   - GPIO 35, 36, 37: Broken out to Right Header pins 13, 12, 11. **NEVER CONNECT.** Connecting external wires causes bus capacitance, memory corruption, and instant boot panic.
2. **Strapping Pins (GPIO 3, 45, 46):**
   - GPIO 45 sets Flash voltage (`0`=3.3V, `1`=1.8V). Pulling HIGH destroys boot on 3.3V Flash.
   - GPIO 3 and 46 control ROM download and debug print modes.
3. **Dedicated System Pins (GPIO 19, 20, 43, 44):**
   - GPIO 19 & 20: Hardwired to native USB-C port.
   - GPIO 43 & 44: Hardwired to onboard CP2102/CH340 USB-to-UART bridge (COM port).
4. **Silicon Non-Existent Pins (GPIO 22, 23, 24, 25):**
   - Do not exist in ESP32-S3 silicon architecture.
