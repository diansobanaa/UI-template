import type { CropCycle, Greenhouse } from "./types";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
];

/**
 * Returns reference system date (2026-based or current system date).
 */
export function getSystemDate(): Date {
  return new Date();
}

export function parseDateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatIndoDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "–";
  try {
    const d = parseDateString(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

/**
 * Calculate difference in whole days between start date and end date.
 */
export function calculateDaysBetween(
  startDateStr: string | null | undefined,
  endDate: Date = getSystemDate()
): number {
  if (!startDateStr) return 0;
  try {
    const start = parseDateString(startDateStr);
    const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const endMidnight = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
    const diffMs = endMidnight - startMidnight;
    if (diffMs < 0) return 0;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

export interface CropBenchmark {
  targetHst: number;
  targetHsp: number;
  polinasiTypicalHst: number;
}

export const CROP_BENCHMARKS: Record<string, CropBenchmark> = {
  tomato: { targetHst: 92, targetHsp: 45, polinasiTypicalHst: 35 },
  strawberry: { targetHst: 80, targetHsp: 35, polinasiTypicalHst: 28 },
  melon: { targetHst: 85, targetHsp: 42, polinasiTypicalHst: 32 },
  paprika: { targetHst: 100, targetHsp: 50, polinasiTypicalHst: 42 },
  default: { targetHst: 90, targetHsp: 40, polinasiTypicalHst: 35 },
};

export function getCropBenchmark(cropName: string): CropBenchmark {
  const key = cropName.toLowerCase().trim();
  return CROP_BENCHMARKS[key] ?? CROP_BENCHMARKS.default;
}

export interface CropPhase {
  name: string;
  startHst: number;
  endHst: number;
}

export const CROP_PHASES: Record<string, CropPhase[]> = {
  tomato: [
    { name: "Semai", startHst: 0, endHst: 14 },
    { name: "Vegetatif", startHst: 15, endHst: 35 },
    { name: "Generatif", startHst: 36, endHst: 65 },
    { name: "Pematangan", startHst: 66, endHst: 85 },
    { name: "Panen", startHst: 86, endHst: 100 },
  ],
  strawberry: [
    { name: "Semai", startHst: 0, endHst: 10 },
    { name: "Vegetatif", startHst: 11, endHst: 25 },
    { name: "Berbunga", startHst: 26, endHst: 45 },
    { name: "Pembuahan", startHst: 46, endHst: 65 },
    { name: "Panen", startHst: 66, endHst: 80 },
  ],
  melon: [
    { name: "Semai", startHst: 0, endHst: 14 },
    { name: "Vegetatif", startHst: 15, endHst: 30 },
    { name: "Generatif", startHst: 31, endHst: 55 },
    { name: "Pematangan", startHst: 56, endHst: 75 },
    { name: "Panen", startHst: 76, endHst: 90 },
  ],
  default: [
    { name: "Semai", startHst: 0, endHst: 14 },
    { name: "Vegetatif", startHst: 15, endHst: 35 },
    { name: "Generatif", startHst: 36, endHst: 60 },
    { name: "Pematangan", startHst: 61, endHst: 80 },
    { name: "Panen", startHst: 81, endHst: 100 },
  ],
};

export function getCropPhases(cropName: string): CropPhase[] {
  return CROP_PHASES[cropName.toLowerCase().trim()] ?? CROP_PHASES.default;
}

export function getCurrentPhase(hst: number, cropName: string): CropPhase | null {
  const phases = getCropPhases(cropName);
  return phases.find((p) => hst >= p.startHst && hst <= p.endHst) ?? phases[phases.length - 1];
}

export function getPhaseProgress(hst: number, cropName: string): number {
  const phases = getCropPhases(cropName);
  const totalHst = phases[phases.length - 1].endHst;
  return Math.min(100, Math.max(0, (hst / totalHst) * 100));
}

export interface CropCalculatedMetrics {
  hst: number;
  hsp: number | null;
  phaseLabel: string;
  phaseDescription: string;
  isHarvestReady: boolean;
  harvestBadgeLabel: string;
  estimatedHarvestDate: string | null;
}

/**
 * Process greenhouse crop cycle data into real-time metrics, growth phases, and harvest readiness.
 */
export function processCropCycle(gh: Greenhouse): CropCalculatedMetrics {
  const cycle = gh.cropCycle;
  if (!cycle || cycle.status !== "ACTIVE" || !cycle.tanggalTanam) {
    return {
      hst: gh.telemetry.hstDays || 0,
      hsp: gh.telemetry.hspDays,
      phaseLabel: "Belum Ada Siklus",
      phaseDescription: "Greenhouse belum memiliki siklus aktif",
      isHarvestReady: false,
      harvestBadgeLabel: "Belum aktif",
      estimatedHarvestDate: null,
    };
  }

  // Use telemetry days if set explicitly, otherwise calculate
  const hst = gh.telemetry.hstDays > 0 ? gh.telemetry.hstDays : calculateDaysBetween(cycle.tanggalTanam);
  const hsp = cycle.tanggalPolinasi
    ? (gh.telemetry.hspDays !== null && gh.telemetry.hspDays !== undefined
        ? gh.telemetry.hspDays
        : calculateDaysBetween(cycle.tanggalPolinasi))
    : null;

  const benchmark = getCropBenchmark(gh.crop);

  let phaseLabel = "Fase Vegetatif";
  let phaseDescription = "Umur tanaman aktif";
  let isHarvestReady = false;
  let harvestBadgeLabel = "Belum siap panen";

  if (hsp !== null) {
    phaseLabel = "Fase Pembuahan";
    phaseDescription = "Fase pembuahan";
    if (hsp >= benchmark.targetHsp || hst >= benchmark.targetHst) {
      isHarvestReady = true;
      harvestBadgeLabel = "Siap dieksekusi";
      phaseDescription = "Buah telah matang, siap dipanen";
    } else {
      isHarvestReady = hsp >= 14; // Ready for operator checkpoint if over 2 weeks after pollination
      harvestBadgeLabel = isHarvestReady ? "Siap dieksekusi" : `~${benchmark.targetHsp - hsp} hari lagi`;
    }
  } else {
    if (hst >= benchmark.polinasiTypicalHst) {
      phaseLabel = "Fase Pembungaan";
      phaseDescription = "Siap untuk pencatatan polinasi";
    }
  }

  // Projected harvest date
  let estimatedHarvestDate: string | null = null;
  if (cycle.tanggalPolinasi) {
    const polDate = parseDateString(cycle.tanggalPolinasi);
    polDate.setDate(polDate.getDate() + benchmark.targetHsp);
    estimatedHarvestDate = toIsoDateString(polDate);
  } else {
    const tanamDate = parseDateString(cycle.tanggalTanam);
    tanamDate.setDate(tanamDate.getDate() + benchmark.targetHst);
    estimatedHarvestDate = toIsoDateString(tanamDate);
  }

  return {
    hst,
    hsp,
    phaseLabel,
    phaseDescription,
    isHarvestReady,
    harvestBadgeLabel,
    estimatedHarvestDate,
  };
}

export function validateTanggalTanam(tanggalTanam: string): { valid: boolean; error?: string; warning?: string } {
  if (!tanggalTanam || !tanggalTanam.trim()) {
    return { valid: false, error: "Tanggal tanam harus diisi." };
  }
  const date = parseDateString(tanggalTanam);
  if (isNaN(date.getTime())) {
    return { valid: false, error: "Format tanggal tanam tidak valid." };
  }
  const today = getSystemDate();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (dateMidnight > todayMidnight) {
    return { valid: false, error: "Tanggal tanam tidak boleh di masa depan." };
  }

  const daysAgo = Math.floor((todayMidnight - dateMidnight) / (1000 * 60 * 60 * 24));
  if (daysAgo > 365) {
    return { valid: true, warning: `Tanggal tanam lebih dari 1 tahun lalu (${daysAgo} hari). Pastikan tanggal sudah benar.` };
  }

  return { valid: true };
}

export function validateTanggalPolinasi(
  tanggalPolinasi: string,
  tanggalTanam: string | null | undefined
): { valid: boolean; error?: string } {
  if (!tanggalPolinasi || !tanggalPolinasi.trim()) {
    return { valid: false, error: "Tanggal polinasi harus diisi." };
  }
  const polDate = parseDateString(tanggalPolinasi);
  if (isNaN(polDate.getTime())) {
    return { valid: false, error: "Format tanggal polinasi tidak valid." };
  }
  const today = getSystemDate();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const polMidnight = new Date(polDate.getFullYear(), polDate.getMonth(), polDate.getDate()).getTime();

  if (polMidnight > todayMidnight) {
    return { valid: false, error: "Tanggal polinasi tidak boleh di masa depan." };
  }

  if (tanggalTanam) {
    const tanamDate = parseDateString(tanggalTanam);
    const tanamMidnight = new Date(tanamDate.getFullYear(), tanamDate.getMonth(), tanamDate.getDate()).getTime();
    if (polMidnight < tanamMidnight) {
      return { valid: false, error: "Tanggal polinasi tidak boleh lebih awal dari tanggal tanam." };
    }
  }

  return { valid: true };
}
