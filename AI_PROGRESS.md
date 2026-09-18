# AI PROGRESS

## CURRENT STATUS
- **Milestone 7 (M7)**: COMPLETED - Topology & Capability Engine
- **Milestone 8 (M8)**: COMPLETED (REMEDIATED & VERIFIED) - Schedule Compiler
- **Milestone 9 (M9)**: READY TO START - Schedule & Action Dispatch Engine

## LATEST SAFE POINT
**ID**: `SP-M8-REMEDIATION-COMPLETE`
**Objective**: Complete M8 Schedule Compiler remediation according to 21-point Corrected Architecture Gate.

## COMPLETED WORK
1. **Canonical Compiler Authority**:
   - Implemented `server/compiler/ScheduleCompiler.ts` as the sole canonical Schedule Compiler.
   - Pure server-side execution consuming authoritative `ConfigurationPayload` candidate snapshot.
   - Zero client-side, browser, or `localStorage` dependencies.
   - Re-exported via `src/lib/services/ScheduleCompiler.ts` for frontend type/preview parity.
2. **Buffer & Resource Ceiling Harmonization**:
   - Standardized ceiling to 16 across all layers: `PRODUCT_MAX_RESOLVED_RESOURCES` = 16, `MAX_SCHED_RESOLVED_RESOURCES` = 16 in `scheduler.h`, `CFG_MAX_RESOLVED_RESOURCES` = 16 in `configuration_mgr.h`.
   - Firmware buffer overflow eliminated (`ESP_ERR_INVALID_SIZE` returned on res_count > 16).
3. **Firmware Runtime & Command Manager Encapsulation**:
   - Direct raw scheduled GPIO toggling completely removed from `scheduler.c`.
   - Added `CMD_TYPE_FERTIGATION_RUN` in `command_mgr.h` & `command_mgr.c` carrying recipe snapshot and configuration version, routing to `fertigation_mgr_start_batch()`.
   - Runtime configuration matching enforced in `scheduler.c`: `sched->configuration_version == s_active_config.version`.
4. **Candidate Deployment & Legacy Rejection**:
   - `POST /api/v1/schedules` permanently deprecated and returns HTTP 405 Method Not Allowed (`api_schedule_handlers.c`).
   - Schedules deploy strictly via M4 candidate deployment pipeline (`/api/v1/configuration/candidate` -> `/apply`).
   - Firmware `apply_candidate` atomically promotes `VALIDATING` schedules to `ACTIVE`.
5. **PRD 6-State Lifecycle Enforced**:
   - `DRAFT`, `VALIDATING`, `ACTIVE`, `BLOCKED`, `DISABLED`, `INVALID`.
   - Only `ACTIVE` schedules are eligible for dispatch by `scheduler_task`.
6. **Frontend Fixes**:
   - Fixed `src/components/ui/primitives.tsx` (`StatusBadge` optional children) and `src/components/ui/equipment/AssignmentManager.tsx` (`ConfirmDialog` props).
   - Clean production build verified: `npx tsc -b && vite build` (0 errors, 8.54s).
7. **Canonical Documentation**:
   - Updated `contracts/UI_ESP32_OPENAPI.yaml` (`ScheduleItem`, `CompiledSchedule`, `BlockedReasonCode`, 405 on POST).
   - Updated `UI_ESP32_COMMUNICATION_SPEC.md` with Section 51 documenting Schedule Compiler and deployment architecture.

## VERIFICATION RESULT
- **Typecheck & Production Build**: `tsc -b && vite build` -> **0 errors, code 0**.
- **M8 Production Test Suites (6/6 PASS)**:
  - `scripts/test_m8_production_compiler.mjs`: 24/24 PASS.
  - `scripts/test_m8_version_semantics.mjs`: 18/18 PASS (Tests A-F).
  - `scripts/test_m8_boundary_safety.mjs`: 17/17 PASS.
  - `scripts/test_m8_multi_gh.mjs`: 13/13 PASS.
  - `scripts/test_m8_deployment.mjs`: 8/8 PASS.
  - `scripts/test_m8_runtime_eligibility.mjs`: 12/12 PASS.
  - **Total M8 Test Assertions: 92/92 PASS (100%)**.
- **Regression Test Suites**:
  - `scripts/test_m2_hardware_management.mjs`: 26/26 PASS.
  - `scripts/test_m3_configuration_authority.mjs --mock`: 18/18 PASS.
  - `scripts/verify_e2e_contracts.mjs`: 25/25 OpenAPI routes match, 26/26 ESP32 HTTP handlers registered.

## KNOWN ISSUES
- Physical execution on physical ESP32 hardware board pending bench testing (software/simulator verification PASS).

## NEXT ACTION
- Handover to **Milestone 9 (M9)**: Schedule & Action Dispatch Engine.

