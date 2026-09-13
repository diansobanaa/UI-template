# AI AGENT BLINDSPOT AUDIT PROMPT V1
## UI ↔ ESP32 Codebase Deep Audit — Audit Only, No Fixes

You are performing a deep blindspot audit of the existing AgroTech project.

Your objective is NOT to implement features and NOT to improve architecture for its own sake.

Your objective is to discover things we have not thought about yet that could later cause:
- wrong behavior;
- integration failures;
- unsafe physical behavior;
- corrupted state;
- inconsistent UI/device state;
- unrecoverable runtime conditions;
- installation/commissioning problems;
- scalability problems;
- subtle race conditions;
- contract drift;
- hidden assumptions;
- failures after reboot, timeout, reconnect, power loss, partial hardware installation, or multi-GH expansion.

The audit covers:

```text
EXISTING VITE/REACT UI
        ↕
ESP32 REST/API
        ↕
ESP32 runtime
        ↕
ESP32 storage
        ↕
ESP32 hardware abstraction
        ↕
physical hardware assumptions
```

## OUT OF SCOPE

Do NOT audit, design, or implement the Python backend yet.

Do NOT redesign the UI.

Do NOT redesign the ESP32 architecture merely because you prefer another design.

Do NOT implement fixes during this audit.

Do NOT install or flash firmware.

Do NOT assume hardware has already been assembled.

The purpose of this pass is to create a high-confidence blindspot inventory before hardware installation.

---

# 1. IMPORTANT CONTEXT

The ESP32 firmware already exists in the repository but has not yet been flashed/installed.

The hardware has NOT yet been physically assembled.

Therefore distinguish:

```text
SOFTWARE-VERIFIED
PHYSICAL-HARDWARE-UNVERIFIED
REQUIRES DATASHEET / HARDWARE VERIFICATION
```

Never report software evidence as physical-hardware proof.

---

# 2. CORE PRINCIPLES TO VERIFY

Check the actual repository against these project principles:

1. Existing Vite/React UI is protected existing work.
2. Direct MVP is UI ↔ ESP32 over local WLAN/LAN.
3. Python is not required for direct UI ↔ ESP32 operation.
4. ESP32 is runtime/physical authority.
5. UI is not physical truth.
6. Browser timers must not become the physical runtime scheduler.
7. HTTP success must not be treated as physical completion.
8. Canonical shared API contract:
   `template/contracts/UI_ESP32_OPENAPI.yaml`
9. ESP32 project root:
   `template/esp32/`
10. Durable AI handover state:
    `GEMINI.md`
    `AI_PROGRESS.md`
    `AI_HANDOVER.md`
    `AI_DECISIONS.md`
    `AI_CHANGELOG.md`

Verify implementation, not documentation claims.

---

# 3. REPOSITORY DISCOVERY

Before conclusions, inspect the actual repository.

At minimum inspect:

```text
template/
template/contracts/
template/esp32/
existing UI entry points
service/adaptor/API layer
ESP32 client
TypeScript types
OpenAPI
configuration
calibration
schedule/timer
crop-cycle
telemetry/events
storage
network
hardware registry
sensor drivers
actuator drivers
tests
build configuration
ESP-IDF configuration
```

Also inspect:

```text
GEMINI.md
AI_PROGRESS.md
AI_HANDOVER.md
AI_DECISIONS.md
AI_CHANGELOG.md
```

Read the current Safe Point state before auditing.

Run only safe inspection/build/test commands needed to establish evidence.

Do not modify production source during this audit.

---

# 4. UNKNOWN-UNKNOWN SEARCH

Do not restrict the audit to requirements already written.

Actively ask:

- What assumption is hidden here?
- What happens when this fails?
- What happens if this happens twice?
- What happens if this happens in the middle?
- What happens after reboot?
- What happens if the UI disappears?
- What happens if ESP32 disappears?
- What happens if one dependency is missing?
- What happens when this scales from one GH to two or more?
- What happens when a response is lost but the operation succeeded?
- What happens when persisted state is half-written?
- What happens when time moves backward?
- What happens when hardware is absent rather than broken?
- What happens when two things request incompatible actions?

Look for conditions the written specifications do not explicitly mention.

