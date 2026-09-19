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
  type: string;
  targetComplexId?: string | null;
  targetGhId?: string | null;
  componentId?: string | null;
  resourceId?: string | null;
  durationSeconds?: number | null;
  maxRuntimeSec?: number | null;
  configurationVersion?: number | null;
  source?: string | null;
  rawWaterVolumeMl?: number | null;
  parameters?: Record<string, unknown>;
}

export interface Resource {
  resourceId: string;
  type: string;
  componentId: string;
  shared?: boolean;
  available?: boolean;
  capabilities: Capability[];
}

export interface ResourceState {
  resourceId: string;
  type: string;
  componentId?: string;
  shared: boolean;
  available: boolean;
  ownerId?: string | null;
  owners?: string[];
  assignments: Assignment[];
}

export interface ResourceTransferResponse {
  configuration: ConfigurationPayload;
  resource: ResourceState;
  transfer: { resourceId: string; fromGhIds: string[]; toGhId: string; physicalMoveConfirmed: boolean; configurationVersion: number };
  affectedSchedules: Array<Record<string, unknown>>;
  capabilities: Record<string, unknown>;
  requiresDeployment: boolean;
  deploymentStatus: string;
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
  pathId?: string;
  sourceResourceId: string;
  targetResourceId: string;
  connectionType?: string;
  mode?: "AUTOMATIC" | "MANUAL";
  shared?: boolean;
  enabled?: boolean;
  pumpResourceId?: string | null;
  valveResourceId?: string | null;
  tankResourceId?: string | null;
  targetGhId?: string | null;
  routeOwnerGhId?: string | null;
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
  version?: number;
  mixingDurationSec?: number | null;
  dosingChannels?: Array<{ componentId: string; requestedMl: number }>;
}

export interface Schedule {
  id?: string;
  scheduleId?: string;
  ownerId?: string;
  complexId?: string | null;
  ghId?: string | null;
  priority?: number;
  type: "DAILY" | "INTERVAL" | "ONCE";
  action: "FERTIGATION" | "WATER_PUMP" | "FAN_TOGGLE" | "CUSTOM";
  recipeId?: string | null;
  enabled: boolean;
  hour?: number | null;
  minute?: number | null;
  daysOfWeek?: number | null;
  intervalMin?: number | null;
  timestamp?: string | null;
  durationSec?: number | null;
  parameters?: Record<string, unknown>;
  constraints?: string[];
  missedRunPolicy?: "EXECUTE" | "SKIP";
}

export type ScheduleActivationState = "DRAFT" | "VALIDATING" | "ACTIVE" | "BLOCKED" | "DISABLED" | "INVALID";

export interface ScheduleCompileIssue {
  code: string;
  message: string;
  scheduleId?: string;
  ghId?: string;
  resourceId?: string;
  componentId?: string;
  [key: string]: unknown;
}

export interface ScheduleCompileResponse {
  configurationVersion: number;
  valid: boolean;
  results: Array<{
    scheduleId: string;
    status: string;
    activationState?: ScheduleActivationState;
    errors?: ScheduleCompileIssue[];
    blockedReasons?: ScheduleCompileIssue[];
    compiled?: CompiledSchedule | null;
  }>;
  compiled: CompiledSchedule[];
  blocked: Array<Record<string, unknown>>;
  invalid: Array<Record<string, unknown>>;
}

export interface ScheduleDeploymentResponse extends ScheduleCompileResponse {
  status: string;
  device?: Record<string, unknown>;
  error?: string;
}

export interface CompiledSchedule {
  compiledId: string;
  scheduleId: string;
  status: "ACTIVE" | "BLOCKED" | "CONFLICT" | "EXECUTING" | "COMPLETED" | "CANCELLED";
  activationState?: ScheduleActivationState;
  complexId?: string;
  ghId?: string | null;
  action?: string;
  ownerId?: string;
  priority?: number;
  resourceIds: string[];
  componentIds?: string[];
  startTimestamp: number;
  endTimestamp: number;
  configurationVersion?: number;
  configurationHash?: string | null;
  missedRunPolicy?: "EXECUTE" | "SKIP";
  blockedReasons?: ScheduleCompileIssue[];
  dependencies?: Record<string, unknown>;
  safety?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  recipeSnapshot?: Recipe | null;
  executionPlan?: Record<string, unknown> | null;
  conflictReason?: string | null;
}

