/**
 * Execution Plan Generator
 * Canonical implementation for Mixing-Fertigation Operational Model.
 * Resolves physical hardware, recipes, calibrations, and resources into an authoritative execution plan.
 */

function id(value) { return typeof value === "string" ? value.trim() : ""; }
function arr(value) { return Array.isArray(value) ? value : []; }
function issue(code, message, context = {}) { return { code, message, ...context }; }

function findComponent(configuration, ghId, tokens, includeComplex = true) {
  const components = arr(configuration?.components);
  // First look for components strictly assigned to this GH
  const ghMatches = components.filter((component) => {
    if (id(component?.assignment?.ghId) !== ghId) return false;
    const lifecycle = id(component?.lifecycleState);
    if (lifecycle && !["COMMISSIONED", "ENABLED"].includes(lifecycle)) return false;
    const text = `${component?.componentId || ""} ${component?.role || ""} ${component?.supportedTypeId || ""} ${component?.name || ""}`.toUpperCase();
    return tokens.some((token) => text.includes(token));
  });
  if (ghMatches.length > 0) {
    // Prefer match that matches earlier tokens (more specific)
    for (const token of tokens) {
      const match = ghMatches.find((c) => `${c?.componentId || ""} ${c?.role || ""} ${c?.supportedTypeId || ""} ${c?.name || ""}`.toUpperCase().includes(token));
      if (match) return match;
    }
    return ghMatches[0];
  }

  if (!includeComplex) return null;

  // Fallback to unassigned/complex-scoped components
  const complexMatches = components.filter((component) => {
    if (id(component?.assignment?.ghId)) return false;
    const lifecycle = id(component?.lifecycleState);
    if (lifecycle && !["COMMISSIONED", "ENABLED"].includes(lifecycle)) return false;
    const text = `${component?.componentId || ""} ${component?.role || ""} ${component?.supportedTypeId || ""} ${component?.name || ""}`.toUpperCase();
    return tokens.some((token) => text.includes(token));
  });

  for (const token of tokens) {
    const match = complexMatches.find((c) => `${c?.componentId || ""} ${c?.role || ""} ${c?.supportedTypeId || ""} ${c?.name || ""}`.toUpperCase().includes(token));
    if (match) return match;
  }
  return complexMatches[0] || null;
}

function findComponents(configuration, ghId, tokens, includeComplex = true) {
  const components = arr(configuration?.components);
  return components.filter((component) => {
    const assignmentGh = id(component?.assignment?.ghId);
    const scopeMatches = assignmentGh === ghId || (includeComplex && !assignmentGh);
    if (!scopeMatches) return false;
    const lifecycle = id(component?.lifecycleState);
    if (lifecycle && !["COMMISSIONED", "ENABLED"].includes(lifecycle)) return false;
    const text = `${component?.componentId || ""} ${component?.role || ""} ${component?.supportedTypeId || ""} ${component?.name || ""}`.toUpperCase();
    return tokens.some((token) => text.includes(token));
  });
}

function resourceForComponent(configuration, component) {
  if (!component) return null;
  const rid = id(component.resourceId);
  const resources = arr(configuration?.resources);
  if (rid) {
    const found = resources.find((r) => id(r.resourceId) === rid);
    if (found) return found;
  }
  const cid = id(component.componentId);
  const found = resources.find((r) => id(r.componentId) === cid);
  if (found) return found;
  if (cid) {
    return {
      resourceId: `res-${cid}`,
      componentId: cid,
      shared: !component.assignment?.ghId,
      available: !component.lifecycleState || ["COMMISSIONED", "ENABLED"].includes(id(component.lifecycleState)),
    };
  }
  return null;
}

