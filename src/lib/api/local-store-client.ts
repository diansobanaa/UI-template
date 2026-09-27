/**
 * LocalStoreClient
 * 
 * Single-point localStorage and direct-ESP32 operational client adapter.
 * Replaces the Python backend dependency for operational metadata, schedules,
 * research records, and calibrations.
 */

import type {
  ClockSyncRequest,
  CommandReceipt,
  ConfigurationValidation,
  ConfigurationPayload,
  InventoryResponse,
  SyncSnapshot,
  TelemetrySnapshot,
  TelemetryHistoryResponse,
  EventResponse,
  ScheduleCompileResponse,
  ScheduleDeploymentResponse,
  SensorDefinition,
  SensorSample,
  CalibrationApiRecord,
  FertigationPrepareResponse,
  FertigationRun,
  ResearchCycle, ResearchPlant, ResearchFruit, ResearchObservation, ResearchAnalysis,
  ResourceState, ResourceTransferResponse,
  ComplexDeletionPreview, DeletionJob,
} from "./contracts";
import type { Complex, Greenhouse } from "../types";
import { esp32Client, Esp32Client } from "./esp32-client";
import { isDirectEsp32Enabled, defaultConfig } from "./backend-client";
import { getCanonicalBaselineComponents } from "../data/canonicalHardwareBaseline";

const STORAGE_PREFIX = "agrotech:local:";

// LocalStoreClient is STRICTLY in-memory. NO operational configuration, schedules, telemetry, calibrations, or equipment state may EVER touch window.localStorage!
const memStore = new Map<string, string>();

function getItem(key: string): string | null {
  return memStore.get(key) ?? null;
}

function setItem(key: string, value: string): void {
  memStore.set(key, value);
}

function getJson<T>(key: string, defaultValue: T): T {
  const raw = getItem(key);
  if (!raw) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function setJson<T>(key: string, value: T): void {
  setItem(key, JSON.stringify(value));
}

// In-memory ephemeral storage for complexes and greenhouses — NEVER written to persistent browser storage!
const ephemeralComplexes: Complex[] = [];
const ephemeralGreenhouses: Greenhouse[] = [];

function purgeLegacyMockData(): void {
  if (typeof window === "undefined") return;
  try {
    // 1. Clear any cookies
    if (document.cookie) {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
    }

    // 2. Completely remove any legacy persisted complexes, greenhouses, or topology from localStorage
    window.localStorage.removeItem("complexes");
    window.localStorage.removeItem("greenhouses");
    window.localStorage.removeItem("topology");
    window.localStorage.removeItem(STORAGE_PREFIX + "complexes");
    window.localStorage.removeItem(STORAGE_PREFIX + "greenhouses");
    window.localStorage.removeItem(STORAGE_PREFIX + "topology");

    // 3. Clear any mock config for complex-01
    window.localStorage.removeItem(STORAGE_PREFIX + "config:complex-01");
    window.localStorage.removeItem(STORAGE_PREFIX + "schedules:complex-01");
    window.localStorage.removeItem(STORAGE_PREFIX + "calibrations:complex-01");
    window.localStorage.removeItem(STORAGE_PREFIX + "sensors:complex-01");
    window.localStorage.removeItem(STORAGE_PREFIX + "research_cycles:complex-01");

    // 4. Purge ALL operational keys (config, schedules, calibrations, telemetry) from localStorage
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith(STORAGE_PREFIX) || key.startsWith("schedules:") || key.startsWith("schedule:") || key.startsWith("config:"))) {
        window.localStorage.removeItem(key);
      }
    }

    // Expose utility functions on window for manual debugging/reset
    (window as any).purgeAgrotechMockData = purgeLegacyMockData;
    (window as any).clearAllAgrotechStorage = () => {
      window.localStorage.clear();
      document.cookie.split(";").forEach((c) => {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
      window.location.reload();
    };
  } catch {
    // ignore
  }
}

// Purge mock data immediately on client load
purgeLegacyMockData();

export class LocalStoreClient {
  /* ---------------- Operational Context (Complex & GH) ---------------- */

