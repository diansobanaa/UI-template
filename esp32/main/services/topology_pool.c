#include "services/topology_pool.h"
#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "network/network_mgr.h"
#include "storage/storage_mgr.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static const char *TAG = "TOPOLOGY_POOL";
static const char *POOL_FILE = "/spiffs/topology_pool.json";
static const char *POOL_CAND_FILE = "/spiffs/topology_pool.cand.json";
static const char *POOL_BAK_FILE = "/spiffs/topology_pool.bak.json";

static SemaphoreHandle_t s_pool_mutex = NULL;
static cJSON *s_active_pool = NULL;
static bool s_initialized = false;

/* --------------------------------------------------------------------------
 * Portable Standard SHA-256 Engine
 * -------------------------------------------------------------------------- */
typedef struct {
  uint32_t state[8];
  uint64_t count;
  uint8_t buffer[64];
} portable_sha256_ctx_t;

#define ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
#define CH(x, y, z) (((x) & (y)) ^ (~(x) & (z)))
#define MAJ(x, y, z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define SIG0(x) (ROTR(x, 2) ^ ROTR(x, 13) ^ ROTR(x, 22))
#define SIG1(x) (ROTR(x, 6) ^ ROTR(x, 11) ^ ROTR(x, 25))
#define OM0(x) (ROTR(x, 7) ^ ROTR(x, 18) ^ ((x) >> 3))
#define OM1(x) (ROTR(x, 17) ^ ROTR(x, 19) ^ ((x) >> 10))

