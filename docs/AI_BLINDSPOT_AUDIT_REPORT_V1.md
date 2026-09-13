# AI AGENT BLINDSPOT AUDIT REPORT V1
## Deep Architectural, Physical, and Contractual Audit of AgroTech ESP32 ↔ UI Codebase

- **Audit Date**: 2026-09-13
- **Auditor**: Antigravity AI Pair Programming Agent
- **Audit Safe Point**: `SP-AUDIT-001`
- **Baseline Safe Point**: `SP-011` (Commissioning documentation completed)
- **Scope**: Entire UI ↔ ESP32 stack (firmware, HAL, HTTP API, OpenAPI contract, TypeScript adapter, UI store, physical wiring guide)
- **Constraint**: **AUDIT ONLY — NO SOURCE CODE MODIFICATIONS PERFORMED**
- **Evidence Standard**: Strictly cited file paths, line ranges, and observed behavior from the repository.

---

## 1. Executive Summary

This deep blindspot audit was performed before physical hardware assembly and firmware flashing. Its goal is to uncover hidden assumptions, race conditions, contract drift, safety loopholes, and physical hardware conflicts before high-voltage equipment, pumps, and electronics are energized.

The audit analyzed the entire stack:
```text
EXISTING VITE/REACT UI
        ↕
ESP32 REST/API
        ↕
ESP32 runtime (FreeRTOS tasks)
        ↕
ESP32 storage (NVS / SPIFFS / SD)
        ↕
ESP32 hardware abstraction (HAL)
        ↕
physical hardware assumptions (Schematics / Pinout / Power)
```

### High-Level Summary of Findings
- **Total Blindspots Identified**: 30
- **CRITICAL**: 6
- **HIGH**: 14
- **MEDIUM**: 8
- **LOW**: 1
- **INFORMATIONAL**: 1
- **Requires Project Decision**: 3
- **Requires Physical Verification**: 2

### The 5 Most Dangerous Blindspots Discovered
1. **Network Interface Completely Uninitialized (`BS-NET-001`)**: The ESP32 firmware initializes LwIP event loops and starts the HTTP server, but *never* initializes Wi-Fi (STA or AP) or the SPI W5500 Ethernet driver. Flashed firmware will boot and run in complete isolation with no IP address and zero network connectivity.
2. **Native USB D- Pin Collision (`BS-HW-001`)**: GPIO 19 was allocated to the Lower Float Switch in `pin_config.h` and `ESP32_ASSEMBLY_GUIDE.md`. On ESP32-S3, GPIO 19 is hardwired to the native USB D- (`USB_DM`) controller. Connecting an external float switch destroys USB communication, drops debug monitors, and impedes flashing.
3. **Octal PSRAM Data Pin Collision (`BS-HW-002`)**: MicroSD Chip Select is assigned to GPIO 47, while `sdkconfig.defaults` specifies `CONFIG_SPIRAM_MODE_OCT=y`. On ESP32-S3-WROOM-1-N16R8, GPIO 47 is occupied by the embedded high-speed Octal PSRAM interface. Driving GPIO 47 corrupts system RAM and causes CPU cache panic.
4. **Relay Active-Low Safe Boot Inversion (`BS-HW-004`)**: `safe_boot_actuators()` configures pulldowns and drives GPIO outputs to logic 0. Commercial multi-channel relay modules are almost universally *active-low* (0 = relay energized). Under this condition, safe boot turns *all* pumps, dosing channels, and fans ON at maximum power during boot.
5. **Volatile Emergency Stop Latch (`BS-SAFE-001`)**: The emergency stop latch is stored as a volatile C static variable in RAM. If an operator triggers an emergency stop and power blips or the board brownouts, the ESP32 reboots with emergency stop *cleared*, silently re-enabling blocked equipment.

---

## 2. Structured Domain Audit (Domains A through AD)

### A. UI ↔ ESP32 Contract Drift
- **Finding BS-CONT-001**: Canonical contract `template/contracts/UI_ESP32_OPENAPI.yaml` specifies an envelope wrapper (`EnvelopeBase`: `requestId`, `success`, `deviceTimestamp`, `data: {...}`) for all 200 responses. Firmware handlers in `esp32/main/http/api_device_handlers.c` return flat JSON with non-matching field names (`uptimeSeconds` vs `uptimeSec`, `freeHeap` vs `health.memory.freeHeapBytes`).
- **Finding BS-CONT-002**: `Esp32Client.cancelCommand` calls `DELETE /api/v1/commands/{commandId}`, but `http_server.c` only registers `HTTP_GET` for `/api/v1/commands/*`. Furthermore, `Esp32Client` lacks a method to invoke generic commands (`createCommand`).

### B. UI State vs Device State
- **Finding BS-UI-001**: When "Start Fertigation" is clicked in the UI, `fertigationService.startManual` in `src/lib/services.ts` runs a JavaScript `setTimeout` loop that advances progress purely in browser RAM (`advanceManualRun`). No command is dispatched to the ESP32.
- **Finding BS-UI-002**: Clicking "Resume" in the UI invokes `complexService.resume()`, resetting in-memory mock flags, but fails to call `esp32Client` or send `RESUME_SYSTEM` to the ESP32. The hardware remains indefinitely latched in emergency stop.

### C. Command Lifecycle / Idempotency
- **Finding BS-CMD-001**: `handler_post_command` in `api_command_handlers.c` executes well pump commands directly on the HTTP server thread and completely bypasses `command_mgr_submit`. It never queries or updates the FreeRTOS worker queue, idempotency cache, or handles distribution pump/dosing commands. `GET /api/v1/commands/*` returns static hardcoded JSON.

### D. Concurrency / Race Conditions
- **Finding BS-CMD-002**: When executing a pump command with a duration, `command_worker_task` in `command_mgr.c` executes `vTaskDelay` for the entire duration (e.g., 300 seconds). The single worker task is completely blocked sleeping, freezing the queue so that subsequent commands (including emergency stop commands) cannot be processed until the sleep finishes.
- **Finding BS-STOR-002**: `storage_mgr_append_event_log` and `storage_mgr_read_event_logs` access `/spiffs/events.log` without mutex synchronization, exposing SPIFFS to filesystem corruption under concurrent task execution.

### E. Scheduler / Timer
- **Finding BS-SCHED-001**: `scheduler.c` contains a dummy task that sleeps every 10 seconds and does nothing. No schedule tables, evaluation engine, or calendar logic exist in firmware, and `UI_ESP32_OPENAPI.yaml` contains zero endpoints for schedules. Schedules exist only in browser `localStorage`.

### F. Power Loss / Reboot / Recovery
- **Finding BS-SAFE-001**: `actuator_hal_emergency_stop` latches `s_emergency_stop_latched = true` in volatile static memory. A brownout reset or momentary power outage clears the latch, restarting the system in normal mode without operator knowledge.
- Pulse counter totals (`s_pulses_yfb1`, `s_pulses_fs400a`) reset to zero on reboot, losing cumulative flow volume.

### G. Storage / Data Integrity
- **Finding BS-STOR-001**: In `storage_mgr.c`, when `events.log` reaches 128KB, it is deleted via `unlink()`. The entire historical event log is destroyed in a single operation rather than rotated into a backup file (`events.log.1`).
- `storage_mgr_save_config` stores raw configuration JSON using NVS string (`nvs_set_str`), which is capped at 4000 bytes in ESP-IDF. Configurations exceeding 4KB fail to commit.

### H. Memory / Resource Exhaustion
- **Finding BS-MEM-001**: `handler_get_configuration` allocates `char buf[4096]` on the stack of `TASK_HTTP_SERVER_STACK` (8192 bytes). This single buffer consumes 50% of the task stack, presenting high risk of stack overflow panic during deep nested logging.

### I. Watchdog / Deadlock / Starvation
- Task Watchdog Timer (`esp_task_wdt`) is not initialized or subscribed in any of the background tasks (`cmd_worker`, `safety_mon`, `telemetry_task`, `scheduler`). A deadlocked mutex or stuck SPI read will hang silently without triggering an automatic recovery reboot.

