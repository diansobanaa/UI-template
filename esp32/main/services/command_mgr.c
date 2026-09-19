#include "services/command_mgr.h"
#include "services/manual_actuator_mgr.h"
#include "services/transfer_mgr.h"
#include "services/fertigation_mgr.h"
#include "services/safety_monitor.h"
#include "services/event_mgr.h"
#include "hal/actuator_hal.h"
#include "hal/hardware_registry.h"
#include "storage/storage_mgr.h"
#include "config/system_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "cJSON.h"
#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <stdlib.h>

static const char *TAG = "CMD_MGR";
#define IDEMPOTENCY_CACHE_SIZE 32
#define COMMAND_CONFIG_MAX 16384

typedef struct { command_item_t command; } component_timed_task_ctx_t;
static command_item_t s_cache[IDEMPOTENCY_CACHE_SIZE];
static size_t s_cache_next = 0;
static size_t s_cache_count = 0;
static SemaphoreHandle_t s_cache_mutex = NULL;
static QueueHandle_t s_cmd_queue = NULL;

static void copy_str(char *dst, size_t n, const char *src)
{
    if (!dst || n == 0) return;
    dst[0] = '\0';
    if (!src) return;
    strncpy(dst, src, n - 1);
    dst[n - 1] = '\0';
}

static const char *type_name(cmd_type_t type)
{
    switch (type) {
        case CMD_TYPE_WELL_PUMP: return "WELL_PUMP";
        case CMD_TYPE_DIST_PUMP: return "DIST_PUMP";
        case CMD_TYPE_DOSING_RUN: return "DOSING_RUN";
        case CMD_TYPE_TANK_TRANSFER: return "TANK_TRANSFER";
        case CMD_TYPE_FERTIGATION_BATCH: return "FERTIGATION_BATCH";
        case CMD_TYPE_EMERGENCY_STOP: return "EMERGENCY_STOP";
        case CMD_TYPE_RESUME: return "RESUME";
        case CMD_TYPE_COMPONENT_TIMED: return "COMPONENT_TIMED";
        default: return "CUSTOM";
    }
}

static bool command_semantically_equal(const command_item_t *a, const command_item_t *b)
{
    if (!a || !b) return false;
    return a->type == b->type &&
           a->param_duration_sec == b->param_duration_sec &&
           a->param_raw_volume_ml == b->param_raw_volume_ml &&
           a->param_on == b->param_on &&
           a->param_source_id == b->param_source_id &&
           a->param_dest_id == b->param_dest_id &&
           strcmp(a->source_component_id, b->source_component_id) == 0 &&
           strcmp(a->destination_component_id, b->destination_component_id) == 0 &&
           a->configuration_version == b->configuration_version &&
           a->max_runtime_sec == b->max_runtime_sec &&
           strcmp(a->component_id, b->component_id) == 0 &&
           strcmp(a->resource_id, b->resource_id) == 0 &&
           strcmp(a->target_complex_id, b->target_complex_id) == 0 &&
           strcmp(a->target_gh_id, b->target_gh_id) == 0 &&
           strcmp(a->fertigation_payload_json, b->fertigation_payload_json) == 0;
}

static command_item_t *cache_find_locked(const char *cmd_id)
{
    for (size_t i = 0; i < s_cache_count; ++i) {
        if (strcmp(s_cache[i].command_id, cmd_id) == 0) return &s_cache[i];
    }
    return NULL;
}

static void cache_insert_locked(const command_item_t *cmd)
{
    s_cache[s_cache_next] = *cmd;
    s_cache_next = (s_cache_next + 1U) % IDEMPOTENCY_CACHE_SIZE;
    if (s_cache_count < IDEMPOTENCY_CACHE_SIZE) ++s_cache_count;
}

static bool active_config_has_gh(const char *gh_id)
{
    if (!gh_id || !gh_id[0]) return true;
    char *buf = calloc(1, COMMAND_CONFIG_MAX);
    if (!buf) return false;
    size_t len = 0;
    bool found = false;
    if (storage_mgr_load_config(buf, COMMAND_CONFIG_MAX, &len) == ESP_OK) {
        cJSON *root = cJSON_ParseWithLength(buf, len);
        cJSON *ghs = root ? cJSON_GetObjectItem(root, "greenhouses") : NULL;
        if (ghs && cJSON_IsArray(ghs)) {
            cJSON *gh = NULL;
            cJSON_ArrayForEach(gh, ghs) {
                cJSON *id = cJSON_GetObjectItem(gh, "ghId");
                if (!id) id = cJSON_GetObjectItem(gh, "id");
                if (id && cJSON_IsString(id) && strcmp(id->valuestring, gh_id) == 0) { found = true; break; }
            }
        }
        if (root) cJSON_Delete(root);
    }
    free(buf);
    return found;
}

