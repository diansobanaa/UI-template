"use client";

import React from "react";
import {
  Activity,
  AlertTriangle,
  Beaker,
  CheckCircle2,
  Clock,
  Droplets,
  Layers,
  ListOrdered,
  PauseCircle,
  Play,
  RotateCcw,
  RefreshCw,
  Sparkles,
  StopCircle,
  Wrench,
  X,
} from "lucide-react";
import { resolveFertigationError } from "@/lib/fertigationErrorMap";

export interface OperationalStep {
  stepNumber: number;
  name: string;
  description: string;
  status: "COMPLETED" | "RUNNING" | "WAITING" | "FAILED";
  details?: string;
  progressPct?: number;
}

export interface DosingQueueJob {
  id: string;
  scheduleId?: string;
  ghId: string;
  ghCode: string;
  ghName: string;
  jobTitle: string;
  recipeName: string;
  targetWaterL: number;
  targetWaterMl: number;
  dosingAml: number;
  dosingBml: number;
  mixingDurationSec: number;
  scheduledTimeStr: string;
  queuePosition: number; // 0 = Active, 1 = Next in line, etc.
  status: "ACTIVE" | "PENDING_FIFO" | "WAITING_SCHEDULE" | "COMPLETED" | "FAILED" | "BLOCKED";
  statusLabel: string;
  steps: OperationalStep[];
  errorCode?: string;
  affectedComponent?: string;
}

export interface NextScheduledOperation {
  ghCode: string;
  ghName: string;
  time: string;
  jobTitle: string;
}

export interface DosingErrorInfo {
  ghCode: string;
  operation: string;
  message: string;
}

interface DosingQueueSectionProps {
  activeJob: DosingQueueJob | null;
  queuedJobs: DosingQueueJob[];
  blockedJobs?: DosingQueueJob[];
  nextScheduledOp?: NextScheduledOperation | null;
  errorInfo?: DosingErrorInfo | null;
  onAbortActive?: () => void;
  onSyncQueue?: () => void;
  onNavigateCalibration?: (componentId?: string) => void;
  onDismissError?: (jobId: string) => void;
  isActionLoading?: boolean;
  isSyncingQueue?: boolean;
  syncCountdownSec?: number;
  isMultiGh?: boolean;
  className?: string;
}

