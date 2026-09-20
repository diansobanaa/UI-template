# AGENT TASK — Implement Safe Complex Deletion Across SQLite Databases

## Mission

Implement a production-safe **Delete Complex** workflow in the current AgroTech codebase.

This is an implementation task. Do not stop at analysis or documentation. Modify the code, firmware, API contracts, UI, tests, and canonical documentation as required, then verify the complete flow end-to-end.

## Critical business rule

> **RESEARCH DATA MUST NEVER BE DELETED, MUTATED, NULLIFIED, OR CASCADED AS PART OF COMPLEX DELETION.**

The research database is intentionally retained when a Complex is deleted.

The following research tables must remain untouched by this feature:

- `crop_cycles`
- `plants`
- `fruits`
- `observations`

Do not add cascade deletion to these records.
Do not rewrite their `complex_id` / `gh_id` references to NULL.
Do not “clean up orphaned research rows”.
Do not add any new research purge endpoint.
Existing single-observation deletion behavior may remain unchanged.

Research data is historical research data and has a separate retention policy.

---

# 1. Current codebase facts to preserve

The current repository already contains these SQLite stores:

### Operational DB

File: `backend/operational_store.py`

Current tables:

```text
complexes
  id TEXT PRIMARY KEY
  payload TEXT NOT NULL

greenhouses
  id TEXT PRIMARY KEY
  complex_id TEXT NOT NULL
  payload TEXT NOT NULL
```

Important: schedules and other operational configuration are embedded inside the JSON `payload` objects stored in these rows. Deleting a GH/Complex row therefore removes the embedded operational configuration with that row.

### History DB

File: `backend/history_store.py`

Current tables:

```text
raw_records
telemetry_samples
  FK raw_records(record_id)
events
  FK raw_records(record_id)
```

The history store is Complex-scoped through `complex_id` and GH-scoped through `gh_id` where applicable.

### Recovery DB

File: `backend/recovery_store.py`

Current tables:

```text
sync_state
  PRIMARY KEY (complex_id, device_id)

deployment_state
  PRIMARY KEY (complex_id)
```

These are operational synchronization/deployment records and are eligible for purge when the Complex is deleted.

### Calibration DB

File: `backend/sensor_calibration.py`

Current tables:

```text
sensor_definitions
  sensor_id PRIMARY KEY
  definition_json contains complexId

calibration_records
  calibration_id PRIMARY KEY
  complex_id NOT NULL
```

Calibration records are Complex-scoped and must be purged.

### Fertigation DB

File: `backend/fertigation_engine.py`

Current table:

```text
fertigation_runs
  run_id PRIMARY KEY
  complex_id
  gh_id
  run_json
```

Fertigation run history is operational/history data for this feature and must be purged with the Complex.

### Research DB — RETAIN

File: `backend/research_store.py`

Current tables:

```text
crop_cycles
plants
fruits
observations
```

**DO NOT DELETE ANY OF THESE RECORDS.**

---

# 2. Current API/firmware gap

There is currently no Complex DELETE endpoint.

`backend/server.py` currently supports DELETE for:

- individual research observations
- schedules

but not `DELETE /api/complexes/{complexId}`.

Complex binding currently exists through:

```text
POST /api/complexes/{complexId}/controller/bind
```

and on ESP32:

```text
POST /api/v1/device/bind
```

The ESP32 currently persists the Complex binding in NVS through:

```text
storage_mgr_bind_complex()
```

and explicitly refuses replacement of a different existing binding.

Therefore deletion cannot be implemented safely as a backend-only SQL DELETE.

---

# 3. Required architecture

Implement a durable deletion orchestration layer using a dedicated system SQLite database.

Recommended new environment variable:

```text
AGROTECH_SYSTEM_DB
```

Recommended default:

```text
./agrotech_system.sqlite3
```

Recommended new module split:

```text
backend/deletion_store.py
backend/deletion_manager.py
```

Names may be adjusted if the existing architecture has a cleaner equivalent, but the responsibilities below must exist.

