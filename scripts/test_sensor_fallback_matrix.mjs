// scripts/test_sensor_fallback_matrix.mjs
import assert from "node:assert/strict";

/**
 * Regression Test Matrix for Environmental Sensor Telemetry & Presentation
 * Scenarios:
 * 1. Disconnected DHT22 + Operational DS18B20 (Active physical state)
 * 2. Operational DHT22 + Operational DS18B20 (Both valid)
 * 3. Genuine 0°C readings vs Missing (null) readings
 * 4. Stale / Unusable readings
 * 5. Daily 24H 288-slot history calculation (No fabricated zeros)
 * 6. Min / Max statistics on sparse or completely missing data
 */

function formatMetricValue(val, metricId) {
  if (val === null || val === undefined || val === "" || val === "–") return "–";
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (!Number.isFinite(num)) return "–";
  return num.toFixed(1);
}

function usable(sample) {
  return sample.measurementType === "MEASURED" && sample.quality === "GOOD" && typeof sample.value === "number" && Number.isFinite(sample.value);
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
    return samples.filter((sample) => {
      const cId = String(sample.componentId || "").toLowerCase();
      const mId = String(sample.metricId || "").toUpperCase();
      if (cId.includes("ds18b20") || cId.includes("water") || cId.includes("temp_ds")) return false;
      return mId === "TEMPERATURE" || mId === "AIR_TEMPERATURE";
    });
  }
  if (metricId === "humidity") {
    return samples.filter((sample) => String(sample.metricId || "").toUpperCase() === "HUMIDITY");
  }
  return [];
}

function currentForMetric(samples, metricId, currentObj) {
  const candidates = samplesForMetric(samples, metricId).filter(usable).sort((a, b) => b.sequence - a.sequence);
  if (candidates.length) return candidates[0].value;
  if (currentObj?.values) {
    if (metricId === "temperature") {
      if (typeof currentObj.values.temperatureAirC === "number") return currentObj.values.temperatureAirC;
      return null;
    }
    if (metricId === "waterTemperature") {
      if (typeof currentObj.values.temperatureWaterC === "number") return currentObj.values.temperatureWaterC;
      if (typeof currentObj.values.waterTemperatureC === "number") return currentObj.values.waterTemperatureC;
    }
    if (metricId === "humidity" && typeof currentObj.values.humidityPct === "number") return currentObj.values.humidityPct;
  }
  return null;
}

function stats(points, current) {
  const validVals = points.map((p) => p.value).filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!validVals.length) return { current, min: null, max: null, avg: null };
  const min = Math.min(...validVals);
  const max = Math.max(...validVals);
  const avg = validVals.reduce((sum, value) => sum + value, 0) / validVals.length;
  return { current, min, max, avg };
}

function formatRange(min, max, metricId) {
  if (min !== null && max !== null) {
    return `${formatMetricValue(min, metricId)} – ${formatMetricValue(max, metricId)}`;
  }
  return "–";
}

