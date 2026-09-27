# MIXING & FERTIGATION — OPERATIONAL MODEL

**Status:** Canonical design intent / system alignment document  
**Scope:** ESP32 firmware, scheduler/runtime, Web UI, configuration, recipes, equipment, telemetry/events, multi-GH orchestration  
**Primary authority:** ESP32 owner of the Complex  
**Related architecture:** `docs/SYSTEM_TOPOLOGY_POOL.md`, schedule/configuration contracts, fertigation runtime, equipment configuration

---

## 1. Purpose

Dokumen ini menetapkan bagaimana sistem AgroTech harus memahami dan menjalankan hubungan antara **Mixing** dan **Fertigation**.

Tujuan utamanya adalah memastikan bahwa:

1. User melihat **Fertigation** sebagai satu pekerjaan operasional yang utuh.
2. Sistem memecah pekerjaan tersebut menjadi fase-fase fisik yang benar.
3. **Mixing** dan **Delivery/Penyaluran** bukan dua pekerjaan user yang harus dijadwalkan secara terpisah untuk operasi normal.
4. ESP32 tetap menjadi otoritas operasional untuk Complex yang dimilikinya.
5. Model single-GH tidak menjadi arsitektur khusus; single-GH hanyalah kasus sederhana dari model multi-GH.
6. Scheduler melakukan locking berdasarkan resource fisik yang benar, bukan berdasarkan label "fertigation" secara global.
7. Kegagalan mixing dan kegagalan delivery dapat dibedakan.
8. Schedule/intent user tetap berbeda dari compiled runtime artifact.

Dokumen ini adalah **design intent** yang harus digunakan agent/software implementation untuk menyesuaikan sistem terhadap model operasional yang diinginkan.

---

# 2. Prinsip Utama

## 2.1 Fertigation adalah user-facing operation

Bagi user, operasi normal adalah:

> "Lakukan fertigasi ke GH-01 menggunakan Recipe X sebanyak 20 L pada 06:00."

User tidak perlu membuat dua jadwal:

- Mixing 05:55
- Delivery 06:00

untuk satu pekerjaan fertigasi normal.

Model user-facing:

```text
FERTIGATION
├── target Complex
├── target GH
├── recipe
├── target volume
└── trigger/schedule
```

---

## 2.2 Mixing adalah system-internal preparation phase

**Mixing** berarti menyiapkan larutan fertigasi di mixing tank.

Konsep fisiknya:

```text
Raw Water
   +
Nutrient A
   +
Nutrient B
   +
Nutrient N (bila digunakan)
   ↓
Mixing Tank
   ↓
Homogenization / Mixing
   ↓
MIX_READY
```

Output mixing adalah **prepared nutrient solution** yang siap disalurkan.

Mixing bukan delivery.

---

## 2.3 Delivery/Penyaluran adalah application phase

Delivery berarti mengambil larutan yang sudah siap dan menyalurkannya ke tanaman.

```text
MIX_READY
   ↓
Delivery Pump
   ↓
Distribution Network / Valve
   ↓
Plants
   ↓
Target Volume Reached
   ↓
DELIVERY_COMPLETE
```

Delivery bukan proses pembuatan larutan.

---

## 2.4 Fertigation = orchestration

Secara internal, satu Fertigation Run harus dipandang sebagai orchestration:

```text
FERTIGATION RUN
      │
      ├── PRECHECK
      │
      ├── MIXING PHASE
      │      ├── FILL
      │      ├── DOSING
      │      ├── MIX/HOMOGENIZE
      │      └── MIX_READY
      │
      └── DELIVERY PHASE
             ├── START DELIVERY
             ├── FLOW CONTROL
             ├── VOLUME TRACKING
             └── COMPLETE
```

Tidak boleh ada implicit assumption bahwa `fertigation = delivery pump ON`.

---

# 3. Single-GH dan Multi-GH

## 3.1 Single-GH

Jika sebuah Complex hanya memiliki satu GH:

```text
Complex-01
└── GH-01
    └── Mixing Tank-01
```

maka target GH secara praktis sudah deterministik.

User tidak perlu memilih GH bila UI memang hanya memiliki satu GH.

Namun sistem **tetap wajib menyimpan dan membawa `complexId` dan `ghId` secara eksplisit**.

Single-GH bukan mode arsitektur berbeda.

Ia hanya berarti:

