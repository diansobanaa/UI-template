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
- [x] M2.18 Validate installation metadata.
  - Evidence: `api_config_handlers.c` validates lifecycleState enum, deploymentStatus enum, wiring interface enum, GPIO range [0,48]. Tests M2.18a–M2.18d PASS.
- [x] M2.19 Validate assignment metadata.
  - Evidence: `api_config_handlers.c` validates `assignment.complexId` presence. Tests M2.19a–M2.19b PASS.
- [x] M2.20 Expose inventory and registry state.
  - Evidence: `handler_get_inventory()` iterates `hardware_registry_get_count/get_by_index()`. Active registry refreshed on PUT /configuration. Tests M2.20 PASS.

## ESP32 Backlog

- [x] M2.21 Parse component registry.
  - Evidence: `hardware_registry_load_from_json()` parses componentId, supportedTypeId, lifecycleState, deploymentStatus, wiring, assignment, parameters from JSON. Behavioral test M2.21 PASS (4 components loaded).
- [x] M2.22 Persist installed registry.
  - Evidence: `hardware_hal_init_all()` loads from NVS `lvc_json` key via `storage_mgr_load_config()`, with SPIFFS `components.json` fallback. CRC integrity check on reload. Behavioral test M2.22 PASS.
- [!] M2.22 Reboot persistence (physical hardware).
  - Status: BLOCKED — ESP32 not connected (no COM port detected). Cannot flash. NVS/SPIFFS code paths verified by code review; physical reboot test deferred.
- [x] M2.23 Resolve components by logical ID.
  - Evidence: `hardware_registry_find_by_id()` iterates active registry and returns by componentId string. Tests M2.23a–M2.23b PASS.
- [x] M2.24 Resolve channel dynamically from configuration.
  - Evidence: `actuator_hal_set()` calls `hardware_registry_find_by_id()` and dynamically re-binds GPIO if configuration wiring differs from static default. `hardware_registry_resolve_gpio/channel()` helpers added. Tests M2.24a–M2.24d PASS (including multi-instance same driver).
- [x] M2.25 Track component state.
  - Evidence: `actuator_hal_set()` blocks ON if lifecycle ≠ COMMISSIONED or ENABLED. `actuator_hal_set_by_component_id()` also enforces lifecycle. Tests M2.25a–M2.25d PASS.
- [x] M2.26 Expose registry through API.
  - Evidence: `handler_get_inventory()` exposes active `s_active_components[]` with full InstalledComponent schema: lifecycleState, deploymentStatus, wiring, assignment, parameters. PUT /configuration triggers live registry reload. Tests M2.26a–M2.26b PASS.

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

- [x] M3.1 Schema validation.
- [x] M3.2 Semantic validation.
- [x] M3.3 Resource validation.
- [x] M3.4 Topology validation.
- [x] M3.5 Safety dependency validation.
- [x] M3.6 Hardware compatibility validation.
- [x] M3.7 Configuration versioning.

### ESP32

- [x] M3.8 Configuration parser.
- [x] M3.9 Schema validation.
- [x] M3.10 Candidate configuration representation.
- [x] M3.11 Active configuration representation.
- [x] M3.12 Configuration hash/CRC.

### UI

- [x] M3.13 Configuration editor.
- [x] M3.14 Validation result display.
- [x] M3.15 Validation error details.
- [x] M3.16 Configuration version display.
- [x] M3.17 Draft state.

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

- [x] Invalid semantic relationships are rejected.
- [x] Missing required resources are detected.
- [x] Unsupported hardware mappings are detected.
- [x] Validation errors identify the relevant component/GH/resource where applicable.

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

- [x] M4.1 Staging configuration.
- [x] M4.2 Active configuration.
- [x] M4.3 Previous/rollback configuration.
- [x] M4.4 Atomic activation.
- [x] M4.5 Boot recovery.
- [x] M4.6 Deployment ID.
- [x] M4.7 Deployment acknowledgement.
- [x] M4.8 Active version reporting.
- [x] M4.9 Failed deployment state.
- [x] M4.10 Rollback.
- [x] M4.11 UI pending state.
- [x] M4.12 UI deployed/applied state.
- [x] M4.13 UI failed state.

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

