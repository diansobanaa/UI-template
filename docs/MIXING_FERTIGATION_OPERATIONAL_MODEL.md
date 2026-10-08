# MIXING & FERTIGATION — OPERATIONAL MODEL

**Status:** Canonical design intent / system alignment document  
**Scope:** ESP32 firmware, scheduler/runtime, Web UI, configuration, recipes, equipment, telemetry/events, multi-GH orchestration  
**Primary authority:** ESP32 owner of the Complex  
**Related architecture:** `docs/SYSTEM_TOPOLOGY_POOL.md`, schedule/configuration contracts, fertigation runtime, equipment configuration

---

## 1. Purpose

Dokumen ini menetapkan bagaimana sistem AgroTech harus memahami dan menjalankan hubungan antara **Mixing** dan **Fertigation**.

Tujuan utamanya adalah memastikan bahwa:

1. User melihat **Fertigation** sebagai satu pekerjaan operasional yang utuh.
2. Sistem memecah pekerjaan tersebut menjadi fase-fase fisik yang benar.
3. **Mixing** dan **Delivery/Penyaluran** bukan dua pekerjaan user yang harus dijadwalkan secara terpisah untuk operasi normal.
4. ESP32 tetap menjadi otoritas operasional untuk Complex yang dimilikinya.
5. Model single-GH tidak menjadi arsitektur khusus; single-GH hanyalah kasus sederhana dari model multi-GH.
6. Scheduler melakukan locking berdasarkan resource fisik yang benar, bukan berdasarkan label "fertigation" secara global.
7. Kegagalan mixing dan kegagalan delivery dapat dibedakan.
8. Schedule/intent user tetap berbeda dari compiled runtime artifact.

Dokumen ini adalah **design intent** yang harus digunakan agent/software implementation untuk menyesuaikan sistem terhadap model operasional yang diinginkan.

---

# 2. Prinsip Utama

## 2.1 Fertigation adalah user-facing operation

Bagi user, operasi normal adalah:

> "Lakukan fertigasi ke GH-01 menggunakan Recipe X sebanyak 20 L pada 06:00."

User tidak perlu membuat dua jadwal:

- Mixing 05:55
- Delivery 06:00

untuk satu pekerjaan fertigasi normal.

Model user-facing:

```text
FERTIGATION
├── target Complex
├── target GH
├── recipe
├── target volume
└── trigger/schedule
```

---

## 2.2 Mixing adalah system-internal preparation phase

**Mixing** berarti menyiapkan larutan fertigasi di mixing tank.

Konsep fisiknya:

```text
Raw Water
   +
Nutrient A
   +
Nutrient B
   +
Nutrient N (bila digunakan)
   ↓
Mixing Tank
   ↓
Homogenization / Mixing
   ↓
MIX_READY
```

Output mixing adalah **prepared nutrient solution** yang siap disalurkan.

Mixing bukan delivery.

---

## 2.3 Delivery/Penyaluran adalah application phase

Delivery berarti mengambil larutan yang sudah siap dan menyalurkannya ke tanaman.

```text
MIX_READY
   ↓
Delivery Pump
   ↓
Distribution Network / Valve
   ↓
Plants
   ↓
Target Volume Reached
   ↓
DELIVERY_COMPLETE
```

Delivery bukan proses pembuatan larutan.

---

## 2.4 Fertigation = orchestration

Secara internal, satu Fertigation Run harus dipandang sebagai orchestration:

```text
FERTIGATION RUN
      │
      ├── PRECHECK
      │
      ├── MIXING PHASE
      │      ├── FILL
      │      ├── DOSING
      │      ├── MIX/HOMOGENIZE
      │      └── MIX_READY
      │
      └── DELIVERY PHASE
             ├── START DELIVERY
             ├── FLOW CONTROL
             ├── VOLUME TRACKING
             └── COMPLETE
```

Tidak boleh ada implicit assumption bahwa `fertigation = delivery pump ON`.

---

# 3. Single-GH dan Multi-GH

## 3.1 Single-GH

Jika sebuah Complex hanya memiliki satu GH:

```text
Complex-01
└── GH-01
    └── Mixing Tank-01
```

maka target GH secara praktis sudah deterministik.

User tidak perlu memilih GH bila UI memang hanya memiliki satu GH.

Namun sistem **tetap wajib menyimpan dan membawa `complexId` dan `ghId` secara eksplisit**.

Single-GH bukan mode arsitektur berbeda.

Ia hanya berarti:

```text
number_of_GH_in_complex = 1
```

Semua kontrak runtime, persistence, scheduler, ownership, telemetry, dan history tetap berbasis `complexId + ghId`.

---

## 3.2 Multi-GH

Jika kemudian Complex berkembang menjadi:

```text
Complex-01
├── GH-01
│   └── Mixing Tank-01
└── GH-02
    └── Mixing Tank-02
```

Fertigation Run tetap memiliki kontrak yang sama:

```text
complexId = complex-01
ghId      = gh-02
recipeId  = recipe-x
target    = 20 L
```

Yang berubah hanya resource resolution:

```text
resolve GH-02
    ↓
select Mixing Tank-02
    ↓
mix
    ↓
select Delivery Pump GH-02
    ↓
deliver
```

UI contract tidak perlu berubah hanya karena GH kedua ditambahkan.

---

## 3.3 Perbandingan Protokol Fisik & Operasional: 1 GH vs Multi-GH dalam 1 Komplek

Meskipun kontrak API dan model parent job seragam, implementasi firmware dan sequencing mekanis memiliki perbedaan protokol yang nyata:

| Aspek Operasional | 1 GH dalam 1 Komplek (Single-GH) | Beberapa GH dalam 1 Komplek (Multi-GH) |
|---|---|---|
| **Infrastruktur Pipa Dosing** | Pipa langsung dari unit dosing ke tangki mixing GH-01 tunggal. | Shared Central Dosing manifold dengan **Routing Valves** ke masing-masing tangki GH. |
| **Routing Valve** | **Tidak dibutuhkan / Opsional.** Jika valve tidak ada di hardware, software wajib *skip valve action* (sesuai §22.1). | **Wajib.** Katup pemilih tangki tujuan wajib diakuisisi dan dibuka saat peracikan batch GH tertentu, lalu ditutup saat selesai. |
| **Protokol Peracikan (Dosing)** | **Eager Dosing Langsung.** Begitu antrean terbentuk, unit langsung meracik (Air Baku $\to$ Dosis A/B $\to$ Homogenisasi). | **Strict Serial FIFO.** Unit sentral hanya meracik 1 batch pada satu waktu. Batch GH-01 diracik duluan $\to$ selesai $\to$ batch GH-02 diracik $\to$ kedua tangki siap sebelum jam penyaluran. |
| **Protokol Penyaluran (Fertigasi Jam 06:00)** | **Single Pump Delivery.** Pompa distribusi GH-01 menyalurkan larutan ke tanaman sampai target volume / float sensor bawah terpicu. | **Parallel Concurrent Distribution.** Seluruh GH yang terjadwal jam 06:00 menyalakan pompa distribusi masing-masing **secara bersamaan (paralel)** tanpa saling mengunci. |
| **Kegagalan Penyaluran** | Jika terjadi fault pada GH-01, seluruh complex berhenti. | **Failure Isolation.** Jika GH-01 mengalami flow fault, hanya pompa GH-01 yang mati; penyaluran GH-02 tetap berjalan normal. |
| **Pasca-Fertigasi (Setelah Jam 06:00)** | Pompa OFF $\to$ occurrence `COMPLETED` $\to$ slot di-acknowledge $\to$ jika ada jadwal berikutnya hari ini (misal 12:00), **langsung di-enqueue untuk pre-mix segera**. | Pompa GH yang selesai langsung OFF $\to$ occurrence GH tersebut `COMPLETED` $\to$ jadwal berikutnya untuk GH tersebut di-chaining ke antrean dosing central. GH lain tetap menyiram mandiri. |
| **Deteksi Periodik 2 Jam** | Evaluasi $O(1)$ komparasi integer hari (`todayIn360 == last_fetched` / `s_daily_trigger_completed_yday == tm_now.tm_yday`). | Sama, komparasi $O(1)$ ultra-ringan (~4ns) tanpa alokasi heap atau I2C blocking. |