```text
number_of_GH_in_complex = 1
```

Semua kontrak runtime, persistence, scheduler, ownership, telemetry, dan history tetap berbasis `complexId + ghId`.

---

## 3.2 Multi-GH

Jika kemudian Complex berkembang menjadi:

```text
Complex-01
├── GH-01
│   └── Mixing Tank-01
└── GH-02
    └── Mixing Tank-02
```

Fertigation Run tetap memiliki kontrak yang sama:

```text
complexId = complex-01
ghId      = gh-02
recipeId  = recipe-x
target    = 20 L
```

Yang berubah hanya resource resolution:

```text
resolve GH-02
    ↓
select Mixing Tank-02
    ↓
mix
    ↓
select Delivery Pump GH-02
    ↓
deliver
```

UI contract tidak perlu berubah hanya karena GH kedua ditambahkan.

---

# 4. User Protocol vs System Protocol

## 4.1 User protocol

User melihat satu operasi:

```text
Fertigation Schedule
────────────────────────
GH       : GH-01
Recipe   : Melon Vegetatif
Volume   : 20 L
Trigger  : 06:00

[Apply / Save]
```

User tidak mengatur detail berikut untuk operasi normal kecuali memang tersedia sebagai advanced/maintenance control:

- durasi dosing A
- durasi dosing B
- durasi dosing N
- urutan valve internal
- waktu fill tank
- waktu mixing
- kapan delivery pump start
- flow retry algorithm

Detail tersebut adalah tanggung jawab system runtime.

---

## 4.2 System protocol

ESP32 menerjemahkan intent user menjadi:

```text
Fertigation Intent
        ↓
Resource Precheck
        ↓
Mixing Phase
        ↓
MIX_READY
        ↓
Delivery Phase
        ↓
COMPLETE
```

Runtime bertanggung jawab menentukan:

- resource apa yang harus digunakan
- urutan operasi
- durasi dosing berdasarkan calibration
- kapan mixing dianggap selesai
- kapan delivery boleh dimulai
- bagaimana memantau flow dan volume
- kapan operasi harus dihentikan karena fault

---

# 5. Fertigation Run Domain Model

Sistem sebaiknya memodelkan satu **Fertigation Run** sebagai parent operation.

Contoh konseptual:

```json
{
  "runId": "run-...",
  "complexId": "complex-01",
  "ghId": "gh-01",
  "recipeId": "recipe-x",
  "targetWaterVolumeMl": 20000,
  "status": "MIXING",
  "phase": "MIXING",
  "startedAt": "...",
  "mixing": {
    "status": "IN_PROGRESS"
  },
  "delivery": {
    "status": "NOT_STARTED"
  }
}
```

Nama field aktual dapat mengikuti contract codebase, tetapi **semantic separation** harus dipertahankan.

---

# 6. State Machine

Minimum state machine yang diinginkan:

```text
IDLE
  ↓
PRECHECK
  ↓
FILLING
  ↓
DOSING
  ↓
MIXING
  ↓
MIX_READY
  ↓
DELIVERING
  ↓
COMPLETE
```

Fault states minimal:

```text
PRECHECK_FAILED
FILLING_FAILED
DOSING_FAILED
MIXING_FAILED
DELIVERY_FAILED
FLOW_FAULT
LEVEL_FAULT
CANCELLED
```

## 6.1 Aturan transisi

### PRECHECK → FILLING
Hanya jika seluruh dependency yang dibutuhkan tersedia dan valid.

### FILLING → DOSING
Hanya jika kondisi volume/level yang diperlukan terpenuhi.

### DOSING → MIXING
Hanya jika seluruh dosing yang diperlukan berhasil.

### MIXING → MIX_READY
Hanya jika kondisi mixing completion terpenuhi.

### MIX_READY → DELIVERING
Hanya setelah larutan dinyatakan siap.

### DELIVERING → COMPLETE
Hanya jika delivery completion terpenuhi, misalnya target volume tercapai dan tidak ada active fault.

**Delivery tidak boleh dimulai sebelum Mixing menghasilkan `MIX_READY`.**

---

# 7. Mixing Phase

## 7.1 Input

Mixing menerima paling tidak:

- `recipeId`
- target water volume
- target nutrient quantities
- active dosing calibration
- target GH / mixing tank

## 7.2 Operasi

Typical sequence:

