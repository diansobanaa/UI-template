/**
 * Frontend service layer — the ONLY boundary UI components use to reach data.
 *
 * Today every function runs against the in-memory mock store with a small
 * simulated latency so loading/pending states behave like the real thing.
 * When the Python backend is ready, re-implement these objects on top of
 * `src/lib/api/backend-client.ts` (same method names, async over REST).
 * UI components will not change.
 */
import {
  addCalibrationRecord,
  addComplex,
  addGreenhouse,
  addObservation,
  advanceManualRun,
  createFanSchedule,
  createFertigationSchedule,
  createWellPumpSchedule,
  db,
  deleteFanSchedule,
  deleteFertigationSchedule,
  deleteWellPumpSchedule,
  deleteObservation,
  emergencyStopComplex,
  markComplexSyncAttempt,
  setComplexEsp32Synced,
  setWellPumpOn,
  startManualRun,
  updateFanSchedule,
  updateFertigationSchedule,
  updateWellPumpSchedule,
} from "./store";
import { alerts as recentAlerts, recentEvents } from "./data/events";
import {
  calibrationCategories,
  calibrationReference,
  categoryFilterMap,
} from "./data/calibration";
import { dosingLastCalibration, dosingPumps, fertigationSystemStatus } from "./data/greenhouses";
import { MOCK_NOW } from "./format";
import { ServiceError } from "./errors";
import type {
  AlertItem,
  CalibrationDevice,
  CalibrationRecord,
  Complex,
  EventItem,
  FertigationSchedule,
  FanSchedule,
  Greenhouse,
  ObservationDraft,
  WellPumpSchedule,
} from "./types";

/** Simulated network latency for the mock backend. */
export function delay(ms = 350): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertFound<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new ServiceError("NOT_FOUND", `${what} was not found.`);
  }
  return value;
}

/* --------------------------- system ------------------------------ */

export const complexService = {
  list(): Complex[] {
    return db.complexes;
  },
  get(id: string): Complex | undefined {
    return db.complexes.find((c) => c.id === id);
  },
  async create(location: string): Promise<Complex> {
    if (!location.trim()) {
      throw new ServiceError("VALIDATION_FAILED", "Location is required.", "location");
    }
    await delay();
    return addComplex(location.trim());
  },
};

export const greenhouseService = {
  byComplex(complexId: string): Greenhouse[] {
    const complex = complexService.get(complexId);
    if (!complex) return [];
    return complex.greenhouseIds
      .map((id) => db.greenhouses.find((g) => g.id === id))
      .filter((g): g is Greenhouse => Boolean(g));
  },
  get(id: string): Greenhouse | undefined {
    return db.greenhouses.find((g) => g.id === id);
  },
  async create(complexId: string, crop: string): Promise<Greenhouse> {
    assertFound(complexService.get(complexId), "Complex");
    if (!crop.trim()) {
      throw new ServiceError("VALIDATION_FAILED", "Crop is required.", "crop");
    }
    await delay();
    return addGreenhouse(complexId, crop.trim());
  },
};

export const eventService = {
  recent(complexId: string): EventItem[] {
    return complexId === "complex-01" ? recentEvents : [];
  },
  all(): EventItem[] {
    return recentEvents;
  },
  alerts(): AlertItem[] {
    return recentAlerts;
  },
};

/* -------------------------- schedules ---------------------------- */

