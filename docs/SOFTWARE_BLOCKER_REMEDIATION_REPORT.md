# SOFTWARE BLOCKER REMEDIATION REPORT

Date: 2026-09-19
Scope: Concrete findings from the final pre-migration forensic audit only. No physical commissioning, wiring, Python backend implementation, or authoritative hardware pin-map changes.

## Finding Closure

| Defect | Severity | Resolution | Verification | Status |
|---|---|---|---|---|
| DEF-UI-001 | CRITICAL | Canonical Complex status uses `Active`/`Inactive`; physical-capable GH operations require explicit selected GH; implicit first/array selection removed from operational paths; fail-closed negative coverage added. | `node scripts/test_software_blocker_remediation.mjs`; `npm test`; M5/M6; M11/M12; M17 | CLOSED |
| DEF-UI-002 | CRITICAL | `fertigationService.systemStatus(complexId, ghId?)` now returns a typed status object with explicit unavailable fields. | remediation gate + npm test | CLOSED |
| DEF-UI-003 | HIGH | Dashboard environment cards use canonical `EnvironmentMetric.current`; phantom helper removed. | remediation gate + TS source scan | CLOSED |
| DEF-UI-004 | HIGH | Observation UI/service/type contract aligned to `observationId` and `observedAt`. | remediation gate + M14/M15 | CLOSED |
| DEF-UI-005 | HIGH | ConnectionMonitor reads canonical ESP32 `device.complexId` and `sensors.temperatureC`, validates complex identity, and has no hidden alternate-field fallback. | remediation gate + npm test | CLOSED |
| DEF-SAFE-001 | HIGH / NOT VERIFIED | Repository shows reset-reason handling but no explicit project requirement/evidence for a duplicate application/task watchdog. No fake heartbeat added. Platform watchdog behavior remains a toolchain/hardware verification item. | source inspection + explicit rationale | NOT VERIFIED (WITH RATIONALE) |

## Production Files Changed

- `src/lib/types.ts`
- `src/lib/api/contracts.ts`
- `src/lib/services.ts`
- `src/app/page.tsx`
- `src/app/greenhouse/[ghId]/page.tsx`
- `src/app/events/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/research/page.tsx`
- `src/app/calibration/page.tsx`
- `src/app/schedule/page.tsx`
- `src/app/fertigation/page.tsx`
- `src/components/layout/AppSidebar.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/ConnectionMonitor.tsx`
- `src/components/ui/equipment/ComponentEditorModal.tsx`

## Verification/Test Files Added

- `scripts/test_software_blocker_remediation.mjs`

## Documentation Updated/Added

- `docs/SOFTWARE_BLOCKER_REMEDIATION_REPORT.md`
- `AI_PROGRESS.md`
- `AI_HANDOVER.md`

## Regression Evidence

- remediation gate: PASS
- `npm test`: PASS — 28 OpenAPI endpoints, 26 ESP32 handlers, direct REST contract tests
- M2: 26/26 PASS
- M3 configuration authority mock: 18 PASS / 0 FAIL / 1 BLOCKED (physical reboot)
- M3/M4 hardening: PASS
- M5/M6: PASS
- M7/M8 engine: 22 PASS
- M7/M8 backend: 7/7 PASS
- M9: 16/16 PASS
- M10: 31/31 PASS
- M10 backend proxy: 6/6 PASS
- M11/M12: 34 backend + 17 firmware-path PASS
- M13: PASS; history test PASS when run with repository `PYTHONPATH`
- M14/M15: PASS
- M16: PASS
- M17 software E2E: 28/28 PASS
- M17 hardware pin audit: PASS (source/static only; not physical proof)
- Python compileall: PASS
- forensic authority: 13/13 PASS

## Current Rescan

No operational `find(() => true)`, `greenhouses[0]`, `ghs[0]`, or `complexes[0]` remains in the production operational paths. The remaining `find(() => true)` is a dashboard-only view helper guarded by `allGreenhouses.length === 1`; it does not select a physical execution target.

Remaining indexed/default lookups are UI/data presentation helpers (for example a default crop option, device-standard selector after explicit device selection, schedule display, recipe list display) and are not physical authority.

No `currentMetricValue()` phantom helper, old `waterTemperatureC` consumer, `systemStatus() { return null; }`, or observation `id`/`at` UI contract remains in the affected production paths.

## Hardware SSOT

`docs/HARDWARE_WIRING_MAP.md` was not modified. SHA-256 remains:

`3c7d539ff1bb81017ff95606324de45187c25dee31131d1f4eebcf3bb106e73f`

Known hardware-contract blockers remain unchanged:
- W-15 identity ambiguity: ZJ-B1 vs YF-B1.
- No dedicated physical E-stop mapping in the authoritative map.

## Build / Toolchain

- `npm ci`: TIMEOUT in current environment; no dependency upgrade performed.
- `npx tsc -b`: BLOCKED/FAIL due incomplete dependency tree (`@types/babel__*`, `@types/estree`, `@types/node`, `@types/react`, `@types/react-dom`). This is environment/dependency state, not treated as proof of source correctness.
- `npx vite build`: BLOCKED in the same incomplete dependency environment.
- `idf.py build`: BLOCKED — ESP-IDF toolchain unavailable.
- Node: v22.16.0
- npm: 10.9.2

## Handover Verdict

SOFTWARE INTEGRITY: PASS for the concrete blocker set remediated here.
SAFETY SOFTWARE: PASS for implemented local safety path; custom application watchdog remains NOT VERIFIED with rationale.
BUILD: BLOCKED BY ENVIRONMENT.
HARDWARE INTERFACE SOFTWARE: PASS against the authoritative pin map at source/static level.
HARDWARE CONTRACT: PARTIAL/BLOCKED by W-15 identity ambiguity and unspecified physical E-stop mapping.
SOFTWARE HANDOVER: READY.

This report does not claim physical hardware verification or physical commissioning.
