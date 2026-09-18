export type ComponentType = "PUMP" | "VALVE" | "FLOW_METER" | "SENSOR" | "MIXING_TANK" | "WATER_TANK" | "CAMERA";
export type ComponentScope = "COMPLEX" | "GH";
export type ComponentStatus = "AVAILABLE" | "OFFLINE" | "FAULT" | "DISABLED" | "UNKNOWN";
export type SafetyClass = "CRITICAL" | "NORMAL" | "MONITORING";

export interface Capability {
  capabilityId: string;
  type: string;
  value?: string | null;
}

export interface CommandRequest {
  commandId: string;
  type: "FERTIGATION_START" | "FERTIGATION_STOP" | "WATER_PUMP_TOGGLE" | "FAN_TOGGLE" | "CALIBRATION_START" | "EMERGENCY_STOP" | "CLEAR_FAULT" | "REBOOT";
  targetGhId?: string | null;
  componentId?: string | null;
  durationSeconds?: number | null;
  rawWaterVolumeMl?: number | null;
  dosingAVolumeMl?: number | null;
  dosingBVolumeMl?: number | null;
  parameters?: Record<string, unknown>;
}

export interface Resource {
  resourceId: string;
  type: string;
  componentId: string;
  capabilities: Capability[];
}

export interface Assignment {
  assignmentId: string;
  resourceId: string;
  scope: ComponentScope;
  ghId?: string | null;
}

export interface Ownership {
  resourceId: string;
  ownerId: string;
  ownerType: "SCHEDULE" | "MANUAL" | "SYSTEM";
}

export interface Topology {
  sourceResourceId: string;
  targetResourceId: string;
  connectionType: string;
}

export interface ComponentAssignment {
  complexId: string;
  ghId?: string | null;
}

export interface ComponentWiring {
  interface: "GPIO" | "I2C" | "UART" | "SPI" | "ONE_WIRE" | "ANALOG" | "VIRTUAL";
  gpio?: number | null;
  channel?: number | null;
  address?: string | null;
  port?: string | null;
  polarity?: "ACTIVE_HIGH" | "ACTIVE_LOW" | null;
}

export interface ComponentCommissioning {
  commissionedAt?: string | null;
  commissionedBy?: string | null;
  result?: "PASS" | "FAIL" | null;
  notes?: string | null;
}

export interface InstalledComponent {
  componentId: string;
  supportedTypeId: string;
  name: string;
  lifecycleState: "REGISTERED" | "NOT_COMMISSIONED" | "COMMISSIONED" | "ENABLED" | "DISABLED" | "FAULTED" | "REMOVED";
  deploymentStatus: "PENDING" | "APPLIED" | "FAILED" | "UNKNOWN";
  assignment?: ComponentAssignment | null;
  wiring?: ComponentWiring | null;
  parameters: Record<string, unknown>;
  commissioning?: ComponentCommissioning | null;
  role?: string | null;
  resourceId?: string | null;
}

export interface InventoryResponse {
  deviceId: string;
  complexId: string;
  inventoryVersion: number;
  components: InstalledComponent[];
}

export interface ConfigurationValidation {
  valid: boolean;
  inventoryVersion: number;
  errors: Array<{ code: string; message: string; componentId?: string }>;
  warnings: Array<{ code: string; message: string; componentId?: string }>;
}

export interface Recipe {
  recipeId: string;
  name: string;
  type: "FERTIGATION" | "IRRIGATION" | "MIXING";
  targetEc?: number | null;
  targetPh?: number | null;
  ratioA?: number | null;
  ratioB?: number | null;
  durationSec?: number | null;
  volumeMl?: number | null;
}

export interface ScheduleIntent {
  scheduleId: string;
  targetGhId: string;
  action: "FERTIGATION_START" | "WATER_PUMP_START" | "WATER_PUMP_STOP" | "FAN_START" | "FAN_STOP";
  priority: number;
  missedRunPolicy: "SKIP" | "RUN_ON_RECOVERY" | "RUN_WITHIN_WINDOW" | "MARK_MISSED";
  enabled: boolean;
  recipeId?: string | null;
  triggerType: "DAILY" | "INTERVAL" | "ONCE";
  hour?: number | null;
  minute?: number | null;
  daysOfWeek?: number | null;
  intervalMin?: number | null;
  durationSec?: number | null;
}

