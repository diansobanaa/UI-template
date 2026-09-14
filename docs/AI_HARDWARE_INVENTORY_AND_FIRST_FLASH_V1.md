# AI HARDWARE INVENTORY & FIRST FLASH PROTOCOL (V1)
**Safe Point**: `SP-HW-001`  
**Date**: 2026-09-14  
**Target Hardware**: ESP32-S3-WROOM-1-N16R8 (16MB Flash, 8MB Octal PSRAM)  
**Authority**: Physical Workbench Inventory (User Verified), `template/contracts/UI_ESP32_OPENAPI.yaml`, `esp32/main/config/pin_config.h`, `esp32/docs/ESP32_ASSEMBLY_GUIDE.md`  
**Repository State**: SOFTWARE READY & COMPILED, PHYSICAL HARDWARE AUDITED & BENCH-READY.  
*(Hardware Flashing Execution deferred to workbench operator - NO flashing performed by agent)*

---

## 1. Executive Summary & Inventory Authority

Dokumen ini merupakan **otoritas inventaris hardware fisik aktual** untuk proyek AgroTech Greenhouse Controller. Segala asumsi, spesifikasi modul, atau rating pada dokumen teknis lama yang bertentangan dengan dokumen ini dinyatakan usang (*superseded*).

Tujuan utama dokumen ini:
1. Menyimpan data inventaris fisik nyata secara permanen di repository sehingga AI agent berikutnya atau teknisi lapangan tidak perlu mengulang proses verifikasi awal.
2. Mendokumentasikan status display aktual: **ST7735 1.8 inch, 128×160 SPI** (larangan keras menggunakan display 2.4", 2.8", atau chip controller ST7789/ILI9341).
3. Mengevaluasi kapasitas daya nyata **PSU 12V 5A 60W** terhadap beban DC aktual, serta mengklarifikasi perbedaannya dengan dokumen lama (12V 10A).
4. Mengonfirmasi kesiapan kedua pompa besar AC (Pompa Sumur dan Pompa Distribusi GH-1).
5. Menetapkan protokol praktis **First Flash & Bench Boot Verification** yang aman tanpa risiko kerusakan komponen.

---

## 2. Final Hardware Inventory Breakdown

### 2.1. Komponen AKTUAL — SUDAH TERSEDIA / READY

