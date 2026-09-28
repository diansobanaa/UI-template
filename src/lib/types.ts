/**
 * AgroTech — domain types (frontend mirror of the platform data model).
 *
 * These types intentionally follow the platform DATA_MODEL so the mock
 * service layer can later be replaced by the Python REST backend without
 * touching the UI components.
 */

export type Id = string;

/* ------------------------------------------------------------------ */
/* System domain                                                       */
/* ------------------------------------------------------------------ */

export type SystemStatus = "NORMAL" | "WARNING" | "CRITICAL";

/**
 * F-H8: Network lifecycle states per PRD §30.10 L1770-1778.
 * UI harus membedakan 5 state untuk menggambarkan siklus hidup koneksi ESP32:
 * - FACTORY_UNCONFIGURED: perangkat baru, belum dikonfigurasi (factory defaults)
 * - NORMAL_STA: terhubung ke WiFi station sebagai client (mode produksi normal)
 * - DIRECT_LOCAL_AP: perangkat memancarkan AP sendiri untuk onboarding (belum ada client)
 * - DIRECT_LOCAL_CONNECTED: client terhubung ke AP lokal perangkat (mode onboarding aktif)
 * - CONNECTING_STA: sedang mencoba connect ke WiFi station (transisi)
 */
export type Esp32NetworkLifecycleState =
  | "FACTORY_UNCONFIGURED"
  | "NORMAL_STA"
  | "DIRECT_LOCAL_AP"
  | "DIRECT_LOCAL_CONNECTED"
  | "CONNECTING_STA";

export interface Esp32State {
  online: boolean;
  lastSync: string; // "2 Sep 2026 13:14:32"
  configVersion: number;
  esp32ConfigVersion: number;
  synchronized: boolean;
  deviceId?: string;
  apiVersion?: string;
  schemaVersion?: number;
  inventoryVersion?: number;
  endpoint?: string;
  firmwareVersion?: string;
  hardwareModel?: string;
  // F-H8: Network lifecycle state — optional agar UI backward-compatible dengan snapshot lama.
  networkLifecycleState?: Esp32NetworkLifecycleState;
  // F-H8: true jika perangkat sudah bound ke sebuah Complex di SystemTopologyPool.
  complexBound?: boolean;
}

export interface Complex {
  id: Id;
  code: string; // "Complex 01"
  name: string; // "Greenhouse Complex"
  location: string; // "Lembang, Indonesia"
  status: "Active" | "Inactive";
  /** Latched emergency stop — every actuator stays off until explicitly resumed. */
  emergencyStopped: boolean;
  esp32: Esp32State;
  systemStatus: SystemStatus;
  greenhouseIds: Id[];
  wellPumpSchedules?: WellPumpSchedule[];
  /** Complex-level equipment (ghId=null components: Well Pump, Dist Pump, etc.). */
  equipment?: EquipmentItem[];
  water: {
    wellPumpOn: boolean;
    rawTankPct: number; // % — display only; radar state is binary (see schedule page)
    flowTodayL: number;
    flowDeltaPct: number;
  };
  operationalStatus?: "LIVE" | "STALE" | "OFFLINE" | "UNKNOWN" | "CONFLICT";
  authoritySource?: "ESP32_DIRECT" | "BACKEND_MIRROR" | "NONE";
}

export type GhHealth = "NORMAL" | "WARNING";
export type FertigationState = "MIXING" | "DISTRIBUTING" | "WAITING" | "IDLE";

export interface Telemetry {
  temperatureC: number | null;
  waterTemperatureC?: number | null;
  humidityPct: number | null;
  lightLux: number | null;
  tempDeltaC: number | null;
  humidityDeltaPct: number | null;
  tankPct: number;
  tankL: number;
  tankCapacityL: number;
  waterTodayL: number | null;
  waterYesterdayL: number | null;
  waterDeltaPct: number | null;
  hstDays: number;
  hspDays: number | null;
}

export interface PlantStats {
  total: number;
  tracked: number;
  alive: number;
  dead: number;
  avgHeightCm: number;
  avgFruitWeightG: number;
  totalFruits: number;
  latestObservation: string;
}

export interface EquipmentItem {
  name: string;
  status: "OK" | "WARNING" | "FAULT" | "OFFLINE";
  type?: string;
  category?: string;
}

