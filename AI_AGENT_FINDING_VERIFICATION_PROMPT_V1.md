# AI AGENT FINDING VERIFICATION PROMPT V1
## Verify Blindspot Audit Findings Before Any Fix

You are starting a NEW AI session on the existing AgroTech repository.

Your task is **FINDING VERIFICATION ONLY**.

A previous agent produced:

```text
AI_BLINDSPOT_AUDIT_REPORT_V1.md
```

That report contains proposed blindspots discovered during an audit of the existing UI ↔ ESP32 codebase.

Your job is NOT to trust that report automatically.

Your job is to verify, falsify, refine, merge, or reclassify every finding using the actual repository as the primary evidence source.

This is a forensic verification pass before any production-code remediation.

---

# 1. ABSOLUTE SCOPE

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
hardware assumptions relevant to software behavior
```

OUT OF SCOPE:

```text
Python backend
Business model
Research analytics
New product features
UI redesign
ESP32 feature implementation
Production bug fixing
Hardware assembly
Firmware flashing
```

Do NOT implement fixes during this pass.

Do NOT modify production source code.

Do NOT silently alter the requirements to make a finding true.

---

# 2. PRIMARY EVIDENCE HIERARCHY

Use this order when verifying a finding:

1. Actual repository source code
2. Actual tests/build configuration/results
3. Canonical machine-readable API contract:
   `template/contracts/UI_ESP32_OPENAPI.yaml`
4. Current project specifications/contracts
5. Current durable AI project state:
   `GEMINI.md`
   `AI_PROGRESS.md`
   `AI_HANDOVER.md`
   `AI_DECISIONS.md`
   `AI_CHANGELOG.md`
6. Previous blindspot report
7. General technical knowledge

The previous audit report is a CLAIM LIST, not a source of truth.

If the previous report conflicts with repository evidence, the repository wins and the finding must be reclassified.

---

# 3. NEW SESSION BOOTSTRAP

Before analysis:

```text
1. Read template/GEMINI.md
2. Read template/AI_PROGRESS.md
3. Read template/AI_HANDOVER.md if present
4. Read relevant AI_DECISIONS.md
5. Read AI_CHANGELOG.md
6. Locate the previous blindspot report
7. Inspect git status
8. Inspect the current repository structure
```

Do not assume previous conversation memory exists.

Use repository files as the durable context.

---

# 4. FINDING VERIFICATION OBJECTIVE

For EACH finding in the previous audit report, determine:

```text
Is it real?
Is it still present?
Is the evidence accurate?
Is the severity accurate?
Is the category accurate?
Is it actually a defect, a design gap, a requirement gap, or a physical-verification issue?
Does the alleged failure scenario logically follow from the code?
Is the recommended fix actually justified?
Is the finding duplicated by another finding?
Is there existing handling elsewhere that the previous auditor missed?
```

The goal is not to maximize the number of findings.

The goal is to maximize confidence in the final finding set.

---

# 5. REQUIRED FINDING STATUS

Assign exactly one primary status:

```text
CONFIRMED
PARTIALLY CONFIRMED
UNCONFIRMED
FALSE POSITIVE
ALREADY FIXED
DUPLICATE
DESIGN GAP
REQUIREMENT GAP
PHYSICAL VERIFICATION REQUIRED
UNDETERMINED
```

Definitions:

### CONFIRMED
Repository evidence directly proves the issue.

### PARTIALLY CONFIRMED
The core concern is real, but some claim/details/severity are overstated or incomplete.

### UNCONFIRMED
The report claims a problem, but available evidence is insufficient to prove it.

### FALSE POSITIVE
Repository evidence contradicts the claim.

### ALREADY FIXED
The report was true at some point, but the current repository already addresses it.

### DUPLICATE
Substantially the same underlying issue is already represented by another finding.

### DESIGN GAP
The code has no obvious defect, but required behavior/ownership/precedence is not defined well enough to guarantee correctness.

### REQUIREMENT GAP
The repository cannot determine the correct behavior because the project itself has not defined the requirement.

### PHYSICAL VERIFICATION REQUIRED
Software evidence cannot conclusively determine the issue because actual hardware/module/wiring behavior must be inspected.

### UNDETERMINED
Evidence is incomplete or contradictory and needs further investigation.

---

# 6. DO NOT CONFIRM BY DESCRIPTION MATCHING

Do not mark a finding as confirmed merely because:

```text
the function name exists
the variable exists
the report sounds plausible
the code "looks suspicious"
```

Trace the actual execution path.

For example, if the report says:

```text
handler → bypasses command manager
```

verify:

```text
HTTP route
→ handler
→ service call
→ queue
→ worker
→ actuator
→ status
```

Do not stop at the first function.

Likewise, if the report says:

```text
UI command never reaches ESP32
```

trace:

```text
UI component
→ handler
→ service
→ adapter/client
→ HTTP request
→ response handling
```

---

# 7. VERIFY THE FAILURE SCENARIO, NOT JUST THE CODE DETAIL

A finding is only confirmed when the alleged consequence is supported.

For each finding ask:

```text
1. What code path is involved?
2. Under what exact condition does it execute?
3. What state exists before it?
4. What state changes?
5. What prevents recovery?
6. Does the claimed failure actually occur?
7. Is there another layer that mitigates it?
```

Example:

A hardcoded value is not automatically a critical failure.

A blocking delay is not automatically a safety failure.

A missing validation function is not automatically exploitable if validation occurs elsewhere.

Verify the whole chain.

---

# 8. VERIFY EVERY "CRITICAL" AND "HIGH" FINDING FIRST

Before spending time on lower-severity findings, verify all CRITICAL and HIGH findings from the report.

For each one, provide:

```text
Current status
Evidence
Execution path
Failure trigger
Actual consequence
Severity assessment
Confidence
```

Do not change severity simply because the issue sounds dangerous.

---

# 9. CONTRACT VERIFICATION

Perform a dedicated cross-layer comparison:

```text
OpenAPI
   ↕
