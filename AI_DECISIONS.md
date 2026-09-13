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
