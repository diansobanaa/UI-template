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

export interface Esp32State {
  online: boolean;
  lastSync: string; // "2 Sep 2026 13:14:32"
  configVersion: number;
  esp32ConfigVersion: number;
  synchronized: boolean;
}

export interface Complex {
  id: Id;
  code: string; // "Complex 01"
  name: string; // "Greenhouse Complex"
  location: string; // "Lembang, Indonesia"
  status: "Active" | "Inactive";
  esp32: Esp32State;
  systemStatus: SystemStatus;
  greenhouseIds: Id[];
  water: {
    wellPumpOn: boolean;
    rawTankPct: number; // % — display only; radar state is binary (see schedule page)
    flowTodayL: number;
    flowDeltaPct: number;
  };
}

export type GhHealth = "NORMAL" | "WARNING";
export type FertigationState = "MIXING" | "DISTRIBUTING" | "WAITING" | "IDLE";

export interface Telemetry {
  temperatureC: number | null;
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
}

export interface Greenhouse {
  id: Id; // "gh-01"
  code: string; // "GH 01"
  crop: string; // "Tomato"
  complexId: Id;
  online: boolean;
  health: GhHealth;
  greenhouseTag: string; // "GH-01"
  fertigationState: FertigationState;
  telemetry: Telemetry;
  plants: PlantStats;
  equipment: EquipmentItem[];
  recipes: Recipe[];
  fertigationSchedules: FertigationSchedule[];
  fanSchedules: FanSchedule[];
  currentRun: CurrentFertigation | null;
  queue: QueueEntry[];
  history: FertigationRunRow[];
  fruitDevSeries: { label: string; count: number; weight: number }[];
}

/* ------------------------------------------------------------------ */
/* Fertigation domain                                                  */
/* ------------------------------------------------------------------ */

export interface Recipe {
  id: Id;
  name: string; // "Tomato Growth A"
  waterL: number;
  dosingAml: number;
  dosingBml: number;
  targetEc: string; // "-" when not set
}

export type TriggerType = "specific-time" | "days-of-week" | "interval" | "specific-date";
export type RepeatMode =
  | "Every Day"
  | "Every Weekday"
  | "Every Weekend"
  | "Mon, Wed, Fri"
  | "Tue, Thu"
  | "Once";

export type ScheduleStatus = "completed" | "running" | "scheduled" | "missed" | "failed" | "disabled";

export interface FertigationSchedule {
  id: Id;
  ghId: Id;
  name: string;
  recipeId: Id;
  enabled: boolean;
  trigger: TriggerType;
  time: string; // "06:00"
  repeat: RepeatMode;
  intervalHours?: number;
  date?: string;
  targetMode: "volume" | "ppm";
  targetWaterL: number;
  dosingAml: number;
  dosingBml: number;
  targetPpm?: number;
  fallbackEnabled: boolean;
  fallbackScheduleId?: Id;
  missedPolicy: "execute" | "skip";
  recoveryWindowH: number;
  onlyToday: boolean;
  status: ScheduleStatus;
  lastRun: string | null; // "2 Sep 06:00"
  nextRun: string | null;
}

export interface WellPumpSchedule {
  id: Id;
  complexId: Id;
  task: string;
  time: string;
  durationMin: number;
  repeat: RepeatMode;
  enabled: boolean;
  status: ScheduleStatus;
  lastRun: string | null;
  nextRun: string | null;
  radar: "filling" | "full"; // binary radar behaviour — no percentage
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
  lastRun: string | null;
  nextRun: string | null;
}

export interface CurrentFertigation {
  ghId: Id;
  recipeName: string;
  targetWaterL: number;
  dosingAml: number;
  dosingBml: number;
  startedAt: string; // "13:05:21"
  elapsedLabel: string; // "9 min 11 sec"
  estimatedFinish: string; // "13:28:00"
  progressPct: number;
  waterDoneL: number;
  dosingADoneMl: number;
  dosingBDoneMl: number;
  steps: { name: string; status: "done" | "active" | "pending" }[];
  tank: {
    currentL: number;
    capacityL: number;
    waterL: number;
    nutrientAml: number;
    nutrientBml: number;
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
  dosingAml: number;
  dosingBml: number;
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
}

export interface Observation {
  id: Id;
  ghId: Id;
  plantId: string;
  heightCm: number;
  leafCount: number;
  fruitCount: number;
  notes: string;
  at: string; // "2 Sep 2026 13:14"
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
  name: string; // "pH Sensor 01 (GH 01)"
  ghId: Id | null;
  location: string; // "GH 01 – Mixing Tank"
  reading: string; // "6.87"
  unit: string; // "pH"
  online: boolean;
  lastCalibration: string; // "15 Aug 2026 10:30"
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
  value: number;
}

export interface EnvironmentMetric {
  id: "temperature" | "humidity" | "light" | "tank" | "fertigation";
  label: string;
  unit: string;
  color: string;
  current: number;
  min: number;
  max: number;
  avg: number;
  points: SeriesPoint[];
}
