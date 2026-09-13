# AI AGENT REMEDIATION PLANNING PROMPT V1
## From Verified Blindspots to a Safe, Dependency-Aware Remediation Plan

You are starting a NEW AI session on the existing AgroTech repository.

The repository has already passed these stages:

```text
SP-011
  ↓
Blindspot Audit
  ↓
Finding Verification
```

The previous verification stage produced verified/reclassified findings and root-cause analysis.

Your task now is:

> Build a rigorous remediation plan for the verified findings BEFORE any production-code modification begins.

This is a PLANNING-ONLY pass.

Do NOT implement fixes.

Do NOT refactor production code.

Do NOT redesign the UI.

Do NOT flash/install the ESP32.

Do NOT assemble hardware.

Do NOT modify the OpenAPI contract unless the planning documents explicitly identify a required contract decision; even then, do NOT apply the change in this pass.

The objective is to determine the safest, smallest, dependency-aware way to remediate the confirmed problems without creating new inconsistencies.

---

# 1. SCOPE

IN SCOPE:

```text
Existing Vite/React UI
↕
ESP32 REST/API
↕
ESP32 runtime / FreeRTOS
↕
ESP32 storage
↕
ESP32 HAL
↕
hardware-dependent software assumptions
```

OUT OF SCOPE:

```text
Python backend
Business model
Research analytics
New product features unrelated to remediation
UI redesign
Physical assembly
Firmware flashing
Production-code implementation
```

Python MUST NOT be introduced into the remediation plan except to explicitly state that it remains out of scope.

---

# 2. PRIMARY INPUTS

Use these as the primary planning sources:

```text
template/docs/AI_BLINDSPOT_FINDING_VERIFICATION_V1.md
template/docs/AI_BLINDSPOT_FINDING_MATRIX_V1.md
template/docs/AI_BLINDSPOT_ROOT_CAUSE_MAP_V1.md
```

Also read:

```text
template/GEMINI.md
template/AI_PROGRESS.md
template/AI_HANDOVER.md
template/AI_DECISIONS.md
template/AI_CHANGELOG.md
```

And inspect the actual repository:

```text
template/contracts/UI_ESP32_OPENAPI.yaml
template/esp32/
existing UI source
existing API/adaptor layer
existing tests
existing build configuration
```

The verified findings and root-cause map are evidence, not a replacement for the source code.

---

# 3. SOURCE-OF-TRUTH HIERARCHY

Use:

1. Actual repository source
2. Canonical OpenAPI contract
3. Current project specifications
4. Verified finding documents
5. Root-cause map
6. Durable AI project state
7. General technical knowledge

If there is a contradiction, identify it explicitly.

Do NOT silently choose one side.

---

# 4. PLANNING OBJECTIVE

For every CONFIRMED or PARTIALLY CONFIRMED finding determine:

```text
Root cause
Remediation objective
Affected layers
Affected files/modules
Dependencies
Preconditions
Implementation strategy
Verification strategy
Potential side effects
Rollback strategy
Required project decision
Required physical verification
Safe Point boundary
Priority
```

The result must answer:

> What needs to change, in what dependency order, with what verification evidence, and what must be decided before coding?

---

# 5. FIRST TASK — RE-BASELINE CURRENT STATE

Before planning remediation:

```text
1. Read current AI_PROGRESS.md.
2. Read current AI_HANDOVER.md.
3. Inspect git status.
4. Inspect the exact repository state that was audited.
5. Confirm whether production source changed after the finding verification pass.
6. Reconcile the verified findings against current source.
```

If the current source has changed since verification:

```text
DO NOT blindly use the old finding status.
```

Mark affected findings:

```text
REQUIRES RE-VERIFICATION
```

Do not plan a fix against stale evidence.

---

# 6. FINDING ELIGIBILITY

Classify each verified finding into one of:

```text
REMEDIATE NOW
REQUIRES PROJECT DECISION
REQUIRES PHYSICAL VERIFICATION FIRST
REQUIRES RE-VERIFICATION
ACCEPTED RISK / NO CHANGE
NOT A REMEDIATION ITEM
```

Do NOT force every finding into a coding task.

Examples:

```text
software bug
→ REMEDIATE NOW

contract ambiguity
→ REQUIRES PROJECT DECISION

relay polarity
→ REQUIRES PHYSICAL VERIFICATION FIRST

unproven concern
→ REQUIRES RE-VERIFICATION
```

