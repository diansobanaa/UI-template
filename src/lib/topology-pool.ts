/**
 * Client & Universal TypeScript implementation of the Canonical System Topology Pool.
 *
 * Implements deterministic SHA-256 hashing conforming to the canonical specification:
 * - schemaId: "agrotech.system-topology-pool"
 * - schemaVersion: 1
 * - contractHash: "sha256:37f9b7353170d9bc2c1cb8504eb7234209761841a2f654fe6cd975f0ffd2c6e8"
 */

import type {
  SystemTopologyPool,
  TopologyComplexRecord,
  TopologyGreenhouseRecord,
  TopologyDeviceRecord,
  TopologyTombstone,
  TopologyChangeRecord,
} from "./api/contracts";

export const TOPOLOGY_SCHEMA_ID = "agrotech.system-topology-pool";
export const TOPOLOGY_SCHEMA_VERSION = 1;
export const TOPOLOGY_CONTRACT_HASH = "sha256:37f9b7353170d9bc2c1cb8504eb7234209761841a2f654fe6cd975f0ffd2c6e8";

export const TOPOLOGY_ERRORS = {
  CONTRACT_MISMATCH: "TOPOLOGY_CONTRACT_MISMATCH",
  REVISION_CONFLICT: "TOPOLOGY_REVISION_CONFLICT",
  OWNER_CONFLICT: "TOPOLOGY_OWNER_CONFLICT",
  PARENT_NOT_FOUND: "TOPOLOGY_PARENT_NOT_FOUND",
  ENTITY_TOMBSTONED: "TOPOLOGY_ENTITY_TOMBSTONED",
  HASH_MISMATCH: "TOPOLOGY_HASH_MISMATCH",
  CONFLICT: "TOPOLOGY_CONFLICT",
} as const;

/**
 * Self-contained SHA-256 implementation conforming to FIPS 180-4.
 * Works synchronously and identically across Browser, Node.js, Web Workers, and Edge.
 */
function pureSha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i = 0, j = 0;
  let result = "";
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  let asciiPadded = ascii + "\x80";
  while ((asciiPadded.length % 64) - 56) asciiPadded += "\x00";

  for (i = 0; i < asciiPadded.length; i++) {
    j = asciiPadded.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      const s1h = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = (hash[7] + s1h + ch + k[i] + w[i]) | 0;
      const s0h = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = (s0h + maj) | 0;
      hash = [(temp1 + temp2) | 0, hash[0], hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }

  for (i = 0; i < 8; i++) {
    for (let b = 3; b >= 0; b--) {
      const byte = (hash[i] >> (8 * b)) & 255;
      result += (byte < 16 ? "0" : "") + byte.toString(16);
    }
  }
  return result;
}

/**
 * SHA-256 hex digest helper compatible with Browser Web Crypto, Node.js, and pure fallback.
 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle && typeof data !== "string") {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const str = typeof data === "string" ? data : new TextDecoder().decode(data);
  return pureSha256(str);
}

/** Synchronous sha256 helper for pure environment execution. */
export function sha256HexSync(data: string): string {
  return pureSha256(data);
}

/**
 * Produce the canonical JSON string for stable pool hashing.
 */
export function getCanonicalPoolJson(pool: Partial<SystemTopologyPool>): string {
  const stableDevices = (pool.devices || [])
    .slice()
    .sort((a, b) => (a.deviceId || "").localeCompare(b.deviceId || ""))
    .map((d) => ({
      contractVersion: d.contractVersion ?? TOPOLOGY_SCHEMA_VERSION,
      deviceId: d.deviceId || "",
      deviceState: d.deviceState || "KNOWN",
      hostname: d.hostname || "",
      ownerComplexIds: (d.ownerComplexIds || []).slice().sort(),
    }));

  const stableComplexes = (pool.complexes || [])
    .slice()
    .sort((a, b) => (a.complexId || "").localeCompare(b.complexId || ""))
    .map((c) => ({
      complexId: c.complexId || "",
      greenhouses: (c.greenhouses || []).slice().sort(),
      name: c.name || "",
      ownerDeviceId: c.ownerDeviceId || "",
      recordRevision: c.recordRevision ?? 1,
      state: c.state || "ACTIVE",
    }));

  const stableGreenhouses = (pool.greenhouses || [])
    .slice()
    .sort((a, b) => (a.ghId || "").localeCompare(b.ghId || ""))
    .map((g) => ({
      complexId: g.complexId || "",
      ghId: g.ghId || "",
      name: g.name || "",
      recordRevision: g.recordRevision ?? 1,
      state: g.state || "ACTIVE",
    }));

  const stableTombstones = (pool.tombstones || [])
    .slice()
    .sort((a, b) => {
      const typeComp = (a.entityType || "").localeCompare(b.entityType || "");
      if (typeComp !== 0) return typeComp;
      return (a.entityId || "").localeCompare(b.entityId || "");
    })
    .map((t) => ({
      deletedAt: t.deletedAt || "",
      deletionChangeId: t.deletionChangeId || "",
      entityId: t.entityId || "",
      entityType: t.entityType,
      recordRevision: t.recordRevision ?? 1,
    }));

  const canonicalObj = {
    complexes: stableComplexes,
    devices: stableDevices,
    greenhouses: stableGreenhouses,
    poolRevision: pool.poolRevision ?? 1,
    schemaId: TOPOLOGY_SCHEMA_ID,
    schemaVersion: TOPOLOGY_SCHEMA_VERSION,
    tombstones: stableTombstones,
  };

  return JSON.stringify(canonicalObj);
}

