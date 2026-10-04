#!/usr/bin/env python3
"""
Test Suite for Simple Power-Loss Recovery: Well Pump & Fan/Blower
Validates on Physical ESP32-S3 Hardware according to User Specification Section 14:
1. Fan active schedule recovery (06:00-07:00, boot at 06:20 -> ON)
2. Well Pump active schedule recovery (06:00-07:00, boot at 06:20 -> ON)
3. Expired schedule (06:00-07:00, boot at 07:05 -> OFF)
4. Future schedule (08:00-09:00, boot at 07:30 -> OFF; at 08:00 -> ON)
5. Boundary conditions:
   - boot at exact start time (08:00:00) -> ON
   - boot at exact end time (08:30:00) -> OFF
6. Safety interlock preservation:
   - E-Stop engages -> OFF
   - Reboot during E-Stop -> stays OFF
   - Operator RESUME -> resumes ON
"""

import sys
import time
import json
import urllib.request
import urllib.error
import serial

ESP32_IP = "http://192.168.0.101"
COM_PORT = "COM3"

def http_req(method, endpoint, body=None, timeout=5):
    url = f"{ESP32_IP}{endpoint}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8")
        try:
            return e.code, json.loads(content)
        except Exception:
            return e.code, {"error": content}
    except Exception as e:
        return 0, {"error": str(e)}

def wait_for_esp32_online(timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        status, resp = http_req("GET", "/api/v1/telemetry", timeout=1.5)
        if status == 200 and resp.get("success"):
            return True
        time.sleep(0.5)
    return False

def reset_esp32_hardware():
    print("  [HW] Resetting ESP32 via RTS pin...")
    ser = serial.Serial()
    ser.port = COM_PORT
    ser.baudrate = 115200
    ser.timeout = 0.1
    ser.setDTR(False)
    ser.setRTS(False)
    ser.dtr = False
    ser.rts = False
    ser.open()
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.3)
    ser.setRTS(False)
    time.sleep(0.1)
    ser.close()
    time.sleep(3.5) # Wait for network drop and ESP32 bootloader
    if not wait_for_esp32_online(30):
        raise RuntimeError("ESP32 did not come back online after reset!")
    print("  [HW] ESP32 rebooted and online.")

def set_clock(iso_ts, tz="Asia/Jakarta"):
    payload = {
        "requestId": f"clk-{int(time.time()*1000)}",
        "payload": {
            "timestamp": iso_ts,
            "timezone": tz
        }
    }
    status, resp = http_req("POST", "/api/v1/clock-sync", payload)
    if status != 200:
        raise RuntimeError(f"Failed to sync clock to {iso_ts}: {status} {resp}")

def get_telemetry():
    status, resp = http_req("GET", "/api/v1/telemetry")
    if status != 200:
        raise RuntimeError(f"Failed to get telemetry: {status}")
    return resp.get("data", {})

def get_actuator_state(comp_id):
    telem = get_telemetry()
    for st in telem.get("componentStates", []):
        if st.get("componentId") == comp_id:
            return st.get("on", False)
    return False

def wait_actuator_state(comp_id, target_state, timeout=8):
    t0 = time.time()
    while time.time() - t0 < timeout:
        state = get_actuator_state(comp_id)
        if state == target_state:
            return state
        time.sleep(0.5)
    return get_actuator_state(comp_id)

def get_well_pump_status():
    status, resp = http_req("GET", "/api/v1/well-pump")
    if status != 200:
        raise RuntimeError(f"Failed to get well-pump: {status}")
    return resp.get("data", {})

def wait_well_pump_state(target_on, timeout=8):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = get_well_pump_status()
        if st.get("on") == target_on:
            return st.get("on")
        time.sleep(0.5)
    return get_well_pump_status().get("on", False)

