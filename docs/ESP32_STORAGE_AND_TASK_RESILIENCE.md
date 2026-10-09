# ESP32 Storage and Task Resilience

## Scope

This document records the bounded-storage and calibration-task safeguards for
the ESP32-S3 firmware. It does not replace the task watchdog or claim physical
hardware validation.

## Scheduler marker persistence

`marker_persist_task` is pinned to CPU 1 and remains registered with the task
watchdog. Scheduler markers are persisted to `/spiffs/sched_markers.bin` using
the following sequence:

1. Write the complete fixed-size marker snapshot to
   `/spiffs/sched_markers.bin.tmp` in bounded 512-byte VFS writes.
2. Feed the watchdog only between completed writes.
3. `fsync`, close, and atomically rename the temporary file into place.
4. Scrub the legacy NVS marker key only after the SPIFFS rename succeeds.

If any write, sync, close-stage, or rename step fails, the temporary file is
removed and the pending flag is restored. The worker is notified again, so a
failed write is not reported as persisted and marker durability is retained.
The previously committed marker file remains intact until the atomic rename.

The marker snapshot is 32 fixed entries. The current 9 MiB `storage` SPIFFS
partition is defined in `esp32/partitions.csv`. Runtime free-space,
fragmentation, and write latency still require serial/runtime observation on
the target device.

## Event sequence allocation

Actuator and calibration requests log into the bounded event ring. Event
sequence blocks are now pre-reserved during event-manager initialization on the
main task's internal stack. Runtime calibration and actuator tasks therefore do
not unexpectedly enter NVS allocation when the active sequence block expires.
Event persistence remains deferred to the existing persistence worker.

## Calibration worker stack

The `calib_mgr` worker is pinned to CPU 1. Its stack is 4096 bytes. This is a
justified correction to the prior 2560-byte tuning: the calibration OFF path
now traverses centralized actuator validation, request logging, event-ring
creation, and deferred persistence notification. The worker logs
`uxTaskGetStackHighWaterMark()` in bytes at startup and immediately before and
after emergency/completion OFF transitions.

The mixing/dosing protocol remains on its separate 6144-byte `mix_test` worker.
No actuator safety interlock or emergency OFF path was removed.

## Calibration persistence verification

Calibration records are stored under the `agrotech` NVS namespace at the
`calib_json` key. A calibration save is only successful after all three
storage stages succeed: `nvs_set_str`, `nvs_commit`, and an immediate
read-back comparison against the submitted JSON. A failure at any stage is
returned to the HTTP handler, so it cannot be reported as `APPLIED` or emit a
persisted calibration event.

Startup load reports missing NVS data, NVS read failures, invalid JSON, and
unsupported schema versions separately. Valid records are loaded into the
calibration manager before the `/api/v1/calibration/rate` endpoint serves
rates. This verifies software durability; retention and response behavior
still require a controlled ESP32 restart test.

## Confirmed findings and remaining hypotheses

- Confirmed: the observed `mk_persist` watchdog backtrace entered SPIFFS
  garbage collection during a whole-file marker write.
- Confirmed: the observed calibration task name identifies the calibration
  worker, but the corrupted overflow backtrace alone cannot identify the exact
  deepest callee.
- Strong evidence: the calibration task's old stack measurement predates the
  centralized actuator request/event path and its runtime stack demand was no
  longer represented by the 2560-byte setting.
- Not yet measured on hardware: actual SPIFFS free bytes/fragmentation,
  worst-case bounded-write latency, and post-fix calibration high-water mark.

## Calibration NVS size bound (SP-CALIBRATION-NVS-SIZE-001)

`calib_json` is one NVS string; ESP-IDF caps a string at 4000 bytes including NUL. Each record is ~270-330 bytes, and every
save appends a new version, so roughly the 15th save failed with `ESP_ERR_NVS_VALUE_TOO_LONG` (the earlier firmware ignored
the error and logged "Saved"; the in-memory record then disappeared at reboot / was never restorable).

- Only the latest and previous version per complex/component/calibration type are persisted
  (`record_superseded_locked()` in `calibration_mgr.c`). Older versions are dropped from RAM only after the NVS write and
  read-back succeed (`compact_superseded_locked()`); versions two or more behind can no longer be looked up by exact version.
- A failed write rolls back RAM (including the replaced-oldest-record path and flow pulse caches) and never erases the
  previously persisted record. If the JSON still exceeds 4000 bytes the API returns `CALIBRATION_SAVE_FAILED` (422).
- `POST /api/v1/calibration/rate` flow-pulse-only requests now return an error when persistence fails.
- Log markers: `Calibration persisted: N records, B bytes` / `Calibration NOT persisted (0x.., B bytes)`.

## Calibration Reboot Retention & UI Refresh Hydration (SP-CALIBRATION-PERSIST-001)

### Root Cause Analysis of "Disappearing After Refresh"
When calibration records were saved in previous firmware iterations, logs confirmed NVS persistence (`STORAGE_MGR: Saved calib_json to NVS`). However, refreshing the browser or rebooting the ESP32 caused the values to disappear or revert to default rates. Two root causes were identified:

1. **Clock Domain Conflict Across Boots (`calibration_mgr_is_usable()`)**:
   - Monotonic boot uptime (`esp_timer_get_time() / 1000LL`) was previously stored in `valid_from_ms` and `valid_until_ms`.
   - On firmware restart or device reboot, `now` resets to ~0 ms (boot uptime), whereas the restored NVS record held `valid_from_ms` from a previous boot session (e.g. 791,292,000 ms).
   - In `calibration_mgr_is_usable()`, `now < record->valid_from_ms` evaluated to `true`, causing `calibration_mgr_get_rate()` to immediately treat the restored record as expired/unusable and return 0.0 or defaults across reboots.
   - **Resolution**: Aligned timestamp domain with synchronized POSIX wall-clock time (`time(NULL) >= 1704067200` Jan 1 2024). When the RTC/SNTP is unsynchronized at calibration time, `valid_from_ms` and `valid_until_ms` are initialized to 0. `calibration_mgr_is_usable()` only invalidates `valid_from_ms` when both the record timestamp and current clock are in the valid epoch (> Jan 1, 2024).

2. **Unassigned State in `calibration_mgr_set_dosing_rate()`**:
   - `r->state` was not assigned the requested `state` argument in the dosing rate helper, defaulting or remaining uncalibrated.
   - **Resolution**: Explicitly set `r->state = state;` (`CAL_RECORD_CALIBRATED`).

3. **Authoritative NVS Records Export & Direct ESP32 UI Hydration**:
   - Added `GET /api/v1/calibration` endpoint (returning `{ calibrations: [...] }`) and populated the `records` array in `GET /api/v1/calibration/rate`.
   - Updated `src/lib/api/local-store-client.ts` and `src/lib/services.ts` so that in Direct ESP32 mode (`VITE_ENABLE_PYTHON_BACKEND=false`), the UI hydration path fetches durable records directly from ESP32 NVS instead of falling back to empty local state.
   - Sanitized timestamps below Jan 1 2024 in the UI formatter so device calibration badges display active status and valid timestamps rather than "Belum Dikalibrasi".
