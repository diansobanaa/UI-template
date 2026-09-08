import { Activity, AlertTriangle, WifiOff } from "lucide-react";
import type { RealtimeState } from "@/lib/realtime";
import { realtimeLabel } from "@/lib/realtime";

export function LiveStatus({ state = "live", label = "Realtime", compact = false }: { state?: RealtimeState; label?: string; compact?: boolean }) {
  const isLive = state === "live";
  const isProblem = state === "problem";
  const Icon = isLive ? Activity : isProblem ? AlertTriangle : WifiOff;
  const tone = isLive ? "text-emerald-600" : isProblem ? "text-red-600" : "text-red-500";
  const dot = isLive ? "bg-emerald-500" : "bg-red-500";
  const tooltip = `${label}: ${realtimeLabel(state)}`;

  return (
    <span className={`group relative inline-flex items-center gap-1.5 ${tone}`} title={tooltip} aria-label={tooltip}>
      <span className="relative flex h-4 w-4 items-center justify-center">
        <span className={`absolute h-2 w-2 rounded-full ${dot} ${isLive ? "pulse-dot" : ""}`} />
        <Icon className={`relative h-3.5 w-3.5 ${isLive ? "opacity-0" : ""}`} />
      </span>
      {!compact && <span className="text-[10px] font-bold uppercase tracking-[0.08em]">{isLive ? "Live" : isProblem ? "Problem" : "Offline"}</span>}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-2 text-left text-[11px] font-medium normal-case tracking-normal text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {tooltip}
      </span>
    </span>
  );
}
