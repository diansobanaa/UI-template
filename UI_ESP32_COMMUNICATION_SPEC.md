# UI ↔ ESP32 COMMUNICATION SPEC

**Status:** Draft implementation-ready untuk MVP WLAN lokal  
**Scope:** komunikasi langsung Web UI/Vite ↔ ESP32 controller  
**Out of scope:** database Python secara penuh, autentikasi, internet/cloud, dan domain kontrol fertigasi secara rinci.

---

## 1. Tujuan

Dokumen ini mendefinisikan kontrak komunikasi antara **UI/Browser** dan **ESP32 controller** yang menjadi pengendali satu Complex.

Tujuan utama:

- UI dapat menemukan dan terhubung ke ESP32 melalui WLAN lokal.
- UI dapat membaca kondisi aktual ESP32.
- UI dapat mengirim configuration dan command yang memang diperlukan ESP32.
- ESP32 tetap beroperasi tanpa UI maupun internet.
- UI tidak pernah menjadikan localStorage/mock state sebagai physical truth.
- Status aktual berasal dari ESP32.
- Request dapat direkonsiliasi jika response HTTP hilang.
- Configuration memiliki versioning dan atomic apply.
- Telemetry/event dapat dibaca UI dan diteruskan ke Python pada lapisan berikutnya.
- Protokol dapat menangani banyak Complex dan banyak ESP32 pada satu WLAN.

---

# 2. Arsitektur Komunikasi MVP

## 2.1 Network

MVP menggunakan **WLAN lokal**.

```text
                    LOCAL WLAN
                        │
          ┌─────────────┴─────────────┐
          │                           │
      PC / HP                      ESP32
          │                           │
     Web Browser                HTTP REST API
          │                           │
      Vite Web App                 Runtime
```

Internet **tidak diperlukan**.

Cloud, remote access, VPN, dan gateway internet bukan bagian dari MVP.

## 2.2 Transport

Transport utama:

```text
HTTP REST over local WLAN
```

MVP tidak menggunakan MQTT sebagai protokol wajib UI ↔ ESP32.

Streaming/WebSocket dapat ditambahkan kemudian jika polling tidak cukup, tetapi tidak boleh menjadi prasyarat arsitektur dasar.

---

# 3. Device Discovery

## 3.1 Prinsip

UI **tidak perlu mengetahui IP ESP32 secara hardcode**.

ESP32 diberi identity tetap dan hostname lokal.

Contoh:

```text
Device ID : esp32-complex-001
Hostname  : esp32-complex-001.local
```

UI mencari controller melalui local-network discovery/hostname resolution.

## 3.2 mDNS

MVP menggunakan mDNS untuk local discovery.

ESP32 mengiklankan hostname:

```text
esp32-complex-001.local
```

dan dapat mengiklankan service aplikasi, misalnya:

```text
_agrotech._tcp
```

Service dapat membawa metadata minimal:

```text
deviceId=esp32-complex-001
complexId=complex-001
deviceType=greenhouse-controller
apiVersion=1
```

## 3.3 Browser limitation

Browser tidak dianggap memiliki kemampuan raw mDNS service browsing yang seragam pada semua platform.

Karena itu kontrak UI menggunakan dua tingkat discovery:

```text
PRIMARY
mDNS hostname / local hostname resolution

FALLBACK
last-known IP address yang sebelumnya berhasil digunakan
```

UI tidak boleh menganggap fallback IP sebagai identity.

## 3.4 Device verification setelah discovery

Setelah host ditemukan, UI wajib memanggil:

```http
GET /api/v1/health
```

UI mencocokkan minimal:

```text
deviceId
complexId
apiVersion
```

Jika identity tidak sesuai dengan controller yang sedang dicari, device tidak boleh dianggap connected.

---

# 4. IP Address dan Hostname

## 4.1 IP bukan identity

IP dapat berubah akibat DHCP.

Contoh:

```text
Hari 1 → 192.168.1.50
Hari 2 → 192.168.1.64
```

Identity tetap:

```text
esp32-complex-001
```

## 4.2 Konfigurasi ESP32

ESP32 boleh menggunakan DHCP pada WLAN selama hostname mDNS stabil.

Hardcode yang diprioritaskan pada firmware:

```cpp
DEVICE_ID
COMPLEX_ID
MDNS_HOSTNAME
```

