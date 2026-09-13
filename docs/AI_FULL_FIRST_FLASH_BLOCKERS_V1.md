# FIRST FLASH READINESS & BLOCKERS

## Readiness Gate
**Status:** READY_WITH_PHYSICAL_CHECKS

## Physical Verification Required (Post-Flash)
1. **Relay Logic Verification**: SP-REMED-003 implemented dynamic `activeLevel`. Physical relays must be tested immediately upon boot to determine if they are Active-Low or Active-High, and `ACTUATOR_LEVEL_ON` modified accordingly if incorrect.
2. **RTC I2C Communication**: Ensure DS3231 is correctly wired to GPIO 8/9 and successfully sets system time on boot.
3. **Strapping Pin Validations**: Verify GPIO 26 and 27 function correctly for float switch and microSD without disrupting ESP32-S3 safe boot thresholds.
4. **Network Provisioning**: SoftAP credentials currently hardcoded.

## Blockers
**There are NO software/source-code blockers.** The codebase is strictly compliant with Phase 1 design requirements.
