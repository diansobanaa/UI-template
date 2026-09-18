import { SupportedComponentDefinition } from "../types/equipment";

export const hardwareCatalog: SupportedComponentDefinition[] = [
  {
    supportedTypeId: "pump-12v-dc",
    model: "Standard 12V DC Pump",
    category: "PUMP",
    displayName: "12V DC Water Pump",
    driverType: "pwm_dc_motor",
    interfaceType: "GPIO",
    safetyClass: "NORMAL",
    calibrationRequired: true,
    supportedCapabilities: [
      { id: "cap-flow", name: "Flow Control", description: "Adjustable flow rate via PWM" },
      { id: "cap-onoff", name: "On/Off Control", description: "Basic power toggle" }
    ],
    parameterDefinitions: [
      { id: "max_duty", name: "Max Duty Cycle", type: "number", required: true, defaultValue: 255, description: "Maximum PWM value (0-255)" }
    ],
    installationGuide: {
      purpose: "Used for dosing nutrients, pH balancers, or general water movement.",
      wiringInstructions: "Connect Positive (Red) to Motor Driver OUT+, Negative (Black) to OUT-. Ensure flyback diode is in place if driving directly from MOSFET.",
      safetyWarnings: ["Do not run dry for more than 30 seconds to prevent overheating."],
      verificationTest: "Pulse for 3 seconds and verify liquid movement."
    }
  },
  {
    supportedTypeId: "flow-meter-fs400a",
    model: "FS400A",
    category: "SENSOR",
    displayName: "FS400A Flow Meter",
    driverType: "pulse_counter",
    interfaceType: "GPIO",
    safetyClass: "NORMAL",
    calibrationRequired: true,
    supportedCapabilities: [
      { id: "cap-flow-measure", name: "Flow Measurement", description: "Measures volume of fluid passing through" }
    ],
    parameterDefinitions: [
      { id: "k_factor", name: "K-Factor", type: "number", required: true, defaultValue: 5.5, description: "Pulses per liter" }
    ],
    installationGuide: {
      purpose: "Measures the exact volume of water or nutrient solution delivered.",
      wiringInstructions: "Red: 5V, Black: GND, Yellow: Signal to an interrupt-capable GPIO pin.",
      safetyWarnings: ["Ensure arrow on sensor matches fluid direction.", "Do not exceed maximum pressure rating."],
      verificationTest: "Run known volume (1L) through and check pulse count matches K-Factor."
    }
  },
  {
    supportedTypeId: "solenoid-valve-12v",
    model: "12V Normally Closed Valve",
    category: "VALVE",
    displayName: "Solenoid Valve (12V NC)",
    driverType: "gpio_relay",
    interfaceType: "GPIO",
    safetyClass: "CRITICAL",
    calibrationRequired: false,
    supportedCapabilities: [
      { id: "cap-isolate", name: "Isolation", description: "Blocks fluid flow when closed" }
    ],
    parameterDefinitions: [],
    installationGuide: {
      purpose: "Isolates greenhouse zones or prevents backflow.",
      wiringInstructions: "Connect to 12V relay module. Ensure relay control pin is pulled LOW on boot.",
      safetyWarnings: ["CRITICAL: Failure to close may cause flooding.", "Valve can get hot during continuous operation."],
      verificationTest: "Actuate relay and listen for audible click. Verify flow starts/stops."
    }
  }
];
