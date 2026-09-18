import json

prd_content = \"\"\"# ACTUAL PRODUCT REQUIREMENTS DOCUMENT

> **Source of Truth:** This PRD strictly represents the *actual* implemented codebase in d:\\template (Vite/React UI + ESP32 Firmware) as of current verification. Assumptions, future plans, and non-implemented "planned" features have been rigorously excluded or explicitly marked as not implemented.

## 1. Product Overview

The AgroTech system is a localized greenhouse automation platform designed to operate autonomously without internet reliance. It consists of an ESP32-S3 hardware controller (the authority on physical state and safety) and a Single Page Application (SPA) built with Vite/React for the operator interface. 

The product provides real-time monitoring of greenhouse telemetry, autonomous management of a crop cycle (Masa Tanam), and automated execution of fertigation batches (mixing raw water with nutrients and distributing it to the greenhouse).

## 2. Target Users

- **Greenhouse Operator / Farmer:** Interacts with the UI to monitor conditions, start/stop fertigation, track the age of the crop, and set daily schedules for watering.
- **Technician / Installer:** Installs the system, wires the GPIO pins, and uses the calibration features to ensure dosing pumps deliver the correct mL/sec of nutrients.
- **Researcher:** Uses the system to accurately track Days After Planting (HST) and Days After Pollination (HSP) against historical telemetry data to optimize crop yields.

## 3. Real-World Problems Solved

1. **Precision Fertigation:** Automates the tedious and error-prone process of filling a mixing tank, dosing exact amounts of nutrients A and B, mixing them for a set duration, and delivering the mixture to the crop.
2. **Crop Lifecycle Tracking:** Replaces manual calendars with a digital timeline tracking planting dates, pollination events, and harvest metrics.
3. **Equipment Protection (Dry Run):** Automatically shuts down pumps if water flow is not detected (e.g., pipe blockage or empty tank), preventing physical damage to the hardware.
4. **Resilience to Network Loss:** Schedules and active crop cycles are stored directly on the ESP32's non-volatile storage (NVS), ensuring the greenhouse continues operating even if the UI/WiFi goes offline.

## 4. Product Scope

The product currently encompasses:
- Single-greenhouse management (hardcoded to gh-01 in firmware).
- Volumetric fertigation batch execution.
- Real-time sensor monitoring (Temperature, Humidity, Light, Tank Levels, Flow).
- Simple time-based scheduling for pumps and fertigation.
- Hardware calibration for dosing pumps.
- Crop cycle timeline tracking.

## 5. Product Capability Map

- **Greenhouse Management:** Single unit tracking.
- **Crop Cycle Management:** Planting, pollination, harvest tracking.
- **Fertigation Management:** Automated multi-stage batch processing.
- **Scheduling:** Time-based daily and interval triggers.
- **Pump Management:** Manual overriding and automated control.
- **Calibration:** Dosing pump flow rate calculations.
- **Safety:** Emergency stop and dry-run timeouts.
- **Telemetry:** Real-time environmental sensing.

## 6. Complex Management

**Implementation Status:** PARTIAL (UI ONLY)
- **What the user can do:** In the UI, the user sees a "Complex" that aggregates multiple greenhouses and shared resources like a main well pump.
- **System behavior:** The firmware only officially supports operations on a single hardcoded greenhouse (gh-01). The concept of a Complex is largely a UI construct for future expansion.

## 7. Greenhouse Management

**Implementation Status:** FIRMWARE & UI
- **What the user can do:** View the current status of the greenhouse, including environmental metrics and active crop cycle.
- **System behavior:** The ESP32 maintains the state of gh-01, emitting telemetry and handling commands directed at it.

## 8. Crop Cycle Management

**Implementation Status:** IMPLEMENTED
- **What the user can do:** Start a new cycle (Tanggal Tanam), record pollination (Tanggal Polinasi), update plant count/variety, and mark the cycle as harvested with a yield (Kg) and grade.
- **Real-life workflow:** 
  1. Operator presses "Mulai Siklus" and inputs planting date.
  2. System begins tracking HST (Hari Setelah Tanam).
  3. Operator later records pollination date.
  4. System begins tracking HSP (Hari Setelah Polinasi).
  5. Operator ends cycle by recording harvest yield.
- **Persistence:** The cycle data is persisted in the ESP32 NVS. If power is lost, the cycle resumes accurately upon reboot.

