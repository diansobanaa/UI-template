import type { InstalledComponent } from "../api/contracts";

export interface BaselineOptions {
  includeFan?: boolean;
}

/**
 * Generates the authoritative canonical hardware baseline components
 * matching DYNAMIC_HARDWARE_REGISTRY_ARCHITECTURE.md Section 2.3 and pin_config.h.
 *
 * Pin assignments:
 * - Well Pump: GPIO 1 (Relay Ch 1, ACTIVE_LOW)
 * - Distribution Pump: GPIO 2 (Relay Ch 2, ACTIVE_LOW)
 * - Raw Submersible: GPIO 4 (Relay Ch 3/Aux, ACTIVE_LOW)
 * - Dosing Pump A: GPIO 5 (MOSFET Ch 1, ACTIVE_LOW)
 * - Dosing Pump B: GPIO 6 (MOSFET Ch 2, ACTIVE_LOW)
 * - (Optional) Blower Fan: GPIO 10 (Relay Ch 3, ACTIVE_LOW)
 */
export function getCanonicalBaselineComponents(
  complexId: string,
  options: BaselineOptions = {}
): InstalledComponent[] {
  const components: InstalledComponent[] = [
    {
      componentId: "pump_well",
      name: "Well Pump",
      supportedTypeId: "pump-12v-dc",
      role: "WELL_PUMP",
      lifecycleState: "COMMISSIONED",
      deploymentStatus: "APPLIED",
      assignment: {
        complexId,
      },
      wiring: {
        interface: "GPIO",
        gpio: 1,
        polarity: "ACTIVE_LOW",
      },
      parameters: {},
    },
    {
      componentId: "pump_dist",
      name: "Distribution Pump",
      supportedTypeId: "pump-12v-dc",
      role: "DIST_PUMP",
      lifecycleState: "COMMISSIONED",
      deploymentStatus: "APPLIED",
      assignment: {
        complexId,
      },
      wiring: {
        interface: "GPIO",
        gpio: 2,
        polarity: "ACTIVE_LOW",
      },
      parameters: {},
    },
    {
      componentId: "pump_submersible",
      name: "Raw Submersible Pump",
      supportedTypeId: "pump-12v-dc",
      role: "RAW_SUBMERSIBLE",
      lifecycleState: "COMMISSIONED",
      deploymentStatus: "APPLIED",
      assignment: {
        complexId,
      },
      wiring: {
        interface: "GPIO",
        gpio: 4,
        polarity: "ACTIVE_LOW",
      },
      parameters: {},
    },
    {
      // Canonical baseline = 2 dosing pumps (A, B). Untuk 3+ pumps (C..G via PCA9685 I2C expansion),
      // operator menambahkan komponen via /equipment page — lihat DYNAMIC_HARDWARE_REGISTRY_ARCHITECTURE.md §3 Pathway B.
      componentId: "pump_dosing_a",
      name: "Dosing Pump A",
      supportedTypeId: "pump-12v-dc",
      role: "DOSING_A",
      lifecycleState: "COMMISSIONED",
      deploymentStatus: "APPLIED",
      assignment: {
        complexId,
      },
      wiring: {
        interface: "GPIO",
        gpio: 5,
        polarity: "ACTIVE_LOW",
      },
      parameters: {},
    },
    {
      componentId: "pump_dosing_b",
      name: "Dosing Pump B",
      supportedTypeId: "pump-12v-dc",
      role: "DOSING_B",
      lifecycleState: "COMMISSIONED",
      deploymentStatus: "APPLIED",
      assignment: {
        complexId,
      },
      wiring: {
        interface: "GPIO",
        gpio: 6,
        polarity: "ACTIVE_LOW",
      },
      parameters: {},
    },
  ];

  if (options.includeFan) {
    components.push({
      componentId: "fan_blower",
      name: "Greenhouse Blower Fan",
      supportedTypeId: "cooling-fan",
      role: "BLOWER_FAN",
      lifecycleState: "COMMISSIONED",
      deploymentStatus: "APPLIED",
      assignment: {
        complexId,
      },
      wiring: {
        interface: "GPIO",
        gpio: 10,
        polarity: "ACTIVE_LOW",
      },
      parameters: {},
    });
  }

  return components;
}
