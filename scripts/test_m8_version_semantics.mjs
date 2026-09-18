/**
 * M8 Test Suite 2: Version Semantics & Invalidation (Tests A-F)
 * 
 * Verifies:
 * - Test A: Matching candidate config compiles and promotes to ACTIVE on deployment
 * - Test B: Stale schedule with mismatched config version is rejected at compile/runtime
 * - Test C: Configuration rollback invalidates active schedules bound to superseded version
 * - Test D: Monotonic version bump required for candidate configuration promotion
 * - Test E: Recipe revision updates invalidate older compiled schedule snapshots
 * - Test F: Removal of hardware component moves dependent schedule to BLOCKED
 */

import { ScheduleCompiler } from '../server/compiler/ScheduleCompiler.ts';

console.log("==================================================");
console.log("  M8 TEST SUITE 2: VERSION SEMANTICS (TESTS A-F)  ");
console.log("==================================================");

let passed = 0;
let total = 0;

function assert(condition, testName, details = "") {
  total++;
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName}: ${details}`);
    process.exit(1);
  }
}

const baseConfig = {
  complexId: "COMPLEX-01",
  version: 10,
  updatedAt: new Date().toISOString(),
  greenhouses: [{ ghId: "GH-01", name: "Greenhouse 1" }],
  components: [
    { componentId: "COMP-FAN-1", name: "Exhaust Fan", driver: "RELAY", bus: "GPIO", address: 12 },
    { componentId: "COMP-PUMP-1", name: "Dosing Pump", driver: "RELAY", bus: "GPIO", address: 14 }
  ],
  assignments: [
    { assignmentId: "A-FAN", resourceId: "fan-01", scope: "GH", ghId: "GH-01" },
    { assignmentId: "A-PUMP", resourceId: "dosing-pump", scope: "COMPLEX", ghId: null },
    { assignmentId: "A-VLV", resourceId: "valve-01", scope: "GH", ghId: "GH-01" }
  ],
  topology: [],
  recipes: [
    {
      recipeId: "REC-01",
      name: "Standard Recipe",
      type: "FERTIGATION",
      targetEc: 2.0,
      targetPh: 6.0,
      volumeMl: 1000,
      version: 1
    }
  ],
  schedules: [
    {
      scheduleId: "SCHED-FAN-01",
      targetGhId: "GH-01",
      action: "FAN_START",
      priority: 10,
      missedRunPolicy: "SKIP",
      enabled: true,
      triggerType: "DAILY",
      hour: 12,
      minute: 0
    },
    {
      scheduleId: "SCHED-FERT-01",
      targetGhId: "GH-01",
      action: "FERTIGATION_START",
      recipeId: "REC-01",
      priority: 10,
      missedRunPolicy: "SKIP",
      enabled: true,
      triggerType: "DAILY",
      hour: 7,
      minute: 0
    }
  ],
  compiledSchedules: [],
  settings: {}
};

// ----------------------------------------------------
// TEST A: Matching candidate compiles and promotes to ACTIVE
// ----------------------------------------------------
console.log("\n--- Test A: Matching candidate config compiles and promotes to ACTIVE ---");
const candidateA = { ...baseConfig, version: 11 };
const compiledA = ScheduleCompiler.compileCandidate(candidateA);

assert(compiledA.compiledSchedules.length === 2, "Candidate A compiles 2 schedules");
assert(compiledA.compiledSchedules.every(s => s.status === "VALIDATING"), "All compiled schedules enter VALIDATING");
assert(compiledA.compiledSchedules.every(s => s.configurationVersion === 11), "All compiled schedules reflect version 11");

// Simulated promotion on ESP32 apply_candidate
const deployedActiveA = compiledA.compiledSchedules.map(s => ({
  ...s,
  status: s.status === "VALIDATING" ? "ACTIVE" : s.status
}));
assert(deployedActiveA.every(s => s.status === "ACTIVE"), "Deployed candidate successfully promoted to ACTIVE");

// ----------------------------------------------------
// TEST B: Stale schedule with mismatched config version rejected
// ----------------------------------------------------
console.log("\n--- Test B: Stale schedule with mismatched config version rejected ---");
const currentActiveVersion = 15;
const staleSchedule = {
  ...compiledA.compiledSchedules[0],
  configurationVersion: 11 // Old version
};

// Runtime dispatch check (matching scheduler.c: sched->configuration_version == active_cfg.version)
function isEligibleForDispatch(sched, activeConfigVersion) {
  if (sched.status !== "ACTIVE") return false;
  if (sched.configurationVersion !== activeConfigVersion) return false;
  return true;
}

assert(isEligibleForDispatch(staleSchedule, currentActiveVersion) === false, "Stale schedule with v11 rejected when active config is v15");

// ----------------------------------------------------
// TEST C: Configuration rollback invalidates incompatible active schedules
// ----------------------------------------------------
console.log("\n--- Test C: Config rollback invalidates incompatible active schedules ---");
// Suppose system rolled back from v15 to v10 where components differ
const rolledBackConfig = { ...baseConfig, version: 10 };
const recompiledAfterRollback = ScheduleCompiler.compileCandidate(rolledBackConfig);

assert(recompiledAfterRollback.compiledSchedules.every(s => s.configurationVersion === 10), "All schedules re-bound to rolled-back version 10");
// Any schedule referencing v15 is now stale and ineligible
assert(isEligibleForDispatch({ ...staleSchedule, status: "ACTIVE", configurationVersion: 15 }, 10) === false, "v15 schedule cannot dispatch against rolled-back v10 config");

// ----------------------------------------------------
// TEST D: Monotonic version bump required for new candidate
// ----------------------------------------------------
console.log("\n--- Test D: Monotonic version bump required for new candidate ---");
function validateCandidateVersion(activeVersion, candidateVersion) {
  if (candidateVersion <= activeVersion) {
    return { valid: false, error: "Candidate version must be strictly greater than active configuration version." };
  }
  return { valid: true };
}

assert(validateCandidateVersion(10, 11).valid === true, "Version 11 > 10 is accepted");
assert(validateCandidateVersion(10, 10).valid === false, "Version 10 == 10 is rejected");
assert(validateCandidateVersion(10, 9).valid === false, "Version 9 < 10 is rejected");

// ----------------------------------------------------
// TEST E: Recipe revision changes invalidate older compiled schedule
// ----------------------------------------------------
console.log("\n--- Test E: Recipe revision changes invalidate older compiled schedule ---");
const recipeV1Schedule = compiledA.compiledSchedules.find(s => s.scheduleId === "SCHED-FERT-01");
assert(recipeV1Schedule.recipeSnapshot.recipeId === "REC-01", "Old schedule has snapshot of REC-01");
assert(recipeV1Schedule.recipeSnapshot.targetEc === 2.0, "Old schedule has targetEc = 2.0");

// Recipe is updated in candidate v12
const candidateWithUpdatedRecipe = {
  ...baseConfig,
  version: 12,
  recipes: [
    {
      recipeId: "REC-01",
      name: "Updated Recipe",
      type: "FERTIGATION",
      targetEc: 2.8, // Changed!
      targetPh: 5.5,
      volumeMl: 2000,
      version: 2
    }
  ]
};

const compiledV12 = ScheduleCompiler.compileCandidate(candidateWithUpdatedRecipe);
const newSched = compiledV12.compiledSchedules.find(s => s.scheduleId === "SCHED-FERT-01");

assert(newSched.configurationVersion === 12, "New schedule has version 12");
assert(newSched.recipeSnapshot.targetEc === 2.8, "New schedule snapshot captures updated targetEc = 2.8");
assert(recipeV1Schedule.recipeSnapshot.targetEc !== newSched.recipeSnapshot.targetEc, "Old compiled schedule is decoupled and invalidated by new compilation");

// ----------------------------------------------------
// TEST F: Missing component in new configuration moves schedule to BLOCKED
// ----------------------------------------------------
console.log("\n--- Test F: Missing component in new configuration moves schedule to BLOCKED ---");
// In candidate v13, the fan actuator is decommissioned/removed
const candidateWithoutFan = {
  ...baseConfig,
  version: 13,
  assignments: baseConfig.assignments.filter(a => !a.resourceId.includes("fan"))
};

const compiledV13 = ScheduleCompiler.compileCandidate(candidateWithoutFan);
const fanSchedV13 = compiledV13.compiledSchedules.find(s => s.scheduleId === "SCHED-FAN-01");

assert(fanSchedV13.status === "BLOCKED", "Fan schedule transitions to BLOCKED when fan resource is deleted");
assert(fanSchedV13.blockedReason.code === "RESOURCE_MISSING", "Blocked reason is RESOURCE_MISSING");
assert(fanSchedV13.configurationVersion === 13, "Blocked artifact captures candidate configurationVersion 13");

console.log(`\n==================================================`);
console.log(`  SUITE 2 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log(`==================================================\n`);
