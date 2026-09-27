# Scheduling and Mechanical Control Specification

**Document status:** Authoritative working specification  
**Scope:** 1 Complex dikendalikan oleh 1 ESP32  
**Primary runtime authority:** ESP32  
**Configuration transport:** UI → ESP32  
**Persistence / analysis path:** ESP32 → UI → Python  

> **Status dokumen:** Aturan mekanis di bawah mengikuti keputusan operasional terbaru. Bagian yang secara eksplisit diberi label **TO BE CONTINUED** belum merupakan kontrak implementasi final.

---

# 1. Tujuan Sistem

Sistem memiliki tiga scheduling domain utama:

1. **WELL_PUMP** — supply air dari sumur ke raw-water tank.
2. **MIXING** — membuat satu batch larutan GH yang terdiri dari raw water + seluruh dosing yang diperlukan.
3. **FERTIGATION / DISTRIBUTION** — menyalurkan batch yang sudah siap dari tank GH ke tanaman menggunakan fertigation/distribution pump GH.

Ketiga domain berbeda secara semantik dan memiliki runtime state masing-masing. ESP32 menjadi otoritas terhadap kondisi fisik, sequence actuator, timer lokal, sensor, queue, dan event runtime.

UI berfungsi untuk mengatur konfigurasi, mengirim full snapshot schedule, menampilkan state ESP32, serta menjadi jalur penerusan log menuju Python.

Python pada tahap berikutnya menyimpan dan menganalisis schedule serta event log. Detail integrasi UI → Python diberi status **TO BE CONTINUED**.

Repository yang diperiksa saat ini masih memiliki mock/local service dan API client yang belum menjadi bukti bahwa seluruh endpoint/server sudah benar-benar terhubung. Audit juga menyatakan runtime UI saat ini belum menjadi sumber kebenaran hardware. fileciteturn5file1L109-L130

---

# 2. Arsitektur dan Batas Tanggung Jawab

## 2.1 Complex

Satu Complex dikendalikan oleh tepat satu ESP32.

Komponen level Complex yang menjadi sumber daya sistem:

- Well pump
- Raw-water tank
- Raw-water flow meter
- Dosing pumps A-N/C sesuai inventory
- Dosing valves yang terkait dengan dosing pump

Komponen per-GH:

- GH mixing/batch tank
- GH fertigation/distribution pump
- GH valve jika topology memang memerlukannya
- Sensor GH yang dibutuhkan runtime

## 2.2 ESP32

ESP32 bertanggung jawab atas:

- menyimpan konfigurasi runtime terakhir yang valid;
- menjalankan timer/scheduler lokal;
- menjalankan sequence actuator;
- mengatur batch mixing;
- mengubah target volume dosing dari mL menjadi runtime pompa berdasarkan calibration;
- membaca flow meter untuk actual raw-water volume;
- mengatur queue dosing;
- mengatur runtime state;
- menghentikan atau membatalkan batch sesuai safety/event;
- menghasilkan event log;
- mempertahankan operasi berdasarkan konfigurasi terakhir yang valid ketika koneksi eksternal tidak tersedia.

Audit repository juga mengusulkan ESP32 mengembalikan runtime state, actual actuator state, sensor telemetry, tank/flow information, actual dose/volume, queue status, event/fault, emergency-stop state, dan execution progress. fileciteturn5file5L482-L498

## 2.3 UI

UI bertanggung jawab atas:

- input schedule;
- input volume dalam mL;
- input threshold mixing;
- input calibration configuration;
- create/edit/delete/enable/disable schedule;
- menyusun ulang full `schedules[]` snapshot;
- mengirim snapshot ke ESP32;
- menampilkan status accepted/rejected;
- menampilkan runtime state dan event log ESP32;
- menyediakan tombol manual untuk operasi yang memang diizinkan.

UI tidak boleh menganggap perubahan local state sebagai bukti actuator fisik telah berubah.

## 2.4 Python

**TO BE CONTINUED — UI → Python**

Tahap lanjutan akan mendefinisikan Python sebagai pihak yang:

- menyimpan schedule;
- menyimpan event log;
- menganalisis schedule dan event;
- melakukan reconciliation/persistence setelah menerima data dari ESP32.

Audit repository memang mengusulkan Python sebagai durable application/control-plane owner untuk persistence, telemetry/event storage, schedule/recipe persistence, dan reconciliation. fileciteturn5file2L182-L200

---

# 3. Scheduling Domains

## 3.1 WELL_PUMP

### Fungsi

Memindahkan air dari **sumur** ke **raw-water tank**.

### Trigger

Well pump mempunyai dua mode start:

1. **Scheduled** — berdasarkan waktu.
2. **Manual** — dari tombol toggle fisik di controller utama atau tombol di web app.

Contoh scheduled:

```text
06:00 -> WELL_PUMP START
06:01 -> WELL_PUMP STOP
```

### `time` dan `to-time`

Untuk well-pump schedule:

- `time` = waktu ON/START;
- `to-time` = waktu OFF/STOP.

`to-time` **bukan** berarti pompa boleh berjalan terus sampai tangki penuh. Sistem tidak menggunakan schedule open-ended. Pompa memiliki waktu padam yang eksplisit.

Contoh:

```json
{
  "id": "wp-001",
  "type": "well_pump",
  "enabled": true,
  "time": "06:00",
  "to-time": "06:01"
}
```

Maknanya:

```text
06:00 -> START
06:01 -> STOP
```

ESP32 harus memperlakukan `to-time` sebagai batas berhenti schedule.

### Manual ON/OFF

Manual operation diperbolehkan melalui:

- toggle fisik pada controller utama;
- tombol/toggle pada web app melalui URL link/control page.

Aturan manual ON:

- manual ON **maksimal 15 menit**;
- sebelum 15 menit tercapai, user dapat menghentikan dengan tombol STOP di web app atau toggle fisik;
- ketika batas 15 menit tercapai, ESP32 harus otomatis mematikan well pump;
- manual ON tidak menghapus atau mengubah schedule otomatis.

Contoh:

```text
10:00 -> user tekan MANUAL ON
10:00–10:15 -> pompa boleh ON
10:07 -> user tekan STOP -> pompa OFF
```

### Interlock

Well-pump safety cutoff **tidak dikelola oleh ESP32 berdasarkan radar 220V**.

Arsitektur fisik yang dipilih adalah:

```text
Well Pump power/control
      │
      └── safety cutoff lewat radar 220V
```

ESP32 tidak memotong jalur listrik radar sebagai interlock software.

Dengan demikian, ESP32 dapat mengetahui state command/control yang dikirimnya, tetapi keputusan pemutusan daya karena kondisi radar/full tank dilakukan oleh rangkaian radar 220V yang memutus koneksi pump secara fisik.

> **Penting:** status radar 220V dan status aktual listrik pump belum menjadi telemetry ESP32 pada spesifikasi ini. Jangan menganggap `commanded=ON` berarti motor pasti sedang menerima daya.

### Karakteristik

Well pump:

- tidak menunggu fertigation;
- tidak menjadi bagian dari batch mixing tertentu;
- merupakan supply operation berdiri sendiri;
- memiliki scheduled mode dan manual mode;
- manual mode memiliki maximum ON duration 15 menit.

---

## 3.2 MIXING

### Definisi

Raw water dan dosing A-N/C adalah **satu batch yang sama**.

Satu fertigation preparation tidak boleh dianggap sebagai:

```text
Batch raw water terpisah
+
Batch dosing terpisah
```

Model yang benar:

```text
1 BATCH
├── Raw Water Target
├── Dosing A Target
├── Dosing B Target
└── Dosing N/C Target
```

### Fungsi

Membuat batch siap distribusi pada GH tertentu.

### Aturan inti

Urutan dasar batch mixing adalah:

```text
RAW WATER START
      ↓
RAW WATER ACTUAL >= threshold%
      ↓
DOSING SERIAL A → B → ... → N/C
      ↓
RAW WATER dan seluruh DOSING complete
      ↓
BATCH COMPLETE
      ↓
READY
```

Raw water harus menjadi input/operasi pertama di dalam batch.

### Raw filter

Pada konfigurasi mixing, **raw filter** juga diinput sebagai nilai volume dalam mL apabila memang ada proses dosing/filter media yang diukur secara volumetrik pada hardware final.

Aturan unit tetap:

```text
UI input = mL
ESP32 = translate mL → pump ON time berdasarkan calibration
```

Field dan channel final harus mengikuti hardware inventory final.

---

## 3.3 FERTIGATION / DISTRIBUTION

Fertigation/distribution adalah operasi fisik penyaluran batch yang sudah siap dari tank GH menuju tanaman.

Komponen:

- GH fertigation/distribution pump;
- valve terkait bila diperlukan oleh topology;
- lower-boundary / low-level sensor pada tank batch/distribution.

Distribution adalah runtime state terpisah dari mixing.

### Parallelism Antar-GH

**Fertigation pump GH-A sampai GH-N boleh berjalan bersamaan**, sepanjang:

- masing-masing menggunakan hardware GH yang berbeda;
- safety/interlock masing-masing terpenuhi;
- tidak ada physical resource conflict.

Dengan demikian:

```text
GH-A DISTRIBUTING ──────┐
GH-B DISTRIBUTING ──────┼─ boleh bersamaan
GH-C DISTRIBUTING ──────┘
```

Aturan ini berlaku untuk **fertigation/distribution pump per-GH**, bukan untuk central dosing pumps.

---

# 4. Schedule Object Model

Semua schedule berada dalam satu array konfigurasi:

```ts
schedules: unknown[]
```

Setiap item wajib memiliki `type`.

Type utama:

```text
well_pump
fertigation
```

`fertigation` merupakan deklarasi jadwal yang menjadi sumber pembentukan batch mixing dan operation fertigation/distribution.

`mixing` merupakan runtime operation hasil dekomposisi dari fertigation schedule, bukan berarti user harus membuat schedule mixing terpisah untuk setiap fertigation.

---

# 5. Configuration Envelope

## 5.1 Envelope

Contoh:

```json
{
  "complexId": "complex-001",
  "configurationVersion": 17,
  "schedules": [
    {
      "id": "wp-001",
      "type": "well_pump",
      "enabled": true,
      "time": "06:00",
      "to-time": "06:01"
    },
    {
      "id": "fert-001",
      "type": "fertigation",
      "ghId": "gh-a",
      "enabled": true,
      "time": "15:00",
      "rawWaterMl": 20000,
      "dosing": {
        "A": 20,
        "B": 20,
        "N": 20
      },
      "mixing": {
        "rawWaterStartThresholdPercent": 20
      }
    }
  ]
}
```

### Catatan penting