export interface GreenhouseCamera {
  componentId: string;
  name: string;
  status: "AVAILABLE" | "OFFLINE" | "FAULT" | "DISABLED" | "UNKNOWN";
  snapshotUrl?: string;
  streamUrl?: string;
  capturedAt?: string;
}

export interface Greenhouse {
  id: Id;
  code: string; // "GH tag"
  crop: string; // "Tomato"
  complexId: Id;
  online: boolean;
  health: GhHealth;
  greenhouseTag: string;
  areaM2?: number;
  fertigationState: FertigationState;
  telemetry: Telemetry;
  plants: PlantStats;
  equipment: EquipmentItem[];
  cameras?: GreenhouseCamera[];
  cropCycle?: CropCycle;
  recipes: Recipe[];
  fertigationSchedules: FertigationSchedule[];
  fanSchedules: FanSchedule[];
  currentRun: CurrentFertigation | null;
  queue: QueueEntry[];
  history: FertigationRunRow[];
  fruitDevSeries: { label: string; count: number; weight: number }[];
  /** Persisted by the Python operational backend; stored by the operational backend. */
  research?: { currentCycle?: ResearchCycle | null; cycles?: ResearchCycle[]; plants?: ResearchPlant[]; fruits?: ResearchFruit[]; recentObservations?: ResearchObservation[] };
  cropTimelineConfig?: {
    targetHarvestHst: number;
    points: Array<{ id: string; name: string; startHst: string | number; endHst: string | number; note?: string }>;
    maintenance: Array<{ id: string; name: string; hst: string | number; category: string; note?: string }>;
  };
}

/* ------------------------------------------------------------------ */
/* Crop Cycle / Masa Tanam domain                                      */
/* ------------------------------------------------------------------ */

export type CycleStatus = "NO_CYCLE" | "ACTIVE" | "HARVESTED" | "CANCELLED";

export interface CycleHarvestSummary {
  harvestDate: string; // "YYYY-MM-DD"
  tanggalTanam: string; // "YYYY-MM-DD"
  tanggalPolinasi: string | null; // "YYYY-MM-DD"
  hstAtHarvest: number;
  hspAtHarvest: number | null;
  recordedAt: string;
  yieldKg?: number;
  grade?: string;
  notes?: string;
}


export interface ResearchCycle {
  cycleId: Id; complexId: Id; ghId: Id; status: string; plantingDate?: string | null; pollinationDate?: string | null; expectedHarvestDate?: string | null; actualHarvestDate?: string | null; variety?: string | null; plantCount: number; mortalityCount: number; yieldKg?: number | null; grade?: string | null; notes?: string | null; hst?: number | null; hsp?: number | null; version: number; source?: string; sourceDeviceId?: string | null; createdAt?: string; updatedAt?: string;
}
export interface ResearchPlant { plantId: Id; cycleId: Id; complexId: Id; ghId: Id; plantTag: string; position?: string | null; plantedAt?: string | null; status: string; mortalityDate?: string | null; mortalityReason?: string | null; notes?: string | null; }
export interface ResearchFruit { fruitId: Id; plantId: Id; cycleId: Id; complexId: Id; ghId: Id; fruitTag?: string | null; pollinationDate?: string | null; developmentStatus: string; harvestedAt?: string | null; weightG?: number | null; grade?: string | null; notes?: string | null; }
export interface ResearchObservation { observationId: Id; cycleId: Id; complexId: Id; ghId: Id; plantId?: string | null; fruitId?: string | null; observedAt: string; metric: string; value?: number | null; textValue?: string | null; unit?: string | null; notes?: string | null; observer?: string | null; source?: string | null; photoRef?: string | null; heightCm?: number | null; leafCount?: number | null; fruitCount?: number | null; }

export interface CropCycle {
  status: CycleStatus;
  tanggalTanam: string | null; // "YYYY-MM-DD"
  tanggalPolinasi: string | null; // "YYYY-MM-DD"
  variety?: string;
  plantCount?: number;
  pollinationMethod?: "natural" | "bee" | "manual";
  targetHarvestHst?: number;
  targetHarvestHsp?: number;
  notes?: string;
  cropTimelineConfig?: {
    targetHarvestHst: number;
    points: Array<{ id: string; name: string; startHst: string | number; endHst: string | number; note?: string }>;
    maintenance: Array<{ id: string; name: string; hst: string | number; category: string; note?: string }>;
  };
  lastHarvestSummary?: CycleHarvestSummary | null;
}