/**
 * Calculate the deterministic pool hash (sha256:<hex>).
 */
export async function calculatePoolHashAsync(pool: Partial<SystemTopologyPool>): Promise<string> {
  const jsonStr = getCanonicalPoolJson(pool);
  const hex = await sha256Hex(jsonStr);
  return `sha256:${hex}`;
}

/**
 * Synchronous pool hash for Node.js test scripts.
 */
export function calculatePoolHashSync(pool: Partial<SystemTopologyPool>): string {
  const jsonStr = getCanonicalPoolJson(pool);
  const hex = sha256HexSync(jsonStr);
  return `sha256:${hex}`;
}

/**
 * Validate that a pool matches the canonical contract specification.
 */
export function validateTopologyContract(pool: unknown): { valid: boolean; error?: string } {
  if (!pool || typeof pool !== "object") {
    return { valid: false, error: "Topology pool is not an object." };
  }
  const p = pool as Record<string, unknown>;
  if (p.schemaId !== TOPOLOGY_SCHEMA_ID) {
    return { valid: false, error: `Incompatible schemaId: expected '${TOPOLOGY_SCHEMA_ID}', got '${String(p.schemaId)}'` };
  }
  if (Number(p.schemaVersion) !== TOPOLOGY_SCHEMA_VERSION) {
    return { valid: false, error: `Incompatible schemaVersion: expected ${TOPOLOGY_SCHEMA_VERSION}, got ${String(p.schemaVersion)}` };
  }
  if (p.contractHash !== TOPOLOGY_CONTRACT_HASH) {
    return { valid: false, error: `Incompatible contractHash: expected '${TOPOLOGY_CONTRACT_HASH}', got '${String(p.contractHash)}'` };
  }
  if (!Array.isArray(p.complexes) || !Array.isArray(p.devices) || !Array.isArray(p.greenhouses)) {
    return { valid: false, error: "Topology pool must contain complexes, devices, and greenhouses arrays." };
  }
  return { valid: true };
}

/**
 * Reconcile multiple reachable pools into one unified pool according to
 * ownership, revisions, and tombstones.
 */