`rawWaterStartThresholdPercent` adalah **configuration parameter**, bukan konstanta firmware.

Nilai default yang dipakai saat ini adalah 20%, tetapi UI harus dapat mengubahnya.

Contoh:

```text
20%
25%
30%
```

Jika UI mengubah dari 20% menjadi 25%, snapshot baru yang dikirim ke ESP32 harus menggunakan 25%.

---

# 6. Unit dan Konversi

## 6.1 Input UI

Semua target volume di UI diinput dalam **mL**.

Contoh:

```json
{
  "rawWaterMl": 20000,
  "dosing": {
    "A": 20,
    "B": 20,
    "N": 20
  }
}
```

## 6.2 Tanggung jawab ESP32

ESP32 mengubah target volume menjadi durasi ON actuator berdasarkan calibration.

UI **tidak** boleh menghitung:

```text
20 mL = 2.4 detik
```

UI hanya mengirim:

```text
target = 20 mL
```

ESP32 menghitung durasi berdasarkan calibration terbaru.

## 6.3 Raw water

Untuk raw water, actual volume ditentukan oleh flow meter.

ESP32 tidak boleh menganggap volume tercapai hanya karena pump sudah ON selama X detik.

## 6.4 Dosing dan raw filter

Dosing dan raw filter yang diukur secara volumetrik di-input sebagai mL.

ESP32 menggunakan calibration coefficient yang sesuai dengan pump/channel.

---

# 7. Configuration Replacement

## 7.1 Full Snapshot

Setiap perubahan schedule menggunakan full snapshot.

```text
UI
 ↓
ubah local configuration
 ↓
bentuk ulang seluruh schedules[] Complex
 ↓
PUT full configuration ke ESP32
 ↓
ESP32 validate
 ↓
VALID → atomic apply
INVALID → retain last valid configuration
```

Tidak ada patch schedule parsial sebagai source of truth utama.

## 7.2 Create

Saat membuat schedule:

1. UI mengambil konfigurasi schedule Complex saat ini.
2. UI menambahkan schedule baru.
3. UI membentuk full `schedules[]`.
4. UI mengirim snapshot baru ke ESP32.
5. ESP32 memvalidasi.
6. ESP32 menerima dan apply secara atomic jika valid.

## 7.3 Edit

Edit satu schedule tetap menghasilkan full snapshot.

## 7.4 Delete Schedule

Delete satu schedule juga menghasilkan full snapshot.

## 7.5 Delete GH

Jika **GH-X dihapus**, maka seluruh schedule yang mempunyai `ghId = GH-X` harus ikut dihapus.

Proses wajib:

```text
UI load seluruh schedule Complex
        ↓
filter/remove seluruh schedule ghId = GH-X
        ↓
UI membentuk schedules[] baru
        ↓
submit full snapshot ke ESP32
        ↓
ESP32 validate
        ↓
atomic apply
```

Contoh:

```text
Sebelum:
- wp-001
- fert-gh-a-001
- fert-gh-x-001
- fert-gh-x-002
- fert-gh-b-001

Delete GH-X

Sesudah:
- wp-001
- fert-gh-a-001
- fert-gh-b-001
```

UI harus memastikan tidak ada orphan schedule yang masih menunjuk ke GH yang sudah dihapus.

## 7.6 Disable

Disable schedule juga menghasilkan full snapshot.

Disable tidak sama dengan delete.

```json
{
  "enabled": false
}
```

---

# 8. Fertigation Schedule → Batch Decomposition

Contoh schedule:

```json
{
  "id": "fert-001",
  "type": "fertigation",
  "ghId": "gh-a",
  "time": "15:00",
  "rawWaterMl": 20000,
  "dosing": {
    "A": 20,
    "B": 20,
    "N": 20
  },
  "mixing": {
    "rawWaterStartThresholdPercent": 20
  }
}
```

ESP32 membuat satu batch preparation:

```text
batchId = generated runtime identifier
scheduleId = fert-001
ghId = gh-a
```

Batch memiliki dua domain runtime:

```text
MIXING
  ↓
READY
  ↓
FERTIGATION
```

Tidak boleh dianggap sebagai satu actuator timer tunggal.

## 8.1 Calibration Snapshot Wajib untuk Setiap Batch

Setiap batch mixing **WAJIB mempunyai calibration snapshot** pada saat batch dibuat. Batch tidak boleh masuk execution apabila calibration yang diperlukan untuk seluruh dosing component yang digunakan tidak tersedia.

Aturan:

1. UI/ESP32 memeriksa calibration aktif untuk setiap dosing pump yang digunakan oleh batch.
2. Calibration yang dipakai adalah **calibration terakhir yang valid** pada saat batch dibuat.
3. Nilai calibration tersebut disalin ke `batch.calibrationSnapshot`.
4. Setelah batch dibuat, calibration snapshot batch bersifat immutable.
5. Jika user melakukan calibration baru setelah batch dibuat, batch yang sedang berjalan **tetap menggunakan calibration snapshot lama**.
6. Batch berikutnya akan menggunakan calibration terbaru yang valid pada saat batch tersebut dibuat.
7. Tidak ada tolerance correction di tengah batch. Runtime dihitung dari calibration snapshot batch.
8. Jika salah satu calibration yang diwajibkan tidak tersedia, batch **tidak boleh dibuat/started**. UI harus memberikan alert yang eksplisit dan ESP32 tetap menolak batch tersebut.

### Mandatory UI Guard

UI harus memiliki guard yang jelas dan tidak boleh bergantung hanya pada visual warning. Pemeriksaan wajib dilakukan sebelum request create/start batch. Implementasi UI harus mempunyai kondisi hardcoded yang mudah ditemukan dalam source code, misalnya:

```ts
if (!calibrationAvailableForBatch) {
  alert('CALIBRATION REQUIRED: Calibration belum tersedia untuk semua dosing pump pada batch ini. Batch tidak dapat dijalankan.');
  return;
}
```

String alert tersebut sengaja dibuat eksplisit agar mudah dicari saat audit kode. Guard ini **bukan pengganti validasi ESP32**. ESP32 tetap wajib melakukan validasi kedua sebelum actuator dijalankan.

### Batch Calibration Snapshot Example

```json
{
  "batchId": "batch-20260913-0001",
  "ghId": "gh-a",
  "calibrationSnapshot": {
    "A": {
      "calibrationId": "cal-a-007",
      "mlPerSecond": 1.82,
      "calibratedAt": "2026-09-12T10:00:00+07:00"
    },
    "B": {
      "calibrationId": "cal-b-004",
      "mlPerSecond": 1.76,
      "calibratedAt": "2026-09-12T10:02:00+07:00"
    },
    "N": {
      "calibrationId": "cal-n-006",
      "mlPerSecond": 2.10,
      "calibratedAt": "2026-09-12T10:04:00+07:00"
    }
  }
}
```

Batch tersebut selamanya menggunakan snapshot A/B/N di atas selama lifecycle batch tersebut.

---

# 9. Batch Mixing Mechanical Rules

## 9.1 Satu Batch

Untuk satu fertigation schedule:

```text
1 batch =
  raw water target
  + raw filter target jika digunakan
  + dosing A target
  + dosing B target
  + dosing N/C target
```

Semua komponen tersebut selesai sebagai satu batch.

## 9.2 Fase 1 — Raw Water Start

Saat batch dimulai:

```text
RAW WATER ROUTING START
FLOW METER ACTIVE
```

Dosing **belum boleh start**.

## 9.3 Fase 2 — Raw Water Fill to Configurable Threshold

Threshold bukan konstanta tetap.

UI mengatur:

```text
rawWaterStartThresholdPercent
```

Misal:

```text
rawWaterTarget = 20.000 mL
threshold = 20%
```

Maka:

```text
threshold volume = 4.000 mL
```

Jika threshold diubah menjadi 25%:

```text
threshold volume = 5.000 mL
```

ESP32 menghitung threshold volume dari konfigurasi dan memonitor actual flow-meter volume.

## 9.4 Fase 3 — Dosing Start

Saat:

```text
rawWaterActual >= thresholdVolume
```

ESP32 boleh memulai dosing.

Contoh:

```text
08:00:00 raw water START
08:00:01 raw = 500 mL
08:00:05 raw = 2.800 mL
08:00:07 raw = 4.000 mL  ← threshold tercapai
08:00:07 Dosing A START
08:00:07 Dosing B START? NO — lihat aturan serial
08:00:07 Dosing N START? NO — lihat aturan serial
```

Mulai dari threshold, dosing mengikuti queue serial yang telah ditetapkan pada Section 10.

## 9.5 Raw Water Tetap Berjalan

Setelah threshold tercapai, raw water **tetap menjadi bagian dari batch dan tetap dapat mengalir** sampai target raw-water volume tercapai.

Sehingga:

```text
RAW WATER
██████████████████████████
          
DOSING
          ███ A ███
                  ███ B ███
                          ███ N ███
```

## 9.6 Batch Complete

Batch mixing hanya `COMPLETE` jika seluruh kebutuhan batch selesai:

```text
raw water complete
AND
raw filter complete jika digunakan
AND
dosing A complete jika digunakan
AND
dosing B complete jika digunakan
AND
dosing N/C complete jika digunakan
```

Setelah itu:

```text
MIXING COMPLETE
      ↓
READY
```

---

# 10. Dosing Queue dan Serial Execution

## 10.1 Aturan definitif

**Dosing HARUS SERIAL.**

Tidak ada dua dosing operation dari central dosing system yang melayani mixing secara bersamaan.

Aturan ini berarti:

```text
DP-A → selesai
   ↓
DP-B → selesai
   ↓
DP-N → selesai
```

Jika hanya A dan B yang dipakai:

```text
DP-A → selesai
   ↓
DP-B → selesai
```

## 10.2 Active Mixing Ownership

Pada saat sebuah batch mixing aktif:

- dosing pump yang digunakan untuk batch aktif menjadi milik batch tersebut selama operation dosing;
- DP-A–DP-N tidak boleh secara bersamaan melayani mixing batch lain;
- tidak ada shared dosing resource execution antar-mixing pada waktu yang sama.

Dengan keputusan ini, tidak ada lagi konsep:

```text
GH-A memakai DP-A
GH-B memakai DP-B
→ berjalan bersamaan
```

Untuk central dosing, model yang dipakai adalah **serial**.

## 10.3 Queue

Queue tetap berada pada scope **Complex**, tetapi queue hanya digunakan untuk mengatur urutan batch/operation yang menunggu eksekusi dosing.

Contoh:

```text
BATCH-GH-A → QUEUED
BATCH-GH-B → QUEUED
BATCH-GH-C → QUEUED
```

Execution:

```text
BATCH-GH-A DOSING
        ↓ complete
BATCH-GH-B DOSING
        ↓ complete
BATCH-GH-C DOSING
```

Tidak ada overlapping central dosing execution.

## 10.4 Mixing Preparation

Satu GH hanya memiliki satu active mixing batch pada satu waktu.

Batch berikutnya dapat dipersiapkan setelah fertigation batch sebelumnya selesai sesuai scheduling model, tetapi ketika masuk fase central dosing, hanya satu batch yang boleh menggunakan central dosing sequence pada satu waktu.

## 10.5 Important Distinction

Serial berlaku untuk **central dosing execution**.

Serial tidak berarti seluruh operation Complex harus berhenti.

Contoh yang valid:

```text
GH-A FERTIGATION  ────────────────

GH-B MIXING raw water ────────────
           waiting threshold

GH-C idle
```

Namun saat GH-B memasuki dosing central:

```text
GH-B DOSING A → B → N
```

tidak ada GH lain yang melakukan central dosing sampai sequence tersebut selesai.

---

# 11. Mixing Runtime State

State minimum yang digunakan:

```text
IDLE
QUEUED
MIXING_RAW_WATER
DOSING
READY
COMPLETED
FAILED
CANCELLED
EMERGENCY_STOP
```

### `QUEUED`

Batch sudah dibuat dan menunggu giliran untuk central dosing sequence atau resource execution yang diperlukan.

### `MIXING_RAW_WATER`

Raw water sedang diisi sampai threshold/target sesuai fase.

### `DOSING`

Central dosing sequence berjalan serial.

### `READY`

Batch sudah lengkap dan menunggu waktu distribution.

---

# 12. Fertigation / Distribution Runtime Rules

## 12.1 Trigger

Fertigation distribution dipicu oleh schedule time:

```text
schedule time reached
```

Tetapi batch harus READY terlebih dahulu.

## 12.2 Jika Batch READY sebelum Schedule

Contoh:

```text
14:40 → mixing complete
14:40 → batch READY
15:00 → scheduled fertigation
```

Tank menunggu.

Pada 15:00:

```text
READY → DISTRIBUTING
```

## 12.3 Jika Schedule tiba sebelum Batch READY

Contoh:

```text
15:00 → schedule tiba
15:00 → batch belum READY
```

ESP32 harus:

1. mencatat event delay/not-ready;
2. tetap menyelesaikan batch;
3. segera melakukan distribution setelah batch READY;
4. tidak menjalankan distribution sebelum batch tersedia.

## 12.4 Stop Condition

Distribution berjalan sampai **lower-boundary / low-level sensor** pada batch tank/distribution tank ter-trigger.

Model:

```text
DISTRIBUTION PUMP START
        ↓
monitor lower-level sensor
        ↓
LOW LEVEL TRIGGERED
        ↓
DISTRIBUTION PUMP STOP
        ↓
FERTIGATION DELIVERED
```

Jangan menghentikan distribution hanya berdasarkan countdown UI.

## 12.5 Parallel Fertigation Antar-GH

Fertigation pump per GH dapat bekerja bersamaan.

Contoh:

```text
GH-A DISTRIBUTING ─────────────
GH-B DISTRIBUTING ─────────────
GH-C DISTRIBUTING ─────────────
```

Hal ini berbeda dengan central dosing yang tetap serial.

---

# 13. Pre-Dosing dan Batch Preparation

Tujuan sistem adalah menyiapkan batch sedini mungkin tanpa mengubah waktu fertigation.

Alur:

```text
FERTIGATION BATCH SEBELUMNYA COMPLETE
          ↓
buat kebutuhan batch berikutnya
          ↓
QUEUE
          ↓
MIXING RAW WATER
          ↓
THRESHOLD TERCAPAI
          ↓
DOSING SERIAL
          ↓
BATCH READY
          ↓
WAIT FOR FERTIGATION SCHEDULE
```

Saat waktu fertigation tiba:

```text
READY
  ↓
DISTRIBUTING
```

Setelah distribution complete, persiapan batch berikutnya kembali dibuat.

---

# 14. Batch Identity dan Event Correlation

Setiap runtime batch harus memiliki identifier unik:

```text
batchId
```

Batch juga harus menyimpan minimal:

```text
batchId
scheduleId
ghId
configurationVersion
createdAt
startedAt
completedAt
runtimeState
```

Semua event harus dapat ditelusuri ke batch melalui `batchId`.

---

# 15. Event Log yang Wajib Terlihat dan Disimpan

Event minimum yang wajib terlihat di UI dan disimpan pada jalur persistence:

```text
MIXING_QUEUED
MIXING_CREATED
FERTIGATION_START
FERTIGATION_DELIVERED
BATCH_FAILED
BATCH_CANCELLED
EMERGENCY_STOP
```

### 15.1 `MIXING_QUEUED`

Batch telah masuk waiting/queue stage untuk proses mixing/dosing.

### 15.2 `MIXING_CREATED`

Batch mixing telah dibuat oleh scheduler/runtime.

### 15.3 `FERTIGATION_START`

Distribution pump memulai penyaluran batch.

### 15.4 `FERTIGATION_DELIVERED`

Distribution berhenti berdasarkan lower-boundary sensor dan batch dianggap delivered.

### 15.5 `BATCH_FAILED`

Batch gagal dan tidak dapat melanjutkan normal flow.

### 15.6 `BATCH_CANCELLED`

Batch dibatalkan secara eksplisit oleh control flow yang valid.

### 15.7 `EMERGENCY_STOP`

Emergency stop terpicu.

---

# 16. Event Log Transport dan Persistence

## 16.1 Runtime path

```text
ESP32
  ↓
UI
  ↓
Python
  ↓
save + analysis
```

UI harus menampilkan event yang diterima dari ESP32 tanpa mengubah makna event tersebut.

Python menerima event untuk:

- save;
- analysis;
- history;
- reporting.

## 16.2 Scheduled Delivery / Missed Log

Jadwal/event tidak boleh hilang ketika Python tidak tersambung.

Jika ada schedule atau event yang terlewat karena Python belum terhubung:

```text
ESP32 menyimpan event
      ↓
Python kembali connect
      ↓
ESP32 → UI → Python
      ↓
Python save + analysis
```

Pengiriman backlog dilakukan sesaat setelah koneksi Python tersedia.

## 16.3 Manual Sync dari UI

User dapat menekan tombol manual pada UI untuk meminta sinkronisasi backlog/event.

Model:

```text
USER HIT SYNC
      ↓
UI request data ESP32
      ↓
UI → Python
      ↓
Python save + analysis
```

---

# 17. Event Acknowledgement dan Deletion

ESP32 menyimpan event/log yang belum dipastikan diterima oleh jalur persistence.

Setelah event berhasil diteruskan:

```text
ESP32 → UI → Python
```

dan Python telah memberikan status penerimaan/persistence sesuai contract final, ESP32 **dapat menghapus event yang sudah terkirim dan acknowledged**.

### Aturan penting

Jika event masih berada dalam status belum selesai/ongoing, batch log terkait **jangan dihapus lebih dahulu**.

Contoh:

```text
MIXING_QUEUED
MIXING_CREATED
DOSING...
```

Jika batch masih ongoing, record/log batch tersebut harus dipertahankan.

Ketika batch selesai:

```text
FERTIGATION_DELIVERED
```

atau terminal event:

```text
BATCH_FAILED
BATCH_CANCELLED
EMERGENCY_STOP
```

barulah lifecycle retention dapat dilanjutkan sesuai acknowledgement/persistence policy.

> Detail acknowledgement protocol UI → Python dan exact deletion acknowledgement belum dibekukan dan masuk **TO BE CONTINUED**.

---

# 18. Missed Schedule Rules

## 18.1 ESP32 tetap sebagai scheduler

Schedule dijalankan oleh ESP32 berdasarkan konfigurasi terakhir yang valid.

UI/Python bukan timer fisik utama.

## 18.2 Jika Python offline

ESP32 tetap:

- menjalankan schedule;
- membuat batch;
- menjalankan mixing;
- menjalankan fertigation;
- membuat event log.

Data kemudian dikirim ketika koneksi kembali.

## 18.3 Jika Python kembali connect

Backlog yang sudah tersimpan di ESP32 harus dikirim melalui:

```text
ESP32 → UI → Python
```

sesegera mungkin setelah koneksi tersedia.

## 18.4 Jika schedule terlewat

Schedule/event yang belum berhasil dikirim ke Python tidak dianggap hilang.

ESP32 mempertahankan log sampai delivery/acknowledgement selesai.

---

# 19. Calibration Specification

## 19.1 Tujuan

Calibration digunakan agar ESP32 dapat mengubah target volume mL menjadi runtime ON pump yang sesuai.

Contoh:

```text
target = 20 mL
```

ESP32 tidak hardcode runtime.

ESP32 mengambil coefficient dari calibration terakhir.

## 19.2 Prinsip Calibration

Calibration dilakukan dengan cara menyalakan pump selama durasi yang dipilih, kemudian mengukur volume output aktual.

Durasi test yang diperbolehkan pada UI:

```text
10 detik
20 detik
39 detik
```

UI harus menyediakan pilihan durasi tersebut atau struktur input yang ekuivalen.

## 19.3 Prosedur Calibration

Contoh calibration A selama 20 detik:

```text
1. Pastikan pump dan jalur aman.
2. Tempatkan wadah ukur pada output.
3. Pastikan wadah awal dalam kondisi terukur/empty.
4. Start calibration.
5. Pump ON selama 20 detik.
6. Pump OFF.
7. Ukur volume aktual yang keluar dalam mL.
8. Masukkan hasil volume ke UI.
9. ESP32/UI menghitung flow rate calibration.
```

Rumus dasar:

```text
ml_per_second = measuredVolumeMl / testDurationSec
```

Contoh:

```text
testDurationSec = 20
measuredVolumeMl = 100

ml_per_second = 100 / 20
               = 5 mL/s
```

Maka estimasi runtime untuk target 25 mL:

```text
runtimeSec = targetMl / mlPerSecond
           = 25 / 5
           = 5 detik
```

## 19.4 Data Calibration yang Disimpan

Minimal:

```json
{
  "channel": "A",
  "testDurationSec": 20,
  "measuredVolumeMl": 100,
  "mlPerSecond": 5,
  "calibratedAt": "2026-09-13T00:00:00+07:00"
}
```

Recommended metadata:

```text
pumpId
channel
operator/reference
measurementCount
source container / measurement method
validFrom
supersedesCalibrationId
```

## 19.5 Calibration A/B/N

Setiap dosing channel harus dikalibrasi secara independen.

Contoh:

```text
A → calibration A
B → calibration B
N → calibration N
```

