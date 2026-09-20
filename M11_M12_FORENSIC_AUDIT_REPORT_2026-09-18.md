# M11–M12 FORENSIC AUDIT REPORT — 2026-09-18

Repository audited: `/mnt/data/work_m12`

Audit mode: forensic only; implementation source was not modified during this gate.

## 1. M11 Summary

**M11 = PARTIAL**

The repository contains a real backend sensor/calibration model and a generic ESP32 sensor descriptor abstraction, plus versioned calibration persistence. However, the actual firmware sensor runtime remains partly hardcoded to temperature, two flow meters, and a float level switch; generic humidity/light/pressure/pH/EC runtime acquisition is not implemented. Calibration references are stored, but runtime resolves the latest calibration by component/type and does not verify the requested `calibrationId`/version. The ESP32 generic calibration-record endpoint currently only saves `DOSING_RATE`.

The reported 18/18 M11–M12 tests are all Python tests executing backend production functions. They do not execute firmware code, API handlers, or the ESP32 runtime path.

## 2. M11 Item-by-Item Matrix

| Item | Requirement | Production implementation | Exact file/symbol | Production test/evidence | Status | Gap |
|---|---|---|---|---|---|---|
| M11.1 | Generic sensor identity | Sensor ID is configuration-derived from component ID | `esp32/main/hal/sensor_hal.c` `generic_parse_descriptor()`; `backend/sensor_calibration.py` `validate_sensor_definition()` | `scripts/test_m11_m12_engine.py::test_sensor_schema_all_required_fields` | PASS | No firmware/API contract test |
| M11.2 | Sensor type | Generic enum/parser exists | `sensor_hal.c` `generic_sensor_type()` | Python schema test only | PARTIAL | Runtime acquisition only implements a subset |
| M11.3 | Source/channel | Descriptor derives source/address/port and channel | `sensor_hal.c` `generic_parse_descriptor()`; `SensorDefinition` | Python schema validation | PARTIAL | Production acquisition remains fixed to physical inputs |
| M11.4 | Unit | Unit validation and per-type defaults exist | `sensor_calibration.py::validate_sensor_definition`; `sensor_hal.c::generic_parse_descriptor` | schema test | PASS | No cross-layer contract test |
| M11.5 | Sampling interval | Stored/validated in backend and descriptor | `sensor_calibration.py::validate_sensor_definition`; `sensor_hal.c` | schema test | PASS | No runtime scheduling test for generic sensors |
| M11.6 | Calibration reference | `calibrationReference` exists in model/descriptor | `sensor_calibration.py`; `sensor_hal.c` | Python sample test | PARTIAL | Exact referenced record is not enforced |
| M11.7 | Validity range | min/max validated and checked | `sensor_calibration.py::normalize_sensor_sample`; `sensor_hal.c::sensor_hal_get_component_sample` | quality/range Python test | PASS | No firmware negative test |
| M11.8 | Fault state | Sensor quality/error state can represent failures | `sensor_hal.h` `sensor_state_t`; `sensor_hal.c` | Python quality test; source review | PARTIAL | No distinct persistent fault model and incomplete runtime generation |
| M11.9 | Quality state | Enum includes VALID/INVALID/STALE/TIMEOUT/DISCONNECTED/OUT_OF_RANGE/UNAVAILABLE | `sensor_hal.h`; `sensor_calibration.py` | Python quality test | PARTIAL | Not all states are generated/used by all sensor paths |
| M11.10 | Timestamp | Sample timestamps and stored last-sample timestamp exist | `sensor_calibration.py`; `sensor_hal.c` | Python sample test; source review | PASS | Firmware/API parity not tested |
| M11.11 | Temperature support | DS18B20 runtime exists | `sensor_hal.c` temperature polling | Source evidence only | PARTIAL | No dedicated production firmware test; disabled-sensor mode is degraded |
| M11.12 | Humidity abstraction | Generic type and descriptor exist | `sensor_hal.c::generic_sensor_type/generic_parse_descriptor` | No runtime test | PARTIAL | No actual humidity acquisition path |
| M11.13 | Light abstraction | Generic type and descriptor exist | `sensor_hal.c` | No runtime test | PARTIAL | No actual light acquisition path |
| M11.14 | Level abstraction | Generic type + float-switch runtime exists | `sensor_hal.c` | Source evidence | PARTIAL | Current runtime is binary float-switch; generic calibrated level sensor is not acquired |
| M11.15 | Flow abstraction | Generic flow descriptor plus ZJ-B1/FS400A runtime exists | `sensor_hal.c` | M11/M12 Python simulation does not execute firmware | PARTIAL | Physical inputs are hardcoded; not a truly generic configured flow-driver runtime |
| M11.16 | Pressure abstraction | Generic type exists | `sensor_hal.c` | No runtime test | PARTIAL | No actual pressure acquisition path |
| M11.17 | pH abstraction | Generic type exists; backend linear calibration exists | `sensor_hal.c`; `sensor_calibration.py` | Python linear calibration test | PARTIAL | No production sensor acquisition / firmware application path |
| M11.18 | EC abstraction | Generic type exists; backend linear calibration exists | `sensor_hal.c`; `sensor_calibration.py` | Python linear calibration test | PARTIAL | No production sensor acquisition / firmware application path |
| M11.19 | Dosing calibration | Versioned dosing-rate record + ESP32 dosing-rate persistence | `sensor_calibration.py::build_dosing_calibration`; `calibration_mgr.c::calibration_mgr_set_dosing_rate` | Python version/history tests; source review | PASS | No full firmware endpoint lifecycle test |
| M11.20 | Flow calibration | Backend linear flow calibration; ESP32 pulse-per-liter setters | `sensor_calibration.py::build_linear_calibration`; `calibration_mgr.c::calibration_mgr_set_flow_*_pulses_per_l` | Python linear calibration test | PARTIAL | ESP32 pulse calibration is separate unversioned scalar state |
| M11.21 | Level calibration | Backend linear model | `sensor_calibration.py::build_linear_calibration` | Python linear calibration test | PARTIAL | No firmware level calibration application |
| M11.22 | pH calibration | Backend linear model | `sensor_calibration.py::build_linear_calibration` | Python linear calibration test | PARTIAL | No firmware pH sensor/application path |
| M11.23 | EC calibration | Backend linear model | `sensor_calibration.py::build_linear_calibration` | Python linear calibration test | PARTIAL | No firmware EC sensor/application path |
| M11.24 | Calibration version | Version stored and monotonic per component/type | `CalibrationRepository::save/next_version`; `calibration_mgr.c` | version conflict test | PASS | Device generic endpoint does not enforce caller/reference relationship |
| M11.25 | Timestamp | created/valid timestamps persisted | `CalibrationRecord`; `calibration_mgr.c` | source + persistence review | PASS | No API parity test |
| M11.26 | Operator/technician | Operator persisted | `CalibrationRecord`; firmware record | Source + Python tests | PASS | ESP32 generic endpoint has default operator and limited validation |
| M11.27 | Validity state | lifecycle enum and usable gate exist | `CalibrationRecord::usable`; firmware `state_usable()` | expired/suspect test | PARTIAL | Device API forces CALIBRATED for generic record path |
| M11.28 | Expired/suspect state | States exist and are unusable | backend + firmware state enum | Python expired/suspect test | PARTIAL | Generic on-device endpoint cannot faithfully store/use all lifecycle states |
| M11.29 | Historical calibration reference | SQLite history preserves all records | `CalibrationRepository::history()` | history round-trip test | PASS | No device historical query contract |
| M11.30 | Runtime uses explicit calibration record | Runtime obtains a calibration record by component/type | `fertigation_engine.py::_calibration`; `sensor_hal.c::calibration_mgr_get_record` | Existing tests cover latest record only | PARTIAL | Requested `calibrationId`/version is ignored and exact-record integrity is not enforced |

