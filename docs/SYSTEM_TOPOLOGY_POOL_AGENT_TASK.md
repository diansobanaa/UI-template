# AGENT TASK — DISTRIBUTED ESP32 TOPOLOGY POOL & EPHEMERAL UI DISCOVERY

## 0. Mission

Implement a new **ESP32-authoritative topology architecture** for Complex and Greenhouse (GH) discovery and recovery.

The target behavior is:

> A browser must not depend on cookies, localStorage, sessionStorage, or a backend-provided Complex/GH list to reconstruct the operational topology.

Whenever the Web UI starts or reloads, it must rebuild its topology from the ESP32 system.

The system may contain multiple ESP32 controllers. Therefore every ESP32 must persist a **minimal replicated System Topology Pool** containing enough information to know:

- which ESP32 controllers are known;
- which Complexes exist;
- which GHs belong to each Complex;
- which ESP32 owns each Complex;
- topology/pool contract version;
- topology/pool revision;
- deterministic pool hash;
- lifecycle/tombstone state;
- last-known controller observations.

The pool is replicated across ESP32s.

Each ESP32 is authoritative for the operational state of the Complex(es) it owns.

The Browser is only an **ephemeral view/cache**. It must have no persistent topology storage.

The Backend is a **coordination, processing, history, and mirror/reconciliation layer**, not the authoritative source for physical Complex/GH topology.

---

# 1. READ THIS BEFORE MODIFYING CODE

This repository already contains substantial onboarding, topology, configuration, scheduling, storage, network, and frontend state logic.

Do NOT design this task from scratch.

First audit the current implementation and canonical documents, especially:

- `AGENTS.md`
- `TRINITY_MASTER_CONTEXT.md`
- `PRODUCT_REQUIREMENTS_DOCUMENT.md`
- `ESP32_BACKEND_SPEC.md`
- `UI_ESP32_COMMUNICATION_SPEC.md`
- `UI_ESP32_OPENAPI.yaml`
- `COMPLEX_GH_COMPONENT_RELATIONSHIPS.md`
- `docs/COMPLEX_ESP32_ONBOARDING.md`
- `docs/NETWORK_FIRST_BOOT_IMPLEMENTATION_PLAN.md`
- `docs/NETWORK_FIRST_BOOT_FORENSIC_AUDIT.md`
- `backend/operational_store.py`
- `backend/server.py`
- `backend/history_store.py`
- `backend/recovery_store.py`
- `backend/sensor_calibration.py`
- `backend/fertigation_engine.py`
- `esp32/main/storage/storage_mgr.c`
- `esp32/main/storage/storage_mgr.h`
- `esp32/main/network/network_mgr.c`
- `esp32/main/network/network_mgr.h`
- `esp32/main/services/topology_capability.c`
- `esp32/main/services/topology_capability.h`
- `esp32/main/services/offline_sync_mgr.c`
- `esp32/main/services/transfer_mgr.c`
- `esp32/main/http/api_device_handlers.c`
- `esp32/main/http/http_server.c`
- `src/lib/operational-state.ts`
- `src/lib/services.ts`
- `src/lib/api/esp32-client.ts`
- `src/lib/api/python-client.ts`
- `src/lib/api/contracts.ts`
- `src/app/page.tsx`
- `src/app/complex/page.tsx`
- `src/app/onboarding-complex.tsx`
- existing tests under `scripts/`

There is already a firmware `topology_capability` service and an ESP32 `/api/v1/context` endpoint. Those are NOT automatically equivalent to the new System Topology Pool.

In particular:

- the existing topology capability view is derived from active operational configuration;
- the existing `topologyVersion` must not be confused with the new global `poolRevision`;
- the new topology pool is about **system identity/topology discovery**, not runtime capability calculation.

Preserve existing behavior that remains valid.

---

# 2. PROBLEM BEING SOLVED

Current architecture allows the browser/client context to become empty when browser state is lost.

Example:

```text
ESP32-001
└── Complex C001
    ├── GH001
    └── GH002
```

The physical controller still has the configuration.

But:

```text
browser state = empty
cookie/local persisted state = empty
```

The UI can no longer reconstruct the topology from the browser itself.

The system must NOT force the operator to recreate:

```text
Complex
GH
relationships
```

just because the browser was refreshed, restarted, or lost local state.

The correct recovery flow is:

```text
Browser starts
    ↓
discover/bootstrap into ESP32 system
    ↓
retrieve System Topology Pool
    ↓
discover/probe known ESP32 controllers
    ↓
reconcile reachable controller pool copies
    ↓
build ephemeral in-memory UI topology
    ↓
render
```

No persistent browser topology is required.

---

# 3. CRITICAL ARCHITECTURAL PRINCIPLES

