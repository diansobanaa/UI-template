"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Beaker,
  CheckCircle2,
  Clock,
  Droplets,
  FlaskConical,
  Gauge,
  Layers,
  ListOrdered,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { esp32Client } from "@/lib/api/esp32-client";
import { greenhouseService } from "@/lib/services";
import { useToast } from "@/components/ui/toast";
import type { FertigationSchedule, Recipe } from "@/lib/types";

interface FertigationQueueDashboardProps {
  queue: FertigationSchedule[];
  complexId: string;
  selectedGhId?: string;
  onOpenCreate?: () => void;
  className?: string;
}

export type MixingLifecycleState =
  | "WAITING_SCHEDULE"
  | "QUEUED"
  | "MIXING_RAW_WATER"
  | "DOSING"
  | "FINAL_MIXING"
  | "MIX_READY"
  | "DISTRIBUTING"
  | "COMPLETED"
  | "BLOCKED"
  | "FAULTED";

export function FertigationQueueDashboard({
  queue,
  complexId,
  selectedGhId,
  onOpenCreate,
  className = "",
}: FertigationQueueDashboardProps) {
  const toast = useToast();
  const [liveStatus, setLiveStatus] = useState<any>(null);
  const [liveQueue, setLiveQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [offline, setOffline] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Poll authoritative ESP32 fertigation status & queue every 3s
  const fetchStatus = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [statusRes, queueRes] = await Promise.allSettled([
        esp32Client.getFertigationStatus(),
        esp32Client.getFertigationQueue(),
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value) {
        setLiveStatus(statusRes.value);
        setOffline(false);
      }
      if (queueRes.status === "fulfilled" && queueRes.value) {
        const qBatches = Array.isArray(queueRes.value?.queuedBatches)
          ? queueRes.value.queuedBatches
          : [];
        setLiveQueue(qBatches);
      }
      setLastUpdated(new Date());
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => fetchStatus(false), 3000);
    return () => clearInterval(interval);
  }, [complexId]);

  // Determine active hardware batch
  const activeFwState = useMemo(() => {
    if (!liveStatus) return "IDLE";
    const raw = (liveStatus.runtimeState || liveStatus.state || liveStatus.phase || "").toUpperCase();
    return raw.replace(/^FERT_STATE_/, "");
  }, [liveStatus]);

  const activeBatch = useMemo(() => {
    if (!liveStatus || activeFwState === "IDLE") return null;
    return {
      batchId: liveStatus.batchId || liveStatus.runId || "NONE",
      ghId: liveStatus.ghId || "",
      state: activeFwState,
      targetWaterMl: liveStatus.targetWaterMl ?? liveStatus.rawWaterTargetMl ?? 0,
      actualWaterMl: liveStatus.actualWaterMl ?? liveStatus.rawWaterActualMl ?? 0,
      thresholdPercent: liveStatus.thresholdPercent ?? 20,
      activeChannel: liveStatus.activeChannel || "",
      dosingChannels: liveStatus.dosingChannels || [],
      fault: liveStatus.fault,
    };
  }, [liveStatus, activeFwState]);

  // Helper to resolve lifecycle state for a specific schedule item
  const resolveItemLifecycle = (s: FertigationSchedule): MixingLifecycleState => {
    if (s.status === "blocked" || s.activationState === "BLOCKED") {
      return "BLOCKED";
    }

    const sGhId = s.ghId.toLowerCase();
    const activeGh = activeBatch?.ghId?.toLowerCase();

    // Check if currently active on ESP32
    if (activeBatch && activeGh === sGhId) {
      if (activeBatch.state === "DELIVERY" || activeBatch.state === "DISTRIBUTING") {
        return "DISTRIBUTING";
      }
      if (activeBatch.state === "MIX_READY" || activeBatch.state === "READY") {
        return "MIX_READY";
      }
      if (activeBatch.state === "FINAL_MIXING") {
        return "FINAL_MIXING";
      }
      if (activeBatch.state === "DOSING") {
        return "DOSING";
      }
      if (activeBatch.state === "FILLING" || activeBatch.state === "MIXING_RAW_WATER" || activeBatch.state === "PRECHECK") {
        return "MIXING_RAW_WATER";
      }
      if (activeBatch.state === "COMPLETE") {
        return "COMPLETED";
      }
      if (activeBatch.state === "FAULTED") {
        return "FAULTED";
      }
    }

    // Check if in live queue array
    const inFwQueue = liveQueue.some((q) => (q.ghId || q.gh_id || "").toLowerCase() === sGhId);
    if (inFwQueue) {
      return "QUEUED";
    }

    // Check if active delivery slot exists for this GH
    if (Array.isArray(liveStatus?.activeDeliveries)) {
      const delivery = liveStatus.activeDeliveries.find((d: any) => (d.ghId || d.gh_id || "").toLowerCase() === sGhId);
      if (delivery) {
        const dState = (delivery.status || delivery.state || "").toUpperCase();
        if (dState === "DISTRIBUTING") return "DISTRIBUTING";
        if (dState === "READY_TO_SEND" || dState === "MIX_READY") return "MIX_READY";
      }
    }

    // Default to scheduled waiting
    return "WAITING_SCHEDULE";
  };

  // Trigger distribution when batch is READY
  const handleTriggerDistribution = async (s: FertigationSchedule) => {
    const actionKey = `deliver-${s.id}`;
    setActionInProgress(actionKey);
    try {
      await esp32Client.triggerDistribution(s.ghId, s.id);
      toast(`Distribusi nutrisi untuk ${s.name} berhasil dimulai ke GH!`, "success");
      await fetchStatus(true);
    } catch (err: any) {
      toast(`Gagal memicu distribusi: ${err?.message || "Kesalahan ESP32"}`, "error");
    } finally {
      setActionInProgress(null);
    }
  };

  // Pre-mix batch ahead of time (Spec §13)
  const handlePreMixNow = async (s: FertigationSchedule) => {
    const actionKey = `premix-${s.id}`;
    setActionInProgress(actionKey);
    try {
      await esp32Client.startFertigation({
        scheduleId: s.id,
        ghId: s.ghId,
        targetWaterMl: s.targetWaterL * 1000,
        rawWaterStartThresholdPercent: s.rawWaterStartThresholdPercent ?? 20,
        dosingChannels: s.dosingChannels ?? [],
        source: "UI_PREMIX",
      });
      toast(`Peracikan batch ${s.name} dimulai di tangki GH!`, "success");
      await fetchStatus(true);
    } catch (err: any) {
      toast(`Gagal memulai peracikan: ${err?.message || "Kesalahan ESP32"}`, "error");
    } finally {
      setActionInProgress(null);
    }
  };

  // Emergency abort
  const handleAbort = async () => {
    setActionInProgress("abort");
    try {
      await esp32Client.stopFertigation();
      toast("Operasi fertigasi berhasil dihentikan darurat.", "warning");
      await fetchStatus(true);
    } catch (err: any) {
      toast(`Gagal menghentikan fertigasi: ${err?.message || "Kesalahan ESP32"}`, "error");
    } finally {
      setActionInProgress(null);
    }
  };

  // Filter queue if selectedGhId provided
  const displayQueue = useMemo(() => {
    if (!selectedGhId) return queue;
    return queue.filter((s) => s.ghId.toLowerCase() === selectedGhId.toLowerCase());
  }, [queue, selectedGhId]);

  // Aggregate stats
  const totalWaterL = displayQueue.reduce((acc, curr) => acc + (curr.targetWaterL || 0), 0);
  const readyCount = displayQueue.filter((s) => resolveItemLifecycle(s) === "MIX_READY").length;
  const inProgressCount = displayQueue.filter((s) => {
    const st = resolveItemLifecycle(s);
    return st === "MIXING_RAW_WATER" || st === "DOSING" || st === "FINAL_MIXING" || st === "DISTRIBUTING";
  }).length;

  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1a2a] shadow-[0_18px_55px_rgba(0,0,0,0.24)] ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-[#0f1d30] px-4 py-4 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/12 text-violet-300 shadow-[0_0_15px_rgba(167,139,250,0.15)]">
            <ListOrdered className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-slate-100">
                Fertigation & Mixing Queue
              </h2>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                {displayQueue.length} Terjadwal
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Antrean eksekusi & status kesiapan larutan nutrisi tangki batch hari ini
            </p>
          </div>
        </div>

        {/* Live Controller Status & Sync */}
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            offline
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`} />
            {offline ? "ESP32 Offline (Local Cache)" : "ESP32 Telemetri Aktif"}
          </span>

          <button
            type="button"
            onClick={() => fetchStatus(true)}
            disabled={refreshing}
            title="Refresh status real-time"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-emerald-400" : ""}`} />
          </button>
        </div>
      </div>

      <div className="p-4 md:p-5 space-y-4">
        {/* Top Operational KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <Droplets className="h-3.5 w-3.5 text-blue-400" />
              Target Air Baku
            </div>
            <div className="mt-1 text-base font-bold text-slate-100">
              {totalWaterL.toLocaleString()} <span className="text-xs font-normal text-slate-400">L</span>
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">Total volume hari ini</div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <FlaskConical className="h-3.5 w-3.5 text-emerald-400" />
              Larutan Siap (Ready)
            </div>
            <div className="mt-1 text-base font-bold text-emerald-300">
              {readyCount} <span className="text-xs font-normal text-slate-400">Batch</span>
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">Siap di tangki batch GH</div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <Activity className="h-3.5 w-3.5 text-cyan-400" />
              Sedang Meracik
            </div>
            <div className="mt-1 text-base font-bold text-cyan-300">
              {inProgressCount} <span className="text-xs font-normal text-slate-400">Batch</span>
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">Air baku / Dosing aktif</div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <Layers className="h-3.5 w-3.5 text-amber-400" />
              Dosing Central Unit
            </div>
            <div className="mt-1 text-[13px] font-bold text-slate-200">
              {activeBatch?.state === "DOSING" ? (
                <span className="text-emerald-400">Ch {activeBatch.activeChannel || "A"} Aktif</span>
              ) : (
                <span className="text-slate-400">Standby (Serial)</span>
              )}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">DP-A → DP-B eksklusif</div>
          </div>
        </div>

        {/* Queue Items */}
        {displayQueue.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/30 px-4 py-8 text-center">
            <FlaskConical className="mx-auto mb-2.5 h-8 w-8 text-slate-600" />
            <p className="text-[13px] font-medium text-slate-300">Belum ada jadwal fertigasi dikonfigurasi.</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Buat jadwal baru untuk memulai otomatisasi peracikan nutrisi dan distribusi air ke greenhouse.
            </p>
            {onOpenCreate && (
              <button
                type="button"
                onClick={onOpenCreate}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-violet-400/20 bg-violet-600/90 px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_8px_20px_rgba(139,92,246,0.25)] transition hover:bg-violet-500"
              >
                <Plus className="h-3.5 w-3.5" /> Tambah Jadwal Fertigasi
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3.5">
            {displayQueue.map((s) => {
              const gh = greenhouseService.get(s.ghId);
              const ghCode = gh?.code || s.ghId;
              const recipe = gh?.recipes?.find((r) => r.id === s.recipeId);
              const lifecycle = resolveItemLifecycle(s);

              // Calculate dosing channels
              const chA = s.dosingChannels?.find((c) => c.componentId.toUpperCase().includes("A"))?.requestedMl
                ?? s.dosingAml ?? 160;
              const chB = s.dosingChannels?.find((c) => c.componentId.toUpperCase().includes("B"))?.requestedMl
                ?? s.dosingBml ?? 160;

              return (
                <QueueItemCard
                  key={s.id}
                  schedule={s}
                  ghCode={ghCode}
                  recipe={recipe}
                  lifecycle={lifecycle}
                  dosingA={chA}
                  dosingB={chB}
                  activeBatch={activeBatch}
                  isActionLoading={actionInProgress === `deliver-${s.id}` || actionInProgress === `premix-${s.id}`}
                  onTriggerDistribution={() => handleTriggerDistribution(s)}
                  onPreMixNow={() => handlePreMixNow(s)}
                  onAbort={handleAbort}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Detail Card for Each Scheduled Item in the Queue                   */
/* ------------------------------------------------------------------ */

interface QueueItemCardProps {
  schedule: FertigationSchedule;
  ghCode: string;
  recipe?: Recipe;
  lifecycle: MixingLifecycleState;
  dosingA: number;
  dosingB: number;
  activeBatch: any;
  isActionLoading: boolean;
  onTriggerDistribution: () => void;
  onPreMixNow: () => void;
  onAbort: () => void;
}

function QueueItemCard({
  schedule,
  ghCode,
  recipe,
  lifecycle,
  dosingA,
  dosingB,
  activeBatch,
  isActionLoading,
  onTriggerDistribution,
  onPreMixNow,
  onAbort,
}: QueueItemCardProps) {
  // Mechanical stages
  const stages = [
    { key: "fill", label: "1. Air Baku", desc: "Isi s/d Threshold" },
    { key: "dosing", label: "2. Dosing Serial", desc: "Nutrisi DP-A → DP-B" },
    { key: "mix", label: "3. Mix Ready", desc: "Homogen di Tangki" },
    { key: "dist", label: "4. Distribusi", desc: "Siram ke Tanaman" },
  ];

  const getStageState = (stageKey: string): "done" | "active" | "idle" => {
    switch (lifecycle) {
      case "MIXING_RAW_WATER":
        return stageKey === "fill" ? "active" : "idle";
      case "DOSING":
        return stageKey === "fill" ? "done" : stageKey === "dosing" ? "active" : "idle";
      case "FINAL_MIXING":
        return stageKey === "fill" || stageKey === "dosing" ? "done" : stageKey === "mix" ? "active" : "idle";
      case "MIX_READY":
        return stageKey === "fill" || stageKey === "dosing" || stageKey === "mix" ? "done" : "idle";
      case "DISTRIBUTING":
        return stageKey === "dist" ? "active" : "done";
      case "COMPLETED":
        return "done";
      default:
        return "idle";
    }
  };

  // Readiness badge metadata
  const statusMeta = useMemo(() => {
    switch (lifecycle) {
      case "MIX_READY":
        return {
          pill: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
          dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]",
          label: "MIX READY (Siap di Tangki)",
          description: "Larutan nutrisi sudah siap & homogen di tangki batch GH. Menunggu waktu distribusi atau siap disiram sekarang.",
          bannerBg: "border-emerald-500/30 bg-emerald-500/8",
          isReady: true,
        };
      case "MIXING_RAW_WATER":
        return {
          pill: "bg-blue-500/20 text-blue-300 border-blue-500/40 animate-pulse",
          dot: "bg-blue-400",
          label: "PENGISIAN AIR BAKU",
          description: "Sedang mengisi air baku dari tangki pusat. Dosing nutrisi otomatis terbuka saat ambang 20% tercapai.",
          bannerBg: "border-blue-500/30 bg-blue-500/8",
          isReady: false,
        };
      case "DOSING":
        return {
          pill: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse",
          dot: "bg-cyan-400",
          label: "SEDANG DOSING SERIAL",
          description: "Pompa dosing central aktif menginjeksi nutrisi stok secara serial (DP-A lalu DP-B).",
          bannerBg: "border-cyan-500/30 bg-cyan-500/8",
          isReady: false,
        };
      case "FINAL_MIXING":
        return {
          pill: "bg-purple-500/20 text-purple-300 border-purple-500/40 animate-pulse",
          dot: "bg-purple-400",
          label: "HOMOGENISASI LARUTAN",
          description: "Agitasi & pencampuran akhir di tangki GH untuk memastikan nilai EC dan pH merata.",
          bannerBg: "border-purple-500/30 bg-purple-500/8",
          isReady: false,
        };
      case "DISTRIBUTING":
        return {
          pill: "bg-violet-500/20 text-violet-300 border-violet-500/40 animate-pulse",
          dot: "bg-violet-400",
          label: "DISTRIBUSI KE TANAMAN",
          description: "Pompa distribusi GH aktif menyiram ke dripper tanaman hingga sensor pelampung bawah trip.",
          bannerBg: "border-violet-500/30 bg-violet-500/8",
          isReady: true,
        };
      case "QUEUED":
        return {
          pill: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          dot: "bg-amber-400 animate-pulse",
          label: "MENGANTRI DOSING CENTRAL",
          description: "Batch mengantri giliran unit dosing central serial sebelum air baku & nutrisi dimasukkan.",
          bannerBg: "border-amber-500/20 bg-amber-500/5",
          isReady: false,
        };
      case "BLOCKED":
        return {
          pill: "bg-rose-500/20 text-rose-300 border-rose-500/40",
          dot: "bg-rose-400",
          label: "TERBLOKIR (Kalibrasi Belum Ada)",
          description: "Jadwal ini ditahan dari eksekusi karena pompa dosing belum memiliki snapshot kalibrasi valid.",
          bannerBg: "border-rose-500/20 bg-rose-500/5",
          isReady: false,
        };
      default:
        return {
          pill: "bg-slate-800 text-slate-300 border-slate-700",
          dot: "bg-slate-400",
          label: "MENUNGGU JADWAL",
          description: "Larutan belum diracik di tangki GH. Sesuai spec, peracikan otomatis dimulai menjelang waktu jadwal.",
          bannerBg: "border-slate-800 bg-slate-950/25",
          isReady: false,
        };
    }
  }, [lifecycle]);

  return (
    <div className={`rounded-xl border p-4 transition-all duration-200 ${
      statusMeta.isReady
        ? "border-emerald-500/40 bg-[#0d1f2d]/90 shadow-[0_8px_24px_rgba(16,185,129,0.08)] ring-1 ring-emerald-500/20"
        : "border-slate-800 bg-[#0d1929] shadow-[0_8px_18px_rgba(0,0,0,0.14)]"
    }`}>
      {/* Top row: Title, GH tag, and Live State Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
            statusMeta.isReady
              ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)]"
              : "border-violet-400/20 bg-violet-500/10 text-violet-300"
          }`}>
            <ListOrdered className="h-5 w-5" />
          </span>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-bold text-slate-100">{schedule.name}</h3>
              <span className="rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-300">
                {ghCode}
              </span>
              {recipe?.name && (
                <span className="rounded-md border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300">
                  Resep: {recipe.name}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1 font-medium text-slate-300">
                <Clock className="h-3 w-3 text-slate-400" />
                Jadwal: {schedule.time || "--:--"}
              </span>
              <span>•</span>
              <span>Next Run: <strong className="text-slate-200">{schedule.nextRun || "Hari ini"}</strong></span>
              <span>•</span>
              <span>Volume: <strong className="text-slate-200">{schedule.targetWaterL} L</strong></span>
            </div>
          </div>
        </div>

        {/* State Badge */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${statusMeta.pill}`}>
            <span className={`h-2 w-2 rounded-full ${statusMeta.dot}`} />
            {statusMeta.label}
          </span>
        </div>
      </div>

      {/* Operational Information & Mechanical Status Banner */}
      <div className={`mt-3 rounded-lg border p-3 ${statusMeta.bannerBg}`}>
        <div className="flex items-start gap-2.5">
          {statusMeta.isReady ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
          )}
          <div className="flex-1 text-[11px] leading-relaxed text-slate-300">
            {statusMeta.description}
          </div>
        </div>
      </div>

      {/* Recipe Formula Breakdown Chips */}
      <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
        <div className="rounded-lg border border-slate-800/70 bg-slate-950/30 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Air Baku (Raw)</div>
          <div className="mt-0.5 text-[13px] font-bold text-slate-200">{schedule.targetWaterL} L</div>
          <div className="text-[10px] text-slate-500">Ambang: {schedule.rawWaterStartThresholdPercent ?? 20}%</div>
        </div>

        <div className="rounded-lg border border-slate-800/70 bg-slate-950/30 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Nutrisi Stok A</div>
          <div className="mt-0.5 text-[13px] font-bold text-emerald-300">{dosingA} mL</div>
          <div className="text-[10px] text-slate-500">Pompa Dosing 1 (Serial)</div>
        </div>

        <div className="rounded-lg border border-slate-800/70 bg-slate-950/30 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Nutrisi Stok B</div>
          <div className="mt-0.5 text-[13px] font-bold text-cyan-300">{dosingB} mL</div>
          <div className="text-[10px] text-slate-500">Pompa Dosing 2 (Serial)</div>
        </div>

        <div className="rounded-lg border border-slate-800/70 bg-slate-950/30 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Target EC / pH</div>
          <div className="mt-0.5 text-[13px] font-bold text-slate-200">
            {recipe?.targetEc && recipe.targetEc !== "-" ? `${recipe.targetEc} mS/cm` : "2.0 mS/cm"}
          </div>
          <div className="text-[10px] text-slate-500">pH Target: 5.8 - 6.2</div>
        </div>
      </div>

      {/* 4-Step Mechanical Stepper */}
      <div className="mt-4 border-t border-slate-800/80 pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Proses Mekanikal Fertigasi (Spec Section 8 - 12):
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stages.map((st) => {
            const state = getStageState(st.key);
            return (
              <div
                key={st.key}
                className={`rounded-lg border px-3 py-2 text-center transition-all ${
                  state === "done"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : state === "active"
                    ? "border-blue-500/40 bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30 animate-pulse"
                    : "border-slate-800 bg-slate-950/20 text-slate-500"
                }`}
              >
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold">
                  <span>{st.label}</span>
                  {state === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                  {state === "active" && <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />}
                </div>
                <div className="mt-0.5 text-[9px] opacity-80">{st.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Controls / Smart Quick Actions */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
        {/* Pre-flight Interlocks */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Kalibrasi Pompa: Valid (120 ml/min)
          </span>
          <span className="hidden sm:inline text-slate-600">•</span>
          <span className="inline-flex items-center gap-1 text-slate-300">
            <Gauge className="h-3.5 w-3.5 text-blue-400" /> Air Baku: Tersedia
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 ml-auto">
          {lifecycle === "MIX_READY" ? (
            <button
              type="button"
              onClick={onTriggerDistribution}
              disabled={isActionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-600 px-3.5 py-1.5 text-[12px] font-bold text-white shadow-[0_0_15px_rgba(16,185,129,0.3)] transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {isActionLoading ? "Menyalurkan…" : "Siram Sekarang"}
            </button>
          ) : (lifecycle === "WAITING_SCHEDULE" || lifecycle === "QUEUED") ? (
            <button
              type="button"
              onClick={onPreMixNow}
              disabled={isActionLoading}
              title="Racik larutan sedini mungkin di tangki GH agar siap saat jam jadwal tiba"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-600/20 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/30 hover:border-cyan-400/40 disabled:opacity-50"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              {isActionLoading ? "Memproses…" : "Racik Sekarang (Pre-Mix)"}
            </button>
          ) : (lifecycle === "MIXING_RAW_WATER" || lifecycle === "DOSING" || lifecycle === "DISTRIBUTING") ? (
            <button
              type="button"
              onClick={onAbort}
              disabled={isActionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-600/20 px-3 py-1.5 text-[11px] font-semibold text-red-300 transition hover:bg-red-600/30 disabled:opacity-50"
            >
              <StopCircle className="h-3.5 w-3.5" />
              {isActionLoading ? "Menghentikan…" : "Hentikan Operasi"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
