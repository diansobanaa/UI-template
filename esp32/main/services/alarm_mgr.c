#include "alarm_mgr.h"
#include <string.h>
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_attr.h"
#include "actuator_hal.h"
#include "event_mgr.h"
#include "storage_mgr.h"
#include "utils/psram_task.h"

static const char *TAG = "alarm_mgr";

static SemaphoreHandle_t s_mutex = NULL;
static EXT_RAM_BSS_ATTR alarm_record_t s_alarms[MAX_ACTIVE_ALARMS];
static uint32_t s_alarm_counter = 0;

static bool s_silenced = false;
static alarm_priority_t s_silenced_max_prio = ALARM_PRIO_NONE;

static bool s_test_active = false;
static int64_t s_test_end_ms = 0;

static alarm_pattern_t s_current_pattern = ALARM_PATTERN_OFF;
static uint32_t s_pattern_step_ms = 0;
static bool s_buzzer_physical_on = false;

static inline int64_t get_now_ms(void) {
    return esp_timer_get_time() / 1000LL;
}

static void copy_field(char *dst, size_t dst_size, const char *src) {
    if (!dst || dst_size == 0) return;
    if (!src) {
        dst[0] = '\0';
        return;
    }
    strncpy(dst, src, dst_size - 1);
    dst[dst_size - 1] = '\0';
}

static const char *priority_str(alarm_priority_t prio) {
    switch (prio) {
        case ALARM_PRIO_CRITICAL: return "CRITICAL";
        case ALARM_PRIO_SAFETY_FAULT: return "SAFETY_FAULT";
        case ALARM_PRIO_TEST: return "TEST";
        default: return "NONE";
    }
}

static const char *pattern_str(alarm_pattern_t pat) {
    switch (pat) {
        case ALARM_PATTERN_CRITICAL: return "CRITICAL";
        case ALARM_PATTERN_INTERMITTENT: return "INTERMITTENT";
        case ALARM_PATTERN_TEST: return "TEST";
        default: return "OFF";
    }
}

static void alarm_pattern_task(void *arg) {
    (void)arg;
    ESP_LOGI(TAG, "Alarm pattern task running (50ms non-blocking tick).");

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(50));

        if (!s_mutex || xSemaphoreTake(s_mutex, pdMS_TO_TICKS(40)) != pdTRUE) {
            continue;
        }

        const int64_t now_ms = get_now_ms();

        // 1. Check if test expired
        if (s_test_active && now_ms >= s_test_end_ms) {
            s_test_active = false;
            ESP_LOGI(TAG, "Manual buzzer test completed.");
        }

        // 2. Determine highest active priority
        alarm_priority_t highest_active = ALARM_PRIO_NONE;
        bool has_active_unsilenced = false;

        for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
            if (s_alarms[i].active) {
                if (s_alarms[i].priority > highest_active) {
                    highest_active = s_alarms[i].priority;
                }
                if (!s_alarms[i].silenced && !s_silenced) {
                    has_active_unsilenced = true;
                }
            }
        }

        if (s_test_active && highest_active == ALARM_PRIO_NONE) {
            highest_active = ALARM_PRIO_TEST;
            has_active_unsilenced = true;
        }

        // 3. Select desired pattern
        alarm_pattern_t desired_pattern = ALARM_PATTERN_OFF;
        if (has_active_unsilenced && highest_active != ALARM_PRIO_NONE) {
            if (highest_active == ALARM_PRIO_CRITICAL) {
                desired_pattern = ALARM_PATTERN_CRITICAL;
            } else if (highest_active == ALARM_PRIO_SAFETY_FAULT) {
                desired_pattern = ALARM_PATTERN_INTERMITTENT;
            } else if (highest_active == ALARM_PRIO_TEST) {
                desired_pattern = ALARM_PATTERN_TEST;
            }
        }

        // 4. Pattern change handling
        if (desired_pattern != s_current_pattern) {
            s_current_pattern = desired_pattern;
            s_pattern_step_ms = 0;
            s_buzzer_physical_on = false;
            actuator_hal_buzzer_set_raw(false);
        } else {
            s_pattern_step_ms += 50;
        }

        // 5. Evaluate buzzer output for current pattern phase
        bool desired_buzzer_on = false;
        switch (s_current_pattern) {
            case ALARM_PATTERN_CRITICAL: {
                // Urgent repeating pulse: 200ms ON, 150ms OFF (350ms period)
                uint32_t phase = s_pattern_step_ms % 350;
                desired_buzzer_on = (phase < 200);
                break;
            }
            case ALARM_PATTERN_INTERMITTENT: {
                // Slower warning cadence: 200ms ON, 150ms OFF, 200ms ON, 2000ms OFF (2550ms period)
                uint32_t phase = s_pattern_step_ms % 2550;
                desired_buzzer_on = (phase < 200) || (phase >= 350 && phase < 550);
                break;
            }
            case ALARM_PATTERN_TEST: {
                desired_buzzer_on = true;
                break;
            }
            case ALARM_PATTERN_OFF:
            default:
                desired_buzzer_on = false;
                break;
        }

        // 6. Actuate physical buzzer on change
        if (desired_buzzer_on != s_buzzer_physical_on) {
            s_buzzer_physical_on = desired_buzzer_on;
            actuator_hal_buzzer_set_raw(desired_buzzer_on);
        }

        xSemaphoreGive(s_mutex);
    }
}

