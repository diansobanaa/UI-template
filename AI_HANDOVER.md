# AI HANDOVER

## Last Safe Point
SP-001 (COMPLETE) — Repository discovery, compatibility baseline, and contract alignment.

## State
The repository baseline is clean and verified:
1. `template/contracts/UI_ESP32_OPENAPI.yaml` is the canonical shared contract source of truth.
2. Pre-existing TypeScript build errors in the UI have been resolved with zero regressions to visual styling.
3. `src/lib/api/contracts.ts` and `src/lib/api/esp32-client.ts` have been aligned with canonical OpenAPI endpoints and schemas.
4. `npm run build` (`tsc -b && vite build`) executes cleanly with zero errors.

## What the next agent must do
1. Read `GEMINI.md`.
2. Read `AI_PROGRESS.md`.
3. Inspect `git status` / latest commit.
4. Begin **SP-002**: Initialize ESP32-S3 firmware project structure under `template/esp32/`.
   - ESP-IDF CMake project structure (`CMakeLists.txt`, `main/CMakeLists.txt`).
   - `sdkconfig.defaults` targeting ESP32-S3 with PSRAM, FreeRTOS, and HTTP server enabled.
   - Core app entry point (`main/main.c` / `main/main.cpp`).

## Do not assume
- Do not assume physical hardware wiring matches defaults without consulting documentation. Baseline pin assignments must remain centralized in `esp32/main/config/pin_config.h` or equivalent registry.
- Do not bypass canonical contract `template/contracts/UI_ESP32_OPENAPI.yaml`.
