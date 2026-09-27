import { apiGet, ESP32_API_BASE, isDirectEsp32Enabled, isPythonBackendEnabled, setActiveEsp32Endpoint, getActiveEsp32Endpoint } from "./api/backend-client";
import { PythonClient } from "./api/python-client";
import { localStoreClient } from "./api/local-store-client";
import { esp32Client } from "./api/esp32-client";
import { getStoredBootstrapIps, saveBootstrapIp, normalizeBootstrapEndpoint } from "./bootstrap-address";
import type { SystemTopologyPool } from "./api/contracts";
import {
  reconstructOperationalSnapshotFromPool,
  validateTopologyContract,
} from "./topology-pool";
import type { Complex, Greenhouse, FertigationSchedule, WellPumpSchedule, FanSchedule, EquipmentItem } from "./types";

type Snapshot = { complexes: Complex[]; greenhouses: Greenhouse[] };

let snapshot: Snapshot = { complexes: [], greenhouses: [] };
let loaded = false;
let loading = false;
let loadError: Error | null = null;
let version = 0;
const listeners = new Set<() => void>();
let inFlightHydration: Promise<void> | null = null;

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

export interface TopologyDiscoveryMetadata {
  authoritySource: "ESP32_DIRECT" | "BACKEND_MIRROR" | "NONE";
  authorityStatus: "LIVE" | "STALE" | "OFFLINE" | "UNKNOWN" | "CONFLICT";
  poolRevision: number;
  poolHash: string;
  reachableControllers: string[];
  offlineControllers: string[];
  totalKnownControllers: number;
  probedDevices: Record<string, {
    reachable: boolean;
    endpoint: string;
    status: "LIVE" | "OFFLINE";
    poolRevision?: number;
    poolHash?: string;
  }>;
}

let discoveryMetadata: TopologyDiscoveryMetadata | null = null;

export function getOperationalTopologyMetadata(): TopologyDiscoveryMetadata | null {
  return discoveryMetadata;
}

export type OperationalAuthorityState =
  | "READY"
  | "NO_COMPLEX_CONFIGURED"
  | "CONTROLLER_UNAVAILABLE"
  | "BOOTSTRAP_FAILED";

let authorityState: OperationalAuthorityState = "BOOTSTRAP_FAILED";

export function getOperationalAuthorityState(): OperationalAuthorityState {
  return authorityState;
}