esp_err_t alarm_mgr_init(void) {
    if (s_mutex) return ESP_OK;

    s_mutex = xSemaphoreCreateMutex();
    if (!s_mutex) return ESP_ERR_NO_MEM;

    memset(s_alarms, 0, sizeof(s_alarms));
    s_alarm_counter = 0;
    s_silenced = false;
    s_silenced_max_prio = ALARM_PRIO_NONE;
    s_test_active = false;
    s_current_pattern = ALARM_PATTERN_OFF;
    s_pattern_step_ms = 0;
    s_buzzer_physical_on = false;

    // Launch FreeRTOS pattern engine task (migrated to PSRAM: zero flash writes in loop)
    TaskHandle_t alarm_handle = psram_task_create_pinned(
        alarm_pattern_task,
        "alarm_task",
        3072,
        NULL,
        3,
        NULL,
        1
    );
    if (!alarm_handle) {
        ESP_LOGE(TAG, "Failed to create alarm pattern task");
        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(TAG, "Alarm manager initialized successfully.");

    // Boot recovery: check if previous boot had latched emergency stop
    if (storage_mgr_get_estop()) {
        ESP_LOGW(TAG, "Restoring latched emergency stop critical alarm from persistent storage.");
        alarm_mgr_raise(
            ALARM_PRIO_CRITICAL,
            "EMERGENCY_STOP_LATCHED",
            "Emergency stop remains latched from previous boot; operator recovery required.",
            NULL,
            NULL
        );
    }

    return ESP_OK;
}

esp_err_t alarm_mgr_raise(alarm_priority_t priority, const char *code, const char *message,
                          const char *component_id, const char *gh_id) {
    if (!code || !code[0]) return ESP_ERR_INVALID_ARG;
    if (!s_mutex) return ESP_ERR_INVALID_STATE;

    const int64_t now_ms = get_now_ms();
    const char *msg = (message && message[0]) ? message : "Alarm condition detected";

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    // Check for existing active alarm with same code and component_id (Deduplication / Debouncing)
    for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
        if (s_alarms[i].active && strcmp(s_alarms[i].code, code) == 0) {
            if (!component_id || strcmp(s_alarms[i].component_id, component_id) == 0) {
                // Already active; update message if newer, but preserve acknowledge and silence state
                copy_field(s_alarms[i].message, sizeof(s_alarms[i].message), msg);
                xSemaphoreGive(s_mutex);
                return ESP_OK;
            }
        }
    }

    // Reactivate a matching resolved slot or find a free slot
    int target_slot = -1;
    int oldest_resolved = -1;
    int64_t oldest_resolved_time = INT64_MAX;

    for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
        if (!s_alarms[i].active) {
            if (s_alarms[i].code[0] == '\0') {
                target_slot = i;
                break;
            }
            if (s_alarms[i].resolved_at_ms < oldest_resolved_time) {
                oldest_resolved_time = s_alarms[i].resolved_at_ms;
                oldest_resolved = i;
            }
        }
    }

    if (target_slot == -1) {
        target_slot = oldest_resolved;
    }

    if (target_slot == -1) {
        ESP_LOGE(TAG, "No free alarm slots available to record %s", code);
        xSemaphoreGive(s_mutex);
        return ESP_ERR_NO_MEM;
    }

    alarm_record_t *rec = &s_alarms[target_slot];
    memset(rec, 0, sizeof(*rec));
    snprintf(rec->id, sizeof(rec->id), "alm-%lu", (unsigned long)++s_alarm_counter);
    copy_field(rec->code, sizeof(rec->code), code);
    copy_field(rec->message, sizeof(rec->message), msg);
    copy_field(rec->component_id, sizeof(rec->component_id), component_id);
    copy_field(rec->gh_id, sizeof(rec->gh_id), gh_id);
    rec->priority = priority;
    rec->active = true;
    rec->acknowledged = false;
    rec->silenced = false;
    rec->created_at_ms = now_ms;

    // Reactivate sound if a new higher-priority critical alarm arrives during a lower-priority silence
    if (s_silenced && priority > s_silenced_max_prio) {
        ESP_LOGW(TAG, "Higher priority alarm %s preempts existing silence; reactivating audible alert.", code);
        s_silenced = false;
        s_silenced_max_prio = ALARM_PRIO_NONE;
    }

    xSemaphoreGive(s_mutex);

    // Structured audit logging
    event_level_t log_lvl = (priority == ALARM_PRIO_CRITICAL) ? LOG_LEVEL_CRITICAL : LOG_LEVEL_ERROR;
    (void)event_mgr_log(log_lvl, "ALARM", code, msg, component_id);

    ESP_LOGI(TAG, "Raised alarm %s [%s]: %s (comp: %s, gh: %s)",
             rec->id, priority_str(priority), code, component_id ? component_id : "-", gh_id ? gh_id : "-");

    return ESP_OK;
}

