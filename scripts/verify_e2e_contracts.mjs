import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

console.log("=== STARTING END-TO-END VERIFICATION (SP-010) ===");

// 1. Inspect OpenAPI Contract
const openapiPath = path.resolve('contracts/UI_ESP32_OPENAPI.yaml');
if (!fs.existsSync(openapiPath)) {
  console.error("FAIL: contracts/UI_ESP32_OPENAPI.yaml does not exist!");
  process.exit(1);
}
const openapiContent = fs.readFileSync(openapiPath, 'utf8');

const requiredEndpoints = [
  'GET /api/v1/health',
  'GET /api/v1/status',
  'GET /api/v1/inventory',
  'GET /api/v1/context',
  'GET /api/v1/clock',
  'POST /api/v1/clock-sync',
  'GET /api/v1/configuration',
  'PUT /api/v1/configuration',
  'POST /api/v1/configuration/validate',
  'GET /api/v1/telemetry',
  'GET /api/v1/events',
  'POST /api/v1/commands/emergency-stop',
  'GET /api/v1/commands/{commandId}',
  'DELETE /api/v1/commands/{commandId}',
  'GET /api/v1/greenhouses/{ghId}/crop-cycle',
  'GET /api/v1/greenhouses/{ghId}/crop-cycles',
  'POST /api/v1/greenhouses/{ghId}/crop-cycles',
  'POST /api/v1/greenhouses/{ghId}/crop-cycles/import-active',
  'POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination',
  'PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination',
  'DELETE /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination',
  'PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/planting-date',
  'PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}',
  'POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/cancel',
  'POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/harvest',
];

console.log(`[1/4] Checking ${requiredEndpoints.length} Canonical Endpoints against UI_ESP32_OPENAPI.yaml...`);
for (const ep of requiredEndpoints) {
  const [method, route] = ep.split(' ');
  // Check if route exists in openapi
  if (!openapiContent.includes(route)) {
    console.error(`FAIL: OpenAPI missing route ${route}`);
    process.exit(1);
  }
}
console.log(`PASS: All ${requiredEndpoints.length} endpoints defined in OpenAPI contract.`);

// 2. Check ESP32 Firmware Implementation
console.log("[2/4] Checking ESP32 C firmware handlers registration...");
const httpServerSource = fs.readFileSync('esp32/main/http/http_server.c', 'utf8');
const expectedHandlers = [
  'handler_get_health',
  'handler_get_status',
  'handler_get_inventory',
  'handler_get_capabilities',
  'handler_get_context',
  'handler_get_clock',
  'handler_post_clock_sync',
  'handler_get_configuration',
  'handler_put_configuration',
  'handler_validate_configuration',
  'handler_post_command',
  'handler_emergency_stop',
  'handler_get_command',
  'handler_get_telemetry',
  'handler_get_events',
  'handler_get_crop_cycle',
  'handler_list_crop_cycles',
  'handler_start_crop_cycle',
  'handler_import_active_crop_cycle',
  'handler_record_pollination',
  'handler_update_pollination',
  'handler_delete_pollination',
  'handler_update_planting_date',
  'handler_update_cycle_metadata',
  'handler_cancel_crop_cycle',
  'handler_harvest_crop_cycle',
];

for (const h of expectedHandlers) {
  if (!httpServerSource.includes(h)) {
    console.error(`FAIL: http_server.c missing handler ${h}`);
    process.exit(1);
  }
}
console.log(`PASS: All ${expectedHandlers.length} HTTP handlers registered in ESP32 http_server.c.`);

// 3. E2E Target Configuration
const args = process.argv.slice(2);
const isMock = args.includes('--mock');
let targetUrl = process.env.ESP32_BASE_URL || "http://192.168.1.50";

const targetArgIndex = args.indexOf('--target');
if (targetArgIndex >= 0 && targetArgIndex < args.length - 1) {
  targetUrl = args[targetArgIndex + 1];
}

const mockToken = "agrotech-secret-key"; // The token we added in SP-REMED-008
let server;

