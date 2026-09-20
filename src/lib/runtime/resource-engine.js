/**
 * Configuration-driven resource engine used by the topology and schedule compiler.
 * It intentionally contains no React/UI dependencies so the same semantics can
 * be exercised in Node acceptance tests and consumed by future backend code.
 */

const OPERATIONAL_LIFECYCLES = new Set(["COMMISSIONED", "ENABLED"]);

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function buildResourceIndex(configuration) {
  const resources = Array.isArray(configuration?.resources) ? configuration.resources : [];
  const components = Array.isArray(configuration?.components) ? configuration.components : [];
  const assignments = Array.isArray(configuration?.assignments) ? configuration.assignments : [];

  const componentById = new Map();
  for (const component of components) {
    const id = normalizeId(component?.componentId);
    if (id) componentById.set(id, component);
  }

  const assignmentByResource = new Map();
  for (const assignment of assignments) {
    const resourceId = normalizeId(assignment?.resourceId);
    if (!resourceId) continue;
    const list = assignmentByResource.get(resourceId) ?? [];
    list.push(assignment);
    assignmentByResource.set(resourceId, list);
  }

  const resourceById = new Map();
  for (const resource of resources) {
    const id = normalizeId(resource?.resourceId);
    if (!id) continue;
    const component = componentById.get(normalizeId(resource?.componentId));
    resourceById.set(id, {
      ...resource,
      resourceId: id,
      shared: normalizeBoolean(resource?.shared, false),
      available: normalizeBoolean(resource?.available, true),
      component,
      assignments: assignmentByResource.get(id) ?? [],
    });
  }

  // Backward-compatible derivation: a component with resourceId is itself a resource
  // when an explicit resources[] section has not been introduced yet.
  for (const component of components) {
    const resourceId = normalizeId(component?.resourceId);
    if (!resourceId || resourceById.has(resourceId)) continue;
    const assignmentsForResource = assignmentByResource.get(resourceId) ?? [];
    resourceById.set(resourceId, {
      resourceId,
      type: component.role || component.supportedTypeId || "COMPONENT",
      componentId: component.componentId,
      shared: false,
      available: true,
      component,
      assignments: assignmentsForResource,
    });
  }

  return { resourceById, componentById, assignmentByResource };
}

export function resourceOperational(resource) {
  if (!resource || resource.available === false) return false;
  const lifecycle = resource.component?.lifecycleState;
  return lifecycle == null || OPERATIONAL_LIFECYCLES.has(lifecycle);
}

export function getResourceOwner(resource, assignments = resource?.assignments ?? []) {
  if (!resource) return null;
  if (resource.currentOwnerId) return resource.currentOwnerId;
  const owners = assignments
    .map((assignment) => normalizeId(assignment?.ghId) || normalizeId(assignment?.ownerId) || normalizeId(assignment?.complexId))
    .filter(Boolean);
  return owners[0] ?? null;
}

export function resourceAssignedTo(resource, targetGhId) {
  if (!resource) return false;
  const ghId = normalizeId(targetGhId);
  if (!ghId) {
    return resource.assignments.some((a) => !normalizeId(a?.ghId));
  }
  return resource.assignments.some((a) => normalizeId(a?.ghId) === ghId);
}

export function validateResourceAssignments(configuration) {
  const issues = [];
  const { resourceById } = buildResourceIndex(configuration);
  const assignments = Array.isArray(configuration?.assignments) ? configuration.assignments : [];
  const seenAssignmentIds = new Set();

  for (const assignment of assignments) {
    const assignmentId = normalizeId(assignment?.assignmentId);
    const resourceId = normalizeId(assignment?.resourceId);
    if (!assignmentId) issues.push(issue("ASSIGNMENT_ID_REQUIRED", "Assignment ID is required."));
    else if (seenAssignmentIds.has(assignmentId)) issues.push(issue("DUPLICATE_ASSIGNMENT_ID", `Duplicate assignment '${assignmentId}'.`, { resourceId }));
    else seenAssignmentIds.add(assignmentId);

    const resource = resourceById.get(resourceId);
    if (!resource) {
      issues.push(issue("UNKNOWN_RESOURCE", `Assignment '${assignmentId || "<unknown>"}' references unknown resource '${resourceId}'.`, { assignmentId, resourceId }));
      continue;
    }

    if (resource.shared === false) {
      const exclusiveAssignments = assignments.filter((a) =>
        normalizeId(a?.resourceId) === resourceId && normalizeId(a?.ghId) !== ""
      );
      const ghOwners = new Set(exclusiveAssignments.map((a) => normalizeId(a?.ghId)));
      if (ghOwners.size > 1) {
        issues.push(issue("EXCLUSIVE_RESOURCE_CONFLICT", `Exclusive resource '${resourceId}' has multiple GH owners.`, { resourceId }));
      }
    }
  }

  for (const resource of resourceById.values()) {
    if (resource.shared) continue;
    const owners = new Set((resource.assignments ?? []).map((a) => normalizeId(a?.ghId) || normalizeId(a?.ownerId)).filter(Boolean));
    if (owners.size > 1) {
      issues.push(issue("EXCLUSIVE_RESOURCE_CONFLICT", `Exclusive resource '${resource.resourceId}' has multiple owners.`, { resourceId: resource.resourceId }));
    }
  }

  return { valid: issues.length === 0, issues };
}

