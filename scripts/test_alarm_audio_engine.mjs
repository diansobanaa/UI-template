// scripts/test_alarm_audio_engine.mjs
// Verification suite for Web UI Audio Alarm Engine (SP-UI-AUDIO-ALARM-001)

import assert from "node:assert";

console.log("=== RUNNING WEB UI AUDIO ALARM ENGINE TEST SUITE ===");

// ----------------------------------------------------------------------------
// Mock Web Audio API & DOM environment
// ----------------------------------------------------------------------------
let createdOscillators = 0;
let createdGainNodes = 0;
let activeIntervals = 0;
let lastOscillatorFreq = 0;
let lastOscillatorType = "";
let currentOscState = "stopped";

class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime(val) { this.value = val; },
    exponentialRampToValueAtTime(val) { this.value = val; },
    cancelScheduledValues() {},
  };
  connect() {}
}

class MockOscillatorNode {
  type = "";
  frequency = {
    value: 0,
    setValueAtTime(val) { this.value = val; lastOscillatorFreq = val; },
  };
  onended = null;

  connect() {}
  start() {
    currentOscState = "started";
    lastOscillatorType = this.type;
  }
  stop() {
    currentOscState = "stopped";
    if (this.onended) this.onended();
  }
}

class MockAudioContext {
  state = "suspended";
  currentTime = 0;
  destination = {};

  createOscillator() {
    createdOscillators++;
    return new MockOscillatorNode();
  }

  createGain() {
    createdGainNodes++;
    return new MockGainNode();
  }

  async resume() {
    this.state = "running";
  }
}

const listeners = new Map();
globalThis.window = {
  AudioContext: MockAudioContext,
  addEventListener(event, fn) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(fn);
  },
  removeEventListener(event, fn) {
    if (!listeners.has(event)) return;
    const list = listeners.get(event);
    const idx = list.indexOf(fn);
    if (idx !== -1) list.splice(idx, 1);
  },
};

// ----------------------------------------------------------------------------
// Import the compiled/transpiled alarm audio module or simulate its exact logic
// ----------------------------------------------------------------------------
// We test using dynamic import of the TypeScript module via tsx / ts-node or run simulation
const {
  getAudioContext,
  unlockAudio,
  playBuzzerPulse,
  isAlarmActive,
  isAlarmLoopRunning,
  setAlarmCondition,
} = await import("../src/lib/alarm-audio.ts");

// ----------------------------------------------------------------------------
// Test 1: Initial state (clean standby)
// ----------------------------------------------------------------------------
console.log("\n[Test 1] Initial state check");
assert.strictEqual(isAlarmActive(), false, "Initial alarm state must be inactive");
assert.strictEqual(isAlarmLoopRunning(), false, "Initial loop must not be running");
console.log("  ✓ Alarm starts inactive with no running loop");

// ----------------------------------------------------------------------------
// Test 2: Autoplay compliance - unlock via gesture
// ----------------------------------------------------------------------------
console.log("\n[Test 2] Autoplay policy and user gesture unlock");
const ctx = getAudioContext();
assert.ok(ctx, "AudioContext initialized on demand");
assert.strictEqual(ctx.state, "suspended", "AudioContext should be suspended before gesture");

// Simulate user interaction (click/pointerdown)
unlockAudio();
assert.strictEqual(ctx.state, "running", "AudioContext resumes after user gesture unlock");
console.log("  ✓ AudioContext resumes properly upon user gesture");

// ----------------------------------------------------------------------------
// Test 3: ESP32 offline -> Audio ON (persistent 2400Hz pulse)
// ----------------------------------------------------------------------------
console.log("\n[Test 3] ESP32 offline triggers alarm audio ON");
const oscCountBefore = createdOscillators;
setAlarmCondition("esp32-offline", true);

assert.strictEqual(isAlarmActive(), true, "Alarm must be active when ESP32 is offline");
assert.strictEqual(isAlarmLoopRunning(), true, "Audio loop must be running");
assert.strictEqual(lastOscillatorFreq, 2400, "Oscillator frequency must be 2400 Hz (authentic buzzer)");
assert.strictEqual(lastOscillatorType, "square", "Oscillator waveform must be square wave");
assert.ok(createdOscillators > oscCountBefore, "Oscillator must be created for pulse");
console.log("  ✓ ESP32 offline starts 2400 Hz square-wave buzzer loop");

