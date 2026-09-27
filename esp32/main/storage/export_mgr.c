#include "storage/export_mgr.h"
#include "storage/crop_history_storage.h"
#include "hal/sdcard_hal.h"
#include "esp_log.h"
#include "esp_rom_crc.h"
#include "esp_random.h"
#include "cJSON.h"
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <dirent.h>
#include <unistd.h>
#include <stdlib.h>
#include <time.h>

static const char *TAG = "EXPORT_MGR";

static esp_err_t ensure_dir(const char *dir)
{
    if (!dir || strlen(dir) == 0) return ESP_ERR_INVALID_ARG;
    struct stat st;
    if (stat(dir, &st) == 0) {
        if (S_ISDIR(st.st_mode)) return ESP_OK;
        return ESP_FAIL;
    }
    char tmp[256];
    snprintf(tmp, sizeof(tmp), "%s", dir);
    size_t len = strlen(tmp);
    if (tmp[len - 1] == '/') tmp[len - 1] = '\0';

    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            if (stat(tmp, &st) != 0) {
                mkdir(tmp, 0755);
            }
            *p = '/';
        }
    }
    if (mkdir(tmp, 0755) != 0 && stat(tmp, &st) != 0) {
        return ESP_FAIL;
    }
    return ESP_OK;
}

static void now_iso(char out[32])
{
    time_t now = time(NULL);
    if (now > 1600000000) {
        strftime(out, 32, "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    } else {
        snprintf(out, 32, "1970-01-01T00:00:00Z");
    }
}

esp_err_t export_mgr_init(void)
{
    if (sdcard_hal_is_mounted()) {
        sdcard_hal_lock();
        ensure_dir(EXPORT_DIR_PENDING);
        ensure_dir(EXPORT_DIR_COMPLETED);
        sdcard_hal_unlock();
        ESP_LOGI(TAG, "Export manager initialized on SD card");
    } else {
        ESP_LOGW(TAG, "Export manager running in degraded mode (SD card unmounted)");
    }
    return ESP_OK;
}

cJSON *export_mgr_get_capabilities(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "version", "1.0.0");

    cJSON *storage = cJSON_AddObjectToObject(root, "storage");
    bool mounted = sdcard_hal_is_mounted();
    cJSON_AddBoolToObject(storage, "sdMounted", mounted);
    cJSON_AddBoolToObject(storage, "degraded", !mounted);
    cJSON_AddStringToObject(storage, "storageMedium", mounted ? "MICROSD" : "NONE");

    cJSON *datasets = cJSON_AddObjectToObject(root, "supportedDatasets");

    /* 1. crop_cycles */
    cJSON *cc = cJSON_AddObjectToObject(datasets, "crop_cycles");
    cJSON_AddStringToObject(cc, "format", "json_array");
    cJSON_AddStringToObject(cc, "version", "1.0");
    cJSON_AddBoolToObject(cc, "chunking", true);
    cJSON_AddBoolToObject(cc, "deleteAfterAck", true);
    cJSON_AddNumberToObject(cc, "maxChunkBytes", EXPORT_MAX_CHUNK_BYTES);
    cJSON_AddStringToObject(cc, "description", "Historical closed/harvested crop cycles on SD");

    /* 2. plants */
    cJSON *pl = cJSON_AddObjectToObject(datasets, "plants");
    cJSON_AddStringToObject(pl, "format", "json_array");
    cJSON_AddStringToObject(pl, "version", "1.0");
    cJSON_AddBoolToObject(pl, "chunking", true);
    cJSON_AddBoolToObject(pl, "deleteAfterAck", true);
    cJSON_AddNumberToObject(pl, "maxChunkBytes", EXPORT_MAX_CHUNK_BYTES);
    cJSON_AddStringToObject(pl, "description", "Historical crop-associated plant population records");

    /* 3. telemetry */
    cJSON *tl = cJSON_AddObjectToObject(datasets, "telemetry");
    cJSON_AddStringToObject(tl, "format", "jsonl");
    cJSON_AddStringToObject(tl, "version", "1.0");
    cJSON_AddBoolToObject(tl, "chunking", true);
    cJSON_AddBoolToObject(tl, "deleteAfterAck", true);
    cJSON_AddNumberToObject(tl, "maxChunkBytes", EXPORT_MAX_CHUNK_BYTES);
    cJSON_AddStringToObject(tl, "description", "Durable telemetry history snapshots");

    /* 4. events */
    cJSON *ev = cJSON_AddObjectToObject(datasets, "events");
    cJSON_AddStringToObject(ev, "format", "jsonl");
    cJSON_AddStringToObject(ev, "version", "1.0");
    cJSON_AddBoolToObject(ev, "chunking", true);
    cJSON_AddBoolToObject(ev, "deleteAfterAck", true);
    cJSON_AddNumberToObject(ev, "maxChunkBytes", EXPORT_MAX_CHUNK_BYTES);
    cJSON_AddStringToObject(ev, "description", "System and operational event log");

    /* 5. fertigation_runs */
    cJSON *fr = cJSON_AddObjectToObject(datasets, "fertigation_runs");
    cJSON_AddStringToObject(fr, "format", "jsonl");
    cJSON_AddStringToObject(fr, "version", "1.0");
    cJSON_AddBoolToObject(fr, "chunking", true);
    cJSON_AddBoolToObject(fr, "deleteAfterAck", true);
    cJSON_AddNumberToObject(fr, "maxChunkBytes", EXPORT_MAX_CHUNK_BYTES);
    cJSON_AddStringToObject(fr, "description", "Execution logs of fertigation cycles");

    /* 6. system_logs */
    cJSON *sl = cJSON_AddObjectToObject(datasets, "system_logs");
    cJSON_AddStringToObject(sl, "format", "text");
    cJSON_AddStringToObject(sl, "version", "1.0");
    cJSON_AddBoolToObject(sl, "chunking", true);
    cJSON_AddBoolToObject(sl, "deleteAfterAck", false);
    cJSON_AddNumberToObject(sl, "maxChunkBytes", EXPORT_MAX_CHUNK_BYTES);
    cJSON_AddStringToObject(sl, "description", "Diagnostic system logs");

    return root;
}