export function checkResourceConflicts(resourceIds, activeLocks = [], ownerId, configuration = null) {
  const conflicts = [];
  const wanted = [...new Set((resourceIds ?? []).map(normalizeId).filter(Boolean))];
  const { resourceById } = configuration ? buildResourceIndex(configuration) : { resourceById: new Map() };
  const lockMap = new Map();
  for (const lock of activeLocks ?? []) {
    const resourceId = normalizeId(lock?.resourceId);
    if (resourceId) lockMap.set(resourceId, lock);
  }

  for (const resourceId of wanted) {
    const lock = lockMap.get(resourceId);
    if (!lock) continue;
    const lockedBy = normalizeId(lock.ownerId);
    const configuredResource = resourceById.get(resourceId);
    const lockType = normalizeId(lock.lockType || (configuredResource?.shared === true ? "SHARED" : "EXCLUSIVE")).toUpperCase();
    // Shared resources may be concurrently referenced. The runtime still records the
    // participant so a later exclusive request can be rejected appropriately.
    if (lockType === "SHARED") continue;
    if (lockedBy && lockedBy !== normalizeId(ownerId)) {
      conflicts.push({ resourceId, lockedBy, lockType });
    }
  }
  return conflicts;
}

export function deriveResourceLocks(resources, executableOwnerId, configuration = null) {
  const { resourceById } = configuration ? buildResourceIndex(configuration) : { resourceById: new Map() };
  return (resources ?? []).map((resource) => {
    const resourceId = typeof resource === "string" ? resource : normalizeId(resource?.resourceId);
    const definition = resourceById.get(resourceId);
    return {
      resourceId,
      ownerId: executableOwnerId,
      lockType: definition?.shared === true ? "SHARED" : "EXCLUSIVE",
    };
  }).filter((lock) => lock.resourceId);
}

function issue(code, message, context = {}) {
  return { code, message, ...context };
}


export function transferResource(configuration, resourceId, targetGhId, { physicalMoveConfirmed = false } = {}) {
  const rid = normalizeId(resourceId); const ghId = normalizeId(targetGhId);
  if (!rid || !ghId) throw new Error("resourceId and targetGhId are required");
  if (!physicalMoveConfirmed) throw new Error("Physical move confirmation is required before ownership transfer");
  const { resourceById } = buildResourceIndex(configuration);
  const resource = resourceById.get(rid);
  if (!resource) throw new Error(`Resource '${rid}' is not registered`);
  if (resource.available === false) throw new Error(`Resource '${rid}' is unavailable`);
  const ghs = (configuration?.greenhouses ?? []).map(g => normalizeId(g?.ghId ?? g?.id)).filter(Boolean);
  if (!ghs.includes(ghId)) throw new Error(`Target GH '${ghId}' is not present in configuration`);
  const next = structuredClone(configuration);
  const assignments = Array.isArray(next.assignments) ? next.assignments : [];
  const owners = [];
  const kept = [];
  for (const assignment of assignments) {
    if (normalizeId(assignment?.resourceId) !== rid) { kept.push(assignment); continue; }
    const owner = normalizeId(assignment?.ghId ?? assignment?.ownerId); if (owner) owners.push(owner);
    if (resource.shared === true) kept.push(assignment);
  }
  if (!resource.shared) {
    kept.push({ assignmentId: `assign-${rid}-${ghId}`, resourceId: rid, scope: "GH", ghId });
  } else if (!kept.some(a => normalizeId(a?.resourceId) === rid && normalizeId(a?.ghId) === ghId)) {
    kept.push({ assignmentId: `assign-${rid}-${ghId}`, resourceId: rid, scope: "GH", ghId });
  }
  next.assignments = kept;
  for (const component of next.components ?? []) {
    if (normalizeId(component?.resourceId) !== rid) continue;
    component.assignment = { ...(component.assignment ?? {}), complexId: normalizeId(next.complexId), ghId };
  }
  next.version = Number(next.version ?? 0) + 1;
  return { configuration: next, fromGhIds: [...new Set(owners)], toGhId: ghId, physicalMoveConfirmed: true };
}
