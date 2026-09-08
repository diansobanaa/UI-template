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

const FILTERS = [
  { id: "all", label: "Semua Perangkat" },
  { id: "sensors", label: "Sensor (pH/EC)" },
  { id: "dosing-pumps", label: "Pompa Dosing" },
];

/** Sampling protocol: each RUN click runs the pump for 10s, max 3 clicks = 30s total. */
const RUN_SECONDS_PER_CLICK = 10;
const MAX_SAMPLING_CLICKS = 3;

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
  const complexId = params.get("complex") ?? complexes[0].id;
  const complex = complexes.find((c) => c.id === complexId) ?? complexes[0];
  const ghs = greenhouseService.byComplex(complex.id);
  const ghId = params.get("gh") ?? ghs[0]?.id ?? "";
  const gh = greenhouseService.get(ghId) ?? ghs[0];
  const realtimeState = complexRealtimeState(complex, ghs);

  const [category, setCategory] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"calibrate" | "history">("calibrate");
  /** Single source of truth for a running pump — the header E-Stop and the wizard share it. */
  const [run, setRun] = useState<{ deviceId: string; secondsLeft: number } | null>(null);

  useDbVersion();

  const devices = calibrationService
    .devicesForCategory(category)
    .filter((d) => d.ghId === null || d.ghId === gh?.id);
  // No silent fallback to devices[0] — the panel stays empty until the user picks a device.
  const device = devices.find((d) => d.id === selectedDeviceId) ?? null;
  const history = calibrationService.history();

  useEffect(() => {
    if (!run) return;
    const timer = setInterval(() => {
      setRun((prev) => {
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

  const deviceHistory = device ? history.filter((h) => h.device === shortName(device)) : [];

  return (
    <AppShell complexId={complex.id}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
        <div className="flex flex-wrap gap-4">
          <ComplexSwitcher complexId={complex.id} complexes={complexes} />
          <GreenhouseSwitcher complexId={complex.id} greenhouses={ghs} ghId={gh?.id ?? ""} onChange={setGh} label="Lokasi" />
          <LiveStatus state={realtimeState} label="Hardware Link" />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => toast("Permintaan sinkronisasi dikirim ke ESP32", "info")}>
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
        <StatusBadges devices={calibrationService.devices()} />
      </div>

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
              </div>

              <div className="flex-1 overflow-y-auto scroll-thin p-6 bg-slate-50/50">
                {activeTab === "calibrate" && device.category === "dosing-pump" && (
                  <DosingPumpCalibrationWizard
                    key={device.id}
                    device={device}
                    run={run && run.deviceId === device.id ? run : null}
                    onStart={(seconds) => setRun({ deviceId: device.id, secondsLeft: seconds })}
                    onStop={() => setRun(null)}
                  />
                )}
                {activeTab === "calibrate" && (device.category === "ph" || device.category === "ec") && (
                  <SensorCalibrationWizard key={device.id} device={device} />
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
}: {
  device: CalibrationDevice;
  run: { deviceId: string; secondsLeft: number } | null;
  onStart: (seconds: number) => void;
  onStop: () => void;
}) {
  const [volume, setVolume] = useState("");
  const [clicks, setClicks] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const toast = useToast();

  const channel = pumpChannel(device);
  const samplingSeconds = clicks * RUN_SECONDS_PER_CLICK;
  const prevRate = parseFloat(device.reading) || 0;
  const volumeNum = parseFloat(volume) || 0;
  const flowRate = samplingSeconds > 0 ? (volumeNum / samplingSeconds) * 60 : 0;
  const deviationPct = prevRate > 0 && flowRate > 0 ? ((flowRate - prevRate) / prevRate) * 100 : null;
  const samplingComplete = clicks >= MAX_SAMPLING_CLICKS;

  const handleRunPump = () => {
    if (clicks >= MAX_SAMPLING_CLICKS) {
      toast(`Sampling Pompa ${channel} sudah mencapai durasi maksimal (${MAX_SAMPLING_CLICKS * RUN_SECONDS_PER_CLICK} detik).`, "info");
      return;
    }
    setClicks((prev) => prev + 1);
    onStart(RUN_SECONDS_PER_CLICK);
    toast(`Pompa Dosing ${channel} diaktifkan selama ${RUN_SECONDS_PER_CLICK} detik.`, "info");
  };

  const handleSaveData = async () => {
    setCalibrating(true);
    try {
      await calibrationService.startCalibration(device, `${prevRate} ml/min`, `${flowRate.toFixed(1)} ml/min`);
      toast(`Flow Rate Pompa ${channel} (${flowRate.toFixed(1)} ml/min) berhasil disimpan ke kontroler.`, "success");
      setConfirmOpen(false);
      setVolume("");
      setClicks(0);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

      {/* KIRI: Panduan (SOP) */}
      <div className="lg:col-span-7 space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
            <Info className="h-5 w-5 text-blue-500" />
            <h3 className="font-bold text-slate-800 text-base">Panduan Kalibrasi Volumetrik — Pompa {channel}</h3>
          </div>

          <div className="space-y-4 text-[13.5px]">
            <Step num="1" title="Pemisahan Selang Output" icon={Beaker}>
              Arahkan selang output pompa {channel} ke wadah/gelas ukur terpisah untuk menghindari pengendapan CaSO₄ di tandon utama.
            </Step>
            <Step num="2" title="Proses Sampling (30 Detik)" icon={Timer}>
              Klik tombol <b>[RUN POMPA {channel}]</b> sebanyak 3 kali (masing-masing {RUN_SECONDS_PER_CLICK} detik, total {MAX_SAMPLING_CLICKS * RUN_SECONDS_PER_CLICK} detik sampling).
            </Step>
            <Step num="3" title="Pengukuran Volume Riil" icon={Pipette}>
              Ukur total cairan hasil sampling dalam mililiter (ml), lalu masukkan ke form input di sebelah kanan.
            </Step>
            <Step num="4" title="Kalkulasi & Penyimpanan" icon={CheckSquare}>
              Sistem menghitung Flow Rate (ml/menit) otomatis beserta deviasinya terhadap nilai terkalibrasi sebelumnya, lalu menyimpannya ke kontroler.
            </Step>
          </div>

          <div className="mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
            <b>Catatan Penting:</b> Kontroler memakai flow rate ini untuk menghitung durasi buka pompa secara presisi (contoh: kebutuhan 100 ml ÷ debit riil = durasi eksekusi).
          </div>
        </div>
      </div>

      {/* KANAN: Kontrol pompa + input data */}
      <div className="lg:col-span-5 space-y-4">

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-md text-white relative">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Kontrol Pompa {channel}</span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${run ? "bg-emerald-500 text-white animate-pulse" : "bg-slate-800 text-slate-400"}`}>
              {run ? `POMPA ${channel} ON (${run.secondsLeft}s)` : "STATUS: OFF"}
            </span>
          </div>

          <Button
            onClick={handleRunPump}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-3"
            disabled={run !== null || clicks >= MAX_SAMPLING_CLICKS}
          >
            <PlayCircle className="h-4 w-4 mr-1" /> RUN POMPA {channel} ({clicks}/{MAX_SAMPLING_CLICKS})
          </Button>
          <div className="text-[10px] text-slate-400 text-center mt-1">
            Durasi terkumpul: {samplingSeconds} detik
          </div>

          {run && (
            <Button
              variant="danger"
              onClick={() => {
                onStop();
                toast(`Pompa ${channel} dihentikan seketika.`, "error");
              }}
              className="w-full bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2 mt-2"
            >
              <Square className="h-3.5 w-3.5 mr-1 fill-current" /> STOP SAMPLING
            </Button>
          )}
        </div>

        <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-sm ring-1 ring-blue-50">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Input Data Kalibrasi</div>

          <Label className="text-slate-800 font-bold mb-1">Volume Terukur (ml / {MAX_SAMPLING_CLICKS * RUN_SECONDS_PER_CLICK} detik)</Label>
          <Input
            value={volume}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "" || /^\d*\.?\d*$/.test(val)) setVolume(val);
            }}
            placeholder="Contoh: 120"
            unit="ml"
            className="font-mono text-sm bg-slate-50"
          />

          {/* Live preview: flow rate + deviasi terhadap nilai terkalibrasi sebelumnya */}
          <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <Gauge className="h-3.5 w-3.5" /> Flow Rate (live)
              </span>
              <span className="font-mono font-bold text-blue-600 text-lg">
                {flowRate > 0 ? flowRate.toFixed(1) : "—"} <span className="text-xs text-slate-400">ml/mnt</span>
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Nilai sebelumnya: <b className="text-slate-600 font-mono">{prevRate || "—"} ml/mnt</b></span>
              {deviationPct !== null && (
                <span className={`font-bold px-2 py-0.5 rounded-md ${Math.abs(deviationPct) <= 5 ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50"}`}>
                  Deviasi: {deviationPct > 0 ? "+" : ""}{deviationPct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          {!samplingComplete && volumeNum > 0 && (
            <div className="mt-3 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠️ Sampling belum lengkap ({samplingSeconds}/{MAX_SAMPLING_CLICKS * RUN_SECONDS_PER_CLICK}s). Flow rate dihitung dari durasi sampling yang tersedia — lengkapi sampling untuk hasil akurat.
            </div>
          )}

          <Button
            className="w-full mt-4 py-5 text-[14px] font-bold bg-blue-600 hover:bg-blue-700 shadow-md"
            onClick={() => setConfirmOpen(true)}
            disabled={!volume || samplingSeconds === 0}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" /> SIMPAN (Update Flow Rate)
          </Button>
        </div>

      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { if (!calibrating) setConfirmOpen(false); }}
        onConfirm={handleSaveData}
        title={`Konfirmasi Flow Rate Pompa ${channel}`}
        message={
          <div className="space-y-3">
            <p>Parameter flow rate baru akan disimpan ke kontroler dan langsung dipakai untuk kalkulasi durasi dosis otomatis.</p>
            <div className="bg-slate-100 p-3 rounded-xl grid grid-cols-3 gap-2 text-sm font-mono text-center">
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Volume ({samplingSeconds}s)</div>
                <div className="font-bold text-slate-700">{volume} ml</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Flow Rate Baru</div>
                <div className="font-bold text-blue-600">{flowRate.toFixed(1)} ml/mnt</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Sebelumnya</div>
                <div className="font-bold text-slate-500">{prevRate || "—"} ml/mnt</div>
              </div>
            </div>
            {!samplingComplete && (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ Perhatian: sampling hanya {samplingSeconds} dari {MAX_SAMPLING_CLICKS * RUN_SECONDS_PER_CLICK} detik. Flow rate dihitung proporsional dari durasi yang tersedia.
              </div>
            )}
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

function SensorCalibrationWizard({ device }: { device: CalibrationDevice }) {
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