- [x] UI knows v11 failed.
- [x] UI does not show false success.
- [x] ESP32 reports the actual active version.
- [x] A failed candidate cannot partially replace active configuration.

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

## Acceptance Criteria

- [x] An installed resource cannot silently have two exclusive owners.
- [x] Transfer updates ownership.
- [x] Old owner loses access/capability where appropriate.
- [x] New owner gains capability only after valid assignment.
- [x] Affected schedules are revalidated.

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

## Acceptance Criteria

Single-GH direct topology may omit unnecessary distribution valves.

Multi-GH without routing valves must not be presented as automatically independent.

- [x] Capabilities reflect actual topology.
- [x] Routing conflicts are detected before activation.
- [x] UI clearly exposes manual-routing vs automatic-routing conditions.

## Output

**Topology Model + Capability Engine v1**.

---

# 10. Milestone M8 — Schedule Compiler

## Goal

Replace direct raw schedule dispatch with validation and compilation.

## Dependencies

M7.

## Work Order

**Backend compiler → UI schedule state → ESP32 compiled-schedule format**

## Backlog

- [ ] M8.1 Schedule intent schema.
- [ ] M8.2 Target Complex resolution.
- [ ] M8.3 Target GH resolution.
- [ ] M8.4 Action resolution.
- [ ] M8.5 Parameter validation.
- [ ] M8.6 Component resolution.
- [ ] M8.7 Resource resolution.
- [ ] M8.8 Topology resolution.
- [ ] M8.9 Safety dependency resolution.
- [ ] M8.10 Resource conflict validation.
- [ ] M8.11 Recurrence validation.
- [ ] M8.12 Recipe snapshot/version.
- [ ] M8.13 Configuration version reference.
- [ ] M8.14 Priority.
- [ ] M8.15 Missed-run policy.
- [ ] M8.16 Compile.
- [ ] M8.17 Blocked reason.
- [ ] M8.18 Deployment of compiled schedule.

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

- [ ] BLOCKED schedules cannot become executable ACTIVE schedules.
- [ ] INVALID schedules cannot execute.
- [ ] DRAFT schedules cannot execute.
- [ ] DISABLED schedules cannot execute.
- [ ] Compiled schedule contains resolved runtime dependencies.

## Output

**Compiled Schedule Format v1** and compiler pipeline.

---

# 11. Milestone M9 — ESP32 Runtime Scheduler

## Goal

Make the ESP32 scheduler consume only compiled ACTIVE schedules.

## Dependencies

M8.

## Backlog

- [ ] M9.1 Local clock/time source.
- [ ] M9.2 Evaluate ACTIVE schedules only.
- [ ] M9.3 Due-time evaluation.
- [ ] M9.4 Execute compiled action.
- [ ] M9.5 Acquire resource locks.
- [ ] M9.6 Queue conflicting work.
- [ ] M9.7 Support independent-path concurrency.
- [ ] M9.8 Priority handling.
- [ ] M9.9 Missed schedule policy.
- [ ] M9.10 Reboot recovery.
- [ ] M9.11 Power recovery integration.
- [ ] M9.12 Duplicate protection.

## Acceptance Criteria

- [ ] Scheduler never dispatches BLOCKED schedules.
- [ ] Scheduler never dispatches INVALID/DRAFT/DISABLED schedules.
- [ ] Scheduler does not perform complex topology discovery at execution time.
- [ ] Shared resources serialize correctly.
- [ ] Independent physical paths may run concurrently where configuration allows.

## Output

**Production Scheduler Runtime v1**.

---

# 12. Milestone M10 — Command System + Safety

## Goal

Make all physical commands safety-authorized and idempotent.

## Dependencies

M9.

## Command Backlog

