# TRINITY MASTER CONTEXT

**Project:** Greenhouse Fertigation & Research Platform\
**Document:** `TRINITY_MASTER_CONTEXT.md`\
**Version:** 1.0\
**Status:** Architectural Knowledge Baseline\
**Purpose:** Compressed-but-detailed context for future architecture,
API, UI, ESP32 firmware, Python backend, synchronization, and
integration work.

------------------------------------------------------------------------

# 0. How to Use This Document

This document is the **compressed architectural context**, not a
replacement for source code.

It deliberately preserves information that materially affects
architecture:

-   ownership,
-   source of truth,
-   responsibilities,
-   interfaces,
-   state,
-   data flow,
-   failure behavior,
-   persistence,
-   synchronization,
-   safety,
-   invariants,
-   scalability,
-   unresolved decisions.

It intentionally compresses repetitive prose, duplicated diagrams,
boilerplate, and implementation details that do not change architectural
behavior.

### Source hierarchy

When interpreting this context:

1.  **Current explicit project decisions** override older terminology.
2.  Existing project architecture is preserved unless explicitly
    changed.
3.  Implementation details must not silently redefine architecture.
4.  If a point is not specified here, it is an **open decision**, not an
    invitation to invent behavior.

### Important current correction

The original baseline architecture referred to a **React Frontend**. The
current UI direction is:

> **Single HTML Vite application**

The Trinity architecture therefore uses:

> **ESP32 = Runtime Anchor**\
> **Single HTML Vite = Orchestrator**\
> **Python Server = Data & Analysis Anchor**

This is an architectural evolution of the UI layer, not a change to
ESP32 physical authority.

------------------------------------------------------------------------

# 1. Trinity in One Sentence

The system consists of:

``` text
                    SINGLE HTML
                    ORCHESTRATOR
                   /            \
                  /              \
                 v                v
              ESP32             PYTHON
          Runtime Anchor    Data/Analysis Anchor
                 |                |
                 v                v
             Hardware        Permanent Data
```

The central rule is:

> **ESP32 must be able to operate independently.**

The UI and Python server are supporting systems, not prerequisites for
physical runtime.

------------------------------------------------------------------------

# 2. Fundamental Roles

## 2.1 ESP32 --- Runtime Anchor / Physical Authority

ESP32 owns the physical world and local runtime.

It is authoritative for:

-   physical actuator state,
-   sensor runtime state,
-   runtime timer,
-   schedule runtime,
-   local regulation,
-   safety state,
-   emergency handling,
-   hardware capability,
-   local execution state,
-   Last Valid Configuration,
-   local telemetry generation,
-   event generation,
-   failure detection,
-   local persistent/pending logs.

ESP32 must continue operating when:

-   Single HTML is closed,
-   Python is unavailable,
-   LAN is unavailable,
-   Internet is unavailable,

provided its local configuration remains valid and physical/safety
requirements are satisfied.

------------------------------------------------------------------------

## 2.2 Single HTML Vite --- Orchestrator

The UI is a browser application produced as a Vite build.

It is:

-   user interface,
-   operational console,
-   connectivity manager,
-   command initiator,
-   ESP32 data reader,
-   Python API client,
-   log synchronization agent,
-   data courier,
-   analysis client,
-   orchestration layer.

It is **not**:

-   physical controller,
-   safety authority,
-   permanent database,
-   runtime scheduler,
-   source of physical truth,
-   replacement for ESP32,
-   replacement for Python.

The UI can run without an application server if the built HTML/assets
are locally available.

The browser performs API communication through URLs.

------------------------------------------------------------------------

## 2.3 Python Server --- Data & Analysis Anchor

Python is the ecosystem/data side.

It owns:

-   ecosystem configuration,
-   configuration master,
-   recipe master,
-   schedule definitions,
-   calibration history/calculation,
-   permanent historical data,
-   raw ESP32 data archive,
-   processing,
-   analytics,
-   research,
-   reports,
-   cross-greenhouse data,
-   long-term storage.

Python may be non-dedicated for the current deployment.

Therefore **runtime cannot depend on continuous Python availability**.

------------------------------------------------------------------------

# 3. Independence Principle

The system must work in these modes.

## 3.1 ESP32 + UI + Python

Full system:

``` text
UI
 | \
 |  \
 v   v
ESP32 Python
 |      |
 v      v
HW      DB / Analytics
```

## 3.2 ESP32 + UI, Python unavailable

``` text
UI
 |
 v
ESP32
 |
 +-- runtime
 +-- telemetry
 +-- commands
 +-- local logs
 |
 +-- Python sync = pending
```

## 3.3 ESP32 alone

This is a first-class operational mode:

``` text
ESP32
 |
 +-- Last Valid Configuration
 +-- Local Schedule
 +-- Runtime Timer
 +-- Regulation
 +-- Sensors
 +-- Actuators
 +-- Safety
 +-- Local Logging
```

**No UI is required. No Python is required.**

If the stored configuration is valid and physical conditions permit
operation, ESP32 continues running.

## 3.4 UI unavailable

ESP32 continues independently.

## 3.5 Python unavailable

ESP32 continues independently and retains data locally until
synchronization becomes possible.

------------------------------------------------------------------------

# 4. Physical Authority Boundary

ESP32 is the final authority over physical execution and safety.

A command may originate from UI or Python:

``` text
UI / Python
    |
    | command
    v
ESP32
    |
    +-- component exists?
    +-- capability valid?
    +-- configuration valid?
    +-- safety condition?
    +-- interlock?
    +-- sensor condition?
    +-- timeout constraints?
    |
    +---- SAFE ------> EXECUTE
    |
    +---- UNSAFE ----> REJECT
```

Neither UI nor Python may bypass ESP32 safety.

HTTP success means request handling/acceptance, not physical completion.

