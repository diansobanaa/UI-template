import { buildResourceIndex, checkResourceConflicts, resourceAssignedTo, resourceOperational, validateResourceAssignments } from "./resource-engine.js";
import { buildTopologyView, calculateCapabilities, validateTopology } from "./topology-engine.js";

const EXECUTABLE = "ACTIVE";
const BLOCKED = "BLOCKED";
const INVALID = "INVALID";
const DISABLED = "DISABLED";

function id(value) { return typeof value === "string" ? value.trim() : ""; }
function arr(value) { return Array.isArray(value) ? value : []; }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function positive(value) { return finite(value) && value > 0; }
function issue(code, message, context = {}) { return { code, message, ...context }; }

export const ScheduleActivationState = Object.freeze({ DRAFT: "DRAFT", VALIDATING: "VALIDATING", ACTIVE: "ACTIVE", BLOCKED: "BLOCKED", DISABLED: "DISABLED", INVALID: "INVALID" });

export function normalizeScheduleIntent(input) {
  const trigger = input?.trigger ?? {};
  return {
    scheduleId: id(input?.scheduleId || input?.id),
    ownerId: id(input?.ownerId || input?.scheduleId || input?.id),
    complexId: id(input?.complexId),
    ghId: id(input?.ghId) || null,
    action: id(input?.action).toUpperCase(),
    enabled: input?.enabled !== false,
    priority: finite(input?.priority) ? Math.trunc(input.priority) : 100,
    trigger: {
      type: id(trigger.type || input?.type).toUpperCase(),
      hour: trigger.hour ?? input?.hour ?? null,
      minute: trigger.minute ?? input?.minute ?? null,
      daysOfWeek: trigger.daysOfWeek ?? input?.daysOfWeek ?? null,
      intervalMin: trigger.intervalMin ?? input?.intervalMin ?? null,
      timestamp: trigger.timestamp ?? input?.timestamp ?? null,
    },
    parameters: { ...(input?.parameters || {}) },
    recipeId: id(input?.recipeId) || null,
    missedRunPolicy: id(input?.missedRunPolicy || input?.missedPolicy || "skip").toUpperCase(),
    fallbackEnabled: input?.fallbackEnabled === true,
    fallbackScheduleId: id(input?.fallbackScheduleId) || null,
    timezone: id(input?.timezone || trigger.timezone) || null,
    validity: input?.validity || null,
    activationState: id(input?.activationState || input?.status).toUpperCase() || null,
  };
}

function findComplex(configuration, complexId) {
  const complexes = arr(configuration?.complexes);
  if (!complexes.length) return { complexId, exists: complexId === id(configuration?.complexId) };
  return complexes.find((c) => id(c?.complexId || c?.id) === complexId) ?? null;
}

function findGreenhouse(configuration, ghId, complexId) {
  return arr(configuration?.greenhouses).find((gh) => id(gh?.ghId || gh?.id) === ghId && id(gh?.complexId) === complexId) ?? null;
}