TypeScript types
   ↕
ESP32 DTO/serialization
   ↕
HTTP route registration
   ↕
actual handler behavior
```

For every ESP32-facing operation check:

```text
path
method
request envelope
request fields
response envelope
response fields
enum
nullable
status codes
error shape
units
date/time format
idempotency
versioning
```

Do not assume the OpenAPI contract is automatically correct.

If the UI and ESP32 both disagree with OpenAPI, report:

```text
CONTRACT AUTHORITY CONFLICT
```

rather than blindly declaring whichever implementation exists "wrong".

---

# 10. UI VERIFICATION

For each UI finding trace the real call graph.

Look for:

```text
page
→ component
→ hook/state
→ service
→ adapter/client
→ transport
```

Verify:

- whether MockDb is active;
- whether localStorage is involved;
- whether direct ESP32 mode actually changes behavior;
- whether mock timers still drive operational state;
- whether optimistic UI state is reconciled;
- whether errors rollback state;
- whether reconnect refreshes device truth;
- whether multiple tabs can diverge.

Do not modify UI while verifying.

---

# 11. ESP32 VERIFICATION

Trace actual firmware execution.

For each finding inspect:

```text
boot
→ init
→ task creation
→ runtime service
→ handler
→ manager
→ HAL
→ GPIO/sensor/actuator
```

Check:

- actual initialization order;
- actual task behavior;
- queue usage;
- mutex use;
- persistent state;
- runtime state;
- error propagation;
- status reporting.

Distinguish between:

```text
dead code
stub code
test code
production path
fallback path
```

A stub existing in the repository is not enough to prove the production path uses it.

---

# 12. HARDWARE CLAIM VERIFICATION

For any finding involving:

```text
GPIO
USB
Flash
PSRAM
SPI
I2C
relay polarity
sensor electrical behavior
AC loads
DC loads
snubbers
contact feedback
```

separate:

```text
SOFTWARE FACT
HARDWARE FACT
INFERENCE
PHYSICAL UNKNOWN
```

Do not turn a plausible hardware concern into a confirmed defect without sufficient evidence.

When the exact physical module has not been assembled or verified, use:

```text
PHYSICAL VERIFICATION REQUIRED
```

where appropriate.

Do not invent component ratings, electrical characteristics, or wiring.

---

# 13. SPECIAL CHECK — SINGLE GH vs MULTI GH

Verify this project requirement exactly:

> A GH that is the only installed GH in a Complex may operate without the source-distribution/splitting valves required to select A/B/N/raw-water paths among multiple GH mixing tanks.

This means:

```text
Complex
└── GH-1
```

must not be rejected merely because multi-GH source-distribution valves are absent.

But:

```text
Complex
├── GH-1
└── GH-2
```

may require additional topology/resources.

Verify the code's actual assumptions around:

- topology;
- hardware inventory;
- capability;
- configuration validation;
- routing;
- command validation;
- safety;
- provisioning;
- GH creation;
- transition 1 → 2 GH.

This known requirement is NOT the only topology issue to verify.

---

# 14. VERIFY CROSS-FINDING INTERACTIONS

Some findings may be individually true but their combination changes the severity.

Build a dependency graph among findings.

Examples:

```text
RTC failure
    +
