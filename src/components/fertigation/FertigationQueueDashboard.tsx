"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
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
import { complexService, fertigationService, greenhouseService, recipeService, scheduleService } from "@/lib/services";
import { useToast } from "@/components/ui/toast";
import { useDbVersion } from "@/lib/useDb";
import { useDeviceClock } from "@/lib/device-clock";
import type { FertigationSchedule, Greenhouse, Recipe } from "@/lib/types";
import { formatGreenhouseName } from "@/lib/format";

import type { GreenhouseFertigationSummary } from "./ComplexFertigationOverview";
import {
  DosingQueueSection,
  type DosingQueueJob,
  type OperationalStep,
  type NextScheduledOperation,
  type DosingErrorInfo,
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
  const dbVersion = useDbVersion();
  const clock = useDeviceClock();
  const currentMinutes = Math.floor(clock.secondsSinceMidnight / 60);
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

  const prevDbVersion = React.useRef(dbVersion);
  useEffect(() => {
    if (prevDbVersion.current !== dbVersion) {
      prevDbVersion.current = dbVersion;
      void fetchStatus(false);
    }
  }, [dbVersion]);

  // Poll authoritative ESP32 fertigation status & queue every 3s
  const inFlightRef = useRef(false);
  const [isAwaitingQueueSync, setIsAwaitingQueueSync] = useState(false);
  const [syncCountdown, setSyncCountdown] = useState(15);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasTriggeredRemoteRef = useRef(false);

  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, []);

  const autoDispatchLockRef = useRef<{ ghId: string; timestamp: number } | null>(null);

  const fetchStatus = async (isManual = false) => {
    if (inFlightRef.current && !isManual) return;
    inFlightRef.current = true;
    if (isManual) {
      setRefreshing(true);
      hasTriggeredRemoteRef.current = false;
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setIsAwaitingQueueSync(false);
    }
    try {
      if (isManual && effectiveComplexId) {
        try {
          await scheduleService.deploySchedules(effectiveComplexId);
        } catch {
          // best-effort
        }
      }

      const [statusRes, queueRes] = await Promise.allSettled([
        esp32Client.getFertigationStatus(),
        esp32Client.getFertigationQueue(),
      ]);

      let stVal: any = null;
      let qBatches: any[] = [];

      if (statusRes.status === "fulfilled" && statusRes.value) {
        stVal = statusRes.value;
        setLiveStatus(stVal);
        setOffline(false);
      }

      // Authoritative queuedBatches extraction helper (direct or enveloped)
      const extractBatches = (resVal: any): any[] => {
        if (!resVal) return [];
        if (Array.isArray(resVal.queuedBatches)) return resVal.queuedBatches;
        if (Array.isArray(resVal.data?.queuedBatches)) return resVal.data.queuedBatches;
        if (Array.isArray(resVal.payload?.queuedBatches)) return resVal.payload.queuedBatches;
        return [];
      };

      const qFromQueue = extractBatches(queueRes.status === "fulfilled" ? queueRes.value : null);
      const qFromStatus = extractBatches(statusRes.status === "fulfilled" ? statusRes.value : null);
      qBatches = qFromQueue.length > 0 ? qFromQueue : qFromStatus;
      setLiveQueue(qBatches);

      // Continuous FIFO Execution (Spec §52 & Operational Model):
      // If controller is IDLE and queue has items, immediately trigger startManual for batch #1
      const currentFw = (stVal?.runtimeState || stVal?.state || "IDLE").toUpperCase().replace(/^FERT_STATE_/, "");
      if (currentFw === "IDLE" && qBatches.length > 0) {
        const firstBatch = qBatches[0];
        const ghId = firstBatch.ghId || firstBatch.gh_id;
        const nowMs = Date.now();
        if (ghId && (!autoDispatchLockRef.current || autoDispatchLockRef.current.ghId !== ghId || nowMs - autoDispatchLockRef.current.timestamp > 15000)) {
          autoDispatchLockRef.current = { ghId, timestamp: nowMs };
          const gh = greenhouseService.get(ghId);
          const sched = allSchedules.find((s) => s.ghId === ghId && s.enabled);
          const recipe = gh?.recipes?.[0];
          const targetWater = sched?.targetWaterL || recipe?.waterL || 50;
          if (recipe) {
            fertigationService.startManual(ghId, recipe.id, targetWater)
              .then(() => fetchStatus(false))
              .catch((err) => console.warn("[fetchStatus] Continuous FIFO auto-dispatch notice:", err));
          }
        }
      }

      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setIsAwaitingQueueSync(false);
      setSyncCountdown(0);
    } catch {
      setOffline(true);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  };

  const handleTriggerQueueSync = async () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    hasTriggeredRemoteRef.current = true;
    setIsAwaitingQueueSync(true);
    setSyncCountdown(0);

    try {
      if (effectiveComplexId) {
        try {
          await scheduleService.deploySchedules(effectiveComplexId);
          await esp32Client.triggerDailySchedules();
        } catch (triggerErr) {
          console.warn("[FertigationQueueDashboard] trigger sync notice:", triggerErr);
        }
      }
      await fetchStatus(true);

      // Spec §52 & Operational Model: FETCH LANGSUNG EKSEKUSI DOSING
      // If Central Dosing Unit is IDLE and a greenhouse mixing tank is not ready, start dosing immediately!
      const currentFw = (liveStatus?.runtimeState || liveStatus?.state || "IDLE").toUpperCase().replace(/^FERT_STATE_/, "");
      if (currentFw === "IDLE") {
        const pendingGh = ghs.find((g) => {
          const ghScheds = scheduleService.fertigationForGh(g.id).filter((s) => s.enabled);
          if (ghScheds.length === 0) return false;
          const occs: any[] = Array.isArray(liveStatus?.todaySchedule) ? liveStatus.todaySchedule : [];
          const isReady = occs.some((o) => (o.ghId || o.gh_id) === g.id && (o.state === "READY_TO_SEND" || o.state === 3 || o.status === "READY_TO_SEND"));
          const dels: any[] = Array.isArray(liveStatus?.activeDeliveries) ? liveStatus.activeDeliveries : [];
          const isDeliv = dels.some((d) => (d.ghId || d.gh_id) === g.id);
          return !isReady && !isDeliv;
        });

        if (pendingGh) {
          const sched = allSchedules.find((s) => s.ghId === pendingGh.id && s.enabled);
          const recipe = pendingGh.recipes?.[0];
          const targetWater = sched?.targetWaterL || recipe?.waterL || 50;
          if (recipe) {
            try {
              await fertigationService.startManual(pendingGh.id, recipe.id, targetWater);
              await fetchStatus(false);
            } catch (startErr) {
              console.warn("[handleTriggerQueueSync] Auto eager-dosing start notice:", startErr);
            }
          }
        }
      }

      toast("Antrean peracikan berhasil disinkronkan & eksekusi dosing aktif", "success");
    } catch {
      toast("Gagal menyinkronkan antrean peracikan", "error");
    } finally {
      setIsAwaitingQueueSync(false);
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

  // Helper: Synchronize & resolve authoritative dosing nutrient targets from schedule & recipe
  const resolveDosingTargets = (
    sched: FertigationSchedule | undefined,
    gh: Greenhouse | undefined,
    fallbackWaterL = 80,
    sourceItem?: any
  ) => {
    const activeRecipeId = sched?.recipeId || sourceItem?.recipeId || sourceItem?.recipe_id;
    const recipe =
      gh?.recipes?.find(
        (r) => r.id === activeRecipeId || r.name.toLowerCase() === (activeRecipeId || "").toLowerCase()
      ) ||
      (activeRecipeId ? recipeService.get(activeRecipeId) : undefined) ||
      recipeService.get("rcp-standar");

    const targetWaterL =
      sourceItem?.targetWaterL ||
      sourceItem?.waterL ||
      (sourceItem?.targetWaterMl ? sourceItem.targetWaterMl / 1000 : undefined) ||
      sched?.targetWaterL ||
      recipe?.waterL ||
      fallbackWaterL;

    let chA = 0;
    if (sourceItem?.dosingAml && sourceItem.dosingAml > 0) {
      chA = sourceItem.dosingAml;
    } else if (sourceItem?.dosing_a_ml && sourceItem.dosing_a_ml > 0) {
      chA = sourceItem.dosing_a_ml;
    } else if (sched?.dosingAml && sched.dosingAml > 0) {
      chA = sched.dosingAml;
    } else if (sched?.dosingChannels?.[0]?.requestedMl && sched.dosingChannels[0].requestedMl > 0) {
      chA = sched.dosingChannels[0].requestedMl;
    } else if (recipe?.dosingAml && recipe.dosingAml > 0) {
      chA = recipe.dosingAml;
    } else if (recipe?.dosingChannels?.[0]?.requestedMl && recipe.dosingChannels[0].requestedMl > 0) {
      chA = recipe.dosingChannels[0].requestedMl;
    } else {
      chA = Math.round(targetWaterL * 1.875);
    }

    let chB = 0;
    if (sourceItem?.dosingBml && sourceItem.dosingBml > 0) {
      chB = sourceItem.dosingBml;
    } else if (sourceItem?.dosing_b_ml && sourceItem.dosing_b_ml > 0) {
      chB = sourceItem.dosing_b_ml;
    } else if (sched?.dosingBml && sched.dosingBml > 0) {
      chB = sched.dosingBml;
    } else if (sched?.dosingChannels?.[1]?.requestedMl && sched.dosingChannels[1].requestedMl > 0) {
      chB = sched.dosingChannels[1].requestedMl;
    } else if (recipe?.dosingBml && recipe.dosingBml > 0) {
      chB = recipe.dosingBml;
    } else if (recipe?.dosingChannels?.[1]?.requestedMl && recipe.dosingChannels[1].requestedMl > 0) {
      chB = recipe.dosingChannels[1].requestedMl;
    } else {
      chB = Math.round(targetWaterL * 1.875);
    }

    return {
      targetWaterL,
      dosingAml: chA,
      dosingBml: chB,
      recipeName: recipe?.name || "Nutrisi Standar",
    };
  };

  // -------------------------------------------------------------------------
  // Construct Upcoming FIFO Jobs (Section 6 Spec)
  // -------------------------------------------------------------------------
  const allQueuedJobs: DosingQueueJob[] = useMemo(() => {
    const list: DosingQueueJob[] = [];
    const seenGhOrSched = new Set<string>();

    // 1. Primary source: Filter queued batches from authoritative liveQueue (queuedBatches from ESP32)
    if (Array.isArray(liveQueue) && liveQueue.length > 0) {
      liveQueue
        .filter((q) => q.status === "PENDING" || q.status === "DISPATCHED" || q.state === 0 || q.state === 1)
        .forEach((q, idx) => {
          const targetGhId = q.ghId || q.gh_id;
          const schedId = q.scheduleId || q.schedule_id;
          const gh = greenhouseService.get(targetGhId);
          const ghIndex = ghs.findIndex((g) => g.id === targetGhId);
          const ghCode = gh?.code || `GH-${String((ghIndex >= 0 ? ghIndex : 0) + 1).padStart(2, "0")}`;
          const ghName = formatGreenhouseName(gh, ghIndex >= 0 ? ghIndex : 0);

          const sched = allSchedules.find((s) => s.id === schedId);
          const dosingInfo = resolveDosingTargets(sched, gh, 80, q);

          seenGhOrSched.add(`${targetGhId}_${schedId}`);

          list.push({
            id: q.queueId || q.queue_id || `q-${idx}`,
            scheduleId: schedId,
            ghId: targetGhId,
            ghCode,
            ghName,
            jobTitle: sched?.name || "Peracikan Nutrisi Terjadwal",
            recipeName: dosingInfo.recipeName,
            targetWaterL: dosingInfo.targetWaterL,
            targetWaterMl: dosingInfo.targetWaterL * 1000,
            dosingAml: dosingInfo.dosingAml,
            dosingBml: dosingInfo.dosingBml,
            mixingDurationSec: 180,
            scheduledTimeStr: sched?.time || "Dalam Antrean",
            queuePosition: idx + 1,
            status: "PENDING_FIFO",
            statusLabel: "Menunggu Antrean",
            steps: [],
          });
        });
    }

    // 2. Secondary source: Ingest today occurrences currently in PREPARING or WAITING_BATCH state
    const occurrences: any[] = Array.isArray(liveStatus?.todaySchedule) ? liveStatus.todaySchedule : [];
    occurrences
      .filter((o) => o.state === "PREPARING" || o.state === "WAITING_BATCH" || o.status === "PREPARING" || o.status === "WAITING_BATCH")
      .forEach((o, idx) => {
        const targetGhId = o.gh_id || o.ghId;
        const schedId = o.schedule_id || o.scheduleId;
        const key = `${targetGhId}_${schedId}`;
        if (seenGhOrSched.has(key)) return;
        seenGhOrSched.add(key);

        const gh = greenhouseService.get(targetGhId);
        const ghIndex = ghs.findIndex((g) => g.id === targetGhId);
        const ghCode = gh?.code || `GH-${String((ghIndex >= 0 ? ghIndex : 0) + 1).padStart(2, "0")}`;
        const ghName = formatGreenhouseName(gh, ghIndex >= 0 ? ghIndex : 0);

        const sched = allSchedules.find((s) => s.id === schedId);
        const dosingInfo = resolveDosingTargets(sched, gh, 80, o);

        list.push({
          id: o.occurrenceId || o.occurrence_id || `occ-${idx}`,
          scheduleId: schedId,
          ghId: targetGhId,
          ghCode,
          ghName,
          jobTitle: sched?.name || "Persiapan Peracikan Dosing",
          recipeName: dosingInfo.recipeName,
          targetWaterL: dosingInfo.targetWaterL,
          targetWaterMl: dosingInfo.targetWaterL * 1000,
          dosingAml: dosingInfo.dosingAml,
          dosingBml: dosingInfo.dosingBml,
          mixingDurationSec: 180,
          scheduledTimeStr: sched?.time || "Siap Diracik",
          queuePosition: list.length + 1,
          status: "PENDING_FIFO",
          statusLabel: "Antrean Siap Racik",
          steps: [],
        });
      });

    return list;
  }, [liveQueue, liveStatus, allSchedules, ghs]);

  // -------------------------------------------------------------------------
  // Construct Active Dosing Queue Job with 5 Real Operational Steps (Section 5)
  // -------------------------------------------------------------------------
  const activeJob: DosingQueueJob | null = useMemo(() => {
    const isHardwareBusy =
      liveStatus &&
      fwState !== "IDLE" &&
      fwState !== "COMPLETE" &&
      fwState !== "FAULTED" &&
      fwState !== "ABORTED";

    if (isHardwareBusy) {
      const targetGhId = liveStatus.ghId || liveStatus.targetGhId || ghs.at(0)?.id || "";
      const gh = greenhouseService.get(targetGhId);
      const ghIndex = ghs.findIndex((g) => g.id === targetGhId);
      const ghCode = gh?.code || `GH-${String((ghIndex >= 0 ? ghIndex : 0) + 1).padStart(2, "0")}`;
      const ghName = formatGreenhouseName(gh, ghIndex >= 0 ? ghIndex : 0);

      const schedId = liveStatus.scheduleId || "";
      const sched = allSchedules.find((s) => s.id === schedId);
      const fallbackWater = (liveStatus.targetWaterMl ? liveStatus.targetWaterMl / 1000 : sched?.targetWaterL) || 80;
      const dosingInfo = resolveDosingTargets(sched, gh, fallbackWater, liveStatus);
      const targetWaterL = fallbackWater;
      const chA = dosingInfo.dosingAml;
      const chB = dosingInfo.dosingBml;

      // Dosing Protocol Specification: 3 Physical Stages (Dosing Queue Pipeline)
      // 1. Persiapan Air Baku (Filling to threshold X%)
      // 2. Dosing & Mixing Simultan (DP-A, DP-B, Mixer ON concurrently, Raw Water to 100%)
      // 3. Pengadukan Akhir (Final homogenization mixing)
      // Terminal state: READY_TO_FERTIGATE (Distribution is a decoupled Fertigation Schedule event)
      const isWaterDone = fwState === "DOSING" || fwState === "FINAL_MIXING" || fwState === "MIX_READY" || fwState === "COMPLETE";
      const isWaterRunning = fwState === "FILLING" || fwState === "PRECHECK";

      const isDosingDone = fwState === "FINAL_MIXING" || fwState === "MIX_READY" || fwState === "COMPLETE";
      const isDosingRunning = fwState === "DOSING";

      const isMixingDone = fwState === "MIX_READY" || fwState === "COMPLETE";
      const isMixingRunning = fwState === "FINAL_MIXING";

      const threshPct = liveStatus.thresholdPercent || 20;

      const steps: OperationalStep[] = [
        {
          stepNumber: 1,
          name: "Persiapan Air Baku",
          description: `Pengisian tangki s/d ${targetWaterL} L (Threshold ${threshPct}%)`,
          status: isWaterDone ? "COMPLETED" : isWaterRunning ? "RUNNING" : "WAITING",
          details: isWaterRunning
            ? (liveStatus.actualWaterMl && liveStatus.actualWaterMl > 0
                ? `${((liveStatus.actualWaterMl || 0) / 1000).toFixed(1)} / ${targetWaterL} L`
                : "Mengaktifkan Pompa Air Baku")
            : undefined,
          progressPct: isWaterDone
            ? 100
            : isWaterRunning && targetWaterL > 0
            ? Math.min(100, ((liveStatus.actualWaterMl || 0) / (targetWaterL * 1000)) * 100)
            : 0,
        },
        {
          stepNumber: 2,
          name: "Dosing & Mixing Simultan",
          description: `Injeksi Pupuk A (${chA} ml) & B (${chB} ml) bersamaan + Pengaduk AC`,
          status: isDosingDone ? "COMPLETED" : isDosingRunning ? "RUNNING" : "WAITING",
          details: isDosingRunning ? "DP-A & DP-B Aktif Simultan" : undefined,
        },
        {
          stepNumber: 3,
          name: "Pengadukan Akhir",
          description: `Homogenisasi larutan di tangki (${liveStatus.mixingDurationSec || 180}s)`,
          status: isMixingDone ? "COMPLETED" : isMixingRunning ? "RUNNING" : "WAITING",
          details: isMixingRunning ? "Mixer Sirkulasi Aktif" : undefined,
        },
      ];

      return {
        id: liveStatus.batchId || "active-batch",
        scheduleId: schedId,
        ghId: targetGhId,
        ghCode,
        ghName,
        jobTitle: sched?.name || "Peracikan Nutrisi Terjadwal",
        recipeName: dosingInfo.recipeName,
        targetWaterL,
        targetWaterMl: targetWaterL * 1000,
        dosingAml: chA,
        dosingBml: chB,
        mixingDurationSec: liveStatus.mixingDurationSec || 180,
        scheduledTimeStr: sched?.time || "Sekarang",
        queuePosition: 0,
        status: "ACTIVE",
        statusLabel: fwState === "MIX_READY" ? "Siap Disalurkan" : "Sedang Berjalan",
        steps,
      };
    }

    // When firmware is IDLE, there is NO active hardware execution.
    // All queued items remain honestly in queuedJobs (waiting for turn or dispatch).
    return null;
  }, [liveStatus, fwState, ghs, allSchedules]);

  // FIFO Queued Jobs rendered in the list:
  // If top job was promoted to activeJob, only show subsequent jobs in the queue list!
  const queuedJobs = useMemo(() => {
    if (activeJob && allQueuedJobs.length > 0 && activeJob.id === allQueuedJobs[0].id) {
      return allQueuedJobs.slice(1);
    }
    return allQueuedJobs;
  }, [activeJob, allQueuedJobs]);

  // -------------------------------------------------------------------------
  // Construct Next Scheduled Operation (Section 5 & 8)
  // -------------------------------------------------------------------------
  const nextScheduledOp: NextScheduledOperation | null = useMemo(() => {
    // 1. Check liveStatus.todaySchedule for earliest pending occurrence that is >= current time
    const occurrences: any[] = Array.isArray(liveStatus?.todaySchedule) ? liveStatus.todaySchedule : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const pendingOcc = occurrences
      .filter((o) => (o.state === "PENDING" || o.state === 0) && (o.scheduled_timestamp || o.scheduledTimestamp))
      .filter((o) => (o.scheduled_timestamp || o.scheduledTimestamp) >= nowSec - 60)
      .sort((a, b) => (a.scheduled_timestamp || a.scheduledTimestamp) - (b.scheduled_timestamp || b.scheduledTimestamp))[0];

    if (pendingOcc) {
      const targetGhId = pendingOcc.gh_id || pendingOcc.ghId;
      const gh = greenhouseService.get(targetGhId);
      const ghIndex = ghs.findIndex((g) => g.id === targetGhId);
      const ghName = formatGreenhouseName(gh, ghIndex >= 0 ? ghIndex : 0);
      const sched = allSchedules.find((s) => s.id === (pendingOcc.schedule_id || pendingOcc.scheduleId));
      const timeStr =
        sched?.time ||
        (pendingOcc.scheduled_timestamp
          ? new Date(pendingOcc.scheduled_timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "—");

      return {
        ghCode: ghName,
        ghName,
        time: timeStr,
        jobTitle: sched?.name || "Jadwal Penyiraman",
      };
    }

    // 2. Evaluate allSchedules whose time is >= currentMinutes
    const upcomingSched = allSchedules
      .filter((s) => s.enabled && s.time && s.time !== "--:--")
      .map((s) => {
        const [h, m] = s.time.split(":").map(Number);
        return { sched: s, minutes: (h || 0) * 60 + (m || 0) };
      })
      .filter((item) => item.minutes >= currentMinutes)
      .sort((a, b) => a.minutes - b.minutes)[0]?.sched;

    if (upcomingSched) {
      const gh = greenhouseService.get(upcomingSched.ghId);
      const ghIndex = ghs.findIndex((g) => g.id === upcomingSched.ghId);
      const ghName = formatGreenhouseName(gh, ghIndex >= 0 ? ghIndex : 0);

      return {
        ghCode: ghName,
        ghName,
        time: upcomingSched.time,
        jobTitle: upcomingSched.name,
      };
    }

    return null;
  }, [liveStatus, allSchedules, ghs, currentMinutes]);

  // -------------------------------------------------------------------------
  // Construct Error Information (Section 5 Spec)
  // -------------------------------------------------------------------------
  const errorInfo: DosingErrorInfo | null = useMemo(() => {
    if (fwState === "FAULTED" || fwState === "ABORTED" || fwState === "INTERRUPTED") {
      const targetGhId = liveStatus.ghId || liveStatus.targetGhId || ghs.at(0)?.id || "";
      const gh = greenhouseService.get(targetGhId);
      const ghIndex = ghs.findIndex((g) => g.id === targetGhId);
      const ghCode = gh?.code || `GH-${String((ghIndex >= 0 ? ghIndex : 0) + 1).padStart(2, "0")}`;

      return {
        ghCode,
        operation: liveStatus.activeChannel ? `Injeksi Nutrisi Stok ${liveStatus.activeChannel}` : fwState,
        message: liveStatus.errorMessage || liveStatus.message || "Proses terhenti secara aman oleh sistem keamanan hardware.",
      };
    }
    return null;
  }, [liveStatus, fwState, ghs]);

  // -------------------------------------------------------------------------
  // Construct Independent Greenhouse Mixing Tanks (Section 7 Spec)
  // -------------------------------------------------------------------------
  const mixingTanks: GreenhouseTankInfo[] = useMemo(() => {
    return ghs.map((gh, idx) => {
      const displayName = formatGreenhouseName(gh, idx);
      const ghCode = displayName;
      const technicalId = gh.id;
      const tankName = `${displayName} Mixing Tank`;

      const isTargetActive = activeJob?.ghId === gh.id;
      const ghDeliveries: any[] = Array.isArray(liveStatus?.activeDeliveries) ? liveStatus.activeDeliveries : [];
      const hasDelivery = ghDeliveries.some((d) => (d.ghId || d.gh_id || "").toLowerCase() === gh.id.toLowerCase());

      // Check occurrences for this GH
      const occurrences: any[] = Array.isArray(liveStatus?.todaySchedule) ? liveStatus.todaySchedule : [];
      const ghOccReady = occurrences.find(
        (o) => (o.gh_id || o.ghId || "").toLowerCase() === gh.id.toLowerCase() && (o.state === "READY_TO_SEND" || o.state === 3)
      );
      const ghOccCompleted = occurrences.filter(
        (o) => (o.gh_id || o.ghId || "").toLowerCase() === gh.id.toLowerCase() && (o.state === "COMPLETED" || o.state === 5)
      );

      // Check if queued in FIFO queue
      const queueItem = liveQueue.find(
        (q) => (q.ghId || q.gh_id || "").toLowerCase() === gh.id.toLowerCase() && (q.status === "PENDING" || q.state === 0)
      );
      const queuePosition = queueItem ? liveQueue.indexOf(queueItem) + 1 : null;

      const scheds = allSchedules.filter((s) => s.ghId === gh.id);
      const upcomingSched = scheds
        .filter((s) => s.enabled && s.time && s.time !== "--:--")
        .map((s) => {
          const [h, m] = s.time.split(":").map(Number);
          return { sched: s, minutes: (h || 0) * 60 + (m || 0) };
        })
        .filter((item) => item.minutes >= currentMinutes)
        .sort((a, b) => a.minutes - b.minutes)[0]?.sched;

      const nextSched = upcomingSched;
      const capacityL = 300;

      let status: HumanMixingState = "Standby";
      let statusTone: GreenhouseTankInfo["statusTone"] = "slate";
      let statusDesc = "Siaga — belum ada proses aktif";
      let canDeliverNow = false;
      let canPreMixNow = true;
      let isActionDisabled = false;
      let actionDisabledReason: string | undefined = undefined;

      let timingLabel = "Status";
      let timingValue = "Siaga";

      if (hasDelivery) {
        status = "Fertigation in progress";
        statusTone = "purple";
        statusDesc = "Pompa distribusi sedang menyiram ke tanaman";
        timingLabel = "Penyiraman";
        timingValue = "Pompa Aktif Menyiram";
        canPreMixNow = false;
        isActionDisabled = true;
        actionDisabledReason = "Penyiraman sedang berlangsung";
      } else if (ghOccReady || (isTargetActive && fwState === "MIX_READY")) {
        status = "Ready for fertigation";
        statusTone = "emerald";
        statusDesc = "Larutan homogen & siap dialirkan ke dripper";
        timingLabel = "Kesiapan Larutan";
        timingValue = "Siap Dialirkan Sekarang";
        canDeliverNow = true;
        canPreMixNow = false;
      } else if (isTargetActive) {
        if (fwState === "FILLING" || fwState === "PRECHECK") {
          status = "Preparing water";
          statusTone = "blue";
          statusDesc = "Mengisi air baku dari toren ke tangki batch";
        } else if (fwState === "DOSING") {
          status = "Dosing nutrients";
          statusTone = "cyan";
          statusDesc = "Injeksi nutrisi A & B berlangsung di central unit";
        } else if (fwState === "FINAL_MIXING") {
          status = "Mixing";
          statusTone = "cyan";
          statusDesc = "Pengadukan & homogenisasi larutan di tangki";
        }
        timingLabel = "Status Operasi";
        timingValue = "Sedang Berjalan";
        canPreMixNow = false;
        isActionDisabled = true;
        actionDisabledReason = "Peracikan batch sedang berjalan";
      } else if (queueItem) {
        status = "Waiting in queue";
        statusTone = "amber";
        statusDesc = `Menunggu giliran di Unit Dosing Sentral (Urutan #${queuePosition})`;
        timingLabel = "Posisi Antrean";
        timingValue = `Urutan #${queuePosition} di Central`;
        canPreMixNow = false;
        isActionDisabled = true;
        const isAlreadyInQueue = Boolean(queueItem);
        actionDisabledReason = "Sudah terdaftar dalam antrean dosing";
      } else if (upcomingSched) {
        status = "Waiting for schedule";
        statusTone = "slate";
        statusDesc = `Standby menunggu jadwal berikutnya (Pukul ${upcomingSched.time})`;
        timingLabel = "Jadwal Mulai";
        timingValue = `Pukul ${upcomingSched.time}`;
        canPreMixNow = false;
        isActionDisabled = true;
        actionDisabledReason = `Otomatis dijadwalkan pukul ${upcomingSched.time} (Fail-Safe)`;
      } else if (ghOccCompleted.length > 0) {
        status = "Completed";
        statusTone = "emerald";
        statusDesc = "Semua siklus fertigasi hari ini telah selesai";
        timingLabel = "Status Siklus";
        timingValue = "Selesai Hari Ini";
        canPreMixNow = false;
        isActionDisabled = true;
        actionDisabledReason = "Semua siklus fertigasi hari ini telah selesai";
      } else {
        status = "Standby";
        statusTone = "slate";
        statusDesc = scheds.length > 0 ? "Jadwal hari ini sudah terlewat" : "Siaga — belum ada jadwal";
        timingLabel = "Status";
        timingValue = "Siaga";
        canPreMixNow = false;
        isActionDisabled = true;
        actionDisabledReason = "Tidak ada jadwal aktif untuk di-premix";
      }

      // Volume calculation & sensor availability check (Section 7 Spec)
      // NOTE: Do NOT use gh.telemetry?.tankL because tankL is the 1000L raw water reservoir!
      const mixingTankMeasuredL = (gh.telemetry as any)?.mixingTankL ?? null;
      const isSensorAvailable = typeof mixingTankMeasuredL === "number" && !isNaN(mixingTankMeasuredL);
      const measuredVolumeL = isSensorAvailable ? mixingTankMeasuredL : null;
      const targetWaterL = nextSched?.targetWaterL || scheds[0]?.targetWaterL || 50;

      let volumeDisplayLabel = "Target Pencampuran";
      let volumeDisplayValue = `Target: ${targetWaterL} L (Kapasitas: ${capacityL} L)`;
      let levelPct = 0;

      if (isSensorAvailable && measuredVolumeL !== null) {
        levelPct = capacityL > 0 ? (measuredVolumeL / capacityL) * 100 : 0;
        volumeDisplayLabel = "Volume Aktual Terukur";
        volumeDisplayValue = `${measuredVolumeL} / ${capacityL} L (${levelPct.toFixed(0)}%)`;
      } else if (status === "Ready for fertigation") {
        levelPct = Math.min(100, (targetWaterL / capacityL) * 100);
        volumeDisplayLabel = "Volume Larutan Siap";
        volumeDisplayValue = `${targetWaterL} L (Siap Disiram · Pelampung Aman)`;
      } else if (isTargetActive) {
        const actualWaterL = Math.round((liveStatus?.actualWaterMl || 0) / 1000);
        levelPct = Math.min(100, (actualWaterL / capacityL) * 100);
        volumeDisplayLabel = "Volume Terisi (Flow Meter ZJ-B1)";
        volumeDisplayValue = `${actualWaterL} / ${targetWaterL} L (Pengisian Volumetrik)`;
      } else {
        levelPct = 0;
        volumeDisplayLabel = "Volume Tangki Batch (Fail-Safe)";
        volumeDisplayValue = `0 / ${capacityL} L (0%) · Target: ${targetWaterL} L (Volumetrik Fail-Safe)`;
      }

      return {
        ghId: gh.id,
        ghCode,
        displayName,
        technicalId,
        crop: gh.crop,
        tankName,
        status,
        statusTone,
        statusDescription: statusDesc,
        measuredVolumeL,
        targetWaterL,
        capacityL,
        levelPct,
        isSensorAvailable,
        volumeDisplayLabel,
        volumeDisplayValue,
        timingLabel,
        timingValue,
        queuePosition,
        recipeName: gh.recipes?.[0]?.name,
        canDeliverNow,
        canPreMixNow,
        isActionDisabled,
        actionDisabledReason,
      };
    });
  }, [ghs, activeJob, fwState, liveStatus, liveQueue, allSchedules, currentMinutes]);

  // -------------------------------------------------------------------------
  // Construct Complex Overview Summaries (Section 10 Spec)
  // -------------------------------------------------------------------------
  const ghSummaries: GreenhouseFertigationSummary[] = useMemo(() => {
    return ghs.map((gh, idx) => {
      const tank = mixingTanks.find((t) => t.ghId === gh.id);
      const scheds = allSchedules.filter((s) => s.ghId === gh.id);
      const upcomingSched = scheds
        .filter((s) => s.enabled && s.time && s.time !== "--:--")
        .map((s) => {
          const [h, m] = s.time.split(":").map(Number);
          return { sched: s, minutes: (h || 0) * 60 + (m || 0) };
        })
        .filter((item) => item.minutes >= currentMinutes)
        .sort((a, b) => a.minutes - b.minutes)[0]?.sched;

      const nextSched = upcomingSched;
      const displayName = formatGreenhouseName(gh, idx);
      const ghCode = displayName;
      const technicalId = gh.id;

      let status: GreenhouseFertigationSummary["status"] = "STANDBY";
      let statusLabel = "Siaga";
      let statusTone: GreenhouseFertigationSummary["statusTone"] = "slate";
      let statusDesc = "Standby jam operasional";

      if (tank?.status === "Ready for fertigation") {
        status = "READY";
        statusLabel = "Larutan Siap";
        statusTone = "emerald";
        statusDesc = "Larutan nutrisi sudah siap di tangki batch";
      } else if (tank?.status === "Fertigation in progress") {
        status = "DISTRIBUTING";
        statusLabel = "Sedang Menyiram";
        statusTone = "purple";
        statusDesc = "Penyiraman ke tanaman sedang aktif";
      } else if (
        tank?.status === "Mixing" ||
        tank?.status === "Dosing nutrients" ||
        tank?.status === "Preparing water"
      ) {
        status = "MIXING";
        statusLabel = "Sedang Meracik";
        statusTone = "cyan";
        statusDesc = "Peracikan air & nutrisi aktif di central unit";
      } else if (tank?.status === "Waiting in queue") {
        status = "QUEUED";
        statusLabel = "Dalam Antrean";
        statusTone = "amber";
        statusDesc = `Menunggu giliran di Dosing Central (#${tank.queuePosition || 1})`;
      } else if (tank?.status === "Waiting for schedule") {
        status = "WAITING_SCHEDULE";
        statusLabel = "Menunggu Jadwal";
        statusTone = "slate";
        statusDesc = `Menunggu jadwal berikutnya (Pukul ${nextSched?.time || "—"})`;
      } else if (tank?.status === "Completed") {
        status = "COMPLETED";
        statusLabel = "Selesai";
        statusTone = "emerald";
        statusDesc = "Semua siklus fertigasi hari ini selesai";
      } else if (tank?.status === "Failed" || tank?.status === "Interrupted") {
        status = "ERROR";
        statusLabel = "Kendala Operasi";
        statusTone = "rose";
        statusDesc = "Peracikan batch gagal atau terhenti";
      }

      const occurrences: any[] = Array.isArray(liveStatus?.todaySchedule) ? liveStatus.todaySchedule : [];
      const ghCompletedOccurrences = occurrences.filter(
        (o) => (o.gh_id || o.ghId || "").toLowerCase() === gh.id.toLowerCase() && (o.state === "COMPLETED" || o.state === 5)
      );
      const schedsCompleted = scheds.filter((s) => s.lastRun && (s.status === "completed" || s.lastRun.includes("Today")));
      const cyclesCompletedToday = Math.max(ghCompletedOccurrences.length, schedsCompleted.length);
      const totalCyclesToday = scheds.filter((s) => s.enabled).length || scheds.length;

      return {
        gh,
        ghCode,
        displayName,
        technicalId,
        status,
        statusLabel,
        statusTone,
        statusDesc,
        nextScheduleTime: nextSched?.time || null,
        nextRecipeName: gh.recipes?.find((r) => r.id === nextSched?.recipeId)?.name || (nextSched ? "Nutrisi Standar" : null),
        targetWaterL: nextSched?.targetWaterL || null,
        cyclesCompletedToday,
        totalCyclesToday,
        tankLevelPct: tank?.levelPct || 0,
        volumeDisplay: tank?.volumeDisplayValue,
        canPreMix: tank?.canPreMixNow ?? false,
        canDeliver: tank?.canDeliverNow ?? false,
      };
    });
  }, [ghs, mixingTanks, allSchedules, liveStatus, currentMinutes]);

  // -------------------------------------------------------------------------
  // Actions: Enqueue Manual, Deliver, Abort, Trigger Daily
  // -------------------------------------------------------------------------
  const handlePreMixGh = async (ghId: string) => {
    setActionInProgress(`premix-${ghId}`);
    try {
      const gh = greenhouseService.get(ghId);
      const recipe = gh?.recipes?.[0];
      const sched = allSchedules.find((s) => s.ghId === ghId);
      const targetWater = sched?.targetWaterL || recipe?.waterL || 50;

      if (!recipe) throw new Error("Belum ada resep nutrisi untuk greenhouse ini.");

      // Check if already in queue or active to prevent duplicate submissions
      const isAlreadyInQueue = liveQueue.some(
        (q) => (q.ghId || q.gh_id) === ghId && (q.status === "PENDING" || q.status === "DISPATCHED" || q.status === "ACTIVE")
      );
      if (isAlreadyInQueue) {
        throw new Error(`${gh?.code || ghId} sudah terdaftar dalam antrean dosing.`);
      }

      await fertigationService.startManual(ghId, recipe.id, targetWater);
      toast(`Peracikan nutrisi untuk ${gh?.code || ghId} berhasil dimasukkan ke antrean!`, "success");
      await fetchStatus(true);
    } catch (err: any) {
      toast(`Gagal menambahkan antrean: ${err?.message || "Kesalahan kontroler"}`, "error");
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
              <h2
                className="text-[14px] font-bold tracking-tight text-slate-100 cursor-default"
                title="Alur operasional terintegrasi: Jadwal → Antrean FIFO Dosing Sentral → Tangki Pencampur GH → Irigasi Tanaman"
              >
                Sistem Fertigasi & Antrean Peracikan (Fertigation & Mixing System)
              </h2>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                {complex?.name || "Complex"}
              </span>
            </div>
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
              Otomasi Harian: Aktif
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
            {offline ? "ESP32 Offline (Cache Lokal)" : "ESP32 Telemetri Otoritatif"}
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
        {/* 1. Dosing Queue Section (Central Unit 3-Step Progress & FIFO Dosing Queue List) */}
        <DosingQueueSection
          activeJob={activeJob}
          queuedJobs={queuedJobs}
          nextScheduledOp={nextScheduledOp}
          errorInfo={errorInfo}
          onAbortActive={handleAbort}
          onSyncQueue={handleTriggerQueueSync}
          isActionLoading={actionInProgress !== null}
          isSyncingQueue={isAwaitingQueueSync}
          syncCountdownSec={syncCountdown}
          isMultiGh={ghs.length > 1}
        />

        {/* 3. Independent Greenhouse Mixing Tanks (Section 7) */}
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
          isActionLoading={actionInProgress !== null}
          activeJob={activeJob}
          queuedJobs={queuedJobs}
          liveStatus={liveStatus}
          liveQueue={liveQueue}
        />
      </div>
    </section>
  );
}
