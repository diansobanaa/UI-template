"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { esp32Client } from "@/lib/api/esp32-client";
import { isDirectEsp32Enabled, getActiveEsp32Endpoint } from "@/lib/api/backend-client";
import { getOperationalSnapshot } from "@/lib/operational-state";
import { getControllerTargets } from "@/components/ConnectionMonitor";
import { useAlarmCondition } from "@/lib/alarm-audio";
import type { AlarmsResponse, AlarmItem, AlarmPriority } from "@/lib/api/contracts";
import {
  AlertTriangle,
  Volume2,
  VolumeX,
  CheckCircle,
  Bell,
  ChevronDown,
  ChevronUp,
  Radio,
  Flame,
  Droplets,
  Clock,
  ShieldAlert,
  Sliders,
  X,
} from "lucide-react";

const HUMAN_MESSAGES: Record<string, { title: string; explanation: string; action: string }> = {
  EMERGENCY_STOP_ACTIVE: {
    title: "EMERGENCY STOP DIAKTIFKAN",
    explanation: "Tombol emergency stop ditekan oleh operator atau sistem.",
    action: "Semua aktuator dimatikan total. Selesaikan penyebab darurat lalu lakukan Resume.",
  },
  EMERGENCY_STOP_LATCHED: {
    title: "EMERGENCY STOP TERKUNCI (LATCHED)",
    explanation: "Keadaan darurat sebelumnya dipulihkan dari memori NVS controller.",
    action: "Verifikasi kondisi fisik greenhouse sebelum melepas kunci darurat.",
  },
  TAMPER_LOOP_OPEN: {
    title: "⚠ TAMPER LOOP OPEN — PERIKSA POMPA",
    explanation: "Sirkuit pengaman fisik / tamper loop interlock terbuka atau terputus. Sistem dan pompa tetap beroperasi normal.",
    action: "PERIKSA POMPA dan sambungkan kembali kawat loop pengaman tamper ke ground (GND_LV).",
  },
  WATER_TEMP_HIGH: {
    title: "SUHU AIR TANGKI KRITIS (> 45.0 °C)",
    explanation: "Sensor suhu mendeteksi panas air nutrisi melebihi ambang batas aman 45 °C.",
    action: "Sirkulasi pemanas/pompa dihentikan untuk mencegah kerusakan akar dan sensor.",
  },
  TANK_LOW: {
    title: "LEVEL AIR TANGKI RENDAH (PROTEKSI DRY-RUN)",
    explanation: "Float switch mendeteksi tangki air/nutrisi kosong di bawah level aman.",
    action: "Pompa terkait dihentikan otomatis untuk mencegah kerusakan dry-run. Isi ulang tangki air.",
  },
  FLOW_TIMEOUT: {
    title: "ALIRAN AIR TIDAK TERDETEKSI (FLOW TIMEOUT)",
    explanation: "Pompa berjalan namun sensor flow meter tidak mendeteksi pergerakan air dalam batas waktu.",
    action: "Pompa dihentikan otomatis. Periksa pasokan air, pipa tersumbat, atau katup manual tertutup.",
  },
  ACTUATOR_MAX_RUNTIME: {
    title: "DURASI MAKSIMUM AKTUATOR TERLAMPAUI",
    explanation: "Aktuator melebihi batas waktu aman operasi kontinu.",
    action: "Aktuator dimatikan otomatis untuk proteksi motor dari overheating.",
  },
  SAFETY_SENSOR_STALE: {
    title: "DATA SENSOR KESELAMATAN KEDALUWARSA / KERING",
    explanation: "Controller tidak menerima pembaruan dari sensor keselamatan kritis dalam interval aman.",
    action: "Operasi yang bergantung dihentikan sementara. Periksa kabel sensor dan koneksi I2C/OneWire.",
  },
};

