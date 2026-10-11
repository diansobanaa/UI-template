/**
 * Dosing Pump Calibration Mathematics & Aggregation Module
 *
 * Canonical Formula:
 * Flow Rate (ml/min) = (Measured Volume (ml) / Actual Duration (sec)) * 60
 * Flow Rate (ml/sec) = Flow Rate (ml/min) / 60 = Measured Volume (ml) / Actual Duration (sec)
 */

export interface CalibrationSample {
  volumeMl: number;
  durationSec: number;
  rateMlMin?: number;
}

export interface CalibrationAggregateResult {
  valid: boolean;
  totalVolumeMl: number;
  totalDurationSec: number;
  flowRateMlMin: number;
  rateMlSec: number;
  rates: number[];
  stageDeviationsPct: number[];
  referenceRateMlMin: number;
  maxDeviationPct: number;
  isConsistent: boolean;
  errorMessage?: string;
}

/**
 * Standard tolerance threshold for dosing pump calibration consistency across durations.
 * Defined as 10.0% deviation from the reference flow rate (median).
 */
export const DOSING_CALIBRATION_CONSISTENCY_TOLERANCE_PCT = 10.0;

/**
 * Calculates flow rate in ml/min from volume and duration.
 * Returns 0 if inputs are non-positive or invalid.
 */
export function calculateDosingFlowRate(volumeMl: number, durationSec: number): number {
  if (!Number.isFinite(volumeMl) || !Number.isFinite(durationSec)) {
    return 0;
  }
  if (volumeMl <= 0 || durationSec <= 0) {
    return 0;
  }
  return (volumeMl / durationSec) * 60;
}

/**
 * Validates volume input for dosing calibration.
 */
export function validateVolumeInput(
  value: string | number,
  durationSec: number
): { valid: boolean; volumeMl: number; error?: string } {
  const num = typeof value === "number" ? value : parseFloat(String(value).trim());
  if (String(value).trim() === "" || !Number.isFinite(num)) {
    return { valid: false, volumeMl: 0, error: "Masukkan volume cairan yang terukur." };
  }
  if (num <= 0) {
    return { valid: false, volumeMl: 0, error: "Volume cairan harus lebih besar dari 0 ml." };
  }
  if (durationSec <= 0 || !Number.isFinite(durationSec)) {
    return { valid: false, volumeMl: 0, error: "Durasi pengujian tidak valid." };
  }
  const flowRate = (num / durationSec) * 60;
  if (flowRate < 1.0) {
    return { valid: false, volumeMl: num, error: `Volume terlalu kecil (${num} ml). Debit terhitung ${flowRate.toFixed(1)} ml/mnt di bawah batas minimum (1 ml/mnt).` };
  }
  if (flowRate > 2500.0) {
    return { valid: false, volumeMl: num, error: `Volume terlalu besar (${num} ml). Debit terhitung ${flowRate.toFixed(1)} ml/mnt melampaui batas pompa (2500 ml/mnt).` };
  }
  return { valid: true, volumeMl: num };
}

/**
 * Aggregates one or multiple calibration samples using weighted duration formula:
 * Final Flow Rate = (Total Measured Volume / Total Actual Duration) * 60
 *
 * For consistency validation across multiple durations (10s, 30s, 60s):
 * Compares each stage rate against the median rate to eliminate single-outlier skew.
 * Maximum allowable deviation is governed by DOSING_CALIBRATION_CONSISTENCY_TOLERANCE_PCT (10.0%).
 */
