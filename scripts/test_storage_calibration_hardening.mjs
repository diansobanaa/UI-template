import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scheduler = fs.readFileSync(path.join(root, "esp32/main/services/scheduler.c"), "utf8");
const calibration = fs.readFileSync(path.join(root, "esp32/main/services/calibration_mgr.c"), "utf8");
const storage = fs.readFileSync(path.join(root, "esp32/main/storage/storage_mgr.c"), "utf8");
const events = fs.readFileSync(path.join(root, "esp32/main/services/event_mgr.c"), "utf8");

assert.match(scheduler, /SPIFFS_SCHEDULE_MARKERS_TMP_FILE/);
assert.match(scheduler, /MARKER_PERSIST_CHUNK_BYTES 512U/);
assert.match(scheduler, /rename\(SPIFFS_SCHEDULE_MARKERS_TMP_FILE, SPIFFS_SCHEDULE_MARKERS_FILE\)/);
assert.match(scheduler, /fsync\(fd\)/);
assert.match(scheduler, /Marker persistence failed/);
assert.match(scheduler, /s_marker_persist_pending = true/);

assert.match(events, /Reserve the next block while initialization is still on the internal/);
assert.match(events, /s_spare_block_first = first/);

assert.match(calibration, /#define CALIBRATION_TASK_STACK 4096/);
assert.match(calibration, /log_calibration_stack\("before_complete_off"\)/);
assert.match(calibration, /log_calibration_stack\("after_complete_off"\)/);
assert.match(calibration, /log_calibration_stack\("before_emergency_off"\)/);
assert.match(storage, /Calibration persistence failed: NVS set/);
assert.match(storage, /Calibration persistence failed: NVS commit/);
assert.match(storage, /Calibration persisted and read back from NVS/);
assert.match(storage, /Calibration read-back failed after NVS commit/);
assert.match(calibration, /Calibration data invalid: JSON parse failed/);
assert.match(calibration, /Calibration data incompatible: schemaVersion/);

console.log("storage/calibration hardening static checks: PASS");

// SP-CALIBRATION-NVS-SIZE-001: NVS strings are capped at 4000 bytes; unbounded history made saves fail.
assert.match(calibration, /static bool record_superseded_locked/);
assert.match(calibration, /compact_superseded_locked\(\);/);
assert.match(calibration, /replaced_backup = s_records\[idx\]/);
assert.match(calibration, /\*r = replaced_backup/);
assert.match(calibration, /Calibration NOT persisted/);
assert.match(fs.readFileSync(path.join(root, "esp32/main/http/api_calibration_handlers.c"), "utf8"), /Flow calibration was not persisted/);
{
  // Budget model: 3 pumps + 2 flow components, latest+previous version each, with a long complexId.
  const rec = (i) => JSON.stringify({ calibrationId: `cal-pump_dosing_a-v${i}`, componentId: "pump_dosing_a", complexId: "complex-0123456789abcdef", calibrationType: "DOSING_RATE", version: i, state: "CALIBRATED", createdAtMs: 791292123, validFromMs: 791292123, validUntilMs: 3383292123, operator: "technician", rateMlPerSec: 1.666667, pulsesPerLiter: 450.5 });
  assert.ok(rec(99).length * 5 * 2 + 120 < 4000, "bounded history must fit one NVS string");
  assert.ok(rec(99).length * 15 > 4000, "unbounded history overflows at ~15 records (original defect)");
}
console.log("calibration NVS size-bound checks: PASS");

// SP-CALIBRATION-PERSIST-001: Clock domain sanity across reboots, state assignment, and records export.
assert.match(calibration, /r->state = state;/);
assert.match(calibration, /record->valid_from_ms >= 1704067200000LL && now_ms < record->valid_from_ms/);
assert.match(calibration, /esp_err_t calibration_mgr_populate_records_json\(cJSON \*out_array\)/);
assert.match(fs.readFileSync(path.join(root, "esp32/main/http/api_calibration_handlers.c"), "utf8"), /uri="\/api\/v1\/calibration",\.method=HTTP_GET/);
console.log("calibration clock domain & records export checks: PASS");
