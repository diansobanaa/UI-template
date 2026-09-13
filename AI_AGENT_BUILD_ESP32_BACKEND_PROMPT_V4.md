# AI AGENT BUILD PROMPT V4
## Build ESP32-S3 Backend Inside `template` with Cross-Agent Safe Points

> V4 extends V3 with a durable, model/account-independent Safe Point and Handover Protocol.
> The repository—not the AI conversation—is the durable source of implementation progress.


---

# 0. Mandatory Cross-Agent Safe Point Protocol

This project MUST be executable as a sequence of independently resumable work units.

The agent may be:
- interrupted by token/quota exhaustion;
- stopped intentionally;
- switched to another Gemini account;
- switched to another AI model;
- resumed in a new chat/session.

The next agent MUST be able to continue from repository state without relying on prior conversation memory.

## 0.1 Durable project control files

At repository root, maintain:

```text
template/
├── GEMINI.md
├── AI_PROGRESS.md
├── AI_HANDOVER.md
├── AI_DECISIONS.md
├── AI_CHANGELOG.md
├── contracts/
└── esp32/
```

If these files already exist, inspect and preserve them.

### `GEMINI.md`
Persistent agent rules and non-negotiable project constraints.

### `AI_PROGRESS.md`
Current implementation state and Safe Point index.

### `AI_HANDOVER.md`
Concise briefing for the next agent/account/model.

### `AI_DECISIONS.md`
Durable architectural decisions and their rationale.

### `AI_CHANGELOG.md`
Chronological record of meaningful agent changes.

Do not use chat history as the only handover mechanism.

## 0.2 Safe Point definition

A Safe Point is a repository state that is:
- internally coherent;
- documented;
- buildable/testable to the extent applicable;
- represented by a Git commit whenever Git is available;
- safe for another agent to continue.

A Safe Point MUST contain:

```text
Safe Point ID
Objective
Completed work
Changed files
Verification performed
Verification result
Known issues
Known blockers
Next action
Git commit hash
```

Example:

```text
SP-005
REST API contract implementation

Status: COMPLETE

Verification:
- ESP-IDF build: PASS
- API contract tests: PASS
- static analysis: PASS

Known issues:
- physical hardware not yet connected

Next:
SP-006 runtime implementation

Commit:
abc1234
```

## 0.3 Partial work

If interrupted before a Safe Point:

```text
Status: PARTIAL
```

MUST be recorded.

Record:
- what is complete;
- what is incomplete;
- files touched;
- whether the project currently builds;
- failing tests/errors;
- exact next action.

Never mark incomplete work as complete merely because the agent is stopping.

## 0.4 Safe Point boundaries are flexible

The numbered Safe Points below are recommended milestones, not a mandatory internal implementation order.

The agent may split, merge, or add Safe Points when repository evidence makes that safer.

However:
- never skip documenting the state;
- never combine unrelated large changes without a stable checkpoint;
- never leave an undocumented half-migration.

## 0.5 Before starting any work

The agent MUST first:

```text
1. Read template/GEMINI.md
2. Read template/AI_PROGRESS.md
3. Read template/AI_HANDOVER.md if present
4. Read relevant AI_DECISIONS.md entries
5. Run git status
6. Inspect the current Safe Point
7. Inspect only the source relevant to the next task
```

Then state internally/briefly:

```text
Current Safe Point:
Current task:
Expected Safe Point:
```

Do NOT redo completed work unless verification shows it is incorrect.

## 0.6 Before stopping

Before ending a work session, including when nearing context/token/quota limits:

```text
1. Stop at the nearest coherent boundary.
2. Build/test what was changed.
3. Update AI_PROGRESS.md.
4. Update AI_HANDOVER.md.
5. Update AI_CHANGELOG.md.
6. Record all changed files and reasons.
7. Record known errors/blockers.
8. Record exact next action.
9. Create a Git commit if the state is coherent.
```

If a full Safe Point cannot be reached, record `PARTIAL` rather than forcing a commit that falsely represents completion.

