#include "hal/button_hal.h"
#include "config/pin_config.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "BUTTON_HAL";

typedef struct {
    gpio_num_t gpio;
    bool current_state;
    bool last_raw_state;
    uint32_t stable_count;
} button_state_t;

static button_state_t s_buttons[BUTTON_MAX_COUNT] = {
    [BUTTON_MODE]         = { .gpio = PIN_BTN_MODE,         .current_state = false, .last_raw_state = true, .stable_count = 0 },
    [BUTTON_MANUAL_A]     = { .gpio = PIN_BTN_MANUAL_A,     .current_state = false, .last_raw_state = true, .stable_count = 0 },
    [BUTTON_MANUAL_B]     = { .gpio = PIN_BTN_MANUAL_B,     .current_state = false, .last_raw_state = true, .stable_count = 0 },
    [BUTTON_DISTRIBUTION] = { .gpio = PIN_BTN_DISTRIBUTION, .current_state = false, .last_raw_state = true, .stable_count = 0 },
};

static button_event_cb_t s_callback = NULL;
static bool s_task_started = false;

static void button_poll_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Button polling task active on Core %d (20ms interval).", xPortGetCoreID());
    while (1) {
        button_hal_poll();
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

esp_err_t button_hal_init(button_event_cb_t cb)
{
    s_callback = cb;

    gpio_config_t btn_conf = {
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
        .pin_bit_mask = (1ULL << PIN_BTN_MODE) |
                        (1ULL << PIN_BTN_MANUAL_A) |
                        (1ULL << PIN_BTN_MANUAL_B) |
                        (1ULL << PIN_BTN_DISTRIBUTION)
    };

    esp_err_t err = gpio_config(&btn_conf);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Button HAL initialized: Mode(%d), ManA(%d), ManB(%d), Dist(%d) pulled HIGH.",
                 PIN_BTN_MODE, PIN_BTN_MANUAL_A, PIN_BTN_MANUAL_B, PIN_BTN_DISTRIBUTION);

        if (!s_task_started) {
            BaseType_t r = xTaskCreatePinnedToCore(
                button_poll_task,
                "btn_poll_task",
                3072,
                NULL,
                5,
                NULL,
                1 /* Pin to Core 1 (Control/Safety Core) */
            );
            if (r == pdPASS) {
                s_task_started = true;
            } else {
                ESP_LOGE(TAG, "Failed to create button_poll_task");
            }
        }
    }
    return err;
}

void button_hal_poll(void)
{
    for (int i = 0; i < BUTTON_MAX_COUNT; ++i) {
        bool raw_level = (gpio_get_level(s_buttons[i].gpio) == 0); /* 0 = Pressed */

        if (raw_level == s_buttons[i].last_raw_state) {
            s_buttons[i].stable_count++;
            if (s_buttons[i].stable_count >= 2) { /* ~40ms at 20ms poll */
                if (s_buttons[i].current_state != raw_level) {
                    s_buttons[i].current_state = raw_level;
                    ESP_LOGI(TAG, "Button %d event: %s", i, raw_level ? "PRESSED" : "RELEASED");
                    if (s_callback) {
                        s_callback((button_id_t)i, raw_level);
                    }
                }
            }
        } else {
            s_buttons[i].last_raw_state = raw_level;
            s_buttons[i].stable_count = 0;
        }
    }
}

bool button_hal_is_pressed(button_id_t btn)
{
    if (btn >= BUTTON_MAX_COUNT) return false;
    return s_buttons[btn].current_state;
}