### M11 Critical evidence

A direct negative audit proves the calibration-reference gap:

```text
Requested calibrationId = CAL-FAKE, calibrationVersion = 999
Stored usable calibration = CAL-REAL v1
precheck result = VALID
runtime resolved calibration = CAL-REAL v1
```

A sensor definition containing an unknown `calibrationReference` is also accepted by the backend validator.

The ESP32 endpoint `/api/v1/calibration/record` exists, but its production implementation only accepts a `rateMlPerSec` path and calls `calibration_mgr_set_dosing_rate()`. There is no firmware endpoint path that persists FLOW, LEVEL, PH, or EC calibration records. `api_calibration_start_handler()` also explicitly permits only `VOLUMETRIC` dosing calibration execution.

## 3. M12 Summary

**M12 = PARTIAL**

The repository has a genuine configuration-driven backend preparation model and an ESP32 state machine with the requested major phases. It supports up to seven logical dosing channels and records many required run fields. However, the production runtime still resolves hardware heuristically rather than from a fully compiled immutable execution plan, required resource availability is incompletely enforced, sensor acquisition is partly hardcoded, calibration references are not exact-ID bound, delivery `FLOW` mode does not use the flow target as a completion criterion, pressure readiness does not compare against the configured pressure target, actual mixed volume is not explicitly represented, and a legacy A/B-only entry point remains exposed. The backend `simulate_run()` also fabricates measured values for simulation, so its PASS results are not physical or firmware evidence.

