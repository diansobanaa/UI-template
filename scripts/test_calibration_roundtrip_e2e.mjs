// Comprehensive Autonomous Verification for Calibration Save-Read-Refresh-Reboot Round Trip
import assert from "node:assert";

const ESP32_BASE = "http://192.168.0.101";

async function main() {
  console.log("===============================================================================");
  console.log("STARTING CALIBRATION SAVE -> READ -> REFRESH -> REBOOT VERIFICATION LOOP");
  console.log("===============================================================================");

  // Checkpoint 1: Read current state
  console.log("\n[CHECKPOINT 1] Reading initial calibration state from ESP32...");
  const initRes = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`);
  assert.strictEqual(initRes.status, 200, "Initial rate query must return HTTP 200");
  const initData = (await initRes.json()).data;
  console.log("Initial Dosing Rates:", initData.dosingRates);
  console.log("Initial Records Count:", initData.records?.length ?? 0);

  // Checkpoint 2: Save a new test calibration for pump_dosing_a
  // Test value: 29.0 ml/min => 0.4833333 ml/sec
  const testFlowRateMlMin = 29.0;
  const testRateMlSec = testFlowRateMlMin / 60.0;
  console.log(`\n[CHECKPOINT 2] Saving new calibration: ${testFlowRateMlMin} ml/min (${testRateMlSec.toFixed(5)} ml/sec) for pump_dosing_a...`);

  const saveRes = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      componentId: "pump_dosing_a",
      rateMlPerSec: testRateMlSec,
      rateValue: testRateMlSec,
      operator: "technician",
    }),
  });
  const saveJson = await saveRes.json();
  if (saveRes.status !== 200) {
    console.error("Save failed response:", saveJson);
  }
  assert.strictEqual(saveRes.status, 200, "Save request must return HTTP 200");
  console.log("Save Response:", saveJson.data);
  assert.strictEqual(saveJson.data.status, "APPLIED", "Save status must be APPLIED");
  assert.strictEqual(saveJson.data.componentId, "pump_dosing_a", "Component must be pump_dosing_a");

  // Checkpoint 3: Immediate read-after-write
  console.log("\n[CHECKPOINT 3] Immediate read-after-write...");
  const readRes = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`);
  assert.strictEqual(readRes.status, 200, "Read-back must return HTTP 200");
  const readData = (await readRes.json()).data;
  console.log("Readback Dosing Rates:", readData.dosingRates);
  const readRateA = readData.dosingRates?.pump_dosing_a ?? readData.rateDosingAMlSec;
  const readFlowMinA = (readRateA * 60.0).toFixed(1);
  console.log(`pump_dosing_a: ${readRateA} ml/sec (${readFlowMinA} ml/min)`);
  assert.strictEqual(readFlowMinA, "29.0", "Immediate read-back must match 29.0 ml/min");

  // Checkpoint 4: Verify list endpoint GET /api/v1/calibration
  console.log("\n[CHECKPOINT 4] Verifying GET /api/v1/calibration list endpoint...");
  const listRes = await fetch(`${ESP32_BASE}/api/v1/calibration`);
  assert.strictEqual(listRes.status, 200, "List calibrations endpoint must return HTTP 200");
  const listJson = await listRes.json();
  const cals = listJson.data?.calibrations ?? [];
  console.log(`Total calibration records returned: ${cals.length}`);
  const latestA = cals.filter(c => c.componentId === "pump_dosing_a").sort((a, b) => b.version - a.version)[0];
  assert(latestA, "Latest record for pump_dosing_a must exist");
  console.log("Latest pump_dosing_a record:", {
    id: latestA.calibrationId,
    version: latestA.version,
    flowRateMlMin: latestA.flowRateMlMin,
    operator: latestA.operator,
  });
  assert.strictEqual((latestA.rateMlPerSec * 60).toFixed(1), "29.0", "Record rate must match saved rate");

  // Checkpoint 5: Reboot ESP32 without erasing NVS
  console.log("\n[CHECKPOINT 5] Triggering ordinary reboot to verify NVS persistence across restarts...");
  try {
    await fetch(`${ESP32_BASE}/api/v1/system/reboot`, { method: "POST" });
  } catch {
    // Connection drop during reboot is expected
  }
  console.log("Reboot triggered. Waiting 5 seconds for ESP32 to restart and reconnect to Wi-Fi...");
  await new Promise(r => setTimeout(r, 5000));

  // Poll for health check
  let online = false;
  for (let i = 0; i < 20; i++) {
    try {
      const hRes = await fetch(`${ESP32_BASE}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
      if (hRes.status === 200) {
        const hData = await hRes.json();
        if (hData.data.runtimeState === "RUNNING") {
          console.log(`ESP32 online! Uptime: ${hData.data.uptimeSec}s, BootId: ${hData.data.bootId}`);
          online = true;
          break;
        }
      }
    } catch { }
    await new Promise(r => setTimeout(r, 1000));
  }
  assert(online, "ESP32 must come back online after reboot");

  // Checkpoint 6: Post-reboot persistence verification
  console.log("\n[CHECKPOINT 6] Verifying calibration persisted across reboot...");
  const postRebootRes = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`);
  assert.strictEqual(postRebootRes.status, 200, "Post-reboot rate query must return HTTP 200");
  const postRebootData = (await postRebootRes.json()).data;
  console.log("Post-reboot Dosing Rates:", postRebootData.dosingRates);
  console.log("Post-reboot rateDosingAMlSec:", postRebootData.rateDosingAMlSec);
  console.log("Post-reboot rateDosingBMlSec:", postRebootData.rateDosingBMlSec);
  console.log("Post-reboot rateRawWaterPumpMlSec:", postRebootData.rateRawWaterPumpMlSec);

  const postRebootRateA = postRebootData.dosingRates?.pump_dosing_a ?? postRebootData.rateDosingAMlSec;
  const postRebootFlowMinA = (postRebootRateA * 60.0).toFixed(1);
  console.log(`POST-REBOOT pump_dosing_a: ${postRebootRateA} ml/sec => ${postRebootFlowMinA} ml/min`);
  assert.strictEqual(postRebootFlowMinA, "29.0", "Saved calibration of 29.0 ml/min MUST persist across reboot!");
  assert(postRebootData.rateDosingBMlSec > 0, "rateDosingBMlSec must remain valid (> 0) after reboot");

  // Checkpoint 7: Verify records list post-reboot
  console.log("\n[CHECKPOINT 7] Verifying calibration records list post-reboot...");
  const postRebootListRes = await fetch(`${ESP32_BASE}/api/v1/calibration`);
  const postRebootListJson = await postRebootListRes.json();
  const postRebootCals = postRebootListJson.data?.calibrations ?? [];
  console.log(`Post-reboot total records: ${postRebootCals.length}`);
  assert(postRebootCals.length > 0, "Records must not be empty after reboot");
  const postLatestA = postRebootCals.filter(c => c.componentId === "pump_dosing_a").sort((a, b) => b.version - a.version)[0];
  assert(postLatestA, "Latest pump_dosing_a record must persist across reboot");
  assert.strictEqual((postLatestA.rateMlPerSec * 60).toFixed(1), "29.0", "Persisted record flow rate must be 29.0 ml/min");

  console.log("\n===============================================================================");
  console.log("ALL CHECKPOINTS PASSED! CALIBRATION DATA PERSISTENCE VERIFIED END-TO-END!");
  console.log("===============================================================================");
}

main().catch(err => {
  console.error("\nTEST FAILED:", err);
  process.exit(1);
});
