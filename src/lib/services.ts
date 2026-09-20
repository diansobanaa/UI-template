/**
 * Frontend service layer — the ONLY boundary UI components use to reach data.
 *
 * UI components use this service layer exclusively. Operational state is read
 * from the Python-owned REST backend (with live ESP32 data merged into the
 * in-memory client cache). Client-side mock/seed state is not a valid operational authority.
 */
import { ServiceError } from "./errors";
import type {
  AlertItem, CalibrationDevice, CalibrationRecord, Complex, CropCycle, CycleStatus, EventItem,
  FertigationSchedule, FanSchedule, Greenhouse, ObservationDraft, WellPumpSchedule, Observation, ResearchObservation, FertigationSystemStatus,
} from "./types";
import { esp32Client } from "./api/esp32-client";
import { isDirectEsp32Enabled, isPythonBackendEnabled, ESP32_API_BASE } from "./api/backend-client";
import { PythonClient } from "./api/python-client";
import type { CompiledSchedule, ConfigurationPayload, CurrentCropCycleResponse, TelemetryHistoryResponse, TelemetrySnapshot } from "./api/contracts";
import { compileScheduleSet } from "./runtime/schedule-compiler.js";
import { getOperationalSnapshot, replaceComplex, replaceGreenhouse, operationalPythonClient, hydrateOperationalState } from "./operational-state";
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
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for Complex management.");
    const created = await operationalPythonClient.createComplex({ location: location.trim(), code: options?.code, name: options?.name });
    replaceComplex(created);
    return created;
  },
  async bindEsp32Controller(complexId: string, input: { deviceId: string; endpoint: string; apiVersion?: string; schemaVersion?: number; firmwareVersion?: string; hardwareModel?: string; inventoryVersion?: number }): Promise<Complex> {
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required to persist the controller binding.");
    if (!input.deviceId.trim()) throw new ServiceError("VALIDATION_FAILED", "ESP32 device ID is required.", "deviceId");
    if (!input.endpoint.trim()) throw new ServiceError("VALIDATION_FAILED", "ESP32 endpoint is required.", "endpoint");
    const bound = await operationalPythonClient.bindEsp32Controller(complexId, { ...input, deviceId: input.deviceId.trim(), endpoint: input.endpoint.trim() });
    replaceComplex(bound);
    return bound;
  },
  async update(id: string, patch: Partial<Pick<Complex, "code" | "name" | "location" | "status">>): Promise<Complex> {
    if (patch.code !== undefined && !patch.code.trim()) throw new ServiceError("VALIDATION_FAILED", "Complex code is required.", "code");
    if (patch.name !== undefined && !patch.name.trim()) throw new ServiceError("VALIDATION_FAILED", "Complex name is required.", "name");
    if (patch.location !== undefined && !patch.location.trim()) throw new ServiceError("VALIDATION_FAILED", "Location is required.", "location");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for Complex management.");
    const updated = await operationalPythonClient.updateComplex(id, patch);
    replaceComplex(updated);
    return updated;
  },
};

export const greenhouseService = {
  byComplex(complexId: string): Greenhouse[] {
    return getOperationalSnapshot().greenhouses.filter((g) => g.complexId === complexId);
  },
  get(id: string): Greenhouse | undefined {
    return getOperationalSnapshot().greenhouses.find((g) => g.id === id);
  },
  async create(complexId: string, crop: string): Promise<Greenhouse> {
    assertFound(complexService.get(complexId), "Complex");
    if (!crop.trim()) throw new ServiceError("VALIDATION_FAILED", "Crop is required.", "crop");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for Greenhouse management.");
    const created = await operationalPythonClient.createGreenhouse(complexId, { crop: crop.trim() });
    replaceGreenhouse(created);
    const complex = complexService.get(complexId);
    if (complex && !complex.greenhouseIds.includes(created.id)) replaceComplex({ ...complex, greenhouseIds: [...complex.greenhouseIds, created.id] });
    return created;
  },
  async update(id: string, patch: Partial<Pick<Greenhouse, "code" | "crop" | "greenhouseTag">>): Promise<Greenhouse> {
    if (patch.code !== undefined && !patch.code.trim()) throw new ServiceError("VALIDATION_FAILED", "Greenhouse code is required.", "code");
    if (patch.crop !== undefined && !patch.crop.trim()) throw new ServiceError("VALIDATION_FAILED", "Crop is required.", "crop");
    if (patch.greenhouseTag !== undefined && !patch.greenhouseTag.trim()) throw new ServiceError("VALIDATION_FAILED", "Greenhouse tag is required.", "greenhouseTag");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for Greenhouse management.");
    const updated = await operationalPythonClient.updateGreenhouse(id, patch);
    replaceGreenhouse(updated);
    return updated;
  },
};

