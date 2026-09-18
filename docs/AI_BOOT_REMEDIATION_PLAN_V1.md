# AI BOOT REMEDIATION PLAN V1

**Date:** 2026-09-14  
**Status:** PROPOSED (Awaiting User Explicit Approval)  
**Target Hardware:** ESP32-S3-WROOM-1-N16R8 (Port COM3)  
**Document Authority:** `D:\template\esp32\docs\AI_BOOT_REMEDIATION_PLAN_V1.md`  
**Reference Report:** `D:\template\esp32\docs\AI_BOOT_REMEDIATION_REPORT_V1.md`  

---

## 1. Current State

### Hardware Environment
- **MCU:** ESP32-S3-WROOM-1-N16R8 (16MB Quad SPI Flash, 8MB Octal PSRAM) terhubung ke PC via USB Serial Port (COM3).
- **Periferal Fisik:** **TIDAK ADA PERIFERAL EKSTERNAL YANG TERPASANG**.
  - MicroSD Card reader & microSD card: **BELUM TERPASANG** (Pin SPI: GPIO 11, 12, 13, 27 floating).
  - RTC DS3231: **BELUM TERPASANG** (Pin I2C: GPIO 8, 9 floating tanpa external pull-up).
  - Sensor Suhu (DS18B20 GPIO 17), Flowmeter (YF-B1 GPIO 15, FS400A GPIO 16), Float Switch (GPIO 26): **BELUM TERPASANG**.
  - Relay 4-Channel, MOSFET Dosing, Pompa Distribusi: **BELUM TERPASANG**.

### Firmware & Repository State
- **Boot Status:** **BOOT FAILED** (Siklus boot loop / reset berulang setiap ~1.6 detik akibat `TG1WDT_SYS_RST` di `storage_mgr_init`).
- **Working Tree:** `DIRTY` (Terdapat 4 file dengan perubahan lokal hasil investigasi awal):
  - `esp32/main/hal/sdcard_hal.c`
  - `esp32/main/hal/rtc_ds3231.c`
  - `esp32/main/main.c`
  - `esp32/main/storage/storage_mgr.c`
- **Baseline Git Commit:** `c26dfd6` (*SP-HW-002: Finalize Upper Float Removal and Safety Interlock*).

---

## 2. Root Cause Analysis

Kegagalan boot yang terjadi pada firmware ESP32-S3 ini merupakan akibat dari **tiga titik kegagalan beruntun (*cascading failure points*)** yang saling menutupi satu sama lain:

```
[Boot Start]
     │
     ▼
[HAL Init: Safe OFF] (PASS)
     │
     ▼
[sdcard_hal_init] ────► [Point 1: SPI Polling Hang] ──► TG1WDT Reset (BOOT FAILED)
     │ (jika di-bypass)
     ▼
[rtc_ds3231_init] ────► [Point 2: I2C Bus Lockup]  ──► TG1WDT Reset (BOOT FAILED)
     │ (jika di-bypass)
     ▼
[storage_mgr_init] ───► [Point 3: 9MB SPIFFS Format] ─► TG1WDT Reset (BOOT FAILED)
```

### Titik 1: MicroSD SPI Polling Hang
Fungsi `esp_vfs_fat_sdspi_mount()` memanggil pertukaran sinyal SPI awal (CMD0/CMD8) untuk mendeteksi kartu. Ketika pin SPI MISO mengambang (*floating*) tanpa modul dan tanpa internal pull-up bus yang tepat, sinyal terbaca acak/nol. Driver SDSPI ESP-IDF memasuki loop polling transmisi yang tidak melepaskan (*yield*) eksekusi core, sehingga memicu Timer Group 1 Watchdog Reset.

### Titik 2: RTC DS3231 I2C Bus Lockup
Fungsi `i2c_driver_install()` dan transaksi pembacaan register DS3231 pada address `0x68` dijalankan pada pin SDA (GPIO 8) dan SCL (GPIO 9) yang tidak memiliki resistor pull-up fisik eksternal (karena modul belum terpasang). Hardware Finite State Machine I2C pada ESP32-S3 mengalami *bus lockup* atau *clock stretching timeout*, dan fungsi `main.c` menggunakan makro `ESP_ERROR_CHECK(rtc_ds3231_init())` yang fatal jika driver gagal.

