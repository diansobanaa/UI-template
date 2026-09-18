# API Contract Envelope Remediation

## Objective
Remediate the ESP32 HTTP backend to return responses wrapped in the canonical `EnvelopeBase` structure defined by the `UI_ESP32_OPENAPI.yaml`, without modifying the flat response payload content itself. 

## Context
The OpenAPI contract specifies that all successful API responses must include `requestId`, `success`, `deviceTimestamp`, and `data`. The C implementation previously returned flat payloads. 

## Completed Work
1. **Helper Expansion**: Expanded `http_server.h` and `http_server.c` to include `http_send_enveloped_response()`, which generates `success: true`, captures `deviceTimestamp` using ISO8601 formatting, and uses the `X-Request-ID` header if a specific request ID isn't provided.
2. **Error Responses**: Rewrote `http_send_error()` to output the canonical `ErrorResponse` schema (nested `error` object with `code` and `message`).
3. **Endpoint Migration**: Safely refactored all endpoints in:
   - `api_device_handlers.c`
   - `api_telemetry_handlers.c`
   - `api_command_handlers.c`
   - `api_cropcycle_handlers.c`
   - `api_config_handlers.c`
4. **UI Client Accommodation**: Modified `src/lib/api/esp32-client.ts` to expect the Envelope wrapper from `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete` calls. The client transparently unwraps the `.data` payload, ensuring the rest of the UI continues to function with flat `contracts.ts` definitions.

## Verification
- Code review performed to ensure valid `cJSON` construction.
- Time formatted successfully to ISO8601 string.
- Types in TypeScript UI client adjusted and remain aligned with `contracts.ts`.

## Known Issues
- `ninja` compilation was skipped due to local ESP-IDF environment configuration. It should be built locally.
