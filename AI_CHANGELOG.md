# AI CHANGELOG

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
- SP-003: Hardware abstraction & safe boot (HAL drivers for actuators, flow meters, temperature, floats, and buttons).

---

## 2026-09-13 — SP-001 Repository discovery, contract canonicalization & baseline verification
Safe Point: SP-001
Status: COMPLETE

Summary:
- Established canonical shared API contract directory at `template/contracts/UI_ESP32_OPENAPI.yaml`.
- Resolved 4 pre-existing TypeScript errors in UI without modifying layout or visual design.
- Aligned `src/lib/api/contracts.ts` and `src/lib/api/esp32-client.ts` with canonical OpenAPI endpoints (crop-cycle, health, status, inventory, clock sync, commands).
- Enabled generic typing on `apiDelete` in `backend-client.ts` and aligned `hardware-gateway.ts` clock synchronization fallback.
- Successfully verified `npm run build` (`tsc -b && vite build`) passes with zero errors and generated singlefile bundle.

Files:
- `contracts/UI_ESP32_OPENAPI.yaml`
- `src/app/range-types.ts`
- `src/components/ui/crop-cycle/CycleHistoryModal.tsx`
- `src/app/schedule/page.tsx`
- `src/app/greenhouse/[ghId]/page.tsx`
- `src/app/page.tsx`
- `src/lib/api/contracts.ts`
- `src/lib/api/esp32-client.ts`
- `src/lib/api/backend-client.ts`
- `src/lib/api/hardware-gateway.ts`
- `AI_PROGRESS.md`
- `AI_HANDOVER.md`
- `AI_CHANGELOG.md`

Verification:
- `npm run build`: PASS (0 errors, singlefile build output generated in dist/)

Next:
- SP-002: ESP32 project foundation in `template/esp32/`

---

## 2026-09-13 — Safe-point system created
Safe Point: PRE-SP-001

Summary:
- Created durable cross-agent handover protocol.
- Added persistent project rules.
- Added progress, handover, decisions, and changelog files.
- Designed the workflow so Gemini account/model changes do not require conversation-memory continuity.

Files:
- `GEMINI.md`
- `AI_PROGRESS.md`
- `AI_HANDOVER.md`
- `AI_DECISIONS.md`
- `AI_CHANGELOG.md`

Verification:
- Documentation package generated successfully.

Next:
- Agent performs repository discovery and creates SP-001.
