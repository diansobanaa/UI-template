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

// 4. MULTI-SAMPLE AGGREGATION TESTS (SECTION 4 STEP 4)
console.log("\nTesting multi-sample aggregation...");
// Scenario A: Three 30s samples with 118ml, 120ml, 122ml (Total: 360ml in 90s => 240 ml/min)
const multiSampleA = [
  { volumeMl: 118, durationSec: 30 },
  { volumeMl: 120, durationSec: 30 },
  { volumeMl: 122, durationSec: 30 },
];
const aggA = aggregateDosingSamples(multiSampleA);
assert.strictEqual(aggA.valid, true);
assert.strictEqual(aggA.totalVolumeMl, 360);
assert.strictEqual(aggA.totalDurationSec, 90);
assert.strictEqual(Math.round(aggA.flowRateMlMin), 240);
assert.strictEqual(aggA.isConsistent, true);
console.log(`✓ Multi-sample A PASS: 3x samples total 360ml / 90s => ${aggA.flowRateMlMin.toFixed(1)} ml/min (max dev: ${aggA.maxDeviationPct.toFixed(2)}%)`);

// Scenario B: Multi-sample with mixed durations: 40ml in 10s and 120ml in 30s => 160ml in 40s => 240 ml/min
const multiSampleB = [
  { volumeMl: 40, durationSec: 10 },
  { volumeMl: 120, durationSec: 30 },
];
const aggB = aggregateDosingSamples(multiSampleB);
assert.strictEqual(aggB.valid, true);
assert.strictEqual(aggB.totalVolumeMl, 160);
assert.strictEqual(aggB.totalDurationSec, 40);
assert.strictEqual(Math.round(aggB.flowRateMlMin), 240);
console.log(`✓ Multi-sample B (mixed durations) PASS: 40ml/10s + 120ml/30s => ${aggB.flowRateMlMin.toFixed(1)} ml/min`);

console.log("\n=== ALL MATHEMATICAL TESTS PASSED SUCCESSFULLY ===");