## 3.1 ESP32 is the operational authority

For a Complex owned by ESP32-A:

```text
ESP32-A
└── Complex A
    ├── GH-01
    └── GH-02
```

ESP32-A is authoritative for that Complex's local operational state.

Other ESP32s may know that Complex A exists, but their copy is a replica/awareness record.

They must not silently modify Complex A.

---

## 3.2 All ESP32s share the same topology contract

Every ESP32 must understand the same canonical topology schema.

The contract must have an explicit:

```text
schemaId
schemaVersion
contractHash
```

The contract version is NOT the same thing as:

```text
poolRevision
local configuration version
topology capability version
```

Keep those concepts separate.

---

## 3.3 Every ESP32 stores a minimal replicated System Topology Pool

Do NOT replicate the complete operational configuration of every Complex to every ESP32.

Every ESP32 needs only enough data to answer:

```text
What controllers exist?
What Complexes exist?
What GHs exist?
Who owns each Complex?
What lifecycle state is each entity in?
What pool revision/hash do I have?
What entities have been deleted?
What was the last known observation of each controller?
```

Detailed schedules, recipes, component mappings, runtime state, calibrations, etc. remain local operational data on the relevant controller/backend systems.

---

## 3.4 Browser state is ephemeral

The browser may hold:

```text
React state
in-memory stores
derived UI state
temporary query/cache state during current tab lifetime
```

The browser must NOT use persistent storage as the source of truth for topology.

Audit and remove topology persistence through:

```text
cookies
localStorage
sessionStorage
IndexedDB
persistent browser databases
other custom persistent topology caches
```

Do not assume there is a cookie merely because the old behavior appeared persistent.

Audit the actual repository.

Non-topology preferences may remain persistent only when already justified and explicitly unrelated to system topology.

---

## 3.5 Backend topology is a mirror/coordination layer

The backend may retain an operational database or observed topology mirror for:

- API processing;
- historical consistency;
- reconciliation;
- auditing;
- server-side business logic;
- reporting;
- migration support.

But the Web UI must not depend exclusively on the backend Complex/GH list.

When a reachable ESP32 has authoritative topology data, the ESP32 topology pool is the operational reference.

A backend outage must not destroy the ability to discover an already-configured local system.

---

# 4. MULTI-ESP32 MODEL

The system is expected to contain multiple controllers.

Example:

```text
ESP32-A
└── owns Complex-A
    ├── GH-A01
    └── GH-A02

ESP32-B
└── owns Complex-B
    ├── GH-B01
    └── GH-B02

ESP32-C
└── owns Complex-C
    └── GH-C01
```

All ESP32s should be aware of the global topology:

```text
Complex-A → owner ESP32-A
Complex-B → owner ESP32-B
Complex-C → owner ESP32-C
```

But:

```text
ESP32-B
```

does not become operational authority over Complex-A merely because it has a replica of Complex-A.

This is the key distinction:

```text
GLOBAL TOPOLOGY AWARENESS
        ≠
LOCAL OPERATIONAL AUTHORITY
```

---

# 5. SYSTEM TOPOLOGY POOL

## 5.1 Pool envelope

Define a canonical envelope similar to:

```json
{
  "schemaId": "agrotech.system-topology-pool",
  "schemaVersion": 1,
  "contractHash": "sha256:...",
  "poolRevision": 123,
  "poolHash": "sha256:...",
  "originDeviceId": "ESP32-A",
  "generatedAt": "2026-09-21T00:00:00Z",
  "devices": [],
  "complexes": [],
  "tombstones": []
}
```

The exact field names may be adjusted to the repository's existing naming conventions, but the semantics are mandatory.

---

# 6. DEVICE RECORD

Every known ESP32 should have a minimal registry record.

Recommended semantics:

```json
{
  "deviceId": "ESP32-A",
  "deviceState": "KNOWN",
  "ownerComplexIds": ["C001"],
  "hostname": "esp32-....local",
  "lastSeenAt": "2026-09-21T00:00:00Z",
  "lastSeenByDeviceId": "ESP32-A",
  "poolRevision": 123,
  "poolHash": "sha256:...",
  "contractVersion": 1
}
```

Do NOT treat `deviceState` in the replicated pool as live network truth.

Distinguish:

```text
KNOWN / REGISTERED
vs
CURRENTLY REACHABLE
vs
LAST SEEN
```

The Web UI must probe controllers during the current session and derive the current reachability indicator from the probe result.

If an ESP32 is not reachable:

```text
do NOT delete its record
do NOT delete its Complex
do NOT hide the Complex as nonexistent
```

Mark it as unreachable/offline/stale according to the UI model.

---

# 7. COMPLEX RECORD

Minimal topology metadata only.

Recommended:

```json
{
  "complexId": "C001",
  "name": "Complex A",
  "ownerDeviceId": "ESP32-A",
  "state": "ACTIVE",
  "greenhouses": ["GH001", "GH002"],
  "recordRevision": 17
}
```

The record must NOT become a container for all schedules, recipes, calibration, telemetry, etc.

---

# 8. GREENHOUSE RECORD

Recommended:

```json
{
  "ghId": "GH001",
  "complexId": "C001",
  "name": "GH-01",
  "state": "ACTIVE",
  "recordRevision": 4
}
```

The pool must establish the explicit relationship:

```text
GH001
    belongs to
C001
```

Never reconstruct this relationship from a display name.

---

# 9. GLOBAL IDENTITIES

Do not use names as primary identity.

Must use stable IDs:

```text
deviceId
complexId
ghId
changeId
```

Names are mutable metadata.

IDs must remain stable through:

- browser refresh;
- backend restart;
- ESP32 restart;
- network changes;
- UI rebuild;
- re-discovery.

---

# 10. TOPOLOGY HASHING

There must be a deterministic canonical representation of topology.

The `poolHash` must be calculated only over stable topology content.

Do not include volatile fields such as:

```text
current HTTP latency
current browser session
temporary UI state
probe timestamps
```

unless intentionally part of the contract.

Canonicalization must:

- sort entities deterministically;
- normalize field ordering;
- use UTF-8;
- use explicit schema version;
- hash exactly the same canonical byte representation on all nodes.

This allows:

```text
ESP32-A:
poolRevision = 123
poolHash = H1

ESP32-B:
poolRevision = 123
poolHash = H1
```

to mean both replicas represent the same topology content.

---

# 11. POOL REVISION VS OTHER VERSIONS

The repository already uses version concepts.

Do NOT overload them.

Maintain separate meanings:

```text
poolRevision
    = replicated global topology revision

recordRevision
    = revision of a topology entity

localConfigVersion
    = executable operational configuration version

topologyCapability.topologyVersion
    = topology version derived from active operational configuration
```

These are not interchangeable.

---

# 12. TOMBSTONES ARE REQUIRED

This is mandatory for distributed recovery.

Suppose:

```text
ESP32-A
    deletes Complex C001

ESP32-B
    was offline
    still has old C001 record
```

If ESP32-B reconnects and blindly publishes its old pool, C001 could be resurrected.

Therefore deletion must create a compact tombstone:

```json
{
  "entityType": "COMPLEX",
  "entityId": "C001",
  "deletedAt": "2026-09-21T00:00:00Z",
  "deletionChangeId": "chg-123",
  "recordRevision": 18
}
```

A stale replica must not recreate a tombstoned entity.

Tombstones should remain until the topology lifecycle protocol explicitly determines that garbage collection is safe.

For MVP, prefer retaining tombstones rather than implementing unsafe automatic garbage collection.

---

# 13. CONTRACT HASH

Because the desired model is similar in spirit to systems where all nodes must obey the same contract, the implementation must make protocol compatibility explicit.

Every pool response must identify:

```text
schemaId
schemaVersion
contractHash
```

If a controller reports an incompatible contract:

```text
do not merge blindly
do not overwrite the existing pool
do not silently downgrade
```

Return a clear compatibility error.

Example:

```text
TOPOLOGY_CONTRACT_MISMATCH
```

---

# 14. BOOTSTRAP DISCOVERY

## Important browser limitation

A normal browser cannot reliably enumerate every arbitrary LAN device/IP on its own.

Therefore the agent must NOT implement a fake "scan entire subnet" that pretends browser fetches can universally enumerate all ESP32 controllers.

Use a two-layer strategy.

### Layer A — Bootstrap discovery

Find at least one ESP32 using the existing repository-supported methods:

- stable mDNS hostname;
- known/manual local endpoint;
- existing onboarding discovery path;
- other browser-safe discovery mechanism already supported by this project.

Audit current network discovery implementation before adding a new one.

### Layer B — Pool expansion

Once one ESP32 is reached:

```text
Browser
   ↓
ESP32 seed
   ↓
GET system topology pool
   ↓
known devices discovered
   ↓
probe known devices
```

The pool itself becomes the system's memory of devices that are currently offline.

Therefore:

```text
No response from ESP32-B
```

does NOT mean:

```text ESP32-B does not exist
```

It means:

```text ESP32-B is known but currently unreachable
```

---

# 15. UI STARTUP/REFRESH FLOW

Every full UI startup/reload should follow this conceptual sequence:

```text
START
  ↓
clear in-memory topology
  ↓
bootstrap discovery
  ↓
obtain one reachable ESP32
  ↓
GET /api/v1/topology-pool
  ↓
validate contract
  ↓
validate pool hash
  ↓
build list of known controllers
  ↓
probe controllers in parallel
  ↓
for each reachable controller:
     GET /api/v1/topology-pool
  ↓
compare revisions/hashes
  ↓
reconcile same-contract pools
  ↓
build ephemeral UI topology
  ↓
render Complex/GH tree
```

On browser refresh:

```text
repeat the entire process
```

Do not hydrate the topology from persistent browser storage.

---

# 16. UI OFFLINE/UNREACHABLE DISPLAY

Example:

```text
Complex A
  Controller: ESP32-A
  Status: ONLINE

Complex B
  Controller: ESP32-B
  Status: OFFLINE
  Last seen: 02:15
```

The UI should still display Complex B because its topology is known from the pool.

Do not remove it merely because the controller cannot currently be reached.

A Complex may be operationally unavailable while still existing.

---

# 17. ESP32 POOL STORAGE

Use the existing firmware storage abstraction.

Do NOT create a parallel arbitrary persistence system if `storage_mgr` can safely host the pool.

The pool must survive:

- ESP32 reboot;
- Wi-Fi reconnect;
- backend outage;
- browser restart;
- UI cache loss.

Pool persistence must be atomic.

Recommended pattern:

```text
write candidate
    ↓
validate candidate
    ↓
calculate hash
    ↓
persist candidate atomically
    ↓
mark active
```

A corrupted candidate must never replace a valid pool.

On boot:

```text
load active pool
validate schema
validate checksum/hash
if invalid:
    recover last valid snapshot
```

---

# 18. POOL CAPACITY

The pool is expected to be minimal.

Do NOT copy:

```text
all telemetry
all events
all recipes
all schedules
all plant observations
all fertigation history
all calibration history
```

into the global pool.

The pool should remain a small identity/topology registry.

Design explicit maximums and reject malformed oversized pool payloads rather than allocating unbounded memory.

Follow the repository's existing ESP32 memory constraints.

---

# 19. PEER SYNCHRONIZATION

All known ESP32s should eventually converge on the same topology pool content.

When a controller comes online:

```text
ESP32-B boots
    ↓
loads its local pool
    ↓
sees known peers
    ↓
compares poolRevision/hash
    ↓
requests missing/new pool state
    ↓
validates
    ↓
persists reconciled pool
```

Use the existing network stack where possible.

Prefer:

```text
metadata comparison first
```

before transferring the complete payload.

Example:

```text
GET topology pool metadata
→ revision/hash

same hash
→ no transfer

different hash
→ synchronize
```

If the repository already has a transfer/sync service that can safely support this, extend it instead of creating an unrelated transport.

---

# 20. CONSISTENCY MODEL

Do NOT implement a blockchain, cryptocurrency protocol, or heavyweight Byzantine consensus unless the repository's existing design explicitly requires it.

For this implementation phase use:

```text
replicated topology
+
stable IDs
+
single operational owner per Complex
+
versioned records
+
deterministic hashing
+
authenticated change records
+
tombstones
+
conflict detection
+
eventual convergence
```

The goal is that all healthy/reconnected ESP32s converge to the same valid pool.

### Critical rule

If two replicas contain incompatible updates for the same entity and the conflict cannot be deterministically validated:

```text
DO NOT choose a winner silently
DO NOT auto-delete one version
DO NOT merge unsafe ownership changes
```

Represent a conflict explicitly, e.g.:

```text
TOPOLOGY_CONFLICT
```

and block destructive topology mutation until reconciled.

---

# 21. SINGLE-WRITER OWNERSHIP

For each Complex:

```text
ownerDeviceId
```

must identify its operational owner.

Only the owner controller may directly mutate operational topology under that Complex.

Examples:

```text
rename Complex A
create GH under Complex A
delete GH under Complex A
```

must be authorized against the owner.

Other controllers may store replicas.

---

# 22. COMPLEX CREATION

Desired conceptual flow:

```text
UI
 ↓
select reachable ESP32
 ↓
create/claim Complex
 ↓
ESP32 becomes owner
 ↓
ESP32 creates topology change record
 ↓
local pool updated
 ↓
change propagated to peers
 ↓
pool hash/revision changes
 ↓
UI refreshes discovery result
```

Do not create a Complex only in browser memory.

If the ESP32 cannot persist the new Complex topology, the operation must not report success.

---

# 23. GREENHOUSE CREATION

Desired flow:

```text
UI
 ↓
target Complex C001
 ↓
verify C001 owner ESP32-A reachable
 ↓
request GH creation from owner
 ↓
ESP32-A persists GH topology
 ↓
pool revision changes
 ↓
replicate
 ↓
UI refreshes/reconciles
```

Do not create an authoritative GH only in backend/client state.

---

