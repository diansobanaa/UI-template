# HARDWARE_MAPPING.md

# Greenhouse Regulator System — Hardware Mapping Specification

## 1. Purpose

Dokumen ini mendefinisikan bagaimana hardware fisik dipetakan menjadi component yang dikenali oleh ESP32.

Tujuan utama:

* setiap hardware memiliki `component_id`,
* component dapat memiliki nama bebas,
* component dapat ditambahkan secara scalable,
* Backend dapat meminta inventory hardware dari ESP32,
* configuration dapat divalidasi terhadap hardware yang benar-benar tersedia,
* firmware tidak bergantung pada nama fisik yang kaku,
* sensor dapat ditempatkan pada level `COMPLEX` atau `GH`,
* hardware yang belum tersedia dapat ditandai sebagai optional,
* penambahan component baru tidak selalu membutuhkan perubahan firmware.

---

# 2. Hardware Architecture

Satu ESP32 mengendalikan satu Complex.

```text
ESP32
│
└── Complex
    │
    ├── Raw Water System
    │   ├── Well Pump
    │   ├── Raw Water Flow Meter
    │   └── Raw Water Tank
    │
    ├── Central Dosing System
    │   ├── Dosing Pump 01
    │   ├── Dosing Pump 02
    │   ├── Dosing Pump ...
    │   └── Fertilizer Source
    │
    ├── GH-01
    │   ├── Mixing Tank
    │   ├── Distribution Pump
    │   ├── Valves
    │   └── Sensors
    │
    ├── GH-02
    │   ├── Mixing Tank
    │   ├── Distribution Pump
    │   ├── Valves
    │   └── Sensors
    │
    └── ...
```

---

# 3. Component Hierarchy

Component memiliki:

```text
Complex
   ↓
Component
   ↓
Capability
```

Untuk component yang secara khusus dimiliki GH:

```text
Complex
   ↓
GH
   ↓
Component
```

Contoh:

```text
COMPLEX-01
│
├── PUMP-WELL-01
├── FLOW-RAW-01
├── PUMP-DOSE-01
├── PUMP-DOSE-02
│
├── GH-01
│   ├── TANK-MIX-01
│   ├── PUMP-DIST-01
│   ├── VALVE-01
│   └── SENSOR-TEMP-01
│
└── GH-02
    ├── TANK-MIX-02
    ├── PUMP-DIST-02
    └── VALVE-02
```

---

# 4. Component ID

Setiap component memiliki ID unik.

Format yang direkomendasikan:

```text
<TYPE>-<NUMBER>
```

Contoh:

```text
PUMP-001
PUMP-002
VALVE-001
FLOW-001
TEMP-001
HUM-001
LIGHT-001
TANK-001
```

Untuk sistem yang membutuhkan konteks lebih jelas:

```text
PUMP-WELL-01
PUMP-DOSE-01
PUMP-DIST-GH01
FLOW-RAW-01
FLOW-MIX-GH01
```

Firmware harus menggunakan `component_id`, bukan display name.

---

# 5. Custom Component Name

User dapat memberikan nama bebas.

Contoh:

```json
{
  "component_id": "PUMP-DOSE-01",
  "name": "Pompa AB Utama"
}
```

Nama dapat diubah tanpa mengubah `component_id`.

Contoh perubahan:

```text
Pompa AB Utama
        ↓
Pompa Nutrisi A
```

`component_id` tetap:

```text
PUMP-DOSE-01
```

---

# 6. Component Type

MVP-1 minimal mendukung:

```text
PUMP
VALVE
FLOW_METER
SENSOR
MIXING_TANK
WATER_TANK
```

Component type harus membedakan physical role.

---

# 7. Pump Categories

Pump dibagi menjadi beberapa role.

## 7.1 Well Pump

Pump dari sumur ke tandon air baku.

```text
Role:
WELL_TO_RAW_TANK
```

Contoh:

```json
{
  "component_id": "PUMP-WELL-01",
  "type": "PUMP",
  "role": "WELL_TO_RAW_TANK"
}
```

Pump ini memiliki schedule sendiri.

---

## 7.2 Dosing Pump

Pump dosing terpusat.

Contoh:

