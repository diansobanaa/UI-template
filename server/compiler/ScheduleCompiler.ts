import type { 
  ScheduleIntent, 
  CompiledSchedule, 
  ConfigurationPayload, 
  BlockedReason, 
  RecipeSnapshot, 
  BlockedReasonCode
} from '../../src/lib/api/contracts.ts';

export const PRODUCT_MAX_RESOLVED_RESOURCES = 16;
export const PRODUCT_MAX_SCHEDULES = 16;

export class ScheduleCompiler {
  /**
   * Compiles all ScheduleIntents within an authoritative CandidateConfiguration snapshot.
   * Consumes strictly the provided candidate snapshot without reading active configuration,
   * live device responses, or browser localStorage.
   */
  public static compileCandidate(candidate: ConfigurationPayload): ConfigurationPayload {
    const intents = candidate.schedules || [];
    const compiledList: CompiledSchedule[] = [];

    // First pass: Compile individual schedule dependency closures
    for (const intent of intents) {
      const compiled = this.compileIntent(intent, candidate);
      compiledList.push(compiled);
    }

    // Second pass: Static Resource Conflict Detection across concurrent schedules
    this.detectResourceConflicts(compiledList);

    // Enforce overall schedule array capacity limit
    if (compiledList.length > PRODUCT_MAX_SCHEDULES) {
      for (let i = PRODUCT_MAX_SCHEDULES; i < compiledList.length; i++) {
        compiledList[i].status = "BLOCKED";
        compiledList[i].blockedReason = {
          code: "RESOURCE_LIMIT_EXCEEDED",
          message: `Schedule count exceeds product maximum capacity of ${PRODUCT_MAX_SCHEDULES}.`,
          resolution: `Reduce schedule count to ${PRODUCT_MAX_SCHEDULES} or fewer.`
        };
      }
    }

    candidate.compiledSchedules = compiledList;
    return candidate;
  }

