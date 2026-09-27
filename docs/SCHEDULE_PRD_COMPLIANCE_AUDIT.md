# SCHEDULE PRD COMPLIANCE AUDIT & ARCHITECTURE SPECIFICATION
**Document Status:** Canonical Technical Audit & Architecture Document  
**Target:** Watering, Fertigation & Fan Maintenance Schedules When Peripherals Are Absent  
**Authority:** `PRODUCT_REQUIREMENTS_DOCUMENT.md` (Sections 7.2, 33E.5, 33F), `System Topology Pool Architecture`, `contracts/UI_ESP32_OPENAPI.yaml`  
**Safe Point:** `SP-SCHEDULE-PRD-COMPLIANCE-001`  
**Date:** `2026-09-21`

---

## 1. Executive Summary

This forensic audit and implementation review evaluated whether the AgroTech Greenhouse Controller system correctly implements the canonical PRD requirement governing schedules created before required physical peripherals or routes are installed.

### Canonical PRD Mandate (Sections 7.2 & 33E.5)
> *"A schedule may be CREATED and STORED even when the required physical peripheral/route is not currently installed, assigned, connected, or available, provided the PRD allows that schedule type to exist in such a state.*  
> *However: A schedule that is not currently executable must NOT be treated as ACTIVE/executable merely because it exists in storage.*  
> *The implementation must distinguish: **SCHEDULE EXISTS** vs **SCHEDULE IS VALID** vs **SCHEDULE IS EXECUTABLE** vs **SCHEDULE IS DEPLOYED** vs **SCHEDULE IS CURRENTLY RUNNABLE**."*

### Final Compliance Verdict: **PASS (FULLY COMPLIANT)**
- Schedules can be created, saved, edited, and deleted without requiring fake/mocked peripherals.
- Schedules without assigned peripherals persist reliably in operational SQLite storage and are reflected in ESP32 configuration candidates.
- Stored schedules receive the explicit status **`BLOCKED`** with human-readable diagnostic reasons (e.g. `MISSING_FAN`, `MISSING_MIXING_TANK`, `MISSING_DELIVERY_PUMP`, `MISSING_WELL_PUMP`).
- Blocked schedules are **strictly excluded** from the compiled execution array sent to the ESP32 runtime scheduler, and omitted from the active Queue and Timeline.
- When hardware is dynamically assigned later, existing schedules revalidate automatically to **`ACTIVE`** without operator re-entry. If hardware is later unassigned, schedules safely transition back to **`BLOCKED`** without data loss.

---

## 2. Schedule State Model & Lifecycle

The system enforces five mutually distinct operational states rather than collapsing schedule behavior into a naive `enabled: boolean`:

```text
USER CONFIGURES SCHEDULE
        ↓
    EXISTS (Stored in operational SQLite / backend)
        ↓
    VALID? (Schema, syntax, and relationship rules satisfied)
        │
    ┌───┴──────────────────────────────┐
   YES                                 NO
    │                                   │
    ▼                                   ▼
ARE REQUIRED RESOURCES ASSIGNED?     INVALID (Validation error shown)
    │
    ├─── NO ──────────────────────────┐
    │                                 │
   YES                                ▼
    │                              BLOCKED (Stored & preserved;
    ▼                                       explicit blocked reason;
 EXECUTABLE (Compiled into                  omitted from ESP32 scheduler)
             ESP32 schedule payload)          │
    │                                         │ Peripheral assigned later
    ▼                                         └───────────────┐
 DEPLOYED (Committed to ESP32 NVS)                            │
    │                                                         │
    ▼                                                         ▼
RUNNABLE (Clock, sensor trigger, & interlocks satisfied)  REVALIDATE
```

### State Definitions
| State | Definition | Storage Presence | ESP32 Scheduler Presence |
|---|---|---|---|
| **`DRAFT`** | Candidate schedule under active configuration in the UI drawer prior to submission. | Browser memory only | No |
| **`BLOCKED`** | Schedule configuration is syntactically valid and permanently stored, but the required physical actuator, sensor, or plumbing route is unassigned or absent. | Operational DB & Context | **Omitted (Never run)** |
| **`INVALID`** | Schedule parameters violate boundary conditions (e.g. fan ON threshold <= OFF threshold; negative dosing). | Not saved | No |
| **`DISABLED`** | Valid schedule explicitly turned off by the operator via the UI toggle switch. | Operational DB & ESP32 | Omitted or inactive |
| **`ACTIVE`** | All required peripherals are assigned; compiled and deployed to ESP32 runtime scheduler; ready for trigger evaluation. | Operational DB & ESP32 NVS | **Included & Executable** |

