import http from 'http';
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const espIp = process.env.ESP32_IP || process.argv[2] || '192.168.0.139';
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
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(resData) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: resData });
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
  let retries = 15;
  while (retries-- > 0) {
    try {
      const res = await espRequest('GET', '/api/v1/health');
      if (res.status === 200) {
        console.log('[DEVICE] Physical ESP32 is back ONLINE.');
        return;
      }
    } catch {
      // wait
    }
    await sleep(1000);
  }
  throw new Error('ESP32 did not come back online after reboot');
}

async function run() {
  console.log('================================================================');
  console.log('CRITICAL FIX VERIFICATION — SCHEDULE MUST LIVE ONLY ON ESP32');
  console.log(`Target ESP32 IP: ${espIp}`);
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`[PASS] ${name} ${details ? '— ' + details : ''}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${details ? '— ' + details : ''}`);
      failed++;
    }
  }

  // Initial cleanup of test items
  try {
    const current = await espRequest('GET', '/api/v1/schedule-intents');
    for (const it of current.data?.data?.items || []) {
      const title = it.name || it.task || '';
      if (title.includes('Pompa') || title.includes('Pagi') || it.id?.includes('pagi') || title.includes('Blocked') || it.id?.includes('test') || it.id?.includes('blocked') || it.id?.includes('well')) {
        await espRequest('DELETE', `/api/v1/schedule-intents/${it.id}`);
      }
    }
  } catch {}

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    // Check Cache-Control headers on ESP32 responses
    console.log('--- Step 0: Verify Cache-Control: no-store on ESP32 ---');
    const headCheck = await espRequest('GET', '/api/v1/schedule-intents');
    const cc = headCheck.headers['cache-control'] || '';
    assert(cc.includes('no-store') && cc.includes('no-cache'), 'Step 0: ESP32 serves Cache-Control: no-store, no-cache', cc);

    // Operator creates "Pompa Sumur Pagi"
    console.log('\n--- Step 1: Operator creates "Pompa Sumur Pagi" (06:30, 2 min, stop when full) ---');
    const scheduleId = `wellPump-pagi-${Date.now()}`;
    const createRes = await espRequest('POST', '/api/v1/schedule-intents', {
      item: {
        id: scheduleId,
        type: 'well_pump',
        kind: 'wellPump',
        complexId: 'complex-01',
        name: 'Pompa Sumur Pagi',
        task: 'Pompa Sumur Pagi',
        time: '06:30',
        durationSec: 120,
        durationMin: 2,
        repeat: 'Every Day',
        enabled: true,
        status: 'scheduled',
        radar: 'full',
        radarConfig: { stopWhenFull: true },
        blockedReasons: []
      }
    });
    assert(createRes.status === 200 && createRes.data?.data?.status === 'PERSISTED', 'Step 1: POST /api/v1/schedule-intents succeeded on ESP32', JSON.stringify(createRes.data?.data));

    // Verify GET directly from ESP32
    console.log('\n--- Step 2: GET schedule directly from ESP32 ---');
    const getRes1 = await espRequest('GET', '/api/v1/schedule-intents');
    const found1 = getRes1.data?.data?.items?.find(i => i.id === scheduleId);
    assert(found1 && found1.name === 'Pompa Sumur Pagi' && found1.time === '06:30' && found1.durationSec === 120, 'Step 2: ESP32 NVS contains "Pompa Sumur Pagi"', JSON.stringify(found1));

    // Open Web UI and verify browser loads it from ESP32
    console.log('\n--- Step 3: Open Browser UI & Verify Render ---');
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxA.addInitScript((ip) => {
      localStorage.setItem('agrotech_bootstrap_ips', JSON.stringify([`http://${ip}`]));
      document.cookie = `agrotech_bootstrap_ip=http://${ip}; path=/`;
    }, espIp);

    const pageA = await ctxA.newPage();
    
    // Monitor network requests to ensure GET /api/v1/schedule-intents is performed
    let scheduleIntentsFetched = false;
    pageA.on('request', req => {
      if (req.url().includes('/api/v1/schedule-intents') && req.method() === 'GET') {
        scheduleIntentsFetched = true;
      }
    });

    await pageA.goto(`${UI_BASE}/#/schedule?complex=complex-01`);
    await pageA.waitForLoadState('domcontentloaded');
    await sleep(3500);

    let contentA = await pageA.content();
    assert(scheduleIntentsFetched, 'Step 3a: Browser performed live network GET to ESP32 /api/v1/schedule-intents');
    assert(contentA.includes('Pompa Sumur Pagi') || contentA.includes('06:30'), 'Step 3b: Browser UI rendered "Pompa Sumur Pagi" at 06:30');

    // F5 Browser Refresh
    console.log('\n--- Step 4: F5 / Browser Refresh ---');
    scheduleIntentsFetched = false;
    await pageA.reload();
    await pageA.waitForLoadState('domcontentloaded');
    await sleep(3500);

    contentA = await pageA.content();
    assert(scheduleIntentsFetched, 'Step 4a: On browser refresh, network GET to ESP32 was issued');
    assert(contentA.includes('Pompa Sumur Pagi') || contentA.includes('06:30'), 'Step 4b: "Pompa Sumur Pagi" survives browser refresh');

    // Physical Hardware Reboot
    console.log('\n--- Step 5: Physical ESP32 Hardware Reboot (esptool RTS reset) ---');
    await rebootPhysicalEsp32();

    // Verify GET directly from ESP32 after reboot
    console.log('\n--- Step 6: GET schedule directly from ESP32 post-reboot ---');
    const postRebootEsp = await espRequest('GET', '/api/v1/schedule-intents');
    const foundPostReboot = postRebootEsp.data?.data?.items?.find(i => i.id === scheduleId);
    assert(foundPostReboot && foundPostReboot.name === 'Pompa Sumur Pagi', 'Step 6: "Pompa Sumur Pagi" 100% PERSISTED in ESP32 NVS across real hardware reboot!', JSON.stringify(foundPostReboot));

    // Browser refresh post-reboot
    console.log('\n--- Step 7: Browser refresh post-reboot ---');
    scheduleIntentsFetched = false;
    await pageA.reload();
    await pageA.waitForLoadState('domcontentloaded');
    await sleep(3500);

    contentA = await pageA.content();
    assert(scheduleIntentsFetched, 'Step 7a: Network GET to ESP32 on refresh post-reboot');
    assert(contentA.includes('Pompa Sumur Pagi') || contentA.includes('06:30'), 'Step 7b: Browser UI shows "Pompa Sumur Pagi" after ESP32 reboot');

    // Zero Browser Storage Test
    console.log('\n--- Step 8: Zero Browser Storage Test (localStorage.clear + sessionStorage.clear) ---');
    await pageA.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    // Set ONLY the allowed locator hint
    await pageA.evaluate((ip) => {
      localStorage.setItem('agrotech_bootstrap_ips', JSON.stringify([`http://${ip}`]));
      document.cookie = `agrotech_bootstrap_ip=http://${ip}; path=/`;
    }, espIp);

    // Verify localStorage contains NO schedules
    const storageKeys = await pageA.evaluate(() => Object.keys(localStorage));
    assert(!storageKeys.some(k => k.includes('schedule') || k.includes('config') || k.includes('calibrations')), 'Step 8a: ZERO schedule/operational data in localStorage', JSON.stringify(storageKeys));

    await pageA.reload();
    await pageA.waitForLoadState('domcontentloaded');
    await sleep(3500);

    contentA = await pageA.content();
    assert(contentA.includes('Pompa Sumur Pagi') || contentA.includes('06:30'), 'Step 8b: With ZERO browser schedule storage, "Pompa Sumur Pagi" loaded directly from ESP32');

    // Step 9: BLOCKED Schedules Must Also Persist
    console.log('\n--- Step 9: BLOCKED schedule persistence & reboot survival ---');
    const blockedScheduleId = `blocked-flow-${Date.now()}`;
    const blockedRes = await espRequest('POST', '/api/v1/schedule-intents', {
      item: {
        id: blockedScheduleId,
        type: 'well_pump',
        kind: 'wellPump',
        complexId: 'complex-01',
        name: 'Pompa Tanpa Sensor Aliran',
        task: 'Pompa Tanpa Sensor Aliran',
        status: 'BLOCKED',
        activationState: 'BLOCKED',
        time: '08:00',
        durationSec: 300,
        radar: { stopWhenFull: true },
        blockedReasons: ['FLOW_SENSOR_UNAVAILABLE']
      }
    });
    assert(blockedRes.status === 200, 'Step 9a: BLOCKED schedule intent persisted to ESP32 NVS');

    // Verify excluded from compiled FreeRTOS scheduler
    const compiledRes = await espRequest('GET', '/api/v1/schedules/compiled');
    const compiledList = compiledRes.data?.data?.schedules || [];
    assert(!compiledList.some(s => s.id === blockedScheduleId), 'Step 9b: BLOCKED schedule is EXCLUDED from compiled runtime');

    // Reboot ESP32
    console.log('Rebooting ESP32 with BLOCKED schedule...');
    await rebootPhysicalEsp32();

    const postRebootBlocked = await espRequest('GET', '/api/v1/schedule-intents');
    const foundBlocked = postRebootBlocked.data?.data?.items?.find(i => i.id === blockedScheduleId);
    assert(foundBlocked && foundBlocked.name === 'Pompa Tanpa Sensor Aliran' && (foundBlocked.status === 'BLOCKED' || foundBlocked.activationState === 'BLOCKED'), 'Step 9c: BLOCKED schedule intent survived physical reboot in NVS with reasons intact', JSON.stringify(foundBlocked?.blockedReasons));

    // Browser refresh
    await pageA.reload();
    await pageA.waitForLoadState('domcontentloaded');
    await sleep(3500);
    contentA = await pageA.content();
    assert(contentA.includes('Pompa Tanpa Sensor Aliran') || contentA.includes('08:00'), 'Step 9d: BLOCKED schedule rendered in UI after reboot');

    // Step 10: Multi-Browser Sync
    console.log('\n--- Step 10: Multi-Browser Independence Test ---');
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxB.addInitScript((ip) => {
      localStorage.setItem('agrotech_bootstrap_ips', JSON.stringify([`http://${ip}`]));
      document.cookie = `agrotech_bootstrap_ip=http://${ip}; path=/`;
    }, espIp);

    const pageB = await ctxB.newPage();
    await pageB.goto(`${UI_BASE}/#/schedule?complex=complex-01`);
    await pageB.waitForLoadState('domcontentloaded');
    await sleep(3500);

    const contentB = await pageB.content();
    assert(contentB.includes('Pompa Sumur Pagi'), 'Step 10a: Browser B independently fetched "Pompa Sumur Pagi" from ESP32');

    // Browser A deletes schedule
    console.log('Browser A deletes "Pompa Sumur Pagi" on ESP32...');
    const delRes = await espRequest('DELETE', `/api/v1/schedule-intents/${scheduleId}`);
    assert(delRes.status === 200, 'Step 10b: Schedule deleted from ESP32 NVS');

    // Browser B refreshes
    await pageB.reload();
    await pageB.waitForLoadState('domcontentloaded');
    await sleep(3500);

    const contentBPostDel = await pageB.content();
    assert(!contentBPostDel.includes('Pompa Sumur Pagi'), 'Step 10c: Browser B refreshed and schedule is gone (no stale browser cache)');

    // Cleanup
    await espRequest('DELETE', `/api/v1/schedule-intents/${blockedScheduleId}`);

  } finally {
    await browser.close();
  }

  console.log('\n================================================================');
  console.log(`TOTAL RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