---

# 5. AUDIT DOMAINS

Audit all of these plus any additional domain you discover.

## A. UI ↔ ESP32 CONTRACT DRIFT

Find:
- endpoint exists in UI but not firmware;
- endpoint exists in firmware but UI cannot use;
- wrong method/path;
- wrong field casing;
- wrong enum;
- wrong nullability;
- wrong defaults;
- wrong units;
- wrong date/time format;
- wrong status code;
- wrong error shape;
- missing response fields;
- conflicting extra fields;
- frontend assumptions absent from OpenAPI;
- firmware assumptions absent from OpenAPI;
- generated/manual DTO divergence;
- stale client types.

## B. UI STATE vs DEVICE STATE

Find:
- localStorage overriding device state;
- MockDb still affecting direct mode;
- mock timers;
- synthetic telemetry;
- optimistic state without reconciliation;
- stale cache after reboot;
- stale cache after another client changes ESP32;
- UI assuming success before physical confirmation;
- UI showing RUNNING while device is STOPPED;
- UI not noticing bootId changes;
- UI not distinguishing offline/unknown/stale/synchronized;
- bad refresh behavior after reconnect.

## C. COMMAND LIFECYCLE / IDEMPOTENCY

Audit:
- requestId;
- commandId;
- duplicate command;
- double click;
- timeout then retry;
- lost response;
- accepted-but-not-executed;
- queued/running/completed/failed/cancelled/timeout;
- command state after reboot;
- command state after reconnect;
- stale status;
- duplicate physical execution.

Also inspect non-physical mutations:

```text
configuration apply
start cycle
import active cycle
pollination
date changes
metadata
cancel/reset
harvest
emergency stop
```

## D. CONCURRENCY / RACE CONDITIONS

Audit races among:
- manual;
- automatic schedule;
- emergency stop;
- configuration replacement;
- reboot;
- reconnect;
- sensor fault;
- multiple HTTP requests;
- multiple browser tabs/clients;
- FreeRTOS tasks;
- ISR/task access;
- SD access;
- NVS access;
- telemetry reads during mutation.

For every shared mutable state ask:

```text
Who owns it?
Who can mutate it?
Can there be two writers?
What prevents conflicting operations?
```

## E. SCHEDULER / TIMER

Audit:
- missed schedules;
- overlapping schedules;
- back-to-back schedules;
- schedule replacement during run;
- deleting a queued schedule;
- changing a running schedule;
- RTC/time adjustment during execution;
- timezone assumptions;
- time moving backward/forward;
- reboot at schedule boundary;
- power outage during schedule;
- long offline intervals;
- duplicate recovery execution;
- schedule persistence/versioning.

Look for simplistic logic that has no durable execution marker.

## F. POWER LOSS / REBOOT / RECOVERY

Audit power loss during:
- dosing;
- mixing;
- distribution;
- well pumping;
- fan operation;
- configuration write;
- crop-cycle mutation;
- harvest;
- SD write;
- NVS write;
- command persistence;
- schedule execution.

Ask:
- what survives?
- what disappears?
- can action repeat?
- can action silently skip?
- can outputs return ON?
- is there guaranteed safe boot ordering?

## G. STORAGE / DATA INTEGRITY

Audit NVS/internal flash and microSD separately:
- atomic writes;
- interrupted writes;
- corruption;
- checksum/hash;
- schema migration;
- full SD;
- missing SD;
- SD removal/failure;
- excessive writes;
- wear;
- log rotation;
- backlog growth;
- unbounded files/data;
- duplicate/missing events;
- consistency between durable and runtime state.

## H. MEMORY / RESOURCE EXHAUSTION

Audit:
- heap leaks;
- fragmentation;
- PSRAM misuse;
- unbounded queues;
- unbounded collections;
- large JSON allocations;
- oversized HTTP requests/responses;
- long history loaded into RAM;
- task stack;
- queue depth;
- socket/file descriptor leaks;
- reconnect allocation;
- command accumulation;
- UI request storms.

Check behavior over long runtimes, not only short tests.

## I. WATCHDOG / DEADLOCK / STARVATION

