# GEMINI PATCHING FOLLOW PRD

## TUJUAN

Gunakan dokumen ini sebagai instruksi kerja untuk melakukan implementasi repository berdasarkan:

1. `PRODUCT_REQUIREMENTS_DOCUMENT.md` sebagai target produk.
2. `TRINITY_MASTER_CONTEXT.md` sebagai konteks arsitektur dan aturan sistem.
3. `PROJECT_IMPLEMENTATION_STATUS_GAP_REPORT_V1.md` sebagai gambaran kondisi repository saat ini.
4. `IMPLEMENTATION_BACKLOG_PRD_ALIGNMENT.md` sebagai daftar pekerjaan dan **status eksekusi**.

Tujuan utama bukan sekadar membuat kode bisa di-compile.

Tujuan utama adalah:

> Membawa implementasi repository secara bertahap agar benar-benar sesuai dengan PRD, arsitektur Trinity, kebutuhan hardware, dan acceptance criteria yang ditetapkan.

---

# PRINSIP UTAMA

## 1. PRD adalah target

`PRODUCT_REQUIREMENTS_DOCUMENT.md` adalah sumber utama untuk menentukan fitur dan perilaku yang harus ada.

Kode yang saat ini ada di repository **bukan bukti bahwa requirement sudah benar**.

Jangan menganggap desain lama sebagai kebenaran hanya karena sudah diimplementasikan.

Gunakan:

```text
PRD
 ↓
Architecture / Trinity
 ↓
Gap Report
 ↓
Backlog
 ↓
Code
 ↓
Test
```

Bukan:

```text
Existing Code
 ↓
anggap sebagai requirement
```

---

# 2. KERJA SECARA INCREMENTAL

Jangan melakukan big-bang rewrite.

Kerjakan **satu gap/item backlog pada satu waktu**.

Alur kerja wajib:

```text
READ
 ↓
PICK ONE GAP
 ↓
INSPECT
 ↓
PATCH
 ↓
BUILD / TEST
 ↓
FAIL?
 ├── YES → INSPECT ERROR → PATCH AGAIN → TEST AGAIN
 │                         ↑
 │                         └──── ulangi sampai PASS
 │
 └── NO → PASS
           ↓
       UPDATE BACKLOG
           ↓
       UPDATE PROGRESS
           ↓
       NEXT GAP
```

Jangan berpindah ke item berikutnya sebelum item aktif selesai, kecuali item tersebut benar-benar `BLOCKED`.

---

# 3. BACKLOG ADALAH EXECUTION TRACKER

File:

```text
IMPLEMENTATION_BACKLOG_PRD_ALIGNMENT.md
```

adalah **status tracker pekerjaan implementasi**.

Gemini WAJIB memperbarui file ini selama pengerjaan.

Gunakan status:

```text
[ ] = belum dikerjakan
[-] = sedang dikerjakan / partial
[x] = selesai dan acceptance/test lulus
[!] = blocked
```

## Aturan Checklist

Jangan mencentang:

```text
[x]
```

hanya karena:

* kode sudah ditulis,
* patch sudah dibuat,
* build berhasil,
* file sudah berubah,
* sebagian feature sudah bekerja.

Gunakan `[x]` hanya apabila:

1. implementasi telah selesai,
2. integrasi terkait telah selesai,
3. test/build yang relevan telah berhasil,
4. acceptance criteria item tersebut terpenuhi,
5. tidak ada known blocker yang membuat requirement tersebut masih tidak benar.

Jadi:

```text
PATCH ≠ DONE
BUILD PASS ≠ DONE
TEST PASS + ACCEPTANCE PASS = DONE
```

---

# 4. JANGAN MENCENTANG ITEM SECARA PREMATUR

Jika hanya sebagian selesai:

```text
[-]
```

Jika belum dapat dikerjakan karena dependency atau masalah eksternal:

```text
[!]
```

Tambahkan alasan singkat.

Contoh:

```text
[!] M12.3 Fertigation delivery integration

Blocked:
requires validated flow-meter hardware abstraction.
```

Jangan menyamarkan item `BLOCKED` sebagai selesai.

---

# 5. PICK SATU ITEM TERPENTING

Pada setiap iterasi:

1. Baca backlog.
2. Cari item yang belum selesai.
3. Periksa dependency.
4. Pilih item paling penting yang dependency-nya sudah tersedia.
5. Fokus hanya pada item tersebut.