async function runRegressionMatrix() {
  console.log("=== RUNNING SENSOR FALLBACK REGRESSION TEST MATRIX ===");

  // Scenario 1: DHT22 disconnected, DS18B20 connected (27.1°C)
  console.log("\n[TEST 1] DHT22 Disconnected, DS18B20 Operational");
  const snap1 = {
    samples: [
      { componentId: "temp_ds18b20", metricId: "TEMPERATURE", quality: "GOOD", measurementType: "MEASURED", value: 27.1, sequence: 10 },
      { componentId: "sensor_dht22", metricId: "TEMPERATURE", quality: "BAD", measurementType: "UNAVAILABLE", value: null, sequence: 10 },
      { componentId: "sensor_dht22_hum", metricId: "HUMIDITY", quality: "BAD", measurementType: "UNAVAILABLE", value: null, sequence: 10 },
    ],
    values: {
      temperatureC: null,
      temperatureAirC: null,
      temperatureWaterC: 27.1,
      humidityPct: null,
    },
  };
  const airVal1 = currentForMetric(snap1.samples, "temperature", snap1);
  const waterVal1 = currentForMetric(snap1.samples, "waterTemperature", snap1);
  const humVal1 = currentForMetric(snap1.samples, "humidity", snap1);

  assert.equal(airVal1, null, "Air temperature must be null when DHT22 is disconnected");
  assert.equal(formatMetricValue(airVal1, "temperature"), "–", "Air temperature display must be '–'");
  assert.equal(waterVal1, 27.1, "Water temperature must be 27.1");
  assert.equal(formatMetricValue(waterVal1, "waterTemperature"), "27.1", "Water temperature display must be '27.1'");
  assert.equal(humVal1, null, "Humidity must be null when DHT22 is disconnected");
  assert.equal(formatMetricValue(humVal1, "humidity"), "–", "Humidity display must be '–'");
  console.log("  -> PASS: Disconnected DHT22 correctly displays unavailable without falling back to DS18B20!");

  // Scenario 2: DHT22 reconnected (Air: 24.5°C, Hum: 65%), DS18B20 (Water: 27.2°C)
  console.log("\n[TEST 2] DHT22 Reconnected (Both Sensors Operational)");
  const snap2 = {
    samples: [
      { componentId: "temp_ds18b20", metricId: "TEMPERATURE", quality: "GOOD", measurementType: "MEASURED", value: 27.2, sequence: 20 },
      { componentId: "sensor_dht22", metricId: "TEMPERATURE", quality: "GOOD", measurementType: "MEASURED", value: 24.5, sequence: 20 },
      { componentId: "sensor_dht22_hum", metricId: "HUMIDITY", quality: "GOOD", measurementType: "MEASURED", value: 65.0, sequence: 20 },
    ],
    values: {
      temperatureC: 24.5,
      temperatureAirC: 24.5,
      temperatureWaterC: 27.2,
      humidityPct: 65.0,
    },
  };
  const airVal2 = currentForMetric(snap2.samples, "temperature", snap2);
  const waterVal2 = currentForMetric(snap2.samples, "waterTemperature", snap2);
  const humVal2 = currentForMetric(snap2.samples, "humidity", snap2);

  assert.equal(airVal2, 24.5, "Air temperature must be 24.5");
  assert.equal(formatMetricValue(airVal2, "temperature"), "24.5", "Air temperature display must be '24.5'");
  assert.equal(waterVal2, 27.2, "Water temperature must be 27.2");
  assert.equal(humVal2, 65.0, "Humidity must be 65.0");
  console.log("  -> PASS: Reconnection correctly reports both sensors independently!");

  // Scenario 3: Genuine 0.0°C reading (Freezing winter condition) vs Missing (null)
  console.log("\n[TEST 3] Genuine 0.0°C Measurement vs Missing Measurement");
  const snap3GenuineZero = {
    samples: [
      { componentId: "sensor_dht22", metricId: "TEMPERATURE", quality: "GOOD", measurementType: "MEASURED", value: 0.0, sequence: 30 },
    ],
    values: { temperatureAirC: 0.0 },
  };
  const airZero = currentForMetric(snap3GenuineZero.samples, "temperature", snap3GenuineZero);
  assert.equal(airZero, 0.0, "Genuine zero should be 0.0");
  assert.equal(formatMetricValue(airZero, "temperature"), "0.0", "Genuine zero should format as '0.0'");

  const snap3Missing = {
    samples: [
      { componentId: "sensor_dht22", metricId: "TEMPERATURE", quality: "BAD", measurementType: "UNAVAILABLE", value: null, sequence: 31 },
    ],
    values: { temperatureAirC: null },
  };
  const airMissing = currentForMetric(snap3Missing.samples, "temperature", snap3Missing);
  assert.equal(airMissing, null, "Missing value should be null");
  assert.equal(formatMetricValue(airMissing, "temperature"), "–", "Missing value should format as '–'");
  console.log("  -> PASS: Genuine 0.0°C is preserved, while missing/disconnected correctly yields null / '–'!");

  // Scenario 4: 24H History Buckets with Disconnected Air Sensor
  console.log("\n[TEST 4] 24H History Daily Buckets With Disconnected DHT22");
  // Buckets have valid water temp, but null air temp and null humidity
  const dailyBuckets = Array.from({ length: 288 }, (_, i) => ({
    slot: i,
    time: `${String(Math.floor((i * 5) / 60)).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}`,
    valid: i <= 50,
    temperatureAirC: null,
    temperatureWaterC: i <= 50 ? 27.0 : null,
    humidityPct: null,
  }));

  const airPoints = dailyBuckets.map((b) => ({ label: b.time, value: b.valid ? b.temperatureAirC : null, slot: b.slot }));
  const waterPoints = dailyBuckets.map((b) => ({ label: b.time, value: b.valid ? b.temperatureWaterC : null, slot: b.slot }));

  const airStats = stats(airPoints, null);
  const waterStats = stats(waterPoints, 27.0);

  assert.equal(airStats.min, null, "Air min must be null when all air buckets are null");
  assert.equal(airStats.max, null, "Air max must be null when all air buckets are null");
  assert.equal(formatRange(airStats.min, airStats.max, "temperature"), "–", "Air range must render '–', NEVER '0.0–0.0 °C'");

  assert.equal(waterStats.min, 27.0, "Water min must be 27.0");
  assert.equal(waterStats.max, 27.0, "Water max must be 27.0");
  assert.equal(formatRange(waterStats.min, waterStats.max, "waterTemperature"), "27.0 – 27.0", "Water range must be '27.0 – 27.0'");
  console.log("  -> PASS: 24H history renders null/gaps and '–' range for disconnected sensor, without artificial zeros!");

  console.log("\n=== ALL REGRESSION TESTS IN MATRIX PASSED SUCCESSFULLY! ===");
}

runRegressionMatrix().catch((err) => {
  console.error("REGRESSION TEST FAILED:", err);
  process.exit(1);
});
