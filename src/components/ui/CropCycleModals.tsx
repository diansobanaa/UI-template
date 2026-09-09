"use client";

import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Flower2,
  History,
  Info,
  RotateCcw,
  Sparkles,
  Sprout,
  Trash2,
  Wheat,
  X,
} from "lucide-react";
import { Modal, ConfirmDialog } from "@/components/ui/overlay";
import { Button, Input, Label } from "@/components/ui/primitives";
import type { CropCycle, Greenhouse } from "@/lib/types";
import {
  calculateDaysBetween,
  formatIndoDate,
  getSystemDate,
  parseDateString,
  toIsoDateString,
  validateTanggalPolinasi,
  validateTanggalTanam,
} from "@/lib/cropCycle";

interface CropCycleModalsProps {
  gh: Greenhouse;
  // Modal visibility states
  startNormalOpen: boolean;
  onCloseStartNormal: () => void;
  startOngoingOpen: boolean;
  onCloseStartOngoing: () => void;
  polinasiOpen: boolean;
  onClosePolinasi: () => void;
  manageOpen: boolean;
  onCloseManage: () => void;
  harvestOpen: boolean;
  onCloseHarvest: () => void;
  historyOpen: boolean;
  onCloseHistory: () => void;
  // Action callbacks
  onStartCycle: (tanggalTanam: string) => Promise<void>;
  onStartOngoingCycle: (tanggalTanam: string) => Promise<void>;
  onRecordPolinasi: (tanggalPolinasi: string) => Promise<void>;
  onUpdateTanggalTanam: (newTanggalTanam: string) => Promise<void>;
  onUpdateTanggalPolinasi: (newTanggalPolinasi: string) => Promise<void>;
  onDeleteTanggalPolinasi: () => Promise<void>;
  onHarvest: (harvestDate?: string) => Promise<void>;
}

