#include "services/calibration_mgr.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#include "cJSON.h"
#include "storage/storage_mgr.h"

static const char *TAG = "CALIB_MGR";

static calibration_status_t s_ctx;
static SemaphoreHandle_t s_mutex = NULL;
static uint32_t s_start_tick = 0;

static float s_rate_dosing_a_ml_sec = 1.0f;
static float s_rate_dosing_b_ml_sec = 1.0f;

/* Flow meter calibration factors (pulses per Liter) */
/* ZJ-B1: Manufacturer spec F = 11 * Q -> 11 * 60 = 660.0 pulses/L (CALIBRATION REQUIRED LATER) */
static float s_flow_raw_pulses_per_l = 660.0f;
/* FS400A: Manufacturer spec F = 4.8 * Q -> 4.8 * 60 = 288.0 pulses/L */
static float s_flow_fert_pulses_per_l = 288.0f;

static void load_rates_from_storage(void)
{
    char buf[512];
    size_t len = 0;
    if (storage_mgr_load_calibration(buf, sizeof(buf), &len) == ESP_OK) {
        cJSON *root = cJSON_Parse(buf);
        if (root) {
            cJSON *a = cJSON_GetObjectItem(root, "rateA");
            if (a && cJSON_IsNumber(a)) s_rate_dosing_a_ml_sec = a->valuedouble;
            cJSON *b = cJSON_GetObjectItem(root, "rateB");
            if (b && cJSON_IsNumber(b)) s_rate_dosing_b_ml_sec = b->valuedouble;
            cJSON *fr = cJSON_GetObjectItem(root, "flowRawPulsesPerL");
            if (fr && cJSON_IsNumber(fr)) s_flow_raw_pulses_per_l = fr->valuedouble;
            cJSON *ff = cJSON_GetObjectItem(root, "flowFertPulsesPerL");
            if (ff && cJSON_IsNumber(ff)) s_flow_fert_pulses_per_l = ff->valuedouble;
            cJSON_Delete(root);
        }
    }
}

static void save_rates_to_storage(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "rateA", s_rate_dosing_a_ml_sec);
    cJSON_AddNumberToObject(root, "rateB", s_rate_dosing_b_ml_sec);
    cJSON_AddNumberToObject(root, "flowRawPulsesPerL", s_flow_raw_pulses_per_l);
    cJSON_AddNumberToObject(root, "flowFertPulsesPerL", s_flow_fert_pulses_per_l);
    char *str = cJSON_PrintUnformatted(root);
    if (str) {
        storage_mgr_save_calibration(str);
        free(str);
    }
    cJSON_Delete(root);
}

static void calibration_worker_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Calibration Manager task started.");
    
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(200));
        
        if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
            if (s_ctx.state == CALIBRATION_STATE_RUNNING) {
                uint32_t current_tick = xTaskGetTickCount();
                uint32_t elapsed = (current_tick - s_start_tick) / pdMS_TO_TICKS(1000);
                
                if (actuator_hal_is_emergency_stopped()) {
                    actuator_hal_set(s_ctx.pump_id, false);
                    actuator_hal_release(s_ctx.pump_id, ACTUATOR_OWNER_CALIBRATION);
                    s_ctx.state = CALIBRATION_STATE_ERROR;
                    s_ctx.remaining_sec = 0;
                    ESP_LOGW(TAG, "Calibration interrupted by E-Stop.");
                } else if (elapsed >= s_ctx.duration_sec) {
                    actuator_hal_set(s_ctx.pump_id, false);
                    actuator_hal_release(s_ctx.pump_id, ACTUATOR_OWNER_CALIBRATION);
                    s_ctx.remaining_sec = 0;
                    s_ctx.state = CALIBRATION_STATE_COMPLETE;
                    ESP_LOGI(TAG, "Calibration run complete.");
                } else {
                    s_ctx.remaining_sec = s_ctx.duration_sec - elapsed;
                }
            }
            xSemaphoreGive(s_mutex);
        }
    }
}

esp_err_t calibration_mgr_init(void)
{
    if (s_mutex) return ESP_OK;
    s_mutex = xSemaphoreCreateMutex();
    
    s_ctx.state = CALIBRATION_STATE_IDLE;
    s_ctx.pump_id = ACTUATOR_MAX_COUNT;
    s_ctx.duration_sec = 0;
    s_ctx.remaining_sec = 0;
    
    load_rates_from_storage();
    
    xTaskCreatePinnedToCore(calibration_worker_task, "calib_mgr", 3072, NULL, 3, NULL, 1);
    return ESP_OK;
}

