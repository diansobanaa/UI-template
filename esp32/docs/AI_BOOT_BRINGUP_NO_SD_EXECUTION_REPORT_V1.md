# AI BOOT BRINGUP NO SD EXECUTION REPORT V1

**Date:** 2026-09-14  
**Target Hardware:** ESP32-S3-WROOM-1-N16R8 (USB Serial Port COM3)  
**ESP-IDF Version:** v5.5.5  
**Document Authority:** `D:\template\esp32\docs\AI_BOOT_BRINGUP_NO_SD_EXECUTION_REPORT_V1.md`  
**Execution Status:** **STOP CONDITION TRIGGERED — FAILED**  

---

## 1. Objective

Mengeksekusi safe point **BOOT BRING-UP WITHOUT MICROSD** dengan mengimplementasikan mekanisme *build-time feature flag* (`FEATURE_SDCARD_ENABLED=0`) agar firmware dapat melewati inisialisasi MicroSD reader yang belum terpasang secara fisik, mencegah *SPI SDSPI mount hang*, dan memverifikasi apakah startup dapat menyelesaikan boot hingga status *SYSTEM READY* pada kondisi hardware minimal tanpa periferal eksternal.

---

## 2. Baseline Commit

- **Commit Hash:** `6fa3b8f2d59ca454238e2ea5b443586b62d31f0c` (Short: `6fa3b8f`)  
- **Commit Message:** *SP-BOOT-REMED-001 (PARTIAL): Execute Boot Remediation V1 - SPIFFS Removed, Bounded Probes, SD Mount WDT Hang*

---

## 3. Exact Files Changed

1. `esp32/main/config/system_config.h`
2. `esp32/main/hal/sdcard_hal.c`

### Detail Perubahan:
- **`esp32/main/config/system_config.h`**:
  Menambahkan definisi feature flag perangkat keras:
  ```c
  /* Hardware Feature Flags */
  #ifndef FEATURE_SDCARD_ENABLED
  #define FEATURE_SDCARD_ENABLED      0   /* 0 = Disabled for board bring-up without microSD; 1 = Enabled when reader attached */
  #endif
  ```
- **`esp32/main/hal/sdcard_hal.c`**:
  Menambahkan `#include "config/system_config.h"` dan memisahkan alur eksekusi dengan preprocessor guard `#if !FEATURE_SDCARD_ENABLED`. Ketika bernilai `0`, fungsi `sdcard_hal_init()` langsung menandai `s_sd_mounted = false`, mencatat log warning degraded mode:
  ```text
  W (SDCARD_HAL): microSD interface DISABLED_FOR_BRINGUP (FEATURE_SDCARD_ENABLED=0). Operating in degraded mode.
  ```
  dan mengembalikan `ESP_OK` tanpa pernah menyentuh driver `esp_vfs_fat_sdspi_mount()`.

---

## 4. Feature Flag Mechanism

Mekanisme yang dipilih adalah **Compile-Time Preprocessor Definition** pada `system_config.h`:
- Bersifat non-intrusif dan tidak mengubah tabel partisi, NVS, maupun arsitektur runtime storage.
- Secara deterministik mematikan seluruh eksekusi pemanggilan driver SPI FATFS SD card pada tingkat kompilasi.
- Mengurangi ukuran binary aplikasi sebesar 67.5 KB (dari 1,004,528 bytes menjadi 936,960 bytes) karena culling simbol driver SDSPI yang tidak digunakan.

---

## 5. Build Result

- **Compiler:** Xtensa ESP32-S3 GCC 14.2.0 / ESP-IDF v5.5.5 / Ninja 1.12.1
- **Status Build:** **BUILD SUCCESS (Exit Code: 0)**
- **Binary Image:** `D:/template/esp32/build/agrotech_esp32.bin` (936,960 bytes / `0xe4c00` bytes).
- **Partition Usage:** Partisi `ota_0` (3MB) tersisa 2,208,768 bytes (`0x21b400` bytes / 70% free).
- **Warnings:** Hanya 1 compiler warning variabel statis lokal yang tidak terpakai (`s_card`) di `sdcard_hal.c` akibat pemotongan code path mount.

