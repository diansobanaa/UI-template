"use client";

import React, { useState } from "react";
import { RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { sensorService } from "@/lib/services";
import { useToast } from "@/components/ui/toast";
import type { SensorRetryInfo } from "@/lib/types";

export interface SensorRetryBadgeProps {
  sensorId: string;
  sensorLabel?: string;
  retryInfo?: SensorRetryInfo | null;
  hasValue?: boolean;
  isStale?: boolean;
  complexId?: string;
  ghId?: string;
  onRetryTriggered?: () => void;
  compact?: boolean;
  className?: string;
}

export function SensorRetryBadge({
  sensorId,
  sensorLabel,
  retryInfo,
  hasValue = true,
  isStale = false,
  complexId,
  ghId,
  onRetryTriggered,
  compact = false,
  className = "",
}: SensorRetryBadgeProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  // Resolved state mapping
  let state = retryInfo?.state ?? (hasValue ? "ONLINE" : "UNAVAILABLE");
  if (isStale && state === "ONLINE") {
    state = "STALE";
  }

  const retryCount = retryInfo?.retryCount ?? 0;
  const maxRetries = retryInfo?.maxRetries ?? 10;

  const handleRetry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading || state === "RETRYING") return;

    setLoading(true);
    try {
      await sensorService.retry(sensorId, complexId, ghId);
      toast(`Manual retry initiated for ${sensorLabel || sensorId}`, "info");
      onRetryTriggered?.();
    } catch (err: any) {
      const msg = err?.message || (typeof err === "string" ? err : "Failed to trigger retry");
      toast(`Retry failed: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // 1. ONLINE
  if (state === "ONLINE" && hasValue && !isStale) {
    if (compact) {
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 ${className}`}
          title="Sensor operational and reporting valid data"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span>Online</span>
        </span>
      );
    }
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ${className}`}>
        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
        <span>Online</span>
      </div>
    );
  }

  // 2. RETRYING
  if (state === "RETRYING") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 animate-pulse ${className}`}
        title={`Automatic retry in progress (${retryCount}/${maxRetries})`}
      >
        <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
        <span>
          Retry {retryCount}/{maxRetries}
        </span>
      </div>
    );
  }

  // 3. RETRY_EXHAUSTED
  if (state === "RETRY_EXHAUSTED") {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <span
          className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300"
          title="Automatic retries stopped after 10 failed attempts"
        >
          <AlertCircle className="h-3 w-3 text-rose-400" />
          <span>10/10 Exhausted</span>
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={handleRetry}
          title="Restart acquisition sequence for this sensor"
          className="inline-flex items-center gap-1 rounded-md border border-rose-400/40 bg-rose-600/30 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm transition hover:bg-rose-500 hover:border-rose-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-2.5 w-2.5 ${loading ? "animate-spin" : ""}`} />
          <span>{loading ? "Retrying..." : "Retry"}</span>
        </button>
      </div>
    );
  }

  // 4. STALE
  if (state === "STALE") {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
          <Clock className="h-3 w-3 text-amber-400" />
          <span>Stale</span>
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={handleRetry}
          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-medium text-slate-200 transition hover:bg-white/20 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-2.5 w-2.5 ${loading ? "animate-spin" : ""}`} />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  // 5. UNAVAILABLE
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-600/40 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-400">
        <AlertCircle className="h-3 w-3 text-slate-400" />
        <span>Unavailable</span>
      </span>
      <button
        type="button"
        disabled={loading}
        onClick={handleRetry}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-600/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 transition hover:bg-emerald-600/40 hover:text-white disabled:opacity-50"
      >
        <RefreshCw className={`h-2.5 w-2.5 ${loading ? "animate-spin" : ""}`} />
        <span>{loading ? "..." : "Retry"}</span>
      </button>
    </div>
  );
}