## 0.7 Account/model switching

A new AI account/model MUST NOT be expected to recover the previous conversation.

The handover sequence is:

```text
GEMINI.md
    ↓
AI_PROGRESS.md
    ↓
AI_HANDOVER.md
    ↓
git status / latest commit
    ↓
canonical contract
    ↓
relevant source
    ↓
continue current task
```

The agent MUST NOT reread the entire repository by default. Use the progress state and targeted inspection to minimize context consumption.

## 0.8 No destructive reset during handover

A new agent MUST NOT:
- delete working changes merely because they do not remember creating them;
- reset to an older commit without evidence;
- recreate completed modules from scratch;
- replace working architecture solely because another design is personally preferred.

If the current state appears inconsistent, inspect the changelog, progress, decisions, Git history, tests, and contract before changing it.

---

# 0A. Suggested Safe Point Milestones

Use these as default project milestones unless repository evidence requires a better decomposition:

```text
SP-001 Repository discovery + UI/API compatibility baseline
SP-002 ESP32 project foundation
SP-003 Hardware abstraction + safe boot
SP-004 Durable storage + recovery
SP-005 REST API contract implementation
SP-006 Runtime + commands + scheduling + safety
SP-007 Crop-cycle / Masa Tanam
SP-008 Telemetry + events + logging
SP-009 Existing UI ↔ ESP32 integration
SP-010 End-to-end verification
SP-011 Assembly + commissioning documentation
```

The agent owns the detailed plan. These IDs provide durable progress anchors across sessions/accounts/models.

## Source of truth hierarchy

Use these files in this order:

1. `UI_ESP32_OPENAPI.yaml` — machine-readable API contract
2. `UI_ESP32_COMMUNICATION_SPEC.md` — UI behavior and integration semantics
3. `ESP32_BACKEND_SPEC.md` — firmware architecture/hardware requirements
4. `UX_UI_MASA_TANAM.md` — current crop-cycle UX behavior
5. Existing repository source — implementation evidence only

Do not silently invent a field, endpoint, enum, or response shape that conflicts with the canonical contract.

---

# 1. Mission

Build a production-oriented ESP32-S3 firmware/backend as a NEW project
inside the existing `template` repository.

The ESP32 project MUST live in a new subdirectory under the template root.
Do not create it as a separate repository and do not replace the existing UI.

Required layout:

```text
template/
├── <existing UI application>
├── contracts/
│   └── <shared contract files>
└── esp32/
    └── <ESP32 firmware project>
```

## Mandatory project folder name

The ESP32 project MUST be created under:

```text
template/esp32/
```

The agent MUST NOT create the firmware project:
- beside `template`;
- as a separate repository;
- inside the existing UI application directories;
- under an arbitrary folder name.

If `template/esp32/` already exists:
- inspect it first;
- preserve useful existing work;
- do not silently delete or replace it;
- convert/refactor it only when required by the task.

The `template/esp32/` directory is the root of the ESP32 firmware project.
All ESP32-specific source, build files, configuration, tests, and firmware assets
belong below this directory unless a shared contract rule below explicitly says otherwise.

## Mandatory shared contract location

The canonical shared contract artifacts MUST live under:

```text
template/contracts/
```

At minimum, place or maintain the canonical API contract there:

```text
template/contracts/UI_ESP32_OPENAPI.yaml
```

Other shared contract/specification files MAY also live in `template/contracts/`
when they are consumed by both the UI and ESP32 project.

The agent MUST NOT create a second competing copy of the canonical API contract
inside `template/esp32/` or inside the UI project.

When a build/tooling process needs a generated or copied representation of a contract,
it MUST be clearly marked as generated and MUST NOT become an independent source of truth.
The canonical file remains the one under `template/contracts/`.

## UI change boundary

The existing UI is an integration consumer and must be treated as protected existing work.

