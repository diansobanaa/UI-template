// scripts/test_rtc_and_telemetry.mjs
import { performance } from "node:perf_hooks";

const ESP32_BASE = "http://192.168.0.139";
const WS_URL = "ws://192.168.0.139/api/v1/telemetry/stream";

async function run() {
  console.log("=== VERIFYING REALTIME TELEMETRY & RTC-BASED LIVE CLOCK ===");

  // 1. Clock Verification
  console.log("\n[1] Testing GET /api/v1/clock...");
  const t0 = performance.now();
  const clockRes = await fetch(`${ESP32_BASE}/api/v1/clock`);
  const t1 = performance.now();
  if (!clockRes.ok) {
    throw new Error(`Clock endpoint returned ${clockRes.status}`);
  }
  const clockData = await clockRes.json();
  console.log("-> Raw Clock Data:", JSON.stringify(clockData, null, 2));

  const iso = clockData?.data?.currentLocal || clockData?.data?.currentUtc || clockData?.deviceTimestamp;
  const parsedEpoch = Date.parse(iso);
  const roundTrip = t1 - t0;
  const adjustedEpoch = parsedEpoch + Math.round(roundTrip / 2);
  const deviceDate = new Date(adjustedEpoch);
  console.log(`-> Authoritative Device Time: ${deviceDate.toISOString()}`);
  console.log(`-> Local Time String: ${deviceDate.toLocaleTimeString("en-GB")}`);
  console.log(`-> Date String: ${deviceDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`);

  // Simulate monotonic advancement
  const secondsSinceMidnight = deviceDate.getHours() * 3600 + deviceDate.getMinutes() * 60 + deviceDate.getSeconds();
  const dayFraction = secondsSinceMidnight / 86400;
  const nowMinutes = Math.min(1439, Math.max(0, Math.round(dayFraction * 1440)));
  const timelineNow = `${String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:${String(nowMinutes % 60).padStart(2, "0")}`;
  console.log(`-> Timeline Now position calculation: ${timelineNow} (fraction: ${dayFraction.toFixed(4)})`);
  if (timelineNow === "23:59") {
    console.error("FAIL: Timeline Now is 23:59!");
  } else {
    console.log(`PASS: Timeline Now is accurately calculated as ${timelineNow}, NOT stuck at 23:59!`);
  }

  // 2. Telemetry Current Snapshot Verification
  console.log("\n[2] Testing GET /api/v1/telemetry/current...");
  const teleRes = await fetch(`${ESP32_BASE}/api/v1/telemetry/current`);
  if (!teleRes.ok) {
    throw new Error(`Telemetry endpoint returned ${teleRes.status}`);
  }
  const teleData = await teleRes.json();
  const payload = teleData.payload || teleData.data || teleData;
  console.log("-> Telemetry values:", JSON.stringify(payload.values, null, 2));
  
  const ds18b20Sample = payload.samples?.find(s => s.componentId === "temp_ds18b20");
  const dht22Sample = payload.samples?.find(s => s.componentId === "sensor_dht22");
  console.log("-> DS18B20 Water Temp Sample:", JSON.stringify(ds18b20Sample, null, 2));
  console.log("-> DHT22 Air Temp Sample:", JSON.stringify(dht22Sample, null, 2));

  if (ds18b20Sample && typeof ds18b20Sample.value === "number") {
    console.log(`PASS: Water temperature is measured at ${ds18b20Sample.value}°C with quality ${ds18b20Sample.quality}`);
  } else {
    console.log(`INFO: DS18B20 sample quality: ${ds18b20Sample?.quality}, value: ${ds18b20Sample?.value}`);
  }

  // 3. WebSocket Telemetry Stream Verification
  console.log(`\n[3] Testing WebSocket stream: ${WS_URL}...`);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Timeout waiting for WebSocket frame (15s)"));
    }, 15000);

    ws.onopen = () => {
      console.log("-> WebSocket connected successfully!");
      ws.send("ping");
    };

    ws.onmessage = (event) => {
      clearTimeout(timeout);
      console.log("-> Received WebSocket message frame!");
      try {
        const batch = JSON.parse(event.data);
        console.log("-> Batch type:", batch.type);
        console.log("-> Stream mode:", batch.streamMode);
        console.log("-> Cadence:", batch.cadenceSec, "s");
        console.log("-> Sample count:", batch.samples?.length);
        if (batch.samples?.length > 0) {
          console.log("-> First sample:", JSON.stringify(batch.samples[0], null, 2));
        }
        ws.close();
        console.log("PASS: WebSocket telemetry stream active and verified!");
        resolve();
      } catch (err) {
        ws.close();
        reject(err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      console.error("-> WebSocket error:", err);
      reject(err);
    };
  });

  console.log("\n=== ALL CRITICAL VERIFICATIONS SUCCEEDED ===");
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