static cJSON *job_to_json(const export_job_t *job)
{
    cJSON *r = cJSON_CreateObject();
    cJSON_AddStringToObject(r, "exportId", job->export_id);
    cJSON_AddStringToObject(r, "dataset", job->dataset);
    cJSON_AddStringToObject(r, "complexId", job->complex_id);
    cJSON_AddStringToObject(r, "ghId", job->gh_id);
    cJSON_AddStringToObject(r, "from", job->from_timestamp);
    cJSON_AddStringToObject(r, "to", job->to_timestamp);
    cJSON_AddNumberToObject(r, "limit", job->limit);

    const char *st = "PENDING";
    switch (job->state) {
        case EXPORT_STATE_READY: st = "READY"; break;
        case EXPORT_STATE_STREAMING: st = "STREAMING"; break;
        case EXPORT_STATE_ACKNOWLEDGED: st = "ACKNOWLEDGED"; break;
        case EXPORT_STATE_COMPLETED: st = "COMPLETED"; break;
        case EXPORT_STATE_FAILED: st = "FAILED"; break;
        default: break;
    }
    cJSON_AddStringToObject(r, "state", st);
    cJSON_AddNumberToObject(r, "recordCount", (double)job->record_count);
    cJSON_AddNumberToObject(r, "byteCount", (double)job->total_bytes);
    cJSON_AddNumberToObject(r, "checksumCrc32", job->checksum_crc32);
    cJSON_AddStringToObject(r, "createdAt", job->created_at);
    cJSON_AddBoolToObject(r, "deletionEligible", job->deletion_eligible);
    return r;
}