By default, the agent MUST NOT:
- redesign UI screens;
- change visual styling;
- rename UI routes;
- rewrite unrelated components;
- replace the existing state architecture;
- remove existing features;
- change user-facing terminology;
- reorganize unrelated frontend directories.

UI changes are allowed ONLY when they are necessary to establish the real UI ↔ ESP32
integration or to resolve a proven contract mismatch.

When a UI change is necessary:
1. make the smallest change that solves the problem;
2. preserve existing UX and visual behavior;
3. prefer changing/adapting the service/API adapter layer over changing components;
4. do not duplicate device state in a new frontend state store without justification;
5. document what was changed and why;
6. verify that unrelated UI behavior still works.

The agent MUST report every UI file it changes and the reason for each change.

## Repository rules

- Inspect the existing `template` repository before changing anything.
- Treat the existing UI source as the actual integration reference.
- Keep ESP32 firmware source isolated from frontend source.
- Reuse canonical API/specification files rather than duplicating conflicting contracts.
- If the repository already contains ESP32-related files, determine whether they are
  active source, legacy code, generated artifacts, or integration code before modifying them.

## Agent autonomy

This prompt defines requirements, constraints, and system principles.
It does NOT define a mandatory internal implementation plan.

The agent MUST independently determine:
- project structure inside `template`;
- module boundaries;
- implementation order;
- internal architecture;
- build configuration;
- dependency choices;
- test organization;
- refactoring strategy;
- which existing files must be changed to establish the real UI ↔ ESP32 connection.

Before coding, inspect the repository and produce a concise implementation plan.
The implementation plan is the agent's responsibility and may differ from the
order of sections in this prompt.

Do not blindly preserve an existing architecture if repository evidence shows that
it conflicts with the canonical contract or the system principles.

Resolve conflicts explicitly before implementation. Never silently invent behavior.

## Repository discovery gate

Before substantial implementation, the agent MUST inspect:
- the relevant `template` directory structure;
- the existing UI entry points;
- service/adaptor/API layers;
- TypeScript types/models used by the UI;
- current ESP32 client/API code;
- configuration/calibration/hardware-related UI;
- crop-cycle UI and handlers;
- existing build/test configuration;
- all canonical specification files available in the repository or supplied with the task.

Then produce:
1. a repository map;
2. an API/UI compatibility matrix for ESP32-facing operations;
3. identified contract gaps and conflicts;
4. an implementation plan;
5. a verification/test plan.

Do not start large-scale firmware implementation before this discovery step is complete.

## Contract ownership and synchronization

The shared contract under `template/contracts/` is the single external API source of truth.

The agent MUST:
- make the UI adapter/types and ESP32 DTO/API implementation conform to that contract;
- update the shared contract when a real, demonstrated UI or firmware requirement is missing;
- treat such a contract change as a coordinated change, not as a firmware-only change;
- avoid maintaining separate manually edited OpenAPI copies;
- keep any generated client/types clearly derived from the shared contract.

If an inconsistency is found between:
- UI behavior;
- shared contract;
- ESP32 implementation;

the agent MUST stop and resolve the inconsistency explicitly rather than silently
coding around it in only one layer.

Build a production-oriented ESP32-S3 firmware/backend that can be connected directly by the existing Vite UI over local WLAN/LAN.

Success means:

```text
Existing UI
    ↓
existing service/adaptor boundary
    ↓
REST API
    ↓
ESP32
    ↓
real runtime state/hardware
    ↓
REST response/event/telemetry
    ↓
existing UI
```

The UI and ESP32 must share one contract.

Do not merely make the firmware compile.

Do not create a fake API.

Do not return placeholder objects that happen to satisfy TypeScript.

---

# 2. Critical UI compatibility rule

Before coding, create a contract matrix from the UI source.

For EVERY UI operation that targets ESP32, record:

```text
page/component
user action
current UI handler
input fields
validation
expected result/state
endpoint
method
request DTO
response DTO
error states
```

At minimum include:

- device health;
- device status;
- inventory;
- capabilities;
- context;
- clock sync;
- configuration read/validate/apply;
- command submission/status;
- emergency stop;
- crop-cycle current state;
- start normal cycle;
- import active cycle;
- record pollination;
- update planting date;
- update pollination date;
- delete pollination date;
- update cycle metadata;
- reset/cancel cycle;
- harvest;
- crop-cycle history;
- telemetry;
- events/logs.

The existing crop-cycle UI already exposes these inputs/actions. Use its real fields, not an invented simplified model.

---

# 3. Crop-cycle UI inputs that MUST match

From the current UI:

### Start normal
```text
tanggalTanam: string YYYY-MM-DD
variety?: string
plantCount?: number
notes?: string
```

### Start ongoing
```text
tanggalTanam: string
variety?: string
plantCount?: number
tanggalPolinasi?: string
notes?: string
```

### Record pollination
```text
tanggalPolinasi: string
pollinationMethod?: "natural" | "bee" | "manual"
notes?: string
```

### Update planting
```text
tanggalTanam: string
```

### Update pollination
```text
tanggalPolinasi: string
pollinationMethod?: "natural" | "bee" | "manual"
```

### Metadata
```text
variety?: string
plantCount?: number
notes?: string
```

### Delete pollination
No date body.

### Cancel/reset
No business payload other than request identity.

### Harvest
```text
harvestDate?: string
yieldKg?: number
grade?: string
notes?: string
```

Do not change the spelling/casing of these externally visible fields unless the UI adapter is changed at the same time.

---

# 4. Crop-cycle response requirement

Every crop-cycle mutation must return the resulting authoritative current state.

Do not return:

```json
{"success": true}
```

alone.

Return the full cycle state, including:

```text
cycleId
ghId
status
tanggalTanam
tanggalPolinasi
variety
plantCount
notes
hst
hsp
version
```

Where:

```text
hsp = null
```

when pollination is not available.

The UI will replace its local representation using this response.

---

# 5. HST/HSP rule

HST and HSP are NOT editable UI fields.

ESP32 stores lifecycle source dates and maintains/recomputes the authoritative HST/HSP snapshot.

Use the ESP32 RTC/device time.

Never trust browser time as the physical/runtime authority.

After:
- create;
- import;
- planting-date change;
- pollination create/update/delete;
- reboot;
- current-cycle read;

return correct `hst` and `hsp`.

---

# 6. No local simulation in direct mode

The UI must not depend on:
- `startRealtimeMock`;
- local runtime timer;
- local emergency latch;
- synthetic device progress.

The ESP32 is the runtime source.

If the existing UI contains these mocks, change the adapter/service layer so direct mode uses ESP32 without redesigning the UI visuals.

---

# 7. HTTP implementation

Use ESP-IDF HTTP server.

Implement exact paths from:

```text
UI_ESP32_OPENAPI.yaml
```

Do not rename routes casually.

Add:
- CORS;
- JSON body parsing;
- requestId propagation;
- consistent error response;
- timeout-safe command handling.

---

# 8. API DTO layer

Do not serialize internal structs directly.

Create explicit DTOs:

```text
HealthResponse
StatusResponse
InventoryResponse
CapabilitiesResponse
ContextResponse
ConfigurationResponse
CropCycleResponse
CropCycleHistoryResponse
CommandResponse
EventResponse
TelemetryResponse
ErrorResponse
```

Validate external data before converting to internal types.

---

# 9. Hardware architecture

Use centralized GPIO/component registry.

Baseline pins:

```text
SPI:
SCK 11
MOSI 12
MISO 13

W5500 CS 10
TFT CS 14
TFT DC 21
TFT RST 42
microSD CS 47

RTC:
SDA 8
SCL 9

Outputs:
Well Pump 1
Distribution Pump 2
Raw Submersible 4
Dosing A 5
Dosing B 6
Cooling Fan 7
Error Lamp 18

Inputs:
YF-B1 15
FS400A 16
DS18B20 17
Float Lower 19

Buttons:
Mode 38
Manual A 39
Manual B 40
Distribution 41
```

