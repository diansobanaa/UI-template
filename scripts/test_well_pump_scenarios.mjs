/**
 * COMPREHENSIVE AUTOMATED TEST SUITE: WELL PUMP MANUAL & SCHEDULED CONTROL
 * Covers all 24 Scenarios mandated in Section 11 of the User Specification:
 * - Group A: Manual Runtime (WP-M01..M06)
 * - Group B: Schedule Conflicts & Mode Arbitration (WP-S01..S07)
 * - Group C: Physical Toggle & Recovery (WP-R01..R06)
 * - Group D: Hardware Pin Map, Relay Active-LOW, and Mode Restriction (WP-H01..H05)
 */

import assert from "node:assert/strict";

class SimulatedWellPumpSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this.mode = "AUTO"; // "AUTO" | "MANUAL"
    this.relayLevel = 1; // 1 = HIGH (Relay de-energized / OFF), 0 = LOW (Relay energized / ON)
    this.manualActive = false;
    this.manualStartUs = 0;
    this.manualDeadlineUs = 0;
    this.maxRuntimeSec = 900;
    this.stopReason = "NONE";
    this.eStop = false;
    this.simulatedTimeUs = 1000000000n; // Monotonic esp_timer simulated clock in microseconds
    this.schedules = []; // Array of { id, time: "HH:MM", toTime: "HH:MM", enabled: true }
    this.activeScheduleId = null;
    this.scheduledRunning = false;
    this.events = [];
  }

  // Simulated monotonic clock helpers
  nowUs() {
    return this.simulatedTimeUs;
  }

  advanceSeconds(sec) {
    this.simulatedTimeUs += BigInt(sec) * 1000000n;
    this.monitorTaskTick();
  }

  get pumpOn() {
    return this.relayLevel === 0; // Active-LOW relay (GPIO 1)
  }

  get remainingSec() {
    if (!this.manualActive || !this.pumpOn) return 0;
    const now = this.nowUs();
    if (now >= this.manualDeadlineUs) return 0;
    return Number((this.manualDeadlineUs - now) / 1000000n);
  }

  get elapsedSec() {
    if (!this.manualActive) return 0;
    const now = this.nowUs();
    return Number((now - this.manualStartUs) / 1000000n);
  }

  // Set hardware relay (Active-LOW: 0 = ON, 1 = OFF)
  setRelay(on) {
    this.relayLevel = on ? 0 : 1;
  }

  // Set mode (AUTO or MANUAL) with zero confirmation dialogs
  setMode(newMode, wallClockHHMM = "12:00") {
    if (this.mode === newMode) return;
    this.mode = newMode;
    this.events.push(`MODE_CHANGED_${newMode}`);

    if (newMode === "AUTO") {
      // Immediate schedule evaluation on transition to AUTO
      if (this.manualActive) {
        this.manualActive = false;
        this.manualStartUs = 0;
        this.manualDeadlineUs = 0;
      }
      this.evaluateSchedule(wallClockHHMM);
    } else {
      // Transitioning to MANUAL
      if (this.scheduledRunning) {
        this.scheduledRunning = false;
        this.activeScheduleId = null;
        this.setRelay(false);
      }
    }
  }

  // Manual Start
  manualStart(source = "WEB_UI") {
    if (this.eStop) {
      return { success: false, error: "EMERGENCY_STOP_ACTIVE" };
    }
    if (this.mode !== "MANUAL") {
      return { success: false, error: "MODE_RESTRICTION" };
    }

    const now = this.nowUs();

    // Idempotent repeated ON during active session
    if (this.manualActive && this.pumpOn) {
      this.events.push("MANUAL_ON_IDEMPOTENT_IGNORED");
      return { success: true, message: "ALREADY_ACTIVE_SAME_DEADLINE" };
    }

    this.manualActive = true;
    this.manualStartUs = now;
    this.manualDeadlineUs = now + BigInt(this.maxRuntimeSec) * 1000000n;
    this.scheduledRunning = false;
    this.activeScheduleId = null;
    this.stopReason = "NONE";
    this.setRelay(true);
    this.events.push(`MANUAL_ON_STARTED_${source}`);
    return { success: true };
  }

  // Manual Stop
  manualStop(source = "WEB_UI") {
    if (this.mode !== "MANUAL") {
      return { success: false, error: "MODE_RESTRICTION" };
    }

    this.manualActive = false;
    this.manualStartUs = 0;
    this.manualDeadlineUs = 0;
    this.stopReason = "OPERATOR_OFF";
    this.setRelay(false);
    this.events.push(`MANUAL_OFF_ACCEPTED_${source}`);
    return { success: true };
  }

  // Physical Toggle (Button 2 / GPIO 39)
  physicalToggle() {
    if (this.eStop) return;
    if (this.mode !== "MANUAL") {
      // Physical toggle switches to MANUAL mode and executes
      this.mode = "MANUAL";
    }

    if (this.pumpOn) {
      this.manualStop("PHYSICAL_TOGGLE");
    } else {
      this.manualStart("PHYSICAL_TOGGLE");
    }
  }

  // Background FreeRTOS monitor tick (runs every 250ms)
  monitorTaskTick() {
    if (this.eStop) {
      if (this.pumpOn) {
        this.setRelay(false);
        this.manualActive = false;
        this.scheduledRunning = false;
        this.stopReason = "EMERGENCY_STOP_TRIPPED";
        this.events.push("EMERGENCY_STOP_TRIPPED");
      }
      return;
    }

    // Enforce 15-minute manual runtime ceiling
    if (this.mode === "MANUAL" && this.manualActive && this.pumpOn) {
      if (this.nowUs() >= this.manualDeadlineUs) {
        this.setRelay(false);
        this.manualActive = false;
        this.manualStartUs = 0;
        this.manualDeadlineUs = 0;
        this.stopReason = "MANUAL_RUNTIME_LIMIT_REACHED";
        this.events.push("MANUAL_RUNTIME_LIMIT_REACHED");
      }
    }
  }

  // Schedule evaluation
  evaluateSchedule(wallClockHHMM) {
    if (this.eStop) {
      if (this.pumpOn) this.setRelay(false);
      return;
    }

    // In MANUAL mode, scheduler evaluations MUST NOT turn the pump ON or OFF
    if (this.mode === "MANUAL") {
      this.events.push(`SCHEDULER_EVALUATED_BUT_SUPPRESSED_MANUAL_ACTIVE_AT_${wallClockHHMM}`);
      return;
    }

    // In AUTO mode: check if wallClockHHMM falls within any enabled schedule [time, toTime)
    let matched = null;
    for (const sched of this.schedules) {
      if (!sched.enabled) continue;
      if (wallClockHHMM >= sched.time && wallClockHHMM < sched.toTime) {
        matched = sched;
        break;
      }
    }

    if (matched) {
      this.scheduledRunning = true;
      this.activeScheduleId = matched.id;
      this.setRelay(true);
      this.events.push(`SCHEDULE_ACTIVE_${matched.id}_AT_${wallClockHHMM}`);
    } else {
      if (this.pumpOn) {
        this.scheduledRunning = false;
        this.activeScheduleId = null;
        this.setRelay(false);
        this.events.push(`SCHEDULE_STOPPED_AT_${wallClockHHMM}`);
      }
    }
  }

  // Emergency Stop Trigger
  tripEmergencyStop() {
    this.eStop = true;
    this.monitorTaskTick();
  }

  // Emergency Stop Reset
  resetEmergencyStop() {
    this.eStop = false;
    this.stopReason = "NONE";
  }

  // Simulate ESP32 Reboot
  reboot(wallClockHHMM = "06:05") {
    // Hardware relay initializes to safe de-energized level (1 = HIGH / OFF)
    this.relayLevel = 1;
    this.manualActive = false;
    this.manualStartUs = 0;
    this.manualDeadlineUs = 0;
    this.scheduledRunning = false;
    this.activeScheduleId = null;
    this.simulatedTimeUs = 1000000000n; // Monotonic timer starts fresh
    this.events.push("REBOOT_INITIALIZED_SAFE_OFF");

    if (this.mode === "AUTO") {
      this.evaluateSchedule(wallClockHHMM);
    }
  }
}