static void json_to_job(const cJSON *r, export_job_t *job)
{
    memset(job, 0, sizeof(*job));
    cJSON *item = cJSON_GetObjectItem(r, "exportId");
    if (item && item->valuestring) snprintf(job->export_id, sizeof(job->export_id), "%s", item->valuestring);

    item = cJSON_GetObjectItem(r, "dataset");
    if (item && item->valuestring) snprintf(job->dataset, sizeof(job->dataset), "%s", item->valuestring);

    item = cJSON_GetObjectItem(r, "complexId");
    if (item && item->valuestring) snprintf(job->complex_id, sizeof(job->complex_id), "%s", item->valuestring);

    item = cJSON_GetObjectItem(r, "ghId");
    if (item && item->valuestring) snprintf(job->gh_id, sizeof(job->gh_id), "%s", item->valuestring);

    item = cJSON_GetObjectItem(r, "state");
    if (item && item->valuestring) {
        if (strcmp(item->valuestring, "READY") == 0) job->state = EXPORT_STATE_READY;
        else if (strcmp(item->valuestring, "STREAMING") == 0) job->state = EXPORT_STATE_STREAMING;
        else if (strcmp(item->valuestring, "COMPLETED") == 0) job->state = EXPORT_STATE_COMPLETED;
        else if (strcmp(item->valuestring, "FAILED") == 0) job->state = EXPORT_STATE_FAILED;
    }

    item = cJSON_GetObjectItem(r, "recordCount");
    if (item) job->record_count = (size_t)item->valuedouble;

    item = cJSON_GetObjectItem(r, "byteCount");
    if (item) job->total_bytes = (size_t)item->valuedouble;

    item = cJSON_GetObjectItem(r, "checksumCrc32");
    if (item) job->checksum_crc32 = (uint32_t)item->valuedouble;

    item = cJSON_GetObjectItem(r, "createdAt");
    if (item && item->valuestring) snprintf(job->created_at, sizeof(job->created_at), "%s", item->valuestring);
}