/* ------------------------------------------------------------------ */
/* Fertigation domain                                                  */
/* ------------------------------------------------------------------ */

export interface Recipe {
  id: Id;
  recipeId?: string;
  name: string; // "Tomato Growth A"
  waterL: number;
  targetWaterL?: number;
  /**
   * PRD §8.6 / DYNAMIC_HARDWARE_REGISTRY_ARCHITECTURE.md §3.5: dosing is registry-driven.
   * `dosingChannels` is the authoritative field; `dosingAml`/`dosingBml` are kept as
   * DEPRECATED backwards-compat mirrors and are populated from dosingChannels[0]/[1]
   * only for legacy consumers. New code MUST read dosingChannels[] and never assume A/B.
   */
  /** @deprecated Use dosingChannels[] — registry-driven, supports A..G + I2C PCA9685. */
  dosingAml?: number;
  /** @deprecated Use dosingChannels[] — registry-driven, supports A..G + I2C PCA9685. */
  dosingBml?: number;
  dosingChannels: Array<{ componentId: string; requestedMl: number }>;
  targetEc: string; // "-" when not set
  targetPpm?: number;
  description?: string;
  version?: number;
}

export type TriggerType = "specific-time" | "days-of-week" | "interval" | "specific-date";
export type RepeatMode =
  | "Every Day"
  | "Every Weekday"
  | "Every Weekend"
  | "Mon, Wed, Fri"
  | "Tue, Thu"
  | "Once";

export type ScheduleStatus = "completed" | "running" | "scheduled" | "missed" | "failed" | "disabled" | "blocked" | "draft" | "invalid";
export type ScheduleActivationState = "DRAFT" | "VALIDATING" | "ACTIVE" | "BLOCKED" | "DISABLED" | "INVALID";

export interface ScheduleBlockedReason {
  code: string;
  message: string;
}

export interface FertigationSchedule {
  id: Id;
  ghId: Id;
  name: string;
  recipeId: Id;
  enabled: boolean;
  trigger: TriggerType;
  time: string; // "06:00"
  endTime?: string; // "12:00" for interval window
  repeat: RepeatMode;
  intervalHours?: number;
  date?: string;
  targetMode: "volume" | "ppm";
  targetWaterL: number;
  rawWaterStartThresholdPercent?: number; // Configurable raw water threshold percentage before serial dosing starts (default 20%)
  /**
   * PRD §8.6: dosing is registry-driven. dosingChannels[] is authoritative.
   * Legacy dosingAml/dosingBml are kept as deprecated optional mirrors for older consumers.
   */
  /** @deprecated Use dosingChannels[] — registry-driven. */
  dosingAml?: number;
  /** @deprecated Use dosingChannels[] — registry-driven. */
  dosingBml?: number;
  dosingChannels: Array<{ componentId: string; requestedMl: number; calibrationId?: string; calibrationVersion?: number }>;
  targetPpm?: number;
  fallbackEnabled: boolean;
  fallbackScheduleId?: Id;
  isFallback?: boolean;
  missedPolicy: "execute" | "skip";
  recoveryWindowH: number;
  onlyToday: boolean;
  status: ScheduleStatus;
  activationState?: ScheduleActivationState;
  blockedReasons?: ScheduleBlockedReason[];
  lastRun: string | null; // "2 Sep 06:00"
  nextRun: string | null;
}

export interface WellPumpSchedule {
  id: Id;
  complexId: Id;
  task: string;
  pump?: string;
  componentId?: string;
  trigger?: "time" | "days" | "interval";
  time: string;
  endTime?: string; // "12:00" for interval window
  days?: string[]; // Selected days for days trigger
  durationMin: number;
  durationSec?: number;
  intervalMin?: number;
  targetLiters?: number; // Volume target threshold
  repeat: RepeatMode;
  enabled: boolean;
  status: ScheduleStatus;
  activationState?: ScheduleActivationState;
  blockedReasons?: ScheduleBlockedReason[];
  lastRun: string | null;
  nextRun: string | null;
  radar: "filling" | "full"; // binary radar behaviour — no percentage
}

