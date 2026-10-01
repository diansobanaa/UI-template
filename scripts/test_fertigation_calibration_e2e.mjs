import assert from "node:assert/strict";
import { generateFertigationExecutionPlan } from "../src/lib/runtime/execution-plan-generator.js";
import { createAutomaticMultiGhConfiguration } from "../tests/runtime-fixture.mjs";

console.log("=== COMPREHENSIVE FERTIGATION CALIBRATION & LOGIC AUDIT SUITE ===");

// 1. Mathematical Duration Formula Tests
console.log("\n[Test 1] Mathematical Conversion ($T_{ms} = \\frac{V_{ml}}{Rate_{ml/min}} \\times 60,000$)...");

function calculateDosingMs(volumeMl, flowRateMlMin) {
  if (flowRateMlMin <= 0 || !Number.isFinite(flowRateMlMin)) {
    throw new Error("INVALID_FLOW_RATE");
  }
  const rateMlSec = flowRateMlMin / 60.0;
  return Math.round((volumeMl / rateMlSec) * 1000);
}

// Case 1: 12 ml/min, 30 ml -> 150,000 ms
const dur1 = calculateDosingMs(30, 12);
assert.equal(dur1, 150000, "12 ml/min with 30 ml must equal 150,000 ms");
console.log("  PASS: 12 ml/min with 30 ml target = 150,000 ms");

// Case 2: 12 ml/min, 120 ml -> 600,000 ms
const dur2 = calculateDosingMs(120, 12);
assert.equal(dur2, 600000, "12 ml/min with 120 ml must equal 600,000 ms");
console.log("  PASS: 12 ml/min with 120 ml target = 600,000 ms");

// Case 3: 24 ml/min, 120 ml -> 300,000 ms
const dur3 = calculateDosingMs(120, 24);
assert.equal(dur3, 300000, "24 ml/min with 120 ml must equal 300,000 ms");
console.log("  PASS: 24 ml/min with 120 ml target = 300,000 ms");

// 2. Uncalibrated Pump Rejection Test in Execution Plan Generator
console.log("\n[Test 2] Execution Plan Generator Uncalibrated Pump Rejection...");

const fullConfig = createAutomaticMultiGhConfiguration();
// Add explicit dosing channels to recipe
fullConfig.recipes[0].dosingChannels = [
  { componentId: "dose-a", requestedMl: 120 },
  { componentId: "dose-b", requestedMl: 120 },
];

// Case A: Missing calibration rate -> MUST BE BLOCKED
const planUncalibrated = generateFertigationExecutionPlan(
  fullConfig,
  { ghId: "GH-01", recipeId: "recipe-01" },
  { calibrations: {} } // No calibration provided
);
assert.equal(planUncalibrated.valid, false, "Plan without calibration must be marked invalid");
const hasBlockedIssue = planUncalibrated.blockedReasons.some(r => r.code === "DOSING_PUMP_NOT_CALIBRATED");
assert.ok(hasBlockedIssue, "Must report DOSING_PUMP_NOT_CALIBRATED issue");
console.log("  PASS: Plan correctly blocked when dosing pump has no active calibration.");

// Case B: Calibrated pumps -> MUST SUCCEED with precise runtime
const planCalibrated = generateFertigationExecutionPlan(
  fullConfig,
  { ghId: "GH-01", recipeId: "recipe-01" },
  {
    calibrations: {
      dosingRates: {
        "dose-a": 0.4, // 24 ml/min -> 120 ml requires 300s
        "dose-b": 0.2, // 12 ml/min -> 120 ml requires 600s
      }
    }
  }
);
assert.equal(planCalibrated.valid, true, "Plan with calibrated rates must be valid");
const doseAStep = planCalibrated.executionPlan.dosingChannels.find(d => d.componentId === "dose-a");
const doseBStep = planCalibrated.executionPlan.dosingChannels.find(d => d.componentId === "dose-b");
assert.equal(doseAStep.runtimeSec, 300, "120 ml at 0.4 ml/s must be 300 seconds");
assert.equal(doseBStep.runtimeSec, 600, "120 ml at 0.2 ml/s must be 600 seconds");
console.log("  PASS: Plan valid and calculates exact runtime: Pump A = 300s, Pump B = 600s.");

// 3. Multi-GH Isolation Test
console.log("\n[Test 3] Multi-Greenhouse Isolation (GH-01 vs GH-02)...");
const planGH01 = generateFertigationExecutionPlan(
  fullConfig,
  { ghId: "GH-01", recipeId: "recipe-01" },
  { calibrations: { dosingRates: { "dose-a": 0.4, "dose-b": 0.2 } } }
);
assert.equal(planGH01.valid, true, "Plan GH-01 must be valid");
assert.equal(planGH01.executionPlan.ghId, "GH-01", "Plan target must strictly belong to GH-01");
assert.equal(planGH01.executionPlan.components.mixingTank, "mix-01", "GH-01 must use mix-01");

const planGH02 = generateFertigationExecutionPlan(
  fullConfig,
  { ghId: "GH-02", recipeId: "recipe-01" },
  { calibrations: { dosingRates: { "dose-a": 0.4, "dose-b": 0.2 } } }
);
assert.equal(planGH02.valid, true, "Plan GH-02 must be valid");
assert.equal(planGH02.executionPlan.ghId, "GH-02", "Plan target must strictly belong to GH-02");
assert.equal(planGH02.executionPlan.components.mixingTank, "mix-02", "GH-02 must use mix-02");
assert.notEqual(
  planGH01.executionPlan.components.mixingTank,
  planGH02.executionPlan.components.mixingTank,
  "GH-01 and GH-02 must never share mixing tanks"
);
console.log("  PASS: Strict Multi-GH isolation verified: GH-01 uses mix-01, GH-02 uses mix-02, tanks are dedicated and separated.");

console.log("\n>>> ALL FERTIGATION & CALIBRATION AUDIT TESTS PASSED! <<<");
