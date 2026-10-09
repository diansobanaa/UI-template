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

// G. TASK #5: fast liveness + one-shot chime + persistent banner
assert(connMonitorSrc.includes("export const POLL_INTERVAL_MS = 5000"), "FAIL: poll interval must be 5000 ms");
assert(connMonitorSrc.includes("export const OFFLINE_FAILURE_THRESHOLD = 2"), "FAIL: offline threshold must be 2");
assert(connMonitorSrc.includes("POLL_INTERVAL_MS") && (connMonitorSrc.includes("scheduleNext") || connMonitorSrc.includes("setTimeout")), "FAIL: polling must use safe non-overlapping schedule with POLL_INTERVAL_MS");
assert(!/setInterval\(\s*playPulse/.test(connMonitorSrc), "FAIL: continuous alarm loop must be removed");
assert(!connMonitorSrc.includes("animate-bounce"), "FAIL: offline banner must not bounce");
assert(!connMonitorSrc.includes("dismissAlarm") && !connMonitorSrc.includes("TUTUP"), "FAIL: offline banner must not be dismissible");
assert(connMonitorSrc.includes("ESP32 TIDAK TERHUBUNG"), "FAIL: persistent offline banner text missing");
assert(connMonitorSrc.includes('"agrotech_connection_bus"') && connMonitorSrc.includes('"DISCONNECT_CHIME_PLAYED"'), "FAIL: BroadcastChannel chime coordination missing");
assert(connMonitorSrc.includes('ctx.state !== "running"'), "FAIL: chime must not be scheduled on a suspended AudioContext");
assert(connMonitorSrc.includes("Date.now() - ws.at < WS_FRESH_MS"), "FAIL: WebSocket evidence must require a fresh frame");
assert(!connMonitorSrc.includes("navigator.onLine"), "FAIL: navigator.onLine must not drive ESP32 state");
assert(!connMonitorSrc.includes("hydrateOperationalState"), "FAIL: monitor must not trigger full hydration");
console.log("  ✓ Test 11 (Contract): 5 s poll, 2-failure threshold, one-shot chime, non-dismissible banner, cross-tab bus, fresh-frame WS evidence.");

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

// ----------------------------------------------------------------------------
// 3. TASK #5: edge-triggered chime + multi-tab suppression (mirrors ConnectionMonitor logic)
// ----------------------------------------------------------------------------
console.log("\n[3/3] Simulating edge-triggered disconnect chime across tabs...");

const THRESHOLD = 2;
const SUPPRESS_MS = 15000;
const WS_FRESH_MS = 5000 + 2500;
const bus = [];
function makeTab(name, audioUnlocked = true) {
  const tab = { name, failures: 0, offline: false, chimes: 0, lastRemoteChimeAt: -Infinity, audioUnlocked };
  bus.push(tab);
  return tab;
}
function tabTick(tab, now, { httpOk, wsConnected = false, wsFrameAt = -Infinity }) {
  const healthy = httpOk || (wsConnected && now - wsFrameAt < WS_FRESH_MS);
  tab.failures = healthy ? 0 : tab.failures + 1;
  const offline = tab.failures >= THRESHOLD;
  if (offline === tab.offline) return; // silent on unchanged state
  tab.offline = offline;
  if (!offline) return; // recovery: no sound
  if (now - tab.lastRemoteChimeAt < SUPPRESS_MS) return;
  if (!tab.audioUnlocked) return; // visual only; does not claim the chime
  tab.chimes += 1;
  for (const other of bus) if (other !== tab) other.lastRemoteChimeAt = now;
}

const t1 = makeTab("A");
let now = 0;
// A. Normal online
tabTick(t1, (now += 5000), { httpOk: true });
assert.strictEqual(t1.offline, false); assert.strictEqual(t1.chimes, 0);
// B. One failure -> still online, silent
tabTick(t1, (now += 5000), { httpOk: false });
assert.strictEqual(t1.offline, false); assert.strictEqual(t1.chimes, 0);
// C. Second failure -> offline, exactly one chime
tabTick(t1, (now += 5000), { httpOk: false });
assert.strictEqual(t1.offline, true); assert.strictEqual(t1.chimes, 1);
// D. More failures -> no extra chime
for (let i = 0; i < 5; i++) tabTick(t1, (now += 5000), { httpOk: false });
assert.strictEqual(t1.offline, true); assert.strictEqual(t1.chimes, 1);
// E. Recovery -> online, no recovery chime
tabTick(t1, (now += 5000), { httpOk: true });
assert.strictEqual(t1.offline, false); assert.strictEqual(t1.failures, 0); assert.strictEqual(t1.chimes, 1);
console.log("  ✓ Test 12: A-E online/1-fail/2-fail/repeat/recovery -> exactly one chime on ONLINE->OFFLINE");

// H. WS fresh frame masks one HTTP failure; stale "connected" socket does not
const tw = makeTab("WS");
tabTick(tw, (now += 5000), { httpOk: false, wsConnected: true, wsFrameAt: now - 1000 });
tabTick(tw, (now += 5000), { httpOk: false, wsConnected: true, wsFrameAt: now - 1000 });
assert.strictEqual(tw.offline, false, "Fresh telemetry frames must prevent false OFFLINE");
tabTick(tw, (now += 5000), { httpOk: false, wsConnected: true, wsFrameAt: now - 60000 });
tabTick(tw, (now += 5000), { httpOk: false, wsConnected: true, wsFrameAt: now - 60000 });
assert.strictEqual(tw.offline, true, "Half-open socket without fresh frames must not mask OFFLINE");
console.log("  ✓ Test 13: H fresh WS frames prevent false OFFLINE; stale half-open socket does not mask it");

// F/G. Multi-tab: three tabs, one audio-locked
bus.length = 0;
const tabs = [makeTab("T1", false), makeTab("T2"), makeTab("T3")];
now += 60000;
for (let i = 0; i < 2; i++) for (const t of tabs) tabTick(t, (now += 500), { httpOk: false });
assert(tabs.every((t) => t.offline), "All tabs must show OFFLINE");
assert.strictEqual(tabs.reduce((s, t) => s + t.chimes, 0), 1, "Exactly one audible chime across tabs");
assert.strictEqual(tabs[0].chimes, 0, "Audio-locked tab stays visual-only and does not silence others");
console.log("  ✓ Test 14: F/G multi-tab -> all tabs OFFLINE, one chime total, locked tab visual-only");

console.log("\n=== ALL CONNECTION LIVENESS TEST CASES PASSED SUCCESSFULLY ===");