static const uint32_t K256[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

static void sha256_transform(portable_sha256_ctx_t *ctx,
                             const uint8_t data[64]) {
  uint32_t a = ctx->state[0], b = ctx->state[1], c = ctx->state[2],
           d = ctx->state[3];
  uint32_t e = ctx->state[4], f = ctx->state[5], g = ctx->state[6],
           h = ctx->state[7];
  uint32_t w[64];

  for (int i = 0; i < 16; ++i) {
    w[i] = ((uint32_t)data[i * 4] << 24) | ((uint32_t)data[i * 4 + 1] << 16) |
           ((uint32_t)data[i * 4 + 2] << 8) | ((uint32_t)data[i * 4 + 3]);
  }
  for (int i = 16; i < 64; ++i) {
    w[i] = OM1(w[i - 2]) + w[i - 7] + OM0(w[i - 15]) + w[i - 16];
  }
  for (int i = 0; i < 64; ++i) {
    uint32_t t1 = h + SIG1(e) + CH(e, f, g) + K256[i] + w[i];
    uint32_t t2 = SIG0(a) + MAJ(a, b, c);
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  ctx->state[0] += a;
  ctx->state[1] += b;
  ctx->state[2] += c;
  ctx->state[3] += d;
  ctx->state[4] += e;
  ctx->state[5] += f;
  ctx->state[6] += g;
  ctx->state[7] += h;
}

static void sha256_init(portable_sha256_ctx_t *ctx) {
  ctx->state[0] = 0x6a09e667;
  ctx->state[1] = 0xbb67ae85;
  ctx->state[2] = 0x3c6ef372;
  ctx->state[3] = 0xa54ff53a;
  ctx->state[4] = 0x510e527f;
  ctx->state[5] = 0x9b05688c;
  ctx->state[6] = 0x1f83d9ab;
  ctx->state[7] = 0x5be0cd19;
  ctx->count = 0;
}

static void sha256_update(portable_sha256_ctx_t *ctx, const uint8_t *data,
                          size_t len) {
  size_t i = 0;
  size_t buffer_idx = (size_t)(ctx->count & 0x3F);
  ctx->count += len;

  if (buffer_idx > 0 && buffer_idx + len >= 64) {
    memcpy(&ctx->buffer[buffer_idx], data, 64 - buffer_idx);
    sha256_transform(ctx, ctx->buffer);
    i = 64 - buffer_idx;
    buffer_idx = 0;
  }
  while (i + 64 <= len) {
    sha256_transform(ctx, &data[i]);
    i += 64;
  }
  if (i < len) {
    memcpy(&ctx->buffer[buffer_idx], &data[i], len - i);
  }
}

static void sha256_final(portable_sha256_ctx_t *ctx, uint8_t hash[32]) {
  uint64_t total_bits = ctx->count * 8;
  size_t buffer_idx = (size_t)(ctx->count & 0x3F);
  ctx->buffer[buffer_idx++] = 0x80;

  if (buffer_idx > 56) {
    memset(&ctx->buffer[buffer_idx], 0, 64 - buffer_idx);
    sha256_transform(ctx, ctx->buffer);
    buffer_idx = 0;
  }
  memset(&ctx->buffer[buffer_idx], 0, 56 - buffer_idx);
  for (int i = 0; i < 8; ++i) {
    ctx->buffer[56 + i] = (uint8_t)(total_bits >> ((7 - i) * 8));
  }
  sha256_transform(ctx, ctx->buffer);

  for (int i = 0; i < 8; ++i) {
    hash[i * 4] = (uint8_t)(ctx->state[i] >> 24);
    hash[i * 4 + 1] = (uint8_t)(ctx->state[i] >> 16);
    hash[i * 4 + 2] = (uint8_t)(ctx->state[i] >> 8);
    hash[i * 4 + 3] = (uint8_t)(ctx->state[i]);
  }
}

/* --------------------------------------------------------------------------
 * Canonical Object Sorting & Hashing Helpers
 * -------------------------------------------------------------------------- */

static int cmp_strings(const void *a, const void *b) {
  return strcmp(*(const char **)a, *(const char **)b);
}

static cJSON *create_sorted_string_array(cJSON *arr) {
  cJSON *out = cJSON_CreateArray();
  if (!arr || !cJSON_IsArray(arr))
    return out;
  int n = cJSON_GetArraySize(arr);
  if (n == 0)
    return out;
  const char **items = (const char **)malloc(n * sizeof(const char *));
  if (!items)
    return out;
  int count = 0;
  cJSON *it = NULL;
  cJSON_ArrayForEach(it, arr) {
    if (cJSON_IsString(it) && it->valuestring) {
      items[count++] = it->valuestring;
    }
  }
  qsort(items, count, sizeof(const char *), cmp_strings);
  for (int i = 0; i < count; ++i) {
    cJSON_AddItemToArray(out, cJSON_CreateString(items[i]));
  }
  free(items);
  return out;
}

esp_err_t topology_pool_calculate_hash(cJSON *pool, char *out_hash,
                                       size_t max_len) {
  if (!pool || !out_hash || max_len < 72)
    return ESP_ERR_INVALID_ARG;

  cJSON *canonical = cJSON_CreateObject();

  /* 1. complexes */
  cJSON *src_complexes = cJSON_GetObjectItem(pool, "complexes");
  cJSON *out_complexes = cJSON_AddArrayToObject(canonical, "complexes");
  if (src_complexes && cJSON_IsArray(src_complexes)) {
    int n = cJSON_GetArraySize(src_complexes);
    cJSON **arr = (cJSON **)malloc(n * sizeof(cJSON *));
    if (arr) {
      int cnt = 0;
      cJSON *c = NULL;
      cJSON_ArrayForEach(c, src_complexes) {
        if (cJSON_IsObject(c))
          arr[cnt++] = c;
      }
      /* sort by complexId */
      for (int i = 0; i < cnt - 1; ++i) {
        for (int j = i + 1; j < cnt; ++j) {
          cJSON *id_a = cJSON_GetObjectItem(arr[i], "complexId");
          cJSON *id_b = cJSON_GetObjectItem(arr[j], "complexId");
          const char *sa =
              (id_a && cJSON_IsString(id_a)) ? id_a->valuestring : "";
          const char *sb =
              (id_b && cJSON_IsString(id_b)) ? id_b->valuestring : "";
          if (strcmp(sa, sb) > 0) {
            cJSON *tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
          }
        }
      }
      for (int i = 0; i < cnt; ++i) {
        cJSON *src = arr[i];
        cJSON *dst = cJSON_CreateObject();
        cJSON *cid = cJSON_GetObjectItem(src, "complexId");
        cJSON_AddStringToObject(dst, "complexId",
                                (cid && cJSON_IsString(cid)) ? cid->valuestring
                                                             : "");
        cJSON *ghs = cJSON_GetObjectItem(src, "greenhouses");
        cJSON_AddItemToObject(dst, "greenhouses",
                              create_sorted_string_array(ghs));
        cJSON *name = cJSON_GetObjectItem(src, "name");
        cJSON_AddStringToObject(
            dst, "name",
            (name && cJSON_IsString(name)) ? name->valuestring : "");
        cJSON *owner = cJSON_GetObjectItem(src, "ownerDeviceId");
        cJSON_AddStringToObject(
            dst, "ownerDeviceId",
            (owner && cJSON_IsString(owner)) ? owner->valuestring : "");
        cJSON *rec_rev = cJSON_GetObjectItem(src, "recordRevision");
        cJSON_AddNumberToObject(
            dst, "recordRevision",
            (rec_rev && cJSON_IsNumber(rec_rev)) ? rec_rev->valueint : 1);
        cJSON *state = cJSON_GetObjectItem(src, "state");
        cJSON_AddStringToObject(
            dst, "state",
            (state && cJSON_IsString(state)) ? state->valuestring : "ACTIVE");
        cJSON_AddItemToArray(out_complexes, dst);
      }
      free(arr);
    }
  }

  /* 2. devices */
  cJSON *src_devices = cJSON_GetObjectItem(pool, "devices");
  cJSON *out_devices = cJSON_AddArrayToObject(canonical, "devices");
  if (src_devices && cJSON_IsArray(src_devices)) {
    int n = cJSON_GetArraySize(src_devices);
    cJSON **arr = (cJSON **)malloc(n * sizeof(cJSON *));
    if (arr) {
      int cnt = 0;
      cJSON *d = NULL;
      cJSON_ArrayForEach(d, src_devices) {
        if (cJSON_IsObject(d))
          arr[cnt++] = d;
      }
      for (int i = 0; i < cnt - 1; ++i) {
        for (int j = i + 1; j < cnt; ++j) {
          cJSON *id_a = cJSON_GetObjectItem(arr[i], "deviceId");
          cJSON *id_b = cJSON_GetObjectItem(arr[j], "deviceId");
          const char *sa =
              (id_a && cJSON_IsString(id_a)) ? id_a->valuestring : "";
          const char *sb =
              (id_b && cJSON_IsString(id_b)) ? id_b->valuestring : "";
          if (strcmp(sa, sb) > 0) {
            cJSON *tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
          }
        }
      }
      for (int i = 0; i < cnt; ++i) {
        cJSON *src = arr[i];
        cJSON *dst = cJSON_CreateObject();
        cJSON *cver = cJSON_GetObjectItem(src, "contractVersion");
        cJSON_AddNumberToObject(dst, "contractVersion",
                                (cver && cJSON_IsNumber(cver))
                                    ? cver->valueint
                                    : TOPOLOGY_SCHEMA_VERSION);
        cJSON *did = cJSON_GetObjectItem(src, "deviceId");
        cJSON_AddStringToObject(dst, "deviceId",
                                (did && cJSON_IsString(did)) ? did->valuestring
                                                             : "");
        cJSON *st = cJSON_GetObjectItem(src, "deviceState");
        cJSON_AddStringToObject(dst, "deviceState",
                                (st && cJSON_IsString(st)) ? st->valuestring
                                                           : "KNOWN");
        cJSON *host = cJSON_GetObjectItem(src, "hostname");
        cJSON_AddStringToObject(
            dst, "hostname",
            (host && cJSON_IsString(host)) ? host->valuestring : "");
        cJSON *owned = cJSON_GetObjectItem(src, "ownerComplexIds");
        cJSON_AddItemToObject(dst, "ownerComplexIds",
                              create_sorted_string_array(owned));
        cJSON_AddItemToArray(out_devices, dst);
      }
      free(arr);
    }
  }

  /* 3. greenhouses */
  cJSON *src_ghs = cJSON_GetObjectItem(pool, "greenhouses");
  cJSON *out_ghs = cJSON_AddArrayToObject(canonical, "greenhouses");
  if (src_ghs && cJSON_IsArray(src_ghs)) {
    int n = cJSON_GetArraySize(src_ghs);
    cJSON **arr = (cJSON **)malloc(n * sizeof(cJSON *));
    if (arr) {
      int cnt = 0;
      cJSON *g = NULL;
      cJSON_ArrayForEach(g, src_ghs) {
        if (cJSON_IsObject(g))
          arr[cnt++] = g;
      }
      for (int i = 0; i < cnt - 1; ++i) {
        for (int j = i + 1; j < cnt; ++j) {
          cJSON *id_a = cJSON_GetObjectItem(arr[i], "ghId");
          cJSON *id_b = cJSON_GetObjectItem(arr[j], "ghId");
          const char *sa =
              (id_a && cJSON_IsString(id_a)) ? id_a->valuestring : "";
          const char *sb =
              (id_b && cJSON_IsString(id_b)) ? id_b->valuestring : "";
          if (strcmp(sa, sb) > 0) {
            cJSON *tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
          }
        }
      }
      for (int i = 0; i < cnt; ++i) {
        cJSON *src = arr[i];
        cJSON *dst = cJSON_CreateObject();
        cJSON *cid = cJSON_GetObjectItem(src, "complexId");
        cJSON_AddStringToObject(dst, "complexId",
                                (cid && cJSON_IsString(cid)) ? cid->valuestring
                                                             : "");
        cJSON *gid = cJSON_GetObjectItem(src, "ghId");
        cJSON_AddStringToObject(
            dst, "ghId", (gid && cJSON_IsString(gid)) ? gid->valuestring : "");
        cJSON *name = cJSON_GetObjectItem(src, "name");
        cJSON_AddStringToObject(
            dst, "name",
            (name && cJSON_IsString(name)) ? name->valuestring : "");
        cJSON *rec_rev = cJSON_GetObjectItem(src, "recordRevision");
        cJSON_AddNumberToObject(
            dst, "recordRevision",
            (rec_rev && cJSON_IsNumber(rec_rev)) ? rec_rev->valueint : 1);
        cJSON *state = cJSON_GetObjectItem(src, "state");
        cJSON_AddStringToObject(
            dst, "state",
            (state && cJSON_IsString(state)) ? state->valuestring : "ACTIVE");
        cJSON_AddItemToArray(out_ghs, dst);
      }
      free(arr);
    }
  }

  /* 4. poolRevision */
  cJSON *rev = cJSON_GetObjectItem(pool, "poolRevision");
  cJSON_AddNumberToObject(canonical, "poolRevision",
                          (rev && cJSON_IsNumber(rev)) ? rev->valueint : 1);

  /* 5. schemaId & schemaVersion */
  cJSON_AddStringToObject(canonical, "schemaId", TOPOLOGY_SCHEMA_ID);
  cJSON_AddNumberToObject(canonical, "schemaVersion", TOPOLOGY_SCHEMA_VERSION);

  /* 6. tombstones */
  cJSON *src_tombs = cJSON_GetObjectItem(pool, "tombstones");
  cJSON *out_tombs = cJSON_AddArrayToObject(canonical, "tombstones");
  if (src_tombs && cJSON_IsArray(src_tombs)) {
    int n = cJSON_GetArraySize(src_tombs);
    cJSON **arr = (cJSON **)malloc(n * sizeof(cJSON *));
    if (arr) {
      int cnt = 0;
      cJSON *t = NULL;
      cJSON_ArrayForEach(t, src_tombs) {
        if (cJSON_IsObject(t))
          arr[cnt++] = t;
      }
      for (int i = 0; i < cnt - 1; ++i) {
        for (int j = i + 1; j < cnt; ++j) {
          cJSON *ta = cJSON_GetObjectItem(arr[i], "entityType");
          cJSON *tb = cJSON_GetObjectItem(arr[j], "entityType");
          cJSON *ia = cJSON_GetObjectItem(arr[i], "entityId");
          cJSON *ib = cJSON_GetObjectItem(arr[j], "entityId");
          const char *sta = (ta && cJSON_IsString(ta)) ? ta->valuestring : "";
          const char *stb = (tb && cJSON_IsString(tb)) ? tb->valuestring : "";
          int comp = strcmp(sta, stb);
          if (comp == 0) {
            const char *sia = (ia && cJSON_IsString(ia)) ? ia->valuestring : "";
            const char *sib = (ib && cJSON_IsString(ib)) ? ib->valuestring : "";
            comp = strcmp(sia, sib);
          }
          if (comp > 0) {
            cJSON *tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
          }
        }
      }
      for (int i = 0; i < cnt; ++i) {
        cJSON *src = arr[i];
        cJSON *dst = cJSON_CreateObject();
        cJSON *del_at = cJSON_GetObjectItem(src, "deletedAt");
        cJSON_AddStringToObject(
            dst, "deletedAt",
            (del_at && cJSON_IsString(del_at)) ? del_at->valuestring : "");
        cJSON *del_chg = cJSON_GetObjectItem(src, "deletionChangeId");
        cJSON_AddStringToObject(
            dst, "deletionChangeId",
            (del_chg && cJSON_IsString(del_chg)) ? del_chg->valuestring : "");
        cJSON *eid = cJSON_GetObjectItem(src, "entityId");
        cJSON_AddStringToObject(dst, "entityId",
                                (eid && cJSON_IsString(eid)) ? eid->valuestring
                                                             : "");
        cJSON *et = cJSON_GetObjectItem(src, "entityType");
        cJSON_AddStringToObject(dst, "entityType",
                                (et && cJSON_IsString(et)) ? et->valuestring
                                                           : "");
        cJSON *rec_rev = cJSON_GetObjectItem(src, "recordRevision");
        cJSON_AddNumberToObject(
            dst, "recordRevision",
            (rec_rev && cJSON_IsNumber(rec_rev)) ? rec_rev->valueint : 1);
        cJSON_AddItemToArray(out_tombs, dst);
      }
      free(arr);
    }
  }

  char *json_unformatted = cJSON_PrintUnformatted(canonical);
  cJSON_Delete(canonical);
  if (!json_unformatted)
    return ESP_ERR_NO_MEM;

  portable_sha256_ctx_t ctx;
  sha256_init(&ctx);
  sha256_update(&ctx, (const uint8_t *)json_unformatted,
                strlen(json_unformatted));
  uint8_t hash[32];
  sha256_final(&ctx, hash);
  free(json_unformatted);

  char hex[65];
  for (int i = 0; i < 32; ++i) {
    snprintf(&hex[i * 2], 3, "%02x", hash[i]);
  }
  snprintf(out_hash, max_len, "sha256:%s", hex);
  return ESP_OK;
}

/* --------------------------------------------------------------------------
 * Persistence Engine
 * -------------------------------------------------------------------------- */

static esp_err_t save_pool_locked(void) {
  if (!s_active_pool)
    return ESP_ERR_INVALID_STATE;

  char hash_str[72];
  if (topology_pool_calculate_hash(s_active_pool, hash_str, sizeof(hash_str)) ==
      ESP_OK) {
    cJSON_ReplaceItemInObject(s_active_pool, "poolHash",
                              cJSON_CreateString(hash_str));
  }

  char *str = cJSON_PrintUnformatted(s_active_pool);
  if (!str)
    return ESP_ERR_NO_MEM;

  /* Write candidate file */
  FILE *f = fopen(POOL_CAND_FILE, "w");
  if (!f) {
    free(str);
    ESP_LOGE(TAG, "Failed to open %s for write", POOL_CAND_FILE);
    return ESP_FAIL;
  }
  size_t written = fwrite(str, 1, strlen(str), f);
  fclose(f);
  free(str);

  if (written == 0)
    return ESP_FAIL;

  /* Backup existing pool */
  unlink(POOL_BAK_FILE);
  rename(POOL_FILE, POOL_BAK_FILE);

  /* Atomically promote candidate */
  if (rename(POOL_CAND_FILE, POOL_FILE) != 0) {
    ESP_LOGE(TAG, "Failed to rename %s to %s", POOL_CAND_FILE, POOL_FILE);
    rename(POOL_BAK_FILE, POOL_FILE);
    return ESP_FAIL;
  }

  ESP_LOGI(TAG, "Topology pool saved atomically (rev %d, hash: %s)",
           cJSON_GetObjectItem(s_active_pool, "poolRevision")->valueint,
           cJSON_GetObjectItem(s_active_pool, "poolHash")->valuestring);
  return ESP_OK;
}

static esp_err_t bootstrap_initial_pool_locked(void) {
  const system_storage_state_t *st = storage_mgr_get_state();
  const char *dev_id =
      (st && st->device_id[0]) ? st->device_id : "esp32-standalone";
  const char *cplx_id = (st && st->complex_id[0]) ? st->complex_id : NULL;

  s_active_pool = cJSON_CreateObject();
  cJSON_AddStringToObject(s_active_pool, "schemaId", TOPOLOGY_SCHEMA_ID);
  cJSON_AddNumberToObject(s_active_pool, "schemaVersion",
                          TOPOLOGY_SCHEMA_VERSION);
  cJSON_AddStringToObject(s_active_pool, "contractHash",
                          TOPOLOGY_CONTRACT_HASH);
  cJSON_AddNumberToObject(s_active_pool, "poolRevision", 1);
  cJSON_AddStringToObject(s_active_pool, "originDeviceId", dev_id);

  char gen_at[32];
  time_t now = time(NULL);
  struct tm ti;
  gmtime_r(&now, &ti);
  strftime(gen_at, sizeof(gen_at), "%Y-%m-%dT%H:%M:%SZ", &ti);
  cJSON_AddStringToObject(s_active_pool, "generatedAt", gen_at);

  cJSON *devices = cJSON_AddArrayToObject(s_active_pool, "devices");
  cJSON *complexes = cJSON_AddArrayToObject(s_active_pool, "complexes");
  cJSON *greenhouses = cJSON_AddArrayToObject(s_active_pool, "greenhouses");
  cJSON_AddArrayToObject(s_active_pool, "tombstones");
  cJSON_AddArrayToObject(s_active_pool, "changes");

  /* Local device entry */
  cJSON *dev = cJSON_CreateObject();
  cJSON_AddStringToObject(dev, "deviceId", dev_id);
  cJSON_AddStringToObject(dev, "deviceState", cplx_id ? "BOUND" : "UNBOUND");
  cJSON *owned_cplx = cJSON_AddArrayToObject(dev, "ownerComplexIds");
  if (cplx_id)
    cJSON_AddItemToArray(owned_cplx, cJSON_CreateString(cplx_id));
  cJSON_AddStringToObject(dev, "hostname",
                          (st && st->hostname[0]) ? st->hostname : "");
  cJSON_AddStringToObject(dev, "lastSeenAt", gen_at);
  cJSON_AddStringToObject(dev, "lastSeenByDeviceId", dev_id);
  cJSON_AddNumberToObject(dev, "poolRevision", 1);
  cJSON_AddNumberToObject(dev, "contractVersion", TOPOLOGY_SCHEMA_VERSION);
  cJSON_AddItemToArray(devices, dev);

  /* If device is bound to a Complex, migrate existing complex & GHs */
  if (cplx_id) {
    cJSON *c = cJSON_CreateObject();
    cJSON_AddStringToObject(c, "complexId", cplx_id);
    cJSON_AddStringToObject(c, "name", cplx_id);
    cJSON_AddStringToObject(c, "ownerDeviceId", dev_id);
    cJSON_AddStringToObject(c, "state", "ACTIVE");
    cJSON *c_ghs = cJSON_AddArrayToObject(c, "greenhouses");
    cJSON_AddNumberToObject(c, "recordRevision", 1);

    /* Load existing LVC config to derive Greenhouses */
    char *cfg_buf = (char *)calloc(1, 16384);
    size_t cfg_len = 0;
    if (cfg_buf &&
        storage_mgr_load_config(cfg_buf, 16384, &cfg_len) == ESP_OK &&
        cfg_len > 0) {
      cJSON *cfg = cJSON_ParseWithLength(cfg_buf, cfg_len);
      if (cfg) {
        cJSON *gh_arr = cJSON_GetObjectItem(cfg, "greenhouses");
        if (gh_arr && cJSON_IsArray(gh_arr)) {
          cJSON *it = NULL;
          cJSON_ArrayForEach(it, gh_arr) {
            cJSON *gid = cJSON_GetObjectItem(it, "ghId");
            if (gid && cJSON_IsString(gid) && gid->valuestring[0]) {
              cJSON_AddItemToArray(c_ghs, cJSON_CreateString(gid->valuestring));
              cJSON *g = cJSON_CreateObject();
              cJSON_AddStringToObject(g, "ghId", gid->valuestring);
              cJSON_AddStringToObject(g, "complexId", cplx_id);
              cJSON *name = cJSON_GetObjectItem(it, "name");
              cJSON_AddStringToObject(g, "name",
                                      (name && cJSON_IsString(name))
                                          ? name->valuestring
                                          : gid->valuestring);
              cJSON_AddStringToObject(g, "state", "ACTIVE");
              cJSON_AddNumberToObject(g, "recordRevision", 1);
              cJSON_AddItemToArray(greenhouses, g);
            }
          }
        }
        cJSON_Delete(cfg);
      }
    }
    free(cfg_buf);
    cJSON_AddItemToArray(complexes, c);
  }

  cJSON_AddStringToObject(s_active_pool, "poolHash", "");
  return save_pool_locked();
}

esp_err_t topology_pool_init(void) {
  if (s_initialized)
    return ESP_OK;
  if (!s_pool_mutex)
    s_pool_mutex = xSemaphoreCreateMutex();

  xSemaphoreTake(s_pool_mutex, portMAX_DELAY);

  /* Try loading from POOL_FILE */
  FILE *f = fopen(POOL_FILE, "r");
  if (!f) {
    /* Check backup */
    f = fopen(POOL_BAK_FILE, "r");
  }

  if (f) {
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (sz > 0 && sz < 64 * 1024) {
      char *buf = (char *)malloc(sz + 1);
      if (buf) {
        size_t read_bytes = fread(buf, 1, sz, f);
        buf[read_bytes] = '\0';
        s_active_pool = cJSON_Parse(buf);
        free(buf);
      }
    }
    fclose(f);
  }

  /* Validate schema of loaded pool */
  if (s_active_pool) {
    cJSON *sid = cJSON_GetObjectItem(s_active_pool, "schemaId");
    cJSON *sver = cJSON_GetObjectItem(s_active_pool, "schemaVersion");
    if (!sid || !cJSON_IsString(sid) ||
        strcmp(sid->valuestring, TOPOLOGY_SCHEMA_ID) != 0 || !sver ||
        !cJSON_IsNumber(sver) || sver->valueint != TOPOLOGY_SCHEMA_VERSION) {
      cJSON_Delete(s_active_pool);
      s_active_pool = NULL;
    }
  }

  /* If no valid pool loaded, derive from existing storage */
  if (!s_active_pool) {
    ESP_LOGI(TAG, "No valid topology pool found. Bootstrapping initial pool "
                  "from active configuration...");
    bootstrap_initial_pool_locked();
  } else {
    ESP_LOGI(TAG, "Topology pool loaded successfully (rev %d, hash: %s)",
             cJSON_GetObjectItem(s_active_pool, "poolRevision")->valueint,
             cJSON_GetObjectItem(s_active_pool, "poolHash")
                 ? cJSON_GetObjectItem(s_active_pool, "poolHash")->valuestring
                 : "none");

    /* Self-healing: if device is bound to a Complex in NVS, ensure it's not tombstoned and present in pool */
    const system_storage_state_t *st = storage_mgr_get_state();
    if (st && st->complex_id[0]) {
      cJSON *tombs = cJSON_GetObjectItem(s_active_pool, "tombstones");
      if (tombs && cJSON_IsArray(tombs)) {
        int count = cJSON_GetArraySize(tombs);
        for (int i = count - 1; i >= 0; --i) {
          cJSON *t = cJSON_GetArrayItem(tombs, i);
          cJSON *et = cJSON_GetObjectItem(t, "entityType");
          cJSON *eid = cJSON_GetObjectItem(t, "entityId");
          if (et && cJSON_IsString(et) && strcmp(et->valuestring, "COMPLEX") == 0 &&
              eid && cJSON_IsString(eid) && strcmp(eid->valuestring, st->complex_id) == 0) {
            cJSON_DeleteItemFromArray(tombs, i);
          }
        }
      }
      cJSON *complexes = cJSON_GetObjectItem(s_active_pool, "complexes");
      bool found = false;
      cJSON *it = NULL;
      cJSON_ArrayForEach(it, complexes) {
        cJSON *cid = cJSON_GetObjectItem(it, "complexId");
        if (cid && cJSON_IsString(cid) && strcmp(cid->valuestring, st->complex_id) == 0) {
          found = true;
          break;
        }
      }
      if (!found && complexes) {
        cJSON *c = cJSON_CreateObject();
        cJSON_AddStringToObject(c, "complexId", st->complex_id);
        cJSON_AddStringToObject(c, "name", st->complex_id);
        cJSON_AddStringToObject(c, "ownerDeviceId", st->device_id);
        cJSON_AddStringToObject(c, "state", "ACTIVE");
        cJSON_AddArrayToObject(c, "greenhouses");
        cJSON_AddNumberToObject(c, "recordRevision", 1);
        cJSON_AddItemToArray(complexes, c);
        save_pool_locked();
      }
    }
  }

  s_initialized = true;
  xSemaphoreGive(s_pool_mutex);
  return ESP_OK;
}

esp_err_t topology_pool_get_json(char **out_json) {
  if (!out_json)
    return ESP_ERR_INVALID_ARG;
  if (!s_initialized)
    topology_pool_init();

  xSemaphoreTake(s_pool_mutex, portMAX_DELAY);
  if (!s_active_pool) {
    xSemaphoreGive(s_pool_mutex);
    return ESP_ERR_INVALID_STATE;
  }
  *out_json = cJSON_PrintUnformatted(s_active_pool);
  xSemaphoreGive(s_pool_mutex);
  return *out_json ? ESP_OK : ESP_ERR_NO_MEM;
}

esp_err_t topology_pool_get_meta_json(char **out_json) {
  if (!out_json)
    return ESP_ERR_INVALID_ARG;
  if (!s_initialized)
    topology_pool_init();

  xSemaphoreTake(s_pool_mutex, portMAX_DELAY);
  if (!s_active_pool) {
    xSemaphoreGive(s_pool_mutex);
    return ESP_ERR_INVALID_STATE;
  }

  const system_storage_state_t *st = storage_mgr_get_state();
  cJSON *meta = cJSON_CreateObject();
  cJSON_AddStringToObject(meta, "schemaId", TOPOLOGY_SCHEMA_ID);
  cJSON_AddNumberToObject(meta, "schemaVersion", TOPOLOGY_SCHEMA_VERSION);
  cJSON_AddStringToObject(meta, "contractHash", TOPOLOGY_CONTRACT_HASH);
  cJSON_AddNumberToObject(
      meta, "poolRevision",
      cJSON_GetObjectItem(s_active_pool, "poolRevision")->valueint);
  cJSON_AddStringToObject(
      meta, "poolHash",
      cJSON_GetObjectItem(s_active_pool, "poolHash")->valuestring);
  cJSON_AddStringToObject(meta, "deviceId",
                          (st && st->device_id[0]) ? st->device_id : "esp32");

  *out_json = cJSON_PrintUnformatted(meta);
  cJSON_Delete(meta);
  xSemaphoreGive(s_pool_mutex);
  return *out_json ? ESP_OK : ESP_ERR_NO_MEM;
}

static esp_err_t record_tombstone_locked(const char *entity_type,
                                         const char *entity_id,
                                         const char *change_id);

static bool is_tombstoned_locked(const char *entity_type,
                                 const char *entity_id) {
  cJSON *tombs = cJSON_GetObjectItem(s_active_pool, "tombstones");
  if (!tombs || !cJSON_IsArray(tombs))
    return false;
  cJSON *t = NULL;
  cJSON_ArrayForEach(t, tombs) {
    cJSON *et = cJSON_GetObjectItem(t, "entityType");
    cJSON *eid = cJSON_GetObjectItem(t, "entityId");
    if (et && cJSON_IsString(et) && eid && cJSON_IsString(eid)) {
      if (strcmp(et->valuestring, entity_type) == 0 &&
          strcmp(eid->valuestring, entity_id) == 0) {
        return true;
      }
    }
  }
  return false;
}

esp_err_t topology_pool_apply_mutation(cJSON *mutation, cJSON **out_result) {
  if (!mutation || !out_result)
    return ESP_ERR_INVALID_ARG;
  if (!s_initialized)
    topology_pool_init();

  xSemaphoreTake(s_pool_mutex, portMAX_DELAY);

  cJSON *op_item = cJSON_GetObjectItem(mutation, "operation");
  const char *op =
      (op_item && cJSON_IsString(op_item)) ? op_item->valuestring : "";

  cJSON *chg_item = cJSON_GetObjectItem(mutation, "changeId");
  if (!chg_item) chg_item = cJSON_GetObjectItem(mutation, "operationId");
  char change_id[64];
  if (chg_item && cJSON_IsString(chg_item) && chg_item->valuestring[0]) {
    snprintf(change_id, sizeof(change_id), "%s", chg_item->valuestring);
  } else {
    snprintf(change_id, sizeof(change_id), "chg-%lu",
             (unsigned long)esp_random());
  }

  /* Check idempotency first: if already applied, return success without triggering revision conflict */
  cJSON *changes = cJSON_GetObjectItem(s_active_pool, "changes");
  if (changes && cJSON_IsArray(changes)) {
    cJSON *chg = NULL;
    cJSON_ArrayForEach(chg, changes) {
      cJSON *cid = cJSON_GetObjectItem(chg, "changeId");
      if (cid && cJSON_IsString(cid) &&
          strcmp(cid->valuestring, change_id) == 0) {
        cJSON *res = cJSON_CreateObject();
        cJSON_AddStringToObject(res, "status", "ALREADY_APPLIED");
        cJSON_AddStringToObject(res, "changeId", change_id);
        cJSON *cur_rev = cJSON_GetObjectItem(s_active_pool, "poolRevision");
        cJSON_AddNumberToObject(res, "poolRevision", (cur_rev && cJSON_IsNumber(cur_rev)) ? cur_rev->valueint : 1);
        cJSON *cur_hash = cJSON_GetObjectItem(s_active_pool, "poolHash");
        cJSON_AddStringToObject(res, "poolHash", (cur_hash && cJSON_IsString(cur_hash)) ? cur_hash->valuestring : "");
        cJSON_AddItemToObject(res, "pool", cJSON_Duplicate(s_active_pool, 1));
        *out_result = res;
        xSemaphoreGive(s_pool_mutex);
        return ESP_OK;
      }
    }
  }

  /* Concurrency check (optimistic revision): only evaluated for new mutations */
  cJSON *exp_rev_item = cJSON_GetObjectItem(mutation, "expectedRevision");
  if (exp_rev_item && cJSON_IsNumber(exp_rev_item) && exp_rev_item->valueint > 0) {
    cJSON *cur_rev_item = cJSON_GetObjectItem(s_active_pool, "poolRevision");
    int cur_rev = (cur_rev_item && cJSON_IsNumber(cur_rev_item)) ? cur_rev_item->valueint : 1;
    if (exp_rev_item->valueint != cur_rev) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_VERSION; /* Mapped to HTTP 409 TOPOLOGY_REVISION_CONFLICT */
    }
  }

  const system_storage_state_t *st = storage_mgr_get_state();
  const char *local_did = (st && st->device_id[0]) ? st->device_id : "esp32";

  char now_iso[32];
  time_t now = time(NULL);
  struct tm ti;
  gmtime_r(&now, &ti);
  strftime(now_iso, sizeof(now_iso), "%Y-%m-%dT%H:%M:%SZ", &ti);

  if (strcmp(op, "CREATE_COMPLEX") == 0) {
    cJSON *cid = cJSON_GetObjectItem(mutation, "complexId");
    if (!cid || !cJSON_IsString(cid) || !cid->valuestring[0]) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_ARG;
    }
    if (is_tombstoned_locked("COMPLEX", cid->valuestring)) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_STATE;
    }
    cJSON *name = cJSON_GetObjectItem(mutation, "name");
    cJSON *owner = cJSON_GetObjectItem(mutation, "ownerDeviceId");
    const char *owner_str =
        (owner && cJSON_IsString(owner)) ? owner->valuestring : local_did;

    cJSON *c = cJSON_CreateObject();
    cJSON_AddStringToObject(c, "complexId", cid->valuestring);
    cJSON_AddStringToObject(c, "name",
                            (name && cJSON_IsString(name)) ? name->valuestring
                                                           : cid->valuestring);
    cJSON_AddStringToObject(c, "ownerDeviceId", owner_str);
    cJSON_AddStringToObject(c, "state", "ACTIVE");
    cJSON_AddArrayToObject(c, "greenhouses");
    cJSON_AddNumberToObject(c, "recordRevision", 1);
    cJSON_AddItemToArray(cJSON_GetObjectItem(s_active_pool, "complexes"), c);

  } else if (strcmp(op, "CREATE_GREENHOUSE") == 0) {
    cJSON *cid = cJSON_GetObjectItem(mutation, "complexId");
    cJSON *gid = cJSON_GetObjectItem(mutation, "ghId");
    if (!cid || !gid || !cJSON_IsString(cid) || !cJSON_IsString(gid)) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_ARG;
    }
    if (is_tombstoned_locked("GREENHOUSE", gid->valuestring) ||
        is_tombstoned_locked("COMPLEX", cid->valuestring)) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_STATE;
    }
    cJSON *name = cJSON_GetObjectItem(mutation, "name");
    cJSON *g = cJSON_CreateObject();
    cJSON_AddStringToObject(g, "ghId", gid->valuestring);
    cJSON_AddStringToObject(g, "complexId", cid->valuestring);
    cJSON_AddStringToObject(g, "name",
                            (name && cJSON_IsString(name)) ? name->valuestring
                                                           : gid->valuestring);
    cJSON_AddStringToObject(g, "state", "ACTIVE");
    cJSON_AddNumberToObject(g, "recordRevision", 1);
    cJSON_AddItemToArray(cJSON_GetObjectItem(s_active_pool, "greenhouses"), g);

    /* Add to parent complex greenhouses array */
    cJSON *complexes = cJSON_GetObjectItem(s_active_pool, "complexes");
    cJSON *it = NULL;
    cJSON_ArrayForEach(it, complexes) {
      cJSON *cur_cid = cJSON_GetObjectItem(it, "complexId");
      if (cur_cid && cJSON_IsString(cur_cid) &&
          strcmp(cur_cid->valuestring, cid->valuestring) == 0) {
        cJSON *ghs = cJSON_GetObjectItem(it, "greenhouses");
        if (ghs && cJSON_IsArray(ghs)) {
          cJSON_AddItemToArray(ghs, cJSON_CreateString(gid->valuestring));
        }
        break;
      }
    }
  } else if (strcmp(op, "UPDATE_COMPLEX") == 0) {
    cJSON *cid = cJSON_GetObjectItem(mutation, "complexId");
    if (!cid || !cJSON_IsString(cid) || !cid->valuestring[0]) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_ARG;
    }
    cJSON *name = cJSON_GetObjectItem(mutation, "name");
    cJSON *location = cJSON_GetObjectItem(mutation, "location");
    cJSON *complexes = cJSON_GetObjectItem(s_active_pool, "complexes");
    cJSON *it = NULL;
    bool found = false;
    cJSON_ArrayForEach(it, complexes) {
      cJSON *cur_cid = cJSON_GetObjectItem(it, "complexId");
      if (cur_cid && cJSON_IsString(cur_cid) && strcmp(cur_cid->valuestring, cid->valuestring) == 0) {
        if (name && cJSON_IsString(name)) {
          cJSON_DeleteItemFromObject(it, "name");
          cJSON_AddStringToObject(it, "name", name->valuestring);
        }
        if (location && cJSON_IsString(location)) {
          cJSON_DeleteItemFromObject(it, "location");
          cJSON_AddStringToObject(it, "location", location->valuestring);
        }
        cJSON *rev = cJSON_GetObjectItem(it, "recordRevision");
        if (rev && cJSON_IsNumber(rev)) {
          cJSON_SetIntValue(rev, rev->valueint + 1);
        }
        found = true;
        break;
      }
    }
    if (!found) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_NOT_FOUND;
    }
  } else if (strcmp(op, "UPDATE_GREENHOUSE") == 0) {
    cJSON *gid = cJSON_GetObjectItem(mutation, "ghId");
    if (!gid || !cJSON_IsString(gid) || !gid->valuestring[0]) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_ARG;
    }
    cJSON *name = cJSON_GetObjectItem(mutation, "name");
    cJSON *greenhouses = cJSON_GetObjectItem(s_active_pool, "greenhouses");
    cJSON *it = NULL;
    bool found = false;
    cJSON_ArrayForEach(it, greenhouses) {
      cJSON *cur_gid = cJSON_GetObjectItem(it, "ghId");
      if (cur_gid && cJSON_IsString(cur_gid) && strcmp(cur_gid->valuestring, gid->valuestring) == 0) {
        if (name && cJSON_IsString(name)) {
          cJSON_DeleteItemFromObject(it, "name");
          cJSON_AddStringToObject(it, "name", name->valuestring);
        }
        cJSON *rev = cJSON_GetObjectItem(it, "recordRevision");
        if (rev && cJSON_IsNumber(rev)) {
          cJSON_SetIntValue(rev, rev->valueint + 1);
        }
        found = true;
        break;
      }
    }
    if (!found) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_NOT_FOUND;
    }
  } else if (strcmp(op, "DELETE_GREENHOUSE") == 0) {
    cJSON *gid = cJSON_GetObjectItem(mutation, "ghId");
    if (!gid || !cJSON_IsString(gid) || !gid->valuestring[0]) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_ARG;
    }
    const char *gh_id_str = gid->valuestring;
    /* Ownership rule: Only owner controller can delete greenhouse */
    cJSON *greenhouses = cJSON_GetObjectItem(s_active_pool, "greenhouses");
    cJSON *target_gh = NULL;
    cJSON *g_it = NULL;
    cJSON_ArrayForEach(g_it, greenhouses) {
      cJSON *cur_gid = cJSON_GetObjectItem(g_it, "ghId");
      if (cur_gid && cJSON_IsString(cur_gid) && strcmp(cur_gid->valuestring, gh_id_str) == 0) {
        target_gh = g_it;
        break;
      }
    }
    if (target_gh) {
      cJSON *cid = cJSON_GetObjectItem(target_gh, "complexId");
      if (cid && cJSON_IsString(cid)) {
        cJSON *complexes = cJSON_GetObjectItem(s_active_pool, "complexes");
        cJSON *c_it = NULL;
        cJSON_ArrayForEach(c_it, complexes) {
          cJSON *cur_cid = cJSON_GetObjectItem(c_it, "complexId");
          if (cur_cid && cJSON_IsString(cur_cid) && strcmp(cur_cid->valuestring, cid->valuestring) == 0) {
            cJSON *owner = cJSON_GetObjectItem(c_it, "ownerDeviceId");
            if (owner && cJSON_IsString(owner) && strcmp(owner->valuestring, local_did) != 0) {
              xSemaphoreGive(s_pool_mutex);
              return ESP_ERR_INVALID_STATE;
            }
            break;
          }
        }
      }
    }
    record_tombstone_locked("GREENHOUSE", gh_id_str, change_id);
  } else if (strcmp(op, "DELETE_COMPLEX") == 0) {
    cJSON *cid = cJSON_GetObjectItem(mutation, "complexId");
    if (!cid || !cJSON_IsString(cid) || !cid->valuestring[0]) {
      xSemaphoreGive(s_pool_mutex);
      return ESP_ERR_INVALID_ARG;
    }
    const char *cid_str = cid->valuestring;
    /* Ownership rule: Only owner controller can delete complex */
    cJSON *complexes = cJSON_GetObjectItem(s_active_pool, "complexes");
    cJSON *c_it = NULL;
    cJSON_ArrayForEach(c_it, complexes) {
      cJSON *cur_cid = cJSON_GetObjectItem(c_it, "complexId");
      if (cur_cid && cJSON_IsString(cur_cid) && strcmp(cur_cid->valuestring, cid_str) == 0) {
        cJSON *owner = cJSON_GetObjectItem(c_it, "ownerDeviceId");
        if (owner && cJSON_IsString(owner) && strcmp(owner->valuestring, local_did) != 0) {
          xSemaphoreGive(s_pool_mutex);
          return ESP_ERR_INVALID_STATE;
        }
        break;
      }
    }
    record_tombstone_locked("COMPLEX", cid_str, change_id);
  } else {
    xSemaphoreGive(s_pool_mutex);
    return ESP_ERR_NOT_SUPPORTED;
  }

  /* Increment pool revision */
  cJSON *rev = cJSON_GetObjectItem(s_active_pool, "poolRevision");
  cJSON_SetIntValue(rev, rev->valueint + 1);

  /* Record change in journal */
  cJSON *record = cJSON_CreateObject();
  cJSON_AddStringToObject(record, "changeId", change_id);
  cJSON_AddStringToObject(record, "operation", op);
  cJSON_AddStringToObject(record, "createdAt", now_iso);
  cJSON_AddItemToArray(cJSON_GetObjectItem(s_active_pool, "changes"), record);

  save_pool_locked();

  cJSON *res = cJSON_CreateObject();
  cJSON_AddStringToObject(res, "status", "SUCCESS");
  cJSON_AddStringToObject(res, "changeId", change_id);
  cJSON *saved_rev = cJSON_GetObjectItem(s_active_pool, "poolRevision");
  cJSON_AddNumberToObject(res, "poolRevision", (saved_rev && cJSON_IsNumber(saved_rev)) ? saved_rev->valueint : 1);
  cJSON *saved_hash = cJSON_GetObjectItem(s_active_pool, "poolHash");
  cJSON_AddStringToObject(res, "poolHash", (saved_hash && cJSON_IsString(saved_hash)) ? saved_hash->valuestring : "");
  cJSON_AddItemToObject(res, "pool", cJSON_Duplicate(s_active_pool, 1));
  *out_result = res;

  xSemaphoreGive(s_pool_mutex);
  return ESP_OK;
}

