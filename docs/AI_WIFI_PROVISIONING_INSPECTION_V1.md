# AI WI-FI PROVISIONING ARCHITECTURE INSPECTION REPORT V1

**Date:** 2026-09-15  
**Current Safe Point:** `SP-BOOT-001`  
**Baseline Commit:** `2f86ea9` (Tracking hash: `85f53d4`)  
**Target Hardware:** ESP32-S3-WROOM-1-N16R8  
**Document Authority:** Inspection and architectural analysis only. Zero source code modified.  

---

## 1. Executive Summary

Pemeriksaan forensik menyeluruh telah dilakukan terhadap subsistem jaringan (`network_mgr`), manajemen penyimpanan NVS (`storage_mgr`), penanganan konfigurasi REST API (`api_config_handlers`), kontrak kanonikal (`UI_ESP32_OPENAPI.yaml`), dan siklus *boot* ESP32-S3.

### Ringkasan Jawaban Atas Pertanyaan Kunci:
1. **Asal Kredensial STA SSID / Password Saat Ini:**  
   Hardcoded langsung di dalam `esp32/main/network/network_mgr.c` sebagai string kosong (`""`).
2. **Status Hardcoding:**  
   **YA, 100% HARDCODED**. Belum ada logika pembacaan dinamis dari storage atau runtime config.
3. **Status Persistensi NVS:**  
   **TIDAK TERSIMPAN**. Belum ada kode yang membaca maupun menulis kredensial Wi-Fi STA ke NVS.
4. **NVS Namespace / Key yang Digunakan:**  
   Saat ini **BELUM ADA** namespace/key NVS yang dialokasikan khusus untuk kredensial Wi-Fi STA. (Namespace `"agrotech"` saat ini hanya digunakan untuk ID perangkat, boot counter, versi konfigurasi, CRC, status E-Stop, JSON jadwal bisnis `lvc_json`, data siklus tanam, dan `api_key`).
5. **Keamanan Penggunaan API Konfigurasi Existing (`/api/v1/configuration`):**  
   **TIDAK AMAN & TIDAK DISARANKAN**. Endpoint `GET /api/v1/configuration` adalah endpoint publik tanpa autentikasi (*unauthenticated*). Menyimpan password Wi-Fi ke dalam objek konfigurasi umum akan mengekspos password secara terbuka dalam format teks terang (*plaintext*).
6. **Eksposur Kredensial pada Endpoint GET atau Log:**  
   - Kredensial STA saat ini kosong sehingga tidak membocorkan data sensitif.
   - Kredensial SoftAP: SSID `AGROTECH-SETUP` dicatat pada log serial; password `<REDACTED>` bersifat hardcoded namun tidak dicetak di log.
   - Endpoint `GET /api/v1/context` mengekspos IP hardcoded (`192.168.4.1`) dan hostname (`esp32-gh-01.local`).
7. **Dukungan Perubahan Kredensial Tanpa Kompilasi Ulang:**  
   **BELUM DIDUKUNG**. Saat ini firmware wajib diubah di source code dan dikompilasi ulang untuk mengganti target SSID/password STA.
8. **Ketersediaan SoftAP Simultan untuk Provisioning / Recovery:**  
   **YA, DIDUKUNG PENUH**. ESP32-S3 berjalan dalam mode simultan `WIFI_MODE_APSTA` di mana SoftAP tetap aktif pada IP `192.168.4.1` bahkan saat STA terputus atau gagal terhubung.

---

## 2. Source Files Inspected

1. `esp32/main/network/network_mgr.h` — Deklarasi antarmuka Network Manager.
2. `esp32/main/network/network_mgr.c` — Implementasi inisialisasi Wi-Fi AP+STA, event handler, dan konfigurasi STA.
3. `esp32/main/storage/storage_mgr.h` — Deklarasi antarmuka NVS Storage Manager.
4. `esp32/main/storage/storage_mgr.c` — Implementasi persistensi NVS namespace `"agrotech"`, LVC JSON, CRC32, dan E-Stop.
5. `esp32/main/http/api_config_handlers.c` — Handler endpoint `GET /api/v1/configuration`, `PUT /api/v1/configuration`, dan validasi payload.
6. `esp32/main/http/http_server.c` — Pendaftaran seluruh rute REST API kanonikal dan autentikasi Bearer token.
7. `esp32/main/config/system_config.h` — Konstanta identitas firmware, port, dan alokasi stack task.
8. `template/contracts/UI_ESP32_OPENAPI.yaml` — Kontrak kanonikal OpenAPI v1.0.0.

