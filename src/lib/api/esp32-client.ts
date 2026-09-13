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
    if (!this.config.directEsp32Enabled || !this.config.esp32BaseUrl) {
      throw new Error("Direct ESP32 communication is not configured.");
    }
    return `${this.config.esp32BaseUrl.replace(/\/$/, "")}${path}`;
  }

  /* -------------------------- Device & System -------------------------- */

  async getHealth(): Promise<HealthResponse> {
    return apiGet<HealthResponse>(this.path("/api/v1/health"), this.config);
  }

  async getStatus(): Promise<StatusResponse> {
    return apiGet<StatusResponse>(this.path("/api/v1/status"), this.config);
  }

  async getInventory(): Promise<Esp32Inventory> {
    return apiGet<Esp32Inventory>(this.path("/api/v1/inventory"), this.config);
  }

  async getContext(): Promise<ContextResponse> {
    return apiGet<ContextResponse>(this.path("/api/v1/context"), this.config);
  }

  async getClock(): Promise<ClockResponse> {
    return apiGet<ClockResponse>(this.path("/api/v1/clock"), this.config);
  }

  async syncClock(request: ClockSyncRequest): Promise<ClockResponse> {
    return apiPost<ClockResponse>(this.path("/api/v1/clock-sync"), request, this.config);
  }

  /* -------------------------- Configuration -------------------------- */

  async getConfiguration(): Promise<Esp32Configuration> {
    return apiGet<Esp32Configuration>(this.path("/api/v1/configuration"), this.config);
  }

  async validateConfiguration(configuration: Esp32Configuration): Promise<ConfigurationValidation> {
    return apiPost<ConfigurationValidation>(this.path("/api/v1/configuration/validate"), { configuration }, this.config);
  }

  async saveConfiguration(configuration: Esp32Configuration): Promise<Esp32Configuration> {
    return apiPut<Esp32Configuration>(this.path("/api/v1/configuration"), configuration, this.config);
  }

  /* -------------------------- Telemetry & Events -------------------------- */

  async getTelemetry(greenhouseId?: string): Promise<TelemetrySnapshot> {
    const query = greenhouseId ? `?ghId=${encodeURIComponent(greenhouseId)}` : "";
    return apiGet<TelemetrySnapshot>(this.path(`/api/v1/telemetry${query}`), this.config);
  }

  async getLogs(cursor?: string): Promise<{ items: Esp32EventLog[]; nextCursor?: string }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return apiGet<{ items: Esp32EventLog[]; nextCursor?: string }>(this.path(`/api/v1/events${query}`), this.config);
  }

  /* -------------------------- Commands & Safety -------------------------- */

  async emergencyStop(reason: string, requestId?: string): Promise<CommandReceipt> {
    return apiPost<CommandReceipt>(this.path("/api/v1/commands/emergency-stop"), { reason, requestId }, this.config);
  }

  async getCommand(commandId: string): Promise<CommandReceipt> {
    return apiGet<CommandReceipt>(this.path(`/api/v1/commands/${encodeURIComponent(commandId)}`), this.config);
  }

  async acknowledgeCommand(commandId: string): Promise<CommandReceipt> {
    return this.getCommand(commandId);
  }

  async cancelCommand(commandId: string): Promise<void> {
    return apiDelete(this.path(`/api/v1/commands/${encodeURIComponent(commandId)}`), this.config);
  }

  /* -------------------------- Canonical Crop Cycle (OpenAPI) -------------------------- */

  async getCurrentCropCycle(ghId: string): Promise<CurrentCropCycleResponse> {
    return apiGet<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycle`), this.config);
  }

  async listCropCycles(ghId: string, limit = 50, cursor?: string): Promise<CropCycleHistoryResponse> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return apiGet<CropCycleHistoryResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles?${query.toString()}`), this.config);
  }

  async startCropCycle(ghId: string, payload: StartCropCycleRequest): Promise<CurrentCropCycleResponse> {
    return apiPost<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles`), payload, this.config);
  }

  async importActiveCropCycle(ghId: string, payload: ImportActiveCropCycleRequest): Promise<CurrentCropCycleResponse> {
    return apiPost<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/import-active`), payload, this.config);
  }

  async recordPollination(ghId: string, cycleId: string, payload: PollinationRequest): Promise<CurrentCropCycleResponse> {
    return apiPost<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/pollination`), payload, this.config);
  }

  async updatePollination(ghId: string, cycleId: string, payload: UpdatePollinationRequest): Promise<CurrentCropCycleResponse> {
    return apiPatch<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/pollination`), payload, this.config);
  }

  async deletePollination(ghId: string, cycleId: string, requestId?: string): Promise<CurrentCropCycleResponse> {
    const query = requestId ? `?requestId=${encodeURIComponent(requestId)}` : "";
    return apiDelete<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/pollination${query}`), this.config);
  }

  async updatePlantingDate(ghId: string, cycleId: string, payload: UpdatePlantingDateRequest): Promise<CurrentCropCycleResponse> {
    return apiPatch<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/planting-date`), payload, this.config);
  }

  async updateCropCycleMetadata(ghId: string, cycleId: string, payload: UpdateCropCycleMetadataRequest): Promise<CurrentCropCycleResponse> {
    return apiPatch<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}`), payload, this.config);
  }

  async cancelCropCycle(ghId: string, cycleId: string, payload: OperationRequest = {}): Promise<CurrentCropCycleResponse> {
    return apiPost<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/cancel`), payload, this.config);
  }

  async harvestCropCycle(ghId: string, cycleId: string, payload: HarvestCycleRequest = {}): Promise<CurrentCropCycleResponse> {
    return apiPost<CurrentCropCycleResponse>(this.path(`/api/v1/greenhouses/${encodeURIComponent(ghId)}/crop-cycles/${encodeURIComponent(cycleId)}/harvest`), payload, this.config);
  }
}

export const esp32Client = new Esp32Client(defaultConfig);