Prioritas:

```text
P0
↓
P1
↓
P2
↓
P3
```

Namun dependency tetap berlaku.

Contoh:

```text
M8 Schedule Compiler
```

tidak boleh dipaksa selesai jika:

```text
M3 Configuration Engine
M6 Resource Assignment
M7 Topology / Capability
```

belum menyediakan dependency yang diperlukan.

---

# 6. JANGAN MENCIPTAKAN MOCK BARU

Jangan menyelesaikan gap production menggunakan:

* mock,
* fake sensor,
* fake actuator,
* dummy telemetry,
* hardcoded GH,
* hardcoded resource,
* fake schedule,
* random data,
* localStorage sebagai pengganti authority,
* stub yang membuat feature terlihat seolah-olah selesai.

Mock hanya boleh dipakai untuk test yang memang membutuhkan test double, dan harus jelas terisolasi dari production path.

Jangan menggunakan mock untuk menutupi requirement yang belum diimplementasikan.

---

# 7. JANGAN HARD-CODE GH-01

Jangan membuat implementasi baru yang secara permanen mengasumsikan:

```text
GH-01
```

atau:

```text
greenhouse 1
```

sebagai satu-satunya greenhouse.

Sistem harus mempertahankan model:

```text
Complex
 ├── GH-01
 ├── GH-02
 ├── GH-03
 └── GH-N
```

Single-GH adalah kondisi awal/topologi minimum, bukan batasan produk.

---

# 8. KODE LAMA BOLEH SALAH

Jika implementasi lama bertentangan dengan PRD atau arsitektur Trinity:

Jangan mempertahankannya hanya karena:

* sudah lama ada,
* banyak file bergantung padanya,
* compile sudah sukses,
* UI sudah menggunakannya,
* dianggap sebagai legacy architecture.

Evaluasi apakah implementasi tersebut harus:

```text
keep
modify
replace
remove
```

Gunakan evidence dari repository untuk menentukan dampaknya.

---

# CARA KERJA

Untuk setiap item:

## STEP 1 — READ

Baca:

```text
PRODUCT_REQUIREMENTS_DOCUMENT.md
TRINITY_MASTER_CONTEXT.md
PROJECT_IMPLEMENTATION_STATUS_GAP_REPORT_V1.md
IMPLEMENTATION_BACKLOG_PRD_ALIGNMENT.md
```

Baca file code yang relevan.

Jangan menebak struktur code.

Cari implementation path yang benar sebelum melakukan perubahan.

---

## STEP 2 — DEFINE GAP

Tuliskan secara internal:

```text
Requirement:
...

Current implementation:
...

Gap:
...

Expected behavior:
...

Acceptance criteria:
...
```

Pastikan jelas apa yang sebenarnya kurang.

---

## STEP 3 — TRACE DEPENDENCY

Periksa:

```text
UI
↓
API
↓
Backend
↓
Configuration
↓
Compiler
↓
Deployment
↓
ESP32
↓
Runtime
↓
Telemetry / Event
```

Tidak semua item membutuhkan semua layer.

Tentukan layer yang benar-benar terdampak.

---

## STEP 4 — PATCH

Implementasikan perubahan sekecil mungkin namun lengkap untuk acceptance criteria item tersebut.

Jangan:

* melakukan rewrite besar tanpa alasan,
* mengubah arsitektur yang tidak terkait,
* membuat abstraction baru tanpa kebutuhan,
* menghapus feature yang masih dibutuhkan.

Tetapi jangan takut menghapus legacy path apabila path tersebut secara langsung bertentangan dengan PRD.

---

# STEP 5 — BUILD / TEST

Setelah patch:

1. Jalankan formatter/linter jika ada.
2. Jalankan type check jika ada.
3. Jalankan unit test yang relevan.
4. Jalankan integration test yang relevan.
5. Jalankan build.
6. Untuk firmware, lakukan build firmware.
7. Untuk frontend/backend, jalankan test/build masing-masing sesuai repository.

Gunakan command yang benar-benar tersedia di repository.

Jangan mengarang command.

---

# STEP 6 — JIKA TEST GAGAL

Jangan berhenti pada error pertama.

Gunakan loop:

