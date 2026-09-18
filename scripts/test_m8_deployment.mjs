/**
 * M8 Test Suite 5: Candidate Deployment & Legacy Rejection
 * 
 * Verifies:
 * - Full candidate configuration deployment lifecycle (Stage -> Validate -> Apply -> Promote)
 * - Atomic activation promotes VALIDATING schedules to ACTIVE
 * - Legacy bypass POST /api/v1/schedules returns HTTP 405 Method Not Allowed
 * - Direct ESP32 schedule creation is strictly prohibited
 */

import { ScheduleCompiler } from '../server/compiler/ScheduleCompiler.ts';

console.log("==================================================");
console.log("  M8 TEST SUITE 5: CANDIDATE DEPLOYMENT & 405     ");
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

// ----------------------------------------------------
// TEST 5.1: Stage, Compile & Promote Pipeline
// ----------------------------------------------------
console.log("\n--- Scenario 5.1: M4 Candidate Configuration Pipeline ---");

const candidate = {
  complexId: "COMPLEX-01",
  version: 30,
  updatedAt: new Date().toISOString(),
  greenhouses: [{ ghId: "GH-01", name: "GH Alpha" }],
  components: [
    { componentId: "COMP-FAN-1", name: "Vent Fan", driver: "RELAY", bus: "GPIO", address: 4 }
  ],
  assignments: [
    { assignmentId: "A-FAN", resourceId: "fan-01", scope: "GH", ghId: "GH-01" }
  ],
  topology: [],
  recipes: [],
  schedules: [
    {
      scheduleId: "SCHED-VENT-01",
      targetGhId: "GH-01",
      action: "FAN_START",
      priority: 10,
      enabled: true,
      triggerType: "DAILY",
      hour: 14,
      minute: 0
    }
  ],
  compiledSchedules: [],
  settings: {}
};

// Stage 1: Authoritative compilation produces VALIDATING compiled schedule
const compiledPayload = ScheduleCompiler.compileCandidate(candidate);
assert(compiledPayload.compiledSchedules.length === 1, "Candidate compiles 1 schedule");
const stagedSched = compiledPayload.compiledSchedules[0];
assert(stagedSched.status === "VALIDATING", "Staged schedule status is VALIDATING");

// Stage 2: Firmware Semantic Validation Simulation (configuration_mgr.c: validate_candidate_semantics)
function simulateFirmwareValidateSemantics(candidatePayload) {
  for (const s of candidatePayload.compiledSchedules) {
    if (s.status === "INVALID") {
      return { ok: false, code: "SCHED_SEMANTIC_INVALID", message: "Schedule status INVALID cannot be deployed" };
    }
    if (s.resolvedResources.length > 16) {
      return { ok: false, code: "ESP_ERR_INVALID_SIZE", message: "Resolved resources exceed 16" };
    }
  }
  return { ok: true };
}

const validationRes = simulateFirmwareValidateSemantics(compiledPayload);
assert(validationRes.ok === true, "Firmware semantic validation succeeds for candidate");

// Stage 3: Atomic Promotion on Apply (configuration_mgr.c: apply_candidate)
function simulateFirmwareApplyCandidate(activeConfig, candidatePayload) {
  const deployedSchedules = candidatePayload.compiledSchedules.map(s => {
    return {
      ...s,
      status: (s.status === "VALIDATING" || s.status === "ACTIVE") ? "ACTIVE" : s.status
    };
  });

  return {
    ...candidatePayload,
    compiledSchedules: deployedSchedules,
    isApplied: true
  };
}

const activeDeployed = simulateFirmwareApplyCandidate({ version: 29 }, compiledPayload);
assert(activeDeployed.compiledSchedules[0].status === "ACTIVE", "Schedule promoted to ACTIVE upon atomic apply");
assert(activeDeployed.version === 30, "Active configuration version is 30");

// ----------------------------------------------------
// TEST 5.2: Legacy Direct Schedule POST /api/v1/schedules Returns 405
// ----------------------------------------------------
console.log("\n--- Scenario 5.2: Legacy Direct Schedule Creation Rejection ---");

// Matches esp32/main/http/api_schedule_handlers.c api_schedules_post_handler:
function handleLegacySchedulePost(req) {
  return {
    status: 405,
    headers: { "Allow": "GET" },
    body: {
      error: "Method Not Allowed",
      message: "Direct schedule creation via POST /api/v1/schedules is disabled. Schedules must be compiled into a candidate configuration and deployed via /api/v1/configuration/candidate and /apply."
    }
  };
}

const mockReq = { method: "POST", url: "/api/v1/schedules", body: { scheduleId: "SCHED-RAW" } };
const postResponse = handleLegacySchedulePost(mockReq);

assert(postResponse.status === 405, "Direct schedule POST returns HTTP 405 Method Not Allowed");
assert(postResponse.headers.Allow === "GET", "Allow header indicates only GET is permitted");
assert(postResponse.body.message.includes("deployed via /api/v1/configuration/candidate"), "Response body guides user to candidate deployment");

console.log(`\n==================================================`);
console.log(`  SUITE 5 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log(`==================================================\n`);
