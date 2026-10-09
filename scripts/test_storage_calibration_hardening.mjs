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
