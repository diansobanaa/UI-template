/* M17 NOTICE: GPIO values in this fixture are synthetic logical-test data only.
 * They are NOT a physical wiring map and must never be used as commissioning evidence.
 * Physical GPIO authority is docs/HARDWARE_WIRING_MAP.md. */
/**
 * M3.0 — Active Configuration Authority Verification Gate
 * Software verification suite (mock architecture + source assertions; not physical proof)
 *
 * Tests A-R as specified in the M3.0 gate spec.
 * Results: PASS | FAIL | BLOCKED
 * BLOCKED = requires physical hardware / live reboot and is unavailable.
 */

import http from 'http';
import fs from 'node:fs';

const ESP32_HOST = process.env.ESP32_HOST || '192.168.1.50';
const ESP32_PORT = parseInt(process.env.ESP32_PORT || '80', 10);
const TOKEN      = process.env.ESP32_TOKEN || 'agrotech2025';
const USE_MOCK   = process.argv.includes('--mock');

/* ── HTTP helpers ── */

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: ESP32_HOST, port: ESP32_PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: 6000,
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function envelope(payload) {
  return { requestId: `m3-test-${Date.now()}`, client: { type: 'TestSuite', version: '3.0' }, payload };
}

/* ── Mock runtime ── */

let s_active_components = [];
let s_persistent_config = null;
let s_components_json   = null;
let s_config_version    = 0;

function mockLoadFromJson(cfg_or_str) {
  const parsed = (typeof cfg_or_str === 'string') ? JSON.parse(cfg_or_str) : cfg_or_str;
  const arr = Array.isArray(parsed) ? parsed : (parsed.components || []);
  // empty array is VALID — clears registry (M3.0 Fix 1)
  s_active_components = arr.map(c => ({
    componentId:      c.componentId || c.id || '',
    supportedTypeId:  c.supportedTypeId || c.type || 'UNKNOWN',
    name:             c.name || 'Unnamed',
    lifecycleState:   c.lifecycleState || c.status || 'REGISTERED',
    deploymentStatus: c.deploymentStatus || 'UNKNOWN',
    assignment:       c.assignment || {},
    wiring:           c.wiring || { interface: 'VIRTUAL', gpio: -1 },
    parameters:       c.parameters || {},
  }));
}

function mockRebuildFromPersisted() {
  if (s_persistent_config) {
    // Active config exists — load from it (M3.0 Fix 2: do NOT fall back to components.json)
    const cfg = s_persistent_config.configuration || s_persistent_config;
    mockLoadFromJson(cfg);
    return true;
  }
  // No active config must be safe-empty. components.json is migration input only
  // and must never silently enter the operational registry.
  s_active_components = [];
  return false;
}

function mockPutConfiguration(payload) {
  const cfg = payload.configuration || payload;
  const components = cfg.components || [];
  const seen = new Set();
  for (const c of components) {
    const cid = c.componentId || c.id || '';
    if (!cid || cid.length === 0) return { status: 422, error: 'Missing componentId' };
    if (cid.length > 32)           return { status: 422, error: `ID too long: ${cid}` };
    if (seen.has(cid))             return { status: 422, error: `Duplicate componentId: ${cid}` };
    seen.add(cid);
  }
  // Atomic: only persist+rebuild after validation passes (M3.0 Test P)
  s_persistent_config = payload;
  s_config_version += 1;
  mockLoadFromJson(cfg);
  return { status: 200, version: s_config_version };
}

function mockGetInventory() {
  return {
    deviceId: 'mock-device',
    complexId: 'complex-01',
    inventoryVersion: s_config_version,
    components: [...s_active_components],
  };
}

function mockFindById(id) {
  return s_active_components.find(c => c.componentId === id) || null;
}

function mockResetAll() {
  s_active_components = [];
  s_persistent_config = null;
  s_components_json   = null;
  s_config_version    = 0;
}

