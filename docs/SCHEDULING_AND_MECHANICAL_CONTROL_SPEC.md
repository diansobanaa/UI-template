Scheduling and Mechanical Control Specification

Document status: Authoritative implemented specification (SP-SCHED-MECH-001)
Scope: 1 Complex dikendalikan oleh 1 ESP32
Primary runtime authority: ESP32
Configuration transport: UI → ESP32 (PUT full snapshot)
Persistence / analysis path: ESP32 → UI → Python (Event relay)
Implementation status: VERIFIED & IMPLEMENTED (Frontend form & compiler, calibration standard ml/min, age warning badges, serial dosing state machine, raw water threshold gating, 15-min well pump safety clamp, lower float delivery completion, and event relay).

1. Tujuan Sistem

Sistem memiliki tiga scheduling domain utama:

WELL_PUMP — supply air dari sumur ke raw-water tank.

MIXING — membuat satu batch larutan GH yang terdiri dari raw water + seluruh dosing yang diperlukan.

FERTIGATION / DISTRIBUTION — menyalurkan batch yang sudah siap dari tank GH ke tanaman menggunakan fertigation/distribution pump GH.

Ketiga domain berbeda secara semantik dan memiliki runtime state masing-masing. ESP32 menjadi otoritas terhadap kondisi fisik, sequence actuator, timer lokal, sensor, queue, dan event runtime.

UI berfungsi untuk mengatur konfigurasi, mengirim full snapshot schedule, menampilkan state ESP32, serta menjadi jalur penerusan log menuju Python.

Python pada tahap berikutnya menyimpan dan menganalisis schedule serta event log. Detail integrasi UI → Python diberi status TO BE CONTINUED.

Repository yang diperiksa saat ini masih memiliki mock/local service dan API client yang belum menjadi bukti bahwa seluruh endpoint/server sudah benar-benar terhubung. Audit juga menyatakan runtime UI saat ini belum menjadi sumber kebenaran hardware. fileciteturn5file1L109-L130

2. Arsitektur dan Batas Tanggung Jawab

2.1 Complex

Satu Complex dikendalikan oleh tepat satu ESP32.

Komponen level Complex yang menjadi sumber daya sistem:

Well pump

Raw-water tank

Raw-water flow meter

Dosing pumps A-N/C sesuai inventory

Dosing valves yang terkait dengan dosing pump

Komponen per-GH:

GH mixing/batch tank

GH fertigation/distribution pump

GH valve jika topology memang memerlukannya

Sensor GH yang dibutuhkan runtime

2.2 ESP32

ESP32 bertanggung jawab atas:

menyimpan konfigurasi runtime terakhir yang valid;

menjalankan timer/scheduler lokal;

menjalankan sequence actuator;

mengatur batch mixing;

mengubah target volume dosing dari mL menjadi runtime pompa berdasarkan calibration;

membaca flow meter untuk actual raw-water volume;

mengatur queue dosing;

mengatur runtime state;

menghentikan atau membatalkan batch sesuai safety/event;

menghasilkan event log;

mempertahankan operasi berdasarkan konfigurasi terakhir yang valid ketika koneksi eksternal tidak tersedia.

Audit repository juga mengusulkan ESP32 mengembalikan runtime state, actual actuator state, sensor telemetry, tank/flow information, actual dose/volume, queue status, event/fault, emergency-stop state, dan execution progress. fileciteturn5file5L482-L498

2.3 UI

UI bertanggung jawab atas:

input schedule;

input volume dalam mL;

input threshold mixing;

input calibration configuration;

create/edit/delete/enable/disable schedule;

menyusun ulang full schedules[] snapshot;

mengirim snapshot ke ESP32;

menampilkan status accepted/rejected;

menampilkan runtime state dan event log ESP32;

menyediakan tombol manual untuk operasi yang memang diizinkan.

UI tidak boleh menganggap perubahan local state sebagai bukti actuator fisik telah berubah.

2.4 Python

TO BE CONTINUED — UI → Python

Tahap lanjutan akan mendefinisikan Python sebagai pihak yang:

menyimpan schedule;

menyimpan event log;

menganalisis schedule dan event;

melakukan reconciliation/persistence setelah menerima data dari ESP32.

Audit repository memang mengusulkan Python sebagai durable application/control-plane owner untuk persistence, telemetry/event storage, schedule/recipe persistence, dan reconciliation. fileciteturn5file2L182-L200

3. Scheduling Domains

3.1 WELL_PUMP

Fungsi

Memindahkan air dari sumur ke raw-water tank.

Trigger

Well pump berjalan otomatis dari jadwal dan juga dapat dikendalikan langsung dari tombol fisik atau Web UI. Tidak ada operating mode AUTO/MANUAL yang harus dipilih operator.

Format Pemicu Scheduled

Sistem mendukung fleksibilitas trigger:
- `time`: Jam mulai spesifik (misal `06:00`).
- `days`: Hari-hari tertentu dalam seminggu.
- `interval`: Pengisian berkala (misal setiap `intervalMinutes: 60` dengan `durationSeconds: 30` di dalam jendela `time` s/d `endTime`).
- `durationSeconds` atau `to-time`: Batas berhenti pompa.
- `targetLiters`: Batas volume air baku yang diinginkan (misal 500 L).

Sistem TIDAK menggunakan schedule open-ended tanpa batas waktu. Pompa selalu memiliki batas berhenti yang pasti, baik melalui durasi detik maupun `to-time`.

Contoh Scheduled:

{
  "id": "wp-001",
  "type": "well_pump",
  "enabled": true,
  "trigger": "time",
  "time": "06:00",
  "durationSeconds": 60,
  "to-time": "06:01",
  "targetLiters": 500
}

Maknanya:
06:00 -> START
06:01 (atau 60 detik) -> STOP

ESP32 memperlakukan durasi atau to-time sebagai batas berhenti schedule otomatis.

Manual ON/OFF & Autonomous Schedule Operation

Manual operation diperbolehkan melalui:
1. Tombol toggle fisik pada controller utama (Button 2 / GPIO 39).
2. Web UI manual control card (aksi langsung: `TURN ON (MAX 15M)` dan `TURN OFF`).

