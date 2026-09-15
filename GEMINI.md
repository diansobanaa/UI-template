# AI AGENT PROJECT INSTRUCTIONS

## Project
AgroTech Greenhouse Controller — ESP32-S3 + existing Vite/React UI.

## Repository authority
- Canonical shared API contract: `template/contracts/UI_ESP32_OPENAPI.yaml`
- ESP32 project root: `template/esp32/`
- Existing UI is protected existing work.
- ESP32 is runtime/physical authority.
- Python backend is not required for the direct UI ↔ ESP32 MVP.

## Safe-point / handover protocol
This repository is intentionally designed so another AI agent, another account, or another model can continue the work without the previous conversation.

Before substantial work:
1. Read this file.
2. Read `AI_PROGRESS.md`.
3. Read `AI_HANDOVER.md` if present.
4. Inspect `git status`.
5. Inspect the canonical contract and only the source relevant to the current task.
6. Do not redo completed safe points.

Before stopping:
1. Build/test the work.
2. Update ALL affected and related technical documentation files (.md) across `docs/` and `esp32/docs/` (Zero-Drift Documentation Rule).
3. Update `AI_PROGRESS.md`.
4. Update `AI_HANDOVER.md`.
5. Record changed files and reasons.
6. Record known issues and exact next action.
7. Create a Git commit at a stable safe point whenever the repository is in a buildable/testable state.

## Mandatory Documentation Synchronization Rule (Zero-Drift Policy)

**CRITICAL MANDATE FOR ALL AI AGENTS:**
Whenever ANY event, modification, feature, bug fix, architectural decision, pin reassignment, security interlock, or wiring change occurs that is worthy of documentation, the AI agent is **STRICTLY PROHIBITED** from finishing the task by only updating code. The AI agent MUST proactively identify and update **EVERY SINGLE RELATED DOCUMENT** across the entire repository.

### 1. Triggers that Require Immediate Documentation Updates
If any of the following occur:
1. **GPIO / Pin / Wiring Changes:**
   - Any pin added, moved, freed, or repurposed in firmware (`pin_config.h`, HAL drivers).
   - *Mandatory updates:* `docs/ESP32_GPIO_PIN_MAP.md`, `docs/HARDWARE_WIRING_MAP.md`, `docs/COMPONENT_PIN_MAP.md`, `docs/HARDWARE_INVENTORY.md`, `docs/HARDWARE_WIRING_CHECKLIST.md`, `docs/POWER_MAP.md`, `esp32/docs/ESP32_ASSEMBLY_GUIDE.md`.
2. **Safety, Security & Interlock Changes:**
   - Any emergency stop rule, dry-run protection, tamper loop, or sensor trip condition added or modified.
   - *Mandatory updates:* `docs/POWER_MAP.md`, `docs/HARDWARE_WIRING_MAP.md`, `docs/COMPONENT_PIN_MAP.md`, `docs/HARDWARE_WIRING_CHECKLIST.md`.
3. **Power, Electrical & Grounding Changes:**
   - Voltage levels, buck converter tuning, relay active levels, or ground domain isolation changes.
   - *Mandatory updates:* `docs/POWER_MAP.md`, `docs/HARDWARE_WIRING_MAP.md`.
4. **API, Endpoints & Contract Changes:**
   - Any REST endpoint, request/response field, payload structure, or enum modified or added.
   - *Mandatory updates:* `contracts/UI_ESP32_OPENAPI.yaml`, `UI_ESP32_COMMUNICATION_SPEC.md`, relevant service/handler files.
5. **Component Registry & Architecture Changes:**
   - Any change to `components.json`, dynamic hardware loading, expansion pathways (I2C PCA9685, MOSFETs, relays).
   - *Mandatory updates:* `docs/DYNAMIC_HARDWARE_REGISTRY_ARCHITECTURE.md`.
6. **Network, Power-Loss & Watchdog Features:**
   - Heartbeat intervals, timeout thresholds, sirens, notifications, or offline fallback handling.
   - *Mandatory updates:* `docs/POWER_MAP.md`, `AI_PROGRESS.md`, `AI_HANDOVER.md`.

### 2. Mandatory Dual-Location Mirroring Rule
Any file modified under `docs/*.md` MUST be copied identically to `esp32/docs/*.md` (exact character-for-character match). Never allow the firmware copy to diverge from the canonical `docs/` copy.

### 3. Verification & Handover Rule
Before declaring a safe point or finishing a turn:
1. Check `git status` to verify that all corresponding `.md` files were modified alongside the code.
2. Update `AI_PROGRESS.md` and `AI_HANDOVER.md` detailing every changed file, reason, and verification result.
3. If code is changed without updating all corresponding documentation, the task is **STRICTLY INCOMPLETE (FAIL)**.


## Safe-point rules
A safe point is a verified repository state, not merely a completed thought or partial edit.

Each safe point must have:
- ID, e.g. `SP-001`
- objective
- completed work
- verification result
- changed files
- known issues
- next safe point / next action
- Git commit hash

If a task is interrupted before the safe point:
- mark it `PARTIAL`
- preserve the partial work
- document exactly what is complete and incomplete
- do not falsely mark the feature complete.

## Do not trust conversation memory
Project files are the durable handover mechanism. Do not assume knowledge from an earlier chat/session/account.

## UI protection
Do not redesign, visually restyle, restructure, or rewrite unrelated UI.
When integration requires UI changes:
- make the smallest change;
- prefer the existing service/API adapter boundary;
- preserve existing UX;
- document every changed UI file and why.

## Contract discipline
Do not silently invent or change endpoints, fields, enums, status codes, or response shapes.
If UI, OpenAPI, or firmware conflict:
1. stop;
2. identify the conflict;
3. resolve it explicitly;
4. update all affected layers and tests.

## Verification
Never report success because code merely looks correct.
Separate:
- build result;
- automated test result;
- API contract result;
- UI integration result;
- physical hardware result.

A software PASS does not mean physical hardware is verified.

## Hardware safety
Never invent electrical ratings, fuse values, wire gauges, relay ratings, sensor coefficients, or module-specific wiring details. Mark missing information `VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION`.

## Current task
Read `AI_PROGRESS.md` and continue only from the latest safe point.
