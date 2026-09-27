async function testReboot() {
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer agrotech-secret-key' };
  
  // 1. Set pump_dosing_b to DISABLED
  const g = await fetch('http://192.168.0.139/api/v1/configuration', { headers }).then(r => r.json());
  const cfg = g.data.payload;
  const ver = g.data.configurationVersion;
  cfg.components = cfg.components.map(c => c.componentId === 'pump_dosing_b' ? { ...c, lifecycleState: 'DISABLED' } : c);
  
  const putRes = await fetch('http://192.168.0.139/api/v1/configuration', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ expectedVersion: ver, payload: cfg })
  }).then(r => r.json());
  console.log('PUT v' + putRes.data.configurationVersion + ' pump_dosing_b DISABLED');

  // 2. Trigger reboot via /api/v1/device/restart
  console.log('Triggering ESP32 restart...');
  await fetch('http://192.168.0.139/api/v1/device/restart', { method: 'POST', headers }).catch(() => {});
  
  // 3. Wait 8 seconds for reboot
  console.log('Waiting for ESP32 to boot...');
  await new Promise(r => setTimeout(r, 8000));
  
  // 4. Fetch status and configuration
  const s = await fetch('http://192.168.0.139/api/v1/status').then(r => r.json());
  console.log('ESP32 online! Uptime:', s.data.runtime.uptimeSec);
  
  const postReboot = await fetch('http://192.168.0.139/api/v1/configuration', { headers }).then(r => r.json());
  console.log('Post-reboot version:', postReboot.data.configurationVersion);
  const dosingB = postReboot.data.payload.components.find(c => c.componentId === 'pump_dosing_b');
  console.log('Post-reboot pump_dosing_b lifecycleState:', dosingB.lifecycleState);
  if (dosingB.lifecycleState === 'DISABLED') {
    console.log('SUCCESS: Equipment Ready state survived physical ESP32 reboot!');
  } else {
    console.error('FAIL: Equipment Ready state was lost on reboot!');
    process.exit(1);
  }
}
testReboot().catch(console.error);
