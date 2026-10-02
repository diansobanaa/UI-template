"use client";

import React from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Beaker,
  CheckCircle2,
  Clock,
  Droplets,
  ExternalLink,
  FlaskConical,
  Layers,
  ListOrdered,
  Play,
  RotateCcw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { Greenhouse, FertigationSchedule } from "@/lib/types";

export interface GreenhouseFertigationSummary {
  gh: Greenhouse;
  ghCode: string;
  displayName: string;
  technicalId: string;
  status:
    | "READY"
    | "MIXING"
    | "DISTRIBUTING"
    | "QUEUED"
    | "WAITING_SCHEDULE"
    | "STANDBY"
    | "COMPLETED"
    | "ERROR";
  statusLabel: string;
  statusTone: "emerald" | "cyan" | "purple" | "amber" | "slate" | "rose";
  statusDesc: string;
  nextScheduleTime: string | null;
  nextRecipeName: string | null;
  targetWaterL: number | null;
  cyclesCompletedToday: number;
  totalCyclesToday: number;
  tankLevelPct: number | null;
  volumeDisplay?: string;
  activeBatchPhase?: string;
  canPreMix: boolean;
  canDeliver: boolean;
}

interface ComplexFertigationOverviewProps {
  complexName: string;
  greenhouses: GreenhouseFertigationSummary[];
  onPreMixGh?: (ghId: string) => void;
  onDeliverGh?: (ghId: string) => void;
  loadingActionGhId?: string | null;
  className?: string;
}

