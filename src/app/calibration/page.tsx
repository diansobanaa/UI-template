"use client";

import { Suspense, useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CheckCircle2,
  FlaskConical,
  History,
  PlayCircle,
  RefreshCcw,
  ShieldAlert,
  SlidersHorizontal,
  Info,
  Timer,
  Beaker,
  CheckSquare,
  Pipette,
  Square,
  Gauge,
  Check,
  Clock,
  Cpu,
  Laptop,
  Play,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  Layers,
  Sparkles,
  Droplets,
  HelpCircle,
  Activity,
  CheckCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ComplexSwitcher, GreenhouseSwitcher } from "@/components/layout/bits";
import { SectionCard } from "@/components/ui/cards";
import { Badge, Button, Input, Label, StatusBadge } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { calibrationService, complexService, greenhouseService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { errorMessage } from "@/lib/errors";
import type { CalibrationDevice } from "@/lib/types";
import { complexRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";
import { deviceClock, useDeviceClock } from "@/lib/device-clock";
import {
  calculateDosingFlowRate,
  validateVolumeInput,
  aggregateDosingSamples,
  type CalibrationSample,
} from "@/lib/calibration-math";

const FILTERS = [
  { id: "all", label: "Semua Perangkat" },
  { id: "sensors", label: "Sensor (pH/EC)" },
  { id: "dosing-pumps", label: "Pompa Dosing" },
];

export default function CalibrationPage() {
  return (
    <Suspense fallback={null}>
      <CalibrationContent />
    </Suspense>
  );
}

function CalibrationContent() {
  const [params] = useSearchParams();
  const router = useNavigate();
  const toast = useToast();

  const complexes = complexService.list();
  const rawComplexId = (params.get("complex") ?? "").trim();
  const complex = (rawComplexId ? complexes.find((c) => c.id === rawComplexId) : null) ?? complexes[0];
  if (!complex) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <SlidersHorizontal className="h-12 w-12 text-slate-400 mb-4 animate-pulse" />
          <h2 className="text-lg font-semibold text-slate-900">Belum ada Complex Terkonfigurasi</h2>
          <p className="text-sm text-slate-500 mt-1">Silakan konfigurasi atau hubungkan ESP32 Complex terlebih dahulu.</p>
        </div>
      </AppShell>
    );
  }
  const ghs = greenhouseService.byComplex(complex.id);
  const ghId = params.get("gh") ?? "";
  const gh = ghId ? greenhouseService.get(ghId) : undefined;
  const realtimeState = complexRealtimeState(complex, ghs);

  const [category, setCategory] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"calibrate" | "history">("calibrate");
  /** Single source of truth for a running pump — the header E-Stop and the wizard share it. */
  const [run, setRun] = useState<{ deviceId: string; secondsLeft: number } | null>(null);
  const [authoritativeDevices, setAuthoritativeDevices] = useState<CalibrationDevice[]>([]);
  const [authoritativeHistory, setAuthoritativeHistory] = useState<import("@/lib/types").CalibrationRecord[]>([]);

  useDbVersion();

  const refreshAuthoritative = async () => {
    try {
      const loaded = await calibrationService.loadAuthoritative(complex.id);
      setAuthoritativeDevices(loaded.devices);
      setAuthoritativeHistory(loaded.history);
    } catch {
      // keep current state
    }
  };

  useEffect(() => {
    let cancelled = false;
    calibrationService.loadAuthoritative(complex.id).then((loaded) => {
      if (!cancelled) {
        setAuthoritativeDevices(loaded.devices);
        setAuthoritativeHistory(loaded.history);
      }
    }).catch(() => {
      if (!cancelled) {
        setAuthoritativeDevices([]);
        setAuthoritativeHistory([]);
      }
    });
    return () => { cancelled = true; };
  }, [complex.id]);

  const devices = authoritativeDevices
    .filter((d) => (category === "all" ? true : (category === "sensors" ? ["ph", "ec"].includes(d.category) : d.category === "dosing-pump")))
    .filter((d) => d.ghId === null || d.ghId === gh?.id || !gh?.id);
  const device = devices.find((d) => d.id === selectedDeviceId) ?? devices[0] ?? null;
  const history = authoritativeHistory;

  useEffect(() => {
    if (devices.length > 0 && !selectedDeviceId) {
      setSelectedDeviceId(devices[0].id);
    }
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    if (!run) return;
    const timer = setInterval(() => {
      setRun((prev: { deviceId: string; secondsLeft: number } | null) => {
        if (!prev) return null;
        return prev.secondsLeft > 1 ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : null;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [run !== null]);

  const setGh = (id: string) => {
    router(`/calibration?complex=${complex.id}&gh=${id}`, { replace: true });
    setSelectedDeviceId(null);
  };

  const changeCategory = (id: string) => {
    setCategory(id);
    setSelectedDeviceId(null);
  };

  const handleHeaderEStop = () => {
    const wasRunning = run !== null;
    setRun(null);
    toast(
      wasRunning
        ? "E-STOP: pompa yang sedang berjalan dihentikan seketika."
        : "E-Stop diteruskan ke kontroler — tidak ada pompa yang sedang berjalan.",
      wasRunning ? "error" : "info",
    );
  };

  const compId = device ? device.id.replace("dev-", "") : "";
  const deviceHistory = device
    ? history.filter((h) => h.device === compId || h.device === shortName(device) || h.device === device.name)
    : [];

  return (
    <AppShell complexId={complex.id}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
        <div className="flex flex-wrap gap-4">
          <ComplexSwitcher complexId={complex.id} complexes={complexes} />
          <GreenhouseSwitcher complexId={complex.id} greenhouses={ghs} ghId={gh?.id ?? ""} onChange={setGh} label="Lokasi" />
          <LiveStatus state={realtimeState} label="Hardware Link" />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={async () => {
            toast("Permintaan sinkronisasi dikirim ke ESP32", "info");
            await refreshAuthoritative();
          }}>
            <RefreshCcw className="h-4 w-4 mr-2" /> Sync Alat
          </Button>
          <Button variant="danger" onClick={handleHeaderEStop}>
            <ShieldAlert className="h-4 w-4 mr-2" /> E-Stop
          </Button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Kalibrasi & Perawatan Alat</h1>
          <p className="text-sm text-slate-500">
            {complex.code} • {gh?.code ?? "-"} — Kalibrasi pompa dosing, pH meter, dan EC meter sesuai jadwal.
          </p>
        </div>
        <StatusBadges devices={authoritativeDevices} />
      </div>

      <RtcClockCalibrationCard />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <SectionCard
          title="Pilih Perangkat"
          icon={SlidersHorizontal}
          iconTone="blue"
          className="xl:col-span-4 flex flex-col h-[740px]"
          bodyClassName="flex flex-col h-full overflow-hidden pb-4"
        >
          <div className="px-5 mb-4 border-b border-slate-100 pb-4">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => changeCategory(f.id)}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    category === f.id ? "bg-slate-800 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scroll-thin px-5 space-y-3">
            {devices.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm text-center px-6">
                <SlidersHorizontal className="h-8 w-8 mb-2 opacity-20" />
                Tidak ada perangkat di lokasi ini untuk kategori yang dipilih.
              </div>
            ) : (
              devices.map((d) => {
                const isDue = d.due.includes("in") && parseInt(d.due.replace(/\D/g, "")) <= 30;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDeviceId(d.id)}
                    className={`w-full cursor-pointer rounded-xl border p-4 text-left transition-all ${
                      device?.id === d.id
                        ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="block font-bold text-slate-800">{d.name}</span>
                        <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md mt-1 inline-block">{d.location}</span>
                      </div>
                      <StatusBadge status={d.online ? "online" : "offline"} />
                    </div>
                    <div className="mt-4 flex items-center justify-between text-[12px] border-t border-slate-100 pt-3">
                      <span className="text-slate-500">Terakhir: <span className="font-medium text-slate-700">{d.lastCalibration}</span></span>
                      <span className={`font-semibold ${isDue ? "text-red-600 bg-red-50 px-2 py-1 rounded-md" : "text-emerald-600"}`}>
                        {isDue ? <span className="mr-1">⚠️</span> : null}
                        Jadwal: {d.due}
                      </span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-50 flex items-center justify-between">
                      {getCalibrationAgeBadge(d)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </SectionCard>

        <div className="xl:col-span-8 flex flex-col h-[740px]">
          {device ? (
            <SectionCard
              className="h-full flex flex-col"
              bodyClassName="flex flex-col h-full p-0"
              title={shortName(device)}
              subtitle={
                device.category === "dosing-pump"
                  ? `Mode: Kalibrasi Volumetrik — Kanal ${pumpChannel(device)}`
                  : `Mode: Kalibrasi ${device.category === "ph" ? "pH" : "EC"} dengan Larutan Standar`
              }
            >
              <div className="border-b border-slate-100 p-5 pb-0 bg-white rounded-t-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex gap-8 text-[14px] font-bold">
                    <button
                      onClick={() => setActiveTab("calibrate")}
                      className={`flex items-center gap-2 pb-3 border-b-2 transition-colors ${
                        activeTab === "calibrate" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <BookOpen className="h-4 w-4" /> Panduan & Panel Kalibrasi
                    </button>
                    <button
                      onClick={() => setActiveTab("history")}
                      className={`flex items-center gap-2 pb-3 border-b-2 transition-colors ${
                        activeTab === "history" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      <History className="h-4 w-4" /> Riwayat Kalibrasi
                    </button>
                  </div>
                  <div className="pb-3">
                    {getCalibrationAgeBadge(device)}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scroll-thin p-6 bg-slate-50/50">
                {activeTab === "calibrate" && device.category === "dosing-pump" && (
                  <DosingPumpCalibrationWizard
                    key={device.id}
                    device={device}
                    run={run && run.deviceId === device.id ? run : null}
                    onStart={(seconds) => setRun({ deviceId: device.id, secondsLeft: seconds })}
                    onStop={() => setRun(null)}
                    onSaved={refreshAuthoritative}
                  />
                )}
                {activeTab === "calibrate" && (device.category === "ph" || device.category === "ec") && (
                  <SensorCalibrationWizard
                    key={device.id}
                    device={device}
                    onSaved={refreshAuthoritative}
                  />
                )}
                {activeTab === "history" && <HistoryTab history={deviceHistory} deviceName={shortName(device)} />}
              </div>
            </SectionCard>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-slate-50">
              <SlidersHorizontal className="h-12 w-12 mb-3 opacity-20" />
              <p>Pilih perangkat dari daftar di sebelah kiri untuk memulai kalibrasi</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function shortName(device: CalibrationDevice): string {
  return device.name.replace(/\s*\(.*\)$/, "");
}

function pumpChannel(device: CalibrationDevice): string {
  return device.channel ?? shortName(device).match(/\b([A-Z])\b/)?.[1] ?? "?";
}

function getCalibrationAgeBadge(d: CalibrationDevice) {
  if (!d.calibratedAtMs) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600">
        Belum Dikalibrasi
      </span>
    );
  }
  const now = Date.now();
  const days = Math.max(0, Math.floor((now - d.calibratedAtMs) / (1000 * 60 * 60 * 24)));
  if (days < 7) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Usia &lt; 7 Hari ({days}d)
      </span>
    );
  } else if (days < 10) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-yellow-50 text-yellow-800 border border-yellow-300">
        ⚠️ Warning Kuning (Usia {days} Hari ≥ 7)
      </span>
    );
  } else {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-orange-50 text-orange-800 border border-orange-300 animate-pulse">
        ⚠️ Warning Oranye (Usia {days} Hari ≥ 10)
      </span>
    );
  }
}

/** Header badges are derived from the live device list, not hardcoded counts. */
function StatusBadges({ devices }: { devices: CalibrationDevice[] }) {
  const due = devices.filter((d) => d.due.includes("in") && parseInt(d.due.replace(/\D/g, "")) <= 30).length;
  const calibrated = devices.length - due;
  return (
    <div className="flex flex-col items-end">
      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status Keseluruhan</span>
      <div className="mt-1 flex gap-2">
        <Badge tone="green">{calibrated} Akurat</Badge>
        <Badge tone="amber">{due} Wajib Kalibrasi</Badge>
        <Badge tone="gray">{devices.length} Total Alat</Badge>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dosing pump wizard — one wizard instance per pump device, keyed by  */
/* device.id so every state (sampling, volume, confirm) resets when    */
/* the operator switches pumps.                                        */
/* ------------------------------------------------------------------ */

function DosingPumpCalibrationWizard({
  device,
  run,
  onStart,
  onStop,
  onSaved,
}: {
  device: CalibrationDevice;
  run: { deviceId: string; secondsLeft: number } | null;
  onStart: (seconds: number) => void;
  onStop: () => void;
  onSaved?: () => Promise<void> | void;
}) {
  const [workflowStep, setWorkflowStep] = useState<"IDLE" | "RUNNING" | "INPUT_VOLUME" | "REVIEW" | "SAVED">("IDLE");
  const [testDuration, setTestDuration] = useState<number>(30); // 30s recommended default
  const [testMode, setTestMode] = useState<"single" | "multi">("single");
  const [volumeInput, setVolumeInput] = useState<string>("");
  const [samples, setSamples] = useState<CalibrationSample[]>([]);
  const [currentSampleIndex, setCurrentSampleIndex] = useState<number>(0);
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lastSavedRate, setLastSavedRate] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const toast = useToast();

  const channel = pumpChannel(device);
  const activeRate = device.reading !== "—" ? parseFloat(device.reading) : 0;
  const isCalibrated = activeRate > 0;

  // Single sample calculation
  const volumeNum = parseFloat(volumeInput) || 0;
  const singleFlowRate = calculateDosingFlowRate(volumeNum, testDuration);

  // Multi sample aggregation
  const allCompletedSamples: CalibrationSample[] =
    workflowStep === "REVIEW" && testMode === "multi"
      ? samples
      : (volumeNum > 0 ? [...samples, { volumeMl: volumeNum, durationSec: testDuration }] : samples);
  const multiAgg = aggregateDosingSamples(allCompletedSamples);

  // Final calculated rate for review
  const finalCalculatedRate = testMode === "multi" ? multiAgg.flowRateMlMin : singleFlowRate;
  const finalRatePerSec = finalCalculatedRate / 60;
  const finalTotalVolume = testMode === "multi" ? multiAgg.totalVolumeMl : volumeNum;
  const finalTotalDuration = testMode === "multi" ? multiAgg.totalDurationSec : testDuration;

  // Deviation against active rate
  const deviationPct =
    isCalibrated && finalCalculatedRate > 0
      ? ((finalCalculatedRate - activeRate) / activeRate) * 100
      : null;

  // Watch for pump completion while running
  useEffect(() => {
    if (workflowStep === "RUNNING" && run === null) {
      setWorkflowStep("INPUT_VOLUME");
      setValidationError(null);
      toast(`Pengujian ${testDuration} detik selesai! Silakan catat volume cairan di gelas ukur.`, "info");
    }
  }, [run, workflowStep, testDuration]);

  // Handler to start pump measurement
  const handleStartRun = async () => {
    try {
      await calibrationService.runCalibrationPump(device, testDuration);
      setWorkflowStep("RUNNING");
      onStart(testDuration);
      toast(`Pompa Dosing ${channel} diaktifkan selama ${testDuration} detik.`, "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  // Handler to cancel / stop pump
  const handleCancelRun = async () => {
    try {
      await calibrationService.stopCalibrationPump();
    } catch { }
    onStop();
    setWorkflowStep("IDLE");
    toast(`Pengujian Pompa ${channel} dihentikan. Kalibrasi belum berubah.`, "error");
  };

  // Handler when volume is entered in INPUT_VOLUME
  const handleProceedFromVolume = () => {
    const valResult = validateVolumeInput(volumeInput, testDuration);
    if (!valResult.valid) {
      setValidationError(valResult.error || "Volume tidak valid.");
      return;
    }
    setValidationError(null);

    if (testMode === "single") {
      setWorkflowStep("REVIEW");
    } else {
      // Multi-mode
      const newSamples = [...samples, { volumeMl: valResult.volumeMl, durationSec: testDuration }];
      setSamples(newSamples);
      setVolumeInput("");

      if (newSamples.length < 3) {
        setCurrentSampleIndex(newSamples.length);
        toast(`Sampel ${newSamples.length} dari 3 tersimpan! Kosongkan gelas ukur untuk sampel berikutnya.`, "info");
      } else {
        // All 3 samples collected
        setWorkflowStep("REVIEW");
        toast("Semua 3 sampel pengukuran selesai! Tinjau hasil rata-rata kalibrasi.", "success");
      }
    }
  };

  // Handler to save calibration to ESP32 and Backend
  const handleSaveData = async () => {
    setCalibrating(true);
    try {
      const beforeStr = isCalibrated ? `${activeRate.toFixed(1)} ml/min` : "Belum Dikalibrasi";
      const afterStr = `${finalCalculatedRate.toFixed(1)} ml/min`;
      await calibrationService.startCalibration(
        device,
        beforeStr,
        afterStr,
        "Operator",
        {
          measuredMl: Number(finalTotalVolume.toFixed(1)),
          durationSec: finalTotalDuration,
          flowRateMlMin: Number(finalCalculatedRate.toFixed(1)),
        }
      );
      if (onSaved) {
        await onSaved();
      }
      setLastSavedRate(finalCalculatedRate);
      setWorkflowStep("SAVED");
      setConfirmOpen(false);
      toast(`Flow Rate Pompa ${channel} (${finalCalculatedRate.toFixed(1)} ml/min) berhasil disimpan permanen!`, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setCalibrating(false);
    }
  };

  // Reset to IDLE
  const handleReset = () => {
    setWorkflowStep("IDLE");
    setVolumeInput("");
    setSamples([]);
    setCurrentSampleIndex(0);
    setValidationError(null);
  };

  return (
    <div className="space-y-6">
      {/* Visual Stepper */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          {[
            { id: "IDLE", num: 1, label: "Pengaturan & SOP" },
            { id: "RUNNING", num: 2, label: "Pompa Berjalan" },
            { id: "INPUT_VOLUME", num: 3, label: "Catat Volume" },
            { id: "REVIEW", num: 4, label: "Tinjau & Simpan" },
          ].map((s, idx) => {
            const isCurrent =
              workflowStep === s.id || (workflowStep === "SAVED" && s.id === "REVIEW");
            const isCompleted =
              (s.id === "IDLE" && workflowStep !== "IDLE") ||
              (s.id === "RUNNING" && (workflowStep === "INPUT_VOLUME" || workflowStep === "REVIEW" || workflowStep === "SAVED")) ||
              (s.id === "INPUT_VOLUME" && (workflowStep === "REVIEW" || workflowStep === "SAVED")) ||
              (s.id === "REVIEW" && workflowStep === "SAVED");

            return (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                    isCompleted
                      ? "bg-emerald-600 text-white shadow-sm"
                      : isCurrent
                      ? "bg-blue-600 text-white ring-4 ring-blue-100 shadow-sm"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : s.num}
                </div>
                <span
                  className={`text-xs font-semibold hidden md:inline ${
                    isCurrent ? "text-blue-700 font-bold" : isCompleted ? "text-slate-700" : "text-slate-400"
                  }`}
                >
                  {s.label}
                </span>
                {idx < 3 && <div className="w-6 sm:w-12 h-0.5 bg-slate-200 mx-1" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* KOLOM KIRI: Status Perangkat & Panduan SOP */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card Status Aktif */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Status Kalibrasi Pompa {channel}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                  isCalibrated
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}
              >
                {isCalibrated ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Terkalibrasi Aktif
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    Belum Dikalibrasi
                  </>
                )}
              </span>
            </div>

            <div className="flex items-baseline justify-between mt-2">
              <div>
                <div className="text-[11px] text-slate-500 font-medium">Flow Rate Acuan Kontroler</div>
                <div className="text-3xl font-extrabold font-mono text-slate-900 tracking-tight mt-0.5">
                  {isCalibrated ? activeRate.toFixed(1) : "—"}
                  <span className="text-sm font-bold text-slate-400 ml-1.5 font-sans">ml/mnt</span>
                </div>
                {isCalibrated && (
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    ({(activeRate / 60).toFixed(2)} ml/dtk)
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-400">Terakhir Dikalibrasi</div>
                <div className="text-xs font-semibold text-slate-700 mt-1">
                  {device.lastCalibration || "Belum ada riwayat"}
                </div>
              </div>
            </div>

            {!isCalibrated && (
              <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  <b>Perhatian:</b> Pompa ini belum memiliki debit terkalibrasi. Kontroler akan menolak eksekusi dosis otomatis sampai kalibrasi berhasil disimpan.
                </span>
              </div>
            )}
          </div>

          {/* Card Panduan SOP */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <Info className="h-4 w-4 text-blue-500" />
              <h3 className="font-bold text-slate-800 text-sm">Panduan Praktis Pengukuran</h3>
            </div>

            <div className="space-y-3.5 text-xs text-slate-600">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
                  1
                </div>
                <div>
                  <b className="text-slate-800 block">Siapkan Gelas Ukur</b>
                  Arahkan selang output pompa {channel} ke wadah/gelas ukur terpisah (skala mililiter).
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
                  2
                </div>
                <div>
                  <b className="text-slate-800 block">Jalankan Pengujian Pompa</b>
                  Pilih durasi (misal 30 detik), lalu klik <b>Mulai Pengujian</b>. Pompa berputar otomatis.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
                  3
                </div>
                <div>
                  <b className="text-slate-800 block">Catat Volume Cairan</b>
                  Setelah pompa berhenti, masukkan angka mililiter (ml) yang terkumpul di gelas ukur.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
                  4
                </div>
                <div>
                  <b className="text-slate-800 block">Simpan ke Kontroler</b>
                  Sistem otomatis menghitung Flow Rate (ml/mnt) dan menyimpannya secara permanen.
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
              <ShieldAlert className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>Interlock keselamatan aktif: Dosis aman terjamin oleh formula terkalibrasi.</span>
            </div>
          </div>
        </div>

        {/* KOLOM KANAN: Panel Interaktif Sesuai Workflow Step */}
        <div className="lg:col-span-7 space-y-4">
          {/* STEP 1: IDLE / READY */}
          {workflowStep === "IDLE" && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 text-blue-600" />
                  <h3 className="font-bold text-slate-900 text-base">
                    Konfigurasi Pengujian Pompa {channel}
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Atur parameter pengujian sebelum menyalakan pompa untuk sampling volumetrik.
                </p>
              </div>

              {/* Pilihan Durasi Pengujian */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-2">
                  Pilih Durasi Pompa Berjalan (Detik):
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { sec: 30, title: "30 Detik", desc: "Standar Rekomendasi", badge: "Akurat" },
                    { sec: 10, title: "10 Detik", desc: "Uji Cepat", badge: "Cepat" },
                    { sec: 60, title: "60 Detik", desc: "Presisi Tinggi", badge: "Presisi" },
                  ].map((d) => (
                    <button
                      key={d.sec}
                      type="button"
                      onClick={() => setTestDuration(d.sec)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        testDuration === d.sec
                          ? "border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-900">{d.title}</span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            testDuration === d.sec
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {d.badge}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">{d.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pilihan Mode Pengujian */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-2">
                  Pilih Mode Pengukuran:
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setTestMode("single");
                      setSamples([]);
                      setCurrentSampleIndex(0);
                    }}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      testMode === "single"
                        ? "border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-900">1x Pengukuran Tunggal</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Satu kali uji langsung simpan (praktis)</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTestMode("multi");
                      setSamples([]);
                      setCurrentSampleIndex(0);
                    }}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      testMode === "multi"
                        ? "border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-900">3x Pengukuran Bertahap</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Rata-rata 3 sampel terbobot (akurasi maksimal)</div>
                  </button>
                </div>
              </div>

              {/* Checklist Kesiapan */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1.5 text-slate-600">
                <div className="font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                  <CheckSquare className="h-4 w-4 text-emerald-600" /> Checklist Kesiapan Operasional:
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-600" /> Wadah/gelas ukur mililiter telah siap di bawah selang output.
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-600" /> Pompa akan aktif tepat selama <b>{testDuration} detik</b>.
                </div>
              </div>

              {/* Primary Action Button */}
              <Button
                onClick={handleStartRun}
                className="w-full py-6 text-sm font-bold bg-blue-600 hover:bg-blue-700 shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="h-5 w-5 fill-current" /> MULAI KALIBRASI POMPA {channel} ({testDuration} DETIK)
              </Button>
            </div>
          )}

          {/* STEP 2: RUNNING */}
          {workflowStep === "RUNNING" && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl text-white relative overflow-hidden space-y-6">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    PENGUKURAN SEDANG BERJALAN
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-full">
                  POMPA {channel} : ON
                </span>
              </div>

              {testMode === "multi" && (
                <div className="text-xs text-blue-400 font-semibold bg-blue-950/60 border border-blue-800/50 rounded-lg px-3 py-1.5 flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  <span>Pengukuran Sampel <b>{currentSampleIndex + 1} dari 3</b></span>
                </div>
              )}

              {/* Big Countdown */}
              <div className="text-center py-4">
                <div className="text-6xl font-extrabold font-mono text-white tracking-tight">
                  {run?.secondsLeft ?? testDuration}
                  <span className="text-2xl font-sans font-bold text-slate-400 ml-2">dtk</span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Pompa sedang memompa cairan ke gelas ukur. Jangan pindahkan selang.
                </p>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                  <span>Progres Pengujian</span>
                  <span className="font-mono">
                    {Math.round(((testDuration - (run?.secondsLeft ?? testDuration)) / testDuration) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full rounded-full transition-all duration-1000 ease-linear"
                    style={{
                      width: `${Math.min(100, Math.max(0, ((testDuration - (run?.secondsLeft ?? testDuration)) / testDuration) * 100))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Cancel Button */}
              <Button
                variant="danger"
                onClick={handleCancelRun}
                className="w-full py-4 text-xs font-bold bg-red-600 hover:bg-red-700 cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <Square className="h-4 w-4 fill-current" /> HENTIKAN PENGUJIAN (BATAL)
              </Button>
            </div>
          )}

          {/* STEP 3: INPUT_VOLUME */}
          {workflowStep === "INPUT_VOLUME" && (
            <div className="bg-white border border-blue-200 rounded-2xl p-6 shadow-sm ring-1 ring-blue-50 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Pengukuran Selesai! Catat Volume Cairan
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Masukkan jumlah mililiter (ml) cairan yang tertampung dari pengujian <b>{testDuration} detik</b>.
                  </p>
                </div>
                {testMode === "multi" && (
                  <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full">
                    Sampel {currentSampleIndex + 1} dari 3
                  </span>
                )}
              </div>

              {/* Form Input Volume */}
              <div>
                <Label className="text-slate-800 font-bold mb-1.5 block">
                  Volume Cairan Tertampung di Gelas Ukur (ml)
                </Label>
                <div className="relative">
                  <Input
                    value={volumeInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val)) {
                        setVolumeInput(val);
                        setValidationError(null);
                      }
                    }}
                    placeholder="Contoh: 120"
                    unit="ml"
                    autoFocus
                    className="font-mono text-lg bg-slate-50 py-2.5"
                  />
                </div>
                {validationError && (
                  <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {validationError}
                  </p>
                )}
                <p className="text-[11px] text-slate-400 mt-1">
                  Catatan: Masukkan angka sesuai permukaan meniskus bawah cairan di gelas ukur.
                </p>
              </div>

              {/* Live Preview Perhitungan */}
              {volumeNum > 0 && (
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                      <Gauge className="h-4 w-4 text-blue-600" /> Hasil Debit (Flow Rate) Sampel Ini:
                    </span>
                    <span className="font-mono font-extrabold text-blue-700 text-xl">
                      {singleFlowRate.toFixed(1)}{" "}
                      <span className="text-xs font-normal text-blue-600">ml/mnt</span>
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 font-mono flex items-center justify-between border-t border-blue-200/60 pt-1.5">
                    <span>Rumus: ({volumeNum} ml ÷ {testDuration} dtk) × 60</span>
                    <span>= {(singleFlowRate / 60).toFixed(2)} ml/dtk</span>
                  </div>
                  {isCalibrated && (
                    <div className="text-[11px] text-slate-500 pt-1">
                      Perbandingan dengan aktif sebelumnya ({activeRate.toFixed(1)} ml/mnt):{" "}
                      <b className={Math.abs((singleFlowRate - activeRate) / activeRate) <= 0.1 ? "text-emerald-700" : "text-amber-700"}>
                        {((singleFlowRate - activeRate) / activeRate) * 100 > 0 ? "+" : ""}
                        {(((singleFlowRate - activeRate) / activeRate) * 100).toFixed(1)}%
                      </b>
                    </div>
                  )}
                </div>
              )}

              {/* Tombol Lanjut */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={handleReset}
                  className="py-5 px-4 text-xs font-bold"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Ulangi
                </Button>
                <Button
                  onClick={handleProceedFromVolume}
                  disabled={!volumeInput || volumeNum <= 0}
                  className="flex-1 py-5 text-sm font-bold bg-blue-600 hover:bg-blue-700 shadow-md cursor-pointer flex items-center justify-center gap-2"
                >
                  {testMode === "single" ? (
                    <>
                      LANJUT KE TINJAUAN HASIL <ArrowRight className="h-4 w-4" />
                    </>
                  ) : currentSampleIndex < 2 ? (
                    <>
                      SIMPAN SAMPEL {currentSampleIndex + 1} & LANJUT KE SAMPEL {currentSampleIndex + 2} <ArrowRight className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      SIMPAN SAMPEL 3 & HITUNG RATA-RATA <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: REVIEW */}
          {workflowStep === "REVIEW" && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Tinjau Hasil Kalibrasi Pompa {channel}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Periksa nilai flow rate terhitung sebelum disimpan secara permanen ke kontroler.
                  </p>
                </div>
                <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> Siap Disimpan
                </span>
              </div>

              {/* Big Result Card */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 text-center">
                <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">
                  Flow Rate Hasil Kalibrasi
                </span>
                <div className="text-5xl font-extrabold font-mono text-blue-700 tracking-tight my-2">
                  {finalCalculatedRate.toFixed(1)}
                  <span className="text-lg font-bold text-blue-500 font-sans ml-2">ml/mnt</span>
                </div>
                <div className="text-xs text-slate-600 font-mono">
                  Setara dengan <b>{finalRatePerSec.toFixed(2)} ml/detik</b> • Total cairan: {finalTotalVolume.toFixed(1)} ml ({finalTotalDuration} detik)
                </div>
              </div>

              {/* Comparison Card (Sebelum vs Sesudah) */}
              <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-center text-xs">
                <div>
                  <div className="text-slate-400 text-[11px] mb-1">Nilai Aktif Sebelumnya</div>
                  <div className="font-mono font-bold text-slate-700">
                    {isCalibrated ? `${activeRate.toFixed(1)} ml/mnt` : "Belum Dikalibrasi"}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[11px] mb-1">Nilai Baru</div>
                  <div className="font-mono font-bold text-blue-600">
                    {finalCalculatedRate.toFixed(1)} ml/mnt
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 text-[11px] mb-1">Perubahan</div>
                  <div className="font-mono font-bold">
                    {deviationPct !== null ? (
                      <span className={Math.abs(deviationPct) <= 10 ? "text-emerald-600" : "text-amber-600"}>
                        {deviationPct > 0 ? "+" : ""}{deviationPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-blue-600">Baru (100%)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Multi-sample summary table if multi-mode */}
              {testMode === "multi" && samples.length > 0 && (
                <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
                  <div className="bg-slate-100 px-3.5 py-2 font-bold text-slate-700 flex items-center justify-between">
                    <span>Rincian 3 Sampel Pengukuran</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${multiAgg.isConsistent ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                      {multiAgg.isConsistent ? "✓ Konsistensi Sangat Baik" : "⚠️ Perlu Perhatian"}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 bg-white">
                    {samples.map((s, idx) => {
                      const rate = (s.volumeMl / s.durationSec) * 60;
                      return (
                        <div key={idx} className="px-3.5 py-2 flex items-center justify-between text-slate-600">
                          <span>Sampel #{idx + 1} ({s.durationSec}s): <b>{s.volumeMl} ml</b></span>
                          <span className="font-mono font-bold text-slate-800">{rate.toFixed(1)} ml/mnt</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Plain Language Meaning */}
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 leading-relaxed">
                <b>Artinya:</b> Pompa Dosing {channel} mengalirkan <b>{finalCalculatedRate.toFixed(1)} ml</b> pupuk per menit (atau <b>{finalRatePerSec.toFixed(2)} ml</b> per detik). Kontroler ESP32 akan menggunakan debit riil ini untuk menghitung durasi buka pompa saat fertigasi otomatis.
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={handleReset}
                  className="py-5 px-4 text-xs font-bold"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Ulangi Kalibrasi
                </Button>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={calibrating}
                  className="flex-1 py-5 text-sm font-bold bg-blue-600 hover:bg-blue-700 shadow-md cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="h-5 w-5" /> SIMPAN KALIBRASI KE KONTROLER
                </Button>
              </div>
            </div>
          )}

          {/* STEP 5: SAVED */}
          {workflowStep === "SAVED" && (
            <div className="bg-white border border-emerald-200 rounded-2xl p-6 shadow-sm ring-1 ring-emerald-100 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="h-9 w-9" />
              </div>

              <div>
                <h3 className="font-bold text-slate-900 text-lg">
                  Kalibrasi Berhasil Disimpan & Diaktifkan!
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Nilai flow rate baru telah tersimpan permanen di memori NVS kontroler ESP32 dan database sistem.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 max-w-xs mx-auto">
                <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
                  Flow Rate Aktif Sekarang
                </div>
                <div className="text-3xl font-extrabold font-mono text-emerald-700 mt-1">
                  {lastSavedRate ? lastSavedRate.toFixed(1) : finalCalculatedRate.toFixed(1)}
                  <span className="text-sm font-bold text-emerald-600 font-sans ml-1">ml/mnt</span>
                </div>
              </div>

              <div className="text-xs text-slate-500 flex items-center justify-center gap-4 pt-2">
                <span className="flex items-center gap-1 text-emerald-700 font-medium">
                  <Check className="h-3.5 w-3.5" /> NVS ESP32: Tersimpan
                </span>
                <span className="flex items-center gap-1 text-emerald-700 font-medium">
                  <Check className="h-3.5 w-3.5" /> Database: Sinkron
                </span>
                <span className="flex items-center gap-1 text-emerald-700 font-medium">
                  <Check className="h-3.5 w-3.5" /> Dosing: Siap Digunakan
                </span>
              </div>

              <div className="pt-3">
                <Button
                  onClick={handleReset}
                  className="py-3 px-6 text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white cursor-pointer shadow-sm"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Selesai / Kalibrasi Ulang
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { if (!calibrating) setConfirmOpen(false); }}
        onConfirm={handleSaveData}
        title={`Konfirmasi Simpan Kalibrasi Pompa ${channel}`}
        message={
          <div className="space-y-3">
            <p>Parameter flow rate baru akan disimpan secara permanen ke kontroler ESP32 dan langsung menjadi acuan durasi dosing pupuk otomatis.</p>
            <div className="bg-slate-100 p-3 rounded-xl grid grid-cols-3 gap-2 text-sm font-mono text-center">
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Volume Total</div>
                <div className="font-bold text-slate-700">{finalTotalVolume.toFixed(1)} ml</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Flow Rate Baru</div>
                <div className="font-bold text-blue-600">{finalCalculatedRate.toFixed(1)} ml/mnt</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Sebelumnya</div>
                <div className="font-bold text-slate-500">{isCalibrated ? `${activeRate.toFixed(1)} ml/mnt` : "Belum ada"}</div>
              </div>
            </div>
          </div>
        }
        confirmLabel={calibrating ? "Menyimpan ke Kontroler..." : "Ya, Simpan Parameter"}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* pH / EC sensor wizard — buffer standard + measured reading → offset */
/* ------------------------------------------------------------------ */

function SensorCalibrationWizard({
  device,
  onSaved,
}: {
  device: CalibrationDevice;
  onSaved?: () => Promise<void> | void;
}) {
  const [standard, setStandard] = useState<string>(device.standardOptions[0] ?? "");
  const [measured, setMeasured] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const toast = useToast();

  const label = device.category === "ph" ? "pH" : "EC";
  const standardNum = parseFloat(standard);
  const measuredNum = parseFloat(measured);
  const offset = Number.isFinite(standardNum) && Number.isFinite(measuredNum) ? standardNum - measuredNum : null;

  const handleSaveData = async () => {
    setCalibrating(true);
    try {
      await calibrationService.startCalibration(
        device,
        `${measured} ${device.measuredUnit}`,
        `${standard} ${device.standardUnit}`,
      );
      if (onSaved) {
        await onSaved();
      }
      toast(`Kalibrasi ${label} berhasil disimpan — offset ${offset !== null ? offset.toFixed(2) : "0"} diterapkan ke kontroler.`, "success");
      setConfirmOpen(false);
      setMeasured("");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

      <div className="lg:col-span-7 space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
            <FlaskConical className="h-5 w-5 text-blue-500" />
            <h3 className="font-bold text-slate-800 text-base">Panduan Kalibrasi Sensor {label} ({device.method === "two" ? "2 titik" : "1 titik"})</h3>
          </div>

          <div className="space-y-4 text-[13.5px]">
            <Step num="1" title="Siapkan Larutan Standar" icon={Beaker}>
              Gunakan larutan buffer standar {device.standardOptions.join(" / ")} {device.standardUnit}. Jaga suhu larutan sesuai spesifikasi sensor.
            </Step>
            <Step num="2" title="Rendam Probe" icon={Pipette}>
              Bilas probe dengan aquades, lalu rendam ke larutan standar yang dipilih. Tunggu pembacaan stabil (± 1–2 menit).
            </Step>
            <Step num="3" title="Input Pembacaan" icon={Timer}>
              Catat nilai yang tampil pada sensor dan masukkan ke form di sebelah kanan. Sistem menghitung offset terhadap nilai standar.
            </Step>
            <Step num="4" title="Simpan ke Kontroler" icon={CheckSquare}>
              Simpan hasil kalibrasi — offset baru langsung dipakai kontroler untuk mengoreksi pembacaan {label} sehari-hari.
            </Step>
          </div>

          <div className="mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
            <b>Catatan:</b> {device.method === "two"
              ? `Untuk kalibrasi 2 titik, ulangi prosedur ini dengan larutan standar kedua (${device.standardOptions.filter((s) => s !== standard).join(" / ")}).`
              : "Kalibrasi satu titik cukup untuk penyesuaian offset rutin."}
          </div>
        </div>
      </div>

      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm ring-1 ring-blue-50">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Input Data Kalibrasi</div>

          <Label className="text-slate-800 font-bold mb-2">Larutan Standar ({device.standardUnit})</Label>
          <div className="flex flex-wrap gap-2 mb-4">
            {device.standardOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setStandard(opt)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-bold font-mono transition-colors ${
                  standard === opt ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>

          <Label className="text-slate-800 font-bold mb-1">Pembacaan Sensor pada Standar ({device.measuredUnit})</Label>
          <Input
            value={measured}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "" || /^-?\d*\.?\d*$/.test(val)) setMeasured(val);
            }}
            placeholder={`Nilai tampil di sensor ${label}`}
            unit={device.measuredUnit}
            className="font-mono text-sm bg-slate-50"
          />

          <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <Gauge className="h-3.5 w-3.5" /> Offset (live)
              </span>
              <span className="font-mono font-bold text-blue-600 text-lg">
                {offset !== null ? (offset > 0 ? "+" : "") + offset.toFixed(2) : "—"} <span className="text-xs text-slate-400">{device.measuredUnit}</span>
              </span>
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              Pembacaan saat ini: <b className="text-slate-600 font-mono">{device.reading} {device.measuredUnit}</b> — offset = standar − pembacaan sensor.
            </div>
          </div>

          <Button
            className="w-full mt-4 py-5 text-[14px] font-bold bg-blue-600 hover:bg-blue-700 shadow-md"
            onClick={() => setConfirmOpen(true)}
            disabled={offset === null}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" /> SIMPAN KALIBRASI {label}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { if (!calibrating) setConfirmOpen(false); }}
        onConfirm={handleSaveData}
        title={`Konfirmasi Kalibrasi ${shortName(device)}`}
        message={
          <div className="space-y-3">
            <p>Offset kalibrasi akan disimpan ke kontroler dan langsung mengoreksi pembacaan {label}.</p>
            <div className="bg-slate-100 p-3 rounded-xl grid grid-cols-3 gap-2 text-sm font-mono text-center">
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Standar</div>
                <div className="font-bold text-emerald-600">{standard}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Pembacaan</div>
                <div className="font-bold text-slate-700">{measured}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Offset</div>
                <div className="font-bold text-blue-600">{offset !== null ? (offset > 0 ? "+" : "") + offset.toFixed(2) : "—"}</div>
              </div>
            </div>
          </div>
        }
        confirmLabel={calibrating ? "Menyimpan ke Kontroler..." : "Ya, Simpan Kalibrasi"}
      />
    </div>
  );
}

function Step({ num, title, icon: Icon, children }: { num: string, title: string, icon: any, children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex flex-col items-center">
        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
          {num}
        </div>
        {num !== "4" && <div className="w-[2px] h-full bg-blue-50 mt-1 min-h-[25px]" />}
      </div>
      <div className="pb-2">
        <h4 className="font-bold text-slate-800 flex items-center gap-1.5 text-[13px] mb-0.5">
          <Icon className="h-3.5 w-3.5 text-slate-400" /> {title}
        </h4>
        <p className="text-slate-600 text-xs leading-relaxed">
          {children}
        </p>
      </div>
    </div>
  );
}

function HistoryTab({ history, deviceName }: { history: any[]; deviceName: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
      {history.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-slate-400 text-sm">
          <History className="h-8 w-8 mb-2 opacity-30" />
          Belum ada riwayat kalibrasi untuk <b className="text-slate-500">{deviceName}</b>.
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3.5 font-bold">Waktu Eksekusi</th>
              <th className="px-4 py-3.5 font-bold">Tipe Input</th>
              <th className="px-4 py-3.5 font-bold">Sebelum</th>
              <th className="px-4 py-3.5 font-bold">Sesudah (Target)</th>
              <th className="px-4 py-3.5 font-bold">Status ESP32</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {history.map((h) => (
              <tr key={h.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-4 text-slate-700 font-medium">{h.dateTime}</td>
                <td className="px-4 py-4 text-slate-500">{h.type}</td>
                <td className="px-4 py-4 text-slate-500 font-mono">{h.before}</td>
                <td className="px-4 py-4 font-bold text-slate-900 font-mono">{h.after}</td>
                <td className="px-4 py-4">
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold px-2 py-1 rounded-md ${h.result === "Success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                    {h.result === "Success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                    {h.result === "Success" ? "Berhasil" : "Gagal"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RtcClockCalibrationCard() {
  const toast = useToast();
  const rtcClock = useDeviceClock();
  const [gadgetTime, setGadgetTime] = useState(() => new Date());
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setGadgetTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const driftSeconds = Math.round((gadgetTime.getTime() - rtcClock.date.getTime()) / 1000);
  const isAligned = Math.abs(driftSeconds) <= 2;

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await deviceClock.pushGadgetTimeToDevice();
      if (res.success) {
        toast(res.message, "success");
      } else {
        toast(res.message, "error");
      }
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const gadgetTimeStr = gadgetTime.toLocaleTimeString("id-ID", { hour12: false });
  const gadgetDateStr = gadgetTime.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";

  return (
    <SectionCard
      title="Sinkronisasi Jam Hardware RTC (DS3231)"
      icon={Clock}
      iconTone="green"
      className="mb-6 shadow-sm border border-slate-100"
      action={
        <Button
          variant="primary"
          onClick={handleSync}
          disabled={isSyncing}
          className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-sm text-xs font-semibold py-2 px-3.5"
        >
          <RefreshCcw className={`h-3.5 w-3.5 mr-1.5 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Menginjeksi ke RTC..." : "Sinkronkan dengan Jam Gadget"}
        </Button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Gadget Time */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Laptop className="h-4 w-4 text-blue-500" /> Waktu Gadget (Browser)
            </span>
            <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
              Acuan Dunia
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 font-mono mt-2">
            {gadgetTimeStr}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500 border-t border-slate-200/60 pt-1.5">
            <span>{gadgetDateStr}</span>
            <span className="text-[11px] font-medium text-slate-600">{timezoneName}</span>
          </div>
        </div>

        {/* Controller RTC Time */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <Cpu className="h-4 w-4 text-emerald-600" /> Waktu RTC Controller (ESP32)
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
              rtcClock.isSynced ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
            }`}>
              {rtcClock.isSynced ? "DS3231 Aktif" : "Belum Sinkron"}
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-slate-900 font-mono mt-2">
            {rtcClock.timeStr}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500 border-t border-slate-200/60 pt-1.5">
            <span>{rtcClock.dateStr}</span>
            <span className="text-[11px] font-medium text-slate-600">Otoritas Jadwal</span>
          </div>
        </div>

        {/* Drift Status & Explanation */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 flex flex-col justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium mb-1">Status Deviasi Waktu</div>
            <div className="mt-1 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${
                isAligned
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}>
                {isAligned ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" /> Selaras (deviasi &le; 2 dtk)
                  </>
                ) : (
                  <>
                    Selisih {Math.abs(driftSeconds)} dtk ({driftSeconds > 0 ? "RTC tertinggal" : "RTC mendahului"})
                  </>
                )}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            Menyuntikkan waktu gadget saat ini langsung ke IC hardware DS3231 via I2C agar fertigation, logging telemetri microSD, dan chart 24 jam tetap akurat.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