export function generateFertigationExecutionPlan(configuration, intentOrRequest, calibrations = {}) {
  const blockedReasons = [];
  const complexId = id(intentOrRequest?.complexId) || id(configuration?.complexId);
  let ghId = id(intentOrRequest?.ghId) || id(intentOrRequest?.targetGhId);

  // If ghId is omitted in single-GH complex, resolve deterministically (Spec §3.1 / §16)
  if (!ghId) {
    const poolGhs = arr(configuration?.topologyPool?.greenhouses);
    const cfgGhs = arr(configuration?.greenhouses);
    if (poolGhs.length === 1) {
      ghId = id(poolGhs[0].ghId || poolGhs[0].id);
    } else if (cfgGhs.length === 1) {
      ghId = id(cfgGhs[0].ghId || cfgGhs[0].id);
    } else {
      const assignedGhs = [...new Set(arr(configuration?.components).map((c) => id(c?.assignment?.ghId)).filter(Boolean))];
      if (assignedGhs.length === 1) {
        ghId = assignedGhs[0];
      }
    }
  }

  if (!ghId) {
    return {
      valid: false,
      status: "BLOCKED",
      executionPlan: null,
      blockedReasons: [issue("TARGET_GH_REQUIRED", "A target greenhouse ghId is required for fertigation.")],
    };
  }

  const recipeId = id(intentOrRequest?.recipeId || intentOrRequest?.parameters?.recipeId);
  const recipes = arr(configuration?.recipes);
  const recipe = recipeId ? (recipes.find((r) => id(r.recipeId || r.id) === recipeId) || null) : null;

  if (recipeId && !recipe) {
    return {
      valid: false,
      status: "BLOCKED",
      executionPlan: null,
      blockedReasons: [issue("UNKNOWN_RECIPE", `Recipe '${recipeId}' does not exist in configuration.`, { recipeId })],
    };
  }

  const targetWaterMl = Number(
    intentOrRequest?.targetWaterMl ||
    intentOrRequest?.parameters?.rawWaterVolumeMl ||
    (intentOrRequest?.targetWaterL ? Math.round(Number(intentOrRequest.targetWaterL) * 1000) : 0) ||
    20000
  );

  const rawWaterStartThresholdPercent = Number(
    intentOrRequest?.rawWaterStartThresholdPercent ||
    intentOrRequest?.parameters?.rawWaterStartThresholdPercent ||
    intentOrRequest?.parameters?.mixing?.rawWaterStartThresholdPercent ||
    intentOrRequest?.mixing?.rawWaterStartThresholdPercent ||
    20
  );

  if (targetWaterMl <= 0) {
    blockedReasons.push(issue("INVALID_TARGET_WATER", "Target water volume must be greater than zero."));
  }

  // 1. Resolve required hardware components for this GH
  const mixingTank = findComponent(configuration, ghId, ["MIXING_TANK", "TANK", "MIX-01", "MIX-02", "MIX"]);
  const rawWater = findComponent(configuration, null, ["WELL_PUMP", "RAW_SUBMERSIBLE", "RAW_WATER", "WATER_PUMP", "PUMP_WELL", "PUMP_SUBMERSIBLE", "WELL-PUMP"]);
  const rawFlow = findComponent(configuration, null, ["RAW_FLOW", "FLOW_RAW", "FLOW_METER", "FLOW_SENSOR", "RAW-FLOW"]);
  const level = findComponent(configuration, ghId, ["LEVEL_SENSOR", "FLOAT_LOWER", "FLOAT", "LEVEL", "RADAR", "LEVEL-01", "LEVEL-02"]);
  const deliveryPump = findComponent(configuration, ghId, ["DELIVERY_PUMP", "DIST_PUMP", "DISTRIBUTION_PUMP", "PUMP_DIST", "DIST-01", "DIST-02", "WATER_PUMP"]);
  const deliveryFlow = findComponent(configuration, ghId, ["DELIVERY_FLOW", "FLOW_FERT", "DIST_FLOW", "FLOW-01", "FLOW-02", "FLOW_METER", "FLOW_SENSOR"]);
  const mixingPump = findComponent(configuration, ghId, ["MIXING_PUMP", "MIX_PUMP", "PUMP_MIXING", "MIX-PUMP"]);
  const pressure = findComponent(configuration, ghId, ["PRESSURE_SENSOR", "PRESSURE"]);

  const deliveryMode = id(intentOrRequest?.deliveryMode || intentOrRequest?.delivery?.mode || "VOLUME").toUpperCase();
  const mixingDurationSec = Number(intentOrRequest?.mixingDurationSec ?? recipe?.mixingDurationSec ?? 0);

  if (!mixingTank) blockedReasons.push(issue("MIXING_TANK_UNAVAILABLE", `No commissioned/enabled mixing tank assigned to '${ghId}'.`, { ghId }));
  if (!rawWater) blockedReasons.push(issue("RAW_WATER_UNAVAILABLE", "No commissioned/enabled raw-water inlet or well pump available."));
  if (!rawFlow) blockedReasons.push(issue("RAW_FLOW_UNAVAILABLE", "No commissioned/enabled raw flow sensor available."));
  if (!level) blockedReasons.push(issue("LEVEL_SENSOR_UNAVAILABLE", `No commissioned/enabled level sensor assigned to '${ghId}'.`, { ghId }));
  if (!deliveryPump) blockedReasons.push(issue("DELIVERY_PUMP_UNAVAILABLE", `No commissioned/enabled delivery pump assigned to '${ghId}'.`, { ghId }));
  if (deliveryMode !== "DURATION" && !deliveryFlow) {
    blockedReasons.push(issue("DELIVERY_FLOW_UNAVAILABLE", `No commissioned/enabled delivery flow sensor assigned to '${ghId}'.`, { ghId }));
  }
  if (mixingDurationSec > 0 && !mixingPump) {
    blockedReasons.push(issue("MIXING_PUMP_UNAVAILABLE", `Mixing pump is required for mixingDurationSec > 0 in '${ghId}'.`, { ghId }));
  }
  if (deliveryMode === "PRESSURE_FLOW" && !pressure) {
    blockedReasons.push(issue("PRESSURE_SENSOR_UNAVAILABLE", `Pressure sensor is required for PRESSURE_FLOW delivery in '${ghId}'.`, { ghId }));
  }

  // 2. Resolve dosing channels
  const dosingPumps = findComponents(configuration, ghId, ["DOSING", "DOSE", "PUMP_DOSING"]);
  const hasExplicitDosing = Array.isArray(intentOrRequest?.dosingChannels) || Array.isArray(intentOrRequest?.parameters?.dosingChannels);
  const requestedChannels = arr(intentOrRequest?.dosingChannels || intentOrRequest?.parameters?.dosingChannels || recipe?.dosingChannels);

  let resolvedDosing = [];
  if (requestedChannels.length > 0) {
    for (const reqCh of requestedChannels) {
      const cid = id(reqCh.componentId || reqCh.id);
      const comp = arr(configuration?.components).find((c) => id(c.componentId) === cid && ["COMMISSIONED", "ENABLED"].includes(id(c.lifecycleState)));
      if (!comp) {
        blockedReasons.push(issue("DOSING_COMPONENT_UNAVAILABLE", `Dosing component '${cid}' is not available or enabled.`, { componentId: cid }));
        continue;
      }
      const reqMl = Number(reqCh.requestedMl || reqCh.targetMl || 0);
      if (reqMl <= 0) continue;
      const rate = Number(calibrations[cid]?.rateMlPerSec || calibrations.rateDosingAMlSec || comp.parameters?.rateMlPerSec || 2.5);
      const calId = id(reqCh.calibrationId || comp.parameters?.calibrationReference || `CAL-${cid.toUpperCase()}-V1`);
      const calVer = Number(reqCh.calibrationVersion || comp.parameters?.calibrationVersion || 1);
      resolvedDosing.push({
        componentId: cid,
        requestedMl: reqMl,
        rateMlPerSec: rate,
        runtimeSec: Math.max(1, Math.ceil(reqMl / rate)),
        calibrationId: calId,
        calibrationVersion: calVer,
      });
    }
  } else if (!hasExplicitDosing && recipe && dosingPumps.length > 0) {
    // Default to available dosing pumps with recipe-defined ratio or nominal default
    for (const dp of dosingPumps) {
      const cid = id(dp.componentId);
      const reqMl = Number(intentOrRequest?.parameters?.[`dosing${cid.slice(-1).toUpperCase()}Ml`] || 100);
      const rate = Number(calibrations[cid]?.rateMlPerSec || dp.parameters?.rateMlPerSec || 2.5);
      const calId = id(dp.parameters?.calibrationReference || `CAL-${cid.toUpperCase()}-V1`);
      const calVer = Number(dp.parameters?.calibrationVersion || 1);
      resolvedDosing.push({
        componentId: cid,
        requestedMl: reqMl,
        rateMlPerSec: rate,
        runtimeSec: Math.max(1, Math.ceil(reqMl / rate)),
        calibrationId: calId,
        calibrationVersion: calVer,
      });
    }
  }

  if (recipe && resolvedDosing.length === 0) {
    blockedReasons.push(issue("NO_DOSING_CHANNELS", "Fertigation recipe requires at least one active dosing channel with a positive volume."));
  }

  // 3. Resolve Resources
  const selectedComponents = {
    mixingTank: mixingTank ? id(mixingTank.componentId) : null,
    rawWater: rawWater ? id(rawWater.componentId) : null,
    fillPump: rawWater ? id(rawWater.componentId) : null,
    rawFlow: rawFlow ? id(rawFlow.componentId) : null,
    level: level ? id(level.componentId) : null,
    mixingPump: mixingPump ? id(mixingPump.componentId) : null,
    deliveryPump: deliveryPump ? id(deliveryPump.componentId) : null,
    deliveryFlow: deliveryFlow ? id(deliveryFlow.componentId) : null,
    pressure: pressure ? id(pressure.componentId) : null,
  };

  const compList = [
    mixingTank, rawWater, rawFlow, level, deliveryPump, deliveryFlow, mixingPump, pressure,
    ...resolvedDosing.map((d) => arr(configuration?.components).find((c) => id(c.componentId) === d.componentId)),
  ].filter(Boolean);

  const planResources = [];
  const seenResources = new Set();

  for (const comp of compList) {
    const res = resourceForComponent(configuration, comp);
    if (!res) {
      blockedReasons.push(issue("COMPONENT_RESOURCE_MISSING", `Component '${comp.componentId}' has no registered resource identity.`, { componentId: comp.componentId }));
      continue;
    }
    const rid = id(res.resourceId);
    if (seenResources.has(rid)) continue;
    seenResources.add(rid);
    planResources.push({
      resourceId: rid,
      componentId: id(comp.componentId),
      shared: res.shared === true,
      available: res.available !== false,
    });
  }

  // 4. Sensor Calibrations
  const sensorCalibrations = {
    rawFlow: {
      sensorId: rawFlow ? id(rawFlow.componentId) : "raw-flow",
      calibrationId: id(rawFlow?.parameters?.calibrationReference) || "CAL-RAW-FLOW-V1",
      version: Number(rawFlow?.parameters?.calibrationVersion || 1),
    },
    ...(deliveryFlow ? {
      deliveryFlow: {
        sensorId: id(deliveryFlow.componentId),
        calibrationId: id(deliveryFlow.parameters?.calibrationReference) || `CAL-${id(deliveryFlow.componentId).toUpperCase()}-V1`,
        version: Number(deliveryFlow.parameters?.calibrationVersion || 1),
      }
    } : {}),
  };

  if (blockedReasons.length > 0) {
    return {
      valid: false,
      status: "BLOCKED",
      executionPlan: null,
      blockedReasons,
    };
  }

  // 5. Topology Paths and Valves
  const topologyPaths = arr(configuration?.topology).filter((p) => id(p.targetGhId) === ghId);
  const routingPaths = topologyPaths.map((p) => id(p.pathId || p.id)).filter(Boolean);
  const routingValves = topologyPaths.map((p) => id(p.valveResourceId)).filter(Boolean);

  const durationSec = Number(intentOrRequest?.durationSec || intentOrRequest?.parameters?.durationSec || 900);

  const executionPlan = {
    planVersion: 1,
    complexId,
    ghId,
    configurationVersion: Number(configuration?.version || 1),
    configurationHash: id(configuration?.configurationHash) || null,
    targetWaterMl,
    rawWaterStartThresholdPercent,
    mixing: {
      rawWaterStartThresholdPercent,
      targetWaterMl,
      dosingChannels: resolvedDosing,
    },
    components: selectedComponents,
    resources: planResources,
    topologyPaths,
    routingPaths,
    routingValves,
    resourceResolution: Object.fromEntries(planResources.map((r) => [r.resourceId, r])),
    sensorCalibrations,
    dosingChannels: resolvedDosing,
    recipe: recipe ? {
      recipeId: id(recipe.recipeId || recipe.id),
      version: Number(recipe.version || 1),
      snapshot: structuredClone(recipe),
    } : null,
    mixingDurationSec,
    delivery: {
      mode: deliveryMode,
      targetDeliveredMl: targetWaterMl,
      targetFlowLpm: Number(intentOrRequest?.targetFlowLpm || 0),
      targetPressureKpa: Number(intentOrRequest?.targetPressureKpa || 0),
      durationSec,
      toleranceMl: 100,
      allowDurationFallback: false,
    },
    timeouts: {
      maxRuntimeSec: Math.max(3600, durationSec * 2),
      minDosingRuntimeSec: 0,
      maxDosingRuntimeSec: 1800,
      fillTimeoutSec: 300,
      deliveryTimeoutSec: Math.max(600, durationSec),
    },
    safety: {
      safetyAcknowledged: true,
      emergencyStopRequired: true,
    },
  };

  return {
    valid: true,
    status: "READY",
    executionPlan,
    blockedReasons: [],
  };
}