Physical completion is determined from ESP32 runtime state, events,
telemetry, or command status.

------------------------------------------------------------------------

# 5. Source-of-Truth Matrix

  Domain                                    Authority
  ----------------------------------------- -------------
  Physical actuator state                   ESP32
  Sensor runtime state                      ESP32
  Runtime timer                             ESP32
  Schedule runtime                          ESP32
  Local regulation                          ESP32
  Safety state                              ESP32
  Last Valid Runtime Configuration          ESP32
  Local execution state                     ESP32
  Local pending logs                        ESP32
  Hardware capability/discovery             ESP32
  Ecosystem configuration                   Python
  Configuration master                      Python
  Recipe master                             Python
  Schedule definition                       Python
  Calibration history/calculation           Python
  Historical data                           Python
  Raw ESP32 archive                         Python
  Research data                             Python
  Analytics                                 Python
  Permanent storage                         Python
  Presentation state                        Single HTML
  Temporary orchestration/transport state   Single HTML

Important distinction:

``` text
Python configuration authority
        !=
ESP32 runtime authority
```

and:

``` text
UI display
        !=
physical truth
```

------------------------------------------------------------------------

# 6. Physical System Model

Current physical ownership model:

``` text
1 ESP32
   |
   v
1 Complex
   |
   +-- GH-01
   |    +-- Mixing Tank
   |
   +-- GH-02
   |    +-- Mixing Tank
   |
   +-- GH-N
        +-- Mixing Tank
```

A Complex may have shared resources such as central dosing pumps.

Each GH may have independent distribution/mixing resources.

ESP32 must support scalable collections rather than hard-coded
assumptions such as only `pumpA` and `pumpB`.

Use stable component IDs, for example:

``` text
PUMP-DOSE-01
VALVE-GH01-OUT
MIXER-GH02
```

Hardware GPIO mapping remains an ESP32 implementation concern.

UI and Python should address components through stable IDs/capabilities,
not GPIO numbers.

------------------------------------------------------------------------

# 7. Backend vs ESP32 Scheduling

Scheduling has two distinct concepts.

## 7.1 Schedule Definition --- Python

Python manages:

-   recurring schedule definition,
-   recipe association,
-   targets,
-   resource planning,
-   multi-GH coordination,
-   queue generation,
-   scheduling logic.

Example:

``` text
SCH-001
Days: Monday, Wednesday, Friday
Time: 08:00
Recipe: R-001
Target Water: 100 L
```

## 7.2 Schedule Runtime --- ESP32

ESP32 manages:

-   local timer,
-   trigger,
-   runtime state,
-   execution,
-   regulation,
-   safety,
-   actuator sequencing.

Therefore Python does **not** need to send:

``` text
START FERTIGATION NOW
```

for every scheduled event.

Once a valid schedule/runtime configuration is stored locally:

``` text
ESP32
  |
  v
Local Timer
  |
  v
Schedule Trigger
  |
  v
Local Regulation
  |
  v
Safety
  |
  v
Actuator
```

This is essential to offline operation.

------------------------------------------------------------------------

# 8. Fertigation Runtime

Fertigation is configuration-driven but physically executed by ESP32.

Python supplies parameters such as:

-   recipe,
-   schedule,
-   target water,
-   target dosing,
-   calibration,
-   resource allocation.

ESP32 performs:

``` text
Trigger
  |
  v
Fill / Mixing preparation
  |
  v
Dosing
  |
  v
Mixing
  |
  v
Distribution
  |
  v
Completion
  |
  v
Telemetry / Events
```

Backend may calculate required dosing volumes.

ESP32 uses validated runtime parameters for physical execution.

------------------------------------------------------------------------

# 9. Shared Dosing Resources

Central dosing pumps can be shared across GHs.

Example:

``` text
DP-001
DP-002
DP-003
DP-004
```

Potential conflict:

``` text
GH-01 -> DP-001 + DP-002
GH-02 -> DP-001 + DP-003
```

Python manages resource allocation/planning.

ESP32 manages actual physical sequencing and safety.

Mixing tanks can enter subsequent cycles as soon as their individual
distribution process allows.

------------------------------------------------------------------------

# 10. Calibration Boundary

Python:

-   stores calibration history,
-   calculates flow rate,
-   determines active calibration,
-   manages calibration records.

ESP32:

-   executes sampling,
-   controls pump/timer,
-   performs physical safety,
-   stores active calibration parameters,
-   reports execution data.

The boundary is:

``` text
Python
  |
  | calibration parameter
  v
ESP32
  |
  | physical calibration execution
  v
Telemetry / Result
  |
  v
Python
```

------------------------------------------------------------------------

# 11. Configuration Architecture

Python is configuration master.

ESP32 maintains:

> **Last Valid Configuration**

Configuration flow:

``` text
Python / UI
     |
     v
Backend validation
     |
     v
ESP32 validation
     |
  +--+--+
  |     |
VALID INVALID
  |     |
  v     v
Persist Reject
  |
  v
Active Runtime
```

ESP32 must never replace a valid active configuration with an invalid
one.

If a new configuration is rejected:

``` text
New Config
   |
   v
Reject
   |
   v
Last Valid Config remains active
```

------------------------------------------------------------------------

# 12. Configuration Versioning

Configuration versions are required for synchronization.

Potential structure:

``` json
{
  "config_version": 17,
  "schedule_version": 8,
  "recipe_version": 12,
  "calibration_version": 5
}
```

Example:

``` text
Python = v18
ESP32  = v17
```

Python/UI may propose v18.

ESP32 validates v18, persists it, and acknowledges it.

If:

``` text
Python = v18
ESP32  = v18
```

the corresponding configuration is synchronized.

Version comparison must not rely only on timestamps.

