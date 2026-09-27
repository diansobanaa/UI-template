/**
 * telemetry-stream.ts
 *
 * Realtime Telemetry WebSocket Manager for the AgroTech UI.
 *
 * Requirements:
 * - One persistent WebSocket connection per UI tab (/api/v1/telemetry/stream).
 * - Automatic reconnect with bounded exponential backoff (2s -> 4s -> 8s -> 15s max).
 * - On reconnect: single GET /api/v1/telemetry/current refresh + deviceClock RTC sync.
 * - Updates latest telemetry cache in RAM without triggering full application refresh.
 * - No polling storm.
 */

import { esp32Client } from "./esp32-client";
import type { TelemetrySnapshot, TelemetryStreamBatch } from "./contracts";
import { telemetryService } from "@/lib/services";
import { deviceClock } from "@/lib/device-clock";
import { useEffect, useState } from "react";

export type TelemetryBatchListener = (batch: TelemetryStreamBatch) => void;

class TelemetryStreamManager {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private backoffDelayMs = 2000;
  private readonly maxBackoffMs = 15000;
  private listeners = new Set<TelemetryBatchListener>();
  private latestBatch: TelemetryStreamBatch | null = null;
  private streamMode = "IDLE";
  private cadenceSec = 10;
  private isConnected = false;

  constructor() {
    if (typeof window !== "undefined") {
      // Connect on module initialization in browser environment
      this.connect();
    }
  }

  connect(): void {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return; // Connection already active or in flight
    }

