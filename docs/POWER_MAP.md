# POWER DISTRIBUTION & ELECTRICAL DOMAIN MAP

**Document Role:** Power Architecture, Ground Segregation, and Voltage Domain Registry  
**Target Hardware:** AgroTech Greenhouse Controller Electrical Subsystem  
**Parent Contract:** [HARDWARE_WIRING_MAP.md](file:///d:/template/docs/HARDWARE_WIRING_MAP.md) (Canonical Hardware Wiring Contract)  
**Status:** **AUTHORITATIVE POWER CONTRACT**

---

## 1. Power Domain Segregation Overview

To prevent high-voltage transients, ground loops, and electrical noise from crashing the ESP32-S3 microcontroller, the controller implements four segregated electrical domains:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 1: 3.3V DC LOW-VOLTAGE LOGIC RAIL                                     │
│ ESP32-S3 SoC, DS3231 RTC, TFT Display Controller, DS18B20, Pull-up Resistors │
│ Ground: GND_LV (Clean Signal Ground)                                         │
└──────────────────────────────────────────────────────────────────────────────┘
                               ▲
           [ESP32 Onboard Low-Dropout (LDO) Regulator]
                               │
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 2: 5V DC REGULATED INTERMEDIATE RAIL                                  │
│ ESP32 Vin / 5V, 4-Channel Relay Optocouplers & Coils, Flow Sensor VCC,       │
│ MicroSD Adapter VCC (EasyWare EP000094, 4.5V-5.5V in -> onboard 3.3V LDO)    │
│ Ground: GND_LV / Common DC Ground                                            │
└──────────────────────────────────────────────────────────────────────────────┘
                               ▲
           [LM2596 Step-Down DC-DC Buck Converter (3A Max)]
                               │
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 3: 12V DC AUXILIARY POWER RAIL                                        │
│ Dosing Pump A, Dosing Pump B, Cooling Fan, Raw Submersible Pump              │
│ Ground: GND_12V (Heavy-Current Power Ground)                                 │
└──────────────────────────────────────────────────────────────────────────────┘
                               ▲
           [Switching Power Supply 12V 5A (60W)]
                               │
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 4: 220V–240V AC MAINS ELECTRICAL DOMAIN                               │
│ Deep Well Pump AC (Relay Ch 1), Dist Booster AC (Relay Ch 2), Blowers (Relay Ch 3), Mixing (Relay Ch 4)│
│ Conductors: Live (L), Neutral (N), Protective Earth (PE)                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Power Rails & Sources Specification

| Power Rail | Voltage Rating | Source / Provider | Destination / Loads | Ground Reference | Purpose | Verification Status |
|:---|:---:|:---|:---|:---|:---|:---:|
| **220V AC Mains** | 220V–240V AC 50Hz | AC Power Inlet Socket via 2-Pole 10A MCB | 12V 5A PSU, Well Pump (4-Ch Relay Ch 1), Dist Pump (4-Ch Relay Ch 2), 2x Blowers (4-Ch Relay Ch 3 via Contactor), Mixing Pond Pumps (4-Ch Relay Ch 4) | Protective Earth (AC-PE) | Primary grid power for heavy pumps and DC PSU | **VERIFIED ARCHITECTURE** |
| **12V DC Rail** | +12.0V DC (±5%) | Switching Power Supply 12V 5A (60W) | LM2596 IN+, Dosing A (12V), Dosing B (12V), Fan (12V), Submersible (12V) | GND_12V (Power Ground) | DC actuator motive power and buck input | **VERIFIED RAIL** |
| **5V DC Rail** | **5.05V DC** | LM2596 Buck Converter OUT+ | ESP32 5V (Vin), 4-Ch Relay Board (VCC & JD-VCC), Flow Meter VCC, Active Buzzer (~30mA via driver), MicroSD Adapter VCC (EasyWare EP000094, 4.5V~5.5V) | GND_LV / Common DC Ground | Microcontroller supply, acoustic alarm sounder, MicroSD adapter, and intermediate switching logic | **VERIFY WITH MULTIMETER** |
| **3.3V DC Rail** | +3.30V DC (±2%) | ESP32 Onboard LDO Regulator (3V3 Pins) | DS3231 RTC, DS18B20, DHT22 (Air Temp & RH), ST7735 TFT (VCC & LED), Pull-up Resistors, Buttons | GND_LV (Clean Signal Ground) | Clean noise-free logic rail for sensors and peripherals | **VERIFIED RAIL** |

---

## 3. AC Mains Distribution (Terminal Block TB-1506L)

To safely distribute the incoming high-voltage 220V AC mains to the 12V DC PSU and the relay-controlled heavy pumps, a 15 Ampere, 6-position Terminal Block (TB-1506L) is utilized.

| TB-1506L Pin | Designation | Source Connection | Destination / Jumpers |
|:---:|:---|:---|:---|
| **1** | Line (L) In | 220V AC Phase (from Plug/MCB) | Jumpered to Pin 2 |
| **2** | Line (L) Out | Jumpered from Pin 1 | To `L` on PSU 12V 5A & `COM` on Relay Board (AC Loads) |
| **3** | Neutral (N) In | 220V AC Neutral (from Plug) | Jumpered to Pin 4 |
| **4** | Neutral (N) Out | Jumpered from Pin 3 | To `N` on PSU 12V 5A & direct to AC Pump Neutrals |
| **5** | Earth (PE) In | 220V AC Earth/Ground | Jumpered to Pin 6 |
| **6** | Earth (PE) Out | Jumpered from Pin 5 | To Chassis Ground on PSU 12V 5A & metallic pump bodies |

---

## 4. LM2596 Step-Down DC-DC Buck Converter

The LM2596 module steps down the unregulated 12V DC auxiliary supply into a regulated 5.05V DC supply for the ESP32 and logic modules.

### 4.1. Physical Terminal Pinout

| Terminal | Conductor | Connected Source | Planned Voltage | Ground Reference | Purpose | Status |
|:---:|:---|:---|:---:|:---|:---|:---:|
| **IN+** | Wire (+12V) | 12V 5A PSU (+ Output) | **+12.0V DC** | GND_12V | Primary DC voltage input | **VERIFIED** |
| **IN-** | Wire (GND) | 12V 5A PSU (- Output) | **0V Reference** | GND_12V | DC return / Power ground | **VERIFIED** |
| **OUT+**| Wire (+5V) | ESP32 5V (Vin) & 5V Rail | **5.05V DC ± 0.05V**| GND_LV | Regulated 5V output | **VERIFY WITH MULTIMETER** |
| **OUT-**| Wire (GND) | ESP32 GND & System GND | **0V Reference** | GND_LV | Common DC ground return | **VERIFIED** |

### 4.2. Mandatory Pre-Power Calibration Protocol
> [!CAUTION]
> **HIGH VOLTAGE HAZARD TO ESP32:**
> Standard LM2596 modules ship with their multi-turn trimpots set to random positions, capable of outputting up to 35V DC!
> 1. Connect `IN+` and `IN-` to the 12V DC power supply.
> 2. **DO NOT CONNECT `OUT+` TO THE ESP32 OR ANY COMPONENT.**
> 3. Power on the 12V power supply.
> 4. Measure the voltage across `OUT+` and `OUT-` using a Digital Multimeter (DMM).
> 5. Turn the brass screw on the blue potentiometer counter-clockwise until the meter reads **EXACTLY 5.05V DC ± 0.05V**.
> 6. Only after verifying 5.05V DC with the DMM may the `OUT+` wire be connected to the ESP32 board or relay module!

---

## 5. Relay Module Power & Jumper Architecture

### 5.1. 4-Channel 5V Relay Board Power Terminals
- **Physical Pins:** `VCC`, `JD-VCC`, `GND`
- **Jumper Configuration:** Jumper `VCC ↔ JD-VCC` is **INSTALLED** (bridged).

| Terminal | Connection | Voltage | Purpose | Notes & Constraints |
|:---:|:---|:---:|:---|:---|
| **VCC** | **+5V DC Rail** (from LM2596 OUT+) | **+5.05V DC** | Powers Optocoupler Anodes | Supplies optocoupler IR LEDs via onboard resistors. |
| **JD-VCC**| **Bridged to VCC via Jumper** | **+5.05V DC** | Powers Relay Coils | Directly shorts coil supply to 5V VCC rail. |
| **GND** | **ESP32 GND & LM2596 OUT-** | **0V Reference** | Signal Return | **MANDATORY COMMON GROUND:** When jumper is installed, GND must be tied to ESP32 GND for optocoupler cathode return current. |

### 5.2. Logic Level Compatibility & Jumper Warning
> [!WARNING]
> With the `VCC ↔ JD-VCC` jumper installed, VCC is at 5V.
> - When ESP32 GPIO outputs LOW (0V): Optocoupler is fully energized ($\Delta V = 5\text{V} - 0\text{V} = 5\text{V}$).
> - When ESP32 GPIO outputs HIGH (3.3V): Voltage difference across internal series LED pair is $5.0\text{V} - 3.3\text{V} = 1.7\text{V}$. Since the combined forward voltage $V_f$ of PC817 IR LED (~1.2V) + green SMD indicator LED (~1.8V) is ~3.0V, the optocoupler will normally turn off.
> - **Cutoff Verification:** Operator must verify with a DMM that the relay completely releases when GPIO is HIGH (3.3V). If relay chatters or fails to release, **remove the jumper**, connect `JD-VCC` to 5V, connect `VCC` to ESP32 3.3V, and isolate grounds.

---

## 6. Ground Topology & Common Ground Relationships

To avoid ground loop noise while ensuring proper logic return:

1. **Common DC Ground (GND_LV):**
   - The negative output of the LM2596 buck converter (`OUT-`) connects directly to the ESP32 `GND` pins.
   - All 3.3V and 5V sensor grounds (DS18B20, DS3231 RTC, TFT, Flow Meters, Lower Float, Buttons, Anti-Theft Tamper Loop) return to `GND_LV`.
2. **Auxiliary 12V Power Ground (GND_12V):**
   - On standard LM2596 modules, `IN-` and `OUT-` share a common copper ground plane on the PCB. Therefore, `GND_12V` and `GND_LV` are tied at a single point inside the LM2596.
   - High-current return paths from 12V DC pumps (dosing pumps, fan, submersible) must return directly to the 12V PSU negative terminal, **NEVER through the ESP32 breadboard jumpers**.
3. **Protective Earth Ground (PE):**
   - AC Earth (Green/Yellow wire) connects to the metal DIN rail, cabinet chassis ground stud, and metallic pump bodies.
   - **NEVER connect PE or AC Neutral to DC Ground (`GND_LV` or `GND_12V`).**
   - **Anti-Theft Tamper Isolation:** The physical closed loop for pump security (`PIN_IN_TAMPER_LOOP 47`) must return exclusively to `GND_LV`. Do not attempt to use the AC earth conductor (PE) as the signal return, as ground potential differentials or AC leakage will damage the ESP32-S3 SoC.

---

## 7. AC Power Loss & WLAN Heartbeat Monitoring (Anti-Sabotage Architecture)

### 7.1. Operating Principle & Threat Model
In greenhouse operations, malicious intruders or power sabotage often cut the main 220V AC utility power before attempting equipment or pump theft. If mains AC is severed:
1. The 12V 5A PSU ceases output.
2. The LM2596 drops out, causing immediate ESP32-S3 shutdown.
3. Because the ESP32 has lost power, it cannot transmit an outbound Wi-Fi alert independently without an expensive dedicated battery subsystem.

### 7.2. Autonomous Client-Side Heartbeat Watchdog (`ConnectionMonitor`)
To detect power loss without requiring cloud dependencies or cellular modems:
- The operator monitors the greenhouse via a mobile phone, tablet, or wall-mounted dashboard tablet (which has its own battery/UPS).
- The web application executes a background watchdog timer (`src/components/ConnectionMonitor.tsx`) polling the controller's `/api/v1/health` endpoint every 5,000 ms with an isolated `HEALTH_TIMEOUT_MS = 2500` ms timeout.
- **Single-Flight Concurrency:** The watchdog implements `healthRequestInFlight` locking to prevent request storms and overlapping HTTP probes on congested or dropping networks.
- **Registration & Scoping Gate:** The watchdog timer groups complexes deterministically by controller identity (`deviceId` or `endpoint`). In multi-controller configurations, liveness failure on one controller only isolates and marks its owned Complex/Greenhouse resources offline without affecting independent controllers.
- **Fail Threshold:** 2 consecutive missed responses (detecting complete power or connection severance in ~5–8 seconds). This filter guarantees that a single transient Wi-Fi packet drop does not trigger false alarms while promptly reporting power severance.
- **Audible & Visual Alarm:**
  - When the threshold is breached, the client triggers a synthesized pulsing audio siren using the HTML5 Web Audio API (oscillator sweep: 880 Hz $\leftrightarrow$ 1760 Hz).
  - Fires an operating-system level desktop/mobile push alert using the HTML5 Notification API.
  - Displays a high-contrast modal alert banner: *"PERINGATAN: KONEKSI / LISTRIK ESP32 TERPUTUS!"*.
- **Local Network Resilience:** This architecture operates entirely on the local WLAN router without requiring external internet or third-party cloud brokers, completely eliminating false alarms due to ISP/internet downtime.



## 8. Deep Well Pump Electrical & Mechanical Safety Interlocks

### 8.1. Autonomous 220V AC Physical Radar Interlock (Tank-Full Cutoff)
The Deep Well Pump (4-Channel Relay Ch 1, GPIO 1) incorporates an independent, non-software safety interlock:
- **Physical Radar Switch:** An external mechanical 220V AC radar float switch installed inside the raw water storage tank is wired in direct series with the 220V AC live conductor feeding the well pump motor/contactor coil.
- **Autonomous Mechanical Action:** When the raw water tank fills to capacity, the radar switch mechanically disconnects 220V power to the pump motor, completely independent of the ESP32.
- **Firmware Authority:** The ESP32 does not monitor the radar switch state directly as electrical telemetry. Commanded ON state indicates that the relay contact is closed; physical motor rotation depends on the radar circuit remaining closed.
- **No flow-meter dependency:** Deep Well Pump (`pump_well`, Relay Ch 1 / GPIO 1) does not require a water-flow sensor for manual start, schedule start, or runtime watchdog. `FLOW_TIMEOUT` protection applies to flow-feedback pumps such as raw submersible, distribution/delivery, and fertigation pumps.

### 8.2. Firmware 15-Minute Hard Manual Safety Clamp
To prevent well motor overheating or dry-cavitation during unmonitored manual overrides:
- Both physical manual button presses (Button A / GPIO 39) and Web UI manual toggle commands are clamped by ESP32 firmware to a strict **maximum runtime of 15 minutes (900 seconds)** (`manual_actuator_mgr.c` and `command_mgr.c`).
- When the 900s timeout expires, the ESP32 automatically releases the relay and halts well pump operation.

---

## 9. Power-Loss Recovery — Well Pump & Fan/Blower (Schedule-Driven)

Scope: **Well Pump and Fan/Blower only.** Fertigation, dosing, mixing, raw-water, and other actuators are NOT covered by this model.

- **Principle:** After reboot, no previous FreeRTOS task or elapsed runtime is restored. The existing schedule table + current wall-clock time is the sole source of truth.
- **Condition (exact):** `schedule_start <= now < schedule_end`. Exact start → ON; exact end → OFF. DAILY/INTERVAL schedules are evaluated against the current day-of-week and seconds-of-day; ONCE schedules against epoch.
- **`lazy_start`:** `app_main()` calls `scheduler_schedule_lazy_start()` as its last step. This spawns a one-shot, self-deleting task (`lazy_start_task` in `esp32/main/services/scheduler.c`, 3584 B stack) so reconciliation never runs on the boot call stack. It waits up to 10 s for a valid clock, reconciles Fan/Blower (`scheduler_reconcile_fan_schedule`), takes a fresh sensor sample (`sensor_hal_poll`), then reconciles Well Pump (`well_pump_reconcile_schedule`), and sets `s_lazy_start_done`. If the clock never becomes valid, recovery is skipped and actuators stay OFF.
- **Manual precedence:** There is no Well Pump AUTO/MANUAL mode. Manual OFF during an active schedule suppresses schedule reactivation until its window ends. If an existing manual ON session crosses into a schedule window, the schedule end stops it instead of the earlier manual timeout. A new manual ON remains bounded by the 15-minute limit.
- **Hand-off:** Until `lazy_start` completes, the 1 s scheduler tick does not reconcile these actuators; afterwards the same two reconcile functions run on the normal scheduler tick (no second scheduler, no extra timer).
- **Boot marker handling:** Persisted `RUNNING` markers for Well Pump / Fan/Blower schedules are reset to `EMPTY` (not `RECOVERY_HOLD`) at hydration, because these actuators are window-driven.
- **Safety precedence (unchanged):** ON requests go through `actuator_hal` / `well_pump_mgr` only. E-stop latch (persisted across reboot), safety-fault latch, safety-owner lock, and max-runtime protection all still reject or force OFF. An active schedule never overrides them; after a validated operator RESUME, the next scheduler tick re-applies the window.
- **Sensor seed:** `sensor_hal_init()` seeds `last_sample_timestamp` at init so the safety monitor does not trip `SAFETY_SENSOR_STALE` on restored flow-protected pumps before the first periodic poll. Well Pump is not flow-protected by firmware.
- **Verification:** `scripts/test_power_loss_recovery.py` (RTS hard reset on COM3).

---

## Network Configuration and Runtime Isolation

Network provisioning, reconnect, and temporary Direct Local/Network Change Mode are communication functions only. They must not be treated as authority to stop or reset physical loads. Entering or leaving temporary network mode does not intentionally interrupt the scheduler, safety monitoring, E-stop monitoring, sensor sampling, fertigation runtime, local event logging, or fail-safe actuator controls.

No network recovery feature changes the documented electrical power domains or actuator GPIO mapping in this document.