Bukan IP address.

Static IP tetap diperbolehkan sebagai opsi deployment, tetapi tidak menjadi dependency protocol UI.

## 4.3 Cache UI

UI dapat menyimpan:

```json
{
  "deviceId": "esp32-complex-001",
  "complexId": "complex-001",
  "hostname": "esp32-complex-001.local",
  "lastKnownIp": "192.168.1.50",
  "port": 80,
  "lastSeenAt": "2026-09-13T02:00:00+07:00"
}
```

Cache adalah optimization, bukan authority.

---

# 5. Security Boundary MVP

Untuk MVP:

```text
Authentication : NONE
Authorization  : NONE
HTTPS          : NONE
Internet       : NONE
Trust boundary : local WLAN
```

Ini adalah keputusan eksplisit MVP, bukan omission.

Konsekuensinya: siapa pun yang memiliki akses ke WLAN lokal secara teknis dapat mencoba mengakses API ESP32.

Authentication, authorization, TLS, pairing, dan signed request dapat menjadi fase berikutnya tanpa mengubah identity model.

---

# 6. Device Identity

## 6.1 Required identity

```json
{
  "deviceId": "esp32-complex-001",
  "complexId": "complex-001"
}
```

Aturan:

- satu ESP32 mengontrol satu Complex;
- `deviceId` immutable;
- `complexId` adalah binding domain device;
- IP/hostname bukan pengganti `deviceId`;
- UI tidak membuat device ID baru ketika reconnect.

## 6.2 API version dan schema version

Setiap response device sebaiknya membawa:

```json
{
  "apiVersion": "1",
  "schemaVersion": "1"
}
```

Ini memungkinkan UI mengetahui kompatibilitas sebelum memproses response.

---

# 7. Health Endpoint

## Request

```http
GET /api/v1/health
```

## Response minimum

```json
{
  "apiVersion": "1",
  "schemaVersion": "1",
  "deviceId": "esp32-complex-001",
  "complexId": "complex-001",
  "firmwareVersion": "1.0.0",
  "uptimeSec": 123456,
  "bootId": "boot-20260913-001",
  "currentTime": "2026-09-13T02:10:00+07:00",
  "timezone": "Asia/Jakarta",
  "configurationVersion": 17,
  "inventoryVersion": 3,
  "runtimeState": "IDLE",
  "emergencyStop": false,
  "health": "OK"
}
```

Health dipakai untuk menentukan apakah device benar-benar reachable dan valid.

HTTP `200` tidak berarti seluruh subsystem sehat. Field `health` dan status runtime harus tetap diperiksa.

---

# 8. Full Device Status Snapshot

UI membutuhkan satu snapshot authoritative untuk membuka/reconnect halaman tanpa melakukan banyak request terpisah.

## Request

```http
GET /api/v1/status
```

## Response domain

```json
{
  "device": {},
  "health": {},
  "configuration": {},
  "runtime": {},
  "actuators": {},
  "sensors": {},
  "queue": {},
  "safety": {},
  "sync": {}
}
```

Snapshot harus merepresentasikan kondisi device pada satu pengambilan yang koheren sejauh kemampuan firmware.

Snapshot tidak menggantikan endpoint khusus untuk detail/pagination.

---

# 9. Inventory

## Request

```http
GET /api/v1/inventory
```

Inventory menggambarkan hardware fisik yang diketahui ESP32.

Inventory bukan schedule dan bukan business database.

Contoh:

```json
{
  "deviceId": "esp32-complex-001",
  "complexId": "complex-001",
  "inventoryVersion": 3,
  "firmwareVersion": "1.0.0",
  "inventory": {
    "complex": {
      "components": {
        "wellPump": {},
        "rawWaterFlowMeter": {},
        "dosing": {
          "A": { "pump": {}, "valve": {} },
          "B": { "pump": {}, "valve": {} },
          "N": { "pump": {}, "valve": {} }
        }
      }
    },
    "greenhouses": {
      "gh-001": {
        "components": {
          "mixingTank": {},
          "fertigationPump": {},
          "valve": {},
          "lowerLevelSensor": {}
        }
      }
    }
  }
}
```

UI boleh cache inventory.

ESP32 tetap physical authority.

---

# 10. Capability Discovery

