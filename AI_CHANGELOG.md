# AI CHANGELOG

## 2026-09-13 — SP-003 Hardware abstraction and safe boot created
Safe Point: SP-003
Status: COMPLETE

Summary:
- Implemented `actuator_hal` with 7 output channels, fail-safe boot, Emergency Stop hardware latch, and tank-full interlock.
- Implemented `sensor_hal` with ISR edge pulse counting for flow meters (YF-B1, FS400A), 1-Wire DS18B20 temperature driver, and digital float switch polling.
- Implemented `button_hal` with debouncing for 4 physical operator buttons.
- Implemented `hardware_registry` unifying all 15 hardware components with safety classifications matching OpenAPI specifications.
- Registered HAL sources in CMake and hooked into `app_main`.

Files:
- `esp32/main/hal/actuator_hal.h`
- `esp32/main/hal/actuator_hal.c`
- `esp32/main/hal/sensor_hal.h`
- `esp32/main/hal/sensor_hal.c`
- `esp32/main/hal/button_hal.h`
- `esp32/main/hal/button_hal.c`
- `esp32/main/hal/hardware_registry.h`
- `esp32/main/hal/hardware_registry.c`
- `esp32/main/main.c`
- `esp32/main/CMakeLists.txt`
- `AI_PROGRESS.md`
- `AI_HANDOVER.md`
- `AI_CHANGELOG.md`

Verification:
- HAL drivers, mutex thread-safety & registration: PASS
- UI regression test (`npm run build`): PASS (0 errors)

Next:
- SP-004: Durable storage & recovery (NVS configuration manager & SPIFFS/SD manager).

---

## 2026-09-13 — SP-002 ESP32 project foundation created
Safe Point: SP-002
Status: COMPLETE

Summary:
- Initialized official ESP32 firmware project under `template/esp32/`.
- Configured root `CMakeLists.txt` and `main/CMakeLists.txt` for ESP-IDF v5.x.
- Added custom partition table `partitions.csv` with dual 3MB OTA and 9MB storage partition.
- Configured `sdkconfig.defaults` for ESP32-S3 (PSRAM Octal, 240MHz, FreeRTOS, HTTP server, mDNS).
- Established centralized pin registry `main/config/pin_config.h` matching canonical hardware baseline.
- Created `main/main.c` entry point featuring safe actuator boot lock, system diagnostics, and NVS initialization.

Files:
- `esp32/CMakeLists.txt`
- `esp32/partitions.csv`
- `esp32/sdkconfig.defaults`
- `esp32/main/CMakeLists.txt`
- `esp32/main/config/pin_config.h`
- `esp32/main/config/system_config.h`
- `esp32/main/main.c`
- `AI_PROGRESS.md`
- `AI_HANDOVER.md`
- `AI_CHANGELOG.md`

Verification:
- Project structure & CMake syntax: PASS
- Header file integrity: PASS
- UI regression test (`npm run build`): PASS (0 errors)

Next:
- SP-003: Hardware abstraction & safe boot.

---

## 2026-09-13 — SP-001 Repository discovery, contract canonicalization & baseline verification
Safe Point: SP-001
Status: COMPLETE

Summary:
- Established canonical shared API contract directory at `template/contracts/UI_ESP32_OPENAPI.yaml`.
- Resolved 4 pre-existing TypeScript errors in UI without modifying layout or visual design.
- Aligned `src/lib/api/contracts.ts` and `src/lib/api/esp32-client.ts` with canonical OpenAPI endpoints.
- Enabled generic typing on `apiDelete` in `backend-client.ts`.
- Verified `npm run build` passes with zero errors.

Next:
- SP-002: ESP32 project foundation in `template/esp32/`
