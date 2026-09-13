# AI HANDOVER

## Last Safe Point
SP-AUDIT-001 (COMPLETE) — UI ↔ ESP32 Deep Blindspot Audit Complete.

## State
A comprehensive pre-flash, pre-assembly blindspot audit was executed across the entire repository. Zero production code was altered. All 30 findings (6 CRITICAL, 14 HIGH, 8 MEDIUM, 1 LOW, 1 INFORMATIONAL) are fully documented with file-level evidence, failure scenarios, and recommended investigations in:
1. `template/docs/AI_BLINDSPOT_FINDINGS_INDEX.md`
2. `template/docs/AI_BLINDSPOT_AUDIT_REPORT_V1.md`

## Critical Warnings Before Next Agent / Operator Proceeds
DO NOT FLASH FIRMWARE OR ASSEMBLE HARDWARE BEFORE ADDRESSING THE FOLLOWING CRITICAL BLINDSPOTS:
1. **Pin Collision on GPIO 19 (`BS-HW-001`)**: GPIO 19 is native USB D- on ESP32-S3. Connecting the lower float switch to GPIO 19 will kill native USB communication. Move float switch to an unreserved pin.
2. **Pin Collision on GPIO 47 (`BS-HW-002`)**: GPIO 47 is occupied by embedded Octal PSRAM on the N16R8 module. Driving GPIO 47 for MicroSD CS causes CPU cache crash. Move MicroSD CS.
3. **Network Driver Missing (`BS-NET-001`)**: Firmware lacks Wi-Fi or W5500 SPI Ethernet initialization in `main.c`. Device boots with no network reachability.
4. **Active-Low Relay Safe Boot Inversion (`BS-HW-004`)**: If the physical relay board is active-low, driving GPIO LOW on safe boot turns all 7 pump/fan channels ON during boot. Verify physical board polarity.
5. **Volatile Emergency Stop Latch (`BS-SAFE-001`)**: Emergency stop latch is lost on reboot/brownout.

## What the next agent / operator must do
1. Read `template/docs/AI_BLINDSPOT_AUDIT_REPORT_V1.md` and `AI_PROGRESS.md`.
2. Resolve the 3 items marked `REQUIRES DECISION`:
   - Reassign GPIO 19 and GPIO 47 in `pin_config.h` and `ESP32_ASSEMBLY_GUIDE.md`.
   - Decide between OpenAPI Envelope structure vs Flat JSON structure (`BS-CONT-001`).
   - Define multi-greenhouse valve and routing architecture (`BS-TOP-001`).
3. Implement Phase 1 & 2 remediations before physical wiring and flashing.
4. Run `npm test` and `npm run build` after any modifications.