# 24. COMPLEX/GH RENAME

Renames are topology mutations because the name lives in the topology pool.

The owner must persist the new name.

The browser must refresh its in-memory view from the resulting authoritative pool.

---

# 25. DELETE COMPLEX INTERACTION WITH THE PREVIOUS DELETION DESIGN

The previously designed deletion job remains useful, but its topology source must be changed.

Delete should conceptually become:

```text
UI
 ↓
discover Complex from topology pool
 ↓
resolve ownerDeviceId
 ↓
request owner-side retirement
 ↓
safe retire controller state
 ↓
create topology tombstone
 ↓
replicate topology change
 ↓
backend operational/history cleanup job
 ↓
verify
 ↓
UI re-discovers
```

Research data MUST remain untouched.

The following are NOT to be deleted or mutated by Complex deletion:

```text
crop_cycles
plants
fruits
observations
```

This requirement is absolute.

---

# 26. BACKEND ROLE AFTER THIS CHANGE

The backend should remain responsible for:

- processing;
- history;
- telemetry storage;
- events;
- calibration;
- fertigation history;
- recovery metadata;
- server-side coordination;
- operational mirrors where necessary;
- validation and reconciliation.

But frontend bootstrapping must not rely only on:

```text
GET /api/context
```

to reconstruct the physical topology.

The frontend should instead discover topology from ESP32.

Backend context may still be fetched after selecting a Complex for functionality that requires backend-side data.

---

# 27. EXISTING `/api/v1/context`

Do not blindly delete or repurpose the current endpoint.

Audit its existing consumers.

It currently represents device-bound operational context.

Decide/document whether it remains:

```text
LOCAL OPERATIONAL CONTEXT
```

while the new pool endpoint represents:

```text
SYSTEM TOPOLOGY DISCOVERY
```

These are different contracts.

---

# 28. PROPOSED API

Adapt to existing naming conventions, but provide equivalent capabilities.

## `GET /api/v1/topology-pool`

Purpose:

> Return the persistent minimal topology registry known by this ESP32.

Response must include:

```text
schemaId
schemaVersion
contractHash
poolRevision
poolHash
thisDeviceId
devices
complexes
tombstones
```

---

## `GET /api/v1/topology-pool/meta`

Optional but recommended.

Purpose:

> Cheap compatibility/revision/hash comparison before full transfer.

Response:

```json
{
  "schemaId": "agrotech.system-topology-pool",
  "schemaVersion": 1,
  "contractHash": "sha256:...",
  "poolRevision": 123,
  "poolHash": "sha256:...",
  "deviceId": "ESP32-A"
}
```

---

## Peer synchronization endpoint

Use an existing transfer/sync contract if appropriate.

Otherwise define a narrowly scoped topology synchronization endpoint.

It must support:

- contract compatibility;
- revision/hash comparison;
- authenticated updates;
- atomic apply;
- idempotency;
- conflict reporting.

Do not create a generic "write arbitrary topology JSON" endpoint.

---

# 29. AUTHENTICATION AND TRUST

Reuse existing authentication mechanisms wherever possible.

Do not invent plaintext embedded secrets or a second unrelated auth scheme.

A topology mutation must be attributable to:

```text
actor
deviceId
changeId
timestamp
```

A topology synchronization failure must not silently downgrade authentication.

---

# 30. CHANGE RECORD

Every topology mutation should have a stable `changeId`.

Recommended conceptual structure:

```json
{
  "changeId": "chg-...",
  "originDeviceId": "ESP32-A",
  "entityType": "GREENHOUSE",
  "entityId": "GH001",
  "operation": "CREATE",
  "baseRevision": 123,
  "newRevision": 124,
  "createdAt": "...",
  "payloadHash": "sha256:..."
}
```

Exact persistence format may follow repository conventions.

Change records must be deterministic enough for retry and duplicate detection.

---

# 31. IDEMPOTENCY

A duplicated change must not create duplicate entities.

Example:

```text
CREATE GH001
changeId = chg-123
```

received twice:

```text
first → CREATE
second → ALREADY_APPLIED
```

not:

```text
GH001
GH001-copy
```

This is mandatory for unstable local networks.

---

# 32. CONFLICT HANDLING

At minimum detect:

```text
same entity
different owner
same entity
incompatible revision
unknown parent Complex
stale update after tombstone
contract version mismatch
pool hash mismatch after supposedly identical revision
duplicate IDs
GH assigned to multiple Complexes
```

Never silently overwrite.

Use structured error codes such as:

```text
TOPOLOGY_CONTRACT_MISMATCH
TOPOLOGY_REVISION_CONFLICT
TOPOLOGY_OWNER_CONFLICT
TOPOLOGY_PARENT_NOT_FOUND
TOPOLOGY_ENTITY_TOMBSTONED
TOPOLOGY_HASH_MISMATCH
```

