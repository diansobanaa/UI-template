# PROJECT IMPLEMENTATION STATUS & GAP REPORT

**Version:** v1, revised in place on 2026-09-18.  
**Authority:** `PRODUCT_REQUIREMENTS_DOCUMENT.md` (PRD).  
**Evidence:** current source tree, contract, tests, and docs. This report does not alter the PRD or infer physical behavior from source.

## 1. Audit Scope

The audit covers the 272 non-dependency/non-build files indexed in the workspace: React UI and local service layer, direct ESP32 client, firmware, HAL, storage, network, HTTP handlers, OpenAPI, test script, and installation documentation. Historical handovers are context only, not proof. Each criterion below separates software existence, integration, reachability, test evidence, and physical commissioning.

## 2. Source Documents

- Product definition: `PRODUCT_REQUIREMENTS_DOCUMENT.md`, sections 0–50 and appendices.
- Existing baseline: this report, revised rather than replaced by another audit document.
- Runtime evidence: `src/**`, `esp32/main/**`, `contracts/UI_ESP32_OPENAPI.yaml`, `scripts/verify_e2e_contracts.mjs`.

## 3. Audit Method

Each PRD behavior was split into independently testable acceptance criteria. Evidence follows PRD criterion → source symbol → runtime/UI/API/persistence path → test/hardware evidence. A UI card, a contract route, a registry descriptor, or a historical claim is not counted as an integrated physical feature without the required path.

## 4. Status Definitions

`FULLY IMPLEMENTED` means the intended product path exists. `PARTIALLY IMPLEMENTED` means a meaningful portion exists with a material gap. `IMPLEMENTED BUT BROKEN` means reachable code violates the PRD. `IMPLEMENTED BUT NOT INTEGRATED` and `IMPLEMENTED BUT NOT REACHABLE` distinguish disconnected code from unreachable code. `UI ONLY`, `FIRMWARE ONLY`, `MOCK / SIMULATION ONLY`, `MISSING`, `CONTRADICTORY`, and `UNKNOWN` are used literally. Physical absence or lack of commissioning is reported separately and never converts existing software into MISSING.

## 5. Executive Status

The current codebase is a **single-controller, fixed-hardware firmware foundation plus a broad browser prototype**. Useful firmware exists for GPIO actuation, selected sensors, NVS/SPIFFS, local timed tasks, REST, E-stop, and a fixed A/B fertigation sequence. The PRD's governing architecture—configuration-driven Complex/GH/component assignment/capability/compiler model—does not exist.

Most importantly, firmware context, crop cycle, and telemetry are GH-01-centric; schedules have no GH target, resource set, binding, activation state, blocked reason, or configuration version. Multi-GH UI data therefore is not multi-GH product operation. No global percentage is used because the atomic requirements are unequal in impact.

## 6. Atomic Requirement Coverage

Appendix A is the register. It replaces v1's coarse feature labels with independently auditable requirements and evidence.

## 7. Complex / Multi-GH

The UI has `Complex[]`, `Greenhouse[]`, and `addGreenhouse()` in `src/lib/store.ts`; that data is browser `localStorage`, not ESP32 provisioning. Firmware persists one complex ID in `storage_mgr_init()`. `handler_get_context()` returns only `gh-01`, `api_cropcycle_handlers.c` rejects non-`gh-01`, and the telemetry handler creates telemetry for `gh-01`. There is no persisted GH list, per-GH configuration, recipe/schedule/telemetry/event ownership, or GH resource map.

Single-GH fallback is thus a hardwired implementation, not the PRD's valid simplified topology. GH-2/N requires source changes.

## 8. Component Registry

`hardware_registry.c` parses default or persisted JSON into `hw_component_info_t`; it includes ID, name, type, role, interface, pin/channel, safety class, status. `storage_mgr_*components_json` persists/loads it and `handler_get_inventory()` exposes it. This establishes JSON persistence, boot loading, and inventory readout.

Missing are enabled/install transitions, capabilities, dependencies, calibration association, Complex/GH assignment, ownership, availability, UI/Super-Admin mutation, validation/deployment, and runtime binding. `actuator_hal.c` and `sensor_hal.c` continue to use fixed arrays/pins, so registry configuration does not instantiate or rebind hardware.

## 9. Hardware Installation & Commissioning

Current-component wiring/assembly Markdown exists. The required lifecycle is broken after documentation: no user registration/naming, configuration validation, deployment confirmation, per-component boot discovery/probe, or runtime availability state. Existing hardware and physical tests are **unverified by this audit**; guide availability is not commissioning.

## 10. Resource Assignment & Ownership

`actuator_hal_acquire()` gives a volatile lock to a fixed GPIO, with MANUAL/FERTIGATION/TRANSFER owners. It is not GH resource ownership. No persisted component assignment, shared flag, capability, availability, or dependency graph exists.

## 11. Resource Transfer

For the PRD's four-GH/two-fan scenario, every required stage is absent: missing fan detection, candidate/current-owner discovery, physical movement warning/instructions, confirmation, ownership update, invalidation/revalidation, compilation/deployment, and old/new GH access change. `transfer_mgr.c` transfers liquid by fixed actuator/duration; it is not a resource-transfer system. The result is the same for pumps, meters, EC/pH/pressure sensors, valves, and other shared resources.

## 12. Schedule Lifecycle

`schedule_entry_t` has only ID, enabled, type, action, duration, time/day/interval, and ephemeral execution fields. `api_schedule_add_handler()` writes it directly to NVS. It contains no draft/validating/active/blocked/invalid state, GH, recipe, resources, topology, dependencies, priority, validity period, policy, blocked reason, or configuration version. `SCHED_TYPE_ONCE` parses but `scheduler_task()` has no branch to execute it.

## 13. Schedule Compilation

No compiler exists. `validate_config_payload()` only checks a configuration object, timezone length, maximum schedule count, action, and duration range. It does not validate GH identity, installed components, assignment, owner, routing, safety, conflicts, recurrence, or hardware compatibility. Configuration PUT does not install schedules; schedule POST bypasses configuration validation. The runtime is simple only because no resolved bindings exist.

## 14. ACTIVE / BLOCKED Enforcement

The PRD hard rule is violated. The UI model has no BLOCKED state/cause and firmware's `enabled` bool makes a schedule executable after shallow parsing. A missing resource cannot be represented or explained. `SCHED_ACTION_FERTIGATION` maps to `CMD_TYPE_DOSING_RUN`, not a batch; `SCHED_ACTION_FAN_TOGGLE` maps to unsupported `CMD_TYPE_CUSTOM`. Neither behavior is compiled ACTIVE execution.

## 15. ESP32 Runtime Model

`scheduler_task()` checks local time then calls `dispatch_schedule()`. It neither discovers topology nor receives compiled topology. Required work is configuration-time resolution into a persisted executable schedule (GH, resolved IDs, dependencies, resource set, policy, config snapshot); runtime should then run only that binding.

## 16. Fertigation

`fertigation_mgr.c` supplies fixed IDLE/FILLING/DOSING/FINAL_MIXING/DELIVERY/COMPLETE/INTERRUPTED states. Filling starts raw submersible and mixing pumps; calibrated ZJ-B1 volume stops fill; A/B dose by time; mixing is fixed 180 seconds; distribution is fixed 60 seconds; E-stop/fault interrupts and zero raw flow after 30 seconds interrupts filling.

Missing: PRECHECK; GH/tank/routing; recipe lookup/snapshot/version; tolerance; seven logical channels; pH Up/Down; configurable mix time; measured delivery; pressure criterion; full fault/recovery state; durable run/event history; and correct scheduled batch execution. Absent A/B calibration silently becomes `1.0f` mL/s in `fertigation_mgr_start_batch()`, so dosing is reachable but does not satisfy calibration-critical precision.

## 17. Precision Fertigation

Raw-water measurement is partial after flow calibration. A/B nutrient quantity is calculated from a rate, but can use an arbitrary fallback. pH quantity, EC/pH feedback, adaptive dosing, delivery-volume precision, pressure control, recipe versioning, and repeatability/tolerance evidence are absent. FS400A is sampled but does not terminate delivery.

## 18. Recipes