static esp_err_t record_tombstone_locked(const char *entity_type,
                                         const char *entity_id,
                                         const char *change_id) {
  if (!entity_type || !entity_id)
    return ESP_ERR_INVALID_ARG;

  if (is_tombstoned_locked(entity_type, entity_id)) {
    return ESP_OK;
  }

  char now_iso[32];
  time_t now = time(NULL);
  struct tm ti;
  gmtime_r(&now, &ti);
  strftime(now_iso, sizeof(now_iso), "%Y-%m-%dT%H:%M:%SZ", &ti);

  cJSON *t = cJSON_CreateObject();
  cJSON_AddStringToObject(t, "entityType", entity_type);
  cJSON_AddStringToObject(t, "entityId", entity_id);
  cJSON_AddStringToObject(t, "deletedAt", now_iso);
  cJSON_AddStringToObject(t, "deletionChangeId",
                          change_id ? change_id : "retire");
  cJSON_AddNumberToObject(t, "recordRevision", 1);
  cJSON_AddItemToArray(cJSON_GetObjectItem(s_active_pool, "tombstones"), t);

  /* If complex, remove from complexes list */
  if (strcmp(entity_type, "COMPLEX") == 0) {
    cJSON *complexes = cJSON_GetObjectItem(s_active_pool, "complexes");
    int count = cJSON_GetArraySize(complexes);
    for (int i = count - 1; i >= 0; --i) {
      cJSON *item = cJSON_GetArrayItem(complexes, i);
      cJSON *cid = cJSON_GetObjectItem(item, "complexId");
      if (cid && cJSON_IsString(cid) &&
          strcmp(cid->valuestring, entity_id) == 0) {
        cJSON_DeleteItemFromArray(complexes, i);
      }
    }
  } else if (strcmp(entity_type, "GREENHOUSE") == 0) {
    cJSON *greenhouses = cJSON_GetObjectItem(s_active_pool, "greenhouses");
    int count = cJSON_GetArraySize(greenhouses);
    for (int i = count - 1; i >= 0; --i) {
      cJSON *item = cJSON_GetArrayItem(greenhouses, i);
      cJSON *gid = cJSON_GetObjectItem(item, "ghId");
      if (gid && cJSON_IsString(gid) &&
          strcmp(gid->valuestring, entity_id) == 0) {
        cJSON_DeleteItemFromArray(greenhouses, i);
      }
    }
    cJSON *complexes = cJSON_GetObjectItem(s_active_pool, "complexes");
    cJSON *c_item = NULL;
    cJSON_ArrayForEach(c_item, complexes) {
      cJSON *c_ghs = cJSON_GetObjectItem(c_item, "greenhouses");
      if (c_ghs && cJSON_IsArray(c_ghs)) {
        int gh_cnt = cJSON_GetArraySize(c_ghs);
        for (int j = gh_cnt - 1; j >= 0; --j) {
          cJSON *gstr = cJSON_GetArrayItem(c_ghs, j);
          if (gstr && cJSON_IsString(gstr) &&
              strcmp(gstr->valuestring, entity_id) == 0) {
            cJSON_DeleteItemFromArray(c_ghs, j);
          }
        }
      }
    }
  }

  return ESP_OK;
}