esp_err_t calibration_mgr_start_volumetric(actuator_id_t pump_id, uint32_t duration_sec)
{
    if (pump_id >= ACTUATOR_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    
    if (s_ctx.state == CALIBRATION_STATE_RUNNING) {
        xSemaphoreGive(s_mutex);
        ESP_LOGE(TAG, "Calibration already running.");
        return ESP_ERR_INVALID_STATE;
    }
    
    if (actuator_hal_is_emergency_stopped()) {
        xSemaphoreGive(s_mutex);
        ESP_LOGE(TAG, "Cannot start calibration: Emergency Stopped.");
        return ESP_ERR_INVALID_STATE;
    }
    
    s_ctx.pump_id = pump_id;
    s_ctx.duration_sec = duration_sec;
    s_ctx.remaining_sec = duration_sec;
    s_start_tick = xTaskGetTickCount();
    
    esp_err_t err = actuator_hal_acquire(pump_id, ACTUATOR_OWNER_CALIBRATION);
    if (err == ESP_OK) {
        err = actuator_hal_set(pump_id, true);
        if (err == ESP_OK) {
            s_ctx.state = CALIBRATION_STATE_RUNNING;
            ESP_LOGI(TAG, "Calibration started for pump %d, duration %u sec", pump_id, (unsigned)duration_sec);
        } else {
            actuator_hal_release(pump_id, ACTUATOR_OWNER_CALIBRATION);
        }
    }
    
    xSemaphoreGive(s_mutex);
    return err;
}

esp_err_t calibration_mgr_stop(void)
{
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;
    
    if (s_ctx.state == CALIBRATION_STATE_RUNNING) {
        actuator_hal_set(s_ctx.pump_id, false);
        actuator_hal_release(s_ctx.pump_id, ACTUATOR_OWNER_CALIBRATION);
        s_ctx.state = CALIBRATION_STATE_ERROR;
        s_ctx.remaining_sec = 0;
        ESP_LOGI(TAG, "Calibration manually stopped.");
    }
    
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t calibration_mgr_get_status(calibration_status_t *out_status)
{
    if (!out_status) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        *out_status = s_ctx;
        xSemaphoreGive(s_mutex);
    }
    return ESP_OK;
}

float calibration_mgr_get_rate_ml_per_sec(actuator_id_t pump_id)
{
    float rate = 1.0f;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        if (pump_id == ACTUATOR_DOSING_A) rate = s_rate_dosing_a_ml_sec;
        else if (pump_id == ACTUATOR_DOSING_B) rate = s_rate_dosing_b_ml_sec;
        xSemaphoreGive(s_mutex);
    }
    return rate;
}

esp_err_t calibration_mgr_set_rate_ml_per_sec(actuator_id_t pump_id, float rate_ml_sec)
{
    if (rate_ml_sec <= 0.0f) return ESP_ERR_INVALID_ARG;
    
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        if (pump_id == ACTUATOR_DOSING_A) s_rate_dosing_a_ml_sec = rate_ml_sec;
        else if (pump_id == ACTUATOR_DOSING_B) s_rate_dosing_b_ml_sec = rate_ml_sec;
        save_rates_to_storage();
        xSemaphoreGive(s_mutex);
    }
    return ESP_OK;
}

float calibration_mgr_get_flow_raw_pulses_per_l(void)
{
    float val = 0.0f;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        val = s_flow_raw_pulses_per_l;
        xSemaphoreGive(s_mutex);
    }
    return val;
}

bool calibration_mgr_is_flow_raw_calibrated(void)
{
    return (calibration_mgr_get_flow_raw_pulses_per_l() > 0.0f);
}

esp_err_t calibration_mgr_set_flow_raw_pulses_per_l(float pulses_per_l)
{
    if (pulses_per_l <= 0.0f) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        s_flow_raw_pulses_per_l = pulses_per_l;
        save_rates_to_storage();
        xSemaphoreGive(s_mutex);
        ESP_LOGI(TAG, "ZJ-B1 raw water flow meter calibrated: %.2f pulses/L", pulses_per_l);
    }
    return ESP_OK;
}

float calibration_mgr_get_flow_fert_pulses_per_l(void)
{
    float val = 288.0f;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        val = s_flow_fert_pulses_per_l;
        xSemaphoreGive(s_mutex);
    }
    return val;
}

esp_err_t calibration_mgr_set_flow_fert_pulses_per_l(float pulses_per_l)
{
    if (pulses_per_l <= 0.0f) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        s_flow_fert_pulses_per_l = pulses_per_l;
        save_rates_to_storage();
        xSemaphoreGive(s_mutex);
        ESP_LOGI(TAG, "FS400A fertigation flow meter calibrated: %.2f pulses/L", pulses_per_l);
    }
    return ESP_OK;
}