function findComponentByRole(configuration, ghId, tokens, includeComplex = true) {
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

function resourceIdForComponent(component) {
  return id(component?.resourceId);
}


function validateScheduleSchema(intent) {
  const errors = [];
  if (!intent.scheduleId) errors.push(issue("SCHEDULE_ID_REQUIRED", "Schedule ID is required."));
  if (!intent.complexId) errors.push(issue("COMPLEX_REQUIRED", "Target Complex is required."));
  if (!intent.action) errors.push(issue("ACTION_REQUIRED", "Schedule action is required."));
  if (!intent.trigger.type) errors.push(issue("TRIGGER_TYPE_REQUIRED", "Schedule trigger type is required."));
  if (!intent.ownerId) errors.push(issue("OWNER_REQUIRED", "Schedule owner is required."));
  if (!Array.isArray(intent.parameters) && (intent.parameters == null || typeof intent.parameters !== "object")) {
    errors.push(issue("INVALID_PARAMETERS", "Schedule parameters must be an object."));
  }
  return errors;
}

function validateRecurrence(trigger) {
  const errors = [];
  const type = id(trigger?.type).toUpperCase();
  if (!["DAILY", "INTERVAL", "ONCE"].includes(type)) {
    errors.push(issue("INVALID_RECURRENCE_TYPE", `Unsupported recurrence type '${type || "<empty>"}'.`));
    return errors;
  }
  if (type === "DAILY") {
    const hour = Number(trigger.hour);
    const minute = Number(trigger.minute);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) errors.push(issue("INVALID_HOUR", "DAILY schedule hour must be 0..23."));
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) errors.push(issue("INVALID_MINUTE", "DAILY schedule minute must be 0..59."));
    const days = Number(trigger.daysOfWeek);
    if (!Number.isInteger(days) || days < 1 || days > 127) errors.push(issue("INVALID_DAYS_OF_WEEK", "DAILY schedule requires a non-empty daysOfWeek bitmask (1..127)."));
  }
  if (type === "INTERVAL") {
    const interval = Number(trigger.intervalMin);
    if (!Number.isInteger(interval) || interval <= 0) errors.push(issue("INVALID_INTERVAL", "INTERVAL schedule requires intervalMin > 0."));
  }
  if (type === "ONCE") {
    if (!trigger.timestamp || Number.isNaN(new Date(trigger.timestamp).getTime())) errors.push(issue("INVALID_ONCE_TIMESTAMP", "ONCE schedule requires a valid timestamp."));
  }
  return errors;
}

