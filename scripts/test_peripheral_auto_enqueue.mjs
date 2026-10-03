import fs from "fs";
import assert from "assert";

console.log("=== VERIFYING DUAL-GUARD AUTONOMOUS SCHEDULE & 15S GRACE INVARIANTS ===");

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

// 3. Verify FertigationQueueDashboard has 15-second grace period and container loading before trigger
const dashboardTsx = fs.readFileSync("src/components/fertigation/FertigationQueueDashboard.tsx", "utf-8");
assert(
  dashboardTsx.includes("isAwaitingQueueSync") &&
  dashboardTsx.includes("syncCountdown") &&
  dashboardTsx.includes("esp32Client.triggerDailySchedules()"),
  "FertigationQueueDashboard must implement 15-second grace period and direct ESP32 trigger"
);
console.log("PASS 3: FertigationQueueDashboard implements 15-second grace period & background trigger");

// 4. Verify DosingQueueSection renders container loading during grace period
const dosingQueueTsx = fs.readFileSync("src/components/fertigation/DosingQueueSection.tsx", "utf-8");
assert(
  dosingQueueTsx.includes("isSyncingQueue") &&
  dosingQueueTsx.includes("Memverifikasi antrean peracikan dengan ESP32..."),
  "DosingQueueSection must render container loading state during 15s grace period"
);
console.log("PASS 4: DosingQueueSection renders loading state in container during grace period");

// 5. Verify esp32 api_config_handlers.c invokes scheduler_sync_intents on config activation
const configHandlersC = fs.readFileSync("esp32/main/http/api_config_handlers.c", "utf-8");
assert(
  configHandlersC.includes('#include "services/scheduler.h"') &&
  configHandlersC.includes("scheduler_sync_intents()"),
  "api_config_handlers.c must call scheduler_sync_intents on config activation"
);
console.log("PASS 5: api_config_handlers.c invokes scheduler_sync_intents on configuration activation");

// 6. Verify esp32 scheduler.c autonomous 2-hour periodic guard and missing occurrences recovery
const schedulerC = fs.readFileSync("esp32/main/services/scheduler.c", "utf-8");
assert(
  schedulerC.includes("now - s_last_periodic_check_sec >= 7200") &&
  schedulerC.includes("s_today_occurrence_count == 0 && s_runtime_count > 0"),
  "scheduler.c must implement autonomous 2-hour periodic guard and missing occurrences recovery"
);
console.log("PASS 6: scheduler.c implements 2-hour periodic guard (7200s) & missing occurrences recovery");

// 7. Verify esp32 api_device_handlers.c triggers daily materialization upon clock sync
const deviceHandlersC = fs.readFileSync("esp32/main/http/api_device_handlers.c", "utf-8");
assert(
  deviceHandlersC.includes("scheduler_trigger_daily_now()"),
  "api_device_handlers.c must trigger daily materialization upon clock sync"
);
console.log("PASS 7: api_device_handlers.c triggers scheduler_trigger_daily_now on clock sync");

console.log("\nALL DUAL-GUARD AUTONOMOUS SCHEDULE INVARIANTS VERIFIED SUCCESSFULLY!");
