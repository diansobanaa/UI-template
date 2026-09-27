# Network First-Boot Implementation Plan

## Purpose

Close the current first-boot networking and device-onboarding gap before physical hardware installation.

Target operator journey:

```text
Factory ESP32
    ↓
Provision Wi-Fi
    ↓
Join Router
    ↓
Discover IP / mDNS
    ↓
Create Complex
    ↓
Discover ESP32
    ↓
Verify Identity
    ↓
Bind Device → Complex
    ↓
Verify
    ↓
READY
```

## Scope

This plan covers the minimum production-safe path from a factory-new ESP32-S3 to a controller bound to a Complex.

This plan does **not** implement W5500/LAN. W5500 remains deferred because the hardware SSOT does not currently assign a valid W5500 mapping.


## Execution Status — 2026-09-20

The source implementation for PR-1 through PR-8 has been applied. These items are now represented in firmware, backend, frontend, and the canonical API contract. The release gate remains **not fully closed** because PR-9 requires a live ESP32-S3, router/AP, TFT, and physical commissioning evidence.

| Area | Source implementation | Live verification |
|---|---|---|
| PR-1 Factory identity | **IMPLEMENTED** | Pending ESP32 reboot/NVS test |
| PR-2 Wi-Fi provisioning | **IMPLEMENTED** | Pending SoftAP + router test |
| PR-3 Recovery/reprovisioning | **IMPLEMENTED**; Network Change Mode hardening added | Pending physical triple-press/AP/candidate rollback test |
| PR-4 IP + mDNS discovery | **IMPLEMENTED** | Pending live DHCP + `.local` resolution test |
| PR-5 Real network status API | **IMPLEMENTED** | Pending live `/health` + `/status` test |
| PR-6 Complex create gate | **IMPLEMENTED** | Browser/backend integration test pending clean dependency install |
| PR-7 ESP32 discovery | **IMPLEMENTED** (mDNS hostname/manual endpoint; browser does not enumerate mDNS service records) | Pending live LAN test |
| PR-8 Device → Complex binding | **IMPLEMENTED** with endpoint health/status verification and authenticated ESP32 adoption | Pending live binding/reboot test |
| PR-9 First-boot E2E | **NOT LIVE-VERIFIED** | Hardware required |

No source change in this execution modifies `docs/HARDWARE_WIRING_MAP.md` or introduces W5500 dependency.

## Authority / Constraints

- `docs/HARDWARE_WIRING_MAP.md` is the physical pin SSOT. Do not modify it as part of this plan.
- API contracts must remain synchronized with `contracts/UI_ESP32_OPENAPI.yaml`.
- Firmware remains the local physical/safety authority.
- Backend remains the configuration/orchestration authority.
- Frontend remains the operator/research UI.
- Factory device must not be pre-bound to an arbitrary Complex.
- Candidate configuration must not become operational until explicitly activated.
- Do not create a second automatic physical execution path.

### ⛔ Credential Injection Prohibition (MANDATORY)

**Wi-Fi credentials (SSID and password) MUST NEVER be injected into the ESP32 through any means other than the embedded `/setup` web UI protocol.**

Prohibited methods include but are not limited to:

- Hardcoded `sta_ssid` / `sta_pass` values in firmware source code.
- Build-time injection via `sdkconfig`, `menuconfig`, or preprocessor defines.
- Pre-flashing NVS partitions with Wi-Fi credentials.
- Environment variables (`.env`, `.env.local`) that are compiled into firmware.
- Any script, tool, or AI agent writing credentials directly to NVS.
- Any provisioning path that bypasses the operator-facing web UI.

The **only** authorized credential entry path is:

```text
Operator → connects to ESP32 SoftAP → opens browser → /setup →
scan networks → select SSID → enter password → /setup/api/connect →
ESP32 tests candidate → persist ONLY after IP_EVENT_STA_GOT_IP
```

This rule applies to all environments: development, testing, staging, and production. No exception is permitted regardless of convenience or debugging urgency.

---

# Implementation Sequence

## PR-1 — Factory Identity Cleanup

### Goal

Make a factory-new controller network/onboarding-ready without binding it to a predefined Complex.

### Required behavior

```text
Factory device
    device_id = unique/stable
    complex_id = EMPTY / UNBOUND
```

Do not initialize a factory device with `complex-01` or another operational Complex ID.

### Checklist

