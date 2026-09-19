/* M17 NOTICE: GPIO values in this fixture are synthetic logical-test data only.
 * They are NOT a physical wiring map and must never be used as commissioning evidence.
 * Physical GPIO authority is docs/HARDWARE_WIRING_MAP.md. */
export function createAutomaticMultiGhConfiguration() {
  const components = [
    c("well-pump-01", "pump-12v-dc", "Well Pump", "WELL_PUMP", "COMPLEX", "res-well", 4),
    c("dose-a", "pump-12v-dc", "Dosing A", "DOSING_A", "COMPLEX", "res-dose-a", 5),
    c("dose-b", "pump-12v-dc", "Dosing B", "DOSING_B", "COMPLEX", "res-dose-b", 6),
    c("raw-flow", "flow-meter-fs400a", "Raw Water Flow", "FLOW_METER", "COMPLEX", "res-raw-flow", 7),
    c("raw-level", "level-sensor", "Raw Tank Level", "LEVEL_SENSOR", "COMPLEX", "res-raw-level", 8),
    c("mix-01", "mixing-tank", "GH01 Mixing Tank", "MIXING_TANK", "GH", "res-mix-01", 20, "GH-01"),
    c("dist-01", "pump-12v-dc", "GH01 Delivery Pump", "DISTRIBUTION_PUMP", "GH", "res-dist-01", 21, "GH-01"),
    c("mix-02", "mixing-tank", "GH02 Mixing Tank", "MIXING_TANK", "GH", "res-mix-02", 22, "GH-02"),
    c("dist-02", "pump-12v-dc", "GH02 Delivery Pump", "DISTRIBUTION_PUMP", "GH", "res-dist-02", 23, "GH-02"),
    c("route-v1", "solenoid-valve-12v", "GH01 Route Valve", "ROUTING_VALVE", "COMPLEX", "res-route-01", 30),
    c("route-v2", "solenoid-valve-12v", "GH02 Route Valve", "ROUTING_VALVE", "COMPLEX", "res-route-02", 31),
    c("flow-01", "flow-meter-fs400a", "Flow GH01", "FLOW_METER", "GH", "res-flow-01", 34, "GH-01"),
    c("flow-02", "flow-meter-fs400a", "Flow GH02", "FLOW_METER", "GH", "res-flow-02", 35, "GH-02"),
    c("level-01", "level-sensor", "Level GH01", "LEVEL_SENSOR", "GH", "res-level-01", 36, "GH-01"),
    c("level-02", "level-sensor", "Level GH02", "LEVEL_SENSOR", "GH", "res-level-02", 37, "GH-02"),
    c("fan-01", "fan", "GH01 Fan", "FAN", "GH", "res-fan-01", 40, "GH-01"),
  ];
  const resources = components.map((x) => ({
    resourceId: x.resourceId,
    type: x.role,
    componentId: x.componentId,
    shared: x.assignment.ghId == null,
    available: true,
  }));
  const assignments = components.map((x, i) => ({
    assignmentId: `a-${i + 1}`,
    resourceId: x.resourceId,
    scope: x.assignment.ghId ? "GH" : "COMPLEX",
    ghId: x.assignment.ghId ?? null,
  }));
  return {
    complexId: "complex-A",
    version: 17,
    updatedAt: "2026-09-18T10:00:00Z",
    complexes: [{ complexId: "complex-A", name: "Complex A" }],
    greenhouses: [
      { ghId: "GH-01", complexId: "complex-A", name: "Greenhouse 01" },
      { ghId: "GH-02", complexId: "complex-A", name: "Greenhouse 02" },
    ],
    components,
    resources,
    assignments,
    topology: [
      path("raw-gh01", "res-well", "res-mix-01", "AUTOMATIC", false, "res-route-01", "GH-01"),
      path("raw-gh02", "res-well", "res-mix-02", "AUTOMATIC", false, "res-route-02", "GH-02"),
      path("mix-gh01", "res-mix-01", "res-dist-01", "AUTOMATIC", false, "res-route-01", "GH-01"),
      path("mix-gh02", "res-mix-02", "res-dist-02", "AUTOMATIC", false, "res-route-02", "GH-02"),
    ],
    recipes: [
      { recipeId: "recipe-01", name: "Melon Base", type: "FERTIGATION", ratioA: 1, ratioB: 1 },
    ],
  };
}

export function createManualSharedConfiguration() {
  const config = createAutomaticMultiGhConfiguration();
  config.topology = [
    path("shared-manual", "res-well", "res-mix-01", "MANUAL", true, null, "GH-01"),
    path("shared-manual-2", "res-well", "res-mix-02", "MANUAL", true, null, "GH-01"),
    path("mix-gh01", "res-mix-01", "res-dist-01", "AUTOMATIC", false, null, "GH-01"),
    path("mix-gh02", "res-mix-02", "res-dist-02", "AUTOMATIC", false, null, "GH-02"),
  ];
  config.manualRouteOwnerGhId = "GH-01";
  return config;
}

function c(componentId, supportedTypeId, name, role, scope, resourceId, gpio, ghId = null) {
  return {
    componentId,
    supportedTypeId,
    name,
    role,
    resourceId,
    lifecycleState: "COMMISSIONED",
    deploymentStatus: "APPLIED",
    assignment: { complexId: "complex-A", ghId },
    wiring: { interface: "GPIO", gpio },
    parameters: {},
  };
}

function path(pathId, sourceResourceId, targetResourceId, mode, shared, valveResourceId, targetGhId) {
  return {
    pathId,
    sourceResourceId,
    targetResourceId,
    connectionType: "HYDRAULIC",
    mode,
    shared,
    enabled: true,
    valveResourceId,
    targetGhId,
  };
}