---

## 3. Storage Ownership Matrix

To prevent data loss and ensure system authority is preserved, each schedule attribute has a single canonical owner and defined persistence boundaries:

```text
   [ OPERATOR / UI ]
          │ (CRUD via React forms & Drawers)
          ▼
 [ OPERATIONAL BACKEND ] (Authoritative Operational Mirror: SQLite)
          │  - Owns candidate storage & intent normalization
          │  - Compiles candidate schedule set
          ▼
 [ ESP32 RUNTIME / NVS ] (Physical Operational Authority)
          │  - Persists compiled schedule table in NVS
          │  - Evaluates real-time clock & safety interlocks
          ▼
 [ ACTUATORS / RELAYS ]
```

| Field / Concept | Type | Owner | Persistence Layer | Validation Authority | Runtime Consumer |
|---|---|---|---|---|---|
| `id` | `string` (UUID) | Backend | Operational SQLite | Backend / ESP32 | UI & Scheduler |
| `ghId` / `complexId` | `string` | System Topology | Operational SQLite | Topology Service | Dispatcher |
| `name` / `task` | `string` | Operator | Operational SQLite | UI & Services | Display / Logs |
| `time` / `trigger` | `string` / `TriggerSpec` | Operator | Operational SQLite & ESP32 | UI, Compiler | ESP32 RTC Scheduler |
| `durationMin` / `durationSec` | `number` | Operator | Operational SQLite & ESP32 | Schema validator | Safety Watchdog |
| `activationState` | `ScheduleActivationState` | Topology Resolver | Derived dynamically | Topology Service / Compiler | UI Status & Scheduler |
| `blockedReasons` | `ScheduleBlockedReason[]` | Topology Resolver | Derived dynamically | Topology Service | UI Warning Badges |
| `enabled` | `boolean` | Operator | Operational SQLite & ESP32 | User toggle | ESP32 Runtime Filter |

---

## 4. Resource-Absence Test Suite & Verification Results