esp_err_t alarm_mgr_resolve(const char *code, const char *component_id) {
    if (!code || !code[0]) return ESP_ERR_INVALID_ARG;
    if (!s_mutex) return ESP_ERR_INVALID_STATE;

    const int64_t now_ms = get_now_ms();
    bool found = false;

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
        if (s_alarms[i].active && strcmp(s_alarms[i].code, code) == 0) {
            if (!component_id || !component_id[0] || strcmp(s_alarms[i].component_id, component_id) == 0) {
                s_alarms[i].active = false;
                s_alarms[i].resolved_at_ms = now_ms;
                found = true;
                ESP_LOGI(TAG, "Resolved alarm %s (%s)", s_alarms[i].id, code);
            }
        }
    }

    // If no active alarms remain, reset silence latch
    bool any_active = false;
    for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
        if (s_alarms[i].active) {
            any_active = true;
            break;
        }
    }
    if (!any_active) {
        s_silenced = false;
        s_silenced_max_prio = ALARM_PRIO_NONE;
    }

    xSemaphoreGive(s_mutex);

    if (found) {
        char resolve_code[64];
        snprintf(resolve_code, sizeof(resolve_code), "%s_RESOLVED", code);
        (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM", resolve_code, "Alarm condition resolved.", component_id);
    }

    return found ? ESP_OK : ESP_ERR_NOT_FOUND;
}

esp_err_t alarm_mgr_acknowledge(const char *alarm_id) {
    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    const int64_t now_ms = get_now_ms();
    bool found = false;

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
        if (s_alarms[i].active) {
            if (!alarm_id || !alarm_id[0] ||
                strcmp(s_alarms[i].id, alarm_id) == 0 ||
                strcmp(s_alarms[i].code, alarm_id) == 0) {
                s_alarms[i].acknowledged = true;
                s_alarms[i].acknowledged_at_ms = now_ms;
                found = true;
                ESP_LOGI(TAG, "Acknowledged alarm %s (%s)", s_alarms[i].id, s_alarms[i].code);
            }
        }
    }

    xSemaphoreGive(s_mutex);

    if (found) {
        (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM", "ALARM_ACKNOWLEDGED",
                            "Operator acknowledged active alarm(s).", alarm_id);
    }

    return found ? ESP_OK : ESP_ERR_NOT_FOUND;
}

