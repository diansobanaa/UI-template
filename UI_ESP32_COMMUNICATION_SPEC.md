# UI ↔ ESP32 COMMUNICATION SPECIFICATION
## Canonical Contract — MVP Local WLAN, Direct Browser ↔ ESP32

**Status:** Canonical implementation contract for MVP  
**Scope:** Single HTML Vite Web App ↔ ESP32-S3 local controller  
**Transport:** HTTP/JSON over local WLAN/LAN  
**Security MVP:** no authentication; trusted local network  
**Internet:** not required  
**Python:** future persistence/data layer; not a prerequisite for the UI↔ESP32 operational path

---

# 1. Purpose

This document is the **canonical communication contract between the existing UI and ESP32**.

The goal is not merely to define generic REST endpoints. Every UI action that is supposed to communicate with ESP32 must have:

- exact endpoint;
- HTTP method;
- path parameters;
- request payload;
- response payload;
- error contract;
- state transition;
- source of truth;
- retry/idempotency behavior.

The UI must not invent a second data model that differs from ESP32.

The ESP32 must not return a generic payload that requires the UI to guess field meaning.

The contract must be machine-checkable and represented in the companion OpenAPI file:

`UI_ESP32_OPENAPI.yaml`

---

# 2. Architecture Boundary

```text
PC / HP
└── Single HTML Vite App
        │
        │ HTTP REST / JSON
        │
        ▼
Local WLAN / LAN
        │
        ▼
ESP32-S3
└── Runtime + Hardware + Local State + Local Logs
```

ESP32 is the physical/runtime authority.

The UI is:
- presentation;
- user interaction;
- request initiator;
- response/state renderer;
- cache/orchestration layer.

The UI is not:
- physical actuator authority;
- device scheduler;
- permanent historical database;
- replacement for ESP32 runtime.

This preserves the project rule that HTTP success means request handling/acceptance, not physical completion. Physical completion comes from ESP32 state, command status, telemetry, or event. fileciteturn11file3L545-L550

---

# 3. Current Scope vs Future Python

## 3.1 Direct UI ↔ ESP32 MVP

The direct ESP32 contract covers:

- device discovery/connection;
- system topology pool discovery, replication, and mutations (`/api/v1/topology-pool`, `/meta`, `/sync`, `/mutate`);
- health;
- status;
- inventory;
- capabilities;
- clock;
- runtime/device commands;
- emergency stop/resume;
- crop-cycle / Masa Tanam runtime state;
- crop-cycle history/event retrieval;
- telemetry;
- event/log retrieval;
- configuration snapshot/version;
- device-side configuration operations that are explicitly approved for MVP.

## 3.2 Python-owned domains

The following remain Python-owned and are NOT moved to ESP32:

- permanent cross-complex history and longitudinal analytics;
- permanent research trial records (`crop_cycles`, `plants`, `fruits`, `observations`) preserved permanently across Complex deletions;
- deletion saga orchestration and cross-domain cleanup;
- multi-complex aggregation and external ecosystem sync.
Topology itself is replicated in the System Topology Pool with ESP32 as operational authority for complexes it owns.
- permanent research history;
- Plant/Fruit/Observation/Harvest permanent database;
- analytics;
- long-term archive;
- cross-Complex analysis.

The UI may later use Python APIs for these without changing visual UX.

---

# 4. One Canonical API Client

No page/component may call `fetch()` directly.

Required architecture:

```text
UI component
   ↓
domain service / application hook
   ↓
ESP32 API client
   ↓
central HTTP transport
   ↓
ESP32
```

This follows the existing frontend architecture rule that components should not contain raw fetch logic. fileciteturn11file4L612-L630

The UI must have exactly one transport implementation for ESP32 requests.

Recommended logical modules:

```text
src/lib/api/
  esp32-client.ts
  esp32-contracts.ts
  transport.ts
  connection-manager.ts
```

---

# 5. Static Vite Deployment Requirement

Because the target is a Vite build opened on PC/HP without an application server, the UI build must explicitly support the chosen deployment mode.

## Preferred

Generate a browser-loadable static bundle that does not require Python.

For true direct `file://` opening, use a single-file/bundled deployment mode or provide a documented local static-server fallback.

The communication contract must not assume `localhost:8000`.

The UI must treat ESP32 URL as runtime configuration.

