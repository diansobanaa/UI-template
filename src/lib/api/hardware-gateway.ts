import { ESP32_API_BASE, PYTHON_API_BASE } from "./backend-client";
import { Esp32Client } from "./esp32-client";
import { PythonClient } from "./python-client";
import type {
  ClockSyncRequest,
  CommandReceipt,
  ConfigurationValidation,
  Esp32Configuration,
  Esp32EventLog,
  Esp32Inventory,
  HardwarePortConfig,
  SyncSnapshot,
  TelemetrySnapshot,
} from "./contracts";

export type GatewaySource = "PYTHON" | "ESP32";
export type GatewayStatus = "PYTHON_ONLINE" | "ESP32_DIRECT" | "OFFLINE";

export interface GatewayResult<T> {
  data: T;
  source: GatewaySource;
  receivedAt: string;
}

export interface HardwareGateway {
  sync(complexId: string): Promise<GatewayResult<SyncSnapshot>>;
  telemetry(complexId: string, greenhouseId?: string): Promise<GatewayResult<TelemetrySnapshot>>;
  logs(complexId: string, cursor?: string): Promise<GatewayResult<{ items: Esp32EventLog[]; nextCursor?: string }>>;
  validate(complexId: string, configuration: Esp32Configuration): Promise<GatewayResult<ConfigurationValidation>>;
  saveConfiguration(complexId: string, configuration: Esp32Configuration): Promise<GatewayResult<Esp32Configuration>>;
  syncClock(complexId: string, source: "PYTHON" | "UI"): Promise<GatewayResult<{ appliedAt: string }>>;
  emergencyStop(complexId: string, reason: string): Promise<GatewayResult<CommandReceipt>>;
}

export function createHardwareGateway(overrides: Partial<HardwarePortConfig> = {}): HardwareGateway {
  const config: HardwarePortConfig = {
    pythonBaseUrl: PYTHON_API_BASE,
    esp32BaseUrl: ESP32_API_BASE || undefined,
    requestTimeoutMs: 8000,
    directEsp32Enabled: Boolean(ESP32_API_BASE),
    ...overrides,
  };
  const python = new PythonClient(config);
  const esp32 = new Esp32Client(config);

  async function withFallback<T>(pythonCall: () => Promise<T>, espCall: () => Promise<T>): Promise<GatewayResult<T>> {
    try {
      return { data: await pythonCall(), source: "PYTHON", receivedAt: new Date().toISOString() };
    } catch (pythonError) {
      if (!config.directEsp32Enabled) throw pythonError;
      return { data: await espCall(), source: "ESP32", receivedAt: new Date().toISOString() };
    }
  }

  return {
    sync: (complexId) => withFallback(
      () => python.getSyncSnapshot(complexId),
      async () => ({
        inventory: await esp32.getInventory(),
        configuration: await esp32.getConfiguration(),
        validation: await esp32.validateConfiguration(await esp32.getConfiguration()),
        receivedAt: new Date().toISOString(),
      }),
    ),
    telemetry: (complexId, greenhouseId) => withFallback(
      () => python.getTelemetry(complexId, greenhouseId),
      () => esp32.getTelemetry(greenhouseId),
    ),
    logs: (complexId, cursor) => withFallback(
      () => python.getLogs(complexId, cursor),
      () => esp32.getLogs(cursor),
    ),
    validate: (complexId, configuration) => withFallback(
      () => python.validateConfiguration(complexId, configuration),
      () => esp32.validateConfiguration(configuration),
    ),
    saveConfiguration: (complexId, configuration) => withFallback(
      () => python.saveConfiguration(complexId, configuration),
      () => esp32.saveConfiguration(configuration),
    ),
    syncClock: (complexId, source) => {
      const request: ClockSyncRequest = {
        utcNow: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        source,
      };
      return withFallback(
        () => python.syncClock(complexId, request),
        () => esp32.syncClock(request),
      );
    },
    emergencyStop: (complexId, reason) => withFallback(
      () => python.emergencyStop(complexId, { reason }),
      () => esp32.emergencyStop(reason),
    ),
  };
}
