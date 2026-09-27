const http = require('http');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '192.168.0.139',
      port: 80,
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer agrotech-secret-key',
        ...(data ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        } : {})
      },
      timeout: 5000
    }, (res) => {
      let respBody = '';
      res.on('data', chunk => respBody += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(respBody);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: respBody });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('====================================================');
  console.log('   STEP 1: Verify Export Capabilities Endpoint      ');
  console.log('====================================================');
  const cap = await request('GET', '/api/v1/export/capabilities');
  console.log('Status:', cap.status);
  console.log('Capabilities payload:', JSON.stringify(cap.body, null, 2));

  console.log('\n====================================================');
  console.log('   STEP 2: Check Active Cycle State in NVS          ');
  console.log('====================================================');
  const cycle = await request('GET', '/api/v1/greenhouses/gh-mue35yg8/crop-cycle');
  console.log('Current cycle status:', cycle.body?.data?.status, 'cycleId:', cycle.body?.data?.cycleId);

  let activeCycleId = cycle.body?.data?.cycleId;
  if (!activeCycleId || cycle.body?.data?.status !== 'ACTIVE') {
    console.log('Starting a fresh cycle...');
    const startRes = await request('POST', '/api/v1/greenhouses/gh-mue35yg8/crop-cycles', {
      requestId: 'test-start-001',
      payload: {
        tanggalTanam: '2026-09-15',
        variety: 'Golden Aroma Melon',
        plantCount: 750,
        notes: 'Lifecycle automated test'
      }
    });
    console.log('Start status:', startRes.status);
    activeCycleId = startRes.body?.data?.cycleId;
  }
  console.log('Active Cycle ID is:', activeCycleId);

  console.log('\n====================================================');
  console.log('   STEP 3: Test Patching Planting Date (Original Bug)');
  console.log('====================================================');
  const patchPlanting = await request('PATCH', `/api/v1/greenhouses/gh-mue35yg8/crop-cycles/${activeCycleId}/planting-date`, {
    requestId: 'test-patch-plant-1',
    payload: {
      tanggalTanam: '2026-09-17'
    }
  });
  console.log('Patch planting date status:', patchPlanting.status);
  console.log('Data returned:', JSON.stringify(patchPlanting.body?.data, null, 2));

  console.log('\n====================================================');
  console.log('   STEP 4: Record Pollination Date                  ');
  console.log('====================================================');
  const polRes = await request('POST', `/api/v1/greenhouses/gh-mue35yg8/crop-cycles/${activeCycleId}/pollination`, {
    requestId: 'test-pol-1',
    payload: {
      tanggalPolinasi: '2026-09-22',
      method: 'BEE'
    }
  });
  console.log('Record pollination status:', polRes.status);
  console.log('Pollination result:', JSON.stringify(polRes.body?.data, null, 2));

  console.log('\n====================================================');
  console.log('   STEP 5: Harvest Active Crop Cycle                ');
  console.log('====================================================');
  const harvestRes = await request('POST', `/api/v1/greenhouses/gh-mue35yg8/crop-cycles/${activeCycleId}/harvest`, {
    requestId: 'test-harvest-1',
    payload: {
      harvestDate: '2026-09-24',
      yieldKg: 1420.5,
      grade: 'A',
      notes: 'Excellent sugar brix 15.2'
    }
  });
  console.log('Harvest status:', harvestRes.status);
  console.log('Harvest response:', JSON.stringify(harvestRes.body?.data, null, 2));

  console.log('\n====================================================');
  console.log('   STEP 6: Verify Active Cycle Cleared from NVS     ');
  console.log('====================================================');
  const postHarvest = await request('GET', '/api/v1/greenhouses/gh-mue35yg8/crop-cycle');
  console.log('Active cycle after harvest status:', postHarvest.status);
  console.log('Active cycle data:', JSON.stringify(postHarvest.body?.data, null, 2));

  console.log('\n====================================================');
  console.log('   STEP 7: Start NEW Active Crop Cycle in Greenhouse');
  console.log('====================================================');
  const newCycleRes = await request('POST', '/api/v1/greenhouses/gh-mue35yg8/crop-cycles', {
    requestId: 'test-start-002',
    payload: {
      tanggalTanam: '2026-09-24',
      variety: 'Rock Melon Inthanon',
      plantCount: 800,
      notes: 'New cycle after harvest'
    }
  });
  console.log('New cycle start status:', newCycleRes.status);
  console.log('New cycle data:', JSON.stringify(newCycleRes.body?.data, null, 2));

  console.log('\n====================================================');
  console.log('   STEP 8: Test Export Job Creation (SD Absent)     ');
  console.log('====================================================');
  const expJob = await request('POST', '/api/v1/export/jobs', {
    requestId: 'test-exp-job-1',
    payload: {
      dataset: 'crop_cycles',
      ghId: 'gh-mue35yg8',
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 10
    }
  });
  console.log('Export job status:', expJob.status);
  console.log('Export error payload:', JSON.stringify(expJob.body?.error, null, 2));
}

run().catch(console.error);
