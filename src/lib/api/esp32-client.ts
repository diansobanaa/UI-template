import type {
  ClockResponse,
  ClockSyncRequest,
  CommandReceipt,
  CommandRequest,
  ConfigurationValidation,
  ContextResponse,
  CropCycleHistoryResponse,
  CurrentCropCycleResponse,
  ConfigurationPayload,
  ConfigurationDeploymentState,
  InventoryResponse,
  HardwarePortConfig,
  HarvestCycleRequest,
  HealthResponse,
  ImportActiveCropCycleRequest,
  OperationRequest,
  PollinationRequest,
  Schedule,
  SchedulesResponse,
  CalibrationRates,
  StartCropCycleRequest,
  StatusResponse,
  TelemetrySnapshot,
  TelemetryHistoryResponse,
  EventResponse,
  UpdateCropCycleMetadataRequest,
  UpdatePlantingDateRequest,
  UpdatePollinationRequest,
  TopologyCapabilitiesResponse,
  CompiledScheduleDeploymentRequest,
  CompiledSchedulesResponse,
} from "./contracts";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, defaultConfig } from "./backend-client";

/** Direct REST port used when the UI reaches the ESP32 directly on the local WLAN/LAN. */
export class Esp32Client {
  constructor(private readonly config: HardwarePortConfig) {}

  private path(path: string): string {
    if (!this.config.directEsp32Enabled) {
      throw new Error("Direct ESP32 communication is disabled.");
    }
    const base = (this.config.esp32BaseUrl || "").replace(/\/$/, "");
    return `${base}${path}`;
  }

  private buildRequestEnvelope(payload: unknown): { requestId: string; client: { type: string; version: string }; payload: unknown } {
    return {
      requestId: crypto.randomUUID(),
      client: {
        type: "ReactUI",
        version: "1.0.0"
      },
      payload
    };
  }

  private async getEnveloped<T>(path: string): Promise<T> {
    const res = await apiGet<{ data: T }>(this.path(path), this.config);
    return res.data;
  }

  private async postEnveloped<T>(path: string, body: unknown): Promise<T> {
    const envelopedBody = this.buildRequestEnvelope(body);
    const res = await apiPost<{ data: T }>(this.path(path), envelopedBody, this.config);
    return res.data;
  }

  private async putEnveloped<T>(path: string, body: unknown): Promise<T> {
    const envelopedBody = this.buildRequestEnvelope(body);
    const res = await apiPut<{ data: T }>(this.path(path), envelopedBody, this.config);
    return res.data;
  }

  private async patchEnveloped<T>(path: string, body: unknown): Promise<T> {
    const envelopedBody = this.buildRequestEnvelope(body);
    const res = await apiPatch<{ data: T }>(this.path(path), envelopedBody, this.config);
    return res.data;
  }

  private async deleteEnveloped<T>(path: string): Promise<T> {
    const res = await apiDelete<{ data: T }>(this.path(path), this.config);
    return res.data;
  }

  /* -------------------------- Device & System -------------------------- */

  async getHealth(): Promise<HealthResponse> {
    return this.getEnveloped<HealthResponse>("/api/v1/health");
  }

  async getStatus(): Promise<StatusResponse> {
    return this.getEnveloped<StatusResponse>("/api/v1/status");
  }

  async getInventory(): Promise<InventoryResponse> {
    return this.getEnveloped<InventoryResponse>("/api/v1/inventory");
  }

  async getCapabilities(): Promise<import("./contracts").CapabilitiesResponse> {
    return this.getEnveloped<import("./contracts").CapabilitiesResponse>("/api/v1/capabilities");
  }

  async getContext(): Promise<ContextResponse> {
    return this.getEnveloped<ContextResponse>("/api/v1/context");
  }

  async getClock(): Promise<ClockResponse> {
    return this.getEnveloped<ClockResponse>("/api/v1/clock");
  }

  async syncClock(request: ClockSyncRequest): Promise<ClockResponse> {
    return this.postEnveloped<ClockResponse>("/api/v1/clock-sync", request);
  }

  /* -------------------------- Configuration -------------------------- */

  async getConfiguration(): Promise<ConfigurationPayload> {
    const response = await this.getEnveloped<{ payload: ConfigurationPayload }>("/api/v1/configuration");
    if (!response?.payload) throw new Error("ESP32 returned no active configuration payload.");
    return response.payload;
  }

  async getConfigurationDeployment(): Promise<ConfigurationDeploymentState> {
    return this.getEnveloped<ConfigurationDeploymentState>("/api/v1/configuration/deployment");
  }