esp_err_t alarm_mgr_silence(bool silence) {
    if (!s_mutex) return ESP_ERR_INVALID_STATE;
    const int64_t now_ms = get_now_ms();

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    s_silenced = silence;
    s_silenced_max_prio = ALARM_PRIO_NONE;

    for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
        if (s_alarms[i].active) {
            s_alarms[i].silenced = silence;
            if (silence) {
                s_alarms[i].silenced_at_ms = now_ms;
                if (s_alarms[i].priority > s_silenced_max_prio) {
                    s_silenced_max_prio = s_alarms[i].priority;
                }
            }
        }
    }

    // If silencing, immediately force physical buzzer pin low
    if (silence) {
        s_buzzer_physical_on = false;
        actuator_hal_buzzer_set_raw(false);
    }

    xSemaphoreGive(s_mutex);

    (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM",
                        silence ? "ALARM_SILENCED" : "ALARM_UNSILENCED",
                        silence ? "Physical buzzer silenced by operator." : "Buzzer silence removed.",
                        NULL);
    ESP_LOGI(TAG, "Alarm audible state changed to: %s", silence ? "SILENCED" : "AUDIBLE");

    return ESP_OK;
}

esp_err_t alarm_mgr_trigger_test(uint32_t duration_ms) {
    if (!s_mutex) return ESP_ERR_INVALID_STATE;

    if (duration_ms < 200) duration_ms = 800;
    if (duration_ms > 5000) duration_ms = 5000;

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) return ESP_FAIL;

    // Check if critical or safety fault alarms are active: lower priority test cannot override
    for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
        if (s_alarms[i].active && s_alarms[i].priority >= ALARM_PRIO_SAFETY_FAULT) {
            xSemaphoreGive(s_mutex);
            ESP_LOGW(TAG, "Cannot start buzzer test: higher priority alarm '%s' is active", s_alarms[i].code);
            return ESP_ERR_INVALID_STATE;
        }
    }

    s_test_active = true;
    s_test_end_ms = get_now_ms() + (int64_t)duration_ms;
    s_current_pattern = ALARM_PATTERN_TEST;
    s_pattern_step_ms = 0;
    s_buzzer_physical_on = true;
    actuator_hal_buzzer_set_raw(true);

    xSemaphoreGive(s_mutex);

    (void)event_mgr_log(LOG_LEVEL_INFO, "ALARM", "BUZZER_TEST_STARTED",
                        "Physical buzzer test triggered by operator.", NULL);
    ESP_LOGI(TAG, "Physical buzzer test started for %lu ms.", (unsigned long)duration_ms);

    return ESP_OK;
}

alarm_priority_t alarm_mgr_get_highest_priority(void) {
    if (!s_mutex) return ALARM_PRIO_NONE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return ALARM_PRIO_NONE;

    alarm_priority_t highest = ALARM_PRIO_NONE;
    for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
        if (s_alarms[i].active && s_alarms[i].priority > highest) {
            highest = s_alarms[i].priority;
        }
    }
    if (s_test_active && highest == ALARM_PRIO_NONE) highest = ALARM_PRIO_TEST;

    xSemaphoreGive(s_mutex);
    return highest;
}

bool alarm_mgr_is_audible(void) {
    if (!s_mutex) return false;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return false;
    bool audible = (s_current_pattern != ALARM_PATTERN_OFF) && !s_silenced;
    xSemaphoreGive(s_mutex);
    return audible;
}

bool alarm_mgr_is_silenced(void) {
    if (!s_mutex) return false;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return false;
    bool silenced = s_silenced;
    xSemaphoreGive(s_mutex);
    return silenced;
}

