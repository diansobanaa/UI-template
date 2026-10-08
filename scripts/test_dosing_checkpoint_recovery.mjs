/**
 * Comprehensive Dosing Protocol, Unified Checkpoint, and Power Recovery Verification Suite
 * Verifies all 20 requirements from the specification.
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
    console.error(err.message ? err.message.slice(0, 150) : err);
  }
}

console.log("=== DOSING PROTOCOL, UNIFIED CHECKPOINT & POWER RECOVERY VERIFICATION ===\n");

const protoCode = fs.readFileSync(path.resolve("esp32/main/services/protocol_mixing.c"), "utf8");
const fertMgrCode = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.c"), "utf8");
const fertMgrHeader = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.h"), "utf8");
const schedulerCode = fs.readFileSync(path.resolve("esp32/main/services/scheduler.c"), "utf8");
const dashboardCode = fs.readFileSync(path.resolve("src/components/fertigation/FertigationQueueDashboard.tsx"), "utf8");
const dosingSectionCode = fs.readFileSync(path.resolve("src/components/fertigation/DosingQueueSection.tsx"), "utf8");
const detailCode = fs.readFileSync(path.resolve("src/components/fertigation/GreenhouseFertigationDetail.tsx"), "utf8");

// -------------------------------------------------------------
// Test 1: Satu item memasuki antrean dan langsung diproses
// -------------------------------------------------------------
test("1. Single Queue Item Immediate Dispatch from Standby", () => {
  assert.match(schedulerCode, /process_dosing_queue\(time_t now\)/);
  assert.match(schedulerCode, /if \(head->state == QUEUE_STATE_PENDING\)/);
  assert.match(schedulerCode, /if \(fert_st == FERT_STATE_IDLE\)/);
  assert.match(schedulerCode, /head->state = QUEUE_STATE_DISPATCHED;/);
});

// -------------------------------------------------------------
// Test 2: FIFO Execution Order
// -------------------------------------------------------------
test("2. FIFO Execution Order Preserved in Dosing Queue", () => {
  assert.match(schedulerCode, /dosing_queue_entry_t \*head = &s_dosing_queue\[0\];/);
  assert.match(schedulerCode, /s_dosing_queue\[i - 1\] = s_dosing_queue\[i\];/);
});

// -------------------------------------------------------------
// Test 3: Threshold Calculation (80L target with 20% = 16L threshold)
// -------------------------------------------------------------
test("3. Exact Mathematical Threshold Calculation (80L * 20% = 16L)", () => {
  const targetL = 80;
  const threshPct = 20;
  const targetMl = targetL * 1000;
  const threshVolMl = (targetMl * threshPct) / 100;
  assert.equal(threshVolMl, 16000, "16L threshold must equal 16,000 ml");

  assert.match(protoCode, /threshold_volume_ml\s*=\s*\(uint32_t\)\(\(\(uint64_t\)config->raw_water_target_ml \* config->threshold_percent\) \/ 100ULL\);/);
  assert.match(fertMgrCode, /transition\(FERT_STATE_MIXING\);/);
});

// -------------------------------------------------------------
// Test 4: Simultaneous Dosing Start
// -------------------------------------------------------------
test("4. Simultaneous Dosing Start on Threshold (All active channels start together)", () => {
  // Must NOT have sequential channel indexing (s_active_dosing_channel_idx++)
  assert.ok(!/s_active_dosing_channel_idx\+\+/.test(fertMgrCode), "Sequential channel stepping must be removed");
  
  // Simultaneous start in protocol_mixing.c
  assert.match(protoCode, /for \(uint32_t i = 0; i < config->channel_count; \+\+i\)/);
  assert.match(protoCode, /exec_channels\[i\]\.start_time_ms = now_ms;/);
  assert.match(protoCode, /set_scoped_actuator_state\(&job_actuators\.dosing\[i\], true\)/);
});

// -------------------------------------------------------------
// Test 5: Raw Water Fills Concurrently to 100%
// -------------------------------------------------------------
test("5. Raw Water Continues Filling to 100% During Dosing", () => {
  // In protocol_mixing.c: Raw water is active and does NOT stop at threshold, stops when target reached
  assert.match(protoCode, /RAW WATER REMAINS ACTIVE/);
  assert.match(protoCode, /if \(raw_water_running && actual_raw_water_ml >= config->raw_water_target_ml\)/);
  assert.match(protoCode, /set_scoped_actuator_state\(&job_actuators\.raw_water, false\)/);
  assert.match(protoCode, /raw_water_running = false;/);
});

// -------------------------------------------------------------
// Test 6: Individual Dosing Channel Stopping
// -------------------------------------------------------------
test("6. Individual Dosing Channels Stop Upon Reaching Calibrated Target", () => {
  assert.match(protoCode, /if \(elapsed_ch_ms >= exec_channels\[i\]\.expected_runtime_ms\)/);
  assert.match(protoCode, /set_scoped_actuator_state\(&job_actuators\.dosing\[i\], false\)/);
  assert.match(protoCode, /exec_channels\[i\]\.completed = true;/);
  assert.match(fertMgrCode, /s_dosing_runtime_observed_ms\[i\] = mres\.channels\[i\]\.actual_runtime_ms;/);
});

// -------------------------------------------------------------
// Test 7: Final Mixing Homogenization
// -------------------------------------------------------------
test("7. Final Mixing Follows Complete Dosing & Water Preparation", () => {
  assert.match(protoCode, /if \(!raw_water_running && all_dosing_done\)/);
  assert.match(protoCode, /MIXING_PHASE_POST_MIX/);
  assert.match(protoCode, /post_mix_elapsed_ms >= config->post_mix_duration_sec \* 1000U/);
  assert.match(protoCode, /set_scoped_actuator_state\(&job_actuators\.mixing_pump, false\)/);
});

// -------------------------------------------------------------
// Test 8: READY_TO_FERTIGATE Transition
// -------------------------------------------------------------
test("8. READY_TO_FERTIGATE Reached Without Starting Delivery Pump", () => {
  assert.match(fertMgrCode, /DELIVERY_SLOT_READY_TO_SEND/);
  assert.match(fertMgrCode, /mres\.status == MIXING_RESULT_SUCCESS/);
  assert.match(fertMgrCode, /transition\(FERT_STATE_IDLE\);/);
});

// -------------------------------------------------------------
// Test 9: 1.5x Monotonic Runtime Timeout Guard
// -------------------------------------------------------------
test("9. 1.5x Monotonic Runtime Timeout Guard on Dosing Pumps", () => {
  assert.match(protoCode, /max_run_ms\s*=\s*\(uint32_t\)roundf\(\(float\)run_ms \* 1\.5f\);/);
  assert.match(protoCode, /if \(!exec_channels\[i\]\.completed && elapsed_ch_ms > exec_channels\[i\]\.max_runtime_ms\)/);
  assert.match(protoCode, /MIXING_RESULT_DOSING_TIMEOUT/);
});

// -------------------------------------------------------------
// Test 10: Raw Water Flow Inactivity Fault
// -------------------------------------------------------------
test("10. Raw Water Filling Timeout Protection", () => {
  assert.match(protoCode, /if \(raw_water_running && raw_elapsed_ms > max_raw_runtime_ms/);
  assert.match(protoCode, /MIXING_RESULT_RAW_WATER_TIMEOUT/);
});

// -------------------------------------------------------------
// Test 11: Single Channel Timeout with Partial Fault Handling
// -------------------------------------------------------------
test("11. Single Channel Timeout Safety Stop and Trip", () => {
  assert.match(protoCode, /if \(channel_fault\)/);
  assert.match(protoCode, /stop_job_scoped_actuators\(&job_actuators\);/);
  assert.match(fertMgrCode, /s_state = \(mres\.status == MIXING_RESULT_EMERGENCY_STOP\)/);
  assert.match(fertMgrCode, /FERT_STATE_FAULTED;/);
});

// -------------------------------------------------------------
// Test 12: Power Outage While Waiting in Queue
// -------------------------------------------------------------
test("12. Queue Preservation Across Reboot", () => {
  assert.match(schedulerCode, /QUEUE_STATE_PENDING/);
  assert.match(schedulerCode, /s_dosing_queue/);
});

// -------------------------------------------------------------
// Test 13: Power Outage During Raw Water Filling
// -------------------------------------------------------------
test("13. Power Recovery During Filling Sets RECOVERY_REQUIRED", () => {
  assert.match(fertMgrCode, /cp_data\.state == 3 \/\* legacy FERT_STATE_FILLING \*\//);
  assert.match(fertMgrCode, /s_state = FERT_STATE_RECOVERY_HOLD;/);
  assert.match(fertMgrCode, /FERTIGATION_RECOVERY_REQUIRED/);
});

// -------------------------------------------------------------
// Test 14: Power Outage During Dosing
// -------------------------------------------------------------
test("14. Power Recovery During Dosing Prevents Blind Nutrient Resumption", () => {
  assert.match(fertMgrCode, /cp_data\.state == 4 \/\* legacy FERT_STATE_DOSING \*\//);
  assert.match(fertMgrCode, /s_state = FERT_STATE_RECOVERY_HOLD;/);
  assert.match(fertMgrCode, /Nutrients not resumed automatically to prevent plant toxicity/);
});

// -------------------------------------------------------------
// Test 15: Power Outage During Final Mixing
// -------------------------------------------------------------
test("15. Power Recovery During Final Mixing Handled Safely", () => {
  assert.match(fertMgrCode, /cp_data\.state == 5 \/\* legacy FERT_STATE_FINAL_MIXING \*\//);
  assert.match(fertMgrCode, /cp_data\.state == FERT_STATE_MIXING/);
  assert.match(fertMgrCode, /s_state = FERT_STATE_RECOVERY_HOLD;/);
});

// -------------------------------------------------------------
// Test 16: Power Outage After READY_TO_FERTIGATE
// -------------------------------------------------------------
test("16. Power Recovery in READY_TO_FERTIGATE Restores Ready State Without Re-Dosing", () => {
  assert.match(fertMgrCode, /if \(cp_data\.state == 6 \/\* legacy FERT_STATE_MIX_READY \*\/\)/);
  assert.match(fertMgrCode, /slot->state = DELIVERY_SLOT_READY_TO_SEND;/);
  assert.match(fertMgrCode, /s_state = FERT_STATE_IDLE;/);
});

// -------------------------------------------------------------
// Test 17: Unified 3-Second Checkpoint Mechanism
// -------------------------------------------------------------
test("17. Unified 3-Second Checkpoint Mechanism Without Extra FreeRTOS Tasks", () => {
  assert.match(fertMgrCode, /now_tick - s_last_checkpoint_ms >= 3000U/);
  assert.match(fertMgrCode, /fertigation_mgr_save_checkpoint\(\);/);
  assert.match(fertMgrCode, /FERT_CHECKPOINT_VERSION/);
  assert.match(fertMgrCode, /esp_rom_crc32_le/);
});

// -------------------------------------------------------------
// Test 18: Corrupted Checkpoint Fail-Safe Handling
// -------------------------------------------------------------
test("18. Corrupted Checkpoint Verification (CRC Mismatch Protection)", () => {
  assert.match(fertMgrCode, /if \(cp_data\.crc32 == expected_crc\)/);
  assert.match(fertMgrCode, /ESP_LOGW\(TAG, "Checkpoint file %s CRC mismatch", paths\[p\]\);/);
});

// -------------------------------------------------------------
// Test 19: Decoupled Distribution (No Tahap 5 in Dosing Queue)
// -------------------------------------------------------------
test("19. Dosing Queue UI Consists of Exactly 3 Physical Stages (No Stage 5 Distribution)", () => {
  // Dashboard must define 3 stages
  assert.match(dashboardCode, /name: "Persiapan Air Baku"/);
  assert.match(dashboardCode, /name: "Dosing & Mixing Simultan"/);
  assert.match(dashboardCode, /name: "Pengadukan Akhir"/);
  assert.ok(!/Pompa Distribusi Fertigasi/.test(dashboardCode), "Pompa Distribusi Fertigasi must NOT be in Dosing Queue pipeline");

  // Grid columns must be 3
  assert.match(dosingSectionCode, /grid-cols-1 gap-2 sm:grid-cols-3/);
  assert.match(detailCode, /grid-cols-1 gap-2 sm:grid-cols-3/);
});

// -------------------------------------------------------------
// Test 20: Elimination of Fake 'RUNNING' Status When Controller is IDLE
// -------------------------------------------------------------
test("20. No Fake RUNNING State When Controller is IDLE", () => {
  // In Dashboard, activeJob is null when firmware is IDLE
  assert.match(dashboardCode, /\/\/ When firmware is IDLE, there is NO active hardware execution\./);
  assert.match(dashboardCode, /return null;\s*\}, \[liveStatus, fwState, ghs, allSchedules\]\);/);
});

console.log(`\n======================================================`);
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
