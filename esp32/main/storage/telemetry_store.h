#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "services/telemetry_mgr.h"

#ifdef __cplusplus
extern "C" {
#endif

#define TELEMETRY_RECORD_MAGIC   0x54454C4DU /* 'TELM' */
#define TELEMETRY_RECORD_VERSION 1
#define TELEMETRY_DAILY_SLOTS    288         /* 24h * 12 points/hr (5-minute buckets) */

/* Flag bits */
#define TELEMETRY_FLAG_TEMP_AIR_VALID   (1U << 0)
#define TELEMETRY_FLAG_TEMP_WATER_VALID (1U << 1)
#define TELEMETRY_FLAG_HUM_VALID        (1U << 2)
#define TELEMETRY_FLAG_LIGHT_VALID      (1U << 3)
#define TELEMETRY_FLAG_FLOAT_LOWER_OK   (1U << 4)

/* Fixed-size packed binary record format on microSD (60 bytes) */
typedef struct __attribute__((packed)) {
    uint32_t magic;           /* 0x54454C4D */
    uint16_t version;         /* 1 */
    uint16_t flags;           /* Quality/status flags */
    uint64_t sequence;        /* Monotonic device sequence */
    int64_t  timestamp_ms;    /* Unix epoch milliseconds */
    float    temperature_air_c;
    float    temperature_water_c;
    float    humidity_pct;
    float    light_lux;
    float    water_level_pct;
    float    flow_rate_lpm;
    float    total_liters;
    uint16_t actuator_mask;   /* pump, fan, dosing bitfield */
    uint16_t reserved;        /* Alignment/future flags */
    uint32_t crc32;           /* CRC32 of all preceding bytes */
} telemetry_record_t;

/* 5-minute bucket in RAM */
typedef struct {
    bool     valid;
    float    temp_air;
    float    temp_water;
    float    humidity;
    float    temp_air_min;
    float    temp_air_max;
    uint16_t sample_count;
    int64_t  timestamp_ms;
} telemetry_daily_bucket_t;

/* Full 24-hour daily history in RAM */
typedef struct {
    int date_int;             /* YYYYMMDD */
    telemetry_daily_bucket_t buckets[TELEMETRY_DAILY_SLOTS];
    float temp_air_min;
    float temp_air_max;
    float temp_water_min;
    float temp_water_max;
    int   latest_slot;
    bool  has_data;
} telemetry_daily_history_t;

/* Storage subsystem status */
typedef struct {
    bool     is_mounted;
    bool     is_degraded;
    uint32_t total_written;
    uint32_t total_recovered;
    int64_t  last_flush_ms;
    int      current_date_int;
} telemetry_store_status_t;

/** Initialize the TelemetryStore subsystem. */
esp_err_t telemetry_store_init(void);

/** Append a telemetry snapshot to the write batch buffer and update the 288-slot RAM cache. */
esp_err_t telemetry_store_append(const telemetry_snapshot_t *snap);

/** Drain the batch buffer and flush to microSD (FatFS). Thread-safe, non-blocking to control logic. */
esp_err_t telemetry_store_flush(void);

/** Scan current segment file, validate records, detect and trim corrupted tail. */
esp_err_t telemetry_store_recover(void);

/** Load today's history from microSD into the 288-slot RAM cache. */
esp_err_t telemetry_store_load_recent_history(void);

/** Retrieve a thread-safe copy of the 288-slot daily temperature history. */
esp_err_t telemetry_store_get_daily_history(telemetry_daily_history_t *out_history);

/** Lock cache mutex and return read-only pointer to internal daily history (must call unlock). */
const telemetry_daily_history_t *telemetry_store_lock_daily_history(void);

/** Unlock cache mutex after reading internal daily history. */
void telemetry_store_unlock_daily_history(void);

/** Zero-stack helper to extract temperature min/max and series directly under cache lock. */
esp_err_t telemetry_store_get_temp_series(float *out_min, float *out_max, float *out_series, size_t max_series, size_t *out_count);

/** Retrieve current telemetry storage status. */
esp_err_t telemetry_store_get_status(telemetry_store_status_t *out_status);

/** Trigger an immediate flush cycle (e.g. on critical events). */
void telemetry_store_trigger_flush(void);

#ifdef __cplusplus
}
#endif
