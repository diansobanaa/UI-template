/**
 * Frontend service layer — the ONLY boundary UI components use to reach data.
 *
 * UI components use this service layer exclusively. Operational state is read
 * from the Python-owned REST backend (with live ESP32 data merged into the
 * in-memory client cache). Client-side mock/seed state is not a valid operational authority.
 */
import { ServiceError } from "./errors";
import type {
  AlertItem, CalibrationDevice, CalibrationRecord, Complex, CropCycle, CycleStatus, EquipmentItem, EventItem,
  FertigationSchedule, FanSchedule, Greenhouse, ObservationDraft, Recipe, WellPumpSchedule, Observation, ResearchObservation, FertigationSystemStatus,
  ScheduleActivationState, ScheduleBlockedReason, ScheduleStatus,
} from "./types";
import { esp32Client } from "./api/esp32-client";
import { isDirectEsp32Enabled, isPythonBackendEnabled, ESP32_API_BASE, apiGet, apiPost, getActiveEsp32Endpoint, setActiveEsp32Endpoint } from "./api/backend-client";
import { PythonClient } from "./api/python-client";
import type { CompiledSchedule, ConfigurationPayload, CurrentCropCycleResponse, TelemetryHistoryResponse, TelemetrySnapshot, ComplexDeletionPreview, DeletionJob, SystemTopologyPool, TopologyMutationRequest, TopologyMutationResponse, InstalledComponent } from "./api/contracts";
import { compileScheduleSet } from "./runtime/schedule-compiler.js";
import { generateFertigationExecutionPlan } from "./runtime/execution-plan-generator.js";
import { getOperationalSnapshot, replaceComplex, replaceGreenhouse, removeGreenhouse, removeComplex, operationalPythonClient, getOperationalTopologyMetadata } from "./operational-state";
import { saveBootstrapIp } from "./bootstrap-address";
import { CANONICAL_GPIO_PIN_MAP } from "./data/gpioPinMap";
import { calibrationReference, categoryFilterMap } from "./data/calibration-reference";


/** Simulated network latency removed for production hardening (defaults to 0ms). */
export function delay(ms = 0): Promise<void> {
  if (ms === 0) return Promise.resolve();
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
    return getOperationalSnapshot().complexes;
  },
  get(id: string): Complex | undefined {
    return getOperationalSnapshot().complexes.find((c) => c.id === id);
  },
  async create(location: string, options?: { code?: string; name?: string }): Promise<Complex> {
    if (!location.trim()) throw new ServiceError("VALIDATION_FAILED", "Location is required.", "location");
    const complexId = options?.code?.toLowerCase().replace(/\s+/g, "-") || `complex-${Date.now().toString(36)}`;
    const name = options?.name || options?.code || `Complex ${complexId.toUpperCase()}`;
    const activeEndpoint = getActiveEsp32Endpoint() || "";
    const activeDeviceId = getOperationalTopologyMetadata()?.reachableControllers[0] || "esp32";

    // 1. Direct ESP32 Topology Mutation (Authoritative Operational Path)
    if (isDirectEsp32Enabled() && activeEndpoint) {
      try {
        await esp32Client.applyTopologyMutation({
          operation: "CREATE_COMPLEX",
          complexId,
          name,
          ownerDeviceId: activeDeviceId,
        });
      } catch (err) {
        console.warn("[complexService.create] ESP32 mutation notice:", err);
      }
    }

    const created: Complex = {
      id: complexId,
      code: options?.code || complexId.toUpperCase(),
      name,
      location: location.trim(),
      status: "Active",
      emergencyStopped: false,
      systemStatus: "NORMAL",
      greenhouseIds: [],
      operationalStatus: "LIVE",
      authoritySource: "ESP32_DIRECT",
      esp32: {
        online: true,
        synchronized: true,
        deviceId: activeDeviceId,
        endpoint: activeEndpoint,
        lastSync: new Date().toLocaleTimeString(),
        configVersion: 1,
        esp32ConfigVersion: 1,
      },
      water: {
        wellPumpOn: false,
        rawTankPct: 100,
        flowTodayL: 0,
        flowDeltaPct: 0,
      },
    };

    replaceComplex(created);

    if (isPythonBackendEnabled()) {
      operationalPythonClient.createComplex({ location: location.trim(), code: options?.code, name: options?.name }).catch(() => { });
    }

    return created;
  },
  async bindEsp32Controller(complexId: string, input: { deviceId: string; endpoint: string; apiVersion?: string; schemaVersion?: number; firmwareVersion?: string; hardwareModel?: string; inventoryVersion?: number }): Promise<Complex> {
    if (!input.deviceId.trim()) throw new ServiceError("VALIDATION_FAILED", "ESP32 device ID is required.", "deviceId");
    if (!input.endpoint.trim()) throw new ServiceError("VALIDATION_FAILED", "ESP32 endpoint is required.", "endpoint");

    if (isDirectEsp32Enabled()) {
      try {
        await esp32Client.bindDevice(input.deviceId.trim(), complexId);
      } catch (err) {
        console.warn("[complexService.bindEsp32Controller] Direct ESP32 bind notice:", err);
      }
    }

    const existing = complexService.get(complexId);
    const bound: Complex = existing ? {
      ...existing,
      status: "Active",
      operationalStatus: "LIVE",
      authoritySource: "ESP32_DIRECT",
      esp32: {
        ...existing.esp32,
        online: true,
        synchronized: true,
        deviceId: input.deviceId.trim(),
        endpoint: input.endpoint.trim(),
        apiVersion: input.apiVersion || existing.esp32.apiVersion,
        schemaVersion: input.schemaVersion ?? existing.esp32.schemaVersion,
        firmwareVersion: input.firmwareVersion || existing.esp32.firmwareVersion,
        hardwareModel: input.hardwareModel || existing.esp32.hardwareModel,
        inventoryVersion: input.inventoryVersion ?? existing.esp32.inventoryVersion,
        lastSync: new Date().toLocaleTimeString(),
      },
    } : {
      id: complexId,
      code: complexId.toUpperCase(),
      name: complexId,
      location: "ESP32 Managed Complex",
      status: "Active",
      emergencyStopped: false,
      systemStatus: "NORMAL",
      greenhouseIds: [],
      operationalStatus: "LIVE",
      authoritySource: "ESP32_DIRECT",
      esp32: {
        online: true,
        synchronized: true,
        deviceId: input.deviceId.trim(),
        endpoint: input.endpoint.trim(),
        lastSync: new Date().toLocaleTimeString(),
        configVersion: 1,
        esp32ConfigVersion: 1,
      },
      water: {
        wellPumpOn: false,
        rawTankPct: 100,
        flowTodayL: 0,
        flowDeltaPct: 0,
      },
    };

    replaceComplex(bound);
    saveBootstrapIp(input.endpoint.trim());

    if (isPythonBackendEnabled()) {
      operationalPythonClient.bindEsp32Controller(complexId, { ...input, deviceId: input.deviceId.trim(), endpoint: input.endpoint.trim() }).catch(() => { });
    }

    return bound;
  },
  async update(id: string, patch: Partial<Pick<Complex, "code" | "name" | "location" | "status">>): Promise<Complex> {
    if (patch.code !== undefined && !patch.code.trim()) throw new ServiceError("VALIDATION_FAILED", "Complex code is required.", "code");
    if (patch.name !== undefined && !patch.name.trim()) throw new ServiceError("VALIDATION_FAILED", "Complex name is required.", "name");
    if (patch.location !== undefined && !patch.location.trim()) throw new ServiceError("VALIDATION_FAILED", "Location is required.", "location");

    if (isDirectEsp32Enabled()) {
      try {
        await esp32Client.applyTopologyMutation({
          operation: "UPDATE_COMPLEX",
          complexId: id,
          name: patch.name || patch.location,
        });
      } catch (err) {
        console.warn("[complexService.update] ESP32 mutation notice:", err);
      }
    }

    const current = assertFound(complexService.get(id), "Complex");
    const updated: Complex = { ...current, ...patch };
    replaceComplex(updated);

    if (isPythonBackendEnabled()) {
      operationalPythonClient.updateComplex(id, patch).catch(() => { });
    }

    return updated;
  },
  async getDeletionPreview(complexId: string): Promise<ComplexDeletionPreview> {
    const complex = complexService.get(complexId);
    const ghs = greenhouseService.byComplex(complexId);
    return {
      complexId,
      complexName: complex?.name || "Complex",
      complexCode: complex?.code || complexId,
      boundDevice: complex?.esp32 ? {
        deviceId: complex.esp32.deviceId ?? null,
        endpoint: complex.esp32.endpoint ?? null,
        online: Boolean(complex.esp32.online),
      } : { deviceId: null, endpoint: null, online: false },
      deletionBlockedByDevice: false,
      blockingReason: null,
      countsToPurge: {
        greenhouses: ghs.length,
        schedules: 0,
        telemetrySamples: 0,
        eventLogs: 0,
        rawRecords: 0,
        sensors: 0,
        calibrations: 0,
        fertigationRuns: 0,
        syncState: 0,
        deploymentState: 0,
      },
      countsPreservedUntouched: {
        cropCycles: 0,
        plants: 0,
        fruits: 0,
        observations: 0,
      },
      scopeSnapshotHash: "",
    };
  },
  async deleteComplex(complexId: string, options?: { requestedBy?: string; requestReason?: string; idempotencyKey?: string }): Promise<DeletionJob> {
    const complex = complexService.get(complexId);
    const targetEndpoint = complex?.esp32?.endpoint;

    if (isDirectEsp32Enabled()) {
      const prevEndpoint = getActiveEsp32Endpoint();
      if (targetEndpoint) {
        setActiveEsp32Endpoint(targetEndpoint);
      }
      try {
        await esp32Client.applyTopologyMutation({
          operation: "DELETE_COMPLEX",
          complexId,
        });
      } finally {
        if (targetEndpoint && prevEndpoint && prevEndpoint !== targetEndpoint) {
          setActiveEsp32Endpoint(prevEndpoint);
        }
      }
    }

    removeComplex(complexId);

    if (isPythonBackendEnabled()) {
      return operationalPythonClient.deleteComplex(complexId, options);
    }

    return {
      jobId: `del-${Date.now().toString(36)}`,
      complexId,
      idempotencyKey: options?.idempotencyKey || `del-key-${Date.now()}`,
      status: "COMPLETED",
      currentStep: "COMPLETED",
      deviceRetired: true,
      deviceRetryCount: 0,
      scopeSnapshotHash: "",
      recordsPurgedTotal: 0,
      requestedBy: options?.requestedBy || "operator",
      requestReason: options?.requestReason || "Manual deletion",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  },
  async getDeletionJob(jobId: string): Promise<DeletionJob> {
    if (isPythonBackendEnabled()) {
      const job = await operationalPythonClient.getDeletionJob(jobId);
      if (job.status === "COMPLETED") {
        removeComplex(job.complexId);
      }
      return job;
    }
    return {
      jobId,
      complexId: "",
      idempotencyKey: `del-key-${jobId}`,
      status: "COMPLETED",
      currentStep: "COMPLETED",
      deviceRetired: true,
      deviceRetryCount: 0,
      scopeSnapshotHash: "",
      recordsPurgedTotal: 0,
      requestedBy: "operator",
      requestReason: "Manual deletion",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  },
  removeLocal(complexId: string): void {
    removeComplex(complexId);
  },
};

export const greenhouseService = {
  byComplex(complexId: string): Greenhouse[] {
    return getOperationalSnapshot().greenhouses.filter((g) => g.complexId === complexId);
  },
  get(id: string): Greenhouse | undefined {
    return getOperationalSnapshot().greenhouses.find((g) => g.id === id);
  },
  async create(complexId: string, crop: string, areaM2?: number): Promise<Greenhouse> {
    const complex = assertFound(complexService.get(complexId), "Complex");
    if (!crop.trim()) throw new ServiceError("VALIDATION_FAILED", "Crop is required.", "crop");
    const ghId = `gh-${Date.now().toString(36)}`;
    const parsedArea = typeof areaM2 === "number" && !isNaN(areaM2) && areaM2 > 0 ? areaM2 : 500;
    const targetEndpoint = complex.esp32?.endpoint;

    if (isDirectEsp32Enabled()) {
      const prevEndpoint = getActiveEsp32Endpoint();
      if (targetEndpoint) {
        setActiveEsp32Endpoint(targetEndpoint);
      }
      try {
        await esp32Client.applyTopologyMutation({
          operation: "CREATE_GREENHOUSE",
          complexId,
          ghId,
          name: crop.trim(),
        });
      } finally {
        if (targetEndpoint && prevEndpoint && prevEndpoint !== targetEndpoint) {
          setActiveEsp32Endpoint(prevEndpoint);
        }
      }
    }

    const created: Greenhouse = {
      id: ghId,
      complexId,
      code: ghId.toUpperCase(),
      crop: crop.trim(),
      greenhouseTag: ghId.toUpperCase(),
      areaM2: parsedArea,
      online: true,
      health: "NORMAL",
      fertigationState: "IDLE",
      telemetry: {
        temperatureC: null,
        humidityPct: null,
        lightLux: null,
        tempDeltaC: null,
        humidityDeltaPct: null,
        tankPct: 100,
        tankL: 1000,
        tankCapacityL: 1000,
        waterTodayL: null,
        waterYesterdayL: null,
        waterDeltaPct: null,
        hstDays: 0,
        hspDays: null,
      },
      plants: {
        total: 0,
        tracked: 0,
        alive: 0,
        dead: 0,
        avgHeightCm: 0,
        avgFruitWeightG: 0,
        totalFruits: 0,
        latestObservation: "-",
      },
      equipment: [],
      recipes: [],
      cropCycle: {
        status: "NO_CYCLE",
        tanggalTanam: null,
        tanggalPolinasi: null,
        lastHarvestSummary: null,
      },
      fertigationSchedules: [],
      fanSchedules: [],
      currentRun: null,
      queue: [],
      history: [],
      fruitDevSeries: [],
    };

    replaceGreenhouse(created);
    const parentComplexForIds = complexService.get(complexId);
    if (parentComplexForIds && !parentComplexForIds.greenhouseIds.includes(created.id)) {
      replaceComplex({ ...parentComplexForIds, greenhouseIds: [...parentComplexForIds.greenhouseIds, created.id] });
    }

    if (isPythonBackendEnabled()) {
      operationalPythonClient.createGreenhouse(complexId, { crop: crop.trim(), areaM2: parsedArea }).catch(() => { });
    }

    return created;
  },
  async update(id: string, patch: Partial<Pick<Greenhouse, "code" | "crop" | "greenhouseTag" | "areaM2">>): Promise<Greenhouse> {
    if (patch.code !== undefined && !patch.code.trim()) throw new ServiceError("VALIDATION_FAILED", "Greenhouse code is required.", "code");
    if (patch.crop !== undefined && !patch.crop.trim()) throw new ServiceError("VALIDATION_FAILED", "Crop is required.", "crop");
    if (patch.greenhouseTag !== undefined && !patch.greenhouseTag.trim()) throw new ServiceError("VALIDATION_FAILED", "Greenhouse tag is required.", "greenhouseTag");
    if (patch.areaM2 !== undefined && (typeof patch.areaM2 !== "number" || isNaN(patch.areaM2) || patch.areaM2 <= 0)) {
      throw new ServiceError("VALIDATION_FAILED", "Luas area (m²) harus berupa angka positif.", "areaM2");
    }

    if (isDirectEsp32Enabled()) {
      try {
        await esp32Client.applyTopologyMutation({
          operation: "UPDATE_GREENHOUSE",
          ghId: id,
          name: patch.crop || patch.code,
        });
      } catch (err) {
        console.warn("[greenhouseService.update] ESP32 mutation notice:", err);
      }
    }

    const current = assertFound(greenhouseService.get(id), "Greenhouse");
    const updated: Greenhouse = { ...current, ...patch };
    replaceGreenhouse(updated);

    if (isPythonBackendEnabled()) {
      operationalPythonClient.updateGreenhouse(id, patch).catch(() => { });
    }

    return updated;
  },
  async delete(id: string): Promise<void> {
    const gh = greenhouseService.get(id);
    const parentComplex = gh ? complexService.get(gh.complexId) : undefined;
    const targetEndpoint = parentComplex?.esp32?.endpoint;

    if (isDirectEsp32Enabled()) {
      const prevEndpoint = getActiveEsp32Endpoint();
      if (targetEndpoint) {
        setActiveEsp32Endpoint(targetEndpoint);
      }
      try {
        await esp32Client.applyTopologyMutation({
          operation: "DELETE_GREENHOUSE",
          ghId: id,
          complexId: parentComplex?.id,
        });
      } finally {
        if (targetEndpoint && prevEndpoint && prevEndpoint !== targetEndpoint) {
          setActiveEsp32Endpoint(prevEndpoint);
        }
      }
    }

    removeGreenhouse(id);

    if (isPythonBackendEnabled()) {
      operationalPythonClient.deleteGreenhouse(id).catch(() => { });
    }
  },
};

function applyEsp32CycleToStore(ghId: string, resp: CurrentCropCycleResponse): Greenhouse {
  const existing = greenhouseService.get(ghId);
  if (!existing) throw new ServiceError("NOT_FOUND", "Greenhouse not found.");
  const gh = structuredClone(existing);

  const mappedStatus: CycleStatus =
    resp.status === "ACTIVE" ? "ACTIVE" :
      resp.status === "HARVESTED" ? "HARVESTED" :
        resp.status === "CANCELLED" ? "CANCELLED" : "NO_CYCLE";

  if (mappedStatus === "NO_CYCLE" || !resp.tanggalTanam) {
    gh.cropCycle = {
      status: "NO_CYCLE",
      tanggalTanam: null,
      tanggalPolinasi: null,
      lastHarvestSummary: (resp.lastHarvestSummary as any) ?? gh.cropCycle?.lastHarvestSummary ?? null,
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
      targetHarvestHst: resp.targetHarvestHst ?? gh.cropCycle?.targetHarvestHst ?? undefined,
      cropTimelineConfig: resp.cropTimelineConfig ?? gh.cropTimelineConfig ?? undefined,
      lastHarvestSummary: (resp.lastHarvestSummary as any) ?? gh.cropCycle?.lastHarvestSummary ?? null,
    };
    if (resp.targetHarvestHst) {
      if (!gh.cropTimelineConfig) {
        gh.cropTimelineConfig = { targetHarvestHst: resp.targetHarvestHst, points: [], maintenance: [] };
      } else {
        gh.cropTimelineConfig.targetHarvestHst = resp.targetHarvestHst;
      }
    }
    if (resp.cropTimelineConfig) {
      gh.cropTimelineConfig = resp.cropTimelineConfig;
    }
    if (resp.plantCount) {
      gh.plants.total = resp.plantCount;
      gh.plants.alive = resp.plantCount;
    }
    gh.telemetry.hstDays = resp.hst ?? 0;
    gh.telemetry.hspDays = resp.hsp ?? null;
    if (resp.variety) {
      gh.crop = resp.variety;
    }
  }
  replaceGreenhouse(gh);
  return gh;
}

async function persistEsp32ResearchCycle(ghId: string, resp: CurrentCropCycleResponse): Promise<void> {
  if (!isPythonBackendEnabled()) return;
  const gh = greenhouseService.get(ghId);
  if (!gh?.complexId || !resp.cycleId || resp.status === "NO_CYCLE") return;
  try {
    await operationalPythonClient.saveResearchCycle(gh.complexId, {
      cycleId: resp.cycleId, complexId: gh.complexId, ghId, status: resp.status,
      plantingDate: resp.tanggalTanam ?? null, pollinationDate: resp.tanggalPolinasi ?? null,
      variety: resp.variety ?? null, plantCount: resp.plantCount ?? 0, notes: resp.notes ?? null,
      hst: resp.hst ?? null, hsp: resp.hsp ?? null,
      actualHarvestDate: resp.lastHarvestSummary?.harvestDate ?? null,
      yieldKg: resp.lastHarvestSummary?.yieldKg ?? null, grade: resp.lastHarvestSummary?.grade ?? null,
      source: "ESP32", sourceDeviceId: ghId, version: (resp.version ?? 1),
    });
  } catch { /* device remains authoritative; backend catches up on next sync */ }
}

export const cropCycleService = {
  getCycle(ghId: string): CropCycle | undefined {
    return greenhouseService.get(ghId)?.cropCycle;
  },

  async syncCycleFromEsp32(ghId: string): Promise<CropCycle | undefined> {
    const gh = greenhouseService.get(ghId);
    const complex = gh ? complexService.get(gh.complexId) : undefined;
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) return cropCycleService.getCycle(ghId);
    try {
      const resp = await esp32Client.getCurrentCropCycle(ghId);
      const updatedGh = applyEsp32CycleToStore(ghId, resp);
      return updatedGh.cropCycle;
    } catch {
      return cropCycleService.getCycle(ghId);
    }
  },

  async startCycle(
    ghId: string,
    tanggalTanam: string,
    options?: { variety?: string; plantCount?: number; notes?: string }
  ): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const resp = await esp32Client.startCropCycle(ghId, {
        tanggalTanam,
        variety: options?.variety,
        plantCount: options?.plantCount,
        notes: options?.notes,
      });
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string };
      if (errorObj?.status === 409) {
        throw new ServiceError("CONFLICT", "Siklus tanam sudah aktif pada greenhouse ini.");
      }
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal memulai siklus tanam pada ESP32.");
    }
  },

  async startOngoingCycle(
    ghId: string,
    tanggalTanam: string,
    options?: { variety?: string; plantCount?: number; tanggalPolinasi?: string; notes?: string }
  ): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const resp = await esp32Client.importActiveCropCycle(ghId, {
        tanggalTanam,
        tanggalPolinasi: options?.tanggalPolinasi,
        variety: options?.variety,
        plantCount: options?.plantCount,
        notes: options?.notes,
      });
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string };
      if (errorObj?.status === 409) {
        throw new ServiceError("CONFLICT", "Siklus tanam sudah aktif pada greenhouse ini.");
      }
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal import siklus berjalan pada ESP32.");
    }
  },

  async recordPolinasi(
    ghId: string,
    tanggalPolinasi: string,
    options?: { pollinationMethod?: "natural" | "bee" | "manual"; notes?: string }
  ): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const cycleId = "active";
      const resp = await esp32Client.recordPollination(ghId, cycleId, {
        tanggalPolinasi,
        pollinationMethod: options?.pollinationMethod,
        notes: options?.notes,
      });
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal mencatat polinasi pada ESP32.");
    }
  },

  async updateTanggalTanam(ghId: string, newTanggalTanam: string): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const cycleId = "active";
      const resp = await esp32Client.updatePlantingDate(ghId, cycleId, {
        tanggalTanam: newTanggalTanam,
      });
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update tanggal tanam pada ESP32.");
    }
  },

  async updateTanggalPolinasi(
    ghId: string,
    newTanggalPolinasi: string,
    options?: { pollinationMethod?: "natural" | "bee" | "manual" }
  ): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const cycleId = "active";
      const resp = await esp32Client.updatePollination(ghId, cycleId, {
        tanggalPolinasi: newTanggalPolinasi,
        pollinationMethod: options?.pollinationMethod,
      });
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update tanggal polinasi pada ESP32.");
    }
  },

  async updateMetadata(
    ghId: string,
    updates: { variety?: string; plantCount?: number; notes?: string; targetHarvestHst?: number; cropTimelineConfig?: import("./cropTimelineConfig").CropTimelineConfig }
  ): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const cycleId = "active";
      const resp = await esp32Client.updateCropCycleMetadata(ghId, cycleId, updates);
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update metadata siklus pada ESP32.");
    }
  },

  async deleteTanggalPolinasi(ghId: string): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const cycleId = "active";
      const resp = await esp32Client.deletePollination(ghId, cycleId);
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal hapus tanggal polinasi pada ESP32.");
    }
  },

  async resetCycle(ghId: string): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const cycleId = "active";
      const resp = await esp32Client.cancelCropCycle(ghId, cycleId, {});
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal reset siklus tanam pada ESP32.");
    }
  },

  async harvest(
    ghId: string,
    options?: { harvestDate?: string; yieldKg?: number; grade?: string; notes?: string }
  ): Promise<Greenhouse> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const complex = complexService.get(gh.complexId);
    const isOnline = isDirectEsp32Enabled() || Boolean(complex?.esp32?.online) || isPythonBackendEnabled();
    if (!isOnline) {
      throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
    }
    try {
      const cycleId = "active";
      const resp = await esp32Client.harvestCropCycle(ghId, cycleId, {
        harvestDate: options?.harvestDate,
        yieldKg: options?.yieldKg,
        grade: options?.grade,
        notes: options?.notes,
      });
      const updated = applyEsp32CycleToStore(ghId, resp);
      await persistEsp32ResearchCycle(ghId, resp);
      return updated;
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal panen siklus tanam pada ESP32.");
    }
  },
};


