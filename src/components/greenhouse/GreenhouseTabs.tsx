"use client";

import React from "react";
import { Droplets, Thermometer, Sprout, Wrench } from "lucide-react";

export type GreenhouseTabId = "fertigasi" | "lingkungan" | "tanaman" | "peralatan";

const TABS: { id: GreenhouseTabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "fertigasi", label: "Fertigasi", icon: Droplets },
  { id: "lingkungan", label: "Lingkungan", icon: Thermometer },
  { id: "tanaman", label: "Tanaman", icon: Sprout },
  { id: "peralatan", label: "Peralatan", icon: Wrench },
];

export function GreenhouseTabs({
  active,
  onChange,
  alertCount,
}: {
  active: GreenhouseTabId;
  onChange: (tab: GreenhouseTabId) => void;
  alertCount?: number;
}) {
  return (
    <div className="sticky top-0 z-30 -mx-1 border-b border-white/10 bg-[#0b2027]/95 px-1 py-2 backdrop-blur">
      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Bagian greenhouse">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`relative flex shrink-0 cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                isActive
                  ? "bg-emerald-500/20 text-emerald-200 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4)]"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {tab.id === "fertigasi" && alertCount != null && alertCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                  {alertCount}
                </span>
              )}
              {isActive && (
                <span className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
