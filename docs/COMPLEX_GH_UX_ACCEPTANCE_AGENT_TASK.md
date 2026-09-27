# 0A. REQUIRED INTERACTIVE GUI / BROWSER EXECUTION

This acceptance task MUST use a real rendered GUI/browser when the agent environment supports browser automation.

Do NOT perform this acceptance task as source-code inspection only.

## 0A.1 Discover the available browser/UI tool FIRST

Before testing, inspect the current agent/IDE environment for the strongest available interactive browser capability.

Preferred order:

1. **VS Code built-in Agent Browser Tools**, if available.
2. **Playwright MCP**, if browser tools are not available natively.
3. Another real browser automation tool already installed in the environment.
4. If no real browser automation capability exists, mark the interactive GUI gate as `BLOCKED` rather than pretending it was executed.

The agent must not assume a tool name. Discover the available capability first.

---

## 0A.2 VS Code built-in Browser Tools

If the current VS Code Agent environment exposes browser tools such as:

```text
openBrowserPage
navigatePage
readPage
screenshotPage
clickElement
typeInPage
handleDialog
runPlaywrightCode
```

use them directly.

Do NOT install an external MCP server merely to duplicate an already available native browser capability.

The built-in browser should be used in a visible/interactive mode so the agent can inspect the real application, interact with the rendered UI, inspect console/runtime failures, and verify screenshots where useful.

---

## 0A.3 Playwright MCP fallback

If native VS Code browser tools are unavailable but the agent can install/use MCP, install Playwright MCP.

Prerequisite:

```text
Node.js 20+
```

Use the repository environment and package manager already in use.

For VS Code, the documented CLI installation is:

```bash
code --add-mcp '{"name":"playwright","command":"npx","args":["@playwright/mcp@latest"]}'
```

Playwright MCP runs in headed mode by default, which is required for this acceptance task.

Do NOT add:

```text
--headless
```

for this acceptance run.

For richer testing/debugging, prefer enabling capabilities that are actually useful to this task, for example:

```text
testing
storage
devtools
```

Only enable capabilities supported by the installed Playwright MCP version.

After installation:

1. Verify the MCP server is visible to the agent.
2. Verify browser tools are callable.
3. Launch/open the actual application.
4. Keep the browser visible during the acceptance flow.
5. Use the browser interactively instead of substituting curl/API calls for UI behavior.

Official Playwright MCP setup currently requires Node.js 20+ and supports VS Code and other MCP clients. Playwright MCP defaults to headed browser mode. See the project's current MCP installation/configuration documentation if the environment requires client-specific setup.

---

## 0A.4 If another agent/IDE is being used

If the current agent is not GitHub Copilot in VS Code:

- inspect which MCP/browser integration it supports;
- reuse the project's existing agent tooling where possible;
- if Playwright MCP is the best supported option, configure the standard Playwright MCP server;
- do not hardcode a client-specific configuration that does not apply to the current environment.

The required outcome is the capability, not a specific tool brand:

```text
REAL RENDERED APP
+
REAL INTERACTION
+
ROUTE NAVIGATION
+
SCREEN/DOM/ACCESSIBILITY INSPECTION
+
CONSOLE/ERROR INSPECTION
```

---

## 0A.5 Start the actual application

Before interacting with the GUI:

1. Inspect the repository's package scripts.
2. Determine the correct frontend development command.
3. Start the required dev server(s).
4. Determine the actual application URL.
5. Open that URL in the interactive browser.

Do not invent a port.

Use the port actually reported by the running application.

If the application requires the Python backend, start it according to the repository's documented/runtime configuration as well.

If ESP32 hardware/network access is available, use the actual configured endpoint.

---

## 0A.6 Agent must use the GUI for UX acceptance

For all in-scope acceptance operations, the agent must prefer the real rendered UI:

```text
Create Complex
Edit Complex
Create GH
Open GH detail
Edit GH
Delete GH
Navigate routes
Refresh page
Use browser Back
Use browser Forward
Open direct URLs
```

Do NOT replace these with:

```text
direct database edits
direct JSON mutation
API-only simulation
React state injection
hardcoded test fixtures
```

API calls may be used for diagnostics/read-back, but they do not substitute for the real UI operation.

---

## 0A.7 Interactive error inspection

While using the browser, actively inspect:

```text
visible UI errors
browser console errors
network/API failures
uncaught exceptions
404/500 responses
routing failures
stale rendered data
loading states that never finish
```

When possible, capture a screenshot or structured page snapshot at important failure points.

