# AI HANDOVER DOCUMENT

## Current Status
- **Date/Time**: 2026-09-16
- **Safe Point**: SP-HW-010 — Physical Panel Button Functional Role Refactor & Well Pump Timer
- **Goal**: Refactor the 4 physical panel buttons according to new requirements without altering GPIO mapping (GPIO 0: TFT screen switch; GPIO 39: Well Pump manual toggle with 5-minute auto-off timer and float/E-stop interlocks; GPIO 40 & 41: Reserved/TBD).

### What was just completed (SP-HW-010)
1. **Firmware Implementation**:
   - `esp32/main/hal/button_hal.c` & `.h`: Added background scanning daemon `button_poll_task` (20ms poll / 40ms stable filter) pinned to Core 1.
   - `esp32/main/services/panel_button_mgr.c` & `.h`: Implemented button event manager with FreeRTOS software timer `s_well_pump_timer` (5 minutes = 300,000ms):
     - **Button 1 (GPIO 0):** Cycles ST7735 TFT screens (`tft_show_next_screen`). Disconnected from old Auto/Manual mode toggle.
     - **Button 2 (GPIO 39):** State 1 (OFF $\to$ ON) starts 5-min timer and commands Well Pump ON. State 2 (ON $\to$ OFF) commands immediate OFF and cancels timer. Timer expiration automatically turns pump OFF. Strictly interlocked with Lower Float Switch (`PIN_IN_FLOAT_LOWER` on GPIO 38) and Emergency Stop (`s_emergency_stop_latched`).
     - **Buttons 3 & 4 (GPIO 40, 41):** Software debounced, marked `RESERVED / TBD`, no action assigned.
   - `esp32/main/hal/tft_hal.c` & `.h`: Added 4 diagnostic display screens (Diagnostics, Sensors, Actuators, Network/Time) and screen-cycling API in 16-bit RGB565 colors.
   - `esp32/main/hal/hardware_registry.c`: Updated default components list and `components.json` with new button roles (`TFT_SWITCH`, `WELL_PUMP_TOGGLE`, `RESERVED`, `RESERVED`).
   - `esp32/main/main.c`: Mounted `panel_button_mgr_init()` in `app_main`.
   - `esp32/main/CMakeLists.txt`: Added `services/panel_button_mgr.c` to source list.
2. **Build Verification**:
   - Clean compilation using ESP-IDF v5.5 (0 compiler errors, 0 warnings; binary size: 0xf2960 bytes, 68% free partition space).
3. **Master Hardware Documentation Synchronization (Zero-Drift Policy)**:
   - Zero GPIO changes were made. All GPIO mappings remain locked and identical.
   - Updated button mapping across all 9 technical documentation files:
     - `docs/HARDWARE_WIRING_MAP.md` & `esp32/docs/HARDWARE_WIRING_MAP.md`
     - `docs/ESP32_GPIO_PIN_MAP.md` & `esp32/docs/ESP32_GPIO_PIN_MAP.md`
     - `docs/COMPONENT_PIN_MAP.md` & `esp32/docs/COMPONENT_PIN_MAP.md`
     - `docs/HARDWARE_INVENTORY.md` & `esp32/docs/HARDWARE_INVENTORY.md`
     - `docs/HARDWARE_WIRING_CHECKLIST.md` & `esp32/docs/HARDWARE_WIRING_CHECKLIST.md`
     - `docs/ESP32_PERIPHERAL_VISUAL_MAP.md` & `esp32/docs/ESP32_PERIPHERAL_VISUAL_MAP.md`
     - `docs/ESP32_PERIPHERAL_MAP.mmd` & `esp32/docs/ESP32_PERIPHERAL_MAP.mmd`
     - `docs/ESP32_PERIPHERAL_MAP.html` & `esp32/docs/ESP32_PERIPHERAL_MAP.html`
     - `esp32/docs/ESP32_ASSEMBLY_GUIDE.md`
   - Validated Mermaid syntax using `@mermaid-js/mermaid-cli` (PASS).

## Repository Status
- Firmware Pin Matrix: **26/26 pins match identically** with `pin_config.h` (Zero pin changes in SP-HW-010).
- Target Hardware: ESP32-S3-WROOM-1-N16R8.
- Dual-core architecture: Enabled (Network on Core 0, Control/Safety/Buttons on Core 1).
- Button HAL: 40ms debounce, event-driven to `panel_button_mgr`.
- Actuator status: **100% SAFE OFF**.

## Next Action for Next Agent / Operator
1. **Physical Flashing / Hardware Bring-up (when USB COM3 reconnected)**:
   Flash firmware:
   `& "D:\Espressif-tool\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe" -m esptool --chip esp32s3 -p COM3 -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m 0x0 build/bootloader/bootloader.bin 0x8000 build/partition_table/partition-table.bin 0xf000 build/ota_data_initial.bin 0x20000 build/agrotech_esp32.bin`
2. **Field Verification**:
   - Press Button 1 (GPIO 0): Verify TFT cycles screens (Diagnostics $\to$ Sensors $\to$ Actuators $\to$ Network/Time).
   - Press Button 2 (GPIO 39): Verify Well Pump turns ON and auto-shuts OFF after 5 minutes, or turns OFF immediately upon second press.
   - Verify that when lower float switch indicates DRY (GPIO 38 = 0) or E-Stop is triggered, Button 2 cannot turn ON the Well Pump.
   - Press Buttons 3 & 4 (GPIO 40, 41): Verify events are logged as RESERVED without unwanted actuator triggers.
