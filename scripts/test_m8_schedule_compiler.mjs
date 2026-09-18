import { ScheduleCompiler } from '../src/lib/services/ScheduleCompiler.ts';

// Minimal polyfill for local test
console.log("== Starting M8 Schedule Compiler Suite ==");

const mockConfig = {
    complexId: "COMPLEX-01",
    version: 105,
    updatedAt: new Date().toISOString(),
    greenhouses: [
        { ghId: "GH-01", name: "Greenhouse 1" },
        { ghId: "GH-02", name: "Greenhouse 2" },
        { ghId: "GH-03", name: "Greenhouse 3" }
    ],
    components: [],
    assignments: [
        { assignmentId: "A1", resourceId: "PUMP-01", scope: "COMPLEX", ghId: null },
        { assignmentId: "A2", resourceId: "VALVE-01", scope: "GH", ghId: "GH-02" }
    ],
    schedules: [],
    compiledSchedules: [],
    recipes: [
        { recipeId: "RECIPE-1", name: "Veg", type: "FERTIGATION" }
    ],
    topology: [],
    settings: {}
};

const mockTopology = {
    greenhouses: [
        {
            ghId: "GH-01",
            configured: true,
            hydraulicallyReachable: true,
            automaticallyRoutable: true,
            manuallyRoutable: true,
            currentSharedTarget: null,
            capabilities: { CAN_DELIVER: true, CAN_AUTO_ROUTE: true, CAN_MONITOR_FLOW: true, CAN_MONITOR_LEVEL: true, CAN_MONITOR_EC: false, CAN_MONITOR_PH: false, CAN_CLIMATE_CONTROL: true, CAN_RUN_AUTONOMOUSLY: true }
        },
        {
            ghId: "GH-02",
            configured: true,
            hydraulicallyReachable: true,
            automaticallyRoutable: false,
            manuallyRoutable: true,
            currentSharedTarget: "GH-01", // manual route pointing elsewhere
            blockingReason: null,
            capabilities: { CAN_DELIVER: true, CAN_AUTO_ROUTE: false, CAN_MONITOR_FLOW: true, CAN_MONITOR_LEVEL: true, CAN_MONITOR_EC: false, CAN_MONITOR_PH: false, CAN_CLIMATE_CONTROL: false, CAN_RUN_AUTONOMOUSLY: false }
        },
        {
            ghId: "GH-03",
            configured: false,
            hydraulicallyReachable: false,
            automaticallyRoutable: false,
            manuallyRoutable: false,
            currentSharedTarget: null,
            capabilities: { CAN_DELIVER: false, CAN_AUTO_ROUTE: false, CAN_MONITOR_FLOW: false, CAN_MONITOR_LEVEL: false, CAN_MONITOR_EC: false, CAN_MONITOR_PH: false, CAN_CLIMATE_CONTROL: false, CAN_RUN_AUTONOMOUSLY: false }
        }
    ]
};

const mockInventory = { components: [] };

function runTest(name, intent, expectedStatus, expectedReasonCode = null) {
    console.log(`\nTest: ${name}`);
    const compiled = ScheduleCompiler.compile(intent, mockConfig, mockInventory, mockTopology);
    
    if (compiled.status !== expectedStatus) {
        console.error(`❌ FAILED: Expected status ${expectedStatus}, got ${compiled.status}`);
        if (compiled.blockedReason) console.error("Blocked Reason:", compiled.blockedReason);
        process.exit(1);
    }
    
    if (expectedReasonCode) {
        if (compiled.blockedReason?.code !== expectedReasonCode) {
            console.error(`❌ FAILED: Expected reason ${expectedReasonCode}, got ${compiled.blockedReason?.code}`);
            process.exit(1);
        }
    }
    
    console.log(`✅ PASS: ${compiled.status} ${compiled.blockedReason ? `(${compiled.blockedReason.code})` : ''}`);
    return compiled;
}

// Target Tests
runTest("Target: Missing GH Configuration (Unknown GH-99)", {
    scheduleId: "SCHED-TARGET",
    targetGhId: "GH-99",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    triggerType: "DAILY"
}, "BLOCKED", "INVALID_GH");