Minimum runtime configuration:

```json
{
  "esp32": {
    "hostname": "esp32-complex-001.local",
    "lastKnownIp": "<ESP32_IP>",
    "port": 80
  }
}
```

Do not duplicate the ESP32 address across components.

---

# 6. Browser → ESP32 Network Contract

MVP:

```text
Internet = not required
Authentication = none
HTTPS = none
HTTP = required
CORS = required
```

ESP32 must handle browser CORS including:

```text
Origin: null
```

for direct local-file usage when the browser sends it.

Allow required methods:

```text
GET
POST
PUT
PATCH
DELETE
OPTIONS
```

Only methods actually used by the contract need to be enabled.

---

# 6A. Local Setup / Direct Local Network Mode

The ESP32 exposes a small embedded setup UI only while factory provisioning or temporary Direct Local Mode is active. This UI is network configuration only and is not a physical-control surface.

Endpoints:

```text
GET  /setup
GET  /setup/api/status
GET  /setup/api/scan
POST /setup/api/connect
POST /setup/api/finish
```

Configured-controller Direct Local entry is controlled by the panel gesture contract:

```text
2× Button 4 = force immediate configured-router connection attempt
3× Button 4 = toggle temporary Direct Local AP
```

Configured controllers keep this SoftAP OFF during normal operation and retry the configured router indefinitely every 50 seconds. Network loss itself does not activate the SoftAP.

Direct Local AP behavior:

```text
no client for 3 minutes → SoftAP OFF
last client disconnects → 1 minute → SoftAP OFF
connected client → timeout cancelled
```

Wi-Fi replacement is non-destructive: the candidate credential is tested live and committed only after a successful `IP_EVENT_STA_GOT_IP`. The previous credential, `device_id`, Complex relationship, and operational configuration remain intact on failure.

The setup UI reports the persistent `deviceId` and existing Complex relationship. It must not ask the operator to type `complex_id`, create a Complex, bind a controller, or execute actuator commands.

Wi-Fi change uses a candidate transaction: live STA connection is tested first, then `sta_ssid` / `sta_pass` are atomically committed only after a verified `IP_EVENT_STA_GOT_IP`.

# 7. Device Discovery

## 7.1 Primary

Use stable mDNS hostname:

```text
esp32-<device-id>.local
```

Example:

```text
esp32-complex-001.local
```

## 7.2 Browser limitation

The browser must not depend on raw mDNS service enumeration being universally available.

Therefore the UI connection manager uses:

```text
1. configured hostname
2. last-known IP
3. manual endpoint fallback
```

After connecting, verify:

```text
deviceId
complexId
apiVersion
schemaVersion
```

The discovered address is transport information; `deviceId` is identity.

---

# 8. Device Connection State

The UI must distinguish:

```text
DISCONNECTED
DISCOVERING
CONNECTING
ONLINE
STALE
SYNCING
ERROR
```

`ONLINE` means a current successful health/status exchange.

`STALE` means the last known device data exists but cannot currently be refreshed.

Never display cached state as current truth.

This follows the project rule that a stale value must never be presented as current truth. fileciteturn11file0L217-L223

---

# 9. Request/Response Envelope

## 9.1 Request

For mutating requests:

```json
{
  "requestId": "req-uuid",
  "client": {
    "type": "web-ui",
    "version": "ui-version"
  },
  "payload": {}
}
```

## 9.2 Response

```json
{
  "requestId": "req-uuid",
  "success": true,
  "data": {},
  "error": null,
  "deviceTimestamp": "2026-09-13T03:30:00+07:00"
}
```

For command-style operations:

```json
{
  "requestId": "req-uuid",
  "success": true,
  "data": {
    "commandId": "cmd-uuid",
    "status": "ACCEPTED"
  },
  "error": null,
  "deviceTimestamp": "..."
}
```

The UI must use `requestId` for transport correlation and `commandId` for physical operation correlation.

---

# 10. Error Envelope

```json
{
  "requestId": "req-uuid",
  "success": false,
  "data": null,
  "error": {
    "code": "CYCLE_ALREADY_ACTIVE",
    "message": "Greenhouse already has an active crop cycle.",
    "retryable": false,
    "reconcileRequired": false,
    "details": {}
  },
  "deviceTimestamp": "..."
}
```