A browser console error that affects the tested flow is a defect even if the page eventually renders.

---

## 0A.8 GUI test loop

The expected agent loop is:

```text
START APP
   ↓
OPEN GUI
   ↓
INTERACT AS USER
   ↓
OBSERVE RESULT
   ↓
CHECK ROUTE / CONSOLE / API
   ↓
BUG?
 ┌─┴───────────────┐
YES                NO
 │                  │
FIX CODE            CONTINUE
 │
RELOAD GUI
 │
REPEAT SAME ACTION
 │
VERIFY FIX
 └───────────────┘
```

The agent is not allowed to stop at:

```text
BUG FOUND
```

for an in-scope defect that it can fix.

It must:

```text
BUG FOUND
→ fix
→ rerun the same real UI action
→ verify
```

---

## 0A.9 Browser state-loss test must be real

When this task says:

```text
clear browser state
refresh/reopen
```

perform the operation through the real browser tooling.

Do not merely clear an in-memory object in a Python test.

The purpose is to prove that the running application actually reconstructs topology from ESP32 discovery.

---

## 0A.10 Interactive GUI gate

Add this gate to the final report:

```text
INTERACTIVE GUI GATE
Tool discovered:
Tool actually used:
Application URL:
Browser mode:
Real UI flow executed: YES/NO
Console inspected: YES/NO
Screenshots/page snapshots used: YES/NO
Result: PASS / FAIL / BLOCKED
```

If browser automation was available but not used, the acceptance test is incomplete.


# AGENT TASK — REAL UI / ROUTE / DISCOVERY ACCEPTANCE TEST
# COMPLEX + 3 GREENHOUSES

## 0. MISSION

Perform a **real end-to-end product acceptance test** of the currently implemented Complex/GH topology system.

This is NOT a unit-test-only task.

The agent must behave as a real operator using the running application:

```text
launch application
→ discover available UI/browser automation tools
→ interact with the actual UI
→ navigate real routes
→ create real records
→ inspect resulting state
→ edit real records
→ refresh
→ force topology rediscovery
→ delete a real record
→ test the old route
→ identify bugs
→ fix code
→ rerun the flow
```

The purpose is to prove the real product path:

```text
UI
→ route
→ frontend state
→ API
→ ESP32 authoritative topology
→ persistence
→ response
→ UI
→ refresh
→ rediscovery
→ reconstructed UI
```

The agent must **actively search for UX/route/state inconsistencies**.

If it finds a defect that is in scope, it must:

```text
identify
→ diagnose
→ fix
→ restart/reload as necessary
→ reproduce the original scenario
→ verify the fix
```

Do NOT simply report a defect that can reasonably be fixed in the repository.

---


# 0B. MANDATORY VISUAL EVIDENCE & TEST LOGGING

This acceptance task is incomplete without persistent test evidence.

## 0B.1 HEADed / VISIBLE BROWSER IS MANDATORY

The acceptance workflow MUST run in a **headed, visible browser window**.

The agent must be able to observe the actual rendered application.

Do NOT use:

```text
headless browser
API-only substitution
DOM-only synthetic execution without a visible browser
database-only verification
```

If Playwright MCP is used, do NOT pass:

```text
--headless
```

For this task, a browser that is technically automated but invisible is considered insufficient for the manual UX gate.

If the environment supports a headed browser but it is not currently enabled:

```text
enable/configure headed mode
→ verify a visible browser window/page opens
→ then begin acceptance
```

The final report MUST state:

```text
Browser mode = HEADED
```

If a headed browser cannot be launched despite browser tooling being available:

```text
Interactive GUI gate = BLOCKED
```

Do not claim full UX acceptance.

---

## 0B.2 SCREENSHOT CHECKPOINTS ARE REQUIRED

The agent MUST capture and persist a screenshot at every important acceptance checkpoint.

Screenshots are not optional decoration. They are test evidence.

At minimum capture screenshots at:

```text
S01 — Initial empty Complex state after reset/discovery

S02 — Complex successfully created

S03 — Complex name edit result

S04 — Complex address edit result

S05 — Complex after refresh + ESP32 rediscovery

S06 — Three GH visible after creation

S07 — GH-01 detail (KEEP case)

S08 — GH-02 edit form/detail before save

S09 — GH-02 edited result after save

S10 — GH-02 edited result after refresh + rediscovery

S11 — GH-03 detail before deletion

S12 — GH-03 deletion confirmation

S13 — Result immediately after GH-03 deletion / redirect

S14 — Old GH-03 URL showing safe not-found/redirect behavior

S15 — Final topology before browser state loss

S16 — Final topology after browser state cleared + reopen + ESP32 rediscovery
```