Inventory menjawab **hardware apa yang ada**.

Capability menjawab **kemampuan firmware apa yang tersedia**.

## Request

```http
GET /api/v1/capabilities
```

Contoh:

```json
{
  "deviceId": "esp32-complex-001",
  "capabilitiesVersion": 1,
  "capabilities": {
    "configurationRead": true,
    "configurationValidate": true,
    "configurationApply": true,
    "telemetryRead": true,
    "eventRead": true,
    "commandStatus": true,
    "clockSync": true,
    "emergencyStop": true
  }
}
```

UI tidak boleh menampilkan control yang mensyaratkan capability yang tidak tersedia.

---

# 11. Request / Response Envelope

Semua endpoint sebisa mungkin menggunakan envelope konsisten.

## Request

```json
{
  "requestId": "req-01J...",
  "apiVersion": "1",
  "client": {
    "type": "web-ui",
    "version": "1.0.0"
  },
  "payload": {}
}
```

Untuk GET sederhana, query/header dapat membawa request ID bila body tidak digunakan.

## Response

```json
{
  "requestId": "req-01J...",
  "apiVersion": "1",
  "success": true,
  "deviceId": "esp32-complex-001",
  "serverTime": "2026-09-13T02:10:00+07:00",
  "payload": {},
  "error": null
}
```

---

# 12. Request ID, Command ID, Event ID, Sequence

Identifier memiliki fungsi berbeda.

```text
requestId   = satu request HTTP
commandId   = satu operasi fisik/operasional
operationId = satu intent yang harus dapat di-retry secara aman
 eventId    = satu event
sequence    = urutan monotonik data device
```

Untuk MVP `operationId` dapat disamakan dengan `commandId` pada command fisik jika tidak diperlukan pemisahan lebih jauh.

---

# 13. Command Lifecycle

UI tidak boleh menganggap command selesai hanya karena HTTP sukses.

Lifecycle minimum:

```text
CREATED
   ↓
ACCEPTED / REJECTED
   ↓
QUEUED (jika asynchronous)
   ↓
RUNNING
   ↓
COMPLETED / FAILED / CANCELLED
```

Command receipt harus dapat dibaca ulang menggunakan `commandId`.

## Request

```http
GET /api/v1/commands/{commandId}
```

## Contoh response

```json
{
  "commandId": "cmd-001",
  "status": "RUNNING",
  "createdAt": "...",
  "acceptedAt": "...",
  "startedAt": "...",
  "completedAt": null,
  "result": null,
  "error": null
}
```

---

# 14. Idempotency

Semua command yang dapat menyebabkan perubahan fisik harus aman terhadap retry.

Contoh:

```text
UI mengirim command
ESP32 menjalankan command
response HTTP hilang
UI retry
```

ESP32 harus mengenali `commandId`/`operationId` yang sama dan tidak menjalankan operasi fisik dua kali secara tidak sengaja.

Retry request dengan ID yang sama harus mengembalikan status command yang sudah ada.

---

# 15. Desired State vs Actual State

UI dapat mengirim desired state.

ESP32 mengembalikan actual state.

Contoh:

```json
{
  "componentId": "well-pump-01",
  "desiredState": "ON",
  "actualState": "OFF",
  "stateReason": "SAFETY_INTERLOCK",
  "source": "ESP32"
}
```

Ini memungkinkan UI menjelaskan kondisi seperti:

```text
User meminta ON
ESP32 tetap OFF
Reason = safety interlock
```

UI tidak boleh mengganti `actualState` secara lokal hanya karena tombol diklik.

---

# 16. Configuration

## 16.1 Scope

Configuration adalah **desired runtime configuration** yang dibutuhkan ESP32.

UI tidak mengirim seluruh database/object UI.

Configuration projection harus typed dan device-safe.

## 16.2 Configuration version

Setiap applied configuration memiliki version monotonik.

```json
{
  "configurationVersion": 17,
  "expectedConfigurationVersion": 16
}
```

Jika `expectedConfigurationVersion` tidak cocok dengan current device version, ESP32 menolak apply dengan conflict, bukan menimpa secara diam-diam.

## 16.3 Configuration hash

Configuration yang diterapkan juga memiliki hash:

```json
{
  "configurationVersion": 17,
  "configurationHash": "sha256:..."
}
```

