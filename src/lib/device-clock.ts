/**
 * device-clock.ts
 *
 * Authoritative Device RTC Clock Service & Reactive Hook.
 *
 * Operational Semantics:
 * - Runtime time authority is the ESP32 RTC (/api/v1/clock).
 * - Synchronization cadence: Every 120 seconds (2 minutes).
 * - UI advances smoothly every second using monotonic elapsed time (performance.now()).
 * - Zero HTTP request storm: No per-second RTC polling.
 * - Clock failure resilience: If a sync request fails, the clock continues
 *   monotonic progression from the last valid reference without freezing or resetting.
 */

import { esp32Client } from "@/lib/api/esp32-client";
import { useEffect, useState, useSyncExternalStore } from "react";

type ClockListener = () => void;

class DeviceClockService {
  private deviceTimeAtSyncMs: number | null = null;
  private perfAtSyncMs: number | null = null;
  private isSynchronized = false;
  private syncInFlight: Promise<boolean> | null = null;
  private syncIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<ClockListener>();

  constructor() {
    if (typeof window !== "undefined") {
      // Immediate initial sync
      void this.syncFromDevice();
      // Regular periodic sync every 120 seconds
      this.syncIntervalTimer = setInterval(() => {
        void this.syncFromDevice();
      }, 120_000);
    }
  }

  /**
   * Synchronize authoritative time reference with the ESP32 RTC.
   * Single-flight: will not overlap multiple sync queries.
   */
  async syncFromDevice(force = false): Promise<boolean> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = (async () => {
      try {
        const t0 = performance.now();
        const res = await esp32Client.getClock();
        const t1 = performance.now();
        const roundTripMs = t1 - t0;

        // Extract timestamp from envelope
        const iso =
          res?.currentLocal ||
          res?.currentUtc ||
          res?.data?.currentLocal ||
          res?.data?.currentUtc ||
          res?.deviceTimestamp;

        if (iso) {
          const parsed = Date.parse(iso);
          if (!isNaN(parsed) && parsed > 0) {
            // Account for half-roundtrip latency estimate
            const adjustedDeviceEpochMs = parsed + Math.round(roundTripMs / 2);
            const nowPerf = performance.now();

            if (this.deviceTimeAtSyncMs !== null && this.perfAtSyncMs !== null && !force) {
              const currentEstimated = this.deviceTimeAtSyncMs + (nowPerf - this.perfAtSyncMs);
              const driftMs = Math.abs(adjustedDeviceEpochMs - currentEstimated);
              // If drift is small (< 1500ms), don't introduce visual jitter
              if (driftMs < 1500) {
                // Gently blend reference
                this.deviceTimeAtSyncMs = adjustedDeviceEpochMs;
                this.perfAtSyncMs = nowPerf;
              } else {
                // Noticeable drift or clock changed: apply authoritative update
                this.deviceTimeAtSyncMs = adjustedDeviceEpochMs;
                this.perfAtSyncMs = nowPerf;
              }
            } else {
              this.deviceTimeAtSyncMs = adjustedDeviceEpochMs;
              this.perfAtSyncMs = nowPerf;
            }

            this.isSynchronized = true;
            this.notify();
            return true;
          }
        }
        return false;
      } catch (err) {
        // Clock request failed: keep ticking from last known reference without crashing
        return false;
      } finally {
        this.syncInFlight = null;
      }
    })();

    return this.syncInFlight;
  }

  /**
   * Push current gadget local time to ESP32 RTC (/api/v1/clock-sync)
   * and immediately re-synchronize local monotonic reference.
   */
  async pushGadgetTimeToDevice(): Promise<{ success: boolean; message: string; deviceTimestamp?: string }> {
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const localTimestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";
      const res = await esp32Client.syncClock({
        timestamp: localTimestamp,
        timezone,
      });
      // Force refresh authoritative reference from device
      await this.syncFromDevice(true);
      return {
        success: true,
        message: `RTC DS3231 berhasil disinkronkan ke ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} (${timezone})`,
        deviceTimestamp: res?.deviceTimestamp || localTimestamp,
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Gagal menyinkronkan jam RTC",
      };
    }
  }

  /**
   * Current authoritative operational Date.
   * Derived from ESP32 RTC + monotonic elapsed duration.
   */
  getTime(): Date {
    if (this.deviceTimeAtSyncMs !== null && this.perfAtSyncMs !== null && typeof performance !== "undefined") {
      const elapsed = performance.now() - this.perfAtSyncMs;
      return new Date(this.deviceTimeAtSyncMs + elapsed);
    }
    return new Date();
  }

  /**
   * Seconds elapsed since midnight (00:00:00) on the device.
   */
  getSecondsSinceMidnight(): number {
    const d = this.getTime();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  }

  /**
   * Day fraction: 0.0 (midnight) to 1.0 (end of day).
   */
  getDayFraction(): number {
    return Math.max(0, Math.min(1, this.getSecondsSinceMidnight() / 86400));
  }

  /**
   * Day percentage: 0.0 to 100.0%.
   */
  getDayPct(): number {
    return this.getDayFraction() * 100;
  }

  /**
   * 24-hour formatted time: HH:mm:ss
   */
  formatTime(includeSeconds = true): string {
    const d = this.getTime();
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    if (!includeSeconds) return `${h}:${m}`;
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }

  /**
   * Human formatted date: e.g. "25 Sep 2026"
   */
  formatDate(): string {
    const d = this.getTime();
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  /**
   * Long formatted date: e.g. "Fri, 25 Sep 2026"
   */
  formatLongDate(): string {
    const d = this.getTime();
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  get isDeviceSynchronized(): boolean {
    return this.isSynchronized;
  }

  subscribe(listener: ClockListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {}
    });
  }
}

export const deviceClock = new DeviceClockService();

export interface DeviceClockState {
  date: Date;
  timeStr: string;
  timeShortStr: string;
  dateStr: string;
  longDateStr: string;
  secondsSinceMidnight: number;
  dayFraction: number;
  dayPct: number;
  isSynced: boolean;
}

/**
 * React Hook for rendering authoritative RTC device time.
 * Advances locally every 1000ms using monotonic elapsed time.
 * Zero extra HTTP requests.
 */
export function useDeviceClock(): DeviceClockState {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const d = deviceClock.getTime();
  const seconds = deviceClock.getSecondsSinceMidnight();
  const dayFraction = deviceClock.getDayFraction();

  return {
    date: d,
    timeStr: deviceClock.formatTime(true),
    timeShortStr: deviceClock.formatTime(false),
    dateStr: deviceClock.formatDate(),
    longDateStr: deviceClock.formatLongDate(),
    secondsSinceMidnight: seconds,
    dayFraction,
    dayPct: dayFraction * 100,
    isSynced: deviceClock.isDeviceSynchronized,
  };
}