The system DB must survive deletion of the Complex itself.

It becomes the source of truth for deletion progress.

---

# 4. Deletion job data model

Create the following tables in the system DB.

## 4.1 `deletion_jobs`

Required logical fields:

```sql
CREATE TABLE IF NOT EXISTS deletion_jobs (
    job_id TEXT PRIMARY KEY,
    complex_id TEXT NOT NULL,
    device_id TEXT,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    current_step_no INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL UNIQUE,
    requested_by TEXT,
    request_reason TEXT,
    scope_snapshot_json TEXT,
    scope_hash TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    requested_at TEXT NOT NULL,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    version INTEGER NOT NULL DEFAULT 1
);
```

Allowed job statuses:

```text
REQUESTED
PREFLIGHTING
WAITING_DEVICE
LOCKED
RETIRING_DEVICE
PURGING
VERIFYING
COMPLETED
FAILED_RETRYABLE
FAILED_TERMINAL
CANCELLED
```

Create a partial unique index so one Complex cannot have multiple active deletion jobs simultaneously.

Active states:

```text
REQUESTED
PREFLIGHTING
WAITING_DEVICE
LOCKED
RETIRING_DEVICE
PURGING
VERIFYING
FAILED_RETRYABLE
```

## 4.2 `deletion_job_steps`

Required logical fields:

```sql
CREATE TABLE IF NOT EXISTS deletion_job_steps (
    step_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    sequence_no INTEGER NOT NULL,
    step_key TEXT NOT NULL,
    database_key TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    rows_expected INTEGER,
    rows_affected INTEGER,
    checkpoint_json TEXT,
    verification_json TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    started_at TEXT,
    heartbeat_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES deletion_jobs(job_id) ON DELETE CASCADE,
    UNIQUE(job_id, sequence_no),
    UNIQUE(job_id, step_key)
);
```

Allowed step statuses:

```text
PENDING
RUNNING
SUCCEEDED
SKIPPED
FAILED_RETRYABLE
FAILED_TERMINAL
```

## 4.3 `deletion_job_events`

Required for durable audit history:

```sql
CREATE TABLE IF NOT EXISTS deletion_job_events (
    event_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    step_id TEXT,
    actor TEXT,
    message TEXT,
    detail_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES deletion_jobs(job_id) ON DELETE CASCADE
);
```

Every state transition and meaningful failure/retry must produce an event.

---

# 5. Required deletion state machine

Implement exactly this logical flow:

```text
REQUESTED
   |
   v
PREFLIGHTING
   |
   +---- terminal validation failure ----> FAILED_TERMINAL
   |
   +---- bound controller unreachable ----> WAITING_DEVICE
   |
   v
LOCKED
   |
   v
RETIRING_DEVICE
   |
   +---- retryable communication/storage failure ----> FAILED_RETRYABLE
   |
   v
PURGING
   |
   +---- retryable DB failure ------------------------> FAILED_RETRYABLE
   |
   +---- terminal integrity/schema failure -----------> FAILED_TERMINAL
   |
   v
VERIFYING
   |
   +---- retryable verification/storage failure ------> FAILED_RETRYABLE
   |
   +---- integrity failure ---------------------------> FAILED_TERMINAL
   |
   v
COMPLETED
```

`CANCELLED` is allowed only before destructive purge has started.

Once any destructive purge step succeeds, do not implement a fake “cancel” that claims the data can be restored.

---

# 6. Preflight requirements

Before locking or deleting anything, collect a deterministic scope snapshot.

At minimum capture:

```text
complexId
deviceId (if bound)
complex exists?
greenhouse IDs/count
operational rows/counts
history rows/counts
recovery rows/counts
calibration rows/counts
fertigation run rows/counts
research rows/counts — informational only, NEVER deletion targets
```

The snapshot is stored in `scope_snapshot_json` and a canonical JSON SHA-256 in `scope_hash`.

The preflight must also detect whether the Complex has a bound ESP32.

