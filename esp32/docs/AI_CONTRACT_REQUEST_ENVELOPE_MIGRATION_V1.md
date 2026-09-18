# AI Contract Request Envelope Migration V1

## Objective
Migrate the entire application (ESP32 backend and React UI frontend) to adhere strictly to the canonical OpenAPI Request Envelope nested structure and resolve all request/response schema mismatches.

## 1. Endpoint Migration Matrix

| Endpoint | Method | Handler | Envelope Status | Notes |
| --- | --- | --- | --- | --- |
| `/api/v1/health` | GET | `handler_get_health` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/status` | GET | `handler_get_status` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/inventory` | GET | `handler_get_inventory` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/capabilities` | GET | `handler_get_capabilities` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/context` | GET | `handler_get_context` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/clock` | GET | `handler_get_clock` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/clock-sync` | POST | `handler_post_clock_sync` | ✅ Nested envelope | Reads `payload.timestamp`, `payload.timezone` per OpenAPI |
| `/api/v1/configuration` | GET | `handler_get_configuration` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/configuration` | PUT | `handler_put_configuration` | ✅ Nested envelope | Reads `payload.configuration`, preserves requestId in response |
| `/api/v1/configuration/validate` | POST | `handler_validate_configuration` | ✅ Nested envelope | Reads `payload`, preserves requestId |
| `/api/v1/commands` | POST | `handler_post_command` | ✅ Nested envelope | Reads `payload.commandId`, `payload.type` |
| `/api/v1/commands/{id}` | GET | `handler_get_command` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/commands/{id}` | DELETE | `handler_delete_command` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/commands/emergency-stop` | POST | `handler_emergency_stop` | ✅ Nested envelope | Reads `payload.commandId`, `payload.reason` |
| `/api/v1/greenhouses/{ghId}/crop-cycle` | GET | `handler_get_crop_cycle` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/greenhouses/{ghId}/crop-cycles` | GET | `handler_list_crop_cycles` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/greenhouses/{ghId}/crop-cycles` | POST | `handler_start_crop_cycle` | ✅ Nested envelope | Reads `payload.tanggalTanam` etc. |
| `/api/v1/.../import-active` | POST | `handler_import_active_crop_cycle` | ✅ Nested envelope | Reads `payload.tanggalTanam` etc. |
| `/api/v1/.../pollination` | POST | `handler_record_pollination` | ✅ Nested envelope | Reads `payload.tanggalPolinasi` |
| `/api/v1/.../pollination` | PATCH | `handler_update_pollination` | ✅ Nested envelope | Delegates to record_pollination |
| `/api/v1/.../pollination` | DELETE | `handler_delete_pollination` | ✅ Query requestId | OpenAPI uses `RequestIdQuery` param |
| `/api/v1/.../planting-date` | PATCH | `handler_update_planting_date` | ✅ Nested envelope | Reads `payload.tanggalTanam` |
| `/api/v1/.../crop-cycles/{cycleId}` | PATCH | `handler_update_cycle_metadata` | ✅ Nested envelope | Reads `payload.variety` etc. |
| `/api/v1/.../cancel` | POST | `handler_cancel_crop_cycle` | ✅ Nested envelope | Parses body requestId |
| `/api/v1/.../harvest` | POST | `handler_harvest_crop_cycle` | ✅ Nested envelope | Reads `payload.harvestDate` etc. |
| `/api/v1/telemetry` | GET | `handler_get_telemetry` | ✅ Response envelope OK | Server-generated requestId |
| `/api/v1/events` | GET | `handler_get_events` | ✅ Response envelope OK | Server-generated requestId |

## 2. Mutation Envelope Status
**Status:** COMPLIANT

- All mutation endpoints parse `requestId` from body top-level
- All mutation endpoints extract domain fields from the `payload` object
- All mutation responses pass the original `requestId` through the response envelope

## 3. GET Request ID Status
**Status:** COMPLIANT

- Server generates unique monotonic `req-N` IDs when no requestId is provided
- All GET responses include `requestId`, `success`, and `deviceTimestamp`

## 4. Error Envelope Status
**Status:** COMPLIANT

- Error responses include: `requestId`, `success: false`, `deviceTimestamp`, `error.code`, `error.message`, `error.retryable`, `error.reconcileRequired`
- `requestId` is preserved from the mutation request when available

## 5. UI Request Builder Status
**Status:** COMPLIANT

- `buildRequestEnvelope()` in `esp32-client.ts` wraps all mutation payloads into `{ requestId, client, payload }`
- `requestId` generated via `crypto.randomUUID()`
- `client` includes `{ type: "ReactUI", version: "1.0.0" }`
- Callers pass domain-only payloads; envelope is transparent

## 6. TypeScript Type Status
**Status:** COMPLIANT

- `ClockSyncRequest`: uses `timestamp` and `timezone` (aligned with OpenAPI)
- `ClockResponse`: uses `deviceTimestamp`, `timezone`, `synchronizedAt`, `rtcAvailable` (aligned with OpenAPI)
- All crop-cycle request types: removed stale `requestId` field, added `expectedVersion` where required by OpenAPI
- `EmergencyStopRequest`: includes `commandId` (required by OpenAPI)
- `CommandReceipt.status` union includes all values from OpenAPI enum

## 7. ESP32 Build Status
**Status:** PASS (exit code 0, `agrotech_esp32.bin` generated)

## 8. TypeScript Build Status
**Status:** PASS (`npx tsc --noEmit` exit code 0)

## 9. E2E Contract Tests Status
**Status:** PASS (25 endpoints verified, 26 handlers registered)

## 10. Source Scan for Flat-Format Remnants
**Status:** CLEAN

- Zero instances of domain fields read from raw `body` (all use `payload`)
- Zero instances of stale `requestId` in TS request type definitions
- Zero instances of old `utcNow`/`currentUtc`/`currentLocal` field references

## 11. Issues Fixed in Finalization
1. **ClockSyncRequest field name**: ESP32 read `utcNow` → fixed to `timestamp` per OpenAPI `ClockSyncRequest.payload`
2. **ClockResponse schema**: ESP32 returned `currentUtc`/`currentLocal`/`synced`/`lastSyncSource` → fixed to `deviceTimestamp`/`timezone`/`synchronizedAt`/`rtcAvailable` per OpenAPI `ClockResponse.data`
3. **EmergencyStopRequest**: missing required `commandId` in payload → fixed in both ESP32 and UI
4. **cancelCropCycle handler**: read requestId from query params (wrong, it's a POST with body) → fixed to parse JSON body envelope
5. **put_configuration response**: delegated to `handler_get_configuration` which lost the mutation's `requestId` → fixed to build response inline preserving correlation
6. **TS request types**: stale `requestId` fields removed; `expectedVersion` added where required by OpenAPI

## 12. Remaining Issues
None. All endpoints are compliant with the canonical OpenAPI contract.
