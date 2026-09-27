import { SupportedComponentDefinition } from "../types/equipment";

export const hardwareCatalog: SupportedComponentDefinition[] = [
  {
    supportedTypeId: "pump-12v-dc",
    model: "Standard 12V DC Pump",
    category: "PUMP",
    displayName: "12V DC Water Pump",
    driverType: "gpio_actuator",
    interfaceType: "GPIO",
    safetyClass: "NORMAL",
    calibrationRequired: true,
    supportedCapabilities: [
      { id: "cap-onoff", name: "On/Off Control", description: "Basic digital relay/MOSFET power toggle" }
    ],
    parameterDefinitions: [],
    installationGuide: {
      purpose: "Used for dosing nutrients, pH balancers, or general water movement.",
      wiringInstructions: "Connect Positive (Red) to Relay/MOSFET load OUT+, Negative (Black) to OUT-. Ensure flyback diode is in place if driving directly from MOSFET.",
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
  },
  {
    supportedTypeId: "cooling-fan",
    model: "Greenhouse Exhaust / Blower Fan",
    category: "ACTUATOR",
    displayName: "Greenhouse Ventilation Fan",
    driverType: "gpio_relay",
    interfaceType: "GPIO",
    safetyClass: "NORMAL",
    calibrationRequired: false,
    supportedCapabilities: [
      { id: "cap-ventilation", name: "Ventilation", description: "Circulates or exhausts greenhouse air" },
      { id: "cap-onoff", name: "On/Off Control", description: "Relay power toggle" }
    ],
    parameterDefinitions: [],
    installationGuide: {
      purpose: "Controls temperature and humidity through active greenhouse air exhaust.",
      wiringInstructions: "Trigger via relay board (GPIO 10 for Blower Fan, GPIO 7 for Cooling Fan). Active-LOW.",
      safetyWarnings: ["Ensure contactor is sized for motor inductive inrush current."],
      verificationTest: "Trigger relay and check airflow and rotation direction."
    }
  },
  {
    supportedTypeId: "temperature-ds18b20",
    model: "DS18B20",
    category: "SENSOR",
    displayName: "DS18B20 Waterproof Temp Sensor",
    driverType: "one_wire",
    interfaceType: "ONE_WIRE",
    safetyClass: "MONITORING",
    calibrationRequired: false,
    supportedCapabilities: [
      { id: "cap-temp-measure", name: "Temperature Measurement", description: "Precision digital temperature" }
    ],
    parameterDefinitions: [],
    installationGuide: {
      purpose: "Monitors mixing tank water or nutrient solution temperature.",
      wiringInstructions: "Connect Data to 1-Wire GPIO 17 with 4.7k pullup resistor to 3.3V.",
      safetyWarnings: ["Do not exceed +85C operational limit."],
      verificationTest: "Verify temperature telemetry reads between 15C and 35C."
    }
  },
  {
    supportedTypeId: "lower-float",
    model: "Liquid Level Float Switch",
    category: "SENSOR",
    displayName: "Lower Water Float Switch",
    driverType: "gpio_switch",
    interfaceType: "GPIO",
    safetyClass: "CRITICAL",
    calibrationRequired: false,
    supportedCapabilities: [
      { id: "cap-dry-protection", name: "Dry-Run Interlock", description: "Stops pumps when water level is below minimum" }
    ],
    parameterDefinitions: [],
    installationGuide: {
      purpose: "Safety stop point preventing raw and distribution pumps from dry running.",
      wiringInstructions: "Connect switch to GPIO 38. Pulled up to 3.3V internally. Closed to GND when dry.",
      safetyWarnings: ["CRITICAL: Verify contact orientation (NO vs NC) before operating pumps."],
      verificationTest: "Lift float manually and verify state transitions between OK and DRY."
    }
  },
  {
    supportedTypeId: "flow-meter-zjb1",
    model: "ZJ-B1",
    category: "SENSOR",
    displayName: "ZJ-B1 Raw Water Flow Meter",
    driverType: "pulse_counter",
    interfaceType: "GPIO",
    safetyClass: "NORMAL",
    calibrationRequired: true,
    supportedCapabilities: [
      { id: "cap-flow-measure", name: "Raw Flow Measurement", description: "Measures volume of incoming raw well water" }
    ],
    parameterDefinitions: [
      { id: "k_factor", name: "K-Factor", type: "number", required: true, defaultValue: 5.0, description: "Pulses per liter" }
    ],
    installationGuide: {
      purpose: "Monitors water delivered from well pump into mixing tank.",
      wiringInstructions: "Signal to GPIO 15 interrupt line with 5V VCC and common GND.",
      safetyWarnings: ["Calibrate against known graduated cylinder before automatic dosing."],
      verificationTest: "Run pump for 10 seconds and verify pulses increment."
    }
  },
  {
    supportedTypeId: "dht22-am2302",
    model: "DHT22 / AM2302",
    category: "SENSOR",
    displayName: "DHT22 / AM2302 Temp & Humidity Sensor",
    driverType: "single_wire",
    interfaceType: "GPIO",
    safetyClass: "MONITORING",
    calibrationRequired: false,
    supportedCapabilities: [
      { id: "cap-temp-measure", name: "Air Temperature", description: "Measures ambient air temperature (-40°C to +80°C)" },
      { id: "cap-humidity-measure", name: "Relative Humidity", description: "Measures relative humidity (0–100% RH)" }
    ],
    parameterDefinitions: [],
    installationGuide: {
      purpose: "Monitors greenhouse ambient air temperature and relative humidity.",
      wiringInstructions: "Connect VCC to 3.3V/5V, DATA to GPIO 41, GND to GND. Built-in module pull-up.",
      safetyWarnings: ["Non-blocking driver with minimum 3-second sample cadence. Do not poll aggressively."],
      verificationTest: "Check telemetry readings for temperature and relative humidity."
    }
  },
  {
    supportedTypeId: "active-buzzer",
    model: "Active DC Buzzer",
    category: "ACTUATOR",
    displayName: "Active Alarm Buzzer",
    driverType: "gpio_mosfet",
    interfaceType: "GPIO",
    safetyClass: "NORMAL",
    calibrationRequired: false,
    supportedCapabilities: [
      { id: "cap-alarm-sound", name: "Acoustic Alarm", description: "85 dB acoustic alarm sounder at ~2.7 kHz" },
      { id: "cap-onoff", name: "On/Off Control", description: "Digital alarm toggle" }
    ],
    parameterDefinitions: [],
    installationGuide: {
      purpose: "Audible alarm annunciator for critical faults and operator notifications.",
      wiringInstructions: "Driven via MOSFET Module Gate on GPIO 18 to safely source ~30 mA without loading ESP32 GPIO.",
      safetyWarnings: ["Do NOT drive directly from ESP32 GPIO without transistor/MOSFET driver stage."],
      verificationTest: "Toggle buzzer manually from UI and verify acoustic sound."
    }
  }
];