---


# 4. User Protocol vs System Protocol

## 4.1 User protocol

User melihat satu operasi:

```text
Fertigation Schedule
────────────────────────
GH       : GH-01
Recipe   : Melon Vegetatif
Volume   : 20 L
Trigger  : 06:00

[Apply / Save]
```

User tidak mengatur detail berikut untuk operasi normal kecuali memang tersedia sebagai advanced/maintenance control:

- durasi dosing A
- durasi dosing B
- durasi dosing N
- urutan valve internal
- waktu fill tank
- waktu mixing
- kapan delivery pump start
- flow retry algorithm

Detail tersebut adalah tanggung jawab system runtime.

---

## 4.2 System protocol

ESP32 menerjemahkan intent user menjadi:

```text
Fertigation Intent
        ↓
Resource Precheck
        ↓
Mixing Phase
        ↓
MIX_READY
        ↓
Delivery Phase
        ↓
COMPLETE
```

Runtime bertanggung jawab menentukan:

- resource apa yang harus digunakan
- urutan operasi
- durasi dosing berdasarkan calibration
- kapan mixing dianggap selesai
- kapan delivery boleh dimulai
- bagaimana memantau flow dan volume
- kapan operasi harus dihentikan karena fault

---

# 5. Fertigation Run Domain Model

Sistem sebaiknya memodelkan satu **Fertigation Run** sebagai parent operation.

Contoh konseptual:

```json
{
  "runId": "run-...",
  "complexId": "complex-01",
  "ghId": "gh-01",
  "recipeId": "recipe-x",
  "targetWaterVolumeMl": 20000,
  "status": "MIXING",
  "phase": "MIXING",
  "startedAt": "...",
  "mixing": {
    "status": "IN_PROGRESS"
  },
  "delivery": {
    "status": "NOT_STARTED"
  }
}
```

Nama field aktual dapat mengikuti contract codebase, tetapi **semantic separation** harus dipertahankan.

---

# 6. State Machine

Minimum state machine yang diinginkan:

```text
IDLE
  ↓
PRECHECK
  ↓
FILLING
  ↓
DOSING
  ↓
MIXING
  ↓
MIX_READY
  ↓
DELIVERING
  ↓
COMPLETE
```

Fault states minimal:

```text
PRECHECK_FAILED
FILLING_FAILED
DOSING_FAILED
MIXING_FAILED
DELIVERY_FAILED
FLOW_FAULT
LEVEL_FAULT
CANCELLED
```

## 6.1 Aturan transisi

### PRECHECK → FILLING
Hanya jika seluruh dependency yang dibutuhkan tersedia dan valid.

### FILLING → DOSING
Hanya jika kondisi volume/level yang diperlukan terpenuhi.

### DOSING → MIXING
Hanya jika seluruh dosing yang diperlukan berhasil.

### MIXING → MIX_READY
Hanya jika kondisi mixing completion terpenuhi.

### MIX_READY → DELIVERING
Hanya setelah larutan dinyatakan siap.

### DELIVERING → COMPLETE
Hanya jika delivery completion terpenuhi, misalnya target volume tercapai dan tidak ada active fault.

**Delivery tidak boleh dimulai sebelum Mixing menghasilkan `MIX_READY`.**

---

# 7. Mixing Phase

## 7.1 Input

Mixing menerima paling tidak:

- `recipeId`
- target water volume
- target nutrient quantities
- active dosing calibration
- target GH / mixing tank

## 7.2 Operasi & Tahapan Fisik Dosing (3 Tahap Utama)

Dosing Queue pipeline dieksekusi secara terpadu melalui 3 tahap fisik:

```text
1. Tahap 1: Persiapan Air Baku
   - Pengisian awal air baku via pompa raw water hingga mencapai ambang X% (misal 20% = 16 L dari target 80 L).
   - Pengukuran berbasis akumulasi pulsa flow sensor secara riil (bukan estimasi waktu).
   - Status Web UI/TFT: "Persiapan Air Baku" (hanya "RUNNING" bila pompa aktif & aliran terdeteksi).

2. Tahap 2: Dosing & Mixing Simultan
   - Begitu ambang batas X% tercapai: Seluruh pompa dosing dalam resep (DP-A, DP-B, DP-N) mulai bekerja BERSAMAAN (simultan).
   - Pompa mixing submersible 220V AC (GPIO 40) diaktifkan bersamaan.
   - Pompa air baku tetap menyala mengisi hingga volume 100% (target volume).
   - Masing-masing pompa dosing berhenti secara individual saat dosisnya tercapai (berbasis kalibrasi ml/s).
   - Timeout proteksi: MAX_RUNTIME = 1.5 × ESTIMATED_RUNTIME.
   - Status Web UI/TFT: "Dosing & Mixing Simultan".

3. Tahap 3: Pengadukan Akhir (Final Mixing)
   - Setelah pengisian air 100% dan seluruh dosis nutrisi selesai, mixer homogenisasi terus menyala selama durasi configured mixing (misal 180s).
   - Tidak ada pompa distribusi yang dijalankan pada tahap ini.
   - Status Web UI/TFT: "Pengadukan Akhir".

Terminal State: READY_TO_FERTIGATE (MIX_READY)
   - Seluruh pompa OFF (raw water OFF, dosing OFF, mixer OFF).
   - Batch larutan siap di tangki batch / mixing tank.
   - Penyaluran (distribusi) ke tanaman adalah tanggung jawab Fertigation Schedule independen (bukan tahap 5 dosing!).
```

## 7.3 Calibration

Dosing quantity user/recipe harus dikonversi secara presisi menggunakan active calibration yang tersimpan di NVS kontroler ESP32.

### 7.3.1 Rumus Matematis Konversi Dosing

Untuk pompa dosing peristaltik beraliran konstan:

$$\text{Durasi Dosing (ms)} = \frac{V_{\text{target}}\text{ (ml)}}{\text{Flow Rate}\text{ (ml/min)}} \times 60.000 = \frac{V_{\text{target}}\text{ (ml)}}{\text{Rate}\text{ (ml/sec)}} \times 1.000$$

Ekspektasi pengujian matematis:
- Kalibrasi $12\text{ ml/min}$ ($0.2\text{ ml/s}$) dengan target $30\text{ ml} \to 150.000\text{ ms}$ ($150\text{ s}$).
- Kalibrasi $12\text{ ml/min}$ ($0.2\text{ ml/s}$) dengan target $120\text{ ml} \to 600.000\text{ ms}$ ($600\text{ s}$).
- Kalibrasi $24\text{ ml/min}$ ($0.4\text{ ml/s}$) dengan target $120\text{ ml} \to 300.000\text{ ms}$ ($300\text{ s}$).

### 7.3.2 Kebijakan Strict Safety Kalibrasi