UI types and seed data contain recipes. Firmware commands receive only raw/A/B scalar values. No controller recipe persistence, GH applicability, immutable snapshot, revision, publishing, delivery rule, pH/EC target, or run association exists. Status: **MOCK / SIMULATION ONLY** for the product recipe workflow.

## 19. Pumps

Well, raw, mixing, distribution, A/B dosing fixed HAL IDs have names/GPIOs/state/owner locks. Well/dist/A+B have command paths; raw/mixing are mainly sequence internals. There is no configuration-driven pump registry, GH assignment, future pump abstraction, per-pump limit/flow policy, resource queue, or durable operation record. `run_time_seconds` is always zero in `actuator_hal_get_status()`.

## 20. Fans / Climate

Cooling/blower GPIO descriptors exist, but no public fan command is wired. The scheduler maps fan to unsupported CUSTOM. No GH allocation, date-specific execution, temperature/humidity control, hysteresis, interval semantics beyond generic scheduler support, or transfer workflow exists. GPIO presence is not fan scheduling capability.

## 21. Valves / Routing

No valve exists in the actuator enum. `transfer_mgr` accepts an optional actuator as a destination valve but no real valve ID can be supplied. There is no route graph, manual hose ownership, no-valve capability policy, physical confirmation, or independent zone model. Thus the product cannot distinguish manual GH-02 preparation/scheduled delivery from unavailable automatic dosing/routing.

## 22. Sensors

Firmware supports DS18B20 water temperature, ZJ-B1 raw flow, FS400A delivery flow, lower float, and tamper. Temperature validity exists; flow/float are partly exposed and lower float is used in safety. pH, EC, humidity, light, pressure, and high-level fill sensing lack driver/HAL/configuration/registry/install/calibration/control paths. UI sample humidity/light/history values are mock unless a live field overwrites them.

## 23. Calibration

NVS rate persistence and A/B endpoints exist; raw-flow calibration is documented in the current source/doc set. Missing are complete measured-output procedures, version/timestamp/operator/result, generic component association, pH/EC/level/temperature/humidity calibration, and safe failure behavior. The arbitrary 1 mL/s runtime fallback is a critical calibration contradiction.

## 24. Irrigation Hydraulics

No software/configuration model exists for emitter operating/sealing pressure, pump head/curve, elevation, pipe/filter/manifold loss, emitter count, simultaneous zones, pressure sensor, overpressure, series pumping, or commissioning calculations. Physical hydraulic adequacy is **UNKNOWN**, not a software failure claim.

## 25. Safety

Implemented local elements: early safe boot, HAL safe-off, persistent E-stop latch, lower-float checks for selected pumps, manual/transfer duration behavior, fill no-flow detection, high-temperature/tamper/welded-flow E-stop paths, and individual actuator locking. Gaps: early `safe_boot_actuators()` omits blower/mixing; no physical high-level overfill interlock; no configurable per-pump policy; incomplete invalid/stale sensor policy; no schedule/config/resource rejection model; SD-disabled events lack durable fallback; E-stop is GPIO logic, not proven electrical isolation.

## 26. Telemetry

`telemetry_mgr` samples every two seconds, exposing current temperature validity, float, flow, selected pump state, timestamp, complex ID, and a fixed GH. There is no GH stream map, pH/EC/pressure/humidity/light data, complete quality state, durable history, offline buffer, replay, or synchronization. UI charts are seeded simulation.

## 27. Crop & Research

`crop_cycle_mgr` persists one cycle and calculates HST/HSP, planting/pollination/cancel/harvest/yield/grade. It is singleton and GH-01 constrained. It lacks crop history per GH, plants/fruits/mortality/progress/weights, structured observations, and links to telemetry, fertigation, recipe, or calibration. UI observations are localStorage. `crop_cycle_mgr_harvest()` defaults omitted yield to 300.0, which can fabricate a record.

## 28. Persistence

NVS stores IDs, config JSON/version/CRC, E-stop, schedules, crop singleton, and calibration; SPIFFS stores components; optional SD stores a rotating event log. There is no candidate/active two-slot config, rollback artifact, telemetry/run queue, sync cursor, active-run recovery, or durable event fallback. SPIFFS mount allows format-on-failure, which is not last-known-good recovery.

## 29. Offline / Network Failure

Local tasks/NVS schedules can run without a backend after boot, but no full validated configuration/compiler path, offline UI staging status, SD-independent event retention, replay/reconciliation, or offline acceptance test exists. This is separate from power loss.

## 30. Power Failure / Recovery

No implementation models power detection, automatic PLN/backup switching, battery charging/cutoff/measurement, critical-load policy, pump continuity, power events, or restoration. Boot restores selected NVS data and clears schedule running flags; it does not persist/classify an interrupted fertigation batch or apply a missed-schedule policy. UPS hardware availability/commissioning is UNKNOWN.

## 31. Configuration Deployment

The direct client can get/validate/put configuration. Firmware does version comparison and NVS CRC save. It does not stage, semantically validate, compile, atomically activate runtime services, confirm activation, or roll back. UI synchronization flags are local model state; a UI success cannot prove device activation.

## 32. UI

Complex/GH/dashboard/fertigation/schedule/calibration/events/crop screens exist. Most mutations write seeded browser state. Missing authoritative workflows include registry administration, install guide linkage, assignment/transfer, BLOCKED schedule explanation, activation receipt/reconciliation, roles, and complete failed-save rollback.

## 33. Super Admin

No role/permission model, Super Admin account, component administration, or deployment authority path exists. The device bearer token is not role authorization.

## 34. API

Health/status/inventory/context/clock/config/commands/crop/telemetry/events handlers plus calibration/schedule routes exist. Auth is applied to selected command/config/crop mutations but schedule/calibration mutation handlers lack `http_check_auth`. The default token is compiled into `http_server.c`. Contract route presence is not endpoint behavior proof.

## 35. Tests

`npm run test -- --mock` passed. It checks 25 route strings in OpenAPI, 26 handler-name strings in `http_server.c`, and sends health/status/inventory only to its own Node mock server. It proves neither flashed firmware behavior nor payload/error compatibility beyond that mock. No unit, firmware-host, schedule/resource/compiler, fault-injection, bench, hydraulic, sensor-accuracy, or power-transition test was found/run in this audit.

## 36. Contradictions

Detailed entries are Appendix H. The principal contradictions are PRD 1..N GH versus GH-01 hardcoding; ACTIVE/BLOCKED rule versus `enabled`; fertigation/fan schedule dispatch; safe calibration versus arbitrary fallback; physical high-level protection versus UI-only capacity validation; and dynamic registry claim versus fixed HAL authority.

## 37. Unknown / Unverified Items

Appendix I lists unknown physical facts and exact evidence required. Unknown is not converted into a failure.

## 38. Implementation Gaps

The foundational missing chain is: component schema/registry mutation → Complex/GH assignment/capabilities → semantic/topology/resource/safety validator → compiler + candidate/active store → deployment acknowledgement/rollback → executable schedules/resource manager → GH-targeted execution/history/UI. Adding isolated UI controls or hardware IDs before this chain would not meet the PRD runtime rule.

## 39. Implementation Dependency Chain

```text
Component registry mutation
→ Complex/GH/resource assignment + capability model
→ semantic/topology/safety validator
→ compiler + versioned candidate/active configuration
→ activation acknowledgement + rollback
→ resource-aware schedules and GH-targeted runtime
→ fertigation/routing/telemetry/history/UI integration
→ host, bench, and commissioning verification
```

## 40. Current Product Capability

The code can boot an ESP32; initialize fixed GPIO/sensors; retain selected NVS data; expose selected REST status/inventory/configuration interfaces; run selected manual/timed actions; execute a fixed A/B state machine; persist one crop cycle; and render a broad local UI prototype. It cannot truthfully claim configuration-driven multi-GH operation, compiled safe schedules, installable hardware management, precision chemistry, research traceability, or power-failure continuity.

## 41. Current Codebase Reality

The UI models more of the intended product than the physical authority does. Firmware constraints determine production reachability. Documentation of a future component is not software support until driver/HAL/schema/registry/runtime/commissioning paths exist.

## 42. Final Requirement Coverage

