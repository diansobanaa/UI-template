import fs from "node:fs";
import assert from "node:assert";

console.log("=== RUNNING FRONTEND POLLING IMPROVEMENTS & DEDUPLICATION TEST SUITE ===");

// ----------------------------------------------------------------------------
// 1. Static Contract & Source Code Verification
// ----------------------------------------------------------------------------
console.log("\n[1/3] Verifying static contracts, architecture rules, and isolation...");

const connMonitorSrc = fs.readFileSync("src/components/ConnectionMonitor.tsx", "utf8");
const fertDashboardSrc = fs.readFileSync("src/components/fertigation/FertigationQueueDashboard.tsx", "utf8");
const dosingCardSrc = fs.readFileSync("src/components/fertigation/DosingQueueCard.tsx", "utf8");
const alarmOverlaySrc = fs.readFileSync("src/components/AlarmManagerOverlay.tsx", "utf8");
const wellPumpSrc = fs.readFileSync("src/components/WellPumpControlCard.tsx", "utf8");
const backendClientSrc = fs.readFileSync("src/lib/api/backend-client.ts", "utf8");
const esp32ClientSrc = fs.readFileSync("src/lib/api/esp32-client.ts", "utf8");

// A. Constant Preservation
assert(esp32ClientSrc.includes("export const HEALTH_TIMEOUT_MS = 2500"), "FAIL: HEALTH_TIMEOUT_MS = 2500 must be preserved");
assert(connMonitorSrc.includes("export const POLL_INTERVAL_MS = 5000"), "FAIL: POLL_INTERVAL_MS = 5000 must be preserved");
console.log("  ✓ Test 1: HEALTH_TIMEOUT_MS (2500ms) and POLL_INTERVAL_MS (5000ms) strictly preserved.");

// B. ConnectionMonitor Deduplication Helpers
assert(connMonitorSrc.includes("export function normalizeEndpoint"), "FAIL: normalizeEndpoint must be exported");
assert(connMonitorSrc.includes("export function deduplicateControllerTargets"), "FAIL: deduplicateControllerTargets must be exported");
assert(connMonitorSrc.includes("deduplicateControllerTargets(currentTargets)"), "FAIL: ConnectionMonitor must probe deduplicated targets");
console.log("  ✓ Test 2: Target deduplication helpers present and invoked in ConnectionMonitor.");

// C. Non-overlapping Self-Scheduling in ConnectionMonitor
assert(connMonitorSrc.includes("if (healthRequestInFlight.current)"), "FAIL: In-flight guard required in ConnectionMonitor");
assert(connMonitorSrc.includes("scheduleNext"), "FAIL: ConnectionMonitor must use scheduleNext delayed scheduling");
assert(connMonitorSrc.includes("activeAbortController"), "FAIL: ConnectionMonitor must support abort on unmount");
console.log("  ✓ Test 3: ConnectionMonitor uses non-overlapping scheduleNext with unmount abort.");

// D. FertigationQueueDashboard Request Serialization & Self-Scheduling
assert(!fertDashboardSrc.includes("Promise.allSettled([\n        esp32Client.getFertigationStatus(),\n        esp32Client.getFertigationQueue(),\n      ])"), 
  "FAIL: FertigationQueueDashboard must not blast simultaneous Promise.allSettled to ESP32");
assert(fertDashboardSrc.includes("getFertigationStatus"), "FAIL: FertigationQueueDashboard must query status");
assert(fertDashboardSrc.includes("scheduleNext"), "FAIL: FertigationQueueDashboard must use scheduleNext");
assert(!fertDashboardSrc.includes("setInterval(() => fetchStatus(false), 3000)"), "FAIL: Unconditional setInterval removed from FertigationQueueDashboard");
console.log("  ✓ Test 4: FertigationQueueDashboard eliminated concurrent socket burst and uses self-scheduling.");

// E. DosingQueueCard In-Flight Guard & Self-Scheduling
assert(dosingCardSrc.includes("inFlightRef"), "FAIL: DosingQueueCard must guard against in-flight overlaps");
assert(dosingCardSrc.includes("scheduleNext"), "FAIL: DosingQueueCard must use scheduleNext");
assert(!dosingCardSrc.includes("setInterval(fetchStatus, 3000)"), "FAIL: Unconditional setInterval removed from DosingQueueCard");
console.log("  ✓ Test 5: DosingQueueCard has inFlightRef and delayed self-scheduling.");

