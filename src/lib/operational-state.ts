import { apiGet } from "./api/backend-client";
import { PythonClient } from "./api/python-client";
import type { Complex, Greenhouse } from "./types";

type Snapshot = { complexes: Complex[]; greenhouses: Greenhouse[] };

let snapshot: Snapshot = { complexes: [], greenhouses: [] };
let loaded = false;
let loading = false;
let loadError: Error | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function subscribeOperationalState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOperationalStateVersion(): number {
  return version;
}

function notify() {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function getOperationalSnapshot(): Snapshot {
  return snapshot;
}

export function isOperationalLoaded(): boolean {
  return loaded;
}

export function getOperationalLoadError(): Error | null {
  return loadError;
}

export async function hydrateOperationalState(): Promise<void> {
  if (loading) return;
  loading = true;
  loadError = null;
  try {
    const remote = await apiGet<Snapshot>("/context");
    snapshot = {
      complexes: Array.isArray(remote.complexes) ? remote.complexes : [],
      greenhouses: Array.isArray(remote.greenhouses) ? remote.greenhouses : [],
    };
    loaded = true;
    notify();
  } catch (error) {
    loadError = error instanceof Error ? error : new Error("Operational backend is unavailable.");
    loaded = false;
    notify();
    throw loadError;
  } finally {
    loading = false;
  }
}

export function replaceComplex(complex: Complex): void {
  const index = snapshot.complexes.findIndex((item) => item.id === complex.id);
  if (index === -1) snapshot = { ...snapshot, complexes: [...snapshot.complexes, complex] };
  else {
    const complexes = [...snapshot.complexes];
    complexes[index] = complex;
    snapshot = { ...snapshot, complexes };
  }
  loaded = true;
  notify();
}

export function replaceGreenhouse(greenhouse: Greenhouse): void {
  const index = snapshot.greenhouses.findIndex((item) => item.id === greenhouse.id);
  if (index === -1) snapshot = { ...snapshot, greenhouses: [...snapshot.greenhouses, greenhouse] };
  else {
    const greenhouses = [...snapshot.greenhouses];
    greenhouses[index] = greenhouse;
    snapshot = { ...snapshot, greenhouses };
  }
  loaded = true;
  notify();
}

export function updateComplexRuntime(complexId: string, data: {
  online?: boolean;
  emergencyStopped?: boolean;
  device?: { firmwareVersion?: string; hardwareModel?: string };
  configuration?: { version?: number };
  actuators?: Record<string, boolean>;
  sensors?: { temperatureC?: number | null; floatLowerOk?: boolean };
}): void {
  const complex = snapshot.complexes.find((item) => item.id === complexId);
  if (!complex) return;
  const next = structuredClone(complex);
  if (data.emergencyStopped !== undefined) next.emergencyStopped = data.emergencyStopped;
  if (data.online !== undefined) next.esp32.online = data.online;
  if (data.device?.firmwareVersion) next.esp32.firmwareVersion = data.device.firmwareVersion;
  if (data.device?.hardwareModel) next.esp32.hardwareModel = data.device.hardwareModel;
  if (data.configuration?.version !== undefined) {
    next.esp32.configVersion = data.configuration.version;
    next.esp32.esp32ConfigVersion = data.configuration.version;
  }
  if (data.actuators) next.water.wellPumpOn = Boolean(data.actuators.wellPump);
  replaceComplex(next);

  const ghs = snapshot.greenhouses.filter((item) => item.complexId === complexId);
  if (ghs.length && data.sensors) {
    for (const greenhouse of ghs) {
      const updated = structuredClone(greenhouse);
      if (data.online !== undefined) updated.online = data.online;
      if (data.sensors.temperatureC !== undefined) updated.telemetry.temperatureC = data.sensors.temperatureC;
      if (data.sensors.floatLowerOk !== undefined) updated.telemetry.tankPct = data.sensors.floatLowerOk ? 100 : 0;
      replaceGreenhouse(updated);
    }
  }
}

export async function refreshOperationalState(): Promise<void> {
  await hydrateOperationalState();
}

export const operationalPythonClient = new PythonClient();