function applyEsp32CycleToStore(ghId: string, resp: CurrentCropCycleResponse): Greenhouse {
  const gh = greenhouseService.get(ghId);
  if (!gh) throw new ServiceError("NOT_FOUND", "Greenhouse not found.");

  const mappedStatus: CycleStatus =
    resp.status === "ACTIVE" ? "ACTIVE" :
    resp.status === "HARVESTED" ? "HARVESTED" :
    resp.status === "CANCELLED" ? "CANCELLED" : "NO_CYCLE";

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
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;
      } catch (err: unknown) {
        const errorObj = err as { status?: number; message?: string };
        if (errorObj?.status === 409) {
          throw new ServiceError("CONFLICT", "Siklus tanam sudah aktif pada greenhouse ini.");
        }
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal memulai siklus tanam pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
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
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal import siklus berjalan pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
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
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal mencatat polinasi pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
  },

  async updateTanggalTanam(ghId: string, newTanggalTanam: string): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.updatePlantingDate(ghId, cycleId, {
          tanggalTanam: newTanggalTanam,
        });
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update tanggal tanam pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
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
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update tanggal polinasi pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
  },

  async updateMetadata(
    ghId: string,
    updates: { variety?: string; plantCount?: number; notes?: string; cropTimelineConfig?: import("./cropTimelineConfig").CropTimelineConfig }
  ): Promise<Greenhouse> {
    if (updates.cropTimelineConfig) {
      if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required to persist crop timeline configuration.");
      const updated = await operationalPythonClient.updateGreenhouse(ghId, { cropTimelineConfig: updates.cropTimelineConfig });
      replaceGreenhouse(updated);
      return updated;
    }
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.updateCropCycleMetadata(ghId, cycleId, updates);
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal update metadata siklus pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
  },

  async deleteTanggalPolinasi(ghId: string): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.deletePollination(ghId, cycleId);
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal hapus tanggal polinasi pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
  },

  async resetCycle(ghId: string): Promise<Greenhouse> {
    if (isDirectEsp32Enabled()) {
      try {
        const cycleId = "active";
        const resp = await esp32Client.cancelCropCycle(ghId, cycleId, {});
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;

      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal reset siklus tanam pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
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
        const updated = applyEsp32CycleToStore(ghId, resp); await persistEsp32ResearchCycle(ghId, resp); return updated;
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Gagal panen siklus tanam pada ESP32.");
      }
    }
    throw new ServiceError("DEVICE_OFFLINE", "Crop-cycle operations require a reachable authoritative ESP32.");
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
  async syncCurrent(complexId: string, ghId: string): Promise<TelemetrySnapshot> {
    const snapshot = isDirectEsp32Enabled()
      ? await esp32Client.getTelemetry(ghId)
      : await operationalPythonClient.getTelemetry(complexId, ghId);
    latestTelemetryCache.set(`${complexId}:${ghId}`, snapshot);
    return snapshot;
  },
  async syncHistory(complexId: string, ghId: string, options: { limit?: number } = {}): Promise<TelemetryHistoryResponse> {
    const history = isDirectEsp32Enabled()
      ? await esp32Client.getTelemetryHistory(ghId, undefined, options.limit ?? 200)
      : await operationalPythonClient.getTelemetryHistory(complexId, ghId, { limit: options.limit ?? 200 });
    telemetryHistoryCache.set(`${complexId}:${ghId}`, history);
    return history;
  },
};

/* -------------------------- schedules ---------------------------- */

