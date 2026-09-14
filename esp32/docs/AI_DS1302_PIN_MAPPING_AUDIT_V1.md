# FULL GPIO REMAPPING AUDIT (ESP32-S3-WROOM-1-N16R8)

**Date:** 2026-09-15  
**Hardware:** ESP32-S3-WROOM-1-N16R8 (USB Serial COM3)  
**Status:** **AUDIT ONLY — NO CODE CHANGE — NO BUILD — NO FLASH**

Berdasarkan data pin fisik aktual (header kiri 22 pin, kanan 22 pin) dan konfigurasi memori N16R8 (Octal Flash 16MB + Octal PSRAM 8MB), berikut adalah hasil audit elektrikal penuh:

## 1. ELECTRICAL STATUS & SAFETY CLASSIFICATION

- **A. VERIFIED SAFE:** Pin GPIO murni yang tidak terikat memori, strapping, atau fungsi sistem kritis. Aman untuk In/Out.
- **B. ACCEPTABLE WITH CAVEAT:** Pin yang bisa digunakan, namun memiliki kondisi khusus (harus HIGH saat boot, atau terhubung ke fungsi sekunder seperti LED/USB).
- **C. DO NOT USE:** Pin yang berisiko fatal jika digunakan (Flash/PSRAM, UART Console, Strapping kritis).

---

## 2. FINAL GPIO AUDIT TABLE

| FUNCTION / HARDWARE | CURRENT GPIO | PHYSICAL HEADER | ELECTRICAL STATUS | RECOMMENDED GPIO | REASON | RISK |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Well Pump** | 1 | Kanan-4 | A. VERIFIED SAFE | **1** | Safe general GPIO, output suitable. | Low |
| **Distribution Pump** | 2 | Kanan-5 | A. VERIFIED SAFE | **2** | Safe general GPIO, output suitable. | Low |
| **Raw-Water Pump** | 4 | Kiri-4 | A. VERIFIED SAFE | **4** | Safe general GPIO, output suitable. | Low |
| **Dosing A** | 5 | Kiri-5 | A. VERIFIED SAFE | **5** | Safe general GPIO, output suitable. | Low |
| **Dosing B** | 6 | Kiri-6 | A. VERIFIED SAFE | **6** | Safe general GPIO, output suitable. | Low |
| **Cooling Fan** | 7 | Kiri-7 | A. VERIFIED SAFE | **7** | Safe general GPIO, output suitable. | Low |
| **Error Lamp** | 18 | Kiri-11 | A. VERIFIED SAFE | **18** | Safe general GPIO, output suitable. | Low |
| **W5500 CS** | 10 | Kiri-16 | A. VERIFIED SAFE | **10** | Safe general GPIO, output suitable. | Low |
| **SPI SCK** | 11 | Kiri-17 | A. VERIFIED SAFE | **11** | Safe general GPIO, output suitable. | Low |
| **SPI MOSI** | 12 | Kiri-18 | A. VERIFIED SAFE | **12** | Safe general GPIO, output suitable. | Low |
| **SPI MISO** | 13 | Kiri-19 | A. VERIFIED SAFE | **13** | Safe general GPIO, input suitable. | Low |
| **TFT CS** | 14 | Kiri-20 | A. VERIFIED SAFE | **14** | Safe general GPIO, output suitable. | Low |
| **TFT DC** | 21 | Kanan-18 | A. VERIFIED SAFE | **21** | Safe general GPIO, output suitable. | Low |
| **TFT RST** | 42 | Kanan-6 | A. VERIFIED SAFE | **42** | Safe general GPIO, output suitable. | Low |
| **YF-B1 (Flow 1)** | 15 | Kiri-8 | A. VERIFIED SAFE | **15** | Safe general GPIO, input suitable. | Low |
| **FS400A (Flow 2)** | 16 | Kiri-9 | A. VERIFIED SAFE | **16** | Safe general GPIO, input suitable. | Low |
| **DS18B20 (Temp)** | 17 | Kiri-10 | A. VERIFIED SAFE | **17** | Safe general GPIO, in/out suitable. | Low |
| **Btn: Mode** | 38 | Kanan-10 | A. VERIFIED SAFE | **38** | Safe general GPIO, input suitable. | Low |
| **Btn: Manual A** | 39 | Kanan-9 | A. VERIFIED SAFE | **39** | Safe general GPIO, input suitable. | Low |
| **Btn: Manual B** | 40 | Kanan-8 | A. VERIFIED SAFE | **40** | Safe general GPIO, input suitable. | Low |
| **Btn: Distribution** | 41 | Kanan-7 | A. VERIFIED SAFE | **41** | Safe general GPIO, input suitable. | Low |
| **DS1302 CLK** | *None (Ex I2C)* | Kiri-12 | A. VERIFIED SAFE | **8** | Safe general GPIO (DS3231 dilepas). | Low |
| **DS1302 DAT** | *None (Ex I2C)* | Kiri-15 | A. VERIFIED SAFE | **9** | Safe general GPIO (DS3231 dilepas). | Low |
| **DS1302 RST** | *None* | Kanan-17 | A. VERIFIED SAFE | **47** | Safe general GPIO, output suitable. | Low |
| **Lower Float** | 19 / 26 (Invalid) | Kanan-20 | B. ACCEPTABLE WITH CAVEAT | **19** | USB D- pin. Aman digunakan sebagai GPIO jika port USB Native (bukan COM3 UART) tidak digunakan. Input suitable. | Medium |
| **MicroSD CS** | 27 (Invalid) | Kanan-16 | B. ACCEPTABLE WITH CAVEAT | **48** | Aman digunakan sebagai output CS. *Caveat*: Sering terhubung ke Onboard RGB LED, mungkin berkedip saat akses SD. | Low |