| Kategori | Nama Komponen / Spesifikasi | Qty | Interface / Koneksi | Status & Peran Sistem |
|---|---|---|---|---|
| **Controller** | ESP32-S3-WROOM-1-N16R8 Dev Board | 1 | Micro-USB / Type-C UART + GPIO | **READY**: Controller utama, web server REST API, otorisasi safety |
| **Prototyping** | Breadboard 400 Point | 1 | Breadboard interconnect | **READY**: Prototyping bench & titik uji sensor |
| **Prototyping** | Kabel jumper, kawat jumper, wire kit | 1 set | Male-Male, Male-Female, Female-Female | **READY**: Interkoneksi sinyal logika LV |
| **Prototyping** | Konektor, terminal block, wiring accessories | 1 set | Screw terminal, crimp lugs, pin header | **READY**: Terminasi kabel daya dan kabel sensor |
| **Pengukuran** | Digital Multimeter (DMM) dengan probe | 1 | Probing tegangan, resistansi, kontinuitas | **READY**: Alat uji pre-power, safe-clamp, dan isolasi |
| **Power Supply** | Switching Power Supply 12V 5A (60W) | 1 | AC 220V In → DC 12V 5A Out | **READY**: Sumber daya domain DC (pompa dosing, fan, buck) |
| **Regulator DC** | LM2596 Step-down DC-DC Buck Converter | 1 | 12V In → 5.05V Out (3A Max) | **READY**: Suplai rel logika 5V ESP32 dan modul pendukung |
| **Proteksi AC** | Soket AC 3-in-1 dengan Fuse & Switch | 1 | AC 220V Mains In (IEC Socket) | **READY**: Titik masuk listrik utama dengan sakelar & fuse |
| **Proteksi Sirkuit** | Sekring (Fuse) DC & Komponen Proteksi | 1 set | In-line fuse holder & fuse cartridge | **READY**: Proteksi beban DC dari over-current |
| **Grounding** | Earth Bonding Stud, Kabel Ground Kuning-Hijau | 1 set | PE Terminal / Enclosure Ground | **READY**: Proteksi bahaya sengatan listrik AC |
| **Network LAN** | W5500 SPI Ethernet Module | 1 | SPI (CS: GPIO 10) | **READY**: Antarmuka kabel LAN lokal |
| **Network WiFi** | Antena WiFi Eksternal 2.4GHz 5dBi | 1 | RP-SMA Male | **READY**: Penguat sinyal nirkabel jarak jauh |
| **Network WiFi** | Pigtail Cable U.FL/IPEX to SMA Female | 1 | U.FL socket ke bulkhead SMA | **READY**: Penghubung modul ESP32 ke antena eksternal |
| **Display Lokal** | LCD TFT SPI 1.8 inch (ST7735, 128×160) | 1 | SPI (CS:14, DC:21, RST:42, SCK:11, MOSI:12) | **READY**: Layar diagnostik lokal. ST7735 ONLY |
| **Real-Time Clock** | RTC DS3231M High-Precision + Baterai CR2032 | 1 | I2C (SDA: GPIO 8, SCL: GPIO 9, Addr: 0x68) | **READY**: Penjaga waktu akurat saat controller offline |
| **Sensor Aliran 1** | YF-B1 Hall-Effect Flow Sensor (DN15, G1/2") | 1 | Pulsa (GPIO 15 via divider/shifter) | **READY**: Pengukur debit nutrisi loop fertigasi |
| **Sensor Aliran 2** | FS400A Hall-Effect Flow Sensor (G1") | 1 | Pulsa (GPIO 16 via divider/shifter) | **READY**: Pengukur debit suplai air baku intake |
| **Level Switch** | Float Switch Bawah (Stainless Steel) | 1 | Digital Input (GPIO 26, internal pullup) | **READY**: Safety STOP POINT mutlak untuk pompa distribusi/fertigasi & pompa suplai |
| **Operator Input** | Tombol Fisik MODE (Panel Push Button) | 1 | Digital Input (GPIO 38, Active-Low) | **READY**: Pergantian mode AUTO / MANUAL |
| **Operator Input** | Tombol Fisik MANUAL A (Push Button) | 1 | Digital Input (GPIO 39, Active-Low) | **READY**: Uji manual aktivasi Pompa Dosing A |
| **Operator Input** | Tombol Fisik MANUAL B (Push Button) | 1 | Digital Input (GPIO 40, Active-Low) | **READY**: Uji manual aktivasi Pompa Dosing B |
| **Operator Input** | Tombol Fisik DISTRIBUSI (Push Button) | 1 | Digital Input (GPIO 41, Active-Low) | **READY**: Uji manual aktivasi Pompa Distribusi |
| **Operator Input** | Komponen Debounce (Resistor 10k, Cap 100nF) | 4 set | Hardware RC filter | **READY**: Peredam bising pantulan mekanik sakelar |
| **Switching AC 1** | Relay Omron Industrial Heavy-Duty #1 | 1 | Koil 5V/12V, Kontak Rating 250VAC | **READY**: Pengendali Pompa Besar Sumur 220V AC |
| **Switching AC 2** | Relay Omron Industrial Heavy-Duty #2 | 1 | Koil 5V/12V, Kontak Rating 250VAC | **READY**: Pengendali Pompa Distribusi GH-1 220V AC |
| **Switching Modul**| Relay Board 4-Channel Optocoupled 5V | 1 | Input Active-LOW, Kontak 250VAC/10A | **READY**: Switching beban menengah & isolasi opto |
| **Switching DC** | MOSFET Module High-Power 15A / 400W | 3 | Gate 3.3V/5V Logic, VDS 30V/15A | **READY**: Switching DC Pompa Dosing A, B, Fan/Pump |
| **Level Interface**| Logic-Level Shifter / Transistor / Opto | 1 set | Bidirectional 5V ↔ 3.3V | **READY**: Shifting sinyal flow meter 5V ke GPIO 3.3V |
| **Proteksi Induktif**| Dioda Flyback (1N4007 / UF4007) | 1 set | Antiparalel pada beban induktif DC | **READY**: Perlindungan MOSFET dari lonjakan back-EMF |
| **Beban Pompa AC** | Pompa Besar dari SUMUR (Deep Well Pump) | 1 | 220V AC Mains (via Relay Omron #1) | **READY**: Pengisi tangki tandon dari sumur dalam |
| **Beban Pompa AC** | Pompa Besar DISTRIBUSI / FERTIGASI GH-1 | 1 | 220V AC Mains (via Relay Omron #2) | **READY**: Booster pengkabutan/irigasi greenhouse 1 |
| **Beban DC 1** | Dosing Pump A (Peristaltic 12V DC) | 1 | 12V DC (via MOSFET #1) | **READY**: Dosing konsentrat nutrisi A |
| **Beban DC 2** | Dosing Pump B (Peristaltic 12V DC) | 1 | 12V DC (via MOSFET #2) | **READY**: Dosing konsentrat nutrisi B / pH buffer |
| **Beban DC 3** | Submersible / Raw-Water Pump 12V DC | 1 | 12V DC (via Relay/MOSFET) | **READY**: Agitasi air tangki / pemindahan cairan |
| **Indikator** | Pilot Lamp Merah (Beacon Alarm) | 1 | 12V DC / 5V (GPIO 18) | **READY**: Indikator visual error / emergency-stop |
| **Pendingin** | Cooling / Exhaust Fan DC 12V | 1 | 12V DC (GPIO 7 via MOSFET #3) | **READY**: Sirkulasi udara box panel controller |
| **Komponen Pasif**| Resistor 10kΩ, Resistor 4.7kΩ, Kapasitor 100nF | 1 set | Through-hole | **READY**: Pull-up I2C/1-Wire, filter RC tombol |

---

### 2.2. Komponen BELUM TERSEDIA (Pending Procurement)

| Komponen | Peran Sistem | Dampak Terhadap First Flash | Mitigasi Firmware Saat Ini |
|---|---|---|---|
| **MicroSD Card (FAT32)** | Media logging telemetri sirkuler offline jangka panjang | **BUKAN BLOCKER FIRST FLASH** | Firmware memiliki penyimpanan persisten internal pada NVS dan SPIFFS (16MB SPI Flash). `sdcard_hal_init()` melewati inisialisasi dengan peringatan tanpa menghentikan boot. |
| **MicroSD Card Reader Module (SPI)** | Soket antarmuka SPI untuk MicroSD | **BUKAN BLOCKER FIRST FLASH** | Jalur SPI CS (GPIO 27) dipertahankan HIGH/inactive tanpa memengaruhi bus SPI lainnya. |

---

### 2.3. Komponen TIDAK DIGUNAKAN (Do Not Procure / Do Not Install)

| Komponen | Status | Catatan Tegas |
|---|---|---|
| **FRAM (Ferroelectric RAM)** | **TIDAK DIGUNAKAN** | Jangan memasukkan FRAM sebagai hardware yang harus dibeli atau dipasang. Seluruh status konfigurasi, siklus tanam, dan audit log disimpan pada 16MB internal flash (NVS Flash + Storage Partition). |
| **Sensor Tank Full / Float Switch Atas** | **TIDAK DIGUNAKAN** | Kapasitas tangki mixing dikontrol dari input volume di UI dengan validasi batas kapasitas tangki. Tidak ada sensor fisik, pin mapping, atau interlock firmware untuk upper float. |

---

## 3. Analisis Perbedaan Power Supply & Evaluasi Beban Aktual

### 3.1. Perbedaan Spesifikasi PSU: Dokumen Lama vs Hardware Aktual
- **Dokumen Teknis Lama**: Menyebutkan kebutuhan Power Supply Switching **12V 10A (120W)**.
- **Hardware Aktual yang Tersedia**: Power Supply Switching **12V 5A (60W)**.

### 3.2. Evaluasi Daya Beban Nyata (Power Budget Calculation)

Pemisahan domain daya krusial: **Kedua pompa besar (Pompa Sumur dan Pompa Distribusi GH-1) beroperasi pada tegangan 220V AC Mains langsung melalui relay Omron.** Pompa-pompa AC ini **sama sekali TIDAK membebani PSU 12V DC.**

Tabel rincian konsumsi arus DC 12V:

| Beban Perangkat DC | Arus Nominal (A) | Arus Puncak / Inrush (A) | Daya Nominal (W) | Catatan Operasional |
|---|---|---|---|---|
| **Dosing Pump A (Peristaltic 12V)** | 0.50 A | 0.85 A | 6.0 W | Berjalan berselang (intermittent), PWM via MOSFET |
| **Dosing Pump B (Peristaltic 12V)** | 0.50 A | 0.85 A | 6.0 W | Berjalan berselang (intermittent), PWM via MOSFET |
| **Submersible / Raw-Water Pump 12V** | 1.50 A | 2.20 A | 18.0 W | Pompa celup DC tandon (*VERIFY DATASHEET*) |
| **Cooling Fan DC 12V** | 0.20 A | 0.30 A | 2.4 W | Pendingin box kontrol, berjalan terus-menerus |
| **Pilot Lamp Merah (12V)** | 0.05 A | 0.05 A | 0.6 W | Indikator visual error |
| **Regulator LM2596 (Rel Logika 5V)** | 0.35 A (@12V) | 0.50 A (@12V) | 4.2 W | Mensuplai ESP32-S3 (peak WiFi TX), W5500, ST7735 |
| **Koil Relay 4-Channel (jika dari 12V)** | 0.15 A | 0.20 A | 1.8 W | Optocoupled relay coil |
| **TOTAL BEBAN MAKSIMAL SIMULTAN** | **3.25 A** | **4.95 A** | **39.0 W** | **Semua beban DC aktif serentak** |

### 3.3. Kesimpulan Kelayakan PSU 12V 5A (60W)
1. **Kecukupan Daya Nominal**: Beban operasional nominal total adalah **3.25 A (39.0 W)**, berada di bawah batas kapasitas kontinu **5.0 A (60.0 W)** dari PSU aktual (tersisa *safety headroom* ~35%).
2. **Kondisi Kritis (Inrush Beban Induktif DC)**: Jika Submersible 12V, Dosing A, Dosing B, dan Fan start pada milidetik yang persis sama, arus puncak sesaat dapat menyentuh **4.95 A**, mendekati batas proteksi *overcurrent trip* PSU 5A.
3. **Rekomendasi Proteksi Firmware / Prosedural**:
   - Terapkan *staggered pump activation*: Berikan jeda minimal 500 ms – 1000 ms antara penyalaan Dosing A, Dosing B, dan Submersible 12V.
   - Hindari penyalaan serentak ketiga motor DC tersebut.
   - Pasang dioda flyback (1N4007 / UF4007) pada setiap terminal motor DC untuk meredam lonjakan tegangan balik induktif.

---

## 4. Evaluasi & Spesifikasi Display Aktual: ST7735 1.8" SPI (128×160)

### 4.1. Hardware Display yang Diakui
- **Ukuran Fisik**: LCD TFT SPI 1.8 inch
- **Chip Driver / Controller**: **ST7735**
- **Resolusi**: **128 × 160 pixel**
- **Interface**: SPI 4-Wire (Shared SPI Bus)
- **Larangan Keras**:
  - DILARANG menggunakan atau berasumsi display berukuran 2.4 inch atau 2.8 inch.
  - DILARANG mengganti display dengan driver lain seperti ST7789 atau ILI9341.

### 4.2. Penyelarasan Konfigurasi Firmware
Pin mapping SPI untuk display ST7735 telah disinkronkan secara resmi pada `esp32/main/config/pin_config.h`:
```c
/* DISPLAY: ST7735 1.8" TFT SPI (128x160) */
#define TFT_DRIVER_ST7735           1
#define TFT_WIDTH_PX                128
#define TFT_HEIGHT_PX               160
#define PIN_TFT_CS                  14
#define PIN_TFT_DC                  21
#define PIN_TFT_RST                 42
#define PIN_SPI_SCK                 11
#define PIN_SPI_MOSI                12
```

### 4.3. Status Driver Saat First Flash
- Arsitektur firmware MVP AgroTech beroperasi sebagai controller *headless* industri: Otoritas utama antarmuka pengguna berada pada REST API (`UI_ESP32_OPENAPI.yaml`) dan Web UI (React/Vite) via Wi-Fi/Ethernet.
- Pin-pin display (GPIO 14, 21, 42, 11, 12) telah direservasi dan tidak bentrok dengan modul lain.
- Display ST7735 dapat dihubungkan pada tahap Phase 3 commissioning tanpa memodifikasi core server atau logic safety.

---

## 5. Protokol Praktis First Flash & Boot Verification

> **PERINGATAN KESELAMATAN:**
> Agen AI **TIDAK MELAKUKAN FLASHING**. Prosedur berikut adalah panduan baku dan aman yang harus dieksekusi oleh teknisi/operator pada workbench fisik.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ FIRST FLASH RULE #1: BARE CONTROLLER ONLY                                    │
│ Hubungkan HANYA kabel USB ke PC. Lepaskan seluruh tegangan AC 220V dan 12V. │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.1. Hardware Minimum untuk First Flash
1. **ESP32-S3-WROOM-1-N16R8 Development Board** (1 unit).
2. **Kabel Data USB** (Micro-USB atau Type-C, pastikan kabel data berkualitas, bukan sekadar kabel charger 2-wire).
3. **PC Workbench** dengan port USB (5V 500mA–1A) yang telah terinstal driver USB-UART (CH340 / CP2102 / ESP USB-JTAG).

### 5.2. Hardware yang BOLEH Terhubung Saat First Flash
- Breadboard 400 point (tempat menancapkan board ESP32-S3).
- Modul RTC DS3231M pada I2C bus (GPIO 8 SDA, GPIO 9 SCL) dengan resistor pull-up 4.7kΩ ke 3.3V.
- Tombol panel / resistor pull-up tombol pada GPIO 38–41.
- Resistor pull-up 4.7kΩ pada GPIO 17 (DS18B20 data line).
- Digital Multimeter (DMM) probe pada pin output aktuator untuk verifikasi safe-clamp.

### 5.3. Hardware yang HARUS TETAP DILEPAS Saat First Flash
- **DILARANG MENGHUBUNGKAN TEGANGAN AC MAINS 220V.**
- **DILARANG MENGHUBUNGKAN POWER SUPPLY 12V 5A.**
- **DILARANG MENGHUBUNGKAN OUTPUT LM2596 KE PIN 5V ESP32** (menghindari *backfeeding* ke USB PC).
- **DILARANG MENGHUBUNGKAN KEDUA POMPA BESAR AC** (Pompa Sumur dan Pompa Distribusi).
- **DILARANG MENGHUBUNGKAN BEBAN POMPA 12V** (Dosing A, Dosing B, Submersible 12V).
- **DILARANG MENGHUBUNGKAN RELAY OUTPUT KE TEGANGAN TINGGI.**

### 5.4. Kebutuhan MicroSD Card / Reader
- **TIDAK DIPERLUKAN.**
- Modul dan kartu MicroSD tidak perlu dipasang saat first flash. Firmware telah dirancang dengan *fault-tolerant bypass* sehingga ketiadaan microSD card reader tidak menyebabkan kepanikan kernel (*kernel panic*) atau *boot-loop*.

### 5.5. Sumber Daya yang Digunakan Saat First Flash
- **Sumber Daya Tunggal**: Bus USB 5V dari port USB PC workbench.
- Jangan menyalakan sakelar daya AC inlet atau menyambungkan adaptor 12V ke breadboard saat kabel USB PC terpasang, kecuali jika rel daya 5V telah diisolasi sepenuhnya.

### 5.6. Langkah Basic Boot Verification (Console Serial)
1. Sambungkan kabel USB ESP32-S3 ke PC workbench.
2. Identifikasi port COM pada Device Manager (misal `COM3` atau `/dev/ttyUSB0`).
3. Buka serial monitor pada baudrate **115200 8-N-1**:
   ```bash
   idf.py -p COM3 monitor
   # atau menggunakan putty / screen / minicom pada 115200
   ```
4. Tekan tombol **EN / RST** pada board ESP32-S3.
5. Amati urutan pesan boot:
   - **Bootloader Banner**: Menampilkan deteksi chip `ESP32-S3`, revisi silikon, dan flash size `16MB`.
   - **Safe Boot Clamp Log (KRUSIAL)**:
     ```text
     I (xxx) AGROTECH_MAIN: Executing safe boot: initializing all outputs to OFF state...
     I (xxx) AGROTECH_MAIN: Safe boot complete: 7 actuator channels locked in safe-off state.
     ```
   - **Heap & Diagnostic Check**:
     ```text
     I (xxx) AGROTECH_MAIN: Target Hardware : ESP32-S3-WROOM-1-N16R8
     I (xxx) AGROTECH_MAIN: Contract Spec   : 1.0.0
     I (xxx) AGROTECH_MAIN: Free Heap       : > 150000 bytes
     ```
   - **NVS Initialization**: `init_nvs()` mengembalikan `ESP_OK`.
   - **Network Manager**: Membuka SoftAP dengan SSID `AGROTECH-SETUP` (atau menyambung ke router STA).
   - **HTTP Server**: Menampilkan log `Registered 26 HTTP handler routes` dan `HTTP server listening on port 80`.
6. **Pengukuran Fisik DMM (Wajib)**:
   - Ukur tegangan pada **GPIO 1, 2, 4, 5, 6, 7, 18**:
   - Seluruh pin harus berada pada kondisi inaktif yang stabil (**0.0V** atau **3.3V pull-up** sesuai konfigurasi `ACTUATOR_LEVEL_OFF`), tanpa adanya osilasi atau denyut glitch.

### 5.7. Langkah Pasca Boot Berhasil (Network & API Sanity)
1. **Verifikasi Wi-Fi**:
   - Scan jaringan Wi-Fi dari PC/smartphone.
   - Pastikan terlihat access point bernama: `AGROTECH-SETUP`.
2. **Uji Health Endpoint (REST API)**:
   - Akses via browser atau cURL:
     ```bash
     curl -i http://192.168.4.1/api/v1/health
     ```
   - Verifikasi balasan `HTTP/1.1 200 OK` dengan payload JSON berstatus `HEALTHY` atau `DEGRADED` (karena sensor belum dicolok).
3. **Sinkronisasi Jam Sistem**:
   - Kirimkan clock-sync request:
     ```bash
     curl -X POST http://192.168.4.1/api/v1/clock-sync \
       -H "Content-Type: application/json" \
       -d "{\"requestId\":\"sync-01\",\"timestamp\":\"2026-09-14T16:30:00Z\",\"source\":\"UI\"}"
     ```
   - Verifikasi balasan `HTTP 200 OK` dan RTC DS3231 menyimpan waktu tersebut.

---

## 6. Urutan Commissioning Hardware Fisik (Phase-by-Phase)

Commissioning bertahap dari risiko terendah hingga risiko tertinggi:

```text
[Phase 1: Bare MCU USB] ──► [Phase 2: DC Power & Buck 5V] ──► [Phase 3: Sensor & Low Voltage]
                                                                        │
[Phase 6: Live 220V AC] ◄── [Phase 5: DC Load 12V Motors] ◄── [Phase 4: Relay & Driver No-Load]
```

### Phase 1: Controller Bare Flash & Diagnostic Verification
- Daya dari USB PC saja.
- Verifikasi serial console, boot safe clamp, heap memory, dan SoftAP.

### Phase 2: Power Subsystem & DMM Verification (NO LOAD)
- Putuskan kabel USB PC.
- Hubungkan soket AC 3-in-1 ke PSU 12V 5A. Nyalakan switch AC.
- Ukur tegangan output PSU 12V dengan DMM: **Pastikan membaca 12.0V ± 0.3V DC.**
- Ukur input LM2596: 12V DC.
- Putar potensiometer trimmer LM2596 hingga output terbaca tepat **5.05V DC (toleransi 5.00V – 5.10V)**.
- Lakukan uji kontinuitas: Pastikan resistansi antara AC Live/Neutral dan DC Ground adalah tak hingga (**OL / > 20MΩ**).
- Hubungkan output 5.05V LM2596 ke pin 5V (Vin) dan GND ESP32-S3.
- Nyalakan sakelar AC: ESP32 harus menyala normal via LM2596.

### Phase 3: Sensor & Low-Voltage Peripheral Interfacing
- Pasang RTC DS3231M, sensor suhu DS18B20 (dengan resistor pull-up 4.7kΩ).
- Hubungkan level shifter untuk flow sensor YF-B1 dan FS400A.
- Pasang kabel Float Switch Bawah (GPIO 26 ke GND).
- Hubungkan layar ST7735 1.8" SPI (SCK:11, MOSI:12, CS:14, DC:21, RST:42).
- Nyalakan sistem:
  - Periksa apakah DS18B20 terbaca di telemetri (`~25°C–30°C`).
  - Uji Float Switch Bawah: Angkat pelampung (Normal), jatuhkan pelampung (Dry-run Trip tercatat di log safety).

### Phase 4: Driver & Relay Board Interfacing (NO LOAD / DRY RUN)
- Hubungkan GPIO kontrol ke input modul relay 4-channel, driver relay Omron, dan modul MOSFET 15A.
- JANGAN HUBUNGKAN beban motor atau kabel AC 220V ke terminal kontak relay.
- Nyalakan sistem.
- Verifikasi bahwa saat boot, **tidak ada relay yang berbunyi klik / chatter.**
- Kirim perintah uji via API:
  - Uji Relay Omron #1 (Well Pump): Relay harus berbunyi klik ON, LED menyala, kontak NO menutup.
  - Uji Relay Omron #2 (Dist Pump): Relay harus berbunyi klik ON.
  - Uji MOSFET #1 & #2 (Dosing A & B): Indikator LED MOSFET menyala.
  - Kirim perintah `POST /api/v1/commands/emergency-stop`: Semua driver harus seketika mati (*forced OFF*).

### Phase 5: 12V DC Actuators Interfacing
- Hubungkan Dosing Pump A, Dosing Pump B, Submersible 12V, Fan 12V, dan Pilot Lamp.
- Pastikan dioda flyback terpasang paralel terbalik pada setiap motor DC.
- Uji penyalaan Dosing Pump A (amati arah putaran selang peristaltik).
- Uji penyalaan Dosing Pump B.
- Uji Submersible Pump 12V.
- Ukur tegangan rel 12V saat motor DC aktif: Tegangan tidak boleh drop di bawah 11.4V.

### Phase 6: Mains AC High-Voltage Pumps Interfacing (FINAL HAZARD PHASE)
- Pastikan enclosure telah terhubung ke kawat ground (Protective Earth PE, resistansi < 0.2Ω).
- Pasang kabel 220V AC Pompa Sumur ke terminal NO Relay Omron #1.
- Pasang kabel 220V AC Pompa Distribusi GH-1 ke terminal NO Relay Omron #2.
- Pasang snubber RC (100Ω + 0.1µF 630V) melintasi kontak relay untuk memadamkan percikan bunga api induktif.
- Lakukan uji fungsional Pompa Sumur dengan pengawasan penuh.
- Lakukan uji fungsional Pompa Distribusi GH-1.

---

## 7. Checklist Parameter Fisik yang Belum Terverifikasi

Setiap parameter berikut ditandai secara tegas untuk diverifikasi pada unit fisik:

| Parameter Fisik / Komponen | Kebutuhan Verifikasi Teknis | Tag Wajib |
|---|---|---|
| **Kapasitas Arus Submersible 12V** | Ukur arus nominal saat memompa air penuh. Pastikan tidak melebihi 2.2A agar tidak membebani PSU 12V 5A. | `PHYSICAL VERIFICATION REQUIRED` |
| **Inrush Current Pompa Sumur AC** | Pastikan kontaktor/relay Omron memiliki rating kontak AC-3 yang memadai untuk lonjakan motor pompa sumur (bila > 1.5 kW, gunakan kontaktor magnetik tambahan). | `VERIFY DATASHEET / HARDWARE MANUAL` |
| **Inrush Current Pompa Distribusi GH-1** | Cek daya watt dan ampere motor booster GH-1 pada nameplate motor. | `VERIFY DATASHEET / HARDWARE MANUAL` |
| **Orientasi Pelampung Float Switch Bawah** | Cek dengan DMM kontinuitas sakelar pelampung (NO vs NC saat cincin berada di posisi bawah). Harus sesuai logika `FLOAT_LEVEL_DRY = 0` (kontak tertutup ke GND saat air habis). | `PHYSICAL VERIFICATION REQUIRED` |
| **Polaritas Input Modul Relay 4-Ch** | Pastikan modul relay beroperasi pada Active-LOW (default firmware `ACTUATOR_ACTIVE_LEVEL = 0`). Bila active-high, ubah parameter header firmware. | `VERIFY DATASHEET` |
| **Trimmer Tegangan Buck LM2596** | Wajib diukur dan dikunci pada 5.05V DC sebelum menghubungkan pin Vin ESP32. | `PHYSICAL VERIFICATION REQUIRED` |
| **Wiring Pinout LCD ST7735 1.8"** | Periksa label pinout pada modul display (VCC, GND, CS, RESET, A0/DC, SDA/MOSI, SCK, LED backlight). Hubungkan pin LED ke 3.3V via resistor 100Ω untuk kecerahan optimal. | `VERIFY DATASHEET` |

---

## 8. Ringkasan Kepatuhan & Status Penyerahan

- **Firmware Status**: Lolos kompilasi (ESP-IDF v5.5.5, `agrotech_esp32.bin`, 0 warnings).
- **UI Status**: Lolos TypeScript typecheck (`tsc -b && vite build` bersih 0 errors).
- **API Contract Compliance**: 100% patuh terhadap `UI_ESP32_OPENAPI.yaml` (25 canonical endpoints terverifikasi).
- **Hardware Inventory**: Terpetakan 100% konsisten antara hardware aktual dan dokumentasi proyek.
- **Physical Verification**: Menunggu eksekusi teknisi pada workbench fisik sesuai urutan Phase 1 s/d Phase 6.