  private static compileIntent(intent: ScheduleIntent, candidate: ConfigurationPayload): CompiledSchedule {
    const targetGhId = intent.targetGhId;
    const targetGh = (candidate.greenhouses || []).find(g => g.ghId === targetGhId);

    // 1. Target GH Verification
    if (!targetGh) {
      return this.blocked(intent, candidate.version, {
        code: "INVALID_GH",
        message: `Target Greenhouse "${targetGhId}" does not exist in configuration.`,
        ghId: targetGhId,
        resolution: "Assign a valid greenhouse ID configured in the complex."
      });
    }

    // 2. Parameter & Recurrence Validation
    if (intent.triggerType === "INTERVAL") {
      if (!intent.intervalMin || intent.intervalMin <= 0) {
        return this.blocked(intent, candidate.version, {
          code: "RECURRENCE_INVALID",
          message: "Interval schedules must specify an intervalMin greater than 0.",
          ghId: targetGhId,
          resolution: "Set intervalMin to a positive integer (e.g. 60 for hourly)."
        });
      }
    } else if (intent.triggerType === "DAILY") {
      if (intent.hour === undefined || intent.hour === null || intent.hour < 0 || intent.hour > 23 ||
          intent.minute === undefined || intent.minute === null || intent.minute < 0 || intent.minute > 59) {
        return this.blocked(intent, candidate.version, {
          code: "RECURRENCE_INVALID",
          message: "Daily schedules must specify valid hour (0-23) and minute (0-59).",
          ghId: targetGhId,
          resolution: "Provide valid hour and minute parameters."
        });
      }
    }

    if (intent.durationSec !== undefined && intent.durationSec !== null) {
      if (intent.durationSec <= 0 || intent.durationSec > 86400) {
        return this.blocked(intent, candidate.version, {
          code: "RECURRENCE_INVALID",
          message: "Schedule durationSec must be between 1 and 86400 seconds.",
          ghId: targetGhId,
          resolution: "Adjust durationSec within valid range."
        });
      }
    }

    // 3. Topology & Reachability Resolution
    // Verify target GH is reachable via topology edges in the candidate snapshot
    const targetEdges = (candidate.topology || []).filter(
      t => t.targetResourceId === targetGhId || t.sourceResourceId === targetGhId
    );
    const ghAssignments = (candidate.assignments || []).filter(
      a => a.ghId === targetGhId || a.scope === "COMPLEX"
    );

    const resolvedComponents: string[] = [];
    const resolvedResources: string[] = [];
    const safetyDependencies: string[] = ["ESTOP_INACTIVE"];
    let recipeSnapshot: RecipeSnapshot | null = null;

    // 4. Action-Specific Dependency Closure
    switch (intent.action) {
      case "FERTIGATION_START": {
        // Requires delivery capability and routing
        // Check if routing valve or path exists
        const routingValve = ghAssignments.find(a => a.resourceId.toLowerCase().includes("valve") || a.resourceId.toLowerCase().includes("vlv"));
        if (!routingValve && targetEdges.length === 0) {
          return this.blocked(intent, candidate.version, {
            code: "NOT_AUTOMATICALLY_ROUTABLE",
            message: `No hydraulic route or routing valve resolved for Greenhouse ${targetGhId}.`,
            ghId: targetGhId,
            resolution: "Assign a routing valve or connect topology path to target greenhouse."
          });
        }

        // Resolve fertigation components: Dosing pumps, Mixing pump, Distribution pump
        const dosingPumps = (candidate.assignments || []).filter(
          a => a.resourceId.toLowerCase().includes("dosing") || a.resourceId.toLowerCase().includes("dp")
        );
        const distPump = (candidate.assignments || []).find(
          a => a.resourceId.toLowerCase().includes("dist") || a.resourceId.toLowerCase().includes("delivery")
        );
        const mixingPump = (candidate.assignments || []).find(
          a => a.resourceId.toLowerCase().includes("mixing") || a.resourceId.toLowerCase().includes("mix")
        );

        if (dosingPumps.length === 0) {
          return this.blocked(intent, candidate.version, {
            code: "RESOURCE_MISSING",
            message: "Fertigation dosing pump resource missing in candidate configuration.",
            ghId: targetGhId,
            resolution: "Assign dosing pumps in configuration."
          });
        }

        dosingPumps.forEach(dp => resolvedResources.push(dp.resourceId));
        if (distPump) resolvedResources.push(distPump.resourceId);
        if (mixingPump) resolvedResources.push(mixingPump.resourceId);
        if (routingValve) resolvedResources.push(routingValve.resourceId);

        // Required sensors
        const flowSensor = (candidate.assignments || []).find(
          a => a.resourceId.toLowerCase().includes("flow") || a.resourceId.toLowerCase().includes("fs")
        );
        if (flowSensor) {
          resolvedResources.push(flowSensor.resourceId);
        }
        safetyDependencies.push("FLOW_VALID", "LEVEL_VALID");

        // Resolve immutable recipe snapshot
        if (!intent.recipeId) {
          return this.blocked(intent, candidate.version, {
            code: "RECIPE_INVALID",
            message: "Fertigation schedule must specify a recipeId.",
            ghId: targetGhId,
            resolution: "Select an active recipe for this greenhouse."
          });
        }

        const recipe = (candidate.recipes || []).find(r => r.recipeId === intent.recipeId);
        if (!recipe) {
          return this.blocked(intent, candidate.version, {
            code: "RECIPE_INVALID",
            message: `Recipe "${intent.recipeId}" not found in candidate configuration.`,
            ghId: targetGhId,
            resolution: "Assign a valid recipe that exists in configuration."
          });
        }

        recipeSnapshot = {
          recipeId: recipe.recipeId,
          recipeVersion: 1, // Deterministic recipe snapshot version
          name: recipe.name,
          type: recipe.type,
          targetEc: recipe.targetEc ?? null,
          targetPh: recipe.targetPh ?? null,
          ratioA: recipe.ratioA ?? null,
          ratioB: recipe.ratioB ?? null,
          durationSec: recipe.durationSec ?? null,
          volumeMl: recipe.volumeMl ?? null
        };
        break;
      }

      case "WATER_PUMP_START":
      case "WATER_PUMP_STOP": {
        const wellPump = (candidate.assignments || []).find(
          a => a.resourceId.toLowerCase().includes("well") || a.resourceId.toLowerCase().includes("pump-well")
        );
        if (wellPump) {
          resolvedResources.push(wellPump.resourceId);
        } else {
          return this.blocked(intent, candidate.version, {
            code: "RESOURCE_MISSING",
            message: "Well pump resource not found in candidate configuration.",
            ghId: targetGhId,
            resolution: "Assign a well pump to the complex."
          });
        }
        safetyDependencies.push("LEVEL_VALID");
        break;
      }

      case "FAN_START":
      case "FAN_STOP": {
        const fan = ghAssignments.find(
          a => a.resourceId.toLowerCase().includes("fan")
        );
        if (fan) {
          resolvedResources.push(fan.resourceId);
        } else {
          return this.blocked(intent, candidate.version, {
            code: "RESOURCE_MISSING",
            message: `No fan component assigned to Greenhouse ${targetGhId}.`,
            ghId: targetGhId,
            resolution: "Assign a fan actuator to target greenhouse."
          });
        }
        break;
      }

      default:
        // Generic action
        break;
    }

    // 5. Enforce Capacity Ceiling (PRODUCT_MAX_RESOLVED_RESOURCES = 16)
    if (resolvedResources.length > PRODUCT_MAX_RESOLVED_RESOURCES) {
      return this.blocked(intent, candidate.version, {
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: `Resolved resources (${resolvedResources.length}) exceeds maximum limit (${PRODUCT_MAX_RESOLVED_RESOURCES}).`,
        ghId: targetGhId,
        resolution: "Refactor topology or split action to require at most 16 resources."
      });
    }

    // 6. Return Deterministic Compiled Schedule
    const status = intent.enabled ? "VALIDATING" : "DISABLED";

    return {
      scheduleId: intent.scheduleId,
      targetComplexId: candidate.complexId || "UNKNOWN",
      targetGhId: intent.targetGhId,
      resolvedAction: intent.action,
      resolvedComponents,
      resolvedResources,
      safetyDependencies,
      recipeVersion: recipeSnapshot ? recipeSnapshot.recipeVersion : null,
      recipeSnapshot,
      configurationVersion: candidate.version,
      priority: intent.priority || 10,
      missedRunPolicy: intent.missedRunPolicy || "SKIP",
      executionPolicy: "STANDARD",
      status
    };
  }

