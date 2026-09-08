export type ComponentType = "PUMP" | "VALVE" | "FLOW_METER" | "SENSOR" | "MIXING_TANK" | "WATER_TANK" | "CAMERA";
export type ComponentScope = "COMPLEX" | "GH";
export type ComponentStatus = "AVAILABLE" | "OFFLINE" | "FAULT" | "DISABLED" | "UNKNOWN";
export type SafetyClass = "CRITICAL" | "NORMAL" | "MONITORING";

export interface HardwareComponent {
  componentId: string;
  type: ComponentType;
  role?: string;
  name: string;
  scope: ComponentScope;
  ghId?: string | null;
  status: ComponentStatus;
  enabled: boolean;
  required: boolean;
  safetyClass: SafetyClass;
  capabilities: string[];
  state?: "ON" | "OFF" | "OPEN" | "CLOSED" | "MOVING" | "ONLINE" | "OFFLINE" | "INVALID" | "FAULT" | "UNKNOWN";
  units?: string[];
  limits?: Record<string, number>;
}

export interface Esp32Inventory {
  deviceId: string;
  complexId: string;
  firmwareVersion: string;
  hardwareVersion: string;
  inventoryVersion: number;
  reportedAt: string;
  components: HardwareComponent[];
}

export interface ConfigurationValidation {
  valid: boolean;
  inventoryVersion: number;
  errors: Array<{ code: string; message: string; componentId?: string }>;
  warnings: Array<{ code: string; message: string; componentId?: string }>;
}

export interface Esp32Configuration {
  complexId: string;
  version: number;
  inventoryVersion: number;
  timezone: string;
  updatedAt: string;
  assignments: Record<string, string | null>;
  schedules: unknown[];
  settings: Record<string, unknown>;
}

export interface SyncSnapshot {
  inventory: Esp32Inventory;
  configuration: Esp32Configuration;
  validation: ConfigurationValidation;
  serverTime?: string;
  receivedAt: string;
}

export interface TelemetrySnapshot {
  complexId: string;
  greenhouseId?: string;
  recordedAt: string;
  staleAfterSeconds: number;
  values: Record<string, number | string | boolean | null>;
  components: Record<string, {
    value: number | string | boolean | null;
    unit?: string;
    state: string;
    recordedAt: string;
  }>;
}

export interface Esp32EventLog {
  id: string;
  at: string;
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  code: string;
  message: string;
  componentId?: string;
  greenhouseId?: string;
}

export interface CommandReceipt {
  commandId: string;
  status: "ACCEPTED" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "REJECTED";
  acceptedAt: string;
  message?: string;
}

export interface ClockSyncRequest {
  utcNow: string;
  timezone: string;
  source: "PYTHON" | "UI";
}

export interface HardwarePortConfig {
  pythonBaseUrl: string;
  esp32BaseUrl?: string;
  requestTimeoutMs: number;
  token?: string;
  directEsp32Enabled: boolean;
}