Reserved:
```text
0,3,20,33-37,43-44,45-46,48
```

Do not spread pin constants through the codebase.

---

# 10. Network

MVP:
- local WLAN/LAN;
- no internet dependency;
- no auth;
- mDNS;
- HTTP;
- CORS.

Hostname:

```text
esp32-<deviceId>.local
```

Identity is `deviceId`, not IP.

---

# 11. Storage/recovery

Internal flash:
- identity;
- Last Valid Configuration;
- configuration version/hash;
- recovery metadata.

microSD:
- telemetry;
- events;
- command records;
- crop-cycle history/events;
- pending backlog.

On reboot:
- set all outputs safe/off first;
- recover persisted state;
- recalculate HST/HSP;
- restore runtime according to domain policy.

---

# 12. Commands

Use semantic commands.

Never:
```text
POST /gpio/5
```

Use:
```text
POST /api/v1/commands
```

Implement idempotency by `commandId`.

If a request is retried with the same `commandId`, return the existing command state.

Do not execute the physical action a second time.

---

# 13. Concurrency

HTTP handlers must submit operations into queues/services.

Use FreeRTOS.

Avoid:
- long blocking HTTP handlers;
- browser timers;
- multiple clocks controlling one operation.

---

# 14. Error semantics

Map internal validation errors to exact API error codes.

At minimum support:

```text
400
404
409
422
429
500
503
```

For every mutation, tell the UI whether:
- retryable;
- reconciliation required.

---

# 15. Contract-first development

Implement in this order:

```text
1. OpenAPI DTO/schema
2. API test stubs
3. device identity
4. health/status
5. inventory/capabilities/context
6. storage
7. RTC
8. hardware registry
9. sensor drivers
10. actuator drivers
11. command manager
12. configuration manager
13. crop-cycle service
14. event manager
15. telemetry
16. recovery
17. integration tests
```

Run contract tests after every domain.

---

# 16. Tests required

### API contract
- every OpenAPI route exists;
- every HTTP method exists;
- every required request field validated;
- every response field present;
- enum exactness;
- nullability exactness;
- error status exactness.

### Crop cycle
- create cycle;
- reject second active cycle;
- import ongoing cycle;
- pollination;
- pollination validation;
- update planting date;
- update pollination;
- delete pollination;
- update metadata;
- cancel;
- harvest;
- history;
- restart persistence;
- HST/HSP recomputation.

### Reliability
- duplicate commandId;
- lost response;
- timeout then status lookup;
- 409 version conflict;
- microSD failure;
- network loss;
- reboot;
- invalid persisted configuration.

### Hardware
- safe boot;
- active-level polarity;
- flow pulse count;
- DS18B20;
- lower float;
- button debounce.

---


## Mandatory assembly documentation deliverable

In addition to the firmware project, the agent MUST create a Markdown document
containing the complete ESP32 assembly and wiring procedure for the actual
hardware defined by the project.

Required output location:

```text
template/esp32/docs/ESP32_ASSEMBLY_GUIDE.md
```

The document MUST be written for a person who will physically assemble and
commission the controller.

It MUST include, based on the repository's actual hardware specifications:

1. Bill of materials / modules used.
2. Final ESP32 pin map.
3. Power-domain overview:
   - ESP32 power;
   - 12V DC loads;
   - AC loads;
   - common ground rules;
   - isolation requirements.
4. Wiring instructions for every sensor, actuator, button, display, RTC,
   W5500, microSD, and other installed module.
5. Driver/interface requirements between ESP32 GPIO and external loads,
   including relay/MOSFET/optocoupler/level-shifter requirements where applicable.
6. Connector/wire labeling conventions.
7. Step-by-step physical assembly order.
8. Pre-power inspection checklist.
9. First-power-up procedure.
10. Continuity/short-circuit checks.
11. GPIO bring-up test procedure.
12. Sensor verification procedure.
13. Actuator verification procedure.
14. Network bring-up procedure.
15. Safe-state verification and emergency-stop verification.
16. Firmware flashing and initial configuration procedure.
17. Troubleshooting section for common assembly/wiring faults.
18. A final commissioning checklist with explicit PASS/FAIL items.