---

# 7. ROOT-CAUSE-FIRST PLANNING

Use the root-cause map to group findings.

Do not treat every symptom as an independent implementation project.

For example:

```text
ROOT-001
Incomplete command path

    ├── finding A
    ├── finding B
    ├── finding C
    └── finding D
```

Then define:

```text
ROOT-001 REMEDIATION
```

that addresses the underlying architecture while covering all related findings.

However:

> Do not merge findings merely because they are in the same category.

Only merge when they share a genuine root cause or implementation boundary.

---

# 8. FIND THE DEPENDENCY GRAPH

Create an explicit remediation dependency graph.

Examples of dependency relationships:

```text
Pin mapping
   ↓
HAL
   ↓
Safety
   ↓
Runtime

API contract
   ↓
DTO
   ↓
HTTP handlers
   ↓
command manager
   ↓
UI adapter

RTC
   ↓
scheduler
   ↓
crop-cycle
   ↓
telemetry timestamps
```

Determine actual dependencies from the codebase.

Do not assume the examples above are the final graph.

For each remediation group ask:

```text
What must exist first?
What can be parallel?
What must wait?
What could break if done too early?
```

---

# 9. FIND CONFLICTING FIXES

This is mandatory.

Before proposing implementation order, look for remediation plans that can interfere with each other.

Examples:

```text
Changing API envelope
    conflicts with
changing UI adapter

Changing pin map
    conflicts with
hardware assembly guide

Changing command manager
    conflicts with
scheduler design

Changing configuration schema
    conflicts with
NVS persistence

Changing emergency-stop semantics
    conflicts with
reboot recovery
```

Create a conflict matrix.

For every conflict:

```text
Conflict ID
Fix A
Fix B
Why they conflict
Which must happen first
Whether a project decision is required
```

---

# 10. PROJECT DECISION GATE

Create a separate decision list.

Only include decisions that materially affect implementation.

Potential categories:

```text
API contract shape
Network architecture
Authentication
Emergency-stop persistence semantics
Scheduler ownership
Multi-GH topology model
Hardware optionality
Safety interlock policy
Clock authority
Configuration replacement semantics
Physical feedback requirements
```

Do NOT automatically include all of these.

Only include those actually required by the verified repository state.

For every decision provide:

```text
DECISION-ID
Question
Why it matters
Evidence
Options
Pros/cons
Recommended option
What changes depending on the choice
Can implementation proceed without deciding?
```

---

# 11. API CONTRACT REMEDIATION

Perform a dedicated planning pass over:

```text
OpenAPI
TypeScript API contracts
ESP32 DTOs
HTTP handlers
Error responses
Command endpoints
Crop-cycle endpoints
Configuration endpoints
```

Determine exactly which contract changes, if any, are required.

Do NOT change the contract in this pass.

For each required contract decision identify:

```text
contract artifact
UI impact
ESP32 impact
test impact
migration impact
```

The canonical contract remains:

```text
template/contracts/UI_ESP32_OPENAPI.yaml
```

Do not propose competing contract copies.

---

# 12. UI REMEDIATION BOUNDARY

The existing UI is protected existing work.

For every UI-related fix specify:

```text
Why UI source must change
Exact likely files/modules
Why service/adaptor-layer change is preferable
Whether component changes are unavoidable
Expected user-visible behavior change
How unrelated UI behavior remains protected
```

Prefer:

```text
UI component
   ↓
existing service/adaptor
   ↓
ESP32 client
```

over direct HTTP from UI components.

Do NOT redesign the UI.

---

# 13. ESP32 REMEDIATION BOUNDARY

For each ESP32 fix specify:

```text
affected subsystem
affected module(s)
interface boundary
state ownership
runtime impact
persistent-state impact
concurrency impact
error propagation
test boundary
```

Avoid suggesting arbitrary architectural rewrites unless necessary to fix a verified root cause.

---

# 14. HARDWARE-DEPENDENT REMEDIATION

Separate software changes from physical verification.

Use:

```text
SOFTWARE-READY
PHYSICAL-VERIFICATION-REQUIRED
HARDWARE-CHANGE-REQUIRED
```

For physical issues, document:

```text
software assumption
physical uncertainty
what must be inspected/measured
what evidence closes the issue
what software change depends on that evidence
```

Never invent module ratings, wire sizes, fuse values, relay ratings, or other electrical specifications.

---

# 15. SINGLE-GH / MULTI-GH TOPOLOGY