```text
1. Validate recipe
2. Validate tank/resource
3. Fill raw water
4. Dose A
5. Dose B
6. Dose N (jika diperlukan)
7. Mix / homogenize
8. Verify completion
9. Publish MIX_READY
```

Urutan aktual dapat berbeda bila hardware design mensyaratkan urutan tertentu, tetapi tidak boleh menghilangkan semantic phases tersebut.

## 7.3 Calibration

Dosing quantity user/recipe harus dikonversi menggunakan calibration yang berlaku.

Concept:

```text
requested_ml
    ↓
active calibration
    ↓
dosing operation
```

Calibration adalah dependency mixing, bukan delivery.

Jika calibration yang diperlukan tidak tersedia atau invalid:

```text
Mixing MUST NOT proceed as if successful.
```

---

# 8. Delivery Phase

Delivery menerima:

- target GH
- prepared solution / MIX_READY
- target delivery volume
- delivery resource
- flow monitoring capability bila tersedia

Typical sequence:

```text
1. Confirm MIX_READY
2. Activate delivery path
3. Start delivery pump
4. Monitor flow
5. Accumulate delivered volume
6. Stop at target / valid completion
7. Verify completion
```

Delivery tidak bertugas menghitung nutrient recipe.

Delivery bertugas memastikan **larutan yang sudah siap benar-benar sampai ke tanaman sesuai target aplikasi**.

---

# 9. Resource Separation

Resource harus dibedakan antara Mixing dan Delivery.

| Resource | Mixing | Delivery |
|---|---:|---:|
| Raw-water inlet | YES | NO / INDIRECT |
| Nutrient A | YES | NO |
| Nutrient B | YES | NO |
| Nutrient N | YES | NO |
| Dosing pump A/B/N | YES | NO |
| Mixing tank | YES | Source |
| Mixing mechanism | YES | NO |
| Delivery pump | NO | YES |
| Flow meter | Optional/validation | YES / strongly relevant |
| Distribution valve | NO / setup | YES |
| GH irrigation network | NO | YES |

Implementation must derive actual locking from physical resource ownership.

---

# 10. Resource Locking and Concurrency

Do NOT use one global lock called `fertigation` unless the physical architecture actually requires it.

The system must lock the resources that are actually shared.

Example:

```text
GH-01 MIXING
```

and

```text
GH-02 MIXING
```

may conflict if A/B/N dosing infrastructure is shared.

But:

```text
GH-01 DELIVERY
```

and

```text
GH-02 DELIVERY
```

may be allowed simultaneously if the delivery pumps and distribution paths are independent.

Therefore scheduler locking must be resource-aware.

Desired conceptual model:

```text
Fertigation Run A
├── requires MIXING resources
└── requires DELIVERY resources

Fertigation Run B
├── requires MIXING resources
└── requires DELIVERY resources
```

The scheduler determines conflicts from the resource sets, not from job labels alone.

---

# 11. Shared Nutrient Infrastructure

If A/B/N dosing pumps are centralized/shared while mixing tanks are per-GH, then:

```text
            Shared
       A / B / N Dosing
              │
        ┌─────┴─────┐
        ▼           ▼
    Mixing GH-01  Mixing GH-02
```

The implementation must distinguish:

- GH-specific resources
- Complex-shared resources
- potentially system-shared resources

This distinction must be visible to the scheduler/resource-lock model.

---

# 12. Failure Semantics

Mixing and Delivery failures are not equivalent.

## 12.1 Mixing failure

Examples:

- dosing pump fails
- tank cannot fill
- required water volume not reached
- mixing mechanism fails
- required calibration missing
- sensor indicates invalid condition

Result:

```text
Fertigation Run = FAILED
Phase = MIXING
Delivery MUST NOT start
```

Do not send an unknown/incorrect concentration to plants merely to complete the schedule.

---

## 12.2 Delivery failure

Example:

```text
Mixing complete
→ Delivery starts
→ flow = 0
```

Result:

```text
Mixing = COMPLETE
Delivery = FAILED
Fertigation Run = FAILED / PARTIAL according to defined policy
```

The system must retain the fact that mixing succeeded.

---

## 12.3 Flow fault

If delivery pump is ON and expected flow is absent, the system must use the configured safety policy.

At minimum:

```text
pump ON
flow invalid / zero beyond timeout
→ stop delivery
→ raise FLOW_FAULT
```

Exact retry policy must be explicit and must not be invented by frontend code.

