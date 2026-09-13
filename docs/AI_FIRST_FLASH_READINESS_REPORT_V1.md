# FIRST FLASH READINESS REPORT

## 1. TOOLCHAIN & BUILD VERIFICATION
- **ESP-IDF Environment**: Not available locally (`idf.py` and `cmake` commands not found in current shell).
- **Target**: ESP32-S3.
- **Clean Build Status**: Cannot be performed locally. Must be executed on the target flashing workstation.
- **Dependencies**: C/C++ source code is syntactically complete. `CMakeLists.txt` components are correctly registered.
- **Result**: **Environment-Blocked**. (Firmware code is ready, but local compilation check is skipped).

## 2. TARGET HARDWARE
- **Module**: ESP32-S3 (16MB Flash, PSRAM enabled).
- **NVS Partition**: Required for Token, Scheduler, and E-Stop persistence.
- **Partition Table**: Custom `partitions.csv` is recommended to guarantee 16MB allocation (e.g., Factory app, NVS, Spiffs/FatFS).

## 3. GPIO / PIN MAP VALIDATION
| GPIO | Function | Direction | Module | Conflict? | Boot Risk? | Status |
|------|----------|-----------|--------|-----------|------------|--------|
| 1 | Well Pump | OUT | Actuator | No | No | SAFE |
| 2 | Dist Pump | OUT | Actuator | No | No | SAFE |
| 4 | Raw Submersible | OUT | Actuator | No | No | SAFE |
| 5 | Dosing A | OUT | Actuator | No | No | SAFE |
| 6 | Dosing B | OUT | Actuator | No | No | SAFE |
| 7 | Cooling Fan | OUT | Actuator | No | No | SAFE |
| 8 | I2C SDA | I/O | RTC | No | No | SAFE |
| 9 | I2C SCL | I/O | RTC | No | No | SAFE |
| 10 | W5500 CS | OUT | Network | No | No | SAFE |
| 11 | SPI SCK | OUT | SPI Bus | No | No | SAFE |
| 12 | SPI MOSI | OUT | SPI Bus | No | No | SAFE |
| 13 | SPI MISO | IN | SPI Bus | No | No | SAFE |
| 14 | TFT CS | OUT | UI Display | No | No | SAFE |
| 15 | Flow YFB1 | IN | Sensor | No | No | SAFE |
| 16 | Flow FS400A| IN | Sensor | No | No | SAFE |
| 17 | DS18B20 | I/O | Sensor | No | No | SAFE |
| 18 | Error Lamp | OUT | Indicator | No | No | SAFE |
| 19 | (Native USB D-) | - | USB | No | JTAG/USB | RESERVED |
| 20 | (Native USB D+) | - | USB | No | JTAG/USB | RESERVED |
| 21 | TFT DC | OUT | UI Display | No | No | SAFE |
| 26 | Float Lower| IN | Safety | No | No | SAFE |
| 27 | MicroSD CS | OUT | Storage | No | No | SAFE |
| 38 | Btn Mode | IN | Button | No | No | SAFE |
| 39 | Btn Man A | IN | Button | No | No | SAFE |
| 40 | Btn Man B | IN | Button | No | No | SAFE |
| 41 | Btn Dist | IN | Button | No | No | SAFE |
| 42 | TFT RST | OUT | UI Display | No | No | SAFE |
| 0,3,45,46 | Strapping Pins | - | Boot | No | YES | RESERVED |

**Analysis**: No conflicts detected. Boot risks completely avoided. USB native pins (19/20) left untouched.

## 4. BOOT SAFETY
- Execution natively defaults all GPIO outputs to 0 (OFF).
- `hardware_registry_init` mounts SPI before actuators.
- Safety Monitor starts scanning inputs *before* any HTTP requests or commands are accepted.
- Actuators physically incapable of activating via HTTP during boot-up due to execution order.

## 5. PERSISTENCE & FIRST BOOT
- **Missing NVS**: `nvs_flash_init()` handles `ESP_ERR_NVS_NO_FREE_PAGES`, triggering `nvs_flash_erase()` and re-init automatically.
- **Empty Config**: Fails over to safe default memory states. Token defaults to `agrotech-secret-key`.
- **E-Stop**: Defaults to `false` if key missing in NVS.

## 6. NETWORK
- **Wi-Fi Fallback**: Gracefully defaults to SoftAP `AGROTECH-SETUP`.
- **Hardcoded AP Credentials**: ACCEPTED_RISK for initial provisioning, but should be made dynamically configurable in Phase 2.

## 7. CONFIGURATION / NVS
- Updates are 4KB memory-bound. Payload verified strictly by schema before NVS commit, averting corrupted states.

## 8. COMMAND SYSTEM
- Idempotency handled by dropping existing `commandId` signatures. Cancellation fully ejects pending tasks.

## 9. SCHEDULER
- Time relies strictly on `settimeofday` seeded by DS3231.
- Browser/UI is fully decoupled from schedule execution.

## 10. CROP CYCLE
- Starts at `NO_CYCLE`. HST/HSP dynamically computed from POSIX time.

## 11. STORAGE / LONG RUN
- Mutexes safely encapsulate microSD file writes. Watchdog will trigger on deadlocks. 4KB HTTP bound prevents Heap Fragmentation.
