#!/usr/bin/env python3
"""
TASK #8 - SURGICAL BUZZER / ALARM FIX VALIDATION SUITE
Verifies all 9 test requirements (A-I), GPIO 18 single-ownership, and code invariants.
"""

import os
import re
import sys

def verify_codebase():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    esp32_root = os.path.join(repo_root, "esp32", "main")
    
    actuator_hal_path = os.path.join(esp32_root, "hal", "actuator_hal.c")
    alarm_mgr_path = os.path.join(esp32_root, "services", "alarm_mgr.c")
    safety_mon_path = os.path.join(esp32_root, "services", "safety_monitor.c")
    command_mgr_path = os.path.join(esp32_root, "services", "command_mgr.c")
    
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
    print("TASK #8: SURGICAL BUZZER / ALARM VERIFICATION")
    print("======================================================================")

    # 1. Inspect actuator_hal.c
    with open(actuator_hal_path, "r", encoding="utf-8") as f:
        hal_content = f.read()

    print("\n--- CHECK 1: GPIO 18 Authorship in actuator_hal.c ---")
    # Verify actuator_hal_emergency_stop does NOT write to GPIO 18
    estop_match = re.search(r"void actuator_hal_emergency_stop\(void\)\s*\{(.*?)\n\}", hal_content, re.DOTALL)
    check(estop_match is not None, "Found actuator_hal_emergency_stop")
    if estop_match:
        estop_body = estop_match.group(1)
        check("ACTUATOR_BUZZER" not in estop_body or "if (i == ACTUATOR_BUZZER) continue;" in estop_body,
              "actuator_hal_emergency_stop skips ACTUATOR_BUZZER in actuator shutdown loop")
        check("s_actuators[ACTUATOR_BUZZER].state = true" not in estop_body,
              "actuator_hal_emergency_stop does NOT force buzzer state true")
        check("gpio_set_level(s_actuators[ACTUATOR_BUZZER]" not in estop_body,
              "actuator_hal_emergency_stop does NOT write directly to buzzer GPIO")

    # Verify actuator_hal_resume does NOT force buzzer LOW
    resume_match = re.search(r"void actuator_hal_resume\(void\)\s*\{(.*?)\n\}", hal_content, re.DOTALL)
    check(resume_match is not None, "Found actuator_hal_resume")
    if resume_match:
        resume_body = resume_match.group(1)
        check("s_actuators[ACTUATOR_BUZZER].state = false" not in resume_body,
              "actuator_hal_resume does NOT directly reset buzzer state")
        check("gpio_set_level(s_actuators[ACTUATOR_BUZZER]" not in resume_body,
              "actuator_hal_resume does NOT write directly to buzzer GPIO")

    # Verify actuator_hal_set blocks ACTUATOR_BUZZER
    set_match = re.search(r"esp_err_t actuator_hal_set\(actuator_id_t id, bool on\)\s*\{(.*?)\n\}", hal_content, re.DOTALL)
    check(set_match is not None, "Found actuator_hal_set")
    if set_match:
        set_body = set_match.group(1)
        check("if (id == ACTUATOR_BUZZER)" in set_body and "ESP_ERR_NOT_SUPPORTED" in set_body,
              "actuator_hal_set explicitly blocks ACTUATOR_BUZZER with ESP_ERR_NOT_SUPPORTED")

    # Verify actuator_hal_set_by_component_id blocks buzzer_alarm
    set_comp_match = re.search(r"esp_err_t actuator_hal_set_by_component_id\(const char \*component_id, bool on\)\s*\{(.*?)\n\}", hal_content, re.DOTALL)
    check(set_comp_match is not None, "Found actuator_hal_set_by_component_id")
    if set_comp_match:
        set_comp_body = set_comp_match.group(1)
        check("gpio == PIN_OUT_BUZZER" in set_comp_body and "ESP_ERR_NOT_SUPPORTED" in set_comp_body,
              "actuator_hal_set_by_component_id explicitly blocks PIN_OUT_BUZZER with ESP_ERR_NOT_SUPPORTED")

    # Verify stop_component and force_off guard against GPIO 18
    check("if (info.wiring.gpio != PIN_OUT_BUZZER)" in hal_content,
          "actuator_hal_stop_component and force_off guard against PIN_OUT_BUZZER")

    # 2. Inspect safety_monitor.c
    with open(safety_mon_path, "r", encoding="utf-8") as f:
        safety_content = f.read()

    print("\n--- CHECK 2: TANK_LOW Buzzer Removal & Alarm Resolutions ---")
    # Verify TANK_LOW does NOT call alarm_mgr_raise
    check('alarm_mgr_raise(ALARM_PRIO_SAFETY_FAULT, "TANK_LOW"' not in safety_content,
          "safety_monitor.c does NOT raise TANK_LOW in alarm_mgr")
    check('if (strcmp(fault_code, "TANK_LOW") != 0)' in safety_content,
          "safety_set_fault explicitly excludes TANK_LOW from audible alarms")

    # Verify safety logic for TANK_LOW remains intact
    check('actuator_hal_force_off_component(info.component_id)' in safety_content and
          'safety_set_fault("TANK_LOW"' in safety_content,
          "TANK_LOW pump shutdown and safety fault state are preserved")

    # Verify FLOW_TIMEOUT and ACTUATOR_MAX_RUNTIME resolution in recovery
    req_rec_match = re.search(r"esp_err_t safety_monitor_request_recovery\(.*?\)\s*\{(.*?)\n\}", safety_content, re.DOTALL)
    check(req_rec_match is not None, "Found safety_monitor_request_recovery")
    if req_rec_match:
        rec_body = req_rec_match.group(1)
        check('alarm_mgr_resolve("FLOW_TIMEOUT", NULL)' in rec_body,
              "safety_monitor_request_recovery resolves FLOW_TIMEOUT")
        check('alarm_mgr_resolve("ACTUATOR_MAX_RUNTIME", NULL)' in rec_body,
              "safety_monitor_request_recovery resolves ACTUATOR_MAX_RUNTIME")
        check('alarm_mgr_resolve("SAFETY_SENSOR_STALE", NULL)' in rec_body,
              "safety_monitor_request_recovery resolves SAFETY_SENSOR_STALE")

    # Verify component-specific recovery function
    comp_rec_match = re.search(r"esp_err_t safety_monitor_recover_component\(const char \*component_id.*?\)\s*\{(.*?)\n\}", safety_content, re.DOTALL)
    check(comp_rec_match is not None, "safety_monitor_recover_component is implemented")
    if comp_rec_match:
        comp_rec_body = comp_rec_match.group(1)
        check('alarm_mgr_resolve("FLOW_TIMEOUT", component_id)' in comp_rec_body,
              "safety_monitor_recover_component resolves FLOW_TIMEOUT with specific component_id")
        check('alarm_mgr_resolve("ACTUATOR_MAX_RUNTIME", component_id)' in comp_rec_body,
              "safety_monitor_recover_component resolves ACTUATOR_MAX_RUNTIME with specific component_id")

    # 3. Inspect alarm_mgr.c
    with open(alarm_mgr_path, "r", encoding="utf-8") as f:
        alarm_content = f.read()

    print("\n--- CHECK 3: buzzerAudible Semantics in alarm_mgr.c ---")
    audible_match = re.search(r"bool alarm_mgr_is_audible\(void\)\s*\{(.*?)\n\}", alarm_content, re.DOTALL)
    check(audible_match is not None, "Found alarm_mgr_is_audible")
    if audible_match:
        audible_body = audible_match.group(1)
        check("(s_current_pattern != ALARM_PATTERN_OFF) && !s_silenced" in audible_body,
              "alarm_mgr_is_audible evaluates (s_current_pattern != ALARM_PATTERN_OFF) && !s_silenced")
        check("s_buzzer_physical_on" not in audible_body,
              "alarm_mgr_is_audible does NOT rely on momentary pin phase s_buzzer_physical_on")

    sum_match = re.search(r"cJSON \*alarm_mgr_get_summary_json\(void\)\s*\{(.*?)\n\}", alarm_content, re.DOTALL)
    check(sum_match is not None, "Found alarm_mgr_get_summary_json")
    if sum_match:
        sum_body = sum_match.group(1)
        check('cJSON_AddBoolToObject(sum, "buzzerAudible", audible)' in sum_body,
              "alarm_mgr_get_summary_json reports audible pattern status in buzzerAudible")

    # 4. Check command_mgr.c for targeted RESUME
    with open(command_mgr_path, "r", encoding="utf-8") as f:
        cmd_content = f.read()

    print("\n--- CHECK 4: Command Manager RESUME Integration ---")
    check("safety_monitor_recover_component" in cmd_content,
          "command_mgr routes component-specific RESUME commands to safety_monitor_recover_component")

    print("\n======================================================================")
    print(f"VERIFICATION SUMMARY: {passed} PASSED, {failed} FAILED")
    print("======================================================================")
    return failed == 0

if __name__ == "__main__":
    success = verify_codebase()
    sys.exit(0 if success else 1)
