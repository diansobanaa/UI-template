from __future__ import annotations

import json
import os
import threading
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.server import Handler


class FakeESP32(BaseHTTPRequestHandler):
    requests = []
    respond_status = 200
    respond_json = {
        "requestId": "device-request",
        "data": {
            "commandId": "cmd-1",
            "status": "ACCEPTED",
        },
    }

    def log_message(self, fmt, *args):
        return

    def _send(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        FakeESP32.requests.append(("GET", self.path, None, dict(self.headers)))
        if self.path == "/api/v1/inventory":
            self._send(200, {"requestId": "r", "data": {"complexId": "complex-1", "inventoryVersion": 9, "components": [{"componentId": "PUMP-01"}]}})
        elif self.path == "/api/v1/configuration":
            self._send(200, {"requestId": "r", "data": {"payload": {"complexId": "complex-1", "version": 9, "components": [], "assignments": [], "schedules": [], "recipes": [], "topology": [], "settings": {}}}})
        else:
            self._send(404, {"error": {"code": "NOT_FOUND", "message": "not found"}})

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(size).decode())
        FakeESP32.requests.append(("POST", self.path, body, dict(self.headers)))
        if self.path == "/api/v1/commands":
            if body.get("payload", {}).get("type") == "EMERGENCY_STOP_REJECT":
                self._send(409, {"error": {"code": "EMERGENCY_STOP_ACTIVE", "message": "latched"}})
            else:
                self._send(FakeESP32.respond_status, FakeESP32.respond_json)
            return
        self._send(404, {"error": {"code": "NOT_FOUND", "message": "not found"}})


def start(server_cls, handler_cls):
    server = server_cls(("127.0.0.1", 0), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


class M10BackendProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.device, _ = start(ThreadingHTTPServer, FakeESP32)
        cls.device_url = f"http://127.0.0.1:{cls.device.server_address[1]}"
        os.environ["ESP32_API_BASE"] = cls.device_url
        cls.backend, _ = start(ThreadingHTTPServer, Handler)
        cls.backend_url = f"http://127.0.0.1:{cls.backend.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.backend.shutdown(); cls.backend.server_close()
        cls.device.shutdown(); cls.device.server_close()
        os.environ.pop("ESP32_API_BASE", None)

    def request(self, method, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = Request(self.backend_url + path, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
        try:
            with urlopen(req, timeout=3) as resp:
                return resp.status, json.loads(resp.read())
        except HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_command_proxy_unwraps_device_envelope(self):
        status, body = self.request("POST", "/api/complexes/complex-1/esp32/commands", {
            "commandId": "cmd-1", "type": "COMPONENT_TIMED", "targetComplexId": "complex-1",
        })
        self.assertEqual(status, 200)
        self.assertEqual(body["commandId"], "cmd-1")
        self.assertNotIn("data", body)
        last = FakeESP32.requests[-1]
        self.assertEqual(last[1], "/api/v1/commands")
        self.assertEqual(last[2]["payload"]["commandId"], "cmd-1")
        self.assertEqual(last[2]["client"]["type"], "PythonBackend")

    def test_command_proxy_preserves_device_safety_rejection(self):
        status, body = self.request("POST", "/api/complexes/complex-1/esp32/commands", {
            "commandId": "cmd-2", "type": "EMERGENCY_STOP_REJECT", "targetComplexId": "complex-1",
        })
        self.assertEqual(status, 409)
        self.assertEqual(body["error"]["code"], "EMERGENCY_STOP_ACTIVE")

    def test_inventory_proxy_unwraps_payload(self):
        status, body = self.request("GET", "/api/complexes/complex-1/esp32/inventory")
        self.assertEqual(status, 200)
        self.assertEqual(body["inventoryVersion"], 9)
        self.assertEqual(body["components"][0]["componentId"], "PUMP-01")

    def test_configuration_proxy_unwraps_nested_payload(self):
        status, body = self.request("GET", "/api/complexes/complex-1/esp32/configuration")
        self.assertEqual(status, 200)
        self.assertEqual(body["complexId"], "complex-1")
        self.assertEqual(body["version"], 9)

    def test_complex_mismatch_is_rejected_before_device_call(self):
        before = len(FakeESP32.requests)
        status, body = self.request("POST", "/api/complexes/complex-1/esp32/commands", {
            "commandId": "cmd-3", "type": "COMPONENT_TIMED", "targetComplexId": "complex-2",
        })
        self.assertEqual(status, 409)
        self.assertEqual(body["error"]["code"], "COMPLEX_MISMATCH")
        self.assertEqual(len(FakeESP32.requests), before)

    def test_command_is_not_falsely_accepted_when_device_target_is_unconfigured(self):
        previous = os.environ.pop("ESP32_API_BASE", None)
        try:
            status, body = self.request("POST", "/api/complexes/complex-1/esp32/commands", {
                "commandId": "cmd-offline", "type": "COMPONENT_TIMED", "targetComplexId": "complex-1",
            })
        finally:
            if previous is not None:
                os.environ["ESP32_API_BASE"] = previous
        self.assertEqual(status, 503)
        self.assertEqual(body["error"]["code"], "DEVICE_OFFLINE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
