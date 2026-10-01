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
  maxDeviationPct: number;
  isConsistent: boolean;
  errorMessage?: string;
}

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
 */
export function aggregateDosingSamples(samples: CalibrationSample[]): CalibrationAggregateResult {
  if (!samples || samples.length === 0) {
    return {
      valid: false,
      totalVolumeMl: 0,
      totalDurationSec: 0,
      flowRateMlMin: 0,
      rateMlSec: 0,
      rates: [],
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

  let maxDeviationPct = 0;
  if (flowRateMlMin > 0 && rates.length > 1) {
    for (const r of rates) {
      const dev = Math.abs((r - flowRateMlMin) / flowRateMlMin) * 100;
      if (dev > maxDeviationPct) maxDeviationPct = dev;
    }
  }

  // Consistency threshold: <= 10% deviation across samples is considered consistent
  const isConsistent = rates.length <= 1 || maxDeviationPct <= 10.0;

  return {
    valid: true,
    totalVolumeMl,
    totalDurationSec,
    flowRateMlMin,
    rateMlSec,
    rates,
    maxDeviationPct,
    isConsistent,
  };
}
