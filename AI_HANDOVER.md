# AI HANDOVER

## Last Safe Point
SP-008 (COMPLETE) — Telemetry/events/logging.

## State
The firmware backend is complete and operational:
1. `telemetry_mgr`: Samples sensors & actuator states periodically, generating sequential snapshots matching `TelemetryResponse`.
2. `event_mgr`: Circular event buffer with persistent storage in `/spiffs/events.log` and paginated JSON retrieval.
3. `sdcard_hal`: Handles microSD on SPI CS GPIO 47 with safe fallback.

## What the next agent must do
1. Read `GEMINI.md`.
2. Read `AI_PROGRESS.md`.
3. Inspect `git status` / latest commit.
4. Begin **SP-009**: Existing UI ↔ ESP32 integration.
   - Connect UI service layer (`src/lib/services.ts` and `src/lib/api/hardware-gateway.ts`) so when `VITE_ESP32_API_BASE` is provided (direct mode), the UI queries and mutates real ESP32 endpoints directly.
   - Replace synthetic mock timers in direct mode with authoritative ESP32 status and HST/HSP.
   - Keep UI visual components untouched; modify only the service/adapter boundary.

## Do not assume
- Never change UI visual styling, component hierarchies, or user-facing labels.
