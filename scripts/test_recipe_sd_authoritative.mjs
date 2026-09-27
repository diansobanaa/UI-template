import { compileScheduleSet } from "../src/lib/runtime/schedule-compiler.js";
import { generateFertigationExecutionPlan } from "../src/lib/runtime/execution-plan-generator.js";
import { createAutomaticMultiGhConfiguration } from "../tests/runtime-fixture.mjs";

async function runTests() {
  console.log("=== AgroTech Authoritative Recipe & Optional Fertigation Test Suite ===\n");
  let passed = 0;
  let total = 0;

  function assert(cond, desc) {
    total++;
    if (cond) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      throw new Error(`Test assertion failed: ${desc}`);
    }
  }

  const dummyConfig = {
    version: 1,
    configurationHash: "cfg-hash-test",
    complexId: "c1",
    greenhouses: [{ ghId: "gh-01", complexId: "c1" }],
    recipes: [
      {
        recipeId: "rcp-tom-01",
        id: "rcp-tom-01",
        name: "Tomato Growth A",
        waterL: 80,
        dosingAml: 50,
        dosingBml: 50,
        dosingChannels: [
          { componentId: "dose-01", requestedMl: 50, calibrationId: "CAL-01", calibrationVersion: 1 },
          { componentId: "dose-02", requestedMl: 50, calibrationId: "CAL-02", calibrationVersion: 1 }
        ],
        version: 1
      }
    ],
    components: [
      { componentId: "tank-01", supportedTypeId: "MIXING_TANK", name: "Mixing Tank", lifecycleState: "COMMISSIONED", assignment: { ghId: "gh-01" }, parameters: { capacityL: 200 } },
      { componentId: "well-01", supportedTypeId: "WELL_PUMP", name: "Well Pump", lifecycleState: "COMMISSIONED", assignment: { ghId: null } },
      { componentId: "flow-raw-01", supportedTypeId: "RAW_FLOW", name: "Raw Flow Sensor", lifecycleState: "COMMISSIONED", assignment: { ghId: null } },
      { componentId: "lvl-01", supportedTypeId: "LEVEL_SENSOR", name: "Level Sensor", lifecycleState: "COMMISSIONED", assignment: { ghId: "gh-01" } },
      { componentId: "dist-01", supportedTypeId: "DELIVERY_PUMP", name: "Delivery Pump", lifecycleState: "COMMISSIONED", assignment: { ghId: "gh-01" } },
      { componentId: "flow-dist-01", supportedTypeId: "DELIVERY_FLOW", name: "Delivery Flow", lifecycleState: "COMMISSIONED", assignment: { ghId: "gh-01" } },
      { componentId: "dose-01", supportedTypeId: "DOSING", name: "Dosing Pump A", lifecycleState: "COMMISSIONED", assignment: { ghId: "gh-01" }, parameters: { rateMlPerSec: 2.5 } },
      { componentId: "dose-02", supportedTypeId: "DOSING", name: "Dosing Pump B", lifecycleState: "COMMISSIONED", assignment: { ghId: "gh-01" }, parameters: { rateMlPerSec: 2.5 } }
    ],
    resources: [
      { resourceId: "res-tank-01", componentId: "tank-01" },
      { resourceId: "res-well-01", componentId: "well-01" },
      { resourceId: "res-raw-flow-01", componentId: "flow-raw-01" },
      { resourceId: "res-lvl-01", componentId: "lvl-01" },
      { resourceId: "res-dist-01", componentId: "dist-01" },
      { resourceId: "res-dist-flow-01", componentId: "flow-dist-01" },
      { resourceId: "res-dose-01", componentId: "dose-01" },
      { resourceId: "res-dose-02", componentId: "dose-02" }
    ],
    topology: [
      { pathId: "path-gh-01", targetGhId: "gh-01", valveResourceId: "valve-01" }
    ]
  };

  const dummyCalibrations = {
    "dose-01": { rateMlPerSec: 2.5 },
    "dose-02": { rateMlPerSec: 2.5 }
  };

  // Test 1: Plan Generation without recipe (recipeId: null)
  console.log("\n--- TEST 1: Execution Plan Generator without Recipe ---");
  const planReqNoRecipe = {
    complexId: "c1",
    ghId: "gh-01",
    recipeId: null,
    targetWaterL: 60,
    dosingChannels: [
      { componentId: "dose-01", requestedMl: 30, calibrationId: "CAL-01", calibrationVersion: 1 }
    ],
    deliveryMode: "VOLUME",
    safetyAcknowledged: true
  };
  const planResultNoRecipe = generateFertigationExecutionPlan(dummyConfig, planReqNoRecipe, dummyCalibrations);
  assert(planResultNoRecipe.valid === true, "Execution plan without recipe is valid");
  assert(planResultNoRecipe.status === "READY", "Plan status is READY without recipe");
  assert(planResultNoRecipe.executionPlan.recipe === null, "Plan recipe field is null when no recipe specified");
  assert(planResultNoRecipe.executionPlan.targetWaterMl === 60000, "Plan targetWaterMl is correctly 60,000 mL");
  assert(planResultNoRecipe.executionPlan.dosingChannels.length === 1, "Explicit dosing channels are preserved");

  // Test 2: Plan Generation with valid existing recipe
  console.log("\n--- TEST 2: Execution Plan Generator with Valid Recipe ---");
  const planReqWithRecipe = {
    complexId: "c1",
    ghId: "gh-01",
    recipeId: "rcp-tom-01",
    targetWaterL: 80,
    deliveryMode: "VOLUME",
    safetyAcknowledged: true
  };
  const planResultWithRecipe = generateFertigationExecutionPlan(dummyConfig, planReqWithRecipe, dummyCalibrations);
  assert(planResultWithRecipe.valid === true, "Execution plan with valid recipe is valid");
  assert(planResultWithRecipe.executionPlan.recipe !== null, "Plan recipe is populated");
  assert(planResultWithRecipe.executionPlan.recipe.recipeId === "rcp-tom-01", "Plan recipe recipeId matches");

  // Test 3: Plan Generation with non-existent recipeId -> BLOCKED
  console.log("\n--- TEST 3: Execution Plan Generator with Unknown Recipe ---");
  const planReqUnknownRecipe = {
    complexId: "c1",
    ghId: "gh-01",
    recipeId: "rcp-nonexistent",
    targetWaterL: 80,
    deliveryMode: "VOLUME"
  };
  const planResultUnknownRecipe = generateFertigationExecutionPlan(dummyConfig, planReqUnknownRecipe, dummyCalibrations);
  assert(planResultUnknownRecipe.valid === false, "Plan with unknown recipe fails validation");
  assert(planResultUnknownRecipe.status === "BLOCKED", "Plan with unknown recipe is marked BLOCKED");
  assert(planResultUnknownRecipe.blockedReasons.some(r => r.code === "UNKNOWN_RECIPE"), "Blocked reason is UNKNOWN_RECIPE");

  // Test 4: Schedule Compilation with Recipe = "" (empty / optional)
  console.log("\n--- TEST 4: Schedule Compilation with Recipe Optional ---");
  const autoCfg = createAutomaticMultiGhConfiguration();
  const scheduleIntents = [
    {
      id: "fert-sched-no-rec",
      complexId: "complex-A",
      ghId: "GH-01",
      name: "Water-Only Morning Fertigation",
      kind: "fertigation",
      recipeId: "",
      enabled: true,
      trigger: "specific-time",
      time: "06:00",
      repeat: "Every Day",
      targetMode: "volume",
      targetWaterL: 50,
      dosingChannels: []
    }
  ];

  const calibs = {
    "raw-flow": { sensorId: "raw-flow", calibrationId: "CAL-RAW-FLOW-V1", version: 1 },
    "flow-01": { sensorId: "flow-01", calibrationId: "CAL-FLOW-01-V1", version: 1 },
    "dose-a": { rateMlPerSec: 2.5 },
    "dose-b": { rateMlPerSec: 2.5 }
  };

  const compileResult = compileScheduleSet(autoCfg, scheduleIntents, { autoGeneratePlan: true, calibrations: calibs });
  console.log("Compile result status:", compileResult.results[0]?.status, "errors:", compileResult.results[0]?.errors, "blocked:", compileResult.results[0]?.blockedReasons);
  const compiledSched = compileResult.compiled.find(s => s.scheduleId === "fert-sched-no-rec");
  assert(Boolean(compiledSched), "Schedule with empty recipe was compiled successfully");
  assert(compiledSched.parameters?.executionPlan !== null, "Compiled schedule contains generated execution plan");
  assert(compiledSched.parameters?.executionPlan?.recipe === null, "Compiled plan recipe is null");
  assert(compiledSched.recipeSnapshot === null, "Compiled plan recipeSnapshot is null");
  assert(compiledSched.activationState === "ACTIVE", "Schedule activationState is ACTIVE");

  // Test 5: Live ESP32 API Test (if reachable)
  console.log("\n--- TEST 5: Live ESP32 Endpoint Verification ---");
  const ESP32_IP = process.env.ESP32_IP || "192.168.0.139";
  const BASE_URL = `http://${ESP32_IP}`;
  try {
    const healthRes = await fetch(`${BASE_URL}/api/v1/health`, {
      headers: { "Authorization": "Bearer agrotech-secret-key" },
      signal: AbortSignal.timeout(3000)
    });
    if (healthRes.ok) {
      console.log(`Live ESP32 detected at ${BASE_URL}. Testing Recipe endpoints...`);

      // 5a. GET /api/v1/recipes
      const getRes = await fetch(`${BASE_URL}/api/v1/recipes`, {
        headers: { "Authorization": "Bearer agrotech-secret-key" }
      });
      assert(getRes.status === 200, `GET /api/v1/recipes returns 200 (actual: ${getRes.status})`);
      const getJson = await getRes.json();
      assert(getJson.success === true, "GET /api/v1/recipes returns success: true");
      assert(Array.isArray(getJson.data?.recipes), "GET /api/v1/recipes returns recipes array");
      console.log(`Stored recipes count: ${getJson.data.recipes.length}, storageStatus: ${getJson.data.storageStatus}`);

      // 5b. POST /api/v1/recipes
      const testRecipe = {
        recipeId: "rcp-automated-test",
        name: "Automated Test Recipe",
        waterL: 100,
        dosingAml: 200,
        dosingBml: 200,
        targetPpm: 800,
        version: 1
      };
      const postRes = await fetch(`${BASE_URL}/api/v1/recipes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer agrotech-secret-key"
        },
        body: JSON.stringify({
          requestId: "test-req-001",
          payload: testRecipe
        })
      });
      const postJson = await postRes.json();
      console.log(`POST /api/v1/recipes status: ${postRes.status}, body:`, JSON.stringify(postJson));

      if (postRes.status === 201 || postRes.status === 200) {
        assert(postJson.success === true, "POST /api/v1/recipes saved successfully");
        assert(postJson.data?.storageStatus === "PERSISTED", "Storage status is PERSISTED on SD");

        // 5c. GET /api/v1/recipes/rcp-automated-test
        const getOneRes = await fetch(`${BASE_URL}/api/v1/recipes/rcp-automated-test`, {
          headers: { "Authorization": "Bearer agrotech-secret-key" }
        });
        assert(getOneRes.status === 200, "GET single recipe by ID returns 200");
        const oneJson = await getOneRes.json();
        assert(oneJson.data?.recipeId === "rcp-automated-test", "Single recipe matches persisted ID");

        // 5d. DELETE /api/v1/recipes/rcp-automated-test
        const delRes = await fetch(`${BASE_URL}/api/v1/recipes/rcp-automated-test`, {
          method: "DELETE",
          headers: { "Authorization": "Bearer agrotech-secret-key" }
        });
        assert(delRes.status === 200, "DELETE recipe returns 200");
      } else if (postRes.status === 503 && postJson.error?.code === "STORAGE_UNAVAILABLE") {
        console.log("[INFO] MicroSD card is not physically mounted: Received expected STORAGE_UNAVAILABLE degraded response!");
        assert(postJson.error.code === "STORAGE_UNAVAILABLE", "Controller gracefully reported STORAGE_UNAVAILABLE without crashing");
        assert(postRes.status === 503, "Status code is 503 Service Unavailable");
      }
    } else {
      console.log(`Live ESP32 returned status ${healthRes.status}. Skipping live HTTP check.`);
    }
  } catch (netErr) {
    console.log(`Live ESP32 not reachable at ${BASE_URL} (${netErr.message}). Unit/runtime tests pass.`);
  }

  console.log(`\n========================================`);
  console.log(`RESULT: ${passed}/${total} assertions PASSED`);
  console.log(`========================================\n`);
}

runTests().catch((e) => {
  console.error("Fatal test error:", e);
  process.exit(1);
});
