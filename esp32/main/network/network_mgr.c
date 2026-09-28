#include "network/network_mgr.h"
#include "config/system_config.h"
#include "storage/storage_mgr.h"
#include "http/http_server.h"
#include "services/event_mgr.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "nvs.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "mdns.h"
#include "wifi_provisioning/manager.h"
#include "wifi_provisioning/scheme_softap.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "NETWORK_MGR";
#define PROV_SSID_PREFIX "AGROTECH-"
#define SETUP_SSID_PREFIX "AGROTECH-SETUP-"
#define NETWORK_CHANGE_FINISH_DELAY_MS (15 * 1000)
#define DIRECT_LOCAL_NO_CLIENT_TIMEOUT_MS (3 * 60 * 1000)
#define DIRECT_LOCAL_DISCONNECT_TIMEOUT_MS (60 * 1000)
#define NETWORK_CANDIDATE_TIMEOUT_MS (15 * 1000)
#define NETWORK_CANDIDATE_RETRY_MS (2 * 1000)
#define RECONNECT_INTERVAL_MS (50 * 1000)
#define PROV_POP_LEN 8
#define PROV_POP_KEY "prov_pop"

static esp_netif_t *s_sta_netif = NULL;
static esp_netif_t *s_ap_netif = NULL;
static bool s_wifi_started = false;
static bool s_sta_provisioned = false;
static bool s_is_connected = false;
static bool s_provisioning_active = false;
static bool s_provisioning_initialized = false;
static bool s_reprovision_requested = false;
static bool s_network_change_active = false;
static bool s_direct_local_active = false;
static bool s_candidate_active = false;
static bool s_candidate_success = false;
static char s_candidate_ssid[33] = {0};
static char s_candidate_pass[65] = {0};
static char s_previous_ssid[33] = {0};
static char s_previous_pass[65] = {0};
static char s_candidate_error[96] = {0};
static network_candidate_state_t s_candidate_state = NETWORK_CANDIDATE_IDLE;
static int64_t s_candidate_deadline_us = 0;
static int64_t s_candidate_retry_us = 0;
static int64_t s_network_change_finish_deadline_us = 0;
static volatile uint16_t s_ap_client_count = 0;
static volatile int64_t s_ap_timeout_deadline_us = 0;
static network_state_t s_state = NETWORK_STATE_UNPROVISIONED;
static char s_prov_ssid[33] = {0};
static char s_setup_ssid[33] = {0};
static char s_prov_pop[17] = {0};
static char s_hostname[64] = {0};
static TaskHandle_t s_reconnect_task = NULL;

static esp_err_t start_provisioning_service(void);
static void start_factory_web_setup(void);
static void apply_sta_config(const char *ssid, const char *pass);
static esp_err_t persist_wifi_credentials_atomic(const char *ssid, const char *pass);

static void update_mdns_txt(void)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    if (!st || !s_hostname[0]) return;
    const char *complex_id = st->complex_id[0] ? st->complex_id : "UNBOUND";
    (void)mdns_service_txt_item_set("_http", "_tcp", "deviceId", st->device_id);
    (void)mdns_service_txt_item_set("_http", "_tcp", "complexId", complex_id);
}

void network_mgr_refresh_identity(void)
{
    update_mdns_txt();
}

static bool is_pop_valid(const char *pop)
{
    if (!pop || strlen(pop) != PROV_POP_LEN) return false;
    for (size_t i = 0; i < PROV_POP_LEN; i++) {
        char c = pop[i];
        bool ok = (c >= 'A' && c <= 'Z') || (c >= '2' && c <= '9');
        if (!ok) return false;
    }
    return true;
}

