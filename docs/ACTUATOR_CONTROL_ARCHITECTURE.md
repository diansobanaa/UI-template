# Centralized Actuator Control Architecture

**Status:** Implemented and audited (2026-10-09)

## Authority

`esp32/main/hal/actuator_hal.c` is the only firmware module permitted to write
GPIO outputs assigned to actuators. It owns safe initialization, active-level
resolution, runtime state, ownership, emergency stop, and physical output
changes.

The public request boundary is:

```c
actuator_hal_request_component(component_id, on, source, reason);
actuator_hal_request(actuator_id, on, source, reason);
```

The older `actuator_hal_set*` functions remain compatibility entry points and
execute through the same HAL boundary. Service code must use the request
functions for new control operations. `actuator_hal_buzzer_set_raw()` is a
privileged alarm-manager path and remains inside the same HAL module.

## Audit result

The repository-wide audit found these actuator-capable physical paths:

- Compile-time outputs: well pump GPIO 1, distribution pump GPIO 2, raw
  submersible GPIO 4, dosing A/B GPIO 5/6, blower GPIO 10, buzzer GPIO 18,
  and mixing pump GPIO 40.
- Dynamic GPIO registry outputs: initialized, validated, and driven by
  `actuator_hal.c`.
- Startup safe-off: previously duplicated in `main.c`; now delegated to
  `actuator_hal_bootstrap_safe_off()`.
- Normal, scheduled, fertigation, transfer, calibration, manual, recovery,
  and emergency operations: routed through `actuator_hal.c`.
- Direct GPIO writes in DHT22, sensor, TFT, and MicroSD drivers are
  non-actuator peripheral operations.
- No PWM, MCPWM, or PCA9685 physical actuator writer exists. I2C actuator
  entries remain unsupported until a physical driver is implemented; they
  must not be reported as physically OFF solely from software state.

## Traceability and failure behavior

Every request through the authoritative API emits an `ACTUATOR_REQUEST` event
containing requested state, source, reason, result, and error code. Meaningful
state changes continue to emit transition events. Event persistence is
deferred by the existing bounded event ring and storage worker; a logging
failure cannot block or reject an actuator OFF operation.

The existing safety order is preserved: emergency-stop latch and safety
ownership, lifecycle/interlock checks, ownership, physical command, runtime
state, and telemetry/event notification. Repeated ON requests do not reset
the runtime start timestamp.

## Known limits

- GPIO writes cannot verify motor rotation; commanded state is not physical
  feedback.
- Dynamic I2C actuator output is not implemented and remains rejected.
- The alarm buzzer has a privileged pattern-engine path so emergency alarms
  can operate independently of ordinary actuator ownership.
- Physical wiring and polarity must still be verified against the hardware
  datasheet before connection.
