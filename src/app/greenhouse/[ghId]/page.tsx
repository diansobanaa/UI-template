"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
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
  Sprout,
  Sun,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Waves,
  Wind,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { SectionCard, ViewAllButton } from "@/components/ui/cards";
import { Badge, Button, Input, Label, Progress, StatusBadge, Textarea } from "@/components/ui/primitives";
import { AreaChart, DualLineChart, Donut } from "@/components/ui/charts";
import { GreenhouseArt } from "@/components/ui/GreenhouseArt";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { complexService, fertigationService, greenhouseService } from "@/lib/services";
import { environmentMetrics, fruitDevFor } from "@/lib/data/environment";
import { delta, lux, n } from "@/lib/format";
import type { RangeId } from "./range-types";

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
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);

  const ghId = params.get("gh") ?? ghs[0]?.id;
  const gh = greenhouseService.get(ghId ?? "") ?? ghs[0];
  if (!gh) return null;

  const idx = Math.max(0, ghs.findIndex((g) => g.id === gh.id));
  const prevGh = ghs[(idx - 1 + ghs.length) % ghs.length];
  const nextGh = ghs[(idx + 1) % ghs.length];
  const go = (id: string) => router.replace(`/greenhouse/${id}?complex=${complex.id}`, { scroll: false });

  const [range, setRange] = useState<RangeId>("24H");
  const [metric, setMetric] = useState<(typeof METRIC_TABS)[number]["id"]>("temperature");
  const [obsOpen, setObsOpen] = useState(false);

  const metrics = useMemo(() => environmentMetrics(gh), [gh]);
  const active = metrics.find((m) => m.id === metric)!;
  const activePoints = (active as unknown as { ranges: Record<RangeId, typeof active.points> }).ranges[range];

  const nextSchedule = gh.fertigationSchedules.find((s) => s.status === "scheduled");
  const fruitSeries = fruitDevFor(gh);

  const tempDeltaClass = (gh.telemetry.tempDeltaC ?? 0) >= 0 ? "text-red-500" : "text-blue-500";
  const TempTrendIcon = (gh.telemetry.tempDeltaC ?? 0) >= 0 ? TrendingUp : TrendingDown;

  return (
    <AppShell complexId={complex.id}>
      {/* ---------------- Hero ---------------- */}
      <div className="relative mb-5 overflow-hidden rounded-xl border border-[--color-line] shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
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
              <span className="text-xs text-slate-200/80">{gh.plants.latestObservation}</span>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <Button variant="secondary" onClick={() => router.push(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>
              <CalendarClock className="h-4 w-4" /> Schedule
            </Button>
            <Button variant="secondary" onClick={() => router.push(`/fertigation?complex=${complex.id}`)}>
              <Droplets className="h-4 w-4" /> Fertigation
            </Button>
            <Button variant="danger" onClick={() => toast("Emergency stop sent to GH " + gh.code, "warning")}>
              Emergency Stop
            </Button>
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
        <div className="rounded-xl border border-[--color-line] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
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
        <div className="rounded-xl border border-[--color-line] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
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
        <div className="rounded-xl border border-[--color-line] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-500">
            <Sun className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">Light</div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.lightLux !== null ? (gh.telemetry.lightLux / 1000).toFixed(1) : "–"}<span className="text-sm font-medium text-slate-400"> klux</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">{lux(gh.telemetry.lightLux)}</div>
        </div>
        <div className="rounded-xl border border-[--color-line] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Sprout className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">HST <span className="text-slate-400">(Hari Setelah Tanam)</span></div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.hstDays}<span className="text-sm font-medium text-slate-400"> days</span>
          </div>
        </div>
        <div className="rounded-xl border border-[--color-line] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-500">
            <Apple className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 text-xs text-slate-500">HSP <span className="text-slate-400">(Hari Setelah Polinasi)</span></div>
          <div className="text-2xl font-bold text-slate-900">
            {gh.telemetry.hspDays ?? "–"}<span className="text-sm font-medium text-slate-400">{gh.telemetry.hspDays !== null ? " days" : ""}</span>
          </div>
        </div>
        <div className="rounded-xl border border-[--color-line] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
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

      {/* ---------------- Charts + plant data ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Environmental Conditions"
          icon={Activity}
          iconTone="blue"
          className="xl:col-span-2"
          action={
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    range === r.id ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {METRIC_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setMetric(t.id)}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  metric === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <AreaChart key={`${gh.id}-${metric}-${range}`} points={activePoints} color={active.color} height={210} />
          <div className="mt-3 grid grid-cols-3 divide-x divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/60 py-2 text-center">
            <div>
              <div className="text-[11px] text-slate-400">Min</div>
              <div className="text-sm font-bold text-slate-800">{active.min} {active.unit}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Max</div>
              <div className="text-sm font-bold text-slate-800">{active.max} {active.unit}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Average</div>
              <div className="text-sm font-bold text-slate-800">{active.avg} {active.unit}</div>
            </div>
          </div>
        </SectionCard>

        {/* Plant & Fruit Data */}
        <SectionCard
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
            className="xl:col-span-2"
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
          <SectionCard title="Mixing Tank" icon={Beaker} iconTone="blue" className="xl:col-span-2">
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
        <SectionCard
          title="Next Schedule"
          icon={CalendarClock}
          iconTone="violet"
          action={<ViewAllButton onClick={() => router.push(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>View Schedule</ViewAllButton>}
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
        <SectionCard
          title="Today's Fertigation Schedule"
          icon={CalendarClock}
          iconTone="blue"
          action={<ViewAllButton onClick={() => router.push(`/schedule?complex=${complex.id}&gh=${gh.id}`)}>View All</ViewAllButton>}
        >
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
        </SectionCard>

        <SectionCard
          title="Fertigation History"
          icon={History}
          iconTone="slate"
          action={<ViewAllButton onClick={() => router.push(`/fertigation?complex=${complex.id}`)}>View All</ViewAllButton>}
        >
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
        </SectionCard>
      </div>

      {/* ---------------- Plant overview + fruit development ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Plant Overview" icon={Sprout} iconTone="green">
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

        <SectionCard
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
      <SectionCard title="GH Equipment" icon={Wrench} iconTone="slate">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          {gh.equipment.map((eq) => (
            <div key={eq.name} className="rounded-xl border border-[--color-line] bg-slate-50/60 p-3 text-center">
              <div className="text-sm font-semibold text-slate-800">{eq.name}</div>
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
        onSubmit={(draft) => {
          fertigationService.addObservation(gh.id, { ...draft, ghId: gh.id });
          toast(`Observation for ${draft.plantId} saved`, "success");
        }}
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
  onSubmit: (draft: { plantId: string; heightCm: number; leafCount: number; fruitCount: number; notes: string }) => void;
}) {
  const [plantId, setPlantId] = useState("B1N4.1");
  const [height, setHeight] = useState("85");
  const [leaves, setLeaves] = useState("21");
  const [fruits, setFruits] = useState("4");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Add Observation — ${ghCode}`}
        width={520}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => setConfirmOpen(true)}>Save Observation</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3.5">
          <div className="col-span-2">
            <Label required>Plant ID</Label>
            <Input value={plantId} onChange={(e) => setPlantId(e.target.value)} placeholder="B1N4.1" />
          </div>
          <div>
            <Label required>Height (cm)</Label>
            <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
          <div>
            <Label required>Leaf Count</Label>
            <Input type="number" value={leaves} onChange={(e) => setLeaves(e.target.value)} />
          </div>
          <div>
            <Label required>Fruit Count</Label>
            <Input type="number" value={fruits} onChange={(e) => setFruits(e.target.value)} />
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
        onConfirm={() => {
          onSubmit({ plantId, heightCm: Number(height) || 0, leafCount: Number(leaves) || 0, fruitCount: Number(fruits) || 0, notes });
          onClose();
        }}
        title="Save observation"
        message={`Record a new observation for plant ${plantId}?`}
        confirmLabel="Save"
      />
    </>
  );
}
