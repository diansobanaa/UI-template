# M17 — End-to-End Verification & Physical Commissioning

**Date:** 2026-09-19  
**Milestone:** M17 — Final Engineering Gate  
**Safe Point:** `SP-M17-SOFTWARE-READY`  
**Overall Status:** **PARTIAL**  
**Software E2E:** **PARTIAL**  
**Physical Commissioning:** **BLOCKED**

## 1. Gate boundary

M17 is split into two independent gates:

1. **Software E2E** — can be executed without connected hardware.
2. **Physical Commissioning** — requires the real ESP32-S3, sensors, actuators, electrical interfaces, and hydraulic installation.

No software test in this document is counted as physical proof.

Because the current workbench/environment does not expose a connected ESP32 or commissioned hydraulic installation, no physical PASS is claimed.

## 2. Authoritative production path traced

The current source implements the following production chain:

```text
Frontend / API
    ↓
Validated Request
    ↓
Active Configuration
    ↓
Resolution / Compilation
    ↓
Deployment
    ↓
ESP32 Active Runtime
    ↓
Scheduler
    ↓
Command Manager
    ↓
Safety Precheck
    ↓
Resource / Topology Resolution
    ↓
Resolved Execution Plan
    ↓
Fertigation / Actuator Runtime
    ↓
HAL / GPIO
    ↓
Telemetry + Events + Run Record
    ↓
Offline Spool
    ↓
Replay / ACK
    ↓
Backend Historical Store
    ↓
Crop / Research History
```

### Production source evidence

| Chain step | Production implementation | Software evidence |
|---|---|---|
| Request validation | `esp32/main/http/api_config_handlers.c`, backend API layer | M3/M4 gate, forensic authority 13/13 |
| Active configuration | `esp32/main/storage/storage_mgr.c` | candidate/active/previous transaction tests |
| Resolution / registry | `esp32/main/hal/hardware_registry.c` | M2 + M5/M6 gates |
| Schedule compilation | `backend/schedule_compiler.py`, frontend runtime compiler | M7/M8 gates |
| Deployment | `api_config_handlers.c`, deployment endpoints/OpenAPI | M3/M4 gate |
| Local scheduler | `esp32/main/services/scheduler.c` | M9 16/16 |
| Command authority | `esp32/main/services/command_mgr.c` | M10 31/31 |
| Safety | `esp32/main/services/safety_monitor.c` + E-stop paths | M10 31/31 |
| Resource/topology | M6 backend + M7 engine | M5/M6 + M7/M8 |
| Execution plan | fertigation preparation + compiled schedule | M11/M12 34 + firmware 17 |
| Fertigation runtime | `esp32/main/services/fertigation_mgr.c` | state/fault source gate |
| HAL/GPIO | actuator/sensor HAL | source audit + M11/M12 gate |
| Telemetry/events | telemetry/event managers | M13 gate |
| Offline spool/replay | `esp32/main/services/offline_sync_mgr.c` | M13/M14 gates |
| Historical store | `backend/history_store.py`, `backend/research_store.py` | M13/M14/M15 gates |

## 3. Authority and bypass audit

### Confirmed production invariants

- Frontend operational state comes from the operational backend; no `localStorage` or `sessionStorage` remains in `src/`.
- ESP32 production firmware contains no `gh-01` literal in C/H production source.
- `hardware_registry.c` does not use `components.json` as an operational fallback.
- Automatic schedule dispatch routes through `command_mgr`; scheduler does not independently toggle physical actuators.
- Fertigation uses logical component IDs resolved through the active registry.
- Exact calibration references are required; no silent latest-calibration substitution.
- Telemetry preserves `quality` and unavailable semantics.
- Actual measurement fields are distinct from target fields in fertigation run records.
- Offline cursor advancement occurs only after backend acknowledgement.
- Research analysis now normalizes epoch-millisecond run timestamps into ISO time windows, so fertigation history can be joined to a crop cycle correctly.
- Frontend no longer selects `complexes[0]`, `greenhouses[0]`, or `ghs[0]` as an operational singleton shortcut. Complex selection is URL/context driven, with UI-only active/sole-complex fallback.

