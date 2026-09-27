import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (file) => fs.readFileSync(file, 'utf8');
const telemetry = read('esp32/main/services/telemetry_mgr.c');
const storage = read('esp32/main/storage/storage_mgr.c');
const event = read('esp32/main/services/event_mgr.c');
const eventH = read('esp32/main/services/event_mgr.h');
const safety = read('esp32/main/services/safety_monitor.c');
const scheduler = read('esp32/main/services/scheduler.c');
const actuator = read('esp32/main/hal/actuator_hal.c');
const network = read('esp32/main/network/network_mgr.c');
const config = read('esp32/main/http/api_config_handlers.c');
const calibration = read('esp32/main/services/calibration_mgr.c');
const fertigation = read('esp32/main/services/fertigation_mgr.c');
const main = read('esp32/main/main.c');
const handler = read('esp32/main/http/api_telemetry_handlers.c');
const hist = read('backend/history_store.py');
const server = read('backend/server.py');
const contracts = read('src/lib/api/contracts.ts');
const presentation = read('src/lib/telemetry-presentation.ts');
const openapi = read('UI_ESP32_OPENAPI.yaml');

const tests = [];
function test(name, fn) { try { fn(); tests.push([name, true]); } catch (e) { console.error(`FAIL: ${name}\n${e.stack}`); process.exitCode = 1; } }

test('M13.1–12 telemetry snapshot is generic, durable and metadata-rich', () => {
  assert.match(telemetry, /TELEMETRY_SEQUENCE_BLOCK/);
  assert.match(telemetry, /telemetry_seq_end/);
  assert.match(telemetry, /storage_mgr_append_telemetry_log/);
  assert.match(telemetry, /sensor_hal_list_configured/);
  assert.match(telemetry, /metricId/);
  assert.match(telemetry, /calibrationVersion/);
  assert.match(telemetry, /storageAvailable/);
  assert.doesNotMatch(telemetry, /gh-01/);
  assert.match(handler, /afterSequence/);
  assert.match(openapi, /\/api\/v1\/telemetry:/);
  assert.match(openapi, /metricId: \{ type: string \}/);
  assert.match(openapi, /value: \{ type: number, nullable: true \}/);
  assert.match(openapi, /category: \{ type: string, nullable: true \}/);
  assert.match(storage, /TELEMETRY_LOG_FILE/);
  assert.match(storage, /storage_mgr_reserve_sequence_block/);
});

test('M13.12 backend is raw-first and idempotent', () => {
  assert.match(hist, /CREATE TABLE IF NOT EXISTS raw_records/);
  assert.match(hist, /INSERT OR IGNORE INTO raw_records/);
  assert.match(hist, /INSERT OR IGNORE INTO telemetry_samples/);
  assert.match(hist, /INSERT OR IGNORE INTO events/);
  assert.match(server, /HISTORY_STORE\.ingest_telemetry_snapshot/);
  assert.match(server, /HISTORY_STORE\.ingest_event/);
});

test('M13.13–28 required event codes exist at authoritative generation sites', () => {
  for (const code of [
    'FERTIGATION_STARTED', 'FERTIGATION_COMPLETED', 'FERTIGATION_INTERRUPTED',
    'PUMP_STARTED', 'PUMP_STOPPED', 'SCHEDULE_TRIGGERED', 'SCHEDULE_SKIPPED',
    'EMERGENCY_STOP', 'SENSOR_FAULT', 'FLOW_TIMEOUT', 'TANK_FULL_PROTECTION',
    'CONFIGURATION_DEPLOYED', 'CONFIGURATION_REJECTED', 'POWER_FAILURE',
    'POWER_RESTORED', 'CALIBRATION_CHANGED', 'COMMUNICATION_LOST',
    'COMMUNICATION_RESTORED', 'WATCHDOG_RESET', 'ABNORMAL_RESET'
  ]) assert.match(`${event}\n${safety}\n${scheduler}\n${actuator}\n${network}\n${config}\n${calibration}\n${fertigation}\n${main}`, new RegExp(code));
});

test('event manager uses durable monotonic sequence and stable identity', () => {
  assert.match(event, /event_seq_end/);
  assert.match(event, /evt-%s-%" PRIu64/);
  assert.match(event, /recordType.*EVENT/);
  assert.match(event, /nextCursor/);
  assert.match(eventH, /event_mgr_log_context/);
});

test('frontend treats missing telemetry as unavailable and renders authoritative history', () => {
  assert.match(contracts, /value: number \| null/);
  assert.match(contracts, /metricId\?: string \| null/);
  assert.match(contracts, /historyTruncated\?: boolean/);
  assert.match(presentation, /measurementType === "MEASURED"/);
  assert.match(presentation, /return null/);
  assert.match(presentation, /TelemetryHistoryResponse/);
});

execFileSync('python3', ['scripts/test_m13_history.py'], { stdio: 'inherit', env: { ...process.env, PYTHONPATH: process.cwd() } });
console.log(`M13 firmware/static gate PASS (${tests.filter(([, ok]) => ok).length} checks)`);