Audit:
- blocking calls;
- long critical sections;
- deadlock;
- mutex ordering;
- starvation;
- watchdog coverage;
- retry loops;
- reconnect loops;
- sensor loops;
- SD blocking runtime;
- physical work inside HTTP handlers;
- waits with no timeout.

## J. HARDWARE ABSENCE vs FAILURE

Distinguish where appropriate:

```text
NOT_INSTALLED
DISABLED
UNAVAILABLE
FAULT
TIMEOUT
DISCONNECTED
OUT_OF_RANGE
```

Audit inventory, capability, startup, validation, commands, safety, and UI.

## K. MULTI-GH TOPOLOGY

Audit one-GH vs multi-GH behavior.

Known requirement:

> A GH that is the only installed GH in a Complex may operate without the source-distribution/splitting valves used to select A/B/N/raw-water paths among multiple GH mixing tanks.

Check for accidental assumptions that distribution valves always exist.

But this is ONLY one known example.

Continue searching for other topology-dependent assumptions, including:
- component dependencies;
- routing;
- resource conflicts;
- adding GH-2;
- configuration validation;
- provisioning;
- UI capability rendering;
- safety.

## L. COMPONENT DEPENDENCY GRAPH

Derive actual dependencies from source.

For each dependency ask:
- what if absent?
- what if broken?
- what if stale?
- what if it fails mid-operation?
- when is dependency checked?
- is optionality represented correctly?

Produce a dependency matrix where useful.

## M. SENSOR FAILURE / SENSOR SEMANTICS

For each sensor distinguish as applicable:

```text
valid zero
invalid zero
stale
timeout
disconnected
out-of-range
CRC failure
no pulse
unexpected pulse
recovered
```

For flow sensors inspect:
- pump ON + flow 0;
- pump OFF + flow > 0;
- unexpectedly high flow;
- intermittent pulses;
- unplugged sensor;
- pulse counter overflow;
- reboot during pulse counting.

For DS18B20 inspect invalid readings/recovery.

For float switches inspect:
- active-low;
- debounce;
- stuck state;
- future multi-float impossible combinations.

## N. CALIBRATION

Audit:
- storage;
- units;
- versioning;
- persistence;
- validation;
- bounds;
- zero/negative;
- replacement during runtime;
- effect on active schedules;
- calibration history;
- hardware replacement;
- physical meaning of coefficients.

Do not assume coefficients are correct because a variable exists.

## O. CONFIGURATION MANAGEMENT

Audit:
- schema/config version;
- hash;
- active vs pending config;
- validate-before-apply;
- atomic commit;
- rollback;
- invalid persisted config;
- partial config;
- missing/unknown fields;
- references to deleted components;
- replacement while runtime active;
- queued commands against old config;
- reboot during apply;
- repeated apply;
- stale expectedVersion.

## P. CLOCK / TIME

Identify exact source of truth for:
- scheduling;
- events;
- telemetry;
- HST/HSP;
- recovery;
- command timing.

Audit:
- invalid RTC;
- RTC reset;
- SNTP failure;
- browser time use;
- clock adjustment during operation;
- time forward/backward;
- timezone;
- ISO timestamps;
- monotonic vs wall time;
- boot time.

## Q. CROP-CYCLE / MASA TANAM

Audit:
```text
start
ongoing/import
pollination
update planting
update pollination
delete pollination
metadata
cancel/reset
harvest
history
```

Check:
- duplicate requests;
- concurrent updates;
- version conflicts;
- invalid date ordering;
- future dates;
- pollination before planting;
- harvest before planting;
- date changes after downstream data exists;
- restart;
- active-cycle uniqueness;
- stable cycle ID;
- HST/HSP derivation;
- timezone boundaries;
- stale UI after mutation.

Do not redesign lifecycle rules during audit.

## R. TELEMETRY / EVENTS / AUDIT TRAIL

Ask:

> If something goes wrong tomorrow, can we reconstruct the sequence?

Check auditability for:
- command lifecycle;
- safety/emergency stop;
- configuration changes;
- reboot;
- sensor faults;
- recovery;
- crop-cycle mutations;
- schedule execution;
- skipped/missed schedules;
- connectivity changes.

Check timestamp, sequence, IDs, correlation, and duplication.

## S. NETWORK / CONNECTIVITY

