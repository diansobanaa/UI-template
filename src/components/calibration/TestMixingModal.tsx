"use client";

import { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { Modal } from "@/components/ui/overlay";
import { Button, Input, Label, Badge } from "@/components/ui/primitives";
import { calibrationService } from "@/lib/services";
import type { CalibrationDevice } from "@/lib/types";
import type {
  MixingTestRequest,
  MixingTestStatus,
  MixingTestChannelRequest,
} from "@/lib/api/contracts";

interface TestMixingModalProps {
  open: boolean;
  onClose: () => void;
  devices: CalibrationDevice[];
  isOnline: boolean;
}

type ModalStep = "CONFIG" | "CONFIRM" | "RUNNING" | "RESULT";

export function TestMixingModal({
  open,
  onClose,
  devices,
  isOnline,
}: TestMixingModalProps) {
  // Step state
  const [step, setStep] = useState<ModalStep>("CONFIG");

  // Form parameters
  const [rawWaterTargetMl, setRawWaterTargetMl] = useState<number>(5000);
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
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Flow meter calibration state
  const [flowRawPulses, setFlowRawPulses] = useState<number | null>(null);
  const [isInitializingFlow, setIsInitializingFlow] = useState<boolean>(false);

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
      return;
    }

    let isSubscribed = true;
    calibrationService
      .getRates()
      .then((rates) => {
        if (isSubscribed && rates) {
          setFlowRawPulses(rates.flowRawPulsesPerL ?? null);
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
        targetVolumeMl: 50,
      };
    });
    setChannelSelections(initSelections);

    return () => {
      isSubscribed = false;
    };
  }, [open, devices]);

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
      width={680}
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {step === "RUNNING" && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
                Hardware Test Running...
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
      <div className="space-y-5">
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
                    step={100}
                    value={rawWaterTargetMl}
                    onChange={(e) => setRawWaterTargetMl(Number(e.target.value))}
                    className="mt-1"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">Target isi tanki</p>
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
                  <p className="mt-1 text-[11px] text-slate-400">Pemicu mulai dosing</p>
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
                  <p className="mt-1 text-[11px] text-slate-400">Agitasi pasca-isi</p>
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
                          {flowRawPulses} pulsa/L
                        </strong>{" "}
                        (Terkalibrasi)
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
                <div className="space-y-2.5 max-h-[260px] overflow-y-auto scroll-thin pr-1">
                  {dosingPumps.map((d) => {
                    const compId = d.id.replace("dev-", "");
                    const isCalibrated =
                      d.reading !== "—" && parseFloat(d.reading) > 0;
                    const rateMlSec = isCalibrated
                      ? parseFloat(d.reading) / 60.0
                      : 0;
                    const channelState = channelSelections[compId] || {
                      selected: false,
                      targetVolumeMl: 50,
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
                                  CALIBRATED • {rateMlSec.toFixed(2)} ml/s
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
                    <li>Pompa Air Baku (Raw Water Pump 12V DC)</li>
                    <li>Pompa Pengaduk (Mixing Pump)</li>
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

            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 text-xs">
              <div className="font-semibold text-slate-700 uppercase tracking-wide">
                Ringkasan Eksekusi protocol_mixing()
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-600">
                <div>Target Air Baku: <span className="font-bold text-slate-800">{rawWaterTargetMl} ml</span></div>
                <div>Threshold Mulai: <span className="font-bold text-slate-800">{thresholdPercent}%</span></div>
                <div>Post-Mix Agitasi: <span className="font-bold text-slate-800">{postMixDurationSec} detik</span></div>
                <div>Total Kanal Dosing: <span className="font-bold text-slate-800">{selectedChannels.length} kanal</span></div>
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
                <Badge tone="blue" className="animate-pulse">
                  {status?.status || "RUNNING"}
                </Badge>
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
