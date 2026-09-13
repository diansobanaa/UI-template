# AI HANDOVER

## Last Safe Point
SP-004 (COMPLETE) — Durable storage and recovery.

## State
The Durable Storage & Recovery subsystem is implemented in `template/esp32/main/storage/`:
1. `storage_mgr`: Persists device identity (`deviceId`, `complexId`), generates fresh `bootId` on each boot, increments `bootCount`.
2. Persists Last Valid Configuration (LVC) in NVS with CRC32 checksum verification.
3. Mounts `/spiffs` storage partition with rotation-safe event log persistence (`/spiffs/events.log`).

## What the next agent must do
1. Read `GEMINI.md`.
2. Read `AI_PROGRESS.md`.
3. Inspect `git status` / latest commit.
4. Begin **SP-005**: REST API contract implementation.
   - Implement HTTP REST server in `template/esp32/main/http/` using `esp_http_server`.
   - Register exact endpoints from `contracts/UI_ESP32_OPENAPI.yaml`.
   - Implement JSON DTO serializing/deserializing with cJSON for:
     - `/api/v1/health`
     - `/api/v1/status`
     - `/api/v1/inventory`
     - `/api/v1/capabilities`
     - `/api/v1/context`
     - `/api/v1/clock` & `/api/v1/clock-sync`
     - `/api/v1/configuration` & `/api/v1/configuration/validate`
     - `/api/v1/commands` & `/api/v1/commands/emergency-stop`
     - `/api/v1/greenhouses/{ghId}/crop-cycle` & crop cycle mutations
     - `/api/v1/telemetry`
     - `/api/v1/events`
   - Implement CORS headers, `requestId` propagation, and standard HTTP error response format.

## Do not assume
- Never rename routes or field names from `contracts/UI_ESP32_OPENAPI.yaml`.
- Always return CORS headers on every response (including error responses and `OPTIONS` preflight).