### No controller

Continue directly to LOCKED.

### Controller bound and reachable

Continue to LOCKED, then RETIRING_DEVICE.

### Controller bound but unreachable

Do **not** delete the backend Complex.
Do not purge any SQLite database.
Move job to:

```text
WAITING_DEVICE
```

There must be no hidden “delete anyway” behavior.

Do not invent a bypass/factory-reset override unless explicitly required elsewhere in the product specification.

---

# 7. Lock semantics

When the job enters `LOCKED`, the Complex becomes deletion-protected.

All mutation paths for the Complex and its operational children must reject writes while deletion is active.

This includes at minimum:

```text
Complex update
Complex controller bind
Greenhouse create/update
Schedule create/update/delete
ESP32 configuration deployment
Resource changes that are Complex-scoped
Calibration mutations
Fertigation operational mutations
```

Use a consistent API error such as:

```json
{
  "error": {
    "code": "COMPLEX_DELETION_IN_PROGRESS",
    "message": "Complex deletion is in progress."
  }
}
```

Do not rely only on the frontend for this lock. The backend must enforce it.

---

# 8. ESP32 retirement contract

Add a dedicated controller retirement operation. Do not overload `/emergency-stop` as the complete delete mechanism.

Recommended endpoint:

```text
POST /api/v1/device/retire
```

The exact HTTP method/path may be adapted to the existing API conventions, but there must be a dedicated idempotent retirement endpoint.

Request must carry enough identity to prevent deleting the wrong Complex, e.g.:

```json
{
  "requestId": "...",
  "jobId": "...",
  "deviceId": "...",
  "complexId": "..."
}
```

The ESP32 must verify that the requested `deviceId` and `complexId` match its current state.

### Retirement sequence on ESP32

The controller must move into a safe state before removing the binding:

```text
STOP AUTONOMOUS SCHEDULER
        |
CANCEL ACTIVE FERTIGATION
        |
FORCE ALL ACTUATORS OFF / SAFE
        |
CLEAR ACTIVE RUNTIME EXECUTION STATE
        |
CLEAR RECOVERY-HOLD / ACTIVE FERTIGATION RECOVERY
        |
CLEAR CANDIDATE CONFIGURATION
        |
CLEAR ACTIVE CONFIGURATION
        |
CLEAR PREVIOUS CONFIGURATION
        |
CLEAR DEPLOYMENT METADATA
        |
CLEAR LOCAL COMPLEX-SCOPED EVENT/TELEMETRY/FERTIGATION LOGS
        |
CLEAR SYNC CURSORS FOR THE RETIRED COMPLEX
        |
CLEAR COMPLEX BINDING
        |
RETURN RETIRED/UNBOUND ACK
```

Preserve device identity and networking identity:

```text
KEEP
- device_id
- firmware identity/version
- hardware identity
- Wi-Fi/network credentials
- hostname/network configuration
```

Do not factory-reset networking merely because the Complex is deleted.

After retirement the device must report:

```json
{
  "deviceId": "...",
  "complexId": null,
  "bindingState": "UNBOUND"
}
```

### Important existing ESP32 storage facts

The current firmware stores these Complex/deployment-related values in NVS:

```text
cplx_id
lvc_json
prev_json
cand_json
cfg_ver
cfg_crc
cfg_hash
prev_ver
prev_crc
prev_hash
cand_ver
cand_crc
cand_hash
dep_id
cand_dep
dep_status
```

The agent must inspect the current implementation and clear the correct keys atomically, rather than blindly formatting NVS.

Current local durable files include:

```text
/sdcard/events.log
/spiffs/events.log
/sdcard/telemetry.jsonl
/spiffs/telemetry.jsonl
/sdcard/fertigation_runs.jsonl
/spiffs/fertigation_runs.jsonl
```

The existing storage API currently exposes event-log clearing, but telemetry/fertigation clearing may need to be added. Implement only what is needed, safely and atomically.

Do not erase `/spiffs/components.json` or hardware identity data merely because the Complex is deleted.