Appendix A is the final evidence register. Each row names the implemented, missing, broken, integration, test, and hardware dimensions; it is the source for the summaries above.

# APPENDIX A — ATOMIC REQUIREMENT TRACEABILITY MATRIX

| ID | Expected atomic behavior | Current implementation | Status | Integration / reachability | Test / hardware | Evidence |
|---|---|---|---|---|---|---|
| ARCH-001 | Persist Complex identity | one NVS ID | PARTIAL | reachable; no Complex schema | no test | `storage_mgr.c:storage_mgr_init` |
| ARCH-002 | 1..N GH configured to Complex | UI array only | UI ONLY | firmware GH-01 only | mock only | `store.ts:addGreenhouse`; context handler |
| ARCH-003 | GH identity from configuration | none | MISSING | GH-01 hardcoded | no test | crop/telemetry handlers |
| ARCH-004 | GH-specific recipe/schedule/telemetry/crop/event | UI fields only | UI ONLY | no GH-02 firmware path | mock only | `types.ts`, crop/telemetry mgrs |
| ARCH-005 | Add GH without source rewrite | no | CONTRADICTORY | GH-02 rejected/ignored | no test | `api_cropcycle_handlers.c`, context |
| ARCH-006 | Local autonomous control | task/NVS foundation | PARTIAL | no compiled LVC | no offline test | scheduler/storage |
| ARCH-007 | Candidate schema validation | shallow checks | PARTIAL | PUT reachable | mock only | `validate_config_payload` |
| ARCH-008 | Semantic/resource/topology validation | none | MISSING | N/A | N/A | config handler |
| ARCH-009 | atomic swap/rollback | single NVS save+CRC | PARTIAL | no rollback/activation | no test | `storage_mgr_save_config` |
| COMP-001 | component ID/type/name/mapping/status | JSON fields | PARTIAL | inventory only | no boot test | `hw_component_info_t` |
| COMP-002 | rename/register/UI administration | none | MISSING | N/A | N/A | UI/API search |
| COMP-003 | install/enabled/capability/dependency/calibration | none | MISSING | N/A | N/A | registry struct |
| COMP-004 | Complex/GH/owner/availability assignment | none | MISSING | N/A | N/A | registry/config |
| COMP-005 | JSON persist/boot load | SPIFFS+NVS | PARTIAL | no managed mutation | no device test | storage/registry |
| COMP-006 | registry dynamically binds drivers | fixed HAL arrays | NOT INTEGRATED | parsed JSON does not bind | no test | `actuator_hal.c`, `sensor_hal.c` |
| HW-001 | guide and wiring | Markdown only | PARTIAL | not workflow-linked | docs, physical unverified | assembly/wiring docs |
| HW-002 | install→register→validate→deploy→available | none | MISSING | N/A | N/A | UI/API/firmware search |
| RES-001 | GH/Complex resource assignment | none | MISSING | N/A | N/A | models |
| RES-002 | persisted owner/shared/availability | transient actuator owner | PARTIAL | no GH owner | no test | `actuator_hal_acquire` |
| RES-003 | capability/dependency evaluation | none | MISSING | N/A | N/A | scheduler/config |
| XFER-001 | detect GH-03 missing fan | none | MISSING | N/A | N/A | UI/runtime |
| XFER-002 | candidates/current owner/confirmation | none | MISSING | N/A | N/A | registry |
| XFER-003 | physical move instruction/transaction | none | MISSING | N/A | N/A | UI/docs linkage |
| XFER-004 | invalidate/recompile/deploy old/new GH | none | MISSING | N/A | N/A | all runtime paths |
| TOPO-001 | no-valve manual GH-02 capability | none | MISSING | N/A | N/A | no capability model |
| TOPO-002 | block unavailable automatic routing/dosing | none | MISSING | enabled may execute | no test | schedule API |
| SCHED-001 | DRAFT/VALIDATING state | none | MISSING | N/A | N/A | `scheduler.h` |
| SCHED-002 | target GH | no field | MISSING | N/A | N/A | `schedule_entry_t` |
| SCHED-003 | action/parameter/recurrence syntax | limited action/duration | PARTIAL | reachable | mock only | schedule/config handlers |
| SCHED-004 | installed components | none | MISSING | N/A | N/A | handler |
| SCHED-005 | assignment/owner/topology/safety deps | none | MISSING | N/A | N/A | handler |
| SCHED-006 | pre-dispatch resource conflict | lock after dispatch only | PARTIAL | no resource-set check | no test | HAL lock |
| SCHED-007 | compile resolved executable binding | none | MISSING | N/A | N/A | scheduler |
| SCHED-008 | deployment acknowledgement | none | MISSING | save response only | no test | config/schedule APIs |
| SCHED-009 | ACTIVE only after success | enabled bool | CONTRADICTORY | may execute unvalidated | no test | `scheduler_task` |
| SCHED-010 | BLOCKED/INVALID cause/action | none | MISSING | N/A | N/A | UI + firmware |
| SCHED-011 | daily/weekdays/interval | logic present | PARTIAL | local but no bindings | mock only | `scheduler_task` |
| SCHED-012 | specific date | enum parses only | NOT REACHABLE | no ONCE branch | no test | scheduler enum/task |
| SCHED-013 | fallback/missed policy | none | MISSING | N/A | N/A | scheduler |
| SCHED-014 | fert schedule starts batch | sends DOSING_RUN | BROKEN | wrong command path | no test | `dispatch_schedule` |
| SCHED-015 | fan schedule starts fan | sends CUSTOM | BROKEN | command rejects it | no test | scheduler/command mgr |
| FERT-001 | precheck GH/recipe/resources | none | MISSING | scalar batch only | no test | start batch |
| FERT-002 | measured raw fill/tolerance | measured stop, no tolerance | PARTIAL | reachable | no bench test | FILLING state |
| FERT-003 | calibrated dosing validity | A/B rate + 1mL/s fallback | BROKEN | reachable unsafe | no test | start batch |
| FERT-004 | seven named/pH channels | A/B fixed | MISSING | N/A | N/A | actuator enum |
| FERT-005 | configurable mix time | fixed 180 sec | BROKEN | fixed only | no test | duration constant |
| FERT-006 | measured delivery criterion | FS400A unused to stop | PARTIAL | fixed 60 sec | no test | DELIVERY state |
| FERT-007 | pressure/flow readiness | none | MISSING | N/A | N/A | sensors/fertigation |
| FERT-008 | safety interruption | E-stop/fault path | PARTIAL | reachable | no fault test | fertigation task |
| FERT-009 | durable run/event history | no run; SD event attempt | MISSING | SD failure ignored | no test | storage/fertigation |
| FERT-010 | manual/scheduled/offline batch | manual partial; schedule wrong | PARTIAL | scheduled broken | mock only | commands/scheduler |
| PREC-001 | EC/pH feedback/adaptive dosing | none | MISSING | N/A | N/A | sources |
| RECIPE-001 | persisted/versioned/snapshotted recipes | seeded UI only | MOCK | no firmware path | no test | types/data |
| PUMP-001 | pump ID/GPIO/manual path | fixed IDs, selected commands | PARTIAL | raw/mix not public | no hardware test | HAL/command mgr |
| PUMP-002 | configurable assignment/limits/queue | fixed/duration only | PARTIAL | no config or queue policy | no test | HAL/manual mgr |
| FAN-001 | manual/scheduled/condition fan | GPIO only; schedule broken | BROKEN | no public fan command | no test | HAL/scheduler |
| VALVE-001 | valve IDs/routes | none | MISSING | generic arg unusable | no test | transfer mgr |
| SENS-001 | temp sample/validity/telemetry | DS18B20 state | PARTIAL | current sample only | no accuracy test | sensor/telemetry HAL |
| SENS-002 | flow sample/calibration/telemetry | two pulse paths | PARTIAL | current global readings | no volumetric test | sensor HAL |
| SENS-003 | lower level safety | float stops selected pumps | PARTIAL | reachable | no physical test | HAL/safety/manual |
| SENS-004 | pH/EC/humidity/light/pressure | no drivers | MISSING | UI mocks | N/A | sensor sources |
| CAL-001 | A/B procedure/validation/persist | rates/endpoints | PARTIAL | incomplete procedure/fallback | no test | calibration mgr/API |
| CAL-002 | flow version/operator procedure | factor only | PARTIAL | no workflow | no bench test | calibration/docs |
| CAL-003 | pH/EC/level/temp-humidity calibration | none | MISSING | N/A | N/A | calibration sources |
| SAFE-001 | safe boot all outputs | early list omits blower/mix | BROKEN | HAL later safe; transient unknown | no boot test | `main.c:safe_boot_actuators` |
| SAFE-002 | E-stop latch/stop/resume | NVS+HAL | PARTIAL | actuator path reachable | no physical test | actuator/storage |
| SAFE-003 | reject latching commands/schedules | HAL blocks ON only | PARTIAL | lifecycle unclear | no test | HAL/command/scheduler |
| SAFE-004 | runtime/no-flow policies | manual duration+fill check | PARTIAL | not configurable/per pump | no test | manual/fertigation |
| SAFE-005 | low and high level protection | low only | PARTIAL | high level absent | no physical test | pin/safety/HAL |
| SAFE-006 | invalid sensor/config/resource policy | narrow checks only | MISSING | N/A | N/A | safety monitor |
| SAFE-007 | durable fault events | SD append attempt | PARTIAL | unavailable without SD | no test | storage/safety |
| TEL-001 | current timestamp/complex/GH data | GH fixed | PARTIAL | wrong for multi-GH | no device test | telemetry mgr |
| TEL-002 | temp/level/flow/pump telemetry | snapshot exists | PARTIAL | no complete quality/history | mock only | telemetry mgr |
| TEL-003 | durable offline history/replay | none | MISSING | N/A | N/A | storage/network |
| CROP-001 | per-GH crop/HST/HSP | singleton | PARTIAL | GH-01 only | no test | crop cycle mgr |
| CROP-002 | plants/fruits/observations/mortality | browser model | MOCK | no API persistence | no test | store/types |
| CROP-003 | truthful harvest/yield/grade | default yield 300 | BROKEN | can fabricate | no test | harvest mgr |
| POWER-001 | source/battery/charge/events | none | MISSING | N/A | physical unknown | firmware/config |
| RECOV-001 | safe config/schedule/run recovery | selected NVS only | PARTIAL | no active-run/missed policy | no power test | storage/scheduler |
| UI-001 | product screens/navigation | present | UI ONLY | local state primary | manual unverified | `src/app/**` |
| UI-002 | blocked/deploy receipt/rollback | absent/partial errors | MISSING | no authoritative flow | no test | store/services |
| ADMIN-001 | Super Admin roles/hardware management | none | MISSING | N/A | N/A | auth/UI search |
| API-001 | protect dangerous mutations | auth inconsistent | PARTIAL | schedule/calibration unguarded | mock does not cover | HTTP handlers |
| API-002 | meaningful contract verification | string/mock test | PARTIAL | no firmware execution | mock only | verify script |