If a defect is found, also capture:

```text
BUG-<number>-BEFORE.png
BUG-<number>-AFTER.png
```

where appropriate.

---

## 0B.3 SCREENSHOT NAMING

Store screenshots in a dedicated test-evidence directory:

```text
artifacts/ux-acceptance/<run-id>/screenshots/
```

Do NOT store screenshots randomly throughout the repository.

Use deterministic names:

```text
S01_initial_empty.png
S02_complex_created.png
S03_complex_name_edited.png
S04_complex_address_edited.png
S05_complex_rediscovered.png
S06_three_gh_created.png
S07_gh01_keep.png
S08_gh02_edit_form.png
S09_gh02_edited.png
S10_gh02_rediscovered.png
S11_gh03_before_delete.png
S12_gh03_delete_confirmation.png
S13_gh03_deleted.png
S14_gh03_deleted_route.png
S15_final_before_storage_clear.png
S16_final_after_rediscovery.png
```

For bugs:

```text
BUG-001-before.png
BUG-001-after.png
```

The `<run-id>` should be unique for each acceptance execution.

---

## 0B.4 SCREENSHOT CONTENT REQUIREMENT

Each required screenshot must show enough of the rendered application to establish context.

Where practical, include:

```text
page title/header
relevant Complex/GH name
relevant action/result
route/address bar or equivalent route evidence
visible error state when reproducing a bug
```

Do not crop away all context.

For deleted-route tests, the screenshot should clearly show that the requested deleted entity is no longer valid.

---

## 0B.5 TEST LOG IS MANDATORY

Create a persistent test log for every acceptance run:

```text
artifacts/ux-acceptance/<run-id>/TEST_LOG.md
```

The log must record the actual chronological sequence.

For every important action record:

```text
timestamp
step ID
action
route
target entity ID
expected result
actual result
ESP32 verification
screenshot filename
status
```

Example:

```text
| Step | Action | Route | Entity | Expected | Actual | ESP32 Read-back | Screenshot | Status |
|------|--------|-------|--------|----------|--------|-----------------|------------|--------|
| C02 | Edit name | /complex/C001 | C001 | New name persists | New name visible | C001 = new name | S03 | PASS |
```

---

## 0B.6 BUG LOG IS MANDATORY

If any UX/route/state defect is discovered, record it in:

```text
artifacts/ux-acceptance/<run-id>/BUG_LOG.md
```

Each defect must contain:

```text
Bug ID
Timestamp
Route
Entity
Steps to reproduce
Expected behavior
Actual behavior
Console/network evidence
Root cause
Source files changed
Fix summary
Before screenshot
After screenshot
Retest result
```

Example:

```text
## BUG-001

Route:
 /complex/C001/gh/GH003

Problem:
Deleted GH route displayed stale detail instead of Not Found.

Root cause:
...

Fix:
...

Retest:
PASS

Before:
screenshots/BUG-001-before.png

After:
screenshots/BUG-001-after.png
```

---

## 0B.7 ACTION LOG MUST NOT BE FABRICATED

The agent must record what it actually did.

Do NOT write:

```text
PASS
```

because a route theoretically looks correct from source code.

PASS requires actual observed evidence from the running application.

Likewise:

```text
screenshot captured
```

must mean a real screenshot file exists.

If a screenshot could not be captured:

```text
status = BLOCKED
```

for that evidence item.

---

## 0B.8 CONSOLE / NETWORK EVIDENCE

During the headed browser run, inspect browser console/runtime errors and relevant failed network requests.

Record significant errors in:

```text
TEST_LOG.md
```

At minimum distinguish:

```text
console error
console warning
HTTP 4xx
HTTP 5xx
route 404
JavaScript exception
```

A non-impacting warning may be recorded without failing the test.

A runtime error that affects the tested flow must be investigated.

---

## 0B.9 FIX / RETEST EVIDENCE

When the agent finds an in-scope problem:

```text
capture BEFORE screenshot
↓
record BUG_LOG entry
↓
inspect source
↓
fix
↓
reload/restart as needed
↓
repeat the same browser interaction
↓
capture AFTER screenshot
↓
update BUG_LOG
↓
mark PASS only after successful retest
```

Do NOT erase the original failure evidence.

The point is to preserve:

```text
failure
→ fix
→ proof of fix
```

---

## 0B.10 FINAL EVIDENCE MANIFEST

Create:

```text
artifacts/ux-acceptance/<run-id>/EVIDENCE_MANIFEST.md
```

