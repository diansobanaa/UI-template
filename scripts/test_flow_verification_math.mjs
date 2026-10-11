import {
  calculateCandidateFlowK,
  calculateRawPumpRate,
  calculateEstimatedFlowVolume,
  calculateFlowVerificationError,
  validatePhysicalVolumeInput,
  FLOW_CALIBRATION_TOLERANCE_PCT
} from "../src/lib/calibration-math.ts";
import assert from "node:assert";

console.log("=== RUNNING FLOW SENSOR VERIFICATION MATHEMATICAL TESTS ===");

// 1. Candidate Flow Sensor Factor: K = pulses / liters
console.log("\n1. Testing Candidate Pulses-per-Liter (K_candidate = N_pulses / V_L)...");
// Example: 1980 pulses in 3 Liters => 660.0 pulses/L
assert.strictEqual(calculateCandidateFlowK(1980, 3.0), 660.0, "1980 pulses / 3L should be 660.0 pulses/L");
// Example: 3300 pulses in 5 Liters => 660.0 pulses/L
assert.strictEqual(calculateCandidateFlowK(3300, 5.0), 660.0, "3300 pulses / 5L should be 660.0 pulses/L");
// Example: 2000 pulses in 3 Liters => 666.666... pulses/L
const kFloat = calculateCandidateFlowK(2000, 3.0);
assert.strictEqual(Math.round(kFloat * 100) / 100, 666.67, "2000 pulses / 3L should round to 666.67");

// Edge cases
assert.strictEqual(calculateCandidateFlowK(0, 3.0), 0, "0 pulses should return 0");
assert.strictEqual(calculateCandidateFlowK(-100, 3.0), 0, "Negative pulses should return 0");
assert.strictEqual(calculateCandidateFlowK(1980, 0), 0, "0 volume should return 0");
assert.strictEqual(calculateCandidateFlowK(1980, -2.0), 0, "Negative volume should return 0");
assert.strictEqual(calculateCandidateFlowK(NaN, 3.0), 0, "NaN pulses should return 0");
assert.strictEqual(calculateCandidateFlowK(1980, Infinity), 0, "Infinity volume should return 0");
console.log("✓ Candidate pulses/L calculation & edge cases passed.");

// 2. Average Raw Water Pump Rate from Physical Measurement
console.log("\n2. Testing Raw Water Pump Flow Rate Calculation...");
// 3000 ml in 30 sec => 100 ml/s, 6.0 L/min
const rate30s = calculateRawPumpRate(3000, 30);
assert.strictEqual(rate30s.mlPerSec, 100.0, "3000ml / 30s = 100 ml/s");
assert.strictEqual(rate30s.lPerMin, 6.0, "100 ml/s * 60 / 1000 = 6.0 L/min");

// Edge cases
assert.deepStrictEqual(calculateRawPumpRate(0, 30), { mlPerSec: 0, lPerMin: 0 }, "0 volume returns 0");
assert.deepStrictEqual(calculateRawPumpRate(-100, 30), { mlPerSec: 0, lPerMin: 0 }, "Negative volume returns 0");
assert.deepStrictEqual(calculateRawPumpRate(3000, 0), { mlPerSec: 0, lPerMin: 0 }, "0 duration returns 0");
console.log("✓ Pump flow rate calculation passed.");

// 3. Estimated Volume from Pulses & Factor
console.log("\n3. Testing Estimated Volume Calculation...");
// 1980 pulses with 660.0 pulses/L => exactly 3.0 L (3000 mL)
const est1 = calculateEstimatedFlowVolume(1980, 660.0);
assert.strictEqual(est1.volumeL, 3.0);
assert.strictEqual(est1.volumeMl, 3000.0);

// Missing or zero calibration factor
assert.deepStrictEqual(calculateEstimatedFlowVolume(1980, 0), { volumeL: 0, volumeMl: 0 }, "0 factor returns 0");
assert.deepStrictEqual(calculateEstimatedFlowVolume(1980, -660), { volumeL: 0, volumeMl: 0 }, "Negative factor returns 0");
assert.deepStrictEqual(calculateEstimatedFlowVolume(0, 660), { volumeL: 0, volumeMl: 0 }, "0 pulses returns 0");
console.log("✓ Estimated volume calculation and missing calibration handling passed.");

// 4. Verification Error & Percentage Error
console.log("\n4. Testing Verification Error (E_% = |V_est - V_act| / V_act * 100%)...");
// Case A: Perfect match (3.0L est vs 3.0L act => 0% error, PASS)
const errA = calculateFlowVerificationError(3.0, 3.0);
assert.strictEqual(errA.errorPct, 0);
assert.strictEqual(errA.absDiffL, 0);
assert.strictEqual(errA.isPassed, true);

// Case B: 3.10L est vs 3.00L act => 0.10L diff => 3.33% error (PASS within ±5%)
const errB = calculateFlowVerificationError(3.10, 3.00);
assert.strictEqual(Math.round(errB.errorPct * 100) / 100, 3.33);
assert.strictEqual(Math.round(errB.absDiffL * 100) / 100, 0.10);
assert.strictEqual(errB.isPassed, true, "3.33% error is within ±5.0% tolerance");

// Case C: 2.80L est vs 3.00L act => 0.20L diff => 6.67% error (FAIL > ±5%)
const errC = calculateFlowVerificationError(2.80, 3.00);
assert.strictEqual(Math.round(errC.errorPct * 100) / 100, 6.67);
assert.strictEqual(Math.round(errC.absDiffL * 100) / 100, 0.20);
assert.strictEqual(errC.isPassed, false, "6.67% error exceeds ±5.0% tolerance");