Aturan authoritative manual ON & Autonomous Execution:
- **Penyederhanaan Tanpa Mode Khusus (No Mode Friction):** Pilihan/tombol mode `AUTO` vs `MANUAL` ditiadakan. Operator tidak perlu memilih atau mengganti mode operasi terlebih dahulu. Tombol manual di UI dan fisik controller langsung memicu sesi pompa terikat batas waktu (bounded run).
- **Tanpa Mode Operasi:** Tidak ada mode AUTO/MANUAL. Jadwal dijalankan otonom, sementara perintah tombol/web tetap dapat mengendalikan pompa langsung.
- **Manual ON Maksimal 15 Menit:** Durasi continuous manual ON dibatasi keras maksimal **15 menit (900 detik)** menggunakan monotonic hardware clock (`esp_timer_get_time()`). Timer ini tidak dipengaruhi oleh sinkronisasi wall-clock / RTC, kecuali jadwal dimulai saat sesi manual itu sedang berjalan; dalam kasus itu akhir jendela jadwal menjadi batas OFF.
- **Pemberhentian Dini:** Operator dapat mematikan pompa setiap saat sebelum batas 15 menit tercapai melalui Web UI atau toggle fisik (reason: `OPERATOR_OFF`).
- **Otomatis Berhenti pada 15 Menit:** Ketika 15 menit continuous run tercapai, firmware ESP32 otomatis mematikan relay output, membersihkan sesi manual, mencatat event `MANUAL_RUNTIME_LIMIT_REACHED`, dan memperbarui status telemetry.
- **Idempoten (Repeated ON Tidak Mereset Timer):** Permintaan ON berulang atau klik tombol duplikat selama sesi aktif TIDAK memperpanjang batas deadline 15 menit. Deadline dihitung dari waktu perintah ON pertama diterima.
- **Sesi Baru Bounded:** Sesi manual baru dengan batas 15 menit baru hanya dapat dimulai setelah sesi sebelumnya selesai atau dihentikan secara eksplisit.
- **Prioritas Manual:** Perintah manual berlaku segera. Jika pompa yang dinyalakan jadwal dimatikan manual, scheduler menahan pompa tetap OFF sampai semua jendela jadwal aktif berakhir. Jika pompa sudah ON secara manual sebelum jadwal dimulai, jadwal mengambil alih batas berhenti dan mematikannya pada akhir jendela jadwal, walaupun timer manual belum habis. Perintah manual ON yang baru tetap memulai sesi manual terbatas.
- **Jadwal Tetap Tersimpan:** Operasi manual tidak mengubah atau menghapus konfigurasi jadwal otomatis yang tersimpan di NVS; jendela jadwal berikutnya tetap berjalan.
- **Isolasi Peralatan (Well Pump vs Raw Submersible):** Domain Well Pump difokuskan secara eksklusif ke `pump_well` (Relay #1 / GPIO 1) untuk transfer air sumur ke tangki baku. Peralatan `pump_submersible` (Raw Submersible Pump) merupakan domain terpisah dan tidak dimasukkan ke dalam pilihan pompa Well Pump.
- **Tidak Wajib Flow Sensor:** `pump_well` tidak memakai water-flow sensor sebagai syarat start, jadwal, atau watchdog runtime. Flow watchdog (`FLOW_TIMEOUT`) berlaku untuk raw submersible, distribusi, delivery, dan fertigation pump yang memang memiliki flow feedback.
- **Prioritas Safety (Emergency Stop):** Kondisi Emergency Stop dan interlock keselamatan selalu beroperasi pada prioritas tertinggi, memaksa pompa OFF seketika dan memblokir perintah manual maupun terjadwal.
- **Reboot Behavior:** Setelah ESP32 restart, output relay selalu diinisialisasi ke kondisi safe OFF (GPIO 1 HIGH, Relay de-energized Active-LOW). Sesi manual lama dibatalkan dan tidak pernah dilanjutkan secara otomatis. Evaluasi jadwal baru dilakukan setelah waktu tersinkronisasi.
- **Enforcement Mandiri tanpa Web UI:** Firmware ESP32 menegakkan batas 15 menit secara otonom meskipun Web UI ditutup, browser tidak aktif, atau jaringan terputus.

Interlock & Hardware Protection

Well-pump safety cutoff tidak dikelola oleh ESP32 berdasarkan radar 220V:

Well Pump power/control
      │
      └── safety cutoff lewat radar 220V (Fisik / Eksternal)

ESP32 tidak memotong jalur listrik radar sebagai interlock software, tidak memiliki dependensi flow meter, dan tidak memiliki dependensi float sensor tangki aduk untuk Well Pump.
Keputusan pemutusan daya karena kondisi radar/full tank dilakukan oleh rangkaian radar 220V yang memutus koneksi pump secara fisik mandiri. Command relay=ON pada GPIO 1 hanya membuktikan relay ter-energize, bukan bukti aliran fisik air bergerak jika radar fisik sedang memutus sirkuit 220V.

Penting: status radar 220V dan status aktual listrik pump belum menjadi telemetry ESP32 pada spesifikasi ini. Jangan menganggap commanded=ON berarti motor pasti sedang menerima daya.

Karakteristik

Well pump:

tidak menunggu fertigation;

tidak menjadi bagian dari batch mixing tertentu;

merupakan supply operation berdiri sendiri;

menjalankan jadwal otonom dengan kontrol manual langsung;

manual mode memiliki maximum ON duration 15 menit.

3.2 MIXING

Definisi

Raw water dan dosing A-N/C adalah satu batch yang sama.

Satu fertigation preparation tidak boleh dianggap sebagai:

Batch raw water terpisah
+
Batch dosing terpisah

Model yang benar:

1 BATCH
├── Raw Water Target
├── Dosing A Target (Native MOSFET #1 / GPIO 5)
├── Dosing B Target (Native MOSFET #2 / GPIO 6)
└── Dosing Channels Target (Dinamis hingga 7 saluran: A s/d G atau N via I2C expansion)

Fungsi

Membuat batch siap distribusi pada GH tertentu.

Aturan inti

Urutan dasar batch mixing adalah:

RAW WATER START
      ↓
RAW WATER ACTUAL >= threshold%
      ↓
DOSING SERIAL A → B → C → ... → G/N
      ↓
RAW WATER dan seluruh DOSING complete
      ↓
BATCH COMPLETE
      ↓
READY

Raw water harus menjadi input/operasi pertama di dalam batch.

Raw filter

Pada konfigurasi mixing, raw filter juga diinput sebagai nilai volume dalam mL apabila memang ada proses dosing/filter media yang diukur secara volumetrik pada hardware final.

Aturan unit tetap:

UI input = mL
ESP32 = translate mL → pump ON time berdasarkan calibration

Field dan channel final harus mengikuti hardware inventory final.

3.3 FERTIGATION / DISTRIBUTION

Fertigation/distribution adalah operasi fisik penyaluran batch yang sudah siap dari tank GH menuju tanaman.

Komponen:

GH fertigation/distribution pump;

valve terkait bila diperlukan oleh topology;

lower-boundary / low-level sensor pada tank batch/distribution.

Distribution adalah runtime state terpisah dari mixing.

Parallelism Antar-GH

Fertigation pump GH-A sampai GH-N boleh berjalan bersamaan, sepanjang:

masing-masing menggunakan hardware GH yang berbeda;

safety/interlock masing-masing terpenuhi;

tidak ada physical resource conflict.

Dengan demikian:

GH-A DISTRIBUTING ──────┐
GH-B DISTRIBUTING ──────┼─ boleh bersamaan
GH-C DISTRIBUTING ──────┘

Aturan ini berlaku untuk fertigation/distribution pump per-GH, bukan untuk central dosing pumps.

4. Schedule Object Model

Semua schedule berada dalam satu array konfigurasi:

schedules: unknown[]

Setiap item wajib memiliki type.

Type utama:

well_pump
fertigation

fertigation merupakan deklarasi jadwal yang menjadi sumber pembentukan batch mixing dan operation fertigation/distribution.

mixing merupakan runtime operation hasil dekomposisi dari fertigation schedule, bukan berarti user harus membuat schedule mixing terpisah untuk setiap fertigation.

5. Configuration Envelope

5.1 Envelope

Contoh:

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

Catatan penting

rawWaterStartThresholdPercent adalah configuration parameter, bukan konstanta firmware.

Nilai default yang dipakai saat ini adalah 20%, tetapi UI harus dapat mengubahnya.

Contoh:

20%
25%
30%

Jika UI mengubah dari 20% menjadi 25%, snapshot baru yang dikirim ke ESP32 harus menggunakan 25%.

6. Unit dan Konversi

6.1 Input UI

Semua target volume di UI diinput dalam mL.

Contoh:

{
  "rawWaterMl": 20000,
  "dosing": {
    "A": 20,
    "B": 20,
    "N": 20
  }
}

6.2 Tanggung jawab ESP32

ESP32 mengubah target volume menjadi durasi ON actuator berdasarkan calibration.

UI tidak boleh menghitung:

20 mL = 2.4 detik

UI hanya mengirim:

target = 20 mL

ESP32 menghitung durasi berdasarkan calibration terbaru.

6.3 Raw water

Untuk raw water, actual volume ditentukan oleh flow meter.

ESP32 tidak boleh menganggap volume tercapai hanya karena pump sudah ON selama X detik.

6.4 Dosing dan raw filter

Dosing dan raw filter yang diukur secara volumetrik di-input sebagai mL.

ESP32 menggunakan calibration coefficient yang sesuai dengan pump/channel.

7. Configuration Replacement

7.1 Full Snapshot

Setiap perubahan schedule menggunakan full snapshot.

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

Tidak ada patch schedule parsial sebagai source of truth utama.

7.2 Create

Saat membuat schedule:

UI mengambil konfigurasi schedule Complex saat ini.

UI menambahkan schedule baru.

UI membentuk full schedules[].

UI mengirim snapshot baru ke ESP32.

ESP32 memvalidasi.

ESP32 menerima dan apply secara atomic jika valid.

7.3 Edit

Edit satu schedule tetap menghasilkan full snapshot.

7.4 Delete Schedule

Delete satu schedule juga menghasilkan full snapshot.

7.5 Delete GH

Jika GH-X dihapus, maka seluruh schedule yang mempunyai ghId = GH-X harus ikut dihapus.

Proses wajib:

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

Contoh:

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

UI harus memastikan tidak ada orphan schedule yang masih menunjuk ke GH yang sudah dihapus.

7.6 Disable

Disable schedule juga menghasilkan full snapshot.

Disable tidak sama dengan delete.

{
  "enabled": false
}

8. Fertigation Schedule → Batch Decomposition

Contoh schedule:

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

ESP32 membuat satu batch preparation:

batchId = generated runtime identifier
scheduleId = fert-001
ghId = gh-a

Batch memiliki dua domain runtime:

MIXING
  ↓
READY
  ↓
FERTIGATION

Tidak boleh dianggap sebagai satu actuator timer tunggal.

8.1 Calibration Snapshot Wajib untuk Setiap Batch

Setiap batch mixing WAJIB mempunyai calibration snapshot pada saat batch dibuat. Batch tidak boleh masuk execution apabila calibration yang diperlukan untuk seluruh dosing component yang digunakan tidak tersedia.

Aturan:

UI/ESP32 memeriksa calibration aktif untuk setiap dosing pump yang digunakan oleh batch.

Calibration yang dipakai adalah calibration terakhir yang valid pada saat batch dibuat.

Nilai calibration tersebut disalin ke batch.calibrationSnapshot.

Setelah batch dibuat, calibration snapshot batch bersifat immutable.

Jika user melakukan calibration baru setelah batch dibuat, batch yang sedang berjalan tetap menggunakan calibration snapshot lama.

Batch berikutnya akan menggunakan calibration terbaru yang valid pada saat batch tersebut dibuat.

Tidak ada tolerance correction di tengah batch. Runtime dihitung dari calibration snapshot batch.

Jika salah satu calibration atau komponen yang diwajibkan belum tersedia:
Jadwal tetap disimpan di database/konfigurasi, namun diberi status BLOCKED dengan alasan diagnostik eksplisit (misalnya MISSING_CALIBRATION atau MISSING_DOSING_PUMP). Jadwal berstatus BLOCKED disisihkan dari scheduler eksekusi aktif ESP32 sehingga ESP32 tidak menjalankan pompa tanpa kalibrasi. Begitu kalibrasi dilakukan di kemudian hari, jadwal otomatis revalidasi beralih menjadi ACTIVE tanpa perlu input ulang oleh user.

Mandatory UI Guard & Diagnostic Badge

UI menampilkan status badge amber "Blocked (Kalibrasi Belum Ada)" dan mencegah pemicuan manual jika kalibrasi belum siap:

if (!calibrationAvailableForBatch) {
  // Jadwal disimpan sebagai BLOCKED, bukan digagalkan/dihapus
  schedule.activationState = 'BLOCKED';
  schedule.blockedReasons = ['MISSING_CALIBRATION'];
}

Batch Calibration Snapshot Example (dalam satuan standar ml/min)

{
  "batchId": "batch-20260913-0001",
  "ghId": "gh-a",
  "calibrationSnapshot": {
    "A": {
      "calibrationId": "cal-a-007",
      "flowRateMlPerMin": 109.2,
      "calibratedAt": "2026-09-12T10:00:00+07:00"
    },
    "B": {
      "calibrationId": "cal-b-004",
      "flowRateMlPerMin": 105.6,
      "calibratedAt": "2026-09-12T10:02:00+07:00"
    },
    "C": {
      "calibrationId": "cal-c-006",
      "flowRateMlPerMin": 126.0,
      "calibratedAt": "2026-09-12T10:04:00+07:00"
    }
  }
}

Batch tersebut selamanya menggunakan snapshot di atas selama lifecycle batch tersebut. Runtime durasi detik dihitung: runtimeSec = (targetMl / flowRateMlPerMin) * 60.

9. Batch Mixing Mechanical Rules

9.1 Satu Batch

Untuk satu fertigation schedule:

1 batch =
  raw water target
  + raw filter target jika digunakan
  + dosing A target
  + dosing B target
  + dosing N/C target

Semua komponen tersebut selesai sebagai satu batch.

9.2 Fase 1 — Raw Water Start

Saat batch dimulai:

RAW WATER ROUTING START
FLOW METER ACTIVE

Dosing belum boleh start.

9.3 Fase 2 — Raw Water Fill to Configurable Threshold

Threshold bukan konstanta tetap.

UI mengatur:

rawWaterStartThresholdPercent

Misal:

rawWaterTarget = 20.000 mL
threshold = 20%

Maka:

threshold volume = 4.000 mL

Jika threshold diubah menjadi 25%:

threshold volume = 5.000 mL

ESP32 menghitung threshold volume dari konfigurasi dan memonitor actual flow-meter volume.

9.4 Fase 3 — Dosing Start

Saat:

rawWaterActual >= thresholdVolume

ESP32 boleh memulai dosing.

Contoh:

08:00:00 raw water START
08:00:01 raw = 500 mL
08:00:05 raw = 2.800 mL
08:00:07 raw = 4.000 mL  ← threshold tercapai
08:00:07 Dosing A START
08:00:07 Dosing B START? NO — lihat aturan serial
08:00:07 Dosing N START? NO — lihat aturan serial

Mulai dari threshold, dosing mengikuti queue serial yang telah ditetapkan pada Section 10.

9.5 Raw Water Tetap Berjalan

Setelah threshold tercapai, raw water tetap menjadi bagian dari batch dan tetap dapat mengalir sampai target raw-water volume tercapai.

Sehingga:

RAW WATER
██████████████████████████
          
DOSING
          ███ A ███
                  ███ B ███
                          ███ N ███

9.6 Batch Complete

Batch mixing hanya COMPLETE jika seluruh kebutuhan batch selesai:

raw water complete
AND
raw filter complete jika digunakan
AND
dosing A complete jika digunakan
AND
dosing B complete jika digunakan
AND
dosing N/C complete jika digunakan

Setelah itu:

MIXING COMPLETE
      ↓
READY

10. Dosing Queue dan Serial Execution

10.1 Aturan definitif

Dosing HARUS SERIAL.

Tidak ada dua dosing operation dari central dosing system yang melayani mixing secara bersamaan.

Aturan ini berarti:

DP-A → selesai
   ↓
DP-B → selesai
   ↓
DP-N → selesai

Jika hanya A dan B yang dipakai:

DP-A → selesai
   ↓
DP-B → selesai

10.2 Active Mixing Ownership

Pada saat sebuah batch mixing aktif:

dosing pump yang digunakan untuk batch aktif menjadi milik batch tersebut selama operation dosing;

DP-A–DP-N tidak boleh secara bersamaan melayani mixing batch lain;

tidak ada shared dosing resource execution antar-mixing pada waktu yang sama.

Dengan keputusan ini, tidak ada lagi konsep:

GH-A memakai DP-A
GH-B memakai DP-B
→ berjalan bersamaan

Untuk central dosing, model yang dipakai adalah serial.

10.3 Queue

Queue tetap berada pada scope Complex, tetapi queue hanya digunakan untuk mengatur urutan batch/operation yang menunggu eksekusi dosing.

Contoh:

BATCH-GH-A → QUEUED
BATCH-GH-B → QUEUED
BATCH-GH-C → QUEUED

Execution:

BATCH-GH-A DOSING
        ↓ complete
BATCH-GH-B DOSING
        ↓ complete
BATCH-GH-C DOSING

Tidak ada overlapping central dosing execution.

10.4 Mixing Preparation

Satu GH hanya memiliki satu active mixing batch pada satu waktu.

Batch berikutnya dapat dipersiapkan setelah fertigation batch sebelumnya selesai sesuai scheduling model, tetapi ketika masuk fase central dosing, hanya satu batch yang boleh menggunakan central dosing sequence pada satu waktu.

10.5 Important Distinction

Serial berlaku untuk central dosing execution.

Serial tidak berarti seluruh operation Complex harus berhenti.

Contoh yang valid:

GH-A FERTIGATION  ────────────────

GH-B MIXING raw water ────────────
           waiting threshold

GH-C idle

Namun saat GH-B memasuki dosing central:

GH-B DOSING A → B → N

tidak ada GH lain yang melakukan central dosing sampai sequence tersebut selesai.

11. Mixing Runtime State

State minimum yang digunakan:

IDLE
QUEUED
MIXING_RAW_WATER
DOSING
READY
COMPLETED
FAILED
CANCELLED
EMERGENCY_STOP

QUEUED

Batch sudah dibuat dan menunggu giliran untuk central dosing sequence atau resource execution yang diperlukan.

MIXING_RAW_WATER

Raw water sedang diisi sampai threshold/target sesuai fase.

DOSING

Central dosing sequence berjalan serial.

READY

Batch sudah lengkap dan menunggu waktu distribution.

12. Fertigation / Distribution Runtime Rules

12.1 Trigger

Fertigation distribution dipicu oleh schedule time:

schedule time reached

Tetapi batch harus READY terlebih dahulu.

12.2 Jika Batch READY sebelum Schedule

Contoh:

14:40 → mixing complete
14:40 → batch READY
15:00 → scheduled fertigation

Tank menunggu.

Pada 15:00:

READY → DISTRIBUTING

12.3 Jika Schedule tiba sebelum Batch READY

Contoh:

15:00 → schedule tiba
15:00 → batch belum READY

ESP32 harus:

mencatat event delay/not-ready;

tetap menyelesaikan batch;

segera melakukan distribution setelah batch READY;

tidak menjalankan distribution sebelum batch tersedia.

12.4 Stop Condition

Distribution berjalan sampai lower-boundary / low-level sensor pada batch tank/distribution tank ter-trigger.

Model:

DISTRIBUTION PUMP START
        ↓
monitor lower-level sensor
        ↓
LOW LEVEL TRIGGERED
        ↓
DISTRIBUTION PUMP STOP
        ↓
FERTIGATION DELIVERED

Jangan menghentikan distribution hanya berdasarkan countdown UI.

12.5 Parallel Fertigation Antar-GH

Fertigation pump per GH dapat bekerja bersamaan.

Contoh:

GH-A DISTRIBUTING ─────────────
GH-B DISTRIBUTING ─────────────
GH-C DISTRIBUTING ─────────────

Hal ini berbeda dengan central dosing yang tetap serial.

13. Pre-Dosing dan Batch Preparation

Tujuan sistem adalah menyiapkan batch sedini mungkin tanpa mengubah waktu fertigation.

Alur:

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

Saat waktu fertigation tiba:

READY
  ↓
DISTRIBUTING

Setelah distribution complete, persiapan batch berikutnya kembali dibuat.

14. Batch Identity dan Event Correlation

Setiap runtime batch harus memiliki identifier unik:

batchId

Batch juga harus menyimpan minimal:

batchId
scheduleId
ghId
configurationVersion
createdAt
startedAt
completedAt
runtimeState

### 14.1 Reconciled Dosing Queue & Operational Schedule Implementation Invariants

1. **Global Dosing Queue Dispatch Latch (`QUEUE_STATE_DISPATCHED`):**
   - The scheduler 1-second evaluation tick never resubmits the same queue HEAD while waiting for physical execution.
   - Upon `command_mgr_submit()` acceptance, queue entry transitions `QUEUE_STATE_PENDING -> QUEUE_STATE_DISPATCHED` with `dispatched_at_ms`.
   - When `fertigation_mgr` confirms physical dosing has started (`FERT_STATE_FILLING` with threshold, `FERT_STATE_DOSING`, or `FERT_STATE_MIX_READY`), state transitions `QUEUE_STATE_DISPATCHED -> QUEUE_STATE_ACTIVE`.
   - A 15-second watchdog fails the dispatch deterministically (`QUEUE_STATE_FAILED`) if physical start is not observed.

2. **Exact 4-Tuple Correlation:**
   - Queue readiness and completion require exact correlation using: `queue_id` + `occurrence_id` + `batch_id` + `gh_id`.
   - The FIFO head is never dequeued merely because "some batch" finished; it requires full 4-tuple equality via `fertigation_mgr_get_correlation()`.

3. **Non-Cyclic Next-Preparation Chaining:**
   - There is zero cyclic dependency between `scheduler.c` and `fertigation_mgr.c`.
   - The scheduler's 1-second tick inspects `fertigation_mgr_get_last_terminal()` when an occurrence is in `OCC_STATE_DISTRIBUTING`.
   - Upon terminal completion (`FERTIGATION_DELIVERED` / `DELIVERY_COMPLETED`), the occurrence is marked `OCC_STATE_COMPLETED`, the NVS schedule marker is updated, and exactly ONE next eligible pending occurrence for that greenhouse is enqueued into the Global Dosing Queue.

4. **Deterministic Boot FIFO Reconstruction:**
   - Global Dosing Queue is strictly in-memory. Zero ephemeral `queue.json` files on SPIFFS.
   - After boot, `materialize_today_schedule(now)` materializes all occurrences for today sorted chronologically by `scheduled_timestamp`.
   - `rebuild_dosing_queue_on_boot(now)` iterates in strict chronological order and enqueues the first pending occurrence per GH.

5. **Physical Gating & Concurrent Mixing:**
   - When raw water fill hits the configured threshold (~20%), the mixing pump starts AND serial dosing starts ($A \to B \to N$) while raw water continues flowing to target volume.
   - Upon final mixing completion, all pumps stop and routing valves close, holding the batch in `READY_TO_SEND` (`FERT_STATE_MIX_READY`) until the scheduled delivery time arrives.

Semua event harus dapat ditelusuri ke batch melalui batchId.

15. Event Log yang Wajib Terlihat dan Disimpan

Event minimum yang wajib terlihat di UI dan disimpan pada jalur persistence:

MIXING_QUEUED
MIXING_CREATED
FERTIGATION_START
FERTIGATION_DELIVERED
BATCH_FAILED
BATCH_CANCELLED
EMERGENCY_STOP

15.1 MIXING_QUEUED

Batch telah masuk waiting/queue stage untuk proses mixing/dosing.

15.2 MIXING_CREATED

Batch mixing telah dibuat oleh scheduler/runtime.

15.3 FERTIGATION_START

Distribution pump memulai penyaluran batch.

15.4 FERTIGATION_DELIVERED

Distribution berhenti berdasarkan lower-boundary sensor dan batch dianggap delivered.

15.5 BATCH_FAILED

Batch gagal dan tidak dapat melanjutkan normal flow.

15.6 BATCH_CANCELLED

Batch dibatalkan secara eksplisit oleh control flow yang valid.

15.7 EMERGENCY_STOP

Emergency stop terpicu.

16. Event Log Transport dan Persistence

16.1 Runtime path

ESP32
  ↓
UI
  ↓
Python
  ↓
save + analysis

UI harus menampilkan event yang diterima dari ESP32 tanpa mengubah makna event tersebut.

Python menerima event untuk:

save;

analysis;

history;

reporting.

16.2 Scheduled Delivery / Missed Log

Jadwal/event tidak boleh hilang ketika Python tidak tersambung.

Jika ada schedule atau event yang terlewat karena Python belum terhubung:

ESP32 menyimpan event
      ↓
Python kembali connect
      ↓
ESP32 → UI → Python
      ↓
Python save + analysis

Pengiriman backlog dilakukan sesaat setelah koneksi Python tersedia.

16.3 Manual Sync dari UI

User dapat menekan tombol manual pada UI untuk meminta sinkronisasi backlog/event.

Model:

USER HIT SYNC
      ↓
UI request data ESP32
      ↓
UI → Python
      ↓
Python save + analysis

17. Event Acknowledgement dan Deletion

ESP32 menyimpan event/log yang belum dipastikan diterima oleh jalur persistence.

Setelah event berhasil diteruskan:

ESP32 → UI → Python

dan Python telah memberikan status penerimaan/persistence sesuai contract final, ESP32 dapat menghapus event yang sudah terkirim dan acknowledged.

Aturan penting

Jika event masih berada dalam status belum selesai/ongoing, batch log terkait jangan dihapus lebih dahulu.

Contoh:

MIXING_QUEUED
MIXING_CREATED
DOSING...

Jika batch masih ongoing, record/log batch tersebut harus dipertahankan.

Ketika batch selesai:

FERTIGATION_DELIVERED

atau terminal event:

BATCH_FAILED
BATCH_CANCELLED
EMERGENCY_STOP

barulah lifecycle retention dapat dilanjutkan sesuai acknowledgement/persistence policy.

Detail acknowledgement protocol UI → Python dan exact deletion acknowledgement belum dibekukan dan masuk TO BE CONTINUED.

18. Missed Schedule Rules

18.1 ESP32 tetap sebagai scheduler

Schedule dijalankan oleh ESP32 berdasarkan konfigurasi terakhir yang valid.

UI/Python bukan timer fisik utama.

18.2 Jika Python offline

ESP32 tetap:

menjalankan schedule;

membuat batch;

menjalankan mixing;

menjalankan fertigation;

membuat event log.

Data kemudian dikirim ketika koneksi kembali.

18.3 Jika Python kembali connect

Backlog yang sudah tersimpan di ESP32 harus dikirim melalui:

ESP32 → UI → Python

sesegera mungkin setelah koneksi tersedia.

18.4 Jika schedule terlewat

Schedule/event yang belum berhasil dikirim ke Python tidak dianggap hilang.

ESP32 mempertahankan log sampai delivery/acknowledgement selesai.

19. Calibration Specification

19.1 Tujuan

Calibration digunakan agar ESP32 dapat mengubah target volume mL menjadi runtime ON pump yang sesuai.

Contoh:

target = 20 mL

ESP32 tidak hardcode runtime.

ESP32 mengambil coefficient dari calibration terakhir.

19.2 Prinsip Calibration

Calibration dilakukan dengan cara menyalakan pump selama durasi yang dipilih secara eksplisit oleh operator, kemudian mengukur volume output aktual yang tertampung di gelas ukur.

Pilihan durasi standar (presets) yang disediakan pada UI:
- **30 detik (Standar Rekomendasi):** Presisi optimal untuk pompa peristaltik mikro-dosing.
- **10 detik (Uji Cepat):** Pengujian singkat untuk verifikasi fungsional.
- **60 detik (Presisi Tinggi):** Untuk debit aliran sangat kecil atau larutan pekat.

Durasi yang dipilih operator menjadi satu-satunya acuan otoritatif durasi putar pompa GPIO pada ESP32, hitung mundur (countdown), dan pembagi rumus laju aliran. Sistem tidak memperbolehkan inkonsistensi antara durasi yang diuji dan durasi yang dihitung.

19.3 Prosedur Calibration & Workflow UI/UX 4-Tahap

Sistem mengadopsi human-centered workflow 4-tahap yang intuitif:

1. **Langkah 1 (Pengaturan & SOP):**
   - Menampilkan status kalibrasi aktif saat ini (misal: 24.0 ml/mnt atau Belum Dikalibrasi).
   - Operator memilih durasi uji (10s, 30s, atau 60s) dan mode kalibrasi (1x Tunggal atau 3x Bertahap).
   - Checklist kesiapan selang dan gelas ukur.
   - Operator menekan tombol `[ Mulai Kalibrasi ]`.

2. **Langkah 2 (Pompa Berjalan):**
   - ESP32 mengaktifkan pompa dosing (`POST /api/v1/calibration` dengan `{ duration_sec }`).
   - UI menampilkan hitung mundur (countdown) waktu riil dari durasi terpilih, bilah progres (progress bar), dan tombol darurat `[ Hentikan Pengujian ]` (`DELETE /api/v1/calibration`).

3. **Langkah 3 (Catat Volume Cairan):**
   - Begitu pompa mati secara otomatis saat durasi tercapai, UI bertransisi ke form input volume.
   - Form secara eksplisit mencantumkan durasi riil yang baru saja diuji: *"Volume Cairan Tertampung (ml) — selama tes [X] detik"*.
   - Operator memasukkan angka mililiter cairan di gelas ukur.
   - Preview interaktif menampilkan kalkulasi debit seketika beserta perbandingan deviasi terhadap nilai aktif sebelumnya.

4. **Langkah 4 (Tinjau & Simpan):**
   - Menampilkan nilai flow rate baru dalam ukuran besar dan kontras (ml/mnt dan ml/dtk).
   - Menampilkan perbandingan 3 kolom: *Nilai Sebelumnya*, *Nilai Baru*, dan *Selisih / Deviasi*.
   - Menampilkan makna agronomis: *"Pompa mengalirkan X ml per menit..."*.
   - Operator menekan `[ Simpan Kalibrasi ke Kontroler ]`.
   - Data disimpan ke NVS ESP32 dan database backend secara permanen, memicu reload otoritatif pada UI tanpa refresh halaman.

Rumus dasar laju aliran volumetrik:

```text
Flow Rate (ml/min) = (Measured Volume (ml) / Actual Duration (sec)) * 60
Flow Rate (ml/sec) = Flow Rate (ml/min) / 60 = Measured Volume (ml) / Actual Duration (sec)
```

Untuk mode 3x Pengukuran Bertahap (Multi-Sample):
```text
Flow Rate Gabungan (ml/min) = (Total Volume Terkumpul (ml) / Total Waktu Aktual (sec)) * 60
```
Sistem memeriksa konsistensi antar-sampel (deviasi maks <= 10%) dan menampilkan tabel rincian seluruh sampel yang telah diambil.

Estimasi runtime pompa dosing saat proses pemberian pupuk:
```text
Runtime Dosing (ms) = (Target Volume (ml) / Flow Rate (ml/min)) * 60,000
```

19.4 Data Calibration yang Disimpan

Minimal:

{
  "channel": "A",
  "testDurationSec": 20,
  "measuredVolumeMl": 100,
  "flowRateMlPerMin": 300,
  "calibratedAt": "2026-09-13T00:00:00+07:00"
}

Recommended metadata:

pumpId
channel
operator/reference
measurementCount
source container / measurement method
validFrom
supersedesCalibrationId

19.5 Calibration Antar-Saluran (Dinamis hingga 7 Saluran)

Setiap dosing channel (A s/d G atau N) harus dikalibrasi secara independen.

Contoh:

A → calibration A
B → calibration B
C → calibration C
G → calibration G

Tidak boleh memakai coefficient A untuk pump B atau saluran ekspansi lainnya.

19.6 Raw Filter Calibration

Jika raw filter menggunakan pump yang menyalurkan volume terukur dalam mL, raw filter mengikuti pola calibration yang sama:

pump ON selama testDurationSec
→ ukur volume
→ hitung mL/s
→ gunakan coefficient untuk target mL

19.7 Multiple Calibration Runs

Calibration dapat dilakukan lebih dari sekali. Setiap hasil calibration yang valid menjadi kandidat calibration terbaru untuk component tersebut.

Contoh:

Run 1 → 100 mL / 20 s = 5.00 mL/s
Run 2 → 102 mL / 20 s = 5.10 mL/s
Run 3 →  98 mL / 20 s = 4.90 mL/s

Untuk runtime batch, yang digunakan adalah satu calibration terakhir yang valid pada saat batch dibuat. Tidak ada averaging/outlier correction otomatis di dalam batch.

19.8 Calibration Persistence dan Warning Age

Calibration terakhir tetap digunakan sebagai calibration aktif sampai ada calibration baru yang valid. Tidak ada expiry otomatis yang membuat batch gagal hanya karena umur calibration.

Namun UI wajib memberikan warning berdasarkan umur calibration:

Umur calibration terakhir

UI status

Makna

< 7 hari

normal

Calibration masih digunakan tanpa warning

>= 7 hari dan < 10 hari

WARNING KUNING

Calibration sudah 1 minggu dan disarankan melakukan calibration ulang

>= 10 hari

WARNING ORANGE

Calibration sudah 10 hari; user harus mendapat peringatan lebih kuat

Warning tersebut tidak mengubah coefficient secara otomatis dan tidak menggagalkan batch. Batch tetap menggunakan calibration terakhir yang valid, sesuai aturan snapshot batch.

Perhitungan umur

UI/ESP32 menghitung umur dari:

currentTime - calibratedAt

Batas warning harus menggunakan timestamp aktual, bukan jumlah batch.

19.9 Calibration Safety

Calibration harus dapat dibatalkan sebelum/during execution.

Calibration tidak boleh berjalan jika kondisi safety/interlock yang relevan tidak terpenuhi.

19.10 Unit Rule

UI memasukkan:

measuredVolumeMl

ESP32 menyimpan coefficient sebagai basis runtime.

UI tidak perlu mengetahui durasi runtime fisik untuk menjalankan dosing normal.

20. Configuration vs Runtime State

Configuration menjawab:

Apa yang seharusnya dilakukan?

Runtime menjawab:

Apa yang sedang dilakukan ESP32 sekarang?

Contoh configuration:

{
  "time": "15:00",
  "rawWaterMl": 20000,
  "dosing": {
    "A": 20,
    "B": 20,
    "N": 20
  }
}

Contoh runtime:

{
  "batchId": "batch-20260913-0001",
  "runtimeState": "DOSING",
  "activeChannel": "B",
  "rawWaterActualMl": 15420,
  "rawWaterTargetMl": 20000
}

UI harus menampilkan runtime state dari ESP32, bukan menciptakan physical state sendiri.

Audit repository juga menegaskan queue dan actuator state seharusnya berasal dari ESP32 runtime, sedangkan UI saat ini masih memiliki mock/simulation paths. fileciteturn5file2L143-L150

21. Resource Rules

21.1 Central Dosing

Central dosing adalah resource execution serial.

ONE ACTIVE CENTRAL DOSING SEQUENCE AT A TIME

Tidak ada simultaneous central dosing untuk batch berbeda.

21.2 GH Fertigation Pumps

GH fertigation pumps merupakan resource per-GH.

GH-A pump
GH-B pump
GH-C pump

dapat bekerja bersamaan sesuai safety dan hardware availability.

21.3 Raw Water

Raw-water supply operation dapat berlangsung independen dari fertigation operation.

Dalam batch mixing, raw water tetap menjadi bagian batch yang sama dengan dosing.

22. Hardware Optionality

22.1 GH tanpa Routing Valve

Jika Complex hanya mempunyai 1 GH atau topology tidak membutuhkan routing valve tertentu, valve tidak boleh dipaksakan menjadi komponen wajib secara software.

ESP32 harus membaca inventory/configuration.

Jika valve tersebut benar-benar tidak ada:

skip valve action

hanya apabila topology fisik tetap valid dan aman tanpa valve tersebut.

22.2 Safety

Absence of valve tidak boleh digunakan untuk melewati physical safety requirement yang memang membutuhkan isolation valve.

23. Runtime State Diagram

23.1 Mixing

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

Failure path:

any active state
      ↓
BATCH_FAILED

Cancel path:

any cancellable state
      ↓
BATCH_CANCELLED

Emergency path:

any active state
      ↓
EMERGENCY_STOP

23.2 Fertigation

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

24. UI Schedule Lifecycle

UI harus menggunakan pola:

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

Untuk delete GH:

READ ALL SCHEDULES
       ↓
remove all schedules for GH-X
       ↓
submit COMPLETE UPDATED SNAPSHOT

Tidak boleh hanya mengirim:

{
  "deleteScheduleId": "fert-x-001"
}

sebagai source of truth configuration utama.

25. Event Payload Minimum

Contoh generic event:

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

Failure example:

{
  "eventId": "evt-009",
  "eventType": "BATCH_FAILED",
  "batchId": "batch-20260913-0001",
  "scheduleId": "fert-001",
  "ghId": "gh-a",
  "reasonCode": "FLOW_TIMEOUT",
  "timestamp": "2026-09-13T15:07:20+07:00"
}

Exact event schema/error-code catalog belum dibekukan.

26. Current Endpoint Status

Repository saat ini memiliki generic configuration endpoint pada direct ESP32 client:

GET /api/v1/configuration
POST /api/v1/configuration/validate
PUT /api/v1/configuration

Repository tidak menunjukkan tiga endpoint schedule terpisah khusus:

/well-pump-schedule
/mixing-schedule
/fertigation-schedule

Jadi secara transport saat ini, ketiga scheduling domain dapat berada dalam schedules[] pada generic configuration endpoint.

Audit repository juga menunjukkan current direct ESP32 client mencakup configuration, validate, telemetry, events, command status, clock sync, dan emergency stop, tetapi keberadaan client path bukan bukti server endpoint sudah deployed/correct. fileciteturn5file1L94-L110

27. Communication Flow

27.1 Schedule

UI
 ↓
ESP32
 ↓
UI
 ↓
Python

Tujuannya:

ESP32 menerima konfigurasi runtime;

UI menampilkan result/state;

Python menyimpan + menganalisis.

27.2 Event Log

ESP32
 ↓
UI
 ↓
Python
 ↓
save + analysis

27.3 Backlog setelah reconnect

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

Event ongoing tidak boleh dihapus hanya karena sudah satu kali dibaca UI.

28. Example — Full Mixing Timeline

Misal:

GH = gh-a
Schedule = 15:00
Raw water target = 20.000 mL
Threshold = 20%
A = 20 mL
B = 20 mL
N = 20 mL

Timeline:

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

Dosing order harus tetap serial walaupun raw water terus berjalan selama sequence tersebut.

29. Example — Well Pump Scheduled

{
  "id": "wp-001",
  "type": "well_pump",
  "enabled": true,
  "time": "06:00",
  "to-time": "06:01"
}

Interpretasi:

06:00 START
06:01 STOP

Tidak ada instruction:

06:00 START
→ continue until full

Stop schedule ditentukan eksplisit oleh to-time.

30. Example — Well Pump Manual

10:00 USER MANUAL ON
10:00 pump ON
10:07 USER STOP
10:07 pump OFF

atau:

10:00 USER MANUAL ON
10:15 automatic maximum duration reached
10:15 pump OFF

Manual action tidak mengubah schedule otomatis.

31. Example — Delete GH and Rebuild Snapshot

Initial:

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

Delete gh-x di UI:

read all schedule
→ remove fert-x-001
→ remove fert-x-002
→ retain wp-001
→ retain fert-a-001
→ submit complete schedules[]

Result:

{
  "complexId": "complex-001",
  "configurationVersion": 18,
  "schedules": [
    {"id":"wp-001","type":"well_pump","time":"06:00","to-time":"06:01"},
    {"id":"fert-a-001","type":"fertigation","ghId":"gh-a","time":"15:00"}
  ]
}

32. Failure and Cancellation Rules

32.1 BATCH_FAILED

Gunakan ketika batch tidak dapat mencapai normal terminal state.

Contoh penyebab yang dapat didefinisikan kemudian:

FLOW_TIMEOUT
PUMP_FAULT
DOSING_TIMEOUT
SENSOR_FAULT
CONFIG_INVALID
RESOURCE_FAULT

Daftar error code final belum dibekukan.

32.2 BATCH_CANCELLED

Digunakan jika batch dibatalkan oleh command/control flow yang valid.

32.3 EMERGENCY_STOP

Emergency stop mempunyai prioritas atas normal runtime.

NORMAL RUN
   ↓
EMERGENCY_STOP
   ↓
actuator stop sesuai safety policy

Event harus dicatat dan dipertahankan untuk audit/persistence.

33. Acceptance Criteria — Well Pump

AC-WP-01

Schedule mempunyai time START dan to-time STOP.

AC-WP-02

Pompa tidak berjalan tanpa batas karena schedule.

AC-WP-03

Manual ON tersedia melalui controller fisik.

AC-WP-04

Manual ON tersedia melalui web app.

AC-WP-05

Manual ON maksimum 15 menit.

AC-WP-06

Manual STOP melalui web app harus mematikan command runtime.

AC-WP-07

Toggle fisik STOP harus dapat mematikan operasi manual.

AC-WP-08

Radar 220V menjadi physical cutoff terpisah dari ESP32.

34. Acceptance Criteria — Batch Mixing

AC-MIX-01

Raw water selalu menjadi operasi pertama dalam batch.

AC-MIX-02

Dosing tidak boleh start sebelum actual raw water mencapai threshold configured.

AC-MIX-03

Threshold 20% bukan konstanta firmware dan dapat diubah di UI.

AC-MIX-04

Threshold ditentukan dari actual flow-meter volume.

AC-MIX-05

Raw water tetap menjadi bagian batch setelah dosing dimulai.

AC-MIX-06

Dosing central harus serial.

AC-MIX-07

Tidak ada central dosing execution simultan antar-batch.

AC-MIX-08

Mixing complete hanya jika seluruh required volume selesai.

AC-MIX-09

Batch complete menghasilkan READY.

AC-MIX-10

Batch READY menunggu schedule fertigation.

35. Acceptance Criteria — Fertigation

AC-FERT-01

Fertigation merupakan runtime operation terpisah dari mixing.

AC-FERT-02

Batch READY dapat menunggu schedule.

AC-FERT-03

Jika schedule tiba sebelum READY, event delay dicatat.

AC-FERT-04

Distribution dimulai segera setelah batch ready ketika scheduled execution sudah due.

AC-FERT-05

Distribution berhenti karena lower-boundary sensor.

AC-FERT-06

Fertigation pump GH berbeda boleh berjalan bersamaan.

AC-FERT-07

UI tidak menggunakan local countdown sebagai source of physical truth.

36. Acceptance Criteria — Calibration

AC-CAL-01

Calibration menerima durasi test dalam detik.

AC-CAL-02

Pilihan minimum yang didukung: 10, 20, atau 39 detik.

AC-CAL-03

Actual output volume dicatat dalam mL.

AC-CAL-04

ESP32 menghitung basis mL/s dari calibration.

AC-CAL-05

Setiap dosing channel memiliki calibration sendiri.

AC-CAL-06

Raw filter yang memakai volumetric pump juga memiliki calibration sendiri.

AC-CAL-07

Calibration baru memiliki timestamp/version.

AC-CAL-08

Coefficient terbaru yang valid menjadi coefficient aktif.

AC-CAL-09

Setiap batch wajib menyimpan calibration snapshot untuk seluruh dosing component yang digunakan.

AC-CAL-10

Batch tidak boleh dibuat/started jika calibration yang dibutuhkan tidak tersedia.

AC-CAL-11

UI memiliki hardcoded mandatory calibration guard dan alert yang eksplisit sebelum batch dikirim.

AC-CAL-12

ESP32 melakukan validasi calibration secara independen sebelum actuator dosing dijalankan.

AC-CAL-13

Batch menggunakan calibration snapshot yang immutable selama lifecycle batch.

AC-CAL-14

Calibration terakhir tetap digunakan sampai calibration baru yang valid tersedia.

AC-CAL-15

UI memberikan WARNING KUNING mulai umur calibration 7 hari.

AC-CAL-16

UI memberikan WARNING ORANGE mulai umur calibration 10 hari.

AC-CAL-17

Warning umur calibration tidak otomatis menggagalkan batch.

AC-CAL-18

UI tidak menghitung runtime actuator untuk normal dosing; ESP32 menghitung runtime berdasarkan calibration snapshot batch.

37. Acceptance Criteria — Event and Persistence

AC-EVT-01

UI menampilkan MIXING_QUEUED.

AC-EVT-02

UI menampilkan MIXING_CREATED.

AC-EVT-03

UI menampilkan FERTIGATION_START.

AC-EVT-04

UI menampilkan FERTIGATION_DELIVERED.

AC-EVT-05

UI menampilkan BATCH_FAILED.

AC-EVT-06

UI menampilkan BATCH_CANCELLED.

AC-EVT-07

UI menampilkan EMERGENCY_STOP.

AC-EVT-08

Event diteruskan dari ESP32 → UI → Python.

AC-EVT-09

Python menyimpan dan menganalisis event.

AC-EVT-10

Backlog dikirim setelah Python reconnect.

AC-EVT-11

Manual sync dari UI dapat meminta backlog/event transfer.

AC-EVT-12

Event ongoing tidak dihapus sebelum batch selesai/terminal.

AC-EVT-13

ESP32 dapat menghapus event yang sudah acknowledged sesuai final retention contract.

38. Acceptance Criteria — Configuration

AC-CFG-01

Semua create/edit/delete/enable/disable schedule menggunakan full snapshot.

AC-CFG-02

ESP32 validate full snapshot sebelum apply.

AC-CFG-03

Configuration apply bersifat atomic.

AC-CFG-04

Invalid snapshot tidak mengganti last valid configuration.

AC-CFG-05

Delete GH menghapus seluruh schedule yang terkait GH tersebut.

AC-CFG-06

to-time digunakan sebagai STOP time untuk well pump schedule.

AC-CFG-07

Threshold mixing dapat diatur dari UI.

39. Rules yang Tidak Boleh Disalahartikan

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

40. TO BE CONTINUED — UI → Python

Bagian berikut masih harus diformalisasi pada dokumen komunikasi berikutnya:

endpoint/UI gateway untuk forward schedule ke Python;

endpoint/UI gateway untuk forward event;

format ACK Python terhadap event yang sudah persisted;

mekanisme deduplication event;

batch log aggregation;

retry dan idempotency;

exact authentication direct UI → ESP32;

exact Python → ESP32 path bila digunakan untuk reconciliation;

conflict handling configuration version;

offline/reconnect acknowledgement protocol.

Audit repository sendiri telah mengidentifikasi kebutuhan configuration version, command IDs, idempotency, reconciliation, telemetry, dan offline/recovery semantics sebagai hal yang perlu diformalisasi sebelum implementation contract final. fileciteturn5file5L202-L221

41. Status Implementasi Saat Ini

Dokumen ini adalah operational specification dan bukan bukti bahwa semua behavior sudah ada di codebase.

Repository audit menyatakan:

active UI masih banyak memakai local/mock state;

API client yang ada belum berarti server endpoint sudah tersedia;

current UI service graph belum melakukan physical HTTP communication pada jalur aktif;

runtime telemetry/progress saat ini masih simulated;

queue/schedule semantics masih perlu digantikan dengan runtime truth dari device.

Hal tersebut harus diperlakukan sebagai kondisi codebase saat ini, sedangkan aturan pada Section 3–39 adalah target behavior yang harus diimplementasikan.

Audit current endpoint inventory menunjukkan direct ESP32 client telah memiliki configuration, validate, telemetry, events, command status, clock-sync, dan emergency-stop paths, tetapi belum terdapat endpoint schedule terpisah berdasarkan tiga domain yang didefinisikan di sini. fileciteturn5file1L94-L110

42. Reference Repository

Dokumen ini menggunakan audit repository CODEBASE_COMMUNICATION_AUDIT(1).md sebagai baseline kondisi codebase, terutama untuk:

current API inventory; fileciteturn5file1L76-L110

mock/local runtime limitation; fileciteturn5file1L113-L130

ESP32 runtime/event responsibility; fileciteturn5file5L482-L498

Python persistence/control-plane proposal; fileciteturn5file2L182-L200

command/version/idempotency requirements for future contract. fileciteturn5file5L202-L221

43. Final Operational Summary

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

Core rule: raw water and dosing adalah satu batch. Raw water selalu mulai terlebih dahulu. Setelah actual raw-water volume mencapai threshold yang dapat diatur dari UI, dosing dilakukan secara serial sampai seluruh batch complete. Setelah batch READY dan waktu schedule tiba, fertigation pump GH menyalurkan batch sampai lower-boundary sensor ter-trigger. Fertigation antar-GH dapat berjalan bersamaan; central dosing tidak.

23. Hardware Inventory Configuration

23.1 Tujuan

ESP32 harus memiliki daftar komponen hardware yang menggambarkan hardware fisik yang benar-benar dipasang pada Complex tersebut.

Inventaris ini dikelola secara dinamis melalui antarmuka UI Super Administrator dan direplikasi secara konsisten ke seluruh controller menggunakan System Topology Pool. Inventaris ini mendukung konfigurasi native (Channel A pada GPIO 5, Channel B pada GPIO 6) serta ekspansi I2C hingga 7 saluran dosing (Channel A s/d G atau N).

Inventory ini menjadi dasar bagi ESP32 untuk mengetahui:

Complex yang dikendalikan;

GH yang tersedia;

dosing pump yang tersedia;

dosing valve yang tersedia;

raw-water pump;

raw-water flow meter;

mixing/batch tank;

fertigation/distribution pump setiap GH;

valve setiap GH bila memang terpasang;

sensor yang tersedia;

channel GPIO/device address yang digunakan hardware.

23.2 Prinsip Inventory

Inventory menggambarkan hardware fisik, sedangkan schedules[] menggambarkan apa yang harus dilakukan hardware tersebut.

HARDWARE INVENTORY
        ↓
validasi topology
        ↓
SCHEDULE CONFIGURATION
        ↓
ESP32 RUNTIME

Schedule tidak boleh menunjuk ke hardware yang tidak ada dalam inventory.

23.3 Proposal Struktur JSON Inventory

Struktur awal yang diusulkan:

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

23.3.1 Dosing Channel

Channel dosing dapat berupa:

A
B
N

atau channel lain yang ditetapkan inventory final.

Nama channel harus konsisten antara:

inventory;

schedule;

calibration;

runtime;

telemetry;

event log.

23.4 Hardware Inventory adalah Static Device Data

23.4 Hardware Inventory adalah Dynamic Device Registry

Hardware Inventory dikelola secara dinamis melalui System Topology Pool:

User/Admin mendaftarkan hardware fisik di UI
        ↓
System Topology Pool memetakan GPIO / channel / I2C bus
        ↓
Mutasi pool dikirim ke ESP32 (/api/v1/topology-pool/mutate)
        ↓
ESP32 menerapkan pemetaan ke hardware registry NVS
        ↓
ESP32 menyediakan GET /api/v1/inventory

ESP32 tidak boleh mengklaim hardware ada hanya karena UI membuat object component tanpa komisioning yang valid.

23.5 Sinkronisasi Inventory ke UI

Pada menu Configuration di UI, user dapat menjalankan:

SYNC UI ↔ ESP32

UI meminta inventory terbaru dari ESP32 untuk memvalidasi ketersediaan aktuator fisik.

Model:

UI Configuration
      ↓
GET inventory ESP32
      ↓
ESP32 → inventory JSON
      ↓
UI in-memory state

23.6 First Load / Rehidrasi In-Memory

Ketika UI pertama kali dibuka atau halaman di-reload:

Browser launch / Page reload
   ↓
Discover aktif dari kontroler / backend
   ↓
GET /api/v1/inventory
   ↓
ESP32 returns inventory
   ↓
UI memuat ke in-memory context

23.7 Browser State adalah Strictly Ephemeral In-Memory View

Mengikuti mandat PRD (Section 1.2):
Browser state bersifat strictly ephemeral (hanya di memori runtime JavaScript). Tidak ada topologi fisik, konfigurasi jadwal, atau status hardware otoritatif yang disimpan di cookies, localStorage, atau IndexedDB.

Sumber kebenaran data fisik berada di ESP32 NVS dan database operasional backend. Membersihkan cache browser atau membuka UI dari perangkat lain tidak akan menyebabkan kehilangan konfigurasi atau data controller.

Jika terjadi perbedaan:
ESP32 adalah physical authority
UI selalu melakukan sinkronisasi rehidrasi dari ESP32 / backend.

24. Configuration Synchronization

24.1 User-Initiated Sync

Dari menu Configuration:

USER CLICK SYNC
      ↓
GET inventory
      ↓
GET configuration
      ↓
GET calibration/status jika diperlukan
      ↓
UI update browser state

Tujuannya agar UI mengetahui:

hardware apa yang benar-benar ada;

configuration version yang diterapkan ESP32;

schedule aktif;

calibration aktif;

runtime mapping.

24.2 Full Configuration Sync

Saat user menyimpan perubahan schedule:

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

25. Scheduling & Mechanical Control API Endpoints

25.1 Current Endpoint Boundary

Repository saat ini sudah memiliki client untuk endpoint berikut:

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

Audit menegaskan bahwa keberadaan method tersebut di client belum membuktikan server endpoint sudah deployed/benar, dan active UI saat ini belum menggunakan client tersebut. fileciteturn5file1L76-L112

25.2 Logical Scheduling Domains vs HTTP Endpoints

WELL_PUMP, MIXING, dan FERTIGATION adalah logical scheduling/runtime domains.

Mereka tidak harus memiliki tiga HTTP endpoint configuration yang terpisah.

Configuration schedule tetap dikirim sebagai full snapshot melalui:

POST /api/v1/configuration/validate
PUT  /api/v1/configuration

type di dalam schedules[] membedakan domain.

Contoh:

{
  "type": "well_pump"
}

atau:

{
  "type": "fertigation"
}

ESP32 kemudian membentuk runtime MIXING dan FERTIGATION dari fertigation schedule.

26. Endpoint: UI → ESP32

26.1 GET /api/v1/inventory

Tujuan

Meminta daftar hardware yang benar-benar terdaftar pada ESP32.

Request

GET /api/v1/inventory

Response proposal

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

UI menyimpan response tersebut ke browser state.

27. Endpoint: GET /api/v1/configuration

Tujuan

UI meminta configuration snapshot yang sedang aktif di ESP32.

Response proposal

{
  "complexId": "complex-a",
  "configurationVersion": 17,
  "appliedAt": "2026-09-12T23:00:00+07:00",
  "schedules": []
}

UI harus menggunakan configurationVersion untuk mengetahui apakah browser state masih sama dengan ESP32.

28. Endpoint: POST /api/v1/configuration/validate

Tujuan

Memeriksa snapshot baru sebelum diterapkan.

Request

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

Validation minimal

ESP32 harus memeriksa:

complexId cocok;

schedule type valid;

GH yang dirujuk ada;

hardware yang diperlukan tersedia;

volume tidak negatif;

threshold valid;

time dan to-time valid untuk well pump;

calibration tersedia untuk dosing yang digunakan;

tidak ada configuration conflict;

tidak ada topology violation;

schedule tidak menghasilkan execution yang tidak mungkin dilakukan hardware.

Response proposal — valid

{
  "valid": true,
  "complexId": "complex-a",
  "baseConfigurationVersion": 17,
  "validatedConfigurationVersion": 18,
  "errors": [],
  "warnings": []
}

Response proposal — resource missing (BLOCKED status, jadwal tetap disimpan)

{
  "valid": true,
  "complexId": "complex-a",
  "baseConfigurationVersion": 17,
  "validatedConfigurationVersion": 18,
  "scheduleStates": [
    {
      "id": "wp-001",
      "activationState": "ACTIVE",
      "blockedReasons": []
    },
    {
      "id": "fert-001",
      "activationState": "BLOCKED",
      "blockedReasons": ["GH_NOT_FOUND"]
    }
  ],
  "warnings": [
    "Schedule fert-001 disimpan dengan status BLOCKED karena target GH belum terpasang di topologi aktif."
  ]
}

Response proposal — syntax/structural error (INVALID, ditolak)

{
  "valid": false,
  "complexId": "complex-a",
  "errors": [
    {
      "code": "NEGATIVE_VOLUME",
      "path": "schedules[1].rawWaterMl",
      "message": "Volume air baku tidak boleh bernilai negatif"
    }
  ],
  "warnings": []
}

29. Endpoint: PUT /api/v1/configuration

Tujuan

Menerapkan full configuration snapshot ke ESP32.

Request

Payload pada dasarnya sama dengan hasil validation.

Behavior

receive full snapshot
      ↓
validate
      ↓
check version
      ↓
atomic apply
      ↓
new configuration active

Jika gagal:

old configuration remains active

ESP32 tidak boleh menerapkan setengah snapshot.

Response proposal

{
  "accepted": true,
  "complexId": "complex-a",
  "configurationVersion": 18,
  "appliedAt": "2026-09-13T00:15:00+07:00",
  "activeScheduleCount": 4
}

30. Endpoint: GET /api/v1/telemetry

Tujuan

UI meminta keadaan fisik/runtime terbaru ESP32.

Response minimal terkait scheduling/mechanical control

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

Actual field names dapat disesuaikan dengan final telemetry contract.

31. Endpoint: GET /api/v1/events

Tujuan

Mengambil event log yang dihasilkan ESP32.

Response proposal

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

Event wajib minimal:

MIXING_QUEUED
MIXING_CREATED
FERTIGATION_START
FERTIGATION_DELIVERED
BATCH_FAILED
BATCH_CANCELLED
EMERGENCY_STOP

32. Endpoint: GET /api/v1/commands/{commandId}

Digunakan UI untuk memeriksa status command yang membutuhkan acknowledgement/status.

Contoh response:

{
  "commandId": "cmd-001",
  "status": "COMPLETED",
  "acceptedAt": "2026-09-13T15:00:00+07:00",
  "completedAt": "2026-09-13T15:04:12+07:00"
}

33. Endpoint: POST /api/v1/commands/emergency-stop

Emergency stop adalah physical runtime command, bukan schedule configuration.

Request proposal

{
  "commandId": "cmd-estop-001",
  "reason": "operator_request"
}

Response proposal

{
  "accepted": true,
  "commandId": "cmd-estop-001",
  "state": "EMERGENCY_STOP"
}

ESP32 menghasilkan event:

EMERGENCY_STOP

34. Manual Well Pump Control Endpoint

TO BE CONTINUED — exact endpoint contract.

Logical command yang dibutuhkan UI:

WELL_PUMP_MANUAL_START
WELL_PUMP_MANUAL_STOP

Payload proposal:

{
  "commandId": "cmd-wp-001",
  "type": "well_pump_manual_start",
  "maxRuntimeSec": 900
}

ESP32 wajib membatasi manual ON maksimum 900 detik (15 menit), walaupun request mencoba memberikan nilai lebih besar.

STOP dapat dikirim secara eksplisit sebelum timeout.

35. Calibration API

35.1 Calibration adalah Data Hardware, bukan Schedule

Calibration tidak dimasukkan ke schedules[].

Calibration merupakan configuration/runtime support data yang digunakan ESP32 untuk menerjemahkan target mL menjadi ON time.

35.2 GET /api/v1/calibration

Response proposal

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

35.3 POST /api/v1/calibration/start

Request proposal:

{
  "calibrationId": "cal-a-new",
  "pumpId": "dp-a-001",
  "channel": "A",
  "testDurationSec": 20
}

Allowed test duration:

10
20
39

ESP32 menjalankan pump selama durasi tersebut lalu berhenti.

35.4 POST /api/v1/calibration/result

Setelah volume aktual diukur:

{
  "calibrationId": "cal-a-new",
  "pumpId": "dp-a-001",
  "channel": "A",
  "testDurationSec": 20,
  "measuredVolumeMl": 100
}

ESP32 menghitung:

flowRateMlPerMin = (measuredVolumeMl / testDurationSec) * 60

dan menyimpan hasil calibration baru.

35.5 Calibration Result Response

{
  "accepted": true,
  "calibration": {
    "calibrationId": "cal-a-new",
    "channel": "A",
    "testDurationSec": 20,
    "measuredVolumeMl": 100,
    "flowRateMlPerMin": 300,
    "calibratedAt": "2026-09-13T00:30:00+07:00",
    "version": 4,
    "active": true
  }
}

35.6 Last Calibration

UI harus menampilkan minimal:

Pump/channel
Last calibration ID
Last calibration date/time
Test duration
Measured volume
Calculated ml/min
Calibration version
Active/inactive

Contoh:

Dosing A
Last calibration: 2026-09-13 00:30
Test: 20 sec
Measured: 100 mL
Rate: 300.0 ml/min (5.0 mL/s)
Version: 4
Status: ACTIVE

35.7 Runtime Conversion

Jika calibration aktif:

runtimeSec = (targetMl / flowRateMlPerMin) * 60

ESP32 kemudian menerapkan runtime actuator sesuai resolution/timing firmware.

Contoh:

Target A = 20 mL
Calibration A = 5 mL/s

runtime = 20 / 5
        = 4 seconds

ESP32 tetap mencatat target dan actual yang dapat diukur.

36. Calibration Persistence

ESP32 harus menyimpan calibration aktif agar schedule tetap dapat berjalan tanpa koneksi UI/Python.

Minimal yang harus survive reboot:

active calibration
calibration version
calibration timestamp
pump/channel mapping

UI menyimpan salinan calibration terakhir di browser state untuk display dan reconciliation.

Python nantinya menyimpan history calibration untuk analysis.

37. Schedule → UI → Python

TO BE CONTINUED — UI → Python

Untuk scheduling, arah data yang ditetapkan:

ESP32 → UI → Python

Data yang diteruskan:

active schedule snapshot
configurationVersion
schedule execution information
batchId
runtime status

Python menyimpan dan menganalisis data tersebut.

ESP32 tetap menjadi scheduler runtime.

38. Event Log → UI → Python

Arah event:

ESP32
  ↓
UI
  ↓
Python
  ↓
save + analysis

UI tidak mengubah eventType, batchId, timestamp, atau semantic state ESP32.

Python dapat menambahkan metadata analysis tanpa mengubah original event.

39. Scheduled Backlog / Reconnect

Jika Python tidak terhubung ketika schedule/event terjadi:

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

User juga dapat menekan tombol manual Sync pada UI untuk memulai proses tersebut.

39.1 Event Deletion

Setelah event telah berhasil diteruskan:

ESP32 → UI → Python

dan terdapat acknowledgement persistence dari Python melalui contract yang akan ditentukan, ESP32 dapat menghapus event yang sudah acknowledged.

Namun:

ONGOING BATCH

tidak boleh kehilangan batch context/log yang masih diperlukan untuk menyelesaikan lifecycle.

Contoh:

MIXING_CREATED
      ↓
DOSING ACTIVE
      ↓
FERTIGATION_START
      ↓
FERTIGATION_DELIVERED

Record batch tetap dipertahankan sampai lifecycle selesai dan retention/acknowledgement terpenuhi.

40. Example Full Operational Flow

40.1 Configuration

User membuat schedule:

GH-A
15:00
Raw water = 20,000 mL
A = 20 mL
B = 20 mL
N = 20 mL
Raw-water start threshold = 20%

UI membuat full snapshot:

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

40.2 Batch Created

ESP32:

MIXING_CREATED

40.3 Raw Water

Target:

20,000 mL

Threshold:

20%

Maka dosing threshold:

4,000 mL

Sequence:

RAW WATER START
      ↓
actual = 4,000 mL
      ↓
threshold reached

40.4 Dosing Serial

Setelah threshold tercapai:

A START
A COMPLETE
      ↓
B START
B COMPLETE
      ↓
N START
N COMPLETE

Raw water tetap berjalan sampai raw-water target tercapai.

Batch complete jika semua target batch selesai.

40.5 Ready

BATCH READY

Jika sekarang masih 14:40:

READY → WAITING_FOR_SCHEDULE

40.6 Fertigation

Pada 15:00:

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

40.7 Next Batch

Setelah fertigation batch selesai:

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

41. Operational Invariants

Firmware dan UI harus mempertahankan invariant berikut:

Satu fertigation preparation = satu batch.

Raw water dan dosing merupakan bagian batch yang sama.

Raw water selalu mulai sebelum dosing.

Dosing hanya boleh mulai setelah actual raw water mencapai threshold configurable.

Threshold tidak hardcoded di firmware.

Central dosing execution selalu serial.

Tidak ada dua batch yang menggunakan central dosing secara bersamaan.

Fertigation pump antar-GH boleh berjalan bersamaan.

Well pump schedule mendukung trigger waktu, hari, interval, target volume L, dan durasi detik atau to-time.

Well pump tidak boleh dijalankan terus tanpa batas melalui schedule.

Manual well pump maksimum 15 menit.

Radar 220V menjadi physical cutoff di luar ESP32.

UI input volume menggunakan mL.

ESP32 menerjemahkan mL → runtime menggunakan calibration (ml/min).

Raw-water completion ditentukan oleh actual flow meter.

Fertigation completion ditentukan oleh lower-level sensor.

Configuration schedule dikirim sebagai full snapshot.

Delete GH menghapus semua schedule yang mereferensikan GH tersebut.

Hardware inventory dikelola secara dinamis via System Topology Pool dan disinkronkan ke ESP32.

Browser state adalah strictly ephemeral in-memory view, bukan physical authority.

Event runtime berasal dari ESP32.

Event diteruskan ke Python melalui jalur relay UI (ESP32 → UI → Python).

Event/backlog tidak boleh hilang sebelum lifecycle dan acknowledgement terpenuhi.

Calibration aktif harus tersedia di ESP32 untuk dosing normal; jadwal tanpa kalibrasi disimpan dengan status BLOCKED.

Setiap batch wajib mempunyai calibration snapshot immutable.

Batch memakai calibration terakhir yang valid pada saat batch dibuat dan tidak berubah selama lifecycle batch.

Calibration umur >= 7 hari menghasilkan warning kuning di UI.

Calibration umur >= 10 hari menghasilkan warning orange di UI.

Tidak ada tolerance correction atau automatic expiry yang menggagalkan batch hanya karena umur calibration.

42. Acceptance Criteria

Hardware Inventory

ESP32 mempunyai hardware inventory dinamis yang disinkronkan via System Topology Pool.

Super Admin dapat mengelola komponen dan GPIO dari antarmuka UI.

GET /api/v1/inventory mengembalikan inventory aktif.

UI memuat inventory ke in-memory context saat discover/refresh.

Scheduling

Well pump mendukung trigger waktu, hari, dan interval berulang.

Well pump mendukung target volume liter dan durasi detik / to-time.

Manual well pump dapat START/STOP dan otomatis OFF maksimal 15 menit.

Radar 220V memutus pump secara fisik dan tidak bergantung pada ESP32 software interlock.

Fertigation schedule memiliki raw-water target dan dosing target.

Threshold raw-water configurable dari UI.

Mixing

Raw water + dosing adalah satu batch.

Raw water selalu start pertama.

Dosing baru start setelah threshold actual flow meter tercapai.

Raw water tetap dapat berjalan sampai target selesai.

Dosing serial dinamis mendukung hingga 7 saluran (A s/d G/N).

Tidak ada central dosing batch lain yang berjalan bersamaan.

Batch hanya READY setelah seluruh requirement selesai.

Fertigation

Fertigation menunggu batch READY.

Jika schedule datang sebelum READY, delivery dimulai segera setelah READY.

Fertigation pump antar-GH dapat berjalan bersamaan.

Distribution berhenti berdasarkan lower-level sensor.

Calibration

Test calibration mendukung 10/20/30 detik atau sampling wizard UI.

Actual output dicatat dalam mL.

ml/min dihitung dari hasil calibration: (measuredVolumeMl / samplingSec) * 60.

Calibration mempunyai version dan timestamp.

Calibration terakhir tersedia di UI.

ESP32 menggunakan calibration aktif (ml/min) untuk runtime dosing.

Setiap batch menyimpan calibration snapshot immutable.

Jadwal dengan kalibrasi/periferal belum lengkap disimpan sebagai BLOCKED (bukan ditolak) dan otomatis aktif saat siap.

UI memiliki mandatory calibration guard/alert dan badge amber BLOCKED.

Warning kuning muncul mulai 7 hari.

Warning orange muncul mulai 10 hari.

Calibration lama tetap usable sampai ada calibration baru yang valid.

Calibration dinamis hingga 7 saluran terpisah.

Event & Persistence

MIXING_QUEUED tercatat.

MIXING_CREATED tercatat.

FERTIGATION_START tercatat.

FERTIGATION_DELIVERED tercatat.

BATCH_FAILED tercatat.

BATCH_CANCELLED tercatat.

EMERGENCY_STOP tercatat.

Backlog event dikirim setelah koneksi tersedia.

Manual sync dapat meminta backlog.

Event ongoing tidak dihapus sebelum batch lifecycle selesai.

43. TO BE CONTINUED — UI → Python

Bagian berikut belum menjadi kontrak final dan akan ditentukan pada spesifikasi komunikasi berikutnya:

Endpoint UI → Python untuk save schedule.

Endpoint UI → Python untuk save event.

Endpoint UI → Python untuk save calibration history.

Python acknowledgement kepada UI/ESP32.

Event deduplication/idempotency.

Cursor/sequence number backlog.

Exact deletion acknowledgement dari Python ke ESP32.

Reconciliation ketika Python mempunyai configuration version berbeda dari ESP32.

Authentication untuk direct UI → ESP32.

Offline conflict resolution.

Untuk tahap ini, boundary yang sudah ditetapkan adalah:

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

44. Current Repository Note

Repository saat ini masih memiliki mock/local execution path. Audit menunjukkan active UI belum benar-benar menggunakan API client ESP32, sementara API client sudah memiliki endpoint configuration, inventory, telemetry, events, command status, clock sync, dan emergency stop. fileciteturn5file1L94-L112

Karena itu dokumen ini adalah target mechanical/control contract untuk implementasi berikutnya, bukan klaim bahwa seluruh endpoint di atas sudah aktif di server/ESP32 saat ini.

45. End of Current Specification

Dokumen ini membekukan mechanical scheduling model sampai bagian yang telah ditandai TO BE CONTINUED.

Prinsip utama:

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

46. Blocking Corrections & Hard Invariants (Safe Point SP-BLOCKING-CORRECTIONS-001)

1. Hard Guarantee: One Preparation Per GH
- GH eligibility is governed by `is_gh_occupied(gh_id)` checking the entire lifecycle:
  - Global Dosing Queue (`QUEUE_STATE_PENDING`, `QUEUE_STATE_DISPATCHED`, `QUEUE_STATE_ACTIVE`)
  - Today's Occurrences (`OCC_STATE_PREPARING`, `OCC_STATE_WAITING_BATCH`, `OCC_STATE_READY_TO_SEND`, `OCC_STATE_DISTRIBUTING`)
  - Physical Fertigation Runtime (`fertigation_mgr_is_batch_ready()`, active mixing/dosing)
  - Runtime Schedule Locks / Recovery Hold (`MARKER_RECOVERY_HOLD`)
- A new preparation can only be registered for GH-X after the previous batch reaches `OCC_STATE_COMPLETED` / `FERTIGATION_DELIVERED` or terminal abort.

2. Configuration Change Reconciliation
- Handled by `reconcile_dosing_queue_on_config_change(cfg_ver)`:
  - If physical dosing has NOT started: old queue registration is invalidated and occurrence state reset to `OCC_STATE_PENDING` with cleared correlation identifiers, preventing stranded `OCC_PREPARING` occurrences and enabling safe re-evaluation under config vN+1.
  - If physical dosing HAS started: active physical batch snapshot is strictly preserved to run safely to completion without mutation.
  - Completed occurrences (`OCC_STATE_COMPLETED`) are preserved and never replay.

3. Midnight / Day-Boundary Semantics
- Evaluated on calendar day change (`s_today_yday != tm_now.tm_yday`):
  - Case A (Queued-but-not-started): Purged from queue; does not silently become new day occurrence.
  - Case B (Physical dosing active): Preserved under original batch/occurrence identity to finish safely.
  - Case C (READY_TO_SEND batch exists): Preserved in mixing tank under original identity; blocks new preparations for that GH until delivered.
  - Case D (DELIVERY in progress): Preserved under original identity until lower float boundary trip.
  - Case E (COMPLETED from yesterday): Retired from today's active schedule array; marker in NVS prevents replay.

4. GPIO 18 Hardware Role Consistency
- GPIO 18 is mapped to `PIN_OUT_BUZZER` (active-high MOSFET gate driver stage for 5V DC active buzzer).
- `PIN_OUT_ERROR_LAMP` is unmapped (`-1`).

5. Lower Float & Safety Interlock Architecture
- Lower float dry-run boundary strictly gates `ACTUATOR_DIST_PUMP` (`PIN_OUT_DIST_PUMP` / GPIO 2).
- Raw water fill pumps (`WELL_PUMP` GPIO 1, `RAW_SUBMERSIBLE` GPIO 4) are unobstructed by lower float dry state to allow empty mixing tank filling.
- E-STOP (`s_emergency_stop_latched`) remains unconditionally dominant over all actuator commands and forces all outputs OFF.

47. Forensic Audit: Command Race, Power-Loss Missed Policy & Parallel Distribution (SP-FORENSIC-AUDIT-001)

1. Configuration Change vs command_mgr IPC Queue Race Guard
- Prior vulnerability: When scheduler queue HEAD transitions to `QUEUE_STATE_DISPATCHED`, `command_mgr_submit()` places `CMD_TYPE_FERTIGATION_BATCH` in the internal command queue. If configuration version updates before `fertigation_mgr` begins physical execution, invalidating the scheduler queue entry alone would leave a stale command in `command_mgr`'s IPC queue.
- Canonical Solution:
  1. Worker-level gate: In `command_worker_task()`, before executing any command, the worker verifies `cmd->configuration_version == cur_storage->config_version`. If a version mismatch is detected, the command is immediately aborted with status `CMD_STATUS_REJECTED` and error code `STALE_CONFIGURATION_VERSION`. No physical dosing or actuator start occurs.
  2. Queue invalidation: During `reconcile_dosing_queue_on_config_change()`, the scheduler formats the command ID (`cmd-q-XXXX`) and calls `command_mgr_cancel(cancel_cmd_id)` to cancel pending unstarted commands directly.
  3. Active batch preservation: Batches already physically started (`QUEUE_STATE_ACTIVE`) continue execution using their instantiated snapshot.

2. Missed Schedule After Long Power Loss
- Intentional and Approved Policy: An occurrence missed while the ESP32 was powered off is considered MISSED. It must NOT be automatically replayed after reboot. No arbitrary recovery windows are invented.
- Implementation: In `materialize_today_schedule()`, during boot or daily materialization:
  - If `now > occ_time` and the occurrence has not been recorded as completed in NVS markers, its state is marked `OCC_STATE_FAILED` and `MARKER_SKIPPED` in NVS.
  - It is NOT queued, NOT dosed, and NOT distributed.
  - Future valid occurrences (`now <= occ_time`) remain completely unaffected and execute normally.
  - Manual operator intervention may be used if recovery is desired.

3. Midnight / Day-Boundary Semantics (Five Canonical Cases)
- CASE A (Queued but unstarted): Purged from queue; does not silently execute or become new-day occurrence.
- CASE B (Physical dosing active): Retains original `batch_id` and `occurrence_id`; finishes physical batch safely.
- CASE C (READY_TO_SEND batch exists): Preserved in mixing tank under original occurrence identity; `is_gh_occupied()` blocks duplicate new preparations for that GH.
- CASE D (DELIVERY in progress): Preserved under original identity until lower float boundary trip.
- CASE E (Controller was OFF): Old occurrence marked MISSED / SKIPPED; new day future occurrences materialize normally.

4. Parallel Distribution Architectural Audit (Central Serial Dosing vs Per-GH Distribution)
- Architectural Requirement:
  - Central preparation resources (raw water fill, dosing A/B, mixing pump) are shared and must be strictly serialized (Global Dosing Queue FIFO).
  - Each GH has its own distribution pump. Once batches are `READY_TO_SEND`, multiple GHs (e.g. GH01 and GH02) must be allowed to distribute concurrently if both schedules are due.
- Audit Findings:
  - `fertigation_mgr.c` is currently implemented as a single-instance global state machine (`static fertigation_state_t s_state = FERT_STATE_IDLE;` and `static fertigation_batch_config_t s_batch;`).
  - When GH01 triggers distribution, `s_state` transitions to `FERT_STATE_DELIVERY`.
  - While in `FERT_STATE_DELIVERY`, `fertigation_mgr_trigger_distribution()` rejects subsequent calls with `ESP_ERR_INVALID_STATE` because it requires `s_state == FERT_STATE_MIX_READY`.
  - While in `FERT_STATE_DELIVERY`, `fertigation_mgr_start_from_json()` rejects new preparations with `ESP_ERR_INVALID_STATE` because it requires `s_state == FERT_STATE_IDLE`.
  - Therefore, the existing single-state design does not permit GH01 and GH02 to distribute concurrently, nor does it allow central dosing of GH02 while GH01 is distributing.
- Stopping & Reporting Mandate: In strict accordance with user directive 5, no large redesign is silently implemented. Minimal conflicting symbols and viable architectural corrections are reported for architectural alignment.

48. Parallel Multi-GH Distribution Implementation (SP-PARALLEL-DIST-001)

1. Architecture Overview: Decoupled Dosing vs Distribution
- Central Preparation Engine: Owns exclusively `PRECHECK` -> `FILLING` -> `DOSING` -> `FINAL_MIXING`.
  - Strictly serialized via Global Dosing Queue (FIFO). Only 1 preparation active at a time.
  - Controls shared resources: raw water pump (`PIN_OUT_RAW_WATER`), dosing channels A-N, mixing pump (`PIN_OUT_MIXING_PUMP`), and central routing valves.
- Per-GH Distribution Slots: Owns exclusively the delivery lifecycle (`READY_TO_SEND` -> `DISTRIBUTING` -> `COMPLETE` / `FAULTED`).
  - Managed in `delivery_slot_t s_delivery_slots[FERT_MAX_DELIVERY_SLOTS]`.
  - Independent per greenhouse. Multiple GH delivery slots may distribute concurrently without blocking.
  - GH01 distributing does NOT block GH02 distribution, nor does it block GH03 central dosing.

2. Central Resource Release at MIX_READY
- When `FINAL_MIXING` duration elapses:
  1. Central mixing pump, raw water pump, and dosing channels are shut OFF.
  2. Central routing valves are released.
  3. The prepared batch snapshot (identities, volumes, parameters, pump IDs) is transferred into an active per-GH delivery slot:
     - `slot->state = DELIVERY_SLOT_READY_TO_SEND;`
  4. Central fertigation engine transitions immediately to `FERT_STATE_IDLE`.
  5. The next Global Dosing Queue HEAD entry (`QUEUE_STATE_PENDING`) is dispatched immediately for central preparation without waiting for distribution.

3. Independent Distribution Trigger
- When `evaluate_today_occurrences()` runs:
  - If occurrence is due (`now >= scheduled_timestamp`) and matching batch is `READY_TO_SEND` in `s_delivery_slots`:
  - `fertigation_mgr_trigger_distribution(gh_id, occurrence_id)` is invoked.
  - Only that greenhouse's distribution pump (`slot->delivery_pump_id`) is acquired and energized.
  - `slot->state` transitions to `DELIVERY_SLOT_DISTRIBUTING`.
  - Central fertigation engine remains in `FERT_STATE_IDLE` (or continues preparing an unrelated batch).

4. Autonomous Per-Slot Delivery Monitor & Failure Isolation
- A single canonical monitor loop runs inside `fert_mgr` task iterating all active `s_delivery_slots`:
  - E-STOP Check: Shuts down all active delivery pumps and latches slots faulted.
  - Lower Float Dry Trip: Detects empty tank, turns OFF pump, logs `FERTIGATION_DELIVERED`, and transitions slot to `DELIVERY_SLOT_COMPLETE`.
  - Duration Mode / Volume Mode: Independently tracks elapsed time and accumulated flow meter volume for that slot.
  - Timeout / Fault Check: If flow fault or timeout occurs on GH01, only GH01's pump is turned OFF and only GH01's slot transitions to `DELIVERY_SLOT_FAULTED`. Unrelated healthy distributions (e.g. GH02) continue pumping undisturbed.

5. Isolated Occurrence Completion & Next-Preparation Chaining
- In `check_distribution_completions()`:
  - Each distributing occurrence queries its exact slot status via `fertigation_mgr_get_delivery_slot_status(occ->gh_id, occ->occurrence_id, &slot_st)`.
  - `DELIVERY_SLOT_COMPLETE`: Marks exact occurrence `OCC_STATE_COMPLETED`, updates schedule marker in NVS, acknowledges slot via `fertigation_mgr_acknowledge_delivery()`, and chains the next pending preparation ONLY for that `gh_id`.
  - `DELIVERY_SLOT_FAULTED`: Marks exact occurrence `OCC_STATE_FAILED` and acknowledges slot.

6. API & UI Telemetry Projection
- `/api/v1/fertigation/status` and `/api/v1/fertigation/queue` return:
  - `todaySchedule`: Array of all today's occurrences, each reflecting independent `DISTRIBUTING` states concurrently.
  - `activeDeliveries`: Dedicated array projecting all currently active delivery slots (`ghId`, `occurrenceId`, `batchId`, `status`, `deliveryPumpId`).
  - `queuedBatches`: Array of Global Dosing Queue entries serialized for central preparation.
  - If central dosing is IDLE but delivery slots are active, `runtimeState` projects `DISTRIBUTING`.
  - TFT Home Screen detects active delivery slots (`fertigation_mgr_get_active_delivery_count() > 0`) and renders `"RUNNING"`.

49. Dosing Pump 3-Stage Progressive Calibration Specification (SP-FERT-CALIB-003)

1. Architecture & Operating Modes
- The dosing pump calibration engine supports two distinct operational modes:
  - 1× Single Measurement Mode: Operator selects a single test duration (10s, 30s, or 60s) for rapid check or ad-hoc verification.
  - 3× Progressive Measurement Mode: A rigorous 3-stage consecutive measurement protocol designed to test pump linearity and volumetric consistency across operating durations.

2. Sequential Workflow (10s → 30s → 60s)
- Stage 1 (10 Seconds):
  - Physical pump actuates for exactly 10.0 seconds.
  - Operator records collected volume $V_1$ (ml).
  - Independent flow rate: $Q_1 = \frac{V_1}{10} \times 60$ ml/min.
- Stage 2 (30 Seconds):
  - Physical pump actuates for exactly 30.0 seconds.
  - Operator records collected volume $V_2$ (ml).
  - Independent flow rate: $Q_2 = \frac{V_2}{30} \times 60$ ml/min.
- Stage 3 (60 Seconds):
  - Physical pump actuates for exactly 60.0 seconds.
  - Operator records collected volume $V_3$ (ml).
  - Independent flow rate: $Q_3 = \frac{V_3}{60} \times 60$ ml/min.

3. Consistency Validation & Acceptance Criteria
- Reference Rate: Median of $\{Q_1, Q_2, Q_3\}$ to eliminate single-outlier distortion.
- Deviation Metric: Percentage deviation of each stage against median reference:
  $$\text{Dev}_i (\%) = \frac{|Q_i - Q_{\text{median}}|}{Q_{\text{median}}} \times 100$$
- Maximum Tolerance: Defined by `DOSING_CALIBRATION_CONSISTENCY_TOLERANCE_PCT = 10.0%`.
- Outcome Evaluation:
  - PASS (Consistent): All stages have $\text{Dev}_i \le 10.0\%$.
    - Final Aggregated Flow Rate: Weighted total duration formula $Q_{\text{final}} = \frac{V_1 + V_2 + V_3}{10 + 30 + 60} \times 60$.
    - Operator may save the verified flow rate to ESP32 NVS memory.
  - FAIL (Inconsistent): Any stage has $\text{Dev}_i > 10.0\%$.
    - System strictly blocks saving the calibration to prevent fertigation dosage inaccuracies.
    - Operator is presented with troubleshooting steps (air bubbles, tubing blockage, supply voltage ripple) and prompted to repeat testing from Stage 1.
    - Previous active calibration in NVS is strictly preserved.

50. Dosing Pump Test Run & Volumetric Verification Specification (SP-FERT-TESTRUN-001)

1. Purpose & Scope
- Provides an operational verification mechanism (Test Run / Bump Test) on fertigation pump cards to verify physical responsiveness, prime pump tubing, and validate dispensed liquid volume without altering stored calibration values.

2. Duration Presets & Target Volume Estimation
- Presets available:
  - 10 Seconds (Uji Cepat / Priming): Verification of motor rotation and tube priming.
  - 30 Seconds (Uji Kestabilan): Verification of continuous flow smoothness.
  - 60 Seconds (Standar 1 Menit): Verification of nominal 1-minute capacity.
- Mathematical Volume Calculation:
  $$\text{Target Volume (mL)} = Q_{\text{rate}} (\text{mL/s}) \times \Delta t (\text{s}) = \frac{Q_{\text{calibrated}} (\text{mL/min})}{60} \times \Delta t (\text{s})$$
  - Example: With flow rate $120.0 \text{ mL/min}$ ($2.0 \text{ mL/s}$):
    - $10\text{ s} \to 20.0\text{ mL}$
    - $30\text{ s} \to 60.0\text{ mL}$
    - $60\text{ s} \to 120.0\text{ mL}$

3. Execution & Safety Cancellation
- Command Transport: Triggers authoritative ESP32 command `DOSING_RUN_START` with exact duration parameter `durationSeconds`.
- Active State UX: Real-time countdown timer, animated liquid dispensing estimation, and percentage progress bar.
- Emergency Abort: Operator can immediately stop the test run using `Hentikan Sekarang`, which sends `DOSING_RUN_STOP` to instantly deactivate the GPIO relay/MOSFET on the ESP32.
- Completion Guidance: Upon test completion, UI displays the exact target volume and suggests re-calibration if physical collected volume deviates noticeably.

51. Fertigation & Mixing Queue Lifecycle Dashboard Specification (SP-FERT-QUEUE-001)

1. Purpose & Overview
- Transforms the static schedule queue container into an authoritative, real-time Fertigation & Mixing Queue Dashboard.
- Bridges the gap between static user schedules (`schedules[]`), authoritative hardware runtime (`/api/v1/fertigation/status` & `/api/v1/fertigation/queue`), and mechanical execution rules (§8 - §13).
- Directly answers the core operator question: **"Apakah larutan nutrisi sudah siap di tangki (MIX_READY), sedang diracik, atau masih mengantri giliran dosing central (QUEUED)?"**

2. Holistic End-to-End Mechanical Lifecycle
- **Step 1 (Pembuatan & Deployment Jadwal)**:
  - Dibuat di UI (`AddFertigationDrawer`), disimpan di NVS/MicroSD (`/api/v1/schedules/compiled` atau `schedule-intents`).
  - ESP32 Scheduler mematerialisasi kejadian hari ini ke dalam `todaySchedule[]` (`s_today_occurrences`) berstatus `PENDING`.
- **Step 2 (Antrean Dosing Central / Serial Exclusive)**:
  - Unit pompa dosing central (DP-A dan DP-B) bersifat *shared resource* yang dieksekusi secara serial eksklusif antar-Greenhouse (§10.1).
  - Saat waktu persiapan tiba, batch masuk ke `queuedBatches[]` (`s_dosing_queue`).
- **Step 3 (Peracikan Batch di Tangki GH)**:
  - `MIXING_RAW_WATER`: Pengisian air baku dipantau flow meter hingga mencapai ambang batas konfigurasi (default 20%).
  - `DOSING`: Pompa dosing central menginjeksi nutrisi stok secara berurutan: DP-A $\to$ DP-B.
  - `FINAL_MIXING`: Homogenisasi/agitasi larutan di tangki batch GH.
  - `MIX_READY`: Larutan 100% siap di tangki batch GH. Menunggu waktu distribusi tiba (`READY_TO_SEND`) atau siap disiram langsung.
  - `WAITING_BATCH` (§12.3): Jika jam jadwal tiba sebelum peracikan selesai, kontroler menahan distribusi hingga larutan benar-benar siap (tidak akan menyiram air kosong).
- **Step 4 (Distribusi / Fertigasi ke Tanaman)**:
  - Pemicuan distribusi mengaktifkan pompa fertigasi GH hingga sensor pelampung bawah (*lower float switch*) trip (§12.4).
  - Status berubah menjadi `COMPLETED`.

3. Authoritative API & Command Handlers
- `POST /api/v1/fertigation/deliver`: Pemicu langsung distribusi larutan yang berstatus `MIX_READY` via `fertigation_mgr_trigger_distribution(ghId, occurrenceId)`.
- `POST /api/v1/commands` (`FERTIGATION_START`): Pemicuan peracikan awal (*pre-mix*) menggunakan execution plan terkompilasi via `fertigationService.startManual`.
- `POST /api/v1/fertigation/stop`: Pembatalan darurat operasional batch via `fertigationService.stopManual`.

52. Eager Continuous Pre-Mix & Immediate Queueing Invariant (SP-EAGER-PREMIX-001)

1. **Principle: Eager Mixing upon Idle Central Dosing Queue**
   - At calendar day boundary (00:00:00 midnight rollover) or system boot/recovery:
     1. The system materializes all active fertigation schedules for today across all greenhouses into `todaySchedule[]` (`s_today_occurrences`) sorted chronologically by scheduled timestamp.
     2. `try_enqueue_pending_preparations()` inspects the occurrences.
     3. For every greenhouse that is not currently occupied (`!is_gh_occupied(ghId)`), its first upcoming pending occurrence is immediately enqueued into the Global Dosing Queue (`s_dosing_queue`).
   - Invariant: When the dosing queue has capacity / is idle, and there is an upcoming pending fertigation occurrence for today, **the system does NOT passively wait until the scheduled hour (e.g. 06:00)**. It immediately starts preparation (raw water fill $\to$ serial dosing A $\to$ B $\to$ N $\to$ final mixing) so the nutrient solution is ready (`MIX_READY`) well in advance.

2. **Continuous Enqueue Trigger Points**
   - Evaluated continuously every 1-second scheduler tick (`scheduler_evaluate_at`):
     - Rollover detection: `s_today_yday != tm_now.tm_yday`.
     - Occurrence recovery: `s_today_occurrence_count == 0 && s_runtime_count > 0` (clock lock or schedule deploy).
     - Capacity availability: `s_dosing_queue_count < MAX_DOSING_QUEUE`.
     - Queue departure: When active batch completes final mixing into `READY_TO_SEND` or fails, `try_enqueue_pending_preparations()` immediately feeds the next GH in line to central dosing.
     - Distribution completion: When an occupied greenhouse finishes delivery, it becomes unoccupied and its subsequent occurrence for the day is enqueued.

3. **Mid-Day Recovery & "Belum Di-Trigger Pada Hari Itu" Invariant**
   - If the controller was powered off at 00:00:00 and turned on later in the day (e.g. 02:50, 08:00, or 14:00), or if clock locked mid-day:
     - The controller checks `(s_daily_trigger_completed_yday != tm_now.tm_yday || s_daily_trigger_completed_year != tm_now.tm_year)`.
     - Because today's daily trigger was not yet completed, the controller **immediately executes the daily materialization and eager queueing**.
     - Occurrences prior to the current time are safely marked `OCC_STATE_FAILED` / `MARKER_SKIPPED` (Spec §47.2).
     - All upcoming occurrences for today are materialized in `PENDING` state and the first eligible batch per unoccupied greenhouse is immediately injected into the Central Dosing Queue.

4. **Authoritative API & State Visibility**
   - `POST /api/v1/schedules/trigger-today`: Explicit endpoint to force daily materialization and queue evaluation on operator demand or initial setup.
   - `dailyTriggerExecuted` boolean flag exposed in `GET /api/v1/fertigation/status` and `GET /api/v1/fertigation/queue` providing transparent operational health status.

5. **Peripheral Registration & Component Mutation Auto-Enqueue Pipeline (SP-PERIPHERAL-AUTO-ENQUEUE-001)**
   - When hardware peripherals are registered or updated via `hardwareService.registerComponent()`, `updateComponent()`, or `saveConfiguration()`:
     1. The system updates the authoritative operational snapshot equipment across complexes and greenhouses.
     2. `deployCompiledScheduleSet(complexId)` is automatically invoked, re-evaluating candidate schedules against the newly satisfied hardware requirements (`BLOCKED` -> `ACTIVE`).
     3. The newly compiled schedule set is deployed to ESP32 (`/api/v1/schedules/compiled`).
     4. `esp32Client.triggerDailySchedules()` is triggered immediately, prompting `scheduler_trigger_daily_now()` / `materialize_today_schedule()` and `try_enqueue_pending_preparations()`.
     5. Firmware activation (`api_config_handlers.c`) atomically executes `scheduler_sync_intents()` upon configuration commit.
     6. `FertigationQueueDashboard` automatically runs catchup revalidation when local schedules are enabled but the ESP32 dosing queue is empty.
     - Invariant: Peripheral registration immediately and autonomously populates the central dosing queue and begins eager mixing without requiring manual button clicks or page reloads.

6. **Dual-Guard Autonomous 2-Hour Guard & 15-Second Web UI Grace Period (SP-DUAL-GUARD-AUTO-001)**
   - **Autonomous Firmware Guard (No Web UI Dependency):**
     1. FreeRTOS scheduler (`scheduler.c`) maintains an autonomous 2-hour periodic check (`now - s_last_periodic_check_sec >= 7200`) executed using O(1) integer arithmetic without heap allocations or I2C bus traffic.
     2. Condition 3 checks missing occurrences (`s_today_occurrence_count == 0 && s_runtime_count > 0`): if ESP32 was powered off at 00:00:00 midnight and boots at any point later in the day (e.g. 02:30), the controller automatically materializes today's operational schedule and eagerly injects upcoming batches into `s_dosing_queue`.
     3. Clock synchronization (`POST /api/v1/clock-sync`) immediately invokes `scheduler_trigger_daily_now()`.
     4. Intent mutation in firmware (`POST/PUT/DELETE /api/v1/schedule-intents`) directly invokes `scheduler_sync_intents()` and `scheduler_trigger_daily_now()` in internal C code, eliminating Web UI URL chaining and redundant manual re-fetch requests.
   - **Web UI Grace Period & Background Safety Net:**
     1. When Web UI detects empty dosing queue (`queuedJobs.length === 0`) while active schedules exist for today:
     2. The container displays an active synchronization loading state (*"Memverifikasi antrean peracikan dengan ESP32..."*) for a **15-second grace period**.
     3. If during this 15-second window authoritative queue data arrives from ESP32 telemetry (showing occurrences or queued batches), the countdown cancels immediately and existing data is displayed without redundant network requests (`jangan fetch ulang`).
     4. If after 15 seconds the controller queue remains unmaterialized, Web UI executes a background trigger (`deploySchedules` + `triggerDailySchedules`) to ensure full synchronization.

53. Human-Centered Fertigation & Mixing Architecture Rebuild (SP-FERT-REBUILD-001)

1. **Elimination of Broken Containers & Fake Loops**
   - Removed obsolete technical runtime panels (`TodayOccurrencesPanel`, `MixingBatchesPanel`, `DistributionPanel`, `DosingQueuePanelThin`, `FertigationHistoryPanel`) that exposed raw technical keys (`occurrenceId`, raw numeric state codes, empty developer tables).
   - Fixed FreeRTOS scheduler evaluation loop: `s_daily_trigger_completed_yday` and `s_daily_trigger_completed_year` are set unconditionally once evaluated, eliminating repetitive 1-second empty log spam (`SCHEDULER: Daily schedule trigger executing for yday 274 (schedules=0, occurrences=0)`).
   - Enforced event-based logging: logs are emitted only when real schedules exist or actionable events occur.

2. **Core Operational Pipeline**
   ```
   Fertigation Schedule
           |
           v
   Schedule Trigger (Specific Time / Daily / Days / Date / Interval / Manual)
           |
           v
   Create Fertigation Job
           |
           v
   Central Dosing Queue (FIFO, Serial Central Unit)
           |
           v
   5-Step Mixing Process:
     1. Persiapan Air Baku (Water Preparation)
     2. Injeksi Nutrisi A (Nutrient A Dosing)
     3. Injeksi Nutrisi B (Nutrient B Dosing)
     4. Pengadukan & Homogenisasi (Mixing Process)
     5. Pompa Distribusi Fertigasi (Fertigation Pump Delivery)
           |
           v
   Ready Fertigation Solution (MIX_READY in GH Batch Tank)
           |
           v
   Fertigation Pump Execution (Delivery to Plant Drippers)
           |
           v
   Completion / Failure Status (Recorded with full auditability)
   ```

3. **Multi-Greenhouse Physical Isolation**
   ```
   Complex
    |
    ├── GH-01 ── Mixing Tank GH-01 (Capacity 300L, independent level & state)
    └── GH-02 ── Mixing Tank GH-02 (Capacity 300L, independent level & state)
   ```
   - Each greenhouse possesses dedicated mixing tank telemetry, level tracking, and operational lifecycle (`Waiting`, `Preparing Water`, `Adding Nutrients`, `Mixing`, `Ready`, `Delivering`, `Completed`, `Failed`).
   - Human timing fields: Remaining Time (`02:15 tersisa`) and Expected Ready Time (`Sebelum 07:00`).

4. **Hierarchical Views & User Experience**
   - **Complex Overview View**: Summarizes all greenhouses in the complex (Total, Ready, Mixing, Waiting, Error) with actionable greenhouse cards.
   - **Greenhouse Scoped View**: Focused telemetry for a single greenhouse (Today's cycles, next scheduled time, current mixing tank status, 5-step dosing progress).
   - **Fertigation Schedule Manager**: Human-readable schedule cards with natural language timings, target volume, and one-click pre-mix.

54. Fertigation & Mixing Queue Logic, Status Consistency, and Fully Automated FIFO Architecture (SP-FERT-AUTOMATION-001)

1. **Complete Resolution of Queue & Tank Status Contradictions**
   - Eliminated the misleading message *"All remaining schedules for today are ready or completed"* when operations or mixing tanks were actually waiting.
   - Replaced ambiguous generic `"Waiting"` status with 3 strictly distinguished lifecycle phases:
     - **Scheduled**: A fertigation operation has a future scheduled start today, but has not yet entered the execution queue (displays `Jadwal Mulai: 07:00`).
     - **Queued**: An operation has been accepted and is waiting for its turn in the central FIFO queue (displays `Posisi Antrean: #1 di Central`).
     - **Active**: An operation is currently executing physical dosing, mixing, or fertigation distribution.
   - Neutral and accurate empty queue state:
     - When queue is empty and future schedules exist: *"Tidak ada operasi peracikan dalam antrean saat ini. Jadwal berikutnya: 07:00 (GH-01)"*.
     - When queue is empty and all runs today have finished: *"Semua jadwal fertigasi hari ini telah selesai dilaksanakan"*.
     - When no schedules are configured: *"Belum ada jadwal fertigasi aktif yang terdaftar untuk hari ini"*.

2. **Redesigned Central Dosing Unit Panel**
   - **Idle State**: Displays Status: `Standby (Siaga)`, primary message *"Tidak ada operasi dosing yang sedang berjalan saat ini"*, and dynamically displays next operation context (*"Operasi berikutnya: GH-01 pukul 07:00"*). Technical values (`IDLE`, raw pointer IDs, container counters) are removed from primary view.
   - **Running State**: Identifies target greenhouse (`Melayani: GH-01`), active operation step (`Persiapan Air Baku`, `Injeksi Nutrisi Stok A/B`, `Pengadukan Homogenisasi`), target volumes, step progress bar, and real process state.
   - **Error State**: Identifies affected greenhouse, exact failed stage, and safety trip reason without masking errors.

3. **Rebuilt FIFO Queue Presentation**
   - Pending jobs are displayed in strict chronological execution order (`#1`, `#2`, ...).
   - Each item identifies target greenhouse name, recipe formula, target water & nutrient volumes, and execution position.

4. **Human-Centered Greenhouse Mixing Tank Cards**
   - Replaced technical IDs (e.g. `Tangki Pencampur gh-mui7dtg`) with registered human display names (`GH-01 Mixing Tank`).
   - Implemented 11 distinct operational states: `Standby`, `Waiting for schedule`, `Waiting in queue`, `Preparing water`, `Dosing nutrients`, `Mixing`, `Ready for fertigation`, `Fertigation in progress`, `Completed`, `Failed`, `Interrupted`.
   - Honest volume labeling: clearly distinguishes `Volume Terukur` (from physical level sensor) from `Target Pencampuran` (configured in recipe). When unmetered, explicitly indicates *"Sensor level fisik tidak terpasang"* instead of misleadingly declaring tank empty (`0 / 300 L (0%)`).
   - Time estimation reality: eliminated ambiguous `"Sebelum 06:00"` and fabricated `"02:15"` duration placeholders. Displays actual scheduled start time (`Pukul 07:00`).

5. **Fully Automated Workflow & Clarified Controls**
   - End-to-end automation: `Schedule -> Occurrence -> Central FIFO Queue -> Dosing -> Mixing -> Ready in GH Tank -> Delivery Pump -> Completed`. Scheduled operations proceed autonomously without manual button clicks.
   - Clarified manual controls:
     - `Siram ke Tanaman Sekarang` (Deliver Now) when solution is `Ready for fertigation`.
     - `Masuk Antrean Dosing` (Add to Queue) when waiting for future schedule.
     - In-flight operations disable manual start buttons to prevent duplicate jobs or pump conflicts.

6. **FreeRTOS Scheduler Log Spam Elimination (`esp32/main/services/scheduler.c`)**
   - Removed infinite 1-second Condition 3 re-trigger when occurrences equal zero.
   - Daily schedule evaluation executes cleanly on midnight rollover, midday boot recovery, or authoritative API trigger, emitting informative logs only on actionable events.

55. Operational Time-Awareness, Zero-Refresh Reactivity, and Hardware Domain Separation (SP-LOGIC-REACTIVE-001)

1. **Temporal Awareness for Nearest Schedule Calculation**
   - The UI evaluates schedule time against authoritative RTC device clock (`clock.secondsSinceMidnight`).
   - The nearest upcoming schedule is filtered by `schedMinutes >= currentMinutes` and sorted chronologically ascending.
   - Schedules whose designated time has already elapsed without execution today are automatically recognized as `Missed / Terlewat`, rolling `nextRun` over to `Tomorrow [HH:MM]`.
   - Prevents past schedules (such as 06:00 when clock is 10:52) from being reported as the nearest upcoming operation.

2. **Real Dynamic Cycles Completed Counter**
   - Eliminated hardcoded placeholder `cyclesCompletedToday: 2`.
   - Dynamically counts completed batches from authoritative controller occurrences (`state == COMPLETED`) and schedule records.
   - Accurately reports `0 / 2 Siklus Selesai` prior to batch execution, advancing only as physical cycles conclude.

3. **Strict Physical Domain Isolation for Tank Volumes**
   - The 300L greenhouse mixing tank is strictly separated from the 1000L raw water reservoir (`gh.telemetry.tankL`).
   - The mixing tank does not inherit or divide against the 1000L toren level, eliminating the physically impossible `1000 / 300 L (333%)` overflow artifact.
   - When idle/waiting, the mixing tank accurately displays `0 / 300 L (0%) · Target: [X] L (Volumetrik Fail-Safe)`.

4. **Zero-Refresh Schedule Mutation Reactivity**
   - Subscribed `FertigationQueueDashboard` to `useDbVersion()`.
   - Schedule creations (`+ Add Fertigation Schedule`), edits, toggles, and deletions trigger instantaneous re-render without requiring browser reloads.
   - The component synchronizes runtime state with controller endpoints on version increments.

5. **Universal Human-Readable Greenhouse Identification**
   - `formatGreenhouseName()` resolves technical database UUIDs into human-readable greenhouse tags (`GH-01`, `GH-02`) across cards, banners, timeline lanes, and schedule tables.

56. Fail-Safe Volumetric Operation and Schedule Wait Button Suppression (SP-FAILSAFE-VOLUMETRIC-001)

1. **Fail-Safe Volumetric Tank Architecture**
   - The physical greenhouse mixing tank does not incorporate a continuous analog (0–100%) depth sensor.
   - Water volume admitted into the batch tank is metered dynamically by the **ZJ-B1 Flow Meter (GPIO 15)** pulse counter during the filling phase.
   - Pump dry-run cavitation protection is enforced mechanically by the **Lower Float Switch (GPIO 38)**.
   - The user-facing label `(Sensor tidak terpasang)` is replaced by `(Volumetrik Fail-Safe)`. This reflects the intentional engineering design (metered volumetric batch tank with float interlocks) rather than a hardware defect.

2. **Automated Schedule Wait & Manual Button Suppression**
   - When a greenhouse has an active upcoming schedule (`Waiting for schedule`), the system operates autonomously under controller orchestration.
   - The manual `Masuk Antrean Dosing` action button is suppressed during automated schedule wait (`canPreMixNow = false`).
   - Rationale: Eager Pre-Mix automatically admits the batch to the central FIFO queue ahead of the target distribution time. Exposing a manual enqueue button risks operator confusion, premature preparation hours before distribution (causing nutrient degradation or pH drift), and uncoordinated batching in the absence of continuous level telemetry.
   - The UI displays an explicit `Otomasi Terjadwal (Fail-Safe)` badge in place of the button across Complex Overview, Mixing Tank cards, and Greenhouse Detail view.

57. Automated 56-Scenario Simulation and Failure Injection Suite (SP-SIM-56-001)

1. **Simulation Environment Architecture**
   - Built a deterministic, headless simulation framework (`scripts/simulation/`) testing the actual FreeRTOS queue processor and mixing state machine without requiring physical pumps or energized actuators.
   - **Virtual Clock (`VirtualClock`)**: Millisecond-precision, step-driven, no arbitrary sleeps.
   - **Virtual Hardware Registry (`VirtualPump`, `VirtualSensor`, `VirtualMixingTank`)**: Simulates water filling pumps, peristaltic dosing pumps (Stock A & B), circulation mixers, and distribution pumps with full calibration and physical flow dynamics.
   - **Fault Injection**: Supports pump start failures, running without flow, low flow rate tolerances, unexpected stoppage, shutdown failures, sensor loss mid-run, persistent zero/full readings, erratic signal flutter, ESP32 reboots, power cuts, and backend disconnections.

2. **Test Scenario Coverage (56/56 Scenarios Verified)**
   - **Group A (FIFO Queue, Q01–Q10)**: Empty queue neutrality, single scheduled job auto-dispatch, strict sequential execution, non-interrupting mid-run arrivals, simultaneous schedule tie-breaking (chronological then alphabetical GH ID), queue capacity rejection, duplicate trigger suppression, invalid config rejection, pending job cancellation, and safe resource release upon head failure.
   - **Group B (Mixing Tank, M01–M12)**: Normal 5-stage pipeline, tank busy locking, sensor absence graceful fallback, sensor disconnection mid-fill, stuck-at-zero watchdog timeout, stuck-at-full overflow prevention, signal jitter filtering, capacity limit enforcement (>300L rejected), zero-target rejection, filling timeout shutdown, mixer startup failure interlock, and normal completion transitions.
   - **Group C (Pump & Volumetric Operation, P01–P12)**: Pump failure detection, dosing failure handling, missing mixer interlock, dry-run flow loss, low flow tolerance trips, unexpected stoppage accounting, secondary shutdown invocation, invalid calibration blocking, partial sequence failure accounting (Stock A dosed, Stock B failed without overconcentration on retry), maximum total duration watchdog cutoff, limited water supply timeout, and invalid feedback handling.
   - **Group D (Fail-Safe & Recovery, F01–F10)**: Startup missing sensor handling, mid-fill sensor loss fallback, missing calibration fail-safe blocking, calibrated estimated volume termination, safety duration limits, ESP32 reboot pending job restoration, in-flight reboot interruption logging, power-loss safe output shutdown, backend offline local autonomous execution, and post-fault verified recovery.
   - **Group E (Multi-Greenhouse Isolation, G01–G06)**: Independent dual-GH normal runs, isolated failure containment (GH-01 failure does not affect GH-02), independent tank mixing while second GH doses through central unit, 3-GH FIFO sequence dispatching, immediate resource handover upon mixing transition, and complete cross-greenhouse data isolation.
   - **Group F (UI and Status Consistency, U01–U06)**: Empty queue with/without future schedules, schedule wait manual button suppression with `Otomasi Terjadwal (Fail-Safe)`, queue position progression (`Urutan #1 di Central`), real 5-step hardware pipeline visualization, volumetric fail-safe labeling, and honest failing-stage diagnostics.

58. HTTP Socket Capacity, WebSocket Resilience, and Storage Persistence Task Headroom (SP-HTTPD-MEM-001)

1. **HTTP Sockets & LRU Purge Collision Resolution**
   - **Root Cause**: `CONFIG_LWIP_MAX_SOCKETS` was set to 8 and `max_open_sockets` to 7. In ESP-IDF `esp_http_server`, 3 sockets are reserved internally for server operation, leaving only 4 client sockets available.
   - Modern browsers open up to 6 concurrent HTTP/1.1 connections for polling (`/api/v1/fertigation/queue`, `/api/v1/status`), plus 1 persistent WebSocket connection for telemetry streaming (`/api/v1/telemetry/stream`). When a schedule creation or mutation request was submitted, the 8th connection exceeded capacity.
   - With `lru_purge_enable = true`, `httpd` forcefully evicted the least recently visited socket, causing active handlers to fail with `httpd_sock_err: error in send : 11` (aborted send) and tearing down the WebSocket connection (`Failed to read header byte (socket FD invalid)`).
   - **Resolution**:
     - Increased `CONFIG_LWIP_MAX_SOCKETS` to 16 in `sdkconfig.defaults`.
     - In `http_server.c`, increased `config.max_open_sockets` to 12 (providing 9 available client sockets: 1 WebSocket + 6 browser pool + 2 burst headroom).
     - Increased `send_wait_timeout` and `recv_wait_timeout` from 5 to 10 seconds.
     - Added `inFlightRef` single-flight guard to `fetchStatus` in `FertigationQueueDashboard.tsx` to prevent request piling.

2. **Storage Persistence Task (`tele_persist_task`) Stack Sizing**
   - `tele_persist_task` is responsible for writing event logs to SPIFFS flash (`event_mgr_flush_to_storage()`).
   - Operating on a 4096-byte stack in internal SRAM, SPIFFS POSIX file I/O pushed stack consumption to 4004 bytes, leaving a razor-thin **92 bytes** high-water mark before stack overflow.
   - Stack size increased to 6144 bytes in `telemetry_mgr.c`, restoring safe >2KB headroom without risk of stack canary corruption.

59. Autonomous Schedule Execution & Hardware Relay Actuation Resolution (SP-SCHED-ACTUATION-001)

1. **Target Greenhouse Boundary for Facility-Level Actuators**
   - **Problem**: When `scheduler_task` evaluated a due well pump schedule (`pump_well`), `command_mgr_submit()` rejected the command with `TARGET_GH_REQUIRED` (error 258 `ESP_ERR_INVALID_ARG`).
   - **Root Cause**: `command_mgr.c` line 199 previously declared `const bool target_gh_required = cmd->type == CMD_TYPE_FERTIGATION_BATCH || cmd->type == CMD_TYPE_COMPONENT_TIMED;`. Because `pump_well` is a complex-wide facility component with `assignment.ghId == null`, any timed pump command failed validation.
   - **Resolution**: Refined `target_gh_required` to strictly `cmd->type == CMD_TYPE_FERTIGATION_BATCH`. Complex-wide components (`pump_well`, facility fans, main inlet valves) execute without requiring a greenhouse ID binding.

2. **Hardware Resource ID Binding Resilience**
   - **Problem**: In `command_mgr.c`, line 354 enforced `strcmp(cmd->resource_id, component.resource_id) == 0`. When the schedule compiler or client passed synthetic IDs (e.g., `res-pump_well`) while `hardware_registry` had no explicit resource string (`resource_id[0] == '\0'`), the command was rejected with `RESOURCE_COMPONENT_MISMATCH` (`ESP_ERR_INVALID_STATE`).
   - **Resolution**: Relaxed the check to `if (cmd->resource_id[0] && component.resource_id[0]) { ... }`. Commands are verified against resource locks only when both the command and physical component declare an authoritative resource binding.

3. **Safety Monitor Sensor Freshness Window Tuning**
   - **Problem**: During schedule dispatch, the safety monitor tripped with `[WARNING] SAFETY_SENSOR_STALE: Safety sensor data is stale/unavailable for this protected pump. (err 259)`.
   - **Root Cause**: `#define SAFETY_SENSOR_STALE_MS 3000ULL` (3 seconds) was too tight. The background `telemetry_sampler_task` runs on a 2000ms loop; any DHT22/DS18B20 1-wire timing jitter or SPI transaction delay pushed sample latency past 3000ms, triggering false staleness interlocks.
   - **Resolution**: Increased `SAFETY_SENSOR_STALE_MS` to 15000ULL (15 seconds) in `safety_monitor.c`, providing a 7.5x margin over the 2-second sampling cadence while maintaining robust protection against actual sensor freeze.
   - Removed synchronous `sensor_hal_poll()` calls inside `safety_monitor_authorize_component()` to eliminate task blocking and re-entrancy.

4. **Elimination of Massive Stack Allocations in `scheduler_task`**
   - **Problem**: FreeRTOS threw `***ERROR*** A stack overflow in task scheduler has been detected` (reset reason `0x4 GURU_MEDITATION`) whenever `scheduler_evaluate_at` ran during due minute checks.
   - **Root Cause Analysis**:
     1. In `scheduler.c`, `reconcile_running_schedules_locked()` allocated `command_item_t receipt;` on the stack. `command_item_t` contains a 6144-byte fertigation JSON payload buffer, making the single struct **6,540 bytes** on the stack.
     2. In `materialize_today_schedule()`, line 1729 allocated `today_occurrence_t preserved[MAX_TODAY_OCCURRENCES];` on the stack. With 32 entries at ~290 bytes each, this local array consumed **9,280 bytes** on the stack.
     3. Combined stack demand exceeded 15.8 KB, instantly blowing through any standard FreeRTOS task stack.
   - **Resolution**:
     - Converted `preserved` in `materialize_today_schedule()` to use `static EXT_RAM_BSS_ATTR today_occurrence_t s_preserved_occurrences[MAX_TODAY_OCCURRENCES];` (lives in 8MB PSRAM, consumes **0 bytes** of task stack and **0 bytes** of internal SRAM).
     - Converted `receipt` in `reconcile_running_schedules_locked()` to dynamic heap allocation (`calloc(1, sizeof(command_item_t))`) freed upon loop exit.
     - Stabilized `scheduler_task` stack size at 6144 bytes in internal SRAM. High-water mark analysis confirms generous headroom with internal heap remaining healthy (>49KB free).

5. **Physical Actuation Verification**
   - Live hardware schedule intent (`wellPump-live-verified-now`, duration: 6 seconds) registered via HTTP API.
   - At exactly 20:42:00 WIB (13:42:00Z):
     - `COMMAND_ACCEPTED` logged by command manager.
     - `PUMP_STARTED` logged; Relay #1 (GPIO 1, `ACTUATOR_WELL_PUMP`) physically actuated ON.
     - Actuator remained ON for calibrated 6-second window.
     - At 20:42:06 WIB: `PUMP_STOPPED` logged; Relay #1 physically actuated OFF.
     - Schedule entry updated with `lastExecutionTimestamp: 1790948520` (20:42:00 WIB) and `isRunning: false`.

60. Autonomous Fan Schedule Execution & Physical Actuation Resolution (SP-FAN-ACTUATION-001)

1. **Safety Monitor Maximum Runtime for Ventilation Fans**
   - **Problem**: Fan schedules requesting durations over 30 minutes (such as 3600 seconds / 60 minutes) failed authorization with `MAX_RUNTIME_EXCEEDED` (`ESP_ERR_INVALID_STATE`). As a result, the occurrence remained in `MARKER_PENDING` indefinitely, `lastExecutionTimestamp` remained `0`, and the schedule reported `isRunning: true`.
   - **Root Cause**: `safety_monitor.c` defined `#define SAFETY_DEFAULT_FAN_MAX_SEC 1800U` (30 minutes).
   - **Resolution**: Increased `SAFETY_DEFAULT_FAN_MAX_SEC` to `14400U` (4 hours) in `safety_monitor.c`. This permits standard agricultural greenhouse ventilation intervals (1 to 4 hours) while maintaining an authoritative guardrail against unmonitored continuous operation.

2. **Event Logging & Actuator State Parity for Fans**
   - **Problem**: Actuating fan components did not emit `FAN_STARTED` and `FAN_STOPPED` event records, unlike pumps and buzzers. In addition, changing component state via `actuator_hal_set_by_component_id()` did not update `s_actuators[i].state`, causing telemetry snapshots and TFT display tiles to lag.
   - **Resolution**:
     - Added `FAN_STARTED` and `FAN_STOPPED` event logging across `actuator_hal_set_state()`, `actuator_hal_set_by_component_id()`, `actuator_hal_stop_component()`, and `actuator_hal_force_off_component()`.
     - Added state synchronization in `actuator_hal_set_by_component_id()`: matching GPIOs in `s_actuators[]` update `state` and `owner` immediately, ensuring telemetry snapshots (`fan_on`) and TFT screen display tiles accurately reflect physical fan state.

3. **Greenhouse Target Validation Resilience in `command_mgr.c`**
   - **Problem**: When a fan schedule targeted greenhouse `gh-muii7dtg` (the greenhouse blower fan `fan_blower` on GPIO 10 / Relay IN3), `command_mgr_validate()` rejected the command with `UNKNOWN_TARGET_GH` (error 404 `ESP_ERR_NOT_FOUND`).
   - **Root Cause**: `active_config_has_gh()` only inspected the `"greenhouses"` array in `storage_mgr_load_config()`. In setups where greenhouse peripherals are assigned via dynamic hardware registry, the configuration JSON's `"greenhouses"` array could be empty, causing valid greenhouse targets to fail validation.
   - **Resolution**: Enhanced `active_config_has_gh()` in `command_mgr.c` to iterate `hardware_registry` component assignments: if any registered, commissioned, or enabled component has `assignment.gh_id == gh_id`, the greenhouse target is validated as authoritative.

4. **Schedule Intent Parsing and Hardware Binding**
   - **Resolution**: Enhanced `sync_intents_locked()` in `scheduler.c`:
     - Normalizes fan aliases (`fan_cooling`, `fan_blower`, `fan-cooling`, `blower-fan`, `cooling_fan`, `blower`).
     - Intelligent target binding: `FAN_TOGGLE` schedules with a greenhouse ID automatically bind to `fan_blower` (greenhouse blower contactor on GPIO 10); facility/cabinet schedules without greenhouse ID bind to `fan_cooling` (cabinet exhaust fan on GPIO 7).
     - Flexible recurrence parsing: supports both ISO/UI `"time": "HH:MM"` string format and OpenAPI `"hour": HH, "minute": MM` integer properties.

5. **Schedule Capacity & API Buffer Scaling**
   - **Problem**: Schedules beyond 16 were truncated from `/api/v1/schedules` GET responses because `entries[16]` was statically sized, and `MAX_COMPILED_SCHEDULES` in `scheduler.c` stopped intent ingestion at 16 entries.
   - **Resolution**: Raised `MAX_COMPILED_SCHEDULES` to `32` in `scheduler.c`. In `api_schedule_handlers.c`, replaced the 16-element stack array in `api_schedule_get_all_handler()` with heap allocation of `MAX_SCHEDULE_INTENTS` (32 entries), allowing full retrieval of all deployed schedules.

6. **Physical Actuation & Execution Verification**
   - **Facility Cabinet Cooling Fan (`fan_cooling`, GPIO 7 / MOSFET Channel 3)**:
     - Schedule intent (`fan-live-auto-1`, duration: 10 seconds) triggered at 21:36:17 WIB (14:36:17Z):
       - `COMMAND_ACCEPTED` logged by command manager.
       - `FAN_STARTED` logged; MOSFET Channel 3 (GPIO 7, Active-HIGH) actuated ON.
       - At 21:36:27 WIB (14:36:27Z): `FAN_STOPPED` logged; MOSFET Channel 3 actuated OFF.
       - Schedule entry updated with `lastExecutionTimestamp: 1790951777` (21:36:17 WIB) and `isRunning: false`.
   - **Greenhouse Blower Contactor (`fan_blower`, GPIO 10 / 4-Channel Relay IN3)**:
     - Direct command (`test-blower-direct-2`, duration: 5 seconds):
       - At 21:47:08 WIB: `FAN_STARTED` logged; Relay IN3 (GPIO 10, Active-LOW) actuated ON.
       - At 21:47:13 WIB: `FAN_STOPPED` logged; Relay IN3 actuated OFF.
     - Autonomous schedule intent (`blower-sched-verify-1`, duration: 10 seconds):
       - At 21:49:00 WIB (14:49:00Z): `COMMAND_ACCEPTED` logged by command manager.
       - `FAN_STARTED` logged; Relay IN3 (GPIO 10, Active-LOW) physically clicked ON.
       - At 21:49:10 WIB (14:49:10Z): `FAN_STOPPED` logged; Relay IN3 physically clicked OFF.
       - Schedule entry updated with `lastExecutionTimestamp: 1790952540` (21:49:00 WIB) and `isRunning: false`.

61. Autonomous Fertigation Recipe Resolution & Dosing Queue Eviction (SP-FERT-QUEUE-RECIPE-001)

1. **Bug A — Recipe Nutrients in Milliliters Preservation & Autonomous Synthesis**
   - **Problem**: When a fertigation schedule was created in the drawer with specific nutrient amounts in milliliters (e.g. Nutrisi A 500 ml, Nutrisi B 50 ml, Target Air 80 L), the schedule intent saved to ESP32 storage lacked an executable `executionPlan` object. As a result, the ESP32 FreeRTOS scheduler could not parse dosing requirements, leading to empty dosing payloads.
   - **Resolution**:
     - Frontend (`src/lib/services.ts`): Implemented `buildIntentExecutionPlan()` which generates a valid, authoritative `executionPlan` object containing calibrated dosing pump IDs, targeted milliliters (`dosingChannels`), target volume (`targetWaterMl`), and safety bounds from active controller configuration at schedule save/update time.
     - ESP32 Firmware (`esp32/main/services/scheduler.c`): Implemented `synthesize_fertigation_plan_from_intent()`. If an intent JSON provides `targetWaterL`, `dosingAml`, `dosingBml`, or `dosingChannels` without a pre-compiled `executionPlan`, the firmware autonomously synthesizes a complete, valid execution plan referencing active configuration hashes, timeouts, delivery modes, and operational dosing pumps discovered from `hardware_registry`.

2. **Bug B — Dosing Queue Head Eviction on Failure**
   - **Problem**: When an enqueued dosing batch failed dispatch (e.g. missing payload or validation error), `s_dosing_queue[0]` was marked `QUEUE_STATE_FAILED`, but was never evicted from the queue. This deadlocked the central dosing engine indefinitely, freezing queue head at `#1` while the Web UI displayed `Menunggu Giliran Unit Central (Otomatis)`.
   - **Resolution**: In `process_dosing_queue()` (`scheduler.c`), added detection for `head->state == QUEUE_STATE_FAILED`. When a queue head fails, it logs an error event, marks the today occurrence as `OCC_STATE_FAILED`, shifts subsequent queue items left (`s_dosing_queue_count--`), and triggers the next preparation, preventing deadlocks.

3. **Web UI Direct ESP32 Architecture & Clutter Cleanup**
   - **Direct Firmware Execution**: Removed browser-side interval dispatch hacks (`startManual` auto-dispatch in `fetchStatus` and `handleTriggerQueueSync`) and URL re-deploy chains from the Web UI. The ESP32 FreeRTOS scheduler operates as the physical runtime authority, executing FIFO dosing batches autonomously.
   - **Dynamic Queue Status Badges**: In `DosingQueueSection.tsx`, replaced hardcoded `"Menunggu Giliran Unit Central (Otomatis)"` with dynamic state-aware badges:
     - `FAILED`: "Gagal Dieksekusi" (Rose tone with warning icon)
     - `ACTIVE`: "Sedang Disiapkan Central" (Cyan tone with spinner)
     - `PENDING (index 0)`: "Antrean #1 · Siap Diracik Central" (Amber tone with clock icon)
     - `PENDING (index > 0)`: "Menunggu Giliran #N" (Slate tone)
   - **Elimination of `(Fail-Safe)` Copy**: Removed confusing `(Fail-Safe)` labels across `FertigationQueueDashboard.tsx`, `GreenhouseMixingTanks.tsx`, `ComplexFertigationOverview.tsx`, and `GreenhouseFertigationDetail.tsx`, replacing them with honest, clear schedule timing (e.g. `Terjadwal Pukul 06:00`).


62. Schedule Timeline UI Architecture & Shared Well Pump Projection Model (SP-TIMELINE-COLLISION-FREE-001)

1. **Source Scope vs. Display Scope Decoupling**
   - **Data Source Authority (Complex Level)**: In the authoritative data model and ESP32 runtime, WellPumpSchedule is owned by the Complex (complexId, with no greenhouse assignment). There is exactly ONE definition per well pump schedule.
   - **Display Scope by Page**:
     - **Complex Overview**: Greenhouse rows (GH-01, GH-02, ...) display only their own Fertigation and Fan schedules (Well Pump is NOT repeated inside every GH). Followed by exactly ONE shared Complex-level Well Pump row for the entire Complex.
     - **GH Detail Page**: When viewing a specific GH, the timeline displays exactly 3 rows: Fertigation Schedule, Well Pump Schedule (the ONE shared Complex row projected), and Fan Schedule.
   - **Zero Duplicate Definitions**: No duplicate schedule objects are created, persisted, or synced back to the backend. The projection is a pure UI mapping (isSharedResource: true, sourceScope: "complex") referencing the single authoritative occurrence calculation.

2. **Top-Level Timeline Categories & Default Filter**
   - The timeline default selection is **All Schedule**.
   - Filter dropdown options: `All Schedule`, `Fertigation Schedule`, `Well Pump Schedule`, `Fan Schedule`.
   - Equipment-level operational pipeline breakdown (Raw Water, Dosing A/B, Mixing Pump, Distribution) is strictly confined to popover inspection details and does not form top-level categories.

3. **Multi-Mode Timeline Rendering**
   - **COMPLEX Mode (mode="complex")**: Greenhouse rows (GH-01, GH-02, ...) showing Fertigation + Fan, followed by exactly ONE shared Complex-level Well Pump row. Overlapping occurrences stack into separate collision-free lanes.
   - **GH Detail Mode (mode="gh")**: Primary grouping by Schedule Type (Fertigation Schedule, Well Pump Schedule, Fan Schedule). Well Pump is displayed as ONE row serving the greenhouse.
   - **SCHEDULE Mode (mode="schedule")**: Follows active tab selection (pump, fan, fertigation, all).

4. **Greedy Collision-Free Lane Packing**
   - assignLanesToEvents() implements deterministic interval coloring. Overlapping events are placed on separate vertical lanes within the row. Sequential non-overlapping events share lanes to minimize vertical height.
   - Horizontal card widths are proportional to actual duration ((durationMin / 1440) * 100%).

5. **Date Navigation & Authoritative RTC Sync**
   - Date selection defaults to device clock (clock.date synchronized with ESP32 DS3231 RTC).
   - Navigation controls support [ Today ], [ < ] (prev), [ > ] (next), and date picker selector.
   - The vertical Now marker and current time badge are strictly gated on isToday === true and disappear when viewing tomorrow, future, or past dates.

6. **Fan Temperature-Mode Handling**
   - Fan schedules operating in hysteresis temperature mode (mode === "temperature") have no deterministic start time (time: "--:--"). They are represented by an ambient regulation badge on the row header (⚡ Auto Fan: ON > 30°C / OFF < 28°C) rather than artificial time cards on the grid.
