import type { DailyHistorySlot, TelemetryHistoryResponse, TelemetrySample, TelemetrySnapshot } from "@/lib/api/contracts";
import type { EnvironmentMetric, Greenhouse, SeriesPoint } from "@/lib/types";
import { deviceClock } from "@/lib/device-clock";

type RangeId = "24H" | "7D" | "30D";

const METRIC_DEFS: Array<{ id: EnvironmentMetric["id"]; label: string; unit: string; metricIds: string[] }> = [
  { id: "temperature", label: "Air Temperature", unit: "°C", metricIds: ["TEMPERATURE"] },
  { id: "waterTemperature", label: "Water Temperature", unit: "°C", metricIds: ["TEMPERATURE", "WATER_TEMPERATURE"] },
  { id: "humidity", label: "Humidity", unit: "%", metricIds: ["HUMIDITY"] },
  { id: "light", label: "Light", unit: "klux", metricIds: ["LIGHT"] },
  { id: "tank", label: "Water/Tank Level", unit: "%", metricIds: ["LEVEL"] },
  { id: "fertigation", label: "Fertigation", unit: "L", metricIds: ["FERTIGATION", "FLOW"] },
];

export function formatMetricValue(val: number | string | null | undefined, metricId?: string): string {
  if (val === null || val === undefined || val === "" || val === "–") return "–";
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (!Number.isFinite(num)) return "–";

  if (metricId === "light") {
    return num >= 100 ? Math.round(num).toLocaleString() : num.toFixed(1);
  }
  if (metricId === "tank" || metricId === "fertigation") {
    return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
  }
  // Air temperature, Water temperature, Humidity
  return num.toFixed(1);
}

function usable(sample: TelemetrySample): boolean {
  return sample.measurementType === "MEASURED" && sample.quality === "GOOD" && typeof sample.value === "number" && Number.isFinite(sample.value);
}

function valueForMetric(sample: TelemetrySample, metricId: EnvironmentMetric["id"]): number | null {
  if (!usable(sample)) return null;
  const value = sample.value as number;
  return metricId === "light" ? value / 1000 : value;
}

function samplesForMetric(samples: TelemetrySample[], metricId: EnvironmentMetric["id"]): TelemetrySample[] {
  if (metricId === "waterTemperature") {
    return samples.filter((sample) => {
      const cId = String(sample.componentId || "").toLowerCase();
      const mId = String(sample.metricId || "").toUpperCase();
      return (mId === "TEMPERATURE" || mId === "WATER_TEMPERATURE") && (cId.includes("ds18b20") || cId.includes("water") || cId.includes("temp_ds"));
    });
  }
  if (metricId === "temperature") {
    const hasDht = samples.some((s) => String(s.componentId || "").toLowerCase().includes("dht"));
    return samples.filter((sample) => {
      const cId = String(sample.componentId || "").toLowerCase();
      const mId = String(sample.metricId || "").toUpperCase();
      if (hasDht && (cId.includes("ds18b20") || cId.includes("water") || cId.includes("temp_ds"))) return false;
      return mId === "TEMPERATURE";
    });
  }
  const accepted = new Set(METRIC_DEFS.find((x) => x.id === metricId)?.metricIds ?? []);
  return samples.filter((sample) => accepted.has(String(sample.metricId || "").toUpperCase()));
}

/**
 * Fixed 288-slot daily temperature and environmental history model:
 * - 00:00 to 23:59 (1 point / 5 minutes = 288 points / day)
 * - Past slots: representative value
 * - Current slot: latest valid bucket
 * - Future slots: strictly null (NOT 0°C, NOT previous temperature)
 * - Curve and shaded fill in AreaChart stop at latest available data point
 */
function daily24hPoints(
  samples: TelemetrySample[],
  metricId: EnvironmentMetric["id"],
  dailyHistory?: DailyHistorySlot[],
  deviceDate = deviceClock.getTime()
): SeriesPoint[] {
  const currentSlot = Math.min(287, Math.max(0, Math.floor((deviceDate.getHours() * 60 + deviceDate.getMinutes()) / 5)));
  const result: SeriesPoint[] = new Array(288);

  // 1. If dailyHistory from ESP32 is present (288 pre-aggregated 5-min buckets):
  if (Array.isArray(dailyHistory) && dailyHistory.length === 288) {
    let hasBackendValues = false;
    for (let i = 0; i < 288; i++) {
      const hSlot = dailyHistory[i];
      let val: number | null = null;
      if (hSlot && hSlot.valid) {
        if (metricId === "temperature") {
          val = hSlot.temperatureAirC ?? hSlot.temperatureC ?? null;
        } else if (metricId === "waterTemperature") {
          val = hSlot.temperatureWaterC ?? null;
        } else if (metricId === "humidity") {
          val = hSlot.humidityPct ?? null;
        }
      }
      if (val !== null) hasBackendValues = true;
      result[i] = {
        label: hSlot?.time || `${String(Math.floor((i * 5) / 60)).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}`,
        value: i <= currentSlot ? val : null,
        slot: i,
      };
    }
    if (hasBackendValues && (metricId === "temperature" || metricId === "waterTemperature" || metricId === "humidity")) {
      return result;
    }
  }

  // 2. Aggregate from raw/spooled samples for today into the 288 5-minute buckets
  const metricSamples = samplesForMetric(samples, metricId).filter(usable);
  const todayStr = deviceDate.toISOString().slice(0, 10);
  const buckets: { sum: number; count: number }[] = Array.from({ length: 288 }, () => ({ sum: 0, count: 0 }));

  for (const s of metricSamples) {
    const sDate = new Date(s.deviceTimestamp);
    if (isNaN(sDate.getTime())) continue;
    if (sDate.toISOString().slice(0, 10) !== todayStr) continue;
    const slot = Math.floor((sDate.getHours() * 60 + sDate.getMinutes()) / 5);
    if (slot >= 0 && slot < 288) {
      const v = valueForMetric(s, metricId);
      if (typeof v === "number" && Number.isFinite(v)) {
        buckets[slot].sum += v;
        buckets[slot].count += 1;
      }
    }
  }

  for (let i = 0; i < 288; i++) {
    const timeStr = `${String(Math.floor((i * 5) / 60)).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}`;
    if (i > currentSlot) {
      // Future slots must contain null (never 0°C or previous value)
      result[i] = { label: timeStr, value: null, slot: i };
    } else if (buckets[i].count > 0) {
      result[i] = { label: timeStr, value: Number((buckets[i].sum / buckets[i].count).toFixed(1)), slot: i };
    } else {
      result[i] = { label: timeStr, value: null, slot: i };
    }
  }

  return result;
}

