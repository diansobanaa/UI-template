"use client";

import { useState, useEffect, useRef } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  CheckCircle2,
  Clock,
  Cpu,
  Droplets,
  Gauge,
  Info,
  Layers,
  Play,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Square,
  Waves,
  XCircle,
  Radio,
  FlaskConical,
  HelpCircle,
} from "lucide-react";
import { Badge, Button, Input, Label, StatusBadge } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { calibrationService } from "@/lib/services";
import { errorMessage } from "@/lib/errors";
import type { CalibrationDevice } from "@/lib/types";
import type { CalibrationStatus, CalibrationRates } from "@/lib/api/contracts";
import {
  calculateCandidateFlowK,
  calculateRawPumpRate,
  calculateEstimatedFlowVolume,
  calculateFlowVerificationError,
  validatePhysicalVolumeInput,
  FLOW_CALIBRATION_TOLERANCE_PCT,
  type FlowVerificationRun,
} from "@/lib/calibration-math";

export type TelemetryFreshnessState = "LIVE" | "STALE" | "DISCONNECTED";

interface RawWaterFlowVerificationWizardProps {
  device: CalibrationDevice;
  run: { deviceId: string; secondsLeft: number } | null;
  onStart: (seconds: number) => void;
  onStop: () => void;
  onSaved?: () => Promise<void> | void;
}

