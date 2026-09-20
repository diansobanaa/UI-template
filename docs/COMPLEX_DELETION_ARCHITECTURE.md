# Complex Deletion Architecture & Lifecycle Specification

## 1. Executive Summary & Purpose
In the AgroTech Greenhouse Controller architecture, a **Complex** is the top-level operational and physical boundary grouping greenhouses, actuators, sensors, calibrations, fertigation schedules, and an ESP32-S3 microcontroller.

Deleting a Complex is a distributed, high-consequence operation spanning multiple SQLite databases and embedded firmware storage. This specification defines the production-safe **Saga-based Complex Deletion Architecture**, designed to guarantee data integrity, avoid orphaned physical hardware, and ensure absolute preservation of scientific research.

---

## 2. The Golden Invariant: Pure Research Preservation
> **RESEARCH DATA MUST NEVER BE DELETED, MUTATED, NULLIFIED, OR CASCADED AS PART OF COMPLEX DELETION.**

The research database (`agrotech_research.sqlite3`) contains irreplaceable longitudinal agronomy data:
- `crop_cycles`
- `plants`
- `fruits`
- `observations`

### Invariant Enforcement Rules:
1. `ResearchStore` provides strictly read-only scoped count inspection (`counts(complex_id)`). **Zero deletion, truncate, or update methods exist on research data for complex deletion.**
2. Complex deletion job verification (`VERIFY_ALL` step) computes a pre-deletion and post-deletion cryptographic checksum and count of research entities. If even a single research record is altered or missing, the job immediately enters `FAILED_TERMINAL` and triggers an audit alarm.
3. Research cycles retain their historic `complex_id` as an immutable provenance foreign reference for historical academic analysis even after the operational complex record is wiped.

---

## 3. Physical Controller Safety Interlock
An operational complex may have a bound ESP32-S3 controller actively controlling high-voltage pumps, dosing valves, and motorized fans.

```
       +---------------------------------------------+
       |   Operator Initiates Complex Deletion        |
       +---------------------------------------------+
                              |
                              v
       +---------------------------------------------+
       | Preflight Probe: Is Bound Device Online?     |
       +---------------------------------------------+
                 /                         \
       [ONLINE] /                           \ [OFFLINE / UNREACHABLE]
               v                             v
+-------------------------------+   +---------------------------------------+
| Invoke ESP32 POST             |   | HALT in WAITING_DEVICE                |
| /api/v1/device/retire         |   | - Return HTTP 409 / Warning to UI     |
+-------------------------------+   | - Complex locked against mutations    |
               |                    | - ZERO SQLite tables are purged       |
               v                    +---------------------------------------+
+-------------------------------+
| ESP32 Retires Atomically:     |
| 1. Clear Autonomous Scheduler |
| 2. Abort Active Fertigation   |
| 3. Actuator Emergency Stop OFF|
| 4. Clear LVC & Storage        |
| 5. Reset cplx_id to UNBOUND   |
| 6. PRESERVE Wi-Fi Credentials |
+-------------------------------+
               |
               v
+-------------------------------+
| Proceed to SQLite Data Purge  |
+-------------------------------+
```

### Safety Interlock Mandate:
- If a bound controller is offline or unreachable over the LAN, **DELETION MUST HALT** in state `WAITING_DEVICE`.
- **NO OPERATIONAL OR HISTORICAL SQLITE DATA MAY BE PURGED** while a bound controller remains unretired. This prevents leaving an active physical controller running autonomous irrigation schedules without a matching system record.

---

## 4. Multi-Database Scoped Purge Topology
AgroTech uses domain-separated SQLite databases. Deletion purges records strictly scoped by `complex_id`:

| Database | Tables Purged | Retention Policy |
| :--- | :--- | :--- |
| **System DB** (`agrotech_system.sqlite3`) | `deletion_jobs`, `deletion_job_steps`, `deletion_job_events` | Retains full audit log of deletion saga |
| **Operational DB** (`agrotech_operational.sqlite3`) | `greenhouses`, `complexes` (root record deleted last) | Purged completely for `complex_id` |
| **History DB** (`agrotech_history.sqlite3`) | `telemetry_samples`, `events`, `raw_records` | Purged completely for `complex_id` |
| **Recovery DB** (`agrotech_recovery.sqlite3`) | `sync_state`, `deployment_state` | Purged completely for `complex_id` |
| **Calibration DB** (`agrotech_calibration.sqlite3`) | `calibration_records`, `sensor_definitions` | Purged completely for `complex_id` |
| **Fertigation DB** (`agrotech_fertigation.sqlite3`) | `fertigation_runs` | Purged completely for `complex_id` |
| **Research DB** (`agrotech_research.sqlite3`) | `crop_cycles`, `plants`, `fruits`, `observations` | **100% PRESERVED / UNTOUCHED** |

