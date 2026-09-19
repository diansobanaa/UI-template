import type { TelemetryHistoryResponse, TelemetrySample, TelemetrySnapshot } from "@/lib/api/contracts";
import type { EnvironmentMetric, Greenhouse, SeriesPoint } from "@/lib/types";

type RangeId = "24H" | "7D" | "30D";

const METRIC_DEFS: Array<{ id: EnvironmentMetric["id"]; label: string; unit: string; metricIds: string[] }> = [
  { id: "temperature", label: "Temperature (°C)", unit: "°C", metricIds: ["TEMPERATURE"] },
  { id: "humidity", label: "Humidity (%)", unit: "%", metricIds: ["HUMIDITY"] },
  { id: "light", label: "Light (klux)", unit: "klux", metricIds: ["LIGHT"] },
  { id: "tank", label: "Water/Tank Level (%)", unit: "%", metricIds: ["LEVEL"] },
  { id: "fertigation", label: "Fertigation (L)", unit: "L", metricIds: ["FERTIGATION", "FLOW"] },
];

function usable(sample: TelemetrySample): boolean {
  return sample.measurementType === "MEASURED" && sample.quality === "GOOD" && typeof sample.value === "number" && Number.isFinite(sample.value);
}

function valueForMetric(sample: TelemetrySample, metricId: EnvironmentMetric["id"]): number | null {
  if (!usable(sample)) return null;
  const value = sample.value as number;
  return metricId === "light" ? value / 1000 : value;
}

function samplesForMetric(samples: TelemetrySample[], metricId: EnvironmentMetric["id"]): TelemetrySample[] {
  const accepted = new Set(METRIC_DEFS.find((x) => x.id === metricId)?.metricIds ?? []);
  return samples.filter((sample) => accepted.has(String(sample.metricId || "").toUpperCase()));
}

function pointsForRange(samples: TelemetrySample[], metricId: EnvironmentMetric["id"], hours: number): SeriesPoint[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return samplesForMetric(samples, metricId)
    .filter((sample) => {
      const time = Date.parse(sample.deviceTimestamp);
      return Number.isFinite(time) && time >= cutoff;
    })
    .filter(usable)
    .map((sample) => ({
      label: new Date(sample.deviceTimestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      value: valueForMetric(sample, metricId) as number,
    }))
    .slice(-200);
}

function currentForMetric(samples: TelemetrySample[], metricId: EnvironmentMetric["id"]): number | null {
  const candidates = samplesForMetric(samples, metricId).filter(usable).sort((a, b) => b.sequence - a.sequence);
  return candidates.length ? valueForMetric(candidates[0], metricId) : null;
}

function stats(points: SeriesPoint[], current: number | null): Pick<EnvironmentMetric, "current" | "min" | "max" | "avg"> {
  if (!points.length) return { current, min: null, max: null, avg: null };
  const values = points.map((p) => p.value).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { current, min, max, avg };
}

export function environmentMetrics(
  gh: Greenhouse,
  current?: TelemetrySnapshot | null,
  history?: TelemetryHistoryResponse | null,
): (EnvironmentMetric & { ranges: Record<RangeId, SeriesPoint[]>; source?: string; stale?: boolean })[] {
  const samples = [
    ...(history?.samples ?? []),
    ...(current?.samples ?? []),
  ].filter((sample, index, all) => all.findIndex((x) => x.componentId === sample.componentId && x.sequence === sample.sequence) === index);
  return METRIC_DEFS.map((spec) => {
    const currentValue = current ? currentForMetric(current.samples, spec.id) : null;
    const ranges = {
      "24H": pointsForRange(samples, spec.id, 24),
      "7D": pointsForRange(samples, spec.id, 24 * 7),
      "30D": pointsForRange(samples, spec.id, 24 * 30),
    };
    const stat = stats(ranges["24H"], currentValue);
    return {
      ...spec,
      color: spec.id === "temperature" ? "#16a34a" : spec.id === "humidity" ? "#0ea5e9" : spec.id === "light" ? "#f59e0b" : spec.id === "tank" ? "#6366f1" : "#10b981",
      ...stat,
      points: ranges["24H"],
      ranges,
      source: current?.source ?? history?.source ?? "UNAVAILABLE",
      stale: current?.stale ?? history?.stale ?? true,
    };
  });
}

/** No fabricated fruit growth. Return only persisted observations supplied by the backend. */
export function fruitDevFor(gh: Greenhouse): { label: string; count: number; weight: number }[] {
  return gh.fruitDevSeries ?? [];
}
