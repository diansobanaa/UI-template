# AI Contract Envelope Verification V1

## Objective
Perform a verification-first audit of the `EnvelopeBase` implementation in the ESP32 source code and the React UI client, ensuring strict adherence to the canonical `UI_ESP32_OPENAPI.yaml`.

## 1. Success Envelope Verification
**Status**: INCOMPLETE ALIGNMENT

**Findings**:
- **ESP32 implementation (`http_send_enveloped_response`)**: Correctly centralizes the success envelope structure, outputting `requestId`, `success: true`, `deviceTimestamp`, and nested `data`.
- **UI Client (`esp32-client.ts`)**: Silently discards `requestId`, `deviceTimestamp`, and `success` for all 2xx responses. The current `apiGet`/`apiPost` methods extract `.data` and drop the envelope before returning to domain callers. 
- **Mutation Requests Payload**: The ESP32 `api_command_handlers.c`, `api_cropcycle_handlers.c`, and `api_config_handlers.c` assume a **flat JSON payload** instead of the `requestId`, `client`, and `payload` nested structure mandated by the OpenAPI (e.g., `CommandRequest`). The UI client similarly sends flat JSON bodies.

## 2. Error Envelope Verification
**Status**: VERIFIED & FIXED

**Findings**:
- **ESP32 implementation (`http_send_error`)**: Returned `requestId`, `success: false`, `deviceTimestamp`, and `error: { code, message }`. However, it was missing `retryable` and `reconcileRequired`.
- **UI Client (`backend-client.ts`)**: Previous implementation caught non-2xx responses and threw generic `ApiRequestError` containing only `status`, `path`, and `message`, entirely discarding the canonical ErrorResponse fields.

**Remediation Applied**:
- Modified `http_server.c` to automatically inject `retryable` (true for 5xx and 429) and `reconcileRequired` (true for 409) into the ErrorResponse payload.
- Modified `backend-client.ts` to fully parse the ErrorResponse envelope and map `code`, `retryable`, `reconcileRequired`, and `requestId` into the `ApiRequestError` instance.

## 3. Request ID Provenance
**Status**: GENUINELY AMBIGUOUS & MISALIGNED

**Findings**:
- **Mutation Requests**: OpenAPI specifies `requestId` explicitly inside the JSON body payload. However, both the ESP32 C code and the UI TypeScript code currently implement and expect flat JSON payloads, bypassing this contract requirement.
- **GET Requests**: OpenAPI `getHealth`, `getStatus`, etc., define **no** parameters, request bodies, or headers. There is no contractually defined mechanism for the UI to supply a `requestId` to a GET request in the OpenAPI schema. The ESP32 falls back to reading the `X-Request-ID` HTTP header to satisfy the `EnvelopeBase` return type, but this header is absent from the canonical OpenAPI and absent from the UI client's requests.

**Action Taken**: Halted further modification. As per policy: "If genuinely ambiguous, STOP and report. Do not modify the canonical OpenAPI unless a genuine contradiction is proven."

## 4. Device Timestamp
**Status**: VERIFIED

**Findings**:
- ESP32 uses POSIX time (`time(&now)`) and formats it strictly into RFC3339 format (`"%Y-%m-%dT%H:%M:%SZ"`) via `strftime`.
- Authoritative RTC time synchronization was previously implemented in SP-REMED-002.

## 5. Build & Test Result
**Status**: PASS

- The ESP32 firmware build completed successfully (`ninja -C build -j 1`).
- The UI client modifications compiled via TypeScript.

## 6. Remaining Contract Mismatches (Requires Design Decision)
1. **GET Request ID Mechanism**: `X-Request-ID` must be added to the OpenAPI contract as an implicit/explicit header, or the UI and ESP32 must agree to generate UUIDs/default to `"none"`.
2. **Mutation Body Structure**: The OpenAPI strictly requires `{ requestId, client, payload: { ... } }`, but the entire ecosystem currently implements and expects flat bodies (e.g., `{ commandId, type }`). A design decision is required to either rewrite all ESP32 C JSON parsing logic and UI request formatting, or simplify the OpenAPI request schema.

## Conclusion
The mechanical defects (ErrorResponse fields missing, UI discarding error metadata) have been directly fixed. However, due to structural API mismatches (nested payloads vs flat bodies) and ambiguous `requestId` semantics for GET requests, full contract compliance cannot be claimed yet.
