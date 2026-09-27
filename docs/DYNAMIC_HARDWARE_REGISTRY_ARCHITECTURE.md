# DYNAMIC HARDWARE REGISTRY & SCALABLE EXPANSION ARCHITECTURE

**Document Role:** Authoritative Architectural Specification & Step-by-Step Hardware/UI Expansion Guide  
**Target Subsystems:** ESP32-S3 Firmware (HAL & SPIFFS Storage), OpenAPI Contract, Vite/React Dynamic UI  
**Status:** **ACTIVE ARCHITECTURE CONTRACT (M2 alignment update, 2026-09-18)**

---

## 1. Executive Summary & Architectural Philosophy

In traditional embedded IoT applications, hardware pinouts and peripheral lists are rigidly hardcoded into compile-time C source code. Adding a new pump, sensor, or valve requires modifying firmware code, recompiling, reflashing the device, and rewriting web frontend components.

The **AgroTech Controller** implements a **Self-Describing Dynamic Hardware Registry (Data-Driven Hardware Architecture)**:
1. **Single Source of Topology:** Component definitions, assignments, physical pin/bus addresses, and friendly names live in the versioned active configuration persisted in NVS. `components.json` is retained only as an explicit migration/bootstrap input; it is never an operational fallback.
2. **Dynamic Firmware Ingestion:** On boot, the ESP32 loads the persisted active configuration after storage initialization, validates it, and builds the runtime registry. When no valid active configuration exists, the registry stays safely empty/unavailable.
3. **OpenAPI Auto-Discovery:** The ESP32 serves its active component registry dynamically to the network via `GET /api/v1/inventory` and `GET /api/v1/capabilities`.
4. **Dynamic UI/UX Rendering:** The React dashboard queries `/api/v1/inventory`, maps each discovered component into reactive state, and dynamically renders cards, status badges, calibration screens, and manual trigger buttons via `.map()` loops without requiring code edits or frontend redeployments.

```text
┌────────────────────────────────────────────────────────┐
│ Single Source of Truth: Active Configuration Payload   │ (Persisted in ESP32 NVS)
│ GET/POST /api/v1/configuration                         │
└───────────┬────────────────────────────────────────────┘
            │ 1. Direct Ingestion & Hardware Validation
            ▼
┌─────────────────────────┐
│ ESP32 Firmware HAL      │ (hardware_registry.c / actuator_hal.c / sensor_hal.c)
│ Dynamic Hardware Engine │
└───────────┬─────────────┘
            │ 2. Direct OpenAPI REST Interface: /api/v1/inventory, /api/v1/configuration
            ▼
┌─────────────────────────┐
│ Direct Vite / React UI  │ (Single true source per ESP32 complex; no Python backend required)
│ LocalStoreClient Cache  │ (Dynamic equipment distribution to Complex & Greenhouse scopes)
└─────────────────────────┘
```

### 1.1. Pure Direct UI ↔ ESP32 Communication & Equipment Sync
As established in system requirements, the operational runtime functions directly between the Vite/React UI and the authoritative ESP32 firmware without requiring any Python backend service:
1. **Single Source of Truth Configuration:** The ESP32 holds a single authoritative JSON payload representing the entire complex (`/api/v1/configuration`). This payload defines all installed components, pin wiring, and greenhouse assignments.
2. **Dynamic Equipment Population:** Upon retrieving the configuration, the UI operational layer (`operational-state.ts`) dynamically populates both shared complex equipment (e.g. Well Pump, Shared Dosing Pumps, Raw Tank Sensors) and per-greenhouse equipment (e.g. Fertigation Valves, Booster Pumps) based on component role and assignment.
3. **Synchronized Well Pump Equipment & Scheduling:** The well pump actuator is consistently identified across the system using the canonical component ID `pump_well`. The schedule engine (`AddWellPumpDrawer.tsx` and `types.ts`) explicitly references `pump_well` ensuring full synchronization between equipment status and scheduled execution.
4. **Resilient LocalStore Client:** The `LocalStoreClient` acts as the direct adapter and localStorage cache for complex metadata, crop research logs, and calibrations, ensuring zero blank pages (such as Calibration Wizard) even during initial commissioning or controller reboot.

