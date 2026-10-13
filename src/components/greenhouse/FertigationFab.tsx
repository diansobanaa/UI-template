"use client";

import React, { useState } from "react";
import { Droplets, X } from "lucide-react";

export function FertigationFab({
  onManualTrigger,
}: {
  onManualTrigger: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 cursor-pointer items-center gap-2 rounded-full bg-emerald-500 px-5 font-semibold text-white shadow-[0_8px_24px_rgba(16,185,129,0.4)] transition hover:bg-emerald-600 active:scale-95"
        aria-label="Siram sekarang"
      >
        <Droplets className="h-5 w-5" />
        <span className="hidden sm:inline">Siram Sekarang</span>
      </button>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b2027] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h3 className="font-bold text-white">Siram Sekarang?</h3>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Tutup"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Memicu fertigasi manual untuk greenhouse ini. Pastikan tangki berisi
              dan jalur distribusi siap.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 cursor-pointer rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  onManualTrigger();
                }}
                className="flex-1 cursor-pointer rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
              >
                Ya, Siram
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
