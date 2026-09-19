# AI HANDOVER — SP-CHATGPT-BRANCH-CREATION

## Status
**Git Branch `chatgpt` Initialization and Synchronization is 100% COMPLETE.**  
**Safe Point**: `SP-CHATGPT-BRANCH-CREATION`  
**Remote URL**: `https://github.com/diansobanaa/UI-template.git`  
**Branch**: `chatgpt` (branched from `origin/main` commit `a78e987`)  

### Summary:
- Git initialized in workspace with remote `origin` pointing to `https://github.com/diansobanaa/UI-template.git`.
- Clean branch `chatgpt` established from `origin/main`.
- Excluded uncommitted runtime SQLite state (`*.sqlite3`) and Python cache artifacts via `.gitignore`.
- Full build and test verification passed (`npx vite build`, `npm test`, `npm run test:onboarding`).
- **Commit Hash**: `3f5fe40`

---

# AI HANDOVER — SP-NETWORK-FIRST-BOOT-FORENSIC-AUDIT

## Status
**Network First-Boot & Connectivity Forensic Audit is 100% COMPLETE.**  
**Safe Point**: `SP-NETWORK-FIRST-BOOT-FORENSIC-AUDIT`  
**Canonical Report**: `docs/NETWORK_FIRST_BOOT_FORENSIC_AUDIT.md`  
**Verdict**:
- `NETWORK FIRST-BOOT`: **NOT READY**
- `HARDWARE INSTALLATION NETWORK READINESS`: **NOT READY**

### Key Findings Summary:
1. **Wi-Fi SoftAP**: Broadcasts `AGROTECH-SETUP` (password `agrotech` at `192.168.4.1`), but has NO captive portal, NO web page (returns 404), and NO provisioning API to receive router credentials.
2. **Wi-Fi Provisioning**: Missing. Initial Wi-Fi credentials (`sta_ssid`, `sta_pass`) can only be written via USB serial flashing.
3. **mDNS**: Dead. `mdns_init()` is never called in firmware; `esp32-*.local` will not resolve.
4. **IP Discovery**: Missing. TFT does not show IP; `GET /api/v1/status` returns hardcoded dummy `"127.0.0.1"`.
5. **LAN / W5500**: Blocked. No driver code exists; GPIO 10 is allocated to Blower Fan in SSOT (`docs/HARDWARE_WIRING_MAP.md`).
6. **Wi-Fi Auto-Reconnect**: Caps retries at 5 and permanently stops attempting reconnection.
7. **Complex Binding Lockout**: First boot sets `complexId = "complex-01"`. Creating a Complex with any other ID blocks binding in UI.
8. **UI Onboarding "Create & continue" blocker**: Step 1 calls `POST /api/complexes` which requires Python backend running on port 8090. If inputs are empty or backend is down, button does not advance.

---

# AI HANDOVER — SP-CONNECTION-MONITOR-EMPTY-STATE-SUPPRESSION

## Status
**Connection Monitor Empty-State / Initial Onboarding False Alarm is 100% RESOLVED and VERIFIED.**  
**Safe Point**: `SP-CONNECTION-MONITOR-EMPTY-STATE-SUPPRESSION`  
**Dev Server**: Running at `http://localhost:5179/#/onboarding/complex`  
**Backend Server**: Running at `http://127.0.0.1:8090`

### Resolution Summary
1. Root Cause: `ConnectionMonitor.tsx` ran an unconditional background polling loop against `esp32Client.getHealth()` regardless of whether any Complex or ESP32 controller was registered in the database. When zero complexes or bound controllers existed, the failed health checks triggered an active alarm ("KONEKSI TERPUTUS! ESP32 tidak merespon") and siren.
2. Fixes Applied:
   - `src/components/ConnectionMonitor.tsx`: gated polling, siren, and UI render on `hasBoundController` (`operationalComplexes.some(c => Boolean(c.esp32?.deviceId && c.esp32.deviceId.trim()))`). If no bound controller exists, polling is skipped, audio is stopped, failure count is reset, and the component renders `null`.
   - `docs/POWER_MAP.md`: documented the registration gate condition in Section 7.2.
