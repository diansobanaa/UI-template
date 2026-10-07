# CANONICAL DOCUMENTATION: INTERNAL RAM OPTIMIZATION (BATCH 1)

## 1. Overview & Objective
In accordance with **TODO #2 — Internal RAM Optimization (Batch 1)**, large static `.bss` data structures verified as non-DMA, non-ISR, and non-flash-time critical were migrated from ESP32 Internal DRAM (`0x3fc...`) to External Octal PSRAM (`0x3c...`) using `EXT_RAM_BSS_ATTR` (`esp_attr.h`).

This migration directly resolves the low internal heap bottleneck without altering any system behavior, data structures, array sizes, lifecycles, or FreeRTOS task logic.

---

## 2. Candidates Migrated to PSRAM

| Candidate / Symbol | Source File | Before Location | After Location | Size (Bytes) | Verification Status |
|---|---|---|---|---:|---|
| `s_prep_slots` | `esp32/main/services/fertigation_mgr.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c1faf00`) | 32,704 B | PASS (Live verified) |
| `s_ring_buffer` | `esp32/main/services/telemetry_mgr.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c1f3f00`) | 28,672 B | PASS (Live verified) |
| `s_active_components` | `esp32/main/hal/hardware_registry.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c170000`) | 22,144 B | PASS (Live verified) |
| `s_daily_history` | `esp32/main/storage/telemetry_store.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c2046c0`) | 11,552 B | PASS (Live verified) |
| `today_occs` | `esp32/main/hal/tft_hal.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c1760c0`) | 5,760 B | PASS (Live verified) |
| `q_entries` | `esp32/main/hal/tft_hal.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c175680`) | 2,624 B | PASS (Live verified) |
| `s_sched_entries` | `esp32/main/hal/tft_hal.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c177740`) | 1,920 B | PASS (Live verified) |
| `s_generic_samples` | `esp32/main/hal/sensor_hal.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c202ec0`) | 6,144 B | PASS (Live verified) |
| `s_alarms` | `esp32/main/services/alarm_mgr.c` | Internal DRAM (`.dram0.bss`) | PSRAM (`0x3c1abec0`) | 5,120 B | PASS (Live verified) |
| **TOTAL RECLAIMED** | | | | **116,640 B** (~113.9 KB) | **100% MIGRATED** |

---

## 3. Linker Map (`agrotech_esp32.map`) Verification

- **Internal DRAM `.dram0.bss`**:
  - Before: `172,040 bytes` (`0x2a008`)
  - After: `55,400 bytes` (`0xd868`)
  - **Net Reduction**: `-116,640 bytes` (Exact match)
- **External PSRAM `.ext_ram.bss`**:
  - Before: `502,848 bytes` (`0x7ac40`)
  - After: `619,488 bytes` (`0x973e0`)
  - **Net Increase**: `+116,640 bytes` (Exact match)

---

## 4. Live Hardware Runtime Measurements (ESP32-S3 COM3)

### Boot Final (`[HEAP] final`)
- **Internal Free Heap**:
  - BEFORE: `26,335 B` (26.3 KB)
  - AFTER: `142,835 B` (142.8 KB) — **+116,500 B reclaimed**
- **Largest Internal Block**:
  - BEFORE: `18,432 B` (18.4 KB)
  - AFTER: `69,632 B` (69.6 KB) — **+51,200 B increase**
- **PSRAM Free**:
  - BEFORE: `7,773,988 B`
  - AFTER: `7,657,348 B`

### True Runtime Steady-State (`diagnostics_task` `[DIAG]`)
- **Internal Free Heap**:
  - BEFORE: `~35,800 B` (35.8 KB)
  - AFTER: `150,983 B` (151.0 KB) — **+115,183 B reclaimed**
- **Largest Internal Block**:
  - BEFORE: `18,432 B` (18.4 KB)
  - AFTER: `65,536 B` (65.5 KB) — **+47,104 B increase**
- **PSRAM Free**:
  - BEFORE: `~7,769,460 B`
  - AFTER: `7,652,820 B`
- **Heap Integrity**: `OK`
- **Threshold Warnings**: The previous warning `[DIAG] Internal heap LOW (<30KB threshold)` is permanently resolved.

---

## 5. Functional & Subsystem Verification
All primary subsystems and tasks operate normally on live hardware:
1. **WiFi**: STA connected (`192.168.0.101`), hostname `esp32-esp32-gh-01`.
2. **RTC (DS3231)**: Synced over I2C, `/api/v1/clock` reports `rtcAvailable=true, synced=true`.
3. **MicroSD Card**: Mounted at `/sdcard`, 7431 MB capacity; historical telemetry recovery completed.
4. **DHT22 / Sensors**: Operating reliably on GPIO 41; analog/generic flow sample slots operational in PSRAM.
5. **Button HAL**: `btn_poll_task` active on Core 1 (20ms cadence).
6. **Scheduler**: 25 intents loaded, daily triggers and evaluations executing continuously.
7. **HTTP Server**: Port 80 responding with HTTP 200 across all canonical endpoints.
8. **Telemetry**: Telemetry manager V2 streaming worker and ring buffer active in PSRAM.
9. **TFT Display**: ST7735 display dynamic refresh task running on Core 1 with screens rendering smoothly.
10. **Fertigation Manager**: `s_prep_slots` allocated in PSRAM, `/api/v1/fertigation/status` reports healthy IDLE state. Boot recovery and restore recovery verified without panic or crashes.
11. **Actuator HAL & Alarms**: Hardware registry lookups and alarm records active in PSRAM.
12. **Event Manager**: Logging system and ring buffer operating with zero errors.