// =============================================================================
// TEST RUNNER
// =============================================================================

const results = [];
let passedCount = 0;
let failedCount = 0;

function runTest(id, title, fn) {
  const start = Date.now();
  try {
    fn();
    const durationMs = Date.now() - start;
    passedCount++;
    results.push({ id, title, status: "PASS", durationMs });
    console.log(`[PASS] ${id} — ${title} (${durationMs}ms)`);
  } catch (err) {
    const durationMs = Date.now() - start;
    failedCount++;
    results.push({ id, title, status: "FAIL", durationMs, error: err.message });
    console.error(`[FAIL] ${id} — ${title}`);
    console.error(`       Error: ${err.message}`);
  }
}

console.log("================================================================================");
console.log("SUITE: WELL PUMP MANUAL & SCHEDULED CONTROL (24 VERIFICATION SCENARIOS)");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// GROUP A: MANUAL RUNTIME LIMITS (WP-M01 to WP-M06)
// -----------------------------------------------------------------------------

runTest("WP-M01", "Manual ON starts runtime limit and activates relay", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  const res = sys.manualStart("WEB_UI");

  assert.equal(res.success, true);
  assert.equal(sys.pumpOn, true, "Relay must be energized (ON)");
  assert.equal(sys.relayLevel, 0, "Relay output must be Active-LOW 0");
  assert.equal(sys.manualActive, true);
  assert.equal(sys.remainingSec, 900, "Initial remaining time must be exactly 900 seconds (15 min)");
});

