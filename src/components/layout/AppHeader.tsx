"use client";

import { useState } from "react";
import { AlertTriangle, Bell, ChevronDown, Menu, Search, UserRound } from "lucide-react";
import { complexService, eventService, greenhouseService } from "@/lib/services";
import { useDbVersion } from "@/lib/useDb";
import { complexRealtimeState } from "@/lib/realtime";
import { LiveStatus } from "@/components/ui/LiveStatus";

export function AppHeader({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  useDbVersion();
  const alerts = eventService.alerts();
  const complexes = complexService.list();
  const problemComplexes = complexes.filter(
    (complex) => complexRealtimeState(complex, greenhouseService.byComplex(complex.id)) !== "live",
  );
  const hasSystemAlert = alerts.length > 0 || problemComplexes.length > 0;
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-[64px] items-center gap-3 border-b border-white/[0.07] bg-[#07131b]/95 px-5 backdrop-blur-xl">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Open navigation menu"
        aria-controls="app-sidebar"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08] hover:text-white md:hidden"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>

      <div className="relative min-w-0 flex-1 max-w-[330px] md:w-[330px] md:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          placeholder="Search… (greenhouse, schedule, recipe)"
          className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-16 text-[13px] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400/40 focus:bg-white/[0.055] focus:ring-2 focus:ring-emerald-400/10"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-slate-500">
          Ctrl K
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        <LiveStatus
          state={hasSystemAlert ? "problem" : "live"}
          label={hasSystemAlert ? `${problemComplexes.length} complex or greenhouse alerts` : "System realtime connection"}
        />

        <div className="relative">
          <button
            onClick={() => setNotifOpen((value) => !value)}
            aria-label="Notifications"
            className={`relative flex h-10 w-10 items-center justify-center rounded-xl border transition ${
              hasSystemAlert
                ? "border-red-400/20 bg-red-400/10 text-red-300 hover:bg-red-400/15"
                : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.07]"
            }`}
          >
            {hasSystemAlert ? <AlertTriangle className="h-[17px] w-[17px]" /> : <Bell className="h-[17px] w-[17px]" />}
            {hasSystemAlert && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg">
                {alerts.length + problemComplexes.length}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-12 z-50 w-80 rounded-2xl border border-white/10 bg-[#0b1921] p-2 shadow-2xl shadow-black/40">
              {problemComplexes.map((complex) => (
                <div key={complex.id} className="flex gap-2.5 rounded-xl bg-red-400/[0.07] px-2.5 py-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-red-200">{complex.code} requires attention</div>
                    <div className="mt-0.5 text-xs leading-snug text-red-300/70">ESP32, GH, or hardware realtime state has a problem.</div>
                  </div>
                </div>
              ))}
              {alerts.map((alert) => (
                <div key={alert.id} className="flex gap-2.5 rounded-xl px-2.5 py-2.5 hover:bg-white/[0.04]">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${alert.level === "error" ? "bg-red-400" : "bg-amber-400"}`} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-100">{alert.title}</div>
                    <div className="mt-0.5 text-xs leading-snug text-slate-400">{alert.detail}</div>
                    <div className="mt-1 text-[11px] text-slate-600">{alert.time} • today</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-[13px] font-medium text-slate-200 transition hover:bg-white/[0.07]">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-400/10 text-blue-300">
            <UserRound className="h-3.5 w-3.5" />
          </span>
          Admin
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        </button>
      </div>
    </header>
  );
}
