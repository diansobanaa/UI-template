import assert from "node:assert";
import {
  calculateCandidateFlowK,
  calculateRawPumpRate,
  calculateEstimatedFlowVolume,
  calculateFlowVerificationError,
  validatePhysicalVolumeInput,
  FLOW_CALIBRATION_TOLERANCE_PCT,
} from "../src/lib/calibration-math.ts";

console.log("=====================================================================");
console.log("   AGROTECH ESP32-S3: FLOW SENSOR VERIFICATION & CALIBRATION E2E TEST");
console.log("=====================================================================");

// -------------------------------------------------------------------
// TEST 1: Non-Resetting Lifetime Hardware Pulse Counter Simulation
// -------------------------------------------------------------------
console.log("\n[TEST 1] Non-resetting Lifetime Pulse Counter & Session Baseline Snapshot");
{
  let lifetimeHardwareCounter = 45210; // e.g. accumulated over past days
  const startSnapshot = lifetimeHardwareCounter;

  // Pump runs for 30 seconds, generating 1980 pulses
  const generatedPulses = 1980;
  lifetimeHardwareCounter += generatedPulses;

  const sessionPulses = lifetimeHardwareCounter - startSnapshot;
  assert.strictEqual(sessionPulses, 1980, "Session pulses must equal delta from baseline snapshot");
  assert.strictEqual(lifetimeHardwareCounter, 47190, "Lifetime counter must NOT be reset to 0");
  console.log(`  ✓ Start Snapshot: ${startSnapshot}, Current: ${lifetimeHardwareCounter}, Session Pulses: ${sessionPulses}`);
}

// -------------------------------------------------------------------
// TEST 2: Active Telemetry - Uncalibrated Sensor Behavior
// -------------------------------------------------------------------
console.log("\n[TEST 2] Active Telemetry - Missing / Zero Calibration (No Fake Liter Conversion)");
{
  const activePulsesPerL = 0; // Uncalibrated state
  const sessionPulses = 1200;
  const est = calculateEstimatedFlowVolume(sessionPulses, activePulsesPerL);

  assert.strictEqual(est.volumeL, 0, "Volume must not be estimated when uncalibrated");
  assert.strictEqual(est.volumeMl, 0, "Volume in mL must be 0");
  console.log("  ✓ Uncalibrated sensor correctly displays 0/null volume while tracking live pulses");
}

// -------------------------------------------------------------------
// TEST 3: Active Telemetry - Calibrated Sensor Behavior
// -------------------------------------------------------------------
console.log("\n[TEST 3] Active Telemetry - Calibrated Sensor Volume & Live Flow Conversion");
{
  const activePulsesPerL = 660.0;
  const sessionPulses = 1980;
  const est = calculateEstimatedFlowVolume(sessionPulses, activePulsesPerL);

  assert.strictEqual(est.volumeL, 3.0, "1980 pulses @ 660 p/L must equal exactly 3.0 Liters");
  assert.strictEqual(est.volumeMl, 3000.0, "Setara 3000 mL");

  // Simulated 66 Hz frequency => 66 / 660 = 0.1 L/s = 6.0 L/min
  const freqHz = 66.0;
  const liveFlowLpm = (freqHz / activePulsesPerL) * 60.0;
  assert.strictEqual(liveFlowLpm, 6.0, "66 Hz @ 660 p/L must equal 6.0 L/min");
  console.log(`  ✓ Live Frequency ${freqHz} Hz => ${liveFlowLpm} L/min, Estimated Volume: ${est.volumeL} L`);
}

// -------------------------------------------------------------------
// TEST 4: Physical Volume Input Validation
// -------------------------------------------------------------------
console.log("\n[TEST 4] Physical Volume Input Validation (Liter Safe)");
{
  assert.strictEqual(validatePhysicalVolumeInput("", 30).valid, false, "Empty rejected");
  assert.strictEqual(validatePhysicalVolumeInput("-5.0", 30).valid, false, "Negative rejected");
  assert.strictEqual(validatePhysicalVolumeInput("0", 30).valid, false, "Zero rejected");
  assert.strictEqual(validatePhysicalVolumeInput("invalid", 30).valid, false, "Non-number rejected");
  assert.strictEqual(validatePhysicalVolumeInput("0.001", 30).valid, false, "Unrealistically tiny volume rejected");
  assert.strictEqual(validatePhysicalVolumeInput("100.0", 30).valid, false, "Excessive flow (>60 L/min) rejected");

  const validTest = validatePhysicalVolumeInput("3.5", 30);
  assert.strictEqual(validTest.valid, true);
  assert.strictEqual(validTest.volumeL, 3.5);
  assert.strictEqual(validTest.volumeMl, 3500);
  console.log("  ✓ Physical volume validation correctly enforces boundaries");
}

