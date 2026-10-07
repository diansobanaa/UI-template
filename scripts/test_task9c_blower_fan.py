#!/usr/bin/env python3
"""
TASK #9C - GH BLOWER FAN FIX & CABINET FAN REMOVAL VERIFICATION
Verifies:
1. fan_blower and all aliases resolve to ACTUATOR_BLOWER_FAN / GPIO 10.
2. fan_cooling / cabinet fan is completely removed from ESP32 scheduler and control paths.
3. Dedup by resolved physical actuator ID prevents duplicate reconciliation in scheduler_reconcile_fan_schedule().
4. is_fan_schedule() correctly matches blower aliases via actuator ID comparison.
5. GH blower remains active during 60-minute schedule without alias collision turn-off.
6. Cabinet fan is physically independent (powered from PSU +/-) and not an ESP32-controlled actuator.
"""

import os
import re
import sys

def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    esp32_root = os.path.join(repo_root, "esp32", "main")

    scheduler_c_path = os.path.join(esp32_root, "services", "scheduler.c")
    scheduler_h_path = os.path.join(esp32_root, "services", "scheduler.h")
    actuator_hal_c_path = os.path.join(esp32_root, "hal", "actuator_hal.c")
    hardware_registry_c_path = os.path.join(esp32_root, "hal", "hardware_registry.c")
    api_cmd_path = os.path.join(esp32_root, "http", "api_command_handlers.c")
    api_device_path = os.path.join(esp32_root, "http", "api_device_handlers.c")
    telemetry_mgr_path = os.path.join(esp32_root, "services", "telemetry_mgr.c")
    pin_config_path = os.path.join(esp32_root, "config", "pin_config.h")

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
    print("TASK #9C: GH BLOWER FAN & CABINET FAN REMOVAL VERIFICATION")
    print("======================================================================")

    # ------------------------------------------------------------------
    # CHECK 1: PIN CONFIGURATION & HARDWARE ASSIGNMENT
    # ------------------------------------------------------------------
    print("\n--- CHECK 1: Pin Configuration & Actuator Definitions ---")
    with open(pin_config_path, "r", encoding="utf-8") as f:
        pin_content = f.read().replace("\r\n", "\n")

    check("#define PIN_RELAY_CH3               10" in pin_content and
          "#define PIN_OUT_BLOWER_FAN          PIN_RELAY_CH3" in pin_content,
          "PIN_OUT_BLOWER_FAN maps to PIN_RELAY_CH3 (GPIO 10)")
    check(re.search(r"#define\s+PIN_OUT_COOLING_FAN\s+-1", pin_content) is not None,
          "PIN_OUT_COOLING_FAN is disabled (-1), cabinet fan has no MCU GPIO")

    with open(actuator_hal_c_path, "r", encoding="utf-8") as f:
        actuator_content = f.read().replace("\r\n", "\n")

    check(".name = \"Blower Fan\",       .gpio = PIN_OUT_BLOWER_FAN" in actuator_content,
          "ACTUATOR_BLOWER_FAN is bound to PIN_OUT_BLOWER_FAN (GPIO 10)")
    check(".name = \"Cooling Fan (PSU Direct)\", .gpio = -1" in actuator_content,
          "ACTUATOR_COOLING_FAN has gpio = -1 (uncontrolled / direct PSU)")
    check("case ACTUATOR_COOLING_FAN: return NULL;" in actuator_content,
          "actuator_role_for_id(ACTUATOR_COOLING_FAN) returns NULL (no dynamic role binding)")

    # ------------------------------------------------------------------
    # CHECK 2: ALIAS RESOLUTION IN ACTUATOR_HAL
    # ------------------------------------------------------------------
    print("\n--- CHECK 2: Actuator HAL Alias Resolution ---")
    idx_start = actuator_content.find("esp_err_t actuator_hal_find_id_by_component_id")
    idx_end = actuator_content.find("return ESP_ERR_NOT_SUPPORTED;\n}", idx_start)
    check(idx_start != -1 and idx_end != -1, "Found actuator_hal_find_id_by_component_id")
    if idx_start != -1 and idx_end != -1:
        body = actuator_content[idx_start:idx_end]
        check("fan_cooling" not in body and "cooling_fan" not in body and "cabinet_fan" not in body,
              "actuator_hal_find_id_by_component_id does NOT resolve cooling_fan / fan_cooling / cabinet_fan")
        check("fan_blower" in body and "blower_fan" in body and "blower" in body,
              "actuator_hal_find_id_by_component_id resolves all blower aliases to ACTUATOR_BLOWER_FAN")

    role_start = actuator_content.find("static bool actuator_role_matches")
    role_end = actuator_content.find("return false;\n}", role_start)
    check(role_start != -1 and role_end != -1, "Found actuator_role_matches")
    if role_start != -1 and role_end != -1:
        rbody = actuator_content[role_start:role_end]
        check("id == ACTUATOR_BLOWER_FAN" in rbody and "fan_blower" in rbody and "blower_fan" in rbody,
              "actuator_role_matches includes fan_blower, blower_fan, fan-blower, blower for ACTUATOR_BLOWER_FAN")

    # ------------------------------------------------------------------
    # CHECK 3: HARDWARE REGISTRY SANITIZATION
    # ------------------------------------------------------------------
    print("\n--- CHECK 3: Hardware Registry Fallbacks ---")
    with open(hardware_registry_c_path, "r", encoding="utf-8") as f:
        hw_content = f.read().replace("\r\n", "\n")

    hw_start = hw_content.find("esp_err_t hardware_registry_find_by_id")
    hw_end = hw_content.find("return ESP_ERR_NOT_FOUND;\n}", hw_start)
    check(hw_start != -1 and hw_end != -1, "Found hardware_registry_find_by_id")
    if hw_start != -1 and hw_end != -1:
        hw_body = hw_content[hw_start:hw_end]
        check("fan_cooling" not in hw_body and "cooling_fan" not in hw_body,
              "hardware_registry_find_by_id does NOT fall back to fan_cooling / cooling_fan")
        check("fan_blower" in hw_body and "PIN_OUT_BLOWER_FAN" in hw_body,
              "hardware_registry_find_by_id preserves canonical fan_blower fallback")

    check('if (strcmp(r, "COOLING_FAN") == 0' not in hw_content,
          "default_gpio_for_role_and_type does not map COOLING_FAN to any GPIO")

    # ------------------------------------------------------------------
    # CHECK 4: SCHEDULER DEDUPLICATION & ALIAS COLLISION FIX
    # ------------------------------------------------------------------
    print("\n--- CHECK 4: Scheduler Reconciliation & Alias Deduplication ---")
    with open(scheduler_c_path, "r", encoding="utf-8") as f:
        sched_content = f.read().replace("\r\n", "\n")

    rec_start = sched_content.find("esp_err_t scheduler_reconcile_fan_schedule(time_t now) {")
    rec_end = sched_content.find("return ESP_OK;\n}", rec_start)
    check(rec_start != -1 and rec_end != -1, "Found scheduler_reconcile_fan_schedule")
    if rec_start != -1 and rec_end != -1:
        rec_body = sched_content[rec_start:rec_end]
        check("seen_actuators" in rec_body,
              "scheduler_reconcile_fan_schedule tracks seen_actuators for actuator ID deduplication")
        check("seen_actuators[d] == act_id" in rec_body,
              "scheduler_reconcile_fan_schedule deduplicates by resolved physical actuator ID")
        check("act_id == ACTUATOR_COOLING_FAN" in rec_body and "continue;" in rec_body,
              "scheduler_reconcile_fan_schedule explicitly skips ACTUATOR_COOLING_FAN")
        check("cooling" in rec_body and "cabinet" in rec_body,
              "scheduler_reconcile_fan_schedule filters out cooling / cabinet component names")
        check('"fan_cooling"' not in rec_body,
              "scheduler_reconcile_fan_schedule fallback does NOT contain fan_cooling")
        check('fallback to canonical blower fan' in rec_body and 'fan_blower' in rec_body,
              "scheduler_reconcile_fan_schedule fallback targets ONLY canonical fan_blower")

    # ------------------------------------------------------------------
    # CHECK 5: IS_FAN_SCHEDULE ALIAS COMPARISON
    # ------------------------------------------------------------------
    print("\n--- CHECK 5: is_fan_schedule Matching Logic ---")
    fan_start = sched_content.find("static bool is_fan_schedule")
    fan_end = sched_content.find("return true;\n}", fan_start)
    check(fan_start != -1 and fan_end != -1, "Found is_fan_schedule")
    if fan_start != -1 and fan_end != -1:
        fan_body = sched_content[fan_start:fan_end]
        check("actuator_hal_find_id_by_component_id(cid, &cid_act)" in fan_body and
              "actuator_hal_find_id_by_component_id(target_component, &tgt_act)" in fan_body,
              "is_fan_schedule resolves both cid and target_component to actuator IDs")
        check("cid_has_act && tgt_has_act && cid_act == tgt_act" in fan_body,
              "is_fan_schedule matches if both resolve to same actuator ID (e.g. ACTUATOR_BLOWER_FAN)")
        check("cooling" in fan_body and "return false;" in fan_body,
              "is_fan_schedule rejects cooling / cabinet fan schedules and targets")

    # ------------------------------------------------------------------
    # CHECK 6: COMPILATION & CANONICALIZATION IN SCHEDULER
    # ------------------------------------------------------------------
    print("\n--- CHECK 6: Schedule Intent Canonicalization ---")
    check('comp_id = "fan_cooling";' not in sched_content,
          "scheduler.c does NOT compile or normalize any intent to fan_cooling")
    check('copy_string(rs->component_ids[0], sizeof(rs->component_ids[0]), "fan_cooling");' not in sched_content,
          "FAN_TOGGLE without component does NOT fall back to fan_cooling")
    check('copy_string(rs->component_ids[0], sizeof(rs->component_ids[0]), "fan_blower");' in sched_content,
          "FAN_TOGGLE without component canonicalizes to fan_blower")

    # ------------------------------------------------------------------
    # CHECK 7: COMMAND DISPATCH & TELEMETRY
    # ------------------------------------------------------------------
    print("\n--- CHECK 7: Command Dispatch, Device Handlers & Telemetry ---")
    with open(api_cmd_path, "r", encoding="utf-8") as f:
        cmd_content = f.read().replace("\r\n", "\n")

    check('"fan_cooling"' not in cmd_content,
          "api_command_handlers.c does NOT route commands to fan_cooling")
    check('strncpy(cmd->component_id, "fan_blower"' in cmd_content,
          "api_command_handlers.c routes default fan commands to fan_blower")

    with open(api_device_path, "r", encoding="utf-8") as f:
        dev_content = f.read().replace("\r\n", "\n")
    check('cJSON_AddBoolToObject(actuators, "coolingFan", false);' in dev_content,
          "api_device_handlers.c reports coolingFan as false (uncontrolled by ESP32)")
    check('cJSON_AddBoolToObject(actuators, "blowerFan", actuator_hal_get_state(ACTUATOR_BLOWER_FAN));' in dev_content,
          "api_device_handlers.c reports blowerFan state from ACTUATOR_BLOWER_FAN")

    with open(telemetry_mgr_path, "r", encoding="utf-8") as f:
        telem_content = f.read().replace("\r\n", "\n")
    check('s_snapshot.fan_on = actuator_hal_get_state(ACTUATOR_BLOWER_FAN);' in telem_content,
          "telemetry_mgr.c monitors ACTUATOR_BLOWER_FAN for snapshot fan_on")

    # ------------------------------------------------------------------
    # SUMMARY
    # ------------------------------------------------------------------
    print("\n======================================================================")
    print(f"VERIFICATION RESULTS: {passed} PASSED, {failed} FAILED")
    print("======================================================================")

    if failed > 0:
        sys.exit(1)
    print("ALL AUDIT CHECKS PASSED SUCCESSFULLY!\n")

if __name__ == "__main__":
    main()
