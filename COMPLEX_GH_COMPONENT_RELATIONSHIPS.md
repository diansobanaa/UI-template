# Complex, Greenhouse, and Component Relationships

## 1. Purpose

Dokumen ini menjelaskan hubungan antara:

- `Complex`
- `Greenhouse (GH)`
- `ESP32`
- komponen hardware shared
- komponen hardware dedicated untuk setiap GH
- configuration dan schedule

Dokumen ini melengkapi `HARDWARE_MAPPING.md` dan menjadi acuan UI, Python backend, serta firmware ESP32.

---

## 2. Core Hierarchy

Satu `Complex` dikendalikan oleh satu ESP32.

```text
ESP32
  |
  +-- Complex
       |
       +-- Shared Components
       |    +-- Well Pump
       |    +-- Main Raw-Water Tank
       |    +-- Raw-Water Flow Meter
       |    +-- Central Dosing Pumps
       |    +-- Central Dosing Valves
       |
       +-- Greenhouse 01
       |    +-- GH Mixing Tank
       |    +-- GH Distribution Pump
       |    +-- GH Valves
       |    +-- GH Sensors
       |
       +-- Greenhouse 02
       |    +-- GH Mixing Tank
       |    +-- GH Distribution Pump
       |    +-- GH Valves
       |    +-- GH Sensors
       |
       +-- Greenhouse N
            +-- GH Mixing Tank
            +-- GH Distribution Pump
            +-- GH Valves
            +-- GH Sensors
```

### Ownership rules

| Entity | Quantity | Owner | Responsibility |
|---|---:|---|---|
| ESP32 | 1 per Complex | Complex | Hardware inventory, runtime safety, actuator control |
| Complex | 1 or more per installation | Python/UI | Site grouping and shared resources |
| Greenhouse | 1 or more per Complex | Complex | Crop environment and GH-specific operations |
| Component | Many | Complex or GH | Physical resource with identity and capability |

A GH must belong to exactly one Complex. A component must belong either to the Complex scope or to one GH.

---

## 3. Complex

`Complex` adalah boundary utama untuk satu sistem kontrol fisik.

A Complex memiliki:

- satu ESP32
- satu raw-water system
- satu central dosing system
- satu inventory hardware
- satu configuration aktif
- satu timezone operasional
- satu scheduler untuk resource shared
- banyak GH

Contoh identity:

```json
{
  "complex_id": "COMPLEX-01",
  "name": "Research Complex North",
  "timezone": "Asia/Jakarta",
  "esp32_device_id": "ESP32-COMPLEX-01"
}
```

### Complex-level operations

Operasi berikut dikelola pada level Complex:

- well pump schedule
- pengisian main raw-water tank
- raw-water flow monitoring
- central dosing pump management
- dosing valve routing
- shared resource queue
- ESP32 synchronization
- configuration validation
- emergency stop seluruh Complex
- clock synchronization

---

## 4. Greenhouse (GH)

GH adalah unit operasional individual di dalam Complex.

Setiap GH memiliki:

- identity sendiri
- nama/code yang dapat diedit
- crop dan informasi produksi
- satu mixing tank dedicated
- satu distribution pump dedicated
- valve dan jalur distribusi sendiri
- sensor GH yang dipetakan ke GH tersebut
- schedule fertigation dan fan sendiri
- telemetry dan history sendiri

Contoh identity:

```json
{
  "gh_id": "GH-01",
  "complex_id": "COMPLEX-01",
  "name": "GH Utara",
  "crop": "Tomato"
}
```

### GH-level operations

Operasi berikut dikelola pada level GH:

- mixing tank fill
- fertigation schedule
- fan schedule
- distribution pump schedule
- GH sensor monitoring
- GH telemetry
- GH history
- crop and plant observations
- GH-specific emergency state

---

## 5. Shared Components

Shared component digunakan oleh lebih dari satu GH atau berada pada infrastructure Complex.

### 5.1 Well Pump

Well pump memindahkan air dari sumur ke main raw-water tank.

```text
Well
  |
  +-- Well Pump
        |
        +-- Raw-Water Flow Meter
              |
              +-- Main Raw-Water Tank
```

Ownership:

```text
scope = COMPLEX
role  = WELL_TO_RAW_TANK
```

Well pump memiliki:

- schedule Complex-level
- runtime limit
- safe state `OFF`
- flow confirmation
- fault state
- manual control dengan permission tinggi

### 5.2 Main Raw-Water Tank

Main raw-water tank adalah sumber air bersama untuk GH.

Tanggung jawab:

- menyimpan air dari well pump
- memberikan volume available
- menjadi constraint sebelum pengisian mixing tank
- melaporkan level dan alarm minimum

Main tank tidak dimiliki oleh satu GH tertentu.

### 5.3 Raw-Water Flow Meter

Raw-water flow meter mengukur volume air yang masuk dari well pump ke main tank.

Ownership:

```text
scope = COMPLEX
role  = RAW_WATER
unit  = ml, ml/s internally
```

Data digunakan untuk:

- validasi well pump
- volume water usage
- deteksi pipa kosong atau flow failure
- telemetry dan history

### 5.4 Central Dosing Pumps

Central dosing pumps adalah resource shared yang dapat melayani banyak GH.

Contoh:

```text
PUMP-DOSE-01
  +-- GH-01
  +-- GH-02
  +-- GH-03
```

Dosing pump tidak boleh menjalankan dua operasi yang bertabrakan jika hardware hanya mendukung satu operasi pada satu waktu.

Setiap dosing pump memiliki:

- stable `component_id`
- custom display name
- role `CENTRAL_DOSING`
- calibration status
- capability `DOSING`
- flow/rate information
- max runtime
- safe state `OFF`

### 5.5 Dosing Valves

Dosing valves mengarahkan air dan nutrient ke GH target.

Valve dapat digunakan untuk memilih:

- raw water menuju GH mixing tank
- nutrient A menuju GH mixing tank
- nutrient B menuju GH mixing tank
- return/flush path
- jalur distribusi tertentu

Valve adalah shared routing resource pada Complex tetapi targetnya dapat berupa GH tertentu.

---

## 6. Dedicated GH Components

Dedicated component hanya melayani satu GH.

### 6.1 GH Mixing Tank

Setiap GH memiliki satu mixing tank dedicated.

```text
GH-01
  +-- TANK-MIX-GH01

GH-02
  +-- TANK-MIX-GH02
```

MVP rule:

```text
1 mixing tank -> 1 GH
```

Mixing tank harus dihabiskan sampai sensor batas air bawah ter-trigger sebelum siklus dianggap selesai atau tank dapat masuk ke state berikutnya.

Mixing tank memiliki:

- capacity
- minimum volume
- maximum volume
- current volume
- low-level sensor
- high-level sensor jika tersedia
- mixing state
- alarm state

### 6.2 GH Distribution Pump

Distribution pump menarik air dari mixing tank GH dan mengirimkannya ke jalur tanaman.

```text
GH Mixing Tank
      |
      +-- GH Distribution Pump
            |
            +-- Plant Distribution Line
```

MVP rule:

```text
1 distribution pump -> 1 GH
```

Distribution pump memiliki:

- schedule GH-level
- safe state `OFF`
- flow control jika tersedia
- runtime limit
- tank low-level interlock
- fault feedback

### 6.3 GH Valves

GH valves mengatur jalur dedicated milik GH:

- raw-water inlet
- nutrient inlet
- mixing path
- distribution path
- return/flush path
- drain path jika tersedia

Valve tidak boleh dianggap `CLOSED` hanya karena command telah dikirim. UI harus menunggu state feedback:

```text
COMMAND_SENT
  -> MOVING
  -> OPEN / CLOSED
  -> FAULT / UNKNOWN
```

### 6.4 GH Sensors

Sensor GH memiliki `scope = GH` dan `gh_id`.

Minimal:

- temperature
- humidity
- light
- flow jika tersedia
- water level jika tersedia

Future:

- EC
- pH
- pressure
- nutrient concentration

Sensor optional tetap ditampilkan oleh UI sebagai disabled atau unavailable, bukan disembunyikan.

---

## 7. Water and Dosing Flow

### 7.1 Raw-water path

```text
Well
  -> Well Pump
  -> Raw-Water Flow Meter
  -> Main Raw-Water Tank
  -> GH Raw-Water Valve
  -> GH Mixing Tank
```

### 7.2 Nutrient path

```text
Central Nutrient Source
  -> Central Dosing Pump
  -> Dosing Valve
  -> Selected GH Mixing Tank
```

### 7.3 Mixing path

```text
GH Mixing Tank
  +-- Raw water volume
  +-- Nutrient A
  +-- Nutrient B
  +-- Mixing process
  +-- Low-level boundary sensor
```

### 7.4 Distribution path

```text
GH Mixing Tank
  -> GH Distribution Pump
  -> GH Valve
  -> Plant Distribution Line
```

### 7.5 Return/flush path

```text
GH Mixing Tank or distribution line
  -> Return/Flush Valve
  -> Approved return or drain destination
```

Return/flush operation harus memiliki safety policy dan tidak boleh dijalankan jika destination belum tervalidasi.

---

## 8. Schedule Ownership

### Complex schedule

Schedule Complex-level mengatur shared resources:

- well pump
- main tank filling
- shared dosing pump reservation
- central valve routing

### GH schedule

Schedule GH-level mengatur dedicated resources:

- mixing tank fill request
- nutrient dosing request
- mixing sequence
- distribution pump
- fan
- GH valves

### Shared resource reservation

Sebelum schedule berjalan:

```text
Schedule request
  -> Validate GH mapping
  -> Validate mixing tank
  -> Validate distribution pump
  -> Validate dosing pump availability
  -> Validate valve route
  -> Validate raw-water volume
  -> Validate calibration
  -> Validate safety state
  -> Reserve shared resources
  -> Execute
```

Jika satu resource shared sedang digunakan, scheduler harus:

- mengantrekan operasi
- menjadwalkan ulang
- atau menolak operasi dengan error yang jelas

UI boleh mensimulasikan tabrakan, tetapi keputusan final harus divalidasi ulang oleh Python dan ESP32.

---

## 9. Inventory vs Configuration

Inventory menjawab:

> Hardware apa yang tersedia pada ESP32?

Configuration menjawab:

> Hardware tersebut digunakan untuk apa?

Contoh:

```text
Inventory:
PUMP-DOSE-03 tersedia.

Configuration:
PUMP-DOSE-03 belum dipetakan ke operasi tertentu.
```

Penambahan inventory tidak otomatis mengaktifkan schedule.

UI harus:

1. menangkap inventory baru
2. menampilkan component baru
3. membuat configuration kosong/default
4. menampilkan status `NOT_CONFIGURED`
5. meminta admin melakukan mapping
6. memvalidasi configuration
7. mengirim configuration valid ke Python/ESP32

---

## 10. Hardware Availability States

Status availability dan actuator state adalah dua hal berbeda.

Contoh:

```text
status = AVAILABLE
state  = OFF
```

Artinya hardware sehat tetapi tidak sedang berjalan.

Status component:

```text
AVAILABLE
OFFLINE
FAULT
DISABLED
UNKNOWN
```

State actuator:

```text
OFF
ON
OPEN
CLOSED
MOVING
FAULT
UNKNOWN
```

State sensor:

```text
ONLINE
OFFLINE
INVALID
FAULT
UNKNOWN
```

---

## 11. UI Behavior

UI harus konsisten pada semua halaman.

### Dashboard

Menampilkan:

- status Complex
- status ESP32
- shared resource alarms
- GH summary
- stale-data indicator
- active runs

### Complex page

Menampilkan:

- inventory Complex
- well pump
- main raw-water tank
- raw-water flow meter
- central dosing pumps
- dosing valves
- configuration status
- synchronization status

### GH page

Menampilkan:

- GH telemetry
- GH mixing tank
- GH distribution pump
- GH valves
- GH sensors
- GH schedules
- GH-specific logs
- GH-specific alarms

### Schedule page

Menampilkan:

- schedule seluruh GH dalam Complex
- shared resource reservations
- collision simulation
- queue
- schedule validation errors

### Fertigation page

Menampilkan:

- current runs seluruh GH dalam Complex
- central dosing queue
- dosing pump status
- shared tank and water status
- history dan command status

### Calibration page

Menampilkan:

- sensor dan pump yang tersedia
- scope Complex/GH
- calibration due status
- calibration history
- unavailable hardware secara disabled

---

## 12. Synchronization Flow

```text
UI requests sync
      |
      v
Python requests inventory from ESP32
      |
      v
ESP32 returns inventory_version + components
      |
      v
Python/UI compares inventory and configuration
      |
      +-- No change -> mark synchronized
      |
      +-- New hardware -> create NOT_CONFIGURED component
      |
      +-- Missing hardware -> configuration warning/error
      |
      +-- Changed capability -> require validation
      |
      v
UI displays resulting state
```

Configuration activation:

```text
UI edit
  -> Python validation
  -> ESP32 validation
  -> ESP32 stores LAST_VALID_CONFIGURATION
  -> ESP32 activates only valid configuration
  -> UI receives command/configuration receipt
```

---

## 13. Offline Behavior

Jika Python offline:

1. UI menampilkan last known snapshot.
2. UI menampilkan status `PYTHON_OFFLINE` dan umur data.
3. Jika direct ESP32 enabled dan dapat dijangkau, UI mencoba ESP32.
4. Command diberi status pending/queued sampai ada acknowledgement.
5. UI tidak menganggap command berhasil sebelum menerima receipt.
6. Saat Python online kembali, data direkonsiliasi berdasarkan version dan timestamp.

ESP32 tetap menjadi authority untuk:

- actuator safety
- final configuration validation
- runtime state
- emergency stop
- safe state

---

## 14. Non-Negotiable Rules

1. Satu ESP32 mengendalikan satu Complex.
2. Satu GH hanya dimiliki satu Complex.
3. Satu mixing tank hanya melayani satu GH.
4. Satu distribution pump hanya melayani satu GH.
5. Central dosing pump adalah shared resource dan harus melalui reservation/queue.
6. Component identity memakai `component_id`, bukan display name.
7. Inventory tidak sama dengan configuration.
8. Hardware optional tidak disembunyikan dari UI.
9. Hardware `UNKNOWN`, `FAULT`, atau `DISABLED` tidak boleh menjalankan operasi critical.
10. ESP32 harus mempertahankan `LAST_VALID_CONFIGURATION` jika configuration baru ditolak.
11. UI boleh melakukan simulasi collision, tetapi backend/ESP32 melakukan validasi final.
12. Semua timestamp komunikasi menggunakan UTC ISO-8601.
13. Semua operasi physical command harus memiliki command receipt dan audit event.
14. Perubahan hardware inventory tidak otomatis mengaktifkan schedule baru.