    this.isConnecting = true;
    try {
      this.ws = esp32Client.createTelemetryWebSocket(
        (batch) => this.handleBatch(batch),
        () => this.handleError(),
        () => this.handleClose()
      );

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.isConnected = true;
        this.backoffDelayMs = 2000; // Reset backoff on successful connect
        try {
          this.ws?.send(JSON.stringify({ type: "subscribe" }));
        } catch {}

        // 1. One-time current RAM snapshot refresh after connect/reconnect
        void this.refreshCurrentSnapshot();

        // 2. Synchronize device clock reference with authoritative RTC
        void deviceClock.syncFromDevice();
      };
    } catch {
      this.handleError();
    }
  }

  private handleBatch(batch: TelemetryStreamBatch): void {
    if (!batch || batch.type !== "telemetry_batch") return;

    this.latestBatch = batch;
    if (batch.streamMode) this.streamMode = batch.streamMode;
    if (batch.cadenceSec) this.cadenceSec = batch.cadenceSec;

    // Convert latest stream sample into RAM-first TelemetrySnapshot update
    if (Array.isArray(batch.samples) && batch.samples.length > 0) {
      const latestSample = batch.samples[batch.samples.length - 1];
      const snapshot: TelemetrySnapshot = {
        recordType: "TELEMETRY",
        complexId: batch.complexId,
        deviceId: batch.deviceId,
        sequence: latestSample.sequence,
        timestamp: latestSample.timestamp || latestSample.deviceTimestamp || new Date().toISOString(),
        deviceTimestamp: latestSample.deviceTimestamp || latestSample.timestamp || new Date().toISOString(),
        samples: [
          {
            componentId: "sensor_dht22",
            metricId: "TEMPERATURE",
            source: "TEMPERATURE",
            unit: "C",
            quality: latestSample.temperatureAirC != null || latestSample.temperatureC != null ? "GOOD" : "BAD",
            measurementType: latestSample.temperatureAirC != null || latestSample.temperatureC != null ? "MEASURED" : "UNAVAILABLE",
            value: latestSample.temperatureAirC ?? latestSample.temperatureC ?? null,
            deviceTimestamp: latestSample.deviceTimestamp || latestSample.timestamp,
            sequence: latestSample.sequence,
          },
          {
            componentId: "temp_ds18b20",
            metricId: "TEMPERATURE",
            source: "TEMPERATURE",
            unit: "C",
            quality: latestSample.temperatureWaterC != null || latestSample.waterTemperatureC != null ? "GOOD" : "BAD",
            measurementType: latestSample.temperatureWaterC != null || latestSample.waterTemperatureC != null ? "MEASURED" : "UNAVAILABLE",
            value: latestSample.temperatureWaterC ?? latestSample.waterTemperatureC ?? null,
            deviceTimestamp: latestSample.deviceTimestamp || latestSample.timestamp,
            sequence: latestSample.sequence,
          },
          {
            componentId: "sensor_dht22_hum",
            metricId: "HUMIDITY",
            source: "HUMIDITY",
            unit: "%",
            quality: latestSample.humidityPct != null ? "GOOD" : "BAD",
            measurementType: latestSample.humidityPct != null ? "MEASURED" : "UNAVAILABLE",
            value: latestSample.humidityPct ?? null,
            deviceTimestamp: latestSample.deviceTimestamp || latestSample.timestamp,
            sequence: latestSample.sequence,
          },
          {
            componentId: "water_level",
            metricId: "LEVEL",
            source: "LEVEL",
            unit: "%",
            quality: "GOOD",
            measurementType: "MEASURED",
            value: latestSample.waterLevelPct ?? latestSample.tankLevel ?? null,
            deviceTimestamp: latestSample.deviceTimestamp || latestSample.timestamp,
            sequence: latestSample.sequence,
          },
          {
            componentId: "flow_delivery",
            metricId: "FLOW",
            source: "FLOW",
            unit: "L/min",
            quality: "GOOD",
            measurementType: "MEASURED",
            value: latestSample.flowRateLpm ?? latestSample.flow ?? 0,
            deviceTimestamp: latestSample.deviceTimestamp || latestSample.timestamp,
            sequence: latestSample.sequence,
          },
        ],
        values: {
          temperatureC: latestSample.temperatureAirC ?? latestSample.temperatureC ?? null,
          temperatureAirC: latestSample.temperatureAirC ?? latestSample.temperatureC ?? null,
          temperatureWaterC: latestSample.temperatureWaterC ?? latestSample.waterTemperatureC ?? null,
          waterTemperatureC: latestSample.temperatureWaterC ?? latestSample.waterTemperatureC ?? null,
          humidityPct: latestSample.humidityPct ?? null,
          lightLux: latestSample.lightLux ?? latestSample.light ?? null,
          waterLevelPct: latestSample.waterLevelPct ?? latestSample.tankLevel ?? 0,
          flowRateLpm: latestSample.flowRateLpm ?? latestSample.flow ?? 0,
          totalLiters: latestSample.totalLiters ?? 0,
        },
        source: "ESP32",
        stale: false,
        hasMore: false,
      };

      telemetryService.updateFromStreamSnapshot(snapshot);
    }

    // Notify registered UI component listeners
    this.listeners.forEach((listener) => {
      try {
        listener(batch);
      } catch (err) {
        console.error("[TelemetryStream] Listener error:", err);
      }
    });
  }

  private handleError(): void {
    this.isConnected = false;
    this.scheduleReconnect();
  }

  private handleClose(): void {
    this.isConnected = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    this.ws = null;
    this.isConnecting = false;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.backoffDelayMs = Math.min(this.backoffDelayMs * 2, this.maxBackoffMs);
      this.connect();
    }, this.backoffDelayMs);
  }

  private async refreshCurrentSnapshot(): Promise<void> {
    try {
      const snap = await esp32Client.getCurrentTelemetry();
      if (snap) {
        telemetryService.updateFromStreamSnapshot(snap);
      }
    } catch {
      // Non-fatal on transient network error
    }
  }

  subscribe(listener: TelemetryBatchListener): () => void {
    this.listeners.add(listener);
    if (!this.isConnected && !this.isConnecting) {
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): { isConnected: boolean; streamMode: string; cadenceSec: number; latestBatch: TelemetryStreamBatch | null } {
    return {
      isConnected: this.isConnected,
      streamMode: this.streamMode,
      cadenceSec: this.cadenceSec,
      latestBatch: this.latestBatch,
    };
  }
}

export const telemetryStreamManager = new TelemetryStreamManager();

/**
 * Hook for UI components to subscribe to the single WebSocket telemetry stream.
 */
export function useTelemetryStream(onBatchReceived?: TelemetryBatchListener) {
  const [status, setStatus] = useState(() => telemetryStreamManager.getStatus());

  useEffect(() => {
    const unsubscribe = telemetryStreamManager.subscribe((batch) => {
      setStatus(telemetryStreamManager.getStatus());
      if (onBatchReceived) {
        onBatchReceived(batch);
      }
    });
    return unsubscribe;
  }, [onBatchReceived]);

  return status;
}