3. Verification:
   - Live CDP browser check on `http://localhost:5179/#/onboarding/complex`: `Alarm banner present: false`, `KONEKSI TERPUTUS text present: false`.
   - `node scripts/test_software_blocker_remediation.mjs`: PASS.
   - `npm test`: PASS (OpenAPI + C firmware handlers + direct REST).
   - `npm run test:m10`: PASS.
   - `npm run test:onboarding`: PASS.
   - `npx vite build`: PASS (911.26 kB).

---

# AI HANDOVER — SP-ONBOARDING-CREATE-CONTINUE-FIX

## Status
**Complex Onboarding "Create & continue" blocker is 100% RESOLVED and VERIFIED.**  
**Safe Point**: `SP-ONBOARDING-CREATE-CONTINUE-FIX`  
**Dev Server**: Running at `http://localhost:5179/#/onboarding/complex`  
**Backend Server**: Running at `http://127.0.0.1:8090` (and auto-managed via Vite plugin during `npm run dev`)

### Resolution Summary
1. Root Cause: When clicking "Create & continue", the frontend executes `complexService.create()`, sending a `POST /api/complexes` request through the Vite dev proxy to `http://127.0.0.1:8090`. Because the Python backend server (`backend/server.py`) was not running, the proxy returned `500 ECONNREFUSED`. The submission caught the error and stayed on Step 1 without advancing to Step 2.
2. Fixes Applied:
   - Fixed relative import exceptions in `backend/resource_manager.py` and `backend/fertigation_engine.py` with `try ... except ImportError` fallbacks.
   - Added `pythonBackendPlugin` in `vite.config.ts` to automatically spawn `python -m backend.server` in the background on port 8090 whenever `npm run dev` is active.
   - Enhanced `src/lib/api/backend-client.ts` to transform raw HTML proxy errors into clean, descriptive error messages.
   - Added user toast notifications to `src/app/onboarding-complex.tsx`.
   - Updated canonical documentation in `docs/COMPLEX_ESP32_ONBOARDING.md`.
3. Verification:
   - Live CDP browser automation: Filled "nnn", "nnn", "babibu" and clicked "Create & continue" -> `POST /api/complexes` returned 201 Created and successfully advanced to Step 2 / 5 ("Discover the ESP32 controller").
   - `npm run test:onboarding`: PASS.
   - `npx vite build`: PASS (910.98 kB).

---

# AI HANDOVER — SP-CHATGPT-HEADER-TITLE-UPDATE

## Status
**UI Header Branding Update ("ChatGPT - AgroTech — Smart Greenhouse System") is 100% COMPLETE and VERIFIED.**  
**Safe Point**: `SP-CHATGPT-HEADER-TITLE-UPDATE`  
**Dev Server**: Running at `http://localhost:5179/`  
Header branding, document title, and responsive layout labels updated across HTML, SPA runtime, AppHeader, AppSidebar, and production bundle.

## Production Simulation Boundary

The production surface contains no fertigation simulation endpoint, simulation client method, or `simulate_run()` helper. Host-side simulation is isolated under `tests/support/fertigation_simulation.py` and is test-only; it must never be imported by `backend/` or `src/`.

The legacy `/api/complexes/{complexId}/fertigation/simulate` endpoint is intentionally absent and returns `404 NOT_FOUND` when requested.

## Current Status
- **Date/Time**: 2026-09-18
- **Safe Point**: SP-FORENSIC-001 — PRD/M2 forensic re-audit and targeted authority hardening.
- **PRD Alignment**: **PARTIAL**. The audited installed-component authority path is hardened, but M3/M4 candidate/active transactionality, M5 multi-GH runtime architecture, complete semantic/resource/topology validation, and physical verification remain incomplete.
- **Git**: the uploaded repository snapshot contains no `.git` directory; current git state/history cannot be independently verified from this artifact.