function buildDependencyList(configuration, intent, topologyState, capabilityState) {
  const requirements = [];
  const resolvedComponents = [];
  const resolvedResources = [];
  const blocked = [];
  const ghId = intent.ghId;

  if (intent.action === "FERTIGATION") {
    const plan = intent.parameters?.executionPlan;
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      blocked.push(issue("EXECUTION_PLAN_REQUIRED", "Automatic FERTIGATION compilation requires a resolved execution plan."));
    } else {
      const planGh = id(plan.ghId);
      const planComplex = id(plan.complexId);
      const activeVersion = Number(configuration?.version || 0);
      const planVersion = Number(plan.configurationVersion || 0);
      if (!planComplex || planComplex !== intent.complexId) blocked.push(issue("PLAN_COMPLEX_MISMATCH", "Execution plan Complex does not match schedule intent."));
      if (!planGh || planGh !== ghId) blocked.push(issue("PLAN_GH_MISMATCH", "Execution plan GH does not match schedule intent."));
      if (!planVersion || planVersion !== activeVersion) blocked.push(issue("PLAN_CONFIGURATION_VERSION_MISMATCH", "Execution plan configurationVersion does not match active configuration."));
      if (configuration?.configurationHash && id(plan.configurationHash) !== id(configuration.configurationHash)) blocked.push(issue("PLAN_CONFIGURATION_HASH_MISMATCH", "Execution plan configurationHash does not match active configuration."));
      const components = plan.components;
      const requiredKeys = ["mixingTank", "rawWater", "fillPump", "rawFlow", "level", "deliveryPump"];
      if (!components || typeof components !== "object" || Array.isArray(components)) {
        blocked.push(issue("PLAN_COMPONENTS_REQUIRED", "Execution plan must contain resolved component identities."));
      } else {
        for (const key of requiredKeys) {
          const cid = id(components[key]);
          if (!cid) blocked.push(issue("PLAN_COMPONENT_REQUIRED", `Execution plan component '${key}' is required.`));
          else {
            const component = arr(configuration?.components).find((c) => id(c?.componentId) === cid);
            if (!component) blocked.push(issue("PLAN_COMPONENT_INVALID", `Execution plan component '${cid}' does not exist.`));
            else {
              const assignedGh = id(component?.assignment?.ghId);
              if (assignedGh && assignedGh !== ghId && assignedGh !== "") blocked.push(issue("PLAN_COMPONENT_GH_MISMATCH", `Execution plan component '${cid}' is not assigned to '${ghId}'.`));
              const rid = resourceIdForComponent(component);
              if (!rid) blocked.push(issue("PLAN_COMPONENT_RESOURCE_REQUIRED", `Execution plan component '${cid}' has no resource identity.`));
            }
          }
        }
        const dosingChannels = arr(plan.dosingChannels);
        if (dosingChannels.length === 0 || dosingChannels.length > 7) blocked.push(issue("PLAN_DOSING_CHANNEL_LIMIT", "Execution plan must contain 1..7 logical dosing channels."));
        const seenDosing = new Set();
        for (const channel of dosingChannels) {
          const cid = id(channel?.componentId);
          if (!cid || seenDosing.has(cid)) {
            blocked.push(issue("PLAN_DOSING_CHANNEL_INVALID", "Execution plan dosingChannels must contain unique valid component IDs."));
            continue;
          }
          seenDosing.add(cid);
          const component = arr(configuration?.components).find((c) => id(c?.componentId) === cid);
          if (!component) blocked.push(issue("PLAN_DOSING_COMPONENT_INVALID", `Execution plan dosing component '${cid}' does not exist.`));
        }
        const mode = id(plan.delivery?.mode).toUpperCase();
        if (!mode) blocked.push(issue("PLAN_DELIVERY_REQUIRED", "Execution plan delivery mode is required."));
        if (!plan.recipe || typeof plan.recipe !== "object" || !id(plan.recipe.recipeId) || !Number(plan.recipe.version || 0) || !plan.recipe.snapshot) blocked.push(issue("PLAN_RECIPE_SNAPSHOT_REQUIRED", "Execution plan must contain an immutable recipe snapshot."));
        if (!plan.sensorCalibrations || typeof plan.sensorCalibrations !== "object") blocked.push(issue("PLAN_SENSOR_CALIBRATIONS_REQUIRED", "Execution plan must contain exact sensor calibration references."));
        if (!plan.safety || plan.safety.safetyAcknowledged !== true) blocked.push(issue("PLAN_SAFETY_ACK_REQUIRED", "Execution plan safetyAcknowledged must be true."));
        const planResources = arr(plan.resources);
        if (planResources.length === 0) blocked.push(issue("PLAN_RESOURCES_REQUIRED", "Execution plan must contain resolved resource identities."));
        for (const r of planResources) {
          const rid = id(r?.resourceId);
          if (!rid) { blocked.push(issue("PLAN_RESOURCE_INVALID", "Execution plan resourceId is required.")); continue; }
          const active = arr(configuration?.resources).find((x) => id(x?.resourceId) === rid);
          if (!active) blocked.push(issue("PLAN_RESOURCE_INVALID", `Execution plan resource '${rid}' is not present in active configuration.`));
          const expected = id(r?.componentId);
          const actual = id(active?.componentId);
          if (expected && actual && expected !== actual) blocked.push(issue("PLAN_RESOURCE_COMPONENT_MISMATCH", `Execution plan resource '${rid}' changed component identity.`));
        }
        resolvedComponents.push(...requiredKeys.map((key) => {
          const cid = id(components[key]);
          return arr(configuration?.components).find((c) => id(c?.componentId) === cid);
        }).filter(Boolean));
        resolvedComponents.push(...dosingChannels.map((ch) => arr(configuration?.components).find((c) => id(c?.componentId) === id(ch?.componentId))).filter(Boolean));
        for (const resource of planResources) {
          const rid = id(resource?.resourceId);
          if (rid) resolvedResources.push(rid);
        }
        for (const component of resolvedComponents) {
          const rid = resourceIdForComponent(component);
          if (rid) resolvedResources.push(rid);
        }
        requirements.push("EXECUTION_PLAN", "MIXING_TANK", "DELIVERY_PUMP", "DOSING", "RAW_WATER_PATH");
      }
    }
  } else if (intent.action === "WATER_PUMP") {
    const pumps = findComponentByRole(configuration, null, ["WELL_PUMP", "WATER_PUMP", "RAW_SUBMERSIBLE"]);
    if (!pumps.length) blocked.push(issue("MISSING_WELL_PUMP", "No well/raw-water pump is installed."));
    for (const component of pumps.slice(0, 1)) {
      resolvedComponents.push(component);
      if (resourceIdForComponent(component)) resolvedResources.push(resourceIdForComponent(component));
    }
    requirements.push("WELL_PUMP");
  } else if (intent.action === "FAN_TOGGLE") {
    const fans = findComponentByRole(configuration, ghId, ["FAN", "BLOWER"]);
    if (!fans.length) blocked.push(issue("MISSING_FAN", `No fan resource is assigned to '${ghId}'.`, { ghId }));
    for (const component of fans) {
      resolvedComponents.push(component);
      if (resourceIdForComponent(component)) resolvedResources.push(resourceIdForComponent(component));
    }
    requirements.push("FAN");
  } else {
    blocked.push(issue("UNSUPPORTED_ACTION", `Action '${intent.action || "<empty>"}' is not supported by the compiler.`));
  }

  if (ghId) {
    const state = topologyState.greenhouses.find((g) => g.ghId === ghId);
    const capabilities = capabilityState.byGh[ghId];
    if (!state || !capabilities) {
      blocked.push(issue("TOPOLOGY_CONTEXT_UNAVAILABLE", `No topology/capability context exists for '${ghId}'.`, { ghId }));
    } else {
      if (intent.action === "FERTIGATION" && !capabilities.capabilities.CAN_AUTO_MIX) blocked.push(issue("CAPABILITY_AUTO_MIX_UNAVAILABLE", `GH '${ghId}' is not capable of automatic mixing.` , { ghId }));
      if (intent.action === "FERTIGATION" && !capabilities.capabilities.CAN_DELIVER) blocked.push(issue("CAPABILITY_DELIVERY_UNAVAILABLE", `GH '${ghId}' cannot automatically deliver.` , { ghId }));
      if (intent.parameters?.automaticDosing !== false && intent.action === "FERTIGATION" && !capabilities.capabilities.CAN_AUTO_DOSE) blocked.push(issue("CAPABILITY_AUTO_DOSE_UNAVAILABLE", `GH '${ghId}' cannot automatically dose.` , { ghId }));
      if (intent.action === "FERTIGATION" && (state.sharedPath || state.routingControlRequired) && !state.automaticallyRoutable && state.currentSharedManualTarget !== ghId) {
        blocked.push(issue("MANUAL_ROUTE_NOT_OWNED", `GH '${ghId}' does not have an executable independent route.`, { ghId, routeOwnerGhId: state.currentSharedManualTarget }));
      }
    }
  }

  const { resourceById } = buildResourceIndex(configuration);
  const uniqueComponents = [...new Map(resolvedComponents.map((c) => [id(c?.componentId), c])).values()].filter(Boolean);
  const uniqueResourceIds = [...new Set(resolvedResources.filter(Boolean))];
  for (const component of uniqueComponents) {
    const componentId = id(component?.componentId);
    const resourceId = resourceIdForComponent(component);
    if (!resourceId) {
      blocked.push(issue("COMPONENT_RESOURCE_REQUIRED", `Component '${componentId}' has no resourceId.`, { componentId }));
      continue;
    }
    const resource = resourceById.get(resourceId);
    if (!resource) {
      blocked.push(issue("RESOURCE_NOT_REGISTERED", `Resource '${resourceId}' for component '${componentId}' is not registered.`, { componentId, resourceId }));
      continue;
    }
    if (!resourceOperational(resource)) {
      blocked.push(issue("RESOURCE_NOT_OPERATIONAL", `Resource '${resourceId}' is not operational.`, { componentId, resourceId }));
    }
    if (ghId && id(component?.assignment?.ghId) === ghId && !resourceAssignedTo(resource, ghId)) {
      blocked.push(issue("RESOURCE_ASSIGNMENT_MISMATCH", `Resource '${resourceId}' is not assigned to '${ghId}'.`, { componentId, resourceId, ghId }));
    }
  }

  // Fertigation safety dependencies are explicit, with opt-out only when the policy/config permits a manual mode.
  if (intent.action === "FERTIGATION" && intent.parameters?.requireFlowSensor !== false) {
    const flow = findComponentByRole(configuration, ghId, ["FLOW_METER", "FLOW_SENSOR"]);
    if (!flow.length) blocked.push(issue("MISSING_FLOW_SENSOR", `No flow sensor is assigned to '${ghId}'.`, { ghId }));
  }
  if (intent.action === "FERTIGATION" && intent.parameters?.requireLevelSensor !== false) {
    const level = findComponentByRole(configuration, ghId, ["LEVEL_SENSOR", "LEVEL", "RADAR"]);
    if (!level.length) blocked.push(issue("MISSING_LEVEL_SENSOR", `No level sensor is assigned to '${ghId}'.`, { ghId }));
  }
  if (intent.action === "WATER_PUMP") {
    const flow = findComponentByRole(configuration, null, ["FLOW_METER", "FLOW_SENSOR"]);
    const level = findComponentByRole(configuration, null, ["LEVEL_SENSOR", "LEVEL", "RADAR", "FLOAT"]);
    if (!flow.length) blocked.push(issue("MISSING_FLOW_SENSOR", "Raw-water pump requires an operational flow sensor for safety."));
    if (!level.length) blocked.push(issue("MISSING_LEVEL_SENSOR", "Raw-water pump requires an operational level sensor for overfill protection."));
  }

  return {
    requirements,
    resolvedComponents: uniqueComponents,
    resourceIds: uniqueResourceIds,
    blocked,
  };
}

