/**
 * Deterministic "now" for the prototype — the whole UI is frozen at the
 * moment captured by the approved reference screenshots so every screen and
 * mock computation stays internally consistent.
 */
export const MOCK_NOW = {
  date: new Date(2026, 8, 2, 13, 14, 32), // Tue, 2 Sep 2026 13:14:32
  label: "Tue, 2 Sep 2026",
  time: "13:14:32",
  dateTime: "2 Sep 2026 13:14:32",
  longDateTime: "2 Sep 2026 13:14:32",
  dayPct: ((13 * 60 + 14) / (24 * 60)) * 100, // position of "Now" on the timeline
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