```text
PUMP-DOSE-01
PUMP-DOSE-02
PUMP-DOSE-03
```

Role:

```text
CENTRAL_DOSING
```

Jumlah dosing pump scalable.

User dapat:

```text
Tambah Pompa Dosing
        ↓
Name
        ↓
Role
        ↓
Calibration
```

---

## 7.3 Distribution Pump

Pump dari mixing tank ke tanaman.

Setiap GH memiliki distribution pump sendiri.

Contoh:

```text
GH-01 → PUMP-DIST-01
GH-02 → PUMP-DIST-02
GH-03 → PUMP-DIST-03
```

Role:

```text
GH_DISTRIBUTION
```

---

# 8. Valve

Valve digunakan untuk mengarahkan distribution ke GH atau mengatur jalur air.

Contoh:

```json
{
  "component_id": "VALVE-GH01-01",
  "type": "VALVE",
  "gh_id": "GH-01",
  "role": "DISTRIBUTION"
}
```

Valve harus memiliki state:

```text
OPEN
CLOSED
UNKNOWN
FAULT
```

---

# 9. Mixing Tank

Satu mixing tank hanya melayani satu GH.

Contoh:

```text
GH-01
  ↓
TANK-MIX-GH01

GH-02
  ↓
TANK-MIX-GH02
```

Tidak boleh:

```text
TANK-MIX-01
 ↓
GH-01
GH-02
```

untuk konfigurasi normal sistem.

---

# 10. Mixing Tank Component

Contoh:

```json
{
  "component_id": "TANK-MIX-GH01",
  "type": "MIXING_TANK",
  "name": "Mixing Tank GH 01",
  "gh_id": "GH-01"
}
```

Data yang dapat dimiliki:

```text
capacity_ml
minimum_volume_ml
maximum_volume_ml
```

---

# 11. Flow Meter

Flow meter dapat digunakan pada beberapa titik.

MVP-1 minimal:

```text
Raw Water Flow Meter
```

untuk menghitung volume air dari tandon/sumber air.

Contoh:

```json
{
  "component_id": "FLOW-RAW-01",
  "type": "FLOW_METER",
  "role": "RAW_WATER"
}
```

Flow meter tambahan dapat ditambahkan kemudian.

---

# 12. Flow Meter Internal Unit

ESP32 menggunakan:

```text
ml
ml/s
```

untuk perhitungan internal.

UI dapat menggunakan:

```text
ml
L
```

Backend dapat melakukan conversion.

---

# 13. Sensor Categories

Sensor dapat berada pada level:

```text
COMPLEX
```

atau:

```text
GH
```

## 13.1 Camera Components

Camera adalah component optional yang dapat dimiliki oleh GH. Kamera tidak dianggap sensor dan tidak boleh di-hardcode sebagai jumlah tetap.

Contoh inventory:

```json
{
  "component_id": "CAM-GH01-01",
  "type": "CAMERA",
  "name": "Camera 1",
  "scope": "GH",
  "gh_id": "GH-01",
  "status": "AVAILABLE",
  "enabled": true,
  "required": false,
  "capabilities": ["SNAPSHOT", "STREAM"],
  "captured_at": "2026-09-08T09:37:00Z"
}
```

Camera status minimal:

```text
AVAILABLE
OFFLINE
FAULT
DISABLED
UNKNOWN
```

Jika inventory tidak memiliki camera untuk GH, UI tetap menampilkan camera area dalam keadaan inactive dengan status `NOT INSTALLED`. Jumlah camera, nama, status, URL snapshot/stream, dan waktu capture harus berasal dari inventory/runtime data, bukan angka hardcoded.

Contoh Complex-level:

```text
Outdoor / central sensor
```

Contoh GH-level:

```text
GH temperature
GH humidity
GH light
```

---

# 14. Sensor Types

MVP-1 minimal mendukung:

```text
TEMPERATURE
HUMIDITY
LIGHT
FLOW
```

Sensor tambahan dapat ditambahkan.

Contoh future:

```text
EC
PH
PRESSURE
WATER_LEVEL
```

Tidak semua sensor harus tersedia pada MVP-1.

---

# 15. Sensor Scope

Setiap sensor memiliki:

