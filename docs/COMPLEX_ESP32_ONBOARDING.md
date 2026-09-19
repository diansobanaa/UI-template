# Complex + ESP32 Onboarding

## Purpose

The onboarding flow registers a permanent Complex, discovers a reachable ESP32 controller using the canonical browser-safe connection rules, verifies device identity, binds exactly one controller to the Complex, discovers the controller inventory, and reports the onboarding state as **Complex Ready**.

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

The browser does not assume universal mDNS enumeration. It accepts a stable hostname such as `esp32-<device-id>.local`, a last-known endpoint, or a manually entered local IP/hostname, and verifies the real `/api/v1/health` response.

## Binding

Binding is persisted through the Python-owned Complex record. The bind operation rejects a controller already bound to another Complex. A controller reporting a different non-empty `complexId` is blocked before binding.

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
- controller health handshake succeeded;
- `deviceId`, `apiVersion`, and `schemaVersion` are present;
- the controller does not report a conflicting Complex;
## Backend Service Coordination

Step 1 creates the permanent Complex record in the master operational store via `POST /api/complexes`, while Step 4 persists controller binding via `POST /api/complexes/{id}/controller/bind`.
- The Vite dev server proxies `/api` requests to the Python operational backend on `http://127.0.0.1:8090`.
- The Vite configuration includes an auto-runner plugin (`pythonBackendPlugin`) to automatically spawn `python -m backend.server` on port 8090 during `npm run dev` if not already running.
- In the event of backend unreachability, the client returns structured error messages rather than raw HTML proxy errors, and onboarding surfaces a visual toast alert alongside form error banners.

The physical commissioning gate remains separate.
