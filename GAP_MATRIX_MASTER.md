# Gap Matrix Master — PRD vs Kode (Konsolidasi Audit 2-A + 2-B + 2-C)

## CRITICAL Gaps (13 total — wajib selesai pertama)

### Frontend (6 CRITICAL)
| # | Gap | File:line | Spec Reference |
|---|---|---|---|
| F-C1 | Schedule compiler di frontend (dual authority dengan ESP32) | services.ts:1037 | PRD §19.4; SCHEDULING_SPEC §2.2 |
| F-C2 | UI synthesize dummy sensor_ph/ec | services.ts:1850-1876 | DYNAMIC_HARDWARE §4.1 L290 |
| F-C3 | Greenhouse Not Found card tidak ada | greenhouse/[ghId]/page.tsx:1077-1083 | ROUTE_UX_MAP §3.1 L41-47 |
| F-C4 | Resource locking tidak aktif (activeLocks selalu []) | services.ts:1037 | MIXING_FERTIGATION §10 L456-490 |
| F-C5 | Dosing pump hardcode A/B di 4+ file | canonicalHardwareBaseline.ts:76-108; contracts.ts:913,923-928; services.ts:1899-1901 | PRD §41 L3090; DYNAMIC_HARDWARE §3 |
| F-C6 | Hardcode "gh-01" di local-store-client | local-store-client.ts:771,796,814,834,857 | Gemini_Patching Rule 7 |

### ESP32 Firmware (5 CRITICAL)
| # | Gap | File:line | Spec Reference |
|---|---|---|---|
| E-C1 | Authorization Bearer `agrotech-secret-key` hardcoded di 39 endpoint | http_server.c:24-54 + 39 call sites | PRD-NET-001, ESP32_BACKEND_SPEC §8,§39 |
| E-C2 | Multi-GH fertigation preparation global single s_batch | fertigation_mgr.c:25, 1791-1801 | SCHEDULING_SPEC §14.4, MIXING_FERTIGATION §10 |
| E-C3 | Button 4 GPIO 41 dirampas DHT22 → Network Change Mode mati | pin_config.h:113 | NETWORK_CHANGE_MODE §Button 4 Gesture, FINAL_GPIO_AUDIT W-23 |
| E-C4 | expectedVersion diabaikan pada crop-cycle | crop_cycle_mgr.c:262,273,284,315; api_cropcycle_handlers.c:268-314 | ESP32_BACKEND_SPEC §28,§33 |
| E-C5 | Pathway B PCA9685 I2C untuk dosing C..G tidak ada driver | actuator_hal.c:322,359 (return NOT_SUPPORTED) | DYNAMIC_HARDWARE §3 Pathway B, PRD-FERT-004 |
| E-C6 | GPIO 18 = Error Lamp tapi di-mapped sebagai Buzzer (polaritas terbalik) | pin_config.h:74,76 | FINAL_GPIO_AUDIT Table A W-18 |

### Backend (3 CRITICAL)
| # | Gap | File:line | Spec Reference |
|---|---|---|---|
| B-C1 | Backend proxy UI↔ESP32 untuk operasi fisik (crop-cycle, commands, config) | server.py:962-985, 1281-1360, 1999-2019, 2189-2312 | SYSTEM_TOPOLOGY_POOL.md:6,53 |
| B-C2 | OpenAPI duplikasi path (schedule-intents, schedules/compiled) dan schema (Recipe) | UI_ESP32_OPENAPI.yaml:374-471 vs 1068-1160, 473-507 vs 1020-1066 | OpenAPI canonical |
| B-C3 | Legacy A/B chemistry masih di OpenAPI | yaml:2951,2964-2969,3043-3044,2907-2910 | PRD §8.6 L641 |

## HIGH Gaps (33 total — kerjakan setelah CRITICAL)

### Frontend HIGH (16)
- F-H1: complexes[0] fallback di 12+ lokasi (silent cross-Complex data leak)
- F-H2: AddWellPumpDrawer hardcode componentId "pump_well"
- F-H3: Schedule compiler compiledId non-deterministik (Date.now())
- F-H4: Mixing failure vs Delivery failure tidak dibedakan (event type)
- F-H5: Component lifecycle commissioning workflow tidak ada
- F-H6: Onboarding two-authority handshake (Python + ESP32) bypass
- F-H7: ConnectionMonitor audio base64 truncated (alarm bisu)
- F-H8: types.Esp32State tidak model 5 network lifecycle state
- F-H9: Network Change Mode tidak ada surface UI
- F-H10: Dosing abstraction masih tulis legacy dosingAml/dosingBml di banyak page
- F-H11: schedule/page.tsx display "A 0ml / B 0ml" menyesatkan untuk multi-dosing
- F-H12: greenhouse/[ghId] hardcode "Dosing A"/"Dosing B" di current run card
- F-H13: events page tidak scoped per-Complex
- F-H14: schedule compiler dua lokasi inconsistent (services.ts vs schedule-compiler.js)
- F-H15: No mDNS auto-resolve di onboarding
- F-H16: hardware-gateway.ts proxy pattern (mungkin dead code)

### ESP32 HIGH (12)
- E-H1: Schedule 5-state tidak diimplementasikan (hanya ACTIVE diterima)
- E-H2: BLOCKED reason eksplisit tidak di-emit
- E-H3: 12+ endpoint tambahan tidak terdokumentasi di OpenAPI
- E-H4: recipe_storage.c tidak atomic (no .tmp + fsync + size-verify + rename)
- E-H5: Lower-float & tamper input tidak configuration-driven (hardcode GPIO 38/47)
- E-H6: expectedVersion untuk compiled schedule deployment tidak divalidasi
- E-H7: timezone hardcoded "UTC" di /health & /status
- E-H8: manual_actuator_mgr pakai legacy enum (bukan component_id)
- E-H9: Lifecycle changes tidak persist ke NVS
- E-H10: Recovery NVS key fertigation single global (bukan per-GH)
- E-H11: Emergency-stop response tidak include safety state
- E-H12: panel_button_mgr pakai legacy enum

### Backend HIGH (5)
- B-H1: Bearer token default `agrotech-secret-key` di 10+ lokasi
- B-H2: Global Dosing Queue multi-GH tidak diimplementasikan (resource_manager.py)
- B-H3: Compiled schedule GET/DELETE endpoint missing
- B-H4: Schedule intents endpoint missing di backend
- B-H5: topology_pool.py pakai "BACKEND-MIRROR" sebagai ownerDeviceId (melanggar single-writer ESP32 rule)

## Execution Order (Dependency-Ordered)

```
Layer 1: ESP32 Auth Removal (E-C1) — BUKAN dependensi, blok semua UI flow
Layer 2: Pin Config Fix (E-C3, E-C6) — hardware kontrak, blok physical features
Layer 3: Multi-GH Fertigation Preparation (E-C2) — root cause "gagal multi-GH"
Layer 4: Dosing Dynamic (E-C5, F-C5, B-C3) — root cause "dosing hardcode"
Layer 5: Crop Cycle expectedVersion (E-C4)
Layer 6: Frontend Hardcode Removal (F-C6, F-C2, F-C3, F-C4)
Layer 7: Frontend Dosing Migration (F-C5 follow-up)
Layer 8: Backend Proxy Removal (B-C1)
Layer 9: OpenAPI Cleanup (B-C2)
Layer 10: HIGH fixes (per area)
Layer 11: Cleanup dead code
Layer 12: Build + regression
```
