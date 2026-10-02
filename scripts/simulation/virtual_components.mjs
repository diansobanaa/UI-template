/**
 * Virtual Hardware Components for Fertigation & Mixing Simulation
 * Supports deterministic virtual clock, virtual pumps, virtual sensors,
 * virtual mixing tanks, and rigorous fault injection.
 */

export class VirtualClock {
  constructor(initialIsoString = "2026-10-02T06:00:00.000Z") {
    this.nowMs = new Date(initialIsoString).getTime();
  }

  get timeMs() {
    return this.nowMs;
  }

  get currentMinutes() {
    const d = new Date(this.nowMs);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }

  formatTime() {
    const d = new Date(this.nowMs);
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  advanceMs(ms) {
    if (ms < 0) throw new Error("Cannot move clock backwards");
    this.nowMs += ms;
    return this.nowMs;
  }

  advanceSeconds(sec) {
    return this.advanceMs(sec * 1000);
  }

  advanceMinutes(min) {
    return this.advanceMs(min * 60 * 1000);
  }

  advanceToHourMinute(hour, minute) {
    const d = new Date(this.nowMs);
    d.setUTCHours(hour, minute, 0, 0);
    if (d.getTime() < this.nowMs) {
      // Advance to next day if target is in past
      d.setUTCDate(d.getUTCDate() + 1);
    }
    this.nowMs = d.getTime();
    return this.nowMs;
  }
}

export class VirtualPump {
  constructor(id, name, type, defaultRateMlSec = 100) {
    this.id = id;
    this.name = name;
    this.type = type; // "WATER" | "DOSING_A" | "DOSING_B" | "MIXING" | "DISTRIBUTION"
    this.state = "OFF"; // "OFF" | "ON"
    this.defaultRateMlSec = defaultRateMlSec;
    this.calibration = {
      calibrationId: `CAL-${id.toUpperCase()}-V1`,
      version: 1,
      flowRateMlSec: defaultRateMlSec,
      valid: true,
    };
    this.energizedAtMs = null;
    this.totalRunMs = 0;
    this.totalDispensedMl = 0;

    // Fault injection flags
    this.faults = {
      failsToStart: false,
      stopsUnexpectedlyAtMs: null,
      runsWithoutFlow: false,
      insufficientFlowFactor: null, // e.g. 0.25 (25% rate)
      failsToStop: false,
      invalidFeedback: false,
      invalidCalibration: false,
      secondaryShutdownInvoked: false,
    };
  }

  setCalibration(flowRateMlSec, valid = true, version = 1) {
    this.calibration = {
      calibrationId: `CAL-${this.id.toUpperCase()}-V${version}`,
      version,
      flowRateMlSec,
      valid: valid && flowRateMlSec > 0 && Number.isFinite(flowRateMlSec),
    };
  }

  turnOn(nowMs) {
    if (this.faults.invalidCalibration || !this.calibration.valid || this.calibration.flowRateMlSec <= 0) {
      return { success: false, reason: "INVALID_PUMP_CALIBRATION" };
    }
    if (this.faults.failsToStart) {
      return { success: false, reason: "PUMP_FAILED_TO_START" };
    }
    this.state = "ON";
    this.energizedAtMs = nowMs;
    return { success: true };
  }

  turnOff(nowMs) {
    if (this.faults.failsToStop) {
      this.faults.secondaryShutdownInvoked = true;
      return { success: false, reason: "PUMP_FAILED_TO_STOP_SECONDARY_SHUTDOWN_INVOKED" };
    }
    if (this.state === "ON" && this.energizedAtMs !== null) {
      const elapsed = Math.max(0, nowMs - this.energizedAtMs);
      this.totalRunMs += elapsed;
    }
    this.state = "OFF";
    this.energizedAtMs = null;
    return { success: true };
  }

