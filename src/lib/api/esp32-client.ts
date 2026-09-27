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
  DeviceBindResponse,
  DeviceRetireResponse,
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
  ScheduleIntentItem,
  ScheduleIntentsResponse,
  ScheduleIntentMutationResponse,
} from "./contracts";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, defaultConfig } from "./backend-client";

export const HEALTH_TIMEOUT_MS = 6000;

/** Direct REST port used when the UI reaches the ESP32 directly on the local WLAN/LAN. */
export class Esp32Client {
  constructor(private readonly config: HardwarePortConfig) {}

  private path(path: string): string {
    if (this.config.directEsp32Enabled && this.config.esp32BaseUrl) {
      return `${this.config.esp32BaseUrl.replace(/\/$/, "")}${path}`;
    }
    const base = (this.config.pythonBaseUrl || "/api").replace(/\/$/, "");
    if (path.startsWith(base + "/") || path === base) {
      return path;
    }
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
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

  private async getEnveloped<T>(path: string, options?: { timeoutMs?: number; endpoint?: string }): Promise<T> {
    const targetUrl = options?.endpoint
      ? `${options.endpoint.replace(/\/$/, "")}${path}`
      : this.path(path);
    const res = await apiGet<{ data: T }>(targetUrl, this.config, options);
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

  async getHealth(options?: { timeoutMs?: number; endpoint?: string }): Promise<HealthResponse> {
    const timeoutMs = options?.timeoutMs ?? HEALTH_TIMEOUT_MS;
    return this.getEnveloped<HealthResponse>("/api/v1/health", { ...options, timeoutMs });
  }

  async bindDevice(deviceId: string, complexId: string): Promise<DeviceBindResponse> {
    return this.postEnveloped<DeviceBindResponse>("/api/v1/device/bind", { deviceId, complexId });
  }

  async retireDevice(complexId?: string, reason?: string): Promise<DeviceRetireResponse> {
    return this.postEnveloped<DeviceRetireResponse>("/api/v1/device/retire", { complexId, reason });
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

  /* ---------------------- System Topology Pool ---------------------- */

  async getTopologyPool(): Promise<import("./contracts").SystemTopologyPool> {
    return this.getEnveloped<import("./contracts").SystemTopologyPool>("/api/v1/topology-pool");
  }

  async getTopologyPoolMeta(): Promise<import("./contracts").TopologyPoolMetaResponse> {
    return this.getEnveloped<import("./contracts").TopologyPoolMetaResponse>("/api/v1/topology-pool/meta");
  }

  async syncTopologyPool(pool: import("./contracts").SystemTopologyPool): Promise<{ status: string; pool: import("./contracts").SystemTopologyPool }> {
    return this.postEnveloped<{ status: string; pool: import("./contracts").SystemTopologyPool }>("/api/v1/topology-pool/sync", { pool });
  }

  async mutateTopologyPool(mutation: import("./contracts").TopologyMutationRequest): Promise<import("./contracts").TopologyMutationResponse> {
    const stableOpId = mutation.operationId || mutation.changeId || `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload: import("./contracts").TopologyMutationRequest = {
      ...mutation,
      operationId: stableOpId,
      changeId: mutation.changeId || stableOpId,
    };
    return this.postEnveloped<import("./contracts").TopologyMutationResponse>("/api/v1/topology-pool/mutate", payload);
  }

  async applyTopologyMutation(mutation: import("./contracts").TopologyMutationRequest): Promise<import("./contracts").TopologyMutationResponse> {
    return this.mutateTopologyPool(mutation);
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

  async deployConfiguration(version: number): Promise<ConfigurationPayload> {
    const response = await this.postEnveloped<{ payload: ConfigurationPayload }>("/api/v1/configuration/deploy", { expectedVersion: version });
    if (!response?.payload) throw new Error("ESP32 returned no deployed configuration payload.");
    return response.payload;
  }

  async saveConfiguration(configuration: ConfigurationPayload, deploymentId?: string, expectedVersion?: number): Promise<ConfigurationPayload> {
    let expVer = expectedVersion !== undefined ? expectedVersion : configuration.version;
    if (expVer === undefined || expVer === 0 || expVer > 1000000) {
      try {
        const dep = await this.getConfigurationDeployment();
        const depAny = dep as any;
        const ver = typeof depAny?.activeVersion === "number" ? depAny.activeVersion : dep?.configurationVersion;
        if (typeof ver === "number") {
          expVer = ver;
        }
      } catch {
        // fallback
      }
    }
    const depId = deploymentId ?? crypto.randomUUID();
    const reqBody = {
      requestId: crypto.randomUUID(),
      expectedVersion: expVer,
      deploymentId: depId,
      payload: configuration,
    };
    const response = await apiPut<{ data: { payload?: ConfigurationPayload; configuration?: ConfigurationPayload } & ConfigurationPayload }>(
      this.path("/api/v1/configuration"),
      reqBody,
      this.config,
      { timeoutMs: 90000 }
    );
    const candidate = response?.data?.payload ?? response?.data?.configuration ?? response?.data;
    if (!candidate) throw new Error("ESP32 returned no activated configuration payload.");
    return candidate;
  }

  async rollbackConfiguration(version?: number): Promise<ConfigurationPayload> {
    const response = await this.postEnveloped<{ payload: ConfigurationPayload }>(
      "/api/v1/configuration/rollback",
      version !== undefined ? { targetVersion: version } : {},
    );
    if (!response?.payload) throw new Error("ESP32 returned no rollback payload.");
    return response.payload;
  }

  /* -------------------------- Telemetry & Events -------------------------- */

  async getTelemetry(greenhouseId?: string): Promise<TelemetrySnapshot> {
    const query = greenhouseId ? `?ghId=${encodeURIComponent(greenhouseId)}` : "";
    const snap = await this.getEnveloped<TelemetrySnapshot>(`/api/v1/telemetry/current${query}`);
    if (snap && snap.values) {
      if (snap.samples) {
        const waterSample = snap.samples.find((s) => {
          const cId = String(s.componentId || "").toLowerCase();
          return (cId.includes("ds18b20") || cId.includes("water") || cId.includes("temp_ds")) && typeof s.value === "number";
        });
        if (waterSample && typeof waterSample.value === "number") {
          snap.values.temperatureWaterC = waterSample.value;
          snap.values.waterTemperatureC = waterSample.value;
        }
      }
      if (typeof snap.values.temperatureC === "number" && snap.values.temperatureAirC === undefined) {
        snap.values.temperatureAirC = snap.values.temperatureC;
      }
    }
    return snap;
  }

  async getCurrentTelemetry(greenhouseId?: string): Promise<TelemetrySnapshot> {
    return this.getTelemetry(greenhouseId);
  }

  async getTelemetryHistory(greenhouseId?: string, afterSequence?: number, limit = 50): Promise<TelemetryHistoryResponse> {
    const params = new URLSearchParams();
    if (greenhouseId) params.set("ghId", greenhouseId);
    if (afterSequence !== undefined) params.set("afterSequence", String(afterSequence));
    params.set("limit", String(limit));
    const res = await this.getEnveloped<any>(`/api/v1/telemetry/history?${params.toString()}`);
    if (res) {
      if (Array.isArray(res.items) && !Array.isArray(res.samples)) {
        res.samples = res.items.flatMap((item: any) => item.samples || []);
      }
    }
    return res as TelemetryHistoryResponse;
  }

  createTelemetryWebSocket(
    onBatch: (batch: import("./contracts").TelemetryStreamBatch) => void,
    onError?: (err: Event) => void,
    onClose?: (event: CloseEvent) => void
  ): WebSocket {
    const wsProtocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
    const hostOrUrl = this.config.esp32BaseUrl || (typeof window !== "undefined" ? window.location.host : "localhost");
    const cleanBase = hostOrUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const url = `${wsProtocol}//${cleanBase}/api/v1/telemetry/stream`;
    const ws = new WebSocket(url);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.type === "telemetry_batch") {
          onBatch(data);
        }
      } catch (e) {
        console.error("Failed to parse telemetry stream frame:", e);
      }
    };
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: "subscribe" }));
      } catch {}
    };
    if (onError) ws.onerror = onError;
    if (onClose) ws.onclose = onClose;
    return ws;
  }

  async getLogs(cursor?: string, greenhouseId?: string, limit = 50): Promise<EventResponse> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (greenhouseId) params.set("ghId", greenhouseId);
    params.set("limit", String(limit));
    return this.getEnveloped<EventResponse>(`/api/v1/events?${params.toString()}`);
  }

  async getEvents(afterSequence?: number, limit = 50): Promise<EventResponse> {
    const params = new URLSearchParams();
    if (afterSequence !== undefined) params.set("afterSequence", String(afterSequence));
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

  /* -------------------------- Authoritative Schedule Intents (NVS) -------------------------- */

  async getScheduleIntents(): Promise<ScheduleIntentsResponse> {
    return this.getEnveloped<ScheduleIntentsResponse>(`/api/v1/schedule-intents?_t=${Date.now()}`);
  }

  async saveScheduleIntent(intent: ScheduleIntentItem): Promise<ScheduleIntentMutationResponse> {
    return this.postEnveloped<ScheduleIntentMutationResponse>("/api/v1/schedule-intents", intent);
  }

  async deleteScheduleIntent(id: string): Promise<ScheduleIntentMutationResponse> {
    return this.deleteEnveloped<ScheduleIntentMutationResponse>(`/api/v1/schedule-intents/${encodeURIComponent(id)}`);
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

  /* -------------------------- Fertigation Runtime -------------------------- */

  async getFertigationStatus(): Promise<any> {
    return this.getEnveloped<any>("/api/v1/fertigation/status");
  }

  async startFertigation(payload: Record<string, unknown>): Promise<any> {
    return this.postEnveloped<any>("/api/v1/fertigation/start", payload);
  }

  async stopFertigation(): Promise<any> {
    return this.postEnveloped<any>("/api/v1/fertigation/stop", {});
  }

  /* -------------------------- Recipes (MicroSD) -------------------------- */

  async getRecipes(): Promise<{ total: number; recipes: any[]; storageStatus?: string }> {
    return this.getEnveloped<{ total: number; recipes: any[]; storageStatus?: string }>("/api/v1/recipes");
  }

  async getRecipe(recipeId: string): Promise<any> {
    return this.getEnveloped<any>(`/api/v1/recipes/${encodeURIComponent(recipeId)}`);
  }

  async saveRecipe(recipe: Record<string, unknown>): Promise<any> {
    return this.postEnveloped<any>("/api/v1/recipes", recipe);
  }

  async updateRecipe(recipeId: string, recipe: Record<string, unknown>): Promise<any> {
    return this.putEnveloped<any>(`/api/v1/recipes/${encodeURIComponent(recipeId)}`, recipe);
  }

  async deleteRecipe(recipeId: string): Promise<{ deleted: boolean; recipeId: string }> {
    return this.deleteEnveloped<{ deleted: boolean; recipeId: string }>(`/api/v1/recipes/${encodeURIComponent(recipeId)}`);
  }
}

export const esp32Client = new Esp32Client(defaultConfig);


