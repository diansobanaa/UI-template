# Implementation Backlog — PRD Alignment

## Purpose

This document translates the current Product Requirements Document (PRD) and the latest implementation audit into an executable remediation plan.

The objective is **not** to rewrite the product from scratch and not to change the PRD to match the current codebase. The objective is to progressively align the existing repository with the PRD through a dependency-ordered implementation plan.

The implementation target is:

```text
UI
 ↓
Configuration / API Authority
 ↓
Validation
 ↓
Compilation
 ↓
Deployment
 ↓
ESP32 Runtime
 ↓
Physical System
 ↓
Telemetry / Events
 ↓
UI / Research
```

## Governing Principles

1. `PRODUCT_REQUIREMENTS_DOCUMENT.md` remains the product authority.
2. The implementation audit describes the current state; it does not redefine the product.
3. Do not create new operational mocks, fake telemetry, fake device state, or fake deployment success.
4. UI state is not authoritative merely because local React state or `localStorage` changed.
5. `Saved` is distinct from `Deployed`, and `Deployed` is distinct from `ACTIVE`.
6. Supported hardware is distinct from installed, assigned, commissioned, and operational hardware.
7. GH identity must be configuration-driven and must not be structurally hard-coded to `GH-01`.
8. The ESP32 runtime should execute already-validated and compiled configuration rather than repeatedly discovering topology at runtime.
9. Safety remains locally enforced on the ESP32.
10. Existing useful foundations should be adapted and rewired before considering a total rewrite.

---

# 1. Overall Dependency Graph

```text
M0  Contract & Canonical Model
        │
        ├──────────────┐
        ↓              ↓
M1  Device/API     M2  Hardware Registry Model
        │              │
        └──────┬───────┘
               ↓
        M3 Configuration Engine
               │
               ↓
        M4 Deployment & Rollback
               │
               ↓
        M5 Dynamic ESP32 Runtime
               │
        ┌──────┴─────────┐
        ↓                ↓
M6 Resource/      M7 Capability/
   Assignment         Topology
        └──────┬─────────┘
               ↓
        M8 Schedule Compiler
               ↓
        M9 Runtime Scheduler
               ↓
        M10 Command + Safety
               ↓
        M11 Sensors + Calibration
               ↓
        M12 Fertigation
               ↓
        M13 Telemetry + Events
               ↓
        M14 Offline + Recovery
               ↓
        M15 Crop + Research
               ↓
        M16 Remove Mock/Legacy
               ↓
        M17 E2E + Physical Commissioning
```

The critical path is:

```text
Canonical model
→ configuration
→ registry
→ assignment
→ capability/topology
→ validation
→ compilation
→ deployment
→ ESP32 runtime
→ safety/commands
→ sensors/calibration
→ fertigation
→ telemetry/events
→ research
```

---

# 2. Milestone M0 — Contract & Canonical Model

## Goal

Create the common language shared by UI, backend/API, and ESP32.

## Dependencies

None.

## Work Order

**Backend/API contracts → UI types → ESP32 structs/parsers**

## Backlog

- [x] M0.1 Define `Complex`.
- [x] M0.2 Define `Greenhouse`.
- [x] M0.3 Define `Component`.
- [x] M0.4 Define `Resource`.
- [x] M0.5 Define `Assignment`.
- [x] M0.6 Define `Ownership`.
- [x] M0.7 Define `Topology`.
- [x] M0.8 Define `Capability`.
- [x] M0.9 Define `Configuration`.
- [x] M0.10 Define `Recipe`.
- [x] M0.11 Define `Schedule`.
- [x] M0.12 Define `CompiledSchedule`.
- [x] M0.13 Define `Command`.
- [x] M0.14 Define `Calibration`.
- [x] M0.15 Define `Telemetry`.
- [x] M0.16 Define `Event`.
- [x] M0.17 Define `FertigationRun`.
- [x] M0.18 Define `CropCycle`.
- [x] M0.19 Define `Plant`.
- [x] M0.20 Define `Fruit`.

## Required State Vocabulary

### Component

```text
SUPPORTED
REGISTERED
NOT_COMMISSIONED
ENABLED
DISABLED
FAULTED
REMOVED
```

### Schedule

```text
DRAFT
VALIDATING
ACTIVE
BLOCKED
DISABLED
INVALID
```

### Deployment

```text
PENDING
VALIDATING
DEPLOYING
APPLIED
FAILED
ROLLED_BACK
```

> **M10 software acceptance evidence (2026-09-18):** PASS — command/safety acceptance 31/31; backend command-proxy integration 5/5; M9 regression 16/16; M7/M8 regression 21/21; backend M7/M8 regression 7/7; M3.0 authority 18 PASS / 0 FAIL / 1 BLOCKED; M2 hardware-management 26/26; forensic authority 13/13; E2E mock contract PASS; OpenAPI M10 schema PASS for root + canonical contracts. ESP-IDF build and all physical actuator/sensor/power-cycle/hydraulic verification remain BLOCKED by unavailable toolchain/hardware.

> **M13 implementation evidence (2026-09-19):** M13.1–M13.28 are implemented in the current source with durable ESP32 telemetry/event logs, persistent monotonic sequence blocks, raw-first/idempotent Python ingestion, cursor-based history APIs, explicit traceability metadata, sensor fault/recovery and operational event generation, and frontend missing/stale/invalid handling. `scripts/test_m13_firmware_contract.mjs` + `scripts/test_m13_history.py` PASS. Physical sensor/actuator proof remains a separate M17 commissioning concern.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

> **M5/M6 closure update (2026-09-19):** The current source and regression gate close M5 and M6 at the software/configuration-driven level. Physical ESP32/hydraulic evidence remains outside these milestones and is tracked under M17.

## Acceptance Criteria

- [ ] UI, backend, and firmware use the same identity model.
- [ ] GH IDs are generic and configuration-driven.
- [ ] Component IDs remain stable when display names change.
- [ ] All shared schemas are versioned.
- [ ] State definitions are explicit and documented.
- [ ] No new feature implementation introduces a parallel incompatible model.

## Output

- Canonical API/domain schemas.
- Shared UI types.
- ESP32 domain/configuration types.
- Updated API contracts.
- State vocabulary document.

---

# 3. Milestone M1 — Device Connection & Basic UI ↔ ESP32

## Goal

Establish the first real device-authoritative path.

## Dependencies

M0.

## Work Order

**ESP32 read-only API → API contract → UI client**

## Backlog

- [x] M1.1 Device health endpoint.
- [x] M1.2 Device status endpoint.
- [x] M1.3 Device/controller identity.
- [x] M1.4 Complex identity.
- [x] M1.5 Firmware version.
- [x] M1.6 Hardware revision.
- [x] M1.7 Active configuration version.
- [x] M1.8 Inventory endpoint.
- [x] M1.9 Capability endpoint.
- [x] M1.10 UI connection test.
- [x] M1.11 Timeout handling.
- [x] M1.12 Offline/error state handling.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