static esp_err_t normalize_and_validate_command(command_item_t *cmd, char *code, size_t code_len, char *message, size_t message_len)
{
    if (!cmd || !cmd->command_id[0]) {
        copy_str(code, code_len, "COMMAND_ID_REQUIRED");
        copy_str(message, message_len, "commandId is required.");
        return ESP_ERR_INVALID_ARG;
    }
    if (strlen(cmd->command_id) >= sizeof(cmd->command_id)) {
        copy_str(code, code_len, "COMMAND_ID_TOO_LONG");
        copy_str(message, message_len, "commandId exceeds the device limit.");
        return ESP_ERR_INVALID_ARG;
    }
    if ((int)cmd->type < 0 || cmd->type > CMD_TYPE_CUSTOM) {
        copy_str(code, code_len, "UNKNOWN_COMMAND_TYPE");
        copy_str(message, message_len, "Unsupported command type.");
        return ESP_ERR_NOT_SUPPORTED;
    }

    const system_storage_state_t *storage = storage_mgr_get_state();
    if (!storage) return ESP_ERR_INVALID_STATE;
    if (cmd->target_complex_id[0] == '\0') copy_str(cmd->target_complex_id, sizeof(cmd->target_complex_id), storage->complex_id);
    if (strcmp(cmd->target_complex_id, storage->complex_id) != 0) {
        copy_str(code, code_len, "TARGET_COMPLEX_MISMATCH");
        copy_str(message, message_len, "Command target Complex does not match this controller.");
        return ESP_ERR_INVALID_STATE;
    }
    if (cmd->configuration_version == 0) cmd->configuration_version = storage->config_version;
    if (storage->safe_boot_active && cmd->type != CMD_TYPE_EMERGENCY_STOP && cmd->type != CMD_TYPE_RESUME) {
        copy_str(code, code_len, "SAFE_BOOT_ACTIVE");
        copy_str(message, message_len, "Controller is still in safe boot; normal physical commands are blocked.");
        return ESP_ERR_INVALID_STATE;
    }
    if (cmd->configuration_version != storage->config_version && cmd->type != CMD_TYPE_EMERGENCY_STOP) {
        copy_str(code, code_len, "STALE_CONFIGURATION_VERSION");
        snprintf(message, message_len, "Command targets configuration v%lu but active configuration is v%lu.",
                 (unsigned long)cmd->configuration_version, (unsigned long)storage->config_version);
        return ESP_ERR_INVALID_STATE;
    }
    if (cmd->source[0] == '\0') copy_str(cmd->source, sizeof(cmd->source), "HTTP");
    if (cmd->submitted_at == 0) cmd->submitted_at = esp_timer_get_time() / 1000LL;

    const bool lifecycle_control = cmd->type == CMD_TYPE_EMERGENCY_STOP || cmd->type == CMD_TYPE_RESUME;
    const bool component_physical = cmd->type == CMD_TYPE_COMPONENT_TIMED || cmd->type == CMD_TYPE_WELL_PUMP ||
                                    cmd->type == CMD_TYPE_DIST_PUMP || cmd->type == CMD_TYPE_DOSING_RUN;
    const bool target_gh_required = cmd->type == CMD_TYPE_FERTIGATION_BATCH || cmd->type == CMD_TYPE_COMPONENT_TIMED;

    if (target_gh_required && !cmd->target_gh_id[0]) {
        copy_str(code, code_len, "TARGET_GH_REQUIRED");
        copy_str(message, message_len, "This command requires a target GH.");
        return ESP_ERR_INVALID_ARG;
    }
    if (cmd->target_gh_id[0] && !active_config_has_gh(cmd->target_gh_id)) {
        copy_str(code, code_len, "UNKNOWN_TARGET_GH");
        copy_str(message, message_len, "Target GH is not present in the active configuration.");
        return ESP_ERR_NOT_FOUND;
    }
    if (lifecycle_control) return ESP_OK;

    if (cmd->type == CMD_TYPE_FERTIGATION_BATCH) {
        if (!cmd->param_on) return ESP_OK;
        if (!safety_monitor_allows_commands() || actuator_hal_is_emergency_stopped()) {
            copy_str(code, code_len, "SAFETY_LOCK_ACTIVE");
            copy_str(message, message_len, "Fertigation command is blocked by local safety state.");
            return ESP_ERR_INVALID_STATE;
        }
        if (!cmd->fertigation_payload_json[0]) {
            copy_str(code, code_len, "FERTIGATION_PAYLOAD_REQUIRED");
            copy_str(message, message_len, "Configuration-driven fertigation requires the compiled payload.");
            return ESP_ERR_INVALID_ARG;
        }
        cJSON *root = cJSON_Parse(cmd->fertigation_payload_json);
        bool plan_present = false;
        if (root) {
            cJSON *plan = cJSON_GetObjectItem(root, "executionPlan");
            cJSON *params = cJSON_GetObjectItem(root, "parameters");
            if ((!plan || !cJSON_IsObject(plan)) && params && cJSON_IsObject(params)) plan = cJSON_GetObjectItem(params, "executionPlan");
            plan_present = plan && cJSON_IsObject(plan);
            cJSON_Delete(root);
        }
        if (!plan_present) {
            copy_str(code, code_len, "FERTIGATION_EXECUTION_PLAN_REQUIRED");
            copy_str(message, message_len, "Configuration-driven fertigation requires a resolved executionPlan.");
            return ESP_ERR_INVALID_STATE;
        }
        return ESP_OK;
    }

    if (cmd->type == CMD_TYPE_TANK_TRANSFER) {
        if (!cmd->param_on) return ESP_OK;
        if (!cmd->source_component_id[0] || !cmd->destination_component_id[0]) {
            copy_str(code, code_len, "TRANSFER_COMPONENT_IDS_REQUIRED");
            copy_str(message, message_len, "Tank transfer requires logical source and destination component IDs.");
            return ESP_ERR_INVALID_ARG;
        }
        if (cmd->param_duration_sec <= 0) {
            copy_str(code, code_len, "DURATION_REQUIRED");
            copy_str(message, message_len, "Tank transfer requires a positive duration.");
            return ESP_ERR_INVALID_ARG;
        }
        hw_component_info_t source = {0};
        hw_component_info_t destination = {0};
        if (hardware_registry_find_by_id(cmd->source_component_id, &source) != ESP_OK ||
            hardware_registry_find_by_id(cmd->destination_component_id, &destination) != ESP_OK) {
            copy_str(code, code_len, "TRANSFER_COMPONENT_NOT_FOUND");
            copy_str(message, message_len, "Transfer source or destination is not present in the active registry.");
            return ESP_ERR_NOT_FOUND;
        }
        if (!hardware_registry_is_operational(cmd->source_component_id) || !hardware_registry_is_operational(cmd->destination_component_id)) {
            copy_str(code, code_len, "TRANSFER_COMPONENT_NOT_OPERATIONAL");
            copy_str(message, message_len, "Transfer source and destination must be commissioned/enabled.");
            return ESP_ERR_INVALID_STATE;
        }
        if (!strcasestr(source.role, "PUMP") || !strcasestr(destination.role, "VALVE")) {
            copy_str(code, code_len, "TRANSFER_ROLE_MISMATCH");
            copy_str(message, message_len, "Transfer source must be a pump and destination must be a valve.");
            return ESP_ERR_INVALID_ARG;
        }
        if (strcmp(source.assignment.complex_id, destination.assignment.complex_id) != 0 ||
            source.resource_id[0] == '\0' || destination.resource_id[0] == '\0') {
            copy_str(code, code_len, "TRANSFER_RESOURCE_BINDING_INVALID");
            copy_str(message, message_len, "Transfer components must belong to the same Complex and have resource bindings.");
            return ESP_ERR_INVALID_STATE;
        }
        if (!cmd->resource_id[0]) copy_str(cmd->resource_id, sizeof(cmd->resource_id), source.resource_id);
        copy_str(cmd->component_id, sizeof(cmd->component_id), cmd->source_component_id);
        if (!cmd->target_gh_id[0]) copy_str(cmd->target_gh_id, sizeof(cmd->target_gh_id), destination.assignment.gh_id);
        if (cmd->target_gh_id[0] && strcmp(cmd->target_gh_id, destination.assignment.gh_id) != 0) {
            copy_str(code, code_len, "TRANSFER_TARGET_GH_MISMATCH");
            copy_str(message, message_len, "Transfer target GH does not match the destination component assignment.");
            return ESP_ERR_INVALID_STATE;
        }
        if (!safety_monitor_allows_commands() || actuator_hal_is_emergency_stopped()) {
            copy_str(code, code_len, "SAFETY_LOCK_ACTIVE");
            copy_str(message, message_len, "Tank transfer is blocked by local safety state.");
            return ESP_ERR_INVALID_STATE;
        }
        return safety_monitor_authorize_component(cmd->source_component_id, cmd->target_gh_id, (uint32_t)cmd->param_duration_sec,
                                                  SAFETY_COMMAND_TRANSFER, code, code_len, message, message_len);
    }

    if (!cmd->component_id[0]) {
        copy_str(code, code_len, "TARGET_COMPONENT_REQUIRED");
        copy_str(message, message_len, "Physical command requires a target component.");
        return ESP_ERR_INVALID_ARG;
    }

    hw_component_info_t component;
    esp_err_t err = hardware_registry_find_by_id(cmd->component_id, &component);
    if (err != ESP_OK) {
        copy_str(code, code_len, "UNKNOWN_COMPONENT");
        copy_str(message, message_len, "Target component is not present in the active registry.");
        return err;
    }
    if (!hardware_registry_is_operational(cmd->component_id)) {
        copy_str(code, code_len, "COMPONENT_NOT_OPERATIONAL");
        copy_str(message, message_len, "Target component is not commissioned/enabled.");
        return ESP_ERR_INVALID_STATE;
    }
    if (cmd->resource_id[0]) {
        if (!component.resource_id[0] || strcmp(cmd->resource_id, component.resource_id) != 0) {
            copy_str(code, code_len, "RESOURCE_COMPONENT_MISMATCH");
            copy_str(message, message_len, "Target resource does not match the component resource binding.");
            return ESP_ERR_INVALID_STATE;
        }
    } else if (component.resource_id[0]) {
        copy_str(cmd->resource_id, sizeof(cmd->resource_id), component.resource_id);
    }
    if (cmd->target_gh_id[0] && component.assignment.gh_id[0] && strcmp(cmd->target_gh_id, component.assignment.gh_id) != 0) {
        copy_str(code, code_len, "TARGET_GH_COMPONENT_MISMATCH");
        copy_str(message, message_len, "Target GH does not match the component assignment.");
        return ESP_ERR_INVALID_STATE;
    }
    if (!cmd->target_gh_id[0] && component.assignment.gh_id[0]) {
        copy_str(cmd->target_gh_id, sizeof(cmd->target_gh_id), component.assignment.gh_id);
    }

    bool on = false; actuator_owner_t owner = ACTUATOR_OWNER_NONE; uint32_t running_sec = 0;
    if (actuator_hal_get_component_status(cmd->component_id, &on, &owner, &running_sec) == ESP_OK) {
        if (owner == ACTUATOR_OWNER_SAFETY) {
            copy_str(code, code_len, "SAFETY_LOCK_ACTIVE");
            copy_str(message, message_len, "Target component is safety-locked until recovery.");
            return ESP_ERR_INVALID_STATE;
        }
        if (cmd->param_on && on) {
            copy_str(code, code_len, "RESOURCE_BUSY");
            copy_str(message, message_len, "Target component is already running.");
            return ESP_ERR_INVALID_STATE;
        }
    }

    safety_command_class_t safety_class = SAFETY_COMMAND_NORMAL;
    if (cmd->type == CMD_TYPE_WELL_PUMP || cmd->type == CMD_TYPE_DIST_PUMP) safety_class = SAFETY_COMMAND_TRANSFER;
    else if (cmd->type == CMD_TYPE_FERTIGATION_BATCH) safety_class = SAFETY_COMMAND_FERTIGATION;
    if (cmd->type == CMD_TYPE_COMPONENT_TIMED || cmd->type == CMD_TYPE_DOSING_RUN) safety_class = SAFETY_COMMAND_NORMAL;

    if (cmd->param_on) {
        err = safety_monitor_authorize_component(cmd->component_id, cmd->target_gh_id, (uint32_t)cmd->param_duration_sec,
                                                  safety_class, code, code_len, message, message_len);
        if (err != ESP_OK) return err;
        if (cmd->max_runtime_sec > 0 && (uint32_t)cmd->param_duration_sec > cmd->max_runtime_sec) {
            copy_str(code, code_len, "MAX_RUNTIME_EXCEEDED");
            copy_str(message, message_len, "Requested runtime exceeds the command safety limit.");
            return ESP_ERR_INVALID_STATE;
        }
    }

    if (component_physical && cmd->param_on && cmd->param_duration_sec <= 0) {
        copy_str(code, code_len, "DURATION_REQUIRED");
        copy_str(message, message_len, "Physical ON commands require a positive duration.");
        return ESP_ERR_INVALID_ARG;
    }
    return ESP_OK;
}

