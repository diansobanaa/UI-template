# AI HANDOVER

## Last Safe Point
SP-003 (COMPLETE) — Hardware abstraction and safe boot.

## State
The Hardware Abstraction Layer is implemented and registered in `template/esp32/main/hal/`:
1. `actuator_hal`: Controls 7 outputs with immediate safe-off boot, Emergency Stop latch, and raw water tank full interlock.
2. `sensor_hal`: Flow meter ISR pulse counters (YF-B1 & FS400A), DS18B20 1-Wire temperature, and float switch.
3. `button_hal`: Debounced physical buttons with callback support.
4. `hardware_registry`: Unified catalog of 15 hardware components matching OpenAPI inventory schemas.

## What the next agent must do
1. Read `GEMINI.md`.
2. Read `AI_PROGRESS.md`.
3. Inspect `git status` / latest commit.
4. Begin **SP-004**: Durable storage & recovery.
   - Implement storage subsystem in `template/esp32/main/storage/` (NVS manager for Last Valid Configuration, device identity, version hashing, and SPIFFS/SD file logging).
   - Ensure reboot safety policy: recover last valid configuration and verify version match.

## Do not assume
- Do not bypass `actuator_hal_set()` when driving physical outputs.
- Never write unvalidated JSON directly to persistent flash.
