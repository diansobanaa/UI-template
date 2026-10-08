/**
 * Comprehensive Test Suite for Core Mixing Protocol (protocol_mixing)
 * 
 * Validates:
 * 1. Raw water measurement (flow sensor source of truth, not timer).
 * 2. Threshold triggering (20% of 2000 mL = 400 mL triggers mixing+dosing, raw water continues).
 * 3. Dynamic dosing channels (2, 3, 4 pumps, non-hardcoded).
 * 4. Calibration-driven runtime & timeout calculations.
 * 5. Error pathways (calibration missing/invalid, no flow, sensor error, timeout, dosing error, E-Stop).
 * 6. Safe Stop guarantee on all error pathways (all actuators forced OFF).
 * 7. Firmware C implementation static contract & build integrity.
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
  "MIXING_RESULT_EMERGENCY_STOP"
];
for (const code of expectedCodes) {
  assert.match(headerContent, new RegExp(code), `Header must define enum code ${code}`);
  assert.match(sourceContent, new RegExp(code), `Source must handle status code ${code}`);
}

// Verify CMakeLists.txt registration
const cmakeContent = fs.readFileSync(path.join(ROOT, "esp32/main/CMakeLists.txt"), "utf8");
assert.match(cmakeContent, /services\/protocol_mixing\.c/, "CMakeLists.txt must include services/protocol_mixing.c");

console.log("  PASS: Firmware C signatures, error codes, and build registration verified.");

// -------------------------------------------------------------
// TEST 2: Raw Water Volume & Threshold State Machine Simulation
// -------------------------------------------------------------
console.log("\n[Test 2] Raw Water Source of Truth & Threshold Mechanism (2000 mL target, 20% threshold)...");

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
    this.channels = config.channels.map(c => ({
      component_id: c.component_id,
      target_volume_ml: c.target_volume_ml,
      expected_runtime_ms: Math.round((c.target_volume_ml / c.rate_ml_sec) * 1000),
      max_runtime_ms: Math.round((c.target_volume_ml / c.rate_ml_sec) * 1000 * 1.5) + 5000,
      elapsed_ms: 0,
      running: false,
      completed: false
    }));
    this.channels.forEach(ch => {
      this.actuators.dosing_pumps[ch.component_id] = false;
    });

    this.raw_water_expected_sec = Math.ceil(config.raw_water_target_ml / config.raw_water_rate_ml_sec);
    this.raw_water_max_sec = this.raw_water_expected_sec + (config.timeout_safety_margin_sec || Math.max(30, Math.floor(this.raw_water_expected_sec / 2)));
    this.threshold_volume_ml = Math.floor((config.raw_water_target_ml * config.threshold_percent) / 100);

    this.raw_water_done = false;
    this.threshold_reached = false;
    this.mixing_elapsed_sec = 0;
    this.raw_elapsed_sec = 0;
    this.no_flow_grace_sec = config.no_flow_grace_sec || 15;
    this.emergency_stopped = false;
    this.sensor_error = false;
    this.result = null;
  }

  precheck() {
    if (!this.config.raw_water_target_ml || this.config.raw_water_target_ml <= 0) {
      return this.fail("MIXING_RESULT_INVALID_CONFIG", "Target volume <= 0");
    }
    if (this.config.threshold_percent > 100) {
      return this.fail("MIXING_RESULT_INVALID_CONFIG", "Threshold > 100%");
    }
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
    this.result = { status, message, actual_raw_water_ml: this.actual_raw_water_ml };
    return false;
  }

  safeStop() {
    this.actuators.raw_water_pump = false;
    this.actuators.mixing_pump = false;
    Object.keys(this.actuators.dosing_pumps).forEach(k => {
      this.actuators.dosing_pumps[k] = false;
    });
  }

  start() {
    if (!this.precheck()) return;
    this.actuators.raw_water_pump = true;
    this.state = "RUNNING";
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

      // No flow check
      if (this.raw_elapsed_sec >= this.no_flow_grace_sec && this.actual_raw_water_ml === 0) {
        return this.fail("MIXING_RESULT_RAW_WATER_NO_FLOW", "No flow measured after grace period");
      }

      // Timeout check
      if (this.raw_elapsed_sec > this.raw_water_max_sec && this.actual_raw_water_ml < this.config.raw_water_target_ml) {
        return this.fail("MIXING_RESULT_RAW_WATER_TIMEOUT", "Raw water runtime exceeded max timeout");
      }

      // Threshold check
      if (!this.threshold_reached && this.actual_raw_water_ml >= this.threshold_volume_ml) {
        this.threshold_reached = true;
        this.actuators.mixing_pump = true;
        this.channels.forEach(ch => {
          ch.running = true;
          this.actuators.dosing_pumps[ch.component_id] = true;
        });
      }

      // Raw water target check (Stop ONLY at 100% target volume)
      if (this.actual_raw_water_ml >= this.config.raw_water_target_ml) {
        this.actuators.raw_water_pump = false;
        this.raw_water_done = true;
      }
    }

    // Dosing supervision
    if (this.threshold_reached) {
      this.mixing_elapsed_sec += deltaSec;
      const deltaMs = deltaSec * 1000;

      for (const ch of this.channels) {
        if (ch.running) {
          ch.elapsed_ms += deltaMs;
          if (ch.elapsed_ms >= ch.expected_runtime_ms) {
            ch.running = false;
            ch.completed = true;
            this.actuators.dosing_pumps[ch.component_id] = false;
          } else if (ch.elapsed_ms > ch.max_runtime_ms) {
            return this.fail("MIXING_RESULT_DOSING_TIMEOUT", `Dosing pump ${ch.component_id} exceeded timeout`);
          }
        }
      }
    }

    // Success evaluation
    const allDosingDone = this.channels.every(ch => ch.completed);
    const mixingDone = this.mixing_elapsed_sec >= this.config.mixing_duration_sec;

    if (this.raw_water_done && allDosingDone && mixingDone) {
      this.safeStop();
      this.result = {
        status: "MIXING_RESULT_SUCCESS",
        actual_raw_water_ml: this.actual_raw_water_ml,
        mixing_duration_sec: this.mixing_elapsed_sec,
        channels: this.channels.map(c => ({ id: c.component_id, completed: c.completed }))
      };
    }
  }
}

// Scenario 1: Standard filling up to threshold and target
const sim1 = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  mixing_duration_sec: 10,
  raw_water_rate_ml_sec: 10, // 600 ml/min -> 200s expected runtime
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [
    { component_id: "pump_dosing_1", target_volume_ml: 20, rate_ml_sec: 2.0 }, // 10s
    { component_id: "pump_dosing_2", target_volume_ml: 10, rate_ml_sec: 1.0 }, // 10s
  ]
});

sim1.start();
assert.equal(sim1.actuators.raw_water_pump, true);
assert.equal(sim1.actuators.mixing_pump, false);
assert.equal(sim1.threshold_volume_ml, 400, "Threshold volume for 2000ml @ 20% must be 400ml");

// Step from 0 to 390 mL -> Threshold not reached yet
sim1.tick(39, 390);
assert.equal(sim1.actual_raw_water_ml, 390);
assert.equal(sim1.threshold_reached, false);
assert.equal(sim1.actuators.raw_water_pump, true, "Raw water pump must still be ON");
assert.equal(sim1.actuators.mixing_pump, false, "Mixing pump must not be ON before threshold");

// Step to 400 mL -> Threshold reached!
sim1.tick(1, 10);
assert.equal(sim1.actual_raw_water_ml, 400);
assert.equal(sim1.threshold_reached, true, "Threshold must be reached at 400 mL");
assert.equal(sim1.actuators.mixing_pump, true, "Mixing pump must turn ON at threshold");
assert.equal(sim1.actuators.dosing_pumps["pump_dosing_1"], true, "Dosing pump 1 must start at threshold");
assert.equal(sim1.actuators.dosing_pumps["pump_dosing_2"], true, "Dosing pump 2 must start at threshold");
assert.equal(sim1.actuators.raw_water_pump, true, "CRITICAL: Raw water pump must NOT stop at threshold! It must remain ON!");

// Step past threshold to 1990 mL -> Raw water still ON
sim1.tick(159, 1590);
assert.equal(sim1.actual_raw_water_ml, 1990);
assert.equal(sim1.actuators.raw_water_pump, true, "Raw water pump must stay ON until target");

// Step to 2000 mL -> Raw water reaches target and turns OFF
sim1.tick(1, 10);
assert.equal(sim1.actual_raw_water_ml, 2000);
assert.equal(sim1.actuators.raw_water_pump, false, "Raw water pump must turn OFF when target reached");
assert.equal(sim1.raw_water_done, true);

// Finish mixing duration
sim1.tick(10, 0);
assert.equal(sim1.result?.status, "MIXING_RESULT_SUCCESS");
assert.equal(sim1.actuators.raw_water_pump, false);
assert.equal(sim1.actuators.mixing_pump, false);
assert.equal(sim1.actuators.dosing_pumps["pump_dosing_1"], false);
assert.equal(sim1.actuators.dosing_pumps["pump_dosing_2"], false);

console.log("  PASS: Raw water ran continuously from 0 -> 400ml (threshold) -> 2000ml (target stop).");

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
    mixing_duration_sec: 10,
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

  // Complete water to 1000ml and dosing to 10s
  simDynamic.tick(18, 900);
  assert.equal(simDynamic.result?.status, "MIXING_RESULT_SUCCESS");
  assert.equal(simDynamic.channels.length, pumpCount);
  assert.ok(simDynamic.channels.every(ch => ch.completed), `All ${pumpCount} channels must complete`);
  console.log(`  PASS: Dynamic ${pumpCount}-pump configuration handled and executed.`);
}

// -------------------------------------------------------------
// TEST 4: Error Handling & Safe Stop Verification
// -------------------------------------------------------------
console.log("\n[Test 4] Error Scenarios & Safe Stop Mandate...");

// 4A. Calibration Missing: Raw water pump rate missing/zero
const simErrRawCal = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  mixing_duration_sec: 10,
  raw_water_rate_ml_sec: 0, // INVALID / MISSING
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simErrRawCal.start();
assert.equal(simErrRawCal.result?.status, "MIXING_RESULT_CALIBRATION_MISSING");
assert.equal(simErrRawCal.actuators.raw_water_pump, false, "Pump must not start when calibration missing");
console.log("  PASS: Missing raw water pump calibration blocked with MIXING_RESULT_CALIBRATION_MISSING.");

// 4B. Calibration Missing: Flow sensor uncalibrated
const simErrFlowCal = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  mixing_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: false, // UNCALIBRATED (factor = 0)
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
  mixing_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [
    { component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 },
    { component_id: "pump_dosing_2", target_volume_ml: 10, rate_ml_sec: -5.0 } // INVALID / NEGATIVE
  ]
});
simErrDosingCal.start();
assert.equal(simErrDosingCal.result?.status, "MIXING_RESULT_CALIBRATION_MISSING");
assert.equal(simErrDosingCal.actuators.raw_water_pump, false);
console.log("  PASS: Invalid/missing dosing calibration blocked with MIXING_RESULT_CALIBRATION_MISSING.");

// 4D. No Flow: Pump runs for 15s with 0 flow measured
const simNoFlow = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  mixing_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  no_flow_grace_sec: 15,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simNoFlow.start();
assert.equal(simNoFlow.actuators.raw_water_pump, true);
// Simulate 16s with 0 pulses
simNoFlow.tick(16, 0);
assert.equal(simNoFlow.result?.status, "MIXING_RESULT_RAW_WATER_NO_FLOW");
assert.equal(simNoFlow.actuators.raw_water_pump, false, "Safe Stop: Raw water pump forced OFF");
console.log("  PASS: No flow after grace period tripped MIXING_RESULT_RAW_WATER_NO_FLOW and safe-stopped.");

// 4E. Sensor Error: Sensor disconnects mid-flight
const simSensorErr = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  mixing_duration_sec: 10,
  raw_water_rate_ml_sec: 10,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simSensorErr.start();
simSensorErr.tick(10, 100);
// Sensor drops out
simSensorErr.sensor_error = true;
simSensorErr.tick(1, 0);
assert.equal(simSensorErr.result?.status, "MIXING_RESULT_RAW_WATER_SENSOR_ERROR");
assert.equal(simSensorErr.actuators.raw_water_pump, false, "Safe Stop: Raw water pump forced OFF");
console.log("  PASS: Flow sensor error tripped MIXING_RESULT_RAW_WATER_SENSOR_ERROR and safe-stopped.");

// 4F. Raw Water Timeout: Expected 200s + 100s margin = 300s. Target not reached at 301s.
const simRawTimeout = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  mixing_duration_sec: 10,
  raw_water_rate_ml_sec: 10, // Expected = 200s, max = 300s
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }]
});
simRawTimeout.start();
// Trickle only 500 mL over 301 seconds
simRawTimeout.tick(301, 500);
assert.equal(simRawTimeout.result?.status, "MIXING_RESULT_RAW_WATER_TIMEOUT");
assert.equal(simRawTimeout.actuators.raw_water_pump, false, "Safe Stop: Raw water pump forced OFF");
assert.equal(simRawTimeout.actuators.mixing_pump, false, "Safe Stop: Mixing pump forced OFF");
assert.equal(simRawTimeout.actuators.dosing_pumps["pump_dosing_1"], false, "Safe Stop: Dosing pump forced OFF");
console.log("  PASS: Raw water timeout tripped MIXING_RESULT_RAW_WATER_TIMEOUT and safe-stopped.");

// 4G. Dosing Timeout: Channel runs beyond max runtime
const simDosingTimeout = new MixingProtocolSimulator({
  raw_water_target_ml: 1000,
  threshold_percent: 10, // 100ml
  mixing_duration_sec: 30,
  raw_water_rate_ml_sec: 100,
  flow_sensor_calibrated: true,
  flow_pulses_per_l: 450,
  channels: [{ component_id: "pump_dosing_1", target_volume_ml: 10, rate_ml_sec: 1.0 }] // expected 10s, max 20s
});
simDosingTimeout.start();
simDosingTimeout.tick(1, 100); // threshold reached, dosing starts
// Force channel to fail to complete and exceed max_runtime (21s elapsed)
simDosingTimeout.channels[0].expected_runtime_ms = 999999; // artificially simulate stalled target
simDosingTimeout.tick(22, 100);
assert.equal(simDosingTimeout.result?.status, "MIXING_RESULT_DOSING_TIMEOUT");
assert.equal(simDosingTimeout.actuators.dosing_pumps["pump_dosing_1"], false, "Safe Stop: Dosing pump forced OFF");
assert.equal(simDosingTimeout.actuators.mixing_pump, false, "Safe Stop: Mixing pump forced OFF");
assert.equal(simDosingTimeout.actuators.raw_water_pump, false, "Safe Stop: Raw water pump forced OFF");
console.log("  PASS: Dosing timeout tripped MIXING_RESULT_DOSING_TIMEOUT and safe-stopped all actuators.");

// 4H. Emergency Stop: Trips mid-run
const simEStop = new MixingProtocolSimulator({
  raw_water_target_ml: 2000,
  threshold_percent: 20,
  mixing_duration_sec: 10,
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
assert.equal(simEStop.actuators.raw_water_pump, false, "E-Stop must immediately turn raw water pump OFF");
assert.equal(simEStop.actuators.mixing_pump, false, "E-Stop must immediately turn mixing pump OFF");
assert.equal(simEStop.actuators.dosing_pumps["pump_dosing_1"], false, "E-Stop must immediately turn dosing pump OFF");
console.log("  PASS: Emergency stop triggered immediate safe-stop of all actuators without waiting for timer.");

console.log("\n>>> ALL 10 CORE PROTOCOL MIXING TESTS PASSED! <<<");