# APPENDIX B — FEATURE DECOMPOSITION MATRIX

| Feature | Sub-capability | Status | Evidence | Exact gap |
|---|---|---|---|---|
| Multi-GH | UI create/list | UI ONLY | `store.ts:addGreenhouse` | device provisioning/config |
| Multi-GH | firmware GH address | CONTRADICTORY | GH-01 handlers | 1..N config store |
| Registry | JSON boot/inventory | PARTIAL | registry/storage/API | mutation/assignment/binding |
| Scheduling | local time loop | PARTIAL | scheduler task | compiler/states/resources |
| Scheduling | ONCE/fan/fertigation | BROKEN | enum/dispatch | execution bindings |
| Fertigation | A/B timed sequence | PARTIAL | fertigation manager | precheck/recipe/records/precision |
| Safety | E-stop/locks | PARTIAL | HAL/safety | policy/boot/event durability |
| Telemetry | current snapshot | PARTIAL | telemetry mgr | GH map/history/replay |
| Research | singleton crop cycle | PARTIAL | crop manager | entity/history links |
| Power | backup path | MISSING | none | software + commissioning |

# APPENDIX C — HARDWARE READINESS MATRIX

| Component | Driver/HAL | Registry | UI registration | Wiring | Assignment/runtime | Calibration | Physical status/test | Status |
|---|---|---|---|---|---|---|---|---|
| Well pump | fixed GPIO | static | no | docs | fixed/manual | no | unverified | PARTIAL |
| Raw/mixing/distribution | fixed GPIO | static | no | docs | sequence/fixed | flow partial | unverified | PARTIAL |
| Dosing A/B | fixed GPIO | static | partial UI/API | docs | fixed only | NVS rate | unverified | PARTIAL |
| Dosing C–G/pH | no | no | UI labels only | no current path | no | no | unknown | MISSING |
| Cooling/blower fan | GPIO | static/deferred | no | partial | no product command | no | unverified | BROKEN/PARTIAL |
| ZJ-B1/FS400A | pulse HAL | static | no | docs | global readings | partial | unverified | PARTIAL |
| DS18B20/lower float | HAL | static | no | docs | sample/interlock | no | unverified | PARTIAL |
| pH/EC/humidity/light/pressure | no | no | mock UI | no current path | no | no | unknown | MISSING |
| Valves/UPS | no | no | no | planned docs only | no | N/A | unknown | MISSING |

# APPENDIX D — RESOURCE ASSIGNMENT MATRIX

| Resource | Exists | Installed | Assigned/owner/GH | Shared/transferable | Runtime binding | Status |
|---|---|---|---|---|---|---|
| Fixed actuators | firmware enum | physical unknown | transient service owner | no model | fixed GPIO | PARTIAL |
| Mixing tanks | no entity | unknown | none | none | none | MISSING |
| Fans/pumps/meters | partial HAL | unknown | none | none | no GH binding | MISSING |
| pH/EC/pressure/valves | no model | unknown | none | none | none | MISSING |

# APPENDIX E — SCHEDULE LIFECYCLE MATRIX

| Stage | PRD requires | Current code | Status |
|---|---|---|---|
| Draft | non-executable editable state | none | MISSING |
| Validation | syntax and semantic | limited syntax | PARTIAL |
| Resource/topology/dependency/conflict | resolved before activation | none; lock after dispatch | MISSING |
| Compilation | resolved executable binding | none | MISSING |
| Deployment | acknowledged activation | direct NVS save only | MISSING |
| ACTIVE | only after success | enabled bool | CONTRADICTORY |
| BLOCKED | cause/action and no execution | none | MISSING |
| Runtime | deterministic compiled schedule | direct intent dispatch | BROKEN |

# APPENDIX F — MULTI-GH READINESS MATRIX

| Capability | GH-01 | GH-02 | GH-N | Limitation | Gap |
|---|---|---|---|---|---|
| Context/identity | fixed | unavailable | unavailable | handler returns GH-01 | GH config |
| Crop cycle | singleton partial | rejected | rejected | GH check | per-GH history |
| Telemetry | fixed label | unavailable | unavailable | handler fixed | GH streams |
| Recipes/schedules | UI mock | UI mock | UI mock | no target/binding | compiler |
| Ownership/concurrency | none | none | none | no resource graph | manager |
| Single-GH fallback | hardwired | N/A | N/A | not scalable config | topology model |

# APPENDIX G — SAFETY MATRIX

| Safety requirement | UI | Firmware | Hardware | Test | Status | Gap |
|---|---|---|---|---|---|---|
| Safe boot | none | early+HAL, omissions | polarity unverified | none | BROKEN/PARTIAL | all outputs/bench |
| E-stop | mock display | NVS/actuator stop | no isolation proof | mock only | PARTIAL | policy/physical test |
| Low level | capacity UI | lower float selected pumps | switch unverified | none | PARTIAL | commissioning |
| High level | UI capacity | none | no sensor | none | MISSING | physical interlock |
| No flow/runtime | none | narrow fill/manual rules | meters unverified | none | PARTIAL | per-pump policy |
| Fault/event | UI sample | narrow SD events | SD optional | none | PARTIAL | NVS queue/replay |

# APPENDIX H — CONTRADICTION REGISTER