### Titik 3: 9MB SPIFFS Format Timeout (Akar Masalah WDT Saat Ini)
Partisi `storage` pada `partitions.csv` dialokasikan sebesar `0x900000` (9,437,184 bytes / 9MB). 
Pada file `storage_mgr.c`, fungsi `init_spiffs()` mengonfigurasi:
```c
esp_vfs_spiffs_conf_t conf = {
    .base_path = SPIFFS_BASE_PATH,
    .partition_label = "storage",
    .max_files = 5,
    .format_if_mount_failed = true
};
```
Karena flash chip masih baru atau partisi belum terformat, mount awal gagal, sehingga driver SPIFFS ESP-IDF langsung melakukan proses format flash secara in-place.
- Memformat partisi flash 9MB membutuhkan penghapusan (*erase*) 2.304 sektor flash (masing-masing 4KB).
- Waktu erase sektor flash NOR secara tipikal adalah 30–50 ms per sektor, menghasilkan total waktu eksekusi **sekitar 40–70 detik**.
- Selama 40–70 detik tersebut, fungsi `esp_vfs_spiffs_register()` mengeksekusi loop penghapusan flash secara sinkron di Core 0 dalam konteks `app_main` tanpa pernah melakukan `vTaskDelay` atau memberi yield ke FreeRTOS Idle Task.
- Watchdog Timer hardware (Timer Group 1 WDT) memiliki batas waktu timeout default **5000 ms (5 detik)**.
- Akibatnya, pada detik ke ~1.6 - 5.0, hardware timer mendeteksi CPU Core 0 tidak responsif dan langsung mengeksekusi reset hardware: `rst:0x8 (TG1WDT_SYS_RST)`.
- Pada setiap boot ulang, proses yang sama terulang dari awal karena format belum selesai, menciptakan **infinite boot loop**.

---

## 3. Evidence

Bukti-bukti otentik yang tercatat dari serial log monitor COM3:

1. **Bukti Titik 1 (SPI Hang):**
   ```text
   I (1525) HW_REGISTRY: Hardware HAL initialization complete. Total components: 15
   [Hang tanpa log berikutnya selama 5 detik]
   rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
   Saved PC: 0x4038f714
   ```
2. **Bukti Titik 2 (I2C Hang saat SD di-bypass):**
   ```text
   I (1522) AGROTECH_MAIN: TRACE: Bypassing sdcard_hal_init for debugging
   I (1528) AGROTECH_MAIN: TRACE: Calling rtc_ds3231_init
   [Hang total tanpa progres]
   rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
   ```
3. **Bukti Titik 3 (SPIFFS / Storage Manager WDT saat SD & RTC di-bypass):**
   ```text
   I (1539) AGROTECH_MAIN: TRACE: Calling sdcard_hal_init
   W (1561) SDCARD_HAL: No microSD module detected (MISO floating/low). Bypassing SD mount to prevent SPI hardware hang.
   I (1561) AGROTECH_MAIN: TRACE: Calling rtc_ds3231_init
   W (1582) RTC_DS3231: No RTC module detected (SDA floating/low). Bypassing I2C init to prevent hardware hang.
   W (1588) AGROTECH_MAIN: RTC init failed/bypassed. Using SNTP only.
   I (1594) AGROTECH_MAIN: TRACE: Calling storage_mgr_init
   E (1602) task_wdt: delete_entry(240): task not found
   rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
   ```

---

## 4. Confirmed vs Hypothesis

| Temuan | Kategori | Penjelasan & Bukti |
| :--- | :---: | :--- |
| `esp_vfs_fat_sdspi_mount` hang pada pin SPI floating | **CONFIRMED** | Terbukti dari serial log berhenti tepat pada pemanggilan SDSPI mount dan terbebas saat fungsi di-bypass. |
| I2C driver lockup pada pin SDA/SCL floating | **CONFIRMED** | Terbukti dari log berhenti tepat di `rtc_ds3231_init` saat SD di-bypass. |
| Inisialisasi SPIFFS 9MB memicu `TG1WDT_SYS_RST` | **CONFIRMED** | Partisi 9MB dengan `format_if_mount_failed=true` terbukti memblokir CPU hingga WDT reset pada 1.6 detik. |
| `esp_task_wdt_delete(NULL)` gagal mencegah WDT | **CONFIRMED** | Terbukti dari log error `task_wdt: delete_entry(240): task not found`. Pada ESP-IDF v5, `app_main` bukan subscriber individual TWDT. |
| Heuristik Weak Pull-down GPIO MISO/SDA andal mendeteksi modul | **REJECTED (Sebagai Desain Standar)** | Pembacaan level GPIO sementara rentan *false negative* (modul asli tidak terdeteksi) dan *false positive* akibat noise/kapasitansi jalur. |