async function probeControllerEndpoint(endpoint: string, timeoutMs = 3000): Promise<SystemTopologyPool | null> {
  try {
    const cleanEndpoint = normalizeBootstrapEndpoint(endpoint);
    if (!cleanEndpoint) return null;

    // Fast health probe check if available
    try {
      const healthController = typeof AbortController !== "undefined" ? new AbortController() : null;
      const healthTimer = healthController ? setTimeout(() => healthController.abort(), 1500) : null;
      await fetch(`${cleanEndpoint}/api/v1/health`, {
        signal: healthController ? healthController.signal : undefined,
        headers: { Accept: "application/json" },
      });
      if (healthTimer) clearTimeout(healthTimer);
    } catch {
      // Continue to topology-pool probe
    }

    const url = `${cleanEndpoint}/api/v1/topology-pool`;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const res = await fetch(url, {
      signal: controller ? controller.signal : undefined,
      headers: { Accept: "application/json" },
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const payload = data && data.payload ? data.payload : (data && data.data ? data.data : data);
    const validation = validateTopologyContract(payload);
    return validation.valid ? (payload as SystemTopologyPool) : null;
  } catch {
    return null;
  }
}

export function hydrateOperationalState(providedIp?: string): Promise<void> {
  if (inFlightHydration) {
    return inFlightHydration;
  }
  inFlightHydration = doHydrateOperationalState(providedIp).finally(() => {
    inFlightHydration = null;
  });
  return inFlightHydration;
}

export async function connectBootstrapIp(inputIp: string): Promise<boolean> {
  const norm = normalizeBootstrapEndpoint(inputIp);
  if (!norm) return false;
  try {
    await doHydrateOperationalState(norm);
    const meta = getOperationalTopologyMetadata();
    return meta?.authoritySource === "ESP32_DIRECT" || authorityState === "READY" || authorityState === "NO_COMPLEX_CONFIGURED";
  } catch {
    return false;
  }
}

async function doHydrateOperationalState(providedIp?: string): Promise<void> {
  loading = true;
  loadError = null;

  try {
    let pool: SystemTopologyPool | null = null;
    let authoritySource: "ESP32_DIRECT" | "BACKEND_MIRROR" | "NONE" = "NONE";
    let authorityStatus: "LIVE" | "STALE" | "OFFLINE" | "UNKNOWN" | "CONFLICT" = "UNKNOWN";
    const reachableDeviceIds = new Set<string>();
    const deviceEndpointMap = new Map<string, string>();
    const probedDevices: Record<string, {
      reachable: boolean;
      endpoint: string;
      status: "LIVE" | "OFFLINE";
      poolRevision?: number;
      poolHash?: string;
    }> = {};

    // 1. Determine candidate bootstrap endpoints (provided IP > stored locator hints > active > env)
    const candidates: string[] = [];
    if (providedIp) {
      const norm = normalizeBootstrapEndpoint(providedIp);
      if (norm) candidates.push(norm);
    }
    for (const ip of getStoredBootstrapIps()) {
      if (!candidates.includes(ip)) candidates.push(ip);
    }
    const currentActive = getActiveEsp32Endpoint();
    if (currentActive && !candidates.includes(currentActive)) {
      candidates.push(currentActive);
    }
    if (ESP32_API_BASE) {
      const norm = normalizeBootstrapEndpoint(ESP32_API_BASE);
      if (norm && !candidates.includes(norm)) candidates.push(norm);
    }

    let activeSeed = "";

    // 2. Direct ESP32 Discovery: probe candidate endpoints in order
    if (isDirectEsp32Enabled()) {
      for (const candidate of candidates) {
        try {
          const esp32Pool = await probeControllerEndpoint(candidate);
          if (esp32Pool && validateTopologyContract(esp32Pool).valid) {
            pool = esp32Pool;
            activeSeed = candidate;
            authoritySource = "ESP32_DIRECT";
            setActiveEsp32Endpoint(candidate);
            saveBootstrapIp(candidate);
            if (esp32Pool.originDeviceId) {
              reachableDeviceIds.add(esp32Pool.originDeviceId);
              deviceEndpointMap.set(esp32Pool.originDeviceId, candidate);
              probedDevices[esp32Pool.originDeviceId] = {
                reachable: true,
                endpoint: candidate,
                status: "LIVE",
                poolRevision: esp32Pool.poolRevision,
                poolHash: esp32Pool.poolHash,
              };
            }
            break;
          }
        } catch {
          // Continue probing next candidate
        }
      }
    }

    // 2. Fall back to backend topology mirror if direct ESP32 seed wasn't reached
    if (!pool) {
      try {
        const mirrorPool = await apiGet<SystemTopologyPool>("/v1/topology-pool");
        const validation = validateTopologyContract(mirrorPool);
        if (validation.valid) {
          pool = mirrorPool;
          authoritySource = "BACKEND_MIRROR";
        }
      } catch {
        // Backend mirror topology endpoint unavailable
      }
    }

    // 3. Multi-ESP32 Enumeration & Probing across all known controllers (Gate B)
    if (pool) {
      // Map known endpoints from pool registry
      for (const d of pool.devices || []) {
        const locator = d.endpoint || d.ipAddress || d.lastKnownIp;
        if (locator) {
          const norm = normalizeBootstrapEndpoint(locator);
          deviceEndpointMap.set(d.deviceId, norm);
        }
      }

      // Actively probe every known controller in the registry to build the reachability map
      if (isDirectEsp32Enabled()) {
        for (const d of pool.devices || []) {
          const deviceId = d.deviceId;
          const endpoint = d.endpoint || d.ipAddress || d.lastKnownIp || deviceEndpointMap.get(deviceId);

          if (reachableDeviceIds.has(deviceId)) {
            // Already confirmed reachable as seed node
            continue;
          }

          if (endpoint) {
            const normEndpoint = normalizeBootstrapEndpoint(endpoint);
            const peerPool = await probeControllerEndpoint(normEndpoint);
            if (peerPool) {
              reachableDeviceIds.add(deviceId);
              saveBootstrapIp(normEndpoint);
              probedDevices[deviceId] = {
                reachable: true,
                endpoint: normEndpoint,
                status: "LIVE",
                poolRevision: peerPool.poolRevision,
                poolHash: peerPool.poolHash,
              };
              // Safely reconcile peer replica with our pool copy
              try {
                const { reconcilePoolsSync } = await import("./topology-pool");
                pool = reconcilePoolsSync(pool!, peerPool);
              } catch {
                authorityStatus = "CONFLICT";
              }
            } else {
              probedDevices[deviceId] = {
                reachable: false,
                endpoint: normEndpoint,
                status: "OFFLINE",
              };
            }
          } else {
            probedDevices[deviceId] = {
              reachable: false,
              endpoint: "",
              status: "OFFLINE",
            };
          }
        }
      }

      // Determine final operational authority status (Gate D)
      if (reachableDeviceIds.size > 0) {
        authoritySource = "ESP32_DIRECT";
        if (authorityStatus !== "CONFLICT") {
          authorityStatus = "LIVE";
        }
      } else if (authoritySource === "BACKEND_MIRROR") {
        authorityStatus = "STALE"; // Strictly non-authoritative when 0 physical ESP32 controllers are reached
      }

      discoveryMetadata = {
        authoritySource,
        authorityStatus,
        poolRevision: pool!.poolRevision || 1,
        poolHash: pool!.poolHash || "",
        reachableControllers: Array.from(reachableDeviceIds),
        offlineControllers: (pool!.devices || [])
          .map((d) => d.deviceId)
          .filter((id) => !reachableDeviceIds.has(id)),
        totalKnownControllers: (pool!.devices || []).length,
        probedDevices,
      };

      const reconstructed = reconstructOperationalSnapshotFromPool(
        pool,
        reachableDeviceIds,
        deviceEndpointMap,
        authoritySource
      );

      // Direct ESP32 Mode: reconcile live controller identity directly with active ESP32 status
      if (isDirectEsp32Enabled() && activeSeed) {
        try {
          const espStatus = await esp32Client.getStatus();
          const devComplexId = espStatus.device?.complexId;
          const seedEndpoint = activeSeed;

          // If physical ESP32 is bound to a complexId, ensure it is present & active in reconstructed.complexes
          if (devComplexId) {
            const existingIdx = reconstructed.complexes.findIndex((c) => c.id === devComplexId);
            const existing = existingIdx >= 0 ? reconstructed.complexes[existingIdx] : null;

            const activeComplex: Complex = existing ? {
              ...existing,
              status: "Active",
              operationalStatus: "LIVE",
              authoritySource: "ESP32_DIRECT",
              esp32: {
                ...existing.esp32,
                online: true,
                synchronized: true,
                deviceId: espStatus.device?.deviceId || existing.esp32.deviceId || "esp32",
                endpoint: seedEndpoint,
                hardwareModel: espStatus.device?.hardwareModel || existing.esp32.hardwareModel,
                firmwareVersion: espStatus.device?.firmwareVersion || existing.esp32.firmwareVersion,
                configVersion: espStatus.configuration?.version || existing.esp32.configVersion || 1,
                esp32ConfigVersion: espStatus.configuration?.version || existing.esp32.esp32ConfigVersion || 1,
                lastSync: new Date().toLocaleTimeString(),
              },
            } : {
              id: devComplexId,
              code: devComplexId.toUpperCase(),
              name: `Complex ${devComplexId.replace(/^complex-?/, "")}`,
              location: "ESP32 Managed Complex",
              status: "Active",
              emergencyStopped: Boolean(espStatus.safety?.emergencyStopped),
              systemStatus: "NORMAL",
              greenhouseIds: [],
              operationalStatus: "LIVE",
              authoritySource: "ESP32_DIRECT",
              esp32: {
                online: true,
                synchronized: true,
                deviceId: espStatus.device?.deviceId || "esp32",
                endpoint: seedEndpoint,
                hardwareModel: espStatus.device?.hardwareModel,
                firmwareVersion: espStatus.device?.firmwareVersion,
                configVersion: espStatus.configuration?.version || 1,
                esp32ConfigVersion: espStatus.configuration?.version || 1,
                lastSync: new Date().toLocaleTimeString(),
              },
              water: {
                wellPumpOn: Boolean(espStatus.actuators?.wellPump),
                rawTankPct: 100,
                flowTodayL: 0,
                flowDeltaPct: 0,
              },
            };

            if (existingIdx >= 0) {
              reconstructed.complexes[existingIdx] = activeComplex;
            } else {
              reconstructed.complexes.push(activeComplex);
            }

            if (espStatus.sensors) {
              for (const g of reconstructed.greenhouses) {
                if (g.complexId === devComplexId) {
                  if (espStatus.sensors.temperatureC !== undefined) g.telemetry.temperatureC = espStatus.sensors.temperatureC;
                  if (espStatus.sensors.humidityPct !== undefined) g.telemetry.humidityPct = espStatus.sensors.humidityPct;
                  if (espStatus.sensors.floatLowerOk !== undefined) g.telemetry.tankPct = espStatus.sensors.floatLowerOk ? 100 : 0;
                }
              }
            }
          }
        } catch (directErr) {
          console.warn("[operational-state] Direct ESP32 live status reconciliation failed:", directErr);
        }

        // Authoritative Recipe Store: fetch recipes directly from ESP32 SD card storage (zero Python dependency)
        try {
          const recipeRes = await esp32Client.getRecipes();
          const remoteRecipes = Array.isArray(recipeRes?.recipes) ? recipeRes.recipes : [];
          const normalizedRecipes = remoteRecipes.map((r: any) => ({
            id: r.recipeId || r.id,
            recipeId: r.recipeId || r.id,
            name: r.name || r.recipeId || "Unnamed Recipe",
            waterL: Number(r.waterL ?? r.targetWaterL ?? (r.volumeMl ? r.volumeMl / 1000 : 80)),
            dosingAml: Number(r.dosingAml ?? r.nutrientAml ?? 0),
            dosingBml: Number(r.dosingBml ?? r.nutrientBml ?? 0),
            dosingChannels: r.dosingChannels || [],
            targetEc: r.targetEc ? String(r.targetEc) : "-",
            targetPpm: r.targetPpm != null ? Number(r.targetPpm) : undefined,
            description: r.description || "",
            version: Number(r.version || 1),
          }));
          for (const g of reconstructed.greenhouses) {
            g.recipes = normalizedRecipes;
          }
        } catch (recErr) {
          console.warn("[operational-state] Direct ESP32 recipe sync failed:", recErr);
        }
      }

      // Supplementary merge: fetch non-authoritative research/telemetry context from Python backend.
      // IMPORTANT: /context is a Python-only endpoint. Only call it if Python backend is enabled.
      // Without this guard, apiGet("/context") would resolve to http://<ESP32_IP>/context
      // (because esp32BaseUrl is active), causing a CORS error and a 404 on the controller.
      if (isPythonBackendEnabled()) {
        try {
          const ctx = await apiGet<Snapshot>("/context");
          if (ctx && Array.isArray(ctx.complexes)) {
            for (const c of reconstructed.complexes) {
              const remoteC = ctx.complexes.find((x) => x.id === c.id);
              if (remoteC) {
                if (remoteC.water) c.water = remoteC.water;
                if (remoteC.location && (!c.location || c.location === "ESP32 Managed Complex")) c.location = remoteC.location;
                if (remoteC.code && !c.code) c.code = remoteC.code;
                if (remoteC.name && !c.name) c.name = remoteC.name;
                if (remoteC.esp32) {
                  if (remoteC.esp32.deviceId && (!c.esp32.deviceId || c.esp32.deviceId === "BACKEND-MIRROR")) {
                    c.esp32.deviceId = remoteC.esp32.deviceId;
                  }
                  if (remoteC.esp32.endpoint) c.esp32.endpoint = remoteC.esp32.endpoint;
                  if (remoteC.esp32.firmwareVersion) c.esp32.firmwareVersion = remoteC.esp32.firmwareVersion;
                  if (remoteC.esp32.hardwareModel) c.esp32.hardwareModel = remoteC.esp32.hardwareModel;
                  if (remoteC.esp32.apiVersion) c.esp32.apiVersion = remoteC.esp32.apiVersion;
                  if (remoteC.esp32.schemaVersion) c.esp32.schemaVersion = remoteC.esp32.schemaVersion;
                  if (remoteC.esp32.inventoryVersion) c.esp32.inventoryVersion = remoteC.esp32.inventoryVersion;
                  if (remoteC.esp32.lastSync) c.esp32.lastSync = remoteC.esp32.lastSync;
                  if (remoteC.esp32.configVersion) c.esp32.configVersion = remoteC.esp32.configVersion;
                  if (remoteC.esp32.esp32ConfigVersion) c.esp32.esp32ConfigVersion = remoteC.esp32.esp32ConfigVersion;
                  if (remoteC.esp32.online !== undefined) {
                    c.esp32.online = Boolean(remoteC.esp32.online);
                    c.esp32.synchronized = Boolean(remoteC.esp32.online);
                    if (c.esp32.online) {
                      c.systemStatus = "NORMAL";
                      c.status = "Active";
                      c.operationalStatus = "LIVE";
                    }
                  }
                }
                if (Array.isArray(remoteC.wellPumpSchedules)) {
                  c.wellPumpSchedules = remoteC.wellPumpSchedules;
                }
                // Restore complex-level equipment (Well Pump, Dist Pump, etc.) from backend context
                if (Array.isArray((remoteC as any).equipment) && (remoteC as any).equipment.length > 0) {
                  c.equipment = (remoteC as any).equipment;
                }
              }
            }
          }
          if (ctx && Array.isArray(ctx.greenhouses)) {
            for (const g of reconstructed.greenhouses) {
              const remoteG = ctx.greenhouses.find((x) => x.id === g.id);
              if (remoteG) {
                if (remoteG.telemetry) g.telemetry = remoteG.telemetry;
                if (remoteG.plants) g.plants = remoteG.plants;
                if (remoteG.crop) g.crop = remoteG.crop;
                if (remoteG.equipment) g.equipment = remoteG.equipment;
                // Note: Recipes are authoritative on ESP32 SD card, not Python backend.
                if (Array.isArray(remoteG.fertigationSchedules)) {
                  g.fertigationSchedules = remoteG.fertigationSchedules;
                }
                if (Array.isArray(remoteG.fanSchedules)) {
                  g.fanSchedules = remoteG.fanSchedules;
                }
                const tl = remoteG.cropTimelineConfig || remoteG.cropCycle?.cropTimelineConfig;
                if (tl) {
                  g.cropTimelineConfig = tl;
                }
                if (remoteG.cropCycle) {
                  g.cropCycle = {
                    status: remoteG.cropCycle.status || "NO_CYCLE",
                    tanggalTanam: remoteG.cropCycle.tanggalTanam ?? null,
                    tanggalPolinasi: remoteG.cropCycle.tanggalPolinasi ?? null,
                    variety: remoteG.cropCycle.variety ?? undefined,
                    plantCount: remoteG.cropCycle.plantCount ?? undefined,
                    notes: remoteG.cropCycle.notes ?? undefined,
                    targetHarvestHst: remoteG.cropCycle.targetHarvestHst ?? (tl?.targetHarvestHst ?? undefined),
                    cropTimelineConfig: tl ?? undefined,
                    lastHarvestSummary: remoteG.cropCycle.lastHarvestSummary ?? null,
                  };
                  const _cc = remoteG.cropCycle as unknown as Record<string, unknown>;
                  if (typeof _cc.hst === "number") {
                    g.telemetry.hstDays = _cc.hst as number;
                  }
                  if (typeof _cc.hsp === "number" || _cc.hsp === null) {
                    g.telemetry.hspDays = _cc.hsp as number | null;
                  }
                  if (remoteG.cropCycle.plantCount) {
                    g.plants.total = remoteG.cropCycle.plantCount;
                    g.plants.alive = remoteG.cropCycle.plantCount;
                  }
                  if (remoteG.cropCycle.variety) {
                    g.crop = remoteG.cropCycle.variety;
                  }
                }
              }
              const parentComplex = reconstructed.complexes.find((c) => c.id === g.complexId);
              if (parentComplex && parentComplex.esp32?.online) {
                g.online = true;
              } else if (remoteG && remoteG.online !== undefined) {
                g.online = Boolean(remoteG.online);
              }
            }
          }
        } catch {
          // Python context unavailable; physical topology snapshot stands intact
        }
      }


      // Authoritative Single Source of Truth Configuration & Equipment Sync:
      // Load configuration JSON directly from authoritative ESP32
      for (const c of reconstructed.complexes) {
        try {
          const cfg = await esp32Client.getConfiguration();
          if (cfg && Array.isArray(cfg.components) && cfg.components.length > 0) {
            // Complex-level equipment (unassigned to a specific GH, e.g. Well Pump, Dist Pump)
            const complexComponents = cfg.components.filter((comp: any) => !comp.assignment?.ghId);
            const cItems: EquipmentItem[] = complexComponents.map((comp: any) => ({
              name: comp.name,
              status: (comp.lifecycleState === "COMMISSIONED" || comp.lifecycleState === "ENABLED") ? "OK" : "OFFLINE",
              type: comp.supportedTypeId || comp.role || undefined,
              category: comp.role || comp.supportedTypeId || undefined,
            }));
            c.equipment = cItems;

            // Per-GH equipment (e.g. Blower Fans, Dosing Pumps assigned to GH)
            for (const gh of reconstructed.greenhouses.filter((g) => g.complexId === c.id)) {
              const ghComponents = cfg.components.filter((comp: any) => comp.assignment?.ghId === gh.id);
              const items: EquipmentItem[] = ghComponents.map((comp: any) => ({
                name: comp.name,
                status: (comp.lifecycleState === "COMMISSIONED" || comp.lifecycleState === "ENABLED") ? "OK" : "OFFLINE",
                type: comp.supportedTypeId || comp.role || undefined,
                category: comp.role || comp.supportedTypeId || undefined,
              }));
              const hasMixing = items.some((it: any) => /MIXING|TANK/i.test(it.name || it.type || "")) ||
                                cfg.components.some((comp: any) => /MIXING|TANK/i.test(comp.name || comp.role || comp.supportedTypeId || ""));
              if (hasMixing || (gh.telemetry && (gh.telemetry.tankCapacityL ?? 0) > 0)) {
                if (!items.some((it: any) => it.name.toLowerCase().includes("mixing tank"))) {
                  items.unshift({
                    name: "Mixing Tank",
                    status: "OK",
                    type: "MIXING_TANK",
                    category: "TANK",
                  });
                }
              }
              gh.equipment = items;
            }
          }
        } catch {
          // ignore
        }
      }

      // 4b. Authoritative Schedule Intent Reconstruction from ESP32 NVS
      if (isDirectEsp32Enabled()) {
        try {
          const intentsRes = await esp32Client.getScheduleIntents();
          const items = Array.isArray(intentsRes?.items) ? intentsRes.items : [];
          
          for (const item of items) {
            const kind = item.kind || (item.recipeId ? "fertigation" : (item.task || item.radar || item.type === "well_pump" ? "wellPump" : (item.mode || item.type === "fan" ? "fan" : "unknown")));
            
            if (kind === "wellPump" || item.task || item.radar || item.type === "well_pump") {
              const targetComplex = reconstructed.complexes.find((c) => c.id === item.complexId) || reconstructed.complexes[0];
              if (targetComplex) {
                if (!targetComplex.wellPumpSchedules) targetComplex.wellPumpSchedules = [];
                const existingIdx = targetComplex.wellPumpSchedules.findIndex((s) => s.id === item.id);
                const s: WellPumpSchedule = {
                  id: item.id,
                  complexId: targetComplex.id,
                  task: (item.task || item.name || "Well Pump Routine") as string,
                  pump: item.pump as string | undefined,
                  componentId: item.componentId as string | undefined,
                  trigger: (item.trigger as any) || "time",
                  time: (item.time as string) || "06:00",
                  endTime: item.endTime as string | undefined,
                  durationMin: item.durationMin !== undefined ? Number(item.durationMin) : (item.durationSec !== undefined ? Number(item.durationSec) / 60 : 15),
                  durationSec: item.durationSec !== undefined ? Number(item.durationSec) : (item.durationMin !== undefined ? Number(item.durationMin) * 60 : undefined),
                  intervalMin: item.intervalMin !== undefined ? Number(item.intervalMin) : undefined,
                  repeat: (item.repeat as any) || "Every Day",
                  enabled: item.enabled !== false,
                  status: (item.status as any) || (item.enabled === false ? "disabled" : "scheduled"),
                  activationState: (item.activationState as any) || (item.enabled === false ? "DISABLED" : "ACTIVE"),
                  blockedReasons: item.blockedReasons || [],
                  lastRun: (item.lastRun as string) || null,
                  nextRun: (item.nextRun as string) || null,
                  radar: typeof item.radar === "object" && (item.radar as any)?.stopWhenFull ? "full" : ((item.radar as any) || "full"),
                };
                if (existingIdx >= 0) {
                  targetComplex.wellPumpSchedules[existingIdx] = s;
                } else {
                  targetComplex.wellPumpSchedules.push(s);
                }
              }
            } else if (kind === "fertigation" || item.recipeId || item.targetWaterL || item.type === "fertigation") {
              const targetGh = reconstructed.greenhouses.find(
                (g) => g.id === item.ghId || 
                       g.code?.toLowerCase() === item.ghId?.toLowerCase() || 
                       g.greenhouseTag?.toLowerCase() === item.ghId?.toLowerCase()
              ) || (reconstructed.greenhouses.length === 1 ? reconstructed.greenhouses[0] : undefined);
              if (targetGh) {
                if (!targetGh.fertigationSchedules) targetGh.fertigationSchedules = [];
                const existingIdx = targetGh.fertigationSchedules.findIndex((s) => s.id === item.id);
                const s: FertigationSchedule = {
                  id: item.id,
                  ghId: targetGh.id,
                  name: (item.name || item.task || "Fertigation Routine") as string,
                  recipeId: (item.recipeId as string) || "",
                  enabled: item.enabled !== false,
                  trigger: (item.trigger as any) || "specific-time",
                  time: (item.time as string) || "06:00",
                  endTime: item.endTime as string | undefined,
                  repeat: (item.repeat as any) || "Every Day",
                  intervalHours: item.intervalHours !== undefined ? Number(item.intervalHours) : undefined,
                  date: item.date as string | undefined,
                  targetMode: (item.targetMode as any) || "volume",
                  targetWaterL: item.targetWaterL !== undefined ? Number(item.targetWaterL) : (item.targetWaterVolumeMl !== undefined ? Number(item.targetWaterVolumeMl) / 1000 : 50),
                  dosingAml: Number(item.dosingAml ?? 0),
                  dosingBml: Number(item.dosingBml ?? 0),
                  dosingChannels: item.dosingChannels as any,
                  targetPpm: item.targetPpm !== undefined ? Number(item.targetPpm) : undefined,
                  fallbackEnabled: Boolean(item.fallbackEnabled),
                  fallbackScheduleId: item.fallbackScheduleId as string | undefined,
                  missedPolicy: (item.missedPolicy as any) || "skip",
                  recoveryWindowH: Number(item.recoveryWindowH ?? 2),
                  onlyToday: Boolean(item.onlyToday),
                  status: (item.status as any) || (item.enabled === false ? "disabled" : "scheduled"),
                  activationState: (item.activationState as any) || (item.enabled === false ? "DISABLED" : "ACTIVE"),
                  blockedReasons: item.blockedReasons || [],
                  lastRun: (item.lastRun as string) || null,
                  nextRun: (item.nextRun as string) || null,
                };
                if (existingIdx >= 0) {
                  targetGh.fertigationSchedules[existingIdx] = s;
                } else {
                  targetGh.fertigationSchedules.push(s);
                }
              }
            } else if (kind === "fan" || item.mode || item.onAboveC !== undefined || item.type === "fan") {
              const targetGh = reconstructed.greenhouses.find(
                (g) => g.id === item.ghId || 
                       g.code?.toLowerCase() === item.ghId?.toLowerCase() || 
                       g.greenhouseTag?.toLowerCase() === item.ghId?.toLowerCase()
              ) || (reconstructed.greenhouses.length === 1 ? reconstructed.greenhouses[0] : undefined);
              if (targetGh) {
                if (!targetGh.fanSchedules) targetGh.fanSchedules = [];
                const existingIdx = targetGh.fanSchedules.findIndex((s) => s.id === item.id);
                const s: FanSchedule = {
                  id: item.id,
                  ghId: targetGh.id,
                  mode: (item.mode as any) || "time",
                  time: (item.time as string) || "08:00",
                  durationMin: Number(item.durationMin ?? 30),
                  onAboveC: item.onAboveC !== undefined ? Number(item.onAboveC) : undefined,
                  offBelowC: item.offBelowC !== undefined ? Number(item.offBelowC) : undefined,
                  repeat: (item.repeat as any) || "Every Day",
                  enabled: item.enabled !== false,
                  status: (item.status as any) || (item.enabled === false ? "disabled" : "scheduled"),
                  activationState: (item.activationState as any) || (item.enabled === false ? "DISABLED" : "ACTIVE"),
                  blockedReasons: item.blockedReasons || [],
                  lastRun: (item.lastRun as string) || null,
                  nextRun: (item.nextRun as string) || null,
                };
                if (existingIdx >= 0) {
                  targetGh.fanSchedules[existingIdx] = s;
                } else {
                  targetGh.fanSchedules.push(s);
                }
              }
            }
          }

          // Enrich all schedules with live activation and hardware availability status
          const { enrichScheduleWithActivationState } = await import("./services");
          for (const c of reconstructed.complexes) {
            if (c.wellPumpSchedules && c.wellPumpSchedules.length > 0) {
              c.wellPumpSchedules = c.wellPumpSchedules.map((s) => enrichScheduleWithActivationState(s, "wellPump", undefined, c.id));
            }
          }
          for (const gh of reconstructed.greenhouses) {
            if (gh.fertigationSchedules && gh.fertigationSchedules.length > 0) {
              gh.fertigationSchedules = gh.fertigationSchedules.map((s) => enrichScheduleWithActivationState(s, "fertigation", gh.id, gh.complexId));
            }
            if (gh.fanSchedules && gh.fanSchedules.length > 0) {
              gh.fanSchedules = gh.fanSchedules.map((s) => enrichScheduleWithActivationState(s, "fan", gh.id, gh.complexId));
            }
          }
        } catch (err) {
          console.warn("[operational-state] Failed to hydrate schedule intents from ESP32:", err);
        }
      }

      if (reconstructed.complexes.some((c) => c.esp32?.online)) {
        discoveryMetadata.authorityStatus = "LIVE";
      }

      snapshot = reconstructed;
      loaded = true;
      loadError = null;
      const activeComplexCount = snapshot.complexes.filter((c) => c.status === "Active").length;
      authorityState = activeComplexCount > 0 ? "READY" : "NO_COMPLEX_CONFIGURED";
      notify();
      return;
    }

    // 5. Legacy fallback: try /context if Python backend is enabled
    if (isPythonBackendEnabled()) {
      try {
        const remote = await apiGet<Snapshot>("/context");
        snapshot = {
          complexes: Array.isArray(remote.complexes) ? remote.complexes : [],
          greenhouses: Array.isArray(remote.greenhouses) ? remote.greenhouses : [],
        };
        loaded = true;
        loadError = null;
        const activeComplexCount = snapshot.complexes.filter((c) => c.status === "Active").length;
        authorityState = activeComplexCount > 0 ? "READY" : "NO_COMPLEX_CONFIGURED";
        notify();
        return;
      } catch {
        // continue to empty / unavailable state
      }
    }

    // 6. Direct ESP32 mode with no ESP32 reachable
    // A stale IP that cannot be reached must NEVER erase known topology!
    if (snapshot.complexes.length > 0) {
      snapshot = {
        complexes: snapshot.complexes.map((c) => ({
          ...c,
          operationalStatus: "OFFLINE",
          systemStatus: "WARNING",
          esp32: {
            ...c.esp32,
            online: false,
            synchronized: false,
          },
        })),
        greenhouses: snapshot.greenhouses.map((g) => ({
          ...g,
          online: false,
        })),
      };
      discoveryMetadata = {
        authoritySource: "NONE",
        authorityStatus: "OFFLINE",
        poolRevision: discoveryMetadata?.poolRevision || 0,
        poolHash: discoveryMetadata?.poolHash || "",
        reachableControllers: [],
        offlineControllers: snapshot.complexes.map((c) => c.esp32?.deviceId).filter(Boolean) as string[],
        totalKnownControllers: snapshot.complexes.length,
        probedDevices: {},
      };
      authorityState = "CONTROLLER_UNAVAILABLE";
    } else {
      discoveryMetadata = {
        authoritySource: "NONE",
        authorityStatus: "OFFLINE",
        poolRevision: 0,
        poolHash: "",
        reachableControllers: [],
        offlineControllers: [],
        totalKnownControllers: 0,
        probedDevices: {},
      };
      snapshot = { complexes: [], greenhouses: [] };
      authorityState = "BOOTSTRAP_FAILED";
    }
    loaded = true;
    loadError = null;
    notify();
  } catch (error) {
    if (snapshot.complexes.length > 0) {
      snapshot = {
        complexes: snapshot.complexes.map((c) => ({
          ...c,
          operationalStatus: "OFFLINE",
          systemStatus: "WARNING",
          esp32: {
            ...c.esp32,
            online: false,
            synchronized: false,
          },
        })),
        greenhouses: snapshot.greenhouses.map((g) => ({
          ...g,
          online: false,
        })),
      };
      discoveryMetadata = {
        authoritySource: "NONE",
        authorityStatus: "OFFLINE",
        poolRevision: discoveryMetadata?.poolRevision || 0,
        poolHash: discoveryMetadata?.poolHash || "",
        reachableControllers: [],
        offlineControllers: snapshot.complexes.map((c) => c.esp32?.deviceId).filter(Boolean) as string[],
        totalKnownControllers: snapshot.complexes.length,
        probedDevices: {},
      };
      authorityState = "CONTROLLER_UNAVAILABLE";
    } else {
      discoveryMetadata = {
        authoritySource: "NONE",
        authorityStatus: "OFFLINE",
        poolRevision: 0,
        poolHash: "",
        reachableControllers: [],
        offlineControllers: [],
        totalKnownControllers: 0,
        probedDevices: {},
      };
      snapshot = { complexes: [], greenhouses: [] };
      authorityState = "BOOTSTRAP_FAILED";
    }
    loaded = true;
    loadError = null;
    notify();
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

export function removeComplex(complexId: string): void {
  snapshot = {
    complexes: snapshot.complexes.filter((item) => item.id !== complexId),
    greenhouses: snapshot.greenhouses.filter((item) => item.complexId !== complexId),
  };
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

export function removeGreenhouse(ghId: string): void {
  const gh = snapshot.greenhouses.find((item) => item.id === ghId);
  const nextComplexes = snapshot.complexes.map((c) => {
    if (gh && c.id === gh.complexId) {
      return { ...c, greenhouseIds: c.greenhouseIds.filter((id) => id !== ghId) };
    }
    return c;
  });
  snapshot = {
    complexes: nextComplexes,
    greenhouses: snapshot.greenhouses.filter((item) => item.id !== ghId),
  };
  loaded = true;
  notify();
}

export function updateComplexRuntime(complexId: string, data: {
  online?: boolean;
  emergencyStopped?: boolean;
  device?: { firmwareVersion?: string; hardwareModel?: string };
  configuration?: { version?: number };
  actuators?: Record<string, boolean>;
  sensors?: { temperatureC?: number | null; humidityPct?: number | null; floatLowerOk?: boolean };
}): void {
  const complex = snapshot.complexes.find((item) => item.id === complexId);
  if (!complex) return;
  const next = structuredClone(complex);
  if (data.emergencyStopped !== undefined) next.emergencyStopped = data.emergencyStopped;
  if (data.online !== undefined) {
    next.esp32.online = data.online;
    if (!data.online) {
      next.operationalStatus = "OFFLINE";
      next.esp32.synchronized = false;
    } else {
      if (next.operationalStatus === "OFFLINE" || !next.operationalStatus) {
        next.operationalStatus = "LIVE";
      }
      next.esp32.synchronized = true;
      next.esp32.lastSync = new Date().toLocaleTimeString();
    }
  }
  if (data.device?.firmwareVersion) next.esp32.firmwareVersion = data.device.firmwareVersion;
  if (data.device?.hardwareModel) next.esp32.hardwareModel = data.device.hardwareModel;
  if (data.configuration?.version !== undefined) {
    next.esp32.configVersion = data.configuration.version;
    next.esp32.esp32ConfigVersion = data.configuration.version;
  }
  if (data.actuators) next.water.wellPumpOn = Boolean(data.actuators.wellPump);
  replaceComplex(next);

  const ghs = snapshot.greenhouses.filter((item) => item.complexId === complexId);
  if (ghs.length && (data.online !== undefined || data.sensors)) {
    for (const greenhouse of ghs) {
      const updated = structuredClone(greenhouse);
      if (data.online !== undefined) updated.online = data.online;
      if (data.sensors) {
        if (data.sensors.temperatureC !== undefined) updated.telemetry.temperatureC = data.sensors.temperatureC;
        if (data.sensors.humidityPct !== undefined) updated.telemetry.humidityPct = data.sensors.humidityPct;
        if (data.sensors.floatLowerOk !== undefined) updated.telemetry.tankPct = data.sensors.floatLowerOk ? 100 : 0;
      }
      replaceGreenhouse(updated);
    }
  }
}

export async function refreshOperationalState(): Promise<void> {
  await hydrateOperationalState();
}

const realPythonClient = new PythonClient();

export const operationalPythonClient: PythonClient = new Proxy(realPythonClient, {
  get(target, prop, receiver) {
    const orig = Reflect.get(target, prop, receiver);
    if (typeof orig === "function") {
      return async (...args: any[]) => {
        if (!isPythonBackendEnabled()) {
          const localFn = (localStoreClient as any)[prop];
          if (typeof localFn === "function") {
            return localFn.apply(localStoreClient, args);
          }
        }
        try {
          return await orig.apply(target, args);
        } catch (err: any) {
          // If Python backend fails or is offline, failover seamlessly to localStoreClient
          const localFn = (localStoreClient as any)[prop];
          if (typeof localFn === "function") {
            console.warn(`[operationalPythonClient] Python call ${String(prop)} failed, falling back to local storage:`, err?.message || err);
            return await localFn.apply(localStoreClient, args);
          }
          throw err;
        }
      };
    }
    return orig;
  },
}) as PythonClient;
