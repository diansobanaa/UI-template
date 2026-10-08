/**
 * Centralized Web UI Alarm Audio Manager
 * Synthesizes authentic 2400 Hz buzzer alarm pulses (mirroring the physical ESP32 buzzer on GPIO 18)
 * for critical conditions: ESP32 offline and Tamper loop disconnected.
 *
 * Autoplay safe: AudioContext is only resumed/initialized via genuine user gestures.
 * Persistent: Loops continuously (beep - pause - beep) as long as any critical condition is active.
 * Duplicate-protected: Singleton audio engine prevents overlapping oscillators and intervals.
 */

import { useEffect, useRef } from "react";

// Singleton AudioContext per browser tab
let audioCtx: AudioContext | null = null;
let unlockListenersAttached = false;

// Audio state tracking
const activeConditions = new Map<string, boolean>();
let buzzerInterval: ReturnType<typeof setInterval> | null = null;
let isLoopRunning = false;
let currentOsc: OscillatorNode | null = null;
let currentGain: GainNode | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      audioCtx = new Ctor();
    }
  }
  return audioCtx;
}

/**
 * Resumes AudioContext on genuine user interaction.
 * If an alarm condition is currently active, starts the audio pulse immediately.
 */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(() => {
          if (isAlarmActive() && isLoopRunning) {
            playBuzzerPulse();
          }
        })
        .catch(() => {});
    } else if (ctx.state === "running") {
      if (isAlarmActive() && isLoopRunning) {
        playBuzzerPulse();
      }
    }
  } catch {
    // Audio unavailable
  }
}

/**
 * Attaches passive listeners to unlock AudioContext on the first genuine user gesture.
 * Self-cleans once AudioContext is confirmed running.
 */
export function initAudioUnlockListeners(): () => void {
  if (typeof window === "undefined" || unlockListenersAttached) {
    return () => {};
  }
  unlockListenersAttached = true;

  const handleGesture = () => {
    unlockAudio();
    const ctx = getAudioContext();
    if (ctx && ctx.state === "running") {
      removeListeners();
    }
  };

  const removeListeners = () => {
    window.removeEventListener("pointerdown", handleGesture);
    window.removeEventListener("click", handleGesture);
    window.removeEventListener("touchstart", handleGesture);
    window.removeEventListener("keydown", handleGesture);
  };

  window.addEventListener("pointerdown", handleGesture, { passive: true });
  window.addEventListener("click", handleGesture, { passive: true });
  window.addEventListener("touchstart", handleGesture, { passive: true });
  window.addEventListener("keydown", handleGesture, { passive: true });

  return removeListeners;
}

// Auto-register gesture unlock on module load in client environment
if (typeof window !== "undefined") {
  initAudioUnlockListeners();
}

/**
 * Synthesizes one authentic buzzer beep pulse (2400 Hz square wave, 280ms duration).
 * 2400 Hz is the exact resonant frequency of the active hardware alarm buzzer (GPIO 18 / MOSFET #4).
 */
export function playBuzzerPulse(): boolean {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") {
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return false;
  }

  try {
    // Clean up previous active pulse if still vibrating to guarantee no overlapping waveforms
    if (currentGain) {
      try {
        currentGain.gain.cancelScheduledValues(ctx.currentTime);
        currentGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      } catch {}
    }
    if (currentOsc) {
      try {
        currentOsc.stop();
      } catch {}
      currentOsc = null;
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(2400, ctx.currentTime);

    // Envelope: sharp attack, sustained plateau (220ms), quick decay (60ms) -> total 280ms
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.setValueAtTime(0.28, ctx.currentTime + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);

    currentOsc = osc;
    currentGain = gain;

    osc.onended = () => {
      if (currentOsc === osc) currentOsc = null;
      if (currentGain === gain) currentGain = null;
    };

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.28);
    return true;
  } catch {
    return false;
  }
}

/** Returns true if any registered alarm condition is active. */
export function isAlarmActive(): boolean {
  for (const active of activeConditions.values()) {
    if (active) return true;
  }
  return false;
}

/** Returns true if the buzzer loop is currently running. */
export function isAlarmLoopRunning(): boolean {
  return isLoopRunning;
}

/**
 * Starts the persistent buzzer loop (cadence: 280ms beep + 320ms silence = 600ms interval).
 * Strictly idempotent: will never create multiple intervals or oscillators.
 */
function startAlarmLoop(): void {
  if (isLoopRunning) return;
  isLoopRunning = true;

  playBuzzerPulse();
  buzzerInterval = setInterval(() => {
    if (!isAlarmActive()) {
      stopAlarmLoop();
      return;
    }
    playBuzzerPulse();
  }, 600);
}

/**
 * Stops the persistent buzzer loop, immediately clearing timers and silencing sound.
 */
function stopAlarmLoop(): void {
  isLoopRunning = false;
  if (buzzerInterval) {
    clearInterval(buzzerInterval);
    buzzerInterval = null;
  }

  const ctx = getAudioContext();
  if (ctx && currentGain) {
    try {
      currentGain.gain.cancelScheduledValues(ctx.currentTime);
      currentGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    } catch {}
  }
  if (currentOsc) {
    try {
      currentOsc.stop();
    } catch {}
    currentOsc = null;
  }
  currentGain = null;
}

/**
 * Sets an alarm condition by key. Starts or stops the persistent loop as appropriate.
 */
export function setAlarmCondition(sourceKey: string, active: boolean): void {
  activeConditions.set(sourceKey, active);
  const shouldBeActive = isAlarmActive();
  if (shouldBeActive && !isLoopRunning) {
    startAlarmLoop();
  } else if (!shouldBeActive && isLoopRunning) {
    stopAlarmLoop();
  }
}

/**
 * React hook to bind an alarm condition to a component's lifecycle.
 * Prevents multiple components or re-renders from creating duplicate audio.
 */
export function useAlarmCondition(sourceKey: string, active: boolean): void {
  const hookIdRef = useRef<string | null>(null);
  if (!hookIdRef.current) {
    hookIdRef.current = `${sourceKey}_${Math.random().toString(36).substring(2, 9)}`;
  }

  useEffect(() => {
    const id = hookIdRef.current!;
    setAlarmCondition(id, active);
    return () => {
      setAlarmCondition(id, false);
    };
  }, [active]);
}