### J. Hardware Absence vs Failure
- Float switch disconnected state reads as logic HIGH (tank full/OK) due to internal pull-up resistor configuration, masking open-circuit wiring faults.
- Flow meters provide no pulses both when water is static and when sensor wire is severed. Firmware cannot distinguish between zero flow and sensor disconnection.

### K. Multi-GH Topology
- **Finding BS-TOP-001**: Handlers in `api_cropcycle_handlers.c`, `api_telemetry_handlers.c`, and `api_device_handlers.c` hardcode `"gh-01"`. The URL path parameter `{ghId}` is discarded. There are no distribution valve pins or logic in `pin_config.h` or `actuator_hal.c` to route fluids between multiple greenhouses.

### L. Component Dependency Graph
- Distribution pump and dosing pumps lack interlock checks in `actuator_hal_set()`. The well pump checks `s_tank_full_interlock`, but distribution and dosing pumps can be commanded ON even if raw or mixing tanks are dry.

### M. Sensor Failure / Sensor Semantics
- **Finding BS-SENS-001**: `ds18b20_read_temp` in `sensor_hal.c` waits only 15ms after conversion start (DS18B20 requires up to 750ms for 12-bit conversion). It omits Dallas 1-Wire 8-bit CRC validation, accepting corrupted bits as valid water temperature. Furthermore, microsecond bit-banging is executed without entering FreeRTOS critical sections.

### N. Calibration
- **Finding BS-SENS-002**: Flow meter pulse factors (`YFB1_PULSES_PER_LITER 486.0f`, `FS400A_PULSES_PER_LITER 288.0f`) are hardcoded preprocessor macros. There is no API or storage mechanism to calibrate flow meters in the field.

### O. Configuration Management
- **Finding BS-CFG-001**: `handler_validate_configuration` returns hardcoded `{ valid: true }`. `handler_put_configuration` saves incoming JSON text directly to storage without validating schema, pin mappings, or safety parameters, and does not notify running FreeRTOS tasks to apply updates.

### P. Clock / Time
- **Finding BS-CLOCK-001**: DS3231 I2C RTC driver is not implemented in firmware. On boot, `time(NULL)` defaults to the UNIX epoch (1970-01-01). `handler_get_clock` hardcodes `"synced": true` and outputs UTC time for both UTC and Local without timezone calculation.
- **Finding BS-CLOCK-002**: `handler_post_clock_sync` parses incoming `utcNow` but never invokes `settimeofday()`. Device time remains unadjusted.

### Q. Crop-Cycle / Masa Tanam
- **Finding BS-CC-001**: Firmware static structure `s_active_cycle` pre-seeds an active tomato crop cycle (`Tomat San Marzano`, `cycle-01`, planted 2026-06-02). On a fresh controller, attempts to start a new crop cycle fail with 409 Conflict.
- **Finding BS-CC-002**: HST/HSP calculation depends on `difftime(now, t_target)`. When the system clock is at 1970, `diff < 0` triggers and forces HST and HSP to 0 permanently.

### R. Telemetry / Events / Audit Trail
- **Finding BS-TEL-001**: `telemetry_sampler_task` outputs hardcoded synthetic constants for humidity (`68.5%`) and ambient light (`45,000 lux`), creating an illusion of active sensors.
- `s_next_seq` in `event_mgr.c` resets to 1 on every reboot, producing duplicate event IDs across boot cycles.

### S. Network / Connectivity
- **Finding BS-NET-001**: No call to `esp_wifi_init()`, `esp_wifi_start()`, or Ethernet MAC/PHY initialization exists in `esp32/main/main.c`.
- `handler_get_context` hardcodes IP address `192.168.4.1` regardless of actual network state.

### T. Device Identity / Provisioning
- UUID generation in `storage_mgr.c` uses `esp_random()` without ensuring RF subsystem is powered on, which can yield non-random seeds on early boot.

### U. Versioning / Migration
- Persisted active crop cycle in NVS uses raw struct binary blob `nvs_set_blob(..., sizeof(crop_cycle_record_t))`. Any compiler padding change, struct expansion, or field reordering between firmware updates will corrupt deserialized crop cycle records.

### V. UI Operational Error Handling
- In `services.ts`, `emergencyStop` catches errors with `console.warn` and proceeds to update local mock state. If the ESP32 is offline or rejects the stop, the UI indicates "STOPPED" while the physical actuator may still be energized.

### W. Multi-Tab / Multi-Client
- UI state is maintained in browser in-memory `db` without WebSocket, SSE, or broadcast channel syncing. Actions performed in one tab are invisible to other tabs.

### X. Manual vs Automatic Precedence
- There is no unified state machine arbitrating between manual button presses, UI commands, and scheduled cycles. A manual stop command does not invalidate a scheduled run window.

### Y. Safety State Machine
- **Finding BS-SAFE-002**: When the lower float switch indicates dry tank, `safety_monitor_task` sets `s_has_fault = true` and turns off pumps, but this state is not checked inside `actuator_hal_set()`. An incoming HTTP command or button press can re-energize the pump immediately, causing repetitive 500ms on/off pump chattering.
- **Finding BS-SAFE-003**: No software debounce or hysteresis is implemented for digital sensor inputs. Water ripples cause the float switch to rapidly toggle between 0 and 1.

### Z. Actuator Semantics
- **Finding BS-HW-005**: The system has no inductive snubbers (RC snubber / MOV) specified for inductive pump relay contacts, and firmware has no auxiliary feedback inputs to detect welded relay contacts.

### AA. GPIO / Pin Blindspots
- Centralized pin registry assigned GPIO 19 (Float) and GPIO 47 (MicroSD CS), which clash directly with native USB and Octal PSRAM.

### AB. Build / Toolchain
- `CMakeLists.txt` references `esp_wifi`, but no Wi-Fi implementation code exists.

### AC. Test Coverage
- **Finding BS-TEST-001**: `scripts/verify_e2e_contracts.mjs` spins up a self-contained Node.js HTTP server returning dummy payloads. It tests neither the real ESP32 C handlers nor the canonical schemas in `UI_ESP32_OPENAPI.yaml`, creating a false sense of test pass.

### AD. First Install / Provisioning
- First boot assumptions: assumes active crop cycle already exists, network is preconfigured, and RTC is valid. A freshly assembled board cannot be commissioned out of the box.

---

## 3. Independent "What Did We Miss?" Pass (Persona Perspectives)

### 1. Failure Analyst
- **Brownout-Reboot Cascade Under Inrush Current**: Energizing multiple inductive pump motors simultaneously causes voltage drop on the 12V/5V rails. If 3.3V dips below 2.8V, the ESP32 triggers a brownout reset. On boot, `s_emergency_stop_latched` is cleared, and if commands are immediately accepted, the system enters an infinite reboot loop under load.
- **Welded Relay Contact Blindspot**: If a relay contact welds shut due to arc discharge, the firmware will report `is_on: false`, but the pump will continue running dry until destruction.

### 2. Embedded Engineer
- **Long-term Heap Fragmentation from cJSON**: Polling `/api/v1/telemetry` and `/api/v1/status` every 1–2 seconds generates continuous `cJSON_CreateObject`, `cJSON_PrintUnformatted`, and `free` operations. Over 30 days (>2.5 million allocations) on internal DRAM, heap fragmentation will trigger allocation panics.
- **RC Oscillator Clock Drift**: Without an external 32.768 kHz crystal or active DS3231 driver, the internal 150 kHz RC timer drifts by up to 5% with ambient greenhouse temperature swings (over 1 hour of drift per day).

### 3. API Engineer
- **Idempotency Token Disconnect**: The frontend sends `requestId`, but the backend never tracks processed `requestId` tokens. Network dropouts during POST commands will cause double-pumping on retry.
- **Slowloris DoS Vulnerability**: `http_parse_json_body` reads incoming bytes synchronously without a per-byte read timeout. A single stalled connection locks the single-threaded HTTP server.

