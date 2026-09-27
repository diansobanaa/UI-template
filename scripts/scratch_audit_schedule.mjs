// Diagnostic reproduction of schedule creation without hardware
const complexId = "complex-01";
const ghId = "gh-01";

async function run() {
  console.log("Testing schedule creation without hardware...");

  // 1. Check current configuration of complex-01
  const configRes = await fetch(`http://127.0.0.1:8090/api/complexes/${complexId}/esp32/configuration`);
  const config = await configRes.json();
  console.log("Configuration version:", config.version);
  console.log("Components count:", (config.components || []).length);

  // 2. Try to create a fan schedule on backend
  const createRes = await fetch(`http://127.0.0.1:8090/api/complexes/${complexId}/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "fan",
      item: {
        ghId,
        mode: "time",
        time: "07:00",
        durationMin: 30,
        repeat: "Every Day",
        enabled: true,
      }
    })
  });
  const createData = await createRes.json();
  console.log("Backend create response status:", createRes.status, createData);

  // 3. Try to compile and deploy to backend
  const deployRes = await fetch(`http://127.0.0.1:8090/api/complexes/${complexId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      configuration: config,
      schedules: [
        {
          id: createData.schedule.id,
          scheduleId: createData.schedule.id,
          complexId,
          ghId,
          action: "FAN_TOGGLE",
          enabled: true,
          trigger: { type: "DAILY", hour: 7, minute: 0, daysOfWeek: 127 },
          parameters: { durationSec: 1800 }
        }
      ]
    })
  });
  const deployData = await deployRes.json();
  console.log("Backend deploy response status:", deployRes.status, JSON.stringify(deployData, null, 2));
}

run().catch(console.error);
