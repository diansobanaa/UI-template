import assert from "node:assert/strict";
import { buildResourceIndex, checkResourceConflicts, validateResourceAssignments } from "../src/lib/runtime/resource-engine.js";
import { buildTopologyView, calculateCapabilities, validateTopology } from "../src/lib/runtime/topology-engine.js";
import { compileSchedule, compileScheduleSet, canDeployCompiledSchedule } from "../src/lib/runtime/schedule-compiler.js";
import { createAutomaticMultiGhConfiguration, createManualSharedConfiguration } from "../tests/runtime-fixture.mjs";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const automatic = createAutomaticMultiGhConfiguration();

function makeExecutionPlan(configuration, ghId, configurationHash = null) {
  const byGh = configuration.components.filter((c) => c.assignment?.ghId === ghId);
  const exact = (id) => configuration.components.find((c) => c.componentId === id)?.resourceId || null;
  const isGh1 = ghId === "GH-01";
  const components = {
    mixingTank: isGh1 ? "mix-01" : "mix-02",
    rawWater: "well-pump-01",
    fillPump: "well-pump-01",
    rawFlow: "raw-flow",
    level: isGh1 ? "level-01" : "level-02",
    mixingPump: null,
    deliveryPump: isGh1 ? "dist-01" : "dist-02",
    deliveryFlow: isGh1 ? "flow-01" : "flow-02",
    pressure: null,
  };
  const selected = Object.values(components).filter(Boolean);
  const resources = [...new Set(selected.map(exact).filter(Boolean))].map((resourceId) => ({
    resourceId,
    componentId: configuration.resources.find((r) => r.resourceId === resourceId)?.componentId || null,
    shared: configuration.resources.find((r) => r.resourceId === resourceId)?.shared === true,
    available: true,
  }));
  return {
    planVersion: 1,
    complexId: configuration.complexId,
    ghId,
    configurationVersion: configuration.version,
    configurationHash: configurationHash || null,
    targetWaterMl: 20000,
    components,
    resources,
    topologyPaths: configuration.topology.filter((p) => p.targetGhId === ghId),
    routingPaths: configuration.topology.filter((p) => p.targetGhId === ghId).map((p) => p.pathId),
    routingValves: configuration.topology.filter((p) => p.targetGhId === ghId).map((p) => p.valveResourceId).filter(Boolean),
    resourceResolution: Object.fromEntries(resources.map((r) => [r.resourceId, r])),
    sensorCalibrations: {
      rawFlow: { sensorId: "raw-flow", calibrationId: "CAL-RAW-FLOW-V1", version: 1 },
      deliveryFlow: { sensorId: components.deliveryFlow, calibrationId: `CAL-${components.deliveryFlow.toUpperCase()}-V1`, version: 1 },
    },
    dosingChannels: [
      { componentId: "dose-a", requestedMl: 100, calibrationId: "CAL-DOSE-A-V1", calibrationVersion: 1, runtimeSec: 10 },
      { componentId: "dose-b", requestedMl: 100, calibrationId: "CAL-DOSE-B-V1", calibrationVersion: 1, runtimeSec: 10 },
    ],
    recipe: { recipeId: "recipe-01", version: 1, snapshot: { recipeId: "recipe-01", version: 1, name: "Melon Base" } },
    mixingDurationSec: 0,
    delivery: { mode: "VOLUME", targetDeliveredMl: 20000, targetFlowLpm: 0, targetPressureKpa: 0, durationSec: 900, toleranceMl: 100, allowDurationFallback: false },
    timeouts: { maxRuntimeSec: 3600, minDosingRuntimeSec: 0, maxDosingRuntimeSec: 1800, fillTimeoutSec: 300, deliveryTimeoutSec: 600 },
    safety: { safetyAcknowledged: true, emergencyStopRequired: true },
  };
}

test("M6 shared/exclusive ownership detects duplicate exclusive owner", () => {
  const cfg = structuredClone(automatic);
  cfg.resources.find((r) => r.resourceId === "res-dist-01").shared = false;
  cfg.assignments.push({ assignmentId: "a-conflict", resourceId: "res-dist-01", scope: "GH", ghId: "GH-02" });
  const result = validateResourceAssignments(cfg);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((x) => x.code === "EXCLUSIVE_RESOURCE_CONFLICT"));
});