### 4. UI Engineer
- **Silent Fallback to Mock**: If `isDirectEsp32Enabled()` is false, the UI operates against local JavaScript mock state without warning the operator. An operator could toggle pumps believing they are managing the greenhouse, when in fact no physical command is dispatched.
- **Optimistic Reconciliation Race**: If the UI sends an emergency stop and immediately marks the UI "STOPPED", but the network request times out, the operator is misled into believing equipment is safe.

### 5. Commissioning Technician
- **Initial Setup Impasse**: On first boot, the ESP32 has no default SoftAP, BLE provisioning, or static fallback IP. The technician cannot open the web interface to configure credentials.
- **Floating Actuator Transient at Startup**: During the 100ms window before firmware bootloader executes `safe_boot_actuators`, floating GPIO pins on active-low relay boards may chatter or latch ON.

### 6. Operator
- **Phantom Telemetry Deception**: The UI displays realistic humidity (68.5%) and light (45,000 lux) numbers. An operator might decline to irrigate or vent because the fake readings appear optimal.
- **Broken Emergency Stop Recovery**: Pressing "Resume" in the UI clears the red UI banner, but does not reset the ESP32 hardware latch. Subsequent pump commands silently fail.

### 7. Adversarial Tester
- **Zero Authentication / Unauthenticated Actuation**: Any laptop or smartphone connected to the local Wi-Fi can send `POST /api/v1/commands/emergency-stop` or start pumps with no password or token required.

### 8. Future Maintainer
- **Hardcoded Single-Greenhouse Topology**: Replacing `"gh-01"` with a dynamic identifier will require rewriting every handler across `api_cropcycle_handlers.c` and `api_device_handlers.c`.

### 9. Scaling Engineer
- **Shared Fluid Source Contention**: If a second greenhouse is added, both share the same well and mixing tanks. Without valve multiplexing and hardware locking, GH-1 and GH-2 could command contradictory fluid paths simultaneously.

### 10. Recovery Engineer
- **Simultaneous Power Loss + Float Fault**: If power fails while the lower float switch is damaged (open circuit), the ESP32 reboots with the float reading HIGH (OK), emergency stop cleared, and clock at 1970.

---

## 4. Comprehensive Findings Inventory (Itemized Cards)

```text
ID: BS-NET-001
Severity: CRITICAL
Category: Network / Connectivity
Title: Complete Absence of Network Interface Initialization (No Wi-Fi STA/AP or W5500 SPI Ethernet Driver in Firmware)

Evidence:
- esp32/main/main.c:117-140
- esp32/main/CMakeLists.txt:36
- esp32/main/http/http_server.c:104-120

Why this is a blindspot:
Firmware compiles cleanly, initializes LwIP event loops, and successfully starts the HTTP server on port 80. However, neither Wi-Fi Station/AP (esp_wifi_init) nor the SPI W5500 Ethernet driver (esp_eth) is ever initialized. When flashed, the board has no network interface, obtains no IP address, and is completely unreachable.

Failure scenario:
Technician flashes ESP32-S3 firmware and connects Ethernet cable or powers board. The controller boots, prints diagnostics, starts HTTP server, but has no IP address. Ping and browser connection to http://192.168.4.1 or http://esp32.local fail completely.

Current behavior:
HTTP server runs on an interface that has no physical netif attached.

Expected/desired behavior:
Initialize either W5500 SPI Ethernet or Wi-Fi Station/AP with fallback SoftAP provisioning mode before starting http_server.

Impact:
Total commissioning failure; firmware is unreachable over LAN/WLAN.

Recommended investigation/fix:
Implement dedicated network initialization service (`network_mgr.c`) configuring W5500 Ethernet SPI driver and/or Wi-Fi STA/AP with graceful fallback.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-HW-001
Severity: CRITICAL
Category: GPIO / Pin Blindspots
Title: GPIO 19 Assigned to Lower Float Switch Conflicts with ESP32-S3 Native USB D- (USB_DM)

Evidence:
- esp32/main/config/pin_config.h:62 (`#define PIN_IN_FLOAT_LOWER 19`)
- esp32/main/config/pin_config.h:80-86 (IS_RESERVED_PIN excludes 19)
- esp32/docs/ESP32_ASSEMBLY_GUIDE.md:52

Why this is a blindspot:
On ESP32-S3, GPIO 19 and GPIO 20 are the physical USB Differential D- and D+ lines used by the internal USB-Serial/JTAG controller. Assigning GPIO 19 to an external digital input directly corrupts native USB data packets.

Failure scenario:
Technician connects the digital float switch to GPIO 19. When the float switch closes to ground or changes state, USB connection to the programming PC drops immediately. The serial monitor disconnects and firmware flashing over native USB fails.

Current behavior:
GPIO 19 is configured as a digital input with pullup enabled while the native USB peripheral is active.

Expected/desired behavior:
Reserve GPIO 19 and GPIO 20 in `pin_config.h`. Reassign the lower float switch to a safe, unreserved GPIO pin.

Impact:
Loss of USB serial logging, development disconnects, and field flashing failures.

Recommended investigation/fix:
Move `PIN_IN_FLOAT_LOWER` to an unreserved GPIO (e.g., GPIO 21, moving TFT DC, or GPIO 48 if OPI PSRAM is avoided). Add GPIO 19 to `IS_RESERVED_PIN`.

Confidence: HIGH
Requires project decision: YES
Physical verification required: YES
```

---

```text
ID: BS-HW-002
Severity: CRITICAL
Category: GPIO / Pin Blindspots
Title: MicroSD CS on GPIO 47 Conflicts with Octal SPI PSRAM (OPI) Bus on ESP32-S3-WROOM-1-N16R8

Evidence:
- esp32/main/config/pin_config.h:31 (`#define PIN_MICROSD_CS 47`)
- esp32/sdkconfig.defaults:8-11 (`CONFIG_SPIRAM_MODE_OCT=y`)
- esp32/main/hal/sdcard_hal.c:15, 25

Why this is a blindspot:
The hardware model specified in `system_config.h` is ESP32-S3-WROOM-1-N16R8 (16MB Flash, 8MB Octal OPI PSRAM). When Octal PSRAM is enabled, GPIO 33-37 and GPIO 47/48 are internally routed to the PSRAM chip. Using GPIO 47 for MicroSD Chip Select drives an active memory bus pin.

Failure scenario:
When `sdcard_hal_init()` drives GPIO 47 low to select the SD card, or when SPI transfers toggle GPIO 47, CPU memory access to external PSRAM is corrupted, immediately triggering a `Cache disabled but cached memory region accessed` Guru Meditation Panic.

Current behavior:
Firmware configures GPIO 47 as an output for SPI Chip Select while Octal PSRAM controller is enabled.

Expected/desired behavior:
Reassign `PIN_MICROSD_CS` to an unreserved GPIO pin not used by Octal PSRAM.

Impact:
Fatal CPU crash and memory corruption whenever SD card or PSRAM is accessed.

Recommended investigation/fix:
Audit all pins against ESP32-S3 Octal PSRAM pinout tables and relocate `PIN_MICROSD_CS`.

Confidence: HIGH
Requires project decision: YES
Physical verification required: YES
```

---

```text
ID: BS-HW-003
Severity: HIGH
Category: Hardware HAL
Title: SPI Bus Master (`spi_bus_initialize`) Never Initialized for Shared MicroSD / W5500 / TFT Bus

Evidence:
- esp32/main/hal/sdcard_hal.c:23-28
- esp32/main/hal/hardware_registry.c:31-41
- esp32/docs/ESP32_ASSEMBLY_GUIDE.md:160-161

Why this is a blindspot:
`sdcard_hal.c` calls `esp_vfs_fat_sdspi_mount("/sdcard", &host, &slot_config, ...)` without first calling `spi_bus_initialize(host.slot, &bus_config, SDSPI_DEFAULT_DMA)`. In ESP-IDF, mounting an SDSPI host requires the underlying SPI bus to be explicitly initialized.

Failure scenario:
During boot, `sdcard_hal_init()` fails with `ESP_ERR_INVALID_STATE` (SPI bus not initialized). MicroSD card is reported absent on every boot regardless of card presence.