```text
TEST
 ↓
ERROR
 ↓
IDENTIFY ROOT CAUSE
 ↓
PATCH
 ↓
TEST
 ↓
ERROR?
 ├── YES → ulangi
 └── NO → PASS
```

Tujuan bukan sekadar membuat error hilang.

Cari root cause.

Contoh:

```text
TypeError
```

Jangan hanya menambahkan null-check jika sebenarnya struktur data salah.

Contoh:

```text
ESP32 scheduler test failed
```

Jangan mengubah test agar menjadi pass jika implementation yang salah.

Perbaiki implementation sesuai requirement.

---

# STEP 7 — VERIFY ACCEPTANCE CRITERIA

Setelah test pass, periksa acceptance criteria satu per satu.

Contoh:

```text
[PASS] configuration has version
[PASS] configuration validated
[PASS] invalid configuration rejected
[PASS] active configuration atomic
[PASS] rollback works
[PASS] ESP32 receives compiled configuration
```

Jika salah satu acceptance criteria belum terpenuhi:

```text
item belum DONE
```

kembali ke:

```text
PATCH → TEST
```

---

# STEP 8 — UPDATE BACKLOG

Setelah seluruh acceptance criteria terpenuhi dan test pass:

ubah item:

```text
[-]
```

menjadi:

```text
[x]
```

atau:

```text
[ ]
```

menjadi:

```text
[x]
```

Tambahkan bukti singkat bila backlog memiliki kolom verification/evidence.

Contoh:

```text
[x] M3.2 Configuration Schema

Implemented:
- canonical config schema
- validation
- versioning

Verification:
- backend unit tests PASS
- schema validation tests PASS
- firmware config parser tests PASS
```

Jangan mencentang item yang hanya compile.

---

# STEP 9 — UPDATE AI_PROGRESS

Update:

```text
AI_PROGRESS.md
```

dengan:

```text
Current milestone:
Current item:
Implemented:
Tests:
Result:
Next item:
Known blockers:
```

Jangan menulis status generik seperti:

```text
"progress made"
"feature improved"
"mostly complete"
```

Gunakan fakta konkret.

---

# STEP 10 — UPDATE AI_HANDOVER

Jika sesi hampir selesai atau pekerjaan berhenti, update:

```text
AI_HANDOVER.md
```

Harus menjelaskan:

```text
What changed
What passed
What failed
What remains
Current backlog item
Next recommended item
Known risks
```

---

# PRIORITAS IMPLEMENTASI

Ikuti dependency architecture berikut:

```text
M0
Contract & Canonical Model
        ↓
M1
Device Connection / API
        ↓
M2
Hardware Registry
        ↓
M3
Configuration Engine
        ↓
M4
Deployment / Atomic Activation / Rollback
        ↓
M5
Dynamic ESP32 Runtime Foundation
        ↓
M6
Resource Assignment / Ownership
        ↓
M7
Topology / Capability
        ↓
M8
Schedule Compiler
        ↓
M9
ESP32 Scheduler Runtime
        ↓
M10
Command + Safety
        ↓
M11
Sensor + Calibration
        ↓
M12
Fertigation Production Engine
        ↓
M13
Telemetry + Event
        ↓
M14
Offline + Recovery
        ↓
M15
Crop + Research
        ↓
M16
Remove Mock / Legacy
        ↓
M17
E2E + Physical Commissioning
```

Jangan melompati dependency tanpa alasan teknis yang dapat dibuktikan.

---

# M0 — CONTRACT & CANONICAL MODEL

Tujuan:

Menyatukan kontrak data dasar sebelum implementation layer berkembang.

Periksa:

* Complex
* Greenhouse
* Component
* Installed Component
* Assignment
* Resource
* Capability
* Configuration
* Schedule
* Recipe
* Sensor
* Actuator
* Deployment
* Event
* Telemetry
* Crop Cycle
* Plant
* Fruit
* Observation

Pastikan ID, ownership, version, status, dan relationship konsisten.

---

# M1 — DEVICE CONNECTION / API

Pastikan frontend/backend/ESP32 memiliki kontrak komunikasi yang jelas.

Pastikan:

```text
device identity
complex identity
configuration version
deployment status
health
command
response
error
telemetry
event
```

tidak saling bertentangan.

---

# M2 — HARDWARE REGISTRY

Hardware harus dipisahkan menjadi:

```text
Supported Component Definition
Installed Component
Assignment / Ownership
Physical Wiring / Topology
Capability
Runtime Binding
```

Contoh:

```text
Supported:
Pump 12V 5W

Installed:
PUMP-003

Assigned:
Complex-A / GH-02

Wiring:
GPIO-17

Capability:
DOSING_PUMP
```

Jangan mencampurkan semua informasi tersebut menjadi satu hardcoded structure.

---

# M3 — CONFIGURATION ENGINE

Implementasikan canonical configuration.

Minimal mencakup:

```text
schema
version
validation
identity
topology
components
assignments
resources
capabilities
recipes
schedules
calibrations
safety
```

Configuration harus dapat divalidasi sebelum deployment.

---

# M4 — DEPLOYMENT / ATOMIC ACTIVATION

Configuration harus memiliki lifecycle.

Minimal:

```text
DRAFT
VALIDATING
VALID
DEPLOYED
ACTIVE
ROLLED_BACK
```

Schedule atau configuration yang invalid tidak boleh aktif.

Activation harus atomic.

Jika deployment gagal:

```text
previous valid configuration
```

tetap tersedia.

---

# M5 — DYNAMIC ESP32 RUNTIME FOUNDATION

ESP32 harus menjalankan configuration yang diterima, bukan source-code topology.

Pastikan:

```text
Complex ID
GH ID
component IDs
resource IDs
GPIO bindings
schedule IDs
configuration version
```

dibaca dari configuration yang valid.

---

# M6 — RESOURCE ASSIGNMENT / OWNERSHIP

Implementasikan ownership.

Contoh:

```text
FAN-001 → GH-01
FAN-002 → GH-02
FAN-003 → unassigned
```

Sebuah resource tidak boleh diam-diam dipakai oleh dua owner jika hardware memang exclusive.

---

# M7 — TOPOLOGY / CAPABILITY

Capability harus dapat menentukan apakah GH dapat menjalankan suatu schedule.

Contoh:

```text
GH-01:
mixing tank = yes
fan = yes
flow sensor = yes

GH-02:
mixing tank = yes
fan = no
flow sensor = yes
```

Schedule fan pada GH-02 harus menjadi:

```text
BLOCKED
```

bukan runtime failure.

---

# M8 — SCHEDULE COMPILER

Schedule UI bukan langsung menjadi command ESP32.

Alurnya:

```text
Schedule Definition
 ↓
Validation
 ↓
Dependency Resolution
 ↓
Resource Binding
 ↓
Capability Check
 ↓
Conflict Check
 ↓
Compile
 ↓
Compiled Schedule
 ↓
Deploy
 ↓
ACTIVE
```

Compiled schedule harus memiliki binding ke resource nyata.

---

# M9 — ESP32 SCHEDULER RUNTIME

ESP32 mengeksekusi compiled schedule.

Scheduler harus mengetahui minimal:

```text
schedule ID
GH ID
compiled configuration version
action
resource binding
start condition
duration / target
dependencies
```

ESP32 tidak perlu melakukan reasoning topology kompleks setiap tick.

---

# M10 — COMMAND + SAFETY

Semua actuator execution harus melalui command/safety layer.

Jangan membuat scheduler langsung mengontrol GPIO tanpa safety policy.

Pastikan:

```text
safe boot
emergency stop
interlock
tank protection
flow protection
sensor validity
timeout
command idempotency
fault handling
```

---

# M11 — SENSOR + CALIBRATION

Pastikan sensor abstraction konsisten.

Sensor harus memiliki:

```text
ID
type
unit
source
quality
validity
timestamp
calibration
```

Calibration harus:

```text
persisted
versioned
timestamped
traceable
```

Jangan fallback ke angka arbitrer untuk proses precision dosing.

Contoh yang dilarang:

```text
doseRate = 1.0 mL/sec
```

hanya agar sistem tetap berjalan.

Jika kalibrasi wajib belum tersedia:

```text
BLOCKED / FAULTED
```

sesuai safety policy.

---

# M12 — FERTIGATION PRODUCTION ENGINE

State machine harus mengikuti model:

```text
IDLE
 ↓
PRECHECK
 ↓
FILLING
 ↓
DOSING
 ↓
FINAL_MIXING
 ↓
DELIVERY
 ↓
COMPLETE
```

Failure states:

```text
INTERRUPTED
FAULTED
ABORTED
```

Pastikan setiap run memiliki record durable.

Minimal:

```text
runId
ghId
scheduleId
recipeId
recipeVersion
configurationVersion
startTime
endTime
targetVolume
actualVolume
doseTargets
actualDose
calibrationVersion
state
failure
```

Mixed volume tidak boleh disamakan dengan delivered crop volume.

---

# M13 — TELEMETRY + EVENT

Telemetry dan event harus durable.

Pisahkan:

```text
current state
historical telemetry
event log
fertigation run
fault history
```

Semua event penting harus memiliki:

```text
timestamp
source
complex
GH
severity
event type
message
related resource
configuration version
```

---

# M14 — OFFLINE + RECOVERY

ESP32 harus mampu berjalan menggunakan:

```text
last known valid configuration
```

saat backend tidak tersedia.

Ketika koneksi pulih:

```text
local buffered telemetry
+
events
+
fertigation runs
+
faults
```

di-upload dengan mekanisme replay/idempotency yang benar.

Power recovery juga harus diperhatikan.

Missed schedule tidak boleh dieksekusi secara sembarangan.

Implementasikan recovery policy sesuai PRD.

---

# M15 — CROP + RESEARCH

Implementasikan:

```text
Crop Cycle
Plant
Fruit
Observation
Harvest
Yield
```

dengan relasi ke:

```text
GH
fertigation run
recipe
telemetry
environment
calibration
```

Tujuannya agar data penelitian dapat ditelusuri kembali.

---

# M16 — REMOVE MOCK / LEGACY

Setelah production path tersedia:

cari:

```text
mock
fake
dummy
sample
fixture
hardcoded
localStorage authority
singleton GH
GH-01
TODO
unsupported command
temporary fallback
```

Bedakan:

```text
test-only
development-only
production path
```

Hapus atau migrasikan production-path mock.

Jangan menghapus test fixtures hanya karena mengandung mock.

---

# M17 — E2E + PHYSICAL COMMISSIONING

Lakukan pengujian end-to-end:

```text
UI
 ↓
Backend
 ↓
Configuration
 ↓
Validation
 ↓
Compilation
 ↓
Deployment
 ↓
ESP32
 ↓
Runtime
 ↓
Telemetry
 ↓
History
```

Kemudian lakukan commissioning hardware.

Pastikan:

```text
installed component
GPIO
wiring
ownership
capability
safety
schedule
runtime
```

sesuai kondisi fisik.

---

# ATURAN KHUSUS ESP32

ESP32 adalah regulator lokal.

ESP32 harus:

* menjalankan schedule lokal,
* menyimpan configuration terakhir yang valid,
* menjalankan safety check,
* mengontrol actuator,
* membaca sensor,
* menyimpan event lokal,
* menyimpan telemetry buffer,
* melakukan recovery sesuai policy.

ESP32 bukan tempat untuk:

* mencari seluruh resource ecosystem,
* melakukan konfigurasi lintas Complex,
* melakukan business reasoning besar,
* menjalankan schedule yang belum divalidasi,
* menerima arbitrary command tanpa safety.

---

# ATURAN CONFIGURATION

Configuration replacement harus atomic.

Gunakan konsep:

```text
CURRENT
PREVIOUS_VALID
CANDIDATE
```

Contoh:

```text
Config v12 ACTIVE

Deploy v13
 ↓
validate
 ↓
compile
 ↓
deploy
 ↓
test acknowledgement
 ↓
activate v13
```

Jika gagal:

```text
v12 remains active
```

Jangan meninggalkan ESP32 dalam kondisi setengah v12 / setengah v13.

---

# ATURAN SCHEDULE

Schedule harus mempunyai target GH yang eksplisit.

Schedule tidak boleh bergantung pada:

```text
default GH
first GH
GH-01
```

Schedule harus memiliki dependency/resource binding yang valid.

Jika resource hilang:

```text
BLOCKED
```

bukan:

```text
runtime silently fails
```

---

# ATURAN RESOURCE TRANSFER

Saat resource dipindahkan:

```text
Resource
 ↓
current owner
 ↓
new owner
```

sistem harus:

1. menentukan owner lama,
2. menentukan owner baru,
3. memeriksa conflicting schedules,
4. memblokir/recompile schedule terdampak,
5. memperbarui configuration,
6. melakukan deployment atomic,
7. mencatat perubahan.