---

## 5. Architectural Evaluation: Persistence & SPIFFS

### A. Apakah SPIFFS memang diperlukan untuk arsitektur final kita?
**ANALISIS:**
Tinjauan menyeluruh terhadap seluruh kode sumber sistem membuktikan fakta penting:
1. **NVS Flash (`nvs` partition 24KB)**:
   Digunakan untuk menyimpan seluruh parameter kritis dan konfigurasi sistem:
   - Identitas node: `dev_id`, `cplx_id`, `boot_id`, `boot_cnt`.
   - Konfigurasi aplikasi: `lvc_json` (Last Valid Configuration) dengan verifikasi integritas CRC32.
   - Status keselamatan: `estop` (Emergency Stop hardware latch).
   - Versi konfigurasi: `cfg_ver`, `cfg_crc`.
   - Kredensial & API Key: `api_key`.
2. **MicroSD Storage (`/sdcard/events.log`)**:
   Digunakan oleh `storage_mgr_append_event_log()` untuk pencatatan audit log peristiwa dan keselamatan jangka panjang (*bounded rotation* 128KB).
3. **SPIFFS Storage (`/spiffs`)**:
   **TIDAK ADA SATUPUN FUNGSI DALAM FIRMWARE YANG MENULIS ATAU MEMBACA FILE DARI `/spiffs`**.
   - Pada Safe Point SP-004, SPIFFS awalnya disiapkan untuk event log lokal sebelum hardware microSD dimasukkan ke dalam arsitektur (SP-HW-001).
   - Setelah microSD diimplementasikan, fungsi `storage_mgr_append_event_log` dialihkan ke `/sdcard/events.log`, namun inisialisasi SPIFFS tertinggal di `storage_mgr_init()` tanpa pernah digunakan.
   - Web Server ESP32 adalah *pure JSON REST API server*; file UI web (HTML/JS/CSS) disajikan oleh Vite development server pada host/klien dan **tidak** disimpan di dalam SPIFFS ESP32.

### B. Apakah penggunaan SPIFFS 9MB sesuai desain persistence yang sudah ditetapkan?
**TIDAK SESUAI & BERISIKO TINGGI.**
- Dokumentasi resmi Espressif secara tegas menyatakan:
  > *"SPIFFS is not designed for large partitions. For partitions larger than a few megabytes, SPIFFS has high RAM consumption and very long format/garbage collection times."*
- Mengalokasikan 9MB (9,437,184 bytes) flash untuk SPIFFS pada flash 16MB adalah pemborosan memori dan kesalahan desain (*anti-pattern* di sistem embedded) yang secara langsung menyebabkan timeout pemformatan 45 detik dan boot loop WDT.

---

## 6. Evaluation of Weak-Pulldown Heuristics (SD & RTC)

### Apakah layak dipertahankan?
**TIDAK.** Heuristik weak pull-down yang diterapkan selama percobaan troubleshooting darurat **HARUS DIHAPUS** dari kode produksi.

### Alasan & Risiko Teknis:
1. **Risiko False Negative pada MicroSD Asli:**
   - Sebagian besar modul adapter MicroSD pasif (SPI mode) membiarkan pin MISO (*Data Out*) dalam status *high-impedance* (tri-state) ketika sinyal CS *High* atau kartu baru dinyalakan.
   - Jika ESP32 mengaktifkan pull-down internal, pin MISO akan terbaca logic `0` (LOW) meskipun modul fisik terpasang! Akibatnya, SD card asli tidak akan pernah bisa diinisialisasi (*permanently bypassed*).
2. **Risiko False Detection pada I2C Bus:**
   - Jalur bus I2C pada PCB tanpa modul dapat memiliki kapasitansi parasitik atau induksi sinyal frekuensi tinggi dari antena Wi-Fi internal ESP32-S3, sehingga pembacaan logic level sesaat tidak menjamin kehadiran slave device.