scheduler failure
    +
reboot recovery failure
    =
larger operational risk
```

or:

```text
UI mock
    +
missing command route
    +
synthetic telemetry
    =
false operator confidence
```

Identify:

```text
independent findings
dependent findings
compound-risk clusters
```

Do not double-count the same root cause.

---

# 15. ROOT CAUSE ANALYSIS

For confirmed findings, determine whether several findings share one root cause.

Example:

```text
ROOT: ESP32 command path incomplete

├── command endpoint bypass
├── fake status
├── missing actuator commands
└── UI cannot verify execution
```

In that case retain the findings when they represent materially different failures, but identify the shared root.

This will later help create an efficient remediation plan.

---

# 16. CHALLENGE THE RECOMMENDED FIX

The previous audit report includes recommended fixes.

Do NOT accept them automatically.

For each confirmed finding ask:

```text
Does the recommendation solve the root cause?
Could it introduce a new race?
Does it conflict with the existing architecture?
Does it violate the canonical contract?
Does it create unnecessary UI changes?
Does it create a new persistence problem?
Is there a smaller safer fix?
Does the requirement actually call for this?
```

During this verification pass, do NOT apply the fix.

Record:

```text
FIX RECOMMENDATION:
VALID
PARTIALLY VALID
INVALID
NEEDS DESIGN DECISION
UNKNOWN
```

---

# 17. LOOK FOR MISSED MITIGATIONS

When the previous audit claims something is broken, search for:

```text
another layer
fallback logic
wrapper
middleware
initialization elsewhere
test-only assumptions
configuration override
generated code
conditional compilation
```

Especially search for:

```text
# CONFIG_*
#if / #ifdef
feature flags
alternate implementations
callbacks
registration tables
function pointers
weak symbols
```

The objective is to avoid false positives caused by reading one file in isolation.

---

# 18. SEARCH FOR NEW EVIDENCE AROUND EACH FINDING

For each finding inspect enough neighboring code to answer:

```text
Who calls this?
Who calls that caller?
What state does it read?
What state does it write?
What can interrupt it?
What happens on error?
What happens after restart?
```

Do not use only line-level pattern matching.

---

# 19. SPECIAL VERIFICATION AREAS

Regardless of previous report findings, independently verify these high-risk areas:

```text
A. network initialization
B. REST route registration
C. request/response envelope
D. command lifecycle
E. emergency stop
F. safety interlocks
G. scheduler persistence/execution
H. configuration validation/apply
I. RTC/time authority
J. crop-cycle persistence
K. sensor validity semantics
L. hardware optionality
M. multi-GH topology
N. storage durability
O. reboot/power-loss recovery
P. UI direct-mode routing
Q. mock/simulation leakage
R. contract tests
S. first-install/provisioning
T. resource exhaustion
```

These are mandatory re-checks even if the original audit barely discussed them.

---

# 20. DO NOT CONFUSE "NOT IMPLEMENTED" WITH "WRONG DESIGN"

Classify carefully:

```text
NOT IMPLEMENTED
IMPLEMENTED INCORRECTLY
IMPLEMENTED PARTIALLY
IMPLEMENTED BUT UNTESTED
REQUIREMENT NOT DEFINED
HARDWARE NOT VERIFIED
```

These are different findings.

Example:

```text
No scheduler code
```

is different from:

```text
Scheduler exists but chooses wrong schedule
```

and different again from:

```text
Scheduler behavior is not specified
```

---

# 21. TEST CLAIM VERIFICATION

For every finding that cites tests:

Verify:

```text
What is actually executed?
What is mocked?
What is real?
What schema is loaded?
What binary is exercised?
What server is used?
What hardware is simulated?
```

Do not call a test "integration" simply because its filename says `e2e`.

A mock test may be useful, but it must be described accurately.

---

# 22. BUILD / STATIC EVIDENCE

Where safe, perform:

```text
clean UI build
existing UI tests
ESP-IDF build
existing ESP32 tests
static checks
route registration inspection
contract validation tools
```

Do not modify production code.

Record actual commands and results.

If a test cannot run because hardware is absent, say so.

---

# 23. REQUIRED OUTPUT

Create:

```text
template/docs/
├── AI_BLINDSPOT_FINDING_VERIFICATION_V1.md
├── AI_BLINDSPOT_FINDING_MATRIX_V1.md
└── AI_BLINDSPOT_ROOT_CAUSE_MAP_V1.md
```

## A. Verification report

For every finding:

```text
ID
Original Severity
Verified Severity
Original Status
Verified Status

