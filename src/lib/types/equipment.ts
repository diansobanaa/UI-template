/**
 * M2 UI Hardware Component Management Domain Models
 *
 * M3.0 NOTE: InstalledComponent is now re-exported from the OpenAPI canonical
 * source (contracts.ts) to ensure a single authoritative type across the
 * codebase. All UI code importing InstalledComponent from this module will
 * automatically receive the contracts-canonical version.
 */

export type InterfaceType = "GPIO" | "I2C" | "UART" | "SPI" | "ONE_WIRE" | "ANALOG" | "VIRTUAL";
export type LifecycleState = "REGISTERED" | "NOT_COMMISSIONED" | "COMMISSIONED" | "ENABLED" | "DISABLED" | "FAULTED" | "REMOVED";
export type DeploymentStatus = "PENDING" | "APPLIED" | "FAILED" | "UNKNOWN";

export interface ComponentCapability {
  id: string;
  name: string;
  description: string;
}

export interface ComponentParameterDefinition {
  id: string;
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  options?: string[];
  required: boolean;
  defaultValue?: string | number | boolean;
  description?: string;
}

export interface InstallationGuide {
  purpose: string;
  wiringInstructions: string;
  safetyWarnings: string[];
  verificationTest: string;
}

export interface SupportedComponentDefinition {
  supportedTypeId: string; // e.g. "pump-12v-dc", "flow-meter-fs400a"
  model: string;
  category: "PUMP" | "SENSOR" | "VALVE" | "ACTUATOR" | "CONTROLLER";
  displayName: string;
  driverType: string;
  interfaceType: InterfaceType;
  supportedCapabilities: ComponentCapability[];
  parameterDefinitions: ComponentParameterDefinition[];
  installationGuide: InstallationGuide;
  safetyClass: "CRITICAL" | "NORMAL" | "MONITORING";
  calibrationRequired: boolean;
}

export interface ComponentWiring {
  interface: InterfaceType;
  gpio?: number;
  channel?: number;
  address?: string;
  port?: string;
  polarity?: "ACTIVE_HIGH" | "ACTIVE_LOW";
}

export interface ComponentAssignment {
  complexId: string;
  ghId?: string | null;
}

export interface ComponentCommissioning {
  commissionedAt?: string;
  commissionedBy?: string;
  result?: "PASS" | "FAIL";
  notes?: string;
}

// M3.0: InstalledComponent is the canonical OpenAPI type from contracts.ts.
// Re-exported here for backward compatibility with existing UI imports.
export type { InstalledComponent } from '../api/contracts';
