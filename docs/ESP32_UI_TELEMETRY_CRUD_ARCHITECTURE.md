# ESP32 ↔ Web UI
# Telemetry & CRUD Architecture v2

**Status:** Recommended architecture for production implementation
**Scope:** ESP32-S3 firmware + Web UI direct REST/WebSocket
**Authority:** ESP32 is operational authority for owned Complex/GH
**Backend:** history, research, mirror, coordination; never a Web UI → ESP32 proxy

---

## 0. Executive Decision

The previous MVP telemetry design is intentionally discarded as an architectural baseline.

The production target is:

```text
                         ESP32
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       Sensors        Runtime State      Events
          │                │                │
          ▼                ▼                ▼
   sample producer     RAM snapshot     event queue
          │                │                │
          └──────────┬─────┴────────────────┘
                     ▼
              TELEMETRY CORE
          fixed-size RAM samples
              + ring buffer
                     │
          ┌──────────┼──────────┐
          │          │          │
          ▼          ▼          ▼
      UI stream   persistence  backend sync
       10–15 s    batch/chunk     batch
          │          │          │
          ▼          ▼          ▼
     WebSocket      SD /      Python/backend
       batch      flash spool
```

### Connection Resilience & Health Monitoring Policy
- The UI maintains a single persistent WebSocket stream (`/api/v1/telemetry/stream`).
- ESP32 drains all client frame payloads (`httpd_ws_recv_frame`) to preserve HTTP server frame alignment and prevent abrupt 1006 connection drops.
- `ConnectionMonitor` utilizes a 6000ms isolated timeout for direct HTTP health checks (`GET /api/v1/health`) and falls back to checking `telemetryStreamManager.getStatus().isConnected`. If the WebSocket is alive and receiving batches, the device is considered healthy, avoiding false disconnect alarms on transient Wi-Fi jitter.
- The disconnect siren/alarm triggers only after 3 consecutive failed health intervals (>= 15 seconds of total communication loss).

For ordinary operational data:

```text
UI → one HTTP request → ESP32 authoritative mutation → response
```

There must be no automatic full re-hydration after every CRUD operation.

---

# 1. What We Learned From The Previous MVP

The previous implementation coupled too many concerns:

```text
HTTP request
  → domain operation
  → mutex
  → flash/NVS
  → JSON construction
  → response
```

and frontend CRUD could trigger another full hydration chain.

The audit found the following structural problems:

- synchronous storage I/O inside HTTP paths;
- coarse global storage mutex contention;
- topology persistence performed inside the mutation path;
- event/telemetry history read from flash during HTTP requests;
- frontend hydration fan-out after CRUD;
- periodic polling competing with CRUD;
- telemetry/offline-sync sharing storage resources.

These findings are sufficient to justify an architectural separation rather than incremental timeout tuning.

---

# 2. Core Principles

## 2.1 Sampling is not persistence

```text
sampling_interval
    ≠
persistence_interval
    ≠
UI delivery interval
    ≠
backend sync interval
```

A sensor may sample every 2 seconds while the Web UI receives a batch every 10–15 seconds and durable storage is flushed on a different policy.

## 2.2 Current state is RAM-first

The current sensor state must be available without filesystem access.

```text
GET current telemetry
        ↓
RAM snapshot
```

It must not require reading `telemetry.jsonl`, scanning flash, or reconstructing recent state from history.

## 2.3 History is storage-first

Historical queries are explicitly different from current telemetry.

```text
CURRENT
→ RAM

HISTORY
→ durable storage
```

## 2.4 HTTP handlers must be short

An ordinary HTTP request handler should not perform long-running flash work, large history parsing, or unrelated network synchronization.

ESP-IDF documents the HTTP server as a lightweight server whose registered handlers execute in the server context. ESP-IDF also provides explicit asynchronous WebSocket send facilities for persistent data delivery. [1]

## 2.5 Critical physical control is never dependent on telemetry transport

The following must continue operating if telemetry streaming, storage, or Python connectivity fails:

- scheduler;
- emergency stop;
- safety monitor;
- actuator protection;
- local runtime control;
- topology authority.

---

# 3. Telemetry Architecture

## 3.1 Sensor Producer

Each sensor driver produces a compact internal sample.

The sensor path must not call:

```text
fopen/fwrite/fclose
NVS
HTTP
cJSON_Print
network sync
large dynamic allocation
```

A sensor failure is represented as a quality/state value, not as an exception path that blocks the controller.

Recommended conceptual record:

```c
typedef struct {
    uint32_t sequence;
    uint64_t timestamp_ms;
    uint16_t sensor_set_id;

    int32_t temperature_x100;
    int32_t humidity_x100;
    int32_t light_x100;
    int32_t flow_ml;
    int32_t tank_level_x100;

    uint16_t validity_flags;
    uint8_t quality;
    uint8_t reserved;
} telemetry_sample_t;
```

The exact field set remains sensor/configuration driven. The important property is that the hot path is fixed-size and cheap.

---

# 4. RAM Telemetry Core

## 4.1 Ring Buffer

Use a bounded ring buffer for samples.

Preferred properties:

- fixed-size records;
- preallocated storage;
- no per-sample heap allocation;
- producer/consumer separation;
- explicit overflow policy;
- sequence number on every sample.

Zephyr's ring-buffer implementation is explicitly designed around producer/consumer use and does not add internal locking; single-producer/single-consumer usage can avoid an additional lock. Zephyr's logging subsystem also uses deferred processing and circular buffering to move expensive processing away from the logging call site. [2][3]

For this firmware, the ideal topology is:

```text
Sensor sampler
      │
      ▼
SPSC telemetry ring
      │
      ├── telemetry snapshot updater
      ├── persistence worker
      └── aggregation/stream worker
```

If multiple producers are required, serialize producers once at the ingestion boundary rather than introducing many locks around storage.

## 4.2 Overflow policy

Telemetry must have an explicit backpressure policy.

Normal telemetry:

```text
buffer full → drop oldest normal sample
```

Critical events/faults:

```text
critical → separate protected event path
```

Current snapshot:

```text
latest value replaces previous latest value
```

A dropped count must be observable:

```json
{
  "telemetryDropped": 17
}
```

Never silently pretend that all historical samples were retained.

---

# 5. Current Snapshot vs Telemetry Stream

These are separate products.

## 5.1 Current Snapshot

Purpose:

- dashboard initial render;
- manual refresh;
- quick status view;
- safety/operator diagnostics.

Endpoint:

```http
GET /api/v1/telemetry/current
```

Properties:

- RAM-backed;
- small response;
- no filesystem read;
- no history parsing;
- no long lock;
- safe to call frequently.

Target behavior:

```text
single-digit to tens of milliseconds on LAN,
subject to measurement and payload size.
```

This is a target, not a measured claim.

The current snapshot must also expose enough runtime state for the UI to know whether a dosing pump or raw/well pump + flow meter is ACTIVE. The UI uses that state for presentation, while the ESP32/stream subsystem remains authoritative for the adaptive cadence.

---

# 6. Telemetry Streaming: Adaptive 10–15 s / 3–5 s

The preferred UI transport is **WebSocket**, but the stream sends bounded batches rather than individual samples.

The UI must receive telemetry at a **state-aware cadence**. The cadence is not fixed for all operating conditions.

### Normal / Idle Mode

When the relevant pumps and dosing channels are not actively running:

```text
internal sample       sensor/config dependent
UI stream batch       10–15 s
```

