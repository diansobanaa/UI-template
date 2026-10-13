"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { clearReadyMarker } from "@/lib/api/fertigation-clear";

export interface ClearReadyButtonProps {
  /** ID occurrence READY yang akan di-clear. Salah satu dari occurrenceId / batchId wajib ada. */
  occurrenceId?: string;
  /** ID batch READY yang akan di-clear. Salah satu dari occurrenceId / batchId wajib ada. */
  batchId?: string;
  /** Label greenhouse untuk pesan feedback, mis. "GH-01". */
  ghLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Dipanggil setelah clear sukses — parent memakai ini untuk fetch ulang / reconcile tampilan. */
  onCleared?: () => void | Promise<void>;
  /** Notifikasi ala toast milik parent. Bila tidak diisi, pesan tampil inline di bawah tombol. */
  notify?: (type: "success" | "error", message: string) => void;
}

/**
 * Tombol aksi eksplisit "Clear" untuk item/batch berstatus READY_TO_FERTIGATE.
 * Clear HANYA terjadi saat user menekan tombol ini — tidak ada pemicu otomatis.
 * Setelah sukses, parent me-refresh/reconcile via `onCleared`.
 */
export function ClearReadyButton({
  occurrenceId,
  batchId,
  ghLabel,
  disabled = false,
  className = "",
  onCleared,
  notify,
}: ClearReadyButtonProps) {
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const canClear = Boolean(occurrenceId || batchId);
  const targetLabel = ghLabel ? ` ${ghLabel}` : "";

  const handleClick = async () => {
    if (busy || !canClear) return;
    setBusy(true);
    setLocalMsg(null);
    try {
      const res = await clearReadyMarker({ occurrenceId, batchId });
      if (res && res.ok === false) {
        throw new Error(res.message || "Controller menolak permintaan clear.");
      }
      const okMsg = `Penanda READY${targetLabel} berhasil dihapus secara manual.`;
      if (notify) notify("success", okMsg);
      else setLocalMsg({ type: "success", message: "Penanda READY dihapus." });
      await onCleared?.();
    } catch (err: any) {
      const errMsg = `Gagal menghapus penanda READY${targetLabel}: ${err?.message || "Kesalahan kontroler"}`;
      if (notify) notify("error", errMsg);
      else setLocalMsg({ type: "error", message: errMsg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`inline-flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy || !canClear}
        title={
          canClear
            ? "Hapus penanda READY secara manual — hanya untuk item/batch ini"
            : "Belum ada ID occurrence/batch yang bisa di-clear"
        }
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 active:scale-95 disabled:opacity-50"
      >
        <XCircle className="h-3.5 w-3.5" />
        {busy ? "Menghapus…" : "Clear"}
      </button>
      {localMsg && !notify && (
        <span
          className={`text-[10px] font-medium ${
            localMsg.type === "success" ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {localMsg.message}
        </span>
      )}
    </span>
  );
}