- [ ] M10.1 Command ID.
- [ ] M10.2 Target Complex/GH.
- [ ] M10.3 Target resource/component.
- [ ] M10.4 Parameters.
- [ ] M10.5 Configuration version context.
- [ ] M10.6 Command validation.
- [ ] M10.7 Resource check.
- [ ] M10.8 Safety check.
- [ ] M10.9 E-stop check.
- [ ] M10.10 Duplicate command detection.
- [ ] M10.11 Idempotent retry behavior.
- [ ] M10.12 Command result.
- [ ] M10.13 Command event generation.

## Safety Backlog

- [ ] M10.14 Complete safe boot coverage.
- [ ] M10.15 E-stop latch.
- [ ] M10.16 Reject conflicting commands while E-stop is latched.
- [ ] M10.17 Prevent scheduler execution while E-stop policy blocks it.
- [ ] M10.18 Maximum runtime per hazardous actuator/resource.
- [ ] M10.19 Flow timeout protection.
- [ ] M10.20 Low-level protection.
- [ ] M10.21 High-level/overfill protection strategy.
- [ ] M10.22 Invalid/stale safety sensor fallback.
- [ ] M10.23 Fault state.
- [ ] M10.24 Recovery state.
- [ ] M10.25 Durable safety event path.

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

- [ ] Retrying the same command ID cannot double-execute a dangerous operation.
- [ ] Safe boot covers all configured safety-critical outputs.
- [ ] Every applicable hazardous actuator has a maximum runtime policy.

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

- [ ] M11.1 Generic sensor identity.
- [ ] M11.2 Sensor type.
- [ ] M11.3 Source/channel.
- [ ] M11.4 Unit.
- [ ] M11.5 Sampling interval.
- [ ] M11.6 Calibration reference.
- [ ] M11.7 Validity range.
- [ ] M11.8 Fault state.
- [ ] M11.9 Quality state.
- [ ] M11.10 Timestamp.
- [ ] M11.11 Temperature support.
- [ ] M11.12 Humidity abstraction.
- [ ] M11.13 Light abstraction.
- [ ] M11.14 Level abstraction.
- [ ] M11.15 Flow abstraction.
- [ ] M11.16 Pressure abstraction.
- [ ] M11.17 pH abstraction.
- [ ] M11.18 EC abstraction.

## Calibration Backlog

- [ ] M11.19 Dosing calibration.
- [ ] M11.20 Flow calibration.
- [ ] M11.21 Level calibration.
- [ ] M11.22 pH calibration.
- [ ] M11.23 EC calibration.
- [ ] M11.24 Calibration version.
- [ ] M11.25 Timestamp.
- [ ] M11.26 Operator/technician.
- [ ] M11.27 Validity state.
- [ ] M11.28 Expired/suspect state.
- [ ] M11.29 Historical calibration reference.
- [ ] M11.30 Runtime uses explicit calibration record.

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

- [ ] M12.1 Target GH.
- [ ] M12.2 Recipe validity.
- [ ] M12.3 Required resources.
- [ ] M12.4 Required sensors.
- [ ] M12.5 Calibration validity.
- [ ] M12.6 Safety conditions.
- [ ] M12.7 Source/tank availability.
- [ ] M12.8 Conflict check.

### Filling

- [ ] M12.9 Select target GH mixing tank.
- [ ] M12.10 Select water source.
- [ ] M12.11 Measure incoming volume.
- [ ] M12.12 Stop at target volume.
- [ ] M12.13 Tolerance policy.
- [ ] M12.14 Timeout/failure policy.

### Dosing

- [ ] M12.15 Resolve logical dosing channels.
- [ ] M12.16 Support up to seven logical dosing channels.
- [ ] M12.17 Requested quantity.
- [ ] M12.18 Calibration lookup.
- [ ] M12.19 Runtime calculation.
- [ ] M12.20 Minimum/maximum runtime enforcement.
- [ ] M12.21 Actual commanded operation record.

### Mixing

- [ ] M12.22 Configurable mixing duration.
- [ ] M12.23 Record mixing phase timestamps.

### Delivery

- [ ] M12.24 Target delivery mode.
- [ ] M12.25 Measured delivered volume where configured.
- [ ] M12.26 Flow-derived target where configured.
- [ ] M12.27 Pressure/flow readiness where configured.
- [ ] M12.28 Duration fallback only when explicitly configured.
- [ ] M12.29 Distinguish mixed volume from actual delivered volume.

