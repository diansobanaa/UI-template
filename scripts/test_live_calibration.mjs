const ESP32_BASE = "http://192.168.0.151";

async function main() {
  console.log("=== TESTING LIVE ESP32 CALIBRATION PIPELINE ===");

  // 1. Health check
  const healthRes = await fetch(`${ESP32_BASE}/api/v1/health`);
  const health = await healthRes.json();
  console.log("1. Health Status:", health.success, health.data?.runtimeState);

  // 2. Initial rate check
  const getRes1 = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`);
  const cal1 = await getRes1.json();
  console.log("2. Initial Calibration Rates:", JSON.stringify(cal1.data));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 3. Save calibration rate for pump_dosing_a (0.4 ml/s = 24.0 ml/min)
  console.log("3. Posting Calibration Rate for pump_dosing_a: rateValue = 0.4 ml/s...");
  const postRes = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Connection": "close" },
    body: JSON.stringify({
      componentId: "pump_dosing_a",
      rateValue: 0.4
    }),
  });
  const postData = await postRes.json();
  console.log("3. POST Response status:", postRes.status, JSON.stringify(postData));

  await sleep(300);

  // 4. Verify updated rate immediately via GET /api/v1/calibration/rate
  const getRes2 = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`, { headers: { "Connection": "close" } });
  const cal2 = await getRes2.json();
  console.log("4. Updated Calibration Rates:", JSON.stringify(cal2.data));

  // 5. Test pump_dosing_b (0.2 ml/s = 12.0 ml/min)
  console.log("5. Posting Calibration Rate for pump_dosing_b: rateValue = 0.2 ml/s...");
  const postResB = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Connection": "close" },
    body: JSON.stringify({
      componentId: "pump_dosing_b",
      rateValue: 0.2
    }),
  });
  const postDataB = await postResB.json();
  console.log("5. POST pump_dosing_b status:", postResB.status, JSON.stringify(postDataB));

  await sleep(300);

  // 6. Verify both pumps calibrated
  const getRes3 = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`, { headers: { "Connection": "close" } });
  const cal3 = await getRes3.json();
  console.log("6. Final Calibration Rates:", JSON.stringify(cal3.data));

  // Assertions
  const aRate = cal3.data?.dosingRates?.pump_dosing_a || cal3.data?.rateDosingAMlSec;
  const bRate = cal3.data?.dosingRates?.pump_dosing_b || cal3.data?.rateDosingBMlSec;
  console.log(`Verifying: pump_dosing_a = ${aRate} (expected ~0.4), pump_dosing_b = ${bRate} (expected ~0.2)`);
  if (Math.abs(aRate - 0.4) < 0.01 && Math.abs(bRate - 0.2) < 0.01) {
    console.log(">>> SUCCESS: Physical ESP32 calibrated rates saved and retrieved accurately! <<<");
  } else {
    console.error(">>> ERROR: Rates do not match expected values! <<<");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
