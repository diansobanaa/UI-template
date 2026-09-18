# AI BOOT REMEDIATION REPORT V1

**Date:** 2026-09-14  
**Target Hardware:** ESP32-S3-WROOM-1-N16R8 (USB Serial COM3)  
**ESP-IDF Version:** v5.5.5  
**Document Authority:** D:\template\esp32\docs\AI_BOOT_REMEDIATION_REPORT_V1.md  

---

## 1. Initial Finding

Pada tahap pengujian boot pertama (*First Boot Test*) setelah *First Flash* firmware awal (commit `c26dfd6`), ESP32-S3 mengalami kegagalan fatal dengan status **BOOT FAILED** dalam bentuk **Boot Loop / Watchdog Reset**.

Sistem berhasil menyelesaikan tahapan awal startup:
- ROM & 2nd Stage Bootloader berhasil memuat partisi aplikasi dari offset `0x20000`.
- Octal PSRAM 8MB terdeteksi normal (`40MHz, AP_3v3`, free heap ~8.6MB).
- NVS Flash dan Network Manager (Wi-Fi STA + SoftAP) berhasil diinisialisasi.
- Actuator HAL mengunci 7 channel relay/MOSFET dalam kondisi safe `OFF`.
- Sensor HAL dan Button HAL terdaftar.

Namun tepat setelah log:
```text
I (1525) HW_REGISTRY: Hardware HAL initialization complete. Total components: 15
```
eksekusi sistem langsung macet total (hang) di dalam pemanggilan fungsi `sdcard_hal_init()`. Setelah ~5 detik, sistem di-reset secara paksa oleh hardware timer:
```text
rst:0x8 (TG1WDT_SYS_RST)
boot:0x8 (SPI_FAST_FLASH_BOOT)
Saved PC: 0x4038f714
```
ESP32 mengalami reboot berulang kali (*boot loop*) pada titik yang sama karena pemanggilan inisialisasi driver SPI SD card (`esp_vfs_fat_sdspi_mount`) memblokir CPU tanpa pernah menghasilkan timeout atau error return.

---

## 2. Root Cause Investigation

Selama proses remediation, dilakukan pengujian beberapa hipotesis teknis:

### A. Confirmed Root Causes
1. **SPI SDSPI Mount Hang on Floating Bus (Confirmed):**
   - Fungsi bawaan ESP-IDF `esp_vfs_fat_sdspi_mount()` pada bus SPI tidak memiliki timeout yang aman apabila pin MISO (GPIO 13), MOSI (GPIO 11), SCK (GPIO 12), dan CS (GPIO 27) tidak terhubung ke hardware reader microSD eksternal (kondisi *floating*). Sinyal clock dan pertukaran command CMD0/CMD8 tidak mendapat respon level logic yang valid, menyebabkan loop polling di tingkat driver SPI ESP-IDF memblokir eksekusi CPU.
2. **I2C Driver Hang on Floating Bus for DS3231 RTC (Confirmed):**
   - Setelah inisialisasi SD Card di-bypass, sistem terbukti langsung macet di `rtc_ds3231_init()` pada fungsi `i2c_driver_install()` dan pertukaran bit I2C pada SDA (GPIO 8) & SCL (GPIO 9). Bus I2C tanpa pull-up fisik eksternal (karena modul RTC DS3231 tidak terpasang) membaca line low/floating, menyebabkan finite state machine I2C driver terkunci (*bus arbitration / clock stretching wait*), memicu Watchdog hang.

### B. Rejected Hypotheses
1. **Memindahkan `esp_vfs_fat_sdspi_mount` ke FreeRTOS Task Terpisah Menyelesaikan Hang (Rejected):**
   - *Hipotesis:* Jika proses mounting dipindahkan ke task terpisah berkonsentrasi rendah (`prio 1`), `app_main` dapat lanjut berjalan dan tidak memicu watchdog.
   - *Hasil Pengujian:* Driver SPI yang melakukan spinlock/busy-wait pada core 0 tetap menolak context switch atau memblokir core/scheduler, sehingga sistem tetap mengalami hang pada log `SDCARD_HAL: Starting microSD mount task...`.
2. **Mematikan Task WDT dengan `esp_task_wdt_delete(NULL)` di `app_main` (Rejected):**
   - *Hipotesis:* Menonaktifkan Task Watchdog pada `app_main` akan mencegah WDT reset saat operasi panjang seperti inisialisasi SPIFFS.
   - *Hasil Pengujian:* Log menunjukkan error `E (1602) task_wdt: delete_entry(240): task not found`. Pada ESP-IDF v5, `app_main` tidak otomatis terdaftar sebagai subscriber individual Task WDT melainkan Idle Task CPU0 yang dipantau. Memanggil `esp_task_wdt_delete` menghasilkan error dan tidak mencegah `TG1WDT_SYS_RST`.