## Current Verification
| Check | Result | Scope |
|---|---|---|
| `node scripts/test_forensic_authority.mjs` | PASS — 13/13 | Production source assertions |
| `node scripts/test_m2_hardware_management.mjs` | PASS — 26/26 | Software simulation; not physical proof |
| `node scripts/test_m3_configuration_authority.mjs --mock` | PASS — 18/18, 1 BLOCKED | Mock authority model; reboot/physical test blocked |
| `node scripts/verify_e2e_contracts.mjs --mock` | PASS | Mock REST/contract checks |
| OpenAPI YAML parse | PASS | Root + canonical contract parse |
| `npm run build` | BLOCKED/FAIL | Incomplete dependencies in current environment |
| ESP-IDF build | BLOCKED | `idf.py`/ESP32 toolchain unavailable |
| Live ESP32 REST | BLOCKED | No device available |
| Physical reboot persistence | BLOCKED | No device available |

## Implemented Remediation
- NVS active configuration is the only operational installed-component authority on the audited path.
- Production `components.json` fallback was removed; missing/invalid active config now yields a safe-empty registry.
- Registry parsing is staged and committed only after validation; component assignment is tied to the device Complex.
- Known actuator command paths resolve physical GPIO from active configuration and fail closed for unknown/non-operational components.
- Frontend installed-hardware inventory and component CRUD use the ESP32 configuration/inventory path; static installed seeds are not an authority.
- OpenAPI/component schema drift and a duplicate command schema property were corrected.
- Backlog statuses were downgraded where evidence was only partial (M2.18, M2.19, M2.24).

## Remaining Gaps
- M3/M4: candidate vs active vs previous configuration, deployment ID/ACK, boot recovery, atomic activation and rollback are not implemented.
- M5: crop-cycle, telemetry, context and related firmware/API paths still contain GH-01 runtime assumptions.
- Configuration validation does not yet fully enforce resource ownership, topology, safety dependencies and hardware compatibility.
- Physical GPIO/sensor/W5500/reboot/electrical safety/dosing accuracy evidence is unavailable in this environment.

## Next Action
The next dependency-ordered implementation item is M3.1 Configuration Schema Validation. Do not claim M3.0/M4 transactionality or physical verification until those requirements have direct implementation and evidence.

---

# AI HANDOVER DOCUMENT

## Current Status
- **Date/Time**: 2026-09-18
- **Safe Point**: SP-M3-000 - Active Configuration Authority Verification Gate (M3.0) & Documentation Governance Sync Complete

## What was just completed (SP-M3-000)

### 1. Documentation Governance Mandate
- Consolidated documentation into the single canonical project documentation directory: docs/.
- Eliminated all duplicate mirror documentation under esp32/docs/.
- Updated .agents/rules/DOCUMENTATION_MANDATE.md, AGENTS.md, and GEMINI.md to enforce canonical documentation governance.

### 2. M3.0 Active Configuration Authority Verification Gate
- Established the **Active Configuration Snapshot** (NVS lvc_json) as the single authoritative source of truth for installed components.
- In esp32/main/http/api_device_handlers.c, updated handler_get_inventory() to serve directly from the active configuration snapshot.
- In esp32/main/hal/hardware_registry.c, verified clear, atomic validation, and runtime derivation rules.
- In the frontend (src/lib/services.ts, src/lib/api/esp32-client.ts), ensured hardwareService.getInstalledComponents() fetches directly from the ESP32 REST API (/api/v1/inventory), with no localStorage or static fixtures acting as an independent authority.
- Added comprehensive behavioral verification suite scripts/test_m3_configuration_authority.mjs covering Groups 1-6 (18 passing tests).

