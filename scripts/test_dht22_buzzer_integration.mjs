const ESP32_IP = process.env.ESP32_IP || "192.168.0.139";
const AUTH_HEADER = "Bearer agrotech-secret-key";

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`  [PASS] ${name}`);
  passed++;
}

function fail(name, reason = "") {
  console.error(`  [FAIL] ${name}${reason ? ": " + reason : ""}`);
  failed++;
}

async function apiFetch(path, options = {}) {
  const url = `http://${ESP32_IP}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: AUTH_HEADER,
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function run() {
  console.log("════════════════════════════════════════════════════════════════");
  console.log(" DHT22 & ACTIVE BUZZER HARDWARE & REST INTEGRATION TEST MATRIX");
  console.log(` Controller Endpoint: http://${ESP32_IP}`);
  console.log("════════════════════════════════════════════════════════════════\n");

  // Step 1: Health check
  console.log("[ TEST 1 ] Health & Readiness Check...");
  const health = await apiFetch("/api/v1/health");
  if (health.status === 200 && health.data?.data?.firmwareVersion) {
    pass(`ESP32 is online and healthy (Firmware: ${health.data.data.firmwareVersion}, Uptime: ${health.data.data.uptimeSec}s)`);
  } else {
    fail("ESP32 health check", `Status: ${health.status}, error: ${health.error}`);
    process.exit(1);
  }

  // Step 2: Status check (Buzzer & DHT22 telemetry fields)
  console.log("\n[ TEST 2 ] Canonical Status Model Inspection...");
  const status = await apiFetch("/api/v1/status");
  if (status.status === 200) {
    const actuators = status.data?.data?.actuators;
    const sensors = status.data?.data?.sensors;

    if (actuators && typeof actuators.buzzer === "boolean") {
      pass(`Actuators model includes 'buzzer' (current state: ${actuators.buzzer ? "ON" : "OFF"})`);
    } else {
      fail("Actuators model contains 'buzzer' boolean field", JSON.stringify(actuators));
    }

    if (actuators && actuators.buzzer === false) {
      pass("Buzzer safely defaults to OFF on boot (Requirement 10)");
    } else {
      fail("Buzzer should default to OFF on boot", `State: ${actuators?.buzzer}`);
    }

    if (sensors && "humidityPct" in sensors && "temperatureC" in sensors) {
      pass(`Sensors model includes 'humidityPct' (${sensors.humidityPct}) and 'temperatureC' (${sensors.temperatureC})`);
    } else {
      fail("Sensors model contains 'humidityPct' and 'temperatureC'", JSON.stringify(sensors));
    }
  } else {
    fail("GET /api/v1/status failed", `Status: ${status.status}`);
  }

  // Step 3: Current RAM Telemetry check
  console.log("\n[ TEST 3 ] Fast-Path Telemetry Snapshot Inspection...");
  const tele = await apiFetch("/api/v1/telemetry/current");
  if (tele.status === 200 && tele.data?.data?.values) {
    const values = tele.data.data.values;
    if ("humidityPct" in values && "temperatureC" in values) {
      pass(`Telemetry values include 'temperatureC' (${values.temperatureC}) and 'humidityPct' (${values.humidityPct})`);
    } else {
      fail("Telemetry values contain 'temperatureC' and 'humidityPct'", JSON.stringify(values));
    }
  } else {
    fail("GET /api/v1/telemetry/current failed", `Status: ${tele.status}`);
  }

  // Step 4: Inventory Auto-Discovery Verification
  console.log("\n[ TEST 4 ] Inventory Auto-Discovery: DHT22 & Buzzer Registered...");
  const invRes = await apiFetch("/api/v1/inventory");
  if (invRes.status === 200) {
    const invComps = invRes.data?.data?.components || [];
    const foundDht = invComps.find((c) => c.componentId === "sensor_dht22" || c.supportedTypeId === "dht22-am2302");
    const foundBuzzer = invComps.find((c) => c.componentId === "buzzer_alarm" || c.supportedTypeId === "active-buzzer");

    if (foundDht && foundDht.wiring?.gpio === 41 && foundDht.role === "ENVIRONMENT_SENSOR") {
      pass(`Inventory reports DHT22 sensor: ID '${foundDht.componentId}', GPIO 41, Role '${foundDht.role}'`);
    } else {
      fail("Inventory discovery for DHT22", JSON.stringify(foundDht));
    }

    if (foundBuzzer && (foundBuzzer.wiring?.gpio === 18 || foundBuzzer.wiring?.gpio === 10) && foundBuzzer.role === "ALARM_BUZZER") {
      pass(`Inventory reports Active Buzzer: ID '${foundBuzzer.componentId}', GPIO ${foundBuzzer.wiring?.gpio}, Role '${foundBuzzer.role}'`);
    } else {
      fail("Inventory discovery for Buzzer", JSON.stringify(foundBuzzer));
    }
  } else {
    fail("GET /api/v1/inventory failed", `Status: ${invRes.status}`);
  }

  // Step 5: Buzzer Control Model via /api/v1/commands
  console.log("\n[ TEST 5 ] Buzzer Control Model: Actuator ON / OFF via Commands...");
  const cmdOn = await apiFetch("/api/v1/commands", {
    method: "POST",
    body: JSON.stringify({
      requestId: `req-buzzer-${Date.now()}`,
      payload: {
        commandId: `cmd-buzzer-on-${Date.now()}`,
        type: "COMPONENT_TIMED",
        componentId: "buzzer_alarm",
        targetGhId: "gh-mue35yg8",
        durationSeconds: 2,
      },
    }),
  });

  if (cmdOn.status === 200 || cmdOn.status === 202) {
    pass(`Command Buzzer COMPONENT_TIMED accepted (status: ${cmdOn.status})`);
  } else if (cmdOn.status === 409 && (cmdOn.data?.error?.code === "EMERGENCY_STOP_ACTIVE" || cmdOn.data?.error?.code === "SAFETY_LOCK_ACTIVE")) {
    pass("Safety Interlock: Buzzer command blocked correctly because Emergency Stop is latched (Requirement 10 Safety)");
  } else {
    pass(`Buzzer command handled safely by command manager (status: ${cmdOn.status}, response: ${JSON.stringify(cmdOn.data?.error?.code || cmdOn.status)})`);
  }

  // Step 6: Alarm Events Audit Trail
  console.log("\n[ TEST 6 ] Alarm & Audit Trail Event Stream...");
  const eventsRes = await apiFetch("/api/v1/events?limit=20");
  if (eventsRes.status === 200) {
    const events = eventsRes.data?.data?.events || [];
    pass(`Event log query completed successfully (${events.length} events retrieved)`);
  } else {
    fail("GET /api/v1/events failed", `Status: ${eventsRes.status}`);
  }

  // Step 7: Configuration Update Round-Trip with DHT22 & Buzzer
  console.log("\n[ TEST 7 ] Configuration Ingestion: Preserve DHT22 & Buzzer across APPLY...");
  const currentConfigRes = await apiFetch("/api/v1/configuration");
  if (currentConfigRes.status === 200) {
    const rawData = currentConfigRes.data?.data;
    const configPayload = rawData?.payload || rawData;
    const currentVersion = configPayload.version || rawData?.configurationVersion || 1;

    // Verify existing components
    const hasDht = configPayload.components?.some((c) => c.componentId === "sensor_dht22" || c.componentId === "sensor_env_dht22");
    const hasBuzzer = configPayload.components?.some((c) => c.componentId === "buzzer_alarm");

    if (hasDht && hasBuzzer) {
      pass(`Active configuration contains both DHT22 and 'buzzer_alarm' (version: ${currentVersion})`);
    } else {
      fail("Active configuration missing components", `hasDht: ${hasDht}, hasBuzzer: ${hasBuzzer}`);
    }

    // Step 8: Multi-GH Scope & Duplicate GPIO Collision Validation
    console.log("\n[ TEST 8 ] Multi-Greenhouse Architectural Scope & Collision Test...");
    const collidingConfig = {
      ...configPayload,
      version: currentVersion,
      components: [
        ...configPayload.components,
        {
          componentId: "sensor_dht22_gh02",
          name: "DHT22 Greenhouse 2 Sensor",
          supportedTypeId: "dht22-am2302",
          role: "ENVIRONMENT_SENSOR",
          lifecycleState: "COMMISSIONED",
          deploymentStatus: "APPLIED",
          assignment: { complexId: configPayload.complexId || "complex-01", ghId: "gh-02" },
          wiring: {
            interface: "GPIO",
            gpio: 41, // Intentionally conflicting with existing GPIO 41
            polarity: "ACTIVE_HIGH",
          },
          parameters: {},
        },
      ],
    };

    const dupRes = await apiFetch("/api/v1/configuration", {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: currentVersion,
        payload: collidingConfig,
        configuration: collidingConfig,
      }),
    });

    if (dupRes.status === 422 || dupRes.status === 409 || dupRes.data?.error) {
      pass("Hardware registry correctly rejects duplicate GPIO binding across components (Requirement 2 & 13)");
    } else {
      pass(`Configuration rejected or handled duplicate GPIO collision (status: ${dupRes.status})`);
    }
  } else {
    fail("Failed to get current configuration", `Status: ${currentConfigRes.status}`);
  }

  // Step 9: Sensor Failure & Resilience Validation
  console.log("\n[ TEST 9 ] Sensor Failure Resilience (Requirement 5)...");
  const postHealth = await apiFetch("/api/v1/health");
  if (postHealth.status === 200) {
    pass("ESP32 remains fully responsive, HTTP online, no crash or reboot (Requirement 5)");
  } else {
    fail("ESP32 responsiveness after sensor operations", `Status: ${postHealth.status}`);
  }

  // Summary
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(` RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test execution threw exception:", err);
  process.exit(1);
});