static esp_err_t load_or_generate_provisioning_pop(void)
{
    static const char alphabet[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    nvs_handle_t h;
    esp_err_t err = nvs_open("agrotech", NVS_READWRITE, &h);
    if (err != ESP_OK) return err;

    size_t len = sizeof(s_prov_pop);
    err = nvs_get_str(h, PROV_POP_KEY, s_prov_pop, &len);
    if (err == ESP_OK && is_pop_valid(s_prov_pop)) {
        nvs_close(h);
        return ESP_OK;
    }

    for (size_t i = 0; i < PROV_POP_LEN; i++) {
        s_prov_pop[i] = alphabet[esp_random() % (sizeof(alphabet) - 1)];
    }
    s_prov_pop[PROV_POP_LEN] = '\0';
    err = nvs_set_str(h, PROV_POP_KEY, s_prov_pop);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

static esp_err_t generate_provisioning_identity(void)
{
    uint8_t mac[6] = {0};
    if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) return ESP_FAIL;
    snprintf(s_prov_ssid, sizeof(s_prov_ssid), "%s%02X%02X%02X%02X%02X%02X", PROV_SSID_PREFIX,
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    snprintf(s_setup_ssid, sizeof(s_setup_ssid), "%s%02X%02X", SETUP_SSID_PREFIX, mac[4], mac[5]);
    return load_or_generate_provisioning_pop();
}

static esp_err_t init_mdns(void)
{
    const system_storage_state_t *st = storage_mgr_get_state();
    if (!st || !st->hostname[0]) return ESP_ERR_INVALID_STATE;
    strncpy(s_hostname, st->hostname, sizeof(s_hostname) - 1);
    s_hostname[sizeof(s_hostname) - 1] = '\0';

    esp_err_t err = mdns_init();
    if (err == ESP_ERR_INVALID_STATE) return ESP_OK;
    if (err != ESP_OK) return err;
    if ((err = mdns_hostname_set(s_hostname)) != ESP_OK) return err;
    (void)mdns_instance_name_set("AgroTech Controller");
    mdns_txt_item_t txt[] = {
        {"deviceId", st->device_id},
        {"complexId", st->complex_id[0] ? st->complex_id : "UNBOUND"},
        {"apiVersion", "v1"},
        {"schemaVersion", "1"},
    };
    (void)mdns_service_add(NULL, "_http", "_tcp", DEFAULT_HTTP_PORT, txt, sizeof(txt) / sizeof(txt[0]));
    return ESP_OK;
}

static void set_ap_config_with_ssid(const char *ssid)
{
    wifi_config_t cfg = {0};
    strncpy((char *)cfg.ap.ssid, ssid, sizeof(cfg.ap.ssid) - 1);
    cfg.ap.ssid_len = strlen(ssid);
    strncpy((char *)cfg.ap.password, s_prov_pop, sizeof(cfg.ap.password) - 1);
    cfg.ap.channel = 1;
    cfg.ap.max_connection = 4;
    cfg.ap.authmode = WIFI_AUTH_WPA2_PSK;
    // P0-FIX: Don't ESP_ERROR_CHECK — if WiFi state is inconsistent after partial init,
    // this would panic. Log and continue.
    esp_err_t cfg_err = esp_wifi_set_config(WIFI_IF_AP, &cfg);
    if (cfg_err != ESP_OK) ESP_LOGW(TAG, "esp_wifi_set_config AP failed (0x%x)", cfg_err);
}

static void set_ap_config(void)
{
    set_ap_config_with_ssid(s_prov_ssid);
}

static void set_network_change_ap_config(void)
{
    set_ap_config_with_ssid(s_setup_ssid);
}

static bool load_sta_credentials(char *ssid, size_t ssid_len, char *pass, size_t pass_len)
{
    if (!ssid || !pass || ssid_len < 2 || pass_len < 1) return false;
    ssid[0] = '\0'; pass[0] = '\0';
    nvs_handle_t h;
    if (nvs_open("agrotech", NVS_READONLY, &h) == ESP_OK) {
        size_t a = ssid_len, b = pass_len;
        esp_err_t e1 = nvs_get_str(h, "sta_ssid", ssid, &a);
        (void)nvs_get_str(h, "sta_pass", pass, &b);
        nvs_close(h);
        if (e1 == ESP_OK && ssid[0]) return true;
    }
    wifi_config_t cfg = {0};
    if (esp_wifi_get_config(WIFI_IF_STA, &cfg) == ESP_OK && cfg.sta.ssid[0]) {
        strncpy(ssid, (const char *)cfg.sta.ssid, ssid_len - 1);
        strncpy(pass, (const char *)cfg.sta.password, pass_len - 1);
        ssid[ssid_len - 1] = '\0'; pass[pass_len - 1] = '\0';
        return true;
    }
    return false;
}

static esp_err_t mirror_wifi_credentials(const char *ssid, const char *pass)
{
    return persist_wifi_credentials_atomic(ssid, pass);
}

static void set_candidate_error(const char *message)
{
    strncpy(s_candidate_error, message ? message : "Network change failed.", sizeof(s_candidate_error) - 1);
    s_candidate_error[sizeof(s_candidate_error) - 1] = '\0';
}

static esp_err_t persist_wifi_credentials_atomic(const char *ssid, const char *pass)
{
    if (!ssid || !ssid[0] || strlen(ssid) >= sizeof(s_candidate_ssid) || (pass && strlen(pass) >= sizeof(s_candidate_pass))) {
        return ESP_ERR_INVALID_ARG;
    }
    nvs_handle_t h;
    esp_err_t err = nvs_open("agrotech", NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_set_str(h, "sta_ssid", ssid);
    if (err == ESP_OK) err = nvs_set_str(h, "sta_pass", pass ? pass : "");
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

static esp_err_t restore_previous_sta(void)
{
    if (!s_previous_ssid[0]) return ESP_ERR_NOT_FOUND;
    apply_sta_config(s_previous_ssid, s_previous_pass);
    (void)esp_wifi_disconnect();
    return esp_wifi_connect();
}

static void apply_sta_config(const char *ssid, const char *pass)
{
    wifi_config_t cfg = {0};
    strncpy((char *)cfg.sta.ssid, ssid, sizeof(cfg.sta.ssid) - 1);
    strncpy((char *)cfg.sta.password, pass ? pass : "", sizeof(cfg.sta.password) - 1);
    cfg.sta.threshold.authmode = (pass && pass[0]) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    // P0-FIX: Don't ESP_ERROR_CHECK — graceful failure.
    esp_err_t sta_err = esp_wifi_set_config(WIFI_IF_STA, &cfg);
    if (sta_err != ESP_OK) ESP_LOGW(TAG, "esp_wifi_set_config STA failed (0x%x)", sta_err);
}

static void arm_ap_timeout_ms(uint32_t timeout_ms)
{
    s_ap_timeout_deadline_us = esp_timer_get_time() + ((int64_t)timeout_ms * 1000LL);
}

static void clear_ap_timeout(void)
{
    s_ap_timeout_deadline_us = 0;
}

static void reset_ap_client_tracking(void)
{
    s_ap_client_count = 0;
    clear_ap_timeout();
}

static esp_err_t enable_direct_local_ap(void)
{
    set_network_change_ap_config();
    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_APSTA);
    if (err != ESP_OK) return err;
    reset_ap_client_tracking();
    arm_ap_timeout_ms(DIRECT_LOCAL_NO_CLIENT_TIMEOUT_MS);
    return ESP_OK;
}

static esp_err_t disable_direct_local_ap(void)
{
    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_STA);
    if (err != ESP_OK) return err;
    reset_ap_client_tracking();
    return ESP_OK;
}

static void provisioning_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;
    if (event_base != WIFI_PROV_EVENT) return;
    switch (event_id) {
        case WIFI_PROV_START:
            s_provisioning_active = true;
            s_state = NETWORK_STATE_PROVISIONING;
            ESP_LOGI(TAG, "Provisioning started: SSID=%s PoP=%s", s_prov_ssid, s_prov_pop);
            (void)event_mgr_log(LOG_LEVEL_INFO, "COMMUNICATION", "WIFI_PROVISIONING_STARTED", "Local SoftAP Wi-Fi provisioning started.", NULL);
            break;
        case WIFI_PROV_CRED_RECV: {
            wifi_sta_config_t *cfg = (wifi_sta_config_t *)event_data;
            if (cfg) ESP_LOGI(TAG, "Provisioning credentials received for SSID '%s'.", (const char *)cfg->ssid);
            break;
        }
        case WIFI_PROV_CRED_FAIL:
            (void)event_mgr_log(LOG_LEVEL_WARNING, "COMMUNICATION", "WIFI_PROVISIONING_FAILED", "Wi-Fi credentials were rejected; local runtime remains independent.", NULL);
            break;
        case WIFI_PROV_CRED_SUCCESS: {
            wifi_config_t cfg = {0};
            if (esp_wifi_get_config(WIFI_IF_STA, &cfg) == ESP_OK && cfg.sta.ssid[0]) {
                char ssid[33] = {0}, pass[65] = {0};
                strncpy(ssid, (const char *)cfg.sta.ssid, sizeof(ssid) - 1);
                strncpy(pass, (const char *)cfg.sta.password, sizeof(pass) - 1);
                if (!s_network_change_active) {
                    esp_err_t err = mirror_wifi_credentials(ssid, pass);
                    if (err != ESP_OK) ESP_LOGW(TAG, "Could not mirror Wi-Fi credentials: 0x%x", err);
                }
            }
            s_sta_provisioned = true;
            s_is_connected = false;
            s_state = NETWORK_STATE_CONNECTING;
            break;
        }
        case WIFI_PROV_END:
            s_provisioning_active = false;
            (void)wifi_prov_mgr_deinit();
            s_provisioning_initialized = false;
            if (s_reprovision_requested) {
                s_reprovision_requested = false;
                s_sta_provisioned = false;
                s_state = NETWORK_STATE_UNPROVISIONED;
                if (s_reconnect_task) xTaskNotifyGive(s_reconnect_task);
                return;
            }
            if (s_sta_provisioned) {
                (void)esp_wifi_set_mode(WIFI_MODE_STA);
                s_state = s_is_connected ? NETWORK_STATE_CONNECTED : NETWORK_STATE_CONNECTING;
                (void)esp_wifi_connect();
            } else {
                s_state = NETWORK_STATE_UNPROVISIONED;
            }
            break;
        default:
            break;
    }
}

static esp_err_t start_provisioning_service(void)
{
    /* Legacy wifi_prov_mgr path retained for ABI compatibility.
     * Factory first-boot now uses start_factory_web_setup() instead. */
    if (s_provisioning_active || s_provisioning_initialized) return ESP_OK;
    wifi_prov_mgr_config_t config = {
        .scheme = wifi_prov_scheme_softap,
        .scheme_event_handler = WIFI_PROV_EVENT_HANDLER_NONE,
    };
    esp_err_t err = wifi_prov_mgr_init(config);
    if (err != ESP_OK) return err;
    s_provisioning_initialized = true;
    wifi_prov_scheme_softap_set_httpd_handle((void *)http_server_get_handle());
    err = wifi_prov_mgr_start_provisioning(WIFI_PROV_SECURITY_1, s_prov_pop, s_prov_ssid, s_prov_pop);
    if (err != ESP_OK) {
        (void)wifi_prov_mgr_deinit();
        s_provisioning_initialized = false;
        return err;
    }
    s_provisioning_active = true;
    s_state = NETWORK_STATE_PROVISIONING;
    return ESP_OK;
}

/**
 * @brief Start factory web-UI-only provisioning.
 *
 * Sets the provisioning flags so that the embedded /setup HTTP handlers
 * become active.  SoftAP and HTTP server must already be running.
 * wifi_prov_mgr is NOT used — credentials are accepted exclusively
 * through the /setup/api/connect endpoint.
 */
static void start_factory_web_setup(void)
{
    s_provisioning_active = true;
    s_state = NETWORK_STATE_PROVISIONING;
    ESP_LOGI(TAG, "Factory web setup active: SSID=%s code=%s", s_prov_ssid, s_prov_pop);
    (void)event_mgr_log(LOG_LEVEL_INFO, "COMMUNICATION", "WIFI_PROVISIONING_STARTED",
                        "Factory SoftAP Wi-Fi setup started (web UI only, no wifi_prov_mgr).", NULL);
}

static void reconnect_task(void *arg)
{
    (void)arg;
    while (true) {
        const int64_t now_us = esp_timer_get_time();

        if (s_direct_local_active && !s_network_change_active && !s_candidate_active && s_ap_client_count == 0 && s_ap_timeout_deadline_us > 0 && now_us >= s_ap_timeout_deadline_us) {
            ESP_LOGI(TAG, "Direct Local Mode AP timeout elapsed; disabling temporary SoftAP without reset.");
            (void)network_mgr_exit_direct_local_mode();
        } else if (s_candidate_active && !s_candidate_success) {
            if (now_us >= s_candidate_deadline_us) {
                s_candidate_active = false;
                s_candidate_state = NETWORK_CANDIDATE_FAILED;
                set_candidate_error("Wi-Fi baru tidak merespons sebelum batas waktu.");
                if (s_previous_ssid[0]) {
                    (void)restore_previous_sta();
                } else {
                    s_sta_provisioned = false;
                    (void)esp_wifi_disconnect();
                    apply_sta_config("", "");
                    s_state = s_provisioning_active ? NETWORK_STATE_PROVISIONING : NETWORK_STATE_UNPROVISIONED;
                }
            } else if (now_us >= s_candidate_retry_us) {
                s_candidate_retry_us = now_us + ((int64_t)NETWORK_CANDIDATE_RETRY_MS * 1000LL);
                (void)esp_wifi_connect();
            }
        } else if (s_network_change_active && s_candidate_success && s_network_change_finish_deadline_us > 0 && now_us >= s_network_change_finish_deadline_us) {
            (void)network_mgr_finish_network_change_mode();
        } else if (!s_network_change_active && s_sta_provisioned && !s_is_connected && !s_provisioning_active && s_wifi_started) {
            s_state = NETWORK_STATE_CONNECTING;
            (void)esp_wifi_connect();
        }

        if (!s_network_change_active && !s_sta_provisioned && !s_provisioning_active) {
            set_ap_config();
            (void)esp_wifi_set_mode(WIFI_MODE_APSTA);
            start_factory_web_setup();
        }
        TickType_t wait_ticks = (s_candidate_active || s_network_change_active || s_direct_local_active) ? pdMS_TO_TICKS(500) : pdMS_TO_TICKS(RECONNECT_INTERVAL_MS);
        (void)ulTaskNotifyTake(pdTRUE, wait_ticks);
    }
}

static void event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_AP_STACONNECTED) {
        (void)event_data;
        if (s_ap_client_count < 0xFFFF) s_ap_client_count++;
        clear_ap_timeout();
        if (s_network_change_active) s_state = NETWORK_STATE_NETWORK_CHANGE;
        else if (s_direct_local_active) s_state = NETWORK_STATE_DIRECT_LOCAL_CONNECTED;
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_AP_STADISCONNECTED) {
        (void)event_data;
        if (s_ap_client_count > 0) s_ap_client_count--;
        if (s_ap_client_count == 0 && (s_direct_local_active || s_network_change_active)) {
            if (!s_candidate_active) arm_ap_timeout_ms(DIRECT_LOCAL_DISCONNECT_TIMEOUT_MS);
            if (s_network_change_active) s_state = NETWORK_STATE_NETWORK_CHANGE;
            else s_state = NETWORK_STATE_DIRECT_LOCAL_AP;
        }
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        if (s_sta_provisioned) {
            s_state = NETWORK_STATE_CONNECTING;
            (void)esp_wifi_connect();
        }
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        bool was_connected = s_is_connected;
        s_is_connected = false;
        if (s_network_change_active) {
            s_state = NETWORK_STATE_NETWORK_CHANGE;
            if (s_candidate_active && !s_candidate_success && esp_timer_get_time() < s_candidate_deadline_us) {
                s_candidate_retry_us = esp_timer_get_time();
            }
        } else if (s_candidate_active && !s_candidate_success) {
            s_state = s_provisioning_active ? NETWORK_STATE_PROVISIONING : NETWORK_STATE_CONNECTING;
            s_candidate_retry_us = esp_timer_get_time();
        } else {
            s_state = s_provisioning_active ? NETWORK_STATE_PROVISIONING : (s_sta_provisioned ? NETWORK_STATE_OFFLINE : NETWORK_STATE_UNPROVISIONED);
        }
        static int64_t s_last_lost_log_us = 0;
        int64_t now_lost_us = esp_timer_get_time();
        if (was_connected && !s_network_change_active && (now_lost_us - s_last_lost_log_us > 10000000LL)) {
            s_last_lost_log_us = now_lost_us;
            (void)event_mgr_log(LOG_LEVEL_WARNING, "COMMUNICATION", "COMMUNICATION_LOST", "Wi-Fi communication lost; local authority continues independently.", NULL);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        bool was_connected = s_is_connected;
        s_is_connected = true;
        s_state = s_network_change_active ? NETWORK_STATE_NETWORK_CHANGE : NETWORK_STATE_CONNECTED;
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Got STA IP: " IPSTR, IP2STR(&event->ip_info.ip));
        if (s_candidate_active && !s_candidate_success) {
            esp_err_t persist_err = persist_wifi_credentials_atomic(s_candidate_ssid, s_candidate_pass);
            if (persist_err == ESP_OK) {
                s_candidate_success = true;
                s_candidate_active = false;
                s_candidate_state = NETWORK_CANDIDATE_SUCCESS;
                s_candidate_error[0] = '\0';
                s_sta_provisioned = true;
                s_state = s_network_change_active ? NETWORK_STATE_NETWORK_CHANGE : NETWORK_STATE_CONNECTING;
                (void)event_mgr_log(LOG_LEVEL_INFO, "COMMUNICATION", s_network_change_active ? "WIFI_NETWORK_CHANGED" : "WIFI_PROVISIONED_WEB", "New Wi-Fi credentials verified and atomically persisted without reboot.", NULL);
                if (s_network_change_active) {
                    s_network_change_finish_deadline_us = esp_timer_get_time() + ((int64_t)NETWORK_CHANGE_FINISH_DELAY_MS * 1000LL);
                } else if (s_provisioning_active) {
                    /* Factory web UI provisioning succeeded; disable SoftAP
                     * and switch to STA-only mode without reboot. */
                    s_provisioning_active = false;
                    (void)esp_wifi_set_mode(WIFI_MODE_STA);
                    s_state = NETWORK_STATE_CONNECTING;
                    (void)esp_wifi_connect();
                }
            } else {
                s_candidate_active = false;
                s_candidate_success = false;
                s_candidate_state = NETWORK_CANDIDATE_FAILED;
                set_candidate_error("Koneksi Wi-Fi berhasil, tetapi credential baru gagal disimpan.");
                if (s_previous_ssid[0]) {
                    (void)restore_previous_sta();
                } else {
                    s_sta_provisioned = false;
                    (void)esp_wifi_disconnect();
                    apply_sta_config("", "");
                    s_state = s_provisioning_active ? NETWORK_STATE_PROVISIONING : NETWORK_STATE_UNPROVISIONED;
                }
            }
        }
        static int64_t s_last_restored_log_us = 0;
        int64_t now_restored_us = esp_timer_get_time();
        if (!was_connected && !s_network_change_active && (now_restored_us - s_last_restored_log_us > 10000000LL)) {
            s_last_restored_log_us = now_restored_us;
            (void)event_mgr_log(LOG_LEVEL_INFO, "COMMUNICATION", "COMMUNICATION_RESTORED", "Wi-Fi communication restored.", NULL);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_LOST_IP) {
        s_is_connected = false;
        s_state = s_network_change_active ? NETWORK_STATE_NETWORK_CHANGE : (s_sta_provisioned ? NETWORK_STATE_OFFLINE : NETWORK_STATE_UNPROVISIONED);
    }
}

esp_err_t network_mgr_init(void)
{
    if (s_wifi_started) return ESP_OK;
    // WDT-FIX: Don't require HTTP server for WiFi init — WiFi should init
    // early (before HTTP) so that SoftAP provisioning can work even if
    // HTTP server fails to start later.
    // if (!http_server_is_running()) return ESP_ERR_INVALID_STATE;

    // WDT-FIX: Guard against duplicate netif creation on retry.
    // If network_mgr_init was called before and failed partway, s_sta_netif
    // and s_ap_netif may already exist. Don't create duplicates.
    if (!s_sta_netif) {
        s_sta_netif = esp_netif_create_default_wifi_sta();
    }
    if (!s_ap_netif) {
        s_ap_netif = esp_netif_create_default_wifi_ap();
    }
    if (!s_sta_netif || !s_ap_netif) return ESP_ERR_NO_MEM;

    esp_err_t err = generate_provisioning_identity();
    if (err != ESP_OK) return err;
    const system_storage_state_t *st = storage_mgr_get_state();
    if (st && st->hostname[0]) (void)esp_netif_set_hostname(s_sta_netif, st->hostname);

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    cfg.static_rx_buf_num = 2;
    cfg.dynamic_rx_buf_num = 8;
    // HEAP-FIX: Reduce WiFi internal RAM footprint further.
    // ESP-IDF default: static_rx_buf_num=16, dynamic_rx_buf_num=32.
    // We set 2/8 to save ~20KB internal RAM. RX buffers MUST be internal
    // (hardware DMA requirement) — cannot use PSRAM.
    cfg.tx_buf_type = 1;  // Use dynamic TX buffers (saves internal RAM)
    cfg.dynamic_tx_buf_num = 8;
    cfg.cache_tx_buf_num = 4;
    err = esp_wifi_init(&cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_wifi_init failed (0x%x) — WiFi unavailable. System continues in offline mode.", err);
        return err;
    }
    // HEAP-FIX: Don't ESP_ERROR_CHECK these — if registration fails, WiFi
    // events won't fire but system should not abort. Log and continue.
    esp_err_t ev1 = esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL);
    esp_err_t ev2 = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL);
    esp_err_t ev3 = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_LOST_IP, &event_handler, NULL);
    esp_err_t ev4 = esp_event_handler_register(WIFI_PROV_EVENT, ESP_EVENT_ANY_ID, &provisioning_event_handler, NULL);
    if (ev1 != ESP_OK || ev2 != ESP_OK || ev3 != ESP_OK || ev4 != ESP_OK) {
        ESP_LOGW(TAG, "Some WiFi event handlers failed to register (0x%x,0x%x,0x%x,0x%x) — continuing.", ev1, ev2, ev3, ev4);
    }

    err = init_mdns();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "mDNS init failed (0x%x) — continuing without mDNS.", err);
    }

    char ssid[33] = {0}, pass[65] = {0};
    s_sta_provisioned = load_sta_credentials(ssid, sizeof(ssid), pass, sizeof(pass));
    if (s_sta_provisioned) {
        apply_sta_config(ssid, pass);
        err = esp_wifi_set_mode(WIFI_MODE_STA);
        if (err != ESP_OK) ESP_LOGW(TAG, "esp_wifi_set_mode STA failed (0x%x)", err);
        s_state = NETWORK_STATE_CONNECTING;
    } else {
        set_ap_config();
        err = esp_wifi_set_mode(WIFI_MODE_APSTA);
        if (err != ESP_OK) ESP_LOGW(TAG, "esp_wifi_set_mode APSTA failed (0x%x)", err);
        s_state = NETWORK_STATE_UNPROVISIONED;
    }

    err = esp_wifi_start();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_wifi_start failed (0x%x) — WiFi unavailable. System continues in offline mode.", err);
        return err;
    }
    (void)esp_wifi_set_ps(WIFI_PS_NONE);

    if (!s_sta_provisioned) {
        start_factory_web_setup();
    } else {
        ESP_LOGI(TAG, "Provisioned STA ready: SSID=%s hostname=%s.local", ssid, s_hostname);
    }

    ESP_LOGI(TAG, "Free internal heap before reconnect_task: %u bytes (largest block: %u)",
             (unsigned int)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
             (unsigned int)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));

    if (xTaskCreate(reconnect_task, "net_reconnect", 4096, NULL, 4, &s_reconnect_task) != pdPASS) {
        ESP_LOGE(TAG, "Failed to create reconnect_task — deinitializing WiFi.");
        esp_wifi_stop();
        esp_wifi_deinit();
        return ESP_ERR_NO_MEM;
    }

    s_wifi_started = true;
    return ESP_OK;
}

