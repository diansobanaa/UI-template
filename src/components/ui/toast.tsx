"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, Info, AlertTriangle, XCircle } from "lucide-react";

type ToastKind = "success" | "info" | "warning" | "error";
interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let toastSeq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "success") => {
    toastSeq += 1;
    const id = toastSeq;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  const icons: Record<ToastKind, React.ReactNode> = {
    success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    info: <Info className="h-4 w-4 text-blue-500" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    error: <XCircle className="h-4 w-4 text-red-500" />,
  };

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-700 shadow-lg"
          >
            <span className="mt-0.5">{icons[t.kind]}</span>
            <span className="leading-snug">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