------------------------------------------------------------------------

# 13. Safe Configuration Updates During Runtime

Configuration updates must not arbitrarily corrupt an active physical
cycle.

General policy:

``` text
Current Operation
      |
      +-- complete safely
      |        OR
      +-- abort safely
      |
      v
New Configuration
      |
      v
Validate
      |
      v
Persist
      |
      v
Next Applicable Cycle
```

Safety-critical parameters may have stricter immediate-update behavior,
but exact behavior belongs to API/system requirements.

------------------------------------------------------------------------

# 14. ESP32 Local Persistence

At minimum, ESP32 needs persistent storage for:

-   Last Valid Configuration,
-   active schedule/runtime configuration,
-   active recipe parameters,
-   calibration parameters,
-   actuator/component configuration,
-   safety parameters,
-   local runtime state as required,
-   pending/local events and logs.

Boot model:

``` text
BOOT
 |
 v
Load persisted configuration
 |
 v
Validate integrity
 |
 +---- invalid ----> SAFE / relevant function halted
 |
 +---- valid ------> restore runtime
                       |
                       v
                   evaluate schedule
                       |
                       v
                   continue safely
```

UI and Python are not dependencies for boot-time runtime recovery.

------------------------------------------------------------------------

# 15. Log Architecture --- Core Model

ESP32 is the **runtime log origin**.

Python is the **permanent historical anchor**.

Single HTML is the **intermittent courier/synchronization agent**.

Flow:

``` text
Physical Event
     |
     v
ESP32 Runtime
     |
     +-- telemetry
     +-- event
     +-- failure
     +-- fertigation execution
     +-- sensor error
     +-- pump error
     +-- valve error
     +-- recovery
     |
     v
Local Persistent Storage
     |
     | when Python reachable
     v
Single HTML
     |
     v
Python Ingestion
     |
     v
Permanent Raw Storage
     |
     v
Processing / Analytics
```

The crucial property:

> **Python downtime must not destroy runtime history.**

------------------------------------------------------------------------

# 16. Log Record Identity

A log record should have stable identity.

Recommended conceptual structure:

``` json
{
  "device_id": "ESP32-001",
  "sequence": 47301,
  "record_id": "ESP32-001:47301",
  "device_timestamp": "...",
  "record_type": "TELEMETRY",
  "payload": {}
}
```

Rules:

-   `device_id` identifies the controller.
-   `sequence` is monotonic for that device.
-   `record_id` is stable.
-   sequence is preferred for device-local ordering.
-   timestamp is not the sole identity.
-   payload retains raw event/telemetry information.

Exact schema belongs in the future API/data contract.

------------------------------------------------------------------------

# 17. Timestamp Model

Distinguish:

``` text
device_timestamp
received_at
processed_at
```

Meaning:

-   `device_timestamp` = when physical event occurred according to
    ESP32.
-   `received_at` = when Python received it.
-   `processed_at` = when processing completed.

Historical analysis must preserve physical occurrence time.

Offline duration must not shift the event's actual time to the eventual
upload time.

------------------------------------------------------------------------

# 18. Log Synchronization

Do not repeatedly perform:

``` text
GET ALL LOGS
```

Use bounded incremental batches.

Concept:

``` text
ESP32 latest sequence = 50000
Python acknowledged  = 47300
```

Pending range:

``` text
47301 ... 50000
```

UI requests:

``` text
GET /logs?after=47300&limit=500
```

ESP32 returns:

``` text
47301 ... 47800
```

UI uploads the batch to Python.

Python acknowledges:

``` text
ACK 47800
```

UI continues:

``` text
47801 ...
```

The synchronization cursor/watermark must advance only after durable
acknowledgement.

------------------------------------------------------------------------

# 19. At-Least-Once Delivery

The transport should prefer:

``` text
At-least-once delivery
+
Stable identity
+
Idempotent ingestion
+
Acknowledgement
```

Do not attempt to make the network itself guarantee exactly-once
delivery.

Failure scenario:

``` text
UI -> Python
       |
       | batch 47301..47800
       v
Python stores data
       |
       X ACK lost
       |
UI retries same batch
       |
       v
Python recognizes duplicates
       |
       v
same durable ACK
```

Result:

``` text
No duplicate historical records
```

------------------------------------------------------------------------

# 20. Log Retention

Local records should not be deleted merely because an upload request was
sent.

Conceptual lifecycle:

``` text
LOCAL_ONLY
    |
    v
READY_FOR_SYNC
    |
    v
TRANSFERRED
    |
    v
ACKNOWLEDGED
    |
    v
RETENTION POLICY
    |
    v
ELIGIBLE FOR CLEANUP
```

The exact deletion/retention policy is still an implementation decision.

Safety/failure records should receive higher preservation priority than
low-value telemetry if storage pressure occurs.

------------------------------------------------------------------------

# 21. Backpressure

ESP32 storage is finite.

The UI/sync system should be able to determine:

``` text
pending_records
oldest_pending
newest_pending
storage_usage
storage_capacity
```

Potential priority:

1.  safety events,
2.  failure events,
3.  command/execution records,
4.  critical telemetry,
5.  normal telemetry.

No silent data loss.

Exact overflow behavior remains an open design decision.

------------------------------------------------------------------------

# 22. Single HTML as Data Courier

The UI does not need to be continuously open.

If UI closes:

``` text
UI OFF
 |
 v
ESP32 continues
 |
 v
logs remain locally stored
```

When UI opens:

``` text
UI
 |
 v
ESP32
 |
 v
discover pending range
 |
 v
retrieve batch
 |
 v
Python
```

Therefore the UI acts as an **intermittent synchronization agent**, not
as the permanent data store.

------------------------------------------------------------------------

# 23. Single HTML Deployment

Single HTML Vite can be deployed independently of API hosting.