function pointsForRange(samples: TelemetrySample[], metricId: EnvironmentMetric["id"], hours: number): SeriesPoint[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return samplesForMetric(samples, metricId)
    .filter((sample) => {
      const time = Date.parse(sample.deviceTimestamp);
      return Number.isFinite(time) && time >= cutoff;
    })
    .filter(usable)
    .map((sample, idx) => ({
      label: new Date(sample.deviceTimestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      value: valueForMetric(sample, metricId) as number,
      slot: idx,
    }))
    .slice(-200);
}

export function currentForMetric(samples: TelemetrySample[], metricId: EnvironmentMetric["id"], currentObj?: TelemetrySnapshot | null): number | null {
  const candidates = samplesForMetric(samples, metricId).filter(usable).sort((a, b) => b.sequence - a.sequence);
  if (candidates.length) return valueForMetric(candidates[0], metricId);
  if (currentObj?.values) {
    if (metricId === "temperature") {
      if (typeof currentObj.values.temperatureAirC === "number") return currentObj.values.temperatureAirC;
      if (typeof currentObj.values.temperatureC === "number") return currentObj.values.temperatureC;
    }
    if (metricId === "waterTemperature") {
      if (typeof currentObj.values.temperatureWaterC === "number") return currentObj.values.temperatureWaterC;
      if (typeof currentObj.values.waterTemperatureC === "number") return currentObj.values.waterTemperatureC;
    }
    if (metricId === "humidity" && typeof currentObj.values.humidityPct === "number") return currentObj.values.humidityPct;
    if (metricId === "light" && typeof currentObj.values.lightLux === "number") return currentObj.values.lightLux / 1000;
    if (metricId === "tank" && typeof currentObj.values.waterLevelPct === "number") return currentObj.values.waterLevelPct;
    if (metricId === "fertigation" && typeof currentObj.values.totalLiters === "number") return currentObj.values.totalLiters;
  }
  return null;
}

function stats(points: SeriesPoint[], current: number | null): Pick<EnvironmentMetric, "current" | "min" | "max" | "avg"> {
  const validVals = points.map((p) => p.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!validVals.length) return { current, min: null, max: null, avg: null };
  const min = Math.min(...validVals);
  const max = Math.max(...validVals);
  const avg = validVals.reduce((sum, value) => sum + value, 0) / validVals.length;
  return { current, min, max, avg };
}

export function environmentMetrics(
  gh: Greenhouse,
  current?: TelemetrySnapshot | null,
  history?: TelemetryHistoryResponse | null,
  deviceDate = deviceClock.getTime()
): (EnvironmentMetric & { ranges: Record<RangeId, SeriesPoint[]>; source?: string; stale?: boolean })[] {
  const samples = [
    ...(history?.samples ?? []),
    ...(current?.samples ?? []),
  ].filter((sample, index, all) => all.findIndex((x) => x.componentId === sample.componentId && x.sequence === sample.sequence) === index);

  return METRIC_DEFS.map((spec) => {
    const currentValue = current ? currentForMetric(samples.length ? samples : (current.samples ?? []), spec.id, current) : null;
    const ranges = {
      "24H": daily24hPoints(samples, spec.id, history?.dailyHistory, deviceDate),
      "7D": pointsForRange(samples, spec.id, 24 * 7),
      "30D": pointsForRange(samples, spec.id, 24 * 30),
    };
    const stat = stats(ranges["24H"], currentValue);
    return {
      ...spec,
      color:
        spec.id === "temperature"
          ? "#16a34a"
          : spec.id === "waterTemperature"
          ? "#06b6d4"
          : spec.id === "humidity"
          ? "#0ea5e9"
          : spec.id === "light"
          ? "#f59e0b"
          : spec.id === "tank"
          ? "#6366f1"
          : "#10b981",
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
