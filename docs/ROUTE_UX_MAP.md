# CANONICAL ROUTE & UX NAVIGATION MAP

**Authority:** `docs/`  
**Governing Rule:** `GEMINI.md` (Documentation Governance & Canonical Documentation Policy)  
**Associated Spec:** `docs/SYSTEM_TOPOLOGY_POOL_SPEC.md`, `docs/COMPLEX_DELETION_ARCHITECTURE.md`

---

## 1. Routing Architecture

The AgroTech Web Application employs client-side **Hash Routing** (`HashRouter` via `react-router-dom`) to guarantee deterministic direct navigation across standalone browser instances, ESP32 local captive portals, and embedded desktop webviews without requiring server-side URL rewrite proxies.

All URLs conform to the scheme:
```text
http://<host>:<port>/#/<route-path>[?<query-string>]
```

---

## 2. Canonical Route Inventory

| Route Path | Associated Component | Primary Responsibility | Param Semantics | Fallback / Error Handling |
|---|---|---|---|---|
| `#/` or `#/complex` | `src/app/complex/page.tsx` | Multi-complex ecosystem overview, complex cards, greenhouse grids (Default landing route) | `?complex=<complexId>` (optional) | Displays all active complexes; empty state tile ("No Complex configured") when 0 complexes exist. |
| `#/dashboard` | `src/app/dashboard/page.tsx` | Global system status, weather, environmental telemetry overview | `?complex=<complexId>` (optional) | Defaults to the first active complex in topology; if 0 complexes exist, renders "Setup Required" view. |
| `#/onboarding/complex` | `src/app/onboarding-complex.tsx` | Complex creation & ESP32 controller binding wizard | `?complex=<complexId>` (optional for edit/bind) | Step 0: name/location input; Step 1: ESP32 discovery; Step 2: identity verification; Step 3: binding; Step 4: inventory discovery & baseline provisioning. |
| `#/greenhouse/:ghId` | `src/app/greenhouse/[ghId]/page.tsx` | Dedicated greenhouse telemetry, hero status, camera feeds, actuators | `:ghId` (mandatory route param)<br>`?complex=<complexId>` (optional query) | **Auto-Inference:** Infers `complexId` from `greenhouse.complexId`.<br>**Deleted / Invalid ID:** Renders dedicated "Greenhouse Not Found" card with recovery actions (never crashes). |
| `#/schedule` | `src/app/schedule/page.tsx` | Fertigation, lighting, and fan scheduling timeline | `?complex=<complexId>` (optional) | Timeline groups lanes across active greenhouses. |
| `#/fertigation` | `src/app/fertigation/page.tsx` | Nutrients, recipe execution, valve states | `?complex=<complexId>` (optional) | Fallback to active complex. |
| `#/calibration` | `src/app/calibration/page.tsx` | Sensor & dosing pump calibration repository | `?complex=<complexId>` (optional) | Fallback to active complex. |
| `#/research` | `src/app/research/page.tsx` | Crop cycle history, plant development, observations | `?complex=<complexId>` (optional) | Strictly quarantined from operational deletions. |
| `#/equipment` | `src/app/equipment/page.tsx` | Pin Map-driven Supported Equipment checklist & hardware registry | `?complex=<complexId>` (optional) | Interactive pin map checklist allowing 1-click checkbox activation of actuators, relays, and sensors without re-flashing. |
| `#/events` | `src/app/events/page.tsx` | System alerts, security interlock trips, audit logs | `?complex=<complexId>` (optional) | Historical event timeline. |

---

## 3. Parameter Semantics & Route Resolution

### 3.1 Greenhouse Route (`#/greenhouse/:ghId`)
- **Direct Navigation:** Navigating to `#/greenhouse/gh-01` without `?complex=` automatically resolves the parent complex via `greenhouseService.get(ghId)?.complexId`.
- **Query Parameter Override:** If provided (`?complex=complex-01`), the UI verifies that `greenhouse.complexId === complexId`.
- **Deleted Entity Handling:** If `ghId` was deleted or does not exist in the active `SystemTopologyPool`, the route displays the **Greenhouse Not Found** card:
  - Header: Warning icon + "Greenhouse Not Found"
  - Subtitle: Clear explanation indicating the entity has been deleted or is invalid
  - Action 1: "Back to Complex Overview" (`#/complex`)
  - Action 2: "Go to Dashboard" (`#/dashboard`)
  - **Zero blank screen guarantee:** React never crashes on deleted routes.

### 3.2 Complex Overview Route (`#/complex`)
- **Active Topology Display:** Iterates over all active complexes in `SystemTopologyPool`.
- **Greenhouse Cards:** Each greenhouse is rendered using `GreenhouseOverviewCard` showing real-time status, sensor highlights, and direct edit/delete controls.
- **Empty State:** When 0 complexes exist, displays a dashed-border setup card prompting the user to create a complex.

---

## 4. Navigation & State Persistence Protocol

### 4.1 Zero Browser Persistence Architecture
In compliance with the AgroTech Single Source of Truth architecture:
- Browser `localStorage`, `sessionStorage`, and `cookies` are strictly ephemeral caches.
- **Wiping Browser State:** Clearing all browser storage and reloading (`page.reload()`) triggers fresh discovery via `hydrateOperationalState()`:
  1. Direct ESP32 seed probing at `/api/v1/topology-pool`.
  2. Backend topology mirror fallback at `/api/v1/topology-pool`.
  3. Reconciles peer pools, validates contracts, and enforces tombstones.
  4. Ephemeral domain objects (`Complex`, `Greenhouse`) are reconstructed purely in memory.

### 4.2 Browser Refresh, Back & Forward Handling
- **Browser Refresh:** Retains current route URL. In-memory state re-hydrates within ~1.5 seconds from authoritative discovery.
- **Browser Back / Forward:** Hash router triggers hashchange events; state versioning re-renders the appropriate view immediately without stale closures.

---

## 5. Deletion & Tombstone Enforcement

When an entity is deleted:
1. Operational store removes the record from active tables.
2. `SystemTopologyPool` records an authoritative tombstone:
   ```json
   {
     "entityType": "GREENHOUSE",
     "entityId": "gh-03",
     "deletedAt": "2026-09-21T05:13:50Z",
     "deletionChangeId": "chg-...",
     "recordRevision": 2
   }
   ```
3. UI immediately purges the entity from memory and updates navigational links.
4. Any attempt to navigate back to the deleted URL triggers the safe "Greenhouse Not Found" presentation.
