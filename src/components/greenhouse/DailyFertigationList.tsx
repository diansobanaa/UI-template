"use client";

import React from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Droplets,
  FlaskConical,
  Truck,
} from "lucide-react";

export type DailyItemStatus =
  | "menunggu-mixing"   // Belum diracik, di queue mixing
  | "mixing"            // Sedang diracik
  | "ready"             // Tong ready, menunggu jadwal
  | "pre-mix"           // T-3 menit: mixer ON (homogenisasi ulang)
  | "delivering"        // Sedang distribusi
  | "selesai"           // Selesai
  | "gagal";            // Gagal

export interface DailyFertigationItem {
  id: string;
  time: string;          // "06:00"
  ghId: string;
  ghCode: string;
  recipeName: string;
  targetWaterL: number;
  status: DailyItemStatus;
  tankReady?: boolean;
}

const STATUS_CONFIG: Record<DailyItemStatus, { label: string; icon: React.ComponentType<{ className?: string }>; classes: string }> = {
  "menunggu-mixing": {
    label: "Menunggu Mixing",
    icon: Clock,
    classes: "border-slate-700 bg-slate-800/60 text-slate-400",
  },
  "mixing": {
    label: "Mixing",
    icon: FlaskConical,
    classes: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  },
  "ready": {
    label: "Ready to Fertigate",
    icon: CheckCircle2,
    classes: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  "pre-mix": {
    label: "Pre-mix (T-3)",
    icon: FlaskConical,
    classes: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  "delivering": {
    label: "Delivering",
    icon: Truck,
    classes: "border-purple-500/40 bg-purple-500/15 text-purple-300",
  },
  "selesai": {
    label: "Selesai",
    icon: CheckCircle2,
    classes: "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
  },
  "gagal": {
    label: "Gagal",
    icon: Clock,
    classes: "border-red-500/40 bg-red-500/15 text-red-300",
  },
};

export function DailyFertigationList({
  items,
  dateLabel,
}: {
  items: DailyFertigationItem[];
  dateLabel?: string;
}) {
  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b2027] p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-bold text-white">Jadwal Fertigasi Hari Ini</h3>
          <p className="text-xs text-slate-400">
            {dateLabel || "Hasil fetch 00:00"} • {sorted.length} jadwal
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center">
          <CalendarClock className="mx-auto mb-2 h-8 w-8 text-slate-600" />
          <p className="font-semibold text-slate-300">Tidak ada jadwal hari ini</p>
          <p className="mt-1 text-xs text-slate-500">Buat jadwal untuk mengisi list harian.</p>
        </div>
      ) : (
        <div className="relative space-y-0">
          {/* Timeline line */}
          <div className="absolute bottom-4 left-[52px] top-4 w-0.5 bg-white/10" />
          {sorted.map((item, idx) => {
            const cfg = STATUS_CONFIG[item.status];
            const Icon = cfg.icon;
            const isActive = item.status === "mixing" || item.status === "delivering" || item.status === "pre-mix";
            return (
              <div key={item.id} className="relative flex gap-4 py-3">
                {/* Time */}
                <div className="w-16 shrink-0 pt-1 text-right">
                  <div className="text-sm font-bold text-white">{item.time}</div>
                </div>
                {/* Dot */}
                <div className="relative z-10 flex shrink-0 items-start justify-center pt-1.5" style={{ width: 24 }}>
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                      isActive
                        ? "border-cyan-400 bg-cyan-500/20 animate-pulse"
                        : item.status === "selesai"
                          ? "border-emerald-500 bg-emerald-500/20"
                          : item.status === "ready"
                            ? "border-emerald-400 bg-emerald-500/10"
                            : "border-slate-600 bg-slate-800"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isActive
                          ? "bg-cyan-300"
                          : item.status === "selesai" || item.status === "ready"
                            ? "bg-emerald-400"
                            : "bg-slate-500"
                      }`}
                    />
                  </span>
                </div>
                {/* Card */}
                <div className="min-w-0 flex-1">
                  <div className={`rounded-xl border p-3.5 transition ${isActive ? "border-cyan-500/40 bg-cyan-500/5" : "border-white/5 bg-white/[0.02]"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-200">
                          {item.ghCode}
                        </span>
                        <span className="text-sm font-semibold text-slate-100">{item.recipeName}</span>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${cfg.classes}`}>
                        <Icon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Droplets className="h-3 w-3" />
                        {item.targetWaterL} L
                      </span>
                      {item.tankReady && (
                        <span className="flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          Tong ready
                        </span>
                      )}
                    </div>
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