Calibration adalah dependency mutlak pada mixing phase:
1. Tidak boleh ada fallback tersembunyi (seperti mengasumsikan $2.5\text{ ml/s}$ atau $0\text{ ml/s}$).
2. Jika pompa belum dikalibrasi ($Rate \le 0$ atau record tidak ditemukan), operasi fertigas/dosing **WAJIB DITOLAK** dengan status `BLOCKED` (`DOSING_PUMP_NOT_CALIBRATED` di runtime / `ESP_ERR_INVALID_STATE` di firmware).
3. Jika rate pada batch plan tidak sesuai dengan active calibration di NVS kontroler (toleransi $> 0.005\text{ ml/s}$), firmware menolak eksekusi.

### 7.3.3 API & Struktur Data Kalibrasi
Kontroler ESP32 menyediakan REST endpoint:
- `GET /api/v1/calibration/rate`: Mengembalikan kamus canonical OpenAPI `dosingRates: { [componentId: string]: number }` beserta backward-compatibility alias `rateDosingAMlSec` dan `rateDosingBMlSec`.
- `POST /api/v1/calibration/rate`: Menerima `{ componentId, rateValue }` atau `{ componentId, rateMlPerSec }`, menerapkan monotonic auto-increment versioning, menyimpan ke partisi NVS, dan mengembalikan status `APPLIED` dengan `flowRateMlMin` dan `version`.

### 7.3.4 Semantik Tampilan Web UI
- **Flow Rate (aktif)**: Menampilkan nilai kalibrasi aktif dari kontroler ESP32 (misal `24.0 ml/mnt`) dengan badge *Terkalibrasi Aktif*. Bila belum ada kalibrasi, menampilkan teks eksplisit *Belum dikalibrasi*, bukan nilai nol.
- **Preview Sampling**: Saat operator melakukan sampling 30 detik dan memasukkan volume terukur, UI menampilkan preview flow rate beserta deviasi terhadap nilai aktif saat ini.
- **Nilai Sebelumnya**: Menampilkan nilai kalibrasi sebelum pembaruan terakhir yang diambil dari riwayat NVS/SQLite persisten.
- **State Persistence**: Menyimpan nilai kalibrasi memicu refresh authoritative data secara otomatis sehingga nilai langsung ter-update di UI dan tetap konsisten setelah page refresh maupun ESP32 reboot.

---

# 8. Delivery Phase

Delivery menerima:

- target GH
- prepared solution / MIX_READY
- target delivery volume
- delivery resource
- flow monitoring capability bila tersedia

Typical sequence:

```text
1. Confirm MIX_READY
2. Activate delivery path
3. Start delivery pump
4. Monitor flow
5. Accumulate delivered volume
6. Stop at target / valid completion
7. Verify completion
```

Delivery tidak bertugas menghitung nutrient recipe.

Delivery bertugas memastikan **larutan yang sudah siap benar-benar sampai ke tanaman sesuai target aplikasi**.

---

# 9. Resource Separation

Resource harus dibedakan antara Mixing dan Delivery.

| Resource | Mixing | Delivery |
|---|---:|---:|
| Raw-water inlet | YES | NO / INDIRECT |
| Nutrient A | YES | NO |
| Nutrient B | YES | NO |
| Nutrient N | YES | NO |
| Dosing pump A/B/N | YES | NO |
| Mixing tank | YES | Source |
| Mixing mechanism | YES | NO |
| Delivery pump | NO | YES |
| Flow meter | Optional/validation | YES / strongly relevant |
| Distribution valve | NO / setup | YES |
| GH irrigation network | NO | YES |

Implementation must derive actual locking from physical resource ownership.

---

# 10. Resource Locking and Concurrency

Do NOT use one global lock called `fertigation` unless the physical architecture actually requires it.

The system must lock the resources that are actually shared.

Example:

```text
GH-01 MIXING
```

and

```text
GH-02 MIXING
```

may conflict if A/B/N dosing infrastructure is shared.

But:

```text
GH-01 DELIVERY
```

and

```text
GH-02 DELIVERY
```

may be allowed simultaneously if the delivery pumps and distribution paths are independent.

Therefore scheduler locking must be resource-aware.

Desired conceptual model:

```text
Fertigation Run A
├── requires MIXING resources
└── requires DELIVERY resources

Fertigation Run B
├── requires MIXING resources
└── requires DELIVERY resources
```

The scheduler determines conflicts from the resource sets, not from job labels alone.

---

# 11. Shared Nutrient Infrastructure

If A/B/N dosing pumps are centralized/shared while mixing tanks are per-GH, then:

```text
            Shared
       A / B / N Dosing
              │
        ┌─────┴─────┐
        ▼           ▼
    Mixing GH-01  Mixing GH-02
```

The implementation must distinguish:

- GH-specific resources
- Complex-shared resources
- potentially system-shared resources

This distinction must be visible to the scheduler/resource-lock model.

---

# 12. Failure Semantics

Mixing and Delivery failures are not equivalent.

## 12.1 Mixing failure

Examples:

- dosing pump fails
- tank cannot fill
- required water volume not reached
- mixing mechanism fails
- required calibration missing
- sensor indicates invalid condition

Result:

```text
Fertigation Run = FAILED
Phase = MIXING
Delivery MUST NOT start
```

Do not send an unknown/incorrect concentration to plants merely to complete the schedule.

---

## 12.2 Delivery failure

Example:

```text
Mixing complete
→ Delivery starts
→ flow = 0
```

Result:

```text
Mixing = COMPLETE
Delivery = FAILED
Fertigation Run = FAILED / PARTIAL according to defined policy
```

The system must retain the fact that mixing succeeded.

---

## 12.3 Flow fault

If delivery pump is ON and expected flow is absent, the system must use the configured safety policy.

At minimum:

```text
pump ON
flow invalid / zero beyond timeout
→ stop delivery
→ raise FLOW_FAULT
```

Exact retry policy must be explicit and must not be invented by frontend code.

---

# 13. BLOCKED vs FAILED

These states must not be conflated.

### BLOCKED
The schedule/run cannot start because a required resource/capability is not currently available.

Example:

```text
Fan not ready
Flow sensor unavailable
Mixing tank unavailable
Delivery pump not configured
```

A persisted user schedule must remain present as intent.

### FAILED
An actual execution started but could not complete successfully.

Example:

```text
Mixing started
Dosing pump fault
→ MIXING_FAILED
```

These are different lifecycle states.

---

# 14. Schedule Intent vs Compiled Artifact

The user schedule is an **intent**, not the scheduler's final executable representation.

```text
Schedule Intent
       ↓
Resolve Complex + GH + Recipe + Equipment + Calibration
       ↓
Validate / Compile
       ↓
Compiled Runtime Artifact
       ↓
ESP32 Scheduler
```

A blocked schedule must not disappear merely because it cannot be compiled into an executable artifact at this moment.

Conceptually:

```text
intent = EXISTS
compiled = NOT_EXECUTABLE
status = BLOCKED
```

This is especially important for schedules that depend on Mixing or Delivery resources.

---

# 15. Equipment Readiness

Equipment configuration has two semantic layers:

1. **Hardware capability** — immutable firmware capability contract.
2. **Operational Ready/Enabled state** — user configuration that must persist on ESP32.

The normal UI interaction is:

```text
checkbox = draft
Apply = persist
```

Clicking the checkbox must NOT immediately mutate ESP32.

After Apply:

```text
Draft equipment state
        ↓
ESP32 configuration validation
        ↓
Durable commit
        ↓
Authoritative response
```

When equipment changes availability, dependent fertigation schedule intents must be revalidated.

