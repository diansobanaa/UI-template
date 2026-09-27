"use client";

/**
 * LAYER-C (Task 9): Fertigation runtime panels — Entity 3/4/5/6 1:1 with firmware.
 *
 * Panel mapping ke 6 entitas (per spec §5/§6/§17):
 *   - TodayOccurrencesPanel     → Entity 3 (OccurrenceEntry)
 *   - MixingBatchesPanel        → Entity 5 (MixingBatch) — gabungan Panel 2+3
 *   - DistributionPanel         → Entity 6 (DeliverySlotEntry — active run)
 *   - FertigationHistoryPanel   → Entity 6 terminal (Layer H reconstruct from /events)
 *   - DosingQueuePanelThin      → Entity 4 (DosingQueueEntry)
 *
 * Sumber otoritatif: GET /api/v1/fertigation/status + GET /api/v1/fertigation/queue
 * Polling: 3 detik (sama dengan DosingQueueCard).
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Beaker,
  CalendarClock,
  CheckCircle2,
  Droplets,
  FlaskConical,
  History,
  Layers,
  ListOrdered,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  WifiOff,
  Zap,
} from "lucide-react";
import { esp32Client } from "@/lib/api/esp32-client";
import { Badge, Button, Progress, StatusBadge } from "@/components/ui/primitives";
import { SectionCard } from "@/components/ui/cards";
import type {
  DeliverySlotEntry,
  DeliverySlotState,
  FertigationFailureType,
  FertigationPhaseName,
  FertigationRuntimeState,
  FertigationRun,
  MixingBatch,
  OccurrenceEntry,
  OccurrenceState,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Util — pemetaan state ke label warna untuk badge                    */
/* ------------------------------------------------------------------ */

const RUNTIME_STATE_TONE: Record<FertigationRuntimeState, { label: string; tone: "gray" | "blue" | "green" | "amber" | "red" | "purple" | "sky"; pulse?: boolean }> = {
  IDLE: { label: "IDLE", tone: "gray" },
  RECOVERY_HOLD: { label: "RECOVERY HOLD", tone: "amber", pulse: true },
  PRECHECK: { label: "PRECHECK", tone: "blue", pulse: true },
  FILLING: { label: "FILLING", tone: "blue", pulse: true },
  DOSING: { label: "DOSING", tone: "green", pulse: true },
  FINAL_MIXING: { label: "FINAL MIXING", tone: "sky", pulse: true },
  MIX_READY: { label: "MIX READY", tone: "sky" },
  DELIVERY: { label: "DELIVERY", tone: "purple" },
  COMPLETE: { label: "COMPLETE", tone: "green" },
  INTERRUPTED: { label: "INTERRUPTED", tone: "amber" },
  FAULTED: { label: "FAULTED", tone: "red" },
  ABORTED: { label: "ABORTED", tone: "gray" },
};

const OCCURRENCE_STATE_TONE: Record<OccurrenceState, { label: string; tone: "gray" | "blue" | "green" | "amber" | "red" | "purple" | "sky"; pulse?: boolean }> = {
  PENDING: { label: "PENDING", tone: "gray" },
  PREPARING: { label: "PREPARING", tone: "blue", pulse: true },
  WAITING_BATCH: { label: "WAITING BATCH", tone: "amber", pulse: true },
  READY_TO_SEND: { label: "READY TO SEND", tone: "sky" },
  DISTRIBUTING: { label: "DISTRIBUTING", tone: "purple", pulse: true },
  COMPLETED: { label: "COMPLETED", tone: "green" },
  FAILED: { label: "FAILED", tone: "red" },
};

const DELIVERY_STATE_TONE: Record<DeliverySlotState, { label: string; tone: "gray" | "blue" | "green" | "amber" | "red" | "purple" | "sky"; pulse?: boolean }> = {
  FREE: { label: "FREE", tone: "gray" },
  READY_TO_SEND: { label: "READY TO SEND", tone: "sky" },
  DISTRIBUTING: { label: "DISTRIBUTING", tone: "purple", pulse: true },
  COMPLETE: { label: "COMPLETE", tone: "green" },
  FAULTED: { label: "FAULTED", tone: "red" },
};

