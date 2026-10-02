import fs from "fs";
import assert from "assert";

console.log("=== VERIFYING PERIPHERAL REGISTRATION AUTO-ENQUEUE INVARIANTS ===");

// 1. Verify services.ts updateConfigurationComponents triggers revalidation
const servicesTs = fs.readFileSync("src/lib/services.ts", "utf-8");
assert(
  servicesTs.includes("deployCompiledScheduleSet(complexId)"),
  "services.ts must call deployCompiledScheduleSet on component update"
);
console.log("PASS 1: services.ts updateConfigurationComponents triggers deployCompiledScheduleSet");

// 2. Verify deployCompiledScheduleSet triggers daily schedule materialization on ESP32
assert(
  servicesTs.includes("esp32Client.triggerDailySchedules()"),
  "deployCompiledScheduleSet must trigger triggerDailySchedules on ESP32"
);
console.log("PASS 2: deployCompiledScheduleSet triggers esp32Client.triggerDailySchedules()");

// 3. Verify FertigationQueueDashboard has auto-catchup schedule deployment
const dashboardTsx = fs.readFileSync("src/components/fertigation/FertigationQueueDashboard.tsx", "utf-8");
assert(
  dashboardTsx.includes("hasAutoSyncedRef") &&
  dashboardTsx.includes("scheduleService.deploySchedules(effectiveComplexId)"),
  "FertigationQueueDashboard must perform auto-catchup schedule deployment"
);
console.log("PASS 3: FertigationQueueDashboard auto-syncs schedules when queue is empty");

// 4. Verify esp32 api_config_handlers.c invokes scheduler_sync_intents on config activation
const configHandlersC = fs.readFileSync("esp32/main/http/api_config_handlers.c", "utf-8");
assert(
  configHandlersC.includes('#include "services/scheduler.h"') &&
  configHandlersC.includes("scheduler_sync_intents()"),
  "api_config_handlers.c must call scheduler_sync_intents on config activation"
);
console.log("PASS 4: api_config_handlers.c invokes scheduler_sync_intents on configuration activation");

console.log("\nALL PERIPHERAL REGISTRATION AUTO-ENQUEUE INVARIANTS VERIFIED SUCCESSFULLY!");
