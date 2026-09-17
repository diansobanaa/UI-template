# ACTUAL PRODUCT REQUIREMENTS DOCUMENT (PRD)
> **Source of Truth:** This PRD strictly represents the *actual* implemented codebase in `d:\template` (Vite/React UI + ESP32 Firmware) as of current verification. Assumptions and non-implemented "planned" features have been omitted.

## 1. System Overview
The AgroTech system is a local greenhouse automation platform consisting of two closely coupled layers:
1. **Frontend UI (Single Page Application)**: Built with React, Vite, and Tailwind CSS. It communicates either with an in-memory simulated store (for UI-only mode) or directly to the ESP32 via a REST API client (`isDirectEsp32Enabled()`).
2. **Firmware (ESP32-S3)**: Built with ESP-IDF in C. It serves the REST API, executes hardware control loops, and persists state in NVS (Non-Volatile Storage) and an SD Card.

The contract between these two layers is defined strictly by the canonical OpenAPI spec (`UI_ESP32_OPENAPI.yaml`).

## 2. Supported Hardware & Peripherals (Firmware Layer)
The ESP32 firmware implements support for the following hardware layers:
- **Core**: ESP32-S3 (with NVS storage).
- **Timekeeping**: DS3231 RTC Module (synced to system time on boot).
- **Storage**: SD Card (via `sdcard_hal`).
- **Display**: ST7735 TFT Display (used exclusively for a boot diagnostic screen showing Device ID and Firmware Version).
- **Actuators (GPIO)**: 
  - Well Pump (`PIN_OUT_WELL_PUMP`)
  - Distribution Pump (`PIN_OUT_DIST_PUMP`)
  - Raw Submersible Pump (`PIN_OUT_RAW_SUBMERSIBLE`)
  - Dosing Pump A (`PIN_OUT_DOSING_A`)
  - Dosing Pump B (`PIN_OUT_DOSING_B`)
  - Cooling Fan (`PIN_OUT_COOLING_FAN`)
  - Error Lamp (`PIN_OUT_ERROR_LAMP`)
- **Safety Interlock**: A hard-coded `safe_boot_actuators()` function initializes all 7 actuator output pins to a safe OFF state immediately on boot, before any other OS tasks begin.

## 3. Data Models (Domain Entities)
The frontend (`src/lib/types.ts`) and OpenAPI spec define the following core entities:
- **Complex**: The root location entity managing shared resources (Well Pump, Raw Tank). Tracks a latched `emergencyStopped` state.
- **Greenhouse**: A sub-unit assigned to a Complex. Tracks its own:
  - Telemetry (Temperature, Humidity, Light, Tank Level).
  - Crop Cycle (Masa Tanam).
  - Recipes (Water L, Dosing A/B mL, Target EC).
  - Schedules (Fertigation and Fan).
- **Fertigation Run**: Tracks an active dosing and mixing sequence with distinct stages and progress.

## 4. Implemented Features (Verified in Code)

### 4.1. Dashboard & Monitoring (`page.tsx`)
- **Real-Time Telemetry**: Displays current Temperature, Humidity, Light (Lux), and Tank levels.
- **Historical Charts**: Renders historical telemetry using Area and Dual-Line charts across selectable ranges (24H, 7D, 30D).
- **Visual Greenhouse Representation**: A specialized `GreenhouseArt` UI component represents the physical state of the greenhouse.

### 4.2. Crop Cycle Management (Masa Tanam)
The system tracks the lifecycle of a crop with a dedicated visual timeline (`CropCycleTimeline`).
- **State Tracking**: `NO_CYCLE`, `ACTIVE`, `HARVESTED`.
- **Key Dates**: Tanggal Tanam (Planting Date), Tanggal Polinasi (Pollination Date).
- **Age Tracking**: HST (Hari Setelah Tanam) and HSP (Hari Setelah Polinasi).
- **Timeline Phases**: Seed, Vegetative, Flowering, Fruiting, Ripening, Harvest.
- **Cycle Actions**: 
  - Start new cycle.
  - Import ongoing cycle.
  - Record / Update Pollination date (enables HSP tracking).
  - Update planting metadata (variety, plant count, notes).
  - Harvest (records yield Kg and grade).
  - Cancel / Reset Cycle.