Audit:
- WiFi;
- W5500;
- interface selection;
- reconnect;
- duplicate interfaces;
- IP changes;
- mDNS;
- identity;
- stale IP/hostname;
- CORS;
- Origin: null;
- static HTML opening;
- timeout;
- partial HTTP response;
- socket reuse;
- connection storms;
- multiple clients.

## T. DEVICE IDENTITY / PROVISIONING

Audit:
- first boot;
- deviceId;
- Complex association;
- GH association;
- hostname;
- bootId;
- firmware/API/schema versions;
- factory reset;
- identity persistence;
- accidental identity duplication;
- reflashing with old NVS.

## U. VERSIONING / MIGRATION

Audit:
- firmware/API/schema compatibility;
- persisted-state migration;
- older config on newer firmware;
- UI/device version mismatch;
- unsupported fields;
- downgrade behavior.

## V. UI OPERATIONAL ERROR HANDLING

For every ESP32 mutation audit:
- loading;
- timeout;
- offline;
- 409;
- 422;
- 429;
- 500;
- 503;
- malformed response;
- device reboot;
- reconnect;
- success-but-reconciliation-required.

Do not redesign visuals.

## W. MULTI-TAB / MULTI-CLIENT

Audit:
- conflicting edits;
- stale version;
- duplicate commands;
- inconsistent cache;
- emergency stop in one client while another shows running;
- configuration overwrite;
- crop-cycle conflicts.

## X. MANUAL vs AUTOMATIC

Audit:
```text
manual ON
schedule OFF
emergency STOP
safety fault
configuration reload
reboot
```

Determine actual precedence from code.

If precedence is not defined, report it.

## Y. SAFETY STATE MACHINE

Audit actual transitions among:

```text
NORMAL
RUNNING
FAULT
EMERGENCY_STOP
RECOVERY
SAFE_BOOT
```

Ask:
- what enters each state?
- what exits?
- which outputs must be OFF?
- can queued commands bypass safety?
- can reboot clear an unsafe condition?
- can UI differ from device safety state?

## Z. ACTUATOR SEMANTICS

Verify separation of:

```text
requested state
accepted command
physical output state
verified physical state
failure state
```

Do not assume GPIO HIGH means the actuator actually ran.

## AA. GPIO / PIN BLINDSPOTS

Audit:
- centralized pin mapping;
- duplicate pins;
- strapping pins;
- USB conflicts;
- flash/PSRAM constraints;
- pull configuration;
- polarity;
- startup state;
- initialization order;
- transient output state.

Treat the documented pin map as something to verify, not proof of physical correctness.

## AB. BUILD / TOOLCHAIN

Audit:
- reproducible clean build;
- ESP-IDF version assumptions;
- component dependencies;
- generated files;
- hidden local dependencies;
- stale build artifacts masking failure;
- missing configuration defaults.

## AC. TEST COVERAGE

Do not merely count tests.

Ask:

> What important state transition has no test?

Specifically inspect:
- duplicate requests;
- lost response;
- reboot;
- power-loss behavior;
- corruption;
- offline UI;
- stale UI;
- multi-client conflicts;
- command conflicts;
- schedule conflicts;
- sensor failure;
- absent hardware;
- 1 GH → 2 GH transition;
- config rollback;
- storage failure;
- time jump;
- recovery.

Produce a tested-vs-untested risk view.

## AD. FIRST INSTALL / PROVISIONING

Because the firmware has not yet been flashed and hardware has not been assembled, audit:

```text
fresh ESP32
→ flash
→ first boot
→ provisioning
→ network
→ identity
→ configuration
→ inventory
→ first GH
→ first schedule
```

Look for assumptions that:
- all hardware is installed;
- SD exists;
- RTC is valid;
- sensors are connected;
- multi-GH valve hardware exists;
- network is preconfigured;
- GH data already exists;
- calibration already exists.

---

# 6. INDEPENDENT "WHAT DID WE MISS?" PASS

After the structured audit, run a second independent pass.

Pretend to be:

### Failure analyst
What can fail in production that the requirements never mentioned?

### Embedded engineer
What breaks after 30 days?

### API engineer
What request sequence breaks state consistency?

