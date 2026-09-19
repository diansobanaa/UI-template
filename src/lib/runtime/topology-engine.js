import { buildResourceIndex, resourceOperational, resourceAssignedTo, validateResourceAssignments } from "./resource-engine.js";

const REQUIRED_CAPABILITIES = [
  "CAN_DELIVER",
  "CAN_AUTO_FILL",
  "CAN_AUTO_DOSE",
  "CAN_AUTO_MIX",
  "CAN_AUTO_ROUTE",
  "CAN_MONITOR_FLOW",
  "CAN_MONITOR_LEVEL",
  "CAN_MONITOR_EC",
  "CAN_MONITOR_PH",
  "CAN_CLIMATE_CONTROL",
  "CAN_RUN_AUTONOMOUSLY",
];

const OPERATIONAL = new Set(["COMMISSIONED", "ENABLED"]);

function id(value) { return typeof value === "string" ? value.trim() : ""; }
function arr(value) { return Array.isArray(value) ? value : []; }
function issue(code, message, context = {}) { return { code, message, ...context }; }

export function validateTopology(configuration) {
  const topology = arr(configuration?.topology);
  const { resourceById } = buildResourceIndex(configuration);
  const issues = [];
  const pathIds = new Set();
  const edges = new Map();

  for (const path of topology) {
    const pathId = id(path?.pathId);
    const source = id(path?.sourceResourceId);
    const target = id(path?.targetResourceId);
    const mode = id(path?.mode || (path?.automatic ? "AUTOMATIC" : "MANUAL")).toUpperCase();

    if (!pathId) issues.push(issue("TOPOLOGY_PATH_ID_REQUIRED", "Topology pathId is required."));
    else if (pathIds.has(pathId)) issues.push(issue("DUPLICATE_TOPOLOGY_PATH_ID", `Duplicate topology path '${pathId}'.`, { pathId }));
    else pathIds.add(pathId);

    if (!source || !resourceById.has(source)) issues.push(issue("UNKNOWN_TOPOLOGY_SOURCE", `Topology path '${pathId || "<unknown>"}' references unknown source '${source}'.`, { pathId, source }));
    if (!target || !resourceById.has(target)) issues.push(issue("UNKNOWN_TOPOLOGY_TARGET", `Topology path '${pathId || "<unknown>"}' references unknown target '${target}'.`, { pathId, target }));
    if (source && target && source === target) issues.push(issue("TOPOLOGY_SELF_LOOP", `Topology path '${pathId}' cannot connect a resource to itself.`, { pathId }));
    if (!["AUTOMATIC", "MANUAL"].includes(mode)) issues.push(issue("INVALID_ROUTING_MODE", `Topology path '${pathId}' has invalid routing mode '${mode}'.`, { pathId }));

    for (const relationKey of ["pumpResourceId", "valveResourceId", "tankResourceId"]) {
      const resourceId = id(path?.[relationKey]);
      if (resourceId && !resourceById.has(resourceId)) {
        issues.push(issue("UNKNOWN_TOPOLOGY_RESOURCE", `Topology path '${pathId}' references unknown ${relationKey} '${resourceId}'.`, { pathId, resourceId }));
      } else if (resourceId) {
        const resource = resourceById.get(resourceId);
        const text = `${resource?.type || ""} ${resource?.component?.role || ""} ${resource?.component?.supportedTypeId || ""}`.toUpperCase();
        const expected = relationKey === "pumpResourceId" ? "PUMP" : relationKey === "valveResourceId" ? "VALVE" : "TANK";
        if (!text.includes(expected)) issues.push(issue("TOPOLOGY_RESOURCE_TYPE_MISMATCH", `Topology path '${pathId}' ${relationKey} must reference a ${expected.toLowerCase()} resource.`, { pathId, resourceId, expectedType: expected }));
      }
    }

    if (source && target && resourceById.has(source) && resourceById.has(target)) {
      const edge = { ...path, pathId, sourceResourceId: source, targetResourceId: target, mode };
      const existing = edges.get(source) ?? [];
      existing.push(edge);
      edges.set(source, existing);
    }
  }

  // A resource pair cannot have two enabled paths that both claim an exclusive physical route.
  for (const [source, paths] of edges.entries()) {
    const byTarget = new Map();
    for (const path of paths) {
      if (path.enabled === false) continue;
      const list = byTarget.get(path.targetResourceId) ?? [];
      list.push(path);
      byTarget.set(path.targetResourceId, list);
    }
    for (const [target, samePair] of byTarget.entries()) {
      const exclusive = samePair.filter((p) => p.shared === false);
      const owners = new Set(exclusive.map((p) => id(p.routeOwnerGhId)).filter(Boolean));
      if (exclusive.length > 1 && owners.size <= 1) {
        issues.push(issue("TOPOLOGY_PATH_CONFLICT", `Multiple exclusive active paths connect '${source}' to '${target}'.`, { sourceResourceId: source, targetResourceId: target }));
      }
    }
  }

  const resourceValidation = validateResourceAssignments(configuration);
  issues.push(...resourceValidation.issues.map((e) => ({ ...e, source: "resource-assignment" })));

  return { valid: issues.length === 0, issues, edges };
}