Contoh:

```text
FAN-001
GH-01 → GH-03
```

Schedule GH-01 yang bergantung pada FAN-001 harus direvalidasi.

---

# ATURAN UI

UI harus merepresentasikan backend/configuration authority.

Jangan menjadikan:

```text
localStorage
```

sebagai source of truth untuk operational configuration.

CRUD harus mengikuti:

```text
UI
 ↓
API
 ↓
Backend
 ↓
validate
 ↓
persist
 ↓
deployment
 ↓
UI refresh
```

Jika backend gagal:

```text
UI rollback
```

UI tidak boleh mengklaim perubahan berhasil jika backend menolak.

---

# ATURAN MOCK DATA

Data mock boleh digunakan hanya apabila:

```text
test
storybook
isolated UI development
```

dan tidak boleh disalahartikan sebagai:

```text
real operational state
```

Semua operational dashboard akhirnya harus berasal dari:

```text
backend / ESP32 telemetry / persisted data
```

---

# ATURAN TEST

Jangan memodifikasi test hanya untuk menghilangkan failure kecuali test memang salah terhadap PRD.

Urutan investigasi:

```text
Requirement
 ↓
Expected behavior
 ↓
Test expectation
 ↓
Implementation
 ↓
Failure
```

Jika test tidak sesuai requirement:

```text
review test
```

Jika implementation tidak sesuai requirement:

```text
fix implementation
```

Jika requirement ambiguous:

```text
mark BLOCKED
```

dan dokumentasikan ambiguity.

Jangan memilih interpretasi secara sembarang untuk requirement safety-critical.

---

# TEST COMPLETION RULE

Sebuah backlog item dianggap selesai hanya bila:

```text
Implementation PASS
+
Integration PASS
+
Relevant Test PASS
+
Acceptance Criteria PASS
```

Baru kemudian:

```text
[x]
```

---

# DEFINITION OF DONE

Untuk setiap item:

```text
[ ] Requirement understood
[ ] Current implementation inspected
[ ] Dependency checked
[ ] Implementation patched
[ ] Relevant test executed
[ ] Build/typecheck/lint executed where applicable
[ ] Failures fixed
[ ] Tests pass
[ ] Acceptance criteria pass
[ ] Backlog updated
[ ] AI_PROGRESS updated
```

Baru dianggap:

```text
DONE
```

---

# DEFINITION OF BLOCKED

Gunakan:

```text
[!]
```

hanya jika pekerjaan tidak dapat diselesaikan karena dependency nyata.

Contoh:

```text
hardware unavailable
external API unavailable
required schema undecided
dependency item incomplete
physical commissioning required
```

Jangan menggunakan `BLOCKED` hanya karena implementasi sulit.

---

# JANGAN MENGGANTI MASALAH DENGAN FALLBACK SEMBARANGAN

Jangan menggunakan fallback arbitrer untuk menyembunyikan requirement yang belum selesai.

Contoh berbahaya:

```text
missing calibration
→ use 1.0 mL/sec
```

atau:

```text
missing sensor
→ assume healthy
```

atau:

```text
missing GH
→ use GH-01
```

atau:

```text
missing resource
→ use first available resource
```

Gunakan:

```text
validation failure
BLOCKED
FAULT
SAFE DEFAULT
```

sesuai requirement dan safety model.

---

# SETELAH SETIAP PATCH

Output internal yang harus dapat dibuktikan:

```text
ITEM:
<backlog item>

CHANGED:
<files/modules>

WHY:
<requirement gap>

TEST:
<commands>

RESULT:
PASS / FAILED / BLOCKED

ACCEPTANCE:
PASS / FAILED

BACKLOG:
[x] / [-] / [!]

NEXT:
<next backlog item>
```

---

# ATURAN PERPINDAHAN ITEM

Setelah item selesai:

```text
CURRENT ITEM
    ↓
[x]
    ↓
check dependency
    ↓
select next incomplete item
```

Jangan melakukan:

```text
10 item patch
 ↓
test semuanya di akhir
```

Gunakan:

```text
1 item
 ↓
patch
 ↓
test
 ↓
fix
 ↓
pass
 ↓
[x]
 ↓
next
```

---

# ATURAN PERUBAHAN DOKUMENTASI

