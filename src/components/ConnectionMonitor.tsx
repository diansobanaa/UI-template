"use client";

import { useEffect, useState, useRef } from "react";
import { esp32Client, HEALTH_TIMEOUT_MS } from "@/lib/api/esp32-client";
import { isDirectEsp32Enabled, isPythonBackendEnabled, getActiveEsp32Endpoint } from "@/lib/api/backend-client";
import { telemetryStreamManager } from "@/lib/api/telemetry-stream";
import { getOperationalSnapshot, updateComplexRuntime } from "@/lib/operational-state";
import { operationalPythonClient } from "@/lib/operational-state";
import { AlertTriangle } from "lucide-react";
import { useDbVersion } from "@/lib/useDb";
import type { Complex } from "@/lib/types";

export interface ControllerTarget {
  key: string;
  deviceId?: string;
  endpoint?: string;
  complexIds: string[];
}

export function getControllerTargets(complexes: Complex[]): ControllerTarget[] {
  const targetMap = new Map<string, ControllerTarget>();
  for (const c of complexes) {
    const deviceId = c.esp32?.deviceId?.trim();
    const endpoint = c.esp32?.endpoint?.trim();
    const resolvedEndpoint = endpoint || (isDirectEsp32Enabled() ? getActiveEsp32Endpoint() : undefined);

    const key = deviceId || resolvedEndpoint || (c.esp32 ? c.id : undefined);
    if (!key) continue;

    const existing = targetMap.get(key);
    if (existing) {
      if (!existing.complexIds.includes(c.id)) {
        existing.complexIds.push(c.id);
      }
      if (!existing.endpoint && resolvedEndpoint) {
        existing.endpoint = resolvedEndpoint;
      }
    } else {
      targetMap.set(key, {
        key,
        deviceId,
        endpoint: resolvedEndpoint,
        complexIds: [c.id],
      });
    }
  }
  return Array.from(targetMap.values());
}

export function ConnectionMonitor() {
  useDbVersion();
  const [isOffline, setIsOffline] = useState(false);
  const consecutiveHealthFailures = useRef<Map<string, number>>(new Map());
  const healthRequestInFlight = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const operationalComplexes = getOperationalSnapshot().complexes;
  const targets = getControllerTargets(operationalComplexes);
  const hasBoundController = targets.length > 0;

  useEffect(() => {
    if (!hasBoundController) {
      if (isOffline) setIsOffline(false);
      consecutiveHealthFailures.current.clear();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      return;
    }

    // Simple beep sound encoded as base64
    const beepAudio = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU..."; 
    audioRef.current = new Audio(beepAudio);
    
    // Request notification permission
    if ("Notification" in window) {
      Notification.requestPermission();
    }

    const pollInterval = 5000;
    const interval = setInterval(async () => {
      // Single-flight guard: prevent overlapping health requests / request storm
      if (healthRequestInFlight.current) {
        return;
      }
      healthRequestInFlight.current = true;

      try {
        const currentComplexes = getOperationalSnapshot().complexes;
        const currentTargets = getControllerTargets(currentComplexes);
        if (currentTargets.length === 0) {
          consecutiveHealthFailures.current.clear();
          if (isOffline) setIsOffline(false);
          return;
        }

        let anyTargetOffline = false;

        for (const target of currentTargets) {
          let targetHealthy = false;

          // 1. Lightweight direct ESP32 health check with isolated timeout
          if (isDirectEsp32Enabled()) {
            try {
              await esp32Client.getHealth({
                endpoint: target.endpoint,
                timeoutMs: HEALTH_TIMEOUT_MS,
              });
              targetHealthy = true;
            } catch {
              targetHealthy = false;
            }
          }

          // 1b. Realtime telemetry stream fallback: if HTTP health check had transient timeout
          // but the persistent WebSocket telemetry stream is actively connected, device is demonstrably online
          if (!targetHealthy && isDirectEsp32Enabled()) {
            if (telemetryStreamManager.getStatus().isConnected) {
              targetHealthy = true;
            }
          }

          // 2. Check via Python backend mirror if direct communication is disabled or unreachable
          if (!targetHealthy && isPythonBackendEnabled()) {
            try {
              const ctx = await operationalPythonClient.getOperationalContext();
              if (ctx && Array.isArray(ctx.complexes)) {
                const matching = ctx.complexes.find((rc) => 
                  (target.deviceId && rc.esp32?.deviceId === target.deviceId) ||
                  target.complexIds.includes(rc.id)
                );
                if (matching?.esp32?.online) {
                  targetHealthy = true;
                }
              }
            } catch {
              // Backend unreachable
            }
          }

          const currentFailures = consecutiveHealthFailures.current.get(target.key) || 0;

          if (targetHealthy) {
            consecutiveHealthFailures.current.set(target.key, 0);
            for (const cId of target.complexIds) {
              updateComplexRuntime(cId, { online: true });
            }
          } else {
            const nextFailures = currentFailures + 1;
            consecutiveHealthFailures.current.set(target.key, nextFailures);

            // Policy: mark offline on 3 consecutive failures (15s tolerance, prevents false alarms on transient Wi-Fi jitter)
            if (nextFailures >= 3) {
              anyTargetOffline = true;
              for (const cId of target.complexIds) {
                updateComplexRuntime(cId, { online: false });
              }
            }
          }
        }

        // Manage global alarm/banner state
        if (anyTargetOffline) {
          if (!isOffline) {
            setIsOffline(true);
            triggerAlarm();
          }
        } else {
          const anyStillFailing = Array.from(consecutiveHealthFailures.current.values()).some((f) => f >= 3);
          if (!anyStillFailing && isOffline) {
            setIsOffline(false);
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
            }
          }
        }
      } finally {
        healthRequestInFlight.current = false;
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [hasBoundController, isOffline]);

  const triggerAlarm = () => {
    if (!hasBoundController) return;
    if (audioRef.current) {
      audioRef.current.loop = true;
      audioRef.current.play().catch(e => console.error("Audio play failed", e));
    }
    
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("PERINGATAN KRITIS", {
        body: "Koneksi ESP32 Terputus. Periksa Listrik/Jaringan!",
        icon: "/favicon.ico",
      });
    }
  };

  const dismissAlarm = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsOffline(false);
  };

  if (!isOffline || !hasBoundController) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-red-600 text-white p-4 rounded-lg shadow-2xl flex items-center gap-4 animate-bounce">
      <AlertTriangle className="w-8 h-8 text-yellow-300" />
      <div>
        <h3 className="font-bold text-lg">KONEKSI TERPUTUS!</h3>
        <p className="text-sm">ESP32 tidak merespon. Periksa Listrik / WiFi Pompa.</p>
      </div>
      <button 
        onClick={dismissAlarm}
        className="ml-4 px-4 py-2 bg-white text-red-600 font-bold rounded hover:bg-gray-100"
      >
        TUTUP ALARM
      </button>
    </div>
  );
}
