# DYNAMIC HARDWARE REGISTRY & SCALABLE EXPANSION ARCHITECTURE

**Document Role:** Authoritative Architectural Specification & Step-by-Step Hardware/UI Expansion Guide  
**Target Subsystems:** ESP32-S3 Firmware (HAL & SPIFFS Storage), OpenAPI Contract, Vite/React Dynamic UI  
**Status:** **AUTHORITATIVE ARCHITECTURE CONTRACT**

---

## 1. Executive Summary & Architectural Philosophy

In traditional embedded IoT applications, hardware pinouts and peripheral lists are rigidly hardcoded into compile-time C source code. Adding a new pump, sensor, or valve requires modifying firmware code, recompiling, reflashing the device, and rewriting web frontend components.

The **AgroTech Controller** implements a **Self-Describing Dynamic Hardware Registry (Data-Driven Hardware Architecture)**:
1. **Single Source of Topology:** Component definitions, assignments, physical pin/bus addresses, and friendly names live in a structured JSON configuration (`components.json`) stored on ESP32 Flash memory (SPIFFS/NVS).
2. **Dynamic Firmware Ingestion:** On boot, the ESP32 mounts its filesystem, parses `components.json`, initializes corresponding HAL driver handles, and registers each component in an active runtime registry with safe fallback to factory defaults.
3. **OpenAPI Auto-Discovery:** The ESP32 serves its active component registry dynamically to the network via `GET /api/v1/inventory` and `GET /api/v1/capabilities`.
4. **Dynamic UI/UX Rendering:** The React dashboard queries `/api/v1/inventory`, maps each discovered component into reactive state, and dynamically renders cards, status badges, calibration screens, and manual trigger buttons via `.map()` loops without requiring code edits or frontend redeployments.

```text
┌─────────────────────────┐
│ components.json         │ (Stored on ESP32 Flash: /spiffs/components.json)
└───────────┬─────────────┘
            │ 1. Boot-time Ingestion & Validation
            ▼
┌─────────────────────────┐
│ ESP32 Firmware HAL      │ (hardware_registry.c / actuator_hal.c / sensor_hal.c)
│ Dynamic Hardware Engine │
└───────────┬─────────────┘
            │ 2. OpenAPI REST Interface: GET /api/v1/inventory
            ▼
┌─────────────────────────┐
│ Vite / React Web UI     │ (fertigationService / Dosing Cards .map() Loop)
│ Self-Building Dashboard │
└─────────────────────────┘
```

---

## 2. Canonical `components.json` Schema Specification

The `components.json` file on ESP32 Flash defines the array of components recognized by the system.

### 2.1. File Path & Storage Location
* **Filesystem:** SPIFFS (or LittleFS) mounted at `/spiffs`.
* **Canonical Path:** `/spiffs/components.json`
* **Default Fallback:** Embedded static C structure in `esp32/main/hal/hardware_registry.c` (used if file is absent, unformatted, or corrupted).

