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

export interface ClockResponse {
  currentUtc: string;
  currentLocal: string;
  timezone: string;
  synced: boolean;
  lastSyncSource?: "NTP" | "PYTHON" | "UI" | "RTC";
  driftMs?: number;
}

export interface HealthResponse {
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  uptimeSeconds: number;
  freeHeap: number;
  minFreeHeap?: number;
  wifiRssi?: number;
  ethernetUp?: boolean;
  emergencyStopped: boolean;
  timestamp: string;
}

export interface StatusResponse {
  deviceId: string;
  complexId: string;
  bootId: string;
  timestamp: string;
  health: HealthResponse;
  configurationVersion: number;
  emergencyStopped: boolean;
  runtimeState: string;
  actuators?: Record<string, boolean | string>;
  sensors?: Record<string, number | null>;
}

export interface CapabilitiesResponse {
  deviceId: string;
  model: string;
  features: string[];
  maxSchedules: number;
  supportedPeripherals: string[];
}

export interface ContextResponse {
  deviceId: string;
  complexId: string;
  greenhouseIds: string[];
  hostname: string;
  ipAddress: string;
}

/* ------------------------------------------------------------------ */
/* Canonical Crop Cycle DTOs matching UI_ESP32_OPENAPI.yaml           */
/* ------------------------------------------------------------------ */

export type ApiCycleStatus = "NO_CYCLE" | "ACTIVE" | "HARVESTED" | "CANCELLED";

export interface HarvestSummary {
  harvestDate: string;
  tanggalTanam: string;
  tanggalPolinasi?: string | null;
  hstAtHarvest: number;
  hspAtHarvest?: number | null;
  yieldKg?: number;
  grade?: string;
  notes?: string;
  recordedAt: string;
}

export interface CurrentCropCycleResponse {
  cycleId?: string;
  ghId: string;
  status: ApiCycleStatus;
  tanggalTanam?: string | null;
  tanggalPolinasi?: string | null;
  variety?: string | null;
  plantCount?: number | null;
  notes?: string | null;
  hst?: number | null;
  hsp?: number | null;
  version: number;
  lastHarvestSummary?: HarvestSummary | null;
}

export interface StartCropCycleRequest {
  tanggalTanam: string;
  variety?: string;
  plantCount?: number;
  notes?: string;
  requestId?: string;
}

export interface ImportActiveCropCycleRequest {
  tanggalTanam: string;
  tanggalPolinasi?: string | null;
  variety?: string;
  plantCount?: number;
  notes?: string;
  requestId?: string;
}

export interface PollinationRequest {
  tanggalPolinasi: string;
  pollinationMethod?: "natural" | "bee" | "manual";
  notes?: string;
  requestId?: string;
}

export interface UpdatePollinationRequest {
  tanggalPolinasi: string;
  pollinationMethod?: "natural" | "bee" | "manual";
  requestId?: string;
}

export interface UpdatePlantingDateRequest {
  tanggalTanam: string;
  requestId?: string;
}

export interface UpdateCropCycleMetadataRequest {
  variety?: string;
  plantCount?: number;
  notes?: string;
  requestId?: string;
}

export interface HarvestCycleRequest {
  harvestDate?: string;
  yieldKg?: number;
  grade?: string;
  notes?: string;
  requestId?: string;
}

export interface OperationRequest {
  requestId?: string;
}

export interface CropCycleHistoryResponse {
  items: CurrentCropCycleResponse[];
  total?: number;
  nextCursor?: string;
}

export interface HardwarePortConfig {
  pythonBaseUrl: string;
  esp32BaseUrl?: string;
  requestTimeoutMs: number;
  token?: string;
  directEsp32Enabled: boolean;
}