---

# 33. FRONTEND ARCHITECTURE

Refactor the frontend so that the topology source is conceptually:

```text
ESP32 discovery
      ↓
Topology Pool Aggregator
      ↓
in-memory topology store
      ↓
UI
```

NOT:

```text
Backend context
      ↓
persistent browser state
      ↓
UI
```

The exact existing store/service names should be preserved where practical.

---

# 34. REMOVE TOPOLOGY PERSISTENCE FROM CLIENT

Audit the repository for:

```text
localStorage
sessionStorage
document.cookie
IndexedDB
custom persistent stores
```

Then classify every usage.

Remove persistence only where it represents operational topology.

Do not break unrelated user preferences unless they are incorrectly mixed with topology.

The acceptance condition is:

> After clearing browser storage completely, the next UI startup still reconstructs the existing Complex/GH topology from ESP32 discovery.

---

# 35. EPHEMERAL CACHE BEHAVIOR

The UI should treat the discovered topology as:

```text
authoritative for this current session
```

but not persistent.

A page refresh should cause a new discovery cycle.

React/in-memory state may be retained between route changes during the same session, but a full reload should not depend on it.

---

# 36. UI DISCOVERY RESULT MODEL

The UI may maintain a derived record such as:

```text
Device:
  known: true
  reachable: true/false
  lastSeenAt: ...
  poolRevision: ...
  poolHash: ...

Complex:
  exists: true
  owner: ESP32-A
  reachableThroughOwner: true/false
  greenhouses: [...]

GH:
  exists: true
  parentComplex: C001
```

`reachable` must be derived from the current probe/session, not from a stale persisted browser value.

---

# 37. OFFLINE CONTROLLER BEHAVIOR

Example:

```text
Pool says:
ESP32-A → Complex-A
ESP32-B → Complex-B
ESP32-C → Complex-C
```

Current session probes:

```text
A → ONLINE
B → OFFLINE
C → ONLINE
```

UI displays all three known Complexes.

The offline state is:

```text
CURRENT SESSION REACHABILITY
```

not:

```text
ENTITY DOES NOT EXIST
```

---

# 38. NEW ESP32 JOINING EXISTING SYSTEM

When a newly flashed ESP32 joins an existing network:

```text
device identity created
        ↓
no local Complex
        ↓
discover one existing peer
        ↓
pull system topology pool
        ↓
validate contract/hash
        ↓
persist replicated pool
```

If no peer can be reached:

```text
local pool remains valid as a standalone pool
```

The new ESP32 must not fabricate unknown Complexes.

---

# 39. EXISTING ESP32 MIGRATION

If an existing ESP32 already has a valid bound Complex and GH definitions in its active/persisted configuration, the new topology service should be able to bootstrap its local authoritative records from those existing values.

Do not force the operator to recreate the Complex merely because the firmware gained the new topology layer.

The migration should be:

```text
existing persisted operational identity/config
        ↓
derive local authoritative topology
        ↓
validate
        ↓
persist pool
```

The agent must inspect the actual config schema before implementing this migration.

Do not invent field paths.

---

# 40. BACKEND MIGRATION

Existing backend Complex/GH rows may already exist.

Do not blindly delete them.

During migration:

```text
ESP32 topology
       ↕
backend topology mirror
```

should be reconciled and differences clearly reported.

The backend must never silently rewrite an authoritative ESP32 topology merely because its local database is stale.

---

# 41. FAILURE SAFETY

### If pool write fails:

```text
retain previous valid pool
report failure
```

### If peer sync fails:

```text
keep local valid pool
mark peer unsynchronized
retry later
```

### If one peer is offline:

```text
retain peer record
mark unreachable
```

### If browser loses state:

```text
perform discovery again
```

### If backend is offline:

```text
topology discovery from ESP32 continues
```

### If all ESP32s are unreachable:

```text
UI cannot reconstruct live topology
display last known state only if it came from the current non-persistent bootstrap path;
do not fabricate state
```

Do not introduce a persistent browser fallback just to hide discovery failure.

---

# 42. SECURITY/SAFETY REQUIREMENT FOR TOPOLOGY MUTATIONS

Topology mutations must never result in unsafe physical operation.

For changes involving an owned Complex:

```text
topology mutation
```

must be separated from:

```text
runtime execution
```

An invalid topology must not automatically deploy a new operational configuration.

The existing configuration atomic activation/rollback behavior must remain intact.

---

# 43. DO NOT BREAK EXISTING RUNTIME TOPOLOGY CAPABILITY

The existing firmware:

```text
topology_capability.c
```

derives topology/capability information from active configuration and is used by scheduling.

