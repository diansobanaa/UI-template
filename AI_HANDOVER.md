# AI HANDOVER DOCUMENT

## Current Status
- **Date/Time**: 2026-09-16
- **Safe Point**: SP-HW-009 — Dual-Core Firmware Refactor
- **Goal**: Refactor the firmware to use a dual-core architecture to explicitly pin tasks to specific cores on the ESP32-S3, achieving clear separation between networking/HTTP tasks and control/safety/sensor tasks.

### What was just completed (SP-HW-009)
1. **Firmware Implementation**:
   - `esp32/main/http/http_server.c`: Updated HTTP server task initialization to explicitly pin to **Core 0**.
   - `esp32/main/services/safety_monitor.c`: Updated task creation using `xTaskCreatePinnedToCore` to run on **Core 1**.
   - `esp32/main/services/telemetry_mgr.c`: Pinned `telemetry_sampler_task` to **Core 1**.
   - `esp32/main/services/scheduler.c`: Pinned `scheduler_task` to **Core 1**.
   - `esp32/main/services/command_mgr.c`: Pinned `command_worker_task` to **Core 1**.
2. **Master Hardware Documentation Synchronization (100% Match)**:
   - Zero GPIO changes were made. All GPIO mappings remain identical.
   - Created renderable visual peripheral flowchart: `docs/ESP32_PERIPHERAL_VISUAL_MAP.md` & `esp32/docs/ESP32_PERIPHERAL_VISUAL_MAP.md`.

## Repository Status
- Firmware Pin Matrix: **26/26 pins match identically** with `pin_config.h` (No changes in SP-HW-009).
- Target Hardware: ESP32-S3-WROOM-1-N16R8.
- Dual-core architecture: Enabled (Network on Core 0, Control/Safety on Core 1).
- Actuator status: **100% SAFE OFF**.

## Next Action for Next Agent / Operator
1. **Physical Flashing / Hardware Bring-up (when USB COM3 reconnected)**:
   Flash firmware:
   `& "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe" -m esptool --chip esp32s3 -p COM3 -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m 0x0 build/bootloader/bootloader.bin 0x8000 build/partition_table/partition-table.bin 0xf000 build/ota_data_initial.bin 0x20000 build/agrotech_esp32.bin`
2. **Field Verification**:
   - Verify that all tasks start successfully.
   - Trigger a web request and verify it is handled on Core 0 while the safety loop continues unblocked on Core 1.
