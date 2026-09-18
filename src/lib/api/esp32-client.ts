import type {
  ClockResponse,
  ClockSyncRequest,
  CommandReceipt,
  ConfigurationValidation,
  ContextResponse,
  CropCycleHistoryResponse,
  CurrentCropCycleResponse,
  Esp32Configuration,
  Esp32EventLog,
  Esp32Inventory,
  HardwarePortConfig,
  HarvestCycleRequest,
  HealthResponse,
  ImportActiveCropCycleRequest,
  OperationRequest,
  PollinationRequest,
  ScheduleItem,
  SchedulesResponse,
  CalibrationRateResponse,
  StartCropCycleRequest,
  StatusResponse,
  TelemetrySnapshot,
  UpdateCropCycleMetadataRequest,
  UpdatePlantingDateRequest,
  UpdatePollinationRequest,
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

  async getInventory(): Promise<Esp32Inventory> {
    return this.getEnveloped<Esp32Inventory>("/api/v1/inventory");
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

  async getConfiguration(): Promise<Esp32Configuration> {
    return this.getEnveloped<Esp32Configuration>("/api/v1/configuration");
  }

  async validateConfiguration(configuration: Esp32Configuration): Promise<ConfigurationValidation> {
    return this.postEnveloped<ConfigurationValidation>("/api/v1/configuration/validate", { configuration });
  }

  async saveConfiguration(configuration: Esp32Configuration): Promise<Esp32Configuration> {
    return this.putEnveloped<Esp32Configuration>("/api/v1/configuration", configuration);
  }

  /* -------------------------- Telemetry & Events -------------------------- */

  async getTelemetry(greenhouseId?: string): Promise<TelemetrySnapshot> {
    const query = greenhouseId ? `?ghId=${encodeURIComponent(greenhouseId)}` : "";
    return this.getEnveloped<TelemetrySnapshot>(`/api/v1/telemetry${query}`);
  }

  async getLogs(cursor?: string): Promise<{ items: Esp32EventLog[]; nextCursor?: string }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.getEnveloped<{ items: Esp32EventLog[]; nextCursor?: string }>(`/api/v1/events${query}`);
  }

  /* -------------------------- Commands & Safety -------------------------- */

  async emergencyStop(reason?: string): Promise<CommandReceipt> {
    const commandId = `estop-${Date.now()}`;
    return this.postEnveloped<CommandReceipt>("/api/v1/commands/emergency-stop", { commandId, reason });
  }

  async getCommand(commandId: string): Promise<CommandReceipt> {
    return this.getEnveloped<CommandReceipt>(`/api/v1/commands/${encodeURIComponent(commandId)}`);
  }

  async postCommand(
    commandId: string, 
    type: string, 
    options?: { 
      durationSeconds?: number, 
      componentId?: string, 
      parameters?: any,
      rawWaterVolumeMl?: number,
      dosingAVolumeMl?: number,
      dosingBVolumeMl?: number
    }
  ): Promise<CommandReceipt> {
    const payload: any = { commandId, type };
    if (options?.durationSeconds !== undefined) payload.durationSeconds = options.durationSeconds;
    if (options?.componentId !== undefined) payload.componentId = options.componentId;
    if (options?.rawWaterVolumeMl !== undefined) payload.rawWaterVolumeMl = options.rawWaterVolumeMl;
    if (options?.dosingAVolumeMl !== undefined) payload.dosingAVolumeMl = options.dosingAVolumeMl;
    if (options?.dosingBVolumeMl !== undefined) payload.dosingBVolumeMl = options.dosingBVolumeMl;
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

  async getCalibrationRates(): Promise<CalibrationRateResponse> {
    return this.getEnveloped<CalibrationRateResponse>("/api/v1/calibration/rate");
  }

  async saveCalibrationRate(componentId: string, rateMlPerSec: number): Promise<any> {
    return this.postEnveloped<any>("/api/v1/calibration/rate", { componentId, rateMlPerSec });
  }

  /* -------------------------- Schedules (NVS) -------------------------- */

  async getSchedules(): Promise<SchedulesResponse> {
    return this.getEnveloped<SchedulesResponse>("/api/v1/schedules");
  }

  async saveSchedule(schedule: ScheduleItem): Promise<any> {
    return this.postEnveloped<any>("/api/v1/schedules", schedule);
  }

  async deleteSchedule(id: string): Promise<any> {
    return this.deleteEnveloped<any>(`/api/v1/schedules/${encodeURIComponent(id)}`);
  }
}

export const esp32Client = new Esp32Client(defaultConfig);

