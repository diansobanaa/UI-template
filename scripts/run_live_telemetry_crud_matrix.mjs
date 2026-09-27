import http from 'node:http';

const BASE_URL = process.env.ESP32_BASE_URL || 'http://192.168.0.139';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/api/v1/telemetry/stream';

console.log("============================================================");
console.log("ESP32 UI TELEMETRY & CRUD V2 - LIVE VERIFICATION MATRIX");
console.log(`Target: ${BASE_URL}`);
console.log("============================================================\n");

function calcStats(latencies) {
  latencies.sort((a, b) => a - b);
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  return { min: min.toFixed(1), max: max.toFixed(1), avg: avg.toFixed(1), p50: p50.toFixed(1), p95: p95.toFixed(1), p99: p99.toFixed(1) };
}

async function benchmarkEndpoint(name, path, count = 20) {
  process.stdout.write(`Testing ${name} (${count} iterations)... `);
  const latencies = [];
  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}${path}`);
    const t1 = performance.now();
    if (!res.ok) {
      throw new Error(`Endpoint ${path} returned HTTP ${res.status}`);
    }
    await res.json();
    latencies.push(t1 - t0);
  }
  const stats = calcStats(latencies);
  console.log(`PASS! [avg: ${stats.avg}ms, p50: ${stats.p50}ms, p95: ${stats.p95}ms, max: ${stats.max}ms]`);
  return stats;
}

async function testWebSocketMultiClient() {
  console.log("\n--- TEST E: Multi-Client WebSocket Telemetry Stream ---");
  return new Promise((resolve, reject) => {
    let client1Frames = 0;
    let client2Frames = 0;

    const ws1 = new WebSocket(WS_URL);
    const ws2 = new WebSocket(WS_URL);

    const timeout = setTimeout(() => {
      ws1.close();
      ws2.close();
      if (client1Frames > 0 && client2Frames > 0) {
        console.log(`PASS: Both clients received frames concurrently! (Client1: ${client1Frames}, Client2: ${client2Frames})`);
        resolve();
      } else {
        reject(new Error(`Timeout waiting for frames. Client1: ${client1Frames}, Client2: ${client2Frames}`));
      }
    }, 25000);

    ws1.onopen = () => console.log("  Client 1 connected to WS stream");
    ws1.onmessage = (e) => {
      client1Frames++;
      const data = JSON.parse(e.data);
      console.log(`  Client 1 received frame: seq ${data.sequenceStart}-${data.sequenceEnd}, mode=${data.streamMode}`);
      if (client1Frames >= 1 && client2Frames >= 1) {
        clearTimeout(timeout);
        ws1.close();
        ws2.close();
        console.log(`PASS: Multi-client concurrency verified! Client1: ${client1Frames} frames, Client2: ${client2Frames} frames.`);
        resolve();
      }
    };

    ws2.onopen = () => console.log("  Client 2 connected to WS stream");
    ws2.onmessage = (e) => {
      client2Frames++;
      const data = JSON.parse(e.data);
      console.log(`  Client 2 received frame: seq ${data.sequenceStart}-${data.sequenceEnd}, mode=${data.streamMode}`);
      if (client1Frames >= 1 && client2Frames >= 1) {
        clearTimeout(timeout);
        ws1.close();
        ws2.close();
        console.log(`PASS: Multi-client concurrency verified! Client1: ${client1Frames} frames, Client2: ${client2Frames} frames.`);
        resolve();
      }
    };

    ws1.onerror = (e) => reject(new Error("WS1 error"));
    ws2.onerror = (e) => reject(new Error("WS2 error"));
  });
}

async function testCrudAndRevision() {
  console.log("\n--- TEST F & G & O: Authoritative CRUD, Revision & Idempotency ---");

  // Step 1: Read current pool meta
  const metaRes = await fetch(`${BASE_URL}/api/v1/topology-pool/meta`);
  if (!metaRes.ok) throw new Error("Failed to fetch topology meta");
  const meta = await metaRes.json();
  const currentRevision = meta.data.poolRevision;
  console.log(`Current pool revision: ${currentRevision}`);

  const testOpId = `op-test-${Date.now()}`;
  const targetGhId = `gh-test-${Date.now().toString(36)}`;
  console.log(`1. Mutating: Creating Greenhouse '${targetGhId}' with expectedRevision=${currentRevision}, opId=${testOpId}`);

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer agrotech-secret-key'
  };

  // Step 2: Mutate with correct expectedRevision
  const mutRes = await fetch(`${BASE_URL}/api/v1/topology-pool/mutate`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      operation: 'CREATE_GREENHOUSE',
      complexId: 'complex-01',
      ghId: targetGhId,
      name: 'Matrix Test GH',
      operationId: testOpId,
      changeId: testOpId,
      expectedRevision: currentRevision,
    })
  });

  if (!mutRes.ok) {
    const errBody = await mutRes.text();
    throw new Error(`Mutation failed with HTTP ${mutRes.status}: ${errBody}`);
  }
  const mutJson = await mutRes.json();
  const newRevision = mutJson.data.poolRevision;
  console.log(`   PASS: Mutation succeeded. New poolRevision: ${newRevision} (was ${currentRevision})`);

  // Step 3: Test Idempotency (re-sending identical mutation with same operationId)
  console.log(`2. Testing Idempotency: Re-sending identical mutation with opId=${testOpId}`);
  const retryRes = await fetch(`${BASE_URL}/api/v1/topology-pool/mutate`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      operation: 'CREATE_GREENHOUSE',
      complexId: 'complex-01',
      ghId: targetGhId,
      name: 'Matrix Test GH',
      operationId: testOpId,
      changeId: testOpId,
      expectedRevision: currentRevision, // Even with old revision, identical opId must be accepted
    })
  });
  if (!retryRes.ok) {
    throw new Error(`Idempotency retry failed with HTTP ${retryRes.status}`);
  }
  const retryJson = await retryRes.json();
  console.log(`   PASS: Idempotent request handled cleanly! (status: ${retryJson.data.status})`);

  // Step 4: Test Revision Conflict (HTTP 409)
  console.log(`3. Testing Revision Conflict: Mutating with stale revision ${currentRevision} (current is ${newRevision})`);
  const staleRes = await fetch(`${BASE_URL}/api/v1/topology-pool/mutate`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      operation: 'CREATE_GREENHOUSE',
      complexId: 'complex-01',
      ghId: `gh-stale-${Date.now().toString(36)}`,
      name: 'Stale GH',
      operationId: `op-stale-${Date.now()}`,
      changeId: `op-stale-${Date.now()}`,
      expectedRevision: currentRevision, // STALE!
    })
  });
  if (staleRes.status === 409) {
    const errObj = await staleRes.json();
    console.log(`   PASS: Stale expectedRevision correctly rejected with HTTP 409 Conflict (${errObj.error?.code})!`);
  } else {
    throw new Error(`Expected HTTP 409 Conflict, but got HTTP ${staleRes.status}`);
  }

  // Step 5: Cleanup - Delete test greenhouse
  console.log(`4. Cleaning up test greenhouse '${targetGhId}' with expectedRevision=${newRevision}`);
  const cleanRes = await fetch(`${BASE_URL}/api/v1/topology-pool/mutate`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      operation: 'DELETE_GREENHOUSE',
      complexId: 'complex-01',
      ghId: targetGhId,
      operationId: `op-clean-${Date.now()}`,
      changeId: `op-clean-${Date.now()}`,
      expectedRevision: newRevision,
    })
  });
  if (!cleanRes.ok) throw new Error("Cleanup mutation failed");
  const cleanJson = await cleanRes.json();
  console.log(`   PASS: Cleaned up. Final revision: ${cleanJson.data.poolRevision}`);
}

async function run() {
  try {
    console.log("--- TEST A: Basic Health Endpoint ---");
    const healthStats = await benchmarkEndpoint("GET /api/v1/health", "/api/v1/health", 20);

    console.log("\n--- TEST B: Topology Meta & Pool Endpoints ---");
    const metaStats = await benchmarkEndpoint("GET /api/v1/topology-pool/meta", "/api/v1/topology-pool/meta", 20);
    const topoStats = await benchmarkEndpoint("GET /api/v1/topology-pool", "/api/v1/topology-pool", 20);

    console.log("\n--- TEST C: Current Telemetry Fast-Path (RAM-first) ---");
    const telemStats = await benchmarkEndpoint("GET /api/v1/telemetry/current", "/api/v1/telemetry/current", 20);

    console.log("\n--- TEST D: Telemetry History (Bounded Cursor Query) ---");
    const histStats = await benchmarkEndpoint("GET /api/v1/telemetry/history?limit=10", "/api/v1/telemetry/history?limit=10", 20);

    await testWebSocketMultiClient();

    await testCrudAndRevision();

    console.log("\n============================================================");
    console.log("SUMMARY OF BENCHMARK METRICS (ms):");
    console.log("============================================================");
    console.table({
      "GET /health": healthStats,
      "GET /topology-pool/meta": metaStats,
      "GET /topology-pool": topoStats,
      "GET /telemetry/current": telemStats,
      "GET /telemetry/history": histStats
    });
    console.log("\nALL LIVE MATRIX TESTS PASSED PERFECTLY!");
  } catch (err) {
    console.error("\nTEST MATRIX FAILURE:", err);
    process.exit(1);
  }
}

run();