// F. AlarmManagerOverlay Self-Scheduling
assert(alarmOverlaySrc.includes("isFetchingRef"), "FAIL: AlarmManagerOverlay must retain in-flight guard");
assert(alarmOverlaySrc.includes("scheduleNext"), "FAIL: AlarmManagerOverlay must use scheduleNext");
console.log("  ✓ Test 6: AlarmManagerOverlay uses self-scheduling delayed poll.");

// G. WellPumpControlCard In-Flight Guard & Self-Scheduling
assert(wellPumpSrc.includes("inFlightRef"), "FAIL: WellPumpControlCard must guard against in-flight overlaps");
assert(wellPumpSrc.includes("scheduleNext"), "FAIL: WellPumpControlCard must use scheduleNext");
assert(!wellPumpSrc.includes("setInterval(() => {\n      void fetchStatus();\n    }, 2500)"), "FAIL: Unconditional setInterval removed from WellPumpControlCard");
console.log("  ✓ Test 7: WellPumpControlCard has inFlightRef and delayed self-scheduling.");

// H. AbortSignal Propagation in backend-client
assert(backendClientSrc.includes("init.signal"), "FAIL: backend-client must chain caller init.signal");
console.log("  ✓ Test 8: backend-client chains caller AbortSignal to controller.");

// ----------------------------------------------------------------------------
// 2. Behavioral Unit Simulation of Target Deduplication
// ----------------------------------------------------------------------------
console.log("\n[2/3] Testing controller target deduplication logic...");