It must map every required acceptance step to its evidence.

Example:

```text
S01 → initial empty state
S02 → Complex creation
S03 → Complex name edit
...
S16 → final rediscovery
```

Also list:

```text
TEST_LOG.md
BUG_LOG.md
screenshots/*
```

The manifest must state whether every mandatory evidence item exists.

---

## 0B.11 RUN ID

Generate a unique run identifier at the beginning of the acceptance run.

Example:

```text
ux-acceptance-2026-09-21-001
```

Use the same run ID for:

```text
screenshots
TEST_LOG.md
BUG_LOG.md
EVIDENCE_MANIFEST.md
```

Do not overwrite evidence from a previous run.

---

## 0B.12 EVIDENCE MUST SURVIVE AGENT TERMINATION

All evidence must be written to files in the repository/working tree.

Do not rely exclusively on:

```text
chat output
temporary terminal scrollback
in-memory agent notes
browser session
```

The repository must contain the evidence after the agent finishes.


# 1. SCOPE — KEEP THIS SMALL

The current physical environment has one ESP32 and hardware components are not yet installed.

Therefore this acceptance test intentionally covers ONLY:

```text
Complex
Greenhouses (GH)
Topology discovery
CRUD
Routing
Refresh
Browser-state-loss recovery
ESP32 read-back
UX consistency
```

### IN SCOPE

```text
1 Complex
Complex name
Complex address

3 Greenhouses:
  GH-01 → KEEP
  GH-02 → EDIT
  GH-03 → DELETE

Complex/GH routes
Navigation
Direct URLs
Refresh
Back/Forward
Invalid IDs
Deleted-entity routes
ESP32 topology read-back
Browser topology recovery
```

### OUT OF SCOPE

Do NOT create, configure, or exercise:

```text
schedules
fertigation execution
well-pump schedules
fan schedules
dosing pumps
valves
sensors
calibration
telemetry
component mappings
actuator control
hardware-dependent runtime behavior
```

Do not create fake components merely to increase test coverage.

---

# 2. GOVERNING ARCHITECTURE

The expected architecture is:

```text
ESP32
= authoritative operational source for its owned Complex

System Topology Pool
= persistent topology registry

Backend
= coordination / processing / mirror / history

Browser
= ephemeral UI state/cache
```

The browser must NOT require persistent storage to reconstruct Complex/GH topology.

The intended recovery invariant is:

```text
Browser forgets everything
        ↓
connect/discover ESP32
        ↓
read topology
        ↓
reconstruct Complex/GH
```

A refresh must not force re-onboarding.

---

# 3. CRITICAL RESEARCH-DATA RULE

This test must not delete or mutate research data.

The following remain untouched:

```text
crop_cycles
plants
fruits
observations
```

Do not use destructive research operations as part of this test.

If the repository already contains research records, snapshot IDs/counts before the test and verify they remain unchanged after the test.

---

# 4. REQUIRED TOOL DISCOVERY — DO THIS BEFORE TESTING

Before beginning the acceptance flow, the agent MUST inspect the environment and discover which tools are available for real UI/browser interaction.

The agent must look for repository/environment-supported tools such as:

```text
browser automation
Playwright
Puppeteer
Chrome/Chromium automation
browser/devtools automation
screenshot/page inspection tools
terminal/dev-server tools
HTTP/API inspection tools
```

Use the tool discovery mechanism available in the agent environment.

Do NOT assume tool names.

Do NOT pretend a browser test happened if no browser/UI tool was actually used.

## Required behavior

1. Discover the available browser/UI automation capability.
2. Discover how to start the frontend/dev server.
3. Discover how to reach the ESP32/backend test environment.
4. Use the best available real UI tool.
5. Actually execute the workflow through the UI.

If a real browser/UI tool is unavailable:

```text
DO NOT invent a successful UX result.
```

Instead, perform the maximum real verification available and explicitly mark the manual browser gate as BLOCKED.

---

# 5. THIS IS EXPLORATORY TESTING, NOT JUST HAPPY-PATH TESTING

The agent must not merely follow the expected happy path.

It must actively look for:

```text
wrong links
wrong redirects
broken route params
stale UI state
stale cache
wrong entity after edit/delete
array-index identity bugs
duplicate records
refresh failures
stale backend data overriding ESP32
deleted entities reappearing
blank screens
JavaScript errors
race conditions in dialogs/forms
incorrect loading state
incorrect empty state
incorrect not-found state
```

When a defect is found:

```text
BUG FOUND
↓
trace source
↓
fix
↓
rerun scenario
↓
verify
```