test("M6 shared resource can be locked without inventing a second owner", () => {
  const { resourceById } = buildResourceIndex(automatic);
  assert.equal(resourceById.get("res-well").shared, true);
  const conflicts = checkResourceConflicts(["res-well"], [{ resourceId: "res-well", ownerId: "GH-01" }], "GH-02", automatic);
  assert.equal(conflicts.length, 0);
});

test("M7 automatic multi-GH topology produces independent reachability", () => {
  const view = buildTopologyView(automatic);
  const gh1 = view.greenhouses.find((x) => x.ghId === "GH-01");
  const gh2 = view.greenhouses.find((x) => x.ghId === "GH-02");
  assert.equal(view.valid, true);
  assert.equal(gh1.automaticallyRoutable, true);
  assert.equal(gh2.automaticallyRoutable, true);
  assert.equal(gh1.hydraulicallyReachable, true);
  assert.equal(gh2.hydraulicallyReachable, true);
});

test("M7 derives capability instead of GH-number rules", () => {
  const cap = calculateCapabilities(automatic);
  assert.equal(cap.byGh["GH-01"].capabilities.CAN_AUTO_ROUTE, true);
  assert.equal(cap.byGh["GH-02"].capabilities.CAN_AUTO_ROUTE, true);
  assert.equal(cap.byGh["GH-01"].capabilities.CAN_AUTO_DOSE, true);
  assert.equal(cap.byGh["GH-02"].capabilities.CAN_AUTO_DOSE, true);
});

test("M7 manual route owner limits autonomous capability to current physical target", () => {
  const cfg = createManualSharedConfiguration();
  const view = buildTopologyView(cfg);
  const gh1 = view.greenhouses.find((x) => x.ghId === "GH-01");
  const gh2 = view.greenhouses.find((x) => x.ghId === "GH-02");
  assert.equal(gh1.currentSharedManualTarget, "GH-01");
  assert.equal(gh2.currentSharedManualTarget, null);
  assert.equal(gh1.automaticallyRoutable, false);
  assert.equal(gh2.automaticallyRoutable, false);
  const cap = calculateCapabilities(cfg);
  assert.equal(cap.byGh["GH-01"].capabilities.CAN_RUN_AUTONOMOUSLY, true);
  assert.equal(cap.byGh["GH-02"].capabilities.CAN_RUN_AUTONOMOUSLY, false);
});

test("M7 detects duplicate exclusive physical paths", () => {
  const cfg = structuredClone(automatic);
  cfg.topology.push({ ...cfg.topology[0], pathId: "dup", shared: false });
  const result = validateTopology(cfg);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((x) => x.code === "TOPOLOGY_PATH_CONFLICT"));
});

test("M8 valid resource-complete fertigation compiles with resolved dependencies", () => {
  const result = compileSchedule(automatic, {
    scheduleId: "sched-gh01",
    ownerId: "schedule-owner-gh01",
    complexId: "complex-A",
    ghId: "GH-01",
    action: "FERTIGATION",
    enabled: true,
    priority: 20,
    trigger: { type: "DAILY", hour: 6, minute: 30, daysOfWeek: 127 },
    recipeId: "recipe-01",
    missedRunPolicy: "SKIP",
    parameters: { rawWaterVolumeMl: 20000, durationSec: 900, automaticDosing: true, executionPlan: makeExecutionPlan(automatic, "GH-01", "abc123") },
  }, { nowTimestamp: 1789741800000, configurationHash: "abc123" });
  assert.equal(result.status, "ACTIVE");
  assert.ok(result.compiled);
  assert.ok(result.compiled.resourceIds.includes("res-mix-01"));
  assert.ok(result.compiled.componentIds.includes("dist-01"));
  assert.equal(result.compiled.configurationVersion, 17);
  assert.equal(result.compiled.configurationHash, "abc123");
  assert.deepEqual(result.compiled.recipeSnapshot.recipeId, "recipe-01");
  assert.equal(canDeployCompiledSchedule(result.compiled), true);
});

