# AI MIXING TANK LEVEL & INTERLOCK VERIFICATION (V1)
**Safe Point**: `SP-HW-002`  
**Date**: 2026-09-14  
**Authority**: Project Final Architecture Decision, `esp32/main/config/pin_config.h`, `esp32/main/hal/actuator_hal.c`, `esp32/main/services/safety_monitor.c`, `esp32/main/services/command_mgr.c`  
**Status**: VERIFIED & RECONCILED. Upper Float Removed, Lower Float Safety Stop Enforced.

---

## 1. Final Level Control Architecture

Berdasarkan keputusan final proyek, arsitektur pengendalian level tangki mixing (dan tangki air baku) ditetapkan secara definitif sebagai berikut:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. HIGH-LEVEL / VOLUME MAXIMUM CONTROL: SOFTWARE & UI VALIDATION            │
│    - SENSOR TANK FULL / FLOAT SWITCH ATAS: TIDAK DIGUNAKAN.                 │
│    - Tidak ada sensor upper float fisik yang dipasang atau di-wiring.       │
│    - Tidak ada pin mapping atau GPIO yang dialokasikan untuk upper float.   │
│    - Kapasitas tangki mixing dikontrol dari input volume di UI.             │
│    - UI dan form validasi TIDAK MENGIZINKAN volume target melebihi          │
│      kapasitas tangki yang dikonfigurasi (e.g. max: tankCapacityL).        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. LOW-LEVEL / SAFETY STOP POINT: HARDWARE LOWER FLOAT SWITCH (GPIO 26)     │
│    - SENSOR FLOAT SWITCH BAWAH: TETAP DIGUNAKAN SEBAGAI STOP POINT MUTLAK. │
│    - Proteksi dry-run bekerja langsung pada firmware HAL dan Safety Monitor. │
│    - Pompa Distribusi / Fertigasi (serta Pompa Sumur & Submersible) WAJIB   │
│      SEKETIKA BERHENTI saat level tangki menyentuh batas minimum.           │
│    - Proteksi ini TIDAK BERGANTUNG pada UI atau koneksi jaringan.           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Required Behavior & Enforced Rules

### 2.1. Kondisi Air Cukup (`sensors.float_lower_ok == true`, GPIO 26 = 3.3V HIGH)
- Pelampung berada di atas (kontak terbuka, pull-up internal membaca level logika 1 / `FLOAT_LEVEL_OK`).
- Pompa Distribusi / Fertigasi (`ACTUATOR_DIST_PUMP`, GPIO 2) **diizinkan berjalan**.
- Pompa Sumur (`ACTUATOR_WELL_PUMP`, GPIO 1) dan Submersible (`ACTUATOR_RAW_SUBMERSIBLE`, GPIO 4) **diizinkan berjalan**.

### 2.2. Kondisi Air Mencapai Batas Minimum (`sensors.float_lower_ok == false`, GPIO 26 = 0V LOW)
- Pelampung jatuh ke bawah (kontak tertutup ke GND, membaca level logika 0 / `FLOAT_LEVEL_DRY`).
- **Pompa Distribusi / Fertigasi WAJIB SEKETIKA STOP**:
  - `actuator_hal_set(ACTUATOR_DIST_PUMP, true)` **DITOLAK** di lapisan HAL hardware dengan error `ESP_ERR_INVALID_STATE`.
  - Jika pompa distribusi sedang menyala (baik dari manual command maupun scheduler cycle), FreeRTOS background task `safety_monitor` (siklus 500ms) dan command worker loop (interval 1s) **langsung memutus sinyal GPIO ke level aman (OFF)**.
  - Lampu indikator error (`ACTUATOR_ERROR_LAMP`, GPIO 18) dinyalakan dan event `SAFETY_DRY_RUN` dicatat ke audit log persisten.

### 2.3. Safety Stop Inviolability (Tidak Dapat Dilewati)
- **Manual Command Path**:
  - Perintah manual via REST API (`POST /api/v1/commands` atau tombol panel fisik) yang mencoba mengaktifkan pompa saat air minimum akan langsung diblokir di `actuator_hal_set()`:
    ```c
    /* Interlock: Lower Float Dry-Run Protection (Safety Stop Point for Distribution & Pumps) */
    if (on && (id == ACTUATOR_DIST_PUMP || id == ACTUATOR_WELL_PUMP || id == ACTUATOR_RAW_SUBMERSIBLE)) {
        if (gpio_get_level(PIN_IN_FLOAT_LOWER) == FLOAT_LEVEL_DRY) {
            xSemaphoreGive(s_lock);
            ESP_LOGW(TAG, "Blocked %s ON: Lower float dry-run interlock active (Tank reached minimum level).", s_actuators[id].name);
            return ESP_ERR_INVALID_STATE;
        }
    }
    ```