### Mode A --- Local PC/HP

``` text
PC / HP
 |
 | local HTML
 v
Browser
 |
 | REST
 v
ESP32
```

### Mode B --- Hosted by ESP32

``` text
Browser
 |
 | GET /
 v
ESP32
 |
 +-- index.html/assets
 +-- REST API
 +-- hardware
```

The second mode is optional.

ESP32 does not need to serve HTML to be an API server.

The browser runs the JavaScript.

------------------------------------------------------------------------

# 24. Browser API Principle

The UI only needs a URL and an API contract.

Conceptually:

``` javascript
fetch(ESP32_URL + "/api/...")
fetch(PYTHON_URL + "/api/...")
```

The exact implementation may differ, but the architectural principle is:

> **Web UI is a client of APIs, not a server dependency.**

Potential browser concerns for direct ESP32 communication:

-   CORS,
-   `file://` origin behavior,
-   HTTP/HTTPS mixed-content rules,
-   LAN reachability,
-   firewall,
-   browser security policies.

These are deployment concerns and must be addressed without changing the
Trinity ownership model.

------------------------------------------------------------------------

# 25. Connectivity Model

ESP32 and Python are independent endpoints.

Each has:

``` text
LOCAL
REMOTE
OFFLINE
```

Potential transport hierarchy:

``` text
ESP32:
  Local WLAN
      |
      v
  Remote transport
      |
      v
  Offline

Python:
  Local network
      |
      v
  Remote transport
      |
      v
  Offline
```

Remote mechanism is intentionally not finalized.

Future options may include:

-   SSH tunnel,
-   VPN,
-   reverse tunnel,
-   gateway,
-   internet endpoint.

The UI should use a **transport abstraction** so the domain/UI does not
care which remote mechanism is used.

------------------------------------------------------------------------

# 26. Transport Abstraction

Conceptual:

``` text
ESP32Transport
 |
 +-- LocalWLAN
 +-- Remote
 +-- Future

PythonTransport
 |
 +-- Local
 +-- Remote
 +-- Future
```

Pages should not contain network fallback logic.

Bad:

``` text
GreenhousePage
  -> fetch LAN ESP32
  -> try SSH
  -> try Python
```

Preferred:

``` text
GreenhousePage
      |
      v
Domain Service
      |
      v
Connection / Transport Manager
      |
      +-- ESP32 local
      +-- ESP32 remote
      +-- Python local
      +-- Python remote
```

------------------------------------------------------------------------

# 27. Connectivity State Machine

Do not use only `online=true/false`.

Conceptual state:

``` text
UNKNOWN
   |
   v
CONNECTING
   |
   +----> CONNECTED
   |          |
   |          v
   |        STALE
   |          |
   |          v
   +------ OFFLINE
```

The UI should distinguish:

``` text
CONNECTED
STALE
OFFLINE
UNKNOWN
```

A displayed last-known value must not be presented as current truth when
the endpoint is unavailable.

Example:

``` text
Temperature: 28.4 °C
Status: STALE
Last update: 12:01:05
```

not simply:

``` text
Temperature: 28.4 °C
```

when the ESP32 is offline.

------------------------------------------------------------------------

# 28. Startup Orchestration

When the Single HTML UI starts:

``` text
UI START
   |
   v
Load UI/endpoint configuration
   |
   v
Probe ESP32 Local WLAN
   |
   +-- success --> inventory
   |               configuration
   |               runtime state
   |               telemetry
   |               log metadata
   |
   +-- failure --> configured ESP32 remote transport
   |
   +-- failure --> ESP32 unavailable
   |
   v
Probe Python Local
   |
   +-- success --> backend status/sync
   |
   +-- failure --> configured Python remote transport
   |
   +-- failure --> Python unavailable
   |
   v
Construct UI capability state
```

The first priority is ESP32 because current UI pages are operationally
ESP32-oriented.

------------------------------------------------------------------------

# 29. Current UI Domain Direction

Current pages are primarily **operational / ESP32-oriented**.

They should answer:

> **What is happening physically now?**

Examples:

-   greenhouse runtime,
-   pumps,
-   valves,
-   telemetry,
-   current fertigation,
-   schedule runtime,
-   hardware,
-   configuration,
-   safety,
-   events.

Future pages can become **analytical / Python-oriented**.

They should answer:

> **What happened, what does it mean, and what can we learn?**

Examples:

-   history,
-   trend,
-   comparison,
-   resource consumption,
-   experiments,
-   plant/fruit research,
-   yield,
-   long-term reports,
-   analytics.

Both domains can exist inside the same Single HTML application.

------------------------------------------------------------------------

# 30. Operational vs Analytical Data

Operational path:

``` text
ESP32
  |
  v
Single HTML
```

is primarily for:

-   current state,
-   runtime,
-   telemetry,
-   commands,
-   events,
-   local logs.

Analytical path:

``` text
ESP32
  |
  v
Single HTML
  |
  v
Python
  |
  v
Analysis
  |
  v
Single HTML
```

is for:

-   historical data,
-   analysis,
-   research,
-   reports,
-   long-term ecosystem knowledge.

The analytical result is not automatically physical truth.

------------------------------------------------------------------------

# 31. Command Architecture

Commands need unique IDs.

Example:

``` text
CMD-20260909-000123
```

Conceptual lifecycle:

``` text
REQUESTED
   |
   v
ACCEPTED
   |
   v
SENT
   |
   v
RECEIVED
   |
   v
EXECUTING
   |
   v
COMPLETED
```

Alternative:

``` text
REQUESTED -> REJECTED
```

or:

``` text
EXECUTING -> FAILED
```

The exact lifecycle may be simplified at implementation level, but the
distinction between request acceptance and physical completion must
remain.

------------------------------------------------------------------------

# 32. Command Idempotency

Network retry must not cause duplicate physical execution.

Example:

``` text
UI
 |
 | CMD-001
 v
ESP32
 |
 | ACCEPTED
 v
UI

ACK/response lost

UI retries CMD-001
 |
 v
ESP32
 |
 +-- recognizes existing command
 +-- does not execute twice
 +-- returns current status
```

This is especially important for:

-   pump start,
-   valve movement,
-   dosing,
-   fertigation execution,
-   emergency-related commands.

------------------------------------------------------------------------

# 33. Manual Command vs Schedule Runtime

Manual command:

``` text
UI
 |
 v
ESP32
 |
 v
validate
 |
 v
execute
```

Schedule runtime:

``` text
Stored Schedule
 |
 v
ESP32 Local Timer
 |
 v
Trigger
 |
 v
Runtime execution
```

The UI does not need to continuously drive a schedule.

------------------------------------------------------------------------

# 34. Emergency Stop

Emergency stop must remain local to the physical authority.

Preferred:

``` text
UI
 |
 v
ESP32
 |
 v
Safety subsystem
 |
 v
Emergency Stop
```

Python is not required for immediate physical safety.

The resulting event can later be synchronized to Python.

------------------------------------------------------------------------

# 35. Hardware Discovery and Synchronization

ESP32 is the physical source for hardware discovery.

Concept:

``` text
ESP32
 |
 | inventory
 v
Single HTML / Python
 |
 v
component registry
```

The backend should not blindly assume hardware based on UI
configuration.

Hardware synchronization must preserve history.

If a component disappears:

``` text
UNAVAILABLE
```

is preferred over immediate deletion.

Do not:

-   delete historical records,
-   delete calibration history,
-   delete telemetry,
-   delete events,
-   reset recipes,
-   reset schedules,
-   change stable component IDs

merely because a component is currently unavailable.

------------------------------------------------------------------------

# 36. Configuration and Hardware Validation

Two-stage validation:

``` text
Backend validation
        |
        v
ESP32 validation
        |
        v
Persist
```

Backend checks:

-   format,
-   relationships,
-   completeness,
-   resource conflicts,
-   ecosystem validity.

ESP32 checks:

-   physical capability,
-   actual component availability,
-   runtime constraints,
-   safety constraints,
-   configuration compatibility.

The ESP32 validation is authoritative for physical executability.

------------------------------------------------------------------------

# 37. Raw-First Data Principle

Python ingestion should follow:

> **Store first, process second.**

Concept:

``` text
ESP32 JSON
   |
   v
Python ingestion
   |
   v
Raw storage
   |
   +-- validation
   +-- processing
   +-- telemetry model
   +-- event model
   +-- failure model
   +-- analytics
```

If processing fails:

``` text
Raw data remains.
```

Reasons:

-   retry,
-   debugging,
-   audit,
-   reprocessing,
-   future analytics.

Raw ESP32 payload must not be silently replaced by processed data.

------------------------------------------------------------------------

# 38. Data Flow --- Telemetry

``` text
Sensor
  |
  v
ESP32
  |
  v
Telemetry Record
  |
  +--> local persistence
  |
  v
Single HTML
  |
  v
Python
  |
  v
Raw Storage
  |
  v
Processing
  |
  v
Telemetry / Analytics
  |
  v
Analytical UI
```

For current operational display, the UI can read directly from ESP32.

------------------------------------------------------------------------

# 39. Data Flow --- Event

``` text
ESP32
  |
  v
Event Record
  |
  +--> local persistence
  |
  v
Single HTML
  |
  v
Python
  |
  v
Raw Storage
  |
  v
Event Processing
```

------------------------------------------------------------------------

# 40. Data Flow --- Failure

``` text
Physical failure
      |
      v
ESP32 detection
      |
      +-- immediate safety response
      |
      +-- local failure record
      |
      v
Single HTML / later sync
      |
      v
Python
      |
      v
Raw + processed failure history
```

ESP32 detects and handles physical failure.

Python processes and analyzes the history.

------------------------------------------------------------------------

# 41. Reconnection and Reconciliation

Reconnection is not simply:

``` text
connected = true
```

It should initiate synchronization/reconciliation.

For Python:

``` text
Connection restored
       |
       v
Read ESP32 state
       |
       +-- configuration version
       +-- runtime state
       +-- pending log range
       +-- inventory/version
       |
       v
Compare with Python
       |
       +-- upload missing data
       +-- compare configuration
       +-- synchronize valid configuration
       +-- preserve physical state
       |
       v
Normal synchronized state
```

Configuration synchronization must never blindly overwrite active
physical state.

------------------------------------------------------------------------

# 42. Configuration Reconciliation

Example:

``` text
Python config = 18
ESP32 config  = 17
```

If Python's version is valid and intended:

``` text
Python
  |
  v
send v18
  |
  v
ESP32 validate
  |
  +-- valid --> persist + activate according to safe update policy
  |
  +-- invalid -> reject + retain v17
```

The physical runtime anchor decides whether a configuration is
executable.

------------------------------------------------------------------------

# 43. Failure Matrix

  ---------------------------------------------------------------------------
  ESP32             Python            UI                Expected capability
  ----------------- ----------------- ----------------- ---------------------
  Online            Online            Online            Full system

  Online            Offline           Online            Runtime + local
                                                        logs + pending Python
                                                        sync

  Online            Online            Offline           ESP32 continues
                                                        independently

  Online            Offline           Offline           ESP32 standalone

  Offline           Online            Online            Analysis available;
                                                        physical live state
                                                        unavailable through
                                                        UI

  Offline           Offline           Online            UI must show
                                                        unavailable/unknown
                                                        runtime, never
                                                        fabricate state

  Offline           Online            Offline           Python ecosystem can
                                                        continue its own
                                                        functions

  Offline           Offline           Offline           ESP32 retains
                                                        independent physical
                                                        state
  ---------------------------------------------------------------------------

