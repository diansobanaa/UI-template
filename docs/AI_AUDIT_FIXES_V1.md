# AI Post-Build Integration Audit & Fixes

## Fix 1: Dead Validation in Crop Cycle Handlers

### Root Cause
In `esp32/main/http/api_cropcycle_handlers.c`, the function `validate_gh_id` performed a self-comparison `strcmp(gh_id, gh_id) != 0`. This validation was intended to enforce a Phase 1 constraint (topology limitation) where only one specific greenhouse ID is physically installed and supported. The hardcoded topology ID used in `esp32/main/services/crop_cycle_mgr.c`, telemetry, and config is `"gh-01"`. The typo rendered the validation dead, allowing any string to bypass it.

### Fix
Replaced the self-comparison with `strcmp(gh_id, "gh-01") != 0`.

### Verification
- Rebuilt with ESP-IDF ninja.
- No `strcmp` warnings or errors.

## Fix 2: Missing Authentication on Mutating Endpoints

### Root Cause
In `esp32/main/http/api_cropcycle_handlers.c`, the mutating endpoints (e.g., POST `/api/v1/greenhouses/{ghId}/crop-cycle`, PUT `.../planting-date`, POST `.../cancel`, POST `.../harvest`, etc.) were missing the required authentication check. While `api_command_handlers.c` properly invoked `http_check_auth(req)` to validate bearer tokens for mutating actions, the crop cycle endpoints were exposed openly without this middleware check, creating a security vulnerability where unauthenticated clients could mutate state.

### Fix
Injected `if (http_check_auth(req) != ESP_OK) { return ESP_OK; }` at the very beginning of the following mutating handlers:
- `handler_start_crop_cycle`
- `handler_import_active_crop_cycle`
- `handler_record_pollination`
- `handler_delete_pollination`
- `handler_update_planting_date`
- `handler_update_cycle_metadata`
- `handler_cancel_crop_cycle`
- `handler_harvest_crop_cycle`

### Verification
- Rebuilt with ESP-IDF ninja.
- Verified compilation succeeds.

## Fix 3: Incorrect HTTP Status Mapping in Command Handlers

### Root Cause
In `esp32/main/http/api_command_handlers.c`, two validation checks returned an incorrect HTTP `400` status code with the error code `"VALIDATION_FAILED"`. Throughout the rest of the application (and in other endpoints in the same file), `"VALIDATION_FAILED"` is correctly mapped to HTTP `422 Unprocessable Entity` in accordance with standard REST principles and the canonical OpenAPI contract. Returning `400` would break UI client compatibility which expects `422` for validation errors.

### Fix
Changed the two instances of `http_send_error(req, 400, "VALIDATION_FAILED", ...)` to `422` in `handler_post_command` and `handler_delete_command`.

### Verification
- Rebuilt with ESP-IDF ninja.
- Verified compilation succeeds.