### 1.2. Complex Identity & Topology Pool Persistence Across Reloads
To guarantee seamless persistence when a user refreshes the browser:
1. **NVS & Topology Pool Synchronization:** When a complex is onboarded or bound via `POST /api/v1/device/bind`, the firmware writes the `complexId` to persistent NVS (`storage_mgr_bind_complex`) and registers the active complex record into the system topology pool (`/spiffs/topology_pool.json`) via `topology_pool_bind_complex`. Any prior tombstone records for that complex ID are automatically purged.
2. **Firmware Boot Self-Healing:** On boot (`topology_pool_init`), the firmware verifies if an active complex binding exists in NVS. If found, it guarantees the complex is present in `pool.complexes[]` in `ACTIVE` state, safeguarding against tombstone corruption or incomplete de-provisioning.
3. **UI State Hydration & Live Status Reconciliation:** When the frontend page reloads, `hydrateOperationalState()` in `operational-state.ts` retrieves the topology pool via `GET /api/v1/topology-pool` and queries live ESP32 status via `GET /api/v1/status`. It reconciles the controller identity directly into the operational snapshot, ensuring that bound complexes and their installed baseline components are immediately rendered on page load.

---

## 2. Canonical `components.json` Schema Specification

The `components.json` file on ESP32 Flash defines the array of components recognized by the system.

### 2.1. File Path & Storage Location
* **Filesystem:** SPIFFS (or LittleFS) mounted at `/spiffs`.
* **Migration Input:** `/spiffs/components.json` may be used only by an explicit migration/bootstrap procedure that validates and activates the resulting configuration.
* **Operational Authority:** Persisted versioned active configuration in NVS. No static fallback is used for physical operation.