Example:

```text
Delivery Pump = NOT READY
       ↓
Fertigation Intent persists
       ↓
Fertigation status = BLOCKED
```

Then:

```text
Delivery Pump = READY
       ↓
Revalidate existing intent
       ↓
Compile
       ↓
Potentially ACTIVE / executable
```

The schedule must not need to be recreated.

---

# 16. Single-GH User Experience

When only one GH exists in a Complex, the UI may simplify presentation.

Example:

```text
Complex-01
└── GH-01
```

The UI may preselect GH-01 or hide a redundant GH selector.

But internal requests MUST still contain:

```text
complexId
 ghId
```

The UI simplification must never remove GH identity from the operational model.

---

# 17. Multi-GH User Experience

When multiple GHs exist, user explicitly chooses the target GH.

Example:

```text
Complex: Complex-01
GH:      GH-02
Recipe: Melon Generatif
Volume: 20 L
Time:   06:00
```

The rest of the system remains the same.

Only target resource resolution changes.

---

# 18. Advanced / Maintenance View

Although normal users see Fertigation as one operation, the system should expose detailed phase telemetry for troubleshooting.

Example:

```text
Fertigation Run #123

Status: DELIVERING
GH: GH-01
Recipe: Melon Vegetatif
Target: 20 L

Mixing
  Fill:        COMPLETE
  Dose A:      COMPLETE
  Dose B:      COMPLETE
  Dose N:      COMPLETE
  Homogenize:  COMPLETE
  Result:      MIX_READY

Delivery
  Pump:        ON
  Flow:        2.1 L/min
  Delivered:   14.2 L
  Remaining:   5.8 L
```

This is observability, not a requirement for users to manually orchestrate phases.

---

# 19. Telemetry and Events

Mixing and Delivery should generate separate phase-level events when meaningful.

Examples:

```text
FERTIGATION_RUN_STARTED
MIXING_STARTED
FILL_STARTED
DOSING_STARTED
DOSING_COMPLETED
MIXING_COMPLETED
MIX_READY
DELIVERY_STARTED
FLOW_FAULT
DELIVERY_COMPLETED
FERTIGATION_RUN_COMPLETED
FERTIGATION_RUN_FAILED
```

Telemetry remains high-volume and bounded; events remain lower-volume state transitions.

Current telemetry architecture must not be replaced merely to implement this model.

---

# 20. Persistence and Recovery

Operational truth remains on ESP32 for the owned Complex.

At minimum, the ESP32 must preserve the schedule/configuration intent required to reconstruct:

- target Complex
- target GH
- recipe reference
- target volume
- schedule/trigger
- relevant operational parameters
- current configured equipment/readiness dependencies

Compiled runtime artifacts are derived and may be regenerated from authoritative intent when necessary.

On reboot:

```text
Load authoritative intent/config
        ↓
Validate
        ↓
Reconstruct executable artifact
        ↓
Restore scheduler runtime
```

A browser refresh must retrieve authoritative data from ESP32; browser storage must never become the source of schedule truth.

Browser persistence may contain only approved bootstrap hints such as ESP32 address and minimal Complex/GH identity metadata.

## 20.1 Unified Checkpoint Mechanism (3-Second Interval)

Untuk memantau dan mempertahankan progres tanpa membebani flash:
- **Interval Tunggal 3 Detik:** Seluruh proses aktif (dosing peracikan maupun distribusi fertigasi) menggunakan satu mekanisme checkpoint periodik setiap 3.000 ms.
- **Immediate State Trigger:** Perubahan status penting (transisi tahap fisik, penyelesaian batch, fault) langsung memicu penulisan checkpoint seketika melalui fungsi yang sama (`fertigation_mgr_save_checkpoint`).
- **Binary Static Format:** Checkpoint disimpan dalam format binary statis kompak (`fert_checkpoint_t`, ~140 bytes) ke MicroSD (`/sdcard/fert_checkpoint.bin`) dengan fallback SPIFFS (`/spiffs/fert_checkpoint.bin`), serta sinkronisasi NVS pada transisi status utama.
- **Integritas Data:** Dilengkapi CRC32 (`esp_rom_crc32_le`), versi skema (`FERT_CHECKPOINT_VERSION = 1`), sequence number monotonic, target vs actual water volume, dan observed runtime per dosing channel.
- **Zero Extra Tasks:** Checkpoint dipanggil langsung dari loop task kontroler yang sudah ada (`task` di `fertigation_mgr.c`), tanpa membuat FreeRTOS task checkpoint terpisah.

## 20.2 Power Recovery & RECOVERY_REQUIRED Protocol

Ketika ESP32 menyala kembali setelah listrik mati atau restart:
1. **Actuator Safe Boot:** Seluruh output GPIO/relay dipaksa `OFF` (inactive level) sebelum pemulihan status.
2. **Checkpoint Validation:** Firmware memeriksa checkpoint biner. Jika CRC32 atau versi tidak valid, fail-safe diterapkan.
3. **Mid-Stream Interruption Guard (`RECOVERY_REQUIRED`):**
   - Jika reboot terjadi saat **FILLING**, **DOSING**, atau **FINAL_MIXING**, volume fisik air aktual atau dosis yang telah tersalurkan tidak dapat dipastikan dengan presisi 100%.
   - Kontroler **WAJIB** menetapkan status `RECOVERY_REQUIRED` (`FERT_STATE_RECOVERY_HOLD`).
   - Kontroler **DILARANG MELANJUTKAN DOSING OTOMATIS** untuk melindungi tanaman dari risiko toksisitas atau kelebihan pupuk (overdosing).
   - Operator harus melakukan pengecekan fisik (drain atau cancel batch) melalui Web UI.
4. **Ready Batch Restoration:** Jika checkpoint mencatat status `MIX_READY` (`READY_TO_FERTIGATE`) sebelum reboot, batch larutan di tangki dinyatakan valid dan dipulihkan ke slot delivery `READY_TO_SEND` tanpa perlu pengadukan ulang atau dosing ulang.

## 20.3 Batasan Otoritas `hardware_outputs_mask`

- `hardware_outputs_mask` dalam checkpoint **hanya merupakan catatan status perintah sebelumnya** untuk keperluan telemetri dan audit diagnostik.
- Firmware **DILARANG KERAS** menyalakan kembali pompa atau relay saat boot berdasarkan catatan mask tersebut.


# 21. API / Frontend Boundary

The frontend should submit **operational intent**.

The frontend must not implement mixing/delivery timing logic.

Wrong:

```text
Web UI timer
→ dose pump
→ wait 90 sec
→ delivery pump
```

Correct:

```text
Web UI
→ create/update Fertigation Intent
→ ESP32
→ runtime orchestration
```

The ESP32 owns:

- timers
- sequencing
- actuator safety
- phase transitions
- retries/policies
- flow/level protection
- execution state

Python remains coordination/history/mirror/research infrastructure and must not become a required synchronous execution path for a local Complex.

---

# 22. Cancellation and Emergency Stop

A Fertigation Run may be cancelled.

Cancellation must propagate safely across the active phase.

If currently MIXING:

- stop active dosing/fill operations safely
- leave actuators in safe state
- record cancellation
- do not start delivery

If currently DELIVERING:

- stop delivery pump safely
- close required distribution path where applicable
- record partial delivery information
- do not claim COMPLETE

Emergency stop is independent of normal schedule control and must always be able to interrupt active operations.

---

# 23. Idempotency / Duplicate Execution

A single schedule trigger must produce at most one intended Fertigation Run execution for the same scheduler occurrence according to the system's missed-run/idempotency policy.

