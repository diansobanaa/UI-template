# CROP DATA STORAGE & HISTORICAL EXPORT PIPELINE ARCHITECTURE

**Status:** Canonical Architecture Specification  
**Version:** 1.0.0  
**Domain:** AgroTech ESP32-S3 Firmware & Future Backend Data Pipeline  
**Reference API Spec:** `contracts/UI_ESP32_OPENAPI.yaml`  
**Communication Contract:** `UI_ESP32_COMMUNICATION_SPEC.md` (Section 51)

---

## 1. Executive Summary & Core Invariant

The previous architecture stored the complete 12-slot crop cycle history table (`crop_cycle_store_t s_store`, ~5.6 KB) in both RAM and NVS Flash. In an ESP32-S3 environment with a 24 KB NVS partition shared with Wi-Fi, LVC configurations, and schedules, storing multi-kilobyte binary blobs caused immediate page fragmentation (`ESP_ERR_NVS_NOT_ENOUGH_PAGES`), leading directly to HTTP 422 `"Failed to update planting date"` errors on the UI.

This specification establishes the **Canonical 3-Tier Storage Model**:

```text
                    ESP32
                      │
          ┌───────────┼────────────┐
          │           │            │
         NVS          SD          RAM
          │           │            │
     ACTIVE ONLY   HISTORICAL    TRANSIENT
     CROP CYCLE    DATA STORE    WORKING STATE
```

- **RAM = Transient Working State:** Transient memory buffer only. Temporarily holds a single active record during request handling. Must NEVER store historical datasets.
- **NVS = Active Operational State:** Stores ONLY the currently active crop cycle per greenhouse under isolated keys (`cc_<ghId>`, ~466 bytes). Small, bounded, boot-critical.
- **SD = Historical Bulk Data Store:** Completed/closed crop cycles, historical plant records, telemetry logs, event logs, fertigation logs, and export chunks under deterministic paths (`/agrotech/...`).
- **Backend Python = Future Receiver/Mirror/Archive:** Autonomous consumer that polls capabilities, pulls chunked export jobs, verifies manifests via CRC32, and issues explicit cryptographic/safe acknowledgements.

---

## 2. Memory & Storage Ownership Matrix

| Data Domain | RAM Ownership | NVS Ownership | MicroSD Ownership | Future Backend Ownership |
| :--- | :--- | :--- | :--- | :--- |
| **Active Crop Cycle** | Transient local stack / frame buffer | **Authoritative** (`cc_<ghId>`, single record ~466 B) | Staged copy (optional runtime mirror) | Read replica |
| **Historical Crop Cycles** | Transient during stream (bounded <= 32 KB) | **FORBIDDEN** (0 bytes) | **Authoritative** (`/agrotech/crop_cycles/history/`) | Archived mirror after ACK |
| **Active Plant Population** | Transient working state | Bounded active count / summary in active record | Bounded record | Read replica |
| **Historical Plant Records** | Transient buffer (<= 32 KB) | **FORBIDDEN** | **Authoritative** (`/agrotech/plants/history/`) | Archived mirror after ACK |
| **Operational Telemetry** | Rolling RAM circular buffer (60 pts) | None | **Authoritative** (`/agrotech/logs/telemetry/`) | Aggregated time-series |
| **System & Event Logs** | Transient log queue | None | **Authoritative** (`/agrotech/logs/events/`) | Centralized audit log |
| **Fertigation Run Records** | Current active execution state | None | **Authoritative** (`/agrotech/logs/fertigation/`) | Historic run archive |

---

## 3. NVS Active-Cycle Contract

For every greenhouse ID (`ghId`, e.g., `gh-mue35yg8`), NVS stores **exactly one** active record under namespace `agrotech`:

- **Key Format:** `cc_%.12s` (e.g., `cc_gh-mue35yg8`).
- **Record Size:** ~466 bytes (`crop_cycle_record_t`).
- **NVS Footprint:** Exactly 1 NVS entry. Never expands into arrays or histories.
- **Fields Retained in NVS:**
  - `cycleId`: Unique cycle ID (`cc-<timestamp>`)
  - `ghId`: Greenhouse identity
  - `status`: Lifecycle state (`ACTIVE`, `NO_CYCLE`, etc.)
  - `tanggalTanam`: Planting date (`YYYY-MM-DD`)
  - `tanggalPolinasi`: Pollination date (`YYYY-MM-DD`, optional)
  - `variety`: Crop variety name
  - `plantCount`: Plant population count
  - `notes`: Operational notes
  - `hst`: Days after planting (HST = Hari Setelah Tanam)
  - `hsp`: Days after pollination (HSP = Hari Setelah Polinasi)
  - `targetHarvestHst`: Target harvest threshold in HST
  - `version`: Monotonically increasing mutation counter

When no crop cycle is active, the NVS key is erased or stores `status = CYCLE_STATE_NO_CYCLE`.

---

## 4. SD Historical Storage Organization

