# ESP32-S3 Firmware Build & Flashing Guide

Panduan lengkap untuk kompilasi, persiapan toolchain, penghapusan flash (erase), flashing firmware, dan pemantauan serial untuk kontroler ESP32-S3 pada project AgroTech.

---

## 1. Spesifikasi Hardware & Persyaratan Fisik

| Parameter | Spesifikasi Wajib | Catatan |
|---|---|---|
| **Chip / Modul MCU** | ESP32-S3-WROOM-1-N16R8 | Dual Core Xtensa LX7, 240MHz |
| **Flash Memory** | 16 MB (Quad / Octal SPI) | Sesuai `CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y` |
| **PSRAM** | 8 MB Octal PSRAM | Sesuai `CONFIG_SPIRAM_MODE_OCT=y` |
| **Koneksi PC** | Kabel Data USB (Type-C / Micro-USB) | Pastikan kabel mendukung data transfer, bukan hanya power-only |
| **Port USB Board** | USB-to-UART (CH340 / CP2102) atau Native USB | Hubungkan ke port UART untuk debugging dan flashing standar |
| **Driver Windows** | CP210x VCP Driver / CH340 Driver / ESP-IDF WinUSB | Periksa di Device Manager Windows (Port COM) |

---

## 2. Persyaratan Software & Toolchain (PC Windows)

1. **ESP-IDF (v5.5 disarankan, atau v5.x compatible)**
   - Jalur default instalasi toolchain yang didukung:
     - `D:\Espressif` (ESP-IDF core repository / tools)
     - `D:\Espressif-tool\Espressif` (Tools, compilers, Ninja, CMake)
     - `D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env` (atau `idf5.5_py3.11_env`)
   - *Catatan:* Jika Anda menginstal ESP-IDF di lokasi lain, skrip otomatis membaca variabel lingkungan `$env:IDF_PATH`, `$env:IDF_TOOLS_PATH`, dan `$env:IDF_PYTHON_ENV_PATH` jika sudah diset.

2. **Python Environment dengan `esptool`**
   - Python 3.10 / 3.11 / 3.12 dengan paket `esptool` terpasang.

3. **PowerShell Execution Policy**
   - Pastikan PowerShell diizinkan menjalankan skrip lokal:
     ```powershell
     Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
     ```

---

## 3. Konfigurasi Khusus Multi-PC (Bridge GitHub Tanpa Konflik)

Jika repository ini dikembangkan oleh 2 PC atau lebih yang saling sinkronisasi via GitHub dengan lokasi folder atau drive yang berbeda:

1. **Salin Template Environment:**
   Di PC Anda, salin template:
   ```powershell
   Copy-Item scripts\esp32_env.example.ps1 scripts\esp32_env.local.ps1
   ```
2. **Sesuaikan dengan PC Anda:**
   Buka `scripts\esp32_env.local.ps1` dan tentukan nilai untuk PC Anda:
   ```powershell
   $LOCAL_PORT           = 'COM3'        # Port COM di PC ini
   $LOCAL_BAUD           = 460800
   $LOCAL_IDF_PATH       = 'D:\Espressif' # Atau C:\Espressif di PC lain
   $LOCAL_IDF_TOOLS_PATH = 'D:\Espressif-tool\Espressif'
   $LOCAL_PYTHON_ENV     = 'D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env'
   ```
3. **Keamanan Git (`.gitignore`):**
   File `scripts/esp32_env.local.ps1` sudah otomatis masuk `.gitignore`. Setiap PC memiliki pengaturannya masing-masing tanpa pernah menimpa konfigurasi PC rekan saat `git pull` atau `git push`.
4. **Auto-Detection Port Pintar:**
   Jika hanya ada 1 perangkat USB Serial terhubung ke PC, skrip akan mendeteksinya secara otomatis meskipun `$LOCAL_PORT` dikosongkan.

---

## 4. Langkah Mendeteksi Port COM ESP32


Sebelum melakukan flashing, cari tahu nomor port COM perangkat ESP32 Anda di Windows:

### Menggunakan PowerShell:
```powershell
Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Description, Manufacturer
```
Atau:
```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

### Menggunakan Device Manager:
Buka `devmgmt.msc` → Lihat bagian **Ports (COM & LPT)** (contoh: `Silicon Labs CP210x USB to UART Bridge (COM3)`).

---

## 5. Metode Flashing Firmware

Project ini menyediakan 3 metode sesuai kebutuhan:

### Metode 1: Standard Build & Flash (Aman - Mempertahankan NVS & Konfigurasi Wi-Fi)
Gunakan metode ini untuk pembaruan rutin kode/firmware tanpa menghapus kredensial Wi-Fi atau pairing data di NVS.

1. **Build Firmware:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\build_esp32.ps1
   ```