The system must not accidentally do:

```text
one trigger
→ two mixing runs
→ two deliveries
```

Run IDs / execution IDs should be stable enough to correlate all phases and events.

---

# 24. What the System Must NOT Do

The implementation must never:

1. Treat Fertigation as only `delivery pump ON`.
2. Start Delivery before `MIX_READY`.
3. Require users to create separate Mixing and Delivery schedules for normal fertigation.
4. Lose `ghId` merely because the Complex has only one GH.
5. Use a different architecture for single-GH.
6. Treat `BLOCKED` as `DELETED`.
7. Let browser timers own physical sequencing.
8. Use browser storage as authoritative schedule/equipment/configuration storage.
9. Let frontend decide actual dosing duration independently of ESP32 calibration.
10. Use a single global scheduler lock when actual resource-level locking is required.
11. Treat a successful mix as proof that delivery succeeded.
12. Treat a delivery failure as proof that mixing failed.
13. Recreate user intent from compiled artifacts if the compiled artifact lacks full intent information.
14. Make Python a mandatory synchronous runtime dependency for local fertigation execution.

---

# 25. Required Conceptual Data Flow

```text
USER
 │
 │ Fertigation Intent
 │   GH + Recipe + Volume + Trigger
 ▼
WEB UI
 │
 │ authoritative mutation
 ▼
ESP32
 │
 ├── Persist Intent
 │
 ├── Resolve Topology
 │
 ├── Resolve Equipment
 │
 ├── Resolve Calibration
 │
 ├── Compile / Validate
 │
 └── Schedule Runtime
       │
       ▼
  FERTIGATION RUN
       │
       ├── PRECHECK
       │
       ├── MIXING
       │    ├── FILL
       │    ├── DOSE
       │    ├── MIX
       │    └── MIX_READY
       │
       └── DELIVERY
            ├── PUMP
            ├── FLOW
            ├── VOLUME
            └── COMPLETE
```

---

# 26. Required System Invariants

These invariants must remain true regardless of UI implementation details.

### Invariant 1
Every Fertigation Run has an explicit target `complexId` and `ghId`.

### Invariant 2
Single-GH is not a different architecture.

### Invariant 3
Fertigation is the user-level job; Mixing and Delivery are system-level phases.

### Invariant 4
Delivery cannot begin without successful Mixing / `MIX_READY`.

### Invariant 5
Mixing failure prevents delivery.

### Invariant 6
Delivery failure does not retroactively change Mixing result.

### Invariant 7
Recipe/calibration/dosing belong to Mixing execution.

### Invariant 8
Flow/volume/distribution control belong to Delivery execution.

### Invariant 9
Shared resources are locked by actual resource identity.

### Invariant 10
A persisted schedule intent survives temporary hardware unavailability as `BLOCKED`; it is not deleted.

### Invariant 11
The ESP32 owner remains the operational authority for execution.

### Invariant 12
Browser persistence may only contain approved bootstrap hints; it cannot become operational truth.

### Invariant 13
The same Fertigation Intent must remain meaningful when a Complex evolves from one GH to multiple GHs.

---

# 27. Acceptance Criteria for Implementation

The implementation should eventually prove all of the following:

## User behavior

- User can schedule normal Fertigation as one operation.
- User does not need to schedule Mixing separately.
- User does not need to schedule Delivery separately.
- Single-GH UI remains simple without losing `ghId` internally.
- Multi-GH can target a specific GH.

## Runtime behavior

- Fertigation creates/executes a parent run or equivalent orchestration context.
- Mixing executes before Delivery.
- `MIX_READY` is explicit or semantically equivalent.
- Delivery cannot bypass Mixing.
- Mixing and Delivery have distinguishable states/failures.
- Delivery volume/flow can be tracked independently from mixing.

## Resource behavior

- Mixing uses Mixing resources.
- Delivery uses Delivery resources.
- Resource locks reflect actual sharing.
- Shared A/B/N dosing resources are not accidentally used concurrently when hardware cannot support it.
- Independent GH delivery pumps may run concurrently when hardware permits.

## Persistence behavior

- Fertigation intent persists on ESP32.
- Reboot does not erase valid intent.
- Browser refresh retrieves authoritative state from ESP32.
- BLOCKED does not mean deleted.

## Safety behavior

- Mixing fault prevents Delivery.
- Flow fault stops unsafe delivery according to configured policy.
- Emergency stop interrupts any active phase.
- Cancelled run does not report success.

---

# 28. Implementation Guidance for Agents

When modifying the system, agents MUST first map existing code into these conceptual layers:

```text
UI intent
    ↓
Schedule / configuration
    ↓
Compiler / validator
    ↓
Fertigation Run orchestration
    ↓
Mixing runtime
    ↓
Delivery runtime
    ↓
Actuator / sensor feedback
```

If the current implementation uses different filenames or modules, agents must map them to the concepts above rather than blindly creating duplicate subsystems.

Do not create a second Mixing engine or second Fertigation engine because a naming mismatch exists.

Do not alter hardware GPIO mappings merely to conform to this document.

Do not replace existing topology ownership architecture.

Do not reintroduce a legacy raw-schedule API merely to implement this model.

When a current implementation contradicts this document, the contradiction must be explicitly identified and resolved toward this canonical model.

---

# 29. Known Current-State Issues to Resolve

The current schedule forensic work has already established several relevant issues that implementation agents must keep in mind:

1. The schedule page previously failed to hydrate schedules from ESP32 on browser refresh.
2. `compiled` schedules alone are insufficient to reconstruct full user intent.
3. BLOCKED schedules were previously omitted from the compiled payload and therefore could disappear from the operational view.
4. The schedule compiler had a greenhouse scoping mismatch because topology GHs and configuration GHs were represented separately.
5. The legacy raw schedule endpoints are retired.

These findings mean the new Mixing/Fertigation implementation must preserve a clear distinction between:

```text
AUTHORITATIVE INTENT
       ≠
COMPILED EXECUTION ARTIFACT
```

and must never use an empty compiled artifact to mean that the user has no Fertigation Intent.

---

# 30. Final Canonical Statement

The AgroTech system shall represent normal fertigation as:

> **One user-visible Fertigation operation that is internally executed by the ESP32 as a controlled sequence of Mixing followed by Delivery.**

The user expresses **what should happen**.

The ESP32 determines **how the physical process must happen safely**.

For a single-GH Complex, the system simply has one deterministic GH target. The architecture remains the same as multi-GH.

The canonical relationship is:

```text
USER INTENT
    ↓
FERTIGATION
    ↓
┌───────────────┐
│ MIXING        │
│ Prepare       │
│ nutrient sol. │
└───────┬───────┘
        │
     MIX_READY
        │
        ▼
┌───────────────┐
│ DELIVERY      │
│ Apply to GH    │
└───────┬───────┘
        │
     COMPLETE
```

This separation is the foundation for correct scheduling, resource locking, safety, telemetry, troubleshooting, persistence, and future multi-greenhouse scaling.

---

# 31. Recipe Persistence & Optionality Model

## 31.1 ESP32 MicroSD Authoritative Storage
Recipes represent reusable nutrient definitions used during the Mixing phase.
- Primary Persistent Medium: ESP32 MicroSD card at `/sdcard/recipes/<recipe-id>.json`.
- Operational Source of Truth: ESP32 firmware directly serves Recipe CRUD via `/api/v1/recipes` without requiring a Python backend.
- Browser Role: Transient in-memory view only; no `localStorage`, `sessionStorage`, or cookies are used for recipe operational data.