The SD card uses a deterministic filesystem hierarchy:

```text
/sdcard/
└── agrotech/
    ├── crop_cycles/
    │   ├── active/               <-- Optional runtime mirror
    │   └── history/              <-- Closed/harvested cycles (<cycleId>.json)
    ├── plants/
    │   └── history/              <-- Retired plant population batches
    ├── logs/
    │   ├── telemetry/            <-- Rolling telemetry snapshots (.jsonl)
    │   ├── events/               <-- Operational events (.jsonl)
    │   ├── fertigation/          <-- Completed fertigation runs (.jsonl)
    │   └── system/               <-- System audit logs (.txt)
    └── exports/
        ├── pending/              <-- Staged export job manifests
        └── completed/            <-- Acknowledged export job logs
```

### File Naming Conventions
- Historical crop cycles: `/sdcard/agrotech/crop_cycles/history/<cycleId>.json`
- Historical plants: `/sdcard/agrotech/plants/history/<cycleId>_plants.json`
- Telemetry logs: `/sdcard/agrotech/logs/telemetry/telem_<YYYYMMDD>.jsonl`
- Event logs: `/sdcard/agrotech/logs/events/events_<YYYYMM>.jsonl`
- Fertigation runs: `/sdcard/agrotech/logs/fertigation/fert_<YYYYMM>.jsonl`

---

## 5. Crop-Cycle Lifecycle & Archive Protocol

### State Transition Diagram
```text
      ┌───────────────────────────┐
      │         NO_CYCLE          │
      └─────────────┬─────────────┘
                    │ POST /crop-cycles (start / import)
                    ▼
      ┌───────────────────────────┐
      │          ACTIVE           │◄────────┐
      │  (NVS Key: cc_<ghId>)     │         │ PATCH /planting-date
      └─────────────┬─────────────┘─────────┘ PATCH /pollination
                    │
                    │ POST /harvest OR POST /cancel
                    ▼
      ┌───────────────────────────┐
      │        COMPLETING         │
      └─────────────┬─────────────┘
                    │
                    ▼
      ┌───────────────────────────┐
      │       ARCHIVE_TO_SD       │
      │   Atomic write to .tmp    │
      └─────────────┬─────────────┘
                    │
             ┌──────┴──────┐
             │ Verify Size │
             └──────┬──────┘
         Success    │    Fail & SD Present
       ┌────────────┴────────────┐
       ▼                         ▼
┌──────────────┐          ┌──────────────┐
│   ARCHIVED   │          │ ARCHIVE_FAIL │
└──────┬───────┘          │ (Retain NVS) │
       │                  └──────────────┘
       ▼
┌──────────────────────────┐
│     REMOVE FROM NVS      │
│  (NVS Key Erased/Clean)  │
└──────────────────────────┘
```

### Archive Safety Invariants
1. **Atomic SD Writing:** History files are written first to `<path>.tmp`. Only after `fsync()` and file size readback verification is the file renamed to `<path>.json`.
2. **Durable NVS Retention on SD Failure:** If the SD card is present but the write or verification fails, **the active record is NOT removed from NVS**. It is marked `CYCLE_STATE_HARVESTED` / `CANCELLED` and preserved in NVS so that no operational record is silently lost.
3. **Graceful Degraded Fallback:** If the SD card is absent (unmounted), the controller operates in degraded mode, clears the active NVS slot so the greenhouse can proceed with new plantings, and logs a warning.

---

## 6. Export Pipeline Architecture (Backend-Ready)

The export pipeline allows a future Python backend or cloud service to extract historical datasets over HTTP REST without loading entire datasets into ESP32 RAM.

### 6.1 Export REST Endpoints

| Method | Endpoint | Purpose | Constraints |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/export/capabilities` | Capability & storage discovery | Always available, even if SD absent |
| `POST` | `/api/v1/export/jobs` | Create export job for a dataset | Returns 503 `STORAGE_UNAVAILABLE` if SD absent |
| `GET` | `/api/v1/export/jobs/{exportId}` | Query export job progress/status | Bounded RAM |
| `GET` | `/api/v1/export/jobs/{exportId}/manifest` | Retrieve file manifest & CRC32 | Computed over dataset files |
| `GET` | `/api/v1/export/jobs/{exportId}/data` | Stream chunked data (`?chunkIndex=N`) | Max chunk 32 KB, bounded RAM buffer |
| `POST` | `/api/v1/export/jobs/{exportId}/ack` | Backend ACK & scoped file deletion | Idempotent; purges ONLY exported files |

### 6.2 Export Job Lifecycle
```text
  Backend                              ESP32-S3
     │                                    │
     │ 1. GET /export/capabilities        │
     ├───────────────────────────────────►│ (Reports datasets, 32KB chunk limit, SD state)
     │◄───────────────────────────────────┤
     │                                    │
     │ 2. POST /export/jobs               │
     ├───────────────────────────────────►│ (Inspects SD directory, builds file list,
     │◄───────────────────────────────────┤  computes totalBytes & CRC32, returns exportId)
     │                                    │
     │ 3. GET /export/jobs/{id}/manifest  │
     ├───────────────────────────────────►│ (Returns CRC32 checksum, record count, files)
     │◄───────────────────────────────────┤
     │                                    │
     │ 4. GET /export/jobs/{id}/data?chunkIndex=0,1,2...
     ├───────────────────────────────────►│ (Reads file slice <= 32 KB into bounded buffer,
     │◄───────────────────────────────────┤  streams enveloped chunk with isLastChunk)
     │                                    │
     │ 5. [Backend verifies CRC32 & files]│
     │                                    │
     │ 6. POST /export/jobs/{id}/ack      │
     ├───────────────────────────────────►│ (Idempotent ACK: deletes ONLY acknowledged
     │◄───────────────────────────────────┤  historical files; leaves active data intact)
     │                                    │