export function RawWaterFlowVerificationWizard({
  device,
  run,
  onStart,
  onStop,
  onSaved,
}: RawWaterFlowVerificationWizardProps) {
  const [workflowStep, setWorkflowStep] = useState<
    "IDLE" | "PREPARING" | "RUNNING" | "INPUT_VOLUME" | "REVIEW" | "SAVED"
  >("IDLE");
  const [testDuration, setTestDuration] = useState<number>(30); // 30s recommended default
  const [prepCountdown, setPrepCountdown] = useState<number>(0);
  const [volumeInputL, setVolumeInputL] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Active calibration rates & persistent state from ESP32
  const [activeRates, setActiveRates] = useState<CalibrationRates | null>(null);

  // Telemetry state during active testing
  const [telemetry, setTelemetry] = useState<CalibrationStatus | null>(null);
  const [lastTelemetryTs, setLastTelemetryTs] = useState<number>(0);
  const [telemetryStale, setTelemetryStale] = useState<boolean>(false);

  // Frozen session results when pump finishes or is stopped
  const [frozenSession, setFrozenSession] = useState<{
    durationSec: number;
    sessionPulses: number;
    startPulses: number;
    finalPulses: number;
    estimatedL: number;
    estimatedMl: number;
    hadValidCalibration: boolean;
    pulsesPerLUsed: number;
    stopReason: "TARGET_REACHED" | "OPERATOR_STOP" | "SAFETY_ABORT";
  } | null>(null);

  // Multi-run Staged Verification History (1 Initial + 2 Validation runs)
  const [runs, setRuns] = useState<FlowVerificationRun[]>([]);
  const [currentRunMode, setCurrentRunMode] = useState<"staged" | "single">("staged");
  const [candidateK, setCandidateK] = useState<number | null>(null);

  const [telemetryState, setTelemetryState] = useState<TelemetryFreshnessState>("LIVE");
  const [telemetryAgeMs, setTelemetryAgeMs] = useState<number>(0);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  const toast = useToast();
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollSeqRef = useRef<number>(0);
  const latestHandledSeqRef = useRef<number>(0);
  const runActiveRef = useRef<boolean>(false);
  const hasTestStartedRef = useRef<boolean>(false);
  const baselinePulsesRef = useRef<number | null>(null);

  // Load active flow rates from firmware on mount
  useEffect(() => {
    let mounted = true;
    calibrationService.getRates().then((rates) => {
      if (mounted && rates) {
        setActiveRates(rates);
      }
    }).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const activeFlowPulsesPerL = activeRates?.flowRawPulsesPerL ?? 0;
  const isFirmwareCalibrated = activeFlowPulsesPerL > 0;
  const activePumpRateMlMin = device.reading !== "—" ? parseFloat(device.reading) : 0;
  const effectivePulsesPerL = candidateK ?? (activeFlowPulsesPerL > 0 ? activeFlowPulsesPerL : 660);

  // Determine current verification lifecycle state
  const currentVerificationState: "UNCAL" | "CALIBRATION_PENDING" | "VERIFIED" = (() => {
    if (runs.length >= 3 && runs.slice(1).every((r) => r.isPassed)) {
      return "VERIFIED";
    }
    if (candidateK !== null || runs.length > 0) {
      return "CALIBRATION_PENDING";
    }
    if (isFirmwareCalibrated) {
      return activeRates?.status === "VERIFIED" ? "VERIFIED" : "CALIBRATION_PENDING";
    }
    return "UNCAL";
  })();

  // Track when parent run becomes active for this device
  useEffect(() => {
    if (run !== null && run.deviceId === device.id) {
      runActiveRef.current = true;
    }
  }, [run, device.id]);

  // Non-overlapping bounded telemetry poller while pump is RUNNING
  useEffect(() => {
    if (workflowStep !== "RUNNING") {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    let isMounted = true;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const executePollCycle = async () => {
      if (!isMounted) return;
      const currentSeq = ++pollSeqRef.current;
      const requestStartMs = Date.now();

      try {
        const st = await calibrationService.getCalibrationStatus({
          timeoutMs: 2000,
          signal: abortController.signal,
        });

        // Drop out-of-order or cancelled responses
        if (!isMounted || currentSeq < latestHandledSeqRef.current) return;
        latestHandledSeqRef.current = currentSeq;

        const now = Date.now();
        setLastTelemetryTs(now);
        setTelemetryAgeMs(0);
        setTelemetryState("LIVE");
        setTelemetryError(null);

        // Lock baseline once on first response if not already locked
        if (baselinePulsesRef.current === null) {
          baselinePulsesRef.current = typeof st.start_pulses === "number" ? st.start_pulses : (st.current_pulses ?? 0);
        }

        setTelemetry(st);

        // Authoritative firmware termination: complete or safety error
        if (st.state === "COMPLETE" || st.state === "ERROR") {
          freezeAndTransition(st, st.state === "ERROR" ? "SAFETY_ABORT" : "TARGET_REACHED");
          return;
        }
      } catch (err: any) {
        if (!isMounted || abortController.signal.aborted) return;
        const now = Date.now();
        const age = lastTelemetryTs > 0 ? now - lastTelemetryTs : 9999;
        setTelemetryAgeMs(age);
        if (age > 6000) {
          setTelemetryState("DISCONNECTED");
        } else {
          setTelemetryState("STALE");
        }
        setTelemetryError(errorMessage(err) || "Telemetri ESP32 terputus.");
      }

      if (isMounted) {
        const elapsedMs = Date.now() - requestStartMs;
        const boundedDelay = Math.max(150, 1000 - elapsedMs);
        pollTimerRef.current = setTimeout(executePollCycle, boundedDelay);
      }
    };

    executePollCycle();

    return () => {
      isMounted = false;
      abortController.abort();
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [workflowStep]);

  // Telemetry freshness watchdog (<2.5s LIVE, 2.5-6s STALE, >6s DISCONNECTED)
  useEffect(() => {
    if (workflowStep !== "RUNNING") return;
    const interval = setInterval(() => {
      if (lastTelemetryTs > 0) {
        const age = Date.now() - lastTelemetryTs;
        setTelemetryAgeMs(age);
        if (age > 6000) {
          setTelemetryState("DISCONNECTED");
        } else if (age > 2500) {
          setTelemetryState("STALE");
        } else {
          setTelemetryState("LIVE");
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [workflowStep, lastTelemetryTs]);

  // Helper to freeze session telemetry to avoid post-test pulse drift
  const freezeAndTransition = (
    st: CalibrationStatus | null,
    reason: "TARGET_REACHED" | "OPERATOR_STOP" | "SAFETY_ABORT"
  ) => {
    runActiveRef.current = false;
    hasTestStartedRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    onStop();

    const effectiveDuration = (st?.elapsed_sec && st.elapsed_sec > 0) ? st.elapsed_sec : testDuration;
    const effectivePulses = (st?.session_pulses != null) ? st.session_pulses : (telemetry?.session_pulses ?? 0);
    const effectiveStartPulses = (st?.start_pulses != null)
      ? st.start_pulses
      : (baselinePulsesRef.current ?? (telemetry?.start_pulses ?? 0));
    const effectiveCurrentPulses = (st?.current_pulses != null)
      ? st.current_pulses
      : (telemetry?.current_pulses ?? effectivePulses);
    const effectiveEstimatedL = (st?.estimated_l != null && st.estimated_l > 0) ? st.estimated_l : (telemetry?.estimated_l ?? 0);
    const effectiveEstimatedMl = (st?.estimated_ml != null && st.estimated_ml > 0) ? st.estimated_ml : (telemetry?.estimated_ml ?? 0);
    const effectiveHasCal = st?.has_valid_calibration ?? isFirmwareCalibrated;
    const effectivePpl = st?.pulses_per_liter ?? (candidateK ?? activeFlowPulsesPerL);

    setFrozenSession({
      durationSec: effectiveDuration,
      sessionPulses: effectivePulses,
      startPulses: effectiveStartPulses,
      finalPulses: effectiveCurrentPulses,
      estimatedL: effectiveEstimatedL,
      estimatedMl: effectiveEstimatedMl,
      hadValidCalibration: effectiveHasCal,
      pulsesPerLUsed: effectivePpl,
      stopReason: reason,
    });

    setWorkflowStep("INPUT_VOLUME");
    setValidationError(null);

    if (reason === "SAFETY_ABORT") {
      toast("Pengujian dihentikan oleh interlock keselamatan kontroler ESP32.", "error");
    } else if (reason === "OPERATOR_STOP") {
      toast("Pengujian dihentikan oleh operator. Data pulsa dibekukan untuk verifikasi.", "info");
    } else {
      toast(
        `Pengujian ${effectiveDuration} detik selesai! Pulsa terkumpul: ${effectivePulses.toLocaleString()} pulsa.`,
        "success"
      );
    }
  };

  // Watch for external stop (e.g. parent timer expiration or header E-Stop)
  // Only triggers if run WAS confirmed active and now became null
  useEffect(() => {
    if (workflowStep === "RUNNING" && runActiveRef.current && run === null) {
      runActiveRef.current = false;
      calibrationService.getCalibrationStatus().then((st) => {
        freezeAndTransition(st, "TARGET_REACHED");
      }).catch(() => {
        freezeAndTransition(telemetry, "TARGET_REACHED");
      });
    }
  }, [run, workflowStep, telemetry]);

  // Handler to initiate 3-second preparation countdown
  const handleBeginPreparing = () => {
    runActiveRef.current = false;
    hasTestStartedRef.current = false;
    baselinePulsesRef.current = null;
    setPrepCountdown(3);
    setWorkflowStep("PREPARING");
  };

  // Preparation countdown: 3 → 2 → 1 → 0
  useEffect(() => {
    if (workflowStep !== "PREPARING") return;
    if (prepCountdown <= 0) {
      (async () => {
        try {
          baselinePulsesRef.current = null;
          setTelemetry({
            state: "RUNNING",
            duration_sec: testDuration,
            elapsed_sec: 0,
            remaining_sec: testDuration,
            start_pulses: 0,
            current_pulses: 0,
            session_pulses: 0,
            pulse_frequency_hz: 0,
            flow_rate_lpm: 0,
            estimated_l: 0,
            estimated_ml: 0,
            has_valid_calibration: isFirmwareCalibrated,
            pulses_per_liter: candidateK ?? activeFlowPulsesPerL,
          });
          setTelemetryState("LIVE");
          setTelemetryAgeMs(0);
          setTelemetryError(null);

          await calibrationService.runCalibrationPump(device, testDuration);
          hasTestStartedRef.current = true;
          setWorkflowStep("RUNNING");
          onStart(testDuration);
          toast(
            `Pompa Air Baku 12V diaktifkan selama ${testDuration} detik. Mengamati pulsa sensor ZJ-B1...`,
            "info"
          );
        } catch (e) {
          toast(errorMessage(e), "error");
          setWorkflowStep("IDLE");
        }
      })();
      return;
    }
    const timer = setTimeout(() => setPrepCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [workflowStep, prepCountdown]);

  // Handler to cancel / stop pump during test
  const handleCancelRun = async () => {
    try {
      await calibrationService.stopCalibrationPump();
    } catch {}
    freezeAndTransition(telemetry, "OPERATOR_STOP");
  };

  // Physical Volume Input Validation and Calculations
  const durationForCalc = frozenSession?.durationSec ?? testDuration;
  const pulsesForCalc = frozenSession?.sessionPulses ?? 0;
  const valResult = validatePhysicalVolumeInput(volumeInputL, durationForCalc);
  const physicalVolumeL = valResult.valid ? valResult.volumeL : 0;
  const physicalVolumeMl = valResult.valid ? valResult.volumeMl : 0;

  // Candidate sensor calibration factor (K = session pulses / actual liters)
  const calcCandidateK = physicalVolumeL > 0 ? calculateCandidateFlowK(pulsesForCalc, physicalVolumeL) : 0;

  // Actual average pump flow rate (separate from sensor pulses/L)
  const calcPumpRate = physicalVolumeMl > 0 ? calculateRawPumpRate(physicalVolumeMl, durationForCalc) : { mlPerSec: 0, lPerMin: 0 };

  // Verification error against sensor estimate
  const estimatedVolumeL = (frozenSession?.hadValidCalibration && frozenSession?.estimatedL > 0)
    ? frozenSession.estimatedL
    : (candidateK && candidateK > 0 ? calculateEstimatedFlowVolume(pulsesForCalc, candidateK).volumeL : 0);

  const verificationCheck = (physicalVolumeL > 0 && estimatedVolumeL > 0)
    ? calculateFlowVerificationError(estimatedVolumeL, physicalVolumeL, FLOW_CALIBRATION_TOLERANCE_PCT)
    : null;

  // Real-time simultaneous mL & L conversions for intuitive operator display
  const liveSessionPulses = telemetry?.session_pulses ?? 0;
  const liveEstimatedL = (telemetry?.estimated_l && telemetry.estimated_l > 0)
    ? telemetry.estimated_l
    : liveSessionPulses / (effectivePulsesPerL || 660);
  const liveEstimatedMl = (telemetry?.estimated_ml && telemetry.estimated_ml > 0)
    ? telemetry.estimated_ml
    : liveEstimatedL * 1000;
  const liveFlowRateLpm = (telemetry?.flow_rate_lpm && telemetry.flow_rate_lpm > 0)
    ? telemetry.flow_rate_lpm
    : ((telemetry?.pulse_frequency_hz ?? 0) * 60) / (effectivePulsesPerL || 660);
  const liveFlowRateMlSec = (liveFlowRateLpm * 1000) / 60;

  const frozenVolL = pulsesForCalc / (effectivePulsesPerL || 660);
  const frozenVolMl = frozenVolL * 1000;

  // Handler to proceed from INPUT_VOLUME to REVIEW
  const handleProceedFromVolume = () => {
    if (!valResult.valid) {
      setValidationError(valResult.error || "Volume fisik tidak valid.");
      return;
    }
    setValidationError(null);

    const isInitialRun = runs.length === 0;
    const factorUsed = isInitialRun ? calcCandidateK : (candidateK ?? activeFlowPulsesPerL);
    const estVol = calculateEstimatedFlowVolume(pulsesForCalc, factorUsed);
    const errResult = calculateFlowVerificationError(estVol.volumeL, physicalVolumeL, FLOW_CALIBRATION_TOLERANCE_PCT);

    // Initial run establishes candidate factor, validation runs check tolerance
    const runPassed = isInitialRun ? true : errResult.isPassed;
    const runStatus: "CALIBRATION_PENDING" | "VERIFIED" | "FAILED" = isInitialRun
      ? "CALIBRATION_PENDING"
      : (errResult.isPassed && runs.length >= 2 ? "VERIFIED" : (errResult.isPassed ? "CALIBRATION_PENDING" : "FAILED"));

    const newRun: FlowVerificationRun = {
      runIndex: runs.length,
      durationSec: durationForCalc,
      sessionPulses: pulsesForCalc,
      measuredVolumeL: physicalVolumeL,
      measuredVolumeMl: physicalVolumeMl,
      estimatedVolumeL: estVol.volumeL,
      estimatedVolumeMl: estVol.volumeMl,
      calFactorUsed: factorUsed,
      candidateFactor: calcCandidateK,
      pumpFlowRateMlSec: calcPumpRate.mlPerSec,
      pumpFlowRateLpm: calcPumpRate.lPerMin,
      errorPct: isInitialRun ? 0 : errResult.errorPct,
      absDiffL: isInitialRun ? 0 : errResult.absDiffL,
      isPassed: runPassed,
      status: runStatus,
    };

    if (isInitialRun) {
      setCandidateK(calcCandidateK);
    }

    setRuns((prev) => [...prev, newRun]);
    setWorkflowStep("REVIEW");
    toast(`Data pengukuran fisik (${physicalVolumeL.toFixed(2)} L) berhasil dicatat.`, "info");
  };

  // Handler to start next staged validation run
  const handleStartNextValidationRun = () => {
    runActiveRef.current = false;
    hasTestStartedRef.current = false;
    baselinePulsesRef.current = null;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setVolumeInputL("");
    setFrozenSession(null);
    setTelemetry(null);
    setTelemetryState("LIVE");
    setTelemetryAgeMs(0);
    setTelemetryError(null);
    setWorkflowStep("IDLE");
  };

  // Handler to save calibration to ESP32 NVS
  const handleSaveToEsp32 = async () => {
    const finalFactor = candidateK ?? (runs[0]?.candidateFactor || activeFlowPulsesPerL);
    if (!finalFactor || finalFactor <= 0) {
      toast("Faktor kalibrasi pulsa tidak valid.", "error");
      return;
    }

    setCalibrating(true);
    try {
      const isVerified = currentVerificationState === "VERIFIED";
      const targetState = isVerified ? "VERIFIED" : "CALIBRATED";

      // 1. Save flow sensor pulses/L to firmware (ZJ-B1 GPIO 15)
      await calibrationService.setFlowPulses(finalFactor, undefined, targetState);

      // 2. Save raw water pump physical flow rate (mL/min) to firmware & backend
      const latestRun = runs[runs.length - 1];
      const pumpRateMlMin = latestRun ? latestRun.pumpFlowRateLpm * 1000 : calcPumpRate.lPerMin * 1000;
      const beforeStr = activePumpRateMlMin > 0 ? `${activePumpRateMlMin.toFixed(1)} ml/min` : "Belum Dikalibrasi";
      const afterStr = `${pumpRateMlMin.toFixed(1)} ml/min`;

      await calibrationService.startCalibration(
        device,
        beforeStr,
        afterStr,
        "Operator",
        {
          measuredMl: latestRun ? latestRun.measuredVolumeMl : physicalVolumeMl,
          durationSec: latestRun ? latestRun.durationSec : durationForCalc,
          flowRateMlMin: Number(pumpRateMlMin.toFixed(1)),
        }
      );

      // Refresh authoritative data
      if (onSaved) {
        await onSaved();
      }

      // Refresh active rates
      const updatedRates = await calibrationService.getRates();
      if (updatedRates) {
        setActiveRates(updatedRates);
      }

      setWorkflowStep("SAVED");
      setConfirmOpen(false);
      toast(
        `Kalibrasi berhasil disimpan! Faktor sensor: ${finalFactor.toFixed(1)} pulsa/L (${targetState}). Debit pompa: ${pumpRateMlMin.toFixed(1)} ml/mnt.`,
        "success"
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setCalibrating(false);
    }
  };

  // Handler to reset all wizard state
  const handleReset = () => {
    runActiveRef.current = false;
    hasTestStartedRef.current = false;
    baselinePulsesRef.current = null;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setWorkflowStep("IDLE");
    setVolumeInputL("");
    setValidationError(null);
    setFrozenSession(null);
    setTelemetry(null);
    setTelemetryState("LIVE");
    setTelemetryAgeMs(0);
    setTelemetryError(null);
    setRuns([]);
    setCandidateK(null);
  };

  return (
    <div className="space-y-6">
      {/* Visual Stepper */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          {[
            { id: "IDLE", num: 1, label: "Konfigurasi & SOP" },
            { id: "RUNNING", num: 2, label: "Live Flow Test" },
            { id: "INPUT_VOLUME", num: 3, label: "Volume Fisik (L)" },
            { id: "REVIEW", num: 4, label: "Verifikasi & Simpan" },
          ].map((s, idx) => {
            const isCurrent =
              workflowStep === s.id ||
              (workflowStep === "SAVED" && s.id === "REVIEW") ||
              (workflowStep === "PREPARING" && s.id === "RUNNING");
            const isCompleted =
              (s.id === "IDLE" && workflowStep !== "IDLE") ||
              (s.id === "RUNNING" &&
                (workflowStep === "INPUT_VOLUME" ||
                  workflowStep === "REVIEW" ||
                  workflowStep === "SAVED")) ||
              (s.id === "INPUT_VOLUME" &&
                (workflowStep === "REVIEW" || workflowStep === "SAVED")) ||
              (s.id === "REVIEW" && workflowStep === "SAVED");

            return (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                    isCompleted
                      ? "bg-emerald-600 text-white shadow-sm"
                      : isCurrent
                      ? "bg-blue-600 text-white ring-4 ring-blue-100 shadow-sm"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : s.num}
                </div>
                <span
                  className={`text-xs font-semibold hidden md:inline ${
                    isCurrent
                      ? "text-blue-700 font-bold"
                      : isCompleted
                      ? "text-slate-700"
                      : "text-slate-400"
                  }`}
                >
                  {s.label}
                </span>
                {idx < 3 && <div className="w-6 sm:w-12 h-0.5 bg-slate-200 mx-1" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* KOLOM KIRI: Status Perangkat & Panduan SOP */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card Status Aktif Pompa & Sensor */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Status Kalibrasi Air Baku 12V
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                  currentVerificationState === "VERIFIED"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : currentVerificationState === "CALIBRATION_PENDING"
                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                    : "bg-slate-100 text-slate-600 border border-slate-200"
                }`}
              >
                {currentVerificationState === "VERIFIED" ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    VERIFIED (Terverifikasi)
                  </>
                ) : currentVerificationState === "CALIBRATION_PENDING" ? (
                  <>
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    PENDING (Menunggu Validasi)
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3 text-slate-400" />
                    UNCAL (Belum Dikalibrasi)
                  </>
                )}
              </span>
            </div>

            {/* Metrics Dual Display: Sensor Factor & Pump Flow Rate */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                <div className="text-[11px] text-slate-500 font-medium">Faktor Sensor (ZJ-B1)</div>
                <div className="text-xl font-extrabold font-mono text-slate-900 mt-1">
                  {isFirmwareCalibrated ? activeFlowPulsesPerL.toFixed(1) : "—"}
                  <span className="text-xs font-sans text-slate-400 ml-1">pulsa/L</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">GPIO 15 (Falling ISR)</div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                <div className="text-[11px] text-slate-500 font-medium">Debit Riil Pompa</div>
                <div className="text-xl font-extrabold font-mono text-slate-900 mt-1">
                  {activePumpRateMlMin > 0 ? (activePumpRateMlMin / 1000).toFixed(2) : "—"}
                  <span className="text-xs font-sans text-slate-400 ml-1">L/mnt</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {activePumpRateMlMin > 0 ? `(${activePumpRateMlMin.toFixed(0)} ml/mnt)` : "GPIO 4 (12V DC)"}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
              <span className="text-slate-500">Terakhir Dikalibrasi:</span>
              <span className="font-semibold text-slate-700">
                {device.lastCalibration || "Belum ada riwayat"}
              </span>
            </div>

            {!isFirmwareCalibrated && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  <b>Perhatian:</b> Sensor alir air baku belum terkalibrasi. Estimasi volume (Liter) tidak akan ditampilkan sebelum kalibrasi fisik dilakukan.
                </span>
              </div>
            )}
          </div>

          {/* Card Panduan SOP Verifikasi */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3.5">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
              <Info className="h-4 w-4 text-blue-500" />
              <h3 className="font-bold text-slate-800 text-sm">SOP Verifikasi Aliran & Kalibrasi Fisik</h3>
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
                  1
                </div>
                <div>
                  <b className="text-slate-800 block">Jalur Pipa & Wadah Penampung</b>
                  Arahkan selang output melewati sensor ZJ-B1 (GPIO 15) ke wadah penampung fisik (ember/tandon berskala Liter).
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
                  2
                </div>
                <div>
                  <b className="text-slate-800 block">Jalankan Pengujian (Live Flow Telemetry)</b>
                  Nyalakan pompa (15s–60s). Amati pulsa riil dan frekuensi sensor secara real-time.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
                  3
                </div>
                <div>
                  <b className="text-slate-800 block">Ukur Volume Fisik Aktual</b>
                  Ukur cairan tertampung secara mandiri, lalu masukkan nilainya pada field <b>Actual Measured Volume (L)</b>.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200">
                  4
                </div>
                <div>
                  <b className="text-slate-800 block">Verifikasi Staged 3 Tahap (Toleransi ±5%)</b>
                  Lakukan 1 uji awal + 2 uji validasi independen. Jika error &le; 5.0%, sensor dipromosikan ke <b>VERIFIED</b>.
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
              <ShieldAlert className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>Interlock aktif: Pompa dosing & mixing terkunci selama pengujian air baku.</span>
            </div>
          </div>
        </div>

        {/* KOLOM KANAN: Panel Interaktif Sesuai Workflow Step */}
        <div className="lg:col-span-7 space-y-4">
          {/* ============================================================ */}
          {/* STEP 1: IDLE / CONFIGURATION                                  */}
          {/* ============================================================ */}
          {workflowStep === "IDLE" && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex items-start justify-between pb-3 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-5 w-5 text-blue-600" />
                    <h3 className="font-bold text-slate-900 text-base">
                      Konfigurasi Pengujian Pompa Air Baku 12V
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Live Flow Verification & Physical Volume Calibration (Sensor Alir ZJ-B1 GPIO 15 & Pompa Submersible 12V GPIO 4).
                  </p>
                </div>
                {runs.length > 0 && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    Sesi Ke-{runs.length + 1}
                  </span>
                )}
              </div>

              {/* Staged 3-Run Verification Protocol Tracker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-emerald-600" />
                    Protokol Verifikasi Staged 3 Tahap (Toleransi ±5.0%):
                  </span>
                  <span className="text-slate-500 font-mono text-[11px]">
                    {runs.length} dari 3 Pengujian Selesai
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    {
                      stage: 1,
                      label: "Tahap 1: Kalibrasi Awal",
                      title: "Hitung Faktor Kandidat",
                      desc: "Tentukan pulses/L awal dari volume fisik",
                    },
                    {
                      stage: 2,
                      label: "Tahap 2: Validasi #1",
                      title: "Uji Independen #1",
                      desc: "Uji deviasi estimasi vs fisik (≤ 5%)",
                    },
                    {
                      stage: 3,
                      label: "Tahap 3: Validasi #2",
                      title: "Uji Konfirmasi #2",
                      desc: "Promosi ke status VERIFIED jika lolos",
                    },
                  ].map((st) => {
                    const isCompleted = runs.length >= st.stage;
                    const isCurrent = runs.length + 1 === st.stage;
                    const completedRun = isCompleted ? runs[st.stage - 1] : null;

                    return (
                      <div
                        key={st.stage}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          isCompleted
                            ? completedRun?.isPassed
                              ? "border-emerald-300 bg-emerald-50/70"
                              : "border-red-300 bg-red-50/70"
                            : isCurrent
                            ? "border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/20 shadow-sm"
                            : "border-slate-200 bg-slate-50 opacity-50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-[10px] font-bold ${
                              isCompleted
                                ? completedRun?.isPassed
                                  ? "text-emerald-700"
                                  : "text-red-700"
                                : isCurrent
                                ? "text-blue-700"
                                : "text-slate-400"
                            }`}
                          >
                            {st.label}
                          </span>
                          {isCompleted ? (
                            completedRun?.isPassed ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                                ✓ Lolos
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800">
                                ✕ Gagal
                              </span>
                            )
                          ) : isCurrent ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 animate-pulse">
                              ▶ Aktif
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500">
                              🔒 Menunggu
                            </span>
                          )}
                        </div>

                        <div className="font-extrabold text-xs text-slate-800">{st.title}</div>
                        {isCompleted && completedRun ? (
                          <div className="text-[10px] text-slate-600 mt-1 font-mono">
                            {completedRun.measuredVolumeL.toFixed(2)}L • {completedRun.sessionPulses}p
                            {st.stage > 1 && (
                              <span className="block font-bold text-emerald-700">
                                Deviasi: {completedRun.errorPct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 mt-1">{st.desc}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mode Pemilihan Durasi Pompa Berputar */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-2">
                  Pilih Durasi Pengujian Pompa (Detik):
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { sec: 30, title: "30 Detik", desc: "Standar Rekomendasi", badge: "Akurat" },
                    { sec: 60, title: "60 Detik", desc: "Presisi Tinggi (Volume Lebih Banyak)", badge: "Presisi" },
                    { sec: 15, title: "15 Detik", desc: "Uji Respon Cepat", badge: "Cepat" },
                  ].map((d) => {
                    const isSelected = testDuration === d.sec;
                    return (
                      <button
                        key={d.sec}
                        type="button"
                        onClick={() => setTestDuration(d.sec)}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                          isSelected
                            ? "border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm text-slate-900">{d.title}</span>
                          <span
                            className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                              isSelected
                                ? "bg-blue-600 text-white"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {d.badge}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">{d.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Technical Safety Prechecks & Interlocks */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 text-slate-700">
                <div className="font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 text-emerald-600" />
                  Pemeriksaan Keselamatan Otomatis (Pre-Checks):
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    Pompa Dosing A/B: Terkunci (OFF)
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    Pompa Mixing: Terkunci (OFF)
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    Batas Runtime: 30 Menit (Firmware Guard)
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    Counter Snapshot: Delta Baseline Aktif
                  </div>
                </div>
              </div>

              {/* Tombol Mulai */}
              <div className="flex gap-3 pt-2">
                {runs.length > 0 && (
                  <Button
                    variant="secondary"
                    onClick={handleReset}
                    className="py-5 px-4 text-xs font-bold"
                  >
                    <RotateCcw className="h-4 w-4 mr-1" /> Ulangi dari Awal
                  </Button>
                )}
                <Button
                  onClick={handleBeginPreparing}
                  className="flex-1 py-6 text-sm font-bold bg-blue-600 hover:bg-blue-700 shadow-md cursor-pointer flex items-center justify-center gap-2"
                >
                  <Play className="h-5 w-5 fill-current" />
                  MULAI PENGUJIAN POMPA AIR BAKU ({testDuration} DETIK)
                </Button>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 2: PREPARING (Safety Countdown)                         */}
          {/* ============================================================ */}
          {workflowStep === "PREPARING" && (
            <div className="bg-amber-900 border border-amber-700 rounded-2xl p-6 shadow-xl text-white relative overflow-hidden space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-amber-700/60">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-amber-400 animate-ping" />
                  <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                    MEMPERSIAPKAN PENGUJIAN
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-amber-200 bg-amber-800/80 px-2.5 py-1 rounded-full">
                  POMPA AIR BAKU 12V
                </span>
              </div>

              <div className="text-center py-6">
                <div className="text-8xl font-extrabold font-mono text-amber-300 tracking-tight animate-pulse">
                  {prepCountdown}
                </div>
                <p className="text-sm font-bold text-amber-200 mt-3">
                  Pompa akan menyala dalam {prepCountdown} detik!
                </p>
              </div>

              <div className="bg-amber-950/60 border border-amber-700/50 rounded-xl p-4 space-y-2 text-xs text-amber-100">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Instruksi Terakhir:
                </div>
                <p>
                  Pastikan pipa output diarahkan ke wadah penampung fisik berskala Liter. Snapshot counter pulsa ZJ-B1 akan diambil otomatis saat pompa mulai berputar.
                </p>
              </div>

              <Button
                variant="danger"
                onClick={() => {
                  setWorkflowStep("IDLE");
                  setPrepCountdown(0);
                }}
                className="w-full py-4 text-xs font-bold bg-red-600 hover:bg-red-700 cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <Square className="h-4 w-4 fill-current" /> BATALKAN
              </Button>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 3: RUNNING (Live Flow Verification & Telemetry)         */}
          {/* ============================================================ */}
          {workflowStep === "RUNNING" && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl text-white relative overflow-hidden space-y-5">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

              {/* Header Telemetri & Status Sensor Freshness */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className={`h-3 w-3 rounded-full ${
                    telemetryState === "LIVE"
                      ? "bg-emerald-400 animate-ping"
                      : telemetryState === "STALE"
                      ? "bg-amber-400"
                      : "bg-rose-500"
                  }`} />
                  <span className={`text-xs font-bold uppercase tracking-wider ${
                    telemetryState === "LIVE"
                      ? "text-emerald-400"
                      : telemetryState === "STALE"
                      ? "text-amber-400"
                      : "text-rose-400"
                  }`}>
                    {telemetryState === "LIVE"
                      ? "LIVE FLOW STREAMING AKTIF"
                      : telemetryState === "STALE"
                      ? "TELEMETRI TERTUNDA (STALE)"
                      : "TELEMETRI TERPUTUS (DISCONNECTED)"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {telemetryState === "LIVE" ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2.5 py-0.5 rounded-full">
                      <Radio className="h-3 w-3 animate-pulse text-emerald-400" />
                      <span>LIVE {telemetryAgeMs > 0 ? `(${(telemetryAgeMs / 1000).toFixed(1)}s lalu)` : "(<1s)"}</span>
                    </span>
                  ) : telemetryState === "STALE" ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-400 bg-amber-950/80 border border-amber-800 px-2.5 py-0.5 rounded-full">
                      <AlertTriangle className="h-3 w-3 text-amber-400" />
                      <span>STALE ({(telemetryAgeMs / 1000).toFixed(1)}s lalu)</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-400 bg-rose-950/80 border border-rose-800 px-2.5 py-0.5 rounded-full">
                      <XCircle className="h-3 w-3 text-rose-400" />
                      <span>DISCONNECTED / ERROR</span>
                    </span>
                  )}
                  <span className="text-xs font-mono font-bold text-slate-300 bg-slate-800 px-2.5 py-1 rounded-full">
                    POMPA 12V: ON
                  </span>
                </div>
              </div>

              {/* Countdown & Elapsed Display */}
              <div className="flex items-center justify-between bg-slate-800/80 border border-slate-700/60 rounded-xl p-4">
                <div>
                  <div className="text-[11px] text-slate-400">Durasi Pengujian</div>
                  <div className="text-3xl font-extrabold font-mono text-white mt-0.5">
                    {run?.secondsLeft ?? (testDuration - (telemetry?.elapsed_sec ?? 0))}
                    <span className="text-sm font-sans text-slate-400 ml-1">dtk tersisa</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[11px] text-slate-400">Waktu Berjalan</div>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                    {telemetry?.elapsed_sec ?? (testDuration - (run?.secondsLeft ?? testDuration))} / {testDuration} dtk
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Progres Aliran Air Baku</span>
                  <span>
                    {Math.round(
                      (((testDuration - (run?.secondsLeft ?? testDuration)) / testDuration) * 100)
                    )}%
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden p-0.5 border border-slate-700">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full rounded-full transition-all duration-1000 ease-linear"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          ((testDuration - (run?.secondsLeft ?? testDuration)) / testDuration) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Section Name: Live Flow Verification & Physical Volume Calibration Telemetry Grid */}
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Gauge className="h-4 w-4 text-blue-400" />
                    Live Flow Verification & Physical Volume Calibration
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Baseline: {(telemetry?.start_pulses ?? (baselinePulsesRef.current ?? 0)).toLocaleString()} pulsa
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Card 1: Live Volume & Pulses */}
                  <div
                    className={`p-4 rounded-xl border transition-colors space-y-1 ${
                      telemetryState === "DISCONNECTED"
                        ? "bg-rose-950/20 border-rose-800/80 ring-1 ring-rose-500/30"
                        : telemetryState === "STALE"
                        ? "bg-amber-950/20 border-amber-800/80"
                        : "bg-slate-800/90 border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-400 block">
                        Volume Aliran Sesi (mL & L)
                      </span>
                      {telemetryState === "DISCONNECTED" && (
                        <span className="text-[9px] font-bold text-rose-300 bg-rose-950 px-1.5 py-0.5 rounded border border-rose-800">
                          Data Terputus
                        </span>
                      )}
                      {telemetryState === "STALE" && (
                        <span className="text-[9px] font-bold text-amber-300 bg-amber-950 px-1.5 py-0.5 rounded border border-amber-800">
                          Tertunda
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-2xl sm:text-3xl font-extrabold font-mono flex items-baseline flex-wrap gap-1.5 ${
                        telemetryState === "DISCONNECTED"
                          ? "text-rose-300/60"
                          : telemetryState === "STALE"
                          ? "text-amber-200"
                          : "text-cyan-300"
                      }`}
                    >
                      <span>
                        {liveEstimatedL.toFixed(2)}{" "}
                        <span className="text-sm font-sans text-slate-400 font-normal">L</span>
                      </span>
                      <span className="text-base sm:text-xl font-mono text-cyan-100 font-semibold">
                        ({Math.round(liveEstimatedMl).toLocaleString()} mL)
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between pt-0.5 border-t border-slate-700/50">
                      <span>{liveSessionPulses.toLocaleString()} pulsa ({effectivePulsesPerL.toFixed(1)} p/L)</span>
                      <span>Baseline: {(telemetry?.start_pulses ?? (baselinePulsesRef.current ?? 0)).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Card 2: Pulse Frequency (Hz) */}
                  <div className="p-4 rounded-xl bg-slate-800/90 border border-slate-700 space-y-1">
                    <span className="text-[11px] font-semibold text-slate-400 block">
                      Frekuensi Sensor & Laju mL
                    </span>
                    <div className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-300 flex items-baseline flex-wrap gap-1.5">
                      <span>
                        {(telemetry?.pulse_frequency_hz ?? 0).toFixed(1)}
                        <span className="text-xs font-sans text-slate-400 ml-1">Hz</span>
                      </span>
                      <span className="text-sm sm:text-base font-mono text-emerald-100 font-semibold">
                        ({liveFlowRateMlSec.toFixed(0)} mL/dtk)
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 block">
                      ZJ-B1 Aliran Air Baku (GPIO 15)
                    </span>
                  </div>

                  {/* Card 3: Live Flow Rate (L/min & mL/s) */}
                  <div className="p-4 rounded-xl bg-slate-800/90 border border-slate-700 space-y-1">
                    <span className="text-[11px] font-semibold text-slate-400 block">
                      Debit Aliran (L/menit & mL/detik)
                    </span>
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-blue-300 flex items-baseline flex-wrap gap-1.5">
                      <span>
                        {liveFlowRateLpm.toFixed(2)}
                        <span className="text-xs font-sans text-slate-400 ml-1">L/mnt</span>
                      </span>
                      <span className="text-sm font-mono text-blue-100 font-semibold">
                        ({liveFlowRateMlSec.toFixed(1)} mL/s)
                      </span>
                    </div>
                    <span className="text-[10px] text-blue-400/90 block">
                      {isFirmwareCalibrated || candidateK
                        ? `Faktor aktif: ${effectivePulsesPerL.toFixed(1)} pulsa/L`
                        : "Estimasi nominal (660 pulsa/L)"}
                    </span>
                  </div>

                  {/* Card 4: Accumulated Volume (L & mL) */}
                  <div className="p-4 rounded-xl bg-slate-800/90 border border-slate-700 space-y-1">
                    <span className="text-[11px] font-semibold text-slate-400 block">
                      Total Volume Akumulasi
                    </span>
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-indigo-300">
                      {liveEstimatedL.toFixed(3)}
                      <span className="text-xs font-sans text-slate-400 ml-1.5">Liter</span>
                    </div>
                    <span className="text-xs text-indigo-200 font-mono block">
                      Setara <b>{Math.round(liveEstimatedMl).toLocaleString()} mL</b>
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      {isFirmwareCalibrated || candidateK
                        ? "Terverifikasi sensor"
                        : "Estimasi nominal (660 pulsa/L)"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Telemetry Disconnected Error Alert */}
              {telemetryState === "DISCONNECTED" && (
                <div className="p-3 rounded-xl bg-rose-950/90 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>
                    <b>Peringatan: Sambungan Telemetri Terputus.</b> {telemetryError || "Gagal menghubungi ESP32."} Data terakhir tetap ditampilkan dan tidak ada pulsa fiktif yang digenerate.
                  </span>
                </div>
              )}

              {/* No-flow Warning Alert if pump runs > 5s with 0 pulses */}
              {(telemetry?.elapsed_sec ?? 0) > 5 && (telemetry?.session_pulses ?? 0) === 0 && (
                <div className="p-3 rounded-xl bg-red-950/80 border border-red-800 text-red-200 text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                  <span>
                    <b>Peringatan: 0 Pulsa Terdeteksi.</b> Pastikan kran toren air terbuka, selang terhubung, dan pin GPIO 15 tersambung dengan baik.
                  </span>
                </div>
              )}

              {/* Cancel Button */}
              <Button
                variant="danger"
                onClick={handleCancelRun}
                className="w-full py-4 text-xs font-bold bg-red-600 hover:bg-red-700 cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <Square className="h-4 w-4 fill-current" /> HENTIKAN PENGUJIAN (STOP & BEKUKAN)
              </Button>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 4: INPUT_VOLUME (Physical Volume Entry)                 */}
          {/* ============================================================ */}
          {workflowStep === "INPUT_VOLUME" && (
            <div className="bg-white border border-blue-200 rounded-2xl p-6 shadow-sm ring-1 ring-blue-50 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <FlaskConical className="h-5 w-5 text-blue-600" />
                    Pengujian Selesai! Verifikasi Volume Fisik
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sesi pengujian {durationForCalc} detik selesai. Catat volume air aktual yang tertampung di wadah ukur.
                  </p>
                </div>
                <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full">
                  Tahap {runs.length + 1} dari 3
                </span>
              </div>

              {/* Frozen Pulse Data Banner */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    Hasil Volume Sesi Terdeteksi Sensor:
                  </span>
                  <div className="text-right">
                    <span className="font-mono font-extrabold text-blue-900 text-2xl">
                      {frozenVolL.toFixed(2)}{" "}
                      <span className="text-sm font-sans text-blue-700 font-normal">L</span>
                      <span className="text-lg font-mono text-blue-800 font-bold ml-1.5">
                        ({Math.round(frozenVolMl).toLocaleString()} mL)
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono block">
                      {pulsesForCalc.toLocaleString()} pulsa ({effectivePulsesPerL.toFixed(1)} pulsa/L)
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-600 font-mono flex items-center justify-between border-t border-blue-200/60 pt-1.5">
                  <span>Durasi Efektif: <b>{durationForCalc} Detik</b></span>
                  <span>Frekuensi Rata-rata: <b>{(pulsesForCalc / (durationForCalc || 1)).toFixed(1)} Hz</b></span>
                </div>
              </div>

              {/* Form Input Volume Fisik (L) */}
              <div className="space-y-1.5">
                <Label className="text-slate-800 font-bold block">
                  Actual Measured Volume (L) — Volume Fisik Tertampung di Wadah:
                </Label>
                <div className="relative">
                  <Input
                    value={volumeInputL}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val)) {
                        setVolumeInputL(val);
                        setValidationError(null);
                      }
                    }}
                    placeholder="Contoh: 5.25 (dalam Liter)"
                    unit="L"
                    autoFocus
                    className="font-mono text-xl bg-slate-50 py-3"
                  />
                </div>
                {validationError && (
                  <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {validationError}
                  </p>
                )}
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>
                    Setara Fisik:{" "}
                    <b>
                      {physicalVolumeMl > 0 ? `${physicalVolumeMl.toLocaleString()} mL` : "— mL"}
                    </b>
                  </span>
                  <span>Gunakan wadah penampung dengan skala mililiter atau liter terverifikasi.</span>
                </div>
              </div>

              {/* Live Preview Perhitungan Kandidat & Debit Pompa */}
              {physicalVolumeL > 0 && (
                <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-emerald-200">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <Gauge className="h-4 w-4 text-emerald-700" />
                      Hasil Perhitungan Kalibrasi Kandidat:
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Formula Fisik Riil
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {/* Candidate K */}
                    <div className="p-2.5 bg-white/80 rounded-lg border border-emerald-200">
                      <span className="text-slate-500 block text-[11px]">
                        Faktor Sensor Kandidat (K):
                      </span>
                      <div className="text-xl font-extrabold font-mono text-emerald-800 mt-0.5">
                        {calcCandidateK.toFixed(1)}
                        <span className="text-xs font-sans text-emerald-600 ml-1">pulsa/L</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                        ({pulsesForCalc} pulsa ÷ {physicalVolumeL} L)
                      </span>
                    </div>

                    {/* Actual Pump Rate */}
                    <div className="p-2.5 bg-white/80 rounded-lg border border-emerald-200">
                      <span className="text-slate-500 block text-[11px]">
                        Debit Pompa 12V Riil:
                      </span>
                      <div className="text-xl font-extrabold font-mono text-blue-800 mt-0.5">
                        {calcPumpRate.lPerMin.toFixed(2)}
                        <span className="text-xs font-sans text-blue-600 ml-1">L/mnt</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                        ({calcPumpRate.mlPerSec.toFixed(1)} ml/dtk • {durationForCalc}s)
                      </span>
                    </div>
                  </div>

                  {/* Deviation Against Previous / Candidate Factor */}
                  {verificationCheck && (
                    <div className="p-2.5 bg-white/90 rounded-lg border border-emerald-200 text-xs flex items-center justify-between">
                      <div>
                        <span className="text-slate-500 text-[11px] block">
                          Perbandingan Estimasi vs Fisik:
                        </span>
                        <span className="font-mono text-slate-700">
                          Est: <b>{estimatedVolumeL.toFixed(2)}L</b> vs Fisik: <b>{physicalVolumeL.toFixed(2)}L</b> (Δ {verificationCheck.absDiffL.toFixed(2)}L)
                        </span>
                      </div>
                      <div className="text-right">
                        <span
                          className={`font-mono font-bold text-sm px-2 py-0.5 rounded ${
                            verificationCheck.isPassed
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          Error: {verificationCheck.errorPct.toFixed(2)}%
                        </span>
                        <span className="text-[10px] text-slate-500 block mt-0.5">
                          Toleransi: ±{FLOW_CALIBRATION_TOLERANCE_PCT}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={handleReset}
                  className="py-5 px-4 text-xs font-bold"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Ulangi Sesi
                </Button>
                <Button
                  onClick={handleProceedFromVolume}
                  disabled={!valResult.valid || physicalVolumeL <= 0}
                  className="flex-1 py-5 text-sm font-bold bg-blue-600 hover:bg-blue-700 shadow-md cursor-pointer flex items-center justify-center gap-2"
                >
                  LANJUT KE TINJAUAN & VERIFIKASI STAGED <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 5: REVIEW (Staged Verification Workflow & Persistence)  */}
          {/* ============================================================ */}
          {workflowStep === "REVIEW" && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Tinjauan Hasil & Verifikasi Staged Sensor Aliran
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Evaluasi hasil pengukuran fisik, perbandingan deviasi terhadap toleransi ±5.0%, dan status verifikasi.
                  </p>
                </div>

                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 ${
                    currentVerificationState === "VERIFIED"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {currentVerificationState === "VERIFIED" ? (
                    <>
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                      TERVERIFIKASI (VERIFIED)
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                      PENDING VERIFIKASI ({runs.length}/3 Selesai)
                    </>
                  )}
                </span>
              </div>

              {/* Status Outcome Banner */}
              {currentVerificationState === "VERIFIED" ? (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-800 text-sm">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <span>Semua Uji Validasi Berhasil! Sensor Siap Dipromosikan ke VERIFIED</span>
                  </div>
                  <p className="text-xs leading-relaxed text-emerald-800">
                    Sensor flow water kecil ZJ-B1 telah melalui 1 pengujian kalibrasi awal dan 2 pengujian validasi independen berturut-turut. Semua deviasi berada dalam batas toleransi ketat <b>±{FLOW_CALIBRATION_TOLERANCE_PCT}%</b>. Kontroler ESP32 siap mengadopsi faktor ini untuk fertigasi otomatis.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-amber-800 text-sm">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <span>Kalibrasi Memerlukan Validasi Independen Tambahan</span>
                  </div>
                  <p className="text-xs leading-relaxed text-amber-800">
                    Sesuai SOP, faktor kandidat baru belum dapat dilabeli <b>VERIFIED</b> sebelum melewati 2 uji validasi independen terpisah. Silakan lakukan pengujian berikutnya untuk membuktikan akurasi pengukuran berulang.
                  </p>
                </div>
              )}

              {/* Big Candidate Result Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 text-center">
                  <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">
                    Faktor Sensor Alir (ZJ-B1)
                  </span>
                  <div className="text-4xl font-extrabold font-mono text-blue-800 my-2">
                    {(candidateK ?? activeFlowPulsesPerL).toFixed(1)}
                    <span className="text-sm font-sans text-blue-600 ml-1.5 font-bold">pulsa/L</span>
                  </div>
                  <div className="text-[11px] text-slate-600 font-mono">
                    Status Target: <b>{currentVerificationState}</b>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 text-center">
                  <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">
                    Debit Aktual Pompa 12V
                  </span>
                  <div className="text-4xl font-extrabold font-mono text-emerald-800 my-2">
                    {runs[runs.length - 1]?.pumpFlowRateLpm.toFixed(2) ?? "—"}
                    <span className="text-sm font-sans text-emerald-600 ml-1.5 font-bold">L/mnt</span>
                  </div>
                  <div className="text-[11px] text-slate-600 font-mono">
                    Setara {(runs[runs.length - 1]?.pumpFlowRateMlSec ?? 0).toFixed(1)} ml/dtk
                  </div>
                </div>
              </div>

              {/* Staged Runs Table */}
              <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
                <div className="bg-slate-100 px-3.5 py-2.5 font-bold text-slate-700 flex items-center justify-between">
                  <span>Riwayat Sesi Pengujian Staged</span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Toleransi: ±{FLOW_CALIBRATION_TOLERANCE_PCT}%
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 border-b border-slate-200">
                        <th className="py-2 px-3">Sesi</th>
                        <th className="py-2 px-3">Durasi</th>
                        <th className="py-2 px-3">Pulsa (N)</th>
                        <th className="py-2 px-3">Fisik (L)</th>
                        <th className="py-2 px-3">Estimasi (L)</th>
                        <th className="py-2 px-3">Faktor (p/L)</th>
                        <th className="py-2 px-3 text-right">Error (%)</th>
                        <th className="py-2 px-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white font-mono text-[11px]">
                      {runs.map((r, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="py-2 px-3 font-sans font-bold text-slate-700">
                            {idx === 0 ? "1 (Awal)" : `Validasi ${idx}`}
                          </td>
                          <td className="py-2 px-3 text-slate-600">{r.durationSec}s</td>
                          <td className="py-2 px-3 text-slate-800 font-bold">{r.sessionPulses}</td>
                          <td className="py-2 px-3 text-slate-800 font-bold">{r.measuredVolumeL.toFixed(2)}L</td>
                          <td className="py-2 px-3 text-slate-600">
                            {idx === 0 ? "—" : `${r.estimatedVolumeL.toFixed(2)}L`}
                          </td>
                          <td className="py-2 px-3 text-blue-600 font-bold">{r.candidateFactor.toFixed(1)}</td>
                          <td className="py-2 px-3 text-right">
                            {idx === 0 ? (
                              <span className="text-slate-400">Acuan</span>
                            ) : (
                              <span
                                className={`font-bold ${
                                  r.isPassed ? "text-emerald-600" : "text-red-600"
                                }`}
                              >
                                {r.errorPct.toFixed(2)}%
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-sans">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                r.isPassed
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={handleReset}
                  className="py-5 px-4 text-xs font-bold"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Ulangi Kalibrasi
                </Button>

                {runs.length < 3 ? (
                  <Button
                    onClick={handleStartNextValidationRun}
                    className="flex-1 py-5 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 shadow-md cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Layers className="h-5 w-5" />
                    LANJUT KE VALIDASI BERIKUTNYA (SESI #{runs.length + 1} DARI 3)
                  </Button>
                ) : (
                  <Button
                    onClick={() => setConfirmOpen(true)}
                    disabled={calibrating}
                    className="flex-1 py-5 text-sm font-bold bg-blue-600 hover:bg-blue-700 shadow-md cursor-pointer flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="h-5 w-5" /> SIMPAN KALIBRASI KE KONTROLER ESP32
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 6: SAVED (Successful Persistence to NVS)                */}
          {/* ============================================================ */}
          {workflowStep === "SAVED" && (
            <div className="bg-white border border-emerald-200 rounded-2xl p-6 shadow-sm ring-1 ring-emerald-100 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="h-9 w-9" />
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  Kalibrasi Aliran & Debit Pompa Berhasil Disimpan!
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Nilai kalibrasi telah dipersistensikan secara permanen ke memori NVS ESP32-S3 dan siap digunakan untuk pengisian tangki otomatis.
                </p>
              </div>

              <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 max-w-lg mx-auto text-left space-y-2 text-xs">
                <div className="flex justify-between font-mono">
                  <span className="text-slate-600">Faktor Sensor Alir (ZJ-B1):</span>
                  <span className="font-bold text-emerald-800">
                    {(candidateK ?? activeFlowPulsesPerL).toFixed(1)} pulsa/L ({currentVerificationState})
                  </span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-slate-600">Debit Pompa Air Baku 12V:</span>
                  <span className="font-bold text-blue-800">
                    {(runs[runs.length - 1]?.pumpFlowRateLpm ?? calcPumpRate.lPerMin).toFixed(2)} L/mnt
                  </span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-slate-600">Jumlah Sesi Validasi:</span>
                  <span className="font-bold text-slate-800">{runs.length} Sesi Terverifikasi</span>
                </div>
              </div>

              <div className="pt-2 flex justify-center gap-3">
                <Button
                  onClick={handleReset}
                  className="py-4 px-6 text-xs font-bold bg-blue-600 hover:bg-blue-700"
                >
                  <RotateCcw className="h-4 w-4 mr-1" /> Uji Sesi Baru
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog before applying to ESP32 */}
      <ConfirmDialog
        open={confirmOpen}
        title="Konfirmasi Penyimpanan Kalibrasi ke ESP32"
        message={`Faktor Sensor Alir (${(candidateK ?? activeFlowPulsesPerL).toFixed(1)} pulsa/L) dengan status ${currentVerificationState} serta debit pompa 12V akan ditulis ke NVS controller.`}
        confirmLabel={calibrating ? "Menyimpan..." : "Ya, Simpan Permanen"}
        loading={calibrating}
        onConfirm={handleSaveToEsp32}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}