### Direct actuator calls that remain by design

Direct HAL calls remain in:

- `command_mgr.c` — automatic command execution authority.
- `fertigation_mgr.c` — fertigation state-machine actuator execution.
- `transfer_mgr.c` — explicit resource transfer operation.
- `calibration_mgr.c` — operator-controlled calibration procedure.
- `manual_actuator_mgr.c` — explicitly human/manual path.
- `panel_button_mgr.c` — physical local operator input path.
- `api_device_handlers.c` — device/manual control surfaces protected by the same safety gates.
- `safety_monitor.c` — emergency/safe-off action.

These are not counted as duplicate automatic schedule authorities. M17 physical testing must still verify that each path is mutually compatible and cannot create illegal overlap.

## 4. Software E2E matrix

| Test ID | Path / verification | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| SW-001 | Boot ordering and safe gate | Safe boot before runtime | Confirmed in source | `test_m17_software_e2e.py` | PASS |
| SW-002 | Configuration candidate validation | Invalid request rejected before staging | Confirmed | M3/M4 + forensic | PASS |
| SW-003 | Atomic activation | Runtime validation before active commit | Confirmed | M3/M4 hardening | PASS |
| SW-004 | Stale configuration/version | Reject mismatch, no silent stale execution | Confirmed | M3/M4 hardening | PASS |
| SW-005 | Rollback | Previous active snapshot preserved and restorable | Confirmed | M3/M4 hardening | PASS |
| SW-006 | Multi-GH configuration | GH-A/GH-B remain isolated | Confirmed in production engine path | M5/M6 + M11/M12 + M17 gate | PASS |
| SW-007 | Cross-GH negative execution | GH-A request cannot bind GH-B dosing/plan | Rejected | M17 28-check gate | PASS |
| SW-008 | Schedule compilation | Only validated resource-complete plans executable | Confirmed | M7/M8 22 PASS | PASS |
| SW-009 | Scheduler → command | Automatic scheduling dispatches through command authority | Confirmed | M9 + source trace | PASS |
| SW-010 | Command → safety | Physical operation requires safety authorization | Confirmed | M10 31/31 | PASS |
| SW-011 | Fertigation state machine | Planned state transitions + safe fault/abort stop | Confirmed | M11/M12 17 firmware checks | PASS |
| SW-012 | Measurement integrity | Target and actual remain distinct | Confirmed | M11/M12 + M17 run record | PASS |
| SW-013 | Telemetry history | Durable, provenance-preserving history | Confirmed in software | M13 | PASS |
| SW-014 | Event history | Stable event records and idempotent ingest | Confirmed | M13 | PASS |
| SW-015 | Offline spool/replay | Cursor persists and advances after ACK | Confirmed in source/tests | M13/M14 | PASS |
| SW-016 | Research traceability | Cycle → plant → fruit → observation → fertigation/telemetry joins | Confirmed | M15 + M17 | PASS |
| SW-017 | Mock/legacy operational paths | No browser operational mock authority | Confirmed | M16 | PASS |
| SW-018 | Singleton GH/Complex shortcut | No `complexes[0]`, `greenhouses[0]`, `ghs[0]` in UI source | Confirmed | M17 static audit | PASS |
| SW-019 | OpenAPI/handler contract | Critical REST routes exist and handlers are registered | 28 endpoints / 26 handlers | `npm test` | PASS |
| SW-020 | Python source validity | Backend/scripts compile | Pass | `python3 -m compileall -q backend scripts` | PASS |
| SW-021 | Frontend production build | Clean dependency install and build | Dependency tree incomplete; `tsc -b` cannot resolve type packages | M17 clean-build log | BLOCKED |
| SW-022 | Firmware production build | ESP-IDF compile with target toolchain | `idf.py` unavailable | M17 toolchain check | BLOCKED |
| SW-023 | Live ESP32 REST E2E | Real device responds and executes live path | No connected device | Hardware unavailable | BLOCKED |