function repeatToTrigger(item: { repeat: string; trigger?: string; time: string; date?: string; intervalHours?: number }): Record<string, unknown> {
  const [rawHour, rawMinute] = (item.time || "08:00").split(":").map(Number);
  const hour = Number.isInteger(rawHour) ? rawHour : 8;
  const minute = Number.isInteger(rawMinute) ? rawMinute : 0;
  const trigger = (item.trigger || "").toLowerCase();
  const repeat = (item.repeat || "Every Day").toLowerCase();
  const daysOfWeek = repeat === "every weekday" ? 31 : repeat === "every weekend" ? 96 : repeat === "mon, wed, fri" ? 21 : repeat === "tue, thu" ? 10 : 127;
  if (trigger.includes("interval") || repeat.includes("interval")) {
    return { type: "INTERVAL", intervalMin: Math.max(1, Math.round((item.intervalHours || 1) * 60)) };
  }
  if (repeat === "once" || trigger.includes("specific-date")) {
    return { type: "ONCE", timestamp: item.date ? new Date(`${item.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString() : "" };
  }
  return { type: "DAILY", hour, minute, daysOfWeek };
}

function fertigationIntent(schedule: FertigationSchedule, complexId: string) {
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
    missedRunPolicy: schedule.missedPolicy.toUpperCase(),
    fallbackEnabled: schedule.fallbackEnabled === true,
    fallbackScheduleId: schedule.fallbackScheduleId,
    parameters: {
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
  return {
    scheduleId: schedule.id,
    ownerId: schedule.id,
    complexId: schedule.complexId,
    action: "WATER_PUMP",
    enabled: schedule.enabled,
    priority: 100,
    trigger: repeatToTrigger(schedule),
    missedRunPolicy: "SKIP",
    parameters: { durationSec: Math.max(1, Math.round(schedule.durationMin * 60)) },
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
  const greenhouseIds = new Set(greenhouseService.byComplex(configuration.complexId).map((g) => g.id));
  const fertigation = overrides.fertigation ?? greenhouseService.byComplex(configuration.complexId).flatMap((g) => g.fertigationSchedules);
  const complex = complexService.get(configuration.complexId);
  const wellPump = overrides.wellPump ?? complex?.wellPumpSchedules ?? [];
  const fan = overrides.fan ?? greenhouseService.byComplex(configuration.complexId).flatMap((g) => g.fanSchedules).filter((s) => greenhouseIds.has(s.ghId));
  return [
    ...fertigation.map((s) => fertigationIntent(s, configuration.complexId)),
    ...wellPump.map(wellPumpIntent),
    ...fan.map((s) => fanIntent(s, configuration.complexId)),
  ];
}

const pythonScheduleClient = new PythonClient();

async function deployCompiledScheduleSet(complexId: string, overrides: {
  fertigation?: FertigationSchedule[];
  wellPump?: WellPumpSchedule[];
  fan?: FanSchedule[];
} = {}, candidateScheduleId?: string): Promise<CompiledSchedule[]> {
  const configuration = await loadAuthoritativeConfiguration(complexId);
  const result = compileScheduleSet(configuration, scheduleIntentsForComplex(configuration, overrides), { nowTimestamp: Date.now() });
  const candidate = candidateScheduleId ? result.results.find((r: any) => r.scheduleId === candidateScheduleId) : null;
  if (candidate && candidate.status === "INVALID") {
    const reasons = (candidate.errors || []).map((e: any) => e.message).filter(Boolean).join("; ");
    throw new ServiceError("VALIDATION_FAILED", reasons || "Schedule candidate is invalid.");
  }
  if (candidate && candidate.status === "BLOCKED") {
    const reasons = (candidate.blockedReasons || []).map((e: any) => e.message).filter(Boolean).join("; ");
    throw new ServiceError("CONFLICT", reasons || "Schedule candidate is blocked by dependencies or resources.");
  }
  // Existing blocked schedules are intentionally omitted from the executable device set;
  // they remain visible in the UI and are surfaced as blocked by the compiler.
  const compiled: CompiledSchedule[] = (Array.isArray(result.compiled) ? result.compiled : []) as unknown as CompiledSchedule[];
  const deploymentId = `web-schedules-${configuration.version}-${Date.now()}`;
  if (isPythonBackendEnabled()) {
    const remote = await pythonScheduleClient.deploySchedules(
      complexId,
      configuration,
      scheduleIntentsForComplex(configuration, overrides) as Array<Record<string, unknown>>,
      {
        deploymentId,
        esp32BaseUrl: isDirectEsp32Enabled() ? ESP32_API_BASE : undefined,
      },
    );
    if (remote.status !== "DEPLOYED" && remote.status !== "READY_FOR_DEVICE") {
      throw new ServiceError("CONFLICT", remote.error || `Schedule deployment '${deploymentId}' was not accepted.`);
    }
    const remoteCompiled = Array.isArray(remote.compiled) ? remote.compiled : [];
    return remoteCompiled.length ? remoteCompiled as CompiledSchedule[] : compiled;
  }

  try {
    await esp32Client.deployCompiledSchedules({
      deploymentId,
      configurationVersion: configuration.version,
      configurationHash: configuration.configurationHash ?? null,
      compiled,
    });
  } catch (err: any) {
    // A timeout can be ambiguous. Reconcile against the device's current compiled set before failing.
    try {
      const remote = await esp32Client.getCompiledSchedules();
      const remoteIds = new Set((remote.compiled || []).map((x) => x.scheduleId));
      const localIds = new Set(compiled.map((x) => x.scheduleId));
      const same = remote.configurationVersion === configuration.version && remoteIds.size === localIds.size && [...localIds].every((id) => remoteIds.has(id));
      if (same) return compiled;
    } catch { /* keep original error */ }
    throw new ServiceError("CONFLICT", `Schedule deployment '${deploymentId}' was not acknowledged by the ESP32; device reconciliation is required.`, undefined);
  }
  return compiled;
}

async function loadAuthoritativeConfiguration(complexId: string): Promise<ConfigurationPayload> {
  if (isDirectEsp32Enabled()) {
    const configuration = await esp32Client.getConfiguration();
    if (configuration.complexId !== complexId) throw new ServiceError("CONFLICT", `ESP32 active configuration belongs to '${configuration.complexId}', not '${complexId}'.`);
    return configuration;
  }
  if (isPythonBackendEnabled()) {
    const configuration = await pythonScheduleClient.getConfiguration(complexId);
    if (configuration.complexId !== complexId) throw new ServiceError("CONFLICT", `Backend active configuration belongs to '${configuration.complexId}', not '${complexId}'.`);
    return configuration;
  }
  throw new ServiceError("DEVICE_OFFLINE", "No authoritative configuration source is configured.");
}

export const scheduleService = {
  fertigationForGh(ghId: string): FertigationSchedule[] { return greenhouseService.get(ghId)?.fertigationSchedules ?? []; },
  wellPumpForComplex(complexId: string): WellPumpSchedule[] { return complexService.get(complexId)?.wellPumpSchedules ?? []; },
  waterTransferForComplex(_complexId: string): import("./types").WaterTransferSchedule[] { return []; },
  fanForGh(ghId: string): FanSchedule[] { return greenhouseService.get(ghId)?.fanSchedules ?? []; },

  async createFertigation(input: Omit<FertigationSchedule, "id">): Promise<FertigationSchedule> {
    const gh = assertFound(greenhouseService.get(input.ghId), "Greenhouse");
    if (!gh.recipes.some((r) => r.id === input.recipeId)) throw new ServiceError("INVALID_RELATIONSHIP", "The selected recipe does not belong to this greenhouse.", "recipeId");
    if (!input.name.trim()) throw new ServiceError("VALIDATION_FAILED", "Schedule name is required.", "name");
    if (gh.fertigationSchedules.some((s) => s.name.toLowerCase() === input.name.trim().toLowerCase())) throw new ServiceError("DUPLICATE_ID", `A fertigation schedule named "${input.name.trim()}" already exists in this greenhouse.`, "name");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    const response = await operationalPythonClient.createSchedule(gh.complexId, "fertigation", { ...input, name: input.name.trim() });
    await hydrateOperationalState();
    const created = greenhouseService.get(input.ghId)?.fertigationSchedules.find((s) => s.id === String(response.schedule.id));
    if (!created) throw new ServiceError("UNKNOWN", "Backend accepted the schedule but it was not returned in the operational context.");
    if (isDirectEsp32Enabled() || isPythonBackendEnabled()) {
      try { await deployCompiledScheduleSet(gh.complexId, {}, created.id); }
      catch (err) {
        await operationalPythonClient.deleteSchedule(created.id);
        await hydrateOperationalState();
        throw err;
      }
    }
    return created;
  },

  async updateFertigation(id: string, patch: Partial<FertigationSchedule>): Promise<FertigationSchedule> {
    const greenhouse = getOperationalSnapshot().greenhouses.find((g) => g.fertigationSchedules.some((s) => s.id === id));
    const existing = assertFound(greenhouse?.fertigationSchedules.find((s) => s.id === id), "Schedule");
    const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ServiceError("VALIDATION_FAILED", "Schedule name is required.", "name");
      if (gh.fertigationSchedules.some((s) => s.id !== id && s.name.toLowerCase() === patch.name!.trim().toLowerCase())) throw new ServiceError("DUPLICATE_ID", `A fertigation schedule named "${patch.name.trim()}" already exists in this greenhouse.`, "name");
      patch = { ...patch, name: patch.name.trim() };
    }
    const proposed = { ...existing, ...patch };
    if (patch.recipeId !== undefined && !gh.recipes.some((r) => r.id === patch.recipeId)) throw new ServiceError("INVALID_RELATIONSHIP", "The selected recipe does not belong to this greenhouse.", "recipeId");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    await operationalPythonClient.updateSchedule(id, "fertigation", proposed as unknown as Record<string, unknown>);
    await hydrateOperationalState();
    const updated = greenhouseService.get(existing.ghId)?.fertigationSchedules.find((s) => s.id === id);
    if (!updated) throw new ServiceError("UNKNOWN", "Backend accepted the schedule update but the schedule disappeared from context.");
    try { await deployCompiledScheduleSet(gh.complexId, {}, id); }
    catch (err) {
      await operationalPythonClient.updateSchedule(id, "fertigation", existing as unknown as Record<string, unknown>);
      await hydrateOperationalState();
      throw err;
    }
    return updated;
  },

  async deleteFertigation(id: string): Promise<void> {
    const greenhouse = getOperationalSnapshot().greenhouses.find((g) => g.fertigationSchedules.some((s) => s.id === id));
    const existing = assertFound(greenhouse?.fertigationSchedules.find((s) => s.id === id), "Schedule");
    const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    const remaining = gh.fertigationSchedules.filter((s) => s.id !== id);
    await operationalPythonClient.deleteSchedule(id);
    await hydrateOperationalState();
    try { await deployCompiledScheduleSet(gh.complexId, { fertigation: remaining }); }
    catch (err) {
      await operationalPythonClient.createSchedule(gh.complexId, "fertigation", existing as unknown as Record<string, unknown>);
      await hydrateOperationalState();
      throw err;
    }
  },

  async createWellPump(input: Omit<WellPumpSchedule, "id">): Promise<WellPumpSchedule> {
    assertFound(complexService.get(input.complexId), "Complex");
    if (!input.task.trim()) throw new ServiceError("VALIDATION_FAILED", "Task name is required.", "task");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    const existing = this.wellPumpForComplex(input.complexId);
    if (existing.some((s) => s.task.toLowerCase() === input.task.trim().toLowerCase())) throw new ServiceError("DUPLICATE_ID", `A well pump schedule named "${input.task.trim()}" already exists in this complex.`, "task");
    const response = await operationalPythonClient.createSchedule(input.complexId, "wellPump", { ...input, task: input.task.trim() });
    await hydrateOperationalState();
    const created = this.wellPumpForComplex(input.complexId).find((s) => s.id === String(response.schedule.id));
    if (!created) throw new ServiceError("UNKNOWN", "Backend accepted the well pump schedule but it was not returned in operational context.");
    try { await deployCompiledScheduleSet(input.complexId, {}, created.id); }
    catch (err) { await operationalPythonClient.deleteSchedule(created.id); await hydrateOperationalState(); throw err; }
    return created;
  },

  async updateWellPump(id: string, patch: Partial<WellPumpSchedule>): Promise<WellPumpSchedule> {
    const complex = getOperationalSnapshot().complexes.find((c) => c.wellPumpSchedules?.some((s) => s.id === id));
    const existing = assertFound(complex?.wellPumpSchedules?.find((s) => s.id === id), "Schedule");
    if (patch.task !== undefined && !patch.task.trim()) throw new ServiceError("VALIDATION_FAILED", "Task name is required.", "task");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    const proposed = { ...existing, ...patch, ...(patch.task ? { task: patch.task.trim() } : {}) };
    if (this.wellPumpForComplex(existing.complexId).some((s) => s.id !== id && s.task.toLowerCase() === proposed.task.toLowerCase())) throw new ServiceError("DUPLICATE_ID", `A well pump schedule named "${proposed.task}" already exists in this complex.`, "task");
    await operationalPythonClient.updateSchedule(id, "wellPump", proposed as unknown as Record<string, unknown>);
    await hydrateOperationalState();
    const updated = this.wellPumpForComplex(existing.complexId).find((s) => s.id === id);
    if (!updated) throw new ServiceError("UNKNOWN", "Backend accepted the well pump update but it was not returned in operational context.");
    try { await deployCompiledScheduleSet(existing.complexId, {}, id); }
    catch (err) { await operationalPythonClient.updateSchedule(id, "wellPump", existing as unknown as Record<string, unknown>); await hydrateOperationalState(); throw err; }
    return updated;
  },

  async deleteWellPump(id: string): Promise<void> {
    const complex = getOperationalSnapshot().complexes.find((c) => c.wellPumpSchedules?.some((s) => s.id === id));
    const existing = assertFound(complex?.wellPumpSchedules?.find((s) => s.id === id), "Schedule");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    const remaining = this.wellPumpForComplex(existing.complexId).filter((s) => s.id !== id);
    await operationalPythonClient.deleteSchedule(id);
    await hydrateOperationalState();
    try { await deployCompiledScheduleSet(existing.complexId, { wellPump: remaining }); }
    catch (err) { await operationalPythonClient.createSchedule(existing.complexId, "wellPump", existing as unknown as Record<string, unknown>); await hydrateOperationalState(); throw err; }
  },

  async createFan(input: Omit<FanSchedule, "id">): Promise<FanSchedule> {
    const gh = assertFound(greenhouseService.get(input.ghId), "Greenhouse");
    if (input.mode === "temperature" && (input.onAboveC ?? 0) <= (input.offBelowC ?? 0)) throw new ServiceError("VALIDATION_FAILED", "Fan ON threshold must be higher than the OFF threshold.", "onAboveC");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    const response = await operationalPythonClient.createSchedule(gh.complexId, "fan", input as unknown as Record<string, unknown>);
    await hydrateOperationalState();
    const created = greenhouseService.get(input.ghId)?.fanSchedules.find((s) => s.id === String(response.schedule.id));
    if (!created) throw new ServiceError("UNKNOWN", "Backend accepted the fan schedule but it was not returned in operational context.");
    try { await deployCompiledScheduleSet(gh.complexId, {}, created.id); }
    catch (err) { await operationalPythonClient.deleteSchedule(created.id); await hydrateOperationalState(); throw err; }
    return created;
  },

  async updateFan(id: string, patch: Partial<FanSchedule>): Promise<FanSchedule> {
    const greenhouse = getOperationalSnapshot().greenhouses.find((g) => g.fanSchedules.some((s) => s.id === id));
    const existing = assertFound(greenhouse?.fanSchedules.find((s) => s.id === id), "Schedule");
    const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");
    const merged = { ...existing, ...patch };
    if (merged.mode === "temperature" && (merged.onAboveC ?? 0) <= (merged.offBelowC ?? 0)) throw new ServiceError("VALIDATION_FAILED", "Fan ON threshold must be higher than the OFF threshold.", "onAboveC");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    await operationalPythonClient.updateSchedule(id, "fan", merged as unknown as Record<string, unknown>);
    await hydrateOperationalState();
    const updated = greenhouseService.get(existing.ghId)?.fanSchedules.find((s) => s.id === id);
    if (!updated) throw new ServiceError("UNKNOWN", "Backend accepted the fan update but it was not returned in operational context.");
    try { await deployCompiledScheduleSet(gh.complexId, {}, id); }
    catch (err) { await operationalPythonClient.updateSchedule(id, "fan", existing as unknown as Record<string, unknown>); await hydrateOperationalState(); throw err; }
    return updated;
  },

  async deleteFan(id: string): Promise<void> {
    const greenhouse = getOperationalSnapshot().greenhouses.find((g) => g.fanSchedules.some((s) => s.id === id));
    const existing = assertFound(greenhouse?.fanSchedules.find((s) => s.id === id), "Schedule");
    const gh = assertFound(greenhouseService.get(existing.ghId), "Greenhouse");
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python backend is required for schedule persistence.");
    const remaining = gh.fanSchedules.filter((s) => s.id !== id);
    await operationalPythonClient.deleteSchedule(id);
    await hydrateOperationalState();
    try { await deployCompiledScheduleSet(gh.complexId, { fan: remaining }); }
    catch (err) { await operationalPythonClient.createSchedule(gh.complexId, "fan", existing as unknown as Record<string, unknown>); await hydrateOperationalState(); throw err; }
  },
};

/* -------------------------- calibration -------------------------- */

export const calibrationService = {
  devices(): CalibrationDevice[] { return []; },
  history(): CalibrationRecord[] { return []; },
  async loadAuthoritative(complexId: string): Promise<{ devices: CalibrationDevice[]; history: CalibrationRecord[] }> {
    if (!isDirectEsp32Enabled() && !isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Calibration requires an authoritative device/backend connection.");
    const inventory = isDirectEsp32Enabled()
      ? await esp32Client.getInventory()
      : await pythonScheduleClient.getInventory(complexId);
    const records = isPythonBackendEnabled()
      ? (await pythonScheduleClient.listCalibrations(complexId)).calibrations
      : [];
    const latestByComponent = new Map<string, any>();
    for (const record of records) {
      const previous = latestByComponent.get(record.componentId);
      if (!previous || record.version > previous.version) latestByComponent.set(record.componentId, record);
    }
    const devices: CalibrationDevice[] = (inventory.components ?? [])
      .filter((component) => ["COMMISSIONED", "ENABLED"].includes(component.lifecycleState))
      .filter((component) => /DOSING|PH|EC/i.test(`${component.role ?? ""} ${component.supportedTypeId ?? ""} ${component.name ?? ""}`))
      .map((component) => {
        const text = `${component.role ?? ""} ${component.supportedTypeId ?? ""} ${component.name ?? ""}`.toUpperCase();
        const category: CalibrationDevice["category"] = text.includes("DOSING") ? "dosing-pump" : text.includes("PH") ? "ph" : "ec";
        const assignmentGhId = component.assignment?.ghId ?? null;
        const calibration = latestByComponent.get(component.componentId);
        const validUntil = calibration?.validUntilMs ? new Date(calibration.validUntilMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not scheduled";
        const channel = component.parameters?.channel != null ? String(component.parameters.channel) : undefined;
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
    try {
      if (device.category === "dosing-pump") {
        const measuredMl = parseFloat(after);
        if (!Number.isFinite(measuredMl) || measuredMl <= 0) throw new ServiceError("VALIDATION_FAILED", "Measured dosing volume must be positive.");
        const version = Date.now();
        if (isDirectEsp32Enabled()) {
          await esp32Client.saveCalibrationRate(componentId, measuredMl / 30.0);
        } else if (isPythonBackendEnabled()) {
          const complexId = device.ghId ? greenhouseService.get(device.ghId)?.complexId : undefined;
          if (!complexId) throw new ServiceError("VALIDATION_FAILED", "Calibration device is not assigned to a Complex.");
          await pythonScheduleClient.saveCalibration(complexId, { calibrationType: "DOSING_RATE", componentId, measuredMl, durationSec: 30, operator: user, state: "CALIBRATED" });
        }
      } else if (isPythonBackendEnabled() && device.ghId && (device.category === "ph" || device.category === "ec")) {
        const beforeValue = parseFloat(before);
        const afterValue = parseFloat(after);
        if (Number.isFinite(beforeValue) && Number.isFinite(afterValue) && beforeValue !== afterValue) {
          const calibrationType = device.category === "ph" ? "PH" : "EC";
          const complexId = greenhouseService.get(device.ghId)?.complexId;
          if (!complexId) throw new ServiceError("VALIDATION_FAILED", "Calibration device is not assigned to a Complex.");
          await pythonScheduleClient.saveCalibration(complexId, { calibrationType, componentId, inputOne: beforeValue, outputOne: beforeValue, inputTwo: afterValue, outputTwo: afterValue, operator: user, state: "CALIBRATED" });
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
        const inventory = isDirectEsp32Enabled() ? await esp32Client.getInventory() : await pythonScheduleClient.getInventory(gh.complexId);
        const dosing = (inventory.components ?? []).filter((c) => /DOSING/i.test(`${c.role ?? ""} ${c.supportedTypeId ?? ""} ${c.name ?? ""}`) && ["COMMISSIONED", "ENABLED"].includes(c.lifecycleState));
        const localRecipe = assertFound(gh.recipes.find((r) => r.id === recipeId), "Recipe");
        const channels = (localRecipe as any).dosingChannels?.length ? (localRecipe as any).dosingChannels : dosing.map((c) => ({ componentId: c.componentId, requestedMl: 0 })).filter((x) => x.requestedMl > 0);
        if (!channels.length) throw new ServiceError("VALIDATION_FAILED", "Recipe must define at least one positive dosing channel quantity.", "dosingChannels");
        const request = { ghId, recipeId, targetWaterMl: Math.round(targetWaterL * 1000), dosingChannels: channels, deliveryMode: "VOLUME", safetyAcknowledged: true, triggerType: "MANUAL", source: "UI", operator: "UI", mixingDurationSec: (localRecipe as any).mixingDurationSec ?? 0, targetDeliveredMl: Math.round(targetWaterL * 1000) };
        if (!isPythonBackendEnabled()) {
          throw new ServiceError("DEVICE_OFFLINE", "Manual fertigation requires the authoritative configuration/preparation backend; autonomous ESP32 schedules remain independent of this UI path.");
        }
        const prepared = await pythonScheduleClient.prepareFertigation(gh.complexId, configuration, request);
        if (!prepared.valid || !prepared.run?.executionPlan) throw new ServiceError("CONFLICT", prepared.issues.map((x) => x.message).join("; ") || "Fertigation is blocked by configuration/safety validation.");
        const cmdId = `fert-${gh.complexId}-${ghId}-${Date.now()}`;
        const parameters = { ...request, executionPlan: prepared.run.executionPlan };
        await pythonScheduleClient.postCommand(gh.complexId, { commandId: cmdId, type: "FERTIGATION_START", targetComplexId: gh.complexId, targetGhId: ghId, configurationVersion: configuration.version, source: "FERTIGATION", parameters });
        return;
      } catch (err: unknown) {
        if (err instanceof ServiceError) throw err;
        const errorObj = err as { message?: string };
        throw new ServiceError("VALIDATION_FAILED", errorObj?.message || "Failed to start configuration-driven fertigation.");
      }
    }

    throw new ServiceError("DEVICE_OFFLINE", "No authoritative fertigation execution path is configured.");
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
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python research API is required for observations.");
    if (!draft.plantId.trim()) throw new ServiceError("VALIDATION_FAILED", "Plant ID is required.", "plantId");
    if (!draft.heightCm || draft.heightCm <= 0) throw new ServiceError("VALIDATION_FAILED", "Height must be greater than zero.", "heightCm");
    const cycle = gh.research?.currentCycle;
    if (!cycle) throw new ServiceError("INVALID_RELATIONSHIP", "No active research cycle exists for this greenhouse.", "cycleId");
    await operationalPythonClient.saveResearchObservation(gh.complexId, {
      cycleId: cycle.cycleId, ghId, plantId: draft.plantId.trim(), observedAt: new Date().toISOString(),
      metric: "plant_check", heightCm: draft.heightCm, leafCount: draft.leafCount || null, fruitCount: draft.fruitCount || null,
      notes: draft.notes?.trim() || null, observer: draft.observer?.trim() || null, source: "WEB",
    });
    await hydrateOperationalState();
  },

  async deleteObservation(id: string): Promise<void> {
    if (!isPythonBackendEnabled()) throw new ServiceError("DEVICE_OFFLINE", "Python research API is required for observations.");
    const gh = getOperationalSnapshot().greenhouses.find((g) => g.research?.recentObservations?.some((o) => o.observationId === id));
    if (!gh) throw new ServiceError("NOT_FOUND", "Observation not found.");
    await operationalPythonClient.deleteResearchObservation(gh.complexId, id);
    await hydrateOperationalState();
  },
};

/* --------------------------- hardware (M2 / M3.0) ----------------------- */
import { hardwareCatalog } from './data/hardwareCatalog';
import { SupportedComponentDefinition } from './types/equipment';
// M3.0: Use the canonical OpenAPI-contract InstalledComponent type (from contracts.ts).
// Esp32Client.getInventory() returns this type. types/equipment.ts InstalledComponent
// is structurally equivalent; to be consolidated in a future cleanup milestone.
import type { InstalledComponent } from './api/contracts';
import { Esp32Client } from './api/esp32-client';
import { defaultConfig } from './api/backend-client';

// Installed hardware authority: ActiveConfiguration.components[] -> ESP32 /api/v1/inventory.
const _esp32 = new Esp32Client(defaultConfig);

export const hardwareService = {
  async getSupportedCatalog(): Promise<SupportedComponentDefinition[]> {
    await delay();
    return hardwareCatalog;
  },

  /** Installed inventory is authoritative only when returned by the ESP32 active registry. */
  async getInstalledComponents(): Promise<InstalledComponent[]> {
    const inv = await _esp32.getInventory();
    return inv.components ?? [];
  },

  async getConfigurationDeployment() {
    return _esp32.getConfigurationDeployment();
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