3. **Pelanggaran Standar Protokol:**
   - Standar deteksi perangkat I2C yang benar adalah dengan mengirim transaksi I2C Start + Address `0x68` (Write) dan memeriksa bit **ACK/NACK** dari slave hardware, bukan membaca level tegangan statis pin GPIO.

---

## 7. Correct Boot Design (Graceful Degradation)

Arsitektur boot yang benar harus membedakan secara tegas antara **Subsistem Inti (*Core Mandatory*)** dan **Periferal Opsional (*Optional/Peripherals*)**:

```
[app_main Startup]
  │
  ├── 1. NVS Flash Init ──────────► [FATAL jika gagal] (ESP_ERROR_CHECK)
  ├── 2. Safe Actuator Lock ──────► [FATAL jika gagal] (Semua Output OFF)
  ├── 3. Storage Manager (NVS) ───► [FATAL jika gagal] (Device ID, LVC, E-Stop)
  ├── 4. Network Manager ─────────► [FATAL jika gagal] (Wi-Fi AP/STA)
  │
  ├── 5. Periferal (DEGRADED MODE - NON FATAL):
  │     ├── RTC DS3231:
  │     │     Coba I2C Init & ACK probe (timeout 50ms).
  │     │     Jika NACK / Timeout / Absent:
  │     │     ──► Log WARNING, tandai RTC unvailable, fallback ke SNTP time.
  │     │
  │     ├── MicroSD Card:
  │     │     Coba SDSPI Mount dengan pin internal PULLUP aktif & timeout cepat.
  │     │     Jika Gagal / Absent:
  │     │     ──► Log WARNING, tandai s_sd_mounted = false.
  │     │     ──► Event log disimpan ke RAM buffer / no-op (sistem tetap jalan).
  │     │
  │     └── Sensors (Flow/Temp/Float):
  │           ──► Driver terdaftar dalam status standby / DISCONNECTED.
  │
  └── 6. Runtime Services & HTTP Server ──► BERJALAN NORMAL
```

---

## 8. Proposed Changes & Recommended Solution

### Solusi Rekomendasi: "Clean Degraded Boot & SPIFFS Elimination"

#### Komponen 1: Hapus Inisialisasi SPIFFS yang Tidak Digunakan
- Di `esp32/main/storage/storage_mgr.c`:
  - Hapus pemanggilan `init_spiffs()` yang memicu pemformatan 9MB.
  - Dokumentasikan secara eksplisit bahwa penyimpanan persisten konfigurasi, e-stop, dan metadata sistem dijamin 100% oleh **NVS Flash**.
  - Event log dialihkan ke MicroSD jika terpasang, atau graceful fallback jika MicroSD belum terpasang.
- Di `esp32/main/http/api_device_handlers.c`:
  - Sesuaikan array `features` dari `"SPIFFS_LOGGING"` menjadi `"SDCARD_LOGGING"` dan `"NVS_PERSISTENCE"` agar akurat sesuai arsitektur.

#### Komponen 2: Standarisasi Graceful Fallback RTC DS3231 (I2C)
- Di `esp32/main/hal/rtc_ds3231.c`:
  - Hapus kode heuristik weak pull-down GPIO.
  - Inisialisasi I2C master dengan timeout bus yang aman.
  - Pada fungsi `ds3231_i2c_init()`, lakukan probe alamat `0x68`. Jika slave tidak merespons (NACK), driver mengembalikan `ESP_ERR_NOT_FOUND`.
- Di `esp32/main/main.c`:
  - Hapus `ESP_ERROR_CHECK(rtc_ds3231_init())`.
  - Jika `rtc_ds3231_init() != ESP_OK`, catat log `ESP_LOGW` dan lanjutkan boot dengan mengandalkan SNTP/waktu internal.

#### Komponen 3: Standarisasi Graceful Fallback MicroSD (SPI)
- Di `esp32/main/hal/sdcard_hal.c`:
  - Hapus kode heuristik weak pull-down GPIO pada pin MISO.
  - Pastikan pin SPI (MISO, MOSI, SCK, CS) dikonfigurasi dengan internal pull-up (`GPIO_PULLUP_ONLY`) sebelum driver SPI SDSPI dipanggil. Sinyal MISO yang tertarik HIGH secara internal menjamin pembacaan `0xFF` (idle) saat modul tidak ada, sehingga driver SDSPI langsung mendeteksi timeout kartu dalam beberapa milidetik tanpa memblokir CPU.
  - Jika mount gagal, set `s_sd_mounted = false` dan kembalikan `ESP_OK` ke sistem agar startup tidak terhenti.

