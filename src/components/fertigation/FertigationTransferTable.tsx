"use client";

import React, { useState } from "react";
import {
  CalendarClock,
  Clock,
  Droplets,
  Plus,
  Power,
} from "lucide-react";
import type { FertigationSchedule, Greenhouse, WaterTransferSchedule } from "@/lib/types";

interface FertigationTransferTableProps {
  schedules: FertigationSchedule[];
  greenhouses: Greenhouse[];
  transferSchedules?: WaterTransferSchedule[];
  complexId?: string;
  complexName?: string;
  onOpenCreate?: () => void;
  onToggleSchedule?: (id: string, enabled: boolean) => void;
  isActionLoading?: boolean;
  className?: string;
}

export function FertigationTransferTable({
  schedules,
  greenhouses,
  transferSchedules = [],
  complexId = "complex-01",
  complexName,
  onOpenCreate,
  onToggleSchedule,
  isActionLoading = false,
  className = "",
}: FertigationTransferTableProps) {
  const [selectedGhFilter, setSelectedGhFilter] = useState<string>("ALL");

  const filteredSchedules = selectedGhFilter === "ALL"
    ? schedules
    : schedules.filter((s) => s.ghId === selectedGhFilter);

  const filteredTransfers = selectedGhFilter === "ALL"
    ? transferSchedules
    : transferSchedules.filter((t) => true); // Transfer is complex-level

  const formatTiming = (s: FertigationSchedule) => {
    switch (s.trigger) {
      case "specific-time":
        return `Setiap hari ${s.time}`;
      case "days-of-week":
        return `${s.repeat || "Hari tertentu"} ${s.time}`;
      case "interval":
        return `Tiap ${s.intervalHours || 3} jam`;
      case "specific-date":
        return `${s.date || "Hari ini"} ${s.time}`;
      default:
        return s.time;
    }
  };

  const getGhCode = (ghId: string) => {
    const gh = greenhouses.find((g) => g.id === ghId);
    return gh?.code || ghId;
  };

  const getRecipeName = (s: FertigationSchedule) => {
    const gh = greenhouses.find((g) => g.id === s.ghId);
    const recipe = gh?.recipes?.find((r) => r.id === s.recipeId);
    return recipe?.name || "–";
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight text-slate-100">
              Fertigation & Transfer Schedules — {complexName || complexId}
            </h3>
            <p className="text-xs text-slate-500">
              {filteredSchedules.length} jadwal fertigasi
              {filteredTransfers.length > 0 && ` • ${filteredTransfers.length} jadwal transfer`}
            </p>
          </div>
        </div>

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
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" /> Tambah Jadwal
            </button>
          )}
        </div>
      </div>

      {/* Fertigation Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/60 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-semibold">Jadwal</th>
              <th className="px-4 py-3 font-semibold">Greenhouse</th>
              <th className="px-4 py-3 font-semibold">Waktu</th>
              <th className="px-4 py-3 font-semibold">Target Air</th>
              <th className="px-4 py-3 font-semibold">Resep</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filteredSchedules.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  <Clock className="mx-auto mb-2 h-8 w-8 text-slate-600" />
                  <p className="font-semibold text-slate-300">Belum ada jadwal fertigasi</p>
                  <p className="mt-1 text-xs">Buat jadwal untuk menyiram dan meracik nutrisi otomatis.</p>
                </td>
              </tr>
            ) : (
              filteredSchedules.map((s) => (
                <tr key={s.id} className="border-b border-slate-800/60 transition hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-100">{s.name}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                      <Droplets className="h-3 w-3" />
                      Fertigasi
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-200">
                      {getGhCode(s.ghId)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{formatTiming(s)}</td>
                  <td className="px-4 py-3 text-slate-300">{s.targetWaterL} L</td>
                  <td className="px-4 py-3 text-slate-300">{getRecipeName(s)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        s.enabled
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border-slate-700 bg-slate-800/60 text-slate-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-slate-500"}`} />
                      {s.enabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {onToggleSchedule && (
                      <button
                        type="button"
                        onClick={() => onToggleSchedule(s.id, !s.enabled)}
                        disabled={isActionLoading}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
                        title={s.enabled ? "Nonaktifkan" : "Aktifkan"}
                      >
                        <Power className="h-3.5 w-3.5" />
                        {s.enabled ? "Matikan" : "Nyalakan"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Transfer Table (if any) */}
      {filteredTransfers.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-semibold">Jadwal Transfer</th>
                <th className="px-4 py-3 font-semibold">Waktu</th>
                <th className="px-4 py-3 font-semibold">Durasi</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransfers.map((t) => (
                <tr key={t.id} className="border-b border-slate-800/60 transition hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-semibold text-slate-100">{t.name}</td>
                  <td className="px-4 py-3 text-slate-300">{t.time}</td>
                  <td className="px-4 py-3 text-slate-300">{t.durationMin} menit</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        t.enabled
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border-slate-700 bg-slate-800/60 text-slate-400"
                      }`}
                    >
                      {t.enabled ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

