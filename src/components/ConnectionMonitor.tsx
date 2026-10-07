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

/** Liveness policy: probe every 3 s, OFFLINE after 2 consecutive failures (~5 s worst case in foreground). */
export const POLL_INTERVAL_MS = 3000;
export const OFFLINE_FAILURE_THRESHOLD = 2;
/** A telemetry frame received within one probe cycle proves the controller is alive. A merely "open"
 *  socket does not: after a power cut a half-open WebSocket can look connected for minutes. */
const WS_FRESH_MS = POLL_INTERVAL_MS + HEALTH_TIMEOUT_MS;
/** Another tab played the disconnect chime this recently -> stay silent. */
const CHIME_SUPPRESS_MS = 15000;
const CONNECTION_BUS = "agrotech_connection_bus";

// One AudioContext per tab, created only inside a user gesture so autoplay policy never logs errors.
let audioCtx: AudioContext | null = null;

function unlockAudio(): void {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  } catch {
    // Audio unavailable; the visual warning still works.
  }
}

/** Plays one short 880 Hz -> 440 Hz chime. Returns false if audio is not unlocked/available. */
function playDisconnectChime(): boolean {
  const ctx = audioCtx;
  // Never schedule on a suspended context: it would play late, on some future click.
  if (!ctx || ctx.state !== "running") return false;
  try {
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    };
    const t0 = ctx.currentTime;
    tone(880, t0, 0.15);
    tone(440, t0 + 0.17, 0.25);
    return true;
  } catch {
    return false;
  }
}