---

# 13. BLOCKED vs FAILED

These states must not be conflated.

### BLOCKED
The schedule/run cannot start because a required resource/capability is not currently available.

Example:

```text
Fan not ready
Flow sensor unavailable
Mixing tank unavailable
Delivery pump not configured
```

A persisted user schedule must remain present as intent.

### FAILED
An actual execution started but could not complete successfully.

Example:

```text
Mixing started
Dosing pump fault
→ MIXING_FAILED
```

These are different lifecycle states.

---

# 14. Schedule Intent vs Compiled Artifact

The user schedule is an **intent**, not the scheduler's final executable representation.

```text
Schedule Intent
       ↓
Resolve Complex + GH + Recipe + Equipment + Calibration
       ↓
Validate / Compile
       ↓
Compiled Runtime Artifact
       ↓
ESP32 Scheduler
```

A blocked schedule must not disappear merely because it cannot be compiled into an executable artifact at this moment.

Conceptually:

```text
intent = EXISTS
compiled = NOT_EXECUTABLE
status = BLOCKED
```

This is especially important for schedules that depend on Mixing or Delivery resources.

---

# 15. Equipment Readiness

Equipment configuration has two semantic layers:

1. **Hardware capability** — immutable firmware capability contract.
2. **Operational Ready/Enabled state** — user configuration that must persist on ESP32.

The normal UI interaction is:

```text
checkbox = draft
Apply = persist
```

Clicking the checkbox must NOT immediately mutate ESP32.

After Apply:

```text
Draft equipment state
        ↓
ESP32 configuration validation
        ↓
Durable commit
        ↓
Authoritative response
```

When equipment changes availability, dependent fertigation schedule intents must be revalidated.

Example:

```text
Delivery Pump = NOT READY
       ↓
Fertigation Intent persists
       ↓
Fertigation status = BLOCKED
```

Then:

```text
Delivery Pump = READY
       ↓
Revalidate existing intent
       ↓
Compile
       ↓
Potentially ACTIVE / executable
```

The schedule must not need to be recreated.

---

# 16. Single-GH User Experience

When only one GH exists in a Complex, the UI may simplify presentation.

Example:

```text
Complex-01
└── GH-01
```

The UI may preselect GH-01 or hide a redundant GH selector.

But internal requests MUST still contain:

```text
complexId
 ghId
```

The UI simplification must never remove GH identity from the operational model.

---

# 17. Multi-GH User Experience

When multiple GHs exist, user explicitly chooses the target GH.

Example:

```text
Complex: Complex-01
GH:      GH-02
Recipe: Melon Generatif
Volume: 20 L
Time:   06:00
```

The rest of the system remains the same.

Only target resource resolution changes.

---

# 18. Advanced / Maintenance View

Although normal users see Fertigation as one operation, the system should expose detailed phase telemetry for troubleshooting.

Example:

```text
Fertigation Run #123

Status: DELIVERING
GH: GH-01
Recipe: Melon Vegetatif
Target: 20 L

Mixing
  Fill:        COMPLETE
  Dose A:      COMPLETE
  Dose B:      COMPLETE
  Dose N:      COMPLETE
  Homogenize:  COMPLETE
  Result:      MIX_READY

Delivery
  Pump:        ON
  Flow:        2.1 L/min
  Delivered:   14.2 L
  Remaining:   5.8 L
```

This is observability, not a requirement for users to manually orchestrate phases.

---

# 19. Telemetry and Events

Mixing and Delivery should generate separate phase-level events when meaningful.

Examples:

```text
FERTIGATION_RUN_STARTED
MIXING_STARTED
FILL_STARTED
DOSING_STARTED
DOSING_COMPLETED
MIXING_COMPLETED
MIX_READY
DELIVERY_STARTED
FLOW_FAULT
DELIVERY_COMPLETED
FERTIGATION_RUN_COMPLETED
FERTIGATION_RUN_FAILED
```

Telemetry remains high-volume and bounded; events remain lower-volume state transitions.

Current telemetry architecture must not be replaced merely to implement this model.

---

# 20. Persistence and Recovery

Operational truth remains on ESP32 for the owned Complex.

At minimum, the ESP32 must preserve the schedule/configuration intent required to reconstruct:

- target Complex
- target GH
- recipe reference
- target volume
- schedule/trigger
- relevant operational parameters
- current configured equipment/readiness dependencies

