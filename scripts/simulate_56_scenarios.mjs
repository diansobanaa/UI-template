/**
 * MASTER AUTOMATED SIMULATION & ACCEPTANCE SUITE: 56 SCENARIOS
 * Tests FreeRTOS FIFO Queue, Mixing State Machine, Hardware Pumps,
 * Sensor Fail-Safes, Multi-GH Isolation, and UI Status Consistency.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { VirtualClock } from "./simulation/virtual_components.mjs";
import { FertigationSimulationEngine, FERT_STATES, QUEUE_STATES } from "./simulation/fertigation_engine.mjs";
import { computeUIState } from "./simulation/ui_adapter.mjs";

const results = [];
let passedCount = 0;
let failedCount = 0;

function runScenario(id, title, group, fn) {
  const start = Date.now();
  try {
    fn();
    const durationMs = Date.now() - start;
    passedCount++;
    results.push({ id, title, group, status: "PASS", durationMs, evidence: "All assertions satisfied." });
    console.log(`[PASS] ${id} — ${title} (${durationMs}ms)`);
  } catch (err) {
    const durationMs = Date.now() - start;
    failedCount++;
    const errMsg = err?.message || String(err);
    results.push({ id, title, group, status: "FAIL", durationMs, evidence: errMsg, stack: err.stack });
    console.error(`[FAIL] ${id} — ${title}`);
    console.error(`       Error: ${errMsg}`);
  }
}

console.log("================================================================================");
console.log("MASTER SUITE: 56 AUTOMATED FERTIGATION QUEUE & MIXING SIMULATIONS");
console.log("================================================================================\n");

// =============================================================================
// GROUP A: FIFO QUEUE — 10 SCENARIOS (Q01 to Q10)
// =============================================================================

runScenario("Q01", "Empty Queue", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T06:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  // No pending jobs, idle central unit, no due schedules
  engine.tick(60); // Advance 1 minute

  assert.equal(engine.dosingQueue.length, 0, "Queue must remain empty");
  assert.equal(engine.activeBatch, null, "Active batch must be null");
  assert.equal(engine.centralDosingLockOwner, null, "Central dosing lock must be unacquired");

  const ui = computeUIState(engine);
  assert.equal(ui.centralUnit.status, "Standby", "Central unit must display Standby");
  assert.equal(ui.dosingQueue.isEmpty, true, "Queue UI must report empty");
  assert.equal(ui.complexOverview.runningCount, 0, "No running greenhouses");
});

runScenario("Q02", "Single Scheduled Job", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T06:55:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.registerSchedule({
    id: "sched-01",
    ghId: "GH-01",
    time: "07:00",
    targetWaterL: 40,
    recipeName: "Melon Growth",
  });
  engine.materializeDailyOccurrences();

  assert.equal(engine.occurrences.length, 1, "Exactly 1 occurrence registered");

  // Advance clock to trigger time
  engine.tick(300); // 5 minutes -> 07:00

  // Job should enter queue, get dispatched, and run
  assert.ok(engine.activeBatch !== null || engine.executionHistory.length > 0, "Job must be processed");
  assert.equal(engine.tanks["GH-01"].state !== "STANDBY", true, "Tank state must transition from STANDBY");
});

runScenario("Q03", "Multiple FIFO Jobs", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  const res1 = engine.enqueueJob({ ghId: "GH-01", jobId: "job-01", targetWaterL: 30, recipeName: "R1", dosingA_ml: 100, dosingB_ml: 100 });
  const res2 = engine.enqueueJob({ ghId: "GH-02", jobId: "job-02", targetWaterL: 30, recipeName: "R2", dosingA_ml: 100, dosingB_ml: 100 });
  const res3 = engine.enqueueJob({ ghId: "GH-03", jobId: "job-03", targetWaterL: 30, recipeName: "R3", dosingA_ml: 100, dosingB_ml: 100 });

  assert.equal(res1.success, true);
  assert.equal(res2.success, true);
  assert.equal(res3.success, true);

  assert.equal(engine.dosingQueue.length, 3, "All three jobs retained");
  assert.equal(engine.dosingQueue[0].ghId, "GH-01", "1st FIFO is GH-01");
  assert.equal(engine.dosingQueue[1].ghId, "GH-02", "2nd FIFO is GH-02");
  assert.equal(engine.dosingQueue[2].ghId, "GH-03", "3rd FIFO is GH-03");

  // Dispatch head
  engine.tick(1);
  assert.equal(engine.activeBatch?.ghId, "GH-01", "GH-01 must start first");
  assert.equal(engine.centralDosingLockOwner, "GH-01", "GH-01 owns central dosing lock");
});

runScenario("Q04", "New Job Arrives During Active Execution", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", jobId: "job-01", targetWaterL: 20, dosingA_ml: 100, dosingB_ml: 100, mixingDurationSec: 10 });
  engine.tick(1); // GH-01 becomes active
  assert.equal(engine.activeBatch?.ghId, "GH-01");

  // GH-02 arrives while GH-01 is active
  const res = engine.enqueueJob({ ghId: "GH-02", jobId: "job-02", targetWaterL: 25, dosingA_ml: 100, dosingB_ml: 100, mixingDurationSec: 10 });
  assert.equal(res.success, true);
  assert.equal(engine.activeBatch?.ghId, "GH-01", "GH-01 is not interrupted");
  const pendingJobs = engine.dosingQueue.filter((q) => q.state === "PENDING");
  assert.equal(pendingJobs.length, 1, "GH-02 is waiting in queue behind active job");
  assert.equal(pendingJobs[0].ghId, "GH-02");
});

runScenario("Q05", "Simultaneous Schedule Triggers", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T08:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  // Schedules with identical time: GH-03, GH-01, GH-02
  engine.registerSchedule({ id: "s3", ghId: "GH-03", time: "08:00", targetWaterL: 30 });
  engine.registerSchedule({ id: "s1", ghId: "GH-01", time: "08:00", targetWaterL: 30 });
  engine.registerSchedule({ id: "s2", ghId: "GH-02", time: "08:00", targetWaterL: 30 });

  engine.materializeDailyOccurrences();

  assert.equal(engine.occurrences.length, 3, "No schedule lost");
  // Tie-breaking: sorted alphabetically by ghId
  assert.equal(engine.occurrences[0].ghId, "GH-01", "Tie-break 1st: GH-01");
  assert.equal(engine.occurrences[1].ghId, "GH-02", "Tie-break 2nd: GH-02");
  assert.equal(engine.occurrences[2].ghId, "GH-03", "Tie-break 3rd: GH-03");
});

runScenario("Q06", "Queue Capacity Reached", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T08:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock, { maxQueueCapacity: 2 });

  const r1 = engine.enqueueJob({ ghId: "GH-01", jobId: "j1", targetWaterL: 20 });
  const r2 = engine.enqueueJob({ ghId: "GH-02", jobId: "j2", targetWaterL: 20 });
  assert.equal(r1.success, true);
  assert.equal(r2.success, true);

  // 3rd job attempts submission
  const r3 = engine.enqueueJob({ ghId: "GH-03", jobId: "j3", targetWaterL: 20 });
  assert.equal(r3.success, false, "Must reject when capacity reached");
  assert.equal(r3.reason, "QUEUE_CAPACITY_REACHED", "Reports queue capacity condition");
  assert.equal(engine.dosingQueue.length, 2, "Existing queue items intact");
});

runScenario("Q07", "Duplicate Scheduler Trigger", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T08:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  const occId = "occ-gh01-0800";
  const r1 = engine.enqueueJob({ ghId: "GH-01", occurrenceId: occId, targetWaterL: 20 });
  const r2 = engine.enqueueJob({ ghId: "GH-01", occurrenceId: occId, targetWaterL: 20 });
  const r3 = engine.enqueueJob({ ghId: "GH-01", occurrenceId: occId, targetWaterL: 20 });

  assert.equal(r1.success, true, "First submission accepted");
  assert.equal(r2.success, false, "Second retry rejected");
  assert.equal(r2.reason, "DUPLICATE_TRIGGER_IGNORED");
  assert.equal(r3.success, false, "Third retry rejected");
  assert.equal(engine.dosingQueue.length, 1, "Queue integrity preserved (no duplicate)");
});

runScenario("Q08", "Invalid Job Configuration", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T08:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  // Invalid recipe
  const r1 = engine.enqueueJob({ ghId: "GH-01", recipeId: "invalid", targetWaterL: 30 });
  assert.equal(r1.success, false);
  assert.equal(r1.reason, "INVALID_RECIPE_CONFIG");

  // Invalid pump calibration
  engine.pumps.dosingA.setCalibration(0, false); // invalid calibration
  const r2 = engine.enqueueJob({ ghId: "GH-02", recipeId: "recipe-01", targetWaterL: 30 });
  assert.equal(r2.success, false);
  assert.equal(r2.reason, "INVALID_PUMP_CALIBRATION");
  assert.equal(engine.pumps.dosingA.state, "OFF", "No pump starts with invalid config");
});

runScenario("Q09", "Cancel Pending Job", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T08:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  const j1 = engine.enqueueJob({ ghId: "GH-01", jobId: "j1", targetWaterL: 20 });
  const j2 = engine.enqueueJob({ ghId: "GH-02", jobId: "j2", targetWaterL: 20 });
  const j3 = engine.enqueueJob({ ghId: "GH-03", jobId: "j3", targetWaterL: 20 });

  // Cancel j2 (GH-02)
  const cancelRes = engine.cancelQueueJob(j2.queueEntry.queueId);
  assert.equal(cancelRes.success, true);
  assert.equal(cancelRes.job.state, "CANCELLED");

  // Queue retains remaining jobs in relative order: GH-01 then GH-03
  assert.equal(engine.dosingQueue.length, 2);
  assert.equal(engine.dosingQueue[0].ghId, "GH-01");
  assert.equal(engine.dosingQueue[1].ghId, "GH-03");
});

runScenario("Q10", "First Job Fails", "A: FIFO Queue", () => {
  const clock = new VirtualClock("2026-10-02T08:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", jobId: "j1", targetWaterL: 20, dosingA_ml: 100, dosingB_ml: 100 });
  engine.enqueueJob({ ghId: "GH-02", jobId: "j2", targetWaterL: 20, dosingA_ml: 100, dosingB_ml: 100 });

  // Start GH-01
  engine.tick(1);
  assert.equal(engine.activeBatch?.ghId, "GH-01");

  // Inject failure into GH-01
  engine.failBatch("SIMULATED_MOTOR_FAULT", "FILLING");
  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.equal(engine.centralDosingLockOwner, null, "Central resource released safely");

  // Next tick dispatches GH-02 automatically
  engine.tick(1);
  assert.equal(engine.activeBatch?.ghId, "GH-02", "GH-02 proceeds automatically");
});

// =============================================================================
// GROUP B: MIXING TANK — 12 SCENARIOS (M01 to M12)
// =============================================================================

runScenario("M01", "Normal Mixing Process", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20, dosingA_ml: 100, dosingB_ml: 100, mixingDurationSec: 5 });

  // Run full simulation until completion
  for (let i = 0; i < 60; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "READY") break;
  }

  assert.equal(engine.tanks["GH-01"].state, "READY");
  assert.equal(engine.tanks["GH-01"].isHomogenized, true);
  assert.equal(engine.executionHistory.length, 1);
  assert.equal(engine.executionHistory[0].status, "SUCCESS");
});

runScenario("M02", "Mixing Tank Busy", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  // GH-01 occupied
  engine.tanks["GH-01"].state = "FILLING";

  const res = engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20 });
  assert.equal(res.success, true);

  // Dispatcher must not start second batch while tank busy
  engine.tick(1);
  assert.equal(engine.activeBatch, null, "Cannot overwrite active tank process");
});

runScenario("M03", "Sensor Not Installed", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  // Sensor absent, fallback permitted
  engine.sensors.levelGH01.faults.notInstalled = true;

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20, allowVolumetricFallback: true, mixingDurationSec: 5 });
  engine.tick(1);

  assert.equal(engine.activeBatch?.volumetricFallbackActive, true, "Enters volumetric fallback");
  const ui = computeUIState(engine);
  assert.match(ui.mixingTanks[0].volumeDisplayLabel, /Fail-Safe|Flow Meter/);
});

runScenario("M04", "Sensor Disconnected During Operation", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20, allowVolumetricFallback: true });
  engine.tick(1); // Start filling

  // Disconnect sensor during filling
  engine.sensors.levelGH01.faults.disconnected = true;
  engine.tick(2);

  assert.equal(engine.activeBatch?.volumetricFallbackActive, true, "Switches safely to fallback");
});

runScenario("M05", "Sensor Always Reads Zero", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.sensors.levelGH01.faults.alwaysZero = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20, allowVolumetricFallback: true });

  engine.tick(25);
  // Must distinguish persistent zero and switch to volumetric fallback rather than overflowing
  assert.equal(engine.activeBatch?.volumetricFallbackActive, true);
  assert.equal(engine.tanks["GH-01"].overflowOccurred, false, "No uncontrolled filling");
});

runScenario("M06", "Sensor Always Reads Full", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.sensors.levelGH01.faults.alwaysFull = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 50 });
  engine.tick(1);

  assert.equal(engine.tanks["GH-01"].state, "FAILED", "High-level trip blocks filling");
  assert.equal(engine.tanks["GH-01"].overflowOccurred, false);
});

runScenario("M07", "Unstable Sensor Readings", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.sensors.levelGH01.faults.unstableReadings = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20 });
  engine.tick(10);

  // System filters fluctuation and does not crash or spawn duplicate jobs
  const pendingJobs = engine.dosingQueue.filter((q) => q.state === "PENDING");
  assert.equal(pendingJobs.length, 0);
  assert.ok(engine.activeBatch !== null);
});

runScenario("M08", "Target Exceeds Tank Capacity", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  // 350L target for 300L tank
  const res = engine.enqueueJob({ ghId: "GH-01", targetWaterL: 350 });
  assert.equal(res.success, false);
  assert.equal(res.reason, "TARGET_EXCEEDS_CAPACITY");
  assert.equal(engine.pumps.water.state, "OFF", "No pump activated");
});

runScenario("M09", "Zero Mixing Target", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  const res = engine.enqueueJob({ ghId: "GH-01", targetWaterL: 0 });
  assert.equal(res.success, false);
  assert.equal(res.reason, "INVALID_TARGET_ZERO");
  assert.equal(engine.pumps.water.state, "OFF");
});

runScenario("M10", "Water Filling Timeout", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock, { fillTimeoutSec: 10 });

  // Pump runs without flow
  engine.pumps.water.faults.runsWithoutFlow = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 50 });
  engine.tick(12);

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.equal(engine.pumps.water.state, "OFF", "Pump stopped on timeout");
});

runScenario("M11", "Mixing Failure", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.pumps.mixer.faults.failsToStart = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 5, dosingA_ml: 25, dosingB_ml: 25, mixingDurationSec: 5 });

  for (let i = 0; i < 30; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "FAILED") break;
  }

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.equal(engine.tanks["GH-01"].isHomogenized, false, "Never declared Ready on mixer failure");
});

runScenario("M12", "Normal Completion", "B: Mixing Tank", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 10, dosingA_ml: 50, dosingB_ml: 50, mixingDurationSec: 2 });
  for (let i = 0; i < 30; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "READY") break;
  }

  assert.equal(engine.tanks["GH-01"].state, "READY");
  assert.equal(engine.centralDosingLockOwner, null, "Central resource released");
});

// =============================================================================
// GROUP C: PUMP AND VOLUMETRIC OPERATION — 12 SCENARIOS (P01 to P12)
// =============================================================================

runScenario("P01", "Water Pump Fails to Start", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.pumps.water.faults.failsToStart = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20 });
  engine.tick(1);

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.equal(engine.activeBatch, null);
});

runScenario("P02", "Dosing Pump Fails to Start", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.pumps.dosingA.faults.failsToStart = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 5, dosingA_ml: 50, dosingB_ml: 50 });

  for (let i = 0; i < 20; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "FAILED") break;
  }

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.equal(engine.tanks["GH-01"].nutrientA_Ml, 0, "No nutrient dosed");
});

runScenario("P03", "Mixing Pump Fails to Start", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.pumps.mixer.faults.failsToStart = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 5, dosingA_ml: 25, dosingB_ml: 25, mixingDurationSec: 5 });

  for (let i = 0; i < 30; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "FAILED") break;
  }

  assert.equal(engine.tanks["GH-01"].isHomogenized, false);
});

runScenario("P04", "Pump Runs Without Flow", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.pumps.water.faults.runsWithoutFlow = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20 });
  engine.tick(12);

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.equal(engine.tanks["GH-01"].waterVolumeMl, 0);
});

runScenario("P05", "Insufficient Flow Rate", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock, { fillTimeoutSec: 10 });

  engine.pumps.water.faults.insufficientFlowFactor = 0.05; // 5% flow rate
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 100 });
  engine.tick(12);

  assert.equal(engine.tanks["GH-01"].state, "FAILED", "Trips on timeout due to insufficient flow");
});

runScenario("P06", "Pump Stops Unexpectedly", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 50 });
  engine.tick(2);

  // Pump tripped unexpectedly
  engine.failBatch("PUMP_STOPPED_UNEXPECTEDLY", "FILLING");
  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.ok(engine.tanks["GH-01"].waterVolumeMl > 0, "Partial volume recorded");
});

runScenario("P07", "Pump Fails to Stop", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.pumps.water.faults.failsToStop = true;
  const offRes = engine.pumps.water.turnOff(clock.timeMs);

  assert.equal(offRes.success, false);
  assert.equal(engine.pumps.water.faults.secondaryShutdownInvoked, true, "Secondary shutdown protection invoked");
});

runScenario("P08", "Invalid Pump Calibration", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.pumps.water.setCalibration(-5, false); // Negative rate
  const res = engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20 });

  assert.equal(res.success, false);
  assert.equal(res.reason, "INVALID_PUMP_CALIBRATION");
});

runScenario("P09", "One Pump in Multi-Pump Sequence Fails", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.pumps.dosingB.faults.failsToStart = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 5, dosingA_ml: 50, dosingB_ml: 50 });

  for (let i = 0; i < 30; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "FAILED") break;
  }

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.equal(engine.tanks["GH-01"].nutrientA_Ml, 50, "Pump A completed dose recorded");
  assert.equal(engine.tanks["GH-01"].nutrientB_Ml, 0, "Pump B failed");
  assert.equal(engine.tanks["GH-01"].isHomogenized, false);
});

runScenario("P10", "Maximum Operating Duration Exceeded", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock, { maxTotalRuntimeSec: 15 });

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 100 });
  engine.tick(18);

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
  assert.equal(engine.executionHistory[0].reason, "MAX_OPERATING_DURATION_EXCEEDED");
});

runScenario("P11", "Limited Water Supply", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock, { fillTimeoutSec: 10 });

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 100 });
  engine.tick(2); // Runs 2s
  engine.pumps.water.faults.runsWithoutFlow = true; // Supply ran out
  engine.tick(12);

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
});

runScenario("P12", "Invalid Pump Feedback", "C: Pump & Volumetric", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.sensors.rawFlow.faults.invalidFeedback = true;
  const flowVal = engine.sensors.rawFlow.getFlowReading(500);

  assert.ok(Number.isNaN(flowVal));
});

// =============================================================================
// GROUP D: FAIL-SAFE AND RECOVERY — 10 SCENARIOS (F01 to F10)
// =============================================================================

runScenario("F01", "No Sensor Installed From Startup", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.sensors.levelGH01.faults.notInstalled = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 10, allowVolumetricFallback: true, mixingDurationSec: 2 });

  for (let i = 0; i < 60; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "READY") break;
  }

  assert.equal(engine.tanks["GH-01"].state, "READY");
  assert.equal(engine.tanks["GH-01"].currentVolumeL, 10.1); // 10L water + 100ml nutrients
});

runScenario("F02", "Sensor Lost During Filling", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 10, allowVolumetricFallback: true });
  engine.tick(1);
  engine.sensors.levelGH01.faults.disconnected = true; // Lost during filling
  engine.tick(1);

  assert.equal(engine.activeBatch?.volumetricFallbackActive, true);
});

runScenario("F03", "No Sensor and No Valid Calibration", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.sensors.levelGH01.faults.notInstalled = true;
  engine.pumps.water.setCalibration(0, false); // No calibration
  const res = engine.enqueueJob({ ghId: "GH-01", targetWaterL: 10 });

  assert.equal(res.success, false);
  assert.equal(res.reason, "INVALID_PUMP_CALIBRATION");
});

runScenario("F04", "Estimated Volume Reaches Target", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.sensors.levelGH01.faults.notInstalled = true;
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20, allowVolumetricFallback: true, mixingDurationSec: 2 });

  for (let i = 0; i < 80; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "READY") break;
  }

  assert.equal(engine.tanks["GH-01"].state, "READY");
  const ui = computeUIState(engine);
  assert.match(ui.mixingTanks[0].volumeDisplayLabel, /Volume Larutan Siap/);
});

runScenario("F05", "Estimated Filling Exceeds Safety Limit", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock, { fillTimeoutSec: 5 });

  engine.pumps.water.setCalibration(10, true); // very slow 10ml/s
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 200 }); // requires 20,000s
  engine.tick(7);

  assert.equal(engine.tanks["GH-01"].state, "FAILED");
});

runScenario("F06", "ESP32 Reboot While Jobs Are Waiting", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", jobId: "j1", targetWaterL: 20 });
  engine.enqueueJob({ ghId: "GH-02", jobId: "j2", targetWaterL: 30 });

  // Reboot while waiting
  engine.simulateReboot();

  assert.equal(engine.dosingQueue.length, 2, "Pending jobs restored");
  assert.equal(engine.dosingQueue[0].ghId, "GH-01");
  assert.equal(engine.dosingQueue[1].ghId, "GH-02");
});

runScenario("F07", "ESP32 Reboot During Water Filling", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 50 });
  engine.tick(2); // Mid-filling

  engine.simulateReboot();

  assert.equal(engine.pumps.water.state, "OFF", "Pump safe OFF");
  assert.equal(engine.tanks["GH-01"].state, "INTERRUPTED");
});

runScenario("F08", "ESP32 Reboot During Dosing", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 2, dosingA_ml: 100, dosingB_ml: 100 });
  engine.tick(5); // In dosing

  engine.simulateReboot();

  assert.equal(engine.pumps.dosingA.state, "OFF");
  assert.equal(engine.tanks["GH-01"].state, "INTERRUPTED");
});

runScenario("F09", "Backend Offline", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.setBackendConnection(false); // Disconnect backend
  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 5, dosingA_ml: 25, dosingB_ml: 25, mixingDurationSec: 2 });

  for (let i = 0; i < 20; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "READY") break;
  }

  assert.equal(engine.tanks["GH-01"].state, "READY", "Autonomous local execution succeeds");
  engine.setBackendConnection(true); // Reconnect
  assert.equal(engine.executionHistory.length, 1, "Completed history preserved");
});

runScenario("F10", "Recovery After Sensor or Pump Fault", "D: Fail-Safe & Recovery", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  // Incur fault
  engine.pumps.water.faults.failsToStart = true;
  engine.enqueueJob({ ghId: "GH-01", jobId: "bad-job", targetWaterL: 20 });
  engine.tick(1);
  assert.equal(engine.tanks["GH-01"].state, "FAILED");

  // Clear fault & resume fresh operation
  engine.pumps.water.faults.failsToStart = false;
  engine.tanks["GH-01"].state = "STANDBY";

  const nextJob = engine.enqueueJob({ ghId: "GH-01", jobId: "good-job", targetWaterL: 5, mixingDurationSec: 2 });
  assert.equal(nextJob.success, true);
  engine.tick(1);
  assert.equal(engine.activeBatch?.ghId, "GH-01");
});

// =============================================================================
// GROUP E: MULTI-GREENHOUSE ISOLATION — 6 SCENARIOS (G01 to G06)
// =============================================================================

runScenario("G01", "Two Greenhouses Operating Normally", "E: Multi-GH Isolation", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 10, mixingDurationSec: 2 });
  engine.enqueueJob({ ghId: "GH-02", targetWaterL: 15, mixingDurationSec: 2 });

  for (let i = 0; i < 80; i++) {
    engine.tick(1);
  }

  assert.equal(engine.tanks["GH-01"].currentVolumeL, 10.1);
  assert.equal(engine.tanks["GH-02"].currentVolumeL, 15.1);
  assert.equal(engine.executionHistory.length, 2);
});

runScenario("G02", "One Greenhouse Fails", "E: Multi-GH Isolation", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 10 });
  engine.enqueueJob({ ghId: "GH-02", targetWaterL: 10, mixingDurationSec: 2 });

  engine.tick(1);
  engine.failBatch("GH01_SENSOR_TRIP", "FILLING");

  assert.equal(engine.tanks["GH-01"].state, "FAILED");

  // GH-02 proceeds unaffected
  for (let i = 0; i < 60; i++) {
    engine.tick(1);
    if (engine.tanks["GH-02"].state === "READY") break;
  }

  assert.equal(engine.tanks["GH-02"].state, "READY");
});

runScenario("G03", "First Mixing Tank Is Busy", "E: Multi-GH Isolation", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.tanks["GH-01"].state = "MIXING";
  engine.enqueueJob({ ghId: "GH-02", targetWaterL: 10 });
  engine.tick(1);

  assert.equal(engine.activeBatch?.ghId, "GH-02", "GH-02 can dose while GH-01 is independently mixing");
});

runScenario("G04", "Three Greenhouses in Sequence", "E: Multi-GH Isolation", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 5, mixingDurationSec: 1 });
  engine.enqueueJob({ ghId: "GH-02", targetWaterL: 5, mixingDurationSec: 1 });
  engine.enqueueJob({ ghId: "GH-03", targetWaterL: 5, mixingDurationSec: 1 });

  for (let i = 0; i < 80; i++) {
    engine.tick(1);
  }

  assert.equal(engine.executionHistory.length, 3);
  assert.equal(engine.executionHistory[0].ghId, "GH-01");
  assert.equal(engine.executionHistory[1].ghId, "GH-02");
  assert.equal(engine.executionHistory[2].ghId, "GH-03");
});

runScenario("G05", "One Tank Completes While Another Is Queued", "E: Multi-GH Isolation", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 5, mixingDurationSec: 2 });
  engine.enqueueJob({ ghId: "GH-02", targetWaterL: 5, mixingDurationSec: 2 });

  for (let i = 0; i < 30; i++) {
    engine.tick(1);
    if (engine.tanks["GH-01"].state === "READY") break;
  }
  engine.tick(1); // Advance one tick to dispatch GH-02

  assert.equal(engine.tanks["GH-01"].state, "READY");
  assert.equal(engine.activeBatch?.ghId, "GH-02", "GH-02 acquired dosing unit as soon as GH-01 released it");
});

runScenario("G06", "Greenhouse Data Isolation", "E: Multi-GH Isolation", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  assert.equal(engine.tanks["GH-01"].capacityL, 300);
  assert.equal(engine.tanks["GH-03"].capacityL, 500);

  engine.tanks["GH-01"].addWater(50000); // 50L
  assert.equal(engine.tanks["GH-01"].currentVolumeL, 50);
  assert.equal(engine.tanks["GH-02"].currentVolumeL, 0, "No cross-GH volume leakage");
});

// =============================================================================
// GROUP F: UI AND STATUS CONSISTENCY — 6 SCENARIOS (U01 to U06)
// =============================================================================

runScenario("U01", "Empty Queue With and Without Future Schedules", "F: UI Consistency", () => {
  const clock = new VirtualClock("2026-10-02T06:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  // Case A: No queued jobs and no future schedules
  let ui = computeUIState(engine);
  assert.equal(ui.centralUnit.status, "Standby");
  assert.equal(ui.dosingQueue.isEmpty, true);
  assert.equal(ui.dosingQueue.nextScheduledOp, null);

  // Case B: No queued jobs, but valid future schedule exists
  engine.registerSchedule({ id: "s1", ghId: "GH-01", time: "07:00", targetWaterL: 50 });
  ui = computeUIState(engine);
  assert.equal(ui.dosingQueue.isEmpty, true);
  assert.equal(ui.dosingQueue.nextScheduledOp?.time, "07:00");
  assert.equal(ui.dosingQueue.nextScheduledOp?.ghCode, "GH-01");
});

runScenario("U02", "Waiting for Schedule", "F: UI Consistency", () => {
  const clock = new VirtualClock("2026-10-02T10:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.registerSchedule({ id: "s1", ghId: "GH-01", time: "12:00", targetWaterL: 50 });
  const ui = computeUIState(engine);

  const gh1Tank = ui.mixingTanks.find((t) => t.ghId === "GH-01");
  assert.equal(gh1Tank.status, "Waiting for schedule");
  assert.equal(gh1Tank.timingValue, "Pukul 12:00");
  // Fail-Safe: Manual enqueue button MUST be suppressed when waiting for automated schedule!
  assert.equal(gh1Tank.canPreMixNow, false, "canPreMixNow must be false during scheduled wait");
});

runScenario("U03", "Waiting in FIFO Queue", "F: UI Consistency", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20 });
  engine.enqueueJob({ ghId: "GH-02", targetWaterL: 20 });
  engine.tick(1); // GH-01 becomes active, GH-02 is queued

  const ui = computeUIState(engine);
  const gh2Tank = ui.mixingTanks.find((t) => t.ghId === "GH-02");
  assert.equal(gh2Tank.status, "Waiting in queue");
  assert.equal(gh2Tank.timingValue, "Urutan #1 di Central");
  assert.equal(ui.dosingQueue.queuedJobs.length, 1);
  assert.equal(ui.dosingQueue.queuedJobs[0].ghCode, "GH-02");
});

runScenario("U04", "Active Process", "F: UI Consistency", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20, dosingA_ml: 100, dosingB_ml: 100, mixingDurationSec: 5 });
  engine.tick(1);

  const ui = computeUIState(engine);
  const gh1Tank = ui.mixingTanks.find((t) => t.ghId === "GH-01");
  assert.equal(gh1Tank.status, "Preparing water");
  assert.equal(ui.centralUnit.status, "Dosing");
  assert.equal(ui.centralUnit.activeJob?.ghCode, "GH-01");
});

runScenario("U05", "Active Volumetric Fallback", "F: UI Consistency", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.sensors.levelGH01.faults.notInstalled = true;
  engine.registerSchedule({ id: "s1", ghId: "GH-01", time: "08:00", targetWaterL: 50 });

  const ui = computeUIState(engine);
  const gh1Tank = ui.mixingTanks.find((t) => t.ghId === "GH-01");
  assert.equal(gh1Tank.volumeDisplayLabel, "Volume Tangki Batch (Fail-Safe)");
  assert.match(gh1Tank.volumeDisplayValue, /Volumetrik Fail-Safe/);
});

runScenario("U06", "Failed Process", "F: UI Consistency", () => {
  const clock = new VirtualClock("2026-10-02T07:00:00.000Z");
  const engine = new FertigationSimulationEngine(clock);

  engine.enqueueJob({ ghId: "GH-01", targetWaterL: 20 });
  engine.tick(1);
  engine.failBatch("PUMP_OVERHEATING_PROTECTION", "FILLING");

  const ui = computeUIState(engine);
  const gh1Tank = ui.mixingTanks.find((t) => t.ghId === "GH-01");
  assert.equal(gh1Tank.status, "Failed");
  assert.equal(ui.complexOverview.errorCount, 1);
});

// =============================================================================
// REPORT GENERATION & CONCLUSION
// =============================================================================

console.log("\n================================================================================");
console.log(`SIMULATION RESULTS SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED out of 56 Scenarios`);
console.log("================================================================================\n");

// Write JSON artifact
const reportJson = {
  timestamp: new Date().toISOString(),
  totalScenarios: 56,
  passed: passedCount,
  failed: failedCount,
  blocked: 0,
  notRun: 0,
  results,
};

fs.writeFileSync(path.resolve("scripts/simulation/simulation_results.json"), JSON.stringify(reportJson, null, 2), "utf8");
console.log("Saved machine-readable test evidence to scripts/simulation/simulation_results.json\n");

if (failedCount > 0) {
  process.exit(1);
}