export function CropCycleModals({
  gh,
  startNormalOpen,
  onCloseStartNormal,
  startOngoingOpen,
  onCloseStartOngoing,
  polinasiOpen,
  onClosePolinasi,
  manageOpen,
  onCloseManage,
  harvestOpen,
  onCloseHarvest,
  historyOpen,
  onCloseHistory,
  onStartCycle,
  onStartOngoingCycle,
  onRecordPolinasi,
  onUpdateTanggalTanam,
  onUpdateTanggalPolinasi,
  onDeleteTanggalPolinasi,
  onHarvest,
}: CropCycleModalsProps) {
  const todayStr = useMemo(() => toIsoDateString(getSystemDate()), []);
  const cycle = gh.cropCycle;

  /* ---------------- Modal 1: Mulai Siklus Normal ---------------- */
  const [normalTanamDate, setNormalTanamDate] = useState(todayStr);
  const [submittingNormal, setSubmittingNormal] = useState(false);
  const [normalError, setNormalError] = useState<string | null>(null);

  const handleNormalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = validateTanggalTanam(normalTanamDate);
    if (!val.valid) {
      setNormalError(val.error || "Tanggal tidak valid");
      return;
    }
    setNormalError(null);
    setSubmittingNormal(true);
    try {
      await onStartCycle(normalTanamDate);
      onCloseStartNormal();
    } catch (err: unknown) {
      setNormalError(err instanceof Error ? err.message : "Gagal memulai siklus");
    } finally {
      setSubmittingNormal(false);
    }
  };

  /* ---------------- Modal 2: Siklus Berjalan (Backdated) ---------------- */
  const [ongoingTanamDate, setOngoingTanamDate] = useState("2026-01-24");
  const [submittingOngoing, setSubmittingOngoing] = useState(false);
  const [ongoingError, setOngoingError] = useState<string | null>(null);

  const ongoingValidation = useMemo(() => validateTanggalTanam(ongoingTanamDate), [ongoingTanamDate]);
  const ongoingHstPreview = useMemo(() => {
    if (!ongoingValidation.valid) return 0;
    return calculateDaysBetween(ongoingTanamDate);
  }, [ongoingTanamDate, ongoingValidation]);

  const handleOngoingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ongoingValidation.valid) {
      setOngoingError(ongoingValidation.error || "Tanggal tidak valid");
      return;
    }
    setOngoingError(null);
    setSubmittingOngoing(true);
    try {
      await onStartOngoingCycle(ongoingTanamDate);
      onCloseStartOngoing();
    } catch (err: unknown) {
      setOngoingError(err instanceof Error ? err.message : "Gagal menyimpan siklus berjalan");
    } finally {
      setSubmittingOngoing(false);
    }
  };

  /* ---------------- Modal 3: Catat Polinasi ---------------- */
  const [polinasiDate, setPolinasiDate] = useState(todayStr);
  const [submittingPolinasi, setSubmittingPolinasi] = useState(false);
  const [polinasiError, setPolinasiError] = useState<string | null>(null);

  const polinasiValidation = useMemo(
    () => validateTanggalPolinasi(polinasiDate, cycle?.tanggalTanam),
    [polinasiDate, cycle?.tanggalTanam]
  );
  const polinasiHspPreview = useMemo(() => {
    if (!polinasiValidation.valid) return 0;
    return calculateDaysBetween(polinasiDate);
  }, [polinasiDate, polinasiValidation]);

  const handlePolinasiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!polinasiValidation.valid) {
      setPolinasiError(polinasiValidation.error || "Tanggal tidak valid");
      return;
    }
    setPolinasiError(null);
    setSubmittingPolinasi(true);
    try {
      await onRecordPolinasi(polinasiDate);
      onClosePolinasi();
    } catch (err: unknown) {
      setPolinasiError(err instanceof Error ? err.message : "Gagal mencatat polinasi");
    } finally {
      setSubmittingPolinasi(false);
    }
  };

  /* ---------------- Modal 4: Kelola Siklus (Unified Management) ---------------- */
  type ManageTab = "tanam" | "polinasi" | "hapus_polinasi";
  const [manageTab, setManageTab] = useState<ManageTab>("tanam");
  const [editTanamDate, setEditTanamDate] = useState(cycle?.tanggalTanam || todayStr);
  const [editPolinasiDate, setEditPolinasiDate] = useState(cycle?.tanggalPolinasi || todayStr);
  const [savingManage, setSavingManage] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [deletePolinasiConfirmOpen, setDeletePolinasiConfirmOpen] = useState(false);

  // Sync initial dates when modal opens
  const openManageWithSync = () => {
    setEditTanamDate(cycle?.tanggalTanam || todayStr);
    setEditPolinasiDate(cycle?.tanggalPolinasi || todayStr);
    setManageError(null);
  };

  const currentHst = calculateDaysBetween(cycle?.tanggalTanam);
  const previewNewHst = calculateDaysBetween(editTanamDate);

  const currentHsp = cycle?.tanggalPolinasi ? calculateDaysBetween(cycle.tanggalPolinasi) : null;
  const previewNewHsp = calculateDaysBetween(editPolinasiDate);

  const handleUpdateTanam = async () => {
    const val = validateTanggalTanam(editTanamDate);
    if (!val.valid) {
      setManageError(val.error || "Tanggal tanam tidak valid");
      return;
    }
    if (cycle?.tanggalPolinasi) {
      const polVal = validateTanggalPolinasi(cycle.tanggalPolinasi, editTanamDate);
      if (!polVal.valid) {
        setManageError("Tanggal tanam baru tidak boleh melebihi tanggal polinasi yang ada.");
        return;
      }
    }
    setManageError(null);
    setSavingManage(true);
    try {
      await onUpdateTanggalTanam(editTanamDate);
      onCloseManage();
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : "Gagal mengubah tanggal tanam");
    } finally {
      setSavingManage(false);
    }
  };

  const handleUpdatePolinasi = async () => {
    const val = validateTanggalPolinasi(editPolinasiDate, cycle?.tanggalTanam);
    if (!val.valid) {
      setManageError(val.error || "Tanggal polinasi tidak valid");
      return;
    }
    setManageError(null);
    setSavingManage(true);
    try {
      await onUpdateTanggalPolinasi(editPolinasiDate);
      onCloseManage();
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : "Gagal mengubah tanggal polinasi");
    } finally {
      setSavingManage(false);
    }
  };

  const handleDeletePolinasi = async () => {
    setSavingManage(true);
    try {
      await onDeleteTanggalPolinasi();
      setDeletePolinasiConfirmOpen(false);
      onCloseManage();
    } catch (err: unknown) {
      setManageError(err instanceof Error ? err.message : "Gagal menghapus tanggal polinasi");
    } finally {
      setSavingManage(false);
    }
  };

  /* ---------------- Modal 5: Konfirmasi Hari Panen ---------------- */
  const [submittingHarvest, setSubmittingHarvest] = useState(false);
  const [harvestError, setHarvestError] = useState<string | null>(null);

  const handleHarvestSubmit = async () => {
    setSubmittingHarvest(true);
    setHarvestError(null);
    try {
      await onHarvest(todayStr);
      onCloseHarvest();
    } catch (err: unknown) {
      setHarvestError(err instanceof Error ? err.message : "Gagal memproses panen");
    } finally {
      setSubmittingHarvest(false);
    }
  };

  return (
    <>
      {/* 1. Modal Mulai Siklus Tanam Normal */}
      <Modal
        open={startNormalOpen}
        onClose={onCloseStartNormal}
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Sprout className="h-5 w-5" />
            </span>
            <div>
              <div className="text-base font-bold text-slate-900">Mulai Siklus Tanam</div>
              <div className="text-xs font-normal text-slate-500">{gh.code} • {gh.crop}</div>
            </div>
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button variant="ghost" onClick={onCloseStartNormal} disabled={submittingNormal}>
              Batal
            </Button>
            <Button
              id="btn-save-start-normal"
              onClick={handleNormalSubmit}
              disabled={submittingNormal}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {submittingNormal ? "Menyimpan ke ESP32..." : "Simpan & Mulai Siklus"}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleNormalSubmit} className="space-y-4 pt-1">
          <div>
            <Label htmlFor="input-tanam-date" className="text-xs font-semibold text-slate-700">
              Tanggal Tanam
            </Label>
            <div className="relative mt-1.5">
              <Input
                id="input-tanam-date"
                type="date"
                max={todayStr}
                value={normalTanamDate}
                onChange={(e) => {
                  setNormalTanamDate(e.target.value);
                  setNormalError(null);
                }}
                className="w-full pl-3 pr-3 text-sm"
              />
            </div>
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs text-emerald-800">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>HST (Hari Setelah Tanam) akan dihitung otomatis berdasarkan tanggal tanam.</span>
            </div>
          </div>

          {normalError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
              {normalError}
            </div>
          )}
        </form>
      </Modal>

      {/* 2. Modal Masukkan Siklus yang Sedang Berjalan (Backdated) */}
      <Modal
        open={startOngoingOpen}
        onClose={onCloseStartOngoing}
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <History className="h-5 w-5" />
            </span>
            <div>
              <div className="text-base font-bold text-slate-900">Masukkan Siklus yang Sedang Berjalan</div>
              <div className="text-xs font-normal text-slate-500">{gh.code} • Sistem dipasang di tengah masa tanam</div>
            </div>
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button variant="ghost" onClick={onCloseStartOngoing} disabled={submittingOngoing}>
              Batal
            </Button>
            <Button
              id="btn-save-start-ongoing"
              onClick={handleOngoingSubmit}
              disabled={submittingOngoing || !ongoingValidation.valid}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {submittingOngoing ? "Menyimpan ke ESP32..." : "Gunakan Tanggal Ini"}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleOngoingSubmit} className="space-y-4 pt-1">
          <div>
            <Label htmlFor="input-ongoing-tanam-date" className="text-xs font-semibold text-slate-700">
              Tanggal Tanam Sebenarnya
            </Label>
            <div className="relative mt-1.5">
              <Input
                id="input-ongoing-tanam-date"
                type="date"
                max={todayStr}
                value={ongoingTanamDate}
                onChange={(e) => {
                  setOngoingTanamDate(e.target.value);
                  setOngoingError(null);
                }}
                className="w-full text-sm"
              />
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs leading-relaxed text-blue-800">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <span>Masukkan tanggal tanam sebenarnya. Sistem akan menghitung HST secara otomatis dari tanggal tersebut.</span>
            </div>
          </div>

          {/* Live Preview */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Preview Perhitungan</div>
            <div className="mt-2.5 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500">Tanggal tanam:</div>
                <div className="mt-0.5 text-sm font-bold text-slate-900">{formatIndoDate(ongoingTanamDate)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">HST sekarang:</div>
                <div className="mt-0.5 flex items-baseline gap-1 text-sm font-bold text-emerald-600">
                  <span className="text-lg">{ongoingHstPreview}</span> hari
                </div>
              </div>
            </div>
          </div>

          {ongoingValidation.warning && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>{ongoingValidation.warning}</span>
            </div>
          )}

          {ongoingError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
              {ongoingError}
            </div>
          )}
        </form>
      </Modal>

      {/* 3. Modal Catat Polinasi */}
      <Modal
        open={polinasiOpen}
        onClose={onClosePolinasi}
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Flower2 className="h-5 w-5" />
            </span>
            <div>
              <div className="text-base font-bold text-slate-900">Catat Tanggal Polinasi</div>
              <div className="text-xs font-normal text-slate-500">{gh.code} • Tanggal tanam: {formatIndoDate(cycle?.tanggalTanam)}</div>
            </div>
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button variant="ghost" onClick={onClosePolinasi} disabled={submittingPolinasi}>
              Batal
            </Button>
            <Button
              id="btn-save-polinasi"
              onClick={handlePolinasiSubmit}
              disabled={submittingPolinasi || !polinasiValidation.valid}
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
              {submittingPolinasi ? "Menyimpan ke ESP32..." : "Simpan Tanggal Polinasi"}
            </Button>
          </div>
        }
      >
        <form onSubmit={handlePolinasiSubmit} className="space-y-4 pt-1">
          <div>
            <Label htmlFor="input-polinasi-date" className="text-xs font-semibold text-slate-700">
              Tanggal Polinasi
            </Label>
            <div className="relative mt-1.5">
              <Input
                id="input-polinasi-date"
                type="date"
                min={cycle?.tanggalTanam || undefined}
                max={todayStr}
                value={polinasiDate}
                onChange={(e) => {
                  setPolinasiDate(e.target.value);
                  setPolinasiError(null);
                }}
                className="w-full text-sm"
              />
            </div>
          </div>

          <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-3 text-xs leading-relaxed text-violet-800">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <span>HSP (Hari Setelah Polinasi) akan dihitung otomatis dari tanggal polinasi ke ESP32.</span>
            </div>
          </div>

          {/* Live Preview */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Preview Perhitungan</div>
            <div className="mt-2.5 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500">Tanggal Polinasi:</div>
                <div className="mt-0.5 text-sm font-bold text-slate-900">{formatIndoDate(polinasiDate)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">HSP sekarang:</div>
                <div className="mt-0.5 flex items-baseline gap-1 text-sm font-bold text-violet-600">
                  <span className="text-lg">{polinasiHspPreview}</span> hari
                </div>
              </div>
            </div>
          </div>

          {!polinasiValidation.valid && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
              {polinasiValidation.error}
            </div>
          )}

          {polinasiError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
              {polinasiError}
            </div>
          )}
        </form>
      </Modal>

      {/* 4. Modal Kelola Siklus (Satu Pintu Pengelolaan) */}
      <Modal
        open={manageOpen}
        onClose={onCloseManage}
        width={500}
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Sparkles className="h-5 w-5 text-emerald-600" />
            </span>
            <div>
              <div className="text-base font-bold text-slate-900">Kelola Siklus — {gh.code}</div>
              <div className="text-xs font-normal text-slate-500">Satu pintu pembaruan tanggal masa tanam</div>
            </div>
          </div>
        }
      >
        <div className="space-y-4 pt-1">
          {/* Navigation Tabs */}
          <div className="flex rounded-xl bg-slate-100 p-1">
            <button
              id="tab-ubah-tanam"
              type="button"
              onClick={() => { setManageTab("tanam"); setManageError(null); }}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                manageTab === "tanam" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Ubah Tanggal Tanam
            </button>
            <button
              id="tab-ubah-polinasi"
              type="button"
              onClick={() => { setManageTab("polinasi"); setManageError(null); }}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                manageTab === "polinasi" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Ubah Tanggal Polinasi
            </button>
            {cycle?.tanggalPolinasi && (
              <button
                id="tab-hapus-polinasi"
                type="button"
                onClick={() => { setManageTab("hapus_polinasi"); setManageError(null); }}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                  manageTab === "hapus_polinasi" ? "bg-white text-red-600 shadow-sm" : "text-slate-500 hover:text-red-500"
                }`}
              >
                Hapus Polinasi
              </button>
            )}
          </div>

          {manageError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
              {manageError}
            </div>
          )}

          {/* TAB 1: Ubah Tanggal Tanam */}
          {manageTab === "tanam" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div>
                  <div className="text-[11px] text-slate-500">Tanggal lama:</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-800">
                    {formatIndoDate(cycle?.tanggalTanam)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Tanggal baru:</div>
                  <Input
                    id="input-edit-tanam"
                    type="date"
                    max={todayStr}
                    value={editTanamDate}
                    onChange={(e) => setEditTanamDate(e.target.value)}
                    className="mt-1 h-8 text-xs font-medium"
                  />
                </div>
              </div>

              {/* Preview Dampak */}
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5">
                <div className="text-xs font-bold text-amber-900">Preview Dampak:</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xs text-amber-800">HST sekarang:</span>
                  <span className="font-mono text-sm font-bold text-amber-950">
                    {currentHst} → {previewNewHst} hari
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-amber-800/90">
                  Mengubah tanggal tanam akan mengubah perhitungan HST siklus ini di ESP32.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button variant="ghost" onClick={onCloseManage} disabled={savingManage}>
                  Batal
                </Button>
                <Button
                  id="btn-confirm-update-tanam"
                  onClick={handleUpdateTanam}
                  disabled={savingManage || editTanamDate === cycle?.tanggalTanam}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {savingManage ? "Menyimpan ke ESP32..." : "Simpan Perubahan"}
                </Button>
              </div>
            </div>
          )}

          {/* TAB 2: Ubah Tanggal Polinasi */}
          {manageTab === "polinasi" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div>
                  <div className="text-[11px] text-slate-500">Tanggal lama:</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-800">
                    {cycle?.tanggalPolinasi ? formatIndoDate(cycle.tanggalPolinasi) : "Belum dicatat"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Tanggal baru:</div>
                  <Input
                    id="input-edit-polinasi"
                    type="date"
                    min={cycle?.tanggalTanam || undefined}
                    max={todayStr}
                    value={editPolinasiDate}
                    onChange={(e) => setEditPolinasiDate(e.target.value)}
                    className="mt-1 h-8 text-xs font-medium"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-3.5">
                <div className="text-xs font-bold text-violet-900">Preview Dampak:</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xs text-violet-800">HSP sekarang:</span>
                  <span className="font-mono text-sm font-bold text-violet-950">
                    {currentHsp !== null ? `${currentHsp} → ` : "Belum ada → "} {previewNewHsp} hari
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button variant="ghost" onClick={onCloseManage} disabled={savingManage}>
                  Batal
                </Button>
                <Button
                  id="btn-confirm-update-polinasi"
                  onClick={handleUpdatePolinasi}
                  disabled={savingManage || editPolinasiDate === cycle?.tanggalPolinasi}
                  className="bg-violet-600 text-white hover:bg-violet-700"
                >
                  {savingManage ? "Menyimpan ke ESP32..." : "Simpan Perubahan"}
                </Button>
              </div>
            </div>
          )}

          {/* TAB 3: Hapus Tanggal Polinasi */}
          {manageTab === "hapus_polinasi" && cycle?.tanggalPolinasi && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
                <div className="flex items-start gap-2.5 text-red-800">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <div>
                    <div className="font-bold">Hapus Tanggal Polinasi?</div>
                    <p className="mt-1 text-xs leading-relaxed text-red-700">
                      HSP akan kembali menjadi belum tersedia. Riwayat dan event operasional yang sudah tercatat tidak dihapus.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button variant="ghost" onClick={onCloseManage} disabled={savingManage}>
                  Batal
                </Button>
                <Button
                  id="btn-confirm-delete-polinasi"
                  variant="danger"
                  onClick={handleDeletePolinasi}
                  disabled={savingManage}
                >
                  {savingManage ? "Menghapus..." : "Hapus Tanggal Polinasi"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 5. Modal Konfirmasi Hari Panen */}
      <Modal
        open={harvestOpen}
        onClose={onCloseHarvest}
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Wheat className="h-5 w-5" />
            </span>
            <div>
              <div className="text-base font-bold text-slate-900">Selesaikan Siklus Ini (Hari Panen)</div>
              <div className="text-xs font-normal text-slate-500">{gh.code} • {gh.crop}</div>
            </div>
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <Button variant="ghost" onClick={onCloseHarvest} disabled={submittingHarvest}>
              Batal
            </Button>
            <Button
              id="btn-confirm-harvest"
              onClick={handleHarvestSubmit}
              disabled={submittingHarvest}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {submittingHarvest ? "Menyelesaikan Siklus..." : "Ya, Tandai Hari Panen"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pt-1">
          {/* Ringkasan Siklus */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Ringkasan Siklus Aktif</div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-500">Tanggal Tanam:</span>
                <div className="mt-0.5 font-bold text-slate-900">{formatIndoDate(cycle?.tanggalTanam)}</div>
              </div>
              <div>
                <span className="text-slate-500">Tanggal Polinasi:</span>
                <div className="mt-0.5 font-bold text-slate-900">
                  {cycle?.tanggalPolinasi ? formatIndoDate(cycle.tanggalPolinasi) : "Belum dicatat"}
                </div>
              </div>
              <div>
                <span className="text-slate-500">HST saat panen:</span>
                <div className="mt-0.5 text-base font-bold text-emerald-600">{gh.telemetry.hstDays} hari</div>
              </div>
              <div>
                <span className="text-slate-500">HSP saat panen:</span>
                <div className="mt-0.5 text-base font-bold text-violet-600">
                  {gh.telemetry.hspDays !== null ? `${gh.telemetry.hspDays} hari` : "–"}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs leading-relaxed text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Siklus aktif akan diakhiri. Data tanggal aktif akan dibersihkan dari runtime greenhouse di ESP32, tetapi riwayat panen dan log tidak dihapus.
              </span>
            </div>
          </div>

          {harvestError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
              {harvestError}
            </div>
          )}
        </div>
      </Modal>

      {/* 6. Modal / Drawer Riwayat Siklus & Panen */}
      <Modal
        open={historyOpen}
        onClose={onCloseHistory}
        width={540}
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <History className="h-5 w-5" />
            </span>
            <div>
              <div className="text-base font-bold text-slate-900">Riwayat Masa Tanam & Panen</div>
              <div className="text-xs font-normal text-slate-500">{gh.code} • Log siklus greenhouse</div>
            </div>
          </div>
        }
        footer={
          <Button variant="outline" onClick={onCloseHistory}>
            Tutup
          </Button>
        }
      >
        <div className="space-y-4 pt-1">
          {/* Last Harvest Record */}
          {cycle?.lastHarvestSummary ? (
            <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/60 to-orange-50/40 p-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900">
                  <Wheat className="h-4 w-4 text-amber-600" /> Panen Terakhir
                </span>
                <span className="text-[11px] font-medium text-amber-700">
                  {formatIndoDate(cycle.lastHarvestSummary.harvestDate)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500">Tanggal Tanam:</span>
                  <div className="font-semibold text-slate-800">
                    {formatIndoDate(cycle.lastHarvestSummary.tanggalTanam)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Tanggal Polinasi:</span>
                  <div className="font-semibold text-slate-800">
                    {formatIndoDate(cycle.lastHarvestSummary.tanggalPolinasi)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Total HST:</span>
                  <div className="font-bold text-emerald-700">{cycle.lastHarvestSummary.hstAtHarvest} hari</div>
                </div>
                <div>
                  <span className="text-slate-500">Total HSP:</span>
                  <div className="font-bold text-violet-700">
                    {cycle.lastHarvestSummary.hspAtHarvest !== null ? `${cycle.lastHarvestSummary.hspAtHarvest} hari` : "–"}
                  </div>
                </div>
              </div>
              <div className="mt-2.5 border-t border-amber-200/60 pt-2 text-[10px] text-amber-800/80">
                Dicatat pada: {cycle.lastHarvestSummary.recordedAt}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-400">
              Belum ada riwayat panen sebelumnya untuk greenhouse ini.
            </div>
          )}

          {/* Greenhouse Fertigation History Snippet */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-800">Log Operasional Greenhouse</div>
            {gh.history.length > 0 ? (
              <div className="space-y-1.5">
                {gh.history.slice(0, 5).map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-2.5 text-xs">
                    <div>
                      <span className="font-semibold text-slate-800">{row.recipeName}</span>
                      <span className="ml-2 text-slate-400">{row.date} • {row.time}</span>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {row.result}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400">Belum ada log operasional.</div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