export interface ConfigurationDeploymentState {
  configurationVersion: number;
  configurationHash?: string | null;
  inventoryVersion: number;
  schemaVersion: number;
  deploymentStatus: "EMPTY" | "CANDIDATE_STAGED" | "ACTIVE" | "ROLLED_BACK" | "FAILED" | "UNKNOWN";
  deploymentId?: string | null;
  candidateConfigurationVersion?: number;
  candidateDeploymentId?: string | null;
  previousConfigurationVersion?: number;
}

export interface ConfigurationPayload {
  complexId: string;
  version: number;
  updatedAt: string;
  configurationHash?: string | null;
  components: InstalledComponent[];
  assignments: Assignment[];
  resources?: Resource[];
  schedules: Schedule[];
  recipes: Recipe[];
  topology: Topology[];
  settings: Record<string, unknown>;
}

export interface SyncSnapshot {
  inventory?: InventoryResponse;
  configuration?: ConfigurationPayload;
  validation?: ConfigurationValidation;
  complexId?: string;
  complex?: Record<string, unknown>;
  greenhouses?: Array<Record<string, unknown>>;
  deployment?: { desiredVersion: number; desiredHash?: string | null; deviceVersion: number; deviceHash?: string | null; status: string; updatedAt?: string | null };
  history?: { telemetry: { earliestSequence: number | null; latestSequence: number | null }; events: { earliestSequence: number | null; latestSequence: number | null } };
  sync?: { telemetryCursor: number; eventCursor: number; lastSyncAt?: string | null; lastSyncStatus: string; lastSyncError?: string | null };
  serverTime?: string;
  receivedAt?: string;
}

export type ResearchCycleStatus = "ACTIVE" | "HARVESTED" | "CANCELLED" | "ABANDONED" | "ARCHIVED";
export interface ResearchCycle {
  cycleId: string; complexId: string; ghId: string; status: ResearchCycleStatus;
  plantingDate?: string | null; pollinationDate?: string | null; expectedHarvestDate?: string | null; actualHarvestDate?: string | null;
  variety?: string | null; plantCount: number; mortalityCount: number; yieldKg?: number | null; grade?: string | null; notes?: string | null;
  hst?: number | null; hsp?: number | null; version: number; source?: string; sourceDeviceId?: string | null; createdAt?: string; updatedAt?: string;
}
export interface ResearchPlant {
  plantId: string; cycleId: string; complexId: string; ghId: string; plantTag: string; position?: string | null; plantedAt?: string | null;
  status: "ALIVE" | "DEAD" | "REMOVED" | "MORTALITY" | string; mortalityDate?: string | null; mortalityReason?: string | null; notes?: string | null;
}
export interface ResearchFruit {
  fruitId: string; plantId: string; cycleId: string; complexId: string; ghId: string; fruitTag?: string | null; pollinationDate?: string | null;
  developmentStatus: string; harvestedAt?: string | null; weightG?: number | null; grade?: string | null; notes?: string | null;
}
export interface ResearchObservation {
  observationId: string; cycleId: string; complexId: string; ghId: string; plantId?: string | null; fruitId?: string | null; observedAt: string;
  metric: string; value?: number | null; textValue?: string | null; unit?: string | null; notes?: string | null; observer?: string | null; source?: string | null; photoRef?: string | null;
}
export interface ResearchAnalysis {
  cycle: ResearchCycle; counts: { plants: number; fruits: number; observations: number; telemetrySamples: number; events: number; fertigationRuns: number };
  plants: ResearchPlant[]; fruits: ResearchFruit[]; observations: ResearchObservation[]; telemetry: TelemetrySample[]; events: Event[]; fertigationRuns: FertigationRun[];
  calibrations: Array<Record<string, unknown>>; relationships: Record<string, unknown>;
}

export interface TelemetrySample {
  sequence: number;
  deviceTimestamp: string;
  receivedAt?: string;
  componentId: string;
  metricId?: string | null;
  ghId?: string | null;
  source?: string | null;
  value: number | null;
  unit: string;
  quality: "GOOD" | "UNCERTAIN" | "BAD";
  measurementType: "MEASURED" | "DERIVED" | "UNAVAILABLE" | "INVALID";
  calibrationId?: string | null;
  calibrationVersion?: number | null;
}