### 2.2. JSON Schema Definition
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AgroTechConfiguration",
  "type": "object",
  "required": ["version", "components"],
  "properties": {
    "version": { "type": "integer", "minimum": 1 },
    "updatedAt": { "type": "string" },
    "components": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["componentId", "supportedTypeId", "name", "lifecycleState", "deploymentStatus"],
        "properties": {
          "componentId": { "type": "string" },
          "supportedTypeId": { "type": "string" },
          "name": { "type": "string" },
          "lifecycleState": { 
            "type": "string", 
            "enum": ["REGISTERED", "NOT_COMMISSIONED", "COMMISSIONED", "ENABLED", "DISABLED", "FAULTED", "REMOVED"] 
          },
          "deploymentStatus": { 
            "type": "string", 
            "enum": ["PENDING", "APPLIED", "FAILED", "UNKNOWN"] 
          },
          "wiring": {
            "type": "object",
            "properties": {
              "interface": { "type": "string", "enum": ["GPIO", "I2C", "UART", "SPI", "ONE_WIRE", "ANALOG", "VIRTUAL"] },
              "gpio": { "type": "integer" },
              "channel": { "type": "integer" },
              "address": { "type": "string" },
              "port": { "type": "string" },
              "polarity": { "type": "string", "enum": ["ACTIVE_LOW", "ACTIVE_HIGH"] }
            }
          },
          "assignment": {
            "type": "object",
            "properties": {
              "complexId": { "type": "string" },
              "ghId": { "type": "string" }
            }
          },
          "parameters": { "type": "object" }
        }
      }
    }
  }
}
```

### 2.3. Canonical Baseline Configuration Payload (`PUT /api/v1/configuration`)
```json
{
  "complexId": "complex-08",
  "version": 1,
  "updatedAt": "2026-09-16T00:00:00Z",
  "components": [
    { "componentId": "pump_well",        "name": "Well Pump",            "supportedTypeId": "pump-12v-dc", "role": "WELL_PUMP",        "lifecycleState": "COMMISSIONED", "deploymentStatus": "APPLIED", "assignment": { "complexId": "complex-08" }, "wiring": { "interface": "GPIO", "gpio": 1, "polarity": "ACTIVE_LOW" }, "parameters": {} },
    { "componentId": "pump_dist",        "name": "Distribution Pump",    "supportedTypeId": "pump-12v-dc", "role": "DIST_PUMP",        "lifecycleState": "COMMISSIONED", "deploymentStatus": "APPLIED", "assignment": { "complexId": "complex-08" }, "wiring": { "interface": "GPIO", "gpio": 2, "polarity": "ACTIVE_LOW" }, "parameters": {} },
    { "componentId": "pump_submersible", "name": "Raw Submersible Pump", "supportedTypeId": "pump-12v-dc", "role": "RAW_SUBMERSIBLE", "lifecycleState": "COMMISSIONED", "deploymentStatus": "APPLIED", "assignment": { "complexId": "complex-08" }, "wiring": { "interface": "GPIO", "gpio": 4, "polarity": "ACTIVE_LOW" }, "parameters": {} },
    { "componentId": "pump_dosing_a",    "name": "Dosing Pump A",        "supportedTypeId": "pump-12v-dc", "role": "DOSING_A",          "lifecycleState": "COMMISSIONED", "deploymentStatus": "APPLIED", "assignment": { "complexId": "complex-08" }, "wiring": { "interface": "GPIO", "gpio": 5, "polarity": "ACTIVE_LOW" }, "parameters": {} },
    { "componentId": "pump_dosing_b",    "name": "Dosing Pump B",        "supportedTypeId": "pump-12v-dc", "role": "DOSING_B",          "lifecycleState": "COMMISSIONED", "deploymentStatus": "APPLIED", "assignment": { "complexId": "complex-08" }, "wiring": { "interface": "GPIO", "gpio": 6, "polarity": "ACTIVE_LOW" }, "parameters": {} }
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
  ],
  "assignments": [],
  "schedules": [],
  "recipes": [],
  "topology": [],
  "settings": {}
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
  6. Add the component to the active configuration through the configuration API/editor:
     ```json
     { "componentId": "pump_dosing_c", "name": "Dosing Pump C", "supportedTypeId": "pump-12v-dc", "lifecycleState": "REGISTERED", "deploymentStatus": "PENDING", "wiring": { "interface": "GPIO", "gpio": 4, "channel": 3, "polarity": "ACTIVE_LOW" } }
     ```
  7. Validate and deploy the configuration. The ESP32 activates it only after validation; there is no silent `components.json` runtime fallback.

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
  "supportedTypeId": "pump-12v-dc",
  "lifecycleState": "COMMISSIONED",
  "deploymentStatus": "APPLIED",
  "wiring": {
    "interface": "I2C",
    "channel": 9,
    "polarity": "ACTIVE_HIGH"
  }
}
```

### 3.5. Single-Wire Environmental Sensors & Acoustic Alarm Actuators

#### 1. DHT22 / AM2302 Digital Sensor Entry
```json
{
  "componentId": "sensor_dht22_01",
  "name": "Greenhouse 1 Air Temp & Humidity",
  "supportedTypeId": "dht22-am2302",
  "role": "ENVIRONMENT_SENSOR",
  "lifecycleState": "COMMISSIONED",
  "deploymentStatus": "APPLIED",
  "assignment": { "complexId": "complex-01", "ghId": "gh-01" },
  "wiring": {
    "interface": "GPIO",
    "gpio": 41,
    "polarity": "ACTIVE_HIGH"
  }
}
```

#### 2. Active Alarm Buzzer Actuator Entry
```json
{
  "componentId": "buzzer_alarm",
  "name": "Active Alarm Buzzer",
  "supportedTypeId": "active-buzzer",
  "role": "ALARM_BUZZER",
  "lifecycleState": "COMMISSIONED",
  "deploymentStatus": "APPLIED",
  "assignment": { "complexId": "complex-01", "ghId": null },
  "wiring": {
    "interface": "GPIO",
    "gpio": 10,
    "polarity": "ACTIVE_LOW"
  }
}
```
* **Electrical Protection:** Sourcing ~30mA directly from MCU pins is prohibited; optocoupled relay channel or external transistor/MOSFET driver stage must be used.
* **Telemetry & Event Ingestion:** The sensor manager non-blockingly polls DHT22 every 3s and populates canonical telemetry (`temperatureC`, `humidityPct`). Actuator HAL audits buzzer activations (`ALARM_BUZZER_ON` / `ALARM_BUZZER_OFF`) while ensuring buzzer defaults to OFF during boot and after E-Stop.

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
   If the ESP32 is offline, installed-hardware authority is unavailable. The UI must not synthesize installed pumps/actuators from seed data; cached UI data may be displayed only as explicitly non-authoritative/offline information.

### 4.2. Zero-Friction Canonical Baseline Auto-Provisioning (Fast Onboarding UX)
To eliminate tedious, error-prone manual GPIO entry for standard factory panels, the system implements **Canonical Baseline Auto-Provisioning**:
1. **Onboarding Wizard Step 5 (`src/app/onboarding-complex.tsx`):**
   - When an onboarded controller reports `0 Detected components`, a dedicated **Fast Setup: Deploy Standard AgroTech Panel** card is presented.
   - Core panel actuators are pre-mapped to authoritative pins without requiring user configuration:
     - `Well Pump`: Relay Ch 1 (GPIO 1, `ACTIVE_LOW`, role `WELL_PUMP`)
     - `Distribution Pump`: Relay Ch 2 (GPIO 2, `ACTIVE_LOW`, role `DIST_PUMP`)
     - `Raw Submersible Pump`: Relay Ch 4 (GPIO 4, `ACTIVE_LOW`, role `RAW_SUBMERSIBLE`)
     - `Dosing Pumps A & B`: MOSFET Ch 1 & 2 (GPIO 5 & 6, `ACTIVE_LOW`, roles `DOSING_A`, `DOSING_B`)
     - Optional Toggle: `Greenhouse Blower Fan` (Relay Ch 3, GPIO 10, `ACTIVE_LOW`, role `BLOWER_FAN`)
   - Operator clicks **`[ Deploy Standard Baseline ]`**: The UI constructs the canonical configuration payload, transmits via `PUT /api/v1/configuration`, and automatically re-discovers inventory, advancing directly to `5 Detected components (Ready)`.
2. **Hardware Management Portal (`/equipment`):**
   - Provides a **`[ Load Standard Baseline ]`** action button and friendly empty-state card allowing one-click template initialization at any time.

### 4.3. Actuator Driver Characteristics (Digital GPIO Switching vs. PWM)
In the AgroTech physical panel architecture:
- **Direct Digital GPIO Actuators:** All pumps (`pump_well`, `pump_dist`, `pump_submersible`, `pump_dosing_a`, `pump_dosing_b`) and fans are driven by digital outputs (`driverType: "gpio_actuator"` via `actuator_hal.c` calling `gpio_set_level`).
- **Absence of Hardware PWM / LEDC for Relays:** Relays and standard solenoid/MOSFET boards must not use PWM (preventing contact chatter and inductive destruction).
- **Time-Based Calibration:** Dosing control operates on calibrated runtime durations (`runtime_ms = (requested_ml / rate_ml_sec) * 1000`) rather than PWM speed regulation.
- **Form Simplification:** The placeholder `max_duty` parameter definition was purged from `hardwareCatalog.ts` and `canonicalHardwareBaseline.ts`. `parameterDefinitions: []` ensures the UI modal displays only necessary parameters (e.g. `k_factor` for pulse flow meters), preventing operator confusion.

### 4.4. Pin Map-Driven "Supported Equipment" Interactive Checklist & Multi-Complex / Per-GH Scoping (`/equipment`)
To eliminate arbitrary, error-prone GPIO pin selection and simplify hardware commissioning across complexes and greenhouses:
1. **Multi-Complex Listing (`ComplexSwitcher`):**
   - The `/equipment` page lists hardware per complex, offering an instant `ComplexSwitcher` dropdown in the header to switch contexts.
   - All state, active inventory, and configurations reload dynamically when switching complexes (`?complex=<id>`).
2. **Shared Facility vs. Per-Greenhouse (GH) Logic:**
   - **Shared Facility Resources (`ghId: null`):**
     - Actuators and sensors serving the entire complex or central mixing station are scoped to the complex level: Deep Well Pump (GPIO 1), Raw Submersible (GPIO 4), Dosing Pump A (GPIO 5), Dosing Pump B (GPIO 6), Cabinet Cooling Fan (GPIO 7), Mixing Tank Pump (GPIO 40), Alarm Beacon (GPIO 18), Raw Flow Meter ZJ-B1 (GPIO 15), Mixing Temp DS18B20 (GPIO 17), and Lower Float Switch (GPIO 38).
     - Marked with `🏢 Shared Facility (Semua GH)`.
   - **Greenhouse-Specific Equipment (`ghId: "gh-01"`, etc.):**
     - Hardware physically located inside or dedicated to a specific greenhouse: Greenhouse Blower Fans (GPIO 10) and Distribution Booster Pumps (GPIO 2).
     - Each card features an assignment dropdown allowing operators to allocate the hardware to a specific Greenhouse (`🌿 GH-01`, `🌿 GH-02`) or designate it as shared.
   - **Location Filter Bar:**
     - Provides instant view filtering by `[ Semua Peralatan ]`, `[ 🏢 Shared Fasilitas Bersama ]`, and per-greenhouse chips `[ 🌿 GH-01 ]`.
3. **One-Click Activation & Zero Re-Flashing:**
   - Operators simply check or uncheck which components are physically present in their panel.
   - Clicking **`[ Apply & Save Configuration ]`** builds the exact `ConfigurationPayload` with correct `assignment: { complexId, ghId }` and transmits it via `hardwareService.saveConfiguration(complexId, payload)` (`PUT /api/v1/configuration`).
   - The backend and physical ESP32 reload and activate the selected hardware dynamically without requiring firmware re-flashing.
   - **Operational State & Schedule Unblocking:**
     - Upon saving configuration, the backend and frontend update each greenhouse's `equipment` list with its assigned and shared components.
     - `enrichScheduleWithActivationState` detects the active resources (Fan, Distribution Pump, Mixing Tank/Pump, Well Pump), automatically clearing `ScheduleBlockedReason` items and transitioning previously `BLOCKED` schedules to `ACTIVE` / `scheduled`.

---

## 5. Architectural Verification & Compliance Matrix

| Subsystem | Requirement | Verification Method | Pass Criteria |
|:---|:---|:---|:---|
| **ESP32 Storage** | Store & load active configuration in NVS | NVS persistence + CRC | Valid canonical JSON, version/CRC consistent |
| **ESP32 No-Config Behavior** | Safe boot if no active configuration exists | Boot test with empty/invalid active config | Registry remains empty/unavailable; no hardware is invented |
| **OpenAPI Contract** | Match `UI_ESP32_OPENAPI.yaml` schema | REST smoke test `/api/v1/inventory` | EnvelopeBase conforming, HTTP 200 |
| **React UI Rendering** | Dynamic `.map()` over live inventory | Vite build & component mount | Dynamic cards rendered, 0 TypeScript errors |
