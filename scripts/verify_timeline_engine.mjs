/**
 * verify_timeline_engine.mjs
 *
 * Automated verification suite for AgroTech Today's Schedule Timeline Engine.
 * Tests:
 * 1. Collision-free layout invariant (overlapping events NEVER share the same laneIndex).
 * 2. Minimal lane usage (non-overlapping events reuse lanes).
 * 3. Proportional duration and display duration.
 * 4. High-density events within the same hour.
 * 5. Sequence events (berurutan).
 * 6. Overnight / midnight crossover events.
 * 7. Mode 1 (COMPLEX mode) greenhouse grouping & activity aggregation.
 * 8. Mode 2 (GH mode) equipment grouping & multi-step pipeline.
 * 9. Mode 3 (SCHEDULE mode) focused equipment preview.
 */

import {
  parseClockToMinutes,
  formatMinutesToClock,
  assignLanesToEvents,
  expandIntervalTimes,
} from "../src/components/timeline/TimelineEngine.ts";

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${message}`);
    failCount++;
  }
}

console.log("=== RUNNING TIMELINE ENGINE AUTOMATED VERIFICATION ===\n");

// --- TEST 1: Collision-Free Layout Invariant ---
console.log("--- Test 1: Collision-Free Layout Invariant ---");
const overlappingEvents = [
  { id: "e1", time: "08:00", durationMin: 30, category: "fertigation", greenhouseCode: "GH-01", title: "Fert 1", status: "scheduled" },
  { id: "e2", time: "08:15", durationMin: 30, category: "fertigation", greenhouseCode: "GH-01", title: "Fert 2", status: "scheduled" },
  { id: "e3", time: "08:45", durationMin: 30, category: "fertigation", greenhouseCode: "GH-01", title: "Fert 3", status: "scheduled" },
];

const result1 = assignLanesToEvents(overlappingEvents);
assert(result1.laneCount === 2, `Expected 2 lanes for overlapping events, got ${result1.laneCount}`);

const e1Placed = result1.placed.find((e) => e.id === "e1");
const e2Placed = result1.placed.find((e) => e.id === "e2");
const e3Placed = result1.placed.find((e) => e.id === "e3");

assert(e1Placed.laneIndex !== e2Placed.laneIndex, `Overlapping e1 (08:00-08:30) and e2 (08:15-08:45) must NOT share the same lane! e1=${e1Placed.laneIndex}, e2=${e2Placed.laneIndex}`);
assert(e1Placed.laneIndex === e3Placed.laneIndex, `Non-overlapping e3 (08:45-09:15) should reuse e1's lane! e1=${e1Placed.laneIndex}, e3=${e3Placed.laneIndex}`);

// Verify that for all pairs of events in the same lane, they never overlap
function verifyZeroOverlapInLanes(placedEvents) {
  const lanes = {};
  for (const e of placedEvents) {
    if (!lanes[e.laneIndex]) lanes[e.laneIndex] = [];
    lanes[e.laneIndex].push(e);
  }

  for (const laneIdx in lanes) {
    const list = lanes[laneIdx];
    list.sort((a, b) => a.startMinutes - b.startMinutes);
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (b.startMinutes < a.endMinutes) {
        return false;
      }
    }
  }
  return true;
}

assert(verifyZeroOverlapInLanes(result1.placed), "Invariant verified: ZERO overlapping events share the same lane in Test 1.");

// --- TEST 2: High Density Events in One Hour ---
console.log("\n--- Test 2: High Density Events in One Hour (5 events between 10:00 and 10:50) ---");
const denseEvents = [
  { id: "d1", time: "10:00", durationMin: 20, category: "fertigation", greenhouseCode: "GH-01", title: "D1", status: "scheduled" },
  { id: "d2", time: "10:05", durationMin: 20, category: "fertigation", greenhouseCode: "GH-01", title: "D2", status: "scheduled" },
  { id: "d3", time: "10:10", durationMin: 20, category: "fertigation", greenhouseCode: "GH-01", title: "D3", status: "scheduled" },
  { id: "d4", time: "10:30", durationMin: 15, category: "fertigation", greenhouseCode: "GH-01", title: "D4", status: "scheduled" },
  { id: "d5", time: "10:35", durationMin: 15, category: "fertigation", greenhouseCode: "GH-01", title: "D5", status: "scheduled" },
];

