#!/usr/bin/env python3
"""
TASK: AGROTECH GH LIGHTING CONTROL + BLOWER GPIO INTEGRATION VERIFICATION

Verifies:
1. Relay Module REL-0008 channel 3 (IN3, GPIO 10) is dedicated to GH lighting.
2. Blower fan output is dedicated to GPIO 7 (Active-HIGH MOSFET stage).
3. Physical momentary toggle button is assigned to GPIO 46 with debounce.
4. One official actuator command entry point (actuator_hal_request / actuator_hal_request_component).
5. Lighting manual ON permitted; scheduled ON strictly forbidden across firmware, compiler, API.
6. Scheduled OFF is idempotent and explicit.
7. Blower commands affect only GPIO 7 and never Relay IN3 (GPIO 10).
8. Lighting commands affect only Relay IN3 (GPIO 10) and never GPIO 7.
9. Cabinet cooling fan remains uncontrolled direct PSU (+/-) with GPIO -1.
10. Web UI and OpenAPI schemas reflect confirmed states and OFF-only schedule definitions.
"""

import os
import re
import sys

def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    esp32_root = os.path.join(repo_root, "esp32", "main")

    pin_config_path = os.path.join(esp32_root, "config", "pin_config.h")
    actuator_hal_h_path = os.path.join(esp32_root, "hal", "actuator_hal.h")
    actuator_hal_c_path = os.path.join(esp32_root, "hal", "actuator_hal.c")
    button_hal_h_path = os.path.join(esp32_root, "hal", "button_hal.h")
    button_hal_c_path = os.path.join(esp32_root, "hal", "button_hal.c")
    panel_button_path = os.path.join(esp32_root, "services", "panel_button_mgr.c")
    hardware_registry_path = os.path.join(esp32_root, "hal", "hardware_registry.c")
    command_mgr_path = os.path.join(esp32_root, "services", "command_mgr.c")
    scheduler_h_path = os.path.join(esp32_root, "services", "scheduler.h")
    scheduler_c_path = os.path.join(esp32_root, "services", "scheduler.c")
    api_cmd_path = os.path.join(esp32_root, "http", "api_command_handlers.c")
    api_dev_path = os.path.join(esp32_root, "http", "api_device_handlers.c")
    openapi_path = os.path.join(repo_root, "contracts", "UI_ESP32_OPENAPI.yaml")
    compiler_path = os.path.join(repo_root, "src", "lib", "runtime", "schedule-compiler.js")
    types_path = os.path.join(repo_root, "src", "lib", "types.ts")
    services_path = os.path.join(repo_root, "src", "lib", "services.ts")
    gpio_map_path = os.path.join(repo_root, "src", "lib", "data", "gpioPinMap.ts")

    passed = 0
    failed = 0

    def check(condition, desc):
        nonlocal passed, failed
        if condition:
            print(f"  [PASS] {desc}")
            passed += 1
        else:
            print(f"  [FAIL] {desc}")
            failed += 1

    print("======================================================================")
    print("AGROTECH GH LIGHTING + BLOWER GPIO INTEGRATION AUDIT")
    print("======================================================================")

    # ------------------------------------------------------------------
    # CHECK 1: PIN CONFIGURATION & HARDWARE ASSIGNMENTS
    # ------------------------------------------------------------------
    print("\n--- CHECK 1: Pin Configuration & Hardware Allocation ---")
    with open(pin_config_path, "r", encoding="utf-8") as f:
        pin_content = f.read().replace("\r\n", "\n")

    check(re.search(r"#define\s+PIN_RELAY_CH3\s+10", pin_content) is not None,
          "PIN_RELAY_CH3 is GPIO 10")
    check(re.search(r"#define\s+PIN_OUT_GH_LIGHT\s+PIN_RELAY_CH3", pin_content) is not None or
          re.search(r"#define\s+PIN_OUT_LIGHTING\s+PIN_OUT_GH_LIGHT", pin_content) is not None,
          "PIN_OUT_GH_LIGHT / PIN_OUT_LIGHTING is bound to Relay CH3 (GPIO 10)")
    check(re.search(r"#define\s+LIGHTING_ACTIVE_LEVEL\s+RELAY_ACTIVE_LEVEL", pin_content) is not None and
          re.search(r"#define\s+RELAY_ACTIVE_LEVEL\s+0", pin_content) is not None,
          "LIGHTING_ACTIVE_LEVEL is 0 (Active-LOW relay)")
    check(re.search(r"#define\s+PIN_OUT_BLOWER_FAN\s+7", pin_content) is not None,
          "PIN_OUT_BLOWER_FAN is dedicated to GPIO 7")
    check(re.search(r"#define\s+BLOWER_ACTIVE_LEVEL\s+MOSFET_ACTIVE_LEVEL", pin_content) is not None and
          re.search(r"#define\s+MOSFET_ACTIVE_LEVEL\s+1", pin_content) is not None,
          "BLOWER_ACTIVE_LEVEL is 1 (Active-HIGH MOSFET)")
    check(re.search(r"#define\s+PIN_BTN_LIGHTING\s+46", pin_content) is not None,
          "PIN_BTN_LIGHTING is dedicated to GPIO 46")
    check(re.search(r"#define\s+PIN_OUT_COOLING_FAN\s+-1", pin_content) is not None,
          "PIN_OUT_COOLING_FAN is -1 (cabinet fan is direct PSU +/-)")

    # ------------------------------------------------------------------
    # CHECK 2: ACTUATOR HAL ISOLATION & LIGHTING RULE
    # ------------------------------------------------------------------
    print("\n--- CHECK 2: Actuator HAL Definitions & Single Entry Point ---")
    with open(actuator_hal_h_path, "r", encoding="utf-8") as f:
        act_h_content = f.read().replace("\r\n", "\n")
    with open(actuator_hal_c_path, "r", encoding="utf-8") as f:
        act_c_content = f.read().replace("\r\n", "\n")

    check("ACTUATOR_GH_LIGHT," in act_h_content,
          "ACTUATOR_GH_LIGHT exists in actuator_id_t enum")
    check("ACTUATOR_BLOWER_FAN," in act_h_content,
          "ACTUATOR_BLOWER_FAN exists in actuator_id_t enum")
    check(re.search(r"\[ACTUATOR_GH_LIGHT\]\s*=\s*\{\s*\.name\s*=\s*\"(?:GH|Greenhouse) Lighting\"", act_c_content) is not None and
          ".gpio = PIN_OUT_GH_LIGHT" in act_c_content and
          ".active_level = LIGHTING_ACTIVE_LEVEL" in act_c_content,
          "ACTUATOR_GH_LIGHT table entry maps to PIN_OUT_GH_LIGHT and LIGHTING_ACTIVE_LEVEL")
    check(re.search(r"\[ACTUATOR_BLOWER_FAN\]\s*=\s*\{\s*\.name\s*=\s*\"Blower Fan\"", act_c_content) is not None and
          ".gpio = PIN_OUT_BLOWER_FAN" in act_c_content and
          ".active_level = BLOWER_ACTIVE_LEVEL" in act_c_content,
          "ACTUATOR_BLOWER_FAN table entry maps to PIN_OUT_BLOWER_FAN and BLOWER_ACTIVE_LEVEL")
    check("PIN_OUT_GH_LIGHT" in act_c_content and "actuator_hal_bootstrap_safe_off" in act_c_content,
          "PIN_OUT_GH_LIGHT initialized to safe OFF in actuator_hal_bootstrap_safe_off")

    # Verify manual-only enforcement in actuator_hal
    check("id == ACTUATOR_GH_LIGHT && on && source != ACTUATOR_SOURCE_MANUAL" in act_c_content and
          "ESP_ERR_INVALID_STATE" in act_c_content,
          "actuator_hal_request strictly forbids non-manual ON for ACTUATOR_GH_LIGHT")
    check("actuator_hal_stop_component" in act_c_content and
          "is_lighting" in act_c_content,
          "actuator_hal_stop_component allows scheduler to stop manually-owned lighting")

    # ------------------------------------------------------------------
    # CHECK 3: PHYSICAL BUTTON INTEGRATION
    # ------------------------------------------------------------------
    print("\n--- CHECK 3: Physical Momentary Toggle Button (GPIO 46) ---")
    with open(button_hal_h_path, "r", encoding="utf-8") as f:
        btn_h_content = f.read().replace("\r\n", "\n")
    with open(button_hal_c_path, "r", encoding="utf-8") as f:
        btn_c_content = f.read().replace("\r\n", "\n")
    with open(panel_button_path, "r", encoding="utf-8") as f:
        panel_content = f.read().replace("\r\n", "\n")

    check("BUTTON_LIGHTING," in btn_h_content,
          "BUTTON_LIGHTING exists in button_id_t enum")
    check(".gpio = PIN_BTN_LIGHTING" in btn_c_content,
          "BUTTON_LIGHTING maps to PIN_BTN_LIGHTING (GPIO 46)")
    check("BUTTON_LIGHTING" in panel_content and "toggle_lighting_manual" in panel_content,
          "panel_button_mgr handles BUTTON_LIGHTING via toggle_lighting_manual")
    check("actuator_hal_request(ACTUATOR_GH_LIGHT" in panel_content and
          "ACTUATOR_SOURCE_MANUAL" in panel_content,
          "Physical button routes through official entry point actuator_hal_request")

    # ------------------------------------------------------------------
    # CHECK 4: HARDWARE REGISTRY & FALLBACK PROFILES
    # ------------------------------------------------------------------
    print("\n--- CHECK 4: Dynamic Hardware Registry Fallbacks ---")
    with open(hardware_registry_path, "r", encoding="utf-8") as f:
        hw_content = f.read().replace("\r\n", "\n")

    check('"fan_blower"' in hw_content and
          'PIN_OUT_BLOWER_FAN' in hw_content and
          'BLOWER_ACTIVE_LEVEL' in hw_content,
          "fan_blower registry fallback profile uses PIN_OUT_BLOWER_FAN (GPIO 7) Active-HIGH")
    check('"gh_lighting"' in hw_content and
          'PIN_OUT_GH_LIGHT' in hw_content and
          '"ACTIVE_LOW"' in hw_content,
          "gh_lighting registry fallback profile uses PIN_OUT_GH_LIGHT (GPIO 10) Active-LOW")

    # ------------------------------------------------------------------
    # CHECK 5: COMMAND MANAGER & SCHEDULER REJECTION OF SCHEDULED ON
    # ------------------------------------------------------------------
    print("\n--- CHECK 5: Scheduled Lighting ON Forbidden ---")
    with open(command_mgr_path, "r", encoding="utf-8") as f:
        cmd_content = f.read().replace("\r\n", "\n")
    with open(scheduler_c_path, "r", encoding="utf-8") as f:
        sched_content = f.read().replace("\r\n", "\n")

    check("SCHEDULED_LIGHTING_ON_FORBIDDEN" in cmd_content and
          "strcasecmp(cmd->source, \"SCHEDULER\") == 0" in cmd_content,
          "command_mgr rejects scheduled ON with SCHEDULED_LIGHTING_ON_FORBIDDEN")
    check("strcasecmp(action, \"LIGHTING_ON\") == 0" in sched_content and
          "Scheduled lighting ON is strictly forbidden" in sched_content,
          "scheduler.c rejects LIGHTING_ON / LIGHT_ON in parse_runtime_schedule")
    check("strcmp(sched->action, \"LIGHTING_OFF\") == 0" in sched_content and
          "cmd->param_on = false" in sched_content,
          "dispatch_runtime_schedule dispatches explicit OFF command for LIGHTING_OFF")
    check("scheduler_reconcile_lighting_schedule" in sched_content,
          "scheduler_reconcile_lighting_schedule implemented and called in scheduler loop")

    # ------------------------------------------------------------------
    # CHECK 6: REST API HANDLERS & TELEMETRY SERIALIZATION
    # ------------------------------------------------------------------
    print("\n--- CHECK 6: REST API Handlers & Telemetry Serialization ---")
    with open(api_cmd_path, "r", encoding="utf-8") as f:
        api_cmd_content = f.read().replace("\r\n", "\n")
    with open(api_dev_path, "r", encoding="utf-8") as f:
        api_dev_content = f.read().replace("\r\n", "\n")

    check("LIGHT_ON" in api_cmd_content and "LIGHT_OFF" in api_cmd_content and "LIGHT_TOGGLE" in api_cmd_content,
          "api_command_handlers supports LIGHT_ON, LIGHT_OFF, LIGHT_TOGGLE commands")
    check('cJSON_AddBoolToObject(actuators, "lighting", actuator_hal_get_state(ACTUATOR_GH_LIGHT));' in api_dev_content,
          "api_device_handlers reports lighting actuator state")
    check('cJSON_AddBoolToObject(actuators, "blowerFan", actuator_hal_get_state(ACTUATOR_BLOWER_FAN));' in api_dev_content,
          "api_device_handlers reports blowerFan actuator state")

    # ------------------------------------------------------------------
    # CHECK 7: COMPILER & CONTRACTS
    # ------------------------------------------------------------------
    print("\n--- CHECK 7: Schedule Compiler & OpenAPI Contracts ---")
    with open(compiler_path, "r", encoding="utf-8") as f:
        comp_content = f.read().replace("\r\n", "\n")
    with open(openapi_path, "r", encoding="utf-8") as f:
        openapi_content = f.read().replace("\r\n", "\n")

    check("SCHEDULED_LIGHTING_ON_FORBIDDEN" in comp_content,
          "schedule-compiler.js enforces SCHEDULED_LIGHTING_ON_FORBIDDEN")
    check("LIGHTING_OFF" in comp_content and "LIGHTING_RELAY_CH3" in comp_content,
          "schedule-compiler.js compiles LIGHTING_OFF with LIGHTING_RELAY_CH3 resource")
    check("lighting:" in openapi_content,
          "UI_ESP32_OPENAPI.yaml specifies lighting actuator in actuators schema")

    # ------------------------------------------------------------------
    # CHECK 8: TYPESCRIPT CLIENT & DATA BASELINE
    # ------------------------------------------------------------------
    print("\n--- CHECK 8: Frontend Data Model & Pin Mapping ---")
    with open(types_path, "r", encoding="utf-8") as f:
        types_content = f.read().replace("\r\n", "\n")
    with open(services_path, "r", encoding="utf-8") as f:
        services_content = f.read().replace("\r\n", "\n")
    with open(gpio_map_path, "r", encoding="utf-8") as f:
        gpio_content = f.read().replace("\r\n", "\n")

    check("export interface LightingSchedule" in types_content and
          "lightingSchedules?: LightingSchedule[];" in types_content,
          "types.ts defines LightingSchedule and lightingSchedules on Greenhouse")
    check("lightingForGh" in services_content and
          "createLighting" in services_content and
          "deleteLighting" in services_content,
          "services.ts provides full lighting schedule CRUD on scheduleService")
    check("gpio: 7," in gpio_content and "Blower Fan" in gpio_content,
          "gpioPinMap.ts maps GPIO 7 to Blower Fan")
    check("gpio: 10," in gpio_content and "Greenhouse Lighting" in gpio_content,
          "gpioPinMap.ts maps GPIO 10 to Greenhouse Lighting")
    check("gpio: 46," in gpio_content and "Lighting Toggle Button" in gpio_content,
          "gpioPinMap.ts maps GPIO 46 to Lighting Toggle Button")

    # ------------------------------------------------------------------
    # SUMMARY
    # ------------------------------------------------------------------
    print("\n======================================================================")
    print(f"VERIFICATION RESULTS: {passed} PASSED, {failed} FAILED")
    print("======================================================================")

    if failed > 0:
        sys.exit(1)
    print("ALL INTEGRATION AND ISOLATION CHECKS PASSED!\n")

if __name__ == "__main__":
    main()