export function aggregateDosingSamples(
  samples: CalibrationSample[],
  tolerancePct: number = DOSING_CALIBRATION_CONSISTENCY_TOLERANCE_PCT
): CalibrationAggregateResult {
  if (!samples || samples.length === 0) {
    return {
      valid: false,
      totalVolumeMl: 0,
      totalDurationSec: 0,
      flowRateMlMin: 0,
      rateMlSec: 0,
      rates: [],
      stageDeviationsPct: [],
      referenceRateMlMin: 0,
      maxDeviationPct: 0,
      isConsistent: false,
      errorMessage: "Belum ada sampel pengukuran.",
    };
  }

  let totalVolumeMl = 0;
  let totalDurationSec = 0;
  const rates: number[] = [];

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!Number.isFinite(s.volumeMl) || s.volumeMl <= 0 || !Number.isFinite(s.durationSec) || s.durationSec <= 0) {
      return {
        valid: false,
        totalVolumeMl: 0,
        totalDurationSec: 0,
        flowRateMlMin: 0,
        rateMlSec: 0,
        rates: [],
        stageDeviationsPct: [],
        referenceRateMlMin: 0,
        maxDeviationPct: 0,
        isConsistent: false,
        errorMessage: `Sampel ${i + 1} memiliki nilai volume atau durasi yang tidak valid.`,
      };
    }
    totalVolumeMl += s.volumeMl;
    totalDurationSec += s.durationSec;
    rates.push((s.volumeMl / s.durationSec) * 60);
  }

  const flowRateMlMin = totalDurationSec > 0 ? (totalVolumeMl / totalDurationSec) * 60 : 0;
  const rateMlSec = flowRateMlMin / 60;

  // Reference for comparison: Median of rates to prevent single-outlier distortion
  const sortedRates = [...rates].sort((a, b) => a - b);
  const mid = Math.floor(sortedRates.length / 2);
  const referenceRate =
    sortedRates.length % 2 !== 0
      ? sortedRates[mid]
      : (sortedRates[mid - 1] + sortedRates[mid]) / 2;

  const stageDeviationsPct: number[] = [];
  let maxDeviationPct = 0;

  if (referenceRate > 0 && rates.length > 1) {
    for (const r of rates) {
      const dev = Math.abs((r - referenceRate) / referenceRate) * 100;
      stageDeviationsPct.push(dev);
      if (dev > maxDeviationPct) maxDeviationPct = dev;
    }
  } else {
    for (let i = 0; i < rates.length; i++) {
      stageDeviationsPct.push(0);
    }
  }

  // Consistency threshold check
  const isConsistent = rates.length <= 1 || maxDeviationPct <= tolerancePct;

  return {
    valid: true,
    totalVolumeMl,
    totalDurationSec,
    flowRateMlMin,
    rateMlSec,
    rates,
    stageDeviationsPct,
    referenceRateMlMin: referenceRate,
    maxDeviationPct,
    isConsistent,
    errorMessage: isConsistent
      ? undefined
      : `Debit antar tahap tidak konsisten (Deviasi maksimal ${maxDeviationPct.toFixed(1)}% melampaui batas toleransi ${tolerancePct}%). Periksa selang atau tegangan pompa.`,
  };
}

/* ------------------------------------------------------------------ */
/* Raw Water Flow Sensor (ZJ-B1) & Pump Verification Mathematics     */
/* ------------------------------------------------------------------ */

export const FLOW_CALIBRATION_TOLERANCE_PCT = 5.0; // ±5.0% proposed acceptance tolerance

export interface FlowVerificationRun {
  runIndex: number; // 0: initial, 1: validation 1, 2: validation 2
  durationSec: number;
  sessionPulses: number;
  measuredVolumeL: number;
  measuredVolumeMl: number;
  estimatedVolumeL: number;
  estimatedVolumeMl: number;
  calFactorUsed: number;
  candidateFactor: number;
  pumpFlowRateMlSec: number;
  pumpFlowRateLpm: number;
  errorPct: number;
  absDiffL: number;
  isPassed: boolean;
  status: "CALIBRATION_PENDING" | "VERIFIED" | "FAILED";
}

/**
 * Calculates candidate pulses-per-liter factor:
 * K_candidate = N_session_pulses / V_actual_liters
 */
export function calculateCandidateFlowK(sessionPulses: number, actualVolumeL: number): number {
  if (!Number.isFinite(sessionPulses) || !Number.isFinite(actualVolumeL)) return 0;
  if (sessionPulses <= 0 || actualVolumeL <= 0) return 0;
  return sessionPulses / actualVolumeL;
}

/**
 * Calculates raw water pump flow rate from physical measurement:
 * Q_actual_ml_sec = V_actual_ml / t_session_sec
 * Q_actual_lpm = (Q_actual_ml_sec * 60) / 1000
 */