### 2.2. JSON Schema Definition
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AgroTechHardwareComponents",
  "type": "object",
  "required": ["version", "components"],
  "properties": {
    "version": { "type": "integer", "minimum": 1 },
    "updatedAt": { "type": "string" },
    "components": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["componentId", "name", "type", "role", "interface", "safetyClass", "status"],
        "properties": {
          "componentId": { "type": "string" },
          "name": { "type": "string" },
          "type": { 
            "type": "string", 
            "enum": ["PUMP", "ACTUATOR", "SENSOR", "FLOW_METER", "INDICATOR", "INPUT"] 
          },
          "role": { "type": "string" },
          "interface": { 
            "type": "string", 
            "enum": ["GPIO", "I2C_PCA9685", "ONE_WIRE", "PULSE"] 
          },
          "pin": { "type": "integer", "minimum": 0, "maximum": 48 },
          "channel": { "type": "integer", "minimum": 0, "maximum": 15 },
          "activeLevel": { "type": "string", "enum": ["ACTIVE_LOW", "ACTIVE_HIGH"] },
          "safetyClass": { 
            "type": "string", 
            "enum": ["CRITICAL", "NORMAL", "MONITORING"] 
          },
          "status": { 
            "type": "string", 
            "enum": ["AVAILABLE", "OFFLINE", "DISABLED"] 
          }
        }
      }
    }
  }
}
```

### 2.3. Canonical Baseline `components.json`
```json
{
  "version": 1,
  "updatedAt": "2026-09-16T00:00:00Z",
  "components": [
    { "componentId": "pump_well",        "name": "Well Pump",            "type": "PUMP",       "role": "WELL_PUMP",       "interface": "GPIO", "pin": 1,  "activeLevel": "ACTIVE_LOW",  "safetyClass": "CRITICAL",   "status": "AVAILABLE" },
    { "componentId": "pump_dist",        "name": "Distribution Pump",    "type": "PUMP",       "role": "DIST_PUMP",       "interface": "GPIO", "pin": 2,  "activeLevel": "ACTIVE_LOW",  "safetyClass": "CRITICAL",   "status": "AVAILABLE" },
    { "componentId": "pump_submersible", "name": "Raw Submersible Pump", "type": "PUMP",       "role": "RAW_SUBMERSIBLE", "interface": "GPIO", "pin": 4,  "activeLevel": "ACTIVE_LOW",  "safetyClass": "NORMAL",     "status": "AVAILABLE" },
    { "componentId": "pump_dosing_a",    "name": "Dosing Pump A",        "type": "PUMP",       "role": "DOSING_A",        "interface": "GPIO", "pin": 5,  "activeLevel": "ACTIVE_LOW",  "safetyClass": "CRITICAL",   "status": "AVAILABLE" },
    { "componentId": "pump_dosing_b",    "name": "Dosing Pump B",        "type": "PUMP",       "role": "DOSING_B",        "interface": "GPIO", "pin": 6,  "activeLevel": "ACTIVE_LOW",  "safetyClass": "CRITICAL",   "status": "AVAILABLE" },
    { "componentId": "fan_cooling",      "name": "Cooling Fan",          "type": "ACTUATOR",   "role": "COOLING_FAN",     "interface": "GPIO", "pin": 7,  "activeLevel": "ACTIVE_LOW",  "safetyClass": "NORMAL",     "status": "AVAILABLE" },
    { "componentId": "lamp_error",       "name": "Error Lamp",           "type": "INDICATOR",  "role": "ERROR_LAMP",      "interface": "GPIO", "pin": 18, "activeLevel": "ACTIVE_LOW",  "safetyClass": "MONITORING", "status": "AVAILABLE" },
    { "componentId": "flow_yfb1",        "name": "YF-B1 Flow Meter",     "type": "FLOW_METER", "role": "FLOW_DOSING",     "interface": "PULSE","pin": 15, "activeLevel": "ACTIVE_HIGH", "safetyClass": "MONITORING", "status": "AVAILABLE" },
    { "componentId": "flow_fs400a",      "name": "FS400A Flow Meter",    "type": "FLOW_METER", "role": "FLOW_DIST",       "interface": "PULSE","pin": 16, "activeLevel": "ACTIVE_HIGH", "safetyClass": "MONITORING", "status": "AVAILABLE" },
    { "componentId": "temp_ds18b20",     "name": "DS18B20 Temp Sensor",  "type": "SENSOR",     "role": "WATER_TEMP",      "interface": "ONE_WIRE", "pin": 17, "activeLevel": "ACTIVE_HIGH", "safetyClass": "MONITORING", "status": "AVAILABLE" },
    { "componentId": "float_lower",      "name": "Lower Float Switch",   "type": "SENSOR",     "role": "TANK_LEVEL_LOW",  "interface": "GPIO", "pin": 38, "activeLevel": "ACTIVE_LOW",  "safetyClass": "CRITICAL",   "status": "AVAILABLE" },
    { "componentId": "btn_mode",         "name": "Mode Button",          "type": "INPUT",      "role": "BTN_MODE",        "interface": "GPIO", "pin": 0,  "activeLevel": "ACTIVE_LOW",  "safetyClass": "NORMAL",     "status": "AVAILABLE" },
    { "componentId": "btn_manual_a",     "name": "Manual A Button",      "type": "INPUT",      "role": "BTN_MAN_A",       "interface": "GPIO", "pin": 39, "activeLevel": "ACTIVE_LOW",  "safetyClass": "NORMAL",     "status": "AVAILABLE" },
    { "componentId": "btn_manual_b",     "name": "Manual B Button",      "type": "INPUT",      "role": "BTN_MAN_B",       "interface": "GPIO", "pin": 40, "activeLevel": "ACTIVE_LOW",  "safetyClass": "NORMAL",     "status": "AVAILABLE" },
    { "componentId": "btn_dist",         "name": "Distribution Button",  "type": "INPUT",      "role": "BTN_DIST",        "interface": "GPIO", "pin": 41, "activeLevel": "ACTIVE_LOW",  "safetyClass": "NORMAL",     "status": "AVAILABLE" }
    /* =========================================================================
     * BOOKED / DEFERRED COMPONENT: Dual Greenhouse Exhaust Blower Fans
     * Status: BOOKED / PROVISIONED (Investasi Menyusul / Belum Terpasang Fisik)
     * Hardware Channel: 4-Channel Relay Board Channel 3 (IN3) via ESP32 GPIO 10
     * Control Logic: Active-LOW (0 = Active / Energize Contactor Coil, 1 = Safe OFF)
     * Physical Switching: Relay IN3 triggers 220V AC coil of an external Magnetic
     *                     Contactor (or Heavy-Duty Omron Relay), which switches
     *                     2x Blower Fans simultaneously in parallel.
     * Note: Aktifkan baris JSON di bawah saat kontaktor & blower fisik terpasang:
     * ,{ "componentId": "fan_blower", "name": "Greenhouse Blower Fans", "type": "ACTUATOR", "role": "BLOWER_FAN", "interface": "GPIO", "pin": 10, "activeLevel": "ACTIVE_LOW", "safetyClass": "NORMAL", "status": "DEFERRED" }
     * ========================================================================= */
  ]
}
```

---

## 3. Step-by-Step Hardware Expansion Guide

When adding new hardware components to the system, follow one of two physical pathways:

### Pathway A: Adding Actuators on Free ESP32 Direct GPIOs / Relay Spare Channels
Use this pathway when adding extra actuators and spare channels are available.
* **Pin Allocation Note:** 
  - GPIO 47 is dedicated to the **Anti-Theft Tamper Loop (`PIN_IN_TAMPER_LOOP`)**.
  - 4-Channel Relay Board **IN3 (GPIO 10)** is **BOOKED** for **Greenhouse Blower Fans Contactor Trigger** (standby safe OFF).
  - 4-Channel Relay Board **IN4** remains an unassigned spare channel. Direct actuator expansion can utilize IN4 or Pathway B (I2C Expansion).
* **Wiring Step-by-Step (Example using Spare Channel / Expander):**
  1. Power OFF panel MCB.
  2. Connect actuator signal terminal to assigned spare channel.
  3. Connect Ground return to ESP32 Signal GND / PSU Ground.
  4. Connect 12V DC auxiliary power to actuator driver board.
  5. Connect Actuator (e.g. Dosing Pump C) to output terminals.
  6. In `components.json`, add:
     ```json
     { "componentId": "pump_dosing_c", "name": "Dosing Pump C", "type": "PUMP", "role": "DOSING_C", "interface": "GPIO", "pin": 4, "channel": 3, "activeLevel": "ACTIVE_LOW", "safetyClass": "NORMAL", "status": "AVAILABLE" }
     ```
  7. Upload `components.json` to ESP32 via API or restart device.

---

### Pathway B: Scaling to 10–16 Dosing Pumps via I2C PCA9685 Expansion (Recommended Scalable Standard)
Use this pathway when expanding beyond available ESP32 pins (e.g. 6 to 16 dosing pumps for macro/micro nutrient recipes: Ca, K, N, P, Mg, Fe, Trace Elements, pH Up, pH Down, Sanitizer).

#### 1. Hardware Module Specification
* **Expansion Board:** PCA9685 16-Channel 12-bit PWM I2C Controller.
* **I2C Bus:** Shared with DS3231 RTC on **GPIO 8 (SDA)** and **GPIO 9 (SCL)**.
* **Default I2C Address:** `0x40` (Does not conflict with DS3231 at `0x68`).

#### 2. Physical Wiring Diagram (Parallel I2C Bus)
```text
ESP32-S3 Board                  PCA9685 16-Ch Module           MOSFET Drivers & Actuators
┌──────────────┐                ┌──────────────────┐           ┌────────────────────────┐
│ GPIO 8 (SDA) ├───┬────────────┤ SDA              │           │ MOSFET Module #1       │
│ GPIO 9 (SCL) ├───┼───┬────────┤ SCL              │ Channel 0 ┤ TRIG-PWM ──► Pump 1    │
│ 3.3V Rail    ├───┼───┼───┬────┤ VCC (Logic 3.3V) │──────────►│ GND                    │
│ Signal GND   ├───┼───┼───┼──┬─┤ GND              │           └────────────────────────┘
└──────────────┘   │   │   │  │ └────────┬─────────┘           ┌────────────────────────┐
                   │   │   │  │          │             Channel 1│ MOSFET Module #2       │
                   ▼   ▼   ▼  ▼          │             ────────►┤ TRIG-PWM ──► Pump 2    │
                 [ DS3231 RTC ]          │                      │ GND                    │
                 (Addr: 0x68)            │                      └────────────────────────┘
                                         │                      ┌────────────────────────┐
                                         │             Channel 9│ MOSFET Module #10      │
                                         └─────────────────────►┤ TRIG-PWM ──► Pump 10   │
                                                                │ GND                    │
                                                                └────────────────────────┘