### Assembly safety rules

The assembly guide MUST clearly separate:
- LOW-VOLTAGE electronics;
- 12V DC power/load wiring;
- MAINS/AC wiring.

The agent MUST NOT invent electrical ratings, wiring gauges, fuse ratings,
relay ratings, sensor coefficients, or module-specific wiring details that are
not supported by the available hardware documentation.

When a module's exact electrical specification is unavailable, the guide MUST
mark the item as:

```text
VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION
```

Do not present an unverified connection as safe or final.

### Pin-map consistency

The assembly guide's final pin map MUST match the firmware's configured pin map
and the canonical hardware specification.

If the agent discovers a pin conflict, unavailable GPIO, board-specific
restriction, or mismatch between the existing specification and the actual
board/module, it MUST resolve or document the issue before declaring the
assembly guide complete.

The agent MUST NOT maintain a separate undocumented pin assignment only inside
the firmware.

### Documentation quality

Use diagrams/tables where useful, but the primary requirement is that every
physical connection can be followed from:
- ESP32 pin;
- intermediary driver/interface;
- connector/wire;
- target module/load;
- expected electrical behavior.

The document MUST include a "Known Unknowns / Requires Physical Verification"
section whenever hardware information is incomplete.

Creating `ESP32_ASSEMBLY_GUIDE.md` is a mandatory acceptance criterion and must
be reported separately in the final completion report.

# 17. Do not declare success prematurely

The agent MUST distinguish:
- what was verified by compilation/tests;
- what was verified against the UI contract;
- what was verified on actual hardware;
- what remains unverified because physical hardware or external conditions
  were unavailable.

Never claim hardware behavior is proven by software compilation alone.


At the end, report:

```text
BUILD
TEST
HARDWARE
API CONTRACT
UI COMPATIBILITY
```

separately.

A green compile is not enough.

The implementation is complete only when the UI can call the real ESP32 endpoints using the canonical schemas and the returned state is sufficient for the UI to render its existing workflows without additional hidden assumptions.


---

# 51. Token / Quota Exhaustion and Interruption Behavior

The project MUST be designed for agents that may stop unexpectedly.

If context, token, rate, or account quota is running low:

1. do not begin a large unrelated feature;
2. finish the smallest coherent unit possible;
3. run the relevant build/test;
4. update `AI_PROGRESS.md`;
5. update `AI_HANDOVER.md`;
6. record `PARTIAL` if necessary;
7. leave the exact next command/task for the next agent.

Never respond to quota pressure by omitting documentation.

A later agent must be able to continue with:

```text
Read GEMINI.md.
Read AI_PROGRESS.md.
Read AI_HANDOVER.md.
Inspect git status.
Continue the exact next action.
```

---

# 52. Safe Point Acceptance Criteria

A Safe Point is accepted only when:

- the repository state is understandable without the previous chat;
- changed files are documented;
- build/test status is documented;
- unresolved issues are documented;
- next action is explicit;
- no false completion is claimed;
- Git state is preserved;
- the canonical contract remains unambiguous.

The agent MUST report the Safe Point ID and status in its final session summary.

---

# 53. Final Session Report

Every session MUST end with a concise report containing:

```text
SAFE POINT:
STATUS: COMPLETE | PARTIAL | BLOCKED

Completed:
- ...

Changed files:
- ...

Verification:
- Build: PASS/FAIL/NOT RUN
- Tests: PASS/FAIL/NOT RUN
- Contract: PASS/FAIL/NOT RUN
- UI integration: PASS/FAIL/NOT RUN
- Hardware: PASS/FAIL/NOT VERIFIED

Known issues:
- ...

Next exact action:
- ...

Git commit:
- ...
```

Do not claim hardware verification unless physical hardware was actually tested.