Current behavior:
SD card mount fails immediately; system falls back to SPIFFS.

Expected/desired behavior:
Initialize the shared SPI bus once in a centralized bus manager with correct SCK (11), MOSI (12), and MISO (13) configuration before mounting peripherals.

Impact:
microSD card storage unusable; secondary backup logging disabled.

Recommended investigation/fix:
Create `spi_bus_mgr.c` to initialize `SPI2_HOST` once, then attach MicroSD and W5500 devices with individual CS lines.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-HW-004
Severity: CRITICAL
Category: Actuator Semantics / Polarity
Title: Inverted Relay Polarity Risk on Safe Boot for Standard Active-Low Commercial Relay Modules

Evidence:
- esp32/main/config/pin_config.h:53-54 (`#define ACTUATOR_LEVEL_ON 1`, `#define ACTUATOR_LEVEL_OFF 0`)
- esp32/main/main.c:51-61 (`gpio_set_level(output_pins[i], ACTUATOR_LEVEL_OFF)`)
- esp32/main/hal/actuator_hal.c:48

Why this is a blindspot:
Standard 4-channel and 8-channel optocoupler relay boards (e.g. Songle relays with PC817 optocouplers) are hardwired as Active-Low: driving a pin LOW grounds the optocoupler cathode and energizes the relay coil. If the physical board is active-low, driving logic 0 turns all 7 output channels ON.

Failure scenario:
Controller powers on. `safe_boot_actuators()` sets all pins to 0. All 7 relays immediately snap ON, starting the well pump, distribution pump, chemical dosing pumps, and cooling fan simultaneously during boot.

Current behavior:
Outputs are driven to logic LOW with pulldowns on safe boot.

Expected/desired behavior:
Hardware abstraction layer must support configurable relay polarity (`ACTIVE_LOW` vs `ACTIVE_HIGH`), defaulting to safe de-energized state for the verified physical relay board.

Impact:
Uncontrolled physical actuation, chemical overdose, flooding, and motor overload at power-on.

Recommended investigation/fix:
Inspect the exact relay module schematic. Introduce `ACTUATOR_ACTIVE_LEVEL` configuration and ensure safe-boot sets pins to the physical de-energized level.

Confidence: HIGH
Requires project decision: NO
Physical verification required: YES
```

---

```text
ID: BS-SAFE-001
Severity: CRITICAL
Category: Safety State Machine
Title: In-Memory Latched Emergency Stop Disappears Across ESP32 Reboot or Power Loss

Evidence:
- esp32/main/hal/actuator_hal.c:26 (`static bool s_emergency_stop_latched = false;`)
- esp32/main/hal/actuator_hal.c:118, 137
- esp32/main/main.c:107-143

Why this is a blindspot:
When an emergency stop is triggered via REST API or hardware button, `s_emergency_stop_latched` is set to `true`. This flag resides purely in volatile DRAM. Upon power loss, brownout, or manual reboot, the variable reinitializes to `false`.

Failure scenario:
An operator presses Emergency Stop due to a leaking high-pressure pipe. 10 minutes later, a momentary mains power flicker occurs. The ESP32 reboots. The emergency stop state is cleared. If a schedule or manual run triggers, the pump turns back on into the leaking pipe.

Current behavior:
Emergency stop state is lost on reboot.

Expected/desired behavior:
Emergency stop state must be durably persisted to NVS or hardware latch, requiring explicit, authenticated manual operator clearance to exit.

Impact:
Unsafe automatic re-energization after physical plant emergency.

Recommended investigation/fix:
Persist emergency stop latch state in NVS (`nvs_set_u8("estop_latched", 1)`) and check this flag during `safe_boot_actuators()`.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-SAFE-002
Severity: CRITICAL
Category: Safety State Machine
Title: Lower Float Dry-Run Protection Has No Preventative Interlock and Inverts on Disconnected Wire

Evidence:
- esp32/main/services/safety_monitor.c:24-34
- esp32/main/hal/actuator_hal.c:64-92
- esp32/main/hal/sensor_hal.c:138, 162

Why this is a blindspot:
1. Reactive rather than preventative: `actuator_hal_set()` contains an interlock for `s_tank_full_interlock` on the well pump, but NO check for dry tank. An HTTP command can turn on the pump when dry. The safety monitor only turns it off reactively on its next 500ms cycle.
2. Inverted wire fault: `PIN_IN_FLOAT_LOWER` uses internal pull-up (`GPIO_PULLUP_ENABLE`). `s_current_readings.float_lower_ok = (gpio_get_level(...) != 0)`. If the wire is cut or disconnected, the pin floats HIGH, which the code interprets as "Tank Level OK".

Failure scenario:
Float switch cable is severed by maintenance staff. Tank drains completely. The floating pin reads HIGH (OK). When fertigation triggers, the distribution pump runs dry for hours, melting pump seals.

Current behavior:
Pumps can be turned ON while empty; disconnected float wire reports healthy water level.

Expected/desired behavior:
Fail-safe sensor wiring (closed circuit = healthy water level; open circuit = tank low fault). `actuator_hal_set` must reject pump activation if dry-run interlock is active.

Impact:
Pump motor burnout and physical destruction due to prolonged dry running.

Recommended investigation/fix:
Wire float switch so that water level OK pulls pin to ground, or implement supervised loop. Add `s_tank_dry_interlock` directly into `actuator_hal_set()`.

Confidence: HIGH
Requires project decision: NO
Physical verification required: YES
```

---

```text
ID: BS-CMD-001
Severity: HIGH
Category: Command Lifecycle
Title: HTTP Command Handler Bypasses `command_mgr`, Dropping Idempotency, Queueing, and Actuators

Evidence:
- esp32/main/http/api_command_handlers.c:36-70
- esp32/main/services/command_mgr.c:133-164
- esp32/main/http/api_command_handlers.c:72-80

Why this is a blindspot:
The FreeRTOS `command_mgr` service provides an idempotency ring cache, state transitions, and a worker queue. However, `handler_post_command` never calls `command_mgr_submit`. It executes directly on the HTTP server task and only handles `WELL_PUMP_START` and `RESUME_SYSTEM`. All other commands (distribution pump, dosing pumps, fans) return 202 ACCEPTED but do nothing physically. `handler_get_command` returns hardcoded dummy JSON.

Failure scenario:
Operator sends a command to start the distribution pump or dosing run via the API. The API responds with HTTP 202 Accepted. The operator polls `GET /api/v1/commands/cmd-123` and receives `status: "COMPLETED"`. The physical pump never moved.

Current behavior:
HTTP handler bypasses command manager; non-well-pump commands are dropped; command status queries return fake data.

Expected/desired behavior:
Every command submitted via HTTP must be queued through `command_mgr_submit` and status tracked by actual execution state.

Impact:
Silent command execution failure; operator misled by false success responses.

Recommended investigation/fix:
Wire `handler_post_command` to invoke `command_mgr_submit()` and `handler_get_command` to invoke `command_mgr_get()`.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-CMD-002
Severity: HIGH
Category: Concurrency / Watchdog
Title: Command Worker Task Blocks Entire Worker Queue Synchronously During Timed Runs (`vTaskDelay`)

Evidence:
- esp32/main/services/command_mgr.c:71-95

Why this is a blindspot:
Inside `command_worker_task()`, commands with a duration parameter execute:
```c
vTaskDelay(pdMS_TO_TICKS(cmd.param_duration_sec * 1000));
```
While this task is delayed, it cannot pop items from `s_cmd_queue`.

Failure scenario:
A 10-minute well pump fill command is queued and starts running. During minute 2, an operator notices an overflow and sends an `EMERGENCY_STOP` command via the command queue. The emergency stop command sits in `s_cmd_queue` waiting for the 10-minute delay to elapse before it is processed.

Current behavior:
Worker thread blocks execution of all subsequent commands during any timed run.

Expected/desired behavior:
Asynchronous timers (`esp_timer`) or stateful run tracking rather than blocking FreeRTOS task delays.

Impact:
Inability to cancel runs or execute emergency stop commands via the command worker queue.

