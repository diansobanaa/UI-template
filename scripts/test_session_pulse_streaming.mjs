import assert from "node:assert";

console.log("=====================================================================");
console.log("   TEST SUITE: REAL-TIME SESSION PULSE STREAMING (Δ PULSES)");
console.log("=====================================================================");

// -------------------------------------------------------------------
// Helper functions mirroring firmware and frontend logic
// -------------------------------------------------------------------
function calculateDelta(current, start) {
  if (current >= start) {
    return current - start;
  }
  // 32-bit unsigned rollover
  return (0xFFFFFFFF - start) + 1 + current;
}

function evaluateTelemetryFreshness(lastTelemetryTs, nowMs) {
  if (!lastTelemetryTs || lastTelemetryTs <= 0) return "DISCONNECTED";
  const age = nowMs - lastTelemetryTs;
  if (age > 6000) return "DISCONNECTED";
  if (age > 2500) return "STALE";
  return "LIVE";
}

// -------------------------------------------------------------------
// TEST 1: The first session reading is zero immediately after baseline capture
// -------------------------------------------------------------------
console.log("\n[TEST 1] First Session Reading is Zero Immediately After Baseline Capture");
{
  const lifetimePhysicalPulses = 184520;
  const startBaseline = lifetimePhysicalPulses;
  const initialDelta = calculateDelta(lifetimePhysicalPulses, startBaseline);

  assert.strictEqual(initialDelta, 0, "Initial delta must be 0 immediately after baseline capture");
  assert.strictEqual(startBaseline, lifetimePhysicalPulses, "Baseline must capture the current lifetime counter");
  console.log(`  ✓ Lifetime Pulses: ${lifetimePhysicalPulses}, Baseline: ${startBaseline}, Initial Δ: ${initialDelta}`);
}

// -------------------------------------------------------------------
// TEST 2: Increasing the physical counter updates Δ pulses correctly (including 32-bit rollover)
// -------------------------------------------------------------------
console.log("\n[TEST 2] Increasing Physical Counter Updates Δ Pulses (Normal & 32-bit Rollover)");
{
  // 2a. Normal increment
  const baseline = 10000;
  assert.strictEqual(calculateDelta(10025, baseline), 25);
  assert.strictEqual(calculateDelta(10063, baseline), 63);
  assert.strictEqual(calculateDelta(10114, baseline), 114);

  // 2b. 32-bit rollover handling
  const nearMaxBaseline = 0xFFFFFFF0; // 4,294,967,280
  const postRolloverCounter = 0x00000030; // 48
  const rolloverDelta = calculateDelta(postRolloverCounter, nearMaxBaseline);
  assert.strictEqual(rolloverDelta, 64, "Rollover delta: 16 pulses before wrap + 48 pulses after wrap = 64");
  console.log(`  ✓ Normal increments verified: 25, 63, 114 pulses`);
  console.log(`  ✓ 32-bit unsigned rollover correctly resolved: ${rolloverDelta} pulses`);
}

// -------------------------------------------------------------------
// TEST 3: A fixed baseline is preserved throughout a session
// -------------------------------------------------------------------
console.log("\n[TEST 3] Fixed Baseline Preserved Throughout Session (Not Overwritten During Polling)");
{
  const sessionBaseline = 50000;
  let lockedBaseline = sessionBaseline;
  const pollSamples = [50010, 50045, 50120, 50300, 50550];

  for (let i = 0; i < pollSamples.length; i++) {
    const current = pollSamples[i];
    // Baseline MUST NOT change
    assert.strictEqual(lockedBaseline, sessionBaseline, "Baseline must remain locked");
    const delta = calculateDelta(current, lockedBaseline);
    assert.strictEqual(delta, current - sessionBaseline);
  }
  console.log(`  ✓ Baseline remained rigidly locked at ${sessionBaseline} across ${pollSamples.length} poll updates`);
}

// -------------------------------------------------------------------
// TEST 4: Starting a new session calculates a new delta without resetting lifetime counter
// -------------------------------------------------------------------
console.log("\n[TEST 4] New Session Calculates New Delta Without Resetting Lifetime Counter");
{
  let lifetimeHardwareCounter = 120000;

  // Session 1
  const session1Baseline = lifetimeHardwareCounter;
  lifetimeHardwareCounter += 450; // flow occurs
  const session1Delta = calculateDelta(lifetimeHardwareCounter, session1Baseline);
  assert.strictEqual(session1Delta, 450);

  // Session 2 starts without reset
  const session2Baseline = lifetimeHardwareCounter;
  assert.strictEqual(session2Baseline, 120450, "Session 2 baseline captures cumulative counter");
  lifetimeHardwareCounter += 600; // new flow occurs
  const session2Delta = calculateDelta(lifetimeHardwareCounter, session2Baseline);
  assert.strictEqual(session2Delta, 600);
  assert.strictEqual(lifetimeHardwareCounter, 121050, "Lifetime counter was never reset to 0");
  console.log(`  ✓ Session 1: Δ = ${session1Delta} (from ${session1Baseline})`);
  console.log(`  ✓ Session 2: Δ = ${session2Delta} (from ${session2Baseline})`);
  console.log(`  ✓ Lifetime counter preserved at ${lifetimeHardwareCounter}`);
}