Use **10 seconds as the default target**. A deployment may relax this toward 15 seconds when the dashboard does not need tighter visibility.

### Active Process Mode

When a **dosing pump is actively running** OR the **raw/well pump feeding the process is actively running and has a flow meter**, the Web UI must receive more frequent telemetry updates so the operator can observe the physical process.

```text
active dosing/raw pump
        ↓
UI stream cadence
        ↓
3 s target
5 s maximum fallback when 3 s is proven too heavy
```

The preferred target is **3 seconds**. The firmware must fall back to **5 seconds** when the measured CPU, memory, HTTP/WebSocket, or storage impact makes a 3-second cadence unsafe or materially degrades other controller responsibilities.

This is an adaptive operating policy, not permission for the UI to create a polling storm. The telemetry transport remains one persistent WebSocket stream per UI client.

### Active-State Transition Rules

When an active dosing/raw-pump operation starts:

```text
10 s idle stream
      ↓
operation becomes ACTIVE
      ↓
immediate current telemetry snapshot
      ↓
3 s stream cadence
```

When the operation stops:

```text
ACTIVE stream
      ↓
operation COMPLETE/STOPPED
      ↓
final immediate telemetry snapshot
      ↓
return to 10–15 s cadence
```

The ESP32 runtime state is authoritative for determining whether the process is ACTIVE. The Web UI must not infer pump activity only from its own timers or from delayed UI state.

The stream is:

```text
WebSocket
/api/v1/telemetry/stream
```

Each message should contain a bounded batch, not an unbounded history dump.

Example:

```json
{
  "type": "telemetry_batch",
  "schemaVersion": 1,
  "deviceId": "...",
  "complexId": "...",
  "streamMode": "PROCESS_ACTIVE",
  "cadenceSec": 3,
  "activeTriggers": ["DOSING_PUMP_ACTIVE", "RAW_PUMP_ACTIVE"],
  "sequenceStart": 1201,
  "sequenceEnd": 1206,
  "fromTs": "...",
  "toTs": "...",
  "samples": [
    {
      "sequence": 1201,
      "timestamp": "2026-09-24T18:50:20Z",
      "deviceTimestamp": "2026-09-24T18:50:20Z",
      "temperatureAirC": 25.2,
      "temperatureWaterC": 24.8,
      "temperatureC": 25.2,
      "humidityPct": 79.2,
      "lightLux": null,
      "waterLevelPct": 100,
      "flowRateLpm": 0,
      "totalLiters": 0,
      "actuators": { "wellPump": false, "distPump": false, "rawSubmersible": false, "mixingPump": false, "dosingA": false, "dosingB": false, "coolingFan": false }
    }
  ],
  "droppedBeforeSequence": 0
}
```

`streamMode`, `cadenceSec`, and `activeTriggers` are operational metadata for the UI. They are derived from authoritative ESP32 runtime state. They allow the UI to display why the stream is in high-frequency mode without creating its own polling loop.

### Water Temperature & RTC Clock Authority
1. **Water Temperature Measurement:** Sourced directly from physical Dallas DS18B20 1-Wire probe (`temp_ds18b20` on GPIO 17). Conveyed in RAM snapshot (`values.temperatureWaterC`) and WebSocket batch (`samples[].temperatureWaterC`) with quality metadata (`GOOD`, `UNAVAILABLE`, `INVALID`). Disconnected sensor causes data-quality state, never a crash or lockup.
2. **Device RTC Authority & Local Monotonic Clock:** Browser clock does not drive schedule execution. Operational time reference is synchronized with ESP32 DS3231 RTC (`GET /api/v1/clock`) every 120 seconds. Between synchronizations, browser ticks locally every 1 second using `performance.now()` monotonic elapsed time without HTTP polling storms. Schedule timeline positions the `Now` marker directly from device seconds since midnight.
3. **World Time Calibration via Gadget Web UI:** When ESP32 runs standalone without internet/NTP access, the technician's gadget acts as the authoritative world-clock provider. From the Calibration page (`/calibration`), clicking **"Sinkronkan dengan Jam Gadget"** issues `POST /api/v1/clock-sync` with `{ timestamp: ISO, timezone: string }`. The firmware parses the timestamp, writes it to physical DS3231 hardware registers via `rtc_ds3231_set_time(&tm)`, updates system POSIX time via `settimeofday()`, and immediately updates `deviceClock` on the client. RTC deviation status is shown live in real time.

### Why WebSocket instead of SSE

ESP-IDF has first-class WebSocket support and provides `httpd_ws_send_data_async()` specifically for asynchronous WebSocket delivery. This is preferable to implementing a custom long-lived chunked HTTP stream for this controller. [1]

Do **not** use the synchronous WebSocket send from a sensor task or storage worker.

Use the asynchronous send path.

The firmware must also ensure the payload buffer remains valid until asynchronous transmission completes.

---

# 7. WebSocket Safety Rules

A telemetry WebSocket is long-lived, so it must not become a new source of starvation.

Rules:

1. One telemetry stream connection per UI tab.
2. No telemetry connection may perform storage reads while preparing a message.
3. Stream payload is assembled from RAM data.
4. Payload has a hard maximum size.
5. Slow client causes bounded buffering, never unbounded memory growth.
6. Disconnected clients are removed promptly.
7. A client that falls behind receives a gap indicator and can recover missing history using the history endpoint.
8. Streaming failure does not affect sensor sampling.
9. Streaming failure does not affect scheduler, safety, or actuators.
10. A second Web UI may have its own stream connection; the firmware must remain safe under multiple subscribers.

A practical design is:

```text
Telemetry producer
       ↓
RAM ring
       ↓
stream worker
       ↓
per-client bounded send state
       ↓
httpd_ws_send_data_async()
```

The stream worker must never hold a global storage lock while sending.

### Runtime activation source

The high-frequency stream is triggered by authoritative runtime state, not by UI guesses:

```text
Dosing pump ACTIVE
        OR
raw/well pump ACTIVE + flow meter available
        ↓
PROCESS_ACTIVE stream
        ↓
3 s target / 5 s fallback
```

The Web UI should therefore never start a separate REST polling timer when it sees a pump become active. It simply consumes the existing WebSocket stream.

---

# 8. Telemetry Batch Semantics

The delivery interval is a transport cadence, not a sampling requirement and not a data-loss window.

## 8.1 Pump-Active Telemetry Contract

For these runtime conditions, the Web UI must receive live process telemetry:

1. **Dosing pump ACTIVE**
   - stream updates at the active cadence (3 s target, 5 s fallback);
   - include dosing-related measurements/status available from the configured hardware;
   - include the active run/command correlation identifiers when available.

2. **Raw / well pump ACTIVE with flow meter**
   - stream updates at the active cadence (3 s target, 5 s fallback);
   - include measured flow and relevant tank/volume/status telemetry available from the configured hardware;
   - include pump/run correlation identifiers when available.

3. **Both ACTIVE simultaneously**
   - use one telemetry stream and one adaptive cadence;
   - do not open separate polling loops for each pump;
   - combine the relevant measurements into the same bounded telemetry message.

4. **Neither ACTIVE**
   - return to the normal 10–15 s UI cadence.

The Web UI therefore implements:

```text
ONE telemetry WebSocket
        │
        ├── idle: 10–15 s
        │
        └── dosing/raw pump active: 3 s target / 5 s fallback
```

The cadence decision belongs to the runtime/telemetry system, because ESP32 is the physical authority. The UI consumes the stream and renders it; it should not independently start a 3-second REST polling timer when a pump appears active.