export interface WaterTransferSchedule {
  id: Id;
  complexId: Id;
  name: string;
  sourcePumpId: string;
  destValveId: string;
  durationMin: number;
  trigger: TriggerType;
  time: string;
  repeat: RepeatMode;
  enabled: boolean;
  status: ScheduleStatus;
  activationState?: ScheduleActivationState;
  blockedReasons?: ScheduleBlockedReason[];
  lastRun: string | null;
  nextRun: string | null;
}

export interface FanSchedule {
  id: Id;
  ghId: Id;
  mode: "time" | "temperature";
  time: string;
  durationMin: number;
  onAboveC?: number;
  offBelowC?: number;
  repeat: RepeatMode;
  enabled: boolean;
  status: ScheduleStatus;
  activationState?: ScheduleActivationState;
  blockedReasons?: ScheduleBlockedReason[];
  lastRun: string | null;
  nextRun: string | null;
}

export interface CurrentFertigation {
  ghId: Id;
  recipeName: string;
  targetWaterL: number;
  /**
   * PRD §8.6: dosing is registry-driven. dosingChannels[] is authoritative.
   * Legacy dosingAml/dosingBml/dosingADoneMl/dosingBDoneMl are kept as deprecated
   * optional mirrors for older consumers and may be undefined when the active
   * run uses channel labels other than A/B.
   */
  /** @deprecated Use dosingChannels[]. */
  dosingAml?: number;
  /** @deprecated Use dosingChannels[]. */
  dosingBml?: number;
  dosingChannels?: Array<{ componentId: string; requestedMl: number; doneMl?: number; calibrationId?: string; calibrationVersion?: number }>;
  startedAt: string; // "13:05:21"
  elapsedLabel: string; // "9 min 11 sec"
  estimatedFinish: string; // "13:28:00"
  progressPct: number;
  waterDoneL: number;
  /** @deprecated Use dosingChannels[].doneMl. */
  dosingADoneMl?: number;
  /** @deprecated Use dosingChannels[].doneMl. */
  dosingBDoneMl?: number;
  steps: { name: string; status: "done" | "active" | "pending" }[];
  tank: {
    currentL: number;
    capacityL: number;
    waterL: number;
    /** @deprecated Use dosingChannels[]. */
    nutrientAml?: number;
    /** @deprecated Use dosingChannels[]. */
    nutrientBml?: number;
    temperatureC: number;
  };
}

export interface QueueEntry {
  ghId: Id;
  recipeName: string;
  targetWaterL: number;
  scheduledTime: string;
}

export interface FertigationRunRow {
  id: Id;
  ghId: Id;
  date: string; // "2 Sep"
  time: string; // "10:00"
  recipeName: string;
  waterL: number;
  /** @deprecated Use dosingChannels[]. */
  dosingAml?: number;
  /** @deprecated Use dosingChannels[]. */
  dosingBml?: number;
  dosingChannels?: Array<{ componentId: string; requestedMl: number; doneMl?: number }>;
  durationMin?: number;
  result: "completed" | "partial" | "failed";
}

/* ------------------------------------------------------------------ */
/* Research / observation (light, UI-level)                            */
/* ------------------------------------------------------------------ */

export interface ObservationDraft {
  ghId: Id;
  plantId: string;
  heightCm: number;
  leafCount: number;
  fruitCount: number;
  notes: string;
  observer?: string;
}

export interface Observation {
  observationId: Id;
  ghId: Id;
  plantId: string;
  heightCm: number;
  leafCount: number;
  fruitCount: number;
  notes: string;
  observedAt: string;
}

export interface FertigationSystemStatus {
  mixingTankLevel: number | null;
  waterInlet: "ON" | "OFF" | "UNAVAILABLE";
  distributionLine: "RUNNING" | "IDLE" | "UNAVAILABLE";
  systemMode: "EMERGENCY_STOP" | "ONLINE" | "OFFLINE";
  lastUpdate: string | null;
}

/* ------------------------------------------------------------------ */
/* Calibration domain                                                  */
/* ------------------------------------------------------------------ */

export type CalibrationCategory =
  | "ph"
  | "ec"
  | "dosing-pump"
  | "flow-meter"
  | "water-level"
  | "temp-humidity"
  | "fan";