## Verification Evidence (All Software)
| Check | Result |
|---|---|
| M3.0 Authority Suite (scripts/test_m3_configuration_authority.mjs --mock) | PASS - 18 PASS, 0 FAIL, 1 BLOCKED |
| M2.16-M2.26 Behavioral Audit (scripts/test_m2_hardware_management.mjs) | PASS - 26/26 PASS |
| 
pm test -- --mock (OpenAPI + handler + REST contract) | PASS |
| 
pm run build (TypeScript + Vite) | PASS - 864.03 kB bundle |
| Live ESP32 REST test | BLOCKED - physical hardware not connected |
| Physical reboot persistence | BLOCKED - physical hardware not connected |

## Authority Architecture (M3.0 Verified)
`	ext
ActiveConfiguration (NVS lvc_json) [AUTHORITY]
  │
  ├─► hardware_registry_load_from_json()
  │     └─► s_active_components[] [DERIVED RUNTIME VIEW]
  │           └─► actuator_hal / sensor_hal
  │
  ├─► GET /api/v1/inventory [DERIVED API VIEW]
  │     └─► Frontend hardwareService [DERIVED CLIENT VIEW]
  │
  └─► Storage Persistence (NVS)
`

## Blocked Items
- Physical reboot persistence test (M2.22 / M3.0 Group 3 Test I) - requires ESP32 connected via USB.
- Live REST E2E test against running ESP32 on LAN (192.168.1.50).

## Next Action for Next Agent / Operator
- **Next Safe Point**: SP-M3-001 - M3.1 Configuration Schema Validation (ESP32 + Frontend).


# M9 Runtime Scheduler Handover

## Current Status
- **Date**: 2026-09-18
- **Safe Point**: SP-M9-001
- **M9 Software Status**: PASS for implemented/simulated behavior; physical verification BLOCKED.

## Runtime Architecture
`Compiled ACTIVE schedules → local ESP32 time → due evaluation → explicit resource lock → command manager → terminal result → persistent execution marker`

Raw writable scheduler entries remain source-compatible but return `ESP_ERR_NOT_SUPPORTED` and are not an execution authority. Browser timers are not used as the physical scheduler authority.

## Verification
- M9 scheduler acceptance: 15/15 PASS.
- M7/M8 regression: 21 PASS.
- Backend M7/M8 regression: 7 PASS.
- ESP32 source syntax check with host stubs: PASS.
- ESP-IDF build: BLOCKED (toolchain unavailable).
- Live ESP32/physical verification: BLOCKED (device unavailable).

## Next Dependency
M10 Command System + Safety: make all physical commands safety-authorized/idempotent and connect scheduler execution to the full local safety policy.


# M9 FINAL HANDOVER — SP-M9-002

## Current Status
- **Date**: 2026-09-18
- **Safe Point**: SP-M9-002
- **M9**: Software/simulation acceptance closed. Physical verification remains BLOCKED.

## Important Runtime Details
- Compiled schedule timestamps are canonical Unix milliseconds and are normalized to ESP32 seconds at the scheduler boundary.
- Scheduler accepts only `status=ACTIVE` + `activationState=ACTIVE`.
- Raw schedule write APIs are retained for compatibility only and return `ESP_ERR_NOT_SUPPORTED`; raw schedule HTTP mutation endpoints return `410 RAW_SCHEDULES_RETIRED`.
- Runtime resource locks explicitly model SHARED and EXCLUSIVE claims.
- Schedule/marker state is persisted atomically in a single NVS transaction during deployment.
- A running physical command blocks compiled-schedule replacement.
- A persisted RUNNING marker becomes `MARKER_RECOVERY_HOLD` after reboot to prevent unsafe duplicate replay; reconciliation belongs to M14.

## Verification Evidence
| Check | Result | Scope |
|---|---|---|
| `scripts/test_m9_runtime_scheduler.mjs` | **16/16 PASS** | M9 simulation + source assertions |
| `scripts/test_m7_m8_engine.mjs` | **21 PASS** | M7/M8 runtime engines |
| `scripts/test_backend_m7_m8.py` | **7 PASS** | Backend topology/compiler |
| `scripts/test_forensic_authority.mjs` | **13 PASS** | Source authority invariants |
| `scripts/test_m2_hardware_management.mjs` | **26 PASS** | M2 software behavior |
| `scripts/test_m3_configuration_authority.mjs --mock` | **18 PASS / 1 BLOCKED** | M3 authority model; physical reboot blocked |
| `scripts/verify_e2e_contracts.mjs --mock` | **PASS** | REST/OpenAPI mock contract |
| `clang scheduler.c` | **PASS** | Host syntax check with ESP-IDF stubs |

