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
} from "lucide-react";

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
  status: "ACTIVE" | "PENDING_FIFO" | "WAITING_SCHEDULE" | "COMPLETED" | "FAILED";
  statusLabel: string;
  steps: OperationalStep[];
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
  nextScheduledOp?: NextScheduledOperation | null;
  errorInfo?: DosingErrorInfo | null;
  onAbortActive?: () => void;
  onPreMixJob?: (job: DosingQueueJob) => void;
  isActionLoading?: boolean;
  isSyncingQueue?: boolean;
  syncCountdownSec?: number;
  className?: string;
}

export function DosingQueueSection({
  activeJob,
  queuedJobs,
  nextScheduledOp,
  errorInfo,
  onAbortActive,
  onPreMixJob,
  isActionLoading = false,
  isSyncingQueue = false,
  syncCountdownSec = 15,
  className = "",
}: DosingQueueSectionProps) {
  const currentRunningStep = activeJob?.steps.find((s) => s.status === "RUNNING");

  return (
    <div className={`space-y-4 ${className}`}>
      {/* ---------------- Section Header ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-300">
            <ListOrdered className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-tight text-slate-100">
                Unit Dosing & Antrean FIFO (Central Dosing & FIFO Queue)
              </h3>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                {activeJob ? "1 Aktif Berjalan" : "Standby"} • {queuedJobs.length} Dalam Antrean
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Unit Dosing & Pencampuran Sentral melayani tangki batch greenhouse secara bergantian (FIFO teratur).
            </p>
          </div>
        </div>

        {/* Central Unit Operating State Pill */}
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
              : "Central Dosing Unit: Standby"}
          </span>
        </div>
      </div>

      {/* ---------------- 1. Central Dosing Unit Panel (Section 5 Spec) ---------------- */}
      {errorInfo ? (
        /* Error State Identifying Failed Process and Target GH */
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/25 p-5 shadow-[0_4px_25px_rgba(244,63,94,0.15)]">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <AlertTriangle className="h-5 w-5" />
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
      ) : activeJob ? (
        /* Running Dosing Operation Display */
        <div className="overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-[#0a212e] via-[#091b26] to-[#08151f] p-5 shadow-[0_12px_35px_rgba(6,182,212,0.12)]">
          {/* Active Job Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-xs font-bold text-cyan-300 border border-cyan-500/30">
                  DOSING AKTIF
                </span>
                <h4 className="text-base font-bold text-slate-100">
                  Melayani: {activeJob.ghCode} ({activeJob.ghName})
                </h4>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Formula: <span className="font-semibold text-slate-200">{activeJob.recipeName}</span> • Target Air:{" "}
                <span className="font-semibold text-slate-200">{activeJob.targetWaterL} L</span> • Nutrisi A:{" "}
                <span className="font-semibold text-cyan-300">{activeJob.dosingAml} ml</span> • Nutrisi B:{" "}
                <span className="font-semibold text-cyan-300">{activeJob.dosingBml} ml</span>
              </p>
            </div>

            {onAbortActive && (
              <button
                type="button"
                onClick={onAbortActive}
                disabled={isActionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 active:scale-95 disabled:opacity-50"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Hentikan Batch
              </button>
            )}
          </div>

          {/* Operational Progress Breakdown (5 Steps) */}
          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Tahapan Peracikan Nyata (Hardware Pipeline)
              </span>
              <span className="text-[11px] text-cyan-400 font-medium flex items-center gap-1">
                <Activity className="h-3 w-3 animate-spin" />
                {currentRunningStep ? `Tahap ${currentRunningStep.stepNumber}: ${currentRunningStep.name}` : "Proses otomatis berjalan via ESP32"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-5">
              {activeJob.steps.map((st) => {
                const isCompleted = st.status === "COMPLETED";
                const isRunning = st.status === "RUNNING";
                const isFailed = st.status === "FAILED";

                return (
                  <div
                    key={st.stepNumber}
                    className={`relative flex flex-col justify-between rounded-xl border p-3 transition-all ${
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
                      {/* Step Header */}
                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="font-bold text-slate-400">Tahap {st.stepNumber}</span>
                        {isCompleted && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                        {isRunning && <Activity className="h-4 w-4 text-cyan-400 animate-spin" />}
                        {isFailed && <AlertTriangle className="h-4 w-4 text-rose-400" />}
                        {!isCompleted && !isRunning && !isFailed && (
                          <span className="h-2 w-2 rounded-full bg-slate-600" />
                        )}
                      </div>

                      {/* Step Name */}
                      <div className="mt-1.5 text-xs font-bold text-slate-100">
                        {st.name}
                      </div>

                      {/* Description */}
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {st.description}
                      </div>
                    </div>

                    {/* Step Status Badge & Progress */}
                    <div className="mt-3 border-t border-slate-800/60 pt-2">
                      <div className="flex items-center justify-between text-[10px]">
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
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-cyan-950">
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
      ) : (
        /* Standby State (Section 5 Spec) */
        <div className="rounded-2xl border border-slate-800/90 bg-[#0e1a2a]/60 p-6 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/70 text-slate-400 mb-3 shadow-inner">
            <Droplets className="h-5 w-5 text-emerald-400" />
          </div>
          <h4 className="text-sm font-bold text-slate-200">
            Central Dosing Unit: Standby (Siaga)
          </h4>
          <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
            Tidak ada operasi dosing yang sedang berjalan saat ini.
          </p>

          {/* Next Operation Info Pill (Section 5 Spec) */}
          <div className="mt-3.5 inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/80 px-4 py-1.5 text-xs">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-slate-400">Operasi berikutnya:</span>
            {nextScheduledOp ? (
              <span className="font-semibold text-amber-300">
                {nextScheduledOp.ghCode} ({nextScheduledOp.ghName}) pukul {nextScheduledOp.time}
              </span>
            ) : queuedJobs.length > 0 ? (
              <span className="font-semibold text-cyan-300">
                {queuedJobs[0].ghCode} (Antrean #{queuedJobs[0].queuePosition})
              </span>
            ) : (
              <span className="font-semibold text-slate-400">
                Tidak ada jadwal peracikan tersisa hari ini
              </span>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 2. FIFO Execution Queue Presentation (Section 6 Spec) ---------------- */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Antrean Dosing Central (FIFO Execution Order)
            </h4>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-300 border border-slate-700">
              {queuedJobs.length} Menunggu Giliran
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Dieksekusi bergantian secara otomatis sesuai ketersediaan unit dan jadwal
          </span>
        </div>

        {isSyncingQueue ? (
          /* Grace period loading display (waiting up to 15s for ESP32 queue confirmation) */
          <div className="rounded-xl border border-dashed border-cyan-800/60 bg-[#0e1a2a]/60 p-5 text-center text-xs text-slate-300 space-y-2 animate-pulse">
            <div className="flex items-center justify-center gap-2 text-cyan-400">
              <RefreshCw className="h-4 w-4 animate-spin text-cyan-400" />
              <span className="font-semibold text-cyan-300">
                Memverifikasi antrean peracikan dengan ESP32...
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Menunggu status antrean terverifikasi dari controller sebelum pemicuan otomatis ({syncCountdownSec} detik tersisa).
            </p>
          </div>
        ) : queuedJobs.length === 0 ? (
          /* Neutral and Accurate Empty Queue State (Section 6 Spec) */
          <div className="rounded-xl border border-dashed border-slate-800 bg-[#0e1a2a]/40 p-4 text-center text-xs text-slate-400 space-y-1">
            <p className="font-medium text-slate-300">
              Tidak ada operasi peracikan dalam antrean saat ini.
            </p>
            {nextScheduledOp ? (
              <p className="text-slate-400">
                Jadwal fertigasi berikutnya adalah pukul <span className="font-semibold text-amber-300">{nextScheduledOp.time}</span> untuk{" "}
                <span className="font-semibold text-slate-200">{nextScheduledOp.ghCode}</span> ({nextScheduledOp.jobTitle}).
              </p>
            ) : (
              <p className="text-slate-500">
                Semua jadwal yang terdaftar untuk hari ini telah selesai atau belum ada jadwal berikutnya.
              </p>
            )}
          </div>
        ) : (
          /* FIFO Execution List */
          <div className="space-y-2">
            {queuedJobs.map((q, idx) => (
              <div
                key={q.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0e1a2a]/70 p-3.5 hover:border-slate-700 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-xs font-bold text-amber-300 border border-amber-500/30">
                    #{idx + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-200">{q.ghCode}</span>
                      <span className="text-xs text-slate-400">({q.ghName}) • {q.jobTitle}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-amber-300 font-medium">
                        Jadwal: {q.scheduledTimeStr}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Resep: <span className="text-slate-300">{q.recipeName}</span> • Target Air:{" "}
                      <span className="text-slate-300 font-semibold">{q.targetWaterL} L</span> • Nutrisi A ({q.dosingAml} ml) + B ({q.dosingBml} ml)
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300 font-medium">
                    Menunggu Giliran Unit Central
                  </span>
                  {onPreMixJob && (
                    <button
                      type="button"
                      onClick={() => onPreMixJob(q)}
                      disabled={isActionLoading}
                      title="Mulai racik batch ini sekarang agar larutan siap sebelum jam jadwal"
                      className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-600/80 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-cyan-500 active:scale-95 disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      Racik Lebih Awal
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