export function calculateRawPumpRate(volumeMl: number, durationSec: number): { mlPerSec: number; lPerMin: number } {
  if (!Number.isFinite(volumeMl) || !Number.isFinite(durationSec) || volumeMl <= 0 || durationSec <= 0) {
    return { mlPerSec: 0, lPerMin: 0 };
  }
  const mlPerSec = volumeMl / durationSec;
  const lPerMin = (mlPerSec * 60) / 1000;
  return { mlPerSec, lPerMin };
}

/**
 * Calculates estimated volume from session pulses and calibration factor:
 * V_estimated_liters = N_session_pulses / K_pulses_per_l
 */
export function calculateEstimatedFlowVolume(sessionPulses: number, pulsesPerL: number): { volumeL: number; volumeMl: number } {
  if (!Number.isFinite(sessionPulses) || !Number.isFinite(pulsesPerL) || sessionPulses <= 0 || pulsesPerL <= 0) {
    return { volumeL: 0, volumeMl: 0 };
  }
  const volumeL = sessionPulses / pulsesPerL;
  const volumeMl = volumeL * 1000;
  return { volumeL, volumeMl };
}

/**
 * Calculates verification percentage error between estimated and actual volume:
 * E_% = (|V_estimated - V_actual| / V_actual) * 100%
 */
export function calculateFlowVerificationError(
  estimatedVolumeL: number,
  actualVolumeL: number,
  tolerancePct: number = FLOW_CALIBRATION_TOLERANCE_PCT
): { errorPct: number; absDiffL: number; isPassed: boolean; message: string } {
  if (!Number.isFinite(estimatedVolumeL) || !Number.isFinite(actualVolumeL) || actualVolumeL <= 0) {
    return { errorPct: 0, absDiffL: 0, isPassed: false, message: "Volume fisik tidak valid." };
  }
  const absDiffL = Math.abs(estimatedVolumeL - actualVolumeL);
  const errorPct = (absDiffL / actualVolumeL) * 100;
  const isPassed = errorPct <= tolerancePct;
  const message = isPassed
    ? `Deviasi ${errorPct.toFixed(2)}% dalam batas toleransi ±${tolerancePct.toFixed(1)}%.`
    : `Deviasi ${errorPct.toFixed(2)}% melampaui batas toleransi ±${tolerancePct.toFixed(1)}%. Verifikasi belum lolos.`;
  return { errorPct, absDiffL, isPassed, message };
}

/**
 * Validates physical volume input (in liters).
 * Rejects negative, zero, non-finite, or absurdly large/small volumes.
 */
export function validatePhysicalVolumeInput(
  value: string | number,
  durationSec: number
): { valid: boolean; volumeL: number; volumeMl: number; error?: string } {
  const num = typeof value === "number" ? value : parseFloat(String(value).trim());
  if (String(value).trim() === "" || !Number.isFinite(num)) {
    return { valid: false, volumeL: 0, volumeMl: 0, error: "Masukkan volume fisik cairan hasil penampungan." };
  }
  if (num <= 0) {
    return { valid: false, volumeL: 0, volumeMl: 0, error: "Volume fisik cairan harus lebih besar dari 0 Liter." };
  }
  if (durationSec <= 0 || !Number.isFinite(durationSec)) {
    return { valid: false, volumeL: 0, volumeMl: 0, error: "Durasi pengujian tidak valid." };
  }
  // Sanity check for 12V submersible pump (typical 1-30 L/min)
  const lpm = (num / durationSec) * 60;
  if (lpm < 0.1) {
    return { valid: false, volumeL: num, volumeMl: num * 1000, error: `Volume terlalu kecil (${num} L dalam ${durationSec}s = ${lpm.toFixed(2)} L/mnt). Periksa apakah pompa menyala dan air mengalir.` };
  }
  if (lpm > 60.0) {
    return { valid: false, volumeL: num, volumeMl: num * 1000, error: `Volume terlalu besar (${num} L dalam ${durationSec}s = ${lpm.toFixed(2)} L/mnt). Melampaui kapasitas pompa air baku 12V.` };
  }
  return { valid: true, volumeL: num, volumeMl: num * 1000 };
}