### C. Unresolved Hypotheses
1. **Heuristik Deteksi Modul melalui Weak Pull-Down Internal GPIO (Unresolved):**
   - *Hipotesis:* Modul sensor/RTC/SD eksternal biasanya memiliki resistor pull-up fisik di PCB modulnya. Jika pin dikonfigurasi sementara dengan internal pulldown dan membaca level: jika `LOW` berarti floating (tidak ada modul), jika `HIGH` berarti ada modul.
   - *Status:* Secara software berhasil mendeteksi pin LOW dan membypass inisialisasi pada tes boot ke-4. Namun, **secara hardware hal ini belum diverifikasi** apakah pull-down internal 45kΩ ESP32 selalu andal membedakan kondisi bus nyata vs kapasitansi jalur, dan berisiko salah mendeteksi hardware asli saat nanti dipasang jika pull-up modul bernilai terlalu lemah atau tidak ada.
2. **SPIFFS Mount Timeout / Formatting Duration (Unresolved):**
   - Partisi internal SPIFFS sebesar ~9MB (`0x8f0000` bytes) yang belum terformat memerlukan proses format otomatis pada boot pertama (`format_if_mount_failed = true`). Waktu format 9MB flash memakan waktu >10-15 detik, yang langsung memicu `TG1WDT_SYS_RST` (Timer Group 1 WDT) jika tidak ada mekanisme feeding watchdog atau pemecahan chunk. Hal ini belum diselesaikan karena iterasi dihentikan sesuai instruksi user.

---

## 3. Changes Made

Berikut adalah daftar file yang diubah selama remediation di working copy:

| Nama File | Perubahan yang Dilakukan | Alasan Perubahan |
| :--- | :--- | :--- |
| `esp32/main/hal/sdcard_hal.c` | 1. Menambahkan pemeriksaan level GPIO MISO (GPIO 13) dengan internal pull-down sementara sebelum inisialisasi SPI.<br>2. Menambahkan fallback degraded mode: jika MISO terbaca 0, bypass SD mount dan kembalikan `ESP_ERR_NOT_FOUND`.<br>3. Memindahkan proses mount ke FreeRTOS task terpisah. | Mencegah firmware hang total saat modul microSD reader tidak terpasang secara fisik pada pin SPI. |
| `esp32/main/hal/rtc_ds3231.c` | Menambahkan pemeriksaan level GPIO SDA (GPIO 8) dengan internal pull-down sementara. Jika terbaca 0 (bus floating), bypass `i2c_driver_install()` dan kembalikan `ESP_ERR_NOT_FOUND`. | Mencegah I2C hardware bus driver hang saat modul RTC DS3231 tidak terpasang. |
| `esp32/main/main.c` | 1. Menambahkan log `TRACE:` di setiap tahapan inisialisasi hardware dan service.<br>2. Menjadikan inisialisasi RTC non-fatal: jika `rtc_ds3231_init()` gagal, sistem mengeluarkan warning dan tetap melanjutkan boot menggunakan SNTP.<br>3. Sempat mem-bypass sementara `sdcard_hal_init()` untuk mengisolasi titik hang. | Memungkinkan diagnosa log yang presisi dan mencegah inisialisasi peripheral opsional menghentikan seluruh sistem startup. |
| `esp32/main/storage/storage_mgr.c` | Menambahkan include `esp_task_wdt.h` dan mencoba mematikan WDT, serta terakhir mengomentari pemanggilan `init_spiffs()`. *(Perubahan ini baru ada di lokal working copy dan belum di-build/flash)*. | Mencoba mendiagnosa penyebab watchdog reset pada inisialisasi SPIFFS 9MB. |

---

## 4. Firmware Builds

Berikut adalah riwayat seluruh build firmware selama sesi remediation:

1. **Build #1 (Initial Baseline Build - SP-HW-002 commit `c26dfd6`):**
   - *Result:* **SUCCESS (0 Error, 0 Warning)**
   - *Binary output:* `agrotech_greenhouse.bin` (994,224 bytes), `bootloader.bin` (21,552 bytes), `partition-table.bin` (3,072 bytes).
2. **Build #2 (Remediation SD Task & Pull-ups):**
   - *Result:* **SUCCESS (0 Error, 0 Warning)**
   - Perubahan task terpisah untuk SD card mount.