cJSON *alarm_mgr_get_summary_json(void) {
    cJSON *sum = cJSON_CreateObject();
    if (!sum) return NULL;

    uint32_t active_count = 0;
    uint32_t critical_count = 0;
    uint32_t safety_fault_count = 0;
    alarm_priority_t highest_prio = ALARM_PRIO_NONE;

    if (s_mutex && xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
            if (s_alarms[i].active) {
                active_count++;
                if (s_alarms[i].priority == ALARM_PRIO_CRITICAL) critical_count++;
                else if (s_alarms[i].priority == ALARM_PRIO_SAFETY_FAULT) safety_fault_count++;
                if (s_alarms[i].priority > highest_prio) highest_prio = s_alarms[i].priority;
            }
        }
        bool audible = (s_current_pattern != ALARM_PATTERN_OFF) && !s_silenced;
        cJSON_AddBoolToObject(sum, "buzzerAudible", audible);
        cJSON_AddBoolToObject(sum, "isSilenced", s_silenced);
        cJSON_AddStringToObject(sum, "activePattern", pattern_str(s_current_pattern));
        cJSON_AddStringToObject(sum, "highestPriority", priority_str(highest_prio));
        cJSON_AddBoolToObject(sum, "testActive", s_test_active);
        xSemaphoreGive(s_mutex);
    } else {
        cJSON_AddBoolToObject(sum, "buzzerAudible", false);
        cJSON_AddBoolToObject(sum, "isSilenced", false);
        cJSON_AddStringToObject(sum, "activePattern", "OFF");
        cJSON_AddStringToObject(sum, "highestPriority", "NONE");
        cJSON_AddBoolToObject(sum, "testActive", false);
    }

    cJSON_AddNumberToObject(sum, "activeCount", active_count);
    cJSON_AddNumberToObject(sum, "criticalCount", critical_count);
    cJSON_AddNumberToObject(sum, "safetyFaultCount", safety_fault_count);

    return sum;
}

cJSON *alarm_mgr_get_status_json(void) {
    cJSON *root = cJSON_CreateObject();
    if (!root) return NULL;

    cJSON *summary = alarm_mgr_get_summary_json();
    if (summary) cJSON_AddItemToObject(root, "summary", summary);

    cJSON *active_arr = cJSON_AddArrayToObject(root, "activeAlarms");
    cJSON *recent_arr = cJSON_AddArrayToObject(root, "recentAlarms");

    if (s_mutex && xSemaphoreTake(s_mutex, portMAX_DELAY) == pdTRUE) {
        for (int i = 0; i < MAX_ACTIVE_ALARMS; ++i) {
            if (s_alarms[i].code[0] == '\0') continue;

            cJSON *item = cJSON_CreateObject();
            cJSON_AddStringToObject(item, "id", s_alarms[i].id);
            cJSON_AddStringToObject(item, "code", s_alarms[i].code);
            cJSON_AddStringToObject(item, "message", s_alarms[i].message);
            cJSON_AddStringToObject(item, "priority", priority_str(s_alarms[i].priority));
            cJSON_AddStringToObject(item, "componentId", s_alarms[i].component_id[0] ? s_alarms[i].component_id : "");
            cJSON_AddStringToObject(item, "ghId", s_alarms[i].gh_id[0] ? s_alarms[i].gh_id : "");
            cJSON_AddBoolToObject(item, "active", s_alarms[i].active);
            cJSON_AddBoolToObject(item, "acknowledged", s_alarms[i].acknowledged);
            cJSON_AddBoolToObject(item, "silenced", s_alarms[i].silenced);
            cJSON_AddNumberToObject(item, "createdAt", (double)s_alarms[i].created_at_ms);

            if (s_alarms[i].acknowledged_at_ms > 0)
                cJSON_AddNumberToObject(item, "acknowledgedAt", (double)s_alarms[i].acknowledged_at_ms);
            else cJSON_AddNullToObject(item, "acknowledgedAt");

            if (s_alarms[i].silenced_at_ms > 0)
                cJSON_AddNumberToObject(item, "silencedAt", (double)s_alarms[i].silenced_at_ms);
            else cJSON_AddNullToObject(item, "silencedAt");

            if (s_alarms[i].resolved_at_ms > 0)
                cJSON_AddNumberToObject(item, "resolvedAt", (double)s_alarms[i].resolved_at_ms);
            else cJSON_AddNullToObject(item, "resolvedAt");

            if (s_alarms[i].active) {
                cJSON_AddItemToArray(active_arr, item);
            } else {
                cJSON_AddItemToArray(recent_arr, item);
            }
        }
        xSemaphoreGive(s_mutex);
    }

    return root;
}
