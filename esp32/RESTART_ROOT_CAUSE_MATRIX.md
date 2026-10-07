# ESP32 Restart Root Cause Matrix (Deep Audit)

## Consolidated from AUDIT-TFT-SENSOR + AUDIT-TASKS-HEAP-NET

## Proven Root Causes (P0 — must fix)

| # | Root Cause | File:line | Evidence | Impact | Fix |
|---|---|---|---|---|---|
| RC-1 | NVS write di dalam s_mutex scheduler | scheduler.c:964 (marker_update → persist_markers) + scheduler.c:1738 (portMAX_DELAY) | persist_markers melakukan nvs_set_blob 3.2KB + nvs_commit sambil hold s_mutex | Critical section 1-3s → IDLE Core 1 starve → TWDT reset | Async marker persist task |
| RC-2 | cJSON_Parse di process_dosing_queue dalam s_mutex | scheduler.c:1528, 1535 | cJSON_Parse(fertigation_payload_json 6KB) + cJSON_PrintUnformatted per dispatch | Heap churn ratusan node/detik di internal RAM → fragmentasi | Pre-compile command template saat deploy |
| RC-3 | persist_run cJSON+SD I/O per state transition | fertigation_mgr.c:166-415 (called at 17 sites) | cJSON tree 4-8KB + cJSON_PrintUnformatted + storage_mgr_append_fertigation_run (SD write 100-300ms) per transition | 30+ KB heap churn/detik saat dosing active | snprintf langsung ke buffer |
| RC-4 | reconnect_task stack 2048 terlalu kecil | network_mgr.c:562 | esp_wifi_connect + event_mgr_log (snprintf 512) call depth 6+ frame | Stack overflow → panic/reset | Stack → 4096 |
| RC-5 | cJSON_Parse berulang di sensor_hal_poll dalam s_sensor_lock | sensor_hal.c:356-475, 811-892 | poll_generic_sensor_inputs cJSON_Parse per sensor per 2s cycle, s_sensor_lock held | s_sensor_lock tertahan puluhan ms → block TFT/safety/HTTP | Pre-parse parameters saat registry load |
| RC-6 | tft_hal_init sebelum telemetry_mgr_init | main.c:160-161 vs 168-225 | tft_screen_task render home screen, draw_screen1_sensors call telemetry_mgr_get_snapshot tanpa cek return | Race condition → data sampah di layar detik pertama boot | Reorder init atau guard return value |

## Proven Root Causes (P1 — should fix)

| # | Root Cause | File:line | Evidence | Impact | Fix |
|---|---|---|---|---|---|
| RC-7 | Tidak ada task aplikasi daftar Task WDT | grep esp_task_wdt_* = 0 hits | IDLE Core 1 starve >5s → TWDT reset tanpa pesan task spesifik | Sulit diagnosa pasca-reset | Register scheduler/safety/fert/cmd_worker/telemetry ke TWDT |
| RC-8 | safety_monitor cJSON_Parse per aktuator per 500ms | safety_monitor.c:127 | cJSON_Parse(component->parameters_json) per aktuator per 500ms | 20 aktuator → 40 cJSON_Parse/detik → heap churn | Pre-parse safety params di registry |
| RC-9 | storage_mgr_activate_candidate hold s_config_mutex selama NVS+SPIFFS | storage_mgr.c:414-494 | portMAX_DELAY + malloc 16KB + NVS multi-write + SPIFFS write | Critical section 500ms-2s | Stage di RAM, release mutex, write, re-acquire |
| RC-10 | network_mgr_init state inconsistency bila xTaskCreate gagal | network_mgr.c:548-563 | s_wifi_started=true sebelum xTaskCreate; no cleanup bila gagal | Resource leak, state corrupt | Set flag setelah sukses, add cleanup |

## Proven Latent Hazards

| # | Hazard | File:line | Status | Action |
|---|---|---|---|---|
| LH-1 | DHT22 critical section 8ms (dead code, PIN=-1) | dht22.c:75-133 | Dead code today | Hapus dht22.c atau migrasi ke I2C (BME280) |
| LH-2 | GPIO 48 dual-purpose (SD_CS + WS2812) | sdcard_hal.c:31-91 | Only at boot | Restrict API to boot-only |
| LH-3 | SPI bus contention TFT vs SD | tft_hal.c:1432 + sdcard_hal.c:137 | By design | Accept; document |

## Proven Non-Issues (verified OK)

- TFT refresh frequency (1s dynamic, on-demand full redraw) — OK
- TFT render buffer size (static ≤256 byte) — OK
- TFT stack 5120 (cukup untuk call depth 7) — OK
- No heap alloc in TFT render path — OK
- No deadlock mutex (urutan acquire konsisten) — OK
- No task re-creation without deletion — OK
- No unbounded sensor retry — OK
- DS18B20 state machine non-blocking — OK

## Diagnostics to Add

1. Reset reason logger di main.c startup (esp_reset_reason_t)
2. Heap stats periodic log (free internal, largest block, free PSRAM) — every 60s
3. Stack high-water mark for all critical tasks — every 60s
4. Critical section duration instrumentation (scheduler_evaluate_at, persist_run, activate_candidate)

## Fix Priority Order

1. RC-4 (stack 2048→4096) — 1 line, immediate
2. RC-6 (init order) — reorder main.c
3. RC-7 (TWDT registration) — add esp_task_wdt_add to 5 tasks
4. RC-10 (network_mgr cleanup) — small fix
5. RC-1 (async marker persist) — new task + queue
6. RC-5 (sensor cJSON pre-parse) — refactor registry
7. RC-8 (safety cJSON pre-parse) — same refactor as RC-5
8. RC-3 (persist_run snprintf) — rewrite persist_run
9. RC-2 (pre-compile command template) — refactor scheduler
10. RC-9 (activate_candidate mutex release) — refactor storage_mgr
11. Diagnostics (reset reason + heap + stack monitoring)
12. Cleanup (dead code, duplicates)