esp_err_t export_mgr_create_job(const cJSON *req, export_job_t *out_job)
{
    if (!req || !out_job) return ESP_ERR_INVALID_ARG;
    if (!sdcard_hal_is_mounted()) {
        ESP_LOGW(TAG, "Cannot create export job: SD card unmounted");
        return ESP_ERR_NOT_FOUND;
    }

    cJSON *ds_item = cJSON_GetObjectItem(req, "dataset");
    if (!ds_item || !ds_item->valuestring || !ds_item->valuestring[0]) {
        return ESP_ERR_INVALID_ARG;
    }
    const char *dataset = ds_item->valuestring;

    memset(out_job, 0, sizeof(*out_job));
    uint32_t r = esp_random() & 0xFFFF;
    snprintf(out_job->export_id, sizeof(out_job->export_id), "exp-%llu-%04x",
             (unsigned long long)time(NULL), (unsigned int)r);
    snprintf(out_job->dataset, sizeof(out_job->dataset), "%s", dataset);

    cJSON *comp = cJSON_GetObjectItem(req, "complexId");
    if (comp && comp->valuestring) snprintf(out_job->complex_id, sizeof(out_job->complex_id), "%s", comp->valuestring);

    cJSON *gh = cJSON_GetObjectItem(req, "ghId");
    if (gh && gh->valuestring) snprintf(out_job->gh_id, sizeof(out_job->gh_id), "%s", gh->valuestring);

    cJSON *from = cJSON_GetObjectItem(req, "from");
    if (from && from->valuestring) snprintf(out_job->from_timestamp, sizeof(out_job->from_timestamp), "%s", from->valuestring);

    cJSON *to = cJSON_GetObjectItem(req, "to");
    if (to && to->valuestring) snprintf(out_job->to_timestamp, sizeof(out_job->to_timestamp), "%s", to->valuestring);

    cJSON *lim = cJSON_GetObjectItem(req, "limit");
    out_job->limit = (lim && lim->valuedouble > 0) ? (uint32_t)lim->valuedouble : 1000;

    now_iso(out_job->created_at);
    out_job->state = EXPORT_STATE_READY;
    out_job->deletion_eligible = true;

    /* Scan target dataset to compute record count, byte count, and CRC32 */
    sdcard_hal_lock();
    ensure_dir(EXPORT_DIR_PENDING);
    ensure_dir(EXPORT_DIR_COMPLETED);

    uint32_t running_crc = 0;
    size_t count = 0;
    size_t bytes = 0;

    if (strcmp(dataset, "crop_cycles") == 0) {
        DIR *d = opendir(CROP_HIST_CYCLES_DIR);
        if (d) {
            struct dirent *entry;
            char prefix[64] = "";
            if (out_job->gh_id[0]) snprintf(prefix, sizeof(prefix), "%s_", out_job->gh_id);

            while ((entry = readdir(d)) != NULL && count < out_job->limit) {
                if (entry->d_name[0] == '.' || !strstr(entry->d_name, ".json")) continue;
                if (prefix[0] && strncmp(entry->d_name, prefix, strlen(prefix)) != 0) continue;

                char filepath[512];
                snprintf(filepath, sizeof(filepath), "%s/%s", CROP_HIST_CYCLES_DIR, entry->d_name);
                struct stat st;
                if (stat(filepath, &st) == 0 && st.st_size > 0) {
                    bytes += st.st_size;
                    count++;

                    FILE *f = fopen(filepath, "rb");
                    if (f) {
                        char buf[512];
                        size_t n;
                        while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
                            running_crc = esp_rom_crc32_le(running_crc, (const uint8_t *)buf, n);
                        }
                        fclose(f);
                    }
                }
            }
            closedir(d);
        }
    } else if (strcmp(dataset, "plants") == 0) {
        DIR *d = opendir(CROP_HIST_PLANTS_DIR);
        if (d) {
            struct dirent *entry;
            char prefix[64] = "";
            if (out_job->gh_id[0]) snprintf(prefix, sizeof(prefix), "%s_", out_job->gh_id);

            while ((entry = readdir(d)) != NULL && count < out_job->limit) {
                if (entry->d_name[0] == '.' || !strstr(entry->d_name, ".json")) continue;
                if (prefix[0] && strncmp(entry->d_name, prefix, strlen(prefix)) != 0) continue;

                char filepath[512];
                snprintf(filepath, sizeof(filepath), "%s/%s", CROP_HIST_PLANTS_DIR, entry->d_name);
                struct stat st;
                if (stat(filepath, &st) == 0 && st.st_size > 0) {
                    bytes += st.st_size;
                    count++;

                    FILE *f = fopen(filepath, "rb");
                    if (f) {
                        char buf[512];
                        size_t n;
                        while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
                            running_crc = esp_rom_crc32_le(running_crc, (const uint8_t *)buf, n);
                        }
                        fclose(f);
                    }
                }
            }
            closedir(d);
        }
    } else {
        /* Telemetry, events, fertigation logs */
        const char *log_path = "/sdcard/telemetry.jsonl";
        if (strcmp(dataset, "events") == 0) log_path = "/sdcard/events.log";
        else if (strcmp(dataset, "fertigation_runs") == 0) log_path = "/sdcard/fertigation_runs.jsonl";

        struct stat st;
        if (stat(log_path, &st) == 0 && st.st_size > 0) {
            bytes = st.st_size;
            FILE *f = fopen(log_path, "rb");
            if (f) {
                char buf[1024];
                size_t n;
                while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
                    running_crc = esp_rom_crc32_le(running_crc, (const uint8_t *)buf, n);
                    for (size_t i = 0; i < n; i++) {
                        if (buf[i] == '\n') count++;
                    }
                }
                fclose(f);
            }
        }
    }

    out_job->record_count = count;
    out_job->total_bytes = bytes;
    out_job->checksum_crc32 = running_crc;

    /* Write job state to pending file */
    char job_path[128];
    snprintf(job_path, sizeof(job_path), "%s/%s.json", EXPORT_DIR_PENDING, out_job->export_id);
    cJSON *job_json = job_to_json(out_job);
    char *job_str = cJSON_Print(job_json);
    cJSON_Delete(job_json);

    if (job_str) {
        FILE *jf = fopen(job_path, "w");
        if (jf) {
            fputs(job_str, jf);
            fclose(jf);
        }
        free(job_str);
    }

    sdcard_hal_unlock();
    ESP_LOGI(TAG, "Created export job %s for dataset '%s': %zu records, %zu bytes, CRC=0x%08lx",
             out_job->export_id, dataset, count, bytes, (unsigned long)running_crc);
    return ESP_OK;
}