export function AlarmManagerOverlay() {
  const [alarmData, setAlarmData] = useState<AlarmsResponse | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [testingBuzzer, setTestingBuzzer] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isFetchingRef = useRef(false);

  const operationalComplexes = getOperationalSnapshot().complexes;
  const targets = getControllerTargets(operationalComplexes);
  const endpoint = targets[0]?.endpoint || (isDirectEsp32Enabled() ? getActiveEsp32Endpoint() : undefined);
  const isControllerOffline =
    targets.length > 0 &&
    targets.every((t) =>
      t.complexIds.every((cId) => {
        const c = operationalComplexes.find((x) => x.id === cId);
        return c?.esp32?.online === false;
      })
    );

  const fetchAlarms = useCallback(async () => {
    if (!isDirectEsp32Enabled() || isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const data = await esp32Client.getAlarms({ endpoint, timeoutMs: 3000 });
      setAlarmData((prev) => {
        if (!prev) return data;
        const prevAlarms = prev.activeAlarms || [];
        const nextAlarms = data.activeAlarms || [];
        if (
          prevAlarms.length === nextAlarms.length &&
          prev.summary?.buzzerAudible === data.summary?.buzzerAudible &&
          prev.summary?.isSilenced === data.summary?.isSilenced &&
          prev.summary?.activeCount === data.summary?.activeCount &&
          prevAlarms.every((a, i) => a.id === nextAlarms[i]?.id && a.acknowledged === nextAlarms[i]?.acknowledged)
        ) {
          return prev; // No change, preserve object reference to prevent re-render
        }
        return data;
      });
    } catch {
      // Suppress network polling errors; ConnectionMonitor handles offline detection
    } finally {
      isFetchingRef.current = false;
    }
  }, [endpoint]);

  useEffect(() => {
    fetchAlarms();
    const intervalMs = (alarmData?.activeAlarms?.length ?? 0) > 0 ? 5000 : 8000;
    pollTimerRef.current = setInterval(fetchAlarms, intervalMs);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchAlarms, alarmData?.activeAlarms?.length]);

  const handleAcknowledge = async (alarmId?: string) => {
    setIsActionLoading(true);
    try {
      await esp32Client.acknowledgeAlarm(alarmId, { endpoint });
      await fetchAlarms();
    } catch (e) {
      console.error("Failed to acknowledge alarm:", e);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSilence = async (silence: boolean) => {
    setIsActionLoading(true);
    try {
      await esp32Client.silenceAlarm(silence, { endpoint });
      await fetchAlarms();
    } catch (e) {
      console.error("Failed to silence buzzer:", e);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleTestBuzzer = async () => {
    setTestingBuzzer(true);
    try {
      await esp32Client.testBuzzer(800, { endpoint });
      await fetchAlarms();
      setTimeout(async () => {
        await fetchAlarms();
        setTestingBuzzer(false);
      }, 1200);
    } catch (e) {
      console.error("Failed to test buzzer:", e);
      setTestingBuzzer(false);
    }
  };

  const toggleDetails = (id: string) => {
    setExpandedDetails((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activeAlarms = alarmData?.activeAlarms || [];
  const summary = alarmData?.summary;
  const hasActiveAlarms = activeAlarms.length > 0;
  const isSilenced = summary?.isSilenced || false;
  const buzzerAudible = summary?.buzzerAudible || false;

  const hasTamperAlarm = activeAlarms.some((a) => a.code === "TAMPER_LOOP_OPEN");
  useAlarmCondition("tamper-disconnected", hasTamperAlarm && !isControllerOffline);

  // Render minimized badge if user collapsed active alarms
  if (isMinimized && hasActiveAlarms) {
    const isCritical = summary?.criticalCount && summary.criticalCount > 0;
    const content = (
      <>
        {hasTamperAlarm && !isControllerOffline && (
          <div
            id="tamper-alarm-banner"
            role="alert"
            aria-live="assertive"
            className="fixed top-0 left-0 right-0 z-[9999] bg-red-700 text-white font-bold py-2.5 px-4 shadow-xl flex items-center justify-between gap-3 border-b-2 border-red-900 text-sm"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-yellow-300 shrink-0" />
              <span className="tracking-wide text-sm font-extrabold">
                ⚠ TAMPER LOOP OPEN — PERIKSA POMPA
              </span>
              <span className="hidden md:inline text-xs font-normal text-red-100 bg-red-800/80 px-2 py-0.5 rounded">
                Sirkuit loop terbuka. Sistem tetap berjalan, segera periksa kondisi pompa!
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setIsMinimized(false)}
                className="text-xs bg-red-950/90 hover:bg-red-900 text-white font-semibold px-2.5 py-1 rounded border border-red-400/40 transition"
              >
                Lihat Detail Alarm
              </button>
            </div>
          </div>
        )}
        <div className="fixed bottom-5 right-5 z-[9990] flex items-center gap-3">
          <button
            onClick={() => setIsMinimized(false)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full shadow-xl font-bold text-white text-sm transition-transform hover:scale-105 ${
              isCritical ? "bg-red-700 border border-red-500/50" : "bg-amber-600 border border-amber-400/50"
            }`}
          >
            <Bell className="w-4 h-4 text-white" />
            <span>
              {activeAlarms.length} Alarm Aktif ({summary?.highestPriority})
            </span>
            {buzzerAudible && <Volume2 className="w-4 h-4 text-yellow-200" />}
            {isSilenced && <VolumeX className="w-4 h-4 text-red-200" />}
          </button>
        </div>
      </>
    );
    return typeof document !== "undefined" ? createPortal(content, document.body) : content;
  }

  // If no active alarms and buzzer not active/testing, do not render floating standby widget
  if (!hasActiveAlarms && !summary?.testActive && !testingBuzzer && !buzzerAudible) {
    return null;
  }

  const criticalAlarms = activeAlarms.filter((a) => a.priority === "CRITICAL");
  const safetyFaults = activeAlarms.filter((a) => a.priority !== "CRITICAL");

  const content = (
    <>
      {/* Pinned Top-Screen Warning for Tamper Loop Open: Visible across all pages */}
      {hasTamperAlarm && !isControllerOffline && (
        <div
          id="tamper-alarm-banner"
          role="alert"
          aria-live="assertive"
          className="fixed top-0 left-0 right-0 z-[9999] bg-red-700 text-white font-bold py-2.5 px-4 shadow-xl flex items-center justify-between gap-3 border-b-2 border-red-900 text-sm"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-yellow-300 shrink-0" />
            <span className="tracking-wide text-sm font-extrabold">
              ⚠ TAMPER LOOP OPEN — PERIKSA POMPA
            </span>
            <span className="hidden md:inline text-xs font-normal text-red-100 bg-red-800/80 px-2 py-0.5 rounded">
              Sirkuit loop terbuka. Sistem tetap berjalan, segera periksa kondisi pompa!
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-mono bg-red-900/80 px-2 py-0.5 rounded text-red-100 border border-red-400/30">
              HARDWARE BUZZER AKTIF
            </span>
          </div>
        </div>
      )}
      <div className="fixed bottom-5 right-5 z-[9990] w-full max-w-xl max-h-[85vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl text-slate-100 overflow-hidden font-sans">
      {/* Top Banner: Status & Quick Controls */}
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-3 h-3 rounded-full ${
              buzzerAudible ? "bg-red-500" : isSilenced ? "bg-amber-500" : "bg-emerald-500"
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Buzzer Fisik ESP32 (GPIO 18)
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                  buzzerAudible
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : isSilenced
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "bg-slate-800 text-slate-300"
                }`}
              >
                {buzzerAudible ? "BUNYI AKTIF" : isSilenced ? "DI-SILENCE" : "STANDBY"}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Pola: <span className="font-mono text-slate-200">{summary?.activePattern || "OFF"}</span> • Prioritas:{" "}
              <span className="font-mono text-slate-200">{summary?.highestPriority || "NONE"}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Test Buzzer Button */}
          <button
            onClick={handleTestBuzzer}
            disabled={testingBuzzer || isActionLoading}
            title="Uji bunyi buzzer fisik 800ms tanpa mengganggu proteksi"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 font-medium transition"
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>{testingBuzzer ? "Menguji..." : "Test Buzzer"}</span>
          </button>

          {/* Silence / Unsilence Button */}
          {hasActiveAlarms && (
            <button
              onClick={() => handleSilence(!isSilenced)}
              disabled={isActionLoading}
              title={isSilenced ? "Bunyikan kembali buzzer" : "Matikan bunyi buzzer (keadaan alarm tetap aktif)"}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded font-medium border transition ${
                isSilenced
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30"
                  : "bg-red-600/20 text-red-300 border-red-500/40 hover:bg-red-600/30"
              }`}
            >
              {isSilenced ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>{isSilenced ? "Unsilence" : "Silence"}</span>
            </button>
          )}

          {/* Minimize Button */}
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition"
            title="Kecilkan panel alarm (alarm tetap aktif)"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Alarm Cards List */}
      <div className="p-4 space-y-3 overflow-y-auto max-h-[60vh]">
        {/* Critical Alarms Section */}
        {criticalAlarms.map((alarm) => {
          const info = HUMAN_MESSAGES[alarm.code] || {
            title: alarm.code.replace(/_/g, " "),
            explanation: alarm.message,
            action: "Periksa sistem controller dan lakukan penanganan darurat.",
          };
          const isExpanded = !!expandedDetails[alarm.id];

          return (
            <div
              key={alarm.id}
              className="bg-red-950/40 border-2 border-red-600/80 rounded-lg p-3.5 shadow-lg relative overflow-hidden"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-red-600 text-white rounded-md shrink-0 mt-0.5">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5" />
                      ALARM KRITIS SISTEM
                    </span>
                    {alarm.acknowledged ? (
                      <span className="text-[10px] bg-slate-800 text-emerald-400 px-2 py-0.5 rounded font-mono font-medium flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Diakui
                      </span>
                    ) : (
                      <span className="text-[10px] bg-red-500/30 text-red-200 px-2 py-0.5 rounded font-mono font-bold">
                        Perlu Perhatian
                      </span>
                    )}
                  </div>

                  <h4 className="text-sm font-bold text-white mt-1">{info.title}</h4>
                  <p className="text-xs text-red-200/90 mt-1 leading-relaxed">{info.explanation}</p>
                  <p className="text-xs text-amber-200/80 mt-1 font-medium bg-red-950/60 p-2 rounded border border-red-800/40">
                    Tindakan: {info.action}
                  </p>

                  {/* Actions & Details toggle */}
                  <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-red-900/50">
                    <div className="flex items-center gap-2">
                      {!alarm.acknowledged && (
                        <button
                          onClick={() => handleAcknowledge(alarm.id)}
                          disabled={isActionLoading}
                          className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded shadow transition"
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() => toggleDetails(alarm.id)}
                        className="px-2.5 py-1 text-xs text-slate-300 hover:text-white rounded hover:bg-red-900/40 flex items-center gap-1"
                      >
                        <span>Rincian</span>
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </div>

                    <span className="text-[10px] font-mono text-slate-400">
                      ID: {alarm.id} • Dibuat: {Math.round(alarm.createdAt / 1000)}s
                    </span>
                  </div>

                  {/* Technical Diagnostic Details */}
                  {isExpanded && (
                    <div className="mt-2.5 p-2.5 bg-slate-950 rounded text-[11px] font-mono text-slate-300 space-y-1 border border-slate-800">
                      <div>Code: {alarm.code}</div>
                      <div>Message: {alarm.message}</div>
                      <div>Priority: {alarm.priority}</div>
                      {alarm.componentId && <div>Component: {alarm.componentId}</div>}
                      {alarm.ghId && <div>Greenhouse: {alarm.ghId}</div>}
                      <div>Silenced: {alarm.silenced ? "true" : "false"}</div>
                      <div>Acknowledged: {alarm.acknowledged ? "true" : "false"}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Operational Safety Faults Section */}
        {safetyFaults.map((alarm) => {
          const info = HUMAN_MESSAGES[alarm.code] || {
            title: alarm.code.replace(/_/g, " "),
            explanation: alarm.message,
            action: "Pompa terkait dihentikan lokal. Periksa level tangki dan aliran air.",
          };
          const isExpanded = !!expandedDetails[alarm.id];

          return (
            <div
              key={alarm.id}
              className="bg-amber-950/30 border border-amber-500/60 rounded-lg p-3.5 shadow-md relative overflow-hidden"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-500 text-slate-950 rounded-md shrink-0 mt-0.5">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                        PERINGATAN OPERASIONAL
                      </span>
                      {alarm.ghId && (
                        <span className="text-[10px] bg-amber-900/50 text-amber-200 px-1.5 py-0.5 rounded font-mono font-bold">
                          {alarm.ghId}
                        </span>
                      )}
                    </div>
                    {alarm.acknowledged ? (
                      <span className="text-[10px] bg-slate-800 text-emerald-400 px-2 py-0.5 rounded font-mono font-medium flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Diakui
                      </span>
                    ) : (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono font-bold">
                        Proteksi Lokal Aktif
                      </span>
                    )}
                  </div>

                  <h4 className="text-sm font-bold text-slate-100 mt-1">{info.title}</h4>
                  <p className="text-xs text-amber-100/90 mt-1 leading-relaxed">{info.explanation}</p>
                  <p className="text-xs text-slate-300 mt-1 font-medium bg-slate-950/60 p-2 rounded border border-slate-800">
                    Tindakan: {info.action}
                  </p>

                  {/* Actions & Details toggle */}
                  <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-amber-900/40">
                    <div className="flex items-center gap-2">
                      {!alarm.acknowledged && (
                        <button
                          onClick={() => handleAcknowledge(alarm.id)}
                          disabled={isActionLoading}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded shadow transition"
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() => toggleDetails(alarm.id)}
                        className="px-2.5 py-1 text-xs text-slate-300 hover:text-white rounded hover:bg-slate-800 flex items-center gap-1"
                      >
                        <span>Rincian</span>
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </div>

                    <span className="text-[10px] font-mono text-slate-400">
                      Komponen: {alarm.componentId || "Umum"}
                    </span>
                  </div>

                  {/* Technical Diagnostic Details */}
                  {isExpanded && (
                    <div className="mt-2.5 p-2.5 bg-slate-950 rounded text-[11px] font-mono text-slate-300 space-y-1 border border-slate-800">
                      <div>Code: {alarm.code}</div>
                      <div>Message: {alarm.message}</div>
                      <div>Priority: {alarm.priority}</div>
                      <div>ID: {alarm.id}</div>
                      {alarm.componentId && <div>Component: {alarm.componentId}</div>}
                      {alarm.ghId && <div>Greenhouse: {alarm.ghId}</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 bg-slate-950 text-[11px] text-slate-400 border-t border-slate-800 flex items-center justify-between">
        <span>Menampilkan {activeAlarms.length} alarm aktif</span>
        <button
          onClick={() => handleAcknowledge(undefined)}
          disabled={isActionLoading || activeAlarms.every((a) => a.acknowledged)}
          className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-600 font-medium transition"
        >
          Acknowledge Semua
        </button>
      </div>
      </div>
    </>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