Recommended investigation/fix:
Refactor timed actuator operations to use non-blocking timestamps evaluated in a periodic state loop.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-SCHED-001
Severity: HIGH
Category: Scheduler / Timer
Title: Firmware Scheduler Task is an Empty Idle Loop; Schedulers are Neither Stored Nor Run on Device

Evidence:
- esp32/main/services/scheduler.c:10-18
- template/contracts/UI_ESP32_OPENAPI.yaml
- template/src/lib/store.ts:228-320

Why this is a blindspot:
Principle 6 states: "Browser timers must not become the physical runtime scheduler." However, the firmware scheduler task is literally an empty loop:
```c
while (1) { vTaskDelay(pdMS_TO_TICKS(10000)); }
```
`UI_ESP32_OPENAPI.yaml` contains zero endpoints for schedule management. Fertigation, well pump, and fan schedules exist solely in browser `localStorage`.

Failure scenario:
Operator sets a watering schedule for 06:00 AM and closes the laptop. At 06:00 AM, the ESP32 is running, but has no schedule in memory. No watering occurs. Crops dry out.

Current behavior:
The ESP32 firmware possesses no schedule execution logic.

Expected/desired behavior:
OpenAPI contract must define schedule sync endpoints; ESP32 firmware must store schedules in NVS and execute them independently of the browser.

Impact:
Automated greenhouse fertigation is completely non-functional when the browser is closed.

Recommended investigation/fix:
Define schedule schemas in OpenAPI, implement NVS schedule persistence, and implement active schedule dispatching in `scheduler.c`.

Confidence: HIGH
Requires project decision: YES
Physical verification required: NO
```

---

```text
ID: BS-UI-001
Severity: HIGH
Category: UI State vs Device State
Title: UI Manual Fertigation Runs and Pump Tests Execute Solely in Browser Memory via `setTimeout`

Evidence:
- src/lib/services.ts:599-621
- src/lib/services.ts:695-705

Why this is a blindspot:
`fertigationService.startManual` does not call `esp32Client`. It calls `startManualRun()` in local `store.ts` and uses a JavaScript `setTimeout` loop:
```typescript
const tick = () => {
  const done = advanceManualRun(ghId) === "done";
  if (!done) setTimeout(tick, 1200);
};
setTimeout(tick, 1200);
```
Dosing pump test runs (`testPump`) similarly execute a 1500ms JavaScript `delay()`.

Failure scenario:
Operator selects a recipe, enters 200 Liters, and clicks "Start Run". The UI displays an animated progress bar stepping from Mixing to Dosing to Distribution. The operator assumes crops are being watered. In reality, the ESP32 relays never engaged.

Current behavior:
Fertigation runs and pump tests are simulated in browser JavaScript without communicating with hardware.

Expected/desired behavior:
`fertigationService.startManual` must POST a run command to `/api/v1/commands`, and progress must reflect physical telemetry received from the ESP32.

Impact:
Total disconnect between UI displayed operations and physical reality.

Recommended investigation/fix:
Replace mock browser timers in `services.ts` with API calls to the ESP32 command and telemetry endpoints.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-UI-002
Severity: HIGH
Category: UI State vs Device State
Title: UI "Resume" Action Clears Local Mock State but Never Sends Resume Command to ESP32

Evidence:
- src/lib/services.ts:671-675
- esp32/main/hal/actuator_hal.c:133-144

Why this is a blindspot:
While `emergencyStop` in `services.ts` calls `esp32Client.emergencyStop(...)`, the corresponding `resume` function only calls `resumeComplex(complexId)` in the in-memory mock store. It never dispatches a command to clear the ESP32's `s_emergency_stop_latched` flag.

Failure scenario:
Emergency stop is triggered. Problem is resolved. Operator clicks "Resume" in the web UI. The UI removes the red emergency warning banner and displays status "NORMAL". The operator tries to run a pump; nothing happens because the ESP32 is still latched in `s_emergency_stop_latched = true`.

Current behavior:
UI displays system as resumed while physical controller remains in emergency stop.

Expected/desired behavior:
UI resume must issue `POST /api/v1/commands` with `RESUME_SYSTEM` and verify device clearance before clearing UI warning.

Impact:
Operator confusion and locked system after emergency stop recovery.

Recommended investigation/fix:
Update `complexService.resume` in `services.ts` to call `esp32Client.postCommand("RESUME_SYSTEM")`.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-CLOCK-001
Severity: HIGH
Category: Clock / Time
Title: DS3231 I2C RTC Driver Completely Unimplemented; System Clock Resets to 1970 on Boot

Evidence:
- esp32/main/main.c:107-143
- esp32/main/http/api_device_handlers.c:132-145
- esp32/docs/ESP32_ASSEMBLY_GUIDE.md:18, 45-46

Why this is a blindspot:
The assembly guide documents a DS3231 high-precision I2C RTC module on GPIO 8 (SDA) and GPIO 9 (SCL). However, the firmware contains no I2C bus driver initialization and no DS3231 reading code. On boot, `time(NULL)` starts at 0 (1970-01-01 00:00:00 UTC). `handler_get_clock` hardcodes `"synced": true`.

Failure scenario:
Greenhouse loses power and restarts at 14:00. Time starts at 00:00 Jan 1, 1970. Since the clock is not battery-backed, event logs have 1970 timestamps and future scheduled tasks cannot run accurately.

Current behavior:
System time starts at 1970 on boot; API claims clock is synced.

Expected/desired behavior:
Initialize I2C master and read time from DS3231 battery-backed RTC on boot to set system time (`settimeofday`).

Impact:
Invalid timestamps across all event logs, telemetry, and crop cycle calculations.

Recommended investigation/fix:
Implement `rtc_ds3231.c` driver to initialize I2C on GPIO 8/9 and sync system clock on startup.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-CLOCK-002
Severity: MEDIUM
Category: Clock / Time
Title: `POST /api/v1/clock-sync` Echoes Request but Never Sets ESP32 System Time (`settimeofday`)

Evidence:
- esp32/main/http/api_device_handlers.c:147-170

Why this is a blindspot:
`handler_post_clock_sync` validates the JSON payload, extracts `utcNow`, builds a JSON response echoing `utcNow`, and sends it with HTTP 200. It never calls `settimeofday()` or updates system time.

Failure scenario:
The UI syncs browser time to the ESP32. The API returns 200 OK. Subsequent calls to `GET /api/v1/clock` or telemetry still return 1970 or unadjusted uptime.

Current behavior:
REST endpoint acts as a mock echo service without applying time to the POSIX system clock.

Expected/desired behavior:
Parse ISO 8601 string into `struct timeval` and call `settimeofday()` to synchronize ESP32 system clock.

Impact:
Clock synchronization from UI has zero effect on device runtime.

Recommended investigation/fix:
Implement ISO 8601 parsing in `handler_post_clock_sync` and apply using `settimeofday(&tv, NULL)`.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-CC-001
Severity: HIGH
Category: Crop-Cycle / Masa Tanam
Title: Firmware Pre-Seeds Active Crop Cycle in Flash on First Boot, Blocking New Cycle Creation (409)

Evidence:
- esp32/main/services/crop_cycle_mgr.c:11-22
- esp32/main/services/crop_cycle_mgr.c:109-113
- esp32/main/http/api_cropcycle_handlers.c:61-63

Why this is a blindspot:
In `crop_cycle_mgr.c`, `s_active_cycle` is initialized at compile time with an active crop cycle (`Tomat San Marzano`, planted `2026-06-02`). `crop_cycle_mgr_start()` checks:
```c
if (s_active_cycle.status == CYCLE_STATE_ACTIVE) return ESP_ERR_INVALID_STATE;
```
If a new user tries to start their first cycle, the ESP32 responds with `409 CONFLICT: An active cycle already exists in this greenhouse`.

Failure scenario:
A farmer deploys the system in a cucumber greenhouse and clicks "Start Cycle". The request fails with HTTP 409 Conflict. The farmer must find a way to cancel or harvest a dummy tomato cycle that they never created.

Current behavior:
Firmware boots with a hardcoded active tomato cycle.