bool network_mgr_is_connected(void) { return s_is_connected; }

const char *network_mgr_get_state_string(void)
{
    switch (s_state) {
        case NETWORK_STATE_UNPROVISIONED: return "UNPROVISIONED";
        case NETWORK_STATE_PROVISIONING: return "PROVISIONING_AP";
        case NETWORK_STATE_CONNECTING: return "STA_CONNECTING";
        case NETWORK_STATE_CONNECTED: return "STA_CONNECTED";
        case NETWORK_STATE_OFFLINE: return "OFFLINE";
        case NETWORK_STATE_NETWORK_CHANGE: return "NETWORK_CHANGE";
        case NETWORK_STATE_DIRECT_LOCAL_AP: return "DIRECT_LOCAL_AP";
        case NETWORK_STATE_DIRECT_LOCAL_CONNECTED: return "DIRECT_LOCAL_CONNECTED";
        default: return "UNKNOWN";
    }
}

esp_err_t network_mgr_get_ip(char *out, size_t out_len)
{
    if (!out || out_len < 16) return ESP_ERR_INVALID_ARG;
    strncpy(out, "0.0.0.0", out_len - 1); out[out_len - 1] = '\0';
    if (!s_sta_netif || !s_is_connected) return ESP_ERR_INVALID_STATE;
    esp_netif_ip_info_t info;
    esp_err_t err = esp_netif_get_ip_info(s_sta_netif, &info);
    if (err != ESP_OK) return err;
    snprintf(out, out_len, IPSTR, IP2STR(&info.ip));
    return ESP_OK;
}