test("M8 automatic fertigation without a resolved execution plan is BLOCKED", () => {
  const result = compileSchedule(automatic, {
    scheduleId: "sched-no-plan", ownerId: "sched-no-plan", complexId: "complex-A", ghId: "GH-01", action: "FERTIGATION", enabled: true,
    trigger: { type: "DAILY", hour: 8, minute: 0, daysOfWeek: 127 }, recipeId: "recipe-01", missedRunPolicy: "SKIP",
    parameters: { rawWaterVolumeMl: 1000, durationSec: 60 },
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockedReasons.some((x) => x.code === "EXECUTION_PLAN_REQUIRED"));
  assert.equal(result.compiled, null);
});

test("M8 missing resource becomes BLOCKED, not ACTIVE", () => {
  const cfg = structuredClone(automatic);
  cfg.components = cfg.components.filter((c) => c.componentId !== "dist-02");
  cfg.resources = cfg.resources.filter((r) => r.resourceId !== "res-dist-02");
  const result = compileSchedule(cfg, {
    scheduleId: "sched-gh02",
    ownerId: "schedule-owner-gh02",
    complexId: "complex-A",
    ghId: "GH-02",
    action: "FERTIGATION",
    enabled: true,
    trigger: { type: "DAILY", hour: 7, minute: 0, daysOfWeek: 127 },
    recipeId: "recipe-01",
    missedRunPolicy: "SKIP",
    parameters: { rawWaterVolumeMl: 10000, durationSec: 600, executionPlan: makeExecutionPlan(cfg, "GH-02") },
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockedReasons.some((x) => x.code === "PLAN_COMPONENT_INVALID"));
  assert.equal(result.compiled, null);
});

test("M8 invalid recurrence becomes INVALID", () => {
  const result = compileSchedule(automatic, {
    scheduleId: "sched-invalid",
    ownerId: "owner",
    complexId: "complex-A",
    ghId: "GH-01",
    action: "FERTIGATION",
    enabled: true,
    trigger: { type: "DAILY", hour: 25, minute: 99, daysOfWeek: 0 },
    recipeId: "recipe-01",
    missedRunPolicy: "SKIP",
    parameters: { rawWaterVolumeMl: 1000, durationSec: 30 },
  });
  assert.equal(result.status, "INVALID");
  assert.ok(result.errors.some((x) => x.code === "INVALID_HOUR"));
});

test("M8 disabled schedule never becomes executable", () => {
  const result = compileSchedule(automatic, {
    scheduleId: "sched-disabled",
    ownerId: "owner",
    complexId: "complex-A",
    ghId: "GH-01",
    action: "FERTIGATION",
    enabled: false,
    trigger: { type: "DAILY", hour: 5, minute: 0, daysOfWeek: 127 },
    recipeId: "recipe-01",
    missedRunPolicy: "SKIP",
    parameters: { rawWaterVolumeMl: 1000, durationSec: 30 },
  });
  assert.equal(result.status, "DISABLED");
  assert.equal(result.compiled, null);
});

test("M8 set compilation separates active/blocked/invalid schedules", () => {
  const result = compileScheduleSet(automatic, [
    { scheduleId: "active", ownerId: "active", complexId: "complex-A", ghId: "GH-01", action: "FAN_TOGGLE", enabled: false, trigger: { type: "DAILY", hour: 8, minute: 0, daysOfWeek: 127 }, missedRunPolicy: "SKIP", parameters: { durationSec: 60 } },
    { scheduleId: "valid-fert", ownerId: "valid-fert", complexId: "complex-A", ghId: "GH-01", action: "FERTIGATION", enabled: true, trigger: { type: "DAILY", hour: 9, minute: 0, daysOfWeek: 127 }, recipeId: "recipe-01", missedRunPolicy: "SKIP", parameters: { rawWaterVolumeMl: 1000, durationSec: 60, executionPlan: makeExecutionPlan(automatic, "GH-01") } },
    { scheduleId: "bad", ownerId: "bad", complexId: "complex-A", ghId: "GH-01", action: "FERTIGATION", enabled: true, trigger: { type: "DAILY", hour: 99, minute: 0, daysOfWeek: 127 }, recipeId: "recipe-01", missedRunPolicy: "SKIP", parameters: { rawWaterVolumeMl: 1000, durationSec: 60 } },
  ]);
  assert.equal(result.results.length, 3);
  assert.equal(result.compiled.length, 1);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.valid, false);
});


test("M6 exclusive lock still conflicts when inferred from configuration", () => {
  const cfg = structuredClone(automatic);
  const conflicts = checkResourceConflicts(["res-dist-01"], [{ resourceId: "res-dist-01", ownerId: "GH-02" }], "GH-01", cfg);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].lockType, "EXCLUSIVE");
});