## Blockers
- ESP-IDF toolchain not available in this environment.
- No physical ESP32, sensors, pumps, valves, W5500 or hydraulic bench is available for live evidence.

## Next Dependency
M10 Command System + Safety. Do not use M9 acceptance PASS as evidence of physical actuator correctness.


# M10 COMMAND + SAFETY HANDOVER — SP-M10-001

## Current Status
- **Date**: 2026-09-18
- **Safe Point**: `SP-M10-001`
- **M10 software status**: PASS for implemented software/simulation acceptance. Physical commissioning remains BLOCKED.

## Implemented
- Command ID, target Complex/GH, component/resource context, configuration-version context, bounded parameters, result/receipt and structured command events.
- Local command validation against active configuration and lifecycle state.
- Explicit resource/ownership checks before physical execution.
- Safety authorization before physical start; no UI-side safety state is treated as physical authority.
- Idempotent command handling within the controller runtime, including semantic command-ID reuse rejection.
- Command cancellation and safety-trip interruption of pending/running commands and active transfer/fertigation orchestration.
- Safe boot remains active until all core runtime/safety services are initialized; configured registry outputs are forced safe.
- Persistent/latching E-stop with explicit recovery workflow and safety locks.
- Scheduler execution is gated by the same local safety authority.
- Configurable maximum runtime, flow-timeout, low-level protection and stale-sensor handling.
- High-level protection is represented as a declared/external interlock dependency when required; the system does not fabricate radar electrical state.
- Durable safety event path uses SD card when mounted and SPIFFS fallback otherwise.
- Backend command/inventory/configuration proxy preserves device payload shape and propagates device safety rejection status codes.
- Frontend direct and backend command paths require authoritative remote execution; local/mock water telemetry is not used as the physical well-pump interlock.
- Frontend emergency-stop retries propagate a stable command ID to the ESP32 command endpoint.

## Verification Evidence
| Check | Result | Scope |
|---|---:|---|
| `scripts/test_m10_command_safety.mjs` | **31/31 PASS** | M10 command/safety simulation + source assertions |
| `scripts/test_m10_backend_proxy.py` | **6/6 PASS** | Backend ↔ ESP32 command/read proxy |
| `scripts/test_m9_runtime_scheduler.mjs` | **16/16 PASS** | M9 regression |
| `scripts/test_m7_m8_engine.mjs` | **21 PASS** | M7/M8 regression |
| `scripts/test_backend_m7_m8.py` | **7/7 PASS** | Backend M7/M8 regression |
| `scripts/test_m3_configuration_authority.mjs --mock` | **18 PASS / 0 FAIL / 1 BLOCKED** | M3 authority; physical reboot blocked |
| `scripts/test_m2_hardware_management.mjs` | **26/26 PASS** | M2 software behavior |
| `scripts/test_forensic_authority.mjs` | **13/13 PASS** | Source authority invariants |
| `npm test` | **PASS** | Mock REST/OpenAPI contract |
| OpenAPI M10 command schema | **PASS** | root + canonical contracts |
| `python3 -m py_compile backend/*.py scripts/test_m10_backend_proxy.py` | **PASS** | Python syntax |
| `npm run build` | **BLOCKED** | Environment has incomplete/empty dependency package contents after interrupted `npm ci`; not treated as application PASS |

## Physical Blockers
- ESP-IDF build/toolchain unavailable in the environment.
- No ESP32 board, GPIO bench, sensors, pumps, valves, W5500 or hydraulic test rig is connected.
- Therefore live actuator, sensor, reboot, power-loss, electrical interlock and hydraulic evidence remain **BLOCKED**.

