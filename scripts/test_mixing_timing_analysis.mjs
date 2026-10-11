import assert from "node:assert";
import { calculateMixingTimingAnalysis } from "../src/lib/calibration-math.ts";

console.log("=== Testing calculateMixingTimingAnalysis ===");

// Test 1: User's exact scenario
// Target: 20000 ml, raw rate: 147.3333 ml/s, pulses: 666.2162, threshold: 20%, post mix: 30s
// Dosing A: 200 ml @ 1.66667 ml/s
// Dosing B: 200 ml @ 1.75 ml/s
const res1 = calculateMixingTimingAnalysis({
  rawWaterTargetMl: 20000,
  rawWaterRateMlSec: 147.3333,
  flowPulsesPerL: 666.2162,
  thresholdPercent: 20,
  postMixDurationSec: 30,
  channels: [
    { componentId: "pump_dosing_a", name: "Nutrient Dosing Pump A (Stock A)", targetVolumeMl: 200, rateMlSec: 1.66667 },
    { componentId: "pump_dosing_b", name: "Nutrient Dosing Pump B (Stock B)", targetVolumeMl: 200, rateMlSec: 1.75 },
  ],
});

console.log("Test 1 Result:", JSON.stringify(res1, null, 2));

assert.strictEqual(res1.rawWaterPulses, 13324, "Raw water pulses should be 13324");
assert.ok(Math.abs(res1.rawWaterPump.runtimeSec - 135.75) < 0.1, `Raw runtime expected ~135.75, got ${res1.rawWaterPump.runtimeSec}`);
assert.ok(Math.abs(res1.thresholdReachedTimeSec - 27.15) < 0.1, `Threshold time expected ~27.15, got ${res1.thresholdReachedTimeSec}`);
assert.strictEqual(res1.dosingChannels.length, 2, "Should have 2 dosing channels");

const chA = res1.dosingChannels[0];
const chB = res1.dosingChannels[1];
assert.ok(Math.abs(chA.runtimeSec - 120.0) < 0.1, `Channel A runtime expected ~120s, got ${chA.runtimeSec}`);
assert.ok(Math.abs(chB.runtimeSec - 114.29) < 0.1, `Channel B runtime expected ~114.29s, got ${chB.runtimeSec}`);
assert.ok(Math.abs(chA.endTimeSec - 147.15) < 0.1, `Channel A end expected ~147.15, got ${chA.endTimeSec}`);
assert.ok(Math.abs(chB.endTimeSec - 141.44) < 0.1, `Channel B end expected ~141.44, got ${chB.endTimeSec}`);

// Post mix starts at max(135.75, 147.15) = 147.15s
assert.ok(Math.abs(res1.postMixStartTimeSec - 147.15) < 0.1, `Post mix start expected ~147.15, got ${res1.postMixStartTimeSec}`);
assert.ok(Math.abs(res1.postMixEndTimeSec - 177.15) < 0.1, `Post mix end expected ~177.15, got ${res1.postMixEndTimeSec}`);
assert.ok(Math.abs(res1.mixingPump.runtimeSec - 150.0) < 0.1, `Mixing pump runtime expected ~150.0, got ${res1.mixingPump.runtimeSec}`);
assert.ok(Math.abs(res1.totalTheoreticalTimeSec - 177.15) < 0.1, `Total theoretical time expected ~177.15, got ${res1.totalTheoreticalTimeSec}`);

console.log("All tests passed successfully!");