```text
scope
```

Nilai:

```text
COMPLEX
GH
```

Contoh:

```json
{
  "component_id": "SENSOR-TEMP-01",
  "type": "SENSOR",
  "sensor_type": "TEMPERATURE",
  "scope": "GH",
  "gh_id": "GH-01"
}
```

---

# 16. Required vs Optional Component

Component dapat memiliki:

```text
required
optional
```

Contoh:

```json
{
  "component_id": "SENSOR-EC-01",
  "required": false
}
```

Jika component optional tidak tersedia, configuration tetap dapat valid jika feature tersebut tidak digunakan.

Jika component mandatory digunakan oleh configuration tetapi tidak ditemukan:

```text
CONFIG-004
```

Configuration harus ditolak.

---

# 17. Hardware Inventory

ESP32 harus dapat memberikan inventory hardware kepada Backend.

Inventory minimal:

```text
device_id
firmware_version
hardware_version
component list
component state
component capability
```

---

# 18. Inventory JSON

Contoh:

```json
{
  "device_id": "ESP32-COMPLEX-01",
  "complex_id": "COMPLEX-01",
  "firmware_version": "0.1.0",
  "hardware_version": "REV-A",
  "inventory_version": 12,
  "components": [
    {
      "component_id": "PUMP-WELL-01",
      "type": "PUMP",
      "role": "WELL_TO_RAW_TANK",
      "name": "Pompa Sumur",
      "scope": "COMPLEX",
      "status": "AVAILABLE"
    },
    {
      "component_id": "FLOW-RAW-01",
      "type": "FLOW_METER",
      "role": "RAW_WATER",
      "name": "Flow Meter Air Baku",
      "scope": "COMPLEX",
      "status": "AVAILABLE"
    },
    {
      "component_id": "PUMP-DOSE-01",
      "type": "PUMP",
      "role": "CENTRAL_DOSING",
      "name": "Pompa A",
      "scope": "COMPLEX",
      "status": "AVAILABLE"
    },
    {
      "component_id": "PUMP-DOSE-02",
      "type": "PUMP",
      "role": "CENTRAL_DOSING",
      "name": "Pompa B",
      "scope": "COMPLEX",
      "status": "AVAILABLE"
    },
    {
      "component_id": "TANK-MIX-GH01",
      "type": "MIXING_TANK",
      "role": "GH_MIXING",
      "name": "Mixing Tank GH 01",
      "scope": "GH",
      "gh_id": "GH-01",
      "status": "AVAILABLE"
    },
    {
      "component_id": "PUMP-DIST-GH01",
      "type": "PUMP",
      "role": "GH_DISTRIBUTION",
      "name": "Pompa Distribusi GH 01",
      "scope": "GH",
      "gh_id": "GH-01",
      "status": "AVAILABLE"
    }
  ]
}
```

---

# 19. Component Status

Minimal:

```text
AVAILABLE
OFFLINE
FAULT
DISABLED
UNKNOWN
```

Status tidak sama dengan actuator state.

Contoh:

```text
status = AVAILABLE
state = OFF
```

berarti component sehat tetapi sedang tidak digunakan.

---

# 20. Pump State

Pump minimal memiliki:

```text
OFF
ON
FAULT
UNKNOWN
```

---

# 21. Valve State

Valve minimal:

```text
OPEN
CLOSED
MOVING
FAULT
UNKNOWN
```

---

# 22. Sensor State

Sensor minimal:

```text
ONLINE
OFFLINE
INVALID
FAULT
UNKNOWN
```

---

# 23. GPIO Mapping

Physical GPIO mapping dipisahkan dari logical component identity.

Contoh:

```json
{
  "component_id": "PUMP-DOSE-01",
  "hardware": {
    "gpio": 25,
    "active_level": "HIGH"
  }
}
```

`component_id` tetap stabil meskipun GPIO berubah pada hardware revision yang berbeda.

---

# 24. GPIO Safety

Setiap actuator GPIO harus memiliki safe default.

Contoh:

```json
{
  "component_id": "PUMP-DIST-GH01",
  "hardware": {
    "gpio": 26,
    "active_level": "HIGH",
    "safe_state": "OFF"
  }
}
```

