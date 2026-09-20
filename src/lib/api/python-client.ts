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
  HardwarePortConfig,
  ScheduleCompileResponse,
  ScheduleDeploymentResponse,
  SensorDefinition,
  SensorSample,
  CalibrationApiRecord,
  FertigationPrepareResponse,
  FertigationRun,
  ResearchCycle, ResearchPlant, ResearchFruit, ResearchObservation, ResearchAnalysis,
  ResourceState, ResourceTransferResponse,
} from "./contracts";
import { PYTHON_API_BASE, apiDelete, apiGet, apiPost, apiPut } from "./backend-client";

/** Port for Python-owned history, identity, analytics and orchestration data. */
export class PythonClient {
  constructor(private readonly config: HardwarePortConfig = {
    pythonBaseUrl: PYTHON_API_BASE,
    requestTimeoutMs: 8000,
    directEsp32Enabled: false,
  }) {}

  async getOperationalContext(): Promise<{ complexes: import("../types").Complex[]; greenhouses: import("../types").Greenhouse[] }> {
    return apiGet(`/context`, this.config);
  }

  async createComplex(input: { location: string; code?: string; name?: string }): Promise<import("../types").Complex> {
    return apiPost(`/complexes`, input, this.config);
  }

  async updateComplex(id: string, patch: Partial<Pick<import("../types").Complex, "code" | "name" | "location" | "status">> & { esp32?: Partial<import("../types").Esp32State> }): Promise<import("../types").Complex> {
    return apiPost(`/complexes/${encodeURIComponent(id)}`, patch, this.config);
  }

