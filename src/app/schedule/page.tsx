"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarClock,
  Clock,
  Droplets,
  Fan,
  ListOrdered,
  MonitorCog,
  Pencil,
  Plus,
  Radar,
  Trash2,
  Waves,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ComplexSwitcher, GreenhouseSwitcher } from "@/components/layout/bits";
import { SectionCard } from "@/components/ui/cards";
import { Badge, Button, IconButton, StatusBadge, Toggle } from "@/components/ui/primitives";
import { Timeline, type TimelineEvent } from "@/components/ui/Timeline";
import { ConfirmDialog } from "@/components/ui/overlay";
import { AddFertigationDrawer } from "@/components/schedule/AddFertigationDrawer";
import { AddWellPumpDrawer } from "@/components/schedule/AddWellPumpDrawer";
import { AddFanScheduleDrawer } from "@/components/schedule/AddFanScheduleDrawer";
import { useToast } from "@/components/ui/toast";
import { complexService, greenhouseService, scheduleService } from "@/lib/services";
import { MOCK_NOW } from "@/lib/format";
import type { FanSchedule, FertigationSchedule, ScheduleStatus, WellPumpSchedule } from "@/lib/types";

export default function SchedulePage() {
  return (
    <Suspense fallback={null}>
      <ScheduleContent />
    </Suspense>
  );
}

