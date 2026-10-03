"use client";

import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Beaker,
  Check,
  CheckCircle2,
  Clock,
  Droplets,
  ExternalLink,
  FlaskConical,
  Gauge,
  History,
  Info,
  Layers,
  ListOrdered,
  PlayCircle,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
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
import { complexRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";
import { FertigationQueueDashboard } from "@/components/fertigation/FertigationQueueDashboard";

export default function FertigationPage() {
  return (
    <Suspense fallback={null}>
      <FertigationContent />
    </Suspense>
  );
}

function FertigationContent() {
  useDbVersion();
  const [params] = useSearchParams();
  const router = useNavigate();
  const toast = useToast();

  const complexes = complexService.list();
  const rawComplexId = (params.get("complex") ?? "").trim();
  const complex = rawComplexId ? complexes.find((c) => c.id === rawComplexId) : complexes[0];

  useEffect(() => {
    if (rawComplexId && !complex) {
      toast("Complex tidak ditemukan", "error");
    }
  }, [rawComplexId, complex, toast]);

  if (!complex) return null;

  const ghs = greenhouseService.byComplex(complex.id);
  const selectedGhId = params.get("gh") ?? "";
  const selectedGh = selectedGhId ? greenhouseService.get(selectedGhId) : undefined;
  const realtimeState = complexRealtimeState(complex, ghs);

  // Modal dialog states
  const [manualOpen, setManualOpen] = useState(false);
  const [manualGhId, setManualGhId] = useState(selectedGhId || ghs[0]?.id || "");
  const [estopOpen, setEstopOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [manualRecipe, setManualRecipe] = useState("");
  const [manualWater, setManualWater] = useState("50");
  const [manualError, setManualError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testingPump, setTestingPump] = useState<string | null>(null);

  const manualGh = manualGhId ? greenhouseService.get(manualGhId) : undefined;

  // Dosing pump hardware status
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

  /* ---------------------------- Actions ---------------------------- */

  const handleStartManual = async () => {
    setManualError(null);
    if (number(manualWater, { label: "Target air", positive: true })) {
      setManualError("Target air harus lebih besar dari 0 liter.");
      return;
    }
    setStarting(true);
    try {
      if (!manualGh) { setManualError("Pilih greenhouse sebelum memulai fertigasi."); return; }
      if (!manualRecipe) { setManualError("Pilih resep nutrisi sebelum memulai fertigasi."); return; }
      await fertigationService.startManual(manualGh.id, manualRecipe, Number(manualWater));
      setManualOpen(false);
      toast(`Fertigasi manual untuk ${manualGh.code} berhasil dimulai pada kontroler ESP32!`, "success");
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
      toast("EMERGENCY STOP dieksekusi — seluruh pompa dan aktuator dinonaktifkan!", "warning");
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
      toast("Sistem berhasil dipulihkan — aktuator dan jadwal dapat beroperasi normal kembali.", "success");
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
      toast("Konfigurasi fertigasi berhasil disinkronkan ke ESP32.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSyncing(false);
    }
  };

  /* ---------------------- Test Run Dosing Pump State ---------------------- */
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
    return 2.0;
  };

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (testRunning && testTimeLeft > 0) {
      timer = setInterval(() => {
        setTestTimeLeft((prev) => {
          const next = prev - 1;
          setTestElapsedSec((e) => e + 1);
          if (next <= 0) {
            setTestRunning(false);
            setTestingPump(null);
            if (testModalPump) {
              const rateMlSec = getPumpFlowRateMlSec(testModalPump);
              const calculatedTarget = Math.round(rateMlSec * testDuration);
              setTestFinished({
                duration: testDuration,
                targetMl: calculatedTarget,
                pumpName: testModalPump.name,
              });
              toast(`Uji jalan ${testModalPump.name} selesai (${testDuration}s). Target takaran: ~${calculatedTarget} ml`, "success");
            }
            return 0;
          }
          return next;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [testRunning, testTimeLeft, testModalPump, testDuration, toast]);

  const handleOpenTestModal = (pump: any) => {
    setTestModalPump(pump);
    setTestDuration(10);
    setTestRunning(false);
    setTestTimeLeft(0);
    setTestElapsedSec(0);
    setTestFinished(null);
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
      toast(`${testModalPump.name} pengujian berhasil dihentikan.`, "warning");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <AppShell complexId={complex.id}>
      <div className="min-w-0 w-full max-w-full space-y-6">
        {/* ---------------- 1. Top Header & Complex Switcher ---------------- */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <ComplexSwitcher complexId={complex.id} complexes={complexes} />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-100">
                Pusat Kontrol Fertigasi & Nutrisi
              </h1>
              <p className="text-xs text-slate-400">
                {complex.name || complex.code} — Pemantauan Terpadu: Jadwal → Antrean Dosing Sentral → Tangki Batch GH → Penyiraman
              </p>
            </div>
          </div>

          {/* Quick Actions (Sync & Emergency Controls) */}
          <div className="flex items-center gap-2.5">
            <Button variant="secondary" onClick={handleSync} disabled={syncing}>
              <Settings2 className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sinkronisasi…" : "Sinkronkan ESP32"}
            </Button>

            <Button
              className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
              onClick={() => { setManualError(null); setManualOpen(true); }}
            >
              <PlayCircle className="h-4 w-4" /> Mulai Manual
            </Button>

            {complex.emergencyStopped ? (
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setResumeOpen(true)}>
                <ShieldCheck className="h-4 w-4" /> Pulihkan Sistem (Resume)
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setEstopOpen(true)}>
                <ShieldAlert className="h-4 w-4" /> Emergency Stop
              </Button>
            )}
          </div>
        </div>

        {/* ---------------- 2. Core Rebuilt Fertigation & Mixing Engine ---------------- */}
        <FertigationQueueDashboard
          complexId={complex.id}
          selectedGhId={selectedGhId || undefined}
          onOpenCreate={() => router(`/schedule?complex=${complex.id}`)}
        />

        {/* ---------------- 3. Dosing Pump Status & Calibrations ---------------- */}
        <div className="rounded-2xl border border-slate-800 bg-[#0e1a2a] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                <Gauge className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3
                    className="text-sm font-bold text-slate-100 cursor-default"
                    title="Debit riil menentukan durasi buka pompa saat peracikan resep otomatis."
                  >
                    Status Pompa Dosing & Laju Alir Fisik
                  </h3>
                  <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300">
                    Kalibrasi: {lastCalibration}
                  </span>
                </div>
              </div>
            </div>

            <Button
              size="sm"
              variant="secondary"
              className="text-xs"
              onClick={() => router(`/calibration?complex=${complex.id}`)}
            >
              Buka Wizard Kalibrasi Pompa →
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            {pumps.map((p) => {
              const testing = testingPump === p.id;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-4 transition-all ${
                    testing
                      ? "border-amber-500/50 bg-amber-950/20 shadow-md ring-1 ring-amber-400/30"
                      : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-100">{p.name}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        testing
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse"
                          : p.state === "Ready"
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${testing ? "bg-amber-400" : p.state === "Ready" ? "bg-emerald-400" : "bg-slate-500"}`} />
                      {testing ? "Uji Jalan" : p.state}
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-slate-400">
                    Debit Terkalibrasi: <strong className="text-emerald-400 text-sm">{p.rate}</strong>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 font-semibold text-xs"
                      onClick={() => handleOpenTestModal(p)}
                    >
                      {testing ? (
                        <span className="flex items-center gap-1 text-amber-400">
                          <Timer className="h-3 w-3 animate-spin" /> {testTimeLeft}s
                        </span>
                      ) : (
                        "Uji Jalan (Test Run)"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => router(`/calibration?complex=${complex.id}`)}
                    >
                      Kalibrasi
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------------- Modals: Test Run Dosing Pump ---------------- */}
        {testModalPump && (
          <Modal
            open={Boolean(testModalPump)}
            onClose={() => { if (!testRunning) setTestModalPump(null); }}
            title={`Uji Jalan Pompa: ${testModalPump.name}`}
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
                Pilih durasi uji untuk memeriksa putaran motor dan keluaran cairan ke gelas ukur.
              </div>

              {/* Preset Cards */}
              <div className="grid grid-cols-3 gap-2">
                {([10, 30, 60] as const).map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    disabled={testRunning}
                    onClick={() => setTestDuration(sec)}
                    className={`rounded-xl border p-3 text-center transition ${
                      testDuration === sec
                        ? "border-cyan-400 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-400/40"
                        : "border-slate-800 bg-slate-950/50 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="text-sm font-bold">{sec} Detik</div>
                    <div className="text-[10px] mt-0.5">
                      ~{Math.round(getPumpFlowRateMlSec(testModalPump) * sec)} ml
                    </div>
                  </button>
                ))}
              </div>

              {/* Active countdown or finished view */}
              {testRunning ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-center space-y-2">
                  <div className="text-2xl font-bold text-amber-300 font-mono">
                    00:{testTimeLeft < 10 ? `0${testTimeLeft}` : testTimeLeft}
                  </div>
                  <div className="text-xs text-slate-400">Pompa sedang berputar... Siapkan gelas ukur</div>
                  <Button variant="danger" size="sm" onClick={handleStopTestRun} className="mt-2">
                    <Square className="h-3.5 w-3.5 mr-1" /> Hentikan Uji Jalan
                  </Button>
                </div>
              ) : testFinished ? (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-center space-y-1 text-xs">
                  <div className="font-bold text-emerald-300 text-sm flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" /> Uji Jalan Selesai!
                  </div>
                  <p className="text-slate-300">
                    Cairan terpompa selama {testFinished.duration} detik: target estimasi ~<b>{testFinished.targetMl} ml</b>.
                  </p>
                </div>
              ) : null}

              {/* Modal Actions */}
              <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
                <Button variant="secondary" onClick={() => setTestModalPump(null)} disabled={testRunning}>
                  Tutup
                </Button>
                {!testRunning && (
                  <Button className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold" onClick={handleStartTestRun}>
                    Mulai Uji ({testDuration} Detik)
                  </Button>
                )}
              </div>
            </div>
          </Modal>
        )}

        {/* ---------------- Modals: Start Manual Fertigation ---------------- */}
        <Modal
          open={manualOpen}
          onClose={() => { if (!starting) setManualOpen(false); }}
          title="Mulai Fertigasi Manual"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Peracikan nutrisi dan distribusi air akan langsung diproses oleh kontroler ESP32 di luar jadwal otomatis.
            </p>

            <div>
              <Label>Target Greenhouse</Label>
              <Select
                value={manualGh?.id ?? ""}
                onChange={(e) => {
                  setManualGhId(e.target.value);
                  setManualRecipe("");
                }}
                options={ghs.map((g) => ({ value: g.id, label: g.code || g.id }))}
              />
            </div>

            <div>
              <Label>Resep Nutrisi</Label>
              <Select
                value={manualRecipe}
                onChange={(e) => setManualRecipe(e.target.value)}
                options={
                  manualGh?.recipes?.map((r) => ({ value: r.id, label: `${r.name} (${r.waterL}L air)` })) || []
                }
              />
            </div>

            <div>
              <Label>Target Volume Air Baku (Liter)</Label>
              <Input
                type="number"
                value={manualWater}
                onChange={(e) => setManualWater(e.target.value)}
                placeholder="50"
              />
            </div>

            {manualError && <FieldError>{manualError}</FieldError>}

            <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
              <Button variant="secondary" onClick={() => setManualOpen(false)} disabled={starting}>
                Batal
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                onClick={handleStartManual}
                disabled={starting || !manualGh || !manualRecipe}
              >
                {starting ? "Memulai Peracikan…" : "Mulai Fertigasi Sekarang"}
              </Button>
            </div>
          </div>
        </Modal>

        {/* ---------------- Modals: Emergency Stop & Resume ---------------- */}
        <ConfirmDialog
          open={estopOpen}
          onClose={() => { if (!stopping) setEstopOpen(false); }}
          onConfirm={handleEmergencyStop}
          title="Hentikan Darurat (Emergency Stop)?"
          message={`Hentikan seluruh pompa dosing, mixer, dan pompa irigasi di ${complex.name || complex.code} seketika? Sistem akan tetap dalam kondisi aman sampai tombol Pulihkan ditekan.`}
          confirmLabel={stopping ? "Menghentikan…" : "Hentikan Semua Sekarang"}
          danger
        />

        <ConfirmDialog
          open={resumeOpen}
          onClose={() => { if (!resuming) setResumeOpen(false); }}
          onConfirm={handleResume}
          title="Pulihkan Sistem (Resume System)?"
          message={`Buka interlock emergency stop pada ${complex.name || complex.code}? Seluruh aktuator dan jadwal akan kembali aktif secara normal.`}
          confirmLabel={resuming ? "Memulihkan…" : "Pulihkan Sistem"}
        />
      </div>
    </AppShell>
  );
}
