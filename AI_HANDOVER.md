# AI HANDOVER DOCUMENT

## Current Status
- **Date/Time**: 2026-09-15
- **Safe Point**: SP-HW-004 (PARTIAL) — TFT Onboard SD Card Slot Shared SPI Integration.
- **Goal**: Re-architect SD card interface to utilize the physical SD Card Slot built into the back of the 1.8" TFT ST7735 module on shared SPI2_HOST bus (SCK: 11, MOSI: 12, MISO: 13, SD_CS: 48) without an external microSD reader.

### What was just completed
- **SP-HW-004 (PARTIAL)**:
  1. Audited codebase: verified all references to `SDCARD_HAL`, `PIN_MICROSD_CS`, `GPIO27`, and `FEATURE_SDCARD_ENABLED`. Completely removed external reader assumptions.
  2. Updated `esp32/main/config/pin_config.h`:
     - Explicit defines: `PIN_SD_SCK` (11), `PIN_SD_MOSI` (12), `PIN_SD_MISO` (13), `PIN_SD_CS` (48), with alias `PIN_MICROSD_CS`.
     - Preserved all validated peripheral mappings: TFT (11/12/14/21/42), RTC DS1302 (8/9/47), Buttons (0/39/40/41), Lower Float (38), DS18B20 (17), Flow (15/16), Actuators (1/2/4/5/6/7/18).
  3. Updated `esp32/main/hal/sdcard_hal.h` and `esp32/main/hal/sdcard_hal.c`:
     - Initialized `PIN_SD_CS` (GPIO 48) as output driven HIGH (1) at boot to guarantee unselected state during TFT transactions.
     - Pulled up SPI lines (`MISO`, `MOSI`, `SCK`) for clean bus idle state.
     - Bound SDSPI to `SPI2_HOST` with bounded timeout (100 ms) and fail-safe degraded mode fallback when card is uninserted.
     - Guarded `s_card` to ensure 0 compiler warnings under `FEATURE_SDCARD_ENABLED=0`.
  4. Updated master documentation in `docs/ESP32_GPIO_PIN_MAP.md` and `esp32/docs/ESP32_GPIO_PIN_MAP.md`:
     - Added Section 15 "Shared SPI Bus & Component-to-GPIO Mapping" explicitly separating physical pin breakouts from component mappings.
  5. Built firmware cleanly (`agrotech_esp32.bin`, 939,728 bytes, 0 errors, 0 warnings).
  6. Attempted flashing to COM3: detected USB-to-UART adapter is physically disconnected from host PC.

## Repository Status
- Firmware builds cleanly (939,728 bytes, 0 errors, 0 warnings).
- Target Hardware: ESP32-S3-WROOM-1-N16R8 on COM3.
- Flash & Boot Status: **PENDING PHYSICAL USB CONNECTION**.
- Actuator status: **100% SAFE OFF**.

## Next Action for Next Agent / Operator
1. Reconnect the USB-to-UART cable (FTDI COM3) to the host PC.
2. Flash firmware:
   `& "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe" -m esptool --chip esp32s3 -p COM3 -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m 0x0 build/bootloader/bootloader.bin 0x8000 build/partition_table/partition-table.bin 0xf000 build/ota_data_initial.bin 0x20000 build/agrotech_esp32.bin`
3. Capture serial boot log:
   `& "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe" "C:\Users\rumah\.gemini\antigravity-ide\brain\6c1389ac-b0da-47f3-b257-36c8d3d44827\scratch\read_serial.py" COM3`
4. Verify boot log and promote SP-HW-004 from PARTIAL to PASS.


