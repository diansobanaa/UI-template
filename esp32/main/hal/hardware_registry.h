#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#include "hal/actuator_hal.h"
#include "hal/sensor_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char id[32];
    char name[48];
    char type[24];
    char role[32];
    char interface[24];
    uint8_t pin;
    uint8_t channel;
    char safety_class[16];
    char status[16];
} hw_component_info_t;

/**
 * @brief Initialize complete Hardware Abstraction Layer (Actuators, Sensors, Buttons).
 * Automatically loads dynamic /spiffs/components.json if present, falling back to defaults.
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

/**
 * @brief Load and parse dynamic hardware components from a JSON string.
 */
esp_err_t hardware_registry_load_from_json(const char *json_str);

/**
 * @brief Export baseline/default components JSON string.
 */
const char *hardware_registry_get_default_json(void);

#ifdef __cplusplus
}
#endif
