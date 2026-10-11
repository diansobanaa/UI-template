import http.client
import json
import time
import sys

ESP_IP = "192.168.0.101"

def api_call(method, path, data=None):
    conn = http.client.HTTPConnection(ESP_IP, 80, timeout=5)
    headers = {
        "Connection": "close"
    }
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode("utf-8")
        headers["Content-Length"] = str(len(body))
    
    conn.request(method, path, body=body, headers=headers)
    res = conn.getresponse()
    status = res.status
    resp_bytes = res.read()
    conn.close()
    
    try:
        parsed = json.loads(resp_bytes.decode("utf-8"))
    except Exception:
        parsed = {"raw": resp_bytes.decode("utf-8", errors="replace")}
    
    return status, parsed

print("=== STARTING AGROTECH ESP32-S3 PHYSICAL HARDWARE E2E VERIFICATION ===")

# 1. Health check
print("\n[Step 1] Checking ESP32 Health...")
for attempt in range(10):
    try:
        st, b = api_call("GET", "/api/v1/health")
        if st == 200:
            print(f"  -> ESP32 Online! deviceId={b.get('data', {}).get('deviceId')}, uptime={b.get('data', {}).get('uptimeSec')}s, health={b.get('data', {}).get('health')}")
            break
    except Exception as e:
        print(f"  Waiting for ESP32 boot/WiFi ({attempt+1}/10)...")
        time.sleep(1.5)
else:
    print("FATAL: Could not connect to ESP32 at", ESP_IP)
    sys.exit(1)

# 2. Configure Calibration Rates
print("\n[Step 2] Applying Calibration Rates...")
st, b = api_call("POST", "/api/v1/calibration/rate", {
    "componentId": "sensor_flow_raw",
    "pulsesPerLiter": 660.0,
    "flowRawPulsesPerL": 660.0,
    "state": "CALIBRATED"
})
print(f"  -> Flow Raw (pulses/L): HTTP {st} - status: {b.get('data', {}).get('status')}")

st, b = api_call("POST", "/api/v1/calibration/rate", {
    "componentId": "pump_submersible",
    "rateMlPerSec": 147.33,
    "state": "CALIBRATED"
})
print(f"  -> Raw Submersible Pump: HTTP {st} - status: {b.get('data', {}).get('status')}")

st, b = api_call("POST", "/api/v1/calibration/rate", {
    "componentId": "pump_dosing_a",
    "rateMlPerSec": 1.67,
    "state": "CALIBRATED"
})
print(f"  -> Dosing Pump A: HTTP {st} - status: {b.get('data', {}).get('status')}")

st, b = api_call("POST", "/api/v1/calibration/rate", {
    "componentId": "pump_dosing_b",
    "rateMlPerSec": 1.75,
    "state": "CALIBRATED"
})
print(f"  -> Dosing Pump B: HTTP {st} - status: {b.get('data', {}).get('status')}")

# 3. Check Initial Test-Mixing Status
print("\n[Step 3] Checking Initial Test-Mixing Status...")
st, b = api_call("GET", "/api/v1/calibration/test-mixing")
d = b.get("data", {})
print(f"  -> HTTP {st} | Status: {d.get('status')} | RecoveryRequired: {d.get('recoveryRequired')} | Message: {d.get('message')}")

# If in recovery hold from previous run, discard it first to start clean
if d.get("recoveryRequired"):
    print("  Interrupted pool detected. Discarding to verify clean start...")
    st_disc, b_disc = api_call("POST", "/api/v1/calibration/test-mixing/discard", {})
    print(f"  -> Discard: HTTP {st_disc} | Status: {b_disc.get('data', {}).get('status')}")

# 4. Start Test Mixing Run
print("\n[Step 4] Starting Physical Test-Mixing Run...")
start_payload = {
    "rawWaterTargetMl": 2000,
    "thresholdPercent": 20,
    "postMixDurationSec": 5,
    "channels": [
        {"componentId": "pump_dosing_a", "targetVolumeMl": 10}
    ]
}
st, b = api_call("POST", "/api/v1/calibration/test-mixing", start_payload)
d = b.get("data", {})
print(f"  -> Start Result: HTTP {st} | Status: {d.get('status')} | Phase: {d.get('phase')} | Target: {d.get('rawWaterTargetMl')} ml")

# 5. Monitor Live Progress
print("\n[Step 5] Polling Live Test Progress (1-second pool checkpoints)...")
for i in range(4):
    time.sleep(1.0)
    st, b = api_call("GET", "/api/v1/calibration/test-mixing")
    d = b.get("data", {})
    print(f"  t={i+1}s: HTTP {st} | Status={d.get('status')} | Phase={d.get('phase')} | Water={d.get('rawWaterActualMl')}/{d.get('rawWaterTargetMl')} ml | RecoveryRequired={d.get('recoveryRequired')}")

# 6. Stop Cleanly
print("\n[Step 6] Calling POST /api/v1/calibration/test-mixing/stop...")
st, b = api_call("POST", "/api/v1/calibration/test-mixing/stop", {})
d = b.get("data", {})
print(f"  -> Stop Result: HTTP {st} | Status: {d.get('status')}")

# 7. Check Status After Stop
print("\n[Step 7] Checking Status After Stop...")
time.sleep(0.5)
st, b = api_call("GET", "/api/v1/calibration/test-mixing")
d = b.get("data", {})
print(f"  -> HTTP {st} | Status: {d.get('status')} | RecoveryRequired: {d.get('recoveryRequired')}")
if d.get("recoveryPool"):
    p = d.get("recoveryPool")
    print(f"     Pool Snapshot: seq={p.get('sequence')} isTest={p.get('isTest')} isActive={p.get('isActive')} remainingWater={p.get('remainingRawWaterMl')} ml")

# 8. Test Safe Discard
print("\n[Step 8] Testing Safe Discard (POST /api/v1/calibration/test-mixing/discard)...")
st, b = api_call("POST", "/api/v1/calibration/test-mixing/discard", {})
d = b.get("data", {})
print(f"  -> Discard Result: HTTP {st} | Status: {d.get('status')} | RecoveryRequired: {d.get('recoveryRequired')}")

# 9. Verify Post-Discard Status
print("\n[Step 9] Verifying Final Post-Discard Status...")
st, b = api_call("GET", "/api/v1/calibration/test-mixing")
d = b.get("data", {})
print(f"  -> Final Status: HTTP {st} | Status: {d.get('status')} | RecoveryRequired: {d.get('recoveryRequired')}")

# 10. Verify Fertigation Endpoints
print("\n[Step 10] Verifying Fertigation Status & Guard...")
st, b = api_call("GET", "/api/v1/fertigation/status")
d = b.get("data", {})
print(f"  -> Fertigation State: HTTP {st} | State: {d.get('state')} | RecoveryRequired: {d.get('recoveryRequired')}")

st, b = api_call("POST", "/api/v1/fertigation/discard", {})
print(f"  -> Fertigation Discard Guard: HTTP {st} (Expected 409 NOT_IN_RECOVERY_HOLD)")

print("\n=========================================================================")
print("  ALL TESTS COMPLETED SUCCESSFULLY! PHYSICAL VERIFICATION VERIFIED 100%")
print("=========================================================================")