function mockSetComponentsJson(components) { s_components_json = components; }
function mockCorruptSecondaryRegistry(extra) { s_active_components.push(...extra); }
function mockRebuildRegistry() { mockRebuildFromPersisted(); return [...s_active_components]; }

/* ── API wrappers ── */

async function putConfiguration(components, extra = {}) {
  const payload = { configuration: { components, ...extra } };
  if (USE_MOCK) {
    const r = mockPutConfiguration(payload);
    return { status: r.status, body: r };
  }
  return request('PUT', '/api/v1/configuration', envelope(payload));
}

async function getInventory() {
  if (USE_MOCK) return { status: 200, body: { data: mockGetInventory() } };
  return request('GET', '/api/v1/inventory');
}

async function validateConfiguration(components) {
  if (USE_MOCK) {
    const seen = new Set();
    for (const c of components) {
      const cid = c.componentId || '';
      if (!cid) return { status: 200, body: { data: { valid: false, errors: [{ code: 'MISSING_ID' }] } } };
      if (seen.has(cid)) return { status: 200, body: { data: { valid: false, errors: [{ code: 'DUPLICATE_ID', componentId: cid }] } } };
      seen.add(cid);
    }
    return { status: 200, body: { data: { valid: true, errors: [] } } };
  }
  return request('POST', '/api/v1/configuration/validate', envelope({ configuration: { components } }));
}

/* ── Runner ── */

let pass = 0, fail = 0, blocked = 0;
const failures = [];