> **M5/M6 closure update (2026-09-19):** The current source and regression gate close M5 and M6 at the software/configuration-driven level. Physical ESP32/hydraulic evidence remains outside these milestones and is tracked under M17.

## Acceptance Criteria

- [x] UI can connect to the real ESP32 API.
- [x] UI displays actual device identity/version data.
- [x] UI displays actual configuration version.
- [x] UI displays offline state when device is unavailable.
- [x] Operational UI does not substitute seeded device state.
- [x] Errors are actionable and distinguish connection failure from device rejection.

## Output

- Working Device page.
- Real ESP32 device endpoints.
- Shared request/response contracts.
- Connection and error handling.

---

# 4. Milestone M2 — Hardware Component Registry

## Goal

Replace fixed hardware assumptions with configuration-driven component registration.

## Dependencies

M0 + M1.

## Work Order

**Backend contract/model → UI registry → ESP32 runtime registry**

## UI Backlog

- [x] M2.1 Supported component catalog.
- [x] M2.2 Supported model/type information.
- [x] M2.3 Installation guide.
- [x] M2.4 Wiring information.
- [x] M2.5 GPIO/channel/interface information.
- [x] M2.6 Register installed component.
- [x] M2.7 Rename component without changing stable identity.
- [x] M2.8 Enable/disable component.
- [x] M2.9 Installation state.
- [x] M2.10 Commissioning state.
- [x] M2.11 Assign Complex.
- [x] M2.12 Assign GH.
- [x] M2.13 Assign role/resource.
- [x] M2.14 Configure channel/parameters.
- [x] M2.15 Decommission component.

## Backend/API Backlog

- [x] M2.16 Persist component definitions.
  - Evidence: `storage_mgr_save_config()` stores components JSON to NVS with CRC. `storage_mgr_load_config()` retrieves on boot. Behavioral test M2.16 PASS.
- [x] M2.17 Validate stable component IDs.
  - Evidence: `api_config_handlers.c` validates: non-empty, max 32 chars, no duplicate componentId. Behavioral tests M2.17a–M2.17d PASS.
- [-] M2.18 Validate installation metadata.
  - Evidence: lifecycleState/deploymentStatus/wiring/GPIO validation is implemented and covered by software tests, but the PRD-required installation metadata surface is broader (commissioning, ownership, assignment, calibration/safety/topology/capability fields are not fully enforced at this boundary).
- [-] M2.19 Validate assignment metadata.
  - Evidence: assignment complexId is validated against the device Complex and the runtime parser now enforces the same relationship. GH existence, resource ownership/conflict semantics, and full topology relationship validation remain M3 work.
- [x] M2.20 Expose inventory and registry state.
  - Evidence: `handler_get_inventory()` iterates `hardware_registry_get_count/get_by_index()`. Active registry refreshed on PUT /configuration. Tests M2.20 PASS.

## ESP32 Backlog

- [x] M2.21 Parse component registry.
  - Evidence: `hardware_registry_load_from_json()` parses componentId, supportedTypeId, lifecycleState, deploymentStatus, wiring, assignment, parameters from JSON. Behavioral test M2.21 PASS (4 components loaded).
- [x] M2.22 Persist installed registry.
  - Evidence: `hardware_hal_init_all()` loads the persisted active configuration from NVS `lvc_json`; CRC integrity is checked on reload. There is no silent `components.json` operational fallback. Software persistence tests PASS; physical reboot remains separately BLOCKED.
- [!] M2.22 Reboot persistence (physical hardware).
  - Status: BLOCKED — ESP32 not connected (no COM port detected). Cannot flash. NVS/SPIFFS code paths verified by code review; physical reboot test deferred.
- [x] M2.23 Resolve components by logical ID.
  - Evidence: `hardware_registry_find_by_id()` iterates active registry and returns by componentId string. Tests M2.23a–M2.23b PASS.
- [-] M2.24 Resolve channel dynamically from configuration.
  - Evidence: the known actuator execution path now resolves GPIO through the active registry and rejects unknown bindings; generic resolution helpers are present. However, the broader runtime still uses a fixed semantic actuator enum set and service-level resource identities, so this is not yet fully arbitrary configuration-driven hardware execution.
- [x] M2.25 Track component state.
  - Evidence: `actuator_hal_set()` blocks ON if lifecycle ≠ COMMISSIONED or ENABLED. `actuator_hal_set_by_component_id()` also enforces lifecycle. Tests M2.25a–M2.25d PASS.
- [x] M2.26 Expose registry through API.
  - Evidence: `handler_get_inventory()` exposes active `s_active_components[]` with full InstalledComponent schema: lifecycleState, deploymentStatus, wiring, assignment, parameters. PUT /configuration triggers live registry reload. Tests M2.26a–M2.26b PASS.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

- [x] Component identity comes from configuration.
  - Evidence: Registry sourced from `lvc_json` NVS key (persisted configuration), not static pin_config.h defaults.
- [x] The same driver can support multiple installed component instances.
  - Evidence: M2.24d PASS — two pump-12v-dc instances with distinct componentIds coexist in registry.
- [x] Display-name changes do not alter stable IDs.
  - Evidence: M2.17d PASS — rename payload preserves `componentId: "well-pump"`.
- [x] Registered but not commissioned components are not treated as operational.
  - Evidence: M2.25c PASS (NOT_COMMISSIONED blocked), M2.25d PASS (REMOVED blocked).
- [x] Static default mapping is no longer the sole runtime source of truth.
  - Evidence: M2.24 dynamic GPIO re-binding; empty registry warning replaces CRITICAL log when no config persisted; `hardware_registry_get_default_json()` returns empty array.

## Output

**Hardware Registry v1** with installation/commissioning lifecycle. ✅ COMPLETE (software). Physical hardware commissioning pending first flash.


---

# 5. Milestone M3 — Configuration Engine

## Goal

Create the canonical configuration snapshot used by the system.

## Dependencies

M2.

## Work Order

**Backend validation → ESP32 parser/storage → UI configuration editor**

## Configuration Structure

```text
Complex
 ├── GHs
 ├── Components
 ├── Resources
 ├── Assignments
 ├── Topology
 ├── Capabilities
 ├── Recipes
 ├── Schedules
 ├── Calibration
 ├── Safety
 └── Policies
```

## Backlog

### Backend

- [ ] M3.1 Schema validation.
- [ ] M3.2 Semantic validation.
- [ ] M3.3 Resource validation.
- [ ] M3.4 Topology validation.
- [ ] M3.5 Safety dependency validation.
- [ ] M3.6 Hardware compatibility validation.
- [ ] M3.7 Configuration versioning.

### ESP32

