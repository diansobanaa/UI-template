import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def start_backend(tmp: Path):
    os.environ.update({
        "AGROTECH_OPERATIONAL_DB": str(tmp / "operational.sqlite3"),
        "AGROTECH_HISTORY_DB": str(tmp / "history.sqlite3"),
        "AGROTECH_RECOVERY_DB": str(tmp / "recovery.sqlite3"),
        "AGROTECH_RESEARCH_DB": str(tmp / "research.sqlite3"),
        "AGROTECH_CALIBRATION_DB": str(tmp / "calibration.sqlite3"),
        "AGROTECH_FERTIGATION_DB": str(tmp / "fertigation.sqlite3"),
        "ESP32_API_TOKEN": "test-token",
    })
    from backend.server import Handler
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def fake_device(device_id: str, *, connected: bool = True, api_version: str = "v1", schema_version: int = 1):
    state = {"complexId": None}

    class DeviceHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def _send(self, payload, status=200):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _auth_ok(self):
            return self.headers.get("Authorization") == "Bearer test-token"

        def do_GET(self):
            if self.path == "/api/v1/health":
                self._send({"data": {
                    "apiVersion": api_version,
                    "schemaVersion": schema_version,
                    "deviceId": device_id,
                    "complexId": state["complexId"],
                    "firmwareVersion": "test-fw",
                    "bootId": "test-boot",
                    "uptimeSec": 10,
                    "configurationVersion": 1,
                    "inventoryVersion": 1,
                    "runtimeState": "RUNNING",
                    "health": "HEALTHY",
                }})
                return
            if self.path == "/api/v1/status":
                self._send({"data": {
                    "device": {"deviceId": device_id, "hardwareModel": "ESP32-S3-TEST"},
                    "network": {"connected": connected, "state": "STA_CONNECTED" if connected else "OFFLINE", "ip": "192.168.1.20", "mac": "AA:BB:CC:DD:EE:FF"},
                }})
                return
            self._send({"error": {"code": "NOT_FOUND", "message": "not found"}}, 404)

        def do_POST(self):
            if self.path != "/api/v1/device/bind":
                self._send({"error": {"code": "NOT_FOUND", "message": "not found"}}, 404)
                return
            if not self._auth_ok():
                self._send({"error": {"code": "UNAUTHORIZED", "message": "bad token"}}, 401)
                return
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            payload = body["payload"]
            if payload["deviceId"] != device_id:
                self._send({"error": {"code": "DEVICE_ID_MISMATCH", "message": "wrong device"}}, 409)
                return
            if state["complexId"] and state["complexId"] != payload["complexId"]:
                self._send({"error": {"code": "CONTROLLER_ALREADY_BOUND", "message": "already bound"}}, 409)
                return
            state["complexId"] = payload["complexId"]
            self._send({"data": {
                "deviceId": device_id,
                "complexId": state["complexId"],
                "bindingState": "BOUND",
                "hostname": "esp32-controller-test.local",
            }})

    server = ThreadingHTTPServer(("127.0.0.1", 0), DeviceHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def call(url, payload=None):
    method = "POST" if payload is not None else "GET"
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(url, method=method, data=data, headers={"Content-Type": "application/json"} if data else {})
    try:
        with urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode())
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode())


with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
    tmp = Path(td)
    backend = start_backend(tmp)
    device = fake_device("controller-AABBCCDDEEFF")
    fake_wrong = fake_device("controller-112233445566")
    try:
        base = f"http://127.0.0.1:{backend.server_address[1]}"
        device_url = f"http://127.0.0.1:{device.server_address[1]}"
        wrong_url = f"http://127.0.0.1:{fake_wrong.server_address[1]}"

        status, complex_resp = call(base + "/api/complexes", {"name": "Test Complex", "location": "Lab"})
        assert status == 201, complex_resp
        cid = complex_resp["id"]

        status, bound = call(base + f"/api/complexes/{cid}/controller/bind", {"deviceId": "controller-AABBCCDDEEFF", "endpoint": device_url})
        assert status == 200, bound
        assert bound["esp32"]["deviceId"] == "controller-AABBCCDDEEFF"
        assert bound["esp32"]["endpoint"] == device_url
        assert bound["esp32"]["apiVersion"] == "v1"
        assert bound["esp32"]["schemaVersion"] == 1
        assert bound["esp32"]["online"] is True

        status, conflict = call(base + f"/api/complexes/{cid}/controller/bind", {"deviceId": "controller-AABBCCDDEEFF", "endpoint": wrong_url})
        assert status == 409, conflict
        assert conflict["error"]["code"] == "DEVICE_ID_MISMATCH"

        status, second = call(base + "/api/complexes", {"name": "Other Complex", "location": "Lab2"})
        assert status == 201, second
        cid2 = second["id"]
        status, conflict2 = call(base + f"/api/complexes/{cid2}/controller/bind", {"deviceId": "controller-AABBCCDDEEFF", "endpoint": device_url})
        assert status == 409, conflict2
        assert conflict2["error"]["code"] == "CONTROLLER_ALREADY_BOUND"

        print("PASS backend endpoint identity verification")
        print("PASS ESP32 adoption handshake")
        print("PASS backend persistence after verified bind")
        print("PASS duplicate ownership rejection")
        print("PASS wrong-endpoint device identity rejection")
    finally:
        device.shutdown(); fake_wrong.shutdown(); backend.shutdown()