Compiled runtime artifacts are derived and may be regenerated from authoritative intent when necessary.

On reboot:

```text
Load authoritative intent/config
        ↓
Validate
        ↓
Reconstruct executable artifact
        ↓
Restore scheduler runtime
```

A browser refresh must retrieve authoritative data from ESP32; browser storage must never become the source of schedule truth.

Browser persistence may contain only approved bootstrap hints such as ESP32 address and minimal Complex/GH identity metadata.

---

# 21. API / Frontend Boundary

The frontend should submit **operational intent**.

The frontend must not implement mixing/delivery timing logic.

Wrong:

```text
Web UI timer
→ dose pump
→ wait 90 sec
→ delivery pump
```

Correct:

```text
Web UI
→ create/update Fertigation Intent
→ ESP32
→ runtime orchestration
```

The ESP32 owns:

- timers
- sequencing
- actuator safety
- phase transitions
- retries/policies
- flow/level protection
- execution state

Python remains coordination/history/mirror/research infrastructure and must not become a required synchronous execution path for a local Complex.

---

# 22. Cancellation and Emergency Stop

A Fertigation Run may be cancelled.

Cancellation must propagate safely across the active phase.

If currently MIXING:

- stop active dosing/fill operations safely
- leave actuators in safe state
- record cancellation
- do not start delivery

If currently DELIVERING:

- stop delivery pump safely
- close required distribution path where applicable
- record partial delivery information
- do not claim COMPLETE

Emergency stop is independent of normal schedule control and must always be able to interrupt active operations.

---

# 23. Idempotency / Duplicate Execution

A single schedule trigger must produce at most one intended Fertigation Run execution for the same scheduler occurrence according to the system's missed-run/idempotency policy.

The system must not accidentally do:

```text
one trigger
→ two mixing runs
→ two deliveries
```

Run IDs / execution IDs should be stable enough to correlate all phases and events.

---

# 24. What the System Must NOT Do

The implementation must never:

1. Treat Fertigation as only `delivery pump ON`.
2. Start Delivery before `MIX_READY`.
3. Require users to create separate Mixing and Delivery schedules for normal fertigation.
4. Lose `ghId` merely because the Complex has only one GH.
5. Use a different architecture for single-GH.
6. Treat `BLOCKED` as `DELETED`.
7. Let browser timers own physical sequencing.
8. Use browser storage as authoritative schedule/equipment/configuration storage.
9. Let frontend decide actual dosing duration independently of ESP32 calibration.
10. Use a single global scheduler lock when actual resource-level locking is required.
11. Treat a successful mix as proof that delivery succeeded.
12. Treat a delivery failure as proof that mixing failed.
13. Recreate user intent from compiled artifacts if the compiled artifact lacks full intent information.
14. Make Python a mandatory synchronous runtime dependency for local fertigation execution.

---

# 25. Required Conceptual Data Flow

```text
USER
 │
 │ Fertigation Intent
 │   GH + Recipe + Volume + Trigger
 ▼
WEB UI
 │
 │ authoritative mutation
 ▼
ESP32
 │
 ├── Persist Intent
 │
 ├── Resolve Topology
 │
 ├── Resolve Equipment
 │
 ├── Resolve Calibration
 │
 ├── Compile / Validate
 │
 └── Schedule Runtime
       │
       ▼
  FERTIGATION RUN
       │
       ├── PRECHECK
       │
       ├── MIXING
       │    ├── FILL
       │    ├── DOSE
       │    ├── MIX
       │    └── MIX_READY
       │
       └── DELIVERY
            ├── PUMP
            ├── FLOW
            ├── VOLUME
            └── COMPLETE
```

---

# 26. Required System Invariants

These invariants must remain true regardless of UI implementation details.

### Invariant 1
Every Fertigation Run has an explicit target `complexId` and `ghId`.

### Invariant 2
Single-GH is not a different architecture.

### Invariant 3
Fertigation is the user-level job; Mixing and Delivery are system-level phases.

### Invariant 4
Delivery cannot begin without successful Mixing / `MIX_READY`.

### Invariant 5
Mixing failure prevents delivery.

### Invariant 6
Delivery failure does not retroactively change Mixing result.

### Invariant 7
Recipe/calibration/dosing belong to Mixing execution.

### Invariant 8
Flow/volume/distribution control belong to Delivery execution.