The stream must send an immediate state/snapshot message on the ACTIVE transition and a final snapshot on STOPPED/COMPLETED so the UI does not wait for the next cadence boundary to reflect a meaningful operational change.

The 10–15 second interval should be a delivery window, not a data-loss window.

For example, with a 2-second sensor cadence:

```text
10 seconds → ~5 samples
15 seconds → ~7–8 samples
```

The exact count depends on each sensor's configured cadence.

Use:

```text
sequenceStart
sequenceEnd
timestamp range
sample count
```

so the UI can detect gaps.

For large sensor populations, the batch can additionally contain aggregates:

```text
latest
min
max
average
quality summary
```

The UI does not need to render every raw sample if a screen only needs a trend summary.

---

# 8.2 Required UI Behavior Matrix

| Runtime condition | UI transport | Target cadence | Data focus |
|---|---|---:|---|
| Idle / normal | WebSocket | 10 s default, up to 15 s | current environment + equipment state |
| Dosing pump ACTIVE | WebSocket | 3 s target, 5 s fallback | dosing state + relevant sensor readings |
| Raw/well pump ACTIVE + flow meter | WebSocket | 3 s target, 5 s fallback | flow + pump/tank state |
| Dosing + raw/well pump ACTIVE | One WebSocket | 3 s target, 5 s fallback | combined active-process telemetry |
| Operation STOPPED/COMPLETED | WebSocket | immediate final snapshot, then idle cadence | final process state |
| WebSocket disconnected | no replacement polling storm | reconnect with backoff | latest snapshot on reconnect |

The active cadence must never be achieved by increasing the number of HTTP requests. It is achieved by changing the server-side/stream delivery interval on the existing WebSocket connection.

# 9. Persistence Strategy

## 9.1 Do not make flash persistence synchronous with sampling

Never do:

```text
sample
→ JSON encode
→ open flash
→ write
→ close
```

for every sample.

SPIFFS is explicitly documented by Espressif as **not a real-time filesystem**; writes can take substantially different amounts of time, and garbage collection can take up to several seconds when the filesystem is near capacity. [4]

## 9.2 Primary Bulk Telemetry Storage (TelemetryStore)

The production telemetry persistence is implemented in `storage/telemetry_store.c` and `storage/telemetry_store.h`.

```text
Sensor Sampler Task (RAM snapshot)
            │
            ▼
    telemetry_store_append()
            │
            ▼
FreeRTOS Ring Buffer (RAM / PSRAM)
            │
            ▼
Dedicated Telemetry Storage Task
            │
       batch write
            ▼
microSD (FatFS VFS) -> /sdcard/telemetry/tlm_YYYYMMDD.dat
```

### Key Principles
1. **RAM is the hot/realtime cache:** Current telemetry snapshots live in RAM. Realtime WebSocket streams and `GET /api/v1/telemetry/current` read exclusively from RAM and NEVER access the microSD card.
2. **microSD is durable history:** Telemetry history survives ESP32 restart and power loss. Internal NOR flash/NVS is reserved strictly for configuration and small persistent state (never for continuous telemetry logging).
3. **Non-fatal SD operations:** If the microSD is missing, damaged, unmounted, or full, the ESP32 continues normal sensor sampling, RTC tracking, fertigation scheduling, actuator regulation, safety checks, and WebSocket streaming without crash or watchdog starvation. Storage enters a degraded state and retries safely.
4. **Regulator independence:** The regulator, safety interlocks, and emergency stop never depend on microSD availability or file writes.

## 9.3 Fixed Binary Record Format & Tail Recovery

To eliminate the overhead of large JSON serialization on flash and guard against incomplete writes during sudden power loss, telemetry is written in fixed 60-byte binary records:

```c
typedef struct __attribute__((packed)) {
    uint32_t magic;              // 0x54454C4D ("TLM\0")
    uint8_t  version;            // Format version (currently 1)
    uint8_t  flags;              // Status / sensor flags
    uint16_t reserved;
    uint32_t sequence;           // Monotonically increasing sequence number
    uint64_t timestamp_ms;       // Device RTC epoch milliseconds
    int16_t  temp_air_x100;      // Air temperature * 100 (°C)
    int16_t  temp_water_x100;    // Water temperature * 100 (°C)
    uint16_t humidity_x100;      // Relative humidity * 100 (%)
    uint32_t light_lux;          // Ambient light (lux)
    uint16_t water_level_pct;    // Tank volume / level percentage
    uint16_t flow_rate_mlpm;     // Flow rate (mL/min)
    uint32_t total_volume_ml;    // Cumulative volume (mL)
    uint16_t actuator_mask;      // Bitmask of active physical actuators
    uint8_t  quality_temp_air;   // 0=Good, 1=Stale, 2=Degraded, 3=Fault
    uint8_t  quality_temp_water;
    uint8_t  quality_humidity;
    uint8_t  quality_light;
    uint8_t  quality_flow;
    uint8_t  quality_level;
    uint8_t  reserved2[10];
    uint32_t crc32;              // CRC32 of bytes 0..55 via esp_rom_crc32_le
} telemetry_record_t;            // Exactly 60 bytes packed
```

### Power-Loss & Tail Recovery (`telemetry_store_recover`)
- Upon boot or after remounting microSD, `telemetry_store_recover()` inspects the current day's segment file (`tlm_YYYYMMDD.dat`).
- It iterates record by record, verifying the magic word (`0x54454C4D`), version, and computing `esp_rom_crc32_le` over the payload.
- If a sudden power loss cut off a write mid-record, the corrupted tail is detected immediately.
- The file is truncated at the last verified valid record boundary via `ftruncate()`, preserving all earlier valid history without corrupting the historical database.

## 9.4 288-Slot RAM History Cache (5-Minute Resolution)

To provide instant UI chart rendering without reading thousands of raw records from microSD on every request:
- A 288-slot RAM history cache (`telemetry_daily_history_t`) is maintained in RAM:
  - 288 slots = 24 hours × 12 slots/hour (1 slot every 5 minutes).
  - Slot 0 = 00:00, Slot 1 = 00:05, ..., Slot 287 = 23:55.
  - Future slots beyond the current device RTC time are empty/null (`valid = false`).
- On reboot, `telemetry_store_load_recent_history()` replays valid records from the current day's microSD segment into the 288-slot RAM cache.
- During normal runtime, live samples are bucketed into the current 5-minute slot with sample count, min, max, and running average.
- Midnight rollover (23:59:59 → 00:00:00) rotates to a fresh daily segment file (`tlm_YYYYMMDD.dat`) and resets the 288 RAM slots for the new day, preserving the previous day on microSD.
- The on-device ST7735 TFT display (Screen 0) and the REST endpoint `GET /api/v1/telemetry/history` read directly from this 288-slot RAM cache.

---

# 10. Persistence Trigger Policy

A dedicated low-priority FreeRTOS worker (`telemetry_store_task`) manages SD I/O asynchronously:

```text
flush when:
    elapsed >= 5–10 seconds (normal batch interval)
OR
    buffered samples >= 16 in ring buffer
OR
    immediate trigger on critical event (E-stop, safety trip, fertigation phase change)
```

---

# 11. Event vs Telemetry Separation

Do not use telemetry storage as the event system.

### Telemetry

High volume, lower semantic criticality.

Examples:

- temperature;
- humidity;
- light;
- flow;
- level.

### Events

Lower volume, higher semantic value.

Examples:

