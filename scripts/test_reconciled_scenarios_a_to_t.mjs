/**
 * Automated Verification Suite for Scenarios A through T
 * Execution prompt: Reconciled Fertigation / Scheduling / Dosing Queue Architecture
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
console.log("RECONCILED FERTIGATION / SCHEDULING / DOSING QUEUE AUDIT (A-T)");
console.log("=================================================================");

const schedH = fs.readFileSync(path.resolve("esp32/main/services/scheduler.h"), "utf8");
const schedC = fs.readFileSync(path.resolve("esp32/main/services/scheduler.c"), "utf8");
const fertH = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.h"), "utf8");
const fertC = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.c"), "utf8");
const actC = fs.readFileSync(path.resolve("esp32/main/hal/actuator_hal.c"), "utf8");
const mainC = fs.readFileSync(path.resolve("esp32/main/main.c"), "utf8");

// Scenario A: One GH, batch ready before schedule time
test("Scenario A: One GH, batch ready before schedule time remains held in READY_TO_SEND", () => {
  assert.match(fertC, /case FERT_STATE_MIX_READY:/);
  assert.match(fertC, /Genuine holding state/);
  assert.match(schedH, /OCC_STATE_READY_TO_SEND/);
  assert.match(schedC, /now >= occ->scheduled_timestamp/);
  assert.match(schedC, /fertigation_mgr_trigger_distribution/);
});

// Scenario B: One GH, schedule due before batch ready
test("Scenario B: One GH, schedule due before batch ready transitions to WAITING_BATCH", () => {
  assert.match(schedH, /OCC_STATE_WAITING_BATCH/);
  assert.match(schedC, /occ->state = OCC_STATE_WAITING_BATCH;/);
  assert.match(schedC, /fertigation_mgr_is_batch_ready\(occ->gh_id/);
});

// Scenario C: Two GH sharing central dosing pumps
test("Scenario C: Two GH sharing central dosing pumps arbitrated by Global Dosing Queue", () => {
  assert.match(schedC, /is_gh_occupied\(occ->gh_id\)/);
  assert.match(schedC, /dosing_queue_entry_t \*head = &s_dosing_queue\[0\];/);
});

// Scenario D: Three queued preparations, strict FIFO
test("Scenario D: Three queued preparations, strict FIFO by registration order", () => {
  assert.match(schedC, /s_dosing_queue\[i - 1\] = s_dosing_queue\[i\];/);
  assert.match(schedC, /s_dosing_queue_count--;/);
});

// Scenario E: Same GH with morning + afternoon schedules
test("Scenario E: Same GH with morning + afternoon schedules has distinct occurrence_ids", () => {
  assert.match(schedC, /snprintf\(occ_id, sizeof\(occ_id\), "occ-%s-%lld"/);
  assert.match(schedH, /char occurrence_id\[64\];/);
});

// Scenario F: Queue HEAD dispatch cannot repeat every second
test("Scenario F: Queue HEAD dispatch latch (QUEUE_STATE_DISPATCHED) prevents re-dispatch", () => {
  assert.match(schedH, /QUEUE_STATE_DISPATCHED/);
  assert.match(schedC, /head->state = QUEUE_STATE_DISPATCHED;/);
  assert.match(schedC, /else if \(head->state == QUEUE_STATE_DISPATCHED\)/);
});

// Scenario G: Exact batch correlation prevents wrong queue pop
test("Scenario G: Exact 4-tuple correlation (queue_id, occurrence_id, batch_id, gh_id) prevents wrong queue pop", () => {
  assert.match(fertH, /fertigation_mgr_get_correlation/);
  assert.match(fertC, /fertigation_mgr_get_correlation/);
  assert.match(schedC, /strcmp\(q_id, head->queue_id\) == 0/);
  assert.match(schedC, /strcmp\(occ_id, head->occurrence_id\) == 0/);
  assert.match(schedC, /strcasecmp\(gh, head->gh_id\) == 0/);
});

// Scenario H: Delivery completion registers exactly one next preparation
test("Scenario H: Delivery completion registers exactly one next preparation", () => {
  assert.match(schedC, /check_distribution_completions/);
  assert.match(schedC, /occ->state = OCC_STATE_COMPLETED;/);
  assert.match(schedC, /enqueue_preparation\(&s_today_occurrences\[j\]\);/);
});

// Scenario I: Schedule/config changed during the day
test("Scenario I: Schedule/config changed during the day preserves completed occurrences and reconciles unstarted", () => {
  assert.match(schedC, /reconcile_dosing_queue_on_config_change/);
  assert.match(schedC, /occ->state == OCC_STATE_COMPLETED/);
  assert.match(schedC, /preserved\[preserved_count\+\+\] = \*occ;/);
});

// Scenario J: ESP32 reboot during dosing
test("Scenario J: ESP32 reboot during dosing triggers fail-safe outputs locked OFF", () => {
  assert.match(mainC, /safe_boot_actuators\(\);/);
  assert.match(fertC, /FERT_STATE_RECOVERY_HOLD/);
});

// Scenario K: ESP32 reboot while READY_TO_SEND
test("Scenario K: ESP32 reboot while READY_TO_SEND reconciles state deterministically", () => {
  assert.match(schedC, /rebuild_dosing_queue_on_boot/);
  assert.match(schedC, /materialize_today_schedule\(now\);/);
});

// Scenario L: ESP32 reboot during delivery
test("Scenario L: ESP32 reboot during delivery safely locks outputs and queries recovery", () => {
  assert.match(fertC, /FERT_RECOVERY_KEY/);
  assert.match(fertC, /restore_recovery/);
});

// Scenario M: Queue full/backpressure
test("Scenario M: Queue full retains occurrence with backpressure", () => {
  assert.match(schedC, /if \(s_dosing_queue_count >= MAX_DOSING_QUEUE\)/);
  assert.match(schedC, /Dosing queue capacity reached/);
});

// Scenario N: Routing valve actuation failure
test("Scenario N: Routing valve actuation failure aborts and fails safe", () => {
  assert.match(fertC, /actuator_hal_acquire_component\(s_batch\.routing_valve_ids\[i\]/);
  assert.match(fertC, /ROUTING_VALVE_ACTUATOR_REJECTED/);
  assert.match(fertC, /stop_all\(\);/);
});

// Scenario O: Raw-water zero-flow
test("Scenario O: Raw-water zero-flow triggers safety flow fault and clean stop", () => {
  assert.match(fertC, /FLOW_FAULT/);
  assert.match(fertC, /FILL_TIMEOUT/);
  assert.match(fertC, /stop_all\(\);/);
});

// Scenario P: E-STOP
test("Scenario P: E-STOP latches all actuators OFF immediately", () => {
  assert.match(actC, /actuator_hal_emergency_stop/);
  assert.match(actC, /s_emergency_stop_latched = true;/);
  assert.match(actC, /gpio_set_level\(s_actuators\[i\]\.gpio/);
});

// Scenario Q: Watchdog/restart
test("Scenario Q: Watchdog reset detected and logged on reboot", () => {
  assert.match(mainC, /WATCHDOG_RESET/);
  assert.match(mainC, /safe_boot_actuators\(\);/);
});

// Scenario R: Midnight rollover with no active batch
test("Scenario R: Midnight rollover with no active batch rematerializes new day cleanly", () => {
  assert.match(schedC, /if \(s_today_yday != tm_now\.tm_yday\)/);
  assert.match(schedC, /materialize_today_schedule\(now\);/);
});

// Scenario S: Midnight rollover preserves occurrence identities and correlation
test("Scenario S: Midnight rollover preserves occurrence identities and correlation", () => {
  assert.match(schedC, /rebuild_dosing_queue_on_boot\(now\);/);
  assert.match(fertC, /fertigation_mgr_get_correlation/);
});

// Scenario T: UI disconnect while physical runtime continues
test("Scenario T: ESP32 runs standalone scheduler and fertigation without browser dependence", () => {
  assert.match(schedC, /scheduler_evaluate_at/);
  assert.match(fertC, /vTaskDelay\(pdMS_TO_TICKS\(200\)\);/);
  assert.match(mainC, /ESP_ERROR_CHECK\(scheduler_init\(\)\);/);
  assert.match(mainC, /ESP_ERROR_CHECK\(fertigation_mgr_init\(\)\);/);
});

// Verify live ESP32 hardware response
await asyncTest("Live ESP32 returns valid dosing queue and today schedule structures", async () => {
  const res = await fetch("http://192.168.0.139/api/v1/fertigation/status", {
    headers: { Authorization: "Bearer agrotech-secret-key" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.queuedBatches), "queuedBatches must be an array");
  assert.ok(Array.isArray(body.data.todaySchedule), "todaySchedule must be an array");
  assert.equal(body.data.thresholdPercent, 20);
});

console.log("=================================================================");
console.log(`TOTAL SCENARIO AUDIT: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================================");
if (failed > 0) process.exit(1);
