import { deviceClock } from "./device-clock";
import { getOperationalSnapshot } from "./operational-state";

function currentDate(): Date {
  return deviceClock.getTime();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

/** Live real system clock tied to ESP32 RTC */
export const SYSTEM_NOW = {
  get date() { return currentDate(); },
  get label() { return formatDate(currentDate()); },
  get time() { return formatTime(currentDate()); },
  get dateTime() { const date = currentDate(); return `${date.getDate()} ${date.toLocaleDateString("en-GB", { month: "short", year: "numeric" })} ${formatTime(date)}`; },
  get longDateTime() { return this.dateTime; },
  get dayPct() { return deviceClock.getDayPct(); },
  get dayFraction() { return deviceClock.getDayFraction(); },
};

export function n(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return value.toLocaleString("en-US");
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return `${value}%`;
}

export function delta(value: number | null | undefined, suffix = "%"): string {
  if (value === null || value === undefined) return "–";
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${Math.abs(value)}${suffix}`;
}

export function lux(value: number | null): string {
  if (value === null) return "–";
  return `${n(value)} lux`;
}

/** Human-readable greenhouse display name resolver */
export function formatGreenhouseName(
  gh: { id?: string; code?: string; greenhouseTag?: string; crop?: string } | undefined | null,
  fallbackIndex?: number
): string {
  if (!gh) return fallbackIndex !== undefined ? `GH-${String(fallbackIndex + 1).padStart(2, "0")}` : "GH-01";

  const candidate = (gh.code || gh.greenhouseTag || "").trim();
  // If candidate is already a human-friendly label like "GH-01", "GH-1", "Greenhouse 1"
  if (candidate && !/^[a-z0-9]{6,}$/i.test(candidate) && !/^gh-[a-z0-9]{4,}$/i.test(candidate)) {
    return candidate;
  }

  // If fallback index is not provided, try to find greenhouse in snapshot
  if (fallbackIndex === undefined && gh?.id) {
    try {
      const snap = getOperationalSnapshot();
      const idx = snap?.greenhouses?.findIndex((g) => g.id === gh.id);
      if (idx !== undefined && idx >= 0) {
        fallbackIndex = idx;
      }
    } catch {}
  }

  // If fallback index is provided (or resolved above), format as GH-01, GH-02
  if (fallbackIndex !== undefined) {
    return `GH-${String(fallbackIndex + 1).padStart(2, "0")}`;
  }

  // If id matches gh-01 or gh-1
  if (gh.id && /^gh-?(\d+)$/i.test(gh.id)) {
    const num = gh.id.match(/^gh-?(\d+)$/i)?.[1];
    return `GH-${String(num).padStart(2, "0")}`;
  }

  return "GH-01";
}


