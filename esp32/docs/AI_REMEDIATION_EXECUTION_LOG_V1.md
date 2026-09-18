# AI REMEDIATION EXECUTION LOG V1

## RG-HW-INIT
- **Findings**: BS-HW-001, BS-HW-002, BS-HW-003
- **Root causes**: Root Cause 2, Root Cause 3
- **Changed files**:
  - `esp32/main/config/pin_config.h`
  - `esp32/main/hal/hardware_registry.c`
- **Implementation summary**:
  - Moved `PIN_IN_FLOAT_LOWER` from 19 to 26 to avoid USB Native D- conflict.
  - Moved `PIN_MICROSD_CS` from 47 to 27 to avoid Octal PSRAM conflict.
  - Included `driver/spi_master.h` and initialized the SPI bus (SPI2_HOST) before calling sensor and actuator HAL initialization.
- **Tests**: NOT RUN (IDF not available).
- **Build**: NOT RUN (IDF not available).
- **Contract**: N/A
- **Regression**: NOT RUN
- **New findings**: None.
- **Open issues**: `idf.py` is not available in the current environment to verify compilation locally.
- **Safe Point**: SP-REMED-001
- **Git commit**: (pending)