The UI retains the technical error code but displays a readable Indonesian message.

---

# 11. HTTP Status Semantics

| HTTP | Meaning |
|---|---|
| 200 | successful read/update with complete response |
| 201 | resource/event created |
| 202 | accepted for asynchronous command |
| 204 | successful deletion when no body is required |
| 400 | malformed request |
| 404 | unknown device/resource |
| 409 | version/state conflict |
| 422 | semantic validation failure |
| 429 | resource busy / rate limit |
| 500 | firmware internal error |
| 503 | temporarily unavailable/degraded |

---

# 12. Health

```http
GET /api/v1/health
```

UI expects:

```json
{
  "apiVersion": "1",
  "schemaVersion": 1,
  "deviceId": "esp32-complex-001",
  "complexId": "complex-001",
  "firmwareVersion": "0.1.0",
  "bootId": "boot-...",
  "uptimeSec": 1234,
  "deviceTimestamp": "...",
  "timezone": "Asia/Jakarta",
  "configurationVersion": 1,
  "inventoryVersion": 1,
  "runtimeState": "IDLE",
  "health": "OK"
}
```

---

# 13. Full Status

```http
GET /api/v1/status
```

The response must be a coherent device snapshot containing:

```text
device
network
clock
configuration
inventory
runtime
actuators
sensors
storage
safety
cropCycle
queue
sync
```

The UI uses this endpoint to refresh its authoritative operational context.

---

# 14. Inventory

```http
GET /api/v1/inventory
```

The UI uses inventory for:
- detected hardware;
- equipment page;
- component selection;
- hardware sync;
- validation of available actions.

Inventory must contain stable component IDs.

Example:

```json
{
  "deviceId": "esp32-complex-001",
  "complexId": "complex-001",
  "inventoryVersion": 1,
  "components": [
    {
      "componentId": "well-pump",
      "scope": "COMPLEX",
      "type": "ACTUATOR",
      "role": "WELL_PUMP",
      "enabled": true,
      "capabilities": ["START", "STOP"]
    }
  ]
}
```

Do not expose raw GPIO as the UI's control contract.

---

# 15. Capabilities

```http
GET /api/v1/capabilities
```

Capabilities tell the UI what the firmware can actually do.

The UI must hide/disable actions that are not supported.

---

# 16. Clock

```http
GET  /api/v1/clock
POST /api/v1/clock-sync
```

The UI may send an authoritative timestamp/timezone during synchronization.

The ESP32 owns runtime time after synchronization.

---

# 17. Actual vs Desired Physical State

Where applicable:

```json
{
  "desiredState": "ON",
  "actualState": "OFF",
  "stateReason": "SAFETY_INTERLOCK"
}
```

The UI renders actual state as truth.

A successful request must not overwrite actual-state UI optimistically unless the response itself contains the new actual state.

---

# 18. Generic Command API

```http
POST /api/v1/commands
GET  /api/v1/commands/{commandId}
```

Generic commands use semantic operations, for example:

```json
{
  "requestId": "req-1",
  "client": {"type": "web-ui", "version": "1.0.0"},
  "payload": {
    "type": "START_COMPONENT",
    "componentId": "well-pump",
    "parameters": {}
  }
}
```

Never expose:

```text
POST /gpio
```

The existing project architecture explicitly favors semantic component/action requests instead of raw GPIO values. fileciteturn11file0L47-L70

---

# 19. Emergency Stop

```http
POST /api/v1/commands/emergency-stop
```

Request:

```json
{
  "requestId": "req-...",
  "client": {"type": "web-ui", "version": "1.0.0"},
  "payload": {
    "commandId": "cmd-...",
    "reason": "operator"
  }
}
```

Response includes command/safety state.

UI then refreshes `/status`.

Emergency stop state is device-owned.

---

# 20. Crop Cycle / Masa Tanam — Direct UI ↔ ESP32 Contract

This is part of the **current UI↔ESP32 MVP**, because the existing UI explicitly performs these actions against the ESP32 boundary. The existing UX specification requires the UI to send planting, pollination, date changes, harvest, and recovery/reconnect behavior through ESP32. fileciteturn12file3L278-L305 fileciteturn12file6L561-L575

The active cycle belongs to a GH.

One GH may have at most one active cycle.

---

# 21. Crop Cycle Representation