export interface DeviceCategory {
  id: CalibrationCategory;
  name: string;
  devices: number;
  calibrated: number;
  due: number;
}

export interface CalibrationDevice {
  id: Id;
  category: CalibrationCategory;
  name: string; // "pH Sensor 01 (GH tag)"
  /** Dosing-pump channel reported by the ESP32 ("A", "B", "C", …). Pumps are dynamic — new channels arrive via the device JSON. */
  channel?: string;
  ghId: Id | null;
  location: string; // "GH tag – Mixing Tank"
  reading: string; // "6.87"
  unit: string; // "pH"
  online: boolean;
  lastCalibration: string; // "15 Aug 2026 10:30"
  calibratedAtMs?: number | null;
  due: string; // "15 Nov 2026 (in 72 days)"
  method: "single" | "two" | "three";
  standardOptions: string[];
  standardUnit: string;
  measuredUnit: string;
}

export interface CalibrationRecord {
  id: Id;
  dateTime: string; // "15 Aug 2026 10:30"
  device: string;
  type: string; // "pH (1 point)"
  before: string;
  after: string;
  result: "Success" | "Failed";
  user: string;
}

export interface CalibrationReferenceRow {
  deviceType: string;
  method: string;
  standard: string;
  frequency: string;
}

/* ------------------------------------------------------------------ */
/* Events / alerts                                                     */
/* ------------------------------------------------------------------ */

export interface EventItem {
  id: Id;
  time: string; // "13:05"
  text: string;
  level: "success" | "warning" | "error" | "info";
  eventType?: string;
  complexId?: string | null;
  ghId?: string | null;
  deviceId?: string | null;
  componentId?: string | null;
  commandId?: string | null;
  resourceId?: string | null;
  configurationVersion?: number | null;
  receivedAt?: string | null;
  source?: "ESP32" | "HISTORY" | "UNAVAILABLE";
  stale?: boolean;
}

export interface AlertItem {
  id: Id;
  title: string;
  detail: string;
  level: "warning" | "error";
  time: string;
}

/* ------------------------------------------------------------------ */
/* Environment charts                                                  */
/* ------------------------------------------------------------------ */

export interface SeriesPoint {
  label: string; // x-axis label
  value: number | null;
  slot?: number;
}

export interface EnvironmentMetric {
  id: "temperature" | "waterTemperature" | "humidity" | "light" | "tank" | "fertigation";
  label: string;
  unit: string;
  color: string;
  current: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  points: SeriesPoint[];
}

/* ------------------------------------------------------------------ */
/* Dosing Queue & Batch Execution (Section 10.3 & Section 20)          */
/* ------------------------------------------------------------------ */

export interface QueuedBatchItem {
  batchId: string;
  ghId: string;
  scheduleId?: string;
  runtimeState: 'QUEUED' | 'MIXING_RAW_WATER' | 'DOSING' | 'READY';
  scheduledTime?: string;
  rawWaterTargetMl?: number;
  dosing?: Record<string, number>;
}

export interface DosingBatchRuntimeSnapshot {
  batchId: string;
  ghId?: string;
  runtimeState: 'IDLE' | 'QUEUED' | 'MIXING_RAW_WATER' | 'DOSING' | 'READY' | 'DISTRIBUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EMERGENCY_STOP';
  activeChannel: string;
  rawWaterActualMl: number;
  rawWaterTargetMl: number;
  thresholdPercent?: number;
  dosing?: Record<string, number>;
  queuedBatches?: QueuedBatchItem[];
  // Backwards compatibility with raw ESP32 fertigation status
  state?: string;
  phase?: string;
  runId?: string;
  actualWaterMl?: number;
  targetWaterMl?: number;
  actualFlowLpm?: number;
  actualDeliveredMl?: number;
  mixing?: { status: string };
  delivery?: { status: string };
}

/* ------------------------------------------------------------------ */
/* LAYER-A: Fertigation State Machine (1:1 with firmware)             */
/* Matches esp32/main/services/fertigation_mgr.h:10-23                */
/* ------------------------------------------------------------------ */