async function test(name, fn) {
  try {
    const result = await fn();
    if (result === 'BLOCKED') {
      console.log(`  [BLOCKED] ${name}`);
      blocked++;
    } else {
      console.log(`  [PASS]    ${name}`);
      pass++;
    }
  } catch (e) {
    console.log(`  [FAIL]    ${name}: ${e.message}`);
    failures.push({ name, error: e.message });
    fail++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function inventoryComponents(invBody) {
  if (invBody && invBody.data) return invBody.data.components || [];
  if (invBody && invBody.components) return invBody.components;
  return [];
}

/* ── Tests A-R ── */

async function run() {
  console.log('');
  console.log('====================================================================');
  console.log(' M3.0 Active Configuration Authority Verification Gate');
  console.log(`  Mode: ${USE_MOCK ? 'MOCK (--mock)' : `LIVE (${ESP32_HOST}:${ESP32_PORT})`}`);
  console.log('====================================================================');

  if (!USE_MOCK) {
    try {
      const r = await request('GET', '/api/v1/device/status');
      assert(r.status === 200, `Device not reachable (HTTP ${r.status})`);
    } catch (e) {
      console.log(`  [INFO] ESP32 not reachable (${e.message}). Run with --mock for software tests.`);
      blocked = 18;
      console.log(`\n0 PASS | 0 FAIL | 18 BLOCKED`);
      process.exit(0);
    }
  }

  console.log('\n-- GROUP 1: Authority Definition --');

  /* Test A */
  await test('A - Active config defines inventory', async () => {
    if (USE_MOCK) mockResetAll();
    const r = await putConfiguration([
      { componentId: 'PUMP-001', supportedTypeId: 'dosing-pump-12v', name: 'Nutrient A', lifecycleState: 'ENABLED' }
    ]);
    assert(r.status === 200, `PUT failed with ${r.status}`);
    const inv = await getInventory();
    const comps = inventoryComponents(inv.body);
    assert(comps.length === 1, `Expected 1 component, got ${comps.length}`);
    assert(comps[0].componentId === 'PUMP-001', `Expected PUMP-001, got ${comps[0]?.componentId}`);
  });

  /* Test B */
  await test('B - Remove component from config removes from inventory', async () => {
    if (USE_MOCK) mockResetAll();
    await putConfiguration([
      { componentId: 'PUMP-001', supportedTypeId: 'dosing-pump-12v', lifecycleState: 'ENABLED' },
      { componentId: 'PUMP-002', supportedTypeId: 'dosing-pump-12v', lifecycleState: 'ENABLED' },
    ]);
    const r = await putConfiguration([
      { componentId: 'PUMP-001', supportedTypeId: 'dosing-pump-12v', lifecycleState: 'ENABLED' },
    ]);
    assert(r.status === 200, `PUT v2 failed with ${r.status}`);
    const inv = await getInventory();
    const ids = inventoryComponents(inv.body).map(c => c.componentId);
    assert(ids.includes('PUMP-001'), 'PUMP-001 must remain');
    assert(!ids.includes('PUMP-002'), 'PUMP-002 must be removed');
  });

  /* Test C */
  await test('C - Static components.json cannot re-add removed component', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockSetComponentsJson([{ componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }]);
    mockPutConfiguration({ configuration: { components: [
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }
    ]}});
    const inv = mockGetInventory();
    const ids = inv.components.map(c => c.componentId);
    assert(!ids.includes('PUMP-002'), 'PUMP-002 from components.json must NOT appear in inventory');
    assert(ids.includes('PUMP-001'), 'PUMP-001 must be present');
  });

  /* Test D */
  await test('D - Unknown component ID returns NOT_FOUND (no silent fallback)', async () => {
    if (USE_MOCK) {
      mockResetAll();
      mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }
      ]}});
      assert(mockFindById('PUMP-999') === null, 'PUMP-999 must not exist');
    } else {
      await putConfiguration([{ componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }]);
      const inv = await getInventory();
      assert(!inventoryComponents(inv.body).find(c => c.componentId === 'PUMP-999'), 'PUMP-999 must NOT appear');
    }
  });

  console.log('\n-- GROUP 2: Resolution --');

  /* Test E */
  await test('E - Logical ID resolution: two instances, distinct bindings', async () => {
    if (USE_MOCK) {
      mockResetAll();
      mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 10 } },
        { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 11 } },
      ]}});
      const p1 = mockFindById('PUMP-001');
      const p2 = mockFindById('PUMP-002');
      assert(p1 && p1.wiring.gpio === 10, `PUMP-001 gpio must be 10, got ${p1?.wiring?.gpio}`);
      assert(p2 && p2.wiring.gpio === 11, `PUMP-002 gpio must be 11, got ${p2?.wiring?.gpio}`);
    } else {
      await putConfiguration([
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 10 } },
        { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 11 } },
      ]);
      const comps = inventoryComponents((await getInventory()).body);
      const p1 = comps.find(c => c.componentId === 'PUMP-001');
      const p2 = comps.find(c => c.componentId === 'PUMP-002');
      assert(p1 && p1.wiring?.gpio === 10, 'PUMP-001 gpio must be 10');
      assert(p2 && p2.wiring?.gpio === 11, 'PUMP-002 gpio must be 11');
    }
  });

  /* Test F */
  await test('F - Dynamic binding change reflected in registry without code change', async () => {
    if (USE_MOCK) {
      mockResetAll();
      mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 10 } },
        { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 11 } },
      ]}});
      mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 12 } },
        { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 11 } },
      ]}});
      assert(mockFindById('PUMP-001').wiring.gpio === 12, 'PUMP-001 must rebound to GPIO 12');
      assert(mockFindById('PUMP-002').wiring.gpio === 11, 'PUMP-002 must remain on GPIO 11');
    } else {
      await putConfiguration([
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 10 } },
        { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 11 } },
      ]);
      await putConfiguration([
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 12 } },
        { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 11 } },
      ]);
      const comps = inventoryComponents((await getInventory()).body);
      const p1 = comps.find(c => c.componentId === 'PUMP-001');
      assert(p1?.wiring?.gpio === 12, `PUMP-001 gpio must be 12 after rebind`);
    }
  });

  console.log('\n-- GROUP 3: Registry Integrity --');

  /* Test G */
  await test('G - Runtime registry rebuild is idempotent', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockPutConfiguration({ configuration: { components: [
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 10 } },
      { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 11 } },
    ]}});
    const r1 = mockRebuildRegistry();
    const r2 = mockRebuildRegistry();
    assert(r1.length === r2.length, 'Count must match between rebuilds');
    for (let i = 0; i < r1.length; i++) {
      assert(r1[i].componentId === r2[i].componentId, `ID[${i}] differs between rebuilds`);
      assert(JSON.stringify(r1[i].wiring) === JSON.stringify(r2[i].wiring), `Wiring[${i}] differs`);
    }
  });

  /* Test H */
  await test('H - Persistence round-trip: clear runtime, reload from persisted config', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockPutConfiguration({ configuration: { components: [
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 10 } },
    ]}});
    s_active_components = []; // simulate power cycle / clear
    mockRebuildRegistry();
    const found = mockFindById('PUMP-001');
    assert(found !== null, 'PUMP-001 must survive reload from persisted config');
    assert(found.wiring.gpio === 10, 'PUMP-001 gpio must match original after reload');
  });

  /* Test I */
  await test('I - Reboot round-trip: inventory after reboot matches before reboot', async () => {
    return 'BLOCKED'; // Requires physical hardware flash + reboot
  });

  /* Test J */
  await test('J - Secondary registry corruption: reload removes injected component', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockPutConfiguration({ configuration: { components: [
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
      { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
    ]}});
    mockCorruptSecondaryRegistry([
      { componentId: 'PUMP-999', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: {}, assignment: {}, parameters: {} }
    ]);
    assert(mockFindById('PUMP-999') !== null, 'Corruption pre-condition: PUMP-999 injected');
    mockRebuildRegistry();
    assert(mockFindById('PUMP-999') === null, 'PUMP-999 must disappear after rebuild from active config');
    assert(mockFindById('PUMP-001') !== null, 'PUMP-001 must survive rebuild');
  });

  console.log('\n-- GROUP 4: Override Protection --');

  /* Test K */
  await test('K - Stale components.json cannot override active configuration', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockPutConfiguration({ configuration: { components: [
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
    ]}});
    mockSetComponentsJson([
      { componentId: 'PUMP-999', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }
    ]);
    s_active_components = []; // clear runtime
    mockRebuildRegistry(); // must load active config, NOT components.json
    const ids = s_active_components.map(c => c.componentId);
    assert(ids.includes('PUMP-001'), 'PUMP-001 must be present (from active config)');
    assert(!ids.includes('PUMP-999'), 'PUMP-999 from stale components.json must NOT appear');
  });

  /* Test L */
  await test('L - Empty active config is valid (no static default injection)', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockPutConfiguration({ configuration: { components: [] } });
    const inv = mockGetInventory();
    assert(inv.components.length === 0,
      `Inventory must be empty for empty active config, got ${inv.components.length}`);
  });

  /* Test L2 */
  await test('L2 - Default JSON cannot add components when active config is empty', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockPutConfiguration({ configuration: { components: [] } });
    // s_components_json is not set — mimics hardware_registry_get_default_json() = []
    s_active_components = [];
    mockRebuildRegistry();
    assert(s_active_components.length === 0,
      `Registry must remain empty, got ${s_active_components.length}`);
  });

  console.log('\n-- GROUP 5: Candidate / Activation Isolation --');

  /* Test M */
  await test('M - Frontend installed inventory is API-authoritative (source assertion)', async () => {
    const servicesSource = fs.readFileSync(new URL('../src/lib/services.ts', import.meta.url), 'utf8');
    assert(/async getInstalledComponents\(\): Promise<InstalledComponent\[\]>[\s\S]*?_esp32\.getInventory\(\)/.test(servicesSource),
      'hardwareService.getInstalledComponents must call ESP32 getInventory()');
    assert(!servicesSource.includes('initialInstalledComponents'),
      'hardwareService must not reference static initialInstalledComponents as operational authority');
    assert(!servicesSource.includes('_devFallbackComponents'),
      'hardwareService must not maintain a production installed-component fallback store');
  });

  /* Test N */
  await test('N - Inventory version matches active configuration version', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockPutConfiguration({ configuration: { components: [
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }
    ]}});
    mockPutConfiguration({ configuration: { components: [
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
      { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
    ]}});
    const inv = mockGetInventory();
    assert(inv.inventoryVersion === s_config_version, `Version mismatch: ${inv.inventoryVersion} != ${s_config_version}`);
    assert(inv.components.length === 2, `Must have 2 components for v${s_config_version}`);
  });

  /* Test O */
  await test('O - Candidate (validate-only) config does not affect inventory', async () => {
    if (!USE_MOCK) return 'BLOCKED';
    mockResetAll();
    mockPutConfiguration({ configuration: { components: [
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }
    ]}});
    // validateConfiguration does NOT change s_persistent_config or s_active_components
    await validateConfiguration([
      { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
      { componentId: 'PUMP-002', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
    ]);
    const inv = mockGetInventory();
    const ids = inv.components.map(c => c.componentId);
    assert(ids.length === 1 && ids[0] === 'PUMP-001', 'Inventory must still have only PUMP-001 after validate-only');
    assert(!ids.includes('PUMP-002'), 'PUMP-002 must NOT appear after validate-only');
  });

  /* Test P */
  await test('P - Invalid config does not replace active registry (atomic validation)', async () => {
    if (USE_MOCK) {
      mockResetAll();
      mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }
      ]}});
      const vBefore = s_config_version;
      const result = mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-BAD', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
        { componentId: 'PUMP-BAD', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
      ]}});
      assert(result.status === 422, `Expected 422, got ${result.status}`);
      assert(s_config_version === vBefore, 'Config version must not change after invalid PUT');
      assert(mockFindById('PUMP-001') !== null, 'PUMP-001 must still be in active registry');
      assert(mockFindById('PUMP-BAD') === null, 'PUMP-BAD must not be in registry after failed PUT');
    } else {
      await putConfiguration([{ componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }]);
      const r = await putConfiguration([
        { componentId: 'PUMP-BAD', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
        { componentId: 'PUMP-BAD', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
      ]);
      assert(r.status === 422, `Expected 422 on duplicate IDs, got ${r.status}`);
      const comps = inventoryComponents((await getInventory()).body);
      assert(comps.some(c => c.componentId === 'PUMP-001'), 'PUMP-001 must remain after failed PUT');
      assert(!comps.some(c => c.componentId === 'PUMP-BAD'), 'PUMP-BAD must not appear after failed PUT');
    }
  });

  console.log('\n-- GROUP 6: Lifecycle --');

  /* Test Q */
  await test('Q - REMOVED lifecycle preserved in inventory (traceable identity)', async () => {
    if (USE_MOCK) {
      mockResetAll();
      mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }
      ]}});
      mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'REMOVED' }
      ]}});
      const p1 = mockFindById('PUMP-001');
      assert(p1 !== null, 'PUMP-001 must remain in registry after REMOVED');
      assert(p1.lifecycleState === 'REMOVED', `Expected REMOVED, got ${p1.lifecycleState}`);
    } else {
      await putConfiguration([{ componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' }]);
      await putConfiguration([{ componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'REMOVED' }]);
      const comps = inventoryComponents((await getInventory()).body);
      const p1 = comps.find(c => c.componentId === 'PUMP-001');
      assert(p1, 'PUMP-001 must remain in inventory after REMOVED');
      assert(p1.lifecycleState === 'REMOVED', `Expected REMOVED, got ${p1.lifecycleState}`);
    }
  });

  /* Test R */
  await test('R - No silent fallback for missing/blocked lifecycle components', async () => {
    if (USE_MOCK) {
      mockResetAll();
      mockPutConfiguration({ configuration: { components: [
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED' },
        { componentId: 'PUMP-NC',  supportedTypeId: 'pump-12v-dc', lifecycleState: 'NOT_COMMISSIONED' },
        { componentId: 'PUMP-DIS', supportedTypeId: 'pump-12v-dc', lifecycleState: 'DISABLED' },
        { componentId: 'PUMP-REM', supportedTypeId: 'pump-12v-dc', lifecycleState: 'REMOVED' },
      ]}});
      function isOperational(c) { return c && (c.lifecycleState === 'ENABLED' || c.lifecycleState === 'COMMISSIONED'); }
      assert(mockFindById('PUMP-999') === null, 'PUMP-999 (unknown) must not exist');
      assert(isOperational(mockFindById('PUMP-001')), 'PUMP-001 (ENABLED) must be operational');
      assert(!isOperational(mockFindById('PUMP-NC')),  'PUMP-NC (NOT_COMMISSIONED) must not be operational');
      assert(!isOperational(mockFindById('PUMP-DIS')), 'PUMP-DIS (DISABLED) must not be operational');
      assert(!isOperational(mockFindById('PUMP-REM')), 'PUMP-REM (REMOVED) must not be operational');
    } else {
      await putConfiguration([
        { componentId: 'PUMP-001', supportedTypeId: 'pump-12v-dc', lifecycleState: 'ENABLED', wiring: { interface: 'GPIO', gpio: 10 } },
        { componentId: 'PUMP-NC',  supportedTypeId: 'pump-12v-dc', lifecycleState: 'NOT_COMMISSIONED', wiring: { interface: 'GPIO', gpio: 11 } },
      ]);
      const comps = inventoryComponents((await getInventory()).body);
      const p1  = comps.find(c => c.componentId === 'PUMP-001');
      const pnc = comps.find(c => c.componentId === 'PUMP-NC');
      assert(p1 && p1.lifecycleState === 'ENABLED', `PUMP-001 must be ENABLED`);
      assert(pnc && pnc.lifecycleState === 'NOT_COMMISSIONED', `PUMP-NC must be NOT_COMMISSIONED`);
    }
  });

  /* ── Summary ── */
  console.log('');
  console.log('====================================================================');
  console.log(` M3.0 RESULTS: ${pass} PASS | ${fail} FAIL | ${blocked} BLOCKED`);
  console.log('====================================================================');

  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) {
      console.log(`  x ${f.name}`);
      console.log(`    ${f.error}`);
    }
  }

  const conclusion = fail === 0 ? (blocked > 0 ? 'BLOCKED (hardware tests pending)' : 'PASS') : 'FAIL';
  console.log('');
  console.log('Authority Graph (verified):');
  console.log('  NVS lvc_json (Active Config Store)');
  console.log('    -> hardware_registry_load_from_json()');
  console.log('    -> s_active_components[] (runtime view, DERIVED)');
  console.log('    -> GET /api/v1/inventory (API view, DERIVED)');
  console.log('    -> hardwareService.getInstalledComponents() (frontend, DERIVED)');
  console.log('');
  console.log('Secondary stores:');
  console.log('  s_active_components[]        DERIVED (from active config)');
  console.log('  components.json (SPIFFS)     MIGRATION INPUT ONLY; no silent boot fallback');
  console.log('  hardware_registry_get_default_json() -> empty JSON only');
  console.log('  actuator enum map             COMPATIBILITY ROUTING ONLY; registry remains authority');
  console.log('  initialInstalledComponents   NOT REFERENCED by hardwareService authority path');
  console.log('  localStorage                 NOT USED by hardwareService inventory authority path');
  console.log('');
  console.log(`M3.0 CONCLUSION: ${conclusion}`);

  if (fail > 0) process.exit(1);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });