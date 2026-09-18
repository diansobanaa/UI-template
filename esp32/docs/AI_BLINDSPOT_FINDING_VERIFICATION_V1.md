# AI BLINDSPOT FINDING VERIFICATION V1

## Phase 1: CRITICAL Findings

### BS-NET-001
- **Original Severity**: CRITICAL
- **Verified Severity**: CRITICAL
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Complete Absence of Network Interface Initialization (No Wi-Fi STA/AP or W5500 SPI Ethernet Driver in Firmware).
- **Evidence**: `esp32/main/main.c` calls `esp_netif_init()` but no `esp_wifi_init()`, `esp_wifi_start()`, or Ethernet initialization logic is present.
- **Repository tracing**: `main.c` line 117 calls `esp_netif_init()`. No MAC/PHY drivers are initialized in `hardware_registry.c` or elsewhere.
- **Failure scenario validation**: The HTTP server starts on an interface that has no physical netif attached, making the controller unreachable.
- **What the previous audit got right**: The codebase completely lacks Wi-Fi or Ethernet driver initialization.
- **What the previous audit got wrong / overstated**: Nothing. 
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Implement `network_mgr.c` or similar to handle network driver initialization.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-HW-001
- **Original Severity**: CRITICAL
- **Verified Severity**: CRITICAL
- **Original Status**: REQUIRES DECISION
- **Verified Status**: CONFIRMED
- **Claim**: GPIO 19 Assigned to Lower Float Switch Conflicts with ESP32-S3 Native USB D-.
- **Evidence**: `esp32/main/config/pin_config.h` defines `PIN_IN_FLOAT_LOWER 19`. `IS_RESERVED_PIN` excludes 19.
- **Repository tracing**: `pin_config.h` line 62. ESP32-S3 datasheet confirms GPIO 19 is Native USB D-.
- **Failure scenario validation**: Activating the float switch will pull D- low, destroying USB communication.
- **What the previous audit got right**: The pin conflict is genuine.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Relocate `PIN_IN_FLOAT_LOWER` to a safe pin.
- **Confidence**: HIGH
- **Requires project decision**: YES
- **Requires physical verification**: NO

### BS-HW-002
- **Original Severity**: CRITICAL
- **Verified Severity**: CRITICAL
- **Original Status**: REQUIRES DECISION
- **Verified Status**: CONFIRMED
- **Claim**: MicroSD CS on GPIO 47 Conflicts with Octal SPI PSRAM (OPI) Bus on ESP32-S3-WROOM-1-N16R8.
- **Evidence**: `sdkconfig.defaults` line 9 enables `CONFIG_SPIRAM_MODE_OCT=y`. `pin_config.h` line 31 assigns `PIN_MICROSD_CS 47`.
- **Repository tracing**: `sdkconfig.defaults` confirms Octal PSRAM. ESP32-S3 datasheet confirms GPIO 47 is used for OPI.
- **Failure scenario validation**: Using GPIO 47 for SD card CS will corrupt Octal PSRAM operations, leading to CPU panic.
- **What the previous audit got right**: The pin conflict is genuine.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Relocate `PIN_MICROSD_CS` to an unreserved pin.
- **Confidence**: HIGH
- **Requires project decision**: YES
- **Requires physical verification**: NO

### BS-HW-004
- **Original Severity**: CRITICAL
- **Verified Severity**: CRITICAL
- **Original Status**: REQUIRES VERIFICATION
- **Verified Status**: CONFIRMED
- **Claim**: Inverted Relay Polarity Risk on Safe Boot for Standard Active-Low Commercial Relay Modules.
- **Evidence**: `pin_config.h` lines 53-54 define `ACTUATOR_LEVEL_ON 1` and `OFF 0`. `main.c` line 59 drives outputs to `ACTUATOR_LEVEL_OFF` (0) on safe boot.
- **Repository tracing**: Code verified. If the connected relay module is active-low, driving `0` turns the relay ON.
- **Failure scenario validation**: The code assumes active-high relays. A standard active-low relay will turn ON during boot clamp.
- **What the previous audit got right**: The code hardcodes `OFF = 0` which is dangerous for active-low boards.
- **What the previous audit got wrong / overstated**: Nothing. 
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Needs configurable `ACTUATOR_ACTIVE_LEVEL`.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: YES (to confirm relay module polarity)

### BS-SAFE-001
- **Original Severity**: CRITICAL
- **Verified Severity**: CRITICAL
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: In-Memory Latched Emergency Stop Disappears Across ESP32 Reboot or Power Loss.
- **Evidence**: `actuator_hal.c` line 26 defines `static bool s_emergency_stop_latched = false;`.
- **Repository tracing**: `s_emergency_stop_latched` is stored in RAM and resets to `false` on boot. No NVS persistence is used.
- **Failure scenario validation**: A power blip will clear the emergency stop latch, potentially turning pumps back on if commands are received.
- **What the previous audit got right**: The latch is volatile.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. The state should be persisted to NVS.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-SAFE-002
- **Original Severity**: CRITICAL
- **Verified Severity**: CRITICAL
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Lower Float Dry-Run Protection Has No Preventative Interlock and Inverts on Disconnected Wire.
- **Evidence**: `safety_monitor.c` lines 24-34 check float state reactively. `actuator_hal.c` lacks `s_tank_dry_interlock` in `actuator_hal_set`. `sensor_hal.c` line 162 inverts logic with pullup enabled.
- **Repository tracing**: `actuator_hal_set()` does not check for dry run. `sensor_hal_init` configures `GPIO_PULLUP_ENABLE` for the float pin, meaning a disconnected wire floats HIGH (`float_lower_ok = true`).
- **Failure scenario validation**: Pumps can be activated when dry. A disconnected wire falsely reports a healthy water level.
- **What the previous audit got right**: Both the reactive nature and the inverted wire fault logic are accurate.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Add interlock to `actuator_hal_set` and fix wiring/logic for fail-safe disconnected state.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: YES (to confirm float switch orientation)

## Phase 2: HIGH Findings

### BS-HW-003
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: SPI Bus Master Never Initialized for Shared MicroSD / W5500 / TFT Bus.
- **Evidence**: `spi_bus_initialize` is completely missing from the ESP32 codebase.
- **Repository tracing**: Searched `esp32` for `spi_bus_initialize` and found zero occurrences. `sdcard_hal.c` assumes the bus is already initialized.
- **Failure scenario validation**: The SPI peripheral will panic on boot when attempting to mount the SD card or initialize the W5500 without a configured host bus.
- **What the previous audit got right**: The SPI bus initialization is entirely missing.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Call `spi_bus_initialize` in `hardware_registry.c` before mounting SPI peripherals.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-CMD-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: HTTP Command Handler Bypasses `command_mgr` and Idempotency Checks Entirely.
- **Evidence**: `esp32/main/http/api_command_handlers.c` lines 53-61 directly calls `actuator_hal_set`.
- **Repository tracing**: `handler_post_command` parses JSON and manually switches on "RESUME_SYSTEM", "EMERGENCY_STOP", "WELL_PUMP_START", etc., calling HAL methods synchronously instead of `command_mgr_submit()`.
- **Failure scenario validation**: Commands submitted via API bypass idempotency, logging, and asynchronous queuing, leading to potential race conditions and duplicated executions.
- **What the previous audit got right**: The API handler completely bypasses `command_mgr`.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Rewrite `handler_post_command` to dispatch payloads to `command_mgr`.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-CMD-002
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Command Worker Task Blocks Entire Worker Queue Synchronously with `vTaskDelay`.
- **Evidence**: `esp32/main/services/command_mgr.c` lines 71-95 uses `vTaskDelay` for pump run durations.
- **Repository tracing**: In `command_worker_task`, a `WELL_PUMP` command with duration blocks the entire task using `vTaskDelay` while the pump runs.
- **Failure scenario validation**: If a dosing pump is commanded to run for 10 minutes, the worker queue is blocked for 10 minutes, preventing an EMERGENCY_STOP command from being processed.
- **What the previous audit got right**: The worker queue is blocked by synchronous delays.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Implement an asynchronous scheduler or timer mechanism for command durations.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-SCHED-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Firmware Scheduler Task is an Empty Idle Loop.
- **Evidence**: `esp32/main/services/scheduler.c` lines 10-18.
- **Repository tracing**: `scheduler_task` contains an empty `while (1) { vTaskDelay(pdMS_TO_TICKS(10000)); }`.
- **Failure scenario validation**: Any automated greenhouse schedules (fan, fertigation) defined in the UI will never execute on the firmware because the firmware scheduler does nothing.
- **What the previous audit got right**: The scheduler is indeed a stub.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Implement cron-like schedule parsing and execution.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-UI-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: UI Manual Fertigation Runs Execute Solely in Browser Memory.
- **Evidence**: `src/lib/services.ts` lines 599-621 (`startManual`).
- **Repository tracing**: `startManual` uses `setTimeout` to mock run progression without calling `esp32Client.postCommand()`.
- **Failure scenario validation**: A user clicking "Start Fertigation" in the UI will see a progress bar complete, but the actual pumps will not turn on.
- **What the previous audit got right**: The UI service is fully stubbed for manual runs.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Wire up `startManual` to the `esp32Client`.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-UI-002
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: UI "Resume" Action Clears Local Mock State but Never Sends Command to ESP32.
- **Evidence**: `src/lib/services.ts` lines 671-675 (`resume`).
- **Repository tracing**: `resume` calls `resumeComplex(complexId)` (local store update) but makes no network call via `esp32Client`.
- **Failure scenario validation**: Resuming the system via UI will show the system as resumed on screen, but the physical controller remains in emergency stop.
- **What the previous audit got right**: The network call is absent for resuming.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Add `esp32Client.postCommand("RESUME_SYSTEM")` to the `resume` function.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-CLOCK-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: DS3231 I2C RTC Driver Completely Unimplemented.
- **Evidence**: No `rtc_ds3231.c` initialization in `main.c`; `api_device_handlers.c` relies solely on `time(NULL)`.
- **Repository tracing**: Clock GET handler returns the default 1970 UNIX epoch time because it never syncs from an I2C RTC.
- **Failure scenario validation**: Without an RTC or SNTP, timestamps on telemetry and event logs will be invalid (1970).
- **What the previous audit got right**: The RTC driver is missing.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Add I2C RTC driver and initialize the system clock from it on boot.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: YES (to verify DS3231 battery and presence)

### BS-CC-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Firmware Pre-Seeds Active Crop Cycle in Flash on First Boot.
- **Evidence**: `esp32/main/services/crop_cycle_mgr.c` lines 11-22 statically defines an active crop cycle for "Tomat San Marzano".
- **Repository tracing**: If NVS is empty on first boot, the system falls back to this hardcoded active cycle.
- **Failure scenario validation**: Starting a new cycle via the API will fail with a 409 Conflict because the system believes a cycle is already active out of the box.
- **What the previous audit got right**: The default struct is pre-seeded with an ACTIVE state.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Change the default struct to `CYCLE_STATE_NO_CYCLE`.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-SENS-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: DS18B20 1-Wire Driver Has Insufficient Conversion Delay.
- **Evidence**: `esp32/main/hal/sensor_hal.c` lines 93-112.
- **Repository tracing**: `ds18b20_read_temp` issues `0x44` (Start Convert) and then waits only 15ms via `vTaskDelay` instead of the 750ms required for 12-bit resolution. Bit operations do not use `portENTER_CRITICAL`.
- **Failure scenario validation**: Reading temperature will return invalid data or `85°C` (the power-on reset value) because the conversion hasn't finished. Bit operations will be corrupted by OS context switches.
- **What the previous audit got right**: The 15ms delay is fundamentally insufficient for DS18B20.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Increase delay to 750ms and wrap bit operations in critical sections.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-TOP-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Hardcoded `"gh-01"` Across Handlers Precludes Multi-Greenhouse Operation.
- **Evidence**: 25 occurrences of `"gh-01"` string literal in `api_cropcycle_handlers.c`, `api_telemetry_handlers.c`, `api_device_handlers.c`, and `crop_cycle_mgr.c`.
- **Repository tracing**: The system ignores the `{ghId}` route parameter in HTTP handlers and strictly uses `"gh-01"`.
- **Failure scenario validation**: If a user creates `"gh-02"`, the firmware will either 404 or improperly apply changes to `"gh-01"` instead.
- **What the previous audit got right**: The codebase is rigidly hardcoded to a single greenhouse.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Parse the `{ghId}` parameter from the HTTP URI wildcard matching.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-CONT-002
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: `DELETE /api/v1/commands/{commandId}` Missing in Firmware; Client Lacks Generic `postCommand`.
- **Evidence**: `http_server.c` lacks route for `DELETE /api/v1/commands/*`. `esp32-client.ts` lacks `postCommand()`.
- **Repository tracing**: The canonical OpenAPI defines `DELETE /api/v1/commands/{commandId}`. The ESP32 does not implement this. The UI client defines `cancelCommand` but lacks a method to issue generic commands (except `emergencyStop`).
- **Failure scenario validation**: The UI cannot cancel a pending command, leading to HTTP 404. It also cannot issue normal system commands.
- **What the previous audit got right**: The discrepancy between the UI, OpenAPI contract, and Firmware is real.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Implement `DELETE` route and generic `postCommand` in the TS client.
- **Confidence**: HIGH
- **Requires project decision**: NO
- **Requires physical verification**: NO

### BS-TEST-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Verification Script Tests Synthetic Node Mock Instead of Real Schemas.
- **Evidence**: `scripts/verify_e2e_contracts.mjs` lines 97-205 create an `http.createServer` with hardcoded JSON responses.
- **Repository tracing**: The script tests `fetch` against `http://127.0.0.1:3888` (the mock server) rather than a real ESP32 endpoint.
- **Failure scenario validation**: The test passes successfully even though the real C firmware is entirely broken or missing features, providing a false sense of security.
- **What the previous audit got right**: The verification script is a mock masquerading as an E2E test.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Point the test script to an actual ESP32 IP or remove the mock server.
- **Confidence**: HIGH
- **Requires project decision**: YES (Test strategy needs overhaul)
- **Requires physical verification**: NO

### BS-SEC-001
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Absence of Authentication and DoS Vulnerability in HTTP Body Parser.
- **Evidence**: `http_server.c` lines 70-102 (`http_parse_json_body`).
- **Repository tracing**: The JSON parser allocates up to 16KB per request without authentication.
- **Failure scenario validation**: An attacker on the local network can crash the ESP32 (OOM) by sending concurrent 16KB JSON bodies. Any user on the LAN can trigger an emergency stop or pump action without credentials.
- **What the previous audit got right**: Authentication is totally absent. OOM vulnerability is real.
- **What the previous audit got wrong / overstated**: Nothing.
- **Mitigations discovered**: None.
- **Recommended-fix assessment**: VALID. Add API key/Bearer token auth and rate-limiting/chunked JSON parsing.
- **Confidence**: HIGH
- **Requires project decision**: YES (Authentication architecture)
- **Requires physical verification**: NO

### BS-HW-005
- **Original Severity**: HIGH
- **Verified Severity**: HIGH
- **Original Status**: NEW
- **Verified Status**: CONFIRMED
- **Claim**: Absence of Inductive Kickback Snubbers and Welded Relay Contact Detection.
- **Evidence**: `ESP32_ASSEMBLY_GUIDE.md` specifies snubbers, but firmware lacks welded contact detection.
- **Repository tracing**: `safety_monitor.c` only checks float switch for dry-run. It does not correlate flow rate with actuator state to detect stuck relays.
- **Failure scenario validation**: If a well pump relay welds closed due to AC arcing, the pump will run continuously. The firmware will assume it is OFF and take no action, overflowing the tank.
- **What the previous audit got right**: The physical risk of welded relays is high for AC pumps.
- **What the previous audit got wrong / overstated**: The assembly guide *does* mention snubbers, so the physical mitigation is documented. The *firmware* mitigation is missing.
- **Mitigations discovered**: Hardware snubbers are documented in `ESP32_ASSEMBLY_GUIDE.md`.
- **Recommended-fix assessment**: VALID. Firmware should detect welded relays by checking if `flow > 0` when `pump == OFF`.
- **Confidence**: HIGH
- **Requires project decision**: YES (Hardware vs Software mitigation)
- **Requires physical verification**: YES (To verify if snubbers are physically installed)