| ID | PRD requirement | Current implementation | Contradiction / impact | Evidence | Status |
|---|---|---|---|---|---|
| C-01 | 1..N GH | GH-01 hardwired | expansion needs source rewrite | context/crop/telemetry | CONTRADICTORY |
| C-02 | compiled ACTIVE only | enabled direct NVS entry | unsafe work executable | schedule handler/task | CONTRADICTORY |
| C-03 | full fertigation schedule | DOSING_RUN | no fill/mix/delivery | dispatch | BROKEN |
| C-04 | fan schedule | CUSTOM command | command fails | scheduler/command mgr | BROKEN |
| C-05 | calibrated precision | 1mL/s fallback | arbitrary dose | fertigation start | CONTRADICTORY |
| C-06 | safe boot all outputs | blower/mix omitted early | boot claim exceeds scope | main/HAL | CONTRADICTORY |
| C-07 | physical overfill safety | UI capacity only | not physical safety | UI/safety | CONTRADICTORY |
| C-08 | dynamic registry runtime | fixed HAL authority | JSON does not bind drivers | registry/HAL | NOT INTEGRATED |
| C-09 | truthful research history | 300 default yield | fabricated record | crop harvest | BROKEN |
| C-10 | protected physical mutations | schedule/calibration no auth | inconsistent safety boundary | handlers | PARTIAL |

# APPENDIX I — UNKNOWN / UNVERIFIED REGISTER

| Item | Why unknown | Evidence needed |
|---|---|---|
| Relay safe boot/polarity | no measured boot trace | all-output target bench capture |
| Pump flow/volume accuracy | no known-volume record | calibrated volumetric runs |
| Hydraulics/pressure/sealing | no model/measurements | pump curve + installed pressure/flow tests |
| Sensor accuracy/fault behavior | no reference/disconnect tests | calibration and fault-injection results |
| Offline execution | no backend-off acceptance run | disconnect test against target |
| Power transfer/irrigation continuity | no UPS model/test | installed schematic + loaded transfer run |
| Hardware installation inventory | no live inspection | operator inventory/bench record |
| Full REST compatibility | Node mock only | flashed endpoint/payload/error suite |

## v1 Finding Recheck

| Previous v1 finding | Recheck outcome | Revision |
|---|---|---|
| Multi-GH PARTIAL | Confirmed but too coarse | UI is multi-GH mock; firmware atomic criteria are MISSING/CONTRADICTORY. |
| Schedule compilation MISSING | Confirmed and expanded | Every required compiler substage is separately registered. |
| Fertigation PARTIAL | Corrected/decomposed | A/B sequence/fill exists; scheduling, calibration safety, recipe, delivery, record gaps are distinct. |
| Registry PARTIAL | Confirmed and expanded | persistence/inventory exist; management and runtime binding do not. |
| Safety PARTIAL | Expanded | local mechanisms exist; boot, high-level, policy, and durable-events have separate statuses. |
| Tests mock-limited | Confirmed | test scope is static strings plus three Node-mock endpoints. |

## Atomic-revision control note

The original Appendix A rows that combine related behavior are retained as an index to the v1 findings. **The canonical assessment for any grouped row is the atomic continuation below.** Each continuation row has exactly one independently testable expected behavior and supplies the required dimensions. This corrects, for example, the former combined seven-channel, schedule-recurrence, calibration, telemetry, and crop-cycle rows.

**Field legend:** SW = software implementation (`FULL`, `PARTIAL`, `MISSING`, `BROKEN`, `NOT INTEGRATED`, `NOT REACHABLE`, `UNKNOWN`). INT = integration (`END-TO-END`, `PARTIAL`, `DISCONNECTED`, `UI ONLY`, `FIRMWARE ONLY`, `MOCK ONLY`, `NONE`). Reach = production reachability. Test = only what is evidenced. HW = hardware availability (`UNKNOWN` unless physically evidenced). PV = physical verification. Evidence includes the exact source symbol; the text after `→` is the exact gap.

# APPENDIX A.1 — CANONICAL ATOMIC REQUIREMENT TRACEABILITY CONTINUATION

| ID / PRD reference | Expected behavior | Current implementation | SW | INT | Reach | Test | HW / PV | Exact evidence → exact gap |
|---|---|---|---|---|---|---|---|---|
| ARCH-CPLX-001 / §4.1, §6.1 | Complex has stable identity | NVS stores one ID | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | N/A / N/A | `storage_mgr_init` → no Complex entity metadata/configuration |
| ARCH-CPLX-002 / §5.2 | One ESP32 is local regulator of one Complex | one process/device ID | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | `main.c:app_main` → no controller-to-provisioned-Complex validation |
| ARCH-GH-001 / §4.2, §6.3 | Complex accepts one GH | UI data accepts GH | UI ONLY | MOCK ONLY | browser only | NOT TESTED | N/A / N/A | `store.ts:addGreenhouse` → no firmware GH registry |
| ARCH-GH-002 / §4.2, §6.3 | Complex accepts more than one GH | UI data accepts GHs | UI ONLY | MOCK ONLY | browser only | NOT TESTED | N/A / N/A | same → runtime only publishes GH-01 |
| ARCH-GH-003 / §6.4 | GH identity is stable/configured | fixed literal GH-01 | BROKEN | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | crop handler GH check → no config identity lookup |
| ARCH-GH-004 / §4.2 | GH has independent recipe assignment | UI arrays only | UI ONLY | MOCK ONLY | browser only | NOT TESTED | N/A / N/A | `Greenhouse.recipes` → no firmware recipe model |
| ARCH-GH-005 / §4.2 | GH has independent schedule set | UI arrays only | UI ONLY | browser only | NOT TESTED | N/A / N/A | `Greenhouse.fertigationSchedules` → schedule lacks GH field |
| ARCH-GH-006 / §4.2 | GH has independent telemetry | firmware labels GH-01 | BROKEN | FIRMWARE ONLY | GH-01 only | NOT TESTED | UNKNOWN / NOT VERIFIED | `api_telemetry_handlers.c` → no GH telemetry routing |
| ARCH-GH-007 / §4.2 | GH has independent crop cycle | singleton cycle | BROKEN | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | `crop_cycle_mgr:s_active_cycle` → no per-GH store |
| ARCH-GH-008 / §6.2 | One-GH topology is configuration, not hardcode | GH-01 hardcode | BROKEN | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | context/crop handler → no topology configuration |
| ARCH-GH-009 / §1.2 | GH-1→GH-2 needs no firmware rewrite | non-GH-01 rejected | BROKEN | FIRMWARE ONLY | no | NOT TESTED | N/A / N/A | crop handler → remove singleton constraint/model GH list |
| ARCH-RES-001 / §6.5 | Shared resource can be declared | no shared field | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry/config structs → add shared-resource schema |
| ARCH-RES-002 / §6.5 | Independent GH resources can run concurrently | no GH resources | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | scheduler/HAL → add path/resource model |

