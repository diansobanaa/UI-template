import type { EnvironmentMetric, Greenhouse, SeriesPoint } from "@/lib/types";

/* Base 24H pattern for GH 01 (deterministic — matches reference stats:
   min 24.1, max 32.6, avg ≈ 28.3). */
const TEMP_24H = [26.8, 26.1, 25.4, 24.8, 24.1, 24.9, 26.4, 27.9, 29.3, 30.6, 31.7, 32.5, 32.4, 32.6, 31.9, 30.9, 29.8, 28.9, 28.2, 27.7, 27.3, 26.9, 26.5, 26.0];
const HUM_24H = [80, 81, 82, 83, 84, 82, 79, 76, 72, 68, 65, 62, 60, 58, 59, 62, 66, 70, 73, 76, 78, 80, 81, 82];
const LIGHT_24H = [0, 0, 0, 0, 0, 1.2, 6.5, 14.2, 22.8, 30.5, 36.8, 40.9, 42.3, 41.5, 39.8, 37.2, 33.5, 28.1, 21.4, 13.6, 5.8, 1.4, 0, 0];
const TANK_24H = [82, 84, 86, 88, 90, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 68, 70, 74, 78, 80, 81, 82];
const FERT_24H = [0, 0, 0, 0, 0, 0, 80, 0, 0, 0, 80, 0, 0, 0, 0, 0, 0, 0, 80, 0, 0, 0, 0, 0];

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

const DAY_LABELS_7D = ["27 Aug", "28 Aug", "29 Aug", "30 Aug", "31 Aug", "1 Sep", "2 Sep"];
const DAY_LABELS_30D = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(2026, 7, 4 + i);
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })}`;
});

function series(values: number[], labels: string[]): SeriesPoint[] {
  return labels.map((label, i) => ({ label, value: values[i % values.length] }));
}

function agg(values: number[]) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

function week(values: number[], offset: number): number[] {
  return DAY_LABELS_7D.map((_, i) => values[(i * 5 + offset) % values.length]);
}

function month(values: number[], offset: number): number[] {
  return DAY_LABELS_30D.map((_, i) => values[(i * 3 + offset) % values.length]);
}

type RangeId = "24H" | "7D" | "30D";

interface MetricSpec {
  id: EnvironmentMetric["id"];
  label: string;
  unit: string;
  color: string;
  base: number[];
  current: number | null;
  transform?: (v: number, gh: Greenhouse) => number;
  fmt?: (v: number) => number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function buildPoints(spec: MetricSpec, range: RangeId, gh: Greenhouse): SeriesPoint[] {
  const tr = spec.transform ?? ((v: number) => v);
  if (range === "24H") return series(spec.base.map((v) => round1(tr(v, gh))), HOURS);
  if (range === "7D") return series(week(spec.base, spec.base.length / 4).map((v) => round1(tr(v, gh))), DAY_LABELS_7D);
  return series(month(spec.base, spec.base.length / 8).map((v) => round1(tr(v, gh))), DAY_LABELS_30D);
}

/**
 * Environmental metrics for a greenhouse. Deterministic; GH 01 reproduces the
 * approved reference numbers exactly.
 */
export function environmentMetrics(gh: Greenhouse): EnvironmentMetric[] {
  const tempOffset = (gh.telemetry.temperatureC ?? 27) - 28.4;
  const humOffset = (gh.telemetry.humidityPct ?? 70) - 72;

  const specs: MetricSpec[] = [
    {
      id: "temperature",
      label: "Temperature (°C)",
      unit: "°C",
      color: "#16a34a",
      base: TEMP_24H,
      current: gh.telemetry.temperatureC,
      transform: (v) => v + tempOffset,
    },
    {
      id: "humidity",
      label: "Humidity (%)",
      unit: "%",
      color: "#0ea5e9",
      base: HUM_24H,
      current: gh.telemetry.humidityPct,
      transform: (v) => Math.max(20, Math.min(99, v + humOffset)),
    },
    {
      id: "light",
      label: "Light (klux)",
      unit: "klux",
      color: "#f59e0b",
      base: LIGHT_24H,
      current: gh.telemetry.lightLux !== null ? gh.telemetry.lightLux / 1000 : null,
    },
    {
      id: "tank",
      label: "Mixing Tank (%)",
      unit: "%",
      color: "#6366f1",
      base: TANK_24H,
      current: gh.telemetry.tankPct,
    },
    {
      id: "fertigation",
      label: "Fertigation (L)",
      unit: "L",
      color: "#10b981",
      base: FERT_24H,
      current: 80,
    },
  ];

  const ranges: RangeId[] = ["24H", "7D", "30D"];
  return specs.map((spec) => {
    const points = buildPoints(spec, "24H", gh);
    const values = points.map((p) => p.value);
    const { min, max, avg } = agg(values);
    return {
      id: spec.id,
      label: spec.label,
      unit: spec.unit,
      color: spec.color,
      current: spec.current ?? min,
      min: round1(min),
      max: round1(max),
      avg: round1(avg),
      points,
      // extra ranges carried for the range switcher
      ...({ ranges: Object.fromEntries(ranges.map((r) => [r, buildPoints(spec, r, gh)])) } as object),
    } as EnvironmentMetric & { ranges: Record<RangeId, SeriesPoint[]> };
  });
}

/** Fruit development series (fallback for GHs without explicit series). */
export function fruitDevFor(gh: Greenhouse): { label: string; count: number; weight: number }[] {
  if (gh.fruitDevSeries.length > 0) return gh.fruitDevSeries;
  const n = 6;
  return Array.from({ length: n }, (_, i) => ({
    label: `W${i + 1}`,
    count: Math.round((gh.plants.totalFruits / n) * (i + 1)),
    weight: Math.round((gh.plants.avgFruitWeightG / n) * (i + 1)),
  }));
}
