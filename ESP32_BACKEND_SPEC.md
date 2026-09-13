# ESP32 BACKEND SPECIFICATION
## Canonical Firmware Contract for Direct UI ↔ ESP32 MVP

## 1. Goal

Implement the ESP32-S3 firmware as the local runtime anchor and REST API server for the Single HTML Vite application.

Target:
- ESP32-S3-WROOM-1-N16R8
- 16 MB Flash
- 8 MB Octal PSRAM
- WiFi
- optional W5500
- ESP-IDF
- USB flashing/debug for MVP
- internal Flash + microSD
- DS3231M RTC

The REST implementation MUST conform to `UI_ESP32_OPENAPI.yaml` and `UI_ESP32_COMMUNICATION_SPEC.md`.

---

# 2. Non-negotiable Architecture

```text
HTTP REST
   ↓
API/DTO layer
   ↓
Application services
   ↓
Runtime/state managers
   ↓
Hardware abstraction
   ↓
GPIO/sensors/actuators
```

HTTP handlers must never directly implement long-running physical logic.

ESP32 is authoritative for:
- physical actuator state;
- sensor runtime state;
- runtime clock;
- runtime execution;
- safety;
- local execution state;
- Last Valid Configuration;
- local events/telemetry/logs;
- active crop-cycle runtime state.

The project explicitly requires ESP32 to operate without UI or Python. fileciteturn11file6L1036-L1100

---

# 3. Framework

Use:

```text
ESP-IDF
```

Use FreeRTOS tasks/queues.

Do not use blocking loops inside HTTP handlers.

---

# 4. Machine-Readable Contract

The OpenAPI document is the external API authority:

```text
UI_ESP32_OPENAPI.yaml
```

Implementation rules:
- route paths must match exactly;
- HTTP methods must match exactly;
- JSON field names must match exactly;
- enum strings must match exactly;
- nullable fields must match;
- status codes must match;
- error fields must match.

If firmware needs an internal type different from API DTOs, create explicit conversion code. Never leak internal structs directly to JSON.

---

# 5. Board Safety

## Final baseline pins

### SPI shared bus

```text
SCK  = GPIO11
MOSI = GPIO12
MISO = GPIO13

W5500 CS = GPIO10
TFT CS   = GPIO14
TFT DC   = GPIO21
TFT RST  = GPIO42
microSD CS = GPIO47
```

### RTC

```text
SDA = GPIO8
SCL = GPIO9
```

### Outputs

```text
Well Pump AC            = GPIO1
Distribution Pump AC    = GPIO2
Raw-water Submersible  = GPIO4
Dosing A                = GPIO5
Dosing B                = GPIO6
Cooling Fan Panel       = GPIO7
Error Pilot Lamp        = GPIO18
```

### Inputs

```text
YF-B1 flow              = GPIO15
FS400A flow             = GPIO16
DS18B20                 = GPIO17
Float Lower             = GPIO19
```

### Buttons

```text
Mode                    = GPIO38
Manual A                = GPIO39
Manual B                = GPIO40
Distribution            = GPIO41
```

Reserved:

```text
GPIO0
GPIO3
GPIO20
GPIO33-37
GPIO43-44
GPIO45-46
GPIO48
```

Do not use GPIO33-37 for external peripherals on the N16R8/Octal-memory configuration.

GPIO48 is reserved because the board uses it for onboard RGB.

GPIO3 is reserved as a strapping pin.

GPIO19 is used for the lower float input in this MVP; native USB-JTAG use must not be assumed simultaneously.

---

# 6. Component Registry

All hardware is declared once.

Example:

```cpp
ComponentSpec {
    id,
    scope,
    type,
    role,
    gpio,
    activeLevel,
    enabled,
    capabilities
}
```

No GPIO number may be duplicated in unrelated modules.

Dosing pumps are data-driven:

```cpp
dosing[] = {
   { "dosing-a", GPIO5, ... },
   { "dosing-b", GPIO6, ... }
};
```

Adding a future dosing pump must require only registry/config changes plus available physical pin wiring. Core command/API engines must not be rewritten.

---

# 7. Active-Level Safety

Each output defines:

```text
activeLevel = HIGH
```

or:

```text
activeLevel = LOW
```

No global assumption.

On boot:
1. initialize GPIO mode;
2. immediately drive all actuators to safe OFF;
3. only then allow runtime activation.

---

# 8. Network

MVP:
- local WLAN/LAN;
- internet not required;
- HTTP;
- JSON;
- CORS;
- no authentication.

Network layer:

```text
network/
  wifi/
  ethernet/
  mdns/
  state/
```

Keep transport-independent application code.

---

# 9. mDNS

Publish stable hostname:

```text
esp32-<deviceId>.local
```

Optional service:

```text
_agrotech._tcp
```

TXT metadata may include:

```text
deviceId
complexId
apiVersion
schemaVersion
```

Browser service enumeration cannot be assumed universally; hostname resolution and cached/manual address remain valid client mechanisms.

---

# 10. CORS

CORS must support direct browser access.

At minimum:
- GET
- POST
- PUT
- PATCH
- DELETE when used
- OPTIONS

Support direct static-file browser origin behavior, including `Origin: null` when applicable.

Do not treat CORS as authentication.

---

# 11. Device Identity

Persist:

```text
deviceId
complexId
hostname
```

Firmware metadata:

```text
firmwareVersion
apiVersion
schemaVersion
bootId
```

`deviceId` is immutable identity.

IP is transport data.

---

# 12. Health and Status Services

Implement:

```http
GET /api/v1/health
GET /api/v1/status
GET /api/v1/inventory
GET /api/v1/capabilities
GET /api/v1/context
```

`/context` is read-only device-bound Complex/GH operational context. It is not the permanent Complex/GH master database.

---

# 13. Configuration Service

Implement:

```http
GET  /api/v1/configuration
POST /api/v1/configuration/validate
PUT  /api/v1/configuration
```

Metadata:
- configurationVersion;
- configurationHash;
- inventoryVersion;
- schemaVersion;
- updatedAt.

Apply must be atomic.

Use expected-version conflict handling.

A failed update leaves Last Valid Configuration active.

---

# 14. Clock Service

Implement:

```http
GET /api/v1/clock
POST /api/v1/clock-sync
```

RTC:
- DS3231M
- GPIO8/9

Runtime uses ESP32/RTC time, not browser time.

---

# 15. Command Service

Implement:

```http
POST /api/v1/commands
GET /api/v1/commands/{commandId}
POST /api/v1/commands/emergency-stop
```

Command IDs are idempotent.

Never expose raw GPIO APIs.

Commands must flow:

```text
request
↓
validate
↓
accept/reject
↓
queue if necessary
↓
runtime execute
↓
actual state/event
```

HTTP response alone is never the physical-completion signal.

---

# 16. Actual/Desired State

Actuator runtime representation should support:

```text
desiredState
actualState
stateReason
```

The driver owns actual physical state.

---

# 17. Event Manager

Persistent event schema:

```text
eventId
sequence
deviceTimestamp
eventType
severity
componentId?
payload
```

Sequence is monotonic per device.

Implement:

```http
GET /api/v1/events?afterSequence=&limit=
```

---

# 18. Telemetry Manager

Implement:

```http
GET /api/v1/telemetry
```

Sensor records contain:
- sequence;
- deviceTimestamp;
- componentId;
- value;
- unit;
- quality;
- measurementType.

Measurement types:

```text
MEASURED
DERIVED
UNAVAILABLE
INVALID
```

---

# 19. Storage

Internal flash:
- identity;
- runtime configuration;
- version/hash;
- recovery metadata;
- small durable state.

microSD:
- telemetry;
- event log;
- command audit;
- crop-cycle history/events;
- pending backlog.

If microSD fails:
- core runtime remains available;
- critical events use fallback ring/NVS mechanism;
- status exposes degraded storage.

---

# 20. Flow Sensors

Water path:

```text
Raw Water
 ↓
Submersible Pump
 ↓
YF-B1
 ↓
Mixing Tank
```

Distribution path:

```text
Mixing Tank
 ↓
Main Distribution Pump
 ↓
FS400A
 ↓
Greenhouse
```

YF-B1 = raw-water inlet measurement.

FS400A = distribution/fertigation outlet measurement.

The pulse calibration coefficient must be configurable.

Do not invent vendor calibration constants.

---

# 21. DS18B20

GPIO17.

Read through a dedicated sensor driver.

A missing/faulty sensor must not crash the controller.

---

# 22. Float Sensors

MVP:
- Float Lower on GPIO19 is active and used;
- Float Upper exists only as future/unused unless explicitly enabled.

Active-low input.

The driver reports:
- present;
- state;
- quality.

Do not invent upper-float runtime behavior before it is enabled.

---

# 23. Panel Buttons

```text
GPIO38 Mode
GPIO39 Manual A
GPIO40 Manual B
GPIO41 Distribution
```

Implement:
- debounce;
- edge handling;
- semantic event generation.

Do not duplicate runtime logic between buttons and HTTP commands where both represent the same operation.

---

# 24. Crop Cycle / Masa Tanam Runtime

The ESP32 MUST implement the crop-cycle contract because the current UI already depends on it.

Endpoints:

```http
GET  /api/v1/greenhouses/{ghId}/crop-cycle
GET  /api/v1/greenhouses/{ghId}/crop-cycles

POST /api/v1/greenhouses/{ghId}/crop-cycles
POST /api/v1/greenhouses/{ghId}/crop-cycles/import-active

POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination
PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination
DELETE /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination

PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/planting-date
PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}

POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/cancel
POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/harvest
```

