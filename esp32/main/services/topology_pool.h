#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

#define TOPOLOGY_SCHEMA_ID "agrotech.system-topology-pool"
#define TOPOLOGY_SCHEMA_VERSION 1
#define TOPOLOGY_CONTRACT_HASH "sha256:37f9b7353170d9bc2c1cb8504eb7234209761841a2f654fe6cd975f0ffd2c6e8"

#define TOPOLOGY_ERR_CONTRACT_MISMATCH "TOPOLOGY_CONTRACT_MISMATCH"
#define TOPOLOGY_ERR_REVISION_CONFLICT "TOPOLOGY_REVISION_CONFLICT"
#define TOPOLOGY_ERR_OWNER_CONFLICT    "TOPOLOGY_OWNER_CONFLICT"
#define TOPOLOGY_ERR_PARENT_NOT_FOUND  "TOPOLOGY_PARENT_NOT_FOUND"
#define TOPOLOGY_ERR_ENTITY_TOMBSTONED "TOPOLOGY_ENTITY_TOMBSTONED"
#define TOPOLOGY_ERR_HASH_MISMATCH     "TOPOLOGY_HASH_MISMATCH"
#define TOPOLOGY_ERR_CONFLICT          "TOPOLOGY_CONFLICT"

/**
 * @brief Initialize persistent topology pool storage, load active pool,
 * or migrate/derive initial pool from existing NVS / LVC configuration.
 */
esp_err_t topology_pool_init(void);

/**
 * @brief Get full active topology pool as a newly allocated JSON string. Caller must free().
 */
esp_err_t topology_pool_get_json(char **out_json);

/**
 * @brief Get cheap metadata envelope JSON string. Caller must free().
 */
esp_err_t topology_pool_get_meta_json(char **out_json);

/**
 * @brief Apply an ownership-aware mutation (CREATE/UPDATE/DELETE Complex or GH).
 */
esp_err_t topology_pool_apply_mutation(cJSON *mutation, cJSON **out_result);

/**
 * @brief Reconcile a peer's topology pool with the local pool.
 */
esp_err_t topology_pool_reconcile_peer(cJSON *peer_pool, cJSON **out_result);

/**
 * @brief Record a tombstone upon entity retirement/deletion.
 */
esp_err_t topology_pool_record_tombstone(const char *entity_type, const char *entity_id, const char *change_id);

/**
 * @brief Bind or re-bind a complex to a device in the topology pool,
 * clearing any tombstones and ensuring the complex is ACTIVE.
 */
esp_err_t topology_pool_bind_complex(const char *complex_id, const char *device_id);

/**
 * @brief Calculate canonical SHA-256 pool hash matching the specification.
 */
esp_err_t topology_pool_calculate_hash(cJSON *pool, char *out_hash, size_t max_len);

#ifdef __cplusplus
}
#endif