## 5. Software E2E result

**Status: PARTIAL.**

The production logic path is software-proven through source assertions and real backend production functions, including a two-greenhouse chain, cross-GH negative tests, fertigation preparation, telemetry/event history, idempotent ingest, and research joins.

The software gate is not promoted to PASS because the current environment cannot complete a clean frontend production build and cannot compile the firmware with the real ESP-IDF toolchain.

## 6. Physical commissioning matrix

No row below may be changed to PASS without actual physical evidence.

| Test ID | Physical component / scope | Procedure | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|
| PHYS-001 | ESP32 + actuator outputs | Power-up with all outputs connected; observe OFF/safe state | All outputs physically safe before runtime | Not tested | None | BLOCKED |
| PHYS-002 | Sensor interfaces | Verify GPIO/interface, raw readings and disconnect behavior for configured sensors | Correct raw/converted/quality states | Not tested | None | BLOCKED |
| PHYS-003 | Dosing channels | Volumetric calibration for every installed dosing channel | Calibration record matches collected volume/runtime | Not tested | None | BLOCKED |
| PHYS-004 | Raw + delivery flow meters | Known-volume pulse calibration at safe low/normal operating points | Measured volume reconciles with actual collected volume | Not tested | None | BLOCKED |
| PHYS-005 | Pumps / valves / fan | Operate each actuator individually through configured logical ID | Correct physical device responds; stop is reliable | Not tested | None | BLOCKED |
| PHYS-006 | E-stop | Trigger during idle, fill, dose, mix, delivery, queued and offline states | Immediate safe physical state; no automatic restart | Not tested | None | BLOCKED |
| PHYS-007 | Power loss / brownout | Remove power during idle, pump ON, dose, delivery, offline and spooled-data states | Safe outputs, deterministic reboot/recovery, no unsafe resume | Not tested | None | BLOCKED |
| PHYS-008 | Network failure | Disconnect/reconnect communication while operating | Autonomous operation where allowed; local spool; replay/ACK | Not tested | None | BLOCKED |
| PHYS-009 | Durable spool | Reboot with unsent telemetry/events/run records; test duplicate/corrupt/overflow cases | Records preserved/deduplicated/cursor-correct | Not tested | None | BLOCKED |
| PHYS-010 | Resource concurrency | Run realistic GH-01/GH-02 combinations and shared-resource conflicts | Correct parallelism, queueing or rejection | Not tested | None | BLOCKED |
| PHYS-011 | Hydraulic paths | Trace raw water → mixing → delivery and each route valve | Correct routing, no cross-GH contamination/backflow/leak/starvation | Not tested | None | BLOCKED |
| PHYS-012 | Controlled fertigation | Run safe real recipe at controlled volume | Commanded vs measured vs recorded reconciles | Not tested | None | BLOCKED |
| PHYS-013 | Crop/research E2E | Complete live cycle → plant → fruit → observation → fertigation → harvest chain | Stable identifiers and immutable history | Not tested | None | BLOCKED |
| PHYS-014 | Live frontend | Execute production UI against live controller/backend | UI reflects authoritative live state and failures | Not tested | None | BLOCKED |

## 7. Hardware/wiring commissioning basis

The canonical repository hardware documentation identifies the target board as **ESP32-S3-WROOM-1-N16R8** and documents GPIO mappings for pumps, flow meters, DS18B20, relay outputs, lower float, tamper loop, buttons and SPI peripherals. Those documents are planning/wiring references for M17; their repository labels are not accepted as M17 physical proof.

Important source-specific commissioning items:

- Raw-water ZJ-B1 calibration remains explicitly unverified in the hardware inventory.
- The FS400A flow documentation contains a calibration constant/formula that must be checked against the physical sensor datasheet and actual calibration before accepting measured-volume accuracy. Do not copy a nominal number into the acceptance result without measurement.
- AC loads are controlled through intermediate switching hardware; no mains load is to be connected directly to ESP32 GPIO.
- GPIO/power rails and DMM verification must precede energized commissioning.
- Deferred/unused hardware such as W5500 and the booked blower path must remain outside the active commissioning path unless deliberately commissioned later as part of the configured installation.


## 7A. Final GPIO / Pin / Hardware Mapping Audit

The M17 pin authority is `docs/HARDWARE_WIRING_MAP.md`. The full forensic cross-check is in `docs/FINAL_GPIO_HARDWARE_MAPPING_FORENSIC_AUDIT-2026-09-19.md`.

Result: **source GPIO mapping matches W-01..W-26**, and safe boot now covers all 9 mapped actuator outputs. However, physical installation remains **BLOCKED** because there is no dedicated physical E-stop mapping in the canonical pin map, W-15 contains an internal ZJ-B1/YF-B1 identity contradiction, and physical hardware evidence is absent.

## 8. Physical commissioning order

1. De-energized wiring inspection.
2. DMM verification of 3.3V/5V/12V rails and signal isolation.
3. ESP32 boot and safe-output observation.
4. One actuator at a time.
5. One sensor at a time.
6. Dosing calibration for every installed channel.
7. Flow calibration.
8. E-stop with each relevant runtime phase.
9. Power-loss/reboot and spool tests.
10. Network loss/reconnect tests.
11. Resource/concurrency tests.
12. Hydraulic routing verification.
13. Controlled real fertigation trial.
14. Crop/research live traceability trial.
15. Final live frontend verification.

## 9. Safety acceptance rules

- Never energize an AC load before wiring and protective devices are independently checked.
- Never treat a timer duration as proof of delivered volume when a measured-volume criterion is required.
- Never accept missing, disconnected, stale or invalid sensor data as a valid zero.
- Never bypass E-stop or safety interlocks to make a test pass.
- Never change software thresholds solely to conceal failed hardware behavior.
- Record actual observed values and actual evidence.

## 10. Clean-build / reproducibility record

Environment:

```text
Node  v22.16.0
npm   10.9.2
Python 3.13.5
ESP-IDF / idf.py: NOT FOUND
Git metadata in delivered archive: NONE
```

A clean `npm ci --ignore-scripts --no-audit --no-fund` attempt did not complete and left an incomplete dependency tree. The subsequent `npm run build` was therefore blocked by missing type-definition packages (`@types/node`, `@types/react`, `@types/react-dom`, Babel/ESTree type packages) before Vite compilation.

This is recorded as **BLOCKED**, not as a production build failure of the application logic and not as a PASS.

## 11. Full regression result

The final M17 regression run returned exit code 0 for the completed milestone software suite:

- M2: **26/26 PASS**
- M3/M4 Hardening: **PASS**
- M5/M6: **PASS**
- M7/M8 runtime: **22 PASS**
- Backend M7/M8: **7/7 PASS**
- M9: **16/16 PASS**
- M10: **31/31 PASS**
- Backend M10 proxy: **6/6 PASS**
- M11/M12 backend: **34/34 PASS**
- M11/M12 firmware production-path: **17/17 PASS**
- M13: **PASS**
- M14/M15: **PASS**
- M16: **PASS**
- Forensic authority: **13/13 PASS**
- OpenAPI/REST mock contract: **PASS** (28 endpoint definitions / 26 firmware handlers)
- M17 software production-path gate: **28/28 PASS**
- Python compile: **PASS**

These results are software evidence only.

## 12. Trinity final matrix