Hash membantu membuktikan bahwa dua pihak merujuk pada snapshot yang identik.

## 16.4 Atomic apply

Configuration update harus:

```text
RECEIVE
 ↓
VALIDATE
 ↓
BUILD NEW SNAPSHOT
 ↓
ATOMIC APPLY
```

Jika validation gagal:

```text
Last Valid Configuration tetap aktif
```

Tidak boleh terjadi half-applied configuration.

---

# 17. Configuration API

## Read

```http
GET /api/v1/configuration
```

## Validate

```http
POST /api/v1/configuration/validate
```

## Apply

```http
PUT /api/v1/configuration
```

Contoh response apply:

```json
{
  "configurationVersion": 18,
  "configurationHash": "sha256:...",
  "status": "APPLIED",
  "appliedAt": "..."
}
```

Status konfigurasi minimal:

```text
VALID
INVALID
APPLYING
APPLIED
REJECTED
CONFLICT
```

---

# 18. Queue dan Configuration Replacement

Configuration replacement **tidak otomatis berarti seluruh runtime dihentikan**.

Untuk setiap active/queued operation, ESP32 harus mempertahankan hubungan dengan configuration snapshot yang menjadi dasar operasi tersebut.

Prinsip:

```text
RUNNING operation
    → menggunakan snapshot saat operation dibuat/accepted

NEW operation
    → menggunakan configuration terbaru yang valid
```

Untuk queued operation, kebijakan final harus eksplisit pada domain command/configuration sebelum firmware production. Tidak boleh dibiarkan sebagai side effect tidak terdokumentasi.

---

# 19. Runtime Status

UI harus membaca runtime state dari ESP32.

Minimum state model:

```text
IDLE
QUEUED
RUNNING
PAUSED
COMPLETED
FAILED
CANCELLED
EMERGENCY_STOP
OFFLINE
```

Phase spesifik domain dapat ditambahkan kemudian tanpa mengubah transport semantics.

Contoh:

```json
{
  "runtimeState": "RUNNING",
  "phase": "DOMAIN_PHASE",
  "operationId": "cmd-001",
  "progress": 0.42
}
```

---

# 20. Telemetry

## Request

```http
GET /api/v1/telemetry
```

Telemetry harus membedakan nilai measured dengan nilai derived.

Contoh field:

```json
{
  "deviceTimestamp": "...",
  "sequence": 10042,
  "values": {
    "temperatureC": 29.1,
    "humidityPct": 73.2,
    "flowLpm": 1.8
  },
  "quality": {
    "temperatureC": "GOOD",
    "humidityPct": "GOOD",
    "flowLpm": "GOOD"
  }
}
```

ESP32 adalah sumber actual measurement.

UI boleh menampilkan telemetry live, tetapi historical chart bukan hasil synthetic frontend timer.

---

# 21. Telemetry Timestamp

Timestamp minimal dibedakan menjadi:

```text
deviceTimestamp
receivedAt
processedAt
```

`deviceTimestamp` digunakan untuk makna waktu pengukuran.

UI tidak boleh mengganti device timestamp dengan waktu browser tanpa penandaan.

---

# 22. Event dan Error Event

## Request

```http
GET /api/v1/events
```

Event berasal dari ESP32 dan merupakan evidence runtime.

Contoh event:

```json
{
  "eventId": "evt-001",
  "sequence": 10043,
  "deviceId": "esp32-complex-001",
  "deviceTimestamp": "...",
  "type": "DEVICE_EVENT",
  "severity": "WARNING",
  "source": "ESP32",
  "data": {}
}
```

Event harus append-only pada sisi device sampai berhasil disinkronkan/dikelola sesuai retention policy.

---

# 23. Sequence dan Backlog

ESP32 menggunakan sequence monotonik per device untuk ordering dan deduplication.

UI dapat meminta event/data setelah sequence tertentu:

```http
GET /api/v1/events?afterSequence=10000&limit=100
```

Response dapat berisi:

```json
{
  "items": [],
  "nextSequence": 10100,
  "oldestAvailableSequence": 1,
  "newestSequence": 10100,
  "hasMore": false
}
```

UI tidak boleh mengandalkan timestamp sebagai satu-satunya identity/order mechanism.

---

# 24. Local Log Buffer

