"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "./primitives";

/* ------------------------------ Drawer --------------------------- */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  width = 540,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* dimmed background — page content stays visible */}
      <div
        className={`absolute inset-0 bg-slate-900/45 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        style={{ width: width !== undefined ? width : undefined, maxWidth: "100vw" }}
        className={`absolute inset-y-0 right-0 flex max-w-full flex-col bg-white shadow-2xl transition-transform duration-250 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-start gap-3 border-b border-slate-100 px-6 py-4">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">{footer}</footer>}
      </aside>
    </div>
  );
}

/* ------------------------------ Modal ---------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-slate-900/45 fade-in" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          style={{ width }}
          className="max-w-full rounded-2xl bg-white shadow-2xl fade-in"
          role="dialog"
          aria-modal="true"
        >
          <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </header>
          <div className="px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2.5 border-t border-slate-100 px-5 py-3.5">{footer}</footer>}
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
    </Modal>
  );
}
