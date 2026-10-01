"use client";

import React from "react";
import {
  Activity,
  AlertTriangle,
  Beaker,
  CheckCircle2,
  Clock,
  Droplets,
  FlaskConical,
  Play,
  RotateCcw,
  Sparkles,
  StopCircle,
  Waves,
} from "lucide-react";
import type { Greenhouse, FertigationSchedule } from "@/lib/types";
import type { DosingQueueJob, OperationalStep } from "./DosingQueueSection";
import type { GreenhouseTankInfo, HumanMixingState } from "./GreenhouseMixingTanks";

interface GreenhouseFertigationDetailProps {
  gh: Greenhouse;
  status: "READY" | "MIXING" | "DISTRIBUTING" | "WAITING" | "ERROR";
  statusLabel: string;
  statusTone: "emerald" | "cyan" | "purple" | "slate" | "rose";
  statusDesc: string;
  currentOperationText: string;
  nextScheduleTime: string | null;
  nextRecipeName: string | null;
  targetWaterL: number | null;
  cyclesCompletedToday: number;
  totalCyclesToday: number;
  mixingTank: GreenhouseTankInfo;
  activeJob: DosingQueueJob | null;
  queuedJobs: DosingQueueJob[];
  onPreMix?: () => void;
  onDeliver?: () => void;
  onAbort?: () => void;
  isActionLoading?: boolean;
  className?: string;
}