static actuator_owner_t owner_for_source(const command_item_t *cmd)
{
    if (cmd && strcasecmp(cmd->source, "SCHEDULER") == 0) return ACTUATOR_OWNER_SCHEDULER;
    if (cmd && strcasecmp(cmd->source, "FERTIGATION") == 0) return ACTUATOR_OWNER_FERTIGATION;
    if (cmd && strcasecmp(cmd->source, "TRANSFER") == 0) return ACTUATOR_OWNER_TRANSFER;
    if (cmd && strcasecmp(cmd->source, "CALIBRATION") == 0) return ACTUATOR_OWNER_CALIBRATION;
    return ACTUATOR_OWNER_MANUAL;
}


static void log_command_event(event_level_t level, const char *code, const char *message, const command_item_t *cmd)
{
    const command_item_t empty = {0};
    const command_item_t *c = cmd ? cmd : &empty;
    const system_storage_state_t *storage = storage_mgr_get_state();
    (void)event_mgr_log_command(level, code, message,
                                 c->command_id,
                                 c->target_complex_id[0] ? c->target_complex_id : (storage ? storage->complex_id : ""),
                                 c->target_gh_id,
                                 c->component_id,
                                 c->resource_id,
                                 c->configuration_version);
}

static void mark_cache_terminal(const char *command_id, cmd_status_enum_t status, const char *code, const char *message)
{
    if (!s_cache_mutex) return;
    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
    command_item_t *cached = cache_find_locked(command_id);
    if (cached && (cached->status == CMD_STATUS_PENDING || cached->status == CMD_STATUS_RUNNING)) {
        cached->status = status;
        cached->completed_at = esp_timer_get_time() / 1000LL;
        copy_str(cached->result_code, sizeof(cached->result_code), code);
        copy_str(cached->message, sizeof(cached->message), message);
    }
    xSemaphoreGive(s_cache_mutex);
}

