# MANDATORY DOCUMENTATION SYNCHRONIZATION POLICY

## Scope
This policy applies to all AI agents (Antigravity, Codex, Claude, Gemini, GPT, etc.) operating in the AgroTech Greenhouse Controller workspace.

## Core Mandate: Zero-Drift Policy
Any modification to code, firmware, hardware wiring, pin assignments, electrical parameters, API definitions, or user interface behaviors that alters system behavior or warrants documentation **MUST BE IMMEDIATELY AND PROACTIVELY REFLECTED IN EVERY RELATED MARKDOWN (.md) DOCUMENT** in the repository.

AI agents are **STRICTLY FORBIDDEN** from marking a task complete or stopping after only modifying source code.

---

## 1. Trigger Matrix: What Warrants Documentation Updates

| Trigger Event | Code / System Area | Mandatory Documentation Updates |
|---|---|---|
| **GPIO / Pin / Wiring Changes** | `pin_config.h`, HAL drivers, schematic | 1. `docs/ESP32_GPIO_PIN_MAP.md`<br>2. `docs/HARDWARE_WIRING_MAP.md`<br>3. `docs/COMPONENT_PIN_MAP.md`<br>4. `docs/HARDWARE_INVENTORY.md`<br>5. `docs/HARDWARE_WIRING_CHECKLIST.md`<br>6. `esp32/docs/ESP32_ASSEMBLY_GUIDE.md` |
| **Safety, Interlock & Anti-Theft** | `safety_monitor.c`, emergency stop logic | 1. `docs/POWER_MAP.md`<br>2. `docs/HARDWARE_WIRING_MAP.md`<br>3. `docs/COMPONENT_PIN_MAP.md`<br>4. `docs/HARDWARE_WIRING_CHECKLIST.md` |
| **Power & Electrical Topology** | Buck converters, relays, PSU, grounding | 1. `docs/POWER_MAP.md`<br>2. `docs/HARDWARE_WIRING_MAP.md` |
| **API Endpoints & Contracts** | REST handlers, request/response models | 1. `contracts/UI_ESP32_OPENAPI.yaml`<br>2. `UI_ESP32_COMMUNICATION_SPEC.md`<br>3. `src/lib/services.ts` |
| **Component Registry & Expansion** | `components.json`, dynamic HAL, I2C chips | 1. `docs/DYNAMIC_HARDWARE_REGISTRY_ARCHITECTURE.md`<br>2. `docs/HARDWARE_INVENTORY.md` |
| **Network, Alarms & UI Watchdogs** | Heartbeats, offline detection, sirens | 1. `docs/POWER_MAP.md`<br>2. `AI_PROGRESS.md`<br>3. `AI_HANDOVER.md` |

---

## 2. 100% Dual-Location Mirroring Rule
The canonical master documentation is located in `docs/`. The ESP32 firmware documentation mirror is located in `esp32/docs/`.
- Whenever ANY file in `docs/*.md` is updated, it **MUST be copied identically to `esp32/docs/*.md`**.
- Content, tables, and references must match 100% (exact SHA-256 equivalent).

---

## 3. Safe-Point & Handover Protocol
Before stopping or declaring a Safe Point:
1. Run `git status` to ensure all relevant `.md` documents are staged alongside code changes.
2. Verify that `AI_PROGRESS.md` contains the complete list of changed files, verification results, and next actions.
3. Update `AI_HANDOVER.md` with durable context so the next session or agent can seamlessly resume without conversation history.
4. If code is changed without updating all corresponding documentation, the task is considered **FAILED / INCOMPLETE**.
