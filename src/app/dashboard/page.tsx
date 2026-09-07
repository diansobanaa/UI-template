"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Droplets,
  Gauge,
  Leaf,
  ListChecks,
  MapPin,
  MonitorCog,
  RefreshCw,
  ScrollText,
  Sprout,
  Thermometer,
  Truck,
  Users,
  Waves,
  Wrench,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { BigDateClock, ComplexSwitcher, Esp32StatusPill, SystemStatusPill, ConfigVersionPill } from "@/components/layout/bits";
import { MetricCard, SectionCard, ViewAllButton } from "@/components/ui/cards";
import { Badge, Button, StatusBadge } from "@/components/ui/primitives";
import { GreenhouseArt } from "@/components/ui/GreenhouseArt";
import { Progress } from "@/components/ui/primitives";
import { complexService, eventService, fertigationService, greenhouseService, scheduleService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { errorMessage } from "@/lib/errors";
import { MOCK_NOW, delta, lux, n } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/overlay";

export default function ComplexDashboardPage() {
  return (
    <Suspense fallback={null}>
      <ComplexDashboardContent />
    </Suspense>
  );
}

function ComplexDashboardContent() {
  useDbVersion(); // re-render on any mock-store mutation
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const [syncing, setSyncing] = useState(false);
  const [estopOpen, setEstopOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pumpBusy, setPumpBusy] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fertigationService.syncEsp32(complex.id);
      toast("ESP32 synchronized successfully", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(false);
    }
  };

  const handleEmergencyStop = async () => {
    setStopping(true);
    try {
      await fertigationService.emergencyStop(complex.id);
      toast("EMERGENCY STOP executed — all actuators off", "warning");
      setEstopOpen(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setStopping(false);
    }
  };

  const handleWellPump = async (on: boolean) => {
    setPumpBusy(true);
    try {
      await fertigationService.setWellPump(complex.id, on);
      toast(on ? "Well pump ON — radar reports Dalam Pengisian" : "Well pump OFF", on ? "success" : "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPumpBusy(false);
    }
  };

  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const events = eventService.recent(complex.id);

  const idx = complexes.findIndex((c) => c.id === complex.id);
  const prev = complexes[(idx - 1 + complexes.length) % complexes.length];
  const next = complexes[(idx + 1) % complexes.length];
  const go = (id: string) => router.replace(`/dashboard?complex=${id}`, { scroll: false });

  const onlineCount = ghs.filter((g) => g.online).length;
  const activeFertigations = ghs.filter((g) => g.currentRun).length;
  const totalPlants = ghs.reduce((a, g) => a + g.plants.total, 0);
  const totalToday = ghs.reduce((a, g) => a + (g.telemetry.waterTodayL ?? 0), 0);

  // Upcoming schedule = fertigation + well pump entries across the complex
  const upcoming: { time: string; gh: string; type: string; target: string }[] = [];
  for (const gh of ghs) {
    for (const s of greenhouseService.get(gh.id)?.fertigationSchedules ?? []) {
      if (s.status === "scheduled" || s.status === "running") {
        upcoming.push({ time: s.status === "running" ? "Running" : `Today ${s.time}`, gh: gh.code, type: "Fertigation", target: `${s.targetWaterL} L` });
      }
    }
  }
  upcoming.push(
    ...scheduleService.wellPumpForComplex(complex.id)
      .filter((s) => s.status === "scheduled")
      .map((s) => ({ time: `Today ${s.time}`, gh: "Raw Tank", type: "Well Pump", target: `${s.durationMin} min` }))
  );

  const equipment = ghs[0]?.equipment ?? [];

  return (
    <AppShell complexId={complex.id}>
      {/* ---------------- Page header ---------------- */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md">
            <Building2 className="h-6 w-6" />
          </span>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Complex</div>
            <h1 className="text-xl font-bold leading-tight text-slate-900">{complex.name}</h1>
            <div className="text-xs text-slate-500">{complex.location}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => go(prev.id)}
            aria-label="Previous complex"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="rounded-lg bg-blue-50 px-3.5 py-2 text-sm font-bold text-blue-700">
            {complex.code} / {String(complexes.length).padStart(2, "0")}
          </span>
          <button
            onClick={() => go(next.id)}
            aria-label="Next complex"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          <Esp32StatusPill esp32={complex.esp32} />
          <ConfigVersionPill version={complex.esp32.configVersion} />
          <SystemStatusPill status={complex.systemStatus} />
          <Button variant="secondary" size="md" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Synchronizing…" : "Sync Config"}
          </Button>
          <Button variant="secondary" size="md" onClick={() => setEstopOpen(true)}>
            <Zap className="h-4 w-4" /> Emergency Stop
          </Button>
        </div>
      </div>

      {/* ---------------- KPI row ---------------- */}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard icon={Cpu} iconTone="blue" label="ESP32 Controllers" value={complexes.length}>
          <span className="text-xs text-emerald-600">{complexes.filter((c) => c.esp32.online).length} online</span>
        </MetricCard>
        <MetricCard icon={Building2} iconTone="violet" label="Total Greenhouses" value={complexes.reduce((a, c) => a + c.greenhouseIds.length, 0)}>
          <span className="text-xs text-slate-500">{onlineCount} online in this complex</span>
        </MetricCard>
        <MetricCard icon={MapPin} iconTone="sky" label="Total Area" value="4,200 m²">
          <span className="text-xs text-slate-500">2 blocks</span>
        </MetricCard>
        <MetricCard icon={Droplets} iconTone="blue" label="Water Usage (Today)" value={`${n(totalToday)} L`}>
          <span className={`text-xs ${totalToday >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {delta(ghs[0]?.telemetry.waterDeltaPct ?? null)} vs yesterday
          </span>
        </MetricCard>
        <MetricCard icon={Truck} iconTone="amber" label="Active Fertigation" value={activeFertigations}>
          <span className="text-xs text-slate-500">of {ghs.length} greenhouses</span>
        </MetricCard>
        <MetricCard icon={Users} iconTone="green" label="Total Plants" value={n(totalPlants)}>
          <span className="text-xs text-emerald-600">+{Math.round(totalPlants * 0.018)} this week</span>
        </MetricCard>
      </div>

      {/* ---------------- Greenhouse summary ---------------- */}
      <div className="mb-5">
        <SectionCard
          title="Greenhouse Summary"
          icon={Building2}
          iconTone="blue"
          action={
            <>
              <ViewAllButton onClick={() => router.push(`/complex?complex=${complex.id}`)}>View All</ViewAllButton>
              <Button size="sm" variant="primary" onClick={() => router.push(`/complex?complex=${complex.id}&add=1`)}>
                + Add Greenhouse
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {ghs.map((gh) => (
              <Link
                key={gh.id}
                href={`/greenhouse/${gh.id}?complex=${complex.id}`}
                className="group overflow-hidden rounded-xl border border-[--color-line] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="relative h-[100px] overflow-hidden">
                  <GreenhouseArt crop={gh.crop} className="h-full w-full" />
                  <span className="absolute left-2.5 top-2.5">
                    <StatusBadge status={gh.online ? "online" : "offline"} />
                  </span>
                </div>
                <div className="px-3.5 pb-3.5 pt-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-900">{gh.code}</div>
                    <span className="text-[13px] text-slate-500">{gh.crop}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[13px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Thermometer className="h-3.5 w-3.5 text-slate-400" />
                      {gh.telemetry.temperatureC !== null ? `${gh.telemetry.temperatureC.toFixed(1)}°C` : "–"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Droplets className="h-3.5 w-3.5 text-slate-400" />
                      {gh.telemetry.humidityPct !== null ? `${gh.telemetry.humidityPct}%` : "–"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Waves className="h-3.5 w-3.5 text-slate-400" />
                      {gh.telemetry.tankPct}%
                    </span>
                  </div>
                  <div className="mt-2.5">
                    <StatusBadge status={gh.fertigationState} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ---------------- Middle grid ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Fertigation status */}
        <SectionCard
          title="Fertigation Status"
          icon={Droplets}
          iconTone="blue"
          action={<ViewAllButton onClick={() => router.push(`/fertigation?complex=${complex.id}`)}>View All</ViewAllButton>}
        >
          <div className="space-y-3.5">
            {ghs.map((gh) => (
              <div key={gh.id} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Sprout className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">{gh.code}</span>
                    <StatusBadge status={gh.fertigationState} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {gh.currentRun
                      ? `${gh.currentRun.recipeName} • ${gh.currentRun.progressPct}%`
                      : gh.fertigationState === "IDLE"
                        ? "No active run"
                        : `Next: ${gh.fertigationSchedules.find((s) => s.status === "scheduled")?.nextRun ?? "–"}`}
                  </div>
                  <Progress
                    value={gh.currentRun?.progressPct ?? 0}
                    color={gh.currentRun ? "bg-blue-500" : "bg-slate-300"}
                    className="mt-1.5"
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Upcoming schedule */}
        <SectionCard
          title="Upcoming Schedule"
          icon={CalendarClock}
          iconTone="violet"
          action={<ViewAllButton onClick={() => router.push(`/schedule?complex=${complex.id}`)}>View All</ViewAllButton>}
        >
          {upcoming.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-400">
              No upcoming schedules for this complex.
            </p>
          ) : (
            <div className="space-y-3">
              {upcoming.slice(0, 5).map((u, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                  <Clock className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">{u.gh}</span>
                    <span className="text-xs text-slate-500">{u.time}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {u.type} • {u.target}
                  </div>
                </div>
                <StatusBadge status={u.time === "Running" ? "running" : "scheduled"} />
              </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Recent events */}
        <SectionCard
          title="Recent Events"
          icon={ScrollText}
          iconTone="slate"
          action={<ViewAllButton onClick={() => router.push("/events")}>View All</ViewAllButton>}
        >
          <div className="space-y-3">
            {events.length === 0 && <p className="text-sm text-slate-400">No recent events for this complex.</p>}
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  {e.level === "warning" ? (
                    <AlertTriangle className="h-4.5 w-4.5 text-amber-500" />
                  ) : e.level === "error" ? (
                    <AlertTriangle className="h-4.5 w-4.5 text-red-500" />
                  ) : (
                    <ListChecks className="h-4.5 w-4.5 text-emerald-500" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800">{e.text}</div>
                  <div className="text-xs text-slate-400">{e.time} • today</div>
                </div>
                <StatusBadge status={e.level === "success" ? "completed" : e.level === "warning" ? "warning" : "failed"} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ---------------- Bottom grid ---------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Water system */}
        <SectionCard title="Water System" icon={Waves} iconTone="sky" className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[--color-line] bg-slate-50/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">Raw Water Tank</span>
                <Badge tone="gray">Radar: {scheduleService.wellPumpForComplex(complex.id)[0]?.radar === "full" ? "Penuh" : "Dalam Pengisian"}</Badge>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-slate-900">{complex.water.rawTankPct}%</span>
                <span className="pb-1 text-xs text-slate-500">of 5000 L</span>
              </div>
              <Progress value={complex.water.rawTankPct} color="bg-sky-500" className="mt-3" />
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>Well Pump: {complex.water.wellPumpOn ? "ON" : "OFF"}</span>
                <span>Flow Today: {n(complex.water.flowTodayL)} L</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col justify-between rounded-xl border border-[--color-line] bg-white p-3.5">
                <Gauge className="h-5 w-5 text-sky-500" />
                <div>
                  <div className="text-xs text-slate-500">Flow Rate</div>
                  <div className="text-lg font-bold text-slate-900">12.4 L/min</div>
                </div>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-[--color-line] bg-white p-3.5">
                <ArrowLeftRight className="h-5 w-5 text-blue-500" />
                <div>
                  <div className="text-xs text-slate-500">Water Today</div>
                  <div className="text-lg font-bold text-slate-900">{n(totalToday)} L</div>
                </div>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-[--color-line] bg-white p-3.5">
                <Activity className="h-5 w-5 text-emerald-500" />
                <div>
                  <div className="text-xs text-slate-500">Δ vs Yesterday</div>
                  <div className="text-lg font-bold text-emerald-600">{delta(complex.water.flowDeltaPct)}</div>
                </div>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-[--color-line] bg-white p-3.5">
                <Waves className="h-5 w-5 text-violet-500" />
                <div>
                  <div className="text-xs text-slate-500">Mixing Tanks Avg</div>
                  <div className="text-lg font-bold text-slate-900">
                    {Math.round(ghs.reduce((a, g) => a + g.telemetry.tankPct, 0) / Math.max(1, ghs.length))}%
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Equipment + Quick actions */}
        <div className="grid grid-rows-[auto_auto] gap-4">
          <SectionCard title="Equipment Status" icon={Wrench} iconTone="slate">
            <div className="space-y-2">
              {equipment.map((eq) => (
                <div key={eq.name} className="flex items-center justify-between rounded-lg border border-[--color-line] px-3 py-2">
                  <span className="text-sm text-slate-700">{eq.name}</span>
                  <StatusBadge status={eq.status.toLowerCase()} />
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Quick Actions" icon={Zap} iconTone="amber">
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                variant="secondary"
                className="h-auto flex-col gap-1 py-3"
                onClick={() => router.push(`/fertigation?complex=${complex.id}`)}
              >
                <Droplets className="h-5 w-5 text-blue-500" />
                <span className="text-xs">Manual Fertigation</span>
              </Button>
              <Button
                variant="secondary"
                className="h-auto flex-col gap-1 py-3"
                disabled={pumpBusy}
                onClick={() => handleWellPump(!complex.water.wellPumpOn)}
              >
                <Waves className="h-5 w-5 text-sky-500" />
                <span className="text-xs">{pumpBusy ? "Sending…" : complex.water.wellPumpOn ? "Well Pump OFF" : "Well Pump ON"}</span>
              </Button>
              <Button
                variant="secondary"
                className="h-auto flex-col gap-1 py-3"
                disabled={syncing}
                onClick={handleSync}
              >
                <RefreshCw className={`h-5 w-5 text-emerald-500 ${syncing ? "animate-spin" : ""}`} />
                <span className="text-xs">{syncing ? "Syncing…" : "Sync Hardware"}</span>
              </Button>
              <Button
                variant="secondary"
                className="h-auto flex-col gap-1 py-3"
                onClick={() => setEstopOpen(true)}
              >
                <Zap className="h-5 w-5 text-red-500" />
                <span className="text-xs">Emergency Stop</span>
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <BigDateClock />
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
        <MonitorCog className="h-3.5 w-3.5" />
        Last sync {complex.esp32.lastSync} • Config v{complex.esp32.configVersion} • Local time {MOCK_NOW.time} • v0.1.0
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-400">
        <Leaf className="h-3.5 w-3.5" />
        AgroTech Greenhouse Monitoring System • © 2026
      </div>

      <ConfirmDialog
        open={estopOpen}
        onClose={() => { if (!stopping) setEstopOpen(false); }}
        onConfirm={handleEmergencyStop}
        title="Emergency Stop"
        message={`Stop all pumps and close all valves in ${complex.code} immediately? This affects physical equipment. The system will stay in a safe state until manually resumed.`}
        confirmLabel={stopping ? "Stopping…" : "Stop Everything"}
        danger
      />
    </AppShell>
  );
}
