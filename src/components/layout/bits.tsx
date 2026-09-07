"use client";

import { Building2, ChevronDown, ChevronLeft, ChevronRight, Cpu, Leaf, MonitorCog, Activity } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { MOCK_NOW } from "@/lib/format";
import type { Complex, Greenhouse } from "@/lib/types";
import { Select } from "@/components/ui/primitives";

/* ------------------------- Date / time block ---------------------- */

export function DateTimeBlock({ caption = "Local Time (ESP32)" }: { caption?: string }) {
  return (
    <div className="text-right">
      <div className="text-xs text-slate-400">{caption}</div>
      <div className="text-[22px] font-bold leading-tight text-slate-900">{MOCK_NOW.time}</div>
      <div className="text-xs text-slate-500">{MOCK_NOW.label}</div>
    </div>
  );
}

export function BigDateClock() {
  return (
    <div className="text-right">
      <div className="text-xs text-slate-500">{MOCK_NOW.label}</div>
      <div className="text-[26px] font-bold leading-tight text-slate-900">{MOCK_NOW.time}</div>
    </div>
  );
}

/* --------------------------- Status pills ------------------------- */

export function Esp32StatusPill({ esp32 }: { esp32: Complex["esp32"] }) {
  const online = esp32.online;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500 pulse-dot" : "bg-red-500"}`} />
      <div>
        <div className={`text-xs font-bold ${online ? "text-emerald-600" : "text-red-600"}`}>
          ESP32 {online ? "ONLINE" : "OFFLINE"}
        </div>
        <div className="text-[11px] text-slate-400">Last Sync: {esp32.lastSync}</div>
      </div>
    </div>
  );
}

export function ConfigVersionPill({ version }: { version: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <MonitorCog className="h-5 w-5 text-slate-500" />
      <div>
        <div className="text-[11px] text-slate-400">Configuration</div>
        <div className="text-sm font-bold leading-tight text-slate-900">v{version}</div>
      </div>
    </div>
  );
}

export function SystemStatusPill({ status }: { status: Complex["systemStatus"] }) {
  const tone =
    status === "NORMAL" ? "text-emerald-600" : status === "WARNING" ? "text-amber-600" : "text-red-600";
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <Activity className={`h-5 w-5 ${tone}`} />
      <div>
        <div className="text-[11px] text-slate-400">System Status</div>
        <div className={`text-sm font-bold leading-tight ${tone}`}>{status}</div>
      </div>
    </div>
  );
}

/* ----------------------------- Switchers -------------------------- */

function useSetParam() {
  const router = useRouter();
  const params = useSearchParams();
  return useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(key, value);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router]
  );
}

export function ComplexSwitcher({ complexId, complexes }: { complexId: string; complexes: Complex[] }) {
  const setParam = useSetParam();
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-400">Complex</div>
      <div className="relative">
        <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <select
          value={complexId}
          onChange={(e) => setParam("complex", e.target.value)}
          className="h-10 w-44 cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-[13px] font-medium text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.05)] outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
        >
          {complexes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );
}

export function GreenhouseSwitcher({
  complexId,
  greenhouses,
  ghId,
  withArrows = true,
  onChange,
  label = "Greenhouse",
  widthClass = "w-44",
}: {
  complexId: string;
  greenhouses: Greenhouse[];
  ghId: string;
  withArrows?: boolean;
  onChange?: (ghId: string) => void;
  label?: string;
  widthClass?: string;
}) {
  const setParam = useSetParam();
  const idx = Math.max(0, greenhouses.findIndex((g) => g.id === ghId));
  const prev = greenhouses[(idx - 1 + greenhouses.length) % greenhouses.length];
  const next = greenhouses[(idx + 1) % greenhouses.length];
  const select = (id: string) => {
    if (onChange) onChange(id);
    else setParam("gh", id);
  };

  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-400">{label}</div>
      <div className="flex items-center gap-1.5">
        {withArrows && (
          <button
            aria-label="Previous greenhouse"
            onClick={() => select(prev.id)}
            className="flex h-10 w-8 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div className="relative">
          <Leaf className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <select
            value={ghId}
            onChange={(e) => select(e.target.value)}
            className={`h-10 ${widthClass} cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-[13px] font-medium text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.05)] outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15`}
          >
            {greenhouses.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} – {g.crop}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        {withArrows && (
          <button
            aria-label="Next greenhouse"
            onClick={() => select(next.id)}
            className="flex h-10 w-8 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function SimpleLabeledSelect({
  label,
  value,
  onChange,
  options,
  icon: Icon,
  widthClass = "w-44",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ComponentType<{ className?: string }>;
  widthClass?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-slate-400">{label}</div>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-10 ${widthClass} cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white ${Icon ? "pl-9" : "pl-3"} pr-8 text-[13px] font-medium text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.05)] outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );
}

export { Select };
