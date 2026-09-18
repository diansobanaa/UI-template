# CROSS-REMEDIATION AUDIT

### A. CONTRACT
- **Canonical OpenAPI**: Perfectly aligned.
- **UI TypeScript**: Matches ESP32 implementations (Payloads updated for `componentId`).
- **Result**: Contract Drift Eliminated.

### B. UI <-> ESP32
- **UI polling**: Replaced `setTimeout` with long-polling of `esp32Client.getCommand()`.
- **Result**: UI relies exclusively on ESP32 authority when `isDirectEsp32Enabled()` is true.

### C. COMMAND SYSTEM
- **Queue Semantics**: Commands are decoupled from HTTP loop, allowing 202 Accepted.
- **Idempotency**: Checked at the `command_mgr` layer.
- **Result**: Command system is robust.

### D. SAFETY
- **E-Stop Persistence**: Stored to NVS reliably.
- **Dry-run**: Enforced natively at HAL.
- **Result**: Highly secure physical safety boundaries.

### E. SCHEDULER
- **Device-Owned**: Firmware executes scheduling independent of frontend/browser states.
- **Device Time Authority**: Tied strictly to DS3231 RTC POSIX time.

### F. STORAGE / PERSISTENCE
- **NVS Integrity**: Token, E-Stop, and Schedules stored reliably.
- **microSD**: Events sent to SD with mutex protection.

### G. NETWORK
- **Fallback**: SoftAP gracefully handles WiFi loss.

### H. AUTHENTICATION
- **Bearer Token**: Properly injected across all mutating endpoints.

### I. TOPOLOGY
- **Phase 1 Validation**: Enforced via `validate_gh_id()` dynamically.

### J. SENSOR / ACTUATOR
- **Async DS18B20**: Removed RTOS blocking delays, increasing throughput.

### K. CROP CYCLE
- **Active State**: Handled natively by backend.

### L. CONCURRENCY
- **Mutexes**: Handled in storage layer and scheduler layer.

### M. POWER LOSS / REBOOT
- **Recovery**: E-stop status and schedule queue safely persist across sudden reboots.

### N. RESOURCE / LONG-RUN
- **4KB Bound**: Solves potential JSON payload heap attacks.
