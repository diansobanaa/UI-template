"use client";

import { useState } from "react";
import { AlertTriangle, Bell, ChevronDown, Search, UserRound } from "lucide-react";
import { complexService, eventService, greenhouseService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { complexRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";

export function AppHeader() {
  useDbVersion();
  const alerts = eventService.alerts();
  const complexes = complexService.list();
  const problemComplexes = complexes.filter((complex) => complexRealtimeState(complex, greenhouseService.byComplex(complex.id)) !== "live");
  const hasSystemAlert = alerts.length > 0 || problemComplexes.length > 0;
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-[62px] items-center gap-3 border-b border-[--color-line] bg-white px-5">
      <div className="relative w-80 max-w-[32vw]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search… (greenhouse, schedule, recipe)"
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-[13px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-2">
          <LiveStatus state={hasSystemAlert ? "problem" : "live"} label={hasSystemAlert ? `${problemComplexes.length} complex or greenhouse alerts` : "System realtime connection"} />
        <div className="relative">
          <button
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Notifications"
            className={`relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border transition hover:bg-slate-50 ${hasSystemAlert ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 bg-white text-slate-500"}`}
          >
            {hasSystemAlert ? <AlertTriangle className="h-[17px] w-[17px]" /> : <Bell className="h-[17px] w-[17px]" />}
            {hasSystemAlert && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {alerts.length + problemComplexes.length}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl fade-in">
              {problemComplexes.map((complex) => (
                <div key={complex.id} className="flex gap-2.5 rounded-lg bg-red-50 px-2.5 py-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <div className="min-w-0"><div className="text-[13px] font-semibold text-red-700">{complex.code} requires attention</div><div className="mt-0.5 text-xs leading-snug text-red-600">ESP32, GH, or hardware realtime state has a problem.</div></div>
                </div>
              ))}
              {alerts.map((a) => (
                <div key={a.id} className="flex gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-50">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.level === "error" ? "bg-red-500" : "bg-amber-500"}`}
                  />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800">{a.title}</div>
                    <div className="mt-0.5 text-xs leading-snug text-slate-500">{a.detail}</div>
                    <div className="mt-1 text-[11px] text-slate-400">{a.time} • today</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>

        <button className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <UserRound className="h-3.5 w-3.5" />
          </span>
          Admin
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>
    </header>
  );
}
