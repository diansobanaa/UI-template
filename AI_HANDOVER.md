# AI HANDOVER DOCUMENT

## Current Status
- **Date/Time**: 2026-09-15
- **Safe Point**: SP-HW-005 — Canonical Hardware Component & Pin Mapping Synchronization.
- **Goal**: Synchronize master documentation to reflect actual physical hardware inventory: replace legacy DS1302 3-wire mapping with active DS3231 I2C RTC (`32K`, `SQW`, `SCL`, `SDA`, `VCC`, `GND`), liberate GPIO 47, audit 4-channel relay module and LM2596 buck converter, and record 3x MOSFET modules with TBD pins.

### What was just completed
- **SP-HW-005**:
  1. Identified active RTC module as standard **DS3231 I2C RTC** (`32K`, `SQW`, `SCL`, `SDA`, `VCC`, `GND`).
  2. Mapped DS3231 I2C pins: `SCL` $\to$ **GPIO 9**, `SDA` $\to$ **GPIO 8**, `VCC` $\to$ **3.3V DC**, `GND` $\to$ **ESP32 GND**; marked `32K` and `SQW` as **NOT USED (NC)**.
  3. Obsoleted legacy DS1302 3-wire mapping and **liberated GPIO 47** as clean unassigned spare GPIO.
  4. Flagged firmware HAL driver state (`hal/rtc_ds1302.c`, `hal/rtc_ds1302.h`, `pin_config.h`) as **`SOFTWARE UPDATE REQUIRED: DS3231 I2C DRIVER INTEGRATION`** for subsequent firmware safe point.
  5. Audited 4-Channel 5V Relay Module: verified active-LOW logic (`ACTUATOR_ACTIVE_LEVEL = 0`), `VCC ↔ JD-VCC` jumper closed configuration (shared 5V supply, mandatory common ground with ESP32), and noted 3.3V logic high cutoff test caution. Mapped IN1 $\to$ GPIO 4 (Raw Submersible), IN2 $\to$ GPIO 18 (Error Lamp), IN3/IN4 $\to$ TBD/Spare.
  6. Audited LM2596 DC-DC Buck Converter as **POWER COMPONENT**: 12V DC input from PSU 1 $\to$ 5.05V DC output for ESP32 5V rail; noted common ground plane and mandatory pre-power DMM voltage calibration requirement.
  7. Audited DS18B20: `VCC` $\to$ 3.3V DC, `GND` $\to$ ESP32 GND, `DATA` $\to$ GPIO 17 with 4.7kΩ pull-up resistor.
  8. Audited 3x MOSFET Modules: recorded physical pins as **TBD** and actuator assignments as **TBD** without guessing.
  9. Audited TFT + SD Module: confirmed TFT canonical pins (SCK: 11, MOSI: 12, CS: 14, DC: 21, RST: 42), confirmed SD slot shared SPI (SCK: 11, MOSI: 12, MISO: 13, SD_CS: 48 with WS2812 DIN caveat) and classified SD hardware verification as **UNVERIFIED / PENDING PHYSICAL VERIFICATION**.
  10. Updated [ESP32_GPIO_PIN_MAP.md](file:///d:/template/docs/ESP32_GPIO_PIN_MAP.md) as authoritative Single Source of Truth with all required sections (A: GPIO Pin Map, B: Component Pin Map, C: Power Map, D: Hardware Status, E: Conflict Matrix, F: Firmware Status).
  11. Synchronized `esp32/docs/ESP32_GPIO_PIN_MAP.md` to identical hash.
  12. Synchronized `esp32/docs/ESP32_ASSEMBLY_GUIDE.md` to eliminate stale GPIO references.
  13. Marked `esp32/docs/AI_DS1302_PIN_MAPPING_AUDIT_V1.md` as SUPERSEDED & OBSOLETE.

## Repository Status
- Master Documentation: **SYNCHRONIZED & CONFLICT-FREE**.
- Target Hardware: ESP32-S3-WROOM-1-N16R8.
- Firmware HAL RTC Status: `rtc_ds1302` legacy bitbang driver present (**SOFTWARE UPDATE REQUIRED**).
- Flash & Boot Status: **PENDING PHYSICAL USB CONNECTION**.
- Actuator status: **100% SAFE OFF**.

## Next Action for Next Agent / Operator
1. **Firmware Task (SP-HW-006)**: Refactor RTC HAL driver in `esp32/main/hal/` from bitbang DS1302 to I2C DS3231 driver using ESP-IDF `driver/i2c.h` on GPIO 8 (SDA) and GPIO 9 (SCL), and remove `PIN_DS1302_RST` from `esp32/main/config/pin_config.h`.
2. **Physical Flashing / Hardware Bring-up (when USB COM3 reconnected)**:
   Flash firmware:
   `& "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe" -m esptool --chip esp32s3 -p COM3 -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m 0x0 build/bootloader/bootloader.bin 0x8000 build/partition_table/partition-table.bin 0xf000 build/ota_data_initial.bin 0x20000 build/agrotech_esp32.bin`