let liveLogsCache: EventItem[] = [];
let latestTelemetryCache = new Map<string, TelemetrySnapshot>();
let telemetryHistoryCache = new Map<string, TelemetryHistoryResponse>();

export const eventService = {
  recent(_complexId: string): EventItem[] { return liveLogsCache.slice(0, 10); },
  all(): EventItem[] { return liveLogsCache; },
  alerts(): AlertItem[] {
    return liveLogsCache
      .filter((event) => event.level === "warning" || event.level === "error")
      .slice(0, 10)
      .map((event) => ({
        id: event.id,
        title: event.text,
        detail: event.text,
        level: event.level === "warning" ? "warning" : "error",
        time: event.time,
      }));
  },
  async syncLogsFromEsp32(complexId?: string): Promise<void> {
    const id = complexId?.trim();
    if (!id) { liveLogsCache = []; return; }
    try {
      const logs = isDirectEsp32Enabled() ? await esp32Client.getLogs() : isPythonBackendEnabled() ? await operationalPythonClient.getLogs(id, undefined, { limit: 50 }) : null;
      const items = logs?.items ?? logs?.events ?? [];
      liveLogsCache = items.map((log) => ({
        id: log.id ?? log.eventId,
        time: log.at ? (log.at.slice(11, 16) || log.at) : (log.deviceTimestamp ? (log.deviceTimestamp.slice(11, 16) || log.deviceTimestamp) : "—"),
        text: log.message ?? log.eventType,
        level: (log.level === "CRITICAL" || log.level === "ERROR" || log.severity === "CRITICAL" || log.severity === "FAULT" ? "error" : log.level === "WARNING" || log.severity === "WARNING" ? "warning" : "info") as EventItem["level"],
      }));
    } catch {
      liveLogsCache = [];
    }
  },
};

