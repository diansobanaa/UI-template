"use client";

import { Circle, HardDriveDownload, Wifi } from "lucide-react";
import { MOCK_NOW } from "@/lib/format";
import type { Complex } from "@/lib/types";

/** Status strip pinned at the bottom of the content area. */
export function AppFooter({ complex }: { complex: Complex }) {
  return (
    <footer className="sticky bottom-0 z-30 flex h-11 shrink-0 items-center gap-5 border-t border-[--color-line] bg-white px-6 text-xs text-slate-500">
      <span className="flex items-center gap-1.5">
        <Wifi className="h-3.5 w-3.5 text-slate-400" />
        ESP32: <span className={complex.esp32.online ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>
          {complex.esp32.online ? "Online" : "Offline"}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <Circle className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500" />
        Backend: <span className="font-semibold text-slate-600">Mock</span>
      </span>
      <span className="flex items-center gap-1.5">
        <HardDriveDownload className="h-3.5 w-3.5 text-slate-400" />
        Last Sync: <span className="font-semibold text-slate-600">{complex.esp32.lastSync}</span>
      </span>
      <span className="ml-auto flex items-center gap-2 text-slate-400">
        <span>UI Prototype</span>
        <span className="h-3 w-px bg-slate-200" />
        <span>v0.1</span>
        <span className="h-3 w-px bg-slate-200" />
        <span>© 2026 AgroTech</span>
      </span>
    </footer>
  );
}

/** Small dark strip some reference pages show above the footer. */
export function TimeBar() {
  return (
    <div className="flex h-9 shrink-0 items-center justify-end gap-2 rounded-lg bg-slate-900 px-4 text-xs text-slate-300">
      <span className="font-medium">{MOCK_NOW.time}</span>
      <span className="text-slate-500">{MOCK_NOW.label}</span>
    </div>
  );
}
