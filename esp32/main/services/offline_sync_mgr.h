#pragma once
#include "esp_err.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t offline_sync_mgr_init(void);
bool offline_sync_mgr_is_initialized(void);

#ifdef __cplusplus
}
#endif