ESP32 dapat kehilangan koneksi ke UI.

Karena itu data penting harus dapat ditahan lokal.

Status buffer minimal dapat menyediakan:

```text
pendingRecords
oldestPendingSequence
newestPendingSequence
storageUsed
storageCapacity
```

Prioritas retention:

```text
SAFETY/FAILURE
COMMAND
CRITICAL TELEMETRY
NORMAL TELEMETRY
```

---

# 25. UI Synchronization Model

UI mempunyai cache lokal, tetapi cache bukan authority.

Urutan umum startup/reconnect:

```text
1. discover device
2. GET /health
3. verify identity
4. GET /status
5. GET /inventory bila cache tidak ada/stale
6. compare configuration version
7. compare inventory version
8. retrieve missed events/telemetry bila diperlukan
9. reconcile UI state
```

---

# 26. Configuration Synchronization

UI harus membedakan:

```text
LOCAL EDITED
LOCAL PENDING
VALIDATING
SENDING
APPLIED
CONFLICT
FAILED
UNKNOWN
```

`UNKNOWN` penting ketika request telah dikirim tetapi response hilang.

UI tidak boleh langsung mengubah status menjadi FAILED hanya karena timeout.

UI harus melakukan reconciliation:

```http
GET /api/v1/configuration
GET /api/v1/status
```

untuk mengetahui apakah configuration sebenarnya telah berhasil diterapkan.

---

# 27. Connection State Model UI

Minimum:

```text
DISCOVERING
CONNECTING
ONLINE
DEGRADED
OFFLINE
STALE
ERROR
```

Makna:

- `ONLINE`: health check berhasil dan identity cocok.
- `DEGRADED`: device reachable tetapi sebagian subsystem bermasalah.
- `OFFLINE`: tidak dapat dihubungi.
- `STALE`: data terakhir tersedia tetapi sudah melewati freshness threshold UI.
- `ERROR`: response/protocol/device error yang bukan sekadar offline.

Browser disconnect sendiri tidak boleh otomatis dianggap device offline.

---

# 28. Timeout dan Retry

UI harus membedakan:

```text
HTTP error
network timeout
connection refused
invalid response
device rejection
configuration conflict
```

Retry otomatis hanya boleh untuk operasi yang idempotent.

Untuk command fisik:

```text
send
 ↓
timeout
 ↓
DO NOT duplicate blindly
 ↓
reconcile commandId
```

---

# 29. HTTP Error Model

Minimal mapping:

| HTTP | Arti | UI treatment |
|---|---|---|
| 200 | success | process response |
| 201 | created | process resource |
| 400 | malformed request | no retry |
| 404 | resource/command/device unknown | inspect context |
| 409 | version/state conflict | reconcile |
| 422 | validation rejected | show exact validation |
| 500 | device internal error | retry/reconcile according context |
| 503 | unavailable/busy | retry only when safe |
| network timeout | unknown outcome | reconcile before retry |

HTTP code tidak boleh menjadi satu-satunya sumber physical state.

---

# 30. Command Cancel / Stop Semantics

Harus dibedakan antara:

```text
CANCEL QUEUED OPERATION
STOP RUNNING OPERATION
EMERGENCY STOP
```

Ketiganya bukan command yang sama.

Setiap command memiliki status final yang dapat dibaca kembali.

---

# 31. Emergency Stop

Emergency stop adalah command safety khusus.

Contoh:

```http
POST /api/v1/commands/emergency-stop
```

Request harus menyertakan `commandId`/`operationId` dan alasan bila diperlukan.

Response HTTP hanya menyatakan penerimaan request.

Authority safety tetap di ESP32.

UI harus menunggu/mengecek actual safety state:

```text
emergencyStop = ACTIVE
```

Resume hanya boleh dilakukan setelah ESP32 menyatakan kondisi aman sesuai safety policy firmware.

---

# 32. Clock Synchronization

ESP32 membutuhkan waktu yang benar untuk fungsi runtime berbasis waktu.

## Request

```http
POST /api/v1/clock-sync
```

Payload minimum:

```json
{
  "requestId": "req-001",
  "currentTime": "2026-09-13T02:15:00+07:00",
  "timezone": "Asia/Jakarta"
}
```

ESP32 mengembalikan status clock:

```text
SYNCED
UNSYNCED
INVALID
```

