# FIRST BUILD BLOCKERS

| Error | Component | Severity | Fix Action |
|-------|-----------|----------|------------|
| `idf.py` not recognized | Environment | FATAL BLOCKER | Must install ESP-IDF v5.x toolchain on the workstation, or build via a Docker container (`espressif/idf`). |
| `cmake` not recognized | Environment | FATAL BLOCKER | Install CMake (handled by ESP-IDF installer). |
| `Include directory 'main/net' is not a directory` | CMake / Build | BLOCKER | Removed vestigial placeholders (`net`, `dto`, `util`) from `INCLUDE_DIRS` in `main/CMakeLists.txt`. |
| `fatal error: esp_flash.h: No such file or directory` | `main` | BLOCKER | Added missing `spi_flash` to `REQUIRES` in `main/CMakeLists.txt`. |
| `stray '\' in program` in `http_server.h` | `main/http` | BLOCKER | Removed literal `\n` characters injected by previous AI agent. |
| `implicit declaration of function 'unlink'` in `storage_mgr.c` | `main/storage` | BLOCKER | Included `<unistd.h>` to provide POSIX declaration for ESP-IDF's VFS. |
| `'sensor_readings_t' has no member named 'temp_valid'` | `main/services` | BLOCKER | Updated consumers (`telemetry_mgr.c`, `api_device_handlers.c`) to map `temp_state == SENSOR_STATE_VALID` to boolean. |
| `stray '\' in program` in `http_server.c` | `main/http` | BLOCKER | Removed literal `\n` characters injected by previous AI agent in `http_server.c` and `api_cropcycle_handlers.c`. |
| `redefinition of 'err'` in `api_command_handlers.c` | `main/http` | BLOCKER | Reused the existing `err` variable instead of redeclaring it. |

**Diagnosis:**
The build environment initially lacked the toolchain. After resolving toolchain presence, CMake configuration failed due to non-existent include directories (`net`, `dto`, `util`) left over from early scaffolding. After fixing CMake, compilation hit a missing dependency (`spi_flash`) for `esp_flash.h`. Resolving that revealed a literal syntax error (`\n`) in `http_server.h`. After fixing `http_server.h`, the compiler progressed to `storage_mgr.c` where it failed on an implicit declaration of `unlink()`, resolved by including `<unistd.h>`. It then hit a contract drift in `telemetry_mgr.c` where it tried to access a removed field `temp_valid`; fixed by mapping the new `temp_state` enum. The compiler then hit another instance of the stray `\n` literal syntax error in `http_server.c` and `api_cropcycle_handlers.c`. After fixing those literal newlines, compilation proceeded until halting on a variable redefinition error in `api_command_handlers.c`. Fixing this mechanical redefinition error allowed the compiler to link the entire firmware binary.

**Required Intervention:**
None. The firmware now builds successfully.