/* ------------------------------------------------------------------ */
/* Helper: map raw firmware state string to FertigationRuntimeState    */
/* ------------------------------------------------------------------ */
function mapFwState(raw: string | undefined): FertigationRuntimeState {
  if (!raw) return "IDLE";
  const normalized = raw.replace(/^FERT_STATE_/, "").toUpperCase();
  const validStates: FertigationRuntimeState[] = [
    "IDLE", "RECOVERY_HOLD", "PRECHECK", "FILLING", "DOSING",
    "FINAL_MIXING", "MIX_READY", "DELIVERY", "COMPLETE",
    "INTERRUPTED", "FAULTED", "ABORTED"
  ];
  return (validStates as string[]).includes(normalized)
    ? normalized as FertigationRuntimeState
    : "IDLE";
}

/* ------------------------------------------------------------------ */
/* Hook: useFertigationStatus — polling 3s                             */
/* ------------------------------------------------------------------ */
function useFertigationStatus() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [offline, setOffline] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const data = await esp32Client.getFertigationStatus();
        if (cancelled) return;
        setStatus(data);
        setOffline(false);
        setLastUpdated(new Date());
      } catch {
        if (!cancelled) setOffline(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return { status, loading, offline, lastUpdated };
}

/* ------------------------------------------------------------------ */
/* Shared: OfflineBanner + LoadingSkeleton                             */
/* ------------------------------------------------------------------ */
function OfflineBanner({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
      <WifiOff className="h-4 w-4" />
      <span>ESP32 offline — data mungkin tidak aktual</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-auto text-amber-200 underline">
          Retry
        </button>
      )}
    </div>
  );
}

function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400">
      <RefreshCw className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel 1 — TodayOccurrencesPanel (Entity 3)                          */
/* ------------------------------------------------------------------ */
interface TodayOccurrencesPanelProps {
  selectedGhId?: string;
  ghCodeMap?: Record<string, string>;
}

