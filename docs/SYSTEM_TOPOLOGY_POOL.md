SYSTEM TOPOLOGY POOL & ESP32-AUTHORITATIVE DISCOVERY

Canonical Architecture & Operational Specification
Document: docs/SYSTEM_TOPOLOGY_POOL.md
Status: Approved & Implemented Canonical Standard — Revised by Latest Architecture Rules
Authority: ESP32 Firmware is the operational authority; TypeScript Client is the direct operational client; Python Backend is optional coordination/history/mirror/research support and MUST NOT proxy Web UI traffic to ESP32.

1. Executive Summary & Source of Truth Model

The AgroTech greenhouse automation and research platform operates a distributed, multi-controller topology across one or more greenhouse complexes.

Core Architectural Hierarchy

                       SYSTEM
                         │
               DISTRIBUTED TOPOLOGY
                         │
                ┌────────────────┐
                │ TOPOLOGY POOL  │
                │                │
                │ Devices        │
                │ Complexes      │
                │ GHs            │
                │ Owners         │
                │ Revisions      │
                │ Hashes         │
                │ Tombstones     │
                │ IP locators    │
                └───────┬────────┘
                        │
              replicated to ESP32s
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
    ESP32-A          ESP32-B          ESP32-C
       │                │                │
    owns C-A         owns C-B         owns C-C
       │                │                │
     runtime          runtime          runtime
       ▲                ▲                ▲
       │                │                │
       └──────── Direct HTTP REST ──────┘
                        ▲
                        │
                     Web UI
              ephemeral operational view
                        │
                        │ optional, separate
                        ▼
                  Python Backend
          history / research / mirror / coordination

          Python MUST NOT proxy Web UI → ESP32

Fundamental Authority Rules

ESP32 = Authoritative Operational Source for Complexes it owns:
Each Complex has exactly one single-writer ownerDeviceId. The controller that owns a Complex is the runtime and physical authority for that Complex and its assigned Greenhouses. Non-owner controllers hold replicated awareness of the Complex but cannot directly mutate it.

Topology Pool = Replicated System Topology Registry:
Persisted atomically on every ESP32 and mirrored in the Python backend. Contains compact global identity records, complex ownership, device lifecycle states, monotonic revision, deterministic content hash, and tombstones.

Backend = Coordination / History / Mirror / Research:
Responsible for long-term historical telemetry, events, calibration data, fertigation runs, immutable research trials (crop_cycles, plants, fruits, observations), deletion saga orchestration, and peer synchronization assistance.

Browser = Ephemeral Operational View; Locator Cache Only:
The browser must not persist authoritative Complex/Greenhouse topology or operational configuration. Cookies, localStorage, sessionStorage, and IndexedDB may store only ESP32 network locator hints (IP address(es)) used to bootstrap discovery. No Complex, GH, owner, schedule, configuration, topology pool, telemetry, research, or other operational state may be treated as browser-persisted truth. Every startup/reload must reconstruct operational topology from reachable ESP32 controllers.

2. Stable Identity & Ownership Model

Stable Identifiers

Names and labels are volatile metadata; identity is immutable:

deviceId: Stable identifier derived from factory MAC address (e.g. ESP32-3485188E6FD0).

complexId: Stable identifier for a complex (e.g. complex-01).

ghId: Stable identifier for a greenhouse (e.g. gh-01).

changeId: Stable idempotency UUID/token for mutations (e.g. chg-uuid).

Display names (name, code, hostname) are mutable metadata and must never be used as primary identifiers.

Single-Writer Ownership Rules

Exactly one ownerDeviceId per Complex.

A Greenhouse (ghId) belongs to exactly one Complex (complexId). Assignment to multiple complexes is rejected with TOPOLOGY_CONFLICT.

Mutations (UPDATE_COMPLEX, DELETE_COMPLEX, CREATE_GREENHOUSE, DELETE_GREENHOUSE) are validated against ownerDeviceId. Requests from non-owners are rejected with TOPOLOGY_OWNER_CONFLICT.

2.1 Browser Bootstrap Address & Locator Rules (Latest Rule)

The browser is allowed to persist only ESP32 IP address locators so that a fresh UI instance can find at least one controller. This is a discovery aid, not an operational authority.

Persistent browser state allowed

One or more previously successful ESP32 IP addresses, stored in browser local state such as localStorage or a cookie.

The stored value must contain IP address data only. Do not persist topology, Complex/GH records, schedules, configuration, credentials, or other operational state as part of this mechanism.