### Invariant 9
Shared resources are locked by actual resource identity.

### Invariant 10
A persisted schedule intent survives temporary hardware unavailability as `BLOCKED`; it is not deleted.

### Invariant 11
The ESP32 owner remains the operational authority for execution.

### Invariant 12
Browser persistence may only contain approved bootstrap hints; it cannot become operational truth.

### Invariant 13
The same Fertigation Intent must remain meaningful when a Complex evolves from one GH to multiple GHs.

---

# 27. Acceptance Criteria for Implementation

The implementation should eventually prove all of the following:

## User behavior

- User can schedule normal Fertigation as one operation.
- User does not need to schedule Mixing separately.
- User does not need to schedule Delivery separately.
- Single-GH UI remains simple without losing `ghId` internally.
- Multi-GH can target a specific GH.

## Runtime behavior

- Fertigation creates/executes a parent run or equivalent orchestration context.
- Mixing executes before Delivery.
- `MIX_READY` is explicit or semantically equivalent.
- Delivery cannot bypass Mixing.
- Mixing and Delivery have distinguishable states/failures.
- Delivery volume/flow can be tracked independently from mixing.

## Resource behavior

- Mixing uses Mixing resources.
- Delivery uses Delivery resources.
- Resource locks reflect actual sharing.
- Shared A/B/N dosing resources are not accidentally used concurrently when hardware cannot support it.
- Independent GH delivery pumps may run concurrently when hardware permits.

## Persistence behavior

- Fertigation intent persists on ESP32.
- Reboot does not erase valid intent.
- Browser refresh retrieves authoritative state from ESP32.
- BLOCKED does not mean deleted.

## Safety behavior

- Mixing fault prevents Delivery.
- Flow fault stops unsafe delivery according to configured policy.
- Emergency stop interrupts any active phase.
- Cancelled run does not report success.

---

# 28. Implementation Guidance for Agents

When modifying the system, agents MUST first map existing code into these conceptual layers:

```text
UI intent
    ↓
Schedule / configuration
    ↓
Compiler / validator
    ↓
Fertigation Run orchestration
    ↓
Mixing runtime
    ↓
Delivery runtime
    ↓
Actuator / sensor feedback
```

If the current implementation uses different filenames or modules, agents must map them to the concepts above rather than blindly creating duplicate subsystems.

Do not create a second Mixing engine or second Fertigation engine because a naming mismatch exists.

Do not alter hardware GPIO mappings merely to conform to this document.

Do not replace existing topology ownership architecture.

Do not reintroduce a legacy raw-schedule API merely to implement this model.

When a current implementation contradicts this document, the contradiction must be explicitly identified and resolved toward this canonical model.

---

# 29. Known Current-State Issues to Resolve

The current schedule forensic work has already established several relevant issues that implementation agents must keep in mind:

1. The schedule page previously failed to hydrate schedules from ESP32 on browser refresh.
2. `compiled` schedules alone are insufficient to reconstruct full user intent.
3. BLOCKED schedules were previously omitted from the compiled payload and therefore could disappear from the operational view.
4. The schedule compiler had a greenhouse scoping mismatch because topology GHs and configuration GHs were represented separately.
5. The legacy raw schedule endpoints are retired.

These findings mean the new Mixing/Fertigation implementation must preserve a clear distinction between:

```text
AUTHORITATIVE INTENT
       ≠
COMPILED EXECUTION ARTIFACT
```

and must never use an empty compiled artifact to mean that the user has no Fertigation Intent.

---

# 30. Final Canonical Statement

The AgroTech system shall represent normal fertigation as:

> **One user-visible Fertigation operation that is internally executed by the ESP32 as a controlled sequence of Mixing followed by Delivery.**

The user expresses **what should happen**.

The ESP32 determines **how the physical process must happen safely**.

For a single-GH Complex, the system simply has one deterministic GH target. The architecture remains the same as multi-GH.

The canonical relationship is:

```text
USER INTENT
    ↓
FERTIGATION
    ↓
┌───────────────┐
│ MIXING        │
│ Prepare       │
│ nutrient sol. │
└───────┬───────┘
        │
     MIX_READY
        │
        ▼
┌───────────────┐
│ DELIVERY      │
│ Apply to GH    │
└───────┬───────┘
        │
     COMPLETE
```

This separation is the foundation for correct scheduling, resource locking, safety, telemetry, troubleshooting, persistence, and future multi-greenhouse scaling.

