# AI AGENT PROJECT INSTRUCTIONS

## Project
AgroTech Greenhouse Controller — ESP32-S3 + existing Vite/React UI.

## Repository authority
- Canonical shared API contract: `template/contracts/UI_ESP32_OPENAPI.yaml`
- ESP32 project root: `template/esp32/`
- Existing UI is protected existing work.
- ESP32 is runtime/physical authority.
- Python backend is not required for the direct UI ↔ ESP32 MVP.

## Safe-point / handover protocol
This repository is intentionally designed so another AI agent, another account, or another model can continue the work without the previous conversation.

Before substantial work:
1. Read this file.
2. Read `AI_PROGRESS.md`.
3. Read `AI_HANDOVER.md` if present.
4. Inspect `git status`.
5. Inspect the canonical contract and only the source relevant to the current task.
6. Do not redo completed safe points.

Before stopping:
1. Build/test the work.
2. Update `AI_PROGRESS.md`.
3. Update `AI_HANDOVER.md`.
4. Record changed files and reasons.
5. Record known issues and exact next action.
6. Create a Git commit at a stable safe point whenever the repository is in a buildable/testable state.

## Safe-point rules
A safe point is a verified repository state, not merely a completed thought or partial edit.

Each safe point must have:
- ID, e.g. `SP-001`
- objective
- completed work
- verification result
- changed files
- known issues
- next safe point / next action
- Git commit hash

If a task is interrupted before the safe point:
- mark it `PARTIAL`
- preserve the partial work
- document exactly what is complete and incomplete
- do not falsely mark the feature complete.

## Do not trust conversation memory
Project files are the durable handover mechanism. Do not assume knowledge from an earlier chat/session/account.

## UI protection
Do not redesign, visually restyle, restructure, or rewrite unrelated UI.
When integration requires UI changes:
- make the smallest change;
- prefer the existing service/API adapter boundary;
- preserve existing UX;
- document every changed UI file and why.

## Contract discipline
Do not silently invent or change endpoints, fields, enums, status codes, or response shapes.
If UI, OpenAPI, or firmware conflict:
1. stop;
2. identify the conflict;
3. resolve it explicitly;
4. update all affected layers and tests.

## Verification
Never report success because code merely looks correct.
Separate:
- build result;
- automated test result;
- API contract result;
- UI integration result;
- physical hardware result.

A software PASS does not mean physical hardware is verified.

## Hardware safety
Never invent electrical ratings, fuse values, wire gauges, relay ratings, sensor coefficients, or module-specific wiring details. Mark missing information `VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION`.

## Current task
Read `AI_PROGRESS.md` and continue only from the latest safe point.