test("M7 hydraulic reachability is not created by a delivery-only edge", () => {
  const cfg = structuredClone(automatic);
  cfg.topology = cfg.topology.filter((p) => p.pathId.startsWith("mix-"));
  const view = buildTopologyView(cfg);
  assert.equal(view.greenhouses.find((x) => x.ghId === "GH-01").hydraulicallyReachable, false);
  assert.equal(view.greenhouses.find((x) => x.ghId === "GH-01").automaticallyRoutable, false);
});

test("M7 single-GH direct topology remains automatically routable without a routing valve", () => {
  const cfg = structuredClone(automatic);
  cfg.greenhouses = cfg.greenhouses.filter((gh) => gh.ghId === "GH-01");
  cfg.components = cfg.components.filter((c) => c.assignment?.ghId !== "GH-02" && c.componentId !== "route-v1");
  cfg.resources = cfg.resources.filter((r) => r.resourceId !== "res-mix-02" && r.resourceId !== "res-dist-02" && r.resourceId !== "res-route-01" && r.resourceId !== "res-route-02" && r.resourceId !== "res-flow-02" && r.resourceId !== "res-level-02");
  cfg.assignments = cfg.assignments.filter((a) => a.ghId !== "GH-02" && !["res-route-01", "res-route-02", "res-mix-02", "res-dist-02", "res-flow-02", "res-level-02"].includes(a.resourceId));
  cfg.topology = cfg.topology.filter((p) => p.pathId.includes("gh01")).map((p) => ({ ...p, valveResourceId: null }));
  const view = buildTopologyView(cfg);
  const gh1 = view.greenhouses.find((x) => x.ghId === "GH-01");
  assert.equal(gh1.hydraulicallyReachable, true);
  assert.equal(gh1.automaticallyRoutable, true);
  assert.equal(calculateCapabilities(cfg).byGh["GH-01"].capabilities.CAN_AUTO_FILL, true);
});

test("M7 multi-GH shared source without routing valves is not automatically independent", () => {
  const cfg = structuredClone(automatic);
  cfg.components = cfg.components.filter((c) => !String(c.role || "").includes("ROUTING_VALVE"));
  cfg.resources = cfg.resources.filter((r) => !String(r.type || "").includes("ROUTING_VALVE"));
  cfg.assignments = cfg.assignments.filter((a) => !["res-route-01", "res-route-02"].includes(a.resourceId));
  cfg.topology = cfg.topology.map((p) => ({ ...p, valveResourceId: null }));
  const view = buildTopologyView(cfg);
  assert.equal(view.greenhouses.find((x) => x.ghId === "GH-01").hydraulicallyReachable, true);
  assert.equal(view.greenhouses.find((x) => x.ghId === "GH-01").automaticallyRoutable, false);
  assert.equal(calculateCapabilities(cfg).byGh["GH-01"].capabilities.CAN_AUTO_FILL, false);
});


test("M8 temperature fan intent is INVALID, never executable", () => {
  const result = compileSchedule(automatic, {
    scheduleId: "temp-fan", ownerId: "temp-fan", complexId: "complex-A", ghId: "GH-01", action: "FAN_TOGGLE", enabled: true,
    trigger: { type: "DAILY", hour: 10, minute: 0, daysOfWeek: 127 }, missedRunPolicy: "SKIP",
    parameters: { durationSec: 60, controlMode: "TEMPERATURE" },
  });
  assert.equal(result.status, "INVALID");
  assert.ok(result.errors.some((x) => x.code === "UNSUPPORTED_CONDITION_TRIGGER"));
  assert.equal(result.compiled, null);
});

test("M8 draft schedule remains non-executable", () => {
  const result = compileSchedule(automatic, {
    scheduleId: "draft-test", ownerId: "draft-test", complexId: "complex-A", ghId: "GH-01", action: "FAN_TOGGLE", enabled: true, activationState: "DRAFT",
    trigger: { type: "DAILY", hour: 8, minute: 0, daysOfWeek: 127 }, missedRunPolicy: "SKIP", parameters: { durationSec: 60 },
  });
  assert.equal(result.status, "DRAFT");
  assert.equal(result.compiled, null);
  assert.equal(canDeployCompiledSchedule(result.compiled), false);
});