static void component_timed_task(void *pvParameters)
{
    component_timed_task_ctx_t *ctx = (component_timed_task_ctx_t *)pvParameters;
    if (!ctx) { vTaskDelete(NULL); return; }
    command_item_t command = ctx->command;
    actuator_owner_t owner = owner_for_source(&command);
    bool acquired = actuator_hal_acquire_component(command.component_id, owner) == ESP_OK;

    if (!acquired) {
        mark_cache_terminal(command.command_id, CMD_STATUS_FAILED, "RESOURCE_BUSY", "Component ownership could not be acquired.");
        free(ctx); vTaskDelete(NULL); return;
    }
    int64_t start_us = 0;
    esp_err_t err = actuator_hal_set_by_component_id(command.component_id, true);
    if (err == ESP_OK) {
        start_us = esp_timer_get_time();
        while (((esp_timer_get_time() - start_us) / 1000000LL) < command.param_duration_sec) {
            vTaskDelay(pdMS_TO_TICKS(250));
            if (!safety_monitor_allows_commands()) { err = ESP_ERR_INVALID_STATE; break; }
        }
        (void)actuator_hal_set_by_component_id(command.component_id, false);
    }
    if (acquired) (void)actuator_hal_release_component(command.component_id, owner);

    if (err == ESP_OK) {
        mark_cache_terminal(command.command_id, CMD_STATUS_COMPLETED, "COMPLETED", "Component timed run completed safely.");
    } else {
        const char *code = actuator_hal_is_emergency_stopped() ? "EMERGENCY_STOP_ACTIVE" : "SAFETY_TRIP";
        mark_cache_terminal(command.command_id, CMD_STATUS_FAILED, code, "Component timed run was interrupted by safety.");
    }
    free(ctx);
    vTaskDelete(NULL);
}

