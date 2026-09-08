const SIMULATION_START = new Date(2026, 8, 2, 13, 14, 32).getTime();
const REAL_START = Date.now();

function currentSimulationDate(): Date {
  return new Date(SIMULATION_START + (Date.now() - REAL_START));
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

/** Live deterministic clock: mock data starts at the approved reference time and advances with the browser. */
export const MOCK_NOW = {
  get date() { return currentSimulationDate(); },
  get label() { return formatDate(currentSimulationDate()); },
  get time() { return formatTime(currentSimulationDate()); },
  get dateTime() { const date = currentSimulationDate(); return `${date.getDate()} ${date.toLocaleDateString("en-US", { month: "short", year: "numeric" })} ${formatTime(date)}`; },
  get longDateTime() { return this.dateTime; },
  get dayPct() { const date = currentSimulationDate(); return ((date.getHours() * 60 + date.getMinutes()) / 1440) * 100; },
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
