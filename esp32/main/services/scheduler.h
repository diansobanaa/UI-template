#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the automated schedule runner.
 */
esp_err_t scheduler_init(void);

#ifdef __cplusplus
}
#endif