### UI engineer
What stale/race state can fool the operator?

### Commissioning technician
What prevents first installation?

### Operator
What confusing state can cause a wrong action?

### Adversarial tester
How can I intentionally create contradictory state?

### Future maintainer
What becomes difficult to understand six months later?

### Scaling engineer
What breaks when 1 GH becomes 2 or more?

### Recovery engineer
What happens when multiple failures happen simultaneously?

List newly discovered findings from this pass separately.

---

# 7. EVIDENCE RULE

Every finding MUST have evidence from the repository.

Use:

```text
ID
Severity
Category
Title

Evidence:
- file path
- function/component/module
- exact relevant behavior

Why this is a blindspot:
...

Failure scenario:
...

Current behavior:
...

Expected/desired behavior:
Only state this when supported by existing project requirements.
Otherwise:
"Not yet defined."

Impact:
...

Recommended investigation/fix:
...

Confidence:
HIGH / MEDIUM / LOW

Requires project decision:
YES / NO

Physical verification required:
YES / NO
```

Do not invent requirements.

---

# 8. SEVERITY

Use:

```text
CRITICAL
HIGH
MEDIUM
LOW
INFORMATIONAL
```

CRITICAL:
unsafe physical behavior, destructive state/data corruption, uncontrolled operation, or inability to recover.

HIGH:
core UI ↔ ESP32 failure, incorrect physical behavior, or unreliable recovery.

MEDIUM:
important correctness/reliability risk likely in realistic use.

LOW:
limited impact edge case.

INFORMATIONAL:
observation/potential improvement not proven to be a defect.

Do not inflate severity.

---

# 9. DUPLICATE / ALREADY-KNOWN FILTER

Before reporting a finding, check:
- code;
- tests;
- accepted limitations;
- `AI_DECISIONS.md`;
- prior audit reports.

If already known, mark:

```text
ALREADY KNOWN
```

and cite where it is documented.

Do not generate duplicate findings with different wording.

---

# 10. OUTPUT DOCUMENTS

Do NOT modify production code.

Create:

```text
template/docs/
├── AI_BLINDSPOT_AUDIT_REPORT_V1.md
└── AI_BLINDSPOT_FINDINGS_INDEX.md
```

Index format:

| ID | Severity | Category | Title | Status |
|----|----------|----------|-------|--------|

Status:

```text
NEW
ALREADY KNOWN
REQUIRES DECISION
REQUIRES VERIFICATION
FALSE POSITIVE
```

The full report must contain evidence and analysis.

---

# 11. AUDIT ONLY

Do NOT:
- refactor;
- rewrite;
- rename;
- redesign;
- implement fixes;
- change OpenAPI;
- change UI behavior;
- change ESP32 behavior;
- silently correct requirements.

If you find a bug: report it.

If you find a contract problem: report it.

If you find ambiguity: report it.

If you know a likely fix: recommend it, but do not implement it.

---

# 12. SAFE POINT / HANDOVER

At the end:

1. update `AI_PROGRESS.md`;
2. update `AI_HANDOVER.md`;
3. update `AI_CHANGELOG.md`;
4. record the audit files;
5. explicitly record that production code was not changed;
6. create a Git commit containing only audit documentation changes if coherent.

Suggested checkpoint:

```text
SP-AUDIT-001
UI ↔ ESP32 Blindspot Audit Complete
```

If incomplete:

```text
SP-AUDIT-001-PARTIAL
```

Do not claim completion until both the structured audit and independent unknown-unknown pass are finished.

---

# 13. FINAL SESSION REPORT

End with:

```text
AUDIT STATUS:
COMPLETE / PARTIAL / BLOCKED

Repository inspected:
...

Production code changed:
NO

Audit documents:
...

Findings:
CRITICAL: N
HIGH: N
MEDIUM: N
LOW: N
INFORMATIONAL: N

Top unresolved blindspots:
1. ...
2. ...
3. ...

Requires project decisions:
N

Requires physical verification:
N

Known contradictions:
N

Most important unknown unknowns:
...

Safe Point:
...

Git commit:
...
```

Do not optimize the report for reassurance.

The goal is to discover problems BEFORE hardware installation, not to prove that the existing implementation is correct.
