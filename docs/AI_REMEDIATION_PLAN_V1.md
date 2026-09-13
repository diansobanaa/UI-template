# AI REMEDIATION PLAN V1

## RG-HW-INIT: Hardware Definition & Boot Initialization
- **Group ID**: RG-HW-INIT
- **Title**: Hardware Definition & Boot Initialization
- **Root causes addressed**: Root Cause 2 (Hardware Ignorance), Root Cause 3 (Incomplete Boot Chain)
- **Findings addressed**: BS-HW-001, BS-HW-002, BS-HW-003
- **Goal**: Ensure safe pin allocations and initialize SPI bus so peripherals do not conflict or panic on boot.
- **Affected layers**: ESP32 HAL, ESP32 initialization
- **Affected files/modules**: `esp32/main/config/pin_config.h`, `esp32/main/hardware_registry.c`
- **Dependencies**: None.
- **Implementation approach**: Move `PIN_IN_FLOAT_LOWER` off GPIO 19. Move `PIN_MICROSD_CS` off GPIO 47. Call `spi_bus_initialize` before mounting SD or W5500.
- **Risk**: Low. Standard corrections.
- **Tests**: ESP32-on-real-device proof (boot without CPU panic).
- **Physical verification**: None.
- **Decision dependencies**: DECISION-001 (Safe Pin Allocations).
- **Rollback**: Revert `pin_config.h`.
- **Priority**: P0 — must fix before first flash
- **Safe Point**: SP-REMED-001

## RG-NET-TIME: Network & RTC Initialization
- **Group ID**: RG-NET-TIME
- **Title**: Network & RTC Initialization
- **Root causes addressed**: Root Cause 3 (Incomplete Boot/Initialization Chain)
- **Findings addressed**: BS-NET-001, BS-CLOCK-001, BS-CLOCK-002
- **Goal**: Ensure reachability and valid timestamps upon boot.
- **Affected layers**: ESP32 Networking, Timekeeping
- **Affected files/modules**: `esp32/main/main.c`, `esp32/main/network_mgr.c`, `esp32/main/hal/rtc_ds3231.c`, `api_device_handlers.c`
- **Dependencies**: RG-HW-INIT (requires SPI bus for Ethernet, if used).
- **Implementation approach**: Add missing MAC/PHY driver initialization. Add DS3231 I2C driver initialization. Implement settimeofday on clock-sync.
- **Risk**: Medium. Network drivers depend on PHY specifics.
- **Tests**: Network ping, RTC timestamp consistency check.
- **Physical verification**: Confirm DS3231 battery presence.
- **Decision dependencies**: DECISION-002 (Primary Network Interface).
- **Rollback**: Firmware downgrade.
- **Priority**: P0 — must fix before operational runtime
- **Safe Point**: SP-REMED-002

## RG-SAFETY-HW: Physical Safety Interlocks & Sensor Drivers
- **Group ID**: RG-SAFETY-HW
- **Title**: Physical Safety Interlocks & Sensor Drivers
- **Root causes addressed**: Root Cause 2 (Hardware Ignorance)
- **Findings addressed**: BS-HW-004, BS-HW-005, BS-SAFE-002, BS-SENS-001
- **Goal**: Fix dangerous physical assumptions (relay polarity, dry-run interlock, sensor timing).
- **Affected layers**: ESP32 HAL (sensor, actuator), Safety Monitor
- **Affected files/modules**: `sensor_hal.c`, `actuator_hal.c`, `safety_monitor.c`, `pin_config.h`
- **Dependencies**: RG-HW-INIT (requires stable GPIO).
- **Implementation approach**: Configurable `ACTUATOR_ACTIVE_LEVEL`. Preventative dry-run interlock in `actuator_hal_set`. 750ms DS18B20 delay with critical sections. Welded relay logic check using flow meter.
- **Risk**: High (physical safety).
- **Tests**: Hardware-in-the-loop tests for float state and relay state.
- **Physical verification**: Relay module polarity check (active-high vs active-low), Inductive snubber physical inspection.
- **Decision dependencies**: None.
- **Rollback**: Firmware downgrade.
- **Priority**: P0 — must fix before operational runtime
- **Safe Point**: SP-REMED-003

## RG-STATE: Persistence & Memory Bounds
- **Group ID**: RG-STATE
- **Title**: Persistence & Memory Bounds
- **Root causes addressed**: Root Cause 4 (Poor Concurrency/State), Root Cause 5 (Happy Path)
- **Findings addressed**: BS-SAFE-001, BS-MEM-001, BS-MEM-002, BS-CC-001, BS-TELE-001
- **Goal**: Fix volatile E-Stop, OOM vulnerabilities, storage race conditions, and crop cycle defaults.
- **Affected layers**: ESP32 Storage, Safety, HTTP Middleware
- **Affected files/modules**: `actuator_hal.c`, `http_server.c`, `crop_cycle_mgr.c`, `telemetry_mgr.c`
- **Dependencies**: None.
- **Implementation approach**: Persist E-Stop latch to NVS. Add thread-safety mutexes to SPIFFS. Rate-limit and chunk HTTP JSON parser (max memory bound). Change default crop cycle state to NO_CYCLE. Fix synthetic telemetry values.
- **Risk**: Medium. NVS persistence behavior can wear flash if written excessively.
- **Tests**: Reboot/persistence tests. OOM fuzzing tests on HTTP.
- **Physical verification**: None.
- **Decision dependencies**: None.
- **Rollback**: Flash erase NVS (migration rollback).
- **Priority**: P1 — must fix before operational runtime
- **Safe Point**: SP-REMED-004