---

## 5. Standard 11-Step Saga Execution Pipeline

Every deletion job executes the following sequential state machine:

```
[10: PREFLIGHT] 
  └── Verify complex existence, collect scoped counts, compute SHA-256 snapshot hash.
[20: RETIRE_DEVICE] 
  └── If bound controller present, probe LAN health and execute POST /api/v1/device/retire.
      If offline, transition to WAITING_DEVICE and suspend saga.
[30: PURGE_OPERATIONAL_GH] 
  └── Purge greenhouses associated with complex_id.
[40: PURGE_HISTORY] 
  └── Purge telemetry samples, event logs, and raw records.
[50: PURGE_CALIBRATIONS] 
  └── Purge sensor definitions and linear calibration records.
[60: PURGE_FERTIGATION] 
  └── Purge fertigation runs.
[70: PURGE_RECOVERY] 
  └── Purge sync state and deployment state records.
[80: PRESERVE_RESEARCH] 
  └── Audit verification that research record counts are 100% unchanged.
[90: VERIFY_ALL] 
  └── Cross-database integrity check confirming zero remaining records in purged stores.
[100: DELETE_COMPLEX_ROOT] 
  └── Remove root complex entry from complexes table.
[110: FINALIZE] 
  └── Transition job status to COMPLETED, record completion audit event, release locks.
```

---

## 6. Concurrency Locking & Mutation Guarding
While a complex is undergoing deletion (`REQUESTED`, `PREFLIGHTING`, `WAITING_DEVICE`, `LOCKED`, `PURGING`):
- `DELETION_MANAGER.is_complex_locked(complex_id)` returns `True`.
- Backend endpoints return HTTP 409 Conflict with code `COMPLEX_DELETION_IN_PROGRESS` on all mutations targeting that complex:
  - Configuration updates, deployments, validations
  - Device binding and unbinding
  - Schedule creations, updates, deletions
  - Manual actuator commands
  - Sensor calibrations
  - Fertigation preparation and resource transfers
- Read queries (`GET /api/complexes/{id}`, `GET /api/deletion-jobs/{id}`) remain accessible.

---

## 7. ESP32 Device Retirement Contract
The ESP32 firmware exposes an authenticated endpoint:

### `POST /api/v1/device/retire`
- **Request Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "requestId": "retire-del-12345",
    "jobId": "del-12345",
    "deviceId": "controller-01",
    "complexId": "complex-01"
  }
  ```
- **Firmware Actions**:
  1. `scheduler_clear_compiled()` — wipes active Autonomous Engine schedule.
  2. `fertigation_mgr_cancel_batch()` — safely aborts any active fertigation/dosing cycle.
  3. `actuator_hal_emergency_stop()` — forces all relays, pumps, and solenoids to safe OFF state.
  4. `storage_mgr_retire_complex(complexId)` — atomic NVS clear of LVC (Latest Valid Configuration), candidate config, previous config, and unbinds `cplx_id` to `""`.
  5. **Preserves Station (STA) Wi-Fi credentials** — controller remains connected to local Wi-Fi.
  6. Refreshes mDNS service to broadcast hostname with UNBOUND status.
- **Response**:
  ```json
  {
    "success": true,
    "status": 200,
    "data": {
      "deviceId": "controller-01",
      "retired": true,
      "unbound": true,
      "schedulesCleared": true,
      "actuatorsSafeOff": true,
      "wifiPreserved": true
    }
  }
  ```

After retirement, the ESP32 is ready for adoption by another complex without requiring a manual factory reset.

---

## 8. Frontend UX & Operator Safety Confirmation
In `src/app/complex/page.tsx`:
1. Each Complex Card features a distinct **Delete Complex** action.
2. Clicking triggers `DeleteComplexModal` which executes preflight preview (`GET /api/complexes/{id}/deletion-preview`).
3. Modal displays:
   - **Research Safety Badge**: Highlights that crop cycles, plants, fruits, and observations are permanently retained.
   - **Purge Inventory**: Exact counts of greenhouses, schedules, calibrations, runs, and telemetry about to be purged.
   - **Hardware Safety Block**: If bound device is offline, a prominent alert blocks deletion and provides controller IP / troubleshooting instructions.
   - **Code Confirmation**: Operator must type the exact complex code (e.g. `COMPLEX-01`) before the confirm button is enabled.
   - **Real-Time Step Progress**: Live tracking across the 11 saga steps with instant reconciliation upon completion.
