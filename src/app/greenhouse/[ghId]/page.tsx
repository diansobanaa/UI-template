"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import {
  Activity,
  Camera,
  Maximize2,
  Apple,
  Beaker,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  FlaskConical,
  History,
  Leaf,
  Plus,
  RotateCcw,
  Sprout,
  Sun,
  Thermometer,
  Trash2,
  TrendingDown,
  TrendingUp,
  Waves,
  Wind,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { SectionCard, ViewAllButton } from "@/components/ui/cards";
import { Badge, Button, FieldError, Input, Label, Progress, StatusBadge, Textarea } from "@/components/ui/primitives";
import { AreaChart, DualLineChart, Donut } from "@/components/ui/charts";
import { GreenhouseArt } from "@/components/ui/GreenhouseArt";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { ScheduleContent } from "@/app/schedule/page";
import { useToast } from "@/components/ui/toast";
import { complexService, fertigationService, greenhouseService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { errorMessage } from "@/lib/errors";
import { number, required } from "@/lib/validation";
import { environmentMetrics, fruitDevFor } from "@/lib/data/environment";
import { delta, lux, n } from "@/lib/format";
import type { RangeId } from "./range-types";
import { greenhouseRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";

const RANGE_OPTIONS: { id: RangeId; label: string }[] = [
  { id: "24H", label: "24 Hours" },
  { id: "7D", label: "7 Days" },
  { id: "30D", label: "30 Days" },
];

const METRIC_TABS = [
  { id: "temperature", label: "Temperature" },
  { id: "humidity", label: "Humidity" },
  { id: "light", label: "Light" },
  { id: "tank", label: "Water/Tank Level" },
  { id: "fertigation", label: "Fertigation" },
] as const;

export default function GreenhousePage() {
  return (
    <Suspense fallback={null}>
      <GreenhouseContent />
    </Suspense>
  );
}

function GreenhouseContent() {
  useDbVersion();
  const [params] = useSearchParams();
  const router = useNavigate();
  const { ghId: routeGhId } = useParams<{ ghId: string }>();
  const toast = useToast();

  const [estopOpen, setEstopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const ghId = params.get("gh") ?? routeGhId ?? ghs[0]?.id;
  const gh = greenhouseService.get(ghId ?? "") ?? ghs[0];
  if (!gh) return null;

  const handleResume = async () => {
    setResuming(true);
    try {
      await fertigationService.resume(complex.id);
      toast(`System resumed — actuators and schedules for ${complex.code} can run again`, "success");
      setResumeOpen(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setResuming(false);
    }
  };

  const handleEmergencyStop = async () => {
    setStopping(true);
    try {
      await fertigationService.emergencyStop(complex.id);
      toast(`Emergency stop executed for ${gh.code} — all actuators off until manually resumed`, "warning");
      setEstopOpen(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setStopping(false);
    }
  };

  const idx = Math.max(0, ghs.findIndex((g) => g.id === gh.id));
  const prevGh = ghs[(idx - 1 + ghs.length) % ghs.length];
  const nextGh = ghs[(idx + 1) % ghs.length];
  const go = (id: string) => router(`/greenhouse/${id}?complex=${complex.id}`, { replace: true });
  const [range, setRange] = useState<RangeId>("24H");
  const [metric, setMetric] = useState<(typeof METRIC_TABS)[number]["id"]>("temperature");
  const [metricCarouselLocked, setMetricCarouselLocked] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);
  const [obsDeleteTarget, setObsDeleteTarget] = useState<{ id: string; plantId: string } | null>(null);
  const [obsDeleting, setObsDeleting] = useState(false);
  const metrics = useMemo(() => environmentMetrics(gh), [gh]);
  const active = metrics.find((m) => m.id === metric)!;
  const activePoints = (active as unknown as { ranges: Record<RangeId, typeof active.points> }).ranges[range];

  // Environmental chart carousel:
  // - runs automatically while unlocked
  // - selecting a mini chart locks the main chart on that metric
  // - Reset resumes the carousel from the selected metric
  useEffect(() => {
    if (metricCarouselLocked) return;
    const timer = window.setInterval(() => {
      setMetric((current) => {
        const currentIndex = METRIC_TABS.findIndex((item) => item.id === current);
        return METRIC_TABS[(currentIndex + 1) % METRIC_TABS.length].id;
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [metricCarouselLocked]);

  const selectMetric = (id: (typeof METRIC_TABS)[number]["id"]) => {
    setMetric(id);
    setMetricCarouselLocked(true);
  };

  const resetMetricCarousel = () => {
    setMetricCarouselLocked(false);
  };

  const nextSchedule = gh.fertigationSchedules.find((s) => s.status === "scheduled");
  const fruitSeries = fruitDevFor(gh);
  const observations = fertigationService.observationsForGh(gh.id);

  const handleDeleteObservation = async () => {
    if (!obsDeleteTarget) return;
    setObsDeleting(true);
    try {
      await fertigationService.deleteObservation(obsDeleteTarget.id);
      toast(`Observation for ${obsDeleteTarget.plantId} deleted`, "info");
      setObsDeleteTarget(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setObsDeleting(false);
    }
  };

  const tempDeltaClass = (gh.telemetry.tempDeltaC ?? 0) >= 0 ? "text-red-500" : "text-blue-500";
  const TempTrendIcon = (gh.telemetry.tempDeltaC ?? 0) >= 0 ? TrendingUp : TrendingDown;
  const equipmentCards = [
    { name: "Mixing Tank", status: gh.equipment.find((item) => item.name.toLowerCase().includes("mixing tank"))?.status ?? "OFFLINE", detail: `${gh.telemetry.tankPct}% volume` },
    { name: "Distribution Pump", status: gh.equipment.find((item) => item.name.toLowerCase().includes("distribution pump"))?.status ?? "OFFLINE", detail: gh.fertigationState === "DISTRIBUTING" ? "Running now" : "Ready" },
    { name: "Raw Water Valve", status: gh.online ? "OK" : "OFFLINE", detail: "GH dedicated route" },
    { name: "Nutrient Valve", status: gh.online ? "OK" : "OFFLINE", detail: "Dosing route" },
    ...["Temperature Sensor", "Humidity Sensor", "Light Sensor", "Flow Meter"].map((name) => ({
      name,
      status: gh.equipment.find((item) => item.name.toLowerCase().includes(name.toLowerCase()))?.status ?? "OFFLINE",
      detail: "Telemetry channel",
    })),
  ];
  const ghRealtimeState = greenhouseRealtimeState(gh);

  // Derived presentation data: no new/fabricated measurements are introduced.
  // These values are calculated only from the existing metric payload and telemetry.
  const currentMetricValue = (metricId: string) => {
    if (metricId === "temperature") return gh.telemetry.temperatureC;
    if (metricId === "humidity") return gh.telemetry.humidityPct;
    if (metricId === "light") return gh.telemetry.lightLux !== null ? gh.telemetry.lightLux / 1000 : null;
    if (metricId === "tank") return gh.telemetry.tankPct;
    return null;
  };

  const activeCurrent = currentMetricValue(active.id);
  const activeAvg = Number(active.avg);
  const activeMin = Number(active.min);
  const activeMax = Number(active.max);
  const activePosition =
    activeCurrent !== null && Number.isFinite(activeMin) && Number.isFinite(activeMax) && activeMax > activeMin
      ? Math.max(0, Math.min(100, ((activeCurrent - activeMin) / (activeMax - activeMin)) * 100))
      : null;
  const activeVsAverage =
    activeCurrent !== null && Number.isFinite(activeAvg)
      ? activeCurrent - activeAvg
      : null;

  return (
    <AppShell complexId={complex.id}>
      <style>{`
        .gh-surface {
          transition: background-color 160ms ease, box-shadow 160ms ease;
        }
        .gh-surface:hover {
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.035);
        }
      `}</style>
      {/* ---------------- Hero ---------------- */}
      <div className={`relative mb-5 overflow-hidden rounded-2xl shadow-[0_8px_30px_rgba(15,23,42,0.08)] ${ghRealtimeState === "live" ? "border-[--color-line]" : "border-red-300 ring-2 ring-red-100"}`}>
        <div className="absolute inset-0">
          <GreenhouseArt crop={gh.crop} variant="landscape" className="h-full w-full" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-900/80 via-slate-900/55 to-slate-900/15" />
        </div>
        <div className="relative flex flex-wrap items-center gap-4 p-6">
          <div className="min-w-0 text-white">
            <div className="flex items-center gap-2.5">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                <Sprout className="h-6 w-6 text-emerald-300" />
              </span>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-200/90">{complex.code} • {gh.crop}</div>
                <h1 className="text-2xl font-bold leading-tight">{gh.code}</h1>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="green" pulse>● {gh.online ? "ONLINE" : "OFFLINE"}</Badge>
              <Badge tone="green">● {gh.health}</Badge>
              <LiveStatus state={ghRealtimeState} label={`${gh.code} realtime state`} />
              <span className="text-xs text-slate-200/80">{gh.plants.latestObservation}</span>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <Button variant="secondary" onClick={() => router(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>
              <CalendarClock className="h-4 w-4" /> Schedule
            </Button>
            <Button variant="secondary" onClick={() => router(`/fertigation?complex=${complex.id}`)}>
              <Droplets className="h-4 w-4" /> Fertigation
            </Button>
            {complex.emergencyStopped ? (
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setResumeOpen(true)}>
                Resume System
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setEstopOpen(true)}>
                Emergency Stop
              </Button>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => go(prevGh.id)}
                aria-label="Previous greenhouse"
                className="flex h-10 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="rounded-lg bg-white/15 px-3.5 py-2 text-sm font-bold text-white backdrop-blur">
                {gh.code} of {String(ghs.length).padStart(2, "0")}
              </span>
              <button
                onClick={() => go(nextGh.id)}
                aria-label="Next greenhouse"
                className="flex h-10 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Sensor row ---------------- */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-xl bg-slate-50/80 p-4">
          <div className="flex items-center justify-between">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-500">
              <Thermometer className="h-[18px] w-[18px]" />
            </span>
            <span className={`flex items-center gap-1 text-xs font-semibold ${tempDeltaClass}`}>
              <TempTrendIcon className="h-3.5 w-3.5" />
              {delta(gh.telemetry.tempDeltaC, "°C")}
            </span>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">Temperature</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.temperatureC !== null ? gh.telemetry.temperatureC.toFixed(1) : "–"}<span className="text-sm font-medium text-slate-400"> °C</span>
          </div>
        </div>
        <div className="rounded-xl bg-slate-50/80 p-4">
          <div className="flex items-center justify-between">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-500">
              <Droplets className="h-[18px] w-[18px]" />
            </span>
            <span className={`flex items-center gap-1 text-xs font-semibold ${(gh.telemetry.humidityDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {(gh.telemetry.humidityDeltaPct ?? 0) >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {delta(gh.telemetry.humidityDeltaPct)}
            </span>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">Humidity</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.humidityPct ?? "–"}<span className="text-sm font-medium text-slate-400"> %</span>
          </div>
        </div>
        <div className="rounded-xl bg-slate-50/80 p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-500">
            <Sun className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">Light</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.lightLux !== null ? (gh.telemetry.lightLux / 1000).toFixed(1) : "–"}<span className="text-sm font-medium text-slate-400"> klux</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">{lux(gh.telemetry.lightLux)}</div>
        </div>
        <div className="rounded-xl bg-slate-50/80 p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Sprout className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">HST <span className="text-slate-400">(Hari Setelah Tanam)</span></div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.hstDays}<span className="text-sm font-medium text-slate-400"> days</span>
          </div>
        </div>
        <div className="rounded-xl bg-slate-50/80 p-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-500">
            <Apple className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">HSP <span className="text-slate-400">(Hari Setelah Polinasi)</span></div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.hspDays ?? "–"}<span className="text-sm font-medium text-slate-400">{gh.telemetry.hspDays !== null ? " days" : ""}</span>
          </div>
        </div>
        <div className="rounded-xl bg-slate-50/80 p-4">
          <div className="flex items-center justify-between">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-500">
              <Waves className="h-[18px] w-[18px]" />
            </span>
            <span className={`text-xs font-semibold ${(gh.telemetry.waterDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {delta(gh.telemetry.waterDeltaPct)}
            </span>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">Water Today</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.waterTodayL !== null ? n(gh.telemetry.waterTodayL) : "–"}<span className="text-sm font-medium text-slate-400"> L</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            Yesterday: {gh.telemetry.waterYesterdayL !== null ? `${n(gh.telemetry.waterYesterdayL)} L` : "–"}
          </div>
        </div>
      </div>

      {/* ---------------- Camera Monitoring ---------------- */}
      <SectionCard
        title="Camera Monitoring"
        icon={Camera}
        iconTone="slate"
        subtitle={gh.online ? "3 cameras • snapshots every 15 minutes" : "Camera feeds unavailable"}
        className="mb-5 gh-surface !border-0 !shadow-none bg-white"
        action={
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${gh.online ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${gh.online ? "bg-emerald-500" : "bg-red-500"}`} />
              {gh.online ? "3 Online" : "Offline"}
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          {/* Main camera */}
          <div className="group relative min-h-[250px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 lg:min-h-[330px]">
            <GreenhouseArt crop={gh.crop} variant="landscape" className="h-full w-full transition duration-500 group-hover:scale-[1.01]" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/10 to-transparent" />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-slate-950/65 px-2.5 py-1.5 text-[10px] font-semibold text-white backdrop-blur">
              <Camera className="h-3 w-3" /> Camera 1
            </div>
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/90 px-2.5 py-1.5 text-[10px] font-semibold text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white" /> LIVE
            </span>
            <button type="button" aria-label="Open Camera 1" className="absolute right-3 bottom-14 grid h-8 w-8 place-items-center rounded-lg bg-black/45 text-white backdrop-blur transition hover:bg-black/65">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3 text-white">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{gh.code} · {gh.crop}</div>
                <div className="mt-0.5 text-[10px] text-white/75">Camera 1 · greenhouse overview</div>
              </div>
              <div className="shrink-0 text-right text-[10px] text-white/75">15 min ago</div>
            </div>
          </div>

          {/* Secondary cameras — intentionally split into two compact feeds */}
          <div className="grid min-h-[250px] grid-rows-2 gap-3 lg:min-h-[330px]">
            {[2, 3].map((camera) => (
              <div key={camera} className="group relative min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <GreenhouseArt crop={gh.crop} variant="landscape" className="h-full w-full transition duration-500 group-hover:scale-[1.01]" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
                <div className="absolute left-2.5 top-2.5 rounded-full bg-slate-950/65 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur">
                  Camera {camera}
                </div>
                <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[9px] font-medium text-white backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> 15m ago
                </span>
                <div className="absolute inset-x-2.5 bottom-2.5 flex items-end justify-between gap-2 text-white">
                  <div>
                    <div className="text-[11px] font-semibold">Camera {camera}</div>
                    <div className="text-[9px] text-white/70">Snapshot</div>
                  </div>
                  <button type="button" aria-label={`Open Camera ${camera}`} className="grid h-7 w-7 place-items-center rounded-lg bg-black/40 backdrop-blur transition hover:bg-black/65">
                    <Maximize2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Card information condensed into one monitoring strip */}
        <div className="mt-3 grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/70 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Temperature", value: gh.telemetry.temperatureC !== null ? `${gh.telemetry.temperatureC.toFixed(1)} °C` : "–" },
            { label: "Humidity", value: gh.telemetry.humidityPct !== null ? `${gh.telemetry.humidityPct}%` : "–" },
            { label: "Light", value: gh.telemetry.lightLux !== null ? `${(gh.telemetry.lightLux / 1000).toFixed(1)} klux` : "–" },
            { label: "HST", value: `${gh.telemetry.hstDays} days`, hint: "Hari Setelah Tanam" },
            { label: "HSP", value: gh.telemetry.hspDays !== null ? `${gh.telemetry.hspDays} days` : "–", hint: "Hari Setelah Polinasi" },
            { label: "Water Today", value: gh.telemetry.waterTodayL !== null ? `${n(gh.telemetry.waterTodayL)} L` : "–" },
          ].map((item) => (
            <div key={item.label} className="min-w-0 px-3 py-2.5">
              <div className="truncate text-[10px] text-slate-400" title={item.hint}>{item.label}</div>
              <div className="mt-0.5 truncate text-sm font-bold text-slate-800">{item.value}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ---------------- Charts + plant data ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Environmental Conditions"
          icon={Activity}
          iconTone="blue"
          className="xl:col-span-2 gh-surface !border-0 !shadow-none bg-white"
          action={
            <div className="flex rounded-full bg-slate-100 p-0.5">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    range === r.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          }
        >
          {/* Current conditions */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {
                label: "Temperature",
                value: gh.telemetry.temperatureC !== null ? `${gh.telemetry.temperatureC.toFixed(1)} °C` : "–",
                detail: gh.telemetry.tempDeltaC !== null ? `${gh.telemetry.tempDeltaC > 0 ? "+" : ""}${gh.telemetry.tempDeltaC} °C` : "No trend",
                cls: "text-red-500",
              },
              {
                label: "Humidity",
                value: gh.telemetry.humidityPct !== null ? `${gh.telemetry.humidityPct}%` : "–",
                detail: gh.telemetry.humidityDeltaPct !== null ? `${gh.telemetry.humidityDeltaPct > 0 ? "+" : ""}${gh.telemetry.humidityDeltaPct}%` : "No trend",
                cls: "text-blue-500",
              },
              {
                label: "Light",
                value: gh.telemetry.lightLux !== null ? `${(gh.telemetry.lightLux / 1000).toFixed(1)} klux` : "–",
                detail: gh.telemetry.lightLux !== null ? `${Math.round(gh.telemetry.lightLux).toLocaleString()} lux` : "No reading",
                cls: "text-amber-600",
              },
              {
                label: "Tank Level",
                value: `${gh.telemetry.tankPct}%`,
                detail: gh.telemetry.waterTodayL !== null ? `${n(gh.telemetry.waterTodayL)} L today` : "Live level",
                cls: "text-cyan-600",
              },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-xl bg-slate-50/80 px-3 py-2.5">
                <div className="truncate text-[10px] font-medium text-slate-400">{item.label}</div>
                <div className="mt-0.5 truncate text-lg font-bold tracking-tight text-slate-900">{item.value}</div>
                <div className={`mt-0.5 truncate text-[10px] ${item.cls}`}>{item.detail}</div>
              </div>
            ))}
          </div>

          {/* Metric carousel controls + compact mini charts */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {metricCarouselLocked ? "Selected metric" : "Live carousel"}
              </span>
              {!metricCarouselLocked && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Auto rotating" />
              )}
            </div>
            <button
              type="button"
              onClick={resetMetricCarousel}
              title={metricCarouselLocked ? "Resume automatic chart carousel" : "Carousel is already running"}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                metricCarouselLocked
                  ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>

          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {metrics.map((item) => {
              const itemPoints = (item as unknown as { ranges: Record<RangeId, typeof item.points> }).ranges[range];
              const isActive = item.id === metric;
              const metricLabel = METRIC_TABS.find((tab) => tab.id === item.id)?.label ?? item.label;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectMetric(item.id as (typeof METRIC_TABS)[number]["id"])}
                  title={`Show ${metricLabel} in the main chart`}
                  className={`group w-[190px] min-w-[190px] shrink-0 rounded-xl bg-slate-50/70 p-2.5 text-left transition ${
                    isActive
                      ? "bg-white shadow-sm ring-1 ring-slate-200"
                      : "bg-slate-50/70 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] font-medium text-slate-500">{metricLabel}</span>
                    {isActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />}
                  </div>
                  <div className="mt-1 h-[58px]">
                    <AreaChart
                      points={itemPoints}
                      color={item.color}
                      height={58}
                    />
                  </div>
                  <div className="mt-1 truncate text-[10px] font-semibold text-slate-700">
                    {item.min}–{item.max} {item.unit}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Main chart always follows the carousel selection */}
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{active.label}</div>
                {activeVsAverage !== null && (
                  <span className={`text-[10px] font-semibold ${activeVsAverage >= 0 ? "text-emerald-600" : "text-slate-500"}`}>
                    {activeVsAverage >= 0 ? "+" : ""}{activeVsAverage.toFixed(active.id === "temperature" ? 1 : 0)} vs avg
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tracking-tight text-slate-900">
                  {active.id === "temperature" && gh.telemetry.temperatureC !== null ? gh.telemetry.temperatureC.toFixed(1) :
                   active.id === "humidity" && gh.telemetry.humidityPct !== null ? gh.telemetry.humidityPct :
                   active.id === "light" && gh.telemetry.lightLux !== null ? (gh.telemetry.lightLux / 1000).toFixed(1) :
                   active.id === "tank" ? gh.telemetry.tankPct :
                   active.id === "fertigation" ? gh.fertigationState : "–"}
                </span>
                <span className="text-xs text-slate-500">{active.unit}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activePosition !== null && (
                <div className="hidden w-28 sm:block">
                  <div className="mb-1 flex justify-between text-[9px] text-slate-400">
                    <span>Low</span><span>Current</span><span>High</span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-slate-100">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-emerald-400/70"
                      style={{ width: `${activePosition}%` }}
                    />
                    <span
                      className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow-sm"
                      style={{ left: `calc(${activePosition}% - 6px)` }}
                    />
                  </div>
                </div>
              )}
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                {range}
              </span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-stretch">
            <div className="min-w-0">
              <AreaChart
                key={`${gh.id}-${metric}-${range}`}
                points={activePoints}
                color={active.color}
                height={220}
              />
            </div>

            <div className="rounded-2xl bg-slate-950 p-4 text-white">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">Live profile</span>
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.7)]" />
              </div>

              <div className="mt-5">
                <div className="text-[10px] text-white/45">Current</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tracking-tight">
                    {activeCurrent !== null ? activeCurrent : active.id === "fertigation" ? gh.fertigationState : "–"}
                  </span>
                  {activeCurrent !== null && <span className="text-xs text-white/45">{active.unit}</span>}
                </div>
              </div>

              {activePosition !== null && (
                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between text-[9px] text-white/45">
                    <span>MIN {active.min}</span>
                    <span>MAX {active.max}</span>
                  </div>
                  <div className="relative h-2 rounded-full bg-white/10">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-emerald-400/80"
                      style={{ width: `${activePosition}%` }}
                    />
                    <span
                      className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-slate-950 bg-white"
                      style={{ left: `calc(${activePosition}% - 7px)` }}
                    />
                    <span
                      className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-emerald-400"
                      style={{ left: `calc(${activePosition}% - 3px)` }}
                    />
                  </div>
                  <div className="mt-2 text-[10px] text-white/55">
                    {activePosition.toFixed(0)}% through today's observed range
                  </div>
                </div>
              )}

              <div className="mt-6 border-t border-white/10 pt-3">
                <div className="text-[9px] uppercase tracking-wide text-white/35">Compared with average</div>
                <div className="mt-1 flex items-center gap-2">
                  {activeVsAverage !== null ? (
                    <>
                      {activeVsAverage >= 0 ? (
                        <TrendingUp className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-sky-300" />
                      )}
                      <span className="text-sm font-semibold">
                        {activeVsAverage >= 0 ? "+" : ""}{activeVsAverage.toFixed(active.id === "temperature" ? 1 : 0)} {active.unit}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm font-semibold">{gh.fertigationState}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50/80 px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">24H data profile</span>
              <span className="text-[10px] text-slate-400">min → max</span>
            </div>
            <div className="grid grid-cols-4 divide-x divide-slate-200/70">
              {[
                ["Minimum", active.min],
                ["Average", active.avg],
                ["Maximum", active.max],
                ["Current", activeCurrent ?? "–"],
              ].map(([label, value]) => (
                <div key={String(label)} className="px-2 text-center first:pl-0 last:pr-0">
                  <div className="text-[9px] text-slate-400">{label}</div>
                  <div className="mt-0.5 text-sm font-bold tracking-tight text-slate-800">{value} {active.unit}</div>
                  {label === "Average" && activePosition !== null && (
                    <div className="mx-auto mt-1 h-0.5 w-8 rounded-full bg-slate-300" />
                  )}
                  {label === "Current" && activePosition !== null && (
                    <div className="mx-auto mt-1 h-0.5 w-8 rounded-full bg-emerald-500" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Cross-metric snapshot: lets the operator read the whole greenhouse without switching charts. */}
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
            {metrics.map((item) => {
              const itemCurrent = currentMetricValue(item.id);
              const itemMin = Number(item.min);
              const itemMax = Number(item.max);
              const itemAvg = Number(item.avg);
              const itemPos =
                itemCurrent !== null && Number.isFinite(itemMin) && Number.isFinite(itemMax) && itemMax > itemMin
                  ? Math.max(0, Math.min(100, ((itemCurrent - itemMin) / (itemMax - itemMin)) * 100))
                  : null;
              return (
                <button
                  key={`snapshot-${item.id}`}
                  type="button"
                  onClick={() => selectMetric(item.id as (typeof METRIC_TABS)[number]["id"])}
                  className="group rounded-xl bg-white/70 px-3 py-2.5 text-left transition hover:bg-white"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-medium text-slate-500">
                      {METRIC_TABS.find((t) => t.id === item.id)?.label ?? item.label}
                    </span>
                    {item.id === metric && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-base font-bold tracking-tight text-slate-900">
                      {itemCurrent !== null ? itemCurrent : item.id === "fertigation" ? gh.fertigationState : "–"}
                    </span>
                    {itemCurrent !== null && <span className="text-[9px] text-slate-400">{item.unit}</span>}
                  </div>
                  <div className="mt-2">
                    <div className="h-1 rounded-full bg-slate-100">
                      {itemPos !== null && (
                        <div className="relative h-full rounded-full bg-emerald-400/70" style={{ width: `${itemPos}%` }}>
                          <span className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-slate-800" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] text-slate-400">
                    <span>avg {item.avg}</span>
                    <span>{item.min}–{item.max}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50/70 px-3 py-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <Activity className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 text-[11px] text-emerald-800">
              <span className="font-semibold">{gh.health}</span>
              <span className="mx-1 text-emerald-400">•</span>
              {active.label} is being monitored over the selected {range} period.
            </div>
          </div>
        </SectionCard>

        {/* Plant & Fruit Data */}
        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Plant & Fruit Data"
          icon={Leaf}
          iconTone="green"
          action={
            <Button size="sm" variant="outline" onClick={() => setObsOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Observation
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[--color-line] bg-slate-50/60 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Sprout className="h-4 w-4 text-emerald-500" /> Plants
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-3xl font-bold text-slate-900">{n(gh.plants.total)}</span>
                <span className="pb-1 text-xs text-slate-500">/ {n(gh.plants.tracked)} tracked</span>
              </div>
              <div className="mt-2 flex gap-1.5 text-[11px]">
                <Badge tone="green">{gh.plants.alive} alive</Badge>
                <Badge tone="red">{gh.plants.dead} dead</Badge>
              </div>
            </div>
            <div className="rounded-xl border border-[--color-line] bg-slate-50/60 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Apple className="h-4 w-4 text-red-400" /> Fruits
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-3xl font-bold text-slate-900">{n(gh.plants.totalFruits)}</span>
                <span className="pb-1 text-xs text-slate-500">recorded</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Avg weight: <span className="font-semibold text-slate-700">{n(gh.plants.avgFruitWeightG)} g</span>
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-blue-50/70 px-3 py-2 text-[11px] leading-relaxed text-blue-700">
            Last observation: <span className="font-semibold">{gh.plants.latestObservation}</span> — plant height avg{" "}
            {gh.plants.avgHeightCm} cm.
          </div>
          {observations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Recent Observations</div>
              {observations.slice(0, 3).map((o) => (
                <div key={o.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-xs">
                  <span className="font-semibold text-slate-700">{o.plantId}</span>
                  <span className="text-slate-500">{o.heightCm} cm • {o.leafCount} leaves • {o.fruitCount} fruits</span>
                  <span className="ml-auto text-slate-400">{o.at}</span>
                  <button aria-label="Delete observation" title="Delete observation" onClick={() => setObsDeleteTarget(o)} className="cursor-pointer text-slate-300 transition hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ---------------- Fertigation row ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Current fertigation / tank */}
        {gh.currentRun ? (
          <SectionCard
            title="Current Fertigation"
            icon={Droplets}
            iconTone="blue"
            subtitle={`Started ${gh.currentRun.startedAt} • ETA ${gh.currentRun.estimatedFinish}`}
            className="xl:col-span-2 gh-surface !border-0 !shadow-none bg-white"
            action={<StatusBadge status="running" />}
          >
            <div className="mb-3.5 flex items-center justify-between text-[13px]">
              <span className="font-semibold text-slate-800">{gh.currentRun.recipeName}</span>
              <span className="text-slate-500">
                {gh.currentRun.elapsedLabel} elapsed • {gh.currentRun.progressPct}%
              </span>
            </div>
            <Progress value={gh.currentRun.progressPct} className="h-2" />
            <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Water", value: `${gh.currentRun.waterDoneL} / ${gh.currentRun.targetWaterL} L` },
                { label: "Dosing A", value: `${gh.currentRun.dosingADoneMl} / ${gh.currentRun.dosingAml} ml` },
                { label: "Dosing B", value: `${gh.currentRun.dosingBDoneMl} / ${gh.currentRun.dosingBml} ml` },
                { label: "Estimated Finish", value: gh.currentRun.estimatedFinish },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <div className="text-[11px] text-slate-400">{s.label}</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-800">{s.value}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="Mixing Tank" icon={Beaker} iconTone="blue" className="xl:col-span-2 gh-surface !border-0 !shadow-none bg-white" realtime={ghRealtimeState}>
            <div className="flex items-center gap-5">
              <div className="relative h-24 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <div className="absolute bottom-0 w-full bg-gradient-to-t from-blue-500 to-sky-400" style={{ height: `${gh.telemetry.tankPct}%` }} />
                <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-700">
                  {gh.telemetry.tankPct}%
                </div>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: "Capacity", value: `${gh.telemetry.tankCapacityL} L` },
                  { label: "Current", value: `${gh.telemetry.tankL} L` },
                  { label: "Temperature", value: "27.8 °C" },
                  { label: "Next Refill", value: nextSchedule ? `Today ${nextSchedule.time}` : "–" },
                  { label: "State", value: gh.fertigationState },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                    <div className="text-[11px] text-slate-400">{s.label}</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-800">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        )}

        {/* Next schedule */}
        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Next Schedule"
          icon={CalendarClock}
          iconTone="violet"
          action={<ViewAllButton onClick={() => router(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>View Schedule</ViewAllButton>}
        >
          {nextSchedule ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
                  <Clock className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-lg font-bold text-slate-900">{nextSchedule.time}</div>
                  <div className="text-xs text-slate-500">{nextSchedule.name}</div>
                </div>
                <StatusBadge status="scheduled" className="ml-auto" />
              </div>
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between"><span className="text-slate-500">Recipe</span><span className="font-medium text-slate-800">{gh.recipes.find((r) => r.id === nextSchedule.recipeId)?.name ?? "–"}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Target Water</span><span className="font-medium text-slate-800">{nextSchedule.targetWaterL} L</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Repeat</span><span className="font-medium text-slate-800">{nextSchedule.repeat}</span></div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No upcoming schedule for this greenhouse.</p>
          )}
        </SectionCard>
      </div>

      {/* ---------------- Today's schedule + history ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Today's Fertigation Schedule"
          icon={CalendarClock}
          iconTone="blue"
          action={<ViewAllButton onClick={() => router(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>View All</ViewAllButton>}
        >
          {gh.fertigationSchedules.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-400">
              No fertigation schedules configured for this greenhouse.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">Recipe</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {gh.fertigationSchedules.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 font-semibold text-slate-800">{s.time}</td>
                    <td className="py-2.5 text-slate-600">{gh.recipes.find((r) => r.id === s.recipeId)?.name ?? "–"}</td>
                    <td className="py-2.5 text-slate-600">~23 min</td>
                    <td className="py-2.5"><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Fertigation History"
          icon={History}
          iconTone="slate"
          realtime={ghRealtimeState}
          action={<ViewAllButton onClick={() => router(`/fertigation?complex=${complex.id}`)}>View All</ViewAllButton>}
        >
          {gh.history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-400">
              No fertigation history recorded yet for this greenhouse.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="pb-2 font-medium">Date & Time</th>
                  <th className="pb-2 font-medium">Recipe</th>
                  <th className="pb-2 font-medium">Water</th>
                  <th className="pb-2 font-medium">Dosing</th>
                  <th className="pb-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {gh.history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 font-medium text-slate-800">{h.date} {h.time}</td>
                    <td className="py-2.5 text-slate-600">{h.recipeName}</td>
                    <td className="py-2.5 text-slate-600">{h.waterL} L</td>
                    <td className="py-2.5 text-slate-600">A {h.dosingAml} / B {h.dosingBml} ml</td>
                    <td className="py-2.5"><StatusBadge status={h.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {/* ---------------- Complete greenhouse schedule ---------------- */}
      <ScheduleContent embedded selectedComplexId={complex.id} selectedGreenhouseId={gh.id} />

      {/* ---------------- Plant overview + fruit development ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard className="gh-surface !border-0 !shadow-none bg-white" title="Plant Overview" icon={Sprout} iconTone="green">
          <div className="flex items-center gap-6">
            <Donut
              total={gh.plants.total}
              label="Plants"
              segments={[
                { value: gh.plants.alive, color: "#10b981" },
                { value: gh.plants.dead, color: "#ef4444" },
              ]}
            />
            <div className="flex-1 space-y-2.5">
              {[
                { label: "Alive", value: gh.plants.alive, color: "bg-emerald-500", pct: Math.round((gh.plants.alive / Math.max(1, gh.plants.total)) * 100) },
                { label: "Dead", value: gh.plants.dead, color: "bg-red-500", pct: Math.round((gh.plants.dead / Math.max(1, gh.plants.total)) * 100) },
                { label: "Tracked", value: gh.plants.tracked, color: "bg-blue-500", pct: Math.round((gh.plants.tracked / Math.max(1, gh.plants.total)) * 100) },
              ].map((r) => (
                <div key={r.label}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="text-slate-600">{r.label}</span>
                    <span className="font-semibold text-slate-800">{r.value} ({r.pct}%)</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${r.color}`} style={{ width: `${r.pct}%` }} />
                  </div>
                </div>
              ))}
              <div className="pt-1 text-[11px] text-slate-400">Survival rate {Math.round((gh.plants.alive / Math.max(1, gh.plants.total)) * 100)}%</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard className="gh-surface !border-0 !shadow-none bg-white"
          title="Fruit Development"
          icon={Apple}
          iconTone="red"
          subtitle="Count and average weight over the season"
        >
          <DualLineChart
            points={fruitSeries.map((p) => ({ label: p.label, a: p.count, b: p.weight }))}
            height={210}
          />
          <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Fruit count</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" /> Avg weight (g)</span>
          </div>
        </SectionCard>
      </div>

      {/* ---------------- Equipment ---------------- */}
      <SectionCard className="gh-surface !border-0 !shadow-none bg-white" title="GH Hardware &amp; Capability" icon={Wrench} iconTone="slate" realtime={ghRealtimeState} subtitle="Dedicated hardware reported by the Complex controller">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {equipmentCards.map((eq) => (
            <div key={eq.name} className={`rounded-xl border p-3 text-center ${eq.status === "OFFLINE" ? "border-slate-200 bg-slate-100/80 opacity-70" : "border-[--color-line] bg-slate-50/60"}`}>
              <div className="text-sm font-semibold text-slate-800">{eq.name}</div>
              <div className="mt-1 text-[10px] text-slate-400">{eq.detail}</div>
              <div className="mt-2 flex justify-center">
                <StatusBadge status={eq.status.toLowerCase()} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ---------------- Add Observation modal ---------------- */}
      <ObservationModal
        open={obsOpen}
        onClose={() => setObsOpen(false)}
        ghCode={gh.code}
        onSubmit={async (draft) => {
          await fertigationService.addObservation(gh.id, { ...draft, ghId: gh.id });
          toast(`Observation for ${draft.plantId} saved`, "success");
        }}
      />

      <ConfirmDialog
        open={estopOpen}
        onClose={() => { if (!stopping) setEstopOpen(false); }}
        onConfirm={handleEmergencyStop}
        title="Emergency Stop"
        message={`Stop all pumps and close all valves for ${gh.code} (${complex.code})? This affects physical equipment. The system stays in a safe state until you press Resume System.`}
        confirmLabel={stopping ? "Stopping…" : "Stop Everything"}
        danger
      />
      <ConfirmDialog
        open={resumeOpen}
        onClose={() => { if (!resuming) setResumeOpen(false); }}
        onConfirm={handleResume}
        title="Resume System"
        message={`Lift the latched emergency stop on ${complex.code}? Pumps and valves become available again; schedules resume their normal behaviour.`}
        confirmLabel={resuming ? "Resuming…" : "Resume System"}
      />

      <ConfirmDialog
        open={obsDeleteTarget !== null}
        onClose={() => setObsDeleteTarget(null)}
        onConfirm={handleDeleteObservation}
        title="Delete observation"
        message={`Are you sure you want to delete the observation for plant ${obsDeleteTarget?.plantId}? This cannot be undone.`}
        confirmLabel={obsDeleting ? "Deleting…" : "Delete"}
        danger
      />
    </AppShell>
  );
}

function ObservationModal({
  open,
  onClose,
  ghCode,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  ghCode: string;
  onSubmit: (draft: { plantId: string; heightCm: number; leafCount: number; fruitCount: number; notes: string }) => Promise<void>;
}) {
  const [plantId, setPlantId] = useState("B1N4.1");
  const [height, setHeight] = useState("85");
  const [leaves, setLeaves] = useState("21");
  const [fruits, setFruits] = useState("4");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const validate = () => {
    const errs: Record<string, string | null> = {
      plantId: required(plantId, "Plant ID"),
      height: number(height, { label: "Height", positive: true }),
      leaves: number(leaves, { label: "Leaf count", min: 0 }),
      fruits: number(fruits, { label: "Fruit count", min: 0 }),
    };
    setErrors(errs);
    return !Object.values(errs).some(Boolean);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={() => { if (!saving) onClose(); }}
        title={`Add Observation — ${ghCode}`}
        width={520}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button
              onClick={() => {
                if (validate()) setConfirmOpen(true);
              }}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Observation"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3.5">
          <div className="col-span-2">
            <Label required>Plant ID</Label>
            <Input value={plantId} onChange={(e) => setPlantId(e.target.value)} placeholder="B1N4.1" />
            <FieldError>{errors.plantId}</FieldError>
          </div>
          <div>
            <Label required>Height (cm)</Label>
            <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
            <FieldError>{errors.height}</FieldError>
          </div>
          <div>
            <Label required>Leaf Count</Label>
            <Input type="number" value={leaves} onChange={(e) => setLeaves(e.target.value)} />
            <FieldError>{errors.leaves}</FieldError>
          </div>
          <div>
            <Label required>Fruit Count</Label>
            <Input type="number" value={fruits} onChange={(e) => setFruits(e.target.value)} />
            <FieldError>{errors.fruits}</FieldError>
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condition, pests, treatment…" />
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setSaving(true);
          try {
            await onSubmit({ plantId: plantId.trim(), heightCm: Number(height) || 0, leafCount: Number(leaves) || 0, fruitCount: Number(fruits) || 0, notes });
            onClose();
          } finally {
            setSaving(false);
          }
        }}
        title="Save observation"
        message={`Record a new observation for plant ${plantId}?`}
        confirmLabel="Save"
      />
    </>
  );
}
