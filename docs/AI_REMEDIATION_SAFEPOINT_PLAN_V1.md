# AI REMEDIATION SAFEPOINT PLAN V1

### SP-REMED-001
- **Objective**: Hardware Foundation & SPI Initialization
- **Included findings**: BS-HW-001, BS-HW-002, BS-HW-003
- **Dependencies**: None.
- **Expected repository state**: `pin_config.h` updated with safe GPIOs. `hardware_registry.c` initializes SPI host.
- **Build/test evidence**: Code compiles. Code boots on ESP32 without `StoreProhibited` or SPI panics.
- **Exit criteria**: Safe physical baseline established.
- **Rollback point**: Git revert of `pin_config.h` and `hardware_registry.c`.

### SP-REMED-002
- **Objective**: Network & RTC Initialization
- **Included findings**: BS-NET-001, BS-CLOCK-001, BS-CLOCK-002
- **Dependencies**: SP-REMED-001
- **Expected repository state**: Device connects to Wi-Fi/Ethernet on boot. DS3231 initializes and sets `gettimeofday`.
- **Build/test evidence**: Device responds to ping. `GET /api/v1/system/time` returns real 202x timestamp.
- **Exit criteria**: Device is reachable and time-aware.
- **Rollback point**: Firmware downgrade.

### SP-REMED-003
- **Objective**: Safety Interlocks & Sensors
- **Included findings**: BS-HW-004, BS-HW-005, BS-SAFE-002, BS-SENS-001
- **Dependencies**: SP-REMED-001
- **Expected repository state**: Relay polarity configurable. Dry-run interlock active. DS18B20 reads correctly (750ms).
- **Build/test evidence**: Hardware-in-the-loop tests verify float switch disables pump.
- **Exit criteria**: Physical damage prevention mechanisms verified.
- **Rollback point**: Firmware downgrade.

### SP-REMED-004
- **Objective**: Persistence & Memory Bounds
- **Included findings**: BS-SAFE-001, BS-MEM-001, BS-MEM-002, BS-CC-001, BS-TELE-001
- **Dependencies**: None
- **Expected repository state**: E-Stop latches in NVS. JSON parser chunks payloads < 4KB. Crop cycle defaults to NO_CYCLE.
- **Build/test evidence**: Reboot ESP32 while in E-Stop; verify E-Stop resumes.
- **Exit criteria**: System survives power loss safely and survives large payloads.
- **Rollback point**: NVS erase / format.

### SP-REMED-005
- **Objective**: Async Command Processing & Contract Alignment
- **Included findings**: BS-CMD-001, BS-CMD-002, BS-CONT-002, BS-API-001
- **Dependencies**: SP-REMED-002, SP-REMED-004
- **Expected repository state**: POST /commands delegates to `command_mgr` queue. `DELETE /commands/` implemented.
- **Build/test evidence**: Submit 5 min pump run; verify API still responds to other requests (queue is async).
- **Exit criteria**: API and physical execution are fully decoupled and non-blocking.
- **Rollback point**: Revert `command_mgr` and API handlers.

### SP-REMED-006
- **Objective**: Scheduler & Topology
- **Included findings**: BS-SCHED-001, BS-TOP-001, BS-SYS-001, BS-SYS-002, BS-CC-003
- **Dependencies**: SP-REMED-002, SP-REMED-005
- **Expected repository state**: Cron scheduler executes tasks. Handlers parse `{ghId}`. Config payloads validated.
- **Build/test evidence**: Schedule a fan to run 1 min from now; observe physical trigger.
- **Exit criteria**: Automated greenhouse routines function.
- **Rollback point**: Revert `scheduler.c`.

### SP-REMED-007
- **Objective**: UI Endpoint Alignment
- **Included findings**: BS-UI-001, BS-UI-002
- **Dependencies**: SP-REMED-005
- **Expected repository state**: UI TS client `startManual` and `resume` hit the real API.
- **Build/test evidence**: UI clicks appear in ESP32 logs.
- **Exit criteria**: UI commands execute physically.
- **Rollback point**: Revert TS client.

### SP-REMED-008
- **Objective**: Authentication & Security
- **Included findings**: BS-SEC-001
- **Dependencies**: SP-REMED-007
- **Expected repository state**: API requires Bearer token or API key.
- **Build/test evidence**: Missing header returns 401. Valid header returns 200.
- **Exit criteria**: System is safe from local unauthorized access.
- **Rollback point**: Disable auth middleware.

### SP-REMED-009
- **Objective**: E2E Testing Transformation
- **Included findings**: BS-TEST-001
- **Dependencies**: SP-REMED-002
- **Expected repository state**: Test script runs against live ESP32 IP.
- **Build/test evidence**: `verify_e2e_contracts.mjs` executes and passes (or fails legitimately).
- **Exit criteria**: Tests reflect reality.
- **Rollback point**: Revert to mock server mode.