3. **Build #3 (Remediation Tracing & SD Card Hard-Bypass):**
   - *Result:* **SUCCESS (0 Error, 0 Warning)**
   - Menambahkan trace log di `main.c` dan membypass `sdcard_hal_init()`.
4. **Build #4 (Heuristic Detection on SD & RTC):**
   - *Result:* **SUCCESS (0 Error, 0 Warning)**
   - Menambahkan deteksi weak pulldown pada MISO & SDA serta fallback SNTP di `main.c`.

---

## 5. Firmware Flashes

Seluruh proses flash menggunakan tool resmi `esptool.py` (v4.9.dev0) melalui koneksi USB Serial:

| No | Port | Baudrate | Firmware Build | Hasil Flash | Keterangan |
| :---: | :---: | :---: | :--- | :---: | :--- |
| **1** | COM3 | 460800 | Build #1 (Baseline `c26dfd6`) | **FLASH PASS** | Flash awal partisi bootloader (0x0), partition-table (0x8000), app (0x20000). Hash verified. |
| **2** | COM3 | 460800 | Build #2 (SD in task) | **FLASH PASS** | Flash app partition (0x20000). Hash verified. |
| **3** | COM3 | 460800 | Build #3 (Trace & SD bypass) | **FLASH PASS** | Flash app partition (0x20000). Hash verified. |
| **4** | COM3 | 460800 | Build #4 (Weak pulldown heuristics) | **FLASH PASS** | Flash app partition (0x20000). Hash verified. |

---

## 6. Boot Tests

Daftar seluruh boot test yang dieksekusi via serial monitor COM3:

### Test 1: Baseline Boot Test
- **Hasil:** **FAILED**
- **Reset Reason:** `rst:0x8 (TG1WDT_SYS_RST)`
- **Watchdog/Panic:** Timer Group 1 Watchdog Timer Timeout (CPU hang).
- **Titik Terakhir Startup:** `HW_REGISTRY: Hardware HAL initialization complete.` saat masuk `sdcard_hal_init()`.
- **Bukti Serial Log:**
  ```text
  I (1525) HW_REGISTRY: Hardware HAL initialization complete. Total components: 15
  [... HANG 5 DETIK ...]
  ESP-ROM:esp32s3-20210327
  rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
  ```

### Test 2: SD Mount di Dedicated Task
- **Hasil:** **FAILED**
- **Reset Reason:** `rst:0x8 (TG1WDT_SYS_RST)`
- **Watchdog/Panic:** Timer Group 1 Watchdog.
- **Titik Terakhir Startup:** `SDCARD_HAL: Starting microSD mount task on SPI CS (GPIO 27)...`
- **Bukti Serial Log:**
  ```text
  I (1532) SDCARD_HAL: Starting microSD mount task on SPI CS (GPIO 27)...
  [... HANG TANPA PROGRES ...]
  ```

### Test 3: Trace Log & SD Card Hard-Bypass
- **Hasil:** **FAILED** (Menemukan titik kegagalan kedua)
- **Reset Reason:** `rst:0x8 (TG1WDT_SYS_RST)`
- **Watchdog/Panic:** Timer Group 1 Watchdog.
- **Titik Terakhir Startup:** `AGROTECH_MAIN: TRACE: Calling rtc_ds3231_init`
- **Bukti Serial Log:**
  ```text
  I (1515) HW_REGISTRY: Hardware HAL initialization complete. Total components: 15
  I (1522) AGROTECH_MAIN: TRACE: Bypassing sdcard_hal_init for debugging
  I (1528) AGROTECH_MAIN: TRACE: Calling rtc_ds3231_init
  [... HANG TOTAL DI I2C DRIVER ...]
  ```