## 31.2 Recipe is Optional in Fertigation Schedules
A Fertigation Schedule defines *when*, *where*, and *how* to irrigate/fertigate.
- A schedule may specify `recipeId` or leave it empty/null (`recipeId = null` or `""`).
- When `recipeId` is absent:
  - If water-only irrigation or explicit schedule volume is specified, the system treats it as valid.
  - Mixing phase prepares water without dosing channels.
  - Delivery phase delivers the specified water volume to the target GH.
  - Absence of a recipe does NOT block schedule creation.
- If execution later requires missing recipe parameters, the schedule/run becomes `BLOCKED` with an explicit reason, but creation is never rejected purely due to an empty recipe.

## 31.3 Graceful Degraded Storage Fallback (WRITE_TO_NOTHING)
The system remains operational even when physical MicroSD media is absent or unmounted:
- When MicroSD is absent:
  - Firmware executes the recipe storage abstraction path (`recipe_storage_save`).
  - The fallback discards unpersisted writes (`WRITE_TO_NOTHING`).
  - Returns HTTP 503 Service Unavailable with explicit degraded code `STORAGE_UNAVAILABLE`.
  - Firmware does NOT crash, assert, or reset.
  - Unrelated subsystems (scheduler, HTTP server, telemetry, topology, emergency stop) continue normal operation.

## 31.4 Bi-directional Recipe Dosing Synchronization
- When a schedule references a recipe (`recipeId`), the schedule inherits the recipe's nutrient channel definitions (`dosingAml`, `dosingBml`, `dosingChannels`).
- If schedule dosing fields are unspecified or 0, the system automatically resolves the dosages from the referenced recipe.
- If a standard nutrient formula is used without custom dosing quantities, the baseline target nutrient ratio is $1.875\text{ ml/L}$ of target water (e.g., $80\text{ L} \times 1.875 = 150\text{ ml}$ Nutrisi A + $150\text{ ml}$ Nutrisi B).
- The Web UI, schedule store, and Dosing Queue pipeline strictly synchronize these values across all layers, ensuring that scheduled runs never evaluate or display as `0 ml` when a recipe is attached.

---

# 32. Mixing Tank Infrastructure & Equipment Scope Assignment

## 32.1 Mixing Tank Container vs Mixing Actuators
A mixing tank is physically composed of two distinct operational elements:
1. **Physical Container (Reservoir):** Defined in the greenhouse or complex topology by `telemetry.tankCapacityL` (e.g. 1,000 L). It is not a GPIO pin output, but an authoritative container resource where nutrient solution is prepared.
2. **Mixing & Circulation Actuator:** **GPIO 40** (Mixing Tank AC Pump / Pompa Sirkulasi & Pengaduk 220V AC pada 4-Ch Relay IN4).

## 32.2 Scope & Allocation (Complex Shared vs Dedicated)
In standard greenhouse complexes (both single-GH and multi-GH topologies):
- The Mixing Tank container and associated actuators (`pump_mixing` on GPIO 40, `pump_dosing_a` on GPIO 5, `pump_dosing_b` on GPIO 6, `pump_well` on GPIO 1, `float_lower` on GPIO 38) operate as **Shared Complex Infrastructure** (`scope: "SHARED"`, `complexId: "complex-01"`).
- These shared components automatically serve greenhouses within the complex during scheduled fertigation runs.
- In `CANONICAL_GPIO_PIN_MAP`, GPIO 40 is defined as `scope: "CONFIGURABLE"` with `defaultActive: true`, allowing it to operate as a Shared Facility by default, or be explicitly dedicated to a specific greenhouse if required by physical piping.

## 32.3 Equipment Management UI Presentation
To eliminate user confusion where equipment appears missing when filtering by greenhouse:
- When the operator views an individual Greenhouse tab (e.g., `🌿 GH-01`):
  - A prominent **Tangki Mixing & Fasilitas Bersama (Shared Infrastructure)** banner is displayed.
  - Shows container status (`1,000 L`), Pompa Sirkulasi (`GPIO 40`), Dosing Pupuk (`GPIO 5 & 6`), and Pompa Air Baku (`GPIO 1`).
  - Provides instant draft activation (`+ Aktifkan`) for GPIO 40 and a one-click button to jump to the Shared Facility tab.
- Schedule validation (`enrichScheduleWithActivationState`) inspects both complex-level shared equipment and greenhouse equipment (`gh.equipment` + `complex.equipment` + `gh.telemetry.tankCapacityL`), preventing spurious `MISSING_MIXING_TANK` blocked states.

---

# 33. Diagnostic Error Code Contract & Living Queue Isolation Model

## 33.1 Separation of Concerns: Firmware Codes vs Web UI Diagnostic Presentation
To guarantee predictable real-time execution and prevent memory overhead or string bloat on the ESP32 micro-controller:
- **Firmware Authority:**
  - ESP32 strictly emits compact, machine-readable alphanumeric error codes (`errorCode`, max 31 chars) and the associated hardware identifier (`affectedComponent`, max 31 chars) in its REST responses (`queuedBatches[]` and `todaySchedule[]`).
  - ESP32 does *not* format multi-line human descriptions, markdown banners, or localized guidance strings.
- **Web UI Authority:**
  - The browser application maintains the authoritative diagnostic dictionary (`src/lib/fertigationErrorMap.ts`).
  - Translates machine codes into clear, contextual Indonesian explanations, severity rankings (`CRITICAL`, `WARNING`, `INFO`), and provides contextual one-click resolution actions (e.g., direct navigation to `/calibration?componentId=...`, re-sync trigger, or dismiss).

## 33.2 Standard Diagnostic Error Codes
| Error Code | Affected Component / Context | Description | UI Action |
| :--- | :--- | :--- | :--- |
| `DOSING_PUMP_NOT_CALIBRATED` | `pump_dosing_a`, `pump_dosing_b`, etc. | Calibration pulse/flow parameters missing or 0 in hardware registry. | `[⚙ Kalibrasi Pompa Sekarang]` (navigates to `/calibration?componentId=...`) |
| `DOSING_RATE_INVALID` | `pump_dosing_a`, etc. | Configured dosing flow rate is outside valid physical delivery range. | `[⚙ Kalibrasi Pompa Sekarang]` |
| `FLOW_SENSOR_NOT_CALIBRATED` | `flow_sensor_water`, etc. | Water flow meter calibration coefficient missing or zero. | `[⚙ Kalibrasi Sensor Aliran]` |
| `CONFIG_HASH_MISMATCH` | Complex / System | Deployed hardware configuration out of sync with ESP32 active registry. | `[🔄 Sinkronkan Antrean]` |
| `EQUIPMENT_NOT_READY` | Actuator / Valve / Pump | Required dosing/mixing actuator unassigned or in faulted state. | `[⚙ Periksa Peralatan]` |
| `INVALID_RECIPE_PARAMETERS` | Recipe / Channel | Recipe dosage volume evaluates to 0 ml or exceeds tank limits. | `[Periksa Resep]` |
| `FLOW_FAULT` | Flow meter / Water Line | Water flow pulse stopped during active filling/delivery. | `[Periksa Jalur Air]` |
| `DELIVERY_TIMEOUT` | Delivery Pump / Valve | Transfer volume not reached within maximum safety deadline. | `[Periksa Pompa Penyaluran]` |
| `HARDWARE_INTERLOCK_FAULT` | Interlock circuit | Safety contact or tamper loop opened during run. | `[Periksa Interlock]` |
| `EMERGENCY_STOP_ACTIVE` | E-Stop circuit | Physical emergency stop button pressed or latched. | `[Reset E-Stop]` |