// Case D: Exact boundary: exactly 5.0% error => PASS
const errD = calculateFlowVerificationError(3.15, 3.00);
assert.strictEqual(Math.round(errD.errorPct * 100) / 100, 5.0);
assert.strictEqual(errD.isPassed, true, "Exact 5.0% error must pass");

// Case E: Just over boundary: 5.1% error => FAIL
const errE = calculateFlowVerificationError(3.153, 3.00);
assert.strictEqual(errE.isPassed, false, "5.1% error must fail");
console.log("✓ Verification percentage error and ±5% acceptance criteria passed.");

// 5. Physical Volume Input Validation
console.log("\n5. Testing Physical Volume Input Validation...");
assert.strictEqual(validatePhysicalVolumeInput("", 30).valid, false, "Empty input rejected");
assert.strictEqual(validatePhysicalVolumeInput("abc", 30).valid, false, "Non-numeric rejected");
assert.strictEqual(validatePhysicalVolumeInput("-2.5", 30).valid, false, "Negative volume rejected");
assert.strictEqual(validatePhysicalVolumeInput("0", 30).valid, false, "Zero volume rejected");

const valValid = validatePhysicalVolumeInput("3.25", 30);
assert.strictEqual(valValid.valid, true, "3.25 L in 30s is valid");
assert.strictEqual(valValid.volumeL, 3.25);
assert.strictEqual(valValid.volumeMl, 3250);

// Flow rate bounds
assert.strictEqual(validatePhysicalVolumeInput("0.01", 30).valid, false, "Absurdly tiny volume (<0.1 L/min) rejected");
assert.strictEqual(validatePhysicalVolumeInput("50", 30).valid, false, "Absurdly huge volume (>60 L/min) rejected");
console.log("✓ Physical volume input validation passed.");

// 6. Multi-Run Staged Verification Lifecycle Simulation
console.log("\n6. Simulating 3-Run Staged Verification Lifecycle (1 Initial + 2 Validation)...");
// Target: Flow sensor calibration factor K = 660.0 pulses/L
// Run 1: Initial Calibration
const run1_pulses = 1980;
const run1_actualL = 3.0; // Operator measures 3.0 L
const run1_candidateK = calculateCandidateFlowK(run1_pulses, run1_actualL);
assert.strictEqual(run1_candidateK, 660.0);
// Initial run status is CALIBRATION_PENDING (never auto-VERIFIED)
let verificationStatus = "CALIBRATION_PENDING";
console.log(`  Run 1 (Initial): Pulses=${run1_pulses}, Actual=${run1_actualL}L => Candidate K=${run1_candidateK.toFixed(1)} P/L (Status: ${verificationStatus})`);

// Run 2: Independent Validation Run 1 (Fresh baseline)
const run2_pulses = 3330;
const run2_actualL = 5.0; // Operator collects 5.0 L
const run2_est = calculateEstimatedFlowVolume(run2_pulses, run1_candidateK); // 3330 / 660 = 5.045 L
const run2_err = calculateFlowVerificationError(run2_est.volumeL, run2_actualL);
assert.strictEqual(run2_err.isPassed, true, "Validation Run 1 within tolerance");
console.log(`  Run 2 (Val 1): Est=${run2_est.volumeL.toFixed(3)}L, Act=${run2_actualL}L, Error=${run2_err.errorPct.toFixed(2)}% (PASS: ${run2_err.isPassed})`);

// Run 3: Independent Validation Run 2 (Fresh baseline)
const run3_pulses = 1960;
const run3_actualL = 3.0; // Operator collects 3.0 L
const run3_est = calculateEstimatedFlowVolume(run3_pulses, run1_candidateK); // 1960 / 660 = 2.969 L
const run3_err = calculateFlowVerificationError(run3_est.volumeL, run3_actualL);
assert.strictEqual(run3_err.isPassed, true, "Validation Run 2 within tolerance");
console.log(`  Run 3 (Val 2): Est=${run3_est.volumeL.toFixed(3)}L, Act=${run3_actualL}L, Error=${run3_err.errorPct.toFixed(2)}% (PASS: ${run3_err.isPassed})`);

// Both validation runs passed => Eligible for promotion to VERIFIED!
if (run2_err.isPassed && run3_err.isPassed) {
  verificationStatus = "VERIFIED";
}
assert.strictEqual(verificationStatus, "VERIFIED", "Promoted to VERIFIED after 2 successful validation runs");
console.log(`  Status Promoted to: ${verificationStatus}`);

// Test failure case: If Validation Run 2 had 10% error
const failEst = calculateEstimatedFlowVolume(2300, run1_candidateK); // 2300 / 660 = 3.484 L vs 3.0 L = 16.1% error
const failErr = calculateFlowVerificationError(failEst.volumeL, 3.0);
assert.strictEqual(failErr.isPassed, false);
let failStatus = "CALIBRATION_PENDING";
if (failErr.isPassed) {
  failStatus = "VERIFIED";
}
assert.strictEqual(failStatus, "CALIBRATION_PENDING", "Must NOT promote to VERIFIED if validation fails");
console.log(`  Failed validation correctly retained as: ${failStatus}`);

console.log("\n=== ALL FLOW SENSOR MATHEMATICAL & VERIFICATION TESTS PASSED ===");
