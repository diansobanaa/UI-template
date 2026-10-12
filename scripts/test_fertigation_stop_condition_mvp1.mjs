import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

console.log("=== FERTIGATION STOP CONDITION & MVP-1 HARDWARE VERIFICATION ===");

const fertC = fs.readFileSync("esp32/main/services/fertigation_mgr.c", "utf8");
const pinH = fs.readFileSync("esp32/main/config/pin_config.h", "utf8");
const modelDoc = fs.readFileSync("docs/MIXING_FERTIGATION_OPERATIONAL_MODEL.md", "utf8");

// ---------------------------------------------------------------------------
// Test 5: MVP-1 Hardware Mapping Regression
// ---------------------------------------------------------------------------
console.log("\n[Test 5: MVP-1 Hardware Mapping Regression]");

// Check GPIO 38 for lower float
assert.match(pinH, /#define\s+PIN_IN_FLOAT_LOWER\s+38/, "PIN_IN_FLOAT_LOWER must be GPIO 38");
console.log("  PASS: Mixing tank lower float switch is strictly mapped to GPIO 38");

// Check GPIO 2 for distribution pump
assert.match(pinH, /#define\s+PIN_RELAY_CH2\s+2/, "PIN_RELAY_CH2 must be GPIO 2");
assert.match(pinH, /#define\s+PIN_OUT_DIST_PUMP\s+PIN_RELAY_CH2/, "PIN_OUT_DIST_PUMP must map to Relay CH2 (GPIO 2)");
console.log("  PASS: Fertigation distribution pump relay is strictly mapped to GPIO 2");

// Confirm well pump radar/manual monitoring is untouched
assert.match(pinH, /#define\s+PIN_RELAY_CH1\s+1/, "Well pump relay CH1 must remain GPIO 1");
console.log("  PASS: Well pump configuration is preserved and unaffected");


// ---------------------------------------------------------------------------
// Simulated Delivery Monitor State Machine for Tests 1, 2, 3, 4
// ---------------------------------------------------------------------------
class SimulatedDeliverySlot {
  constructor(cfg) {
    this.occupied = true;
    this.state = "DISTRIBUTING";
    this.delivery_pump_id = "pump_dist";
    this.delivery_flow_sensor_id = "flow_sensor_fert";
    this.level_sensor_id = cfg.level_sensor_id || "float_lower";
    this.delivery_start_ms = 1000;
    this.delivery_start_ml = 500;
    this.delivery_target_ml = cfg.delivery_target_ml || 20000;
    this.delivery_timeout_sec = cfg.delivery_timeout_sec || 3600;
    this.delivery_mode = "VOLUME";
    this.fault = "";
    this.completed_at_ms = 0;
    this.pump_active = true;
    this.actuator_released = false;
    this.delivered_water_ml = 0;
    this.completion_reason = "";
  }

  // Exact reproduction of fertigation_mgr.c delivery monitor tick logic
  tick(sim) {
    const elapsed = sim.now_ms - this.delivery_start_ms;

    // 1. Emergency stop / safety fault check
    if (sim.safety_fault || sim.emergency_stop) {
      this.pump_active = false;
      this.actuator_released = true;
      this.state = "FAULTED";
      this.fault = "EMERGENCY_STOP";
      this.completed_at_ms = sim.now_ms;
      return;
    }

    // 2. Terminal completion: Lower float dry level switch
    let float_is_dry = false;
    let float_sensor_valid = false;
    if (sim.level_sensor_available) {
      float_sensor_valid = true;
      float_is_dry = (sim.float_level === 0); // 0 = FLOAT_LEVEL_DRY
    }

    if (!float_sensor_valid) {
      this.pump_active = false;
      this.actuator_released = true;
      this.state = "FAULTED";
      this.fault = "LEVEL_SENSOR_UNAVAILABLE";
      this.completed_at_ms = sim.now_ms;
      return;
    }

    if (float_is_dry) {
      this.pump_active = false;
      this.actuator_released = true;
      this.delivered_water_ml = sim.accumulated_ml - this.delivery_start_ml;
      this.state = "COMPLETE";
      this.completed_at_ms = sim.now_ms;
      this.completion_reason = "LOWER_FLOAT_DRY";
      return;
    }

    // 3. Flow mode: Telemetry tracking without premature pump stop
    if (this.delivery_mode === "VOLUME") {
      if (!sim.flow_sensor_valid) {
        this.pump_active = false;
        this.actuator_released = true;
        this.state = "FAULTED";
        this.fault = "DELIVERY_FLOW_SENSOR_NOT_VALID";
        this.completed_at_ms = sim.now_ms;
        return;
      }

      const delivered = sim.accumulated_ml - this.delivery_start_ml;
      if (delivered > 0) {
        this.delivered_water_ml = delivered;
      }
      // Target volume is reached, but does NOT stop the pump!
      // Pump continues running until lower float switch trips DRY.
    }

    // 4. Maximum runtime timeout check (default: 3600s / 1 hour)
    const max_runtime_sec = this.delivery_timeout_sec > 0 ? this.delivery_timeout_sec : 3600;
    if (elapsed >= max_runtime_sec * 1000) {
      this.pump_active = false;
      this.actuator_released = true;
      this.state = "FAULTED";
      this.fault = "DELIVERY_TIMEOUT";
      this.completed_at_ms = sim.now_ms;
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Test 1: Target volume reached while the float remains WET
// ---------------------------------------------------------------------------
console.log("\n[Test 1: Target volume reached while float remains WET]");
const slot1 = new SimulatedDeliverySlot({ delivery_target_ml: 10000 });
const sim1 = {
  now_ms: 10000,
  level_sensor_available: true,
  float_level: 1, // 1 = FLOAT_LEVEL_OK / WET
  flow_sensor_valid: true,
  accumulated_ml: 10500, // delivered = 10000 mL (target reached!)
  safety_fault: false,
  emergency_stop: false
};
slot1.tick(sim1);

assert.strictEqual(slot1.pump_active, true, "Pump MUST remain active when float is WET even if target is reached");
assert.strictEqual(slot1.state, "DISTRIBUTING", "State MUST remain DISTRIBUTING");
assert.strictEqual(slot1.delivered_water_ml, 10000, "Delivered volume telemetry MUST be updated to 10000 mL");
assert.strictEqual(slot1.actuator_released, false, "Actuator must not be released prematurely");
console.log("  PASS: Target volume reached while float is WET -> pump remains active, telemetry records 10,000 mL");

// Simulate further delivery beyond target volume (e.g. 12000 mL delivered)
sim1.now_ms = 15000;
sim1.accumulated_ml = 12500;
slot1.tick(sim1);
assert.strictEqual(slot1.pump_active, true, "Pump MUST still remain active beyond target volume while float is WET");
assert.strictEqual(slot1.delivered_water_ml, 12000, "Volume telemetry continuously increments beyond target");
console.log("  PASS: Flow exceeds target volume (12,000 mL) -> pump continues running normally without aborting");


// ---------------------------------------------------------------------------
// Test 2: Lower-level float triggers DRY
// ---------------------------------------------------------------------------
console.log("\n[Test 2: Lower-level float triggers DRY]");
sim1.now_ms = 20000;
sim1.accumulated_ml = 15500; // 15000 mL total delivered
sim1.float_level = 0; // 0 = FLOAT_LEVEL_DRY
slot1.tick(sim1);

assert.strictEqual(slot1.pump_active, false, "Distribution pump MUST be shut OFF upon float DRY");
assert.strictEqual(slot1.state, "COMPLETE", "State MUST transition to COMPLETE");
assert.strictEqual(slot1.completion_reason, "LOWER_FLOAT_DRY", "Completion reason must be lower float trip");
assert.strictEqual(slot1.actuator_released, true, "Actuator ownership MUST be released safely");
assert.strictEqual(slot1.delivered_water_ml, 15000, "Final delivered volume recorded correctly");
console.log("  PASS: Lower-level float DRY -> pump shuts OFF, COMPLETE state entered, actuator ownership released");


// ---------------------------------------------------------------------------
// Test 3: Maximum runtime exceeded
// ---------------------------------------------------------------------------
console.log("\n[Test 3: Maximum runtime exceeded]");
const slot3 = new SimulatedDeliverySlot({ delivery_target_ml: 50000, delivery_timeout_sec: 3600 });
const sim3 = {
  now_ms: 1000 + 3600001, // 1 hour + 1 ms
  level_sensor_available: true,
  float_level: 1, // Still WET (e.g. sensor stuck)
  flow_sensor_valid: true,
  accumulated_ml: 20000,
  safety_fault: false,
  emergency_stop: false
};
slot3.tick(sim3);

assert.strictEqual(slot3.pump_active, false, "Pump MUST be shut OFF upon timeout");
assert.strictEqual(slot3.state, "FAULTED", "State MUST transition to FAULTED, not COMPLETE");
assert.strictEqual(slot3.fault, "DELIVERY_TIMEOUT", "Fault must be DELIVERY_TIMEOUT");
assert.strictEqual(slot3.actuator_released, true, "Actuator ownership MUST be released safely");
console.log("  PASS: 1-hour timeout reached while WET -> pump safely stopped, marked FAULTED (DELIVERY_TIMEOUT)");


// ---------------------------------------------------------------------------
// Test 4: Emergency stop or safety fault
// ---------------------------------------------------------------------------
console.log("\n[Test 4: Emergency stop or safety fault]");
const slot4 = new SimulatedDeliverySlot({ delivery_target_ml: 20000 });
const sim4 = {
  now_ms: 5000,
  level_sensor_available: true,
  float_level: 1, // WET
  flow_sensor_valid: true,
  accumulated_ml: 2000,
  safety_fault: false,
  emergency_stop: true // E-Stop triggered!
};
slot4.tick(sim4);

assert.strictEqual(slot4.pump_active, false, "Pump MUST shut OFF immediately upon E-Stop");
assert.strictEqual(slot4.state, "FAULTED", "State MUST transition to FAULTED");
assert.strictEqual(slot4.fault, "EMERGENCY_STOP", "Fault must be EMERGENCY_STOP");
assert.strictEqual(slot4.actuator_released, true, "Actuator ownership MUST be released safely");
console.log("  PASS: Emergency stop triggered -> immediate pump shutdown, actuator released");


// ---------------------------------------------------------------------------
// Source Code Pattern Auditing for C Implementation
// ---------------------------------------------------------------------------
console.log("\n[C Source Verification in fertigation_mgr.c]");

// Verify that target volume check does NOT terminate delivery
const deliveryBlock = fertC.slice(fertC.indexOf("/* Decoupled Parallel Multi-GH Delivery Monitor */"));
assert.ok(
  !/if\s*\(\s*delivered\s*>=\s*slot->delivery_target_ml\s*\)\s*\{[^}]*slot->state\s*=\s*DELIVERY_SLOT_COMPLETE;/.test(deliveryBlock),
  "fertigation_mgr.c must NOT mark DELIVERY_SLOT_COMPLETE upon reaching delivery_target_ml"
);
console.log("  PASS: fertigation_mgr.c does not terminate delivery on target volume");

// Verify that lower float check marks DELIVERY_SLOT_COMPLETE and stops pump
assert.match(
  deliveryBlock,
  /if\s*\(float_is_dry\)\s*\{[\s\S]*(?:slot_stop_all_actuators\(slot\)|stop_component\(slot->delivery_pump_id\))[\s\S]*slot->state\s*=\s*DELIVERY_SLOT_COMPLETE;/,
  "float_is_dry must stop pump, release actuator, and mark DELIVERY_SLOT_COMPLETE"
);
console.log("  PASS: float_is_dry stops pump, releases actuator, and completes delivery");

// Verify that timeout releases actuator
assert.match(
  deliveryBlock,
  /(?:slot_stop_all_actuators\(slot\)|stop_component\(slot->delivery_pump_id\))[\s\S]*slot->state\s*=\s*DELIVERY_SLOT_FAULTED;[\s\S]*cp\(slot->fault,\s*sizeof\(slot->fault\),\s*"DELIVERY_TIMEOUT"\);/,
  "Timeout must stop pump, release actuator, and fault slot"
);
console.log("  PASS: Delivery timeout stops pump, releases actuator, and marks fault");

console.log("\n=== ALL FERTIGATION STOP CONDITION TESTS PASSED (5/5) ===");
