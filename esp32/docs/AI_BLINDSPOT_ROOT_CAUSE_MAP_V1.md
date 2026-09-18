# AI BLINDSPOT ROOT CAUSE MAP V1

## Root Cause 1: Lack of True E2E Testing
The project relied on a synthetic Node.js mock (`verify_e2e_contracts.mjs`) instead of testing against the actual ESP32 C firmware. This allowed gaping holes (missing routes like DELETE commands, missing validation, fake UI services) to persist unnoticed because the tests only validated the mock, not the reality.
- **Related Findings**: BS-TEST-001, BS-CONT-002, BS-UI-001, BS-UI-002, BS-SYS-001

## Root Cause 2: Hardware Ignorance in Firmware
The firmware was developed without cross-referencing the physical hardware constraints outlined in `ESP32_ASSEMBLY_GUIDE.md` and the datasheets. This led to fatal pin conflicts (Native USB, Octal PSRAM), improper timing (DS18B20), and dangerous assumptions about relay polarity and AC inductive kickback.
- **Related Findings**: BS-HW-001, BS-HW-002, BS-HW-003, BS-HW-004, BS-HW-005, BS-SENS-001, BS-SAFE-002

## Root Cause 3: Incomplete Boot/Initialization Chain
The firmware initialization sequence (`app_main`) has massive omissions, primarily missing the network drivers completely, missing the RTC driver, and missing SPI bus initialization. This makes the controller reachability-dead and functionally crippled upon boot.
- **Related Findings**: BS-NET-001, BS-CLOCK-001, BS-HW-003

## Root Cause 4: Poor Concurrency and State Persistence
The system uses RAM for critical safety states (Emergency Stop) without NVS persistence, causing them to clear on power loss. It also uses synchronous delays (`vTaskDelay`) in worker tasks that block the entire queue, defeating the purpose of asynchronous command management.
- **Related Findings**: BS-SAFE-001, BS-CMD-002, BS-MEM-002, BS-TELE-001

## Root Cause 5: "Happy Path" Driven Development
The firmware and UI were built targeting the happy path only. They lack fundamental defensive programming: no authentication, no payload size limits (OOM vector), no bounds checking on configs, and hardcoded `gh-01` namespaces.
- **Related Findings**: BS-SEC-001, BS-MEM-001, BS-TOP-001, BS-SYS-001, BS-SYS-002, BS-API-001, BS-CC-001, BS-CC-003, BS-CLOCK-002