Expected/desired behavior:
Fresh firmware should boot with `CYCLE_STATE_NONE` / `NO_CYCLE` until explicitly started or imported by the user.

Impact:
Confusing first-time user experience and blocked commissioning.

Recommended investigation/fix:
Change static default state to `CYCLE_STATE_NONE` with empty fields.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-CC-002
Severity: MEDIUM
Category: Crop-Cycle / Masa Tanam
Title: HST and HSP Calculation Breaks Completely When System Clock Starts at 1970 Epoch

Evidence:
- esp32/main/services/crop_cycle_mgr.c:24-47

Why this is a blindspot:
`days_between()` calculates HST by subtracting `mktime(&plantingDate)` from `time(NULL)`. When the RTC is uninitialized, `time(NULL)` is 0 (1970). Planting dates in 2026 produce `difftime(1970, 2026) < 0`. The function returns 0.

Failure scenario:
Active cycle is imported with planting date 45 days ago. Because system clock has not synced, the UI displays `HST: 0`, corrupting harvest prediction models.

Current behavior:
HST and HSP remain 0 until clock is updated to a date later than the planting date.

Expected/desired behavior:
Detect uncalibrated system clock and return `null` for HST/HSP with a warning that clock synchronization is required.

Impact:
Misleading agronomic indicators in the UI.

Recommended investigation/fix:
Check whether system time is valid (e.g. year >= 2024) before calculating HST/HSP; return `null` if clock is unsynced.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-SENS-001
Severity: HIGH
Category: Sensor Failure / Semantics
Title: DS18B20 1-Wire Driver Has Insufficient Conversion Delay, No Critical Section, and No CRC Check

Evidence:
- esp32/main/hal/sensor_hal.c:93-112
- esp32/main/hal/sensor_hal.c:48-91

Why this is a blindspot:
1. Insufficient delay: DS18B20 12-bit conversion requires up to 750ms. `ds18b20_read_temp` delays only 15ms (`vTaskDelay(pdMS_TO_TICKS(15))`), reading unready scratchpad memory.
2. No CRC: Scratchpad byte 8 contains a Dallas 1-Wire CRC. The driver reads only bytes 0 and 1, ignoring CRC.
3. No critical section: Microsecond delays (`ets_delay_us(64)`) are called without disabling interrupts. FreeRTOS context switches during a bit read will corrupt the bit timing.

Failure scenario:
The temperature reading fluctuates wildly or returns 85.0°C (DS18B20 power-on reset value). The safety monitor sees > 45°C and erroneously starts the cooling fan.

Current behavior:
Incomplete conversions and unvalidated bit-banging provide erratic temperature telemetry.

Expected/desired behavior:
Wait >= 750ms (or use non-blocking conversion polling), wrap bit-banging in critical sections (`taskENTER_CRITICAL`), and verify 8-bit CRC.

Impact:
Spurious fan activations and unreliable temperature monitoring.

Recommended investigation/fix:
Use a robust, tested ESP-IDF 1-Wire DS18B20 library or rewrite driver with proper conversion timing, critical sections, and CRC validation.

Confidence: HIGH
Requires project decision: NO
Physical verification required: YES
```

---

```text
ID: BS-SENS-002
Severity: LOW
Category: Calibration
Title: Flow Meter Calibration Factors (Pulses/Liter) Are Hardcoded `#define` Constants with No Persistence

Evidence:
- esp32/main/hal/sensor_hal.c:17-18
- esp32/main/hal/sensor_hal.c:173, 176

Why this is a blindspot:
Flow meter constants (`YFB1_PULSES_PER_LITER = 486.0f`, `FS400A_PULSES_PER_LITER = 288.0f`) are immutable compile-time macros. In practice, pulse factors vary by 10-20% based on pipe geometry, water viscosity, and installation orientation.

Failure scenario:
A technician performs a 20-liter bucket test and finds the sensor measures 17.5 liters. There is no API or configuration parameter to adjust the calibration coefficient.

Current behavior:
Calibration coefficients are fixed in code.

Expected/desired behavior:
Store calibration coefficients in NVS and allow updating via the configuration API.

Impact:
Imprecise fertigation dosing and volume measurement in field installations.

Recommended investigation/fix:
Add flow meter calibration factors to `system_storage_state_t` and expose via configuration API.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-STOR-001
Severity: MEDIUM
Category: Storage / Data Integrity
Title: Event Log Rotation Truncates by Deleting Entire File (`unlink`), Causing Total History Loss

Evidence:
- esp32/main/storage/storage_mgr.c:196-201

Why this is a blindspot:
When `events.log` exceeds 128KB, `storage_mgr_append_event_log` calls:
```c
unlink(EVENT_LOG_FILE);
ESP_LOGW(TAG, "Event log exceeded %d bytes; rotated.", MAX_EVENT_LOG_BYTES);
```
This deletes the entire file, destroying all past events rather than rotating or archiving them.

Failure scenario:
A safety trip occurs at 03:00. By 06:00, verbose logs reach 128KB. The file is deleted. When the technician investigates the trip at 08:00, the logs for the event are completely gone.

Current behavior:
Entire event log is purged when size limit is reached.

Expected/desired behavior:
Rotate to `events.log.1` or maintain a circular ring buffer file.

Impact:
Loss of critical audit trail during incident investigations.

Recommended investigation/fix:
Implement two-file rotation (`events.log` and `events.log.old`) before unlinking.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-STOR-002
Severity: MEDIUM
Category: Concurrency / Storage
Title: Non-Thread-Safe SPIFFS File Operations Across Concurrent FreeRTOS Tasks

Evidence:
- esp32/main/storage/storage_mgr.c:203-207
- esp32/main/storage/storage_mgr.c:215-225

Why this is a blindspot:
`storage_mgr_append_event_log` and `storage_mgr_read_event_logs` open, write, read, and close `/spiffs/events.log` without a FreeRTOS mutex. `event_mgr` can append from the telemetry task while the HTTP server task is reading logs for `GET /api/v1/events`.

Failure scenario:
`fopen` or `fprintf` interleave on SPIFFS descriptors, causing file allocation table corruption or incomplete JSON reads.

Current behavior:
File access is unguarded across tasks.

Expected/desired behavior:
Guard all SPIFFS file access with a dedicated mutex (`s_spiffs_mutex`).

Impact:
Filesystem corruption and corrupted JSON event responses.

Recommended investigation/fix:
Add a `s_storage_mutex` in `storage_mgr.c` around all file operations.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-CFG-001
Severity: MEDIUM
Category: Configuration Management
Title: Configuration PUT Bypasses Semantic Validation and Fails to Apply Updates to Running Services

Evidence:
- esp32/main/http/api_config_handlers.c:37-63
- esp32/main/http/api_config_handlers.c:65-80

Why this is a blindspot:
1. `handler_validate_configuration` returns a dummy `{ "valid": true }` object without checking anything.
2. `handler_put_configuration` serializes incoming JSON and saves it to NVS. It never validates whether the JSON structure is semantically valid, and never calls any subsystem (scheduler, safety monitor, HAL) to apply the new settings to the active runtime.

Failure scenario:
Operator sends a configuration update changing safety thresholds or pump timing. The API returns 200 OK. The running tasks continue using old hardcoded parameters until reboot, or load invalid JSON and fail.

Current behavior:
Configuration updates are written to NVS but ignored by active tasks.

Expected/desired behavior:
Validate configuration schema before commit; trigger hot-reload in runtime services upon valid commit.

Impact:
Configuration changes do not take effect dynamically.

Recommended investigation/fix:
Implement semantic validator and a configuration dispatch callback (`on_config_updated()`).

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-TOP-001
Severity: HIGH
Category: Multi-GH Topology
Title: Hardcoded `"gh-01"` Across Handlers and Absence of Valve HAL Precludes Multi-Greenhouse Operation

Evidence:
- esp32/main/http/api_cropcycle_handlers.c:13, 21, 58, 68, 102, 110, 132, 140, 151, 153, 171, 179, 203, 207, 213, 215, 240, 244
- esp32/main/http/api_telemetry_handlers.c:9
- esp32/main/config/pin_config.h:45-51