## 9. Fertigation Management

**Implementation Status:** IMPLEMENTED
- **What the user can do:** Trigger an automated sequence that prepares and delivers nutrient water.
- **Real-life workflow:**
  1. Operator specifies target raw water (mL) and nutrients A/B (mL).
  2. **Filling Phase:** System turns on raw water submersible pump. It monitors the ZJ-B1 flow meter until the target raw water volume is reached.
  3. **Dosing Phase:** System turns on Dosing Pump A and B for a calculated duration (based on calibrated rate).
  4. **Mixing Phase:** System turns on the mixing pump for a hardcoded 3 minutes (180s) to blend the solution.
  5. **Delivery Phase:** System activates the distribution pump for a placeholder 1 minute (60s) to send water to the greenhouse.
- **Safety:** If the raw water pump runs for 30 seconds but the flow meter registers 0 pulses, the system aborts the batch to prevent dry-running.

## 10. Recipe Management

**Implementation Status:** PARTIAL (UI ONLY)
- **What the user can do:** Create named recipes (e.g., "Vegetative Mix") in the UI.
- **System behavior:** The ESP32 firmware does not store recipes. The UI translates a recipe into raw target numbers (Raw mL, Dosing A mL, Dosing B mL) and sends those directly to the ESP32 as a command.

## 11. Scheduling

**Implementation Status:** IMPLEMENTED (TIME-BASED ONLY)
- **What the user can do:** Schedule the well pump or a fertigation batch to run daily at a specific hour/minute, or on a repeating interval.
- **Automatic behavior:** A background task on the ESP32 evaluates schedules every 60 seconds. If a schedule is due, it dispatches the command internally.
- **Persistence:** Up to 16 schedules are saved to NVS and survive reboots.
- **Limitations:** The UI allows configuring "Temperature-based" schedules for fans, but the firmware **does not** implement this logic.

## 12. Pump Management

**Implementation Status:** IMPLEMENTED
- **What the user can do:** Manually turn on the Well Pump, Distribution Pump, or Dosing Pumps for a specific duration.
- **Automatic behavior:** The pumps stop automatically when the duration expires.

## 13. Valve / Actuator Management

**Implementation Status:** NOT IMPLEMENTED
- The system currently relies purely on pumps for fluid movement. No physical solenoid valves are modeled or controlled by the firmware.

## 14. Fan Management

**Implementation Status:** UI ONLY
- The UI exposes fan scheduling and manual toggles. The ESP32 firmware registers a pin for a cooling fan but does not expose it to the command manager or scheduler.

## 15. Water Management

**Implementation Status:** IMPLEMENTED
- **What the user can do:** Trigger a "Tank Transfer" from the raw source to the mixing tank.
- **System behavior:** Activates the raw submersible pump for the requested duration.

## 16. Calibration

**Implementation Status:** IMPLEMENTED
- **Real-life workflow:** 
  1. Technician places a graduated cylinder under Dosing Pump A.
  2. Technician clicks "Start Calibration".
  3. Pump runs for a specific time.
  4. Technician measures the actual liquid dispensed and enters it in the UI.
  5. System calculates the exact mL/sec rate.
- **System behavior:** The ESP32 stores this rate and uses it to calculate exact pump runtimes during fertigation dosing.

## 17. Monitoring & Telemetry

**Implementation Status:** IMPLEMENTED
- **What the user sees:** Real-time values for Temperature, Humidity, and Flow meter pulses.
- **System behavior:** The ESP32 continuously polls the sensors (e.g., DS18B20, YF-B1 flow meters) and serves the latest values via the /api/v1/telemetry endpoint.

## 18. Historical Data

**Implementation Status:** UI ONLY
- The ESP32 does not currently serve historical graph data. The UI either simulates this or relies on an external/future backend component.

## 19. Safety & Emergency Stop

**Implementation Status:** IMPLEMENTED
- **What the user can do:** Press the global "Emergency Stop" button in the UI.
- **System behavior:** The ESP32 immediately turns off all 7 actuator pins. The system enters a latched state where no commands can run until a "Resume" command is explicitly sent.
- **Automatic Safety:** The safe_boot_actuators() function guarantees all pins are OFF at power-on.

## 20. Automation

