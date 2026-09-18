# AI REMEDIATION CONFLICT MATRIX V1

| Conflict ID | Fix A | Fix B | Why they conflict | Which must happen first | Project Decision Required |
|-------------|-------|-------|-------------------|--------------------------|---------------------------|
| CON-001 | Async Queue Handler Rewrite (RG-CMD) | HTTP OOM Memory Bound Fix (RG-STATE) | If we rewrite `api_command_handlers.c` for async before fixing the underlying JSON parser OOM, we will have to rewrite the parser logic twice or carry the vulnerability into the new queue. | RG-STATE (Memory Bounds) first. | NO |
| CON-002 | W5500 Ethernet Initialization (RG-NET-TIME) | SPI Bus Master Init (RG-HW-INIT) | Initializing a W5500 MAC/PHY via SPI before the ESP32 SPI host is initialized will cause an immediate CPU panic on boot. | RG-HW-INIT first. | NO |
| CON-003 | Manual UI Fertigation (RG-UI) | Relay Polarity Safety (RG-SAFETY-HW) | If the UI correctly triggers a pump before the firmware correctly understands active-low vs active-high, the UI will inadvertently trigger physical inverse actions. | RG-SAFETY-HW first. | NO |
| CON-004 | Topology `{ghId}` Routing (RG-SCHED) | Crop Cycle Default State (RG-STATE) | Changing the default crop cycle struct and changing how GH IDs are keyed in NVS will collide and corrupt the NVS `crop_cycle` blob if not done sequentially. | RG-STATE first. | NO |
| CON-005 | Cron Scheduler (RG-SCHED) | Async Commands (RG-CMD) | A working cron scheduler must dispatch commands. If the scheduler is built before the command queue supports async duration tasks, the scheduler will block the system. | RG-CMD first. | NO |
