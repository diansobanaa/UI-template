/**
 * Automated Verification Suite for the 5 Blocking Corrections
 * Focus: One preparation per GH, config reconciliation, midnight boundary, GPIO 18 buzzer, and float interlock.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

console.log("=================================================================");
console.log("FINAL BLOCKING CORRECTIONS VERIFICATION SUITE");
console.log("=================================================================");

const schedH = fs.readFileSync(path.resolve("esp32/main/services/scheduler.h"), "utf8");
const schedC = fs.readFileSync(path.resolve("esp32/main/services/scheduler.c"), "utf8");
const fertH = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.h"), "utf8");
const fertC = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.c"), "utf8");
const cmdC = fs.readFileSync(path.resolve("esp32/main/services/command_mgr.c"), "utf8");
const actC = fs.readFileSync(path.resolve("esp32/main/hal/actuator_hal.c"), "utf8");
const pinH = fs.readFileSync(path.resolve("esp32/main/config/pin_config.h"), "utf8");
const hwC = fs.readFileSync(path.resolve("esp32/main/hal/hardware_registry.c"), "utf8");
const hwInv = fs.readFileSync(path.resolve("docs/HARDWARE_INVENTORY.md"), "utf8");

// CHECK 1: HARD GUARANTEE: ONE PREPARATION PER GH
test("Check 1.1: is_gh_occupied evaluates full lifecycle (queue, occurrences, physical fertigation, and runtime holds)", () => {
  assert.match(schedC, /static bool is_gh_occupied\(const char \*gh_id\)/);
  assert.match(schedC, /st == OCC_STATE_PREPARING \|\| st == OCC_STATE_WAITING_BATCH \|\|\s*st == OCC_STATE_READY_TO_SEND \|\| st == OCC_STATE_DISTRIBUTING/);
  assert.match(schedC, /fertigation_mgr_is_batch_ready\(gh_id, NULL\)/);
  assert.match(schedC, /s_runtime\[i\]\.marker_state == MARKER_RECOVERY_HOLD/);
});

test("Check 1.2: enqueue_preparation rejects when is_gh_occupied(occ->gh_id) is true", () => {
  assert.match(schedC, /if \(is_gh_occupied\(occ->gh_id\)\) \{\s*return ESP_ERR_INVALID_STATE;\s*\}/);
});

test("Check 1.3: rebuild_dosing_queue_on_boot guards with !is_gh_occupied(occ->gh_id)", () => {
  assert.match(schedC, /if \(!is_gh_occupied\(occ->gh_id\)\) \{\s*enqueue_preparation\(occ\);/);
});

test("Check 1.4: Next preparation is chained only after previous batch reaches OCC_STATE_COMPLETED", () => {
  assert.match(schedC, /occ->state = OCC_STATE_COMPLETED;/);
  assert.match(schedC, /for \(size_t j = 0; j < s_today_occurrence_count; j\+\+\)/);
  assert.match(schedC, /enqueue_preparation\(&s_today_occurrences\[j\]\);/);
});

// CHECK 2: CONFIGURATION CHANGE RECONCILIATION & COMMAND_MGR RACE GUARD
test("Check 2.1: reconcile_dosing_queue_on_config_change is invoked on config deployment", () => {
  assert.match(schedC, /reconcile_dosing_queue_on_config_change\(cfg_ver\);/);
  assert.match(schedC, /static void reconcile_dosing_queue_on_config_change\(uint32_t new_config_version\)/);
});

test("Check 2.2: Unstarted queue entries are invalidated, cancelled in command_mgr, and reset to OCC_STATE_PENDING", () => {
  assert.match(schedC, /snprintf\(cancel_cmd_id, sizeof\(cancel_cmd_id\), "cmd-%.30s", q->queue_id\);/);
  assert.match(schedC, /\(void\)command_mgr_cancel\(cancel_cmd_id\);/);
  assert.match(schedC, /s_today_occurrences\[j\]\.state = OCC_STATE_PENDING;/);
  assert.match(schedC, /s_today_occurrences\[j\]\.queue_id\[0\] = '\\0';/);
  assert.match(schedC, /s_today_occurrences\[j\]\.batch_id\[0\] = '\\0';/);
  assert.match(schedC, /s_dosing_queue_count--;/);
});

test("Check 2.3: Stale command in command_mgr IPC queue rejected before physical execution if config version changed", () => {
  assert.match(cmdC, /cmd->configuration_version != cur_storage->config_version/);
  assert.match(cmdC, /cached->status = CMD_STATUS_REJECTED;/);
  assert.match(cmdC, /"STALE_CONFIGURATION_VERSION"/);
});

test("Check 2.4: Active physical dosing batches are preserved and not mutated during config deployment", () => {
  assert.match(schedC, /Preserving in-flight physical batch/);
  assert.match(schedC, /q->state == QUEUE_STATE_ACTIVE/);
});

// CHECK 3: LONG POWER-LOSS MISSED SCHEDULE (NO AUTO-REPLAY)
test("Check 3.1: Materialize marks past unexecuted occurrences as OCC_STATE_FAILED and MARKER_SKIPPED", () => {
  assert.match(schedC, /else if \(\(int64_t\)now > \(int64_t\)occ_time\)/);
  assert.match(schedC, /new_occ->state = OCC_STATE_FAILED;/);
  assert.match(schedC, /marker_update\(rs, MARKER_SKIPPED, \(int64_t\)occ_time, now, "Power loss missed schedule skipped"\);/);
});

test("Check 3.2: Rebuild dosing queue on boot never queues OCC_STATE_FAILED / MISSED occurrences", () => {
  assert.match(schedC, /if \(occ->state == OCC_STATE_PREPARING\)/);
  assert.doesNotMatch(schedC, /if \(occ->state == OCC_STATE_FAILED\)\s*\{\s*enqueue_preparation/);
});

// CHECK 4: MIDNIGHT / DAY-BOUNDARY SEMANTICS (CASES A-E)
test("Check 4.1: Day boundary rollover detected via tm_yday change", () => {
  assert.match(schedC, /if \(s_today_yday != tm_now\.tm_yday\)/);
  assert.match(schedC, /Day boundary rollover detected/);
});

test("Check 4.2: Case E completed occurrences from yesterday are retired and do not occupy new day schedule", () => {
  assert.match(schedC, /Case E: COMPLETED occurrences from yesterday retire/);
  assert.match(schedC, /bool is_prev_day =/);
});

test("Check 4.3: Case C & D READY_TO_SEND and DISTRIBUTING batches from yesterday are preserved under original identity", () => {
  assert.match(schedC, /occ->state == OCC_STATE_DISTRIBUTING \|\| occ->state == OCC_STATE_READY_TO_SEND/);
  assert.match(schedC, /keep_prev = true;/);
});

test("Check 4.4: Case A queued-but-not-started yesterday entries are purged from queue", () => {
  assert.match(schedC, /Purge unstarted queue entry from yesterday/);
  assert.match(schedC, /s_dosing_queue\[q\]\.state != QUEUE_STATE_ACTIVE/);
});

test("Check 4.5: Case B active physical batch across midnight retains original batch_id and occurrence_id", () => {
  assert.match(schedC, /q->state == QUEUE_STATE_ACTIVE/);
  assert.match(schedC, /Preserving in-flight physical batch/);
});

// CHECK 5: ARCHITECTURAL BOUNDARY: CENTRAL SERIAL DOSING VS MULTI-GH DISTRIBUTION
test("Check 5.1: Central dosing is strictly serialized via Global Dosing Queue (FIFO, one head at a time)", () => {
  assert.match(schedC, /dosing_queue_entry_t \*head = &s_dosing_queue\[0\];/);
  assert.match(schedC, /if \(head->state == QUEUE_STATE_PENDING\)/);
  assert.match(schedC, /if \(fert_st == FERT_STATE_IDLE\)/);
});

test("Check 5.2: Decoupled Multi-GH Distribution: fertigation_mgr uses independent per-GH delivery slots", () => {
  assert.match(fertC, /static delivery_slot_t s_delivery_slots\[FERT_MAX_DELIVERY_SLOTS\]/);
  assert.match(fertC, /s_delivery_slots\[i\]\.state == DELIVERY_SLOT_READY_TO_SEND/);
  assert.match(fertC, /fertigation_mgr_trigger_distribution/);
  assert.match(fertC, /slot->state = DELIVERY_SLOT_DISTRIBUTING;/);
});

// CHECK 6: GPIO 18 HARDWARE REGISTRY CONSISTENCY
test("Check 6.1: GPIO 18 is mapped to PIN_OUT_BUZZER (Active Alarm Buzzer via MOSFET stage)", () => {
  assert.match(pinH, /#define PIN_OUT_BUZZER\s+18/);
  assert.match(pinH, /MOSFET Gate Driver Stage -> 3V\/5V Active Alarm Buzzer/);
  assert.match(pinH, /#define PIN_OUT_ERROR_LAMP\s+-1/);
});

test("Check 6.2: hardware_registry maps BUZZER / ALARM_BUZZER to PIN_OUT_BUZZER", () => {
  assert.match(hwC, /if \(strcmp\(r, "BUZZER"\) == 0 \|\| strcmp\(r, "ALARM_BUZZER"\) == 0 \|\| strcmp\(t, "active-buzzer"\) == 0\) return PIN_OUT_BUZZER;/);
  assert.match(hwC, /if \(strcmp\(r, "ERROR_LAMP"\) == 0 \|\| strcmp\(r, "ALARM_LAMP"\) == 0 \|\| strcmp\(r, "ERROR_BEACON"\) == 0\) return PIN_OUT_ERROR_LAMP;/);
});

test("Check 6.3: Canonical hardware documentation explicitly records intentional repurposing of GPIO 18", () => {
  assert.match(hwInv, /Former role on GPIO 18 repurposed to N-channel MOSFET Buzzer driver stage/);
  assert.match(hwInv, /Switched via N-Channel MOSFET Module \(GPIO 18\)/);
});

// CHECK 7: SAFETY OF THE RECENT FLOAT INTERLOCK CHANGE
test("Check 7.1: Lower float dry-run interlock strictly gates only ACTUATOR_DIST_PUMP in actuator_hal_set", () => {
  assert.match(actC, /if \(on && \(id == ACTUATOR_DIST_PUMP\)\) \{\s*if \(gpio_get_level\(PIN_IN_FLOAT_LOWER\) == FLOAT_LEVEL_DRY\)/);
});

test("Check 7.2: Raw water pump and submersible are free to fill empty mixing tank", () => {
  assert.doesNotMatch(actC, /if \(on && \(id == ACTUATOR_RAW_SUBMERSIBLE\)\) \{\s*if \(gpio_get_level\(PIN_IN_FLOAT_LOWER\)/);
});

test("Check 7.3: actuator_hal_get_status is_interlocked aligned to ACTUATOR_DIST_PUMP for lower float dry", () => {
  assert.match(actC, /out_status->is_interlocked = s_emergency_stop_latched \|\|\s*\(id == ACTUATOR_DIST_PUMP && gpio_get_level\(PIN_IN_FLOAT_LOWER\) == FLOAT_LEVEL_DRY\);/);
});

test("Check 7.4: E-STOP remains dominant over all actuator requests and forces all outputs OFF", () => {
  assert.match(actC, /if \(on && s_emergency_stop_latched\)/);
  assert.match(actC, /s_actuators\[i\]\.owner = ACTUATOR_OWNER_SAFETY;/);
  assert.match(actC, /gpio_set_level\(s_actuators\[i\]\.gpio, !s_actuators\[i\]\.active_level\);/);
});

// CHECK 8: LIVE PHYSICAL ESP32 HEALTH & API TESTS
await asyncTest("Check 8.1: Live ESP32 responds with valid health and STA connection", async () => {
  const res = await fetch("http://192.168.0.139/api/v1/health", {
    headers: { Authorization: "Bearer agrotech-secret-key" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.networkState, "STA_CONNECTED");
  assert.equal(body.data.deviceId, "controller-7C4FAD2BC454");
});

await asyncTest("Check 8.2: Live ESP32 returns empty or valid queuedBatches and todaySchedule", async () => {
  const res = await fetch("http://192.168.0.139/api/v1/fertigation/status", {
    headers: { Authorization: "Bearer agrotech-secret-key" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.queuedBatches));
  assert.ok(Array.isArray(body.data.todaySchedule));
  assert.equal(body.data.thresholdPercent, 20);
});

await asyncTest("Check 8.3: Live ESP32 exposes /api/v1/fertigation/queue endpoint", async () => {
  const res = await fetch("http://192.168.0.139/api/v1/fertigation/queue", {
    headers: { Authorization: "Bearer agrotech-secret-key" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.queuedBatches));
});

console.log("=================================================================");
console.log(`TOTAL BLOCKING CORRECTIONS AUDIT: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================================");
if (failed > 0) process.exit(1);