static void command_worker_task(void *pvParameters)
{
    (void)pvParameters;
    ESP_LOGI(TAG, "Command manager worker task started.");
    while (1) {
        command_item_t cmd;
        if (xQueueReceive(s_cmd_queue, &cmd, portMAX_DELAY) != pdTRUE) continue;

        xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
        command_item_t *cached = cache_find_locked(cmd.command_id);
        if (!cached || cached->status == CMD_STATUS_REJECTED || cached->status == CMD_STATUS_CANCELLED ||
            cached->status == CMD_STATUS_COMPLETED || cached->status == CMD_STATUS_FAILED) {
            xSemaphoreGive(s_cache_mutex);
            continue;
        }
        if (actuator_hal_is_emergency_stopped() && cmd.type != CMD_TYPE_EMERGENCY_STOP && cmd.type != CMD_TYPE_RESUME) {
            cached->status = CMD_STATUS_REJECTED;
            copy_str(cached->result_code, sizeof(cached->result_code), "EMERGENCY_STOP_ACTIVE");
            copy_str(cached->message, sizeof(cached->message), "Command rejected because emergency stop is latched.");
            cached->completed_at = esp_timer_get_time() / 1000LL;
            xSemaphoreGive(s_cache_mutex);
            log_command_event(LOG_LEVEL_WARNING, "COMMAND_REJECTED", "Command rejected while emergency stop is latched.", &cmd);
            continue;
        }
        cached->status = CMD_STATUS_RUNNING;
        cached->started_at = esp_timer_get_time() / 1000LL;
        cmd.started_at = cached->started_at;
        xSemaphoreGive(s_cache_mutex);

        esp_err_t err = ESP_OK;
        bool async_task = false;
        const char *result_code = "COMPLETED";
        const char *result_message = "Command completed.";

        if (cmd.type == CMD_TYPE_EMERGENCY_STOP) {
            err = safety_monitor_trigger_emergency_stop("EMERGENCY_STOP_ACTIVE", "Operator emergency stop command activated.");
            result_message = "Emergency stop latched; protected outputs forced OFF.";
        } else if (cmd.type == CMD_TYPE_RESUME) {
            char recovery_code[48], recovery_msg[128];
            err = safety_monitor_request_recovery(recovery_code, sizeof(recovery_code), recovery_msg, sizeof(recovery_msg));
            result_code = err == ESP_OK ? "RECOVERED" : recovery_code;
            result_message = err == ESP_OK ? "Safety latch cleared after validated recovery." : recovery_msg;
        } else if (cmd.type == CMD_TYPE_WELL_PUMP || cmd.type == CMD_TYPE_DIST_PUMP || cmd.type == CMD_TYPE_DOSING_RUN || cmd.type == CMD_TYPE_COMPONENT_TIMED) {
            if (cmd.param_on) {
                component_timed_task_ctx_t *ctx = calloc(1, sizeof(*ctx));
                if (!ctx) {
                    err = ESP_ERR_NO_MEM;
                } else {
                    ctx->command = cmd;
                    BaseType_t task_created = xTaskCreate(component_timed_task, "cmd_component", 4096, ctx, 5, NULL);
                    if (task_created != pdPASS) {
                        free(ctx);
                        err = ESP_ERR_NO_MEM;
                    } else {
                        async_task = true;
                        result_message = "Bounded component run started.";
                    }
                }
            } else {
                err = actuator_hal_stop_component(cmd.component_id, owner_for_source(&cmd));
            }
        } else if (cmd.type == CMD_TYPE_TANK_TRANSFER) {
            err = transfer_mgr_start(cmd.source_component_id, cmd.destination_component_id, (uint32_t)cmd.param_duration_sec);
            async_task = (err == ESP_OK);
            result_message = err == ESP_OK ? "Transfer started." : "Transfer blocked or invalid.";
        } else if (cmd.type == CMD_TYPE_FERTIGATION_BATCH) {
            /* M12 has one physical execution authority: the resolved execution plan.
             * Legacy raw A/B payloads are rejected rather than routed to a second
             * heuristic execution path. */
            if (cmd.fertigation_payload_json[0]) {
                err = fertigation_mgr_start_from_json(cmd.fertigation_payload_json);
            } else {
                err = ESP_ERR_INVALID_ARG;
            }
            async_task = (err == ESP_OK);
            result_message = err == ESP_OK ? "Fertigation batch started." : "Fertigation batch rejected.";
        } else {
            err = ESP_ERR_NOT_SUPPORTED;
            result_code = "UNSUPPORTED_COMMAND";
            result_message = "Unknown or unsupported command type.";
        }

        if (!async_task) {
            xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
            cached = cache_find_locked(cmd.command_id);
            if (cached) {
                cached->status = err == ESP_OK ? CMD_STATUS_COMPLETED : CMD_STATUS_FAILED;
                cached->completed_at = esp_timer_get_time() / 1000LL;
                copy_str(cached->result_code, sizeof(cached->result_code), err == ESP_OK ? result_code : (result_code[0] ? result_code : "COMMAND_FAILED"));
                copy_str(cached->message, sizeof(cached->message), result_message);
            }
            xSemaphoreGive(s_cache_mutex);
            log_command_event(err == ESP_OK ? LOG_LEVEL_INFO : LOG_LEVEL_WARNING,
                             err == ESP_OK ? "COMMAND_COMPLETED" : "COMMAND_FAILED",
                             result_message, &cmd);
        } else {
            xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
            cached = cache_find_locked(cmd.command_id);
            if (cached) {
                cached->status = CMD_STATUS_RUNNING;
                copy_str(cached->result_code, sizeof(cached->result_code), "RUNNING");
                copy_str(cached->message, sizeof(cached->message), result_message);
            }
            xSemaphoreGive(s_cache_mutex);
            log_command_event(LOG_LEVEL_INFO, "COMMAND_STARTED", result_message, &cmd);
        }
    }
}

