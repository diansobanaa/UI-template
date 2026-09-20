"use client";

import { useEffect, useState, useRef } from "react";
import { esp32Client } from "@/lib/api/esp32-client";
import { getOperationalSnapshot, updateComplexRuntime } from "@/lib/operational-state";
import { eventService } from "@/lib/services";
import { operationalPythonClient } from "@/lib/operational-state";
import { AlertTriangle } from "lucide-react";
import { useDbVersion } from "@/lib/useDb";

export function ConnectionMonitor() {
  useDbVersion();
  const [isOffline, setIsOffline] = useState(false);
  const failureCount = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastStatusComplexId = useRef<string | undefined>(undefined);

  const operationalComplexes = getOperationalSnapshot().complexes;
  const hasBoundController = operationalComplexes.some(
    (c) => Boolean(c.esp32?.deviceId && c.esp32.deviceId.trim())
  );

  useEffect(() => {
    if (!hasBoundController) {
      if (isOffline) setIsOffline(false);
      failureCount.current = 0;
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

    const interval = setInterval(async () => {
      const currentComplexes = getOperationalSnapshot().complexes;
      const registered = currentComplexes.some(
        (c) => Boolean(c.esp32?.deviceId && c.esp32.deviceId.trim())
      );
      if (!registered) {
        failureCount.current = 0;
        if (isOffline) setIsOffline(false);
        return;
      }

      try {
        await esp32Client.getHealth();
        failureCount.current = 0;
        if (isOffline) {
          setIsOffline(false);
          const complexIds = getOperationalSnapshot().complexes.map((c) => c.id);
          await Promise.allSettled(complexIds.map((id) => operationalPythonClient.syncEsp32(id)));
        }
        // Sync real live status from ESP32 into UI store
        try {
          const status = await esp32Client.getStatus();
          const actuators: Record<string, boolean> = {};
          if (status.actuators) {
            for (const [k, v] of Object.entries(status.actuators)) {
              actuators[k] = Boolean(v === true || v === "ON" || v === "RUNNING");
            }
          }
          const operationalComplexes = getOperationalSnapshot().complexes;
          const statusComplexId = typeof status.device?.complexId === "string" ? status.device.complexId : undefined;
          if (!statusComplexId || !operationalComplexes.some((complex) => complex.id === statusComplexId)) return;
          lastStatusComplexId.current = statusComplexId;
          const complexId = statusComplexId;
          updateComplexRuntime(complexId, {
            online: true,
            emergencyStopped: Boolean(status.safety?.emergencyStopped),
            device: {
              firmwareVersion: typeof status.device?.firmwareVersion === "string" ? status.device.firmwareVersion : undefined,
              hardwareModel: typeof status.device?.hardwareModel === "string" ? status.device.hardwareModel : undefined,
            },
            configuration: {
              version: typeof status.configuration?.version === "number" ? status.configuration.version : undefined,
            },
            actuators,
            sensors: {
              temperatureC: typeof status.sensors?.temperatureC === "number" ? status.sensors.temperatureC : null,
            },
          });
          await eventService.syncLogsFromEsp32(complexId);
        } catch {
          // Ignore transient status fetch errors during polling
        }
      } catch (err) {
        failureCount.current += 1;
        if (failureCount.current >= 3 && !isOffline) {
          setIsOffline(true);
          const complexId = lastStatusComplexId.current;
          if (complexId) updateComplexRuntime(complexId, { online: false });
          triggerAlarm();
        }
      }
    }, 5000);

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
    failureCount.current = 0; // Reset so it can trigger again if still offline
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