### 4.3. Fertigation & Mixing Engine (Firmware `fertigation_mgr`)
The ESP32 firmware includes a dedicated state machine for executing fertigation sequences.
- **States**: `IDLE` → `FILLING` → `DOSING` → `FINAL_MIXING` → `DELIVERY` → `COMPLETE` (or `INTERRUPTED`).
- **Recipes**: Defined in the UI by Target Water (L) and Nutrients (mL).
- **Execution**: Can be triggered manually via UI or by the Scheduler. 
- **Validation**: Firmware blocks starting a new fertigation batch if one is already running (`FERT_STATE_IDLE` check).

### 4.4. Scheduling System
- **Fertigation Schedules**: Triggers specific recipes. Can repeat (Daily, Weekdays, Specific Days) and supports target modes (Volume or PPM).
- **Well Pump Schedules**: Triggers the main well pump for a defined duration (minutes).
- **Fan Schedules**: Supports two modes:
  - **Time-based**: Runs for a set duration.
  - **Temperature-based**: Turns ON above a threshold (`onAboveC`) and OFF below a threshold (`offBelowC`).
- **Persistence**: Schedules are passed from the UI and saved into the ESP32's NVS memory so they run autonomously.

### 4.5. Calibration Suite
The UI provides a dedicated calibration flow for hardware components.
- **Supported Sensors**: pH, EC, Temp/Humidity, Flow Meter, Water Level.
- **Dosing Pumps**: Supports a volumetric calibration test (runs pump for exactly 30 seconds to calculate mL/sec rate). 
- **Persistence**: Calibration rates (`rateMlPerSec`) are sent to the ESP32 and saved to NVS.

### 4.6. Safety & Emergency Controls
- **Emergency Stop**: The UI can trigger a global Emergency Stop command.
- **Frontend Behavior**: `complexService.emergencyStop()` latches the UI into a stopped state, blocking any manual runs or pump activations until explicitly resumed.
- **Firmware Behavior**: Triggers an emergency stop endpoint, forcing the `safety_monitor` to shut off actuators.
- **Radar Interlock**: The UI explicitly blocks the well pump from turning ON manually if the Raw Water Tank radar indicates it is full (>= 95%).

## 5. API Contracts (REST Layer)
The ESP32 exposes the following validated REST endpoints:
- **Device Operations**: `/api/v1/health`, `/api/v1/status`, `/api/v1/inventory`, `/api/v1/capabilities`, `/api/v1/context`.
- **Clock**: `/api/v1/clock`, `/api/v1/clock-sync`.
- **Commands**: `/api/v1/commands` (Starts fertigation, toggles pumps, etc.), `/api/v1/commands/emergency-stop`.
- **Crop Cycle**: CRUD operations under `/api/v1/greenhouses/{ghId}/crop-cycles`.
- **Telemetry & Events**: `/api/v1/telemetry`, `/api/v1/events`.
- **Calibration**: `/api/v1/calibration` (Runs tests), `/api/v1/calibration/rate` (Gets/Sets rates).
- **Schedules**: `/api/v1/schedules` (CRUD for autonomous schedules).

## 6. Known Codebase Constraints & Behaviors
- **Simulation Layer**: The UI defaults to an in-memory simulated store (`store.ts`) for development. To interact with the physical ESP32, the `isDirectEsp32Enabled()` flag must evaluate to true.
- **No Python Backend**: While the source mentions a "Python backend" in comments, the *actual* implemented integration is strictly UI ↔ ESP32 directly via `http://esp32.local`.
- **Display Degradation**: If the ST7735 TFT display is not connected, the ESP32 safely logs a warning and falls back to degraded headless mode rather than crashing.
