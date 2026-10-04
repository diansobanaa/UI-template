#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @file system_config.h
 * @brief System constants, firmware identity, and FreeRTOS task sizing.
 */

#define FIRMWARE_NAME "AgroTech-ESP32-S3"
#define FIRMWARE_VERSION "1.0.0"
#define HARDWARE_MODEL "ESP32-S3-WROOM-1-N16R8"
#define CONTRACT_VERSION "1.0.0"

#define FACTORY_DEVICE_ID_PREFIX "controller-"
#define DEFAULT_HOSTNAME_PREFIX "esp32-"
#define DEFAULT_HTTP_PORT 80
#ifndef AGROTECH_BACKEND_BASE_URL
#define AGROTECH_BACKEND_BASE_URL ""
#endif

// STACK-FIX (2026-09-29): increased 8192 -> 10240. Field evidence: boot 4649
// panicked with LoadProhibited at _vfprintf_r inside httpd_thread
// (httpd_process_session -> http_send_enveloped_response -> cJSON_PrintUnformatted
// -> lwip_send). Actual call chain peak measured at 9,184 bytes, exceeding 8192 by
// 992 bytes. 10240 provides a 1KB safety margin.
#define TASK_HTTP_SERVER_STACK 10240
#define TASK_HTTP_SERVER_PRIO 5

// STACK-TUNING: measured peak used 2192 B. 4608 B provides 2416 B (>100%) safety margin while saving 3584 B internal DRAM.
#define TASK_COMMAND_MGR_STACK 4608
#define TASK_COMMAND_MGR_PRIO 6

// HEAP-FIX: Was 8192, reduced to 4096 caused stack overflow (telemetry_sampler
// calls sensor_hal_poll which does DHT22 + DS18B20 + flow meter +
// list_configured with s_descriptors[16] on stack). 6144 is the safe minimum.
#define TASK_TELEMETRY_STACK 6144
#define TASK_TELEMETRY_PRIO 4

#define TASK_CROPCYCLE_STACK 4096
#define TASK_CROPCYCLE_PRIO 3

// STACK-TUNING: measured peak used 2780 B. 4608 B provides 1828 B (~65%) safety margin while saving 1536 B internal DRAM.
#define TASK_SAFETY_MONITOR_STACK 4608
#define TASK_SAFETY_MONITOR_PRIO 7

/* FreeRTOS Queue Lengths */
#define COMMAND_QUEUE_LENGTH 16
#define EVENT_QUEUE_LENGTH 32

/* Safety Limits */
#define EMERGENCY_STOP_LATCH_MS   500

/* Sensor Poll Intervals */
#define DHT22_POLL_INTERVAL_MS    60000  /* 1 min — ambient changes slowly, reduces critical-section load */
#define DHT22_RETRY_INTERVAL_MS   3000   /* 3 s — immediate back-off retry on transient noise (CRC/response) */
#define DS18B20_POLL_INTERVAL_MS  20000  /* 20 s — water temperature */

/* Hardware Feature Flags */
#ifndef FEATURE_MICROSD_ENABLED
#define FEATURE_MICROSD_ENABLED  1  /* 1 = Enabled; degrades gracefully if MicroSD absent */
#endif
#ifndef FEATURE_SDCARD_ENABLED
#define FEATURE_SDCARD_ENABLED   FEATURE_MICROSD_ENABLED  /* Backward compatibility alias */
#endif

#ifndef FEATURE_SENSORS_ENABLED
#define FEATURE_SENSORS_ENABLED  1  /* 1 = Real HW (pulse ISR, 1-wire DS18B20, float, tamper) */
#endif

/* Tamper-loop supervision. Safe default is 1 (supervised): an open/cut loop
 * on GPIO 47 latches E-STOP and blocks actuators, by design.
 * Set to 0 ONLY for bench/commissioning when the physical anti-theft loop is
 * not wired yet: the tamper input is then treated as OK (with a loud boot
 * warning), so the E-STOP no longer trips on the unwired loop and actuators
 * are unblocked. Re-enable (1) and wire the loop for production. */
#ifndef FEATURE_TAMPER_LOOP_ENABLED
#define FEATURE_TAMPER_LOOP_ENABLED 0
#endif

#ifdef __cplusplus
}
#endif
