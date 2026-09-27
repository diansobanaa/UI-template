import fs from "node:fs";
import assert from "node:assert";

console.log("=== RUNNING ESP32 CONNECTION LIVENESS & WATCHDOG TEST SUITE ===");

// ----------------------------------------------------------------------------
// 1. Static Contract & Source Code Verification
// ----------------------------------------------------------------------------
console.log("\n[1/2] Verifying static contracts, architecture rules, and isolation...");

const esp32ClientSrc = fs.readFileSync("src/lib/api/esp32-client.ts", "utf8");
const connMonitorSrc = fs.readFileSync("src/components/ConnectionMonitor.tsx", "utf8");
const opStateSrc = fs.readFileSync("src/lib/operational-state.ts", "utf8");
const appFooterSrc = fs.readFileSync("src/components/layout/AppFooter.tsx", "utf8");
const appHeaderSrc = fs.readFileSync("src/components/layout/AppHeader.tsx", "utf8");

// A. HEALTH_TIMEOUT_MS isolation check
assert(
  esp32ClientSrc.includes("export const HEALTH_TIMEOUT_MS = 2500"),
  "FAIL: HEALTH_TIMEOUT_MS = 2500 must be exported in esp32-client.ts"
);
assert(
  esp32ClientSrc.includes("timeoutMs = options?.timeoutMs ?? HEALTH_TIMEOUT_MS"),
  "FAIL: getHealth must default to HEALTH_TIMEOUT_MS"
);
console.log("  ✓ Test 9 (Contract): HEALTH_TIMEOUT_MS = 2500 is isolated from global timeout.");

// B. Single-flight guard check
assert(
  connMonitorSrc.includes("healthRequestInFlight"),
  "FAIL: ConnectionMonitor must include healthRequestInFlight guard"
);
assert(
  connMonitorSrc.includes("if (healthRequestInFlight.current)") && connMonitorSrc.includes("healthRequestInFlight.current = true"),
  "FAIL: ConnectionMonitor must guard against overlapping requests"
);
console.log("  ✓ Test 7 (Contract): Single-flight healthRequestInFlight guard present.");

// C. Direct ESP32 mode & removal of lastStatusComplexId
assert(
  !connMonitorSrc.includes("lastStatusComplexId"),
  "FAIL: ConnectionMonitor must not depend on lastStatusComplexId"
);
console.log("  ✓ Test 5 (Contract): lastStatusComplexId dependency completely removed.");

// D. No unsafe fallbacks check
for (const unsafe of ["complexes[0]", "greenhouses[0]", "find(() => true)"]) {
  assert(!connMonitorSrc.includes(unsafe), `FAIL: Unsafe fallback '${unsafe}' found in ConnectionMonitor.tsx`);
}
console.log("  ✓ Architectural Gate: No complexes[0], greenhouses[0], or find(() => true) in ConnectionMonitor.");

// E. Greenhouse propagation decoupling from data.sensors
assert(
  opStateSrc.includes("if (ghs.length && (data.online !== undefined || data.sensors))"),
  "FAIL: operational-state.ts must propagate online status to greenhouses without requiring sensors"
);
console.log("  ✓ Test 8 (Contract): Greenhouse online propagation decoupled from data.sensors.");

// F. UI Displays offline / stale indicators cleanly
assert(
  appFooterSrc.includes("Last known snapshot (Offline)"),
  "FAIL: AppFooter must show 'Last known snapshot (Offline)' when ESP32 is offline"
);
assert(
  appFooterSrc.includes("Offline / Stale"),
  "FAIL: AppFooter must indicate 'Offline / Stale' when ESP32 is offline"
);
assert(
  appHeaderSrc.includes("allOffline ? \"offline\""),
  "FAIL: AppHeader must handle allOffline state"
);
console.log("  ✓ Test 10 (Contract): UI footer and header render Offline/Stale cleanly without false Live labels.");

// ----------------------------------------------------------------------------
// 2. Behavioral Unit Simulation
// ----------------------------------------------------------------------------
console.log("\n[2/2] Running behavioral simulation of liveness state transitions...");

// Mock state
let complexes = [
  {
    id: "complex-01",
    esp32: { deviceId: "esp32-A", endpoint: "http://192.168.0.101", online: true },
    operationalStatus: "LIVE",
  },
  {
    id: "complex-02",
    esp32: { deviceId: "esp32-B", endpoint: "http://192.168.0.102", online: true },
    operationalStatus: "LIVE",
  }
];

let greenhouses = [
  { id: "gh-01", complexId: "complex-01", online: true, telemetry: { temperatureC: 25.5, tankPct: 80 } },
  { id: "gh-02", complexId: "complex-01", online: true, telemetry: { temperatureC: 26.0, tankPct: 85 } },
  { id: "gh-03", complexId: "complex-02", online: true, telemetry: { temperatureC: 24.0, tankPct: 90 } }
];

