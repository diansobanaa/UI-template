# AI HANDOVER

## Last Safe Point
SP-002 (COMPLETE) — ESP32 project foundation in `template/esp32/`.

## State
The ESP32 project foundation is established:
1. Canonical location `template/esp32/` is active with ESP-IDF CMake files (`CMakeLists.txt`, `main/CMakeLists.txt`).
2. Partition table `partitions.csv` and `sdkconfig.defaults` for ESP32-S3 (PSRAM, FreeRTOS, HTTP server, mDNS) configured.
3. Centralized pin registry `template/esp32/main/config/pin_config.h` holds all GPIO mappings.
4. Entry point `template/esp32/main/main.c` enforces fail-safe boot with all actuator pins initialized to OFF state.

## What the next agent must do
1. Read `GEMINI.md`.
2. Read `AI_PROGRESS.md`.
3. Inspect `git status` / latest commit.
4. Begin **SP-003**: Hardware abstraction & safe boot.
   - Implement HAL drivers under `template/esp32/main/hal/` (actuator driver, pulse counter flow meters for YF-B1 & FS400A, 1-Wire DS18B20 temperature sensor, float switches, and button debounce).
   - Ensure actuators have software interlocks (emergency stop latch, raw water tank full interlock).

## Do not assume
- Do not hardcode GPIO pins in individual driver files; always include `<config/pin_config.h>`.
- Do not assume physical relay trigger polarity without datasheet verification (`VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION`).
