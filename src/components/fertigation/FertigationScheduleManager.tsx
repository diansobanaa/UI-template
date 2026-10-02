"use client";

import React, { useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Droplets,
  Layers,
  Play,
  Plus,
  Power,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { FertigationSchedule, Greenhouse, Recipe } from "@/lib/types";

interface FertigationScheduleManagerProps {
  schedules: FertigationSchedule[];
  greenhouses: Greenhouse[];
  onOpenCreate?: () => void;
  onToggleSchedule?: (id: string, enabled: boolean) => void;
  isActionLoading?: boolean;
  className?: string;
}

export function FertigationScheduleManager({
  schedules,
  greenhouses,
  onOpenCreate,
  onToggleSchedule,
  isActionLoading = false,
  className = "",
}: FertigationScheduleManagerProps) {
  const [selectedGhFilter, setSelectedGhFilter] = useState<string>("ALL");

  const filteredSchedules = selectedGhFilter === "ALL"
    ? schedules
    : schedules.filter((s) => s.ghId === selectedGhFilter);

  // Helper: map trigger and time to clean human Indonesian string
  const formatHumanTiming = (s: FertigationSchedule) => {
    switch (s.trigger) {
      case "specific-time":
        return `Setiap Hari pukul ${s.time}`;
      case "days-of-week":
        return `${s.repeat || "Hari Tertentu"} pukul ${s.time}`;
      case "interval":
        return `Tiap ${s.intervalHours || 3} Jam (Mulai ${s.time} s/d ${s.endTime || "Selesai"})`;
      case "specific-date":
        return `Tanggal ${s.date || "Hari Ini"} pukul ${s.time}`;
      default:
        return `Pukul ${s.time}`;
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header & Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold tracking-tight text-slate-100">
                Jadwal Otomasi Fertigasi (Fertigation Schedules)
              </h3>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                {schedules.length} Jadwal Aktif
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Jadwal otomatisasi penyiraman dan pemberian nutrisi terencana per greenhouse.
            </p>
          </div>
        </div>

        {/* Greenhouse Filter Tabs + Add Button */}
        <div className="flex flex-wrap items-center gap-2">
          {greenhouses.length > 1 && (
            <div className="flex rounded-lg border border-slate-800 bg-slate-900/80 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSelectedGhFilter("ALL")}
                className={`rounded-md px-2.5 py-1 font-semibold transition ${
                  selectedGhFilter === "ALL"
                    ? "bg-slate-800 text-slate-100 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Semua GH
              </button>
              {greenhouses.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGhFilter(g.id)}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${
                    selectedGhFilter === g.id
                      ? "bg-emerald-600/80 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {g.code || g.id}
                </button>
              ))}
            </div>
          )}

          {onOpenCreate && (
            <button
              type="button"
              onClick={onOpenCreate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" /> Tambah Jadwal
            </button>
          )}
        </div>
      </div>

      {/* Schedule Cards Grid */}
      {filteredSchedules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-[#0e1a2a]/40 p-8 text-center">
          <Clock className="mx-auto h-8 w-8 text-slate-600 mb-2" />
          <h4 className="text-sm font-semibold text-slate-300">Belum Ada Jadwal Fertigasi</h4>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
            Buat jadwal fertigasi terencana untuk menyiram dan meracik nutrisi otomatis pada jam-jam tertentu.
          </p>
          {onOpenCreate && (
            <button
              type="button"
              onClick={onOpenCreate}
              className="mt-3.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              <Plus className="h-3.5 w-3.5" /> Buat Jadwal Baru
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSchedules.map((s) => {
            const gh = greenhouses.find((g) => g.id === s.ghId);
            const recipe = gh?.recipes?.find((r) => r.id === s.recipeId);

            return (
              <div
                key={s.id}
                className="group relative flex flex-col justify-between rounded-xl border border-slate-800 bg-[#0e1a2a]/80 p-4 transition hover:border-slate-700"
              >
                <div>
                  {/* Top Row: Greenhouse Target + Status Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-bold text-emerald-300">
                          {gh?.code || s.ghId}
                        </span>
                        <h4 className="text-sm font-bold text-slate-100">{s.name}</h4>
                      </div>
                      <p className="mt-1 text-xs text-slate-400 font-medium">
                        {formatHumanTiming(s)}
                      </p>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        s.enabled
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-700 bg-slate-800 text-slate-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-slate-500"}`} />
                      {s.enabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </div>

                  {/* Middle: Clear Human Information (Section 4 Example) */}
                  <div className="mt-3.5 space-y-2 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Jadwal Berikutnya:</span>
                      <span className="font-bold text-amber-300">{s.nextRun || `Hari ini ${s.time}`}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Resep Nutrisi:</span>
                      <span className="font-semibold text-slate-200">{recipe?.name || "Nutrisi Standar"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Target Volume:</span>
                      <span className="font-semibold text-slate-200">{s.targetWaterL} Liter Air Baku</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Status Operasi:</span>
                      <span className="font-semibold text-emerald-400">Menunggu Jam Jadwal</span>
                    </div>
                  </div>
                </div>

                {/* Footer: Schedule Automation Status */}
                <div className="mt-3.5 flex items-center justify-between border-t border-slate-800/80 pt-3">
                  {onToggleSchedule ? (
                    <button
                      type="button"
                      onClick={() => onToggleSchedule(s.id, !s.enabled)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition"
                    >
                      <Power className="h-3 w-3" />
                      {s.enabled ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  ) : <span />}

                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    Otomatis by Sistem
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
