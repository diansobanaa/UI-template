# AI HANDOVER DOCUMENT

## Current Status
- **Date/Time**: 2026-09-15
- **Safe Point**: SP-HW-005 — Canonical Hardware Wiring Contract & Modular Pin Documentation Suite.
- **Goal**: Synchronize master documentation into an authoritative Hardware Wiring Contract between firmware, components, and field wiring (`docs/HARDWARE_WIRING_MAP.md`, `ESP32_GPIO_PIN_MAP.md`, `COMPONENT_PIN_MAP.md`, `POWER_MAP.md`, `HARDWARE_INVENTORY.md`, `HARDWARE_WIRING_CHECKLIST.md`).

### What was just completed
- **SP-HW-005**:
  1. Designated [HARDWARE_WIRING_MAP.md](file:///d:/template/docs/HARDWARE_WIRING_MAP.md) as the **CANONICAL HARDWARE WIRING CONTRACT** with connection IDs W-01 through W-29, full subsystem ASCII diagrams, actuator drive paths, validation matrix, and firmware consistency audit.
  2. Created modular [ESP32_GPIO_PIN_MAP.md](file:///d:/template/docs/ESP32_GPIO_PIN_MAP.md) covering complete GPIO 0–48, header layouts, and reserved/forbidden pins.
  3. Created modular [COMPONENT_PIN_MAP.md](file:///d:/template/docs/COMPONENT_PIN_MAP.md) specifying component physical pinouts, functions, interface, direction, and active levels.
  4. Created modular [POWER_MAP.md](file:///d:/template/docs/POWER_MAP.md) detailing 3.3V, 5V, 12V, GND domains, LM2596 trimpot DMM calibration protocol, relay VCC-JDVCC jumper implications, and ground segregation.
  5. Created modular [HARDWARE_INVENTORY.md](file:///d:/template/docs/HARDWARE_INVENTORY.md) listing verified active components, W5500 (NOT USED IN CURRENT COMMISSIONING), obsolete DS1302, and 3x MOSFETs (PINS TBD).
  6. Created modular [HARDWARE_WIRING_CHECKLIST.md](file:///d:/template/docs/HARDWARE_WIRING_CHECKLIST.md) providing an automated 15-point consistency checklist for all future hardware changes.
  7. Mirrored and synchronized all documentation files to `esp32/docs/` with identical SHA256 hashes.
  8. Synchronized `esp32/docs/ESP32_ASSEMBLY_GUIDE.md` and marked `esp32/docs/AI_DS1302_PIN_MAPPING_AUDIT_V1.md` as obsolete.
  9. Audited firmware consistency against `esp32/main/config/pin_config.h`: verified 22/25 pins match identically; flagged GPIO 8, 9, 47 as `SOFTWARE UPDATE REQUIRED: DS3231 I2C DRIVER INTEGRATION` for SP-HW-006.

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
