#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Build the authoritative topology/capability snapshot from the active
 * configuration. No static GH/component mapping is used.
 */
esp_err_t topology_capability_build_json(cJSON **out_json);

#ifdef __cplusplus
}
#endif
