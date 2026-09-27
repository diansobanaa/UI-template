# MANDATORY DOCUMENTATION SYNCHRONIZATION POLICY

## Scope
This policy applies to all AI agents (Antigravity, Codex, Claude, Gemini, GPT, etc.) operating in the AgroTech Greenhouse Controller workspace.

## Core Mandate: Canonical Documentation Policy
Any modification to code, firmware, hardware wiring, pin assignments, electrical parameters, API definitions, or user interface behaviors that materially changes documented behavior **MUST BE IMMEDIATELY AND PROACTIVELY REFLECTED IN THE RELEVANT CANONICAL MARKDOWN (.md) DOCUMENT(S)**.

AI agents are **STRICTLY FORBIDDEN** from marking a task complete or stopping after only modifying source code.

The repository has one canonical project documentation location:

`docs/`

Agents MUST NOT create, copy, mirror, or maintain duplicate Markdown documents under `esp32/docs/` solely for documentation synchronization.

Agents SHOULD prefer updating an existing canonical document over creating a new one.

---

## 1. Trigger Matrix: What Warrants Documentation Updates

| Trigger Event | Code / System Area | Mandatory Documentation Updates |
|---|---|---|
| **GPIO / Pin / Wiring Changes** | `pin_config.h`, HAL drivers, schematic | 1. `docs/ESP32_GPIO_PIN_MAP.md`<br>2. `docs/HARDWARE_WIRING_MAP.md`<br>3. `docs/COMPONENT_PIN_MAP.md`<br>4. `docs/HARDWARE_INVENTORY.md`<br>5. `docs/HARDWARE_WIRING_CHECKLIST.md`<br>6. `docs/ESP32_ASSEMBLY_GUIDE.md` |
| **Safety, Interlock & Anti-Theft** | `safety_monitor.c`, emergency stop logic | 1. `docs/POWER_MAP.md`<br>2. `docs/HARDWARE_WIRING_MAP.md`<br>3. `docs/COMPONENT_PIN_MAP.md`<br>4. `docs/HARDWARE_WIRING_CHECKLIST.md` |
| **Power & Electrical Topology** | Buck converters, relays, PSU, grounding | 1. `docs/POWER_MAP.md`<br>2. `docs/HARDWARE_WIRING_MAP.md` |
| **API Endpoints & Contracts** | REST handlers, request/response models | 1. `contracts/UI_ESP32_OPENAPI.yaml`<br>2. `UI_ESP32_COMMUNICATION_SPEC.md`<br>3. `src/lib/services.ts` |
| **Component Registry & Expansion** | `components.json`, dynamic HAL, I2C chips | 1. `docs/DYNAMIC_HARDWARE_REGISTRY_ARCHITECTURE.md`<br>2. `docs/HARDWARE_INVENTORY.md` |
| **Network, Alarms & UI Watchdogs** | Heartbeats, offline detection, sirens | 1. `docs/POWER_MAP.md`<br>2. `AI_PROGRESS.md`<br>3. `AI_HANDOVER.md` |

---

## 2. Canonical Documentation Location

`docs/` is the single canonical project documentation directory.

There is no project-level Markdown documentation mirror under `esp32/docs/`.

When firmware-specific documentation is required, place it in the appropriate canonical location under `docs/` rather than creating a duplicate copy under `esp32/docs/`.

A document must have one canonical location.

---

## 3. Safe-Point & Handover Protocol
Before stopping or declaring a Safe Point:
1. Run `git status` to ensure the relevant canonical documentation is updated alongside code changes.
2. Verify that `AI_PROGRESS.md` contains the complete list of changed files, verification results, and next actions.
3. Update `AI_HANDOVER.md` with durable context so the next session or agent can seamlessly resume without conversation history.
4. If a material documented behavior change is made without updating the relevant canonical documentation, the task is considered **FAILED / INCOMPLETE**.
