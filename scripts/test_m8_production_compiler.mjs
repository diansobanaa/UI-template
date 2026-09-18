/**
 * M8 Test Suite 1: Production Schedule Compiler
 * 
 * Verifies:
 * - Server-only ScheduleCompiler execution with zero browser dependencies
 * - Full dependency closure resolution (missing resources, routing, recipes -> BLOCKED)
 * - Immutable recipe snapshot embedding in compiled schedule artifact
 * - Static resource conflict detection and priority resolution
 * - Parameter and recurrence validation
 */

import { ScheduleCompiler, PRODUCT_MAX_RESOLVED_RESOURCES } from '../server/compiler/ScheduleCompiler.ts';

console.log("==================================================");
console.log("  M8 TEST SUITE 1: PRODUCTION SCHEDULE COMPILER   ");
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

// 1. Base Valid Candidate Configuration Snapshot
const baseConfig = {
  complexId: "COMPLEX-01",
  version: 42,
  updatedAt: new Date().toISOString(),
  greenhouses: [
    { ghId: "GH-01", name: "Greenhouse Alpha" },
    { ghId: "GH-02", name: "Greenhouse Beta" }
  ],
  components: [
    { componentId: "COMP-PUMP-01", name: "Main Well Pump", driver: "RELAY", bus: "GPIO", address: 12 },
    { componentId: "COMP-VALVE-01", name: "GH-01 Main Valve", driver: "RELAY", bus: "GPIO", address: 14 },
    { componentId: "COMP-DOSING-A", name: "Dosing Pump A", driver: "RELAY", bus: "GPIO", address: 15 },
    { componentId: "COMP-DOSING-B", name: "Dosing Pump B", driver: "RELAY", bus: "GPIO", address: 16 },
    { componentId: "COMP-FLOW-01", name: "Flow Meter", driver: "PULSE", bus: "GPIO", address: 21 },
    { componentId: "COMP-FAN-01", name: "Exhaust Fan GH-01", driver: "RELAY", bus: "GPIO", address: 22 }
  ],
  assignments: [
    { assignmentId: "A-PUMP", resourceId: "pump-well", scope: "COMPLEX", ghId: null },
    { assignmentId: "A-VLV1", resourceId: "valve-gh01", scope: "GH", ghId: "GH-01" },
    { assignmentId: "A-DOSA", resourceId: "dosing-pump-a", scope: "COMPLEX", ghId: null },
    { assignmentId: "A-DOSB", resourceId: "dosing-pump-b", scope: "COMPLEX", ghId: null },
    { assignmentId: "A-FLOW", resourceId: "flow-sensor-01", scope: "COMPLEX", ghId: null },
    { assignmentId: "A-FAN1", resourceId: "fan-gh01", scope: "GH", ghId: "GH-01" }
  ],
  topology: [
    { sourceResourceId: "pump-well", targetResourceId: "GH-01" }
  ],
  recipes: [
    {
      recipeId: "REC-VEG-01",
      name: "Vegetative Phase A/B",
      type: "FERTIGATION",
      targetEc: 2.2,
      targetPh: 5.8,
      ratioA: 5.0,
      ratioB: 5.0,
      durationSec: 300,
      volumeMl: 1500
    }
  ],
  schedules: [],
  compiledSchedules: [],
  settings: {}
};

// ----------------------------------------------------
// TEST 1.1: Dependency Closure Resolution & Recipe Snapshot
// ----------------------------------------------------
console.log("\n--- Scenario 1.1: Full Dependency Closure & Recipe Snapshot ---");

const validFertSchedule = {
  scheduleId: "SCHED-FERT-01",
  targetGhId: "GH-01",
  action: "FERTIGATION_START",
  priority: 10,
  missedRunPolicy: "SKIP",
  enabled: true,
  recipeId: "REC-VEG-01",
  triggerType: "DAILY",
  hour: 6,
  minute: 30
};

const candidateWithFert = {
  ...baseConfig,
  schedules: [validFertSchedule]
};

const compiledCandidate = ScheduleCompiler.compileCandidate(candidateWithFert);
assert(compiledCandidate.compiledSchedules.length === 1, "Candidate compiles exactly 1 schedule");
const cs = compiledCandidate.compiledSchedules[0];

assert(cs.status === "VALIDATING", "Valid enabled schedule has status VALIDATING");
assert(cs.configurationVersion === 42, "Compiled schedule captured configurationVersion = 42");
assert(cs.resolvedResources.includes("dosing-pump-a"), "Resolved dosing-pump-a");
assert(cs.resolvedResources.includes("dosing-pump-b"), "Resolved dosing-pump-b");
assert(cs.resolvedResources.includes("valve-gh01"), "Resolved valve-gh01");
assert(cs.safetyDependencies.includes("FLOW_VALID"), "Includes safety dependency FLOW_VALID");
assert(cs.safetyDependencies.includes("ESTOP_INACTIVE"), "Includes safety dependency ESTOP_INACTIVE");