- [ ] M3.8 Configuration parser.
- [ ] M3.9 Schema validation.
- [ ] M3.10 Candidate configuration representation.
- [ ] M3.11 Active configuration representation.
- [ ] M3.12 Configuration hash/CRC.

### UI

- [ ] M3.13 Configuration editor.
- [ ] M3.14 Validation result display.
- [ ] M3.15 Validation error details.
- [ ] M3.16 Configuration version display.
- [ ] M3.17 Draft state.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

Invalid configuration:

```text
UI
 ↓
VALIDATION FAILED
 ↓
NO DEPLOYMENT
```

Valid configuration:

```text
UI
 ↓
VALID
```

- [ ] Invalid semantic relationships are rejected.
- [ ] Missing required resources are detected.
- [ ] Unsupported hardware mappings are detected.
- [ ] Validation errors identify the relevant component/GH/resource where applicable.

## Output

**Canonical Configuration System v1**.

---

# 6. Milestone M4 — Deployment, Atomic Activation & Rollback

## Goal

Make configuration changes transactional and device-authoritative.

## Dependencies

M3.

## Work Order

**ESP32 storage/activation → backend deployment → UI deployment state**

## Backlog

- [ ] M4.1 Staging configuration.
- [ ] M4.2 Active configuration.
- [ ] M4.3 Previous/rollback configuration.
- [ ] M4.4 Atomic activation.
- [ ] M4.5 Boot recovery.
- [ ] M4.6 Deployment ID.
- [ ] M4.7 Deployment acknowledgement.
- [ ] M4.8 Active version reporting.
- [ ] M4.9 Failed deployment state.
- [ ] M4.10 Rollback.
- [ ] M4.11 UI pending state.
- [ ] M4.12 UI deployed/applied state.
- [ ] M4.13 UI failed state.

## Required Flow

```text
Candidate
 ↓
Validate
 ↓
Persist safely
 ↓
Deploy
 ↓
ESP32 validates
 ↓
Activate atomically
 ↓
ACK
 ↓
ACTIVE
```

Failure:

```text
Candidate
 ↓
FAIL
 ↓
Previous known-good configuration remains ACTIVE
```

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

Test case:

```text
Config v10 = ACTIVE

Deploy v11
        ↓
        FAIL
        ↓
v10 remains ACTIVE
```

- [ ] UI knows v11 failed.
- [ ] UI does not show false success.
- [ ] ESP32 reports the actual active version.
- [ ] A failed candidate cannot partially replace active configuration.

## Output

**Configuration Deployment & Rollback v1**.

---

# 7. Milestone M5 — Dynamic ESP32 Runtime Foundation

## Goal

Make the firmware execute configuration-driven identities and resources instead of fixed hardware semantics.

## Dependencies

M4.

## Work Order

**ESP32 primary implementation → UI consumes actual behavior**

## Backlog

- [x] M5.1 Dynamic Complex identity.
- [x] M5.2 Dynamic GH collection.
- [x] M5.3 Dynamic component lookup.
- [x] M5.4 Dynamic resource references.
- [x] M5.5 Dynamic capability lookup.
- [x] M5.6 Runtime configuration loading.
- [x] M5.7 Boot from active configuration.
- [x] M5.8 Remove structural `GH-01` assumptions.
- [x] M5.9 Remove fixed semantic actuator assumptions where configuration is intended to control identity.
- [x] M5.10 Preserve local autonomous behavior from active configuration.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

A configuration such as:

```text
Complex-A
 ├── GH-01
 ├── GH-02
 └── GH-03
```

can be loaded and operated without modifying firmware source solely to add/remove GHs.

- [x] Telemetry can identify the actual GH context.
- [x] Crop-cycle state is not globally singleton by design.
- [x] Resource references come from configuration.

## Current Status

**M5 COMPLETE — software/configuration-driven runtime.** Dynamic Complex/GH context, component/resource lookup, active-configuration boot, generic component actuation, dynamic telemetry context, and local autonomous execution are implemented. Physical ESP32 proof remains M17.

## Output

**ESP32 Configuration-Driven Runtime v1**.

---

# 8. Milestone M6 — Resource Assignment & Ownership

## Goal

Implement the resource model required for shared equipment and transfers.

## Dependencies

M5.

## Work Order

**Backend model → UI workflow → ESP32 runtime resource model**

## Backlog

- [x] M6.1 Resource identity.
- [x] M6.2 Resource owner.
- [x] M6.3 GH assignment.
- [x] M6.4 Shared/exclusive classification.
- [x] M6.5 Resource availability.
- [x] M6.6 Resource lock.
- [x] M6.7 Resource queue.
- [x] M6.8 Resource transfer.
- [x] M6.9 Resource release.
- [x] M6.10 Conflict detection.
- [x] M6.11 Affected schedule detection.
- [x] M6.12 Affected capability detection.

## Required Transfer Workflow

```text
Fan-01 → GH-01

Move Fan-01 → GH-03
        ↓
Show physical move instructions
        ↓
Confirm physical move
        ↓
Transfer ownership
        ↓
Recalculate capabilities
        ↓
Revalidate affected schedules
```

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

- [x] An installed resource cannot silently have two exclusive owners.
- [x] Transfer updates ownership.
- [x] Old owner loses access/capability where appropriate.
- [x] New owner gains capability only after valid assignment.
- [x] Affected schedules are revalidated.

## Current Status

**M6 COMPLETE — software/configuration-driven resource manager.** Resource identity, ownership, assignment, shared/exclusive semantics, availability, runtime locking, queued schedule execution, transfer workflow, release, conflict detection, affected schedules, and affected capability recalculation are implemented. Physical move/commissioning proof remains M17.

## Output

**Resource Manager v1**.

---

# 9. Milestone M7 — Topology & Capability Engine

## Goal

Represent actual physical reachability/routing and derive operational capabilities.

## Dependencies

M6.

## Work Order

**Backend topology model → capability calculation → UI view → ESP32 consumes compiled result**

## Backlog

- [x] M7.1 Source representation.
- [x] M7.2 Destination representation.
- [x] M7.3 Path representation.
- [x] M7.4 Pump relationship.
- [x] M7.5 Valve relationship.
- [x] M7.6 Tank relationship.
- [x] M7.7 Manual-routing condition.
- [x] M7.8 Automatic-routing condition.
- [x] M7.9 Hydraulic reachability.
- [x] M7.10 Automatic routability.
- [x] M7.11 Shared path state.
- [x] M7.12 Topology conflict validation.
- [x] M7.13 Capability calculation.

## Required Distinctions

```text
GH configured
GH hydraulically reachable
GH automatically routable
GH manually routable
GH currently selected shared/manual target
```

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

Single-GH direct topology may omit unnecessary distribution valves.

Multi-GH without routing valves must not be presented as automatically independent.

- [x] Capabilities reflect actual topology.
- [x] Routing conflicts are detected before activation.
- [x] UI clearly exposes manual-routing vs automatic-routing conditions.