Tidak boleh memakai coefficient A untuk pump B.

## 19.6 Raw Filter Calibration

Jika raw filter menggunakan pump yang menyalurkan volume terukur dalam mL, raw filter mengikuti pola calibration yang sama:

```text
pump ON selama testDurationSec
→ ukur volume
→ hitung mL/s
→ gunakan coefficient untuk target mL
```

## 19.7 Multiple Calibration Runs

Calibration dapat dilakukan lebih dari sekali. Setiap hasil calibration yang valid menjadi kandidat calibration terbaru untuk component tersebut.

Contoh:

```text
Run 1 → 100 mL / 20 s = 5.00 mL/s
Run 2 → 102 mL / 20 s = 5.10 mL/s
Run 3 →  98 mL / 20 s = 4.90 mL/s
```

Untuk runtime batch, yang digunakan adalah **satu calibration terakhir yang valid** pada saat batch dibuat. Tidak ada averaging/outlier correction otomatis di dalam batch.

## 19.8 Calibration Persistence dan Warning Age

Calibration terakhir tetap digunakan sebagai calibration aktif sampai ada calibration baru yang valid. Tidak ada expiry otomatis yang membuat batch gagal hanya karena umur calibration.

Namun UI wajib memberikan warning berdasarkan umur calibration:

| Umur calibration terakhir | UI status | Makna |
|---|---|---|
| < 7 hari | normal | Calibration masih digunakan tanpa warning |
| >= 7 hari dan < 10 hari | **WARNING KUNING** | Calibration sudah 1 minggu dan disarankan melakukan calibration ulang |
| >= 10 hari | **WARNING ORANGE** | Calibration sudah 10 hari; user harus mendapat peringatan lebih kuat |

Warning tersebut **tidak mengubah coefficient secara otomatis** dan **tidak menggagalkan batch**. Batch tetap menggunakan calibration terakhir yang valid, sesuai aturan snapshot batch.

### Perhitungan umur

UI/ESP32 menghitung umur dari:

```text
currentTime - calibratedAt
```

Batas warning harus menggunakan timestamp aktual, bukan jumlah batch.

## 19.9 Calibration Safety

Calibration harus dapat dibatalkan sebelum/during execution.

Calibration tidak boleh berjalan jika kondisi safety/interlock yang relevan tidak terpenuhi.

## 19.10 Unit Rule

UI memasukkan:

```text
measuredVolumeMl
```

ESP32 menyimpan coefficient sebagai basis runtime.

UI tidak perlu mengetahui durasi runtime fisik untuk menjalankan dosing normal.

---

# 20. Configuration vs Runtime State

Configuration menjawab:

> Apa yang seharusnya dilakukan?

Runtime menjawab:

> Apa yang sedang dilakukan ESP32 sekarang?

Contoh configuration:

```json
{
  "time": "15:00",
  "rawWaterMl": 20000,
  "dosing": {
    "A": 20,
    "B": 20,
    "N": 20
  }
}
```

Contoh runtime:

```json
{
  "batchId": "batch-20260913-0001",
  "runtimeState": "DOSING",
  "activeChannel": "B",
  "rawWaterActualMl": 15420,
  "rawWaterTargetMl": 20000
}
```

UI harus menampilkan runtime state dari ESP32, bukan menciptakan physical state sendiri.

Audit repository juga menegaskan queue dan actuator state seharusnya berasal dari ESP32 runtime, sedangkan UI saat ini masih memiliki mock/simulation paths. fileciteturn5file2L143-L150

---

# 21. Resource Rules

## 21.1 Central Dosing

Central dosing adalah resource execution **serial**.

```text
ONE ACTIVE CENTRAL DOSING SEQUENCE AT A TIME
```

Tidak ada simultaneous central dosing untuk batch berbeda.

## 21.2 GH Fertigation Pumps

GH fertigation pumps merupakan resource per-GH.

```text
GH-A pump
GH-B pump
GH-C pump
```

dapat bekerja bersamaan sesuai safety dan hardware availability.

## 21.3 Raw Water

Raw-water supply operation dapat berlangsung independen dari fertigation operation.

Dalam batch mixing, raw water tetap menjadi bagian batch yang sama dengan dosing.

---

# 22. Hardware Optionality

## 22.1 GH tanpa Routing Valve

Jika Complex hanya mempunyai 1 GH atau topology tidak membutuhkan routing valve tertentu, valve tidak boleh dipaksakan menjadi komponen wajib secara software.

ESP32 harus membaca inventory/configuration.

Jika valve tersebut benar-benar tidak ada:

```text
skip valve action
```

hanya apabila topology fisik tetap valid dan aman tanpa valve tersebut.

## 22.2 Safety

Absence of valve tidak boleh digunakan untuk melewati physical safety requirement yang memang membutuhkan isolation valve.

---

# 23. Runtime State Diagram

## 23.1 Mixing

```text
IDLE
  ↓
MIXING_CREATED
  ↓
MIXING_RAW_WATER
  ↓
threshold reached
  ↓
QUEUED / DOSING WAIT
  ↓
DOSING
  ├── A
  ├── B
  └── N/C
  ↓
BATCH COMPLETE
  ↓
READY
```

Failure path:

```text
any active state
      ↓
BATCH_FAILED
```

Cancel path:

```text
any cancellable state
      ↓
BATCH_CANCELLED
```

Emergency path:

```text
any active state
      ↓
EMERGENCY_STOP
```

## 23.2 Fertigation

```text
READY
  ↓
scheduled time reached
  ↓
FERTIGATION_START
  ↓
DISTRIBUTING
  ↓
lower-level sensor triggered
  ↓
FERTIGATION_DELIVERED
```

---

# 24. UI Schedule Lifecycle

UI harus menggunakan pola:

```text
READ full Complex schedules
       ↓
local modify
       ↓
validate local structure
       ↓
submit full snapshot
       ↓
ESP32 validate
       ↓
ACK / REJECT
       ↓
refresh authoritative configuration
```

Untuk delete GH:

```text
READ ALL SCHEDULES
       ↓
remove all schedules for GH-X
       ↓
submit COMPLETE UPDATED SNAPSHOT
```

Tidak boleh hanya mengirim:

```json
{
  "deleteScheduleId": "fert-x-001"
}
```

sebagai source of truth configuration utama.

---

# 25. Event Payload Minimum

Contoh generic event:

```json
{
  "eventId": "evt-001",
  "eventType": "MIXING_CREATED",
  "batchId": "batch-20260913-0001",
  "scheduleId": "fert-001",
  "complexId": "complex-001",
  "ghId": "gh-a",
  "configurationVersion": 17,
  "timestamp": "2026-09-13T15:00:00+07:00",
  "runtimeState": "MIXING_RAW_WATER"
}
```

Failure example:

```json
{
  "eventId": "evt-009",
  "eventType": "BATCH_FAILED",
  "batchId": "batch-20260913-0001",
  "scheduleId": "fert-001",
  "ghId": "gh-a",
  "reasonCode": "FLOW_TIMEOUT",
  "timestamp": "2026-09-13T15:07:20+07:00"
}
```

Exact event schema/error-code catalog belum dibekukan.

---

# 26. Current Endpoint Status

Repository saat ini memiliki generic configuration endpoint pada direct ESP32 client:

```text
GET /api/v1/configuration
POST /api/v1/configuration/validate
PUT /api/v1/configuration
```

Repository tidak menunjukkan tiga endpoint schedule terpisah khusus:

```text
/well-pump-schedule
/mixing-schedule
/fertigation-schedule
```

Jadi secara transport saat ini, ketiga scheduling domain dapat berada dalam `schedules[]` pada generic configuration endpoint.

Audit repository juga menunjukkan current direct ESP32 client mencakup configuration, validate, telemetry, events, command status, clock sync, dan emergency stop, tetapi keberadaan client path bukan bukti server endpoint sudah deployed/correct. fileciteturn5file1L94-L110

---

# 27. Communication Flow

## 27.1 Schedule

```text
UI
 ↓
ESP32
 ↓
UI
 ↓
Python
```

Tujuannya:

- ESP32 menerima konfigurasi runtime;
- UI menampilkan result/state;
- Python menyimpan + menganalisis.

## 27.2 Event Log

```text
ESP32
 ↓
UI
 ↓
Python
 ↓
save + analysis
```

## 27.3 Backlog setelah reconnect

```text
ESP32 stores unsent log
         ↓
connection available
         ↓
ESP32 → UI → Python
         ↓
Python persisted/analysed
         ↓
acknowledgement
         ↓
ESP32 may delete acknowledged terminal/complete data
```

Event ongoing tidak boleh dihapus hanya karena sudah satu kali dibaca UI.

---

# 28. Example — Full Mixing Timeline

Misal:

```text
GH = gh-a
Schedule = 15:00
Raw water target = 20.000 mL
Threshold = 20%
A = 20 mL
B = 20 mL
N = 20 mL
```

Timeline:

```text
14:20  batch created
14:20  MIXING_CREATED
14:20  raw water START
14:20–14:22  raw water fills
14:22  actual raw water >= 4.000 mL
14:22  dosing sequence queued/starts
14:22  DP-A ON
14:22+x DP-A OFF / A complete
14:22+x DP-B ON
14:22+x DP-B OFF / B complete
14:22+x DP-N ON
14:22+x DP-N OFF / N complete
14:23+ raw water continues until 20.000 mL
14:24  all batch targets complete
14:24  BATCH READY
14:24–15:00 WAITING
15:00  FERTIGATION_START
15:00  distribution pump START
15:xx  lower-level sensor triggered
15:xx  distribution pump STOP
15:xx  FERTIGATION_DELIVERED
```

Dosing order harus tetap serial walaupun raw water terus berjalan selama sequence tersebut.

---

# 29. Example — Well Pump Scheduled

```json
{
  "id": "wp-001",
  "type": "well_pump",
  "enabled": true,
  "time": "06:00",
  "to-time": "06:01"
}
```

Interpretasi:

```text
06:00 START
06:01 STOP
```

Tidak ada instruction:

```text
06:00 START
→ continue until full
```

Stop schedule ditentukan eksplisit oleh `to-time`.

---

# 30. Example — Well Pump Manual

```text
10:00 USER MANUAL ON
10:00 pump ON
10:07 USER STOP
10:07 pump OFF
```

atau:

```text
10:00 USER MANUAL ON
10:15 automatic maximum duration reached
10:15 pump OFF
```

Manual action tidak mengubah schedule otomatis.

---

# 31. Example — Delete GH and Rebuild Snapshot

Initial:

```json
{
  "complexId": "complex-001",
  "configurationVersion": 17,
  "schedules": [
    {"id":"wp-001","type":"well_pump","time":"06:00","to-time":"06:01"},
    {"id":"fert-a-001","type":"fertigation","ghId":"gh-a","time":"15:00"},
    {"id":"fert-x-001","type":"fertigation","ghId":"gh-x","time":"12:00"},
    {"id":"fert-x-002","type":"fertigation","ghId":"gh-x","time":"18:00"}
  ]
}
```

Delete `gh-x` di UI:

```text
read all schedule
→ remove fert-x-001
→ remove fert-x-002
→ retain wp-001
→ retain fert-a-001
→ submit complete schedules[]
```

Result:

```json
{
  "complexId": "complex-001",
  "configurationVersion": 18,
  "schedules": [
    {"id":"wp-001","type":"well_pump","time":"06:00","to-time":"06:01"},
    {"id":"fert-a-001","type":"fertigation","ghId":"gh-a","time":"15:00"}
  ]
}
```

---

# 32. Failure and Cancellation Rules

## 32.1 BATCH_FAILED

Gunakan ketika batch tidak dapat mencapai normal terminal state.

Contoh penyebab yang dapat didefinisikan kemudian:

```text
FLOW_TIMEOUT
PUMP_FAULT
DOSING_TIMEOUT
SENSOR_FAULT
CONFIG_INVALID
RESOURCE_FAULT
```

Daftar error code final belum dibekukan.

## 32.2 BATCH_CANCELLED

Digunakan jika batch dibatalkan oleh command/control flow yang valid.

## 32.3 EMERGENCY_STOP

Emergency stop mempunyai prioritas atas normal runtime.

```text
NORMAL RUN
   ↓
EMERGENCY_STOP
   ↓
actuator stop sesuai safety policy
```

Event harus dicatat dan dipertahankan untuk audit/persistence.

---

# 33. Acceptance Criteria — Well Pump

### AC-WP-01
Schedule mempunyai `time` START dan `to-time` STOP.

### AC-WP-02
Pompa tidak berjalan tanpa batas karena schedule.

### AC-WP-03
Manual ON tersedia melalui controller fisik.

### AC-WP-04
Manual ON tersedia melalui web app.

### AC-WP-05
Manual ON maksimum 15 menit.

### AC-WP-06
Manual STOP melalui web app harus mematikan command runtime.

### AC-WP-07
Toggle fisik STOP harus dapat mematikan operasi manual.

### AC-WP-08
Radar 220V menjadi physical cutoff terpisah dari ESP32.

---

# 34. Acceptance Criteria — Batch Mixing

### AC-MIX-01
Raw water selalu menjadi operasi pertama dalam batch.

### AC-MIX-02
Dosing tidak boleh start sebelum actual raw water mencapai threshold configured.

### AC-MIX-03
Threshold 20% bukan konstanta firmware dan dapat diubah di UI.

### AC-MIX-04
Threshold ditentukan dari actual flow-meter volume.

### AC-MIX-05
Raw water tetap menjadi bagian batch setelah dosing dimulai.

### AC-MIX-06
Dosing central harus serial.

### AC-MIX-07
Tidak ada central dosing execution simultan antar-batch.

### AC-MIX-08
Mixing complete hanya jika seluruh required volume selesai.

### AC-MIX-09
Batch complete menghasilkan `READY`.

### AC-MIX-10
Batch READY menunggu schedule fertigation.

---

# 35. Acceptance Criteria — Fertigation

### AC-FERT-01
Fertigation merupakan runtime operation terpisah dari mixing.

### AC-FERT-02
Batch READY dapat menunggu schedule.

### AC-FERT-03
Jika schedule tiba sebelum READY, event delay dicatat.

### AC-FERT-04
Distribution dimulai segera setelah batch ready ketika scheduled execution sudah due.

### AC-FERT-05
Distribution berhenti karena lower-boundary sensor.

### AC-FERT-06
Fertigation pump GH berbeda boleh berjalan bersamaan.

### AC-FERT-07
UI tidak menggunakan local countdown sebagai source of physical truth.

---

# 36. Acceptance Criteria — Calibration

### AC-CAL-01
Calibration menerima durasi test dalam detik.

### AC-CAL-02
Pilihan minimum yang didukung: 10, 20, atau 39 detik.

### AC-CAL-03
Actual output volume dicatat dalam mL.

### AC-CAL-04
ESP32 menghitung basis mL/s dari calibration.

### AC-CAL-05
Setiap dosing channel memiliki calibration sendiri.

### AC-CAL-06
Raw filter yang memakai volumetric pump juga memiliki calibration sendiri.

### AC-CAL-07
Calibration baru memiliki timestamp/version.

### AC-CAL-08
Coefficient terbaru yang valid menjadi coefficient aktif.

### AC-CAL-09
Setiap batch wajib menyimpan calibration snapshot untuk seluruh dosing component yang digunakan.

### AC-CAL-10
Batch tidak boleh dibuat/started jika calibration yang dibutuhkan tidak tersedia.

### AC-CAL-11
UI memiliki hardcoded mandatory calibration guard dan alert yang eksplisit sebelum batch dikirim.

### AC-CAL-12
ESP32 melakukan validasi calibration secara independen sebelum actuator dosing dijalankan.

### AC-CAL-13
Batch menggunakan calibration snapshot yang immutable selama lifecycle batch.

### AC-CAL-14
Calibration terakhir tetap digunakan sampai calibration baru yang valid tersedia.

### AC-CAL-15
UI memberikan WARNING KUNING mulai umur calibration 7 hari.

### AC-CAL-16
UI memberikan WARNING ORANGE mulai umur calibration 10 hari.

### AC-CAL-17
Warning umur calibration tidak otomatis menggagalkan batch.

### AC-CAL-18
UI tidak menghitung runtime actuator untuk normal dosing; ESP32 menghitung runtime berdasarkan calibration snapshot batch.

---

# 37. Acceptance Criteria — Event and Persistence

### AC-EVT-01
UI menampilkan `MIXING_QUEUED`.

### AC-EVT-02
UI menampilkan `MIXING_CREATED`.

### AC-EVT-03
UI menampilkan `FERTIGATION_START`.

### AC-EVT-04
UI menampilkan `FERTIGATION_DELIVERED`.

### AC-EVT-05
UI menampilkan `BATCH_FAILED`.

### AC-EVT-06
UI menampilkan `BATCH_CANCELLED`.

### AC-EVT-07
UI menampilkan `EMERGENCY_STOP`.

### AC-EVT-08
Event diteruskan dari ESP32 → UI → Python.

### AC-EVT-09
Python menyimpan dan menganalisis event.

### AC-EVT-10
Backlog dikirim setelah Python reconnect.

### AC-EVT-11
Manual sync dari UI dapat meminta backlog/event transfer.

### AC-EVT-12
Event ongoing tidak dihapus sebelum batch selesai/terminal.

### AC-EVT-13
ESP32 dapat menghapus event yang sudah acknowledged sesuai final retention contract.

---

# 38. Acceptance Criteria — Configuration

### AC-CFG-01
Semua create/edit/delete/enable/disable schedule menggunakan full snapshot.

### AC-CFG-02
ESP32 validate full snapshot sebelum apply.

### AC-CFG-03
Configuration apply bersifat atomic.

### AC-CFG-04
Invalid snapshot tidak mengganti last valid configuration.

### AC-CFG-05
Delete GH menghapus seluruh schedule yang terkait GH tersebut.

### AC-CFG-06
`to-time` digunakan sebagai STOP time untuk well pump schedule.

### AC-CFG-07
Threshold mixing dapat diatur dari UI.

---

# 39. Rules yang Tidak Boleh Disalahartikan

```text
1. Raw water + dosing = SATU BATCH.

2. Raw water adalah operasi pertama dalam batch.

3. Dosing baru boleh mulai ketika actual raw water >= configured threshold.

4. Threshold default saat ini 20%, tetapi NILAI INI HARUS CONFIGURABLE DI UI.

5. Dosing central = SERIAL.

6. Tidak ada central dosing simultan untuk batch berbeda.

7. Fertigation pump per GH = BOLEH PARALLEL.

8. Well pump schedule memiliki START dan STOP (`time` + `to-time`).

9. Well pump manual = fisik + web app, maksimum ON 15 menit.

10. Radar 220V melakukan physical cutoff; radar tidak harus melewati ESP32.

11. Input volume UI = mL.

12. ESP32 mengubah mL menjadi runtime ON berdasarkan calibration.

13. Calibration menggunakan test ON 10/20/39 detik atau durasi yang tersedia di UI.

14. Flow meter adalah sumber actual raw-water volume.

15. Mixing COMPLETE hanya setelah raw water + seluruh dosing required selesai.

16. READY menunggu waktu fertigation.

17. Distribution berhenti pada lower-boundary sensor.

18. Schedule diubah melalui FULL SNAPSHOT.

19. Delete GH = baca semua schedule → hapus semua schedule GH tersebut di UI → kirim full snapshot baru ke ESP32.

20. Event path = ESP32 → UI → Python.

21. Missed/backlog event dikirim setelah Python connect kembali dan/atau saat user menekan sync di UI.

22. Event ongoing tidak boleh dihapus sebelum batch terminal.

23. Event yang sudah dipersist + acknowledged dapat dihapus dari ESP32 sesuai retention/ack contract final.
```

---

# 40. TO BE CONTINUED — UI → Python

Bagian berikut masih harus diformalisasi pada dokumen komunikasi berikutnya:

- endpoint/UI gateway untuk forward schedule ke Python;
- endpoint/UI gateway untuk forward event;
- format ACK Python terhadap event yang sudah persisted;
- mekanisme deduplication event;
- batch log aggregation;
- retry dan idempotency;
- exact authentication direct UI → ESP32;
- exact Python → ESP32 path bila digunakan untuk reconciliation;
- conflict handling configuration version;
- offline/reconnect acknowledgement protocol.

Audit repository sendiri telah mengidentifikasi kebutuhan configuration version, command IDs, idempotency, reconciliation, telemetry, dan offline/recovery semantics sebagai hal yang perlu diformalisasi sebelum implementation contract final. fileciteturn5file5L202-L221

---

# 41. Status Implementasi Saat Ini

Dokumen ini adalah **operational specification** dan bukan bukti bahwa semua behavior sudah ada di codebase.

Repository audit menyatakan:

- active UI masih banyak memakai local/mock state;
- API client yang ada belum berarti server endpoint sudah tersedia;
- current UI service graph belum melakukan physical HTTP communication pada jalur aktif;
- runtime telemetry/progress saat ini masih simulated;
- queue/schedule semantics masih perlu digantikan dengan runtime truth dari device.

Hal tersebut harus diperlakukan sebagai kondisi codebase saat ini, sedangkan aturan pada Section 3–39 adalah target behavior yang harus diimplementasikan.

