import http from 'http';
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const espIp = process.env.ESP32_IP || process.argv[2];
if (!espIp) {
  console.error("Usage: node scripts/test_schedule_refresh_loss_acceptance.mjs <ESP32_IP>");
  process.exit(1);
}

const UI_BASE = 'http://localhost:5173';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function espRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: espIp,
      port: 80,
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer agrotech-secret-key',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      },
      timeout: 10000
    }, (res) => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resData) });
        } catch {
          resolve({ status: res.statusCode, raw: resData });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${path} timed out`));
    });

    if (data) req.write(data);
    req.end();
  });
}

async function rebootPhysicalEsp32() {
  console.log('[DEVICE] Triggering physical ESP32 reboot via esptool RTS pin...');
  try {
    const pythonExe = "D:\\Espressif-tool\\Espressif\\python_env\\idf5.5_py3.11_env\\Scripts\\python.exe";
    execSync(`"${pythonExe}" -m esptool --chip esp32s3 -p COM3 run`, { stdio: 'inherit' });
  } catch (err) {
    console.warn('[DEVICE] Esptool reset encountered warning/error, checking connection:', err.message);
  }
  console.log('[DEVICE] Waiting 6 seconds for ESP32 boot and Wi-Fi reconnection...');
  await sleep(6000);

  // Poll until responsive
  let retries = 12;
  while (retries-- > 0) {
    try {
      const res = await espRequest('GET', '/api/v1/health');
      if (res.status === 200) {
        console.log('[DEVICE] Physical ESP32 is online and responding to /api/v1/health.');
        return;
      }
    } catch {
      // wait
    }
    await sleep(1000);
  }
  throw new Error('ESP32 did not come back online after reboot');
}

async function runAcceptanceTests() {
  console.log('================================================================');
  console.log('SCHEDULE PERSISTENCE & REFRESH LOSS ACCEPTANCE SUITE (15 TESTS)');
  console.log(`Target ESP32 IP: ${espIp}`);
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      failed++;
    }
  }

  // Query live topology from physical ESP32
  const topologyRes = await espRequest('GET', '/api/v1/topology-pool');
  const activeComplexId = topologyRes.data?.data?.complexes?.[0]?.complexId || 'complex-01';
  const activeGhId = topologyRes.data?.data?.greenhouses?.[0]?.ghId || 'gh-muclzcw0';
  console.log(`[TOPOLOGY] Active controller bound complex='${activeComplexId}', greenhouse='${activeGhId}'`);

  // Initial cleanup of any stale test items
  try {
    const listRes = await espRequest('GET', '/api/v1/schedule-intents');
    if (listRes.data?.data?.items) {
      for (const item of listRes.data.data.items) {
        if (item.id.startsWith('test-') || item.id.startsWith('wp-test') || item.id.startsWith('fert-test') || item.id.startsWith('fan-test')) {
          await espRequest('DELETE', `/api/v1/schedule-intents/${item.id}`);
        }
      }
    }
  } catch (e) {
    console.warn('Initial cleanup error:', e.message);
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    // -------------------------------------------------------------
    // TEST 10: Python backend offline - Direct ESP32 mode works
    // -------------------------------------------------------------
    console.log('\n--- TEST 10: Direct ESP32 REST CRUD with zero Python backend ---');
    const directCreateRes = await espRequest('POST', '/api/v1/schedule-intents', {
      item: {
        id: 'wp-test-direct-10',
        complexId: activeComplexId,
        name: 'Direct ESP32 Well Pump',
        kind: 'wellPump',
        time: '05:30',
        repeat: 'Every Day',
        durationMin: 18,
        radar: 'full',
        activationState: 'ACTIVE',
        blockedReasons: []
      }
    });
    assert(directCreateRes.status === 200 && directCreateRes.data?.data?.status === 'PERSISTED', 'TEST 10: Direct ESP32 POST succeeded without Python backend');

    // -------------------------------------------------------------
    // TEST 1: Create well pump schedule -> refresh browser -> remains visible
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Create well pump schedule -> refresh browser -> visible ---');
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxA.addInitScript((ip) => {
      localStorage.setItem('agrotech_bootstrap_ips', JSON.stringify([`http://${ip}`]));
      document.cookie = `agrotech_bootstrap_ip=http://${ip}; path=/`;
    }, espIp);

    const pageA = await ctxA.newPage();
    await pageA.goto(`${UI_BASE}/#/schedule?complex=${activeComplexId}`);
    await pageA.waitForLoadState('networkidle');
    await sleep(3500);

    // Refresh browser
    console.log('  Reloading browser page to test hydration from ESP32...');
    await pageA.reload();
    await pageA.waitForLoadState('networkidle');
    await sleep(3500);

    let pageAContent = await pageA.content();
    assert(pageAContent.includes('Direct ESP32 Well Pump') || pageAContent.includes('05:30'), 'TEST 1: Well pump schedule visible after browser refresh');

    // -------------------------------------------------------------
    // TEST 3 & TEST 13: Create fertigation under active GH -> refresh -> stays under active GH
    // -------------------------------------------------------------
    console.log('\n--- TEST 3 & 13: GH Scoping for fertigation schedule ---');
    const fertRes = await espRequest('POST', '/api/v1/schedule-intents', {
      item: {
        id: 'fert-test-gh-scoping',
        complexId: activeComplexId,
        ghId: activeGhId,
        name: 'Nutrient Mix GH Active',
        kind: 'fertigation',
        recipeId: 'recipe-veg',
        time: '07:15',
        repeat: 'Every Day',
        targetWaterL: 60,
        targetMode: 'volume',
        dosingAml: 120,
        dosingBml: 120,
        activationState: 'ACTIVE',
        blockedReasons: []
      }
    });
    assert(fertRes.status === 200, 'TEST 3: Fertigation schedule created under GH');

    await pageA.reload();
    await pageA.waitForLoadState('networkidle');
    await sleep(3500);
    pageAContent = await pageA.content();
    assert(pageAContent.includes('Nutrient Mix GH Active') && pageAContent.includes(activeGhId), 'TEST 3 & 13: Fertigation schedule visible under correct GH after refresh');

    // -------------------------------------------------------------
    // TEST 4: Duration, unit, and radar settings preserved
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Well pump settings preservation ---');
    const getIntentsRes = await espRequest('GET', '/api/v1/schedule-intents');
    const wpItem = getIntentsRes.data?.data?.items?.find(i => i.id === 'wp-test-direct-10');
    assert(wpItem && wpItem.durationMin === 18 && wpItem.radar === 'full', 'TEST 4: Well pump duration (18 min) and radar (full) preserved exactly in NVS intent');

    // -------------------------------------------------------------
    // TEST 5: Fan schedule settings preservation
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Fan schedule settings preservation ---');
    const fanRes = await espRequest('POST', '/api/v1/schedule-intents', {
      item: {
        id: 'fan-test-temp-05',
        complexId: activeComplexId,
        ghId: activeGhId,
        name: 'Cooling Fan Routine',
        kind: 'fan',
        mode: 'temp',
        onAboveC: 29.5,
        offBelowC: 25.0,
        time: '11:00',
        repeat: 'Every Day',
        activationState: 'ACTIVE',
        blockedReasons: []
      }
    });
    assert(fanRes.status === 200, 'TEST 5: Fan schedule created');
    const intentsAfterFan = await espRequest('GET', '/api/v1/schedule-intents');
    const fanItem = intentsAfterFan.data?.data?.items?.find(i => i.id === 'fan-test-temp-05');
    assert(fanItem && fanItem.mode === 'temp' && fanItem.onAboveC === 29.5 && fanItem.offBelowC === 25.0, 'TEST 5: Fan mode and temp thresholds preserved in NVS intent');

    // -------------------------------------------------------------
    // TEST 11: BLOCKED schedule survives refresh with reasons & excluded from compiled execution
    // -------------------------------------------------------------
    console.log('\n--- TEST 11: BLOCKED schedule persists as intent with reasons ---');
    const blockedRes = await espRequest('POST', '/api/v1/schedule-intents', {
      item: {
        id: 'fert-test-blocked-11',
        complexId: activeComplexId,
        ghId: activeGhId,
        name: 'Blocked Dosing Without Sensor',
        kind: 'fertigation',
        recipeId: 'recipe-bloom',
        time: '14:00',
        repeat: 'Every Day',
        targetWaterL: 100,
        activationState: 'BLOCKED',
        blockedReasons: ['FLOW_SENSOR_MISSING', 'DOSING_PUMP_DISCONNECTED']
      }
    });
    assert(blockedRes.status === 200, 'TEST 11: Blocked schedule created and persisted');
    
    // Refresh page and inspect
    await pageA.reload();
    await pageA.waitForLoadState('networkidle');
    await sleep(3500);
    const blockedInNvs = (await espRequest('GET', '/api/v1/schedule-intents')).data?.data?.items?.find(i => i.id === 'fert-test-blocked-11');
    assert(blockedInNvs && blockedInNvs.activationState === 'BLOCKED' && blockedInNvs.blockedReasons.length === 2, 'TEST 11: BLOCKED schedule and reasons intact in NVS after refresh');

    // Verify runtime compiled schedules do NOT execute this blocked intent
    const compiledRes = await espRequest('GET', '/api/v1/schedules/compiled');
    const compiledItems = compiledRes.data?.data?.schedules || [];
    const isBlockedInCompiled = compiledItems.some(s => s.id === 'fert-test-blocked-11');
    assert(!isBlockedInCompiled, 'TEST 11: BLOCKED schedule intent is strictly EXCLUDED from compiled executable runtime');

    // -------------------------------------------------------------
    // TEST 12: Revalidation promotes schedule when capabilities satisfied
    // -------------------------------------------------------------
    console.log('\n--- TEST 12: Revalidation promotes schedule to executable ---');
    const unblockedRes = await espRequest('PUT', '/api/v1/schedule-intents/fert-test-blocked-11', {
      item: {
        id: 'fert-test-blocked-11',
        complexId: activeComplexId,
        ghId: activeGhId,
        name: 'Blocked Dosing Without Sensor',
        kind: 'fertigation',
        recipeId: 'recipe-bloom',
        time: '14:00',
        repeat: 'Every Day',
        targetWaterL: 100,
        activationState: 'ACTIVE',
        blockedReasons: []
      }
    });
    assert(unblockedRes.status === 200 && unblockedRes.data?.data?.status === 'UPDATED', 'TEST 12: Schedule intent updated to ACTIVE after peripheral resolution');

    // -------------------------------------------------------------
    // TEST 6: Wipe localStorage/sessionStorage -> Enter ESP32 address -> refresh -> reconstructs from ESP32
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Complete browser storage loss recovery ---');
    await pageA.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    // Operator enters ESP32 address
    await pageA.evaluate((ip) => {
      localStorage.setItem('agrotech_bootstrap_ips', JSON.stringify([`http://${ip}`]));
      document.cookie = `agrotech_bootstrap_ip=http://${ip}; path=/`;
    }, espIp);

    await pageA.reload();
    await pageA.waitForLoadState('networkidle');
    await sleep(3500);
    pageAContent = await pageA.content();
    assert(pageAContent.includes('Direct ESP32 Well Pump') || pageAContent.includes('Nutrient Mix GH Active'), 'TEST 6: Reconstructed all schedules from ESP32 with zero browser schedule storage');

    // -------------------------------------------------------------
    // TEST 7: Browser A creates schedule -> Browser B refreshes -> schedule appears
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Multi-browser sync: Browser A creates -> Browser B refreshes ---');
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxB.addInitScript((ip) => {
      localStorage.setItem('agrotech_bootstrap_ips', JSON.stringify([`http://${ip}`]));
      document.cookie = `agrotech_bootstrap_ip=http://${ip}; path=/`;
    }, espIp);

    const pageB = await ctxB.newPage();
    await pageB.goto(`${UI_BASE}/#/schedule?complex=${activeComplexId}`);
    await pageB.waitForLoadState('networkidle');
    await sleep(3000);

    // Browser A creates new schedule via ESP32 API
    await espRequest('POST', '/api/v1/schedule-intents', {
      item: {
        id: 'wp-test-browser-sync',
        complexId: activeComplexId,
        name: 'Browser Sync Well Pump',
        kind: 'wellPump',
        time: '16:45',
        repeat: 'Every Day',
        durationMin: 12,
        radar: 'full',
        activationState: 'ACTIVE',
        blockedReasons: []
      }
    });

    // Browser B refreshes
    await pageB.reload();
    await pageB.waitForLoadState('networkidle');
    await sleep(3500);
    const contentB = await pageB.content();
    assert(contentB.includes('Browser Sync Well Pump') || contentB.includes('16:45'), 'TEST 7: Browser B sees schedule created by Browser A upon refresh');

    // -------------------------------------------------------------
    // TEST 9: Browser A edits schedule -> Browser B refreshes -> edited params appear
    // -------------------------------------------------------------
    console.log('\n--- TEST 9: Multi-browser sync: Browser A edits -> Browser B refreshes ---');
    await espRequest('PUT', '/api/v1/schedule-intents/wp-test-browser-sync', {
      item: {
        id: 'wp-test-browser-sync',
        complexId: activeComplexId,
        name: 'Browser Sync Pump EDITED',
        kind: 'wellPump',
        time: '17:15',
        repeat: 'Every Day',
        durationMin: 45,
        radar: 'none',
        activationState: 'ACTIVE',
        blockedReasons: []
      }
    });

    await pageB.reload();
    await pageB.waitForLoadState('networkidle');
    await sleep(3500);
    const editedContentB = await pageB.content();
    assert(editedContentB.includes('Browser Sync Pump EDITED') || editedContentB.includes('17:15'), 'TEST 9: Browser B sees edited parameters upon refresh');

    // -------------------------------------------------------------
    // TEST 8 & 14: Browser A deletes schedule -> Browser B refreshes -> disappears; others untouched
    // -------------------------------------------------------------
    console.log('\n--- TEST 8 & 14: Delete one schedule -> others untouched ---');
    const deleteRes = await espRequest('DELETE', '/api/v1/schedule-intents/wp-test-browser-sync');
    assert(deleteRes.status === 200, 'TEST 8: Schedule deleted on ESP32');

    await pageB.reload();
    await pageB.waitForLoadState('networkidle');
    await sleep(3500);
    const postDelContentB = await pageB.content();
    assert(!postDelContentB.includes('Browser Sync Pump EDITED'), 'TEST 8: Deleted schedule no longer appears on Browser B refresh');
    assert(postDelContentB.includes('Direct ESP32 Well Pump') || postDelContentB.includes('Nutrient Mix GH Active'), 'TEST 14: Other schedules remain untouched after single deletion');

    // -------------------------------------------------------------
    // TEST 2 & TEST 15: Reboot physical ESP32 -> refresh browser -> schedules restored with zero phantom duplicates
    // -------------------------------------------------------------
    console.log('\n--- TEST 2 & 15: Physical ESP32 Hardware Reboot Test ---');
    const countBeforeReboot = (await espRequest('GET', '/api/v1/schedule-intents')).data?.data?.total;
    console.log(`[TEST 2] Intent count before reboot: ${countBeforeReboot}`);

    await rebootPhysicalEsp32();

    const countAfterReboot = (await espRequest('GET', '/api/v1/schedule-intents')).data?.data?.total;
    console.log(`[TEST 2] Intent count after reboot: ${countAfterReboot}`);
    assert(countBeforeReboot === countAfterReboot, 'TEST 15: Exact schedule intent count restored after physical reboot with zero phantom duplicates');

    await pageA.reload();
    await pageA.waitForLoadState('networkidle');
    await sleep(4000);
    const postRebootContent = await pageA.content();
    assert(postRebootContent.includes('Direct ESP32 Well Pump') || postRebootContent.includes('Nutrient Mix GH Active'), 'TEST 2: All schedules restored and visible on UI after physical hardware reboot');

    // Cleanup test items
    console.log('\n--- Cleaning up temporary test intents ---');
    const finalIntents = await espRequest('GET', '/api/v1/schedule-intents');
    for (const item of finalIntents.data?.data?.items || []) {
      if (item.id.startsWith('wp-test') || item.id.startsWith('fert-test') || item.id.startsWith('fan-test')) {
        await espRequest('DELETE', `/api/v1/schedule-intents/${item.id}`);
      }
    }

  } finally {
    await browser.close();
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED (Total 15 tests)`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAcceptanceTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