The final report must list issues that were discovered and fixed.

---

# 6. EXACT ACCEPTANCE SCENARIO

The acceptance run MUST happen as a continuous lifecycle.

Do NOT reset the database between individual CRUD cases unless a reset is explicitly required to establish the initial state.

The purpose is to verify state transition over time.

Required sequence:

```text
RESET EXISTING TOPOLOGY
        ↓
VERIFY EMPTY VIA ESP32 DISCOVERY
        ↓
CREATE 1 COMPLEX
        ↓
EDIT COMPLEX NAME
        ↓
EDIT COMPLEX ADDRESS
        ↓
VERIFY COMPLEX
        ↓
REFRESH / REDISCOVER
        ↓
CREATE GH-01
        ↓
CREATE GH-02
        ↓
CREATE GH-03
        ↓
GH-01 KEEP
        ↓
GH-02 EDIT
        ↓
GH-03 DELETE
        ↓
ROUTE AUDIT
        ↓
REFRESH
        ↓
CLEAR BROWSER STATE
        ↓
REDISCOVER ESP32
        ↓
FINAL VERIFICATION
```

Do not silently change this sequence.

---

# 7. PHASE 0 — INVENTORY THE ACTUAL ROUTES

Before clicking through the application, inspect the repository route structure:

```text
src/app/**
```

and identify every route relevant to:

```text
Complex list
Complex detail
Complex edit
GH list
GH detail
GH edit
GH delete
```

Then compare this source-level route inventory with the routes exposed by the running application.

Do not assume documentation is correct.

The actual application route must be treated as ground truth for the UX test.

---

# 8. PHASE 1 — RESET EXISTING COMPLEX TOPOLOGY

Because the environment may already contain Complex data:

## Step 1

Use the real UI to delete all existing Complexes.

Do NOT directly delete database rows merely to prepare the test.

## Step 2

Refresh the UI.

## Step 3

Perform ESP32 topology discovery/read-back.

Expected:

```text
Complex count = 0
GH count = 0
```

If a deleted Complex reappears:

```text
STOP
diagnose
fix
repeat reset
```

Possible causes include:

```text
browser state
backend mirror
ESP32 stale topology
tombstone failure
incorrect reconciliation
```

Do not continue with a polluted topology.

---

# 9. PHASE 2 — CLEAR BROWSER STATE

After the ESP32 confirms an empty topology:

Clear the browser/application storage relevant to this app.

Inspect:

```text
localStorage
sessionStorage
cookies
IndexedDB
```

and ensure topology is not being restored from persistent browser storage.

Then reload/reopen the application.

Expected:

```text
topology remains empty
```

The UI must obtain that result from discovery, not from a stale client cache.

---

# 10. PHASE 3 — CREATE EXACTLY ONE COMPLEX

Because only one ESP32 is currently available, create:

```text
Complex Test
```

Use a deterministic test address:

```text
Test Address 001
```

The test must use the real product UI.

Verify:

```text
UI create form
→ submit
→ API
→ ESP32 authoritative topology
→ persistence
→ returned state
→ Complex list
```

Record:

```text
complexId
ownerDeviceId
name
address
poolRevision
poolHash
```

where available.

---

# 11. COMPLEX TEST — READ / ROUTE

After creation:

1. Verify Complex appears in the list.
2. Open Complex detail through normal UI navigation.
3. Open the detail route directly.
4. Refresh while on the detail route.
5. Use Back.
6. Use Forward.
7. Return to Complex list.

Verify:

```text
correct Complex
correct name
correct address
no blank screen
no duplicate Complex
no stale previous entity
```

---

# 12. COMPLEX TEST — EDIT NAME

Change:

```text
Complex Test
```

to:

```text
Complex Test Renamed
```

Use the real edit route/modal/drawer.

Verify:

```text
edit UI opens
→ correct Complex loaded
→ change name
→ save
→ UI updates
→ list updates
→ detail updates
→ ESP32 read-back updates
```

Then:

```text
refresh
→ discovery
→ read-back
→ verify new name
```

The old name must not return.

---

# 13. COMPLEX TEST — EDIT ADDRESS

Change:

```text
Test Address 001
```

to:

```text
Test Address 002
```

Repeat:

```text
open edit
→ change
→ save
→ list
→ detail
→ ESP32 read-back
→ refresh
→ rediscovery
```

The final authoritative value must be:

```text
Test Address 002
```

---

# 14. COMPLEX INVALID ROUTE TEST

Use the actual Complex route format and substitute a nonexistent `complexId`.

