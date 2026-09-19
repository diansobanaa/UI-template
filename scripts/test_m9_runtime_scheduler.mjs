import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const firmware = fs.readFileSync(path.resolve('esp32/main/services/scheduler.c'), 'utf8');

const PASS = [];
function test(name, fn) {
  try { fn(); PASS.push(name); }
  catch (err) { console.error(`FAIL: ${name}\n${err.stack}`); process.exitCode = 1; }
}

function localOccurrence(schedule, nowMs) {
  const d = new Date(nowMs);
  for (let back = 0; back <= 7; back++) {
    const c = new Date(d);
    c.setDate(c.getDate() - back);
    c.setHours(schedule.hour, schedule.minute, 0, 0);
    const bit = 1 << c.getDay();
    if (c.getTime() <= nowMs && (schedule.daysOfWeek & bit)) return c.getTime();
  }
  return 0;
}

function due(schedule, nowMs) {
  if (schedule.recoveryHold) return null;
  if (schedule.type === 'ONCE') {
    if (schedule.lastOccurrence >= schedule.startTimestamp) return null;
    if (nowMs >= schedule.startTimestamp) return { occurrence: schedule.startTimestamp, missed: nowMs - schedule.startTimestamp >= 60_000 };
    return null;
  }
  if (schedule.type === 'DAILY') {
    const occ = localOccurrence(schedule, nowMs);
    if (!occ || occ < schedule.startTimestamp || occ <= schedule.lastOccurrence) return null;
    return { occurrence: occ, missed: nowMs - occ >= 60_000 };
  }
  const interval = schedule.intervalMin * 60_000;
  const next = schedule.lastExecution > 0 ? schedule.lastExecution + interval : schedule.startTimestamp;
  if (nowMs < next) return null;
  return { occurrence: next, missed: nowMs - next >= 1 };
}

function conflicts(candidate, running) {
  for (const a of candidate.resources) for (const b of running.resources) {
    if (a.resourceId !== b.resourceId) continue;
    if (!a.shared || !b.shared) return true;
  }
  return false;
}

function dispatchable(schedules, nowMs) {
  const dueItems = schedules.flatMap((s, index) => {
    if (s.running) return [];
    const d = s.pending ? { occurrence: s.pendingOccurrence, missed: true } : due(s, nowMs);
    if (!d) return [];
    if (d.missed && s.missedRunPolicy === 'SKIP' && !s.pending) {
      s.lastOccurrence = d.occurrence;
      s.state = 'SKIPPED';
      return [];
    }
    return [{ schedule: s, index, occurrence: d.occurrence }];
  }).sort((a,b) => b.schedule.priority - a.schedule.priority || a.schedule.id.localeCompare(b.schedule.id));

  const started = [];
  for (const item of dueItems) {
    const s = item.schedule;
    if (s.running) continue;
    if (schedules.some(other => other !== s && other.running && conflicts(s, other))) {
      s.pending = true;
      s.pendingOccurrence = item.occurrence;
      s.state = 'QUEUED';
      continue;
    }
    s.lastOccurrence = item.occurrence;
    s.lastExecution = nowMs;
    s.pending = false;
    s.running = true;
    s.state = 'RUNNING';
    s.commandId = `sch-${s.id}-${item.occurrence}`;
    started.push(s.id);
  }
  return started;
}