A comprehensive four-case automated test suite was developed in [test_schedule_prd_lifecycle.py](file:///c:/Users/rumah/Downloads/UI-template-chatgpt-network-onboarding-final/scripts/test_schedule_prd_lifecycle.py) and executed against live services:

### Case A: Peripheral Absent
- **Precondition:** Greenhouse `gh-01` contains no fan actuator in its assigned topology.
- **Action:** Created Fan schedule (`time: 07:00`, `durationMin: 30`, `enabled: true`).
- **Result:**
  - Schedule successfully saved with ID `sched-test-case-a-001`.
  - Assigned status: `BLOCKED`.
  - Diagnostic reason: `MISSING_FAN` ("No fan resource is assigned to 'gh-01'.").
  - ESP32 compiled schedules array: `0` schedules deployed.
  - Survived backend reboot and storage reload.

### Case B: Peripheral Assigned Later (Revalidation)
- **Action:** Dynamically registered fan component `COMP-FAN-01` on GPIO 21 and assigned to `gh-01` via System Topology Pool. Re-compiled schedule set.
- **Result:**
  - Existing stored schedule revalidated automatically without operator intervention.
  - Status transitioned to `ACTIVE`.
  - Blocked reasons cleared (`[]`).
  - ESP32 compiled schedules array: `1` schedule deployed (`action: FAN_TOGGLE`, `durationSec: 1800`).

### Case C: Peripheral Removed / Unassigned
- **Action:** Unassigned fan peripheral from `gh-01`. Re-compiled schedule set.
- **Result:**
  - Schedule remained intact in storage (NOT deleted).
  - Status safely transitioned back to `BLOCKED`.
  - ESP32 compiled schedules array returned to `0`.
  - Runtime scheduler will not execute unrouted commands.

### Case D: Schedule Deletion & Cycle-Reset Safety
- **Action:** Deleted schedule and verified database integrity.
- **Result:**
  - Schedule cleanly removed from operational SQLite.
  - Zero collateral deletion of Complex or Greenhouse records.
  - Research tables (`crop_cycles`, `plants`, `fruits`, `observations`) remained quarantined at 0 records affected.

---

## 5. Real Headed Browser UI Acceptance

A full end-to-end browser acceptance script ([run_schedule_prd_acceptance.mjs](file:///c:/Users/rumah/Downloads/UI-template-chatgpt-network-onboarding-final/scripts/run_schedule_prd_acceptance.mjs)) was executed using Playwright in a real headed Chrome browser:

1. **Schedule Creation (No Peripheral):** User entered start time `09:15` in the Add Fan Schedule drawer and clicked "Create Schedule".
2. **Visual Blocked Indication:** Table displayed row with start time `09:15`, amber status pill `Blocked (No Hardware)` with a pulsing indicator dot, and an inline warning alert:  
   `⚠ No fan resource is assigned to 'gh-01'.`
3. **Exclusion From Queue & Timeline:** Blocked schedule was filtered out of Today's Timeline and Execution Queue.
4. **Schedule Editing:** Drawer opened with existing values pre-populated; updated time to `10:00` and saved successfully.
5. **Browser Refresh Test:** Page reload rehydrated the schedule from the operational backend; status remained `Blocked (No Hardware)`.
6. **Browser Storage Loss Test:** Executed `localStorage.clear()` and `sessionStorage.clear()`, then reloaded. Authoritative operational state rehydrated from backend SQLite store with zero data loss.
7. **Schedule Deletion:** Triggered delete action; `ConfirmDialog` safely prevented accidental click; confirmed deletion and verified row removal.
8. **Direct Route Navigation:** Direct deep linking to `/schedule?complex=complex-01&gh=gh-01` rendered cleanly without state corruption or white-screen errors.

---

## 6. Root Causes Discovered and Fixed

| Bug ID | Component | Root Cause | Fix Applied |
|---|---|---|---|
| **BUG-01** | `src/lib/services.ts` | `deployCompiledScheduleSet` threw `ServiceError("CONFLICT")` when a schedule was blocked, forcing the UI to rollback and delete the schedule. | Removed the throw; allowed `BLOCKED` schedules to persist in SQLite while omitting them from the compiled array deployed to the ESP32. |
| **BUG-02** | `backend/server.py` | Headless schedule compiler expected wire-level intents (`action`, `trigger`, `parameters`) but received raw operational schedules (`time`, `durationMin`). | Implemented `_to_schedule_intent` helper to convert stored operational schedules into valid compiler intents. |
| **BUG-03** | `src/components/ui/overlay.tsx` | Closed drawers remained in DOM without the `invisible` class, causing pointer events to hit inactive elements. | Added `invisible` class to inactive drawer container when `!open`. |
| **BUG-04** | `src/app/schedule/page.tsx` | Table rows lacked support for `activationState` and `blockedReasons`, collapsing non-executable schedules into regular scheduled items. | Added amber status pill for `"blocked"` and rendered inline blocked reason badges. |
| **BUG-05** | `src/lib/services.ts` & `backend/server.py` | Schedules with interval and seconds duration (`durationSeconds`, `intervalMinutes`) evaluated `durationMin * 60` to `NaN` in `wellPumpIntent`, causing HTTP 422 compiler rejection. | Resolved `durationSeconds` first and supported `intervalMinutes` in trigger generation across frontend and backend. |
| **BUG-06** | `src/components/schedule/AddWellPumpDrawer.tsx` | Edit mode called `initial.repeat.includes(",")` when `repeat` was undefined, crashing drawer React rendering. | Defaulted `initial.repeat` to `"Every Day"` and guarded `durationMin` and `time`. Also added defensive fallback to `AddFertigationDrawer.tsx`. |
| **BUG-07** | `src/app/schedule/page.tsx` | `a.time.localeCompare(b.time)` threw TypeError when sorting schedules with undefined time. | Updated comparator to `(a.time ?? "").localeCompare(b.time ?? "")`. |

---

## 7. Hardware Limitations & Safe Handover Notes

1. **Physical ESP32 NVS Persistence:**  
   In the development environment without a physical USB-connected ESP32 board, operational persistence is authoritatively maintained in the backend SQLite store (`backend/agrotech_operational.sqlite3`) and synchronized to the ESP32 simulator/mock client. When connected to physical hardware, schedules are deployed over HTTP to the ESP32 endpoint `/api/v1/schedules/deploy` which commits the compiled array to NVS partition.
2. **Research Data Quarantine:**  
   Research data tables (`crop_cycles`, `plants`, `fruits`, `observations`) are stored in `agrotech_research.sqlite3` and are isolated from schedule lifecycle operations.