| COMP-001 / §33A.2 | Component has logical ID | parsed ID | FULL | FIRMWARE ONLY | inventory path | NOT TESTED | N/A / N/A | `hw_component_info_t.id` → no management workflow |
| COMP-002 / §33A.2 | Component has type | parsed type | FULL | FIRMWARE ONLY | inventory path | NOT TESTED | N/A / N/A | `hw_component_info_t.type` |
| COMP-003 / §33A.2 | Component has display name | parsed name | FULL | FIRMWARE ONLY | inventory path | NOT TESTED | N/A / N/A | `hw_component_info_t.name` |
| COMP-004 / §33A.3 | Admin can rename component | no mutation handler | MISSING | NONE | no | NOT TESTED | N/A / N/A | API/UI search → add authorized rename transaction |
| COMP-005 / §33A.2 | Component has physical mapping | pin/channel parsed | PARTIAL | FIRMWARE ONLY | inventory only | NOT TESTED | UNKNOWN / NOT VERIFIED | registry fields → no binding validation |
| COMP-006 / §33A.6 | Component has installation state | generic `status` string | PARTIAL | FIRMWARE ONLY | inventory only | NOT TESTED | UNKNOWN / NOT VERIFIED | registry status → no install lifecycle semantics |
| COMP-007 / §33A.2 | Component has enabled state | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry struct → add enabled state |
| COMP-008 / §33F | Component exposes capabilities | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry/config → capability resolver absent |
| COMP-009 / §33F | Component declares dependencies | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry/config → dependency schema absent |
| COMP-010 / §33A.2 | Component links calibration | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry/calibration → association absent |
| COMP-011 / §33A.2 | Component is assigned to Complex | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry/config → assignment absent |
| COMP-012 / §33A.2 | Component is assigned to GH | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry/config → assignment absent |
| COMP-013 / §33A.2 | Component has resource owner | transient actuator owner only | PARTIAL | FIRMWARE ONLY | during actuator run | NOT TESTED | N/A / N/A | `actuator_hal_acquire` → not persistent GH owner |
| COMP-014 / §33A.2 | Component availability is calculated | static status only | PARTIAL | FIRMWARE ONLY | inventory only | NOT TESTED | UNKNOWN / NOT VERIFIED | registry status → no availability computation |
| COMP-015 / §33I | Registry serializes JSON | JSON default/parser | FULL | FIRMWARE ONLY | boot/inventory | NOT TESTED | N/A / N/A | `hardware_registry_*json` |
| COMP-016 / §33I | Registry persists JSON | SPIFFS/NVS save | FULL | FIRMWARE ONLY | internal calls | NOT TESTED | N/A / N/A | `storage_mgr_save_components_json` |
| COMP-017 / §33I | ESP32 boot loads registry | load at HAL init | PARTIAL | FIRMWARE ONLY | boot path | NOT TESTED | UNKNOWN / NOT VERIFIED | `hardware_hal_init_all` → init precedes storage init; no probe/binding proof |
| COMP-018 / §33A.3 | Super Admin manages registry | no roles | MISSING | NONE | no | NOT TESTED | N/A / N/A | UI/auth search → add identity/authorization/admin API |

| INST-001 / §33A.4 | Installation guide available | Markdown guide | PARTIAL | DISCONNECTED | manual document access | NOT TESTED | UNKNOWN / NOT VERIFIED | assembly guide → not component-workflow linked |
| INST-002 / §33A.4 | Wiring guide available | Markdown maps | PARTIAL | DISCONNECTED | manual document access | NOT TESTED | UNKNOWN / NOT VERIFIED | wiring docs → not per-registration linked |
| INST-003 / §33A.5 | UI registers installed component | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | UI/API search |
| INST-004 / §33A.5 | User names newly installed component | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | UI/API search |
| INST-005 / §33A.5 | Registration is validated | no mutation path | MISSING | NONE | no | NOT TESTED | N/A / N/A | config validation only |
| INST-006 / §33A.5 | Registration deploys to ESP32 | no transaction | MISSING | NONE | no | NOT TESTED | N/A / N/A | API search |
| INST-007 / §33A.5 | Boot recognizes installed device | JSON parse only | PARTIAL | FIRMWARE ONLY | boot parse | NOT TESTED | UNKNOWN / NOT VERIFIED | `hardware_hal_init_all` → no component probe/availability transition |
| INST-008 / §33A.5 | Recognized component becomes runtime available | fixed HAL only | NOT INTEGRATED | DISCONNECTED | no dynamic path | NOT TESTED | UNKNOWN / NOT VERIFIED | registry vs fixed HAL |

| XFER-FAN-001 / §33E, §33F | GH-03 schedule detects no fan | no GH/fan assignment | MISSING | NONE | no | NOT TESTED | N/A / N/A | schedule model |
| XFER-FAN-002 / §33E | System discovers movable fan candidates | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry has no ownership query |
| XFER-FAN-003 / §33E | System discovers candidate owner | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | assignment absent |
| XFER-FAN-004 / §33E | User selects resource transfer | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | UI absent |
| XFER-FAN-005 / §33E.7 | User confirms transfer | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | workflow absent |
| XFER-FAN-006 / §33A.4 | System provides physical move instruction | docs disconnected | MISSING | NONE | no contextual path | NOT TESTED | UNKNOWN / NOT VERIFIED | docs only |
| XFER-FAN-007 / §33E | Assignment updates after transfer | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | assignment absent |
| XFER-FAN-008 / §7.2 | Old GH schedule invalidates | no schedule/resource relation | MISSING | NONE | no | NOT TESTED | N/A / N/A | scheduler |
| XFER-FAN-009 / §7.2 | New GH schedule revalidates | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | compiler absent |
| XFER-FAN-010 / §7.2 | Changed config compiles/deploys | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | compiler/deployment absent |
| XFER-FAN-011 / §33E | Old GH loses active fan access | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | GH binding absent |
| XFER-FAN-012 / §33E | New GH gains active fan access | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | GH binding absent |
| XFER-OTHER-001 / §33G | Same transfer model works for pumps/meters/sensors/valves | no generic resource model | MISSING | NONE | no | NOT TESTED | N/A / N/A | registry/resource search |

| NOVALVE-001 / §33D.3 | Detect routing valve absent | no valve/topology model | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | actuator/config |
| NOVALVE-002 / §33D.3 | GH-01 direct automatic route can be declared | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | route schema absent |
| NOVALVE-003 / §33B.3 | GH-02 manual AB preparation can be declared | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | capability model absent |
| NOVALVE-004 / §33B.3 | GH-02 scheduled distribution may be compiled if resources exist | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | target/resource scheduler absent |
| NOVALVE-005 / §33D.3 | GH-02 automatic dosing blocks when unavailable | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | BLOCKED model absent |
| NOVALVE-006 / §33E.6 | UI warns about manual routing | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | UI search |
| NOVALVE-007 / §33E.3 | Manual route declaration has exclusive ownership | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | resource model absent |

| SCHED-REC-001 / §19.1 | Daily recurrence | implemented | FULL | FIRMWARE ONLY | yes, local | MOCK TESTED only route strings | N/A / N/A | `scheduler_task:SCHED_TYPE_DAILY` → no behavior test |
| SCHED-REC-002 / §19.1 | Selected weekday recurrence | bitmask implemented | FULL | FIRMWARE ONLY | yes, local | MOCK TESTED only route strings | N/A / N/A | `days_of_week` branch → no behavior test |
| SCHED-REC-003 / §19.1 | Specific-date recurrence | enum parser only | NOT REACHABLE | DISCONNECTED | no | NOT TESTED | N/A / N/A | no ONCE dispatch branch |
| SCHED-REC-004 / §19.1 | Repeating interval recurrence | implemented | FULL | FIRMWARE ONLY | yes, local | NOT TESTED | N/A / N/A | `SCHED_TYPE_INTERVAL` branch |
| SCHED-REC-005 / §19.1 | Fallback/default schedule | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | scheduler/UI runtime |
| SCHED-REC-006 / §19.5 | Missed schedule policy | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | scheduler recovery |
| SCHED-LIFE-001 / §7.2 | Draft state exists | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | entry struct |
| SCHED-LIFE-002 / §7.2 | Target GH stored | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | entry struct |
| SCHED-LIFE-003 / §7.2 | Action stored | action enum | FULL | FIRMWARE ONLY | yes | NOT TESTED | N/A / N/A | `schedule_entry_t.action` |
| SCHED-LIFE-004 / §7.2 | Parameters validated | duration only | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | N/A / N/A | schedule handler → action-specific params absent |
| SCHED-LIFE-005 / §7.2 | Required components validated | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | handler |
| SCHED-LIFE-006 / §7.2 | Resource assignment validated | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | handler |
| SCHED-LIFE-007 / §7.2 | Ownership validated | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | handler |
| SCHED-LIFE-008 / §7.2 | Routing/topology validated | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | handler |
| SCHED-LIFE-009 / §7.2 | Safety dependencies validated | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | handler |
| SCHED-LIFE-010 / §7.2 | Conflicts validated before activation | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | actuator lock is post-dispatch only |
| SCHED-LIFE-011 / §7.2 | Compiled binding persisted | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | no compiler type |
| SCHED-LIFE-012 / §7.2 | ACTIVE state exists | enabled bool only | BROKEN | FIRMWARE ONLY | unvalidated execution | NOT TESTED | N/A / N/A | `schedule_entry_t.enabled` |
| SCHED-LIFE-013 / §7.2 | BLOCKED state/reason exists | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | UI/FW types |
| SCHED-LIFE-014 / §7.2 | INVALID state exists | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | UI/FW types |
| SCHED-LIFE-015 / §7.2 | DISABLED state exists | enabled false | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | N/A / N/A | bool → no explicit reason/state serialization |
| SCHED-LIFE-016 / §7.4 | Config version associated | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | entry struct |
| SCHED-LIFE-017 / §7.2 | Deployment acknowledgement | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | no ack state |
| SCHED-CASE-001 / §19 | GH-01 assigned fan becomes ACTIVE after compile/deploy | no GH/fan/compiler | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | fan action is CUSTOM |
| SCHED-CASE-002 / §19.4.1 | GH-03 no fan becomes BLOCKED | no assignment/BLOCKED | MISSING | NONE | no | NOT TESTED | N/A / N/A | model absent |
| SCHED-CASE-003 / §33E | GH-03 request for GH-01 fan triggers transfer flow | no ownership/transfer | MISSING | NONE | no | NOT TESTED | N/A / N/A | resource model absent |