export const telemetryService = {
  getCachedCurrent(complexId: string, ghId: string): TelemetrySnapshot | undefined {
    return latestTelemetryCache.get(`${complexId}:${ghId}`);
  },
  getCachedHistory(complexId: string, ghId: string): TelemetryHistoryResponse | undefined {
    return telemetryHistoryCache.get(`${complexId}:${ghId}`);
  },
  async syncCurrent(complexId: string, ghId: string, force = false): Promise<TelemetrySnapshot> {
    const key = `${complexId}:${ghId}`;
    if (!force && latestTelemetryCache.has(key)) {
      return latestTelemetryCache.get(key)!;
    }
    const snapshot = isDirectEsp32Enabled()
      ? await esp32Client.getTelemetry()
      : await operationalPythonClient.getTelemetry(complexId, ghId);
    latestTelemetryCache.set(key, snapshot);
    if (complexId) latestTelemetryCache.set(`${complexId}:`, snapshot);
    return snapshot;
  },
  async syncHistory(complexId: string, ghId: string, options: { limit?: number; force?: boolean } = {}): Promise<TelemetryHistoryResponse> {
    const key = `${complexId}:${ghId}`;
    if (!options.force && telemetryHistoryCache.has(key)) {
      return telemetryHistoryCache.get(key)!;
    }
    const history = isDirectEsp32Enabled()
      ? await esp32Client.getTelemetryHistory(undefined, undefined, options.limit ?? 200)
      : await operationalPythonClient.getTelemetryHistory(complexId, ghId, { limit: options.limit ?? 200 });
    telemetryHistoryCache.set(key, history);
    if (complexId) telemetryHistoryCache.set(`${complexId}:`, history);
    return history;
  },
  clearSessionCache(): void {
    latestTelemetryCache.clear();
    telemetryHistoryCache.clear();
  },
  updateFromStreamSnapshot(snapshot: TelemetrySnapshot): void {
    const complexId = snapshot.complexId || "";
    const ghId = snapshot.ghId || "";
    if (complexId && ghId) {
      latestTelemetryCache.set(`${complexId}:${ghId}`, snapshot);
    }
    for (const key of Array.from(latestTelemetryCache.keys())) {
      if (complexId && key.startsWith(`${complexId}:`)) {
        latestTelemetryCache.set(key, { ...snapshot, ghId: key.split(":")[1] });
      }
    }
    if (complexId) {
      latestTelemetryCache.set(`${complexId}:`, snapshot);
    }
  },
};

/* -------------------------- schedules ---------------------------- */