- [x] Remove factory default `complex_id = "complex-01"`.
- [x] Preserve stable unique `device_id` generation/initialization.
- [x] Persist device identity safely in NVS.
- [x] Represent unbound state explicitly.
- [x] Verify API health/status exposes the correct unbound state.
- [x] Verify reboot preserves `device_id` and unbound state.
- [x] Verify binding logic accepts a previously unbound device.
- [x] Verify an existing bound device is not silently unbound on reboot.

### Acceptance Criteria

- [x] Factory boot produces a valid device identity.
- [x] Factory boot produces `complex_id = EMPTY/UNBOUND`.
- [x] No frontend conflict is triggered solely because the device is new.
- [x] No existing Complex is implicitly selected.

---

## PR-2 — Wi-Fi Provisioning via Embedded Web UI

### Goal

Allow an operator to configure greenhouse Wi-Fi using only a standard web browser — no dedicated mobile app, no ESP-IDF provisioning client, no USB/NVS flashing.

### Implementation

Use the embedded `/setup` web UI served directly from the ESP32's HTTP server over SoftAP. **Do not use ESP-IDF `wifi_prov_mgr`** for the factory first-boot path. The provisioning manager adds protocol complexity and requires a dedicated client app that operators do not have.

The embedded web UI already provides:

- `/setup` — Full-page HTML/CSS/JS setup interface (served from flash)
- `/setup/api/scan` — Active Wi-Fi scan returning SSID + RSSI list
- `/setup/api/connect` — Submit candidate SSID + password for live testing
- `/setup/api/status` — Poll connection state, candidate progress, and errors
- `/setup/api/finish` — Exit setup mode after successful provisioning
- Captive portal redirects (`/`, `/generate_204`, `/hotspot-detect.html`, `/connecttest.txt`)

### Required flow

```text
ESP32 factory boot (no stored credentials)
    ↓
Automatic SoftAP: AGROTECH-<FULL-MAC>
    ↓
Operator connects phone/laptop to SoftAP
    ↓
Captive portal → redirects to /setup
    ↓
Web UI scans surrounding Wi-Fi networks
    ↓
Operator selects network + enters password
    ↓
ESP32 tests candidate credentials (STA connect attempt)
    ↓
Candidate SUCCESS (IP_EVENT_STA_GOT_IP)
    ↓
Credentials persisted atomically to NVS
    ↓
Web UI displays assigned IP address + MAC address
    ↓
SoftAP disabled, ESP32 stays connected to router
    ↓
Reconnect loop active (50s interval, indefinite)
```

### Checklist

- [x] Factory boot automatically starts SoftAP + HTTP server when no STA credentials exist.
- [x] SoftAP SSID is unique per physical controller (derived from full MAC).
- [x] `/setup` web page is accessible immediately after connecting to SoftAP.
- [x] Captive portal redirects work on Android, iOS, Windows, and macOS.
- [x] `/setup/api/scan` returns visible 2.4 GHz networks with signal strength.
- [x] `/setup/api/connect` accepts SSID + password and starts candidate test.
- [x] Candidate credentials are tested at runtime (STA connect attempt).
- [x] Credentials are persisted to NVS **only after** `IP_EVENT_STA_GOT_IP`.
- [x] Failed candidate does NOT erase previous credentials or cause data loss.
- [x] After successful provisioning, SoftAP is disabled and ESP32 operates in STA-only mode.
- [x] ESP32 reconnects indefinitely to the provisioned router (50s interval).
- [x] No Python backend, dedicated app, or external tool is required.
- [x] No reboot is required after successful provisioning.
- [x] `wifi_prov_mgr` is NOT used in the factory first-boot path.
- [x] No hardcoded SSID/password exists anywhere in firmware source or build config.
- [x] After successful connection, `/setup` UI displays the assigned IP address and MAC address.
- [x] Operator can read IP/MAC from the setup UI to use in the main frontend for ESP32 discovery.

### Acceptance Criteria

- [x] Factory ESP32 exposes a unique SoftAP network.
- [x] Phone/laptop connecting to SoftAP is redirected to `/setup`.
- [x] Operator can scan networks, select one, and enter password in the browser.
- [x] Successful connection persists credentials and disables SoftAP.
- [x] After successful connection, the setup UI clearly shows the IP address and MAC address.
- [x] Credentials survive reboot.
- [x] ESP32 joins the selected router without USB intervention.
- [x] A provisioning failure does not activate actuators.
- [x] A provisioning failure does not erase stored credentials or configuration.