---

# 25. Crop Cycle Rules

One GH:
- zero or one active cycle;
- many historical cycles.

Required:
```text
cycleId
ghId
status
tanggalTanam
```

Optional:
```text
tanggalPolinasi
variety
plantCount
notes
```

Derived/authoritative snapshot:
```text
hst
hsp
version
```

HST/HSP:
- never user editable;
- computed from device date + lifecycle dates;
- returned in every current-cycle response;
- recomputed on every relevant date/time/state mutation.

---

# 26. Crop Cycle Start

Normal create:
- reject if active cycle already exists;
- validate planting date;
- persist;
- event `CROP_CYCLE_CREATED`;
- return resulting state.

Ongoing import:
- allow a past planting date;
- optional pollination date;
- compute current HST/HSP;
- event `CROP_CYCLE_IMPORTED`.

---

# 27. Pollination

Validate:

```text
tanggalPolinasi >= tanggalTanam
```

Do not delete historical pollination events when the active date is removed.

---

# 28. Date Changes

Planting date and pollination date changes:
- require expectedVersion;
- validate relationships;
- update persisted state atomically;
- recompute HST/HSP;
- emit change event;
- return complete resulting cycle.

---

# 29. Metadata Changes

Update:
- variety;
- plantCount;
- notes.

Do not let metadata update mutate historical events.

---

# 30. Cycle Cancel

Cancel:
- terminates active cycle;
- preserves history;
- emits `CROP_CYCLE_CANCELLED`;
- returns resulting state.

---

# 31. Harvest

Harvest:
- records harvest event;
- closes active cycle;
- preserves historical cycle record;
- clears current active cycle projection;
- returns resulting GH/cycle state.

Do not interpret clearing active state as deleting history.

---

# 32. Timeline

Timeline is a projection.

Do not make the timeline itself the physical runtime source.

Current active cycle and event history are the source for timeline display.

Custom visual timeline configuration must remain separately owned and explicitly synchronized if promoted beyond UI-local presentation.

---

# 33. Versioning

Use optimistic concurrency:

```text
version
expectedVersion
```

Return:

```text
409 CONFLICT
```

when version does not match.

---

# 34. Recovery

On boot:
1. safe outputs;
2. storage initialization;
3. RTC;
4. sensors;
5. network;
6. mDNS;
7. REST server;
8. load Last Valid Configuration;
9. restore/reconcile runtime according to domain policy;
10. emit BOOT/DEVICE_READY.

Crop-cycle active state must survive restart.

HST/HSP must be recalculated from stored dates and current device time after restart.

---

# 35. No Python Dependency

ESP32 must continue to operate when:
- Python is unavailable;
- UI is closed;
- internet unavailable;
- LAN unavailable.

The master architecture defines Python as data/analysis anchor rather than a physical runtime prerequisite. fileciteturn11file6L1512-L1534

---

# 36. Firmware Project Structure

```text
main/
app/
api/
device/
hardware/
network/
configuration/
commands/
runtime/
crop_cycle/
telemetry/
events/
storage/
recovery/
tests/
```

Suggested separation:

```text
api/
  dto/
  routes/
  middleware/

crop_cycle/
  crop_cycle_service
  crop_cycle_repository
  crop_cycle_validator

runtime/
  runtime_manager
  state_machine
  safety_manager
```

---

# 37. Test Requirements

Contract tests must validate:
- OpenAPI request schemas;
- OpenAPI response schemas;
- HTTP status;
- error codes;
- version conflicts;
- idempotent retries;
- crop-cycle CRUD/action flow;
- reboot persistence;
- HST/HSP recomputation;
- event sequence;
- telemetry sequence.

Hardware integration tests:
- safe boot;
- output polarity;
- flow pulse counting;
- temperature sensor;
- lower float;
- button debounce.

---

# 38. Definition of Done

Do not mark complete because the firmware compiles.

Minimum acceptance:
- flash through USB;
- safe boot;
- WiFi/LAN works;
- mDNS works;
- HTTP server works;
- browser CORS works;
- `/health` works;
- `/status` works;
- inventory/capabilities work;
- configuration persists;
- events/telemetry persist;
- command lifecycle works;
- idempotency works;
- crop-cycle start/import/pollination/date-edit/delete-pollination/metadata/cancel/harvest works;
- crop-cycle history works;
- reboot retains current cycle and recomputes HST/HSP;
- microSD degradation does not crash runtime;
- OpenAPI contract tests pass.

---

# 39. Explicit Non-Goals

Do not implement in this layer:
- Python permanent database;
- cloud/internet;
- authentication/TLS;
- OTA;
- Plant/Fruit research database;
- analytics;
- unapproved detailed fertigation algorithms;
- raw GPIO REST endpoints.
