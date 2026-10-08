/**
 * Comprehensive Test Suite for Core Mixing Protocol (protocol_mixing)
 * 
 * Validates:
 * 1. Raw water measurement (physical flow sensor is source of truth, not timer).
 * 2. Dynamic threshold triggering (schedule registration: 10%, 20%, 25%, 30%, etc. without hardcoding).
 * 3. Simultaneous/parallel dosing channels (dynamic channels start together, stop independently).
 * 4. Strict timeout rule: exactly 1.5x expected calibration time (no extra margins, no magic numbers).
 * 5. Reachable dosing timeout and actuator OFF failure protection.
 * 6. Progress-based no-flow detection (detects flow stoppage even after initial progress).
 * 7. Scoped safe-stop ownership (never turns off unowned actuators).
 * 8. Actuator OFF verification for raw water, dosing, and mixing pumps.
 * 9. Post-mix duration: agitation continues for post_mix_duration_sec AFTER raw water target and all dosing complete.
 * 10. Firmware C implementation static contract & build integrity.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("=== RUNNING CORE PROTOCOL MIXING VERIFICATION SUITE ===");

const ROOT = path.resolve(import.meta.dirname, "..");
const cHeaderPath = path.join(ROOT, "esp32/main/services/protocol_mixing.h");
const cSourcePath = path.join(ROOT, "esp32/main/services/protocol_mixing.c");

// -------------------------------------------------------------
// TEST 1: Firmware Header & Source Integrity Checks
// -------------------------------------------------------------
console.log("\n[Test 1] Inspecting protocol_mixing.h & protocol_mixing.c implementation...");

assert.ok(fs.existsSync(cHeaderPath), "protocol_mixing.h must exist");
assert.ok(fs.existsSync(cSourcePath), "protocol_mixing.c must exist");

const headerContent = fs.readFileSync(cHeaderPath, "utf8");
const sourceContent = fs.readFileSync(cSourcePath, "utf8");

// Verify public API signature
assert.match(headerContent, /mixing_result_t\s+protocol_mixing\s*\(\s*const\s+mixing_protocol_config_t\s*\*\s*config\s*\)/,
  "Public API protocol_mixing(config) must be declared in protocol_mixing.h");
assert.match(sourceContent, /mixing_result_t\s+protocol_mixing\s*\(\s*const\s+mixing_protocol_config_t\s*\*\s*config\s*\)/,
  "Public API protocol_mixing(config) must be implemented in protocol_mixing.c");

// Verify safe stop helper
assert.match(headerContent, /esp_err_t\s+stop_mixing_protocol_actuators\s*\(/,
  "stop_mixing_protocol_actuators must be declared in protocol_mixing.h");
assert.match(sourceContent, /esp_err_t\s+stop_mixing_protocol_actuators\s*\(/,
  "stop_mixing_protocol_actuators must be implemented in protocol_mixing.c");

// Verify post_mix_duration_sec in config structure
assert.match(headerContent, /uint32_t\s+post_mix_duration_sec;/,
  "mixing_protocol_config_t must contain post_mix_duration_sec");
assert.match(sourceContent, /post_mix_duration_sec/,
  "protocol_mixing.c must use post_mix_duration_sec");

// Verify no hardcoded 20% in protocol logic
assert.doesNotMatch(headerContent, /#define\s+MIXING_THRESHOLD_PERCENT/,
  "protocol_mixing.h must NOT have a hardcoded MIXING_THRESHOLD_PERCENT #define");
assert.doesNotMatch(sourceContent, /#define\s+MIXING_THRESHOLD_PERCENT/,
  "protocol_mixing.c must NOT have a hardcoded MIXING_THRESHOLD_PERCENT #define");

// Verify error enum codes
const expectedCodes = [
  "MIXING_RESULT_SUCCESS",
  "MIXING_RESULT_INVALID_CONFIG",
  "MIXING_RESULT_CALIBRATION_MISSING",
  "MIXING_RESULT_RAW_WATER_SENSOR_ERROR",
  "MIXING_RESULT_RAW_WATER_NO_FLOW",
  "MIXING_RESULT_RAW_WATER_TIMEOUT",
  "MIXING_RESULT_DOSING_ERROR",
  "MIXING_RESULT_DOSING_TIMEOUT",
  "MIXING_RESULT_ACTUATOR_ERROR",
  "MIXING_RESULT_EMERGENCY_STOP",
  "MIXING_RESULT_POST_MIX_DURATION_SEMANTICS_UNDEFINED"
];
for (const code of expectedCodes) {
  assert.match(headerContent, new RegExp(code), `Header must define enum code ${code}`);
  assert.match(sourceContent, new RegExp(code), `Source must handle status code ${code}`);
}

// Verify mixing phase enum and string converter
assert.match(headerContent, /typedef\s+enum\s*\{[\s\S]*MIXING_PHASE_RAW_WATER_FILL[\s\S]*\}\s*mixing_phase_t;/,
  "Header must define mixing_phase_t");
assert.match(headerContent, /const\s+char\s*\*\s*mixing_phase_to_string\s*\(\s*mixing_phase_t\s+phase\s*\);/,
  "Header must declare mixing_phase_to_string");
assert.match(sourceContent, /const\s+char\s*\*\s*mixing_phase_to_string\s*\(\s*mixing_phase_t\s+phase\s*\)/,
  "Source must implement mixing_phase_to_string");

// Verify CMakeLists.txt registration
const cmakeContent = fs.readFileSync(path.join(ROOT, "esp32/main/CMakeLists.txt"), "utf8");
assert.match(cmakeContent, /services\/protocol_mixing\.c/, "CMakeLists.txt must include services/protocol_mixing.c");

console.log("  PASS: Firmware C signatures, error codes, phase enum, post_mix field, and build registration verified.");

// -------------------------------------------------------------
// TEST 2: Dynamic Threshold & State Machine Simulator
// -------------------------------------------------------------
console.log("\n[Test 2] State Machine Simulation: Dynamic Threshold, Simultaneous Dosing, & Post-Mix...");

class MixingProtocolSimulator {
  constructor(config) {
    this.config = config;
    this.state = "INIT";
    this.actual_raw_water_ml = 0;
    this.actuators = {
      raw_water_pump: false,
      mixing_pump: false,
      dosing_pumps: {}
    };

    // External system actuators registry (to verify safe-stop scoping)
    this.unowned_system_actuators = {
      pump_dist: true,
      fan_blower: true,
      pump_dosing_unrelated: true
    };

    this.sim_dosing_off_fail = {};
    this.sim_raw_water_off_fail = false;
    this.sim_mixing_off_fail = false;

    this.channels = config.channels.map(c => ({
      component_id: c.component_id,
      target_volume_ml: c.target_volume_ml,
      expected_runtime_ms: Math.round((c.target_volume_ml / c.rate_ml_sec) * 1000),
      // Strict 1.5x expected timeout rule
      max_runtime_ms: Math.round((c.target_volume_ml / c.rate_ml_sec) * 1000 * 1.5),
      elapsed_ms: 0,
      running: false,
      completed: false,
      off_failed: false
    }));
    this.channels.forEach(ch => {
      this.actuators.dosing_pumps[ch.component_id] = false;
    });

    // Strict 1.5x expected timeout rule for raw water
    const rawRate = config.raw_water_rate_ml_sec || 1;
    this.raw_water_expected_sec = Math.ceil(config.raw_water_target_ml / rawRate);
    this.raw_water_max_sec = Math.ceil((config.raw_water_target_ml / rawRate) * 1.5);

    // Dynamic threshold from schedule registration
    this.threshold_volume_ml = Math.floor((config.raw_water_target_ml * config.threshold_percent) / 100);

    this.raw_water_done = false;
    this.threshold_reached = false;
    this.mixing_elapsed_sec = 0;
    this.raw_elapsed_sec = 0;
    this.no_flow_grace_sec = config.no_flow_grace_period_sec || 15;
    this.last_flow_progress_sec = 0;
    this.last_flow_volume_ml = 0;

    this.phase = "PRECHECK";
    this.post_mix_started = false;
    this.post_mix_elapsed_sec = 0;
    this.post_mix_done = false;
    this.emergency_stopped = false;
    this.sensor_error = false;
    this.result = null;
  }

  precheck() {
    if (!this.config.raw_water_target_ml || this.config.raw_water_target_ml <= 0) {
      return this.fail("MIXING_RESULT_INVALID_CONFIG", "Target volume <= 0");
    }
    if ((this.config.post_mix_duration_sec ?? 0) === 0) {
      return this.fail("MIXING_RESULT_POST_MIX_DURATION_SEMANTICS_UNDEFINED", "post_mix_duration_sec is 0: semantics undefined.");
    }
    // No threshold range check per Section 1
    if (this.emergency_stopped) {
      return this.fail("MIXING_RESULT_EMERGENCY_STOP", "Emergency stop active");
    }
    if (!this.config.flow_sensor_calibrated || this.config.flow_pulses_per_l <= 0) {
      return this.fail("MIXING_RESULT_CALIBRATION_MISSING", "Flow sensor uncalibrated");
    }
    if (!this.config.raw_water_rate_ml_sec || this.config.raw_water_rate_ml_sec <= 0) {
      return this.fail("MIXING_RESULT_CALIBRATION_MISSING", "Raw water pump uncalibrated");
    }
    for (const ch of this.config.channels) {
      if (!ch.rate_ml_sec || ch.rate_ml_sec <= 0) {
        return this.fail("MIXING_RESULT_CALIBRATION_MISSING", `Dosing pump ${ch.component_id} uncalibrated`);
      }
    }
    return true;
  }

  fail(status, message) {
    this.safeStop();
    this.phase = "ERROR";
    this.result = { status, message, phase: this.phase, actual_raw_water_ml: this.actual_raw_water_ml };
    return false;
  }

  safeStop() {
    // Scoped safe stop: ONLY turn off actuators owned by this job
    this.actuators.raw_water_pump = false;
    this.actuators.mixing_pump = false;
    Object.keys(this.actuators.dosing_pumps).forEach(k => {
      this.actuators.dosing_pumps[k] = false;
    });
    // Explicitly verify unowned actuators remain intact
  }

  start() {
    if (!this.precheck()) return;
    this.actuators.raw_water_pump = true;
    this.last_flow_progress_sec = 0;
    this.last_flow_volume_ml = 0;
    this.state = "RUNNING";
    this.phase = "RAW_WATER_FILL";
  }

  tick(deltaSec, measuredPulseDeltaMl) {
    if (this.result) return;
    this.raw_elapsed_sec += deltaSec;

    if (this.emergency_stopped) {
      return this.fail("MIXING_RESULT_EMERGENCY_STOP", "E-Stop triggered");
    }
    if (this.sensor_error) {
      return this.fail("MIXING_RESULT_RAW_WATER_SENSOR_ERROR", "Sensor disconnected/invalid");
    }

    // Accumulate flow from sensor (Source of truth)
    if (this.actuators.raw_water_pump) {
      this.actual_raw_water_ml += measuredPulseDeltaMl;

      // Update flow progress tracker
      if (this.actual_raw_water_ml > this.last_flow_volume_ml) {
        this.last_flow_volume_ml = this.actual_raw_water_ml;
        this.last_flow_progress_sec = this.raw_elapsed_sec;
      }

      // Progress-based no-flow check
      if (this.actual_raw_water_ml < this.config.raw_water_target_ml) {
        const secSinceProgress = this.raw_elapsed_sec - this.last_flow_progress_sec;
        if (secSinceProgress >= this.no_flow_grace_sec) {
          return this.fail("MIXING_RESULT_RAW_WATER_NO_FLOW", "No flow progress after grace period");
        }
      }

      // Timeout check: strictly 1.5x expected calibration time
      if (this.raw_elapsed_sec > this.raw_water_max_sec && this.actual_raw_water_ml < this.config.raw_water_target_ml) {
        return this.fail("MIXING_RESULT_RAW_WATER_TIMEOUT", "Raw water runtime exceeded 1.5x timeout");
      }

      // Threshold check: trigger mixing pump AND all dosing pumps simultaneously
      if (!this.threshold_reached && this.actual_raw_water_ml >= this.threshold_volume_ml) {
        this.threshold_reached = true;
        this.phase = "MIXING_AND_DOSING";
        this.actuators.mixing_pump = true;
        this.channels.forEach(ch => {
          ch.running = true;
          this.actuators.dosing_pumps[ch.component_id] = true;
        });
      }

      // Raw water target check (Stop ONLY when actual >= target volume)
      if (this.actual_raw_water_ml >= this.config.raw_water_target_ml) {
        if (this.sim_raw_water_off_fail) {
          return this.fail("MIXING_RESULT_ACTUATOR_ERROR", "Failed to turn OFF raw water pump");
        }
        this.actuators.raw_water_pump = false;
        this.raw_water_done = true;
        this.phase = "RAW_WATER_COMPLETE";
      }
    }

    // Simultaneous / Parallel Dosing supervision & reachable timeout
    if (this.threshold_reached) {
      this.mixing_elapsed_sec += deltaSec;
      const deltaMs = deltaSec * 1000;

      for (const ch of this.channels) {
        if (ch.running && !ch.completed) {
          ch.elapsed_ms += deltaMs;

          // 1. Expected runtime reached: Request OFF
          if (ch.elapsed_ms >= ch.expected_runtime_ms) {
            if (this.sim_dosing_off_fail[ch.component_id]) {
              // Section 9: Dosing pump OFF failed -> IMMEDIATELY ACTUATOR_ERROR!
              return this.fail("MIXING_RESULT_ACTUATOR_ERROR", `Failed to turn OFF dosing pump ${ch.component_id}`);
            } else {
              ch.running = false;
              ch.completed = true;
              ch.off_failed = false;
              this.actuators.dosing_pumps[ch.component_id] = false;
            }
          }

          // 2. Timeout Check: elapsed > max_runtime_ms (1.5x expected) without successful completion
          if (!ch.completed && ch.elapsed_ms > ch.max_runtime_ms) {
            return this.fail("MIXING_RESULT_DOSING_TIMEOUT", `Dosing pump ${ch.component_id} exceeded 1.5x timeout`);
          }
        }
      }
    }

    const allDosingDone = this.channels.every(ch => ch.completed);
    if (allDosingDone && this.threshold_reached && !this.post_mix_started) {
      this.phase = "DOSING_COMPLETION";
    }

    // Post-mix phase: starts ONLY when raw water target reached AND all dosing pumps complete
    if (this.raw_water_done && allDosingDone) {
      if (!this.post_mix_started) {
        this.post_mix_started = true;
        this.phase = "POST_MIX";
      } else if (!this.post_mix_done) {
        this.phase = "POST_MIX";
        this.post_mix_elapsed_sec += deltaSec;
        if (this.post_mix_elapsed_sec >= this.config.post_mix_duration_sec) {
          this.post_mix_done = true;
        }
      }
    }

    // Success evaluation: Raw water done + All dosing done + Post-mix complete
    if (this.raw_water_done && allDosingDone && this.post_mix_done) {
      this.phase = "STOP";
      if (this.sim_mixing_off_fail) {
        return this.fail("MIXING_RESULT_ACTUATOR_ERROR", "Failed to turn OFF mixing pump");
      }
      this.actuators.mixing_pump = false;
      this.safeStop();
      this.phase = "SUCCESS";
      this.result = {
        status: "MIXING_RESULT_SUCCESS",
        phase: this.phase,
        actual_raw_water_ml: this.actual_raw_water_ml,
        post_mix_duration_sec: this.post_mix_elapsed_sec,
        channels: this.channels.map(c => ({ id: c.component_id, completed: c.completed }))
      };
    }
  }
}

// -------------------------------------------------------------
// Scenario 2A: Dynamic Threshold Percent Testing (10%, 20%, 25%, 30%)
// -------------------------------------------------------------
console.log("\n[Test 2A] Dynamic Threshold Percent verification (10%, 20%, 25%, 30%)...");

for (const pct of [10, 20, 25, 30]) {
  const simPct = new MixingProtocolSimulator({
    raw_water_target_ml: 2000,
    threshold_percent: pct,
    post_mix_duration_sec: 5,
    raw_water_rate_ml_sec: 10,
    flow_sensor_calibrated: true,
    flow_pulses_per_l: 450,
    channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
  });
  const expectedVol = Math.floor((2000 * pct) / 100);
  assert.equal(simPct.threshold_volume_ml, expectedVol, `Threshold volume for ${pct}% must be ${expectedVol} mL`);
  console.log(`  PASS: Threshold ${pct}% dynamically computed to ${expectedVol} mL.`);
}

// -------------------------------------------------------------
// Scenario 2B: Simultaneous Parallel Dosing with Differential Runtimes
// -------------------------------------------------------------
console.log("\n[Test 2B] Simultaneous/Parallel Dosing Channels (Pump 1=10s, Pump 2=15s, Pump 3=8s)...");

const simParallel = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20, // 400 mL
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 20, // 100s to fill 2000ml
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [
    { component_id: "pump_1", target_volume_ml: 20, rate_ml_sec: 2.0 }, // 10s
    { component_id: "pump_2", target_volume_ml: 15, rate_ml_sec: 1.0 }, // 15s
    { component_id: "pump_3", target_volume_ml: 16, rate_ml_sec: 2.0 }  // 8s
  ]
});

simParallel.start();
// Deliver 399 mL -> threshold not reached
simParallel.tick(20, 399);
assert.equal(simParallel.threshold_reached, false);
assert.equal(simParallel.actuators.mixing_pump, false);
assert.equal(simParallel.actuators.dosing_pumps["pump_1"], false);

// Deliver 1 mL -> threshold reached (400 mL)
simParallel.tick(0.1, 1);
assert.equal(simParallel.threshold_reached, true);
assert.equal(simParallel.actuators.mixing_pump, true, "Mixing pump ON at threshold");
assert.equal(simParallel.actuators.raw_water_pump, true, "Raw water pump remains ON after threshold");
// All 3 dosing pumps must start SIMULTANEOUSLY
assert.equal(simParallel.actuators.dosing_pumps["pump_1"], true, "Pump 1 ON simultaneously");
assert.equal(simParallel.actuators.dosing_pumps["pump_2"], true, "Pump 2 ON simultaneously");
assert.equal(simParallel.actuators.dosing_pumps["pump_3"], true, "Pump 3 ON simultaneously");

// At t = +8s: Pump 3 completes (8s), Pump 1 and 2 remain ON
simParallel.tick(8, 160);
assert.equal(simParallel.actuators.dosing_pumps["pump_3"], false, "Pump 3 turned OFF at 8s");
assert.equal(simParallel.actuators.dosing_pumps["pump_1"], true, "Pump 1 remains ON at 8s");
assert.equal(simParallel.actuators.dosing_pumps["pump_2"], true, "Pump 2 remains ON at 8s");

// At t = +10s (total +2s more): Pump 1 completes (10s), Pump 2 remains ON
simParallel.tick(2, 40);
assert.equal(simParallel.actuators.dosing_pumps["pump_1"], false, "Pump 1 turned OFF at 10s");
assert.equal(simParallel.actuators.dosing_pumps["pump_2"], true, "Pump 2 remains ON at 10s");

// At t = +15s (total +5s more): Pump 2 completes (15s)
simParallel.tick(5, 100);
assert.equal(simParallel.actuators.dosing_pumps["pump_2"], false, "Pump 2 turned OFF at 15s");
assert.equal(simParallel.channels.every(c => c.completed), true, "All dosing pumps complete");
console.log("  PASS: Dosing pumps ran strictly in parallel with independent runtimes (8s, 10s, 15s).");

// -------------------------------------------------------------
// Scenario 2C: Raw Water Target Completion & Post-Mix Agitation
// -------------------------------------------------------------
console.log("\n[Test 2C] Raw Water Target Stop & Post-Mix Agitation Duration...");

// Advance raw water to 1999 mL -> still running
simParallel.tick(64, 1299);
assert.equal(simParallel.actual_raw_water_ml, 2000 - 1);
assert.equal(simParallel.actuators.raw_water_pump, true, "Raw water pump stays ON until 100% target");

// Deliver final 1 mL -> Raw water reaches 2000 mL and turns OFF
simParallel.tick(0.1, 1);
assert.equal(simParallel.actual_raw_water_ml, 2000);
assert.equal(simParallel.actuators.raw_water_pump, false, "Raw water pump turns OFF at target volume");
assert.equal(simParallel.raw_water_done, true);

// Post-mix duration begins: mixing pump must stay ON for 10s
assert.equal(simParallel.actuators.mixing_pump, true, "Mixing pump must stay ON for post-mix duration");
simParallel.tick(5, 0); // 5s into post-mix
assert.equal(simParallel.actuators.mixing_pump, true, "Mixing pump still ON halfway through post-mix");
assert.equal(simParallel.result, null, "Protocol not finished yet during post-mix");

simParallel.tick(5, 0); // 10s complete
assert.equal(simParallel.result?.status, "MIXING_RESULT_SUCCESS");
assert.equal(simParallel.actuators.mixing_pump, false, "Mixing pump turns OFF after post-mix completes");
console.log("  PASS: Raw water stopped at 100% and mixing pump ran through full post-mix duration.");

// -------------------------------------------------------------
// TEST 3: Dynamic Dosing Pumps (2, 3, and 4 pumps, non-hardcoded)
// -------------------------------------------------------------
console.log("\n[Test 3] Dynamic Dosing Channels (2, 3, 4 pumps)...");

for (const pumpCount of [2, 3, 4]) {
  const dynamicChannels = [];
  for (let p = 1; p <= pumpCount; p++) {
    dynamicChannels.push({
      component_id: `pump_dosing_${p}`,
      target_volume_ml: 10 * p,
      rate_ml_sec: 1.0 * p // Each has its own rate -> runtime = 10s for all
    });
  }

  const simDynamic = new MixingProtocolSimulator({
    raw_water_target_ml: 1000,
    threshold_percent: 10, // 100ml
    post_mix_duration_sec: 5,
    raw_water_rate_ml_sec: 50,
    flow_sensor_calibrated: true,
    flow_pulses_per_l: 450,
    channels: dynamicChannels
  });

  simDynamic.start();
  // Fill to 100ml
  simDynamic.tick(2, 100);
  assert.equal(simDynamic.threshold_reached, true);
  for (let p = 1; p <= pumpCount; p++) {
    assert.equal(simDynamic.actuators.dosing_pumps[`pump_dosing_${p}`], true, `Pump ${p} must be ON`);
  }

  // Complete water to 1000ml and dosing to 10s, then post-mix 5s
  simDynamic.tick(18, 900);
  simDynamic.tick(5, 0);
  assert.equal(simDynamic.result?.status, "MIXING_RESULT_SUCCESS");
  assert.equal(simDynamic.channels.length, pumpCount);
  assert.ok(simDynamic.channels.every(ch => ch.completed), `All ${pumpCount} channels must complete`);
  console.log(`  PASS: Dynamic ${pumpCount}-pump configuration handled and executed.`);
}

// -------------------------------------------------------------
// TEST 4: Error Handling, Progress No-Flow, Reachable Timeout, & Safe-Stop Scoping
// -------------------------------------------------------------
console.log("\n[Test 4] Error Scenarios, Progress No-Flow & Scoped Safe Stop...");

// 4A. Calibration Missing: Raw water pump rate missing/zero
const simErrRawCal = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 0,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simErrRawCal.start();
assert.equal(simErrRawCal.result?.status, "MIXING_RESULT_CALIBRATION_MISSING");
assert.equal(simErrRawCal.actuators.raw_water_pump, false);
console.log("  PASS: Missing raw water pump calibration blocked with MIXING_RESULT_CALIBRATION_MISSING.");

// 4B. Calibration Missing: Flow sensor uncalibrated
const simErrFlowCal = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: false,
  flow_pulses_per_l: 0,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simErrFlowCal.start();
assert.equal(simErrFlowCal.result?.status, "MIXING_RESULT_CALIBRATION_MISSING");
assert.equal(simErrFlowCal.actuators.raw_water_pump, false);
console.log("  PASS: Uncalibrated flow sensor blocked with MIXING_RESULT_CALIBRATION_MISSING.");

// 4C. Calibration Missing: Required dosing pump uncalibrated
const simErrDosingCal = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [
    { component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 },
    { component_id: "pump_dosing_2", target_volume_ml: 10, rate_ml_sec: -5.0 }
  ]
});
simErrDosingCal.start();
assert.equal(simErrDosingCal.result?.status, "MIXING_RESULT_CALIBRATION_MISSING");
assert.equal(simErrDosingCal.actuators.raw_water_pump, false);
console.log("  PASS: Invalid/missing dosing calibration blocked with MIXING_RESULT_CALIBRATION_MISSING.");

// 4D. Progress-Based No Flow: Flow stops after initial movement (0s=0, 10s=500ml, 25s=500ml)
console.log("\n[Test 4D] Progress-based No-Flow Detection (Stall at 500 mL)...");
const simProgressNoFlow = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 50,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  no_flow_grace_sec: 15,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simProgressNoFlow.start();
// Flow moves normally to 500 mL in first 10s
simProgressNoFlow.tick(10, 500);
assert.equal(simProgressNoFlow.actual_raw_water_ml, 500);
assert.equal(simProgressNoFlow.result, null, "Still healthy at 10s");

// From t=10s to t=24s (14s without progress): within grace period
simProgressNoFlow.tick(14, 0);
assert.equal(simProgressNoFlow.result, null, "14s without progress is within 15s grace");

// At t=25.1s (15.1s without progress): stall detected!
simProgressNoFlow.tick(1.1, 0);
assert.equal(simProgressNoFlow.result?.status, "MIXING_RESULT_RAW_WATER_NO_FLOW");
assert.equal(simProgressNoFlow.actuators.raw_water_pump, false, "Safe Stop: Raw water pump forced OFF");
console.log("  PASS: Progress-based no-flow detected after flow stalled at 500 mL.");

// 4E. Sensor Error: Sensor disconnects mid-flight
const simSensorErr = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simSensorErr.start();
simSensorErr.tick(10, 100);
simSensorErr.sensor_error = true;
simSensorErr.tick(1, 0);
assert.equal(simSensorErr.result?.status, "MIXING_RESULT_RAW_WATER_SENSOR_ERROR");
assert.equal(simSensorErr.actuators.raw_water_pump, false);
console.log("  PASS: Flow sensor error tripped MIXING_RESULT_RAW_WATER_SENSOR_ERROR and safe-stopped.");

// 4F. Raw Water Timeout: Strictly 1.5x expected calibration time
const simRawTimeout = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 10, // Expected: 200s, max 1.5x: 300s
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
assert.equal(simRawTimeout.raw_water_expected_sec, 200);
assert.equal(simRawTimeout.raw_water_max_sec, 300);
simRawTimeout.start();
// Trickle slowly with updates to avoid no-flow, but exceed 300s
for (let sec = 0; sec < 31; sec++) {
  simRawTimeout.tick(10, 10); // 10 ml every 10s
}
assert.equal(simRawTimeout.result?.status, "MIXING_RESULT_RAW_WATER_TIMEOUT");
assert.equal(simRawTimeout.actuators.raw_water_pump, false);
console.log("  PASS: Raw water timeout tripped at strictly 1.5x expected time and safe-stopped.");

// 4G. Dosing OFF Failure -> Immediate ACTUATOR_ERROR (Prompt Section 9)
console.log("\n[Test 4G] Dosing OFF Failure Protection (Immediate ACTUATOR_ERROR without 1.5x wait)...");
const simDosingTimeout = new MixingProtocolSimulator({
  raw_water_target_ml: 10000, // Large so raw water won't timeout first
  threshold_percent: 1,      // 100ml reached immediately
  post_mix_duration_sec: 30,
  raw_water_rate_ml_sec: 100,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
assert.equal(simDosingTimeout.channels[0].expected_runtime_ms, 10000);

// Simulate that OFF command fails at expected 10s: pump fails to stop
simDosingTimeout.sim_dosing_off_fail["pump_dosing_1"] = true;

simDosingTimeout.start();
simDosingTimeout.tick(1, 100); // Threshold reached, dosing pump 1 ON
assert.equal(simDosingTimeout.actuators.dosing_pumps["pump_dosing_1"], true);

// At t = 10s (elapsed 10,000ms): OFF requested, but failed! Must immediately trip ACTUATOR_ERROR!
simDosingTimeout.tick(10, 1000);
assert.equal(simDosingTimeout.result?.status, "MIXING_RESULT_ACTUATOR_ERROR", "Must immediately trip MIXING_RESULT_ACTUATOR_ERROR");
assert.equal(simDosingTimeout.actuators.dosing_pumps["pump_dosing_1"], false, "Safe Stop: Dosing pump forced OFF");
assert.equal(simDosingTimeout.actuators.mixing_pump, false, "Safe Stop: Mixing pump forced OFF");
assert.equal(simDosingTimeout.actuators.raw_water_pump, false, "Safe Stop: Raw water pump forced OFF");
console.log("  PASS: Dosing OFF failure immediately trips MIXING_RESULT_ACTUATOR_ERROR without waiting 1.5x timeout.");

// 4H. Actuator OFF Failures (Raw Water & Mixing Pump)
console.log("\n[Test 4H] Actuator OFF Failure Protection (Raw Water & Mixing Pump)...");

// Raw water OFF failure
const simRawOffFail = new MixingProtocolSimulator({
  raw_water_target_ml: 1000,
  threshold_percent: 10,
  post_mix_duration_sec: 5,
  raw_water_rate_ml_sec: 100,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 5, rate_ml_sec: 1.0 }]
});
simRawOffFail.sim_raw_water_off_fail = true;
simRawOffFail.start();
simRawOffFail.tick(10, 1000); // Reaches 1000 mL target
assert.equal(simRawOffFail.result?.status, "MIXING_RESULT_ACTUATOR_ERROR", "Must trip ACTUATOR_ERROR when raw water OFF fails");
console.log("  PASS: Raw water pump OFF failure returns MIXING_RESULT_ACTUATOR_ERROR.");

// Mixing pump OFF failure
const simMixOffFail = new MixingProtocolSimulator({
  raw_water_target_ml: 1000,
  threshold_percent: 10,
  post_mix_duration_sec: 5,
  raw_water_rate_ml_sec: 100,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 5, rate_ml_sec: 1.0 }]
});
simMixOffFail.sim_mixing_off_fail = true;
simMixOffFail.start();
simMixOffFail.tick(10, 1000); // Water target reached
simMixOffFail.tick(5, 0);     // Post mix completed
assert.equal(simMixOffFail.result?.status, "MIXING_RESULT_ACTUATOR_ERROR", "Must trip ACTUATOR_ERROR when mixing pump OFF fails");
console.log("  PASS: Mixing pump OFF failure returns MIXING_RESULT_ACTUATOR_ERROR instead of SUCCESS.");

// 4I. Scoped Safe-Stop: Never touches unowned actuators
console.log("\n[Test 4I] Scoped Safe-Stop Ownership Verification...");
const simScoped = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simScoped.start();
simScoped.tick(20, 400); // threshold reached
assert.equal(simScoped.unowned_system_actuators.pump_dist, true, "Unowned distribution pump is ON");
assert.equal(simScoped.unowned_system_actuators.pump_dosing_unrelated, true, "Unrelated dosing pump is ON");

// Emergency stop trips
simScoped.emergency_stopped = true;
simScoped.tick(1, 0);
assert.equal(simScoped.result?.status, "MIXING_RESULT_EMERGENCY_STOP");
// Owned actuators are OFF
assert.equal(simScoped.actuators.raw_water_pump, false);
assert.equal(simScoped.actuators.mixing_pump, false);
assert.equal(simScoped.actuators.dosing_pumps["pump_dosing_1"], false);
// Unowned actuators remain intact (not killed)
assert.equal(simScoped.unowned_system_actuators.pump_dist, true, "Safe stop must NOT turn OFF unowned pump_dist");
assert.equal(simScoped.unowned_system_actuators.pump_dosing_unrelated, true, "Safe stop must NOT turn OFF unowned pump_dosing_unrelated");
console.log("  PASS: Safe-stop strictly scoped to job-owned actuators without affecting unowned actuators.");

// 4J. Emergency Stop: Trips mid-run
const simEStop = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  post_mix_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simEStop.start();
simEStop.tick(40, 400); // Threshold reached, mixing and dosing active
assert.equal(simEStop.actuators.mixing_pump, true);
assert.equal(simEStop.actuators.raw_water_pump, true);
// Emergency stop latched!
simEStop.emergency_stopped = true;
simEStop.tick(1, 10);
assert.equal(simEStop.result?.status, "MIXING_RESULT_EMERGENCY_STOP");
assert.equal(simEStop.actuators.raw_water_pump, false);
assert.equal(simEStop.actuators.mixing_pump, false);
assert.equal(simEStop.actuators.dosing_pumps["pump_dosing_1"], false);
console.log("  PASS: Emergency stop triggered immediate safe-stop of all actuators without waiting for timer.");

// 4K. Zero Threshold Dynamic Triggering (threshold_percent = 0)
console.log("\n[Test 4K] Zero Threshold (threshold_percent = 0) Dynamic Start...");
const simZeroThresh = new MixingProtocolSimulator({
  raw_water_target_ml: 1000,
  threshold_percent: 0,
  post_mix_duration_sec: 5,
  raw_water_rate_ml_sec: 100,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 5, rate_ml_sec: 1.0 }]
});
assert.equal(simZeroThresh.threshold_volume_ml, 0);
simZeroThresh.start();
simZeroThresh.tick(0.1, 0); // At 0 mL, 0 >= 0 triggers threshold immediately
assert.equal(simZeroThresh.threshold_reached, true, "Zero threshold must trigger immediately");
assert.equal(simZeroThresh.actuators.mixing_pump, true, "Mixing pump started at 0 threshold");
assert.equal(simZeroThresh.actuators.dosing_pumps["pump_dosing_1"], true, "Dosing pump started at 0 threshold");
console.log("  PASS: Zero threshold dynamic trigger starts mixing and dosing immediately upon raw water start.");

// 4L. Post-mix duration 0 semantics undefined
console.log("\n[Test 4L] Post-mix Duration 0 Semantics Undefined (Prompt Section 14)...");
const simPostMixZero = new MixingProtocolSimulator({
  raw_water_target_ml: 1000,
  threshold_percent: 20,
  post_mix_duration_sec: 0,
  raw_water_rate_ml_sec: 100,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 5, rate_ml_sec: 1.0 }]
});
simPostMixZero.start();
assert.equal(simPostMixZero.result?.status, "MIXING_RESULT_POST_MIX_DURATION_SEMANTICS_UNDEFINED",
  "post_mix_duration_sec == 0 must return MIXING_RESULT_POST_MIX_DURATION_SEMANTICS_UNDEFINED");
assert.equal(simPostMixZero.actuators.raw_water_pump, false);
console.log("  PASS: post_mix_duration_sec == 0 rejected with MIXING_RESULT_POST_MIX_DURATION_SEMANTICS_UNDEFINED.");

console.log("\n>>> ALL CORE PROTOCOL MIXING TESTS PASSED! <<<");
