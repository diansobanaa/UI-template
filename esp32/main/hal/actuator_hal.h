#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    ACTUATOR_OWNER_NONE = 0,
    ACTUATOR_OWNER_MANUAL,
    ACTUATOR_OWNER_SCHEDULER,
    ACTUATOR_OWNER_FERTIGATION,
    ACTUATOR_OWNER_TRANSFER,
    ACTUATOR_OWNER_CALIBRATION,
    ACTUATOR_OWNER_SAFETY
} actuator_owner_t;

typedef enum {
    ACTUATOR_WELL_PUMP = 0,
    ACTUATOR_DIST_PUMP,
    ACTUATOR_RAW_SUBMERSIBLE,
    ACTUATOR_DOSING_A,
    ACTUATOR_DOSING_B,
    ACTUATOR_COOLING_FAN,
    ACTUATOR_BLOWER_FAN,
    ACTUATOR_MIXING_PUMP,
    ACTUATOR_ERROR_LAMP,
    ACTUATOR_MAX_COUNT
} actuator_id_t;

typedef struct {
    actuator_id_t id;
    const char *name;
    uint8_t gpio_num;
    bool is_on;
    bool is_interlocked;
    actuator_owner_t owner;
    uint32_t run_time_seconds;
    uint8_t active_level; // 0 for Active-LOW, 1 for Active-HIGH
} actuator_status_t;

/**
 * @brief Initialize all actuator GPIOs to safe OFF state.
 */
esp_err_t actuator_hal_init(void);

/**
 * @brief Turn an actuator ON or OFF with safety interlock checks.
 */
esp_err_t actuator_hal_set(actuator_id_t id, bool on);

/**
 * @brief Get current physical and logical state of an actuator.
 */
bool actuator_hal_get_state(actuator_id_t id);

/**
 * @brief Get complete status structure for an actuator.
 */
esp_err_t actuator_hal_get_status(actuator_id_t id, actuator_status_t *out_status);

/**
 * @brief Enforce hardware Emergency Stop: immediately turns all actuators OFF and latches.
 */
void actuator_hal_emergency_stop(void);

/**
 * @brief Acquire ownership of an actuator to prevent concurrent control.
 */
esp_err_t actuator_hal_acquire(actuator_id_t id, actuator_owner_t owner);

/**
 * @brief Release ownership of an actuator.
 */
esp_err_t actuator_hal_release(actuator_id_t id, actuator_owner_t owner);

/**
 * @brief Clear the emergency stop latch.
 */
void actuator_hal_resume(void);

/**
 * @brief Check if emergency stop is currently latched.
 */
bool actuator_hal_is_emergency_stopped(void);

#ifdef __cplusplus
}
#endif