test("M8 fallback reference is carried into compiled schedule", () => {
  const cfg = structuredClone(automatic);
  cfg.components.push({ ...cfg.components.find((c) => c.componentId === "dist-01"), componentId: "fan-01b", supportedTypeId: "FAN", name: "GH01 Fan 2", role: "FAN", resourceId: "res-fan-01b", wiring: { interface: "GPIO", gpio: 24 }, assignment: { complexId: "complex-A", ghId: "GH-01" } });
  cfg.resources.push({ resourceId: "res-fan-01b", type: "FAN", componentId: "fan-01b", shared: false, available: true });
  cfg.assignments.push({ assignmentId: "a-fan-01b", resourceId: "res-fan-01b", scope: "GH", ghId: "GH-01" });
  const result = compileScheduleSet(cfg, [
    { scheduleId: "primary", ownerId: "primary", complexId: "complex-A", ghId: "GH-01", action: "FAN_TOGGLE", enabled: true, fallbackEnabled: true, fallbackScheduleId: "fallback", trigger: { type: "DAILY", hour: 8, minute: 0, daysOfWeek: 127 }, missedRunPolicy: "SKIP", parameters: { durationSec: 60 } },
    { scheduleId: "fallback", ownerId: "fallback", complexId: "complex-A", ghId: "GH-01", action: "FAN_TOGGLE", enabled: true, trigger: { type: "DAILY", hour: 9, minute: 0, daysOfWeek: 127 }, missedRunPolicy: "SKIP", parameters: { durationSec: 60 } },
  ]);
  assert.equal(result.compiled.length, 2);
  assert.deepEqual(result.compiled.find((x) => x.scheduleId === "primary").fallback, { enabled: true, scheduleId: "fallback" });
});

test("M8 missing fallback reference blocks executable schedule", () => {
  const result = compileScheduleSet(automatic, [
    { scheduleId: "primary", ownerId: "primary", complexId: "complex-A", ghId: "GH-01", action: "FAN_TOGGLE", enabled: true, fallbackEnabled: true, fallbackScheduleId: "missing", trigger: { type: "DAILY", hour: 8, minute: 0, daysOfWeek: 127 }, missedRunPolicy: "SKIP", parameters: { durationSec: 60 } },
  ]);
  assert.equal(result.compiled.length, 0);
  assert.equal(result.blocked.length, 1);
  assert.ok(result.blocked[0].blockedReasons.some((x) => x.code === "MISSING_FALLBACK_SCHEDULE"));
});

test("M8 raw-water pump without safety sensors is BLOCKED", () => {
  const cfg = structuredClone(automatic);
  cfg.components = cfg.components.filter((c) => !["raw-flow", "raw-level"].includes(c.componentId));
  cfg.resources = cfg.resources.filter((r) => !["res-raw-flow", "res-raw-level"].includes(r.resourceId));
  cfg.assignments = cfg.assignments.filter((a) => !["res-raw-flow", "res-raw-level"].includes(a.resourceId));
  const result = compileSchedule(cfg, {
    scheduleId: "unsafe-pump", ownerId: "unsafe-pump", complexId: "complex-A", action: "WATER_PUMP", enabled: true,
    trigger: { type: "DAILY", hour: 6, minute: 0, daysOfWeek: 127 }, missedRunPolicy: "SKIP", parameters: { durationSec: 60 },
  });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockedReasons.some((x) => x.code === "MISSING_FLOW_SENSOR"));
  assert.ok(result.blockedReasons.some((x) => x.code === "MISSING_LEVEL_SENSOR"));
});

test("M8 schedule deployment gate rejects missing activation state", () => {
  const result = compileSchedule(automatic, {
    scheduleId: "gate-test", ownerId: "gate-test", complexId: "complex-A", ghId: "GH-01", action: "WATER_PUMP", enabled: true,
    trigger: { type: "DAILY", hour: 5, minute: 0, daysOfWeek: 127 }, missedRunPolicy: "SKIP", parameters: { durationSec: 60 },
  });
  const compiled = { ...result.compiled, activationState: "BLOCKED" };
  assert.equal(canDeployCompiledSchedule(compiled), false);
});

console.log(`M7/M8 runtime acceptance: ${passed} PASS`);