## 4. M12.1–M12.46 Item-by-Item Matrix

| Item | Requirement | Production implementation | Exact file/symbol | Production test/evidence | Status | Gap |
|---|---|---|---|---|---|---|
| M12.1 | Target GH | Backend validates GH; firmware parses GH and resolves assigned components | `fertigation_engine.py::precheck_fertigation`; `fertigation_mgr.c::parse_payload/precheck` | Python target GH test | PARTIAL | Firmware does not independently validate GH object identity; relies on component discovery |
| M12.2 | Recipe validity | Backend checks recipe ID exists | `fertigation_engine.py::_recipe/precheck_fertigation` | missing recipe test | PARTIAL | No semantic recipe validation/version integrity at firmware precheck |
| M12.3 | Required resources | Backend gathers selected component resources; firmware acquires actuators | `fertigation_engine.py`; `fertigation_mgr.c::precheck/task` | resource conflict Python test | PARTIAL | `available` resource state is not fully enforced; no canonical Resource Manager call |
| M12.4 | Required sensors | Backend requires flow/level/delivery sensors by mode; firmware checks some samples | `fertigation_engine.py::precheck_fertigation`; `fertigation_mgr.c::precheck/task` | delivery-sensor tests | PARTIAL | Generic sensor runtime is incomplete and not all quality states are handled |
| M12.5 | Calibration validity | Backend latest dosing calibration must be usable; firmware requires flow calibration flags and dosing record | `sensor_calibration.py`; `fertigation_mgr.c::precheck/parse_payload` | expiry/missing-calibration Python tests | PARTIAL | Exact calibration ID/version requested by run is not verified; flow calibration is separate scalar state |
| M12.6 | Safety conditions | Local safety monitor + E-stop + safety acknowledgement | `fertigation_engine.py`; `fertigation_mgr.c::precheck/task` | safety acknowledgement test; M10 regression | PASS | Physical safety still unverified |
| M12.7 | Source/tank availability | Presence/operational checks and level sensor check | backend `_find`; firmware `op_component` + level sample | source/tank-related tests | PARTIAL | Source selection is heuristic; current level is not a canonical resource availability model |
| M12.8 | Conflict check | Exclusive resource conflict + actuator acquisition | `fertigation_engine.py::_resource_conflicts`; `actuator_hal_acquire_component` | Python resource conflict test; M9/M10 regression | PASS | Backend and firmware arbitration are separate implementations |
| M12.9 | Select target GH mixing tank | Finds first operational mixing tank assigned to GH | `_find`; `find_component` | source review | PARTIAL | Not resolved from the compiled topology/path identity |
| M12.10 | Select water source | Finds first matching well/raw pump | `_find`; `find_component` | source review | PARTIAL | Does not select exact topology source/resource path |
| M12.11 | Measure incoming volume | ESP32 counts raw flow-meter pulses and converts via calibration | `sensor_hal.c`; `fertigation_mgr.c` | source review; physical not available | PARTIAL | Hardcoded ZJ-B1 path; backend simulation fabricates actual water when no value supplied |
| M12.12 | Stop at target volume | Fill phase compares accumulated measured raw mL to target+tolerance | `fertigation_mgr.c::task` FILLING | source review | PASS | Physical flow evidence blocked |
| M12.13 | Tolerance policy | `tolerance_ml` affects fill/delivery stopping | `fertigation_mgr.c`; backend request parsing | simulation tests | PASS | Negative/semantic tolerance policy is not deeply validated |
| M12.14 | Timeout/failure policy | 180s fill timeout and 180s non-duration delivery timeout | `fertigation_mgr.c::task` | source review | PARTIAL | Timeout is hardcoded, not a configuration-driven policy |
| M12.15 | Resolve logical dosing channels | `componentId` channel lookup | backend + firmware `parse_payload` | seven-channel test | PASS | Legacy A/B fallback still exists elsewhere |
| M12.16 | Up to seven logical channels | `FERT_MAX_DOSING_CHANNELS=7` and backend limit | `fertigation_mgr.h`; backend constant | seven-channel negative test | PASS | No firmware runtime acceptance test |
| M12.17 | Requested quantity | Positive `requestedMl` stored per channel | backend/firmware parse | seven-channel/runtime tests | PASS | Input is re-derived only on firmware side; compiled request parity missing |
| M12.18 | Calibration lookup | Dosing calibration retrieved by component/type | `fertigation_engine.py::_calibration`; `fertigation_mgr.c::parse_payload` | calibration presence tests | PARTIAL | Requested calibration ID/version is ignored |
| M12.19 | Runtime calculation | `requested / rate` then ms conversion | backend/firmware parse | dosing runtime tests | PASS | No cross-layer parity test |
| M12.20 | Min/max runtime enforcement | Backend enforces min/max; firmware enforces max only | `fertigation_engine.py`; `fertigation_mgr.c::precheck` | backend runtime policy tests | PARTIAL | Minimum runtime is not enforced on device |
| M12.21 | Actual commanded operation record | Firmware stores observed runtime and channel calibration refs | `fertigation_mgr.c::persist_run` | no firmware record test | PARTIAL | No durable command-level operation record linkage/ACK per channel |
| M12.22 | Configurable mixing duration | Batch field drives FINAL_MIXING timing | `fertigation_mgr.c`; backend prepare | Python phase test | PASS | Firmware max/validation policy is incomplete |
| M12.23 | Mixing phase timestamps | `s_phase_ts` persists phase timestamps | `fertigation_mgr.c::transition/persist_run` | Python simulation phase test; source review | PASS | Stored values are monotonic-time values without explicit clock provenance |
| M12.24 | Target delivery mode | VOLUME/FLOW/PRESSURE_FLOW/DURATION | backend constant; firmware parser/task | mode tests | PASS | Cross-layer contract test absent |
| M12.25 | Measured delivered volume | FS400A accumulated mL is persisted for non-duration delivery | `sensor_hal.c`; `fertigation_mgr.c::persist_run` | source review; physical blocked | PARTIAL | Depends on hardcoded delivery flow sensor and physical verification |
| M12.26 | Flow-derived target | Flow target is checked only as a readiness floor | `fertigation_mgr.c::task` DELIVERY | flow-mode test only checks backend validation | PARTIAL | Flow target is not itself a completion criterion/derived quantity |
| M12.27 | Pressure/flow readiness | Pressure and flow are required and must be positive | `fertigation_mgr.c::task` DELIVERY | backend + source review | PARTIAL | Configured target pressure is not compared; only `>0` is checked |
| M12.28 | Duration fallback only explicitly configured | DURATION requires `allowDurationFallback=true` | backend + firmware precheck | explicit fallback test | PASS | Fallback audit is backend-heavy |
| M12.29 | Distinguish mixed from actual delivered volume | Run stores raw water actual + delivered actual | `fertigation_mgr.c::persist_run`; backend run snapshot | simulation test | PARTIAL | No explicit `actualMixedVolumeMl` / measurement source for mixed solution; raw-water actual is not mixed volume |
| M12.30 | Run ID | Generated/accepted and persisted | backend `prepare_run`; firmware `parse_payload/persist_run` | durable run test | PASS | Firmware restart/duplicate persistence not tested |
| M12.31 | Complex ID | Stored in run | backend/firmware | source review | PASS | No dedicated firmware acceptance test |
| M12.32 | GH ID | Stored in run | backend/firmware | target GH test | PASS | Firmware identity verification relies on component assignment |
| M12.33 | Trigger type | Stored with default MANUAL | backend/firmware | source review | PASS | No full trigger-contract test |
| M12.34 | Schedule ID | Parsed and stored when present | backend/firmware | source review | PASS | Not exercised in M11/M12 suite |
| M12.35 | Recipe ID/version | Stored plus recipe snapshot | backend/firmware | immutable recipe test | PASS | Firmware does not validate recipe revision semantics |
| M12.36 | Configuration version | Stored and checked against current device version | backend/firmware | snapshot/version source review | PASS | Full configuration content snapshot is not stored |
| M12.37 | Target water volume | Canonical mL storage/conversion | backend/firmware | request/prepare tests | PASS | No firmware unit test |
| M12.38 | Target dosing quantities | Per-channel requested mL | backend/firmware | seven-channel test | PASS | No firmware record acceptance |
| M12.39 | Actual water volume | Firmware derives from raw flow counter; simulation can inject/fabricate | `fertigation_mgr.c::persist_run`; `simulate_run` | Python simulation test | PARTIAL | Backend test value is injected; physical measurement proof blocked |
| M12.40 | Actual dosing runtimes | Observed per-channel runtime | `fertigation_mgr.c::persist_run` | Python simulation + source review | PASS | Firmware persistence not tested |
| M12.41 | Calibration references | Calibration ID/version stored per channel | `fertigation_mgr.c::persist_run`; backend snapshot | Python snapshot test | PARTIAL | Exact referenced record is not validated against requested ID/version |
| M12.42 | Start/end timestamps | Start/end persist | backend + firmware | Python run record test | PASS | Firmware clock provenance not fully specified |
| M12.43 | Phase timestamps | Phase timestamps persist | `fertigation_mgr.c::transition/persist_run` | simulation phase test | PARTIAL | Monotonic times are stored under generic timestamp fields |
| M12.44 | Final status | COMPLETE/INTERRUPTED/FAULTED/ABORTED stored | firmware/backend | durable run test | PASS | No firmware replay/reboot test |
| M12.45 | Fault/error information | Fault code string and terminal state | `persist_run`; backend run JSON | simulation fault record test | PASS | Firmware fault taxonomy not comprehensive |
| M12.46 | Operator/source | Stored in snapshot/run | backend/firmware | source review | PASS | No API parity test |