| FERT-CH-001 / §8.6, §10.1 | Supports seven logical channels | only two enum channels | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | `ACTUATOR_DOSING_A/B` |
| FERT-CH-002 / §8.6, §10.1 | Channel represents pH Up | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | no pH channel/config |
| FERT-CH-003 / §8.6, §10.1 | Channel represents pH Down | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | no pH channel/config |
| FERT-CH-004 / §8.6, §10.1 | Nutrient channel 1 independently configures | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | fixed A/B |
| FERT-CH-005 / §8.6, §10.1 | Nutrient channel 2 independently configures | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | fixed A/B |
| FERT-CH-006 / §8.6, §10.1 | Nutrient channel 3 independently configures | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | fixed A/B |
| FERT-CH-007 / §8.6, §10.1 | Nutrient channel 4 independently configures | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | fixed A/B |
| FERT-CH-008 / §8.6, §10.1 | Nutrient channel 5 independently configures | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | fixed A/B |
| FERT-PHASE-001 / §8.4 | Precheck validates GH | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | batch args have no GH |
| FERT-PHASE-002 / §8.4 | Precheck validates recipe | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | no recipe store |
| FERT-PHASE-003 / §8.4 | Precheck validates resources | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | no resource set |
| FERT-PHASE-004 / §8.4 | Precheck validates calibration | fallback permits absence | BROKEN | FIRMWARE ONLY | yes, unsafe | NOT TESTED | UNKNOWN / NOT VERIFIED | `fertigation_mgr_start_batch` |
| FERT-FILL-001 / §8.5 | Raw target is measured | calibrated ZJ-B1 stop | PARTIAL | FIRMWARE ONLY | yes if calibrated | NOT TESTED | UNKNOWN / NOT VERIFIED | FILLING → no tolerance/test |
| FERT-FILL-002 / §8.5 | Fill timeout/failure aborts | zero-pulse at 30s | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | FILLING → timeout not configured/per pump |
| FERT-DOSE-001 / §8.6 | A dose uses calibrated rate | rate used | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | calibration mgr → arbitrary fallback |
| FERT-DOSE-002 / §8.6 | B dose uses calibrated rate | rate used | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | calibration mgr → arbitrary fallback |
| FERT-MIX-001 / §8.7 | Mixing stage exists | state exists | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | FINAL_MIXING |
| FERT-MIX-002 / §8.7 | Mixing duration configurable | hardcoded 180s | BROKEN | FIRMWARE ONLY | fixed only | NOT TESTED | N/A / N/A | duration constant |
| FERT-DEL-001 / §8.8 | Delivery stage exists | state exists | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | DELIVERY |
| FERT-DEL-002 / §8.8 | Delivery uses measured target | fixed 60s | BROKEN | FIRMWARE ONLY | yes, duration only | NOT TESTED | UNKNOWN / NOT VERIFIED | DELIVERY/F400A unused |
| FERT-DEL-003 / §8.8 | Delivery readiness uses pressure | no pressure driver | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor model |
| FERT-RUN-001 / §28 | Recipe snapshot persisted with run | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | no run record |
| FERT-RUN-002 / §28 | Run completion is recorded | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | no run record |
| FERT-RUN-003 / §8.3 | Safety interruption is recorded | SD event attempt | PARTIAL | FIRMWARE ONLY | only if SD mounted | NOT TESTED | UNKNOWN / NOT VERIFIED | append event → no fallback |
| FERT-SCHED-001 / §44.7 | Scheduled fertigation starts batch | maps DOSING_RUN | BROKEN | FIRMWARE ONLY | wrong path | NOT TESTED | N/A / N/A | `dispatch_schedule` |
| FERT-MANUAL-001 / §44.6 | Manual fertigation receives GH/recipe | scalar batch command only | PARTIAL | FIRMWARE ONLY | no GH/recipe | NOT TESTED | UNKNOWN / NOT VERIFIED | command mgr |

| SENSOR-PH-001 / §16, §41 | pH driver/HAL/config/registry exists | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor sources |
| SENSOR-PH-002 / §16 | pH install/wiring/calibration/control/telemetry exists | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | UI/docs/runtime search |
| SENSOR-EC-001 / §16, §41 | EC driver/HAL/config/registry exists | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor sources |
| SENSOR-EC-002 / §16 | EC install/wiring/calibration/control/telemetry exists | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | UI/docs/runtime search |
| SENSOR-TEMP-001 / §16 | Temperature driver/HAL samples | DS18B20 path | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | `sensor_hal` |
| SENSOR-TEMP-002 / §16 | Temperature validity is exposed | state exists | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | `temp_state`/telemetry |
| SENSOR-TEMP-003 / §16 | Temperature controls climate | no climate rule | MISSING | NONE | no | NOT TESTED | N/A / N/A | fan/safety only high temp |
| SENSOR-HUM-001 / §16 | Humidity driver/HAL | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | telemetry explicitly null |
| SENSOR-LIGHT-001 / §16 | Light driver/HAL | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | telemetry explicitly null |
| SENSOR-LEVEL-001 / §16 | Lower level samples | GPIO float | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor HAL |
| SENSOR-LEVEL-002 / §22.4 | High-level fill protection | no sensor | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | pin config/safety |
| SENSOR-FLOW-001 / §16 | Raw flow samples | ZJ-B1 ISR | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor HAL |
| SENSOR-FLOW-002 / §16 | Delivery flow samples | FS400A ISR | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor HAL |
| SENSOR-PRESS-001 / §16 | Pressure driver/HAL | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor sources |

| CAL-DOSE-001 / §10.2 | A calibration rate persists | NVS rate | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | calibration mgr |
| CAL-DOSE-002 / §10.2 | B calibration rate persists | NVS rate | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | calibration mgr |
| CAL-DOSE-003 / §10.3 | Calibration has timestamp/version/operator | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | calibration data model |
| CAL-FLOW-001 / §29 | Raw flow calibration used at runtime | calibrated flag/mL conversion | PARTIAL | FIRMWARE ONLY | yes if configured | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor/calibration mgr |
| CAL-FLOW-002 / §29 | Delivery-flow calibration used at runtime control | not used for delivery stop | NOT INTEGRATED | DISCONNECTED | no control path | NOT TESTED | UNKNOWN / NOT VERIFIED | F400A/DELIVERY |
| CAL-PH-001 / §29 | pH calibration | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | sources |
| CAL-EC-001 / §29 | EC calibration | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | sources |
| CAL-LEVEL-001 / §29 | Level calibration | binary float only | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | sensor model |

| PUMP-WELL-001 / §14 | Well pump fixed HAL/manual command | exists | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | HAL/command mgr → no config/GH assignment |
| PUMP-WELL-002 / §22 | Well pump lower-float interlock | exists | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | `actuator_hal_set` |
| PUMP-RAW-001 / §12 | Raw pump fixed HAL/fill use | exists | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | HAL/fertigation |
| PUMP-MIX-001 / §8 | Mixing pump fixed HAL/use | exists | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | HAL/fertigation |
| PUMP-DIST-001 / §8 | Distribution fixed HAL/use | exists | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | HAL/fertigation |
| PUMP-DIST-002 / §8 | Distribution delivery has flow target | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | delivery state |
| PUMP-DOSE-001 / §10 | future pump abstraction | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | fixed enum |