Saat boot:

```text
GPIO initialize
      ↓
SAFE STATE
      ↓
Scheduler
```

---

# 25. Hardware Abstraction

Firmware harus memisahkan:

```text
Business/Operation Logic
```

dari:

```text
GPIO / Physical Hardware
```

Struktur konseptual:

```text
Scheduler
   ↓
Component ID
   ↓
Component Manager
   ↓
Hardware Driver
   ↓
GPIO
```

Contoh:

```text
PUMP-DOSE-01
```

tidak boleh digunakan langsung sebagai:

```text
GPIO 25
```

di seluruh source code.

---

# 26. Component Capability

Setiap component dapat mendeklarasikan capability.

Contoh pump:

```json
{
  "component_id": "PUMP-DOSE-01",
  "capabilities": [
    "ON_OFF",
    "TIMED_RUN",
    "DOSING"
  ]
}
```

Distribution pump:

```json
{
  "component_id": "PUMP-DIST-GH01",
  "capabilities": [
    "ON_OFF",
    "TIMED_RUN",
    "FLOW_CONTROL"
  ]
}
```

---

# 27. Capability Validation

Configuration tidak hanya memeriksa component ID.

Firmware juga harus memeriksa capability.

Contoh:

```text
Configuration:
pump = PUMP-DIST-GH01
operation = DOSING
```

Jika pump tidak memiliki capability:

```text
DOSING
```

configuration harus ditolak.

---

# 28. Component Addition

Component baru dapat ditambahkan ke hardware inventory.

Contoh:

```text
Existing:

PUMP-DOSE-01
PUMP-DOSE-02

User:
Tambah Pompa Dosing

↓

PUMP-DOSE-03
```

Backend kemudian melakukan synchronization.

---

# 29. Component Synchronization

Ketika user meminta synchronization:

```text
Backend
   ↓
SYNC REQUEST
   ↓
ESP32
   ↓
GET HARDWARE INVENTORY
   ↓
JSON
   ↓
Backend
```

Backend kemudian memperbarui inventory.

---

# 30. Inventory Is Not Configuration

Inventory menjawab:

```text
"Apa hardware yang tersedia?"
```

Configuration menjawab:

```text
"Bagaimana hardware tersebut digunakan?"
```

Contoh:

```text
Inventory:
PUMP-DOSE-01 tersedia.

Configuration:
PUMP-DOSE-01 digunakan sebagai Dosing A.
```

---

# 31. Hardware Mismatch

Jika configuration membutuhkan:

```text
PUMP-DOSE-03
```

tetapi inventory hanya:

```text
PUMP-DOSE-01
PUMP-DOSE-02
```

maka:

```text
CONFIG-004
```

Configuration ditolak seluruhnya.

ESP32 mempertahankan:

```text
LAST_VALID_CONFIGURATION
```

---

# 32. GH Mapping

GH memiliki identity sendiri.

Contoh:

```json
{
  "gh_id": "GH-01",
  "name": "GH Utara"
}
```

Component GH memiliki:

```text
gh_id
```

sehingga hubungan dapat diketahui.

Contoh:

```text
GH-01
 ├── TANK-MIX-GH01
 ├── PUMP-DIST-GH01
 ├── VALVE-GH01-01
 └── SENSOR-TEMP-GH01
```

---

# 33. One Mixing Tank — One GH

MVP-1 rule:

```text
1 Mixing Tank
      ↓
1 GH
```

Satu mixing tank tidak boleh dikonfigurasi untuk melayani beberapa GH secara bersamaan.

---

# 34. One Distribution Pump — One GH

MVP-1 rule:

```text
1 Distribution Pump
      ↓
1 GH
```

Hal ini memungkinkan distribution antar-GH dilakukan secara bersamaan.

---

# 35. Central Dosing Pump

Dosing pump dapat melayani beberapa GH.

Contoh:

```text
DP-01
 ├── GH-01
 ├── GH-02
 └── GH-03
```

Karena merupakan shared resource, penggunaan diatur queue.

---

# 36. Well Pump

Well pump merupakan resource Complex.

```text
COMPLEX-01
   ↓
PUMP-WELL-01
   ↓
RAW WATER TANK
```