The key principle:

> **Connectivity loss degrades capability; it must not corrupt state.**

------------------------------------------------------------------------

# 44. Database Failure

Python database failure must not automatically become ESP32 failure.

Priority:

``` text
1. Physical Safety
2. Runtime Integrity
3. Raw Data Preservation
4. Recovery
```

Exact Python-side buffering/durability implementation remains an
implementation requirement.

------------------------------------------------------------------------

# 45. No Hard-Coded Hardware

The architecture must scale from:

``` text
few pumps
few sensors
few GH
```

to:

``` text
N pumps
N sensors
N GH
N Complex
N experiments
N plants
N fruits
N observations
```

Avoid code that assumes a fixed number of hardware components.

Use collections and stable IDs.

------------------------------------------------------------------------

# 46. API Boundary --- Conceptual

ESP32 should expose device/runtime-oriented operations.

Possible conceptual endpoints:

``` text
GET  /api/v1/inventory
GET  /api/v1/configuration
POST /api/v1/configuration/validate
PUT  /api/v1/configuration
GET  /api/v1/runtime
GET  /api/v1/telemetry
GET  /api/v1/events
GET  /api/v1/logs
GET  /api/v1/commands/{commandId}
POST /api/v1/commands
POST /api/v1/clock-sync
POST /api/v1/commands/emergency-stop
```

Python should expose ecosystem/data/analysis-oriented operations, for
example:

``` text
POST /api/v1/ingest/esp32
GET  /api/v1/history/...
GET  /api/v1/analysis/...
GET  /api/v1/research/...
GET  /api/v1/configuration/...
```

These are architectural examples, not frozen final API names.

------------------------------------------------------------------------

# 47. API Contract Rule

Every important endpoint should eventually define:

-   purpose,
-   method,
-   path,
-   authentication,
-   request schema,
-   response schema,
-   error schema,
-   status codes,
-   idempotency behavior,
-   timeout behavior,
-   retry behavior,
-   source-of-truth semantics.

Do not let UI implementation become the undocumented API contract.

------------------------------------------------------------------------

# 48. Component Identity and Capability

UI should request semantic operations:

``` json
{
  "componentId": "PUMP-DOSE-01",
  "action": "START",
  "parameters": {
    "durationSeconds": 60
  }
}
```

rather than:

``` text
GPIO 25 = HIGH
```

ESP32 translates stable component identity/capability into hardware
implementation.

This preserves hardware abstraction.

------------------------------------------------------------------------

# 49. Transport vs Domain Separation

Domain logic must not know whether communication is:

``` text
LAN
SSH
VPN
Internet
```

It should know:

``` text
ESP32 endpoint
Python endpoint
```

Transport manager handles reachability.

This allows remote connectivity to be implemented later without
redesigning pages.

------------------------------------------------------------------------

# 50. UI State Categories

The UI should distinguish:

``` text
ESP32 Runtime State
Python Persistent State
UI Presentation State
Connection State
Synchronization State
Command State
```

These must not be collapsed into one generic state object.

Example:

``` text
ESP32:
  pump = ON

UI:
  displayed pump = ON

Connection:
  STALE
```

The UI must show that the displayed value is stale rather than silently
treating it as live.

------------------------------------------------------------------------

# 51. Synchronization State

Conceptual UI sync state:

``` text
IDLE
DISCOVERING
FETCHING
UPLOADING
ACKNOWLEDGING
COMPLETE
RETRYING
BLOCKED
```

Failure should preserve the last safe cursor.

Example:

``` text
ACK = 47800

next sync:
after = 47800
```

not:

``` text
restart from zero
```

------------------------------------------------------------------------

# 52. Data Integrity Invariants

### Invariant 1

ESP32 runtime does not require UI.

### Invariant 2

ESP32 runtime does not require Python availability.

### Invariant 3

Physical safety authority remains inside ESP32.

### Invariant 4

UI cannot manufacture physical state.

### Invariant 5

Python cannot bypass ESP32 physical validation.

### Invariant 6

Pending logs remain locally recoverable until acknowledged.

### Invariant 7

Repeated network delivery must not duplicate history.

### Invariant 8

A configuration is not active until ESP32 validates it.

### Invariant 9

Historical data survives configuration changes.

### Invariant 10

Transport changes do not change domain behavior.

### Invariant 11

Schedule runtime executes locally on ESP32.

### Invariant 12

Python outage is a synchronization problem, not automatically a
physical-runtime problem.

### Invariant 13

UI outage is an interface problem, not a physical-runtime problem.

### Invariant 14

A stale value is never presented as current truth.

### Invariant 15

Raw data is preserved before processing.

------------------------------------------------------------------------

# 53. What Must Never Happen

Never design:

``` text
Browser closed
    |
    v
ESP32 schedule stops
```

Never design:

``` text
Python offline
    |
    v
ESP32 stops normal runtime
```

Never design:

``` text
HTTP 200
    |
    v
assume pump physically completed
```

Never design:

``` text
UI cannot reach ESP32
    |
    v
display actuator OFF
```

when the real state is unknown.

Never design:

``` text
upload request sent
    |
    v
delete local log
```

before durable acknowledgement.

Never design:

``` text
GPIO number
    |
    v
UI
```

as the hardware abstraction.

------------------------------------------------------------------------

# 54. Operational Priority

When the system is degraded, priorities are:

``` text
PHYSICAL SAFETY
       >
RUNTIME CONTINUITY
       >
LOCAL DATA PRESERVATION
       >
SYNCHRONIZATION
       >
ANALYSIS
       >
PRESENTATION CONVENIENCE
```

