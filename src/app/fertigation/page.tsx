"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Beaker,
  Droplets,
  Gauge,
  History,
  ListOrdered,
  PlayCircle,
  Settings2,
  ShieldAlert,
  Timer,
  Waves,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ComplexSwitcher, GreenhouseSwitcher } from "@/components/layout/bits";
import { SectionCard } from "@/components/ui/cards";
import { Badge, Button, Input, Label, Progress, RadioCard, Select, StatusBadge } from "@/components/ui/primitives";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { complexService, fertigationService, greenhouseService } from "@/lib/services";
import { n } from "@/lib/format";

const STEP_ICONS = { done: "✓", active: "●", pending: "○" } as const;

export default function FertigationPage() {
  return (
    <Suspense fallback={null}>
      <FertigationContent />
    </Suspense>
  );
}

function FertigationContent() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const ghId = params.get("gh") ?? ghs.find((g) => g.currentRun)?.id ?? ghs[0]?.id ?? "";
  const gh = greenhouseService.get(ghId) ?? ghs[0];

  const [manualOpen, setManualOpen] = useState(false);
  const [estopOpen, setEstopOpen] = useState(false);
  const [manualRecipe, setManualRecipe] = useState(gh.recipes[0]?.id ?? "");
  const [manualWater, setManualWater] = useState(String(gh.recipes[0]?.waterL ?? 80));

  const setGh = (id: string) => router.replace(`/fertigation?complex=${complex.id}&gh=${id}`, { scroll: false });

  const queue = fertigationService.mixingQueue();
  const pumps = fertigationService.dosingPumps();
  const history = fertigationService.history();
  const sys = fertigationService.systemStatus();
  const run = gh.currentRun;

  const currentOps = ghs.filter((g) => g.currentRun);

  return (
    <AppShell complexId={complex.id}>
      {/* Context */}
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <ComplexSwitcher complexId={complex.id} complexes={complexes} />
        <GreenhouseSwitcher complexId={complex.id} greenhouses={ghs} ghId={gh.id} onChange={setGh} />
        <div className="ml-auto flex items-center gap-2.5">
          <Button variant="secondary" onClick={() => toast("Configuration synced to ESP32", "success")}>
            <Settings2 className="h-4 w-4" /> Sync Configuration
          </Button>
          <Button variant="danger" onClick={() => setEstopOpen(true)}>
            <ShieldAlert className="h-4 w-4" /> Emergency Stop
          </Button>
        </div>
      </div>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Fertigation Control Center</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          {complex.code} — mixing, dosing and distribution monitoring
        </p>
      </div>

      {/* ---------------- Current operations ---------------- */}
      <div className="mb-5">
        <SectionCard
          title="Current Operations"
          icon={Activity}
          iconTone="blue"
          subtitle="Live fertigation runs across the complex"
          action={<Badge tone="blue" pulse>{currentOps.length} running</Badge>}
        >
          {currentOps.length === 0 ? (
            <p className="text-sm text-slate-400">No fertigation is currently running in this complex.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {currentOps.map((g) => {
                const r = g.currentRun!;
                const isActive = g.id === gh.id;
                return (
                  <div
                    key={g.id}
                    className={`rounded-xl border p-4 transition ${isActive ? "border-blue-300 bg-blue-50/40 shadow-sm" : "border-[--color-line] bg-white"}`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                          <Droplets className="h-4.5 w-4.5" />
                        </span>
                        <div>
                          <div className="text-sm font-bold text-slate-900">{g.code} — {r.recipeName}</div>
                          <div className="text-xs text-slate-500">Started {r.startedAt} • ETA {r.estimatedFinish}</div>
                        </div>
                      </div>
                      <StatusBadge status={g.fertigationState} />
                    </div>

                    {/* step tracker */}
                    <div className="mb-3.5 flex items-center">
                      {r.steps.map((s, i) => (
                        <div key={s.name} className="flex flex-1 items-center last:flex-none">
                          <div className="flex flex-col items-center">
                            <span
                              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                                s.status === "done"
                                  ? "bg-emerald-500 text-white"
                                  : s.status === "active"
                                    ? "bg-blue-600 text-white pulse-dot"
                                    : "border border-slate-200 bg-white text-slate-400"
                              }`}
                            >
                              {STEP_ICONS[s.status]}
                            </span>
                            <span className={`mt-1 w-16 text-center text-[10px] leading-tight ${s.status === "pending" ? "text-slate-400" : "text-slate-600"}`}>
                              {s.name}
                            </span>
                          </div>
                          {i < r.steps.length - 1 && (
                            <div className={`mx-1 h-0.5 flex-1 rounded ${i < r.steps.findIndex((x) => x.status === "active") ? "bg-emerald-400" : "bg-slate-200"}`} />
                          )}
                        </div>
                      ))}
                    </div>

                    <Progress value={r.progressPct} className="h-2" />
                    <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                      <span>{r.elapsedLabel} elapsed</span>
                      <span className="font-semibold text-slate-700">{r.progressPct}%</span>
                    </div>

                    <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                      {[
                        { label: "Water", value: `${r.waterDoneL} / ${r.targetWaterL} L` },
                        { label: "Dosing A", value: `${r.dosingADoneMl} / ${r.dosingAml} ml` },
                        { label: "Dosing B", value: `${r.dosingBDoneMl} / ${r.dosingBml} ml` },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg bg-white px-2.5 py-2 text-center shadow-sm">
                          <div className="text-[10px] text-slate-400">{s.label}</div>
                          <div className="text-xs font-bold text-slate-800">{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ---------------- Mixing queue + dosing pumps ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Mixing Queue" icon={ListOrdered} iconTone="violet" subtitle="Scheduled mixing batches">
          <div className="space-y-2.5">
            {queue.map((q, i) => {
              const qGh = greenhouseService.get(q.ghId);
              return (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
                    <Beaker className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-800">{qGh?.code} — {q.recipeName}</div>
                    <div className="text-xs text-slate-500">Scheduled {q.scheduledTime} • Target {q.targetWaterL} L</div>
                  </div>
                  <StatusBadge status="pending" />
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Dosing Pump Status"
          icon={Gauge}
          iconTone="green"
          subtitle={`Last calibration: ${fertigationService.dosingLastCalibration()}`}
        >
          <div className="grid grid-cols-2 gap-3">
            {pumps.map((p) => (
              <div key={p.id} className="rounded-xl border border-[--color-line] bg-slate-50/60 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">{p.name}</span>
                  <StatusBadge status={p.state === "Ready" ? "ready" : "off"} />
                </div>
                <div className="mt-1.5 text-xs text-slate-500">Flow rate: {p.rate}</div>
                <div className="mt-2.5 flex gap-1">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => toast(`${p.name} test run (100 ml)`, "info")}>
                    Test Run
                  </Button>
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => toast(`${p.name} calibration opened`, "info")}>
                    Calibrate
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ---------------- Manual fertigation + system status ---------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard
          title="Manual Fertigation"
          icon={PlayCircle}
          iconTone="amber"
          subtitle="Start a run outside the schedule"
          className="xl:col-span-2"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
              <div className="text-sm font-bold text-slate-800">Quick Start</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Run the active recipe for {gh.code} immediately. Use with care — this executes a physical fertigation.
              </p>
              <Button className="mt-3" onClick={() => setManualOpen(true)}>
                <PlayCircle className="h-4 w-4" /> Start Manual Fertigation
              </Button>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50/50 p-4">
              <div className="text-sm font-bold text-slate-800">Emergency Controls</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Immediately stop all pumps, close valves and put the system into a safe state.
              </p>
              <Button variant="danger" className="mt-3" onClick={() => setEstopOpen(true)}>
                <Zap className="h-4 w-4" /> Emergency Stop All
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="System Status" icon={Waves} iconTone="slate">
          <div className="space-y-2.5 text-[13px]">
            {[
              ["Mixing Tank Level", `${sys.mixingTankLevel}%`],
              ["Water Inlet Valve", sys.waterInlet],
              ["Distribution Line", sys.distributionLine],
              ["System Mode", sys.systemMode],
              ["Last Update", sys.lastUpdate],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
                <span className="text-slate-500">{k}</span>
                <span className="font-semibold text-slate-800">{v}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3.5 py-2.5">
              <span className="text-slate-500">ESP32</span>
              <StatusBadge status={complex.esp32.online ? "online" : "offline"} />
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ---------------- History ---------------- */}
      <SectionCard title="Fertigation History" icon={History} iconTone="slate" subtitle="Recent runs in this complex">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="pb-2.5 font-medium">GH</th>
                <th className="pb-2.5 font-medium">Date & Time</th>
                <th className="pb-2.5 font-medium">Recipe</th>
                <th className="pb-2.5 font-medium">Water</th>
                <th className="pb-2.5 font-medium">Dosing A</th>
                <th className="pb-2.5 font-medium">Dosing B</th>
                <th className="pb-2.5 font-medium">Duration</th>
                <th className="pb-2.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-3 pr-3 font-semibold text-slate-800">{greenhouseService.get(h.ghId)?.code ?? "–"}</td>
                  <td className="py-3 pr-3 text-slate-600">{h.date} {h.time}</td>
                  <td className="py-3 pr-3 text-slate-600">{h.recipeName}</td>
                  <td className="py-3 pr-3 text-slate-600">{n(h.waterL)} L</td>
                  <td className="py-3 pr-3 text-slate-600">{n(h.dosingAml)} ml</td>
                  <td className="py-3 pr-3 text-slate-600">{n(h.dosingBml)} ml</td>
                  <td className="py-3 pr-3 text-slate-600">{h.durationMin ? `${h.durationMin} min` : "–"}</td>
                  <td className="py-3"><StatusBadge status={h.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* ---------------- Manual modal ---------------- */}
      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title={`Manual Fertigation — ${gh.code}`}
        width={520}
        footer={
          <>
            <Button variant="secondary" onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                fertigationService.startManual(gh.id, manualRecipe, Number(manualWater) || 80);
                setManualOpen(false);
                toast("Manual fertigation started", "success");
              }}
            >
              Start Fertigation
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div>
            <Label required>Recipe</Label>
            <Select
              value={manualRecipe}
              onChange={(e) => {
                setManualRecipe(e.target.value);
                const r = gh.recipes.find((x) => x.id === e.target.value);
                if (r) setManualWater(String(r.waterL));
              }}
              options={gh.recipes.map((r) => ({ value: r.id, label: r.name }))}
            />
          </div>
          <div>
            <Label required>Target Water</Label>
            <Input type="number" min={1} value={manualWater} onChange={(e) => setManualWater(e.target.value)} unit="L" />
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-700">
            This command is executed by the ESP32 after local safety validation.
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={estopOpen}
        onClose={() => setEstopOpen(false)}
        onConfirm={() => {
          fertigationService.emergencyStop();
          toast("EMERGENCY STOP sent — all actuators off", "error");
        }}
        title="Emergency Stop"
        message="Stop all pumps and close all valves immediately? The system will stay in a safe state until manually resumed."
        confirmLabel="Stop Everything"
        danger
      />
    </AppShell>
  );
}
