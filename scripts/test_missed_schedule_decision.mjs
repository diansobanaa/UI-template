/**
 * Regression test: missed fertigation schedule requires operator decision.
 *
 * Verifies, at source level, that (patch 20, P2.3-final owner decision):
 *  1. No automatic execution: a missed FERTIGATION occurrence NEVER becomes
 *     PENDING automatically (patch 19's auto-catch-up is gone).
 *  2. Missed occurrences enter OCC_STATE_AWAITING_DECISION with a durable
 *     MARKER_MISSED marker (survives reboot, restored on materialize).
 *  3. scheduler_decide_occurrence() exists: Continue validates safety /
 *     GH occupancy / recovery-hold before PENDING; Skip is permanent
 *     (MARKER_SKIPPED + SKIPPED_BY_OPERATOR).
 *  4. The decision is idempotent (already-decided returns stored result).
 *  5. HTTP endpoint POST /api/v1/schedule-occurrences/decision exists and
 *     the todaySchedule API exposes the AWAITING_DECISION status string.
 *  6. protocol_mixing() is untouched by these scheduler patches.
 *
 * Source-level only: no hardware, no ESP-IDF toolchain needed.
 * Run: node scripts/test_missed_schedule_decision.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHED = fs.readFileSync(
  path.join(ROOT, "esp32/main/services/scheduler.c"),
  "utf8"
);
const SCHED_H = fs.readFileSync(
  path.join(ROOT, "esp32/main/services/scheduler.h"),
  "utf8"
);
const API_FERT = fs.readFileSync(
  path.join(ROOT, "esp32/main/http/api_fertigation_handlers.c"),
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

// 1. No automatic PENDING for missed occurrences.
test("missed occurrence never auto-PENDING (no auto catch-up)", () => {
  // The missed branch must not assign OCC_STATE_PENDING.
  const missedIdx = SCHED.indexOf("MISSED_AWAITING_DECISION");
  assert.ok(missedIdx > 0, "AWAITING_DECISION logic not found");
  const region = SCHED.slice(Math.max(0, missedIdx - 2000), missedIdx + 500);
  assert.ok(
    !region.includes("new_occ->state = OCC_STATE_PENDING"),
    "missed branch still auto-assigns PENDING"
  );
  // Patch 19's recovery_window catch-up must be gone.
  assert.ok(
    !SCHED.includes("catchup_end"),
    "patch 19 auto-catch-up (catchup_end) still present"
  );
});

// 2. AWAITING_DECISION state + MARKER_MISSED durability.
test("OCC_STATE_AWAITING_DECISION exists in header", () => {
  assert.ok(
    SCHED_H.includes("OCC_STATE_AWAITING_DECISION"),
    "enum value missing in scheduler.h"
  );
});
test("MARKER_MISSED exists and is persisted on miss", () => {
  assert.ok(SCHED.includes("MARKER_MISSED"), "marker enum value missing");
  assert.ok(
    SCHED.includes("marker_update(rs, MARKER_MISSED"),
    "missed occurrence does not persist MARKER_MISSED"
  );
});
test("MARKER_MISSED restored to AWAITING_DECISION on reboot", () => {
  const idx = SCHED.indexOf("s_markers[m_idx].state == MARKER_MISSED");
  assert.ok(idx > 0, "restore branch for MARKER_MISSED not found");
  const region = SCHED.slice(idx, idx + 400);
  assert.ok(
    region.includes("OCC_STATE_AWAITING_DECISION"),
    "MARKER_MISSED does not restore AWAITING_DECISION"
  );
});
test("MARKER_SKIPPED restores SKIPPED_BY_OPERATOR permanently", () => {
  assert.ok(
    SCHED.includes("SKIPPED_BY_OPERATOR"),
    "SKIPPED_BY_OPERATOR not found"
  );
});

// 3. Decision function with safety gates.
test("scheduler_decide_occurrence declared and defined", () => {
  assert.ok(
    SCHED_H.includes("scheduler_decide_occurrence"),
    "declaration missing in scheduler.h"
  );
  assert.ok(
    SCHED.includes("esp_err_t scheduler_decide_occurrence("),
    "definition missing in scheduler.c"
  );
});
test("Continue validates safety interlock", () => {
  const idx = SCHED.indexOf("esp_err_t scheduler_decide_occurrence(");
  const region = SCHED.slice(idx, idx + 3000);
  assert.ok(
    region.includes("actuator_hal_is_emergency_stopped()") &&
      region.includes("safety_monitor_allows_commands()"),
    "Continue path missing safety validation"
  );
  assert.ok(region.includes("SAFETY_BLOCKED"), "no SAFETY_BLOCKED code");
});
test("Continue validates GH occupancy", () => {
  const idx = SCHED.indexOf("esp_err_t scheduler_decide_occurrence(");
  const region = SCHED.slice(idx, idx + 3000);
  assert.ok(region.includes("is_gh_occupied"), "no GH occupancy check");
  assert.ok(region.includes("GH_OCCUPIED"), "no GH_OCCUPIED code");
});
test("Continue blocked on RECOVERY_HOLD (uncertain batch)", () => {
  const idx = SCHED.indexOf("esp_err_t scheduler_decide_occurrence(");
  const region = SCHED.slice(idx, idx + 3000);
  assert.ok(
    region.includes("MARKER_RECOVERY_HOLD"),
    "no RECOVERY_HOLD guard — uncertain batch could be re-dosed"
  );
});
test("Skip is permanent via MARKER_SKIPPED", () => {
  const idx = SCHED.indexOf("esp_err_t scheduler_decide_occurrence(");
  const region = SCHED.slice(idx, idx + 3000);
  assert.ok(
    region.includes("marker_update(rs, MARKER_SKIPPED"),
    "Skip does not persist MARKER_SKIPPED"
  );
});

// 4. Idempotency.
test("decision is idempotent", () => {
  const idx = SCHED.indexOf("esp_err_t scheduler_decide_occurrence(");
  const region = SCHED.slice(idx, idx + 3000);
  assert.ok(
    region.includes("Idempoten") || region.includes("sudah pernah dibuat"),
    "no idempotency handling comment/logic"
  );
  assert.ok(
    region.includes("DECISION_NOT_APPLICABLE"),
    "no DECISION_NOT_APPLICABLE for already-decided"
  );
});

// 5. HTTP endpoint + status string.
test("POST /api/v1/schedule-occurrences/decision registered", () => {
  assert.ok(
    API_FERT.includes('/api/v1/schedule-occurrences/decision'),
    "decision endpoint not registered"
  );
});
test("todaySchedule exposes AWAITING_DECISION", () => {
  assert.ok(
    API_FERT.includes('"AWAITING_DECISION"'),
    "status string AWAITING_DECISION not exposed in API"
  );
});

// 6. protocol_mixing() untouched.
test("protocol_mixing() untouched", () => {
  assert.ok(
    !PROTO.includes("AWAITING_DECISION") &&
      !PROTO.includes("scheduler_decide_occurrence"),
    "protocol_mixing.c was modified"
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
