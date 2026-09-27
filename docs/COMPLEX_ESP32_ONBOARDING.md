# Complex + ESP32 Onboarding

## Purpose

The onboarding flow registers a permanent Complex, discovers a reachable ESP32 controller using the canonical browser-safe connection rules, verifies device identity, binds exactly one controller to the Complex, discovers inventory/capabilities, and reports the onboarding state as **Complex Ready**. Factory Wi-Fi setup and later Network Change/Direct Local access are separate workflows and do not imply new Complex creation.

## Flow

```text
Create / select Complex
        ↓
Discover / probe ESP32
        ↓
Verify deviceId + complexId + API/schema identity
        ↓
Bind ESP32 → Complex
        ↓
Read inventory + capabilities
        ↓
Complex Ready
```

## Discovery contract

A factory controller first exposes an ESP-IDF SoftAP named `AGROTECH-<full-MAC>`. The TFT shows the unique 8-character setup code used as the SoftAP password and proof-of-possession (PoP). The operator can provision greenhouse/router Wi-Fi through the implemented minimal embedded Setup Web UI on the controller-local AP (`/setup`); the Python backend is not required for first credential entry. Provisioning is performed exclusively through the embedded web UI (`/setup/api/connect`), without relying on external mobile provisioning apps (`wifi_prov_mgr`). The embedded UI is intentionally not a second full AgroTech application.

After the controller joins the router, the practical discovery paths are:

1. Read the real STA IP from the controller TFT.
2. Use the stable mDNS hostname `esp32-<device-id>.local`.
3. Enter the last-known IP or hostname manually.

The browser intentionally does not rely on universal mDNS service enumeration; a `.local` hostname is resolved by the operating system/browser stack when the local network supports it. Every candidate endpoint is verified with the real `/api/v1/health` and `/api/v1/status` responses before binding.

## Binding

Binding is a two-authority handshake:

1. Python validates that the selected Complex exists and that the supplied endpoint is reachable.
2. Python verifies the endpoint's real device identity/API/schema.
3. Python sends an authenticated envelope to `POST /api/v1/device/bind`.
4. ESP32 persists the Complex ID in NVS and refuses replacement of a different existing binding.
5. Python reads `/api/v1/status` again and only then persists the backend-side controller record.

A controller already bound to another Complex is rejected; a browser-provided `deviceId` is never trusted without endpoint verification.

Binding does **not**:

- commission physical hardware;
- deploy an active hardware configuration;
- automatically convert inventory into active configuration;
- mark components as commissioned.

## Inventory

Inventory is read directly from the controller after binding. The UI also reads capabilities. An empty inventory is allowed to represent a controller with no physical components installed yet; the onboarding state can still be **Complex Ready** while physical commissioning remains pending.

## Readiness

`Complex Ready` requires:

- Complex record exists;
- controller health + status handshake succeeded;
- `deviceId`, `apiVersion=v1`, and `schemaVersion=1` are verified;
- the controller does not report a conflicting Complex;
## Backend Service Coordination & Topology Pool Registration

Step 1 creates the permanent Complex record in the master operational store via `POST /api/complexes` and registers it in the `SystemTopologyPool`. Step 4 persists controller binding via `POST /api/complexes/{id}/controller/bind` and assigns `ownerDeviceId`.
- The ESP32 updates its persistent SPIFFS `topology_pool.json`, recording `ownerDeviceId` and advancing `poolRevision`.
- The backend registers the device in the replicated `SystemTopologyPool` with `deviceState: "BOUND"` and `ownerComplexIds: [complexId]`.
- The Vite dev server proxies `/api` requests to the Python operational backend on `http://127.0.0.1:8090`.
- The Vite configuration includes an auto-runner plugin (`pythonBackendPlugin`) to automatically spawn `python -m backend.server` on port 8090 during `npm run dev` if not already running.
- In the event of backend unreachability, the client returns structured error messages rather than raw HTML proxy errors, and onboarding surfaces a visual toast alert alongside form error banners.
- When client storage is cleared, the browser dynamically reconstructs the bound Complex and its Greenhouses from the controller's replicated System Topology Pool.

The physical commissioning gate remains separate.


## Factory first boot

If no usable STA credentials exist, the controller automatically starts its unique factory SoftAP and local setup path. The operator configures the router Wi-Fi first; only then does the normal Complex onboarding flow begin. Factory Wi-Fi configuration leaves the controller **UNBOUND** until the separate Complex → ESP32 binding flow completes.

## Existing Controller — Network Change Mode / Direct Local

After first-time setup, a configured controller behaves differently from a factory controller. In Network Change Mode, operator-initiated configuration changes do not reset device credentials or Complex bindings:

```text
NORMAL_STA
    ↓
3× Button 4
    ↓
DIRECT_LOCAL_AP
    ↓
Connect phone/laptop
    ↓
Embedded local setup UI
    ├─ inspect current controller/network state
    └─ change router Wi-Fi without reset
```

Button 4 also supports:

```text
2× = force an immediate connection attempt to the currently configured router
3× = toggle Direct Local Mode / temporary SoftAP
```

The provisioning/setup HTTP endpoints reuse the normal ESP32 HTTP server, so there is no second physical-control execution path.

## Device Retirement & Complex Deletion

When a Complex is deleted via the web UI, the system executes an atomic hardware retirement saga:
1. **Retirement Request (`POST /api/v1/device/retire`)**: The backend deletion manager invokes the authenticated retirement endpoint on the bound ESP32.
2. **Firmware Teardown**:
   - Clears compiled schedules (`scheduler_clear_compiled()`).
   - Aborts active fertigation/dosing cycles (`fertigation_mgr_cancel_batch()`).
   - Emergency-stops all actuators and relays to safe OFF (`actuator_hal_emergency_stop()`).
   - Atomically erases LVC, candidate, previous configuration, and clears `cplx_id` to UNBOUND (`storage_mgr_retire_complex()`).
   - **Station (STA) Wi-Fi credentials remain preserved**.
3. **Re-binding Readiness**: The retired controller remains connected to local Wi-Fi and returns to UNBOUND status (`complexId = null`), ready to be adopted by a new or different Complex without manual flashing or SoftAP reconfiguration.
4. **Direct Onboarding Unbind**: If an operator creates a new Complex while a controller is still bound to a prior Complex, Step 3 (Identity Verification) detects the mismatch and provides a direct `Force Unbind & Retire Controller` action to call `POST /api/v1/device/retire` safely.
5. **Firmware Build & Flash Automation**: The repository provides automated ESP-IDF v5.5 scripts `scripts/build_esp32.ps1` and `scripts/flash_esp32.ps1` that configure the toolchain environment and flash updated binaries to physical hardware without wiping NVS Wi-Fi credentials.
6. **Full Architecture Reference**: See [`docs/COMPLEX_DELETION_ARCHITECTURE.md`](file:///c:/Users/rumah/Downloads/UI-template-chatgpt-network-onboarding-final/docs/COMPLEX_DELETION_ARCHITECTURE.md).