> **Current evidence (2026-09-18):** Software acceptance PASS. `scripts/test_m7_m8_engine.mjs` includes 7 M7 checks covering multi-GH reachability, routing, conflicts, direct single-GH topology, shared-source behavior, and derived capabilities. Backend topology tests are included in the 7-test backend M7/M8 suite. Physical hydraulic verification remains BLOCKED until hardware is available.
## Output

**Topology Model + Capability Engine v1**.

---# 10. Milestone M8 — Schedule Compiler

## Goal

Replace direct raw schedule dispatch with validation and compilation.

## Dependencies

M7.

## Work Order

**Backend compiler → UI schedule state → ESP32 compiled-schedule format**

## Backlog

- [x] M8.1 Schedule intent schema.
- [x] M8.2 Target Complex resolution.
- [x] M8.3 Target GH resolution.
- [x] M8.4 Action resolution.
- [x] M8.5 Parameter validation.
- [x] M8.6 Component resolution.
- [x] M8.7 Resource resolution.
- [x] M8.8 Topology resolution.
- [x] M8.9 Safety dependency resolution.
- [x] M8.10 Resource conflict validation.
- [x] M8.11 Recurrence validation.
- [x] M8.12 Recipe snapshot/version.
- [x] M8.13 Configuration version reference.
- [x] M8.14 Priority.
- [x] M8.15 Missed-run policy.
- [x] M8.16 Compile.
- [x] M8.17 Blocked reason.
- [x] M8.18 Deployment of compiled schedule.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

Missing resource:

```text
CREATE
 ↓
VALIDATE
 ↓
BLOCKED
```

Valid resource-complete schedule:

```text
CREATE
 ↓
VALIDATE
 ↓
COMPILE
 ↓
DEPLOY
 ↓
ACTIVE
```

- [x] BLOCKED schedules cannot become executable ACTIVE schedules.
- [x] INVALID schedules cannot execute.
- [x] DRAFT schedules cannot execute.
- [x] DISABLED schedules cannot execute.
- [x] Compiled schedule contains resolved runtime dependencies.


> **Current evidence (2026-09-18):** Software acceptance PASS. Schedule intent validation/compilation, resource/topology/safety dependencies, recurrence, fallback, configuration version/hash, priority, missed-run policy, and deployment gating are exercised by `scripts/test_m7_m8_engine.mjs` and `scripts/test_backend_m7_m8.py`. ESP32 physical deployment remains BLOCKED without a device.
## Output

**Compiled Schedule Format v1** and compiler pipeline.

---# 11. Milestone M9 — ESP32 Runtime Scheduler

## Goal

Make the ESP32 scheduler consume only compiled ACTIVE schedules.

## Dependencies

M8.

## Backlog

- [x] M9.1 Local clock/time source.
- [x] M9.2 Evaluate ACTIVE schedules only.
- [x] M9.3 Due-time evaluation.
- [x] M9.4 Execute compiled action.
- [x] M9.5 Acquire resource locks.
- [x] M9.6 Queue conflicting work.
- [x] M9.7 Support independent-path concurrency.
- [x] M9.8 Priority handling.
- [x] M9.9 Missed schedule policy.
- [x] M9.10 Reboot recovery.
- [x] M9.11 Power recovery integration.
- [x] M9.12 Duplicate protection.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

- [x] Scheduler never dispatches BLOCKED schedules.
- [x] Scheduler never dispatches INVALID/DRAFT/DISABLED schedules.
- [x] Scheduler does not perform complex topology discovery at execution time.
- [x] Shared resources serialize correctly.
- [x] Independent physical paths may run concurrently where configuration allows.


> **Current evidence (2026-09-18):** Software/simulation acceptance PASS: 15/15 `scripts/test_m9_runtime_scheduler.mjs`. Backend M7/M8 regression: 7/7; M7/M8 runtime regression: 21/21. Scheduler uses persisted compiled ACTIVE schedules, local device time, deterministic due evaluation, explicit resource locks, queueing, independent-path concurrency, priority, missed-run policy, durable execution markers, reboot recovery hold, and deterministic command IDs. Physical clock/GPIO/power-cycle verification remains BLOCKED.
## Output

**Production Scheduler Runtime v1**.

---# 12. Milestone M10 — Command System + Safety

## Goal

Make all physical commands safety-authorized and idempotent.

## Dependencies

M9.

## Command Backlog

- [x] M10.1 Command ID.
- [x] M10.2 Target Complex/GH.
- [x] M10.3 Target resource/component.
- [x] M10.4 Parameters.
- [x] M10.5 Configuration version context.
- [x] M10.6 Command validation.
- [x] M10.7 Resource check.
- [x] M10.8 Safety check.
- [x] M10.9 E-stop check.
- [x] M10.10 Duplicate command detection.
- [x] M10.11 Idempotent retry behavior.
- [x] M10.12 Command result.
- [x] M10.13 Command event generation.

## Safety Backlog

- [x] M10.14 Complete safe boot coverage.
- [x] M10.15 E-stop latch.
- [x] M10.16 Reject conflicting commands while E-stop is latched.
- [x] M10.17 Prevent scheduler execution while E-stop policy blocks it.
- [x] M10.18 Maximum runtime per hazardous actuator/resource.
- [x] M10.19 Flow timeout protection.
- [x] M10.20 Low-level protection.
- [x] M10.21 High-level/overfill protection strategy.
- [x] M10.22 Invalid/stale safety sensor fallback.
- [x] M10.23 Fault state.
- [x] M10.24 Recovery state.
- [x] M10.25 Durable safety event path.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

E-stop:

```text
E-STOP
 ↓
covered actuators SAFE
 ↓
new conflicting command REJECTED
 ↓
active conflicting sequences interrupted
 ↓
state latched
 ↓
explicit resume/reset
```

- [x] Retrying the same command ID cannot double-execute a dangerous operation.
- [x] Safe boot covers all configured safety-critical outputs.
- [x] Every applicable hazardous actuator has a maximum runtime policy.

## Output

**Command & Safety Runtime v1**.

---

# 13. Milestone M11 — Sensor Framework + Calibration

## Goal

Replace static sensor assumptions with generic sensor and calibration models.

## Dependencies

M5 + M10.

## Work Order

**ESP32 sensor HAL → configuration → API/backend → UI calibration workflow**

## Sensor Backlog

- [x] M11.1 Generic sensor identity.
- [x] M11.2 Sensor type.
- [x] M11.3 Source/channel.
- [x] M11.4 Unit.
- [x] M11.5 Sampling interval.
- [x] M11.6 Calibration reference.
- [x] M11.7 Validity range.
- [x] M11.8 Fault state.
- [x] M11.9 Quality state.
- [x] M11.10 Timestamp.
- [x] M11.11 Temperature support.
- [x] M11.12 Humidity abstraction.
- [x] M11.13 Light abstraction.
- [x] M11.14 Level abstraction.
- [x] M11.15 Flow abstraction.
- [x] M11.16 Pressure abstraction.
- [x] M11.17 pH abstraction.
- [x] M11.18 EC abstraction.