/**
 * Mixing Protocol Timing & Hardware Execution Analysis
 */
export interface MixingPumpTiming {
  componentId: string;
  name: string;
  role: "raw_water" | "dosing" | "mixing_pump" | "post_mix";
  targetMl?: number;
  rateMlSec: number;
  rateMlMin: number;
  runtimeSec: number;
  startTimeSec: number;
  endTimeSec: number;
  timeoutSec: number;
  controlType: "pulse_sensor" | "timed" | "state_dependent";
  isCalibrated: boolean;
}

export interface MixingTimingAnalysisInput {
  rawWaterTargetMl: number;
  rawWaterRateMlSec: number;
  flowPulsesPerL?: number;
  thresholdPercent: number;
  postMixDurationSec: number;
  channels: Array<{
    componentId: string;
    name?: string;
    targetVolumeMl: number;
    rateMlSec: number;
    isCalibrated?: boolean;
  }>;
}

export interface MixingTimingAnalysisResult {
  rawWaterTargetMl: number;
  rawWaterPulses: number;
  pulsesPerLiter: number;
  thresholdPercent: number;
  thresholdVolumeMl: number;
  thresholdReachedTimeSec: number;
  postMixDurationSec: number;

  rawWaterPump: MixingPumpTiming;
  mixingPump: MixingPumpTiming;
  dosingChannels: MixingPumpTiming[];

  longestDosingChannelId: string;
  longestDosingDurationSec: number;
  dosingFinishTimeSec: number;

  postMixStartTimeSec: number;
  postMixEndTimeSec: number;

  totalTheoreticalTimeSec: number;
  totalRealMinTimeSec: number;
  totalRealMaxTimeSec: number;
  maxSafeTimeoutSec: number;
}

/**
 * Calculates end-to-end multi-pump timing analysis for canonical protocol_mixing().
 * Mirrors state machine in esp32/main/services/protocol_mixing.c.
 */