Example conceptually:

```text
/complex/<nonexistent-id>
```

Expected:

```text
not-found
OR
safe redirect
```

Not acceptable:

```text
blank screen
stale Complex Test
another Complex
JavaScript crash
```

---

# 15. PHASE 4 — CREATE EXACTLY THREE GH

Under the single Complex create:

```text
GH-01
GH-02
GH-03
```

Do not create component-dependent data.

Record:

```text
ghId-1
ghId-2
ghId-3
```

Verify:

```text
Complex
├── GH-01
├── GH-02
└── GH-03
```

The stable IDs must be used for subsequent operations.

Do not use array indexes as identity.

---

# 16. THREE GH = THREE DIFFERENT LIFECYCLE EXPERIMENTS

This is mandatory.

Do NOT perform identical CRUD on all three.

Use exactly:

```text
GH-01 = KEEP / CONTROL

GH-02 = EDIT / MUTATION TEST

GH-03 = DELETE / REMOVAL TEST
```

This is the acceptance pattern for the three experiments.

---

# 17. EXPERIMENT #1 — GH-01 KEEP

Create GH-01.

Then:

```text
open GH list
→ open GH detail
→ direct route
→ refresh
→ rediscovery
→ open detail again
```

Do NOT edit or delete GH-01.

Verify:

```text
same ghId
same name
same complexId
still present
route remains valid
```

This is the control/reference object.

---

# 18. EXPERIMENT #2 — GH-02 EDIT

Create GH-02.

Then:

```text
list
→ detail
→ edit route
→ edit name
→ save
→ detail
→ list
→ ESP32 read-back
→ refresh
→ rediscovery
→ detail
```

Change for example:

```text
GH-02
→ GH-02 Renamed
```

Verify:

```text
same ghId
same parent complexId
new name
old name absent
```

The changed value must survive:

```text
refresh
browser reopen
topology rediscovery
```

The change must be persisted authoritatively, not merely in frontend state.

---

# 19. EXPERIMENT #3 — GH-03 DELETE

Create GH-03.

Then:

```text
list
→ detail
→ delete
→ confirm
→ verify redirect
→ verify list
→ verify ESP32 topology
```

Expected:

```text
GH-03 absent
GH-01 present
GH-02 Renamed present
Complex remains
```

Do not reset the entire environment after deleting GH-03.

---

# 20. GH-03 DELETED ROUTE TEST

Capture the real route used for GH-03 before deletion.

After deletion, directly navigate to that old URL.

Expected:

```text
404/not-found
OR
safe redirect
OR
explicit entity-not-found UI
```

Not acceptable:

```text
old GH-03 detail appears
stale data appears
blank screen
runtime exception
GH-03 gets recreated
```

Then refresh the old URL again.

The deleted entity must remain unavailable.

---

# 21. GH CROSS-ISOLATION TEST

After deleting GH-03, verify:

```text
GH-01
→ unchanged

GH-02
→ still renamed

GH-03
→ absent
```

This is explicitly intended to detect bugs such as:

```text
delete by array index
delete wrong entity
edit wrong entity
shared-state mutation
parent collection replacement bug
```

If deletion of GH-03 modifies GH-01 or GH-02:

```text
BUG
→ fix
→ rerun entire affected sequence
```

---

# 22. PARENT / CHILD ROUTE INTEGRITY

Verify that:

```text
GH
```

always resolves against the correct:

```text
Complex
```

Try:

```text
valid GH
valid Complex
```

Then, where route structure allows, test:

```text
GH from Complex A under Complex B context
```

or equivalent invalid relationship.

Expected:

```text
not-found
OR
safe redirect
```

The UI must never display a GH under the wrong Complex.

---

# 23. LIST / DETAIL / EDIT NAVIGATION AUDIT

For every relevant route, verify BOTH directions:

## Navigation → route

Clicking UI navigation must reach the intended route.

## Route → valid UI

Opening the route directly must load the correct data.

Test:

```text
Complex list
Complex detail
Complex edit

GH list
GH detail
GH edit
```

The agent must record actual route paths from the running app.

Do not accept a source-level route declaration as proof that the UX navigation is correct.

---

# 24. BACK / FORWARD AUDIT

Test meaningful sequences such as:

```text
Complex list
→ Complex detail
→ GH list
→ GH detail
→ Back
→ Forward
```

After deleting GH-03:

```text
GH-03 detail
→ delete
→ redirect
→ Back
```

The browser must not restore a usable-looking deleted entity from stale history state.

If the browser shows stale content:

```text
fix route/state invalidation
→ repeat test
```

---

# 25. FULL REFRESH TEST

After CRUD is complete, current expected topology is:

```text
Complex Test Renamed
Address: Test Address 002

├── GH-01
└── GH-02 Renamed
```

GH-03 must be absent.

Perform a full page refresh from:

```text
Complex detail
GH-01 detail
GH-02 detail
Complex list
```

Each must reconstruct correctly.

---

# 26. COMPLETE BROWSER STATE LOSS TEST

This is one of the most important acceptance gates.

After reaching the final topology:

```text
Complex Test Renamed
Address: Test Address 002

├── GH-01
└── GH-02 Renamed
```

do all of the following:

```text
clear browser storage
close/reopen the application
```

Then:

```text
bootstrap/discover ESP32
→ retrieve topology
→ reconstruct UI
```

Expected EXACTLY:

```text
Complex Test Renamed
Address: Test Address 002

├── GH-01
└── GH-02 Renamed
```

Expected absent:

```text
GH-03
old Complex name
old Complex address
old GH-02 name
```

This proves browser state is not the persistent source of truth.

---

# 27. ESP32 READ-BACK IS MANDATORY

After important mutations, read the topology back from the ESP32 authoritative path.

Do not rely only on UI confirmation.

At minimum verify read-back after:

```text
Complex create
Complex name edit
Complex address edit
GH-01 creation
GH-02 edit
GH-03 deletion
final rediscovery
```

The following chain must be demonstrable:

```text
UI mutation
→ persisted authoritative state
→ read-back
→ same result in UI
```

---

# 28. BACKEND MIRROR CHECK

If the backend contains a topology mirror:

The live ESP32 state must not be silently overwritten by stale backend state.

Test conceptually:

```text
ESP32 = latest topology
Backend = older mirror
```

Expected current live topology:

```text
ESP32
```

If the backend mirror is stale, it should be:

```text
reconciled
OR
clearly treated as stale/non-authoritative
```

Do not allow stale backend state to resurrect GH-03 or revert GH-02.

---

# 29. EXPLORATORY UX DEFECT SEARCH

During the entire scenario, actively inspect for:

```text
wrong button target
wrong route target
missing back navigation
incorrect breadcrumb
incorrect parent name
stale title
stale list
stale detail
wrong entity after mutation
form showing previous entity's values
delete confirmation for wrong entity
duplicate API calls
double-submit
loading state that never ends
error state with no recovery
blank state that looks like missing data
not-found state missing
deleted route still rendering
refresh losing topology
refresh recreating topology
browser state contradicting ESP32
backend state overriding ESP32
```

These are not cosmetic-only findings if they cause users to navigate or operate on the wrong entity.

---

# 30. FIX-IN-PLACE RULE

This task is both:

```text
ACCEPTANCE TEST
+
REMEDIATION
```

If an in-scope defect is found:

```text
1. reproduce it
2. determine root cause
3. modify source
4. run relevant unit/integration checks
5. rerun the real UI scenario
6. verify the defect no longer occurs
```

Do not defer straightforward fixes to a later task.

Do not simply list known route bugs as "remaining issues" if the agent can fix them now.

---

# 31. DO NOT RESET BETWEEN BUG FIX ITERATIONS

When fixing a route/UX bug:

The agent may reset only the minimum state needed to reproduce cleanly, but whenever possible it should continue from the actual workflow state.

The final successful run must be a coherent end-to-end lifecycle.

---

# 32. TEST AUTOMATION

After the real UI acceptance run, add or update regression coverage for discovered failures.

Recommended location:

```text
scripts/test_topology_ux_acceptance.py
```

or the repository's existing test convention.

Automation should cover at least:

```text
empty topology
Complex create
Complex name edit
Complex address edit
GH create
GH edit
GH delete
deleted route handling
refresh/re-discovery
identity isolation
research retention
```

Do not use automated tests as a substitute for the real UI run when browser tooling is available.

---

# 33. ROUTE UX MAP

Create/update:

```text
docs/ROUTE_UX_MAP.md
```

Document actual routes discovered from both source and running application.

For each route record:

```text
route
purpose
parent
parameters
normal navigation entry
direct URL behavior
refresh behavior
back behavior
forward behavior
loading state
empty state
not-found state
deleted-entity behavior
topology dependency
```

Also document incorrect routes found and how they were fixed.

---

# 34. FINAL EXPECTED STATE

The test environment must finish with exactly:

```text
1 Complex

Complex name:
Complex Test Renamed

Complex address:
Test Address 002

Greenhouses:
GH-01
GH-02 Renamed
```

