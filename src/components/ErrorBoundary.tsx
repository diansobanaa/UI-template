"use client";

import React from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Menangkap crash render React agar halaman tidak menjadi putih kosong.
 * Menampilkan pesan error yang jelas + tombol muat ulang.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Render crash:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0f1a] p-8 text-center">
          <div className="max-w-lg rounded-2xl border border-rose-800/60 bg-[#141c2e] p-8">
            <h2 className="text-lg font-semibold text-rose-300">Halaman gagal dimuat</h2>
            <p className="mt-2 text-sm text-slate-400">
              Terjadi kesalahan saat menampilkan halaman ini. Coba muat ulang — bila terus
              berlanjut, catat pesan di bawah ini.
            </p>
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 text-left text-xs text-rose-200">
              {err.message}
              {err.stack ? "\n" + err.stack.split("\n").slice(0, 5).join("\n") : ""}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Muat ulang halaman
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