UI tidak boleh menggunakan waktu browser sebagai pengganti runtime clock ESP32 setelah command/schedule telah diserahkan ke device.

---

# 33. Multi-Complex / Multi-ESP32

Satu UI dapat menangani banyak controller pada WLAN yang sama.

Contoh:

```text
WLAN
│
├── esp32-complex-001.local
│      └── Complex A
│
├── esp32-complex-002.local
│      └── Complex B
│
└── esp32-complex-003.local
       └── Complex C
```

Setiap device mempunyai identity sendiri.

UI tidak boleh menganggap hanya ada satu ESP32.

---

# 34. Parallel Requests

UI boleh melakukan request paralel ke beberapa ESP32 karena controller adalah device yang berbeda.

Contoh:

```text
GET status Complex A  ─┐
GET status Complex B  ─┼── parallel
GET status Complex C  ─┘
```

Partial failure harus didukung.

Jika B offline:

```text
A = success
B = offline
C = success
```

bukan:

```text
ALL = failed
```

Namun concurrency antar request ke **ESP32 yang sama** tetap tunduk pada firmware/resource/state constraints.

---

# 35. Multiple Browser Tabs / Multiple Clients

Dua browser/device dapat mencoba mengakses ESP32 yang sama.

ESP32 tetap menjadi authority.

UI tidak boleh menggunakan lock lokal browser sebagai jaminan eksklusivitas device.

Untuk configuration, gunakan:

```text
expectedConfigurationVersion
```

Untuk command, gunakan:

```text
commandId / operationId
```

Dengan demikian dua client tidak dapat diam-diam menimpa state tanpa terdeteksi.

---

# 36. Concurrency UI vs ESP32

Concurrency komunikasi tidak berarti concurrency fisik.

Contoh:

```text
UI dapat mengirim beberapa request
```

tetapi ESP32 mungkin harus mengeksekusi beberapa operasi secara serial karena resource firmware.

Policy resource merupakan authority ESP32, bukan UI.

UI hanya menampilkan queue/status yang dikembalikan device.

---

# 37. Offline UI

Jika browser kehilangan WLAN/ESP32:

- UI boleh menampilkan last-known data;
- UI harus memberi tanda stale/offline;
- UI tidak boleh mengklaim perubahan fisik berhasil;
- command pending harus tetap dapat di-reconcile ketika koneksi kembali.

ESP32 tidak boleh berhenti hanya karena UI offline.

---

# 38. Offline ESP32

Jika ESP32 offline dari WLAN tetapi tetap menyala:

```text
runtime lokal tetap berjalan
```

UI hanya kehilangan komunikasi.

Jika ESP32 reboot/power loss, firmware harus memuat Last Valid Configuration.

Perilaku recovery terhadap operasi yang sedang berjalan/terlewat harus ditentukan sebagai bagian dari runtime firmware dan tidak boleh diimplementasikan oleh browser timer.

---

# 39. Reconnection

Ketika koneksi kembali:

```text
DISCOVER
 ↓
HEALTH
 ↓
VERIFY IDENTITY
 ↓
STATUS
 ↓
CONFIGURATION VERSION
 ↓
INVENTORY VERSION
 ↓
PENDING EVENT/LOG RANGE
 ↓
RECONCILE
 ↓
ONLINE
```

UI harus membedakan:

```text
device back online
```

dengan:

```text
configuration successfully synchronized
```

Keduanya bukan hal yang sama.

---

# 40. Device Restart Detection

`bootId` wajib berubah setiap boot/restart ESP32.

Contoh:

```text
bootId = boot-001
```

setelah reboot:

```text
bootId = boot-002
```

UI dapat mengetahui bahwa terjadi restart walaupun IP dan `deviceId` tetap sama.

---

# 41. Runtime Data vs Historical Data

ESP32 menyimpan runtime data yang dibutuhkan untuk operasi dan backlog/log yang diperlukan untuk sinkronisasi.

UI dapat menyimpan cache sementara.

Historical/durable application data tidak menjadi tanggung jawab UI.

Python pada arsitektur ecosystem tetap menjadi durable persistence/analysis layer.

Namun dokumen ini tidak menentukan schema database Python.

---

# 42. Domain Data Boundary

ESP32 **tidak membutuhkan seluruh data UI**.