## 5. Critical Architecture Findings

### A. Backend and ESP32 do not execute the same compiled plan

The backend `prepare_run()` resolves resources and calibration, but the frontend then sends a `FERTIGATION_START` command containing the original request. Firmware `fertigation_mgr.c::parse_payload()` independently re-discovers mixing tank, raw source, flow sensor, level sensor, delivery pump, and calibration records from the active registry.

This means the validated backend plan is not the exact execution plan used by the device. Two layers can select different concrete components or different calibration versions.

### B. Calibration reference integrity is incomplete

The run request may contain a `calibrationId`/version, but both backend and firmware ignore it when resolving the dosing calibration. They choose the latest usable record by component/type.

Therefore the invariant:

```text
run → calibrationId → exact calibration record → version → calculation
```

is not yet proven.

### C. Generic sensor model is ahead of actual sensor runtime

The enum/descriptor layer advertises temperature, humidity, light, level, flow, pressure, pH, EC, and dosing-output types, but `sensor_hal_get_component_sample()` only has concrete runtime handling for temperature, flow, and level. Other types return `SENSOR_STATE_UNAVAILABLE`.

### D. OpenAPI is incomplete for M11/M12

`UI_ESP32_OPENAPI.yaml` parses successfully and contains 22 paths, but contains no paths for:

```text
/api/v1/calibration
/api/v1/calibration/record
/api/v1/fertigation
/api/v1/schedules/compiled
```

Those production handlers/clients exist in source, but the canonical OpenAPI document does not describe them. This is direct contract drift.

### E. Backend calibration storage is not scoped by Complex

`CalibrationRepository` stores calibration records keyed by calibration/component/type/version only. The server inserts `complexId` into the HTTP response context but does not persist it in the calibration record/table and does not filter history by Complex.

Likewise `GET /api/complexes/{complexId}/calibrations` returns the global calibration repository history rather than only records belonging to that Complex.

### F. Frontend calibration workflow is still seed/local-store based

`calibrationService.devices()` and `history()` read from the UI store. The page is therefore not a fully authoritative backend/ESP32 calibration inventory client. Some save actions can call the backend/device when enabled, but device selection/history presentation remains local-store driven.

### G. Fertigation simulation is not a measurement proof

`simulate_run()` defaults:

```text
actualWaterMl = targetWaterMl
actualDeliveredMl = deliveryTargetMl
```

and marks non-duration delivery as `deliveredVolumeVerified=true` unless the caller supplies different values. That is legitimate as simulation machinery, but it cannot be used as evidence of measured delivery.

### H. Legacy A/B runtime entry point remains

