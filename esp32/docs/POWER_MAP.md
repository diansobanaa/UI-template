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
│ ESP32 Vin / 5V, 4-Channel Relay Optocouplers & Coils, Flow Sensor VCC        │
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
│ Deep Well Pump AC (Omron #1), Distribution Booster Pump AC (Omron #2)        │
│ Conductors: Live (L), Neutral (N), Protective Earth (PE)                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Power Rails & Sources Specification

| Power Rail | Voltage Rating | Source / Provider | Destination / Loads | Ground Reference | Purpose | Verification Status |
|:---|:---:|:---|:---|:---|:---|:---:|
| **220V AC Mains** | 220V–240V AC 50Hz | AC Power Inlet Socket via 2-Pole 10A MCB | 12V 5A PSU, Well Pump (via Omron #1), Dist Pump (via Omron #2) | Protective Earth (AC-PE) | Primary grid power for heavy pumps and DC PSU | **VERIFIED ARCHITECTURE** |
| **12V DC Rail** | +12.0V DC (±5%) | Switching Power Supply 12V 5A (60W) | LM2596 IN+, Dosing A (12V), Dosing B (12V), Fan (12V), Submersible (12V) | GND_12V (Power Ground) | DC actuator motive power and buck input | **VERIFIED RAIL** |
| **5V DC Rail** | **5.05V DC** | LM2596 Buck Converter OUT+ | ESP32 5V (Vin), 4-Ch Relay Board (VCC & JD-VCC), Flow Meter VCC | GND_LV / Common DC Ground | Microcontroller supply and intermediate switching logic | **VERIFY WITH MULTIMETER** |
| **3.3V DC Rail** | +3.30V DC (±2%) | ESP32 Onboard LDO Regulator (3V3 Pins) | DS3231 RTC, DS18B20, ST7735 TFT (VCC & LED), Pull-up Resistors, Buttons | GND_LV (Clean Signal Ground) | Clean noise-free logic rail for sensors and peripherals | **VERIFIED RAIL** |

---

## 3. LM2596 Step-Down DC-DC Buck Converter

The LM2596 module steps down the unregulated 12V DC auxiliary supply into a regulated 5.05V DC supply for the ESP32 and logic modules.

### 3.1. Physical Terminal Pinout

| Terminal | Conductor | Connected Source | Planned Voltage | Ground Reference | Purpose | Status |
|:---:|:---|:---|:---:|:---|:---|:---:|
| **IN+** | Wire (+12V) | 12V 5A PSU (+ Output) | **+12.0V DC** | GND_12V | Primary DC voltage input | **VERIFIED** |
| **IN-** | Wire (GND) | 12V 5A PSU (- Output) | **0V Reference** | GND_12V | DC return / Power ground | **VERIFIED** |
| **OUT+**| Wire (+5V) | ESP32 5V (Vin) & 5V Rail | **5.05V DC ± 0.05V**| GND_LV | Regulated 5V output | **VERIFY WITH MULTIMETER** |
| **OUT-**| Wire (GND) | ESP32 GND & System GND | **0V Reference** | GND_LV | Common DC ground return | **VERIFIED** |

### 3.2. Mandatory Pre-Power Calibration Protocol
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

## 4. Relay Module Power & Jumper Architecture

### 4.1. 4-Channel 5V Relay Board Power Terminals
- **Physical Pins:** `VCC`, `JD-VCC`, `GND`
- **Jumper Configuration:** Jumper `VCC ↔ JD-VCC` is **INSTALLED** (bridged).

| Terminal | Connection | Voltage | Purpose | Notes & Constraints |
|:---:|:---|:---:|:---|:---|
| **VCC** | **+5V DC Rail** (from LM2596 OUT+) | **+5.05V DC** | Powers Optocoupler Anodes | Supplies optocoupler IR LEDs via onboard resistors. |
| **JD-VCC**| **Bridged to VCC via Jumper** | **+5.05V DC** | Powers Relay Coils | Directly shorts coil supply to 5V VCC rail. |
| **GND** | **ESP32 GND & LM2596 OUT-** | **0V Reference** | Signal Return | **MANDATORY COMMON GROUND:** When jumper is installed, GND must be tied to ESP32 GND for optocoupler cathode return current. |

### 4.2. Logic Level Compatibility & Jumper Warning
> [!WARNING]
> With the `VCC ↔ JD-VCC` jumper installed, VCC is at 5V.
> - When ESP32 GPIO outputs LOW (0V): Optocoupler is fully energized ($\Delta V = 5\text{V} - 0\text{V} = 5\text{V}$).
> - When ESP32 GPIO outputs HIGH (3.3V): Voltage difference across internal series LED pair is $5.0\text{V} - 3.3\text{V} = 1.7\text{V}$. Since the combined forward voltage $V_f$ of PC817 IR LED (~1.2V) + green SMD indicator LED (~1.8V) is ~3.0V, the optocoupler will normally turn off.
> - **Cutoff Verification:** Operator must verify with a DMM that the relay completely releases when GPIO is HIGH (3.3V). If relay chatters or fails to release, **remove the jumper**, connect `JD-VCC` to 5V, connect `VCC` to ESP32 3.3V, and isolate grounds.

---

## 5. Ground Topology & Common Ground Relationships

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

## 6. AC Power Loss & WLAN Heartbeat Monitoring (Anti-Sabotage Architecture)

### 6.1. Operating Principle & Threat Model
In greenhouse operations, malicious intruders or power sabotage often cut the main 220V AC utility power before attempting equipment or pump theft. If mains AC is severed:
1. The 12V 5A PSU ceases output.
2. The LM2596 drops out, causing immediate ESP32-S3 shutdown.
3. Because the ESP32 has lost power, it cannot transmit an outbound Wi-Fi alert independently without an expensive dedicated battery subsystem.

### 6.2. Autonomous Client-Side Heartbeat Watchdog (`ConnectionMonitor`)
To detect power loss without requiring cloud dependencies or cellular modems:
- The operator monitors the greenhouse via a mobile phone, tablet, or wall-mounted dashboard tablet (which has its own battery/UPS).
- The web application executes a background watchdog timer (`src/components/ConnectionMonitor.tsx`) polling the controller's `/api/v1/health` endpoint every 5,000 ms.
- **Fail Threshold:** 3 consecutive missed responses (15-second grace window). This filter guarantees that transient Wi-Fi packet drops do not cause false alarms.
- **Audible & Visual Alarm:**
  - When the threshold is breached, the client triggers a synthesized pulsing audio siren using the HTML5 Web Audio API (oscillator sweep: 880 Hz $\leftrightarrow$ 1760 Hz).
  - Fires an operating-system level desktop/mobile push alert using the HTML5 Notification API.
  - Displays a high-contrast modal alert banner: *"PERINGATAN: KONEKSI / LISTRIK ESP32 TERPUTUS!"*.
- **Local Network Resilience:** This architecture operates entirely on the local WLAN router without requiring external internet or third-party cloud brokers, completely eliminating false alarms due to ISP/internet downtime.

