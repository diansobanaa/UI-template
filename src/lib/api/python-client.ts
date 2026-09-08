import type {
  ClockSyncRequest,
  CommandReceipt,
  ConfigurationValidation,
  Esp32Configuration,
  Esp32EventLog,
  Esp32Inventory,
  SyncSnapshot,
  TelemetrySnapshot,
  HardwarePortConfig,
} from "./contracts";
import { PYTHON_API_BASE, apiGet, apiPost, apiPut } from "./backend-client";

/** Port for Python-owned history, identity, analytics and orchestration data. */
export class PythonClient {
  constructor(private readonly config: HardwarePortConfig = {
    pythonBaseUrl: PYTHON_API_BASE,
    requestTimeoutMs: 8000,
    directEsp32Enabled: false,
  }) {}

  async getSyncSnapshot(complexId: string): Promise<SyncSnapshot> {
    return apiGet<SyncSnapshot>(`/complexes/${encodeURIComponent(complexId)}/sync-snapshot`, this.config);
  }

  async getInventory(complexId: string): Promise<Esp32Inventory> {
    return apiGet<Esp32Inventory>(`/complexes/${encodeURIComponent(complexId)}/esp32/inventory`, this.config);
  }

  async getConfiguration(complexId: string): Promise<Esp32Configuration> {
    return apiGet<Esp32Configuration>(`/complexes/${encodeURIComponent(complexId)}/esp32/configuration`, this.config);
  }

  async validateConfiguration(complexId: string, configuration: Esp32Configuration): Promise<ConfigurationValidation> {
    return apiPost<ConfigurationValidation>(`/complexes/${encodeURIComponent(complexId)}/esp32/configuration/validate`, configuration, this.config);
  }

  async saveConfiguration(complexId: string, configuration: Esp32Configuration): Promise<Esp32Configuration> {
    return apiPut<Esp32Configuration>(`/complexes/${encodeURIComponent(complexId)}/esp32/configuration`, configuration, this.config);
  }

  async getTelemetry(complexId: string, greenhouseId?: string): Promise<TelemetrySnapshot> {
    const query = greenhouseId ? `?ghId=${encodeURIComponent(greenhouseId)}` : "";
    return apiGet<TelemetrySnapshot>(`/complexes/${encodeURIComponent(complexId)}/telemetry${query}`, this.config);
  }

  async getLogs(complexId: string, cursor?: string): Promise<{ items: Esp32EventLog[]; nextCursor?: string }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return apiGet<{ items: Esp32EventLog[]; nextCursor?: string }>(`/complexes/${encodeURIComponent(complexId)}/events${query}`, this.config);
  }

  async syncEsp32(complexId: string): Promise<SyncSnapshot> {
    return apiPost<SyncSnapshot>(`/complexes/${encodeURIComponent(complexId)}/esp32/sync`, {}, this.config);
  }

  async syncClock(complexId: string, request: ClockSyncRequest): Promise<{ appliedAt: string }> {
    return apiPost<{ appliedAt: string }>(`/complexes/${encodeURIComponent(complexId)}/esp32/clock-sync`, request, this.config);
  }

  async emergencyStop(complexId: string, body: { reason: string }): Promise<CommandReceipt> {
    return apiPost<CommandReceipt>(`/complexes/${encodeURIComponent(complexId)}/esp32/emergency-stop`, body, this.config);
  }
}