Canonical current-cycle object:

```json
{
  "cycleId": "cycle-uuid",
  "ghId": "gh-001",
  "status": "ACTIVE",
  "tanggalTanam": "2026-09-01",
  "tanggalPolinasi": null,
  "variety": "Melon",
  "plantCount": 580,
  "notes": "",
  "hst": 12,
  "hsp": null,
  "lastUpdatedAt": "...",
  "version": 3
}
```

Rules:

- `cycleId` is stable.
- `ghId` is immutable for the cycle.
- `tanggalTanam` is required.
- `tanggalPolinasi` may be null.
- HST/HSP are never user-editable fields.
- ESP32 stores/reconciles the derived counters from authoritative dates + device time.
- UI may calculate preview values locally before submit, but after a successful mutation the authoritative displayed values must come from ESP32 response/state.
- `hsp = null` when no pollination date exists.
- HST starts at 0 on `tanggalTanam`.

This reconciles the project requirement that the user manages dates/events rather than manually editing HST/HSP. fileciteturn12file5L454-L481

---

# 22. Get Current Cycle

```http
GET /api/v1/greenhouses/{ghId}/crop-cycle
```

Response:

```json
{
  "ghId": "gh-001",
  "cycle": null,
  "deviceTimestamp": "..."
}
```

or:

```json
{
  "ghId": "gh-001",
  "cycle": {
    "cycleId": "cycle-001",
    "status": "ACTIVE",
    "tanggalTanam": "2026-09-01",
    "tanggalPolinasi": null,
    "variety": "Melon",
    "plantCount": 580,
    "notes": "",
    "hst": 12,
    "hsp": null,
    "version": 1
  },
  "deviceTimestamp": "..."
}
```

---

# 23. Start Normal Cycle

UI fields:

```text
tanggalTanam       required
variety            optional
plantCount         optional
notes              optional
```

Endpoint:

```http
POST /api/v1/greenhouses/{ghId}/crop-cycles
```

Request:

```json
{
  "requestId": "req-...",
  "payload": {
    "tanggalTanam": "2026-09-13",
    "variety": "Melon",
    "plantCount": 580,
    "notes": ""
  }
}
```

ESP32:
1. validates no active cycle;
2. validates date;
3. creates cycle;
4. persists cycle;
5. creates event;
6. returns the complete resulting cycle.

Response:

```json
{
  "requestId": "req-...",
  "success": true,
  "data": {
    "cycle": {}
  },
  "error": null,
  "deviceTimestamp": "..."
}
```

---

# 24. Start Ongoing Cycle

The existing UI has a separate flow for a crop cycle that already started before the device/client was introduced. The UI collects tanggal tanam, variety, plant count, optional pollination date, and notes. fileciteturn16file2L260-L286

Endpoint:

```http
POST /api/v1/greenhouses/{ghId}/crop-cycles/import-active
```

Request:

```json
{
  "requestId": "req-...",
  "payload": {
    "tanggalTanam": "2026-09-01",
    "variety": "Melon",
    "plantCount": 580,
    "tanggalPolinasi": null,
    "notes": "Sistem dipasang di tengah masa tanam"
  }
}
```

ESP32 recomputes current HST/HSP before returning.

---

# 25. Record Pollination

UI input:

```text
tanggalPolinasi
pollinationMethod: natural | bee | manual
notes optional
```

Endpoint:

```http
POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination
```

Request:

```json
{
  "requestId": "req-...",
  "payload": {
    "tanggalPolinasi": "2026-09-20",
    "pollinationMethod": "manual",
    "notes": ""
  }
}
```

Validation:
- cycle must be active;
- pollination date cannot precede planting date;
- returned HSP must be recalculated.

The UI explicitly requires this flow. fileciteturn12file6L537-L559

---

# 26. Update Planting Date

```http
PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/planting-date
```

Request:

```json
{
  "requestId": "req-...",
  "payload": {
    "tanggalTanam": "2026-09-03",
    "expectedVersion": 3
  }
}
```

Response returns the complete resulting cycle.

The UI must show preview before submit and then replace local state with the returned ESP32 state.

---

# 27. Update Pollination Date

```http
PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination
```

Request:

```json
{
  "requestId": "req-...",
  "payload": {
    "tanggalPolinasi": "2026-09-21",
    "pollinationMethod": "manual",
    "expectedVersion": 4
  }
}
```