A stale IP may be retained as a retry hint; it must never be interpreted as proof that the controller is currently reachable.

First-use browser with no stored IP

When the browser has no bootstrap IP, the UI must provide a minimal controller connection flow:

New Browser
   ↓
No bootstrap IP
   ↓
Ask operator for ONE ESP32 IP address
   ↓
GET /api/v1/health
   ↓
GET /api/v1/topology-pool
   ↓
Validate contract + pool hash
   ↓
Discover all known ESP32 controllers from pool.devices[]
   ↓
Probe each controller directly
   ↓
Build in-memory topology
   ↓
Persist successful controller IP(s) as locator hints

A single successfully reached controller is sufficient to bootstrap the system provided its topology pool contains the known global controller registry and network locators required for probing. The UI must not scan the entire subnet as a substitute for this registry.

Subsequent browser startup

Stored IP locator hints
        ↓
Probe cached IP(s)
        ↓
First reachable ESP32
        ↓
GET /api/v1/topology-pool
        ↓
Read all known controller IP locators
        ↓
Directly probe controllers
        ↓
Reconstruct topology in memory

If all stored IPs are unreachable, the UI must ask the operator for another ESP32 IP instead of silently falling back to browser-persisted topology.

Network locator semantics

deviceId remains the immutable controller identity.

ipAddress / lastKnownIp is only a network locator.

DHCP address changes do not change deviceId.

If a controller's known IP is stale, the controller remains KNOWN/BOUND as appropriate but is marked unreachable until a successful probe provides a new locator.

DHCP Reservation is the preferred field deployment practice for stable predictable ESP32 addresses, but the firmware must not hardcode a specific private IP.

No hardcoded ESP32 IP addresses

No concrete ESP32 IP address (for example 192.168.0.116 or 192.168.0.139) may be hardcoded into source code, committed default configuration, frontend fallback constants, firmware defaults, or operational discovery logic.

Development/runtime environments may inject a deployment-specific IP through an explicit runtime configuration or operator input, but the repository must not contain a concrete ESP32 IP as a default/fallback address. Use placeholders such as <ESP32_IP> in documentation.

mDNS relationship

mDNS may remain implemented as an optional network capability, but it is not a required bootstrap mechanism for the Web UI. The primary operational bootstrap path is direct HTTP to an ESP32 IP locator.

3. Canonical Pool Contract & Versioning

The topology pool adheres to the canonical contract:

schemaId: "agrotech.system-topology-pool"

schemaVersion: 1

contractHash: "sha256:37f9b7353170d9bc2c1cb8504eb7234209761841a2f654fe6cd975f0ffd2c6e8"

poolRevision: Monotonically increasing 64-bit integer tracking topology changes.

poolHash: SHA-256 digest of canonicalized pool payload.

Contract Isolation

These version fields are strictly independent from:

localConfigVersion (LVC configuration version)

topologyVersion (operational resource capability graph)

4. Deterministic Hashing Specification

To ensure cross-language consensus (C on ESP32, Python backend, TypeScript frontend), equivalent topology content produces the exact same poolHash.

Hashing Rules

Volatile field exclusion: Dynamic probe timestamps, live reachability status, and network locator fields such as ipAddress / lastKnownIp are excluded from the hash payload. Network locators are discovery metadata, not topology identity.

Canonical sorting:

Devices sorted lexicographically by deviceId.

Complexes sorted lexicographically by complexId.

Greenhouses sorted lexicographically by ghId.

Tombstones sorted lexicographically by entityType, then entityId.

Array fields (e.g. greenhouses, ownerComplexIds) sorted lexicographically.

Format: Compact UTF-8 JSON with sorted keys and no extraneous whitespace (separators=(',', ':')).

Digest: sha256:<64-char-lowercase-hex>.

5. Device Registry & Lifecycle States

The pool maintains a compact replicated device registry with distinct lifecycle concepts:

KNOWN: Controller has been registered in the system registry.

BOUND: Controller is currently bound to and owns one or more Complexes.

RETIRED: Controller has undergone safe decommissioning and is unbound.

ipAddress / lastKnownIp: Last successfully observed network locator for direct HTTP connection. This is mutable and excluded from poolHash.

Live Reachability (reachable: true/false): Transient network session state observed during active probing; failure to reach a device does not delete it from the pool.

6. Tombstones & Resurrection Prevention