`fertigation_mgr_start_batch()` is still an operational API that constructs an A/B-oriented request with `dosingA` and `dosingB`. Even if current command validation prefers the configuration-driven JSON path, the production code still contains a second physical execution entry point with exactly-two chemistry assumptions.

### I. Delivery semantics are incomplete

For `FLOW` mode, the firmware checks `target_flow_lpm` only as a readiness floor but still completes based on accumulated delivered volume. For `PRESSURE_FLOW`, the pressure sample must only be positive; the configured target pressure is not enforced.

### J. Persistence record does not explicitly store mixed solution volume

The device record stores raw-water actual volume and delivered actual volume. It does not contain an explicit actual mixed-volume field, so the PRD distinction is only partially represented.

## 6. Calibration Findings

1. Dosing-rate calibration is the strongest implemented calibration path.
2. FLOW/LEVEL/pH/EC calibration models exist in backend software.
3. Firmware generic record endpoint is **Dosing-only**.
4. Firmware flow calibration also exists as separate pulse-per-liter scalar storage, not as the same versioned calibration-record model.
5. Exact `calibrationId` and version binding is missing.
6. Unknown calibration references are accepted in sensor definition validation.
7. There is no direct firmware pH/EC runtime application path.
8. Historical calibration is retained by the backend SQLite repository.

## 7. Fertigation State Machine Findings

The firmware visibly implements the primary states:

```text
IDLE
PRECHECK
FILLING
DOSING
FINAL_MIXING
DELIVERY
COMPLETE
```

and terminal fault/interruption states. The transition skeleton is real and controls actuators.

However, the audit found that state validation is not yet fully configuration-driven: component discovery occurs inside the state engine, some timeout policy is hardcoded, and resource handling is performed through actuator acquisition rather than a single canonical fertigation/resource deployment plan.

## 8. Delivery Measurement Findings

The actual device code does derive raw and delivered volume from flow-meter pulse counters, which is stronger than timer-only control. However:

- the sensor paths are hardcoded to ZJ-B1 and FS400A;
- physical measurement evidence is unavailable;
- the backend simulation can fabricate both actual values;
- `FLOW` mode does not use flow as the completion metric;
- `PRESSURE_FLOW` does not enforce configured target pressure.

Therefore delivery measurement is **software-partial / physical-blocked**, not fully PASS.

## 9. Resource Arbitration Findings

Resource conflict tests pass for exclusive/shared behavior in the backend, and the actuator HAL performs runtime acquisition. However the fertigation engine does not call one canonical persistent Resource Manager API for the entire execution lifecycle. Backend conflict detection and firmware actuator ownership remain two independent arbitration paths.

## 10. Multi-GH Findings

The backend and firmware can resolve a GH by identity and search assigned components, and the code contains no single global fertigation state per GH. But the production fertigation engine still contains fixed semantic discovery rules and the legacy A/B API. Multi-GH independence for the full physical execution path has not been directly proven by firmware tests.

## 11. Test Integrity Findings

The M11/M12 suite has 18 tests and all pass:

```text
18 passed in 0.14s
```

But every test imports and executes only:

```text
backend.sensor_calibration
backend.fertigation_engine
```

No test invokes:

```text
esp32/main/hal/sensor_hal.c
esp32/main/services/calibration_mgr.c
esp32/main/services/fertigation_mgr.c
ESP32 HTTP handlers
OpenAPI contract
real frontend production client
```

Therefore the suite proves backend domain logic, not end-to-end M11/M12.

