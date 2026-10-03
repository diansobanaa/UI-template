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
  FlaskConical,
  ListOrdered,
  Play,
  RotateCcw,
  Sparkles,
  Waves,
} from "lucide-react";

export type HumanMixingState =
  | "Standby"
  | "Waiting for schedule"
  | "Waiting in queue"
  | "Preparing water"
  | "Dosing nutrients"
  | "Mixing"
  | "Ready for fertigation"
  | "Fertigation in progress"
  | "Completed"
  | "Failed"
  | "Interrupted";

export interface GreenhouseTankInfo {
  ghId: string;
  ghCode: string;
  displayName: string;
  technicalId: string;
  crop?: string;
  tankName: string;
  status: HumanMixingState;
  statusTone: "slate" | "blue" | "cyan" | "emerald" | "purple" | "green" | "rose" | "amber";
  statusDescription: string;
  // Volume details per Spec Section 7
  measuredVolumeL: number | null;
  targetWaterL?: number;
  capacityL: number;
  levelPct: number;
  isSensorAvailable: boolean;
  volumeDisplayLabel: string;
  volumeDisplayValue: string;
  // Timing details per Spec Section 8
  timingLabel: string;
  timingValue: string;
  queuePosition?: number | null;
  recipeName?: string;
  // Action details per Spec Section 9
  canDeliverNow: boolean;
  canPreMixNow: boolean;
  isActionDisabled?: boolean;
  actionDisabledReason?: string;
}

interface GreenhouseMixingTanksProps {
  tanks: GreenhouseTankInfo[];
  onPreMix?: (ghId: string) => void;
  onDeliver?: (ghId: string) => void;
  isActionLoading?: boolean;
  className?: string;
}

