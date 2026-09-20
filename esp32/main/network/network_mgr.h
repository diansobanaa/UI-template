#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    NETWORK_STATE_UNPROVISIONED = 0,
    NETWORK_STATE_PROVISIONING,
    NETWORK_STATE_CONNECTING,
    NETWORK_STATE_CONNECTED,
    NETWORK_STATE_OFFLINE,
    NETWORK_STATE_NETWORK_CHANGE,
    NETWORK_STATE_DIRECT_LOCAL_AP,
    NETWORK_STATE_DIRECT_LOCAL_CONNECTED,
} network_state_t;

typedef enum {
    NETWORK_CANDIDATE_IDLE = 0,
    NETWORK_CANDIDATE_CONNECTING,
    NETWORK_CANDIDATE_SUCCESS,
    NETWORK_CANDIDATE_FAILED,
} network_candidate_state_t;

esp_err_t network_mgr_init(void);
bool network_mgr_is_connected(void);
const char *network_mgr_get_state_string(void);
esp_err_t network_mgr_get_ip(char *out, size_t out_len);
esp_err_t network_mgr_get_mac(char *out, size_t out_len);
const char *network_mgr_get_hostname(void);
esp_err_t network_mgr_get_sta_ssid(char *out, size_t out_len);
const char *network_mgr_get_provisioning_ssid(void);
const char *network_mgr_get_provisioning_pop(void);
bool network_mgr_is_provisioning(void);
void network_mgr_refresh_identity(void);

/** Enter non-destructive temporary Direct Local Mode. Never erases system or Complex state. */
esp_err_t network_mgr_enter_direct_local_mode(void);

/** Exit temporary Direct Local Mode. Refuses while a candidate Wi-Fi transaction is in progress. */
esp_err_t network_mgr_exit_direct_local_mode(void);

/** Compatibility alias for callers that still name the workflow Network Change Mode. */
esp_err_t network_mgr_enter_network_change_mode(void);

/** Submit a candidate STA credential pair. The old persisted credential remains intact until success. */
esp_err_t network_mgr_submit_candidate_credentials(const char *ssid, const char *pass);

/** Finish Network Change Mode and disable the temporary SoftAP after successful candidate commit. */
esp_err_t network_mgr_finish_network_change_mode(void);

bool network_mgr_is_network_change_mode(void);
bool network_mgr_is_direct_local_mode(void);
bool network_mgr_is_setup_active(void);
esp_err_t network_mgr_force_router_connect(void);
uint16_t network_mgr_get_ap_client_count(void);
uint32_t network_mgr_get_ap_timeout_remaining_sec(void);
network_candidate_state_t network_mgr_get_candidate_state(void);
const char *network_mgr_get_candidate_error(void);
const char *network_mgr_get_candidate_ssid(void);
const char *network_mgr_get_setup_ssid(void);
const char *network_mgr_get_setup_pop(void);

/** Legacy API retained only for callers that explicitly need factory-style credential reset. */
esp_err_t network_mgr_reset_credentials(void);

#ifdef __cplusplus
}
#endif