  async validateConfiguration(configuration: ConfigurationPayload): Promise<ConfigurationValidation> {
    const response = await this.postEnveloped<{ valid: boolean; inventoryVersion: number; issues: Array<{ code?: string; message?: string; componentId?: string }> }>(
      "/api/v1/configuration/validate",
      { expectedVersion: configuration.version, configuration },
    );
    return {
      valid: response.valid,
      inventoryVersion: response.inventoryVersion ?? configuration.version,
      errors: (response.issues ?? []).map((issue) => ({
        code: issue.code ?? "VALIDATION_FAILED",
        message: issue.message ?? "Configuration validation failed.",
        componentId: issue.componentId,
      })),
      warnings: [],
    };
  }

  async saveConfiguration(configuration: ConfigurationPayload, deploymentId?: string): Promise<ConfigurationPayload> {
    const response = await this.putEnveloped<{ payload: ConfigurationPayload } & Record<string, unknown>>(
      "/api/v1/configuration",
      { expectedVersion: configuration.version, deploymentId: deploymentId ?? crypto.randomUUID(), configuration },
    );
    if (!response?.payload) throw new Error("ESP32 returned no activated configuration payload.");
    return response.payload;
  }

  async rollbackConfiguration(): Promise<ConfigurationPayload> {
    const response = await this.postEnveloped<{ payload: ConfigurationPayload }>(
      "/api/v1/configuration/rollback", {}
    );
    if (!response?.payload) throw new Error("ESP32 returned no rollback payload.");
    return response.payload;
  }

  /* -------------------------- Telemetry & Events -------------------------- */

  async getTelemetry(greenhouseId?: string): Promise<TelemetrySnapshot> {
    const query = greenhouseId ? `?ghId=${encodeURIComponent(greenhouseId)}` : "";
    return this.getEnveloped<TelemetrySnapshot>(`/api/v1/telemetry${query}`);
  }

  async getTelemetryHistory(greenhouseId?: string, afterSequence?: number, limit = 50): Promise<TelemetryHistoryResponse> {
    const params = new URLSearchParams();
    if (greenhouseId) params.set("ghId", greenhouseId);
    if (afterSequence !== undefined) params.set("afterSequence", String(afterSequence));
    params.set("limit", String(limit));
    return this.getEnveloped<TelemetryHistoryResponse>(`/api/v1/telemetry?${params.toString()}`);
  }

