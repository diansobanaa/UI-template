"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FlaskConical,
  Play,
  Square,
  RefreshCcw,
  SlidersHorizontal,
  Layers,
  ArrowRight,
  ShieldAlert,
  Clock,
  Timer,
  Gauge,
  Info,
  ChevronDown,
  ChevronUp,
  Zap,
  Activity,
  BarChart3,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/ui/overlay";
import { Button, Input, Label, Badge } from "@/components/ui/primitives";
import { calibrationService } from "@/lib/services";
import type { CalibrationDevice } from "@/lib/types";
import type {
  MixingTestRequest,
  MixingTestStatus,
  MixingTestChannelRequest,
  CalibrationRates,
} from "@/lib/api/contracts";
import {
  calculateMixingTimingAnalysis,
  type MixingTimingAnalysisResult,
  type MixingPumpTiming,
} from "@/lib/calibration-math";

interface TestMixingModalProps {
  open: boolean;
  onClose: () => void;
  devices: CalibrationDevice[];
  isOnline: boolean;
}

type ModalStep = "CONFIG" | "CONFIRM" | "RUNNING" | "RESULT";

function formatMinutesSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function TestMixingModal({
  open,
  onClose,
  devices,
  isOnline,
}: TestMixingModalProps) {
  // Step state
  const [step, setStep] = useState<ModalStep>("CONFIG");

  // Form parameters (Default 20,000 ml = 20 Liter as standard mixing tank test)
  const [rawWaterTargetMl, setRawWaterTargetMl] = useState<number>(20000);
  const [thresholdPercent, setThresholdPercent] = useState<number>(20);
  const [postMixDurationSec, setPostMixDurationSec] = useState<number>(30);

  // Dynamic Dosing Channels selection & volumes
  const dosingPumps = devices.filter((d) => d.category === "dosing-pump");
  const [channelSelections, setChannelSelections] = useState<
    Record<string, { selected: boolean; targetVolumeMl: number }>
  >({});

  // Execution state
  const [status, setStatus] = useState<MixingTestStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stopping, setStopping] = useState<boolean>(false);
  const [recovering, setRecovering] = useState<boolean>(false);
  const [discarding, setDiscarding] = useState<boolean>(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Flow meter calibration state & cached rates
  const [flowRawPulses, setFlowRawPulses] = useState<number | null>(null);
  const [cachedRates, setCachedRates] = useState<CalibrationRates | null>(null);
  const [isInitializingFlow, setIsInitializingFlow] = useState<boolean>(false);

  // Elapsed time tracking for RUNNING phase
  const [startTimeMs, setStartTimeMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);

  // Raw water pump device identification
  const rawWaterDevice = devices.find(
    (d) =>
      d.category === "raw-water-pump" ||
      d.id === "dev-pump_submersible" ||
      d.id === "dev-pump_raw"
  );

  // Initialize channel selections & fetch flow pulse rate when modal opens
  useEffect(() => {
    if (!open) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setStep("CONFIG");
      setStatus(null);
      setErrorMessage(null);
      setStopping(false);
      setRecovering(false);
      setDiscarding(false);
      setStartTimeMs(null);
      setElapsedSec(0);
      return;
    }

    let isSubscribed = true;

    // Check authoritative hardware status for active or recovery hold test mixing
    calibrationService
      .getMixingTestStatus()
      .then((st) => {
        if (!isSubscribed || !st) return;
        setStatus(st);
        if (st.status === "RUNNING") {
          setStep("RUNNING");
          setStartTimeMs(Date.now() - (st.totalRuntimeMs || 0));
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          pollTimerRef.current = setInterval(async () => {
            try {
              const live = await calibrationService.getMixingTestStatus();
              if (!isSubscribed) return;
              setStatus(live);
              if (live.status === "SUCCESS" || live.status === "ERROR") {
                if (pollTimerRef.current) {
                  clearInterval(pollTimerRef.current);
                  pollTimerRef.current = null;
                }
                setStep("RESULT");
              }
            } catch (err: unknown) {
              console.error("Failed to poll mixing test status:", err);
            }
          }, 750);
        }
      })
      .catch((err) => {
        console.warn("Failed to check initial mixing test status:", err);
      });

    calibrationService
      .getRates()
      .then((rates) => {
        if (isSubscribed && rates) {
          setFlowRawPulses(rates.flowRawPulsesPerL ?? null);
          setCachedRates(rates);
        }
      })
      .catch(() => {});

    const initSelections: Record<
      string,
      { selected: boolean; targetVolumeMl: number }
    > = {};
    dosingPumps.forEach((d) => {
      const compId = d.id.replace("dev-", "");
      const isCalibrated = d.reading !== "—" && parseFloat(d.reading) > 0;
      initSelections[compId] = {
        selected: isCalibrated,
        targetVolumeMl: 200,
      };
    });
    setChannelSelections(initSelections);

    return () => {
      isSubscribed = false;
    };
  }, [open, devices]);

  // Track elapsed seconds while running
  useEffect(() => {
    if (step !== "RUNNING" || !startTimeMs) return;
    const interval = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startTimeMs) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [step, startTimeMs]);

  // Clean up poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const handleInitFlowPulse = async () => {
    setIsInitializingFlow(true);
    try {
      await calibrationService.setFlowPulses(660.0, 288.0);
      setFlowRawPulses(660.0);
      setErrorMessage(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Gagal inisialisasi pulsa sensor flow: ${msg}`);
    } finally {
      setIsInitializingFlow(false);
    }
  };

  // Validation
  const selectedChannels: MixingTestChannelRequest[] = Object.entries(
    channelSelections
  )
    .filter(([_, val]) => val.selected)
    .map(([componentId, val]) => ({
      componentId,
      targetVolumeMl: Number(val.targetVolumeMl) || 0,
    }));

  // Reactive Timing Analysis Calculation
  const timingAnalysis = useMemo<MixingTimingAnalysisResult>(() => {
    const rawRate =
      rawWaterDevice && rawWaterDevice.reading !== "—" && parseFloat(rawWaterDevice.reading) > 0
        ? parseFloat(rawWaterDevice.reading) / 60.0
        : (cachedRates?.rateRawWaterPumpMlSec && cachedRates.rateRawWaterPumpMlSec > 0
            ? cachedRates.rateRawWaterPumpMlSec
            : 147.33);

    const pulses =
      (flowRawPulses && flowRawPulses > 0)
        ? flowRawPulses
        : (cachedRates?.flowRawPulsesPerL && cachedRates.flowRawPulsesPerL > 0
            ? cachedRates.flowRawPulsesPerL
            : 666.22);

    const activeChannels = dosingPumps
      .filter((d) => {
        const compId = d.id.replace("dev-", "");
        return channelSelections[compId]?.selected;
      })
      .map((d) => {
        const compId = d.id.replace("dev-", "");
        const isCalibrated = d.reading !== "—" && parseFloat(d.reading) > 0;
        let rateMlSec = 0;
        if (isCalibrated) {
          rateMlSec = parseFloat(d.reading) / 60.0;
        } else if (cachedRates?.dosingRates?.[compId] && cachedRates.dosingRates[compId] > 0) {
          rateMlSec = cachedRates.dosingRates[compId];
        } else {
          rateMlSec = compId.endsWith("_b") ? 1.75 : 1.67;
        }

        return {
          componentId: compId,
          name: d.name,
          targetVolumeMl: Number(channelSelections[compId]?.targetVolumeMl) || 0,
          rateMlSec,
          isCalibrated,
        };
      });

    return calculateMixingTimingAnalysis({
      rawWaterTargetMl: Number(rawWaterTargetMl) || 0,
      rawWaterRateMlSec: rawRate,
      flowPulsesPerL: pulses,
      thresholdPercent: Number(thresholdPercent) || 0,
      postMixDurationSec: Number(postMixDurationSec) || 0,
      channels: activeChannels,
    });
  }, [
    rawWaterTargetMl,
    thresholdPercent,
    postMixDurationSec,
    channelSelections,
    dosingPumps,
    rawWaterDevice,
    flowRawPulses,
    cachedRates,
  ]);

  const hasInvalidVolume = selectedChannels.some((ch) => ch.targetVolumeMl <= 0);
  const isFlowReady = rawWaterTargetMl <= 0 || flowRawPulses === null || flowRawPulses > 0;
  const isConfigValid =
    rawWaterTargetMl > 0 &&
    thresholdPercent >= 0 &&
    thresholdPercent <= 100 &&
    postMixDurationSec >= 0 &&
    !hasInvalidVolume &&
    isFlowReady;

  const handleStartTest = async () => {
    setErrorMessage(null);
    setStartTimeMs(Date.now());
    setElapsedSec(0);
    setStep("RUNNING");

    const payload: MixingTestRequest = {
      rawWaterTargetMl: Number(rawWaterTargetMl),
      thresholdPercent: Number(thresholdPercent),
      postMixDurationSec: Number(postMixDurationSec),
      channels: selectedChannels,
    };

    try {
      const initialStatus = await calibrationService.startMixingTest(payload);
      setStatus(initialStatus);

      // Start polling for test progress
      pollTimerRef.current = setInterval(async () => {
        try {
          const live = await calibrationService.getMixingTestStatus();
          setStatus(live);

          if (live.status === "SUCCESS" || live.status === "ERROR") {
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setStep("RESULT");
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("Failed to poll mixing test status:", msg);
        }
      }, 750);
    } catch (err: unknown) {
      const errObj = err as { message?: string; code?: string };
      const msg = errObj?.message || "Failed to start mixing & dosing test";
      if (msg.includes("busy") || errObj?.code === "MIXING_BUSY") {
        setErrorMessage("Mixing system is currently busy. Please wait for current job to finish.");
      } else {
        setErrorMessage(msg);
      }
      setStartTimeMs(null);
      setStep("CONFIG");
    }
  };

  const handleStopTest = async () => {
    setStopping(true);
    try {
      const stopped = await calibrationService.stopMixingTest();
      setStatus(stopped);
    } catch (err: unknown) {
      console.warn("Failed to stop mixing test:", err);
    } finally {
      setStopping(false);
      setStartTimeMs(null);
    }
  };

  const handleResumeTest = async () => {
    setRecovering(true);
    setErrorMessage(null);
    try {
      const res = await calibrationService.resumeMixingTest();
      setStatus(res);
      setStartTimeMs(Date.now() - (res.totalRuntimeMs || 0));
      setStep("RUNNING");

      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
      pollTimerRef.current = setInterval(async () => {
        try {
          const live = await calibrationService.getMixingTestStatus();
          setStatus(live);
          if (live.status === "SUCCESS" || live.status === "ERROR") {
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setStep("RESULT");
          }
        } catch (err: unknown) {
          console.error("Failed to poll mixing test status:", err);
        }
      }, 750);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Gagal melanjutkan test mixing: ${msg}`);
    } finally {
      setRecovering(false);
    }
  };

  const handleDiscardTest = async () => {
    setDiscarding(true);
    setErrorMessage(null);
    try {
      const res = await calibrationService.discardMixingTest();
      setStatus(res);
      setStep("CONFIG");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Gagal membatalkan test mixing: ${msg}`);
    } finally {
      setDiscarding(false);
    }
  };

  const formatPhase = (phaseStr?: string) => {
    switch (phaseStr) {
      case "RAW_WATER_FILL":
        return "Raw Water Filling";
      case "THRESHOLD_REACHED":
        return "Threshold Reached";
      case "MIXING_AND_DOSING":
        return "Mixing + Dosing";
      case "RAW_WATER_COMPLETE":
        return "Raw Water Complete";
      case "DOSING_COMPLETION":
        return "Dosing Completion";
      case "POST_MIX":
        return "Post Mixing";
      case "STOP":
        return "Stopping";
      case "SUCCESS":
        return "Success";
      case "ERROR":
        return "Error";
      default:
        return phaseStr || "Initializing";
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (step !== "RUNNING") onClose();
      }}
      title={
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-emerald-600" />
          <span>Test Mixing & Dosing (Hardware)</span>
        </div>
      }
      width={780}
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {step === "RUNNING" && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                Hardware Test Running ({formatMinutesSeconds(elapsedSec)})...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === "CONFIG" && (
              <>
                <Button variant="secondary" onClick={onClose}>
                  Batal
                </Button>
                <Button
                  variant="primary"
                  disabled={!isConfigValid || !isOnline}
                  onClick={() => setStep("CONFIRM")}
                >
                  Lanjut ke Konfirmasi
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </>
            )}
            {step === "CONFIRM" && (
              <>
                <Button variant="secondary" onClick={() => setStep("CONFIG")}>
                  Kembali
                </Button>
                <Button
                  variant="danger"
                  disabled={!isOnline}
                  onClick={handleStartTest}
                >
                  <Play className="mr-1.5 h-4 w-4 fill-current" />
                  Test Now
                </Button>
              </>
            )}
            {step === "RUNNING" && (
              <Button
                variant="danger"
                disabled={stopping}
                onClick={handleStopTest}
              >
                {stopping ? (
                  <>
                    <RefreshCcw className="mr-1.5 h-4 w-4 animate-spin" />
                    Menghentikan...
                  </>
                ) : (
                  <>
                    <Square className="mr-1.5 h-4 w-4 fill-current" />
                    STOP TEST
                  </>
                )}
              </Button>
            )}
            {step === "RESULT" && (
              <Button variant="secondary" onClick={onClose}>
                Tutup
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5 max-h-[78vh] overflow-y-auto scroll-thin pr-1">
        {/* Offline Warning */}
        {!isOnline && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Device is offline.</p>
              <p className="text-xs text-red-700 mt-0.5">
                Mixing test cannot be started while ESP32 is offline.
              </p>
            </div>
          </div>
        )}

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Peringatan Eksekusi</p>
              <p className="text-xs text-amber-800 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Recovery Hold Alert Banner (Power Loss Interruption) */}
        {(status?.recoveryRequired || status?.status === "RECOVERY_HOLD") && (
          <div className="rounded-2xl border-2 border-amber-500/60 bg-gradient-to-br from-amber-950/40 via-slate-900 to-amber-900/20 p-5 shadow-lg space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
                <Zap className="h-5 w-5 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-amber-200">
                    Interupsi Daya Terdeteksi (Power Cut Safe Recovery)
                  </h3>
                  <Badge tone="amber" className="text-[10px] uppercase font-bold tracking-wider">
                    Aktuator OFF & Aman
                  </Badge>
                </div>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Sistem mendeteksi test mixing sebelumnya terhenti tiba-tiba karena pemadaman listrik.
                  Data checkpoint tersimpan di MicroSD/SPIFFS. Anda dapat melanjutkan sisa dosis pupuk dan volume air secara presisi tanpa takaran ganda, atau membatalkan sesi pengujian ini.
                </p>
              </div>
            </div>

            {status.recoveryPool && (
              <div className="rounded-xl border border-amber-500/30 bg-black/40 p-3.5 space-y-3 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-300">
                  <div className="rounded-lg bg-slate-900/80 p-2 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Fase Terhenti:</span>
                    <span className="font-semibold text-amber-300 font-mono">
                      {formatPhase(status.recoveryPool.currentPhase)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-900/80 p-2 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Air Baku Tersisa:</span>
                    <span className="font-semibold text-sky-300 font-mono">
                      {status.recoveryPool.remainingRawWaterMl?.toLocaleString() ?? 0} ml
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      (dari {status.recoveryPool.targetRawWaterMl?.toLocaleString() ?? 0} ml)
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-900/80 p-2 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Ambang Dosing:</span>
                    <span className="font-semibold text-slate-200 font-mono">
                      {status.recoveryPool.thresholdPercent}%
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      {status.recoveryPool.thresholdReached ? "✓ Tercapai" : "Belum tercapai"}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-900/80 p-2 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Pengadukan Akhir:</span>
                    <span className="font-semibold text-slate-200 font-mono">
                      {status.recoveryPool.postMixDurationSec}s
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      (Selesai: {Math.round((status.recoveryPool.postMixElapsedMs || 0) / 1000)}s)
                    </span>
                  </div>
                </div>

                {status.recoveryPool.channels && status.recoveryPool.channels.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-slate-300 block">
                      Sisa Injeksi Pompa Nutrisi (Dosing Remainder):
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {status.recoveryPool.channels.map((ch) => {
                        const dev = devices.find((d) => d.id === `dev-${ch.componentId}`);
                        const name = dev?.name || ch.componentId.toUpperCase();
                        const remSec = (ch.remainingRuntimeMs / 1000).toFixed(1);
                        return (
                          <div
                            key={ch.componentId}
                            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
                          >
                            <span className="font-medium text-slate-200">{name}</span>
                            <div className="text-right">
                              {ch.completed ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                                  <CheckCircle2 className="h-3 w-3" /> Selesai
                                </span>
                              ) : (
                                <span className="text-[11px] font-mono text-amber-300">
                                  Sisa: {remSec}s ({ch.remainingRuntimeMs}ms)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
              <Button
                variant="danger"
                disabled={recovering || discarding}
                onClick={handleDiscardTest}
                className="text-xs"
              >
                {discarding ? (
                  <>
                    <RefreshCcw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Membatalkan...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Batalkan & Hapus Checkpoint
                  </>
                )}
              </Button>
              <Button
                variant="primary"
                disabled={recovering || discarding || !isOnline}
                onClick={handleResumeTest}
                className="bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold"
              >
                {recovering ? (
                  <>
                    <RefreshCcw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Melanjutkan...
                  </>
                ) : (
                  <>
                    <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
                    Lanjutkan Sisa Test (Resume)
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 1: CONFIGURATION */}
        {step === "CONFIG" && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Parameter Air Baku & Pengadukan
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="rawWaterTarget">Target Air Baku (ml)</Label>
                  <Input
                    id="rawWaterTarget"
                    type="number"
                    min={100}
                    step={1000}
                    value={rawWaterTargetMl}
                    onChange={(e) => setRawWaterTargetMl(Number(e.target.value))}
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Target: {(rawWaterTargetMl / 1000).toFixed(1)} L (
                    {timingAnalysis.rawWaterPulses.toLocaleString()} pulsa)
                  </p>
                </div>
                <div>
                  <Label htmlFor="thresholdPercent">Threshold Dosing (%)</Label>
                  <Input
                    id="thresholdPercent"
                    type="number"
                    min={0}
                    max={100}
                    value={thresholdPercent}
                    onChange={(e) => setThresholdPercent(Number(e.target.value))}
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Aktif di {timingAnalysis.thresholdVolumeMl.toLocaleString()} ml (~
                    {timingAnalysis.thresholdReachedTimeSec.toFixed(1)}s)
                  </p>
                </div>
                <div>
                  <Label htmlFor="postMixSec">Post Mix (detik)</Label>
                  <Input
                    id="postMixSec"
                    type="number"
                    min={0}
                    value={postMixDurationSec}
                    onChange={(e) => setPostMixDurationSec(Number(e.target.value))}
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">Agitasi pasca-isi & dosing</p>
                </div>
              </div>

              {/* Flow Sensor Calibration Status */}
              <div className="pt-2 border-t border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  {flowRawPulses !== null && flowRawPulses > 0 ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span className="text-slate-700">
                        Sensor Flow Air Baku (ZJ-B1):{" "}
                        <strong className="text-emerald-700 font-semibold">
                          {flowRawPulses.toFixed(2)} pulsa/L
                        </strong>{" "}
                        (Terkalibrasi Aktif)
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-amber-800 font-medium">
                        Sensor Flow Air Baku (ZJ-B1) belum terkalibrasi pulsa (&le; 0).
                      </span>
                    </>
                  )}
                </div>
                {(!flowRawPulses || flowRawPulses <= 0) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isInitializingFlow || !isOnline}
                    onClick={handleInitFlowPulse}
                    className="h-7 text-xs border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100"
                  >
                    {isInitializingFlow ? (
                      <>
                        <RefreshCcw className="mr-1 h-3 w-3 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      "Inisialisasi Pulsa ZJ-B1 (660 pulsa/L)"
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Dosing Pumps List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Kanal Pompa Dosing (Hardware Dynamic)
                </h4>
                <span className="text-xs text-slate-400">
                  {dosingPumps.length} Pompa Terdeteksi
                </span>
              </div>

              {dosingPumps.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                  Tidak ada hardware pompa dosing yang terdaftar pada registry.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[220px] overflow-y-auto scroll-thin pr-1">
                  {dosingPumps.map((d) => {
                    const compId = d.id.replace("dev-", "");
                    const isCalibrated =
                      d.reading !== "—" && parseFloat(d.reading) > 0;
                    const rateMlSec = isCalibrated
                      ? parseFloat(d.reading) / 60.0
                      : (cachedRates?.dosingRates?.[compId] ?? (compId.endsWith("_b") ? 1.75 : 1.67));
                    const channelState = channelSelections[compId] || {
                      selected: false,
                      targetVolumeMl: 200,
                    };

                    return (
                      <div
                        key={d.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                          !isCalibrated
                            ? "border-slate-200 bg-slate-50/50 opacity-60"
                            : channelState.selected
                            ? "border-emerald-300 bg-emerald-50/30"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            id={`chk-${compId}`}
                            disabled={!isCalibrated}
                            checked={channelState.selected}
                            onChange={(e) => {
                              setChannelSelections((prev) => ({
                                ...prev,
                                [compId]: {
                                  ...prev[compId],
                                  selected: e.target.checked,
                                },
                              }));
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <div className="min-w-0">
                            <label
                              htmlFor={`chk-${compId}`}
                              className="block text-sm font-semibold text-slate-800 cursor-pointer truncate"
                            >
                              {d.name} ({compId})
                            </label>
                            <div className="flex items-center gap-2 mt-0.5">
                              {isCalibrated ? (
                                <span className="inline-flex items-center text-[11px] font-medium text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded">
                                  CALIBRATED • {rateMlSec.toFixed(2)} ml/s ({(rateMlSec * 60).toFixed(0)} ml/min)
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[11px] font-medium text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded">
                                  NOT CALIBRATED
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="w-32 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={1}
                              disabled={!isCalibrated || !channelState.selected}
                              value={channelState.targetVolumeMl}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setChannelSelections((prev) => ({
                                  ...prev,
                                  [compId]: {
                                    ...prev[compId],
                                    targetVolumeMl: val,
                                  },
                                }));
                              }}
                              className="h-8 text-right text-xs"
                            />
                            <span className="text-xs text-slate-500">ml</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* LIVE TIMING ANALYSIS CARD */}
            <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-white p-4 sm:p-5 shadow-sm space-y-4">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/70 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-emerald-100/80 text-emerald-700">
                    <Timer className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">
                      Analisis Potensi & Estimasi Waktu Siklus (Hardware)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Dihitung real-time dari kalibrasi aktif ESP32 &amp; urutan state machine <code className="font-mono text-emerald-700 font-semibold">protocol_mixing()</code>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
                    <Zap className="h-3 w-3" />
                    Live Hardware Calculation
                  </span>
                </div>
              </div>

              {/* Metric Hero Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Card 1: Waktu Teoretis */}
                <div className="rounded-xl border border-blue-200/70 bg-gradient-to-br from-blue-50/70 to-white p-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-blue-700 uppercase tracking-wider">
                    <span>Potensi Teoretis</span>
                    <Clock className="h-3.5 w-3.5 text-blue-500" />
                  </div>
                  <div className="text-xl font-extrabold text-blue-950">
                    {formatMinutesSeconds(timingAnalysis.totalTheoreticalTimeSec)}
                  </div>
                  <div className="text-[11px] text-blue-700 font-medium">
                    {timingAnalysis.totalTheoreticalTimeSec.toFixed(1)} detik siklus penuh
                  </div>
                </div>

                {/* Card 2: Rentang Waktu Nyata (Real-World) */}
                <div className="rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/70 to-white p-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
                    <span>Rentang Nyata (Real)</span>
                    <Activity className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <div className="text-xl font-extrabold text-emerald-950">
                    {formatMinutesSeconds(timingAnalysis.totalRealMinTimeSec)} – {formatMinutesSeconds(timingAnalysis.totalRealMaxTimeSec)}
                  </div>
                  <div className="text-[11px] text-emerald-700 font-medium">
                    ~{timingAnalysis.totalRealMinTimeSec.toFixed(0)}s s/d {timingAnalysis.totalRealMaxTimeSec.toFixed(0)}s (±2–5% hidrolik)
                  </div>
                </div>

                {/* Card 3: Target Pulsa Sensor Flow */}
                <div className="rounded-xl border border-amber-200/70 bg-gradient-to-br from-amber-50/70 to-white p-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-amber-700 uppercase tracking-wider">
                    <span>Target Pulsa Sensor</span>
                    <Gauge className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div className="text-xl font-extrabold text-amber-950">
                    {timingAnalysis.rawWaterPulses.toLocaleString()} <span className="text-xs font-normal text-amber-700">pulsa</span>
                  </div>
                  <div className="text-[11px] text-amber-700 font-medium">
                    K: {timingAnalysis.pulsesPerLiter.toFixed(1)} pulsa/L ({timingAnalysis.rawWaterTargetMl / 1000} L)
                  </div>
                </div>
              </div>

              {/* Visual Execution Timeline (Gantt Chart) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5 text-slate-500" />
                    Urutan &amp; Timeline Eksekusi Multi-Aktuator
                  </span>
                  <span className="text-[11px] font-normal text-slate-500 font-mono">
                    Total Waktu: {timingAnalysis.totalTheoreticalTimeSec.toFixed(1)}s
                  </span>
                </div>

                {/* Gantt Bars Container */}
                <div className="space-y-2.5 pt-1">
                  {/* 1. Raw Water Pump Bar */}
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                      <span className="font-semibold text-sky-800">
                        1. Pompa Air Baku 12V
                      </span>
                      <span className="font-mono text-[10px]">
                        0.0s → {timingAnalysis.rawWaterPump.endTimeSec.toFixed(1)}s ({timingAnalysis.rawWaterPump.runtimeSec.toFixed(1)}s)
                      </span>
                    </div>
                    <div className="relative h-4 w-full rounded-md bg-slate-200/80 overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 bg-sky-500 rounded-md transition-all duration-300 flex items-center px-1.5 text-[9px] font-bold text-white overflow-hidden text-ellipsis whitespace-nowrap shadow-sm"
                        style={{
                          left: 0,
                          width: `${Math.min(100, (timingAnalysis.rawWaterPump.runtimeSec / Math.max(1, timingAnalysis.totalTheoreticalTimeSec)) * 100)}%`,
                        }}
                      >
                        Air Baku ({timingAnalysis.rawWaterPump.runtimeSec.toFixed(0)}s)
                      </div>
                    </div>
                  </div>

                  {/* 2. Dosing Channels Bars */}
                  {timingAnalysis.dosingChannels.map((ch, idx) => {
                    const leftPct = (ch.startTimeSec / Math.max(1, timingAnalysis.totalTheoreticalTimeSec)) * 100;
                    const widthPct = (ch.runtimeSec / Math.max(1, timingAnalysis.totalTheoreticalTimeSec)) * 100;
                    const isLongest = ch.componentId === timingAnalysis.longestDosingChannelId;
                    const colorClass = idx === 0 ? "bg-amber-500" : "bg-orange-500";

                    return (
                      <div key={ch.componentId}>
                        <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                          <span className="font-semibold text-amber-800">
                            2.{idx + 1} {ch.name} ({ch.componentId}) {isLongest && <span className="text-[10px] text-amber-700 bg-amber-100 px-1 rounded font-bold ml-1">Bottleneck</span>}
                          </span>
                          <span className="font-mono text-[10px]">
                            {ch.startTimeSec.toFixed(1)}s → {ch.endTimeSec.toFixed(1)}s ({ch.runtimeSec.toFixed(1)}s)
                          </span>
                        </div>
                        <div className="relative h-4 w-full rounded-md bg-slate-200/80 overflow-hidden">
                          <div
                            className={`absolute top-0 bottom-0 ${colorClass} rounded-md transition-all duration-300 flex items-center px-1.5 text-[9px] font-bold text-white overflow-hidden text-ellipsis whitespace-nowrap shadow-sm`}
                            style={{
                              left: `${leftPct}%`,
                              width: `${Math.max(2, Math.min(100 - leftPct, widthPct))}%`,
                            }}
                          >
                            {ch.targetMl} ml ({ch.runtimeSec.toFixed(0)}s)
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* 3. Mixing Agitation Pump Bar */}
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                      <span className="font-semibold text-emerald-800">
                        3. Pompa Pengaduk (Mixing Pump)
                      </span>
                      <span className="font-mono text-[10px]">
                        {timingAnalysis.mixingPump.startTimeSec.toFixed(1)}s → {timingAnalysis.mixingPump.endTimeSec.toFixed(1)}s ({timingAnalysis.mixingPump.runtimeSec.toFixed(1)}s)
                      </span>
                    </div>
                    <div className="relative h-4 w-full rounded-md bg-slate-200/80 overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 bg-emerald-600 rounded-md transition-all duration-300 flex items-center px-1.5 text-[9px] font-bold text-white overflow-hidden text-ellipsis whitespace-nowrap shadow-sm"
                        style={{
                          left: `${(timingAnalysis.mixingPump.startTimeSec / Math.max(1, timingAnalysis.totalTheoreticalTimeSec)) * 100}%`,
                          width: `${Math.max(2, (timingAnalysis.mixingPump.runtimeSec / Math.max(1, timingAnalysis.totalTheoreticalTimeSec)) * 100)}%`,
                        }}
                      >
                        Agitasi Sirkulasi ({timingAnalysis.mixingPump.runtimeSec.toFixed(0)}s)
                      </div>
                    </div>
                  </div>

                  {/* 4. Post-Mix Duration Bar */}
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                      <span className="font-semibold text-indigo-800">
                        4. Post-Mix Agitasi Akhir
                      </span>
                      <span className="font-mono text-[10px]">
                        {timingAnalysis.postMixStartTimeSec.toFixed(1)}s → {timingAnalysis.postMixEndTimeSec.toFixed(1)}s ({timingAnalysis.postMixDurationSec}s)
                      </span>
                    </div>
                    <div className="relative h-4 w-full rounded-md bg-slate-200/80 overflow-hidden">
                      <div
                        className="absolute top-0 bottom-0 bg-indigo-500 rounded-md transition-all duration-300 flex items-center px-1.5 text-[9px] font-bold text-white overflow-hidden text-ellipsis whitespace-nowrap shadow-sm"
                        style={{
                          left: `${(timingAnalysis.postMixStartTimeSec / Math.max(1, timingAnalysis.totalTheoreticalTimeSec)) * 100}%`,
                          width: `${Math.max(2, (timingAnalysis.postMixDurationSec / Math.max(1, timingAnalysis.totalTheoreticalTimeSec)) * 100)}%`,
                        }}
                      >
                        Post-Mix ({timingAnalysis.postMixDurationSec}s)
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timeline Markers */}
                <div className="relative pt-2 text-[10px] text-slate-500 border-t border-slate-200 flex justify-between font-mono">
                  <span>0.0s (Mulai)</span>
                  <span>Threshold {timingAnalysis.thresholdPercent}% (~{timingAnalysis.thresholdReachedTimeSec.toFixed(1)}s)</span>
                  <span>Air Selesai ({timingAnalysis.rawWaterPump.endTimeSec.toFixed(1)}s)</span>
                  <span>Dosing Selesai ({timingAnalysis.dosingFinishTimeSec.toFixed(1)}s)</span>
                  <span className="font-bold text-slate-800">Tuntas: {timingAnalysis.totalTheoreticalTimeSec.toFixed(1)}s</span>
                </div>
              </div>

              {/* Detailed Breakdown Table */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-100/70 px-3 py-2 text-xs font-bold text-slate-700 border-b border-slate-200 flex items-center justify-between">
                  <span>Rincian Waktu Masing-Masing Aktuator</span>
                  <span className="text-[11px] font-normal text-slate-500">Berdasarkan kalibrasi aktif ESP32</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Aktuator / Pompa</th>
                        <th className="py-2 px-3">Target</th>
                        <th className="py-2 px-3">Debit Kalibrasi</th>
                        <th className="py-2 px-3">Mulai</th>
                        <th className="py-2 px-3">Durasi</th>
                        <th className="py-2 px-3">Selesai</th>
                        <th className="py-2 px-3">Kontrol</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[11px]">
                      {/* Raw water pump */}
                      <tr className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          {timingAnalysis.rawWaterPump.name}
                        </td>
                        <td className="py-2 px-3 font-mono">
                          {timingAnalysis.rawWaterTargetMl.toLocaleString()} ml
                          <div className="text-[10px] text-slate-400">{timingAnalysis.rawWaterPulses.toLocaleString()} pulsa</div>
                        </td>
                        <td className="py-2 px-3 font-mono">
                          {timingAnalysis.rawWaterPump.rateMlSec.toFixed(2)} ml/s
                          <div className="text-[10px] text-slate-400">({(timingAnalysis.rawWaterPump.rateMlMin).toFixed(0)} ml/min)</div>
                        </td>
                        <td className="py-2 px-3 font-mono">0.0s</td>
                        <td className="py-2 px-3 font-mono font-bold text-sky-700">
                          {timingAnalysis.rawWaterPump.runtimeSec.toFixed(1)}s
                        </td>
                        <td className="py-2 px-3 font-mono">{timingAnalysis.rawWaterPump.endTimeSec.toFixed(1)}s</td>
                        <td className="py-2 px-3">
                          <span className="inline-flex text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
                            Sensor Pulsa
                          </span>
                        </td>
                      </tr>

                      {/* Dosing Channels */}
                      {timingAnalysis.dosingChannels.map((ch) => (
                        <tr key={ch.componentId} className="hover:bg-slate-50/70">
                          <td className="py-2 px-3 font-semibold text-slate-900">
                            {ch.name}
                            <div className="text-[10px] text-slate-400 font-mono">{ch.componentId}</div>
                          </td>
                          <td className="py-2 px-3 font-mono">{ch.targetMl} ml</td>
                          <td className="py-2 px-3 font-mono">
                            {ch.rateMlSec.toFixed(2)} ml/s
                            <div className="text-[10px] text-slate-400">({ch.rateMlMin.toFixed(1)} ml/min)</div>
                          </td>
                          <td className="py-2 px-3 font-mono">{ch.startTimeSec.toFixed(1)}s</td>
                          <td className="py-2 px-3 font-mono font-bold text-amber-700">
                            {ch.runtimeSec.toFixed(1)}s
                          </td>
                          <td className="py-2 px-3 font-mono">{ch.endTimeSec.toFixed(1)}s</td>
                          <td className="py-2 px-3">
                            <span className="inline-flex text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                              Timer ESP32
                            </span>
                          </td>
                        </tr>
                      ))}

                      {/* Mixing Pump */}
                      <tr className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          {timingAnalysis.mixingPump.name}
                        </td>
                        <td className="py-2 px-3 text-slate-500">Agitasi Sirkulasi</td>
                        <td className="py-2 px-3 text-slate-400 font-mono">—</td>
                        <td className="py-2 px-3 font-mono">{timingAnalysis.mixingPump.startTimeSec.toFixed(1)}s</td>
                        <td className="py-2 px-3 font-mono font-bold text-emerald-700">
                          {timingAnalysis.mixingPump.runtimeSec.toFixed(1)}s
                        </td>
                        <td className="py-2 px-3 font-mono">{timingAnalysis.mixingPump.endTimeSec.toFixed(1)}s</td>
                        <td className="py-2 px-3">
                          <span className="inline-flex text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            Agitasi Sirkulasi
                          </span>
                        </td>
                      </tr>

                      {/* Post-Mix */}
                      <tr className="hover:bg-slate-50/70 bg-indigo-50/30">
                        <td className="py-2 px-3 font-semibold text-indigo-900">
                          Post-Mix Agitasi Akhir
                        </td>
                        <td className="py-2 px-3 text-indigo-700">Homogenisasi Larutan</td>
                        <td className="py-2 px-3 text-slate-400 font-mono">—</td>
                        <td className="py-2 px-3 font-mono">{timingAnalysis.postMixStartTimeSec.toFixed(1)}s</td>
                        <td className="py-2 px-3 font-mono font-bold text-indigo-700">
                          {timingAnalysis.postMixDurationSec.toFixed(1)}s
                        </td>
                        <td className="py-2 px-3 font-mono">{timingAnalysis.postMixEndTimeSec.toFixed(1)}s</td>
                        <td className="py-2 px-3">
                          <span className="inline-flex text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                            Agitasi Akhir
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Technical Explanation Collapsible */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                <button
                  type="button"
                  onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                  className="flex w-full items-center justify-between text-xs font-semibold text-slate-700 hover:text-slate-900"
                >
                  <span className="flex items-center gap-1.5">
                    <Info className="h-4 w-4 text-blue-600" />
                    Penjelasan Teknis &amp; Analisis Rentang Waktu Nyata (Real-World Envelope)
                  </span>
                  {showTechnicalDetails ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                </button>

                {showTechnicalDetails && (
                  <div className="pt-3 mt-2 border-t border-slate-200/60 text-xs text-slate-600 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 space-y-1">
                        <strong className="text-slate-800 block">1. Sensor Pulsa Flow (ZJ-B1)</strong>
                        <p>
                          Pompa air baku berhenti berdasarkan target <strong>{timingAnalysis.rawWaterPulses.toLocaleString()} pulsa ISR</strong>, bukan timer tetap. Variasi ketinggian air tandon &amp; hambatan selang menghasilkan fluktuasi debit aktual berkisar antara 140–152 ml/s (toleransi riil ±2–4%).
                        </p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 space-y-1">
                        <strong className="text-slate-800 block">2. Timer Mikrodetik ESP32</strong>
                        <p>
                          Pompa peristaltik dosing dikendalikan dengan timer internal mikrodetik presisi mikrokontroler (<code className="font-mono text-emerald-800">esp_timer_get_time()</code>), memastikan deviasi durasi dosing &lt; 0.05 detik.
                        </p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 space-y-1">
                        <strong className="text-slate-800 block">3. Sekuens Post-Mix Firmware</strong>
                        <p>
                          Di <code className="font-mono text-emerald-800">protocol_mixing.c</code>, Post-Mix ({timingAnalysis.postMixDurationSec}s) dimulai setelah air baku tuntas DAN semua dosing selesai (<code className="font-mono text-emerald-800">!raw_water_running &amp;&amp; all_dosing_done</code>) pada detik <strong>{timingAnalysis.postMixStartTimeSec.toFixed(1)}s</strong>.
                        </p>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 space-y-1">
                        <strong className="text-slate-800 block">4. Safety Timeout Watchdog</strong>
                        <p>
                          Batas pengaman firmware ESP32 diatur 1.5x estimasi ({timingAnalysis.maxSafeTimeoutSec.toFixed(1)}s) untuk mematikan aktuator otomatis jika sensor flow macet atau air tandon habis.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: SAFETY CONFIRMATION */}
        {step === "CONFIRM" && (
          <div className="space-y-4">
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <h3 className="text-base font-bold text-amber-900">
                    WARNING: Physical Hardware Activation
                  </h3>
                  <p className="text-sm text-amber-800">
                    Uji coba ini akan secara fisik menyalakan aktuator berikut:
                  </p>
                  <ul className="list-disc list-inside text-xs font-semibold text-amber-900 space-y-1">
                    <li>Pompa Air Baku (Raw Water Pump 12V DC) — Target: {rawWaterTargetMl.toLocaleString()} ml ({timingAnalysis.rawWaterPulses.toLocaleString()} pulsa)</li>
                    <li>Pompa Pengaduk (Mixing Pump) — Durasi: ~{timingAnalysis.mixingPump.runtimeSec.toFixed(1)}s</li>
                    {selectedChannels.map((ch) => (
                      <li key={ch.componentId}>
                        Pompa Dosing: {ch.componentId} (Target: {ch.targetVolumeMl} ml)
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-amber-800 pt-1">
                    Pastikan tanki siap, saluran terbuka, sensor flow berfungsi, dan area kerja aman.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
              <div className="font-semibold text-slate-700 uppercase tracking-wide flex items-center justify-between border-b border-slate-100 pb-2">
                <span>Ringkasan Eksekusi protocol_mixing()</span>
                <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  Estimasi Total: {formatMinutesSeconds(timingAnalysis.totalTheoreticalTimeSec)} ({timingAnalysis.totalTheoreticalTimeSec.toFixed(1)}s)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-slate-600">
                <div>Target Air Baku: <span className="font-bold text-slate-800">{rawWaterTargetMl.toLocaleString()} ml</span> ({timingAnalysis.rawWaterPulses.toLocaleString()} pulsa)</div>
                <div>Threshold Dosing: <span className="font-bold text-slate-800">{thresholdPercent}%</span> (~{timingAnalysis.thresholdReachedTimeSec.toFixed(1)}s)</div>
                <div>Post-Mix Agitasi: <span className="font-bold text-slate-800">{postMixDurationSec} detik</span> (mulai detik {timingAnalysis.postMixStartTimeSec.toFixed(1)}s)</div>
                <div>Rentang Waktu Nyata: <span className="font-bold text-emerald-800">{timingAnalysis.totalRealMinTimeSec.toFixed(0)}s – {timingAnalysis.totalRealMaxTimeSec.toFixed(0)}s</span></div>
                <div>Kanal Dosing Aktif: <span className="font-bold text-slate-800">{selectedChannels.length} kanal</span></div>
                <div>Dosing Terpanjang: <span className="font-bold text-amber-800">{timingAnalysis.longestDosingDurationSec.toFixed(1)}s</span> ({timingAnalysis.longestDosingChannelId})</div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: RUNNING MONITOR */}
        {step === "RUNNING" && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                    Fase Eksekusi
                  </span>
                  <h3 className="text-lg font-bold text-slate-900 mt-0.5">
                    {formatPhase(status?.phase)}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="blue" className="animate-pulse">
                    {status?.status || "RUNNING"}
                  </Badge>
                </div>
              </div>

              {/* Elapsed Time vs Estimated Total */}
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 bg-white/80 p-2.5 rounded-xl border border-blue-100">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span>Waktu Berjalan: <span className="font-mono text-blue-900 font-bold">{formatMinutesSeconds(elapsedSec)}</span> ({elapsedSec}s)</span>
                </div>
                <div className="text-slate-500">
                  Estimasi Selesai: <span className="font-mono text-slate-800 font-bold">~{formatMinutesSeconds(timingAnalysis.totalTheoreticalTimeSec)}</span>
                  <span className="text-[11px] text-slate-400 ml-1">({timingAnalysis.totalTheoreticalTimeSec.toFixed(0)}s)</span>
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600 mb-1.5">
                  <span>Air Baku: {(status?.rawWaterActualMl ?? 0).toLocaleString()} ml</span>
                  <span>Target: {(status?.rawWaterTargetMl ?? rawWaterTargetMl).toLocaleString()} ml</span>
                </div>
                <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        ((status?.rawWaterActualMl ?? 0) /
                          Math.max(1, status?.rawWaterTargetMl ?? rawWaterTargetMl)) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Dosing Channels Live Monitor */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Status Pompa Dosing Paralel
              </h4>
              <div className="space-y-2">
                {(status?.channels ?? []).map((ch) => (
                  <div
                    key={ch.componentId}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm"
                  >
                    <div>
                      <span className="font-bold text-slate-800">{ch.componentId}</span>
                      <div className="text-xs text-slate-500">
                        Target: {ch.targetVolumeMl} ml • Rate: {ch.calibrationRateMlSec.toFixed(2)} ml/s
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-slate-600">
                        {((ch.actualRuntimeMs ?? 0) / 1000).toFixed(1)}s
                      </span>
                      {ch.completed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                          <CheckCircle2 className="h-3.5 w-3.5" /> COMPLETE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md animate-pulse">
                          <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> RUNNING
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: TERMINAL RESULT */}
        {step === "RESULT" && (
          <div className="space-y-4">
            {status?.status === "SUCCESS" ? (
              <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50/70 p-5 text-center space-y-2">
                <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
                <h3 className="text-lg font-bold text-emerald-900">
                  Uji Coba Berhasil (SUCCESS)
                </h3>
                <p className="text-xs text-emerald-800">
                  {status.message || "Protokol mixing & dosing selesai dengan aman dan terverifikasi."}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-red-500 bg-red-50/70 p-5 text-center space-y-2">
                <XCircle className="h-10 w-10 text-red-600 mx-auto" />
                <h3 className="text-lg font-bold text-red-900">
                  Uji Coba Gagal (ERROR)
                </h3>
                <p className="text-xs text-red-800 font-mono">
                  {status?.errorCode ? `[${status.errorCode}] ` : ""}
                  {status?.message || "Terjadi kegagalan selama protokol mixing."}
                </p>
                <div className="text-[11px] text-red-600">
                  Fase: {formatPhase(status?.phase)}
                </div>
                {status?.errorCode === "MIXING_CALIBRATION_MISSING" && (
                  <div className="pt-2 flex justify-center">
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      disabled={isInitializingFlow || !isOnline}
                      onClick={async () => {
                        await handleInitFlowPulse();
                        setStep("CONFIG");
                      }}
                      className="bg-red-600 hover:bg-red-700 text-white shadow"
                    >
                      {isInitializingFlow ? (
                        <>
                          <RefreshCcw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Menginisialisasi Pulsa...
                        </>
                      ) : (
                        "Inisialisasi Pulsa (660 pulsa/L) & Ulangi"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Metrics Breakdown */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Rincian Metrik Hardware
              </h4>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-700">
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <span className="text-slate-400 block text-[11px]">Air Baku Tercapai</span>
                  <span className="font-bold text-slate-900">
                    {(status?.rawWaterActualMl ?? 0).toLocaleString()} ml
                  </span>
                  <span className="text-slate-500 text-[11px]"> / {(status?.rawWaterTargetMl ?? 0).toLocaleString()} ml</span>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <span className="text-slate-400 block text-[11px]">Durasi Total</span>
                  <span className="font-bold text-slate-900">
                    {(((status?.totalRuntimeMs ?? 0) / 1000)).toFixed(1)} detik
                  </span>
                </div>
              </div>

              {/* Dosing breakdown */}
              {status?.channels && status.channels.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block uppercase">
                    Hasil Kanal Dosing
                  </span>
                  {status.channels.map((ch) => (
                    <div
                      key={ch.componentId}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-50"
                    >
                      <span className="font-semibold text-slate-800">{ch.componentId}</span>
                      <span className="text-slate-600">
                        {ch.targetVolumeMl} ml ({((ch.actualRuntimeMs ?? 0) / 1000).toFixed(1)}s) •{" "}
                        <span className={ch.completed ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>
                          {ch.completed ? "OK" : "INCOMPLETE"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