esp_err_t export_mgr_get_job(const char *export_id, export_job_t *out_job)
{
    if (!export_id || !out_job || !sdcard_hal_is_mounted()) return ESP_ERR_INVALID_ARG;

    char path[128];
    snprintf(path, sizeof(path), "%s/%s.json", EXPORT_DIR_PENDING, export_id);
    sdcard_hal_lock();
    struct stat st;
    if (stat(path, &st) != 0) {
        snprintf(path, sizeof(path), "%s/%s.json", EXPORT_DIR_COMPLETED, export_id);
        if (stat(path, &st) != 0) {
            sdcard_hal_unlock();
            return ESP_ERR_NOT_FOUND;
        }
    }

    FILE *f = fopen(path, "r");
    if (!f) {
        sdcard_hal_unlock();
        return ESP_ERR_NOT_FOUND;
    }

    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);

    char *buf = malloc(sz + 1);
    if (!buf) {
        fclose(f);
        sdcard_hal_unlock();
        return ESP_ERR_NO_MEM;
    }
    size_t r = fread(buf, 1, sz, f);
    buf[r] = '\0';
    fclose(f);
    sdcard_hal_unlock();

    cJSON *parsed = cJSON_Parse(buf);
    free(buf);
    if (!parsed) return ESP_FAIL;

    json_to_job(parsed, out_job);
    cJSON_Delete(parsed);
    return ESP_OK;
}

cJSON *export_mgr_get_manifest(const char *export_id)
{
    export_job_t job;
    if (export_mgr_get_job(export_id, &job) != ESP_OK) return NULL;

    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "exportId", job.export_id);
    cJSON_AddStringToObject(m, "dataset", job.dataset);
    cJSON_AddStringToObject(m, "complexId", job.complex_id);
    cJSON_AddStringToObject(m, "ghId", job.gh_id);
    cJSON_AddNumberToObject(m, "recordCount", (double)job.record_count);
    cJSON_AddNumberToObject(m, "byteCount", (double)job.total_bytes);
    cJSON_AddNumberToObject(m, "checksumCrc32", job.checksum_crc32);
    cJSON_AddStringToObject(m, "deletionEligibility", "REQUIRES_EXPLICIT_ACK");
    cJSON_AddStringToObject(m, "createdAt", job.created_at);

    const char *st = "READY";
    if (job.state == EXPORT_STATE_COMPLETED) st = "COMPLETED";
    else if (job.state == EXPORT_STATE_STREAMING) st = "STREAMING";
    cJSON_AddStringToObject(m, "status", st);

    return m;
}