When an entity (Complex or Greenhouse) is deleted:

Owner executes safe-stop and local operational state purge.

A tombstone record is recorded in the pool:

{
  "entityType": "COMPLEX",
  "entityId": "complex-01",
  "deletedAt": "2026-09-21T03:00:00Z",
  "deletionChangeId": "del-job-uuid",
  "recordRevision": 100
}

When synchronizing with stale peers that still carry the deleted entity as ACTIVE, the tombstone supersedes the entity. The entity is purged from the stale peer, preventing resurrection.

7. REST Endpoints & Handlers

The following canonical endpoints are exposed on the ESP32 authority and may be mirrored by Python for backend purposes. The Web UI operational path uses the ESP32 endpoints directly; Python is never an HTTP proxy between the Web UI and ESP32:

Endpoint

Method

Purpose

Authority

/api/v1/topology-pool

GET

Retrieve full active replicated topology pool

Authoritative ESP32 / Mirror

/api/v1/topology-pool/meta

GET

Retrieve lightweight metadata envelope (schema, revision, hash)

Authoritative ESP32 / Mirror

Endpoint Security & Authorization Guards

POST /api/v1/topology-pool/sync: Requires HTTP Authorization header (Bearer <token>) validated via http_check_auth(). Reconciles peer pool with monotonic revision, contract schema check, and tombstone precedence.

POST /api/v1/topology-pool/mutate: Requires HTTP Authorization header (Bearer <token>). Validates originDeviceId against ownerDeviceId for the target Complex. Rejects unauthorized mutations with TOPOLOGY_OWNER_CONFLICT (HTTP 409).

Transport Bearer authentication prevents unauthorized peers from injecting forged payloads or tampering with pool revisions.

8. Frontend Ephemeral Boot, Discovery & Probing Flow

Browser Startup / Page Reload
        ↓
Clear in-memory operational snapshot
        ↓
Load only stored ESP32 IP locator hints (if any)
        ↓
[Have cached IP?]
   ├── YES → Probe cached IP(s) directly
   └── NO  → Ask operator for ONE ESP32 IP address
        ↓
[Bootstrap ESP32 reachable?]
   ├── NO  → Ask for another IP / retry
   └── YES → GET /api/v1/topology-pool directly from ESP32
        ↓
Validate contract (schemaId, schemaVersion, contractHash)
        ↓
Verify content hash (poolHash recomputation)
        ↓
Persist only the successfully used ESP32 IP as a browser locator hint
        ↓
Multi-ESP32 Enumeration & Direct Probing:
  - Browser extracts all known controllers from pool.devices[]
  - Each controller record provides a usable `ipAddress` / `lastKnownIp` when known
  - Browser probes each controller endpoint individually
  - Builds reachability map:
      * Reachable controllers: status = "LIVE"
      * Unreachable controllers: status = "OFFLINE" (remain known, never purged)
      * Reconcile peer replica if a reachable peer has a newer/divergent pool
        ↓
Reconstruct ephemeral Complex & Greenhouse domain snapshots into React state
        ↓
Render UI Dashboards

Operational Discovery Authority Rule

For the direct operational Web UI, a reachable ESP32 is the source of truth. The Python backend mirror is not a bootstrap fallback for operational topology and must not be used to make a missing live ESP32 topology appear authoritative. Python may continue to serve research/history/analytics and maintain a mirror for synchronization and audit.

If all known ESP32 IPs are unreachable, the UI must show a controller-unavailable state and allow entry of another ESP32 IP. It must not reconstruct authoritative topology from persisted browser topology data.

Bootstrap-to-global-discovery invariant

A browser that knows only one valid ESP32 IP must be able to obtain the global controller registry and all currently registered Complex/GH topology from that ESP32's topology pool. From that single bootstrap result, the browser can discover/probe every controller whose network locator is present in the pool.

If an owner ESP32 is offline:

The Complex remains known and visible in the UI.

Its status is rendered with offline: true, operationalStatus: "OFFLINE", and systemStatus: "WARNING".

The Complex is never deleted due to temporary network loss.

9. Firmware Storage & Interrupted Persistence Guarantees

In ESP32 firmware (esp32/main/services/topology_pool.c):

Persistent storage utilizes SPIFFS file /spiffs/topology_pool.json.

Atomic candidate file swap pattern:

Write candidate payload to /spiffs/topology_pool.cand.json.

Read back and parse JSON candidate.

Validate schema, calculate hash, and verify integrity.