### Run Record

- [ ] M12.30 Run ID.
- [ ] M12.31 Complex ID.
- [ ] M12.32 GH ID.
- [ ] M12.33 Trigger type.
- [ ] M12.34 Schedule ID where applicable.
- [ ] M12.35 Recipe ID/version.
- [ ] M12.36 Configuration version.
- [ ] M12.37 Target water volume.
- [ ] M12.38 Target dosing quantities.
- [ ] M12.39 Actual water volume.
- [ ] M12.40 Actual dosing runtimes.
- [ ] M12.41 Calibration references.
- [ ] M12.42 Start/end timestamps.
- [ ] M12.43 Phase timestamps.
- [ ] M12.44 Final status.
- [ ] M12.45 Fault/error information.
- [ ] M12.46 Operator/source.

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

- [ ] M13.1 Real-time telemetry.
- [ ] M13.2 Complex association.
- [ ] M13.3 GH association.
- [ ] M13.4 Device association.
- [ ] M13.5 Component/source association.
- [ ] M13.6 Timestamp.
- [ ] M13.7 Metric ID.
- [ ] M13.8 Value.
- [ ] M13.9 Unit.
- [ ] M13.10 Quality.
- [ ] M13.11 Calibration/version metadata where relevant.
- [ ] M13.12 Durable historical storage.

## Event Backlog

- [ ] M13.13 Fertigation started.
- [ ] M13.14 Fertigation completed.
- [ ] M13.15 Fertigation interrupted.
- [ ] M13.16 Pump started/stopped.
- [ ] M13.17 Schedule triggered/skipped.
- [ ] M13.18 Emergency stop.
- [ ] M13.19 Sensor fault.
- [ ] M13.20 Flow timeout.
- [ ] M13.21 Tank-full protection.
- [ ] M13.22 Configuration deployed.
- [ ] M13.23 Configuration rejected.
- [ ] M13.24 Power failure.
- [ ] M13.25 Power restored.
- [ ] M13.26 Calibration changed.
- [ ] M13.27 Communication lost/restored.
- [ ] M13.28 Watchdog/abnormal reset where detectable.

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

- [ ] Missing telemetry samples are not represented as real zero.
- [ ] UI distinguishes true zero from missing/stale/invalid data.
- [ ] Event storage has a defined failure behavior.

## Output

**Telemetry + Event System v1**.

---

# 16. Milestone M14 — Offline & Recovery

## Goal

Ensure the greenhouse remains autonomous and data remains recoverable during network or power interruptions.

## Dependencies

M13.

## Backlog

- [ ] M14.1 Offline schedule execution.
- [ ] M14.2 Last-valid configuration retention.
- [ ] M14.3 Offline telemetry queue.
- [ ] M14.4 Offline event queue.
- [ ] M14.5 Synchronization cursor.
- [ ] M14.6 Replay.
- [ ] M14.7 Deduplication.
- [ ] M14.8 Reconnect handling.
- [ ] M14.9 Missed schedule evaluation.
- [ ] M14.10 Interrupted fertigation disposition.
- [ ] M14.11 Reboot recovery state.
- [ ] M14.12 Configuration pending-deployment state.

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

- [ ] M15.1 Crop cycle per GH.
- [ ] M15.2 Planting date.
- [ ] M15.3 Pollination date.
- [ ] M15.4 Harvest date.
- [ ] M15.5 HST.
- [ ] M15.6 HSP.
- [ ] M15.7 Plant identity.
- [ ] M15.8 Mortality records.
- [ ] M15.9 Fruit identity.
- [ ] M15.10 Fruit weight.
- [ ] M15.11 Grade.
- [ ] M15.12 Observations.
- [ ] M15.13 Historical cycle persistence.
- [ ] M15.14 Telemetry relationship.
- [ ] M15.15 Fertigation-run relationship.
- [ ] M15.16 Recipe relationship.
- [ ] M15.17 Calibration relationship.
- [ ] M15.18 Research retrieval queries.

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
