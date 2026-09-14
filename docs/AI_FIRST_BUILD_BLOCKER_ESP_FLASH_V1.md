# FIRST BUILD BLOCKER: esp_flash.h

## Issue
`fatal error: esp_flash.h: No such file or directory` during compilation of `esp32/main/main.c`.

## Root Cause
`main.c` includes `esp_flash.h` to use `esp_flash_get_size()`. In ESP-IDF v5.x, this header is part of the `spi_flash` component. However, the `main` component's `CMakeLists.txt` did not list `spi_flash` in its `REQUIRES` list, causing the compiler to fail to find the include directory.

## Resolution
Added `spi_flash` to the `REQUIRES` section of `esp32/main/CMakeLists.txt`.

## Verification
Running `idf.py build` confirmed that `main.c` compiles successfully past the `esp_flash.h` include, moving on to the next blocker in `http_server.h`.