- pump fault;
- flow loss;
- emergency stop;
- sensor disconnected;
- fertigation interrupted;
- configuration applied;
- topology mutation.

Events need stronger retention guarantees.

Zephyr explicitly supports deferred logging, bounded circular buffers, overflow policies, and a separate processing thread. That design is a useful model for our event path. [2][3]

---

# 12. Backend Sync

The ESP32 must not treat Python as a synchronous dependency of telemetry acquisition.

Use:

```text
Sensor
 ↓
RAM
 ↓
local durable spool
 ↓
sync worker
 ↓
Python/backend
```

When the backend is unavailable:

```text
continue sampling
continue local operation
continue local buffering/persistence
```

The sync worker backs off and retries independently.

If there is no backend destination configured, it must not read large telemetry/event files merely to discover that there is nowhere to send them.

The sync worker should first test:

```text
sync target configured?
network available?
```

before opening historical spool data.

Memfault's firmware architecture similarly keeps metrics in RAM, stores event data in a bounded buffer, and packetizes data into transport-sized chunks rather than requiring every metric update to become a network transaction. [5][6]

---

# 13. Telemetry History API

History is cursor-based.

Recommended form:

```http
GET /api/v1/telemetry/history?afterSequence=1200&limit=200
```

or time-bounded:

```http
GET /api/v1/telemetry/history?from=...&to=...&limit=200
```

Properties:

- bounded result size;
- sequence cursor;
- no unbounded `GET /telemetry` response;
- storage reads happen only in a history worker/path;
- UI can resume from a known sequence after a stream gap.

The live stream therefore does not need to guarantee infinite retention.

## 13.2 Fixed 288-Slot Full Day Chart & Decoupled Realtime UI

The temperature chart in the UI is strictly separated from the high-frequency numeric display:

### 1. Realtime Telemetry Numeric Readout (~1s)
- Sourced continuously from in-memory RAM snapshot via WebSocket stream (`/api/v1/telemetry/stream`) or `GET /api/v1/telemetry/current`.
- Updates the main number (e.g. `29.4 °C`) every ~1 second.
- Never waits for or triggers a chart recalculation.

### 2. Full 24-Hour Daily Chart (00:00 -> 23:59)
- **Fixed X-Axis:** Always spans the complete current calendar day from `00:00` to `23:59` based on ESP32 RTC device time.
- **Fixed Resolution:** Exactly 288 buckets (1 bucket every 5 minutes = 12 buckets/hour × 24 hours).
- **No Rolling Window:** Older points from earlier today are never discarded.
- **Future Slots Null:** All slots past the current device time contain `null` (not 0°C, and not repeating the previous sample). Visual curves and shaded areas cleanly terminate at the latest valid bucket.
- **UI Update Independence:** The chart matrix is memoized against a 5-minute bucket slot key (`Math.floor(Date.now() / 300000)`). It is NOT re-rendered or re-computed on every 1-second WebSocket frame.
- **Midnight Rollover:** When the clock transitions from 23:59:59 to 00:00:00, a fresh 288-slot chart starts at slot 0 (00:00), while the previous day remains durable on microSD.

---

# 14. CRUD Architecture

CRUD is fundamentally different from telemetry.

The goal is **fast authoritative mutation**, not streaming.

## 14.1 Create / Update / Delete

```text
Web UI
  │
  │ one HTTP request
  ▼
ESP32 owner
  │
  ├── validate
  ├── ownership check
  ├── concurrency check
  ├── mutate authoritative RAM state
  ├── create change/tombstone
  ├── durable commit
  └── return authoritative response
  │
  ▼
Web UI updates in-memory state
```

No full hydration afterwards.

---

# 15. CRUD Idempotency

Every externally meaningful mutation gets a `changeId` / `operationId`.

Example:

```json
{
  "operationId": "uuid",
  "expectedRevision": 41,
  "mutation": {
    "type": "DELETE_GREENHOUSE",
    "complexId": "...",
    "ghId": "..."
  }
}
```

The ESP32 must make retrying the same `operationId` safe.

This handles:

```text
request accepted
↓
response lost
↓
UI retries
```

without duplicate mutation.

---

# 16. CRUD Concurrency

Use optimistic concurrency for mutable topology/configuration.

Conceptually:

```text
expectedRevision = 41
```

If ESP32 is already at:

```text
revision = 42
```

reject with a conflict instead of silently overwriting newer state.

Example:

```text
HTTP 409
TOPOLOGY_REVISION_CONFLICT
```

The UI then performs one authoritative read of the affected resource/pool and reconciles.

Do not perform a full-system hydration unless genuinely required.

---

# 17. CRUD Response Contract

A successful mutation should return enough authoritative data for the UI to update itself directly.

Recommended response:

```json
{
  "success": true,
  "operationId": "...",
  "poolRevision": 42,
  "poolHash": "sha256:...",
  "entity": { ... },
  "tombstone": null
}
```

For a topology mutation, the response may additionally contain the updated affected Complex/GH relationship.

The UI must not immediately call:

```text
health
status
configuration
context
full topology
```

just because a CRUD operation succeeded.

---

# 18. CRUD Reads

Use the smallest authoritative read needed.

Examples:

```text
Need health
→ GET /health

Need topology revision
→ GET /topology-pool/meta

Need complete topology
→ GET /topology-pool

Need current telemetry
→ GET /telemetry/current

Need historical telemetry
→ GET /telemetry/history?afterSequence=...
```

Do not use `/context` as a universal "give me everything" endpoint.

---

# 19. Conditional Reads

For relatively static state, use revision/hash validators.

Example:

```text
GET /topology-pool/meta
→ poolRevision = 42
→ poolHash = H42
```

Only request the full pool when the revision/hash changed.

For HTTP resources where appropriate, an `ETag` / `If-None-Match` model can further reduce payloads.

This is particularly useful for:

- topology;
- configuration metadata;
- equipment metadata.

It is not required for fast telemetry snapshots.

---

# 20. Frontend Request Policy

The UI must stop treating every change as a reason to restart the entire operational discovery process.

### Startup

```text
bootstrap IP
→ health
→ topology-pool
→ discover known controllers
→ reconcile
→ render
```

### CRUD

```text
mutation
→ authoritative response
→ update local runtime state
→ done
```

### Refresh

```text
bootstrap IP
→ fresh discovery
→ authoritative topology
```

### Telemetry

```text
WebSocket stream
→ batch every 10–15 s
```

### History

```text
explicit history query
→ bounded cursor response
```

---

# 21. Connection Monitor Policy

Do not poll three heavyweight endpoints every 5 seconds.

Use a lightweight liveness policy.

Recommended concept:

```text
online
→ infrequent health check

suspected offline
→ faster retry

recovered
→ return to slow cadence
```

For the UI, telemetry streaming itself supplies evidence that the controller is reachable.

Do not use telemetry history reads as a connection heartbeat.

---

# 22. Multiple Web UIs

Two or more Web UIs are allowed.

They must not create multiplicative hydration storms.

For example:

```text
UI A ── WebSocket telemetry stream ──┐
UI B ── WebSocket telemetry stream ──┼─ ESP32 RAM telemetry
UI C ── WebSocket telemetry stream ──┘
```

All clients receive snapshots from the same RAM telemetry source.

No client causes a separate filesystem scan.

For topology changes:

```text
UI A
 ↓
CREATE/DELETE
 ↓
ESP32 owner
 ↓
authoritative response

UI B
 ↓
refresh
 ↓
GET topology-pool
 ↓
new authoritative state
```

