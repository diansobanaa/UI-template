# CANONICAL HARDWARE WIRING CONTRACT

**Document Authority:** Single Authoritative Hardware Wiring Contract for AgroTech Greenhouse Controller  
**Scope:** Strict Contract Between Firmware Source $\longleftrightarrow$ Component Physical Breakout $\longleftrightarrow$ Field Wiring  
**Target Hardware:** ESP32-S3-WROOM-1-N16R8 (16MB Octal Flash, 8MB Octal PSRAM)  
**Status:** **ACTIVE BINDING CONTRACT (AUDITED & SYNCHRONIZED)**

> [!TIP]
> **Visual Architecture Diagram:** Untuk peta visual flowchart (Mermaid) interaktif yang merender blok ESP32 dan seluruh periferal, buka [ESP32_PERIPHERAL_VISUAL_MAP.md](file:///d:/template/docs/ESP32_PERIPHERAL_VISUAL_MAP.md).

---

## 1. Contract Overview & Guiding Rules

1. **Novice Technician Rule:** A technician with no prior background must be able to inspect any pin on the ESP32 and determine:
   * Exactly which physical component pin it connects to.
   * What physical wire or interface connects them.
   * Which power domain energizes the circuit.
   * The exact circuit path (including intermediate drivers, optocouplers, and level shifters).
   * The operational purpose and active logic level.
   * The software verification status.
2. **Firmware Consistency Rule:** The firmware source code (`pin_config.h` and HAL drivers) MUST strictly match the GPIO allocations in this contract. Any discrepancy is an explicit blocker that must be resolved.
3. **No Guessing / Anti-Slop Rule:** Hardware pins or parameters that have not been physically supplied or measured are strictly marked **TBD** or **UNVERIFIED**. No fictional pinouts are permitted.

---

## 2. Master Wiring Contract Table

| ID | ESP32 Pin | Header Pin | Component | Component Pin | Wire / Interface | Power Domain | Purpose | Direction | Active Level | Electrical / Interface Notes | Verification Status |
|:---:|:---:|:---:|:---|:---:|:---|:---:|:---|:---:|:---:|:---|:---:|
| **W-01** | **GPIO 0** | Right-14 | Mode Push Button | Pin 1 | Stranded Wire | 3.3V Logic | System Mode Toggle (Auto/Manual) | Input | Active-LOW (0=Push) | Onboard BOOT button / Ext NO switch. Must be HIGH at boot. | **ACCEPTABLE CAVEAT** |
| **W-02** | **GPIO 1** | Right-4 | Omron Relay #1 | Logic In / Driver | Digital Control | 3.3V Logic | Deep Well AC Pump Contactor Trigger | Output | Active-LOW (0=Run) | Triggers intermediate driver for Omron 220V AC relay. | **VERIFIED SAFE** |
| **W-03** | **GPIO 2** | Right-5 | Omron Relay #2 | Logic In / Driver | Digital Control | 3.3V Logic | Dist Booster AC Pump Contactor Trigger | Output | Active-LOW (0=Run) | Triggers intermediate driver for Omron 220V AC relay. | **VERIFIED SAFE** |
| **W-04** | **GPIO 4** | Left-4 | 4-Ch Relay Board | **IN1** | Digital Control | 5V Logic | Raw Water Submersible Pump Trigger | Output | Active-LOW (0=ON) | Sinks optocoupler cathode. Switched 12V DC load on relay COM1/NO1. | **VERIFIED SAFE** |
| **W-05** | **GPIO 5** | Left-5 | MOSFET Module #1 | **TRIG-PWM** (GND to ESP32 GND) | Digital Control | 3.3V/5V Logic | Dosing Pump A Trigger (Nutrient) | Output | Active-LOW (in hal) | Gate trigger for 12V DC peristaltic pump. Switched 12V DC out. | **VERIFIED SAFE** |
| **W-06** | **GPIO 6** | Left-6 | MOSFET Module #2 | **TRIG-PWM** (GND to ESP32 GND) | Digital Control | 3.3V/5V Logic | Dosing Pump B Trigger (pH/Buffer) | Output | Active-LOW (in hal) | Gate trigger for 12V DC peristaltic pump. Switched 12V DC out. | **VERIFIED SAFE** |
| **W-07** | **GPIO 7** | Left-7 | MOSFET Module #3 | **TRIG-PWM** (GND to ESP32 GND) | Digital Control | 3.3V/5V Logic | Cabinet Exhaust Fan Trigger | Output | Active-LOW (in hal) | Gate trigger for 12V DC brushless fan. Switched 12V DC out. | **VERIFIED SAFE** |
| **W-08** | **GPIO 8** | Left-12 | DS3231 RTC Module | **SDA** | I2C Bus | 3.3V Logic | I2C Serial Data line | Bi-directional | Open-Drain | Requires 4.7kΩ pull-up to 3.3V (onboard module/external). | **VERIFIED** |
| **W-09** | **GPIO 9** | Left-15 | DS3231 RTC Module | **SCL** | I2C Bus | 3.3V Logic | I2C Serial Clock line | Output | Open-Drain | Requires 4.7kΩ pull-up to 3.3V (onboard module/external). | **VERIFIED** |
| **W-10** | **GPIO 10** | Left-16 | W5500 Ethernet | **CS** | SPI Chip Select | 3.3V Logic | Hardwired LAN Ethernet CS | Output | Active-LOW (0=Select)| **NOT USED IN CURRENT COMMISSIONING** | **NOT USED** |
| **W-11** | **GPIO 11** | Left-17 | TFT Display & SD | **SCK / SD_SCK** | Shared SPI Clock | 3.3V Logic | Master SPI Clock (SPI2_HOST) | Output | Mode 0 (Rising) | Bus shared between ST7735 TFT and integrated SD slot. | **VERIFIED** |
| **W-12** | **GPIO 12** | Left-18 | TFT Display & SD | **SDA / SD_MOSI**| Shared SPI MOSI | 3.3V Logic | Master Out Slave In (Data to Periph)| Output | Serial Data | Bus shared between ST7735 TFT and integrated SD slot. | **VERIFIED** |
| **W-13** | **GPIO 13** | Left-19 | MicroSD Card Slot | **SD_MISO** | Shared SPI MISO | 3.3V Logic | Master In Slave Out (Data from SD) | Input | Serial Data | Dedicated return line from SD card slot on back of TFT. | **UNVERIFIED** |
| **W-14** | **GPIO 14** | Left-20 | TFT ST7735 Display| **CS** | Dedicated SPI CS | 3.3V Logic | Display Controller Chip Select | Output | Active-LOW (0=Select)| Dedicated CS for Sitronix ST7735 controller. | **VERIFIED** |
| **W-15** | **GPIO 15** | Left-8 | Flow Sensor YF-B1 | **Signal (Yellow)**| Pulse Divider | 3.3V Pulse | Fertigation Loop Flow Meter Counter | Input | Interrupt Pulse | 5V pulse scaled via 2.2kΩ/3.3kΩ voltage divider to 3.3V. | **VERIFIED** |
| **W-16** | **GPIO 16** | Left-9 | Flow Sensor FS400A| **Signal (Yellow)**| Pulse Divider | 3.3V Pulse | Raw Supply Intake Flow Meter Counter | Input | Interrupt Pulse | 5V pulse scaled via 2.2kΩ/3.3kΩ voltage divider to 3.3V. | **VERIFIED** |
| **W-17** | **GPIO 17** | Left-10 | DS18B20 Temp Probe| **DAT (Yellow)** | 1-Wire Bus | 3.3V Logic | Nutrient Tank Temperature Data | Bi-directional | Open-Drain | **MANDATORY:** 4.7kΩ pull-up to 3.3V (NOT in series). | **VERIFIED** |
| **W-18** | **GPIO 18** | Left-11 | 4-Ch Relay Board | **IN2** | Digital Control | 5V Logic | Red System Error / Alarm Beacon | Output | Active-LOW (0=ON) | Sinks optocoupler cathode. Switched load on relay COM2/NO2. | **VERIFIED SAFE** |
| **W-19** | **GPIO 21** | Right-18 | TFT ST7735 Display| **A0 (DC)** | Control Line | 3.3V Logic | Display Command / Data Selector | Output | High=Data, Low=Cmd | Dedicated control line for ST7735. | **VERIFIED** |
| **W-20** | **GPIO 38** | Right-10 | Lower Float Switch | Terminal A | Dry Contact | 3.3V Logic | **MANDATORY SAFETY DRY-RUN INTERLOCK** | Input | Active-LOW (0=DRY) | Internal pull-up to 3.3V. Dedicated clean safety pin. | **VERIFIED SAFE (SAFETY)**|
| **W-21** | **GPIO 39** | Right-9 | Manual A Button | Pin 1 | Stranded Wire | 3.3V Logic | Manual Dosing Pump A Toggle Switch | Input | Active-LOW (0=Push) | Internal pull-up to 3.3V. Momentary NO tactile switch. | **VERIFIED SAFE** |
| **W-22** | **GPIO 40** | Right-8 | Manual B Button | Pin 1 | Stranded Wire | 3.3V Logic | Manual Dosing Pump B Toggle Switch | Input | Active-LOW (0=Push) | Internal pull-up to 3.3V. Momentary NO tactile switch. | **VERIFIED SAFE** |
| **W-23** | **GPIO 41** | Right-7 | Distribution Button| Pin 1 | Stranded Wire | 3.3V Logic | Manual Distribution Pump Toggle | Input | Active-LOW (0=Push) | Internal pull-up to 3.3V. Momentary NO tactile switch. | **VERIFIED SAFE** |
| **W-24** | **GPIO 42** | Right-6 | TFT ST7735 Display| **RESET** | Control Line | 3.3V Logic | Display Hardware Reset | Output | Active-LOW (0=Reset) | Dedicated hardware reset line for ST7735. | **VERIFIED** |
| **W-25** | **GPIO 47** | Right-17 | Anti-Theft Loop | **Tamper Loop In** | Closed Loop Wire | 3.3V Logic | **MANDATORY SECURITY & ANTI-THEFT INTERLOCK** | Input | Active-HIGH (0=OK, 1=Cut) | Closed loop to GND_LV through pump chassis/conduit. Internal pull-up to 3.3V. Cutting loop trips Rule 4 Emergency Stop. | **VERIFIED SAFE (SECURITY)** |
| **W-26** | **GPIO 48** | Right-16 | MicroSD Card Slot | **SD_CS** | Dedicated SPI CS | 3.3V Logic | Integrated SD Slot Chip Select | Output | Active-LOW (0=Select)| Drives SD CS on back of TFT. Caveat: Onboard WS2812 DIN. | **UNVERIFIED** |
| **W-27** | **5V (Vin)**| Left-21 | LM2596 Regulator | **OUT+** | Power Conductor | 5.05V DC | ESP32 Board Main DC Power Input | Power In | 5.05V DC Regulated | **MANDATORY:** Pre-calibrate trimpot with DMM before connecting! | **VERIFY DMM** |
| **W-28** | **3V3 Rail**| Left-1 / 2 | Sensors & Display | **VCC / LED** | Power Conductor | 3.3V DC | 3.3V Sensor & Peripheral Supply Rail | Power Out | 3.30V DC Regulated | Supplies DS3231, DS18B20, ST7735 VCC/LED, pull-up resistors. | **VERIFIED RAIL** |
| **W-29** | **GND Rail**| Left-22 / R-1 | System Electronics | **GND** | Ground Plane | 0V Reference | Common Low-Voltage Signal Ground | Ground | 0V Reference | Common return for ESP32, sensors, buttons, LM2596 OUT-. | **VERIFIED RAIL** |

---

## 3. Subsystem Wiring Architecture & ASCII Schematics

### 3.1. Temperature Sensor (DS18B20 1-Wire Interface)
> [!IMPORTANT]
> The 4.7 kΩ pull-up resistor must be wired in **parallel between 3.3V and DATA**, NEVER in series!

```text
3.3V Rail ─────────────────┬─────────────────── VCC (Red Wire)
                           │
                         [4.7kΩ] Pull-up Resistor
                           │
ESP32 GPIO 17 ─────────────┴─────────────────── DATA (Yellow/White Wire)

ESP32 GND ───────────────────────────────────── GND (Black Wire)
```

---

### 3.2. Real-Time Clock (DS3231 I2C Module)
> [!NOTE]
> Physical pins `32K` and `SQW` are left **NOT CONNECTED (NC)**. Module is powered from 3.3V to match ESP32 logic.

```text
ESP32 GPIO 9 (Left-15) ──────────────────────── SCL
                                                 │
ESP32 GPIO 8 (Left-12) ──────────────────────── SDA
                                                 │
3.3V Rail (Left-1/2)   ──────────────────────── VCC
                                                 │
ESP32 GND (Left-22)    ──────────────────────── GND
                                                 │
                       [NC / Unconnected] ───── 32K
                                                 │
                       [NC / Unconnected] ───── SQW
```

---

### 3.3. TFT Display ST7735 & Built-In SD Card Slot (Shared SPI Bus)
> [!NOTE]
> SCK (GPIO 11) and MOSI (GPIO 12) are wired in parallel to both display and SD card pins.
> CS lines are strictly dedicated: TFT CS is GPIO 14, SD CS is GPIO 48.

```text
                        ┌──────────────────────────────┐
                        │   1.8" TFT ST7735 + SD PCB   │
                        ├──────────────────────────────┤
ESP32 3V3 ──────────────┤ LED   (Pin 1 - Backlight)    │
ESP32 GPIO 11 (SCK) ────┤ SCK   (Pin 2 - SPI Clock)    ├──┬── SD_SCK  (Back Pin 4)
ESP32 GPIO 12 (MOSI) ───┤ SDA   (Pin 3 - SPI MOSI)     ├──┼── SD_MOSI (Back Pin 2)
ESP32 GPIO 21 (DC) ─────┤ A0    (Pin 4 - Data/Command) │  │
ESP32 GPIO 42 (RST) ────┤ RESET (Pin 5 - Hardware RST) │  │
ESP32 GPIO 14 (CS) ─────┤ CS    (Pin 6 - Display CS)   │  │
ESP32 GND ──────────────┤ GND   (Pin 7 - Power Ground) │  │
ESP32 3V3 ──────────────┤ VCC   (Pin 8 - Power Supply) │  │
                        └──────────────────────────────┘  │
ESP32 GPIO 13 (MISO) ─────────────────────────────────────┼── SD_MISO (Back Pin 3)
ESP32 GPIO 48 (SD_CS)─────────────────────────────────────┴── SD_CS   (Back Pin 1)
```

---

### 3.4. Water Flow Sensors (YF-B1 & FS400A Level-Shifting)
> [!WARNING]
> Hall-effect sensors run on 5V DC. Their pulse output must pass through a resistive voltage divider (2.2kΩ / 3.3kΩ) to protect ESP32 inputs from 5V over-voltage.

```text
5V Rail (from LM2596) ──────────────────────── VCC (Red Wire)
                                                │
Sensor Pulse Out (Yellow) ─── [2.2kΩ] ──┬────── GPIO 15 (YF-B1) / GPIO 16 (FS400A)
                                        │
                                     [3.3kΩ]
                                        │
ESP32 GND ──────────────────────────────┴────── GND (Black Wire)
```

---

### 3.5. Safety Dry-Run Interlock (Lower Float Switch)
> [!IMPORTANT]
> The Lower Float switch provides **zero-latency hardware interlock** against pump dry cavitation.
> Dedicated to clean GPIO 38. Floating in water = Switch Open (Internal pull-up holds HIGH = OK).
> Empty tank = Switch Drops (Closes contact to GND = LOW = EMERGENCY STOP).

```text
ESP32 GPIO 38 (Right-10) ─────┬────── Terminal A (Lower Float Switch)
      [Internal Pull-Up       │
       to 3.3V Enabled]       │
                              ▼
                           [ Reed ] Contacts close when float drops (DRY)
                              ▲
                              │
ESP32 GND (Right-1) ──────────┴────── Terminal B (Lower Float Switch)
```

---

### 3.6. Operator Push-Buttons (Momentary NO Switches)
All buttons connect between their respective GPIO and clean `GND_LV`. Internal pull-ups hold lines HIGH at 3.3V when open. Pressing a button pulls the GPIO to 0V (Active-LOW).

```text
ESP32 GPIO 0  (Right-14) ──────────── [ MODE Push-Button ] ──────────┬── ESP32 GND
ESP32 GPIO 39 (Right-9)  ──────────── [ MANUAL A Button  ] ──────────┤
ESP32 GPIO 40 (Right-8)  ──────────── [ MANUAL B Button  ] ──────────┤
ESP32 GPIO 41 (Right-7)  ──────────── [ DISTRIBUTION Btn ] ──────────┘
```

---

### 3.7. Anti-Theft Pump Security Tamper Loop (Physical Closed-Loop Interlock)
The anti-theft loop physically runs through the pump chassis mounting bracket or inside the motor power cable conduit back to the control panel.
The ESP32 internal pull-up holds GPIO 47 HIGH (3.3V) if the loop is severed. Under normal conditions, the continuous closed loop holds GPIO 47 at 0V (`GND_LV`).
Cutting the wire or disconnecting the pump opens the circuit, immediately pulling GPIO 47 HIGH and tripping Rule 4 Emergency Stop (all pumps locked OFF, red beacon energized).

```text
ESP32 GPIO 47 (Right-17) ──────[ Internal Pull-up to 3.3V ]
          │
          │ (Closed-loop wire through pump conduit / bracket)
          ▼
    ┌───────────────────────────┐
    │ Pump Body / Conduit Loop  │ (Normally Closed physical loop)
    └─────────────┬─────────────┘
                  │ (Return conductor)
                  ▼
         ESP32 GND (Signal GND_LV)
```
* **Logic:** Normal (Intact) = `0` (LOW), Tampered (Cut/Severed) = `1` (HIGH).
* **Ground Isolation:** The return wire MUST terminate at DC Signal Ground (`GND_LV`), NEVER at AC Protective Earth (PE) or AC Neutral.
* **Safety Authority Action:** Immediate Emergency Stop of all actuators + Red Alarm Beacon ON (`safety_monitor.c`).

---

## 4. Complete Actuator Control Paths

> [!CAUTION]
> **ELECTRICAL ISOLATION MANDATE:**
> Microcontroller GPIO pins NEVER drive inductive loads, motors, or 220V AC mains directly.
> Every control line must follow a verified three-tier chain:
> `ESP32 GPIO` $\longrightarrow$ `Driver / Optocoupler` $\longrightarrow$ `Power Load Switching`

### 4.1. High-Voltage Mains 220V AC Pumps (Well Pump & Distribution Booster)
* **Well Pump AC:** GPIO 1 $\longrightarrow$ Intermediate Driver $\longrightarrow$ Omron Heavy-Duty Relay #1 $\longrightarrow$ 220V AC Deep Well Pump
* **Distribution Booster AC:** GPIO 2 $\longrightarrow$ Intermediate Driver $\longrightarrow$ Omron Heavy-Duty Relay #2 $\longrightarrow$ 220V AC Fertigation Booster Pump GH-1

```text
ESP32 GPIO 1 / 2 (Active-LOW)
      │
      ▼
┌───────────────────────────┐
│ Intermediate Driver Stage │
│ (Transistor / Opto Buffer)│
└─────────────┬─────────────┘
              │ Coil Energize (5V/12V)
              ▼
┌───────────────────────────┐       220V AC Live (L) from MCB
│  Omron Heavy-Duty Relay   │ ────────────────┐
│  (Air-Gap 250VAC Contacts)│                 ▼
└─────────────┬─────────────┘         ┌───────────────┐
              └──────────────────────►│  COM     NO   ├────► 220V AC Pump Motor Live
                                      └───────┬───────┘
                                              │
220V AC Neutral (N) ──────────────────────────┴─────────────► Pump Motor Neutral
AC Protective Earth (PE) ───────────────────────────────────► Metal Motor Chassis
```

---

### 4.2. 12V DC Loads via 4-Channel Optocoupled Relay Board
* **Channel 1 (GPIO 4):** 12V DC Raw Water Submersible Pump
* **Channel 2 (GPIO 18):** 12V DC Red Error / System Beacon Lamp
* **Channel 3 / 4:** Unassigned / Spare

```text
ESP32 GPIO 4 / 18 (Active-LOW: 0V = ON)
      │ (Sinks optocoupler cathode)
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4-Channel 5V Relay Board Header                             │
│                                                             │
│   +5V Rail ───────► VCC  ──[ Jumper ]──► JD-VCC (Coil 5V)   │
│   ESP32 GND ──────► GND (Common ground with ESP32)          │
│   ESP32 GPIO ─────► INx (Optocoupler input)                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Mechanical Contact Closure
                               ▼
                        ┌──────────────┐
12V DC (+) from PSU 1 ──┤ COMx    NOx  ├───► 12V DC Load Positive (+)
                        └──────────────┘
                                             12V DC Load Negative (-)
GND_12V (from PSU 1 Return) ─────────────────────────────────────────
```

---

### 4.3. 12V DC Loads via 3x High-Power MOSFET Modules
* **MOSFET #1 (GPIO 5):** 12V DC Peristaltic Dosing Pump A (Nutrient)
* **MOSFET #2 (GPIO 6):** 12V DC Peristaltic Dosing Pump B (pH/Buffer)
* **MOSFET #3 (GPIO 7):** 12V DC Cabinet Cooling Fan
* *Note: Physical trigger terminals verified by operator: TRIG-PWM (Signal) and GND (Ground return).*

```text
ESP32 GPIO 5 / 6 / 7          ESP32 Signal GND
      │                              │
      ▼                              ▼
┌────────────────────────────────────────────────────────┐
│ High-Power MOSFET Module (15A / 400W)                  │
│                                                        │
│ Logic Trigger Input:  [ TRIG-PWM ]       [ GND ]       │
│ Power Input:          [ VIN+ (12V) ]     [ VIN- (GND) ]│
│ Power Output:         [ OUT+ (12V) ]     [ OUT- (Sw) ] │
└──────────────────────────────┬─────────────────────────┘
                               │ High-Speed Solid-State Switched DC
                               ▼
12V DC (+) from OUT+ ───────────────────────────► 12V Actuator (+)
Switched Return (-) from OUT- ──────────────────► 12V Actuator (-)
```

---

## 5. LM2596 Power & Ground Distribution Circuit

```text
220V AC Mains ──► [2-Pole 10A MCB] ──► [PSU 1: 12V 5A (60W)]
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │ +12V DC                                   │ GND_12V (Return)
                       ▼                                           ▼
                 ┌───────────┐                               ┌───────────┐
                 │    IN+    │                               │    IN-    │
                 │           └───────────────────────────────┘           │
                 │          LM2596 Step-Down DC-DC Buck Converter        │
                 │                 [Blue Multi-Turn Trimpot]             │
                 │           ┌───────────────────────────────┐           │
                 │    OUT+   │                               │    OUT-   │
                 └─────┬─────┘                               └─────┬─────┘
                       │                                           │
                       │ [VERIFY 5.05V DC WITH DMM BEFORE CONNECT] │
                       ▼                                           ▼
                 +5V DC Rail                                 GND_LV Rail
                 ├─► ESP32 5V (Vin) (Pin Left-21)            ├─► ESP32 GND (Left-22)
                 ├─► Relay Board VCC & JD-VCC                ├─► Relay Board GND
                 └─► Flow Sensor VCC (Red Wires)             └─► Sensor Grounds
```

---

## 6. Hardware Wiring Validation Matrix

| Connection ID | Signal Source | Destination Pin | Conflict Assessment | Electrical Consideration | Firmware Support | Verification Status |
|:---:|:---|:---|:---|:---|:---|:---:|
| **W-01** | Mode Button | ESP32 GPIO 0 | No conflict. Boot strap caveat. | Pull-up onboard; must be open during reset. | `PIN_BTN_MODE = 0` | **ACCEPTABLE CAVEAT** |
| **W-02** | Omron Relay #1 | ESP32 GPIO 1 | No conflict. Clean digital pin. | Active-LOW driver buffer required for 220V AC. | `PIN_OUT_WELL_PUMP = 1` | **VERIFIED SAFE** |
| **W-03** | Omron Relay #2 | ESP32 GPIO 2 | No conflict. Clean digital pin. | Active-LOW driver buffer required for 220V AC. | `PIN_OUT_DIST_PUMP = 2` | **VERIFIED SAFE** |
| **W-04** | 4-Ch Relay IN1 | ESP32 GPIO 4 | No conflict. Clean digital pin. | Optocoupled 5V coil. Active-LOW logic. | `PIN_OUT_RAW_SUBMERSIBLE = 4` | **VERIFIED SAFE** |
| **W-05** | MOSFET #1 Gate | ESP32 GPIO 5 | No conflict. Clean digital pin. | Gate trigger for 12V peristaltic dosing pump A. | `PIN_OUT_DOSING_A = 5` | **VERIFIED SAFE** |
| **W-06** | MOSFET #2 Gate | ESP32 GPIO 6 | No conflict. Clean digital pin. | Gate trigger for 12V peristaltic dosing pump B. | `PIN_OUT_DOSING_B = 6` | **VERIFIED SAFE** |
| **W-07** | MOSFET #3 Gate | ESP32 GPIO 7 | No conflict. Clean digital pin. | Gate trigger for 12V cabinet cooling fan. | `PIN_OUT_COOLING_FAN = 7` | **VERIFIED SAFE** |
| **W-08** | DS3231 SDA | ESP32 GPIO 8 | No conflict. Native I2C data line.| 4.7kΩ pull-up to 3.3V. Hardware I2C port 0. | `PIN_I2C_SDA = 8` | **VERIFIED** |
| **W-09** | DS3231 SCL | ESP32 GPIO 9 | No conflict. Native I2C clock line.| 4.7kΩ pull-up to 3.3V. Hardware I2C port 0. | `PIN_I2C_SCL = 9` | **VERIFIED** |
| **W-10** | W5500 CS | ESP32 GPIO 10 | No conflict. Dedicated SPI CS. | Module deferred from active commissioning. | `PIN_W5500_CS = 10` | **NOT USED** |
| **W-11** | Shared SPI SCK | ESP32 GPIO 11 | No conflict. Shared bus clock. | Drives TFT and SD card clock lines in parallel. | `PIN_SPI_SCK = 11` | **VERIFIED** |
| **W-12** | Shared SPI MOSI| ESP32 GPIO 12 | No conflict. Shared bus MOSI. | Drives TFT data and SD card MOSI in parallel. | `PIN_SPI_MOSI = 12` | **VERIFIED** |
| **W-13** | MicroSD MISO | ESP32 GPIO 13 | No conflict. Shared bus MISO. | Dedicated return data from SD card slot. | `PIN_SPI_MISO = 13` | **UNVERIFIED** |
| **W-14** | TFT CS | ESP32 GPIO 14 | No conflict. Dedicated SPI CS. | Active-LOW display chip select. | `PIN_TFT_CS = 14` | **VERIFIED** |
| **W-15** | Flow YF-B1 | ESP32 GPIO 15 | No conflict. Pulse input. | Scaled to 3.3V via 2.2kΩ/3.3kΩ divider. | `PIN_IN_FLOW_YFB1 = 15` | **VERIFIED** |
| **W-16** | Flow FS400A | ESP32 GPIO 16 | No conflict. Pulse input. | Scaled to 3.3V via 2.2kΩ/3.3kΩ divider. | `PIN_IN_FLOW_FS400A = 16` | **VERIFIED** |
| **W-17** | DS18B20 DAT | ESP32 GPIO 17 | No conflict. Dedicated 1-Wire. | Mandatory 4.7kΩ pull-up to 3.3V rail. | `PIN_IN_TEMP_DS18B20 = 17`| **VERIFIED** |
| **W-18** | 4-Ch Relay IN2 | ESP32 GPIO 18 | No conflict. Clean digital pin. | Optocoupled 5V coil. Controls Red Alarm Beacon. | `PIN_OUT_ERROR_LAMP = 18` | **VERIFIED SAFE** |
| **W-19** | TFT DC / A0 | ESP32 GPIO 21 | No conflict. Dedicated control line.| High = Data, Low = Command for ST7735. | `PIN_TFT_DC = 21` | **VERIFIED** |
| **W-20** | Lower Float | ESP32 GPIO 38 | No conflict. Dedicated clean GPIO.| Mandatory Safety Interlock. Internal pull-up to 3.3V. | `PIN_IN_FLOAT_LOWER = 38` | **VERIFIED SAFE (SAFETY)**|
| **W-21** | Manual A Button| ESP32 GPIO 39 | No conflict. Dedicated clean GPIO.| Active-LOW push button. Internal pull-up. | `PIN_BTN_MANUAL_A = 39` | **VERIFIED SAFE** |
| **W-22** | Manual B Button| ESP32 GPIO 40 | No conflict. Dedicated clean GPIO.| Active-LOW push button. Internal pull-up. | `PIN_BTN_MANUAL_B = 40` | **VERIFIED SAFE** |
| **W-23** | Dist Button | ESP32 GPIO 41 | No conflict. Dedicated clean GPIO.| Active-LOW push button. Internal pull-up. | `PIN_BTN_DISTRIBUTION = 41`| **VERIFIED SAFE** |
| **W-24** | TFT RESET | ESP32 GPIO 42 | No conflict. Dedicated control line.| Active-LOW hardware reset for ST7735. | `PIN_TFT_RST = 42` | **VERIFIED** |
| **W-25** | Anti-Theft Loop | ESP32 GPIO 47 | No conflict. Clean dedicated GPIO. | Closed loop to GND_LV. Internal pull-up. | `PIN_IN_TAMPER_LOOP = 47` | **VERIFIED SAFE (SECURITY)** |
| **W-26** | MicroSD CS | ESP32 GPIO 48 | Caveat: Drives onboard RGB LED. | Active-LOW SD chip select. Safe for CS output. | `PIN_SD_CS = 48` | **UNVERIFIED** |

---

## 7. Firmware $\longleftrightarrow$ Documentation Consistency Audit

A strict audit was conducted comparing `esp32/main/config/pin_config.h` against this Hardware Wiring Contract:

| GPIO | Firmware Macro Symbol | Value in Firmware | Contract Role / Assignment | Match Status | Technical Evaluation & Next Action |
|:---:|:---|:---:|:---|:---:|:---|
| **0** | `PIN_BTN_MODE` | 0 | Mode Push Button / BOOT | **MATCH** | 100% Consistent. |
| **1** | `PIN_OUT_WELL_PUMP` | 1 | Well Pump AC (Omron #1) | **MATCH** | 100% Consistent. Active-LOW (0). |
| **2** | `PIN_OUT_DIST_PUMP` | 2 | Dist Pump AC (Omron #2) | **MATCH** | 100% Consistent. Active-LOW (0). |
| **4** | `PIN_OUT_RAW_SUBMERSIBLE` | 4 | Raw Submersible Pump (Relay IN1)| **MATCH** | 100% Consistent. Active-LOW (0). |
| **5** | `PIN_OUT_DOSING_A` | 5 | Dosing Pump A (MOSFET #1) | **MATCH** | 100% Consistent. Active-LOW (0). |
| **6** | `PIN_OUT_DOSING_B` | 6 | Dosing Pump B (MOSFET #2) | **MATCH** | 100% Consistent. Active-LOW (0). |
| **7** | `PIN_OUT_COOLING_FAN` | 7 | Cooling Fan (MOSFET #3) | **MATCH** | 100% Consistent. Active-LOW (0). |
| **8** | `PIN_I2C_SDA` | 8 | RTC DS3231 SDA (I2C Data) | **MATCH** | 100% Consistent. Hardware I2C port 0 SDA (+ 4.7kΩ pull-up). |
| **9** | `PIN_I2C_SCL` | 9 | RTC DS3231 SCL (I2C Clock) | **MATCH** | 100% Consistent. Hardware I2C port 0 SCL (+ 4.7kΩ pull-up). |
| **10** | `PIN_W5500_CS` | 10 | W5500 Ethernet CS | **MATCH** | Consistent. Marked NOT USED IN CURRENT COMMISSIONING. |
| **11** | `PIN_SPI_SCK` / `PIN_SD_SCK` | 11 | Shared SPI Clock (TFT & SD) | **MATCH** | 100% Consistent. Shared bus. |
| **12** | `PIN_SPI_MOSI` / `PIN_SD_MOSI`| 12 | Shared SPI MOSI (TFT & SD) | **MATCH** | 100% Consistent. Shared bus. |
| **13** | `PIN_SPI_MISO` / `PIN_SD_MISO`| 13 | Shared SPI MISO (SD Slot) | **MATCH** | 100% Consistent. Dedicated to SD card return. |
| **14** | `PIN_TFT_CS` | 14 | TFT Display Chip Select | **MATCH** | 100% Consistent. Dedicated CS. |
| **15** | `PIN_IN_FLOW_YFB1` | 15 | Flow Meter YF-B1 Pulse In | **MATCH** | 100% Consistent. |
| **16** | `PIN_IN_FLOW_FS400A` | 16 | Flow Meter FS400A Pulse In | **MATCH** | 100% Consistent. |
| **17** | `PIN_IN_TEMP_DS18B20` | 17 | Temperature Sensor DS18B20 | **MATCH** | 100% Consistent. |
| **18** | `PIN_OUT_ERROR_LAMP` | 18 | Error Beacon Lamp (Relay IN2) | **MATCH** | 100% Consistent. Active-LOW (0). |
| **21** | `PIN_TFT_DC` | 21 | TFT Display Command/Data | **MATCH** | 100% Consistent. |
| **38** | `PIN_IN_FLOAT_LOWER` | 38 | Lower Float Switch (Safety) | **MATCH** | 100% Consistent. Clean safety interlock. |
| **39** | `PIN_BTN_MANUAL_A` | 39 | Manual A Button | **MATCH** | 100% Consistent. |
| **40** | `PIN_BTN_MANUAL_B` | 40 | Manual B Button | **MATCH** | 100% Consistent. |
| **41** | `PIN_BTN_DISTRIBUTION` | 41 | Distribution Button | **MATCH** | 100% Consistent. |
| **42** | `PIN_TFT_RST` | 42 | TFT Display Hardware Reset | **MATCH** | 100% Consistent. |
| **47** | `PIN_IN_TAMPER_LOOP` | 47 | Anti-Theft Pump Security Tamper Loop | **MATCH** | 100% Consistent. Dedicated closed loop with internal pull-up (SP-HW-008). |
| **48** | `PIN_SD_CS` / `PIN_MICROSD_CS` | 48 | Integrated SD Card Slot CS | **MATCH** | 100% Consistent. |

### Summary of Firmware Audit:
- **26 out of 26 pins** match 100% identically between firmware (`pin_config.h`) and this hardware wiring contract.
- **0 discrepancies or driver mismatches remain.**
- DS3231 I2C driver integration and DS1302 retirement completed and verified in SP-HW-006.
- Anti-Theft Tamper Loop on GPIO 47 completed and verified in SP-HW-008.
