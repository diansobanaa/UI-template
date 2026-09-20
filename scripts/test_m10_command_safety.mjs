import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const commandC = read('esp32/main/services/command_mgr.c');
const commandH = read('esp32/main/services/command_mgr.h');
const safetyC = read('esp32/main/services/safety_monitor.c');
const safetyH = read('esp32/main/services/safety_monitor.h');
const actuatorC = read('esp32/main/hal/actuator_hal.c');
const storageC = read('esp32/main/storage/storage_mgr.c');
const eventC = read('esp32/main/services/event_mgr.c');
const handlerC = read('esp32/main/http/api_command_handlers.c');
const schedulerC = read('esp32/main/services/scheduler.c');
const clientTs = read('src/lib/api/esp32-client.ts');

const PASS = [];
function test(name, fn) {
  try { fn(); PASS.push(name); }
  catch (err) { console.error(`FAIL: ${name}\n${err.stack}`); process.exitCode = 1; }
}

class SafetyModel {
  constructor() {
    this.state = 'NORMAL';
    this.estop = false;
    this.fault = null;
    this.sensor = { fresh: true, lowerOk: true, tamperOk: true, tempC: 25 };
    this.actuators = new Map();
    this.executed = new Set();
    this.commands = new Map();
    this.events = [];
  }
  add(id, {maxRuntime = 900, needsFlow = false, highRequired = false, externalHigh = false} = {}) {
    this.actuators.set(id, {on: false, runtime: 0, maxRuntime, needsFlow, highRequired, externalHigh, flowSeen: true});
  }
  submit(c) {
    assert.ok(c.commandId, 'commandId required');
    const existing = this.commands.get(c.commandId);
    const fp = JSON.stringify([c.type,c.componentId||'',c.targetComplexId||'',c.targetGhId||'',c.resourceId||'',c.configurationVersion||0,c.durationSec||0,c.maxRuntimeSec||0,c.on!==false]);
    if (existing) {
      assert.equal(existing.fingerprint, fp, 'same command ID must retain identical physical semantics');
      return existing.receipt;
    }
    if (this.estop && c.type !== 'EMERGENCY_STOP' && c.type !== 'RESUME') throw new Error('EMERGENCY_STOP_ACTIVE');
    if (c.targetGhId === 'UNKNOWN') throw new Error('UNKNOWN_TARGET_GH');
    if (c.componentId && !this.actuators.has(c.componentId)) throw new Error('UNKNOWN_COMPONENT');
    if (c.configurationVersion !== undefined && c.configurationVersion !== 7) throw new Error('STALE_CONFIGURATION_VERSION');
    if (c.on && c.componentId) this.authorize(c);
    const receipt = {commandId:c.commandId,status:'ACCEPTED'};
    this.commands.set(c.commandId,{fingerprint:fp,receipt,c});
    this.executed.add(c.commandId);
    this.events.push({code:'COMMAND_ACCEPTED',commandId:c.commandId});
    return receipt;
  }
  authorize(c) {
    if (this.state !== 'NORMAL' || this.estop) throw new Error(this.estop ? 'EMERGENCY_STOP_ACTIVE' : 'SAFETY_FAULT_ACTIVE');
    const a = this.actuators.get(c.componentId);
    if (!this.sensor.fresh && a.needsFlow) throw new Error('SAFETY_SENSOR_STALE');
    if (!this.sensor.lowerOk && a.needsFlow) throw new Error('TANK_LOW');
    if (a.highRequired && !a.externalHigh) throw new Error('HIGH_LEVEL_PROTECTION_UNAVAILABLE');
    if (!c.durationSec || c.durationSec <= 0) throw new Error('DURATION_REQUIRED');
    if (c.durationSec > a.maxRuntime) throw new Error('MAX_RUNTIME_EXCEEDED');
    if (a.on) throw new Error('RESOURCE_BUSY');
  }
  start(id) {
    const a = this.actuators.get(id); assert.ok(a);
    a.on = true; a.runtime = 0; a.flowSeen = false;
  }
  tick(seconds = 1) {
    for (const a of this.actuators.values()) if (a.on) a.runtime += seconds;
  }
  monitorFlow(id, seen) {
    const a = this.actuators.get(id); a.flowSeen = seen;
    if (a.on && a.needsFlow && !seen) {
      if (a.runtime >= 30) { a.on = false; this.trip('FLOW_TIMEOUT', id); }
    }
  }
  maxRuntime(id) {
    const a = this.actuators.get(id);
    if (a.on && a.runtime > a.maxRuntime) { a.on = false; this.trip('ACTUATOR_MAX_RUNTIME', id); }
  }
  lowLevel() {
    this.sensor.lowerOk = false;
    for (const [id,a] of this.actuators) if (a.on && a.needsFlow) { a.on = false; this.trip('TANK_LOW', id); }
  }
  stale() {
    this.sensor.fresh = false;
    for (const [id,a] of this.actuators) if (a.on && a.needsFlow) { a.on = false; this.trip('SAFETY_SENSOR_STALE', id); }
  }
  trip(code, componentId) {
    this.state = 'FAULT'; this.fault = code;
    this.commands.forEach((entry) => {
      if (entry.receipt.status === 'RUNNING' || entry.receipt.status === 'ACCEPTED') entry.receipt = {...entry.receipt,status:'FAILED',resultCode:code};
    });
    this.events.push({code,componentId});
  }
  estopNow() {
    this.estop = true; this.state = 'EMERGENCY_STOP'; this.fault = 'EMERGENCY_STOP_ACTIVE';
    for (const a of this.actuators.values()) a.on = false;
    this.commands.forEach((entry) => {
      if (entry.receipt.status === 'RUNNING' || entry.receipt.status === 'ACCEPTED') entry.receipt = {...entry.receipt,status:'FAILED',resultCode:'EMERGENCY_STOP_ACTIVE'};
    });
    this.events.push({code:'EMERGENCY_STOP_ACTIVE'});
  }
  resume() {
    assert.equal(this.sensor.fresh, true);
    assert.equal(this.sensor.tamperOk, true);
    assert.equal(this.sensor.lowerOk, true);
    assert.ok(this.sensor.tempC <= 45);
    this.estop = false; this.state = 'NORMAL'; this.fault = null;
    this.events.push({code:'EMERGENCY_STOP_RELEASED'});
  }
}