export function ComplexFertigationOverview({
  complexName,
  greenhouses,
  onPreMixGh,
  onDeliverGh,
  loadingActionGhId,
  className = "",
}: ComplexFertigationOverviewProps) {
  // Aggregate KPIs
  const totalGh = greenhouses.length;
  const runningCount = greenhouses.filter(
    (g) => g.status === "MIXING" || g.status === "DISTRIBUTING"
  ).length;
  const readyCount = greenhouses.filter((g) => g.status === "READY").length;
  const queuedCount = greenhouses.filter((g) => g.status === "QUEUED").length;
  const waitingCount = greenhouses.filter(
    (g) => g.status === "WAITING_SCHEDULE" || g.status === "STANDBY"
  ).length;
  const errorCount = greenhouses.filter((g) => g.status === "ERROR").length;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* ---------------- 1. Complex Status Summary Strip ---------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <div className="rounded-xl border border-slate-800 bg-[#0e1a2a]/80 p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Layers className="h-3.5 w-3.5 text-blue-400" />
            Total GH
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-100">
            {totalGh} <span className="text-xs font-normal text-slate-500">Unit</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400 truncate">{complexName}</div>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
            <FlaskConical className="h-3.5 w-3.5" />
            Larutan Siap
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-300">
            {readyCount} <span className="text-xs font-normal text-slate-500">GH</span>
          </div>
          <div className="mt-0.5 text-[10px] text-emerald-500/80">Siap dialirkan ke tanaman</div>
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/15 p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-400">
            <Activity className="h-3.5 w-3.5 animate-pulse" />
            Sedang Berjalan
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-cyan-300">
            {runningCount} <span className="text-xs font-normal text-slate-500">GH</span>
          </div>
          <div className="mt-0.5 text-[10px] text-cyan-500/80">Dosing / Siram aktif</div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-950/15 p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400">
            <ListOrdered className="h-3.5 w-3.5" />
            Dalam Antrean
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-amber-300">
            {queuedCount} <span className="text-xs font-normal text-slate-500">GH</span>
          </div>
          <div className="mt-0.5 text-[10px] text-amber-500/80">Menunggu unit central</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0e1a2a]/80 p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            Menunggu Jadwal
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-200">
            {waitingCount} <span className="text-xs font-normal text-slate-500">GH</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">Standby jam operasional</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0e1a2a]/80 p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <AlertTriangle className={`h-3.5 w-3.5 ${errorCount > 0 ? "text-rose-400" : "text-slate-500"}`} />
            Kendala
          </div>
          <div className={`mt-1.5 text-2xl font-bold tracking-tight ${errorCount > 0 ? "text-rose-400" : "text-slate-200"}`}>
            {errorCount} <span className="text-xs font-normal text-slate-500">GH</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            {errorCount > 0 ? "Perlu perhatian" : "Semua normal"}
          </div>
        </div>
      </div>

      {/* ---------------- 2. Greenhouse Cards Grid (Section 10 Spec) ---------------- */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-slate-200 uppercase tracking-wider">
              Status Operasional Tiap Greenhouse
            </h3>
            <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-400">
              {greenhouses.length} Greenhouse Terdaftar
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Tangki pencampur dan status proses terisolasi per greenhouse
          </span>
        </div>

        {greenhouses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 bg-[#0e1a2a]/40 p-8 text-center">
            <Layers className="mx-auto h-8 w-8 text-slate-600 mb-2" />
            <p className="text-sm font-medium text-slate-300">Belum ada greenhouse terdaftar pada complex ini.</p>
            <p className="mt-1 text-xs text-slate-500">Tambahkan greenhouse untuk memantau status fertigasi.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {greenhouses.map((item) => {
              const gh = item.gh;
              const isActionLoading = loadingActionGhId === gh.id;

              return (
                <div
                  key={gh.id}
                  className={`group relative overflow-hidden rounded-xl border p-4 transition-all duration-200 ${
                    item.status === "READY"
                      ? "border-emerald-500/40 bg-gradient-to-b from-[#0c2323] to-[#0a1824] shadow-[0_4px_20px_rgba(16,185,129,0.08)]"
                      : item.status === "MIXING"
                      ? "border-cyan-500/40 bg-gradient-to-b from-[#0a232e] to-[#0a1824] shadow-[0_4px_20px_rgba(6,182,212,0.08)]"
                      : item.status === "DISTRIBUTING"
                      ? "border-purple-500/40 bg-gradient-to-b from-[#19152b] to-[#0a1824] shadow-[0_4px_20px_rgba(168,85,247,0.08)]"
                      : item.status === "QUEUED"
                      ? "border-amber-500/40 bg-gradient-to-b from-[#211a0d] to-[#0a1824] shadow-[0_4px_20px_rgba(245,158,11,0.08)]"
                      : item.status === "ERROR"
                      ? "border-rose-500/40 bg-gradient-to-b from-[#241118] to-[#0a1824]"
                      : "border-slate-800 bg-[#0e1a2a]/90 hover:border-slate-700"
                  }`}
                >
                  {/* Top Row: Greenhouse Display Name & Status Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/greenhouse/${gh.id}`}
                          className="text-[15px] font-bold text-slate-100 hover:text-emerald-300 transition flex items-center gap-1.5"
                        >
                          {item.ghCode}
                          <span className="text-xs text-slate-400 font-normal">
                            ({item.displayName})
                          </span>
                          <ExternalLink className="h-3 w-3 text-slate-500 group-hover:text-emerald-300" />
                        </Link>
                        {gh.crop && (
                          <span className="rounded-md bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                            {gh.crop}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {item.statusDesc}
                      </p>
                    </div>

                    {/* Operational State Badge */}
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                        item.statusTone === "emerald"
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : item.statusTone === "cyan"
                          ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                          : item.statusTone === "purple"
                          ? "border-purple-500/40 bg-purple-500/15 text-purple-300"
                          : item.statusTone === "amber"
                          ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                          : item.statusTone === "rose"
                          ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                          : "border-slate-700 bg-slate-800/60 text-slate-300"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          item.statusTone === "emerald"
                            ? "bg-emerald-400"
                            : item.statusTone === "cyan"
                            ? "bg-cyan-400 animate-ping"
                            : item.statusTone === "purple"
                            ? "bg-purple-400 animate-ping"
                            : item.statusTone === "amber"
                            ? "bg-amber-400"
                            : item.statusTone === "rose"
                            ? "bg-rose-400"
                            : "bg-slate-500"
                        }`}
                      />
                      {item.statusLabel}
                    </span>
                  </div>

                  {/* Middle Content: Metrics Strip */}
                  <div className="mt-3.5 grid grid-cols-2 gap-2 rounded-lg border border-slate-800/60 bg-slate-950/40 p-2.5">
                    <div>
                      <div className="text-[10px] font-medium text-slate-500">Siraman Hari Ini</div>
                      <div className="mt-0.5 text-xs font-bold text-slate-200">
                        {item.cyclesCompletedToday} / {item.totalCyclesToday} Siklus Selesai
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-slate-500">Jadwal Terdekat</div>
                      <div className="mt-0.5 text-xs font-bold text-slate-200">
                        {item.nextScheduleTime ? (
                          <span className="text-amber-300">Pukul {item.nextScheduleTime}</span>
                        ) : (
                          <span className="text-slate-500">Tidak ada jadwal</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Mixing Tank Preview */}
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-slate-400 font-medium">
                        <Droplets className="h-3 w-3 text-blue-400" />
                        Tangki Batch {item.ghCode}
                      </span>
                      <span className="font-semibold text-slate-200">
                        {item.volumeDisplay || (item.targetWaterL ? `Target ${item.targetWaterL} L` : "Siap Dipakai")}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          item.status === "READY"
                            ? "bg-emerald-400"
                            : item.status === "MIXING"
                            ? "bg-cyan-400 animate-pulse"
                            : item.status === "DISTRIBUTING"
                            ? "bg-purple-400 animate-pulse"
                            : item.status === "QUEUED"
                            ? "bg-amber-400"
                            : "bg-blue-500/60"
                        }`}
                        style={{
                          width: `${item.tankLevelPct ?? (item.status === "READY" ? 100 : item.status === "MIXING" ? 60 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Bottom Action Footer (Clarified Section 9) */}
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                    <Link
                      to={`/greenhouse/${gh.id}`}
                      className="text-[11px] font-medium text-slate-400 hover:text-slate-200 transition"
                    >
                      Buka Panel GH →
                    </Link>

                    <div className="flex items-center gap-1.5">
                      {item.canDeliver && onDeliverGh && (
                        <button
                          type="button"
                          onClick={() => onDeliverGh(gh.id)}
                          disabled={isActionLoading}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
                        >
                          <Droplets className="h-3 w-3" />
                          Siram Sekarang
                        </button>
                      )}

                      {item.canPreMix && onPreMixGh && (
                        <button
                          type="button"
                          onClick={() => onPreMixGh(gh.id)}
                          disabled={isActionLoading}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-600/90 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-cyan-500 active:scale-95 disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" />
                          Masuk Antrean
                        </button>
                      )}

                      {!item.canDeliver && !item.canPreMix && (
                        <span className="text-[10px] text-slate-400 font-medium">
                          {item.status === "QUEUED"
                            ? "Dalam Antrean Dosing"
                            : item.status === "MIXING" || item.status === "DISTRIBUTING"
                            ? "Alur Otomatis Aktif"
                            : item.status === "WAITING_SCHEDULE"
                            ? "Otomasi Terjadwal (Fail-Safe)"
                            : "Siaga"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