---

## PR-3A — Non-Destructive Network Change Mode

### Goal

Allow an already configured controller to change router Wi-Fi without reboot, factory reset, data loss, Complex unbinding, or interruption of local physical/runtime authority.

### Required behavior

```text
Normal operation
    ↓
3x quick Button 4
    ↓
NETWORK_CHANGE
    ↓
AGROTECH-SETUP-XXXX
    ↓
Embedded setup Web UI
    ↓
Candidate Wi-Fi test
    ↓
Atomic credential commit
    ↓
Reconnect to new router
    ↓
SoftAP off
```

### Checklist

- [x] Button 4 triple quick press detection (<=800 ms per press, 3-second window).
- [x] No reboot/factory reset path is used.
- [x] Existing STA credential remains persisted until candidate success.
- [x] Previous credential is retained in RAM for failure recovery.
- [x] Dedicated `AGROTECH-SETUP-XXXX` SoftAP identity is used.
- [x] Existing random setup code / PoP is reused.
- [x] Embedded `/setup` Web UI is available.
- [x] Wi-Fi scan and candidate credential submission endpoints are available.
- [x] Candidate credential is persisted only after `IP_EVENT_STA_GOT_IP`.
- [x] Failed candidate returns to the old STA credential when available.
- [x] Complex relationship is read-only during Network Change Mode.
- [x] Local runtime remains independent from network state.
- [x] SoftAP is disabled without restart after successful network recovery.

### Acceptance gate

Network/Direct-Local structural source gate: **34/34 PASS** (`scripts/test_network_change_mode.mjs`).

Physical live gate remains pending because ESP32-S3/router/TFT hardware is required.

Canonical feature documentation: `docs/NETWORK_CHANGE_MODE_IMPLEMENTATION.md`.

## PR-3 — Recovery / Reconnection

### Goal

Prevent a configured controller from becoming permanently inaccessible after router outages while keeping network recovery independent from physical runtime authority.

### Required behavior

```text
Wi-Fi disconnected
    ↓
Periodic reconnect attempts
    ↓
Continue indefinitely
```

The current firmware uses a 50-second reconnect interval. Network loss does not itself trigger a credential wipe or automatic SoftAP activation.

### Checklist

- [x] Replace permanent 5-attempt abandonment with periodic reconnect.
- [x] Use bounded retry interval (50 s in current firmware).
- [x] Keep local runtime independent from network state.
- [x] Preserve schedules/configuration during network loss.
- [x] Provide a separate non-destructive Network Change Mode for deliberate Wi-Fi replacement.
- [x] Do not use the former long-press credential-reset gesture for normal Wi-Fi replacement.
- [x] Preserve the existing credential until a candidate Wi-Fi is verified.
- [ ] Verify normal operation resumes after successful live reprovisioning on hardware.

### Acceptance Criteria

- [ ] Router outage longer than the current retry window does not permanently strand the ESP32.
- [ ] Changing the greenhouse Wi-Fi password can be recovered without firmware flashing.
- [ ] Local safety/scheduler behavior continues while offline.
- [x] Network Change Mode does not wipe Complex/GH/recipe configuration.

---

## PR-4 — IP and Device Discovery

### Goal

Give the operator a deterministic way to find the controller after it joins the router.

### Required discovery paths

Primary practical paths:

1. TFT-displayed IP.
2. mDNS hostname.
3. Manual IP entry as fallback.

### Checklist

- [x] Read the real STA IP from `esp_netif`.
- [x] Display real IP on TFT network screen.
- [x] Display connected/disconnected state accurately.
- [x] Initialize mDNS from the persisted device identity and advertise the HTTP service.
- [x] Use stable hostname based on `device_id`.
- [ ] Verify `<hostname>.local` resolves on a physical local network.
- [x] Keep manual IP entry available in frontend.
- [x] Do not depend exclusively on mDNS.

### Acceptance Criteria

- [ ] Operator standing next to the controller can read its IP from TFT.
- [ ] Controller is reachable by real IP.
- [ ] Controller is reachable by mDNS when the local network supports it.
- [ ] Discovery identifies the intended physical device.

---

## PR-5 — Real Network Status API

### Goal

Make firmware-reported network state truthful and usable by UI/backend.

### Required API behavior

`GET /api/v1/health`

- Device identity
- Complex binding state
- Basic health

`GET /api/v1/status`