Schedule well pump dikelola pada Complex level.

---

# 37. Raw Water Flow Meter

Flow meter raw water mengukur air yang masuk ke raw water tank.

```text
Well
 ↓
Well Pump
 ↓
Flow Meter
 ↓
Raw Water Tank
```

Data flow digunakan untuk:

* volume measurement,
* telemetry,
* water management,
* event detection.

---

# 38. Hardware Safety Classification

Component dapat memiliki:

```text
safety_class
```

Contoh:

```text
CRITICAL
NORMAL
MONITORING
```

Critical component dapat mempengaruhi safe state.

Contoh:

```text
Emergency sensor
Flow meter saat dosing
Valve saat distribution
```

---

# 39. Hardware Configuration Schema

Contoh struktur umum:

```json
{
  "component_id": "PUMP-DOSE-01",
  "type": "PUMP",
  "role": "CENTRAL_DOSING",
  "name": "Pompa Nutrisi A",
  "scope": "COMPLEX",
  "gh_id": null,
  "status": "AVAILABLE",
  "enabled": true,
  "required": true,
  "capabilities": [
    "ON_OFF",
    "TIMED_RUN",
    "DOSING"
  ],
  "hardware": {
    "driver": "RELAY",
    "gpio": 25,
    "active_level": "HIGH",
    "safe_state": "OFF"
  },
  "limits": {
    "max_runtime_seconds": 120
  }
}
```

---

# 40. Hardware Inventory Version

Inventory memiliki:

```text
inventory_version
```

Contoh:

```text
11
```

setelah component ditambahkan:

```text
12
```

Version digunakan untuk synchronization.

---

# 41. Inventory Synchronization Rule

Backend dapat meminta:

```text
SYNC INVENTORY
```

ESP32 mengirim inventory terbaru.

Jika inventory berubah:

```text
Inventory Version++
```

Perubahan inventory tidak otomatis mengubah active configuration.

---

# 42. Configuration vs Inventory Update

Jika hardware ditambahkan:

```text
Inventory update
```

tidak berarti component langsung digunakan.

Contoh:

```text
Tambah DP-03
        ↓
Inventory = DP-03 tersedia
```

Tetapi:

```text
DP-03 belum digunakan
```

sampai configuration baru menentukan penggunaannya.

---

# 43. Runtime Discovery

ESP32 tidak perlu melakukan automatic hardware discovery terhadap semua GPIO pada MVP-1.

Hardware mapping dapat berasal dari:

```text
Firmware Hardware Definition
```

atau:

```text
Hardware Profile
```

kemudian diekspos sebagai inventory.

Tujuan utama MVP-1 adalah menyediakan **logical inventory**, bukan plug-and-play physical autodetection.

---

# 44. Unknown Hardware

Jika ESP32 menemukan hardware state yang tidak diketahui:

```text
UNKNOWN
```

component tidak boleh digunakan untuk operation critical sampai status dapat dipastikan.

---

# 45. Disabled Component

Component dapat:

```text
enabled = false
```

Component disabled tidak boleh digunakan scheduler.

Configuration yang mencoba menggunakan component disabled harus ditolak atau operation tidak dijalankan sesuai validation policy.

---

# 46. Hardware Availability

Sebelum operation:

```text
Configuration
   ↓
Component exists?
   ↓
Enabled?
   ↓
Available?
   ↓
Capability valid?
   ↓
Safety valid?
```

Baru kemudian operation boleh berjalan.

---

# 47. MVP-1 Required Hardware Model

MVP-1 minimal mendukung model:

```text
1 ESP32
1 Complex

1+ Well Pump
1+ Raw Water Flow Meter

1+ Dosing Pump
1+ Mixing Tank per GH
1+ Distribution Pump per GH
1+ Valve per distribution path

0+ Temperature Sensors
0+ Humidity Sensors
0+ Light Sensors
```

Jumlah aktual mengikuti hardware yang tersedia.

---

# 48. Scalable Hardware Rule

Firmware harus dirancang agar:

```text
1 dosing pump
```

dan:

```text
10 dosing pumps
```

menggunakan model component yang sama.

