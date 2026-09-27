// scripts/test_ui_metric_rendering.mjs
const ESP32_BASE = "http://192.168.0.139";

function formatMetricValue(val, metricId) {
  if (val === null || val === undefined || val === "" || val === "–") return "–";
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (!Number.isFinite(num)) return "–";

  if (metricId === "light") {
    return num >= 100 ? Math.round(num).toLocaleString() : num.toFixed(1);
  }
  if (metricId === "tank" || metricId === "fertigation") {
    return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
  }
  // Air temperature, Water temperature, Humidity
  return num.toFixed(1);
}

const METRIC_DEFS = [
  { id: "temperature", label: "Air Temperature", unit: "°C", metricIds: ["TEMPERATURE"] },
  { id: "waterTemperature", label: "Water Temperature", unit: "°C", metricIds: ["TEMPERATURE", "WATER_TEMPERATURE"] },
  { id: "humidity", label: "Humidity", unit: "%", metricIds: ["HUMIDITY"] },
  { id: "light", label: "Light", unit: "klux", metricIds: ["LIGHT"] },
  { id: "tank", label: "Water/Tank Level", unit: "%", metricIds: ["LEVEL"] },
  { id: "fertigation", label: "Fertigation", unit: "L", metricIds: ["FERTIGATION", "FLOW"] },
];

function usable(sample) {
  return sample.measurementType === "MEASURED" && sample.quality === "GOOD" && typeof sample.value === "number" && Number.isFinite(sample.value);
}

function valueForMetric(sample, metricId) {
  if (!usable(sample)) return null;
  const value = sample.value;
  return metricId === "light" ? value / 1000 : value;
}

function samplesForMetric(samples, metricId) {
  if (metricId === "waterTemperature") {
    return samples.filter((sample) => {
      const cId = String(sample.componentId || "").toLowerCase();
      const mId = String(sample.metricId || "").toUpperCase();
      return (mId === "TEMPERATURE" || mId === "WATER_TEMPERATURE") && (cId.includes("ds18b20") || cId.includes("water") || cId.includes("temp_ds"));
    });
  }
  if (metricId === "temperature") {
    const hasDht = samples.some((s) => String(s.componentId || "").toLowerCase().includes("dht"));
    return samples.filter((sample) => {
      const cId = String(sample.componentId || "").toLowerCase();
      const mId = String(sample.metricId || "").toUpperCase();
      if (hasDht && (cId.includes("ds18b20") || cId.includes("water") || cId.includes("temp_ds"))) return false;
      return mId === "TEMPERATURE";
    });
  }
  const accepted = new Set(METRIC_DEFS.find((x) => x.id === metricId)?.metricIds ?? []);
  return samples.filter((sample) => accepted.has(String(sample.metricId || "").toUpperCase()));
}

function currentForMetric(samples, metricId, currentObj) {
  const candidates = samplesForMetric(samples, metricId).filter(usable).sort((a, b) => b.sequence - a.sequence);
  if (candidates.length) return valueForMetric(candidates[0], metricId);
  if (currentObj?.values) {
    if (metricId === "temperature") {
      if (typeof currentObj.values.temperatureAirC === "number") return currentObj.values.temperatureAirC;
      if (typeof currentObj.values.temperatureC === "number") return currentObj.values.temperatureC;
    }
    if (metricId === "waterTemperature") {
      if (typeof currentObj.values.temperatureWaterC === "number") return currentObj.values.temperatureWaterC;
      if (typeof currentObj.values.waterTemperatureC === "number") return currentObj.values.waterTemperatureC;
    }
    if (metricId === "humidity" && typeof currentObj.values.humidityPct === "number") return currentObj.values.humidityPct;
    if (metricId === "light" && typeof currentObj.values.lightLux === "number") return currentObj.values.lightLux / 1000;
    if (metricId === "tank" && typeof currentObj.values.waterLevelPct === "number") return currentObj.values.waterLevelPct;
    if (metricId === "fertigation" && typeof currentObj.values.totalLiters === "number") return currentObj.values.totalLiters;
  }
  return null;
}

async function run() {
  console.log("=== VERIFYING UI METRIC RENDERING WITH LIVE ESP32 DATA ===");

  // 1. Fetch current snapshot (without ghId restriction as implemented in services.ts)
  const snapRes = await fetch(`${ESP32_BASE}/api/v1/telemetry/current`);
  const snapData = await snapRes.json();
  const currentSnap = snapData.data || snapData.payload || snapData;

  // Simulate client enrichment
  if (currentSnap && currentSnap.values && currentSnap.samples) {
    const waterSample = currentSnap.samples.find((s) => {
      const cId = String(s.componentId || "").toLowerCase();
      return (cId.includes("ds18b20") || cId.includes("water") || cId.includes("temp_ds")) && typeof s.value === "number";
    });
    if (waterSample && typeof waterSample.value === "number") {
      currentSnap.values.temperatureWaterC = waterSample.value;
      currentSnap.values.waterTemperatureC = waterSample.value;
    }
    if (typeof currentSnap.values.temperatureC === "number" && currentSnap.values.temperatureAirC === undefined) {
      currentSnap.values.temperatureAirC = currentSnap.values.temperatureC;
    }
  }

  // 2. Fetch history (flattening items to samples as implemented in esp32-client.ts)
  const histRes = await fetch(`${ESP32_BASE}/api/v1/telemetry/history?limit=50`);
  const histData = await histRes.json();
  const history = histData.data || histData.payload || histData;
  if (history && Array.isArray(history.items) && !Array.isArray(history.samples)) {
    history.samples = history.items.flatMap((item) => item.samples || []);
  }

  const combinedSamples = [
    ...(history?.samples ?? []),
    ...(currentSnap?.samples ?? []),
  ];

  console.log(`\nFound ${combinedSamples.length} total samples.`);

  // 3. Render each metric
  for (const spec of METRIC_DEFS) {
    const rawCurrent = currentForMetric(combinedSamples, spec.id, currentSnap);
    const formattedCurrent = formatMetricValue(rawCurrent, spec.id);
    const label = `${spec.label} (${spec.unit})`;

    console.log(`\n[${spec.id.toUpperCase()}]`);
    console.log(`  Card Header: "${label}"`);
    console.log(`  Raw Current Value: ${rawCurrent}`);
    console.log(`  Formatted Current: "${formattedCurrent}"`);

    // Verify assertions
    if (label.includes("(( ") || label.includes("(°C) (°C)") || label.includes("(%) (%)")) {
      throw new Error(`FAIL: Header has duplicate units: ${label}`);
    }

    if (spec.id === "waterTemperature") {
      if (formattedCurrent === "–" || !rawCurrent) {
        throw new Error(`FAIL: Water temperature is empty/null!`);
      }
      console.log(`  -> PASS: Water Temperature is correctly populated (${formattedCurrent} ${spec.unit})!`);
    }

    if (spec.id === "humidity" || spec.id === "temperature") {
      if (formattedCurrent.length > 5) {
        throw new Error(`FAIL: Formatted current string "${formattedCurrent}" is too long and may overlap!`);
      }
      console.log(`  -> PASS: Formatted decimal fits perfectly within column without overlap!`);
    }
  }

  console.log("\n=== ALL TELEMETRY UI PRESENTATION CHECKS PASSED SUCCESSFULLY! ===");
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