---

# 28. Delete Pollination Date

```http
DELETE /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination
```

This removes the active pollination date from the current cycle.

It must NOT delete historical event records.

The existing UX explicitly requires the confirmation message that HSP returns to unavailable while historical events are preserved. fileciteturn12file1L80-L91

Response returns the resulting cycle.

---

# 29. Update Cycle Metadata

The existing UI supports:

```text
variety             optional
plantCount          optional
notes               optional
targetHarvestHst    optional
cropTimelineConfig  optional (phases and maintenance points persisted in ESP32 NVS/SPIFFS)
```

Endpoint:

```http
PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}
```

Request:

```json
{
  "requestId": "req-...",
  "payload": {
    "variety": "Melon",
    "plantCount": 575,
    "notes": "...",
    "targetHarvestHst": 75,
    "cropTimelineConfig": {
      "targetHarvestHst": 75,
      "points": [
        { "id": "p1", "name": "Vegetatif", "startHst": 0, "endHst": 25, "note": "Pertumbuhan daun" },
        { "id": "p2", "name": "Generatif", "startHst": 26, "endHst": 50, "note": "Bunga & buah" },
        { "id": "p3", "name": "Pematangan", "startHst": 51, "endHst": 75, "note": "Pematangan buah" }
      ],
      "maintenance": [
        { "id": "m1", "name": "Pemangkasan Tunas", "hst": 14, "category": "Pemangkasan", "note": "Tunas air" },
        { "id": "m2", "name": "Pemberian Kalsium", "hst": 35, "category": "Nutrisi", "note": "Mencegah BER" }
      ]
    }
  },
  "expectedVersion": 5
}
```

---

# 30. Cancel/Reset Active Cycle

Existing UI exposes `onResetCycle()` as a cycle cancellation action. fileciteturn16file4L434-L447

Endpoint:

```http
POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/cancel
```

This must:
- close active runtime cycle;
- preserve event/history;
- return the resulting GH/cycle state.

It must not silently erase history.

---

# 31. Harvest / End Cycle

Existing UI collects:

```text
harvestDate optional
yieldKg optional
grade optional
notes optional
```

fileciteturn16file0L175-L177

Endpoint:

```http
POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/harvest
```

Request:

```json
{
  "requestId": "req-...",
  "payload": {
    "harvestDate": "2026-12-01",
    "yieldKg": 850.5,
    "grade": "Grade A (Super)",
    "notes": "..."
  }
}
```

ESP32:
- records terminal harvest event;
- closes active cycle;
- preserves historical record;
- clears only active-cycle state;
- returns resulting GH state.

The existing UX requires this behavior. fileciteturn12file2L206-L220

---

# 32. Crop Cycle History

UI has a `CycleHistoryModal`.

The API must therefore support read-only history:

```http
GET /api/v1/greenhouses/{ghId}/crop-cycles
```

Optional:

```text
status
fromDate
toDate
limit
cursor
```

Historical entries must not be deleted merely because a new cycle is started.

History is device-local MVP history and is later eligible for UI → Python synchronization.

---

# 33. Crop Cycle Events

Crop-cycle changes must generate events so that the history and later Python sync are not dependent solely on the current snapshot.

Minimum event types:

```text
CROP_CYCLE_CREATED
CROP_CYCLE_IMPORTED
CROP_CYCLE_PLANTING_DATE_CHANGED
CROP_CYCLE_POLLINATION_RECORDED
CROP_CYCLE_POLLINATION_DATE_CHANGED
CROP_CYCLE_POLLINATION_REMOVED
CROP_CYCLE_METADATA_UPDATED
CROP_CYCLE_CANCELLED
CROP_CYCLE_HARVESTED
```

---

# 34. Timeline Masa Tanam

Timeline is a **projection**, not a primary mutable database entity.

The UI timeline is derived from:
- current cycle;
- cycle events;
- configured timeline presentation data.

The API should not create a second competing "HST timeline state" merely for display.

If the UI has custom timeline configuration such as:
- target harvest HST;
- phase ranges;
- notes;

that presentation/configuration must be explicitly classified as UI or Python configuration. It must not silently become physical runtime state.

