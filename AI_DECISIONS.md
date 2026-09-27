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

### System Topology Pool Hardening Decision — 2026-09-21
- Transport Bearer authentication (`http_check_auth`) is enforced on `POST /api/v1/topology-pool/sync` and `POST /api/v1/topology-pool/mutate` to prevent forged or unauthenticated peer mutations.
- `ownerDeviceId` in the replicated pool is the sole authority for mutating a Complex or its assigned Greenhouses. Unauthenticated or non-owner callers are rejected with `TOPOLOGY_OWNER_CONFLICT` (HTTP 409).
- Multi-ESP32 Discovery mechanism: Browser bootstraps from candidate seed controller (or backend mirror if no seed reachable), extracts known devices from replicated `devices[]` registry, and directly probes each known peer endpoint. Reachable nodes are marked `LIVE`; unreachable nodes remain known and are marked `OFFLINE`.
- Backend Non-Authority: Backend topology mirror is strictly non-authoritative fallback. If live ESP32s are reachable, ESP32 operational truth wins. If 0 ESP32s are reachable, backend mirror data is explicitly labeled `authorityStatus: STALE` with `operationalStatus: STALE`. Backend cannot silently overwrite live ESP32 topology.
- Tombstones with monotonic revisions prevent deleted entities from being resurrected by reconnecting stale peers.
- Browser Zero-Persistence Invariant: Browser stores zero topology data in `localStorage`, `sessionStorage`, cookies, or `IndexedDB`. State is reconstructed purely into ephemeral memory on every page reload.
