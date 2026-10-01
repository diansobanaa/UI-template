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
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { esp32Client } from "@/lib/api/esp32-client";
import { complexService, fertigationService, greenhouseService, scheduleService } from "@/lib/services";
import { useToast } from "@/components/ui/toast";
import type { FertigationSchedule, Greenhouse, Recipe } from "@/lib/types";

import {
  ComplexFertigationOverview,
  type GreenhouseFertigationSummary,
} from "./ComplexFertigationOverview";
import {
  DosingQueueSection,
  type DosingQueueJob,
  type OperationalStep,
} from "./DosingQueueSection";
import {
  GreenhouseMixingTanks,
  type GreenhouseTankInfo,
  type HumanMixingState,
} from "./GreenhouseMixingTanks";
import { GreenhouseFertigationDetail } from "./GreenhouseFertigationDetail";
import { FertigationScheduleManager } from "./FertigationScheduleManager";

interface FertigationQueueDashboardProps {
  queue?: FertigationSchedule[];
  complexId?: string;
  selectedGhId?: string;
  currentGhId?: string;
  onOpenCreate?: () => void;
  className?: string;
}

export function FertigationQueueDashboard({
  queue,
  complexId = "",
  selectedGhId,
  currentGhId,
  onOpenCreate,
  className = "",
}: FertigationQueueDashboardProps) {
  const toast = useToast();
  const effectiveGhId = selectedGhId || currentGhId;
  const effectiveComplexId =
    complexId || (effectiveGhId ? greenhouseService.get(effectiveGhId)?.complexId || "" : "") || complexService.list()[0]?.id || "";

  const [liveStatus, setLiveStatus] = useState<any>(null);
  const [liveQueue, setLiveQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [offline, setOffline] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
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
  }, [effectiveComplexId]);

  // Greenhouses belonging to active complex
  const complex = complexService.get(effectiveComplexId) || complexService.list()[0];
  const ghs = useMemo(() => {
    return complex ? greenhouseService.byComplex(complex.id) : [];
  }, [complex]);

  // All schedules in this complex
  const allSchedules = useMemo(() => {
    return ghs.flatMap((g) => scheduleService.fertigationForGh(g.id));
  }, [ghs]);

  // Active firmware state
  const fwStateRaw = (liveStatus?.runtimeState || liveStatus?.state || liveStatus?.phase || "IDLE").toUpperCase();
  const fwState = fwStateRaw.replace(/^FERT_STATE_/, "");

  // -------------------------------------------------------------------------
  // Construct Active Dosing Queue Job with 5 Real Operational Steps
  // -------------------------------------------------------------------------
  const activeJob: DosingQueueJob | null = useMemo(() => {
    if (!liveStatus || fwState === "IDLE" || fwState === "COMPLETE" || fwState === "FAULTED" || fwState === "ABORTED") {
      return null;
    }

    const targetGhId = liveStatus.ghId || liveStatus.targetGhId || ghs[0]?.id || "";
    const gh = greenhouseService.get(targetGhId);
    const ghCode = gh?.code || gh?.greenhouseTag || targetGhId;

    const schedId = liveStatus.scheduleId || "";
    const sched = allSchedules.find((s) => s.id === schedId);
    const recipe = gh?.recipes?.find((r) => r.id === (sched?.recipeId || liveStatus.recipeId));

    const targetWaterL = (liveStatus.targetWaterMl ? liveStatus.targetWaterMl / 1000 : sched?.targetWaterL) || 50;
    const chA = sched?.dosingAml ?? 150;
    const chB = sched?.dosingBml ?? 150;

    // Define 5 operational steps based on live firmware phase
    const isWaterDone = fwState === "DOSING" || fwState === "FINAL_MIXING" || fwState === "MIX_READY" || fwState === "DELIVERY";
    const isWaterRunning = fwState === "FILLING" || fwState === "PRECHECK";

    const isDosingDone = fwState === "FINAL_MIXING" || fwState === "MIX_READY" || fwState === "DELIVERY";
    const isDosingRunning = fwState === "DOSING";
    const activeChan = (liveStatus.activeChannel || "").toUpperCase();

    const isMixingDone = fwState === "MIX_READY" || fwState === "DELIVERY";
    const isMixingRunning = fwState === "FINAL_MIXING";

    const isPumpDone = fwState === "COMPLETE";
    const isPumpRunning = fwState === "DELIVERY";

    const steps: OperationalStep[] = [
      {
        stepNumber: 1,
        name: "Persiapan Air Baku",
        description: `Pengisian tangki s/d ${targetWaterL} L (Threshold 20%)`,
        status: isWaterDone ? "COMPLETED" : isWaterRunning ? "RUNNING" : "WAITING",
        details: isWaterRunning ? `${((liveStatus.actualWaterMl || 0) / 1000).toFixed(1)} / ${targetWaterL} L` : undefined,
        progressPct: isWaterDone ? 100 : isWaterRunning && targetWaterL > 0 ? ((liveStatus.actualWaterMl || 0) / (targetWaterL * 1000)) * 100 : 0,
      },
      {
        stepNumber: 2,
        name: "Injeksi Nutrisi A",
        description: `Pompa DP-A (${chA} ml pekatan A)`,
        status: isDosingDone || (isDosingRunning && activeChan.includes("B"))
          ? "COMPLETED"
          : isDosingRunning && (activeChan.includes("A") || !activeChan)
          ? "RUNNING"
          : "WAITING",
        details: isDosingRunning && activeChan.includes("A") ? "Pompa DP-A Aktif" : undefined,
      },
      {
        stepNumber: 3,
        name: "Injeksi Nutrisi B",
        description: `Pompa DP-B (${chB} ml pekatan B)`,
        status: isDosingDone
          ? "COMPLETED"
          : isDosingRunning && activeChan.includes("B")
          ? "RUNNING"
          : "WAITING",
        details: isDosingRunning && activeChan.includes("B") ? "Pompa DP-B Aktif" : undefined,
      },
      {
        stepNumber: 4,
        name: "Pengadukan & Homogenisasi",
        description: "Sirkulasi homogen di tangki batch",
        status: isMixingDone ? "COMPLETED" : isMixingRunning ? "RUNNING" : "WAITING",
        details: isMixingRunning ? "Mixer ON" : undefined,
      },
      {
        stepNumber: 5,
        name: "Pompa Distribusi Fertigasi",
        description: "Penyiraman ke dripper tanaman",
        status: isPumpDone ? "COMPLETED" : isPumpRunning ? "RUNNING" : "WAITING",
        details: isPumpRunning ? "Pompa Irigasi ON" : undefined,
      },
    ];

    return {
      id: liveStatus.batchId || "active-batch",
      scheduleId: schedId,
      ghId: targetGhId,
      ghCode,
      jobTitle: sched?.name || "Peracikan Nutrisi Terjadwal",
      recipeName: recipe?.name || "Nutrisi Standar",
      targetWaterL,
      targetWaterMl: targetWaterL * 1000,
      dosingAml: chA,
      dosingBml: chB,
      mixingDurationSec: 180,
      scheduledTimeStr: sched?.time || "Sekarang",
      queuePosition: 0,
      status: "ACTIVE",
      statusLabel: "Sedang Berjalan",
      steps,
    };
  }, [liveStatus, fwState, ghs, allSchedules]);

  // -------------------------------------------------------------------------
  // Construct Upcoming FIFO Jobs
  // -------------------------------------------------------------------------
  const queuedJobs: DosingQueueJob[] = useMemo(() => {
    const list: DosingQueueJob[] = [];
    const occurrences: any[] = Array.isArray(liveStatus?.todaySchedule) ? liveStatus.todaySchedule : [];

    // Filter pending occurrences for today
    occurrences
      .filter((o) => o.state === 0 || o.state === "PENDING" || o.state === "WAITING_BATCH" || o.status === "PENDING")
      .forEach((occ, idx) => {
        const gh = greenhouseService.get(occ.gh_id || occ.ghId);
        const ghCode = gh?.code || occ.gh_id || occ.ghId;
        const sched = allSchedules.find((s) => s.id === (occ.schedule_id || occ.scheduleId));
        const recipe = gh?.recipes?.find((r) => r.id === sched?.recipeId);
        const targetWaterL = sched?.targetWaterL || 50;

        list.push({
          id: occ.occurrence_id || occ.occurrenceId || `occ-${idx}`,
          scheduleId: occ.schedule_id || occ.scheduleId,
          ghId: occ.gh_id || occ.ghId,
          ghCode,
          jobTitle: sched?.name || "Jadwal Siap Antrean",
          recipeName: recipe?.name || "Nutrisi Pertumbuhan",
          targetWaterL,
          targetWaterMl: targetWaterL * 1000,
          dosingAml: sched?.dosingAml ?? 150,
          dosingBml: sched?.dosingBml ?? 150,
          mixingDurationSec: 180,
          scheduledTimeStr: sched?.time || (occ.scheduled_timestamp ? new Date(occ.scheduled_timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"),
          queuePosition: idx + 1,
          status: "PENDING_FIFO",
          statusLabel: "Menunggu Antrean",
          steps: [],
        });
      });

    return list;
  }, [liveStatus, allSchedules]);

  // -------------------------------------------------------------------------
  // Construct Independent Greenhouse Mixing Tanks (Section 7 Spec)
  // -------------------------------------------------------------------------
  const mixingTanks: GreenhouseTankInfo[] = useMemo(() => {
    return ghs.map((gh) => {
      const isTargetActive = activeJob?.ghId === gh.id;
      const ghDeliveries: any[] = Array.isArray(liveStatus?.activeDeliveries) ? liveStatus.activeDeliveries : [];
      const hasDelivery = ghDeliveries.some((d) => (d.ghId || d.gh_id || "").toLowerCase() === gh.id.toLowerCase());

      // Check occurrences for this GH
      const occurrences: any[] = Array.isArray(liveStatus?.todaySchedule) ? liveStatus.todaySchedule : [];
      const ghOcc = occurrences.find((o) => (o.gh_id || o.ghId || "").toLowerCase() === gh.id.toLowerCase() && (o.state === "READY_TO_SEND" || o.state === 3));

      let status: HumanMixingState = "Waiting";
      let statusTone: GreenhouseTankInfo["statusTone"] = "slate";
      let statusDesc = "Standby jadwal berikutnya";
      let canDeliverNow = false;
      let canPreMixNow = true;

      if (hasDelivery) {
        status = "Delivering";
        statusTone = "purple";
        statusDesc = "Pompa irigasi sedang menyiram tanaman";
        canPreMixNow = false;
      } else if (ghOcc || isTargetActive && fwState === "MIX_READY") {
        status = "Ready";
        statusTone = "emerald";
        statusDesc = "Larutan homogen & siap disiram";
        canDeliverNow = true;
        canPreMixNow = false;
      } else if (isTargetActive) {
        if (fwState === "FILLING" || fwState === "PRECHECK") {
          status = "Preparing Water";
          statusTone = "blue";
          statusDesc = "Sedang mengisi air baku dari toren";
        } else if (fwState === "DOSING") {
          status = "Adding Nutrients";
          statusTone = "cyan";
          statusDesc = "Injeksi nutrisi A & B berlangsung";
        } else if (fwState === "FINAL_MIXING") {
          status = "Mixing";
          statusTone = "cyan";
          statusDesc = "Pengadukan larutan nutrisi";
        }
        canPreMixNow = false;
      }

      const nextSched = allSchedules.find((s) => s.ghId === gh.id && s.enabled);
      const capacityL = 300;
      const currentVolumeL = status === "Ready" ? (nextSched?.targetWaterL || 50) : isTargetActive ? Math.round((liveStatus?.actualWaterMl || 0) / 1000) : 0;
      const levelPct = capacityL > 0 ? (currentVolumeL / capacityL) * 100 : 0;

      return {
        ghId: gh.id,
        ghCode: gh.code || gh.greenhouseTag || gh.id,
        tankName: `Tangki Pencampur ${gh.code || gh.id}`,
        status,
        statusTone,
        statusDescription: statusDesc,
        currentVolumeL,
        capacityL,
        levelPct,
        remainingTimeStr: isTargetActive && fwState !== "MIX_READY" ? "02:15" : null,
        expectedReadyTimeStr: nextSched?.time ? `Sebelum ${nextSched.time}` : null,
        targetWaterL: nextSched?.targetWaterL,
        recipeName: gh.recipes?.[0]?.name,
        canDeliverNow,
        canPreMixNow,
      };
    });
  }, [ghs, activeJob, fwState, liveStatus, allSchedules]);

  // -------------------------------------------------------------------------
  // Construct Complex Overview Summaries (Section 8 Spec)
  // -------------------------------------------------------------------------
  const ghSummaries: GreenhouseFertigationSummary[] = useMemo(() => {
    return ghs.map((gh) => {
      const tank = mixingTanks.find((t) => t.ghId === gh.id);
      const scheds = allSchedules.filter((s) => s.ghId === gh.id);
      const nextSched = scheds.find((s) => s.enabled);

      let status: GreenhouseFertigationSummary["status"] = "WAITING";
      let statusLabel = "Menunggu Jadwal";
      let statusTone: GreenhouseFertigationSummary["statusTone"] = "slate";
      let statusDesc = "Standby menunggu jam jadwal";

      if (tank?.status === "Ready") {
        status = "READY";
        statusLabel = "Larutan Siap";
        statusTone = "emerald";
        statusDesc = "Larutan nutrisi sudah siap di tangki batch";
      } else if (tank?.status === "Delivering") {
        status = "DISTRIBUTING";
        statusLabel = "Sedang Menyiram";
        statusTone = "purple";
        statusDesc = "Penyiraman ke tanaman sedang aktif";
      } else if (tank?.status === "Mixing" || tank?.status === "Adding Nutrients" || tank?.status === "Preparing Water") {
        status = "MIXING";
        statusLabel = "Sedang Meracik";
        statusTone = "cyan";
        statusDesc = "Peracikan air & nutrisi aktif di central unit";
      } else if (tank?.status === "Failed") {
        status = "ERROR";
        statusLabel = "Kendala Operasi";
        statusTone = "rose";
        statusDesc = "Peracikan batch gagal atau terhenti";
      }

      return {
        gh,
        status,
        statusLabel,
        statusTone,
        statusDesc,
        nextScheduleTime: nextSched?.time || null,
        nextRecipeName: gh.recipes?.find((r) => r.id === nextSched?.recipeId)?.name || null,
        targetWaterL: nextSched?.targetWaterL || null,
        cyclesCompletedToday: 2,
        totalCyclesToday: scheds.length || 3,
        tankLevelPct: tank?.levelPct || 0,
        canPreMix: tank?.canPreMixNow ?? true,
        canDeliver: tank?.canDeliverNow ?? false,
      };
    });
  }, [ghs, mixingTanks, allSchedules]);

  // -------------------------------------------------------------------------
  // Actions: Pre-Mix, Deliver, Abort, Trigger Daily
  // -------------------------------------------------------------------------
  const handlePreMixGh = async (ghId: string) => {
    setActionInProgress(`premix-${ghId}`);
    try {
      const gh = greenhouseService.get(ghId);
      const recipe = gh?.recipes?.[0];
      const sched = allSchedules.find((s) => s.ghId === ghId);
      const targetWater = sched?.targetWaterL || recipe?.waterL || 50;

      if (!recipe) throw new Error("Belum ada resep nutrisi untuk greenhouse ini.");
      await fertigationService.startManual(ghId, recipe.id, targetWater);
      toast(`Peracikan nutrisi untuk ${gh?.code || ghId} berhasil dimulai di kontroler!`, "success");
      await fetchStatus(true);
    } catch (err: any) {
      toast(`Gagal memulai peracikan: ${err?.message || "Kesalahan kontroler"}`, "error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeliverGh = async (ghId: string) => {
    setActionInProgress(`deliver-${ghId}`);
    try {
      await esp32Client.triggerDistribution(ghId, `deliver-${ghId}-${Date.now()}`);
      toast(`Distribusi fertigasi ke tanaman dimulai untuk ${ghId}!`, "success");
      await fetchStatus(true);
    } catch (err: any) {
      toast(`Gagal menyiram: ${err?.message || "Kesalahan kontroler"}`, "error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleAbort = async () => {
    setActionInProgress("abort");
    try {
      const ghId = activeJob?.ghId || ghs[0]?.id;
      if (ghId) {
        await fertigationService.stopManual(ghId);
      }
      toast("Operasi fertigasi berhasil dibatalkan secara aman.", "warning");
      await fetchStatus(true);
    } catch (err: any) {
      toast(`Gagal membatalkan: ${err?.message || "Kesalahan kontroler"}`, "error");
    } finally {
      setActionInProgress(null);
    }
  };

  const handleTriggerDaily = async () => {
    setActionInProgress("trigger-daily");
    try {
      await esp32Client.triggerDailySchedules();
      toast("Jadwal hari ini berhasil dimaterialisasi dan antrean pre-mix dieksekusi!", "success");
      await fetchStatus(true);
    } catch (err: any) {
      toast(`Gagal memicu jadwal: ${err?.message || "Kesalahan kontroler"}`, "error");
    } finally {
      setActionInProgress(null);
    }
  };

  // -------------------------------------------------------------------------
  // View Routing: Scoped Greenhouse vs Complex Overview
  // -------------------------------------------------------------------------
  if (effectiveGhId) {
    const gh = greenhouseService.get(effectiveGhId);
    const summary = ghSummaries.find((s) => s.gh.id === effectiveGhId);
    const tank = mixingTanks.find((t) => t.ghId === effectiveGhId);

    if (gh && summary && tank) {
      const ghActiveJob = activeJob?.ghId === gh.id ? activeJob : null;
      const ghQueuedJobs = queuedJobs.filter((q) => q.ghId === gh.id);

      return (
        <GreenhouseFertigationDetail
          gh={gh}
          status={summary.status}
          statusLabel={summary.statusLabel}
          statusTone={summary.statusTone}
          statusDesc={summary.statusDesc}
          currentOperationText={summary.statusDesc}
          nextScheduleTime={summary.nextScheduleTime}
          nextRecipeName={summary.nextRecipeName}
          targetWaterL={summary.targetWaterL}
          cyclesCompletedToday={summary.cyclesCompletedToday}
          totalCyclesToday={summary.totalCyclesToday}
          mixingTank={tank}
          activeJob={ghActiveJob}
          queuedJobs={ghQueuedJobs}
          onPreMix={() => handlePreMixGh(gh.id)}
          onDeliver={() => handleDeliverGh(gh.id)}
          onAbort={handleAbort}
          isActionLoading={actionInProgress !== null}
          className={className}
        />
      );
    }
  }

  // -------------------------------------------------------------------------
  // Complex Full Overview View
  // -------------------------------------------------------------------------
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-800 bg-[#0e1a2a] shadow-[0_18px_55px_rgba(0,0,0,0.24)] ${className}`}>
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-[#0f1d30] px-4 py-4 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/12 text-violet-300 shadow-[0_0_15px_rgba(167,139,250,0.15)]">
            <ListOrdered className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-bold tracking-tight text-slate-100">
                Sistem Fertigasi & Antrean Peracikan (Fertigation & Mixing System)
              </h2>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                {complex?.name || "Complex"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Alur operasional terintegrasi: Jadwal → Antrean FIFO Dosing Sentral → Tangki Pencampur GH → Irigasi Tanaman
            </p>
          </div>
        </div>

        {/* Live Controller Status & Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {liveStatus?.dailyTriggerExecuted ? (
            <span
              title="Jadwal hari ini telah di-trigger dan antrean peracikan aktif"
              className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300"
            >
              <Sparkles className="h-3 w-3 text-sky-400" />
              Trigger Harian: Aktif
            </span>
          ) : !offline ? (
            <button
              type="button"
              onClick={handleTriggerDaily}
              disabled={actionInProgress === "trigger-daily"}
              title="Materialisasi jadwal hari ini dan mulai peracikan awal sekarang"
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/30 active:scale-95 disabled:opacity-50"
            >
              <Play className="h-3 w-3 text-amber-400" />
              {actionInProgress === "trigger-daily" ? "Memproses…" : "Trigger Hari Ini"}
            </button>
          ) : null}

          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            offline
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`} />
            {offline ? "ESP32 Offline (Local Cache)" : "ESP32 Telemetri Otoritatif"}
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

      <div className="p-4 md:p-5 space-y-6">
        {/* 1. Complex-Level Overview for all Greenhouses */}
        <ComplexFertigationOverview
          complexName={complex?.name || "Complex"}
          greenhouses={ghSummaries}
          onPreMixGh={handlePreMixGh}
          onDeliverGh={handleDeliverGh}
          loadingActionGhId={actionInProgress ? actionInProgress.replace(/^(premix-|deliver-)/, "") : null}
        />

        {/* 2. Dosing Queue Section (Central Unit 5-Step Progress & FIFO List) */}
        <DosingQueueSection
          activeJob={activeJob}
          queuedJobs={queuedJobs}
          onAbortActive={handleAbort}
          onPreMixJob={(job) => handlePreMixGh(job.ghId)}
          isActionLoading={actionInProgress !== null}
        />

        {/* 3. Independent Greenhouse Mixing Tanks */}
        <GreenhouseMixingTanks
          tanks={mixingTanks}
          onPreMix={handlePreMixGh}
          onDeliver={handleDeliverGh}
          isActionLoading={actionInProgress !== null}
        />

        {/* 4. Fertigation Schedule Manager */}
        <FertigationScheduleManager
          schedules={allSchedules}
          greenhouses={ghs}
          onOpenCreate={onOpenCreate}
          onPreMixSchedule={(s) => handlePreMixGh(s.ghId)}
          isActionLoading={actionInProgress !== null}
        />
      </div>
    </section>
  );
}