  async getLogs(cursor?: string, greenhouseId?: string, limit = 50): Promise<EventResponse> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (greenhouseId) params.set("ghId", greenhouseId);
    params.set("limit", String(limit));
    return this.getEnveloped<EventResponse>(`/api/v1/events?${params.toString()}`);
  }

  /* -------------------------- Commands & Safety -------------------------- */

  async emergencyStop(reason?: string, commandId?: string): Promise<CommandReceipt> {
    const stableCommandId = commandId || `estop-${Date.now()}`;
    return this.postEnveloped<CommandReceipt>("/api/v1/commands/emergency-stop", { commandId: stableCommandId, reason });
  }

  async getCommand(commandId: string): Promise<CommandReceipt> {
    return this.getEnveloped<CommandReceipt>(`/api/v1/commands/${encodeURIComponent(commandId)}`);
  }

  async postCommand(
    commandId: string,
    type: string,
    options?: {
      durationSeconds?: number,
      maxRuntimeSec?: number,
      componentId?: string,
      resourceId?: string,
      targetComplexId?: string,
      targetGhId?: string,
      configurationVersion?: number,
      source?: string,
      parameters?: Record<string, unknown>,
      rawWaterVolumeMl?: number
    }
  ): Promise<CommandReceipt> {
    const payload: CommandRequest = { commandId, type };
    if (options?.durationSeconds !== undefined) payload.durationSeconds = options.durationSeconds;
    if (options?.maxRuntimeSec !== undefined) payload.maxRuntimeSec = options.maxRuntimeSec;
    if (options?.componentId !== undefined) payload.componentId = options.componentId;
    if (options?.resourceId !== undefined) payload.resourceId = options.resourceId;
    if (options?.targetComplexId !== undefined) payload.targetComplexId = options.targetComplexId;
    if (options?.targetGhId !== undefined) payload.targetGhId = options.targetGhId;
    if (options?.configurationVersion !== undefined) payload.configurationVersion = options.configurationVersion;
    if (options?.source !== undefined) payload.source = options.source;
    if (options?.rawWaterVolumeMl !== undefined) payload.rawWaterVolumeMl = options.rawWaterVolumeMl;
    if (options?.parameters !== undefined) payload.parameters = options.parameters;
    return this.postEnveloped<CommandReceipt>("/api/v1/commands", payload);
  }

  async acknowledgeCommand(commandId: string): Promise<CommandReceipt> {
    return this.getCommand(commandId);
  }

  async cancelCommand(commandId: string): Promise<void> {
    return this.deleteEnveloped(`/api/v1/commands/${encodeURIComponent(commandId)}`);
  }

  /* -------------------------- Canonical Crop Cycle (OpenAPI) -------------------------- */

  async getCurrentCropCycle(ghId: string): Promise<CurrentCropCycleResponse> {
    return this.getEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycle`);
  }

  async listCropCycles(ghId: string, limit = 50, cursor?: string): Promise<CropCycleHistoryResponse> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return this.getEnveloped<CropCycleHistoryResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles?${query.toString()}`);
  }

  async startCropCycle(ghId: string, payload: StartCropCycleRequest): Promise<CurrentCropCycleResponse> {
    return this.postEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles`, payload);
  }

  async importActiveCropCycle(ghId: string, payload: ImportActiveCropCycleRequest): Promise<CurrentCropCycleResponse> {
    return this.postEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/import-active`, payload);
  }

  async recordPollination(ghId: string, cycleId: string, payload: PollinationRequest): Promise<CurrentCropCycleResponse> {
    return this.postEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/pollination`, payload);
  }

  async updatePollination(ghId: string, cycleId: string, payload: UpdatePollinationRequest): Promise<CurrentCropCycleResponse> {
    return this.patchEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/pollination`, payload);
  }

  async deletePollination(ghId: string, cycleId: string, requestId?: string): Promise<CurrentCropCycleResponse> {
    const query = requestId ? `?requestId=${encodeURIComponent(requestId)}` : "";
    return this.deleteEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/pollination${query}`);
  }

  async updatePlantingDate(ghId: string, cycleId: string, payload: UpdatePlantingDateRequest): Promise<CurrentCropCycleResponse> {
    return this.patchEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/planting-date`, payload);
  }

  async updateCropCycleMetadata(ghId: string, cycleId: string, payload: UpdateCropCycleMetadataRequest): Promise<CurrentCropCycleResponse> {
    return this.patchEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}`, payload);
  }

  async cancelCropCycle(ghId: string, cycleId: string, payload: OperationRequest = {}): Promise<CurrentCropCycleResponse> {
    return this.postEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/cancel`, payload);
  }

  async harvestCropCycle(ghId: string, cycleId: string, payload: HarvestCycleRequest = {}): Promise<CurrentCropCycleResponse> {
    return this.postEnveloped<CurrentCropCycleResponse>(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/harvest`, payload);
  }

  /* -------------------------- Calibration -------------------------- */

  async startCalibration(componentId: string, type: string, durationSec: number): Promise<any> {
    return this.postEnveloped<any>("/api/v1/calibration", { componentId, type, duration_sec: durationSec });
  }

  async getCalibrationStatus(): Promise<{ state: string; remaining_sec: number }> {
    return this.getEnveloped<{ state: string; remaining_sec: number }>("/api/v1/calibration/status");
  }

  async getCalibrationRates(): Promise<CalibrationRates> {
    return this.getEnveloped<CalibrationRates>("/api/v1/calibration/rate");
  }

  async saveCalibrationRate(componentId: string, rateMlPerSec: number): Promise<any> {
    return this.postEnveloped<any>("/api/v1/calibration/rate", { componentId, rateMlPerSec });
  }


  async getTopologyCapabilities(): Promise<TopologyCapabilitiesResponse> {
    return this.getEnveloped<TopologyCapabilitiesResponse>("/api/v1/topology-capabilities");
  }

  async getCompiledSchedules(): Promise<CompiledSchedulesResponse> {
    return this.getEnveloped<CompiledSchedulesResponse>("/api/v1/schedules/compiled");
  }

  async deployCompiledSchedules(request: CompiledScheduleDeploymentRequest): Promise<{ status: string; configurationVersion: number }> {
    return this.postEnveloped<{ status: string; configurationVersion: number }>("/api/v1/schedules/compiled", request);
  }

  async clearCompiledSchedules(): Promise<{ status: string }> {
    return this.deleteEnveloped<{ status: string }>("/api/v1/schedules/compiled");
  }

  /* -------------------------- Schedules (NVS) -------------------------- */

  async getSchedules(): Promise<SchedulesResponse> {
    return this.getEnveloped<SchedulesResponse>("/api/v1/schedules");
  }

  async saveSchedule(schedule: Schedule): Promise<any> {
    return this.postEnveloped<any>("/api/v1/schedules", schedule);
  }

  async deleteSchedule(id: string): Promise<any> {
    return this.deleteEnveloped<any>(`/api/v1/schedules/${encodeURIComponent(id)}`);
  }
}

export const esp32Client = new Esp32Client(defaultConfig);