## Calibration Backlog

- [x] M11.19 Dosing calibration.
- [x] M11.20 Flow calibration.
- [x] M11.21 Level calibration.
- [x] M11.22 pH calibration.
- [x] M11.23 EC calibration.
- [x] M11.24 Calibration version.
- [x] M11.25 Timestamp.
- [x] M11.26 Operator/technician.
- [x] M11.27 Validity state.
- [x] M11.28 Expired/suspect state.
- [x] M11.29 Historical calibration reference.
- [x] M11.30 Runtime uses explicit calibration record.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

Uninstalled sensor:

```text
NOT INSTALLED
```

not a fake numeric value.

Stale sensor:

```text
STALE
```

not a valid measurement.

- [ ] Precision operation cannot silently use an arbitrary calibration value.
- [ ] Runtime logic records which calibration record was used.

## Output

**Sensor + Calibration Framework v1**.

---



### M11/M12 FINALIZATION OVERRIDE — 2026-09-19
M11 Sensors + Calibration and M12 Production Fertigation Engine are CLOSED at the software/contract level.

Closure evidence:
- Generic configuration-driven sensor abstraction supports temperature, humidity, light, level, flow, pressure, pH, and EC semantics; unavailable sensors remain unavailable rather than fabricated.
- Exact calibration lookup is component + type + calibration ID + version scoped; unusable/expired/suspect records are blocked.
- Active configuration changes reconfigure generic sensor GPIO/ADC bindings.
- Generic configured flow meters use pulse accumulation and exact FLOW calibration.
- Fertigation requires an execution plan, binds logical component IDs, supports up to seven dosing channels, and enforces safety/resource/calibration prechecks.
- Run records distinguish measured water/delivery from calculated dosing and include calibration references, phase timestamps, actual flow/pressure where available, final status, and fault information.
- Simulation requires explicit flow/pressure measurements for FLOW/PRESSURE_FLOW modes and never marks an unmeasured delivery volume as verified.

Verification:
- `npm run test:m11:m12`: **PASS** (34 backend tests + 17 firmware source checks).
- Existing M2/M3/M4/M5/M6/M7/M8/M9/M10/M13/M14/M15/M16 regression gates remain required.

Residual physical evidence remains M17: ESP-IDF hardware build, live GPIO/sensor calibration, hydraulic volume accuracy, pump/valve commissioning, E-stop physical validation, and power-cycle testing.

# 14. Milestone M12 — Production Fertigation Engine

## Goal

Convert the existing fixed A/B/timed prototype into configuration-driven fertigation.

## Dependencies

M8 + M9 + M10 + M11.

## State Machine

```text
IDLE
 ↓
PRECHECK
 ↓
FILLING
 ↓
DOSING
 ↓
FINAL_MIXING
 ↓
DELIVERY
 ↓
COMPLETE
```

Fault/interruption paths:

```text
Any state
 ↓
INTERRUPTED / FAULTED / ABORTED
```

## Backlog

### Precheck

- [x] M12.1 Target GH.
- [x] M12.2 Recipe validity.
- [x] M12.3 Required resources.
- [x] M12.4 Required sensors.
- [x] M12.5 Calibration validity.
- [x] M12.6 Safety conditions.
- [x] M12.7 Source/tank availability.
- [x] M12.8 Conflict check.

### Filling

- [x] M12.9 Select target GH mixing tank.
- [x] M12.10 Select water source.
- [x] M12.11 Measure incoming volume.
- [x] M12.12 Stop at target volume.
- [x] M12.13 Tolerance policy.
- [x] M12.14 Timeout/failure policy.

### Dosing

- [x] M12.15 Resolve logical dosing channels.
- [x] M12.16 Support up to seven logical dosing channels.
- [x] M12.17 Requested quantity.
- [x] M12.18 Calibration lookup.
- [x] M12.19 Runtime calculation.
- [x] M12.20 Minimum/maximum runtime enforcement.
- [x] M12.21 Actual commanded operation record.

### Mixing

- [x] M12.22 Configurable mixing duration.
- [x] M12.23 Record mixing phase timestamps.

### Delivery

- [x] M12.24 Target delivery mode.
- [x] M12.25 Measured delivered volume where configured.
- [x] M12.26 Flow-derived target where configured.
- [x] M12.27 Pressure/flow readiness where configured.
- [x] M12.28 Duration fallback only when explicitly configured.
- [x] M12.29 Distinguish mixed volume from actual delivered volume.

### Run Record

- [x] M12.30 Run ID.
- [x] M12.31 Complex ID.
- [x] M12.32 GH ID.
- [x] M12.33 Trigger type.
- [x] M12.34 Schedule ID where applicable.
- [x] M12.35 Recipe ID/version.
- [x] M12.36 Configuration version.
- [x] M12.37 Target water volume.
- [x] M12.38 Target dosing quantities.
- [x] M12.39 Actual water volume.
- [x] M12.40 Actual dosing runtimes.
- [x] M12.41 Calibration references.
- [x] M12.42 Start/end timestamps.
- [x] M12.43 Phase timestamps.
- [x] M12.44 Final status.
- [x] M12.45 Fault/error information.
- [x] M12.46 Operator/source.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

- [ ] No structural dependence on exactly two dosing pumps.
- [ ] Mixing duration is configurable.
- [ ] Delivery no longer defaults unconditionally to a fixed duration.
- [ ] Missing calibration follows an explicit safe policy.
- [ ] A run generates a durable record.
- [ ] Active recipe/configuration data is immutable for the run snapshot.

## Output

**Production Fertigation Engine v1**.

---

# 15. Milestone M13 — Telemetry + Event System

## Goal

Create a trustworthy operational history loop.

## Dependencies

M12.

## Telemetry Backlog

- [x] M13.1 Real-time telemetry.
- [x] M13.2 Complex association.
- [x] M13.3 GH association.
- [x] M13.4 Device association.
- [x] M13.5 Component/source association.
- [x] M13.6 Timestamp.
- [x] M13.7 Metric ID.
- [x] M13.8 Value.
- [x] M13.9 Unit.
- [x] M13.10 Quality.
- [x] M13.11 Calibration/version metadata where relevant.
- [x] M13.12 Durable historical storage.

## Event Backlog