---

## 3. Current Architecture & Boot Flow Analysis

### A. Alur Booting Jaringan Saat Ini (`network_mgr_init`)
```text
1. app_main() memanggil network_mgr_init()
2. esp_netif_create_default_wifi_sta()
3. esp_wifi_init()
4. Registrasi event handler untuk WIFI_EVENT dan IP_EVENT
5. wifi_init_softap_fallback()
   ├── esp_netif_create_default_wifi_ap()
   ├── Konfigurasi SoftAP: SSID="AGROTECH-SETUP", PASS="<REDACTED>", Channel=1, WPA2
   └── esp_wifi_set_config(WIFI_IF_AP, &wifi_config_ap)
6. Hardcoded STA configuration:
   └── wifi_config_sta.sta.ssid = ""
   └── wifi_config_sta.sta.password = ""
7. esp_wifi_set_mode(WIFI_MODE_APSTA)
8. esp_wifi_set_config(WIFI_IF_STA, &wifi_config_sta)
9. esp_wifi_start()
10. Event WIFI_EVENT_STA_START terpicu -> memanggil esp_wifi_connect()
    └── Gagal menyambung karena SSID kosong (mencetak warning: password length zero).
11. SoftAP tetap aktif dan DHCP Server membagikan IP pada subnet 192.168.4.1.
```

Kutipan langsung dari `network_mgr.c` baris 87–96:
```c
    /* Try loading config from NVS (mock for now, assume missing/empty) */
    wifi_config_t wifi_config_sta = {
        .sta = {
            .ssid = "",
            .password = "",
            /* Authmode threshold */
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
```

---

## 4. NVS Persistence & Storage Inventory

Saat ini namespace NVS yang aktif di sistem meliputi:
- **Namespace `"agrotech"`**:
  - `dev_id` (string): Identitas node (`DEFAULT_DEVICE_ID = "esp32-gh-01"`).
  - `cplx_id` (string): Identitas kompleks (`DEFAULT_COMPLEX_ID = "complex-01"`).
  - `boot_cnt` (uint32): Jumlah total booting (saat ini bernilai 241).
  - `cfg_ver` (uint32): Versi konfigurasi operasional aktif.
  - `cfg_crc` (uint32): Checksum CRC32 dari konfigurasi operasional aktif.
  - `estop` (uint8): Latch flag status E-Stop darurat.
  - `lvc_json` (string): Payload JSON konfigurasi jadwal dan zona waktu operasional.
  - `schedules` (blob): Binary cache entri penjadwalan.
  - `active_cc` (blob): Data aktif masa tanam (*Crop Cycle*).
  - `api_key` (string): Token autentikasi Bearer REST API (default: `"agrotech-secret-key"`).
- **Status Kredensial Wi-Fi STA:**  
  **Nol byte**. Tidak ada key `sta_ssid` maupun `sta_pass` yang didefinisikan atau dibaca.

---

## 5. Security & Architectural Concerns

### A. Risiko Keamanan Penggunaan Endpoint Konfigurasi Existing (`/api/v1/configuration`)
1. **Pemaparan Password Tanpa Autentikasi:**  
   Endpoint `GET /api/v1/configuration` terbuka untuk umum tanpa token `Authorization`. Jika kredensial Wi-Fi digabungkan ke dalam objek JSON konfigurasi ini, siapa pun di jaringan dapat melihat SSID dan password Wi-Fi dalam format teks terbuka (*plaintext*).
2. **Pencampuran Domain (Separation of Concerns):**  
   Skema `ConfigurationResponse` dalam kontrak OpenAPI ditujukan untuk parameter agrikultur (jadwal pompa, durasi, zona waktu, versi konfigurasi). Menggabungkan kredensial layer transport (Wi-Fi) ke dalam schema ini melanggar isolasi domain dan skema OpenAPI.
3. **Risiko Rollback & Version Conflict:**  
   Endpoint `PUT /api/v1/configuration` menggunakan kontrol versi ketat (`expectedVersion`). Jika terjadi konflik versi aplikasi, konfigurasi jaringan dapat terblokir atau ter-rollback secara tidak sengaja.

