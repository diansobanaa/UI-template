import urllib.request
import json
import time

url_cal = "http://192.168.0.101/api/v1/calibration"
url_st = "http://192.168.0.101/api/v1/calibration/status"
url_stat = "http://192.168.0.101/api/v1/status"

body = json.dumps({"componentId": "pump_submersible", "type": "VOLUMETRIC", "duration_sec": 3}).encode()
req = urllib.request.Request(url_cal, data=body, headers={"Content-Type": "application/json"}, method="POST")

try:
    res = urllib.request.urlopen(req, timeout=2)
    print("START RES:", res.status, res.read().decode())
except Exception as e:
    print("START ERR:", e)

for i in range(12):
    time.sleep(0.5)
    r = urllib.request.urlopen(url_st)
    st = json.loads(r.read())["data"]
    r2 = urllib.request.urlopen(url_stat)
    act = json.loads(r2.read())["data"]["actuators"]
    print(f"t={i*0.5:.1f}s | state={st.get('state')} rem={st.get('remaining_sec')} | rawSubmersible={act.get('rawSubmersible')} comps={act.get('components')}")