// ----------------------------------------------------------------------------
// Test 4: ESP32 remains offline (React re-render) -> No duplicate audio
// ----------------------------------------------------------------------------
console.log("\n[Test 4] ESP32 remains offline / re-render -> duplicate audio prevention");
const oscCountDuring = createdOscillators;
// Simulate 5 React re-renders calling setAlarmCondition
for (let i = 0; i < 5; i++) {
  setAlarmCondition("esp32-offline", true);
}
assert.strictEqual(isAlarmLoopRunning(), true, "Loop remains running");
// No additional oscillators created by re-renders
assert.strictEqual(createdOscillators, oscCountDuring, "Re-renders must NOT spawn duplicate oscillators");
console.log("  ✓ Re-renders while condition is unchanged do not create duplicate audio");

// ----------------------------------------------------------------------------
// Test 5: ESP32 back online -> Audio OFF
// ----------------------------------------------------------------------------
console.log("\n[Test 5] ESP32 back online -> Audio OFF");
setAlarmCondition("esp32-offline", false);
assert.strictEqual(isAlarmActive(), false, "Alarm must be inactive after ESP32 recovers");
assert.strictEqual(isAlarmLoopRunning(), false, "Audio loop must stop immediately");
console.log("  ✓ ESP32 recovery silences alarm and clears timers");

// ----------------------------------------------------------------------------
// Test 6: Tamper disconnected -> Audio ON
// ----------------------------------------------------------------------------
console.log("\n[Test 6] Tamper disconnected -> Audio ON");
setAlarmCondition("tamper-disconnected", true);
assert.strictEqual(isAlarmActive(), true, "Alarm must be active when Tamper is disconnected");
assert.strictEqual(isAlarmLoopRunning(), true, "Audio loop must be running");
assert.strictEqual(lastOscillatorFreq, 2400, "Buzzer frequency must be 2400 Hz");
console.log("  ✓ Tamper disconnected starts audio alarm loop");

// ----------------------------------------------------------------------------
// Test 7: Tamper remains disconnected -> No duplicate audio
// ----------------------------------------------------------------------------
console.log("\n[Test 7] Tamper remains disconnected -> duplicate protection");
const tamperOscBefore = createdOscillators;
for (let i = 0; i < 3; i++) {
  setAlarmCondition("tamper-disconnected", true);
}
assert.strictEqual(createdOscillators, tamperOscBefore, "No duplicate oscillators created");
console.log("  ✓ Duplicate protection holds for tamper alarm");

// ----------------------------------------------------------------------------
// Test 8: Tamper back connected -> Audio OFF
// ----------------------------------------------------------------------------
console.log("\n[Test 8] Tamper connected back -> Audio OFF");
setAlarmCondition("tamper-disconnected", false);
assert.strictEqual(isAlarmActive(), false, "Alarm must be inactive after Tamper loop closed");
assert.strictEqual(isAlarmLoopRunning(), false, "Audio loop must stop");
console.log("  ✓ Tamper loop restore silences alarm");

// ----------------------------------------------------------------------------
// Test 9: ESP32 offline + Tamper disconnected simultaneously -> Exactly ONE alarm
// ----------------------------------------------------------------------------
console.log("\n[Test 9] Simultaneous ESP32 offline + Tamper disconnected -> Single alarm instance");
const oscBeforeDual = createdOscillators;
setAlarmCondition("esp32-offline", true);
const oscAfterFirst = createdOscillators;
setAlarmCondition("tamper-disconnected", true);
const oscAfterSecond = createdOscillators;

assert.strictEqual(isAlarmActive(), true, "Alarm must be active");
assert.strictEqual(isAlarmLoopRunning(), true, "Audio loop must be running");
// Second trigger must not spawn a second concurrent loop/oscillator
assert.strictEqual(oscAfterSecond, oscAfterFirst, "Dual alarm must NOT spawn second concurrent oscillator");

// Clear one of them (tamper reconnects, but offline persists)
setAlarmCondition("tamper-disconnected", false);
assert.strictEqual(isAlarmActive(), true, "Alarm remains active while offline persists");
assert.strictEqual(isAlarmLoopRunning(), true, "Audio loop remains running for remaining condition");

// Clear the other (ESP32 online)
setAlarmCondition("esp32-offline", false);
assert.strictEqual(isAlarmActive(), false, "Alarm becomes inactive when all conditions clear");
assert.strictEqual(isAlarmLoopRunning(), false, "Audio loop stops cleanly");
console.log("  ✓ Dual trigger coalesces into exactly ONE alarm audio stream with clean partial resolution");

console.log("\n===============================================================");
console.log("ALL 9 AUDIO ALARM ENGINE TESTS PASSED SUCCESSFULLY!");
console.log("===============================================================\n");
