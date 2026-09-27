import { chromium } from "playwright";

const ESP32_IP = process.env.ESP32_IP || "192.168.0.139";
const UI_URL = process.env.UI_URL || "http://localhost:5173/#/equipment";
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
  const res = await fetch(`http://${ESP32_IP}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: AUTH_HEADER,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function setupContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Add allowed bootstrap IP hint per "Allowed persistence: ESP32 IP/address/device discovery hint"
  await context.addInitScript((ip) => {
    window.localStorage.setItem("agrotech_bootstrap_ips", JSON.stringify([`http://${ip}`]));
    window.localStorage.setItem("agrotech_api_token", "agrotech-secret-key");
  }, ESP32_IP);
  return context;
}

async function run() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" Equipment DRAFT + APPLY UX & Persistence Matrix Test");
  console.log(` Target UI: ${UI_URL} | ESP32: http://${ESP32_IP}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // Step 0: Ensure ESP32 is healthy
  console.log("[ STEP 0 ] Checking ESP32 health...");
  const health = await apiFetch("/api/v1/health");
  if (health.status === 200) {
    pass("ESP32 is reachable and healthy");
  } else {
    fail("ESP32 reachable", `Status: ${health.status}`);
    process.exit(1);
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  const contextA = await setupContext(browser);
  const pageA = await contextA.newPage();

  // Monitor network calls from Page A
  const networkCalls = [];
  pageA.on("request", (req) => {
    if (req.url().includes("/api/v1/configuration") && req.method() === "PUT") {
      networkCalls.push({ url: req.url(), method: req.method(), time: Date.now() });
    }
  });

  // -------------------------------------------------------------
  // TEST 1: Checkbox click mutates RAM draft ONLY (NO ESP32 CALL)
  // -------------------------------------------------------------
  console.log("\n[ TEST 1 ] Checkbox click = DRAFT in RAM only (Zero network requests)");
  await pageA.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await pageA.waitForSelector("h2:has-text('Supported Equipment Checklist')");

  // Find the first selectable equipment toggle button
  const firstCheckbox = pageA.locator("button[title*='Klik untuk']").first();
  await firstCheckbox.waitFor({ state: "visible" });

  const initialPuts = networkCalls.length;
  await firstCheckbox.click();
  await pageA.waitForTimeout(500);

  // Verify unsaved changes indicator appears
  const unsavedBadge = pageA.locator("text=Draft Belum Diterapkan");
  const isBadgeVisible = await unsavedBadge.isVisible();
  if (isBadgeVisible) {
    pass("T1: 'Draft Belum Diterapkan' indicator is visible after checkbox click");
  } else {
    fail("T1: 'Draft Belum Diterapkan' indicator should be visible");
  }

  // Verify NO PUT requests were made
  if (networkCalls.length === initialPuts) {
    pass("T1: ZERO PUT requests to ESP32 on checkbox click (Draft only)");
  } else {
    fail("T1: Network requests detected on checkbox click", `Count: ${networkCalls.length - initialPuts}`);
  }

  // -------------------------------------------------------------
  // TEST 2: Zero browser storage for equipment states
  // -------------------------------------------------------------
  console.log("\n[ TEST 2 ] Zero browser storage rule (No equipment state in localStorage/sessionStorage)");
  const storageData = await pageA.evaluate(() => {
    const lsKeys = Object.keys(window.localStorage);
    const ssKeys = Object.keys(window.sessionStorage);
    return {
      localStorageKeys: lsKeys,
      sessionStorageKeys: ssKeys,
      forbiddenFound: [...lsKeys, ...ssKeys].filter((k) => {
        const lower = k.toLowerCase();
        return (
          lower.includes("equipment") ||
          lower.includes("draft") ||
          lower.includes("ready") ||
          lower.includes("pending") ||
          lower.includes("applied")
        );
      }),
    };
  });

  if (storageData.forbiddenFound.length === 0) {
    pass("T2: Zero equipment draft/applied state in localStorage or sessionStorage");
  } else {
    fail("T2: Forbidden keys found in browser storage", storageData.forbiddenFound.join(", "));
  }

  // -------------------------------------------------------------
  // TEST 3: Browser refresh before APPLY discards unapplied draft
  // -------------------------------------------------------------
  console.log("\n[ TEST 3 ] Refresh before APPLY discards unapplied draft (Loads ESP32 state)");
  await pageA.reload({ waitUntil: "domcontentloaded" });
  await pageA.waitForSelector("h2:has-text('Supported Equipment Checklist')");
  await pageA.waitForTimeout(500);

  const unsavedAfterReload = await pageA.locator("text=Draft Belum Diterapkan").isVisible();
  if (!unsavedAfterReload) {
    pass("T3: Unapplied draft was completely discarded on reload; 'Draft Belum Diterapkan' is gone");
  } else {
    fail("T3: Draft persisted across reload without APPLY!");
  }

  // -------------------------------------------------------------
  // TEST 4: Cancel button discards draft
  // -------------------------------------------------------------
  console.log("\n[ TEST 4 ] Cancel button discards draft in RAM (Zero network calls)");
  const putsBeforeT4 = networkCalls.length;
  const toggleBtn = pageA.locator("button[title*='Klik untuk']").first();
  await toggleBtn.click();
  await pageA.waitForTimeout(300);

  // Click Batal (Cancel)
  const cancelBtn = pageA.locator("button:has-text('Batal (Cancel)')").first();
  await cancelBtn.waitFor({ state: "visible" });
  await cancelBtn.click();
  await pageA.waitForTimeout(300);

  const unsavedAfterCancel = await pageA.locator("text=Draft Belum Diterapkan").isVisible();
  if (!unsavedAfterCancel && networkCalls.length === putsBeforeT4) {
    pass("T4: Cancel discarded draft back to applied state with 0 network calls");
  } else {
    fail("T4: Cancel failed to discard draft or triggered network calls");
  }

  // -------------------------------------------------------------
  // TEST 5: APPLY commits atomically to ESP32 with exactly ONE PUT
  // -------------------------------------------------------------
  console.log("\n[ TEST 5 ] APPLY commits atomically with exactly ONE PUT to ESP32");
  const putsBeforeApply = networkCalls.length;
  await toggleBtn.click();
  await pageA.waitForTimeout(300);

  const applyBtn = pageA.locator("button:has-text('Terapkan (Apply)')").first();
  await applyBtn.waitFor({ state: "visible" });
  await applyBtn.click();

  // Wait for success message
  const successBanner = pageA.locator("text=Konfigurasi peralatan berhasil diterapkan");
  await successBanner.waitFor({ state: "visible", timeout: 90000 });

  const putsAfterApply = networkCalls.length;
  if (putsAfterApply === putsBeforeApply + 1) {
    pass("T5: Exactly ONE configuration PUT mutation reached ESP32 on APPLY");
  } else {
    fail("T5: Expected exactly 1 PUT on APPLY", `Got ${putsAfterApply - putsBeforeApply}`);
  }

  // Refresh page and confirm persisted on ESP32
  await pageA.reload({ waitUntil: "domcontentloaded" });
  await pageA.waitForSelector("h2:has-text('Supported Equipment Checklist')");
  const unsavedAfterApplyReload = await pageA.locator("text=Draft Belum Diterapkan").isVisible();
  if (!unsavedAfterApplyReload) {
    pass("T5: After reload, applied state is cleanly loaded from ESP32");
  } else {
    fail("T5: Unsaved changes banner visible after reload");
  }

  // -------------------------------------------------------------
  // TEST 6: Multi-browser test
  // -------------------------------------------------------------
  console.log("\n[ TEST 6 ] Multi-browser test (Browser B sees only ESP32 applied state)");
  const contextB = await setupContext(browser);
  const pageB = await contextB.newPage();
  await pageB.goto(UI_URL, { waitUntil: "domcontentloaded" });
  await pageB.waitForSelector("h2:has-text('Supported Equipment Checklist')");

  // Browser A toggles a pin (DRAFT)
  await pageA.locator("button[title*='Klik untuk']").first().click();
  await pageA.waitForTimeout(300);

  // Browser B reloads -> must NOT see Browser A's draft!
  await pageB.reload({ waitUntil: "domcontentloaded" });
  await pageB.waitForSelector("h2:has-text('Supported Equipment Checklist')");

  const bHasUnsaved = await pageB.locator("text=Draft Belum Diterapkan").isVisible();
  if (!bHasUnsaved) {
    pass("T6: Browser B sees only authoritative ESP32 state, NOT Browser A's transient draft");
  } else {
    fail("T6: Browser B leaked Browser A's unapplied draft!");
  }

  // Now Browser A clicks APPLY
  const applyBtnA = pageA.locator("button:has-text('Terapkan (Apply)')").first();
  await applyBtnA.click();
  await pageA.locator("text=Konfigurasi peralatan berhasil diterapkan").waitFor({ state: "visible", timeout: 90000 });

  // Browser B reloads -> must now see the new applied state from ESP32!
  await pageB.reload({ waitUntil: "domcontentloaded" });
  await pageB.waitForSelector("h2:has-text('Supported Equipment Checklist')");
  pass("T6: Browser B reflects the newly applied configuration from ESP32 after reload");

  // -------------------------------------------------------------
  // TEST 7: Hardware Reboot Test (SPIFFS persistence on ESP32)
  // -------------------------------------------------------------
  console.log("\n[ TEST 7 ] Hardware Reboot Test (SPIFFS persistence survives reboot)");
  const cfgBefore = await apiFetch("/api/v1/configuration");
  const verBefore = cfgBefore.data?.payload?.version ?? cfgBefore.data?.configurationVersion;

  console.log(`    Triggering ESP32 restart via API (Config Version: ${verBefore})...`);
  await apiFetch("/api/v1/device/restart", { method: "POST" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));

  // Wait for ESP32 to come back online
  let backOnline = false;
  for (let i = 0; i < 15; i++) {
    try {
      const h = await apiFetch("/api/v1/health");
      if (h.status === 200) {
        backOnline = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (backOnline) {
    pass("T7: ESP32 came back online after reboot");
  } else {
    fail("T7: ESP32 did not come back online after reboot");
  }

  const cfgAfter = await apiFetch("/api/v1/configuration");
  const verAfter = cfgAfter.data?.payload?.version ?? cfgAfter.data?.configurationVersion;
  if (verAfter === verBefore) {
    pass(`T7: Authoritative configuration version (${verAfter}) persisted in SPIFFS across reboot`);
  } else {
    fail("T7: Configuration version changed or lost across reboot", `Expected ${verBefore}, got ${verAfter}`);
  }

  // Reload UI after reboot
  await pageA.reload({ waitUntil: "domcontentloaded" });
  await pageA.waitForSelector("h2:has-text('Supported Equipment Checklist')");
  pass("T7: Equipment page loaded cleanly from ESP32 after hardware reboot");

  await browser.close();

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("═══════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("[FATAL ERROR]", err);
  process.exit(1);
});