export function DosingQueueSection({
  activeJob,
  queuedJobs,
  blockedJobs,
  nextScheduledOp,
  errorInfo,
  onAbortActive,
  onSyncQueue,
  onNavigateCalibration,
  onDismissError,
  isActionLoading = false,
  isSyncingQueue = false,
  syncCountdownSec = 0,
  isMultiGh = false,
  className = "",
}: DosingQueueSectionProps) {
  const currentRunningStep = activeJob?.steps.find((s) => s.status === "RUNNING");

  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg space-y-4 ${className}`}>
      {/* ---------------- Unified Section Header ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-300">
            <ListOrdered className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3
                className="text-sm font-bold tracking-tight text-slate-100 cursor-default"
                title={
                  isMultiGh
                    ? "Multi-GH: Unit Dosing Sentral meracik tangki batch setiap greenhouse bergantian (FIFO) agar seluruh tangki siap sebelum jam penyiraman (Distribusi Paralel)."
                    : "Unit Dosing Sentral menyiapkan larutan nutrisi di tangki batch sebelum jadwal penyiraman fertigasi dimulai."
                }
              >
                Antrean Dosing Central (FIFO Execution Order)
              </h3>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                {activeJob ? "1 Aktif Berjalan" : "Standby"} • {queuedJobs.length} Antrean
              </span>
            </div>
          </div>
        </div>

        {/* Operating Status & Sync Action */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              errorInfo
                ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                : activeJob
                ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                : "border-slate-700 bg-slate-800/60 text-slate-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                errorInfo
                  ? "bg-rose-400"
                  : activeJob
                  ? "bg-cyan-400 animate-ping"
                  : "bg-emerald-400"
              }`}
            />
            {errorInfo
              ? `Kendala: ${errorInfo.ghCode}`
              : activeJob
              ? `Sedang Meracik: ${activeJob.ghCode}`
              : "Central Dosing: Standby"}
          </span>

          {onSyncQueue && (
            <button
              type="button"
              onClick={onSyncQueue}
              disabled={isSyncingQueue || isActionLoading}
              title="Sinkronkan antrean dengan controller ESP32"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/25 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isSyncingQueue ? "animate-spin text-cyan-400" : "text-cyan-400"}`} />
              {isSyncingQueue ? "Menyinkronkan..." : "Sinkronkan Antrean"}
            </button>
          )}
        </div>
      </div>

      {/* ---------------- Syncing Notification State ---------------- */}
      {isSyncingQueue && (
        <div className="flex items-center gap-3 rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-3 text-xs text-slate-300 backdrop-blur">
          <RefreshCw className="h-4 w-4 animate-spin text-cyan-400 shrink-0" />
          <span>
            <strong className="text-cyan-300">Sinkronisasi:</strong> Memverifikasi antrean peracikan dengan ESP32...
          </span>
        </div>
      )}

      {/* ---------------- Error State ---------------- */}
      {errorInfo && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/25 p-4 shadow-[0_4px_25px_rgba(244,63,94,0.15)]">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-rose-500/30 px-2 py-0.5 text-xs font-bold text-rose-200">
                  KENDALA OPERASI DOSING
                </span>
                <span className="font-bold text-slate-200">{errorInfo.ghCode}</span>
              </div>
              <p className="mt-1 text-xs text-rose-200/90 font-medium">
                Tahap Gagal: <span className="underline">{errorInfo.operation}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-300">{errorInfo.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Smart Diagnostic Alert for Blocked / Failed Batches ---------------- */}
      {blockedJobs && blockedJobs.length > 0 && (
        <div className="space-y-3">
          {blockedJobs.map((job) => {
            const diag = resolveFertigationError(job.errorCode, job.affectedComponent);
            const isCalib = diag.actionType === "CALIBRATE_PUMP" || diag.actionType === "CALIBRATE_FLOW";
            return (
              <div
                key={job.id}
                className="overflow-hidden rounded-xl border border-rose-500/50 bg-gradient-to-r from-rose-950/40 via-[#1a1120] to-[#0e1a2a] p-4 shadow-[0_6px_25px_rgba(244,63,94,0.18)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-500/40 bg-rose-500/20 text-rose-300">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-200">
                          PERINGATAN OPERASI PERACIKAN
                        </span>
                        <span className="text-xs font-bold text-slate-200">
                          {job.ghCode} ({job.ghName}) • {job.jobTitle}
                        </span>
                        {job.errorCode && (
                          <span className="font-mono text-[10px] text-rose-300/80 bg-rose-950/70 px-1.5 py-0.5 rounded border border-rose-800/60">
                            {job.errorCode}
                          </span>
                        )}
                      </div>
                      <h4 className="mt-1 text-sm font-bold text-white">{diag.title}</h4>
                      <p className="mt-0.5 text-xs text-slate-300 leading-relaxed">{diag.description}</p>
                    </div>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2 self-start pt-1">
                    {isCalib && onNavigateCalibration && (
                      <button
                        type="button"
                        onClick={() => onNavigateCalibration(job.affectedComponent || "dp-a")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30 active:scale-95 shadow-sm"
                      >
                        <Wrench className="h-3.5 w-3.5 text-amber-300" />
                        {diag.actionLabel || "Kalibrasi Sekarang"}
                      </button>
                    )}

                    {onSyncQueue && (
                      <button
                        type="button"
                        onClick={onSyncQueue}
                        disabled={isSyncingQueue || isActionLoading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 active:scale-95 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${isSyncingQueue ? "animate-spin text-cyan-400" : ""}`} />
                        Sinkronkan Ulang
                      </button>
                    )}

                    {onDismissError && (
                      <button
                        type="button"
                        onClick={() => onDismissError(job.id)}
                        title="Abaikan dan singkirkan catatan kendala ini dari layar"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                      >
                        <X className="h-3.5 w-3.5" />
                        Abaikan
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------------- Active Dosing Job (if running) ---------------- */}
      {activeJob && (
        <div className="overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-b from-[#0a212e] via-[#091b26] to-[#08151f] p-4 shadow-[0_12px_35px_rgba(6,182,212,0.12)]">
          {/* Active Job Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-xs font-bold text-cyan-300 border border-cyan-500/30">
                  DOSING AKTIF
                </span>
                <h4 className="text-sm font-bold text-slate-100">
                  Melayani: {activeJob.ghCode} ({activeJob.ghName})
                </h4>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Formula: <span className="font-semibold text-slate-200">{activeJob.recipeName}</span> • Target Air:{" "}
                <span className="font-semibold text-slate-200">{activeJob.targetWaterL} L</span> • Nutrisi A:{" "}
                <span className="font-semibold text-cyan-300">
                  {activeJob.dosingAml > 0 ? activeJob.dosingAml : Math.round(activeJob.targetWaterL * 1.875)} ml
                </span> • Nutrisi B:{" "}
                <span className="font-semibold text-cyan-300">
                  {activeJob.dosingBml > 0 ? activeJob.dosingBml : Math.round(activeJob.targetWaterL * 1.875)} ml
                </span>
              </p>
            </div>

            {onAbortActive && (
              <button
                type="button"
                onClick={onAbortActive}
                disabled={isActionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 active:scale-95 disabled:opacity-50"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Hentikan Batch
              </button>
            )}
          </div>

          {/* Operational Progress Breakdown (5 Steps) */}
          <div className="mt-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Tahapan Peracikan Nyata (Hardware Pipeline)
              </span>
              <span className="text-[10px] text-cyan-400 font-medium flex items-center gap-1">
                <Activity className="h-3 w-3 animate-spin" />
                {currentRunningStep ? `Tahap ${currentRunningStep.stepNumber}: ${currentRunningStep.name}` : "Proses otomatis berjalan via ESP32"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {activeJob.steps.map((st) => {
                const isCompleted = st.status === "COMPLETED";
                const isRunning = st.status === "RUNNING";
                const isFailed = st.status === "FAILED";

                return (
                  <div
                    key={st.stepNumber}
                    className={`relative flex flex-col justify-between rounded-lg border p-2.5 transition-all ${
                      isRunning
                        ? "border-cyan-400/50 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-400/30"
                        : isCompleted
                        ? "border-emerald-500/30 bg-emerald-950/20"
                        : isFailed
                        ? "border-rose-500/40 bg-rose-950/30"
                        : "border-slate-800/80 bg-slate-950/40 opacity-75"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 text-[10px]">
                        <span className="font-bold text-slate-400">Tahap {st.stepNumber}</span>
                        {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                        {isRunning && <Activity className="h-3.5 w-3.5 text-cyan-400 animate-spin" />}
                        {isFailed && <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />}
                        {!isCompleted && !isRunning && !isFailed && (
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                        )}
                      </div>

                      <div className="mt-1 text-xs font-bold text-slate-100">
                        {st.name}
                      </div>

                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {st.description}
                      </div>
                    </div>

                    <div className="mt-2 border-t border-slate-800/60 pt-1.5">
                      <div className="flex items-center justify-between text-[9px]">
                        <span
                          className={`font-semibold ${
                            isRunning
                              ? "text-cyan-300"
                              : isCompleted
                              ? "text-emerald-400"
                              : isFailed
                              ? "text-rose-400"
                              : "text-slate-500"
                          }`}
                        >
                          {isRunning ? "Sedang Berjalan" : isCompleted ? "Selesai" : isFailed ? "Gagal" : "Menunggu"}
                        </span>
                        {st.details && <span className="text-slate-400 font-mono text-[9px]">{st.details}</span>}
                      </div>

                      {isRunning && st.progressPct !== undefined && (
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-cyan-950">
                          <div
                            className="h-full bg-cyan-400 transition-all duration-300"
                            style={{ width: `${Math.min(100, Math.max(5, st.progressPct))}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Standby Status Summary (Single clean banner when not actively dosing) ---------------- */}
      {!activeJob && !errorInfo && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-950/40 px-4 py-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-semibold text-slate-200">Central Dosing Unit: Standby (Siaga)</span>
            <span className="text-slate-400">
              • Tidak ada operasi dosing yang sedang berjalan saat ini.
            </span>
          </div>

          {nextScheduledOp ? (
            <div className="flex items-center gap-2 text-slate-300">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-slate-400">Operasi berikutnya:</span>
              <span className="font-bold text-amber-300">
                {nextScheduledOp.ghCode} ({nextScheduledOp.ghName}) pukul {nextScheduledOp.time}
              </span>
              <span className="text-slate-400">({nextScheduledOp.jobTitle})</span>
            </div>
          ) : (
            <span className="text-slate-500">
              Tidak ada jadwal fertigasi tersisa hari ini
            </span>
          )}
        </div>
      )}

      {/* ---------------- Unified FIFO Queue List ---------------- */}
      <div className="space-y-2 pt-1">
        {queuedJobs.length > 0 ? (
          <>
            <div className="flex items-center justify-between">
              <div
                className="text-[11px] font-bold uppercase tracking-wider text-slate-400 cursor-default"
                title="Dieksekusi langsung berurutan (FIFO) agar tangki mixing siap sebelum jam penyiraman tanaman"
              >
                Urutan Antrean Peracikan Central (FIFO Execution Order)
              </div>
            </div>

            <div className="space-y-2">
              {queuedJobs.map((q, idx) => (
                <div
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0e1a2a]/70 p-3 hover:border-slate-700 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-xs font-bold text-amber-300 border border-amber-500/30">
                      #{idx + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-200">{q.ghCode}</span>
                        <span className="text-xs text-slate-400">({q.ghName}) • {q.jobTitle}</span>
                        <span className="rounded bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 text-[10px] text-cyan-300 font-semibold">
                          Batch Tangki Mixing
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-300 font-medium">
                        Resep: <span className="text-slate-300">{q.recipeName}</span> • Target Air:{" "}
                        <span className="text-slate-300 font-semibold">{q.targetWaterL} L</span> • Nutrisi A (
                        {q.dosingAml > 0 ? q.dosingAml : Math.round(q.targetWaterL * 1.875)} ml) + B (
                        {q.dosingBml > 0 ? q.dosingBml : Math.round(q.targetWaterL * 1.875)} ml)
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {q.status === "FAILED" ? (
                      <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300 font-medium flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3 text-rose-400" />
                        Gagal Dieksekusi
                      </span>
                    ) : q.status === "ACTIVE" ? (
                      <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-300 font-medium flex items-center gap-1.5">
                        <Activity className="h-3 w-3 text-cyan-400 animate-spin" />
                        Sedang Disiapkan Central
                      </span>
                    ) : idx === 0 ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300 font-medium flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-amber-400" />
                        Antrean #1 · Siap Diracik Central
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-300 font-medium">
                        Menunggu Giliran #{idx + 1}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-800/80 bg-slate-950/20 px-4 py-3 text-center text-xs text-slate-400">
            {activeJob ? (
              <span>Batch sedang diproses di unit peracikan. Tidak ada operasi peracikan dalam antrean saat ini.</span>
            ) : nextScheduledOp ? (
              <span>
                Tidak ada operasi peracikan dalam antrean saat ini. Jadwal fertigasi berikutnya adalah pukul{" "}
                <strong className="text-amber-300">{nextScheduledOp.time}</strong> untuk{" "}
                <strong className="text-slate-200">{nextScheduledOp.ghCode} ({nextScheduledOp.ghName})</strong>.
              </span>
            ) : (
              <span>Tidak ada operasi peracikan dalam antrean saat ini.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