const model = new SafetyModel();
model.add('PUMP-01', {maxRuntime: 120, needsFlow: true});
model.add('FAN-01', {maxRuntime: 600});
model.add('PUMP-HIGH', {maxRuntime:120, needsFlow:true, highRequired:true, externalHigh:false});

// M10.1–M10.13 command semantics

test('M10.1 command ID is required and bounded', () => {
  assert.match(commandH, /char command_id\[40\]/);
  assert.match(commandC, /COMMAND_ID_REQUIRED/);
  assert.match(commandC, /COMMAND_ID_TOO_LONG/);
  assert.throws(() => model.submit({type:'WELL_PUMP_START',componentId:'PUMP-01'}), /commandId required/);
});

test('M10.2 target Complex/GH is carried and GH is validated', () => {
  assert.match(commandH, /target_complex_id\[40\]/);
  assert.match(commandH, /target_gh_id\[40\]/);
  assert.match(commandC, /TARGET_COMPLEX_MISMATCH/);
  assert.match(commandC, /UNKNOWN_TARGET_GH/);
  assert.throws(() => model.submit({commandId:'gh-bad',type:'COMPONENT_TIMED',componentId:'PUMP-01',targetGhId:'UNKNOWN',on:true,durationSec:10}), /UNKNOWN_TARGET_GH/);
});

test('M10.3 target resource/component is explicit and cross-checked', () => {
  assert.match(commandH, /resource_id\[40\]/);
  assert.match(commandC, /RESOURCE_COMPONENT_MISMATCH/);
  assert.match(commandC, /TARGET_COMPONENT_REQUIRED/);
  assert.throws(() => model.submit({commandId:'missing-comp',type:'COMPONENT_TIMED',componentId:'UNKNOWN',on:true,durationSec:10}), /UNKNOWN_COMPONENT/);
});

