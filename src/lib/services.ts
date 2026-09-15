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
  deleteCropCycleTanggalPolinasi,
  emergencyStopComplex,
  harvestCropCycle,
  markComplexSyncAttempt,
  recordCropCyclePolinasi,
  resetCropCycle,
  resumeComplex,
  setCalibrationDeviceReading,
  setComplexEsp32Synced,
  setWellPumpOn,
  startCropCycle,
  startManualRun,
  startOngoingCropCycle,
  updateCropCycleMetadata,
  updateCropCycleTanggalPolinasi,
  updateCropCycleTanggalTanam,
  updateFanSchedule,
  updateComplex,
  updateFertigationSchedule,
  updateGreenhouse,
  updateWellPumpSchedule,
} from "./store";
import { alerts as recentAlerts, recentEvents } from "./data/events";
import {
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
  CropCycle,
  CycleStatus,
  EventItem,
  FertigationSchedule,
  FanSchedule,
  Greenhouse,
  ObservationDraft,
  WellPumpSchedule,
} from "./types";
import { esp32Client } from "./api/esp32-client";
import { isDirectEsp32Enabled } from "./api/backend-client";
import type { CurrentCropCycleResponse } from "./api/contracts";


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
  async update(id: string, patch: Partial<Pick<Complex, "code" | "name" | "location" | "status">>): Promise<Complex> {
    if (patch.code !== undefined && !patch.code.trim()) throw new ServiceError("VALIDATION_FAILED", "Complex code is required.", "code");
    if (patch.name !== undefined && !patch.name.trim()) throw new ServiceError("VALIDATION_FAILED", "Complex name is required.", "name");
    if (patch.location !== undefined && !patch.location.trim()) throw new ServiceError("VALIDATION_FAILED", "Location is required.", "location");
    await delay();
    const cleanPatch: Partial<Pick<Complex, "code" | "name" | "location" | "status">> = { ...patch };
    if (patch.code !== undefined) cleanPatch.code = patch.code.trim();
    if (patch.name !== undefined) cleanPatch.name = patch.name.trim();
    if (patch.location !== undefined) cleanPatch.location = patch.location.trim();
    return assertFound(updateComplex(id, cleanPatch), "Complex");
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
  async update(id: string, patch: Partial<Pick<Greenhouse, "code" | "crop" | "greenhouseTag">>): Promise<Greenhouse> {
    if (patch.code !== undefined && !patch.code.trim()) throw new ServiceError("VALIDATION_FAILED", "Greenhouse code is required.", "code");
    if (patch.crop !== undefined && !patch.crop.trim()) throw new ServiceError("VALIDATION_FAILED", "Crop is required.", "crop");
    await delay();
    const cleanPatch: Partial<Pick<Greenhouse, "code" | "crop" | "greenhouseTag">> = { ...patch };
    if (patch.code !== undefined) cleanPatch.code = patch.code.trim();
    if (patch.crop !== undefined) cleanPatch.crop = patch.crop.trim();
    if (patch.greenhouseTag !== undefined) cleanPatch.greenhouseTag = patch.greenhouseTag.trim();
    return assertFound(updateGreenhouse(id, cleanPatch), "Greenhouse");
  },
};

function applyEsp32CycleToStore(ghId: string, resp: CurrentCropCycleResponse): Greenhouse {
  const gh = db.greenhouses.find((g) => g.id === ghId);
  if (!gh) throw new ServiceError("NOT_FOUND", "Greenhouse not found.");

  const mappedStatus: CycleStatus =
    resp.status === "ACTIVE" ? "ACTIVE" :
    resp.status === "HARVESTED" ? "HARVESTED" : "NO_CYCLE";

  if (mappedStatus === "NO_CYCLE" || !resp.tanggalTanam) {
    gh.cropCycle = {
      status: "NO_CYCLE",
      tanggalTanam: null,
      tanggalPolinasi: null,
      lastHarvestSummary: gh.cropCycle?.lastHarvestSummary ?? null,
    };
    gh.telemetry.hstDays = 0;
    gh.telemetry.hspDays = null;
  } else {
    gh.cropCycle = {
      status: mappedStatus,
      tanggalTanam: resp.tanggalTanam,
      tanggalPolinasi: resp.tanggalPolinasi ?? null,
      variety: resp.variety ?? undefined,
      plantCount: resp.plantCount ?? gh.plants.total,
      notes: resp.notes ?? undefined,
      lastHarvestSummary: gh.cropCycle?.lastHarvestSummary ?? null,
    };
    if (resp.plantCount) {
      gh.plants.total = resp.plantCount;
      gh.plants.alive = resp.plantCount;
    }
    gh.telemetry.hstDays = resp.hst ?? 0;
    gh.telemetry.hspDays = resp.hsp ?? null;
  }
  return gh;
}


