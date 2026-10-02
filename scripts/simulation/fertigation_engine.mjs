/**
 * Authoritative Fertigation Engine & FIFO Queue Processor Simulation
 * Directly implements the FreeRTOS scheduler queue and fertigation state machine logic
 * from esp32/main/services/scheduler.c and fertigation_mgr.c.
 */

import { VirtualPump, VirtualSensor, VirtualMixingTank } from "./virtual_components.mjs";

export const FERT_STATES = {
  IDLE: "IDLE",
  PRECHECK: "PRECHECK",
  FILLING: "FILLING",
  DOSING: "DOSING",
  FINAL_MIXING: "FINAL_MIXING",
  MIX_READY: "MIX_READY",
  DELIVERY: "DELIVERY",
  COMPLETE: "COMPLETE",
  FAULTED: "FAULTED",
  INTERRUPTED: "INTERRUPTED",
  ABORTED: "ABORTED",
};

export const QUEUE_STATES = {
  PENDING: "PENDING",
  DISPATCHED: "DISPATCHED",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

export class FertigationSimulationEngine {
  constructor(clock, options = {}) {
    this.clock = clock;
    this.maxQueueCapacity = options.maxQueueCapacity ?? 4;
    this.fillTimeoutSec = options.fillTimeoutSec ?? 300;
    this.maxDosingRuntimeSec = options.maxDosingRuntimeSec ?? 1800;
    this.maxTotalRuntimeSec = options.maxTotalRuntimeSec ?? 3600;

    // Hardware Registry
    this.pumps = {
      water: new VirtualPump("water-pump", "Raw Water Fill Pump", "WATER", 500), // 500 ml/s = 30 L/min
      dosingA: new VirtualPump("dose-a", "Nutrient Pump A", "DOSING_A", 25),      // 25 ml/s
      dosingB: new VirtualPump("dose-b", "Nutrient Pump B", "DOSING_B", 25),      // 25 ml/s
      mixer: new VirtualPump("mixer-pump", "Tank Circulation Mixer", "MIXING", 1),
      distGH01: new VirtualPump("dist-gh01", "GH-01 Distribution Pump", "DISTRIBUTION", 200),
      distGH02: new VirtualPump("dist-gh02", "GH-02 Distribution Pump", "DISTRIBUTION", 200),
      distGH03: new VirtualPump("dist-gh03", "GH-03 Distribution Pump", "DISTRIBUTION", 200),
    };

    this.sensors = {
      levelGH01: new VirtualSensor("level-gh01", "GH-01 Level Sensor", "VOLUME_LEVEL"),
      levelGH02: new VirtualSensor("level-gh02", "GH-02 Level Sensor", "VOLUME_LEVEL"),
      levelGH03: new VirtualSensor("level-gh03", "GH-03 Level Sensor", "VOLUME_LEVEL"),
      rawFlow: new VirtualSensor("raw-flow", "Water Flow Meter", "FLOW_METER"),
      deliveryFlowGH01: new VirtualSensor("deliv-flow-gh01", "GH-01 Delivery Flow Meter", "FLOW_METER"),
    };

    this.tanks = {
      "GH-01": new VirtualMixingTank("tank-gh01", "GH-01", 300),
      "GH-02": new VirtualMixingTank("tank-gh02", "GH-02", 300),
      "GH-03": new VirtualMixingTank("tank-gh03", "GH-03", 500),
    };

    // Central Dosing Resource Lock
    this.centralDosingLockOwner = null; // null or ghId

    // FIFO Dosing Queue
    this.dosingQueue = []; // array of queue entries
    this.activeBatch = null;

    // Daily occurrences registry (scheduler state)
    this.schedules = [];
    this.occurrences = [];

    // History and logging
    this.executionHistory = [];
    this.eventLog = [];

    // System operational flags
    this.backendConnected = true;
    this.nvsMarkers = new Map(); // simulated NVS persistence
  }

  logEvent(type, message, details = {}) {
    const event = {
      timestampMs: this.clock.timeMs,
      timeStr: this.clock.formatTime(),
      type,
      message,
      details,
    };
    this.eventLog.push(event);
    return event;
  }

  registerSchedule(sched) {
    this.schedules.push({
      id: sched.id,
      ghId: sched.ghId,
      time: sched.time, // "HH:MM"
      targetWaterL: sched.targetWaterL ?? 50,
      recipeId: sched.recipeId ?? "recipe-default",
      recipeName: sched.recipeName ?? "Standard Formula",
      dosingA_ml: sched.dosingA_ml ?? 250,
      dosingB_ml: sched.dosingB_ml ?? 250,
      mixingDurationSec: sched.mixingDurationSec ?? 30,
      allowVolumetricFallback: sched.allowVolumetricFallback ?? true,
      initialFillPercent: sched.initialFillPercent ?? 20, // 20% rule
      enabled: sched.enabled ?? true,
    });
  }

  materializeDailyOccurrences() {
    this.occurrences = [];
    for (const sched of this.schedules) {
      if (!sched.enabled) continue;
      const [h, m] = sched.time.split(":").map(Number);
      const schedD = new Date(this.clock.timeMs);
      schedD.setUTCHours(h, m, 0, 0);
      const scheduledTimestamp = schedD.getTime();

      const occId = `occ-${sched.ghId}-${sched.id}-${scheduledTimestamp}`;
      this.occurrences.push({
        occurrenceId: occId,
        scheduleId: sched.id,
        ghId: sched.ghId,
        scheduledTimestamp,
        timeStr: sched.time,
        targetWaterL: sched.targetWaterL,
        targetWaterMl: sched.targetWaterL * 1000,
        recipeId: sched.recipeId,
        recipeName: sched.recipeName,
        dosingA_ml: sched.dosingA_ml,
        dosingB_ml: sched.dosingB_ml,
        mixingDurationSec: sched.mixingDurationSec,
        allowVolumetricFallback: sched.allowVolumetricFallback,
        initialFillPercent: sched.initialFillPercent,
        state: "PENDING", // "PENDING" | "ENQUEUED" | "READY_TO_SEND" | "WAITING_BATCH" | "DISTRIBUTING" | "COMPLETED" | "FAILED"
      });
    }

    // Deterministic tie-breaking sort (Section 4 Scenario Q05 & C code scheduler.c:1630-1645):
    // Sort by scheduledTimestamp ascending, then alphabetical by ghId
    this.occurrences.sort((a, b) => {
      if (a.scheduledTimestamp !== b.scheduledTimestamp) {
        return a.scheduledTimestamp - b.scheduledTimestamp;
      }
      return a.ghId.localeCompare(b.ghId);
    });

    this.logEvent("SCHEDULER_DAILY_TRIGGER", `Materialized ${this.occurrences.length} occurrences for today.`);
  }

  enqueueJob(job) {
    const ghId = job.ghId;
    const targetWaterL = job.targetWaterL;
    const recipeId = job.recipeId ?? "recipe-default";
    const recipeName = job.recipeName ?? "Standard Formula";
    const dosingA_ml = job.dosingA_ml ?? 50;
    const dosingB_ml = job.dosingB_ml ?? 50;
    const mixingDurationSec = job.mixingDurationSec ?? 5;
    const allowVolumetricFallback = job.allowVolumetricFallback ?? true;
    const initialFillPercent = job.initialFillPercent ?? 20;

    // 1. Capacity check (Q06)
    if (this.dosingQueue.length >= this.maxQueueCapacity) {
      this.logEvent("QUEUE_REJECTED", `Queue full (Capacity ${this.maxQueueCapacity})`, { ghId });
      return { success: false, reason: "QUEUE_CAPACITY_REACHED" };
    }

    // 2. Duplicate check (Q07)
    const isDuplicate = this.dosingQueue.some(
      (q) => (job.occurrenceId && q.occurrenceId === job.occurrenceId) || (job.jobId && q.jobId === job.jobId)
    );
    if (isDuplicate) {
      this.logEvent("DUPLICATE_IGNORED", `Job ${job.jobId || job.occurrenceId} already in queue.`, { ghId });
      return { success: false, reason: "DUPLICATE_TRIGGER_IGNORED" };
    }

    // 3. Tank capacity check (M08)
    const tank = this.tanks[ghId];
    if (tank && targetWaterL > tank.capacityL) {
      this.logEvent("INVALID_CONFIG", `Target ${targetWaterL} L exceeds tank capacity ${tank.capacityL} L`, { ghId });
      return { success: false, reason: "TARGET_EXCEEDS_CAPACITY" };
    }

    // 4. Target validity check (M09)
    if (targetWaterL === undefined || targetWaterL === null || targetWaterL <= 0 || isNaN(targetWaterL)) {
      this.logEvent("INVALID_CONFIG", `Target volume is zero or invalid: ${targetWaterL}`, { ghId });
      return { success: false, reason: "INVALID_TARGET_ZERO" };
    }

    // 5. Recipe check (Q08)
    if (recipeId === "invalid" || dosingA_ml < 0 || dosingB_ml < 0) {
      this.logEvent("INVALID_CONFIG", `Invalid recipe or nutrient parameters`, { ghId });
      return { success: false, reason: "INVALID_RECIPE_CONFIG" };
    }

    // 6. Pump calibration check (P08 / Q08)
    if (!this.pumps.water.calibration.valid || !this.pumps.dosingA.calibration.valid || !this.pumps.dosingB.calibration.valid) {
      this.logEvent("BLOCKED_CALIBRATION", `Required pump calibration missing or invalid`, { ghId });
      return { success: false, reason: "INVALID_PUMP_CALIBRATION" };
    }

    const queueEntry = {
      queueId: `queue-${ghId}-${Date.now()}-${this.dosingQueue.length + 1}`,
      jobId: job.jobId || `job-${Date.now()}`,
      occurrenceId: job.occurrenceId || null,
      ghId,
      recipeId,
      recipeName,
      targetWaterL,
      targetWaterMl: targetWaterL * 1000,
      dosingA_ml,
      dosingB_ml,
      mixingDurationSec,
      allowVolumetricFallback,
      initialFillPercent,
      scheduledTimestamp: job.scheduledTimestamp || this.clock.timeMs,
      timeStr: job.timeStr || this.clock.formatTime(),
      state: QUEUE_STATES.PENDING,
      enqueuedAtMs: this.clock.timeMs,
      dispatchedAtMs: null,
      steps: [
        { stepNumber: 1, name: "Persiapan Air Baku", status: "WAITING" },
        { stepNumber: 2, name: "Injeksi Nutrisi Stok A", status: "WAITING" },
        { stepNumber: 3, name: "Injeksi Nutrisi Stok B", status: "WAITING" },
        { stepNumber: 4, name: "Pengadukan & Homogenisasi", status: "WAITING" },
        { stepNumber: 5, name: "Larutan Siap Siram", status: "WAITING" },
      ],
    };

    this.dosingQueue.push(queueEntry);
    this.nvsMarkers.set(queueEntry.queueId, { state: "PENDING", ghId: queueEntry.ghId });
    this.logEvent("QUEUE_ENQUEUED", `Enqueued job for ${ghId} (#${this.dosingQueue.length})`, { queueId: queueEntry.queueId });
    return { success: true, queueEntry };
  }

  cancelQueueJob(queueId) {
    const idx = this.dosingQueue.findIndex((q) => q.queueId === queueId);
    if (idx === -1) return { success: false, reason: "NOT_FOUND" };

    const job = this.dosingQueue[idx];
    if (job.state === QUEUE_STATES.ACTIVE) {
      return { success: false, reason: "CANNOT_CANCEL_ACTIVE_JOB" };
    }

    job.state = QUEUE_STATES.CANCELLED;
    this.dosingQueue.splice(idx, 1);
    this.nvsMarkers.delete(queueId);
    this.logEvent("QUEUE_CANCELLED", `Job ${queueId} for ${job.ghId} cancelled by operator`, { queueId });
    return { success: true, job };
  }

  // Scheduler autonomous loop (corresponds to FreeRTOS scheduler_task tick)
  tick(elapsedSec = 1) {
    const nowMs = this.clock.advanceSeconds(elapsedSec);
    const nowSec = Math.floor(nowMs / 1000);

    // 1. Eager pre-mix enqueue from daily occurrences
    for (const occ of this.occurrences) {
      if (occ.state === "PENDING") {
        // Enqueue if tank is not currently occupied
        const tank = this.tanks[occ.ghId];
        const isTankOccupied = tank.state !== "STANDBY" && tank.state !== "READY";
        const isGhInQueue = this.dosingQueue.some((q) => q.ghId === occ.ghId);

        if (!isTankOccupied && !isGhInQueue) {
          const res = this.enqueueJob(occ);
          if (res.success) {
            occ.state = "ENQUEUED";
          }
        }
      }
    }

    // 2. Process FIFO Queue Head
    this.processQueueHead();

    // 3. Step active batch state machine
    if (this.activeBatch) {
      this.stepBatch(elapsedSec);
    }

    // 4. Check scheduled distribution times
    this.evaluateDistributions();
  }

  processQueueHead() {
    if (this.dosingQueue.length === 0) return;

    const head = this.dosingQueue[0];

    // If head is PENDING and no active batch, dispatch head
    if (head.state === QUEUE_STATES.PENDING) {
      if (this.activeBatch === null) {
        // Check if tank is busy with previous run
        const tank = this.tanks[head.ghId];
        if (tank.state === "FILLING" || tank.state === "DOSING" || tank.state === "MIXING") {
          return; // Wait until tank is clear
        }

        // Latch DISPATCHED state (FreeRTOS scheduler.c:1718)
        head.state = QUEUE_STATES.DISPATCHED;
        head.dispatchedAtMs = this.clock.timeMs;
        this.logEvent("QUEUE_DISPATCHED", `Head ${head.queueId} (${head.ghId}) dispatched; acquiring resources.`);

        // Physical start
        this.startBatch(head);
      }
    }
  }

  startBatch(queueEntry) {
    const tank = this.tanks[queueEntry.ghId];
    tank.reset();
    tank.state = "FILLING";

    this.activeBatch = {
      queueEntry,
      ghId: queueEntry.ghId,
      state: FERT_STATES.PRECHECK,
      waterFilledMl: 0,
      targetWaterMl: queueEntry.targetWaterMl,
      dosedA_Ml: 0,
      targetDosedA_Ml: queueEntry.dosingA_ml,
      dosedB_Ml: 0,
      targetDosedB_Ml: queueEntry.dosingB_ml,
      mixingElapsedSec: 0,
      targetMixingSec: queueEntry.mixingDurationSec,
      stageElapsedSec: 0,
      volumetricFallbackActive: false,
      failedStage: null,
      failReason: null,
      completedSteps: [],
    };

    queueEntry.state = QUEUE_STATES.ACTIVE;
    this.centralDosingLockOwner = queueEntry.ghId;

    // Check sensor status at startup (F01 / M03)
    const sensor = this.sensors[`level${queueEntry.ghId.replace("-", "")}`];
    if (sensor && sensor.faults.notInstalled) {
      if (queueEntry.allowVolumetricFallback) {
        this.activeBatch.volumetricFallbackActive = true;
        this.logEvent("VOLUMETRIC_FALLBACK", `Sensor not installed; entering calibrated volumetric fallback mode.`, { ghId: queueEntry.ghId });
      } else {
        this.failBatch("SENSOR_NOT_INSTALLED_FALLBACK_DISALLOWED", "PRECHECK");
        return;
      }
    }

    // High level sensor fault check (M06)
    if (sensor && sensor.faults.alwaysFull) {
      this.failBatch("SENSOR_REPORTING_MAX_HIGH_LEVEL_TRIP", "PRECHECK");
      return;
    }

    // Transition to FILLING
    this.activeBatch.state = FERT_STATES.FILLING;
    queueEntry.steps[0].status = "RUNNING";

    const pumpRes = this.pumps.water.turnOn(this.clock.timeMs);
    if (!pumpRes.success) {
      this.failBatch(pumpRes.reason, "FILLING");
    }
  }

  stepBatch(elapsedSec) {
    const batch = this.activeBatch;
    if (!batch) return;

    batch.stageElapsedSec += elapsedSec;
    const tank = this.tanks[batch.ghId];
    const sensor = this.sensors[`level${batch.ghId.replace("-", "")}`];

    // Watchdog check for max total runtime (P10)
    if (batch.stageElapsedSec > this.maxTotalRuntimeSec) {
      this.failBatch("MAX_OPERATING_DURATION_EXCEEDED", batch.state);
      return;
    }

    // -------------------------------------------------------------
    // STAGE: FILLING
    // -------------------------------------------------------------
    if (batch.state === FERT_STATES.FILLING) {
      // Check sensor lost during filling (M04 / F02)
      if (sensor && sensor.faults.disconnected) {
        if (batch.queueEntry.allowVolumetricFallback && this.pumps.water.calibration.valid) {
          batch.volumetricFallbackActive = true;
        } else {
          this.failBatch("SENSOR_DISCONNECTED_NO_VALID_FALLBACK", "FILLING");
          return;
        }
      }

      // Check filling timeout (M10)
      if (batch.stageElapsedSec > this.fillTimeoutSec) {
        this.failBatch("WATER_FILLING_TIMEOUT_EXCEEDED", "FILLING");
        return;
      }

      // Water pump run step
      const waterAdded = this.pumps.water.step(elapsedSec * 1000);
      batch.waterFilledMl += waterAdded;
      tank.addWater(waterAdded);

      // Flow check: if pump runs without flow (P04)
      if (this.pumps.water.faults.runsWithoutFlow && batch.stageElapsedSec > 10) {
        this.failBatch("PUMP_RUNNING_WITHOUT_FLOW_DETECTED", "FILLING");
        return;
      }

      // Unstable sensor readings check (M07)
      if (sensor && sensor.faults.unstableReadings && batch.stageElapsedSec > 5) {
        this.logEvent("SENSOR_UNSTABLE_FILTERED", "Sensor fluctuation filtered by Kalman/moving average filter.");
      }

      // Sensor always zero check: if physical pump pumped sufficient water but sensor still 0 (M05)
      if (sensor && sensor.faults.alwaysZero && batch.stageElapsedSec > 20) {
        // Detects zero reading despite flow; uses volumetric fallback if permitted
        if (batch.queueEntry.allowVolumetricFallback) {
          batch.volumetricFallbackActive = true;
        } else {
          this.failBatch("SENSOR_STUCK_ZERO_FLOW_TIMEOUT", "FILLING");
          return;
        }
      }

      // Check if target reached
      if (batch.waterFilledMl >= batch.targetWaterMl) {
        this.pumps.water.turnOff(this.clock.timeMs);
        batch.completedSteps.push("WATER_PREPARATION");
        batch.queueEntry.steps[0].status = "COMPLETED";

        // Transition to DOSING
        batch.state = FERT_STATES.DOSING;
        batch.stageElapsedSec = 0;
        tank.state = "DOSING";
        batch.queueEntry.steps[1].status = "RUNNING";

        const pumpARes = this.pumps.dosingA.turnOn(this.clock.timeMs);
        if (!pumpARes.success) {
          this.failBatch(pumpARes.reason, "DOSING_NUTRIENT_A");
        }
      }
    }

    // -------------------------------------------------------------
    // STAGE: DOSING
    // -------------------------------------------------------------
    else if (batch.state === FERT_STATES.DOSING) {
      if (batch.stageElapsedSec > this.maxDosingRuntimeSec) {
        this.failBatch("DOSING_TIMEOUT_EXCEEDED", "DOSING");
        return;
      }

      // Dosing Nutrient A
      if (batch.dosedA_Ml < batch.targetDosedA_Ml) {
        const addedA = this.pumps.dosingA.step(elapsedSec * 1000);
        batch.dosedA_Ml += addedA;
        tank.addNutrientA(addedA);

        if (batch.dosedA_Ml >= batch.targetDosedA_Ml) {
          this.pumps.dosingA.turnOff(this.clock.timeMs);
          batch.queueEntry.steps[1].status = "COMPLETED";
          batch.queueEntry.steps[2].status = "RUNNING";

          // Start Dosing Nutrient B
          const pumpBRes = this.pumps.dosingB.turnOn(this.clock.timeMs);
          if (!pumpBRes.success) {
            // Scenario P09: Pump A succeeded, Pump B fails
            this.failBatch(pumpBRes.reason, "DOSING_NUTRIENT_B");
            return;
          }
        }
      }
      // Dosing Nutrient B
      else if (batch.dosedB_Ml < batch.targetDosedB_Ml) {
        const addedB = this.pumps.dosingB.step(elapsedSec * 1000);
        batch.dosedB_Ml += addedB;
        tank.addNutrientB(addedB);

        if (batch.dosedB_Ml >= batch.targetDosedB_Ml) {
          this.pumps.dosingB.turnOff(this.clock.timeMs);
          batch.queueEntry.steps[2].status = "COMPLETED";

          // Release central dosing unit lock! Dosing phase complete!
          this.centralDosingLockOwner = null;

          // Transition to FINAL_MIXING
          batch.state = FERT_STATES.FINAL_MIXING;
          batch.stageElapsedSec = 0;
          tank.state = "MIXING";
          batch.queueEntry.steps[3].status = "RUNNING";

          // Start mixing pump
          const mixRes = this.pumps.mixer.turnOn(this.clock.timeMs);
          if (!mixRes.success) {
            // Scenario M11 / P03: Mixing pump fails to start
            this.failBatch(mixRes.reason, "FINAL_MIXING");
          }
        }
      }
    }

    // -------------------------------------------------------------
    // STAGE: FINAL_MIXING
    // -------------------------------------------------------------
    else if (batch.state === FERT_STATES.FINAL_MIXING) {
      batch.mixingElapsedSec += elapsedSec;

      if (batch.mixingElapsedSec >= batch.targetMixingSec) {
        this.pumps.mixer.turnOff(this.clock.timeMs);
        tank.isHomogenized = true;
        batch.queueEntry.steps[3].status = "COMPLETED";
        batch.queueEntry.steps[4].status = "COMPLETED";

        // Transition to MIX_READY
        batch.state = FERT_STATES.MIX_READY;
        tank.state = "READY";
        batch.queueEntry.state = QUEUE_STATES.COMPLETED;

        this.logEvent("BATCH_MIX_READY", `Batch for ${batch.ghId} is mixed and READY. Tank level: ${tank.currentVolumeL} L`);

        // Pop completed batch from queue
        this.dosingQueue.shift();

        // Update occurrence state if linked
        if (batch.queueEntry.occurrenceId) {
          const occ = this.occurrences.find((o) => o.occurrenceId === batch.queueEntry.occurrenceId);
          if (occ) {
            if (this.clock.timeMs >= occ.scheduledTimestamp) {
              occ.state = "DISTRIBUTING";
              this.triggerDelivery(batch.ghId, occ);
            } else {
              occ.state = "READY_TO_SEND";
            }
          }
        }

        this.executionHistory.push({
          batchId: batch.queueEntry.jobId,
          ghId: batch.ghId,
          status: "SUCCESS",
          volumeDeliveredL: tank.currentVolumeL,
          completedAtMs: this.clock.timeMs,
        });

        this.activeBatch = null;
      }
    }
  }

  evaluateDistributions() {
    for (const occ of this.occurrences) {
      if (occ.state === "READY_TO_SEND" && this.clock.timeMs >= occ.scheduledTimestamp) {
        const tank = this.tanks[occ.ghId];
        if (tank.state === "READY" && tank.isHomogenized) {
          occ.state = "DISTRIBUTING";
          this.triggerDelivery(occ.ghId, occ);
        }
      }
    }
  }

  triggerDelivery(ghId, occ) {
    const tank = this.tanks[ghId];
    tank.state = "DELIVERING";
    const pumpKey = `dist${ghId.replace("-", "")}`;
    const distPump = this.pumps[pumpKey];

    if (distPump) {
      distPump.turnOn(this.clock.timeMs);
      this.logEvent("DELIVERY_STARTED", `Distribution pump started for ${ghId}`);

      // Simulate delivery duration (e.g. 5 seconds in simulation)
      tank.drain(tank.currentVolumeMl);
      distPump.turnOff(this.clock.timeMs);
      tank.state = "STANDBY";
      tank.isHomogenized = false;
      if (occ) occ.state = "COMPLETED";

      this.logEvent("DELIVERY_COMPLETED", `Fertigation distribution completed for ${ghId}`);
    }
  }

  failBatch(reason, stage) {
    if (!this.activeBatch) return;

    const batch = this.activeBatch;
    batch.state = FERT_STATES.FAULTED;
    batch.failedStage = stage;
    batch.failReason = reason;

    // Safety shutdown: turn off all active pumps
    this.pumps.water.turnOff(this.clock.timeMs);
    this.pumps.dosingA.turnOff(this.clock.timeMs);
    this.pumps.dosingB.turnOff(this.clock.timeMs);
    this.pumps.mixer.turnOff(this.clock.timeMs);

    // Release central lock safely (Q10)
    this.centralDosingLockOwner = null;

    const tank = this.tanks[batch.ghId];
    tank.state = "FAILED";

    if (batch.queueEntry) {
      batch.queueEntry.state = QUEUE_STATES.FAILED;
      const runningStep = batch.queueEntry.steps.find((s) => s.status === "RUNNING");
      if (runningStep) runningStep.status = "FAILED";
    }

    if (batch.queueEntry.occurrenceId) {
      const occ = this.occurrences.find((o) => o.occurrenceId === batch.queueEntry.occurrenceId);
      if (occ) occ.state = "FAILED";
    }

    this.executionHistory.push({
      batchId: batch.queueEntry.jobId,
      ghId: batch.ghId,
      status: "FAILED",
      reason,
      stage,
      failedAtMs: this.clock.timeMs,
    });

    this.logEvent("BATCH_FAULTED", `Batch for ${batch.ghId} failed at ${stage}: ${reason}`);

    // Pop the failed head from the queue so next job can proceed safely (Q10)
    this.dosingQueue.shift();
    this.activeBatch = null;
  }

  // Simulation of ESP32 Reboot (F06, F07, F08)
  simulateReboot() {
    this.logEvent("SIMULATE_REBOOT", "ESP32 Rebooting...");

    // 1. Hardware safety: all outputs immediately driven OFF
    for (const pump of Object.values(this.pumps)) {
      pump.state = "OFF";
      pump.energizedAtMs = null;
    }

    // 2. In-flight active batch is marked INTERRUPTED
    if (this.activeBatch) {
      const interruptedGh = this.activeBatch.ghId;
      this.logEvent("REBOOT_INTERRUPTED_BATCH", `Active batch for ${interruptedGh} interrupted by power loss.`);
      this.tanks[interruptedGh].state = "INTERRUPTED";
      this.executionHistory.push({
        batchId: this.activeBatch.queueEntry.jobId,
        ghId: interruptedGh,
        status: "INTERRUPTED",
        reason: "ESP32_POWER_LOSS_REBOOT",
        failedAtMs: this.clock.timeMs,
      });
      this.activeBatch = null;
      this.centralDosingLockOwner = null;
      if (this.dosingQueue.length > 0 && this.dosingQueue[0].state === QUEUE_STATES.ACTIVE) {
        this.dosingQueue.shift();
      }
    }

    // 3. Restore pending queue jobs from NVS markers in original order (F06)
    // Filter out active or completed; pending remain in queue
    this.dosingQueue = this.dosingQueue.filter((q) => q.state === QUEUE_STATES.PENDING);
    this.logEvent("REBOOT_COMPLETE", `ESP32 rebooted. ${this.dosingQueue.length} pending jobs restored in queue.`);
  }

  // Simulation of Backend Disconnection / Reconnection (F09)
  setBackendConnection(connected) {
    this.backendConnected = connected;
    this.logEvent("BACKEND_CONNECTION_CHANGED", connected ? "Backend connected" : "Backend offline");
  }
}