| Principle | Status | Evidence boundary |
|---|---|---|
| Active Configuration is operational authority | PASS (software) | M3/M4 + forensic |
| Frontend is not physical authority | PASS (software) | M16 + service architecture |
| Backend/config layer owns configuration/deployment | PASS (software) | M3/M4 |
| ESP32 owns local runtime/safety | PASS (software) | M9/M10 |
| One automatic physical execution authority | PASS (software source) | Scheduler → command path audited |
| Multi-GH identity is configuration-driven | PASS (software) | M5/M6/M11/M12/M17 |
| Resources explicitly controlled | PASS (software) | M6/M7/M8 |
| Topology validated | PASS (software) | M7/M8 |
| Schedule compilation authoritative | PASS (software) | M7/M8 |
| Runtime executes validated plans | PASS (software) | M9/M12 |
| Exact calibration references preserved | PASS (software) | M11/M12 |
| Historical recipes/calibrations immutable by reference | PASS (software) | M11/M12 |
| Telemetry provenance preserved | PASS (software) | M13 |
| Offline operation deterministic/safe | PASS (software) | M14 |
| E-stop fail-safe | PASS (software); physical unproven | M10 + blocked PHYS-006 |
| Power recovery safe | PASS (software); physical unproven | M14 + blocked PHYS-007 |
| No fake sensor values | PASS (software) | M11/M12 |
| No fake hydraulic PASS | PASS | M17 physical gate remains BLOCKED |
| No hidden mock authority | PASS (software) | M16 + M17 static audit |

## 13. Final release status

### SOFTWARE E2E

**PARTIAL** — production-path gate is **28/28 PASS**, but the release software gate remains partial because the clean frontend production build and firmware toolchain build are blocked in the current environment.

### PHYSICAL COMMISSIONING

**BLOCKED** — no real connected ESP32/sensors/actuators/hydraulics evidence was available for M17.

### OVERALL M17

**PARTIAL** — the software safe point is complete, but the physical engineering gate is not complete.

## 14. Safe point

`SP-M17-SOFTWARE-READY`

This safe point means:

- M2–M16 software gates are passing.
- M17 production software path is exercised and audited.
- Physical commissioning procedures and evidence matrix are prepared.
- Physical commissioning has **not** been passed.

`SP-M17-COMPLETE` must not be created until every required physical acceptance item has actual evidence.

## 15. Repository changes in M17

Primary changes for this milestone:

- `backend/research_store.py` — normalized epoch-millisecond fertigation run timestamps for crop-window joins.
- `src/main.tsx` + `src/components/OperationalHydrator.tsx` — operational app is rendered only after the authoritative operational context is ready.
- frontend operational context selection cleanup to remove singleton index shortcuts.
- `scripts/test_m17_software_e2e.py` — 28-check production-path software gate.
- `scripts/verify_e2e_contracts.mjs` — critical configuration deployment endpoints added to the contract inventory.
- `package.json` — `test:m17` command.
- `IMPLEMENTATION_BACKLOG_PRD_ALIGNMENT.md` — M17 evidence/status update.
- `AI_PROGRESS.md` — M17 status and safe point.
- `AI_HANDOVER.md` — M17 handover and blockers.
- `docs/M17_END_TO_END_AND_PHYSICAL_COMMISSIONING.md` — this document.
- `final_verification/m17_regression_2026-09-19.log` — full software regression log.
- `final_verification/m17_clean_build_toolchain_2026-09-19.log` — build/toolchain evidence.

No git commit hash is recorded because the delivered archive does not contain `.git` metadata.

## 16. Final statement

**Software-proven:** configuration authority, dynamic multi-GH resolution, compilation, deployment/rollback, local scheduling, command/safety paths, fertigation preparation/runtime semantics, telemetry/event history, offline replay model, and crop/research relationships.

**Physically unproven / BLOCKED:** electrical wiring under live power, actual GPIO levels, real pump/valve behavior, real sensor readings, dosing calibration, flow accuracy, hydraulic routing, E-stop physical isolation/behavior, power-loss behavior, network-loss operation on the real device, durable spool under physical interruption, and a real controlled fertigation trial.

M17 stops here. No subsequent milestone is defined by this document.
