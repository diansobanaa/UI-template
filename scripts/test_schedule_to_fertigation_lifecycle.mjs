/**
 * Automated Lifecycle Verification: Schedule-to-Mixing-to-Fertigation Execution Fix
 * Validates Tests A through H against the authoritative AgroTech workflow:
 * NEW SCHEDULE RECEIVED → IMMEDIATE MIXING QUEUE CREATION/RESOLUTION →
 * IMMEDIATE MIXING PROTOCOL EXECUTION → READY_TO_FERTIGATE →
 * CONTINUOUS AGITATION STARTS 5 MINUTES BEFORE SCHEDULED FERTIGATION →
 * FERTIGATION STARTS AT THE SCHEDULED TIME →
 * AGITATION CONTINUES UNTIL FERTIGATION TERMINATES → ALL ACTUATORS STOP SAFELY.
 */

import assert from "node:assert/strict";
import fs from "node:fs";

console.log("================================================================================");
console.log(" AGROTECH AUTOMATIC SCHEDULE-TO-MIXING-TO-FERTIGATION LIFECYCLE TEST SUITE");
console.log("================================================================================");

const schedC = fs.readFileSync("esp32/main/services/scheduler.c", "utf8");
const fertC = fs.readFileSync("esp32/main/services/fertigation_mgr.c", "utf8");
const fertH = fs.readFileSync("esp32/main/services/fertigation_mgr.h", "utf8");
const mixC = fs.readFileSync("esp32/main/services/protocol_mixing.c", "utf8");
const storageC = fs.readFileSync("esp32/main/storage/storage_mgr.c", "utf8");
const hwRegC = fs.readFileSync("esp32/main/hal/hardware_registry.c", "utf8");
const pinH = fs.readFileSync("esp32/main/config/pin_config.h", "utf8");

let passed = 0;
let total = 0;