## Known Scope Boundary
- Controller idempotency journal is currently an in-memory recent-command cache; reboot recovery prevents unsafe automatic replay, but cross-reboot replay identity persistence is not claimed as a separate acceptance feature.
- Legacy GH-01/static application data still exists in non-M10 domains and must be removed/migrated under their respective milestones.

## Next Dependency
`SP-M11-000` — Sensor Framework + Calibration.

# M5 + M6 HANDOVER — SP-M5M6-001

## Current Status
- **Date**: 2026-09-19
- **Safe Point**: `SP-M5M6-001`
- **M5 software status**: COMPLETE.
- **M6 software status**: COMPLETE.
- Physical commissioning is still M17 and remains blocked without hardware/toolchain evidence.

## Implemented
- Dynamic Complex/GH context from active configuration; no production runtime fabrication of GH-01.
- Dynamic registry-driven component/resource state in device context and telemetry.
- Configuration-driven logical component transfer path in ESP32 command runtime using `sourceComponentId` and `destinationComponentId`.
- Resource manager backend endpoint for authoritative resource state.
- Resource transfer proposal requiring explicit physical-move confirmation.
- Shared/exclusive ownership semantics, assignment synchronization, impacted schedule revalidation and capability recalculation.
- Frontend resource transfer modal with target GH selection, physical-move confirmation, and M3/M4 deployment.
- Schedule timeline lanes derived from current configured GHs rather than fixed GH-01…GH-05 rows.

## Verification Evidence
| Check | Result |
|---|---:|
| `scripts/test_m5_m6.py` | **PASS** |
| `scripts/test_m3_m4_hardening.py` | **PASS** |
| `scripts/test_m10_command_safety.mjs` | **31/31 PASS** |
| `scripts/test_m11_m12_engine.py` | **30/30 PASS** |
| `scripts/test_m13_history.py` | **PASS** |
| `scripts/test_m14_m15.py` | **PASS** |
| `scripts/test_m16_no_legacy_operational_paths.mjs` | **PASS** |
| `scripts/test_m7_m8_engine.mjs` | **22 PASS** |
| `scripts/test_m9_runtime_scheduler.mjs` | **16/16 PASS** |
| `scripts/test_m2_hardware_management.mjs` | **26/26 PASS** |
| Python compilation | **PASS** |
| `node --check` runtime JS | **PASS** |

## Remaining Physical Evidence
- ESP-IDF build with the actual project/toolchain.
- Live ESP32 configuration load/reboot verification.
- Physical resource transfer, GPIO, valve/pump, safety and hydraulic tests.

## Next Dependency
M11/M12 finalization → M17 physical commissioning.


## 2026-09-19 — M11/M12 Finalization Handover
M11 and M12 are closed at software/contract level. Official gate: `npm run test:m11:m12` = PASS (34 backend tests + 17 firmware source checks).
Physical ESP32/ESP-IDF/hydraulic evidence remains M17.
Next milestone: M17 physical commissioning after hardware/toolchain availability.

# M17 FINAL HANDOVER — SP-M17-SOFTWARE-READY

## Status

- M17 overall: **PARTIAL**
- Software E2E: **PARTIAL**
- Physical commissioning: **BLOCKED**
- Safe point: `SP-M17-SOFTWARE-READY`

## Software evidence

- M17 production-path gate: **28/28 PASS**.
- Completed milestone regression M2–M16: green.
- Forensic authority: **13/13 PASS**.
- OpenAPI/mock REST: **PASS**.
- Python compile: **PASS**.

## Physical boundary

The real hardware gate has not been executed. Do not convert source checks or simulation into physical evidence.

Physical work still requires actual evidence for:
- wiring/GPIO/output-safe boot
- sensors and quality states
- dosing calibration
- raw/delivery flow calibration
- pump/valve/fan actuation
- E-stop during all relevant states
- power loss/brownout/reboot
- offline spool and replay under physical interruption
- shared-resource concurrency
- hydraulic routing/leak/backflow/starvation checks
- controlled real fertigation
- live crop/research traceability