2. **Flash ke ESP32:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\flash_esp32.ps1 -Port COM3
   ```
   *(Ganti `COM3` dengan port COM perangkat Anda jika berbeda).*

---

### Metode 2: Clean Build + Full Erase Flash + Flash Baru (Inisialisasi Bersih)
Gunakan metode ini jika terjadi korupsi NVS, partisi bermasalah, atau saat pertama kali memprogram board baru:
> **PERINGATAN:** Metode ini menghapus seluruh partisi flash termasuk NVS, pengaturan Wi-Fi, dan kalibrasi sensor di memori non-volatile.

```powershell
powershell -ExecutionPolicy Bypass -File clean_build_erase_flash.ps1 -Port COM3
```

Skrip ini akan secara otomatis:
1. Menghapus folder lama `esp32\build`.
2. Melakukan kompilasi bersih (clean build) seluruh komponen.
3. Melakukan `erase_flash` menyeluruh via `esptool`.
4. Melakukan flashing partisi tabel, bootloader, dan binary aplikasi utama `agrotech_esp32.bin`.

---

### Metode 3: Menggunakan ESP-IDF Terminal Langsung

Jika Anda membuka **ESP-IDF 5.5 PowerShell** / **ESP-IDF Command Prompt**:

```powershell
cd esp32
idf.py set-target esp32s3
idf.py build
idf.py -p COM3 flash
```

---

## 6. Pemantauan Serial Log (Monitor)

Setelah flashing selesai, buka serial monitor pada baud rate **115200**:

```powershell
cd esp32
idf.py -p COM3 monitor
```
*(Tekan `Ctrl + ]` untuk keluar dari monitor).*

Atau menggunakan skrip Python yang tersedia di repository:
```powershell
python scripts\monitor_com3.py
```

---

## 7. Layout Partisi Flash (16 MB)

Firmware ini menggunakan tabel partisi kustom yang didefinisikan di `esp32/partitions.csv`:

| Partisi | Tipe | Sub-tipe | Offset | Ukuran | Deskripsi |
|---|---|---|---|---|---|
| `nvs` | data | nvs | `0x9000` | 24 KB (`0x6000`) | Penyimpanan konfigurasi non-volatile (Wi-Fi, credentials, settings) |
| `otadata` | data | ota | `0xf000` | 8 KB (`0x2000`) | Manajemen status update OTA |
| `phy_init` | data | phy | `0x11000` | 4 KB (`0x1000`) | Kalibrasi radio Wi-Fi/Bluetooth |
| `ota_0` | app | ota_0 | `0x20000` | 3 MB (`0x300000`) | Slot aplikasi utama firmware |
| `ota_1` | app | ota_1 | `0x320000` | 3 MB (`0x300000`) | Slot cadangan aplikasi OTA |
| `storage` | data | spiffs | `0x620000` | 9 MB (`0x900000`) | File sistem SPIFFS untuk resep & data offline |

---

## 8. Troubleshooting / Pemecahan Masalah Flashing

1. **Board Gagal Masuk Bootloader (`A fatal error occurred: Failed to connect to ESP32-S3: No serial data received`):**
   - Tekan dan tahan tombol **BOOT** (GPIO 0) pada ESP32-S3.
   - Tekan dan lepas tombol **RESET / EN**.
   - Lepaskan tombol **BOOT**.
   - Jalankan perintah flash kembali.

2. **Access Denied / Permission Error pada Port COM:**
   - Tutup semua program yang sedang membuka serial port tersebut (Serial Monitor VS Code, PuTTY, Arduino IDE, atau proses Python yang masih berjalan di latar belakang).
   - Cabut dan colokkan kembali kabel USB jika port terkunci oleh Windows driver.

3. **Toolchain / Python Environment Not Found:**
   - Jika ESP-IDF diinstal pada direktori kustom, tentukan parameter saat memanggil skrip:
     ```powershell
     powershell -ExecutionPolicy Bypass -File scripts\build_esp32.ps1 -IdfPath "C:\Espressif" -ToolsPath "C:\Espressif-tool\Espressif" -PythonEnv "C:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env"
     ```
