import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function test(id, name, fn) {
  try { fn(); console.log(`[PASS] ${id}: ${name}`); return true; }
  catch (e) { console.error(`[FAIL] ${id}: ${name} -- ${e.message}`); return false; }
}

let pass = 0, fail = 0;
const checks = [
  ['F01', 'storage initializes before hardware registry', () => {
    const s = src('esp32/main/main.c');
    const storage = s.match(/ESP_ERROR_CHECK\(storage_mgr_init\(\)\)/);
    const hal = s.match(/ESP_ERROR_CHECK\(hardware_hal_init_all\(\)\)/);
    assert(storage && hal && storage.index < hal.index, 'storage_mgr_init must precede hardware_hal_init_all');
  }],
  ['F02', 'production boot never loads components.json as operational fallback', () => {
    const s = src('esp32/main/hal/hardware_registry.c');
    assert(!/storage_mgr_load_components_json\s*\(/.test(s), 'hardware_registry.c still calls components.json loader');
    assert(s.includes('hardware_registry_clear();'), 'missing safe-empty registry path');
  }],
  ['F03', 'active registry parser is canonical and transactional', () => {
    const s = src('esp32/main/hal/hardware_registry.c');
    assert(s.includes('parsed_components'), 'parser must stage into a temporary registry');
    assert(s.includes('memcpy(s_active_components, parsed_components'), 'parser must commit staged registry atomically');
    assert(s.includes('supportedTypeId'), 'canonical supportedTypeId not parsed');
    assert(s.includes('lifecycleState'), 'canonical lifecycleState not parsed');
    assert(s.includes('deploymentStatus'), 'canonical deploymentStatus not parsed');
    assert(!/cJSON_GetObjectItem\\(c,\\s*"id"\\)/.test(s), 'legacy id alias still accepted by production registry parser');
    assert(!/cJSON_GetObjectItem\\(c,\\s*"type"\\)/.test(s), 'legacy type alias still accepted by production registry parser');
  }],
  ['F04', 'logical actuator commands resolve through active configuration', () => {
    const s = src('esp32/main/hal/actuator_hal.c');
    assert(!s.includes('s_actuator_component_ids'), 'static component identity table still present');
    assert(s.includes('resolve_configured_actuator'), 'enum actuator path does not resolve active registry');
    assert(s.includes('hardware_registry_find_by_id(component_id'), 'component-id path does not resolve active registry');
    const resolver = s.indexOf('resolve_configured_actuator(id, &comp_info)');
    const gpio = s.indexOf('gpio_set_level(s_actuators[id].gpio', resolver);
    assert(resolver >= 0 && gpio > resolver, 'configured resolver is not on the physical execution path');
  }],
  ['F05', 'unknown component cannot fall through to default hardware', () => {
    const s = src('esp32/main/hal/actuator_hal.c');
    const setById = s.indexOf('esp_err_t actuator_hal_set_by_component_id');
    const body = s.slice(setById, s.indexOf('\n}', setById) + 2);
    assert(body.includes('hardware_registry_find_by_id(component_id, &info)'), 'component-id setter must consult registry');
    assert(body.includes('return ESP_ERR_NOT_FOUND'), 'missing component must return an error');
  }],
  ['F06', 'configuration validator checks canonical envelope and active Complex ownership', () => {
    const s = src('esp32/main/http/api_config_handlers.c');
    assert(s.includes('extract_configuration'), 'configuration extraction helper missing');
    assert(s.includes('expectedVersion'), 'optimistic version guard missing');
    assert(s.includes('Configuration complexId does not match this ESP32'), 'Complex ownership validation missing');
    assert(s.includes('required_arrays[]'), 'required canonical config sections are not validated');
  }],
  ['F07', 'configuration validation occurs before persistence', () => {
    const s = src('esp32/main/http/api_config_handlers.c');
    const handler = s.indexOf('esp_err_t handler_put_configuration');
    const validate = s.indexOf('validate_config_payload(request_payload, errors)', handler);
    const deploy = s.indexOf('static esp_err_t deploy_configuration_json', 0);
    const stage = s.indexOf('storage_mgr_stage_candidate', deploy);
    assert(validate >= 0, 'PUT must validate candidate payload');
    assert(deploy >= 0 && stage > deploy, 'deployment helper must stage candidate');
    assert(!s.slice(handler, s.indexOf('esp_err_t handler_validate_configuration', handler)).includes('storage_mgr_save_config('), 'PUT must not bypass candidate staging with direct save');
  }],
  ['F08', 'GET configuration never invents a default operational configuration', () => {
    const s = src('esp32/main/http/api_config_handlers.c');
    const handler = s.indexOf('esp_err_t handler_get_configuration');
    const end = s.indexOf('esp_err_t handler_put_configuration', handler);
    const body = s.slice(handler, end);
    assert(body.includes('No active configuration is installed'), 'GET must report unavailable when no active config exists');
    assert(!body.includes('hardware_registry_get_default_json'), 'GET must not synthesize default registry configuration');
  }],
  ['F09', 'persisted config metadata is committed as one NVS transaction', () => {
    const s = src('esp32/main/storage/storage_mgr.c');
    const fn = s.slice(s.indexOf('esp_err_t storage_mgr_save_config'), s.indexOf('esp_err_t storage_mgr_append_event_log'));
    for (const key of ['nvs_set_str(handle, "lvc_json"', 'nvs_set_u32(handle, "cfg_ver"', 'nvs_set_u32(handle, "cfg_crc"', 'nvs_commit(handle)']) assert(fn.includes(key), `missing ${key}`);
  }],
  ['F10', 'frontend installed inventory has no seed/localStorage fallback', () => {
    const s = src('src/lib/services.ts');
    assert(s.includes('_esp32.getInventory()'), 'frontend does not use ESP32 inventory API');
    assert(!s.includes('initialInstalledComponents'), 'frontend service references static installed seed');
    assert(!s.includes('_devFallbackComponents'), 'frontend service contains a dev fallback authority');
  }],
  ['F11', 'frontend configuration CRUD is validate-then-save through ESP32', () => {
    const s = src('src/lib/services.ts');
    const h = s.indexOf('async updateConfigurationComponents');
    const body = s.slice(h, s.indexOf('async registerComponent', h));
    assert(body.includes('_esp32.getConfiguration()'), 'CRUD must read active configuration first');
    assert(body.includes('_esp32.validateConfiguration(nextConfig)'), 'CRUD must validate candidate before deployment');
    assert(body.includes('_esp32.saveConfiguration(nextConfig)'), 'CRUD must deploy through ESP32');
  }],
  ['F12', 'frontend component identity remains immutable on update', () => {
    const s = src('src/lib/services.ts');
    const h = s.indexOf('async updateComponent');
    const body = s.slice(h, s.indexOf('async decommissionComponent', h));
    assert(body.includes('componentId is immutable.'), 'update must reject componentId mutation');
  }],
  ['F13', 'canonical OpenAPI contract documents configuration wrapper', () => {
    const s = src('contracts/UI_ESP32_OPENAPI.yaml');
    assert(/configuration:\s*\{\s*\$ref: "#\/components\/schemas\/ConfigurationPayload" \}/.test(s), 'canonical contract must type the configuration wrapper');
    assert(s.includes('required: [expectedVersion, configuration]'), 'expectedVersion/configuration envelope missing');
  }],
];

for (const [id, name, fn] of checks) { if (test(id, name, fn)) pass++; else fail++; }
console.log(`\\nFORENSIC STATIC AUTHORITY RESULTS: ${pass} PASS | ${fail} FAIL`);
if (fail) process.exit(1);
