# FINAL GPIO / PIN / HARDWARE MAPPING FORENSIC AUDIT — M17

**Date:** 2026-09-19
**Milestone:** M17 — Final End-to-End Verification & Physical Commissioning
**Authoritative Pin Map:** `docs/HARDWARE_WIRING_MAP.md`
**Authority rule:** The `.md` pin map is treated as the sole hardware pin SSOT. Source code is judged against it, not the reverse.

## 1. Executive result

**Hardware Installation Status: BLOCKED**

The source-to-pin-number cross-check is now clean for all W-01..W-26 GPIO mappings, and the software safety/pin policy has been hardened. However, physical wiring must not begin because the repository still has unresolved physical/safety evidence gaps: no dedicated physical E-stop mapping, an internal W-15 component-name contradiction inside the SSOT itself, unverified physical flow/SD commissioning, and no real hardware evidence.

The M17 rule explicitly requires the physical gate to remain BLOCKED without hardware evidence; software evidence and physical evidence are kept separate.

## 2. Authoritative source

`docs/HARDWARE_WIRING_MAP.md` is the selected SSOT because its header declares it the **Single Authoritative Hardware Wiring Contract**. The file was read in full before auditing source mappings.

### SSOT internal contradiction
The master W-15 row identifies the raw flow meter as **ZJ-B1**, while the later Section 6 firmware/documentation consistency table still labels W-15 as **YF-B1**. The master table is used as the baseline for the audit, but the contradiction itself is retained as a BLOCKER for physical sensor identity acceptance. The authoritative file was not modified.

The same SSOT gives W-16 FS400A as **F=4.8×Q**, which corresponds to 288 pulses/L at 60 L/min. The firmware source had previously contained 4.5×Q / 270 pulses/L; this M17 patch corrected the source to 4.8×Q / 288 pulses/L.

## Table A — AUTHORITATIVE PIN MAP

The following is transcribed from the master contract table in `docs/HARDWARE_WIRING_MAP.md`; no source code value is used to create or alter the baseline.

