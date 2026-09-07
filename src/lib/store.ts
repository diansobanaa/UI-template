/**
 * Mock database for the UI prototype.
 *
 * This is the single mutable state of the frontend-only phase. When the
 * Python backend lands, every read/write here is replaced by REST calls
 * (see src/lib/api/backend-client.ts) — UI components never touch this file
 * directly, they only talk to the service layer.
 *
 * The database persists to localStorage so CRUD changes survive reloads, and
 * exposes a tiny subscription mechanism so pages re-render when any mutation
 * occurs (useDbVersion in useDb.ts).
 */
import { complexes } from "./data/complexes";
import {
  complexFertigationHistory,
  greenhouses as seedGreenhouses,
  mixingQueue as seedMixingQueue,
} from "./data/greenhouses";
import { wellPumpSchedules as seedWellPumps } from "./data/wellpump";
import {
  calibrationDevices as seedDevices,
  calibrationHistory as seedCalHistory,
} from "./data/calibration";
import { MOCK_NOW } from "./format";
import type {
  CalibrationDevice,
  CalibrationRecord,
  Complex,
  FertigationRunRow,
  FertigationSchedule,
  FanSchedule,
  Greenhouse,
  Observation,
  ObservationDraft,
  QueueEntry,
  WellPumpSchedule,
} from "./types";

interface MockDb {
  complexes: Complex[];
  greenhouses: Greenhouse[];
  wellPumpSchedules: WellPumpSchedule[];
  mixingQueue: QueueEntry[];
  complexFertigationHistory: FertigationRunRow[];
  calibrationDevices: CalibrationDevice[];
  calibrationHistory: CalibrationRecord[];
  observations: Observation[];
}

const STORAGE_KEY = "agrotech-db-v1";

function seedDb(): MockDb {
  return {
    complexes: structuredClone(complexes),
    greenhouses: structuredClone(seedGreenhouses),
    wellPumpSchedules: structuredClone(seedWellPumps),
    mixingQueue: structuredClone(seedMixingQueue),
    complexFertigationHistory: structuredClone(complexFertigationHistory),
    calibrationDevices: structuredClone(seedDevices),
    calibrationHistory: structuredClone(seedCalHistory),
    observations: [],
  };
}

/* ------------------------ persistence & reactivity ------------------------ */

let seq = 100;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** Advance the id counter past any id already present in the restored data. */
function syncSeqFrom(db: MockDb): void {
  const collect = (v: unknown) => {
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === "id" && typeof val === "string") {
          const m = val.match(/-(\d+)$/);
          if (m) seq = Math.max(seq, Number(m[1]));
        } else {
          collect(val);
        }
      }
    }
  };
  collect(db);
}

function hydrate(): MockDb {
  const seed = seedDb();
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as MockDb;
    // Basic shape check — if the persisted shape is stale, fall back to seed.
    if (!parsed.complexes || !parsed.greenhouses) return seed;
    parsed.observations ??= [];
    syncSeqFrom(parsed);
    return parsed;
  } catch {
    return seed;
  }
}

export const db: MockDb = hydrate();

export function restorePersistedDb(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as MockDb;
    if (!parsed.complexes || !parsed.greenhouses) return;
    parsed.observations ??= [];
    Object.assign(db, parsed);
    syncSeqFrom(db);
    notify(); // semua page via useDbVersion() langsung re-render
  } catch { /* storage korup — pakai seed */ }
}

export function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // storage full / unavailable — mock phase, ignore
  }
}

export function resetMockDb(): void {
  const seed = seedDb();
  Object.assign(db, seed);
  persist();
  notify();
}

let version = 0;
const listeners = new Set<() => void>();

export function notify(): void {
  version += 1;
  listeners.forEach((l) => l());
}