The most important shallow test is `test_simulation_phase_records_and_mixed_vs_delivered`: it passes injected `actual_water_ml=100100` and `delivered_ml=97000`. It proves that the simulator preserves supplied values, not that physical measurement produced them.

Similarly `test_duration_fallback_is_explicit_and_not_verified_volume` proves fallback semantics in the simulator, not on the ESP32 delivery path.

## 12. API/OpenAPI Findings

OpenAPI YAML parsing: **PASS**.

Canonical path coverage: **INCOMPLETE**.

M11/M12 runtime endpoints implemented in source are absent from the canonical OpenAPI document. Frontend TypeScript types also use a separate telemetry quality vocabulary (`GOOD/UNCERTAIN/BAD`) that differs from the M11 sensor quality enum (`VALID/INVALID/STALE/TIMEOUT/DISCONNECTED/OUT_OF_RANGE/UNAVAILABLE`).

`FertigationRun` frontend type is also much narrower and semantically different from the persisted M12 run JSON.

## 13. Mock/Legacy Findings

Production-influencing M11/M12 remnants found during the sweep:

- UI in-memory/seed calibration store remains authoritative for device selection/history presentation.
- `fertigationService.history()` reads from the local UI store.
- Legacy A/B `fertigation_mgr_start_batch()` remains exposed.
- Hardcoded flow sensor identities remain in firmware sensor polling.
- Fixed 180-second phase timeouts remain in firmware.
- `simulate_run()` can fabricate actual measured values by default.

Historical `esp32/docs/generate_prd.py` contains obsolete GH-01/1-minute/fallback descriptions. It is documentation-generation content, not current runtime authority, and should not be used as evidence of current behavior.

## 14. Physical Verification Blockers

The following remain BLOCKED because the environment has no ESP-IDF toolchain/hardware evidence:

```text
ESP-IDF build
Live ESP32 REST
GPIO/relay/valve/pump behavior
Flow sensor pulse/volume accuracy
Level sensor behavior
Pressure sensor behavior
pH/EC real sensor behavior
Power-cycle/reboot physical test
Hydraulic delivery
Actual dosing accuracy
```

`idf.py` is not installed in the audit environment (`command not found`).

## 15. Exact Remaining Gaps

### M11

1. Enforce exact calibrationId/version binding from request/configuration to runtime.
2. Add calibration record lookup by ID and version.
3. Scope calibration records by Complex/assignment.
4. Make generic ESP32 calibration record endpoint support FLOW/LEVEL/pH/EC records.
5. Replace hardcoded sensor acquisition branches with configuration-driven drivers where hardware supports them.
6. Add actual runtime abstractions/tests for humidity, light, pressure, pH, and EC.
7. Add firmware-host tests for sensor quality and calibration behavior.
8. Align frontend sensor/calibration types with backend/firmware/OpenAPI.
9. Add M11 endpoints/models to canonical OpenAPI.

### M12

1. Send the backend-resolved execution plan to ESP32 rather than a raw request that the ESP32 independently re-resolves.
2. Validate recipe semantics/version at device boundary.
3. Use canonical resource availability/locking in the fertigation execution path.
4. Make water-source and mixing-tank selection topology/resource identity-driven.
5. Replace hardcoded raw/delivery flow sensor assumptions.
6. Make timeout policy configuration-driven.
7. Enforce minimum dosing runtime on device.
8. Make `FLOW` delivery completion semantics explicit.
9. Enforce configured pressure target in `PRESSURE_FLOW` mode.
10. Record explicit mixed-volume semantics separately from delivered volume.
11. Remove or fully quarantine the legacy A/B `start_batch` operational path.
12. Add firmware-host/integration tests for every state transition and failure path.
13. Add real `/calibration` and `/fertigation` models/paths to OpenAPI.
14. Replace frontend local-history/runtime representations with authoritative API models.
15. Add firmware deployment/run snapshot tests proving recipe/config/calibration immutability.

## 16. Final Status

```text
M11 = PARTIAL
M12 = PARTIAL
```

No backlog item was changed to `[x]` during this audit.

Recommended next dependency order after this gate:

```text
M11 calibration-reference integrity
→ generic ESP32 calibration records
→ OpenAPI/client parity
→ M12 compiled execution plan parity
→ canonical resource arbitration
→ firmware-host M12 acceptance
```
