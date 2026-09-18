# AI REMEDIATION DECISIONS V1

## DECISION-001: Safe Pin Allocations
- **Question**: Which safe GPIO pins should replace GPIO 19 (Lower Float) and GPIO 47 (MicroSD CS)?
- **Why it matters**: GPIO 19 conflicts with USB Native D-. GPIO 47 conflicts with Octal PSRAM. 
- **Evidence**: ESP32-S3 datasheet confirms conflicts. 
- **Options**:
  1. Re-map to unassigned safe pins (e.g., GPIO 4, 5, 6, 7).
  2. Disable USB Native or downgrade to Quad PSRAM.
- **Pros/cons**: Option 1 is standard and requires no feature degradation.
- **Recommended option**: Option 1 (Re-map to safe pins like GPIO 4 and GPIO 5).
- **User Decision**: Re-map to GPIO 26 and GPIO 27 (implemented in SP-REMED-001).
- **What changes**: `pin_config.h` and the hardware assembly guide diagram.
- **Can implementation proceed without deciding?**: NO.

## DECISION-002: Primary Network Interface
- **Question**: Should the firmware target Wi-Fi (STA), Wi-Fi (AP), or Ethernet (W5500) as the primary network interface on first boot?
- **Why it matters**: Current code fails to initialize any network drivers. The fix must choose which PHY to initialize by default.
- **Evidence**: Missing `esp_wifi_init()` or ethernet initializations.
- **Options**:
  1. Wi-Fi SoftAP fallback for provisioning, STA for operation.
  2. SPI W5500 Ethernet only.
- **Pros/cons**: Wi-Fi provides ease of use but lower reliability. Ethernet is robust for greenhouses.
- **Recommended option**: Option 1 (Wi-Fi STA with SoftAP fallback).
- **User Decision**: Option 1 (Wi-Fi STA with SoftAP fallback).
- **What changes**: `network_mgr.c` implementation details.
- **Can implementation proceed without deciding?**: YES, can mock or pick Wi-Fi as default, but project direction is needed.
## DECISION-003: Topology/Valve Architecture for Multi-GH
- **Question**: How does the system handle fluid routing to `"gh-02"` when only one physical ESP32 handles mixing?
- **Why it matters**: Removing the hardcoded `"gh-01"` means the system must know which valves to open to route fluid to GH 1 vs GH 2.
- **Evidence**: `BS-TOP-001` notes lack of multi-GH routing hardware logic.
- **Options**:
  1. Single-GH assumption remains true for Phase 1.
  2. Implement Valve Matrix HAL for multi-GH.
- **Pros/cons**: Option 1 is faster but tech debt. Option 2 requires physical valves.
- **Recommended option**: Option 1 for Phase 1, but parameterize the API anyway.
- **User Decision**: Option A (Phase 1 supports dynamic `{ghId}` API, only 1 physically installed GH registered, e.g. `"gh-01"`. Requests for unregistered/unsupported GHs return contract-defined 404/400. Do not implement virtual multi-GH valve matrix or assign extra valve GPIOs).
- **What changes**: HTTP handlers parse `{ghId}` dynamically; validate against registered greenhouse list; return 404/400 if not found.
- **Can implementation proceed without deciding?**: YES (Decided).

## DECISION-004: Authentication Method
- **Question**: Which authentication method will secure the local HTTP API?
- **Why it matters**: Zero authentication currently exists, leading to DoS/Takeover risks (BS-SEC-001).
- **Evidence**: `http_server.c` lacks auth checks.
- **Options**:
  1. Static Bearer Token / API Key.
  2. Local accounts with username/password.
- **Pros/cons**: Static key is simple but hard to rotate. Local accounts are secure but complex.
- **Recommended option**: Option 1 (Static API Key provisioned via NVS).
- **User Decision**: Option A (Static API key with `Authorization: Bearer <token>`. Stored in NVS, used on all control/command/E-stop endpoints. Provisioning/setup support. Never log token plaintext).
- **What changes**: HTTP auth middleware in `http_server.c` and UI `esp32-client.ts` headers.
- **Can implementation proceed without deciding?**: YES (Decided).

## SP-REMED-006 to SP-REMED-009 Additional Decisions
- **BS-SCHED-001 (Firmware Scheduler)**: Device-owned, persistent in NVS. Structured schedule model (day-of-week, specific date, interval, action/duration). High-volume logs on microSD. Evaluates against authoritative time (1 min eval) and dispatches via Command Manager -> Safety -> Queue -> Worker. Handles reboot, missed schedule, duplicate prevention, and cancellation. No cron parser library.
- **BS-UI-001/002 (UI Alignment)**: `startManualFertigation` and `resumeExecution` in `services.ts` invoke real `POST /api/v1/commands` (`START_FERTIGATION`, `RESUME_CYCLE`) and asynchronously poll `commandId` until terminal status. No browser `setTimeout` as runtime controller.
- **BS-TEST-001 (E2E Test)**: `scripts/verify_e2e_contracts.mjs` targets live ESP32 by default via `--target <IP>` or `ESP32_BASE_URL`. Fails if unreachable or test fails. Mock mode only runs if `--mock` flag is explicitly passed. No auto-fallback.