esp_err_t command_mgr_init(void)
{
    if (s_cache_mutex) return ESP_OK;
    s_cache_mutex = xSemaphoreCreateMutex();
    if (!s_cache_mutex) return ESP_ERR_NO_MEM;
    s_cmd_queue = xQueueCreate(COMMAND_QUEUE_LENGTH, sizeof(command_item_t));
    if (!s_cmd_queue) return ESP_ERR_NO_MEM;
    if (xTaskCreatePinnedToCore(command_worker_task, "cmd_worker", TASK_COMMAND_MGR_STACK, NULL, TASK_COMMAND_MGR_PRIO, NULL, 1) != pdPASS) return ESP_ERR_NO_MEM;
    ESP_LOGI(TAG, "Command Manager initialized with %d-entry idempotency cache.", IDEMPOTENCY_CACHE_SIZE);
    return ESP_OK;
}

esp_err_t command_mgr_submit(const command_item_t *cmd, command_item_t *out_receipt)
{
    if (!cmd || !s_cache_mutex || !s_cmd_queue) return ESP_ERR_INVALID_ARG;
    command_item_t normalized = *cmd;
    char code[48] = {0}, message[128] = {0};
    esp_err_t validation = normalize_and_validate_command(&normalized, code, sizeof(code), message, sizeof(message));
    if (validation != ESP_OK) {
        log_command_event(LOG_LEVEL_WARNING, code[0] ? code : "COMMAND_REJECTED", message[0] ? message : "Command rejected.", &normalized);
        return validation;
    }

    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
    command_item_t *cached = cache_find_locked(normalized.command_id);
    if (cached) {
        if (!command_semantically_equal(&normalized, cached)) {
            xSemaphoreGive(s_cache_mutex);
            log_command_event(LOG_LEVEL_WARNING, "COMMAND_ID_REUSE", "Command ID was already used with different physical semantics.", &normalized);
            return ESP_ERR_INVALID_ARG;
        }
        if (out_receipt) *out_receipt = *cached;
        xSemaphoreGive(s_cache_mutex);
        return ESP_OK;
    }

    normalized.status = CMD_STATUS_PENDING;
    normalized.submitted_at = normalized.submitted_at ? normalized.submitted_at : esp_timer_get_time() / 1000LL;
    copy_str(normalized.result_code, sizeof(normalized.result_code), "ACCEPTED");
    copy_str(normalized.message, sizeof(normalized.message), "Command accepted for safety-authorized processing.");
    cache_insert_locked(&normalized);
    xSemaphoreGive(s_cache_mutex);

    if (xQueueSend(s_cmd_queue, &normalized, pdMS_TO_TICKS(50)) != pdTRUE) {
        mark_cache_terminal(normalized.command_id, CMD_STATUS_REJECTED, "QUEUE_FULL", "Command queue is full.");
        log_command_event(LOG_LEVEL_WARNING, "QUEUE_FULL", "Physical command queue is full.", &normalized);
        return ESP_ERR_TIMEOUT;
    }

    log_command_event(LOG_LEVEL_INFO, "COMMAND_ACCEPTED", "Safety-authorized command accepted.", &normalized);
    if (out_receipt) {
        xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
        cached = cache_find_locked(normalized.command_id);
        if (cached) *out_receipt = *cached;
        xSemaphoreGive(s_cache_mutex);
    }
    return ESP_OK;
}