Later, an optional low-rate topology/event push channel can be added, but it is not required for correctness.

---

# 23. Storage Ownership Model

The previous global storage mutex is too coarse.

Target ownership:

```text
Telemetry RAM        → telemetry subsystem
Telemetry storage    → telemetry I/O worker
Event storage        → event I/O worker
Topology             → topology subsystem
Configuration        → configuration subsystem
Sync                 → sync subsystem
```

Each subsystem owns its durable representation and exposes narrow APIs.

A storage mutex may still exist inside a subsystem, but it should not become a system-wide serialization point for unrelated domains.

Do not perform network calls while any storage mutex is held.

Do not perform long JSON serialization while a global storage lock is held.

Do not hold a topology lock while waiting on unrelated event/telemetry I/O.

---

# 24. What Must Never Happen Again

## Telemetry

```text
sensor read
→ SPIFFS write
```

No.

```text
GET current telemetry
→ SPIFFS history scan
```

No.

```text
sensor error
→ repeated heavy event + flash activity
```

No.

## CRUD

```text
DELETE GH
→ mutation
→ full hydration
→ health
→ status
→ config
→ context
→ repeat
```

No.

## Backend

```text
ESP32 telemetry
→ synchronous Python dependency
```

No.

## Storage

```text
one global mutex
→ every domain
```

No.

## Network

```text
streaming connection
→ unbounded memory/socket usage
```

No.

---

# 25. Recommended Final Architecture

```text
                           WEB UI
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
       CRUD HTTP        Telemetry WS        History HTTP
          │              10–15 s batches        │
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                           ESP32
                             │
       ┌─────────────────────┼──────────────────────┐
       │                     │                      │
       ▼                     ▼                      ▼
  Topology/Config       Telemetry Core           Events
  authoritative RAM     fixed-size samples       bounded queue
       │                     │                      │
       │                     ├── snapshot           │
       │                     ├── stream             │
       │                     └── persistence        │
       │                            │               │
       ▼                            ▼               ▼
  durable config              SD / flash spool   event storage
       │                            │               │
       └────────────────────────────┴───────────────┘
                                    │
                                    ▼
                              Sync Worker
                                    │
                                    ▼
                             Python Backend

             Python is never required for local operation.
```

---

# 26. Concrete Recommended Defaults

These are starting defaults, not hard-coded protocol laws.

| Concern | Recommended starting policy |
|---|---|
| Sensor sampling | sensor-specific; 2 s is reasonable for current prototype sensors |
| RAM telemetry snapshot | update on each accepted sample |
| UI telemetry stream | **10–15 s batch** |
| Telemetry transport | **WebSocket async send** |
| Telemetry history | cursor-based bounded HTTP |
| Local telemetry persistence | 30–60 s and/or size threshold |
| Bulk history storage | SD preferred |
| Flash fallback | bounded spool/chunks |
| Internal telemetry format | binary fixed-size/chunked |
| API telemetry format | JSON initially; compact binary/CBOR possible later if needed |
| CRUD transport | normal HTTP request/response |
| CRUD frequency | only on user action/system mutation |
| CRUD response | authoritative changed resource + revision/change ID |
| CRUD retry | idempotent operation ID |
| CRUD conflict | optimistic revision / 409 |
| Topology full read | only bootstrap/refresh/reconciliation |
| Topology metadata read | lightweight revision/hash |
| Connection monitoring | adaptive, low-frequency when healthy |
| Backend sync | asynchronous batch with backoff |
| Sensor failure | UNAVAILABLE/FAULT state, non-blocking |
| Current telemetry | RAM only |

---

# 27. Implementation Order

Do not change all layers at once.

### Phase 1 — Telemetry Core

1. Define fixed-size `telemetry_sample_t`.
2. Introduce bounded RAM ring buffer.
3. Introduce RAM latest-snapshot state.
4. Remove flash access from sensor sampling path.
5. Define overflow counters and quality semantics.

### Phase 2 — Telemetry Stream

1. Add `/api/v1/telemetry/stream` WebSocket.
2. Add async batched delivery every 10–15 s.
3. Add sequence/gap detection.
4. Add per-client bounded buffers.
5. Verify multiple simultaneous UIs.

### Phase 3 — Persistence

1. Add telemetry storage worker.
2. Batch writes.
3. Move toward binary chunks.
4. Use SD as primary bulk store.
5. Keep bounded flash fallback.

### Phase 4 — CRUD

1. Remove full hydration after mutation.
2. Return authoritative mutation results.
3. Add idempotent operation IDs.
4. Add revision/concurrency checks.
5. Use targeted reads only when necessary.

### Phase 5 — Storage Isolation

1. Separate telemetry/event/config locks.
2. Remove unrelated I/O from critical sections.
3. Ensure no network operation occurs under storage locks.

### Phase 6 — History and Sync

1. Cursor-based history APIs.
2. Asynchronous spool sync.
3. Backend-unavailable fast path.
4. Retry/backoff.

### Phase 7 — Measurement

Measure the physical device after every phase:

- endpoint latency;
- p95/p99;
- RTO rate;
- heap/PSRAM;
- stack high-water marks;
- ring occupancy;
- dropped telemetry;
- flash write duration;
- active WebSocket clients.

---

# 28. Acceptance Criteria

## Telemetry

- Sensor sampling never performs filesystem I/O.
- Sensor failure never blocks HTTP.
- Current telemetry is served from RAM.
- UI receives telemetry batches every 10–15 s.
- Stream payload is bounded.
- Gaps are detectable by sequence number.
- Multiple UIs can subscribe simultaneously.
- Slow/disconnected clients do not block sampling.
- Telemetry storage failure does not stop local regulation.

## CRUD

- Create/update/delete is one mutation request.
- Successful mutation does not automatically trigger full hydration.
- Response contains authoritative changed state and revision.
- Lost-response retry is idempotent.
- Revision conflicts are detected.
- Refresh reconstructs topology from ESP32.
- Two UIs converge after refresh.

## Storage

- No system-wide global storage mutex serializes unrelated domains.
- No long network operation occurs under a storage lock.
- Large historical reads are bounded and paged.
- Flash write latency cannot block sensor sampling.

## Backend

- ESP32 continues operating when backend is unavailable.
- Sync is deferred and batched.
- Empty backend configuration causes no historical file scan.

---

# 29. Research Basis

This architecture is based on patterns present in mature embedded/IoT systems rather than treating the previous MVP as the target.

### [1] Espressif ESP-IDF HTTP Server
ESP-IDF documents the lightweight HTTP server model and provides WebSocket support, including `httpd_ws_send_data_async()` for asynchronous delivery outside the current request path.

https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/protocols/esp_http_server.html

### [2] Zephyr Logging
Zephyr's logging architecture uses deferred processing, circular buffers, filtering, overflow policy, and a dedicated processing thread so that expensive work is shifted away from the call site.

https://docs.zephyrproject.org/latest/services/logging/index.html

### [3] Zephyr Ring Buffer
Zephyr explicitly documents producer/consumer ring-buffer usage and bounded storage semantics.

https://docs.zephyrproject.org/latest/kernel/data_structures/ring_buffers.html

https://github.com/zephyrproject-rtos/zephyr/blob/main/include/zephyr/sys/ring_buffer.h

### [4] Espressif SPIFFS
Espressif explicitly states that SPIFFS is not a real-time stack and that garbage collection can make writes take up to several seconds when the filesystem is near capacity.