esp_err_t network_mgr_get_mac(char *out, size_t out_len)
{
    if (!out || out_len < 18) return ESP_ERR_INVALID_ARG;
    uint8_t mac[6] = {0};
    esp_err_t err = esp_read_mac(mac, ESP_MAC_WIFI_STA);
    if (err != ESP_OK) return err;
    snprintf(out, out_len, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return ESP_OK;
}

const char *network_mgr_get_hostname(void) { return s_hostname; }

esp_err_t network_mgr_get_sta_ssid(char *out, size_t out_len)
{
    if (!out || out_len < 2) return ESP_ERR_INVALID_ARG;
    /* Read from WiFi driver config (internal RAM) — safe from any task stack,
     * including PSRAM-stack tasks. Calling nvs_get_str from a PSRAM-stack task
     * triggers spi_flash cache assertion panic (cache_utils.c:127). */
    if (s_wifi_started) {
        wifi_config_t cfg = {0};
        if (esp_wifi_get_config(WIFI_IF_STA, &cfg) == ESP_OK && cfg.sta.ssid[0]) {
            strncpy(out, (const char *)cfg.sta.ssid, out_len - 1);
            out[out_len - 1] = '\0';
            return ESP_OK;
        }
    }
    /* Fallback: NVS (only safe from normal internal-stack tasks at init time) */
    char pass[65];
    return load_sta_credentials(out, out_len, pass, sizeof(pass)) ? ESP_OK : ESP_ERR_NOT_FOUND;
}

const char *network_mgr_get_provisioning_ssid(void) { return s_prov_ssid; }
const char *network_mgr_get_provisioning_pop(void) { return s_prov_pop; }
bool network_mgr_is_provisioning(void) { return s_provisioning_active; }


esp_err_t network_mgr_enter_direct_local_mode(void)
{
    if (!s_wifi_started) return ESP_ERR_INVALID_STATE;
    if (!s_sta_provisioned) return start_provisioning_service();
    if (s_network_change_active || s_direct_local_active) return ESP_OK;

    s_direct_local_active = true;
    s_candidate_state = NETWORK_CANDIDATE_IDLE;
    s_candidate_active = false;
    s_candidate_success = false;
    s_candidate_error[0] = '\0';
    s_candidate_ssid[0] = '\0';
    s_candidate_pass[0] = '\0';
    s_network_change_finish_deadline_us = 0;
    s_previous_ssid[0] = '\0';
    s_previous_pass[0] = '\0';

    esp_err_t err = enable_direct_local_ap();
    if (err != ESP_OK) {
        s_direct_local_active = false;
        reset_ap_client_tracking();
        return err;
    }
    s_state = NETWORK_STATE_DIRECT_LOCAL_AP;
    (void)event_mgr_log(LOG_LEVEL_INFO, "COMMUNICATION", "DIRECT_LOCAL_MODE_ENTERED", "Temporary local SoftAP enabled without reset or runtime interruption.", NULL);
    if (s_reconnect_task) xTaskNotifyGive(s_reconnect_task);
    return ESP_OK;
}

esp_err_t network_mgr_exit_direct_local_mode(void)
{
    if (!s_direct_local_active && !s_network_change_active) return ESP_OK;
    if (s_candidate_active && !s_candidate_success) return ESP_ERR_INVALID_STATE;

    esp_err_t err = disable_direct_local_ap();
    if (err != ESP_OK) return err;

    s_direct_local_active = false;
    s_network_change_active = false;
    s_candidate_active = false;
    s_network_change_finish_deadline_us = 0;
    s_state = s_is_connected ? NETWORK_STATE_CONNECTED : (s_sta_provisioned ? NETWORK_STATE_OFFLINE : NETWORK_STATE_UNPROVISIONED);
    (void)event_mgr_log(LOG_LEVEL_INFO, "COMMUNICATION", "DIRECT_LOCAL_MODE_EXITED", "Temporary local SoftAP disabled; network runtime resumes without restart.", NULL);
    if (s_reconnect_task) xTaskNotifyGive(s_reconnect_task);
    return ESP_OK;
}

esp_err_t network_mgr_enter_network_change_mode(void)
{
    return network_mgr_enter_direct_local_mode();
}

esp_err_t network_mgr_submit_candidate_credentials(const char *ssid, const char *pass)
{
    if (s_sta_provisioned && !s_direct_local_active) return ESP_ERR_INVALID_STATE;
    if (!s_sta_provisioned && !s_provisioning_active) return ESP_ERR_INVALID_STATE;
    if (s_network_change_active) return ESP_ERR_INVALID_STATE;
    if (!ssid || !ssid[0] || strlen(ssid) >= sizeof(s_candidate_ssid) || (pass && strlen(pass) >= sizeof(s_candidate_pass))) return ESP_ERR_INVALID_ARG;

    if (s_sta_provisioned && !s_previous_ssid[0]) {
        char old_ssid[33] = {0};
        char old_pass[65] = {0};
        if (!load_sta_credentials(old_ssid, sizeof(old_ssid), old_pass, sizeof(old_pass))) return ESP_ERR_NOT_FOUND;
        strncpy(s_previous_ssid, old_ssid, sizeof(s_previous_ssid) - 1);
        strncpy(s_previous_pass, old_pass, sizeof(s_previous_pass) - 1);
        s_previous_ssid[sizeof(s_previous_ssid) - 1] = '\0';
        s_previous_pass[sizeof(s_previous_pass) - 1] = '\0';
    }
    s_network_change_active = true;
    clear_ap_timeout();
    strncpy(s_candidate_ssid, ssid, sizeof(s_candidate_ssid) - 1);
    strncpy(s_candidate_pass, pass ? pass : "", sizeof(s_candidate_pass) - 1);
    s_candidate_ssid[sizeof(s_candidate_ssid) - 1] = '\0';
    s_candidate_pass[sizeof(s_candidate_pass) - 1] = '\0';
    s_candidate_active = true;
    s_candidate_success = false;
    s_candidate_state = NETWORK_CANDIDATE_CONNECTING;
    s_candidate_error[0] = '\0';
    s_candidate_deadline_us = esp_timer_get_time() + ((int64_t)NETWORK_CANDIDATE_TIMEOUT_MS * 1000LL);
    s_candidate_retry_us = esp_timer_get_time();
    s_state = s_network_change_active ? NETWORK_STATE_NETWORK_CHANGE : NETWORK_STATE_CONNECTING;

    apply_sta_config(s_candidate_ssid, s_candidate_pass);
    (void)esp_wifi_disconnect();
    if (s_reconnect_task) xTaskNotifyGive(s_reconnect_task);
    return ESP_OK;
}

esp_err_t network_mgr_finish_network_change_mode(void)
{
    return network_mgr_exit_direct_local_mode();
}

bool network_mgr_is_network_change_mode(void) { return s_network_change_active; }
bool network_mgr_is_direct_local_mode(void) { return s_direct_local_active; }
bool network_mgr_is_setup_active(void) { return s_provisioning_active || s_direct_local_active; }
network_candidate_state_t network_mgr_get_candidate_state(void) { return s_candidate_state; }
const char *network_mgr_get_candidate_error(void) { return s_candidate_error; }
const char *network_mgr_get_candidate_ssid(void) { return s_candidate_ssid; }
const char *network_mgr_get_setup_ssid(void) { return (s_provisioning_active && !s_direct_local_active) ? s_prov_ssid : s_setup_ssid; }
const char *network_mgr_get_setup_pop(void) { return s_prov_pop; }
uint16_t network_mgr_get_ap_client_count(void) { return s_ap_client_count; }

uint32_t network_mgr_get_ap_timeout_remaining_sec(void)
{
    if (!s_direct_local_active || s_ap_timeout_deadline_us <= 0 || s_ap_client_count > 0) return 0;
    int64_t remaining = s_ap_timeout_deadline_us - esp_timer_get_time();
    if (remaining <= 0) return 0;
    return (uint32_t)((remaining + 999999LL) / 1000000LL);
}

esp_err_t network_mgr_force_router_connect(void)
{
    if (!s_wifi_started || !s_sta_provisioned) return ESP_ERR_INVALID_STATE;
    if (s_candidate_active && !s_candidate_success) return ESP_ERR_INVALID_STATE;
    s_state = NETWORK_STATE_CONNECTING;
    (void)esp_wifi_disconnect();
    esp_err_t err = esp_wifi_connect();
    if (s_reconnect_task) xTaskNotifyGive(s_reconnect_task);
    return err;
}

esp_err_t network_mgr_reset_credentials(void)
{
    /* Legacy API retained for ABI compatibility; it never erases credentials. */
    if (!s_wifi_started) return ESP_ERR_INVALID_STATE;
    if (s_sta_provisioned) return network_mgr_enter_direct_local_mode();
    /* Re-enter factory web-UI-only provisioning (no wifi_prov_mgr). */
    set_ap_config();
    (void)esp_wifi_set_mode(WIFI_MODE_APSTA);
    start_factory_web_setup();
    return ESP_OK;
}