export function subscribeDb(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDbVersion(): number {
  return version;
}

/** Commit helper used by every mutation: persist + notify subscribers. */
function commit(): void {
  persist();
  notify();
}

/* --------------------------- mutations ---------------------------- */

export function createFertigationSchedule(input: Omit<FertigationSchedule, "id">): FertigationSchedule {
  const schedule: FertigationSchedule = { ...input, id: nextId("fs") };
  const gh = db.greenhouses.find((g) => g.id === input.ghId);
  if (gh) {
    gh.fertigationSchedules = [...gh.fertigationSchedules, schedule];
    if (schedule.status === "scheduled" && schedule.nextRun) {
      db.mixingQueue = [
        ...db.mixingQueue,
        {
          ghId: schedule.ghId,
          recipeName:
            db.greenhouses.find((g) => g.id === schedule.ghId)?.recipes.find((r) => r.id === schedule.recipeId)?.name ??
            "Recipe",
          targetWaterL: schedule.targetWaterL,
          scheduledTime: schedule.time,
        },
      ];
    }
  }
  commit();
  return schedule;
}

export function updateFertigationSchedule(id: string, patch: Partial<FertigationSchedule>): FertigationSchedule | undefined {
  for (const gh of db.greenhouses) {
    const idx = gh.fertigationSchedules.findIndex((s) => s.id === id);
    if (idx >= 0) {
      gh.fertigationSchedules[idx] = { ...gh.fertigationSchedules[idx], ...patch };
      commit();
      return gh.fertigationSchedules[idx];
    }
  }
  return undefined;
}

export function deleteFertigationSchedule(id: string): FertigationSchedule | undefined {
  for (const gh of db.greenhouses) {
    const found = gh.fertigationSchedules.find((s) => s.id === id);
    if (found) {
      gh.fertigationSchedules = gh.fertigationSchedules.filter((s) => s.id !== id);
      commit();
      return found;
    }
  }
  return undefined;
}

export function createWellPumpSchedule(input: Omit<WellPumpSchedule, "id">): WellPumpSchedule {
  const schedule: WellPumpSchedule = { ...input, id: nextId("wp") };
  db.wellPumpSchedules = [...db.wellPumpSchedules, schedule];
  commit();
  return schedule;
}

export function updateWellPumpSchedule(id: string, patch: Partial<WellPumpSchedule>): WellPumpSchedule | undefined {
  const idx = db.wellPumpSchedules.findIndex((s) => s.id === id);
  if (idx >= 0) {
    db.wellPumpSchedules[idx] = { ...db.wellPumpSchedules[idx], ...patch };
    commit();
    return db.wellPumpSchedules[idx];
  }
  return undefined;
}

export function deleteWellPumpSchedule(id: string): WellPumpSchedule | undefined {
  const found = db.wellPumpSchedules.find((s) => s.id === id);
  if (found) {
    db.wellPumpSchedules = db.wellPumpSchedules.filter((s) => s.id !== id);
    commit();
  }
  return found;
}

export function createFanSchedule(input: Omit<FanSchedule, "id">): FanSchedule {
  const schedule: FanSchedule = { ...input, id: nextId("fan") };
  const gh = db.greenhouses.find((g) => g.id === input.ghId);
  if (gh) gh.fanSchedules = [...gh.fanSchedules, schedule];
  commit();
  return schedule;
}

export function updateFanSchedule(id: string, patch: Partial<FanSchedule>): FanSchedule | undefined {
  for (const gh of db.greenhouses) {
    const idx = gh.fanSchedules.findIndex((s) => s.id === id);
    if (idx >= 0) {
      gh.fanSchedules[idx] = { ...gh.fanSchedules[idx], ...patch };
      commit();
      return gh.fanSchedules[idx];
    }
  }
  return undefined;
}

export function deleteFanSchedule(id: string): FanSchedule | undefined {
  for (const gh of db.greenhouses) {
    const found = gh.fanSchedules.find((s) => s.id === id);
    if (found) {
      gh.fanSchedules = gh.fanSchedules.filter((s) => s.id !== id);
      commit();
      return found;
    }
  }
  return undefined;
}

export function addObservation(ghId: string, draft: ObservationDraft): Observation {
  const gh = db.greenhouses.find((g) => g.id === ghId);
  if (!gh) throw new Error("greenhouse not found");
  const obs: Observation = {
    id: nextId("obs"),
    ghId,
    plantId: draft.plantId,
    heightCm: draft.heightCm,
    leafCount: draft.leafCount,
    fruitCount: draft.fruitCount,
    notes: draft.notes,
    at: `${MOCK_NOW.label} ${MOCK_NOW.time.slice(0, 5)}`,
  };
  db.observations = [obs, ...db.observations];
  gh.plants.latestObservation = obs.at;
  gh.plants.avgHeightCm = draft.heightCm;
  gh.plants.totalFruits += draft.fruitCount;
  commit();
  return obs;
}

export function deleteObservation(id: string): void {
  db.observations = db.observations.filter((o) => o.id !== id);
  commit();
}

export function observationsForGh(ghId: string): Observation[] {
  return db.observations.filter((o) => o.ghId === ghId);
}

export function addCalibrationRecord(record: Omit<CalibrationRecord, "id">): void {
  db.calibrationHistory = [{ ...record, id: nextId("ch") }, ...db.calibrationHistory];
  commit();
}

export function addGreenhouse(complexId: string, crop: string): Greenhouse {
  const complex = db.complexes.find((c) => c.id === complexId);
  if (!complex) throw new Error("complex not found");
  // Numbering is global across the system, based on the highest existing id.
  const maxNum = db.greenhouses.reduce((max, g) => {
    const m = g.id.match(/gh-(\d+)/);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  const num = maxNum + 1;
  const code = `GH ${String(num).padStart(2, "0")}`;
  const id = `gh-${String(num).padStart(2, "0")}`;
  const gh: Greenhouse = {
    id,
    code,
    crop,
    complexId,
    online: true,
    health: "NORMAL",
    greenhouseTag: code.replace(" ", "-"),
    fertigationState: "IDLE",
    telemetry: {
      temperatureC: 27.0, humidityPct: 70, lightLux: 38000, tempDeltaC: 0, humidityDeltaPct: 0,
      tankPct: 50, tankL: 50, tankCapacityL: 100, waterTodayL: 0, waterYesterdayL: 0, waterDeltaPct: 0,
      hstDays: 0, hspDays: null,
    },
    plants: { total: 0, tracked: 0, alive: 0, dead: 0, avgHeightCm: 0, avgFruitWeightG: 0, totalFruits: 0, latestObservation: "-" },
    equipment: [],
    recipes: [],
    fertigationSchedules: [],
    fanSchedules: [],
    currentRun: null,
    queue: [],
    history: [],
    fruitDevSeries: [],
  };
  db.greenhouses = [...db.greenhouses, gh];
  complex.greenhouseIds = [...complex.greenhouseIds, id];
  commit();
  return gh;
}

export function addComplex(location: string): Complex {
  const num = db.complexes.length + 1;
  const complex: Complex = {
    id: `complex-${String(num).padStart(2, "0")}`,
    code: `Complex ${String(num).padStart(2, "0")}`,
    name: "Greenhouse Complex",
    location,
    status: "Active",
    esp32: { online: false, lastSync: "-", configVersion: 1, esp32ConfigVersion: 0, synchronized: false },
    systemStatus: "CRITICAL",
    greenhouseIds: [],
    water: { wellPumpOn: false, rawTankPct: 0, flowTodayL: 0, flowDeltaPct: 0 },
  };
  db.complexes = [...db.complexes, complex];
  commit();
  return complex;
}

/* ----------------------- system / lifecycle ----------------------- */

export function setComplexEsp32Synced(complexId: string): void {
  const complex = db.complexes.find((c) => c.id === complexId);
  if (!complex) throw new Error("complex not found");
  complex.esp32 = {
    ...complex.esp32,
    online: true,
    lastSync: MOCK_NOW.dateTime,
    configVersion: complex.esp32.configVersion + 1,
    esp32ConfigVersion: complex.esp32.configVersion + 1,
    synchronized: true,
  };
  commit();
}

export function markComplexSyncAttempt(complexId: string): void {
  const complex = db.complexes.find((c) => c.id === complexId);
  if (complex && complex.esp32.synchronized) {
    complex.esp32 = { ...complex.esp32, synchronized: false };
    commit();
  }
}

export function startManualRun(ghId: string, recipeId: string, targetWaterL: number): void {
  const gh = db.greenhouses.find((g) => g.id === ghId);
  if (!gh) throw new Error("greenhouse not found");
  const recipe = gh.recipes.find((r) => r.id === recipeId);
  if (!recipe) throw new Error("recipe not found");
  const dosingAml = Math.round(targetWaterL * 1.5);
  const dosingBml = Math.round(targetWaterL * 1.5);
  gh.currentRun = {
    ghId,
    recipeName: recipe.name,
    targetWaterL,
    dosingAml,
    dosingBml,
    startedAt: MOCK_NOW.time,
    elapsedLabel: "0 min 0 sec",
    estimatedFinish: MOCK_NOW.time,
    progressPct: 0,
    waterDoneL: 0,
    dosingADoneMl: 0,
    dosingBDoneMl: 0,
    steps: [
      { name: "Fill Tank", status: "active" },
      { name: "Dosing A", status: "pending" },
      { name: "Dosing B", status: "pending" },
      { name: "Distribution", status: "pending" },
    ],
    tank: {
      currentL: gh.telemetry.tankL,
      capacityL: gh.telemetry.tankCapacityL,
      waterL: 0,
      nutrientAml: 0,
      nutrientBml: 0,
      temperatureC: 27.8,
    },
  };
  gh.fertigationState = "MIXING";
  commit();
}

export function advanceManualRun(ghId: string): "running" | "done" {
  const gh = db.greenhouses.find((g) => g.id === ghId);
  if (!gh || !gh.currentRun) return "done";
  const run = gh.currentRun;
  run.progressPct = Math.min(100, run.progressPct + 34);
  run.waterDoneL = Math.round((run.targetWaterL * run.progressPct) / 100);
  run.dosingADoneMl = Math.round((run.dosingAml * run.progressPct) / 100);
  run.dosingBDoneMl = Math.round((run.dosingBml * run.progressPct) / 100);
  run.elapsedLabel = `${Math.max(1, Math.round(run.progressPct / 10))} min ${run.progressPct % 60} sec`;

  const activeIdx = run.steps.findIndex((s) => s.status === "active");
  if (activeIdx >= 0) {
    run.steps[activeIdx].status = "done";
    if (activeIdx + 1 < run.steps.length) run.steps[activeIdx + 1].status = "active";
  }
  if (activeIdx === 0) gh.fertigationState = "DISTRIBUTING";
  if (run.progressPct >= 100) {
    gh.fertigationState = "IDLE";
    gh.history = [
      {
        id: nextId("hr"),
        ghId,
        date: MOCK_NOW.label.replace(/^\w+, /, ""),
        time: MOCK_NOW.time.slice(0, 5),
        recipeName: run.recipeName,
        waterL: run.targetWaterL,
        dosingAml: run.dosingAml,
        dosingBml: run.dosingBml,
        durationMin: 23,
        result: "completed",
      },
      ...gh.history,
    ];
    db.complexFertigationHistory = [
      {
        id: nextId("cr"),
        ghId,
        date: MOCK_NOW.label.replace(/^\w+, /, ""),
        time: MOCK_NOW.time.slice(0, 5),
        recipeName: run.recipeName,
        waterL: run.targetWaterL,
        dosingAml: run.dosingAml,
        dosingBml: run.dosingBml,
        durationMin: 23,
        result: "completed",
      },
      ...db.complexFertigationHistory,
    ];
    gh.currentRun = null;
    gh.telemetry.waterTodayL = (gh.telemetry.waterTodayL ?? 0) + run.targetWaterL;
    commit();
    return "done";
  }
  commit();
  return "running";
}

export function emergencyStopComplex(complexId: string): void {
  for (const gh of db.greenhouses) {
    if (gh.complexId === complexId && gh.currentRun) {
      gh.currentRun = null;
      gh.fertigationState = "IDLE";
    }
  }
  const complex = db.complexes.find((c) => c.id === complexId);
  if (complex) complex.water = { ...complex.water, wellPumpOn: false };
  commit();
}

export function setWellPumpOn(complexId: string, on: boolean): void {
  const complex = db.complexes.find((c) => c.id === complexId);
  if (!complex) throw new Error("complex not found");
  complex.water = { ...complex.water, wellPumpOn: on };
  commit();
}