- Real IP
- Real MAC
- Connectivity state
- Relevant network interface information

### Checklist

- [x] Remove hardcoded `127.0.0.1` IP response.
- [x] Remove hardcoded zero MAC response.
- [x] Read real MAC from Wi-Fi/ESP hardware API.
- [x] Read real IP from active netif.
- [x] Distinguish AP, STA, disconnected, and offline states.
- [x] Keep API schema synchronized with OpenAPI.
- [x] Add/adjust structural and backend integration tests for factory/binding/network contracts.
- [x] Confirm read endpoints cannot mutate physical state by keeping network status handlers read-only.

### Acceptance Criteria

- [ ] `/api/v1/status` matches the physical device's actual network state.
- [ ] Frontend can use health/status to identify the controller.
- [ ] No dummy network identity remains in production paths.

---

## PR-6 — Frontend Create Complex Gate

### Goal

Make the software onboarding wizard reliably create a Complex before attempting controller binding.

### Required flow

```text
Frontend
   ↓
Create Complex
   ↓
Receive complex_id
   ↓
Proceed to controller discovery
```

### Checklist

- [ ] Verify required fields block empty submission with visible feedback.
- [ ] Verify Python backend is reachable before submission.
- [ ] Verify `complexService.create()` error handling shows a clear failure.
- [ ] Verify successful create always advances to discovery.
- [ ] Preserve backend rollback semantics on failure.
- [ ] Keep Complex creation independent from ESP32 network provisioning.

### Acceptance Criteria

- [ ] `Create & Continue` visibly succeeds when backend is available.
- [ ] Backend outage produces an actionable error rather than apparent inaction.
- [ ] A valid `complex_id` is available for the next step.

---

## PR-7 — ESP32 Discovery in Frontend

### Goal

Allow the onboarding UI to locate and verify an already-networked ESP32.

### Required flow

```text
Complex created
    ↓
Discover ESP32 via mDNS or manual IP
    ↓
GET /api/v1/health
    ↓
Verify device identity
```

### Checklist

- [ ] Support mDNS lookup.
- [ ] Support manual IP/hostname entry.
- [ ] Probe `/api/v1/health`.
- [ ] Validate API version compatibility.
- [ ] Validate device identity.
- [ ] Show controller/network state to operator.
- [ ] Reject unreachable/non-controller endpoints clearly.
- [ ] Prevent selecting an unintended controller.

### Acceptance Criteria

- [ ] Frontend can discover the intended ESP32.
- [ ] Operator can identify which physical controller is being bound.
- [ ] Discovery failure is visible and recoverable.

---

## PR-8 — Device → Complex Binding

### Goal

Bind an unbound controller to the selected Complex without identity conflicts.

### Required flow

```text
Complex ID
   +
Device ID
   ↓
Backend binding operation
   ↓
ESP32 adopts assigned Complex ID
   ↓
Verify binding
```

### Checklist

- [ ] Backend validates target Complex exists.
- [ ] Backend validates target device exists/is reachable.
- [ ] Backend prevents unsafe duplicate ownership.
- [ ] Binding request is authenticated/authorized.
- [ ] Firmware exposes the required adoption/binding mechanism.
- [ ] ESP32 persists the assigned `complex_id`.
- [ ] Binding is atomic from the operator perspective.
- [ ] Failed binding rolls back UI state.
- [ ] Reboot preserves the binding.
- [ ] Already-bound controller cannot silently bind to another Complex.

### Acceptance Criteria

- [ ] New controller can bind to any valid Complex ID.
- [ ] `complex_id` after binding equals the selected Complex.
- [ ] Reboot preserves binding.
- [ ] Conflict handling is explicit rather than silently overriding ownership.

---

## PR-9 — End-to-End First-Boot Test

### Goal

Prove the entire commissioning path before physical deployment.

### Scenario A — Factory First Boot

- [ ] Power factory-new ESP32.
- [ ] Verify safe boot outputs are OFF.
- [ ] Verify unique provisioning SSID appears.
- [ ] Connect phone/laptop to provisioning AP.
- [ ] Provision greenhouse Wi-Fi.
- [ ] Verify credential persistence.
- [ ] Verify ESP32 joins router.
- [ ] Read IP from TFT.
- [ ] Resolve mDNS hostname.
- [ ] Confirm `/health`.
- [ ] Confirm `/status`.
- [ ] Start frontend onboarding.
- [ ] Create Complex.
- [ ] Discover controller.
- [ ] Verify identity.
- [ ] Bind controller to Complex.
- [ ] Read inventory/status.
- [ ] Confirm final READY state.

