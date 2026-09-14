# FIRST BUILD BLOCKER: storage_mgr.c unlink()

## Issue
```
D:/template/esp32/main/storage/storage_mgr.c:206:9: error: implicit declaration of function 'unlink' [-Wimplicit-function-declaration]
```

## Root Cause
The `storage_mgr_append_event_log` function implements file rotation by deleting `/sdcard/events.log` using the POSIX `unlink()` function. However, the standard header `<unistd.h>` which provides the declaration for `unlink()` was not included in `storage_mgr.c`.

## Evidence
- `storage_mgr.c` includes `<stdio.h>` and `<sys/stat.h>`, but `<unistd.h>` was missing.
- The path being unlinked is `/sdcard/events.log`, which relies on ESP-IDF's VFS (Virtual File System) and FATFS layers.
- ESP-IDF v5.5.5 provides `unlink()` via newlib's POSIX compatibility layer in `<unistd.h>`.

## Owning API/Header
Header: `<unistd.h>`
Component: `newlib` / `vfs` (provided by default in ESP-IDF system).

## Required Component/Dependency
No CMake changes needed. The `vfs` and `fatfs` components are already declared as `REQUIRES` in `main/CMakeLists.txt`.

## Minimal Fix
Added `#include <unistd.h>` to `esp32/main/storage/storage_mgr.c`.

## Semantic Impact
Zero. The behavior of `unlink()` remains exactly the same; we only provided the missing compiler declaration.

## Build Result
Running `idf.py build` confirmed `storage_mgr.c` compiles successfully.

## Next Blocker
The compiler halted at `telemetry_mgr.c` with the following error:
```
D:/template/esp32/main/services/telemetry_mgr.c:35:40: error: 'sensor_readings_t' has no member named 'temp_valid'
```

## SAFE POINT
FIRST-BUILD-BLOCKER-storage-unlink