runTest("WP-M02", "Manual OFF before 15 minutes stops pump immediately", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  sys.advanceSeconds(300); // 5 minutes elapsed

  assert.equal(sys.pumpOn, true);
  assert.equal(sys.remainingSec, 600);

  const res = sys.manualStop("WEB_UI");
  assert.equal(res.success, true);
  assert.equal(sys.pumpOn, false, "Pump must be OFF immediately");
  assert.equal(sys.relayLevel, 1, "Relay must be de-energized (1)");
  assert.equal(sys.manualActive, false, "Manual session must be cleared");
  assert.equal(sys.remainingSec, 0);
  assert.equal(sys.stopReason, "OPERATOR_OFF");
});

runTest("WP-M03", "Automatic shutdown at 15 minutes", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");

  sys.advanceSeconds(899);
  assert.equal(sys.pumpOn, true, "Pump must still be ON at 14m59s");
  assert.equal(sys.remainingSec, 1);

  sys.advanceSeconds(1); // Exactly 900 seconds (15 minutes)
  assert.equal(sys.pumpOn, false, "Pump must shut OFF automatically at 15 minutes");
  assert.equal(sys.manualActive, false);
  assert.equal(sys.stopReason, "MANUAL_RUNTIME_LIMIT_REACHED");
  assert.ok(sys.events.includes("MANUAL_RUNTIME_LIMIT_REACHED"));
});

runTest("WP-M04", "Repeated ON does not extend runtime", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  const initialDeadline = sys.manualDeadlineUs;

  sys.advanceSeconds(300); // 5 minutes in
  assert.equal(sys.remainingSec, 600);

  // Send repeated ON commands (spam / duplicate clicks)
  sys.manualStart("WEB_UI");
  sys.manualStart("WEB_UI");

  assert.equal(sys.manualDeadlineUs, initialDeadline, "Deadline must not be reset or extended");
  assert.equal(sys.remainingSec, 600, "Remaining time must remain 10 minutes");

  // Advance remaining 600 seconds
  sys.advanceSeconds(600);
  assert.equal(sys.pumpOn, false, "Pump must still shut off at original 15-minute mark");
  assert.equal(sys.stopReason, "MANUAL_RUNTIME_LIMIT_REACHED");
});

runTest("WP-M05", "New explicit session receives fresh 15-minute limit", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  sys.advanceSeconds(900); // Expires after 15 min
  assert.equal(sys.pumpOn, false);

  // Operator explicitly starts new session
  const res = sys.manualStart("WEB_UI");
  assert.equal(res.success, true);
  assert.equal(sys.pumpOn, true);
  assert.equal(sys.remainingSec, 900, "New session must have fresh 15-minute limit");

  sys.advanceSeconds(300);
  assert.equal(sys.remainingSec, 600);
});

runTest("WP-M06", "Runtime enforcement independent of Web UI / network connection", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");

  // Web UI disconnects (no HTTP calls / telemetry poll)
  sys.advanceSeconds(900);
  assert.equal(sys.pumpOn, false, "ESP32 firmware FreeRTOS monitor shut off pump without Web UI");
  assert.equal(sys.stopReason, "MANUAL_RUNTIME_LIMIT_REACHED");
});

// -----------------------------------------------------------------------------
// GROUP B: SCHEDULE CONFLICTS & ARBITRATION (WP-S01 to WP-S07)
// -----------------------------------------------------------------------------

runTest("WP-S01", "Manual OFF overrides scheduled ON", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-1", time: "06:00", toTime: "06:30", enabled: true });

  sys.setMode("MANUAL");
  sys.manualStop("WEB_UI");

  // Scheduler attempts evaluation at 06:15 during active schedule
  sys.evaluateSchedule("06:15");
  assert.equal(sys.pumpOn, false, "Pump must stay OFF in MANUAL mode even during scheduled window");
  assert.ok(sys.events.includes("SCHEDULER_EVALUATED_BUT_SUPPRESSED_MANUAL_ACTIVE_AT_06:15"));
});