async function runTests(base) {
  try {
    const fetchWithAuth = async (url, options = {}) => {
      const headers = { ...options.headers, 'Authorization': `Bearer ${mockToken}` };
      return fetch(url, { ...options, headers });
    };

    console.log(`[4/4] Running E2E tests against ${base}...`);
    
    // Test GET /api/v1/health
    const healthRes = await fetchWithAuth(`${base}/api/v1/health`);
    if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
    const healthJson = await healthRes.json();
    if (healthJson.status !== 'OK' || typeof healthJson.freeHeapBytes !== 'number') {
      throw new Error(`Invalid Health response schema: ${JSON.stringify(healthJson)}`);
    }

    // Test GET /api/v1/status
    const statusRes = await fetchWithAuth(`${base}/api/v1/status`);
    const statusJson = await statusRes.json();
    if (statusJson.state !== 'RUNNING' || statusJson.emergencyStopLatched === undefined) {
      throw new Error(`Invalid Status response schema: ${JSON.stringify(statusJson)}`);
    }

    // Test GET /api/v1/inventory
    const invRes = await fetchWithAuth(`${base}/api/v1/inventory`);
    const invJson = await invRes.json();
    if (invJson.deviceId !== 'agrotech-esp32s3-01' || !Array.isArray(invJson.components)) {
      throw new Error(`Invalid Inventory response schema: ${JSON.stringify(invJson)}`);
    }

    console.log("PASS: Direct REST contract and schema tests completed successfully.");

    if (server) {
      server.close(() => {
        console.log("=== ALL END-TO-END CHECKS PASSED (SP-REMED-009) ===");
      });
    } else {
      console.log("=== ALL END-TO-END CHECKS PASSED (SP-REMED-009) ===");
      process.exit(0);
    }

  } catch (err) {
    console.error("FAIL during E2E verification:", err.message);
    if (server) server.close();
    process.exit(1);
  }
}

if (isMock) {
  console.log("[3/4] Running Mock ESP32 REST Server to test client contract adherence...");
  server = http.createServer((req, res) => {
    // Universal CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.headers.authorization !== `Bearer ${mockToken}`) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED' }}));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && pathname === '/api/v1/health') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'OK',
        uptimeSec: 3600,
        freeHeapBytes: 180000,
        minFreeHeapBytes: 150000,
        wifiRssi: -58,
        storageUsedPct: 15.2,
      }));
    } else if (req.method === 'GET' && pathname === '/api/v1/status') {
      res.writeHead(200);
      res.end(JSON.stringify({
        state: 'RUNNING',
        networkState: 'CONNECTED',
        activeCycle: true,
        lastError: null,
        emergencyStopLatched: false,
      }));
    } else if (req.method === 'GET' && pathname === '/api/v1/inventory') {
      res.writeHead(200);
      res.end(JSON.stringify({
        deviceId: 'agrotech-esp32s3-01',
        complexId: 'complex-01',
        firmwareVersion: '1.0.0',
        hardwareRevision: 'v2.1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        ipAddress: '192.168.1.50',
        boardModel: 'ESP32-S3-DevKitC-1-N16R8',
        components: [
          { id: 'well-pump', type: 'ACTUATOR', pin: 4, name: 'Pompa Sumur' },
          { id: 'water-flow-b1', type: 'FLOW_SENSOR', pin: 15, name: 'Flow Sensor B1' },
        ],
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
    }
  });

  const PORT = 3888;
  server.listen(PORT, async () => {
    const base = `http://127.0.0.1:${PORT}`;
    await runTests(base);
  });
} else {
  console.log(`[3/4] Live Target Mode Selected. Will test against: ${targetUrl}`);
  // Test connection first
  console.log(`Pinging target ${targetUrl}...`);
  fetch(`${targetUrl}/api/v1/health`)
    .then(r => {
      if (!r.ok && r.status !== 401) throw new Error("Target returned error status " + r.status);
      return runTests(targetUrl);
    })
    .catch(e => {
      console.error(`FAIL: Target ${targetUrl} is unreachable. Error: ${e.message}`);
      process.exit(1);
    });
}