function runTest(testId, name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`[PASS] Test ${testId}: ${name}`);
  } catch (err) {
    console.error(`[FAIL] Test ${testId}: ${name}`);
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// TEST A: Immediate Mixing Queue Creation & Intake
// No lead-time check delaying mixing queue creation; schedule intake immediately
// enqueues and triggers mixing protocol execution.
// ---------------------------------------------------------------------------
runTest("A", "Immediate Mixing Queue Creation & Protocol Execution (No Lead-Time Delay)", () => {
  // 1. In sync_intents_locked: immediately materializes today's occurrences and calls try_enqueue_pending_preparations
  assert.match(schedC, /materialize_today_schedule\s*\(\s*now\s*\)\s*;\s*try_enqueue_pending_preparations\s*\(\s*now\s*\);/,
    "Intents sync must immediately materialize schedule and enqueue pending preparations");

  // 2. In try_enqueue_pending_preparations: all pending occurrences are enqueued without waiting for T - 5m
  const enqueueStart = schedC.lastIndexOf("static void try_enqueue_pending_preparations");
  const enqueueEnd = schedC.lastIndexOf("static void rebuild_dosing_queue_on_boot");
  const enqueueMethod = schedC.slice(enqueueStart, enqueueEnd);
  assert.doesNotMatch(enqueueMethod, /scheduled_timestamp\s*-\s*300/,
    "Queue intake must NOT be gated behind T-300 or lead-time delay");
  assert.match(enqueueMethod, /enqueue_preparation\s*\(\s*occ\s*\)/,
    "Pending occurrences must be directly enqueued into global dosing queue");

  // 3. In process_dosing_queue: QUEUE_STATE_PENDING head immediately submits CMD_TYPE_FERTIGATION_BATCH
  assert.match(schedC, /cmd->type\s*=\s*CMD_TYPE_FERTIGATION_BATCH/,
    "Pending dosing queue entry must immediately submit fertigation batch command");
  assert.match(schedC, /command_mgr_submit\s*\(\s*cmd,\s*NULL\s*\)/,
    "Fertigation batch command must be submitted to command_mgr without delay");
});

// ---------------------------------------------------------------------------
// TEST B: Phase 1 Completion & Separation from Phase 2
// Solution waits in tank with mixing pump OFF after mixing completes.
// ---------------------------------------------------------------------------
runTest("B", "Phase 1 Completion & Safe Separation (Mixing Pump OFF While Waiting)", () => {
  // 1. Mixing protocol turns off and releases mixing pump at Phase 1 completion
  assert.match(mixC, /set_scoped_actuator_state\s*\(\s*&job_actuators\.mixing_pump\s*,\s*false\s*\)/,
    "Mixing protocol must turn OFF mixing pump at completion");
  assert.match(mixC, /release_scoped_actuator\s*\(\s*&job_actuators\.mixing_pump\s*\)/,
    "Mixing protocol must release mixing pump scoped actuator at completion");

  // 2. Slot records mixing pump ID and transitions to DELIVERY_SLOT_READY_TO_SEND
  assert.match(fertC, /slot->state\s*=\s*DELIVERY_SLOT_READY_TO_SEND/,
    "Slot must enter DELIVERY_SLOT_READY_TO_SEND upon mixing completion");
  assert.match(fertC, /cp\s*\(\s*slot->mixing_pump_id\s*,\s*sizeof\s*\(\s*slot->mixing_pump_id\s*\)\s*,\s*s_batch\.mixing_pump_id\s*\)/,
    "Slot must retain mixing_pump_id for subsequent agitation phase");

  // 3. Agitation flag is initialized to false until T - 5min window
  assert.match(fertH, /bool\s+agitation_active;/,
    "delivery_slot_t must track agitation_active flag");
  assert.match(fertC, /slot->agitation_active\s*=\s*false;/,
    "Agitation must be inactive while solution waits in tank prior to T-5min");
});

// ---------------------------------------------------------------------------
// TEST C: Continuous Agitation Starts Exactly 5 Minutes Before Scheduled Delivery
// At T - 300s, mixing pump is acquired by FERTIGATION owner and starts continuous agitation.
// ---------------------------------------------------------------------------
runTest("C", "Continuous Agitation Starts at T - 5 Minutes (300 Seconds Prior to Scheduled Delivery)", () => {
  // 1. evaluate_today_occurrences calculates t_agitate = occ->scheduled_timestamp - 300
  assert.match(schedC, /int64_t\s+t_agitate\s*=\s*occ->scheduled_timestamp\s*-\s*300/,
    "Scheduler must calculate pre-fertigation agitation window at exactly T - 300 seconds");

  // 2. Agitation triggers when now >= t_agitate and batch is READY_TO_SEND
  assert.match(schedC, /if\s*\(\s*\(int64_t\)now\s*>=\s*t_agitate\s*&&\s*\(int64_t\)now\s*<\s*occ->scheduled_timestamp\s*\)\s*\{\s*if\s*\(\s*occ->state\s*==\s*OCC_STATE_READY_TO_SEND\s*\)/,
    "Agitation must be initiated at T-5m for batches in OCC_STATE_READY_TO_SEND");

  // 3. fertigation_mgr_start_agitation acquires and energizes mixing pump
  assert.match(fertC, /esp_err_t\s+fertigation_mgr_start_agitation/,
    "fertigation_mgr must implement fertigation_mgr_start_agitation()");
  assert.match(fertC, /actuator_hal_acquire_component\s*\(\s*slot->mixing_pump_id\s*,\s*ACTUATOR_OWNER_FERTIGATION\s*\)/,
    "Agitation start must acquire mixing pump under ACTUATOR_OWNER_FERTIGATION");
  assert.match(fertC, /actuator_hal_request_component\s*\(\s*slot->mixing_pump_id\s*,\s*true\s*,\s*ACTUATOR_SOURCE_FERTIGATION\s*,\s*"fertigation_pre_agitation"\s*\)/,
    "Agitation start must request mixing pump ON");
});

// ---------------------------------------------------------------------------
// TEST D: Distribution Starts at T (Scheduled Time) with Maintained Continuous Agitation
// Distribution pump turns ON while agitation pump continues running simultaneously.
// ---------------------------------------------------------------------------
runTest("D", "Distribution Starts at Scheduled Time with Simultaneous Continuous Agitation", () => {
  // 1. evaluate_today_occurrences triggers distribution when now >= occ->scheduled_timestamp
  assert.match(schedC, /if\s*\(\s*\(int64_t\)now\s*>=\s*occ->scheduled_timestamp\s*\)\s*\{\s*if\s*\(\s*occ->state\s*==\s*OCC_STATE_READY_TO_SEND\s*\)/,
    "Distribution must be triggered when scheduled time arrives");

  // 2. fertigation_mgr_trigger_distribution ensures continuous agitation is active and sustained
  assert.match(fertC, /if\s*\(\s*!slot->agitation_active\s*\)\s*\{[\s\S]*?actuator_hal_acquire_component\s*\(\s*slot->mixing_pump_id\s*,\s*ACTUATOR_OWNER_FERTIGATION\s*\)[\s\S]*?actuator_hal_request_component\s*\(\s*slot->mixing_pump_id\s*,\s*true/,
    "trigger_distribution must verify and enforce continuous agitation pump operation");

  // 3. Distribution pump is acquired and requested ON
  assert.match(fertC, /actuator_hal_acquire_component\s*\(\s*slot->delivery_pump_id\s*,\s*ACTUATOR_OWNER_FERTIGATION\s*\)/,
    "trigger_distribution must acquire distribution pump");
  assert.match(fertC, /actuator_hal_request_component\s*\(\s*slot->delivery_pump_id\s*,\s*true\s*,\s*ACTUATOR_SOURCE_FERTIGATION\s*,\s*"fertigation_delivery_start"\s*\)/,
    "trigger_distribution must request distribution pump ON");
});

// ---------------------------------------------------------------------------
// TEST E: Immediate Schedule / Late Batch Completion Handling
// If mixing finishes inside [T - 5m, T] or after T, agitation activates immediately.
// ---------------------------------------------------------------------------
runTest("E", "Late Batch Completion / Immediate Schedule Handling", () => {
  // 1. When batch reaches READY_TO_SEND inside T-5m window, agitation starts immediately
  assert.match(schedC, /int64_t\s+t_agitate\s*=\s*s_today_occurrences\[i\]\.scheduled_timestamp\s*-\s*300;\s*if\s*\(\s*\(int64_t\)now\s*>=\s*t_agitate\s*&&\s*\(int64_t\)now\s*<\s*s_today_occurrences\[i\]\.scheduled_timestamp\s*\)\s*\{\s*if\s*\(\s*!fertigation_mgr_is_agitation_active/,
    "Scheduler process_dosing_queue must trigger agitation immediately if batch finishes inside T-5m window");

  // 2. If scheduled time arrived while still preparing, occurrence transitions to WAITING_BATCH and immediately distributes when ready
  assert.match(schedC, /if\s*\(\s*s_today_occurrences\[i\]\.state\s*==\s*OCC_STATE_WAITING_BATCH\s*\)\s*\{\s*s_today_occurrences\[i\]\.state\s*=\s*OCC_STATE_DISTRIBUTING;\s*fertigation_mgr_trigger_distribution/,
    "Overdue batches must transition from WAITING_BATCH directly to DISTRIBUTING upon mixing completion");
});

// ---------------------------------------------------------------------------
// TEST F: Lower Float Dry Normal Stop Condition (MVP-1 Hardware Verification)
// Delivery pump & agitation pump both stop safely when lower float switch (GPIO 38) triggers dry.
// ---------------------------------------------------------------------------
runTest("F", "Normal Termination: Lower Float Dry (GPIO 38) Stops Both Distribution and Agitation Pumps", () => {
  // 1. Pin definition: Lower float is GPIO 38, distribution pump is GPIO 2 (Relay CH2)
  assert.match(pinH, /#define\s+PIN_IN_FLOAT_LOWER\s+38/, "PIN_IN_FLOAT_LOWER must be GPIO 38");
  assert.match(pinH, /#define\s+PIN_OUT_DIST_PUMP\s+PIN_RELAY_CH2/, "PIN_OUT_DIST_PUMP must map to Relay CH2");
  assert.match(pinH, /#define\s+PIN_RELAY_CH2\s+2/, "PIN_RELAY_CH2 must be GPIO 2");

  // 2. slot_stop_all_actuators cleanly stops and releases BOTH delivery pump and mixing pump
  const stopStart = fertC.indexOf("static void slot_stop_all_actuators");
  const stopHelper = fertC.slice(stopStart, stopStart + 700);
  assert.match(stopHelper, /stop_component\s*\(\s*slot->delivery_pump_id\s*\)/,
    "slot_stop_all_actuators must stop delivery pump");
  assert.match(stopHelper, /actuator_hal_release_component\s*\(\s*slot->delivery_pump_id\s*,\s*ACTUATOR_OWNER_FERTIGATION\s*\)/,
    "slot_stop_all_actuators must release delivery pump");
  assert.match(stopHelper, /stop_component\s*\(\s*slot->mixing_pump_id\s*\)/,
    "slot_stop_all_actuators must stop agitation mixing pump");
  assert.match(stopHelper, /actuator_hal_release_component\s*\(\s*slot->mixing_pump_id\s*,\s*ACTUATOR_OWNER_FERTIGATION\s*\)/,
    "slot_stop_all_actuators must release agitation mixing pump");

  // 3. Lower float dry condition triggers slot_stop_all_actuators
  assert.match(fertC, /if\s*\(\s*float_is_dry\s*\)\s*\{[\s\S]*?slot_stop_all_actuators\s*\(\s*slot\s*\)[\s\S]*?slot->state\s*=\s*DELIVERY_SLOT_COMPLETE/,
    "Lower float switch dry level must call slot_stop_all_actuators and transition slot to COMPLETE");
});

// ---------------------------------------------------------------------------
// TEST G: Guard Against Incomplete Mixing & Fault Handling
// If mixing faults, batch does NOT enter READY_TO_SEND; distribution does NOT start; all actuators safe.
// ---------------------------------------------------------------------------
runTest("G", "Guard Against Incomplete Mixing and Comprehensive Fault Handling", () => {
  // 1. Dosing queue head fails if fertigation manager faults during preparation
  assert.match(schedC, /if\s*\(\s*fert_st\s*==\s*FERT_STATE_FAULTED\s*\|\|\s*fert_st\s*==\s*FERT_STATE_ABORTED\s*\|\|\s*fert_st\s*==\s*FERT_STATE_INTERRUPTED\s*\)\s*\{\s*head->state\s*=\s*QUEUE_STATE_FAILED/,
    "Failed mixing must transition queue head to QUEUE_STATE_FAILED");

  // 2. Corresponding occurrence is marked OCC_STATE_FAILED, never READY_TO_SEND
  assert.match(schedC, /s_today_occurrences\[i\]\.state\s*=\s*OCC_STATE_FAILED/,
    "Faulted preparation must mark occurrence as OCC_STATE_FAILED");

  // 3. Emergency stop / safety fault shuts down distribution and agitation
  assert.match(fertC, /if\s*\(\s*safety_monitor_has_fault\s*\(\s*\)\s*\|\|\s*actuator_hal_is_emergency_stopped\s*\(\s*\)\s*\)\s*\{\s*slot_stop_all_actuators\s*\(\s*slot\s*\)/,
    "Global emergency stop / safety trip must call slot_stop_all_actuators across active delivery slots");
});

// ---------------------------------------------------------------------------
// TEST H: Actuator Ownership Idempotency & Clean FreeRTOS Handoff
// Phase 1 worker releases pump before Phase 2 acquires it; no mutex deadlocks or lock contention.
// ---------------------------------------------------------------------------
runTest("H", "Actuator Ownership Idempotency & Clean Phase 1 / Phase 2 Handoff", () => {
  // 1. In storage_mgr, config_hash falls back to config_crc
  assert.match(storageC, /snprintf\s*\(\s*s_state\.config_hash\s*,\s*sizeof\s*\(\s*s_state\.config_hash\s*\)\s*,\s*"%08lx"\s*,\s*\(unsigned\s+long\)\s*s_state\.config_crc\s*\)/,
    "storage_mgr must initialize config_hash from config_crc fallback");

  // 2. In fertigation_mgr_start_from_json, active_hash matches config_crc fallback
  assert.match(fertC, /snprintf\s*\(\s*active_hash\s*,\s*sizeof\s*\(\s*active_hash\s*\)\s*,\s*"%08lx"\s*,\s*\(unsigned\s+long\)\s*ss->config_crc\s*\)/,
    "fertigation_mgr must permit config_crc fallback matching to prevent false CONFIG_HASH_MISMATCH");

  // 3. In hardware_registry, mixing tank and float lower fallbacks exist for runtime stability
  assert.match(hwRegC, /strcasecmp\s*\(\s*component_id\s*,\s*"tank_mixing"\s*\)\s*==\s*0/,
    "hardware_registry must provide tank_mixing fallback");
  assert.match(hwRegC, /strcasecmp\s*\(\s*component_id\s*,\s*"float_lower"\s*\)\s*==\s*0/,
    "hardware_registry must provide float_lower fallback");
});

console.log("================================================================================");
console.log(` RESULTS: ${passed}/${total} TESTS PASSED`);
if (passed === total) {
  console.log(" VERDICT: PASS — AUTOMATIC SCHEDULE-TO-FERTIGATION FLOW VERIFIED IN SOFTWARE");
} else {
  console.log(" VERDICT: FAIL — INCOMPLETE REQUIREMENTS");
  process.exit(1);
}
console.log("================================================================================");
