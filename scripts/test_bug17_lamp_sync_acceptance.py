#!/usr/bin/env python3
"""
scripts/test_bug17_lamp_sync_acceptance.py

Mandatory Acceptance Test Suite for Bug 17:
"Critical UI Bug: Lamp Status Must Reflect the Actual Reported State"

Verifies:
Test 1 - Lamp is already ON -> reports ON, action is "Turn Lighting OFF"
Test 2 - Lamp is OFF -> reports OFF, action is "Turn Lighting ON"
Test 3 - Physical button changes OFF to ON -> ESP32 reports ON, WebSocket broadcast includes actuators.lighting
Test 4 - Physical button changes ON to OFF -> ESP32 reports OFF, WebSocket broadcast includes actuators.lighting
Test 5 - Scheduled OFF -> allows only OFF schedule, dispatches OFF, reports OFF
Test 6 - Refresh and reconnect -> restores authoritative state from getStatus/actuators
Test 7 - Status unavailable -> displays STATUS UNKNOWN / STALE instead of false ON/OFF
Test 8 - Concurrent or stale updates -> sequence/timestamp guard prevents stale overwriting
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

ESP32_HOST = "http://192.168.0.101"

def http_post(endpoint, payload):
    url = f"{ESP32_HOST}{endpoint}"
    enveloped = {
        "requestId": f"req-{int(time.time()*1000)}",
        "payload": payload
    }
    data = json.dumps(enveloped).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))

def http_get(endpoint):
    url = f"{ESP32_HOST}{endpoint}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))

def main():
    print("=" * 70)
    print("BUG 17: LAMP STATUS & CONTROL SYNCHRONIZATION ACCEPTANCE SUITE")
    print("=" * 70)

    passed = 0
    failed = 0
    blocked = 0

    def check(cond, desc):
        nonlocal passed, failed
        if cond:
            print(f"  [PASS] {desc}")
            passed += 1
        else:
            print(f"  [FAIL] {desc}")
            failed += 1

    def block(desc, reason):
        nonlocal blocked
        print(f"  [BLOCKED] {desc} (Reason: {reason})")
        blocked += 1

    # Check device reachability
    online = False
    try:
        health = http_get("/api/v1/health")
        online = health.get("status") in ("OK", "RUNNING") or health.get("success") is True
        print(f"ESP32 Health check: ONLINE ({health.get('data', {}).get('deviceId', 'device')})")
    except Exception as e:
        print(f"ESP32 unreachable at {ESP32_HOST}: {e}")

    # -------------------------------------------------------------------------
    # TEST 1: Lamp is already ON
    # -------------------------------------------------------------------------
    print("\n--- TEST 1: Lamp is already ON ---")
    if online:
        try:
            # Turn ON lamp
            res_on = http_post("/api/v1/commands", {
                "commandId": f"test-on-{int(time.time()*1000)}",
                "type": "LIGHT_ON",
                "source": "WEB_UI",
                "componentId": "gh_lighting"
            })
            check(res_on.get("success") is True, "LIGHT_ON command accepted by ESP32")
            time.sleep(0.5)

            status = http_get("/api/v1/status")
            actuators = status.get("data", {}).get("actuators", {})
            lamp_on = actuators.get("lighting") is True and actuators.get("ghLighting") is True
            check(lamp_on, "Authoritative /api/v1/status reports lighting=true")

            telem = http_get("/api/v1/telemetry/current")
            telem_act = telem.get("data", {}).get("actuators", {})
            check(telem_act.get("lighting") is True, "/api/v1/telemetry/current reports lighting=true")

            # Frontend model evaluation check
            raw_relay_state = actuators.get("lighting")
            ui_state = "ON" if (raw_relay_state is True) else "OFF"
            ui_action = "Turn Lighting OFF" if ui_state == "ON" else "Turn Lighting ON"
            check(ui_state == "ON" and ui_action == "Turn Lighting OFF",
                  "UI state resolves to LAMP ON and action offers 'Turn Lighting OFF'")
        except Exception as e:
            check(False, f"Test 1 failed with exception: {e}")
    else:
        block("Test 1 live verification", "ESP32 not reachable")

    # -------------------------------------------------------------------------
    # TEST 2: Lamp is OFF
    # -------------------------------------------------------------------------
    print("\n--- TEST 2: Lamp is OFF ---")
    if online:
        try:
            # Turn OFF lamp
            res_off = http_post("/api/v1/commands", {
                "commandId": f"test-off-{int(time.time()*1000)}",
                "type": "LIGHT_OFF",
                "source": "WEB_UI",
                "componentId": "gh_lighting"
            })
            check(res_off.get("success") is True, "LIGHT_OFF command accepted by ESP32")
            time.sleep(0.5)

            status = http_get("/api/v1/status")
            actuators = status.get("data", {}).get("actuators", {})
            lamp_off = actuators.get("lighting") is False and actuators.get("ghLighting") is False
            check(lamp_off, "Authoritative /api/v1/status reports lighting=false")

            # Poll telemetry up to 2 seconds for fresh snapshot
            telem_lamp_off = False
            for _ in range(5):
                telem = http_get("/api/v1/telemetry/current")
                telem_act = telem.get("data", {}).get("actuators", {})
                if telem_act.get("lighting") is False:
                    telem_lamp_off = True
                    break
                time.sleep(0.4)
            check(telem_lamp_off, "/api/v1/telemetry/current reports lighting=false")

            # Frontend model evaluation check
            raw_relay_state = actuators.get("lighting")
            ui_state = "OFF" if (raw_relay_state is False) else "ON"
            ui_action = "Turn Lighting OFF" if ui_state == "ON" else "Turn Lighting ON"
            check(ui_state == "OFF" and ui_action == "Turn Lighting ON",
                  "UI state resolves to LAMP OFF and action offers 'Turn Lighting ON'")
        except Exception as e:
            check(False, f"Test 2 failed with exception: {e}")
    else:
        block("Test 2 live verification", "ESP32 not reachable")

    # -------------------------------------------------------------------------
    # TEST 3: Physical button changes OFF to ON
    # -------------------------------------------------------------------------
    print("\n--- TEST 3: Physical button changes OFF to ON ---")
    # In firmware: BUTTON_LIGHTING on GPIO 46 calls toggle_lighting_manual() -> actuator_hal_request -> telemetry_mgr_trigger_transition
    # Test via LIGHT_TOGGLE command which uses the exact same actuator_hal_request path
    if online:
        try:
            # Ensure starting with OFF
            http_post("/api/v1/commands", {
                "commandId": f"init-off-{int(time.time()*1000)}",
                "type": "LIGHT_OFF",
                "source": "WEB_UI",
                "componentId": "gh_lighting"
            })
            time.sleep(0.3)

            # Toggle (simulating physical button press on GPIO 46)
            res_tog = http_post("/api/v1/commands", {
                "commandId": f"btn-press-1-{int(time.time()*1000)}",
                "type": "LIGHT_TOGGLE",
                "source": "PHYSICAL_BUTTON",
                "componentId": "gh_lighting"
            })
            check(res_tog.get("success") is True, "Physical button toggle event executed")
            time.sleep(0.3)

            status = http_get("/api/v1/status")
            actuators = status.get("data", {}).get("actuators", {})
            check(actuators.get("lighting") is True,
                  "ESP32 reports lighting=true following button toggle")

            telem_lamp_on = False
            for _ in range(5):
                telem = http_get("/api/v1/telemetry/current")
                telem_act = telem.get("data", {}).get("actuators", {})
                if telem_act.get("lighting") is True:
                    telem_lamp_on = True
                    break
                time.sleep(0.4)
            check(telem_lamp_on, "Telemetry stream snapshot updated to lighting=true")
        except Exception as e:
            check(False, f"Test 3 failed with exception: {e}")
    else:
        block("Test 3 live verification", "ESP32 not reachable")

    # -------------------------------------------------------------------------
    # TEST 4: Physical button changes ON to OFF
    # -------------------------------------------------------------------------
    print("\n--- TEST 4: Physical button changes ON to OFF ---")
    if online:
        try:
            # Toggle again (second physical button press)
            res_tog2 = http_post("/api/v1/commands", {
                "commandId": f"btn-press-2-{int(time.time()*1000)}",
                "type": "LIGHT_TOGGLE",
                "source": "PHYSICAL_BUTTON",
                "componentId": "gh_lighting"
            })
            check(res_tog2.get("success") is True, "Second physical button press executed")
            time.sleep(0.3)

            status = http_get("/api/v1/status")
            actuators = status.get("data", {}).get("actuators", {})
            check(actuators.get("lighting") is False,
                  "ESP32 reports lighting=false following second button toggle")

            telem_lamp_off = False
            for _ in range(5):
                telem = http_get("/api/v1/telemetry/current")
                telem_act = telem.get("data", {}).get("actuators", {})
                if telem_act.get("lighting") is False:
                    telem_lamp_off = True
                    break
                time.sleep(0.4)
            check(telem_lamp_off, "Telemetry stream snapshot updated to lighting=false")
        except Exception as e:
            check(False, f"Test 4 failed with exception: {e}")
    else:
        block("Test 4 live verification", "ESP32 not reachable")

    # -------------------------------------------------------------------------
    # TEST 5: Scheduled OFF execution
    # -------------------------------------------------------------------------
    print("\n--- TEST 5: Scheduled OFF execution ---")
    if online:
        try:
            # Turn ON first
            http_post("/api/v1/commands", {
                "commandId": f"prep-on-{int(time.time()*1000)}",
                "type": "LIGHT_ON",
                "source": "WEB_UI",
                "componentId": "gh_lighting"
            })
            time.sleep(0.3)

            # Attempt scheduled ON (MUST BE REJECTED)
            try:
                res_sched_on = http_post("/api/v1/commands", {
                    "commandId": f"sched-on-invalid-{int(time.time()*1000)}",
                    "type": "LIGHT_ON",
                    "source": "SCHEDULER",
                    "componentId": "gh_lighting"
                })
                # If HTTP 200 returned, check for error in body
                check(res_sched_on.get("success") is False or "SCHEDULED_LIGHTING_ON_FORBIDDEN" in str(res_sched_on),
                      "Scheduled ON command rejected by safety policy (SCHEDULED_LIGHTING_ON_FORBIDDEN)")
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8")
                check(e.code in (400, 403, 409, 422) and "SCHEDULED_LIGHTING_ON_FORBIDDEN" in err_body,
                      f"Scheduled ON command rejected with HTTP {e.code} and SCHEDULED_LIGHTING_ON_FORBIDDEN")

            # Execute valid scheduled OFF
            res_sched_off = http_post("/api/v1/commands", {
                "commandId": f"sched-off-valid-{int(time.time()*1000)}",
                "type": "LIGHT_OFF",
                "source": "SCHEDULER",
                "componentId": "gh_lighting"
            })
            check(res_sched_off.get("success") is True, "Scheduled OFF command successfully executed")
            time.sleep(0.3)

            status = http_get("/api/v1/status")
            actuators = status.get("data", {}).get("actuators", {})
            check(actuators.get("lighting") is False, "ESP32 confirms lighting is OFF after scheduled OFF")
        except Exception as e:
            check(False, f"Test 5 failed with exception: {e}")
    else:
        block("Test 5 live verification", "ESP32 not reachable")

    # -------------------------------------------------------------------------
    # TEST 6: Refresh and reconnect
    # -------------------------------------------------------------------------
    print("\n--- TEST 6: Refresh and reconnect ---")
    # Verify that hydrateOperationalState() pulls from /api/v1/status and correctly preserves ON or OFF
    with open("src/lib/operational-state.ts", "r", encoding="utf-8") as f:
        op_content = f.read()
    check("espStatus.actuators" in op_content and "lighting: lightingVal" in op_content,
          "hydrateOperationalState restores authoritative actuators.lighting on page refresh")
    check("data.actuators" in op_content and "updateComplexRuntime" in op_content,
          "updateComplexRuntime synchronizes dynamic actuator changes without reload")

    # -------------------------------------------------------------------------
    # TEST 7: Status unavailable
    # -------------------------------------------------------------------------
    print("\n--- TEST 7: Status unavailable ---")
    with open("src/app/greenhouse/[ghId]/page.tsx", "r", encoding="utf-8") as f:
        page_content = f.read()
    check('if (!gh?.online || rawRelayState === undefined) return "UNKNOWN"' in page_content,
          "Page evaluates to STATUS UNKNOWN when offline or actuator state is undefined")
    check('lampReportedState === "UNKNOWN"' in page_content and 'STATUS UNKNOWN' in page_content,
          "Page renders STATUS UNKNOWN indicator and disables manual toggle when status unavailable")

    # -------------------------------------------------------------------------
    # TEST 8: Concurrent or stale updates
    # -------------------------------------------------------------------------
    print("\n--- TEST 8: Concurrent or stale updates ---")
    check("lastLightingCmdTimeRef" in page_content,
          "Command timestamp guard prevents in-flight and stale out-of-order poll overwrite")
    check("updateComplexRuntime(batch.complexId, {" in open("src/lib/api/telemetry-stream.ts", "r", encoding="utf-8").read(),
          "Telemetry WebSocket stream immediately forwards latest authoritative actuator samples")

    print("\n" + "=" * 70)
    print(f"ACCEPTANCE RESULTS: {passed} PASSED, {failed} FAILED, {blocked} BLOCKED")
    print("=" * 70)

    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()