```

#### 3. Power Sizing Calculation for 10+ Pumps
* **Current per Peristaltic Pump:** $\approx 0.50\text{ A}$ nominal, $0.85\text{ A}$ inrush/stall.
* **10 Pumps Simultaneous Run:** $10 \times 0.8\text{ A} = 8.0\text{ A} \implies$ **Mandatory PSU Upgrade:** Replace 12V 5A PSU with **12V 10A (120W) or 12V 15A (180W)**.
* **Staggered Intermittent Dosing (Software Managed):** If the ESP32 scheduler staggers pump operation so maximum 2 pumps run concurrently, total peak load is $\approx 1.7\text{ A}$, which safely runs on the existing **12V 5A PSU**.

#### 4. `components.json` Entry for I2C Pump
```json
{
  "componentId": "pump_dosing_10",
  "name": "Trace Elements Micronutrient",
  "type": "PUMP",
  "role": "DOSING_MICRONUTRIENT",
  "interface": "I2C_PCA9685",
  "channel": 9,
  "activeLevel": "ACTIVE_HIGH",
  "safetyClass": "NORMAL",
  "status": "AVAILABLE"
}
```

---

## 4. Web UI / UX Dynamic Lifecycle Architecture

### 4.1. Data Flow Pipeline
1. **App Mount (`useEffect`):**
   `src/app/fertigation/page.tsx` calls `fertigationService.loadInventory()`.
2. **API Request:**
   `esp32Client.getInventory()` executes `GET /api/v1/inventory`.
3. **Response Parsing:**
   The client receives the `EnvelopeBase<Esp32Inventory>` payload.
4. **Filtering & Entity Mapping:**
   `fertigationService` filters `components.filter(c => c.type === 'PUMP')`.
5. **Reactive State Update:**
   The `pumps` state is updated with dynamically reported pump instances (`componentId`, `name`, `status`, `role`).
6. **Dynamic DOM Rendering:**
   The JSX container maps the list dynamically:
   ```tsx
   {pumps.map((pump) => (
     <PumpCard 
       key={pump.id} 
       title={pump.name} 
       status={pump.status} 
       onTest={() => handleTestPump(pump.id)} 
     />
   ))}
   ```
7. **Offline Graceful Degradation:**
   If the ESP32 is offline or disconnected, `fertigationService` automatically falls back to cached/default pump definitions with an offline badge.

---

## 5. Architectural Verification & Compliance Matrix

| Subsystem | Requirement | Verification Method | Pass Criteria |
|:---|:---|:---|:---|
| **ESP32 Storage** | Store & load `components.json` on SPIFFS | Filesystem mount & JSON read | Valid cJSON parse, 0 memory leaks |
| **ESP32 Fallback** | Safe boot if `components.json` missing | Boot test with erased SPIFFS | Defaults loaded, 0 watchdog resets |
| **OpenAPI Contract** | Match `UI_ESP32_OPENAPI.yaml` schema | REST smoke test `/api/v1/inventory` | EnvelopeBase conforming, HTTP 200 |
| **React UI Rendering** | Dynamic `.map()` over live inventory | Vite build & component mount | Dynamic cards rendered, 0 TypeScript errors |