Do not replace it with the System Topology Pool.

Instead maintain two layers:

```text
System Topology Pool
    = identity / Complex / GH / ownership / registry

Operational Topology Capability
    = physical resource graph / routing / capability / schedule validation
```

They can reference each other using stable IDs but must not be conflated.

---

# 44. TEST MATRIX

Create a focused test suite covering at least:

## A — Browser reset recovery

1. Configure ESP32 with Complex + multiple GH.
2. Clear all browser storage.
3. Start UI.
4. Verify Complex/GH reappear without recreation.

## B — Full browser refresh

1. Navigate through UI.
2. Refresh.
3. Verify discovery runs again.
4. Verify topology is restored.

## C — Multiple ESP32

Create:

```text
ESP32-A → Complex-A → GH-A01/A02
ESP32-B → Complex-B → GH-B01
ESP32-C → Complex-C → GH-C01
```

Verify one pool can represent all three.

## D — Offline controller

Disconnect ESP32-B.

Verify:

```text
Complex-B remains known
Complex-B is marked offline/unreachable
Complex-B is NOT deleted
```

## E — Peer rejoin

Bring ESP32-B back.

Verify pool convergence and same hash after reconciliation.

## F — Hash consistency

Two equivalent pools must produce identical hash.

## G — Contract mismatch

Controller with incompatible contract must be rejected safely.

## H — Tombstone

Delete Complex-A on owner.

Keep another ESP32 offline with an older copy.

Reconnect it.

Verify Complex-A does not resurrect.

## I — Duplicate change

Apply same `changeId` twice.

Verify only one logical mutation occurs.

## J — Owner enforcement

Try mutating Complex-A from a non-owner controller.

Verify rejection.

## K — Backend unavailable

Disable backend.

Verify the UI can still discover/reconstruct topology from ESP32.

## L — ESP32 reboot

Reboot controller.

Verify topology pool survives.

## M — Power loss during pool commit

Interrupt the write path or simulate failure.

Verify the previous valid pool remains recoverable.

## N — Research retention

Any topology/Complex deletion operation must leave:

```text
crop_cycles
plants
fruits
observations
```

unchanged.

Verify by snapshotting IDs/counts before and after.

---

# 45. REQUIRED DOCUMENTATION

Update canonical technical documentation, not only a temporary note.

At minimum inspect/update:

```text
UI_ESP32_COMMUNICATION_SPEC.md
UI_ESP32_OPENAPI.yaml
docs/COMPLEX_ESP32_ONBOARDING.md
docs/NETWORK_FIRST_BOOT_IMPLEMENTATION_PLAN.md
PRODUCT_REQUIREMENTS_DOCUMENT.md
TRINITY_MASTER_CONTEXT.md
```

Add a dedicated canonical document:

```text
docs/SYSTEM_TOPOLOGY_POOL.md
```

It must explain:

- source of truth;
- pool contract;
- device registry;
- Complex/GH identity;
- ownership;
- revision/hash;
- tombstones;
- discovery;
- synchronization;
- offline behavior;
- conflict behavior;
- frontend ephemeral cache policy;
- backend mirror policy.

Also update:

```text
AI_PROGRESS.md
AI_HANDOVER.md
AI_DECISIONS.md
AI_CHANGELOG.md
```

according to repository documentation rules.

---

# 46. OBSERVABILITY

Log enough to diagnose topology divergence.

Recommended events:

```text
TOPOLOGY_POOL_LOADED
TOPOLOGY_POOL_SAVED
TOPOLOGY_POOL_SYNC_STARTED
TOPOLOGY_POOL_SYNC_COMPLETED
TOPOLOGY_POOL_SYNC_FAILED
TOPOLOGY_CONTRACT_MISMATCH
TOPOLOGY_HASH_MISMATCH
TOPOLOGY_CONFLICT
TOPOLOGY_TOMBSTONE_APPLIED
TOPOLOGY_ENTITY_CREATED
TOPOLOGY_ENTITY_UPDATED
TOPOLOGY_ENTITY_DELETED
DEVICE_DISCOVERED
DEVICE_UNREACHABLE
DEVICE_REACHABLE
```

Do not log secrets.

---

# 47. ACCEPTANCE CRITERIA

The implementation is not complete until all of these are true.

### Topology authority

- Complex/GH topology can be reconstructed from ESP32.
- A browser reset does not require recreating Complex/GH.
- Backend is not required as the sole topology source.

### Multi-device

- Multiple ESP32s are represented.
- Each Complex has one explicit owner controller.
- Non-owner replicas cannot silently become authoritative.

### Pool

- Every ESP32 stores a valid minimal pool.
- Pool has schema version and contract hash.
- Pool has deterministic content hash.
- Pool survives reboot/power recovery.
- Tombstones prevent stale resurrection.