export const scheduleService = {
  fertigationForGh(ghId: string): FertigationSchedule[] {
    return greenhouseService.get(ghId)?.fertigationSchedules ?? [];
  },
  wellPumpForComplex(complexId: string): WellPumpSchedule[] {
    return db.wellPumpSchedules.filter((s) => s.complexId === complexId);
  },
  fanForGh(ghId: string): FanSchedule[] {
    return greenhouseService.get(ghId)?.fanSchedules ?? [];
  },

  async createFertigation(input: Omit<FertigationSchedule, "id">): Promise<FertigationSchedule> {
    const gh = assertFound(greenhouseService.get(input.ghId), "Greenhouse");
    if (!gh.recipes.some((r) => r.id === input.recipeId)) {
      throw new ServiceError("INVALID_RELATIONSHIP", "The selected recipe does not belong to this greenhouse.", "recipeId");
    }
    if (!input.name.trim()) {
      throw new ServiceError("VALIDATION_FAILED", "Schedule name is required.", "name");
    }
    if (gh.fertigationSchedules.some((s) => s.name.toLowerCase() === input.name.trim().toLowerCase())) {
      throw new ServiceError("DUPLICATE_ID", `A fertigation schedule named "${input.name.trim()}" already exists in this greenhouse.`, "name");
    }
    await delay();
    return createFertigationSchedule({ ...input, name: input.name.trim() });
  },

  async updateFertigation(id: string, patch: Partial<FertigationSchedule>): Promise<FertigationSchedule> {
    const existing = db.greenhouses.flatMap((g) => g.fertigationSchedules).find((s) => s.id === id);
    assertFound(existing, "Schedule");
    if (patch.name !== undefined) {
      if (!patch.name.trim()) {
        throw new ServiceError("VALIDATION_FAILED", "Schedule name is required.", "name");
      }
      const targetGhId: string = existing.ghId;
      const duplicate = db.greenhouses
        .flatMap((g) => g.fertigationSchedules)
        .some((s) => s.id !== id && s.ghId === targetGhId && s.name.toLowerCase() === patch.name!.trim().toLowerCase());
      if (duplicate) {
        throw new ServiceError("DUPLICATE_ID", `A fertigation schedule named "${patch.name.trim()}" already exists in this greenhouse.`, "name");
      }
      patch = { ...patch, name: patch.name.trim() };
    }
    if (patch.recipeId !== undefined && patch.recipeId !== existing.recipeId) {
      const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");
      if (!gh.recipes.some((r) => r.id === patch.recipeId)) {
        throw new ServiceError("INVALID_RELATIONSHIP", "The selected recipe does not belong to this greenhouse.", "recipeId");
      }
    }
    await delay();
    const updated = updateFertigationSchedule(id, patch);
    return assertFound(updated, "Schedule");
  },

  async deleteFertigation(id: string): Promise<void> {
    await delay();
    assertFound(deleteFertigationSchedule(id), "Schedule");
  },

  async createWellPump(input: Omit<WellPumpSchedule, "id">): Promise<WellPumpSchedule> {
    assertFound(complexService.get(input.complexId), "Complex");
    if (!input.task.trim()) {
      throw new ServiceError("VALIDATION_FAILED", "Task name is required.", "task");
    }
    if (db.wellPumpSchedules.some((s) => s.complexId === input.complexId && s.task.toLowerCase() === input.task.trim().toLowerCase())) {
      throw new ServiceError("DUPLICATE_ID", `A well pump schedule named "${input.task.trim()}" already exists in this complex.`, "task");
    }
    await delay();
    return createWellPumpSchedule({ ...input, task: input.task.trim() });
  },

  async updateWellPump(id: string, patch: Partial<WellPumpSchedule>): Promise<WellPumpSchedule> {
    const existing = assertFound(db.wellPumpSchedules.find((s) => s.id === id), "Schedule");
    if (patch.task !== undefined) {
      if (!patch.task.trim()) {
        throw new ServiceError("VALIDATION_FAILED", "Task name is required.", "task");
      }
      const duplicate = db.wellPumpSchedules.some(
        (s) => s.id !== id && s.complexId === existing.complexId && s.task.toLowerCase() === patch.task!.trim().toLowerCase()
      );
      if (duplicate) {
        throw new ServiceError("DUPLICATE_ID", `A well pump schedule named "${patch.task.trim()}" already exists in this complex.`, "task");
      }
      patch = { ...patch, task: patch.task.trim() };
    }
    await delay();
    const updated = updateWellPumpSchedule(id, patch);
    return assertFound(updated, "Schedule");
  },

  async deleteWellPump(id: string): Promise<void> {
    await delay();
    assertFound(deleteWellPumpSchedule(id), "Schedule");
  },

  async createFan(input: Omit<FanSchedule, "id">): Promise<FanSchedule> {
    const gh = assertFound(greenhouseService.get(input.ghId), "Greenhouse");
    if (input.mode === "temperature") {
      if ((input.onAboveC ?? 0) <= (input.offBelowC ?? 0)) {
        throw new ServiceError("VALIDATION_FAILED", "Fan ON threshold must be higher than the OFF threshold.", "onAboveC");
      }
    }
    await delay();
    return createFanSchedule(input);
  },

  async updateFan(id: string, patch: Partial<FanSchedule>): Promise<FanSchedule> {
    const existing = db.greenhouses.flatMap((g) => g.fanSchedules).find((s) => s.id === id);
    assertFound(existing, "Schedule");
    const merged = { ...existing, ...patch };
    if (merged.mode === "temperature" && (merged.onAboveC ?? 0) <= (merged.offBelowC ?? 0)) {
      throw new ServiceError("VALIDATION_FAILED", "Fan ON threshold must be higher than the OFF threshold.", "onAboveC");
    }
    await delay();
    const updated = updateFanSchedule(id, patch);
    return assertFound(updated, "Schedule");
  },

  async deleteFan(id: string): Promise<void> {
    await delay();
    assertFound(deleteFanSchedule(id), "Schedule");
  },
};

/* -------------------------- calibration -------------------------- */

export const calibrationService = {
  categories() {
    return calibrationCategories;
  },
  devices(): CalibrationDevice[] {
    return db.calibrationDevices;
  },
  history(): CalibrationRecord[] {
    return db.calibrationHistory;
  },
  reference() {
    return calibrationReference;
  },
  devicesForCategory(category: string): CalibrationDevice[] {
    const allowed = categoryFilterMap[category] ?? categoryFilterMap["all"];
    return db.calibrationDevices.filter((d) => allowed.includes(d.category));
  },
  async startCalibration(device: CalibrationDevice, before: string, after: string, user = "Admin"): Promise<void> {
    if (!before.trim() || !after.trim()) {
      throw new ServiceError("VALIDATION_FAILED", "Before and after readings are required.");
    }
    await delay();
    addCalibrationRecord({
      dateTime: `${MOCK_NOW.dateTime.slice(0, 11)}${MOCK_NOW.time.slice(0, 5)}`,
      device: device.name.replace(/\s*\(.*\)$/, ""),
      type: device.category === "ph" ? "pH (1 point)" : "Field calibration",
      before,
      after,
      result: "Success",
      user,
    });
  },
};

