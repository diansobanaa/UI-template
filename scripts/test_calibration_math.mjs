import { calculateDosingFlowRate, validateVolumeInput, aggregateDosingSamples } from "../src/lib/calibration-math.js";
import assert from "node:assert";

console.log("=== RUNNING DOSING CALIBRATION MATHEMATICAL TESTS (SECTION 5 & 8) ===");

// 1. SECTION 5 MANDATORY TEST CASES
const testCases = [
  { volume: 120, duration: 30, expected: 240 },
  { volume: 40, duration: 10, expected: 240 },
  { volume: 12, duration: 30, expected: 24 },
  { volume: 60, duration: 30, expected: 120 },
  { volume: 120, duration: 60, expected: 120 },
];

for (const tc of testCases) {
  const result = calculateDosingFlowRate(tc.volume, tc.duration);
  assert.strictEqual(
    Math.round(result * 100) / 100,
    tc.expected,
    `Failed for ${tc.volume}ml in ${tc.duration}s: got ${result}, expected ${tc.expected}`
  );
  console.log(`✓ Test case PASS: ${tc.volume} ml / ${tc.duration} s => ${result.toFixed(1)} ml/min (Expected: ${tc.expected})`);
}

// 2. INVALID / BOUNDARY VALUE TESTS
console.log("\nTesting edge cases and validation...");
assert.strictEqual(calculateDosingFlowRate(0, 30), 0, "Zero volume should return 0");
assert.strictEqual(calculateDosingFlowRate(-10, 30), 0, "Negative volume should return 0");
assert.strictEqual(calculateDosingFlowRate(100, 0), 0, "Zero duration should return 0");
assert.strictEqual(calculateDosingFlowRate(100, -10), 0, "Negative duration should return 0");
assert.strictEqual(calculateDosingFlowRate(NaN, 30), 0, "NaN volume should return 0");
assert.strictEqual(calculateDosingFlowRate(100, Infinity), 0, "Infinity duration should return 0");
console.log("✓ All edge cases correctly rejected with 0");

// 3. INPUT VALIDATION TESTS
const valZero = validateVolumeInput(0, 30);
assert.strictEqual(valZero.valid, false, "Zero volume must be invalid");
const valNeg = validateVolumeInput(-5, 30);
assert.strictEqual(valNeg.valid, false, "Negative volume must be invalid");
const valValid = validateVolumeInput(120, 30);
assert.strictEqual(valValid.valid, true, "120ml in 30s must be valid");
assert.strictEqual(valValid.volumeMl, 120);
console.log("✓ Volume input validation rules verified");

// 4. MULTI-SAMPLE AGGREGATION & 3-STAGE PROGRESSIVE VALIDATION TESTS (SECTION 6 & 11)
console.log("\nTesting 3-stage progressive calibration (10s -> 30s -> 60s)...");

// Section 6 & 11 Test Case 1: Consistent Set (20ml/10s, 60ml/30s, 120ml/60s => all 120 ml/min)
const consistent3Stage = [
  { volumeMl: 20, durationSec: 10 },
  { volumeMl: 60, durationSec: 30 },
  { volumeMl: 120, durationSec: 60 },
];
const aggConsistent = aggregateDosingSamples(consistent3Stage);
assert.strictEqual(aggConsistent.valid, true, "Consistent set must be valid");
assert.strictEqual(aggConsistent.totalVolumeMl, 200, "Total volume should be 200 ml");
assert.strictEqual(aggConsistent.totalDurationSec, 100, "Total duration should be 100 s");
assert.strictEqual(Math.round(aggConsistent.flowRateMlMin), 120, "Expected aggregated flow rate 120 ml/min");
assert.strictEqual(aggConsistent.isConsistent, true, "Must pass consistency check");
assert.strictEqual(aggConsistent.maxDeviationPct, 0, "Zero deviation across identical rates");
console.log(`✓ Section 11 Consistent Set PASS: 20ml/10s + 60ml/30s + 120ml/60s => ${aggConsistent.flowRateMlMin.toFixed(1)} ml/min (isConsistent: ${aggConsistent.isConsistent})`);

// Section 6 & 11 Test Case 2: Inconsistent Set (20ml/10s -> 120 ml/min, 45ml/30s -> 90 ml/min, 60ml/60s -> 60 ml/min)
const inconsistent3Stage = [
  { volumeMl: 20, durationSec: 10 },
  { volumeMl: 45, durationSec: 30 },
  { volumeMl: 60, durationSec: 60 },
];
const aggInconsistent = aggregateDosingSamples(inconsistent3Stage);
assert.strictEqual(aggInconsistent.valid, true);
assert.strictEqual(aggInconsistent.referenceRateMlMin, 90, "Median reference rate should be 90 ml/min");
assert.strictEqual(aggInconsistent.isConsistent, false, "Must fail consistency check (>10% deviation)");
assert.ok(aggInconsistent.maxDeviationPct > 10.0, "Deviation must exceed 10%");
assert.ok(aggInconsistent.errorMessage && aggInconsistent.errorMessage.includes("tidak konsisten"));
console.log(`✓ Section 11 Inconsistent Set CORRECTLY FAILED: Max deviation ${aggInconsistent.maxDeviationPct.toFixed(1)}% > 10% (isConsistent: ${aggInconsistent.isConsistent})`);

console.log("\n=== ALL MATHEMATICAL TESTS PASSED SUCCESSFULLY ===");