Dokumentasi harus diperbarui hanya pada dokumen canonical yang relevan.

Canonical documentation berada di:

```text
docs/
```

Jangan membuat mirror duplicate di:

```text
esp32/docs/
```

Jangan membuat dokumentasi duplikat hanya untuk menunjukkan progress.

Setelah implementation selesai, update minimal:

```text
IMPLEMENTATION_BACKLOG_PRD_ALIGNMENT.md
AI_PROGRESS.md
```

dan:

```text
AI_HANDOVER.md
```

jika pekerjaan berhenti atau handover diperlukan.

---

# ATURAN GIT

Sebelum perubahan:

```text
inspect git status
```

Setelah perubahan:

```text
inspect git diff
```

Pastikan hanya perubahan yang relevan terhadap item aktif.

Jangan menghapus pekerjaan pengguna yang tidak terkait.

Jangan melakukan destructive reset.

Jangan overwrite perubahan lokal tanpa pemeriksaan.

---

# ATURAN CLEANUP

Jangan melakukan cleanup besar sambil mengerjakan feature kecuali cleanup tersebut merupakan dependency atau bagian langsung dari backlog item.

Contoh:

Jika sedang mengerjakan:

```text
M8 Schedule Compiler
```

jangan tiba-tiba melakukan:

```text
rewrite seluruh frontend
```

hanya karena menemukan code lama.

Catat sebagai backlog item berikutnya.

---

# ATURAN LEGACY

Legacy implementation harus ditangani secara bertahap.

Gunakan pola:

```text
OLD
 ↓
NEW IMPLEMENTATION
 ↓
INTEGRATION
 ↓
TEST
 ↓
MIGRATION
 ↓
REMOVE OLD
```

Jangan meninggalkan dua operational path aktif yang memiliki authority berbeda.

---

# ATURAN SAFETY

Untuk fungsi yang mengendalikan:

```text
pump
valve
dosing
fan
water
fertilizer
```

prioritaskan:

```text
safe state
validation
interlock
timeout
sensor validity
fault handling
```

daripada:

```text
feature completeness
UI convenience
silent fallback
```

Safety-related implementation tidak boleh dianggap selesai hanya karena compile.

---

# ATURAN AKHIR

Jangan mengatakan:

```text
"PRD aligned"
```

secara keseluruhan hanya karena beberapa fitur telah selesai.

Gunakan status nyata:

```text
implemented
partial
blocked
not implemented
verified
```

Repository dianggap progressing menuju alignment, bukan otomatis aligned.

---

# FINAL WORK LOOP

Gunakan loop ini terus-menerus:

```text
READ PRD
   ↓
READ GAP
   ↓
READ BACKLOG
   ↓
SELECT ONE ITEM
   ↓
INSPECT CODE
   ↓
PATCH
   ↓
TEST
   ↓
FAIL?
 ┌───────┐
 │ YES   │
 └───┬───┘
     ↓
FIND ROOT CAUSE
     ↓
PATCH AGAIN
     ↓
TEST AGAIN
     │
     └───────────────┐
                     ↓
                   PASS
                     ↓
             CHECK ACCEPTANCE
                     ↓
            ACCEPTANCE PASS?
              ┌──────┴──────┐
             NO             YES
              ↓               ↓
          PATCH AGAIN     [x] BACKLOG
                              ↓
                       AI_PROGRESS UPDATE
                              ↓
                         NEXT ITEM
```

## PERINTAH OPERASIONAL

Mulai dari repository saat ini.

Jangan menunggu seluruh proyek dianalisis ulang sebelum melakukan perubahan.

Kerjakan satu item prioritas tertinggi yang dependency-nya sudah tersedia.

Setiap item harus mengikuti:

```text
PATCH → TEST → FIX IF FAILED → TEST AGAIN → PASS → CHECK BACKLOG → NEXT
```

Jangan melewati loop tersebut.

Jangan mencentang backlog sebelum acceptance criteria benar-benar terpenuhi.

Jangan membuat mock baru untuk menutupi gap production.

Jangan hard-code GH-01.

Jangan menganggap compile success sebagai completion.

Gunakan PRD sebagai target, repository sebagai evidence, backlog sebagai execution tracker, dan test sebagai verification.

Mulai dari item backlog berikutnya yang paling prioritas dan dapat dikerjakan.