  async bindEsp32Controller(complexId: string, input: { deviceId: string; endpoint: string; apiVersion?: string; schemaVersion?: number; firmwareVersion?: string; hardwareModel?: string; inventoryVersion?: number }): Promise<import("../types").Complex> {
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/controller/bind`, input, this.config);
  }

  async createGreenhouse(complexId: string, input: { crop: string; code?: string; greenhouseTag?: string }): Promise<import("../types").Greenhouse> {
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/greenhouses`, input, this.config);
  }

  async updateGreenhouse(id: string, patch: Partial<Pick<import("../types").Greenhouse, "code" | "crop" | "greenhouseTag" | "cropTimelineConfig">>): Promise<import("../types").Greenhouse> {
    return apiPost(`/greenhouses/${encodeURIComponent(id)}`, patch, this.config);
  }

  async createSchedule(complexId: string, kind: "fertigation" | "fan" | "wellPump", item: Record<string, unknown>): Promise<{ schedule: Record<string, unknown> }> {
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/schedules`, { kind, item }, this.config);
  }

  async updateSchedule(scheduleId: string, kind: "fertigation" | "fan" | "wellPump", item: Record<string, unknown>): Promise<{ schedule: Record<string, unknown> }> {
    return apiPost(`/schedules/${encodeURIComponent(scheduleId)}`, { kind, item }, this.config);
  }

  async deleteSchedule(scheduleId: string): Promise<{ deleted: boolean; scheduleId: string }> {
    return apiDelete(`/schedules/${encodeURIComponent(scheduleId)}`, this.config);
  }

  async getSyncSnapshot(complexId: string): Promise<SyncSnapshot> {
    return apiGet<SyncSnapshot>(`/complexes/${encodeURIComponent(complexId)}/sync-snapshot`, this.config);
  }

  async getInventory(complexId: string): Promise<InventoryResponse> {
    return apiGet<InventoryResponse>(`/complexes/${encodeURIComponent(complexId)}/esp32/inventory`, this.config);
  }

  async getConfiguration(complexId: string): Promise<ConfigurationPayload> {
    return apiGet<ConfigurationPayload>(`/complexes/${encodeURIComponent(complexId)}/esp32/configuration`, this.config);
  }

  async listResources(complexId: string): Promise<{ complexId: string; resources: ResourceState[] }> {
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/resources`, this.config);
  }

  async transferResource(complexId: string, resourceId: string, input: { targetGhId: string; physicalMoveConfirmed: boolean; operator?: string; configuration: ConfigurationPayload }): Promise<ResourceTransferResponse> {
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/resources/${encodeURIComponent(resourceId)}/transfer`, input, this.config);
  }

  async getConfigurationDeployment(complexId: string): Promise<{ complexId: string; deploymentId?: string | null; desiredVersion: number; desiredHash?: string | null; deviceVersion: number; deviceHash?: string | null; previousVersion: number; previousHash?: string | null; status: string; updatedAt?: string | null }> {
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/esp32/configuration/deployment`, this.config);
  }

  async validateConfiguration(complexId: string, configuration: ConfigurationPayload): Promise<ConfigurationValidation> {
    return apiPost<ConfigurationValidation>(`/complexes/${encodeURIComponent(complexId)}/esp32/configuration/validate`, configuration, this.config);
  }

  async saveConfiguration(complexId: string, configuration: ConfigurationPayload): Promise<ConfigurationPayload> {
    return apiPut<ConfigurationPayload>(`/complexes/${encodeURIComponent(complexId)}/esp32/configuration`, configuration, this.config);
  }

  async getTelemetry(complexId: string, greenhouseId?: string, options: { afterSequence?: number; limit?: number } = {}): Promise<TelemetrySnapshot> {
    const params = new URLSearchParams();
    if (greenhouseId) params.set("ghId", greenhouseId);
    if (options.afterSequence !== undefined) params.set("afterSequence", String(options.afterSequence));
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiGet<TelemetrySnapshot>(`/complexes/${encodeURIComponent(complexId)}/telemetry${query}`, this.config);
  }

  async getTelemetryHistory(complexId: string, greenhouseId?: string, options: { afterSequence?: number; limit?: number } = {}): Promise<TelemetryHistoryResponse> {
    const params = new URLSearchParams();
    if (greenhouseId) params.set("ghId", greenhouseId);
    if (options.afterSequence !== undefined) params.set("afterSequence", String(options.afterSequence));
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiGet<TelemetryHistoryResponse>(`/complexes/${encodeURIComponent(complexId)}/telemetry/history${query}`, this.config);
  }

  async getLogs(complexId: string, cursor?: string, options: { ghId?: string; limit?: number } = {}): Promise<EventResponse> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (options.ghId) params.set("ghId", options.ghId);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiGet<EventResponse>(`/complexes/${encodeURIComponent(complexId)}/events${query}`, this.config);
  }

  async syncEsp32(complexId: string): Promise<SyncSnapshot> {
    return apiPost<SyncSnapshot>(`/complexes/${encodeURIComponent(complexId)}/esp32/sync`, {}, this.config);
  }

  async getOfflineStatus(complexId: string): Promise<Record<string, unknown>> {
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/offline-status`, this.config);
  }

  async getResearchCycles(complexId: string, options: { ghId?: string; status?: string; limit?: number } = {}): Promise<{ complexId: string; cycles: ResearchCycle[] }> {
    const q = new URLSearchParams(); if (options.ghId) q.set("ghId", options.ghId); if (options.status) q.set("status", options.status); if (options.limit) q.set("limit", String(options.limit));
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/research/cycles${q.toString() ? `?${q}` : ""}`, this.config);
  }
  async saveResearchCycle(complexId: string, input: Partial<ResearchCycle> & Record<string, unknown>): Promise<{ cycle: ResearchCycle }> {
    const cycleId = input.cycleId ? `/${encodeURIComponent(String(input.cycleId))}` : "";
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/research/cycles${cycleId}`, input, this.config);
  }
  async getResearchPlants(complexId: string, options: { cycleId?: string; ghId?: string } = {}): Promise<{ plants: ResearchPlant[] }> {
    const q=new URLSearchParams(); if(options.cycleId)q.set("cycleId",options.cycleId); if(options.ghId)q.set("ghId",options.ghId);
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/research/plants${q.toString()?`?${q}`:""}`,this.config);
  }
  async saveResearchPlant(complexId: string, input: Record<string, unknown>): Promise<{ plant: ResearchPlant }> { return apiPost(`/complexes/${encodeURIComponent(complexId)}/research/plants`, input, this.config); }
  async getResearchFruits(complexId: string, options: { cycleId?: string; ghId?: string } = {}): Promise<{ fruits: ResearchFruit[] }> {
    const q=new URLSearchParams(); if(options.cycleId)q.set("cycleId",options.cycleId); if(options.ghId)q.set("ghId",options.ghId);
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/research/fruits${q.toString()?`?${q}`:""}`,this.config);
  }
  async saveResearchFruit(complexId: string, input: Record<string, unknown>): Promise<{ fruit: ResearchFruit }> { return apiPost(`/complexes/${encodeURIComponent(complexId)}/research/fruits`, input, this.config); }
  async getResearchObservations(complexId: string, options: { cycleId?: string; ghId?: string; plantId?: string; fruitId?: string } = {}): Promise<{ observations: ResearchObservation[] }> {
    const q=new URLSearchParams(); for(const [k,v] of Object.entries(options)) if(v)q.set(k,v);
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/research/observations${q.toString()?`?${q}`:""}`,this.config);
  }
  async saveResearchObservation(complexId: string, input: Record<string, unknown>): Promise<{ observation: ResearchObservation }> { return apiPost(`/complexes/${encodeURIComponent(complexId)}/research/observations`, input, this.config); }
  async deleteResearchObservation(complexId: string, observationId: string): Promise<{ deleted: boolean; observationId: string }> { return apiDelete(`/complexes/${encodeURIComponent(complexId)}/research/observations/${encodeURIComponent(observationId)}`, this.config); }
  async getResearchSummary(ghId: string): Promise<Record<string, unknown>> { return apiGet(`/greenhouses/${encodeURIComponent(ghId)}/research/summary`, this.config); }
  async getResearchAnalysis(complexId: string, cycleId: string): Promise<ResearchAnalysis> { return apiGet(`/complexes/${encodeURIComponent(complexId)}/research/analysis/${encodeURIComponent(cycleId)}`, this.config); }

  async syncClock(complexId: string, request: ClockSyncRequest): Promise<{ appliedAt: string }> {
    return apiPost<{ appliedAt: string }>(`/complexes/${encodeURIComponent(complexId)}/esp32/clock-sync`, request, this.config);
  }

  async compileSchedules(
    complexId: string,
    configuration: ConfigurationPayload,
    schedules: Array<Record<string, unknown>>,
    activeLocks: Array<Record<string, unknown>> = [],
  ): Promise<ScheduleCompileResponse> {
    return apiPost<ScheduleCompileResponse>(`/complexes/${encodeURIComponent(complexId)}/compile`, {
      configuration,
      schedules,
      activeLocks,
    }, this.config);
  }

  async deploySchedules(
    complexId: string,
    configuration: ConfigurationPayload,
    schedules: Array<Record<string, unknown>>,
    options: { esp32BaseUrl?: string; deploymentId?: string; activeLocks?: Array<Record<string, unknown>> } = {},
  ): Promise<ScheduleDeploymentResponse> {
    return apiPost<ScheduleDeploymentResponse>(`/complexes/${encodeURIComponent(complexId)}/deploy`, {
      configuration,
      schedules,
      activeLocks: options.activeLocks ?? [],
      esp32BaseUrl: options.esp32BaseUrl,
      deploymentId: options.deploymentId,
    }, this.config);
  }

  async postCommand(complexId: string, command: Record<string, unknown>): Promise<CommandReceipt> {
    return apiPost<CommandReceipt>(`/complexes/${encodeURIComponent(complexId)}/esp32/commands`, command, this.config);
  }

  async emergencyStop(complexId: string, body: { reason: string; commandId?: string }): Promise<CommandReceipt> {
    return apiPost<CommandReceipt>(`/complexes/${encodeURIComponent(complexId)}/esp32/emergency-stop`, body, this.config);
  }

  async listSensors(complexId: string): Promise<{ complexId: string; sensors: SensorDefinition[] }> {
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/sensors`, this.config);
  }

  async upsertSensor(complexId: string, sensor: SensorDefinition): Promise<{ valid: boolean; sensor: SensorDefinition }> {
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/sensors`, sensor, this.config);
  }

  async recordSensorSample(complexId: string, sample: { sensorId: string; value: unknown; timestampMs?: number; quality?: SensorSample["quality"] }): Promise<{ complexId: string; sample: SensorSample }> {
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/sensors/sample`, sample, this.config);
  }

  async listCalibrations(complexId: string): Promise<{ complexId: string; calibrations: CalibrationApiRecord[] }> {
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/calibrations`, this.config);
  }

  async saveCalibration(complexId: string, record: Record<string, unknown>): Promise<{ complexId: string; calibration: CalibrationApiRecord }> {
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/calibrations`, record, this.config);
  }

  async prepareFertigation(complexId: string, configuration: ConfigurationPayload, request: Record<string, unknown>): Promise<FertigationPrepareResponse> {
    return apiPost(`/complexes/${encodeURIComponent(complexId)}/fertigation/prepare`, { configuration, request }, this.config);
  }

  async listFertigationRuns(complexId: string, ghId?: string): Promise<{ complexId: string; runs: FertigationRun[] }> {
    const query = ghId ? `?ghId=${encodeURIComponent(ghId)}` : "";
    return apiGet(`/complexes/${encodeURIComponent(complexId)}/fertigation/runs${query}`, this.config);
  }
}