export type BlockedReasonCode =
  | "RESOURCE_UNAVAILABLE"
  | "RESOURCE_MISSING"
  | "RESOURCE_DISABLED"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "TOPOLOGY_UNREACHABLE"
  | "NOT_AUTOMATICALLY_ROUTABLE"
  | "SAFETY_DEPENDENCY_MISSING"
  | "SENSOR_REQUIRED"
  | "CALIBRATION_REQUIRED"
  | "RECIPE_INVALID"
  | "CONFIGURATION_VERSION_MISMATCH"
  | "RECURRENCE_INVALID"
  | "RESOURCE_CONFLICT"
  | "INVALID_GH"
  | "TOPOLOGY_MISSING"
  | "NOT_CONFIGURED"
  | "TOPOLOGY_BLOCKED"
  | "CAPABILITY_MISSING";

export interface BlockedReason {
  code: BlockedReasonCode | string;
  message: string;
  resourceId?: string | null;
  componentId?: string | null;
  ghId?: string | null;
  action?: string | null;
  resolution?: string | null;
}

export interface RecipeSnapshot {
  recipeId: string;
  recipeVersion: number;
  name: string;
  type: string;
  targetEc?: number | null;
  targetPh?: number | null;
  ratioA?: number | null;
  ratioB?: number | null;
  durationSec?: number | null;
  volumeMl?: number | null;
}

export interface CompiledSchedule {
  scheduleId: string;
  targetComplexId: string;
  targetGhId: string;
  resolvedAction: string;
  resolvedComponents: string[];
  resolvedResources: string[];
  safetyDependencies: string[];
  recipeVersion?: number | null;
  recipeSnapshot?: RecipeSnapshot | null;
  configurationVersion: number;
  priority: number;
  missedRunPolicy: string;
  executionPolicy: string;
  status: "DRAFT" | "VALIDATING" | "ACTIVE" | "BLOCKED" | "DISABLED" | "INVALID";
  blockedReason?: BlockedReason | null;
}

export interface ConfigurationPayload {
  complexId: string;
  version: number;
  updatedAt: string;
  greenhouses: { ghId: string; name: string }[];
  components: InstalledComponent[];
  assignments: Assignment[];
  schedules: ScheduleIntent[];
  compiledSchedules: CompiledSchedule[];
  recipes: Recipe[];
  topology: Topology[];
  settings: Record<string, unknown>;
}

export interface SyncSnapshot {
  inventory: InventoryResponse;
  configuration: ConfigurationPayload;
  validation: ConfigurationValidation;
  serverTime?: string;
  receivedAt: string;
}

export interface TelemetrySample {
  sequence: number;
  deviceTimestamp: string;
  componentId: string;
  value: number;
  unit: string;
  quality: "GOOD" | "UNCERTAIN" | "BAD";
  measurementType: "MEASURED" | "DERIVED" | "UNAVAILABLE" | "INVALID";
}

export interface TelemetrySnapshot {
  complexId: string;
  ghId?: string | null;
  timestamp: string;
  samples: TelemetrySample[];
}

export interface Event {
  eventId: string;
  sequence: number;
  deviceTimestamp: string;
  eventType: string;
  severity: "INFO" | "WARNING" | "FAULT" | "CRITICAL";
  complexId?: string | null;
  ghId?: string | null;
  componentId?: string | null;
  payload?: Record<string, unknown>;
}

export interface EventResponse {
  events: Event[];
  nextSequence?: number | null;
  hasMore: boolean;
}

export interface FertigationRun {
  runId: string;
  recipeId: string;
  ghId: string;
  status: "PENDING" | "MIXING" | "DOSING" | "DELIVERY" | "COMPLETED" | "CANCELLED" | "FAULTED";
  targetWaterL?: number | null;
  actualWaterL?: number | null;
  targetDosingAMl?: number | null;
  actualDosingAMl?: number | null;
  targetDosingBMl?: number | null;
  actualDosingBMl?: number | null;
  startTimestamp?: string | null;
  endTimestamp?: string | null;
  progressPct?: number | null;
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
  status: "CREATED" | "ACCEPTED" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "REJECTED" | "CANCELLED";
  acceptedAt: string;
  message?: string;
}

export interface ClockSyncRequest {
  timestamp: string;
  timezone: string;
}

export interface ClockResponse {
  deviceTimestamp: string;
  timezone: string;
  synchronizedAt?: string | null;
  rtcAvailable?: boolean;
}

export interface HealthResponse {
  apiVersion: string;
  schemaVersion: number;
  deviceId: string;
  complexId: string;
  firmwareVersion: string;
  bootId: string;
  uptimeSec: number;
  currentTime: string;
  timezone: string;
  configurationVersion: number;
  inventoryVersion: number;
  runtimeState: string;
  health: string;
}

export interface StatusResponse {
  device: Record<string, unknown>;
  network: Record<string, unknown>;
  clock: Record<string, unknown>;
  configuration: Record<string, unknown>;
  inventory: Record<string, unknown>;
  runtime: Record<string, unknown>;
  actuators: Record<string, unknown>;
  sensors: Record<string, unknown>;
  storage: Record<string, unknown>;
  safety: Record<string, unknown>;
  cropCycle?: Record<string, unknown> | null;
  queue: Record<string, unknown>;
  sync: Record<string, unknown>;
}

