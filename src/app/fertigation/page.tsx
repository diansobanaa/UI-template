"use client";

import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  Beaker,
  Check,
  CheckCircle2,
  Droplets,
  ExternalLink,
  Gauge,
  History,
  Info,
  ListOrdered,
  PlayCircle,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Square,
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
import {
  TodayOccurrencesPanel,
  MixingBatchesPanel,
  DistributionPanel,
  DosingQueuePanelThin,
  FertigationHistoryPanel,
} from "@/components/fertigation/FertigationRuntimePanels";

const STEP_ICONS = { done: "✓", active: "●", pending: "○" } as const;

export default function FertigationPage() {
  return (
    <Suspense fallback={null}>
      <FertigationContent />
    </Suspense>
  );
}

function FertigationContent() {
  useDbVersion(); // re-render when authoritative operational state changes
  const [params] = useSearchParams();
  const router = useNavigate();
  const toast = useToast();

  const complexes = complexService.list();
  const rawComplexId = (params.get("complex") ?? "").trim();
  // F-H1: Jangan silent-fallback ke complexes[0] — bisa leak data ke Complex lain saat Complex aktif dihapus.
  const complex = rawComplexId ? complexes.find((c) => c.id === rawComplexId) : null;
  useEffect(() => {
    if (rawComplexId && !complex) {
      // rawComplexId specified tapi tidak ditemukan — tampilkan toast, jangan silent-swap.
      toast("Complex not found", "error");
    }
  }, [rawComplexId, complex, toast]);
  if (!complex) return null;
  const ghs = greenhouseService.byComplex(complex.id);
  const selectedGhId = params.get("gh") ?? "";
  const selectedGh = selectedGhId ? greenhouseService.get(selectedGhId) : undefined;
  const realtimeState = complexRealtimeState(complex, ghs);
  // ITEM-5: ghCodeMap for runtime panels (ghId → display code)
  const ghCodeMap: Record<string, string> = Object.fromEntries(ghs.map((g) => [g.id, g.code || g.greenhouseTag || g.id]));

  const [manualOpen, setManualOpen] = useState(false);
  const [manualGhId, setManualGhId] = useState(selectedGhId);
  const [estopOpen, setEstopOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [manualRecipe, setManualRecipe] = useState("");
  const [manualWater, setManualWater] = useState("80");
  const [manualError, setManualError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testingPump, setTestingPump] = useState<string | null>(null);
  const manualGh = manualGhId ? greenhouseService.get(manualGhId) : undefined;

  const queue = fertigationService.mixingQueue();
  const [pumps, setPumps] = useState<any[]>(() => fertigationService.dosingPumps());
  const [lastCalibration, setLastCalibration] = useState<string>("—");

  useEffect(() => {
    let active = true;
    fertigationService.getDynamicDosingPumps(complex.id).then((dynPumps) => {
      if (active && dynPumps && dynPumps.length > 0) {
        setPumps(dynPumps);
      }
    });
    fertigationService.dosingLastCalibration(complex.id).then((calStr) => {
      if (active && calStr) {
        setLastCalibration(calStr);
      }
    });
    return () => {
      active = false;
    };
  }, [complex.id]);

  const history = fertigationService.history();
  const sys = fertigationService.systemStatus(complex.id, selectedGhId || undefined);
  const run = selectedGh?.currentRun;

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
      if (!manualGh) { setManualError("Select a greenhouse before starting fertigation."); return; }
      if (!manualRecipe) { setManualError("Select a recipe before starting fertigation."); return; }
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

  /* ---------------------- Test Run Dosing Pump state ---------------------- */
  const [testModalPump, setTestModalPump] = useState<any | null>(null);
  const [testDuration, setTestDuration] = useState<10 | 30 | 60>(10);
  const [testRunning, setTestRunning] = useState(false);
  const [testTimeLeft, setTestTimeLeft] = useState(0);
  const [testElapsedSec, setTestElapsedSec] = useState(0);
  const [testFinished, setTestFinished] = useState<{
    duration: number;
    targetMl: number;
    pumpName: string;
  } | null>(null);

  const getPumpFlowRateMlSec = (pump: any): number => {
    if (pump?.rateMlSec && Number(pump.rateMlSec) > 0) return Number(pump.rateMlSec);
    if (typeof pump?.rate === "string") {
      const match = pump.rate.match(/([\d.]+)/);
      if (match && parseFloat(match[1]) > 0) {
        return parseFloat(match[1]) / 60;
      }
    }
    return 2.0; // fallback standard 120 ml/min = 2.0 ml/sec
  };

  const calculateTargetMl = (pump: any, durationSec: number): string => {
    const rateMlSec = getPumpFlowRateMlSec(pump);
    return (rateMlSec * durationSec).toFixed(1);
  };

  useEffect(() => {
    if (!testRunning) return;
    const interval = setInterval(() => {
      setTestElapsedSec((prev) => prev + 1);
      setTestTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setTestRunning(false);
          setTestingPump(null);
          if (testModalPump) {
            const targetMl = Number(calculateTargetMl(testModalPump, testDuration));
            setTestFinished({
              duration: testDuration,
              targetMl,
              pumpName: testModalPump.name,
            });
            toast(`${testModalPump.name} test run (${testDuration}s, target: ${targetMl} ml) selesai`, "success");
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [testRunning, testDuration, testModalPump]);

  const handleOpenTestModal = (pump: any) => {
    setTestModalPump(pump);
    if (testingPump === pump.id) {
      // Keep running state intact if inspecting currently running pump
    } else {
      setTestFinished(null);
      setTestRunning(false);
      setTestTimeLeft(0);
      setTestElapsedSec(0);
    }
  };

  const handleStartTestRun = async () => {
    if (!testModalPump) return;
    setTestFinished(null);
    setTestRunning(true);
    setTestTimeLeft(testDuration);
    setTestElapsedSec(0);
    setTestingPump(testModalPump.id);
    try {
      await fertigationService.testPump(testModalPump.id, testModalPump.name, testDuration);
    } catch (e) {
      setTestRunning(false);
      setTestingPump(null);
      toast(errorMessage(e), "error");
    }
  };

  const handleStopTestRun = async () => {
    if (!testModalPump) return;
    setTestRunning(false);
    setTestingPump(null);
    try {
      await fertigationService.stopTestPump(testModalPump.id);
      toast(`${testModalPump.name} test run dihentikan`, "warning");
    } catch (e) {
      toast(errorMessage(e), "error");
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
                const isActive = g.id === selectedGhId;
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
                        // PRD §8.6 / F-C5: dynamic dosing channels — render per-registry (semua channel, bukan slice 2), fallback A/B untuk record lama.
                        ...(Array.isArray(r.dosingChannels) && r.dosingChannels.length > 0
                          ? r.dosingChannels.map((ch) => ({
                              label: ch.componentId,
                              value: `${ch.doneMl ?? 0} / ${ch.requestedMl} ml`,
                            }))
                          : [
                              { label: "A", value: `${r.dosingADoneMl ?? 0} / ${r.dosingAml ?? 0} ml` },
                              { label: "B", value: `${r.dosingBDoneMl ?? 0} / ${r.dosingBml ?? 0} ml` },
                            ]),
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
          subtitle={`Last calibration: ${lastCalibration}`}
        >
          <div className="mb-3.5 flex items-center justify-between rounded-lg border border-[--color-line] bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>Volumetric flow rate determines pump runtime for automated recipe dosing.</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => router(`/calibration?complex=${complex.id}`)}
            >
              Calibrate All
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {pumps.map((p) => {
              const testing = testingPump === p.id;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-3.5 transition-all ${
                    testing
                      ? "border-amber-500/40 bg-amber-500/[0.04] shadow-md shadow-amber-950/20"
                      : "border-[--color-line] bg-[#0b2027]/[0.035] hover:border-slate-700/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-200">{p.name}</span>
                    <StatusBadge status={testing ? "running" : p.state === "Ready" ? "ready" : "off"} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Flow rate: <strong className="text-slate-200">{p.rate}</strong>
                    </span>
                    {testing && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 animate-pulse">
                        <Timer className="h-3 w-3" />
                        {testTimeLeft}s tersisa
                      </span>
                    )}
                  </div>
                  <div className="mt-2.5 flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 font-medium"
                      onClick={() => handleOpenTestModal(p)}
                    >
                      {testing ? (
                        <span className="flex items-center justify-center gap-1.5 text-amber-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                          Running ({testTimeLeft}s)…
                        </span>
                      ) : (
                        "Test Run"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 font-medium"
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
                value={manualGh?.id ?? ""}
                onChange={(e) => {
                  const nextGh = greenhouseService.get(e.target.value);
                  if (!nextGh) {
                    setManualGhId("");
                    setManualRecipe("");
                    return;
                  }
                  setManualGhId(nextGh.id);
                  setManualRecipe("");
                  setManualWater("80");
                }}
                options={ghs.map((greenhouse) => ({ value: greenhouse.id, label: greenhouse.code }))}
              />
              <Button className="mt-3" onClick={() => { setManualError(null); setManualOpen(true); }} disabled={!manualGh || Boolean(manualGh.currentRun)}>
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
            {sys && [
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
                  <th className="pb-2.5 font-medium">Dosing Channels</th>
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
                    <td className="py-3 pr-3 text-slate-300">
                      {Array.isArray(h.dosingChannels) && h.dosingChannels.length > 0
                        ? h.dosingChannels.map((ch) => `${ch.componentId}: ${n(ch.requestedMl)}ml`).join(", ")
                        : `A: ${n(h.dosingAml ?? 0)}ml / B: ${n(h.dosingBml ?? 0)}ml`}
                    </td>
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
        title={`Manual Fertigation — ${manualGh?.code ?? "Select greenhouse"}`}
        width={520}
        footer={
          <>
            <Button variant="secondary" onClick={() => setManualOpen(false)} disabled={starting}>Cancel</Button>
            <Button onClick={handleStartManual} disabled={starting || !manualGh || !manualRecipe}>
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
              disabled={!manualGh}
              onChange={(e) => {
                setManualRecipe(e.target.value);
                const r = manualGh?.recipes.find((x) => x.id === e.target.value);
                if (r) setManualWater(String(r.waterL));
              }}
              options={manualGh?.recipes.map((r) => ({ value: r.id, label: r.name })) ?? [{ value: "", label: "Select greenhouse first" }]}
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

      {/* ---------------- Test Run Modal ---------------- */}
      <Modal
        open={Boolean(testModalPump)}
        onClose={() => {
          if (!testRunning) {
            setTestModalPump(null);
            setTestFinished(null);
          }
        }}
        title={`Test Run — ${testModalPump?.name ?? "Dosing Pump"}`}
        width={580}
      >
        {testModalPump && (
          <div className="space-y-4">
            {/* Header info bar */}
            <div className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-900/60 p-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Droplets className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-200">{testModalPump.name}</div>
                  <div className="text-xs text-slate-400">
                    Laju Alir Terkalibrasi:{" "}
                    <span className="font-semibold text-emerald-400">{testModalPump.rate}</span>
                    <span className="text-slate-500 ml-1">
                      (~{getPumpFlowRateMlSec(testModalPump).toFixed(2)} mL/s)
                    </span>
                  </div>
                </div>
              </div>
              <StatusBadge status={testRunning ? "running" : testModalPump.state === "Ready" ? "ready" : "off"} />
            </div>

            {/* View 1: Selection Mode (When not running and not completed) */}
            {!testRunning && !testFinished && (
              <>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      PILIH DURASI & TARGET VOLUME
                    </span>
                    <span className="text-[11px] text-slate-500">Estimasi berdasarkan debit pompa</span>
                  </div>

                  {/* 3 cards: 10s, 30s, 60s */}
                  <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                    {[
                      {
                        sec: 10 as const,
                        label: "10 Detik",
                        tag: "Uji Cepat / Priming",
                        desc: "Cek putaran awal & priming selang",
                      },
                      {
                        sec: 30 as const,
                        label: "30 Detik",
                        tag: "Uji Kestabilan",
                        desc: "Uji kestabilan debit aliran medium",
                      },
                      {
                        sec: 60 as const,
                        label: "60 Detik",
                        tag: "Standar 1 Menit",
                        desc: "Verifikasi kapasitas debit penuh",
                      },
                    ].map((opt) => {
                      const isSelected = testDuration === opt.sec;
                      const target = calculateTargetMl(testModalPump, opt.sec);
                      return (
                        <button
                          key={opt.sec}
                          type="button"
                          onClick={() => setTestDuration(opt.sec)}
                          className={`relative flex flex-col items-center justify-between rounded-xl border p-3 text-left transition-all cursor-pointer ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-500/[0.12] ring-2 ring-emerald-500/25 shadow-lg shadow-emerald-950/40"
                              : "border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70"
                          }`}
                        >
                          {isSelected && (
                            <div className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-slate-950">
                              <Check className="h-3 w-3 stroke-[3]" />
                            </div>
                          )}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${
                              isSelected
                                ? "bg-emerald-400/20 text-emerald-300"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {opt.tag}
                          </span>
                          <div className="my-2.5 text-center">
                            <div className="text-xs font-semibold text-slate-300">{opt.label}</div>
                            <div
                              className={`text-xl font-extrabold tracking-tight ${
                                isSelected ? "text-emerald-400" : "text-slate-200"
                              }`}
                            >
                              {target} <span className="text-xs font-medium text-slate-400">mL</span>
                            </div>
                          </div>
                          <div className="text-center text-[10px] leading-tight text-slate-400">
                            {opt.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Target calculation summary box */}
                <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/20 via-slate-900/50 to-emerald-950/20 p-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400">
                        Target Penakaran Uji Coba
                      </div>
                      <div className="mt-0.5 text-xs text-slate-300">
                        Durasi <strong className="text-white">{testDuration} detik</strong> dengan laju alir{" "}
                        <strong className="text-white">{testModalPump.rate}</strong>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-cyan-400">
                        {calculateTargetMl(testModalPump, testDuration)}{" "}
                        <span className="text-sm font-bold text-cyan-300">mL</span>
                      </div>
                      <div className="text-[10px] text-slate-400">Target Takaran</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-900/80 p-2.5 text-xs text-slate-300 border border-slate-800">
                    <Info className="h-4 w-4 shrink-0 text-cyan-400 mt-0.5" />
                    <span>
                      <strong>Instruksi:</strong> Siapkan gelas ukur atau wadah bertakar di bawah selang keluaran pompa. Setelah uji selesai, Anda dapat membandingkan volume riil dengan target <strong>{calculateTargetMl(testModalPump, testDuration)} mL</strong>.
                    </span>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                  <Button variant="secondary" onClick={() => setTestModalPump(null)}>
                    Batal
                  </Button>
                  <Button
                    onClick={handleStartTestRun}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium gap-1.5"
                  >
                    <Zap className="h-4 w-4" />
                    Mulai Test Run ({testDuration}s → {calculateTargetMl(testModalPump, testDuration)} mL)
                  </Button>
                </div>
              </>
            )}

            {/* View 2: Active Test Running */}
            {testRunning && (
              <div className="space-y-4 py-1">
                <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/[0.08] to-slate-900/60 p-5 text-center">
                  {/* Pulsing indicator */}
                  <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300">
                      <Droplets className="h-6 w-6 animate-bounce" />
                    </div>
                  </div>

                  <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-amber-400">
                    POMPA SEDANG MENYALA (TEST RUN AKTIF)
                  </div>
                  <div className="mt-1 text-3xl font-black tracking-tight text-white">
                    {testTimeLeft} <span className="text-base font-semibold text-slate-400">detik tersisa</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    Durasi total: {testDuration} detik • Target: {calculateTargetMl(testModalPump, testDuration)} mL
                  </div>

                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                      <span>Waktu berjalan: {testElapsedSec}s / {testDuration}s</span>
                      <span className="font-semibold text-amber-400">
                        {Math.min(100, Math.round((testElapsedSec / testDuration) * 100))}%
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-1000 ease-linear"
                        style={{
                          width: `${Math.min(100, (testElapsedSec / testDuration) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Real-time estimated output */}
                  <div className="mt-3 text-xs text-slate-300">
                    Estimasi terpompa saat ini:{" "}
                    <strong className="text-emerald-400">
                      {(getPumpFlowRateMlSec(testModalPump) * testElapsedSec).toFixed(1)} mL
                    </strong>{" "}
                    / {calculateTargetMl(testModalPump, testDuration)} mL
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3.5 py-2.5 text-xs text-amber-300">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>Pompa dikendalikan langsung oleh ESP32. Tekan tombol merah di bawah jika ingin membatalkan segera.</span>
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    variant="danger"
                    onClick={handleStopTestRun}
                    className="gap-1.5 font-semibold"
                  >
                    <Square className="h-4 w-4 fill-current" />
                    Hentikan Sekarang
                  </Button>
                </div>
              </div>
            )}

            {/* View 3: Finished Test Run */}
            {!testRunning && testFinished && (
              <div className="space-y-4 py-1">
                <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/[0.08] to-slate-900/60 p-5 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div className="mt-3 text-base font-bold text-slate-100">
                    Test Run {testFinished.pumpName} Selesai!
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Pompa telah dijalankan selama <strong className="text-slate-200">{testFinished.duration} detik</strong>
                  </div>

                  <div className="mt-4 inline-flex items-baseline gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-5 py-2.5">
                    <span className="text-xs uppercase tracking-wide text-emerald-400 font-medium">Target Takaran:</span>
                    <span className="text-2xl font-black text-emerald-400">{testFinished.targetMl} mL</span>
                  </div>

                  <div className="mt-4 text-xs text-slate-300 leading-relaxed max-w-md mx-auto">
                    Silakan bandingkan volume di gelas ukur Anda dengan target <strong>{testFinished.targetMl} mL</strong>.
                    Jika terdapat perbedaan nyata, Anda disarankan untuk melakukan kalibrasi ulang laju alir pompa agar penakaran nutrisi otomatis selalu akurat.
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-slate-800">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setTestFinished(null);
                      setTestElapsedSec(0);
                      setTestTimeLeft(0);
                    }}
                    className="gap-1.5"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Uji Lagi
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setTestModalPump(null);
                        setTestFinished(null);
                        router(`/calibration?complex=${complex.id}`);
                      }}
                      className="gap-1.5 text-xs text-cyan-400"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Kalibrasi Pompa Ini
                    </Button>
                    <Button
                      onClick={() => {
                        setTestModalPump(null);
                        setTestFinished(null);
                      }}
                    >
                      Selesai
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
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

      {/* ITEM-5: Fertigation runtime panels (Entity 3/4/5/6 — 1:1 with firmware) */}
      <div className="mt-6 space-y-4">
        <TodayOccurrencesPanel selectedGhId={selectedGhId} ghCodeMap={ghCodeMap} />
        <MixingBatchesPanel selectedGhId={selectedGhId} ghCodeMap={ghCodeMap} />
        <DistributionPanel selectedGhId={selectedGhId} ghCodeMap={ghCodeMap} />
        <DosingQueuePanelThin selectedGhId={selectedGhId} ghCodeMap={ghCodeMap} />
        <FertigationHistoryPanel selectedGhId={selectedGhId} ghCodeMap={ghCodeMap} />
      </div>
    </AppShell>
  );
}
