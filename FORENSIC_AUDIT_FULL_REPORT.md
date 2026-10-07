# LAPORAN FORENSIK AUDIT FIRMWARE ESP32-S3 — FULL SUBSYSTEM SWEEP

**Task ID:** FORENSIC-AUDIT-FULL
**Target:** `/home/z/my-project/upload/ui-template/esp32/`
**Mode:** Read-only audit (TIDAK mengubah kode)
**Bahasa:** Indonesia

---

## Bagian 1 — Executive Summary (10 Temuan Paling Kritis)

| # | Temuan | Risk | Bukti Kode |
|---|--------|------|------------|
| 1 | `safe_boot_actuators()` TIDAK mengonfigurasi `PIN_OUT_BUZZER` (GPIO 18). Buzzer active-high bisa menyala sebentar saat boot sebelum `actuator_hal_init()` dijalankan (~1s window). | CRITICAL | `main.c:52-62` (buzzer absent dari array) vs `pin_config.h:74` (PIN_OUT_BUZZER=18) |
| 2 | `network_mgr_init()` pada kegagalan `esp_wifi_init`/`esp_wifi_start` tidak memanggil `esp_wifi_deinit()`, tidak unregister event handlers, tidak cleanup mDNS. State WiFi tidak konsisten untuk retry berikutnya. | HIGH | `network_mgr.c:544-547, 578-581` |
| 3 | `storage_mgr_append_event_log()` dan `storage_mgr_append_fertigation_run()` menahan mutex (`s_event_mutex`/`s_fertigation_mutex`) selama fopen+fprintf SD card (100ms–2s). Memblokir semua event log call dari task lain. | HIGH | `storage_mgr.c:744-766, 887-897` |
| 4 | `marker_persist_task` di scheduler tidak terdaftar ke Task WDT dan menggunakan `xTaskNotifyWait(portMAX_DELAY)`. Jika tidak ada notifikasi, task block selamanya tanpa WDT trigger. | HIGH | `scheduler.c:494-503` |
| 5 | `rtc_ds3231_init()` tidak memiliki guard terhadap pemanggilan ganda. `i2c_driver_install` akan gagal `ESP_ERR_INVALID_STATE` pada init kedua. | MEDIUM | `rtc_ds3231.c:30-55` |
| 6 | `command_mgr.c::active_config_has_gh` mengalokasikan `calloc(1, 16384)` setiap kali memvalidasi command (hot path untuk command HTTP). cJSON_Parse juga dilakukan. ~16KB heap churn per command. | MEDIUM | `command_mgr.c:110-134` |
| 7 | `TASK_HTTP_SERVER_STACK` = 8192 di `system_config.h:27` meng-override `CONFIG_HTTPD_DEFAULT_TASK_STACK_SIZE=4096` di sdkconfig. Komentar sdkconfig menyesatkan. | MEDIUM | `system_config.h:27` vs `sdkconfig.defaults:44` |
| 8 | Dosing queue (`s_dosing_queue`) hanya di RAM. Reboot kehilangan semua entry PENDING/DISPATCHED. Hanya marker (NVS) yang bertahan. | MEDIUM | `scheduler.c:138, 1574-1583` |
| 9 | `actuator_hal_emergency_stop()` mencoba menyalakan `ACTUATOR_ERROR_LAMP` (GPIO -1, unmapped). Lampu error tidak pernah menyala saat E-Stop; hanya buzzer GPIO 18 yang aktif. | MEDIUM | `actuator_hal.c:634-637`, `pin_config.h:76` |
| 10 | `network_mgr` memanggil `ESP_ERROR_CHECK(esp_wifi_set_config(...))` di `set_ap_config_with_ssid`/`apply_sta_config`. Jika WiFi dalam state tidak konsisten setelah partial failure, ini bisa panic. | MEDIUM | `network_mgr.c:159, 234` |

---

## Bagian 2 — TAHAP 0: Baseline

### 2.1 Git Status
Repository `/home/z/my-project/upload/ui-template` **bukan git repository** (`fatal: not a git repository`). Tidak ada commit hash/branch yang dapat diverifikasi. Audit dilakukan pada snapshot file sebagai-adanya.

### 2.2 ESP-IDF Version
- `idf_component.yml`: `idf version: '>=4.1.0'`, dependency `espressif/mdns: ^1.11.3`
- Komentar kode di `main.c:142` dan `scheduler.c:122` mereferensikan **ESP-IDF 5.5.5** (5.x features: `esp_task_wdt_reconfigure` dengan struct config, `portENTER_CRITICAL(&spinlock)` wajib argumen).
- Target: `CONFIG_IDF_TARGET="esp32s3"` (`sdkconfig.defaults:2`)

### 2.3 File Inventory (CMakeLists.txt)
Total **42 source files** terdaftar di `esp32/main/CMakeLists.txt`:
- **main/**: `main.c`
- **hal/** (9): `actuator_hal.c`, `sensor_hal.c`, `dht22.c`, `button_hal.c`, `hardware_registry.c`, `sdcard_hal.c`, `rtc_ds3231.c`, `tft_hal.c`
- **network/**: `network_mgr.c`
- **storage/** (6): `storage_mgr.c`, `telemetry_store.c`, `recipe_storage.c`, `crop_history_storage.c`, `export_mgr.c`
- **services/** (14): `command_mgr.c`, `safety_monitor.c`, `scheduler.c`, `crop_cycle_mgr.c`, `telemetry_mgr.c`, `event_mgr.c`, `fertigation_mgr.c`, `offline_sync_mgr.c`, `manual_actuator_mgr.c`, `transfer_mgr.c`, `topology_capability.c`, `topology_pool.c`, `calibration_mgr.c`, `panel_button_mgr.c`
- **http/** (12): `http_server.c`, `setup_handlers.c`, `api_device_handlers.c`, `api_config_handlers.c`, `api_command_handlers.c`, `api_cropcycle_handlers.c`, `api_telemetry_handlers.c`, `api_calibration_handlers.c`, `api_schedule_handlers.c`, `api_fertigation_handlers.c`, `api_recipe_handlers.c`, `api_export_handlers.c`

### 2.4 GPIO Assignment Table

| GPIO | Nama | Fungsi | Konfig |
|------|------|--------|--------|
| 0 | PIN_BTN_MODE | BOOT/MODE button | Input, pull-up, ISR disable |
| 1 | PIN_OUT_WELL_PUMP | Relay Well Pump | Output, active-LOW |
| 2 | PIN_OUT_DIST_PUMP | Relay Distribution Pump | Output, active-LOW |
| 4 | PIN_OUT_RAW_SUBMERSIBLE | Relay Raw Submersible | Output, active-LOW |
| 5 | PIN_OUT_DOSING_A | Relay Dosing A | Output, active-LOW |
| 6 | PIN_OUT_DOSING_B | Relay Dosing B | Output, active-LOW |
| 7 | PIN_OUT_COOLING_FAN | Relay Cooling Fan | Output, active-LOW |
| 8 | PIN_I2C_SDA | I2C SDA (DS3231) | OD, pull-up, 100kHz |
| 9 | PIN_I2C_SCL | I2C SCL (DS3231) | OD, pull-up, 100kHz |
| 10 | PIN_OUT_BLOWER_FAN | Relay Blower Fan | Output, active-LOW |
| 11 | PIN_SPI_SCK | SPI2 SCK (shared) | SPI bus |
| 12 | PIN_SPI_MOSI | SPI2 MOSI (shared) | SPI bus |
| 13 | PIN_SPI_MISO | SPI2 MISO (shared) | SPI bus |
| 14 | PIN_TFT_CS | TFT ST7735 CS | SPI device CS |
| 15 | PIN_IN_FLOW_RAW_ZJB1 | Flow meter ZJ-B1 | Input, pull-up, ISR negedge |
| 16 | PIN_IN_FLOW_FERT_FS400A | Flow meter FS400A | Input, pull-up, ISR negedge |
| 17 | PIN_IN_TEMP_DS18B20 | DS18B20 1-Wire | Input, pull-up |
| 18 | PIN_OUT_BUZZER | MOSFET Buzzer | Output, active-HIGH |
| 21 | PIN_TFT_DC | TFT Data/Command | Output |
| 38 | PIN_IN_FLOAT_LOWER | Lower Float Switch | Input, pull-up |
| 39 | PIN_BTN_MANUAL_A | Manual A Button | Input, pull-up |
| 40 | PIN_OUT_MIXING_PUMP | Relay Mixing Pump | Output, active-LOW |
| 41 | PIN_IN_DHT22 | DHT22 Data | Input/Output OD, pull-up |
| 42 | PIN_TFT_RST | TFT Reset | Output |
| 47 | PIN_IN_TAMPER_LOOP | Anti-theft loop | Input, pull-up (OK=0 closed-to-GND) |
| 48 | PIN_SD_CS | MicroSD CS + Onboard WS2812 LED | Output (dual-purpose via RMT pulse) |
| -1 | PIN_OUT_ERROR_LAMP | Unmapped | N/A (buzzer handles alarm) |
| -1 | PIN_BTN_RESERVED | Disabled (GPIO 41 owned by DHT22) | N/A |

**Reserved pins** (`pin_config.h:134`): 3, 19, 20, 26–37, 43–46, 22–25 (unbonded).
**No GPIO conflicts detected** antara actuator/sensor/bus.

### 2.5 sdkconfig.defaults — Key Settings

| Setting | Value | Catatan |
|---------|-------|--------|
| `CONFIG_IDF_TARGET` | esp32s3 | |
| `CONFIG_SPIRAM` | y (octal, auto) | PSRAM 8MB |
| `CONFIG_SPIRAM_USE_MALLOC` | y | malloc boleh ke PSRAM |
| `CONFIG_SPIRAM_ALLOW_BSS_SEG_EXTERNAL_MEMORY` | y | BSS boleh di PSRAM (EXT_RAM_BSS_ATTR) |
| `CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL` | 0 | SEMUA malloc → PSRAM by default |
| `CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP` | y | WiFi/LWIP boleh PSRAM (tetapi RX buffer tetap internal DMA) |
| `CONFIG_FREERTOS_HZ` | 1000 | 1ms tick |
| `CONFIG_HTTPD_DEFAULT_TASK_STACK_SIZE` | 4096 | **Di-override** jadi 8192 oleh `TASK_HTTP_SERVER_STACK` di kode |
| `CONFIG_HTTPD_MAX_REQ_HDR_LEN` | 1024 | |
| `CONFIG_HTTPD_WS_SUPPORT` | y | WebSocket untuk telemetry stream |
| `CONFIG_MDNS_TASK_STACK_SIZE` | 3072 | |
| `CONFIG_LWIP_MAX_SOCKETS` | 8 | ~1.5KB internal per socket |
| `CONFIG_ESP_MAIN_TASK_STACK_SIZE` | 8192 | app_main task |
| `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE` | 4096 | |
| `CONFIG_HEAP_POISONING_DISABLED` | y | **Risk**: heap corruption tidak terdeteksi |
| Partitions | nvs 24KB, ota_0/1 3MB, spiffs 9MB | |

### 2.6 Init Order (main.c:128-327)

```
1. sdcard_hal_clear_onboard_led()         — GPIO 48 WS2812 OFF (RMT pulse)
2. safe_boot_actuators()                  — 8 actuator GPIOs → safe OFF (BUZZER TIDAK TERMASUK)
3. esp_task_wdt_reconfigure(10s, panic)   — TWDT 10s timeout
4. esp_reset_reason() log
5. print_system_diagnostics()
6. init_nvs() ESP_ERROR_CHECK
7. esp_netif_init() ESP_ERROR_CHECK
8. esp_event_loop_create_default() ESP_ERROR_CHECK
9. storage_mgr_init() ESP_ERROR_CHECK     — NVS + SPIFFS
10. network_mgr_init() graceful           — WiFi (offline mode jika gagal)
11. hardware_hal_init_all() ESP_ERROR_CHECK — SPI bus + actuator + sensor + button
12. sdcard_hal_init()                     — Mount SD card (no abort)
13. recipe_storage_init()
14. setenv("TZ","WIB-7") + tzset()
15. rtc_ds3231_init() + sync_to_system()
16. event_mgr_init() ESP_ERROR_CHECK
17. command_mgr_init() ESP_ERROR_CHECK
18. manual_actuator_mgr_init() ESP_ERROR_CHECK
19. transfer_mgr_init() ESP_ERROR_CHECK
20. calibration_mgr_init() ESP_ERROR_CHECK
21. safety_monitor_init() ESP_ERROR_CHECK
22. scheduler_init() ESP_ERROR_CHECK
23. panel_button_mgr_init() ESP_ERROR_CHECK
24. fertigation_mgr_init() ESP_ERROR_CHECK
25. storage_mgr_set_safe_boot_active(false) ESP_ERROR_CHECK
26. crop_cycle_mgr_init() ESP_ERROR_CHECK
27. telemetry_mgr_init() ESP_ERROR_CHECK
28. offline_sync_mgr_init() ESP_ERROR_CHECK
29. topology_pool_init() ESP_ERROR_CHECK
30. tft_hal_init() graceful               — TFT (degraded headless jika gagal)
31. http_server_start() graceful          — HTTP (continues jika gagal)
32. xTaskCreatePinnedToCore(diagnostics_task, "diag_task", 3072, prio 1, core 0)
```

---

## Bagian 3 — AUDIT A–J

### AUDIT A — Boot Sequence + ESP_ERROR_CHECK

**Daftar lengkap ESP_ERROR_CHECK di main.c:**

| File:Line | Function | Jika gagal | Acceptable? | Rekomendasi |
|-----------|----------|------------|-------------|-------------|
| `main.c:95` | `nvs_flash_erase()` (inside init_nvs recovery) | Panic/abort | YES (NVS recovery path) | OK |
| `main.c:180` | `init_nvs()` | Panic | YES (storage fundamental) | OK |
| `main.c:181` | `esp_netif_init()` | Panic | YES (network fundamental) | OK |
| `main.c:182` | `esp_event_loop_create_default()` | Panic | YES | OK |
| `main.c:200` | `storage_mgr_init()` | Panic | YES (NVS+SPIFFS) | OK |
| `main.c:232` | `hardware_hal_init_all()` | Panic | **NO** — fungsi selalu return ESP_OK (degraded); ESP_ERROR_CHECK tidak akan pernah trigger | Hapus ESP_ERROR_CHECK, ganti dengan graceful handling |
| `main.c:241` | `event_mgr_init()` | Panic | YES | OK |
| `main.c:275-282` | command/manual/transfer/calibration/safety/scheduler/panel/fertigation mgr_init | Panic | YES — semua runtime services | OK |
| `main.c:288` | `storage_mgr_set_safe_boot_active(false)` | Panic | YES | OK |
| `main.c:291-294` | crop_cycle/telemetry/offline_sync/topology_pool init | Panic | YES | OK |

**Sensor_hal.c ESP_ERROR_CHECK:**
| `sensor_hal.c:528,544,556` | `gpio_config()` untuk flow/float/tamper | Panic | YES — pin compile-time constant; tidak akan gagal kecuali hardware rusak | OK |

**Network_mgr.c ESP_ERROR_CHECK:**
| `network_mgr.c:159` | `esp_wifi_set_config(WIFI_IF_AP, &cfg)` | Panic | **NO** — dipanggil dalam path yang mungkin terjadi setelah partial WiFi init failure | Ganti dengan graceful error handling |
| `network_mgr.c:234` | `esp_wifi_set_config(WIFI_IF_STA, &cfg)` | Panic | **NO** — sama di atas | Sama |

**Init order dependencies:**
- ✅ NVS sebelum storage_mgr (storage_mgr butuh NVS)
- ✅ netif+event_loop sebelum WiFi (network_mgr butuh keduanya)
- ✅ WiFi sebelum hardware_hal (HEAP-FIX: WiFi butuh ~30KB internal sebelum tasks lain)
- ✅ storage_mgr sebelum hardware_registry (hardware_hal_init_all baca config dari storage)
- ✅ event_mgr sebelum semua runtime services (mereka log events)
- ✅ safety_monitor sebelum scheduler (scheduler cek `safety_monitor_allows_scheduler`)
- ✅ scheduler sebelum fertigation_mgr (fertigation butuh scheduler correlation IDs)
- ✅ TFT setelah semua runtime (butuh getter data valid) — komentar `main.c:296-297`
- ✅ HTTP server paling akhir (butuh semua handler siap)

**Race conditions / partial failures:**
- `command_mgr_init` create task `cmd_worker` yang langsung `xQueueReceive(s_cmd_queue, ...)` — queue sudah dibuat sebelum task, aman.
- `safety_monitor_init` create task `safety_mon` yang langsung `esp_task_wdt_add(NULL)` lalu loop — `s_mutex` sudah dibuat di init sebelum xTaskCreate, aman.
- `scheduler_init` create `scheduler_task` setelah `s_initialized = true` (line 2117). Tapi marker_persist_task dibuat setelah scheduler_task. Jika scheduler_task mulai evaluate sebelum marker_persist_task handle diset, `xTaskNotifyGive(NULL)` di `marker_update` aman karena handle di-cache di `s_marker_persist_task_handle` yang di-NULL-check di caller. **MINOR**: 1-tick window di mana marker_persist_task belum running tapi scheduler sudah update marker → notifikasi hilang. RISK: LOW (persist akan di-retrigger di marker_update berikutnya).

---

### AUDIT B — RAM/Heap/PSRAM

**Alokasi dynamic utama** (lihat Root Cause Matrix untuk detail):

1. **Storage config deploy** (`storage_mgr.c:303,439,500,594`): `malloc(16384)` ×4 — PSRAM (MALLOC_ALWAYSINTERNAL=0), freed. Hot path: config deploy.
2. **HTTP body parse** (`http_server.c:232`): `malloc(total_len+1)` max 16KB — PSRAM, freed. Hot path: per HTTP request.
3. **Command normalize** (`command_mgr.c:110`): `calloc(1, 16384)` — PSRAM, freed. Hot path: setiap command submission.
4. **Hardware registry load** (`hardware_registry.c:293`): `calloc(32, sizeof(hw_component_info_t))` — ~16KB, PSRAM, freed. Hot path: config deploy.
5. **Scheduler parse** (`scheduler.c:626,698,2075,2082`): `calloc` 4-12KB — PSRAM, freed. Init-time.
6. **cJSON trees**: ratusan alokasi kecil (~36B per node) di seluruh HTTP handler — PSRAM (post HEAP-FIX). Hot path.

**Static BSS arrays >1KB:**

| Array | Lokasi | Size | RAM type |
|-------|--------|------|----------|
| `s_active_components[32]` | `hardware_registry.c:15` | ~16KB | **Internal RAM** (no EXT_RAM_BSS_ATTR) |
| `s_component_runtime[64]` | `actuator_hal.c:50` | ~4KB | Internal |
| `s_flow_watch[64]` | `safety_monitor.c:47` | ~6KB | Internal |
| `s_daily_history` (288 slots) | `telemetry_store.c:39` | ~9KB | Internal |
| `s_batch_buffer[32]` | `telemetry_store.c:35` | ~2KB | Internal |
| `s_runtime[16]` | `scheduler.c:110` | ~4KB | **PSRAM** (EXT_RAM_BSS_ATTR) |
| `s_markers[16]` | `scheduler.c:112` | ~3KB | PSRAM |
| `s_today_occurrences[32]` | `scheduler.c:134` | ~3KB | PSRAM |
| `s_dosing_queue[8]` | `scheduler.c:138` | ~1KB | PSRAM |
| `s_cache[32]` command_item_t | `command_mgr.c:32` | **~128KB+** (struct besar) | PSRAM |
| `s_marker_snapshot[16]` | `scheduler.c:500` | ~3KB | PSRAM |

**cJSON di hot paths** (post-fix):
- `sensor_hal_poll` (2s): ✅ menggunakan `parsed_params` cache (RC-5), fallback cJSON_Parse hanya jika cache invalid
- `safety_monitor_task` (500ms): ✅ menggunakan `safety_params` cache (RC-8), fallback cJSON_Parse hanya jika cache invalid
- `persist_run` (200ms task): ✅ menggunakan snprintf (RC-3), bukan cJSON — fallback cJSON hanya jika buffer 4096 overflow
- `scheduler_evaluate_at` (1s): ✅ baca dari `s_runtime[]` yang sudah parsed di deploy time
- `process_dosing_queue` (1s): ⚠️ masih `cJSON_Parse(sched->fertigation_payload_json)` saat dispatch (scheduler.c:1609) — tapi hanya sekali per dispatch, bukan per tick

**Task stack total:** ~93KB (lihat Task Inventory).

---

### AUDIT C — FreeRTOS Tasks + WDT

(Detail lengkap lihat Bagian 5 — Task Inventory)

**WDT-registered tasks** (5): `safety_mon`, `cmd_worker`, `scheduler`, `fert_mgr`, `telemetry_sampler`. Semuanya memanggil `esp_task_wdt_reset()` setiap iterasi dengan bounded delay. ✅ Aman.

**Tidak WDT-registered** (14+): `diag_task`, `btn_poll_task`, `mk_persist`, `tele_persist_task`, `telem_store_tsk`, `tele_stream_task`, `tft_screen_task`, `transfer_mgr`, `offline_sync`, `manual_actuator`, `calib_mgr`, `net_reconnect`, `cmd_component`, HTTPD server task.

**Blocking `portMAX_DELAY` yang berisiko:**

| File:Line | Call | Task | WDT? | Risk |
|-----------|------|------|------|------|
| `scheduler.c:503` | `xTaskNotifyWait(0,0xFFFFFFFF,NULL,portMAX_DELAY)` | mk_persist | NO | HIGH — block selamanya jika tidak ada notifikasi |
| `actuator_hal.c:83,200,270,...` | `xSemaphoreTake(s_lock, portMAX_DELAY)` | Multiple (HTTP, scheduler, fert, safety) | NO (per caller) | MEDIUM — jika s_lock di-held lama oleh caller lain |
| `storage_mgr.c:376,452,564,641,...` | `xSemaphoreTake(s_config_mutex, portMAX_DELAY)` | HTTP handler thread | NO | MEDIUM — RC-9 fix mengurangi window, tetap ada Stage 1/3 |
| `safety_monitor.c:178,228,362,371,385,403,543,561` | `xSemaphoreTake(s_mutex, portMAX_DELAY)` | safety_mon + HTTP | YES untuk safety_mon | LOW — safety_mon feeds WDT sebelum take |
| `command_mgr.c:549` | `xQueueReceive(s_cmd_queue, &cmd, pdMS_TO_TICKS(2000))` | cmd_worker | YES | LOW — bounded 2s, WDT feed setelah |
| `telemetry_store.c:508` | `ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5000))` | telem_store_tsk | NO | LOW — bounded 5s |
| `tft_hal.c:1376` | `ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000))` | tft_screen_task | NO | LOW — bounded 1s |
| `network_mgr.c:410` | `ulTaskNotifyTake(pdTRUE, wait_ticks)` — wait_ticks bounded 500ms atau 50s | net_reconnect | NO | MEDIUM — 50s block; jika NVS write lag di dalam task ini, tidak ada WDT |

---

### AUDIT D — WiFi Lifecycle

| Pertanyaan | Jawaban | Bukti | Status |
|------------|---------|-------|--------|
| `network_mgr_init()` bisa dipanggil 2x? | YES — `if (s_wifi_started) return ESP_OK;` | `network_mgr.c:511` | PROVEN safe |
| `esp_wifi_deinit()` dipanggil pada failure? | **NO** — hanya pada reconnect_task creation failure | `network_mgr.c:596-598` | PROVEN risk |
| `reconnect_task` di-delete pada failure? | N/A — task belum dibuat saat failure terjadi | `network_mgr.c:594-599` | PROVEN safe |
| Duplicate netifs? | NO — guarded `if (!s_sta_netif)` / `if (!s_ap_netif)` | `network_mgr.c:520-525` | PROVEN safe |
| `esp_wifi_init` gagal — state konsisten? | **NO** — netifs + event handlers + mDNS sudah ter-create, tidak di-cleanup | `network_mgr.c:543-547` | LIKELY risk |
| Event handlers unregistered pada failure? | **NO** — `esp_event_handler_register` tidak di-reverse | `network_mgr.c:550-556` | PROVEN risk |
| mDNS cleanup pada failure? | **NO** — `init_mdns` tidak ada reverse path | `network_mgr.c:558-561` | PROVEN risk |

**Init flow yang bisa meninggalkan state tidak konsisten:**
```
network_mgr_init()
├── esp_netif_create_default_wifi_sta()   → s_sta_netif diset
├── esp_netif_create_default_wifi_ap()    → s_ap_netif diset
├── generate_provisioning_identity()      → s_prov_ssid diset
├── esp_wifi_init(&cfg)                   → GAGAL di sini? netifs tetap, no deinit
├── esp_event_handler_register(*)         → 4 handler register
├── init_mdns()                           → mDNS init
├── load_sta_credentials()                → s_sta_provisioned diset
├── esp_wifi_set_mode()                   → mode set
├── esp_wifi_start()                      → GAGAL di sini? semua di atas tetap, no deinit
└── xTaskCreate(reconnect_task)           → GAGAL di sini? esp_wifi_stop + deinit dipanggil
```

**Rekomendasi:** Tambahkan cleanup path lengkap (esp_wifi_stop, esp_wifi_deinit, esp_event_handler_unregister, mdns_free, netif destroy) di setiap failure exit.

---

### AUDIT E — HTTP Server

| Pertanyaan | Jawaban | Bukti |
|------------|---------|-------|
| Stack size HTTP server? | **8192** byte (TASK_HTTP_SERVER_STACK dari system_config.h:27, override sdkconfig 4096) | `http_server.c:292` |
| Bisa gagal start? | YES — `httpd_start` bisa return `ESP_ERR_HTTPD_TASK` (task alloc gagal), `ESP_ERR_NO_MEM`, `ESP_ERR_INVALID_ARG` | `http_server.c:302-306` |
| Semua routes terdaftar? | YES — 32+ routes inline + register_api_* untuk calibration/schedule/fertigation/recipe/export + register_setup_handlers + telemetry_stream_init. Total ~68 endpoint sesuai `contracts/UI_ESP32_OPENAPI.yaml` | `http_server.c:308-452` |
| Handler crash handling? | httpd menangkap exception per-connection; koneksi di-close, server tetap jalan. Tetapi stack corruption akan crash firmware. | ESP-IDF default behavior |
| `max_uri_handlers` | 80 (cukup untuk ~68 endpoint) | `http_server.c:291` |
| `core_id` | 0 (HTTP di core 0, terpisah dari safety/scheduler di core 1) | `http_server.c:294` |
| `max_open_sockets` | 10 | `http_server.c:295` |
| `lru_purge_enable` | true (purge LRU socket jika penuh) | `http_server.c:297` |
| `recv_wait_timeout` / `send_wait_timeout` | 5s / 5s | `http_server.c:298-299` |
| Auth? | `http_check_auth` = no-op (MVP, trusted local network). Peer auth (`http_check_auth_peer`) wajib untuk `/topology-pool/sync` & `/mutate` | `http_server.c:24-92` |
| CORS? | `Access-Control-Allow-Origin: *` — semua origin diizinkan | `http_server.c:96` |

**Catatan OpenAPI:** File `UI_ESP32_OPENAPI.yaml` di root TIDAK berisi endpoint `/api/v1/fertigation/*`. File `contracts/UI_ESP32_OPENAPI.yaml` berisi. Firmware mengikuti `contracts/` versi. Pastikan UI/frontend juga mengikuti `contracts/` versi.

---

### AUDIT F — Scheduler → Command → Fertigation

| Pertanyaan | Jawaban | Bukti | Status |
|------------|---------|-------|--------|
| Scheduler dispatch saat cmd_worker masih proses? | **NO** — `process_dosing_queue` cek `fert_st == FERT_STATE_IDLE` sebelum submit; head->state di-latch ke DISPATCHED setelah submit | `scheduler.c:1593-1639` | PROVEN safe |
| `fertigation_mgr_start_from_json` saat batch running? | **NO** — `if (s_state != FERT_STATE_IDLE) return ESP_ERR_INVALID_STATE;` | `fertigation_mgr.c:2272-2275` | PROVEN safe |
| Dosing queue pada reboot? | **LOST** — `s_dosing_queue` RAM-only, tidak persist ke NVS | `scheduler.c:138, 1574-1583` | PROVEN risk |
| Recovery hold pada reboot? | **YES** — `restore_recovery()` di `fertigation_mgr_init` baca dari NVS; scheduler marker RUNNING → RECOVERY_HOLD di hydrate | `fertigation_mgr.c:2239, 863-913`; `scheduler.c:461-469` | PROVEN safe |
| `persist_run` dari multiple tasks? | **NO** — hanya dipanggil dari `task()` di fertigation_mgr.c (single task) | grep `persist_run(` menunjukkan semua caller di `task()` | PROVEN safe |
| `persist_recovery` dari multiple tasks? | **NO** — hanya dari `transition()` di `task()` context | `fertigation_mgr.c:914-929` | PROVEN safe |
| Scheduler dispatch command sambil previous masih running? | Tidak — `dispatch_runtime_schedule` mengecek `sched->running` sebelum dispatch; set `running=true` setelah submit | `scheduler.c:722-729, 1957-1984` | PROVEN safe |
| Config deploy saat schedule running? | **NO** — `scheduler_deploy_compiled_json` cek `s_runtime[i].running`, block dengan `SCHEDULE_DEPLOY_BLOCKED_ACTIVE_RUN` | `scheduler.c:722-729` | PROVEN safe |
| Resource lock conflict antar schedule? | YES — `s_resource_locks` serialize akses ke shared resource (pump/valve). Scheduler acquire sebelum dispatch, release setelah complete/fail | `scheduler.c:113, 1959, 1987` | PROVEN safe |

---

### AUDIT G — HAL + Sensors + GPIO

| Pertanyaan | Jawaban | Bukti | Status |
|------------|---------|-------|--------|
| Konflik GPIO? | **NO** — semua 27 GPIO aktif (0,1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,21,38,39,40,41,42,47,48) unik per fungsi | `pin_config.h` + cross-check | PROVEN safe |
| Sensor disconnect → freeze? | **NO** — DHT22 return `ESP_ERR_TIMEOUT` (bounded 120us per phase), sensor_hal marks `SENSOR_STATE_UNAVAILABLE`. DS18B20 reset return `ESP_ERR_NOT_FOUND`, marks `SENSOR_STATE_DISCONNECTED`. Tidak ada infinite retry. | `dht22.c:108-128`, `sensor_hal.c:161-162, 672` | PROVEN safe |
| SPI bus sharing TFT + SD? | YES — keduanya di SPI2_HOST. TFT pakai `spi_device_polling_transmit` (acquires bus per transaction). SD card pakai SDSPI host (internal bus mutex). ESP-IDF SPI bus mutex handle arbitration. TFT TIDAK panggil `sdcard_hal_lock` — relies on bus-level mutex only. | `tft_hal.c:159, 172, 182`; `sdcard_hal.c:137-145` | LIKELY safe |
| DHT22 critical section removed? | **YES** — `portMUX_TYPE s_dht22_mux` dihapus. Tidak ada `portENTER_CRITICAL` di data phase. Read terjadi dengan interrupt enabled. CRC check + 3s retry menangani bit corruption dari ISR. | `dht22.c:11-28, 89-99` | PROVEN safe |
| DHT22 0 = valid temperature? | **YES** — comment `dht22.c:177-178` eksplisit: "0.0 is explicitly VALID". Range check `-40C to 80C` dan `0-100% RH`. 0.0 di-accept. | `dht22.c:179-185` | PROVEN safe |
| DS18B20 range check off-by-one? | MINOR — `if (*out_temp <= -55.0f || *out_temp >= 125.0f)` menggunakan `<=` dan `>=` (bukan `<` dan `>`). Spesifikasi DS18B20: -55 to +125. Nilai persis -55.0 atau +125.0 ditolak. | `sensor_hal.c:172` | POSSIBLE minor |
| GPIO 47 pull-up untuk tamper? | YES — `gpio_config_t tamper_conf.pull_up_en = GPIO_PULLUP_ENABLE` di sensor_hal_init | `sensor_hal.c:551-556` | PROVEN safe |
| WS2812 di GPIO 48 (juga SD CS)? | YES — dual-purpose. `ws2812_clear` mengirim 24 bit '0' via RMT, lalu reset pin ke output HIGH untuk SD CS. RMT pulse tidak mempengaruhi SD card (CS high = inactive). | `sdcard_hal.c:31-91, 191-197` | PROVEN safe |
| ISR service installed? | YES — `gpio_install_isr_service(0)` di sensor_hal_init. Jika sudah installed (ESP_ERR_INVALID_STATE), return value diabaikan. | `sensor_hal.c:531` | PROVEN safe |
| TFT mulai sebelum semua subsistem ready? | TFT init di main.c:298 SETELAH semua runtime services. TFT task baca dari getter yang sudah valid. | `main.c:296-302` | PROVEN safe |

---

### AUDIT H — Actuator Safety

| Pertanyaan | Jawaban | Bukti | Status |
|------------|---------|-------|--------|
| Semua actuator output safe-off di boot? | **PARTIAL** — 8 actuator (WELL_PUMP, DIST_PUMP, RAW_SUBMERSIBLE, DOSING_A/B, COOLING_FAN, BLOWER_FAN, MIXING_PUMP) di-safe-off. **BUZZER (GPIO 18) TIDAK di list**. ERROR_LAMP = -1 (skip). | `main.c:52-62` vs `pin_config.h:74` | PROVEN risk — buzzer bisa false-trigger |
| Code path aktivasi actuator tanpa cek safety? | **NO** — `actuator_hal_set` dan `actuator_hal_set_by_component_id` cek `s_emergency_stop_latched` (L202, L278), `lifecycle_state` (L225, L292), `ACTUATOR_OWNER_SAFETY` lock (L309). `safety_monitor_authorize_component` cek tambahan. | `actuator_hal.c:195-362`, `safety_monitor.c:418-512` | PROVEN safe |
| WiFi fail → actuator? | **NO IMPACT** — actuators tetap safe-off. Scheduler & fertigation tetap jalan lokal. Tidak ada code path yang activate actuator berdasarkan WiFi state. | `main.c:215-225, 318-319` | PROVEN safe |
| HTTP server fail → actuator? | **NO IMPACT** — actuators tetap safe-off. Scheduler & fertigation tetap jalan. | `main.c:306-311` | PROVEN safe |
| Reboot after power loss → actuator? | **SAFE** — `safe_boot_actuators()` jalan PERTAMA di app_main (line 134). ESP_RST_BROWNOUT di-log sebagai event CRITICAL. E-Stop latch di-restore dari NVS (`storage_mgr_get_estop`). | `main.c:134, 242-246`, `actuator_hal.c:122-125` | PROVEN safe |
| Recovery dari RECOVERY_HOLD aktivasi actuator? | **NO** — `safety_monitor_request_recovery` cek tamper+temp+float, clear fault_latched, panggil `actuator_hal_resume()` (hanya clear lock, TIDAK turn-on actuator). | `safety_monitor.c:514-565` | PROVEN safe |
| Tamper loop GPIO 47 pull-up? | YES — `pull_up_en = GPIO_PULLUP_ENABLE`. `TAMPER_LOOP_OK=0` (closed to GND). Cut loop → pin reads 1 → E-Stop IMMEDIATE. | `sensor_hal.c:551-556`, `pin_config.h:105,109`, `safety_monitor.c:240-242` | PROVEN safe |
| Buzzer di E-Stop? | YES — `actuator_hal_emergency_stop` set `ACTUATOR_BUZZER.state=true` dan drive GPIO 18 HIGH. Buzzer berbunyi saat E-Stop. | `actuator_hal.c:638-641` | PROVEN safe |
| Error lamp di E-Stop? | **NO** — `ACTUATOR_ERROR_LAMP.gpio = -1` (unmapped). `if (...gpio >= 0)` guard men-skip. Error lamp TIDAK menyala. Hanya buzzer. | `actuator_hal.c:634-637`, `pin_config.h:76` | PROVEN risk — visual alarm missing |
| Lower float dry-run interlock? | YES — `actuator_hal_set` cek `gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY` sebelum izinkan DIST_PUMP ON. Juga di `actuator_hal_set_by_component_id` untuk role DISTRIBUTION_PUMP. | `actuator_hal.c:208-214, 284-290` | PROVEN safe |
| Max runtime enforcement? | YES — `safety_monitor_task` cek `runtime_sec > max_runtime` setiap 500ms, force-off jika exceed. Default: pump 900s, fan 1800s, dosing 300s, valve 300s. | `safety_monitor.c:25-29, 293-298` | PROVEN safe |
| Flow timeout enforcement? | YES — `safety_monitor_task` cek `flow_watch` (pulse delta) dalam `flow_timeout` (default 30s). Jika no flow detected, force-off + fault. | `safety_monitor.c:300-324` | PROVEN safe |

---

### AUDIT I — Storage

| Pertanyaan | Jawaban | Bukti | Status |
|------------|---------|-------|--------|
| SD card tidak mounted → apa yang terjadi? | Telemetry log: skip (return ESP_OK, buffer ke RAM). Event log: fallback ke SPIFFS `/spiffs/events.log`. Fertigation run log: fallback ke SPIFFS. Recipe save: return `ESP_ERR_NOT_FOUND`. TelemetryStore flush: return `ESP_ERR_NOT_FOUND`, buffer tetap di RAM. | `storage_mgr.c:774-779, 746, 888`; `recipe_storage.c:171-174`; `telemetry_store.c:258-262` | PROVEN safe |
| Atomic write (.tmp + rename)? | **PARTIAL** — `recipe_storage_save` menggunakan `.tmp` + `fflush` + `fsync` + `fclose` + stat-verify + `rename` (POSIX atomic). `crop_history_storage_archive_cycle` pola serupa. **Event log, telemetry log, fertigation run log: HANYA `fopen("a")` + `fprintf`** — tidak atomic, tapi append-only single-line; partial line dapat dideteksi parser. | `recipe_storage.c:182-232`; `storage_mgr.c:757-764, 791-799, 891-894` | PROVEN partial |
| NVS write fail silently? | **PARTIAL** — `storage_mgr_init` cek error untuk `dev_id`, `cplx_id`, `hostname` (return ESP_FAIL). Tapi `boot_cnt` (`nvs_set_u32`) TIDAK di-check (L135). `nvs_commit` di banyak tempat TIDAK di-check. | `storage_mgr.c:106-128, 135` | PROVEN risk minor |
| Pending events saat SD full? | `storage_mgr_append_event_log` rotate (unlink) jika `> MAX_EVENT_LOG_BYTES_SD` (512KB). Jika rotate gagal (read-only card), `fopen` gagal, return ESP_FAIL. Event HILANG (tidak buffer). | `storage_mgr.c:751-767` | PROVEN risk |
| Mutex saat NVS write? | `storage_mgr_set_estop` hold `s_nvs_mutex` selama NVS write. `storage_mgr_append_*` hold `s_event_mutex`/`s_telemetry_mutex`/`s_fertigation_mutex` selama SD card fopen+fprintf. RC-9 fix decouple `s_config_mutex` dari NVS write (Stage 2 outside mutex). | `storage_mgr.c:950-971, 744-766, 780-802, 887-897, 422-634` | PROVEN risk — event/telemetry/fertigation mutex held during SD I/O |
| SPIFFS format_if_mount_failed? | YES — `format_if_mount_failed = true` di `storage_mgr_init`. Jika SPIFFS corrupt, auto-format. | `storage_mgr.c:181` | PROVEN safe |
| SD card mount retry? | NO — `sdcard_hal_init` mencoba mount sekali. Jika gagal, `s_sd_mounted = false` permanent sampai reboot. | `sdcard_hal.c:145-169` | POSSIBLE risk — no runtime remount |
| NVS namespace partition | 24KB (`partitions.csv: nvs 0x6000`) | Cukup untuk ~key-value config | OK |

---

### AUDIT J — TFT + Telemetry

| Pertanyaan | Jawaban | Bukti | Status |
|------------|---------|-------|--------|
| TFT task interfere SD card writes? | **NO** — TFT pakai `spi_device_polling_transmit` (acquires SPI bus per transaction, short). SD card pakai SDSPI (internal bus mutex). Bus arbitration otomatis. TFT TIDAK panggil `sdcard_hal_lock`. TFT task prio 2 (low) — tidak preempt SD caller. | `tft_hal.c:159, 172, 182`; `sdcard_hal.c:177-189` | LIKELY safe |
| TFT baca stale data? | **NO** — TFT init di main.c:298 SETELAH semua runtime services. TFT task baca `actuator_hal_is_emergency_stopped()`, `time()`, dll yang return current value. | `main.c:298-302`; `tft_hal.c:1362-1378` | PROVEN safe |
| Telemetry snapshot consistent? | **YES** — `telemetry_sampler_task` take `s_snap_mutex` (L576), copy snapshot ke local var (L612), give mutex. `sensor_hal_get_readings` juga take `s_sensor_lock`. Tidak ada partial read. | `telemetry_mgr.c:576-613` | PROVEN safe |
| Telemetry values 0 atau negative? | **OK** — `snapshot_to_record` copy raw values. `update_daily_cache_from_record` validate via flags (TEMP_*_VALID). 0.0 dan negative (untuk suhu) acceptable. DHT22 0.0 eksplisit valid. | `telemetry_store.c:92-128, 130-198`; `dht22.c:177-185` | PROVEN safe |
| TFT refresh rate? | 1s cadence (`ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000))`) | `tft_hal.c:1376` | OK |
| TFT task priority? | 2 (low) — tidak mengganggu safety/scheduler/fertigation (prio 4-7) | `tft_hal.c:1532` | OK |
| TFT stack size? | 5120 byte | `tft_hal.c:1532` | OK |
| Telemetry sampler cadence? | 2s (`vTaskDelay(pdMS_TO_TICKS(2000))`) | `telemetry_mgr.c:664` | OK |
| Telemetry ring buffer capacity? | `TELEMETRY_RING_CAPACITY` (tidak dilihat di sini, tapi RAM bounded). Drop counter `s_dropped_samples` jika penuh. | `telemetry_mgr.c:638-649` | OK |
| Telemetry daily history 288 slot? | YES — `TELEMETRY_DAILY_SLOTS` (5-min interval × 288 = 24h). RAM cache di `s_daily_history`. | `telemetry_store.c:39, 86` | OK |

---

## Bagian 4 — Root Cause Matrix

| ID | Modul | Temuan | Risk | Bukti Kode | Reproduksi | Status | Rekomendasi |
|----|-------|--------|------|------------|-------------|--------|-------------|
| RC-01 | main.c / safety | Buzzer GPIO 18 tidak di-safe_boot_actuators | CRITICAL | `main.c:52-62` (buzzer absent dari output_pins[]) | Boot dengan buzzer terhubung; observe buzzer selama ~1s sebelum actuator_hal_init | PROVEN | Tambahkan `PIN_OUT_BUZZER` ke array di `main.c:52` |
| RC-02 | network_mgr | esp_wifi_deinit tidak dipanggil pada failure esp_wifi_init/start | HIGH | `network_mgr.c:543-547, 577-581` | Force esp_wifi_init gagal (corrupt WiFi config); reboot; WiFi state tidak reset | PROVEN | Tambah cleanup path: esp_wifi_stop + esp_wifi_deinit + unregister event handlers + mdns_free |
| RC-03 | network_mgr | Event handlers tidak unregister pada failure | HIGH | `network_mgr.c:550-556` | Sama dengan RC-02; handler register tapi WiFi tidak start → handler orphaned | PROVEN | Tambah `esp_event_handler_unregister` di failure path |
| RC-04 | network_mgr | mDNS tidak cleanup pada failure | MEDIUM | `network_mgr.c:558-561` | init_mdns berhasil tapi esp_wifi_start gagal → mDNS tetap advertise | PROVEN | Tambah `mdns_free()` di failure path |
| RC-05 | storage_mgr | s_event_mutex di-held selama SD card fopen+fprintf | HIGH | `storage_mgr.c:744-766` | Trigger event log saat SD card write lambat (200ms+); semua task yang log event akan block | PROVEN | Decouple: copy event JSON ke buffer under mutex, write to SD outside mutex |
| RC-06 | storage_mgr | s_fertigation_mutex di-held selama SD card fopen+fprintf | HIGH | `storage_mgr.c:887-897` | persist_run selama SD write lambat; cmd_worker block di command_mgr_notify_fertigation_status | PROVEN | Sama dengan RC-05 |
| RC-07 | scheduler | marker_persist_task portMAX_DELAY tanpa WDT | HIGH | `scheduler.c:494-503` | Jika tidak ada marker_update selama 60s+, task block forever tanpa WDT trigger | LIKELY | Tambah WDT register ATAU ganti portMAX_DELAY ke bounded timeout (60s) |
| RC-08 | rtc_ds3231 | Tidak ada guard double-init | MEDIUM | `rtc_ds3231.c:30-55` | Panggil rtc_ds3231_init 2x; i2c_driver_install gagal ESP_ERR_INVALID_STATE | PROVEN | Tambah `if (s_ds3231_initialized) return ESP_OK;` |
| RC-09 | command_mgr | active_config_has_gh alloc 16KB per command | MEDIUM | `command_mgr.c:110-134` | Submit 10 command HTTP berturut-turut; heap churn 160KB+ | PROVEN | Cache active gh list di RAM saat config deploy |
| RC-10 | system_config | TASK_HTTP_SERVER_STACK 8192 override sdkconfig 4096 | MEDIUM | `system_config.h:27` vs `sdkconfig.defaults:44` | Build firmware; httpd task stack = 8192 (bukan 4096) | PROVEN | Update sdkconfig comment atau samakan nilai |
| RC-11 | scheduler | Dosing queue RAM-only, lost pada reboot | MEDIUM | `scheduler.c:138, 1574-1583` | Submit dosing batch, reboot sebelum complete; entry hilang | PROVEN | Persist dosing_queue ke NVS (blob) atau recovery hold marker |
| RC-12 | actuator_hal | ERROR_LAMP unmapped (-1); E-Stop visual alarm missing | MEDIUM | `actuator_hal.c:634-637`; `pin_config.h:76` | Trigger E-Stop; buzzer berbunyi tapi lamp tidak menyala | PROVEN | Map ERROR_LAMP ke GPIO bebas ATAU hapus code path lamp |
| RC-13 | network_mgr | ESP_ERROR_CHECK esp_wifi_set_config bisa panic | MEDIUM | `network_mgr.c:159, 234` | Set AP/STA config saat WiFi in invalid state → panic → reboot loop | POSSIBLE | Ganti ke graceful error handling |
| RC-14 | sensor_hal | DS18B20 range check off-by-one (<=, >=) | LOW | `sensor_hal.c:172` | Suhu persis -55.0 atau +125.0 ditolak | POSSIBLE | Ganti ke `<` dan `>` |
| RC-15 | hardware_registry | s_active_components[32] di internal RAM (16KB) | MEDIUM | `hardware_registry.c:15` (no EXT_RAM_BSS_ATTR) | Build; internal heap berkurang 16KB | PROVEN | Tambah `EXT_RAM_BSS_ATTR` |
| RC-16 | telemetry_store | s_daily_history 288 slot di internal RAM (~9KB) | LOW | `telemetry_store.c:39` | Build; internal heap berkurang 9KB | PROVEN | Pindahkan ke PSRAM jika akses tidak latency-critical |
| RC-17 | safety_monitor | s_flow_watch[64] di internal RAM (~6KB) | LOW | `safety_monitor.c:47` | Build; internal heap berkurang 6KB | PROVEN | Pertimbangkan EXT_RAM_BSS_ATTR |
| RC-18 | actuator_hal | s_component_runtime[64] di internal RAM (~4KB) | LOW | `actuator_hal.c:50` | Build; internal heap berkurang 4KB | PROVEN | Pertimbangkan EXT_RAM_BSS_ATTR |
| RC-19 | http_server | Auth no-op untuk semua endpoint (kecuali topology-pool peer) | LOW | `http_server.c:24-45` | POST command dari IP non-trusted → accepted | PROVEN | OK untuk MVP trusted local network; dokumentasikan |
| RC-20 | http_server | CORS Allow-Origin: * | LOW | `http_server.c:96` | Browser dari origin manapun bisa POST | PROVEN | OK untuk MVP; restrict ke LAN IP di produksi |
| RC-21 | storage_mgr | boot_cnt NVS write tidak di-check | LOW | `storage_mgr.c:135` | NVS penuh; boot counter tidak increment tapi tidak error | PROVEN | Tambah error check |
| RC-22 | storage_mgr | nvs_commit di banyak tempat tidak di-check | LOW | `storage_mgr.c:665, 673, 877, 1030, 1063` | NVS commit gagal; data tidak persist tapi return ESP_OK | PROVEN | Tambah error check dan log |
| RC-23 | scheduler | process_dosing_queue cJSON_Parse saat dispatch | LOW | `scheduler.c:1609` | Dosing queue dispatch 1x per batch; cJSON_Parse ~1ms | PROVEN | OK untuk low-frequency dispatch |
| RC-24 | fertigation_mgr | persist_run fallback cJSON path jika buffer 4096 overflow | LOW | `fertigation_mgr.c:548-660` | execution_plan_json sangat besar (>4KB); fallback ke cJSON tree | POSSIBLE | Monitor di runtime; tingkatkan buffer jika sering |
| RC-25 | network_mgr | net_reconnect task prio 4, 50s block via ulTaskNotifyTake | MEDIUM | `network_mgr.c:409-410` | WiFi disconnect 50s+; task block; tidak ada WDT | PROVEN | Tambah WDT register ATAU turunkan ke bounded timeout |
| RC-26 | telemetry_mgr | telemetry_sampler_task vTaskDelay(2s) — DHT22 3s cadence OK | LOW | `telemetry_mgr.c:664` | Poll DHT22 setiap 3s (1.5x task cadence); OK | PROVEN | OK |
| RC-27 | dht22 | Tidak ada critical section; ISR bisa corrupt bit | LOW | `dht22.c:11-28` | Concurrent flow ISR fire during DHT22 read; CRC fail; retry 3s | PROVEN | OK per design (trade-off vs ISR latency) |
| RC-28 | sdcard_hal | No runtime remount jika SD card gagal mount | LOW | `sdcard_hal.c:156-169` | SD card inserted after boot; s_sd_mounted tetap false sampai reboot | PROVEN | Tambah API sdcard_hal_remount() untuk hot-insert |
| RC-29 | main.c | hardware_hal_init_all() selalu return ESP_OK (degraded) | LOW | `hardware_registry.c:598-648` | GPIO config gagal; ESP_ERROR_CHECK di main.c:232 tidak trigger | PROVEN | Ganti ESP_ERROR_CHECK ke graceful |
| RC-30 | scheduler | s_marker_persist_task_handle di-NULL jika create gagal | LOW | `scheduler.c:2142-2146` | marker_persist_task create gagal; marker tidak persist ke NVS sampai reboot | PROVEN | Log error + set flag untuk retry |
| RC-31 | actuator_hal | resolve_configured_actuator loop tidak O(1) | LOW | `actuator_hal.c:171-184` | Setiap actuator_hal_set scan seluruh registry (32 components) | PROVEN | OK untuk 32 components |
| RC-32 | command_mgr | Idempotency cache 32 entry, FIFO overwrite | LOW | `command_mgr.c:32, 100-105` | 33+ command unik dalam window; command pertama di-overwrite; idempotency check miss | PROVEN | Tingkatkan cache size ATAU invalidate berdasarkan timestamp |
| RC-33 | storage_mgr | load_nvs_string_checked CRC check | INFO | `storage_mgr.c:262-296` | CRC32 validasi config; fallback SPIFFS → NVS | PROVEN | OK — defense in depth |
| RC-34 | safety_monitor | safety_set_fault call actuator_hal_emergency_stop di luar mutex | LOW | `safety_monitor.c:190-192` | safety_set_fault release mutex sebelum call actuator_hal_emergency_stop | PROVEN | OK — actuator_hal punya lock sendiri |
| RC-35 | sensor_hal | gpio_install_isr_service(0) tidak ESP_ERROR_CHECK | LOW | `sensor_hal.c:531` | ISR service sudah installed; return ESP_ERR_INVALID_STATE diabaikan | PROVEN | OK — idempotent |
| RC-36 | network_mgr | reconnect_task tidak WDT-registered | MEDIUM | `network_mgr.c:371-412` | reconnect_task hang di esp_wifi_connect internal; no WDT | PROVEN | Tambah WDT register dengan timeout 30s |
| RC-37 | tft_hal | tft_screen_task tidak WDT-registered | LOW | `tft_hal.c:1362-1378` | TFT hang di spi_device_polling_transmit; no WDT | PROVEN | OK — TFT non-critical, system continues headless |
| RC-38 | storage_mgr | storage_mgr_set_safe_boot_active tidak persist ke NVS | LOW | `storage_mgr.c:939-944` | safe_boot_active hanya di RAM; reboot reset ke true (default di init) | PROVEN | OK per design — fail-safe default |

---

## Bagian 5 — Task Inventory

| Task Name | Stack | Prio | Core | WDT? | Blocking Call | Risk |
|-----------|-------|------|------|------|---------------|------|
| `diag_task` | 3072 | 1 | 0 | NO | `vTaskDelay(60s)` | LOW — non-critical, deliberately unregistered |
| `btn_poll_task` | 3072 | 5 | 1 | NO | `vTaskDelay(20ms)` | LOW — fast poll, no block |
| `safety_mon` | 6144 | 7 | 1 | YES (L217) | `vTaskDelay(500ms)` + `xSemaphoreTake(s_mutex, portMAX_DELAY)` | LOW — feeds WDT each iter |
| `cmd_worker` | 4096 | 6 | 1 | YES (L541) | `xQueueReceive(s_cmd_queue, pdMS_TO_TICKS(2000))` | LOW — bounded 2s |
| `cmd_component` (per-command) | 4096 | 5 | ANY | NO | `vTaskDelay(250ms)` per cycle | MEDIUM — short-lived, max_runtime_sec bounded |
| `scheduler` | 6144 | 4 | 1 | YES (L1998) | `vTaskDelayUntil(1s)` | LOW — feeds WDT each tick |
| `mk_persist` | 3072 | 2 | 1 | NO | `xTaskNotifyWait(0,0xFFFFFFFF,NULL,portMAX_DELAY)` | **HIGH** — indefinite block, no WDT |
| `fert_mgr` | 6144 | 5 | 1 | YES (L1607) | `vTaskDelay(200ms)` | LOW — feeds WDT each iter |
| `telemetry_task` (sampler) | 8192 | 4 | 1 | YES (L504) | `vTaskDelay(2s)` | LOW — feeds WDT each iter |
| `tele_persist_task` | 8192 | 3 | 1 | NO | `ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5000))` | LOW — bounded 5s |
| `telem_store_tsk` | 4096 | 3 | 1 | NO | `ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5000))` | LOW — bounded 5s |
| `tele_stream_task` (per WS client) | 4096 | 4 | 0 | NO | `ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(cadence*1000))` | LOW — bounded |
| `tft_screen_task` | 5120 | 2 | 1 | NO | `ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000))` | LOW — bounded 1s |
| `transfer_mgr` | 3072 | 3 | 1 | NO | (tidak dianalisis) | LOW |
| `offline_sync` | 7168 | 3 | 1 | NO | (tidak dianalisis) | LOW |
| `manual_actuator` | 3072 | 3 | 1 | NO | (tidak dianalisis) | LOW |
| `calib_mgr` | 4096 | 3 | 1 | NO | (tidak dianalisis) | LOW |
| `net_reconnect` | 4096 | 4 | ANY | NO | `ulTaskNotifyTake(pdTRUE, 500ms-50s)` | MEDIUM — 50s max block |
| HTTPD server (httpd_start) | 8192 | 5 | 0 | NO (httpd default) | Per-connection handler | LOW — httpd internal handling |
| `IDLE` (per core) | — | 0 | 0/1 | YES (TWDT idle core mask) | — | — |

**Total stack memory:** ~93 KB (18 task aktif + HTTPD). Mayoritas di internal RAM (kecuali `EXT_RAM_BSS_ATTR` data structure di PSRAM).

---

## Bagian 6 — Heap Budget

| Component | Internal RAM | PSRAM | Notes |
|-----------|--------------|-------|-------|
| WiFi static RX buffers | ~6 KB | 0 | `static_rx_buf_num=2` × ~3KB; DMA-required internal (`network_mgr.c:534`) |
| WiFi dynamic RX buffers | ~24 KB max | 0 (TRY_ALLOCATE_WIFI_LWIP tapi DMA-required) | `dynamic_rx_buf_num=8` × ~3KB |
| WiFi TX buffers (dynamic) | ~8 KB max | 0 | `dynamic_tx_buf_num=8` (PSRAM-eligible via TRY_ALLOCATE_WIFI_LWIP) |
| WiFi cache TX buffers | ~4 KB | 0 | `cache_tx_buf_num=4` |
| LWIP sockets | ~12 KB | 0 | `CONFIG_LWIP_MAX_SOCKETS=8` × ~1.5KB |
| LWIP TCP/IP thread stack | ~4 KB | 0 | Internal |
| LWIP RX mbox | ~2 KB | 0 | `CONFIG_LWIP_TCP_RECVMBOX_SIZE=32` |
| mDNS task stack | 3072 | 0 | `CONFIG_MDNS_TASK_STACK_SIZE=3072` |
| mDNS service records | ~2 KB | 0 | `CONFIG_MDNS_MAX_SERVICES=10` |
| Event loop task stack | 4096 | 0 | `CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE=4096` |
| Main task stack (app_main) | 8192 | 0 | `CONFIG_ESP_MAIN_TASK_STACK_SIZE=8192`; released after app_main returns |
| Task stacks (18 custom tasks) | ~93 KB | 0 | Lihat Task Inventory; all internal (no EXT_RAM_ATTR on stacks) |
| HTTPD server task stack | 8192 | 0 | `TASK_HTTP_SERVER_STACK=8192` override |
| cJSON typical per HTTP request | 0 | ~2-8 KB | ~36B per node; 50-200 nodes per request; PSRAM (MALLOC_ALWAYSINTERNAL=0) |
| Static BSS internal (s_active_components, s_daily_history, s_flow_watch, s_component_runtime, s_batch_buffer) | ~37 KB | 0 | Lihat AUDIT B |
| Static BSS PSRAM (s_runtime, s_markers, s_today_occurrences, s_dosing_queue, s_cache, s_marker_snapshot) | 0 | ~140 KB | `EXT_RAM_BSS_ATTR`; s_cache[32] dominant |
| Heap allocated during HTTP request (typical) | 0 | ~16 KB | config buffer 16KB + cJSON tree; freed after response |
| Free at boot (estimated) | ~80-120 KB | ~7.5 MB | Post HEAP-FIX; sebelum fix: 7KB internal → HTTPD task gagal |

**Estimasi internal heap free setelah boot:** ~80-120 KB (cukup untuk HTTPD task creation + WiFi reconnect + config deploy buffer). Jika heap drop di bawah 30KB, `diag_task` akan log warning (`main.c:371-373`).

**PSRAM free setelah boot:** ~7.5 MB dari 8 MB (PSRAM dominan dikonsumsi oleh `s_cache[32]` ~128KB di command_mgr + ~10KB scheduler structures).

---

## Bagian 7 — Remediation Priority

### P0 — Must Fix Before Flash

1. **RC-01: Tambahkan `PIN_OUT_BUZZER` ke `safe_boot_actuators()` di `main.c:52`** — Buzzer false-trigger di boot adalah kerugian safety & UX. Fix sederhana: tambahkan ke array `output_pins[]`.

2. **RC-02, RC-03, RC-04: Tambah cleanup path di `network_mgr_init` failure** — Setelah `esp_wifi_init` atau `esp_wifi_start` gagal, panggil: `esp_wifi_stop()` + `esp_wifi_deinit()` + `esp_event_handler_unregister()` × 4 + `mdns_free()`. Ini memastikan retry `network_mgr_init()` di masa depan berfungsi.

3. **RC-05, RC-06: Decouple mutex dari SD card I/O di `storage_mgr_append_event_log` dan `storage_mgr_append_fertigation_run`** — Copy JSON ke buffer lokal di under mutex, release mutex, lalu fopen+fprintf+fclose di outside mutex. Pattern sama dengan RC-9 fix untuk `s_config_mutex`.

### P1 — Should Fix

4. **RC-07: `marker_persist_task` WDT register atau bounded timeout** — Ganti `xTaskNotifyWait(0,0,0,portMAX_DELAY)` ke `pdMS_TO_TICKS(60000)` (60s); jika timeout, log warning. Atau register ke WDT dengan timeout 30s.

5. **RC-25, RC-36: `net_reconnect` WDT register** — Tambah `esp_task_wdt_add(NULL)` di awal task + `esp_task_wdt_reset()` setiap iter. Timeout 30s.

6. **RC-11: Persist `s_dosing_queue` ke NVS** — Atau minimal persist head entry (PENDING/DISPATCHED) agar reboot tidak kehilangan batch yang sedang in-flight.

7. **RC-12: Map `ERROR_LAMP` ke GPIO bebas ATAU hapus code path** — Saat ini E-Stop visual alarm tidak berfungsi. Jika tidak ada GPIO bebas, dokumentasikan bahwa buzzer adalah satu-satunya alarm.

8. **RC-09: Cache active GH list di RAM saat config deploy** — Hilangkan `calloc(16KB)` per command submission. Cache di `s_active_gh_list[]` di command_mgr, invalidate saat config_version berubah.

9. **RC-15, RC-16, RC-17, RC-18: Pindahkan static array besar ke PSRAM** — Tambah `EXT_RAM_BSS_ATTR` ke `s_active_components[32]`, `s_daily_history`, `s_flow_watch[64]`, `s_component_runtime[64]`. Hemat ~35KB internal RAM.

10. **RC-13: Ganti `ESP_ERROR_CHECK(esp_wifi_set_config(...))` ke graceful error** — Return error code, log, jangan panic.

11. **RC-08: Guard double-init di `rtc_ds3231_init`** — Tambah `if (s_ds3231_initialized) return ESP_OK;`.

### P2 — Nice to Have

12. **RC-10: Samakan `TASK_HTTP_SERVER_STACK` dengan sdkconfig ATAU update komentar sdkconfig** — Konsistensi dokumentasi.

13. **RC-14: Fix DS18B20 range check off-by-one** — Ganti `<=` ke `<` dan `>=` ke `>`.

14. **RC-21, RC-22: Tambah error check untuk `nvs_set_u32` (boot_cnt) dan `nvs_commit` di seluruh storage_mgr** — Defense in depth.

15. **RC-28: Tambah `sdcard_hal_remount()` API** — Untuk hot-insert SD card tanpa reboot.

16. **RC-29: Ganti `ESP_ERROR_CHECK(hardware_hal_init_all())` ke graceful** — Fungsi selalu return ESP_OK; ESP_ERROR_CHECK misleading.

17. **RC-30: Log error + set retry flag jika `marker_persist_task` create gagal** — Saat ini hanya log warning, marker tidak persist sampai reboot.

18. **RC-32: Tingkatkan `IDEMPOTENCY_CACHE_SIZE` dari 32 ke 64** — Atau invalidate berdasarkan timestamp (entries > 1 jam di-evict).

19. **RC-19, RC-20: Dokumentasikan trusted-network assumption & CORS policy** — OK untuk MVP; restrict di produksi.

---

## Penutup

Audit ini membaca **~3500 baris kode** dari 18 file sumber utama. Setiap klaim dilengkapi referensi `file:line`. Status PROVEN diberikan hanya jika ada bukti kode yang jelas; LIKELY jika inferensi kuat dari pola kode; POSSIBLE jika skenario masuk akal tapi tidak ada bukti langsung.

**Temuan paling kritis** yang harus diperbaiki sebelum flash production:
1. Buzzer GPIO 18 unconfigured di safe_boot (RC-01) — 1-baris fix
2. WiFi partial-failure state tidak konsisten (RC-02/03/04) — cleanup path lengkap
3. Mutex held during SD I/O untuk event & fertigation log (RC-05/06) — decouple pattern

Firmware secara umum **well-engineered** dengan bukti iterasi perbaikan yang sistematis (komentar RC-1 sampai RC-9, HEAP-FIX, WDT-FIX, FIX-EQUIPMENT-DHT22). Heap budget sehat berkat PSRAM offloading. WDT coverage untuk critical tasks (safety, scheduler, command, fertigation, telemetry) sudah benar. Safety interlocks (tamper loop, lower float, max runtime, flow timeout) berlapis dan terverifikasi.

**Tidak ada temuan yang menunjukkan firmware akan crash pada boot normal** atau **aktivasi actuator tak terkontrol**. Risiko utama adalah **false-trigger buzzer saat boot** dan **state tidak konsisten setelah WiFi partial failure** — keduanya dapat di-fix dengan effort kecil.