export interface CapabilitiesResponse {
  deviceId: string;
  capabilitiesVersion: number;
  capabilities: Record<string, boolean>;
}

export interface ContextResponse {
  complex: {
    complexId: string;
    name: string;
    location: string | null;
    status: "ACTIVE" | "INACTIVE" | "FAULTED";
  };
  greenhouses: Array<{
    ghId: string;
    complexId: string;
    name: string;
    status: "ACTIVE" | "INACTIVE" | "FAULTED";
  }>;
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

export interface Plant {
  plantId: string;
  cycleId: string;
  ghId: string;
  plantTag: string;
  status: "HEALTHY" | "SICK" | "DEAD" | "HARVESTED";
  plantedAt: string;
  mortalityDate?: string | null;
  mortalityReason?: string | null;
}

export interface Fruit {
  fruitId: string;
  plantId: string;
  cycleId: string;
  status: "DEVELOPING" | "HARVESTED" | "DROPPED" | "CULLED";
  taggedAt: string;
  harvestedAt?: string | null;
  weightG?: number | null;
  qualityGrade?: string | null;
}

export interface Observation {
  observationId: string;
  plantId: string;
  cycleId: string;
  timestamp: string;
  heightCm: number;
  leafCount: number;
  fruitCount: number;
  notes?: string | null;
}

export interface GhCapabilities {
  CAN_DELIVER: boolean;
  CAN_AUTO_FILL: boolean;
  CAN_AUTO_DOSE: boolean;
  CAN_AUTO_MIX: boolean;
  CAN_AUTO_ROUTE: boolean;
  CAN_MONITOR_FLOW: boolean;
  CAN_MONITOR_LEVEL: boolean;
  CAN_MONITOR_EC: boolean;
  CAN_MONITOR_PH: boolean;
  CAN_CLIMATE_CONTROL: boolean;
  CAN_RUN_AUTONOMOUSLY: boolean;
}

export interface GhTopologyState {
  ghId: string;
  configured: boolean;
  hydraulicallyReachable: boolean;
  automaticallyRoutable: boolean;
  manuallyRoutable: boolean;
  currentSharedTarget?: string;
  blockingReason?: string;
  capabilities: GhCapabilities;
}

export interface TopologyStateResponse {
  greenhouses: GhTopologyState[];
}

export interface StartCropCycleRequest {
  tanggalTanam: string;
  variety?: string;
  plantCount?: number;
  notes?: string;
}

export interface ImportActiveCropCycleRequest {
  tanggalTanam: string;
  tanggalPolinasi?: string | null;
  variety?: string;
  plantCount?: number;
  notes?: string;
}

export interface PollinationRequest {
  tanggalPolinasi: string;
  pollinationMethod?: "natural" | "bee" | "manual";
  notes?: string;
}

export interface UpdatePollinationRequest {
  tanggalPolinasi: string;
  pollinationMethod?: "natural" | "bee" | "manual";
  expectedVersion?: number;
}

export interface CropCycleHistoryResponse {
  items: CurrentCropCycleResponse[];
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface UpdatePlantingDateRequest {
  tanggalTanam: string;
  expectedVersion?: number;
}

export interface UpdateCropCycleMetadataRequest {
  variety?: string;
  plantCount?: number;
  notes?: string;
  expectedVersion?: number;
}

export interface HarvestCycleRequest {
  harvestDate?: string;
  yieldKg?: number;
  grade?: string;
  notes?: string;
  expectedVersion?: number;
}

export interface OperationRequest {
  expectedVersion?: number;
}

export interface SchedulesResponse {
  items: ScheduleIntent[];
  total: number;
}

export interface CalibrationRequest {
  componentId: string;
  type: "DOSING_A" | "DOSING_B" | "FLOW_RAW" | "FLOW_FERT" | "SENSOR_PH" | "SENSOR_EC";
  durationSec: number;
}

export interface CalibrationStatus {
  state: "IDLE" | "RUNNING" | "COMPLETE" | "ERROR";
  remainingSec: number;
  measuredValue?: number | null;
}

export interface CalibrationRates {
  rateDosingAMlSec: number;
  rateDosingBMlSec: number;
  flowRawPulsesPerL: number;
  flowFertPulsesPerL: number;
}

export interface SetCalibrationRateRequest {
  componentId: string;
  rateValue: number;
}

export interface HardwarePortConfig {
  pythonBaseUrl: string;
  esp32BaseUrl?: string;
  requestTimeoutMs: number;
  token?: string;
  directEsp32Enabled: boolean;
}