Claim:
...

Evidence:
...

Repository tracing:
...

Failure scenario validation:
...

What the previous audit got right:
...

What the previous audit got wrong / overstated:
...

Mitigations discovered:
...

Recommended-fix assessment:
VALID / PARTIALLY VALID / INVALID / NEEDS DECISION / UNKNOWN

Confidence:
HIGH / MEDIUM / LOW

Requires project decision:
YES / NO

Requires physical verification:
YES / NO
```

## B. Matrix

Use:

| ID | Original Severity | Verified Severity | Status | Root Cause | Decision Needed | Physical Verification |
|----|-------------------|------------------|--------|------------|------------------|-----------------------|

## C. Root Cause Map

Group findings into shared causes:

```text
ROOT-001:
  BS-...
  BS-...
  BS-...

ROOT-002:
  BS-...
```

This prevents treating symptoms as independent architecture problems.

---

# 24. NEW FINDINGS DISCOVERED DURING VERIFICATION

If verification reveals an issue that the original audit missed, add:

```text
NEW-001
NEW-002
...
```

But new findings must follow the same evidence standard.

Do not create new findings merely to increase the count.

---

# 25. DISPUTED FINDINGS

If evidence is contradictory:

```text
DISPUTED-001
```

Explain exactly:

```text
Evidence A:
...

Evidence B:
...

Why they conflict:
...

What would resolve it:
...
```

---

# 26. FINAL CLASSIFICATION

At the end produce totals:

```text
CONFIRMED:
PARTIALLY CONFIRMED:
UNCONFIRMED:
FALSE POSITIVE:
ALREADY FIXED:
DUPLICATE:
DESIGN GAP:
REQUIREMENT GAP:
PHYSICAL VERIFICATION REQUIRED:
UNDETERMINED:

NEW FINDINGS:
```

Also provide:

```text
Confirmed CRITICAL:
Confirmed HIGH:
Confirmed MEDIUM:
Confirmed LOW:
```

Do not preserve the previous audit's counts merely for consistency.

---

# 27. IMPORTANT — NO FIX PHASE

This session ends after verification.

Do NOT:

- modify production source;
- modify OpenAPI;
- refactor UI;
- refactor ESP32;
- implement fixes;
- change behavior;
- flash hardware.

Documentation output is allowed.

---

# 28. SAFE POINT / HANDOVER

At the end:

1. Update `AI_PROGRESS.md`.
2. Update `AI_HANDOVER.md`.
3. Update `AI_CHANGELOG.md`.
4. Record that this was verification-only.
5. Record all output documents.
6. Record exact build/test commands and results.
7. Create a Git commit containing only verification documentation if repository state is coherent.

Suggested Safe Point:

```text
SP-VERIFY-001
Blindspot Finding Verification Complete
```

or:

```text
SP-VERIFY-001-PARTIAL
```

if incomplete.

---

# 29. FINAL USER REPORT

End with:

```text
FINDING VERIFICATION:
COMPLETE / PARTIAL / BLOCKED

Production code changed:
NO

Original findings:
N

Confirmed:
N
Partially confirmed:
N
Unconfirmed:
N
False positive:
N
Already fixed:
N
Duplicate:
N
Design gap:
N
Requirement gap:
N
Physical verification required:
N
Undetermined:
N

New findings:
N

Confirmed CRITICAL:
N
Confirmed HIGH:
N

Top confirmed issues:
1. ...
2. ...
3. ...

Top disputed/uncertain issues:
1. ...
2. ...

Major root causes:
1. ...
2. ...

Project decisions required:
N

Physical verification required:
N

Safe Point:
...

Git commit:
...
```

Be skeptical.

Be evidence-driven.

Do not optimize for agreement with the previous auditor.

Do not optimize for reassurance.

The purpose of this pass is to establish which findings are actually real before anyone changes the code.