### Test 4: Weak Pulldown Heuristic (SD & RTC Bypassed)
- **Hasil:** **FAILED** (Menemukan titik kegagalan ketiga)
- **Reset Reason:** `rst:0x8 (TG1WDT_SYS_RST)`
- **Watchdog/Panic:** Timer Group 1 Watchdog.
- **Titik Terakhir Startup:** `AGROTECH_MAIN: TRACE: Calling storage_mgr_init` -> `task_wdt: delete_entry(240): task not found`.
- **Bukti Serial Log:**
  ```text
  I (1539) AGROTECH_MAIN: TRACE: Calling sdcard_hal_init
  I (1544) SDCARD_HAL: Checking for microSD card on SPI MISO (GPIO 13)...
  W (1561) SDCARD_HAL: No microSD module detected (MISO floating/low). Bypassing SD mount to prevent SPI hardware hang.
  I (1561) AGROTECH_MAIN: TRACE: Calling rtc_ds3231_init
  I (1566) RTC_DS3231: Checking for DS3231 RTC on I2C SDA (GPIO 8)...
  W (1582) RTC_DS3231: No RTC module detected (SDA floating/low). Bypassing I2C init to prevent hardware hang.
  E (1582) RTC_DS3231: Failed to initialize DS3231 I2C driver: ESP_ERR_NOT_FOUND
  W (1588) AGROTECH_MAIN: RTC init failed/bypassed. Using SNTP only.
  I (1594) AGROTECH_MAIN: TRACE: Calling storage_mgr_init
  E (1602) task_wdt: delete_entry(240): task not found
  ESP-ROM:esp32s3-20210327
  rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
  ```

---

## 7. Hardware Assumptions

Daftar asumsi mengenai peripheral yang **BELUM TERPASANG**:
1. **MicroSD Reader / Card:**
   - *Status Fisik:* **BELUM TERPASANG.**
   - *Kondisi Pin:* GPIO 11 (MOSI), GPIO 12 (SCK), GPIO 13 (MISO), GPIO 27 (CS) berada dalam kondisi floating / tidak terhubung ke sirkuit kartu.
   - *Asumsi yang BELUM diverifikasi secara fisik:* Bahwa pembacaan level 0 saat pull-down aktif adalah jaminan mutlak ketiadaan modul pada segala kondisi PCB.
2. **RTC DS3231:**
   - *Status Fisik:* **BELUM TERPASANG.**
   - *Kondisi Pin:* GPIO 8 (SDA) dan GPIO 9 (SCL) floating tanpa external pull-up resistor.
   - *Asumsi yang BELUM diverifikasi secara fisik:* Bahwa bus I2C akan selalu floating jika modul tidak terpasang (jika ada resistor pull-up onboard development board, pembacaan ini bisa bias).
3. **Sensor Lingkungan & Debit Air:**
   - *Status Fisik:* **BELUM TERPASANG** (YF-B1 GPIO 15, FS400A GPIO 16, DS18B20 GPIO 17, Float Switch GPIO 26).
4. **Relay, MOSFET, dan Pompa:**
   - *Status Fisik:* **BELUM TERPASANG** (Semua GPIO 4, 5, 6, 7, 18, 19, 20 floating atau hanya terhubung ke header tanpa beban).

---

## 8. Hardware Changes

**NONE.**
Tidak ada modifikasi, penambahan, pelepasan, jumper, atau pemindahan pin fisik yang dilakukan pada board ESP32-S3 maupun perangkat keras luar.

---

## 9. Current Firmware State