  step(stepDurationMs) {
    if (this.state !== "ON") return 0;

    if (this.faults.runsWithoutFlow) {
      return 0;
    }

    let rate = this.calibration.flowRateMlSec;
    if (this.faults.insufficientFlowFactor !== null) {
      rate *= this.faults.insufficientFlowFactor;
    }

    const dispensed = (rate * stepDurationMs) / 1000;
    this.totalDispensedMl += dispensed;
    return dispensed;
  }
}

export class VirtualSensor {
  constructor(id, name, type) {
    this.id = id;
    this.name = name;
    this.type = type; // "VOLUME_LEVEL" | "FLOW_METER" | "FLOAT_LOW" | "FLOAT_HIGH"

    this.faults = {
      notInstalled: false,
      disconnected: false,
      alwaysZero: false,
      alwaysFull: false,
      unstableReadings: false,
      unstableCounter: 0,
      invalidFeedback: false,
    };
  }

  getVolumeReading(actualLiters, capacityL) {
    if (this.faults.notInstalled) return null;
    if (this.faults.disconnected) return null;
    if (this.faults.alwaysZero) return 0;
    if (this.faults.alwaysFull) return capacityL;
    if (this.faults.unstableReadings) {
      this.faults.unstableCounter++;
      // Fluctuates between erratic values
      return this.faults.unstableCounter % 2 === 0 ? capacityL * 0.95 : 2.5;
    }
    if (this.faults.invalidFeedback) return NaN;
    return actualLiters;
  }

  getFlowReading(actualFlowMlSec) {
    if (this.faults.notInstalled || this.faults.disconnected) return null;
    if (this.faults.alwaysZero) return 0;
    if (this.faults.invalidFeedback) return NaN;
    return actualFlowMlSec;
  }
}

export class VirtualMixingTank {
  constructor(tankId, ghId, capacityL = 300) {
    this.tankId = tankId;
    this.ghId = ghId;
    this.capacityL = capacityL;
    this.waterVolumeMl = 0;
    this.nutrientA_Ml = 0;
    this.nutrientB_Ml = 0;
    this.isMixingActive = false;
    this.isHomogenized = false;
    this.state = "STANDBY"; // "STANDBY" | "FILLING" | "DOSING" | "MIXING" | "READY" | "DELIVERING" | "FAILED"
    this.overflowOccurred = false;
  }

  get currentVolumeMl() {
    return this.waterVolumeMl + this.nutrientA_Ml + this.nutrientB_Ml;
  }

  get currentVolumeL() {
    return Number((this.currentVolumeMl / 1000).toFixed(1));
  }

  get levelPct() {
    if (this.capacityL <= 0) return 0;
    return Math.min(100, Math.max(0, (this.currentVolumeL / this.capacityL) * 100));
  }

  addWater(ml) {
    this.waterVolumeMl += ml;
    if (this.currentVolumeL > this.capacityL) {
      this.overflowOccurred = true;
    }
    this.isHomogenized = false;
  }

  addNutrientA(ml) {
    this.nutrientA_Ml += ml;
    this.isHomogenized = false;
  }

  addNutrientB(ml) {
    this.nutrientB_Ml += ml;
    this.isHomogenized = false;
  }

  drain(ml) {
    const drainAmount = Math.min(this.waterVolumeMl, ml);
    this.waterVolumeMl = Math.max(0, this.waterVolumeMl - drainAmount);
    this.nutrientA_Ml = Math.max(0, this.nutrientA_Ml - (this.nutrientA_Ml > 0 ? (drainAmount / (this.waterVolumeMl + 1)) * this.nutrientA_Ml : 0));
    this.nutrientB_Ml = Math.max(0, this.nutrientB_Ml - (this.nutrientB_Ml > 0 ? (drainAmount / (this.waterVolumeMl + 1)) * this.nutrientB_Ml : 0));
  }

  reset() {
    this.waterVolumeMl = 0;
    this.nutrientA_Ml = 0;
    this.nutrientB_Ml = 0;
    this.isMixingActive = false;
    this.isHomogenized = false;
    this.state = "STANDBY";
    this.overflowOccurred = false;
  }
}