def add_schedule_intent(intent):
    payload = {
        "requestId": f"sched-{int(time.time()*1000)}",
        "payload": {
            "item": intent
        }
    }
    status, resp = http_req("POST", "/api/v1/schedule-intents", payload)
    if status != 200:
        raise RuntimeError(f"Failed to add schedule intent {intent.get('id')}: {status} {resp}")

def delete_schedule_intent(intent_id):
    http_req("DELETE", f"/api/v1/schedule-intents/{intent_id}")

def resume_safety():
    body = {"requestId": f"res-{int(time.time()*1000)}", "payload": {"commandId": f"res-{int(time.time()*1000)}", "type": "RESUME_SYSTEM"}}
    http_req("POST", "/api/v1/commands", body)
    time.sleep(1.0)

def main():
    print("=" * 60)
    print("POWER-LOSS RECOVERY TEST: WELL PUMP & FAN/BLOWER")
    print("=" * 60)

    # Initial safety state clear
    resume_safety()

    # Clean test schedule intents if leftover
    for tid in ["test-fan-recovery", "test-wp-recovery", "test-wp-live"]:
        delete_schedule_intent(tid)

    # -------------------------------------------------------------
    # TEST 1: Fan Active Window Recovery (06:00 - 07:00, boot at 06:20)
    # -------------------------------------------------------------
    print("\n--- TEST 1: Fan Active Window Recovery ---")
    fan_intent = {
        "id": "test-fan-recovery",
        "ghId": "gh-muii7dtg",
        "componentId": "fan_cooling",
        "action": "FAN_TOGGLE",
        "type": "DAILY",
        "time": "06:00",
        "durationSec": 3600, # 1 hour: 06:00 to 07:00
        "daysOfWeek": 127,
        "enabled": True
    }
    add_schedule_intent(fan_intent)
    print("  Configured Fan schedule: 06:00 - 07:00 (duration: 3600s)")

    # Simulate power loss at 06:10, boot at 06:20
    set_clock("2026-10-05T06:20:00")
    print("  Set hardware clock to 06:20:00 (inside 06:00 - 07:00 window)")

    reset_esp32_hardware()

    fan_on = wait_actuator_state("fan_cooling", True, timeout=8)
    print(f"  Fan state after reboot: {'ON' if fan_on else 'OFF'}")
    assert fan_on == True, "TEST 1 FAILED: Fan should be ON after recovery in active window!"
    print("  [PASS] TEST 1: Fan recovered to ON state.")

    # Clean up fan intent
    delete_schedule_intent("test-fan-recovery")

    # -------------------------------------------------------------
    # TEST 2: Well Pump Active Window Recovery (06:00 - 07:00, boot at 06:20)
    # -------------------------------------------------------------
    print("\n--- TEST 2: Well Pump Active Window Recovery ---")
    wp_intent = {
        "id": "test-wp-recovery",
        "complexId": "complex-01",
        "componentId": "pump_well",
        "action": "WATER_PUMP",
        "kind": "wellPump",
        "type": "DAILY",
        "time": "06:00",
        "durationSec": 3600, # 1 hour: 06:00 to 07:00
        "daysOfWeek": 127,
        "enabled": True
    }
    add_schedule_intent(wp_intent)
    print("  Configured Well Pump schedule: 06:00 - 07:00 (duration: 3600s)")

    # Set clock to 06:20:00
    set_clock("2026-10-05T06:20:00")
    print("  Set hardware clock to 06:20:00")

    reset_esp32_hardware()

    wp_on = wait_well_pump_state(True, timeout=8)
    wp_st = get_well_pump_status()
    print(f"  Well Pump state after reboot: {'ON' if wp_on else 'OFF'} (state={wp_st.get('state')}, mode={wp_st.get('mode')})")
    assert wp_on == True, "TEST 2 FAILED: Well Pump should be ON after recovery in active window!"
    print("  [PASS] TEST 2: Well Pump recovered to ON state.")

    delete_schedule_intent("test-wp-recovery")

    # -------------------------------------------------------------
    # TEST 3: Expired Schedule (06:00 - 07:00, boot at 07:05)
    # -------------------------------------------------------------
    print("\n--- TEST 3: Expired Schedule (boot at 07:05) ---")
    expired_intent = {
        "id": "test-wp-recovery",
        "complexId": "complex-01",
        "componentId": "pump_well",
        "action": "WATER_PUMP",
        "kind": "wellPump",
        "type": "DAILY",
        "time": "06:00",
        "durationSec": 3600,
        "daysOfWeek": 127,
        "enabled": True
    }
    add_schedule_intent(expired_intent)
    print("  Configured schedule: 06:00 - 07:00")

    set_clock("2026-10-05T07:05:00")
    print("  Set hardware clock to 07:05:00 (past 07:00 end)")

    reset_esp32_hardware()

    wp_on = wait_well_pump_state(False, timeout=8)
    wp_st = get_well_pump_status()
    print(f"  Well Pump state after reboot: {'ON' if wp_on else 'OFF'} (state={wp_st.get('state')})")
    assert wp_on == False, "TEST 3 FAILED: Well Pump must be OFF for expired schedule!"
    print("  [PASS] TEST 3: Actuator correctly remains OFF for expired schedule.")

    delete_schedule_intent("test-wp-recovery")

    # -------------------------------------------------------------
    # TEST 4: Future Schedule (08:00 - 09:00, boot at 07:30)
    # -------------------------------------------------------------
    print("\n--- TEST 4: Future Schedule (boot at 07:30, schedule at 08:00) ---")
    future_intent = {
        "id": "test-wp-recovery",
        "complexId": "complex-01",
        "componentId": "pump_well",
        "action": "WATER_PUMP",
        "kind": "wellPump",
        "type": "DAILY",
        "time": "08:00",
        "durationSec": 3600,
        "daysOfWeek": 127,
        "enabled": True
    }
    add_schedule_intent(future_intent)
    print("  Configured Future schedule: 08:00 - 09:00")

    set_clock("2026-10-05T07:30:00")
    print("  Set hardware clock to 07:30:00")

    reset_esp32_hardware()

    wp_on = wait_well_pump_state(False, timeout=8)
    print(f"  Well Pump state after reboot: {'ON' if wp_on else 'OFF'}")
    assert wp_on == False, "TEST 4A FAILED: Well Pump must be OFF before future schedule start!"
    print("  [PASS] TEST 4A: Actuator is OFF for future schedule.")

    # Now simulate time reaching 08:00:02
    print("  Advancing clock to 08:00:02...")
    set_clock("2026-10-05T08:00:02")

    wp_on = wait_well_pump_state(True, timeout=8)
    print(f"  Well Pump state at 08:00:02: {'ON' if wp_on else 'OFF'}")
    assert wp_on == True, "TEST 4B FAILED: Normal scheduler must turn Well Pump ON when 08:00 arrives!"
    print("  [PASS] TEST 4B: Normal scheduler transitions actuator to ON at start time.")

    delete_schedule_intent("test-wp-recovery")

    # -------------------------------------------------------------
    # TEST 5: Exact End-Time Boundary Test
    # Condition: schedule_start <= now < schedule_end
    # -------------------------------------------------------------
    print("\n--- TEST 5: Exact Start/End Boundary Test ---")
    delete_schedule_intent("test-wp-recovery")
    boundary_intent = {
        "id": "test-wp-recovery",
        "complexId": "complex-01",
        "componentId": "pump_well",
        "action": "WATER_PUMP",
        "kind": "wellPump",
        "type": "DAILY",
        "time": "15:00",
        "durationSec": 1800, # 15:00 - 15:30
        "daysOfWeek": 127,
        "enabled": True
    }
    add_schedule_intent(boundary_intent)
    print("  Configured schedule: 15:00 - 15:30")

    # 5A: Boot at exact start time (15:00:00) -> ON
    set_clock("2026-10-05T15:00:00")
    print("  Set hardware clock to 15:00:00")
    reset_esp32_hardware()
    wp_on = wait_well_pump_state(True, timeout=8)
    print(f"  Well Pump state at exact start (15:00:00): {'ON' if wp_on else 'OFF'}")
    assert wp_on == True, "TEST 5A FAILED: Boot at exact start (15:00:00) must be ON!"
    print("  [PASS] TEST 5A: Exact start time (15:00:00) -> ON.")

    # 5B: Boot at exact end time (15:30:00) -> OFF
    set_clock("2026-10-05T15:30:00")
    print("  Set hardware clock to 15:30:00")
    reset_esp32_hardware()
    wp_on = wait_well_pump_state(False, timeout=8)
    print(f"  Well Pump state at exact end (15:30:00): {'ON' if wp_on else 'OFF'}")
    assert wp_on == False, "TEST 5B FAILED: Boot at exact end (15:30:00) must be OFF!"
    print("  [PASS] TEST 5B: Exact end time (15:30:00) -> OFF.")

    delete_schedule_intent("test-wp-recovery")

    # -------------------------------------------------------------
    # TEST 6: Safety Interlock Preservation
    # -------------------------------------------------------------
    print("\n--- TEST 6: Safety Interlock Preservation ---")
    active_intent = {
        "id": "test-wp-recovery",
        "complexId": "complex-01",
        "componentId": "pump_well",
        "action": "WATER_PUMP",
        "kind": "wellPump",
        "type": "DAILY",
        "time": "15:00",
        "durationSec": 1800,
        "daysOfWeek": 127,
        "enabled": True
    }
    add_schedule_intent(active_intent)
    set_clock("2026-10-05T15:15:00")
    print("  Set hardware clock to 15:15:00 (active window)")
    time.sleep(1.0)

    # Trigger emergency stop via REST API
    estop_payload = {
        "requestId": "estop-test",
        "payload": {
            "commandId": f"cmd-estop-{int(time.time()*1000)}",
            "reason": "Testing E-Stop interlock"
        }
    }
    http_req("POST", "/api/v1/commands/emergency-stop", estop_payload)
    print("  Emergency stop engaged.")

    wp_on = wait_well_pump_state(False, timeout=5)
    print(f"  Well Pump state under E-Stop: {'ON' if wp_on else 'OFF'}")
    assert wp_on == False, "TEST 6A FAILED: E-stop must immediately stop Well Pump despite active schedule!"
    print("  [PASS] TEST 6A: E-stop immediately stops Well Pump.")

    # Now reset board while E-Stop was engaged
    reset_esp32_hardware()

    # Recovery must NOT turn pump ON while E-stop is latched
    wp_on = wait_well_pump_state(False, timeout=5)
    print(f"  Well Pump state after reboot under E-Stop latch: {'ON' if wp_on else 'OFF'}")
    assert wp_on == False, "TEST 6B FAILED: E-stop latch must prevent recovery to ON!"
    print("  [PASS] TEST 6B: Safety interlock preserved across power loss.")

    # Clear emergency stop via validated operator recovery
    print("  Sending operator RESUME command...")
    set_clock("2026-10-05T15:15:00")  # SNTP may have resynced clock after reboot
    resume_safety()
    wp_on = wait_well_pump_state(True, timeout=8)
    print(f"  Well Pump state after operator RESUME: {'ON' if wp_on else 'OFF'}")
    assert wp_on == True, "TEST 6C FAILED: Well pump should resume ON after safety latch cleared!"
    print("  [PASS] TEST 6C: Well pump resumed ON after operator recovery.")

    # Final cleanup
    delete_schedule_intent("test-wp-recovery")
    time.sleep(1.0)

    print("\n" + "=" * 60)
    print("ALL 6 POWER-LOSS RECOVERY TEST SCENARIOS PASSED ON HARDWARE!")
    print("=" * 60)

if __name__ == "__main__":
    main()