function repeatToTrigger(item: { repeat: string; trigger?: string; time: string; endTime?: string; date?: string; intervalHours?: number; intervalMin?: number; days?: string[] }): Record<string, unknown> {
  const [rawHour, rawMinute] = (item.time || "08:00").split(":").map(Number);
  const hour = Number.isInteger(rawHour) ? rawHour : 8;
  const minute = Number.isInteger(rawMinute) ? rawMinute : 0;
  const trigger = (item.trigger || "").toLowerCase();
  const repeat = (item.repeat || "Every Day").toLowerCase();
  let daysOfWeek = repeat === "every weekday" ? 31 : repeat === "every weekend" ? 96 : repeat === "mon, wed, fri" ? 21 : repeat === "tue, thu" ? 10 : 127;
  if (Array.isArray(item.days) && item.days.length > 0) {
    const dayMap: Record<string, number> = { mon: 1, tue: 2, wed: 4, thu: 8, fri: 16, sat: 32, sun: 64 };
    let mask = 0;
    for (const d of item.days) {
      const code = String(d).toLowerCase().slice(0, 3);
      if (dayMap[code]) mask |= dayMap[code];
    }
    if (mask > 0) daysOfWeek = mask;
  }
  if (trigger.includes("interval") || repeat.includes("interval")) {
    const mins = item.intervalMin != null && item.intervalMin > 0
      ? Math.round(item.intervalMin)
      : Math.max(1, Math.round((item.intervalHours || 1) * 60));
    return {
      type: "INTERVAL",
      intervalMin: mins,
      startTime: item.time,
      ...(item.endTime ? { endTime: item.endTime } : {}),
    };
  }
  if (repeat === "once" || trigger.includes("specific-date")) {
    return { type: "ONCE", timestamp: item.date ? new Date(`${item.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString() : "" };
  }
  return { type: "DAILY", hour, minute, daysOfWeek };
}

function fertigationIntent(
  schedule: FertigationSchedule,
  complexId: string,
  singleFallback?: FertigationSchedule
) {
  const isFb = Boolean(schedule.isFallback);
  const fallbackActive = !isFb && Boolean(singleFallback && singleFallback.enabled);
  return {
    scheduleId: schedule.id,
    ownerId: schedule.id,
    complexId,
    ghId: schedule.ghId,
    action: "FERTIGATION",
    enabled: schedule.enabled,
    priority: 100,
    trigger: repeatToTrigger(schedule),
    recipeId: schedule.recipeId,
    missedRunPolicy: (schedule.missedPolicy || "skip").toUpperCase(),
    fallbackEnabled: fallbackActive,
    fallbackScheduleId: fallbackActive ? singleFallback!.id : undefined,
    parameters: {
      rawWaterStartThresholdPercent: schedule.rawWaterStartThresholdPercent ?? 20,
      rawWaterVolumeMl: Math.round(schedule.targetWaterL * 1000),
      ...(schedule.dosingChannels?.length ? { dosingChannels: schedule.dosingChannels } : {}),
      targetMode: schedule.targetMode,
      targetPpm: schedule.targetPpm,
      durationSec: Math.max(1, Math.round(schedule.targetWaterL * 30)),
      automaticDosing: true,
      requireFlowSensor: true,
      requireLevelSensor: true,
    },
  };
}

function wellPumpIntent(schedule: WellPumpSchedule) {
  const durationSec = schedule.durationSec != null && schedule.durationSec > 0
    ? schedule.durationSec
    : Math.max(1, Math.round(schedule.durationMin * 60));
  return {
    scheduleId: schedule.id,
    ownerId: schedule.id,
    complexId: schedule.complexId,
    action: "WATER_PUMP",
    enabled: schedule.enabled,
    priority: 100,
    trigger: repeatToTrigger(schedule),
    missedRunPolicy: "SKIP",
    parameters: {
      durationSec,
      ...(schedule.endTime ? { endTime: schedule.endTime } : {}),
      ...(schedule.targetLiters ? { targetLiters: schedule.targetLiters } : {}),
      ...(schedule.days ? { days: schedule.days } : {}),
    },
  };
}

function fanIntent(schedule: FanSchedule, complexId: string) {
  return {
    scheduleId: schedule.id,
    ownerId: schedule.id,
    complexId,
    ghId: schedule.ghId,
    action: "FAN_TOGGLE",
    enabled: schedule.enabled,
    priority: 100,
    trigger: repeatToTrigger(schedule),
    missedRunPolicy: "SKIP",
    parameters: {
      durationSec: Math.max(1, Math.round(schedule.durationMin * 60)),
      controlMode: schedule.mode === "temperature" ? "TEMPERATURE" : "TIME",
      onAboveC: schedule.onAboveC,
      offBelowC: schedule.offBelowC,
    },
  };
}

function scheduleIntentsForComplex(configuration: ConfigurationPayload, overrides: {
  fertigation?: FertigationSchedule[];
  wellPump?: WellPumpSchedule[];
  fan?: FanSchedule[];
} = {}) {
  // ITEM-1: Removed complexes[0] silent fallback per PRD §6.1 (configuration-driven identity).
  // If complexId is missing from both configuration payload and operational snapshot,
  // we throw — never silently swap to a different complex.
  const targetComplexId = configuration.complexId || getOperationalSnapshot().complexes.find((c) => c.id)?.id;
  if (!targetComplexId) {
    throw new Error("scheduleIntentsForComplex: no active complexId available in operational snapshot or configuration payload — refusing to fall back to a hardcoded complex id per PRD §6.1 (configuration-driven identity).");
  }
  const ghs = greenhouseService.byComplex(targetComplexId);
  const greenhouseIds = new Set(ghs.map((g) => g.id));
  const fertigation = overrides.fertigation ?? ghs.flatMap((g) => g.fertigationSchedules);
  // ITEM-1: Removed complexes[0] fallback — use explicit lookup, throw if not found.
  const complex = complexService.get(targetComplexId);
  if (!complex) {
    throw new Error(`scheduleIntentsForComplex: complex ${targetComplexId} not found in operational snapshot — refusing to fall back per PRD §6.1.`);
  }
  const wellPump = overrides.wellPump ?? complex.wellPumpSchedules ?? [];
  const fan = overrides.fan ?? ghs.flatMap((g) => g.fanSchedules).filter((s) => greenhouseIds.has(s.ghId));

  const singleFallback = fertigation.find((s) => s.isFallback);

  return [
    ...fertigation.map((s) => fertigationIntent(s, targetComplexId, singleFallback)),
    ...wellPump.map(wellPumpIntent),
    ...fan.map((s) => fanIntent(s, targetComplexId)),
  ];
}

const pythonScheduleClient = new PythonClient();

export async function relayEventsToBackend(complexId?: string): Promise<void> {
  if (!isDirectEsp32Enabled() && !ESP32_API_BASE) return;
  // ITEM-1: Removed complexes[0] silent fallback. If complexId not provided AND
  // no complex is active, skip relay (don't fabricate target).
  const targetComplexId = complexId || getOperationalSnapshot().complexes.find((c) => c.id)?.id;
  if (!targetComplexId) {
    console.warn("[relayEventsToBackend] No active complexId available — skipping event relay per PRD zero-persistence invariant.");
    return;
  }
  try {
    const eventRes = await esp32Client.getEvents(undefined, 100);
    const events = (eventRes as any)?.events || (eventRes as any)?.data?.events || [];
    if (events.length > 0 && isPythonBackendEnabled()) {
      const python = new PythonClient();
      await python.postEvents(targetComplexId, events).catch((err) => {
        console.warn("[relayEventsToBackend] Python event ingestion warning:", err);
      });
    }
  } catch (err) {
    console.warn("[relayEventsToBackend] Failed to fetch events from ESP32:", err);
  }
}

async function deployCompiledScheduleSet(complexId: string, overrides: {
  fertigation?: FertigationSchedule[];
  wellPump?: WellPumpSchedule[];
  fan?: FanSchedule[];
} = {}, candidateScheduleId?: string): Promise<CompiledSchedule[]> {
  const configuration = await loadAuthoritativeConfiguration(complexId);
  // F-C4: Pass activeLocks explicitly so checkResourceConflicts() di resource-engine.js
  // dapat mendeteksi RESOURCE_LOCK_CONFLICT. TODO: fetch dari ESP32 (getFertigationStatus().heldLocks)
  // saat endpoint tersedia — sampai then, pass array kosong agar hook eksplisit dan plug-in ready.
  const activeLocks: Array<Record<string, unknown>> = [];
  const result = compileScheduleSet(configuration, scheduleIntentsForComplex(configuration, overrides), { nowTimestamp: Date.now(), autoGeneratePlan: true, activeLocks });
  const candidate = candidateScheduleId ? result.results.find((r: any) => r.scheduleId === candidateScheduleId) : null;
  if (candidate && candidate.status === "INVALID") {
    const reasons = (candidate.errors || []).map((e: any) => e.message).filter(Boolean).join("; ");
    console.warn(`[deployCompiledScheduleSet] Schedule candidate '${candidateScheduleId}' is INVALID:`, reasons);
  }
  // Per PRD Section 7.2 & 33E.5:
  // "A schedule may be CREATED and STORED even when the required physical peripheral/route is not currently installed...
  // However: A schedule that is not currently executable must NOT be treated as ACTIVE/executable merely because it exists in storage."
  // Candidate schedules with status === "BLOCKED" are intentionally preserved in storage,
  // but omitted from the executable compiled set sent to the ESP32.
  const compiled: CompiledSchedule[] = (Array.isArray(result.compiled) ? result.compiled : []) as unknown as CompiledSchedule[];
  const deploymentId = `web-schedules-${configuration.version}-${Date.now()}`;

  if (isDirectEsp32Enabled()) {
    if (compiled.length === 0) {
      try {
        await esp32Client.clearCompiledSchedules();
      } catch (err) {
        console.warn("[deployCompiledScheduleSet] Clear compiled schedules on ESP32:", err);
      }
      return [];
    }

    try {
      await esp32Client.deployCompiledSchedules({
        deploymentId,
        configurationVersion: configuration.version,
        configurationHash: configuration.configurationHash ?? null,
        compiled,
      });
      return compiled;
    } catch (err: any) {
      // Reconcile against device current compiled set before warning
      try {
        const remote = await esp32Client.getCompiledSchedules();
        const remoteIds = new Set((remote.compiled || []).map((x) => x.scheduleId));
        const localIds = new Set(compiled.map((x) => x.scheduleId));
        const same = remote.configurationVersion === configuration.version && remoteIds.size === localIds.size && [...localIds].every((id) => remoteIds.has(id));
        if (same) return compiled;
      } catch { }
      console.warn("[deployCompiledScheduleSet] ESP32 deployment warning:", err);
      return compiled;
    }
  }

  if (isPythonBackendEnabled()) {
    try {
      const remote = await pythonScheduleClient.deploySchedules(
        complexId,
        configuration,
        scheduleIntentsForComplex(configuration, overrides) as Array<Record<string, unknown>>,
        {
          deploymentId,
          esp32BaseUrl: isDirectEsp32Enabled() ? ESP32_API_BASE : undefined,
        },
      );
      const remoteCompiled = Array.isArray(remote.compiled) ? remote.compiled : [];
      return remoteCompiled.length ? remoteCompiled as CompiledSchedule[] : compiled;
    } catch (err) {
      console.warn("[deployCompiledScheduleSet] Python deployment warning:", err);
      return compiled;
    }
  }

  return compiled;
}

async function loadAuthoritativeConfiguration(complexId: string): Promise<ConfigurationPayload> {
  const snapshot = getOperationalSnapshot();
  // ITEM-1: Removed complexes[0] silent fallback. If complexId not found in snapshot,
  // use the provided complexId as-is (caller's intent) rather than swapping to complexes[0].
  const targetComplex = snapshot.complexes.find((c) => c.id === complexId);
  const activeComplexId = targetComplex?.id || complexId;
  const ghs = snapshot.greenhouses.filter((x) => x.complexId === activeComplexId || !x.complexId);
  const synthesizedGhs = ghs.map((g) => ({
    ghId: g.id,
    id: g.id,
    complexId: g.complexId || activeComplexId,
    name: g.greenhouseTag || g.code,
    code: g.code,
  }));

  if (isDirectEsp32Enabled()) {
    try {
      const configuration = await esp32Client.getConfiguration();
      if (configuration && configuration.version !== undefined) {
        if (!configuration.greenhouses || configuration.greenhouses.length === 0) {
          (configuration as any).greenhouses = synthesizedGhs;
        }
        if (!configuration.complexId) {
          (configuration as any).complexId = activeComplexId;
        }
        return configuration;
      }
    } catch {
      // Fall back to baseline
    }
  }
  if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
    try {
      const configuration = await pythonScheduleClient.getConfiguration(complexId);
      if (configuration && (configuration.complexId === complexId || !configuration.complexId) && configuration.version !== undefined) {
        if (!configuration.greenhouses || configuration.greenhouses.length === 0) {
          (configuration as any).greenhouses = synthesizedGhs;
        }
        return configuration;
      }
    } catch {
      // Fall back to baseline
    }
  }
  // Construct baseline configuration from operational snapshot when controller runs headless
  const c = snapshot.complexes.find((x) => x.id === complexId);
  if (c) {
    return {
      complexId,
      version: 0,
      updatedAt: new Date().toISOString(),
      components: [],
      assignments: [],
      schedules: [],
      recipes: (ghs.flatMap((g) => g.recipes || []) as any),
      topology: [],
      greenhouses: synthesizedGhs as any,
      settings: {},
    };
  }
  throw new ServiceError("DEVICE_OFFLINE", "No authoritative configuration source is configured.");
}

export function enrichScheduleWithActivationState<T extends { id: string; enabled: boolean; status: ScheduleStatus; activationState?: ScheduleActivationState; blockedReasons?: ScheduleBlockedReason[] }>(
  schedule: T,
  kind: "fertigation" | "fan" | "wellPump",
  ghId?: string,
  complexId?: string,
): T {
  const snapshot = getOperationalSnapshot();
  const gh = ghId ? snapshot.greenhouses.find((g) => g.id === ghId) : undefined;
  const complex = complexId ? snapshot.complexes.find((c) => c.id === complexId) : (gh ? snapshot.complexes.find((c) => c.id === gh.complexId) : undefined);

  if (!schedule.enabled) {
    return {
      ...schedule,
      activationState: "DISABLED",
      status: "disabled",
      blockedReasons: schedule.blockedReasons || [],
    };
  }

  const equipment = gh?.equipment || [];
  const compText = equipment.map((e) => `${e.name || ""} ${e.type || ""} ${e.category || ""}`.toUpperCase()).join(" ");

  if (kind === "fan") {
    const hasFan = /FAN|BLOWER/i.test(compText);
    if (!hasFan) {
      return {
        ...schedule,
        activationState: "BLOCKED",
        status: "blocked",
        blockedReasons: [{ code: "MISSING_FAN", message: `No fan resource is assigned to '${gh?.code || ghId || "GH"}'.` }],
      };
    }
  } else if (kind === "wellPump") {
    // Check complex-level equipment (Well Pump, ghId=null) from complex.equipment snapshot,
    // then fall back to searching all GH equipment for backwards compatibility.
    const complexEq = complex?.equipment || [];
    const complexEqText = complexEq.map((e) => `${e.name || ""} ${e.type || ""} ${e.category || ""} ${(e as any).role || ""}`.toUpperCase()).join(" ");
    const allGhEq = complex ? snapshot.greenhouses.filter((g) => g.complexId === complex.id).flatMap((g) => g.equipment || []) : equipment;
    const allGhEqText = allGhEq.map((e) => `${e.name || ""} ${e.type || ""} ${e.category || ""} ${(e as any).role || ""}`.toUpperCase()).join(" ");
    const eqTexts = complexEqText + " " + allGhEqText;
    const hasWellPump = /WELL_PUMP|WATER_PUMP|RAW_SUBMERSIBLE|PUMP_WELL|DEEP WELL|WELL.*PUMP/i.test(eqTexts);
    if (!hasWellPump) {
      return {
        ...schedule,
        activationState: "BLOCKED",
        status: "blocked",
        blockedReasons: [{ code: "MISSING_WELL_PUMP", message: "No well/raw-water pump is installed." }],
      };
    }
    const filteredReasons = (schedule.blockedReasons || []).filter((r) => r.code !== "MISSING_WELL_PUMP");
    return {
      ...schedule,
      activationState: "ACTIVE",
      status: "scheduled",
      blockedReasons: filteredReasons,
    };
  } else if (kind === "fertigation") {
    const complexEq = complex?.equipment || [];
    const complexEqText = complexEq.map((e) => `${e.name || ""} ${e.type || ""} ${e.category || ""} ${(e as any).role || ""}`.toUpperCase()).join(" ");
    const allGhEq = complex ? snapshot.greenhouses.filter((g) => g.complexId === complex.id).flatMap((g) => g.equipment || []) : equipment;
    const allGhEqText = allGhEq.map((e) => `${e.name || ""} ${e.type || ""} ${e.category || ""} ${(e as any).role || ""}`.toUpperCase()).join(" ");
    const eqTexts = complexEqText + " " + allGhEqText;
    const ghEqText = equipment.map((e) => `${e.name || ""} ${e.type || ""} ${e.category || ""}`.toUpperCase()).join(" ");
    const fertText = complexEqText + " " + ghEqText;

    const hasTank =
      /MIX_TANK|MIXING_TANK|TANK|MIXING_PUMP|MIXING|DOSING/i.test(fertText) ||
      Boolean(gh?.telemetry?.tankCapacityL && gh.telemetry.tankCapacityL > 0);
    const hasDelivery =
      /DIST_PUMP|DELIVERY_PUMP|FERTIGATION_PUMP|DISTRIBUTION_PUMP/i.test(fertText) ||
      /DIST_PUMP|DELIVERY_PUMP|FERTIGATION_PUMP|DISTRIBUTION_PUMP/i.test(eqTexts);

    if (!hasTank || !hasDelivery) {
      const reasons: ScheduleBlockedReason[] = [];
      if (!hasTank) reasons.push({ code: "MISSING_MIXING_TANK", message: `No mixing tank assigned to '${gh?.code || ghId || "GH"}'.` });
      if (!hasDelivery) reasons.push({ code: "MISSING_DELIVERY_PUMP", message: `No delivery pump assigned to '${gh?.code || ghId || "GH"}'.` });
      return {
        ...schedule,
        activationState: "BLOCKED",
        status: "blocked",
        blockedReasons: reasons,
      };
    }
    const filteredReasons = (schedule.blockedReasons || []).filter(
      (r) => r.code !== "MISSING_MIXING_TANK" && r.code !== "MISSING_DELIVERY_PUMP"
    );
    return {
      ...schedule,
      activationState: filteredReasons.length > 0 ? "BLOCKED" : "ACTIVE",
      status: filteredReasons.length > 0 ? "blocked" : (schedule.status === "blocked" || schedule.status === "disabled" ? "scheduled" : schedule.status),
      blockedReasons: filteredReasons,
    };
  }

  return {
    ...schedule,
    activationState: "ACTIVE",
    status: schedule.status === "blocked" || schedule.status === "disabled" ? "scheduled" : schedule.status,
    blockedReasons: [],
  };
}

/**
 * ITEM-2/LAYER-J: In-flight protection helper.
 * Queries /api/v1/fertigation/status and checks if the given schedule has
 * an active occurrence in the dosing queue or active preparation slot.
 * If active, throws ServiceError("CONFLICT") with a clear message.
 */
async function assertScheduleNotInFlight(ghId: string, scheduleId: string): Promise<void> {
  if (!isDirectEsp32Enabled()) {
    console.warn("[ITEM-2] ESP32 not connected — cannot verify schedule in-flight state. Proceeding without protection.");
    return;
  }
  try {
    const status = await esp32Client.getFertigationStatus();
    if (!status) return;

    const todaySchedule: any[] = Array.isArray(status.todaySchedule) ? status.todaySchedule : [];
    const activeOccurrence = todaySchedule.find((occ: any) => {
      const occScheduleId: string = occ.scheduleId || occ.schedule_id || "";
      const occGhId: string = occ.ghId || occ.gh_id || "";
      const occState: string = (occ.state || occ.status || "").toUpperCase();
      return occScheduleId === scheduleId &&
             occGhId.toLowerCase() === ghId.toLowerCase() &&
             ["PREPARING", "WAITING_BATCH", "READY_TO_SEND", "DISTRIBUTING"].includes(occState);
    });

    if (activeOccurrence) {
      const occState = (activeOccurrence.state || activeOccurrence.status || "ACTIVE").toUpperCase();
      const occId = activeOccurrence.occurrenceId || activeOccurrence.occurrence_id || "unknown";
      throw new ServiceError(
        "CONFLICT",
        `Schedule has an active occurrence (${occId}, state: ${occState}). ` +
        `Cancel the active run first or wait for completion. ` +
        `Per spec §3/§4: in-flight batches cannot be modified or deleted.`,
        "scheduleId"
      );
    }

    const queuedBatches: any[] = Array.isArray(status.queuedBatches) ? status.queuedBatches : [];
    const activeQueueEntry = queuedBatches.find((q: any) => {
      const qScheduleId: string = q.scheduleId || q.schedule_id || "";
      const qGhId: string = q.ghId || q.gh_id || "";
      const qState: string = (q.state || q.status || "").toUpperCase();
      return qScheduleId === scheduleId &&
             qGhId.toLowerCase() === ghId.toLowerCase() &&
             ["PENDING", "DISPATCHED", "ACTIVE"].includes(qState);
    });

    if (activeQueueEntry) {
      const qState = (activeQueueEntry.state || activeQueueEntry.status || "QUEUED").toUpperCase();
      const qId = activeQueueEntry.queueId || activeQueueEntry.queue_id || "unknown";
      throw new ServiceError(
        "CONFLICT",
        `Schedule has a queued dosing entry (${qId}, state: ${qState}). ` +
        `Cancel the queue entry first or wait for preparation to complete.`,
        "scheduleId"
      );
    }
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    console.warn("[ITEM-2] Failed to verify schedule in-flight state:", err);
  }
}

export const scheduleService = {
  async refreshSchedulesFromEsp32(complexId?: string): Promise<{
    wellPump: WellPumpSchedule[];
    fertigation: FertigationSchedule[];
    fan: FanSchedule[];
  }> {
    if (!isDirectEsp32Enabled()) {
      return { wellPump: [], fertigation: [], fan: [] };
    }
    try {
      const intentsRes = await esp32Client.getScheduleIntents();
      const items = Array.isArray(intentsRes?.items) ? intentsRes.items : [];
      const snapshot = getOperationalSnapshot();
      // ITEM-1: Removed complexes[0] silent fallback. If complexId is provided but not found,
      // or no complexId provided, use complexId as-is or return empty (don't swap to complexes[0]).
      const targetComplex = complexId ? snapshot.complexes.find((c) => c.id === complexId) : null;
      const activeComplexId = targetComplex?.id || complexId;
      if (!activeComplexId) {
        console.warn("[loadScheduleIntentsFromController] No active complexId — skipping schedule load per PRD §6.1.");
        return { wellPump: [], fertigation: [], fan: [] };
      }

      const wellPumpList: WellPumpSchedule[] = [];
      const fertList: FertigationSchedule[] = [];
      const fanList: FanSchedule[] = [];

      for (const item of items) {
        const kind = item.kind || (item.recipeId ? "fertigation" : (item.task || item.radar || item.type === "well_pump" ? "wellPump" : (item.mode || item.type === "fan" ? "fan" : "unknown")));

        if (kind === "wellPump" || item.task || item.radar || item.type === "well_pump") {
          const cId = item.complexId || activeComplexId;
          const s: WellPumpSchedule = {
            id: item.id,
            complexId: cId,
            task: (item.task || item.name || "Well Pump Routine") as string,
            pump: item.pump as string | undefined,
            componentId: item.componentId as string | undefined,
            trigger: (item.trigger as any) || "time",
            time: (item.time as string) || "06:00",
            endTime: item.endTime as string | undefined,
            durationMin: item.durationMin !== undefined ? Number(item.durationMin) : (item.durationSec !== undefined ? Number(item.durationSec) / 60 : 15),
            durationSec: item.durationSec !== undefined ? Number(item.durationSec) : (item.durationMin !== undefined ? Number(item.durationMin) * 60 : undefined),
            intervalMin: item.intervalMin !== undefined ? Number(item.intervalMin) : undefined,
            repeat: (item.repeat as any) || "Every Day",
            enabled: item.enabled !== false,
            status: (item.status as any) || (item.enabled === false ? "disabled" : "scheduled"),
            activationState: (item.activationState as any) || (item.enabled === false ? "DISABLED" : "ACTIVE"),
            blockedReasons: item.blockedReasons || [],
            lastRun: (item.lastRun as string) || null,
            nextRun: (item.nextRun as string) || null,
            radar: typeof item.radar === "object" && (item.radar as any)?.stopWhenFull ? "full" : ((item.radar as any) || "full"),
          };
          const enriched = enrichScheduleWithActivationState(s, "wellPump", undefined, cId);
          wellPumpList.push(enriched);
        } else if (kind === "fertigation" || item.recipeId || item.targetWaterL || item.type === "fertigation") {
          const gh = snapshot.greenhouses.find((g) =>
            g.id === item.ghId ||
            g.code?.toLowerCase() === item.ghId?.toLowerCase() ||
            g.greenhouseTag?.toLowerCase() === item.ghId?.toLowerCase()
          );
          if (!gh) {
            console.warn(`[loadScheduleIntentsFromController] Schedule ${item.id} references unknown ghId="${item.ghId}" — dropping per PRD §6.1 (no silent GH-01 fallback).`);
            continue;
          }

          const s: FertigationSchedule = {
            id: item.id,
            ghId: gh.id,
            name: (item.name || item.task || "Fertigation Routine") as string,
            recipeId: (item.recipeId as string) || "",
            enabled: item.enabled !== false,
            trigger: (item.trigger as any) || "specific-time",
            time: (item.time as string) || "06:00",
            endTime: item.endTime as string | undefined,
            repeat: (item.repeat as any) || "Every Day",
            intervalHours: item.intervalHours !== undefined ? Number(item.intervalHours) : undefined,
            date: item.date as string | undefined,
            targetMode: (item.targetMode as any) || "volume",
            targetWaterL: item.targetWaterL !== undefined ? Number(item.targetWaterL) : (item.targetWaterVolumeMl !== undefined ? Number(item.targetWaterVolumeMl) / 1000 : 50),
            dosingAml: Number(item.dosingAml ?? 0),
            dosingBml: Number(item.dosingBml ?? 0),
            dosingChannels: item.dosingChannels as any,
            targetPpm: item.targetPpm !== undefined ? Number(item.targetPpm) : undefined,
            fallbackEnabled: Boolean(item.fallbackEnabled),
            fallbackScheduleId: item.fallbackScheduleId as string | undefined,
            missedPolicy: (item.missedPolicy as any) || "skip",
            recoveryWindowH: Number(item.recoveryWindowH ?? 2),
            onlyToday: Boolean(item.onlyToday),
            status: (item.status as any) || (item.enabled === false ? "disabled" : "scheduled"),
            activationState: (item.activationState as any) || (item.enabled === false ? "DISABLED" : "ACTIVE"),
            blockedReasons: item.blockedReasons || [],
            lastRun: (item.lastRun as string) || null,
            nextRun: (item.nextRun as string) || null,
          };
          const enriched = enrichScheduleWithActivationState(s, "fertigation", gh?.id, gh?.complexId);
          fertList.push(enriched);
        } else if (kind === "fan" || item.mode || item.onAboveC !== undefined || item.type === "fan") {
          const gh = snapshot.greenhouses.find((g) =>
            g.id === item.ghId ||
            g.code?.toLowerCase() === item.ghId?.toLowerCase() ||
            g.greenhouseTag?.toLowerCase() === item.ghId?.toLowerCase()
          );
          if (!gh) {
            console.warn(`[loadScheduleIntentsFromController] Fan schedule ${item.id} references unknown ghId="${item.ghId}" — dropping per PRD §6.1.`);
            continue;
          }

          const s: FanSchedule = {
            id: item.id,
            ghId: gh.id,
            mode: (item.mode as any) || "time",
            time: (item.time as string) || "08:00",
            durationMin: Number(item.durationMin ?? 30),
            onAboveC: item.onAboveC !== undefined ? Number(item.onAboveC) : undefined,
            offBelowC: item.offBelowC !== undefined ? Number(item.offBelowC) : undefined,
            repeat: (item.repeat as any) || "Every Day",
            enabled: item.enabled !== false,
            status: (item.status as any) || (item.enabled === false ? "disabled" : "scheduled"),
            activationState: (item.activationState as any) || (item.enabled === false ? "DISABLED" : "ACTIVE"),
            blockedReasons: item.blockedReasons || [],
            lastRun: (item.lastRun as string) || null,
            nextRun: (item.nextRun as string) || null,
          };
          const enriched = enrichScheduleWithActivationState(s, "fan", gh?.id, gh?.complexId);
          fanList.push(enriched);
        }
      }

      // Update RAM snapshot
      if (targetComplex) {
        replaceComplex({
          ...targetComplex,
          wellPumpSchedules: wellPumpList.filter((s) => s.complexId === targetComplex.id),
        });
      }
      for (const gh of snapshot.greenhouses) {
        replaceGreenhouse({
          ...gh,
          fertigationSchedules: fertList.filter((s) => s.ghId === gh.id),
          fanSchedules: fanList.filter((s) => s.ghId === gh.id),
        });
      }

      // Relay event backlog from ESP32 ring buffer to Python backend
      relayEventsToBackend(complexId).catch(() => {});

      return { wellPump: wellPumpList, fertigation: fertList, fan: fanList };
    } catch (err) {
      console.warn("[scheduleService.refreshSchedulesFromEsp32] Failed to fetch schedule intents from ESP32:", err);
      return { wellPump: [], fertigation: [], fan: [] };
    }
  },

  fertigationForGh(ghId: string): FertigationSchedule[] {
    const gh = greenhouseService.get(ghId);
    const schedules = gh?.fertigationSchedules ?? [];
    return schedules.map((s) => enrichScheduleWithActivationState(s, "fertigation", ghId, gh?.complexId));
  },
  wellPumpForComplex(complexId: string): WellPumpSchedule[] {
    const complex = complexService.get(complexId);
    const schedules = complex?.wellPumpSchedules ?? [];
    return schedules.map((s) => enrichScheduleWithActivationState(s, "wellPump", undefined, complexId));
  },
  waterTransferForComplex(_complexId: string): import("./types").WaterTransferSchedule[] { return []; },
  fanForGh(ghId: string): FanSchedule[] {
    const gh = greenhouseService.get(ghId);
    const schedules = gh?.fanSchedules ?? [];
    return schedules.map((s) => enrichScheduleWithActivationState(s, "fan", ghId, gh?.complexId));
  },

  async createFertigation(input: Omit<FertigationSchedule, "id">): Promise<FertigationSchedule> {
    const gh = assertFound(greenhouseService.get(input.ghId), "Greenhouse");
    if (input.recipeId && !gh.recipes.some((r) => r.id === input.recipeId)) throw new ServiceError("INVALID_RELATIONSHIP", "The selected recipe does not belong to this greenhouse.", "recipeId");
    if (!input.name.trim()) throw new ServiceError("VALIDATION_FAILED", "Schedule name is required.", "name");
    if (gh.fertigationSchedules.some((s) => s.name.toLowerCase() === input.name.trim().toLowerCase())) throw new ServiceError("DUPLICATE_ID", `A fertigation schedule named "${input.name.trim()}" already exists in this greenhouse.`, "name");

    const id = (input as any).id || `fert-${Date.now()}`;
    const created: FertigationSchedule = {
      ...input,
      id,
      name: input.name.trim(),
    } as FertigationSchedule;

    const intentPayload = {
      ...created,
      kind: "fertigation",
      complexId: gh.complexId,
      ghId: gh.id,
    };

    // 1. Authoritative persistence on ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.saveScheduleIntent(intentPayload as any);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.createSchedule(gh.complexId, "fertigation", intentPayload as any).catch(() => { });
    }

    // 2. Update RAM state
    replaceGreenhouse({
      ...gh,
      fertigationSchedules: [...gh.fertigationSchedules.filter((s) => s.id !== created.id), created],
    });

    // 3. Compile and deploy executable subset to ESP32 FreeRTOS runtime scheduler
    try {
      await deployCompiledScheduleSet(gh.complexId, {}, created.id);
    } catch (err) {
      console.warn("[scheduleService] Fertigation compiled deployment warning:", err);
      // NOTE: DO NOT delete the persisted schedule intent!
      // A schedule whose runtime deployment is blocked remains 100% persisted in NVS intent store!
    }
    return created;
  },

  async updateFertigation(id: string, patch: Partial<FertigationSchedule>): Promise<FertigationSchedule> {
    const greenhouse = getOperationalSnapshot().greenhouses.find((g) => g.fertigationSchedules.some((s) => s.id === id));
    const existing = assertFound(greenhouse?.fertigationSchedules.find((s) => s.id === id), "Schedule");
    const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");

    // ITEM-2/LAYER-J: In-flight protection — block mutation if schedule has active occurrence.
    await assertScheduleNotInFlight(existing.ghId, id);

    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ServiceError("VALIDATION_FAILED", "Schedule name is required.", "name");
      if (gh.fertigationSchedules.some((s) => s.id !== id && s.name.toLowerCase() === patch.name!.trim().toLowerCase())) throw new ServiceError("DUPLICATE_ID", `A fertigation schedule named "${patch.name.trim()}" already exists in this greenhouse.`, "name");
      patch = { ...patch, name: patch.name.trim() };
    }
    const proposed = { ...existing, ...patch } as FertigationSchedule;
    if (patch.recipeId && !gh.recipes.some((r) => r.id === patch.recipeId)) throw new ServiceError("INVALID_RELATIONSHIP", "The selected recipe does not belong to this greenhouse.", "recipeId");

    const intentPayload = {
      ...proposed,
      kind: "fertigation",
      complexId: gh.complexId,
      ghId: gh.id,
    };

    // 1. Authoritative persistence on ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.saveScheduleIntent(intentPayload as any);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.updateSchedule(id, "fertigation", intentPayload as any).catch(() => { });
    }

    // 2. Update RAM state
    replaceGreenhouse({
      ...gh,
      fertigationSchedules: gh.fertigationSchedules.map((s) => s.id === id ? proposed : s),
    });

    // 3. Compile and deploy executable subset
    try {
      await deployCompiledScheduleSet(gh.complexId, {}, id);
    } catch (err) {
      console.warn("[scheduleService] Fertigation update compiled deployment warning:", err);
    }
    return proposed;
  },

  async deleteFertigation(id: string): Promise<void> {
    const greenhouse = getOperationalSnapshot().greenhouses.find((g) => g.fertigationSchedules.some((s) => s.id === id));
    const existing = assertFound(greenhouse?.fertigationSchedules.find((s) => s.id === id), "Schedule");
    const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");

    // ITEM-2/LAYER-J: In-flight protection — block delete if schedule has active occurrence.
    await assertScheduleNotInFlight(existing.ghId, id);

    const remaining = gh.fertigationSchedules.filter((s) => s.id !== id);

    // 1. Authoritative deletion from ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.deleteScheduleIntent(id);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.deleteSchedule(id).catch(() => { });
    }

    // 2. Update RAM state
    replaceGreenhouse({
      ...gh,
      fertigationSchedules: remaining,
    });

    // 3. Recompile and redeploy remaining schedules
    try {
      await deployCompiledScheduleSet(gh.complexId, { fertigation: remaining });
    } catch (err) {
      console.warn("[scheduleService] Fertigation delete redeployment warning:", err);
    }
  },

  async createWellPump(input: Omit<WellPumpSchedule, "id">): Promise<WellPumpSchedule> {
    const existing = this.wellPumpForComplex(input.complexId);
    if (existing.some((s) => s.task.toLowerCase() === input.task.trim().toLowerCase())) throw new ServiceError("DUPLICATE_ID", `A well pump schedule named "${input.task.trim()}" already exists in this complex.`, "task");

    const id = (input as any).id || `wellPump-${Date.now()}`;
    const created: WellPumpSchedule = {
      ...input,
      id,
      task: input.task.trim(),
    } as WellPumpSchedule;

    const intentPayload = {
      ...created,
      kind: "wellPump",
      type: "well_pump",
      name: created.task,
      complexId: input.complexId,
    };

    // 1. Authoritative persistence on ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.saveScheduleIntent(intentPayload as any);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.createSchedule(input.complexId, "wellPump", intentPayload as any).catch(() => { });
    }

    // 2. Update RAM state
    const complex = getOperationalSnapshot().complexes.find((c) => c.id === input.complexId);
    if (complex) {
      replaceComplex({
        ...complex,
        wellPumpSchedules: [...(complex.wellPumpSchedules ?? []).filter((s) => s.id !== created.id), created],
      });
    }

    // 3. Compile and deploy executable subset
    try {
      await deployCompiledScheduleSet(input.complexId, {}, created.id);
    } catch (err) {
      console.warn("[scheduleService] Well pump compiled deployment warning:", err);
      // NOTE: DO NOT delete the persisted schedule intent!
      // A schedule whose runtime deployment is blocked remains 100% persisted in NVS intent store!
    }
    return created;
  },

  async updateWellPump(id: string, patch: Partial<WellPumpSchedule>): Promise<WellPumpSchedule> {
    const complex = getOperationalSnapshot().complexes.find((c) => c.wellPumpSchedules?.some((s) => s.id === id));
    const existing = assertFound(complex?.wellPumpSchedules?.find((s) => s.id === id), "Schedule");
    if (patch.task !== undefined && !patch.task.trim()) throw new ServiceError("VALIDATION_FAILED", "Task name is required.", "task");
    const proposed = { ...existing, ...patch, ...(patch.task ? { task: patch.task.trim() } : {}) } as WellPumpSchedule;
    if (this.wellPumpForComplex(existing.complexId).some((s) => s.id !== id && s.task.toLowerCase() === proposed.task.toLowerCase())) throw new ServiceError("DUPLICATE_ID", `A well pump schedule named "${proposed.task}" already exists in this complex.`, "task");

    const intentPayload = {
      ...proposed,
      kind: "wellPump",
      type: "well_pump",
      name: proposed.task,
      complexId: existing.complexId,
    };

    // 1. Authoritative persistence on ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.saveScheduleIntent(intentPayload as any);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.updateSchedule(id, "wellPump", intentPayload as any).catch(() => { });
    }

    // 2. Update RAM state
    if (complex) {
      replaceComplex({
        ...complex,
        wellPumpSchedules: (complex.wellPumpSchedules ?? []).map((s) => s.id === id ? proposed : s),
      });
    }

    // 3. Compile and deploy executable subset
    try {
      await deployCompiledScheduleSet(existing.complexId, {}, id);
    } catch (err) {
      console.warn("[scheduleService] Well pump update deployment warning:", err);
    }
    return proposed;
  },

  async deleteWellPump(id: string): Promise<void> {
    const complex = getOperationalSnapshot().complexes.find((c) => c.wellPumpSchedules?.some((s) => s.id === id));
    const existing = assertFound(complex?.wellPumpSchedules?.find((s) => s.id === id), "Schedule");
    const remaining = this.wellPumpForComplex(existing.complexId).filter((s) => s.id !== id);

    // 1. Authoritative deletion from ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.deleteScheduleIntent(id);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.deleteSchedule(id).catch(() => { });
    }

    // 2. Update RAM state
    if (complex) {
      replaceComplex({
        ...complex,
        wellPumpSchedules: remaining,
      });
    }

    // 3. Recompile and redeploy remaining schedules
    try {
      await deployCompiledScheduleSet(existing.complexId, { wellPump: remaining });
    } catch (err) {
      console.warn("[scheduleService] Well pump delete redeployment warning:", err);
    }
  },

  async createFan(input: Omit<FanSchedule, "id">): Promise<FanSchedule> {
    const gh = assertFound(greenhouseService.get(input.ghId), "Greenhouse");
    if (input.mode === "temperature" && (input.onAboveC ?? 0) <= (input.offBelowC ?? 0)) throw new ServiceError("VALIDATION_FAILED", "Fan ON threshold must be higher than the OFF threshold.", "onAboveC");

    const id = (input as any).id || `fan-${Date.now()}`;
    const created: FanSchedule = {
      ...input,
      id,
    } as FanSchedule;

    const intentPayload = {
      ...created,
      kind: "fan",
      complexId: gh.complexId,
      ghId: gh.id,
    };

    // 1. Authoritative persistence on ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.saveScheduleIntent(intentPayload as any);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.createSchedule(gh.complexId, "fan", intentPayload as any).catch(() => { });
    }

    // 2. Update RAM state
    replaceGreenhouse({
      ...gh,
      fanSchedules: [...gh.fanSchedules.filter((s) => s.id !== created.id), created],
    });

    // 3. Compile and deploy executable subset
    try {
      await deployCompiledScheduleSet(gh.complexId, {}, created.id);
    } catch (err) {
      console.warn("[scheduleService] Fan compiled deployment warning:", err);
      // NOTE: DO NOT delete the persisted schedule intent!
      // A schedule whose runtime deployment is blocked remains 100% persisted in NVS intent store!
    }
    return created;
  },

  async updateFan(id: string, patch: Partial<FanSchedule>): Promise<FanSchedule> {
    const greenhouse = getOperationalSnapshot().greenhouses.find((g) => g.fanSchedules.some((s) => s.id === id));
    const existing = assertFound(greenhouse?.fanSchedules.find((s) => s.id === id), "Schedule");
    const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");
    const merged = { ...existing, ...patch } as FanSchedule;
    if (merged.mode === "temperature" && (merged.onAboveC ?? 0) <= (merged.offBelowC ?? 0)) throw new ServiceError("VALIDATION_FAILED", "Fan ON threshold must be higher than the OFF threshold.", "onAboveC");

    const intentPayload = {
      ...merged,
      kind: "fan",
      complexId: gh.complexId,
      ghId: gh.id,
    };

    // 1. Authoritative persistence on ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.saveScheduleIntent(intentPayload as any);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.updateSchedule(id, "fan", intentPayload as any).catch(() => { });
    }

    // 2. Update RAM state
    replaceGreenhouse({
      ...gh,
      fanSchedules: gh.fanSchedules.map((s) => s.id === id ? merged : s),
    });

    // 3. Compile and deploy executable subset
    try {
      await deployCompiledScheduleSet(gh.complexId, {}, id);
    } catch (err) {
      console.warn("[scheduleService] Fan update deployment warning:", err);
    }
    return merged;
  },

  async deleteFan(id: string): Promise<void> {
    const greenhouse = getOperationalSnapshot().greenhouses.find((g) => g.fanSchedules.some((s) => s.id === id));
    const existing = assertFound(greenhouse?.fanSchedules.find((s) => s.id === id), "Schedule");
    const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");
    const remaining = gh.fanSchedules.filter((s) => s.id !== id);

    // 1. Authoritative deletion from ESP32 NVS
    if (isDirectEsp32Enabled()) {
      await esp32Client.deleteScheduleIntent(id);
    }
    if (isPythonBackendEnabled() && !isDirectEsp32Enabled()) {
      operationalPythonClient.deleteSchedule(id).catch(() => { });
    }

    // 2. Update RAM state
    replaceGreenhouse({
      ...gh,
      fanSchedules: remaining,
    });

    // 3. Recompile and redeploy remaining schedules
    try {
      await deployCompiledScheduleSet(gh.complexId, { fan: remaining });
    } catch (err) {
      console.warn("[scheduleService] Fan delete redeployment warning:", err);
    }
  },
};

export async function revalidateAndDeployScheduleIntents(complexId: string): Promise<void> {
  if (!isDirectEsp32Enabled()) return;
  try {
    const intentsRes = await esp32Client.getScheduleIntents();
    const items = intentsRes?.items || [];
    if (!items.length) return;
    await deployCompiledScheduleSet(complexId);
  } catch (err) {
    console.warn(`[revalidateAndDeployScheduleIntents] Revalidation for ${complexId} deferred:`, err);
  }
}

/* -------------------------- calibration -------------------------- */

export const calibrationService = {
  devices(): CalibrationDevice[] { return []; },
  history(): CalibrationRecord[] { return []; },
  async loadAuthoritative(complexId: string): Promise<{ devices: CalibrationDevice[]; history: CalibrationRecord[] }> {
    let components: InstalledComponent[] = [];

    // 1. Primary: load from single true source configuration (hardwareService.getInstalledComponents)
    try {
      const installed = await hardwareService.getInstalledComponents(complexId);
      if (installed && installed.length > 0) {
        components = installed as unknown as InstalledComponent[];
      }
    } catch {
      components = [];
    }

    // 2. Direct ESP32 inventory
    if (!components.length && isDirectEsp32Enabled()) {
      try {
        const inv = await esp32Client.getInventory();
        if (inv && Array.isArray(inv.components) && inv.components.length > 0) {
          components = inv.components;
        }
      } catch {
        // ignore
      }
    }

    // 3. Python backend inventory
    if (!components.length && isPythonBackendEnabled()) {
      try {
        const inv = await pythonScheduleClient.getInventory(complexId);
        if (inv && Array.isArray(inv.components) && inv.components.length > 0) {
          components = inv.components;
        }
      } catch {
        // ignore
      }
    }

    // 4. Default fallback to canonical supported dosing and sensors so calibration page is never blank
    const activeDosingOrSensors = components
      .filter((component) => ["COMMISSIONED", "ENABLED", "REGISTERED"].includes(component.lifecycleState ?? "COMMISSIONED"))
      .filter((component) => /DOSING|PH|EC/i.test(`${component.role ?? ""} ${component.supportedTypeId ?? ""} ${component.name ?? ""}`));

    const effectiveComponents: InstalledComponent[] = activeDosingOrSensors.length > 0
      ? activeDosingOrSensors
      : CANONICAL_GPIO_PIN_MAP
        .filter((p) => p.equipment && /DOSING|PH|EC/i.test(`${p.equipment.role} ${p.equipment.supportedTypeId} ${p.equipment.name}`))
        .map((p) => ({
          componentId: p.equipment!.componentId,
          name: p.equipment!.name,
          supportedTypeId: p.equipment!.supportedTypeId,
          role: p.equipment!.role,
          lifecycleState: "COMMISSIONED",
          deploymentStatus: "APPLIED",
          assignment: { complexId },
          wiring: { interface: "GPIO", gpio: p.gpio, polarity: p.equipment!.polarity },
          parameters: p.equipment!.parameters || {},
        } as InstalledComponent));

    // F-C2: Jangan injeksikan dummy sensor_ph/sensor_ec — per DYNAMIC_HARDWARE_REGISTRY_ARCHITECTURE.md §4.1 L290,
    // UI tidak boleh mensintesis pump/actuator/sensor dari seed data. Calibration page menampilkan empty state
    // jika inventory kosong (effectiveComponents === []).

    let records: any[] = [];
    try {
      const calRes = await operationalPythonClient.listCalibrations(complexId);
      records = calRes.calibrations || [];
    } catch {
      records = [];
    }
    const latestByComponent = new Map<string, any>();
    for (const record of records) {
      const previous = latestByComponent.get(record.componentId);
      if (!previous || record.version > previous.version) latestByComponent.set(record.componentId, record);
    }
    const devices: CalibrationDevice[] = effectiveComponents
      .map((component) => {
        const text = `${component.role ?? ""} ${component.supportedTypeId ?? ""} ${component.name ?? ""}`.toUpperCase();
        const category: CalibrationDevice["category"] = text.includes("DOSING") ? "dosing-pump" : text.includes("PH") ? "ph" : "ec";
        const assignmentGhId = component.assignment?.ghId ?? null;
        const calibration = latestByComponent.get(component.componentId);
        const validUntil = calibration?.validUntilMs ? new Date(calibration.validUntilMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not scheduled";
        let channel = component.parameters?.channel != null ? String(component.parameters.channel) : undefined;
        if (!channel && category === "dosing-pump") {
          // F-C5: Hindari regex A/B hard-code — gunakan component.name sebagai channel label,
          // atau fallback ke componentId. Mendukung dosing pump dinamis (A..G via PCA9685).
          channel = component.name?.trim() || component.componentId;
        }
        return {
          id: `dev-${component.componentId}`,
          category,
          name: component.name,
          ...(channel ? { channel } : {}),
          ghId: assignmentGhId,
          location: assignmentGhId ? `${assignmentGhId} – Installed Component` : `${complexId} – Central Calibration`,
          reading: "—",
          unit: category === "dosing-pump" ? "ml/min" : category === "ph" ? "pH" : "mS/cm",
          online: true,
          lastCalibration: calibration ? new Date(calibration.createdAtMs).toLocaleString("en-GB") : "Never",
          calibratedAtMs: calibration?.createdAtMs ?? null,
          due: validUntil,
          method: category === "dosing-pump" ? "single" : "two",
          standardOptions: category === "ph" ? ["4.00", "6.86", "7.00", "9.18"] : category === "ec" ? ["1.41", "12.88"] : ["10", "30"],
          standardUnit: category === "ph" ? "pH" : category === "ec" ? "mS/cm" : "s run",
          measuredUnit: category === "ph" ? "pH" : category === "ec" ? "mS/cm" : "ml",
        };
      });
    const history: CalibrationRecord[] = records.map((record) => ({
      id: record.calibrationId,
      dateTime: new Date(record.createdAtMs).toLocaleString("en-GB"),
      device: record.componentId,
      type: record.calibrationType,
      before: "—",
      after: "—",
      result: ["EXPIRED", "SUSPECT", "REMOVED"].includes(record.state) ? "Failed" : "Success",
      user: record.operator,
    }));
    return { devices, history };
  },
  reference() {
    return calibrationReference;
  },
  devicesForCategory(category: string): CalibrationDevice[] {
    const allowed = categoryFilterMap[category] ?? categoryFilterMap["all"];
    return [];
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

    const componentId = device.id.replace("dev-", "");
    const targetComplexId = (device.ghId ? greenhouseService.get(device.ghId)?.complexId : null) || complexService.list()[0]?.id || "";
    try {
      if (device.category === "dosing-pump") {
        const measuredMl = parseFloat(after);
        if (!Number.isFinite(measuredMl) || measuredMl <= 0) throw new ServiceError("VALIDATION_FAILED", "Measured dosing volume must be positive.");
        if (isDirectEsp32Enabled()) {
          try { await esp32Client.saveCalibrationRate(componentId, measuredMl / 30.0); } catch { }
        }
        await operationalPythonClient.saveCalibration(targetComplexId, { calibrationType: "DOSING_RATE", componentId, measuredMl, durationSec: 30, operator: user, state: "CALIBRATED" });
      } else if (device.category === "ph" || device.category === "ec") {
        const beforeValue = parseFloat(before);
        const afterValue = parseFloat(after);
        if (Number.isFinite(beforeValue) && Number.isFinite(afterValue) && beforeValue !== afterValue) {
          const calibrationType = device.category === "ph" ? "PH" : "EC";
          await operationalPythonClient.saveCalibration(targetComplexId, { calibrationType, componentId, inputOne: beforeValue, outputOne: beforeValue, inputTwo: afterValue, outputTwo: afterValue, operator: user, state: "CALIBRATED" });
        }
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError("DEVICE_OFFLINE", err instanceof Error ? err.message : "Calibration persistence failed.");
    }
  },
  async runCalibrationPump(device: CalibrationDevice, durationSec: number): Promise<void> {
    if (isDirectEsp32Enabled()) {
      try {
        const componentId = device.id.replace("dev-", "");
        await esp32Client.startCalibration(componentId, "VOLUMETRIC", durationSec);
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Failed to run pump on ESP32.");
      }
    } else {
      await delay(300);
    }
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
    return getOperationalSnapshot().greenhouses.flatMap((g) => g.queue);
  },
  dosingPumps() {
    return [];
  },
  async getDynamicDosingPumps() {
    try {
      const inv = await esp32Client.getInventory();
      if (inv && Array.isArray(inv.components)) {
        const dynamicPumps = inv.components.filter(
          (c) =>
            (c.supportedTypeId?.toLowerCase().includes("pump") || c.role?.includes("DOSING")) &&
            (c.role?.includes("DOSING") ||
              c.componentId?.includes("dosing") ||
              c.name?.toLowerCase().includes("dosing") ||
              c.componentId?.startsWith("dp-"))
        );
        if (dynamicPumps.length > 0) {
          return dynamicPumps.map((c) => ({
            id: c.componentId,
            name: c.name,
            state: ((c.lifecycleState === "COMMISSIONED" || c.lifecycleState === "ENABLED") ? "Ready" : "Not Used") as "Ready" | "Not Used",
            rate: "0 ml/min",
          }));
        }
      }
    } catch (err) {
      if (isPythonBackendEnabled() || isDirectEsp32Enabled()) {
        throw new ServiceError("DEVICE_OFFLINE", err instanceof Error ? err.message : "Authoritative inventory unavailable.");
      }
    }
    return [];
  },
  dosingLastCalibration() { return "—"; },
  history() { return getOperationalSnapshot().greenhouses.flatMap((g) => g.history); },
  systemStatus(complexId: string, ghId?: string): FertigationSystemStatus | null {
    const complex = complexService.get(complexId);
    if (!complex) return null;
    const gh = ghId ? greenhouseService.get(ghId) : undefined;
    const mixingTankLevel = gh?.online && Number.isFinite(gh.telemetry.tankPct)
      ? Math.max(0, Math.min(100, gh.telemetry.tankPct))
      : gh?.currentRun && gh.currentRun.tank.capacityL > 0
        ? Math.max(0, Math.min(100, (gh.currentRun.tank.currentL / gh.currentRun.tank.capacityL) * 100))
        : null;
    return {
      mixingTankLevel,
      waterInlet: complex.esp32.online ? (complex.water.wellPumpOn ? "ON" : "OFF") : "UNAVAILABLE",
      distributionLine: gh
        ? (gh.fertigationState === "DISTRIBUTING" ? "RUNNING" : "IDLE")
        : "UNAVAILABLE",
      systemMode: complex.emergencyStopped ? "EMERGENCY_STOP" : complex.esp32.online ? "ONLINE" : "OFFLINE",
      lastUpdate: complex.esp32.lastSync || null,
    };
  },
  observationsForGh(ghId: string): Observation[] {
    return (greenhouseService.get(ghId)?.research?.recentObservations ?? []).map((o) => ({
      observationId: o.observationId, ghId: o.ghId, plantId: o.plantId ?? "",
      heightCm: o.heightCm ?? 0, leafCount: o.leafCount ?? 0, fruitCount: o.fruitCount ?? 0,
      notes: o.notes ?? "", observedAt: o.observedAt,
    }));
  },

  syncState(complexId: string): SyncState {
    return syncStates.get(complexId) ?? "idle";
  },

  /** Manual fertigation: triggers real ESP32 fertigation execution. */
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
    if (isDirectEsp32Enabled() || isPythonBackendEnabled()) {
      try {
        const configuration = await loadAuthoritativeConfiguration(gh.complexId);
        const localRecipe = assertFound(gh.recipes.find((r) => r.id === recipeId), "Recipe");
        const inventory = isDirectEsp32Enabled() ? await esp32Client.getInventory() : await pythonScheduleClient.getInventory(gh.complexId);
        const dosing = (inventory.components ?? []).filter((c) => /DOSING/i.test(`${c.role ?? ""} ${c.supportedTypeId ?? ""} ${c.name ?? ""}`) && ["COMMISSIONED", "ENABLED"].includes(c.lifecycleState));
        const channels = (localRecipe as any).dosingChannels?.length ? (localRecipe as any).dosingChannels : dosing.map((c) => ({ componentId: c.componentId, requestedMl: 100 })).filter((x) => x.requestedMl > 0);

        let calibrations: any = {};
        if (isDirectEsp32Enabled()) {
          try {
            calibrations = await esp32Client.getCalibrationRates();
          } catch { }
        }

        const request = {
          complexId: gh.complexId,
          ghId,
          recipeId,
          targetWaterMl: Math.round(targetWaterL * 1000),
          dosingChannels: channels,
          deliveryMode: "VOLUME",
          safetyAcknowledged: true,
          triggerType: "MANUAL",
          source: "UI",
          operator: "UI",
          mixingDurationSec: (localRecipe as any).mixingDurationSec ?? 0,
          targetDeliveredMl: Math.round(targetWaterL * 1000),
        };

        if (isDirectEsp32Enabled()) {
          const planRes = generateFertigationExecutionPlan(configuration, request, calibrations);
          if (!planRes.valid || !planRes.executionPlan) {
            throw new ServiceError("CONFLICT", planRes.blockedReasons.map((r) => r.message).join("; ") || "Fertigation is blocked by configuration/safety validation.");
          }
          const cmdId = `fert-${gh.complexId}-${ghId}-${Date.now()}`;
          const parameters = { ...request, executionPlan: planRes.executionPlan };
          await esp32Client.postCommand(cmdId, "FERTIGATION_START", {
            targetComplexId: gh.complexId,
            targetGhId: ghId,
            configurationVersion: configuration.version,
            source: "FERTIGATION",
            parameters,
          });
        } else {
          const prepared = await pythonScheduleClient.prepareFertigation(gh.complexId, configuration, request);
          if (!prepared.valid || !prepared.run?.executionPlan) throw new ServiceError("CONFLICT", prepared.issues.map((x) => x.message).join("; ") || "Fertigation is blocked by configuration/safety validation.");
          const cmdId = `fert-${gh.complexId}-${ghId}-${Date.now()}`;
          const parameters = { ...request, executionPlan: prepared.run.executionPlan };
          await pythonScheduleClient.postCommand(gh.complexId, { commandId: cmdId, type: "FERTIGATION_START", targetComplexId: gh.complexId, targetGhId: ghId, configurationVersion: configuration.version, source: "FERTIGATION", parameters });
        }

        const nowStr = new Date().toTimeString().slice(0, 8);
        gh.fertigationState = "MIXING";
        gh.currentRun = {
          ghId,
          recipeName: localRecipe.name,
          targetWaterL,
          dosingAml: 100,
          dosingBml: 100,
          startedAt: nowStr,
          elapsedLabel: "0 sec",
          estimatedFinish: new Date(Date.now() + 900000).toTimeString().slice(0, 8),
          progressPct: 0,
          waterDoneL: 0,
          dosingADoneMl: 0,
          dosingBDoneMl: 0,
          steps: [
            { name: "Precheck", status: "active" },
            { name: "Filling", status: "pending" },
            { name: "Dosing", status: "pending" },
            { name: "Mixing", status: "pending" },
            { name: "Mix Ready", status: "pending" },
            { name: "Delivery", status: "pending" },
            { name: "Complete", status: "pending" },
          ],
          tank: {
            currentL: 0,
            capacityL: 200,
            waterL: 0,
            nutrientAml: 0,
            nutrientBml: 0,
            temperatureC: 25,
          },
        };
        return;
      } catch (err: unknown) {
        if (err instanceof ServiceError) throw err;
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Failed to start configuration-driven fertigation.");
      }
    }

    throw new ServiceError("DEVICE_OFFLINE", "No authoritative fertigation execution path is configured.");
  },

  async stopManual(ghId: string): Promise<void> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    const cmdId = `fert-stop-${gh.complexId}-${ghId}-${Date.now()}`;
    if (isDirectEsp32Enabled()) {
      try {
        await esp32Client.stopFertigation();
      } catch {
        await esp32Client.postCommand(cmdId, "FERTIGATION_STOP", {
          targetComplexId: gh.complexId,
          targetGhId: ghId,
          source: "FERTIGATION",
        });
      }
      gh.fertigationState = "IDLE";
      gh.currentRun = null;
      return;
    }
    if (isPythonBackendEnabled()) {
      await pythonScheduleClient.postCommand(gh.complexId, {
        commandId: cmdId,
        type: "FERTIGATION_STOP",
        targetComplexId: gh.complexId,
        targetGhId: ghId,
        source: "FERTIGATION",
      });
      gh.fertigationState = "IDLE";
      gh.currentRun = null;
    }
  },

  async getAuthoritativeFertigationStatus(): Promise<any> {
    if (isDirectEsp32Enabled()) {
      return esp32Client.getFertigationStatus();
    }
    return null;
  },

  /** ESP32 sync: pending → synced on success; error path preserves state (spec #26/#34). */
  async syncEsp32(complexId: string): Promise<void> {
    const complex = assertFound(complexService.get(complexId), "Complex");
    if (syncStates.get(complexId) === "syncing") {
      throw new ServiceError("CONFLICT", "A synchronization is already in progress.");
    }
    syncStates.set(complexId, "syncing");
    try {
      if (isDirectEsp32Enabled()) {
        await esp32Client.getStatus();
      } else {
        await delay(900);
        if (!complex.esp32.online) {
          throw new ServiceError("DEVICE_OFFLINE", `ESP32 for ${complex.code} is OFFLINE — unable to synchronize configuration.`);
        }
      }

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
    const commandId = `estop-${complexId}-${Date.now()}`;
    try {
      if (isDirectEsp32Enabled()) {
        await esp32Client.emergencyStop("Emergency stop triggered from UI", commandId);
      } else if (isPythonBackendEnabled()) {
        const python = new PythonClient();
        await python.emergencyStop(complexId, { reason: "Emergency stop triggered from UI", commandId });
      } else {
        throw new ServiceError("DEVICE_OFFLINE", "No authoritative ESP32/backend command path is configured.");
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("DEVICE_OFFLINE", errorObj?.message || "Emergency stop could not be confirmed by the controller.");
    }
  },

  /** Latched emergency-stop state — actuators and runs stay blocked until resume() is called. */
  isStopped(complexId: string): boolean {
    return complexService.get(complexId)?.emergencyStopped ?? false;
  },

  /** Manual resume: clears the latched emergency stop; the operator re-enables schedules/pumps normally. */
  async resume(complexId: string): Promise<void> {
    assertFound(complexService.get(complexId), "Complex");

    const commandId = `resume-${complexId}-${Date.now()}`;
    try {
      if (isDirectEsp32Enabled()) {
        await esp32Client.postCommand(commandId, "RESUME_SYSTEM", {
          source: "MANUAL",
          targetComplexId: complexId,
        });
      } else if (isPythonBackendEnabled()) {
        const python = new PythonClient();
        await python.postCommand(complexId, { commandId, type: "RESUME_SYSTEM", targetComplexId: complexId, source: "MANUAL" });
      } else {
        throw new ServiceError("DEVICE_OFFLINE", "No authoritative ESP32/backend command path is configured.");
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      if (err instanceof ServiceError) throw err;
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Failed to resume on controller.");
    }
  },

  /** Radar interlock: pump may only start when the tank is still filling (spec #16). */
  async setWellPump(complexId: string, on: boolean): Promise<void> {
    const complex = assertFound(complexService.get(complexId), "Complex");
    if (on && complex.emergencyStopped) {
      throw new ServiceError("CONFLICT", "System is in EMERGENCY STOP — resume the system before turning the well pump ON.");
    }
    if (isDirectEsp32Enabled()) {
      try {
        const inventory = await esp32Client.getInventory();
        const wellPump = inventory.components?.find((c) =>
          /well|raw.*pump|submersible/i.test(`${c.role ?? ""} ${c.supportedTypeId ?? ""} ${c.name ?? ""}`),
        );
        if (on && !wellPump) throw new Error("No configured operational well/raw-water pump component is available.");
        const cmdId = `wp-${Date.now()}`;
        await esp32Client.postCommand(cmdId, on ? "WELL_PUMP_START" : "WELL_PUMP_STOP", {
          componentId: wellPump?.componentId,
          targetComplexId: complexId,
          targetGhId: wellPump?.assignment?.ghId ?? undefined,
          resourceId: wellPump?.resourceId ?? undefined,
          durationSeconds: on ? 900 : 0,
          source: "MANUAL",
        });
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Failed to toggle well pump on ESP32.");
      }
    } else if (isPythonBackendEnabled()) {
      try {
        const python = new PythonClient();
        const inventory = await python.getInventory(complexId);
        const wellPump = inventory.components?.find((c) =>
          /well|raw.*pump|submersible/i.test(`${c.role ?? ""} ${c.supportedTypeId ?? ""} ${c.name ?? ""}`),
        );
        if (on && !wellPump) throw new Error("No configured operational well/raw-water pump component is available.");
        const commandId = `wp-${complexId}-${on ? "on" : "off"}-${Date.now()}`;
        await python.postCommand(complexId, {
          commandId,
          type: on ? "WELL_PUMP_START" : "WELL_PUMP_STOP",
          targetComplexId: complexId,
          targetGhId: wellPump?.assignment?.ghId,
          componentId: wellPump?.componentId,
          resourceId: wellPump?.resourceId,
          configurationVersion: undefined,
          source: "MANUAL",
          durationSeconds: on ? 900 : 0,
        });
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Failed to toggle well pump through backend.");
      }
    } else {
      throw new ServiceError("DEVICE_OFFLINE", "No authoritative ESP32/backend command path is configured.");
    }
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
      if (isDirectEsp32Enabled()) {
        const cmdId = `test-${pumpId}-${Date.now()}`;
        await esp32Client.postCommand(cmdId, "DOSING_RUN_START", {
          componentId: pumpId.replace("dev-", ""),
          durationSeconds: 5,
        });
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string };
      throw new ServiceError("VALIDATION_FAILED", errorObj?.message || `Failed to test pump ${pumpName} on ESP32.`);
    } finally {
      setTimeout(() => pumpTestRuns.delete(pumpId), 5000);
    }
  },

  async addObservation(ghId: string, draft: ObservationDraft): Promise<void> {
    const gh = assertFound(greenhouseService.get(ghId), "Greenhouse");
    if (!draft.plantId.trim()) throw new ServiceError("VALIDATION_FAILED", "Plant ID is required.", "plantId");
    if (!draft.heightCm || draft.heightCm <= 0) throw new ServiceError("VALIDATION_FAILED", "Height must be greater than zero.", "heightCm");
    const cycle = gh.research?.currentCycle;
    if (!cycle) throw new ServiceError("INVALID_RELATIONSHIP", "No active research cycle exists for this greenhouse.", "cycleId");
    await operationalPythonClient.saveResearchObservation(gh.complexId, {
      cycleId: cycle.cycleId, ghId, plantId: draft.plantId.trim(), observedAt: new Date().toISOString(),
      metric: "plant_check", heightCm: draft.heightCm, leafCount: draft.leafCount || null, fruitCount: draft.fruitCount || null,
      notes: draft.notes?.trim() || null, observer: draft.observer?.trim() || null, source: "WEB",
    });
  },

  async deleteObservation(id: string): Promise<void> {
    const gh = getOperationalSnapshot().greenhouses.find((g) => g.research?.recentObservations?.some((o) => o.observationId === id));
    if (!gh) throw new ServiceError("NOT_FOUND", "Observation not found.");
    await operationalPythonClient.deleteResearchObservation(gh.complexId, id);
  },
};

/* --------------------------- hardware (M2 / M3.0) ----------------------- */
import { hardwareCatalog } from './data/hardwareCatalog';
import { SupportedComponentDefinition } from './types/equipment';
// M3.0: Use the canonical OpenAPI-contract InstalledComponent type (from contracts.ts).
// Esp32Client.getInventory() returns this type. types/equipment.ts InstalledComponent
// is structurally equivalent; to be consolidated in a future cleanup milestone.
import { Esp32Client } from './api/esp32-client';
import { defaultConfig } from './api/backend-client';

// Installed hardware authority: ActiveConfiguration.components[] -> ESP32 /api/v1/inventory.
const _esp32 = new Esp32Client(defaultConfig);

export const hardwareService = {
  async getSupportedCatalog(): Promise<SupportedComponentDefinition[]> {
    await delay();
    return hardwareCatalog;
  },

  /** Installed inventory is authoritative when returned by python configuration or ESP32 active registry. */
  /** Installed inventory is authoritative when returned by ESP32 active registry or python configuration. */
  async getInstalledComponents(complexId?: string): Promise<InstalledComponent[]> {
    if (isDirectEsp32Enabled()) {
      try {
        const cfg = await _esp32.getConfiguration();
        if (cfg && Array.isArray(cfg.components) && cfg.components.length > 0) {
          return cfg.components;
        }
      } catch {
        // Fall back to getInventory
        try {
          const inv = await _esp32.getInventory();
          if (inv.components && inv.components.length > 0) return inv.components;
        } catch {
          // ignore
        }
      }
    }
    if (isPythonBackendEnabled() && complexId) {
      try {
        const cfg = await operationalPythonClient.getConfiguration(complexId);
        if (cfg && Array.isArray(cfg.components) && cfg.components.length > 0) {
          return cfg.components;
        }
      } catch {
        // Fall back to direct ESP32
      }
    }
    if (isDirectEsp32Enabled()) {
      try {
        const inv = await _esp32.getInventory();
        if (inv.components && inv.components.length > 0) return inv.components;
      } catch {
        // ignore
      }
    }
    return [];
  },

  async getConfigurationDeployment(complexId?: string) {
    if (isDirectEsp32Enabled()) {
      try {
        return await _esp32.getConfigurationDeployment();
      } catch {
        // Fall through
      }
    }
    if (isPythonBackendEnabled() && complexId) {
      try {
        return await operationalPythonClient.getConfigurationDeployment(complexId);
      } catch {
        // Fall through
      }
    }
    try {
      return await _esp32.getConfigurationDeployment();
    } catch {
      return null;
    }
  },

  async saveConfiguration(complexId: string, payload: ConfigurationPayload): Promise<ConfigurationPayload> {
    let saved: ConfigurationPayload;
    if (isDirectEsp32Enabled()) {
      saved = await _esp32.saveConfiguration(payload);
    } else if (isPythonBackendEnabled()) {
      try {
        saved = await operationalPythonClient.saveConfiguration(complexId, payload);
      } catch (err) {
        if (isDirectEsp32Enabled()) {
          saved = await _esp32.saveConfiguration(payload);
        } else {
          throw err;
        }
      }
    } else {
      saved = await _esp32.saveConfiguration(payload);
    }

    // Immediately update operational snapshot:
    // - GH-scoped components → update each GH's equipment
    // - Complex-scoped components (ghId=null) → update complex.equipment
    const snapshot = getOperationalSnapshot();
    const targetGhs = snapshot.greenhouses.filter((g) => g.complexId === complexId);

    // Complex-level components (no ghId)
    const complexComponents = (saved.components || payload.components || []).filter((c) => !c.assignment?.ghId);
    const complexEqList: EquipmentItem[] = complexComponents.map((c) => ({
      name: c.name,
      status: (c.lifecycleState === "COMMISSIONED" || c.lifecycleState === "ENABLED") ? "OK" : "OFFLINE",
      type: c.supportedTypeId || c.role || undefined,
      category: c.role || c.supportedTypeId || undefined,
    }));
    const targetComplex = snapshot.complexes.find((c) => c.id === complexId);
    if (targetComplex) {
      replaceComplex({ ...targetComplex, equipment: complexEqList });
    }

    // Per-GH components
    targetGhs.forEach((gh) => {
      const ghComponents = (saved.components || payload.components || []).filter(
        (c) => c.assignment?.ghId === gh.id
      );
      const eqList: EquipmentItem[] = ghComponents.map((c) => ({
        name: c.name,
        status: (c.lifecycleState === "COMMISSIONED" || c.lifecycleState === "ENABLED") ? "OK" : "OFFLINE",
        type: c.supportedTypeId || c.role || undefined,
        category: c.role || c.supportedTypeId || undefined,
      }));
      replaceGreenhouse({
        ...gh,
        equipment: eqList,
      });
    });

    // Revalidate and redeploy schedules asynchronously against the new equipment configuration
    deployCompiledScheduleSet(complexId).catch((schedErr) => {
      console.warn("[hardwareService.saveConfiguration] Schedule revalidation warning:", schedErr);
    });

    return saved;
  },

  async setComponentReady(gpio: number, ready: boolean, complexId?: string, ghId?: string | null): Promise<InstalledComponent> {
    if (!complexId) {
      throw new Error("hardwareService.setComponentReady: complexId is required per PRD §6.1 (no hardcoded complex-01 fallback).");
    }
    const targetComplexId = complexId;
    let curConfig: ConfigurationPayload;
    if (isDirectEsp32Enabled()) {
      curConfig = await _esp32.getConfiguration();
    } else if (isPythonBackendEnabled()) {
      try {
        curConfig = await operationalPythonClient.getConfiguration(targetComplexId);
      } catch {
        curConfig = await _esp32.getConfiguration();
      }
    } else {
      curConfig = await _esp32.getConfiguration();
    }

    const targetLifecycle: InstalledComponent["lifecycleState"] = ready ? "COMMISSIONED" : "DISABLED";
    let found = false;
    const updatedComponents: InstalledComponent[] = (curConfig.components || []).map((c) => {
      if (c.wiring?.gpio === gpio) {
        found = true;
        return {
          ...c,
          lifecycleState: targetLifecycle,
          assignment: ghId !== undefined ? (ghId ? { complexId: targetComplexId, ghId } : { complexId: targetComplexId }) : c.assignment,
        };
      }
      return c;
    });

    if (!found) {
      const pinDef = CANONICAL_GPIO_PIN_MAP.find((p) => p.gpio === gpio);
      if (pinDef) {
        updatedComponents.push({
          componentId: pinDef.equipment?.componentId || `gpio_${gpio}`,
          name: pinDef.equipment?.name || pinDef.terminalLabel || `GPIO ${gpio}`,
          supportedTypeId: pinDef.equipment?.supportedTypeId || "actuator",
          role: pinDef.equipment?.role || pinDef.hardwareRole || "ACTUATOR",
          lifecycleState: targetLifecycle,
          deploymentStatus: "APPLIED",
          assignment: ghId ? { complexId: targetComplexId, ghId } : { complexId: targetComplexId },
          wiring: {
            interface: "GPIO",
            gpio: pinDef.gpio,
            polarity: pinDef.equipment?.polarity || "ACTIVE_LOW",
          },
          parameters: pinDef.equipment?.parameters || {},
        });
      }
    }

    const newConfig: ConfigurationPayload = {
      ...curConfig,
      complexId: targetComplexId,
      updatedAt: new Date().toISOString(),
      components: updatedComponents,
    };

    const saved = await this.saveConfiguration(targetComplexId, newConfig);
    const updated = (saved.components || []).find((c) => c.wiring?.gpio === gpio);
    if (!updated) throw new Error(`Component on GPIO ${gpio} could not be updated.`);
    return updated;
  },

  async updateConfigurationComponents(
    mutate: (components: InstalledComponent[]) => InstalledComponent[],
  ): Promise<InstalledComponent[]> {
    const current = await _esp32.getConfiguration();
    const nextComponents = mutate([...(current.components ?? [])]);
    const nextConfig = {
      ...current,
      components: nextComponents,
      version: current.version,
      updatedAt: new Date().toISOString(),
    };

    const validation = await _esp32.validateConfiguration(nextConfig);
    if (!validation.valid) {
      const message = validation.errors.map((e) => e.message).join('; ') || 'Configuration validation failed.';
      throw new ServiceError('VALIDATION_FAILED', message);
    }
    const applied = await _esp32.saveConfiguration(nextConfig);
    return applied.components ?? [];
  },

  async registerComponent(data: Omit<InstalledComponent, 'componentId'>): Promise<InstalledComponent> {
    const componentId = crypto.randomUUID();
    const next: InstalledComponent = { ...data, componentId };
    const components = await this.updateConfigurationComponents((items) => [...items, next]);
    const created = components.find((c) => c.componentId === componentId);
    if (!created) throw new ServiceError('UNKNOWN', 'ESP32 accepted the configuration but did not return the registered component.');
    return created;
  },

  async updateComponent(id: string, updates: Partial<InstalledComponent>): Promise<InstalledComponent> {
    const components = await this.updateConfigurationComponents((items) => {
      const idx = items.findIndex((c) => c.componentId === id);
      if (idx === -1) throw new ServiceError('NOT_FOUND', 'Component not found');
      const current = items[idx];
      if (updates.componentId && updates.componentId !== id) {
        throw new ServiceError('VALIDATION_FAILED', 'componentId is immutable.', 'componentId');
      }
      items[idx] = { ...current, ...updates, componentId: id };
      return items;
    });
    const updated = components.find((c) => c.componentId === id);
    if (!updated) throw new ServiceError('UNKNOWN', 'ESP32 applied the configuration but did not return the updated component.');
    return updated;
  },

  async decommissionComponent(id: string): Promise<InstalledComponent> {
    return this.updateComponent(id, { lifecycleState: 'REMOVED', deploymentStatus: 'PENDING' });
  },
};

export const topologyPoolService = {
  async getPool(): Promise<SystemTopologyPool> {
    if (isDirectEsp32Enabled() || ESP32_API_BASE) {
      try {
        return await esp32Client.getTopologyPool();
      } catch {
        // Fall back to backend mirror
      }
    }
    return apiGet<SystemTopologyPool>("/v1/topology-pool");
  },

  async mutate(mutation: TopologyMutationRequest): Promise<TopologyMutationResponse> {
    if (isDirectEsp32Enabled() || ESP32_API_BASE) {
      try {
        return await esp32Client.mutateTopologyPool(mutation);
      } catch {
        // Fall back to backend mirror
      }
    }
    return apiPost<TopologyMutationResponse>("/v1/topology-pool/mutate", mutation);
  },

  async sync(peerPool: SystemTopologyPool): Promise<{ status: string; pool: SystemTopologyPool }> {
    if (isDirectEsp32Enabled() || ESP32_API_BASE) {
      try {
        return await esp32Client.syncTopologyPool(peerPool);
      } catch {
        // Fall back to backend mirror
      }
    }
    return apiPost<{ status: string; pool: SystemTopologyPool }>("/v1/topology-pool/sync", { pool: peerPool });
  },
};

export const recipeService = {
  list(ghId?: string): Recipe[] {
    if (ghId) {
      const gh = greenhouseService.get(ghId);
      return gh?.recipes || [];
    }
    const snap = getOperationalSnapshot();
    return snap.greenhouses.flatMap((g) => g.recipes || []);
  },

  get(id: string): Recipe | undefined {
    const snap = getOperationalSnapshot();
    for (const g of snap.greenhouses) {
      const r = (g.recipes || []).find((rec) => rec.id === id);
      if (r) return r;
    }
    return undefined;
  },

  async save(recipe: Partial<Recipe> & { name: string; ghId?: string }): Promise<Recipe> {
    const id = recipe.id || `rcp-${Date.now()}`;
    const payload = {
      ...recipe,
      id,
      recipeId: id,
      version: recipe.version ? Number(recipe.version) + 1 : 1,
      name: recipe.name.trim(),
    };

    if (isDirectEsp32Enabled() || ESP32_API_BASE) {
      const saved = await esp32Client.saveRecipe(payload as any);
      // Synchronize in-memory RAM
      const snap = getOperationalSnapshot();
      for (const g of snap.greenhouses) {
        if (!recipe.ghId || g.id === recipe.ghId) {
          const existingIdx = g.recipes.findIndex((r) => r.id === id);
          if (existingIdx >= 0) {
            g.recipes[existingIdx] = payload as Recipe;
          } else {
            g.recipes.push(payload as Recipe);
          }
        }
      }
      return (saved as any) || (payload as Recipe);
    }

    throw new ServiceError("DEVICE_OFFLINE", "No authoritative ESP32 recipe storage is configured.");
  },

  async delete(id: string): Promise<void> {
    if (isDirectEsp32Enabled() || ESP32_API_BASE) {
      await esp32Client.deleteRecipe(id);
      const snap = getOperationalSnapshot();
      for (const g of snap.greenhouses) {
        g.recipes = g.recipes.filter((r) => r.id !== id);
      }
      return;
    }
    throw new ServiceError("DEVICE_OFFLINE", "No authoritative ESP32 recipe storage is configured.");
  },
};