esp_err_t command_mgr_get(const char *command_id, command_item_t *out_receipt)
{
    if (!command_id || !out_receipt || !s_cache_mutex) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
    command_item_t *cached = cache_find_locked(command_id);
    if (!cached) { xSemaphoreGive(s_cache_mutex); return ESP_ERR_NOT_FOUND; }
    if (cached->status == CMD_STATUS_RUNNING) {
        if (cached->type == CMD_TYPE_FERTIGATION_BATCH) {
            fertigation_state_t state = fertigation_mgr_get_state();
            if (state == FERT_STATE_COMPLETE) cached->status = CMD_STATUS_COMPLETED;
            else if (state == FERT_STATE_INTERRUPTED) cached->status = CMD_STATUS_FAILED;
        } else if (cached->type == CMD_TYPE_TANK_TRANSFER) {
            transfer_state_t state = transfer_mgr_get_state();
            if (state == TRANSFER_STATE_COMPLETE) cached->status = CMD_STATUS_COMPLETED;
            else if (state == TRANSFER_STATE_ERROR) cached->status = CMD_STATUS_FAILED;
        } else if (cached->component_id[0]) {
            bool on = false; actuator_owner_t owner = ACTUATOR_OWNER_NONE; uint32_t runtime = 0;
            if (actuator_hal_get_component_status(cached->component_id, &on, &owner, &runtime) == ESP_OK && !on) {
                cached->status = actuator_hal_is_emergency_stopped() || safety_monitor_has_fault() ? CMD_STATUS_FAILED : CMD_STATUS_COMPLETED;
                cached->completed_at = esp_timer_get_time() / 1000LL;
                if (cached->status == CMD_STATUS_FAILED) copy_str(cached->result_code, sizeof(cached->result_code), "SAFETY_TRIP");
            }
        }
    }
    *out_receipt = *cached;
    xSemaphoreGive(s_cache_mutex);
    return ESP_OK;
}