---

# 9. Backend purge order

The Complex root must be deleted **last**.

Use this logical step order:

```text
10  PREFLIGHT
20  LOCK_COMPLEX
30  RETIRE_DEVICE
40  PURGE_OPERATIONAL_CHILDREN
50  PURGE_HISTORY
60  PURGE_CALIBRATION
70  PURGE_FERTIGATION_RUNS
80  PURGE_RECOVERY
90  VERIFY_ALL
100 DELETE_COMPLEX_ROOT
110 FINALIZE
```

Step numbers can be represented as rows in `deletion_job_steps`.

## 9.1 Operational DB

Target:

```text
backend/operational_store.py
```

Delete only the selected Complex's operational children and GH rows.

Because schedules/configuration are inside payload JSON, remove the GH/Complex operational rows only after the deletion job has acquired its lock and the ESP32 has been retired (when applicable).

Delete GH rows first.
Then delete the Complex root.

Never delete another Complex.

## 9.2 History DB

Target:

```text
backend/history_store.py
```

Delete only rows belonging to the target Complex:

```text
telemetry_samples.complex_id = target
telemetry_samples.gh_id = target GHs where applicable
events.complex_id = target
raw_records.complex_id = target
```

Respect the `raw_records` foreign-key dependency.

Because `telemetry_samples` and `events` reference `raw_records`, use a transaction and delete child projections before their raw parent rows, then verify zero remaining target rows.

Do not use a blind `VACUUM` as a substitute for logical verification.

## 9.3 Calibration DB

Target:

```text
backend/sensor_calibration.py
```

Delete Complex-scoped:

```text
calibration_records.complex_id = target
```

For `sensor_definitions`, the Complex association is stored inside `definition_json`, so inspect current repository behavior and delete only definitions whose decoded `complexId` matches the target.

Do not delete globally shared sensor definitions that are not actually assigned to the target Complex.

## 9.4 Fertigation DB

Target:

```text
backend/fertigation_engine.py
```

Delete:

```text
fertigation_runs.complex_id = target
```

Before purge, ensure no active runtime operation remains on the ESP32.

## 9.5 Recovery DB

Target:

```text
backend/recovery_store.py
```

Delete:

```text
sync_state WHERE complex_id = target
deployment_state WHERE complex_id = target
```

Do not delete recovery records for other Complexes or other devices.

---

# 10. RESEARCH DB — explicit no-touch rule

Do not add a deletion step for:

```text
backend/research_store.py
```

Do not call research deletion methods from the Complex deletion manager.

Do not add:

```text
DELETE FROM crop_cycles ...
DELETE FROM plants ...
DELETE FROM fruits ...
DELETE FROM observations ...
```

Do not add FK cascades that cause these records to disappear indirectly.

Do not convert historical research records into “deleted” records.

After Complex deletion, it is acceptable for research rows to continue carrying the original `complex_id` / `gh_id` values. This is intentional retention behavior.

The implementation should add tests that prove research row counts are identical before and after Complex deletion.

---

# 11. Cross-database transaction model

SQLite does not provide the distributed transaction guarantees needed here across independent database files.

Therefore implement a durable step/saga model:

```text
SYSTEM DB
  mark step RUNNING
      |
      v
TARGET DB
  BEGIN IMMEDIATE / transaction
      |
      delete target rows
      |
      verify target rows = 0
      |
      COMMIT
      |
      v
SYSTEM DB
  mark step SUCCEEDED
```

Never mark a step `SUCCEEDED` before its target DB transaction has committed.

If the Python process crashes after the target DB commit but before the system DB status update, recovery must detect that the target is already clean and mark the step succeeded idempotently.

If the target DB transaction rolls back, leave the step retryable.

Use sensible SQLite concurrency protections:

```text
PRAGMA foreign_keys = ON
busy_timeout
short transactions
thread-safe access consistent with existing store patterns
```

Do not hold multiple SQLite database transactions open simultaneously.

---

