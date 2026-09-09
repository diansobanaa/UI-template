"use client";

import { useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Flower2,
  History,
  Info,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Sprout,
  Wheat,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { Greenhouse } from "@/lib/types";
import { formatIndoDate } from "@/lib/cropCycle";
import { CropCycleModals } from "./CropCycleModals";
import { cropCycleService } from "@/lib/services";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/errors";

interface CropCycleTimelineProps {
  gh: Greenhouse;
  onRefresh?: () => void;
  className?: string;
}

export function CropCycleTimeline({ gh, onRefresh, className = "" }: CropCycleTimelineProps) {
  const toast = useToast();
  const cycle = gh.cropCycle ?? {
    status: "NO_CYCLE",
    tanggalTanam: null,
    tanggalPolinasi: null,
  };

  // Modal open states
  const [startNormalOpen, setStartNormalOpen] = useState(false);
  const [startOngoingOpen, setStartOngoingOpen] = useState(false);
  const [polinasiOpen, setPolinasiOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Handlers communicating directly through cropCycleService (simulates ESP32 latency + validation)
  const handleStartCycle = async (tanggalTanam: string) => {
    try {
      await cropCycleService.startCycle(gh.id, tanggalTanam);
      toast(`Siklus tanam dimulai untuk ${gh.code}. HST dihitung otomatis dari ESP32.`, "success");
      onRefresh?.();
    } catch (err) {
      toast(errorMessage(err), "error");
      throw err;
    }
  };

  const handleStartOngoingCycle = async (tanggalTanam: string) => {
    try {
      await cropCycleService.startOngoingCycle(gh.id, tanggalTanam);
      toast(`Siklus berjalan berhasil disimpan ke ESP32. Umur tanaman langsung tersinkronisasi.`, "success");
      onRefresh?.();
    } catch (err) {
      toast(errorMessage(err), "error");
      throw err;
    }
  };

  const handleRecordPolinasi = async (tanggalPolinasi: string) => {
    try {
      await cropCycleService.recordPolinasi(gh.id, tanggalPolinasi);
      toast(`Tanggal polinasi dicatat di ESP32. HSP sekarang aktif.`, "success");
      onRefresh?.();
    } catch (err) {
      toast(errorMessage(err), "error");
      throw err;
    }
  };

  const handleUpdateTanggalTanam = async (newTanggalTanam: string) => {
    try {
      await cropCycleService.updateTanggalTanam(gh.id, newTanggalTanam);
      toast(`Tanggal tanam diperbarui di ESP32. Perhitungan HST telah disesuaikan.`, "success");
      onRefresh?.();
    } catch (err) {
      toast(errorMessage(err), "error");
      throw err;
    }
  };

  const handleUpdateTanggalPolinasi = async (newTanggalPolinasi: string) => {
    try {
      await cropCycleService.updateTanggalPolinasi(gh.id, newTanggalPolinasi);
      toast(`Tanggal polinasi diperbarui di ESP32. Perhitungan HSP telah disesuaikan.`, "success");
      onRefresh?.();
    } catch (err) {
      toast(errorMessage(err), "error");
      throw err;
    }
  };

  const handleDeleteTanggalPolinasi = async () => {
    try {
      await cropCycleService.deleteTanggalPolinasi(gh.id);
      toast(`Tanggal polinasi dihapus dari ESP32. HSP kembali menjadi belum tersedia.`, "info");
      onRefresh?.();
    } catch (err) {
      toast(errorMessage(err), "error");
      throw err;
    }
  };

  const handleHarvest = async (harvestDate?: string) => {
    try {
      await cropCycleService.harvest(gh.id, harvestDate);
      toast(`Siklus panen ${gh.code} selesai dicatat. Data aktif telah dibersihkan dari ESP32.`, "success");
      onRefresh?.();
    } catch (err) {
      toast(errorMessage(err), "error");
      throw err;
    }
  };

  const hst = gh.telemetry.hstDays;
  const hsp = gh.telemetry.hspDays;

  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)] sm:p-6 ${className}`}>
      {/* ---------------- STATE 1: NO_CYCLE (Belum Ada Tanaman) ---------------- */}
      {cycle.status === "NO_CYCLE" && (
        <div className="flex flex-col items-center justify-center py-6 text-center sm:py-8">
          <div className="relative mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-100/60 ring-1 ring-emerald-200/50">
            <Sprout className="h-8 w-8 text-emerald-600" />
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
              <Plus className="h-3.5 w-3.5 text-emerald-600" />
            </span>
          </div>

          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{gh.code}</div>
          <h3 className="mt-1 text-xl font-bold tracking-tight text-slate-900">Belum ada tanaman</h3>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
            Greenhouse ini belum memiliki siklus aktif. Mulai siklus tanam baru untuk mengaktifkan perhitungan otomatis HST dan pemantauan nutrisi.
          </p>

          <div className="mt-5 flex flex-col items-center gap-3">
            <Button
              id="btn-mulai-menanam"
              size="lg"
              onClick={() => setStartNormalOpen(true)}
              className="group cursor-pointer rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 transition-all hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-600/30 active:scale-[0.98]"
            >
              <Plus className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />
              + Mulai Menanam
            </Button>

            {/* Link kecil khusus tanaman sedang berjalan */}
            <button
              id="link-ongoing-cycle"
              type="button"
              onClick={() => setStartOngoingOpen(true)}
              className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-emerald-600 hover:underline"
            >
              <span>Sudah ada tanaman yang sedang berjalan? Masukkan tanggal tanam</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ---------------- STATE 2 & 3: ACTIVE CYCLE (Sudah Tanam / Sudah Polinasi) ---------------- */}
      {cycle.status === "ACTIVE" && (
        <div>
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/60">
                <Sprout className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{gh.code}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Siklus Aktif
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">Timeline Masa Tanam — {gh.crop}</h3>
              </div>
            </div>

            {/* Action Bar based on progressive disclosure */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id="btn-kelola-siklus"
                variant="outline"
                size="sm"
                onClick={() => setManageOpen(true)}
                className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Settings className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                Kelola Siklus
              </Button>

              <Button
                id="btn-hari-panen"
                size="sm"
                onClick={() => setHarvestOpen(true)}
                className="cursor-pointer bg-amber-500 text-white shadow-sm hover:bg-amber-600 active:scale-[0.98]"
              >
                <Wheat className="mr-1.5 h-3.5 w-3.5" />
                🌾 Hari Panen
              </Button>
            </div>
          </div>

          {/* Timeline Process Cards */}
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* STEP 1: TANAM */}
            <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/40 to-white p-4 transition hover:border-emerald-300 hover:shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-800">
                  <span className="text-base">🌱</span> TANAM
                </div>
                <span className="rounded-full bg-emerald-100/80 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                  HST {hst} hari
                </span>
              </div>

              <div className="mt-4">
                <div className="text-[11px] font-medium text-slate-400">Tanggal Tanam:</div>
                <div className="mt-0.5 text-base font-bold text-slate-900">
                  {formatIndoDate(cycle.tanggalTanam)}
                </div>
              </div>

              <div className="mt-3 border-t border-emerald-100 pt-2 text-[11px] text-emerald-700">
                ● Umur tanaman aktif
              </div>
            </div>

            {/* STEP 2: POLINASI */}
            {cycle.tanggalPolinasi ? (
              // Polinasi sudah dicatat
              <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-b from-violet-50/40 to-white p-4 transition hover:border-violet-300 hover:shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-violet-800">
                    <span className="text-base">🌼</span> POLINASI
                  </div>
                  <span className="rounded-full bg-violet-100/80 px-2.5 py-0.5 text-[11px] font-bold text-violet-800">
                    HSP {hsp} hari
                  </span>
                </div>

                <div className="mt-4">
                  <div className="text-[11px] font-medium text-slate-400">Tanggal Polinasi:</div>
                  <div className="mt-0.5 text-base font-bold text-slate-900">
                    {formatIndoDate(cycle.tanggalPolinasi)}
                  </div>
                </div>

                <div className="mt-3 border-t border-violet-100 pt-2 text-[11px] text-violet-700">
                  ● Fase pembuahan
                </div>
              </div>
            ) : (
              // Polinasi belum dicatat
              <div className="relative flex flex-col justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 transition hover:border-slate-400">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                    <span className="text-base">🌼</span> POLINASI
                  </div>
                  <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    Belum dicatat
                  </span>
                </div>

                <div className="my-2">
                  <p className="text-xs text-slate-500">
                    Bunga telah diserbuki? Catat tanggal polinasi untuk menghitung HSP secara otomatis.
                  </p>
                </div>

                <Button
                  id="btn-catat-polinasi"
                  variant="outline"
                  size="sm"
                  onClick={() => setPolinasiOpen(true)}
                  className="mt-2 w-full cursor-pointer border-violet-200 bg-violet-50 text-xs font-semibold text-violet-700 hover:bg-violet-100 hover:text-violet-800"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  + Catat Polinasi
                </Button>
              </div>
            )}

            {/* STEP 3: HARI PANEN */}
            <div className="relative flex flex-col justify-between rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50/30 to-white p-4 transition hover:border-amber-300 hover:shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
                  <span className="text-base">🌾</span> HARI PANEN
                </div>
                <span className="rounded-full bg-amber-100/70 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  Siap dieksekusi
                </span>
              </div>

              <div className="my-2">
                <p className="text-xs leading-relaxed text-slate-500">
                  Ketika buah siap dipanen, tandai hari panen untuk menutup siklus aktif dan mengarsipkan log.
                </p>
              </div>

              <Button
                id="btn-trigger-harvest"
                size="sm"
                onClick={() => setHarvestOpen(true)}
                className="mt-2 w-full cursor-pointer bg-amber-600 text-xs font-semibold text-white hover:bg-amber-700"
              >
                <Wheat className="mr-1.5 h-3.5 w-3.5" />
                🌾 Hari Panen
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- STATE 4: HARVESTED (Siklus Selesai) ---------------- */}
      {cycle.status === "HARVESTED" && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-200/60">
                <Wheat className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{gh.code}</span>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                    🌾 Siklus Selesai
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900">Panen Terakhir Selesai</h3>
              </div>
            </div>

            {/* Actions for finished cycle */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                id="btn-lihat-riwayat"
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(true)}
                className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <History className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                Lihat Riwayat
              </Button>
              <Button
                id="btn-mulai-siklus-baru"
                size="sm"
                onClick={() => setStartNormalOpen(true)}
                className="cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98]"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                + Mulai Siklus Baru
              </Button>
            </div>
          </div>

          {/* Last Cycle Summary Card */}
          {cycle.lastHarvestSummary ? (
            <div className="mt-4 rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/50 via-white to-slate-50/70 p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-900">
                <span>Ringkasan Siklus Terakhir</span>
                <span className="text-slate-500">Panen: {formatIndoDate(cycle.lastHarvestSummary.harvestDate)}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <div className="rounded-lg bg-white/80 p-2.5 ring-1 ring-slate-100">
                  <div className="text-[10px] text-slate-400">Tanggal Tanam</div>
                  <div className="mt-0.5 font-bold text-slate-800">{formatIndoDate(cycle.lastHarvestSummary.tanggalTanam)}</div>
                </div>
                <div className="rounded-lg bg-white/80 p-2.5 ring-1 ring-slate-100">
                  <div className="text-[10px] text-slate-400">Tanggal Polinasi</div>
                  <div className="mt-0.5 font-bold text-slate-800">{formatIndoDate(cycle.lastHarvestSummary.tanggalPolinasi)}</div>
                </div>
                <div className="rounded-lg bg-white/80 p-2.5 ring-1 ring-slate-100">
                  <div className="text-[10px] text-slate-400">Total HST Panen</div>
                  <div className="mt-0.5 font-bold text-emerald-600">{cycle.lastHarvestSummary.hstAtHarvest} hari</div>
                </div>
                <div className="rounded-lg bg-white/80 p-2.5 ring-1 ring-slate-100">
                  <div className="text-[10px] text-slate-400">Total HSP Panen</div>
                  <div className="mt-0.5 font-bold text-violet-600">
                    {cycle.lastHarvestSummary.hspAtHarvest !== null ? `${cycle.lastHarvestSummary.hspAtHarvest} hari` : "–"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center text-xs text-slate-500">
              Siklus telah diselesaikan. ESP32 siap memulai siklus tanaman baru.
            </div>
          )}
        </div>
      )}

      {/* All interactive modals */}
      <CropCycleModals
        gh={gh}
        startNormalOpen={startNormalOpen}
        onCloseStartNormal={() => setStartNormalOpen(false)}
        startOngoingOpen={startOngoingOpen}
        onCloseStartOngoing={() => setStartOngoingOpen(false)}
        polinasiOpen={polinasiOpen}
        onClosePolinasi={() => setPolinasiOpen(false)}
        manageOpen={manageOpen}
        onCloseManage={() => setManageOpen(false)}
        harvestOpen={harvestOpen}
        onCloseHarvest={() => setHarvestOpen(false)}
        historyOpen={historyOpen}
        onCloseHistory={() => setHistoryOpen(false)}
        onStartCycle={handleStartCycle}
        onStartOngoingCycle={handleStartOngoingCycle}
        onRecordPolinasi={handleRecordPolinasi}
        onUpdateTanggalTanam={handleUpdateTanggalTanam}
        onUpdateTanggalPolinasi={handleUpdateTanggalPolinasi}
        onDeleteTanggalPolinasi={handleDeleteTanggalPolinasi}
        onHarvest={handleHarvest}
      />
    </div>
  );
}
