# AI HANDOVER

## Last Safe Point
SP-005 (COMPLETE) — REST API contract implementation.

## State
The REST API layer is fully implemented in `template/esp32/main/http/`:
1. `http_server`: Starts `esp_http_server` on port 80, attaches CORS headers to all responses, handles OPTIONS preflight, provides structured error JSON.
2. All canonical endpoints from `template/contracts/UI_ESP32_OPENAPI.yaml` are registered:
   - Device: `/api/v1/health`, `/api/v1/status`, `/api/v1/inventory`, `/api/v1/capabilities`, `/api/v1/context`, `/api/v1/clock`, `/api/v1/clock-sync`
   - Configuration: `GET /api/v1/configuration`, `PUT /api/v1/configuration`, `POST /api/v1/configuration/validate`
   - Commands: `POST /api/v1/commands`, `GET /api/v1/commands/{commandId}`, `POST /api/v1/commands/emergency-stop`
   - Crop Cycle: full set of 11 endpoints with authoritative device-time HST/HSP calculation
   - Telemetry & Events: `/api/v1/telemetry`, `/api/v1/events`

## What the next agent must do
1. Read `GEMINI.md`.
2. Read `AI_PROGRESS.md`.
3. Inspect `git status` / latest commit.
4. Begin **SP-006**: Runtime execution engine, FreeRTOS command dispatcher, scheduling, and safety monitor.
   - Implement command manager task (`cmd_manager`) with FreeRTOS queue and `commandId` idempotency cache.
   - Implement scheduler service for periodic well pump and fertigation runs.
   - Implement background safety task monitoring sensor limits and timeout conditions.

## Do not assume
- Do not bypass `actuator_hal` interlocks.
- Keep HTTP handlers fast by offloading long-running commands to FreeRTOS queues.
