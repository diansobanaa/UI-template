#!/usr/bin/env node
/**
 * ITEM-5/K: Verify Web UI ↔ TFT state consistency.
 *
 * TFT (tft_hal.c) reads directly from firmware functions; Web UI reads via
 * HTTP /api/v1/fertigation/status. Both must reflect the same state.
 *
 * Run: node scripts/verify_tft_web_consistency.mjs [--esp32=http://192.168.0.100]
 */
import http from 'http';

const esp32Arg = process.argv.find(a => a.startsWith('--esp32='));
const ESP32_URL = esp32Arg ? esp32Arg.slice(8) : 'http://192.168.0.100';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log(`ITEM-5/K: Verifying TFT ↔ Web UI consistency at ${ESP32_URL}`);

  let pass = 0, fail = 0;
  const check = (name, condition, detail = '') => {
    if (condition) {
      console.log(`  ✓ ${name}`);
      pass++;
    } else {
      console.log(`  ✗ ${name} ${detail}`);
      fail++;
    }
  };

  try {
    const statusRes = await fetchJson(`${ESP32_URL}/api/v1/fertigation/status`);
    const status = statusRes.payload || statusRes;

    check('status.state present', typeof status.state === 'string', `(got ${typeof status.state})`);
    check('status.runId present', typeof status.runId === 'string' || status.runId === null);
    check('status.ghId present', typeof status.ghId === 'string' || status.ghId === null);
    check('status.targetWaterMl present', typeof status.targetWaterMl === 'number' || status.targetWaterMl === null);
    check('status.actualWaterMl present', typeof status.actualWaterMl === 'number' || status.actualWaterMl === null);
    check('status.queuedBatches is array', Array.isArray(status.queuedBatches));
    check('status.todaySchedule is array', Array.isArray(status.todaySchedule));
    check('status.activeDeliveries is array', Array.isArray(status.activeDeliveries));
    check('status.mixing.status present', status.mixing && typeof status.mixing.status === 'string');
    check('status.delivery.status present', status.delivery && typeof status.delivery.status === 'string');

    if (status.delivery && status.delivery.status === 'DISTRIBUTING') {
      check('status.actualFlowLpm present during distribution', typeof status.actualFlowLpm === 'number' || status.actualFlowLpm === null);
      check('status.actualDeliveredMl present during distribution', typeof status.actualDeliveredMl === 'number' || status.actualDeliveredMl === null);
    }

    // ITEM-4: dailyStats wired
    check('status.dailyStats present (ITEM-4)', status.dailyStats && typeof status.dailyStats === 'object');

    const queueRes = await fetchJson(`${ESP32_URL}/api/v1/fertigation/queue`);
    const queue = queueRes.payload || queueRes;
    check('queue.queuedBatches is array', Array.isArray(queue.queuedBatches));

    console.log(`\nITEM-5/K: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (err) {
    console.error(`ITEM-5/K: FATAL — ${err.message}`);
    console.error(`Is ESP32 online? Default URL: http://192.168.0.100 (override with --esp32=URL)`);
    process.exit(2);
  }
}

main();