export type FertigationRuntimeState =
  | "IDLE"
  | "RECOVERY_HOLD"
  | "PRECHECK"
  | "FILLING"
  | "DOSING"
  | "FINAL_MIXING"
  | "MIX_READY"
  | "DELIVERY"
  | "COMPLETE"
  | "INTERRUPTED"
  | "FAULTED"
  | "ABORTED";

export type FertigationPhaseName =
  | "PRECHECK"
  | "FILLING"
  | "DOSING"
  | "FINAL_MIXING"
  | "MIX_READY"
  | "DELIVERY"
  | "COMPLETE";

export type OccurrenceState =
  | "PENDING"
  | "PREPARING"
  | "WAITING_BATCH"
  | "READY_TO_SEND"
  | "DISTRIBUTING"
  | "COMPLETED"
  | "FAILED";

export type DosingQueueEntryState =
  | "PENDING"
  | "DISPATCHED"
  | "ACTIVE"
  | "COMPLETED"
  | "FAILED";

export type DeliverySlotState =
  | "FREE"
  | "READY_TO_SEND"
  | "DISTRIBUTING"
  | "COMPLETE"
  | "FAULTED";

export interface OccurrenceEntry {
  occurrenceId: string;
  scheduleId: string;
  complexId?: string;
  ghId: string;
  scheduledTimestamp: number;
  state: OccurrenceState;
  queueId?: string;
  batchId?: string;
  waitingReason?: string;
}

export interface DosingQueueEntry {
  queueId: string;
  occurrenceId: string;
  scheduleId: string;
  ghId: string;
  batchId: string;
  state: DosingQueueEntryState;
  dispatchedAtMs?: number;
  waitingReason?: string;
}

export interface MixingBatch {
  runId: string;
  batchId: string;
  complexId: string;
  ghId: string;
  scheduleId?: string;
  recipeId?: string;
  recipeVersion?: number;
  configurationVersion: number;
  state: FertigationRuntimeState;
  phaseTimestamps?: Partial<Record<FertigationPhaseName, number>>;
  startTimestampMs: number;
  endTimestampMs?: number;
  targetWaterMl: number;
  actualWaterMl: number;
  thresholdPercent?: number;
  dosingChannels: Array<{
    componentId: string;
    requestedMl: number;
    rateMlPerSec?: number;
    runtimeMs?: number;
    observedRuntimeMs?: number;
    actualDosedMl?: number;
    calibrationId?: string;
    calibrationVersion?: number;
  }>;
  mixingDurationSec?: number;
  fault?: string;
  triggerType?: string;
  source?: string;
}

export interface FertigationRun {
  runId: string;
  batchId?: string;
  complexId: string;
  ghId: string;
  scheduleId?: string;
  occurrenceId?: string;
  recipeId?: string;
  deliveryState?: DeliverySlotState;
  terminalState?: "COMPLETE" | "FAULTED" | "ABORTED" | "INTERRUPTED";
  startTimestampMs: number;
  endTimestampMs?: number;
  durationSec?: number;
  targetWaterMl?: number;
  actualWaterMl?: number;
  deliveryTargetMl?: number;
  actualDeliveredMl?: number;
  actualFlowLpm?: number;
  targetFlowLpm?: number;
  deliveryMode?: string;
  deliveryPumpId?: string;
  dosingChannels?: Array<{
    componentId: string;
    requestedMl: number;
    actualDosedMl?: number;
    observedRuntimeMs?: number;
    rateMlPerSec?: number;
    calibrationId?: string;
    calibrationVersion?: number;
  }>;
  fault?: string;
  failureType?: FertigationFailureType;
  phaseTimestamps?: Partial<Record<FertigationPhaseName, number>>;
  triggerType?: string;
  source?: string;
  deliveredVolumeVerified?: boolean;
}

export interface DeliverySlotEntry {
  ghId: string;
  occurrenceId: string;
  batchId: string;
  state: DeliverySlotState;
  deliveryPumpId?: string;
  fault?: string;
}

export type FertigationFailureType =
  | "CONFIG_ERROR"
  | "RESOURCE_UNAVAILABLE"
  | "PRECHECK_FAILED"
  | "MIXING_FAILED"
  | "DOSING_FAILED"
  | "DISTRIBUTION_FAILED"
  | "FLOW_ERROR"
  | "SAFETY_STOP"
  | "NETWORK_INTERRUPTION"
  | "ESP32_OFFLINE";