Data yang umumnya tidak diperlukan untuk base device runtime:

```text
plant research history
fruit research history
harvest research archive
chart configuration
analytics
browser-only preferences
UI layout state
```

Data tersebut dapat tetap berada pada application/backend layer.

ESP32 hanya menerima projection yang diperlukan untuk operasi controller.

---

# 43. CORS

Karena UI berupa Web App/Vite yang dijalankan melalui browser dan mengakses origin ESP32 secara langsung, ESP32 HTTP API harus menangani CORS secara eksplisit untuk origin yang digunakan oleh deployment UI.

MVP dapat menggunakan kebijakan permissive pada trusted WLAN.

Contoh konsep:

```text
Access-Control-Allow-Origin
Access-Control-Allow-Methods
Access-Control-Allow-Headers
```

Implementasi production security dapat memperketat origin setelah authentication ditambahkan.

---

# 44. Browser Transport Constraint

UI tidak boleh bergantung pada fitur browser yang tidak konsisten antar PC/HP.

Protocol inti hanya membutuhkan:

```text
HTTP GET
HTTP POST
HTTP PUT
HTTP DELETE (hanya bila memang diperlukan endpoint)
```

Discovery mDNS dilakukan melalui hostname/service resolution yang tersedia bagi environment jaringan/OS.

UI harus menyediakan fallback last-known address untuk robustness.

---

# 45. Endpoint Matrix MVP

| Endpoint | Method | Fungsi | Authority |
|---|---|---|---|
| `/api/v1/health` | GET | health + identity | ESP32 |
| `/api/v1/status` | GET | full runtime snapshot | ESP32 |
| `/api/v1/inventory` | GET | physical hardware inventory | ESP32 |
| `/api/v1/capabilities` | GET | firmware capability discovery | ESP32 |
| `/api/v1/configuration` | GET | read current config | ESP32 |
| `/api/v1/configuration/validate` | POST | validate proposed config | ESP32 |
| `/api/v1/configuration` | PUT | atomically apply config | ESP32 |
| `/api/v1/telemetry` | GET | current telemetry | ESP32 |
| `/api/v1/events` | GET | event/log retrieval | ESP32 |
| `/api/v1/commands/{commandId}` | GET | command status | ESP32 |
| `/api/v1/clock-sync` | POST | synchronize device clock | ESP32 |
| `/api/v1/commands/emergency-stop` | POST | emergency stop | ESP32 |

Domain-specific runtime commands can be added later without changing the core transport model.

---

# 46. UI Service Architecture

UI tidak boleh menghubungi fetch/API transport dari setiap component secara langsung.

Struktur yang disarankan:

```text
UI Component
    ↓
Domain Service
    ↓
ESP32 Client
    ↓
HTTP Transport
    ↓
ESP32
```

Contoh:

```text
FertigationPage
      ↓
service
      ↓
esp32Client
      ↓
request()
```

Dengan demikian visual/UI yang sudah matang tidak perlu diubah hanya karena transport diganti dari mock menjadi real API.

---

# 47. Removal of Mock Physical Truth

Dalam integration mode:

- `startRealtimeMock()` tidak boleh menjadi source runtime truth;
- local timer tidak boleh mensimulasikan progress fisik;
- local emergency-stop boolean tidak boleh menjadi safety authority;
- local pump state tidak boleh menggantikan actual device state;
- local success toast tidak boleh berarti physical completion.

Local store hanya boleh digunakan sebagai cache/UI state sementara.

---

# 48. UI Display Rules

UI harus selalu membedakan:

```text
User intent
Command accepted
Command running
Actual physical state
Command completed
Command failed
```

Contoh yang benar:

```text
"Perintah diterima ESP32"
```

berbeda dengan:

```text
"Pompa sudah ON"
```

Pernyataan kedua membutuhkan actual state dari device.

---

# 49. Reconciliation Rules

## 49.1 Lost response

```text
REQUEST SENT
   ↓
TIMEOUT
   ↓
STATE = UNKNOWN
   ↓
READ command/status/configuration
   ↓
RECONCILE
```

## 49.2 Configuration apply

```text
PUT configuration v18
   ↓
response lost
   ↓
GET configuration/status
   ↓
ESP32 v18 → applied
```

Jangan mengirim v18 dua kali hanya karena response pertama hilang.