- [x] M13.13 Fertigation started.
- [x] M13.14 Fertigation completed.
- [x] M13.15 Fertigation interrupted.
- [x] M13.16 Pump started/stopped.
- [x] M13.17 Schedule triggered/skipped.
- [x] M13.18 Emergency stop.
- [x] M13.19 Sensor fault.
- [x] M13.20 Flow timeout.
- [x] M13.21 Tank-full protection.
- [x] M13.22 Configuration deployed.
- [x] M13.23 Configuration rejected.
- [x] M13.24 Power failure.
- [x] M13.25 Power restored.
- [x] M13.26 Calibration changed.
- [x] M13.27 Communication lost/restored.
- [x] M13.28 Watchdog/abnormal reset where detectable.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

Each operational event is traceable to the relevant:

```text
Complex
GH
Command
Configuration
Resource
Sensor/Actuator
```

- [x] Missing telemetry samples are not represented as real zero.
- [x] UI distinguishes true zero from missing/stale/invalid data.
- [x] Event storage has a defined failure behavior.

## Output

**Telemetry + Event System v1**.

---

# 16. Milestone M14 — Offline & Recovery

## Goal

Ensure the greenhouse remains autonomous and data remains recoverable during network or power interruptions.

## Dependencies

M13.

## Backlog

- [x] M14.1 Offline schedule execution.
- [x] M14.2 Last-valid configuration retention.
- [x] M14.3 Offline telemetry queue.
- [x] M14.4 Offline event queue.
- [x] M14.5 Synchronization cursor.
- [x] M14.6 Replay.
- [x] M14.7 Deduplication.
- [x] M14.8 Reconnect handling.
- [x] M14.9 Missed schedule evaluation.
- [x] M14.10 Interrupted fertigation disposition.
- [x] M14.11 Reboot recovery state.
- [x] M14.12 Configuration pending-deployment state.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Implementation status — 2026-09-19

**COMPLETE at software/contract level.** M14 implements durable sync/deployment state, cursor-aware ESP32 replay, backend idempotent ingestion, reconnect synchronization, schedule recovery windows, safe reboot interruption hold, and pending-deployment state. M15 implements per-GH persistent crop cycles, HST/HSP, planting/pollination/harvest dates, plant and mortality identity, fruit identity/weight/grade, observations, historical retrieval, and joins to telemetry/events/fertigation/recipe/calibration history. Physical network/power/hydraulic commissioning remains a separate M17 concern.

## Acceptance Criteria

Network off:

```text
ESP32
 ↓
continues authorized autonomous operation
 ↓
stores telemetry/events locally
```

Network returns:

```text
buffer
 ↓
sync
 ↓
deduplicate
 ↓
mark synchronized
```

Power/reboot recovery must not blindly resume an interrupted fertigation batch from an unsafe intermediate state.

## Output

**Offline + Recovery v1**.

---

# 17. Milestone M15 — Crop & Research

## Goal

Build the research layer on top of trustworthy operational history.

## Dependencies

M13 + M14.

## Backlog

- [x] M15.1 Crop cycle per GH.
- [x] M15.2 Planting date.
- [x] M15.3 Pollination date.
- [x] M15.4 Harvest date.
- [x] M15.5 HST.
- [x] M15.6 HSP.
- [x] M15.7 Plant identity.
- [x] M15.8 Mortality records.
- [x] M15.9 Fruit identity.
- [x] M15.10 Fruit weight.
- [x] M15.11 Grade.
- [x] M15.12 Observations.
- [x] M15.13 Historical cycle persistence.
- [x] M15.14 Telemetry relationship.
- [x] M15.15 Fertigation-run relationship.
- [x] M15.16 Recipe relationship.
- [x] M15.17 Calibration relationship.
- [x] M15.18 Research retrieval queries.

## Implementation status — 2026-09-19

**COMPLETE at software/contract level.** Research data is persistent in Python-owned SQLite and crop-cycle state is also durable per-GH in ESP32 NVS.

## Required Data Relationship

```text
Complex
 ↓
GH
 ↓
Crop Cycle
 ├── Plant
 │    └── Fruit
 ├── Fertigation Runs
 ├── Recipe references
 ├── Calibration references
 └── Telemetry / Events
```

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

Historical analysis can trace a crop outcome back to the relevant operational conditions.

Examples:

- HST/HSP vs telemetry.
- Fertigation history vs plant progress.
- Recipe vs fruit weight.
- Environmental conditions vs crop outcomes.
- Mortality vs environmental/fertigation events.

## Output

**Crop & Research Data Model v1** and initial research queries.

---

# 18. Milestone M16 — Remove Mock & Legacy Operational Paths

## Goal

Only perform this after replacement paths are working.

## Dependencies

M0–M15 production paths available.

## Backlog

- [ ] M16.1 Remove operational seeded telemetry.
- [ ] M16.2 Remove fake historical charts.
- [ ] M16.3 Remove localStorage as authority for operational state.
- [ ] M16.4 Remove fake pH/EC values.
- [ ] M16.5 Remove fabricated yield defaults.
- [ ] M16.6 Remove unsupported fan workflows.
- [ ] M16.7 Remove remaining GH-01 hard-coded behavior.
- [ ] M16.8 Remove fixed A/B-only runtime paths where the product requires scalable channels.
- [ ] M16.9 Remove obsolete direct scheduler path.
- [ ] M16.10 Remove stale API contracts.
- [ ] M16.11 Remove mock E2E claims.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## Acceptance Criteria

- [ ] Operational screens are driven by authoritative data.
- [ ] Unavailable hardware is not shown as operational.
- [ ] Unsupported workflows are blocked or hidden by capability.
- [ ] Search/review of the repository shows no active legacy path that contradicts the new model.

## Output

**Operational codebase without mock-first control paths**.

---

# 19. Milestone M17 — End-to-End & Physical Commissioning

## Goal

Prove the system from UI to physical actuator and back to recorded telemetry/events.

## Dependencies

M0–M16.

## E2E Scenario 1 — Component Installation

```text
UI register
 ↓
backend validate
 ↓
deploy
 ↓
ESP32 activate
 ↓
UI sees component
```

## E2E Scenario 2 — Resource Transfer

```text
Fan-01 → GH-01

move → GH-03

affected schedule
 ↓
BLOCKED

new assignment
 ↓
recompile
 ↓
ACTIVE
```

## E2E Scenario 3 — Schedule

```text
Create
 ↓
validate
 ↓
compile
 ↓
deploy
 ↓
ACTIVE
 ↓
ESP32 executes
 ↓
event
 ↓
telemetry
```

## E2E Scenario 4 — Failed Deployment

```text
Deploy v11
 ↓
device rejects
 ↓
v10 remains ACTIVE
```

## E2E Scenario 5 — Offline

```text
Network OFF
 ↓
schedule executes
 ↓
data buffered
 ↓
Network ON
 ↓
sync
```

## E2E Scenario 6 — Safety

```text
Running actuator
 ↓
E-stop
 ↓
safe state
 ↓
event
 ↓
new command rejected
 ↓
explicit resume
```

## Physical Commissioning Backlog

