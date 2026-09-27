# Network Change Mode — Canonical Documentation

## Status and Scope

This document is the canonical specification and implementation record for the controller's **non-destructive network recovery / Wi-Fi change workflow**. It complements `docs/NETWORK_FIRST_BOOT_IMPLEMENTATION_PLAN.md` and must remain synchronized with firmware, API, and UX behavior.

The workflow is intentionally separate from factory reset, operational configuration reset, and physical runtime authority. The purpose is connectivity recovery or router replacement only.

Current source implementation status:

| Capability | Status |
|---|---|
| 2× Button 4 quick-press force router connect | IMPLEMENTED |
| 3× Button 4 quick-press Direct Local toggle | IMPLEMENTED |
| Direct Local AP client tracking | IMPLEMENTED |
| AP timeout: 3 min no client / 1 min after disconnect | IMPLEMENTED |
| No reboot / no reset | IMPLEMENTED |
| Persistent device identity | IMPLEMENTED |
| Existing Complex relationship preserved | IMPLEMENTED |
| Temporary SoftAP | IMPLEMENTED |
| Embedded setup Web UI | IMPLEMENTED |
| Candidate Wi-Fi transaction | IMPLEMENTED |
| Atomic credential persistence after verified IP | IMPLEMENTED |
| Failure recovery to previous credential | IMPLEMENTED |
| Backend identity/Complex continuity | IMPLEMENTED |
| Physical ESP32/router/phone verification | PENDING HARDWARE |

## Operator Purpose

When a configured controller must move to another router Wi-Fi, the operator must not need a factory reset, firmware flashing, USB/serial configuration, or manual re-binding merely because the network changed.

Desired operator mental model:

```text
NORMAL OPERATION
    ↓
3× Button 4 quick presses
    ↓
NETWORK CHANGE MODE
    ↓
Connect phone to temporary ESP32 Wi-Fi
    ↓
Embedded Setup Web UI
    ↓
Choose new Wi-Fi + password
    ↓
Confirm existing Complex
    ↓
CONNECT
    ↓
ESP32 tests new Wi-Fi
    ↓
SUCCESS
    ↓
Atomically save credentials
    ↓
Reconnect backend
    ↓
Same device_id + same Complex
    ↓
ONLINE / NORMAL OPERATION
```

## Absolute No-Reset Rule

Entering, operating, or leaving Network Change Mode must not: 

- reboot the ESP32;
- perform factory reset;
- erase NVS globally;
- erase Complex configuration;
- erase greenhouse (GH) configuration;
- erase recipes;
- erase schedules;
- erase calibration;
- erase crop/research data;
- erase event history or telemetry;
- change persistent `device_id`;
- remove the existing Complex relationship;
- reset hardware configuration;
- stop the scheduler or physical runtime merely because network mode changed.

This is a **network transport state change**, not a system reset.

## Button 4 Gesture

Button 4 is the reserved panel input on GPIO 41. Current implementation uses one non-blocking multi-click detector:

```text
2 quick presses = FORCE ROUTER CONNECT
3 quick presses = TOGGLE DIRECT LOCAL MODE / SOFTAP
```

Firmware constants currently define:

```text
BUTTON4_QUICK_PRESS_MAX_MS     = 800 ms
BUTTON4_PRESS_WINDOW_MS        = 3000 ms
BUTTON4_REQUIRED_PRESSES       = 3
BUTTON4_FORCE_CONNECT_PRESSES   = 2
```

A FreeRTOS one-shot timer resolves a 2-click sequence only after the multi-click window expires, so the gesture detector never blocks the runtime. A long press has no network-reset meaning.

## Network State Transition

For an already configured controller:

```text
NORMAL_STA
    │
    │ 3× Button 4
    ▼
DIRECT_LOCAL_AP
    │
    ├─ SoftAP enabled (APSTA)
    ├─ existing STA credential remains intact
    ├─ embedded /setup enabled
    └─ local runtime continues
         │
         └─ client connects
               ↓
       DIRECT_LOCAL_CONNECTED
```

When the operator submits a new Wi-Fi candidate, the state additionally enters the explicit network-change transaction while keeping the same temporary AP alive:

```text
DIRECT_LOCAL_*
    ↓
NETWORK_CHANGE candidate transaction
    ↓
GOT_IP → atomic credential commit
```

After successful candidate verification and completion:

```text
NETWORK_CHANGE
    ↓
Candidate Wi-Fi gets IP
    ↓
Candidate credential atomically committed
    ↓
Short completion/grace period
    ↓
SoftAP OFF
    ↓
WIFI_MODE_STA
    ↓
NORMAL / CONNECTING / ONLINE
```

## SoftAP Identity

Network Change Mode uses a temporary, controller-specific setup network:

```text
SSID: AGROTECH-SETUP-XXXX
Setup code / PoP: existing persisted random value
```

The controller's persistent identity and setup credential are not regenerated merely because Network Change Mode is entered.

The SoftAP is not intended to remain permanently active during normal operation.

## Direct Local Mode Timeouts

Direct Local Mode is temporary and self-closing:

```text
AP enabled, no client
    ↓
3 minutes
    ↓
SoftAP OFF
```

After a client disconnects:

```text
last client disconnects
    ↓
1 minute without a client
    ↓
SoftAP OFF
```

A connected client cancels the timeout. An active candidate Wi-Fi transaction is not aborted by the AP timeout while the credential test is in progress.

## Button 4 Recovery Shortcuts

```text
2× Button 4
→ force an immediate attempt to the currently configured router

3× Button 4
→ Direct Local Mode AP ON/OFF
```

A two-click action never changes credentials. A three-click action never erases configuration. Both actions are non-blocking and independent of actuator/runtime authority.

## Embedded Setup Web UI

The firmware exposes a deliberately small local UI at `/setup`. It is not a second full AgroTech application.

Endpoints:

```text
GET  /setup
GET  /setup/api/status
GET  /setup/api/scan
POST /setup/api/connect
POST /setup/api/finish
```

The setup page is enabled only while factory provisioning or Network Change Mode is active. Common captive-detection routes redirect to `/setup` while setup mode is active.

The local UI must clearly identify the current controller and current operating mode. In Network Change Mode it shows:

```text
AGROTECH CONTROLLER

CHANGE WI-FI

Controller:
ESP32-A4B2

Current connection:
Connected / Disconnected

New Wi-Fi:
[ Select Network ]

Password:
[ ******** ]

Complex:
Melon Tasikmalaya

[ CONNECT ]
```

Low-level implementation details such as NVS, DHCP internals, mDNS internals, protocol endpoint names, and serial flashing are hidden from normal operators.

## Complex Relationship Rules

Network Change Mode does not perform a new unrestricted binding operation.

For an already configured controller:

- the persisted Complex relationship is read as the authoritative current relationship;
- the operator is not asked to type a `complex_id`;
- a new Complex is not created from the local network UI;
- a Wi-Fi change alone does not require manual re-binding;
- the same relationship remains attached to the same persistent `device_id`.

If the data model later supports multiple authorized Complex relationships per controller, the local UI may present only those already authorized relationships.

## New Wi-Fi Credential Transaction

The old working credential must remain usable until the new credential is proven valid.

Canonical transaction:

```text
NEW SSID + PASSWORD
        ↓
apply candidate to live STA configuration
        ↓
connection attempt
        ↓
IP_EVENT_STA_GOT_IP ?
   ├── NO
   │    ↓
   │  mark candidate failed
   │  keep old persisted credential
   │  restore previous STA configuration when available
   │  keep setup mode available
   │
   └── YES
        ↓
   atomically persist new credential
        ↓
   candidate SUCCESS
        ↓
   complete Network Change Mode
        ↓
   SoftAP OFF
        ↓
   normal STA operation
```

The implementation must never erase the old persistent credential before candidate success. A wrong password must not brick network recovery.

## Runtime Independence

Network Change Mode has no authority over physical operation. Network transitions do not call scheduler shutdown, fertigation stop, actuator reset, safety reset, crop-cycle reset, or Complex binding reset paths.

The following remain independently authoritative and must continue while the network is changing or unavailable:

- local scheduler;
- safety monitoring;
- emergency-stop monitoring;
- actuator interlocks and local actuator authority;
- fertigation runtime;
- sensor sampling;
- local event logging;
- telemetry/offline spool/recovery mechanisms.

