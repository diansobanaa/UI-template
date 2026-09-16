# HARDWARE INVENTORY & COMMISSIONING READINESS

**Document Role:** Physical Hardware Inventory & Module Registry  
**Authority:** Physical Workbench Inventory (User Verified)  
**Parent Contract:** [HARDWARE_WIRING_MAP.md](file:///d:/template/docs/HARDWARE_WIRING_MAP.md) (Canonical Hardware Wiring Contract)  
**Status:** **AUTHORITATIVE HARDWARE INVENTORY**

---

## 1. Physical Hardware Components Breakdown

The following table accounts for every piece of physical hardware in the AgroTech Greenhouse Controller system:

| Item | Component / Module Name | Specific Model / Markings | Qty | Operating Domain | Interface / Signals | Commissioning Status | Role in System |
|---|---|---|:---:|---|---|:---:|---|
| **MCU** | ESP32-S3 Dev Board | ESP32-S3-WROOM-1-N16R8 | 1 | 3.3V Logic, 5V Vin | Dual 22-pin Headers, Dual USB-C | **VERIFIED READY** | Master controller, web server REST API, runtime authority. |
| **RTC** | Real-Time Clock Module | DS3231 I2C (Pins: 32K, SQW, SCL, SDA, VCC, GND) | 1 | 3.3V DC Supply | I2C (SDA: GPIO 8, SCL: GPIO 9) | **VERIFIED READY** | Hardware battery-backed real-time clock authority. Driver integrated (SP-HW-006). |
| **DISP** | TFT Display + SD Module | 1.8" ST7735 SPI (128×160) + Built-in SD Card Slot | 1 | 3.3V DC (5V Vin tolerant) | Shared SPI (TFT CS: 14, SD CS: 48, SCK: 11, MOSI: 12, MISO: 13) | **VERIFIED READY (TFT)** / **UNVERIFIED (SD)** | Local diagnostics and status screen. SD slot physically present on back of TFT. |
| **TEMP** | Waterproof Temp Probe | Dallas DS18B20 Stainless Probe | 1 | 3.3V DC Supply | 1-Wire Bus (GPIO 17 + 4.7kΩ pull-up) | **VERIFIED READY** | Nutrient tank temperature monitoring. |
| **RELAY** | 4-Channel Relay Board | 4-Channel 5V Optocoupled (VCC-JDVCC jumper installed) | 1 | 5V Coil, 5V Logic | Active-LOW (IN1: GPIO 4, IN2: GPIO 18, IN3/IN4: TBD) | **VERIFIED READY** | Intermediate galvanic isolation and DC load switching. |
| **MOSFET**| High-Power MOSFET Board | 15A / 400W PWM / DC Driver | 3 | 3.3V/5V Gate, 12V DC Out | Active-LOW (GPIO 5, 6, 7). Pins: `TRIG-PWM`, `GND` | **VERIFIED READY** | High-speed switching for Dosing A, Dosing B, and Cooling Fan. |
| **REG** | DC-DC Buck Converter | LM2596 Step-Down Module (3A Max) | 1 | 12V DC In, 5.05V Out | Terminals: IN+, IN-, OUT+, OUT- | **VERIFIED READY** | Steps down 12V auxiliary power to 5.05V logic rail. Verify with DMM. |
| **PSU 1** | Switching Power Supply | 12V 5A (60W) Enclosed PSU | 1 | 220V AC In, 12V DC Out | Screw Terminals (L, N, PE, +V, -V) | **VERIFIED READY** | Auxiliary power for 12V DC loads and LM2596 regulator. |
| **FLOW 1**| Water Flow Sensor (Fertigation)| YF-B1 (DN15 / G1/2") Hall Effect | 1 | 5V Power, 3.3V Pulse Out | Pulse Output (GPIO 15 via divider) | **VERIFIED READY** | Inline volumetric flow metering on fertigation loop. |
| **FLOW 2**| Water Flow Sensor (Supply) | FS400A (G1") Hall Effect | 1 | 5V Power, 3.3V Pulse Out | Pulse Output (GPIO 16 via divider) | **VERIFIED READY** | Inline volumetric flow metering on raw water replenishment line. |
| **FLOAT** | Lower Float Switch | Stainless Steel Vertical Reed | 1 | Dry Contact (3.3V pull-up) | Digital In (GPIO 38) | **VERIFIED READY (SAFETY)** | **MANDATORY SAFETY STOP POINT:** Pump dry-run cavitation protection. |
| **BTNS** | Momentary Push Buttons | 12mm Tactile Panel Buttons | 4 | 3.3V Dry Contact | Digital In (GPIO 0, 39, 40, 41) | **VERIFIED READY** | Panel buttons: Button 1 (GPIO 0: TFT screen switch), Button 2 (GPIO 39: Well Pump manual toggle with 5-min auto-off & dry-run interlock), Button 3 (GPIO 40: Reserved/TBD), Button 4 (GPIO 41: Reserved/TBD). |
| **PUMP 1**| Deep Well Pump (Mains AC) | Submersible Well Pump | 1 | 220V–240V AC Mains | Switched via Omron Heavy-Duty Relay #1 (GPIO 1) | **VERIFIED ARCHITECTURE** | Raw water extraction into main tank. |
| **PUMP 2**| Distribution Pump (Mains AC)| Booster Pump GH-1 | 1 | 220V–240V AC Mains | Switched via Omron Heavy-Duty Relay #2 (GPIO 2) | **VERIFIED ARCHITECTURE** | High-pressure nutrient distribution loop to Greenhouse 1. |
| **PUMP 3**| Raw Water Pump (12V DC) | Submersible 12V DC Pump | 1 | 12V DC Auxiliary | Switched via 4-Ch Relay Board Ch 1 (GPIO 4) | **VERIFIED ARCHITECTURE** | Tank mixing, water replenishment transfer. |
| **DOSE A**| Dosing Pump A (Nutrient) | Peristaltic Pump 12V DC | 1 | 12V DC Auxiliary | Switched via MOSFET #1 (GPIO 5) | **VERIFIED ARCHITECTURE** | Concentrated nutrient solution A injection. |
| **DOSE B**| Dosing Pump B (pH/Buffer)| Peristaltic Pump 12V DC | 1 | 12V DC Auxiliary | Switched via MOSFET #2 (GPIO 6) | **VERIFIED ARCHITECTURE** | Concentrated nutrient solution B / pH buffer injection. |
| **FAN** | Exhaust Cooling Fan | 12V DC Brushless Fan | 1 | 12V DC Auxiliary | Switched via MOSFET #3 (GPIO 7) | **VERIFIED ARCHITECTURE** | Enclosure thermal management and ventilation. |
| **LAMP** | Error Indicator Lamp | Red Beacon Pilot Lamp 12V/5V | 1 | 12V DC (or 5V DC) | Switched via 4-Ch Relay Board Ch 2 (GPIO 18) | **VERIFIED ARCHITECTURE** | Visual alarm and hardware interlock status beacon. |
| **ETH** | W5500 SPI Ethernet Module | W5500 Hardwired TCP/IP | 1 | 3.3V DC Supply | Shared SPI (CS: GPIO 10) | **NOT USED IN CURRENT COMMISSIONING** | Wired LAN interface. Deferred to future commissioning phase. |
| **SEC_LOOP**| Anti-Theft Tamper Loop Wire | Continuous closed wire loop (conduit/chassis) | 1 | 3.3V Logic (GND_LV) | Digital In (GPIO 47 + internal pull-up) | **VERIFIED READY (SECURITY)** | Physical security interlock against pump theft / wire cutting. |
| **RTC_OLD**| DS1302 3-Wire RTC Module | DS1302 Bitbang Breakout | 0 | 3.3V DC Supply | 3-Wire Bus (CLK: 8, DAT: 9, RST: 47)| **OBSOLETE / NOT USED** | Replaced by DS3231 I2C RTC. GPIO 47 reassigned to Anti-Theft Tamper Loop. |
| **FLOAT_U**| Upper Float Switch | High Level Reed Switch | 0 | N/A | Digital In | **OBSOLETE / NOT USED** | Tank volume bounded strictly by software capacity validation. |

---

## 2. Commissioning Status Definitions

- **VERIFIED READY:** Physical hardware verified present, pinout mapped, and compatible with ESP32 safe operating domains.
- **UNVERIFIED:** Hardware present, but full end-to-end electrical/functional execution is pending physical bench test or USB boot log capture.
- **PINS TBD:** Physical module present, but terminal/pin labels have not yet been provided by the operator. Pins are marked TBD to prevent guessing.
- **NOT USED IN CURRENT COMMISSIONING:** Hardware present in BOM, but intentionally deferred from the current direct UI $\leftrightarrow$ ESP32 commissioning scope.
- **OBSOLETE / NOT USED:** Hardware previously planned or tested, but permanently removed or replaced in the canonical design.