Preserve this project requirement:

> A GH that is the only installed GH in a Complex may operate without the source-distribution/splitting valves needed to select A/B/N/raw-water paths among multiple GH mixing tanks.

Planning MUST explicitly verify that remediation of multi-GH support does not make a single-GH Complex require hardware that is only needed when multiple GHs exist.

The plan must model at least:

```text
Topology A:
Complex
└── GH-1

Topology B:
Complex
├── GH-1
└── GH-2
```

Identify which components are:

```text
required in A
optional in A
required in B
required only for routing between GHs
```

Do not invent valve hardware details.

---

# 16. FIRST INSTALLATION TARGET

The remediation plan must define a practical first-installation target before physical assembly.

The target is:

```text
Fresh ESP32
→ flash
→ first boot
→ safe state
→ provisioning
→ network
→ device identity
→ Complex
→ first GH
→ configuration
→ sensors/actuators available according to topology
→ operational API
→ UI connection
```

The plan must explicitly prevent hidden assumptions such as:

```text
active crop already exists
network already configured
RTC already valid
SD already mounted
all sensors connected
multi-GH routing hardware already installed
```

---

# 17. SAFETY REMEDIATION ORDER

Treat safety-critical changes with special dependency priority.

Identify a safe order for:

```text
GPIO safe state
relay polarity
emergency stop
dry-run interlock
sensor validity
command arbitration
queued commands
recovery
scheduler
```

Do not recommend enabling runtime behavior before the relevant safety gates exist.

For each safety item define:

```text
precondition
unsafe failure mode
desired invariant
verification method
```

---

# 18. CONFIGURATION / STORAGE MIGRATION PLAN

For changes affecting persisted state, explicitly plan:

```text
old format
new format
versioning
migration
invalid-state handling
rollback
power loss during migration
reboot after migration
```

Do not assume wiping NVS is acceptable.

Do not assume a schema change is harmless.

---

# 19. COMMAND / SCHEDULER REMEDIATION PLAN

Treat these as related but not necessarily identical.

Plan boundaries for:

```text
manual commands
scheduled commands
queue
timed execution
cancellation
emergency stop
idempotency
status tracking
recovery
```

Explicitly define what must be decided versus what is a straightforward implementation correction.

Do not introduce browser scheduling as a workaround.

---

# 20. CLOCK / TIME REMEDIATION

Plan:

```text
RTC
system time
clock-sync
timezone
scheduler
HST/HSP
timestamps
reboot recovery
```

Determine dependencies between them.

Do not implement time behavior in this phase.

---

# 21. TEST STRATEGY FOR EACH REMEDIATION GROUP

Every remediation group MUST have a corresponding proof strategy.

For each group identify:

```text
unit tests
integration tests
contract tests
failure tests
reboot/persistence tests
resource/stability tests
hardware-in-the-loop tests
manual commissioning checks
```

Do not label a mock test as end-to-end.

Explicitly distinguish:

```text
software-only proof
ESP32-on-real-device proof
physical-system proof
```

---

# 22. TEST STRATEGY MUST ATTACK THE FIX

For every proposed fix ask:

```text
How can this fix fail?
How can it regress?
What old behavior could it accidentally break?
What happens if the operation occurs twice?
What happens if power fails halfway?
What happens if UI times out?
What happens if hardware is absent?
What happens when GH count changes?
```

Do not only test the happy path.

---

# 23. ROLLBACK PLAN

Every remediation group that modifies persistent state, API contract, or safety behavior MUST have a rollback strategy.

Specify:

```text
rollback trigger
rollback action
data compatibility
whether firmware downgrade is safe
whether UI version rollback is safe
whether persisted data survives rollback
```

---

# 24. SAFE POINT PLAN

Create a proposed remediation Safe Point sequence.

It should be dependency-driven, not merely numbered by the original findings.

For example:

```text
SP-R01
Safety + pin foundation

SP-R02
Network + boot/runtime foundation

SP-R03
Contract + DTO alignment

SP-R04
Command/runtime foundation

SP-R05
Scheduler/configuration

SP-R06
RTC/crop-cycle

SP-R07
UI integration

SP-R08
Integrated software verification

SP-R09
First-install readiness

SP-R10
Physical commissioning
```

These are examples only.

The agent must determine the actual sequence from the repository.

For every proposed Safe Point provide:

