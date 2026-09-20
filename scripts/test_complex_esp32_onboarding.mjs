import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const page = fs.readFileSync("src/app/onboarding-complex.tsx", "utf8");
const client = fs.readFileSync("src/lib/api/esp32-client.ts", "utf8");
const service = fs.readFileSync("src/lib/services.ts", "utf8");
const backend = fs.readFileSync("backend/server.py", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");

for (const token of ["/api/v1/health", "deviceId", "complexId", "inventory", "capabilities"]) {
  assert(page.includes(token) || client.includes(token), `Missing onboarding contract token: ${token}`);
}
assert(app.includes('/onboarding/complex'), "Onboarding route is not registered.");
assert(service.includes("bindEsp32Controller"), "Controller bind service is missing.");
assert(page.includes("setStep(1)") && page.includes("created. Continue with ESP32 discovery."), "Create-and-continue must advance to ESP32 discovery without routing race.");
assert(backend.includes('["controller", "bind"]'), 'Controller bind backend route is missing.');
assert(!page.includes("find(() => true)"), "Unsafe first-match GH fallback leaked into onboarding.");
assert(!page.includes("complexes[0]") && !page.includes("greenhouses[0]"), "Index-based Complex/GH fallback leaked into onboarding.");
console.log("Complex + ESP32 onboarding structural gate: PASS");
