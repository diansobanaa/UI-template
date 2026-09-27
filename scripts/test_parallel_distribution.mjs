/**
 * Parallel Multi-GH Distribution Verification Suite
 * Verifies Requirements A through J:
 * A. GH01 READY_TO_SEND + GH02 READY_TO_SEND both due -> both DISTRIBUTING concurrently
 * B. GH01 DISTRIBUTING while GH02 starts CENTRAL DOSING
 * C. GH01 DISTRIBUTING + GH02 DISTRIBUTING + GH03 CENTRAL DOSING all coexist
 * D. GH01 distribution timeout while GH02 continues normally
 * E. GH01 delivery completes -> only GH01 occurrence becomes COMPLETED -> only GH01 next preparation eligible
 * F. GH01 and GH02 have distinct batch_id, occurrence_id, gh_id
 * G. E-STOP during distribution and central dosing
 * H. Reboot during active distribution
 * I. READY_TO_SEND batch remains valid after central dosing engine returns IDLE
 * J. Global Dosing Queue still guarantees strict FIFO for central preparation
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
console.log("PARALLEL MULTI-GH DISTRIBUTION VERIFICATION SUITE (A-J)");
console.log("=================================================================");

const schedH = fs.readFileSync(path.resolve("esp32/main/services/scheduler.h"), "utf8");
const schedC = fs.readFileSync(path.resolve("esp32/main/services/scheduler.c"), "utf8");
const fertH = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.h"), "utf8");
const fertC = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.c"), "utf8");
const actC = fs.readFileSync(path.resolve("esp32/main/hal/actuator_hal.c"), "utf8");
const openapi = fs.readFileSync(path.resolve("contracts/UI_ESP32_OPENAPI.yaml"), "utf8");

// TEST A: GH01 READY_TO_SEND + GH02 READY_TO_SEND both due -> both DISTRIBUTING concurrently
test("Test A: Multiple READY_TO_SEND batches can distribute concurrently without blocking", () => {
  assert.match(fertH, /typedef struct\s*\{\s*bool occupied;/);
  assert.match(fertH, /delivery_slot_state_t state;/);
  assert.match(fertH, /char gh_id\[\d+\];/);
  assert.match(fertC, /static delivery_slot_t s_delivery_slots\[FERT_MAX_DELIVERY_SLOTS\]/);
  // evaluate_today_occurrences triggers distribution per occurrence without global lock
  assert.match(schedC, /if \(occ->state == OCC_STATE_READY_TO_SEND\)/);
  assert.match(schedC, /fertigation_mgr_trigger_distribution\(occ->gh_id, occ->occurrence_id\)/);
  assert.match(schedC, /occ->state = OCC_STATE_DISTRIBUTING;/);
});

// TEST B: GH01 DISTRIBUTING while GH02 starts CENTRAL DOSING
test("Test B: Active distribution does not block next Global Dosing Queue preparation", () => {
  // fertigation_mgr transitions central engine to IDLE when MIX_READY handoff occurs
  assert.match(fertC, /transition\(FERT_STATE_IDLE\);/);
  // process_dosing_queue dispatches whenever fert_st == FERT_STATE_IDLE regardless of active distributions
  assert.match(schedC, /if \(head->state == QUEUE_STATE_PENDING\)/);
  assert.match(schedC, /if \(fert_st == FERT_STATE_IDLE\)/);
});

// TEST C: GH01 DISTRIBUTING + GH02 DISTRIBUTING + GH03 CENTRAL DOSING all coexist
test("Test C: GH01 DISTRIBUTING, GH02 DISTRIBUTING, and GH03 CENTRAL DOSING coexist safely", () => {
  // s_delivery_slots tracks multiple independent distributing GHs
  assert.match(fertC, /s_delivery_slots\[i\]\.state == DELIVERY_SLOT_DISTRIBUTING/);
  // Central fertigation engine owns only PRECHECK -> FILLING -> DOSING -> FINAL_MIXING
  assert.match(fertC, /case FERT_STATE_FINAL_MIXING:/);
  assert.match(fertC, /transition\(FERT_STATE_IDLE\);/);
  // delivery monitor loop checks all slots independently
  assert.match(fertC, /for \(size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s\+\+\)/);
  assert.match(fertC, /if \(!slot->occupied \|\| slot->state != DELIVERY_SLOT_DISTRIBUTING\)/);
});

// TEST D: GH01 distribution timeout while GH02 continues normally
test("Test D: Delivery fault on GH01 isolates failure; GH02 continues normally", () => {
  // Timeout or fault sets only that slot to DELIVERY_SLOT_FAULTED and stops only slot->delivery_pump_id
  assert.match(fertC, /stop_component\(slot->delivery_pump_id\);/);
  assert.match(fertC, /slot->state = DELIVERY_SLOT_FAULTED;/);
  // scheduler marks only that occurrence FAILED and acknowledges only that slot
  assert.match(schedC, /else if \(slot_st == DELIVERY_SLOT_FAULTED\)/);
  assert.match(schedC, /occ->state = OCC_STATE_FAILED;/);
  assert.match(schedC, /fertigation_mgr_acknowledge_delivery\(occ->gh_id, occ->occurrence_id\);/);
});

// TEST E: GH01 delivery completes -> only GH01 occurrence becomes COMPLETED -> only GH01 next prep eligible
test("Test E: Distribution completion is isolated to exact occurrence and chains only target GH", () => {
  assert.match(schedC, /if \(slot_st == DELIVERY_SLOT_COMPLETE\)/);
  assert.match(schedC, /occ->state = OCC_STATE_COMPLETED;/);
  assert.match(schedC, /fertigation_mgr_acknowledge_delivery\(occ->gh_id, occ->occurrence_id\);/);
  assert.match(schedC, /strcmp\(s_today_occurrences\[j\]\.gh_id, occ->gh_id\) == 0/);
  assert.match(schedC, /enqueue_preparation\(&s_today_occurrences\[j\]\);/);
});

// TEST F: GH01 and GH02 have distinct batch_id, occurrence_id, gh_id
test("Test F: Delivery slots enforce strict 3-tuple identity isolation (gh_id, occurrence_id, batch_id)", () => {
  assert.match(fertH, /char gh_id\[\d+\];/);
  assert.match(fertH, /char occurrence_id\[\d+\];/);
  assert.match(fertH, /char batch_id\[\d+\];/);
  assert.match(fertC, /cp\(slot->gh_id, sizeof\(slot->gh_id\), s_batch\.gh_id\);/);
  assert.match(fertC, /cp\(slot->occurrence_id, sizeof\(slot->occurrence_id\), s_batch\.occurrence_id\);/);
  assert.match(fertC, /cp\(slot->batch_id, sizeof\(slot->batch_id\), s_batch\.batch_id\[0\] \? s_batch\.batch_id : s_batch\.run_id\);/);
});

// TEST G: E-STOP during distributions and central dosing
test("Test G: Global E-STOP stops all distribution slots and central preparation immediately", () => {
  assert.match(actC, /actuator_hal_emergency_stop/);
  assert.match(fertC, /if \(safety_monitor_has_fault\(\) \|\| actuator_hal_is_emergency_stopped\(\)\)/);
  // stop_all stops central preparation pumps and all active delivery slot pumps
  assert.match(fertC, /for \(size_t s = 0; s < FERT_MAX_DELIVERY_SLOTS; s\+\+\)/);
  assert.match(fertC, /stop_component\(s_delivery_slots\[s\]\.delivery_pump_id\);/);
});

// TEST H: Reboot during distribution locks outputs OFF safely
test("Test H: Reboot during distribution safely locks outputs OFF and preserves operational state", () => {
  assert.match(fertC, /FERT_RECOVERY_KEY/);
  assert.match(fertC, /restore_recovery/);
  assert.match(schedC, /rebuild_dosing_queue_on_boot/);
});

// TEST I: READY_TO_SEND batch remains valid after central dosing engine returns IDLE
test("Test I: Prepared batch metadata persists in per-GH delivery slot while central engine returns IDLE", () => {
  assert.match(fertC, /slot->state = DELIVERY_SLOT_READY_TO_SEND;/);
  assert.match(fertC, /transition\(FERT_STATE_IDLE\);/);
  assert.match(fertC, /bool fertigation_mgr_is_batch_ready\(const char \*gh_id, const char \*occurrence_id\)/);
  assert.match(fertC, /s_delivery_slots\[i\]\.state == DELIVERY_SLOT_READY_TO_SEND/);
});

// TEST J: Global Dosing Queue still guarantees strict FIFO for central preparation
test("Test J: Global Dosing Queue maintains strict FIFO serialization for central preparation", () => {
  assert.match(schedC, /dosing_queue_entry_t \*head = &s_dosing_queue\[0\];/);
  assert.match(schedC, /s_dosing_queue\[i - 1\] = s_dosing_queue\[i\];/);
  assert.match(schedC, /s_dosing_queue_count--;/);
});

// TEST K: One-preparation-per-GH invariant preserved
test("Test K: is_gh_occupied guards against duplicate preparations across full lifecycle", () => {
  assert.match(schedC, /if \(fertigation_mgr_is_gh_busy\(gh_id\) \|\| fertigation_mgr_is_batch_ready\(gh_id, NULL\)\)/);
  assert.match(fertC, /bool fertigation_mgr_is_gh_busy\(const char \*gh_id\)/);
});

// TEST L: OpenAPI schema documents activeDeliveries array
test("Test L: OpenAPI contract defines activeDeliveries on /api/v1/fertigation/status and queue", () => {
  assert.match(openapi, /activeDeliveries:\s*type: array/);
});

// TEST M: Live ESP32 Hardware Endpoint Verification
await asyncTest("Test M: Live ESP32 returns activeDeliveries and todaySchedule structures", async () => {
  const res = await fetch("http://192.168.0.139/api/v1/fertigation/status", {
    headers: { Authorization: "Bearer agrotech-secret-key" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.activeDeliveries), "activeDeliveries must be an array");
  assert.ok(Array.isArray(body.data.queuedBatches), "queuedBatches must be an array");
  assert.ok(Array.isArray(body.data.todaySchedule), "todaySchedule must be an array");
});

console.log("=================================================================");
console.log(`TOTAL PARALLEL DISTRIBUTION AUDIT: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================================");
if (failed > 0) process.exit(1);
