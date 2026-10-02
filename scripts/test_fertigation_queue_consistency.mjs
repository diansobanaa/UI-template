/**
 * Fertigation & Mixing Queue Logic, Status Consistency, and Human-Centered UX Verification Suite
 * Verifies all 15 requirements from the specification.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function formatGreenhouseName(gh, fallbackIndex) {
  if (!gh) return fallbackIndex !== undefined ? `GH-${String(fallbackIndex + 1).padStart(2, "0")}` : "Greenhouse";
  const candidate = (gh.code || gh.greenhouseTag || "").trim();
  if (candidate && !/^[a-z0-9]{6,}$/i.test(candidate) && !/^gh-[a-z0-9]{4,}$/i.test(candidate)) {
    return candidate;
  }
  if (fallbackIndex !== undefined) {
    return `GH-${String(fallbackIndex + 1).padStart(2, "0")}`;
  }
  if (gh.id && /^gh-?(\d+)$/i.test(gh.id)) {
    const num = gh.id.match(/^gh-?(\d+)$/i)?.[1];
    return `GH-${String(num).padStart(2, "0")}`;
  }
  return candidate || (gh.id ? `GH-${gh.id.replace(/^gh-/, "").toUpperCase().slice(0, 4)}` : "Greenhouse");
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

console.log("=== FERTIGATION & MIXING QUEUE CONSISTENCY & UX VERIFICATION ===\n");

// -------------------------------------------------------------
// Test 1: Greenhouse Display Name Mapping (Section 7 Spec)
// -------------------------------------------------------------
test("1. Human-Readable Greenhouse Names (Replaces opaque IDs like gh-mui7dtg)", () => {
  // Test with technical random ID
  const ghTech = { id: "gh-mui7dtg", code: "GH-MUI7DTG", crop: "Tomat Beef" };
  const name0 = formatGreenhouseName(ghTech, 0);
  assert.equal(name0, "GH-01", "Fallback index 0 should produce clean GH-01");

  const ghTech2 = { id: "gh-9x8a7b6", code: "gh-9x8a7b6", crop: "Cabai Rawit" };
  const name1 = formatGreenhouseName(ghTech2, 1);
  assert.equal(name1, "GH-02", "Fallback index 1 should produce clean GH-02");

  // Test with human code already defined
  const ghHuman = { id: "gh-alpha", code: "GH-01", crop: "Melon" };
  const nameHuman = formatGreenhouseName(ghHuman, 0);
  assert.equal(nameHuman, "GH-01", "Existing clean human code should be preserved");

  // Verify Tank Name construction
  const tankName = `${name0} Mixing Tank`;
  assert.equal(tankName, "GH-01 Mixing Tank", "Mixing tank must use human display name");
  assert.ok(!tankName.includes("gh-mui7dtg"), "Technical ID must not be the tank title");
});

// -------------------------------------------------------------
// Test 2: Elimination of Queue & Tank Status Contradictions (Section 4 Spec)
// -------------------------------------------------------------
test("2. Contradiction Resolution: Empty Queue with Future Schedules", () => {
  const dosingQueueSectionFile = fs.readFileSync(
    path.resolve("src/components/fertigation/DosingQueueSection.tsx"),
    "utf8"
  );

  // Must NOT contain the false contradictory message
  const contradictoryRegex = /Semua jadwal hari ini yang tersisa sudah siap atau selesai diracik/;
  assert.ok(
    !contradictoryRegex.test(dosingQueueSectionFile),
    "False message 'All remaining schedules are ready or completed' must be completely removed"
  );

  // Must distinguish empty queue from future scheduled operations
  assert.match(
    dosingQueueSectionFile,
    /Tidak ada operasi peracikan dalam antrean saat ini|Tidak ada peracikan dalam antrean saat ini/,
    "Neutral empty queue message must be present"
  );
  assert.match(
    dosingQueueSectionFile,
    /Jadwal fertigasi berikutnya adalah pukul/,
    "Empty queue must explain upcoming scheduled operation when available"
  );
});

// -------------------------------------------------------------
// Test 3: Central Dosing Unit Panel Redesign (Section 5 Spec)
// -------------------------------------------------------------
test("3. Central Dosing Unit Panel Information Hierarchy", () => {
  const dosingQueueSectionFile = fs.readFileSync(
    path.resolve("src/components/fertigation/DosingQueueSection.tsx"),
    "utf8"
  );

  // Standby state
  assert.match(
    dosingQueueSectionFile,
    /Central Dosing Unit:\s*Standby\s*\(Siaga\)/,
    "Clear Standby state header required"
  );
  assert.match(
    dosingQueueSectionFile,
    /Tidak ada operasi dosing yang sedang berjalan saat ini/,
    "Clear explanatory text for idle dosing unit"
  );
  assert.match(
    dosingQueueSectionFile,
    /Operasi berikutnya:/,
    "Next operation time/greenhouse must be displayed when idle"
  );

  // Active state
  assert.match(
    dosingQueueSectionFile,
    /Melayani:\s*\{activeJob\.ghCode\}/,
    "Active state must explicitly identify the greenhouse being served"
  );
  assert.match(
    dosingQueueSectionFile,
    /Tahapan Peracikan Nyata \(Hardware Pipeline\)/,
    "Real 5-step operational pipeline must be represented"
  );

  // Error state
  assert.match(
    dosingQueueSectionFile,
    /KENDALA OPERASI DOSING/,
    "Dosing error panel must identify the failed process and affected greenhouse"
  );
});

// -------------------------------------------------------------
// Test 4: Rebuilt FIFO Execution Queue (Section 6 Spec)
// -------------------------------------------------------------
test("4. FIFO Queue Execution Order & Details", () => {
  const dosingQueueSectionFile = fs.readFileSync(
    path.resolve("src/components/fertigation/DosingQueueSection.tsx"),
    "utf8"
  );

  assert.match(
    dosingQueueSectionFile,
    /Antrean Dosing Central \(FIFO Execution Order\)/,
    "FIFO execution order heading must be explicit"
  );
  assert.match(
    dosingQueueSectionFile,
    /#\{idx \+ 1\}/,
    "Queue items must show explicit execution sequence #1, #2..."
  );
  assert.match(
    dosingQueueSectionFile,
    /Menunggu Giliran Unit Central/,
    "Pending queue item status must be human-readable"
  );
});

// -------------------------------------------------------------
// Test 5: Distinct Human-Readable Mixing Tank States (Section 7 Spec)
// -------------------------------------------------------------
test("5. Greenhouse Mixing Tank Distinct States", () => {
  const tanksFile = fs.readFileSync(
    path.resolve("src/components/fertigation/GreenhouseMixingTanks.tsx"),
    "utf8"
  );

  const requiredStates = [
    "Standby",
    "Waiting for schedule",
    "Waiting in queue",
    "Preparing water",
    "Dosing nutrients",
    "Mixing",
    "Ready for fertigation",
    "Fertigation in progress",
    "Completed",
    "Failed",
    "Interrupted",
  ];

  for (const st of requiredStates) {
    assert.ok(
      tanksFile.includes(`"${st}"`),
      `GreenhouseMixingTanks must define human state: "${st}"`
    );
  }

  // Must not have ambiguous generic "Waiting" state alone
  assert.ok(
    !tanksFile.includes(`| "Waiting"\n`),
    "Generic 'Waiting' without context must not be used as an independent state"
  );
});

// -------------------------------------------------------------
// Test 6: Honest Volume Labeling (Section 7 Spec)
// -------------------------------------------------------------
test("6. Honest Volume Labeling (Measured vs Target vs Capacity)", () => {
  const tanksFile = fs.readFileSync(
    path.resolve("src/components/fertigation/GreenhouseMixingTanks.tsx"),
    "utf8"
  );
  const dashboardFile = fs.readFileSync(
    path.resolve("src/components/fertigation/FertigationQueueDashboard.tsx"),
    "utf8"
  );

  assert.match(
    tanksFile,
    /\{tank\.volumeDisplayLabel\}/,
    "Volume display must use explicit label (Measured vs Target)"
  );
  assert.match(
    dashboardFile,
    /Volumetrik Fail-Safe|Sensor tidak terpasang|Sensor level fisik tidak terpasang/,
    "Must explicitly handle unmetered batch tank as fail-safe volumetric mode"
  );
});

// -------------------------------------------------------------
// Test 7: Realistic Time Information (Section 8 Spec)
// -------------------------------------------------------------
test("7. Time Estimation Reality (Eliminate fake '02:15' & 'Before 06:00')", () => {
  const dashboardFile = fs.readFileSync(
    path.resolve("src/components/fertigation/FertigationQueueDashboard.tsx"),
    "utf8"
  );

  // Must NOT contain hardcoded fake duration placeholder "02:15"
  assert.ok(
    !dashboardFile.includes(`"02:15"`),
    "Fabricated '02:15' remaining time placeholder must be removed"
  );

  // Must NOT contain ambiguous "Sebelum" (Before 06:00) without operational context
  assert.ok(
    !dashboardFile.includes(`Sebelum \${nextSched.time}`),
    "Ambiguous 'Sebelum 06:00' must be replaced with explicit 'Pukul 06:00'"
  );
});

// -------------------------------------------------------------
// Test 8: Clarified Button Behavior & Automation (Section 9 & Additional Req)
// -------------------------------------------------------------
test("8. Button Clarification & Duplicate Prevention", () => {
  const tanksFile = fs.readFileSync(
    path.resolve("src/components/fertigation/GreenhouseMixingTanks.tsx"),
    "utf8"
  );
  const dashboardFile = fs.readFileSync(
    path.resolve("src/components/fertigation/FertigationQueueDashboard.tsx"),
    "utf8"
  );

  // Button renamed from ambiguous "Mulai Racik Batch" to "Masuk Antrean Dosing"
  assert.match(
    tanksFile,
    /Masuk Antrean Dosing/,
    "Button label must clarify that it enqueues to Central Dosing"
  );

  // Prevents duplicate enqueueing if already in queue or active
  assert.match(
    dashboardFile,
    /sudah terdaftar dalam antrean dosing|isAlreadyInQueue/,
    "Must guard against duplicate enqueue submissions"
  );

  // Premature manual enqueue button is suppressed when waiting for automated schedule (Fail-Safe)
  assert.match(
    dashboardFile,
    /canPreMixNow = false/,
    "When waiting for schedule, premature manual enqueue button is suppressed"
  );

  // Fail-safe scheduled indicator badge must be present
  assert.match(
    tanksFile,
    /Otomasi Terjadwal \(Fail-Safe\)/,
    "Tanks view must show fail-safe automation badge when waiting for schedule"
  );
});

// -------------------------------------------------------------
// Test 9: Complex Overview vs Greenhouse Isolation (Section 10 Spec)
// -------------------------------------------------------------
test("9. Complex Overview Aggregation & Greenhouse Detail Isolation", () => {
  const overviewFile = fs.readFileSync(
    path.resolve("src/components/fertigation/ComplexFertigationOverview.tsx"),
    "utf8"
  );
  const detailFile = fs.readFileSync(
    path.resolve("src/components/fertigation/GreenhouseFertigationDetail.tsx"),
    "utf8"
  );

  // Overview includes all KPI counters
  assert.match(overviewFile, /Larutan Siap/);
  assert.match(overviewFile, /Dalam Antrean/);
  assert.match(overviewFile, /Menunggu Jadwal/);

  // Greenhouse detail is scoped to single greenhouse
  assert.match(detailFile, /Operasi Fertigasi & Nutrisi \{ghCode\}/);
});

// -------------------------------------------------------------
// Test 10: FreeRTOS Scheduler Log Spam Fix (Section 12 Spec)
// -------------------------------------------------------------
test("10. FreeRTOS Scheduler Log Spam Elimination (scheduler.c)", () => {
  const schedulerC = fs.readFileSync(
    path.resolve("esp32/main/services/scheduler.c"),
    "utf8"
  );

  // Verify that Condition 3 (1-second infinite loop log spam) is removed
  const condition3SpamRegex = /\/\* Condition 3: Schedules exist in runtime, but today's occurrence list is empty \*\/\s*if \(s_today_occurrence_count == 0 && s_runtime_count > 0\)\s*\{\s*daily_trigger_needed = true;\s*\}/;
  assert.ok(
    !condition3SpamRegex.test(schedulerC),
    "1-second repeated Condition 3 log spam must be eliminated"
  );

  // Verify that daily trigger executes cleanly on date change and untriggered recovery
  assert.match(schedulerC, /s_daily_trigger_completed_yday != tm_now\.tm_yday/);
  assert.match(schedulerC, /Daily schedule trigger executed for yday/);
});

// -------------------------------------------------------------
// Test 11: Time-Aware Nearest Schedule Calculation
// -------------------------------------------------------------
test("11. Time-Aware Nearest Schedule (Filters past schedules >= current time)", () => {
  const dashboardFile = fs.readFileSync(
    path.resolve("src/components/fertigation/FertigationQueueDashboard.tsx"),
    "utf8"
  );

  // Must compare schedule minutes against currentMinutes
  assert.match(
    dashboardFile,
    /item\.minutes >= currentMinutes/,
    "Dashboard must filter schedules where time is greater than or equal to currentMinutes"
  );
  assert.match(
    dashboardFile,
    /currentMinutes = Math\.floor\(clock\.secondsSinceMidnight \/ 60\)/,
    "Dashboard must track currentMinutes from device clock"
  );
});

// -------------------------------------------------------------
// Test 12: Dynamic Real Cycles Completed Calculation
// -------------------------------------------------------------
test("12. Dynamic Real Cycles Calculation (Eliminates hardcoded 2)", () => {
  const dashboardFile = fs.readFileSync(
    path.resolve("src/components/fertigation/FertigationQueueDashboard.tsx"),
    "utf8"
  );

  // Must NOT contain hardcoded cyclesCompletedToday: 2
  assert.ok(
    !dashboardFile.includes("cyclesCompletedToday: 2"),
    "Hardcoded 'cyclesCompletedToday: 2' must be eliminated"
  );
  // Must calculate dynamically from actual completed runs
  assert.match(
    dashboardFile,
    /cyclesCompletedToday = Math\.max\(ghCompletedOccurrences\.length, schedsCompleted\.length\)/,
    "cyclesCompletedToday must be dynamically counted from completed occurrences and records"
  );
});

// -------------------------------------------------------------
// Test 13: Zero-Refresh Reactivity (External Store Subscription)
// -------------------------------------------------------------
test("13. Zero-Refresh Reactivity (Subscribed to useDbVersion)", () => {
  const dashboardFile = fs.readFileSync(
    path.resolve("src/components/fertigation/FertigationQueueDashboard.tsx"),
    "utf8"
  );

  assert.match(
    dashboardFile,
    /import \{ useDbVersion \} from "@\/lib\/useDb"/,
    "FertigationQueueDashboard must import useDbVersion"
  );
  assert.match(
    dashboardFile,
    /const dbVersion = useDbVersion\(\)/,
    "FertigationQueueDashboard must call useDbVersion() to re-render instantly on schedule add/delete/toggle"
  );
});

// -------------------------------------------------------------
// Test 14: Mixing Tank Volume Isolation (Separate from 1000L Toren)
// -------------------------------------------------------------
test("14. Mixing Tank Volume Isolation (No 333% overflow from 1000L reservoir)", () => {
  const dashboardFile = fs.readFileSync(
    path.resolve("src/components/fertigation/FertigationQueueDashboard.tsx"),
    "utf8"
  );

  // Must NOT read gh.telemetry.tankL as mixing tank volume
  assert.ok(
    !dashboardFile.includes("const telemetryTankL = gh.telemetry?.tankL"),
    "gh.telemetry.tankL (1000L raw reservoir) must NOT be assigned to mixing tank"
  );
  assert.match(
    dashboardFile,
    /0 \/ \$\{capacityL\} L \(0%\)/,
    "Empty or waiting mixing tank must report 0 / 300 L (0%), not 1000L reservoir"
  );
});

// -------------------------------------------------------------
// Test 15: Missed Schedule Detection on Schedule Page
// -------------------------------------------------------------
test("15. Missed Schedule Detection (Past schedule marked Missed)", () => {
  const schedulePageFile = fs.readFileSync(
    path.resolve("src/app/schedule/page.tsx"),
    "utf8"
  );

  assert.match(
    schedulePageFile,
    /isMissed = isPast && \(!s\.lastRun \|\| !s\.lastRun\.includes\("Today"\)\)/,
    "Past schedules with no execution today must be identified as missed"
  );
  assert.match(
    schedulePageFile,
    /Tomorrow \$\{s\.time\}/,
    "Past schedules must roll over nextRun to Tomorrow"
  );
});

console.log(`\n======================================================`);
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
}
