# AI WI-FI PROVISIONING IMPLEMENTATION PLAN V1

**Date:** 2026-09-15  
**Current Safe Point:** `SP-BOOT-001`  
**Baseline Commit:** `2f86ea9` (Tracking hash: `85f53d4`)  
**Target Hardware:** ESP32-S3-WROOM-1-N16R8 (USB COM3)  
**Authority:** Architectural Implementation Plan only. Zero source code modified, zero builds/flashes executed.  

---

## 1. Objective

Menyusun rencana implementasi formal untuk pemuatan kredensial Wi-Fi STA (*Station*) berbasis NVS (*Non-Volatile Storage*) pada firmware ESP32-S3 AgroTech. Tujuannya adalah agar ESP32 dapat bergabung ke LAN lokal host PC secara aman dan otomatis saat boot, sehingga pengujian *REST API Smoke Test* dapat diselesaikan tanpa memutus koneksi internet host PC dan tanpa menyematkan kredensial rahasia ke dalam source code maupun repository Git.

---

## 2. Current Architecture Baseline

Berdasarkan laporan inspeksi [AI_WIFI_PROVISIONING_INSPECTION_V1.md](file:///d:/template/esp32/docs/AI_WIFI_PROVISIONING_INSPECTION_V1.md):
- **Status Saat Ini:**
  - `network_mgr_init()` mengonfigurasi Wi-Fi dalam mode `WIFI_MODE_APSTA`.
  - Kredensial STA di-hardcode sebagai string kosong (`.ssid = ""`, `.password = ""`).
  - Boot event `WIFI_EVENT_STA_START` memicu pemanggilan `esp_wifi_connect()` dengan SSID kosong yang langsung menghasilkan peringatan otentikasi driver.
  - SoftAP `AGROTECH-SETUP` aktif secara independen pada `192.168.4.1`.
  - NVS namespace `"agrotech"` aktif untuk parameter sistem, namun belum memiliki key untuk kredensial Wi-Fi STA.
  - Tidak ada endpoint API kanonikal yang menangani konfigurasi jaringan.

---

## 3. Chosen Design & Architecture

### A. Prinsip Utama Desain
1. **NVS-Backed Dynamic Loading:** Kredensial Wi-Fi STA dimuat secara dinamis dari NVS saat inisialisasi jaringan (`network_mgr_init`).
2. **Strict Domain Separation:** Kredensial transport (Wi-Fi) disimpan terpisah dari konfigurasi agrikultur/bisnis (`lvc_json`).
3. **No Phantom Connect:** Jika kredensial belum ada di NVS atau SSID kosong, sistem **tidak memanggil `esp_wifi_connect()`**, menghindari spam log kegagalan dan overhead driver.
4. **Permanent SoftAP Availability:** Mode dual `WIFI_MODE_APSTA` dipertahankan. SoftAP `AGROTECH-SETUP` pada `192.168.4.1` selalu aktif sebagai saluran pemulihan (*recovery & provisioning*).
5. **Asynchronous Non-Blocking Boot:** Seluruh proses koneksi Wi-Fi berlangsung secara asinkron via FreeRTOS event loop. Booting sistem menuju `SYSTEM READY` tidak pernah menunggu handshake Wi-Fi.
6. **Zero Hardcoded Secrets:** Tidak ada SSID atau password Wi-Fi riil yang ditulis ke source code, file header, ataupun dikomit ke Git.

---

## 4. NVS Schema Design

### A. Namespace & Key Definitions

| Parameter | Spesifikasi | Keterangan |
| :--- | :--- | :--- |
| **Namespace** | `"agrotech"` | Menggunakan namespace utama sistem yang sudah terkelola dengan baik oleh `storage_mgr`. |
| **Key SSID** | `"sta_ssid"` | String UTF-8, panjang 1 s.d. 32 karakter (standar IEEE 802.11). |
| **Key Password** | `"sta_pass"` | String UTF-8, panjang 0 s.d. 64 karakter (standar WPA2-PSK: 8–63 ASCII atau 64 hex; 0 untuk Open Network). |

### B. Validation & Bounds Checking
Sebelum parameter diterapkan ke driver Wi-Fi:
1. Periksa nilai balik `nvs_get_str`:
   - Jika `ESP_ERR_NVS_NOT_FOUND`: tandai status sebagai `UNPROVISIONED`, lewati inisialisasi STA, dan lanjutkan ke SoftAP.
2. Panjang SSID:
   - Jika panjang < 1 atau > 32: anggap tidak valid, catat warning di log, jangan koneksikan STA.
3. Panjang Password:
   - Jika > 0 dan < 8 (dan bukan 0): catat warning di log, batalkan percobaan koneksi WPA2.

### C. Atomic Update & Clearing Strategy
- **Penyimpanan:**
  ```c
  nvs_handle_t handle;
  if (nvs_open("agrotech", NVS_READWRITE, &handle) == ESP_OK) {
      nvs_set_str(handle, "sta_ssid", ssid);
      nvs_set_str(handle, "sta_pass", pass);
      nvs_commit(handle);
      nvs_close(handle);
  }
  ```
- **Penghapusan / Reset:**
  Fungsi `network_mgr_clear_sta_credentials()` menghapus key `"sta_ssid"` dan `"sta_pass"` via `nvs_erase_key()`, kemudian melakukan `nvs_commit()`.

---

## 5. Provisioning Mechanism for This Phase

Untuk fase pengujian bench saat ini, **tidak diperlukan pembuatan endpoint HTTP baru atau modifikasi OpenAPI**.

### Mekanisme Terpilih: Safe Host-Side NVS Provisioning via USB/Serial
1. **Pendekatan:**
   Kredensial disuntikkan langsung ke partisi NVS ESP32 (`0x9000`, 24 KiB) dari Host PC via port COM3 menggunakan utilitas standar ESP-IDF (`nvs_partition_gen.py` atau script Python lokal yang membaca kredensial dari environment variable lokal atau prompt sementara tanpa menyimpannya ke file repository).
2. **Alternatif Ringan (Runtime Serial Setup CLI):**
   Jika generator NVS biner tidak diinginkan, `network_mgr` dapat menyediakan fungsi pembaca NVS sederhana saat boot, dan pengisian awal NVS dapat dilakukan melalui perintah serial monitor sekali pakai (misal: `AT+WIFICFG=<ssid>,<pass>`) yang langsung di-commit ke NVS lalu dinonaktifkan.
3. **Rekomendasi Utama:**
   Gunakan script injeksi NVS serial lokal di `scratch/` (di luar git tracking) yang menulis langsung entri `sta_ssid` dan `sta_pass` ke partisi NVS COM3, sehingga firmware hanya bertindak sebagai *consumer* murni yang membaca NVS saat boot.

---

## 6. Network State Behavior & Reliability

```
                      +-----------------------------+
                      |   network_mgr_init() Boot   |
                      +-----------------------------+
                                     |
                         [Read NVS "agrotech"]
                         "sta_ssid" & "sta_pass"
                                     |
                     +---------------+---------------+
                     |                               |
              [Keys Absent]                    [Keys Present]
                     |                               |
         +-----------------------+       +-----------------------+
         | STA Connection Idle   |       | Configure STA Config  |
         | SoftAP Only (Channel1)|       | Call esp_wifi_connect |
         +-----------------------+       +-----------------------+
                     |                               |
                     |                   +-----------+-----------+
                     |                   |                       |
                     |            [IP_EVENT_GOT_IP]    [DISCONNECTED Event]
                     |                   |                       |
                     |           +---------------+       +---------------+
                     |           | Connected OK  |       | Retry cnt < 5 |
                     |           | Got 192.168.x |       +---------------+
                     |           +---------------+               |
                     |                   |               [Retry >= 5]
                     |                   |                       |
                     |                   |               +---------------+
                     |                   |               | Stop retry    |
                     |                   |               | SoftAP Active |
                     |                   |               +---------------+
                     +-------------------+-----------------------+
                                         |
                       +-----------------------------------+
                       | SYSTEM READY (SoftAP 192.168.4.1) |
                       | + STA IP (jika berhasil terhubung)|
                       +-----------------------------------+
```

### A. Penanganan Kondisi Error & Recovery
1. **Router Tidak Tersedia / Di Luar Jangkauan:**
   - Driver mencoba menyambung ulang hingga 5 kali (`MAX_RETRY = 5`).
   - Setelah 5 kali gagal, sistem menghentikan loop koneksi dan tetap beroperasi normal pada SoftAP.
2. **Password Salah (Auth Fail):**
   - Event disconnected mencatat alasan kegagalan.
   - Retry berhenti setelah batas maksimal tercapai; tidak memicu watchdog atau restart.
3. **Reboot / Power Loss:**
   - Kredensial tersimpan permanen di NVS flash dan langsung dibaca kembali pada boot berikutnya.

---

## 7. Security Model & Protection Rules

1. **Write-Only Password:** Password Wi-Fi tidak boleh dikembalikan oleh endpoint REST API mana pun.
2. **Zero Logging of Secret:** Password Wi-Fi tidak boleh dicetak ke log serial console (`ESP_LOGI`/`ESP_LOGW`/`printf`). Jika perlu logging status, gunakan masking (contoh: `SSID: Anantadeva, Pass: [CONFIGURED]`).
3. **Pemisahan dari LVC JSON:** Kredensial Wi-Fi tidak disimpan di dalam `lvc_json` agar tidak bocor melalui `GET /api/v1/configuration` yang terbuka untuk publik.
4. **Git Protection:** Tidak ada kredensial yang ditulis ke file source code, Kconfig, atau dokumentasi repository.

---

## 8. Physical Safety & Subsystem Independence

Kegagalan, ketiadaan, atau kesalahan konfigurasi Wi-Fi **TIDAK BOLEH MEMENGARUHI SUBSISTEM LAIN**:
- Inisialisasi NVS storage harus tetap sukses.
- Safe boot aktuator (7 channel terkunci logic 0 / OFF) tetap dieksekusi sebelum modul Wi-Fi dimulai.
- Safety Monitor task (priority 7) tetap memantau interlock darurat.
- Command Manager dan Scheduler tetap berjalan normal.
- REST HTTP Server tetap aktif pada port 80 (dapat diakses via SoftAP `192.168.4.1` atau STA jika terhubung).

---

## 9. Exact Files Expected to Change

Hanya 1 file kode sumber firmware yang perlu dimodifikasi:
1. `esp32/main/network/network_mgr.c`
   - Menambahkan pembacaan NVS untuk key `sta_ssid` dan `sta_pass`.
   - Menghapus hardcoding string kosong `""`.
   - Menambahkan pengecekan: jika SSID tidak ada di NVS, jangan panggil `esp_wifi_connect()`.
   - Masking log agar tidak mencetak password.
2. *(Opsional - Host Utility)*:
   - File script injeksi NVS sementara di `scratch/` (tidak di-track oleh git) untuk menyuntikkan kredensial ke chip via COM3.

---

## 10. Test & Verification Plan

### Langkah 1: Pengujian Tanpa Kredensial (Unprovisioned State)
- Hapus kredensial Wi-Fi dari NVS.
- Boot ESP32 dan amati serial log:
  - Verifikasi bahwa log mencatat mode unprovisioned tanpa error atau crash.
  - Verifikasi bahwa `esp_wifi_connect()` tidak dipanggil.
  - Verifikasi bahwa SoftAP `AGROTECH-SETUP` (`192.168.4.1`) tetap aktif.
  - Verifikasi bahwa `SYSTEM READY` tercapai dalam < 1.7 detik.

### Langkah 2: Pengujian Injeksi & Koneksi STA (Provisioned State)
- Suntikkan SSID dan password Wi-Fi lokal ke NVS via utility.
- Lakukan reboot ESP32 via COM3.
- Amati serial log:
  - Verifikasi log mencatat pembacaan NVS sukses.
  - Verifikasi log mencatat `Got IP: 192.168.0.xxx`.
  - Verifikasi log mencatat `HTTP Server successfully started`.
  - Verifikasi bahwa password TIDAK dicetak di serial log.

### Langkah 3: Pengujian Keterjangkauan REST API dari Host PC
- Dari Host PC (tanpa memutus Wi-Fi `Anantadeva`), lakukan pengujian HTTP GET:
  - `GET http://192.168.0.xxx/api/v1/health` &rarr; Status 200 OK.
  - `GET http://192.168.0.xxx/api/v1/status` &rarr; Status 200 OK, 7 aktuator OFF.
  - `GET http://192.168.0.xxx/api/v1/capabilities` &rarr; Status 200 OK.
- Verifikasi bahwa sesi IDE agent dan internet host PC tetap stabil tanpa gangguan.

---

## 11. Rollback Plan

Jika perubahan pada `network_mgr.c` menyebabkan masalah regresi boot atau inisialisasi driver:
1. Kembalikan `network_mgr.c` ke status commit `2f86ea9` (`git checkout esp32/main/network/network_mgr.c`).
2. Kompilasi ulang (`ninja -C build`).
3. Flash ulang ke COM3.
4. Firmware akan kembali ke kondisi Safe Point `SP-BOOT-001`.

---

## 12. Acceptance Criteria

Rencana ini dianggap berhasil diimplementasikan jika:
1. Firmware mengompilasi bersih (0 error, 0 warning kritis).
2. Firmware boot normal dan mencapai `SYSTEM READY` tanpa crash, WDT reset, atau panic.
3. Jika kredensial NVS ada, ESP32 terhubung ke Wi-Fi lokal dan mendapatkan IP `192.168.0.xxx`.
4. Endpoint read-only REST API kanonikal (`/api/v1/health`, `/api/v1/status`, `/api/v1/capabilities`) dapat diakses dari browser/curl Host PC via IP lokal.
5. SoftAP `AGROTECH-SETUP` tetap aktif simultan.
6. Tidak ada password atau kredensial sensitif yang bocor di serial log atau respons GET HTTP.
7. Seluruh 7 aktuator tetap terkunci aman OFF.

---

## 13. Risks & Open Questions

- **Risiko 1 (Kanal Wi-Fi Simultan):**  
  Pada mode `WIFI_MODE_APSTA`, ESP32 harus berbagi satu radio transceiver untuk SoftAP dan STA. Saat STA terhubung ke router pada kanal tertentu (misal Channel 11), SoftAP akan otomatis menyesuaikan kanalnya ke Channel 11. Ini adalah perilaku standar ESP-IDF Wi-Fi dan tidak memengaruhi fungsionalitas.
- **Risiko 2 (Kualitas Sinyal):**  
  Pastikan modul ESP32-S3 berada dalam jangkauan sinyal Wi-Fi yang memadai dari Access Point router.

---

**STATUS:** **IMPLEMENTATION PLAN COMPLETE — STOP TOTAL**.  
Menunggu review dan persetujuan dari operator sebelum melanjutkan ke tahap eksekusi implementasi kode.