This priority is intentional.

------------------------------------------------------------------------

# 55. Architectural Mental Model

Think of the system as three planes.

## Physical / Operational Plane

``` text
ESP32
```

Question:

> What is physically happening and what may safely happen?

## Orchestration Plane

``` text
Single HTML
```

Question:

> How does the user interact with the operational and analytical worlds,
> and how is data moved between them?

## Data / Analytical Plane

``` text
Python
```

Question:

> What has happened, what should be stored permanently, and what does
> the history mean?

------------------------------------------------------------------------

# 56. Full Trinity Flow

``` text
                              USER
                                |
                                v
                    +-----------------------+
                    |     SINGLE HTML       |
                    |       VITE UI         |
                    |                       |
                    |      ORCHESTRATOR     |
                    +-----------+-----------+
                                |
                 +--------------+--------------+
                 |                             |
                 v                             v
        +----------------+            +----------------+
        |     ESP32      |            |     PYTHON     |
        | RUNTIME ANCHOR |            | DATA/ANALYSIS  |
        |                |            |     ANCHOR     |
        +-------+--------+            +-------+--------+
                |                             |
        +-------+-------+             +-------+-------+
        |       |       |             |       |       |
        v       v       v             v       v       v
     Sensors Pumps   Valves          Raw     DB   Analytics
                                        |
                                        v
                                    Research
```

Primary communication:

``` text
ESP32 <-> Single HTML
Single HTML <-> Python
```

Python and ESP32 may also communicate directly in future/other modes,
but the current browser-orchestrated synchronization path is:

``` text
ESP32 -> Single HTML -> Python
```

------------------------------------------------------------------------

# 57. Normal Operation

``` text
Python
  |
  | configuration / parameters
  v
ESP32
  |
  | persist Last Valid Configuration
  v
Local Runtime
  |
  v
Timer / Schedule
  |
  v
Regulation
  |
  v
Safety
  |
  v
Actuator
  |
  v
Sensor / Event
  |
  v
Local Log
  |
  v
Single HTML
  |
  v
Python
  |
  +-- Raw Storage
  +-- Processing
  +-- Analytics
```

The UI can independently read ESP32 state for immediate operational
display.

------------------------------------------------------------------------

# 58. Offline Python

``` text
Python
   X

ESP32
 |
 +-- Last Valid Config
 +-- Schedule Runtime
 +-- Regulation
 +-- Safety
 +-- Hardware
 +-- Local Logging
 |
 v
Pending Records
```

When Python returns:

``` text
UI
 |
 v
ESP32 pending range
 |
 v
batch
 |
 v
Python ingest
 |
 v
ACK
 |
 v
next batch
```

------------------------------------------------------------------------

# 59. Offline UI

``` text
UI
 X

ESP32
 |
 +-- continues runtime
 +-- continues logging
 +-- retains configuration
```

When UI returns:

``` text
UI
 |
 v
ESP32 state
 |
 +-- runtime
 +-- telemetry
 +-- events
 +-- pending logs
```

------------------------------------------------------------------------

# 60. Standalone ESP32

The strongest independence guarantee is:

``` text
UI = OFF
Python = OFF

        |
        v

      ESP32
        |
        +-- Configuration
        +-- Timer
        +-- Schedule
        +-- Regulation
        +-- Safety
        +-- Hardware
        +-- Logging
```

This is not an emergency-only mode. It is a legitimate runtime
capability.

------------------------------------------------------------------------

# 61. Future Analytical UI

The same Single HTML application may later expose:

``` text
Operational
   |
   +-- Runtime
   +-- Hardware
   +-- Telemetry
   +-- Events
   +-- Commands

Analytical
   |
   +-- History
   +-- Trends
   +-- Research
   +-- Comparison
   +-- Reports
   +-- Analytics
```

Operational pages primarily query ESP32.

Analytical pages primarily query Python.

Synchronization pages bridge the two.

------------------------------------------------------------------------

# 62. Security Boundary

Local network must not automatically be treated as trusted.

Every ESP32 command still requires device-side validation.

Do not embed permanent confidential secrets into a browser bundle.

Potential production model:

``` text
Browser
   |
   | authenticated session
   v
Python / Gateway
   |
   v
ESP32
```

while direct local ESP32 access can remain available where appropriate.

Exact authentication architecture is an open implementation/security
decision.

------------------------------------------------------------------------

# 63. Remote Connectivity

Remote access is intentionally reserved as an abstraction now.

The architecture should support:

``` text
Local:
    http://ESP32-LAN
    http://PYTHON-LAN

Future remote:
    configured remote endpoint
```

The specific mechanism can later be:

``` text
SSH tunnel
VPN
reverse tunnel
gateway
internet
```

The UI should not need to know which mechanism is used.

------------------------------------------------------------------------

# 64. Scalability

Initial:

``` text
1 Complex
1 ESP32
few GH
few pumps
few sensors
```

Target:

``` text
N Complex
N ESP32
N GH
N components
N experiments
N plants
N fruits
N observations
```

The architecture should scale without changing the fundamental Trinity.

Stable identifiers and collections are therefore architectural
requirements.

------------------------------------------------------------------------

# 65. Architectural Decisions Already Established

The following are currently established:

1.  ESP32 can operate independently.
2.  ESP32 uses Last Valid Configuration.
3.  Python is not a mandatory runtime dependency.
4.  UI is being implemented as Single HTML Vite.
5.  UI is an orchestrator.
6.  ESP32 is physical/runtime authority.
7.  Python is permanent data/analysis anchor.
8.  ESP32 stores logs locally until synchronization.
9.  UI can retrieve ESP32 logs.
10. UI can push ESP32 logs to Python.
11. UI can request analysis from Python.
12. Current UI is primarily ESP32-oriented.
13. Future UI pages will include Python-oriented analysis/storage views.
14. ESP32 should be contacted through local WLAN first.
15. Remote ESP32 connectivity should have a reserved abstraction.
16. Python local connectivity should have a reserved abstraction.
17. If Python is unavailable, ESP32 operation continues.
18. If UI is unavailable, ESP32 operation continues.
19. Synchronization must be resumable.
20. Physical safety remains local to ESP32.

