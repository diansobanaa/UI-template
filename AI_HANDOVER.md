# AI HANDOVER

## Last Safe Point
SP-006 (COMPLETE) — Runtime, commands, scheduling, and safety.

## State
The runtime execution engine is active in `template/esp32/main/services/`:
1. `command_mgr`: Asynchronous FreeRTOS worker queue, idempotency by `commandId`, status caching.
2. `safety_monitor`: Periodic background safety loop protecting against pump dry-run and high water temperatures.
3. `scheduler`: Schedule runner skeleton.

## What the next agent must do
1. Read `GEMINI.md`.
2. Read `AI_PROGRESS.md`.
3. Inspect `git status` / latest commit.
4. Begin **SP-007**: Crop-cycle / Masa Tanam engine & persistence.
   - Dedicated crop cycle service (`crop_cycle_mgr`) with state machine validation:
     * Disallow starting active cycle when one is already active (HTTP 409).
     * Pollination date must be >= planting date.
     * Persist current cycle and harvest records to NVS / SPIFFS.
     * Recompute HST/HSP upon reboot or date update.

## Do not assume
- HST and HSP are never stored as manual inputs; always recompute from target date and device RTC.