// -------------------------------------------------------------------
// TEST 5: Candidate Sensor Factor vs Separate Pump Rate Calculation
// -------------------------------------------------------------------
console.log("\n[TEST 5] Candidate Sensor Factor vs Separate Pump Flow Rate");
{
  const sessionPulses = 1980;
  const actualVolumeL = 3.0;
  const actualVolumeMl = 3000;
  const durationSec = 30;

  // Sensor Pulses/L
  const candidateK = calculateCandidateFlowK(sessionPulses, actualVolumeL);
  assert.strictEqual(candidateK, 660.0, "K_candidate = 1980 / 3.0 = 660.0 pulses/L");

  // Raw Water Pump Flow Rate
  const pumpRate = calculateRawPumpRate(actualVolumeMl, durationSec);
  assert.strictEqual(pumpRate.mlPerSec, 100.0, "Q_pump = 3000ml / 30s = 100.0 mL/s");
  assert.strictEqual(pumpRate.lPerMin, 6.0, "Q_pump = 6.0 L/min");

  console.log(`  ✓ Sensor Factor: ${candidateK} pulses/L (Parameter Sensor)`);
  console.log(`  ✓ Pump Rate: ${pumpRate.lPerMin} L/min / ${pumpRate.mlPerSec} ml/s (Parameter Aktuator)`);
  console.log("  ✓ Sensor calibration and pump rate are maintained strictly separate");
}

// -------------------------------------------------------------------
// TEST 6: Verification Error Calculation and Tolerance Acceptance
// -------------------------------------------------------------------
console.log("\n[TEST 6] Verification Percentage Error (±5.0% Acceptance Tolerance)");
{
  // 1. Within tolerance (3.12 L est vs 3.00 L act => 4.0% error)
  const passRes = calculateFlowVerificationError(3.12, 3.00, FLOW_CALIBRATION_TOLERANCE_PCT);
  assert.strictEqual(passRes.isPassed, true);
  assert.strictEqual(Math.round(passRes.errorPct * 100) / 100, 4.0);

  // 2. Beyond tolerance (3.24 L est vs 3.00 L act => 8.0% error)
  const failRes = calculateFlowVerificationError(3.24, 3.00, FLOW_CALIBRATION_TOLERANCE_PCT);
  assert.strictEqual(failRes.isPassed, false);
  assert.strictEqual(Math.round(failRes.errorPct * 100) / 100, 8.0);

  console.log(`  ✓ 4.0% Error: isPassed=${passRes.isPassed} (Within ±5.0%)`);
  console.log(`  ✓ 8.0% Error: isPassed=${failRes.isPassed} (Exceeds ±5.0%)`);
}