## 33.3 Living Queue Isolation & Head Eviction
Under previous iterations, an uncalibrated pump or invalid batch left the entry sitting in `s_dosing_queue[0]` with state `FAILED`, presenting a contradictory UI state where Central Unit was "Standby" while Antrean #1 displayed a red "Gagal Dieksekusi" badge.
- **Firmware Rule:**
  - In `scheduler.c`, whenever command submission to `fertigation_mgr` fails or a batch encounters a terminal fault, the failure is recorded in `head->error_code`, mapped to the corresponding occurrence in `s_today_occurrences[]`, and the failed head is immediately evicted (`s_dosing_queue_count--`).
  - Active execution queue (`s_dosing_queue`) contains strictly actionable jobs (`RUNNING`, `PENDING_FIFO`, `ACTIVE`).
- **Web UI Presentation Rule:**
  - `FertigationQueueDashboard.tsx` cleanly partitions jobs into `livingQueuedJobs` (only active items) and `blockedJobs` (batches with error codes or blocked statuses).
  - Blocked batches are presented as a prominent **Smart Diagnostic Alert Card** with direct remediation buttons above the queue.
  - Operators may resolve the issue (e.g. calibrate the pump) or dismiss the alert (`[✕ Abaikan]`), keeping the active FIFO execution sequence completely clear of dead or failed entries.

---

# 34. Sensor & Actuator Calibration Model

## 34.1 Lower Float Switch (`float_lower` / GPIO 38) — Calibration Exemption
- **Physical Characteristic:** The lower float switch is a discrete binary safety sensor (dry contact / NO/NC switch pulled up to 3.3V).
- **Operational Rule:**
  - The lower float switch operates strictly as a dry-run safety interlock and minimum liquid boundary (`FLOAT_LEVEL_DRY` vs `FLOAT_LEVEL_OK`).
  - It does NOT have analog voltage curves, pulses per liter, or flow rates.
  - The firmware and Web UI **MUST NEVER** request, demand, or check calibration for `float_lower`, nor block any operational schedule because a float switch is "uncalibrated".
  - In `esp32/main/http/api_calibration_handlers.c`, float switches are explicitly excluded from `LEVEL` calibration compatibility.