- **Scheduler Execution Path**:
  - Jadwal otomatis (`scheduler.c`) yang memicu `dispatch_schedule()` akan dieksekusi melalui `command_mgr_submit()`.
  - Pada `command_mgr.c`, setiap detik eksekusi pompa dilakukan pembacaan langsung terhadap `PIN_IN_FLOAT_LOWER`. Jika level kering terdeteksi, operasi dipotong seketika (*aborted early*) dan output dipaksa OFF.
- **Kesimpulan**: Tidak ada jalur eksekusi perangkat lunak apapun yang dapat membypass penghentian darurat Float Switch Bawah.

### 2.4. Aturan Pemulihan (Recovery Behavior)
- **DILARANG OTOMATIS RUN KEMBALI**:
  - Ketika air kembali terisi di atas batas minimum (`float_lower_ok` kembali `true`), pompa distribusi **TIDAK AKAN otomatis hidup kembali dengan sendirinya**.
  - Sistem tetap berada dalam status aman (*safe idle*) hingga operator mengirimkan perintah resmi atau jadwal berikutnya yang valid tercapai.
  - Ini mencegah siklus hidup-mati berulang kali (*short-cycling / hunting*) yang dapat merusak motor pompa dan kontaktor relay.

---

## 3. Hasil Audit & Pembersihan Kode (Code Deletion & Alignment)

| Modul / File | Status Sebelum Audit | Perubahan Dilakukan | Status Akhir |
|---|---|---|---|
| `esp32/main/hal/actuator_hal.h` | Mendeklarasikan `actuator_hal_set_tank_full_interlock()` | Fungsi didelete sepenuhnya | **CLEAN** |
| `esp32/main/hal/actuator_hal.c` | Menyimpan `s_tank_full_interlock` dan `Interlock 2: Tank Full` | Variabel, interlock, dan fungsi dimatikan dan dihapus | **CLEAN** |
| `esp32/main/services/safety_monitor.c` | Rule 1 hanya memutus pompa sumur dan pompa distribusi | Diperluas untuk memastikan semua pompa pemindah (distribusi, sumur, submersible) mati seketika | **ENFORCED** |
| `esp32/main/services/command_mgr.c` | Loop durasi menggunakan `vTaskDelay` pasif | Diubah menjadi loop 1 detik dengan pengecekan aktif `PIN_IN_FLOAT_LOWER == FLOAT_LEVEL_DRY` | **ENFORCED** |
| `esp32/main/config/pin_config.h` | Ada komentar tentang Upper Float Interlock | Dihapus. Dicatat tegas bahwa Upper Float TIDAK DIGUNAKAN dan volume dikontrol via UI | **CLEAN** |
| `src/components/schedule/AddFertigationDrawer.tsx` | Target water volume tidak dibatasi kapasitas tangki | Ditambahkan `tankCapacityL` prop & validasi `max: maxCapacity` pada validator input | **VALIDATED** |
| `src/components/schedule/AddWellPumpDrawer.tsx` | Target volume well pump tanpa batas maksimal | Ditambahkan validasi `max: 1000` L dan FieldError rendering | **VALIDATED** |
| `esp32/docs/ESP32_ASSEMBLY_GUIDE.md` | Memuat baris BOM `FLOAT-UP` | Dihapus dari BOM dan Section 4.3 | **CLEAN** |
| `docs/AI_HARDWARE_INVENTORY_AND_FIRST_FLASH_V1.md` | Memuat `Float Switch Atas` di inventory ready | Dipindahkan ke kategori `TIDAK DIGUNAKAN` dan dihapus dari checklist fisik | **CLEAN** |

---

## 4. Source-Level Verification Matrix

```text
[UI Input Form: Target Water L] ──(Validasi max <= Tank Capacity)──► [Schedule / REST API]
                                                                             │
                                                                             ▼
                                                                     [command_mgr Task]
                                                                             │
                                                                  [Check Lower Float Pin 26]
                                                                     /               \
                                                           (Dry: 0V)/                 \(Water OK: 3.3V)
                                                                   ▼                   ▼
                                                          [HAL REJECTS ON]     [actuator_hal_set: RUN]
                                                          [Force Relays OFF]           │
                                                                   ▲                   ▼
                                                                   │           [safety_monitor Task]
                                                                   │           (Polls every 500ms)
                                                                   │                   │
                                                                   └──(Water drops)────┘
```

- **Uji Upper Float**: Tidak ada simbol `s_tank_full_interlock`, fungsi `actuator_hal_set_tank_full_interlock`, atau pin mapping upper float pada firmware.
- **Uji Lower Float Stop Point**:
  - `actuator_hal_set(ACTUATOR_DIST_PUMP, true)` mengembalikan `ESP_ERR_INVALID_STATE` saat `PIN_IN_FLOAT_LOWER` bernilai 0.
  - `command_mgr` memeriksa pin setiap 1000ms dan memotong durasi running saat terdeteksi kering.
  - `safety_monitor` memutus pompa yang sedang berjalan dalam waktu maksimal 500ms.
- **Uji Validasi Kapasitas Tangki**: Form drawer fertigasi menolak input volume lebih besar dari kapasitas tangki (`maxCapacity`).