**Capabilities:**
1. **Time-Based Dispatch:** Evaluates schedules every minute against the RTC time.
2. **Sequential Batch Execution:** The fertigation manager autonomously steps through FILL -> DOSE -> MIX -> DELIVER without user intervention.
3. **Idempotency:** The command manager caches recent commands by ID to prevent double-execution if the UI retries a request.

## 21. Connectivity & Offline Behavior

**Implementation Status:** IMPLEMENTED
- The ESP32 operates as the authoritative brain. If WiFi is lost, the UI will disconnect, but the ESP32 will continue executing active schedules, crop cycle tracking, and safety interlocks.

## 22. Power Failure & Restart

**Implementation Status:** IMPLEMENTED
- **What stops:** Any active fertigation batch is lost (does not resume mid-batch).
- **What is persisted:** Crop cycle state, Schedules, Calibration rates.
- **What continues:** The DS3231 RTC module maintains the physical time via a coin-cell battery.

## 23. Device Management

**Implementation Status:** IMPLEMENTED
- The UI can query the device inventory and synchronize the physical RTC clock with the browser's time via the /api/v1/clock-sync endpoint.

## 24. User Workflows

### A. Starting a Crop Cycle
1. Operator navigates to Greenhouse.
2. Clicks "Mulai Siklus".
3. Enters variety (e.g., "Melon Inthanon"), plant count (1000), and planting date.
4. UI sends POST to /api/v1/greenhouses/gh-01/crop-cycles/start.
5. Firmware saves to NVS. The UI timeline updates to show "Fase Vegetatif".

### B. Performing Fertigation
1. Operator selects a recipe.
2. UI calculates target volumes (e.g., 5000mL water, 50mL Dose A, 50mL Dose B).
3. UI sends FERTIGATION_START command to ESP32.
4. Operator walks away.
5. ESP32 fills tank (monitoring flow pulses), injects nutrients A and B, mixes for 3 minutes, and delivers to the greenhouse.

## 25. User Journeys

**"Saya ingin menyiram GH-1 otomatis setiap pagi jam 6."**
- The operator creates a Daily Schedule in the UI for 06:00, action: FERTIGATION. 
- The UI sends the schedule to the ESP32.
- The ESP32 saves it to NVS. Every day at 06:00, the ESP32 automatically dispatches a FERTIGATION_START command.

**"Listrik mati saat sistem bekerja."**
- The system shuts off immediately. 
- Upon power restoration, safe_boot_actuators() keeps everything OFF. 
- The system reads the RTC time and resumes schedule checking. 
- The interrupted fertigation batch is NOT resumed (operator must trigger a new one).

## 26. Operating Modes

- **Idle:** System is waiting. Sensors are polled.
- **Running:** An automated batch or manual override is active.
- **Emergency Stop:** Latch activated. All actuators forced off. Commands rejected.

## 27. Configuration

- **Calibration Rates:** Set by technician. Persisted in NVS. Dictates dosing pump precision.
- **Clock:** Synced from UI. Vital for schedule execution.

## 28. Physical Equipment

- **Raw Water Submersible Pump:** Fills the mixing tank.
- **Mixing Pump:** Circulates water in the mixing tank (220V AC).
- **Dosing Pumps (A/B):** Precision peristaltic pumps for nutrients.
- **Distribution Pump:** Booster pump to send mixed water to the greenhouse.
- **DS3231 RTC:** I2C real-time clock.
- **ZJ-B1 Flow Meter:** Measures raw water entering the mixing tank.

## 29. Notifications / Errors / Alerts

- **Safety Timeout:** Emits an event to /api/v1/events if the raw pump runs dry.
- **UI Toasts:** Frontend surfaces API command rejections via toast notifications.

## 30. Limitations

- **Single Greenhouse Only:** Firmware explicitly rejects operations for any ID other than gh-01.
- **No Fan Control:** Firmware does not wire the fan actuator to the REST API.
- **No Target EC Control:** Fertigation is strictly volumetric. It doses exactly what it is told, without dynamic feedback loops adjusting based on EC sensor readings.
- **Delivery Duration:** The distribution phase of fertigation is hardcoded to 1 minute in the firmware.

## 31. Non-Obvious Capabilities

- **Command Idempotency:** The ESP32 caches the last 32 command IDs. If the UI sends the same command twice due to a network stutter, the ESP32 returns the cached status instead of double-dosing the plants.
- **Calibration Fallback:** If a technician attempts to dose but calibration is missing or 0, the firmware safely defaults the rate to 1.0 mL/sec to prevent a divide-by-zero crash.

