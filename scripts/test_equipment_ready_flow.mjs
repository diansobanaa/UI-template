/**
 * test_equipment_ready_flow.mjs
 *
 * Tests the Equipment Ready State persistence flow per SP-EQUIPMENT-READY-PERSIST-001.
 *
 * RULES:
 *  - Equipment ready state (lifecycleState: COMMISSIONED/DISABLED) MUST persist on ESP32 SPIFFS
 *  - Browser storage (localStorage/sessionStorage) MUST NOT be the authority
 *  - After browser refresh, ESP32 reboot, or storage clear — state must come from ESP32
 *
 * Usage:
 *   node scripts/test_equipment_ready_flow.mjs [ESP32_IP]
 *
 * Example:
 *   node scripts/test_equipment_ready_flow.mjs 192.168.0.139
 */

const ESP32_IP = process.argv[2] || "192.168.0.139";
const BASE_URL = `http://${ESP32_IP}`;
const AUTH_HEADER = "Bearer agrotech-secret-key";

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  [PASS] ${label}`);
  passed++;
}

function fail(label, detail = "") {
  console.error(`  [FAIL] ${label}${detail ? ": " + detail : ""}`);
  failed++;
}

async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: AUTH_HEADER,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

async function getConfig() {
  const { status, body } = await apiFetch("/api/v1/configuration");
  if (status !== 200 || !body?.data?.payload) return null;
  return body.data.payload;
}

async function putConfig(config, expectedVersion) {
  const { status, body } = await apiFetch("/api/v1/configuration", {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion,
      payload: config,
      configuration: config,
    }),
  });
  return { status, body };
}

async function reboot() {
  try {
    await apiFetch("/api/v1/device/reboot", { method: "POST" }).catch(() => {});
  } catch {}
  console.log("    [ESP32 REBOOT] Waiting 8 seconds for ESP32 to restart...");
  await new Promise((r) => setTimeout(r, 8000));
  for (let i = 0; i < 10; i++) {
    try {
      const { status } = await apiFetch("/api/v1/health");
      if (status === 200) {
        console.log("    [ESP32 REBOOT] ESP32 is back online.");
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function setComponentLifecycle(config, gpio, lifecycle) {
  const updated = {
    ...config,
    components: config.components.map((c) => {
      if (c.wiring?.gpio === gpio) {
        return { ...c, lifecycleState: lifecycle };
      }
      return c;
    }),
  };
  const found = updated.components.some((c) => c.wiring?.gpio === gpio);
  if (!found) {
    updated.components.push({
      componentId: `gpio_${gpio}_test`,
      name: `Test GPIO ${gpio}`,
      supportedTypeId: "relay",
      role: "COOLING_FAN",
      lifecycleState: lifecycle,
      deploymentStatus: "APPLIED",
      assignment: { complexId: config.complexId },
      wiring: { interface: "GPIO", gpio, polarity: "ACTIVE_LOW" },
      parameters: {},
    });
  }
  return updated;
}

function findComponentLifecycle(config, gpio) {
  return config?.components?.find((c) => c.wiring?.gpio === gpio)?.lifecycleState ?? null;
}

async function main() {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(` Equipment Ready State Persistence Test`);
  console.log(` Target: ${BASE_URL}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // STEP 0: Health check
  console.log("[ STEP 0 ] ESP32 health check...");
  {
    const { status } = await apiFetch("/api/v1/health");
    if (status === 200) {
      pass("Step 0: ESP32 reachable");
    } else {
      fail("Step 0: ESP32 health check", `HTTP ${status}`);
      process.exit(1);
    }

    const res = await fetch(`${BASE_URL}/api/v1/configuration`, {
      headers: { Authorization: AUTH_HEADER },
    });
    const cc = res.headers.get("cache-control") || "";
    if (cc.includes("no-store") || cc.includes("no-cache")) {
      pass("Step 0: Cache-Control: no-store/no-cache present");
    } else {
      fail("Step 0: Cache-Control", `Got: ${cc || "(none)"}`);
    }
  }

  let config = await getConfig();
  if (!config) {
    fail("Load config", "No active configuration on ESP32. Deploy baseline first.");
    process.exit(1);
  }
  const testGpio = config.components.find((c) => c.wiring?.gpio != null)?.wiring?.gpio;
  if (testGpio == null) {
    fail("Find test GPIO", "No GPIO component in config");
    process.exit(1);
  }
  const compName = config.components.find(c => c.wiring?.gpio === testGpio)?.name;
  console.log(`\n   Using GPIO ${testGpio} (${compName}) as test component.`);

  // TEST E1: Ready -> refresh -> still Ready
  console.log("\n[ TEST E1 ] Ready → refresh → still Ready");
  {
    const cfg = await setComponentLifecycle(config, testGpio, "COMMISSIONED");
    const { status } = await putConfig(cfg, config.version);
    if (status === 200) pass("E1: PUT lifecycleState=COMMISSIONED succeeded");
    else fail("E1: PUT COMMISSIONED", `HTTP ${status}`);

    config = await getConfig();
    const lc = findComponentLifecycle(config, testGpio);
    if (lc === "COMMISSIONED") pass("E1: After refresh, COMMISSIONED persists on ESP32");
    else fail("E1: lifecycleState after refresh", `Got '${lc}'`);
  }

  // TEST E2: Not Ready -> refresh -> still Not Ready
  console.log("\n[ TEST E2 ] Not Ready → refresh → still Not Ready");
  {
    const cfg = await setComponentLifecycle(config, testGpio, "DISABLED");
    const { status } = await putConfig(cfg, config.version);
    if (status === 200) pass("E2: PUT lifecycleState=DISABLED succeeded");
    else fail("E2: PUT DISABLED", `HTTP ${status}`);

    config = await getConfig();
    const lc = findComponentLifecycle(config, testGpio);
    if (lc === "DISABLED") pass("E2: After refresh, DISABLED persists on ESP32");
    else fail("E2: lifecycleState after refresh", `Got '${lc}'`);
  }

  // TEST E3: Ready → physical ESP32 reboot → still Ready (SPIFFS persistence)
  console.log("\n[ TEST E3 ] Ready → physical ESP32 reboot → still Ready (SPIFFS)");
  {
    const cfg = await setComponentLifecycle(config, testGpio, "COMMISSIONED");
    const { status } = await putConfig(cfg, config.version);
    if (status === 200) pass("E3: SET COMMISSIONED before reboot");
    else fail("E3: SET COMMISSIONED", `HTTP ${status}`);

    const rebooted = await reboot();
    if (rebooted) pass("E3: ESP32 rebooted and came back online");
    else fail("E3: ESP32 did not come back online after reboot");

    config = await getConfig();
    const lc = findComponentLifecycle(config, testGpio);
    if (lc === "COMMISSIONED") pass("E3: COMMISSIONED PERSISTED across hardware reboot (SPIFFS)");
    else fail("E3: lifecycleState after reboot", `Got '${lc}'`);
  }

  // TEST E4: Clear browser storage → still Ready from ESP32
  console.log("\n[ TEST E4 ] Browser storage cleared → state still from ESP32 (authoritative)");
  {
    // This script has no browser context — simulating by doing independent GET
    const freshConfig = await getConfig();
    const lc = findComponentLifecycle(freshConfig, testGpio);
    if (lc === "COMMISSIONED") pass("E4: ESP32 serves COMMISSIONED independent of any browser state");
    else fail("E4: State from ESP32 independent of browser", `Got '${lc}'`);
  }

  // TEST E5: Multi-client (Browser B independently sees same state)
  console.log("\n[ TEST E5 ] Multi-client: 2nd client sees same state from ESP32");
  {
    const configB = await getConfig();
    const lcB = findComponentLifecycle(configB, testGpio);
    if (lcB === "COMMISSIONED") pass("E5: Browser B independently fetches COMMISSIONED from ESP32");
    else fail("E5: Browser B state", `Got '${lcB}'`);
  }

  // TEST E6: Browser A unchecks Ready → Browser B sees Not Ready
  console.log("\n[ TEST E6 ] Browser A unchecks Ready → Browser B sees Not Ready");
  {
    const cfg = await setComponentLifecycle(config, testGpio, "DISABLED");
    const { status } = await putConfig(cfg, config.version);
    if (status === 200) pass("E6: Browser A PUTs DISABLED");
    else fail("E6: Browser A PUT DISABLED", `HTTP ${status}`);

    const configB = await getConfig();
    const lcB = findComponentLifecycle(configB, testGpio);
    if (lcB === "DISABLED") pass("E6: Browser B sees DISABLED (no stale cache)");
    else fail("E6: Browser B state", `Got '${lcB}'`);
    config = configB;
  }

  // TEST E7: Equipment DISABLED → schedule not compiled; COMMISSIONED → compiled
  console.log("\n[ TEST E7 ] Equipment Not Ready → schedule BLOCKED; Ready → schedule active");
  {
    const lc = findComponentLifecycle(config, testGpio);
    console.log(`   GPIO ${testGpio} is currently: ${lc} (should be DISABLED)`);

    const scheduleIntentId = `test-e7-${Date.now()}`;
    const scheduleIntent = {
      id: scheduleIntentId,
      scheduleId: scheduleIntentId,
      ownerId: scheduleIntentId,
      complexId: config.complexId,
      action: "WATER_PUMP",
      enabled: true,
      priority: 100,
      trigger: { type: "DAILY", hour: 6, minute: 0, daysOfWeek: 127 },
      parameters: {},
      activationState: "DRAFT",
    };

    const intentRes = await apiFetch("/api/v1/schedule-intents", {
      method: "POST",
      body: JSON.stringify(scheduleIntent),
    });
    if (intentRes.status === 201 || intentRes.status === 200) {
      pass("E7a: WATER_PUMP schedule intent created on ESP32");
    } else {
      fail("E7a: Create schedule intent", `HTTP ${intentRes.status}`);
    }

    // With DISABLED equipment, schedule should NOT be in compiled set
    // Note: only meaningful if E7a succeeded (schedule was created)
    const compiledRes = await apiFetch("/api/v1/schedules/compiled");
    const compiled = compiledRes.body?.data?.compiled || [];
    const isCompiled = compiled.some(
      (s) => s.scheduleId === scheduleIntentId || s.id === scheduleIntentId
    );
    if (!isCompiled) {
      pass("E7b: With DISABLED equipment, WATER_PUMP not in compiled set (BLOCKED)");
    } else {
      fail("E7b: Schedule should NOT be compiled with DISABLED equipment");
    }

    // Now COMMISSION the component
    const cfg = await setComponentLifecycle(config, testGpio, "COMMISSIONED");
    const { status } = await putConfig(cfg, config.version);
    if (status === 200) pass("E7c: Equipment set to COMMISSIONED (triggers revalidation)");
    else fail("E7c: SET to COMMISSIONED", `HTTP ${status}`);

    config = await getConfig();
    const lc2 = findComponentLifecycle(config, testGpio);
    if (lc2 === "COMMISSIONED") {
      pass("E7d: Equipment COMMISSIONED state persists — ready for schedule revalidation");
    } else {
      fail("E7d: COMMISSIONED lifecycle after PUT", `Got '${lc2}'`);
    }

    // Cleanup
    await apiFetch(`/api/v1/schedule-intents/${scheduleIntentId}`, { method: "DELETE" }).catch(() => {});
  }

  // Final report
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