function ScheduleContent() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const ghId = params.get("gh") ?? ghs[0]?.id ?? "";
  const gh = greenhouseService.get(ghId) ?? ghs[0];

  const [fertOpen, setFertOpen] = useState(false);
  const [pumpOpen, setPumpOpen] = useState(false);
  const [fanOpen, setFanOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "fert" | "pump" | "fan"; id: string; name: string } | null>(null);

  const fertSchedules = scheduleService.fertigationForGh(gh.id);
  const wellPumps = scheduleService.wellPumpForComplex(complex.id);
  const fanSchedules = scheduleService.fanForGh(gh.id);

  // Queue = pending mixing entries for this complex
  const queue = scheduleService.fertigationForGh(gh.id).filter((s) => s.status === "scheduled");

  const toTimelineStatus = (st: ScheduleStatus): TimelineEvent["status"] => {
    if (st === "completed") return "completed";
    if (st === "running") return "running";
    if (st === "missed") return "missed";
    return "scheduled";
  };

  const timelineEvents: TimelineEvent[] = [
    ...fertSchedules
      .filter((s) => s.enabled)
      .map((s): TimelineEvent => ({ time: s.time, title: "Fertigation", sub: `${s.targetWaterL} L`, status: toTimelineStatus(s.status) })),
    ...fanSchedules
      .filter((s) => s.enabled)
      .map((s): TimelineEvent => ({ time: s.time, title: "Fan", sub: `${s.durationMin} min`, status: toTimelineStatus(s.status) })),
    ...wellPumps
      .filter((s) => s.enabled)
      .map((s): TimelineEvent => ({ time: s.time, title: "Well Pump", sub: `${s.durationMin} min`, status: toTimelineStatus(s.status) })),
  ]
    .filter((e) => e.time && e.time !== "--:--")
    .sort((a, b) => a.time.localeCompare(b.time));

  const setGh = (id: string) => router.replace(`/schedule?complex=${complex.id}&gh=${id}`, { scroll: false });

  const handleCreateFert = (input: Omit<FertigationSchedule, "id">) => {
    scheduleService.createFertigation(input);
    toast(`Fertigation schedule "${input.name}" created`, "success");
  };
  const handleCreatePump = (input: Omit<WellPumpSchedule, "id">) => {
    scheduleService.createWellPump(input);
    toast(`Well pump schedule "${input.task}" created`, "success");
  };
  const handleCreateFan = (input: Omit<FanSchedule, "id">) => {
    scheduleService.createFan(input);
    toast("Fan schedule created", "success");
  };

  const radarState: "filling" | "full" = wellPumps[0]?.radar ?? "filling";

  return (
    <AppShell complexId={complex.id}>
      {/* Context switchers */}
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <ComplexSwitcher complexId={complex.id} complexes={complexes} />
        <GreenhouseSwitcher complexId={complex.id} greenhouses={ghs} ghId={gh.id} onChange={setGh} />
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-xs text-slate-400">{MOCK_NOW.label} • {MOCK_NOW.time}</span>
        </div>
      </div>

      {/* Page title */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Schedule &amp; Timer</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {complex.code} • {gh.code} — operational schedules for this greenhouse
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Fertigation Schedules", value: fertSchedules.filter((s) => s.enabled).length, total: fertSchedules.length, icon: Droplets, tone: "bg-blue-50 text-blue-600" },
          { label: "Well Pump Schedules", value: wellPumps.filter((s) => s.enabled).length, total: wellPumps.length, icon: Waves, tone: "bg-sky-50 text-sky-600" },
          { label: "Fan Schedules", value: fanSchedules.filter((s) => s.enabled).length, total: fanSchedules.length, icon: Fan, tone: "bg-emerald-50 text-emerald-600" },
          { label: "Queue (pending today)", value: queue.length, total: queue.length, icon: ListOrdered, tone: "bg-violet-50 text-violet-600" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-[--color-line] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
            <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.tone}`}>
              <s.icon className="h-5 w-5" />
            </span>
            <div>
              <div className="text-2xl font-bold leading-tight text-slate-900">{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Today's timeline */}
      <div className="mb-5">
        <SectionCard title="Today's Schedule Timeline" icon={Clock} iconTone="blue" subtitle={`${gh.code} • ${MOCK_NOW.label}`}>
          <Timeline events={timelineEvents} nowPct={MOCK_NOW.dayPct} />
        </SectionCard>
      </div>

      {/* Fertigation schedules (GH-level) */}
      <div className="mb-5">
        <SectionCard
          title={`Fertigation Schedule — ${gh.code}`}
          icon={Droplets}
          iconTone="blue"
          subtitle="Greenhouse-level schedules"
          action={
            <Button size="sm" onClick={() => setFertOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Fertigation Schedule
            </Button>
          }
        >
          <ScheduleTable
            rows={fertSchedules.map((s) => ({
              id: s.id,
              name: s.name,
              time: s.time,
              repeat: s.repeat,
              detail: `${s.targetWaterL} L • A ${s.dosingAml}ml / B ${s.dosingBml}ml`,
              lastRun: s.lastRun,
              nextRun: s.nextRun,
              enabled: s.enabled,
              status: s.status,
            }))}
            onToggle={(id, v) => {
              scheduleService.updateFertigation(id, { enabled: v, status: v ? "scheduled" : "disabled" });
              toast(v ? "Schedule enabled" : "Schedule disabled", v ? "success" : "info");
              router.refresh();
            }}
            onEdit={(id) => toast("Edit schedule — full editor ships with the backend phase", "info")}
            onDelete={(id, name) => setDeleteTarget({ kind: "fert", id, name })}
          />
        </SectionCard>
      </div>

      {/* Well pump (Complex-level) + radar */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SectionCard
            title={`Well Pump Schedule — ${complex.code}`}
            icon={Waves}
            iconTone="sky"
            subtitle="Complex-level: fills the shared raw water tank"
            action={
              <Button size="sm" variant="outline" onClick={() => setPumpOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Well Pump Schedule
              </Button>
            }
          >
            <ScheduleTable
              rows={wellPumps.map((s) => ({
                id: s.id,
                name: s.task,
                time: s.time,
                repeat: s.repeat,
                detail: `${s.durationMin} min run`,
                lastRun: s.lastRun,
                nextRun: s.nextRun,
                enabled: s.enabled,
                status: s.status,
              }))}
              accent="sky"
              onToggle={(id, v) => {
                scheduleService.updateWellPump(id, { enabled: v, status: v ? "scheduled" : "disabled" });
                toast(v ? "Well pump schedule enabled" : "Well pump schedule disabled", v ? "success" : "info");
                router.refresh();
              }}
              onEdit={(id) => toast("Edit schedule — full editor ships with the backend phase", "info")}
              onDelete={(id, name) => setDeleteTarget({ kind: "pump", id, name })}
            />
          </SectionCard>
        </div>

        <SectionCard title="Well Pump" icon={Radar} iconTone="slate" subtitle="AUTO MODE">
          <div className="space-y-3">
            <div className={`rounded-xl border p-4 ${radarState === "filling" ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50"}`}>
              <div className="text-xs font-medium text-slate-500">Radar Tank Status</div>
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <span className={`h-2.5 w-2.5 rounded-full ${radarState === "filling" ? "bg-emerald-500 pulse-dot" : "bg-emerald-500/40"}`} />
                    Dalam Pengisian
                  </span>
                  {radarState === "filling" && <Badge tone="green">Pump allowed</Badge>}
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                    <span className={`h-2.5 w-2.5 rounded-full ${radarState === "full" ? "bg-slate-500" : "bg-slate-300"}`} />
                    Penuh
                  </span>
                  {radarState === "full" && <Badge tone="gray">Pump OFF</Badge>}
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-blue-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-blue-700">
              The radar is a binary state — not a percentage. The schedule always remains scheduled; the radar only
              decides whether the physical pump is permitted to run.
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Fan schedules (GH-level) */}
      <div className="mb-5">
        <SectionCard
          title={`Fan Schedule — ${gh.code}`}
          icon={Fan}
          iconTone="green"
          subtitle="Greenhouse-level schedules"
          action={
            <Button size="sm" variant="outline" onClick={() => setFanOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Fan Schedule
            </Button>
          }
        >
          <ScheduleTable
            rows={fanSchedules.map((s) => ({
              id: s.id,
              name: s.mode === "time" ? `Fan — ${s.time}` : "Fan — Temperature",
              time: s.mode === "time" ? s.time : "Auto",
              repeat: s.mode === "time" ? s.repeat : `ON > ${s.onAboveC}°C / OFF < ${s.offBelowC}°C`,
              detail: s.mode === "time" ? `${s.durationMin} min run` : "Hysteresis control",
              lastRun: s.lastRun,
              nextRun: s.nextRun,
              enabled: s.enabled,
              status: s.status,
            }))}
            accent="green"
            onToggle={(id, v) => {
              scheduleService.updateFan(id, { enabled: v, status: v ? "scheduled" : "disabled" });
              toast(v ? "Fan schedule enabled" : "Fan schedule disabled", v ? "success" : "info");
              router.refresh();
            }}
            onEdit={(id) => toast("Edit schedule — full editor ships with the backend phase", "info")}
            onDelete={(id, name) => setDeleteTarget({ kind: "fan", id, name })}
          />
        </SectionCard>
      </div>

      {/* Queue + ESP32 config */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Queue" icon={ListOrdered} iconTone="violet" subtitle="Pending executions for today">
          {queue.length === 0 ? (
            <p className="text-sm text-slate-400">No pending executions.</p>
          ) : (
            <div className="space-y-2.5">
              {queue.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
                    <ListOrdered className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-800">{s.name} • {gh.code}</div>
                    <div className="text-xs text-slate-500">{s.nextRun} • {s.targetWaterL} L</div>
                  </div>
                  <StatusBadge status="scheduled" />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="ESP32 Configuration"
          icon={MonitorCog}
          iconTone="slate"
          action={
            <Button size="sm" variant="secondary" onClick={() => toast("Configuration synced to ESP32", "success")}>
              Sync Now
            </Button>
          }
        >
          <div className="space-y-2.5 text-[13px]">
            {[
              ["Device", `ESP32-S3 • ${complex.code}`],
              ["Status", complex.esp32.online ? "ONLINE" : "OFFLINE"],
              ["Last Sync", complex.esp32.lastSync],
              ["Configuration Version", `v${complex.esp32.configVersion}`],
              ["ESP32 Config Version", `v${complex.esp32.esp32ConfigVersion}`],
              ["Synchronization", complex.esp32.synchronized ? "SYNCHRONIZED" : "PENDING"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
                <span className="text-slate-500">{k}</span>
                <span className="font-semibold text-slate-800">{v}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Drawers */}
      <AddFertigationDrawer
        open={fertOpen}
        onClose={() => setFertOpen(false)}
        ghId={gh.id}
        ghCode={gh.code}
        recipes={gh.recipes}
        onCreate={handleCreateFert}
      />
      <AddWellPumpDrawer
        open={pumpOpen}
        onClose={() => setPumpOpen(false)}
        complexId={complex.id}
        complexCode={complex.code}
        onCreate={handleCreatePump}
      />
      <AddFanScheduleDrawer
        open={fanOpen}
        onClose={() => setFanOpen(false)}
        ghId={gh.id}
        ghCode={gh.code}
        onCreate={handleCreateFan}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.kind === "fert") scheduleService.deleteFertigation(deleteTarget.id);
          if (deleteTarget.kind === "pump") scheduleService.deleteWellPump(deleteTarget.id);
          if (deleteTarget.kind === "fan") scheduleService.deleteFan(deleteTarget.id);
          toast(`Schedule "${deleteTarget.name}" deleted`, "info");
          router.refresh();
        }}
        title="Delete schedule"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </AppShell>
  );
}

/* ------------------------- schedule table ------------------------- */

interface Row {
  id: string;
  name: string;
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
  onToggle,
  onEdit,
  onDelete,
}: {
  rows: Row[];
  accent?: "blue" | "sky" | "green";
  onToggle: (id: string, v: boolean) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <th className="pb-2.5 font-medium">Task</th>
            <th className="pb-2.5 font-medium">Time</th>
            <th className="pb-2.5 font-medium">Repeat</th>
            <th className="pb-2.5 font-medium">Last Run</th>
            <th className="pb-2.5 font-medium">Next Run</th>
            <th className="pb-2.5 font-medium">Status</th>
            <th className="pb-2.5 font-medium">Enabled</th>
            <th className="pb-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-b border-slate-50 last:border-0 ${r.enabled ? "" : "opacity-55"}`}>
              <td className="py-3 pr-3">
                <div className="font-semibold text-slate-800">{r.name}</div>
                <div className="text-xs text-slate-500">{r.detail}</div>
              </td>
              <td className="py-3 pr-3">
                <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold ${
                  accent === "sky" ? "bg-sky-50 text-sky-700" : accent === "green" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
                }`}>
                  <Clock className="h-3 w-3" /> {r.time}
                </span>
              </td>
              <td className="py-3 pr-3 text-slate-600">{r.repeat}</td>
              <td className="py-3 pr-3 text-slate-500">{r.lastRun ?? "–"}</td>
              <td className="py-3 pr-3 text-slate-600">{r.nextRun ?? "–"}</td>
              <td className="py-3 pr-3"><StatusBadge status={r.status} /></td>
              <td className="py-3 pr-3">
                <Toggle checked={r.enabled} onChange={(v) => onToggle(r.id, v)} />
              </td>
              <td className="py-3">
                <div className="flex justify-end gap-0.5">
                  <IconButton aria-label="Edit" title="Edit" onClick={() => onEdit(r.id)}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton aria-label="Delete" title="Delete" onClick={() => onDelete(r.id, r.name)}>
                    <Trash2 className="h-4 w-4 text-red-400 hover:text-red-500" />
                  </IconButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
