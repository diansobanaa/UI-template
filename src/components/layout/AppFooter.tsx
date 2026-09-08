"use client";

import { Activity, Circle, HardDriveDownload, Wifi } from "lucide-react";
import { MOCK_NOW } from "@/lib/format";
import type { Complex } from "@/lib/types";
import { useDbVersion } from "@/lib/useDb";
import { greenhouseService } from "@/lib/services";
import { complexRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";

/** Status strip pinned at the bottom of the content area. */
export function AppFooter({ complex }: { complex: Complex }) {
  useDbVersion();
  const realtimeState = complexRealtimeState(complex, greenhouseService.byComplex(complex.id));
  return (
    <footer className="sticky bottom-0 z-30 flex h-11 shrink-0 items-center gap-5 border-t border-[--color-line] bg-white px-6 text-xs text-slate-500">
      <span className="flex items-center gap-1.5">
        <Wifi className="h-3.5 w-3.5 text-slate-400" />
        ESP32: <span className={complex.esp32.online ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>
          {complex.esp32.online ? "Online" : "Offline"}
        </span>
      </span>
      <LiveStatus state={realtimeState} label={`${complex.code} realtime connection`} />
      <span className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-blue-500" />
        Data: <span className="font-semibold text-blue-600">Live simulation</span>
      </span>
      <span className="flex items-center gap-1.5">
        <HardDriveDownload className="h-3.5 w-3.5 text-slate-400" />
        Last Sync: <span className="font-semibold text-slate-600">{complex.esp32.lastSync}</span>
      </span>
      <span className="ml-auto flex items-center gap-2 text-slate-400">
        <span className="flex items-center gap-1.5"><Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" /> Fresh now</span>
        <span className="h-3 w-px bg-slate-200" />
        <span>{MOCK_NOW.time}</span>
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