esp_err_t topology_pool_record_tombstone(const char *entity_type,
                                         const char *entity_id,
                                         const char *change_id) {
  if (!entity_type || !entity_id)
    return ESP_ERR_INVALID_ARG;
  if (!s_initialized)
    topology_pool_init();

  xSemaphoreTake(s_pool_mutex, portMAX_DELAY);
  esp_err_t err = record_tombstone_locked(entity_type, entity_id, change_id);
  if (err == ESP_OK) {
    cJSON *rev = cJSON_GetObjectItem(s_active_pool, "poolRevision");
    if (rev && cJSON_IsNumber(rev)) {
      cJSON_SetIntValue(rev, rev->valueint + 1);
    }
    save_pool_locked();
  }
  xSemaphoreGive(s_pool_mutex);
  return err;
}

esp_err_t topology_pool_bind_complex(const char *complex_id, const char *device_id) {
  if (!complex_id || !complex_id[0] || !device_id || !device_id[0])
    return ESP_ERR_INVALID_ARG;
  if (!s_initialized)
    topology_pool_init();

  xSemaphoreTake(s_pool_mutex, portMAX_DELAY);

  /* 1. Remove from tombstones if present */
  cJSON *tombs = cJSON_GetObjectItem(s_active_pool, "tombstones");
  if (tombs && cJSON_IsArray(tombs)) {
    int count = cJSON_GetArraySize(tombs);
    for (int i = count - 1; i >= 0; --i) {
      cJSON *t = cJSON_GetArrayItem(tombs, i);
      cJSON *et = cJSON_GetObjectItem(t, "entityType");
      cJSON *eid = cJSON_GetObjectItem(t, "entityId");
      if (et && cJSON_IsString(et) && strcmp(et->valuestring, "COMPLEX") == 0 &&
          eid && cJSON_IsString(eid) && strcmp(eid->valuestring, complex_id) == 0) {
        cJSON_DeleteItemFromArray(tombs, i);
      }
    }
  }

  /* 2. Ensure complex exists in complexes array */
  cJSON *complexes = cJSON_GetObjectItem(s_active_pool, "complexes");
  cJSON *found = NULL;
  cJSON *it = NULL;
  cJSON_ArrayForEach(it, complexes) {
    cJSON *cid = cJSON_GetObjectItem(it, "complexId");
    if (cid && cJSON_IsString(cid) && strcmp(cid->valuestring, complex_id) == 0) {
      found = it;
      break;
    }
  }

  if (!found) {
    cJSON *c = cJSON_CreateObject();
    cJSON_AddStringToObject(c, "complexId", complex_id);
    cJSON_AddStringToObject(c, "name", complex_id);
    cJSON_AddStringToObject(c, "ownerDeviceId", device_id);
    cJSON_AddStringToObject(c, "state", "ACTIVE");
    cJSON_AddArrayToObject(c, "greenhouses");
    cJSON_AddNumberToObject(c, "recordRevision", 1);
    cJSON_AddItemToArray(complexes, c);
  } else {
    cJSON_ReplaceItemInObject(found, "ownerDeviceId", cJSON_CreateString(device_id));
    cJSON_ReplaceItemInObject(found, "state", cJSON_CreateString("ACTIVE"));
  }

  /* 3. Update local device entry */
  cJSON *devices = cJSON_GetObjectItem(s_active_pool, "devices");
  cJSON *dev_it = NULL;
  bool dev_found = false;
  cJSON_ArrayForEach(dev_it, devices) {
    cJSON *did = cJSON_GetObjectItem(dev_it, "deviceId");
    if (did && cJSON_IsString(did) && strcmp(did->valuestring, device_id) == 0) {
      cJSON_ReplaceItemInObject(dev_it, "deviceState", cJSON_CreateString("BOUND"));
      cJSON *cplx_arr = cJSON_CreateArray();
      cJSON_AddItemToArray(cplx_arr, cJSON_CreateString(complex_id));
      cJSON_ReplaceItemInObject(dev_it, "ownerComplexIds", cplx_arr);
      dev_found = true;
      break;
    }
  }
  if (!dev_found) {
    cJSON *dev = cJSON_CreateObject();
    cJSON_AddStringToObject(dev, "deviceId", device_id);
    cJSON_AddStringToObject(dev, "deviceState", "BOUND");
    cJSON *cplx_arr = cJSON_AddArrayToObject(dev, "ownerComplexIds");
    cJSON_AddItemToArray(cplx_arr, cJSON_CreateString(complex_id));
    cJSON_AddStringToObject(dev, "hostname", "");
    cJSON_AddStringToObject(dev, "lastSeenAt", "");
    cJSON_AddStringToObject(dev, "lastSeenByDeviceId", device_id);
    cJSON_AddNumberToObject(dev, "poolRevision", 1);
    cJSON_AddNumberToObject(dev, "contractVersion", TOPOLOGY_SCHEMA_VERSION);
    cJSON_AddItemToArray(devices, dev);
  }

  cJSON *rev = cJSON_GetObjectItem(s_active_pool, "poolRevision");
  if (rev && cJSON_IsNumber(rev))
    cJSON_SetIntValue(rev, rev->valueint + 1);

  save_pool_locked();
  xSemaphoreGive(s_pool_mutex);
  return ESP_OK;
}

