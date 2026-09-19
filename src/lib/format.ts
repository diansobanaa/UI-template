function currentDate(): Date {
  return new Date();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

/** Live real system clock */
export const SYSTEM_NOW = {
  get date() { return currentDate(); },
  get label() { return formatDate(currentDate()); },
  get time() { return formatTime(currentDate()); },
  get dateTime() { const date = currentDate(); return `${date.getDate()} ${date.toLocaleDateString("en-US", { month: "short", year: "numeric" })} ${formatTime(date)}`; },
  get longDateTime() { return this.dateTime; },
  get dayPct() { const date = currentDate(); return ((date.getHours() * 60 + date.getMinutes()) / 1440) * 100; },
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
