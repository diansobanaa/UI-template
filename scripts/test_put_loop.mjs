async function test() {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer agrotech-secret-key'
  };

  for (let i = 1; i <= 4; i++) {
    const getRes = await fetch('http://192.168.0.139/api/v1/configuration', { headers });
    const getData = await getRes.json();
    const config = getData.data.payload;
    const curVer = getData.data.configurationVersion;
    console.log(`\nIteration ${i}: Current version: ${curVer}`);

    const targetState = (i % 2 === 1) ? 'DISABLED' : 'COMMISSIONED';
    const updatedComponents = config.components.map(c => {
      if (c.componentId === 'pump_dosing_b') {
        return { ...c, lifecycleState: targetState };
      }
      return c;
    });

    const body = {
      expectedVersion: curVer,
      deploymentId: 'test-dep-iter-' + i + '-' + Date.now(),
      payload: {
        ...config,
        components: updatedComponents
      }
    };

    const putRes = await fetch('http://192.168.0.139/api/v1/configuration', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
    console.log(`Iteration ${i}: PUT status: ${putRes.status}`);
    const putData = await putRes.json();
    if (putRes.status !== 200) {
      console.error('PUT failed:', JSON.stringify(putData, null, 2));
      break;
    }
    console.log(`Iteration ${i}: New version deployed: ${putData.data.configurationVersion}, status: ${putData.data.deploymentStatus}`);
    
    // Verify GET
    const vRes = await fetch('http://192.168.0.139/api/v1/configuration', { headers });
    const vData = await vRes.json();
    const dosingB = vData.data.payload.components.find(c => c.componentId === 'pump_dosing_b');
    console.log(`Iteration ${i}: Verified pump_dosing_b state: ${dosingB.lifecycleState}`);
  }
}
test().catch(console.error);
