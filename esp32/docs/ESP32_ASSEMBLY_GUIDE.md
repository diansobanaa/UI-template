# AgroTech Greenhouse Controller — ESP32-S3 Physical Assembly & Commissioning Guide

> **IMPORTANT WARNING — HIGH VOLTAGE & ELECTRICAL SAFETY**
> This system controls both Low-Voltage DC circuits (3.3V, 5V, 12V) and Mains High-Voltage AC circuits (220V–240V AC).
> Mains voltage can cause severe injury or death. Always disconnect main circuit breakers before wiring or inspecting terminals.
> Where explicit manufacturer electrical ratings or wire gauges are not provided in this repository, items are marked:
> `VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION`.
> Never present an unverified connection as safe or final.

---

## 1. Bill of Materials (BOM) & Modules

| Item | Component / Module | Qty | Operating Voltage | Interface / Signal | Function / Role |
|---|---|---|---|---|---|
| **MCU** | ESP32-S3-WROOM-1 / DevKitC-1 (16MB Flash, 8MB Octal PSRAM) | 1 | 3.3V DC (5V USB/Vin) | GPIO / SPI / I2C / UART | Main controller & runtime authority |
| **ETH** | W5500 SPI Ethernet Module | 1 | 3.3V DC | SPI (CS: GPIO 10) | Hardwired local LAN connection |
| **RTC** | DS3231 High-Precision I2C RTC Module | 1 | 3.3V DC | I2C (SDA: 8, SCL: 9) | Hardware battery-backed real-time clock |
| **LCD** | ST7789 / ILI9341 SPI TFT Display (2.8" or 3.2") | 1 | 3.3V DC / 5V VCC | SPI (CS: 14, DC: 21, RST: 42) | Local status & diagnostics screen |
| **STORAGE** | MicroSD SPI Card Socket Module | 1 | 3.3V DC | SPI (CS: GPIO 27) | Local telemetry & event log storage |
| **RELAY** | 8-Channel Optocoupled Relay Board (5V/12V coil, 250VAC/10A contacts) | 1 | 5V / 12V Coil | Digital active-low inputs (0=ON, 1=OFF) | Actuator galvanic isolation & switching |
| **FLOW 1** | YF-B1 Hall-Effect Water Flow Sensor (DN15 / G1/2") | 1 | 5V DC (3.3V signal pullup) | Pulse output (GPIO 15) | Main fertigation loop flow meter |
| **FLOW 2** | FS400A Hall-Effect Water Flow Sensor (G1") | 1 | 5V DC (3.3V signal pullup) | Pulse output (GPIO 16) | Raw water source / supply flow meter |
| **TEMP** | DS18B20 Waterproof Temperature Probe | 1 | 3.3V / 5V DC | 1-Wire bus (GPIO 17) | Water tank temperature monitoring |
| **LEVEL** | Stainless Steel Vertical Float Switch (Normally Open) | 1 | 3.3V signal (Dry Contact) | Digital input (GPIO 26) | Low-level dry-run safety interlock |
| **BUTTONS** | Momentary Push Buttons (16mm / 22mm IP65 panel mount) | 4 | 3.3V (Internal pullup) | Digital input (GPIO 38, 39, 40, 41) | MODE, MANUAL A, MANUAL B, DISTRIB |
| **PSU 1** | Industrial DIN-Rail Power Supply 12V DC (e.g. Mean Well MDR-60-12) | 1 | 220V AC in, 12V DC out | DC Power | Powers 12V dosing pumps, fan, relay coils |
| **PSU 2** | Step-down Buck Converter / DC-DC Regulator (12V to 5V 3A) | 1 | 12V DC in, 5.0V DC out | DC Power | Powers ESP32 5V rail and W5500 / TFT |
| **ENCL** | IP65 Electrical Enclosure Box with DIN rail & cable glands | 1 | N/A | Mechanical | Weatherproof environmental housing |

---

## 2. Final ESP32-S3 Pin Map

This pin mapping is identical to `esp32/main/config/pin_config.h` and must not be altered:

| GPIO Pin | Function / Target Module | Direction | Electrical Domain | Active State / Note |
|---|---|---|---|---|
| **GPIO 1** | Well Pump Relay Trigger | OUTPUT | 3.3V Logic → Relay Opto | Active-LOW (0 = Run, 1 = Safe OFF) |
| **GPIO 2** | Distribution Pump Relay Trigger | OUTPUT | 3.3V Logic → Relay Opto | Active-LOW (0 = Run, 1 = Safe OFF) |
| **GPIO 4** | Raw Submersible Pump Relay Trigger | OUTPUT | 3.3V Logic → Relay Opto | Active-LOW (0 = Run, 1 = Safe OFF) |
| **GPIO 5** | Dosing Pump A Relay Trigger | OUTPUT | 3.3V Logic → Relay Opto | Active-LOW (0 = Run, 1 = Safe OFF) |
| **GPIO 6** | Dosing Pump B Relay Trigger | OUTPUT | 3.3V Logic → Relay Opto | Active-LOW (0 = Run, 1 = Safe OFF) |
| **GPIO 7** | Cabinet Cooling Fan Relay / MOSFET | OUTPUT | 3.3V Logic → Driver | Active-LOW (0 = Fan ON, 1 = Safe OFF) |
| **GPIO 8** | I2C SDA (DS3231 RTC / Sensors) | BIDIR | 3.3V Logic | Pull-up 4.7kΩ to 3.3V |
| **GPIO 9** | I2C SCL (DS3231 RTC / Sensors) | OUTPUT | 3.3V Logic | Pull-up 4.7kΩ to 3.3V |
| **GPIO 10** | W5500 SPI Ethernet Chip Select (CS) | OUTPUT | 3.3V Logic | Active-Low (SPI Bus) |
| **GPIO 11** | SPI SCK (Shared SPI Clock) | OUTPUT | 3.3V Logic | W5500, TFT, MicroSD |
| **GPIO 12** | SPI MOSI (Master Out Slave In) | OUTPUT | 3.3V Logic | W5500, TFT, MicroSD |
| **GPIO 13** | SPI MISO (Master In Slave Out) | INPUT | 3.3V Logic | W5500, MicroSD |
| **GPIO 14** | TFT Display Chip Select (CS) | OUTPUT | 3.3V Logic | Active-Low |
| **GPIO 15** | YF-B1 Flow Sensor Pulse Input | INPUT | 3.3V Logic (Level shifted) | Interrupt on Rising Edge |
| **GPIO 16** | FS400A Flow Sensor Pulse Input | INPUT | 3.3V Logic (Level shifted) | Interrupt on Rising Edge |
| **GPIO 17** | DS18B20 1-Wire Temperature Data | BIDIR | 3.3V Logic | Pull-up 4.7kΩ to 3.3V |
| **GPIO 18** | System Status / Error Beacon Lamp | OUTPUT | 3.3V Logic → Driver | Active-LOW (0 = Lamp ON, 1 = OFF) |
| **GPIO 21** | TFT Display Data / Command (DC) | OUTPUT | 3.3V Logic | High = Data, Low = Command |
| **GPIO 26** | Lower Float Switch (Dry-Run Protection) | INPUT | 3.3V Logic (Internal pullup) | Low = Dry (Trip), High = Normal |
| **GPIO 27** | MicroSD Card Chip Select (CS) | OUTPUT | 3.3V Logic | Active-Low (SPI Bus) |
| **GPIO 38** | Physical Button: MODE Switch | INPUT | 3.3V Logic (Internal pullup) | Active-Low (Pressed = 0) |
| **GPIO 39** | Physical Button: MANUAL RUN A | INPUT | 3.3V Logic (Internal pullup) | Active-Low (Pressed = 0) |
| **GPIO 40** | Physical Button: MANUAL RUN B | INPUT | 3.3V Logic (Internal pullup) | Active-Low (Pressed = 0) |
| **GPIO 41** | Physical Button: DISTRIBUTION | INPUT | 3.3V Logic (Internal pullup) | Active-Low (Pressed = 0) |
| **GPIO 42** | TFT Display Reset (RST) | OUTPUT | 3.3V Logic | Active-Low |

> **RESERVED PINS (DO NOT WIRE / DO NOT REASSIGN):**
> GPIO 0 (Boot strap), GPIO 3 (JTAG), GPIO 19 (Native USB D-), GPIO 20 (Native USB D+), GPIO 33–37 (Octal PSRAM / SPI Flash), GPIO 43–44 (UART0 TX/RX console), GPIO 45–46 (VDD_SPI), GPIO 47 (Octal PSRAM CS), GPIO 48 (RGB WS2812).

---

## 3. Power-Domain Overview & Electrical Isolation

The controller enclosure contains three strictly segregated power domains:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 1: LOW-VOLTAGE ELECTRONICS (3.3V & 5V DC)                             │
│ ESP32-S3, W5500, DS3231, TFT Display, MicroSD, Pull-up resistors             │
│ Ground: GND_LV (Isolated Clean Signal Ground)                                │
└──────────────────────────────────────────────────────────────────────────────┘
                               ▲
                 [Optocouplers / Galvanic Barrier]
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 2: AUXILIARY DC POWER (12V DC)                                        │
│ Dosing Pump A, Dosing Pump B, Cabinet Cooling Fan, Relay Coils               │
│ Ground: GND_12V (Power Ground — do NOT connect directly to ESP32 pins!)       │
└──────────────────────────────────────────────────────────────────────────────┘
                               ▲
                 [Electromechanical Relay Air-Gap Contacts]
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMAIN 3: MAINS HIGH-VOLTAGE (220V–240V AC 50Hz)                             │
│ Deep Well Pump, Distribution Pump, Raw Water Submersible Pump                │
│ Live (L), Neutral (N), Protective Earth (PE)                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Critical Grounding & Isolation Rules
1. **Never tie GND_LV directly to AC Neutral (N) or AC Live (L).** This would cause catastrophic destruction and fatal shock hazard.
2. **Protective Earth (PE):** Connect green/yellow earth wire directly to the enclosure mounting chassis, DIN rail, and metallic pump bodies.
3. **Optocoupler Isolation:** The 8-channel relay board MUST use a separate jumper setup (remove `VCC-JDVCC` jumper):
   - `VCC` pin connects to ESP32 5V (powers optocoupler LEDs).
   - `JD-VCC` pin connects to 12V PSU (or 5V auxiliary supply) powering relay electromagnetic coils.
   - `GND` on relay logic header remains isolated from coil ground where possible.
4. **Inductive Kickback Protection:** Every 12V DC inductive load (dosing pumps, 12V DC fans) MUST have a reverse-biased flyback diode (e.g. 1N4007 or UF4007) wired in parallel directly across the load terminals.
5. **AC Contact Snubbers:** AC pumps should have an RC snubber network (100Ω + 0.1µF 630V AC rated) across the relay contacts to extinguish inductive arcing.

---

## 4. Detailed Wiring Instructions

### 4.1. Power Supplies & Regulators
1. AC Mains Line (L) passes through a 2-pole 10A Miniature Circuit Breaker (MCB) on the DIN rail.
2. Neutral (N) and Earth (PE) connect to dedicated terminal distribution blocks.
3. Connect 220V AC input of the 12V DC PSU to the switched MCB output.
4. Connect 12V DC output of PSU to the DC-DC step-down buck converter (input side).
5. Adjust or verify the buck converter output voltage to exactly **5.05V DC ± 0.05V** before connecting to the ESP32.
6. Connect buck converter 5V output to the ESP32 `5V` (or `Vin`) pin and `GND` to ESP32 `GND`.

### 4.2. Output Actuators (Relay Board)
| Channel | Output Pin | Relay Input | Relay Contact Wiring | Load Controlled |
|---|---|---|---|---|
| **Ch 1** | GPIO 1 | IN1 | 220V AC Live (COM1) → NO1 → Well Pump L | Deep Well Submersible Pump |
| **Ch 2** | GPIO 2 | IN2 | 220V AC Live (COM2) → NO2 → Dist Pump L | Fertigation Irrigation Booster Pump |
| **Ch 3** | GPIO 4 | IN3 | 220V AC Live (COM3) → NO3 → Raw Sub L | Raw Water Tank Agitator / Pump |
| **Ch 4** | GPIO 5 | IN4 | 12V DC Pos (COM4) → NO4 → Dosing A (+) | Peristaltic Dosing Pump A (Nutrient) |
| **Ch 5** | GPIO 6 | IN5 | 12V DC Pos (COM5) → NO5 → Dosing B (+) | Peristaltic Dosing Pump B (Acid/Nutrient) |
| **Ch 6** | GPIO 7 | IN6 | 12V DC Pos (COM6) → NO6 → Fan (+) | Enclosure / Greenhouse Exhaust Fan |
| **Ch 7** | GPIO 18 | IN7 | 12V DC Pos (COM7) → NO7 → Beacon (+) | Flashing Error / Warning Beacon |

*Note: All loads are wired to Normally Open (NO) terminals so they remain de-energized during power-off or boot safe clamp.*

### 4.3. Sensors & Level Switches
- **YF-B1 (Flow Sensor 1):**
  - Red wire: Connect to +5V DC.
  - Black wire: Connect to GND_LV.
  - Yellow wire (Signal): Connect to GPIO 15.
  - *Level Shifting:* Because the sensor runs at 5V, use a resistive voltage divider (2.2kΩ / 3.3kΩ) or bidirectional logic level shifter to ensure signal voltage does not exceed 3.3V into GPIO 15.
- **FS400A (Flow Sensor 2):**
  - Red wire: Connect to +5V DC.
  - Black wire: Connect to GND_LV.
  - Yellow wire (Signal): Connect to GPIO 16 via logic level divider to 3.3V.
- **DS18B20 (Water Temperature):**
  - Red wire (VCC): Connect to 3.3V DC.
  - Black wire (GND): Connect to GND_LV.
  - Yellow/White wire (Data): Connect to GPIO 17. Solder a 4.7kΩ pull-up resistor between Data and 3.3V.
- **Lower Float Switch (Dry-Run Protection):**
  - Terminal A: Connect to GPIO 26.
  - Terminal B: Connect to GND_LV.
  - Switch is oriented such that when the water level is sufficient, the float is raised (open contact with internal pull-up = 3.3V HIGH). When water is low, float drops (closes contact to GND_LV = 0V LOW). The firmware evaluates GPIO 26: High (1) = Normal/OK, Low (0) = Dry Trip.

### 4.4. Physical Operator Buttons
All buttons are momentary switches wired between the GPIO pin and clean `GND_LV`. The internal pull-up resistor on the ESP32 holds the line at 3.3V when open; depressing the button pulls the line to 0V:
- **MODE:** GPIO 38 to Button Pin 1; Button Pin 2 to GND_LV.
- **MANUAL RUN A:** GPIO 39 to Button Pin 1; Button Pin 2 to GND_LV.
- **MANUAL RUN B:** GPIO 40 to Button Pin 1; Button Pin 2 to GND_LV.
- **DISTRIBUTION:** GPIO 41 to Button Pin 1; Button Pin 2 to GND_LV.

### 4.5. SPI Peripheral Bus Wiring
The SPI bus (SCK: 11, MOSI: 12, MISO: 13) is shared across W5500, TFT Display, and MicroSD card. Keep wire lengths under 15 cm:
- **W5500 Ethernet:** SCK → GPIO 11, MOSI → GPIO 12, MISO → GPIO 13, CS → GPIO 10, RST → 3.3V (or NC), VCC → 3.3V, GND → GND_LV.
- **TFT Display:** SCK → GPIO 11, MOSI → GPIO 12, CS → GPIO 14, DC → GPIO 21, RST → GPIO 42, VCC → 3.3V / 5V, GND → GND_LV.
- **MicroSD Module:** SCK → GPIO 11, MOSI → GPIO 12, MISO → GPIO 13, CS → GPIO 27, VCC → 3.3V, GND → GND_LV.

---

## 5. Driver & Interface Requirements

1. **Relay Boards:** Must use optocoupled transistor buffers (e.g. PC817 + ULN2803 or discrete NPN). The ESP32 cannot source coil current directly from GPIO.
2. **Pull-Up Resistors:**
   - I2C (GPIO 8 / GPIO 9): External 4.7kΩ pull-up resistors to 3.3V.
   - 1-Wire DS18B20 (GPIO 17): External 4.7kΩ pull-up resistor to 3.3V.
3. **Wire Sizing:**
   - Low-voltage signals: 24 AWG or 26 AWG stranded copper.
   - 12V DC power lines: 18 AWG stranded copper.
   - 220V AC pump circuits: 14 AWG or 16 AWG (minimum 1.5 mm²) copper wire rated for 600V.

---

## 6. Connector & Wire Labeling Conventions

To prevent miswiring during field servicing, apply heat-shrink or printed wire markers at both ends of each conductor:

- **Power Wiring:**
  - `AC-L`: 220V AC Live (Brown or Black)
  - `AC-N`: 220V AC Neutral (Blue)
  - `AC-PE`: Earth Ground (Green/Yellow)
  - `+12V`: 12V DC Positive (Red)
  - `GND-12V`: 12V DC Return (Black)
  - `+5V`: 5V Regulated (Orange)
  - `+3V3`: 3.3V Logic Supply (Yellow)
  - `GND-LV`: Clean Signal Ground (Gray or White)
- **Signal Wiring:**
  - `REL-1` through `REL-7`: Actuator control channels
  - `SEN-FLOW1`, `SEN-FLOW2`: Flow pulse inputs
  - `SEN-TEMP`: DS18B20 1-Wire signal
  - `SW-FLOAT-L`: Lower float switch
  - `BTN-MODE`, `BTN-MAN-A`, `BTN-MAN-B`, `BTN-DIST`: Push buttons
  - `SPI-CLK`, `SPI-MOSI`, `SPI-MISO`: SPI Bus lines
  - `CS-ETH`, `CS-TFT`, `CS-SD`: Chip select lines

---

## 7. Step-by-Step Physical Assembly Order

1. **Chassis & DIN Rail Mounting:**
   - Mount DIN rail sections securely inside the IP65 enclosure.
   - Install 2-pole AC MCB, 12V power supply, 5V buck converter, terminal blocks, and relay board on the DIN rail.
2. **Mains AC Wiring:**
   - Route AC inlet cable through lower-right cable gland.
   - Wire Live into MCB, Neutral into neutral busbar, and PE to the chassis ground stud.
   - Wire MCB output to 12V PSU AC input and relay common terminals (COM1, COM2, COM3).
   - *Keep AC wiring physically separated by at least 50mm from low-voltage signal lines.*
3. **12V DC Subsystem Wiring:**
   - Wire 12V PSU output to the relay JD-VCC header (if 12V coils), DC buck converter input, and relay COM4/COM5/COM6.
   - Wire dosing pump outputs through lower-middle cable glands.
4. **Low-Voltage Subsystem Wiring:**
   - Mount ESP32 carrier / breakout board.
   - Wire 5V and GND_LV from buck converter output to ESP32.
   - Mount W5500, DS3231 RTC, MicroSD module, and TFT display.
   - Wire SPI bus, I2C bus, and individual chip-select lines.
5. **Sensor & Button Wiring:**
   - Route sensor cables through lower-left cable glands.
   - Install pull-up resistors for DS18B20 and level dividers for flow meters.
   - Wire buttons on the enclosure front lid to GPIO 38–41.
6. **Final Mechanical Inspection:**
   - Tighten all screw terminal blocks.
   - Secure wire bundles with nylon zip ties and slotted trunking.

---

## 8. Pre-Power Inspection Checklist

Before connecting any power source, inspect the following:

- [ ] **Visual Separation:** Minimum 50mm clearance between AC mains and DC low-voltage wiring.
- [ ] **Ground Continuity:** Resistance between AC Earth stud, DIN rail, and chassis metal < 0.5Ω.
- [ ] **No Cross-Domain Shorts:** Megohmmeter or multimeter check between AC Live/Neutral and DC GND_LV confirms infinite resistance (> 20MΩ).
- [ ] **Terminal Tightness:** Tug test performed on every screw terminal; no loose wire strands.
- [ ] **Capacitor & Diode Polarity:** Buck converter and flyback diodes oriented correctly.
- [ ] **Relay Jumper Setup:** VCC and JD-VCC properly configured for isolated operation.
- [ ] **Fuse / Breaker Rating:** MCB rated at 10A or lower; DC PSU protected.

---

## 9. First Power-Up Procedure

Follow this strict sequence to prevent component damage:

1. **Stage 1 — DC Power Supply Only:**
   - Disconnect ESP32 and all sensors from the power bus.
   - Leave AC pump circuits disconnected.
   - Turn ON the AC MCB.
   - Measure 12V PSU output: Verify **12.0V ± 0.3V DC**.
   - Measure 5V buck converter output: Verify **5.0V to 5.1V DC**.
   - Turn OFF MCB.
2. **Stage 2 — ESP32 Safe Boot Verification:**
   - Connect 5V and GND to the ESP32. Keep actuator loads disconnected.
   - Turn ON MCB.
   - Verify ESP32 power LED illuminates steady without heat or smoke.
   - Measure GPIO 1, 2, 4, 5, 6, 7, 18 with multimeter: All pins must read **0.0V (Logic LOW)** during boot.
   - Turn OFF MCB.
3. **Stage 3 — Full Control Electronics:**
   - Reconnect relay inputs, sensors, W5500, display, and buttons.
   - Power ON. Verify display lights up and no relay chatters.

---

## 10. Continuity & Short-Circuit Verification

Use a digital multimeter in continuity / resistance mode:

| Test Points | Expected Value | Fault Condition & Action |
|---|---|---|
| +5V Rail to GND_LV | > 10kΩ (charging curve) | 0Ω indicates short circuit; do NOT apply power! |
| +3.3V Rail to GND_LV | > 5kΩ (charging curve) | 0Ω indicates fried chip or solder bridge. |
| 12V Rail to GND_12V | > 5kΩ | Short on 12V line or reverse diode. |
| AC Live to GND_LV | Open Circuit (OL / ∞) | Isolation barrier breach! Inspect relay isolation immediately. |
| AC Neutral to GND_LV | Open Circuit (OL / ∞) | Isolation barrier breach! Danger of electrocution. |
| AC Earth to Metal Chassis | < 0.2Ω | Inadequate earthing; improve bonding connection. |

---

## 11. GPIO Bring-Up Test Procedure

With firmware installed, verify hardware pin states using console logs or test commands:

1. **Boot Clamp Check:**
   - Monitor UART serial console at 115200 baud (`GPIO 43/44`).
   - Check log output: `[ACTUATOR_HAL] Boot safe clamp: All 7 channels forced OFF (0V)`.
   - Relay LEDs on the 8-channel board must remain dark.
2. **Button Read Test:**
   - Press MODE button: Console should report `PIN_BTN_MODE: PRESSED (0)`.
   - Press MANUAL A button: Console should report `PIN_BTN_MANUAL_A: PRESSED (0)`.
   - Press MANUAL B button: Console should report `PIN_BTN_MANUAL_B: PRESSED (0)`.
   - Press DISTRIBUTION button: Console should report `PIN_BTN_DISTRIBUTION: PRESSED (0)`.

---

## 12. Sensor Verification Procedure

1. **DS18B20 Temperature:**
   - Submerge probe in room temperature water. Verify telemetry shows ~24°C–28°C.
   - Dip into warm water. Verify temperature reading updates within 2 seconds.
2. **Flow Sensor YF-B1:**
   - Blow gently into sensor chamber or run water through.
   - Verify pulse counts increment and telemetry flow rate reflects positive value.
3. **Lower Float Switch:**
   - Lift float: Telemetry reports `dryRunProtectionActive: false`.
   - Drop float: Telemetry reports `dryRunProtectionActive: true` and safety monitor logs dry-run warning.

---

## 13. Actuator Verification Procedure

Test each output channel individually with dummy loads or multimeter:

1. **Dosing Pump A & B:**
   - Trigger manual test run from UI or REST API (`POST /api/v1/commands`).
   - Verify relay clicks ON, 12V is applied, and peristaltic motor rotates.
2. **Cooling Fan:**
   - Check that cooling fan turns ON when temperature exceeds 45°C or test command issued.
3. **Well Pump & Distribution Pump Relays:**
   - Verify relay NO contact closes and voltage reaches AC output terminals.

---

## 14. Network Bring-Up Procedure

1. Connect RJ-45 cable from local greenhouse router/switch into W5500 port (or configure Wi-Fi credentials).
2. Check link LEDs on W5500 jack: Green LED steady (Link), Amber LED flickering (Activity).
3. Ping controller IP (default `192.168.1.50` or DHCP assigned):
   ```bash
   ping 192.168.1.50
   ```
4. Perform HTTP Health check:
   ```bash
   curl -i http://192.168.1.50/api/v1/health
   ```
   Verify HTTP 200 OK response with JSON payload.

---

## 15. Safe-State & Emergency Stop Verification

1. **Software Emergency Stop:**
   - Send `POST /api/v1/commands/emergency-stop` from UI or terminal.
   - Measure all 7 actuator pins: All must immediately drop to 0V (relays drop out).
   - Verify system latches in E-stop state and rejects subsequent pump start commands until resumed.
2. **Hardware Power Interruption:**
   - Cut main power breaker while pumps are active.
   - Restore breaker: Verify controller boots cleanly with all pumps remaining **OFF** until commanded.

---

## 16. Firmware Flashing & Configuration

1. Connect PC to ESP32-S3 USB port (`GPIO 19/20 USB` or UART bridge `GPIO 43/44`).
2. Flash firmware image using ESP-IDF:
   ```bash
   idf.py -p COM_PORT flash monitor
   ```
3. Verify partition table initializes: NVS (`0x9000`), Storage (`0x10000`), Factory (`0x20000`), SPIFFS (`0x620000`).
4. Perform clock synchronization:
   ```bash
   curl -X POST http://192.168.1.50/api/v1/clock-sync \
     -H "Content-Type: application/json" \
     -d "{\"utcNow\":\"2026-09-13T12:00:00Z\",\"source\":\"UI\"}"
   ```

---

## 17. Troubleshooting Guide

| Symptom / Fault | Potential Cause | Diagnostic & Rectification |
|---|---|---|
| **ESP32 loops in boot crash / Brownout** | Insufficient 5V supply current | Verify buck converter can deliver 2A–3A peak. Replace thin USB cable with direct 18 AWG power wires. |
| **Pumps turn ON briefly at boot** | Active-low relay board inverted logic or floating inputs | Ensure relay is connected to Normally Open (NO) terminals. Firmware defaults to Active-LOW (`ACTUATOR_ACTIVE_LEVEL = 0`) with inactive pin state forced to HIGH (3.3V) with pull-up. |
| **W5500 Ethernet not detected** | SPI wiring error or clock too fast | Verify SCK (11), MOSI (12), MISO (13), and CS (10). Check that SPI bus speed is set to 20MHz or lower. Note: Wi-Fi STA+AP is default network in Phase 1 firmware. |
| **DS18B20 reads -127°C or 85°C** | Missing 4.7kΩ pull-up resistor | Solder 4.7kΩ resistor between Data (GPIO 17) and 3.3V. Check for loose terminal connection. |
| **Flow sensor registers zero pulses** | 5V signal not triggering 3.3V input | Verify voltage divider wiring and pulse input on oscilloscope or LED indicator. |
| **SD card mount failure** | Card format not FAT32 or loose CS | Format microSD as FAT32 (32KB cluster). Check CS pin is wired to GPIO 27 (PIN_MICROSD_CS). |

---

## 18. Final Commissioning Checklist (PASS / FAIL)

Every item on this checklist must be inspected, verified, and signed off before handing the system over for live agricultural production:

| Item # | Verification Criteria | Status | Sign-off / Notes |
|---|---|---|---|
| **C-01** | Low-voltage and mains AC wiring physically separated by > 50mm | [ ] PASS  [ ] FAIL | |
| **C-02** | Chassis protective earth continuity < 0.2Ω | [ ] PASS  [ ] FAIL | |
| **C-03** | Isolation barrier between AC and DC grounds > 20MΩ | [ ] PASS  [ ] FAIL | |
| **C-04** | 5.05V DC buck converter voltage verified with DMM | [ ] PASS  [ ] FAIL | |
| **C-05** | Boot safe clamp verified: All 7 output channels measure 0V at boot | [ ] PASS  [ ] FAIL | |
| **C-06** | W5500 Ethernet connects and responds to ping | [ ] PASS  [ ] FAIL | |
| **C-07** | DS3231 RTC maintains time across power-cycle | [ ] PASS  [ ] FAIL | |
| **C-08** | YF-B1 and FS400A flow sensors increment pulse counts under flow | [ ] PASS  [ ] FAIL | |
| **C-09** | DS18B20 temperature sensor returns valid ambient reading | [ ] PASS  [ ] FAIL | |
| **C-10** | Lower float switch triggers dry-run alarm when dropped | [ ] PASS  [ ] FAIL | |
| **C-11** | Emergency stop command immediately shuts off all actuators | [ ] PASS  [ ] FAIL | |
| **C-12** | All 4 physical push buttons register debounced presses | [ ] PASS  [ ] FAIL | |
| **C-13** | MicroSD card mounts and logs telemetry events | [ ] PASS  [ ] FAIL | |
| **C-14** | REST API responds to all 25 canonical routes in `UI_ESP32_OPENAPI.yaml` | [ ] PASS  [ ] FAIL | |
| **C-15** | UI connects directly over LAN and syncs crop-cycle state | [ ] PASS  [ ] FAIL | |

---

## Known Unknowns / Requires Physical Verification

> **VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION:**
> 1. **Dosing Pump Operating Current:** Peristaltic pump surge current may vary between 0.5A and 1.8A depending on tube thickness and motor size. Verify PSU rating supports concurrent running of Pump A + Pump B.
> 2. **Deep Well Submersible AC Inrush:** Deep well pumps typically exhibit an inrush current of 4× to 7× running current. If the pump exceeds 1.5 kW (2 HP), an intermediate industrial contactor (magnetic switch) MUST be installed between the relay output and pump motor.
> 3. **Float Switch Contact Orientation:** Stainless steel float switches can be configured as Normally Open or Normally Closed by flipping the cylindrical float ring. Ensure the float orientation matches the firmware expectation (Float UP = Normal, Float DOWN = Dry-run trip).
> 4. **MicroSD Card Class:** Use Class 10 or Industrial Grade SLC/pSLC cards formatted FAT32. High-capacity SDXC cards (>32GB) must be reformatted with FAT32 cluster geometry.