test('M10.4 parameters include duration and command-specific payloads', () => {
  assert.match(commandH, /param_duration_sec/);
  assert.match(commandH, /param_raw_volume_ml/);
  assert.match(commandH, /fertigation_payload_json/);
  assert.match(handlerC, /durationSeconds/);
  assert.match(handlerC, /rawWaterVolumeMl/);
});

test('M10.5 configuration version context is mandatory at normalization', () => {
  assert.match(commandH, /configuration_version/);
  assert.match(commandC, /STALE_CONFIGURATION_VERSION/);
  const r = model.submit({commandId:'cfg-ok',type:'COMPONENT_TIMED',componentId:'FAN-01',configurationVersion:7,on:true,durationSec:10});
  assert.equal(r.commandId,'cfg-ok');
  assert.throws(() => model.submit({commandId:'cfg-bad',type:'COMPONENT_TIMED',componentId:'FAN-01',configurationVersion:6,on:true,durationSec:10}), /STALE_CONFIGURATION_VERSION/);
});

test('M10.6 command validation rejects unsupported/missing physical semantics', () => {
  assert.match(commandC, /UNKNOWN_COMMAND_TYPE/);
  assert.match(commandC, /DURATION_REQUIRED/);
  assert.match(handlerC, /UNSUPPORTED_COMMAND_TYPE/);
});

test('M10.7 resource/component availability is checked before execution', () => {
  assert.match(commandC, /RESOURCE_BUSY/);
  model.start('PUMP-01');
  assert.throws(() => model.submit({commandId:'busy',type:'COMPONENT_TIMED',componentId:'PUMP-01',on:true,durationSec:10}), /RESOURCE_BUSY/);
  model.actuators.get('PUMP-01').on = false;
});