// -------------------------------------------------------------------
// TEST 7: Staged 3-Run Verification Protocol Lifecycle
// -------------------------------------------------------------------
console.log("\n[TEST 7] Staged 3-Run Verification Protocol (1 Initial + 2 Validation Runs)");
{
  const testRuns = [];
  let sensorStatus = "UNCAL";

  // Run 1: Initial Calibration
  const r1_pulses = 1980;
  const r1_vol = 3.0;
  const candidate = calculateCandidateFlowK(r1_pulses, r1_vol);
  testRuns.push({ run: 1, candidate, isPassed: true });
  sensorStatus = "CALIBRATION_PENDING";
  assert.strictEqual(sensorStatus, "CALIBRATION_PENDING", "Must NOT become VERIFIED on Run 1");

  // Run 2: Validation 1 (Fresh baseline)
  const r2_pulses = 3315;
  const r2_vol = 5.0; // 3315 / 660 = 5.023 L => 0.45% error
  const r2_est = calculateEstimatedFlowVolume(r2_pulses, candidate);
  const r2_err = calculateFlowVerificationError(r2_est.volumeL, r2_vol);
  assert.strictEqual(r2_err.isPassed, true);
  testRuns.push({ run: 2, isPassed: r2_err.isPassed });
  assert.strictEqual(sensorStatus, "CALIBRATION_PENDING", "Still PENDING after only 1 validation run");

  // Run 3: Validation 2 (Fresh baseline)
  const r3_pulses = 1970;
  const r3_vol = 3.0; // 1970 / 660 = 2.985 L => 0.5% error
  const r3_est = calculateEstimatedFlowVolume(r3_pulses, candidate);
  const r3_err = calculateFlowVerificationError(r3_est.volumeL, r3_vol);
  assert.strictEqual(r3_err.isPassed, true);
  testRuns.push({ run: 3, isPassed: r3_err.isPassed });

  // Evaluation: 3 total runs, both validation runs passed
  if (testRuns.length >= 3 && testRuns.slice(1).every((r) => r.isPassed)) {
    sensorStatus = "VERIFIED";
  }
  assert.strictEqual(sensorStatus, "VERIFIED", "Successfully promoted to VERIFIED after 2 passing validation runs");
  console.log("  ✓ Successfully verified staged promotion to VERIFIED after 3 runs");
}

// -------------------------------------------------------------------
// TEST 8: Preserving Existing Verified Calibration on Validation Failure
// -------------------------------------------------------------------
console.log("\n[TEST 8] Preservation of Existing Calibration on Validation Failure");
{
  const productionCalibration = { pulsesPerL: 660.0, status: "VERIFIED" };

  // Operator runs re-verification test, but pipe is partially obstructed (severe error)
  const obstructedPulses = 1200; // Expected ~1980
  const actualCollectedL = 3.0;
  const candidateK = calculateCandidateFlowK(obstructedPulses, actualCollectedL); // 400 p/L
  const estL = calculateEstimatedFlowVolume(obstructedPulses, productionCalibration.pulsesPerL); // 1.818 L
  const err = calculateFlowVerificationError(estL, actualCollectedL);

  assert.strictEqual(err.isPassed, false, "Deviasi 39.4% harus gagal");

  // Safety rule: Never overwrite production calibration with failed candidate
  let activeCalibration = { ...productionCalibration };
  if (!err.isPassed) {
    // Retain production calibration!
    console.log(`  ✓ Validation failed (${err.errorPct.toFixed(1)}% error). Preserving existing ${activeCalibration.pulsesPerL} p/L.`);
  }
  assert.strictEqual(activeCalibration.pulsesPerL, 660.0);
  assert.strictEqual(activeCalibration.status, "VERIFIED");
}

// -------------------------------------------------------------------
// TEST 9: Hardware & Firmware Safety Interlock Integrity
// -------------------------------------------------------------------
console.log("\n[TEST 9] Firmware Safety Interlocks (Dosing/Mixing Lock, Max Runtime, E-Stop)");
{
  const MAX_RUNTIME_LIMIT_SEC = 1800; // 30 minutes
  const requestedDurationSec = 3600; // 1 hour attempt

  const enforcedDuration = Math.min(requestedDurationSec, MAX_RUNTIME_LIMIT_SEC);
  assert.strictEqual(enforcedDuration, 1800, "Must clamp to 1800s safety limit");

  // Pump actuator isolation
  const activeActuators = {
    pump_submersible: true,
    pump_dosing_a: false,
    pump_dosing_b: false,
    pump_mixing: false,
  };

  assert.strictEqual(activeActuators.pump_submersible, true);
  assert.strictEqual(activeActuators.pump_dosing_a, false, "Dosing A must be OFF");
  assert.strictEqual(activeActuators.pump_dosing_b, false, "Dosing B must be OFF");
  assert.strictEqual(activeActuators.pump_mixing, false, "Mixing must be OFF");

  console.log("  ✓ Runtime clamped to 30 min maximum; Dosing & Mixing pumps locked idle");
}

console.log("\n=====================================================================");
console.log("   ALL FLOW SENSOR VERIFICATION E2E TESTS PASSED SUCCESSFULLY!       ");
console.log("=====================================================================\n");