| ID | Component / Function | Interface | Pin | Direction | Active Level | Contract Status |
|---|---|---|---:|---|---|---|
| **W-01** | Mode Push Button — TFT Display Screen Switch (cycles screens) | Stranded Wire | **GPIO 0** | Input | Active-LOW (0=Push) | **ACCEPTABLE CAVEAT** |
| **W-02** | Omron Relay #1 — Deep Well AC Pump Contactor Trigger | Digital Control | **GPIO 1** | Output | Active-LOW (0=Run) | **VERIFIED SAFE** |
| **W-03** | Omron Relay #2 — Dist Booster AC Pump Contactor Trigger | Digital Control | **GPIO 2** | Output | Active-LOW (0=Run) | **VERIFIED SAFE** |
| **W-04** | 4-Ch Relay Board — Raw Water Submersible Pump Trigger | Digital Control | **GPIO 4** | Output | Active-LOW (0=ON) | **VERIFIED SAFE** |
| **W-05** | MOSFET Module #1 — Dosing Pump A Trigger (Nutrient) | Digital Control | **GPIO 5** | Output | Active-LOW (in hal) | **VERIFIED SAFE** |
| **W-06** | MOSFET Module #2 — Dosing Pump B Trigger (pH/Buffer) | Digital Control | **GPIO 6** | Output | Active-LOW (in hal) | **VERIFIED SAFE** |
| **W-07** | MOSFET Module #3 — Cabinet Exhaust Fan Trigger | Digital Control | **GPIO 7** | Output | Active-LOW (in hal) | **VERIFIED SAFE** |
| **W-08** | DS3231 RTC Module — I2C Serial Data line | I2C Bus | **GPIO 8** | Bi-directional | Open-Drain | **VERIFIED** |
| **W-09** | DS3231 RTC Module — I2C Serial Clock line | I2C Bus | **GPIO 9** | Output | Open-Drain | **VERIFIED** |
| **W-10** | 4-Ch Relay Board — Greenhouse Blower Fans Contactor Trigger | Digital Control | **GPIO 10** | Output | Active-LOW (0=ON) | **BOOKED (STANDBY)** |
| **W-11** | TFT Display & SD — Master SPI Clock (SPI2_HOST) | Shared SPI Clock | **GPIO 11** | Output | Mode 0 (Rising) | **VERIFIED** |
| **W-12** | TFT Display & SD — Master Out Slave In (Data to Periph) | Shared SPI MOSI | **GPIO 12** | Output | Serial Data | **VERIFIED** |
| **W-13** | MicroSD Card Slot — Master In Slave Out (Data from SD) | Shared SPI MISO | **GPIO 13** | Input | Serial Data | **UNVERIFIED** |
| **W-14** | TFT ST7735 Display — Display Controller Chip Select | Dedicated SPI CS | **GPIO 14** | Output | Active-LOW (0=Select) | **VERIFIED** |
| **W-15** | Flow Sensor ZJ-B1 — Raw Water Transfer Flow Meter (Raw Water → Mixing Tank) | Pulse Divider | **GPIO 15** | Input | Interrupt Pulse | **UNVERIFIED (CALIBRATION REQUIRED)** |
| **W-16** | Flow Sensor FS400A — Fertigation Delivery Flow Meter (G1" F=4.8*Q) | Pulse Divider | **GPIO 16** | Input | Interrupt Pulse | **VERIFIED READY** |
| **W-17** | DS18B20 Temp Probe — Nutrient Tank Temperature Data | 1-Wire Bus | **GPIO 17** | Bi-directional | Open-Drain | **VERIFIED** |
| **W-18** | 4-Ch Relay Board — Red System Error / Alarm Beacon | Digital Control | **GPIO 18** | Output | Active-LOW (0=ON) | **VERIFIED SAFE** |
| **W-19** | TFT ST7735 Display — Display Command / Data Selector | Control Line | **GPIO 21** | Output | High=Data, Low=Cmd | **VERIFIED** |
| **W-20** | Lower Float Switch — **MANDATORY SAFETY DRY-RUN INTERLOCK** | Dry Contact | **GPIO 38** | Input | Active-LOW (0=DRY) | **VERIFIED SAFE (SAFETY)** |
| **W-21** | Manual A Button — Manual Well Pump 5-Min Toggle Switch | Stranded Wire | **GPIO 39** | Input | Active-LOW (0=Push) | **VERIFIED SAFE** |
| **W-22** | 4-Ch Relay Board — Mixing Pump (220V AC Pond Pump) | Digital Control | **GPIO 40** | Output | Active-LOW (0=ON) | **VERIFIED SAFE** |
| **W-23** | Distribution Button — Reserved Button 4 (TBD / Spare) | Stranded Wire | **GPIO 41** | Input | Active-LOW (0=Push) | **VERIFIED SAFE** |
| **W-24** | TFT ST7735 Display — Display Hardware Reset | Control Line | **GPIO 42** | Output | Active-LOW (0=Reset) | **VERIFIED** |
| **W-25** | Anti-Theft Loop — **MANDATORY SECURITY & ANTI-THEFT INTERLOCK** | Closed Loop Wire | **GPIO 47** | Input | Active-HIGH (0=OK, 1=Cut) | **VERIFIED SAFE (SECURITY)** |
| **W-26** | MicroSD Card Slot — Integrated SD Slot Chip Select | Dedicated SPI CS | **GPIO 48** | Output | Active-LOW (0=Select) | **UNVERIFIED** |
| **W-27** | LM2596 Regulator — ESP32 Board Main DC Power Input | Power Conductor | **5V (Vin)** | Power In | 5.05V DC Regulated | **VERIFY DMM** |
| **W-28** | Sensors & Display — 3.3V Sensor & Peripheral Supply Rail | Power Conductor | **3V3 Rail** | Power Out | 3.30V DC Regulated | **VERIFIED RAIL** |
| **W-29** | System Electronics — Common Low-Voltage Signal Ground | Ground Plane | **GND Rail** | Ground | 0V Reference | **VERIFIED RAIL** |


## Table B — IMPLEMENTATION CROSS-CHECK

| ID | Pin Map | Source Macro | Source Value | Primary Production Caller | Status |
|---|---:|---|---:|---|---|
| W-01 | 0 | `PIN_BTN_MODE` | 0 | esp32/main/hal/button_hal.c | MATCH |
| W-02 | 1 | `PIN_OUT_WELL_PUMP` | 1 | esp32/main/hal/actuator_hal.c | MATCH |
| W-03 | 2 | `PIN_OUT_DIST_PUMP` | 2 | esp32/main/hal/actuator_hal.c | MATCH |
| W-04 | 4 | `PIN_OUT_RAW_SUBMERSIBLE` | 4 | esp32/main/hal/actuator_hal.c | MATCH |
| W-05 | 5 | `PIN_OUT_DOSING_A` | 5 | esp32/main/hal/actuator_hal.c | MATCH |
| W-06 | 6 | `PIN_OUT_DOSING_B` | 6 | esp32/main/hal/actuator_hal.c | MATCH |
| W-07 | 7 | `PIN_OUT_COOLING_FAN` | 7 | esp32/main/hal/actuator_hal.c | MATCH |
| W-08 | 8 | `PIN_I2C_SDA` | 8 | esp32/main/hal/rtc_ds3231.c | MATCH |
| W-09 | 9 | `PIN_I2C_SCL` | 9 | esp32/main/hal/rtc_ds3231.c | MATCH |
| W-10 | 10 | `PIN_OUT_BLOWER_FAN` | 10 | esp32/main/hal/actuator_hal.c | MATCH |
| W-11 | 11 | `PIN_SPI_SCK` | 11 | esp32/main/hal/tft_hal.c + sdcard_hal.c | MATCH |
| W-12 | 12 | `PIN_SPI_MOSI` | 12 | esp32/main/hal/tft_hal.c + sdcard_hal.c | MATCH |
| W-13 | 13 | `PIN_SPI_MISO` | 13 | esp32/main/hal/sdcard_hal.c | MATCH |
| W-14 | 14 | `PIN_TFT_CS` | 14 | esp32/main/hal/tft_hal.c | MATCH |
| W-15 | 15 | `PIN_IN_FLOW_RAW_ZJB1` | 15 | esp32/main/hal/sensor_hal.c | MATCH — SSOT identity conflict (master says ZJ-B1; section 6 says YF-B1) |
| W-16 | 16 | `PIN_IN_FLOW_FERT_FS400A` | 16 | esp32/main/hal/sensor_hal.c | MATCH after source correction to 288 pulses/L; physical calibration still required |
| W-17 | 17 | `PIN_IN_TEMP_DS18B20` | 17 | esp32/main/hal/sensor_hal.c | MATCH |
| W-18 | 18 | `PIN_OUT_ERROR_LAMP` | 18 | esp32/main/hal/actuator_hal.c | MATCH |
| W-19 | 21 | `PIN_TFT_DC` | 21 | esp32/main/hal/tft_hal.c | MATCH |
| W-20 | 38 | `PIN_IN_FLOAT_LOWER` | 38 | esp32/main/hal/sensor_hal.c + actuator_hal.c | MATCH |
| W-21 | 39 | `PIN_BTN_MANUAL_A` | 39 | esp32/main/hal/button_hal.c | MATCH |
| W-22 | 40 | `PIN_OUT_MIXING_PUMP` | 40 | esp32/main/hal/actuator_hal.c | MATCH |
| W-23 | 41 | `PIN_BTN_RESERVED` | 41 | esp32/main/hal/button_hal.c | MATCH |
| W-24 | 42 | `PIN_TFT_RST` | 42 | esp32/main/hal/tft_hal.c | MATCH |
| W-25 | 47 | `PIN_IN_TAMPER_LOOP` | 47 | esp32/main/hal/sensor_hal.c + safety_monitor.c | MATCH |
| W-26 | 48 | `PIN_SD_CS` | 48 | esp32/main/hal/sdcard_hal.c | MATCH |
| W-27 | 5V (Vin) | `—` | — | — | POWER — no firmware GPIO mapping |
| W-28 | 3V3 Rail | `—` | — | — | POWER — no firmware GPIO mapping |
| W-29 | **GND Rail** | `—` | — | — | POWER / GROUND — no firmware GPIO mapping |


## Table C — GPIO OWNERSHIP

The authoritative active ownership is taken from W-01..W-26. Reserved/unavailable ranges come from the target-board rules recorded in the canonical map and the source policy used by runtime validation.

| GPIO / Interface | Authoritative Owner | Actual Source Users | Conflict | Status |
|---|---|---|---|---|
| GPIO 0 | **W-01**: Mode Push Button | esp32/main/hal/button_hal.c | None found | PASS (source matched) |
| GPIO 1 | **W-02**: Omron Relay #1 | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 2 | **W-03**: Omron Relay #2 | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 3 | Reserved / system pin | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 4 | **W-04**: 4-Ch Relay Board | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 5 | **W-05**: MOSFET Module #1 | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 6 | **W-06**: MOSFET Module #2 | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 7 | **W-07**: MOSFET Module #3 | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 8 | **W-08**: DS3231 RTC Module | esp32/main/hal/rtc_ds3231.c | None found | PASS (source matched) |
| GPIO 9 | **W-09**: DS3231 RTC Module | esp32/main/hal/rtc_ds3231.c | None found | PASS (source matched) |
| GPIO 10 | **W-10**: 4-Ch Relay Board | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 11 | **W-11**: TFT Display & SD | esp32/main/hal/tft_hal.c + sdcard_hal.c | None found | PASS (source matched) |
| GPIO 12 | **W-12**: TFT Display & SD | esp32/main/hal/tft_hal.c + sdcard_hal.c | None found | PASS (source matched) |
| GPIO 13 | **W-13**: MicroSD Card Slot | esp32/main/hal/sdcard_hal.c | None found | PASS (source matched) |
| GPIO 14 | **W-14**: TFT ST7735 Display | esp32/main/hal/tft_hal.c | None found | PASS (source matched) |
| GPIO 15 | **W-15**: Flow Sensor ZJ-B1 | esp32/main/hal/sensor_hal.c | None found | PASS (source matched) |
| GPIO 16 | **W-16**: Flow Sensor FS400A | esp32/main/hal/sensor_hal.c | None found | PASS (source matched) |
| GPIO 17 | **W-17**: DS18B20 Temp Probe | esp32/main/hal/sensor_hal.c | None found | PASS (source matched) |
| GPIO 18 | **W-18**: 4-Ch Relay Board | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 19 | Reserved / system pin | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 20 | Reserved / system pin | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 21 | **W-19**: TFT ST7735 Display | esp32/main/hal/tft_hal.c | None found | PASS (source matched) |
| GPIO 22 | Not bonded on target module | No production owner | — | UNAVAILABLE |
| GPIO 23 | Not bonded on target module | No production owner | — | UNAVAILABLE |
| GPIO 24 | Not bonded on target module | No production owner | — | UNAVAILABLE |
| GPIO 25 | Not bonded on target module | No production owner | — | UNAVAILABLE |
| GPIO 26 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 27 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 28 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 29 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 30 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 31 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 32 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 33 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 34 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 35 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 36 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 37 | Flash/PSRAM reserved | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 38 | **W-20**: Lower Float Switch | esp32/main/hal/sensor_hal.c + actuator_hal.c | None found | PASS (source matched) |
| GPIO 39 | **W-21**: Manual A Button | esp32/main/hal/button_hal.c | None found | PASS (source matched) |
| GPIO 40 | **W-22**: 4-Ch Relay Board | esp32/main/hal/actuator_hal.c | None found | PASS (source matched) |
| GPIO 41 | **W-23**: Distribution Button | esp32/main/hal/button_hal.c | None found | PASS (source matched) |
| GPIO 42 | **W-24**: TFT ST7735 Display | esp32/main/hal/tft_hal.c | None found | PASS (source matched) |
| GPIO 43 | Reserved / system pin | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 44 | Reserved / system pin | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 45 | Reserved / system pin | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 46 | Reserved / system pin | No production owner | — | RESERVED / DO NOT REASSIGN |
| GPIO 47 | **W-25**: Anti-Theft Loop | esp32/main/hal/sensor_hal.c + safety_monitor.c | None found | PASS (source matched) |
| GPIO 48 | **W-26**: MicroSD Card Slot | esp32/main/hal/sdcard_hal.c | None found | PASS (source matched) |


## Table D — DEVIATIONS / RISKS

| ID | Component / Scope | Pin-map truth | Actual implementation / evidence | Risk | Required Fix | Status |
|---|---|---|---|---|---|---|
| R-01 | Physical emergency-stop input | No dedicated E-stop GPIO/interface is defined in SSOT | Firmware has software/API E-stop and local tamper/lower-float safety, but no mapped physical E-stop input | CRITICAL | Define/approve a physical E-stop circuit and add it only via a future authoritative pin-map revision | **BLOCKED** |
| R-02 | W-15 raw flow identity | Master W-15 = ZJ-B1; Section 6 later says YF-B1 | Source uses ZJ-B1 value/pin with obsolete YF-B1 aliases | HIGH | Resolve the SSOT internal naming contradiction before physical flow-sensor acceptance | **BLOCKED** |
| R-03 | W-16 FS400A nominal characteristic | W-16 says F=4.8×Q | Source corrected from 270 to 288 pulses/L; physical calibration remains required | HIGH | Perform physical calibration; do not treat nominal factor as proof | **SOFTWARE FIXED / PHYSICAL BLOCKED** |
| R-04 | Generic analog sensors (humidity/light/pressure/pH/EC) | No analog GPIO/interface mapping in SSOT | Production generic ADC inference disabled; unmapped physical sensors now return unavailable | HIGH | Add explicit pins/interfaces to SSOT before commissioning these sensors | **BLOCKED** |
| R-05 | Dosing channels beyond A/B | SSOT maps only Dosing A GPIO5 and Dosing B GPIO6 | Software supports generic channels, but extra physical GPIOs are intentionally rejected unless mapped | HIGH | Add authoritative physical mapping before commissioning dosing C–G | **BLOCKED** |
| R-06 | Multi-GH physical pumps/valves | Current SSOT maps one distribution pump (GPIO2) and one mixing pump (GPIO40) | Software is multi-GH, but current physical hardware cannot prove dedicated paths for additional GHs | HIGH | Commission only configured physical inventory; map additional hardware before expansion | **BLOCKED** |
| R-07 | W5500 Ethernet | No W5500 pin/interface is defined | No active W5500 driver/CS in production; stale docs were corrected | HIGH | Do not wire W5500 until authoritative pin map assigns CS/INT/RESET | **BLOCKED** |
| R-08 | MicroSD physical proof | GPIO13/48 are defined, statuses are UNVERIFIED | Driver uses GPIO13/48 correctly | MEDIUM | Physical card/bus test | **BLOCKED** |
| R-09 | GPIO0 boot strap | GPIO0 button is documented with boot caveat | Source uses GPIO0 as input; behavior must be tested with button released at boot | MEDIUM | Physical boot test | **BLOCKED** |
| R-10 | GPIO48 onboard RGB LED caveat | W-26 notes WS2812 line caveat | Source uses GPIO48 as SD CS | MEDIUM | Physical SD/LED coexistence test | **BLOCKED** |
| R-11 | Safe boot actuator coverage | W-02/W-03/W-04/W-05/W-06/W-07/W-10/W-18/W-22 are mapped actuators | Original safe boot omitted GPIO10/40; source now includes all 9 | CRITICAL | Keep regression gate and physical boot measurement | **FIXED SOFTWARE** |
| R-12 | Reserved/unavailable GPIO validation | SSOT forbids reserved/unbonded assignments | Source now rejects reserved/unavailable GPIOs and duplicate physical GPIOs for configured registry | CRITICAL | Keep negative tests | **FIXED SOFTWARE** |
| R-13 | Button 3 documentation | W-22 = Mixing Pump GPIO40; Button3 is retired in SSOT | Stale docs corrected; source header now states Button3 retired | HIGH | Keep one non-authoritative docs set synchronized | **FIXED** |
| R-14 | Physical commissioning evidence | M17 requires real hardware evidence | No connected/commissioned ESP32/hydraulics in current environment | CRITICAL | Perform physical commissioning and capture evidence | **BLOCKED** |


## 3. Actuator audit

The canonical mapped outputs are exactly: well pump GPIO1, distribution pump GPIO2, raw submersible GPIO4, dosing A GPIO5, dosing B GPIO6, cooling fan GPIO7, blower fan GPIO10, error lamp GPIO18, and mixing pump GPIO40.

`safe_boot_actuators()` was corrected to clamp all **9** mapped actuator outputs before network/runtime initialization. This closes the earlier omission of GPIO10 and GPIO40 at software level.

Production actuator output calls remain behind the actuator HAL / command / safety paths. No rogue numeric GPIO actuator call was found in production C/H outside the centralized pin definitions and expected peripheral/HAL implementations.

## 4. Sensor audit

Mapped physical inputs are: raw flow GPIO15, fertigation flow GPIO16, DS18B20 GPIO17, lower float GPIO38, manual button GPIO39, reserved button GPIO41, and tamper loop GPIO47.

Generic analog sensor acquisition no longer infers GPIO1–10. The canonical map does not assign analog pins for humidity, light, pressure, pH, or EC, and production runtime therefore returns unavailable until a future authoritative mapping exists.

No physical pH/EC/humidity/light/pressure commissioning may be claimed from the current source.

## 5. Safety input audit

- Lower float GPIO38 is a mapped mandatory dry-run interlock.
- Tamper loop GPIO47 is a mapped mandatory security interlock that engages the safety/emergency-stop path.
- **No dedicated physical E-stop input is defined by the authoritative pin map.** The software/API E-stop is not accepted as a substitute for a physical E-stop commissioning result. This remains a CRITICAL BLOCKER.

## 6. Communication / bus audit

Active mapped buses are: I2C GPIO8/9 (DS3231), shared SPI GPIO11/12/13 with TFT CS14 and SD CS48, and DS18B20 1-Wire on GPIO17.

**W5500 has no active mapping in the SSOT and no production CS definition remains.** Stale documents that previously suggested W5500 CS GPIO10 were corrected so GPIO10 remains exclusively the booked blower relay output.

## 7. Startup-safe state

All nine mapped actuator outputs are now included in the earliest safe-boot clamp. Software policy also rejects configured actuator polarity other than ACTIVE_LOW for mapped actuator roles. Physical relay/contactor/MOSFET polarity is still not physically commissioned.

## 8. Logical → physical trace

The production resolution chain is:

```text
Logical Component ID
  ↓
Active Hardware Registry
  ↓
Canonical Pin Policy
  ↓
GPIO / Peripheral
  ↓
HAL / Driver
  ↓
Physical interface
```

The registry now rejects:

- unavailable/reserved GPIOs;
- duplicate physical GPIO assignments in the active registry;
- known mapped roles bound to a non-canonical GPIO;
- operational GPIO components that have no canonical physical mapping;
- mapped actuators with a non-ACTIVE_LOW override.

This is a safety guard, not physical proof.

## 9. Multi-GH physical boundary

Software M5/M6 remains configuration-driven and multi-GH. The current hardware SSOT, however, physically defines one distribution pump and one mixing pump. Therefore additional GH-specific pumps/valves cannot be treated as physically commissioned until their components are actually installed and mapped by an authoritative pin-map revision. Likewise dosing C–G has no physical pins in the current SSOT.

## 10. Software E2E gate

**Production-path subgate: PASS (28/28). Release software gate: PARTIAL.**

The production-path checks pass, but the overall software gate remains PARTIAL because clean frontend build and ESP-IDF firmware build are blocked in the current environment.

Executed evidence:

- M17 hardware pin audit: PASS
- M17 software E2E: 28/28 PASS
- Forensic authority: 13/13 PASS
- M2: 26/26 PASS
- M3/M4: PASS
- M5/M6: PASS
- M7/M8 runtime: 22 PASS
- Backend M7/M8: 7/7 PASS
- M9: 16/16 PASS
- M10: 31/31 PASS
- Backend M10 proxy: 6/6 PASS
- M11/M12 backend: 34/34 PASS
- M11/M12 firmware source gate: 17/17 PASS
- M13: PASS
- M14/M15: PASS
- M16: PASS
- OpenAPI/E2E contract: PASS (28 endpoint definitions / 26 firmware handlers)
- Python compile: PASS
- Frontend clean build: BLOCKED because clean `npm ci` did not complete and `node_modules` is incomplete; `npm run build` cannot resolve the required type packages.
- ESP-IDF build: BLOCKED because `idf.py` is not installed in this environment.

## 11. Physical commissioning gate

**Status: BLOCKED — hardware evidence unavailable.**

No physical PASS is claimed for:

- ESP32 boot-output measurement;
- relay/contactor/MOSFET polarity;
- pumps/valves/fans;
- flow meters;
- DS18B20 physical signal;
- lower float;
- tamper loop;
- physical E-stop;
- power-loss/brownout;
- network-loss on live hardware;
- durable spool across real power interruption;
- hydraulic routing/leaks/backflow/starvation;
- actual dosing calibration;
- controlled real fertigation trial;
- live crop/research traceability.

## 12. Physical commissioning sequence

1. De-energized wiring and protective-device inspection.
2. DMM verification of 3.3V/5V/12V rails.
3. ESP32 boot safe-state measurement.
4. Physical E-stop / local safety circuit verification.
5. Individual actuator verification.
6. Individual sensor verification.
7. Dosing calibration per installed channel.
8. Flow calibration for ZJ-B1 and FS400A after resolving SSOT W-15 naming.
9. Resource/concurrency test across physically installed GHs.
10. Power-loss / reboot / spool test.
11. Network-loss / reconnect / replay test.
12. Hydraulic routing and leak/backflow test.
13. Controlled fertigation trial with Command vs Measurement vs History reconciliation.
14. Research/crop traceability trial.

## 13. Clean-build / toolchain record

```text
Node:       v22.16.0
npm:        10.9.2
Python:     3.13.5
ESP-IDF:    idf.py NOT FOUND
Git:        .git metadata not present in delivered archive
npm ci:     TIMED OUT before dependency tree completed
Frontend build: BLOCKED
Firmware build:  BLOCKED
```

## 14. Test / mock correlation

Synthetic GPIO values remain in software fixtures for topology/resource testing. Those fixtures are explicitly marked as **test-only and not physical wiring evidence**. Physical acceptance must always trace back to `docs/HARDWARE_WIRING_MAP.md`.

## 15. Final Trinity matrix

| Principle | Status | Evidence boundary |
|---|---|---|
| Active Configuration authority | PASS | Software |
| Backend/config authority | PASS | Software |
| ESP32 local runtime/safety authority | PASS | Software/source |
| One automatic physical execution authority | PASS | Software/source |
| Multi-GH identity configuration-driven | PASS | Software |
| Resource ownership explicit | PASS | Software |
| Topology/schedule/compiled plan | PASS | Software |
| Exact calibration references | PASS | Software |
| Telemetry provenance/history | PASS | Software |
| Offline operation/replay | PASS | Software |
| Safe boot | PASS | Source-level after M17 patch |
| Physical E-stop | BLOCKED | No canonical pin mapping / no physical evidence |
| Physical sensor/actuator proof | BLOCKED | No hardware evidence |
| Hydraulic proof | BLOCKED | No hydraulic installation evidence |
| Authoritative pin-map compliance | PASS/PARTIAL | 26/26 source values match; W-15 SSOT identity contradiction remains |

## 16. Safe point

`SP-M17-SOFTWARE-READY` remains the only valid safe point. `SP-M17-COMPLETE` is **not** created.


## 16A. Files changed in this M17 pin-audit pass

Primary source changes:

- `esp32/main/main.c` — safe-boot clamp now covers all 9 mapped actuator outputs.
- `esp32/main/config/pin_config.h` — canonical active-low policy, unavailable-pin helper, stale W5500 mapping removed, FS400A constant documented.
- `esp32/main/hal/sensor_hal.c` / `.h` — generic ADC inference disabled for unmapped analog pins; FS400A source factor aligned to 4.8×Q / 288 pulses/L.
- `esp32/main/hal/hardware_registry.c` / `.h` — canonical GPIO/polarity validation and duplicate-GPIO rejection.
- `esp32/main/http/api_config_handlers.c` — configuration validation uses the same canonical pin policy.
- `esp32/main/services/panel_button_mgr.h` — GPIO40/Button3 retirement documented.

Supporting documentation/test changes:

- `docs/HARDWARE_INVENTORY.md`
- `docs/HARDWARE_WIRING_CHECKLIST.md`
- `docs/ESP32_ASSEMBLY_GUIDE.md`
- `docs/COMPONENT_PIN_MAP.md`
- `ESP32_BACKEND_SPEC.md`
- peripheral-map documentation files
- `scripts/test_m17_hardware_pin_audit.py`
- test fixtures updated with explicit synthetic-GPIO notices
- `docs/FINAL_GPIO_HARDWARE_MAPPING_FORENSIC_AUDIT-2026-09-19.md`
- `docs/M17_END_TO_END_AND_PHYSICAL_COMMISSIONING.md`
- `IMPLEMENTATION_BACKLOG_PRD_ALIGNMENT.md`
- `AI_PROGRESS.md`
- `AI_HANDOVER.md`
- `AI_CHANGELOG.md`

Git commit: **BLOCKED / unavailable** — the delivered repository snapshot does not contain `.git` metadata.

## 17. Hardware installation status

```text
HARDWARE INSTALLATION STATUS: BLOCKED
```

Do not energize or wire the physical greenhouse controller until the CRITICAL blockers—especially the physical E-stop definition and the W-15 identity contradiction—are resolved and the commissioning evidence is actually recorded.