Network connectivity is an observability/communication concern, not physical execution authority.

## Backend Continuity

After the new router connection succeeds, the controller must reconnect using the same persistent identities:

```text
device_id = unchanged
complex_id = unchanged
```

Backend/frontend behavior:

1. ESP32 reconnects to the configured backend/network path.
2. Backend identifies the controller by persistent `device_id`.
3. Existing Complex relationship is verified.
4. Current device status is verified.
5. Frontend reflects the controller as ONLINE when the verified state is healthy.
6. No new Complex creation is required.
7. No manual re-binding is required merely because Wi-Fi credentials changed.

## Operator Completion UX

After successful reconnection, the setup UI should present a clear completion state:

```text
CONNECTED ✓

Wi-Fi:
Greenhouse-New

IP:
192.168.1.123

Controller:
ESP32-A4B2

Complex:
Melon Tasikmalaya

AgroTech:
ONLINE
```

Then the temporary SoftAP is disabled and the controller returns to normal STA operation.

## Failure UX

When the candidate Wi-Fi fails:

```text
CONNECTION FAILED

Periksa nama Wi-Fi atau kata sandi.
Credential Wi-Fi sebelumnya tetap aman.

[ COBA LAGI ]
```

The UI must never imply that the controller was reset, unbound, or reconfigured globally.

Technical diagnostic information can remain behind an explicit details/diagnostic affordance.

## Factory vs Network Change

These are intentionally different workflows.

### Factory Onboarding

```text
Factory / UNBOUND controller
→ SoftAP provisioning
→ Configure router Wi-Fi
→ backend onboarding
→ Create/select Complex
→ Discover/verify device
→ Bind device to Complex
→ READY
```

### Network Change

```text
Existing configured controller
→ 3× Button 4
→ temporary SoftAP
→ local Change Wi-Fi UI
→ select new Wi-Fi
→ enter password
→ confirm existing Complex
→ test candidate
→ atomic commit
→ reconnect
→ same device_id
→ same Complex
→ ONLINE
```

The second workflow must never regress into the factory onboarding path merely because the router changed.

## Direct Local Access

Direct Local Mode is now an implemented temporary local access path for configured controllers. It uses the same embedded setup UI for network recovery and inspection of that specific controller. It is not a second full AgroTech application and it never provides a physical actuator-control surface.

When connected locally, the UI identifies the controller as: `LOCAL DIRECT MODE — controller ini saja`. Other controllers are not contacted through the temporary AP and are not treated as deleted; they remain governed by their own local runtime and may be shown by the normal fleet UI as offline when the normal router path is unavailable.

The local UI can:
- show controller/network/Complex state;
- scan nearby Wi-Fi networks;
- submit a candidate Wi-Fi credential;
- show candidate success/failure;
- exit Direct Local Mode.

The local UI cannot execute commands, deploy fertigation, modify GH configuration, alter recipes, change schedules, or unbind the controller.

## Current Verification Boundary

### Structural / software

Current Network Change + Direct Local source gate: **34/34 PASS**.

The source-level checks cover the 2-click router shortcut, 3-click Direct Local toggle, AP timeout/client handling, APSTA operation, embedded setup API, no reboot path, candidate transaction, credential persistence boundary, and runtime isolation.

### Physical / live hardware

The following remain unverified until real hardware is available:

- Button 4 electrical behavior and human timing;
- ESP32-S3 SoftAP broadcast and phone association;
- embedded setup UI on a real phone;
- Wi-Fi scan behavior;
- candidate success/failure with real routers;
- restoration of the old Wi-Fi after a failed candidate;
- NVS persistence across power interruption;
- simultaneous scheduler/safety/fertigation operation during network change;
- DHCP/mDNS/backend reconnection on the new router;
- actual no-reboot behavior on target ESP32-S3 hardware.

Physical validation must be reported separately from structural software PASS.

## Change-Safety Rules

Any future modification to this feature must preserve all of the following:

```text
network change != factory reset
network change != Complex unbind
network change != runtime shutdown
network change != identity regeneration
network change != data deletion
```

The hardware wiring SSOT `docs/HARDWARE_WIRING_MAP.md` must not be changed solely to implement network recovery.
