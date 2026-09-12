"use client";

import { Suspense, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { ComplexSwitcher } from "@/components/layout/bits";
import { SectionCard } from "@/components/ui/cards";
import { Badge, Button, FieldError, Input, Label, Progress, Select, StatusBadge } from "@/components/ui/primitives";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { complexService, fertigationService, greenhouseService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { errorMessage } from "@/lib/errors";
import { number } from "@/lib/validation";
import { n } from "@/lib/format";
import { complexRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";

const STEP_ICONS = { done: "✓", active: "●", pending: "○" } as const;

export default function FertigationPage() {
  return (
    <Suspense fallback={null}>
      <FertigationContent />
    </Suspense>
  );
}

function FertigationContent() {
  useDbVersion(); // live updates while a mock run advances through its lifecycle
  const [params] = useSearchParams();
  const router = useNavigate();
  const toast = useToast();

  const complexes = complexService.list();
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const gh = ghs.find((g) => g.currentRun) ?? ghs[0];
  const realtimeState = complexRealtimeState(complex, ghs);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualGhId, setManualGhId] = useState(gh.id);
  const [estopOpen, setEstopOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [manualRecipe, setManualRecipe] = useState(gh.recipes[0]?.id ?? "");
  const [manualWater, setManualWater] = useState(String(gh.recipes[0]?.waterL ?? 80));
  const [manualError, setManualError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testingPump, setTestingPump] = useState<string | null>(null);
  const manualGh = greenhouseService.get(manualGhId) ?? gh;

  const queue = fertigationService.mixingQueue();
  const pumps = fertigationService.dosingPumps();
  const history = fertigationService.history();
  const sys = fertigationService.systemStatus();
  const run = gh.currentRun;

  const currentOps = ghs.filter((g) => g.currentRun);
  const complexHistory = history.filter((h) => ghs.some((g) => g.id === h.ghId));

  /* ---------------------------- actions ---------------------------- */

  const handleStartManual = async () => {
    setManualError(null);
    if (number(manualWater, { label: "Target water", positive: true })) {
      setManualError("Target water must be greater than zero.");
      return;
    }
    setStarting(true);
    try {
      await fertigationService.startManual(manualGh.id, manualRecipe, Number(manualWater));
      setManualOpen(false);
      toast("Manual fertigation started — command accepted by ESP32", "success");
    } catch (e) {
      setManualError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const handleEmergencyStop = async () => {
    setStopping(true);
    try {
      await fertigationService.emergencyStop(complex.id);
      toast("EMERGENCY STOP executed — all actuators off until manually resumed", "warning");
      setEstopOpen(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setStopping(false);
    }
  };

  const handleResume = async () => {
    setResuming(true);
    try {
      await fertigationService.resume(complex.id);
      toast("System resumed — actuators and schedules can run again", "success");
      setResumeOpen(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setResuming(false);
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

  const handleTestPump = async (pumpId: string, pumpName: string) => {
    setTestingPump(pumpId);
    try {
      await fertigationService.testPump(pumpId, pumpName);
      toast(`${pumpName} test run (100 ml) completed`, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setTestingPump(null);
    }
  };

  return (
    <AppShell complexId={complex.id}>
      <div className="fertigation-dark-scope min-w-0 w-full max-w-full overflow-x-hidden">
        <style>{`
          .fertigation-dark-scope {
            --fert-bg: #06141b;
            --fert-panel: #0a1c23;
            --fert-panel-2: #0d242c;
            --fert-panel-3: #102b34;
            --fert-input: #081a21;
            --fert-line: rgba(255,255,255,.085);
            --fert-line-strong: rgba(255,255,255,.13);
            --fert-text: #f3f8f7;
            --fert-text-2: #c8d6d5;
            --fert-muted: #81979c;
            color: var(--fert-text);
          }

          /* =========================================================
             GLOBAL DARK SURFACE OVERRIDES
             SectionCard / Button / Badge primitives carry their own
             light-theme Tailwind classes, so the page scope must win.
             ========================================================= */

          .fertigation-dark-scope .bg-white,
          .fertigation-dark-scope .bg-white\/50,
          .fertigation-dark-scope .bg-white\/60,
          .fertigation-dark-scope .bg-white\/70,
          .fertigation-dark-scope .bg-white\/80,
          .fertigation-dark-scope .bg-white\/90,
          .fertigation-dark-scope .bg-white\/95 {
            background-color: var(--fert-panel) !important;
          }

          .fertigation-dark-scope [class*="bg-slate-50"],
          .fertigation-dark-scope [class*="bg-slate-100"],
          .fertigation-dark-scope [class*="bg-gray-50"],
          .fertigation-dark-scope [class*="bg-gray-100"] {
            background-color: rgba(255,255,255,.025) !important;
          }

          .fertigation-dark-scope [class*="border-slate-"],
          .fertigation-dark-scope [class*="border-gray-"] {
            border-color: var(--fert-line) !important;
          }

          /* SectionCard itself */
          .fertigation-dark-scope section,
          .fertigation-dark-scope article {
            background-color: var(--fert-panel) !important;
            border-color: var(--fert-line) !important;
            color: var(--fert-text);
            box-shadow:
              0 14px 34px rgba(0,0,0,.18),
              inset 0 1px 0 rgba(255,255,255,.018);
          }

          /* Nested cards / rows */
          .fertigation-dark-scope .rounded-xl.bg-white,
          .fertigation-dark-scope .rounded-xl[class*="bg-slate-"],
          .fertigation-dark-scope .rounded-lg.bg-white,
          .fertigation-dark-scope .rounded-lg[class*="bg-slate-"] {
            background-color: var(--fert-panel-2) !important;
          }

          /* Typography — remove light-theme slate text */
          .fertigation-dark-scope .text-slate-950,
          .fertigation-dark-scope .text-slate-900,
          .fertigation-dark-scope .text-slate-800,
          .fertigation-dark-scope .text-slate-700 {
            color: var(--fert-text) !important;
          }

          .fertigation-dark-scope .text-slate-600 {
            color: #aebfbe !important;
          }

          .fertigation-dark-scope .text-slate-500 {
            color: var(--fert-muted) !important;
          }

          .fertigation-dark-scope .text-slate-400 {
            color: #70878c !important;
          }

          .fertigation-dark-scope .text-slate-300 {
            color: var(--fert-text-2) !important;
          }

          /* Headings */
          .fertigation-dark-scope h1,
          .fertigation-dark-scope h2,
          .fertigation-dark-scope h3,
          .fertigation-dark-scope h4 {
            color: var(--fert-text) !important;
            letter-spacing: -0.018em;
          }

          .fertigation-dark-scope h1 { font-weight: 800; }
          .fertigation-dark-scope h2,
          .fertigation-dark-scope h3 { font-weight: 700; }

          .fertigation-dark-scope p {
            color: var(--fert-muted);
          }

          /* Borders / dividers */
          .fertigation-dark-scope .border-white,
          .fertigation-dark-scope .border-white\/10,
          .fertigation-dark-scope .border-white\/20 {
            border-color: var(--fert-line) !important;
          }

          .fertigation-dark-scope .divide-slate-200 > :not([hidden]) ~ :not([hidden]) {
            border-color: var(--fert-line) !important;
          }

          /* Inputs */
          .fertigation-dark-scope input,
          .fertigation-dark-scope select,
          .fertigation-dark-scope textarea {
            background: var(--fert-input) !important;
            color: var(--fert-text-2) !important;
            border-color: var(--fert-line-strong) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,.02) !important;
          }

          .fertigation-dark-scope input:focus,
          .fertigation-dark-scope select:focus,
          .fertigation-dark-scope textarea:focus {
            border-color: rgba(45,212,191,.48) !important;
            box-shadow: 0 0 0 3px rgba(45,212,191,.08) !important;
            outline: none !important;
          }

          .fertigation-dark-scope input::placeholder,
          .fertigation-dark-scope textarea::placeholder {
            color: #60777d !important;
          }

          .fertigation-dark-scope option {
            background: var(--fert-input);
            color: var(--fert-text);
          }

          /* Buttons: secondary/outline must be dark, primary/danger stay accented */
          .fertigation-dark-scope button.bg-white,
          .fertigation-dark-scope button[class*="bg-white"],
          .fertigation-dark-scope a.bg-white {
            background-color: var(--fert-panel-2) !important;
            color: var(--fert-text-2) !important;
            border-color: var(--fert-line-strong) !important;
          }

          .fertigation-dark-scope button:hover.bg-white,
          .fertigation-dark-scope button:hover[class*="bg-white"] {
            background-color: var(--fert-panel-3) !important;
          }

          /* Prevent light shadows from making surfaces look white */
          .fertigation-dark-scope .shadow-sm,
          .fertigation-dark-scope .shadow-md,
          .fertigation-dark-scope .shadow-lg {
            box-shadow: 0 10px 26px rgba(0,0,0,.20) !important;
          }

          /* Tables */
          .fertigation-dark-scope table {
            color: var(--fert-text-2);
          }

          .fertigation-dark-scope table tbody tr {
            transition: background-color .16s ease;
          }

          .fertigation-dark-scope table tbody tr:hover {
            background: rgba(255,255,255,.025);
          }

          /* Muted empty-state surfaces */
          .fertigation-dark-scope .border-dashed {
            background-color: rgba(255,255,255,.018) !important;
            border-color: rgba(255,255,255,.10) !important;
          }

          /* Preserve intentional status/accent backgrounds */
          .fertigation-dark-scope .bg-red-500,
          .fertigation-dark-scope .bg-red-600,
          .fertigation-dark-scope .bg-emerald-500,
          .fertigation-dark-scope .bg-emerald-600,
          .fertigation-dark-scope .bg-blue-500,
          .fertigation-dark-scope .bg-blue-600 {
            color: white;
          }
        `}</style>

      {/* Context */}
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <ComplexSwitcher complexId={complex.id} complexes={complexes} />
        <div className="ml-auto flex items-center gap-2.5">
          <Button variant="secondary" onClick={handleSync} disabled={syncing}>
            <Settings2 className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Synchronizing…" : "Sync Configuration"}
          </Button>
          {complex.emergencyStopped ? (
            <>
              <span className="flex h-9 animate-pulse items-center rounded-lg bg-red-100 px-2.5 text-[11px] font-bold text-red-300">
                E-STOP AKTIF
              </span>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setResumeOpen(true)}>
                <PlayCircle className="h-4 w-4" /> Resume System
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setEstopOpen(true)}>
              <ShieldAlert className="h-4 w-4" /> Emergency Stop
            </Button>
          )}
        </div>
      </div>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-100">Fertigation Control Center</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">
          {complex.code} — mixing, dosing and distribution monitoring
        </p>
        <div className="mt-2"><LiveStatus state={realtimeState} label={`${complex.code} fertigation data`} /></div>
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
            <div className="rounded-xl border border-dashed border-white/10 bg-[#0b2027]/[0.025] px-4 py-6 text-center">
              <p className="text-sm text-slate-500">No fertigation is currently running in this complex.</p>
              <Button size="sm" variant="outline" className="mt-2.5" onClick={() => setManualOpen(true)}>
                <PlayCircle className="h-3.5 w-3.5" /> Start Manual Fertigation
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {currentOps.map((g) => {
                const r = g.currentRun!;
                const isActive = g.id === gh.id;
                return (
                  <div
                    key={g.id}
                    className={`rounded-xl border p-4 transition ${isActive ? "border-blue-400/35 bg-blue-500/[0.08] shadow-sm" : "border-[--color-line] bg-[#0b2027]"}`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/[0.12] text-blue-300">
                          <Droplets className="h-4.5 w-4.5" />
                        </span>
                        <div>
                          <div className="text-sm font-bold text-slate-100">{g.code} — {r.recipeName}</div>
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
                                    : "border border-white/10 bg-[#0b2027] text-slate-500"
                              }`}
                            >
                              {STEP_ICONS[s.status]}
                            </span>
                            <span className={`mt-1 w-16 text-center text-[10px] leading-tight ${s.status === "pending" ? "text-slate-500" : "text-slate-300"}`}>
                              {s.name}
                            </span>
                          </div>
                          {i < r.steps.length - 1 && (
                            <div className={`mx-1 h-0.5 flex-1 rounded ${i < r.steps.findIndex((x) => x.status === "active") ? "bg-emerald-400" : "bg-white/10"}`} />
                          )}
                        </div>
                      ))}
                    </div>

                    <Progress value={r.progressPct} className="h-2" />
                    <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                      <span>{r.elapsedLabel} elapsed</span>
                      <span className="font-semibold text-slate-300">{r.progressPct}%</span>
                    </div>

                    <div className="mt-3.5 grid grid-cols-3 gap-2.5">
                      {[
                        { label: "Water", value: `${r.waterDoneL} / ${r.targetWaterL} L` },
                        { label: "Dosing A", value: `${r.dosingADoneMl} / ${r.dosingAml} ml` },
                        { label: "Dosing B", value: `${r.dosingBDoneMl} / ${r.dosingBml} ml` },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg bg-[#0b2027] px-2.5 py-2 text-center shadow-sm">
                          <div className="text-[10px] text-slate-500">{s.label}</div>
                          <div className="text-xs font-bold text-slate-200">{s.value}</div>
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
          {queue.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 bg-[#0b2027]/[0.025] px-4 py-6 text-center text-sm text-slate-500">
              No mixing batches are queued.
            </p>
          ) : (
            <div className="space-y-2.5">
              {queue.map((q, i) => {
                const qGh = greenhouseService.get(q.ghId);
                return (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0b2027]/[0.035] px-3.5 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/[0.12] text-violet-300">
                      <Beaker className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-200">{qGh?.code} — {q.recipeName}</div>
                      <div className="text-xs text-slate-500">Scheduled {q.scheduledTime} • Target {q.targetWaterL} L</div>
                    </div>
                    <StatusBadge status="pending" />
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Dosing Pump Status"
          icon={Gauge}
          iconTone="green"
          subtitle={`Last calibration: ${fertigationService.dosingLastCalibration()}`}
        >
          <div className="grid grid-cols-2 gap-3">
            {pumps.map((p) => {
              const testing = testingPump === p.id;
              return (
                <div key={p.id} className="rounded-xl border border-[--color-line] bg-[#0b2027]/[0.035] p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-200">{p.name}</span>
                    <StatusBadge status={testing ? "running" : p.state === "Ready" ? "ready" : "off"} />
                  </div>
                  <div className="mt-1.5 text-xs text-slate-500">Flow rate: {p.rate}</div>
                  <div className="mt-2.5 flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      disabled={testing}
                      onClick={() => handleTestPump(p.id, p.name)}
                    >
                      {testing ? "Running…" : "Test Run"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => router(`/calibration?complex=${complex.id}`)}
                    >
                      Calibrate
                    </Button>
                  </div>
                </div>
              );
            })}
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
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.08] p-4">
              <div className="text-sm font-bold text-slate-200">Quick Start</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Run the active recipe for the selected greenhouse immediately. Use with care — this executes a physical fertigation.
              </p>
              <Label>Target Greenhouse</Label>
              <Select
                value={manualGh.id}
                onChange={(e) => {
                  const nextGh = greenhouseService.get(e.target.value) ?? gh;
                  setManualGhId(nextGh.id);
                  setManualRecipe(nextGh.recipes[0]?.id ?? "");
                  setManualWater(String(nextGh.recipes[0]?.waterL ?? 80));
                }}
                options={ghs.map((greenhouse) => ({ value: greenhouse.id, label: greenhouse.code }))}
              />
              <Button className="mt-3" onClick={() => { setManualError(null); setManualOpen(true); }} disabled={Boolean(manualGh.currentRun)}>
                <PlayCircle className="h-4 w-4" /> Start Manual Fertigation
              </Button>
            </div>
            <div className="rounded-xl border border-red-400/20 bg-red-500/[0.08] p-4">
              <div className="text-sm font-bold text-slate-200">Emergency Controls</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Immediately stop all pumps, close valves and put the system into a safe state.
              </p>
              {complex.emergencyStopped ? (
                <Button className="mt-3 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setResumeOpen(true)}>
                  <PlayCircle className="h-4 w-4" /> Resume System
                </Button>
              ) : (
                <Button variant="danger" className="mt-3" onClick={() => setEstopOpen(true)}>
                  <Zap className="h-4 w-4" /> Emergency Stop All
                </Button>
              )}
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
              <div key={k} className="flex items-center justify-between rounded-lg border border-white/10 px-3.5 py-2.5">
                <span className="text-slate-500">{k}</span>
                <span className="font-semibold text-slate-200">{v}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg border border-white/10 px-3.5 py-2.5">
              <span className="text-slate-500">ESP32</span>
              <StatusBadge status={complex.esp32.online ? "online" : "offline"} />
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ---------------- History ---------------- */}
      <SectionCard title="Fertigation History" icon={History} iconTone="slate" subtitle="Recent runs in this complex">
        {complexHistory.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-[#0b2027]/[0.025] px-4 py-6 text-center text-sm text-slate-500">
            No fertigation runs recorded yet for this complex.
          </p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-slate-500">
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
                {complexHistory.map((h) => (
                  <tr key={h.id} className="border-b border-white/5 last:border-0">
                    <td className="py-3 pr-3 font-semibold text-slate-200">{greenhouseService.get(h.ghId)?.code ?? "–"}</td>
                    <td className="py-3 pr-3 text-slate-300">{h.date} {h.time}</td>
                    <td className="py-3 pr-3 text-slate-300">{h.recipeName}</td>
                    <td className="py-3 pr-3 text-slate-300">{n(h.waterL)} L</td>
                    <td className="py-3 pr-3 text-slate-300">{n(h.dosingAml)} ml</td>
                    <td className="py-3 pr-3 text-slate-300">{n(h.dosingBml)} ml</td>
                    <td className="py-3 pr-3 text-slate-300">{h.durationMin ? `${h.durationMin} min` : "–"}</td>
                    <td className="py-3"><StatusBadge status={h.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ---------------- Manual modal ---------------- */}
      <Modal
        open={manualOpen}
        onClose={() => { if (!starting) setManualOpen(false); }}
        title={`Manual Fertigation — ${manualGh.code}`}
        width={520}
        footer={
          <>
            <Button variant="secondary" onClick={() => setManualOpen(false)} disabled={starting}>Cancel</Button>
            <Button onClick={handleStartManual} disabled={starting}>
              {starting ? "Starting…" : "Start Fertigation"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {manualError && (
            <div className="rounded-lg border border-red-400/25 bg-red-500/[0.10] px-3.5 py-2.5 text-[13px] font-medium text-red-300">
              {manualError}
            </div>
          )}
          <div>
            <Label required>Recipe</Label>
            <Select
              value={manualRecipe}
              onChange={(e) => {
                setManualRecipe(e.target.value);
                const r = manualGh.recipes.find((x) => x.id === e.target.value);
                if (r) setManualWater(String(r.waterL));
              }}
              options={manualGh.recipes.map((r) => ({ value: r.id, label: r.name }))}
            />
          </div>
          <div>
            <Label required>Target Water</Label>
            <Input type="number" min={1} value={manualWater} onChange={(e) => setManualWater(e.target.value)} unit="L" />
            <FieldError>{manualError?.includes("Target water") ? manualError : null}</FieldError>
          </div>
          <div className="rounded-lg bg-amber-500/[0.10] px-3 py-2.5 text-xs leading-relaxed text-amber-300">
            This command is executed by the ESP32 after local safety validation. Progress appears under Current
            Operations once the command is accepted.
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={estopOpen}
        onClose={() => { if (!stopping) setEstopOpen(false); }}
        onConfirm={handleEmergencyStop}
        title="Emergency Stop"
        message={`Stop all pumps and close all valves in ${complex.code} immediately? This affects physical equipment. The system stays in a safe state until you press Resume System.`}
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
      </div>
    </AppShell>
  );
}