Audit current endpoint inventory menunjukkan direct ESP32 client telah memiliki configuration, validate, telemetry, events, command status, clock-sync, dan emergency-stop paths, tetapi belum terdapat endpoint schedule terpisah berdasarkan tiga domain yang didefinisikan di sini. fileciteturn5file1L94-L110

---

# 42. Reference Repository

Dokumen ini menggunakan audit repository `CODEBASE_COMMUNICATION_AUDIT(1).md` sebagai baseline kondisi codebase, terutama untuk:

- current API inventory; fileciteturn5file1L76-L110
- mock/local runtime limitation; fileciteturn5file1L113-L130
- ESP32 runtime/event responsibility; fileciteturn5file5L482-L498
- Python persistence/control-plane proposal; fileciteturn5file2L182-L200
- command/version/idempotency requirements for future contract. fileciteturn5file5L202-L221

---

# 43. Final Operational Summary

```text
                           COMPLEX
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
             WELL_PUMP      MIXING      FERTIGATION
                 │            │            │
                 │            │            │
          SUMUR → RAW TANK    │       GH TANK → PLANTS
                 │            │            │
                 │       1 BATCH            │
                 │       RAW WATER +        │
                 │       DOSING A-N          │
                 │            │              │
                 │       RAW WATER START    │
                 │            │              │
                 │       threshold >=       │
                 │       configured %       │
                 │            │              │
                 │       DOSING SERIAL       │
                 │       A → B → N           │
                 │            │              │
                 │       BATCH READY ────────┤
                 │                           │
                 │                      FERTIGATION
                 │                      START
                 │                           │
                 │                  LOW-LEVEL TRIGGER
                 │                           │
                 └───────────────────────────┘
                              │
                              ▼
                             ESP32
                              │
                   runtime + event + telemetry
                              │
                              ▼
                              UI
                              │
                              ▼
                           Python
                       save + analysis
```

**Core rule:** raw water and dosing adalah satu batch. Raw water selalu mulai terlebih dahulu. Setelah actual raw-water volume mencapai threshold yang dapat diatur dari UI, dosing dilakukan **secara serial** sampai seluruh batch complete. Setelah batch READY dan waktu schedule tiba, fertigation pump GH menyalurkan batch sampai lower-boundary sensor ter-trigger. Fertigation antar-GH dapat berjalan bersamaan; central dosing tidak.

# 23. Hardware Inventory Configuration

## 23.1 Tujuan

ESP32 harus memiliki daftar komponen hardware yang menggambarkan hardware fisik yang benar-benar dipasang pada Complex tersebut.

Daftar ini **bukan dibuat otomatis oleh UI** pada tahap instalasi awal. User memasang hardware secara manual kemudian memasukkan mapping hardware tersebut ke JSON inventory ESP32 secara manual/hardcode.

Inventory ini menjadi dasar bagi ESP32 untuk mengetahui:

- Complex yang dikendalikan;
- GH yang tersedia;
- dosing pump yang tersedia;
- dosing valve yang tersedia;
- raw-water pump;
- raw-water flow meter;
- mixing/batch tank;
- fertigation/distribution pump setiap GH;
- valve setiap GH bila memang terpasang;
- sensor yang tersedia;
- channel GPIO/device address yang digunakan hardware.

## 23.2 Prinsip Inventory

Inventory menggambarkan **hardware fisik**, sedangkan `schedules[]` menggambarkan **apa yang harus dilakukan hardware tersebut**.

```text
HARDWARE INVENTORY
        ↓
validasi topology
        ↓
SCHEDULE CONFIGURATION
        ↓
ESP32 RUNTIME
```

Schedule tidak boleh menunjuk ke hardware yang tidak ada dalam inventory.

## 23.3 Proposal Struktur JSON Inventory

Struktur awal yang diusulkan:

```json
{
  "complex": {
    "id": "complex-a",
    "name": "Complex A",
    "controller": {
      "type": "esp32",
      "deviceId": "esp32-complex-a"
    },
    "components": {
      "wellPump": {
        "id": "wp-001",
        "type": "well_pump"
      },
      "rawWaterFlowMeter": {
        "id": "flow-raw-001",
        "type": "flow_meter"
      },
      "dosing": {
        "A": {
          "pump": {
            "id": "dp-a-001",
            "type": "dosing_pump",
            "channel": "A"
          },
          "valve": {
            "id": "dv-a-001",
            "type": "dosing_valve",
            "channel": "A"
          }
        },
        "B": {
          "pump": {
            "id": "dp-b-001",
            "type": "dosing_pump",
            "channel": "B"
          },
          "valve": {
            "id": "dv-b-001",
            "type": "dosing_valve",
            "channel": "B"
          }
        },
        "N": {
          "pump": {
            "id": "dp-n-001",
            "type": "dosing_pump",
            "channel": "N"
          },
          "valve": {
            "id": "dv-n-001",
            "type": "dosing_valve",
            "channel": "N"
          }
        }
      }
    }
  },
  "greenhouses": {
    "gh-a": {
      "id": "gh-a",
      "components": {
        "mixingTank": {
          "id": "tank-mix-a-001",
          "type": "mixing_tank"
        },
        "fertigationPump": {
          "id": "fp-a-001",
          "type": "fertigation_pump"
        },
        "valve": {
          "id": "gv-a-001",
          "type": "gh_valve"
        },
        "lowerLevelSensor": {
          "id": "level-low-a-001",
          "type": "level_sensor"
        }
      }
    },
    "gh-b": {
      "id": "gh-b",
      "components": {}
    }
  }
}
```

### 23.3.1 Dosing Channel

Channel dosing dapat berupa:

```text
A
B
N
```

atau channel lain yang ditetapkan inventory final.

Nama channel harus konsisten antara:

- inventory;
- schedule;
- calibration;
- runtime;
- telemetry;
- event log.

## 23.4 Hardware Inventory adalah Static Device Data

Inventory hardware dipasang/hardcode pada ESP32.

Contoh alur instalasi:

```text
User memasang hardware fisik
        ↓
User menentukan mapping GPIO/channel/device
        ↓
User memasukkan inventory JSON ke firmware/config ESP32
        ↓
ESP32 boot
        ↓
ESP32 menyediakan GET /api/v1/inventory
```

ESP32 tidak boleh mengklaim hardware ada hanya karena UI membuat object component.

## 23.5 Sinkronisasi Inventory ke UI

Pada menu **Configuration** di UI, user dapat menjalankan:

```text
SYNC UI ↔ ESP32
```

UI meminta inventory dari ESP32 dan menyimpannya di browser state.

Model:

```text
UI Configuration
      ↓
GET inventory ESP32
      ↓
ESP32 → inventory JSON
      ↓
UI browser state
```

Browser state menjadi cache/configuration context UI untuk operasi berikutnya.

## 23.6 First Load / Inventory Tidak Ditemukan

Jika UI tidak menemukan inventory hardware pada browser state:

```text
browser state
   ↓
NO HARDWARE INVENTORY
   ↓
automatic GET /api/v1/inventory
   ↓
ESP32 returns inventory
   ↓
UI saves inventory to browser state
   ↓
UI uses inventory for subsequent configuration
```

Dengan demikian user tidak harus memasukkan ulang hardware inventory secara manual di UI setiap membuka halaman.

## 23.7 Browser State

Minimal UI menyimpan:

```text
complexId
esp32DeviceId
hardwareInventory
lastInventorySyncAt
appliedConfigurationVersion
lastConfigurationSnapshot
lastCalibrationSnapshot
```

Browser state adalah cache/persistence UI, **bukan pengganti source of truth ESP32**.

Jika terjadi perbedaan:

```text
ESP32 authoritative physical state
```

UI harus melakukan reconciliation.

---

# 24. Configuration Synchronization

## 24.1 User-Initiated Sync

Dari menu Configuration:

```text
USER CLICK SYNC
      ↓
GET inventory
      ↓
GET configuration
      ↓
GET calibration/status jika diperlukan
      ↓
UI update browser state
```

Tujuannya agar UI mengetahui:

- hardware apa yang benar-benar ada;
- configuration version yang diterapkan ESP32;
- schedule aktif;
- calibration aktif;
- runtime mapping.

## 24.2 Full Configuration Sync

Saat user menyimpan perubahan schedule:

```text
UI browser state
      ↓
modify
      ↓
bentuk full configuration snapshot
      ↓
POST /api/v1/configuration/validate
      ↓
valid?
  ├─ NO → UI tampilkan error, ESP32 tidak berubah
  └─ YES
       ↓
PUT /api/v1/configuration
       ↓
ESP32 atomic apply
       ↓
UI refresh GET /api/v1/configuration
```

---

# 25. Scheduling & Mechanical Control API Endpoints

## 25.1 Current Endpoint Boundary

Repository saat ini sudah memiliki client untuk endpoint berikut:

```text
GET  /api/v1/inventory
GET  /api/v1/configuration
POST /api/v1/configuration/validate
PUT  /api/v1/configuration
GET  /api/v1/telemetry
GET  /api/v1/events
GET  /api/v1/commands/{commandId}
DELETE /api/v1/commands/{commandId}
POST /api/v1/clock-sync
POST /api/v1/commands/emergency-stop
```

Audit menegaskan bahwa keberadaan method tersebut di client belum membuktikan server endpoint sudah deployed/benar, dan active UI saat ini belum menggunakan client tersebut. fileciteturn5file1L76-L112

## 25.2 Logical Scheduling Domains vs HTTP Endpoints

`WELL_PUMP`, `MIXING`, dan `FERTIGATION` adalah **logical scheduling/runtime domains**.

Mereka tidak harus memiliki tiga HTTP endpoint configuration yang terpisah.

Configuration schedule tetap dikirim sebagai full snapshot melalui:

```text
POST /api/v1/configuration/validate
PUT  /api/v1/configuration
```

`type` di dalam `schedules[]` membedakan domain.

Contoh:

```json
{
  "type": "well_pump"
}
```

atau:

```json
{
  "type": "fertigation"
}
```

ESP32 kemudian membentuk runtime MIXING dan FERTIGATION dari fertigation schedule.

---

# 26. Endpoint: UI → ESP32

## 26.1 GET `/api/v1/inventory`

### Tujuan

Meminta daftar hardware yang benar-benar terdaftar pada ESP32.

### Request

```http
GET /api/v1/inventory
```

### Response proposal

```json
{
  "deviceId": "esp32-complex-a",
  "complexId": "complex-a",
  "inventoryVersion": 3,
  "generatedAt": "2026-09-13T00:10:00+07:00",
  "inventory": {
    "complex": {},
    "greenhouses": {}
  }
}
```