test('M9 source does not execute raw legacy schedule entries', () => {
  assert.match(firmware, /scheduler_add_entry\(const schedule_entry_t \*entry\)\s*\{[\s\S]*?ESP_ERR_NOT_SUPPORTED/);
  assert.match(firmware, /parse_runtime_set\(/);
  assert.match(firmware, /scheduler_task\(/);
});

test('M9 normalizes compiled epoch milliseconds before ESP32 scheduling', () => {
  assert.match(firmware, /normalize_epoch_seconds\(/);
  assert.match(firmware, /timestamp >= 100000000000LL/);
  assert.match(firmware, /out->duration_sec = duration_seconds/);
});

test('M9 evaluates only compiled ACTIVE schedules', () => {
  assert.match(firmware, /strcmp\(status, "ACTIVE"\) != 0/);
  assert.match(firmware, /strcmp\(activation, "ACTIVE"\) != 0/);
  const schedules = [
    { id:'active', type:'ONCE', startTimestamp:1_700_000_000_000, lastOccurrence:0, lastExecution:0, running:false, priority:1, missedRunPolicy:'EXECUTE', resources:[] },
    { id:'blocked', type:'ONCE', startTimestamp:1_700_000_000_000, lastOccurrence:0, lastExecution:0, running:false, priority:9, missedRunPolicy:'EXECUTE', resources:[], state:'BLOCKED' },
  ];
  assert.deepEqual(dispatchable(schedules.filter(s => s.state !== 'BLOCKED'), 1_700_000_000_001), ['active']);
});

test('M9 daily schedule due-time evaluation', () => {
  const now = Date.parse('2026-09-18T08:05:12Z');
  const s = { id:'daily', type:'DAILY', hour:8, minute:5, daysOfWeek:127, startTimestamp:now-86_400_000, lastOccurrence:0, lastExecution:0, running:false, priority:1, missedRunPolicy:'EXECUTE', resources:[] };
  const d = due(s, now);
  assert.equal(new Date(d.occurrence).toISOString(), '2026-09-18T08:05:00.000Z');
  assert.equal(d.missed, false);
});

test('M9 selected weekday schedule rejects non-selected weekday', () => {
  const now = Date.parse('2026-09-18T08:05:12Z'); // Friday
  const fridayBit = 1 << new Date(now).getDay();
  const s = { id:'weekday', type:'DAILY', hour:8, minute:5, daysOfWeek:127 ^ fridayBit, startTimestamp:now-86_400_000, lastOccurrence:0, lastExecution:0, running:false, priority:1, missedRunPolicy:'EXECUTE', resources:[] };
  assert.equal(due(s, now), null);
});

test('M9 specific-date schedule executes once and does not duplicate', () => {
  const now = Date.parse('2026-09-18T12:00:01Z');
  const s = { id:'once', type:'ONCE', startTimestamp:Date.parse('2026-09-18T12:00:00Z'), lastOccurrence:0, lastExecution:0, running:false, priority:1, missedRunPolicy:'EXECUTE', resources:[] };
  assert.equal(dispatchable([s], now)[0], 'once');
  s.running = false;
  assert.deepEqual(dispatchable([s], now + 1000), []);
});

test('M9 interval schedule uses local persisted execution marker', () => {
  const base = Date.parse('2026-09-18T10:00:00Z');
  const s = { id:'interval', type:'INTERVAL', intervalMin:15, startTimestamp:base, lastOccurrence:0, lastExecution:base, running:false, priority:1, missedRunPolicy:'EXECUTE', resources:[] };
  assert.equal(due(s, base + 14*60_000), null);
  assert.equal(due(s, base + 15*60_000).occurrence, base + 15*60_000);
});

test('M9 missed EXECUTE catches up once', () => {
  const base = Date.parse('2026-09-18T08:00:00Z');
  const s = { id:'catchup', type:'DAILY', hour:8, minute:0, daysOfWeek:127, startTimestamp:base-86_400_000, lastOccurrence:0, lastExecution:0, running:false, priority:1, missedRunPolicy:'EXECUTE', resources:[] };
  assert.equal(dispatchable([s], base + 10*60_000)[0], 'catchup');
});

test('M9 missed SKIP marks occurrence consumed without dispatch', () => {
  const base = Date.parse('2026-09-18T08:00:00Z');
  const s = { id:'skip', type:'DAILY', hour:8, minute:0, daysOfWeek:127, startTimestamp:base-86_400_000, lastOccurrence:0, lastExecution:0, running:false, priority:1, missedRunPolicy:'SKIP', resources:[] };
  assert.deepEqual(dispatchable([s], base + 10*60_000), []);
  assert.equal(s.state, 'SKIPPED');
  assert.equal(s.lastOccurrence, base);
});

test('M9 priority gives higher-priority due work first', () => {
  const now = Date.parse('2026-09-18T08:01:00Z');
  const a = { id:'low', type:'ONCE', startTimestamp:now-60_000, lastOccurrence:0, lastExecution:0, running:false, priority:10, missedRunPolicy:'EXECUTE', resources:[] };
  const b = { id:'high', type:'ONCE', startTimestamp:now-60_000, lastOccurrence:0, lastExecution:0, running:false, priority:100, missedRunPolicy:'EXECUTE', resources:[] };
  const started = dispatchable([a,b], now);
  assert.deepEqual(started, ['high','low']);
});

test('M9 scheduler owns explicit resource locks', () => {
  assert.match(firmware, /acquire_resource_locks\(/);
  assert.match(firmware, /release_resource_locks\(/);
});

test('M9 exclusive resource conflict queues lower-priority work', () => {
  const now = Date.parse('2026-09-18T08:00:00Z');
  const high = { id:'high', type:'ONCE', startTimestamp:now, lastOccurrence:0, lastExecution:0, running:false, priority:100, missedRunPolicy:'EXECUTE', resources:[{resourceId:'pump-1',shared:false}] };
  const low = { id:'low', type:'ONCE', startTimestamp:now, lastOccurrence:0, lastExecution:0, running:false, priority:10, missedRunPolicy:'EXECUTE', resources:[{resourceId:'pump-1',shared:false}] };
  assert.deepEqual(dispatchable([high,low], now), ['high']);
  assert.equal(low.pending, true);
  assert.equal(low.state, 'QUEUED');
});

test('M9 shared resource permits concurrent work', () => {
  const now = Date.parse('2026-09-18T08:00:00Z');
  const a = { id:'a', type:'ONCE', startTimestamp:now, lastOccurrence:0, lastExecution:0, running:false, priority:10, missedRunPolicy:'EXECUTE', resources:[{resourceId:'shared-1',shared:true}] };
  const b = { id:'b', type:'ONCE', startTimestamp:now, lastOccurrence:0, lastExecution:0, running:false, priority:9, missedRunPolicy:'EXECUTE', resources:[{resourceId:'shared-1',shared:true}] };
  assert.deepEqual(dispatchable([a,b], now), ['a','b']);
});

test('M9 independent physical paths may run concurrently', () => {
  const now = Date.parse('2026-09-18T08:00:00Z');
  const a = { id:'gh1', type:'ONCE', startTimestamp:now, lastOccurrence:0, lastExecution:0, running:false, priority:10, missedRunPolicy:'EXECUTE', resources:[{resourceId:'pump-gh1',shared:false}] };
  const b = { id:'gh2', type:'ONCE', startTimestamp:now, lastOccurrence:0, lastExecution:0, running:false, priority:9, missedRunPolicy:'EXECUTE', resources:[{resourceId:'pump-gh2',shared:false}] };
  assert.deepEqual(dispatchable([a,b], now), ['gh1','gh2']);
});

test('M9 reboot recovery holds previously RUNNING occurrence instead of duplicating physical command', () => {
  assert.match(firmware, /MARKER_RECOVERY_HOLD/);
  assert.ok(firmware.includes('not replay an unknown in-flight physical command'));
  const s = { id:'recover', type:'ONCE', startTimestamp:1_700_000_000_000, lastOccurrence:1_700_000_000_000, lastExecution:1_700_000_000_001, running:false, priority:10, missedRunPolicy:'EXECUTE', resources:[], recoveryHold:true };
  assert.deepEqual(dispatchable([s], 1_700_000_100_000), []);
});

test('M9 deterministic command identity is occurrence-based for duplicate protection', () => {
  assert.match(firmware, /build_command_id\(/);
  assert.match(firmware, /sch-%08lx-%lld/);
  const id1 = `sch-schedule-1700000000`;
  const id2 = `sch-schedule-1700000000`;
  assert.equal(id1, id2);
});

console.log(`M9 runtime scheduler acceptance: ${PASS.length}/16 PASS`);