esp_err_t export_mgr_read_chunk(const char *export_id, uint32_t chunk_index, size_t chunk_size,
                                char *out_buf, size_t max_buf, size_t *out_len,
                                bool *is_last, uint32_t *chunk_crc)
{
    if (!export_id || !out_buf || !out_len || !is_last || !chunk_crc) return ESP_ERR_INVALID_ARG;
    if (chunk_size == 0 || chunk_size > EXPORT_MAX_CHUNK_BYTES) chunk_size = EXPORT_DEFAULT_CHUNK_BYTES;
    if (chunk_size > max_buf) chunk_size = max_buf;

    export_job_t job;
    esp_err_t err = export_mgr_get_job(export_id, &job);
    if (err != ESP_OK) return err;

    size_t offset = (size_t)chunk_index * chunk_size;
    if (offset >= job.total_bytes && job.total_bytes > 0) {
        *out_len = 0;
        *is_last = true;
        *chunk_crc = 0;
        return ESP_OK;
    }

    sdcard_hal_lock();
    size_t bytes_read = 0;

    if (strcmp(job.dataset, "crop_cycles") == 0 || strcmp(job.dataset, "plants") == 0) {
        const char *dir = (strcmp(job.dataset, "crop_cycles") == 0) ? CROP_HIST_CYCLES_DIR : CROP_HIST_PLANTS_DIR;
        DIR *d = opendir(dir);
        if (d) {
            struct dirent *entry;
            char prefix[64] = "";
            if (job.gh_id[0]) snprintf(prefix, sizeof(prefix), "%s_", job.gh_id);

            size_t current_file_offset = 0;
            while ((entry = readdir(d)) != NULL && bytes_read < chunk_size) {
                if (entry->d_name[0] == '.' || !strstr(entry->d_name, ".json")) continue;
                if (prefix[0] && strncmp(entry->d_name, prefix, strlen(prefix)) != 0) continue;

                char filepath[512];
                snprintf(filepath, sizeof(filepath), "%s/%s", dir, entry->d_name);
                struct stat st;
                if (stat(filepath, &st) == 0) {
                    size_t fsz = st.st_size;
                    if (current_file_offset + fsz <= offset) {
                        current_file_offset += fsz;
                        continue;
                    }
                    FILE *f = fopen(filepath, "rb");
                    if (f) {
                        size_t skip = (offset > current_file_offset) ? (offset - current_file_offset) : 0;
                        if (skip > 0) fseek(f, skip, SEEK_SET);

                        size_t need = chunk_size - bytes_read;
                        size_t r = fread(out_buf + bytes_read, 1, need, f);
                        bytes_read += r;
                        fclose(f);
                    }
                    current_file_offset += fsz;
                }
            }
            closedir(d);
        }
    } else {
        const char *log_path = "/sdcard/telemetry.jsonl";
        if (strcmp(job.dataset, "events") == 0) log_path = "/sdcard/events.log";
        else if (strcmp(job.dataset, "fertigation_runs") == 0) log_path = "/sdcard/fertigation_runs.jsonl";

        FILE *f = fopen(log_path, "rb");
        if (f) {
            fseek(f, offset, SEEK_SET);
            bytes_read = fread(out_buf, 1, chunk_size, f);
            fclose(f);
        }
    }

    sdcard_hal_unlock();

    *out_len = bytes_read;
    *chunk_crc = esp_rom_crc32_le(0, (const uint8_t *)out_buf, bytes_read);
    *is_last = (offset + bytes_read >= job.total_bytes);
    return ESP_OK;
}