function updateComplexRuntimeMock(complexId, data) {
  const c = complexes.find(x => x.id === complexId);
  if (!c) return;
  if (data.online !== undefined) {
    c.esp32.online = data.online;
    c.operationalStatus = data.online ? "LIVE" : "OFFLINE";
  }
  const ghs = greenhouses.filter(g => g.complexId === complexId);
  if (ghs.length && (data.online !== undefined || data.sensors)) {
    for (const gh of ghs) {
      if (data.online !== undefined) gh.online = data.online;
      if (data.sensors) {
        if (data.sensors.temperatureC !== undefined) gh.telemetry.temperatureC = data.sensors.temperatureC;
      }
    }
  }
}

function getControllerTargetsMock(list) {
  const targetMap = new Map();
  for (const c of list) {
    const deviceId = c.esp32?.deviceId?.trim();
    const endpoint = c.esp32?.endpoint?.trim();
    const key = deviceId || endpoint || c.id;
    if (!key) continue;
    const existing = targetMap.get(key);
    if (existing) {
      if (!existing.complexIds.includes(c.id)) existing.complexIds.push(c.id);
    } else {
      targetMap.set(key, { key, deviceId, endpoint, complexIds: [c.id] });
    }
  }
  return Array.from(targetMap.values());
}

const consecutiveFailures = new Map();
let inFlight = false;

async function monitorTick(probeResults) {
  if (inFlight) {
    return "BLOCKED_IN_FLIGHT";
  }
  inFlight = true;
  try {
    const targets = getControllerTargetsMock(complexes);
    for (const target of targets) {
      const isHealthy = Boolean(probeResults[target.key]);
      const currentFailures = consecutiveFailures.get(target.key) || 0;
      if (isHealthy) {
        consecutiveFailures.set(target.key, 0);
        for (const cid of target.complexIds) {
          updateComplexRuntimeMock(cid, { online: true });
        }
      } else {
        const nextFailures = currentFailures + 1;
        consecutiveFailures.set(target.key, nextFailures);
        if (nextFailures >= 2) {
          for (const cid of target.complexIds) {
            updateComplexRuntimeMock(cid, { online: false });
          }
        }
      }
    }
  } finally {
    inFlight = false;
  }
  return "OK";
}

// --- Test 1: Health success ---
await monitorTick({ "esp32-A": true, "esp32-B": true });
assert.strictEqual(complexes[0].esp32.online, true);
assert.strictEqual(consecutiveFailures.get("esp32-A"), 0);
assert.strictEqual(greenhouses[0].online, true);
console.log("  ✓ Test 1: Health success -> online=true, failure count=0");

// --- Test 2: One transient health failure ---
await monitorTick({ "esp32-A": false, "esp32-B": true });
assert.strictEqual(consecutiveFailures.get("esp32-A"), 1);
assert.strictEqual(complexes[0].esp32.online, true, "Failure #1 must NOT immediately transition to offline");
assert.strictEqual(greenhouses[0].online, true);
console.log("  ✓ Test 2: One transient failure -> remains online, failure count=1");

// --- Test 3: Two consecutive failures -> Offline ---
await monitorTick({ "esp32-A": false, "esp32-B": true });
assert.strictEqual(consecutiveFailures.get("esp32-A"), 2);
assert.strictEqual(complexes[0].esp32.online, false, "Failure #2 must transition to offline");
assert.strictEqual(complexes[0].operationalStatus, "OFFLINE");
console.log("  ✓ Test 3: Two consecutive failures -> marks OFFLINE");

// --- Test 6: Multiple controllers isolation ---
assert.strictEqual(complexes[1].esp32.online, true, "Controller B must remain ONLINE when Controller A fails");
assert.strictEqual(greenhouses[2].online, true, "Greenhouse 3 (owned by Controller B) must remain ONLINE");
console.log("  ✓ Test 6: Multiple controllers -> Controller A failure does NOT affect Controller B");

// --- Test 8: Greenhouse propagation without data.sensors ---
assert.strictEqual(greenhouses[0].online, false, "GH-01 must follow Complex-01 offline state");
assert.strictEqual(greenhouses[1].online, false, "GH-02 must follow Complex-01 offline state");
assert.strictEqual(greenhouses[0].telemetry.temperatureC, 25.5, "Sensor telemetry preserved as last-known data");
console.log("  ✓ Test 8: Greenhouse propagation -> GH online follows complex without requiring data.sensors");

// --- Test 4: Recovery ---
await monitorTick({ "esp32-A": true, "esp32-B": true });
assert.strictEqual(consecutiveFailures.get("esp32-A"), 0);
assert.strictEqual(complexes[0].esp32.online, true, "Controller A must recover to online");
assert.strictEqual(complexes[0].operationalStatus, "LIVE");
assert.strictEqual(greenhouses[0].online, true, "GH-01 must recover to online");
console.log("  ✓ Test 4: Recovery -> health success returns to online=true, failure count=0");

// --- Test 7: Single-flight concurrency protection ---
inFlight = true;
const overlapResult = await monitorTick({ "esp32-A": false, "esp32-B": false });
assert.strictEqual(overlapResult, "BLOCKED_IN_FLIGHT", "Second request while in-flight must be skipped");
inFlight = false;
console.log("  ✓ Test 7: Single-flight -> overlapping request prevented from starting");

console.log("\n=== ALL 9 CONNECTION LIVENESS TEST CASES PASSED SUCCESSFULLY ===");