### B. Isolasi Kredensial yang Benar
Kredensial jaringan (SSID dan Password) wajib:
- Disimpan di NVS secara terpisah dari payload JSON `lvc_json`.
- Tidak pernah dikembalikan dalam respons `GET` apa pun (hanya status koneksi, IP, RSSI, dan SSID yang boleh diekspos; password harus disembunyikan / *write-only*).
- Hanya dapat diubah melalui channel yang terotentikasi (*Bearer token protected*) atau saat berada dalam mode setup SoftAP lokal.

---

## 6. Recommended Architecture Options

### Opsi 1: Dedicated NVS Storage + Dedicated Authenticated Network Provisioning (Direkomendasikan Jangka Panjang)
- **Mekanisme:**
  1. `network_mgr` membaca key `sta_ssid` dan `sta_pass` dari NVS (misal namespace `agrotech` atau `nvs.net`).
  2. Jika ada dan valid, hubungkan ke AP target; jika gagal/kosong, tetap sediakan SoftAP.
  3. Dibuat endpoint dedicated, misalnya `POST /api/v1/network/wifi` yang terproteksi autentikasi Bearer, untuk menerima SSID dan password baru serta menyimpannya ke NVS tanpa merusak kontrak OpenAPI `configuration`.
- **Kelebihan:** Standar industri, aman, tidak membocorkan password di endpoint publik, mendukung provisioning ulang tanpa flash.
- **Catatan:** Memerlukan penambahan rute API baru atau persetujuan ekstensi kontrak OpenAPI.

### Opsi 2: NVS Injection via Setup Tool / NVS Partition Utility (Zero Code Change to API)
- **Mekanisme:**
  1. `network_mgr.c` diperbarui hanya untuk membaca kredensial dari NVS jika ada (`nvs_get_str(handle, "sta_ssid", ...)`), dengan fallback ke hardcoded default jika NVS kosong.
  2. Kredensial dapat dimasukkan ke NVS melalui skrip Python sederhana via USB COM3 (`nvs_partition_gen.py` / esptool / custom serial command) tanpa perlu endpoint HTTP baru.
- **Kelebihan:** Nol perubahan pada kontrak kanonikal OpenAPI dan UI. Sangat aman dan tidak mengekspos endpoint jaringan apa pun ke publik.

### Opsi 3: Build-Time Config Flag dengan NVS Fallback (Solusi Praktis Bench Bring-Up)
- **Mekanisme:**
  Menambahkan konfigurasi di `system_config.h` (misal `CONFIG_DEFAULT_STA_SSID` dan `CONFIG_DEFAULT_STA_PASS = "<REDACTED>"`), yang akan digunakan jika NVS belum dikonfigurasi.
- **Kelebihan:** Memungkinkan pengujian REST API smoke test langsung pada kondisi bench saat ini dengan 1 baris konfigurasi, sambil mempertahankan fleksibilitas NVS di masa depan.
- **Kelemahan:** Mengganti jaringan memerlukan kompilasi ulang jika NVS belum aktif.

---

## 7. Preferred Option

**Kombinasi Opsi 2 & Opsi 3 (NVS-backed with Safe Bring-Up Fallback):**
1. Modifikasi `network_mgr.c` agar:
   - Mencoba membaca `sta_ssid` dan `sta_pass` dari NVS namespace `"agrotech"`.
   - Jika belum ada di NVS, gunakan konfigurasi build-time default yang aman untuk bench bring-up.
2. Dengan pendekatan ini:
   - Kontrak kanonikal OpenAPI (`UI_ESP32_OPENAPI.yaml`) **tetap 100% terlindungi tanpa perubahan sama sekali**.
   - Tidak ada password yang bocor di endpoint `GET /api/v1/configuration`.
   - ESP32 dapat langsung terhubung ke LAN host PC sehingga pengujian `ESP32 API SMOKE TEST` dapat diselesaikan dengan sempurna tanpa memutus uplink cloud IDE.
   - SoftAP `AGROTECH-SETUP` tetap aktif secara simultan untuk recovery.

---

## 8. Exact Next Implementation Phase

Menunggu konfirmasi dan persetujuan dari operator untuk mengeksekusi rencana perbaikan `network_mgr`:
1. Buat Implementation Plan formal untuk penambahan NVS-backed STA credential loading di `network_mgr.c`.
2. Minta approval operator sebelum menyentuh file kode apa pun.
3. Setelah disetujui: implementasikan, build, flash, dan lanjutkan pengujian `ESP32 API SMOKE TEST`.

---

**STATUS:** **INSPECTION COMPLETE — WAITING FOR OPERATOR REVIEW & APPROVAL**.