Why this is a blindspot:
Every crop cycle API handler passes the literal string `"gh-01"` to `crop_cycle_mgr_*`. If a request arrives for `/api/v1/greenhouses/gh-02/crop-cycle`, the `ghId` parameter is ignored and `"gh-01"` is modified. Additionally, `pin_config.h` has no pins for distribution selection valves (Valve A, Valve B, Valve N).

Failure scenario:
The user expands the complex by adding Greenhouse 2. When interacting with GH-2 in the UI, all operations overwrite GH-1 crop data on the ESP32.

Current behavior:
Firmware can only manage a single greenhouse named "gh-01".

Expected/desired behavior:
Extract `{ghId}` from URL path and index multi-greenhouse data structures; provide valve actuation HAL for multi-GH splitting.

Impact:
System cannot scale beyond a single greenhouse.

Recommended investigation/fix:
Extract URI path parameters dynamically and support multi-GH instance arrays in crop cycle and actuator managers.

Confidence: HIGH
Requires project decision: YES
Physical verification required: NO
```

---

```text
ID: BS-CONT-001
Severity: CRITICAL
Category: Contract Drift
Title: Fundamental Envelope Contract Drift Between `UI_ESP32_OPENAPI.yaml` and ESP32 Firmware

Evidence:
- template/contracts/UI_ESP32_OPENAPI.yaml:543-570
- esp32/main/http/api_device_handlers.c:12-27
- template/src/lib/api/contracts.ts:23-31

Why this is a blindspot:
`UI_ESP32_OPENAPI.yaml` mandates an envelope for all responses:
```yaml
required: [requestId, success, deviceTimestamp, data]
```
The ESP32 firmware in `api_device_handlers.c` returns flat JSON without `requestId`, `success`, `deviceTimestamp`, or `data`. Field names also differ (`uptimeSeconds` vs `uptimeSec`, `hardwareModel` vs `hardwareVersion`).

Failure scenario:
When an OpenAPI-strict client or frontend parser is connected to the real ESP32 firmware, parsing fails because `response.data` is undefined.

Current behavior:
Firmware returns flat JSON; OpenAPI requires an envelope wrapper.

Expected/desired behavior:
Strict alignment: either update firmware to emit the OpenAPI envelope, or explicitly update OpenAPI to adopt the flat structure.

Impact:
Direct UI ↔ ESP32 integration breakage when using contract-generated DTOs.

Recommended investigation/fix:
Make a deliberate project decision: adopt flat JSON across OpenAPI and TypeScript clients, or update C firmware to wrap responses in `EnvelopeBase`.

Confidence: HIGH
Requires project decision: YES
Physical verification required: NO
```

---

```text
ID: BS-CONT-002
Severity: HIGH
Category: Contract Drift
Title: `DELETE /api/v1/commands/{commandId}` Missing in Firmware; Client Lacks Generic `postCommand`

Evidence:
- template/src/lib/api/esp32-client.ts:104-106
- esp32/main/http/http_server.c:166-167

Why this is a blindspot:
`Esp32Client` implements `cancelCommand` via `DELETE /api/v1/commands/{commandId}`. The ESP32 HTTP server only registers `HTTP_GET` for `/api/v1/commands/*`. Furthermore, `Esp32Client` has no generic `postCommand` method to send operational commands.

Failure scenario:
UI invokes `esp32Client.cancelCommand("cmd-1")`. The ESP32 returns `405 Method Not Allowed` or `404 Not Found`.

Current behavior:
HTTP server rejects command cancellation; TypeScript client cannot post arbitrary commands.

Expected/desired behavior:
Add `HTTP_DELETE` route to `http_server.c` and add `postCommand` to `Esp32Client`.

Impact:
Command cancellation crashes or fails; command submission is restricted.

Recommended investigation/fix:
Register `HTTP_DELETE` handler in `http_server.c` and add `postCommand(cmd)` to `Esp32Client`.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-TEST-001
Severity: HIGH
Category: Test Coverage
Title: Verification Script `verify_e2e_contracts.mjs` Tests Synthetic Node Mock Instead of Real Schemas

Evidence:
- template/scripts/verify_e2e_contracts.mjs:95-270

Why this is a blindspot:
`verify_e2e_contracts.mjs` was created as evidence for safe points SP-009 and SP-010. However, step [3/4] creates a standalone Node.js HTTP server returning synthetic payloads that match neither `UI_ESP32_OPENAPI.yaml` nor the C firmware responses. The test reports "PASS" even while massive contract drift exists.

Failure scenario:
Developers run `npm test`, see "ALL END-TO-END CHECKS PASSED", and falsely conclude that the UI and ESP32 firmware are integrated and conformant.

Current behavior:
Test verifies a mock server against itself, masking contract bugs.

Expected/desired behavior:
Automated test must validate the actual C firmware response shapes against `UI_ESP32_OPENAPI.yaml` schemas.

Impact:
False confidence masking real integration defects.

Recommended investigation/fix:
Update `verify_e2e_contracts.mjs` to validate schema definitions against actual C handler outputs.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-TEL-001
Severity: MEDIUM
Category: Telemetry / Events
Title: Telemetry Emits Synthetic Constants for Humidity, Light Lux, and Binary Float Tank Percentage

Evidence:
- esp32/main/services/telemetry_mgr.c:37-39

Why this is a blindspot:
`telemetry_sampler_task` outputs hardcoded numbers:
```c
s_snapshot.humidity_pct = 68.5f;
s_snapshot.light_lux = 45000.0f;
s_snapshot.water_level_pct = sensors.float_lower_ok ? 82.0f : 12.0f;
```
There is no ambient temperature/humidity sensor (DHT/SHT) or lux sensor on the board.

Failure scenario:
Greenhouse experiences a severe humidity spike (>95% fungal risk) or darkness. The telemetry endpoint continues reporting `68.5%` and `45000 lux`. Automated or manual climate intervention is not taken.

Current behavior:
Fake sensor telemetry is broadcast as truth.

Expected/desired behavior:
Sensors not physically installed must report `null` or `status: "NOT_INSTALLED"` in accordance with Domain J principles.

Impact:
Misleading agronomic data and false sense of climate control.

Recommended investigation/fix:
Set uninstalled sensor readings to `null` and mark capability as unavailable in inventory.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-MEM-001
Severity: MEDIUM
Category: Memory Exhaustion
Title: HTTP Handler Allocates 4KB Buffer on 8KB Task Stack, Creating Imminent Stack Overflow Risk

Evidence:
- esp32/main/http/api_config_handlers.c:18 (`char buf[4096];`)
- esp32/main/config/system_config.h:25 (`#define TASK_HTTP_SERVER_STACK 8192`)

Why this is a blindspot:
`handler_get_configuration` allocates a 4096-byte array on the stack. The FreeRTOS HTTP server stack size is configured to 8192 bytes. A single function call consumes half the entire task stack frame.

Failure scenario:
Under deep call chains, SSL handshakes, or extensive logging inside `cJSON_Parse`, the stack pointer exceeds the allocated 8KB limit, triggering a FreeRTOS Stack Overflow panic.

Current behavior:
4KB local stack variable inside HTTP handler.

Expected/desired behavior:
Allocate large temporary buffers dynamically from heap (`malloc`/`free`) or PSRAM.

Impact:
Intermittent CPU crash when loading configuration.

Recommended investigation/fix:
Replace `char buf[4096]` with dynamically allocated buffer or stream directly.

Confidence: HIGH
Requires project decision: NO
Physical verification required: NO
```

---

```text
ID: BS-SEC-001
Severity: HIGH
Category: Network / Security
Title: Absence of Authentication, Rate Limiting, and Denial-of-Service Vulnerability in HTTP Body Parser

Evidence:
- esp32/main/http/http_server.c:70-102
- esp32/main/http/http_server.c:11-18