/* -------------------------- fertigation -------------------------- */

/** Transient (non-persisted) sync state per complex — mirrors spec #34. */
type SyncState = "idle" | "syncing" | "error";
const syncStates = new Map<string, SyncState>();

/** Transient dosing-pump test runs (pump id → running). */
const pumpTestRuns = new Set<string>();

export const fertigationService = {
  mixingQueue() {
    return db.mixingQueue;
  },
  dosingPumps() {
    return dosingPumps;
  },
  dosingLastCalibration() {
    return dosingLastCalibration;
  },
  history() {
    return db.complexFertigationHistory;
  },
  systemStatus() {
    return fertigationSystemStatus;
  },
  observationsForGh(ghId: string) {
    return db.observations.filter((o) => o.ghId === ghId);
  },

  syncState(complexId: string): SyncState {
    return syncStates.get(complexId) ?? "idle";
  },

  /** Manual fertigation: creates a real run and advances it in mock ticks. */
  async startManual(ghId: string, recipeId: string, targetWaterL: number): Promise<void> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    if (!gh.recipes.some((r) => r.id === recipeId)) {
      throw new ServiceError("INVALID_RELATIONSHIP", "The selected recipe does not belong to this greenhouse.", "recipeId");
    }
    if (!Number.isFinite(targetWaterL) || targetWaterL <= 0) {
      throw new ServiceError("VALIDATION_FAILED", "Target water must be greater than zero.", "targetWaterL");
    }
    if (gh.currentRun) {
      throw new ServiceError("CONFLICT", `${gh.code} already has a fertigation running. Wait for it to finish.`);
    }
    await delay();
    startManualRun(ghId, recipeId, targetWaterL);
    // Mock lifecycle: advance the run in a few ticks like a backend would stream progress.
    const tick = () => {
      const done = advanceManualRun(ghId) === "done";
      if (!done) setTimeout(tick, 1200);
    };
    setTimeout(tick, 1200);
  },

  /** ESP32 sync: pending → synced on success; error path preserves state (spec #26/#34). */
  async syncEsp32(complexId: string): Promise<void> {
    const complex = assertFound(complexService.get(complexId), "Complex");
    if (syncStates.get(complexId) === "syncing") {
      throw new ServiceError("CONFLICT", "A synchronization is already in progress.");
    }
    syncStates.set(complexId, "syncing");
    markComplexSyncAttempt(complexId);
    try {
      await delay(900);
      if (!complex.esp32.online) {
        throw new ServiceError("DEVICE_OFFLINE", `ESP32 for ${complex.code} is OFFLINE — unable to synchronize configuration.`);
      }
      setComplexEsp32Synced(complexId);
      syncStates.set(complexId, "idle");
    } catch (e) {
      syncStates.set(complexId, "error");
      // previous configuration state remains (no version bump happened)
      setTimeout(() => syncStates.set(complexId, "idle"), 2500);
      throw e;
    }
  },

  /** Emergency stop: stops every run in the complex and shuts the well pump. */
  async emergencyStop(complexId: string): Promise<void> {
    assertFound(complexService.get(complexId), "Complex");
    await delay(500);
    emergencyStopComplex(complexId);
  },

  /** Radar interlock: pump may only start when the tank is still filling (spec #16). */
  async setWellPump(complexId: string, on: boolean): Promise<void> {
    const complex = assertFound(complexService.get(complexId), "Complex");
    await delay();
    const radarFull = complex.water.rawTankPct >= 95;
    if (on && radarFull) {
      throw new ServiceError("DEVICE_OFFLINE", "Raw water tank is Penuh (full) — radar interlock keeps the pump OFF. The schedule remains active.");
    }
    setWellPumpOn(complexId, on);
  },

  /** Dosing pump test run — transient running state, then completes. */
  isPumpTesting(pumpId: string): boolean {
    return pumpTestRuns.has(pumpId);
  },
  async testPump(pumpId: string, pumpName: string): Promise<void> {
    if (pumpTestRuns.has(pumpId)) {
      throw new ServiceError("CONFLICT", `${pumpName} is already running a test.`);
    }
    pumpTestRuns.add(pumpId);
    try {
      await delay(1500);
    } finally {
      pumpTestRuns.delete(pumpId);
    }
  },

  async addObservation(ghId: string, draft: ObservationDraft): Promise<void> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    if (!draft.plantId.trim()) {
      throw new ServiceError("VALIDATION_FAILED", "Plant ID is required.", "plantId");
    }
    if (draft.heightCm <= 0) {
      throw new ServiceError("VALIDATION_FAILED", "Height must be greater than zero.", "heightCm");
    }
    await delay();
    addObservation(gh.id, draft);
  },

  async deleteObservation(id: string): Promise<void> {
    await delay();
    deleteObservation(id);
  },
};