```text
Objective
Included findings
Dependencies
Expected repository state
Build/test evidence
Exit criteria
Rollback point
```

---

# 25. PRIORITY MODEL

Use:

```text
P0 — must fix before first flash
P1 — must fix before operational runtime
P2 — must fix before multi-GH deployment
P3 — important robustness improvement
P4 — deferred / accepted risk
```

Do not assign P0 merely because severity is CRITICAL.

Priority must consider:

```text
physical safety
first-install blockage
core functionality
dependency criticality
likelihood
blast radius
ability to test without hardware
```

---

# 26. MINIMUM-CHANGE PRINCIPLE

For every proposed remediation ask:

> What is the smallest coherent change that fixes the root cause without weakening the architecture?

Do not prescribe major refactoring where a targeted correction is sufficient.

At the same time, do not recommend a tiny patch that leaves the underlying root cause intact.

---

# 27. REMEDIATION COMPLETION DEFINITION

Define "Done" separately for:

```text
Code complete
Build complete
Automated tests complete
Contract verified
UI integration verified
ESP32 real-device verified
Physical hardware verified
```

Never collapse these into one PASS.

---

# 28. REQUIRED OUTPUT DOCUMENTS

Create:

```text
template/docs/
├── AI_REMEDIATION_PLAN_V1.md
├── AI_REMEDIATION_MATRIX_V1.md
├── AI_REMEDIATION_DECISIONS_V1.md
├── AI_REMEDIATION_DEPENDENCY_GRAPH_V1.md
├── AI_REMEDIATION_CONFLICT_MATRIX_V1.md
└── AI_REMEDIATION_SAFEPOINT_PLAN_V1.md
```

## A. Master Plan

For each remediation group:

```text
Group ID
Title
Root causes addressed
Findings addressed
Goal
Affected layers
Affected files/modules
Dependencies
Implementation approach
Risk
Tests
Physical verification
Decision dependencies
Rollback
Priority
Safe Point
```

## B. Matrix

| Finding | Status | Root Cause | Remediation Group | Priority | Dependencies | Decision | Physical Check | Safe Point |
|---------|--------|------------|-------------------|----------|-------------|----------|-----------------|------------|

## C. Decisions

Only unresolved decisions.

## D. Dependency graph

Show actual implementation dependencies.

## E. Conflict matrix

Show fixes that must not be implemented independently or in the wrong order.

## F. Safe Point plan

Show the exact proposed remediation checkpoints.

---

# 29. NO PRODUCTION CODE CHANGES

During this session:

```text
Production source modifications: FORBIDDEN
```

Allowed:

```text
audit/planning documentation
```

Not allowed:

```text
C changes
CMake changes
OpenAPI edits
TypeScript source changes
React changes
configuration source edits
firmware source edits
```

Unless a file is a planning document explicitly required by this prompt.

---

# 30. HANDOVER

At the end:

1. Update `AI_PROGRESS.md`.
2. Update `AI_HANDOVER.md`.
3. Update `AI_CHANGELOG.md`.
4. Record all planning documents.
5. State explicitly that production code was not changed.
6. Record all unresolved project decisions.
7. Record physical-verification prerequisites.
8. Create a Git commit containing only planning documentation if coherent.

Suggested Safe Point:

```text
SP-REMEDIATION-PLAN-001
Remediation Planning Complete
```

or:

```text
SP-REMEDIATION-PLAN-001-PARTIAL
```

---

# 31. FINAL SESSION REPORT

Return:

```text
REMEDIATION PLANNING:
COMPLETE / PARTIAL / BLOCKED

Production code changed:
NO

Verified findings assessed:
N

Remediation groups:
N

P0:
N
P1:
N
P2:
N
P3:
N
P4:
N

Project decisions required:
N

Physical verification prerequisites:
N

Major dependency chains:
1. ...
2. ...
3. ...

Major fix conflicts:
1. ...
2. ...

Proposed Safe Points:
1. ...
2. ...
3. ...

Top risks if implemented in wrong order:
1. ...
2. ...
3. ...

Next exact action:
...

Git commit:
...
```

The purpose of this session is to create a safe implementation roadmap from verified evidence.

Do not start coding.

Do not optimize for speed over correctness.

Do not optimize for minimizing the number of remediation groups.

Optimize for:
- root-cause correctness;
- dependency correctness;
- safety;
- reversibility;
- testability;
- preservation of the existing UI;
- contract integrity;
- future multi-GH scalability;
- clean first installation.