UI menyimpan response tersebut ke browser state.

---

# 27. Endpoint: GET `/api/v1/configuration`

## Tujuan

UI meminta configuration snapshot yang sedang aktif di ESP32.

### Response proposal

```json
{
  "complexId": "complex-a",
  "configurationVersion": 17,
  "appliedAt": "2026-09-12T23:00:00+07:00",
  "schedules": []
}
```

UI harus menggunakan `configurationVersion` untuk mengetahui apakah browser state masih sama dengan ESP32.

---

# 28. Endpoint: POST `/api/v1/configuration/validate`

## Tujuan

Memeriksa snapshot baru sebelum diterapkan.

### Request

```json
{
  "complexId": "complex-a",
  "baseConfigurationVersion": 17,
  "configurationVersion": 18,
  "schedules": [
    {
      "id": "wp-001",
      "type": "well_pump",
      "enabled": true,
      "time": "06:00",
      "to-time": "06:01"
    },
    {
      "id": "fert-001",
      "type": "fertigation",
      "ghId": "gh-a",
      "enabled": true,
      "time": "15:00",
      "rawWaterMl": 20000,
      "dosing": {
        "A": 20,
        "B": 20,
        "N": 20
      },
      "mixing": {
        "rawWaterStartThresholdPercent": 20
      }
    }
  ]
}
```

### Validation minimal

ESP32 harus memeriksa:

- `complexId` cocok;
- schedule type valid;
- GH yang dirujuk ada;
- hardware yang diperlukan tersedia;
- volume tidak negatif;
- threshold valid;
- `time` dan `to-time` valid untuk well pump;
- calibration tersedia untuk dosing yang digunakan;
- tidak ada configuration conflict;
- tidak ada topology violation;
- schedule tidak menghasilkan execution yang tidak mungkin dilakukan hardware.

### Response proposal — valid

```json
{
  "valid": true,
  "complexId": "complex-a",
  "baseConfigurationVersion": 17,
  "validatedConfigurationVersion": 18,
  "errors": [],
  "warnings": []
}
```

### Response proposal — invalid

```json
{
  "valid": false,
  "complexId": "complex-a",
  "errors": [
    {
      "code": "GH_NOT_FOUND",
      "path": "schedules[1].ghId",
      "message": "GH gh-x is not present in hardware/configuration inventory"
    }
  ],
  "warnings": []
}
```

---

# 29. Endpoint: PUT `/api/v1/configuration`

## Tujuan

Menerapkan full configuration snapshot ke ESP32.

### Request

Payload pada dasarnya sama dengan hasil validation.

### Behavior

```text
receive full snapshot
      ↓
validate
      ↓
check version
      ↓
atomic apply
      ↓
new configuration active
```

Jika gagal:

```text
old configuration remains active
```

ESP32 tidak boleh menerapkan setengah snapshot.

### Response proposal

```json
{
  "accepted": true,
  "complexId": "complex-a",
  "configurationVersion": 18,
  "appliedAt": "2026-09-13T00:15:00+07:00",
  "activeScheduleCount": 4
}
```

---

# 30. Endpoint: GET `/api/v1/telemetry`

## Tujuan

UI meminta keadaan fisik/runtime terbaru ESP32.

### Response minimal terkait scheduling/mechanical control

```json
{
  "deviceId": "esp32-complex-a",
  "configurationVersion": 18,
  "timestamp": "2026-09-13T00:20:00+07:00",
  "wellPump": {
    "commanded": false,
    "runtimeMode": "SCHEDULED"
  },
  "rawWater": {
    "flowMl": 0
  },
  "dosing": {
    "A": {
      "state": "IDLE"
    },
    "B": {
      "state": "IDLE"
    },
    "N": {
      "state": "IDLE"
    }
  },
  "greenhouses": {
    "gh-a": {
      "mixing": {
        "state": "READY"
      },
      "fertigation": {
        "state": "IDLE"
      },
      "fertigationPump": {
        "state": "OFF"
      },
      "lowerLevelSensor": {
        "triggered": false
      }
    }
  }
}
```

Actual field names dapat disesuaikan dengan final telemetry contract.

---

# 31. Endpoint: GET `/api/v1/events`

## Tujuan

Mengambil event log yang dihasilkan ESP32.

### Response proposal

```json
{
  "events": [
    {
      "eventId": "evt-001",
      "eventType": "MIXING_CREATED",
      "batchId": "batch-001",
      "scheduleId": "fert-001",
      "ghId": "gh-a",
      "configurationVersion": 18,
      "timestamp": "2026-09-13T14:40:00+07:00",
      "status": "OPEN"
    }
  ],
  "nextCursor": null
}
```

Event wajib minimal:

```text
MIXING_QUEUED
MIXING_CREATED
FERTIGATION_START
FERTIGATION_DELIVERED
BATCH_FAILED
BATCH_CANCELLED
EMERGENCY_STOP
```

---

# 32. Endpoint: GET `/api/v1/commands/{commandId}`

Digunakan UI untuk memeriksa status command yang membutuhkan acknowledgement/status.

Contoh response:

```json
{
  "commandId": "cmd-001",
  "status": "COMPLETED",
  "acceptedAt": "2026-09-13T15:00:00+07:00",
  "completedAt": "2026-09-13T15:04:12+07:00"
}
```

---

# 33. Endpoint: POST `/api/v1/commands/emergency-stop`

Emergency stop adalah physical runtime command, bukan schedule configuration.

### Request proposal

```json
{
  "commandId": "cmd-estop-001",
  "reason": "operator_request"
}
```

### Response proposal

```json
{
  "accepted": true,
  "commandId": "cmd-estop-001",
  "state": "EMERGENCY_STOP"
}
```

ESP32 menghasilkan event:

```text
EMERGENCY_STOP
```

---

# 34. Manual Well Pump Control Endpoint

**TO BE CONTINUED — exact endpoint contract.**

Logical command yang dibutuhkan UI:

```text
WELL_PUMP_MANUAL_START
WELL_PUMP_MANUAL_STOP
```

Payload proposal:

```json
{
  "commandId": "cmd-wp-001",
  "type": "well_pump_manual_start",
  "maxRuntimeSec": 900
}
```

ESP32 wajib membatasi manual ON maksimum 900 detik (15 menit), walaupun request mencoba memberikan nilai lebih besar.

STOP dapat dikirim secara eksplisit sebelum timeout.

---

# 35. Calibration API

## 35.1 Calibration adalah Data Hardware, bukan Schedule

Calibration tidak dimasukkan ke `schedules[]`.

Calibration merupakan configuration/runtime support data yang digunakan ESP32 untuk menerjemahkan target mL menjadi ON time.

## 35.2 GET `/api/v1/calibration`

### Response proposal

```json
{
  "calibrations": {
    "A": {
      "pumpId": "dp-a-001",
      "active": {
        "calibrationId": "cal-a-003",
        "testDurationSec": 20,
        "measuredVolumeMl": 100,
        "mlPerSecond": 5,
        "calibratedAt": "2026-09-12T10:00:00+07:00",
        "version": 3
      }
    },
    "B": {
      "pumpId": "dp-b-001",
      "active": null
    },
    "N": {
      "pumpId": "dp-n-001",
      "active": null
    }
  }
}
```

## 35.3 POST `/api/v1/calibration/start`

Request proposal:

```json
{
  "calibrationId": "cal-a-new",
  "pumpId": "dp-a-001",
  "channel": "A",
  "testDurationSec": 20
}
```

Allowed test duration:

```text
10
20
39
```

ESP32 menjalankan pump selama durasi tersebut lalu berhenti.

## 35.4 POST `/api/v1/calibration/result`

Setelah volume aktual diukur:

```json
{
  "calibrationId": "cal-a-new",
  "pumpId": "dp-a-001",
  "channel": "A",
  "testDurationSec": 20,
  "measuredVolumeMl": 100
}
```

ESP32 menghitung:

```text
mlPerSecond = measuredVolumeMl / testDurationSec
```

dan menyimpan hasil calibration baru.

## 35.5 Calibration Result Response

```json
{
  "accepted": true,
  "calibration": {
    "calibrationId": "cal-a-new",
    "channel": "A",
    "testDurationSec": 20,
    "measuredVolumeMl": 100,
    "mlPerSecond": 5,
    "calibratedAt": "2026-09-13T00:30:00+07:00",
    "version": 4,
    "active": true
  }
}
```

## 35.6 Last Calibration

UI harus menampilkan minimal:

```text
Pump/channel
Last calibration ID
Last calibration date/time
Test duration
Measured volume
Calculated mL/s
Calibration version
Active/inactive
```

Contoh:

```text
Dosing A
Last calibration: 2026-09-13 00:30
Test: 20 sec
Measured: 100 mL
Rate: 5.00 mL/s
Version: 4
Status: ACTIVE
```

## 35.7 Runtime Conversion

Jika calibration aktif:

```text
runtimeSec = targetMl / mlPerSecond
```

ESP32 kemudian menerapkan runtime actuator sesuai resolution/timing firmware.

Contoh:

```text
Target A = 20 mL
Calibration A = 5 mL/s

runtime = 20 / 5
        = 4 seconds
```

ESP32 tetap mencatat target dan actual yang dapat diukur.

---

# 36. Calibration Persistence

ESP32 harus menyimpan calibration aktif agar schedule tetap dapat berjalan tanpa koneksi UI/Python.

Minimal yang harus survive reboot:

```text
active calibration
calibration version
calibration timestamp
pump/channel mapping
```

UI menyimpan salinan calibration terakhir di browser state untuk display dan reconciliation.

Python nantinya menyimpan history calibration untuk analysis.

---

# 37. Schedule → UI → Python

**TO BE CONTINUED — UI → Python**

Untuk scheduling, arah data yang ditetapkan:

```text
ESP32 → UI → Python
```

Data yang diteruskan:

```text
active schedule snapshot
configurationVersion
schedule execution information
batchId
runtime status
```

Python menyimpan dan menganalisis data tersebut.

ESP32 tetap menjadi scheduler runtime.

---

# 38. Event Log → UI → Python

Arah event:

```text
ESP32
  ↓
UI
  ↓
Python
  ↓
save + analysis
```

UI tidak mengubah `eventType`, `batchId`, timestamp, atau semantic state ESP32.

Python dapat menambahkan metadata analysis tanpa mengubah original event.

---

# 39. Scheduled Backlog / Reconnect

Jika Python tidak terhubung ketika schedule/event terjadi:

```text
ESP32 executes normally
        ↓
ESP32 stores event/log
        ↓
Python reconnects
        ↓
ESP32 backlog available
        ↓
UI retrieves backlog
        ↓
UI forwards to Python
        ↓
Python saves + analyses
```