---

## 3. UNUSABLE & DANGEROUS PINS (DO NOT USE)

Pin berikut **ADA DI HEADER FISIK**, namun secara elektrikal **HARAM** digunakan pada N16R8 untuk periferal apa pun:

1. **GPIO 35, 36, 37** (Sisi Kanan)
   - **Status:** C. DO NOT USE
   - **Alasan:** Terhubung ke Data Bus Octal PSRAM. Menghubungkan tombol/sensor ke sini akan merusak lalu lintas memori, memicu Watchdog Reset / Kernel Panic seketika.
2. **TXD0 / RXD0 (GPIO 43/44)**
   - **Status:** C. DO NOT USE
   - **Alasan:** UART0 Console (Port COM3 yang Anda gunakan). Menghubungkan alat di sini akan memutus koneksi log dan flash dari PC.
3. **GPIO 3, 45, 46**
   - **Status:** C. DO NOT USE
   - **Alasan:** Strapping Pins. Harus berada di state tegangan tertentu saat boot. Mengubah tegangannya akan menyebabkan ESP32 gagal masuk ke mode operasi.
4. **GPIO 0** (Tombol BOOT)
   - **Status:** B. ACCEPTABLE WITH CAVEAT (Lebih baik dihindari)
   - **Alasan:** Bisa digunakan sebagai input tombol eksternal, asalkan tidak tertekan (LOW) secara tidak sengaja saat board di-reset. 
5. **GPIO 20** (USB D+)
   - **Status:** B. ACCEPTABLE WITH CAVEAT
   - **Alasan:** Cadangan, belum direkomendasikan kecuali kehabisan pin.

---

## 4. FINAL CANDIDATES (UNRESOLVED HARDWARE)

Berdasarkan audit di atas, untuk 5 hardware yang pinnya butuh direlokasi/ditentukan, berikut adalah rekomendasi final yang **aman**:

1. **DS1302 CLK** → **GPIO 8** (Eks SDA)
2. **DS1302 DAT** → **GPIO 9** (Eks SCL)
3. **DS1302 RST** → **GPIO 47** (Free / Safe)
4. **MicroSD CS** → **GPIO 48** (Free / RGB LED)
5. **Lower Float** → **GPIO 19** (Eks USB D-, input aman jika Native USB kosong)

> [!NOTE]
> Pemetaan 21 pin hardware lama (W5500, TFT, Sensors, Buttons, Actuators) telah diverifikasi 100% AMAN (Verified Safe) dan TIDAK PERLU DIUBAH.

Menunggu persetujuan Anda (*Approval*) sebelum saya mengedit `pin_config.h` dan mulai memperbarui driver DS1302.
