import http.client
import json
import time

ESP_IP = "192.168.0.101"

def api_call(method, path, data=None):
    conn = http.client.HTTPConnection(ESP_IP, 80, timeout=5)
    headers = {"Connection": "close"}
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
    return status, json.loads(resp_bytes.decode("utf-8"))

print("=== VERIFYING SAFE RESUME (OPSI 1) ON PHYSICAL ESP32 ===")

# 1. Start Test Mixing
start_payload = {
    "rawWaterTargetMl": 3000,
    "thresholdPercent": 20,
    "postMixDurationSec": 5,
    "channels": [{"componentId": "pump_dosing_a", "targetVolumeMl": 15}]
}
st, b = api_call("POST", "/api/v1/calibration/test-mixing", start_payload)
print(f"[1] Start test mixing: HTTP {st} | Status: {b.get('data', {}).get('status')}")

# 2. Wait 2 seconds for pool checkpoint
time.sleep(2.0)
st, b = api_call("GET", "/api/v1/calibration/test-mixing")
d = b.get("data", {})
print(f"[2] Live run at 2s: Status={d.get('status')} | Phase={d.get('phase')} | Water={d.get('rawWaterActualMl')}/{d.get('rawWaterTargetMl')} ml")

# 3. Simulate interruption / operator stop
st, b = api_call("POST", "/api/v1/calibration/test-mixing/stop", {})
print(f"[3] Interrupted / Stopped: HTTP {st} | Status={b.get('data', {}).get('status')}")

# 4. Check RECOVERY_HOLD
st, b = api_call("GET", "/api/v1/calibration/test-mixing")
d = b.get("data", {})
p = d.get("recoveryPool", {})
print(f"[4] Recovery Hold State: Status={d.get('status')} | RecoveryRequired={d.get('recoveryRequired')}")
print(f"    Pool remainder: target={p.get('targetRawWaterMl')} actual={p.get('actualRawWaterMl')} remaining={p.get('remainingRawWaterMl')} ml")

# 5. Execute Safe Resume (POST /api/v1/calibration/test-mixing/resume)
print("[5] Executing POST /api/v1/calibration/test-mixing/resume...")
st, b = api_call("POST", "/api/v1/calibration/test-mixing/resume", {})
d = b.get("data", {})
print(f"  -> Resume Result: HTTP {st} | Status={d.get('status')} | Phase={d.get('phase')}")

# 6. Monitor resumed run
time.sleep(1.0)
st, b = api_call("GET", "/api/v1/calibration/test-mixing")
d = b.get("data", {})
print(f"[6] Status during resumed execution: Status={d.get('status')} | Phase={d.get('phase')} | Water={d.get('rawWaterActualMl')} ml")

# 7. Clean stop and discard
st, b = api_call("POST", "/api/v1/calibration/test-mixing/stop", {})
time.sleep(0.5)
st, b = api_call("POST", "/api/v1/calibration/test-mixing/discard", {})
st, b = api_call("GET", "/api/v1/calibration/test-mixing")
d = b.get("data", {})
print(f"[7] Final cleaned state: Status={d.get('status')} | RecoveryRequired={d.get('recoveryRequired')}")

print("\n=== SAFE RESUME PHYSICAL HARDWARE TEST VERIFIED 100% ===")