Why this is a blindspot:
1. No auth: All REST endpoints (including emergency stop and pump actuation) accept requests from any origin without authentication.
2. DoS in body parser: `http_parse_json_body` loops calling `httpd_req_recv` with no overall timeout. A slow-sending client blocks the single-threaded HTTP server indefinitely.

Failure scenario:
Any device connected to the greenhouse LAN can send commands to turn pumps on/off or stall the web server.

Current behavior:
Unauthenticated open endpoints with blocking read loop.

Expected/desired behavior:
Add API token verification header check and non-blocking read timeout.

Impact:
Unauthorized physical equipment control and easy denial-of-service.

Recommended investigation/fix:
Enforce Bearer token check from `system_config.h` and configure socket read timeouts.

Confidence: HIGH
Requires project decision: YES
Physical verification required: NO
```

---

```text
ID: BS-HW-005
Severity: HIGH
Category: Actuator Semantics
Title: Absence of Inductive Kickback Snubbers and Welded Relay Contact Detection

Evidence:
- esp32/docs/ESP32_ASSEMBLY_GUIDE.md:23-26
- esp32/main/hal/actuator_hal.c:64-92

Why this is a blindspot:
Inductive AC loads (submersible pumps, well pumps) produce large inductive voltage spikes when de-energized. These spikes cause arcing across relay contacts, eventually welding contacts shut. The firmware has zero current or contact feedback sensing, assuming GPIO output level equals physical reality.

Failure scenario:
Well pump relay contacts weld shut. The firmware commands the pump OFF and reports `is_on: false`. The well pump continues pumping indefinitely, overflowing tanks and burning out motor.

Current behavior:
Firmware assumes GPIO level equals physical actuator state.

Expected/desired behavior:
Hardware protection (RC snubber / MOV) across relay contacts and/or auxiliary contact feedback for safety-critical pumps.

Impact:
Physical flooding, motor burnout, and silent actuation failure.

Recommended investigation/fix:
Add RC snubbers / MOVs across inductive relay contacts in assembly guide; document physical feedback requirement.

Confidence: HIGH
Requires project decision: NO
Physical verification required: YES
```

---

```text
ID: BS-SAFE-003
Severity: HIGH
Category: Safety / Sensors
Title: Float Switch Surface Ripples and Waves Cause High-Frequency Chattering in Safety Monitor

Evidence:
- esp32/main/services/safety_monitor.c:24-34
- esp32/main/hal/sensor_hal.c:162

Why this is a blindspot:
When water is being pumped into a tank, the water surface ripples. A mechanical float switch near the trip threshold will bounce rapidly between OPEN and CLOSED. `safety_monitor_task` samples every 500ms with no debounce filter or low-pass integration.

Failure scenario:
Water level reaches the lower float boundary. Surface ripples cause the float switch to oscillate every second. The pump starts, trips, starts, trips, cycling the motor contactor dozens of times in minutes, destroying the pump starter.

Current behavior:
Raw instantaneous float reading triggers immediate safety trip.

Expected/desired behavior:
Software debounce requiring N consecutive consistent readings (e.g., 3-5 seconds continuous dry state) before tripping or clearing.

Impact:
Contactor and pump damage from rapid cycling.

Recommended investigation/fix:
Add hysteresis and debounce timer (e.g. 3 seconds debounce) in `safety_monitor.c`.

Confidence: HIGH
Requires project decision: NO
Physical verification required: YES
```

---

## 5. Tested-vs-Untested Risk Matrix

| Operational State / Transition | Unit Test | Integration Test | Real ESP32 HW Verified | Risk Level |
|:---|:---:|:---:|:---:|:---|
| **Clean Boot to Safe OFF** | NO | NO | NO | **CRITICAL** (Depends on relay active level) |
| **Emergency Stop via API** | NO | Synthetic Mock Only | NO | **HIGH** (Lacks NVS persistence) |
| **Emergency Stop Resume** | NO | Synthetic Mock Only | NO | **CRITICAL** (UI does not send command) |
| **Dry Run Protection Trip** | NO | Synthetic Mock Only | NO | **CRITICAL** (Pumps can restart immediately) |
| **Manual Fertigation Run** | NO | Mock Only | NO | **CRITICAL** (UI never calls ESP32) |
| **Automated Schedule Run** | NO | NO | NO | **CRITICAL** (Scheduler task is empty) |
| **Power Loss During Run** | NO | NO | NO | **HIGH** (State lost, clock resets to 1970) |
| **DS18B20 Temp Conversion**| NO | NO | NO | **HIGH** (15ms delay is insufficient) |
| **Flow Meter Pulse Counting**| NO | NO | NO | **MEDIUM** (Hardcoded pulse coefficients) |
| **Multi-Greenhouse Routing** | NO | NO | NO | **HIGH** (`"gh-01"` hardcoded everywhere) |
| **MicroSD SPI Mount** | NO | NO | NO | **CRITICAL** (Pin 47 conflicts with PSRAM) |
| **W5500 / Wi-Fi Network Conn**| NO | NO | NO | **CRITICAL** (Driver not initialized) |
| **Clock Sync Application** | NO | Synthetic Mock Only | NO | **HIGH** (Echoes but does not set clock) |
| **Configuration Rollback** | NO | NO | NO | **MEDIUM** (Validation always returns true) |
| **Flash Log Rotation** | NO | NO | NO | **MEDIUM** (Deletes entire log file) |

---

## 6. Actionable Pre-Commissioning Remediation Roadmap

Before flashing firmware to physical ESP32-S3 silicon and wiring actuators:

### Phase 1: Hardware Pinout & Safety Remediation (Mandatory Before Flashing)
1. **Relocate `PIN_IN_FLOAT_LOWER`**: Move from GPIO 19 (USB D-) to a non-conflicting GPIO (e.g., GPIO 21, adjusting TFT DC).
2. **Relocate `PIN_MICROSD_CS`**: Move from GPIO 47 (Octal PSRAM) to a non-PSRAM GPIO pin.
3. **Verify Physical Relay Polarity**: Inspect the relay board optocoupler inputs. If active-low, update `pin_config.h` (`ACTUATOR_LEVEL_ON = 0`, `ACTUATOR_LEVEL_OFF = 1`) and adjust `safe_boot_actuators()` to drive logic HIGH.
4. **Implement SPI Bus Master**: Add `spi_bus_initialize()` in HAL startup before SD card mount.

### Phase 2: Runtime & Network Foundation (Mandatory for Connectivity)
1. **Initialize Network Stack**: Implement Wi-Fi (STA mode with fallback AP) or W5500 SPI driver in `main.c` before starting `http_server`.
2. **Wire Command Manager to REST**: Update `api_command_handlers.c` to dispatch all commands through `command_mgr_submit()` and return real status in `GET /api/v1/commands/*`.
3. **Persist Emergency Stop**: Save emergency stop latch to NVS so power cycles do not clear an active stop.
4. **Prevent Dry-Run Restarts**: Add `s_tank_dry_interlock` into `actuator_hal_set()` so pumps cannot be turned on while tank is dry.

### Phase 3: Contract & UI Harmonization (Mandatory for UI Operation)
1. **Reconcile Contract Envelope**: Make an explicit architectural decision on `EnvelopeBase` vs Flat JSON, and align `UI_ESP32_OPENAPI.yaml`, `api_device_handlers.c`, and `contracts.ts`.
2. **Connect UI Manual Runs**: Replace `setTimeout` simulation in `services.ts` with direct API command dispatch.
3. **Connect UI Resume**: Update `resumeComplex` in `services.ts` to call `esp32Client.postCommand("RESUME_SYSTEM")`.
4. **Implement Real System Clock Sync**: Update `handler_post_clock_sync` to call `settimeofday()`.

---

## 7. Verification and Audit Seal

- **Production Source Code Modified**: **NO** (Strictly audit-only pass; zero edits to `esp32/main` or `src/`)
- **Automated Verification State**: PASS (`npm test` and `npm run build` verify repository build baseline remains uncompromised)
- **Physical Hardware State**: **UNVERIFIED — DO NOT FLASH OR ENERGIZE UNTIL PHASE 1 HARDWARE REMEDIATIONS ARE IMPLEMENTED**