export function compileSchedule(configuration, rawIntent, options = {}) {
  const intent = normalizeScheduleIntent(rawIntent);
  const base = {
    scheduleId: intent.scheduleId,
    status: INVALID,
    activationState: intent.enabled ? ScheduleActivationState.VALIDATING : DISABLED,
    blockedReasons: [],
    errors: [],
    warnings: [],
    compiled: null,
  };

  base.errors.push(...validateScheduleSchema(intent));
  if (base.errors.length) return base;
  if (intent.activationState === ScheduleActivationState.DRAFT) {
    base.status = "DRAFT";
    base.activationState = ScheduleActivationState.DRAFT;
    return base;
  }
  if (!findComplex(configuration, intent.complexId)) {
    base.errors.push(issue("UNKNOWN_COMPLEX", `Target Complex '${intent.complexId}' does not exist.`, { complexId: intent.complexId }));
    return base;
  }
  if (!intent.enabled) {
    base.status = DISABLED;
    base.activationState = DISABLED;
    return base;
  }

  const targetGh = intent.ghId ? findGreenhouse(configuration, intent.ghId, intent.complexId) : null;
  if (intent.ghId && !targetGh) {
    base.errors.push(issue("UNKNOWN_GREENHOUSE", `Target GH '${intent.ghId}' does not belong to Complex '${intent.complexId}'.`, { ghId: intent.ghId, complexId: intent.complexId }));
    return base;
  }

  const recurrenceErrors = validateRecurrence(intent.trigger);
  base.errors.push(...recurrenceErrors);

  if (!Number.isInteger(intent.priority) || intent.priority < 0 || intent.priority > 1000) {
    base.errors.push(issue("INVALID_PRIORITY", "Priority must be an integer from 0 to 1000."));
  }
  if (intent.fallbackEnabled && !intent.fallbackScheduleId) {
    base.errors.push(issue("FALLBACK_SCHEDULE_REQUIRED", "fallbackScheduleId is required when fallbackEnabled is true."));
  }
  if (intent.fallbackScheduleId && intent.fallbackScheduleId === intent.scheduleId) {
    base.errors.push(issue("FALLBACK_SELF_REFERENCE", "A schedule cannot use itself as its fallback."));
  }
  if (!["EXECUTE", "SKIP"].includes(intent.missedRunPolicy)) {
    base.errors.push(issue("INVALID_MISSED_RUN_POLICY", "missedRunPolicy must be EXECUTE or SKIP."));
  }

  if (intent.action === "FERTIGATION") {
    if (intent.recipeId && !arr(configuration?.recipes).some((recipe) => id(recipe?.recipeId) === intent.recipeId)) {
      base.errors.push(issue("UNKNOWN_RECIPE", `Recipe '${intent.recipeId}' does not exist.`, { recipeId: intent.recipeId }));
    }
    const water = intent.parameters?.rawWaterVolumeMl;
    if (!positive(water)) base.errors.push(issue("INVALID_RAW_WATER_VOLUME", "FERTIGATION requires rawWaterVolumeMl > 0."));
    const duration = intent.parameters?.durationSec;
    if (duration != null && (!Number.isInteger(duration) || duration <= 0)) base.errors.push(issue("INVALID_DURATION", "durationSec must be a positive integer when supplied."));
    for (const [key, value] of Object.entries(intent.parameters || {})) {
      if (/^dosing.*ml$/i.test(key) && (!Number.isFinite(value) || value < 0)) {
        base.errors.push(issue("INVALID_DOSING_VOLUME", `${key} must be a non-negative number.`));
      }
    }
    if (intent.parameters?.targetMode === "ppm" && (!Number.isFinite(intent.parameters?.targetPpm) || intent.parameters.targetPpm <= 0)) {
      base.errors.push(issue("INVALID_TARGET_PPM", "targetPpm must be > 0 when targetMode is ppm."));
    }
  }
  if (intent.action === "WATER_PUMP") {
    const duration = intent.parameters?.durationSec;
    if (!Number.isInteger(duration) || duration <= 0) base.errors.push(issue("INVALID_DURATION", "WATER_PUMP requires a positive integer durationSec."));
  }
  if (intent.action === "FAN_TOGGLE") {
    const duration = intent.parameters?.durationSec;
    if (!Number.isInteger(duration) || duration <= 0) base.errors.push(issue("INVALID_DURATION", "FAN_TOGGLE requires a positive integer durationSec."));
    if (intent.parameters?.controlMode === "TEMPERATURE") {
      base.errors.push(issue("UNSUPPORTED_CONDITION_TRIGGER", "Temperature-controlled fan schedules require a condition scheduler and cannot be compiled as time schedules."));
    }
  }

  if (base.errors.length) return base;

  const topologyState = buildTopologyView(configuration, intent.ghId || undefined);
  const topologyValidation = validateTopology(configuration);
  const capabilityState = calculateCapabilities(configuration);
  const assignmentValidation = validateResourceAssignments(configuration);
  const dependencies = buildDependencyList(configuration, intent, topologyState, capabilityState);
  base.blockedReasons.push(...topologyValidation.issues.filter((e) => e.code.includes("CONFLICT")));
  base.blockedReasons.push(...dependencies.blocked);
  base.blockedReasons.push(...(assignmentValidation.issues || []).filter((e) => e.code.includes("RESOURCE") || e.code.includes("ASSIGNMENT")));

  const resourceIds = dependencies.resourceIds;
  const activeLocks = options.activeLocks ?? [];
  const resourceConflicts = checkResourceConflicts(resourceIds, activeLocks, intent.ownerId || intent.scheduleId, configuration);
  if (resourceConflicts.length) {
    for (const conflict of resourceConflicts) {
      base.blockedReasons.push(issue("RESOURCE_LOCK_CONFLICT", `Resource '${conflict.resourceId}' is locked by '${conflict.lockedBy}'.`, conflict));
    }
  }

  if (base.blockedReasons.length) {
    base.status = BLOCKED;
    base.activationState = BLOCKED;
    return base;
  }

  const now = Number.isFinite(options.nowTimestamp) ? options.nowTimestamp : Date.now();
  const durationSec = Number(intent.parameters?.durationSec || 60);
  let requestedStartTimestamp = now;
  if (intent.trigger.type === "ONCE" && intent.trigger.timestamp) {
    const parsed = new Date(intent.trigger.timestamp).getTime();
    if (Number.isFinite(parsed)) requestedStartTimestamp = parsed;
  } else if (intent.validity?.startsAt) {
    const parsed = new Date(intent.validity.startsAt).getTime();
    if (Number.isFinite(parsed)) requestedStartTimestamp = parsed;
  }
  const startTimestamp = requestedStartTimestamp;
  const endTimestamp = startTimestamp + durationSec * 1000;
  const recipe = intent.recipeId ? arr(configuration?.recipes).find((r) => id(r?.recipeId) === intent.recipeId) : null;
  const configurationVersion = Number(configuration?.version || 0);

  const compiled = {
    compiledId: options.compiledId || `${intent.scheduleId}:v${configurationVersion}:${startTimestamp}`,
    scheduleId: intent.scheduleId,
    status: EXECUTABLE,
    activationState: ScheduleActivationState.ACTIVE,
    complexId: intent.complexId,
    ghId: intent.ghId,
    action: intent.action,
    ownerId: intent.ownerId || intent.scheduleId,
    priority: intent.priority,
    startTimestamp,
    endTimestamp,
    trigger: structuredClone(intent.trigger),
    resourceIds,
    resourceLocks: resourceIds.map((resourceId) => ({
      resourceId,
      lockType: configuration?.resources?.find((resource) => id(resource?.resourceId || resource?.id) === resourceId)?.shared === true ? "SHARED" : "EXCLUSIVE",
    })),
    componentIds: dependencies.resolvedComponents.map((component) => id(component?.componentId)).filter(Boolean),
    dependencies: {
      requirements: dependencies.requirements,
      topology: topologyState.greenhouses.find((g) => g.ghId === intent.ghId) || null,
      capabilities: intent.ghId ? capabilityState.byGh[intent.ghId] : null,
    },
    safety: {
      emergencyStopRequiredClear: true,
      sensorValidationRequired: intent.action === "FERTIGATION",
      maxRuntimeSec: durationSec,
    },
    recurrence: {
      type: intent.trigger.type,
      hour: intent.trigger.hour,
      minute: intent.trigger.minute,
      daysOfWeek: intent.trigger.daysOfWeek,
      intervalMin: intent.trigger.intervalMin,
      timestamp: intent.trigger.timestamp,
    },
    missedRunPolicy: intent.missedRunPolicy,
    fallback: { enabled: intent.fallbackEnabled, scheduleId: intent.fallbackScheduleId },
    timezone: intent.timezone,
    validity: structuredClone(intent.validity),
    compiledAtTimestamp: now,
    recipeSnapshot: recipe ? structuredClone(recipe) : null,
    configurationVersion,
    configurationHash: id(options.configurationHash) || null,
    parameters: structuredClone(intent.parameters),
  };

  base.status = EXECUTABLE;
  base.activationState = EXECUTABLE;
  base.compiled = compiled;
  return base;
}