export function TodayOccurrencesPanel({ selectedGhId, ghCodeMap = {} }: TodayOccurrencesPanelProps) {
  const { status, loading, offline, lastUpdated } = useFertigationStatus();

  const occurrences: OccurrenceEntry[] = useMemo(() => {
    if (!status?.todaySchedule) return [];
    const all: OccurrenceEntry[] = (status.todaySchedule as any[]).map((o: any) => ({
      occurrenceId: o.occurrenceId || o.occurrence_id || "",
      scheduleId: o.scheduleId || o.schedule_id || "",
      complexId: o.complexId || o.complex_id,
      ghId: o.ghId || o.gh_id || "",
      scheduledTimestamp: o.scheduledTimestamp || o.scheduled_timestamp || 0,
      state: (o.state || o.status || "PENDING").toUpperCase() as OccurrenceState,
      queueId: o.queueId || o.queue_id,
      batchId: o.batchId || o.batch_id,
      waitingReason: o.waitingReason || o.waiting_reason,
    }));
    if (!selectedGhId) return all;
    return all.filter((o) => o.ghId.toLowerCase() === selectedGhId.toLowerCase());
  }, [status, selectedGhId]);

  return (
    <SectionCard
      title="Today's Occurrences"
      icon={CalendarClock}
      iconTone="blue"
      subtitle={`Entity 3 — dari /fertigation/status todaySchedule[]${lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString("id-ID")}` : ""}`}
      action={<Badge tone="blue">{occurrences.length} occurrences</Badge>}
    >
      {offline ? (
        <>
          <OfflineBanner />
          <LoadingSkeleton label="Menunggu ESP32 online…" />
        </>
      ) : loading ? (
        <LoadingSkeleton label="Memuat occurrences…" />
      ) : occurrences.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#0b2027]/[0.025] px-4 py-6 text-center">
          <CalendarClock className="mx-auto mb-2 h-5 w-5 text-slate-500/60" />
          <p className="text-sm text-slate-400">Tidak ada occurrence terjadwal hari ini.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[12px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Scheduled</th>
                <th className="px-3 py-2">GH</th>
                <th className="px-3 py-2">Occurrence ID</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Waiting Reason</th>
              </tr>
            </thead>
            <tbody>
              {occurrences.map((occ) => {
                const ghCode = ghCodeMap[occ.ghId] || occ.ghId;
                const cfg = OCCURRENCE_STATE_TONE[occ.state] || { label: occ.state, tone: "gray" as const };
                const scheduled = occ.scheduledTimestamp
                  ? new Date(occ.scheduledTimestamp).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
                  : "—";
                return (
                  <tr key={occ.occurrenceId} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{scheduled}</td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{ghCode}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-slate-400">{occ.occurrenceId.slice(0, 12)}…</td>
                    <td className="px-3 py-2">
                      <Badge tone={cfg.tone} pulse={cfg.pulse}>{cfg.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-[12px]">{occ.waitingReason || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Panel 2+3 — MixingBatchesPanel (Entity 5)                           */
/* ------------------------------------------------------------------ */
interface MixingBatchesPanelProps {
  selectedGhId?: string;
  ghCodeMap?: Record<string, string>;
  onAbort?: (runId: string) => void;
  onTriggerDistribution?: (ghId: string, occurrenceId: string) => void;
}

export function MixingBatchesPanel({ selectedGhId, ghCodeMap = {}, onAbort, onTriggerDistribution }: MixingBatchesPanelProps) {
  const { status, loading, offline, lastUpdated } = useFertigationStatus();
  const [aborting, setAborting] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);

  const activeBatch: MixingBatch | null = useMemo(() => {
    if (!status) return null;
    const state = mapFwState(status.state || status.phase);
    if (state === "IDLE") return null;
    return {
      runId: status.runId || "",
      batchId: status.batchId || status.runId || "",
      complexId: status.complexId || "",
      ghId: status.ghId || "",
      scheduleId: status.scheduleId,
      recipeId: status.recipeId,
      configurationVersion: status.configurationVersion || 0,
      state,
      phaseTimestamps: status.phaseTimestamps,
      startTimestampMs: status.startTimestampMs || 0,
      targetWaterMl: status.targetWaterMl || 0,
      actualWaterMl: status.actualWaterMl || 0,
      thresholdPercent: status.thresholdPercent,
      dosingChannels: status.dosingChannels || [],
      fault: status.fault,
    };
  }, [status]);

  // Filter by selectedGhId
  const isVisible = !selectedGhId || !activeBatch ||
    activeBatch.ghId.toLowerCase() === selectedGhId.toLowerCase();

  const handleAbort = async (runId: string) => {
    setAborting(runId);
    try {
      await esp32Client.stopFertigation();
      onAbort?.(runId);
    } catch (e) {
      console.error("[MixingBatchesPanel] Abort failed:", e);
    } finally {
      setAborting(null);
    }
  };

  const handleTrigger = async (ghId: string, occurrenceId: string) => {
    setTriggering(occurrenceId);
    try {
      await esp32Client.triggerDistribution(ghId, occurrenceId);
      onTriggerDistribution?.(ghId, occurrenceId);
    } catch (e) {
      console.error("[MixingBatchesPanel] Trigger distribution failed:", e);
    } finally {
      setTriggering(null);
    }
  };

  const phases: FertigationPhaseName[] = ["PRECHECK", "FILLING", "DOSING", "FINAL_MIXING", "MIX_READY"];
  const getPhaseStatus = (phase: FertigationPhaseName, currentState: FertigationRuntimeState): "done" | "active" | "pending" => {
    const phaseOrder: FertigationPhaseName[] = ["PRECHECK", "FILLING", "DOSING", "FINAL_MIXING", "MIX_READY", "DELIVERY", "COMPLETE"];
    const currentIdx = phaseOrder.indexOf(currentState as FertigationPhaseName);
    const phaseIdx = phaseOrder.indexOf(phase);
    if (currentIdx < 0 || phaseIdx < 0) return "pending";
    if (phaseIdx < currentIdx) return "done";
    if (phaseIdx === currentIdx) return "active";
    return "pending";
  };

  return (
    <SectionCard
      title="Active Mixing Batches"
      icon={FlaskConical}
      iconTone="green"
      subtitle={`Entity 5 — preparation slots${lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString("id-ID")}` : ""}`}
      action={activeBatch && isVisible ? <Badge tone={RUNTIME_STATE_TONE[activeBatch.state].tone} pulse={RUNTIME_STATE_TONE[activeBatch.state].pulse}>{RUNTIME_STATE_TONE[activeBatch.state].label}</Badge> : undefined}
    >
      {offline ? (
        <>
          <OfflineBanner />
          <LoadingSkeleton label="Menunggu ESP32 online…" />
        </>
      ) : loading ? (
        <LoadingSkeleton label="Memuat active batches…" />
      ) : !activeBatch || !isVisible ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#0b2027]/[0.025] px-4 py-6 text-center">
          <FlaskConical className="mx-auto mb-2 h-5 w-5 text-slate-500/60" />
          <p className="text-sm text-slate-400">Tidak ada mixing batch aktif.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Batch header */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-white">{ghCodeMap[activeBatch.ghId] || activeBatch.ghId}</div>
              <div className="text-[12px] text-slate-400 font-mono">run: {activeBatch.runId.slice(0, 16)}…</div>
            </div>
            <div className="flex gap-2">
              {activeBatch.state === "MIX_READY" && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleTrigger(activeBatch.ghId, activeBatch.batchId)}
                  disabled={triggering === activeBatch.batchId}
                >
                  {triggering === activeBatch.batchId ? "Starting…" : "Start Distribution"}
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleAbort(activeBatch.runId)}
                disabled={aborting === activeBatch.runId}
              >
                {aborting === activeBatch.runId ? "Aborting…" : "Abort"}
              </Button>
            </div>
          </div>

          {/* 5-step timeline */}
          <div className="grid grid-cols-5 gap-2">
            {phases.map((phase) => {
              const phaseStatus = getPhaseStatus(phase, activeBatch.state);
              const tone = phaseStatus === "done" ? "green" : phaseStatus === "active" ? "blue" : "gray";
              return (
                <div key={phase} className={`rounded-lg border px-3 py-2 text-center ${
                  phaseStatus === "done" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" :
                  phaseStatus === "active" ? "border-blue-500/30 bg-blue-500/10 text-blue-300 animate-pulse" :
                  "border-slate-700 bg-slate-800/50 text-slate-500"
                }`}>
                  <div className="text-[10px] uppercase tracking-wide">{phase.replace("_", " ")}</div>
                  <div className="mt-1 text-[10px]">
                    {phaseStatus === "done" ? "✓" : phaseStatus === "active" ? "●" : "○"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Real telemetry */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Target Water</div>
              <div className="text-lg font-bold text-slate-200">{activeBatch.targetWaterMl > 0 ? `${(activeBatch.targetWaterMl / 1000).toFixed(1)} L` : "—"}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Actual Water</div>
              <div className="text-lg font-bold text-slate-200">{activeBatch.actualWaterMl > 0 ? `${(activeBatch.actualWaterMl / 1000).toFixed(1)} L` : "Unavailable"}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Threshold</div>
              <div className="text-lg font-bold text-slate-200">{activeBatch.thresholdPercent ?? 20}%</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Dosing Channels</div>
              <div className="text-lg font-bold text-slate-200">{activeBatch.dosingChannels?.length || 0}</div>
            </div>
          </div>

          {/* Progress bar */}
          {activeBatch.targetWaterMl > 0 && activeBatch.actualWaterMl > 0 && (
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                <span>Raw Water Fill Progress</span>
                <span>{Math.round((activeBatch.actualWaterMl / activeBatch.targetWaterMl) * 100)}%</span>
              </div>
              <Progress value={Math.min(100, (activeBatch.actualWaterMl / activeBatch.targetWaterMl) * 100)} color="bg-blue-500" />
            </div>
          )}

          {/* Fault code */}
          {activeBatch.fault && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertTriangle className="h-4 w-4" />
              <span>Fault: <span className="font-mono">{activeBatch.fault}</span></span>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Panel 4 — DistributionPanel (Entity 6 active run)                   */
/* ------------------------------------------------------------------ */
interface DistributionPanelProps {
  selectedGhId?: string;
  ghCodeMap?: Record<string, string>;
  onStop?: () => void;
}

export function DistributionPanel({ selectedGhId, ghCodeMap = {}, onStop }: DistributionPanelProps) {
  const { status, loading, offline, lastUpdated } = useFertigationStatus();
  const [stopping, setStopping] = useState(false);

  const deliveries: DeliverySlotEntry[] = useMemo(() => {
    if (!status?.activeDeliveries) return [];
    const all: DeliverySlotEntry[] = (status.activeDeliveries as any[]).map((d: any) => ({
      ghId: d.ghId || d.gh_id || "",
      occurrenceId: d.occurrenceId || d.occurrence_id || "",
      batchId: d.batchId || d.batch_id || "",
      state: (d.state || d.status || "FREE").toUpperCase() as DeliverySlotState,
      deliveryPumpId: d.deliveryPumpId || d.delivery_pump_id,
      fault: d.fault,
    }));
    if (!selectedGhId) return all;
    return all.filter((d) => d.ghId.toLowerCase() === selectedGhId.toLowerCase());
  }, [status, selectedGhId]);

  const handleStop = async () => {
    setStopping(true);
    try {
      await esp32Client.stopFertigation();
      onStop?.();
    } catch (e) {
      console.error("[DistributionPanel] Stop failed:", e);
    } finally {
      setStopping(false);
    }
  };

  // Also include top-level delivery telemetry from status (for current distributing batch)
  const currentDelivery = status?.delivery?.status === "DISTRIBUTING" ? status : null;

  return (
    <SectionCard
      title="Active Fertigation Runs (Distribution)"
      icon={Droplets}
      iconTone="violet"
      subtitle={`Entity 6 — active deliveries${lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString("id-ID")}` : ""}`}
      action={deliveries.length > 0 ? <Badge tone="purple" pulse>{deliveries.length} active</Badge> : undefined}
    >
      {offline ? (
        <>
          <OfflineBanner />
          <LoadingSkeleton label="Menunggu ESP32 online…" />
        </>
      ) : loading ? (
        <LoadingSkeleton label="Memuat deliveries…" />
      ) : deliveries.length === 0 && !currentDelivery ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#0b2027]/[0.025] px-4 py-6 text-center">
          <Droplets className="mx-auto mb-2 h-5 w-5 text-slate-500/60" />
          <p className="text-sm text-slate-400">Tidak ada distribusi aktif.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Current delivery telemetry (top-level) */}
          {currentDelivery && (
            <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-purple-200">FERTIGATING</div>
                <Button size="sm" variant="danger" onClick={handleStop} disabled={stopping}>
                  {stopping ? "Stopping…" : "Stop Distribution"}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Actual Flow</div>
                  <div className="text-lg font-bold text-white">
                    {status.actualFlowLpm != null ? `${status.actualFlowLpm.toFixed(2)} L/min` : "Unavailable"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Target Flow</div>
                  <div className="text-lg font-bold text-white">
                    {status.targetFlowLpm != null ? `${status.targetFlowLpm.toFixed(2)} L/min` : "Unavailable"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Delivered</div>
                  <div className="text-lg font-bold text-white">
                    {status.actualDeliveredMl != null ? `${(status.actualDeliveredMl / 1000).toFixed(2)} L` : "Unavailable"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Target</div>
                  <div className="text-lg font-bold text-white">
                    {status.deliveryTargetMl != null ? `${(status.deliveryTargetMl / 1000).toFixed(2)} L` : "Unavailable"}
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              {status.deliveryTargetMl != null && status.actualDeliveredMl != null && status.deliveryTargetMl > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                    <span>Distribution Progress</span>
                    <span>{Math.round((status.actualDeliveredMl / status.deliveryTargetMl) * 100)}%</span>
                  </div>
                  <Progress value={Math.min(100, (status.actualDeliveredMl / status.deliveryTargetMl) * 100)} color="bg-purple-500" />
                </div>
              )}
            </div>
          )}

          {/* Delivery slot entries table */}
          {deliveries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[12px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2">GH</th>
                    <th className="px-3 py-2">Batch</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Pump</th>
                    <th className="px-3 py-2">Fault</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d, i) => {
                    const cfg = DELIVERY_STATE_TONE[d.state] || { label: d.state, tone: "gray" as const };
                    return (
                      <tr key={`${d.ghId}-${d.batchId}-${i}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-3 py-2 text-slate-300">{ghCodeMap[d.ghId] || d.ghId}</td>
                        <td className="px-3 py-2 font-mono text-[12px] text-slate-400">{d.batchId.slice(0, 12)}…</td>
                        <td className="px-3 py-2"><Badge tone={cfg.tone} pulse={cfg.pulse}>{cfg.label}</Badge></td>
                        <td className="px-3 py-2 text-slate-400 text-[12px] font-mono">{d.deliveryPumpId || "—"}</td>
                        <td className="px-3 py-2 text-red-300 text-[12px] font-mono">{d.fault || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Panel 6 — FertigationHistoryPanel (Entity 6 terminal)               */
/* LAYER-H: Reconstruct historical fertigation runs dari /events.      */
/* ------------------------------------------------------------------ */

function mapFaultToFailureType(
  fault: string | undefined,
  terminalState: "COMPLETE" | "FAULTED" | "ABORTED" | "INTERRUPTED" | undefined
): FertigationFailureType | undefined {
  if (!fault && !terminalState) return undefined;
  if (terminalState === "COMPLETE") return undefined;
  if (terminalState === "ABORTED") return "SAFETY_STOP";
  if (terminalState === "INTERRUPTED") return "NETWORK_INTERRUPTION";

  const f = (fault || "").toUpperCase();
  if (!f) return undefined;

  if (f.includes("TANK_LOW") || f.includes("TAMPER") || f.includes("SAFETY") || f.includes("E-STOP") || f.includes("EMERGENCY")) return "SAFETY_STOP";
  if (f.includes("FLOW_FAULT") || f.includes("FLOW_UNAVAILABLE") || f.includes("FLOW_MEASUREMENT")) return "FLOW_ERROR";
  if (f.includes("PRECHECK")) return "PRECHECK_FAILED";
  if (f.includes("DELIVERY") || f.includes("DISTRIBUTION")) return "DISTRIBUTION_FAILED";
  if (f.includes("DOSING")) return "DOSING_FAILED";
  if (f.includes("MIXING") || f.includes("FINAL_MIXING")) return "MIXING_FAILED";
  if (f.includes("RESOURCE_LOCKED") || f.includes("UNAVAILABLE") || f.includes("REJECTED")) return "RESOURCE_UNAVAILABLE";
  if (f.includes("CONFIG") || f.includes("MISSING_")) return "CONFIG_ERROR";
  return "MIXING_FAILED";
}

interface FertigationHistoryPanelProps {
  selectedGhId?: string;
  ghCodeMap?: Record<string, string>;
}

export function FertigationHistoryPanel({ selectedGhId, ghCodeMap = {} }: FertigationHistoryPanelProps) {
  const [history, setHistory] = useState<FertigationRun[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [offline, setOffline] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      try {
        const res = await esp32Client.getEvents(undefined, 200);
        if (cancelled) return;
        const events: any[] = Array.isArray(res?.events) ? res.events : [];
        setOffline(false);

        const fertEvents = events.filter((e: any) => {
          const eventType = (e.eventType || e.event_type || e.code || "").toUpperCase();
          return eventType.includes("FERTIGATION") ||
                 eventType.includes("BATCH_FAILED") ||
                 eventType.includes("BATCH_CANCELLED") ||
                 eventType.includes("MIXING_CREATED") ||
                 eventType.includes("FERTIGATION_DELIVERED");
        });

        const runsMap = new Map<string, FertigationRun>();
        for (const ev of fertEvents) {
          const eventType = (ev.eventType || ev.event_type || ev.code || "").toUpperCase();
          const runId: string = ev.runId || ev.run_id || ev.metadata?.runId || "";
          const ghId: string = ev.ghId || ev.gh_id || ev.metadata?.ghId || "";
          const complexId: string = ev.complexId || ev.complex_id || ev.metadata?.complexId || "";
          const timestamp: number = ev.timestamp || ev.deviceTimestamp || ev.at ? Date.parse(ev.timestamp || ev.deviceTimestamp || ev.at) : 0;
          const fault: string | undefined = ev.fault || ev.metadata?.fault || (eventType === "BATCH_FAILED" ? ev.message : undefined);

          if (!runId) continue;

          let run = runsMap.get(runId);
          if (!run) {
            run = {
              runId, complexId, ghId, startTimestampMs: timestamp,
              triggerType: ev.triggerType || ev.source, source: ev.source,
            };
            runsMap.set(runId, run);
          }

          if (eventType === "MIXING_CREATED") {
            run.startTimestampMs = timestamp;
            run.triggerType = ev.triggerType || ev.source;
          } else if (eventType === "FERTIGATION_RUN_COMPLETED") {
            run.terminalState = "COMPLETE";
            run.endTimestampMs = timestamp;
            run.durationSec = run.endTimestampMs && run.startTimestampMs ? Math.round((run.endTimestampMs - run.startTimestampMs) / 1000) : undefined;
          } else if (eventType === "BATCH_FAILED") {
            run.terminalState = "FAULTED";
            run.fault = fault;
            run.failureType = mapFaultToFailureType(fault, "FAULTED");
            run.endTimestampMs = timestamp;
            run.durationSec = run.endTimestampMs && run.startTimestampMs ? Math.round((run.endTimestampMs - run.startTimestampMs) / 1000) : undefined;
          } else if (eventType === "BATCH_CANCELLED") {
            run.terminalState = "ABORTED";
            run.endTimestampMs = timestamp;
            run.failureType = "SAFETY_STOP";
            run.durationSec = run.endTimestampMs && run.startTimestampMs ? Math.round((run.endTimestampMs - run.startTimestampMs) / 1000) : undefined;
          } else if (eventType === "EMERGENCY_STOP") {
            run.terminalState = "INTERRUPTED";
            run.fault = "EMERGENCY_STOP";
            run.failureType = "SAFETY_STOP";
            run.endTimestampMs = timestamp;
          } else if (eventType === "FERTIGATION_DELIVERED") {
            run.actualDeliveredMl = ev.actualDeliveredMl || ev.metadata?.actualDeliveredMl;
            run.deliveryTargetMl = ev.deliveryTargetMl || ev.metadata?.deliveryTargetMl;
          }
        }

        let runs = Array.from(runsMap.values());
        if (selectedGhId) {
          runs = runs.filter((r) => r.ghId?.toLowerCase() === selectedGhId.toLowerCase());
        }
        runs.sort((a, b) => (b.startTimestampMs || 0) - (a.startTimestampMs || 0));
        runs = runs.slice(0, 50);

        setHistory(runs);
        setLastUpdated(new Date());
      } catch {
        if (!cancelled) setOffline(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchHistory();
    const interval = setInterval(fetchHistory, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedGhId]);

  const fmtDate = (ms: number | undefined): string => {
    if (!ms || ms <= 0) return "—";
    try {
      return new Date(ms).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  };
  const fmtDuration = (sec: number | undefined): string => {
    if (!sec || sec <= 0) return "—";
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  return (
    <SectionCard
      title="Fertigation History"
      icon={History}
      iconTone="slate"
      subtitle={`Entity 6 terminal — reconstructed from /events${lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString("id-ID")}` : ""}`}
      action={<Badge tone="gray">{history.length} runs</Badge>}
    >
      {offline ? (
        <>
          <OfflineBanner />
          <LoadingSkeleton label="Menunggu ESP32 online…" />
        </>
      ) : loading ? (
        <LoadingSkeleton label="Memuat history fertigation…" />
      ) : history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#0b2027]/[0.025] px-4 py-8 text-center">
          <History className="mx-auto mb-2 h-5 w-5 text-slate-500/60" />
          <p className="text-sm text-slate-400">Belum ada riwayat fertigation tersedia.</p>
          <p className="mt-1 text-[12px] text-slate-500">
            History di-reconstruct dari <span className="font-mono">/api/v1/events</span>.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[12px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">GH</th>
                <th className="px-3 py-2">Run ID</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Failure Type</th>
                <th className="px-3 py-2">Fault</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => {
                const ghCode = run.ghId ? (ghCodeMap[run.ghId] || run.ghId) : "—";
                const terminalBadge: Record<string, { label: string; tone: "green" | "red" | "amber" | "gray" }> = {
                  COMPLETE: { label: "COMPLETED", tone: "green" },
                  FAULTED: { label: "FAILED", tone: "red" },
                  ABORTED: { label: "ABORTED", tone: "gray" },
                  INTERRUPTED: { label: "INTERRUPTED", tone: "amber" },
                };
                const badge = run.terminalState ? terminalBadge[run.terminalState] : { label: "—", tone: "gray" as const };
                return (
                  <tr key={run.runId} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{fmtDate(run.startTimestampMs)}</td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{ghCode}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-slate-400">{run.runId.slice(0, 12)}…</td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{fmtDuration(run.durationSec)}</td>
                    <td className="px-3 py-2"><Badge tone={badge.tone}>{badge.label}</Badge></td>
                    <td className="px-3 py-2 text-slate-400 text-[12px]">{run.failureType || "—"}</td>
                    <td className="px-3 py-2 text-slate-400 text-[12px] font-mono">{run.fault || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * LAYER-H: Backward-compat alias.
 */
export function FertigationHistoryPlaceholder(props: FertigationHistoryPanelProps = {}) {
  return <FertigationHistoryPanel {...props} />;
}

/* ------------------------------------------------------------------ */
/* Panel 5 — DosingQueuePanelThin (Entity 4)                            */
/* ------------------------------------------------------------------ */
interface DosingQueuePanelThinProps {
  selectedGhId?: string;
  ghCodeMap?: Record<string, string>;
}

export function DosingQueuePanelThin({ selectedGhId, ghCodeMap = {} }: DosingQueuePanelThinProps) {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [offline, setOffline] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const fetchQueue = async () => {
      try {
        const res = await esp32Client.getFertigationQueue();
        if (cancelled) return;
        const entries = Array.isArray(res?.queuedBatches) ? res.queuedBatches : [];
        setQueue(entries);
        setOffline(false);
      } catch {
        if (!cancelled) setOffline(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const entries = useMemo(() => {
    if (!selectedGhId) return queue;
    return queue.filter((q: any) => q?.ghId?.toLowerCase() === selectedGhId.toLowerCase());
  }, [queue, selectedGhId]);

  return (
    <SectionCard
      title="Dosing Queue"
      icon={ListOrdered}
      iconTone="amber"
      subtitle="Entity 4 — antrean dosing dari /fertigation/queue queuedBatches[]"
      action={<Badge tone="amber" pulse>{entries.length} queued</Badge>}
    >
      {offline ? (
        <>
          <OfflineBanner />
          <LoadingSkeleton label="Menunggu ESP32 online…" />
        </>
      ) : loading ? (
        <LoadingSkeleton label="Memuat antrean dosing…" />
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-[#0b2027]/[0.025] px-4 py-6 text-center">
          <ListOrdered className="mx-auto mb-2 h-5 w-5 text-slate-500/60" />
          <p className="text-sm text-slate-400">Antrean dosing kosong.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[12px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">GH</th>
                <th className="px-3 py-2">Queue ID</th>
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2">State</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((q: any, i: number) => {
                const state = (q.state || q.status || "PENDING").toUpperCase();
                const tone = state === "ACTIVE" ? "green" : state === "DISPATCHED" ? "blue" : state === "COMPLETED" ? "green" : state === "FAILED" ? "red" : "amber";
                return (
                  <tr key={q.queueId || q.queue_id || i} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-slate-300">{ghCodeMap[q.ghId || q.gh_id] || q.ghId || q.gh_id}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-slate-400">{(q.queueId || q.queue_id || "").slice(0, 12)}…</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-slate-400">{(q.batchId || q.batch_id || "").slice(0, 12)}…</td>
                    <td className="px-3 py-2"><Badge tone={tone as any} pulse={state === "ACTIVE" || state === "DISPATCHED"}>{state}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
