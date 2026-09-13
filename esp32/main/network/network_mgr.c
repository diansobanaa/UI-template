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

static int s_retry_num = 0;
static bool s_is_connected = false;

static void event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_is_connected = false;
        if (s_retry_num < MAX_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "Retrying connection to AP...");
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGW(TAG, "Failed to connect to AP. Falling back to SoftAP provisioning mode.");
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
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, &instance_any_id));

    /* Initialize SoftAP for fallback */
    wifi_init_softap_fallback();

    /* Try loading config from NVS (mock for now, assume missing/empty) */
    wifi_config_t wifi_config_sta = {
        .sta = {
            .ssid = "",
            .password = "",
            /* Authmode threshold */
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };

    /* For Phase 1 we configure APSTA to run SoftAP and STA simultaneously if needed */
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    
    // If STA config is provided, we set it. For now, empty triggers fallback flow.
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config_sta));

    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Network Manager initialized (Wi-Fi STA + SoftAP).");
    return ESP_OK;
}

bool network_mgr_is_connected(void)
{
    return s_is_connected;
}
