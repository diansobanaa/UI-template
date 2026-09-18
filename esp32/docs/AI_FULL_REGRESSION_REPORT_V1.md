# REGRESSION REPORT

**1. No Contract Drifts Found**
The OpenAPI specification remains the authoritative contract. The ESP32 responses and UI requests have been formally aligned. 

**2. No Bypass Patches Found**
By centralizing hardware operations in `actuator_hal_set()` and safety checks in `command_mgr_submit()`, direct manipulation of GPIO pins bypassing safety interlocks is fully prevented in the REST API handlers.

**3. Memory Bound Validation**
The 4096-byte limitation imposed on `http_parse_json_body()` successfully prevents heap exhaustion during config uploads, while not negatively impacting large JSON responses (like event histories) which are strictly outgoing.

**4. Partial Fixes**
No partial fixes were detected in the designated remediation scope.

**Conclusion:** No regressions introduced.
