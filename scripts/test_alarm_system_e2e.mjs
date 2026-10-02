// Comprehensive E2E Verification Test Suite for ESP32 Physical & Safety Alarm System
// Target: http://192.168.0.151

const BASE_URL = process.env.ESP32_URL || "http://192.168.0.151";

function wrapEnvelope(payload) {
  return {
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    client: { type: "AlarmE2ETest", version: "1.0.0" },
    payload,
  };
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failedTests++;
  }
}

async function runSuite() {
  console.log(`\n======================================================`);
  console.log(`ESP32 PHYSICAL ALARM & SAFETY SYSTEM E2E TEST SUITE`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`======================================================\n`);

  // Test 1: Controller Health & Alarm Endpoint Discovery
  console.log(`TEST 1: Health & Boot State Verification`);
  const healthRes = await request("/api/v1/health");
  assert(healthRes.ok, `Health endpoint returns HTTP 200 (status: ${healthRes.status})`);
  assert(healthRes.data?.data?.deviceId === "esp32-gh-01", `Device ID is esp32-gh-01`);
  assert(healthRes.data?.data?.health === "HEALTHY", `System health is HEALTHY`);

  const initialAlarms = await request("/api/v1/alarms");
  assert(initialAlarms.ok, `GET /api/v1/alarms returns HTTP 200`);
  assert(initialAlarms.data?.data?.summary !== undefined, `Alarms summary object exists`);
  console.log(`  Initial Alarm Summary:`, initialAlarms.data?.data?.summary);

  // If there was an active E-Stop from previous test, resume it first
  if (initialAlarms.data?.data?.summary?.criticalCount > 0) {
    console.log(`  [CLEANUP] Resuming lingering E-Stop before tests...`);
    await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(wrapEnvelope({ commandId: `cleanup-${Date.now()}`, type: "RESUME" })),
    });
    await new Promise((r) => setTimeout(r, 600));
  }

  // Test 2: Status Endpoint includes Alarms summary
  console.log(`\nTEST 2: GET /api/v1/status Payload Integration`);
  const statusRes = await request("/api/v1/status");
  assert(statusRes.ok, `Status endpoint returns HTTP 200`);
  assert(statusRes.data?.data?.alarms !== undefined, `Status payload includes 'alarms' summary`);
  assert(typeof statusRes.data?.data?.alarms?.buzzerAudible === "boolean", `alarms.buzzerAudible is boolean`);

  // Test 3: Manual Buzzer Test (GPIO 18 bounded pulse)
  console.log(`\nTEST 3: Manual Buzzer Test (GPIO 18)`);
  const testTrigger = await request("/api/v1/alarms/test", {
    method: "POST",
    body: JSON.stringify({ durationMs: 800 }),
  });
  assert(testTrigger.ok, `POST /api/v1/alarms/test returns HTTP 200`);
  assert(testTrigger.data?.data?.summary?.testActive === true, `summary.testActive is true`);
  assert(testTrigger.data?.data?.summary?.buzzerAudible === true, `summary.buzzerAudible is true during test`);
  assert(testTrigger.data?.data?.summary?.activePattern === "TEST", `summary.activePattern is 'TEST'`);

  // Wait 1.3 seconds for 800ms pulse to expire
  console.log(`  Waiting 1300ms for bounded test pattern completion...`);
  await new Promise((r) => setTimeout(r, 1300));
  const postTestAlarms = await request("/api/v1/alarms");
  assert(postTestAlarms.data?.data?.summary?.testActive === false, `summary.testActive automatically reset to false`);
  assert(postTestAlarms.data?.data?.summary?.buzzerAudible === false, `summary.buzzerAudible returned to false`);
  assert(postTestAlarms.data?.data?.summary?.activePattern === "OFF", `summary.activePattern returned to 'OFF'`);

  // Test 4: Critical Alarm Trigger (Emergency Stop)
  console.log(`\nTEST 4: Critical Alarm Trigger via Emergency Stop`);
  const estopCmd = await request("/api/v1/commands/emergency-stop", {
    method: "POST",
    body: JSON.stringify(wrapEnvelope({ commandId: `estop-test-${Date.now()}`, reason: "Automated E2E Test" })),
  });
  assert(estopCmd.ok || estopCmd.status === 202, `Emergency stop accepted (status: ${estopCmd.status})`);

  const estopAlarms = await request("/api/v1/alarms");
  const estopSummary = estopAlarms.data?.data?.summary;
  assert(estopSummary?.activeCount >= 1, `Active alarm count is ${estopSummary?.activeCount} (>= 1)`);
  assert(estopSummary?.criticalCount >= 1, `Critical alarm count is ${estopSummary?.criticalCount} (>= 1)`);
  assert(estopSummary?.highestPriority === "CRITICAL", `Highest priority is CRITICAL`);
  assert(estopSummary?.buzzerAudible === true, `Buzzer is physically audible (GPIO 18 active cadence)`);
  assert(estopSummary?.activePattern === "CRITICAL", `Active buzzer pattern is CRITICAL`);

  const activeList = estopAlarms.data?.data?.activeAlarms || [];
  const estopAlarm = activeList.find((a) => a.code === "EMERGENCY_STOP_ACTIVE");
  assert(estopAlarm !== undefined, `Active alarm list contains 'EMERGENCY_STOP_ACTIVE'`);
  assert(estopAlarm?.acknowledged === false, `New alarm starts unacknowledged`);
  assert(estopAlarm?.silenced === false, `New alarm starts unsilenced`);

  // Test 5: Buzzer Test Cannot Override Critical Alarm
  console.log(`\nTEST 5: Priority Arbitration (Manual Test cannot override Critical)`);
  const testWhileCritical = await request("/api/v1/alarms/test", {
    method: "POST",
    body: JSON.stringify({ durationMs: 500 }),
  });
  assert(testWhileCritical.status === 409, `POST /api/v1/alarms/test during critical is correctly rejected with HTTP 409 Conflict (status: ${testWhileCritical.status})`);
  const alarmsDuringTest = await request("/api/v1/alarms");
  assert(alarmsDuringTest.data?.data?.summary?.highestPriority === "CRITICAL", `Highest priority remains CRITICAL`);
  assert(alarmsDuringTest.data?.data?.summary?.activePattern === "CRITICAL", `Pattern remains CRITICAL (not overridden by TEST)`);

  // Test 6: Silence Operation (Buzzer Muted, Alarm Stays Active)
  console.log(`\nTEST 6: Silence Operation`);
  const silenceRes = await request("/api/v1/alarms/silence", {
    method: "POST",
    body: JSON.stringify({ silence: true }),
  });
  assert(silenceRes.ok, `POST /api/v1/alarms/silence returns HTTP 200`);
  const silencedAlarms = await request("/api/v1/alarms");
  assert(silencedAlarms.data?.data?.summary?.buzzerAudible === false, `buzzerAudible is false after silence`);
  assert(silencedAlarms.data?.data?.summary?.isSilenced === true, `isSilenced is true`);
  assert(silencedAlarms.data?.data?.summary?.activeCount >= 1, `Active alarm count is STILL >= 1 (alarm not removed)`);

  // Test 7: Acknowledge Operation (Operator Recognition, E-Stop Retained)
  console.log(`\nTEST 7: Acknowledge Operation`);
  const ackRes = await request("/api/v1/alarms/acknowledge", {
    method: "POST",
    body: JSON.stringify({ alarmId: "EMERGENCY_STOP_ACTIVE" }),
  });
  assert(ackRes.ok, `POST /api/v1/alarms/acknowledge returns HTTP 200`);
  const ackAlarms = await request("/api/v1/alarms");
  const ackAlarmItem = ackAlarms.data?.data?.activeAlarms?.find((a) => a.code === "EMERGENCY_STOP_ACTIVE");
  assert(ackAlarmItem?.acknowledged === true, `Alarm acknowledged flag is true`);

  // Verify health confirms emergency stop is still latched/active
  const healthDuringAck = await request("/api/v1/health");
  assert(healthDuringAck.data?.data?.runtimeState === "EMERGENCY_STOP", `Runtime state is STILL EMERGENCY_STOP (not cleared by ack)`);

  // Test 8: Recovery & Resolution (Explicit RESUME)
  console.log(`\nTEST 8: System Recovery & Alarm Resolution`);
  const resumeCmd = await request("/api/v1/commands", {
    method: "POST",
    body: JSON.stringify(wrapEnvelope({ commandId: `resume-test-${Date.now()}`, type: "RESUME" })),
  });
  assert(resumeCmd.ok || resumeCmd.status === 202, `Resume command accepted (status: ${resumeCmd.status})`);

  await new Promise((r) => setTimeout(r, 600));
  const finalAlarms = await request("/api/v1/alarms");
  const finalSummary = finalAlarms.data?.data?.summary;
  assert(finalSummary?.activeCount === 0, `Active alarm count is 0 after resume`);
  assert(finalSummary?.criticalCount === 0, `Critical count is 0 after resume`);
  assert(finalSummary?.highestPriority === "NONE", `Highest priority returned to NONE`);
  assert(finalSummary?.buzzerAudible === false, `Buzzer returned to inactive`);
  assert(finalSummary?.activePattern === "OFF", `Pattern is OFF`);

  const recentList = finalAlarms.data?.data?.recentAlarms || [];
  const resolvedAlarm = recentList.find((a) => a.code === "EMERGENCY_STOP_ACTIVE");
  assert(resolvedAlarm !== undefined, `Resolved alarm moved to recentAlarms history`);
  assert(resolvedAlarm?.resolvedAt !== null, `resolvedAt timestamp is recorded`);

  // Test 9: Health returns to RUNNING
  const finalHealth = await request("/api/v1/health");
  assert(finalHealth.data?.data?.runtimeState === "RUNNING", `Runtime state returned to RUNNING`);

  console.log(`\n======================================================`);
  console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log(`======================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