export function calculateMixingTimingAnalysis(input: MixingTimingAnalysisInput): MixingTimingAnalysisResult {
  const rawTargetMl = Math.max(0, input.rawWaterTargetMl || 0);
  const rawRateMlSec = Math.max(0.1, input.rawWaterRateMlSec || 147.33);
  const pulsesPerL = Math.max(1, input.flowPulsesPerL || 660.0);
  const thresholdPct = Math.min(100, Math.max(0, input.thresholdPercent ?? 20));
  const postMixSec = Math.max(0, input.postMixDurationSec ?? 30);

  // 1. Raw Water Pump (Volumetric via Flow Meter Pulses)
  const rawWaterPulses = Math.round((rawTargetMl / 1000.0) * pulsesPerL);
  const rawRuntimeSec = rawTargetMl > 0 ? rawTargetMl / rawRateMlSec : 0;
  const rawTimeoutSec = rawRuntimeSec * 1.5;

  const rawWaterPump: MixingPumpTiming = {
    componentId: "pump_submersible",
    name: "Pompa Air Baku 12V",
    role: "raw_water",
    targetMl: rawTargetMl,
    rateMlSec: rawRateMlSec,
    rateMlMin: rawRateMlSec * 60,
    runtimeSec: Number(rawRuntimeSec.toFixed(2)),
    startTimeSec: 0,
    endTimeSec: Number(rawRuntimeSec.toFixed(2)),
    timeoutSec: Number(rawTimeoutSec.toFixed(2)),
    controlType: "pulse_sensor",
    isCalibrated: input.rawWaterRateMlSec > 0,
  };

  // 2. Threshold Dosing Trigger
  const thresholdVolumeMl = (rawTargetMl * thresholdPct) / 100.0;
  const thresholdReachedTimeSec = rawTargetMl > 0 && rawRateMlSec > 0
    ? thresholdVolumeMl / rawRateMlSec
    : 0;

  // 3. Dosing Channels (Parallel / Simultan execution)
  let longestDosingSec = 0;
  let longestChannelId = "";
  const dosingChannels: MixingPumpTiming[] = (input.channels || []).map((ch, idx) => {
    const rate = Math.max(0.01, ch.rateMlSec || 1.67);
    const targetMl = Math.max(0, ch.targetVolumeMl || 0);
    const runSec = targetMl > 0 ? targetMl / rate : 0;
    const startSec = thresholdReachedTimeSec;
    const endSec = startSec + runSec;
    const timeoutSec = runSec * 1.5;

    if (runSec > longestDosingSec) {
      longestDosingSec = runSec;
      longestChannelId = ch.componentId;
    }

    return {
      componentId: ch.componentId,
      name: ch.name || `Pompa Dosing ${idx + 1}`,
      role: "dosing",
      targetMl,
      rateMlSec: rate,
      rateMlMin: rate * 60,
      runtimeSec: Number(runSec.toFixed(2)),
      startTimeSec: Number(startSec.toFixed(2)),
      endTimeSec: Number(endSec.toFixed(2)),
      timeoutSec: Number(timeoutSec.toFixed(2)),
      controlType: "timed",
      isCalibrated: ch.isCalibrated ?? true,
    };
  });

  const dosingFinishTimeSec = thresholdReachedTimeSec + longestDosingSec;

  // 4. Post-Mix Agitation (starts strictly when raw water target reached AND all dosing finished)
  const postMixStartTimeSec = Math.max(rawRuntimeSec, dosingFinishTimeSec);
  const postMixEndTimeSec = postMixStartTimeSec + postMixSec;

  // 5. Mixing Pump (Agitation pump active from threshold trigger until post-mix completion)
  const mixingPumpRuntimeSec = Math.max(0, postMixEndTimeSec - thresholdReachedTimeSec);
  const mixingPump: MixingPumpTiming = {
    componentId: "mixing_pump",
    name: "Pompa Pengaduk (Mixing Pump)",
    role: "mixing_pump",
    rateMlSec: 0,
    rateMlMin: 0,
    runtimeSec: Number(mixingPumpRuntimeSec.toFixed(2)),
    startTimeSec: Number(thresholdReachedTimeSec.toFixed(2)),
    endTimeSec: Number(postMixEndTimeSec.toFixed(2)),
    timeoutSec: Number((mixingPumpRuntimeSec * 1.5).toFixed(2)),
    controlType: "state_dependent",
    isCalibrated: true,
  };

  // 6. Total times
  const totalTheoreticalTimeSec = Number(postMixEndTimeSec.toFixed(2));
  // Real-world operational envelope: incorporates 100ms task delay, relay actuation, and hydraulic variance
  const totalRealMinTimeSec = Number((totalTheoreticalTimeSec * 0.98).toFixed(1));
  const totalRealMaxTimeSec = Number((totalTheoreticalTimeSec * 1.03 + 2).toFixed(1));
  const maxSafeTimeoutSec = Number((Math.max(rawTimeoutSec, thresholdReachedTimeSec + (longestDosingSec * 1.5)) + postMixSec).toFixed(1));

  return {
    rawWaterTargetMl: rawTargetMl,
    rawWaterPulses,
    pulsesPerLiter: pulsesPerL,
    thresholdPercent: thresholdPct,
    thresholdVolumeMl: Number(thresholdVolumeMl.toFixed(1)),
    thresholdReachedTimeSec: Number(thresholdReachedTimeSec.toFixed(2)),
    postMixDurationSec: postMixSec,
    rawWaterPump,
    mixingPump,
    dosingChannels,
    longestDosingChannelId: longestChannelId,
    longestDosingDurationSec: Number(longestDosingSec.toFixed(2)),
    dosingFinishTimeSec: Number(dosingFinishTimeSec.toFixed(2)),
    postMixStartTimeSec: Number(postMixStartTimeSec.toFixed(2)),
    postMixEndTimeSec: Number(postMixEndTimeSec.toFixed(2)),
    totalTheoreticalTimeSec,
    totalRealMinTimeSec,
    totalRealMaxTimeSec,
    maxSafeTimeoutSec,
  };
}

