import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const main = fs.readFileSync(path.join(root, "esp32", "main", "main.c"), "utf8");
const actuator = fs.readFileSync(path.join(root, "esp32", "main", "hal", "actuator_hal.c"), "utf8");
const header = fs.readFileSync(path.join(root, "esp32", "main", "hal", "actuator_hal.h"), "utf8");

assert.match(main, /actuator_hal_bootstrap_safe_off\s*\(/);
assert.doesNotMatch(main, /gpio_set_level|gpio_config|gpio_set_direction|gpio_reset_pin/);
assert.match(header, /actuator_hal_request_component/);
assert.match(header, /actuator_source_t/);
assert.match(actuator, /ACTUATOR_REQUEST/);
assert.match(actuator, /actuator_hal_bootstrap_safe_off\s*\(/);

const allowed = new Set([
  path.normalize(path.join(root, "esp32", "main", "hal", "actuator_hal.c")),
  path.normalize(path.join(root, "esp32", "main", "hal", "dht22.c")),
  path.normalize(path.join(root, "esp32", "main", "hal", "sensor_hal.c")),
  path.normalize(path.join(root, "esp32", "main", "hal", "microsd_hal.c")),
  path.normalize(path.join(root, "esp32", "main", "hal", "tft_hal.c")),
  path.normalize(path.join(root, "esp32", "main", "hal", "button_hal.c")),
]);
const sourceRoot = path.join(root, "esp32", "main");
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : file.endsWith(".c") ? [file] : [];
  });
}
for (const file of walk(sourceRoot)) {
  const text = fs.readFileSync(file, "utf8");
  if (/gpio_set_level|gpio_set_direction|gpio_reset_pin|gpio_config/.test(text)) {
    assert.ok(allowed.has(path.normalize(file)), `unexpected GPIO writer: ${file}`);
  }
}
console.log("Actuator centralization checks passed.");
