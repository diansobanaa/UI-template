/**
 * M8 Test Suite 4: Multi-Greenhouse Isolation & Shared Conflict
 * 
 * Verifies:
 * - Multi-greenhouse domain independence (GH-01 vs GH-02)
 * - Disjoint resources allow concurrent execution without interference
 * - Shared exclusive resource contention between greenhouses is detected and resolved by priority
 * - Cross-greenhouse resource boundary enforcement (GH-01 cannot claim GH-02 private resources)
 */

import { ScheduleCompiler } from '../server/compiler/ScheduleCompiler.ts';

console.log("==================================================");
console.log("  M8 TEST SUITE 4: MULTI-GH ISOLATION & CONFLICT  ");
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

const multiGhConfig = {
  complexId: "COMPLEX-01",
  version: 20,
  updatedAt: new Date().toISOString(),
  greenhouses: [
    { ghId: "GH-01", name: "Greenhouse North" },
    { ghId: "GH-02", name: "Greenhouse South" }
  ],
  components: [
    { componentId: "COMP-FAN-GH1", name: "Fan GH1", driver: "RELAY", bus: "GPIO", address: 4 },
    { componentId: "COMP-FAN-GH2", name: "Fan GH2", driver: "RELAY", bus: "GPIO", address: 5 },
    { componentId: "COMP-SHARED-WELL", name: "Shared Well Pump", driver: "RELAY", bus: "GPIO", address: 6 },
    { componentId: "COMP-VLV-GH1", name: "Valve GH1", driver: "RELAY", bus: "GPIO", address: 7 },
    { componentId: "COMP-VLV-GH2", name: "Valve GH2", driver: "RELAY", bus: "GPIO", address: 8 }
  ],
  assignments: [
    { assignmentId: "A-FAN-1", resourceId: "fan-gh01", scope: "GH", ghId: "GH-01" },
    { assignmentId: "A-FAN-2", resourceId: "fan-gh02", scope: "GH", ghId: "GH-02" },
    { assignmentId: "A-WELL", resourceId: "pump-well", scope: "COMPLEX", ghId: null },
    { assignmentId: "A-V1", resourceId: "valve-gh01", scope: "GH", ghId: "GH-01" },
    { assignmentId: "A-V2", resourceId: "valve-gh02", scope: "GH", ghId: "GH-02" }
  ],
  topology: [
    { sourceResourceId: "pump-well", targetResourceId: "GH-01" },
    { sourceResourceId: "pump-well", targetResourceId: "GH-02" }
  ],
  recipes: [],
  schedules: [],
  compiledSchedules: [],
  settings: {}
};

// ----------------------------------------------------
// TEST 4.1: Disjoint Resource Independence
// ----------------------------------------------------
console.log("\n--- Scenario 4.1: Disjoint Resource Independence (Fans) ---");

const schedFanGh1 = {
  scheduleId: "SCHED-FAN-GH1",
  targetGhId: "GH-01",
  action: "FAN_START",
  priority: 10,
  enabled: true,
  triggerType: "DAILY",
  hour: 13,
  minute: 0
};

const schedFanGh2 = {
  scheduleId: "SCHED-FAN-GH2",
  targetGhId: "GH-02",
  action: "FAN_START",
  priority: 10,
  enabled: true,
  triggerType: "DAILY",
  hour: 13,
  minute: 0
};

const resDisjoint = ScheduleCompiler.compileCandidate({
  ...multiGhConfig,
  schedules: [schedFanGh1, schedFanGh2]
});

const cGh1 = resDisjoint.compiledSchedules.find(s => s.scheduleId === "SCHED-FAN-GH1");
const cGh2 = resDisjoint.compiledSchedules.find(s => s.scheduleId === "SCHED-FAN-GH2");

assert(cGh1.status === "VALIDATING", "GH-01 Fan schedule is VALIDATING");
assert(cGh2.status === "VALIDATING", "GH-02 Fan schedule is VALIDATING");
assert(cGh1.resolvedResources.includes("fan-gh01"), "GH-01 resolved fan-gh01");
assert(!cGh1.resolvedResources.includes("fan-gh02"), "GH-01 did NOT resolve GH-02's fan");
assert(cGh2.resolvedResources.includes("fan-gh02"), "GH-02 resolved fan-gh02");
assert(!cGh2.resolvedResources.includes("fan-gh01"), "GH-02 did NOT resolve GH-01's fan");

// ----------------------------------------------------
// TEST 4.2: Failure in GH-02 Does Not Invalidate GH-01
// ----------------------------------------------------
console.log("\n--- Scenario 4.2: Fault Isolation Across Domains ---");

// Remove GH-02 fan assignment, leaving GH-01 intact
const configBrokenGh2 = {
  ...multiGhConfig,
  assignments: multiGhConfig.assignments.filter(a => a.resourceId !== "fan-gh02"),
  schedules: [schedFanGh1, schedFanGh2]
};

const resIsolated = ScheduleCompiler.compileCandidate(configBrokenGh2);
const cGh1Intact = resIsolated.compiledSchedules.find(s => s.scheduleId === "SCHED-FAN-GH1");
const cGh2Broken = resIsolated.compiledSchedules.find(s => s.scheduleId === "SCHED-FAN-GH2");

assert(cGh1Intact.status === "VALIDATING", "GH-01 remains VALIDATING despite GH-02 missing component");
assert(cGh2Broken.status === "BLOCKED", "GH-02 is BLOCKED due to missing fan");
assert(cGh2Broken.blockedReason.code === "RESOURCE_MISSING", "GH-02 blocked reason is RESOURCE_MISSING");

// ----------------------------------------------------
// TEST 4.3: Shared Exclusive Resource Contention (Well Pump)
// ----------------------------------------------------
console.log("\n--- Scenario 4.3: Shared Exclusive Resource Contention ---");

const schedWellGh1 = {
  scheduleId: "SCHED-WELL-GH1",
  targetGhId: "GH-01",
  action: "WATER_PUMP_START",
  priority: 100, // Higher priority
  enabled: true,
  triggerType: "DAILY",
  hour: 8,
  minute: 0
};

const schedWellGh2 = {
  scheduleId: "SCHED-WELL-GH2",
  targetGhId: "GH-02",
  action: "WATER_PUMP_START",
  priority: 50, // Lower priority
  enabled: true,
  triggerType: "DAILY",
  hour: 8,
  minute: 0
};

const resShared = ScheduleCompiler.compileCandidate({
  ...multiGhConfig,
  schedules: [schedWellGh1, schedWellGh2]
});

const cWellGh1 = resShared.compiledSchedules.find(s => s.scheduleId === "SCHED-WELL-GH1");
const cWellGh2 = resShared.compiledSchedules.find(s => s.scheduleId === "SCHED-WELL-GH2");

assert(cWellGh1.status === "VALIDATING", "GH-01 higher priority schedule (P100) wins and remains VALIDATING");
assert(cWellGh2.status === "BLOCKED", "GH-02 lower priority schedule (P50) is BLOCKED");
assert(cWellGh2.blockedReason.code === "RESOURCE_CONFLICT", "Conflict detected with code RESOURCE_CONFLICT");
assert(cWellGh2.blockedReason.resourceId === "pump-well", "Conflicting resource correctly identified as pump-well");

console.log(`\n==================================================`);
console.log(`  SUITE 4 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log(`==================================================\n`);