export function GreenhouseFertigationDetail({
  gh,
  status,
  statusLabel,
  statusTone,
  statusDesc,
  currentOperationText,
  nextScheduleTime,
  nextRecipeName,
  targetWaterL,
  cyclesCompletedToday,
  totalCyclesToday,
  mixingTank,
  activeJob,
  queuedJobs,
  onPreMix,
  onDeliver,
  onAbort,
  isActionLoading = false,
  className = "",
}: GreenhouseFertigationDetailProps) {
  return (
    <div className={`space-y-4 rounded-2xl border border-slate-800 bg-[#0e1a2a] p-5 shadow-sm ${className}`}>
      {/* ---------------- 1. Top Status Banner (GH Summary) ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-bold text-slate-100">
              Operasi Fertigasi & Nutrisi {gh.code || gh.greenhouseTag || gh.id}
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                statusTone === "emerald"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : statusTone === "cyan"
                  ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                  : statusTone === "purple"
                  ? "border-purple-500/40 bg-purple-500/15 text-purple-300"
                  : statusTone === "rose"
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                  : "border-slate-700 bg-slate-800 text-slate-300"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  statusTone === "emerald"
                    ? "bg-emerald-400"
                    : statusTone === "cyan"
                    ? "bg-cyan-400 animate-pulse"
                    : statusTone === "purple"
                    ? "bg-purple-400 animate-pulse"
                    : statusTone === "rose"
                    ? "bg-rose-400"
                    : "bg-slate-500"
                }`}
              />
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Status Terkini: <span className="font-semibold text-slate-200">{currentOperationText}</span>
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          {mixingTank.canDeliverNow && onDeliver && (
            <button
              type="button"
              onClick={onDeliver}
              disabled={isActionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
            >
              <Droplets className="h-3.5 w-3.5" />
              Siram ke Tanaman Sekarang
            </button>
          )}

          {mixingTank.canPreMixNow && onPreMix && (
            <button
              type="button"
              onClick={onPreMix}
              disabled={isActionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-cyan-500 active:scale-95 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              Racik Awal (Pre-Mix)
            </button>
          )}

          {activeJob && onAbort && (
            <button
              type="button"
              onClick={onAbort}
              disabled={isActionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 active:scale-95 disabled:opacity-50"
            >
              <StopCircle className="h-3.5 w-3.5" />
              Batalkan
            </button>
          )}
        </div>
      </div>

      {/* ---------------- 2. KPI Cards (Section 10 Spec) ---------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Next Schedule */}
        <div className="rounded-xl border border-slate-800 bg-[#091522] p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            Jadwal Fertigasi Terdekat
          </div>
          <div className="mt-1.5 text-xl font-bold text-slate-100">
            {nextScheduleTime ? (
              <span className="text-amber-300">{nextScheduleTime}</span>
            ) : (
              <span className="text-slate-500 text-sm">Tidak Ada Jadwal Hari Ini</span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 truncate">
            {nextRecipeName ? `Resep: ${nextRecipeName}` : "Siaga manual"}
          </div>
        </div>

        {/* Cycles completed */}
        <div className="rounded-xl border border-slate-800 bg-[#091522] p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            Fertigasi Hari Ini
          </div>
          <div className="mt-1.5 text-xl font-bold text-slate-100">
            {cyclesCompletedToday} / {totalCyclesToday} <span className="text-xs font-normal text-slate-400">Siklus Selesai</span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {targetWaterL ? `Target: ${targetWaterL} L per batch` : "Sesuai resep aktif"}
          </div>
        </div>

        {/* Mixing Tank Overview */}
        <div className="rounded-xl border border-slate-800 bg-[#091522] p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Beaker className="h-3.5 w-3.5 text-cyan-400" />
            Tangki Batch {gh.code || gh.id}
          </div>
          <div className="mt-1.5 text-xl font-bold text-slate-100 flex items-center justify-between">
            <span className={mixingTank.status === "Ready" ? "text-emerald-300" : "text-slate-200"}>
              {mixingTank.status}
            </span>
            <span className="text-xs font-semibold text-slate-400 font-mono">
              {mixingTank.levelPct.toFixed(0)}% ({mixingTank.currentVolumeL} L)
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                mixingTank.status === "Ready"
                  ? "bg-emerald-400"
                  : mixingTank.status === "Mixing"
                  ? "bg-cyan-400 animate-pulse"
                  : "bg-blue-500"
              }`}
              style={{ width: `${mixingTank.levelPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ---------------- 3. Operational Dosing Steps for This GH ---------------- */}
      {activeJob && (
        <div className="rounded-xl border border-cyan-500/30 bg-[#091a24] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                Tahap Peracikan Batch Berjalan (Dosing Queue)
              </h4>
            </div>
            <span className="text-[11px] text-slate-400">
              Formula: {activeJob.recipeName} ({activeJob.targetWaterL} L)
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
            {activeJob.steps.map((st) => (
              <div
                key={st.stepNumber}
                className={`rounded-lg border p-2.5 text-xs ${
                  st.status === "RUNNING"
                    ? "border-cyan-400 bg-cyan-950/60 shadow-sm text-cyan-200 ring-1 ring-cyan-400/40"
                    : st.status === "COMPLETED"
                    ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                    : "border-slate-800 bg-slate-950/40 text-slate-400"
                }`}
              >
                <div className="flex items-center justify-between font-semibold text-[10px]">
                  <span>Tahap {st.stepNumber}</span>
                  {st.status === "COMPLETED" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                  {st.status === "RUNNING" && <Activity className="h-3.5 w-3.5 text-cyan-400 animate-spin" />}
                </div>
                <div className="mt-1 font-bold text-slate-100">{st.name}</div>
                <div className="mt-0.5 text-[10px] opacity-80">{st.description}</div>
                <div className="mt-1.5 font-semibold text-[10px]">
                  {st.status === "RUNNING" ? "Sedang Proses" : st.status === "COMPLETED" ? "Selesai" : "Menunggu"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- 4. Upcoming Queue for this GH ---------------- */}
      {queuedJobs.length > 0 && (
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3.5">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Antrean Jadwal Berikutnya untuk {gh.code || gh.id} ({queuedJobs.length} Batch)
          </div>
          <div className="space-y-1.5">
            {queuedJobs.map((q, idx) => (
              <div
                key={q.id}
                className="flex items-center justify-between text-xs rounded-lg border border-slate-800/60 bg-[#0e1a2a]/60 px-3 py-2"
              >
                <span className="font-semibold text-slate-300">
                  #{idx + 1} {q.jobTitle} • Jam {q.scheduledTimeStr}
                </span>
                <span className="text-slate-400">
                  {q.targetWaterL} L ({q.recipeName})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