---

## 6. Flash Result

- **Tool:** `esptool.py` v4.12.0 via USB Serial
- **Port:** `COM3` @ 460800 baud
- **Chip:** ESP32-S3 (QFN56) revision v0.2, 16MB Flash, 8MB Octal PSRAM.
- **Status Flash:** **FLASH SUCCESS (Exit Code: 0)**
- **Verifikasi Hash:** Data hash verified (`Wrote 936960 bytes (578202 compressed) at 0x00020000 in 13.7s, Hash of data verified`).

---

## 7. Serial Boot Evidence

Pengujian boot dilakukan dengan merekam port COM3 (115200 baud) selama 50 detik setelah pengiriman sinyal reset hardware RTS/DTR.

### Log Output Serial:
```text
I (1225) main_task: Calling app_main()
I (1225) AGROTECH_MAIN: Executing safe boot: initializing all outputs to OFF state...
I (1233) AGROTECH_MAIN: Safe boot complete: 7 actuator channels locked in safe-off state.
I (1241) AGROTECH_MAIN: ==================================================
I (1247) AGROTECH_MAIN:  AgroTech-ESP32-S3 v1.0.0
I (1252) AGROTECH_MAIN:  Target Hardware : ESP32-S3-WROOM-1-N16R8
I (1257) AGROTECH_MAIN:  Contract Spec   : 1.0.0
I (1262) AGROTECH_MAIN:  Cores           : 2 (rev 2)
I (1266) AGROTECH_MAIN:  Flash Size      : 16 MB
I (1271) AGROTECH_MAIN:  Free Heap       : 8676795 bytes
I (1276) AGROTECH_MAIN:  Min Free Heap   : 8644764 bytes
I (1281) AGROTECH_MAIN: ==================================================
I (1309) pp: pp rom version: e7ae62f
I (1309) net80211: net80211 rom version: e7ae62f
I (1311) wifi:wifi driver task: 3fced520, prio:23, stack:6656, core=0
I (1322) wifi:wifi firmware version: b9f67df
I (1322) wifi:wifi certification version: v7.0
I (1322) wifi:config NVS flash: enabled
I (1323) wifi:config nano formatting: disabled
I (1398) NETWORK_MGR: SoftAP initialized. SSID:AGROTECH-SETUP
I (1411) phy_init: phy_version 712,87e8c20e,Apr 13 2026,18:51:10
I (1448) wifi:mode : sta (7c:4f:ad:2b:c4:54) + softAP (7c:4f:ad:2b:c4:55)
I (1460) NETWORK_MGR: Network Manager initialized (Wi-Fi STA + SoftAP).
I (1461) esp_netif_lwip: DHCP server started on interface WIFI_AP_DEF with IP: 192.168.4.1
I (1474) HW_REGISTRY: Initializing all hardware HAL subsystems...
I (1480) ACTUATOR_HAL: Actuator HAL initialized with 7 channels in safe OFF state.
ESP-ROM:esp32s3-20210327
Build:Mar 27 2021
rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
Saved PC:0x4037595b
```

---

## 8. Subsystem Verification Status

| Parameter Verifikasi | Hasil | Penjelasan & Bukti |
| :--- | :---: | :--- |
| **NVS Initialization** | **PASS** | `wifi:config NVS flash: enabled`, NVS flash terinisialisasi normal di `init_nvs()`. |
| **Actuator Safe-State** | **PASS** | `ACTUATOR_HAL: Actuator HAL initialized with 7 channels in safe OFF state.` Seluruh relay/MOSFET terkunci OFF. |
| **MicroSD Disabled** | **NOT REACHED** | Eksekusi terhenti sebelum mencapai `sdcard_hal_init()` pada panggilan `hardware_hal_init_all()`. |
| **RTC Absent / Degraded** | **NOT REACHED** | Belum sempat dieksekusi. |
| **SYSTEM READY** | **FAILED** | Sistem tidak pernah mencapai `http_server_start()` maupun akhir `app_main`. |
| **Watchdog Result** | **TRIGGERED** | Terjadi hardware reset `rst:0x8 (TG1WDT_SYS_RST)` pada offset waktu `1480 ms`. |