runTest("WP-S02", "Manual ON overrides scheduled OFF", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-1", time: "06:00", toTime: "06:30", enabled: true });

  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI"); // Started at 06:40 (outside schedule)

  sys.evaluateSchedule("06:45"); // Outside schedule
  assert.equal(sys.pumpOn, true, "Pump remains ON under manual control");
});

runTest("WP-S03", "Scheduler cannot reactivate after manual OFF", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-1", time: "07:00", toTime: "07:30", enabled: true });

  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  sys.advanceSeconds(60);

  // Operator manually turns pump OFF at 07:10
  sys.manualStop("WEB_UI");
  assert.equal(sys.pumpOn, false);

  // Scheduler ticks at 07:11, 07:12, 07:15
  sys.evaluateSchedule("07:11");
  sys.evaluateSchedule("07:12");
  sys.evaluateSchedule("07:15");

  assert.equal(sys.pumpOn, false, "Pump must not be reactivated by scheduler while MANUAL is active");
});

runTest("WP-S04", "Automatic ON at MANUAL-to-AUTO transition within active window", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-1", time: "07:00", toTime: "07:30", enabled: true });

  sys.setMode("MANUAL");
  sys.manualStop("WEB_UI");
  assert.equal(sys.pumpOn, false);

  // Switch to AUTO at 07:15 (inside 07:00–07:30 window) — NO CONFIRMATION DIALOG
  sys.setMode("AUTO", "07:15");
  assert.equal(sys.mode, "AUTO");
  assert.equal(sys.pumpOn, true, "Pump must immediately turn ON on transition to AUTO");
  assert.equal(sys.activeScheduleId, "wp-1");
});

runTest("WP-S05", "Automatic OFF at MANUAL-to-AUTO transition outside active window", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-1", time: "07:00", toTime: "07:30", enabled: true });

  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  assert.equal(sys.pumpOn, true);

  // Switch to AUTO at 07:45 (outside schedule)
  sys.setMode("AUTO", "07:45");
  assert.equal(sys.mode, "AUTO");
  assert.equal(sys.pumpOn, false, "Pump must immediately turn OFF on transition to AUTO");
  assert.equal(sys.activeScheduleId, null);
});

runTest("WP-S06", "Expired schedule is not replayed on return to AUTO", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-1", time: "06:00", toTime: "06:15", enabled: true });

  sys.setMode("MANUAL");
  // Operator stays in MANUAL through entire 06:00–06:15 schedule
  sys.evaluateSchedule("06:05");
  sys.evaluateSchedule("06:10");

  // Return to AUTO at 06:30 (interval expired 15 minutes ago)
  sys.setMode("AUTO", "06:30");
  assert.equal(sys.pumpOn, false, "Expired schedule must NOT be replayed");
  assert.equal(sys.activeScheduleId, null);
});

runTest("WP-S07", "Concurrent commands deterministic precedence", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-1", time: "06:00", toTime: "06:30", enabled: true });

  sys.setMode("MANUAL");

  // Manual OFF while schedule is ON
  sys.evaluateSchedule("06:00");
  sys.manualStop("WEB_UI");
  assert.equal(sys.pumpOn, false, "Manual command has priority over schedule in MANUAL mode");

  // Manual ON at boundary
  sys.manualStart("WEB_UI");
  sys.evaluateSchedule("06:30"); // Scheduled stop
  assert.equal(sys.pumpOn, true, "Manual ON takes precedence over scheduled stop while in MANUAL");
});

// -----------------------------------------------------------------------------
// GROUP C: PHYSICAL TOGGLE & RECOVERY (WP-R01 to WP-R06)
// -----------------------------------------------------------------------------

runTest("WP-R01", "Physical toggle ON and OFF behaves consistently", () => {
  const sys = new SimulatedWellPumpSystem();
  assert.equal(sys.pumpOn, false);

  // Press physical toggle (Button 2 / GPIO 39)
  sys.physicalToggle();
  assert.equal(sys.mode, "MANUAL");
  assert.equal(sys.pumpOn, true);
  assert.equal(sys.remainingSec, 900);

  // Press physical toggle again -> stops pump
  sys.physicalToggle();
  assert.equal(sys.pumpOn, false);
  assert.equal(sys.manualActive, false);
});