## 32. UI vs Firmware Capability Matrix

| Capability | UI Exists | Firmware Exists | Physical Effect | Production Ready |
| ---------- | --------- | --------------- | --------------- | ---------------- |
| Manual Pumps | Yes | Yes | Yes | Yes |
| Fertigation | Yes | Yes | Yes | Yes |
| Crop Cycle | Yes | Yes | Yes | Yes |
| Time Schedules | Yes | Yes | Yes | Yes |
| Temp Schedules | Yes | No | No | No |
| Fan Control | Yes | No | No | No |
| Complex Mgt | Yes | No | No | No |
| Calibration | Yes | Yes | Yes | Yes |

## 33. Master Feature Matrix

| Domain | Feature | Manual/Auto | Firmware | Persistence | Status |
| ------ | ------- | ----------- | -------- | ----------- | ------ |
| GH | Crop Cycle Tracking | Manual | Yes | Yes (NVS) | IMPLEMENTED |
| FERT | Volumetric Batch | Auto | Yes | No | IMPLEMENTED |
| PUMPS | Manual Overrides | Manual | Yes | No | IMPLEMENTED |
| SCHED | Daily Triggers | Auto | Yes | Yes (NVS) | IMPLEMENTED |
| SCHED | Temp Triggers | Auto | No | No | UI ONLY |
| SAFETY | E-Stop | Manual | Yes | No | IMPLEMENTED |
| SAFETY | Flow Timeout | Auto | Yes | No | IMPLEMENTED |

## 34. Product Requirements

**PRD-FERT-001:** The system MUST allow the operator to initiate a volumetric fertigation batch specifying exact mL of raw water and nutrients.
**PRD-FERT-002:** The system MUST autonomously step through Filling, Dosing, Mixing, and Delivery phases without network connectivity.
**PRD-SAFE-001:** The system MUST abort filling and turn off the pump if 0 flow pulses are detected after 30 seconds of pump operation.
**PRD-SCHED-001:** The system MUST execute time-based schedules accurately, relying on a physical RTC.

## 35. Contradictions

- **CRITICAL:** UI allows the creation of "Temperature-based" fan schedules. The firmware pi_schedule_handlers.c parses this, but scheduler.c completely ignores it. This gives the operator the false impression that climate control is automated.
- **MEDIUM:** The UI allows viewing "Complex" level data, but the firmware API only acknowledges gh-01.

## 36. Implementation Status

The product is a solid MVP capable of basic volumetric fertigation and time-based scheduling. The core safety mechanisms (E-Stop, Boot Safety, Flow Timeouts) are production-ready. Advanced features (EC feedback, dynamic climate control) are not yet implemented in firmware.

## 37. What the Product Can Actually Do Today

If installed in a greenhouse today, an operator can use this system to:
1. Turn pumps on and off from their phone.
2. Define exact mL quantities of nutrients to mix with water.
3. Walk away while the system automatically fills a tank, doses the nutrients, stirs them for 3 minutes, and sprays the greenhouse.
4. Set a daily alarm clock (schedule) that triggers the above fertigation process every morning.
5. Track exactly how many days it has been since they planted their melon seeds.
6. Hit a big red Emergency Stop button on the screen if a pipe bursts, immediately cutting power to all pumps.

## 38. What Is Not Yet Implemented

- Reading pH or EC sensors to automatically adjust nutrient doses on the fly.
- Controlling cooling fans based on greenhouse temperature.
- Managing multiple greenhouses from a single ESP32 controller.
- Modifying the 3-minute mixing time (currently hardcoded).

## 39. Traceability Appendix

- **Crop Cycle Persistence:** esp32/main/services/crop_cycle_mgr.c
- **Fertigation State Machine:** esp32/main/services/fertigation_mgr.c
- **Safety Timeout:** ertigation_mgr_task() elapsed time vs flow pulses check.
- **Command Idempotency:** esp32/main/services/command_mgr.c (cache_insert / cache_find).
- **REST API Routes:** esp32/main/http/http_server.c
- **Schedules:** esp32/main/services/scheduler.c
\"\"\"

with open(\"ACTUAL_PRD.md\", \"w\", encoding=\"utf-8\") as f:
    f.write(prd_content)

print(\"ACTUAL_PRD.md generated successfully.\")