export interface TelemetrySnapshot {
  recordType?: "TELEMETRY";
  recordId?: string | null;
  complexId: string;
  deviceId?: string | null;
  ghId?: string | null;
  sequence: number;
  deviceTimestamp: string;
  timestamp: string;
  receivedAt?: string | null;
  samples: TelemetrySample[];
  source?: "ESP32" | "HISTORY" | "UNAVAILABLE";
  stale?: boolean;
  error?: string | null;
  earliestSequence?: number | null;
  latestSequence?: number | null;
  nextSequence?: number | null;
  hasMore: boolean;
  historyTruncated?: boolean;
  historyGap?: boolean;
}

export interface TelemetryHistoryResponse {
  complexId: string;
  deviceId?: string | null;
  ghId?: string | null;
  samples: TelemetrySample[];
  source?: "ESP32" | "HISTORY" | "UNAVAILABLE";
  stale?: boolean;
  error?: string | null;
  earliestSequence?: number | null;
  latestSequence?: number | null;
  nextSequence?: number | null;
  hasMore: boolean;
  historyTruncated?: boolean;
  historyGap?: boolean;
}

export interface Event {
  eventId: string;
  id?: string;
  recordId?: string | null;
  sequence: number;
  deviceTimestamp: string;
  receivedAt?: string | null;
  eventType: string;
  message?: string;
  at?: string;
  level?: "INFO" | "WARNING" | "FAULT" | "CRITICAL" | "ERROR";
  severity: "INFO" | "WARNING" | "FAULT" | "CRITICAL" | "ERROR";
  category?: string | null;
  deviceId?: string | null;
  complexId?: string | null;
  ghId?: string | null;
  componentId?: string | null;
  commandId?: string | null;
  resourceId?: string | null;
  configurationVersion?: number | null;
  payload?: Record<string, unknown>;
}

export interface EventResponse {
  events: Event[];
  items?: Event[];
  nextSequence?: number | null;
  hasMore: boolean;
  earliestSequence?: number | null;
  latestSequence?: number | null;
  nextCursor?: string | null;
  source?: "ESP32" | "HISTORY" | "UNAVAILABLE";
  stale?: boolean;
  error?: string | null;
}

export interface Esp32EventLog {
  id: string;
  at: string;
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  code: string;
  message: string;
  componentId?: string;
  greenhouseId?: string;
  eventId?: string;
  sequence?: number;
  deviceId?: string;
  complexId?: string;
  commandId?: string;
  resourceId?: string;
  configurationVersion?: number;
  category?: string;
  receivedAt?: string;
  payload?: Record<string, unknown>;
}

export interface CommandReceipt {
  commandId: string;
  status: "CREATED" | "ACCEPTED" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "REJECTED" | "CANCELLED";
  acceptedAt?: string;
  message?: string;
  resultCode?: string;
  componentId?: string | null;
  targetComplexId?: string | null;
  targetGhId?: string | null;
  resourceId?: string | null;
  configurationVersion?: number | null;
  submittedAtMs?: number;
  startedAtMs?: number;
  completedAtMs?: number;
}


export type SensorApiType = "TEMPERATURE" | "HUMIDITY" | "LIGHT" | "LEVEL" | "FLOW" | "PRESSURE" | "PH" | "EC" | "DOSING_OUTPUT";
export type SensorQuality = "VALID" | "INVALID" | "STALE" | "TIMEOUT" | "DISCONNECTED" | "OUT_OF_RANGE" | "UNAVAILABLE";
export type CalibrationApiState = "NOT_CALIBRATED" | "CALIBRATED" | "VERIFIED" | "EXPIRED" | "SUSPECT" | "RECALIBRATED" | "REMOVED";

export interface SensorDefinition {
  sensorId: string;
  complexId: string;
  sensorType: SensorApiType;
  source: string;
  channel?: number | null;
  unit: string;
  samplingIntervalMs: number;
  calibrationReference?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  installed?: boolean;
  lastSampleTimestampMs?: number | null;
}

export interface SensorSample {
  sensorId: string;
  timestampMs: number;
  value: number | null;
  unit: string;
  quality: SensorQuality;
  measurementType: "MEASURED" | "INVALID" | "UNAVAILABLE";
  calibrationId?: string | null;
}