And:

```text
GH-03 = deleted / absent
```

No test-created schedules or component-dependent configuration should exist.

---

# 35. REQUIRED FINAL VERIFICATION

Perform one final complete rediscovery:

```text
clear browser topology state
→ reopen application
→ discover ESP32
→ read topology pool
→ reconstruct UI
```

Then verify:

```text
Complex = exactly 1
GH = exactly 2
```

With:

```text
Complex name = Complex Test Renamed
Complex address = Test Address 002
GH-01 = unchanged
GH-02 = renamed
GH-03 = absent
```

---

# 36. REQUIRED FINAL REPORT

Do not provide a generic "all tests passed" statement.

Report:

## A. Tools discovered

```text
browser tool
dev-server tool
API/HTTP tool
other relevant tool
```

State which were actually used.

## B. Environment

```text
frontend URL
backend endpoint
ESP32 endpoint
```

where relevant.

## C. Actual route map

List the exact routes tested.

## D. Real UI operations

Document:

```text
Complex create
Complex name edit
Complex address edit
GH-01 create/keep
GH-02 create/edit
GH-03 create/delete
```

## E. Defects found

For each defect:

```text
symptom
route
root cause
fix
retest result
```

## F. Read-back evidence

Show how ESP32 authoritative state was verified.

## G. Browser recovery evidence

Show how state was recovered after browser storage was cleared.

## H. Final topology

Show exact final state.

## I. Research retention

Show before/after counts or IDs, where available.

## J. Tests

Show exact commands and actual results.

Do not claim a test passed unless it actually ran.

## K. Remaining limitations

Clearly identify anything that could not be tested because physical hardware is not installed.

---

# 37. HARDWARE BOUNDARY

This task does NOT validate:

```text
GPIO behavior
pump behavior
valve behavior
sensor readings
calibration accuracy
fertigation execution
RF reliability under field conditions
electrical safety
```

Do not claim these are verified.

This task validates:

```text
Complex topology
GH topology
CRUD
routing
UX
refresh
discovery
browser-state recovery
ESP32 topology persistence
```

to the extent supported by the available environment.

---

# 38. SUCCESS CRITERIA

This task is PASS only when the agent has actually demonstrated:

```text
[ ] Real browser/UI capability discovered, enabled, and used in a VISIBLE HEADED browser
[ ] Existing Complexes removed through the real product flow
[ ] ESP32 confirms empty topology
[ ] Exactly 1 Complex created
[ ] Complex name edited successfully
[ ] Complex address edited successfully
[ ] Exactly 3 GH created
[ ] GH-01 retained successfully
[ ] GH-02 edited successfully
[ ] GH-03 deleted successfully
[ ] Deleted GH route is safely invalid
[ ] Complex/GH routes tested directly
[ ] Navigation routes tested
[ ] Refresh tested
[ ] Back/Forward tested
[ ] Invalid IDs tested
[ ] ESP32 read-back verified after mutations
[ ] Browser storage loss tested
[ ] Topology recovered through ESP32 discovery
[ ] GH-03 does not resurrect
[ ] GH-01 unaffected by GH-03 deletion
[ ] GH-02 edit survives rediscovery
[ ] Backend mirror does not override live ESP32
[ ] In-scope bugs were fixed and retested
[ ] Route UX map created/updated
[ ] Research data untouched
[ ] Final topology exactly matches expected state
[ ] All mandatory screenshots S01-S16 exist and are readable
[ ] TEST_LOG.md exists and records the complete chronological run
[ ] BUG_LOG.md exists and records every discovered defect/fix/retest
[ ] EVIDENCE_MANIFEST.md maps acceptance steps to stored evidence
```

---

# 39. FINAL PRINCIPLE

Do not optimize this task for producing a good-looking report.

Optimize it for proving that the system works when a human actually uses it.

The required mindset is:

```text
USE THE PRODUCT
        ↓
TRY TO BREAK THE UX
        ↓
FIND INCONSISTENCY
        ↓
FIX IT
        ↓
TRY AGAIN
        ↓
VERIFY AGAINST ESP32
        ↓
CLEAR BROWSER STATE
        ↓
DISCOVER AGAIN
        ↓
PROVE THE SYSTEM RECONSTRUCTS ITSELF
```

No screenshot/no log = no full PASS.

The final invariant is:

> **The browser is disposable. The topology is not.**

If the browser loses all state, the operator must still recover the correct Complex/GH topology from the ESP32 system without recreating the physical system.