export function reconcilePoolsSync(basePool: SystemTopologyPool, peerPool: SystemTopologyPool): SystemTopologyPool {
  const contractCheck = validateTopologyContract(peerPool);
  if (!contractCheck.valid) {
    throw new Error(`${TOPOLOGY_ERRORS.CONTRACT_MISMATCH}: ${contractCheck.error}`);
  }

  // Merged tombstones
  const tombstoneMap = new Map<string, TopologyTombstone>();
  for (const t of [...(basePool.tombstones || []), ...(peerPool.tombstones || [])]) {
    const key = `${t.entityType}:${t.entityId}`;
    const existing = tombstoneMap.get(key);
    if (!existing || (t.recordRevision ?? 0) > (existing.recordRevision ?? 0)) {
      tombstoneMap.set(key, t);
    }
  }

  const tombstonedComplexes = new Set<string>();
  const tombstonedGhs = new Set<string>();
  for (const t of tombstoneMap.values()) {
    if (t.entityType === "COMPLEX") tombstonedComplexes.add(t.entityId);
    if (t.entityType === "GREENHOUSE") tombstonedGhs.add(t.entityId);
  }

  // Merged devices
  const deviceMap = new Map<string, TopologyDeviceRecord>();
  for (const d of [...(basePool.devices || []), ...(peerPool.devices || [])]) {
    if (!d.deviceId) continue;
    const existing = deviceMap.get(d.deviceId);
    if (!existing) {
      deviceMap.set(d.deviceId, { ...d });
    } else {
      const mergedComplexIds = Array.from(new Set([...(existing.ownerComplexIds || []), ...(d.ownerComplexIds || [])])).sort();
      deviceMap.set(d.deviceId, {
        ...existing,
        ...d,
        ownerComplexIds: mergedComplexIds,
        poolRevision: Math.max(existing.poolRevision ?? 0, d.poolRevision ?? 0),
      });
    }
  }

  // Merged complexes
  const complexMap = new Map<string, TopologyComplexRecord>();
  for (const c of [...(basePool.complexes || []), ...(peerPool.complexes || [])]) {
    if (!c.complexId || tombstonedComplexes.has(c.complexId)) continue;
    const existing = complexMap.get(c.complexId);
    if (!existing) {
      complexMap.set(c.complexId, { ...c });
    } else {
      if (existing.ownerDeviceId && c.ownerDeviceId && existing.ownerDeviceId !== c.ownerDeviceId) {
        throw new Error(
          `${TOPOLOGY_ERRORS.OWNER_CONFLICT}: Complex '${c.complexId}' owner mismatch: '${existing.ownerDeviceId}' vs '${c.ownerDeviceId}'.`
        );
      }
      if ((c.recordRevision ?? 0) > (existing.recordRevision ?? 0)) {
        complexMap.set(c.complexId, { ...c });
      } else {
        const ghSet = Array.from(new Set([...(existing.greenhouses || []), ...(c.greenhouses || [])]))
          .filter((g) => !tombstonedGhs.has(g))
          .sort();
        existing.greenhouses = ghSet;
      }
    }
  }

  // Merged greenhouses
  const ghMap = new Map<string, TopologyGreenhouseRecord>();
  for (const g of [...(basePool.greenhouses || []), ...(peerPool.greenhouses || [])]) {
    if (!g.ghId || tombstonedGhs.has(g.ghId) || !complexMap.has(g.complexId)) continue;
    const existing = ghMap.get(g.ghId);
    if (!existing) {
      ghMap.set(g.ghId, { ...g });
    } else {
      if (existing.complexId !== g.complexId) {
        throw new Error(`${TOPOLOGY_ERRORS.CONFLICT}: Greenhouse '${g.ghId}' assigned to multiple complexes.`);
      }
      if ((g.recordRevision ?? 0) > (existing.recordRevision ?? 0)) {
        ghMap.set(g.ghId, { ...g });
      }
    }
  }

  // Update complex greenhouse lists
  for (const [cid, comp] of complexMap.entries()) {
    const attachedGhs = Array.from(ghMap.values())
      .filter((g) => g.complexId === cid)
      .map((g) => g.ghId)
      .sort();
    comp.greenhouses = attachedGhs;
  }

  const localChangeIds = new Set((basePool.changes || []).map((c) => c.changeId).filter(Boolean));
  const peerChangeIds = new Set((peerPool.changes || []).map((c) => c.changeId).filter(Boolean));
  const localHasUnseen = Array.from(localChangeIds).some((id) => !peerChangeIds.has(id));
  const peerHasUnseen = Array.from(peerChangeIds).some((id) => !localChangeIds.has(id));

  let reconciledRev = Math.max(basePool.poolRevision ?? 1, peerPool.poolRevision ?? 1);
  if (peerHasUnseen && !localHasUnseen) {
    reconciledRev = peerPool.poolRevision ?? 1;
  } else if (localHasUnseen && !peerHasUnseen) {
    reconciledRev = basePool.poolRevision ?? 1;
  } else if (localHasUnseen && peerHasUnseen) {
    reconciledRev = Math.max(basePool.poolRevision ?? 1, peerPool.poolRevision ?? 1) + 1;
  }

  const reconciled: SystemTopologyPool = {
    schemaId: TOPOLOGY_SCHEMA_ID,
    schemaVersion: TOPOLOGY_SCHEMA_VERSION,
    contractHash: TOPOLOGY_CONTRACT_HASH,
    poolRevision: reconciledRev,
    poolHash: "",
    originDeviceId: basePool.originDeviceId || "RECONCILED",
    generatedAt: new Date().toISOString(),
    devices: Array.from(deviceMap.values()).sort((a, b) => a.deviceId.localeCompare(b.deviceId)),
    complexes: Array.from(complexMap.values()).sort((a, b) => a.complexId.localeCompare(b.complexId)),
    greenhouses: Array.from(ghMap.values()).sort((a, b) => a.ghId.localeCompare(b.ghId)),
    tombstones: Array.from(tombstoneMap.values()).sort((a, b) => `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`)),
    changes: [...(basePool.changes || []), ...(peerPool.changes || [])].slice(-100),
  };

  reconciled.poolHash = calculatePoolHashSync(reconciled);
  return reconciled;
}

/**
 * Convert a replicated SystemTopologyPool into in-memory ephemeral Complex and Greenhouse domain entities.
 */