### Discovery

- UI starts with no persistent topology state.
- UI can bootstrap from a reachable ESP32 using a browser-safe existing discovery mechanism.
- UI expands the discovered device list using the pool.
- UI probes known controllers and distinguishes offline from nonexistent.

### Persistence

- No cookie/localStorage/sessionStorage/IndexedDB is used as topology source of truth.
- Reload causes a fresh discovery cycle.

### Synchronization

- Equivalent pools converge to identical state/hash.
- Duplicate changes are idempotent.
- Contract mismatch is rejected.
- Conflicts are detected, not silently overwritten.

### Safety

- Invalid topology cannot automatically deploy unsafe runtime configuration.
- Existing runtime scheduler/capability semantics remain valid.

### Research

- Research data is never deleted, nullified, or cascaded by topology/Complex deletion.
- `crop_cycles`, `plants`, `fruits`, and `observations` remain unchanged.

---

# 48. IMPLEMENTATION ORDER

Execute in this order.

## Phase 1 — Audit

- map current topology/config/state ownership;
- identify browser persistence;
- map current ESP32 identity/binding/config storage;
- map existing network discovery;
- map existing sync/transfer infrastructure.

Do not patch until this map is documented.

## Phase 2 — Canonical contract

Create the topology-pool schema and validation layer.

## Phase 3 — ESP32 persistent pool

Implement storage/load/save/validation/recovery.

## Phase 4 — Device and topology APIs

Expose read-only pool discovery first.

## Phase 5 — Replication

Implement peer comparison and synchronization.

## Phase 6 — Frontend discovery aggregator

Replace backend-only topology bootstrap with ESP32 discovery + pool reconciliation.

## Phase 7 — Topology mutations

Move/create/update/delete ownership-aware operations onto the authoritative ESP32.

## Phase 8 — Tombstones/conflicts

Implement stale replica safety.

## Phase 9 — Deletion integration

Only after topology ownership is working, integrate the previously designed Complex deletion job so deletion follows owner retirement + topology tombstone + backend cleanup.

## Phase 10 — Full regression

Run all relevant existing tests plus the new topology tests.

---

# 49. IMPORTANT DESIGN CONSTRAINTS FOR THE AGENT

Do NOT:

- treat browser state as permanent topology storage;
- recreate Complex/GH when the browser has lost state;
- use backend Complex rows as the only source for physical topology;
- copy full runtime configuration into the global pool;
- silently merge conflicting owner changes;
- resurrect tombstoned entities;
- delete research records;
- invent unsupported browser network scanning;
- hardcode one Complex or one GH;
- use display names as identifiers;
- overload the existing operational `topologyVersion`;
- replace the existing capability engine with the pool;
- create a second unrelated authentication model;
- claim "all ESP32s were scanned" when only one bootstrap controller was actually reachable.

---

# 50. REQUIRED AGENT OUTPUT

Before declaring success, provide:

## A. Architecture report

Explain:

```text
current source of truth
new source of truth
pool layout
owner model
discovery model
sync model
offline model
```

## B. File change list

Exact files created/modified.

## C. Contract examples

Provide example:

```text
pool JSON
device record
Complex record
GH record
tombstone
change record
```

## D. Test results

Report exact commands and outcomes.

## E. Known limitations

Especially:

- browser discovery limitations;
- network reachability limitations;
- any unresolved distributed consistency limitation.

Do not conceal limitations.

---

# 51. FINAL ARCHITECTURAL TARGET

The final conceptual model must be:

```text
                    SYSTEM
                       │
              DISTRIBUTED TOPOLOGY
                       │
                ┌──────────────┐
                │  POOL        │
                │              │
                │ Devices      │
                │ Complexes    │
                │ GHs          │
                │ Owners       │
                │ Revisions    │
                │ Hashes       │
                │ Tombstones   │
                └──────┬───────┘
                       │
          replicated to every ESP32
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
    ESP32-A         ESP32-B         ESP32-C
       │               │               │
    Owner C-A       Owner C-B       Owner C-C
       │               │               │
   runtime A        runtime B        runtime C

                       │
                       ▼
                  Python Backend
              coordination/history/mirror

                       │
                       ▼
                    Web UI
              ephemeral state only
```

The fundamental rule is:

> **If the browser forgets everything, the physical system must still be able to tell the browser what exists.**

And the second rule is:

> **If one ESP32 disappears from the network, its known Complex/GH topology must not disappear from the system's topology model. It becomes an unreachable known controller until the system proves otherwise.**

The third rule is:

> **All ESP32 controllers speak the same topology contract and maintain a replicated, versioned, hashed topology pool, while operational authority remains with the owner controller of each Complex.**