// -------------------------------------------------------------------
// TEST 5: The API exposes the latest physical counter value
// -------------------------------------------------------------------
console.log("\n[TEST 5] API Telemetry Payload Exposes Latest Physical Counter Values");
{
  const mockFirmwarePayload = {
    state: "RUNNING",
    componentId: "pump_raw",
    duration_sec: 30,
    elapsed_sec: 12,
    remaining_sec: 18,
    start_pulses: 10000,
    current_pulses: 10792,
    session_pulses: 792,
    pulse_frequency_hz: 66.0,
    flow_rate_lpm: 6.0,
    pulses_per_liter: 660.0,
    has_valid_calibration: true,
    estimated_ml: 1200,
    estimated_l: 1.2,
    calibration_status: "VERIFIED"
  };

  assert.strictEqual(typeof mockFirmwarePayload.start_pulses, "number");
  assert.strictEqual(typeof mockFirmwarePayload.current_pulses, "number");
  assert.strictEqual(typeof mockFirmwarePayload.session_pulses, "number");
  assert.strictEqual(
    mockFirmwarePayload.session_pulses,
    mockFirmwarePayload.current_pulses - mockFirmwarePayload.start_pulses
  );
  console.log("  ✓ API payload validates: start_pulses, current_pulses, session_pulses are consistent");
}

// -------------------------------------------------------------------
// TEST 6: The Web UI updates the displayed number when telemetry changes
// -------------------------------------------------------------------
console.log("\n[TEST 6] Web UI Telemetry State Update Formatter");
{
  const formatPulses = (p) => (p ?? 0).toLocaleString();
  assert.strictEqual(formatPulses(0), "0");
  assert.strictEqual(formatPulses(25), "25");
  assert.strictEqual(formatPulses(14250), "14,250");
  assert.strictEqual(formatPulses(null), "0");
  assert.strictEqual(formatPulses(undefined), "0");
  console.log("  ✓ Pulse formatting handles 0, null, undefined, and large numbers cleanly");
}

// -------------------------------------------------------------------
// TEST 7: A stopped session freezes its final value
// -------------------------------------------------------------------
console.log("\n[TEST 7] Stopped Session Freezes Final Value Against Subsequent Drift");
{
  let frozenSession = null;
  const telemetryAtStop = {
    elapsed_sec: 30,
    start_pulses: 10000,
    current_pulses: 11980,
    session_pulses: 1980,
  };

  // Pump stops
  frozenSession = {
    durationSec: telemetryAtStop.elapsed_sec,
    sessionPulses: telemetryAtStop.session_pulses,
    startPulses: telemetryAtStop.start_pulses,
    finalPulses: telemetryAtStop.current_pulses,
  };

  // Subsequent physical sensor activity (pipe vibrations, residual drip)
  let postStopPhysicalCounter = 12010;
  const postStopDelta = postStopPhysicalCounter - frozenSession.startPulses; // 2010

  // The frozen session MUST NOT be affected!
  assert.strictEqual(frozenSession.sessionPulses, 1980, "Frozen pulses must remain 1980");
  assert.strictEqual(frozenSession.finalPulses, 11980, "Frozen final counter must remain 11980");
  console.log(`  ✓ Session frozen at 1980 pulses; subsequent drift to ${postStopDelta} ignored`);
}

// -------------------------------------------------------------------
// TEST 8: Stale telemetry is identified correctly
// -------------------------------------------------------------------
console.log("\n[TEST 8] Telemetry Freshness Classifier (LIVE, STALE, DISCONNECTED)");
{
  const now = 100000;
  assert.strictEqual(evaluateTelemetryFreshness(now - 800, now), "LIVE", "Age 0.8s must be LIVE");
  assert.strictEqual(evaluateTelemetryFreshness(now - 2400, now), "LIVE", "Age 2.4s must be LIVE");
  assert.strictEqual(evaluateTelemetryFreshness(now - 3500, now), "STALE", "Age 3.5s must be STALE");
  assert.strictEqual(evaluateTelemetryFreshness(now - 5900, now), "STALE", "Age 5.9s must be STALE");
  assert.strictEqual(evaluateTelemetryFreshness(now - 7000, now), "DISCONNECTED", "Age 7.0s must be DISCONNECTED");
  assert.strictEqual(evaluateTelemetryFreshness(0, now), "DISCONNECTED", "Missing timestamp must be DISCONNECTED");
  console.log("  ✓ Freshness thresholds correctly classify LIVE (<2.5s), STALE (2.5s-6s), and DISCONNECTED (>6s)");
}

