"use client";

import React from "react";
import {
  Beaker,
  CheckCircle2,
  Clock,
  Droplets,
  FlaskConical,
} from "lucide-react";

export type TankState = "kosong" | "mixing" | "ready";

export interface MixingQueueItem {
  id: string;
  ghId: string;
  ghCode: string;
  recipeName: string;
  targetWaterL: number;
  position: number; // 1-based
  isActive: boolean;
}

export interface TankStatus {
  ghId: string;
  ghCode: string;
  state: TankState;
  levelPct?: number;
  recipeName?: string;
}

export function MixingQueuePanel({
  queue,
  tanks,
}: {
  queue: MixingQueueItem[];
  tanks: TankStatus[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Queue */}
      <div className="rounded-2xl border border-white/10 bg-[#0b2027] p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
            <FlaskConical className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-bold text-white">Queue Mixing</h3>
            <p className="text-xs text-slate-400">
              {queue.filter((q) => q.isActive).length} aktif • {queue.filter((q) => !q.isActive).length} antre
            </p>
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
            Antrean kosong — semua jadwal sudah diracik atau belum ada jadwal.
          </div>
        ) : (
          <div className="space-y-2.5">
            {queue.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-xl border p-3.5 transition ${
                  item.isActive
                    ? "border-cyan-500/40 bg-cyan-500/10 shadow-[0_0_16px_rgba(6,182,212,0.15)]"
                    : "border-white/5 bg-white/[0.02]"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                    item.isActive
                      ? "bg-cyan-500 text-white animate-pulse"
                      : "bg-slate-700/60 text-slate-300"
                  }`}
                >
                  {item.position}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                      {item.ghCode}
                    </span>
                    <span className="truncate text-sm font-semibold text-slate-100">
                      {item.recipeName}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.targetWaterL} L • {item.isActive ? "Sedang diracik" : "Menunggu giliran"}
                  </div>
                </div>
                {item.isActive && (
                  <span className="flex h-2 w-2 shrink-0">
                    <span className="absolute h-2 w-2 animate-ping rounded-full bg-cyan-400 opacity-75" />
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tanks */}
      <div className="rounded-2xl border border-white/10 bg-[#0b2027] p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
            <Beaker className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-bold text-white">Status Tong Mixing</h3>
            <p className="text-xs text-slate-400">{tanks.length} tong • 1 per GH</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {tanks.map((tank) => (
            <div
              key={tank.ghId}
              className={`rounded-xl border p-4 transition ${
                tank.state === "ready"
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : tank.state === "mixing"
                    ? "border-cyan-500/40 bg-cyan-500/10"
                    : "border-white/5 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">{tank.ghCode}</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    tank.state === "ready"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : tank.state === "mixing"
                        ? "bg-cyan-500/20 text-cyan-300 animate-pulse"
                        : "bg-slate-700/60 text-slate-400"
                  }`}
                >
                  {tank.state === "ready" ? (
                    <><CheckCircle2 className="h-3 w-3" /> Ready</>
                  ) : tank.state === "mixing" ? (
                    <><FlaskConical className="h-3 w-3" /> Mixing</>
                  ) : (
                    <><Clock className="h-3 w-3" /> Kosong</>
                  )}
                </span>
              </div>
              {/* Level bar */}
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    tank.state === "ready"
                      ? "bg-emerald-400"
                      : tank.state === "mixing"
                        ? "bg-cyan-400"
                        : "bg-slate-600"
                  }`}
                  style={{ width: `${tank.levelPct ?? (tank.state === "ready" ? 100 : tank.state === "mixing" ? 50 : 0)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-slate-400">
                  <Droplets className="h-3 w-3" />
                  {tank.levelPct ?? (tank.state === "ready" ? 100 : 0)}%
                </span>
                {tank.recipeName && (
                  <span className="truncate text-slate-500">{tank.recipeName}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {tanks.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
            Belum ada data tong.
          </div>
        )}
      </div>
    </div>
  );
}

