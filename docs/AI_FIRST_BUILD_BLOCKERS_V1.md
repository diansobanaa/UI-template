# FIRST BUILD BLOCKERS

| Error | Component | Severity | Fix Action |
|-------|-----------|----------|------------|
| `idf.py` not recognized | Environment | FATAL BLOCKER | Must install ESP-IDF v5.x toolchain on the workstation, or build via a Docker container (`espressif/idf`). |
| `cmake` not recognized | Environment | FATAL BLOCKER | Install CMake (handled by ESP-IDF installer). |

**Diagnosis:**
The build environment is completely devoid of the Espressif toolchain. No C/C++ compilation can occur locally. 

**Required Intervention:**
The maintainer/developer must execute `idf.py build` manually on their local machine where the ESP-IDF environment is properly exported (e.g., `export.bat` or `export.ps1` has been run).