esp_err_t topology_pool_reconcile_peer(cJSON *peer_pool, cJSON **out_result) {
  if (!peer_pool || !out_result)
    return ESP_ERR_INVALID_ARG;
  if (!s_initialized)
    topology_pool_init();

  xSemaphoreTake(s_pool_mutex, portMAX_DELAY);

  /* 1. Validate contract */
  cJSON *sid = cJSON_GetObjectItem(peer_pool, "schemaId");
  cJSON *sver = cJSON_GetObjectItem(peer_pool, "schemaVersion");
  cJSON *chash = cJSON_GetObjectItem(peer_pool, "contractHash");
  if (!sid || !cJSON_IsString(sid) ||
      strcmp(sid->valuestring, TOPOLOGY_SCHEMA_ID) != 0 || !sver ||
      !cJSON_IsNumber(sver) || sver->valueint != TOPOLOGY_SCHEMA_VERSION ||
      !chash || !cJSON_IsString(chash) ||
      strcmp(chash->valuestring, TOPOLOGY_CONTRACT_HASH) != 0) {
    xSemaphoreGive(s_pool_mutex);
    return ESP_ERR_INVALID_VERSION;
  }

  char peer_hash[72];
  topology_pool_calculate_hash(peer_pool, peer_hash, sizeof(peer_hash));
  char local_hash[72];
  topology_pool_calculate_hash(s_active_pool, local_hash, sizeof(local_hash));

  if (strcmp(peer_hash, local_hash) == 0) {
    cJSON *res = cJSON_CreateObject();
    cJSON_AddStringToObject(res, "status", "IN_SYNC");
    cJSON_AddItemToObject(res, "pool", cJSON_Duplicate(s_active_pool, 1));
    *out_result = res;
    xSemaphoreGive(s_pool_mutex);
    return ESP_OK;
  }

  /* 2. Merge tombstones first */
  cJSON *peer_tombs = cJSON_GetObjectItem(peer_pool, "tombstones");
  if (peer_tombs && cJSON_IsArray(peer_tombs)) {
    cJSON *pt = NULL;
    cJSON_ArrayForEach(pt, peer_tombs) {
      cJSON *et = cJSON_GetObjectItem(pt, "entityType");
      cJSON *eid = cJSON_GetObjectItem(pt, "entityId");
      if (et && cJSON_IsString(et) && eid && cJSON_IsString(eid)) {
        if (!is_tombstoned_locked(et->valuestring, eid->valuestring)) {
          cJSON_AddItemToArray(cJSON_GetObjectItem(s_active_pool, "tombstones"),
                               cJSON_Duplicate(pt, 1));
        }
      }
    }
  }

  /* 3. Merge complexes (respecting tombstones & ownership) */
  cJSON *peer_complexes = cJSON_GetObjectItem(peer_pool, "complexes");
  if (peer_complexes && cJSON_IsArray(peer_complexes)) {
    cJSON *pc = NULL;
    cJSON_ArrayForEach(pc, peer_complexes) {
      cJSON *cid = cJSON_GetObjectItem(pc, "complexId");
      if (!cid || !cJSON_IsString(cid))
        continue;
      if (is_tombstoned_locked("COMPLEX", cid->valuestring))
        continue;

      /* Check if local has complex */
      cJSON *local_c = NULL;
      cJSON_ArrayForEach(local_c,
                         cJSON_GetObjectItem(s_active_pool, "complexes")) {
        cJSON *cur_cid = cJSON_GetObjectItem(local_c, "complexId");
        if (cur_cid && cJSON_IsString(cur_cid) &&
            strcmp(cur_cid->valuestring, cid->valuestring) == 0) {
          break;
        }
      }

      if (!local_c) {
        cJSON_AddItemToArray(cJSON_GetObjectItem(s_active_pool, "complexes"),
                             cJSON_Duplicate(pc, 1));
      } else {
        cJSON *local_owner = cJSON_GetObjectItem(local_c, "ownerDeviceId");
        cJSON *peer_owner = cJSON_GetObjectItem(pc, "ownerDeviceId");
        if (local_owner && peer_owner && cJSON_IsString(local_owner) &&
            cJSON_IsString(peer_owner)) {
          if (strcmp(local_owner->valuestring, peer_owner->valuestring) != 0) {
            /* Ownership conflict! */
            xSemaphoreGive(s_pool_mutex);
            return ESP_ERR_INVALID_STATE;
          }
        }
      }
    }
  }

  /* 4. Merge devices */
  cJSON *peer_devices = cJSON_GetObjectItem(peer_pool, "devices");
  if (peer_devices && cJSON_IsArray(peer_devices)) {
    cJSON *pd = NULL;
    cJSON_ArrayForEach(pd, peer_devices) {
      cJSON *did = cJSON_GetObjectItem(pd, "deviceId");
      if (!did || !cJSON_IsString(did))
        continue;
      cJSON *local_d = NULL;
      cJSON_ArrayForEach(local_d,
                         cJSON_GetObjectItem(s_active_pool, "devices")) {
        cJSON *cur_did = cJSON_GetObjectItem(local_d, "deviceId");
        if (cur_did && cJSON_IsString(cur_did) &&
            strcmp(cur_did->valuestring, did->valuestring) == 0) {
          break;
        }
      }
      if (!local_d) {
        cJSON_AddItemToArray(cJSON_GetObjectItem(s_active_pool, "devices"),
                             cJSON_Duplicate(pd, 1));
      }
    }
  }

  int peer_rev = cJSON_GetObjectItem(peer_pool, "poolRevision")
                     ? cJSON_GetObjectItem(peer_pool, "poolRevision")->valueint
                     : 1;
  cJSON *local_rev = cJSON_GetObjectItem(s_active_pool, "poolRevision");
  int max_rev =
      (local_rev->valueint > peer_rev) ? local_rev->valueint : peer_rev;
  cJSON_SetIntValue(local_rev, max_rev + 1);

  save_pool_locked();

  cJSON *res = cJSON_CreateObject();
  cJSON_AddStringToObject(res, "status", "CONVERGED");
  cJSON_AddItemToObject(res, "pool", cJSON_Duplicate(s_active_pool, 1));
  *out_result = res;

  xSemaphoreGive(s_pool_mutex);
  return ESP_OK;
}