Tidak boleh membuat hard-coded logic seperti:

```text
if pump == A
if pump == B
```

untuk membatasi jumlah pump.

Gunakan:

```text
component_id
role
capability
configuration
```

---

# 49. Hardware Naming Rule

Nama component boleh bebas.

Contoh valid:

```text
Pompa A
Pompa Nutrisi A
Dosing Kalsium
Pompa AB Utama
Pump-Alpha
```

Nama tidak digunakan sebagai primary identity.

Primary identity:

```text
component_id
```

---

# 50. MVP-1 Acceptance Criteria

## Inventory

* [ ] ESP32 dapat mengirim hardware inventory.
* [ ] Inventory memiliki device ID.
* [ ] Inventory memiliki complex ID.
* [ ] Inventory memiliki firmware version.
* [ ] Inventory memiliki inventory version.
* [ ] Setiap component memiliki unique ID.
* [ ] Setiap component memiliki type.
* [ ] Setiap component memiliki role.
* [ ] Component dapat memiliki custom name.

## Pump

* [ ] Well pump dapat didefinisikan.
* [ ] Dosing pump dapat didefinisikan.
* [ ] Jumlah dosing pump tidak hard-coded.
* [ ] Distribution pump dapat dikaitkan dengan GH.
* [ ] Pump memiliki safe state.

## GH

* [ ] Component dapat dikaitkan dengan GH.
* [ ] Satu mixing tank hanya melayani satu GH.
* [ ] Satu distribution pump hanya melayani satu GH.
* [ ] Distribution antar-GH dapat berjalan concurrent.

## Sensor

* [ ] Sensor dapat memiliki scope Complex.
* [ ] Sensor dapat memiliki scope GH.
* [ ] Sensor dapat ditandai optional.
* [ ] Sensor dapat ditandai critical.

## Synchronization

* [ ] Backend dapat meminta inventory synchronization.
* [ ] ESP32 dapat mengirim inventory JSON.
* [ ] Inventory version dapat berubah.
* [ ] Penambahan component dapat terdeteksi.
* [ ] Inventory update tidak otomatis mengubah configuration.

## Configuration Validation

* [ ] Configuration menggunakan component ID.
* [ ] Missing component ditolak.
* [ ] Disabled component ditolak.
* [ ] Invalid capability ditolak.
* [ ] Invalid GH mapping ditolak.
* [ ] Invalid mixing tank mapping ditolak.

## Safety

* [ ] GPIO memiliki safe default.
* [ ] Unknown actuator state ditangani.
* [ ] Critical hardware failure dapat memicu safe state.

---

# 51. Relationship With Other Documents

```text
PRODUCT_SPEC.md
      ↓
ARCHITECTURE.md
      ↓
DATA_MODEL.md
      ↓
API_SPEC.md
      ↓
CONFIGURATION_SPEC.md
      ↓
HARDWARE_MAPPING.md
      ↓
FIRMWARE_STATE_MACHINE.md
      ↓
ERROR_CODES.md
      ↓
FIRMWARE_STORAGE.md
```

`HARDWARE_MAPPING.md` menjawab:

> Hardware apa yang tersedia dan bagaimana ESP32 mengenalinya?

`CONFIGURATION_SPEC.md` menjawab:

> Bagaimana hardware tersebut dikonfigurasi?

`FIRMWARE_STATE_MACHINE.md` menjawab:

> Bagaimana ESP32 menjalankan konfigurasi tersebut?

`ERROR_CODES.md` menjawab:

> Apa yang dilakukan ketika terjadi masalah?

---

# 52. Final Principle

Hardware harus diperlakukan sebagai **resource yang memiliki identity, capability, state, dan safety characteristics**.

Model utama:

```text
Component ID
     ↓
Component Type
     ↓
Role
     ↓
Capability
     ↓
Hardware Mapping
     ↓
Configuration
     ↓
Runtime State
```

Dengan model ini, sistem dapat berkembang dari:

```text
1 ESP32
1 GH
2 Dosing Pumps
```

menjadi:

```text
1 ESP32
Multiple GH
Multiple Dosing Pumps
Multiple Sensors
Multiple Valves
```

tanpa mengubah konsep dasar firmware.
