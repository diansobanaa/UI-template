import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const fert = read('esp32/main/services/fertigation_mgr.c');
const fertH = read('esp32/main/services/fertigation_mgr.h');
const sched = read('esp32/main/services/scheduler.c');
const cmd = read('esp32/main/services/command_mgr.c');
const cmdH = read('esp32/main/services/command_mgr.h');
const calApi = read('esp32/main/http/api_calibration_handlers.c');
const calMgr = read('esp32/main/services/calibration_mgr.c');
const sensor = read('esp32/main/hal/sensor_hal.c');
const apiCmd = read('esp32/main/http/api_command_handlers.c');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (err) { console.error(`FAIL ${name}`); throw err; }
}

test('F1 automatic fertigation requires executionPlan at scheduler parse boundary', () => {
  assert.match(sched, /if \(!ep \|\| !cJSON_IsObject\(ep\)\) return false;/);
  assert.match(sched, /copy_string\(out->fertigation_payload_json/);
});

test('F2 HTTP automatic fertigation requires executionPlan and does not parse A/B volumes', () => {
  assert.match(apiCmd, /FERTIGATION_EXECUTION_PLAN_REQUIRED/);
  const block = apiCmd.slice(apiCmd.indexOf('FERTIGATION_START'), apiCmd.indexOf('FERTIGATION_STOP'));
  assert.doesNotMatch(block, /param_dosing_a_ml|param_dosing_b_ml/);
});

test('F3 command manager executes fertigation only through fertigation_mgr_start_from_json', () => {
  assert.match(cmd, /cmd\.type == CMD_TYPE_FERTIGATION_BATCH/);
  assert.match(cmd, /fertigation_mgr_start_from_json\(cmd\.fertigation_payload_json\)/);
  assert.doesNotMatch(cmd, /fertigation_mgr_start_batch/);
  assert.doesNotMatch(fertH, /fertigation_mgr_start_batch/);
});

test('F4 firmware calibration endpoint supports all required record types', () => {
  for (const type of ['DOSING_RATE', 'FLOW', 'LEVEL', 'PH', 'EC']) assert.match(calApi, new RegExp(`"${type}"`));
  assert.match(calApi, /calibration_mgr_set_record_rate_or_linear/);
  assert.match(calApi, /calibration_mgr_set_flow_pulses_calibration/);
  assert.match(calApi, /CALIBRATION_ID_REQUIRED/);
  assert.match(calApi, /CALIBRATION_COMPONENT_TYPE_MISMATCH/);
  assert.match(calApi, /COMPONENT_COMPLEX_MISMATCH/);
});

test('F5 firmware calibration lookup is exact id+version+component+type', () => {
  assert.match(calMgr, /find_exact_record_locked/);
  assert.match(calMgr, /component_id.*calibration_type.*calibration_id.*version/);
  assert.match(calMgr, /calibration_mgr_get_record_exact/);
  assert.match(sensor, /calibration_mgr_get_record_exact/);
});

test('F6 sensor runtime does not fabricate unavailable sensor values', () => {
  assert.match(sensor, /SENSOR_STATE_UNAVAILABLE/);
  assert.match(sensor, /SENSOR_STATE_STALE/);
  assert.match(sensor, /SENSOR_STATE_OUT_OF_RANGE/);
  assert.match(sensor, /SENSOR_STATE_VALID/);
});

test('F7 filling uses accumulated measured volume, not timer-derived volume', () => {
  const block = fert.slice(fert.indexOf('case FERT_STATE_FILLING:', fert.indexOf('switch(s_state)')), fert.indexOf('case FERT_STATE_DOSING:', fert.indexOf('switch(s_state)')));
  assert.match(block, /sensor_hal_get_component_accumulated_ml/);
  assert.match(block, /target_water_ml/);
});

test('F8 dosing is generic and bounded to configured channel count', () => {
  assert.match(fert, /FERT_MAX_DOSING_CHANNELS/);
  assert.match(fert, /channel_count>FERT_MAX_DOSING_CHANNELS/);
  assert.match(fert, /calibration_mgr_get_record_exact/);
  assert.match(fert, /requested_ml/);
});

test('F9 mixing actuator failures enter FAULTED and stop outputs', () => {
  const block = fert.slice(fert.indexOf('case FERT_STATE_FINAL_MIXING:', fert.indexOf('switch(s_state)')), fert.indexOf('case FERT_STATE_DELIVERY:', fert.indexOf('switch(s_state)')));
  assert.match(block, /MIXING_ACTUATOR_REJECTED/);
  assert.match(block, /stop_all\(\)/);
  assert.match(block, /FERT_STATE_FAULTED/);
});

test('F10 delivery uses valid measured flow and explicit target semantics', () => {
  const block = fert.slice(fert.indexOf('case FERT_STATE_DELIVERY:', fert.indexOf('switch(s_state)')), fert.indexOf('case FERT_STATE_COMPLETE:', fert.indexOf('switch(s_state)')));
  assert.match(block, /SENSOR_STATE_VALID/);
  assert.match(block, /sensor_hal_get_component_accumulated_ml/);
  assert.match(block, /target_flow_lpm/);
  assert.match(block, /target_pressure_kpa/);
  assert.match(block, /DELIVERY_FLOW_SENSOR_NOT_VALID/);
  assert.match(block, /PRESSURE_SENSOR_NOT_VALID/);
});

test('F11 configuration version is checked before fertigation execution', () => {
  assert.match(fert, /configuration_version.*config_version/);
  assert.match(cmd, /STALE_CONFIGURATION_VERSION/);
});

test('F12 recipe snapshot and execution plan are persisted with run record', () => {
  assert.match(fert, /recipe_snapshot_json/);
  assert.match(fert, /execution_plan_json/);
  assert.match(fert, /storage_mgr_append_fertigation_run/);
});


test('F13 generic configured flow sensors are configuration-driven and use exact FLOW calibration', () => {
  assert.match(sensor, /MAX_GENERIC_FLOW_SENSORS/);
  assert.match(sensor, /generic_flow_isr/);
  assert.match(sensor, /sensor_hal_reconfigure_from_registry/);
  assert.match(sensor, /calibration_mgr_get_record_exact\(sensor_id, "FLOW"/);
  assert.match(sensor, /pulses_per_liter/);
});

test('F14 generic analog sensors are not read from arbitrary interfaces and require exact usable linear calibration', () => {
  assert.match(sensor, /info\.wiring\.interface == HW_INTERFACE_ANALOG/);
  assert.match(sensor, /generic_sensor_requires_linear_calibration/);
  assert.match(sensor, /calibration_mgr_is_usable\(&cal\)/);
  assert.match(sensor, /cal\.slope \* value \+ cal\.offset/);
  assert.match(sensor, /SENSOR_STATE_UNAVAILABLE/);
});

test('F15 active configuration changes trigger sensor input reconfiguration', () => {
  const cfg = read('esp32/main/http/api_config_handlers.c');
  assert.match(cfg, /storage_mgr_activate_candidate\(\)/);
  assert.match(cfg, /sensor_hal_reconfigure_from_registry\(\)/);
});

test('F16 fertigation run record distinguishes measured water/delivery from calculated dosing', () => {
  assert.match(fert, /actualWaterMeasurementSource/);
  assert.match(fert, /actualWaterMeasurementQuality/);
  assert.match(fert, /actualDosedMeasurementSource/);
  assert.match(fert, /actualDosedMeasurementQuality/);
  assert.match(fert, /sensorCalibrationReferences/);
  assert.match(fert, /deliveredVolumeVerified/);
});

test('F17 simulation coverage is isolated to test-only helper', () => {
  const helper = read('tests/support/fertigation_simulation.py');
  const server = read('backend/server.py');
  const client = read('src/lib/api/python-client.ts');
  assert.match(helper, /def simulate_run\(/);
  assert.match(helper, /actual_flow_lpm: float \| None/);
  assert.match(helper, /actual_pressure_kpa: float \| None/);
  assert.doesNotMatch(server, /fertigation.*simulate/);
  assert.doesNotMatch(server, /simulate_run/);
  assert.doesNotMatch(client, /simulateFertigation/);
});

console.log('Firmware M11/M12 production-path source gate: 17 PASS');