The existing UI currently persists timeline configuration separately in browser storage, which is a synchronization risk. fileciteturn16file0L42-L66

For production integration, this must be moved behind an explicit ownership decision rather than remaining an undocumented second store.

---

# 35. Complex / GH Context

ESP32 may expose a read-only operational context:

```http
GET /api/v1/context
```

Suggested response:

```json
{
  "complex": {
    "id": "complex-001",
    "name": "Complex A"
  },
  "greenhouses": [
    {
      "id": "gh-001",
      "name": "GH-01",
      "code": "GH-01",
      "status": "ACTIVE"
    }
  ]
}
```

This is a device-bound operational projection, not the permanent Complex/GH master database.

Permanent Complex/GH CRUD remains a Python responsibility.

---

# 36. Telemetry (V2 Pipeline)

### 36.1 Current Snapshot (Pure RAM Fast Path)
```http
GET /api/v1/telemetry/current
```
- **Execution Path:** 100% RAM fast path (`s_snapshot`).
- **Guarantees:** Zero storage I/O, zero filesystem access, zero flash mutex locks.
- **Latency Target:** <20ms (live measured p50: ~61ms on Wi-Fi).
- **Payload:** Latest sequence, values, componentStates, streamMode (`IDLE` vs `PROCESS_ACTIVE`), cadenceSec, and activeTriggers.

### 36.2 Persistent WebSocket Stream
```http
GET /api/v1/telemetry/stream (WebSocket upgrade)
```
- **Connection Model:** One persistent WebSocket connection per UI client controller view.
- **Cadence Rules:**
  - `IDLE`: 10 seconds default batch interval (15s permitted).
  - `PROCESS_ACTIVE` (Dosing pump or raw/well pump active): Immediate snapshot upon active transition, then 3-second cadence stream.
  - `PROCESS_STOP`: Final immediate snapshot upon pump deactivation, returning to 10s cadence.
- **Frame Ownership:** Asynchronous transmission via `httpd_ws_send_data_async()` with bounded owned buffer allocations released via completion callback (`ws_transfer_complete_cb`). Slow clients drop frames without blocking FreeRTOS tasks or HTTP endpoints.

### 36.3 Historical Telemetry (Cursor Paginated)
```http
GET /api/v1/telemetry/history?afterSequence={seq}&limit={count}
```
- **Execution Path:** Deferred persistence log on SD card (`/sdcard/telemetry.jsonl`) or LittleFS/SPIFFS fallback (`/spiffs/telemetry.jsonl`).
- **Concurrency Isolation:** Guarded by dedicated `s_telemetry_mutex`, completely isolated from `s_event_mutex`, `s_sequence_mutex`, and `s_fertigation_mutex`.

---

# 36.4 Authoritative CRUD & Revision-Safe Concurrency

Every topology mutation requires:
- `operationId` (or `changeId`): Client-supplied idempotency key.
- `expectedRevision`: Optimistic concurrency check (integer revision).

Mutation sequence:
1. **Idempotency Check:** If `operationId`/`changeId` was already committed to `s_active_pool->changes`, the ESP32 immediately returns `status: "ALREADY_APPLIED"` with HTTP 200 and the authoritative pool.
2. **Revision Check:** If `expectedRevision != poolRevision`, the request is rejected immediately with HTTP 409 `TOPOLOGY_REVISION_CONFLICT`. The UI performs a targeted fetch of `/api/v1/topology-pool/meta` and reconciles without full-system rehydration.
3. **RAM Mutation & Storage Commit:** Changes are committed to RAM first, persisted durably, and returned directly to the UI.
4. **No Full Hydration:** The UI updates in-memory React state directly from the authoritative mutation response. Full `hydrateOperationalState()` storms are strictly eliminated.

---

# 37. Events and Logs

```http
GET /api/v1/events
```

Cursor/sequence:

```text
afterSequence
limit
```

Response:

```json
{
  "events": [],
  "nextSequence": 1010,
  "hasMore": false
}
```

Event sequence is monotonic per device.

---

# 38. Synchronization Cursor

The UI must persist its last durable sync cursor.

Do not restart from zero after transient failure.

The master architecture explicitly requires resumable synchronization and safe cursor progress. fileciteturn11file0L132-L162

---

# 39. Configuration

Read:

```http
GET /api/v1/configuration
```

Validate:

```http
POST /api/v1/configuration/validate
```

Apply:

```http
PUT /api/v1/configuration
```

Each configuration includes:

```text
configurationVersion
configurationHash
inventoryVersion
schemaVersion
updatedAt
payload
```

The UI must never build a device configuration object by copying the entire UI database.

---

# 40. Configuration Synchronization State

UI state must distinguish:

```text
LOCAL_EDITING
VALIDATING
APPLYING
APPLIED
CONFLICT
REJECTED
UNKNOWN_AFTER_TIMEOUT
```

After timeout:
- do not mark failed immediately;
- read device configuration/status;
- determine whether the version/hash was applied.

---

# 41. Concurrency

For configuration and crop-cycle updates:

```text
expectedVersion
```

must be accepted.

If current device version differs:

```text
409
```

UI must:
1. fetch current device state;
2. show/resolve conflict;
3. rebuild request;
4. retry with the new expected version.

No silent last-write-wins for critical state.

---

# 42. Command Idempotency

Every mutating operation has a stable ID:
- `requestId` for request correlation;
- `commandId` or resource version for physical/state-changing operations.

The UI must be safe to retry after:
- network timeout;
- lost HTTP response;
- browser reconnect.

The project architecture requires repeated delivery not to duplicate history/physical operations. fileciteturn11file0L166-L206

---

# 43. Offline Behavior

## UI offline

If browser cannot reach ESP32:
- do not invent fresh runtime values;
- show stale/unknown state;
- allow non-device-local UI work where safe;
- queue only explicitly supported idempotent synchronization operations.

## ESP32 offline from UI

ESP32 continues independently from its valid local runtime.

The UI reconnects and reconciles.

---

# 44. After ESP32 Reboot

UI detects reboot using `bootId`.

Sequence:

```text
health
 ↓
bootId changed?
 ↓
GET status
 ↓
GET configuration
 ↓
GET current crop cycle/context
 ↓
GET events after saved sequence
 ↓
reconcile UI
```

No browser timer is allowed to reconstruct device runtime.

---

# 45. What the UI Must Remove in Direct Mode

These current mock behaviors must stop being physical truth:

- `startRealtimeMock()`;
- local fertigation/runtime progress clocks;
- local emergency-stop latch;
- local actuator state as authoritative;
- simulated success toasts;
- synthetic current time for device operation.

The code audit explicitly identifies these as current mock/simulation paths and integration risks. fileciteturn13file2L193-L210

---

# 46. Domain-to-ESP32 Matrix

| UI domain/action | Direct ESP32? | Contract |
|---|---:|---|
| Device health/status | YES | `/health`, `/status` |
| Hardware sync | YES | `/inventory`, `/capabilities` |
| Clock sync | YES | `/clock-sync` |
| Physical command | YES | `/commands` |
| Emergency stop | YES | `/commands/emergency-stop` |
| Crop cycle current state | YES | `/greenhouses/{ghId}/crop-cycle` |
| Start normal cycle | YES | POST crop-cycles |
| Import ongoing cycle | YES | import-active |
| Record pollination | YES | pollination |
| Edit planting date | YES | planting-date |
| Edit pollination | YES | pollination PATCH |
| Delete pollination | YES | DELETE pollination |
| Edit cycle metadata | YES | PATCH cycle |
| Cancel cycle | YES | cancel |
| Harvest/end cycle | YES | harvest |
| Crop-cycle history | YES | GET crop-cycles |
| Telemetry | YES | `/telemetry` |
| Events | YES | `/events` |
| Permanent Complex CRUD | NO | Python |
| Permanent GH master CRUD | NO | Python |
| Plant/Fruit permanent DB | NO | Python |
| Research analytics | NO | Python |

---

# 47. UI Mutation Rule

Every successful mutating request follows:

```text
USER ACTION
    ↓
validate client-side
    ↓
send request
    ↓
ESP32 validates
    ↓
ESP32 persists / executes
    ↓
ESP32 returns resulting state/event
    ↓
UI replaces local state
    ↓
optional follow-up GET /status
```

Do not do:

```text
USER ACTION
    ↓
mutate local store
    ↓
show success
    ↓
send request
```

The current UI audit specifically identifies this semantic problem. fileciteturn10file0L281-L336

---

# 48. API Contract Testing

The project must add contract tests that verify:

1. request schema matches UI type;
2. response schema matches UI type;
3. enum values match;
4. nullability matches;
5. date/time format matches;
6. numeric units match;
7. HTTP status mapping matches;
8. error codes map to UI messages;
9. optimistic state is never treated as device truth;
10. retry does not duplicate operations.

The OpenAPI file is the canonical machine-readable contract for these tests.

---

# 49. Definition of Integration Done

The UI↔ESP32 integration is complete only when:

- every direct ESP32 UI action has one documented endpoint;
- every endpoint has request/response schema;
- UI TypeScript types and OpenAPI schemas agree;
- ESP32 response fields are sufficient to render the UI without guessing;
- no page contains raw HTTP;
- no physical state is generated by mock timers;
- crop-cycle actions work end-to-end;
- cycle history works;
- errors/retries/reconnect work;
- browser cache does not override device truth;
- device restart is detected;
- contract tests pass.

---

# 50. Canonical Files

The implementation should keep these synchronized:

```text
UI_ESP32_COMMUNICATION_SPEC.md
UI_ESP32_OPENAPI.yaml
ESP32_BACKEND_SPEC.md
AI_AGENT_BUILD_ESP32_BACKEND_PROMPT.md
AI_AGENT_FRONTEND_TEMPLATE_UI_ESP32.md
UX_UI_MASA_TANAM.md
```

When a UI field changes, update the UI contract first and then update:
1. OpenAPI;
2. ESP32 firmware types/handlers;
3. UI TypeScript contracts/service adapter;
4. tests.

Never silently change only one side.

---

# 51. Canonical Data Storage & Historical SD Export Pipeline

## 51.1 Storage Architecture & Memory Ownership
The controller enforces a strict 3-tier memory model:
```text
                    ESP32
                      │
          ┌───────────┼────────────┐
          │           │            │
         NVS          SD          RAM
          │           │            │
     ACTIVE ONLY   HISTORICAL    TRANSIENT
     CROP CYCLE    DATA STORE    WORKING STATE
```
- **RAM**: Transient working memory only. Holds only the active record during execution. Never stores full historical datasets.
- **NVS**: Small, bounded storage. Stores only the single active crop cycle per greenhouse under `cc_<ghId>` (~466 bytes). Large historical cycle arrays are prohibited from NVS.
- **SD Card**: Durable bulk store for completed/closed crop cycles, historical plant records, telemetry, events, fertigation logs, and export chunks under `/agrotech/...`.
- **Backend Python (Future)**: Autonomous receiver and mirror. Requests export jobs, downloads chunks, verifies CRC32 checksums, and issues ACKs.

## 51.2 Crop Cycle Lifecycle & Archive Protocol
```text
ACTIVE (NVS) -> COMPLETING -> ARCHIVE_TO_SD -> VERIFY_ARCHIVE -> ARCHIVED -> REMOVE_FROM_NVS -> NEW ACTIVE (NVS)
```
1. Active cycle persists in NVS under key `cc_<ghId>`.
2. When harvested or cancelled, record is written to `/sdcard/agrotech/crop_cycles/history/<cycleId>.json` via atomic `.tmp` file and size verified.
3. If archive succeeds, NVS active key is erased. If archive fails and SD is mounted, NVS active record is preserved to prevent data loss.
4. If SD is absent, system operates in degraded mode, preserving active cycle in NVS and returning `STORAGE_UNAVAILABLE` on bulk operations.

## 51.3 Export REST API Contract
- `GET /api/v1/export/capabilities`: Returns dataset types, formats, max chunk size (32 KB), and SD mount status.
- `POST /api/v1/export/jobs`: Creates deterministic export job (`exp-<timestamp>`), builds file manifest, and computes CRC32.
- `GET /api/v1/export/jobs/{exportId}`: Returns job state, progress, total bytes, and total chunks.
- `GET /api/v1/export/jobs/{exportId}/manifest`: Returns record count, total bytes, CRC32 checksum, and file list.
- `GET /api/v1/export/jobs/{exportId}/data?chunkIndex=N`: Streams data in bounded chunks (<= 32 KB).
- `POST /api/v1/export/jobs/{exportId}/ack`: Explicit backend acknowledgement. Purges only the exported historical records. Active operational data is never deleted. Idempotent on repeated calls.

