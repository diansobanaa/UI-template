import { InstalledComponent } from "../types/equipment";

export const initialInstalledComponents: InstalledComponent[] = [
  {
    componentId: "dosing-pump-001",
    supportedTypeId: "pump-12v-dc",
    name: "Nutrient A Pump",
    lifecycleState: "COMMISSIONED",
    deploymentStatus: "APPLIED",
    assignment: {
      complexId: "complex-01",
      ghId: "GH-01"
    },
    wiring: {
      interface: "GPIO",
      gpio: 12
    },
    parameters: {
      max_duty: 200
    },
    commissioning: {
      commissionedAt: "2026-09-01T10:00:00Z",
      commissionedBy: "Admin",
      result: "PASS"
    }
  },
  {
    componentId: "flow-meter-001",
    supportedTypeId: "flow-meter-fs400a",
    name: "Main Delivery Flow",
    lifecycleState: "REGISTERED", // Not commissioned yet
    deploymentStatus: "PENDING",
    assignment: {
      complexId: "complex-01"
    },
    wiring: {
      interface: "GPIO",
      gpio: 34
    },
    parameters: {
      k_factor: 5.5
    }
  },
  {
    componentId: "solenoid-001",
    supportedTypeId: "solenoid-valve-12v",
    name: "Zone 1 Isolation",
    lifecycleState: "DISABLED",
    deploymentStatus: "APPLIED",
    assignment: {
      complexId: "complex-01",
      ghId: "GH-01"
    },
    wiring: {
      interface: "GPIO",
      gpio: 17,
      polarity: "ACTIVE_HIGH"
    },
    parameters: {}
  }
];