export interface CalibrationApiRecord {
  calibrationId: string;
  complexId: string;
  componentId: string;
  calibrationType: "DOSING_RATE" | "FLOW" | "LEVEL" | "PH" | "EC" | string;
  version: number;
  state: CalibrationApiState;
  createdAtMs: number;
  validFromMs: number;
  validUntilMs?: number | null;
  operator: string;
  parameters: Record<string, unknown>;
}

export interface FertigationChannelRequest {
  componentId: string;
  requestedMl: number;
}

export interface FertigationRun {
  runId: string;
  complexId: string;
  ghId: string;
  triggerType: string;
  scheduleId?: string | null;
  recipeId: string;
  recipeVersion: number;
  configurationVersion?: number;
  configurationHash?: string | null;
  targetWaterMl: number;
  targetWaterL?: number | null;
  targetDosing: Array<Record<string, unknown>>;
  targetDosingAMl?: number | null;
  targetDosingBMl?: number | null;
  actualWaterMl: number;
  actualWaterL?: number | null;
  actualMixedVolumeMl?: number | null;
  actualDeliveredMl?: number | null;
  actualDosingRuntimesSec: Record<string, number>;
  calibrationReferences: Record<string, Record<string, unknown>>;
  mixingDurationSec: number;
  deliveryMode: "VOLUME" | "FLOW" | "PRESSURE_FLOW" | "DURATION";
  deliveryTargetMl: number;
  deliveryDurationSec: number;
  targetFlowLpm?: number | null;
  targetPressureKpa?: number | null;
  deliveryToleranceMl?: number | null;
  mixedVolumeMeasurementSource?: string | null;
  mixedVolumeMeasurementQuality?: string | null;
  deliveredVolumeMeasurementSource?: string | null;
  deliveredVolumeMeasurementQuality?: string | null;
  executionPlan?: Record<string, unknown> | null;
  recipeSnapshot?: Recipe | null;
  operator?: string | null;
  source: string;
  status: string;
  fault?: string | null;
  phaseTimestamps: Record<string, number>;
  startTimestampMs?: number | null;
  endTimestampMs?: number | null;
}

export interface FertigationPrepareResponse {
  valid: boolean;
  status: "READY" | "BLOCKED";
  issues: Array<{ code: string; message: string }>;
  run?: FertigationRun;
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
  device: {
    deviceId?: string;
    complexId?: string;
    bootId?: string;
    firmwareVersion?: string;
    hardwareModel?: string;
    [key: string]: unknown;
  };
  network: Record<string, unknown>;
  clock: Record<string, unknown>;
  configuration: { version?: number; [key: string]: unknown };
  inventory: Record<string, unknown>;
  runtime: Record<string, unknown>;
  actuators: Record<string, unknown> & { components?: Array<Record<string, unknown>> };
  sensors: { temperatureC?: number | null; [key: string]: unknown };
  storage: Record<string, unknown>;
  safety: { emergencyStopped?: boolean; [key: string]: unknown };
  cropCycle?: Record<string, unknown> | null;
  queue: Record<string, unknown>;
  sync: Record<string, unknown>;
}

export interface GreenhouseCapabilityState {
  ghId: string;
  configured: boolean;
  hydraulicallyReachable: boolean;
  automaticallyRoutable: boolean;
  manuallyRoutable: boolean;
  currentSharedManualTarget?: string | null;
  sharedPath?: boolean;
  capabilities: Record<string, boolean>;
}

export interface CapabilitiesResponse {
  deviceId?: string;
  capabilitiesVersion: number;
  topologyVersion?: number;
  capabilities: Record<string, boolean>;
  byGh?: Record<string, GreenhouseCapabilityState>;
  valid?: boolean;
  issues?: Array<{ code?: string; message?: string; [key: string]: unknown }>;
}

export interface TopologyCapabilitiesResponse {
  topologyVersion: number;
  capabilitiesVersion: number;
  valid: boolean;
  issues: Array<{ code?: string; message?: string; [key: string]: unknown }>;
  byGh: Record<string, GreenhouseCapabilityState>;
}

export interface CompiledScheduleDeploymentRequest {
  deploymentId: string;
  configurationVersion: number;
  configurationHash?: string | null;
  compiled: CompiledSchedule[];
}

export interface CompiledSchedulesResponse extends CompiledScheduleDeploymentRequest {
  status?: string;
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
  items: Schedule[];
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