## Environment blockers

- clean `npm ci` did not complete in the current environment;
- `npm run build` is blocked by an incomplete dependency tree;
- ESP-IDF / `idf.py` is unavailable;
- delivered archive has no `.git` metadata.

## M17 document

See `docs/M17_END_TO_END_AND_PHYSICAL_COMMISSIONING.md` for the production-path audit, software matrix, physical commissioning matrix, commissioning order, safety rules and final evidence boundary.

M17 is the final engineering gate. No later milestone is defined by this handover.


## M17 FINAL STATE — 2026-09-19

- Safe point remains `SP-M17-SOFTWARE-READY`.
- Software regression remains green after pin-policy hardening.
- Physical commissioning is BLOCKED.
- Do not wire hardware until the physical E-stop mapping is authoritatively defined and the W-15 ZJ-B1/YF-B1 naming contradiction is resolved.

# FINAL PRE-HARDWARE SOFTWARE REMEDIATION — 2026-09-19

## Status
Software blocker remediation is complete for all actionable findings from the final forensic audit. Hardware commissioning remains a separate physical gate.

## Closed Findings
- DEF-UI-001 — status enum drift / unsafe GH fallback: CLOSED.
- DEF-UI-002 — null `systemStatus()` contract: CLOSED.
- DEF-UI-003 — undefined `currentMetricValue()`: CLOSED.
- DEF-UI-004 — observation field drift: CLOSED.
- DEF-UI-005 — ESP32 status field drift: CLOSED.
- DEF-SAFE-001 — custom application watchdog: NOT VERIFIED, with rationale documented; do not invent a duplicate watchdog. Verify platform watchdog behavior during actual ESP-IDF/hardware commissioning.

## Hardware Contract Boundaries
- `docs/HARDWARE_WIRING_MAP.md` is authoritative and unchanged.
- W-15 naming ambiguity remains a hardware-contract issue; do not choose between ZJ-B1 and YF-B1 in software.
- Dedicated physical E-stop mapping remains unspecified in the authoritative map; do not invent a GPIO.

## Do Not Regress
- Do not restore first-GH/array-index fallback for any physical-capable operation.
- Do not introduce alternate ESP32 status field aliases as hidden compatibility.
- Keep Complex status vocabulary aligned to `Active` / `Inactive` for the Complex domain; other status enums (deployment/crop-cycle/etc.) are separate domains and must not be collapsed.
- Preserve `observationId` / `observedAt` contract.
- Keep `systemStatus` explicitly unavailable when required data cannot be derived; do not fabricate values.
- Keep local ESP32 runtime/safety authority separate from frontend state.

## Verification
All existing functional milestone gates through M17 software E2E remain green after remediation. See `docs/SOFTWARE_BLOCKER_REMEDIATION_REPORT.md` for the detailed evidence table.

## Build/Toolchain
- Node: v22.16.0
- npm: 10.9.2
- Clean `npm ci`: environment timeout
- `idf.py`: unavailable

The repository is now prepared for the next agent to install required toolchains and perform clean builds, followed by physical commissioning. The pin map must not be altered to accommodate source behavior.


## Complex + ESP32 Onboarding

Implemented in current repository:
- `src/app/onboarding-complex.tsx` provides the five-step Complex → ESP32 discovery → identity verification → binding → inventory/capability readiness flow.
- `src/lib/api/esp32-client.ts` exposes canonical capability discovery.
- `src/lib/api/python-client.ts`, `src/lib/services.ts`, and `backend/server.py` persist a one-controller-per-Complex binding with duplicate-device protection.
- `docs/COMPLEX_ESP32_ONBOARDING.md` documents the workflow and authority boundaries.
- `/onboarding/complex` is registered in `src/App.tsx`; the Complex page routes both new and existing Complex setup to the wizard.
- “Complex Ready” means onboarding/controller/inventory/capability readiness only; physical commissioning remains a separate hardware gate.
