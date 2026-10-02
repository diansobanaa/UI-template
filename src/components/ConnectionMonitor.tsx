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
  const audioAlertRef = useRef<any>(null);

  const operationalComplexes = getOperationalSnapshot().complexes;
  const targets = getControllerTargets(operationalComplexes);
  const hasBoundController = targets.length > 0;

  // Initialize Web Audio synthesizer
  useEffect(() => {
    class BrowserWebAudioAlert {
      private ctx: AudioContext | null = null;
      private timer: ReturnType<typeof setInterval> | null = null;
      private isPlaying = false;

      start() {
        if (this.isPlaying) return;
        try {
          const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextClass) return;
          if (!this.ctx) this.ctx = new AudioContextClass();
          if (this.ctx.state === "suspended") {
            this.ctx.resume().catch(() => {});
          }
          this.isPlaying = true;

          const playPulse = () => {
            if (!this.isPlaying || !this.ctx) return;
            try {
              const osc = this.ctx.createOscillator();
              const gain = this.ctx.createGain();
              osc.type = "sine";
              osc.frequency.setValueAtTime(880, this.ctx.currentTime); // 880Hz alert tone
              gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
              osc.connect(gain);
              gain.connect(this.ctx.destination);
              osc.start();
              osc.stop(this.ctx.currentTime + 0.3);
            } catch {}
          };

          playPulse();
          this.timer = setInterval(playPulse, 1200);
        } catch (e) {
          console.warn("Browser Web Audio API unavailable:", e);
        }
      }

      stop() {
        this.isPlaying = false;
        if (this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
      }
    }

    audioAlertRef.current = new BrowserWebAudioAlert();
    return () => {
      if (audioAlertRef.current) {
        audioAlertRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!hasBoundController) {
      if (isOffline) setIsOffline(false);
      consecutiveHealthFailures.current.clear();
      if (audioAlertRef.current) {
        audioAlertRef.current.stop();
      }
      return;
    }

    // Request notification permission
    if ("Notification" in window) {
      Notification.requestPermission().catch(() => {});
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
          let targetEmergencyStopped: boolean | undefined = undefined;

          // 1. Lightweight direct ESP32 health check with isolated timeout
          if (isDirectEsp32Enabled()) {
            try {
              const healthRes = await esp32Client.getHealth({
                endpoint: target.endpoint,
                timeoutMs: HEALTH_TIMEOUT_MS,
              });
              targetHealthy = true;
              if (healthRes?.runtimeState) {
                targetEmergencyStopped = healthRes.runtimeState === "EMERGENCY_STOP";
              }
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
                  if (matching.emergencyStopped !== undefined) {
                    targetEmergencyStopped = matching.emergencyStopped;
                  }
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
              updateComplexRuntime(cId, {
                online: true,
                ...(targetEmergencyStopped !== undefined ? { emergencyStopped: targetEmergencyStopped } : {}),
              });
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
            if (audioAlertRef.current) {
              audioAlertRef.current.stop();
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
    if (audioAlertRef.current) {
      audioAlertRef.current.start();
    }
    
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("PERINGATAN KRITIS", {
        body: "Koneksi ESP32 Terputus. Periksa Listrik/Jaringan!",
        icon: "/favicon.ico",
      });
    }
  };

  const dismissAlarm = () => {
    if (audioAlertRef.current) {
      audioAlertRef.current.stop();
    }
    setIsOffline(false);
  };

  if (!isOffline || !hasBoundController) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-red-600 text-white p-4 rounded-lg shadow-2xl flex items-center gap-4 animate-bounce max-w-lg">
      <AlertTriangle className="w-8 h-8 text-yellow-300 shrink-0" />
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-base">KONEKSI KONTROLER TERPUTUS</h3>
          <span className="text-[10px] bg-red-800 text-red-200 px-1.5 py-0.5 rounded font-mono">Browser Alert</span>
        </div>
        <p className="text-xs text-red-100 mt-0.5">ESP32 tidak merespon setelah toleransi 15 detik. Buzzer fisik ESP32 (GPIO 18) tetap beroperasi mandiri.</p>
      </div>
      <button 
        onClick={dismissAlarm}
        className="ml-auto px-3 py-1.5 bg-white text-red-600 text-xs font-bold rounded hover:bg-gray-100 shrink-0 shadow"
      >
        TUTUP
      </button>
    </div>
  );
}