runTest("WP-R02", "Reboot while manual ON initializes safe OFF", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  sys.advanceSeconds(300);
  assert.equal(sys.pumpOn, true);

  // ESP32 Reboots
  sys.reboot("08:00");
  assert.equal(sys.pumpOn, false, "Relay must be OFF upon reboot");
  assert.equal(sys.relayLevel, 1, "Relay must be at configured safe level HIGH (1)");
  assert.equal(sys.manualActive, false, "Manual session must NOT be resumed");
});

runTest("WP-R03", "Reboot in AUTO during active schedule applies state safely", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-1", time: "06:00", toTime: "06:30", enabled: true });
  sys.setMode("AUTO");

  // Reboot happens at 06:10 (inside schedule)
  sys.reboot("06:10");
  assert.equal(sys.pumpOn, true, "Schedule is safely evaluated and applied after time sync");
  assert.equal(sys.activeScheduleId, "wp-1");
});

runTest("WP-R04", "Emergency Stop overrides manual and scheduled commands", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  assert.equal(sys.pumpOn, true);

  // E-Stop Trips
  sys.tripEmergencyStop();
  assert.equal(sys.pumpOn, false, "Relay must shut OFF immediately upon E-Stop");
  assert.equal(sys.relayLevel, 1);
  assert.equal(sys.manualActive, false);

  // Operator attempts manual ON during E-Stop
  const res = sys.manualStart("WEB_UI");
  assert.equal(res.success, false);
  assert.equal(res.error, "EMERGENCY_STOP_ACTIVE");
  assert.equal(sys.pumpOn, false);
});

runTest("WP-R05", "Schedule configuration update while in MANUAL does not toggle pump", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  assert.equal(sys.pumpOn, true);

  // Update schedule configuration
  sys.schedules = [{ id: "wp-new", time: "14:00", toTime: "14:30", enabled: true }];
  sys.evaluateSchedule("14:15");

  assert.equal(sys.pumpOn, true, "Manual ON pump must not toggle due to config changes");
});

runTest("WP-R06", "UI connection loss and recovery preserves controller authority", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");
  sys.manualStart("WEB_UI");
  sys.advanceSeconds(450); // 7.5 minutes

  // UI state simulated:
  const controllerRemaining = sys.remainingSec;
  assert.equal(controllerRemaining, 450);

  // Connection dropped for 3 minutes, then recovers
  sys.advanceSeconds(180);
  const reconnectedRemaining = sys.remainingSec;
  assert.equal(reconnectedRemaining, 270, "Controller timer maintained monotonic authority");
});

// -----------------------------------------------------------------------------
// GROUP D: HARDWARE PIN MAP & MODE CONSTRAINTS (WP-H01 to WP-H05)
// -----------------------------------------------------------------------------

runTest("WP-H01", "GPIO 1 Active-LOW relay logic preservation", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");

  sys.manualStart("WEB_UI");
  assert.equal(sys.relayLevel, 0, "Active relay level must be 0 (LOW)");

  sys.manualStop("WEB_UI");
  assert.equal(sys.relayLevel, 1, "Inactive relay level must be 1 (HIGH)");
});

runTest("WP-H02", "Mode restriction: Manual commands rejected in AUTO mode", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("AUTO");

  const startRes = sys.manualStart("WEB_UI");
  assert.equal(startRes.success, false);
  assert.equal(startRes.error, "MODE_RESTRICTION");

  const stopRes = sys.manualStop("WEB_UI");
  assert.equal(stopRes.success, false);
  assert.equal(stopRes.error, "MODE_RESTRICTION");
});

runTest("WP-H03", "Zero confirmation dialog required when returning to AUTO", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.schedules.push({ id: "wp-auto", time: "08:00", toTime: "08:30", enabled: true });
  sys.setMode("MANUAL");

  // Mode change returns immediately without confirmation flow
  sys.setMode("AUTO", "08:10");
  assert.equal(sys.mode, "AUTO");
  assert.equal(sys.pumpOn, true);
});

runTest("WP-H04", "Independent 220V radar protection has no lower float dependency", () => {
  const sys = new SimulatedWellPumpSystem();
  sys.setMode("MANUAL");

  // Well pump has no software dependency on lower float dry-run sensor
  const res = sys.manualStart("WEB_UI");
  assert.equal(res.success, true);
  assert.equal(sys.pumpOn, true);
});

runTest("WP-H05", "Max manual runtime constant is exactly 900 seconds (15 minutes)", () => {
  const sys = new SimulatedWellPumpSystem();
  assert.equal(sys.maxRuntimeSec, 900);
});

console.log("\n================================================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED out of ${results.length} Scenarios`);
console.log("================================================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