Copy active file to /spiffs/topology_pool.bak.json.

Rename candidate to active file.

If power loss or write failure occurs during persistence, firmware reloads the last valid pool or backup file without corruption.

10. Research Data Retention Invariant

Complex deletion and topology mutations never cascade into research records.
Under all conditions:

crop_cycles

plants

fruits

observations

remain 100% untouched and preserved in ResearchStore for longitudinal trial audits.

11. Active Crop Cycle Hydration & Refresh Invariant

When reconstructing the operational snapshot from the topology pool and supplementary context:

reconstructOperationalSnapshotFromPool assigns a clean default cropCycle: { status: "NO_CYCLE", tanggalTanam: null, tanggalPolinasi: null, lastHarvestSummary: null } for each greenhouse.

doHydrateOperationalState merges remoteG.cropCycle retrieved from the authoritative ESP32 controller (using the canonical direct ESP32 API such as /api/v1/context and/or the dedicated crop-cycle endpoint), populating active status, planting date, pollination date, variety, plant counts, notes, and calculated HST/HSP runtime values directly into g.cropCycle and g.telemetry. The operational hydration path must not require Python.

In greenhouse detail views (/greenhouse/:ghId), mounting effects dispatch cropCycleService.syncCycleFromEsp32(gh.id) against canonical endpoint /api/v1/greenhouses/{ghId}/crop-cycle to reconcile local operational memory with authoritative controller state.

Browser refresh / reload maintains full continuity: active planting cycles never disappear or fall back into false NO_CYCLE states.

12. ESP32-Authoritative Lifecycle & Schedule Persistence Invariant

All operational parameters managed via the "Kelola Siklus" modal are physically authoritative on the ESP32:

Planting Date (tanggalTanam) & Pollination Date (tanggalPolinasi): Persisted in ESP32 Flash NVS under namespace agrotech_cc, key cycles_v3. HST and HSP are computed dynamically by the controller.

Plant Identity & Metadata (variety, plantCount, notes): Persisted in crop_cycle_record_t within NVS cycles_v3.

Target Harvest HST (targetHarvestHst): Persisted directly in crop_cycle_record_t.target_harvest_hst in NVS cycles_v3.

Crop Timeline Phases & Maintenance Schedules (cropTimelineConfig):

Persisted atomically in ESP32 Flash NVS under key tl_<gh_id> within namespace agrotech_cc.

Mirrored to ESP32 SPIFFS at /spiffs/tl_<gh_id>.json.

Returned within the canonical CropCycle payload on GET /api/v1/greenhouses/{ghId}/crop-cycle and PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}.

Zero Single-Point-of-Failure: Even after complete browser storage loss, backend restart, or direct standalone connection to the ESP32 controller, 100% of cycle, timeline, and maintenance schedule data is recovered directly from the ESP32.



13. Latest Architecture Rule — Bootstrap IP Is the Only Allowed Browser-Persistent Locator

This amendment supersedes any earlier wording in this document that categorically forbids all browser persistence. The prohibition applies to authoritative topology and operational data; it does not forbid persisting ESP32 IP locator hints.

Canonical rule:

Browser persistent state
        = IP address locator hints only

ESP32 persistent state
        = authoritative topology + operational configuration

Python persistent state
        = history / research / mirror / coordination

Python → ESP32 operational proxy
        = FORBIDDEN

First-Boot Rule

A completely new browser with no stored IP must be able to recover the system by receiving one valid ESP32 IP address from the operator. The browser then contacts that ESP32 directly and retrieves the full System Topology Pool. The pool supplies the known controller registry and last-known IP locators needed for subsequent direct probing.

Refresh Rule

A refresh must never depend on persisted Complex/GH data in the browser. It may reuse stored IP locator hints solely to re-bootstrap the ESP32. The resulting Complex/GH topology must always be read from ESP32 and reconstructed into ephemeral UI memory.

IP Change Rule

If an ESP32's IP changes, its deviceId and topology identity remain unchanged. Once the controller is successfully reached at its new IP, the browser may update its locator cache and the controller may update its replicated lastKnownIp. IP changes do not constitute topology mutations.

Hardcoded-IP Ban

A specific ESP32 IP is never a software default. Examples in tests or documentation must use placeholders or inject runtime values. A committed .env.example must not contain a concrete ESP32 IP. Development overrides may supply an operator-selected IP at runtime without converting that value into source-level or firmware-level identity.