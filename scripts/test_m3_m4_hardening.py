#!/usr/bin/env python3
"""M3/M4 hardening software gate: backend proxy + durable deployment journal + source invariants."""
from __future__ import annotations
import json, os, socket, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]


def http_json(url, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(url, data=data, method=method, headers={"Content-Type":"application/json","Accept":"application/json"})
    try:
        with urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read().decode())
    except HTTPError as exc:
        try: payload=json.loads(exc.read().decode())
        except Exception: payload={"error":{"code":str(exc.code)}}
        return exc.code, payload

class FakeEspHandler(BaseHTTPRequestHandler):
    server_version = "FakeESP/1"
    config = {
        "complexId": "complex-01", "version": 7, "updatedAt": "2026-09-19T00:00:00Z",
        "components": [], "assignments": [], "schedules": [], "recipes": [], "topology": [], "settings": {},
    }
    previous_version = 6
    deployment_status = "ACTIVE"
    deployment_id = "seed-active"

    def log_message(self, *args): pass
    def _send(self, code, payload):
        raw=json.dumps(payload).encode(); self.send_response(code); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        if self.path == "/api/v1/configuration":
            self._send(200,{"data":{"configurationVersion":type(self).config["version"],"configurationHash":"abcd","inventoryVersion":type(self).config["version"],"schemaVersion":1,"deploymentStatus":self.deployment_status,"deploymentId":type(self).deployment_id,"previousConfigurationVersion":type(self).previous_version,"candidateConfigurationVersion":0,"payload":self.config}}); return
        if self.path == "/api/v1/configuration/deployment":
            self._send(200,{"data":{"status":self.deployment_status,"activeVersion":type(self).config["version"],"activeCrc":123,"candidateVersion":0,"previousVersion":type(self).previous_version,"deploymentId":type(self).deployment_id}}); return
        if self.path == "/api/v1/inventory": self._send(200,{"data":{"deviceId":"dev-01","complexId":"complex-01","inventoryVersion":type(self).config["version"],"components":type(self).config["components"]}}); return
        if self.path == "/api/v1/status": self._send(200,{"data":{"device":{"deviceId":"dev-01"},"configuration":{"version":type(self).config["version"]}}}); return
        self._send(404,{"error":{"code":"NOT_FOUND","message":"not found"}})
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0")); payload=json.loads(self.rfile.read(n).decode() or "{}")
        if self.path == "/api/v1/configuration/validate": self._send(200,{"data":{"valid":True,"inventoryVersion":type(self).config["version"],"issues":[]}}); return
        if self.path in ("/api/v1/configuration/deploy","/api/v1/configuration/rollback"):
            p=payload.get("payload",{})
            if self.path.endswith("rollback"):
                type(self).previous_version=type(self).config["version"]
                type(self).config=dict(type(self).config); type(self).config["version"] += 1; type(self).deployment_id="rollback"
            else:
                cfg=dict(p.get("configuration") or {})
                expected=int(p.get("expectedVersion",0))
                if expected != type(self).config["version"]:
                    self._send(409,{"error":{"code":"CONFLICT","message":"version conflict"}}); return
                type(self).previous_version=type(self).config["version"]; cfg["version"]=type(self).config["version"]+1; type(self).config=cfg; type(self).deployment_id=p.get("deploymentId") or "dep"
            self._send(200,{"data":{"configurationVersion":type(self).config["version"],"configurationHash":"abcd","inventoryVersion":type(self).config["version"],"schemaVersion":1,"deploymentStatus":"ACTIVE","deploymentId":type(self).deployment_id,"previousConfigurationVersion":type(self).previous_version,"payload":self.config}}); return
        self._send(404,{"error":{"code":"NOT_FOUND","message":"not found"}})
    def do_PUT(self):
        n=int(self.headers.get("Content-Length","0")); payload=json.loads(self.rfile.read(n).decode() or "{}")
        if self.path != "/api/v1/configuration": self._send(404,{"error":{"code":"NOT_FOUND","message":"not found"}}); return
        p=payload.get("payload",{}); cfg=dict(p.get("configuration") or {})
        if int(p.get("expectedVersion",0)) != type(self).config["version"]:
            self._send(409,{"error":{"code":"CONFLICT","message":"version conflict"}}); return
        type(self).previous_version=type(self).config["version"]; cfg["version"]=type(self).config["version"]+1; type(self).config=cfg; type(self).deployment_id=p.get("deploymentId") or "dep"
        self._send(200,{"data":{"configurationVersion":type(self).config["version"],"configurationHash":"abcd","inventoryVersion":type(self).config["version"],"schemaVersion":1,"deploymentStatus":"ACTIVE","deploymentId":type(self).deployment_id,"previousConfigurationVersion":type(self).previous_version,"payload":self.config}})