esp_err_t command_mgr_cancel(const char *command_id)
{
    if (!command_id || !s_cache_mutex) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
    command_item_t *cached = cache_find_locked(command_id);
    if (!cached) { xSemaphoreGive(s_cache_mutex); return ESP_ERR_NOT_FOUND; }
    if (cached->status != CMD_STATUS_PENDING && cached->status != CMD_STATUS_RUNNING) {
        xSemaphoreGive(s_cache_mutex);
        return ESP_OK;
    }
    command_item_t copy = *cached;
    cached->status = CMD_STATUS_CANCELLED;
    cached->completed_at = esp_timer_get_time() / 1000LL;
    copy_str(cached->result_code, sizeof(cached->result_code), "CANCELLED");
    copy_str(cached->message, sizeof(cached->message), "Command cancellation requested.");
    xSemaphoreGive(s_cache_mutex);

    if (copy.component_id[0]) (void)actuator_hal_stop_component(copy.component_id, owner_for_source(&copy));
    if (copy.type == CMD_TYPE_TANK_TRANSFER) (void)transfer_mgr_stop();
    if (copy.type == CMD_TYPE_FERTIGATION_BATCH) (void)fertigation_mgr_cancel_batch();
    log_command_event(LOG_LEVEL_WARNING, "COMMAND_CANCELLED", "Command cancellation requested.", &copy);
    return ESP_OK;
}

esp_err_t command_mgr_notify_safety_trip(const char *reason_code, const char *reason)
{
    if (!s_cache_mutex) return ESP_ERR_INVALID_STATE;
    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
    for (size_t i = 0; i < s_cache_count; ++i) {
        command_item_t *cmd = &s_cache[i];
        if (cmd->status == CMD_STATUS_PENDING || cmd->status == CMD_STATUS_RUNNING) {
            cmd->status = CMD_STATUS_FAILED;
            cmd->completed_at = esp_timer_get_time() / 1000LL;
            copy_str(cmd->result_code, sizeof(cmd->result_code), reason_code ? reason_code : "SAFETY_TRIP");
            copy_str(cmd->message, sizeof(cmd->message), reason ? reason : "Command interrupted by safety.");
        }
    }
    xSemaphoreGive(s_cache_mutex);
    /* A global safety trip must also terminate orchestration state, not merely GPIO outputs. */
    (void)transfer_mgr_stop();
    (void)fertigation_mgr_cancel_batch();
    return ESP_OK;
}

esp_err_t command_mgr_notify_component_safety_fault(const char *component_id, const char *reason_code, const char *reason)
{
    if (!component_id || !s_cache_mutex) return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(s_cache_mutex, portMAX_DELAY);
    for (size_t i = 0; i < s_cache_count; ++i) {
        command_item_t *cmd = &s_cache[i];
        if ((cmd->status == CMD_STATUS_PENDING || cmd->status == CMD_STATUS_RUNNING) && strcmp(cmd->component_id, component_id) == 0) {
            cmd->status = CMD_STATUS_FAILED;
            cmd->completed_at = esp_timer_get_time() / 1000LL;
            copy_str(cmd->result_code, sizeof(cmd->result_code), reason_code ? reason_code : "SAFETY_TRIP");
            copy_str(cmd->message, sizeof(cmd->message), reason ? reason : "Component command interrupted by safety.");
        }
    }
    xSemaphoreGive(s_cache_mutex);
    return ESP_OK;
}