export function ConnectionMonitor() {
  useDbVersion();
  const [isOffline, setIsOffline] = useState(false);
  const isOfflineRef = useRef(false); // previous global state, for edge-triggered transitions
  const consecutiveHealthFailures = useRef<Map<string, number>>(new Map());
  const healthRequestInFlight = useRef(false);
  const lastWsFrame = useRef<{ at: number; deviceId?: string }>({ at: 0 });
  const busRef = useRef<BroadcastChannel | null>(null);
  const lastRemoteChimeAt = useRef(0);
  const chimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const operationalComplexes = getOperationalSnapshot().complexes;
  const targets = getControllerTargets(operationalComplexes);
  const hasBoundController = targets.length > 0;

  // Audio unlock on any user gesture (cheap no-op once running; re-resumes if the browser suspends it).
  useEffect(() => {
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", unlockAudio, opts);
    window.addEventListener("keydown", unlockAudio, opts);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio, opts);
      window.removeEventListener("keydown", unlockAudio, opts);
    };
  }, []);

  // Cross-tab chime coordination. Missing BroadcastChannel just means each tab may chime.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let bus: BroadcastChannel;
    try {
      bus = new BroadcastChannel(CONNECTION_BUS);
    } catch {
      return;
    }
    bus.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "DISCONNECT_CHIME_PLAYED") lastRemoteChimeAt.current = Date.now();
    };
    busRef.current = bus;
    return () => {
      bus.close();
      busRef.current = null;
    };
  }, []);

  // Liveness evidence from the existing telemetry stream (read-only subscription).
  useEffect(
    () =>
      telemetryStreamManager.subscribe((batch) => {
        lastWsFrame.current = { at: Date.now(), deviceId: batch?.deviceId };
      }),
    [],
  );

  useEffect(() => {
    const cancelChime = () => {
      if (chimeTimer.current) {
        clearTimeout(chimeTimer.current);
        chimeTimer.current = null;
      }
    };

    const setGlobalOffline = (offline: boolean) => {
      if (offline === isOfflineRef.current) return; // OFFLINE->OFFLINE and ONLINE->ONLINE are silent
      isOfflineRef.current = offline;
      setIsOffline(offline);
      if (!offline) {
        cancelChime(); // OFFLINE->ONLINE: no recovery sound, drop any pending chime
        return;
      }
      // ONLINE->OFFLINE. Small jitter (visible tab first) lets a sibling tab's broadcast arrive before we play.
      const delay = (document.visibilityState === "visible" ? 0 : 400) + Math.random() * 200;
      cancelChime();
      chimeTimer.current = setTimeout(() => {
        chimeTimer.current = null;
        if (!isOfflineRef.current) return;
        if (Date.now() - lastRemoteChimeAt.current < CHIME_SUPPRESS_MS) return;
        // Only claim the chime if it was actually audible, otherwise a locked tab would silence the others.
        if (playDisconnectChime()) {
          try {
            busRef.current?.postMessage({ type: "DISCONNECT_CHIME_PLAYED", timestamp: Date.now() });
          } catch {}
        }
      }, delay);
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("PERINGATAN KRITIS", {
            body: "Koneksi ESP32 Terputus. Periksa Listrik/Jaringan!",
            icon: "/favicon.ico",
            tag: "agrotech-esp32-offline", // OS collapses duplicates from multiple tabs
          });
        } catch {}
      }
    };

    if (!hasBoundController) {
      consecutiveHealthFailures.current.clear();
      setGlobalOffline(false);
      return;
    }

    if ("Notification" in window) {
      Notification.requestPermission().catch(() => {});
    }

    const probeTarget = async (target: ControllerTarget) => {
      let healthy = false;
      let emergencyStopped: boolean | undefined;

      if (isDirectEsp32Enabled()) {
        // Primary: lightweight direct GET /api/v1/health.
        try {
          const healthRes = await esp32Client.getHealth({ endpoint: target.endpoint, timeoutMs: HEALTH_TIMEOUT_MS });
          healthy = true;
          if (healthRes?.runtimeState) emergencyStopped = healthRes.runtimeState === "EMERGENCY_STOP";
        } catch {
          // Secondary: a fresh telemetry frame from this controller overrides a transient HTTP failure.
          const ws = lastWsFrame.current;
          healthy =
            telemetryStreamManager.getStatus().isConnected &&
            Date.now() - ws.at < WS_FRESH_MS &&
            (!target.deviceId || !ws.deviceId || ws.deviceId === target.deviceId);
        }
      } else if (isPythonBackendEnabled()) {
        // Python mirror only when the UI is not talking to the ESP32 directly; in direct mode it would
        // conflate backend reachability with controller reachability and add a 15 s default timeout.
        try {
          const ctx = await operationalPythonClient.getOperationalContext();
          const matching =
            ctx && Array.isArray(ctx.complexes)
              ? ctx.complexes.find(
                  (rc) => (target.deviceId && rc.esp32?.deviceId === target.deviceId) || target.complexIds.includes(rc.id),
                )
              : undefined;
          if (matching?.esp32?.online) {
            healthy = true;
            if (matching.emergencyStopped !== undefined) emergencyStopped = matching.emergencyStopped;
          }
        } catch {
          // Backend unreachable
        }
      }
      return { target, healthy, emergencyStopped };
    };

    const tick = async () => {
      // Single-flight guard: never overlap health requests.
      if (healthRequestInFlight.current) return;
      healthRequestInFlight.current = true;
      try {
        const currentTargets = getControllerTargets(getOperationalSnapshot().complexes);
        const failures = consecutiveHealthFailures.current;
        for (const key of Array.from(failures.keys())) {
          if (!currentTargets.some((t) => t.key === key)) failures.delete(key);
        }

        // Parallel probes keep the cycle bounded by one timeout regardless of controller count.
        const results = await Promise.all(currentTargets.map(probeTarget));
        let anyTargetOffline = false;

        for (const { target, healthy, emergencyStopped } of results) {
          if (healthy) {
            failures.set(target.key, 0);
            for (const cId of target.complexIds) {
              updateComplexRuntime(cId, {
                online: true,
                ...(emergencyStopped !== undefined ? { emergencyStopped } : {}),
              });
            }
          } else {
            const next = (failures.get(target.key) || 0) + 1;
            failures.set(target.key, next);
            if (next >= OFFLINE_FAILURE_THRESHOLD) {
              anyTargetOffline = true;
              for (const cId of target.complexIds) {
                updateComplexRuntime(cId, { online: false });
              }
            }
          }
        }

        setGlobalOffline(anyTargetOffline);
      } finally {
        healthRequestInFlight.current = false;
      }
    };

    void tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      cancelChime();
    };
  }, [hasBoundController]);

  if (!isOffline || !hasBoundController) return null;

  // Persistent, non-dismissible: visibility is bound to the real connection state only.
  return (
    <div
      id="esp32-offline-banner"
      role="alert"
      aria-live="assertive"
      className="fixed top-0 left-0 right-0 z-[10000] flex items-center gap-3 border-b-2 border-red-900 bg-red-700 px-4 py-2.5 text-white shadow-2xl"
    >
      <AlertTriangle className="h-6 w-6 shrink-0 text-yellow-300" />
      <div className="min-w-0">
        <div className="text-sm font-extrabold tracking-wide">⚠ ESP32 TIDAK TERHUBUNG</div>
        <div className="text-xs text-red-100">
          Periksa daya dan koneksi ESP32. Data yang ditampilkan adalah snapshot terakhir.
        </div>
      </div>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] font-mono text-red-100">
        <span className="h-2 w-2 rounded-full bg-yellow-300" />
        Mencoba menghubungkan ulang…
      </span>
    </div>
  );
}