def free_port():
    s=socket.socket(); s.bind(("127.0.0.1",0)); p=s.getsockname()[1]; s.close(); return p

def run():
    # Source invariants
    cfg = (ROOT/"esp32/main/http/api_config_handlers.c").read_text()
    storage = (ROOT/"esp32/main/storage/storage_mgr.c").read_text()
    assert "storage_mgr_stage_candidate" in cfg
    assert "storage_mgr_activate_candidate" in cfg
    assert "storage_mgr_mark_candidate_failed" in cfg or "storage_mgr_mark_candidate_failed" in storage
    assert "handler_rollback_configuration" in cfg
    assert "active configuration was preserved" in cfg
    assert '"prev_json"' in storage and '"cand_json"' in storage
    assert '"dep_status"' in storage

    # Backend integration with fake ESP32
    esp_port=free_port(); be_port=free_port()
    esp=ThreadingHTTPServer(("127.0.0.1",esp_port),FakeEspHandler); threading.Thread(target=esp.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory() as td:
        env=os.environ.copy(); env.update({"ESP32_API_BASE":f"http://127.0.0.1:{esp_port}","HOST":"127.0.0.1","PORT":str(be_port),"AGROTECH_RECOVERY_DB":str(Path(td)/"recovery.sqlite3"),"AGROTECH_OPERATIONAL_DB":str(Path(td)/"operational.sqlite3"),"AGROTECH_HISTORY_DB":str(Path(td)/"history.sqlite3"),"AGROTECH_RESEARCH_DB":str(Path(td)/"research.sqlite3"),"AGROTECH_CALIBRATION_DB":str(Path(td)/"cal.sqlite3"),"AGROTECH_FERTIGATION_DB":str(Path(td)/"fert.sqlite3")})
        proc=subprocess.Popen([sys.executable,"-m","backend.server"],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            deadline=time.time()+8
            base=f"http://127.0.0.1:{be_port}"
            while time.time()<deadline:
                try: http_json(base+"/api/context"); break
                except Exception: time.sleep(.1)
            status,_=http_json(base+"/api/complexes",method="POST",body={"location":"test","id":"complex-01"})
            assert status==201,status
            cfg=dict(FakeEspHandler.config); cfg["complexId"]="complex-01"; cfg["version"]=7
            status,data=http_json(base+"/api/complexes/complex-01/esp32/configuration",method="PUT",body={**cfg,"expectedVersion":7,"deploymentId":"m34-test-001"})
            assert status==200,status; assert data["version"]==8, data
            status,data=http_json(base+"/api/complexes/complex-01/esp32/configuration/deployment")
            assert status==200, data
            assert data["status"]=="ACTIVE" and data["deploymentId"]=="m34-test-001", data
            status,data=http_json(base+"/api/complexes/complex-01/sync-snapshot")
            assert status==200,data
            assert data["deployment"]["status"]=="ACTIVE",data
            assert data["deployment"]["deploymentId"]=="m34-test-001",data
            # Explicit deployment route keeps the same transactional contract.
            cfg8=dict(cfg); cfg8["version"]=8; cfg8["settings"]={"source":"deploy-endpoint"}
            status,data=http_json(base+"/api/complexes/complex-01/esp32/configuration/deploy",method="POST",body={"configuration":cfg8,"expectedVersion":8,"deploymentId":"m34-test-002"})
            assert status==200 and data["version"]==9, data
            status,data=http_json(base+"/api/complexes/complex-01/esp32/configuration/rollback",method="POST",body={})
            assert status==200 and data["version"]==10, data
            # Conflict must not fallback/duplicate at backend layer.
            status,_=http_json(base+"/api/complexes/complex-01/esp32/configuration",method="PUT",body={**cfg,"expectedVersion":7,"deploymentId":"m34-test-conflict"})
            assert status==409,status
        finally:
            proc.terminate(); proc.wait(timeout=3); esp.shutdown(); esp.server_close()
    print("M3/M4 HARDENING GATE: PASS")

if __name__=="__main__": run()