export const cropCycleService = {
  getCycle(ghId: string): CropCycle | undefined {
    return greenhouseService.get(ghId)?.cropCycle;
  },

  async syncCycleFromEsp32(ghId: string): Promise<CropCycle | undefined> {
    if (!isDirectEsp32Enabled()) return cropCycleService.getCycle(ghId);
    try {
      const resp = await esp32Client.getCurrentCropCycle(ghId);
      const gh = applyEsp32CycleToStore(ghId, resp);
      return gh.cropCycle;
    } catch {
      return cropCycleService.getCycle(ghId);
    }
  },

  async startCycle(
    ghId: string,
    tanggalTanam: string,
    options?: { variety?: string; plantCount?: number; notes?: string }
  ): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const resp = await esp32Client.startCropCycle(ghId, {
          tanggalTanam,
          variety: options?.variety,
          plantCount: options?.plantCount,
          notes: options?.notes,
        });
        return applyEsp32CycleToStore(ghId, resp);
      } catch (err: unknown) {
        const errorObj = err as { status?: number; message?: string };
        if (errorObj?.status === 409) {
          throw new ServiceError("CONFLICT", "Siklus tanam sudah aktif pada greenhouse ini.");
        }
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal memulai siklus tanam pada ESP32.");
      }
    }
    await delay(300);
    return startCropCycle(ghId, tanggalTanam, options);
  },

  async startOngoingCycle(
    ghId: string,
    tanggalTanam: string,
    options?: { variety?: string; plantCount?: number; tanggalPolinasi?: string; notes?: string }
  ): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const resp = await esp32Client.importActiveCropCycle(ghId, {
          tanggalTanam,
          tanggalPolinasi: options?.tanggalPolinasi,
          variety: options?.variety,
          plantCount: options?.plantCount,
          notes: options?.notes,
        });
        return applyEsp32CycleToStore(ghId, resp);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal import siklus berjalan pada ESP32.");
      }
    }
    await delay(300);
    return startOngoingCropCycle(ghId, tanggalTanam, options);
  },

  async recordPolinasi(
    ghId: string,
    tanggalPolinasi: string,
    options?: { pollinationMethod?: "natural" | "bee" | "manual"; notes?: string }
  ): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.recordPollination(ghId, cycleId, {
          tanggalPolinasi,
          pollinationMethod: options?.pollinationMethod,
          notes: options?.notes,
        });
        return applyEsp32CycleToStore(ghId, resp);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal mencatat polinasi pada ESP32.");
      }
    }
    await delay(300);
    return recordCropCyclePolinasi(ghId, tanggalPolinasi, options);
  },

  async updateTanggalTanam(ghId: string, newTanggalTanam: string): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.updatePlantingDate(ghId, cycleId, {
          tanggalTanam: newTanggalTanam,
        });
        return applyEsp32CycleToStore(ghId, resp);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update tanggal tanam pada ESP32.");
      }
    }
    await delay(300);
    return updateCropCycleTanggalTanam(ghId, newTanggalTanam);
  },

  async updateTanggalPolinasi(
    ghId: string,
    newTanggalPolinasi: string,
    options?: { pollinationMethod?: "natural" | "bee" | "manual" }
  ): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.updatePollination(ghId, cycleId, {
          tanggalPolinasi: newTanggalPolinasi,
          pollinationMethod: options?.pollinationMethod,
        });
        return applyEsp32CycleToStore(ghId, resp);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update tanggal polinasi pada ESP32.");
      }
    }
    await delay(300);
    return updateCropCycleTanggalPolinasi(ghId, newTanggalPolinasi, options);
  },

  async updateMetadata(
    ghId: string,
    updates: { variety?: string; plantCount?: number; notes?: string }
  ): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.updateCropCycleMetadata(ghId, cycleId, updates);
        return applyEsp32CycleToStore(ghId, resp);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update metadata siklus pada ESP32.");
      }
    }
    await delay(300);
    return updateCropCycleMetadata(ghId, updates);
  },

  async deleteTanggalPolinasi(ghId: string): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.deletePollination(ghId, cycleId);
        return applyEsp32CycleToStore(ghId, resp);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal hapus tanggal polinasi pada ESP32.");
      }
    }
    await delay(300);
    return deleteCropCycleTanggalPolinasi(ghId);
  },

  async resetCycle(ghId: string): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.cancelCropCycle(ghId, cycleId, {});
        return applyEsp32CycleToStore(ghId, resp);

      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal reset siklus tanam pada ESP32.");
      }
    }
    await delay(300);
    return resetCropCycle(ghId);
  },

  async harvest(
    ghId: string,
    options?: { harvestDate?: string; yieldKg?: number; grade?: string; notes?: string }
  ): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.harvestCropCycle(ghId, cycleId, {
          harvestDate: options?.harvestDate,
          yieldKg: options?.yieldKg,
          grade: options?.grade,
          notes: options?.notes,
        });
        return applyEsp32CycleToStore(ghId, resp);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal panen siklus tanam pada ESP32.");
      }
    }
    await delay(400);
    return harvestCropCycle(ghId, options);
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
    const existing = assertFound(
      db.greenhouses.flatMap((g) => g.fertigationSchedules).find((s) => s.id === id),
      "Schedule",
    );
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
    const pointCount = device.method === "two" ? 2 : 1;
    const type =
      device.category === "ph"
        ? `pH (${pointCount} point)`
        : device.category === "ec"
          ? `EC (${pointCount} point)`
          : "Volume Test (30s)";
    addCalibrationRecord({
      dateTime: `${MOCK_NOW.dateTime.slice(0, 11)}${MOCK_NOW.time.slice(0, 5)}`,
      device: device.name.replace(/\s*\(.*\)$/, ""),
      type,
      before,
      after,
      result: "Success",
      user,
    });
    setCalibrationDeviceReading(device.id, String(parseFloat(after)));
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
  async getDynamicDosingPumps() {
    try {
      const inv = await esp32Client.getInventory();
      if (inv && Array.isArray(inv.components)) {
        const dynamicPumps = inv.components.filter(
          (c) =>
            c.type === "PUMP" &&
            (c.role?.includes("DOSING") ||
              c.componentId?.includes("dosing") ||
              c.name?.toLowerCase().includes("dosing") ||
              c.componentId?.startsWith("dp-"))
        );
        if (dynamicPumps.length > 0) {
          return dynamicPumps.map((c) => ({
            id: c.componentId,
            name: c.name,
            state: (c.status === "AVAILABLE" ? "Ready" : "Not Used") as "Ready" | "Not Used",
            rate: "0 ml/min",
          }));
        }
      }
    } catch {
      // Graceful fallback to default dosingPumps if offline
    }
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
    if (gh.complexId && this.isStopped(gh.complexId)) {
      throw new ServiceError("CONFLICT", "System is in EMERGENCY STOP — resume the system before starting a run.");
    }
    if (!gh.recipes.some((r) => r.id === recipeId)) {
      throw new ServiceError("INVALID_RELATIONSHIP", "The selected recipe does not belong to this greenhouse.", "recipeId");
    }
    if (!Number.isFinite(targetWaterL) || targetWaterL <= 0) {
      throw new ServiceError("VALIDATION_FAILED", "Target water must be greater than zero.", "targetWaterL");
    }
    if (gh.currentRun) {
      throw new ServiceError("CONFLICT", `${gh.code} already has a fertigation running. Wait for it to finish.`);
    }
    if (isDirectEsp32Enabled()) {
      try {
        const cmdId = `fert-${Date.now()}`;
        await esp32Client.postCommand(cmdId, "START_FERTIGATION", {
          componentId: ghId,
          parameters: { recipeId, targetWaterL }
        });
        
        const poll = async () => {
          try {
            const res = await esp32Client.getCommand(cmdId);
            if (res.status === "COMPLETED" || res.status === "FAILED" || res.status === "REJECTED" || res.status === "CANCELLED") {
              return;
            }
            setTimeout(poll, 2000);
          } catch (e) {
            setTimeout(poll, 2000);
          }
        };
        setTimeout(poll, 2000);
        return;
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Failed to start fertigation on ESP32.");
      }
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
      if (isDirectEsp32Enabled()) {
        await esp32Client.getStatus();
      } else {
        await delay(900);
        if (!complex.esp32.online) {
          throw new ServiceError("DEVICE_OFFLINE", `ESP32 for ${complex.code} is OFFLINE — unable to synchronize configuration.`);
        }
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

  /** Emergency stop: stops every run in the complex, shuts the well pump, and latches the stop until manually resumed. */
  async emergencyStop(complexId: string): Promise<void> {
    assertFound(complexService.get(complexId), "Complex");
    if (isDirectEsp32Enabled()) {
      try {
        await esp32Client.emergencyStop("Emergency stop triggered from UI");
      } catch (e) {
        console.warn("Direct ESP32 emergency stop failed or offline:", e);
      }
    }
    await delay(500);
    emergencyStopComplex(complexId);
  },


  /** Latched emergency-stop state — actuators and runs stay blocked until resume() is called. */
  isStopped(complexId: string): boolean {
    return complexService.get(complexId)?.emergencyStopped ?? false;
  },

  /** Manual resume: clears the latched emergency stop; the operator re-enables schedules/pumps normally. */
  async resume(complexId: string): Promise<void> {
    assertFound(complexService.get(complexId), "Complex");
    
    if (isDirectEsp32Enabled()) {
      try {
        const cmdId = `resume-${Date.now()}`;
        await esp32Client.postCommand(cmdId, "RESUME_CYCLE", {
          componentId: complexId
        });
        
        const poll = async () => {
          try {
            const res = await esp32Client.getCommand(cmdId);
            if (res.status === "COMPLETED" || res.status === "FAILED" || res.status === "REJECTED" || res.status === "CANCELLED") {
              return;
            }
            setTimeout(poll, 2000);
          } catch (e) {
            setTimeout(poll, 2000);
          }
        };
        setTimeout(poll, 2000);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Failed to resume on ESP32.");
      }
    }
    
    await delay(400);
    resumeComplex(complexId);
  },

  /** Radar interlock: pump may only start when the tank is still filling (spec #16). */
  async setWellPump(complexId: string, on: boolean): Promise<void> {
    const complex = assertFound(complexService.get(complexId), "Complex");
    if (on && complex.emergencyStopped) {
      throw new ServiceError("CONFLICT", "System is in EMERGENCY STOP — resume the system before turning the well pump ON.");
    }
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
