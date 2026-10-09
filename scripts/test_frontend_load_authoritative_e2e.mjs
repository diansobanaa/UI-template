// Test frontend loadAuthoritative against live ESP32
import assert from "node:assert";

const ESP32_BASE = "http://192.168.0.101";

async function testFrontendHydration() {
  console.log("=== TESTING FRONTEND HYDRATION AGAINST LIVE ESP32 ===");

  // 1. Fetch rates
  const ratesRes = await fetch(`${ESP32_BASE}/api/v1/calibration/rate`);
  const rates = (await ratesRes.json()).data;
  console.log("ESP32 Rates returned:", {
    dosingRates: rates.dosingRates,
    rateDosingAMlSec: rates.rateDosingAMlSec,
    rateDosingBMlSec: rates.rateDosingBMlSec,
    recordsCount: rates.records?.length,
  });

  // 2. Fetch records
  const calRes = await fetch(`${ESP32_BASE}/api/v1/calibration`);
  const records = (await calRes.json()).data.calibrations;
  console.log(`ESP32 Records returned: ${records.length}`);

  // 3. Verify devices mapping
  const latestByComponent = new Map();
  for (const record of records) {
    const previous = latestByComponent.get(record.componentId);
    if (!previous || record.version > previous.version) latestByComponent.set(record.componentId, record);
  }

  const testComponents = [
    { componentId: "pump_dosing_a", name: "Pompa Dosing A", role: "DOSING_A" },
    { componentId: "pump_dosing_b", name: "Pompa Dosing B", role: "DOSING_B" },
    { componentId: "pump_submersible", name: "Pompa Air Baku 12V", role: "RAW_SUBMERSIBLE" },
  ];

  for (const comp of testComponents) {
    const isRawPump = comp.componentId === "pump_submersible";
    const category = isRawPump ? "raw-water-pump" : "dosing-pump";
    const calibration = latestByComponent.get(comp.componentId);

    let reading = "—";
    let calibratedAtMs = calibration?.createdAtMs ?? null;
    let rateMlSec = 0;

    if (rates.dosingRates && rates.dosingRates[comp.componentId] != null) {
      rateMlSec = Number(rates.dosingRates[comp.componentId]) || 0;
    } else if (isRawPump) {
      rateMlSec = Number(rates.rateRawWaterPumpMlSec) || Number(rates.dosingRates?.['pump_submersible']) || 0;
    } else if (comp.componentId.includes("dosing_a")) {
      rateMlSec = rates.rateDosingAMlSec || Number(rates.dosingRates?.['pump_dosing_a']) || 0;
    } else if (comp.componentId.includes("dosing_b")) {
      rateMlSec = rates.rateDosingBMlSec || Number(rates.dosingRates?.['pump_dosing_b']) || 0;
    }

    if (rateMlSec > 0) {
      const flowRateMlMin = rateMlSec * 60.0;
      reading = flowRateMlMin.toFixed(1);
      if (!calibratedAtMs) {
        calibratedAtMs = calibration?.createdAtMs || Date.now();
      }
    }

    if (calibratedAtMs && calibratedAtMs < 1704067200000) {
      calibratedAtMs = Date.now();
    }

    const validUntil = (calibration?.validUntilMs && calibration.validUntilMs >= 1704067200000)
      ? new Date(calibration.validUntilMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : (reading !== "—" ? "Terkalibrasi Aktif" : "Not scheduled");

    const lastCalibrationStr = (reading !== "—" && calibratedAtMs)
      ? new Date(calibratedAtMs).toLocaleString("en-GB")
      : (calibratedAtMs ? new Date(calibratedAtMs).toLocaleString("en-GB") : "Belum Dikalibrasi");

    console.log(`\nComponent: ${comp.componentId}`);
    console.log(`  Flow Rate Reading: ${reading} ml/min`);
    console.log(`  Last Calibration Text: ${lastCalibrationStr}`);
    console.log(`  CalibratedAtMs: ${calibratedAtMs}`);
    console.log(`  Due / Status: ${validUntil}`);

    assert.notStrictEqual(reading, "—", `${comp.componentId} reading must not be blank ('—')`);
    assert.notStrictEqual(lastCalibrationStr, "Belum Dikalibrasi", `${comp.componentId} must not show 'Belum Dikalibrasi'`);
    assert(calibratedAtMs && calibratedAtMs > 0, `${comp.componentId} calibratedAtMs must be positive`);
    assert.notStrictEqual(validUntil, "Not scheduled", `${comp.componentId} due status must be scheduled/active`);
  }

  // 4. Verify history tab mapping
  assert(records.length > 0, "History tab must contain calibration records");
  console.log(`\nHistory tab entries count: ${records.length}`);
  for (const r of records.slice(0, 3)) {
    console.log(`  Record: ${r.calibrationId} | ${r.componentId} | ${r.flowRateMlMin ?? (r.rateMlPerSec * 60)} ml/min | ${r.operator}`);
  }

  console.log("\n=== ALL FRONTEND HYDRATION CHECKS PASSED SUCCESSFULLY! ===");
}

testFrontendHydration().catch(err => {
  console.error("Hydration test failed:", err);
  process.exit(1);
});
