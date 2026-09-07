/**
 * In-memory mock database for the UI prototype.
 *
 * This is the single mutable state of the frontend-only phase. When the
 * Python backend lands, every read/write here is replaced by REST calls
 * (see src/lib/api/backend-client.ts) — UI components never touch this file
 * directly, they only talk to the service layer.
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
import type {
  CalibrationDevice,
  CalibrationRecord,
  Complex,
  FertigationRunRow,
  FertigationSchedule,
  FanSchedule,
  Greenhouse,
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
}

let seq = 100;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export const db: MockDb = {
  complexes: structuredClone(complexes),
  greenhouses: structuredClone(seedGreenhouses),
  wellPumpSchedules: structuredClone(seedWellPumps),
  mixingQueue: structuredClone(seedMixingQueue),
  complexFertigationHistory: structuredClone(complexFertigationHistory),
  calibrationDevices: structuredClone(seedDevices),
  calibrationHistory: structuredClone(seedCalHistory),
};

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
  return schedule;
}

export function updateFertigationSchedule(id: string, patch: Partial<FertigationSchedule>): void {
  for (const gh of db.greenhouses) {
    const idx = gh.fertigationSchedules.findIndex((s) => s.id === id);
    if (idx >= 0) {
      gh.fertigationSchedules[idx] = { ...gh.fertigationSchedules[idx], ...patch };
      return;
    }
  }
}

export function deleteFertigationSchedule(id: string): void {
  for (const gh of db.greenhouses) {
    gh.fertigationSchedules = gh.fertigationSchedules.filter((s) => s.id !== id);
  }
}

export function createWellPumpSchedule(input: Omit<WellPumpSchedule, "id">): WellPumpSchedule {
  const schedule: WellPumpSchedule = { ...input, id: nextId("wp") };
  db.wellPumpSchedules = [...db.wellPumpSchedules, schedule];
  return schedule;
}

export function updateWellPumpSchedule(id: string, patch: Partial<WellPumpSchedule>): void {
  const idx = db.wellPumpSchedules.findIndex((s) => s.id === id);
  if (idx >= 0) db.wellPumpSchedules[idx] = { ...db.wellPumpSchedules[idx], ...patch };
}

export function deleteWellPumpSchedule(id: string): void {
  db.wellPumpSchedules = db.wellPumpSchedules.filter((s) => s.id !== id);
}

export function createFanSchedule(input: Omit<FanSchedule, "id">): FanSchedule {
  const schedule: FanSchedule = { ...input, id: nextId("fan") };
  const gh = db.greenhouses.find((g) => g.id === input.ghId);
  if (gh) gh.fanSchedules = [...gh.fanSchedules, schedule];
  return schedule;
}

export function updateFanSchedule(id: string, patch: Partial<FanSchedule>): void {
  for (const gh of db.greenhouses) {
    const idx = gh.fanSchedules.findIndex((s) => s.id === id);
    if (idx >= 0) {
      gh.fanSchedules[idx] = { ...gh.fanSchedules[idx], ...patch };
      return;
    }
  }
}

export function deleteFanSchedule(id: string): void {
  for (const gh of db.greenhouses) {
    gh.fanSchedules = gh.fanSchedules.filter((s) => s.id !== id);
  }
}

export function addObservation(ghId: string, _draft: ObservationDraft): void {
  const gh = db.greenhouses.find((g) => g.id === ghId);
  if (gh) gh.plants.latestObservation = "2 Sep 2026";
}

export function addCalibrationRecord(record: Omit<CalibrationRecord, "id">): void {
  db.calibrationHistory = [{ ...record, id: nextId("ch") }, ...db.calibrationHistory];
}

export function addGreenhouse(complexId: string, crop: string): Greenhouse {
  const complex = db.complexes.find((c) => c.id === complexId);
  if (!complex) throw new Error("complex not found");
  const num = db.greenhouses.length + 1;
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
  return complex;
}