https://docs.espressif.com/projects/esp-idf/en/stable/esp32s2/api-reference/storage/spiffs.html

### [5] Memfault Metrics
Memfault stores metrics in RAM and updates them with negligible overhead, then serializes/report them as heartbeat data rather than turning every metric update into a transport operation.

https://docs.memfault.com/docs/mcu/metrics-api

### [6] Memfault Data Packetizer
Memfault packetizes firmware data into transport-sized chunks so collection and transport are decoupled.

https://docs.memfault.com/docs/mcu/data-from-firmware-to-the-cloud

https://github.com/memfault/memfault-firmware-sdk

---

# 30. Final Architectural Position

The production architecture should not be:

```text
sensor → JSON → flash → HTTP
```

It should be:

```text
sensor
  ↓
fixed-size RAM sample
  ↓
bounded ring buffer
  ├── current snapshot
  ├── 10–15 s UI WebSocket batch
  ├── batched durable persistence
  └── asynchronous backend sync
```

And CRUD should be:

```text
UI
 ↓
one HTTP mutation
 ↓
ESP32 authoritative state
 ↓
durable commit
 ↓
authoritative response
 ↓
UI updates memory
```

This keeps the hot paths short, makes failure domains explicit, and prevents telemetry/history traffic from becoming an accidental dependency of physical greenhouse regulation.

# 31. Engineering Review — Additional Hardening Decisions

This section records the final engineering decisions after independent review of the architecture.

## 31.1 Memory and serialization

**Accepted in part.**

The system already uses an ESP32-S3 with 8 MB PSRAM, and ESP-IDF provides capability-aware allocation including `MALLOC_CAP_SPIRAM`. Large telemetry/network buffers may therefore be placed in PSRAM when their actual use permits it. The implementation must still keep latency-sensitive control structures and any memory with internal/DMA capability requirements in appropriate memory classes rather than moving everything to PSRAM. [7][8]

For telemetry hot paths:

- prefer fixed-size binary sample records;
- preallocate ring-buffer storage;
- avoid per-sample cJSON allocation;
- assemble bounded stream frames from preallocated or pooled buffers;
- use JSON at the public CRUD/API boundary where human-readable interoperability is useful;
- do not introduce a second serialization format merely for theoretical optimization.

CBOR is retained as a **future transport optimization** when measurements show JSON serialization or payload size is materially limiting. It is not required for the first production implementation.

## 31.2 Asynchronous WebSocket frame ownership

**Accepted fully.**

The firmware must treat asynchronous WebSocket transmission as a producer/consumer problem. ESP-IDF exposes `httpd_ws_send_data_async()` for asynchronous WebSocket sends and invokes a completion callback after sending. [1]

Therefore:

```text
telemetry batch built
        ↓
owned frame buffer
        ↓
async send
        ↓
completion callback
        ↓
buffer returned to pool
```

A buffer must not be reused or overwritten merely because the producer finished building the frame. The implementation should use a small bounded frame-buffer pool or equivalent explicit ownership mechanism.

A slow WebSocket client may consume its own bounded send slots, but it must never block sensor sampling, scheduler, safety, topology, or other clients.

## 31.3 SD storage interface

**Accepted conditionally, with a hardware gate.**

For high-volume telemetry, the preferred bulk-storage target is SD/MMC through the ESP32-S3 SDMMC peripheral rather than SDSPI when the actual board wiring and reserved GPIO map allow it. ESP32-S3 supports SD interfaces with 1-bit and 4-bit operation; the appropriate bus width depends on the actual available pins and hardware design. [9]

However, the current AgroTech hardware documentation contains an existing shared SPI arrangement for display/SD and historical SD-card pin variants. Therefore the firmware must **not change the pin map blindly**.

Required decision sequence:

```text
actual board wiring audit
        ↓
reserved/forbidden GPIO audit
        ↓
SDMMC feasibility check
        ↓
if feasible → prefer SDMMC 4-bit
if not feasible → use SDMMC 1-bit
if hardware cannot support either → retain SDSPI temporarily behind the storage abstraction
```

The storage abstraction must hide the transport choice from telemetry/core logic.

If SD is eventually placed on SDMMC, it is no longer a device on the shared SPI bus used by the TFT/W5500 path. This is a desirable reduction in SPI-bus contention, although SDMMC activity can still consume CPU/DMA/interrupt resources and must be profiled on the assembled hardware.

## 31.4 Internal flash filesystem

**Accepted fully: move the production fallback away from SPIFFS where practical.**

ESP-IDF's current ESP32-S3 documentation describes LittleFS as fail-safe, with integrated wear levelling and low/fixed RAM requirements, and explicitly notes that SPIFFS is no longer actively developed. ESP-IDF also recommends NVS for configuration-like data but not for frequent large logging. [10]

Target storage roles therefore become:

```text
NVS
→ configuration / small infrequently-changing durable state

LittleFS on internal flash
→ bounded emergency/fallback spool

SD card via SDMMC + FatFS when hardware permits
→ primary high-volume telemetry history
```

SPIFFS may remain only as a migration/compatibility path while the storage layer is being transitioned. New high-rate telemetry design must not deepen dependence on SPIFFS.

## 31.5 CRUD durability is different from telemetry durability

Do **not** apply asynchronous persistence blindly to all writes.

Topology/configuration mutations are authoritative operational state and require a durable commit boundary before the UI is allowed to treat the mutation as committed.

By contrast, telemetry/history/event persistence is a deferred durability workload that may be queued and batch-written.

Therefore:

```text
Topology/config CRUD
→ validate
→ mutate authoritative state
→ durable commit
→ authoritative response

Telemetry/event/history
→ enqueue
→ bounded buffer
→ deferred persistence
```

This distinction preserves crash/reboot correctness without forcing high-volume telemetry into the HTTP critical path.

## 31.6 Telemetry cadence is adaptive but not a polling storm

The UI uses exactly one persistent telemetry WebSocket per tab/controller stream.

Normal mode:

```text
10 s target
15 s allowed
```

Active process mode:

```text
Dosing pump ACTIVE
OR
Raw/well pump ACTIVE + flow meter available

→ 3 s target
→ 5 s fallback when validated as necessary
```

The transition is controlled by authoritative ESP32 runtime state. The UI does not create a new REST polling timer when a pump becomes active.

## 31.7 Final additional engineering position

The external review should be adopted selectively:

| Review item | Decision |
|---|---|
| PSRAM for suitable large buffers | **ACCEPT** |
| Avoid dynamic cJSON in telemetry hot path | **ACCEPT** |
| Preallocated WebSocket frame ownership | **ACCEPT** |
| CBOR immediately | **DEFER** until measured need |
| SDMMC + FatFS over SDSPI for primary SD history | **ACCEPT as hardware-gated target** |
| LittleFS over SPIFFS for new internal-flash fallback design | **ACCEPT** |
| Async all persistence indiscriminately | **REJECT** |
| Topology/config durable commit before success | **RETAIN** |

---

# 32. Additional References

### [7] ESP-IDF — Heap Memory Allocation, ESP32-S3
ESP-IDF documents capability-aware memory allocation and explicit `MALLOC_CAP_SPIRAM` allocation for external RAM.

https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/mem_alloc.html

### [8] ESP-IDF — External RAM, ESP32-S3
ESP-IDF documents the use of PSRAM in the capability allocator and the conditions under which `malloc()` may use external RAM.

https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/external-ram.html

### [9] ESP-IDF — SDMMC Host Driver, ESP32-S3
ESP32-S3 supports SDMMC interfaces including 1-bit and 4-bit SD operation; actual width/pin selection remains a board-level decision.