export function compileScheduleSet(configuration, schedules, options = {}) {
  const intents = arr(schedules).map(normalizeScheduleIntent);
  const ids = new Set(intents.map((intent) => intent.scheduleId).filter(Boolean));
  const results = intents.map((intent) => {
    const result = compileSchedule(configuration, intent, options);
    if (result.status === EXECUTABLE && intent.fallbackEnabled && intent.fallbackScheduleId && !ids.has(intent.fallbackScheduleId)) {
      return {
        ...result,
        status: BLOCKED,
        activationState: BLOCKED,
        compiled: null,
        blockedReasons: [...(result.blockedReasons || []), issue("MISSING_FALLBACK_SCHEDULE", `Fallback schedule '${intent.fallbackScheduleId}' is not present in this schedule set.`, { fallbackScheduleId: intent.fallbackScheduleId })],
      };
    }
    if (result.status === EXECUTABLE && intent.fallbackEnabled && intent.fallbackScheduleId) {
      result.compiled.fallback = { enabled: true, scheduleId: intent.fallbackScheduleId };
    }
    return result;
  });
  const active = results.filter((r) => r.status === EXECUTABLE).map((r) => r.compiled);
  const blocked = results.filter((r) => r.status === BLOCKED);
  const invalid = results.filter((r) => r.status === INVALID);
  return {
    configurationVersion: Number(configuration?.version || 0),
    valid: invalid.length === 0,
    results,
    compiled: active,
    blocked,
    invalid,
  };
}

export function canDeployCompiledSchedule(schedule) {
  return Boolean(
    schedule &&
    schedule.status === EXECUTABLE &&
    schedule.activationState === ScheduleActivationState.ACTIVE &&
    schedule.action &&
    schedule.complexId &&
    Array.isArray(schedule.resourceIds) &&
    Array.isArray(schedule.componentIds) &&
    schedule.configurationVersion >= 1
  );
}