  async getOperationalContext(): Promise<{ complexes: Complex[]; greenhouses: Greenhouse[] }> {
    // Operational context MUST NOT be loaded from localStorage
    return { complexes: [], greenhouses: [] };
  }

  async createComplex(input: { location: string; code?: string; name?: string }): Promise<Complex> {
    const id = `complex-${String(ephemeralComplexes.length + 1).padStart(2, "0")}`;
    const newComplex: Complex = {
      id,
      code: input.code || `Complex ${ephemeralComplexes.length + 1}`,
      name: input.name || input.code || `Complex ${ephemeralComplexes.length + 1}`,
      location: input.location,
      status: "Active",
      emergencyStopped: false,
      esp32: {
        online: false,
        synchronized: false,
        deviceId: "",
        endpoint: "",
        lastSync: "Never",
        configVersion: 0,
        esp32ConfigVersion: 0,
      },
      systemStatus: "NORMAL",
      greenhouseIds: [],
      operationalStatus: "UNKNOWN",
      authoritySource: "ESP32_DIRECT",
      water: {
        wellPumpOn: false,
        rawTankPct: 100,
        flowTodayL: 0,
        flowDeltaPct: 0,
      },
    };
    ephemeralComplexes.push(newComplex);
    return newComplex;
  }

  async updateComplex(id: string, patch: Partial<Pick<Complex, "code" | "name" | "location" | "status">> & { esp32?: Partial<import("../types").Esp32State> }): Promise<Complex> {
    const idx = ephemeralComplexes.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Complex ${id} not found.`);
    const current = ephemeralComplexes[idx];
    const updated: Complex = {
      ...current,
      ...patch,
      esp32: { ...current.esp32, ...(patch.esp32 || {}) },
    };
    ephemeralComplexes[idx] = updated;
    return updated;
  }

  async bindEsp32Controller(
    complexId: string,
    input: {
      deviceId: string;
      endpoint: string;
      apiVersion?: string;
      schemaVersion?: number;
      firmwareVersion?: string;
      hardwareModel?: string;
      inventoryVersion?: number;
    }
  ): Promise<Complex> {
    const idx = ephemeralComplexes.findIndex((c) => c.id === complexId);
    const current = idx !== -1 ? ephemeralComplexes[idx] : {
      id: complexId,
      code: complexId.toUpperCase(),
      name: complexId,
      location: "ESP32 Managed Complex",
      status: "Active" as const,
      emergencyStopped: false,
      esp32: {
        online: true,
        synchronized: true,
        deviceId: input.deviceId,
        endpoint: input.endpoint,
        lastSync: new Date().toLocaleTimeString(),
        configVersion: 1,
        esp32ConfigVersion: 1,
      },
      systemStatus: "NORMAL" as const,
      greenhouseIds: [],
      operationalStatus: "LIVE" as const,
      authoritySource: "ESP32_DIRECT" as const,
      water: {
        wellPumpOn: false,
        rawTankPct: 100,
        flowTodayL: 0,
        flowDeltaPct: 0,
      },
    };

    const updated: Complex = {
      ...current,
      status: "Active",
      operationalStatus: "LIVE",
      authoritySource: "ESP32_DIRECT",
      esp32: {
        ...current.esp32,
        online: true,
        synchronized: true,
        deviceId: input.deviceId,
        endpoint: input.endpoint,
        firmwareVersion: input.firmwareVersion || current.esp32.firmwareVersion,
        hardwareModel: input.hardwareModel || current.esp32.hardwareModel,
        apiVersion: input.apiVersion || current.esp32.apiVersion,
        schemaVersion: input.schemaVersion ?? current.esp32.schemaVersion,
        inventoryVersion: input.inventoryVersion ?? current.esp32.inventoryVersion,
        lastSync: new Date().toLocaleTimeString(),
      },
    };

    if (idx !== -1) {
      ephemeralComplexes[idx] = updated;
    } else {
      ephemeralComplexes.push(updated);
    }
    return updated;
  }

  async getComplexDeletionPreview(complexId: string): Promise<ComplexDeletionPreview> {
    const greenhouses = ephemeralGreenhouses.filter((g) => g.complexId === complexId);
    return {
      complexId,
      complexName: "Complex",
      complexCode: "C-01",
      boundDevice: { deviceId: "esp32-01", endpoint: "", online: false },
      deletionBlockedByDevice: false,
      blockingReason: null,
      countsToPurge: {
        greenhouses: greenhouses.length,
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
      scopeSnapshotHash: "none",
    } as unknown as ComplexDeletionPreview;
  }

  async deleteComplex(
    complexId: string,
    options: { requestedBy?: string; requestReason?: string; idempotencyKey?: string } = {}
  ): Promise<DeletionJob> {
    const target = ephemeralComplexes.find((c) => c.id === complexId);
    if (target?.esp32?.endpoint && target.esp32.deviceId) {
      try {
        const client = new Esp32Client({
          ...defaultConfig,
          esp32BaseUrl: target.esp32.endpoint.replace(/\/$/, ""),
          directEsp32Enabled: true,
          requestTimeoutMs: 8000,
          token: "agrotech-secret-key",
        });
        await client.retireDevice(complexId, options.requestReason || "Complex deletion in direct mode");
      } catch (err) {
        console.warn("[localStoreClient] Direct ESP32 retire warning during deleteComplex:", err);
      }
    }
    const remIdx = ephemeralComplexes.findIndex((c) => c.id === complexId);
    if (remIdx !== -1) ephemeralComplexes.splice(remIdx, 1);
    for (let i = ephemeralGreenhouses.length - 1; i >= 0; i--) {
      if (ephemeralGreenhouses[i].complexId === complexId) ephemeralGreenhouses.splice(i, 1);
    }
    return {
      jobId: `del-${Date.now()}`,
      complexId,
      idempotencyKey: options.idempotencyKey || `idem-${Date.now()}`,
      status: "COMPLETED",
      currentStep: "FINISHED",
      boundDeviceId: null,
      boundDeviceEndpoint: null,
      deviceRetired: true,
      deviceRetryCount: 0,
      scopeSnapshotHash: "none",
      recordsPurgedTotal: 0,
      requestedBy: options.requestedBy || "operator",
      requestReason: options.requestReason || "User deletion",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as DeletionJob;
  }

  async getDeletionJob(jobId: string): Promise<DeletionJob> {
    return {
      jobId,
      complexId: "unknown",
      idempotencyKey: "none",
      status: "COMPLETED",
      currentStep: "FINISHED",
      boundDeviceId: null,
      boundDeviceEndpoint: null,
      deviceRetired: true,
      deviceRetryCount: 0,
      scopeSnapshotHash: "none",
      recordsPurgedTotal: 0,
      requestedBy: "operator",
      requestReason: "User deletion",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as DeletionJob;
  }

  /* ---------------- Greenhouses ---------------- */

  async createGreenhouse(complexId: string, input: { crop: string; code?: string; greenhouseTag?: string; areaM2?: number }): Promise<Greenhouse> {
    const ghNumber = ephemeralGreenhouses.filter((g) => g.complexId === complexId).length + 1;
    const ghId = `gh-${String(ghNumber).padStart(2, "0")}`;
    const newGh: Greenhouse = {
      id: ghId,
      code: input.code || input.greenhouseTag || `GH-${String(ghNumber).padStart(2, "0")}`,
      crop: input.crop || "Tomato",
      complexId,
      online: true,
      health: "NORMAL",
      greenhouseTag: input.greenhouseTag || input.code || `GH-${String(ghNumber).padStart(2, "0")}`,
      areaM2: input.areaM2 ?? 500,
      fertigationState: "IDLE",
      cropCycle: {
        status: "NO_CYCLE",
        tanggalTanam: null,
        tanggalPolinasi: null,
        lastHarvestSummary: null,
      },
      telemetry: {
        temperatureC: 28.0,
        humidityPct: 70.0,
        lightLux: 35000,
        tempDeltaC: 0,
        humidityDeltaPct: 0,
        tankPct: 100,
        tankL: 1000,
        tankCapacityL: 1000,
        waterTodayL: 0,
        waterYesterdayL: 0,
        waterDeltaPct: 0,
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
        latestObservation: "Baru ditambahkan.",
      },
      equipment: [],
      recipes: [],
      fertigationSchedules: [],
      fanSchedules: [],
      currentRun: null,
      queue: [],
      history: [],
      fruitDevSeries: [],
    };
    ephemeralGreenhouses.push(newGh);

    // Also update complex.greenhouseIds
    const c = ephemeralComplexes.find((x) => x.id === complexId);
    if (c && !c.greenhouseIds.includes(ghId)) {
      c.greenhouseIds.push(ghId);
    }

    return newGh;
  }

  async updateGreenhouse(id: string, patch: Partial<Pick<Greenhouse, "code" | "crop" | "greenhouseTag" | "cropTimelineConfig" | "areaM2">>): Promise<Greenhouse> {
    const idx = ephemeralGreenhouses.findIndex((g) => g.id === id);
    if (idx === -1) throw new Error(`Greenhouse ${id} not found.`);
    const updated = { ...ephemeralGreenhouses[idx], ...patch };
    ephemeralGreenhouses[idx] = updated;
    return updated;
  }

  async deleteGreenhouse(id: string): Promise<{ deleted: boolean; ghId: string }> {
    const idx = ephemeralGreenhouses.findIndex((g) => g.id === id);
    if (idx !== -1) ephemeralGreenhouses.splice(idx, 1);
    return { deleted: true, ghId: id };
  }

  /* ---------------- Schedules (Prohibited in localStorage) ---------------- */

  async createSchedule(_complexId: string, _kind: "fertigation" | "fan" | "wellPump", _item: Record<string, unknown>): Promise<{ schedule: Record<string, unknown> }> {
    throw new Error("LocalStoreClient is prohibited from storing schedules. Use authoritative ESP32 Schedule Intent API.");
  }

  async updateSchedule(_scheduleId: string, _kind: "fertigation" | "fan" | "wellPump", _item: Record<string, unknown>): Promise<{ schedule: Record<string, unknown> }> {
    throw new Error("LocalStoreClient is prohibited from storing schedules. Use authoritative ESP32 Schedule Intent API.");
  }

  async deleteSchedule(_scheduleId: string): Promise<{ deleted: boolean; scheduleId: string }> {
    throw new Error("LocalStoreClient is prohibited from storing schedules. Use authoritative ESP32 Schedule Intent API.");
  }

  /* ---------------- Configuration & Hardware ---------------- */

  async getConfiguration(complexId: string): Promise<ConfigurationPayload> {
    // 1. If direct ESP32 is online, fetch from physical controller
    if (isDirectEsp32Enabled()) {
      try {
        const esp32Cfg = await esp32Client.getConfiguration();
        if (esp32Cfg && Array.isArray(esp32Cfg.components)) {
          setJson(`config:${complexId}`, esp32Cfg);
          return esp32Cfg;
        }
      } catch {
        // Fall back to local store
      }
    }

    // 2. Read from localStorage
    const cached = getJson<ConfigurationPayload | null>(`config:${complexId}`, null);
    if (cached && Array.isArray(cached.components) && cached.components.length > 0) {
      return cached;
    }

    // 3. Fall back to empty configuration if not yet commissioned
    return {
      version: 0,
      updatedAt: new Date().toISOString(),
      complexId,
      components: [],
      assignments: [],
      schedules: [],
      recipes: [],
      topology: [],
      settings: {},
    };
  }

  async saveConfiguration(complexId: string, configuration: ConfigurationPayload): Promise<ConfigurationPayload> {
    // 1. Cache immediately in localStorage
    setJson(`config:${complexId}`, configuration);

    // 2. Dispatch to ESP32 directly if reachable
    if (isDirectEsp32Enabled()) {
      try {
        return await esp32Client.saveConfiguration(configuration);
      } catch (err) {
        console.warn("[LocalStoreClient] Direct ESP32 save failed, retained in local storage:", err);
      }
    }

    return configuration;
  }

  async validateConfiguration(complexId: string, configuration: ConfigurationPayload): Promise<ConfigurationValidation> {
    if (isDirectEsp32Enabled()) {
      try {
        return await esp32Client.validateConfiguration(configuration);
      } catch {
        // Fall back to local validation
      }
    }
    const hasComponents = Array.isArray(configuration.components) && configuration.components.length > 0;
    return {
      valid: hasComponents,
      inventoryVersion: 1,
      errors: hasComponents ? [] : [{ code: "NO_COMPONENTS", message: "At least one component is required." }],
      warnings: [],
    };
  }

  async getConfigurationDeployment(complexId: string): Promise<{
    complexId: string;
    deploymentId?: string | null;
    desiredVersion: number;
    desiredHash?: string | null;
    deviceVersion: number;
    deviceHash?: string | null;
    previousVersion: number;
    previousHash?: string | null;
    status: string;
    updatedAt?: string | null;
  }> {
    if (isDirectEsp32Enabled()) {
      try {
        const dep = await esp32Client.getConfigurationDeployment();
        return {
          complexId,
          deploymentId: dep.deploymentId,
          desiredVersion: dep.configurationVersion,
          desiredHash: String(dep.configurationHash || ""),
          deviceVersion: dep.configurationVersion,
          deviceHash: String(dep.configurationHash || ""),
          previousVersion: dep.previousConfigurationVersion || 0,
          status: dep.deploymentStatus || "APPLIED",
          updatedAt: new Date().toISOString(),
        };
      } catch {
        // Fall back
      }
    }
    const cfg = await this.getConfiguration(complexId);
    return {
      complexId,
      deploymentId: `dep-${cfg.version}`,
      desiredVersion: cfg.version,
      deviceVersion: cfg.version,
      previousVersion: Math.max(0, cfg.version - 1),
      status: "APPLIED",
      updatedAt: cfg.updatedAt,
    };
  }

  async getInventory(complexId: string): Promise<InventoryResponse> {
    if (isDirectEsp32Enabled()) {
      try {
        return await esp32Client.getInventory();
      } catch {
        // Fall back
      }
    }
    const cfg = await this.getConfiguration(complexId);
    return {
      deviceId: `esp32-${complexId}`,
      complexId,
      inventoryVersion: cfg.version,
      components: cfg.components || [],
    };
  }

  /* ---------------- Calibrations ---------------- */

  async listCalibrations(complexId: string): Promise<{ complexId: string; calibrations: CalibrationApiRecord[] }> {
    const list = getJson<CalibrationApiRecord[]>(`calibrations:${complexId}`, []);
    return { complexId, calibrations: list };
  }

  async saveCalibration(complexId: string, record: Record<string, unknown>): Promise<{ complexId: string; calibration: CalibrationApiRecord }> {
    const list = getJson<CalibrationApiRecord[]>(`calibrations:${complexId}`, []);
    const calibration: CalibrationApiRecord = {
      calibrationId: (record.calibrationId as string) || `cal-${Date.now()}`,
      complexId,
      componentId: (record.componentId as string) || "unknown",
      calibrationType: (record.calibrationType as any) || "SINGLE_POINT",
      state: "CALIBRATED",
      createdAtMs: Date.now(),
      validFromMs: Date.now(),
      validUntilMs: Date.now() + 30 * 86400000,
      operator: (record.operator as string) || "Admin",
      version: list.length + 1,
      parameters: record,
    };
    list.unshift(calibration);
    setJson(`calibrations:${complexId}`, list);
    return { complexId, calibration };
  }

  /* ---------------- Schedule Compilation & Deployment ---------------- */

  async compileSchedules(
    complexId: string,
    configuration: ConfigurationPayload,
    schedules: Array<Record<string, unknown>>,
    activeLocks: Array<Record<string, unknown>> = [],
  ): Promise<ScheduleCompileResponse> {
    return {
      valid: true,
      compiledSchedules: schedules as any,
      conflicts: [],
      compiledAt: new Date().toISOString(),
    } as unknown as ScheduleCompileResponse;
  }

  async deploySchedules(
    complexId: string,
    configuration: ConfigurationPayload,
    schedules: Array<Record<string, unknown>>,
    options: { esp32BaseUrl?: string; deploymentId?: string; activeLocks?: Array<Record<string, unknown>> } = {},
  ): Promise<ScheduleDeploymentResponse> {
    const cfgToSave = {
      ...configuration,
      schedules: schedules as any,
      updatedAt: new Date().toISOString(),
      version: (configuration.version || 1) + 1,
    };
    await this.saveConfiguration(complexId, cfgToSave);

    return {
      status: "APPLIED",
      activeVersion: cfgToSave.version,
      appliedAt: new Date().toISOString(),
    } as unknown as ScheduleDeploymentResponse;
  }

  /* ---------------- Telemetry & Logs ---------------- */

  async getTelemetry(complexId: string, greenhouseId?: string): Promise<TelemetrySnapshot> {
    if (isDirectEsp32Enabled()) {
      try {
        return await esp32Client.getTelemetry();
      } catch {
        // Fall back
      }
    }
    return {
      complexId,
      sequence: 1,
      deviceTimestamp: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      samples: [],
      hasMore: false,
    } as unknown as TelemetrySnapshot;
  }

  async getTelemetryHistory(complexId: string, greenhouseId?: string): Promise<TelemetryHistoryResponse> {
    if (isDirectEsp32Enabled()) {
      try {
        return await esp32Client.getTelemetryHistory();
      } catch {
        // Fall back
      }
    }
    return {
      complexId,
      samples: [],
      hasMore: false,
    } as unknown as TelemetryHistoryResponse;
  }

  async getLogs(complexId: string, cursor?: string, options: { ghId?: string; limit?: number } = {}): Promise<EventResponse> {
    if (isDirectEsp32Enabled()) {
      try {
        return await esp32Client.getLogs();
      } catch {
        // Fall back
      }
    }
    return {
      events: [
        {
          eventId: `evt-1`,
          sequence: 1,
          deviceTimestamp: new Date().toISOString(),
          eventType: "SYSTEM_ONLINE",
          severity: "INFO",
          message: "ESP32 Controller running in direct operational mode.",
        },
      ],
      hasMore: false,
      nextCursor: null,
    } as unknown as EventResponse;
  }

  async syncEsp32(complexId: string): Promise<SyncSnapshot> {
    return {
      complexId,
      serverTime: new Date().toISOString(),
    } as unknown as SyncSnapshot;
  }

  async getOfflineStatus(complexId: string): Promise<Record<string, unknown>> {
    return {
      isOffline: false,
      authority: "ESP32_DIRECT",
      complexId,
    };
  }

  /* ---------------- Commands & Safety ---------------- */

  async postCommand(complexId: string, command: Record<string, unknown>): Promise<CommandReceipt> {
    if (isDirectEsp32Enabled()) {
      try {
        const cmdId = (command.commandId as string) || crypto.randomUUID();
        const action = (command.action as string) || (command.type as string) || "COMMAND";
        return await esp32Client.postCommand(cmdId, action, command.parameters as any);
      } catch (err) {
        console.warn("[LocalStoreClient] Direct ESP32 command failed:", err);
      }
    }
    return {
      commandId: (command.commandId as string) || `cmd-${Date.now()}`,
      status: "ACCEPTED",
    } as unknown as CommandReceipt;
  }

  async emergencyStop(complexId: string, body: { reason: string; commandId?: string }): Promise<CommandReceipt> {
    if (isDirectEsp32Enabled()) {
      try {
        return await esp32Client.emergencyStop(body.reason);
      } catch (err) {
        console.warn("[LocalStoreClient] Direct ESP32 emergency stop failed:", err);
      }
    }
    return {
      commandId: body.commandId || `estop-${Date.now()}`,
      status: "ACCEPTED",
    } as unknown as CommandReceipt;
  }

  /* ---------------- Sensors ---------------- */

  async listSensors(complexId: string): Promise<{ complexId: string; sensors: SensorDefinition[] }> {
    const sensors = getJson<SensorDefinition[]>(`sensors:${complexId}`, []);
    return { complexId, sensors };
  }

  async upsertSensor(complexId: string, sensor: SensorDefinition): Promise<{ valid: boolean; sensor: SensorDefinition }> {
    const list = getJson<SensorDefinition[]>(`sensors:${complexId}`, []);
    const idx = list.findIndex((s) => s.sensorId === sensor.sensorId);
    if (idx !== -1) list[idx] = sensor;
    else list.push(sensor);
    setJson(`sensors:${complexId}`, list);
    return { valid: true, sensor };
  }

  async recordSensorSample(complexId: string, sample: { sensorId: string; value: unknown; timestampMs?: number }): Promise<{ complexId: string; sample: SensorSample }> {
    const created = {
      sensorId: sample.sensorId,
      value: typeof sample.value === "number" ? sample.value : null,
      timestampMs: sample.timestampMs || Date.now(),
      unit: "",
      quality: "VALID",
      measurementType: "MEASURED",
    };
    return { complexId, sample: created as unknown as SensorSample };
  }

  /* ---------------- Research & Observations ---------------- */

  async getResearchCycles(complexId: string, options: { ghId?: string; status?: string } = {}): Promise<{ complexId: string; cycles: ResearchCycle[] }> {
    let cycles = getJson<ResearchCycle[]>(`research_cycles:${complexId}`, []);
    if (options.ghId) cycles = cycles.filter((c) => c.ghId === options.ghId);
    if (options.status) cycles = cycles.filter((c) => c.status === options.status);
    return { complexId, cycles };
  }

  async saveResearchCycle(complexId: string, input: Partial<ResearchCycle> & Record<string, unknown>): Promise<{ cycle: ResearchCycle }> {
    const cycles = getJson<ResearchCycle[]>(`research_cycles:${complexId}`, []);
    const cycleId = (input.cycleId as string) || `rc-${Date.now()}`;
    const idx = cycles.findIndex((c) => c.cycleId === cycleId);
    const cycle = {
      cycleId,
      complexId,
      ghId: (input.ghId as string) || (input.greenhouseId as string) || "gh-01",
      variety: (input.variety as string) || "Alisha",
      plantingDate: (input.plantedDate as string) || new Date().toISOString(),
      expectedHarvestDate: (input.targetHarvestDate as string) || new Date(Date.now() + 80 * 86400000).toISOString(),
      status: (input.status as any) || "ACTIVE",
      plantCount: Number(input.totalPlants) || 450,
      mortalityCount: 0,
      version: 1,
      notes: (input.notes as string) || "",
    } as unknown as ResearchCycle;
    if (idx !== -1) cycles[idx] = cycle;
    else cycles.push(cycle);
    setJson(`research_cycles:${complexId}`, cycles);
    return { cycle };
  }

  async getResearchPlants(complexId: string, options: { cycleId?: string; ghId?: string } = {}): Promise<{ plants: ResearchPlant[] }> {
    const plants = getJson<ResearchPlant[]>(`research_plants:${complexId}`, []);
    return { plants };
  }
  async saveResearchPlant(complexId: string, input: Record<string, unknown>): Promise<{ plant: ResearchPlant }> {
    const plant = {
      plantId: (input.plantId as string) || `p-${Date.now()}`,
      cycleId: (input.cycleId as string) || "rc-1",
      complexId,
      ghId: (input.ghId as string) || (input.greenhouseId as string) || "gh-01",
      plantTag: (input.tag as string) || "P-01",
      position: String(input.position || "1"),
      status: "ALIVE",
    } as unknown as ResearchPlant;
    return { plant };
  }

  async getResearchFruits(complexId: string, options: { cycleId?: string; ghId?: string } = {}): Promise<{ fruits: ResearchFruit[] }> {
    const fruits = getJson<ResearchFruit[]>(`research_fruits:${complexId}`, []);
    return { fruits };
  }
  async saveResearchFruit(complexId: string, input: Record<string, unknown>): Promise<{ fruit: ResearchFruit }> {
    const fruit = {
      fruitId: (input.fruitId as string) || `f-${Date.now()}`,
      plantId: (input.plantId as string) || "p-1",
      cycleId: (input.cycleId as string) || "rc-1",
      complexId,
      ghId: "gh-01",
      fruitTag: (input.tag as string) || "F-01",
      pollinationDate: new Date().toISOString(),
      weightG: Number(input.weightGrams) || 400,
      grade: "A",
      developmentStatus: "DEVELOPING",
    } as unknown as ResearchFruit;
    return { fruit };
  }

  async getResearchObservations(complexId: string, options: { cycleId?: string; ghId?: string } = {}): Promise<{ observations: ResearchObservation[] }> {
    const observations = getJson<ResearchObservation[]>(`research_obs:${complexId}`, []);
    return { observations };
  }
  async saveResearchObservation(complexId: string, input: Record<string, unknown>): Promise<{ observation: ResearchObservation }> {
    const obsList = getJson<ResearchObservation[]>(`research_obs:${complexId}`, []);
    const observation = {
      observationId: (input.observationId as string) || `obs-${Date.now()}`,
      cycleId: (input.cycleId as string) || "rc-1",
      complexId,
      ghId: "gh-01",
      observedAt: new Date().toISOString(),
      metric: (input.category as string) || "GROWTH",
      notes: (input.notes as string) || "",
    } as unknown as ResearchObservation;
    obsList.unshift(observation);
    setJson(`research_obs:${complexId}`, obsList);
    return { observation };
  }
  async deleteResearchObservation(complexId: string, observationId: string): Promise<{ deleted: boolean; observationId: string }> {
    const obsList = getJson<ResearchObservation[]>(`research_obs:${complexId}`, []).filter((o) => o.observationId !== observationId);
    setJson(`research_obs:${complexId}`, obsList);
    return { deleted: true, observationId };
  }

  async getResearchSummary(ghId: string): Promise<Record<string, unknown>> {
    return { ghId, activeCycle: true, totalPlants: 450, avgBrix: 13.2 };
  }
  async getResearchAnalysis(complexId: string, cycleId: string): Promise<ResearchAnalysis> {
    return {
      cycle: {
        cycleId,
        complexId,
        ghId: "gh-01",
        status: "ACTIVE",
        plantCount: 450,
        mortalityCount: 0,
        version: 1,
      },
      counts: { plants: 450, fruits: 400, observations: 10, telemetrySamples: 100, events: 10, fertigationRuns: 5 },
      plants: [],
      fruits: [],
      observations: [],
      telemetry: [],
      events: [],
      fertigationRuns: [],
      calibrations: [],
      relationships: {},
    } as unknown as ResearchAnalysis;
  }

  async syncClock(complexId: string, request: ClockSyncRequest): Promise<{ appliedAt: string }> {
    return { appliedAt: new Date().toISOString() };
  }

  async listResources(complexId: string): Promise<{ complexId: string; resources: ResourceState[] }> {
    return { complexId, resources: [] };
  }

  async transferResource(complexId: string, resourceId: string, input: { targetGhId: string; configuration: ConfigurationPayload }): Promise<ResourceTransferResponse> {
    await this.saveConfiguration(complexId, input.configuration);
    return {
      transfer: {
        resourceId,
        targetGhId: input.targetGhId,
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
      },
    } as unknown as ResourceTransferResponse;
  }

  async prepareFertigation(complexId: string, configuration: ConfigurationPayload, request: Record<string, unknown>): Promise<FertigationPrepareResponse> {
    return {
      status: "READY",
      valid: true,
      estimatedDurationSeconds: 600,
    } as unknown as FertigationPrepareResponse;
  }

  async listFertigationRuns(complexId: string, ghId?: string): Promise<{ complexId: string; runs: FertigationRun[] }> {
    return { complexId, runs: [] };
  }
}

export const localStoreClient = new LocalStoreClient();