- [ ] M17.1 Wiring verification.
- [ ] M17.2 GPIO verification.
- [ ] M17.3 Pump behavior.
- [ ] M17.4 Flow sensor behavior.
- [ ] M17.5 Level sensor behavior.
- [ ] M17.6 Pressure behavior.
- [ ] M17.7 Dosing calibration.
- [ ] M17.8 Mixing behavior.
- [ ] M17.9 Delivery measurement.
- [ ] M17.10 Hydraulic validation.
- [ ] M17.11 No-drain behavior.
- [ ] M17.12 Emergency stop.
- [ ] M17.13 Power-loss behavior.
- [ ] M17.14 Backup-power behavior.
- [ ] M17.15 Reboot recovery.

> **Forensic re-audit override (2026-09-18):** Earlier completion claims are historical and do not supersede this evidence-based status. Current audited status is: M2.16 PASS (software), M2.17 PASS (software), M2.18 PARTIAL, M2.19 PARTIAL, M2.20 PASS (software), M2.21 PASS (software/source), M2.22 PASS for software persistence plus a separate physical BLOCKED item, M2.23 PASS (software), M2.24 PARTIAL, M2.25 PASS for tested actuator lifecycle gate, M2.26 PASS for the derived inventory path. M3/M4 software cores are implemented in the current repository; final physical deployment evidence remains blocked and some UI/firmware migration work remains open.

## M3/M4 Hardening Addendum — 2026-09-19

The M3/M4 software cores were already present before this hardening pass. The following transactional controls are now implemented and evidence-tested on top of those cores:

- [x] Candidate configuration is persisted separately from active configuration.
- [x] Active configuration remains the sole runtime authority.
- [x] Previous active configuration is retained as a rollback snapshot.
- [x] Runtime registry validates the exact candidate before activation.
- [x] Candidate-to-active activation is committed as one NVS transaction after runtime validation.
- [x] Active configuration CRC failure triggers previous-snapshot recovery.
- [x] Deployment ID and deployment lifecycle state are persisted and exposed.
- [x] Explicit configuration deploy, rollback, and deployment-status REST endpoints exist.
- [x] Backend configuration proxy preserves deployment metadata and journals desired/device/previous versions.
- [x] Stale expected-version requests return HTTP 409 and are not retried against ESP32 automatically.
- [x] Backend-to-ESP32 fallback is transport-unavailability only, preventing ambiguous duplicate configuration commits.
- [x] UI exposes ACTIVE / CANDIDATE_STAGED / FAILED deployment state.
- [x] `scripts/test_m3_m4_hardening.py` exercises the backend proxy, version conflict, explicit deploy and rollback contract.

**Residual physical gate:** ESP-IDF build, live device deployment, power-loss during NVS commit, and physical reboot recovery remain commissioning evidence and are not software claims.

## Acceptance Criteria

The full chain is demonstrably operational:

```text
UI
 ↓
API
 ↓
Configuration
 ↓
Validation
 ↓
Compilation
 ↓
Deployment
 ↓
ESP32
 ↓
Physical actuator/system
 ↓
Telemetry / Event
 ↓
Backend/UI
```

Physical claims must be backed by reproducible commissioning evidence rather than source-code inspection alone.

## Output

**End-to-End Verification Report + Physical Commissioning Record**.

---

# 20. UI / Backend / ESP32 Execution Order

| Milestone | UI | Backend / Contract | ESP32 |
|---|---|---|---|
| M0 | Types | **Primary** | Model/types |
| M1 | **Primary** | API | **Primary** |
| M2 | **Primary** | **Primary** | **Primary** |
| M3 | Editor | **Primary** | Config parser/storage |
| M4 | Deployment UI | **Primary** | **Primary** |
| M5 | Consumer | Config authority | **Primary** |
| M6 | **Primary** | **Primary** | Runtime resource model |
| M7 | **Primary** | **Primary** | Consume compiled result |
| M8 | Schedule UI | **Primary compiler** | Compiled schedule format |
| M9 | Monitor/status | Configuration | **Primary** |
| M10 | Command/safety UI | API | **Primary** |
| M11 | Calibration UI | Calibration data | **Primary** |
| M12 | **Primary** | Recipe/run history | **Primary** |
| M13 | **Primary** | **Primary** | **Primary** |
| M14 | Status | Sync/history | **Primary** |
| M15 | **Primary** | **Primary** | Minimal local state |
| M16 | **Primary cleanup** | Cleanup | Cleanup |
| M17 | E2E UI | E2E orchestration | E2E + physical |

---

# 21. Gate Criteria

## Gate 1 — Configuration Ready

Must be complete before production scheduler work:

- [ ] Canonical configuration.
- [ ] Component registry.
- [ ] Versioning.
- [ ] Validation.
- [ ] Deployment.
- [ ] Rollback.

## Gate 2 — Runtime Ready

Must be complete before compiled automation:

- [ ] Dynamic GH.
- [ ] Dynamic components.
- [ ] Resource model.
- [ ] Assignment/ownership.
- [ ] Topology.
- [ ] Capability.
- [ ] Command validation.
- [ ] Safety foundation.

## Gate 3 — Automation Ready

Must be complete before production fertigation schedules:

- [ ] Schedule compiler.
- [ ] ACTIVE/BLOCKED lifecycle.
- [ ] Runtime scheduler.
- [ ] Sensor framework.
- [ ] Calibration framework.
- [ ] Fertigation integration.

## Gate 4 — Product Ready

Must be complete before claiming product readiness:

- [ ] Telemetry.
- [ ] Events.
- [ ] Offline/recovery.
- [ ] Crop/research relationships.
- [ ] Legacy/mock removal.
- [ ] E2E tests.
- [ ] Physical commissioning evidence.

---

# 22. Things That Should NOT Be Done Yet

Do not prioritize these before the foundation is ready:

- [ ] Do not spend substantial effort on dashboard cosmetics.
- [ ] Do not add seeded operational data.
- [ ] Do not add new mock telemetry.
- [ ] Do not build fan workflows that cannot reach ESP32 execution.
- [ ] Do not expand schedule UI without compiler/state semantics.
- [ ] Do not expand GH UI without dynamic device/configuration support.
- [ ] Do not remove all legacy code before replacement paths are verified.
- [ ] Do not perform a total rewrite merely because the architecture is being corrected.

---

# 23. Existing Foundations to Preserve Where Practical

The audit identified useful building blocks that should be evaluated for reuse rather than discarded automatically:

- ESP32 boot/HAL foundation.
- REST/API foundation.
- RTC foundation.
- Storage foundation.
- Command infrastructure.
- Calibration foundation.
- Sensor foundation.
- Safety foundation.
- Existing UI/API structure.

Preferred transformation:

```text
KEEP
 ↓
ADAPT
 ↓
DECOUPLE
 ↓
REWIRE
 ↓
TEST
 ↓
REMOVE LEGACY
```

rather than:

```text
DELETE EVERYTHING
 ↓
REWRITE
```

---

# 24. Priority Summary

## P0 — Foundation

**M0 → M1 → M2 → M3 → M4 → M5**

Purpose: establish common model, real UI/device connection, configuration, registry, deployment, rollback, and dynamic runtime.

## P1 — Resource + Automation

**M6 → M7 → M8 → M9**

Purpose: establish ownership, topology, capability, schedule compilation, and runtime scheduling.

## P1 — Physical Safety / Operation

**M10 → M11 → M12**

Purpose: establish command authorization, safety, sensors, calibration, and production fertigation.

## P2 — Data / Recovery / Research

**M13 → M14 → M15**

Purpose: establish historical telemetry, events, offline operation, recovery, and research relationships.

## Final

**M16 → M17**

Purpose: remove contradictory legacy paths and prove end-to-end/physical behavior.

---

# 25. Definition of Done for Every Task

Every implementation task must report:

```text
TASK:

PURPOSE:

DEPENDENCIES:

FILES / DOMAINS TOUCHED:

UI CHANGES:

BACKEND / CONTRACT CHANGES:

ESP32 CHANGES:

TESTS ADDED:

ACCEPTANCE CRITERIA:

TEST RESULT:

REMAINING GAP:
```

Do not report a task as complete merely because code compiles or a UI control exists.

A task is complete when its stated acceptance criteria are demonstrably satisfied at the appropriate layer.

---

# 26. Final Architectural Target

The finished system should conform to this model:

```text
UI
= operator interface

Backend / Configuration Authority
= validation + resource/topology reasoning + compilation + deployment + historical data

ESP32
= local autonomous regulator + safety + physical control + local execution + telemetry/event generation

Hardware Registry
= installed hardware truth

Capability Engine
= operational capability derived from configuration/topology/assignment/safety/calibration

Scheduler
= executes only compiled ACTIVE schedules

Telemetry / Events
= actual device/system state
```

Critical distinctions that must remain true:

```text
USER INTENT
≠
EXECUTABLE COMMAND
```

```text
SUPPORTED
≠
INSTALLED
≠
ASSIGNED
≠
COMMISSIONED
≠
AVAILABLE
```

```text
SAVED
≠
DEPLOYED
≠
ACTIVE
```

```text
GH EXISTS
≠
GH HYDRAULICALLY REACHABLE
≠
GH AUTOMATICALLY ROUTABLE
```

---

# 27. First Execution Step

The next implementation action is **not** to start coding all milestones.

Start with:

```text
M0 — Contract & Canonical Model
```

Then perform:

```text
Repository crawl
 ↓
Map current implementation to M0 requirements
 ↓
Identify reusable existing types/contracts
 ↓
Identify conflicts/duplicate models
 ↓
Implement canonical contract
 ↓
Compile/type-check/test
 ↓
Review against PRD
```

Only after M0 is stable should implementation proceed to M1.

The goal is controlled migration of the existing repository into the PRD architecture, not uncontrolled parallel rewrites.

---

## M17 — END-TO-END & PHYSICAL COMMISSIONING — 2026-09-19

### M17 FINAL ENGINEERING GATE STATUS: PARTIAL

M17 is explicitly split into two gates:

- **Software E2E: PARTIAL** — production source path and software verification PASS; clean frontend build and actual firmware/ESP-IDF build are BLOCKED by the current environment.
- **Physical Commissioning: BLOCKED** — no connected ESP32-S3, live sensors/actuators, electrical bench or hydraulic installation evidence is available in this execution environment.
- **Overall M17: PARTIAL**.

### Software E2E closure evidence

- `scripts/test_m17_software_e2e.py`: **28/28 PASS**.
- `scripts/test_forensic_authority.mjs`: **13/13 PASS**.
- M2: **26/26 PASS**.
- M3/M4: **PASS**.
- M5/M6: **PASS**.
- M7/M8 runtime: **22 PASS**.
- Backend M7/M8: **7/7 PASS**.
- M9: **16/16 PASS**.
- M10: **31/31 PASS**.
- Backend M10 proxy: **6/6 PASS**.
- M11/M12 backend: **34/34 PASS**.
- M11/M12 firmware production-path: **17/17 PASS**.
- M13: **PASS**.
- M14/M15: **PASS**.
- M16: **PASS**.
- OpenAPI/mock REST contract: **PASS** (28 endpoints / 26 handlers).
- Python backend/scripts compilation: **PASS**.

### M17-specific hardening discovered and completed

- Research analysis now normalizes epoch-millisecond fertigation run timestamps before crop-window comparison, allowing actual run history to join a crop cycle correctly.
- Frontend operational startup is gated by the authoritative operational-context hydrator; an empty operational context no longer falls through to legacy browser state.
- UI operational pages no longer use `complexes[0]`, `greenhouses[0]`, or `ghs[0]` singleton shortcuts; context is selected explicitly or by UI-only active/sole-complex fallback.
- Deployment endpoints are included in the canonical E2E contract inventory.

### M17 physical matrix remains OPEN/BLOCKED

The complete physical matrix is in `docs/M17_END_TO_END_AND_PHYSICAL_COMMISSIONING.md`.

The following physical evidence has NOT been claimed:

- live ESP32-S3 build/flash/boot
- live GPIO/relay/MOSFET behavior
- real sensor readings and disconnect states
- dosing calibration
- raw/delivery flow calibration
- E-stop under all runtime phases
- power-loss/brownout/reboot behavior
- offline spool persistence under physical interruption
- shared-resource concurrency on connected pumps/valves
- hydraulic route validation, leaks, backflow or starvation
- real fertigation volume reconciliation
- live crop/research traceability

### Clean-build/toolchain evidence

- `npm ci --ignore-scripts --no-audit --no-fund`: incomplete/timed out in the current environment.
- `npm run build`: **BLOCKED** because the partial dependency tree does not contain required `@types/*` packages; the failure occurs before Vite compilation.
- `idf.py`: **NOT FOUND**; real ESP-IDF firmware compilation is therefore BLOCKED.
- Delivered archive contains no `.git` metadata; no commit hash is available.

### Safe Point

`SP-M17-SOFTWARE-READY`

Do NOT mark M17 physically complete until actual hardware evidence is recorded. `SP-M17-COMPLETE` is not created.


### M17 FINAL GPIO/HARDWARE AUDIT — 2026-09-19

- Authoritative pin source is `docs/HARDWARE_WIRING_MAP.md` (SSOT).
- W-01..W-26 source values match the SSOT.
- Safe boot covers all 9 mapped actuator outputs.
- Canonical runtime pin-policy rejects reserved/unavailable/duplicate/non-canonical physical GPIO mappings.
- M17 hardware installation remains BLOCKED: no dedicated physical E-stop mapping, W-15 ZJ-B1/YF-B1 contradiction inside SSOT, and no physical evidence.