export function buildTopologyView(configuration, targetGhId = null) {
  const topologyValidation = validateTopology(configuration);
  const { resourceById } = buildResourceIndex(configuration);
  const greenhouses = arr(configuration?.greenhouses);
  const components = arr(configuration?.components);
  const ghById = new Map(greenhouses.map((gh) => [id(gh?.ghId || gh?.id), gh]));

  const paths = arr(configuration?.topology).filter((p) => p?.enabled !== false);
  const result = [];
  const wantedGhIds = targetGhId ? [id(targetGhId)] : greenhouses.map((gh) => id(gh?.ghId || gh?.id)).filter(Boolean);

  for (const ghId of wantedGhIds) {
    const gh = ghById.get(ghId);
    const ghResources = components
      .filter((component) => id(component?.assignment?.ghId) === ghId)
      .map((component) => id(component?.resourceId))
      .filter(Boolean);

    const tankResourceIds = ghResources.filter((resourceId) => {
      const resource = resourceById.get(resourceId);
      const text = `${resource?.type || ""} ${resource?.component?.role || ""} ${resource?.component?.supportedTypeId || ""}`.toUpperCase();
      return text.includes("TANK");
    });

    const pumpResourceIds = ghResources.filter((resourceId) => {
      const resource = resourceById.get(resourceId);
      const text = `${resource?.type || ""} ${resource?.component?.role || ""} ${resource?.component?.supportedTypeId || ""}`.toUpperCase();
      return text.includes("PUMP");
    });

    const ghPaths = paths.filter((path) => {
      const targetResourceId = id(path.targetResourceId);
      return tankResourceIds.includes(targetResourceId) || id(path.targetGhId) === ghId;
    });

    // A route to a GH is the source→mixing-tank/fill path. Delivery paths (mixing tank→plant)
    // are useful topology edges but must not make a manually routed GH appear automatically routable.
    const fillPaths = ghPaths.filter((path) => tankResourceIds.includes(id(path.targetResourceId)));
    const deliveryPaths = ghPaths.filter((path) => tankResourceIds.includes(id(path.sourceResourceId)) && pumpResourceIds.includes(id(path.targetResourceId)));
    const deliveryReachable = deliveryPaths.some((path) => {
      const auxOperational = ["pumpResourceId", "valveResourceId", "tankResourceId"].every((key) => {
        const rid = id(path?.[key]);
        return !rid || resourceOperational(resourceById.get(rid));
      });
      return resourceOperational(resourceById.get(id(path.sourceResourceId))) &&
        resourceOperational(resourceById.get(id(path.targetResourceId))) && auxOperational;
    });

    const configuredGhIds = greenhouses.map((item) => id(item?.ghId || item?.id)).filter(Boolean);
    const sourceTargets = new Map();
    for (const otherGh of configuredGhIds) {
      const otherTankIds = components
        .filter((component) => id(component?.assignment?.ghId) === otherGh)
        .map((component) => id(component?.resourceId))
        .filter((resourceId) => {
          const resource = resourceById.get(resourceId);
          const text = `${resource?.type || ""} ${resource?.component?.role || ""} ${resource?.component?.supportedTypeId || ""}`.toUpperCase();
          return text.includes("TANK");
        });
      for (const path of paths) {
        if (otherTankIds.includes(id(path.targetResourceId))) {
          const sourceId = id(path.sourceResourceId);
          if (sourceId) {
            const targets = sourceTargets.get(sourceId) ?? new Set();
            targets.add(otherGh);
            sourceTargets.set(sourceId, targets);
          }
        }
      }
    }
    const routingControlRequiredForGh = fillPaths.some((path) => {
      const sourceId = id(path.sourceResourceId);
      if (!sourceId) return false;
      const competingTargets = sourceTargets.get(sourceId);
      return Boolean(competingTargets && competingTargets.size > 1 && !id(path.valveResourceId) && competingTargets.has(ghId));
    });
    const automaticPaths = fillPaths.filter((p) => {
      if (id(p.mode || "AUTOMATIC").toUpperCase() !== "AUTOMATIC") return false;
      const sourceId = id(p.sourceResourceId);
      const competingTargets = sourceTargets.get(sourceId);
      // Once a shared source feeds multiple GHs, each GH needs explicit routing control
      // before the source can be considered automatically routable.
      if (competingTargets && competingTargets.size > 1 && !id(p.valveResourceId)) return false;
      return true;
    });
    const manualPaths = fillPaths.filter((p) => id(p.mode || "MANUAL").toUpperCase() === "MANUAL" || p.shared === true);
    const ownedManualPath = manualPaths.find((p) => id(p.routeOwnerGhId) === ghId);

    // Reachability is physical: an enabled fill path must exist and its participating resources must be usable.
    const hydraulicallyReachable = fillPaths.some((path) =>
      resourceOperational(resourceById.get(id(path.sourceResourceId))) &&
      resourceOperational(resourceById.get(id(path.targetResourceId)))
    );

    const automaticallyRoutable = automaticPaths.some((path) => {
      const valve = path.valveResourceId ? resourceById.get(id(path.valveResourceId)) : null;
      const pump = path.pumpResourceId ? resourceById.get(id(path.pumpResourceId)) : null;
      const tank = path.tankResourceId ? resourceById.get(id(path.tankResourceId)) : null;
      return (!path.valveResourceId || resourceOperational(valve)) &&
             (!path.pumpResourceId || resourceOperational(pump)) &&
             (!path.tankResourceId || resourceOperational(tank));
    });

    const manuallyRoutable = manualPaths.length > 0 || automaticallyRoutable;
    const selectedManualTarget = id(configuration?.manualRouteOwnerGhId) || id(ownedManualPath?.routeOwnerGhId) || null;
    const currentSharedTarget = manualPaths.some((p) => id(p.routeOwnerGhId) === ghId) ? ghId : selectedManualTarget;

    result.push({
      ghId,
      configured: Boolean(gh),
      hydraulicallyReachable,
      automaticallyRoutable,
      manuallyRoutable,
      currentSharedManualTarget: currentSharedTarget === ghId ? ghId : null,
      sharedPath: ghPaths.some((p) => p.shared === true || id(p.mode).toUpperCase() === "MANUAL"),
      routingControlRequired: routingControlRequiredForGh,
      pathIds: ghPaths.map((p) => id(p.pathId)).filter(Boolean),
      sourceResourceIds: [...new Set(ghPaths.map((p) => id(p.sourceResourceId)).filter(Boolean))],
      targetResourceIds: [...new Set(ghPaths.map((p) => id(p.targetResourceId)).filter(Boolean))],
      deliveryReachable,
      topologyConflicts: topologyValidation.issues.filter((e) => e.code === "TOPOLOGY_PATH_CONFLICT"),
    });
  }

  return {
    valid: topologyValidation.valid,
    issues: topologyValidation.issues,
    greenhouses: result,
  };
}

