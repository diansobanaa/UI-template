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

## Authority / Constraints

- `docs/HARDWARE_WIRING_MAP.md` is the physical pin SSOT. Do not modify it as part of this plan.
- API contracts must remain synchronized with `contracts/UI_ESP32_OPENAPI.yaml`.
- Firmware remains the local physical/safety authority.
- Backend remains the configuration/orchestration authority.
- Frontend remains the operator/research UI.
- Factory device must not be pre-bound to an arbitrary Complex.
- Candidate configuration must not become operational until explicitly activated.
- Do not create a second automatic physical execution path.

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

- [ ] Remove factory default `complex_id = "complex-01"`.
- [ ] Preserve stable unique `device_id` generation/initialization.
- [ ] Persist device identity safely in NVS.
- [ ] Represent unbound state explicitly.
- [ ] Verify API health/status exposes the correct unbound state.
- [ ] Verify reboot preserves `device_id` and unbound state.
- [ ] Verify binding logic accepts a previously unbound device.
- [ ] Verify an existing bound device is not silently unbound on reboot.

### Acceptance Criteria

- [ ] Factory boot produces a valid device identity.
- [ ] Factory boot produces `complex_id = EMPTY/UNBOUND`.
- [ ] No frontend conflict is triggered solely because the device is new.
- [ ] No existing Complex is implicitly selected.

---

## PR-2 — Wi-Fi Provisioning

### Goal

Allow an operator to configure greenhouse Wi-Fi without USB/NVS flashing.

### Recommended implementation

Use the ESP-IDF network provisioning mechanism over SoftAP rather than inventing a custom provisioning protocol.

### Required flow

```text
ESP32 factory mode
    ↓
SoftAP provisioning mode
    ↓
Phone/laptop connects
    ↓
Wi-Fi provisioning
    ↓
Save STA credentials to NVS
    ↓
ESP32 joins router
```

### Checklist

- [ ] Confirm provisioning mode starts automatically for an unconfigured device.
- [ ] Keep SoftAP available during initial provisioning.
- [ ] Make SoftAP SSID unique per physical controller.
- [ ] Generate SSID from stable device/MAC suffix.
- [ ] Provision 2.4 GHz Wi-Fi credentials.
- [ ] Validate SSID/password input before writing NVS.
- [ ] Write `sta_ssid` to NVS namespace `agrotech`.
- [ ] Write `sta_pass` to NVS namespace `agrotech`.
- [ ] Persist credentials atomically.
- [ ] Reboot/reconnect cleanly after successful provisioning.
- [ ] Do not require Python backend for the first Wi-Fi credential entry.

### Acceptance Criteria

- [ ] Factory ESP32 exposes a provisioning network.
- [ ] Phone/laptop can connect.
- [ ] Operator can enter router credentials.
- [ ] Credentials survive reboot.
- [ ] ESP32 joins the selected router without USB intervention.
- [ ] A provisioning failure does not activate actuators.

---

## PR-3 — Recovery / Reprovisioning

### Goal

Prevent a device from becoming permanently inaccessible after router/password changes.

### Required behavior

```text
Wi-Fi disconnected
    ↓
Periodic reconnect attempts
    ↓
Continue indefinitely
```

Local reprovisioning:

```text
Long-press provisioning/reset input
    ↓
Clear only network credentials
    ↓
Enter provisioning mode
```

### Checklist

- [ ] Replace permanent 5-attempt abandonment with periodic reconnect.
- [ ] Use bounded retry interval (target 30–60 s).
- [ ] Keep local runtime independent from network state.
- [ ] Preserve schedules/configuration during network loss.
- [ ] Add a deterministic local network-reset/provisioning trigger.
- [ ] Prevent accidental activation of the reset trigger.
- [ ] Clear network credentials without deleting unrelated configuration.
- [ ] Return to provisioning mode after network reset.
- [ ] Verify normal operation resumes after successful reprovisioning.

### Acceptance Criteria

- [ ] Router reboot longer than the current retry window does not permanently strand the ESP32.
- [ ] Changing the greenhouse Wi-Fi password can be recovered without firmware flashing.
- [ ] Local safety/scheduler behavior continues while offline.
- [ ] Network reset does not wipe Complex/GH/recipe configuration.

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

- [ ] Read the real STA IP from `esp_netif`.
- [ ] Display real IP on TFT network screen.
- [ ] Display connected/disconnected state accurately.
- [ ] Initialize mDNS only after the network identity is available.
- [ ] Use stable hostname based on `device_id`.
- [ ] Verify `<hostname>.local` resolves on a local network.
- [ ] Keep manual IP entry available in frontend.
- [ ] Do not depend exclusively on mDNS.

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

- [ ] Remove hardcoded `127.0.0.1` IP response.
- [ ] Remove hardcoded zero MAC response.
- [ ] Read real MAC from Wi-Fi/ESP hardware API.
- [ ] Read real IP from active netif.
- [ ] Distinguish AP, STA, disconnected, and offline states.
- [ ] Keep API schema synchronized with OpenAPI.
- [ ] Add/adjust tests for factory, provisioned, disconnected, and recovered states.
- [ ] Confirm read endpoints cannot mutate physical state.

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
2. Connect phone/laptop to AGROTECH-SETUP-XXXX
3. Provision greenhouse Wi-Fi
4. Wait for ESP32 to join router
5. Read IP from TFT or use mDNS
6. Open frontend
7. Create Complex
8. Discover ESP32
9. Verify device identity
10. Bind Device → Complex
11. Verify inventory/status
12. READY
```

## Non-Goals for This Phase

- W5500/LAN implementation
- Cloud provisioning
- Dedicated mobile application
- Remote internet provisioning
- Complex multi-device network orchestration
- Reworking fertigation/runtime architecture

The purpose is to close the minimum reliable commissioning path first.
