#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @file system_config.h
 * @brief System constants, firmware identity, and FreeRTOS task sizing.
 */

#define FIRMWARE_NAME               "AgroTech-ESP32-S3"
#define FIRMWARE_VERSION            "1.0.0"
#define HARDWARE_MODEL              "ESP32-S3-WROOM-1-N16R8"
#define CONTRACT_VERSION            "1.0.0"

#define FACTORY_DEVICE_ID_PREFIX    "controller-"
#define DEFAULT_HOSTNAME_PREFIX     "esp32-"
#define DEFAULT_HTTP_PORT           80
#ifndef AGROTECH_BACKEND_BASE_URL
#define AGROTECH_BACKEND_BASE_URL   ""
#endif

/* FreeRTOS Task Priorities & Stack Sizes */
#define TASK_HTTP_SERVER_STACK      8192
#define TASK_HTTP_SERVER_PRIO       5

#define TASK_COMMAND_MGR_STACK      4096
#define TASK_COMMAND_MGR_PRIO       6

#define TASK_TELEMETRY_STACK        8192
#define TASK_TELEMETRY_PRIO         4

#define TASK_CROPCYCLE_STACK        4096
#define TASK_CROPCYCLE_PRIO         3

#define TASK_SAFETY_MONITOR_STACK   6144
#define TASK_SAFETY_MONITOR_PRIO    7

/* FreeRTOS Queue Lengths */
#define COMMAND_QUEUE_LENGTH        16
#define EVENT_QUEUE_LENGTH          32

/* Safety Limits */
#define EMERGENCY_STOP_LATCH_MS     500

/* Hardware Feature Flags */
#ifndef FEATURE_SDCARD_ENABLED
#define FEATURE_SDCARD_ENABLED      1   /* 1 = Enabled with safe degraded fallback if absent */
#endif

#ifndef FEATURE_SENSORS_ENABLED
#define FEATURE_SENSORS_ENABLED     1   /* 1 = Real hardware runtime execution (pulse interrupts, 1-wire DS18B20, float switch, tamper) */
#endif

#ifdef __cplusplus
}
#endif
