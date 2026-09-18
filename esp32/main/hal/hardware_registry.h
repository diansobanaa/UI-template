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

typedef enum {
    HW_LIFECYCLE_REGISTERED,
    HW_LIFECYCLE_NOT_COMMISSIONED,
    HW_LIFECYCLE_COMMISSIONED,
    HW_LIFECYCLE_ENABLED,
    HW_LIFECYCLE_DISABLED,
    HW_LIFECYCLE_FAULTED,
    HW_LIFECYCLE_REMOVED
} hw_lifecycle_state_t;

typedef enum {
    HW_DEPLOYMENT_PENDING,
    HW_DEPLOYMENT_APPLIED,
    HW_DEPLOYMENT_FAILED,
    HW_DEPLOYMENT_UNKNOWN
} hw_deployment_status_t;

typedef enum {
    HW_INTERFACE_GPIO,
    HW_INTERFACE_I2C,
    HW_INTERFACE_UART,
    HW_INTERFACE_SPI,
    HW_INTERFACE_ONE_WIRE,
    HW_INTERFACE_ANALOG,
    HW_INTERFACE_VIRTUAL
} hw_interface_type_t;

typedef struct {
    char complex_id[32];
    char gh_id[32];
} hw_assignment_info_t;

typedef struct {
    hw_interface_type_t interface;
    int8_t gpio;      // -1 if not set
    int8_t channel;   // -1 if not set
    char address[16];
    char port[16];
    char polarity[16];
} hw_wiring_info_t;

typedef struct {
    char component_id[32];
    char supported_type_id[32];
    char name[48];
    hw_lifecycle_state_t lifecycle_state;
    hw_deployment_status_t deployment_status;
    hw_assignment_info_t assignment;
    hw_wiring_info_t wiring;
    char parameters_json[256];
    char role[32];
    char resource_id[32];
} hw_component_info_t;

// Compatibility aliases for legacy code to compile while refactoring
#define scope assignment.complex_id
#define type supported_type_id

typedef struct {
    uint32_t sequence;
    char device_timestamp[32];
    char component_id[32];
    float value;
    char unit[16];
    char quality[16];          // GOOD, UNCERTAIN, BAD
    char measurement_type[16]; // MEASURED, DERIVED, UNAVAILABLE, INVALID
} hw_telemetry_sample_t;

typedef struct {
    char complex_id[32];
    char gh_id[32];
    char timestamp[32];
    hw_telemetry_sample_t samples[32];
    uint8_t sample_count;
} hw_telemetry_snapshot_t;

typedef struct {
    char event_id[40];
    uint32_t sequence;
    char device_timestamp[32];
    char event_type[32];
    char severity[16]; // INFO, WARNING, FAULT, CRITICAL
    char complex_id[32];
    char gh_id[32];
    char component_id[32];
    char payload_json[128];
} hw_event_t;

typedef struct {
    char run_id[40];
    char recipe_id[32];
    char gh_id[32];
    char status[16]; // PENDING, MIXING, DOSING, DELIVERY, COMPLETED, CANCELLED, FAULTED
    float target_water_l;
    float actual_water_l;
    float target_dosing_a_ml;
    float actual_dosing_a_ml;
    float target_dosing_b_ml;
    float actual_dosing_b_ml;
    char start_timestamp[32];
    char end_timestamp[32];
    uint8_t progress_pct;
} hw_fertigation_run_t;

typedef struct {
    float rate_dosing_a_ml_sec;
    float rate_dosing_b_ml_sec;
    float flow_raw_pulses_per_l;
    float flow_fert_pulses_per_l;
} hw_calibration_rates_t;

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
 * @brief Find registered component descriptor by logical component_id.
 */
esp_err_t hardware_registry_find_by_id(const char *component_id, hw_component_info_t *out_info);

/**
 * @brief Resolve hardware GPIO pin for a given logical component_id.
 */
esp_err_t hardware_registry_resolve_gpio(const char *component_id, int8_t *out_gpio);

/**
 * @brief Resolve hardware channel for a given logical component_id.
 */
esp_err_t hardware_registry_resolve_channel(const char *component_id, int8_t *out_channel);

/**
 * @brief Check whether a component is in an operational lifecycle state (COMMISSIONED or ENABLED).
 */
bool hardware_registry_is_operational(const char *component_id);

/**
 * @brief Update lifecycle state of a registered component.
 */
esp_err_t hardware_registry_update_lifecycle(const char *component_id, hw_lifecycle_state_t new_state);

/**
 * @brief Clear active hardware registry.
 */
esp_err_t hardware_registry_clear(void);

/**
 * @brief Export baseline/default components JSON string.
 */
const char *hardware_registry_get_default_json(void);

#ifdef __cplusplus
}
#endif

