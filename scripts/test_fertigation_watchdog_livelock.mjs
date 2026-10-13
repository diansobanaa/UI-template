/**
 * Regression test: fertigation watchdog livelock (MAX_RUNTIME_EXCEEDED spam).
 *
 * Verifies, at source level, that:
 *  1. The max-runtime watchdog excludes terminal states + RECOVERY_HOLD
 *     (patch 07) so a FAULTED batch is not re-faulted ~3x/second forever.
 *  2. fertigation_mgr_resume() restarts the runtime budget (patch 08) so a
 *     stale NVS-restored s_run_start_ms cannot cause a false
 *     MAX_RUNTIME_EXCEEDED immediately after resume.
 *  3. The watchdog's legitimate fire path stops pumps BEFORE faulting.
 *  4. A FAULTED batch can return to IDLE via fertigation_mgr_cancel_batch()
 *     (operator recovery path -> new batches can start).
 *  5. protocol_mixing() is untouched by these watchdog patches.
 *
 * Source-level only: no hardware, no ESP-IDF toolchain needed.
 * Run: node scripts/test_fertigation_watchdog_livelock.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MGR = fs.readFileSync(
  path.join(ROOT, "esp32/main/services/fertigation_mgr.c"),
  "utf8"
);
const PROTO = fs.readFileSync(
  path.join(ROOT, "esp32/main/services/protocol_mixing.c"),
  "utf8"
);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL: ${name}\n      ${e.message.split("\n")[0]}`);
  }
}

// Extract the watchdog `if` condition block (the one mentioning max_runtime_sec).
function watchdogBlock() {
  const idx = MGR.indexOf("s_batch.max_runtime_sec > 0");
  assert.ok(idx > 0, "watchdog block not found");
  // Walk back to the start of the `if (` statement.
  const start = MGR.lastIndexOf("if (", idx);
  return MGR.slice(start, idx + 200);
}

test("1. Watchdog excludes FERT_STATE_FAULTED", () => {
  const b = watchdogBlock();
  assert.ok(
    b.includes("FERT_STATE_FAULTED"),
    "watchdog condition must mention FERT_STATE_FAULTED"
  );
});

test("2. Watchdog excludes ABORTED, INTERRUPTED, RECOVERY_HOLD", () => {
  const b = watchdogBlock();
  for (const s of [
    "FERT_STATE_ABORTED",
    "FERT_STATE_INTERRUPTED",
    "FERT_STATE_RECOVERY_HOLD",
  ]) {
    assert.ok(b.includes(s), `watchdog condition must exclude ${s}`);
  }
});

test("3. resume() resets s_run_start_ms before MIXING", () => {
  const rIdx = MGR.indexOf("esp_err_t fertigation_mgr_resume(void)");
  assert.ok(rIdx > 0, "fertigation_mgr_resume not found");
  const body = MGR.slice(rIdx, rIdx + 1200);
  const resetIdx = body.indexOf("s_run_start_ms = wallclock_ms()");
  const transIdx = body.indexOf("transition(FERT_STATE_MIXING)");
  assert.ok(resetIdx > 0, "resume() must reset s_run_start_ms");
  assert.ok(transIdx > 0, "resume() must transition to MIXING");
  assert.ok(
    resetIdx < transIdx,
    "runtime reset must happen BEFORE transition to MIXING"
  );
});

test("4. Watchdog fire path calls stop_all() before FAULTED", () => {
  const idx = MGR.indexOf('persist_run("MAX_RUNTIME_EXCEEDED")');
  assert.ok(idx > 0, "MAX_RUNTIME_EXCEEDED site not found");
  const ctx = MGR.slice(idx - 300, idx);
  assert.ok(ctx.includes("stop_all()"), "stop_all() must precede FAULTED");
  assert.ok(
    ctx.includes("s_state = FERT_STATE_FAULTED"),
    "must transition to FAULTED"
  );
  assert.ok(
    ctx.indexOf("stop_all()") < ctx.indexOf("s_state = FERT_STATE_FAULTED"),
    "pumps must stop BEFORE state becomes FAULTED"
  );
});

test("5. cancel_batch() recovers FAULTED -> IDLE", () => {
  const cIdx = MGR.indexOf("esp_err_t fertigation_mgr_cancel_batch(void)");
  assert.ok(cIdx > 0, "fertigation_mgr_cancel_batch not found");
  const body = MGR.slice(cIdx, cIdx + 1500);
  assert.ok(body.includes("stop_all()"), "cancel must stop actuators");
  assert.ok(
    body.includes("s_state = FERT_STATE_IDLE"),
    "cancel must return to IDLE so new batches can start"
  );
});

test("6. protocol_mixing() signature intact (not bypassed/replaced)", () => {
  assert.ok(
    /mixing_result_t\s+protocol_mixing\s*\(\s*const\s+mixing_protocol_config_t/.test(
      PROTO
    ),
    "protocol_mixing() production signature must be intact"
  );
});

test("7. Watchdog still guards genuinely running states", () => {
  const b = watchdogBlock();
  // The guard must still trigger for MIXING (i.e. MIXING must NOT be excluded).
  assert.ok(
    !b.includes("s_state != FERT_STATE_MIXING"),
    "MIXING must remain watchdog-guarded"
  );
  assert.ok(
    b.includes("s_run_start_ms > 0"),
    "guard must still require a valid start timestamp"
  );
});

console.log(`\nTEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
process.exit(failed ? 1 : 0);