https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/sdmmc_host.html

### [10] ESP-IDF — File System Considerations, ESP32-S3
ESP-IDF currently documents FatFS, SPIFFS and LittleFS; it describes LittleFS as fail-safe with integrated wear levelling and recommends it as a general-purpose choice, while noting SPIFFS is no longer actively developed. It also recommends NVS for configuration-like data rather than frequent large logging.

https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-guides/file-system-considerations.html

---

# 33. Authoritative Schedule Intent Persistence & Derived Compiled Execution Architecture

## 33.1 The Two Fundamental Layers
The AgroTech architecture strictly separates user configuration intent from runtime execution artifacts:

```text
ESP32 Physical Controller
├── Schedule Intent Store (AUTHORITATIVE)
│     ├── Location: ESP32 NVS (namespace: "agrotech", key: "sched_intents")
│     ├── Holds full operator configuration parameters
│     ├── Retains ACTIVE, BLOCKED, and DISABLED statuses
│     ├── Survives browser refresh & hard device reboots
│     └── Read directly by Web UI during bootstrap hydration
│
└── Compiled Schedule Store (DERIVED)
      ├── Endpoint: /api/v1/schedules/compiled
      ├── Generated from valid schedule intents + active topology capabilities
      ├── Consumed strictly by the FreeRTOS runtime scheduler
      └── Excludes non-executable / BLOCKED intents
```

**Never reverse this relationship.** The UI must never rely solely on `/api/v1/schedules/compiled` to reconstruct user schedules, because non-executable (BLOCKED) schedules would vanish.

## 33.2 Authoritative Schedule Intent CRUD API
The ESP32 exposes canonical REST CRUD endpoints for durable schedule intent management:

- `GET /api/v1/schedule-intents`: Returns `{ revision, total, items: [...] }` containing all persisted schedule intents.
- `POST /api/v1/schedule-intents`: Creates a new intent or upserts an existing intent atomically into NVS.
- `PUT /api/v1/schedule-intents/{id}`: Updates an existing intent atomically into NVS.
- `DELETE /api/v1/schedule-intents/{id}`: Deletes an intent from NVS atomically.

All mutations commit atomically to ESP32 NVS using `nvs_set_blob` and `nvs_commit`.

## 33.3 Mandatory Semantics: BLOCKED != DELETED
When a schedule depends on missing hardware resources (e.g. missing flow meter, unassigned mixing tank, offline temperature sensor, or absent exhaust fan):
1. The schedule intent **MUST REMAIN PERSISTED** in ESP32 NVS.
2. Its `activationState` is set to `"BLOCKED"`, preserving `blockedReasons: string[]`.
3. All operator parameters (recipe, water volume, duration, dosing ml, hysteresis thresholds, days of week) are 100% preserved.
4. The schedule is **EXCLUDED** from the executable compiled artifact deployed to the FreeRTOS runtime scheduler.
5. On browser refresh, the UI displays the schedule in the table and timeline marked with a `Blocked (No Hardware)` badge and clear diagnostics.
6. When the missing peripheral or topology capability is later registered/activated, revalidation promotes the intent to `ACTIVE` and deploys it to the compiled runtime without operator re-creation.

## 33.4 Browser Refresh Hydration Flow
During page load / refresh:
1. Locate controller via bootstrap address locator hints (`agrotech_bootstrap_ips`).
2. Probe ESP32 `/api/v1/health` and `/api/v1/topology-pool`.
3. Fetch `/api/v1/status` and `/api/v1/inventory`.
4. **Step 4b**: Fetch `/api/v1/schedule-intents` directly from the ESP32.
5. Reconstruct `wellPumpSchedules` under target Complex and `fertigationSchedules` / `fanSchedules` under target Greenhouse.
6. Enrich each item with runtime activation state and blocked reasons via `enrichScheduleWithActivationState`.
7. Commit into RAM operational state snapshot and notify subscribers.

## 33.5 Elimination of Browser Storage
- `localStorage` and `sessionStorage` are **STRICTLY PROHIBITED** as schedule stores.
- All legacy keys matching `agrotech:local:schedules:*` have been completely eliminated from production code.
- Browser storage is restricted exclusively to network discovery hints (`agrotech_bootstrap_ips`).

## 33.6 Autonomous RTC & Python Independence
- FreeRTOS scheduler operates autonomously on the ESP32 once a synchronized clock or uptime epoch is established.
- Browser presence is never required for schedule execution.
- Direct ESP32 mode operates 100% autonomously with the Python backend offline.

## 33.7 Browser Storage Policy — Strict Allowlist & Prohibition
Browser persistence is restricted under a strict allowlist policy:
1. **Allowed**:
   - ESP32 connection information: `agrotech_bootstrap_ips` locator hints (IP address / hostname).
   - Minimal Complex identity/name hint (for UI route selection).
   - Minimal Greenhouse identity/name hint (for UI route selection).
2. **Strictly Prohibited**:
   - Schedules, schedule intents, compiled schedules.
   - Recipes, dosing parameters, calibration data.
   - Equipment configuration, sensor configuration, topology as authoritative state.
   - Operational configuration, runtime state, telemetry, actuator state, scheduler state.
   - Any operational data storage in `localStorage`, `sessionStorage`, `cookies`, `IndexedDB`, `Cache API`, or service worker caches.

## 33.8 HTTP Cache-Control & CORS Headers
- ESP32 responds with explicit anti-caching headers on all JSON endpoints:
  - `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
  - `Pragma: no-cache`
- CORS Preflight headers allow:
  - `Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-ID, Accept, Cache-Control, Pragma`
- Frontend fetch calls use standard `cache: "no-store"` to ensure the browser network stack never serves stale cache responses.

## 33.9 Multi-Browser Independence & Zero Cache Divergence
- Each browser instance acts strictly as a stateless view/client.
- Any creation, update, or deletion commits directly to ESP32 NVS.
- Any other browser refreshing the page issues an authoritative `GET /api/v1/schedule-intents` to the ESP32, immediately reflecting the current NVS state with zero cross-browser cache pollution.

---

# 34. Equipment Configuration — Draft + Apply UX Model & Storage Architecture

## 34.1 Two-State Model (Applied vs. Draft)
The Equipment Configuration interface (`SupportedEquipmentChecklist.tsx`) implements an explicit two-state architectural model:

```text
ESP32 Physical Authority (NVS / SPIFFS)
       ↓  GET /api/v1/configuration
APPLIED STATE (Authoritative RAM)
       ↓  Clone into transient draft
DRAFT STATE (Transient Browser RAM Only)
       ↓  Operator checks / unchecks equipment
       ↓  (0 network calls, 0 storage persistence)
OPERATOR ACTIONS:
   ├── Cancel  → Discard draft, reset to Applied State (0 network calls)
   ├── Refresh → Discard draft, reload authoritative state from ESP32
   └── Apply   → Exactly ONE atomic mutation: PUT /api/v1/configuration
                      ↓
               ESP32 validates, commits to SPIFFS/NVS
                      ↓
               New version becomes authoritative Applied State