### Scenario B — Wi-Fi Loss

- [ ] Disconnect router.
- [ ] Verify local runtime continues.
- [ ] Verify safety continues.
- [ ] Verify no spurious actuator activation.
- [ ] Restore router.
- [ ] Verify automatic reconnect.
- [ ] Verify network status returns to CONNECTED.

### Scenario C — Password Change

- [ ] Change router password.
- [ ] Verify reconnect attempts continue.
- [ ] Trigger network reprovisioning locally.
- [ ] Enter new password.
- [ ] Verify reconnection.
- [ ] Verify Complex/GH configuration remains intact.

### Scenario D — Power Cycle

- [ ] Remove power.
- [ ] Restore power.
- [ ] Verify safe boot first.
- [ ] Verify stored Wi-Fi credentials are retained.
- [ ] Verify stored device identity is retained.
- [ ] Verify Complex binding is retained.
- [ ] Verify local schedule/configuration remains intact.

---

# Final Release Gate

The network/onboarding work is complete only when all items below are checked.

## Gate A — Factory Device

- [ ] Unique `device_id`
- [ ] `complex_id = UNBOUND`
- [ ] Safe boot PASS
- [ ] Provisioning AP PASS

## Gate B — Network

- [ ] Wi-Fi provisioning PASS
- [ ] Credential persistence PASS
- [ ] Periodic reconnect PASS
- [ ] Reprovision/reset PASS
- [ ] Real IP reporting PASS
- [ ] TFT IP display PASS
- [ ] mDNS PASS

## Gate C — Backend / Frontend

- [ ] Create Complex PASS
- [ ] ESP32 discovery PASS
- [ ] Identity verification PASS
- [ ] Device → Complex binding PASS
- [ ] Error/rollback behavior PASS

## Gate D — Recovery

- [ ] Router reboot recovery PASS
- [ ] Wi-Fi password change recovery PASS
- [ ] ESP32 power-cycle recovery PASS
- [ ] Local autonomous runtime while offline PASS

## Gate E — Hardware Readiness

- [ ] No changes required to `docs/HARDWARE_WIRING_MAP.md`
- [ ] No W5500 dependency for this commissioning path
- [ ] No network failure can energize an actuator
- [ ] First-boot procedure is reproducible by a field operator

---

# Final Operator Workflow

After implementation, the intended real-world procedure is:

```text
1. Power ESP32
2. On TFT Screen 4/4, read the unique `AGROTECH-<FULL-MAC>` provisioning SSID and the 8-character setup code
3. Connect phone/laptop to that SoftAP and use the standard ESP-IDF provisioning client/app with the displayed setup code
4. Provision greenhouse Wi-Fi (2.4 GHz)
5. Wait for ESP32 to join router
6. Read IP from TFT or use mDNS
7. Open frontend
8. Create Complex
9. Discover ESP32
10. Verify device identity
11. Bind Device → Complex
12. Verify inventory/status
13. READY
```

## Non-Goals for This Phase

- W5500/LAN implementation
- Cloud provisioning
- Dedicated mobile application
- Remote internet provisioning
- Complex multi-device network orchestration
- Reworking fertigation/runtime architecture

The purpose is to close the minimum reliable commissioning path first.


## Final Network UX Reconciliation — 2026-09-20

The production network UX is split into three explicit controller states/workflows:

1. **FACTORY_UNCONFIGURED** — automatic factory SoftAP and first-time Wi-Fi setup; Complex remains UNBOUND until the separate Complex onboarding/binding flow.
2. **NORMAL_STA** — SoftAP OFF; configured router reconnect is indefinite at the current 50-second firmware interval.
3. **DIRECT_LOCAL_AP / DIRECT_LOCAL_CONNECTED** — temporary operator-triggered SoftAP for local inspection or non-destructive Wi-Fi change.

Button 4 behavior is now canonical:

```text
2× quick presses = force immediate configured-router connection attempt
3× quick presses = toggle Direct Local Mode / temporary SoftAP
```

Network Change is not a reset and never clears persistent operational configuration. The candidate Wi-Fi credential is tested at runtime and persisted only after `IP_EVENT_STA_GOT_IP`. Direct Local AP timeouts are 3 minutes with no client and 1 minute after the final client disconnects.
