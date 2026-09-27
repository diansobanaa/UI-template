"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2, Wrench } from "lucide-react";
import { Modal } from "@/components/ui/overlay";
import { Button, Input, Label } from "@/components/ui/primitives";

export type MaintenancePoint = {
  id: string;
  name: string;
  hst: string;
  category: string;
  note: string;
};

interface MaintenanceScheduleModalProps {
  open: boolean;
  targetHarvestHst: number;
  value: MaintenancePoint[];
  onClose: () => void;
  onSave: (points: MaintenancePoint[]) => void;
}

const CATEGORY_OPTIONS = [
  "Penyiraman",
  "Pemupukan",
  "Pemangkasan",
  "Pengendalian Hama",
  "Inspeksi",
  "Lainnya",
];

const createMaintenancePoint = (): MaintenancePoint => ({
  id: `maintenance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: "",
  hst: "",
  category: "Lainnya",
  note: "",
});

export function MaintenanceScheduleModal({
  open,
  targetHarvestHst,
  value,
  onClose,
  onSave,
}: MaintenanceScheduleModalProps) {
  const [points, setPoints] = useState<MaintenancePoint[]>(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setPoints(
      value.map((item) => ({
        ...item,
      })),
    );
    setError(null);
  }, [open, value]);

  const sortedPoints = useMemo(
    () =>
      [...points].sort(
        (a, b) =>
          (Number(a.hst) || Number.MAX_SAFE_INTEGER) -
          (Number(b.hst) || Number.MAX_SAFE_INTEGER),
      ),
    [points],
  );

  const updatePoint = (
    id: string,
    patch: Partial<MaintenancePoint>,
  ) => {
    setPoints((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    );
  };

  const addPoint = () => {
    setPoints((current) => [...current, createMaintenancePoint()]);
    setError(null);
  };

  const removePoint = (id: string) => {
    setPoints((current) =>
      current.filter((item) => item.id !== id),
    );
  };

  const handleSave = () => {
    const cleaned = sortedPoints.map((item) => ({
      ...item,
      name: item.name.trim(),
      hst: item.hst.trim(),
      category: item.category.trim() || "Lainnya",
      note: item.note.trim(),
    }));

    for (const item of cleaned) {
      if (!item.name) {
        setError("Nama jadwal perawatan wajib diisi.");
        return;
      }

      if (item.hst === "") {
        setError(`HST untuk "${item.name}" wajib diisi.`);
        return;
      }

      const hst = Number(item.hst);

      if (!Number.isFinite(hst)) {
        setError(`HST untuk "${item.name}" tidak valid.`);
        return;
      }

      if (hst < 0 || hst > targetHarvestHst) {
        setError(
          `"${item.name}" harus berada antara HST 0 dan HST ${targetHarvestHst}.`,
        );
        return;
      }
    }

    onSave(cleaned);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Wrench className="h-5 w-5" />
          </span>

          <div>
            <div className="text-base font-bold text-slate-900">
              Rencana Jadwal Perawatan
            </div>
            <div className="text-xs font-normal text-slate-500">
              Atur tindakan perawatan berdasarkan HST
            </div>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
          >
            Batal
          </Button>

          <Button
            onClick={handleSave}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            Simpan Jadwal Perawatan
          </Button>
        </div>
      }
    >
      <div className="max-h-[65dvh] space-y-4 overflow-y-auto pr-1">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />

            <div>
              <div className="text-sm font-bold text-amber-950">
                Rencana sampai HST {targetHarvestHst}
              </div>

              <div className="mt-1 text-xs leading-5 text-amber-800">
                Setiap jadwal akan menjadi titik perawatan di
                Timeline Masa Tanam dashboard.
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900">
              Jadwal Perawatan
            </div>

            <div className="text-xs text-slate-500">
              Tambahkan tindakan yang perlu dilakukan selama siklus.
            </div>
          </div>

          <Button
            variant="secondary"
            onClick={addPoint}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Tambah Jadwal
          </Button>
        </div>

        {sortedPoints.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/50 p-8 text-center">
            <Wrench className="mx-auto h-7 w-7 text-amber-500" />

            <div className="mt-3 text-sm font-semibold text-slate-800">
              Belum ada jadwal perawatan
            </div>

            <div className="mt-1 text-xs leading-5 text-slate-500">
              Contoh: Pemupukan HST 20, Pemangkasan HST 35,
              atau Inspeksi HST 60.
            </div>

            <Button
              variant="secondary"
              className="mt-4"
              onClick={addPoint}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Tambah Jadwal
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedPoints.map((item, index) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-xs font-bold text-amber-700">
                      {index + 1}
                    </span>

                    <span className="text-sm font-bold text-slate-900">
                      Jadwal Perawatan
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => removePoint(item.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    aria-label="Hapus jadwal"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1.5fr_100px_1fr]">
                  <div>
                    <Label htmlFor={`maintenance-name-${item.id}`}>
                      Tindakan
                    </Label>

                    <Input
                      id={`maintenance-name-${item.id}`}
                      value={item.name}
                      onChange={(event) =>
                        updatePoint(item.id, {
                          name: event.target.value,
                        })
                      }
                      placeholder="Contoh: Pemupukan NPK"
                      className="mt-1.5"
                    />
                  </div>

                  <div>
                    <Label htmlFor={`maintenance-hst-${item.id}`}>
                      HST
                    </Label>

                    <Input
                      id={`maintenance-hst-${item.id}`}
                      type="number"
                      min={0}
                      max={targetHarvestHst}
                      value={item.hst}
                      onChange={(event) =>
                        updatePoint(item.id, {
                          hst: event.target.value,
                        })
                      }
                      placeholder="20"
                      className="mt-1.5"
                    />
                  </div>

                  <div>
                    <Label htmlFor={`maintenance-category-${item.id}`}>
                      Kategori
                    </Label>

                    <select
                      id={`maintenance-category-${item.id}`}
                      value={item.category}
                      onChange={(event) =>
                        updatePoint(item.id, {
                          category: event.target.value,
                        })
                      }
                      className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                    >
                      {CATEGORY_OPTIONS.map((category) => (
                        <option
                          key={category}
                          value={category}
                        >
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3">
                  <Label htmlFor={`maintenance-note-${item.id}`}>
                    Instruksi / Catatan
                  </Label>

                  <Input
                    id={`maintenance-note-${item.id}`}
                    value={item.note}
                    onChange={(event) =>
                      updatePoint(item.id, {
                        note: event.target.value,
                      })
                    }
                    placeholder="Contoh: 10 ml/tanaman"
                    className="mt-1.5"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}