```

1. **APPLIED STATE**:
   - Represents the last configuration successfully committed to the ESP32.
   - Authoritative runtime baseline.
   - Loaded from the ESP32 on page startup or browser reload.
   - Read-only while viewing.

2. **DRAFT STATE**:
   - Temporary UI editing state in browser RAM only.
   - Checkbox clicks mutate **only** the draft state in RAM.
   - **STRICT PROHIBITION**: Draft state MUST NOT be saved to:
     - `localStorage`
     - `sessionStorage`
     - `cookies`
     - `IndexedDB`
     - `Cache API`
   - Checkbox clicks trigger **ZERO network requests** to the ESP32.

## 34.2 Operator Actions & State Transitions
- **Checkbox Toggle**: Updates `draftPins` set in React state. Updates the "Draft Belum Diterapkan" banner. Network calls = 0. Storage writes = 0.
- **Cancel Button**: Discards `draftPins` and resets back to `appliedPins`. Network calls = 0. Storage writes = 0.
- **Browser Refresh**: Discards unapplied draft in browser RAM. Re-fetches authoritative configuration directly from ESP32 via `GET /api/v1/configuration`.
- **Apply Button**:
  1. Compiles canonical component records for all configured equipment terminals.
  2. Issues **exactly ONE** `PUT /api/v1/configuration` request to the ESP32 with `expectedVersion`.
  3. ESP32 stages, validates against runtime hardware registry, and atomically activates the configuration.
  4. On HTTP 200 success, the returned configuration is committed to `appliedPins`, synchronization state is updated, and a durable success banner is displayed.
  5. Schedule set redeployment against the new hardware configuration is decoupled asynchronously so it never blocks or cascades into configuration mutation.

## 34.3 SPIFFS Flash I/O & Storage Architecture Resolution
- **Root Cause of Historical Timeout**: Initial deployments experienced ~50-second latencies and occasional task watchdog resets during `PUT /api/v1/configuration`. Forensic analysis of live serial logs revealed:
  1. The 9MB SPIFFS partition was unformatted from factory across higher sectors (`0x00173000`), causing SPIFFS block allocations for candidate/lvc configurations to fail with `ESP_ERR_FLASH_OP_FAIL` (err 257) and abort.
  2. Large payloads exceeding NVS string limits were bypassed to SPIFFS, where unformatted blocks caused severe contention.
- **Remediation**:
  1. Clean physical SPIFFS erase and format (`erase_region 0x620000 0x900000`) was executed, establishing a healthy, verified filesystem.
  2. Configuration activation latency dropped from >50s to **3.2 - 5.4 seconds**.
  3. Client HTTP timeout in `backend-client.ts` and `esp32-client.ts` was set to a robust `90000ms` window to safely absorb SPIFFS garbage collection cycles without premature client aborts.
  4. `loadData(silent=true)` background refresh implemented in `equipment/page.tsx` to prevent unmounting the checklist and preserving user feedback banners.

---

# 35. Environmental Telemetry Presentation & Multi-Scope Mapping

## 35.1 Complex vs Greenhouse Scope Resolution
1. **Sensors at Complex Scope**:
   - Central water supply components such as the Dallas DS18B20 temperature probe (`temp_ds18b20`), raw water flow meters, and reservoir float switches belong to the facility complex and possess `ghId: null`.
   - In Direct ESP32 mode, `telemetryService.syncCurrent()` and `syncHistory()` query endpoints without restricting the request with `?ghId=...`. This guarantees that both complex-level sensors (water temperature, well flow, tank levels) and greenhouse-specific sensors (DHT22 air temperature and relative humidity) are returned in the same snapshot payload.
2. **History Flattening Architecture**:
   - ESP32 `/api/v1/telemetry/history` encapsulates telemetry records inside `data.items[]`. The `esp32Client.getTelemetryHistory()` adapter flattens `items.flatMap(item => item.samples || [])` into `res.samples`, ensuring continuous 24H series calculation, min/avg/max computation, and sparkline rendering without missing samples.

## 35.2 High-Density Decimal Formatting & Overflow Protection
1. **Formatting Standards (`formatMetricValue`)**:
   - Temperature (°C) and Humidity (%): strictly formatted to **1 decimal place** (`toFixed(1)`), e.g. `25.3 °C`, `79.2%`. Raw floating point IEEE-754 representations (such as `79.200004577%`) are prohibited from entering DOM views.
   - Light (klux/lux): Values ≥ 100 are rounded with locale thousand separators (`Math.round(val).toLocaleString()`), and sub-hundred values are formatted to 1 decimal place.
   - Tank and Fertigation Volumes (L / %): Whole values format with zero decimal places; fractional values format to 1 decimal place.
2. **Non-Overlap Grid Layout**:
   - Environmental 24H Overview grid items use `min-w-0 overflow-hidden` and `truncate` with `title` attributes on numerical nodes. This guarantees that multi-column dashboards cannot overflow into adjacent cards or wrap into irregular heights regardless of viewport width.
3. **Unit Cleanliness**:
   - Root metric metadata (`METRIC_DEFS`) defines cleanly separated label and unit tokens (`label: "Air Temperature"`, `unit: "°C"`), eliminating duplicate unit suffixes such as `Air Temperature (°C) (°C)`.

---

# 36. Heterogeneous Matrix Line Chart & End-to-End Humidity Architecture

## 36.1 Heterogeneous Telemetry Charting Principles
1. **Independent Y-Axes per Dimensional Metric**:
   - Air Temperature (°C), Water Temperature (°C), Humidity (%), Solar Radiation (lux), Tank Level (L / %), and Fertigation Flow (L/min) have incompatible physical dimensions and ranges.
   - Forcing heterogeneous metrics onto a single shared Y-axis (such as 0–100%) produces misleading gradients and compressed traces.
   - The Matrix Line Chart architecture provides a dedicated panel for each metric with an independently scaled Y-axis, explicit physical unit label, and shared common 24H timeline (00:00 to 23:59).
2. **Visual Gaps Across Missing Telemetry**:
   - Sensor outages or communication dropouts must never be interpolated with straight lines across long gaps or falsely rendered as zero.
   - The `AreaChart` component breaks points into independent polyline/polygon segments whenever the time gap between consecutive points exceeds the threshold window (2 hours), leaving a genuine visual gap.
3. **High-Density Compact Card Protection**:
   - In metric summary cards with height $\le 60\text{px}$ (e.g. 44px top cards), axis tick text and milestone labels are suppressed via `compact={true}` to prevent text overflow and clipping.
4. **Dual Presentation Views**:
   - Operators can toggle between **Matrix Grid** (simultaneous 6-panel overview of all environmental dimensions) and **Single Focus** (expanded primary chart with 24H live profile and average delta comparison).

## 36.2 End-to-End Humidity Pipeline
1. **Physical Sensor Authority**:
   - The DHT22 sensor connected to GPIO 41 (`PIN_IN_DHT22`) is the authoritative source for air temperature and relative humidity.
2. **Firmware Descriptor & Registry Resolution**:
   - `hardware_registry.c` resolves `sensor_dht22_hum` to the parent component `sensor_dht22`.
   - `sensor_hal.c` exposes both `sensor_dht22` (Temperature, °C) and `sensor_dht22_hum` (Humidity, %) in `sensor_hal_list_configured()`.
3. **Canonical REST Contract**:
   - Current telemetry endpoint (`/api/v1/telemetry/current`) returns `metricId: "HUMIDITY"`, `unit: "%"`, `source: "HUMIDITY"`.
4. **Graceful Degradation Without Mock Data**:
   - When the physical DHT22 sensor is disconnected or unreadable, `quality: BAD` and `measurementType: UNAVAILABLE` with `value: null` are emitted.
   - Both Web UI and TFT render the unavailable state (`--.-` / `--%`) without mock numbers, NaN, or system faults.


