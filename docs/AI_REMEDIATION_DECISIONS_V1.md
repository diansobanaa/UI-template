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
- **What changes**: The HTTP handlers parse `{ghId}` but return 400 for anything other than `"gh-01"` for now.
- **Can implementation proceed without deciding?**: YES.

## DECISION-004: Authentication Method
- **Question**: Which authentication method will secure the local HTTP API?
- **Why it matters**: Zero authentication currently exists, leading to DoS/Takeover risks (BS-SEC-001).
- **Evidence**: `http_server.c` lacks auth checks.
- **Options**:
  1. Static Bearer Token / API Key.
  2. Local accounts with username/password.
- **Pros/cons**: Static key is simple but hard to rotate. Local accounts are secure but complex.
- **Recommended option**: Option 1 (Static API Key provisioned via NVS or Wi-Fi captive portal).
- **What changes**: HTTP middleware and UI `esp32-client.ts` headers.
- **Can implementation proceed without deciding?**: YES (can mock a dummy auth check first).