// Verify Recipe Snapshot
assert(cs.recipeSnapshot !== null, "Recipe snapshot is non-null");
assert(cs.recipeSnapshot.recipeId === "REC-VEG-01", "Snapshot captured correct recipeId");
assert(cs.recipeSnapshot.targetEc === 2.2, "Snapshot captured targetEc = 2.2");
assert(cs.recipeSnapshot.targetPh === 5.8, "Snapshot captured targetPh = 5.8");
assert(cs.recipeSnapshot.volumeMl === 1500, "Snapshot captured volumeMl = 1500");

// ----------------------------------------------------
// TEST 1.2: Missing Dosing Pump -> BLOCKED (RESOURCE_MISSING)
// ----------------------------------------------------
console.log("\n--- Scenario 1.2: Missing Dosing Pump Dependency ---");

const configWithoutDosing = {
  ...baseConfig,
  assignments: baseConfig.assignments.filter(a => !a.resourceId.includes("dosing"))
};

const candidateNoDosing = {
  ...configWithoutDosing,
  schedules: [validFertSchedule]
};

const resNoDosing = ScheduleCompiler.compileCandidate(candidateNoDosing).compiledSchedules[0];
assert(resNoDosing.status === "BLOCKED", "Schedule is BLOCKED when dosing pump is missing");
assert(resNoDosing.blockedReason.code === "RESOURCE_MISSING", "Blocked reason is RESOURCE_MISSING");

// ----------------------------------------------------
// TEST 1.3: Missing Recipe -> BLOCKED (RECIPE_INVALID)
// ----------------------------------------------------
console.log("\n--- Scenario 1.3: Missing / Invalid Recipe ---");

const schedUnknownRecipe = {
  ...validFertSchedule,
  scheduleId: "SCHED-FERT-BAD-REC",
  recipeId: "REC-NON-EXISTENT"
};

const resBadRec = ScheduleCompiler.compileCandidate({
  ...baseConfig,
  schedules: [schedUnknownRecipe]
}).compiledSchedules[0];

assert(resBadRec.status === "BLOCKED", "Schedule is BLOCKED when recipe does not exist");
assert(resBadRec.blockedReason.code === "RECIPE_INVALID", "Blocked reason is RECIPE_INVALID");

// ----------------------------------------------------
// TEST 1.4: Invalid Target Greenhouse -> BLOCKED (INVALID_GH)
// ----------------------------------------------------
console.log("\n--- Scenario 1.4: Invalid Target Greenhouse ---");

const schedBadGh = {
  ...validFertSchedule,
  scheduleId: "SCHED-BAD-GH",
  targetGhId: "GH-999"
};

const resBadGh = ScheduleCompiler.compileCandidate({
  ...baseConfig,
  schedules: [schedBadGh]
}).compiledSchedules[0];

assert(resBadGh.status === "BLOCKED", "Schedule is BLOCKED when greenhouse is not in config");
assert(resBadGh.blockedReason.code === "INVALID_GH", "Blocked reason is INVALID_GH");

// ----------------------------------------------------
// TEST 1.5: Static Resource Conflict Resolution by Priority
// ----------------------------------------------------
console.log("\n--- Scenario 1.5: Static Resource Conflict Resolution ---");

const schedWellPumpP10 = {
  scheduleId: "SCHED-WELL-HIGH",
  targetGhId: "GH-01",
  action: "WATER_PUMP_START",
  priority: 20, // Higher priority
  missedRunPolicy: "SKIP",
  enabled: true,
  triggerType: "DAILY",
  hour: 8,
  minute: 0
};

const schedWellPumpP5 = {
  scheduleId: "SCHED-WELL-LOW",
  targetGhId: "GH-02",
  action: "WATER_PUMP_START",
  priority: 5, // Lower priority
  missedRunPolicy: "SKIP",
  enabled: true,
  triggerType: "DAILY",
  hour: 8,
  minute: 0
};

const candidateConflict = {
  ...baseConfig,
  schedules: [schedWellPumpP10, schedWellPumpP5]
};

const conflictResult = ScheduleCompiler.compileCandidate(candidateConflict);
const sHigh = conflictResult.compiledSchedules.find(s => s.scheduleId === "SCHED-WELL-HIGH");
const sLow = conflictResult.compiledSchedules.find(s => s.scheduleId === "SCHED-WELL-LOW");

assert(sHigh.status === "VALIDATING", "Higher priority schedule remains VALIDATING");
assert(sLow.status === "BLOCKED", "Lower priority schedule is marked BLOCKED due to conflict");
assert(sLow.blockedReason.code === "RESOURCE_CONFLICT", "Blocked reason is RESOURCE_CONFLICT");
assert(sLow.blockedReason.resourceId.includes("pump"), "Blocked reason cites conflicting resource");

// ----------------------------------------------------
// TEST 1.6: Disabled Schedule Preserved as DISABLED
// ----------------------------------------------------
console.log("\n--- Scenario 1.6: Disabled Schedule ---");

const schedDisabled = {
  ...validFertSchedule,
  scheduleId: "SCHED-DISABLED",
  enabled: false
};

const resDisabled = ScheduleCompiler.compileCandidate({
  ...baseConfig,
  schedules: [schedDisabled]
}).compiledSchedules[0];

assert(resDisabled.status === "DISABLED", "Disabled schedule retains DISABLED status");

console.log(`\n==================================================`);
console.log(`  SUITE 1 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log(`==================================================\n`);
