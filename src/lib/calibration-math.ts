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
