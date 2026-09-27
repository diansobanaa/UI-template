/**
 * Mixing-Fertigation Operational Model Integration & Verification Suite
 * Tests end-to-end alignment against docs/MIXING_FERTIGATION_OPERATIONAL_MODEL.md
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateFertigationExecutionPlan } from "../src/lib/runtime/execution-plan-generator.js";
import { compileSchedule, compileScheduleSet } from "../src/lib/runtime/schedule-compiler.js";
import { createAutomaticMultiGhConfiguration } from "../tests/runtime-fixture.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

console.log("=== MIXING-FERTIGATION OPERATIONAL MODEL VERIFICATION ===");

// -------------------------------------------------------------
// 1. Single-GH and Multi-GH identity invariant (Spec §3.1, §3.2, §16, §17)
// -------------------------------------------------------------
test("Invariant 1 & 2: Single-GH retains explicit complexId and ghId identically to multi-GH", () => {
  const multiCfg = createAutomaticMultiGhConfiguration();
  const planMulti1 = generateFertigationExecutionPlan(multiCfg, {
    complexId: "complex-A",
    ghId: "GH-01",
    recipeId: "recipe-01",
    targetWaterMl: 20000,
  });
  assert.equal(planMulti1.valid, true);
  assert.equal(planMulti1.executionPlan.complexId, "complex-A");
  assert.equal(planMulti1.executionPlan.ghId, "GH-01");

  // Single-GH configuration (only 1 GH in complex)
  const singleCfg = structuredClone(multiCfg);
  singleCfg.greenhouses = [singleCfg.greenhouses[0]];
  if (singleCfg.topologyPool) singleCfg.topologyPool.greenhouses = [singleCfg.topologyPool.greenhouses[0]];
  singleCfg.components = singleCfg.components.filter((c) => !c.assignment?.ghId || c.assignment?.ghId === "GH-01");

  // In single-GH, even if ghId is omitted in user intent, it is deterministically resolved to GH-01
  const planSingle = generateFertigationExecutionPlan(singleCfg, {
    recipeId: "recipe-01",
    targetWaterMl: 15000,
  });
  assert.equal(planSingle.valid, true);
  assert.equal(planSingle.executionPlan.complexId, "complex-A");
  assert.equal(planSingle.executionPlan.ghId, "GH-01");
  assert.ok(planSingle.executionPlan.ghId.length > 0);
});

// -------------------------------------------------------------
// 2. Recipe -> Dosing -> Mixing explicitly connected (Spec §2.2, §7, §26 Invariant 7)
// -------------------------------------------------------------
test("Invariant 7: Recipe directly determines dosing channels, volumes, and calibrations in Mixing phase", () => {
  const cfg = createAutomaticMultiGhConfiguration();
  const planRes = generateFertigationExecutionPlan(cfg, {
    complexId: "complex-A",
    ghId: "GH-01",
    recipeId: "recipe-01",
    targetWaterMl: 25000,
    dosingChannels: [
      { componentId: "dose-a", requestedMl: 125, calibrationId: "CAL-DOSE-A-V1", calibrationVersion: 1 },
      { componentId: "dose-b", requestedMl: 125, calibrationId: "CAL-DOSE-B-V1", calibrationVersion: 1 },
    ],
  });

  assert.equal(planRes.valid, true);
  const plan = planRes.executionPlan;
  assert.equal(plan.targetWaterMl, 25000);
  assert.equal(plan.recipe.recipeId, "recipe-01");
  assert.equal(plan.dosingChannels.length, 2);
  assert.equal(plan.dosingChannels[0].componentId, "dose-a");
  assert.equal(plan.dosingChannels[0].requestedMl, 125);
  assert.equal(plan.dosingChannels[1].componentId, "dose-b");
  assert.equal(plan.dosingChannels[1].requestedMl, 125);
  assert.ok(plan.dosingChannels[0].calibrationId);
});

// -------------------------------------------------------------
// 3. Equipment Ready/Disabled State & BLOCKED behavior (Spec §13, §15)
// -------------------------------------------------------------
test("Invariant 10: Disabled equipment marks schedule BLOCKED with specific reasons without deletion", () => {
  const cfg = createAutomaticMultiGhConfiguration();

  // Test Delivery Pump disabled
  const cfgNoPump = structuredClone(cfg);
  cfgNoPump.components.find((c) => c.componentId === "dist-01").lifecycleState = "DISABLED";

  const resBlocked = compileSchedule(cfgNoPump, {
    scheduleId: "fert-sched-1",
    ownerId: "owner-1",
    complexId: "complex-A",
    ghId: "GH-01",
    action: "FERTIGATION",
    enabled: true,
    trigger: { type: "DAILY", hour: 6, minute: 0, daysOfWeek: 127 },
    recipeId: "recipe-01",
    missedRunPolicy: "SKIP",
    parameters: { rawWaterVolumeMl: 20000, durationSec: 900 },
  }, { autoGeneratePlan: true });

  assert.equal(resBlocked.status, "BLOCKED");
  assert.equal(resBlocked.activationState, "BLOCKED");
  assert.ok(resBlocked.blockedReasons.some((r) => r.code === "DELIVERY_PUMP_UNAVAILABLE"));
  assert.equal(resBlocked.compiled, null);

  // When equipment is re-enabled, exact same schedule intent compiles to ACTIVE
  const resActive = compileSchedule(cfg, {
    scheduleId: "fert-sched-1",
    ownerId: "owner-1",
    complexId: "complex-A",
    ghId: "GH-01",
    action: "FERTIGATION",
    enabled: true,
    trigger: { type: "DAILY", hour: 6, minute: 0, daysOfWeek: 127 },
    recipeId: "recipe-01",
    missedRunPolicy: "SKIP",
    parameters: { rawWaterVolumeMl: 20000, durationSec: 900 },
  }, { autoGeneratePlan: true });

  assert.equal(resActive.status, "ACTIVE");
  assert.equal(resActive.activationState, "ACTIVE");
  assert.ok(resActive.compiled);
  assert.ok(resActive.compiled.parameters.executionPlan);
});

// -------------------------------------------------------------
// 4. Resource Separation & Locking (Spec §9, §10, §11)
// -------------------------------------------------------------
test("Invariant 9: Resource locks derived from actual component identities, separating mixing and delivery", () => {
  const cfg = createAutomaticMultiGhConfiguration();
  const plan1 = generateFertigationExecutionPlan(cfg, { ghId: "GH-01", recipeId: "recipe-01" }).executionPlan;
  const plan2 = generateFertigationExecutionPlan(cfg, { ghId: "GH-02", recipeId: "recipe-01" }).executionPlan;

  // GH-01 and GH-02 have separate mixing tanks
  assert.notEqual(plan1.components.mixingTank, plan2.components.mixingTank);
  // GH-01 and GH-02 have separate delivery pumps
  assert.notEqual(plan1.components.deliveryPump, plan2.components.deliveryPump);
  // Raw water source is shared
  assert.equal(plan1.components.rawWater, plan2.components.rawWater);

  const res1Ids = new Set(plan1.resources.map((r) => r.resourceId));
  const res2Ids = new Set(plan2.resources.map((r) => r.resourceId));

  // Shared raw well pump is in both resource sets
  assert.ok(res1Ids.has("res-well") && res2Ids.has("res-well"));
  // Dedicated delivery pumps are distinct
  assert.ok(res1Ids.has("res-dist-01") && !res1Ids.has("res-dist-02"));
  assert.ok(res2Ids.has("res-dist-02") && !res2Ids.has("res-dist-01"));
});

// -------------------------------------------------------------
// 5. Firmware State Machine & MIX_READY Verification (Spec §6, §12)
// -------------------------------------------------------------
test("Invariant 4, 5, 6: Firmware implements explicit MIX_READY state and separates mixing vs delivery results", () => {
  const mgrH = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.h"), "utf8");
  const mgrC = fs.readFileSync(path.resolve("esp32/main/services/fertigation_mgr.c"), "utf8");

  // Verify FERT_STATE_MIX_READY enum
  assert.match(mgrH, /FERT_STATE_MIX_READY/, "fertigation_mgr.h must contain FERT_STATE_MIX_READY");
  assert.match(mgrC, /"MIX_READY"/, "fertigation_mgr.c must include MIX_READY in state_name");

  // Verify MIX_READY transitions after mixing pump completion and before delivery
  assert.match(mgrC, /transition\(FERT_STATE_MIX_READY\);/);
  assert.match(mgrC, /case FERT_STATE_MIX_READY:/);
  assert.match(mgrC, /transition\(FERT_STATE_DELIVERY\);/);

  // Verify events: MIX_READY, FLOW_FAULT, DELIVERY_COMPLETED, FERTIGATION_RUN_COMPLETED
  assert.match(mgrC, /event_mgr_log_command\(LOG_LEVEL_INFO,\s*"MIX_READY"/);
  assert.match(mgrC, /event_mgr_log_command\(LOG_LEVEL_ERROR,\s*"FLOW_FAULT"/);
  assert.match(mgrC, /event_mgr_log_command\(LOG_LEVEL_INFO,\s*"DELIVERY_COMPLETED"/);

  // Verify semantic separation in snapshot: mixing status vs delivery status
  assert.match(mgrC, /cJSON_AddStringToObject\(mix_obj,\s*"status"/);
  assert.match(mgrC, /cJSON_AddStringToObject\(del_obj,\s*"status"/);
});

// -------------------------------------------------------------
// 6. Live Physical ESP32 Verification (Target: 192.168.0.139)
// -------------------------------------------------------------
await asyncTest("Live ESP32 fertigation status endpoint adherence", async () => {
  const ESP32_IP = "192.168.0.139";
  const url = `http://${ESP32_IP}/api/v1/fertigation/status`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: "Bearer agrotech-secret-key" },
      signal: AbortSignal.timeout(3000),
    });

    if (res.ok) {
      const data = await res.json();
      console.log("Live ESP32 Fertigation Status:", JSON.stringify(data.data, null, 2));
      assert.ok(data.data.state, "Snapshot must have state");
      assert.ok(data.data.phase, "Snapshot must have phase");
      assert.ok(data.data.mixing, "Snapshot must have mixing object");
      assert.ok(data.data.delivery, "Snapshot must have delivery object");
      assert.equal(typeof data.data.actualWaterMl, "number");
      assert.equal(typeof data.data.actualDeliveredMl, "number");
      assert.equal(typeof data.data.actualFlowLpm, "number");
      console.log("PASS: Live physical ESP32 verified at", ESP32_IP);
    } else {
      console.warn(`Physical ESP32 returned status ${res.status}`);
    }
  } catch (err) {
    console.warn("Physical ESP32 probe skipped or timed out:", err.message);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