// Topology Tests
runTest("Topology: Valid FERTIGATION on GH-01 (Auto Routable)", {
    scheduleId: "SCHED-1",
    targetGhId: "GH-01",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    recipeId: "RECIPE-1",
    triggerType: "DAILY"
}, "COMPILED");

runTest("Topology: Not Configured in Topology (GH-03)", {
    scheduleId: "SCHED-3",
    targetGhId: "GH-03",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    triggerType: "DAILY"
}, "BLOCKED", "NOT_CONFIGURED");

runTest("Topology: Manual Routing Block (GH-02, no auto route, not manually selected)", {
    scheduleId: "SCHED-4",
    targetGhId: "GH-02",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    recipeId: "RECIPE-1",
    triggerType: "DAILY"
}, "BLOCKED", "ROUTING_UNAVAILABLE");

// Action/Recipe Tests
runTest("Recipe: Missing Recipe", {
    scheduleId: "SCHED-5",
    targetGhId: "GH-01",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    recipeId: "RECIPE-INVALID",
    triggerType: "DAILY"
}, "BLOCKED", "RECIPE_MISSING");

// Recurrence Tests
runTest("Recurrence: Invalid Recurrence (Interval without minutes)", {
    scheduleId: "SCHED-6",
    targetGhId: "GH-01",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    recipeId: "RECIPE-1",
    triggerType: "INTERVAL",
    intervalMin: 0
}, "BLOCKED", "INVALID_RECURRENCE");

runTest("State: Draft/Disabled Schedules", {
    scheduleId: "SCHED-DISABLED",
    targetGhId: "GH-01",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: false,
    recipeId: "RECIPE-1",
    triggerType: "DAILY"
}, "DISABLED");

// Output Verification
const compiledOutput = runTest("Output: Inspect Compiled Artifact", {
    scheduleId: "SCHED-ARTIFACT",
    targetGhId: "GH-01",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    recipeId: "RECIPE-1",
    triggerType: "DAILY"
}, "COMPILED");

if (!compiledOutput.resolvedResources.includes("PUMP-01")) {
    console.error("❌ FAILED: Compiled artifact missing COMPLEX scope resource PUMP-01");
    process.exit(1);
}
if (!compiledOutput.safetyDependencies.includes("FLOW_VALID")) {
    console.error("❌ FAILED: Compiled artifact missing safety dependency FLOW_VALID");
    process.exit(1);
}
if (compiledOutput.configurationVersion !== 105) {
    console.error("❌ FAILED: Compiled artifact did not capture configuration version");
    process.exit(1);
}

// Multi-GH independence
console.log("\nTest: Multi-GH Topology Change Independence");
mockTopology.greenhouses[1].currentSharedTarget = "GH-02"; // Switch route to GH-02

const gh1AfterChange = ScheduleCompiler.compile({
    scheduleId: "SCHED-1",
    targetGhId: "GH-01",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    recipeId: "RECIPE-1",
    triggerType: "DAILY"
}, mockConfig, mockInventory, mockTopology);
if (gh1AfterChange.status !== "COMPILED") {
    console.error("❌ FAILED: GH-01 schedule was affected by GH-02 manual route switch, despite GH-01 having auto route.");
    process.exit(1);
}

const gh2AfterChange = ScheduleCompiler.compile({
    scheduleId: "SCHED-4",
    targetGhId: "GH-02",
    action: "FERTIGATION_START",
    priority: 10,
    missedRunPolicy: "SKIP",
    enabled: true,
    recipeId: "RECIPE-1",
    triggerType: "DAILY"
}, mockConfig, mockInventory, mockTopology);
if (gh2AfterChange.status !== "COMPILED") {
    console.error(`❌ FAILED: GH-02 schedule should now be COMPILED, got ${gh2AfterChange.status}`);
    process.exit(1);
}
console.log(`✅ PASS: Multi-GH independence confirmed`);

console.log("\n== All M8 Compiler tests passed! ==");