esp_err_t export_mgr_ack_job(const char *export_id, size_t *out_deleted_records, size_t *out_deleted_bytes)
{
    if (!export_id || !sdcard_hal_is_mounted()) return ESP_ERR_INVALID_ARG;

    export_job_t job;
    esp_err_t err = export_mgr_get_job(export_id, &job);
    if (err != ESP_OK) return err;

    /* IDEMPOTENT: If already completed, return success immediately */
    if (job.state == EXPORT_STATE_COMPLETED) {
        if (out_deleted_records) *out_deleted_records = 0;
        if (out_deleted_bytes) *out_deleted_bytes = 0;
        ESP_LOGI(TAG, "Export job %s already acknowledged and completed (idempotent)", export_id);
        return ESP_OK;
    }

    sdcard_hal_lock();
    size_t del_records = 0;
    size_t del_bytes = 0;

    /* Execute deletion strictly scoped to the acknowledged historical files */
    if (strcmp(job.dataset, "crop_cycles") == 0) {
        DIR *d = opendir(CROP_HIST_CYCLES_DIR);
        if (d) {
            struct dirent *entry;
            char prefix[64] = "";
            if (job.gh_id[0]) snprintf(prefix, sizeof(prefix), "%s_", job.gh_id);

            while ((entry = readdir(d)) != NULL && del_records < job.record_count) {
                if (entry->d_name[0] == '.' || !strstr(entry->d_name, ".json")) continue;
                if (prefix[0] && strncmp(entry->d_name, prefix, strlen(prefix)) != 0) continue;

                char filepath[512];
                snprintf(filepath, sizeof(filepath), "%s/%s", CROP_HIST_CYCLES_DIR, entry->d_name);
                struct stat st;
                if (stat(filepath, &st) == 0) {
                    del_bytes += st.st_size;
                    unlink(filepath);
                    del_records++;
                }
            }
            closedir(d);
        }
    } else if (strcmp(job.dataset, "plants") == 0) {
        DIR *d = opendir(CROP_HIST_PLANTS_DIR);
        if (d) {
            struct dirent *entry;
            char prefix[64] = "";
            if (job.gh_id[0]) snprintf(prefix, sizeof(prefix), "%s_", job.gh_id);

            while ((entry = readdir(d)) != NULL && del_records < job.record_count) {
                if (entry->d_name[0] == '.' || !strstr(entry->d_name, ".json")) continue;
                if (prefix[0] && strncmp(entry->d_name, prefix, strlen(prefix)) != 0) continue;

                char filepath[512];
                snprintf(filepath, sizeof(filepath), "%s/%s", CROP_HIST_PLANTS_DIR, entry->d_name);
                struct stat st;
                if (stat(filepath, &st) == 0) {
                    del_bytes += st.st_size;
                    unlink(filepath);
                    del_records++;
                }
            }
            closedir(d);
        }
    } else if (strcmp(job.dataset, "telemetry") == 0) {
        /* Truncate telemetry log after successful acknowledged export */
        const char *p = "/sdcard/telemetry.jsonl";
        struct stat st;
        if (stat(p, &st) == 0) {
            del_bytes = st.st_size;
            del_records = job.record_count;
            unlink(p);
        }
    } else if (strcmp(job.dataset, "events") == 0) {
        const char *p = "/sdcard/events.log";
        struct stat st;
        if (stat(p, &st) == 0) {
            del_bytes = st.st_size;
            del_records = job.record_count;
            unlink(p);
        }
    } else if (strcmp(job.dataset, "fertigation_runs") == 0) {
        const char *p = "/sdcard/fertigation_runs.jsonl";
        struct stat st;
        if (stat(p, &st) == 0) {
            del_bytes = st.st_size;
            del_records = job.record_count;
            unlink(p);
        }
    }

    /* Move job from pending to completed */
    job.state = EXPORT_STATE_COMPLETED;
    char pending_path[128];
    char completed_path[128];
    snprintf(pending_path, sizeof(pending_path), "%s/%s.json", EXPORT_DIR_PENDING, export_id);
    snprintf(completed_path, sizeof(completed_path), "%s/%s.json", EXPORT_DIR_COMPLETED, export_id);
    unlink(pending_path);

    cJSON *comp_json = job_to_json(&job);
    cJSON_AddNumberToObject(comp_json, "deletedRecords", (double)del_records);
    cJSON_AddNumberToObject(comp_json, "deletedBytes", (double)del_bytes);
    char *comp_str = cJSON_Print(comp_json);
    cJSON_Delete(comp_json);

    if (comp_str) {
        FILE *cf = fopen(completed_path, "w");
        if (cf) {
            fputs(comp_str, cf);
            fclose(cf);
        }
        free(comp_str);
    }

    sdcard_hal_unlock();

    if (out_deleted_records) *out_deleted_records = del_records;
    if (out_deleted_bytes) *out_deleted_bytes = del_bytes;
    ESP_LOGI(TAG, "Export job %s ACK committed: deleted %zu records, freed %zu bytes",
             export_id, del_records, del_bytes);
    return ESP_OK;
}
