#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @file recipe_storage.h
 * @brief Authoritative ESP32 Recipe Storage Abstraction on MicroSD Card.
 *
 * Persists fertigation/mixing recipes directly to MicroSD card under /sdcard/recipes/<recipe-id>.json.
 * If MicroSD is physically absent or unmounted, the persistence path safely executes WRITE_TO_NOTHING,
 * reports storage unavailable, and does not crash, freeze, or disrupt any local controller operations.
 */

/**
 * @brief Initialize recipe storage subsystem and ensure recipe directory on SD if mounted.
 */
esp_err_t recipe_storage_init(void);

/**
 * @brief Check if persistent SD recipe storage is available and mounted.
 */
bool recipe_storage_is_available(void);

/**
 * @brief List all recipes stored on SD.
 * If SD card is not mounted, returns ESP_ERR_NOT_FOUND or degraded status with an empty array.
 * @param[out] out_array Pointer to receive cJSON array of recipe objects (caller must delete with cJSON_Delete).
 */
esp_err_t recipe_storage_list(cJSON **out_array);

/**
 * @brief Retrieve a single recipe by its ID.
 * @param recipe_id The recipe identifier.
 * @param[out] out_recipe Pointer to receive cJSON object (caller must delete with cJSON_Delete).
 */
esp_err_t recipe_storage_get(const char *recipe_id, cJSON **out_recipe);

/**
 * @brief Save/update a recipe on SD card.
 * If SD card is absent, executes WRITE_TO_NOTHING fallback and returns ESP_ERR_NOT_FOUND / degraded status.
 * @param recipe_id The recipe identifier.
 * @param recipe_json The complete JSON representation of the recipe.
 */
esp_err_t recipe_storage_save(const char *recipe_id, const cJSON *recipe_json);

/**
 * @brief Delete a recipe from SD card by its ID.
 * @param recipe_id The recipe identifier.
 */
esp_err_t recipe_storage_delete(const char *recipe_id);

#ifdef __cplusplus
}
#endif
