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

- Compile-time outputs: well pump GPIO 1 (Relay IN1), distribution pump GPIO 2 (Relay IN2), raw
  submersible GPIO 4 (MOSFET #1), dosing A/B GPIO 5/6 (MOSFET #2/3), greenhouse blower fan GPIO 7 (MOSFET #4),
  greenhouse lighting GPIO 10 (Relay IN3), buzzer GPIO 18 (MOSFET #5), and mixing pump GPIO 40 (Relay IN4).
- Physical momentary toggle button: GPIO 46 (internal pull-up, Active-LOW) debounced in firmware and routed
  strictly through `actuator_hal_request(ACTUATOR_GH_LIGHT, desired_on, ACTUATOR_SOURCE_MANUAL, "physical_button_toggle")`.
- Greenhouse Lighting Single Entry Point & Manual-ON Rule:
  All lighting control flows exclusively through `actuator_hal_request(ACTUATOR_GH_LIGHT, on, source, reason)`.
  Non-manual ON commands (`source != ACTUATOR_SOURCE_MANUAL`) are strictly rejected with `ESP_ERR_INVALID_STATE`.
  Scheduled ON is rejected across Web UI schedule compiler, REST API validation, and `command_mgr` (`SCHEDULED_LIGHTING_ON_FORBIDDEN`).
  Lighting schedules are strictly OFF-only (`LIGHTING_OFF`).
- Schedule Timeline & Table Architecture:
  `TodayScheduleTimeline.tsx` and `TimelineEngine.ts` fully support the dedicated `lighting` category (Lightbulb icon, violet tone, dedicated Relay IN3 channel).
  Schedules in the table and timeline match record-by-record: discrete OFF time blocks are evaluated deterministically per selected date without missing entries.
  Strict separation is enforced: Fan schedules (amber, `FAN_TOGGLE`, GPIO 7) and Lighting schedules (violet, `LIGHTING_OFF`, GPIO 10) never cross-render or cross-execute.
- Actuator Isolation:
  Lighting commands affect exclusively Relay IN3 (GPIO 10).
  Blower fan commands affect exclusively MOSFET Module #4 (GPIO 7).
  Cabinet fan is unassigned from MCU control (GPIO -1, direct PSU +/-).
- Command Routing & Contextual Greenhouse Metadata:
  Board-level / complex-wide actuators (such as `gh_lighting`, `pump_well`, and `buzzer_alarm` whose hardware assignments are complex-level without specific GH binding) accept commands originating from any greenhouse UI view containing contextual `targetGhId`. The firmware validation policy permits contextual `targetGhId` for board-level components and enforces strict GH presence only for commands requiring a specific GH zone (e.g. `CMD_TYPE_FERTIGATION_BATCH`). Greenhouse validation checks the canonical topology pool (`topology_pool_has_greenhouse`) as well as the active configuration payload. All command validation failures populate the command receipt with exact error codes and descriptions returned to the HTTP client.
- Lamp Status Reporting & Real-Time State Synchronization (Bug 17 Resolution):
  1. Dual-Indicator Display:
     - The UI displays two distinct pieces of information:
       a) Current confirmed lamp/relay state: `LAMP ON` (active energized), `LAMP OFF` (de-energized standby), `STATUS UNKNOWN` (controller unreachable/stale), or `SYNCING` (command in-flight).
       b) Available manual action permitted from that state: `Turn Lighting OFF` (when confirmed ON) or `Turn Lighting ON` (when confirmed OFF), disabled when status is unconfirmed/syncing.
     - Physical feedback disclosure: The reported status explicitly denotes the ESP32-reported relay contact state (Relay CH3 / GPIO 10, Active-LOW); physical illumination is disclosed as unverified without optical lux feedback sensors.
  2. Multi-Source Synchronization:
     - Firmware triggers `telemetry_mgr_trigger_transition("ACTUATOR_STATE_CHANGE")` upon any actuator state alteration (manual Web UI command, physical control-box momentary toggle button on GPIO 46, or scheduled OFF execution).
     - `telemetry_mgr_trigger_transition` immediately samples all actuator states into `s_snapshot` under `s_snap_mutex`, writes to the RAM ring buffer, and signals `telemetry_stream_task`.
     - `telemetry_stream_task` broadcasts an immediate WebSocket batch frame containing `actuators: { lighting, ghLighting, blowerFan, ... }`.
     - The frontend WebSocket receiver (`telemetry-stream.ts`) extracts `actuators` and updates `updateComplexRuntime(complexId, { actuators })`, propagating state to all subscribers in real-time (<50ms) without page refresh.
     - On page refresh or reconnect, `hydrateOperationalState` restores authoritative actuator states from `GET /api/v1/status`.
     - A 3-second resilient polling heartbeat (`esp32Client.getStatus()`) provides fallback synchronization if WebSockets are interrupted.
     - Command timestamp guards (`lastLightingCmdTimeRef`) eliminate race conditions and prevent stale out-of-order poll responses from reverting newer states.
- Dynamic GPIO registry outputs: initialized, validated, and driven by
  `actuator_hal.c`.
- Startup safe-off: previously duplicated in `main.c`; now delegated to
  `actuator_hal_bootstrap_safe_off()`. Drives Relay IN3 HIGH (safe OFF for active-LOW relay) and Blower GPIO 7 LOW (safe OFF for active-HIGH MOSFET).
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