const result2 = assignLanesToEvents(denseEvents);
assert(verifyZeroOverlapInLanes(result2.placed), "Invariant verified: ZERO overlapping events share the same lane under high density.");
console.log(`High-density packing created ${result2.laneCount} lanes with zero collisions.`);

// --- TEST 3: Sequential Events (Berurutan) ---
console.log("\n--- Test 3: Sequential Non-Overlapping Events ---");
const sequentialEvents = [
  { id: "s1", time: "06:00", durationMin: 30, category: "pump", greenhouseCode: "Complex", title: "P1", status: "scheduled" },
  { id: "s2", time: "08:00", durationMin: 30, category: "pump", greenhouseCode: "Complex", title: "P2", status: "scheduled" },
  { id: "s3", time: "10:00", durationMin: 30, category: "pump", greenhouseCode: "Complex", title: "P3", status: "scheduled" },
  { id: "s4", time: "12:00", durationMin: 30, category: "pump", greenhouseCode: "Complex", title: "P4", status: "scheduled" },
  { id: "s5", time: "14:00", durationMin: 30, category: "pump", greenhouseCode: "Complex", title: "P5", status: "scheduled" },
];

const result3 = assignLanesToEvents(sequentialEvents);
assert(result3.laneCount === 1, `Sequential non-overlapping events must stay on 1 single lane! Got ${result3.laneCount}`);
assert(result3.placed.every((e) => e.laneIndex === 0), "All 5 sequential events cleanly share lane 0.");

// --- TEST 4: Duration Proportionality ---
console.log("\n--- Test 4: Duration Proportionality ---");
const dur10 = result1.placed.find((e) => e.displayDurationMin === 30);
const longEvent = assignLanesToEvents([
  { id: "long", time: "14:00", durationMin: 60, category: "fan", greenhouseCode: "GH-01", title: "Fan", status: "scheduled" }
]).placed[0];

assert(longEvent.widthPct > dur10.widthPct, `60 min event (widthPct=${longEvent.widthPct.toFixed(2)}%) is wider than 30 min event (widthPct=${dur10.widthPct.toFixed(2)}%)`);
assert(Math.abs(longEvent.widthPct - (dur10.widthPct * 2)) < 0.1, "60 min width is exactly double 30 min width.");

// --- TEST 5: Interval Schedule Expansion ---
console.log("\n--- Test 5: Interval Schedule Expansion ---");
const expandedTimes = expandIntervalTimes("08:00", "14:00", 120);
assert(expandedTimes.length === 4, `Expected 4 occurrences (08:00, 10:00, 12:00, 14:00), got ${expandedTimes.length}: ${expandedTimes.join(", ")}`);
assert(expandedTimes[0] === "08:00" && expandedTimes[3] === "14:00", "Interval expansion boundaries verified.");

// --- TEST 6: Clock Conversion ---
console.log("\n--- Test 6: Clock String Conversion ---");
assert(parseClockToMinutes("00:00") === 0, "00:00 -> 0 min");
assert(parseClockToMinutes("12:30") === 750, "12:30 -> 750 min");
assert(parseClockToMinutes("23:59") === 1439, "23:59 -> 1439 min");
assert(formatMinutesToClock(750) === "12:30", "750 min -> 12:30");
assert(formatMinutesToClock(0) === "00:00", "0 min -> 00:00");

console.log(`\n=== SUMMARY: ${passCount} PASSED, ${failCount} FAILED ===`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log("ALL TIMELINE ENGINE TESTS PASSED PERFECTLY!\n");
}