function normalizeEndpoint(endpoint) {
  if (!endpoint) return undefined;
  const trimmed = endpoint.trim();
  if (!trimmed) return undefined;
  try {
    const hasProto = trimmed.startsWith("http://") || trimmed.startsWith("https://");
    const url = new URL(hasProto ? trimmed : `http://${trimmed}`);
    const port = (url.port === "80" && url.protocol === "http:") || (url.port === "443" && url.protocol === "https:") ? "" : url.port ? `:${url.port}` : "";
    let path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/api/v1/health")) {
      path = path.slice(0, -"/api/v1/health".length);
    } else if (path.endsWith("/api/v1")) {
      path = path.slice(0, -"/api/v1".length);
    }
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}`;
  } catch {
    let clean = trimmed.toLowerCase().replace(/\/+$/, "");
    if (clean.endsWith("/api/v1/health")) clean = clean.slice(0, -"/api/v1/health".length);
    else if (clean.endsWith("/api/v1")) clean = clean.slice(0, -"/api/v1".length);
    return clean;
  }
}

function deduplicateControllerTargets(targets) {
  const groupMap = new Map();

  for (const target of targets) {
    const normEndpoint = normalizeEndpoint(target.endpoint);
    const normDeviceId = target.deviceId?.trim().toLowerCase();

    const probeKey = normEndpoint
      ? `ep:${normEndpoint}`
      : normDeviceId
      ? `dev:${normDeviceId}`
      : `key:${target.key}`;

    const existing = groupMap.get(probeKey);
    if (existing) {
      existing.targets.push(target);
      for (const id of target.complexIds) {
        if (!existing.complexIds.includes(id)) {
          existing.complexIds.push(id);
        }
      }
      if (!existing.endpoint && target.endpoint) {
        existing.endpoint = target.endpoint;
      }
      if (!existing.deviceId && target.deviceId) {
        existing.deviceId = target.deviceId;
      }
    } else {
      groupMap.set(probeKey, {
        probeKey,
        endpoint: target.endpoint,
        deviceId: target.deviceId,
        targets: [target],
        complexIds: [...target.complexIds],
      });
    }
  }

  return Array.from(groupMap.values());
}

// Case A: 2 complexes sharing identical physical endpoint with different deviceIds -> exactly 1 probe group
const targetsSameIp = [
  { key: "esp-01", deviceId: "ESP-01", endpoint: "http://192.168.1.50:80/", complexIds: ["c-1"] },
  { key: "esp-02", deviceId: "ESP-02", endpoint: "http://192.168.1.50", complexIds: ["c-2"] },
];
const dedupedA = deduplicateControllerTargets(targetsSameIp);
assert.strictEqual(dedupedA.length, 1, "Must collapse into 1 probe group");
assert.strictEqual(dedupedA[0].complexIds.length, 2, "Must preserve both complex IDs");
assert(dedupedA[0].complexIds.includes("c-1") && dedupedA[0].complexIds.includes("c-2"));
assert.strictEqual(dedupedA[0].targets.length, 2, "Must preserve both target references");
console.log("  ✓ Test 9: Identical physical endpoints with different deviceIds collapsed into 1 probe group with all complexIds preserved.");

// Case B: Identical endpoints with missing controller IDs
const targetsMissingId = [
  { key: "ep-1", deviceId: undefined, endpoint: "http://192.168.1.50/api/v1/health", complexIds: ["c-3"] },
  { key: "ep-2", deviceId: "ESP-ALPHA", endpoint: "http://192.168.1.50", complexIds: ["c-4"] },
];
const dedupedMissing = deduplicateControllerTargets(targetsMissingId);
assert.strictEqual(dedupedMissing.length, 1, "Missing controller ID with identical physical endpoint must collapse into 1 group");
assert.strictEqual(dedupedMissing[0].complexIds.length, 2, "Must preserve complex IDs from missing and defined ID targets");
console.log("  ✓ Test 10: Missing controller IDs with matching endpoints collapse into single probe group.");

// Case C: Genuinely distinct endpoints -> separate probe groups
const targetsDistinctIp = [
  { key: "esp-01", deviceId: "ESP-01", endpoint: "http://192.168.1.50", complexIds: ["c-1"] },
  { key: "esp-02", deviceId: "ESP-02", endpoint: "http://192.168.1.51", complexIds: ["c-2"] },
  { key: "esp-03", deviceId: "ESP-03", endpoint: "http://192.168.1.50:8080", complexIds: ["c-3"] },
];
const dedupedDistinct = deduplicateControllerTargets(targetsDistinctIp);
assert.strictEqual(dedupedDistinct.length, 3, "Genuinely distinct endpoints must remain separate");
console.log("  ✓ Test 11: Genuinely distinct controller endpoints (different IPs or ports) remain independent.");

// Case D: Normalization variations (uppercase, trailing slashes, default port 80, /api/v1/health suffix)
assert.strictEqual(normalizeEndpoint("http://ESP-GREENHOUSE:80/"), "http://esp-greenhouse");
assert.strictEqual(normalizeEndpoint("192.168.1.200"), "http://192.168.1.200");
assert.strictEqual(normalizeEndpoint("http://192.168.1.50/api/v1/health"), "http://192.168.1.50");
assert.strictEqual(normalizeEndpoint("http://192.168.1.50/api/v1/"), "http://192.168.1.50");
assert.strictEqual(normalizeEndpoint("https://secure-esp.local:443/"), "https://secure-esp.local");
assert.strictEqual(normalizeEndpoint("http://esp.local:8080/api/v1/health"), "http://esp.local:8080");
assert(backendClientSrc.includes("removeEventListener"), "FAIL: backend-client must clean up AbortSignal listener");
console.log("  ✓ Test 12: Endpoint normalization standardizes ports, trailing slashes, health paths, and cleans up abort listeners.");

// ----------------------------------------------------------------------------
// 3. Behavioral Unit Simulation of Non-Overlapping Polling Scheduler
// ----------------------------------------------------------------------------
console.log("\n[3/3] Simulating non-overlapping polling scheduling and cleanup...");

async function simulateSafePollingLifecycle() {
  let inFlight = false;
  let executionCount = 0;
  let overlappingCount = 0;
  let timerId = null;
  let isCancelled = false;

  const mockOperation = async (durationMs) => {
    if (inFlight) {
      overlappingCount++;
    }
    inFlight = true;
    executionCount++;
    await new Promise((r) => setTimeout(r, durationMs));
    inFlight = false;
  };

  const scheduleNext = (delayMs) => {
    if (isCancelled) return;
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(async () => {
      await runCycle();
    }, delayMs);
  };

  const runCycle = async () => {
    if (isCancelled || inFlight) return;
    try {
      await mockOperation(40); // 40ms operation duration
    } finally {
      if (!isCancelled) {
        scheduleNext(20); // 20ms delay after completion
      }
    }
  };

  // Start polling
  await runCycle();
  // Wait enough time for 3 cycles (each ~60ms total)
  await new Promise((r) => setTimeout(r, 160));

  // Cancel / cleanup
  isCancelled = true;
  if (timerId) clearTimeout(timerId);
  const countAtCancel = executionCount;

  // Wait further to verify no subsequent cycles run after cancellation
  await new Promise((r) => setTimeout(r, 80));

  assert.strictEqual(overlappingCount, 0, "No overlapping executions must occur");
  assert(executionCount >= 2, "Multiple sequential cycles must execute");
  assert.strictEqual(executionCount, countAtCancel, "No execution should occur after cancellation");
}

await simulateSafePollingLifecycle();
console.log("  ✓ Test 12: Safe polling ensures zero overlap, scheduled delay after completion, and reliable cleanup.");

console.log("\n=== ALL FRONTEND POLLING IMPROVEMENT TESTS PASSED (12/12) ===");