User juga dapat menekan tombol manual Sync pada UI untuk memulai proses tersebut.

## 39.1 Event Deletion

Setelah event telah berhasil diteruskan:

```text
ESP32 → UI → Python
```

dan terdapat acknowledgement persistence dari Python melalui contract yang akan ditentukan, ESP32 dapat menghapus event yang sudah acknowledged.

Namun:

```text
ONGOING BATCH
```

tidak boleh kehilangan batch context/log yang masih diperlukan untuk menyelesaikan lifecycle.

Contoh:

```text
MIXING_CREATED
      ↓
DOSING ACTIVE
      ↓
FERTIGATION_START
      ↓
FERTIGATION_DELIVERED
```

Record batch tetap dipertahankan sampai lifecycle selesai dan retention/acknowledgement terpenuhi.

---

# 40. Example Full Operational Flow

## 40.1 Configuration

User membuat schedule:

```text
GH-A
15:00
Raw water = 20,000 mL
A = 20 mL
B = 20 mL
N = 20 mL
Raw-water start threshold = 20%
```

UI membuat full snapshot:

```json
{
  "complexId": "complex-a",
  "configurationVersion": 18,
  "schedules": [
    {
      "id": "fert-001",
      "type": "fertigation",
      "ghId": "gh-a",
      "enabled": true,
      "time": "15:00",
      "rawWaterMl": 20000,
      "dosing": {
        "A": 20,
        "B": 20,
        "N": 20
      },
      "mixing": {
        "rawWaterStartThresholdPercent": 20
      }
    }
  ]
}
```

## 40.2 Batch Created

ESP32:

```text
MIXING_CREATED
```

## 40.3 Raw Water

Target:

```text
20,000 mL
```

Threshold:

```text
20%
```

Maka dosing threshold:

```text
4,000 mL
```

Sequence:

```text
RAW WATER START
      ↓
actual = 4,000 mL
      ↓
threshold reached
```

## 40.4 Dosing Serial

Setelah threshold tercapai:

```text
A START
A COMPLETE
      ↓
B START
B COMPLETE
      ↓
N START
N COMPLETE
```

Raw water tetap berjalan sampai raw-water target tercapai.

Batch complete jika semua target batch selesai.

## 40.5 Ready

```text
BATCH READY
```

Jika sekarang masih 14:40:

```text
READY → WAITING_FOR_SCHEDULE
```

## 40.6 Fertigation

Pada 15:00:

```text
FERTIGATION_START
      ↓
GH-A pump ON
      ↓
monitor lower-level sensor
      ↓
lower-level triggered
      ↓
pump OFF
      ↓
FERTIGATION_DELIVERED
```

## 40.7 Next Batch

Setelah fertigation batch selesai:

```text
create next mixing requirement
      ↓
MIXING_CREATED
      ↓
MIXING_QUEUED
      ↓
raw water
      ↓
dosing serial
      ↓
READY
```

---

# 41. Operational Invariants

Firmware dan UI harus mempertahankan invariant berikut:

1. **Satu fertigation preparation = satu batch.**
2. Raw water dan dosing merupakan bagian batch yang sama.
3. Raw water selalu mulai sebelum dosing.
4. Dosing hanya boleh mulai setelah actual raw water mencapai threshold configurable.
5. Threshold tidak hardcoded di firmware.
6. Central dosing execution selalu serial.
7. Tidak ada dua batch yang menggunakan central dosing secara bersamaan.
8. Fertigation pump antar-GH boleh berjalan bersamaan.
9. Well pump schedule memiliki `time` dan `to-time`.
10. Well pump tidak boleh dijalankan terus tanpa batas melalui schedule.
11. Manual well pump maksimum 15 menit.
12. Radar 220V menjadi physical cutoff di luar ESP32.
13. UI input volume menggunakan mL.
14. ESP32 menerjemahkan mL → runtime menggunakan calibration.
15. Raw-water completion ditentukan oleh actual flow meter.
16. Fertigation completion ditentukan oleh lower-level sensor.
17. Configuration schedule dikirim sebagai full snapshot.
18. Delete GH menghapus semua schedule yang mereferensikan GH tersebut.
19. Hardware inventory berasal dari mapping hardware yang terdaftar pada ESP32.
20. UI melakukan automatic inventory discovery jika browser state belum memiliki inventory.
21. Browser state adalah cache/persistence UI, bukan physical authority.
22. Event runtime berasal dari ESP32.
23. Event dapat dikirim ke Python melalui UI.
24. Event/backlog tidak boleh hilang sebelum lifecycle dan acknowledgement terpenuhi.
25. Calibration aktif harus tersedia di ESP32 untuk dosing normal.
26. Setiap batch wajib mempunyai calibration snapshot.
27. Batch memakai calibration terakhir yang valid pada saat batch dibuat dan tidak berubah selama lifecycle batch.
28. Calibration umur >= 7 hari menghasilkan warning kuning di UI.
29. Calibration umur >= 10 hari menghasilkan warning orange di UI.
30. Tidak ada tolerance correction atau automatic expiry yang menggagalkan batch hanya karena umur calibration.

---

# 42. Acceptance Criteria

## Hardware Inventory

- [ ] ESP32 mempunyai hardware inventory JSON.
- [ ] User dapat memasukkan inventory secara manual/hardcode.
- [ ] `GET /api/v1/inventory` mengembalikan inventory.
- [ ] UI Configuration dapat sync inventory.
- [ ] UI otomatis meminta inventory jika browser state kosong.
- [ ] UI menyimpan inventory di browser state.

## Scheduling

- [ ] Well pump mendukung `time` + `to-time`.
- [ ] Well pump tidak mempunyai open-ended scheduled run.
- [ ] Manual well pump dapat START/STOP.
- [ ] Manual well pump otomatis OFF maksimal 15 menit.
- [ ] Radar 220V memutus pump secara fisik dan tidak bergantung pada ESP32 software interlock.
- [ ] Fertigation schedule memiliki raw-water target dan dosing target.
- [ ] Threshold raw-water configurable dari UI.

## Mixing

- [ ] Raw water + dosing adalah satu batch.
- [ ] Raw water selalu start pertama.
- [ ] Dosing baru start setelah threshold actual tercapai.
- [ ] Raw water tetap dapat berjalan sampai target selesai.
- [ ] Dosing A/B/N serial.
- [ ] Tidak ada central dosing batch lain yang berjalan bersamaan.
- [ ] Batch hanya READY setelah seluruh requirement selesai.

## Fertigation

- [ ] Fertigation menunggu batch READY.
- [ ] Jika schedule datang sebelum READY, delivery dimulai segera setelah READY.
- [ ] Fertigation pump antar-GH dapat berjalan bersamaan.
- [ ] Distribution berhenti berdasarkan lower-level sensor.

## Calibration

- [ ] Test calibration mendukung 10/20/39 detik.
- [ ] Actual output dicatat dalam mL.
- [ ] `mL/s` dihitung dari hasil calibration.
- [ ] Calibration mempunyai version dan timestamp.
- [ ] Calibration terakhir tersedia di UI.
- [ ] ESP32 menggunakan calibration aktif untuk runtime dosing.
- [ ] Setiap batch menyimpan calibration snapshot.
- [ ] Batch ditolak jika calibration dosing yang dibutuhkan tidak tersedia.
- [ ] UI memiliki hardcoded mandatory calibration guard/alert.
- [ ] Batch menggunakan calibration snapshot immutable.
- [ ] Warning kuning muncul mulai 7 hari.
- [ ] Warning orange muncul mulai 10 hari.
- [ ] Calibration lama tetap usable sampai ada calibration baru yang valid.
- [ ] Calibration A/B/N terpisah.

## Event & Persistence

- [ ] `MIXING_QUEUED` tercatat.
- [ ] `MIXING_CREATED` tercatat.
- [ ] `FERTIGATION_START` tercatat.
- [ ] `FERTIGATION_DELIVERED` tercatat.
- [ ] `BATCH_FAILED` tercatat.
- [ ] `BATCH_CANCELLED` tercatat.
- [ ] `EMERGENCY_STOP` tercatat.
- [ ] Backlog event dikirim setelah koneksi tersedia.
- [ ] Manual sync dapat meminta backlog.
- [ ] Event ongoing tidak dihapus sebelum batch lifecycle selesai.

---

# 43. TO BE CONTINUED — UI → Python

Bagian berikut belum menjadi kontrak final dan akan ditentukan pada spesifikasi komunikasi berikutnya:

1. Endpoint UI → Python untuk save schedule.
2. Endpoint UI → Python untuk save event.
3. Endpoint UI → Python untuk save calibration history.
4. Python acknowledgement kepada UI/ESP32.
5. Event deduplication/idempotency.
6. Cursor/sequence number backlog.
7. Exact deletion acknowledgement dari Python ke ESP32.
8. Reconciliation ketika Python mempunyai configuration version berbeda dari ESP32.
9. Authentication untuk direct UI → ESP32.
10. Offline conflict resolution.

Untuk tahap ini, boundary yang sudah ditetapkan adalah:

```text
SCHEDULE RUNTIME
ESP32 → UI → Python

EVENT LOG
ESP32 → UI → Python

CONFIGURATION WRITE
UI → ESP32

HARDWARE INVENTORY
ESP32 → UI

RUNTIME TELEMETRY
ESP32 → UI

CALIBRATION
UI ↔ ESP32

PYTHON
save + analysis
```

---

# 44. Current Repository Note

Repository saat ini masih memiliki mock/local execution path. Audit menunjukkan active UI belum benar-benar menggunakan API client ESP32, sementara API client sudah memiliki endpoint configuration, inventory, telemetry, events, command status, clock sync, dan emergency stop. fileciteturn5file1L94-L112

Karena itu dokumen ini adalah **target mechanical/control contract** untuk implementasi berikutnya, bukan klaim bahwa seluruh endpoint di atas sudah aktif di server/ESP32 saat ini.

---

# 45. End of Current Specification

Dokumen ini membekukan mechanical scheduling model sampai bagian yang telah ditandai **TO BE CONTINUED**.

Prinsip utama:

```text
HARDWARE INVENTORY
        ↓
CONFIGURATION
        ↓
SCHEDULE
        ↓
BATCH CREATION
        ↓
RAW WATER FIRST
        ↓
CONFIGURABLE THRESHOLD
        ↓
SERIAL DOSING
        ↓
BATCH READY
        ↓
SCHEDULED FERTIGATION
        ↓
LOW-LEVEL SENSOR
        ↓
FERTIGATION DELIVERED
        ↓
EVENT LOG
        ↓
UI
        ↓
PYTHON SAVE + ANALYSIS
```