------------------------------------------------------------------------

# 66. Open Decisions

The following are intentionally not frozen:

-   exact REST endpoint names,
-   exact JSON schemas,
-   authentication mechanism,
-   SSH/VPN/internet transport,
-   remote endpoint discovery,
-   exact ESP32 storage technology,
-   exact log retention period,
-   exact storage overflow policy,
-   exact configuration update semantics for every parameter class,
-   exact command status model,
-   exact telemetry sampling strategy,
-   exact Python database technology,
-   exact raw-storage implementation,
-   exact UI state-management library/implementation,
-   exact service-worker/offline-cache strategy,
-   exact deployment packaging.

These should be decided explicitly rather than inferred accidentally
from implementation.

------------------------------------------------------------------------

# 67. Recommended Future Specification Documents

The master context should eventually be decomposed into focused
contracts:

``` text
TRINITY_MASTER_CONTEXT.md
 |
 +-- ESP32_API_SPEC.md
 +-- PYTHON_API_SPEC.md
 +-- COMMAND_PROTOCOL.md
 +-- CONFIGURATION_PROTOCOL.md
 +-- LOG_SYNC_PROTOCOL.md
 +-- TELEMETRY_SCHEMA.md
 +-- EVENT_SCHEMA.md
 +-- ERROR_MODEL.md
 +-- CONNECTION_MANAGER.md
 +-- SECURITY_MODEL.md
 +-- UI_ORCHESTRATION.md
 +-- DEPLOYMENT_MODEL.md
```

These are **future specification artifacts**, not current requirements
to create all at once.

------------------------------------------------------------------------

# 68. Implementation Order

Recommended sequence:

``` text
1. ESP32 persistent runtime
2. ESP32 REST contract
3. inventory / capability API
4. runtime state API
5. telemetry/event/log API
6. command lifecycle
7. command idempotency
8. configuration versioning
9. Single HTML ESP32 connection manager
10. Python ingestion
11. log synchronization
12. raw permanent storage
13. reconciliation
14. Python analysis API
15. analytical UI
16. remote transport
17. security hardening
18. multi-device scaling
```

Do not begin with remote connectivity before the local contract is
stable.

------------------------------------------------------------------------

# 69. Final Architectural Constitution

The Trinity is governed by these statements:

> **ESP32 is the last operational authority.**

> **ESP32 must survive the absence of UI and Python.**

> **Single HTML is the orchestrator, not the engine.**

> **Python is the permanent data and analysis anchor, not the physical
> runtime.**

> **UI communicates through APIs and does not own physical truth.**

> **Physical safety is enforced locally at ESP32.**

> **Last Valid Configuration allows autonomous runtime.**

> **Local logs protect history during Python/UI/network failure.**

> **Synchronization moves data from ESP32 to Python without making UI a
> permanent store.**

> **At-least-once transport plus stable identity and idempotent
> ingestion protects historical integrity.**

> **Configuration is authoritative at Python but executable only after
> ESP32 validation.**

> **Schedule definition belongs to Python; schedule execution belongs to
> ESP32.**

> **Connectivity loss reduces capability; it does not redefine
> ownership.**

> **Remote transport may change; domain architecture must not.**

> **Operational UI and analytical UI may share one Single HTML
> application while remaining different domains.**

------------------------------------------------------------------------

# 70. Canonical Mental Model

When making any future architectural decision, reduce it to these
questions:

### Question 1

**Who owns the truth?**

``` text
Physical/runtime -> ESP32
Permanent/ecosystem -> Python
Presentation/orchestration -> Single HTML
```

### Question 2

**What happens when the network disappears?**

The answer must preserve local authority and data.

### Question 3

**What happens when Python disappears?**

ESP32 continues.

### Question 4

**What happens when UI disappears?**

ESP32 continues.

### Question 5

**Can the operation be safely executed physically?**

ESP32 decides.

### Question 6

**Has historical data been durably preserved?**

If not acknowledged by the permanent data anchor, retain it locally.

### Question 7

**Can a retry execute something twice?**

If yes, add command identity/idempotency.

### Question 8

**Is a displayed value really current?**

If connectivity is stale/offline, label it accordingly.

### Question 9

**Is the design tied to LAN/SSH/VPN?**

If yes, move that detail behind transport abstraction.

### Question 10

**Does the implementation accidentally make UI or Python a runtime
dependency?**

If yes, the design violates Trinity.

------------------------------------------------------------------------

# 71. End State

The intended system is not:

``` text
Browser
   |
   v
Python
   |
   v
ESP32
```

as a mandatory chain.

The intended system is:

``` text
                         USER
                           |
                           v
                  SINGLE HTML VITE
                     ORCHESTRATOR
                    /            \
                   /              \
                  v                v
              ESP32             PYTHON
         RUNTIME ANCHOR     DATA/ANALYSIS ANCHOR
              |                    |
              v                    v
          HARDWARE             PERMANENT DATA
                                   |
                                   v
                              ANALYTICS
```

with the strongest guarantee:

``` text
                  UI OFF
                    |
                  PYTHON OFF
                    |
                    v
                  ESP32
                    |
                    v
        LAST VALID CONFIGURATION
                    |
                    v
              LOCAL RUNTIME
                    |
                    v
                 HARDWARE
```

The UI returns later.

Python returns later.

Connectivity returns later.

**The physical system does not have to wait.**
