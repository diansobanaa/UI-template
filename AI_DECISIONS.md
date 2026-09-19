# AI DECISIONS

## Durable project decisions

### Repository layout
- ESP32 firmware must live under `template/esp32/`.
- Shared contracts must live under `template/contracts/`.
- Canonical API contract is `template/contracts/UI_ESP32_OPENAPI.yaml`.

### Architecture
- Existing Vite/React UI remains the primary UI.
- Direct MVP path is UI → ESP32 over local WLAN/LAN.
- ESP32 is the runtime/physical authority.
- Python is a later backend/data anchor, not a runtime dependency for the direct MVP.

### Agent workflow
- Work is divided into verified safe points.
- Git is the source of code state.
- `AI_PROGRESS.md` is the source of work-progress state.
- `AI_HANDOVER.md` is the next-agent briefing.
- `GEMINI.md` contains persistent agent rules.
- Different Gemini accounts/models may continue the same repository from these files.

### Safety
- Software completion and physical hardware verification are separate.
- Unknown electrical details must be explicitly marked for datasheet/manual verification.

### M5/M6 dynamic-runtime decision — 2026-09-19
- Runtime identity is resolved from the active configuration and hardware registry; legacy role/enumeration aliases may remain only as compatibility/UI fields and must not select physical hardware for configuration-driven operations.
- Tank-transfer commands use `sourceComponentId` and `destinationComponentId` as the runtime authority. Numeric actuator IDs are compatibility-only and are not accepted as the transfer execution identity.
- Resource transfer is a configuration proposal operation: physical-move confirmation is mandatory, ownership/component assignment are changed together, affected schedules are revalidated, capabilities are recalculated, and M3/M4 configuration deployment is required before the change becomes active.