# 12. Retry and recovery

The deletion manager must resume unfinished jobs after backend restart.

On startup:

```text
load active deletion jobs
find RUNNING/FAILED_RETRYABLE steps
inspect target DB state
reconcile step state
resume safely
```

Retryable examples:

```text
ESP32 timeout
connection reset
SQLite busy/locked
temporary I/O error
backend restart
```

Terminal examples:

```text
schema mismatch
unexpected integrity failure
invalid deletion target
corrupt scope
wrong device identity
```

Make operations idempotent.

A repeated DELETE request with the same idempotency key must return the existing job rather than creating a second deletion pipeline.

Repeated ESP32 retirement requests for the same job must return an `ALREADY_RETIRED`/equivalent successful response when the controller is already unbound.

---

# 13. Verification phase

`VERIFY_ALL` is mandatory.

At minimum verify:

```text
Operational:
  target Complex row = 0
  target GH rows = 0

History:
  target raw_records = 0
  target telemetry_samples = 0
  target events = 0

Calibration:
  target calibration_records = 0
  target assigned sensor definitions = 0

Fertigation:
  target fertigation_runs = 0

Recovery:
  target sync_state = 0
  target deployment_state = 0

Research:
  row counts unchanged
  existing research IDs still exist

ESP32:
  complexId = null
  scheduler not executing old Complex configuration
  active fertigation = idle/none
  actuators safe/off
  old Complex configuration absent
```

Do not claim `COMPLETED` unless all applicable checks pass.

---

# 14. API design

Implement a Complex deletion API consistent with the current backend style.

Recommended endpoints:

```text
GET    /api/complexes/{complexId}/deletion-preview
DELETE /api/complexes/{complexId}
GET    /api/deletion-jobs/{jobId}
```

The exact paths may be adapted if the project has a better existing convention, but the following behaviors are required:

### Preview

Must be read-only and include:

```text
complex identity
bound device identity/state
greenhouse count
operational/history/calibration/fertigation counts
research count as RETAINED / NOT DELETED
blocking conditions
```

### DELETE

Must:

1. validate target
2. require explicit confirmation appropriate for destructive deletion
3. accept an idempotency key
4. create or resume a deletion job
5. return job state/progress

For a long-running deletion, HTTP 202 is appropriate.

Do not return success merely because the deletion job was created; distinguish:

```text
job accepted
```
from:

```text
deletion completed
```

---

# 15. Frontend implementation

Update the frontend service layer first.

Current relevant files:

```text
src/lib/services.ts
src/lib/api/python-client.ts
src/lib/operational-state.ts
src/app/complex/page.tsx
```

Add service/client methods for:

```text
getComplexDeletionPreview()
deleteComplex()
getDeletionJob()
```

The UI must not mutate local operational state as if deletion has succeeded before backend confirmation.

Required UX behavior:

```text
Delete Complex
   |
   v
Preflight summary
   |
   +-- controller offline --> show blocking reason
   |
   +-- controller online --> show retirement + purge plan
   |
   v
Explicit confirmation
   |
   v
Progress state
   |
   v
Completed
   |
   +--> refresh operational snapshot
   +--> remove deleted Complex from client state
   +--> redirect away from deleted Complex route
```

If deletion fails:

```text
keep Complex visible
show failed stage/reason
allow retry
```

Do not optimistically remove the Complex from the sidebar before `COMPLETED`.

If the user currently has:

```text
/complex?complex=<deleted-id>
```

then after successful completion redirect to `/complex` or the first remaining valid Complex context.

---

# 16. Backend mutation lock coverage

The agent must inspect **all** paths that can mutate Complex-owned operational data.

Do not assume only `POST /complexes/{id}` matters.

At minimum audit:

```text
POST /api/complexes
POST /api/complexes/{id}
POST /api/complexes/{id}/greenhouses
POST /api/greenhouses/{id}
POST /api/complexes/{id}/schedules
POST /api/schedules/{id}
DELETE /api/schedules/{id}
POST /api/complexes/{id}/controller/bind
PUT /api/complexes/{id}/esp32/configuration
POST /api/complexes/{id}/compile
POST /api/complexes/{id}/deploy
POST /api/complexes/{id}/calibrations
POST /api/complexes/{id}/fertigation/*
POST /api/complexes/{id}/resources/*
```

Lock only the target Complex; other Complexes must remain operational.

---

# 17. Safety requirements for the ESP32

Deletion is an operational safety transition.

Do not simply clear `cplx_id` first.

Correct order:

```text
stop autonomous execution
→ stop/abort active fertigation
→ force actuators safe/off
→ clear runtime/recovery/config state
→ clear local Complex-scoped logs/sync state
→ clear binding
```

The controller must never be able to reboot after deletion and resume the deleted Complex using the old persisted LVC.

This is one of the primary acceptance criteria.

---

# 18. Test matrix

Add automated tests for all cases below.

## A. No-device Complex

```text
create Complex
create GHs/schedules
populate operational/history/calibration/fertigation
populate research
DELETE

assert operational target rows = 0
assert history target rows = 0
assert calibration target rows = 0
assert fertigation target rows = 0
assert recovery target rows = 0
assert research counts unchanged
```

## B. Online ESP32 idle

```text
bind controller
DELETE
assert retire succeeds
assert ESP32 complexId is null
assert old config is gone
assert controller identity/network remain
assert backend purge completes
```

## C. Online ESP32 during fertigation

```text
start fertigation
DELETE
assert safe stop
assert no actuator remains active
assert retirement completes
assert purge completes
```

## D. Offline ESP32

```text
bind controller
make controller unreachable
DELETE
assert job = WAITING_DEVICE
assert NO database purge occurred
assert Complex still exists
```

## E. Duplicate DELETE

```text
send same idempotency key twice
assert one job only
```

## F. Backend crash / restart

Inject failure between:

```text
TARGET_DB COMMIT
```

and:

```text
SYSTEM_DB STEP SUCCEEDED
```

Restart backend.

Assert reconciliation detects already-clean target and continues safely.

## G. SQLite busy / retry

Force a temporary lock.

Assert:

```text
FAILED_RETRYABLE
```

then successful retry.

## H. Research retention

Before delete record IDs/counts from:

```text
crop_cycles
plants
fruits
observations
```

After delete assert every selected research row still exists unchanged.

This test is mandatory.

## I. Multi-Complex isolation

Create Complex A + B.

Delete A.

Assert B's:

```text
operational data
history
calibration
fertigation
recovery
ESP32 binding
```

remain unchanged.

## J. Rebind after deletion

Retired ESP32 must be able to bind to a new Complex without factory reset.

---

# 19. Documentation requirements

This repository has a mandatory canonical documentation rule.

After implementation, update relevant files under:

```text
docs/
```

At minimum inspect/update the appropriate existing documents for:

```text
Complex ↔ ESP32 lifecycle/binding
API contract
operational lifecycle/deletion behavior
ESP32 configuration/recovery behavior
```

Also update:

```text
AI_PROGRESS.md
AI_HANDOVER.md
```

Do not create duplicate firmware docs under `esp32/docs/` solely to mirror canonical documentation.

The new deletion behavior must be documented as an actual implemented capability, not merely planned behavior.

---

# 20. API contract/documentation synchronization

Because this feature adds a new ESP32 endpoint and backend API endpoints, update the canonical API definitions.

Inspect and update as appropriate:

```text
contracts/UI_ESP32_OPENAPI.yaml
docs/...
UI_ESP32_COMMUNICATION_SPEC.md
```

Ensure request/response examples match implementation exactly.

---

# 21. Implementation constraints