export function GreenhouseMixingTanks({
  tanks,
  onPreMix,
  onDeliver,
  isActionLoading = false,
  className = "",
}: GreenhouseMixingTanksProps) {
  return (
    <div className={`space-y-3.5 ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3
                className="text-sm font-bold tracking-tight text-slate-100 cursor-default"
                title="Setiap greenhouse memiliki tangki batch fisik mandiri — larutan nutrisi terisolasi dan tidak bercampur antar greenhouse."
              >
                Tangki Pencampur Tiap Greenhouse (Independent Mixing Tanks)
              </h3>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                {tanks.length} Tangki Fisik Mandiri
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tanks Grid */}
      {tanks.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#0e1a2a]/40 p-6 text-center text-xs text-slate-400">
          Belum ada data tangki batch pencampur terhubung pada complex ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {tanks.map((tank) => {
            const isReady = tank.status === "Ready for fertigation";
            const isMixing =
              tank.status === "Mixing" ||
              tank.status === "Dosing nutrients" ||
              tank.status === "Preparing water";
            const isDelivering = tank.status === "Fertigation in progress";
            const isQueued = tank.status === "Waiting in queue";
            const isWaitingSchedule = tank.status === "Waiting for schedule";
            const isCompleted = tank.status === "Completed";
            const isFailed = tank.status === "Failed" || tank.status === "Interrupted";

            return (
              <div
                key={tank.ghId}
                className={`relative overflow-hidden rounded-xl border p-4 transition-all ${
                  isReady
                    ? "border-emerald-500/40 bg-gradient-to-b from-[#0c2420] to-[#0a1722] shadow-[0_4px_20px_rgba(16,185,129,0.08)]"
                    : isMixing
                    ? "border-cyan-500/40 bg-gradient-to-b from-[#0a232f] to-[#0a1722] shadow-[0_4px_20px_rgba(6,182,212,0.08)]"
                    : isDelivering
                    ? "border-purple-500/40 bg-gradient-to-b from-[#181329] to-[#0a1722] shadow-[0_4px_20px_rgba(168,85,247,0.08)]"
                    : isQueued
                    ? "border-amber-500/40 bg-gradient-to-b from-[#211a0d] to-[#0a1722] shadow-[0_4px_20px_rgba(245,158,11,0.08)]"
                    : isFailed
                    ? "border-rose-500/40 bg-gradient-to-b from-[#251119] to-[#0a1722]"
                    : "border-slate-800 bg-[#0e1a2a]/80"
                }`}
              >
                {/* Tank Header: Prominent Human-Readable Greenhouse Name & Tank */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Beaker className="h-4 w-4 text-cyan-400" />
                      <h4 className="text-sm font-bold text-slate-100">
                        {tank.tankName}
                      </h4>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">{tank.displayName}</span>
                      {tank.crop && (
                        <span className="rounded bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                          {tank.crop}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    title={tank.statusDescription}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold cursor-default ${
                      isReady
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                        : isMixing
                        ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300 animate-pulse"
                        : isDelivering
                        ? "border-purple-500/40 bg-purple-500/15 text-purple-300 animate-pulse"
                        : isQueued
                        ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                        : isCompleted
                        ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                        : isFailed
                        ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                        : "border-slate-700 bg-slate-800/80 text-slate-300"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isReady
                          ? "bg-emerald-400"
                          : isMixing
                          ? "bg-cyan-400 animate-ping"
                          : isDelivering
                          ? "bg-purple-400 animate-ping"
                          : isQueued
                          ? "bg-amber-400"
                          : isCompleted
                          ? "bg-emerald-400"
                          : isFailed
                          ? "bg-rose-400"
                          : "bg-slate-500"
                      }`}
                    />
                    {tank.status}
                  </span>
                </div>

                {/* Tank Volume Visual Level (Section 7 Spec) */}
                <div className="mt-4 rounded-lg border border-slate-800/80 bg-slate-950/50 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium flex items-center gap-1.5">
                      <Waves className="h-3.5 w-3.5 text-blue-400" />
                      {tank.volumeDisplayLabel}
                    </span>
                    <span className="font-bold text-slate-200">
                      {tank.volumeDisplayValue}
                    </span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full transition-all duration-500 ${
                        isReady
                          ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                          : isMixing
                          ? "bg-cyan-400 animate-pulse"
                          : isDelivering
                          ? "bg-purple-400 animate-pulse"
                          : isQueued
                          ? "bg-amber-400/60"
                          : isFailed
                          ? "bg-rose-400"
                          : "bg-blue-500/50"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, tank.levelPct))}%` }}
                    />
                  </div>
                </div>

                {/* Human Timing & Formula Information (Section 8 Spec) */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg border border-slate-800/50 bg-[#08131e] p-2">
                    <div className="text-[10px] text-slate-500 font-medium">{tank.timingLabel}</div>
                    <div className="mt-0.5 font-bold text-slate-200">
                      <span className={
                        isReady
                          ? "text-emerald-400"
                          : isQueued
                          ? "text-amber-300"
                          : isMixing || isDelivering
                          ? "text-cyan-300"
                          : "text-slate-300"
                      }>
                        {tank.timingValue}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-800/50 bg-[#08131e] p-2">
                    <div className="text-[10px] text-slate-500 font-medium">Resep Nutrisi</div>
                    <div className="mt-0.5 font-bold text-slate-200 truncate" title={tank.recipeName || "Resep Standar"}>
                      {tank.recipeName || "Nutrisi Standar"}
                    </div>
                  </div>
                </div>

                {/* Action Row & Automation Clarity (Section 9 Spec) */}
                <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-800/60 pt-3">
                  <Link
                    to={`/greenhouse/${tank.ghId}`}
                    className="text-[11px] font-medium text-slate-400 hover:text-emerald-300 transition flex items-center gap-1"
                  >
                    Buka Panel GH →
                  </Link>

                  <div className="flex items-center gap-2">
                    {tank.canDeliverNow && onDeliver && (
                      <button
                        type="button"
                        onClick={() => onDeliver(tank.ghId)}
                        disabled={isActionLoading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
                      >
                        <Droplets className="h-3.5 w-3.5" />
                        Siram ke Tanaman Sekarang
                      </button>
                    )}

                    {isWaitingSchedule && (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700/60 bg-slate-800/60 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                        <Clock className="h-3 w-3 text-amber-400/80" />
                        Otomasi Terjadwal (Fail-Safe)
                      </span>
                    )}


                    {/* Otomasi Penuh: Masuk Antrean Dosing dikelola otomatis via Central Dosing Engine */}
                    {(isMixing || isDelivering || isQueued) && (
                      <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                        <Activity className="h-3 w-3 text-cyan-400 animate-spin" />
                        Alur Otomatis Aktif
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
  );
}
