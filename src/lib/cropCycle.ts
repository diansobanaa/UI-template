import type { CropCycle } from "./types";

/**
 * Returns today's date aligned with the system / simulation reference time.
 */
export function getSystemDate(): Date {
  // If browser date is in 2026, use it; otherwise provide stable fallback
  const now = new Date();
  return now;
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

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

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
 * Calculates days difference between a start date string (YYYY-MM-DD) and a reference date (defaults to today).
 * 24 Jan 2026 to 9 Sep 2026 = 228 days.
 * 24 Feb 2026 to 9 Sep 2026 = 197 days.
 */
export function calculateDaysBetween(startDateStr: string | null | undefined, endDate: Date = getSystemDate()): number {
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

export function computeHst(cycle: CropCycle | undefined | null, refDate: Date = getSystemDate()): number {
  if (!cycle || cycle.status !== "ACTIVE" || !cycle.tanggalTanam) return 0;
  return calculateDaysBetween(cycle.tanggalTanam, refDate);
}

export function computeHsp(cycle: CropCycle | undefined | null, refDate: Date = getSystemDate()): number | null {
  if (!cycle || cycle.status !== "ACTIVE" || !cycle.tanggalPolinasi) return null;
  return calculateDaysBetween(cycle.tanggalPolinasi, refDate);
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
    return { valid: true, warning: `Tanggal tanam lebih dari 1 tahun yang lalu (${daysAgo} hari). Pastikan tanggal sudah benar.` };
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