## 49.3 Command

```text
commandId = cmd-123
```

Jika response hilang, UI membaca:

```http
GET /api/v1/commands/cmd-123
```

---

# 50. What ESP32 Must Not Depend On

ESP32 tidak boleh membutuhkan:

```text
Internet
Cloud
Browser
UI tab yang aktif
localStorage browser
Python availability
```

agar runtime operasional yang sudah valid tetap berjalan.

---

# 51. What UI Must Not Assume

UI tidak boleh mengasumsikan:

```text
HTTP 200 = physical success
button ON = actuator ON
browser timer = device timer
local state = device state
last displayed value = current value
IP address = device identity
browser online = ESP32 online
```

---

# 52. Future Compatibility

Protokol harus tetap memungkinkan penambahan:

```text
authentication
authorization
TLS
remote gateway
Python-first routing
WebSocket/MQTT
firmware OTA
advanced discovery
```

tanpa mengganti konsep dasar:

```text
deviceId
complexId
configurationVersion
commandId
sequence
actual device state
```

---

# 53. Acceptance Criteria MVP

MVP dianggap memenuhi kontrak apabila:

1. PC/HP terhubung ke WLAN yang sama dengan ESP32.
2. UI dapat menemukan atau mengakses ESP32 melalui local hostname/mDNS.
3. UI dapat menggunakan last-known IP sebagai fallback.
4. UI dapat memverifikasi `deviceId` dan `complexId` setelah discovery.
5. UI dapat membaca `/health`.
6. UI dapat membaca `/status`.
7. UI dapat membaca `/inventory`.
8. UI dapat membaca capability device.
9. UI dapat membaca configuration version.
10. UI dapat mengirim configuration tervalidasi dan ESP32 menerapkannya secara atomic.
11. Configuration conflict menghasilkan reconciliation, bukan silent overwrite.
12. Command memiliki `commandId` dan dapat dilacak setelah response hilang.
13. UI dapat membedakan actual state dari desired state.
14. Telemetry dan event mempunyai device timestamp serta sequence.
15. UI dapat mengambil backlog menggunakan sequence/cursor.
16. ESP32 tetap berjalan ketika browser ditutup.
17. ESP32 tetap berjalan ketika internet tidak tersedia.
18. Reconnect menyebabkan UI melakukan reconciliation terhadap device state.
19. Restart ESP32 dapat dideteksi melalui `bootId`.
20. Multi-Complex tidak mengharuskan hardcode satu IP global di UI.
21. Partial failure antar device tidak menyebabkan seluruh daftar device dianggap gagal.
22. Mock timer tidak lagi menjadi sumber physical runtime truth setelah integrasi aktif.

---

# 54. Non-Goals Dokumen Ini

Dokumen ini **tidak** menetapkan:

- schema database Python;
- model bisnis Complex/GH secara lengkap;
- struktur Plant/Fruit/Observation/Harvest;
- detail algoritma fertigasi;
- recipe calculation;
- detail mixing/dosing sequence;
- hardware safety matrix final;
- auth/security production;
- internet/cloud architecture.

Domain tersebut dapat memiliki spec tersendiri dan hanya berinteraksi dengan kontrak UI ↔ ESP32 yang didefinisikan di sini.

---

# 55. Architectural Summary

```text
                    LOCAL WLAN
                        │
           ┌────────────┴────────────┐
           │                         │
       PC / HP                    ESP32
           │                         │
      Vite Web UI               Device Runtime
           │                         │
           │  HTTP REST             │
           ├────────────────────────►
           │                         │
           │   health/status         │
           │◄────────────────────────┤
           │                         │
           │   configuration         │
           ├────────────────────────►
           │                         │
           │   command               │
           ├────────────────────────►
           │                         │
           │   state/telemetry/event │
           │◄────────────────────────┤
           │                         │
           └───────── cache ─────────┘

Authority:
ESP32 = physical/runtime truth
UI    = operator + presentation + synchronization client
Python = durable ecosystem/history layer (outside this spec)
```

**Prinsip paling penting:** browser boleh kehilangan koneksi, berganti IP target, ditutup, atau tidak memiliki internet; selama ESP32 hidup dan memiliki Last Valid Configuration, controller tetap menjadi penguasa runtime fisik.
