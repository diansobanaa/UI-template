#pragma once

#include "esp_err.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the network manager.
 * 
 * Sets up Wi-Fi in AP+STA mode. Tries to connect to provisioned Wi-Fi 
 * credentials in NVS. If it fails or is unconfigured, it falls back to 
 * SoftAP mode for provisioning.
 * 
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t network_mgr_init(void);

/**
 * @brief Check if the device is currently connected to the network (STA mode).
 * 
 * @return true if connected to Wi-Fi and has an IP address.
 * @return false otherwise.
 */
bool network_mgr_is_connected(void);

#ifdef __cplusplus
}
#endif
