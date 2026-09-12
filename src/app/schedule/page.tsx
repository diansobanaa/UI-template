"use client";

import { Suspense, useState, type ComponentType, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Clock,
  Droplets,
  Fan,
  ListOrdered,
  MonitorCog,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Trash2,
  Waves,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ComplexSwitcher } from "@/components/layout/bits";
import { IconButton } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import { AddFertigationDrawer } from "@/components/schedule/AddFertigationDrawer";
import { AddWellPumpDrawer } from "@/components/schedule/AddWellPumpDrawer";
import { AddFanScheduleDrawer } from "@/components/schedule/AddFanScheduleDrawer";
import { useToast } from "@/components/ui/toast";
import { complexService, fertigationService, greenhouseService, scheduleService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { errorMessage } from "@/lib/errors";
import { MOCK_NOW } from "@/lib/format";
import type { FanSchedule, FertigationSchedule, ScheduleStatus, WellPumpSchedule } from "@/lib/types";
import { complexRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";

export default function SchedulePage() {
  return (
    <Suspense fallback={null}>
      <ScheduleContent />
    </Suspense>
  );
}

export function ScheduleContent({
  embedded = false,
  selectedComplexId,
  selectedGreenhouseId,
}: {
  embedded?: boolean;
  selectedComplexId?: string;
  selectedGreenhouseId?: string;
}) {
  useDbVersion(); // re-render on any mock-store mutation
  const [params] = useSearchParams();
  const toast = useToast();

  const complexes = complexService.list();
  const complexId = selectedComplexId ?? params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const selectedGhId = selectedGreenhouseId ?? params.get("gh") ?? ghs[0]?.id ?? "";
  const gh = greenhouseService.get(selectedGhId) ?? ghs[0];
  const scheduleGreenhouses = selectedGreenhouseId ? [gh] : ghs;
  const realtimeState = complexRealtimeState(complex, ghs);

  const [fertOpen, setFertOpen] = useState(false);
  const [pumpOpen, setPumpOpen] = useState(false);
  const [fanOpen, setFanOpen] = useState(false);
  const [editFert, setEditFert] = useState<FertigationSchedule | null>(null);
  const [editPump, setEditPump] = useState<WellPumpSchedule | null>(null);
  const [editFan, setEditFan] = useState<FanSchedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "fert" | "pump" | "fan"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fertSchedules = scheduleGreenhouses.flatMap((greenhouse) => scheduleService.fertigationForGh(greenhouse.id));
  const wellPumps = scheduleService.wellPumpForComplex(complex.id);
  const fanSchedules = scheduleGreenhouses.flatMap((greenhouse) => scheduleService.fanForGh(greenhouse.id));

  // Queue = pending mixing entries for this GH
  const queue = fertSchedules.filter((s) => s.status === "scheduled");

  const toTimelineStatus = (st: ScheduleStatus): ScheduleTimelineEvent["status"] => {
    if (st === "completed") return "completed";
    if (st === "running") return "running";
    if (st === "missed") return "missed";
    return "scheduled";
  };

  const timelineEvents: ScheduleTimelineEvent[] = [
    ...fertSchedules
      .filter((s) => s.enabled)
      .map((s) => ({
        id: `fert-${s.id}`,
        time: s.time,
        greenhouse: greenhouseService.get(s.ghId)?.code ?? "GH",
        type: "fertigation" as const,
        title: "Fertigation",
        sub: `${s.targetWaterL} L`,
        durationMin: 45,
        status: toTimelineStatus(s.status),
      })),
    ...fanSchedules
      .filter((s) => s.enabled)
      .map((s) => ({
        id: `fan-${s.id}`,
        time: s.time,
        greenhouse: greenhouseService.get(s.ghId)?.code ?? "GH",
        type: "fan" as const,
        title: "Fan",
        sub: `${s.durationMin} min`,
        durationMin: s.durationMin,
        status: toTimelineStatus(s.status),
      })),
    ...wellPumps
      .filter((s) => s.enabled)
      .map((s) => ({
        id: `pump-${s.id}`,
        time: s.time,
        greenhouse: "Complex",
        type: "pump" as const,
        title: "Well Pump",
        sub: `${s.durationMin} min`,
        durationMin: s.durationMin,
        status: toTimelineStatus(s.status),
      })),
  ]
    .filter((e) => e.time && e.time !== "--:--")
    .sort((a, b) => a.time.localeCompare(b.time));

  /* ---------------------------- mutations ---------------------------- */

  const handleFertSubmit = async (input: Omit<FertigationSchedule, "id">, initial: FertigationSchedule | null) => {
    if (initial) {
      await scheduleService.updateFertigation(initial.id, input);
      toast(`Fertigation schedule "${input.name}" updated`, "success");
    } else {
      await scheduleService.createFertigation(input);
      toast(`Fertigation schedule "${input.name}" created`, "success");
    }
  };

  const handlePumpSubmit = async (input: Omit<WellPumpSchedule, "id">, initial: WellPumpSchedule | null) => {
    if (initial) {
      await scheduleService.updateWellPump(initial.id, input);
      toast(`Well pump schedule "${input.task}" updated`, "success");
    } else {
      await scheduleService.createWellPump(input);
      toast(`Well pump schedule "${input.task}" created`, "success");
    }
  };

  const handleFanSubmit = async (input: Omit<FanSchedule, "id">, initial: FanSchedule | null) => {
    if (initial) {
      await scheduleService.updateFan(initial.id, input);
      toast("Fan schedule updated", "success");
    } else {
      await scheduleService.createFan(input);
      toast("Fan schedule created", "success");
    }
  };

  const handleToggle = async (
    kind: "fert" | "pump" | "fan",
    id: string,
    v: boolean,
    label: string
  ) => {
    setTogglingId(id);
    try {
      if (kind === "fert") await scheduleService.updateFertigation(id, { enabled: v, status: v ? "scheduled" : "disabled" });
      if (kind === "pump") await scheduleService.updateWellPump(id, { enabled: v, status: v ? "scheduled" : "disabled" });
      if (kind === "fan") await scheduleService.updateFan(id, { enabled: v, status: v ? "scheduled" : "disabled" });
      toast(v ? `${label} enabled` : `${label} disabled`, v ? "success" : "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === "fert") await scheduleService.deleteFertigation(deleteTarget.id);
      if (deleteTarget.kind === "pump") await scheduleService.deleteWellPump(deleteTarget.id);
      if (deleteTarget.kind === "fan") await scheduleService.deleteFan(deleteTarget.id);
      toast(`Schedule "${deleteTarget.name}" deleted`, "info");
    } catch (e) {
      // nothing was removed — the schedule stays in the table
      toast(errorMessage(e), "error");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

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

  const radarState: "filling" | "full" = wellPumps[0]?.radar ?? "filling";

  return (
    <ScheduleFrame embedded={embedded} complexId={complex.id}>
      {/* Context / top meta */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        {!embedded && <ComplexSwitcher complexId={complex.id} complexes={complexes} />}
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/35 px-3 py-2 text-[11px] text-slate-400 shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
          <Clock className="h-3.5 w-3.5 text-slate-500" />
          <span>{MOCK_NOW.label}</span>
          <span className="text-slate-600">•</span>
          <span className="font-semibold text-slate-300">{MOCK_NOW.time}</span>
        </div>
      </div>

      {/* Page title */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[25px] font-bold tracking-[-0.025em] text-slate-50">Schedule &amp; Timer</h1>
            <div className="inline-flex items-center gap-1.5 rounded-md border border-red-400/20 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-red-300">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.8)]" />
              Problem
            </div>
            <LiveStatus state={realtimeState} label={`${complex.code} schedule data`} />
          </div>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            <span className="font-medium text-slate-300">{complex.code}</span> — operational schedules across {ghs.length} greenhouses
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Fertigation Schedules", value: fertSchedules.filter((s) => s.enabled).length, icon: Droplets, tone: "blue", spark: 0 },
          { label: "Well Pump Schedules", value: wellPumps.filter((s) => s.enabled).length, icon: Waves, tone: "cyan", spark: 1 },
          { label: "Fan Schedules", value: fanSchedules.filter((s) => s.enabled).length, icon: Fan, tone: "green", spark: 2 },
          { label: "Queue (pending today)", value: queue.length, icon: ListOrdered, tone: "violet", spark: 3 },
        ].map((s) => {
          const tones = {
            blue: { glow: "from-blue-500/18 via-blue-500/5 to-transparent", icon: "border-blue-400/20 bg-blue-500/12 text-blue-300", line: "text-blue-300" },
            cyan: { glow: "from-cyan-500/18 via-cyan-500/5 to-transparent", icon: "border-cyan-400/20 bg-cyan-500/12 text-cyan-300", line: "text-cyan-300" },
            green: { glow: "from-emerald-500/18 via-emerald-500/5 to-transparent", icon: "border-emerald-400/20 bg-emerald-500/12 text-emerald-300", line: "text-emerald-300" },
            violet: { glow: "from-violet-500/18 via-violet-500/5 to-transparent", icon: "border-violet-400/20 bg-violet-500/12 text-violet-300", line: "text-violet-300" },
          }[s.tone as "blue" | "cyan" | "green" | "violet"];
          return (
            <div key={s.label} className="relative overflow-hidden rounded-xl border border-slate-800/90 bg-[#0e1a2a]/95 px-4 py-3.5 shadow-[0_14px_40px_rgba(0,0,0,0.18)]">
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tones.glow}`} />
              <div className="relative flex items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${tones.icon}`}>
                  <s.icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </div>
                <div className="min-w-0">
                  <div className="text-[23px] font-bold leading-none tracking-tight text-slate-50">{s.value}</div>
                  <div className="mt-1 text-[11px] font-medium text-slate-400">{s.label}</div>
                </div>
                <div className={`ml-auto ${tones.line}`}>
                  <MiniSparkline offset={s.spark} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Today's timeline */}
      <div className="mb-5">
        <DarkSectionCard title="Today's Schedule Timeline" icon={Clock} iconTone="blue" subtitle={`${complex.code} • ${MOCK_NOW.label}`}>
          <ScheduleTimeline events={timelineEvents} nowPct={MOCK_NOW.dayPct} />
        </DarkSectionCard>
      </div>

      {/* Fertigation schedules (GH-level) */}
      <div className="mb-5">
        <DarkSectionCard
          title={`Fertigation Schedules — ${complex.code}`}
          icon={Droplets}
          iconTone="blue"
          subtitle="Greenhouse-level schedules"
          action={
            <ActionButton tone="blue" onClick={() => { setEditFert(null); setFertOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Add Fertigation Schedule
            </ActionButton>
          }
        >
          <ScheduleTable
            rows={fertSchedules.map((s) => ({
              id: s.id,
              name: s.name,
              greenhouse: greenhouseService.get(s.ghId)?.code ?? "–",
              time: s.time,
              repeat: s.repeat,
              detail: `${s.targetWaterL} L • A ${s.dosingAml}ml / B ${s.dosingBml}ml`,
              lastRun: s.lastRun,
              nextRun: s.nextRun,
              enabled: s.enabled,
              status: s.status,
            }))}
            addLabel="Add Fertigation Schedule"
            onAdd={() => { setEditFert(null); setFertOpen(true); }}
            onToggle={(id, v) => handleToggle("fert", id, v, "Schedule")}
            onEdit={(id) => { setEditFert(fertSchedules.find((s) => s.id === id) ?? null); setFertOpen(true); }}
            onDelete={(id, name) => setDeleteTarget({ kind: "fert", id, name })}
            togglingId={togglingId}
          />
        </DarkSectionCard>
      </div>

      {/* Well pump (Complex-level) + radar */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DarkSectionCard
            title={`Well Pump Schedule — ${complex.code}`}
            icon={Waves}
            iconTone="sky"
            subtitle="Complex-level: fills the shared raw water tank"
            action={
              <ActionButton tone="cyan" onClick={() => { setEditPump(null); setPumpOpen(true); }}>
                <Plus className="h-3.5 w-3.5" /> Add Well Pump Schedule
              </ActionButton>
            }
          >
            <ScheduleTable
              rows={wellPumps.map((s) => ({
                id: s.id,
                name: s.task,
                greenhouse: "Complex",
                time: s.time,
                repeat: s.repeat,
                detail: `${s.durationMin} min run`,
                lastRun: s.lastRun,
                nextRun: s.nextRun,
                enabled: s.enabled,
                status: s.status,
              }))}
              accent="sky"
              addLabel="Add Well Pump Schedule"
              onAdd={() => { setEditPump(null); setPumpOpen(true); }}
              onToggle={(id, v) => handleToggle("pump", id, v, "Well pump schedule")}
              onEdit={(id) => { setEditPump(wellPumps.find((s) => s.id === id) ?? null); setPumpOpen(true); }}
              onDelete={(id, name) => setDeleteTarget({ kind: "pump", id, name })}
              togglingId={togglingId}
            />
          </DarkSectionCard>
        </div>

        <DarkSectionCard title="Well Pump" icon={Radar} iconTone="slate" subtitle="AUTO MODE">
          <div className="space-y-3">
            <div className={`rounded-xl border px-4 py-4 ${radarState === "filling" ? "border-emerald-400/20 bg-emerald-500/8" : "border-slate-800 bg-slate-950/30"}`}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Radar Tank Status</div>
              <div className="mt-3 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-emerald-300">
                    <span className={`h-2 w-2 rounded-full ${radarState === "filling" ? "bg-emerald-400 pulse-dot shadow-[0_0_10px_rgba(52,211,153,0.7)]" : "bg-emerald-400/35"}`} />
                    Dalam Pengisian
                  </span>
                  {radarState === "filling" && <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Pump allowed</span>}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-400">
                    <span className={`h-2 w-2 rounded-full ${radarState === "full" ? "bg-slate-300" : "bg-slate-700"}`} />
                    Penuh
                  </span>
                  {radarState === "full" && <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[10px] font-semibold text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-slate-500" />Pump OFF</span>}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-blue-400/10 bg-blue-500/7 px-3.5 py-3 text-[11px] leading-5 text-slate-400">
              <span className="font-semibold text-blue-300">Binary radar state.</span> The schedule remains scheduled; radar only determines whether the physical pump is permitted to run.
            </div>
          </div>
        </DarkSectionCard>
      </div>

      {/* Fan schedules (GH-level) */}
      <div className="mb-5">
        <DarkSectionCard
          title={`Fan Schedules — ${complex.code}`}
          icon={Fan}
          iconTone="green"
          subtitle="Greenhouse-level schedules"
          action={
            <ActionButton tone="green" onClick={() => { setEditFan(null); setFanOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Add Fan Schedule
            </ActionButton>
          }
        >
          <ScheduleTable
            rows={fanSchedules.map((s) => ({
              id: s.id,
              name: s.mode === "time" ? `Fan — ${s.time}` : "Fan — Temperature",
              greenhouse: greenhouseService.get(s.ghId)?.code ?? "–",
              time: s.mode === "time" ? s.time : "Auto",
              repeat: s.mode === "time" ? s.repeat : `ON > ${s.onAboveC}°C / OFF < ${s.offBelowC}°C`,
              detail: s.mode === "time" ? `${s.durationMin} min run` : "Hysteresis control",
              lastRun: s.lastRun,
              nextRun: s.nextRun,
              enabled: s.enabled,
              status: s.status,
            }))}
            accent="green"
            addLabel="Add Fan Schedule"
            onAdd={() => { setEditFan(null); setFanOpen(true); }}
            onToggle={(id, v) => handleToggle("fan", id, v, "Fan schedule")}
            onEdit={(id) => { setEditFan(fanSchedules.find((s) => s.id === id) ?? null); setFanOpen(true); }}
            onDelete={(id, name) => setDeleteTarget({ kind: "fan", id, name })}
            togglingId={togglingId}
          />
        </DarkSectionCard>
      </div>

      {/* Queue + ESP32 config */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DarkSectionCard title="Queue" icon={ListOrdered} iconTone="violet" subtitle="Pending executions for today">
          {queue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/30 px-4 py-7 text-center">
              <p className="text-[13px] text-slate-500">No fertigation schedules configured.</p>
              <ActionButton tone="violet" size="sm" className="mt-3" onClick={() => { setEditFert(null); setFertOpen(true); }}>
                <Plus className="h-3.5 w-3.5" /> Add Fertigation Schedule
              </ActionButton>
            </div>
          ) : (
            <div className="space-y-2.5">
              {queue.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-[#0d1929] px-3.5 py-3 shadow-[0_8px_18px_rgba(0,0,0,0.12)]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-400/20 bg-violet-500/10 text-violet-300">
                    <ListOrdered className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-100">{s.name} • {greenhouseService.get(s.ghId)?.code ?? "GH"}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{s.nextRun} • {s.targetWaterL} L</div>
                  </div>
                  <StatusPill status="scheduled" />
                </div>
              ))}
            </div>
          )}
        </DarkSectionCard>

        <DarkSectionCard
          title="ESP32 Configuration"
          icon={MonitorCog}
          iconTone="slate"
          action={
            <ActionButton tone="slate" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Synchronizing…" : "Sync Now"}
            </ActionButton>
          }
        >
          <div className="space-y-1.5 text-[12px]">
            {[
              ["Device", `ESP32-S3 • ${complex.code}`],
              ["Status", complex.esp32.online ? "ONLINE" : "OFFLINE"],
              ["Last Sync", complex.esp32.lastSync],
              ["Configuration Version", `v${complex.esp32.configVersion}`],
              ["ESP32 Config Version", `v${complex.esp32.esp32ConfigVersion}`],
              ["Synchronization", complex.esp32.synchronized ? "SYNCHRONIZED" : "PENDING"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 rounded-lg border border-slate-800/70 bg-slate-950/25 px-3.5 py-2.5">
                <span className="text-slate-500">{k}</span>
                <span className="text-right font-semibold text-slate-200">{v}</span>
              </div>
            ))}
          </div>
        </DarkSectionCard>
      </div>

      {/* Drawers */}
      <AddFertigationDrawer
        open={fertOpen}
        onClose={() => setFertOpen(false)}
        ghId={gh.id}
        ghCode={gh.code}
        recipes={gh.recipes}
        initial={editFert}
        onSubmit={handleFertSubmit}
      />
      <AddWellPumpDrawer
        open={pumpOpen}
        onClose={() => setPumpOpen(false)}
        complexId={complex.id}
        complexCode={complex.code}
        initial={editPump}
        onSubmit={handlePumpSubmit}
      />
      <AddFanScheduleDrawer
        open={fanOpen}
        onClose={() => setFanOpen(false)}
        ghId={gh.id}
        ghCode={gh.code}
        initial={editFan}
        onSubmit={handleFanSubmit}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete schedule"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        danger
      />
    </ScheduleFrame>
  );
}

type ScheduleTimelineEvent = {
  id: string;
  time: string;
  greenhouse: string;
  type: "fertigation" | "fan" | "pump";
  title: string;
  sub: string;
  durationMin: number;
  status: "completed" | "running" | "scheduled" | "missed";
};

function parseClock(time: string) {
  const [h, m] = time.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

function statusAccent(status: ScheduleTimelineEvent["status"]) {
  if (status === "completed") return "border-emerald-400/25 bg-emerald-500/10";
  if (status === "running") return "border-blue-400/45 bg-blue-500/15 shadow-[0_0_28px_rgba(59,130,246,0.2)]";
  if (status === "missed") return "border-red-400/30 bg-red-500/10";
  return "border-blue-400/25 bg-blue-500/10";
}

function eventIcon(type: ScheduleTimelineEvent["type"]) {
  if (type === "fan") return <Fan className="h-3.5 w-3.5 text-emerald-300" />;
  if (type === "pump") return <Waves className="h-3.5 w-3.5 text-cyan-300" />;
  return <Droplets className="h-3.5 w-3.5 text-blue-300" />;
}

function MiniSparkline({ offset = 0 }: { offset?: number }) {
  const d = `M2 25 C 16 ${25 - (offset % 5)} 22 8 38 ${15 - (offset % 4)} S 56 24 70 10 S 90 14 98 4`;
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-24 shrink-0 opacity-80" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function DarkSectionCard({
  title,
  icon: Icon,
  iconTone = "blue",
  subtitle,
  action,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  iconTone?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    blue: "border-blue-400/15 bg-blue-500/10 text-blue-300",
    sky: "border-cyan-400/15 bg-cyan-500/10 text-cyan-300",
    green: "border-emerald-400/15 bg-emerald-500/10 text-emerald-300",
    violet: "border-violet-400/15 bg-violet-500/10 text-violet-300",
    slate: "border-slate-700 bg-slate-800/70 text-slate-200",
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1a2a] shadow-[0_18px_55px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-[#0f1d30] px-4 py-4 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${tones[iconTone] ?? tones.blue}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

function ScheduleTimeline({ events, nowPct }: { events: ScheduleTimelineEvent[]; nowPct: number }) {
  const lanes = ["GH 01", "GH 02", "GH 03", "GH 04", "GH 05"];
  const palette = ["bg-blue-500", "bg-emerald-400", "bg-amber-400", "bg-violet-400", "bg-pink-400"];
  const hourMarks = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const nowMinutes = Math.min(1439, Math.max(0, Math.round(nowPct * 1440)));

  return (
    <div className="overflow-x-auto scroll-thin">
      <div className="min-w-[1120px]">
        <div className="mb-3 grid grid-cols-[80px_1fr] items-center">
          <div />
          <div className="relative flex justify-between px-1 text-[10px] font-semibold text-slate-500">
            {hourMarks.map((h) => <span key={h}>{String(h).padStart(2, "0")}:00</span>)}
          </div>
        </div>
        <div className="relative rounded-xl border border-slate-800 bg-[#0b1625] p-2.5">
          <div className="pointer-events-none absolute inset-y-2 left-[80px] right-2">
            {hourMarks.map((h) => (
              <span key={h} className="absolute inset-y-0 border-l border-slate-800/80" style={{ left: `${(h / 24) * 100}%` }} />
            ))}
          </div>
          {lanes.map((lane, laneIndex) => {
            const laneEvents = events.filter((e) => e.greenhouse === lane);
            return (
              <div key={lane} className="relative grid min-h-[58px] grid-cols-[80px_1fr] items-center border-b border-slate-800/70 last:border-b-0">
                <div className="flex items-center gap-2 pl-1 text-[11px] font-semibold text-slate-400">
                  <span className={`h-2.5 w-2.5 rounded-full ${palette[laneIndex]}`} />
                  {lane}
                </div>
                <div className="relative h-full min-h-[58px]">
                  {laneEvents.map((e, idx) => {
                    const start = parseClock(e.time);
                    const left = (start / 1440) * 100;
                    const width = Math.max(7.2, Math.min(12, ((e.durationMin || 45) / 1440) * 100 + 5));
                    const stack = idx % 2;
                    return (
                      <div
                        key={e.id}
                        className={`absolute rounded-lg border px-2.5 py-1.5 shadow-[0_8px_25px_rgba(0,0,0,0.2)] ${statusAccent(e.status)}`}
                        style={{ left: `${left}%`, width: `${width}%`, top: stack ? "6px" : "31px", minWidth: 96 }}
                      >
                        <div className="flex items-center gap-1.5">
                          {eventIcon(e.type)}
                          <span className="text-[10px] font-bold text-slate-100">{e.time}</span>
                        </div>
                        <div className="mt-0.5 truncate text-[9px] font-semibold text-slate-300">{e.title}</div>
                        <div className="text-[9px] text-slate-500">{e.sub}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="pointer-events-none absolute bottom-2 top-2" style={{ left: `calc(5.3% + ${Math.max(0, Math.min(1, nowPct)) * 94.7}%)` }}>
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-md bg-blue-500 px-2 py-0.5 text-[9px] font-bold text-white shadow-[0_0_18px_rgba(59,130,246,0.35)]">
              {String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:{String(nowMinutes % 60).padStart(2, "0")}
            </div>
            <div className="h-full w-px bg-blue-400 shadow-[0_0_18px_rgba(96,165,250,0.75)]" />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md bg-blue-500 px-2 py-0.5 text-[9px] font-bold text-white">Now</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleFrame({ embedded, complexId, children }: { embedded: boolean; complexId: string; children: ReactNode }) {
  const content = (
    <div className="min-h-screen bg-[#07121f] text-slate-100 [background-image:radial-gradient(circle_at_top_right,rgba(37,99,235,0.12),transparent_28%),radial-gradient(circle_at_75%_85%,rgba(16,185,129,0.05),transparent_22%)]">
      <div className="mx-auto max-w-[1680px] px-4 py-4 md:px-6 md:py-5">
        {children}
      </div>
    </div>
  );
  return embedded ? content : <AppShell complexId={complexId}>{content}</AppShell>;
}

/* ------------------------- schedule table ------------------------- */

interface Row {
  id: string;
  name: string;
  greenhouse: string;
  time: string;
  repeat: string;
  detail: string;
  lastRun: string | null;
  nextRun: string | null;
  enabled: boolean;
  status: FertigationSchedule["status"];
}

function ScheduleTable({
  rows,
  accent = "blue",
  addLabel,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
  togglingId,
}: {
  rows: Row[];
  accent?: "blue" | "sky" | "green";
  addLabel: string;
  onAdd: () => void;
  onToggle: (id: string, v: boolean) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  togglingId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");

  const filtered = rows
    .filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((r) => (statusFilter === "all" ? true : statusFilter === "enabled" ? r.enabled : !r.enabled))
    .sort((a, b) => a.time.localeCompare(b.time));

  const accentClasses = {
    blue: "border-blue-400/20 bg-blue-500/10 text-blue-300",
    sky: "border-cyan-400/20 bg-cyan-500/10 text-cyan-300",
    green: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  }[accent];

  return (
    <div>
      {rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search schedules…"
              className="h-10 w-full rounded-lg border border-slate-700/90 bg-[#0a1524] px-3 pl-8.5 text-[12px] font-medium text-slate-200 outline-none transition placeholder:text-slate-600 hover:border-slate-600 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-10 w-40 appearance-none rounded-lg border border-slate-700/90 bg-[#0a1524] px-3.5 pr-9 text-[12px] font-medium text-slate-200 outline-none transition hover:border-slate-600 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/10"
            >
              <option value="all">All statuses</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">⌄</span>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-[#0a1524]/80 px-4 py-7 text-center">
          <p className="text-[13px] font-medium text-slate-500">
            {rows.length === 0 ? `No ${addLabel.toLowerCase().replace(/^add /, "").replace(/ schedule$/, "")} schedules configured.` : "No schedules match your search or filter."}
          </p>
          {rows.length === 0 ? (
            <ActionButton tone="slate" size="sm" className="mt-3" onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" /> {addLabel}
            </ActionButton>
          ) : (
            <button
              type="button"
              className="mt-3 rounded-lg border border-slate-800 bg-[#0d1929] px-3 py-2 text-[11px] font-semibold text-slate-400 transition hover:border-slate-700 hover:bg-slate-800/70 hover:text-slate-200"
              onClick={() => { setQuery(""); setStatusFilter("all"); }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead>
              <tr className="border-b border-slate-800/90 text-left text-[9px] uppercase tracking-[0.14em] text-slate-600">
                <th className="pb-2.5 font-semibold">Task</th>
                <th className="pb-2.5 font-semibold">Greenhouse</th>
                <th className="pb-2.5 font-semibold">Time</th>
                <th className="pb-2.5 font-semibold">Repeat</th>
                <th className="pb-2.5 font-semibold">Last Run</th>
                <th className="pb-2.5 font-semibold">Next Run</th>
                <th className="pb-2.5 font-semibold">Status</th>
                <th className="pb-2.5 font-semibold">Enabled</th>
                <th className="pb-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={`border-b border-slate-800/60 last:border-0 ${r.enabled ? "" : "opacity-50"}`}>
                  <td className="py-3.5 pr-3">
                    <div className="font-semibold text-slate-100">{r.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{r.detail}</div>
                  </td>
                  <td className="py-3.5 pr-3 font-medium text-slate-300">{r.greenhouse}</td>
                  <td className="py-3.5 pr-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-bold ${accentClasses}`}>
                      <Clock className="h-3 w-3" /> {r.time}
                    </span>
                  </td>
                  <td className="py-3.5 pr-3 text-slate-300">{r.repeat}</td>
                  <td className="py-3.5 pr-3 text-slate-500">{r.lastRun ?? "–"}</td>
                  <td className="py-3.5 pr-3 font-medium text-slate-300">{r.nextRun ?? "–"}</td>
                  <td className="py-3.5 pr-3"><StatusPill status={r.status} /></td>
                  <td className="py-3.5 pr-3">
                    <ScheduleToggle checked={r.enabled} onChange={(v) => onToggle(r.id, v)} disabled={togglingId === r.id} />
                  </td>
                  <td className="py-3.5">
                    <div className="flex justify-end gap-1">
                      <IconButton aria-label="Edit" title="Edit" onClick={() => onEdit(r.id)} className="text-slate-500 hover:bg-blue-500/10 hover:text-blue-300">
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton aria-label="Delete" title="Delete" onClick={() => onDelete(r.id, r.name)} className="text-slate-500 hover:bg-red-500/10 hover:text-red-300">
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  tone = "blue",
  size = "md",
  className = "",
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  tone?: "blue" | "cyan" | "green" | "violet" | "slate";
  size?: "sm" | "md";
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const tones = {
    blue: "border-blue-400/20 bg-blue-600/90 text-blue-50 shadow-[0_8px_22px_rgba(37,99,235,0.20)] hover:bg-blue-500/95 hover:border-blue-300/30",
    cyan: "border-cyan-400/20 bg-cyan-500/12 text-cyan-200 hover:bg-cyan-500/18 hover:border-cyan-300/30",
    green: "border-emerald-400/20 bg-emerald-500/12 text-emerald-200 hover:bg-emerald-500/18 hover:border-emerald-300/30",
    violet: "border-violet-400/20 bg-violet-500/12 text-violet-200 hover:bg-violet-500/18 hover:border-violet-300/30",
    slate: "border-slate-700 bg-slate-800/45 text-slate-300 hover:bg-slate-700/55 hover:text-slate-100",
  }[tone];
  const sizing = size === "sm" ? "h-9 px-3 text-[11px]" : "h-10 px-3.5 text-[12px]";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold tracking-[-0.005em] transition duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${sizing} ${tones} ${className}`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: FertigationSchedule["status"] }) {
  const config = {
    completed: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
    scheduled: "border-blue-400/20 bg-blue-500/10 text-blue-300",
    running: "border-cyan-400/25 bg-cyan-500/10 text-cyan-300",
    missed: "border-red-400/20 bg-red-500/10 text-red-300",
    disabled: "border-slate-700 bg-slate-800/50 text-slate-500",
  } as const;
  const labels = { completed: "Completed", scheduled: "Scheduled", running: "Running", missed: "Missed", disabled: "Disabled" } as const;
  const dot = {
    completed: "bg-emerald-400",
    scheduled: "bg-blue-400",
    running: "bg-cyan-300",
    missed: "bg-red-400",
    disabled: "bg-slate-500",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${config[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status]}`} />
      {labels[status]}
    </span>
  );
}

function ScheduleToggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? "Disable schedule" : "Enable schedule"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full border transition ${checked ? "border-blue-400/30 bg-blue-500" : "border-slate-700 bg-slate-800"} disabled:opacity-40`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full shadow-sm transition ${checked ? "left-[18px] bg-white" : "left-0.5 bg-slate-500"}`} />
    </button>
  );
}
