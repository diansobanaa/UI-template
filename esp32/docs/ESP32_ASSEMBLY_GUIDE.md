# AgroTech Greenhouse Controller — ESP32-S3 Physical Assembly & Commissioning Guide

> **IMPORTANT WARNING — HIGH VOLTAGE & ELECTRICAL SAFETY**
> This system controls both Low-Voltage DC circuits (3.3V, 5V, 12V) and Mains High-Voltage AC circuits (220V–240V AC).
> Mains voltage can cause severe injury or death. Always disconnect main circuit breakers before wiring or inspecting terminals.
> Where explicit manufacturer electrical ratings or wire gauges are not provided in this repository, items are marked:
> `VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION`.
> Never present an unverified connection as safe or final.

---

## 1. Bill of Materials (BOM) & Modules (Actual Hardware Status)

| Item | Component / Module | Qty | Operating Voltage | Interface / Signal | Status & Function / Role |
|---|---|---|---|---|---|
| **MCU** | ESP32-S3-WROOM-1-N16R8 Dev Board (16MB Flash, 8MB Octal PSRAM) | 1 | 3.3V DC (5V USB/Vin) | GPIO / SPI / I2C / UART | **READY**: Main controller & runtime authority |
| **BREADBOARD**| 400-Point Breadboard + Wiring Accessories | 1 kit | N/A | Prototyping | **READY**: Workbench prototyping & sensor interconnect |
| **ETH** | W5500 SPI Ethernet Module | 1 | 3.3V DC | SPI (CS: GPIO 10) | **READY**: Hardwired local LAN interface |
| **WIFI-ANT** | External 2.4GHz 5dBi Antenna + U.FL to SMA Pigtail | 1 | Passive RF | U.FL / SMA | **READY**: External high-gain wireless network antenna |
| **RTC** | DS3231 High-Precision I2C RTC Module (6-pin: 32K, SQW, SCL, SDA, VCC, GND) | 1 | 3.3V DC | I2C (SDA: GPIO 8, SCL: GPIO 9) | **READY**: Battery-backed I2C RTC (32K & SQW NC; driver update pending) |
| **LCD** | ST7735 SPI TFT Display 1.8" (128 × 160) | 1 | 3.3V DC / 5V VCC | SPI (CS: 14, DC: 21, RST: 42, SCK: 11, MOSI: 12) | **READY**: Local status & diagnostics screen (ST7735 128x160 SPI) |
| **STORAGE** | MicroSD Card Slot (Built-in on back of TFT ST7735 module) | 1 | 3.3V DC | Shared SPI (CS: GPIO 48, SCK: 11, MOSI: 12, MISO: 13) | **UNVERIFIED**: Hardware slot present on TFT module; flash/boot pending |
| **FRAM** | Ferroelectric RAM | 0 | N/A | N/A | **NOT USED / NOT REQUIRED**: NVS & SPIFFS used for persistence |
| **RELAY-4CH** | 4-Channel Optocoupled Relay Board (VCC-JDVCC jumper installed) | 1 | 5V Coil | Active-LOW (IN1: GPIO 4, IN2: GPIO 18, IN3/IN4: TBD) | **READY**: Galvanic isolation for intermediate loads |
| **RELAY-OMR1**| Omron Industrial Heavy-Duty Relay #1 | 1 | 5V/12V Coil | High-voltage contacts (GPIO 1) | **READY**: Switches 220V AC Deep Well Pump |
| **RELAY-OMR2**| Omron Industrial Heavy-Duty Relay #2 | 1 | 5V/12V Coil | High-voltage contacts (GPIO 2) | **READY**: Switches 220V AC GH-1 Distribution Booster Pump |
| **MOSFET-15A**| High-Power MOSFET Driver Module 15A / 400W | 3 | 3.3V/5V Logic in, 12V out | Physical Pins TBD (GPIO 5, 6, 7) | **READY**: High-speed DC switching (Physical pins TBD) |
| **FLOW 1** | YF-B1 Hall-Effect Water Flow Sensor (DN15 / G1/2") | 1 | 5V DC (3.3V signal pullup) | Pulse output (GPIO 15) | **READY**: Main fertigation loop flow meter |
| **FLOW 2** | FS400A Hall-Effect Water Flow Sensor (G1") | 1 | 5V DC (3.3V signal pullup) | Pulse output (GPIO 16) | **READY**: Raw water source / supply flow meter |
| **TEMP** | DS18B20 Waterproof Temperature Probe | 1 | 3.3V / 5V DC | 1-Wire bus (GPIO 17) | **READY**: Water tank temperature monitoring (4.7kΩ pullup) |
| **FLOAT-LOW** | Stainless Steel Vertical Float Switch (Lower) | 1 | 3.3V signal (Dry Contact) | Digital input (GPIO 38) | **READY**: Mandatory safety STOP POINT for distribution/fertigation pump and feed pumps |
| **BUTTONS** | Momentary Push Buttons + 10kΩ / 100nF Debounce | 4 | 3.3V (Internal pullup) | Digital input (GPIO 0, 39, 40, 41) | **READY**: Button 1 (GPIO 0: TFT switch), Button 2 (GPIO 39: Well Pump 5-min toggle & float interlock), Button 3 (GPIO 40: Reserved), Button 4 (GPIO 41: Reserved) |
| **PSU 1** | Switching Power Supply 12V 5A (60W) | 1 | 220V AC in, 12V DC out | DC Power | **READY**: Powers 12V DC pumps, fan, and buck converter |
| **PSU 2** | LM2596 Step-down Buck Converter Module | 1 | 12V DC in, 5.05V DC out | DC Power (3A max) | **READY**: Powers ESP32 5V rail and logic modules |
| **AC-IN** | 3-in-1 AC Power Inlet Socket with Fuse & Switch | 1 | 250V AC 10A | Mains Power Entry | **READY**: Master power disconnect and fuse protection |
| **ACT-PUMP1** | Pompa Besar Sumur (Deep Well Submersible) | 1 | 220V AC Mains | Switched by Omron #1 | **READY**: Raw water replenishment into storage tank |
| **ACT-PUMP2** | Pompa Besar Distribusi / Fertigasi GH-1 | 1 | 220V AC Mains | Switched by Omron #2 | **READY**: Greenhouse 1 nutrition irrigation loop |
| **ACT-SUB12** | Submersible / Raw-Water Pump 12V DC | 1 | 12V DC | Switched by Relay/MOSFET | **READY**: Tank mixing, agitation, or transfer |
| **ACT-DOSE-A**| Dosing Pump A (Peristaltic 12V DC) | 1 | 12V DC | Switched by MOSFET #1 | **READY**: Concentrated nutrient solution A dosing |
| **ACT-DOSE-B**| Dosing Pump B (Peristaltic 12V DC) | 1 | 12V DC | Switched by MOSFET #2 | **READY**: Concentrated nutrient B / pH buffer dosing |
| **ACT-FAN** | Cooling / Exhaust Fan 12V DC | 1 | 12V DC | Switched by MOSFET #3 | **READY**: Cabinet ventilation / thermal control |
| **ACT-LAMP** | Red Pilot / Beacon Indicator Lamp | 1 | 12V DC / 5V | Switched by Relay Ch 4 | **READY**: Visual system error / emergency beacon |
| **DMM** | Digital Multimeter (DMM) with Probes | 1 | Battery | Test & Measurement | **READY**: Essential pre-power and bring-up verification tool |

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
| **GPIO 0** | Button 1: TFT Display Switch | INPUT | 3.3V Logic (Internal pullup) | Active-Low (Pressed = 0). Cycles ST7735 screen. Boot strap caveat. |
| **GPIO 21** | TFT Display Data / Command (DC) | OUTPUT | 3.3V Logic | High = Data, Low = Command |
| **GPIO 38** | Lower Float Switch (Dry-Run Protection) | INPUT | 3.3V Logic (Internal pullup) | Low = Dry (Trip), High = Normal (SAFETY AUTHORITY) |
| **GPIO 39** | Button 2: Well Pump Manual Toggle | INPUT | 3.3V Logic (Internal pullup) | Active-Low (0 = Pressed). State 1: ON (5-min timer), State 2: OFF. Float interlocked. |
| **GPIO 40** | Button 3: Reserved / TBD | INPUT | 3.3V Logic (Internal pullup) | Active-Low (0 = Pressed). Software debounced, no action assigned. |
| **GPIO 41** | Button 4: Reserved / TBD | INPUT | 3.3V Logic (Internal pullup) | Active-Low (0 = Pressed). Software debounced, no action assigned. |
| **GPIO 42** | TFT Display Reset (RST) | OUTPUT | 3.3V Logic | Active-Low |
| **GPIO 47** | Anti-Theft Tamper Loop (Pump Security) | INPUT | 3.3V Logic (Internal pullup) | Closed loop to GND = OK (0), Cut/Open = TAMPER TRIP (1) |
| **GPIO 48** | MicroSD Card Slot Chip Select (CS) | OUTPUT | 3.3V Logic | Active-Low (Onboard RGB LED line caveat) |

> **RESERVED PINS (DO NOT WIRE / DO NOT REASSIGN):**
> GPIO 3 (Strapping JTAG), GPIO 19 (Native USB D-), GPIO 20 (Native USB D+), GPIO 26–37 (Internal Octal Flash / Octal PSRAM — GPIO 35–37 broken out on header are FATAL if touched), GPIO 43–44 (UART0 TX/RX console), GPIO 45–46 (Strapping VDD_SPI / ROM).
> GPIO 22–25 do not exist in ESP32-S3 silicon.

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

### 4.2. Output Actuators (Relay Modules & MOSFET Drivers)
| Channel | Output Pin | Driver Module | Contact / Power Wiring | Load Controlled | Load Type |
|---|---|---|---|---|---|
| **Ch 1** | GPIO 1 | Relay Omron #1 (Heavy Duty) | 220V AC Live (COM1) → NO1 → Well Pump L | Deep Well Submersible Pump | 220V AC Mains |
| **Ch 2** | GPIO 2 | Relay Omron #2 (Heavy Duty) | 220V AC Live (COM2) → NO2 → Dist Pump L | Fertigation Booster Pump GH-1 | 220V AC Mains |
| **Ch 3** | GPIO 4 | 4-Ch Relay Board Ch 1 / MOSFET | 12V DC Pos (COM3) → NO3 → Submersible (+) | Raw Water Submersible Pump | 12V DC |
| **Ch 4** | GPIO 5 | MOSFET Module #1 (15A) | 12V DC Pos → Drain/Source → Dosing A (+) | Peristaltic Dosing Pump A | 12V DC (Nutrient) |
| **Ch 5** | GPIO 6 | MOSFET Module #2 (15A) | 12V DC Pos → Drain/Source → Dosing B (+) | Peristaltic Dosing Pump B | 12V DC (Acid/Nutrient) |
| **Ch 6** | GPIO 7 | MOSFET Module #3 (15A) | 12V DC Pos → Drain/Source → Fan (+) | Cabinet / Exhaust Fan | 12V DC |
| **Ch 7** | GPIO 18 | 4-Ch Relay Board Ch 2 | 12V DC Pos (COM7) → NO7 → Beacon (+) | Red Pilot / Alarm Lamp | 12V DC |

*Note: All loads are wired to Normally Open (NO) terminals or active-high MOSFET gates so they remain strictly de-energized during power-off or boot safe clamp.*

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
- **Lower Float Switch (Safety STOP POINT / Dry-Run Interlock):**
  - Terminal A: Connect to GPIO 38.
  - Terminal B: Connect to GND_LV.
  - Switch is oriented such that when water level is sufficient, float is raised (open contact with internal pull-up = 3.3V HIGH). When water drops to minimum safety level, float drops (closes contact to GND_LV = 0V LOW).
  - Firmware / Safety layer behavior: Lower float acts as the mandatory hardware safety STOP POINT for distribution/fertigation and feed pumps. Both manual commands and scheduler execution are immediately blocked/stopped when float is LOW.
- **Tank Capacity & High-Level Architecture (No Upper Float):**
  - Sensor tank full / upper float is **TIDAK DIGUNAKAN**.
  - Tank volume is strictly controlled via UI target volume input with capacity boundary validation (volume target cannot exceed configured tank capacity). No hardware upper float is wired.

### 4.4. Physical Operator Buttons
All buttons are momentary switches wired between the GPIO pin and clean `GND_LV`. The internal pull-up resistor on the ESP32 holds the line at 3.3V when open; depressing the button pulls the line to 0V:
- **MODE:** GPIO 0 to Button Pin 1; Button Pin 2 to GND_LV (Onboard BOOT switch or external NO button; must be released during boot).
- **MANUAL RUN A:** GPIO 39 to Button Pin 1; Button Pin 2 to GND_LV.
- **MANUAL RUN B:** GPIO 40 to Button Pin 1; Button Pin 2 to GND_LV.
- **DISTRIBUTION:** GPIO 41 to Button Pin 1; Button Pin 2 to GND_LV.

### 4.5. SPI Peripheral Bus Wiring
The SPI bus (SCK: 11, MOSI: 12, MISO: 13) is shared across W5500, TFT Display, and built-in MicroSD card slot. Keep wire lengths under 15 cm:
- **W5500 Ethernet:** SCK → GPIO 11, MOSI → GPIO 12, MISO → GPIO 13, CS → GPIO 10, RST → 3.3V (or NC), VCC → 3.3V, GND → GND_LV.
- **TFT Display (ST7735 1.8" 128×160 SPI):** SCK → GPIO 11, MOSI → GPIO 12, CS → GPIO 14, DC → GPIO 21, RST → GPIO 42, VCC → 3.3V / 5V, GND → GND_LV. (Hardware controller: ST7735. Do NOT substitute with 2.4" or 2.8" or ILI9341/ST7789).
- **MicroSD Slot (Built-in on back of TFT ST7735 Module):** SCK → GPIO 11, MOSI → GPIO 12, MISO → GPIO 13, CS → GPIO 48, VCC → 3.3V, GND → GND_LV. (*Card slot on TFT PCB; flash/boot verification pending*).

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