```

---

## 7. Bounded Chunking & RAM Management

- **Max Chunk Size:** Exactly 32,768 bytes (32 KB).
- **RAM Buffer Allocation:** The chunk reader allocates a bounded 32 KB buffer on the heap only during the request execution, immediately releasing it before returning the HTTP response.
- **Pagination & Resumability:** The backend can request chunks in any order or resume interrupted transfers by passing `?chunkIndex=N`.
- **System Protection:** The HTTP export server does not block the FreeRTOS scheduler, does not starve sensor acquisition or fertigation loops, and yields CPU time between chunks.

---

## 8. Checksum & Manifest Verification

The export manifest guarantees transmission integrity:
- **Checksum Algorithm:** CRC32 (`esp_rom_crc32_le`), computed across the byte contents of all included historical files.
- **Manifest Fields:**
  - `exportId`: Deterministic job ID (`exp-<timestamp>`)
  - `dataset`: Exported dataset name (`crop_cycles`, `plants`, `telemetry`, `events`, `fertigation_runs`, `system_logs`)
  - `recordCount`: Total records found in dataset
  - `totalBytes`: Total raw payload bytes across all matching files
  - `checksumCrc32`: 32-bit unsigned CRC
  - `fileCount`: Number of individual files included
  - `files`: Array of relative file paths on SD

---

## 9. Scoped Idempotent Deletion on ACK

### Deletion Rules
1. **ACK Precondition:** Data is NEVER deleted on download or HTTP 200. Data is deleted ONLY when the client explicitly invokes `POST /api/v1/export/jobs/{exportId}/ack` with `deleteExported: true`.
2. **Exact Set Scoping:** Deletion is bound strictly to the `files` array registered in the export job manifest. No wildcard `rm -rf` or generic "delete all logs" operations are permitted.
3. **Idempotency:** If the client transmits the exact same ACK request multiple times (e.g., due to network timeout or retry), the controller verifies the job state (`JOB_STATE_DELETED`), skips file deletion, and returns HTTP 200 with `deleted: false, state: "DELETED"`.
4. **Active State Protection:** The export manager has NO access to active NVS keys, current equipment configs, or active schedule intents. Active operational data CANNOT be deleted by the export API.

---

## 10. Reboot & Power-Loss Recovery Invariants

| Failure Scenario | Controller Behavior on Reboot |
| :--- | :--- |
| **Power loss during active cycle NVS write** | Flash journal reverts or retains prior valid NVS active cycle. No corrupted memory. |
| **Power loss during SD archive (`.tmp` write)** | `.tmp` file is ignored or overwritten on next cycle. Active cycle remains safely in NVS. |
| **Power loss during export streaming** | Historical SD files remain untouched. Backend re-queries `/export/capabilities` and re-initiates job. |
| **Power loss before ACK received** | Data remains intact on MicroSD. No historical records lost. |
| **Power loss during deletion after ACK** | Partially removed files are cleaned up idempotently on subsequent maintenance pass; remaining files retain valid headers. |

---

## 11. SD Absence & Degraded Mode Behavior

When the MicroSD card is absent, unformatted, or unmounted:
1. **System Health:** Firmware boots normally, mounts SPIFFS, connects to Wi-Fi, and executes greenhouse control loops without fault or watchdog trip.
2. **Active Cycle Operation:** Active crop cycles operate with 100% functionality from NVS (`cc_<ghId>`). Planting dates, pollination dates, HST calculations, and timeline transitions function identically.
3. **Export Capabilities:** `GET /api/v1/export/capabilities` returns HTTP 200 with `storage.sdMounted: false` and `storage.degraded: true`.
4. **Export Creation:** `POST /api/v1/export/jobs` cleanly returns HTTP 503 `STORAGE_UNAVAILABLE` with `{ retryable: true, reconcileRequired: false }`.
5. **No Browser Storage Mock:** The firmware never pretends browser storage is authoritative. When SD is absent, persistent bulk history is explicitly reported as unavailable.