1. Do not replace the current storage architecture with a new ORM.
2. Do not add PostgreSQL/MySQL/etc. as a prerequisite.
3. Use the existing SQLite architecture.
4. Do not introduce distributed transactions across SQLite files.
5. Do not delete research data.
6. Do not factory-reset ESP32 networking.
7. Do not allow an offline bound ESP32 to silently continue as if deletion completed.
8. Do not use frontend optimistic deletion as the source of truth.
9. Do not mark a deletion job `COMPLETED` before verification.
10. Preserve unrelated Complexes and their data.
11. Preserve the ESP32 device identity so it can be rebound later.
12. Make deletion/retry operations idempotent.
13. Keep the existing API error style where practical.
14. Prefer small, testable methods in stores and managers over one giant `server.py` deletion handler.

---

# 22. Expected implementation shape

A clean implementation will likely resemble:

```text
backend/
  deletion_store.py
  deletion_manager.py
  operational_store.py        # add scoped deletion helpers
  history_store.py            # add scoped purge + verification
  recovery_store.py           # add scoped purge + verification
  sensor_calibration.py       # add scoped purge + verification
  fertigation_engine.py       # add scoped purge + verification
  server.py                   # API orchestration only

src/lib/
  api/python-client.ts
  services.ts
  operational-state.ts

src/app/complex/
  page.tsx
  ... deletion UI components as appropriate

esp32/main/
  http/api_device_handlers.c
  http/http_server.c
  storage/storage_mgr.c
  storage/storage_mgr.h
  services/...                 # only where required for safe retirement

contracts/
  UI_ESP32_OPENAPI.yaml

docs/
  relevant canonical docs
```

Do not force this exact file split if the repository already contains a cleaner abstraction; preserve the architectural intent.

---

# 23. Required final verification report

Before declaring completion, provide a concise implementation report containing:

```text
Implementation status
Changed files
New API endpoints
ESP32 retirement behavior
Deletion step/state machine
SQLite tables affected
Research retention proof
Test commands executed
Test results
Known limitations
```

Also provide the deletion state transition trace for at least one successful integration test.

A task is **not complete** if only code is changed without tests and synchronized documentation.

---

# Definition of Done

The implementation is complete only when all statements below are true:

- [ ] Complex deletion exists end-to-end.
- [ ] Deletion is represented by a durable job in a dedicated system DB.
- [ ] Deletion is idempotent.
- [ ] One active deletion job per Complex is enforced.
- [ ] Bound online ESP32 is safely retired before purge.
- [ ] Bound offline ESP32 blocks purge and enters `WAITING_DEVICE`.
- [ ] ESP32 cannot reboot and resume the deleted Complex's old configuration.
- [ ] Operational DB target data is purged.
- [ ] History DB target data is purged.
- [ ] Calibration DB target data is purged.
- [ ] Fertigation DB target data is purged.
- [ ] Recovery DB target data is purged.
- [ ] Research DB is NOT modified by Complex deletion.
- [ ] Research row counts/IDs remain unchanged in automated tests.
- [ ] Other Complexes remain unaffected.
- [ ] Final verification is mandatory before `COMPLETED`.
- [ ] Backend restart can resume unfinished deletion jobs.
- [ ] Retryable DB/device failures are recoverable.
- [ ] Frontend does not optimistically delete the Complex.
- [ ] Frontend handles success, failure, waiting-for-device, and retry.
- [ ] Deleted Complex routes are reconciled.
- [ ] API contracts/documentation are synchronized.
- [ ] `AI_PROGRESS.md` and `AI_HANDOVER.md` are updated.
- [ ] Relevant canonical docs under `docs/` are updated.
- [ ] Full test suite / targeted integration tests pass.

## Final invariant

After successful deletion:

```text
Operational data for Complex        = DELETED
History data for Complex            = DELETED
Calibration data for Complex        = DELETED
Fertigation runs for Complex        = DELETED
Recovery data for Complex           = DELETED
Research data for Complex           = RETAINED
ESP32 Complex binding               = CLEARED
ESP32 old operational configuration = CLEARED
ESP32 identity/network              = RETAINED
Other Complexes                     = UNCHANGED
Deletion job                        = COMPLETED
```

This invariant is the final acceptance criterion.
