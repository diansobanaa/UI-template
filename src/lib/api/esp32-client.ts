import type {
  ClockSyncRequest,
  CommandReceipt,
  ConfigurationValidation,
  Esp32Configuration,
  Esp32EventLog,
  Esp32Inventory,
  HardwarePortConfig,
  TelemetrySnapshot,
} from "./contracts";
import { apiDelete, apiGet, apiPost, apiPut } from "./backend-client";

/** Direct REST port used when the UI can reach the ESP32 on the local/VPN network. */
export class Esp32Client {
  constructor(private readonly config: HardwarePortConfig) {}

  private path(path: string): string {
    if (!this.config.directEsp32Enabled || !this.config.esp32BaseUrl) {
      throw new Error("Direct ESP32 communication is not configured.");
    }
    return `${this.config.esp32BaseUrl.replace(/\/$/, "")}${path}`;
  }

  async getInventory(): Promise<Esp32Inventory> {
    return apiGet<Esp32Inventory>(this.path("/api/v1/inventory"), this.config);
  }

  async getConfiguration(): Promise<Esp32Configuration> {
    return apiGet<Esp32Configuration>(this.path("/api/v1/configuration"), this.config);
  }

  async validateConfiguration(configuration: Esp32Configuration): Promise<ConfigurationValidation> {
    return apiPost<ConfigurationValidation>(this.path("/api/v1/configuration/validate"), configuration, this.config);
  }

  async saveConfiguration(configuration: Esp32Configuration): Promise<Esp32Configuration> {
    return apiPut<Esp32Configuration>(this.path("/api/v1/configuration"), configuration, this.config);
  }

  async getTelemetry(greenhouseId?: string): Promise<TelemetrySnapshot> {
    const query = greenhouseId ? `?ghId=${encodeURIComponent(greenhouseId)}` : "";
    return apiGet<TelemetrySnapshot>(this.path(`/api/v1/telemetry${query}`), this.config);
  }

  async getLogs(cursor?: string): Promise<{ items: Esp32EventLog[]; nextCursor?: string }> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return apiGet<{ items: Esp32EventLog[]; nextCursor?: string }>(this.path(`/api/v1/events${query}`), this.config);
  }

  async syncClock(request: ClockSyncRequest): Promise<{ appliedAt: string }> {
    return apiPost<{ appliedAt: string }>(this.path("/api/v1/clock-sync"), request, this.config);
  }

  async emergencyStop(reason: string): Promise<CommandReceipt> {
    return apiPost<CommandReceipt>(this.path("/api/v1/commands/emergency-stop"), { reason }, this.config);
  }

  async acknowledgeCommand(commandId: string): Promise<CommandReceipt> {
    return apiGet<CommandReceipt>(this.path(`/api/v1/commands/${encodeURIComponent(commandId)}`), this.config);
  }

  async cancelCommand(commandId: string): Promise<void> {
    return apiDelete(this.path(`/api/v1/commands/${encodeURIComponent(commandId)}`), this.config);
  }
}