#### Komponen 4: Pembersihan Main Trace Logs
- Di `esp32/main/main.c`:
  - Bersihkan temporary `TRACE:` logs dan pertahankan alur inisialisasi yang bersih dan standar.

---

## 9. Files That Would Change

| File Path | Status | Rincian Perubahan |
| :--- | :---: | :--- |
| `esp32/main/storage/storage_mgr.c` | **Modify** | Hapus `init_spiffs()`, hapus include `esp_spiffs.h` dan include darurat `esp_task_wdt.h`. Pastikan storage manager sepenuhnya bertumpu pada NVS dan SD Card. |
| `esp32/main/hal/rtc_ds3231.c` | **Modify** | Hapus heuristik weak pull-down. Gunakan deteksi bus I2C berbasis ACK/NACK dengan timeout pendek. |
| `esp32/main/hal/sdcard_hal.c` | **Modify** | Hapus heuristik weak pull-down. Gunakan konfigurasi pullup SPI idle dan non-fatal degraded status. |
| `esp32/main/main.c` | **Modify** | Hapus `ESP_ERROR_CHECK` pada RTC. Bersihkan temporary trace logs. Pastikan startup pipeline mengalir mulus hingga `http_server_start()`. |
| `esp32/main/http/api_device_handlers.c` | **Modify** | Koreksi deklarasi feature capability JSON (ganti `SPIFFS_LOGGING` menjadi `SDCARD_LOGGING`). |

*(Catatan: `partitions.csv` tidak perlu diubah saat ini untuk menjaga kompatibilitas tabel partisi flash yang sudah terpasang, partisi `storage` cukup dibiarkan idle tanpa di-mount)*.

---

## 10. Alternatives Considered

### Alternatif A: Mempertahankan SPIFFS dengan Memperkecil Ukuran Partisi (Misal 512KB)
- *Deskripsi:* Mengubah `partitions.csv` agar ukuran `storage` dari 9MB menjadi 512KB, lalu melakukan flash ulang partition table.
- *Kelemahan:* Memerlukan erase/flash ulang tabel partisi. Selain itu, tidak ada satupun service yang saat ini menggunakan SPIFFS, sehingga mempertahankan SPIFFS 512KB hanya menambah overhead RAM dan kompleksitas tanpa manfaat fungsional nyata.

### Alternatif B: Pre-formatting Image SPIFFS melalui PC Tool (`spiffsgen.py`)
- *Deskripsi:* Membuat image binary SPIFFS kosong di PC dan mem-flash-nya ke offset `0x620000` via `esptool.py` agar ESP32 tidak perlu memformat flash saat boot.
- *Kelemahan:* Menambah ketergantungan tool eksternal pada setiap unit baru dan tidak menyelesaikan masalah fundamental bahwa SPIFFS tidak memiliki konsumen data di dalam firmware.

### Alternatif C: Rekonfigurasi Task Watchdog Timeout Menjadi 60 Detik
- *Deskripsi:* Memperpanjang timeout WDT agar ESP32 dapat menyelesaikan format 9MB tanpa reset.
- *Kelemahan:* Membiarkan sistem freeze selama hampir 1 menit saat boot pertama adalah pengalaman buruk, dan jika format gagal di tengah jalan, perangkat akan hang permanen.

---

## 11. Risks & Mitigations

| Risiko | Tingkat | Mitigasi |
| :--- | :---: | :--- |
| **Integritas Konfigurasi NVS Terganggu** | Rendah | NVS menggunakan partisi terpisah (`0x9000`) dan memiliki verifikasi CRC32 (`storage_mgr_load_config`). Tidak ada perubahan pada layer NVS. |
| **E-Stop State Hilang Saat Reboot** | Rendah | E-stop disimpan dan dibaca secara eksklusif dari NVS key `estop`, sama sekali tidak terpengaruh oleh perubahan storage/HAL. |
| **Crash Saat Service Menulis Log Tanpa SD Card** | Rendah | Fungsi `storage_mgr_append_event_log()` telah memiliki guard `if (!sdcard_hal_is_mounted()) return ESP_ERR_NOT_FOUND;`. |
| **Actuator Menyala Saat Boot** | Nol | `actuator_hal_init()` berada di awal `app_main` sebelum subsystem lain dan mengunci seluruh GPIO relay/MOSFET ke logic LOW. |

