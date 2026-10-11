# INTRUKSI OPERASIONAL UNTUK AI AGENT (MULTI-PC GITHUB BRIDGE)

Dokumen ini adalah **instruksi wajib** bagi AI Assistant (Gemini, Antigravity, Claude, Cursor, Codex, dll.) yang bekerja pada PC rekan/kedua dalam repository ini.

---

## 1. Konteks Kolaborasi Multi-PC
Repository ini dikembangkan dan disinkronkan secara aktif oleh **2 PC yang di-bridge melalui GitHub**.
- **PC 1** dan **PC 2** memiliki nama user Windows, lokasi folder repository, partisi drive, lokasi ESP-IDF, dan port COM yang **BERBEDA**.
- Setiap AI pada PC masing-masing **DILARANG MENGUBAH / MERUSAK** portabilitas kode atau menimpa konfigurasi lokal PC lain.

---

## 2. Aturan Sakral: ZERO LOCAL PATH HARDCODING
1. **Dilarang keras memasukkan path absolut lokal PC Anda ke file yang dilacak Git.**
   - Contoh terlarang: `C:\Users\username\...`, `D:\repo\...`, `E:\espressif\...`.
   - Semua path folder project internal di skrip harus selalu relatif terhadap `$PSScriptRoot` atau root workspace.
2. **Dilarang mengedit file skrip bersama untuk memasukkan path mesin Anda:**
   - Dilarang mengedit `scripts/build_esp32.ps1`, `scripts/flash_esp32.ps1`, `clean_build_erase_flash.ps1`, atau `scripts/run_idf.py` untuk meng-hardcode path PC Anda.
   - Skrip-skrip tersebut telah didesain generik dan otomatis membaca konfigurasi lokal dari `scripts/esp32_env.local.ps1`.

---

## 3. Konfigurasi Mesin Lokal PC Ini (`esp32_env.local.ps1`)
Jika Anda (AI) atau developer di PC ini perlu menyesuaikan port COM, baud rate, atau jalur instalasi ESP-IDF:

1. **Periksa keberadaan file lokal:**
   Cek apakah `scripts/esp32_env.local.ps1` sudah ada.
2. **Jika belum ada, buat dari template:**
   ```powershell
   Copy-Item scripts\esp32_env.example.ps1 scripts\esp32_env.local.ps1
   ```
3. **Edit HANYA file `scripts/esp32_env.local.ps1`:**
   Atur variabel yang sesuai untuk PC ini:
   ```powershell
   $LOCAL_PORT           = 'COM3'         # Port COM ESP32 di PC ini
   $LOCAL_BAUD           = 460800
   $LOCAL_IDF_PATH       = 'D:\Espressif'  # Atau folder ESP-IDF di PC ini
   $LOCAL_IDF_TOOLS_PATH = 'D:\Espressif-tool\Espressif'
   $LOCAL_PYTHON_ENV     = 'D:\Espressif-tool\Espressif\python_env\idf5.5_py3.12_env'
   ```
   *(File `scripts/esp32_env.local.ps1` sudah diabaikan oleh `.gitignore` sehingga tidak akan pernah bentrok saat `git pull` atau `git push`).*

---

## 4. Protokol Sebelum Memulai Pekerjaan (Inbound Handover)
Sebelum Anda melakukan modifikasi kode apa pun:
1. **Tarik perubahan terbaru dari Git:**
   Pastikan Anda bekerja di branch terkini (`git status`, `git pull`).
2. **Baca Safe Point Terakhir:**
   - Buka `AI_PROGRESS.md` dan lihat Safe Point paling atas (`SP-...`).
   - Buka `AI_HANDOVER.md` untuk memahami status runtime terakhir, isu yang diketahui, dan aksi berikutnya yang direncanakan.
3. **Hormati Aturan Utama:**
   - Patuhi seluruh instruksi di `GEMINI.md` dan `AGENTS.md`.
   - Ikuti aturan *Ponytail* (minimalis, jangan over-engineering, YAGNI).
   - Jangan merombak UI yang sudah diverifikasi (UI Vite/React dilindungi).

---

## 5. Menjalankan Kompilasi & Flashing ESP32 di PC Ini
Gunakan selalu skrip yang sudah terintegrasi:

- **Build Firmware:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\build_esp32.ps1
  ```
- **Flash ke ESP32 (Preserve NVS/Wi-Fi):**
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\flash_esp32.ps1
  ```
  *(Otomatis mendeteksi port COM dari `esp32_env.local.ps1` atau port serial tunggal aktif).*
  Jika ingin override port secara manual:
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\flash_esp32.ps1 -Port COM5
  ```
- **Clean Build + Erase Total Flash + Fresh Flash:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File clean_build_erase_flash.ps1
  ```
- **Serial Monitor (115200 baud):**
  ```powershell
  cd esp32
  idf.py monitor
  ```
  atau `python scripts\monitor_com3.py`.

---

## 6. Protokol Sebelum Menyelesaikan Tugas & Git Push (Outbound Handover)
Sebelum Anda menyatakan tugas selesai atau melakukan commit:
1. **Validasi & Verifikasi:**
   - Jangan pernah melaporkan sukses hanya karena kode tampak benar.
   - Jalankan verifikasi TypeScript / build web: `npx tsc --noEmit` atau `npm run build`.
   - Jalankan build firmware jika memodifikasi `esp32/`.
2. **Dokumentasi Kanonikal Wajib (`docs/`):**
   - Jika perubahan menyentuh GPIO, wiring, skema daya, API contracts, atau perilaku UI, **WAJIB** perbarui dokumen terkait di `docs/` (misal `docs/ESP32_GPIO_PIN_MAP.md`, `docs/HARDWARE_WIRING_MAP.md`, `contracts/UI_ESP32_OPENAPI.yaml`).
   - Jangan membuat duplikat docs di `esp32/docs/`.
3. **Catat Safe Point:**
   - Tambahkan Safe Point baru di bagian paling atas `AI_PROGRESS.md` dan `AI_HANDOVER.md`.
   - Format: ID Safe Point, tanggal, status, ringkasan perbaikan, file yang diubah, dan bukti verifikasi.
4. **Git Commit & Push:**
   - Pastikan `git status` bersih dari file yang tidak diinginkan.
   - Buat Git commit yang deskriptif.
