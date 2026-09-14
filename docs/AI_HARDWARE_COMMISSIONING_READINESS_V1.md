# AI HARDWARE COMMISSIONING READINESS REPORT (V1)
**Safe Point**: `SP-REMED-014`  
**Date**: 2026-09-14  
**Target Hardware**: ESP32-S3-WROOM-1-N16R8 (16MB Flash, 8MB Octal PSRAM)  
**Authority**: `template/contracts/UI_ESP32_OPENAPI.yaml`, `esp32/main/config/pin_config.h`, `ESP32_ASSEMBLY_GUIDE.md`  
**Status**: SOFTWARE READY FOR FIRST FLASH & COMMISSIONING (PHYSICAL HARDWARE UNVERIFIED)

---

## 1. Hardware yang Akan Diuji

Sistem kontrol greenhouse AgroTech melibatkan kombinasi modul digital, antarmuka sensor analog/pulsa, driver switching, dan sirkuit daya AC/DC. Komponen yang disiapkan untuk commissioning:

| Modul / Komponen | Tipe / Part Reference | Peran Sistem | Status Verifikasi Fisik |
|---|---|---|---|
| **MCU Board** | ESP32-S3-WROOM-1-N16R8 / DevKitC-1 | Controller utama, web server, runtime scheduler, safety authority | `PHYSICAL VERIFICATION REQUIRED` (board layout & jumper USB/UART) |
| **Relay Board** | 8-Channel Optocoupled Relay Board (5V/12V) | Antarmuka switching beban AC 220V dan pompa dosing DC 12V | `VERIFY DATASHEET` (active trigger level, optocoupler isolation jumper) |
| **Flow Sensor 1** | YF-B1 (DN15, G1/2") Hall-Effect | Pengukuran volume nutrisi pada loop fertigasi utama | `VERIFY DATASHEET / CALIBRATE PHYSICALLY` |
| **Flow Sensor 2** | FS400A (G1") Hall-Effect | Pengukuran volume air baku pada jalur intake/suplai | `VERIFY DATASHEET / CALIBRATE PHYSICALLY` |
| **Suhu Air** | DS18B20 Waterproof Probe (1-Wire) | Pemantauan suhu tangki nutrisi | `VERIFY DATASHEET` (external 4.7kΩ pull-up requirement) |
| **Pelampung Tangki** | Stainless Steel Vertical Float Switch | Deteksi batas level bawah / proteksi dry-run | `VERIFY ORIENTATION PHYSICALLY` (NO vs NC switch state) |
| **RTC Eksternal** | DS3231 I2C RTC Module + Battery CR2032 | Otoritas waktu persist saat controller offline / power cut | `PHYSICAL VERIFICATION REQUIRED` (I2C address 0x68, 3.3V power) |
| **Storage Lokal** | MicroSD Card SPI Adapter Module | Penyimpanan audit log sirkuler dan cadangan telemetri | `PHYSICAL VERIFICATION REQUIRED` (FAT32 filesystem, Class 10/SLC) |
| **Display Lokal** | ST7789 / ILI9341 SPI TFT (2.8" / 3.2") | Display status lokal (reserved / optional Phase 2) | `OPTIONAL FOR INITIAL FLASH` (SPI CS pin reserved) |
| **Ethernet Controller** | W5500 SPI Ethernet Module | Hardwired LAN interface (reserved / secondary fallback) | `RESERVED` (Wi-Fi STA+SoftAP diaktifkan sebagai default Phase 1) |
| **Tombol Fisik** | 4x Panel Push Button (Momentary NO) | Mode, Manual A, Manual B, Distribusi | `VERIFY WIRING PHYSICALLY` |
| **Power Supply** | AC-DC 12V Industrial DIN-Rail + Buck 5V 3A | Suplai domain daya logika 5V/3.3V dan domain aktuator 12V | `MEASURE VOLTAGE BEFORE CONNECTION` |

---

## 2. Hubungan Komponen Utama

Arsitektur interkoneksi hardware controller digambarkan sebagai berikut:

```text
               +-------------------------------------------------------------+
               |                  ESP32-S3-WROOM-1-N16R8                     |
               |                                                             |
               |  GPIO 8 (SDA)  <====== I2C Bus ======> DS3231 RTC Module    |
               |  GPIO 9 (SCL)                          (Add: 0x68, 3.3V)   |
               |                                                             |
               |  GPIO 11 (SCK) <====== SPI Bus ======> MicroSD Card (CS:27) |
               |  GPIO 12 (MOSI)                        W5500 ETH    (CS:10) |
               |  GPIO 13 (MISO)                        TFT Display  (CS:14) |
               |                                                             |
               |  GPIO 17 (1-Wire) <==================> DS18B20 Temp Probe   |
               |  GPIO 15 (Pulse)  <--- [Level Div] <-- YF-B1 Flow Sensor    |
               |  GPIO 16 (Pulse)  <--- [Level Div] <-- FS400A Flow Sensor   |
               |  GPIO 26 (Digital)<------------------- Lower Float Switch   |
               |  GPIO 38-41 (In)  <------------------- 4x Push Buttons      |
               |                                                             |
               |  GPIO 1 (Out)    --------------------> Relay Ch 1 (Well)    |
               |  GPIO 2 (Out)    --------------------> Relay Ch 2 (Dist)    |
               |  GPIO 4 (Out)    --------------------> Relay Ch 3 (Subm)    |
               |  GPIO 5 (Out)    --------------------> Relay Ch 4 (Dosing A)|
               |  GPIO 6 (Out)    --------------------> Relay Ch 5 (Dosing B)|
               |  GPIO 7 (Out)    --------------------> Relay Ch 6 (Fan)     |
               |  GPIO 18 (Out)   --------------------> Relay Ch 7 (Lamp)    |
               +-------------------------------------------------------------+
```

---

## 3. Pin Mapping yang Digunakan & Resolusi Konflik

Seluruh penetapan pin firmware dipusatkan pada `esp32/main/config/pin_config.h`. Seluruh modul firmware (`actuator_hal.c`, `sensor_hal.c`, `button_hal.c`, `sdcard_hal.c`, `rtc_ds3231.c`, `main.c`) merujuk secara konsisten ke header ini.

| GPIO | Label Sinyal | Tipe Arah | Sub-Sistem | Status Konflik / Boot Strapping |
|---|---|---|---|---|
| **GPIO 1** | `PIN_OUT_WELL_PUMP` | Output | Pompa Sumur Dalam (AC) | Aman. Default Active-LOW, locked inactive at boot. |
| **GPIO 2** | `PIN_OUT_DIST_PUMP` | Output | Pompa Distribusi Fertigasi (AC) | Aman. Default Active-LOW, locked inactive at boot. |
| **GPIO 4** | `PIN_OUT_RAW_SUBMERSIBLE` | Output | Pompa Agitator / Submersible (AC) | Aman. Default Active-LOW, locked inactive at boot. |
| **GPIO 5** | `PIN_OUT_DOSING_A` | Output | Pompa Dosing A (12V DC) | Aman. Default Active-LOW, locked inactive at boot. |
| **GPIO 6** | `PIN_OUT_DOSING_B` | Output | Pompa Dosing B (12V DC) | Aman. Default Active-LOW, locked inactive at boot. |
| **GPIO 7** | `PIN_OUT_COOLING_FAN` | Output | Kipas Pendingin Box / Enclosure | Aman. Default Active-LOW, locked inactive at boot. |
| **GPIO 8** | `PIN_I2C_SDA` | I/O | I2C Data (DS3231 RTC) | Aman. Memerlukan pull-up eksternal 4.7kΩ ke 3.3V. |
| **GPIO 9** | `PIN_I2C_SCL` | Output | I2C Clock (DS3231 RTC) | Aman. Memerlukan pull-up eksternal 4.7kΩ ke 3.3V. |
| **GPIO 10** | `PIN_W5500_CS` | Output | W5500 SPI Ethernet Chip Select | Aman. Dipertahankan HIGH jika W5500 tidak aktif. |
| **GPIO 11** | `PIN_SPI_SCK` | Output | Shared SPI Bus Clock | Aman. Digunakan bersama SD, W5500, TFT. |
| **GPIO 12** | `PIN_SPI_MOSI` | Output | Shared SPI Bus Master Out | Aman. |
| **GPIO 13** | `PIN_SPI_MISO` | Input | Shared SPI Bus Master In | Aman. |
| **GPIO 14** | `PIN_TFT_CS` | Output | TFT Display Chip Select | Aman. |
| **GPIO 15** | `PIN_IN_FLOW_YFB1` | Input | Flow Meter Loop Fertigasi | Aman. Interrupt input pulsa. Gunakan level shifter. |
| **GPIO 16** | `PIN_IN_FLOW_FS400A` | Input | Flow Meter Air Baku | Aman. Interrupt input pulsa. Gunakan level shifter. |
| **GPIO 17** | `PIN_IN_TEMP_DS18B20` | I/O | Sensor Suhu Air (1-Wire) | Aman. Memerlukan pull-up eksternal 4.7kΩ ke 3.3V. |
| **GPIO 18** | `PIN_OUT_ERROR_LAMP` | Output | Lampu Indikator Beacon Alarm | Aman. Default Active-LOW. |
| **GPIO 21** | `PIN_TFT_DC` | Output | TFT Data / Command Control | Aman. |
| **GPIO 26** | `PIN_IN_FLOAT_LOWER` | Input | Lower Float Switch (Dry-Run) | **RESOLVED**: Dipindahkan dari GPIO 19 untuk membebaskan Native USB D-. Pull-up internal 3.3V aktif. |
| **GPIO 27** | `PIN_MICROSD_CS` | Output | MicroSD SPI Chip Select | **RESOLVED**: Dipindahkan dari GPIO 47 untuk mencegah tabrakan Octal PSRAM bus. |
| **GPIO 38** | `PIN_BTN_MODE` | Input | Tombol Panel: MODE | Aman. Internal pull-up aktif (Active-LOW: Tekan = 0). |
| **GPIO 39** | `PIN_BTN_MANUAL_A` | Input | Tombol Panel: MANUAL A | Aman. Internal pull-up aktif (Active-LOW: Tekan = 0). |
| **GPIO 40** | `PIN_BTN_MANUAL_B` | Input | Tombol Panel: MANUAL B | Aman. Internal pull-up aktif (Active-LOW: Tekan = 0). |
| **GPIO 41** | `PIN_BTN_DISTRIBUTION`| Input | Tombol Panel: DISTRIBUSI | Aman. Internal pull-up aktif (Active-LOW: Tekan = 0). |
| **GPIO 42** | `PIN_TFT_RST` | Output | TFT Display Hardware Reset | Aman. |

### Reserved Pins (DILARANG KERAS DIHUBUNGKAN KE WIRING EKSTERNAL):
- `GPIO 0`: Boot mode strapping pin (Pull-up internal, LOW saat reset masuk ke download mode).
- `GPIO 3`: JTAG strapping pin.
- `GPIO 19`: Native USB D- (`USB_DM`) controller.
- `GPIO 20`: Native USB D+ (`USB_DP`) controller.
- `GPIO 33–37`: Internal Embedded Flash & Octal PSRAM Bus.
- `GPIO 43–44`: UART0 Console TX / RX (Koneksi USB-Serial CH340 / CP2102).
- `GPIO 45–46`: VDD_SPI power domain strapping pins.
- `GPIO 47`: Octal PSRAM Chip Select / DQS bus line.
- `GPIO 48`: RGB LED WS2812 onboard data pin.

---

## 4. Kebutuhan Driver, Relay, dan Interface

1. **Relay Board Optocoupler:**
   - Mayoritas modul relay 8-channel komersial menggunakan konfigurasi **Active-LOW** (sinyal LOW menyalakan LED optocoupler PC817).
   - Firmware disinkronkan ke default **Active-LOW** (`ACTUATOR_ACTIVE_LEVEL = 0`).
   - Sinyal **INACTIVE (OFF)** adalah **Logic HIGH (3.3V)**.
   - Peringatan: Jumper `VCC-JDVCC` pada modul relay wajib dilepas untuk isolasi galvanik penuh:
     - `VCC` relay dihubungkan ke 5V ESP32.
     - `JD-VCC` dihubungkan ke suplai daya koil relay (5V atau 12V terpisah).
     - `GND` logika tidak boleh disatukan langsung ke ground koil induktif bila ingin isolasi 100%.
   - `VERIFY RELAY BOARD DATASHEET BEFORE CONNECTION`: Periksa apakah modul relay memiliki switch/jumper pemilih active-high / active-low.
2. **Level Shifter Sensor Pulsa:**
   - Sensor aliran YF-B1 dan FS400A memerlukan VCC 5V DC untuk Hall-effect internal.
   - Output sinyal pulsa 5V **tidak boleh langsung masuk ke pin ESP32** (toleransi pin ESP32-S3 adalah 3.3V).
   - Wajib menggunakan pembagi tegangan resistor (misal 2.2kΩ / 3.3kΩ) atau modul bidirectional logic level shifter (TXS0108 / BSS138).
3. **Pull-Up Resistor Eksternal:**
   - I2C Bus (GPIO 8 SDA, GPIO 9 SCL): Pasang resistor 4.7kΩ ke 3.3V.
   - 1-Wire DS18B20 (GPIO 17 Data): Pasang resistor 4.7kΩ ke 3.3V.

---

## 5. Kebutuhan Power dan Segregasi Domain

Sistem menggunakan 3 domain daya yang wajib terpisah:

```text
[220V AC MAINS] ---> [MCB 10A] ---> [PSU 12V 5A] --------------------> [Domain 12V: Dosing Pumps, Coils]
                                         |
                                         +---> [Buck Converter 5V 3A] -> [Domain 5V/3.3V: ESP32, Logic]
```

### Hal yang Wajib Diverifikasi Sebelum Penyambungan:
1. **Buck Converter Output:** `MEASURE PHYSICALLY WITH DMM`: Pastikan tegangan output buck converter diukur sebesar **5.00V – 5.10V DC** sebelum kabel dicolokkan ke pin 5V/Vin ESP32.
2. **Current Rating Beban Induktif (AC & DC):**
   - Pompa dosing DC 12V: `VERIFY DATASHEET`: Arus puncak motor saat awal start (inrush) bisa mencapai 1.5A – 2A. Kapasitas PSU 12V harus mencukupi untuk menjalankan Pump A + Pump B bersamaan.
   - Pompa Submersible & Deep Well AC 220V: `VERIFY DATASHEET`: Pompa sumur di atas 750W (1 HP) memiliki arus inrush 4x–7x arus nominal. **Wajib menggunakan kontaktor magnetik industri eksternal** antara relay modul dan motor pompa AC guna mencegah kontak relay terbakar atau terlas (welded contact).
3. **Proteksi Induktif Flyback:**
   - Setiap beban induktif DC 12V (pompa dosing, kipas kabinet) wajib dipasangi dioda flyback (1N4007 / UF4007) secara anti-paralel di terminal beban.
   - Kontak relay beban AC 220V direkomendasikan dipasang RC snubber (100Ω + 0.1µF 630V).

---

## 6. Sensor dan Aktuator yang Harus Diuji

### Sensor:
1. **DS18B20:** Uji suhu ruang (25°C–30°C) dan respon dinamis saat probe disentuh/dicelup air hangat.
2. **Float Switch (GPIO 26):**
   - Posisi Pelampung NAIK (ada air): pin membaca HIGH (1) -> status `floatLowerOk = true`.
   - Posisi Pelampung TURUN (kering): pin ditarik ke LOW (0) -> status `floatLowerOk = false`, interlock safety aktif.
   - `VERIFY ORIENTATION PHYSICALLY`: Cincin pelampung dapat dibalik pada beberapa model untuk mengubah fungsi NO/NC.
3. **YF-B1 (Loop Fertigasi):** Uji pencatatan pulsa saat cairan mengalir.
4. **FS400A (Air Baku):** Uji pencatatan pulsa saat cairan mengalir.

### Aktuator:
1. **Ch 1 (Well Pump Relay - GPIO 1)**
2. **Ch 2 (Distribution Pump Relay - GPIO 2)**
3. **Ch 3 (Raw Submersible Relay - GPIO 4)**
4. **Ch 4 (Dosing Pump A Relay - GPIO 5)**
5. **Ch 5 (Dosing Pump B Relay - GPIO 6)**
6. **Ch 6 (Cooling Fan Relay - GPIO 7)**
7. **Ch 7 (Error Beacon Lamp - GPIO 18)**

---

## 7. Safe Boot & Kondisi Awal Aktuator

Untuk mencegah aktuator menyala sesaat (glitch / chattering) saat controller dinyalakan atau reboot:
1. **Urutan Eksekusi Firmware:**
   - Fungsi `safe_boot_actuators()` pada `esp32/main/main.c` dieksekusi pada baris pertama `app_main()`, sebelum NVS, network, sensor, atau task FreeRTOS apapun dijalankan.
   - Semua pin aktuator (`GPIO 1, 2, 4, 5, 6, 7, 18`) dikonfigurasi ke level `ACTUATOR_LEVEL_OFF` (1 / HIGH pada Active-LOW).
   - Pull-up internal diaktifkan (`GPIO_PULLUP_ENABLE`) untuk mencegah pin melayang (floating LOW) yang dapat memicu optocoupler relay.
2. **Persistence State Recovery:**
   - Bila sistem dimatikan dalam kondisi Emergency Stop, status E-stop dibaca dari NVS saat inisialisasi (`storage_mgr_get_estop()`). Jika latched, seluruh perintah aktivasi pompa langsung ditolak sejak awal boot.

---

## 8. First Power-On Procedure (Tanpa Beban Aktuator Terhubung)

Prosedur wajib sebelum menyambungkan beban aktuator atau kabel relay:

```text
[Tahap 1: Cek Catu Daya] 
  1. Pastikan kabel terminal AC dan DC beban terlepas.
  2. Nyalakan MCB 220V.
  3. Ukur output PSU 12V dengan multimeter: Harus 12.0V ± 0.3V DC.
  4. Ukur output Buck Converter: Harus 5.05V ± 0.05V DC. Matikan MCB jika di luar rentang.

[Tahap 2: Cek Short Circuit / Hambatan]
  1. Matikan sumber daya (MCB OFF).
  2. Ukur resistansi antara:
     - Rel 5V ke GND_LV: > 5 kΩ (kondisi kapasitor terisi).
     - Rel 3.3V ke GND_LV: > 3 kΩ.
     - AC Live ke GND_LV: Tak terhingga (OL / Open Loop).
     - AC Neutral ke GND_LV: Tak terhingga (OL / Open Loop).
     - Ground Sasis ke Ground Bumi (PE): < 0.5 Ω.

[Tahap 3: First Boot ESP32 Standalone]
  1. Pasang kabel 5V dan GND dari buck converter ke ESP32 (tanpa modul lain).
  2. Nyalakan MCB.
  3. Amati LED daya ESP32 menyala normal, tidak ada bau gosong atau panas berlebih pada chip.
  4. Ukur tegangan pada GPIO 1, 2, 4, 5, 6, 7, 18:
     - Dengan firmware Active-LOW yang sudah di-flash: Seluruh pin harus membaca ~3.3V (Logic HIGH = Relay OFF).
  5. Matikan MCB.
```

---

## 9. Prosedur Flashing Firmware

Firmware telah dikompilasi secara native dan menghasilkan binary image yang siap di-flash:
- **Project Directory**: `d:\template\esp32`
- **Build Directory**: `d:\template\esp32\build`
- **Flash Settings**: `--chip esp32s3 --flash_mode dio --flash_size 16MB --flash_freq 80m`

### Peta Alamat Flash (Sesuai `flasher_args.json` & `partitions.csv`):
| Partisi / File | Alamat Hex Flash | Lokasi File Binary |
|---|---|---|
| **Bootloader** | `0x0000` | `esp32/build/bootloader/bootloader.bin` |
| **Partition Table** | `0x8000` | `esp32/build/partition_table/partition-table.bin` |
| **OTA Data** | `0xf000` | `esp32/build/ota_data_initial.bin` |
| **Application (agrotech_esp32)** | `0x20000` | `esp32/build/agrotech_esp32.bin` |

### Perintah Flashing Menggunakan `esptool.py`:
Hubungkan workstation ke ESP32 melalui port USB-UART (misal `COM3` pada Windows):

```powershell
# Jalankan dari root repositori atau folder esp32:
python -m esptool --chip esp32s3 -p COM_PORT -b 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_size 16MB --flash_freq 80m 0x0 esp32/build/bootloader/bootloader.bin 0x8000 esp32/build/partition_table/partition-table.bin 0xf000 esp32/build/ota_data_initial.bin 0x20000 esp32/build/agrotech_esp32.bin
```

### Atau Flashing Menggunakan `idf.py`:
```powershell
$env:IDF_PATH = "D:\Espressif"
idf.py -p COM_PORT flash monitor
```

---

## 10. Urutan Commissioning (Risiko Terendah ke Risiko Tertinggi)

Urutan pengujian diatur bertahap untuk mengisolasi potensi kegagalan sebelum tegangan tinggi atau aktuator mekanis difungsikan:

```text
URUTAN COMMISSIONING:
[FASE 1: KELISTRIKAN DASAR]  (Risiko Rendah)
   └─ Tegangan DC, isolasi grounding, suhu komponen pasif.
[FASE 2: BOOT & SERIAL LOGS] (Risiko Rendah)
   └─ Flash binary, amati boot log 115200 baud, verifikasi NVS & heap memory.
[FASE 3: PERIPHERAL BUS]     (Risiko Rendah)
   └─ I2C RTC DS3231 time sync, MicroSD SPI card mounting.
[FASE 4: KONEKTIVITAS JARINGAN & REST API] (Risiko Rendah)
   └─ Wi-Fi SoftAP "AGROTECH-SETUP", STA DHCP, tes ping, curl endpoint /api/v1/health.
[FASE 5: SENSOR LOGIKA & INTERLOCK] (Risiko Sedang)
   └─ Float switch trip test, DS18B20 suhu, simulasi flow sensor pulsa.
[FASE 6: TOMBOL OPERATOR PANEL] (Risiko Rendah)
   └─ Uji debouncing 4 tombol fisik (Mode, Manual A, Manual B, Dist).
[FASE 7: RELAY LOGIC (TANPA BEBAN TEGANGAN TINGGI)] (Risiko Sedang)
   └─ Sambungkan header logika relay, amati LED indikator relay menyala/mati via REST API.
[FASE 8: BEBAN DC RENDAH] (Risiko Sedang)
   └─ Sambungkan Pompa Dosing A/B (12V DC) dan Kipas Pendingin (12V DC).
[FASE 9: BEBAN AC 220V (POMPA SUBMERSIBLE & SUMUR)] (Risiko Tinggi)
   └─ Sambungkan sirkuit daya AC melalui kontaktor/relay, uji fungsional fertigasi penuh.
```

---

## 11. Safety Checks & Interlock Verification Procedure

Pengujian interlock keselamatan wajib disimulasikan dan diverifikasi sebelum sistem beroperasi:

### 11.1. Emergency Stop Software Test:
1. Kirim request E-Stop:
   ```bash
   curl -X POST http://192.168.4.1/api/v1/commands/emergency-stop \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer agrotech-secret-key" \
     -d "{\"requestId\":\"req-estop-01\",\"timestamp\":\"2026-09-14T12:00:00Z\",\"commandId\":\"cmd-estop-01\",\"type\":\"EMERGENCY_STOP\",\"payload\":{}}"
   ```
2. **Kriteria Lulus**:
   - Seluruh 7 channel aktuator langsung OFF.
   - Lampu error (`GPIO 18`) menyala.
   - Request aktivasi pompa berikutnya menghasilkan error `HTTP 409 Conflict` atau `ESP_ERR_INVALID_STATE`.
   - Controller di-reboot: Sistem tetap terkunci dalam status Emergency Stop (persist di NVS).
3. **Resume Test**:
   - Kirim perintah resume: `POST /api/v1/commands/resume` dengan bearer token.
   - **Kriteria Lulus**: Status e-stop terbuka, pompa dapat dioperasikan kembali.

### 11.2. Dry-Run Protection (Float Switch Test):
1. Posisikan Lower Float Switch pada kondisi TANGKI KOSONG (pelampung turun / kontak tertutup ke GND = 0V).
2. Coba jalankan Pompa Distribusi atau Pompa Sumur via REST API.
3. **Kriteria Lulus**:
   - Firmware menolak aktivasi pompa dengan warning log: `Blocked Dist Pump ON: Dry-run protection interlock active (Tank empty)`.
   - Status sensor `floatLowerOk` bernilai `false`.
   - Jika pompa sedang menyala lalu pelampung dijatuhkan: Pompa seketika mati dalam tempo < 1000ms dan event log `SAFETY_DRY_RUN` dicatat.

### 11.3. Welded Relay Detection Test:
1. Matikan Pompa Sumur dan Pompa Distribusi (status software OFF).
2. Suntikkan pulsa pada pin Flow Meter (GPIO 15 atau GPIO 16) > 10 pulsa.
3. **Kriteria Lulus**:
   - Safety monitor mendeteksi aliran fluida saat aktuator OFF.
   - Sistem seketika memicu Emergency Stop otomatis dengan log `SAFETY_WELDED_RELAY`.

---

## 12. Network Bring-Up Test Procedure

Sesuai arsitektur Phase 1 (`DECISION-002`), controller menjalankan **Wi-Fi APSTA Mode** (SoftAP fallback + STA):

1. **SoftAP Provisioning Verification:**
   - Setelah boot, cari Wi-Fi SSID: `AGROTECH-SETUP` (Password: `agrotech`).
   - Hubungkan laptop/smartphone ke SSID tersebut.
   - Alamat IP default ESP32: `192.168.4.1`.
   - Jalankan tes ping:
     ```bash
     ping 192.168.4.1
     ```
2. **REST API Health Check:**
   ```bash
   curl -i http://192.168.4.1/api/v1/health
   ```
   Verifikasi respons HTTP 200 OK:
   ```json
   {
     "success": true,
     "data": {
       "status": "HEALTHY",
       "firmware": "agrotech-esp32-backend",
       "version": "1.0.0"
     }
   }
   ```
3. **Wi-Fi STA Provisioning:**
   - Masukkan SSID & Password router greenhouse via API konfigurasi:
     ```bash
     curl -X PUT http://192.168.4.1/api/v1/config/system \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer agrotech-secret-key" \
       -d "{\"requestId\":\"req-cfg-01\",\"timestamp\":\"2026-09-14T12:00:00Z\",\"payload\":{\"wifiSsid\":\"GH-NETWORK\",\"wifiPassword\":\"ghpassword\"}}"
     ```

---

## 13. Sensor Verification Procedure

1. **Uji DS3231 RTC:**
   - Periksa waktu sistem: `GET /api/v1/device/clock`.
   - Jika belum sinkron, sinkronkan dari browser/UI:
     ```bash
     curl -X POST http://192.168.4.1/api/v1/clock-sync \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer agrotech-secret-key" \
       -d "{\"requestId\":\"req-clk-01\",\"timestamp\":\"2026-09-14T12:00:00Z\",\"payload\":{\"timestamp\":\"2026-09-14T12:00:00Z\",\"source\":\"MANUAL\"}}"
     ```
   - Matikan daya controller selama 60 detik, nyalakan kembali. Periksa jam tetap maju dan akurat.
2. **Uji DS18B20 Suhu Air:**
   - Periksa nilai suhu pada telemetri: `GET /api/v1/telemetry/sensors`.
   - Suhu harus bernilai antara 15.0°C hingga 40.0°C (kondisi ruang).
   - Status sensor `tempSensorState` harus bernilai `"VALID"`.
3. **Uji Flow Meter (YF-B1 & FS400A):**
   - Alirkan 1 liter air terukur melalui sensor.
   - Ambil data telemetri: Verifikasi `totalPulses` dan `totalLiters` bertambah mendekati 1.0 Liter (YF-B1 ~486 pulsa, FS400A ~288 pulsa).
   - `CALIBRATE WITH MEASURING VESSEL`: Sesuaikan konstanta kalibrasi jika volume fisik berbeda > 5%.

---

## 14. Actuator Channel Verification Procedure

Setiap aktuator diuji berurutan menggunakan perintah REST API kanonik:

```bash
# Contoh menyalakan Pompa Dosing A selama 5 detik:
curl -X POST http://192.168.4.1/api/v1/commands \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer agrotech-secret-key" \
  -d "{\"requestId\":\"req-act-01\",\"timestamp\":\"2026-09-14T12:00:00Z\",\"commandId\":\"cmd-dosing-01\",\"type\":\"START_DOSING\",\"payload\":{\"pump\":\"DOSING_A\",\"durationSeconds\":5,\"volumeMl\":50}}"
```

### Checklist Respon Indikator Relay:
- [ ] Ch 1 (Well Pump): LED Relay 1 menyala -> Kontak NO menutup.
- [ ] Ch 2 (Dist Pump): LED Relay 2 menyala -> Kontak NO menutup.
- [ ] Ch 3 (Raw Submersible): LED Relay 3 menyala -> Kontak NO menutup.
- [ ] Ch 4 (Dosing A): LED Relay 4 menyala -> Pompa Dosing A berputar.
- [ ] Ch 5 (Dosing B): LED Relay 5 menyala -> Pompa Dosing B berputar.
- [ ] Ch 6 (Cooling Fan): LED Relay 6 menyala -> Kipas berputar.
- [ ] Ch 7 (Error Lamp): LED Relay 7 menyala -> Lampu beacon aktif.

---

## 15. UI ↔ ESP32 Live Integration Test

Uji interaksi langsung antara antarmuka React/Vite dan firmware ESP32 di jaringan lokal:

1. **Jalankan UI Lokal:**
   ```bash
   npm run dev
   ```
2. **Koneksikan UI ke ESP32:**
   - Di pengaturan UI, masukkan Base URL ESP32: `http://192.168.4.1` (atau IP STA controller di jaringan lokal).
   - Masukkan API Token: `agrotech-secret-key`.
3. **Verifikasi Sinkronisasi State:**
   - Dashboard UI menampilkan status `CONNECTED` dengan badge hijau.
   - Telemetri sensor (suhu, level tangki, volume aliran) ter-refresh real-time via polling.
   - Tombol manual run memicu aktivasi relay secara instan tanpa lag browser.
   - Tombol Emergency Stop pada UI langsung menghentikan operasi secara serentak.

---

## 16. Failure, Brownout, & Recovery Testing

1. **Power Interruption (Brownout Simulation):**
   - Saat pompa aktif melakukan fertigasi, putuskan saklar daya utama MCB.
   - Sambungkan kembali daya.
   - **Kriteria Lulus**: Controller boot dalam keadaan aman, seluruh pompa tetap **OFF**. Scheduler membaca siklus dan tidak melakukan double-dosing.
2. **Wi-Fi Disconnection Recovery:**
   - Matikan router Wi-Fi external.
   - **Kriteria Lulus**: Firmware melakukan retry 5x, lalu otomatis fallback mengaktifkan SoftAP `AGROTECH-SETUP` sehingga teknisi tetap dapat terhubung secara lokal.
3. **MicroSD Eject / Failure Fallback:**
   - Lepaskan kartu microSD saat sistem berjalan.
   - **Kriteria Lulus**: Driver `sdcard_hal` melaporkan unmounted, logging otomatis fallback ke partisi SPIFFS internal 9MB tanpa menyebabkan CPU panic atau crash.

---

## 17. Hal-Hal yang Belum Dapat Diverifikasi Sebelum Hardware Fisik Tersedia

Sesuai aturan ketat repositori, item-item berikut **DITANDAI SEBAGAI UNVERIFIED** dan memerlukan pengujian di lokasi dengan perangkat keras fisik:

1. `VERIFY PHYSICALLY`: **Polaritas Trigger Modul Relay**
   - Meskipun firmware disinkronkan ke default Active-LOW (0 = ON), periksa apakah board relay fisik memiliki jumper pemilih HIGH/LOW atau menggunakan driver transistor NPN (Active-HIGH).
2. `VERIFY DATASHEET`: **Kapasitas Kontak Relay vs Inrush Arus Pompa AC**
   - Rating relay modul (biasanya tercantum 10A 250VAC resistif) **hanya mampu menahan beban induktif motor sekitar 2A – 3A**.
   - Bila pompa sumur memiliki daya di atas 0.5 HP / 375W, **kontaktor magnetik eksternal wajib dipasang**.
3. `VERIFY ORIENTATION PHYSICALLY`: **Orientasi Pelampung Float Switch**
   - Posisi reed-switch pelampung tergantung pemasangan cincin magnet. Pastikan secara fisik bahwa saat pelampung terangkat air, kontak terbuka (1 = NORMAL) dan saat tangki surut, kontak tertutup (0 = DRY TRIP).
4. `CALIBRATE PHYSICALLY`: **Koefisien Aliran Flow Meter (K-Factor)**
   - Konstanta 486 pulsa/liter (YF-B1) dan 288 pulsa/liter (FS400A) merupakan estimasi pabrik pada viskositas air murni. Kalibrasi ulang dengan wadah ukur 5 Liter pada tekanan instalasi pipa riil.
5. `VERIFY DATASHEET`: **Kapasitas Arus Peak Catu Daya 12V**
   - Pastikan PSU 12V mampu memasok arus kejut motor peristaltik Pompa A dan Pompa B secara simultan tanpa drop tegangan di bawah 11.0V.
6. `PHYSICAL VERIFICATION REQUIRED`: **Integritas Bus SPI pada Jalur Panjang**
   - Jalur kabel SPI (SCK, MOSI, MISO) ke MicroSD dan Display TFT tidak boleh melebihi 15 cm untuk mencegah degradasi sinyal frekuensi tinggi.

---
**Dokumen Disahkan Untuk**: Fase Commissioning & First Flash  
**Status**: APPROVED TO PROCEED TO PHYSICAL SETUP (NO FLASHING CONDUCTED BY AGENT)