## 34.2 Raw Water Pump 12V DC (`pump_submersible` / GPIO 4) — Field Calibration via Small Flow Sensor
- **CRITICAL TERMINOLOGY & HARDWARE BOUNDARY:**
  - **Raw Water Pump 12V DC (`pump_submersible` / GPIO 4 / MOSFET Module #1 / PUMP 3):**
    - Submersible 12V DC pump transferring water from the raw water storage reservoir into the central mixing tank.
    - **Pipe Line:** The water line from this pump passes through the **Small Raw Water Pulse Flow Meter (`flow_sensor_water` / ZJ-B1 on GPIO 15)**.
    - **Calibration Target:** THIS IS THE PUMP TO BE CALIBRATED.
  - **Deep Well Pump 220V AC (`pump_well` / GPIO 1 / 4-Ch Relay IN1 / PUMP 1):**
    - High-voltage 220V AC submersible pump dedicated to deep ground well extraction to fill the raw water storage reservoir.
    - It is **NOT** the 12V raw water mixing feed pump and does **NOT** route through the small ZJ-B1 flow meter.
    - Never confuse or swap "Raw Water Pump 12V" with "Well Pump 220V".
- **Operational Calibration Rule:**
  - The Raw Water Pump 12V DC MUST be field-calibrated to determine its actual pumping capacity / volumetric flow rate (L/min or mL/sec).
  - **Tank Low Float Exemption:** The Raw Water Pump (`pump_submersible` / `RAW_SUBMERSIBLE` on GPIO 4) transfers water from the raw reservoir into the mixing tank to fill it. It is strictly exempted from the mixing tank dry-run interlock (`float_lower_ok`), which applies only to delivery/distribution pumps.
  - **Calibration Ownership & Safety:** During calibration runs, the actuator is acquired under `ACTUATOR_OWNER_CALIBRATION` with `SAFETY_COMMAND_CALIBRATION` authorization. This prevents routine run-time flow-timeout tripping while preserving immediate hardware emergency-stop (`EMERGENCY_STOP`) and operator abort capabilities.
  - **Measurement Ingestion:** During a volumetric calibration run (`/api/v1/calibration` with `VOLUMETRIC` on `pump_submersible` for $T$ seconds):
    1. ESP32 drives `pump_submersible` (GPIO 4 Active-HIGH) while accumulating pulses from the small raw flow sensor (`flow_sensor_water` / ZJ-B1 on GPIO 15) via `sensor_hal`.
    2. ESP32 returns the delta volume in `/api/v1/calibration/status` (`measured_ml` and `measured_l`).
    3. If pulses are metered, the Web UI automatically ingests `measured_ml` directly from the sensor. If pulses are zero (e.g. initial dry bench testing or open discharge into an external measuring container), the run completes with state `COMPLETE` (`measured_ml = 0`), enabling manual beaker volume input in the UI.
    4. The resulting rate $\text{Rate} = \frac{\Delta V}{T}$ is saved to ESP32 calibration records (`/api/v1/calibration/rate`) as an authoritative `PUMP_RATE` / `DOSING_RATE` record for `pump_submersible` (`rateRawWaterPumpMlSec`).
  - **Fail-Safe Rule:** Emergency-stop and operator-stop terminations are reported as `EMERGENCY_STOP` and `STOPPED_BY_OPERATOR`.

---

# 35. Core Protocol Mixing & Dosing Orchestrator Architecture (`protocol_mixing`)

## 35.1 Scope & Purpose
The `protocol_mixing` module (`esp32/main/services/protocol_mixing.c` and `esp32/main/services/protocol_mixing.h`) is the dedicated, standalone orchestrator for the mixing and nutrient dosing lifecycle on the ESP32. It intentionally does NOT integrate with schedulers, fertigation distribution queues, or higher-level business logic at this stage, preserving strict modularity and high safety reliability.

## 35.2 Public API & Configuration
```c
mixing_result_t protocol_mixing(const mixing_protocol_config_t *config);
esp_err_t stop_mixing_protocol_actuators(const mixing_protocol_config_t *config);
```

- **Input Configuration (`mixing_protocol_config_t`):**
  - `raw_water_target_ml`: Target volume of raw water in mL (must be > 0).
  - `threshold_percent`: Dynamic threshold percent (0-100%) from schedule registration (`threshold_volume_ml = (raw_water_target_ml * threshold_percent) / 100`). Never hardcoded.
  - `post_mix_duration_sec`: Required agitation duration of the mixing pump in seconds AFTER raw water filling and all dosing have completed.
  - `channel_count`: Dynamic number of active dosing pumps (0 to `MAX_MIXING_DOSING_CHANNELS` = 8).
  - `channels[]`: Dynamic array of `mixing_dosing_channel_config_t` (`component_id`, `target_volume_ml`).
  - `no_flow_grace_period_sec`: Grace period for flow sensor response (default: 15s).
  - `poll_interval_ms`: Polling tick rate (default: 100ms).

## 35.3 Execution Sequence & State Flow
```text
PRECHECK
   ↓
START RAW WATER PUMP (pump_submersible / GPIO 4)
   ↓
MONITOR FLOW SENSOR (ZJ-B1 / GPIO 15, Source of Truth)
   ↓
ACTUAL VOLUME >= THRESHOLD (actual_raw_water_ml >= threshold_volume_ml)
   ↓
START MIXING PUMP (GPIO 40) + START ALL DOSING PUMPS SIMULTANEOUSLY (Parallel)
   ↓
RAW WATER TETAP BERJALAN (NEVER stops at threshold)
   ↓
ACTUAL RAW WATER >= TARGET (actual_raw_water_ml >= raw_water_target_ml)
   ↓
RAW WATER PUMP OFF
   ↓
WAIT ALL DOSING PUMPS COMPLETE (each channel shuts OFF as individual calibrated volume is met)
   ↓
POST MIX DURATION (mixing pump continues agitating for post_mix_duration_sec)
   ↓
MIXING PUMP OFF
   ↓
SUCCESS (MIXING_RESULT_SUCCESS)
```

## 35.4 Core Operational & Safety Rules
1. **Flow Sensor as Source of Truth:**
   - Raw water delivery is metered exclusively via the physical pulse flow meter (`sensor_flow_raw` / ZJ-B1 on GPIO 15).
   - Raw water volume is NEVER estimated from a timer.
2. **Dynamic Threshold Calculation:**
   - `threshold_percent` is dynamically provided by schedule registration (e.g. 10%, 20%, 25%, 30%).
   - Protocol computes: $\text{threshold\_volume\_ml} = \frac{\text{raw\_water\_target\_ml} \times \text{threshold\_percent}}{100}$.
   - No threshold percentage is hardcoded in the protocol.
3. **Simultaneous Parallel Dosing Channels:**
   - When the threshold volume is reached, all configured dosing channels start **SIMULTANEOUSLY**.
   - Each dosing pump runs for its own calibrated duration: $T_{\text{dosing}} = \frac{V_{\text{target}}}{\text{Rate}_{\text{cal}}}$.
   - Channels shut down independently as their respective target dosages are met.
4. **Strict 1.5x Calibration Timeout & Reachable Dosing Timeout:**
   - For raw water:
     $$T_{\text{expected}} = \frac{V_{\text{target}}}{\text{Rate}_{\text{cal\_raw}}}, \quad T_{\text{timeout}} = T_{\text{expected}} \times 1.5$$
   - For each dosing pump:
     $$T_{\text{expected\_dosing}} = \frac{V_{\text{target}}}{\text{Rate}_{\text{cal\_dosing}}}, \quad T_{\text{timeout\_dosing}} = T_{\text{expected\_dosing}} \times 1.5$$
   - When expected dosing runtime is reached ($t \ge T_{\text{expected}}$), protocol requests OFF.
     - If OFF command succeeds: channel is marked `completed = true`.
     - If OFF command fails or actuator faults: channel is NOT completed, stays monitored until $t > T_{\text{timeout}}$ ($1.5\times$), tripping `MIXING_RESULT_DOSING_TIMEOUT` and triggering safe-stop.
   - Actuator OFF error checks: Raw water, dosing, and mixing pumps check `set_actuator_state(..., false)` results. If OFF command fails, protocol fails with `MIXING_RESULT_ACTUATOR_ERROR` and never returns premature success.
5. **Post-Mix Duration Protocol & Semantics Audit:**
   - Post-mix agitation starts strictly AFTER raw water pump is OFF (100% target met) AND all dosing pumps are complete.
   - The mixing pump continues running for `post_mix_duration_sec`, then turns OFF.
   - **Post-mix Semantics of Value 0:** In legacy schemas, `mixingDurationSec == 0` existed in scheduler/fertigation, but for `post_mix_duration_sec` specifically, no canonical contract formalizes the exact semantics of `0` (`POST_MIX_DURATION_SEMANTICS_UNDEFINED`). The field is preserved as passed by caller without inventing artificial defaults (e.g. 30s/60s).
6. **Progress-Based No-Flow Detection:**
   - Flow monitoring tracks continuous volume progress (`last_flow_volume_ml`, `last_flow_progress_time`).
   - If raw water pump is active and time since last progress exceeds `no_flow_grace_period_sec` (default: 15s) while actual volume < target (e.g. flow stalls at 500 mL), protocol trips `MIXING_RESULT_RAW_WATER_NO_FLOW` and triggers safe-stop.
7. **Scoped Safe Stop & Actuator Isolation Mandate:**
   - Safe stop is strictly **job-scoped**: protocol only turns OFF and releases actuators acquired and owned by the active mixing job.
   - No unconditional global kill switches are applied to unowned hardware channels.
   - If `actuator_hal_is_emergency_stopped()` is latched or abort is requested at ANY point, all job-owned actuators are shut OFF immediately and the protocol returns `MIXING_RESULT_EMERGENCY_STOP`.
   - Every error pathway executes job-scoped safe-stop before returning.
   - No automatic retry is executed on errors.

---

# 36. Canonical State Machine Integration (`protocol_mixing` as Single Execution Path)

## 36.1 Single Canonical Engine Mandate
`protocol_mixing()` is the single, canonical implementation for mixing, raw water metering, dynamic threshold triggering, simultaneous dosing, and post-mix agitation across the firmware.

All dual implementations and legacy state machine preparation branches have been eliminated:
1. **Removed Legacy States:**
   - `FERT_STATE_FILLING`
   - `FERT_STATE_DOSING`
   - `FERT_STATE_FINAL_MIXING`
   - `FERT_STATE_MIX_READY`
   - `FERT_STATE_DELIVERY`
2. **Active State Machine (`fertigation_state_t`):**
   - `FERT_STATE_IDLE` (Standby / ready for next preparation)
   - `FERT_STATE_RECOVERY_HOLD` (Power loss recovery safe-hold, manual inspection required)
   - `FERT_STATE_PRECHECK` (Pre-execution validation and sensor auditing)
   - `FERT_STATE_MIXING` (Active canonical execution via `protocol_mixing(&mix_cfg)`)
   - `FERT_STATE_COMPLETE` (Lifecycle terminal state)
   - `FERT_STATE_INTERRUPTED` (Emergency-stop or manual abort)
   - `FERT_STATE_FAULTED` (Actuator fault, timeout, or safety trip)
   - `FERT_STATE_ABORTED` (Explicit operator abort)

## 36.2 Execution Flow in `fertigation_mgr.c`
```text
FERT_STATE_PRECHECK
   │ (Validates recipe, flow sensor, routing valves)
   ▼
FERT_STATE_MIXING
   │ (Acquires routing valves, builds mixing_protocol_config_t)
   ├── protocol_mixing(&mix_cfg)
   │     ├── Meter raw water to dynamic threshold
   │     ├── Trigger mixing pump & all active dosing pumps in parallel
   │     ├── Continue raw water to 100% target volume
   │     ├── Stop dosing channels upon individual calibrated volumes
   │     └── Run post-mix agitation duration
   ├── Close & release routing valves
   ├── Record observed dosing runtimes (s_dosing_runtime_observed_ms)
   ├── Transfer batch snapshot to s_delivery_slots (DELIVERY_SLOT_READY_TO_SEND)
   └── Return central engine immediately to FERT_STATE_IDLE
```

## 36.3 Parallel Decoupled Delivery
Greenhouse fertigation distribution is fully decoupled from the central preparation engine. Once `protocol_mixing()` succeeds:
- The prepared batch is handed over to `s_delivery_slots` with state `DELIVERY_SLOT_READY_TO_SEND`.
- The central preparation state returns to `FERT_STATE_IDLE`, freeing central shared resources (raw water pump, dosing pumps, mixing pump) for the next queued recipe.
- Per-greenhouse distribution pumps are commanded independently by the scheduler monitor loop without blocking central preparation.

