"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Waves, Power, Clock, AlertTriangle, CheckCircle2, ShieldAlert, WifiOff } from "lucide-react";
import { fertigationService, complexService } from "@/lib/services";
import type { WellPumpDetails } from "@/lib/api/contracts";

interface WellPumpControlCardProps {
  complexId?: string;
  className?: string;
  dark?: boolean;
}

export function WellPumpControlCard({
  complexId = "c1",
  className = "",
  dark = false,
}: WellPumpControlCardProps) {
  const [details, setDetails] = useState<WellPumpDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [countdownSec, setCountdownSec] = useState<number>(0);

  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const complex = complexService.get(complexId);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await fertigationService.getWellPumpDetails();
      if (data) {
        setDetails(data);
        setIsOnline(true);
        setError(null);
        if (data.manualActive && data.remainingSec > 0) {
          setCountdownSec(data.remainingSec);
        } else {
          setCountdownSec(0);
        }
      }
    } catch {
      setIsOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Periodic polling every 2.5 seconds
  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Client-side smooth countdown decrement
  useEffect(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    if (details?.manualActive && countdownSec > 0) {
      countdownTimerRef.current = setInterval(() => {
        setCountdownSec((prev) => {
          if (prev <= 1) {
            void fetchStatus();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [details?.manualActive, countdownSec, fetchStatus]);

  const handleTogglePump = async (turnOn: boolean) => {
    if (toggling) return;
    setToggling(true);
    setError(null);
    try {
      await fertigationService.setWellPump(complexId, turnOn);
      await fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle pump";
      setError(msg);
    } finally {
      setToggling(false);
    }
  };

  const formatTime = (totalSec: number) => {
    const m = Math.floor(Math.max(0, totalSec) / 60);
    const s = Math.max(0, totalSec) % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const isEmergencyStopped = complex?.emergencyStopped || details?.stopReason === "EMERGENCY_STOP_TRIPPED";
  const isPumpOn = details?.on ?? false;

  // Background card styling (supports both light dashboard and dark schedule view)
  const cardBg = dark
    ? "rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl backdrop-blur-md text-white"
    : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm text-slate-900";

  return (
    <div className={`${cardBg} ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/20 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
            <Waves className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold">Well Pump</h3>
            <p className="text-xs text-slate-400">GPIO 1 • Relay 1 • 220V Radar Protection</p>
          </div>
        </div>
      </div>

      {/* Main Status Display */}
      <div className="mt-4 space-y-4">
        {/* Offline warning if connection lost */}
        {!isOnline && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-400">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>Controller connection lost. Status represents last known state.</span>
          </div>
        )}

        {/* E-Stop alert if tripped */}
        {isEmergencyStopped && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>Emergency Stop active. All pump commands locked until system resumed.</span>
          </div>
        )}

        {/* Running State & Direct Action Button */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/20 bg-slate-800/20 px-4 py-3">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</span>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-sm font-bold">
                {isPumpOn ? (
                  <span className="inline-flex items-center gap-2 text-emerald-400">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    RUNNING
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-slate-400">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
                    STOPPED
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Action button — always visible and actionable */}
          <div>
            {isPumpOn ? (
              <button
                type="button"
                disabled={toggling || isEmergencyStopped}
                onClick={() => handleTogglePump(false)}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-rose-500 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Power className="h-4 w-4" />
                {toggling ? "STOPPING..." : "TURN OFF"}
              </button>
            ) : (
              <button
                type="button"
                disabled={toggling || isEmergencyStopped}
                onClick={() => handleTogglePump(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Power className="h-4 w-4" />
                {toggling ? "STARTING..." : "TURN ON (MAX 15M)"}
              </button>
            )}
          </div>
        </div>

        {/* Active bounded manual-run countdown */}
        {isPumpOn && countdownSec > 0 && (
          <div className="space-y-3 rounded-xl border border-slate-700/20 bg-slate-800/10 p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-amber-400" /> Manual Limit:
                </span>
                <span className="font-semibold">15 minutes</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Elapsed:</span>
                <span className="font-mono text-slate-300">
                  {formatTime((details?.maxRuntimeSec || 900) - countdownSec)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Remaining:</span>
                <span className="font-mono font-bold text-amber-400">
                  {formatTime(countdownSec)}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/40">
                <div
                  className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
                  style={{
                    width: `${Math.min(100, Math.max(0, (countdownSec / 900) * 100))}%`,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Reason notice if auto-stopped after 15m */}
        {details?.stopReason === "MANUAL_RUNTIME_LIMIT_REACHED" && !isPumpOn && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Notice:
            </div>
            <div className="mt-1">Maximum manual runtime reached (15 minutes). Automatic shutoff enforced.</div>
          </div>
        )}

        {/* Schedule Info Box */}
        <div className="rounded-xl border border-slate-700/20 bg-slate-800/10 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span
              className="text-slate-400 font-medium cursor-default"
              title="Schedules execute on the ESP32. Manual controls can stop a scheduled run; a run already active when a schedule begins stops at the schedule end."
            >
              Automatic Schedule:
            </span>
            <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-200">
              <Clock className="h-3.5 w-3.5 text-sky-400" />
              {details?.nextSchedule ? `Next: Today ${details.nextSchedule}` : "Active / Configured"}
            </div>
          </div>
        </div>

        {/* Error message if any */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
