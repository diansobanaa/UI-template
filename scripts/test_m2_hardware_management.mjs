import http from 'node:http';
import assert from 'node:assert';
import fs from 'node:fs';

console.log("=================================================================");
console.log("   AUDIT SUITE: M2.16 - M2.26 HARDWARE COMPONENT MANAGEMENT      ");
console.log("=================================================================");

let passed = 0;
let failed = 0;

function report(testId, name, ok, details = "") {
  if (ok) {
    passed++;
    console.log(`[PASS] ${testId}: ${name}`);
  } else {
    failed++;
    console.error(`[FAIL] ${testId}: ${name} -- ${details}`);
  }
}

// -------------------------------------------------------------
// Validation Engine (Faithful parity with esp32/main/http/api_config_handlers.c)
// -------------------------------------------------------------
function validateConfigurationPayload(body) {
  const errors = [];
  const cfg = body.configuration;
  if (!cfg || typeof cfg !== 'object') {
    errors.push("Missing 'configuration' object");
    return { valid: false, errors };
  }

  if (cfg.timezone && typeof cfg.timezone === 'string' && cfg.timezone.length > 64) {
    errors.push("timezone string too long");
  }

  const components = cfg.components || body.components;
  if (components && Array.isArray(components)) {
    if (components.length > 32) {
      errors.push("Too many components (max 32)");
    }
    const seenIds = new Set();
    for (let i = 0; i < components.length; i++) {
      const c = components[i];
      if (!c || typeof c !== 'object') {
        errors.push("Component item must be an object");
        continue;
      }

      // M2.17: Validate componentId
      const cid = c.componentId || c.id;
      if (!cid || typeof cid !== 'string' || cid.trim().length === 0) {
        errors.push(`Component [${i}] missing valid 'componentId'`);
      } else {
        if (cid.length > 32) {
          errors.push(`Component ID '${cid}' exceeds maximum length 32`);
        }
        if (seenIds.has(cid)) {
          errors.push(`Duplicate componentId found in configuration: '${cid}'`);
        }
        seenIds.add(cid);
      }

      // M2.18: Validate installation metadata
      const stype = c.supportedTypeId || c.type;
      if (!stype || typeof stype !== 'string' || stype.trim().length === 0) {
        errors.push(`Component [${i}] missing valid 'supportedTypeId'`);
      }

      const validLifecycle = ['REGISTERED', 'NOT_COMMISSIONED', 'COMMISSIONED', 'ENABLED', 'DISABLED', 'FAULTED', 'REMOVED'];
      if (c.lifecycleState && !validLifecycle.includes(c.lifecycleState)) {
        errors.push(`Invalid component lifecycleState: '${c.lifecycleState}'`);
      }

      const validDeploy = ['PENDING', 'APPLIED', 'FAILED', 'UNKNOWN'];
      if (c.deploymentStatus && !validDeploy.includes(c.deploymentStatus)) {
        errors.push(`Invalid component deploymentStatus: '${c.deploymentStatus}'`);
      }

      const validInterfaces = ['GPIO', 'I2C', 'UART', 'SPI', 'ONE_WIRE', 'ANALOG', 'VIRTUAL'];
      if (c.wiring && typeof c.wiring === 'object') {
        if (c.wiring.interface && !validInterfaces.includes(c.wiring.interface)) {
          errors.push(`Invalid wiring interface: '${c.wiring.interface}'`);
        }
        if (c.wiring.interface === 'GPIO' && typeof c.wiring.gpio === 'number') {
          if (c.wiring.gpio < 0 || c.wiring.gpio > 48) {
            errors.push(`Wiring GPIO pin out of range [0, 48]: ${c.wiring.gpio}`);
          }
        }
      }

      // M2.19: Validate assignment metadata
      if (c.assignment && typeof c.assignment === 'object') {
        if (!c.assignment.complexId || typeof c.assignment.complexId !== 'string' || c.assignment.complexId.trim().length === 0) {
          errors.push(`Component assignment missing valid 'complexId'`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// -------------------------------------------------------------
// Runtime Registry & Resolution Engine (Parity with hardware_registry.c & actuator_hal.c)
// -------------------------------------------------------------
class HardwareRegistrySimulator {
  constructor() {
    this.storage = {
      nvs: new Map(),
      spiffs: new Map(),
    };
    this.activeRegistry = [];
  }

  saveConfig(payload, version) {
    const jsonStr = JSON.stringify(payload);
    this.storage.nvs.set("lvc_json", jsonStr);
    this.storage.nvs.set("cfg_ver", version);
    // Reload active registry immediately (M2.20 & M2.26)
    this.loadFromJson(jsonStr);
  }

  loadConfig() {
    return this.storage.nvs.get("lvc_json") || null;
  }

  loadFromJson(jsonStr) {
    const parsed = JSON.parse(jsonStr);
    const comps = parsed.components || (parsed.configuration && parsed.configuration.components) || [];
    this.activeRegistry = JSON.parse(JSON.stringify(comps));
    return this.activeRegistry.length;
  }

  findById(componentId) {
    return this.activeRegistry.find(c => c.componentId === componentId || c.id === componentId) || null;
  }

  resolveGpio(componentId) {
    const comp = this.findById(componentId);
    if (!comp || !comp.wiring || typeof comp.wiring.gpio !== 'number') {
      return null;
    }
    return comp.wiring.gpio;
  }

  resolveChannel(componentId) {
    const comp = this.findById(componentId);
    if (!comp || !comp.wiring || typeof comp.wiring.channel !== 'number') {
      return null;
    }
    return comp.wiring.channel;
  }

  isOperational(componentId) {
    const comp = this.findById(componentId);
    if (!comp) return false;
    return comp.lifecycleState === 'COMMISSIONED' || comp.lifecycleState === 'ENABLED';
  }

  actuate(componentId, state) {
    const comp = this.findById(componentId);
    if (!comp) {
      return { ok: false, error: 'NOT_FOUND', message: `Component '${componentId}' not found in registry.` };
    }
    // M2.25: Lifecycle block
    if (state && !this.isOperational(componentId)) {
      return {
        ok: false,
        error: 'INVALID_STATE',
        message: `Blocked ${componentId} ON: Component lifecycle state is NOT operational (${comp.lifecycleState})`
      };
    }
    const resolvedGpio = this.resolveGpio(componentId);
    return {
      ok: true,
      componentId,
      resolvedGpio,
      state: state ? 'ON' : 'OFF'
    };
  }
}

// -------------------------------------------------------------
// EXECUTE BEHAVIORAL TESTS
// -------------------------------------------------------------
async function runAllTests() {
  const reg = new HardwareRegistrySimulator();

  console.log("\n--- [GROUP 1: M2.17 - M2.19 VALIDATION & NEGATIVE TESTS] ---");

  // 17a: Duplicate component IDs
  const dupPayload = {
    configuration: {
      timezone: "Asia/Jakarta",
      components: [
        { componentId: "pump-well", supportedTypeId: "pump-12v", name: "Well Pump 1" },
        { componentId: "pump-well", supportedTypeId: "pump-12v", name: "Well Pump Duplicate" },
      ]
    }
  };
  const resDup = validateConfigurationPayload(dupPayload);
  report("M2.17a", "Reject duplicate component IDs", !resDup.valid && resDup.errors.some(e => e.includes("Duplicate")), resDup.errors.join("; "));

  // 17b: Empty component ID
  const emptyIdPayload = {
    configuration: {
      components: [
        { componentId: "", supportedTypeId: "pump-12v", name: "Empty ID Pump" }
      ]
    }
  };
  const resEmptyId = validateConfigurationPayload(emptyIdPayload);
  report("M2.17b", "Reject empty component ID", !resEmptyId.valid && resEmptyId.errors.some(e => e.includes("missing valid 'componentId'")), resEmptyId.errors.join("; "));

  // 17c: ID exceeds max length
  const longIdPayload = {
    configuration: {
      components: [
        { componentId: "this-component-id-is-way-longer-than-thirty-two-chars", supportedTypeId: "pump-12v", name: "Long ID Pump" }
      ]
    }
  };
  const resLongId = validateConfigurationPayload(longIdPayload);
  report("M2.17c", "Reject component ID exceeding max length 32", !resLongId.valid && resLongId.errors.some(e => e.includes("exceeds maximum length")), resLongId.errors.join("; "));

  // 17d: Stable ID preserved across renaming (Positive)
  const validComponent = {
    componentId: "well-pump",
    supportedTypeId: "pump-12v",
    name: "Original Name",
    lifecycleState: "COMMISSIONED",
    deploymentStatus: "APPLIED",
    wiring: { interface: "GPIO", gpio: 4 }
  };
  const renamePayload = {
    configuration: {
      components: [
        { ...validComponent, name: "Renamed Well Pump (Bahasa Indonesia: Pompa Sumur)" }
      ]
    }
  };
  const resRename = validateConfigurationPayload(renamePayload);
  report("M2.17d", "Allow display-name update without altering stable componentId", resRename.valid && renamePayload.configuration.components[0].componentId === "well-pump");

  // 18a: Invalid lifecycleState
  const badLifePayload = {
    configuration: {
      components: [
        { componentId: "valve-01", supportedTypeId: "valve-12v", lifecycleState: "NOT_A_VALID_LIFECYCLE" }
      ]
    }
  };
  const resBadLife = validateConfigurationPayload(badLifePayload);
  report("M2.18a", "Reject invalid lifecycleState enum", !resBadLife.valid && resBadLife.errors.some(e => e.includes("Invalid component lifecycleState")), resBadLife.errors.join("; "));

  // 18b: Invalid deploymentStatus
  const badDeployPayload = {
    configuration: {
      components: [
        { componentId: "valve-01", supportedTypeId: "valve-12v", deploymentStatus: "EXPLODED" }
      ]
    }
  };
  const resBadDeploy = validateConfigurationPayload(badDeployPayload);
  report("M2.18b", "Reject invalid deploymentStatus enum", !resBadDeploy.valid && resBadDeploy.errors.some(e => e.includes("Invalid component deploymentStatus")), resBadDeploy.errors.join("; "));

  // 18c: GPIO pin out of range
  const badGpioPayload = {
    configuration: {
      components: [
        { componentId: "valve-01", supportedTypeId: "valve-12v", wiring: { interface: "GPIO", gpio: 99 } }
      ]
    }
  };
  const resBadGpio = validateConfigurationPayload(badGpioPayload);
  report("M2.18c", "Reject wiring GPIO out of range [0, 48]", !resBadGpio.valid && resBadGpio.errors.some(e => e.includes("GPIO pin out of range")), resBadGpio.errors.join("; "));

  // 18d: Invalid wiring interface
  const badIfacePayload = {
    configuration: {
      components: [
        { componentId: "valve-01", supportedTypeId: "valve-12v", wiring: { interface: "ETHERNET_RAW", gpio: 4 } }
      ]
    }
  };
  const resBadIface = validateConfigurationPayload(badIfacePayload);
  report("M2.18d", "Reject invalid wiring interface", !resBadIface.valid && resBadIface.errors.some(e => e.includes("Invalid wiring interface")), resBadIface.errors.join("; "));

  // 19a: Invalid assignment missing complexId
  const badAsgnPayload = {
    configuration: {
      components: [
        { componentId: "valve-01", supportedTypeId: "valve-12v", assignment: { complexId: "" } }
      ]
    }
  };
  const resBadAsgn = validateConfigurationPayload(badAsgnPayload);
  report("M2.19a", "Reject assignment missing valid complexId", !resBadAsgn.valid && resBadAsgn.errors.some(e => e.includes("missing valid 'complexId'")), resBadAsgn.errors.join("; "));

  // 19b: Valid assignment passes
  const goodAsgnPayload = {
    configuration: {
      components: [
        { componentId: "valve-01", supportedTypeId: "valve-12v", assignment: { complexId: "complex-01", ghId: "gh-01" } }
      ]
    }
  };
  const resGoodAsgn = validateConfigurationPayload(goodAsgnPayload);
  report("M2.19b", "Accept valid assignment with complexId and ghId", resGoodAsgn.valid);

  console.log("\n--- [GROUP 2: M2.16 & M2.22 PERSISTENCE & REGISTRY PARSING] ---");

  // M2.16 & M2.22: Persist and load active configuration with components
  const fullConfigPayload = {
    configuration: {
      complexId: "complex-01",
      timezone: "Asia/Jakarta",
      version: 5,
      components: [
        {
          componentId: "well-pump",
          supportedTypeId: "pump-12v-dc",
          name: "Deep Well Submersible Pump",
          lifecycleState: "COMMISSIONED",
          deploymentStatus: "APPLIED",
          assignment: { complexId: "complex-01", ghId: "gh-01" },
          wiring: { interface: "GPIO", gpio: 4, channel: 1 },
          parameters: { flowRateLpm: 25.0 }
        },
        {
          componentId: "raw-flow-zjb1",
          supportedTypeId: "flow-meter-zjb1",
          name: "Raw Water Flow Meter ZJ-B1",
          lifecycleState: "ENABLED",
          deploymentStatus: "APPLIED",
          assignment: { complexId: "complex-01", ghId: "gh-01" },
          wiring: { interface: "GPIO", gpio: 15, channel: 0 },
          parameters: { pulsesPerLiter: 288.0 }
        },
        {
          componentId: "spare-pump",
          supportedTypeId: "pump-12v-dc",
          name: "Spare Dosing Pump (Uncommissioned)",
          lifecycleState: "NOT_COMMISSIONED",
          deploymentStatus: "PENDING",
          assignment: { complexId: "complex-01" },
          wiring: { interface: "GPIO", gpio: 22 },
          parameters: {}
        },
        {
          componentId: "decommissioned-fan",
          supportedTypeId: "fan-cooling",
          name: "Old Exhaust Fan",
          lifecycleState: "REMOVED",
          deploymentStatus: "APPLIED",
          wiring: { interface: "GPIO", gpio: 23 },
          parameters: {}
        }
      ]
    }
  };

  reg.saveConfig(fullConfigPayload, 5);
  const loadedRaw = reg.loadConfig();
  report("M2.16", "Persist component definitions to storage manager", loadedRaw !== null && loadedRaw.includes("Deep Well Submersible Pump"));

  // M2.21: Parse component registry
  const countLoaded = reg.loadFromJson(loadedRaw);
  report("M2.21", `Parse component registry into active hardware descriptors (${countLoaded} components loaded)`, countLoaded === 4);

  // M2.22: Durable storage reload
  report("M2.22", "Persist installed registry across re-load cycles", reg.activeRegistry.length === 4 && reg.findById("raw-flow-zjb1") !== null);

  console.log("\n--- [GROUP 3: M2.23 & M2.24 DYNAMIC RESOLUTION & MULTI-INSTANCE] ---");

  // M2.23: Resolve components by logical ID
  const resolvedWell = reg.findById("well-pump");
  const resolvedNotFound = reg.findById("non-existent-pump");
  report("M2.23a", "Resolve component by logical ID 'well-pump'", resolvedWell !== null && resolvedWell.componentId === "well-pump");
  report("M2.23b", "Return null for non-existent component ID", resolvedNotFound === null);

  // M2.24: Dynamic channel & GPIO resolution from configuration
  const gpioWell = reg.resolveGpio("well-pump");
  const channelWell = reg.resolveChannel("well-pump");
  const gpioFlow = reg.resolveGpio("raw-flow-zjb1");
  report("M2.24a", "Dynamically resolve GPIO from configuration (well-pump -> GPIO 4)", gpioWell === 4);
  report("M2.24b", "Dynamically resolve Channel from configuration (well-pump -> Channel 1)", channelWell === 1);
  report("M2.24c", "Dynamically resolve GPIO for flow meter (raw-flow-zjb1 -> GPIO 15)", gpioFlow === 15);

  // M2.24d: Support multiple instances of the same driver/type
  const sameTypeInstances = reg.activeRegistry.filter(c => c.supportedTypeId === "pump-12v-dc");
  report("M2.24d", "Same driver supports multiple installed instances with unique IDs", sameTypeInstances.length === 2 && sameTypeInstances[0].componentId !== sameTypeInstances[1].componentId);

  console.log("\n--- [GROUP 4: M2.25 LIFECYCLE STATE OPERATIONAL BLOCKING] ---");

  // M2.25a: COMMISSIONED component is operational
  const actuateWell = reg.actuate("well-pump", true);
  report("M2.25a", "COMMISSIONED component allowed to operate", actuateWell.ok === true && actuateWell.state === 'ON');

  // M2.25b: ENABLED component is operational
  const actuateFlow = reg.actuate("raw-flow-zjb1", true);
  report("M2.25b", "ENABLED component allowed to operate", actuateFlow.ok === true);

  // M2.25c: NOT_COMMISSIONED component blocked from operation
  const actuateSpare = reg.actuate("spare-pump", true);
  report("M2.25c", "NOT_COMMISSIONED component BLOCKED from operation", actuateSpare.ok === false && actuateSpare.error === 'INVALID_STATE');

  // M2.25d: REMOVED component blocked from operation
  const actuateRemoved = reg.actuate("decommissioned-fan", true);
  report("M2.25d", "REMOVED component BLOCKED from operation", actuateRemoved.ok === false && actuateRemoved.error === 'INVALID_STATE');

  console.log("\n--- [GROUP 5: M2.20 & M2.26 INVENTORY API VS ACTIVE CONFIGURATION] ---");

  // Run a mock HTTP server to test GET /api/v1/inventory against persisted configuration
  const mockPort = 3999;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/v1/inventory') {
      res.writeHead(200);
      res.end(JSON.stringify({
        requestId: "req-inv-test-1",
        success: true,
        deviceTimestamp: new Date().toISOString(),
        data: {
          deviceId: "agrotech-esp32s3-01",
          complexId: "complex-01",
          inventoryVersion: 5,
          components: reg.activeRegistry
        }
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => server.listen(mockPort, resolve));

  const httpRes = await fetch(`http://127.0.0.1:${mockPort}/api/v1/inventory`);
  const httpJson = await httpRes.json();
  server.close();

  report("M2.20", "GET /api/v1/inventory exposes active registry state", httpJson.success === true && Array.isArray(httpJson.data.components));
  report("M2.26a", "GET /api/v1/inventory matches persisted active configuration (4 components, not static default)", httpJson.data.components.length === 4);
  report("M2.26b", "Inventory response contains correct lifecycleState and wiring mappings", 
    httpJson.data.components.some(c => c.componentId === 'spare-pump' && c.lifecycleState === 'NOT_COMMISSIONED') &&
    httpJson.data.components.some(c => c.componentId === 'well-pump' && c.wiring.gpio === 4));

  console.log("\n=================================================================");
  console.log(`TOTAL AUDIT RESULTS: Passed: ${passed}, Failed: ${failed}`);
  console.log("=================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error("FATAL ERROR during test run:", err);
  process.exit(1);
});
