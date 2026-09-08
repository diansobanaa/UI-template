# UI Hardware API Port

This document defines the frontend boundary for the Python service and the ESP32 REST API. The UI does not access GPIO concepts directly; it consumes inventory, capabilities, configuration, telemetry, events, and command receipts.

## Runtime policy

1. Python is the preferred source for identity, history, analytics, configuration orchestration, and server time.
2. ESP32 is the authority for hardware runtime, actuator safety, inventory, and final command acceptance.
3. If Python is unavailable and direct ESP32 mode is enabled, the UI falls back to ESP32 REST for inventory, configuration, telemetry, logs, clock sync, and emergency stop.
4. A direct ESP32 URL must be reachable from the browser through the local network or VPN. Internet access alone does not make a private ESP32 address reachable.
5. The UI keeps the last received snapshot and must show stale/offline state; it must never silently present a failed request as fresh data.

## Environment

Copy `.env.example` to the environment used by Vite:

```text
VITE_PYTHON_API_BASE=http://localhost:8000/api/v1
VITE_ESP32_API_BASE=http://192.168.1.50
VITE_ENABLE_DIRECT_ESP32=false
VITE_API_TIMEOUT_MS=8000
VITE_API_TOKEN=
```

Tokens are placeholders only. Production authentication must use a short-lived session token or an approved device-scoped credential. Never commit a production secret into a Vite bundle.

## Python endpoints

```text
GET  /complexes/{complexId}/sync-snapshot
GET  /complexes/{complexId}/esp32/inventory
GET  /complexes/{complexId}/esp32/configuration
POST /complexes/{complexId}/esp32/configuration/validate
PUT  /complexes/{complexId}/esp32/configuration
GET  /complexes/{complexId}/telemetry?ghId={greenhouseId}
GET  /complexes/{complexId}/events?cursor={cursor}
POST /complexes/{complexId}/esp32/sync
POST /complexes/{complexId}/esp32/clock-sync
POST /complexes/{complexId}/esp32/emergency-stop
```

## Direct ESP32 endpoints

```text
GET  /api/v1/inventory
GET  /api/v1/configuration
POST /api/v1/configuration/validate
PUT  /api/v1/configuration
GET  /api/v1/telemetry?ghId={greenhouseId}
GET  /api/v1/events?cursor={cursor}
GET  /api/v1/commands/{commandId}
DELETE /api/v1/commands/{commandId}
POST /api/v1/clock-sync
POST /api/v1/commands/emergency-stop
```

## Inventory and configuration rules

The inventory JSON follows `HARDWARE_MAPPING.md`: stable `component_id`, type, role, scope, GH mapping, status, enabled flag, required flag, safety class, capabilities, and runtime state.

Inventory changes do not automatically activate hardware configuration. The UI displays newly reported components as available and creates empty/default configuration where appropriate. Before saving or activating configuration, the UI calls validation. ESP32 must repeat validation and retain `LAST_VALID_CONFIGURATION` when validation fails.

## Shared dosing model

Central dosing pumps are shared resources. A schedule execution must reserve the selected dosing pump and the target GH path. The GH owns its mixing tank and distribution pump. The route must be validated as:

```text
raw-water tank -> GH raw-water valve -> GH mixing tank
central dosing pump -> dosing valve -> GH mixing tank
GH mixing tank -> GH distribution pump -> plant line
```

The UI may preview collisions, but Python and ESP32 must perform authoritative validation before activation and before actuator start.

## Clock sync

All transport timestamps use UTC ISO-8601. The UI sends the browser timezone only as context. Python should provide the preferred server time; the ESP32 must acknowledge the applied time and report drift/status in its next snapshot.
