# AI RTC HARDWARE COMMISSIONING PRE-CHECK REPORT V1

**Date:** 2026-09-15  
**Target Module:** DS3231 / DS3231M High-Precision Real-Time Clock (RTC)  
**Target Microcontroller:** ESP32-S3-WROOM-1-N16R8 (USB Serial COM3)  
**Current Safe Point:** `SP-API-001` (Commit: `6c90435`)  
**Status:** **PRE-CONNECTION INSPECTION & COMMISSIONING GUIDE**  

> [!CAUTION]
> **JANGAN HUBUNGKAN RTC KE ESP32 SEBELUM SELURUH PRE-CHECK DI BAWAH SELESAI.**  
> **JANGAN GUNAKAN TEGANGAN 5V ATAU TEGANGAN BEBAN 12V.**  
> Seluruh panduan ini dirancang untuk pemula perangkat keras (*hardware beginner*). Ikuti setiap langkah dengan saksama.

---

## 1. Firmware Pin Assignment (Definitif)

Berdasarkan kode sumber firmware yang telah terverifikasi pada [`esp32/main/config/pin_config.h`](file:///d:/template/esp32/main/config/pin_config.h#L45-L49) dan [`esp32/main/hal/rtc_ds3231.c`](file:///d:/template/esp32/main/hal/rtc_ds3231.c#L14-L24):

| Sinyal I2C | Pin GPIO ESP32-S3 | Mode I2C Driver | Kecepatan Bus | Pull-Up Internal ESP32 |
| :--- | :---: | :---: | :---: | :---: |
| **SDA (Data)** | **GPIO 8** | Master | 100 kHz (Standard) | `GPIO_PULLUP_ENABLE` (Aktif) |
| **SCL (Clock)** | **GPIO 9** | Master | 100 kHz (Standard) | `GPIO_PULLUP_ENABLE` (Aktif) |

> **Catatan Firmware:**  
> Driver menggunakan port `I2C_PORT_NUM = 0`. Driver ESP-IDF mengaktifkan internal pull-up (~45 kΩ) pada GPIO 8 dan GPIO 9 secara otomatis saat inisialisasi.

---

## 2. Expected I2C Address

- **Alamat I2C Target:** **`0x68`** (7-bit address).
- **Protokol Probe:**  
  Firmware menjalankan *bounded ACK/NACK probe* dengan timeout 50 ms pada alamat `0x68`:
  ```c
  i2c_master_write_byte(cmd, (0x68 << 1) | I2C_MASTER_WRITE, true);
  ```
  - Jika modul membalas **ACK**, firmware mencatat:  
    `I (...) RTC_DS3231: DS3231 RTC acknowledged at 0x68.`
  - Jika modul tidak terhubung / tidak membalas, firmware beralih ke mode terdegradasi (*degraded fallback*) tanpa crash.
- **Catatan Modul Tambahan:**  
  Beberapa modul breakout DS3231 (misal seri ZS-042) memiliki chip kedua di board yang sama, yaitu AT24C32 EEPROM pada alamat `0x57`. Firmware AgroTech **hanya berkomunikasi dengan IC RTC pada alamat `0x68`**.

---

## 3. Label Pin Fisik pada Modul RTC

Periksa modul RTC fisik di tangan Anda. Pada umumnya modul memiliki header 4-pin, 5-pin, atau 6-pin:

| Label pada Board RTC | Fungsi | Status Penggunaan |
| :--- | :--- | :--- |
| **VCC** / **V+** | Jalur Daya Positif (+3.3V) | **WAJIB DIHUBUNGKAN KE PIN 3V3 ESP32** |
| **GND** / **G** / **-** | Jalur Ground / Negatif (0V) | **WAJIB DIHUBUNGKAN KE PIN GND ESP32** |
| **SDA** / **D** | I2C Serial Data | **WAJIB DIHUBUNGKAN KE GPIO 8 ESP32** |
| **SCL** / **C** | I2C Serial Clock | **WAJIB DIHUBUNGKAN KE GPIO 9 ESP32** |
| **SQW** / **INT** | Square Wave / Interrupt Alarm | **JANGAN DIHUBUNGKAN (BIARKAN TERBUKA)** |
| **32K** | 32.768 kHz Clock Output | **JANGAN DIHUBUNGKAN (BIARKAN TERBUKA)** |
| **RST** | Active-Low Reset (jika ada) | **JANGAN DIHUBUNGKAN (BIARKAN TERBUKA)** |

> **PERINGATAN TERTULIS:**  
> Jika modul fisik Anda memiliki label pin yang berbeda dari tabel di atas:  
> `VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION`.

---

## 4. Diagram Pengkabelan (Wiring Map)

Hanya **4 jalur kabel jumper** (disarankan kabel DuPont Female-to-Female atau breadboard) yang boleh terpasang:

```
+------------------------+                  +------------------------+
|   ESP32-S3-WROOM-1     |                  |   Modul RTC DS3231M    |
|                        |                  |                        |
|   Pin 3V3 (3.3V DC)    |----------------->|   Pin VCC              |
|   Pin GND (Ground)     |----------------->|   Pin GND              |
|   Pin GPIO 8 (SDA)     |<---------------->|   Pin SDA              |
|   Pin GPIO 9 (SCL)     |----------------->|   Pin SCL              |
|                        |                  |                        |
|                        |                  |   Pin SQW  [TIDAK ADA] |
|                        |                  |   Pin 32K  [TIDAK ADA] |
+------------------------+                  +------------------------+
```

---

## 5. Persyaratan Tegangan & Ground

1. **Tegangan Catu Daya (VCC):**
   - **Tegangan Wajib:** **+3.3V DC**.
   - **Sumber Daya:** Gunakan pin bertuliskan **3V3** pada papan ESP32-S3.
   - **BAHAYA FATAL:**  
     **JANGAN PERNAH** menghubungkan VCC modul RTC ke pin **5V**, **VIN**, atau **VBUS**!  
     ESP32-S3 bekerja pada level logika 3.3V dan **TIDAK toleran terhadap tegangan 5V** (*NOT 5V-tolerant*). Jika modul RTC diberi daya 5V, jalur SDA dan SCL akan ditarik ke 5V dan dapat **merusak GPIO 8 dan GPIO 9 secara permanen**.
2. **Koneksi Ground (GND):**
   - Pin GND pada modul RTC wajib terhubung kuat ke pin GND pada ESP32-S3 agar referensi tegangan 0V sama persis (*common ground*).
3. **Baterai Backup (Coin Cell):**
   - Masukkan baterai kancing **CR2032** (3V Lithium) ke soket baterai modul RTC sebelum pengkabelan.
   - Posisi kutub positif (tanda `+` lebar) menghadap ke atas.
   - Baterai ini menjaga IC DS3231 tetap menghitung waktu saat kabel USB ESP32 dicabut.

---

## 6. Analisis Resistor Pull-Up Bus I2C

- **Spesifikasi Bus I2C:**  
  Bus I2C adalah bus bertipe *open-drain*, yang membutuhkan resistor pull-up ke tegangan VCC (3.3V) pada jalur SDA dan SCL agar logika HIGH dapat terbentuk.
- **Pull-Up pada Firmware:**  
  Firmware mengaktifkan resistor pull-up internal ESP32-S3 (~45 kΩ) pada GPIO 8 dan 9.
- **Resistor Pull-Up pada Modul:**  
  Mayoritas modul breakout DS3231 komersial sudah memiliki resistor pull-up SMD onboard (biasanya bernilai 4.7 kΩ atau 10 kΩ, berkode `472` atau `103`).
- **Verifikasi:**  
  Lakukan pengukuran resistansi menggunakan multimeter (langkah 8 di bawah) untuk memastikan apakah board Anda sudah memiliki pull-up onboard. Jika sudah ada di board, Anda **TIDAK PERLU** menambahkan resistor eksternal apa pun.  
  `VERIFY DATASHEET / HARDWARE MANUAL BEFORE CONNECTION`.

---

## 7. Pin yang DILARANG Dihubungkan

1. **Pin SQW / INT:**  
   Pin ini mengeluarkan sinyal gelombang kotak (*square wave*) atau pulsa interrupt alarm. Firmware AgroTech tidak menggunakan interrupt eksternal untuk RTC; sinkronisasi dilakukan via polling I2C. **Biarkan pin ini terbuka / tidak terhubung.**
2. **Pin 32K:**  
   Pin ini mengeluarkan frekuensi referensi 32.768 kHz langsung dari osilator kristal. **Biarkan pin ini terbuka / tidak terhubung.**
3. **Konektor Tambahan di Sisi Seberang:**  
   Beberapa modul ZS-042 memiliki baris pin kedua di ujung papan lainnya. Cukup gunakan satu baris pin utama yang terhubung ke ESP32.

---

## 8. Pengujian Multimeter WAJIB Sebelum Modul Diberi Daya

Siapkan multimeter digital Anda. Lakukan 4 pengujian berikut **saat kabel USB dicabut dan rangkaian belum dialiri listrik**:

### Uji 1: Uji Bebas Hubung Singkat (Short Circuit Test) antara VCC dan GND
- Atur multimeter ke mode **Continuity / Bip (Diode)**.
- Tempelkan probe merah ke pin **VCC** modul RTC, dan probe hitam ke pin **GND** modul RTC (baterai kancing boleh terpasang).
- **Hasil yang Diharapkan:** Multimeter **TIDAK BOLEH BERBIP** (layar menampilkan angka resistansi tinggi, `OL`, atau >10 kΩ).
- **Kondisi Bahaya:** Jika multimeter **berbip terus-menerus** (resistansi mendekati 0 Ω), artinya ada korsleting pada modul. **JANGAN HUBUNGKAN KE ESP32!**

### Uji 2: Pengukuran Resistor Pull-Up Onboard
- Atur multimeter ke mode **Resistansi (Ohms / Ω)** skala 20 kΩ.
- Ukur resistansi antara pin **VCC** dan pin **SDA** pada modul RTC:
  - Jika terbaca antara **2.2 kΩ s.d. 10 kΩ**: Modul sudah memiliki pull-up onboard yang baik.
- Ukur resistansi antara pin **VCC** dan pin **SCL** pada modul RTC:
  - Jika terbaca antara **2.2 kΩ s.d. 10 kΩ**: Modul sudah memiliki pull-up onboard yang baik.

### Uji 3: Uji Integritas Kabel Jumper
- Atur multimeter ke mode **Continuity / Bip**.
- Uji masing-masing dari 4 kabel jumper dari ujung ke ujung.
- Pastikan kabel tidak putus di dalam (multimeter berbunyi bip nyaring).

### Uji 4: Verifikasi Tegangan Pin 3V3 ESP32
- Colokkan ESP32 ke port USB komputer (tanpa modul RTC terpasang).
- Atur multimeter ke mode **Tegangan DC (DC Volts)** skala 20V.
- Probe hitam ke pin **GND** ESP32, probe merah ke pin **3V3** ESP32.
- **Hasil yang Diharapkan:** Multimeter harus membaca antara **+3.25V hingga +3.35V DC**.
- Cabut kembali kabel USB dari komputer sebelum menghubungkan modul.

---

## 9. Urutan Eksekusi Pemasangan Fisik (Step-by-Step)

1. **CABUT DAYA:** Pastikan kabel USB ke ESP32 sudah dicabut total dari PC.
2. **PASANG BATERAI:** Masukkan baterai CR2032 ke slot modul RTC (sisi bertanda `+` menghadap ke atas).
3. **HUBUNGKAN KABEL:** Pasang 4 kabel jumper sesuai urutan:
   - Hubungkan **GND** RTC ke **GND** ESP32.
   - Hubungkan **VCC** RTC ke **3V3** ESP32.
   - Hubungkan **SDA** RTC ke **GPIO 8** ESP32.
   - Hubungkan **SCL** RTC ke **GPIO 9** ESP32.
4. **PERIKSA ULANG VISUAL (Double Check):**  
   Telusuri setiap kabel secara fisik:
   - Pastikan kabel dari pin VCC RTC benar-benar masuk ke pin 3V3 (bukan ke pin 5V, bukan ke GPIO lain).
   - Pastikan kabel SDA masuk ke GPIO 8 dan SCL masuk ke GPIO 9.
   - Pastikan tidak ada serabut kawat yang bersentuhan (*no accidental shorts*).
5. **COLOKKAN DAYA:** Colokkan kembali kabel USB ke komputer pada port `COM3`.

---

## 10. Indikator Keberhasilan (Expected Results)

### A. Indikator Serial Boot Log (115200 Baud via COM3)
Buka serial monitor segera setelah booting. Log yang benar akan menampilkan:
```text
I (1520) RTC_DS3231: Initializing I2C bus for DS3231 RTC (SDA=8, SCL=9)...
I (1522) RTC_DS3231: DS3231 RTC acknowledged at 0x68.
I (1523) RTC_DS3231: DS3231 I2C driver initialized.
I (1525) RTC_DS3231: System time synced from DS3231: Tue Sep 15 01:25:00 2026
```
**Perbedaan Kritis dengan Kondisi Sebelumnya:**
- Warning `DS3231 RTC not detected on I2C bus (probe err=0xffffffff)` **TIDAK MUNCUL LAGI**.
- Error `Failed to initialize DS3231 I2C driver: ESP_ERR_NOT_FOUND` **TIDAK MUNCUL LAGI**.
- Warning `Operating in degraded time mode` **TIDAK MUNCUL LAGI**.

### B. Indikator REST API via LAN (`http://192.168.0.129`)
Jalankan request HTTP:
```bash
curl http://192.168.0.129/api/v1/clock
```
Respons yang diharapkan:
```json
{
  "requestId": "req-1",
  "success": true,
  "deviceTimestamp": "2026-09-15T...",
  "data": {
    "currentUtc": "2026-09-15T...",
    "currentLocal": "2026-09-15T...",
    "timezone": "Asia/Jakarta",
    "synced": true
  }
}
```
Nilai timestamp tidak lagi kembali ke epoch Unix tahun 1970 (`1970-01-01T00:00:xxZ`).

---

## 11. Kondisi Berhenti Darurat (STOP Conditions)

Segera **CABUT KABEL USB** dari komputer jika salah satu dari kondisi berikut terjadi:
1. **Multimeter mendeteksi korsleting** (hubungan singkat 0 Ω antara VCC dan GND).
2. **Tegangan pin catu daya terbaca 5V** (bukan 3.3V).
3. **Modul RTC atau chip ESP32 terasa panas** saat disentuh dengan jari.
4. **Bau terbakar atau komponen berasap**.
5. **ESP32 mengalami boot loop / Watchdog Timer (WDT) reset berulang kali**.
6. **Ada aktuator atau relay yang menyala secara tiba-tiba**.
7. **Log serial mencetak `I2C bus timeout` atau crash / panic**.

Jika terjadi kegagalan deteksi modul (misal log tetap menampilkan `probe err=0xffffffff`):  
**JANGAN MENEBAK-NEBAK KABEL.** Cabut kabel USB terlebih dahulu, periksa polaritas kabel SDA dan SCL (apakah terbalik antara GPIO 8 dan GPIO 9), dan laporkan kondisinya.

---

**STATUS:** **PRE-CHECK REPORT COMPLETE — WAITING FOR OPERATOR READINESS**.  
Tidak ada perubahan kode sumber atau flashing yang dilakukan. Menunggu konfirmasi operator setelah pemeriksaan multimeter selesai dilakukan.
