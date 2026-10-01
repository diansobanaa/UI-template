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
  Waves,
} from "lucide-react";
import type { Greenhouse } from "@/lib/types";

export type HumanMixingState =
  | "Waiting"
  | "Preparing Water"
  | "Adding Nutrients"
  | "Mixing"
  | "Ready"
  | "Delivering"
  | "Completed"
  | "Failed";

export interface GreenhouseTankInfo {
  ghId: string;
  ghCode: string;
  tankName: string;
  status: HumanMixingState;
  statusTone: "slate" | "blue" | "cyan" | "emerald" | "purple" | "green" | "rose";
  statusDescription: string;
  currentVolumeL: number;
  capacityL: number;
  levelPct: number;
  remainingTimeStr: string | null;
  expectedReadyTimeStr: string | null;
  targetWaterL?: number;
  recipeName?: string;
  canDeliverNow: boolean;
  canPreMixNow: boolean;
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
              <h3 className="text-sm font-bold tracking-tight text-slate-100">
                Tangki Pencampur Tiap Greenhouse (Independent Mixing Tanks)
              </h3>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                {tanks.length} Tangki Terisolasi
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Setiap greenhouse memiliki tangki batch fisik mandiri — larutan nutrisi tidak bercampur antar greenhouse.
            </p>
          </div>
        </div>
      </div>

      {/* Tanks Grid */}
      {tanks.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#0e1a2a]/40 p-6 text-center text-xs text-slate-400">
          Belum ada data tangki batch pencampur terhubung.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {tanks.map((tank) => {
            const isReady = tank.status === "Ready";
            const isMixing = tank.status === "Mixing" || tank.status === "Adding Nutrients" || tank.status === "Preparing Water";
            const isDelivering = tank.status === "Delivering";
            const isFailed = tank.status === "Failed";

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
                    : isFailed
                    ? "border-rose-500/40 bg-gradient-to-b from-[#251119] to-[#0a1722]"
                    : "border-slate-800 bg-[#0e1a2a]/80"
                }`}
              >
                {/* Tank Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                      <Beaker className="h-4 w-4 text-cyan-400" />
                      {tank.tankName}
                    </h4>
                    <p className="mt-0.5 text-[11px] text-slate-400">{tank.ghCode} • {tank.statusDescription}</p>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                      isReady
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                        : isMixing
                        ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300 animate-pulse"
                        : isDelivering
                        ? "border-purple-500/40 bg-purple-500/15 text-purple-300 animate-pulse"
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
                          ? "bg-cyan-400"
                          : isDelivering
                          ? "bg-purple-400"
                          : isFailed
                          ? "bg-rose-400"
                          : "bg-slate-500"
                      }`}
                    />
                    {tank.status}
                  </span>
                </div>

                {/* Tank Volume Visual Level */}
                <div className="mt-4 rounded-lg border border-slate-800/80 bg-slate-950/50 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium flex items-center gap-1.5">
                      <Waves className="h-3.5 w-3.5 text-blue-400" />
                      Volume Larutan
                    </span>
                    <span className="font-bold text-slate-200">
                      {tank.currentVolumeL} <span className="text-[10px] text-slate-400 font-normal">/ {tank.capacityL} L ({tank.levelPct.toFixed(0)}%)</span>
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
                          : isFailed
                          ? "bg-rose-400"
                          : "bg-blue-500/50"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, tank.levelPct))}%` }}
                    />
                  </div>
                </div>

                {/* Human Timing Information (Section 7 Spec) */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg border border-slate-800/50 bg-[#08131e] p-2">
                    <div className="text-[10px] text-slate-500 font-medium">Sisa Waktu Proses</div>
                    <div className="mt-0.5 font-bold text-slate-200">
                      {tank.remainingTimeStr ? (
                        <span className="text-cyan-300">{tank.remainingTimeStr}</span>
                      ) : isReady ? (
                        <span className="text-emerald-400">Siap Dialirkan</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-800/50 bg-[#08131e] p-2">
                    <div className="text-[10px] text-slate-500 font-medium">Estimasi Siap</div>
                    <div className="mt-0.5 font-bold text-slate-200">
                      {tank.expectedReadyTimeStr ? (
                        <span className="text-amber-300">{tank.expectedReadyTimeStr}</span>
                      ) : isReady ? (
                        <span className="text-emerald-400">Siap Sekarang</span>
                      ) : (
                        <span className="text-slate-500">Menunggu Jadwal</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Row */}
                <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-slate-800/60 pt-3">
                  {tank.canDeliverNow && onDeliver && (
                    <button
                      type="button"
                      onClick={() => onDeliver(tank.ghId)}
                      disabled={isActionLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
                    >
                      <Droplets className="h-3.5 w-3.5" />
                      Siram ke Tanaman Sekarang
                    </button>
                  )}

                  {tank.canPreMixNow && onPreMix && (
                    <button
                      type="button"
                      onClick={() => onPreMix(tank.ghId)}
                      disabled={isActionLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-cyan-500 active:scale-95 disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Mulai Racik Batch
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