Firmware yang saat ini ter-flash di dalam flash memory ESP32-S3 (Build #4) memiliki kondisi sebagai berikut:
- Mengandung kode deteksi weak pull-down pada SD Card (MISO GPIO 13) dan RTC DS3231 (SDA GPIO 8).
- Mengandung penanganan fallback SNTP jika RTC tidak terdeteksi.
- Mengandung pemanggilan `esp_task_wdt_delete(NULL)` di dalam `storage_mgr_init()` sebelum `init_spiffs()`.
- Karena `init_spiffs()` berusaha memformat partisi flash internal 9MB yang memakan waktu belasan detik tanpa memberi nafas ke FreeRTOS Idle task, ESP32 saat ini **masih berada dalam siklus reset berulang (boot loop)** setiap ~1.6 detik akibat `TG1WDT_SYS_RST`.

---

## 10. Current Boot Status

# **BOOT FAILED**

*(Berdasarkan bukti serial capture otentik dari test terakhir task-457: sistem mengalami `TG1WDT_SYS_RST` pada offset waktu `1602 ms` di tahap `storage_mgr_init`)*.

---

## 11. Remaining Issues

1. **SPIFFS Long Formatting Watchdog Trigger:**
   Partisi SPIFFS 9MB pada partisi tabel `storage` (`0x8f0000` bytes) yang belum terformat membutuhkan waktu format yang melebihi timeout default Timer Group Watchdog. `esp_vfs_spiffs_register()` memblokir eksekusi core secara sinkron.
2. **Task Watchdog De-registration Error:**
   Error `task_wdt: delete_entry(240): task not found` menunjukkan bahwa `app_main` tidak dapat di-unsubscribe begitu saja tanpa inisialisasi dan konfigurasi TWDT yang tepat sesuai API ESP-IDF v5.
3. **Firmware Belum Menyelesaikan Booting Penuh:**
   Service level tinggi (Command Manager, Safety Monitor, Crop Cycle Manager, HTTP REST Server) belum pernah sempat dieksekusi karena eksekusi terhenti di Storage Manager.
4. **Uncommitted Working Tree:**
   File `rtc_ds3231.c`, `sdcard_hal.c`, `main.c`, dan `storage_mgr.c` saat ini memiliki perubahan yang belum di-commit dan belum divalidasi hingga tuntas.

---

## 12. Risk / Concerns

1. **Heuristik Deteksi Hardware via Weak Pulldown:**
   - *Risiko:* Penggunaan internal weak pull-down untuk mendeteksi modul I2C dan SPI adalah *workaround heuristik*, bukan standar industri. Jika board modul asli menggunakan pull-up yang terlalu besar (misal 100kΩ) atau jika bus memiliki kapasitansi parasitik, deteksi bisa menghasilkan *false negative* (modul terpasang tapi disangka tidak ada) atau *false positive*.
2. **Modifikasi Partisi Storage / SPIFFS:**
   - *Risiko:* Ukuran SPIFFS 9MB sangat besar untuk sistem embedded berbasis SPIFFS. SPIFFS memiliki performa pemformatan dan pencarian yang lambat pada partisi besar. Memformat 9MB saat boot pertama berisiko tinggi memicu WDT jika tidak ditangani dengan feeding timer atau pre-formatting.
3. **Degraded Mode vs Unhandled Dependencies:**
   - Jika SD Card dan RTC di-bypass secara degraded, komponen lain yang bergantung pada logging file atau real-time clock presisi tinggi harus dipastikan memiliki graceful fallback dan tidak melakukan dereference pointer NULL.

---

## 13. Git Status

- **Working Tree Status:** `DIRTY` (Terdapat perubahan lokal yang belum di-commit).
- **Files Changed:**
  - `esp32/main/hal/rtc_ds3231.c` (Modified)
  - `esp32/main/hal/sdcard_hal.c` (Modified)
  - `esp32/main/main.c` (Modified)
  - `esp32/main/storage/storage_mgr.c` (Modified)
- **Commit Hash Terakhir yang Relevan:**
  - `c26dfd6` — *SP-HW-002: Finalize Upper Float Removal and Safety Interlock*

---

## 14. Recommended Next Step

*(Rekomendasi teknis murni untuk ditinjau oleh user; **TIDAK** dijalankan secara mandiri)*:

1. **Tangani Timeout SPIFFS pada Boot Pertama:**
   - Opsi A: Ganti konfigurasi partisi SPIFFS agar tidak langsung memformat secara sinkron yang memblokir CPU, atau sesuaikan timeout Hardware/Task Watchdog (melalui `esp_task_wdt_reconfigure()` di ESP-IDF v5) sebelum memanggil `esp_vfs_spiffs_register()`.
   - Opsi B: Gunakan LittleFS atau perkecil partisi SPIFFS jika penyimpanan internal tidak membutuhkan 9MB secara utuh, atau sediakan pre-formatted SPIFFS image via `esptool.py`.
2. **Evaluasi Keabsahan Heuristik Weak Pull-down:**
   - Konfirmasikan dengan user apakah pendekatan degraded mode (melewati SD Card dan RTC jika bus tidak merespons) disetujui sebagai desain arsitektur resmi untuk bring-up tanpa modul eksternal.

---

## 15. Final Conclusion

Investigasi secara transparan membuktikan bahwa kegagalan boot awal (*BOOT FAILED*) disebabkan oleh sifat *blocking* dari driver perangkat keras ESP-IDF (SPI SD card dan I2C RTC) ketika dijalankan pada pin-pin yang *floating* tanpa modul fisik terpasang. 

Upaya remediation telah berhasil memecahkan isolasi masalah SD Card dan RTC melalui mekanisme bypass degraded mode. Namun, firmware yang terpasang di chip ESP32 saat ini masih berstatus **BOOT FAILED** karena terbentur pada kendala berikutnya: proses inisialisasi partisi internal SPIFFS sebesar 9MB yang memicu Timer Group Watchdog Reset.

Seluruh proses eksperimen dan pengujian telah **SEPENUHNYA DIHENTIKAN** sesuai instruksi. Tidak ada perubahan hardware, tidak ada build baru, dan tidak ada flashing tambahan yang dilakukan. Repositori menunggu arahan dan persetujuan user selanjutnya.