| FAN-001 / §15.1 | Manual fan product command | no command type/handler | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | command mgr |
| FAN-002 / §15.2 | Time fan scheduling | action maps CUSTOM | BROKEN | FIRMWARE ONLY | rejects | NOT TESTED | UNKNOWN / NOT VERIFIED | scheduler/command mgr |
| FAN-003 / §15.2 | Interval fan scheduling | no fan binding | MISSING | NONE | no | NOT TESTED | N/A / N/A | scheduler |
| FAN-004 / §15.2 | Date fan scheduling | ONCE unreachable | NOT REACHABLE | DISCONNECTED | no | NOT TESTED | N/A / N/A | scheduler |
| FAN-005 / §15.3 | Temperature threshold | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | fan/sensor paths |
| FAN-006 / §15.3 | Hysteresis | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | fan paths |
| FAN-007 / §15.4 | Humidity-removal workflow | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | humidity absent |

| SAFE-BOOT-001 / §22.1 | Every safety actuator safe before services | early list omits blower/mix | BROKEN | FIRMWARE ONLY | partial boot path | NOT TESTED | UNKNOWN / NOT VERIFIED | `main.c:safe_boot_actuators` |
| SAFE-ESTOP-001 / §22.2 | E-stop latches | NVS bool | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | `storage_mgr_set_estop` |
| SAFE-ESTOP-002 / §22.2 | E-stop shuts actuators | HAL loop | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | `actuator_hal_emergency_stop` |
| SAFE-ESTOP-003 / §22.2 | E-stop requires explicit resume | resume API/path | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | `actuator_hal_resume` → command authorization policy incomplete |
| SAFE-FLOW-001 / §22.3 | Raw fill zero flow stops sequence | 30-sec check | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | FILLING → no configurable policy |
| SAFE-FLOW-002 / §22.3 | Every applicable pump has flow policy | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | safety manager |
| SAFE-TANK-001 / §22.4 | Low-level downstream protection | selected pump checks | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | HAL/manual/safety → scope inconsistent |
| SAFE-TANK-002 / §22.4 | High-level fill protection | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | upper sensor removed |
| SAFE-RUNTIME-001 / §22.5 | Every dangerous actuator max runtime | manual/transfer only | PARTIAL | FIRMWARE ONLY | selected paths | NOT TESTED | UNKNOWN / NOT VERIFIED | manual/transfer mgr |
| SAFE-SENSOR-001 / §22.6 | Invalid safety sensor has explicit fallback | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | sensor/safety |
| SAFE-EVENT-001 / §23 | Safety fault persists locally | SD append only | PARTIAL | FIRMWARE ONLY | only with SD | NOT TESTED | UNKNOWN / NOT VERIFIED | storage manager |

| TEL-CUR-001 / §17 | Timestamped current telemetry | UTC string | FULL | FIRMWARE ONLY | yes | NOT TESTED | N/A / N/A | telemetry mgr |
| TEL-CUR-002 / §17 | Complex association | complex ID | FULL | FIRMWARE ONLY | yes | NOT TESTED | N/A / N/A | telemetry JSON |
| TEL-CUR-003 / §17 | GH association | fixed GH-01 | BROKEN | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | telemetry handler |
| TEL-CUR-004 / §17 | Temperature telemetry | valid/null field | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | telemetry mgr |
| TEL-CUR-005 / §17 | Flow telemetry | current values | FULL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | telemetry mgr |
| TEL-CUR-006 / §17 | Level telemetry | binary-derived percent | PARTIAL | FIRMWARE ONLY | yes | NOT TESTED | UNKNOWN / NOT VERIFIED | telemetry mgr → not measured level |
| TEL-CUR-007 / §17 | Pressure/pH/EC/humidity/light telemetry | absent | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | telemetry mgr |
| TEL-HIST-001 / §17.3 | Durable telemetry history | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | storage |
| TEL-HIST-002 / §20.2 | Offline telemetry buffering | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | storage/network |
| TEL-HIST-003 / §20.2 | Replay/synchronization | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | network/API |

| CROP-001 / §25 | Start crop cycle | singleton start | PARTIAL | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | crop mgr |
| CROP-002 / §25 | Planting date persists | singleton field | PARTIAL | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | crop mgr |
| CROP-003 / §25 | Pollination date persists | singleton field | PARTIAL | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | crop mgr |
| CROP-004 / §25 | HST calculated | implemented | PARTIAL | FIRMWARE ONLY | singleton only | NOT TESTED | N/A / N/A | `recompute_hst_hsp` |
| CROP-005 / §25 | HSP calculated | implemented | PARTIAL | FIRMWARE ONLY | singleton only | NOT TESTED | N/A / N/A | `recompute_hst_hsp` |
| CROP-006 / §26 | Plant identity | UI observation string only | MOCK ONLY | MOCK ONLY | browser | NOT TESTED | N/A / N/A | `Observation.plantId` |
| CROP-007 / §26 | Fruit identity | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | types/runtime |
| CROP-008 / §26 | Mortality record | UI aggregate only | MOCK ONLY | MOCK ONLY | browser | NOT TESTED | N/A / N/A | PlantStats |
| CROP-009 / §26 | Observation history | localStorage only | MOCK ONLY | MOCK ONLY | browser | NOT TESTED | N/A / N/A | store observations |
| CROP-010 / §26 | Fruit progress/weight/average | mock aggregates only | MOCK ONLY | MOCK ONLY | browser | NOT TESTED | N/A / N/A | UI types/data |
| CROP-011 / §25 | Harvest date persists | singleton record | PARTIAL | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | harvest mgr |
| CROP-012 / §25 | Yield truthful when omitted | default 300.0 | BROKEN | FIRMWARE ONLY | yes | NOT TESTED | N/A / N/A | harvest mgr |
| CROP-013 / §25 | Grade persists | singleton field | PARTIAL | FIRMWARE ONLY | GH-01 only | NOT TESTED | N/A / N/A | harvest mgr |
| CROP-014 / §38 | Crop links telemetry | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | data model |
| CROP-015 / §38 | Crop links fertigation/recipe | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | data model |
| CROP-016 / §38 | Historical research retrieval | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | API/storage |

| POWER-001 / §21 | Detect power failure | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | firmware/config |
| POWER-002 / §21 | Automatic backup source selection | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | firmware/hardware model |
| POWER-003 / §21 | Controller continuity across transfer | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | no power path |
| POWER-004 / §21 | Irrigation load continuity policy | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | no load policy |
| POWER-005 / §21 | Battery measurement | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | no sensor |
| POWER-006 / §21 | Battery charging/cutoff | none | MISSING | NONE | no | NOT TESTED | UNKNOWN / NOT VERIFIED | no controller |
| POWER-007 / §21 | Power events persisted | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | event model |
| POWER-008 / §21 | Recovery/missed schedule policy | none | MISSING | NONE | no | NOT TESTED | N/A / N/A | scheduler |

## Atomic parent summaries derived from A.1

- **Architecture / multi-GH: PARTIAL overall.** Complex ID and UI GH objects exist; all configuration-driven multi-GH, shared-resource, and source-rewrite acceptance criteria are missing or broken.
- **Registry / commissioning: PARTIAL overall.** JSON persistence/load/inventory fields exist; mutation, assignment, dependencies, capability computation, runtime binding, and complete installation lifecycle are missing.
- **Scheduling: BROKEN overall.** Daily/weekday/interval clock logic and action storage exist, but compiler lifecycle, ACTIVE/BLOCKED enforcement, target/resource validation, and fan/fertigation bindings do not.
- **Fertigation: PARTIAL overall.** Fixed A/B phases and partial measured fill exist; the required GH/recipe/channel/precision/record/scheduled behavior is missing or broken.
- **Sensors and calibration: PARTIAL overall.** Current temperature/flow/float code exists; required future sensor abstractions and calibration workflows are absent.
- **Safety: PARTIAL overall.** Local mechanisms exist, but output coverage, high-level protection, comprehensive policies, persistence, and verification remain incomplete.
- **Telemetry/research/power: PARTIAL, MISSING, and MISSING respectively.** Current telemetry and singleton crop calculations exist; durable relationships/history and power-failure product behavior do not.
