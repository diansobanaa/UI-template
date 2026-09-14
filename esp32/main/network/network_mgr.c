#include "network_mgr.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include <string.h>

static const char *TAG = "NETWORK_MGR";

#define PROV_WIFI_SSID      "AGROTECH-SETUP"
#define PROV_WIFI_PASS      "agrotech"
#define MAX_RETRY           5

static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

#include "nvs.h"

static int s_retry_num = 0;
static bool s_is_connected = false;
static bool s_sta_provisioned = false;

static void event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        if (s_sta_provisioned) {
            ESP_LOGI(TAG, "STA started. Initiating connection to AP...");
            esp_wifi_connect();
        } else {
            ESP_LOGI(TAG, "STA started in unprovisioned state. SoftAP active at 192.168.4.1.");
        }
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_is_connected = false;
        if (s_retry_num < MAX_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "Retrying connection to AP (%d/%d)...", s_retry_num, MAX_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGW(TAG, "Failed to connect to AP after %d retries. SoftAP remaining available.", MAX_RETRY);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0;
        s_is_connected = true;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static void wifi_init_softap_fallback(void)
{
    esp_netif_t *ap_netif = esp_netif_create_default_wifi_ap();
    assert(ap_netif);

    wifi_config_t wifi_config_ap = {
        .ap = {
            .ssid = PROV_WIFI_SSID,
            .ssid_len = strlen(PROV_WIFI_SSID),
            .channel = 1,
            .password = PROV_WIFI_PASS,
            .max_connection = 4,
            .authmode = WIFI_AUTH_WPA_WPA2_PSK
        },
    };
    if (strlen(PROV_WIFI_PASS) == 0) {
        wifi_config_ap.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config_ap));
    ESP_LOGI(TAG, "SoftAP initialized. SSID:%s", PROV_WIFI_SSID);
}

esp_err_t network_mgr_init(void)
{
    s_wifi_event_group = xEventGroupCreate();

    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, &instance_any_id));

    /* Initialize SoftAP */
    wifi_init_softap_fallback();

    /* Load STA credentials from NVS ("agrotech" namespace) */
    char sta_ssid[33] = {0};
    char sta_pass[65] = {0};
    s_sta_provisioned = false;

    nvs_handle_t nvs_h;
    if (nvs_open("agrotech", NVS_READONLY, &nvs_h) == ESP_OK) {
        size_t ssid_len = sizeof(sta_ssid);
        size_t pass_len = sizeof(sta_pass);
        esp_err_t err_s = nvs_get_str(nvs_h, "sta_ssid", sta_ssid, &ssid_len);
        esp_err_t err_p = nvs_get_str(nvs_h, "sta_pass", sta_pass, &pass_len);
        nvs_close(nvs_h);

        if (err_s == ESP_OK && strlen(sta_ssid) > 0) {
            s_sta_provisioned = true;
            ESP_LOGI(TAG, "Wi-Fi STA configured from NVS: SSID='%s', Pass=[%s]",
                     sta_ssid, (err_p == ESP_OK && strlen(sta_pass) > 0) ? "CONFIGURED" : "OPEN");
        }
    }

    if (!s_sta_provisioned) {
        ESP_LOGI(TAG, "Wi-Fi STA unconfigured in NVS; operating in standalone SoftAP mode.");
    }

    /* Configure APSTA mode */
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    
    if (s_sta_provisioned) {
        wifi_config_t wifi_config_sta = {0};
        strncpy((char *)wifi_config_sta.sta.ssid, sta_ssid, sizeof(wifi_config_sta.sta.ssid) - 1);
        strncpy((char *)wifi_config_sta.sta.password, sta_pass, sizeof(wifi_config_sta.sta.password) - 1);
        wifi_config_sta.sta.threshold.authmode = (strlen(sta_pass) > 0) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config_sta));
    }

    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Network Manager initialized (Wi-Fi STA + SoftAP).");
    return ESP_OK;
}

bool network_mgr_is_connected(void)
{
    return s_is_connected;
}
