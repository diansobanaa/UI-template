# FIRST FLASH PHYSICAL CHECKLIST

These physical checks MUST be performed immediately upon flashing the firmware to the hardware for the first time.

### [ ] 1. Relay Polarization Test
- **Action**: Monitor relay module state immediately after boot (before any commands are sent).
- **Expectation**: All relays should be fully DE-ENERGIZED.
- **Fix if Failed**: If relays energize on boot, the module is Active-Low. Modify `ACTUATOR_LEVEL_ON` to `0` and `ACTUATOR_LEVEL_OFF` to `1` in `pin_config.h` and reflash.

### [ ] 2. Float Switch Logic Test
- **Action**: Manually manipulate the physical float switch. Check `/api/v1/telemetry` for `safety.dryRunProtectionActive`.
- **Expectation**: "Float Down" (Tank empty) triggers Dry Run Protection. Pump commands are rejected.
- **Fix if Failed**: Swap the hardware pin logic or invert the read condition in `actuator_hal.c`.

### [ ] 3. I2C RTC Sync
- **Action**: Check `GET /api/v1/health` and `GET /api/v1/clock` to verify uptime and exact timestamp.
- **Expectation**: System time is accurate immediately without internet connection.
- **Fix if Failed**: Check wiring on GPIO 8/9. Ensure battery is present in DS3231.

### [ ] 4. SD Card Mount
- **Action**: Insert SD Card. Trigger a command. Retrieve log.
- **Expectation**: Event is successfully written to `/sdcard/events.log`.
- **Fix if Failed**: Verify SPI wiring and CS on GPIO 27.

### [ ] 5. SoftAP Network Visibility
- **Action**: Disconnect router. Reboot ESP32.
- **Expectation**: SSID `AGROTECH-SETUP` is broadcasted.
- **Fix if Failed**: Check Wi-Fi antenna (if external).
