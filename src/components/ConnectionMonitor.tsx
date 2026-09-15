"use client";

import { useEffect, useState, useRef } from "react";
import { esp32Client } from "@/lib/api/esp32-client";
import { AlertTriangle } from "lucide-react";

export function ConnectionMonitor() {
  const [isOffline, setIsOffline] = useState(false);
  const failureCount = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Simple beep sound encoded as base64
    const beepAudio = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU..."; 
    audioRef.current = new Audio(beepAudio);
    
    // Request notification permission
    if ("Notification" in window) {
      Notification.requestPermission();
    }

    const interval = setInterval(async () => {
      try {
        await esp32Client.getHealth();
        failureCount.current = 0;
        if (isOffline) {
          setIsOffline(false);
        }
      } catch (err) {
        failureCount.current += 1;
        if (failureCount.current >= 3 && !isOffline) {
          setIsOffline(true);
          triggerAlarm();
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isOffline]);

  const triggerAlarm = () => {
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

  if (!isOffline) return null;

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