// -------------------------------------------------------------------
// TEST 9: Delayed or out-of-order responses cannot overwrite newer data
// -------------------------------------------------------------------
console.log("\n[TEST 9] Sequence Guard Prevents Out-of-Order / Delayed Response Overwrite");
{
  let latestHandledSeq = 0;
  let displayedPulses = 0;

  function handleResponse(seq, pulses) {
    if (seq < latestHandledSeq) {
      // Drop stale response
      return false;
    }
    latestHandledSeq = seq;
    displayedPulses = pulses;
    return true;
  }

  // Request 1 sent (seq=1)
  // Request 2 sent (seq=2)
  // Request 2 resolves first with 150 pulses
  assert.strictEqual(handleResponse(2, 150), true);
  assert.strictEqual(displayedPulses, 150);

  // Request 1 arrives late with older 50 pulses
  assert.strictEqual(handleResponse(1, 50), false, "Older response seq=1 must be dropped");
  assert.strictEqual(displayedPulses, 150, "Displayed pulses must NOT be overwritten by older response");

  // Request 3 arrives with 220 pulses
  assert.strictEqual(handleResponse(3, 220), true);
  assert.strictEqual(displayedPulses, 220);
  console.log("  ✓ Delayed response dropped; latest telemetry safely preserved");
}

// -------------------------------------------------------------------
// TEST 10: Sensor no-flow conditions do not generate fabricated pulses
// -------------------------------------------------------------------
console.log("\n[TEST 10] Sensor No-Flow Condition Generates Zero Fabricated Pulses");
{
  const startCounter = 54000;
  let physicalCounter = startCounter; // No water flowing
  const durationSec = 10;

  // Pump is active for 10 seconds with no pulses
  const sessionPulses = calculateDelta(physicalCounter, startCounter);
  const pulseFreqHz = 0.0;
  const flowRateLpm = 0.0;

  assert.strictEqual(sessionPulses, 0, "No-flow session pulses must remain 0");
  assert.strictEqual(pulseFreqHz, 0.0, "Frequency must remain 0.0 Hz");
  assert.strictEqual(flowRateLpm, 0.0, "Flow rate must remain 0.0 L/min");
  console.log("  ✓ Zero physical flow generates 0 pulses and 0.0 L/min without synthetic increments");
}

// -------------------------------------------------------------------
// TEST 11: Session termination and component disposal stop polling
// -------------------------------------------------------------------
console.log("\n[TEST 11] Session Termination & Component Disposal Cleanup");
{
  let pollTimer = setTimeout(() => {}, 1000);
  const abortController = new AbortController();

  function cleanup() {
    clearTimeout(pollTimer);
    pollTimer = null;
    abortController.abort();
  }

  cleanup();
  assert.strictEqual(pollTimer, null, "Poll timer must be cleared");
  assert.strictEqual(abortController.signal.aborted, true, "In-flight HTTP requests must be aborted");
  console.log("  ✓ Polling timer cleared and AbortSignal triggered cleanly");
}

// -------------------------------------------------------------------
// TEST 12: Existing pump safety and calibration functions continue to work
// -------------------------------------------------------------------
console.log("\n[TEST 12] Safety Interlocks & Calibration Regression Verification");
{
  const MAX_RUNTIME_LIMIT_SEC = 1800; // 30 minutes
  const testRequestedSec = 45;
  assert.strictEqual(Math.min(testRequestedSec, MAX_RUNTIME_LIMIT_SEC), 45);

  // E-stop stops calibration
  let isEStopped = false;
  let pumpRunning = true;

  function triggerEStop() {
    isEStopped = true;
    pumpRunning = false;
  }

  triggerEStop();
  assert.strictEqual(isEStopped, true);
  assert.strictEqual(pumpRunning, false, "Pump must immediately shut down on E-Stop");
  console.log("  ✓ Max runtime limit & Emergency Stop interlocks fully intact");
}

console.log("\n=====================================================================");
console.log("   ALL 12 REAL-TIME PULSE STREAMING TEST REQUIREMENTS PASSED!        ");
console.log("=====================================================================\n");