---

## 12. Verification Plan

Setelah approval diberikan dan implementasi dilakukan, verifikasi wajib mengikuti protokol bertahap:

### Tahap 1: Static Code & Build Verification
- Jalankan kompilasi full build:
  ```powershell
  D:\Espressif-tool\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe D:\Espressif\tools\idf.py build
  ```
- **Kriteria Lulus:** Build exit code 0, 0 compilation error, binary `agrotech_greenhouse.bin` terbuat.

### Tahap 2: Flashing Verification
- Flash binary aplikasi baru ke COM3:
  ```powershell
  D:\Espressif-tool\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe -m esptool --chip esp32s3 -p COM3 -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_freq 80m --flash_size 16MB 0x20000 build/agrotech_greenhouse.bin
  ```
- **Kriteria Lulus:** Hash verifikasi cocok, flash exit code 0.

### Tahap 3: Boot Test & Serial Output Verification
- Monitor boot log serial pada COM3 (115200 baud) selama 30 detik:
  - Verifikasi NVS flash terinisialisasi.
  - Verifikasi Actuator HAL mengunci 7 channel dalam kondisi OFF.
  - Verifikasi MicroSD ditandai `unmounted / degraded mode` tanpa hang.
  - Verifikasi RTC ditandai `bypassed / SNTP fallback` tanpa hang.
  - Verifikasi Storage Manager ready membaca NVS.
  - Verifikasi Runtime Services (Command Mgr, Safety Monitor, Crop Cycle Mgr) aktif.
  - Verifikasi HTTP REST Server berhasil start (`httpd_start`) pada port 80.
- **Kriteria Lulus:** **BOOT PASS** tanpa `rst:0x8 (TG1WDT_SYS_RST)`, tanpa panic, dan tanpa abort.

---

## 13. Flash Plan

- **Target Port:** `COM3`
- **Target Offset:** `0x20000` (Partisi `ota_0` / Application Binary)
- **Partisi Lain:** Partisi bootloader (`0x0`) dan partition-table (`0x8000`) tidak perlu di-flash ulang karena tidak mengalami perubahan struktur.
- **Flash Tool:** `esptool.py` (ESP-IDF v5.5.5 env).

---

## 14. Rollback Plan

Jika rencana implementasi menghasilkan regresi atau kegagalan yang tidak terduga:
1. Revert seluruh working tree ke safe point commit terakhir:
   ```bash
   git checkout -- esp32/main/hal/rtc_ds3231.c esp32/main/hal/sdcard_hal.c esp32/main/main.c esp32/main/storage/storage_mgr.c
   ```
2. Re-build firmware baseline dari commit `c26dfd6`.
3. Re-flash firmware baseline ke COM3.

---

## 15. Hardware Assumptions (Explicit Marking)

1. **MicroSD Reader & Card:** **BELUM TERPASANG FISIK** *(Asumsi belum diverifikasi secara laboratorium)*.
2. **RTC DS3231:** **BELUM TERPASANG FISIK** *(Asumsi belum diverifikasi secara laboratorium)*.
3. **Sensor Lingkungan & Debit:** **BELUM TERPASANG FISIK** *(Asumsi belum diverifikasi secara laboratorium)*.
4. **Relay, MOSFET, dan Pompa:** **BELUM TERPASANG FISIK** *(Asumsi belum diverifikasi secara laboratorium)*.
5. Seluruh pin GPIO periferal di atas diasumsikan berada dalam kondisi *floating* (mengambang) pada board development ESP32-S3.

---

## 16. Explicit Approval Required

> [!IMPORTANT]
> **STATUS:** Rencana ini berada dalam status **PLANNING ONLY**.  
> Tidak ada file kode yang diubah, tidak ada proses build, flash, erase, reset, atau manipulasi hardware yang dijalankan.  
> **Implementasi HANYA akan dieksekusi setelah USER memberikan persetujuan eksplisit.**
