#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#include "hal/actuator_hal.h"
#include "hal/sensor_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    const char *id;
    const char *name;
    const char *type;
    const char *role;
    uint8_t pin;
    const char *safety_class;
    const char *status;
} hw_component_info_t;

/**
 * @brief Initialize complete Hardware Abstraction Layer (Actuators, Sensors, Buttons).
 */
esp_err_t hardware_hal_init_all(void);

/**
 * @brief Get total number of registered hardware components.
 */
size_t hardware_registry_get_count(void);

/**
 * @brief Get component descriptor by index.
 */
esp_err_t hardware_registry_get_by_index(size_t index, hw_component_info_t *out_info);

#ifdef __cplusplus
}
#endif