---

# 31. Recipe Persistence & Optionality Model

## 31.1 ESP32 MicroSD Authoritative Storage
Recipes represent reusable nutrient definitions used during the Mixing phase.
- Primary Persistent Medium: ESP32 MicroSD card at `/sdcard/recipes/<recipe-id>.json`.
- Operational Source of Truth: ESP32 firmware directly serves Recipe CRUD via `/api/v1/recipes` without requiring a Python backend.
- Browser Role: Transient in-memory view only; no `localStorage`, `sessionStorage`, or cookies are used for recipe operational data.

## 31.2 Recipe is Optional in Fertigation Schedules
A Fertigation Schedule defines *when*, *where*, and *how* to irrigate/fertigate.
- A schedule may specify `recipeId` or leave it empty/null (`recipeId = null` or `""`).
- When `recipeId` is absent:
  - If water-only irrigation or explicit schedule volume is specified, the system treats it as valid.
  - Mixing phase prepares water without dosing channels.
  - Delivery phase delivers the specified water volume to the target GH.
  - Absence of a recipe does NOT block schedule creation.
- If execution later requires missing recipe parameters, the schedule/run becomes `BLOCKED` with an explicit reason, but creation is never rejected purely due to an empty recipe.

## 31.3 Graceful Degraded Storage Fallback (WRITE_TO_NOTHING)
The system remains operational even when physical MicroSD media is absent or unmounted:
- When MicroSD is absent:
  - Firmware executes the recipe storage abstraction path (`recipe_storage_save`).
  - The fallback discards unpersisted writes (`WRITE_TO_NOTHING`).
  - Returns HTTP 503 Service Unavailable with explicit degraded code `STORAGE_UNAVAILABLE`.
  - Firmware does NOT crash, assert, or reset.
  - Unrelated subsystems (scheduler, HTTP server, telemetry, topology, emergency stop) continue normal operation.

---

# 32. Mixing Tank Infrastructure & Equipment Scope Assignment

## 32.1 Mixing Tank Container vs Mixing Actuators
A mixing tank is physically composed of two distinct operational elements:
1. **Physical Container (Reservoir):** Defined in the greenhouse or complex topology by `telemetry.tankCapacityL` (e.g. 1,000 L). It is not a GPIO pin output, but an authoritative container resource where nutrient solution is prepared.
2. **Mixing & Circulation Actuator:** **GPIO 40** (Mixing Tank AC Pump / Pompa Sirkulasi & Pengaduk 220V AC pada 4-Ch Relay IN4).

## 32.2 Scope & Allocation (Complex Shared vs Dedicated)
In standard greenhouse complexes (both single-GH and multi-GH topologies):
- The Mixing Tank container and associated actuators (`pump_mixing` on GPIO 40, `pump_dosing_a` on GPIO 5, `pump_dosing_b` on GPIO 6, `pump_well` on GPIO 1, `float_lower` on GPIO 38) operate as **Shared Complex Infrastructure** (`scope: "SHARED"`, `complexId: "complex-01"`).
- These shared components automatically serve greenhouses within the complex during scheduled fertigation runs.
- In `CANONICAL_GPIO_PIN_MAP`, GPIO 40 is defined as `scope: "CONFIGURABLE"` with `defaultActive: true`, allowing it to operate as a Shared Facility by default, or be explicitly dedicated to a specific greenhouse if required by physical piping.

## 32.3 Equipment Management UI Presentation
To eliminate user confusion where equipment appears missing when filtering by greenhouse:
- When the operator views an individual Greenhouse tab (e.g., `🌿 GH-01`):
  - A prominent **Tangki Mixing & Fasilitas Bersama (Shared Infrastructure)** banner is displayed.
  - Shows container status (`1,000 L`), Pompa Sirkulasi (`GPIO 40`), Dosing Pupuk (`GPIO 5 & 6`), and Pompa Air Baku (`GPIO 1`).
  - Provides instant draft activation (`+ Aktifkan`) for GPIO 40 and a one-click button to jump to the Shared Facility tab.
- Schedule validation (`enrichScheduleWithActivationState`) inspects both complex-level shared equipment and greenhouse equipment (`gh.equipment` + `complex.equipment` + `gh.telemetry.tankCapacityL`), preventing spurious `MISSING_MIXING_TANK` blocked states.