export function reconstructOperationalSnapshotFromPool(
  pool: SystemTopologyPool,
  reachableDeviceIds: Set<string> = new Set(),
  deviceEndpointMap: Map<string, string> = new Map(),
  authoritySource: "ESP32_DIRECT" | "BACKEND_MIRROR" | "NONE" = "ESP32_DIRECT"
): { complexes: import("./types").Complex[]; greenhouses: import("./types").Greenhouse[] } {
  const tombstonedComplexIds = new Set(
    (pool.tombstones || [])
      .filter((t) => t.entityType === "COMPLEX")
      .map((t) => t.entityId)
  );
  const tombstonedGhIds = new Set(
    (pool.tombstones || [])
      .filter((t) => t.entityType === "GREENHOUSE")
      .map((t) => t.entityId)
  );

  const activeComplexRecords = (pool.complexes || []).filter(
    (c) => !tombstonedComplexIds.has(c.complexId) && c.state !== "TOMBSTONE" && c.state !== "DELETED"
  );

  const complexes: import("./types").Complex[] = activeComplexRecords.map((c) => {
    const isOwnerReachable = reachableDeviceIds.has(c.ownerDeviceId);
    const endpoint = deviceEndpointMap.get(c.ownerDeviceId) || "";
    
    // Explicit operational truth semantics:
    // LIVE: Owner controller confirmed online in current session
    // OFFLINE: Controller known in replicated pool but unreachable in current session
    // STALE: Fallback to backend mirror when NO controller is reachable
    let operationalStatus: "LIVE" | "STALE" | "OFFLINE" | "UNKNOWN" | "CONFLICT" = "UNKNOWN";
    if (authoritySource === "BACKEND_MIRROR" && reachableDeviceIds.size === 0) {
      operationalStatus = "STALE";
    } else if (isOwnerReachable) {
      operationalStatus = "LIVE";
    } else {
      operationalStatus = "OFFLINE";
    }

    return {
      id: c.complexId,
      code: c.code || c.complexId,
      name: c.name || c.complexId,
      location: c.location || (authoritySource === "BACKEND_MIRROR" && reachableDeviceIds.size === 0 ? "Backend Mirror (Non-Authoritative)" : "ESP32 Managed Complex"),
      status: (isOwnerReachable && c.state === "ACTIVE") ? "Active" : "Inactive",
      emergencyStopped: false,
      systemStatus: isOwnerReachable ? "NORMAL" : "WARNING",
      greenhouseIds: (c.greenhouses || []).filter((gid) => !tombstonedGhIds.has(gid)),
      operationalStatus,
      authoritySource,
      esp32: {
        online: isOwnerReachable,
        lastSync: new Date().toLocaleTimeString(),
        configVersion: c.recordRevision || 1,
        esp32ConfigVersion: c.recordRevision || 1,
        synchronized: isOwnerReachable,
        deviceId: c.ownerDeviceId,
        endpoint,
      },
      water: {
        wellPumpOn: false,
        rawTankPct: 100,
        flowTodayL: 0,
        flowDeltaPct: 0,
      },
    };
  });

  const complexOwnerMap = new Map<string, string>();
  for (const c of complexes) {
    complexOwnerMap.set(c.id, c.esp32.deviceId || "");
  }

  const activeGhRecords = (pool.greenhouses || []).filter(
    (g) => !tombstonedGhIds.has(g.ghId) && !tombstonedComplexIds.has(g.complexId) && g.state !== "TOMBSTONE" && g.state !== "DELETED"
  );

  const greenhouses: import("./types").Greenhouse[] = activeGhRecords.map((g) => {
    const ownerDeviceId = complexOwnerMap.get(g.complexId) || "";
    const isOnline = reachableDeviceIds.has(ownerDeviceId);
    return {
      id: g.ghId,
      code: g.code || g.ghId,
      crop: g.crop || "Tomato",
      complexId: g.complexId,
      online: isOnline,
      health: "NORMAL",
      greenhouseTag: g.greenhouseTag || g.code || g.ghId,
      areaM2: g.areaM2 ?? 500,
      fertigationState: "IDLE",
      cropCycle: {
        status: "NO_CYCLE",
        tanggalTanam: null,
        tanggalPolinasi: null,
        lastHarvestSummary: null,
      },
      telemetry: {
        temperatureC: null,
        humidityPct: null,
        lightLux: null,
        tempDeltaC: null,
        humidityDeltaPct: null,
        tankPct: 100,
        tankL: 1000,
        tankCapacityL: 1000,
        waterTodayL: null,
        waterYesterdayL: null,
        waterDeltaPct: null,
        hstDays: 0,
        hspDays: null,
      },
      plants: {
        total: 0,
        tracked: 0,
        alive: 0,
        dead: 0,
        avgHeightCm: 0,
        avgFruitWeightG: 0,
        totalFruits: 0,
        latestObservation: "-",
      },
      equipment: [],
      recipes: [],
      fertigationSchedules: [],
      fanSchedules: [],
      currentRun: null,
      queue: [],
      history: [],
      fruitDevSeries: [],
    };
  });

  return { complexes, greenhouses };
}