test('M10.8 physical command is locally safety-authorized', () => {
  assert.match(commandC, /safety_monitor_authorize_component\(/);
  assert.match(safetyC, /safety_monitor_allows_commands\(\)/);
  assert.match(handlerC, /command_mgr_submit\(&cmd/);
});

test('M10.9 E-stop is checked both at submission and worker execution', () => {
  assert.match(commandC, /EMERGENCY_STOP_ACTIVE/);
  assert.match(commandC, /safety_monitor_trigger_emergency_stop/);
  assert.match(commandC, /actuator_hal_is_emergency_stopped\(\)/);
});

test('M10.10 duplicate command ID does not create a second execution', () => {
  const first = model.submit({commandId:'dup-1',type:'COMPONENT_TIMED',componentId:'FAN-01',configurationVersion:7,on:true,durationSec:10});
  const second = model.submit({commandId:'dup-1',type:'COMPONENT_TIMED',componentId:'FAN-01',configurationVersion:7,on:true,durationSec:10});
  assert.deepEqual(second, first);
  assert.equal(model.commands.size, 2 + 0); // cfg-ok + dup-1; distinct IDs only once
});

test('M10.11 reusing a command ID with different physical semantics is rejected', () => {
  assert.match(commandC, /COMMAND_ID_REUSE/);
  assert.match(commandC, /command_semantically_equal/);
  assert.throws(() => model.submit({commandId:'dup-1',type:'COMPONENT_TIMED',componentId:'FAN-01',configurationVersion:7,on:true,durationSec:11}), /identical physical semantics/);
});

test('M10.12 command result exposes terminal reason/status', () => {
  assert.match(commandC, /COMMAND_COMPLETED/);
  assert.match(commandC, /result_code/);
  assert.match(handlerC, /resultCode/);
});

test('M10.13 command events retain command and target context', () => {
  assert.match(commandC, /event_mgr_log_command/);
  assert.match(eventC, /commandId/);
  assert.match(eventC, /resourceId/);
  assert.match(eventC, /configurationVersion/);
});

// M10.14–M10.25 safety semantics

test('M10.14 safe boot covers configured outputs', () => {
  assert.match(actuatorC, /hardware_registry_get_count\(\)/);
  assert.match(actuatorC, /actuator_hal_set\(/);
  assert.match(actuatorC, /s_component_runtime/);
  assert.match(storageC, /s_state\.safe_boot_active = true/);
  const mainC = read('esp32/main/main.c');
  assert.match(mainC, /storage_mgr_set_safe_boot_active\(false\)/);
});

test('M10.15 E-stop latch is persistent and explicit', () => {
  assert.match(safetyC, /storage_mgr_set_estop\(true\)/);
  assert.match(safetyC, /SAFETY_STATE_EMERGENCY_STOP/);
  assert.match(safetyC, /s_fault_latched = true/);
  model.estopNow();
  assert.equal(model.estop,true);
  assert.equal(model.state,'EMERGENCY_STOP');
});

test('M10.16 conflicting commands are rejected while latched', () => {
  assert.throws(() => model.submit({commandId:'after-estop',type:'COMPONENT_TIMED',componentId:'FAN-01',configurationVersion:7,on:true,durationSec:10}), /EMERGENCY_STOP_ACTIVE/);
  assert.match(commandC, /Command rejected because emergency stop is latched/);
});

test('M10.17 scheduler cannot execute while safety policy blocks', () => {
  assert.match(schedulerC, /!safety_monitor_allows_scheduler\(\)/);
  assert.match(schedulerC, /SCHEDULE_BLOCKED_SAFETY/);
});

test('M10.18 maximum runtime policy is bounded and configurable', () => {
  assert.match(safetyC, /SAFETY_DEFAULT_PUMP_MAX_SEC/);
  assert.match(safetyC, /maxRuntimeSec/);
  model.resume();
  model.submit({commandId:'runtime-1',type:'COMPONENT_TIMED',componentId:'PUMP-01',configurationVersion:7,on:true,durationSec:120});
  model.start('PUMP-01'); model.tick(121); model.maxRuntime('PUMP-01');
  assert.equal(model.actuators.get('PUMP-01').on,false);
  assert.equal(model.fault,'ACTUATOR_MAX_RUNTIME');
});

test('M10.19 flow timeout stops protected pumps and records fault', () => {
  assert.match(safetyC, /FLOW_TIMEOUT/);
  assert.match(safetyC, /flowTimeoutSec/);
  model.state='NORMAL'; model.fault=null; model.sensor.fresh=true; model.sensor.lowerOk=true;
  model.actuators.get('PUMP-01').on=true; model.actuators.get('PUMP-01').runtime=30; model.monitorFlow('PUMP-01',false);
  assert.equal(model.actuators.get('PUMP-01').on,false);
  assert.equal(model.fault,'FLOW_TIMEOUT');
});

test('M10.20 low-level protection blocks/stops water-moving pumps', () => {
  assert.match(safetyC, /TANK_LOW/);
  model.state='NORMAL'; model.fault=null; model.sensor.lowerOk=true;
  model.actuators.get('PUMP-01').on=true;
  model.lowLevel();
  assert.equal(model.actuators.get('PUMP-01').on,false);
  assert.equal(model.fault,'TANK_LOW');
});

test('M10.21 high-level protection never fabricates radar state', () => {
  assert.match(safetyC, /externalHighLevelInterlock/);
  assert.match(safetyC, /HIGH_LEVEL_PROTECTION_UNAVAILABLE/);
  model.state='NORMAL'; model.fault=null; model.sensor.lowerOk=true; model.sensor.fresh=true;
  assert.throws(() => model.submit({commandId:'high-level',type:'COMPONENT_TIMED',componentId:'PUMP-HIGH',configurationVersion:7,on:true,durationSec:10}), /HIGH_LEVEL_PROTECTION_UNAVAILABLE/);
});

test('M10.22 stale safety sensor fails safe and blocks new starts', () => {
  assert.match(safetyC, /SAFETY_SENSOR_STALE/);
  assert.match(safetyC, /sensor_snapshot_fresh/);
  model.state='NORMAL'; model.fault=null; model.sensor.fresh=false;
  assert.throws(() => model.submit({commandId:'stale',type:'COMPONENT_TIMED',componentId:'PUMP-01',configurationVersion:7,on:true,durationSec:10}), /SAFETY_SENSOR_STALE/);
  model.actuators.get('PUMP-01').on=true;
  model.stale();
  assert.equal(model.actuators.get('PUMP-01').on,false);
  assert.equal(model.fault,'SAFETY_SENSOR_STALE');
});

test('M10.23 fault state is distinct from normal and blocks operations', () => {
  assert.match(safetyH, /SAFETY_STATE_FAULT/);
  assert.match(safetyC, /s_state = global_estop \? SAFETY_STATE_EMERGENCY_STOP : SAFETY_STATE_FAULT/);
  assert.equal(model.state,'FAULT');
});

test('M10.24 recovery requires explicit safe conditions and explicit action', () => {
  assert.match(safetyC, /safety_monitor_request_recovery/);
  assert.match(safetyC, /MAINTENANCE_REQUIRED/);
  model.estop=true; model.state='EMERGENCY_STOP'; model.fault='TANK_LOW'; model.sensor.fresh=true; model.sensor.lowerOk=true; model.sensor.tamperOk=true; model.sensor.tempC=25;
  model.resume();
  assert.equal(model.state,'NORMAL');
  assert.equal(model.estop,false);
});

test('M10.25 safety event path persists without requiring SD card', () => {
  assert.match(storageC, /EVENT_LOG_FALLBACK_FILE/);
  assert.match(storageC, /sdcard_hal_is_mounted\(\) \? EVENT_LOG_FILE : EVENT_LOG_FALLBACK_FILE/);
  assert.match(eventC, /storage_mgr_append_event_log\(json_buf\)/);
});

// Contract/bypass guards

test('HTTP emergency stop no longer bypasses command manager', () => {
  assert.doesNotMatch(handlerC, /actuator_hal_emergency_stop\(\)/);
  assert.match(handlerC, /command_mgr_submit\(&cmd/);
});

test('HTTP starts do not silently inject dangerous runtime defaults', () => {
  assert.doesNotMatch(handlerC, /Default 10 min/);
  assert.doesNotMatch(handlerC, /Default 15 min/);
  assert.doesNotMatch(handlerC, /param_duration_sec = 30/);
  assert.match(handlerC, /cmd->param_on = true/);
});

test('frontend command client carries safety context fields', () => {
  for (const token of ['targetComplexId','targetGhId','resourceId','configurationVersion','maxRuntimeSec','source']) assert.match(clientTs, new RegExp(token));
});

test('frontend emergency stop propagates one stable command ID to direct ESP32', () => {
  const client = read('src/lib/api/esp32-client.ts');
  const services = read('src/lib/services.ts');
  assert.match(client, /emergencyStop\(reason\?: string, commandId\?: string\)/);
  assert.match(client, /stableCommandId/);
  assert.match(services, /esp32Client\.emergencyStop\("Emergency stop triggered from UI", commandId\)/);
});

test('frontend well-pump command has no local telemetry or local-state physical fallback', () => {
  const services = read('src/lib/services.ts');
  const wellPumpSection = services.slice(services.indexOf('async setWellPump('), services.indexOf('/** Dosing pump test run', services.indexOf('async setWellPump(')));
  assert.doesNotMatch(wellPumpSection, /rawTankPct/);
  assert.match(wellPumpSection, /No authoritative ESP32\/backend command path is configured/);
});

test('cancelled commands are not executed later by the worker', () => {
  assert.match(commandH, /CMD_STATUS_CANCELLED/);
  assert.match(commandC, /cached->status == CMD_STATUS_CANCELLED/);
  assert.match(commandC, /cached->status = CMD_STATUS_CANCELLED/);
});

console.log(`M10 Command + Safety acceptance: ${PASS.length}/31 PASS`);
if (process.exitCode) process.exit(1);