---

## 9. Failure Analysis: Titik Reset Baru

Pada pengujian sebelumnya (task-590), eksekusi berhasil menyelesaikan `hardware_hal_init_all()` hingga mencapai log `SDCARD_HAL: Initializing microSD...`. 

Namun pada build kali ini, eksekusi terhenti di dalam `hardware_hal_init_all()` tepat setelah `actuator_hal_init()` selesai dan sebelum `sensor_hal_init()` mengeluarkan log serial.

Di dalam `esp32/main/hal/hardware_registry.c`:
```c
    ESP_ERROR_CHECK(actuator_hal_init());   // <-- BERHASIL KELUAR
    ESP_ERROR_CHECK(sensor_hal_init());     // <-- TITIK TERJADINYA CRASH / HANG
    ESP_ERROR_CHECK(button_hal_init(...));
```
Pada `sensor_hal_init()` di `esp32/main/hal/sensor_hal.c`:
1. Inisialisasi interrupt GPIO flowmeter YF-B1 (GPIO 15) dan FS400A (GPIO 16) dengan `intr_type = GPIO_INTR_NEGEDGE`:
   ```c
   gpio_install_isr_service(0);
   gpio_isr_handler_add(PIN_IN_FLOW_YFB1, yfb1_isr_handler, NULL);
   gpio_isr_handler_add(PIN_IN_FLOW_FS400A, fs400a_isr_handler, NULL);
   ```
2. Pin GPIO 15 dan 16 pada board ESP32-S3 yang mengambang (*floating*) tanpa sensor fisik dapat menangkap noise frekuensi tinggi atau memicu interrupt badai (*interrupt storm*) berulang kali secara instan, sehingga CPU0 terperangkap dalam ISR context dan memicu Timer Group 1 Watchdog Reset (`TG1WDT_SYS_RST`).

---

## 10. Remaining Issues

1. **Floating GPIO Interrupt Storm pada Sensor HAL:**
   Pengaktifan edge interrupt (`GPIO_INTR_NEGEDGE`) pada pin GPIO input flow meter (GPIO 15 & 16) tanpa filter debounce atau saat pin mengambang menyebabkan interrupt terus menerus terpicu.
2. **Firmware Belum Menyelesaikan Booting:**
   Firmware ESP32-S3 belum dapat menyelesaikan boot hingga `SYSTEM READY`.

---

## 11. Final Status

# **FAILED (STOP CONDITION TRIGGERED)**

Sesuai instruksi STOP CONDITION:
> *"Jika terjadi WDT reset, boot hang, panic/Guru Meditation: STOP IMMEDIATELY. Jangan melakukan remediation kedua secara spekulatif."*

Seluruh proses kompilasi, flashing, dan eksekusi telah **DIHENTIKAN SEKETIKA**. Tidak ada modifikasi kode spekulatif lanjutan yang dilakukan.

---

## 12. Recommended Next Action

*(Rekomendasi teknis untuk ditinjau oleh user; tidak dijalankan tanpa instruksi baru)*:

1. **Nonaktifkan Interrupt pada Pin Floating Selama Bring-Up:**
   Konfigurasi interrupt flowmeter (`GPIO_INTR_NEGEDGE`) pada `sensor_hal_init()` sebaiknya di-guard dengan feature flag (misal `FEATURE_FLOW_INTERRUPTS_ENABLED 0`) atau hanya dikonfigurasi sebagai input biasa dengan pull-up internal tanpa mendaftarkan ISR aktif selama fase bring-up tanpa sensor fisik, untuk mencegah interrupt storm yang memblokir CPU.
2. **Tinjau Perilaku Floating Input pada Board ESP32-S3:**
   Pastikan pin flowmeter dan button tidak memicu ISR sebelum sensor fisik dan kabel terpasang dengan benar.