export function calculateCapabilities(configuration) {
  const { resourceById } = buildResourceIndex(configuration);
  const topology = buildTopologyView(configuration);
  const components = arr(configuration?.components);
  const assignments = arr(configuration?.assignments);

  const byGh = {};
  for (const state of topology.greenhouses) {
    const ghId = state.ghId;
    const resources = assignments
      .filter((assignment) => id(assignment?.ghId) === ghId)
      .map((assignment) => resourceById.get(id(assignment?.resourceId)))
      .filter(Boolean);

    const componentTexts = components
      .filter((component) => id(component?.assignment?.ghId) === ghId)
      .map((component) => `${component.role || ""} ${component.supportedTypeId || ""} ${component.name || ""}`.toUpperCase());

    const complexComponents = components
      .filter((component) => !id(component?.assignment?.ghId))
      .map((component) => `${component.role || ""} ${component.supportedTypeId || ""} ${component.name || ""}`.toUpperCase());

    const hasAny = (tokens) => [...componentTexts, ...complexComponents].some((text) => tokens.some((token) => text.includes(token)));
    const hasAssignedOperational = (tokens, predicate = null) => resources.some((resource) => {
      if (!resourceOperational(resource)) return false;
      const text = `${resource.type || ""} ${resource.component?.role || ""} ${resource.component?.supportedTypeId || ""}`.toUpperCase();
      return tokens.some((token) => text.includes(token)) && (!predicate || predicate(resource));
    });

    const canDeliverHardware = hasAssignedOperational(["PUMP"], (resource) => {
      const role = `${resource.type || ""} ${resource.component?.role || ""}`.toUpperCase();
      return role.includes("DIST") || role.includes("DELIVERY") || role.includes("FERTIGATION");
    }) || hasAny(["DIST_PUMP", "DISTRIBUTION_PUMP", "DELIVERY_PUMP", "FERTIGATION_PUMP"]);
    const canDeliver = Boolean(canDeliverHardware && state.deliveryReachable);

    const manualRouteGranted = Boolean(state.currentSharedManualTarget === ghId);
    const currentRouteActive = Boolean(state.automaticallyRoutable || manualRouteGranted);
    const canAutoFill = hasAny(["WELL_PUMP", "RAW_WATER", "RAW_SUBMERSIBLE"]) && state.hydraulicallyReachable && currentRouteActive;
    const canAutoDose = hasAny(["DOSING"]) && state.configured;
    const canAutoMix = hasAny(["MIXING_TANK", "MIX_TANK", "MIXING"]) && canAutoDose && (canAutoFill || state.hydraulicallyReachable);
    const canAutoRoute = state.automaticallyRoutable;
    const canMonitorFlow = hasAny(["FLOW_METER", "FLOW-METER", "FLOW_SENSOR"]);
    const canMonitorLevel = hasAny(["LEVEL", "FLOAT", "RADAR", "TANK_SENSOR"]);
    const canMonitorEc = hasAny(["EC", "CONDUCTIVITY"]);
    const canMonitorPh = hasAny(["PH"]);
    const canClimate = hasAny(["FAN", "CLIMATE", "TEMPERATURE", "HUMIDITY"]);

    // Manual/shared route can be used by exactly the selected GH. Without a route owner,
    // automatic execution is intentionally withheld because physical connection is unknown.
    const routeRequirementSatisfied = currentRouteActive || (!state.sharedPath && !state.routingControlRequired);
    const canRunAutonomously = Boolean(
      state.configured &&
      canDeliver &&
      canAutoDose &&
      canAutoMix &&
      routeRequirementSatisfied &&
      !state.topologyConflicts.length
    );

    const capabilities = {
      CAN_DELIVER: canDeliver,
      CAN_AUTO_FILL: canAutoFill,
      CAN_AUTO_DOSE: canAutoDose,
      CAN_AUTO_MIX: canAutoMix,
      CAN_AUTO_ROUTE: canAutoRoute,
      CAN_MONITOR_FLOW: canMonitorFlow,
      CAN_MONITOR_LEVEL: canMonitorLevel,
      CAN_MONITOR_EC: canMonitorEc,
      CAN_MONITOR_PH: canMonitorPh,
      CAN_CLIMATE_CONTROL: canClimate,
      CAN_RUN_AUTONOMOUSLY: canRunAutonomously,
    };

    // Preserve explicit required keys to keep the wire contract deterministic.
    for (const key of REQUIRED_CAPABILITIES) capabilities[key] = Boolean(capabilities[key]);

    byGh[ghId] = {
      ghId,
      configured: state.configured,
      hydraulicallyReachable: state.hydraulicallyReachable,
      automaticallyRoutable: state.automaticallyRoutable,
      manuallyRoutable: state.manuallyRoutable,
      currentSharedManualTarget: state.currentSharedManualTarget,
      deliveryReachable: Boolean(state.deliveryReachable),
      routingControlRequired: Boolean(state.routingControlRequired),
      capabilities,
    };
  }

  return {
    topologyVersion: Number(configuration?.version || 0),
    capabilitiesVersion: Number(configuration?.version || 0),
    valid: topology.valid,
    issues: topology.issues,
    byGh,
  };
}
