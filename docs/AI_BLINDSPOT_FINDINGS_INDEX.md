# AI BLINDSPOT FINDINGS INDEX

**Project**: AgroTech Greenhouse Controller — ESP32-S3 + Existing Vite/React UI  
**Audit Safe Point**: SP-AUDIT-001  
**Status Baseline**: Post SP-011 Commissioning Documentation  
**Audit Objective**: Exhaustive pre-flash / pre-assembly blindspot inventory  

---

## Severity Definitions

- **CRITICAL**: Unsafe physical behavior, destructive state/data corruption, uncontrolled physical operation, or inability to recover.
- **HIGH**: Core UI ↔ ESP32 integration failure, incorrect physical behavior, or unreliable operational recovery.
- **MEDIUM**: Important correctness, reliability, or maintainability risk likely in realistic greenhouse operation.
- **LOW**: Limited impact edge case or minor inconsistency.
- **INFORMATIONAL**: Architecture observation or potential operational improvement not proven to be a defect.

---

## Findings Index

| ID | Severity | Category | Title | Status |
|:---|:---|:---|:---|:---|
| **BS-NET-001** | CRITICAL | Network / Connectivity | Complete Absence of Network Interface Initialization (No Wi-Fi STA/AP or W5500 SPI Ethernet Driver in Firmware) | NEW |
| **BS-HW-001** | CRITICAL | GPIO / Pin Blindspots | GPIO 19 Assigned to Lower Float Switch Conflicts with ESP32-S3 Native USB D- (`USB_DM`) | REQUIRES DECISION |
| **BS-HW-002** | CRITICAL | GPIO / Pin Blindspots | MicroSD CS on GPIO 47 Conflicts with Octal SPI PSRAM (OPI) Bus on ESP32-S3-WROOM-1-N16R8 | REQUIRES DECISION |
| **BS-HW-003** | HIGH | Hardware HAL | SPI Bus Master (`spi_bus_initialize`) Never Initialized for Shared MicroSD / W5500 / TFT Bus | NEW |
| **BS-HW-004** | CRITICAL | Actuator Semantics / Polarity | Inverted Relay Polarity Risk on Safe Boot for Standard Active-Low Commercial Relay Modules | REQUIRES VERIFICATION |
| **BS-SAFE-001** | CRITICAL | Safety State Machine | In-Memory Latched Emergency Stop Disappears Across ESP32 Reboot or Power Loss | NEW |
| **BS-SAFE-002** | CRITICAL | Safety State Machine | Lower Float Dry-Run Protection Has No Preventative Interlock and Inverts on Disconnected Wire | NEW |
| **BS-CMD-001** | HIGH | Command Lifecycle | HTTP Command Handler Bypasses `command_mgr`, Dropping Idempotency, Queueing, and Actuators | NEW |
| **BS-CMD-002** | HIGH | Concurrency / Watchdog | Command Worker Task Blocks Entire Worker Queue Synchronously During Timed Runs (`vTaskDelay`) | NEW |
| **BS-SCHED-001** | HIGH | Scheduler / Timer | Firmware Scheduler Task is an Empty Idle Loop; Schedulers are Neither Stored Nor Run on Device | NEW |
| **BS-UI-001** | HIGH | UI State vs Device State | UI Manual Fertigation Runs and Pump Tests Execute Solely in Browser Memory via `setTimeout` | NEW |
| **BS-UI-002** | HIGH | UI State vs Device State | UI "Resume" Action Clears Local Mock State but Never Sends Resume Command to ESP32 | NEW |
| **BS-CLOCK-001** | HIGH | Clock / Time | DS3231 I2C RTC Driver Completely Unimplemented; System Clock Resets to 1970 on Boot | NEW |
| **BS-CLOCK-002** | MEDIUM | Clock / Time | `POST /api/v1/clock-sync` Echoes Request but Never Sets ESP32 System Time (`settimeofday`) | NEW |
| **BS-CC-001** | HIGH | Crop-Cycle / Masa Tanam | Firmware Pre-Seeds Active Crop Cycle in Flash on First Boot, Blocking New Cycle Creation (409) | NEW |
| **BS-CC-002** | MEDIUM | Crop-Cycle / Masa Tanam | HST and HSP Calculation Breaks Completely When System Clock Starts at 1970 Epoch | NEW |
| **BS-SENS-001** | HIGH | Sensor Failure / Semantics | DS18B20 1-Wire Driver Has Insufficient Conversion Delay, No Critical Section, and No CRC Check | NEW |
| **BS-SENS-002** | LOW | Calibration | Flow Meter Calibration Factors (Pulses/Liter) Are Hardcoded `#define` Constants with No Persistence | NEW |
| **BS-STOR-001** | MEDIUM | Storage / Data Integrity | Event Log Rotation Truncates by Deleting Entire File (`unlink`), Causing Total History Loss | NEW |
| **BS-STOR-002** | MEDIUM | Concurrency / Storage | Non-Thread-Safe SPIFFS File Operations Across Concurrent FreeRTOS Tasks | NEW |
| **BS-CFG-001** | MEDIUM | Configuration Management | Configuration PUT Bypasses Semantic Validation and Fails to Apply Updates to Running Services | NEW |
| **BS-TOP-001** | HIGH | Multi-GH Topology | Hardcoded `"gh-01"` Across Handlers and Absence of Valve HAL Precludes Multi-Greenhouse Operation | NEW |
| **BS-CONT-001** | CRITICAL | Contract Drift | Fundamental Envelope Contract Drift Between `UI_ESP32_OPENAPI.yaml` and ESP32 Firmware | REQUIRES DECISION |
| **BS-CONT-002** | HIGH | Contract Drift | `DELETE /api/v1/commands/{commandId}` Missing in Firmware; Client Lacks Generic `postCommand` | NEW |
| **BS-TEST-001** | HIGH | Test Coverage | Verification Script `verify_e2e_contracts.mjs` Tests Synthetic Node Mock Instead of Real Schemas | NEW |
| **BS-TEL-001** | MEDIUM | Telemetry / Events | Telemetry Emits Synthetic Constants for Humidity, Light Lux, and Binary Float Tank Percentage | NEW |
| **BS-MEM-001** | MEDIUM | Memory Exhaustion | HTTP Handler Allocates 4KB Buffer on 8KB Task Stack, Creating Imminent Stack Overflow Risk | NEW |
| **BS-SEC-001** | HIGH | Network / Security | Absence of Authentication, Rate Limiting, and Denial-of-Service Vulnerability in HTTP Body Parser | NEW |
| **BS-HW-005** | HIGH | Actuator Semantics | Absence of Inductive Kickback Snubbers and Welded Relay Contact Detection | REQUIRES VERIFICATION |
| **BS-SAFE-003** | HIGH | Safety / Sensors | Float Switch Surface Ripples and Waves Cause High-Frequency Chattering in Safety Monitor | NEW |

---

## Status Summary

- **Total Blindspots Identified**: 30
- **CRITICAL**: 6
- **HIGH**: 14
- **MEDIUM**: 8
- **LOW**: 1
- **INFORMATIONAL**: 1
- **Requires Project Decision**: 3 (Pin remapping for USB/PSRAM, Envelope contract reconciliation)
- **Requires Physical Verification**: 2 (Relay active-low polarity, Inductive snubber/welding protection)
- **New Findings**: 25