## RG-CMD: Async Command Processing & Contract Alignment
- **Group ID**: RG-CMD
- **Title**: Async Command Processing & Contract Alignment
- **Root causes addressed**: Root Cause 4 (Poor Concurrency), Root Cause 1 (Lack of True E2E)
- **Findings addressed**: BS-CMD-001, BS-CMD-002, BS-CONT-002, BS-API-001
- **Goal**: Make API command queue async, unblock worker task, align UI client TS interface.
- **Affected layers**: UI Client, ESP32 HTTP, ESP32 Services
- **Affected files/modules**: `api_command_handlers.c`, `command_mgr.c`, `esp32-client.ts`, `UI_ESP32_OPENAPI.yaml`
- **Dependencies**: RG-STATE (for queue persistence)
- **Implementation approach**: Dispatch POST commands to `command_mgr` queue. Replace `vTaskDelay` with FreeRTOS timers or state machines. Add DELETE route for commands. Add TS `postCommand`.
- **Risk**: High (rewriting command pipeline).
- **Tests**: Contract tests, Integration tests simulating long-running commands.
- **Physical verification**: None.
- **Decision dependencies**: None.
- **Rollback**: Revert firmware `command_mgr.c` and UI TS client.
- **Priority**: P1 — must fix before operational runtime
- **Safe Point**: SP-REMED-005

## RG-SCHED: Scheduler, Topology & Config Validation
- **Group ID**: RG-SCHED
- **Title**: Scheduler, Topology & Config Validation
- **Root causes addressed**: Root Cause 1, Root Cause 5
- **Findings addressed**: BS-SCHED-001, BS-TOP-001, BS-SYS-001, BS-SYS-002, BS-CC-003
- **Goal**: Implement actual cron scheduler, dynamic GH parsing, and strict config validation.
- **Affected layers**: ESP32 Services, ESP32 API
- **Affected files/modules**: `scheduler.c`, `api_*_handlers.c`, `config_mgr.c`
- **Dependencies**: RG-CMD (to execute tasks), RG-NET-TIME (for time)
- **Implementation approach**: Replace stub scheduler with a cron executor. Parse `{ghId}` param dynamically instead of hardcoding `"gh-01"`. Add config validation before saving.
- **Risk**: Medium.
- **Tests**: Unit tests for cron execution.
- **Physical verification**: None.
- **Decision dependencies**: DECISION-003 (Topology/Valve architecture for multi-GH).
- **Rollback**: Firmware downgrade.
- **Priority**: P2 — must fix before multi-GH deployment
- **Safe Point**: SP-REMED-006

## RG-UI: UI Endpoint Alignment
- **Group ID**: RG-UI
- **Title**: UI Endpoint Alignment
- **Root causes addressed**: Root Cause 1 (Lack of True E2E)
- **Findings addressed**: BS-UI-001, BS-UI-002
- **Goal**: Wire up UI to actually trigger ESP32 commands.
- **Affected layers**: UI Client
- **Affected files/modules**: `src/lib/services.ts`
- **Dependencies**: RG-CMD
- **Implementation approach**: Replace `setTimeout` mocks with `esp32Client.postCommand()` API calls for manual fertigation and resume operations.
- **Risk**: Low. Preserves existing UX.
- **Tests**: Manual UI clicking observing network traffic.
- **Physical verification**: None.
- **Decision dependencies**: None.
- **Rollback**: Revert `services.ts`.
- **Priority**: P1 — must fix before operational runtime
- **Safe Point**: SP-REMED-007

## RG-SEC: Authentication & Security
- **Group ID**: RG-SEC
- **Title**: Authentication & Security
- **Root causes addressed**: Root Cause 5 (Happy Path)
- **Findings addressed**: BS-SEC-001
- **Goal**: Secure the HTTP server against unauthorized commands.
- **Affected layers**: UI Client, ESP32 HTTP
- **Affected files/modules**: `http_server.c`, `esp32-client.ts`
- **Dependencies**: RG-UI
- **Implementation approach**: Add API key check in HTTP middleware. Pass API key in UI headers.
- **Risk**: Medium. Could lock out legitimate clients if implemented poorly.
- **Tests**: 401 Unauthorized negative tests.
- **Physical verification**: None.
- **Decision dependencies**: DECISION-004 (Auth method and key distribution).
- **Rollback**: Disable auth checking.
- **Priority**: P2
- **Safe Point**: SP-REMED-008

## RG-TEST: E2E Testing Transformation
- **Group ID**: RG-TEST
- **Title**: E2E Testing Transformation
- **Root causes addressed**: Root Cause 1
- **Findings addressed**: BS-TEST-001
- **Goal**: Verify against the real ESP32, not the Node mock.
- **Affected layers**: Testing Scripts
- **Affected files/modules**: `scripts/verify_e2e_contracts.mjs`
- **Dependencies**: RG-NET-TIME (for reachability).
- **Implementation approach**: Point the test script to an actual ESP32 IP or remove the mock server logic, forcing it to run against the physical device on the network.
- **Risk**: Low.
- **Tests**: CI/CD pipeline execution.
- **Physical verification**: Requires a physical ESP32 on the network.
- **Decision dependencies**: None.
- **Rollback**: Revert testing script.
- **Priority**: P1
- **Safe Point**: SP-REMED-009