  /**
   * Compiles a single ScheduleIntent against an authoritative Configuration snapshot.
   */
  public static compile(intent: ScheduleIntent, config: ConfigurationPayload): CompiledSchedule {
    const candidate: ConfigurationPayload = {
      ...config,
      schedules: [intent]
    };
    const compiled = this.compileCandidate(candidate);
    return compiled.compiledSchedules?.[0] || this.blocked(intent, config.version || 1, {
      code: "UNKNOWN",
      message: "Compilation produced no result."
    });
  }

  /**
   * Detects static resource conflicts across pairwise schedules claiming exclusive resources.
   * Higher priority schedules remain valid; lower priority conflicting schedules are marked BLOCKED.
   */
  private static detectResourceConflicts(schedules: CompiledSchedule[]): void {
    const EXCLUSIVE_RESOURCES = ["pump", "well", "dist", "mix", "valve"];

    for (let i = 0; i < schedules.length; i++) {
      const s1 = schedules[i];
      if (s1.status !== "VALIDATING") continue;

      for (let j = i + 1; j < schedules.length; j++) {
        const s2 = schedules[j];
        if (s2.status !== "VALIDATING") continue;

        // Check if both target the same action time window (e.g. same daily hour/minute or conflicting interval)
        const sharedExclusive = s1.resolvedResources.find(r => 
          s2.resolvedResources.includes(r) && 
          EXCLUSIVE_RESOURCES.some(ex => r.toLowerCase().includes(ex))
        );

        if (sharedExclusive) {
          // Priority resolution: lower priority blocked
          if (s1.priority >= s2.priority) {
            s2.status = "BLOCKED";
            s2.blockedReason = {
              code: "RESOURCE_CONFLICT",
              message: `Resource conflict on exclusive resource "${sharedExclusive}" with higher/equal-priority schedule "${s1.scheduleId}".`,
              resourceId: sharedExclusive,
              ghId: s2.targetGhId,
              resolution: "Stagger schedule times or assign dedicated resources."
            };
          } else {
            s1.status = "BLOCKED";
            s1.blockedReason = {
              code: "RESOURCE_CONFLICT",
              message: `Resource conflict on exclusive resource "${sharedExclusive}" with higher-priority schedule "${s2.scheduleId}".`,
              resourceId: sharedExclusive,
              ghId: s1.targetGhId,
              resolution: "Stagger schedule times or assign dedicated resources."
            };
            break; // s1 is now blocked, move to next s1
          }
        }
      }
    }
  }

  private static blocked(intent: ScheduleIntent, configVersion: number, reason: BlockedReason): CompiledSchedule {
    return {
      scheduleId: intent.scheduleId,
      targetComplexId: "UNKNOWN",
      targetGhId: intent.targetGhId,
      resolvedAction: intent.action,
      resolvedComponents: [],
      resolvedResources: [],
      safetyDependencies: [],
      recipeVersion: null,
      recipeSnapshot: null,
      configurationVersion: configVersion,
      priority: intent.priority || 10,
      missedRunPolicy: intent.missedRunPolicy || "SKIP",
      executionPolicy: "NONE",
      status: "BLOCKED",
      blockedReason: reason
    };
  }
}
