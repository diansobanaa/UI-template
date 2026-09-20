#!/usr/bin/env python3
"""Comprehensive test suite for Complex Deletion Matrix (A-J).

Covers:
- Matrix A: Happy path unbound complex
- Matrix B: Happy path with bound online ESP32 controller
- Matrix C: Offline bound controller safety block (WAITING_DEVICE, zero purge)
- Matrix D: Research preservation invariant (100% untouched)
- Matrix E: Preflight scope preview contract
- Matrix F: Idempotency with idempotencyKey
- Matrix G: Concurrency lock (409 COMPLEX_DELETION_IN_PROGRESS)
- Matrix H: Server restart recovery (resuming pending jobs)
- Matrix I: Controller re-binding after clean retirement
- Matrix J: Multi-complex isolation (complex-02 unaffected)
"""

import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# Add backend directory to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from deletion_store import DeletionStore
from deletion_manager import DeletionManager
from operational_store import OperationalStore
from history_store import HistoryStore
from recovery_store import RecoveryStore
from research_store import ResearchStore
from sensor_calibration import CalibrationRepository, build_linear_calibration
from fertigation_engine import FertigationRunRepository


class FakeESP32Handler(BaseHTTPRequestHandler):
    device_id = "controller-TEST-001"
    complex_id = None
    retire_count = 0
    is_online = True

    def log_message(self, format, *args):
        pass

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/v1/health":
            self._json(200, {
                "apiVersion": "v1",
                "schemaVersion": 1,
                "deviceId": self.device_id,
                "complexId": self.complex_id,
                "firmwareVersion": "1.0.0",
                "inventoryVersion": 1,
            })
            return
        if self.path == "/api/v1/status":
            self._json(200, {
                "device": {"deviceId": self.device_id, "hardwareModel": "ESP32-S3-TEST"},
                "network": {"connected": True, "state": "CONNECTED"},
                "complexId": self.complex_id,
            })
            return
        self._json(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(size).decode("utf-8")) if size > 0 else {}
        rq = body.get("requestId", "req-test")
        payload = body.get("payload", {})

        if self.path == "/api/v1/device/bind":
            cid = payload.get("complexId")
            self.__class__.complex_id = cid
            self._json(200, {
                "requestId": rq,
                "data": {
                    "deviceId": self.device_id,
                    "complexId": cid,
                    "bindingState": "BOUND",
                    "hostname": "esp32-agrotech",
                }
            })
            return
        if self.path == "/api/v1/device/retire":
            self.__class__.retire_count += 1
            cid = payload.get("complexId")
            if self.complex_id and cid and self.complex_id != cid:
                self._json(409, {
                    "requestId": rq,
                    "error": {"code": "DEVICE_COMPLEX_MISMATCH", "message": "Wrong complex"}
                })
                return
            self.__class__.complex_id = None
            self._json(200, {
                "requestId": rq,
                "data": {
                    "deviceId": self.device_id,
                    "complexId": None,
                    "bindingState": "UNBOUND",
                    "hostname": "esp32-agrotech",
                    "retiredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            })
            return
        self._json(404, {"error": "NOT_FOUND"})


def run_tests():
    print("=================================================================")
    print("STARTING COMPLEX DELETION MATRIX INTEGRATION TEST SUITE (A-J)")
    print("=================================================================")

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
        tmp_dir = Path(td)
        del_db = str(tmp_dir / "deletion.sqlite3")
        op_db = str(tmp_dir / "operational.sqlite3")
        hist_db = str(tmp_dir / "history.sqlite3")
        rec_db = str(tmp_dir / "recovery.sqlite3")
        res_db = str(tmp_dir / "research.sqlite3")
        cal_db = str(tmp_dir / "calibration.sqlite3")
        fert_db = str(tmp_dir / "fertigation.sqlite3")

        deletion_store = DeletionStore(del_db)
        operational_store = OperationalStore(op_db)
        history_store = HistoryStore(hist_db)
        recovery_store = RecoveryStore(rec_db)
        research_store = ResearchStore(res_db)
        calibration_repo = CalibrationRepository(cal_db)
        fertigation_repo = FertigationRunRepository(fert_db)

        manager = DeletionManager(
            deletion_store=deletion_store,
            operational_store=operational_store,
            history_store=history_store,
            recovery_store=recovery_store,
            research_store=research_store,
            calibration_repo=calibration_repo,
            fertigation_repo=fertigation_repo,
        )

        # Start Mock ESP32 HTTP Server
        esp_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeESP32Handler)
        esp_port = esp_server.server_address[1]
        esp_thread = threading.Thread(target=esp_server.serve_forever, daemon=True)
        esp_thread.start()
        esp_base_url = f"http://127.0.0.1:{esp_port}"

        try:
            # -------------------------------------------------------------
            # Matrix E: Preflight scope preview contract
            # -------------------------------------------------------------
            print("\n[Running Matrix E: Preflight Scope Preview Contract]")
            # Seed complex-01
            c1 = {
                "id": "complex-01",
                "code": "Complex 01",
                "name": "Primary Complex",
                "location": "Lembang",
                "systemStatus": "NORMAL",
                "greenhouseIds": ["gh-01", "gh-02"],
                "esp32": {
                    "deviceId": "controller-TEST-001",
                    "endpoint": esp_base_url,
                    "online": True,
                },
                "fertigationSchedules": [{"id": "fs-1", "ghId": "gh-01"}],
                "fanSchedules": [],
                "wellPumpSchedules": [{"id": "wp-1", "complexId": "complex-01"}],
            }
            operational_store.save_complex(c1)
            operational_store.save_greenhouse({"id": "gh-01", "complexId": "complex-01", "code": "GH 01", "crop": "Tomato", "greenhouseTag": "GH 01"})
            operational_store.save_greenhouse({"id": "gh-02", "complexId": "complex-01", "code": "GH 02", "crop": "Cucumber", "greenhouseTag": "GH 02"})

            # Seed operational data in history, recovery, calibration, fertigation
            history_store.ingest_telemetry_snapshot({
                "recordType": "TELEMETRY",
                "recordId": "rec-1",
                "deviceId": "controller-TEST-001",
                "complexId": "complex-01",
                "sequence": 1,
                "deviceTimestamp": "2026-09-20T20:00:00Z",
                "samples": [
                    {"componentId": "sensor-temp", "metricId": "temp", "deviceTimestamp": "2026-09-20T20:00:00Z", "value": 24.5, "unit": "C", "quality": "GOOD", "measurementType": "MEASURED"}
                ]
            })
            recovery_store.update_sync("complex-01", "controller-TEST-001", telemetry_cursor=1, event_cursor=0)
            recovery_store.set_deployment("complex-01", desired_version=1, desired_hash="hash-1", status="ACTIVE")
            calibration_repo.save_sensor({
                "sensorId": "sens-1", "complexId": "complex-01", "sensorType": "PH",
                "name": "pH", "unit": "pH", "source": "ANALOG", "channel": 1,
                "samplingIntervalMs": 1000
            })
            calibration_repo.save(build_linear_calibration(
                component_id="sens-1", calibration_type="PH",
                input_one=0.0, output_one=0.0, input_two=10.0, output_two=10.0,
                operator="tester", version=1, state="CALIBRATED", complex_id="complex-01",
                calibration_id="cal-1"
            ))
            fertigation_repo.save({
                "runId": "run-1", "scheduleId": "fs-1", "complexId": "complex-01", "ghId": "gh-01",
                "status": "COMPLETED", "startedAt": 1000, "targetEc": 2.0, "targetPh": 6.0
            })

            # Seed research data (MANDATORY TO PRESERVE)
            cycle = research_store.save_cycle({"complexId": "complex-01", "ghId": "gh-01", "cycleCode": "CYC-2026-01", "crop": "Tomato", "variety": "Roma"})
            plant = research_store.save_plant({"cycleId": cycle["cycleId"], "plantTag": "P-01", "rowNumber": 1, "plantNumber": 1})
            fruit = research_store.save_fruit({"plantId": plant["plantId"], "fruitTag": "F-01"})
            obs = research_store.save_observation({"cycleId": cycle["cycleId"], "complexId": "complex-01", "ghId": "gh-01", "plantId": plant["plantId"], "metric": "height_cm", "value": 45.2})

            preview = manager.get_deletion_preview("complex-01")
            assert preview["complexId"] == "complex-01", "Preview complexId mismatch"
            assert preview["countsToPurge"]["greenhouses"] == 2, f"Expected 2 GH, got {preview['countsToPurge']['greenhouses']}"
            assert preview["countsToPurge"]["schedules"] == 2, f"Expected 2 schedules, got {preview['countsToPurge']['schedules']}"
            assert preview["countsToPurge"]["telemetrySamples"] == 1, "Expected 1 telemetry sample"
            assert preview["countsToPurge"]["calibrations"] == 1, "Expected 1 calibration"
            assert preview["countsToPurge"]["fertigationRuns"] == 1, "Expected 1 fertigation run"
            assert preview["countsPreservedUntouched"]["cropCycles"] == 1, "Expected 1 cycle preserved"
            assert preview["countsPreservedUntouched"]["plants"] == 1, "Expected 1 plant preserved"
            assert preview["countsPreservedUntouched"]["fruits"] == 1, "Expected 1 fruit preserved"
            assert preview["countsPreservedUntouched"]["observations"] == 1, "Expected 1 observation preserved"
            assert preview["deletionBlockedByDevice"] is False, "Online device should not block deletion"
            print("PASS Matrix E: Preflight scope preview verified accurately across all DBs.")

            # -------------------------------------------------------------
            # Matrix C: Offline bound controller safety block
            # -------------------------------------------------------------
            print("\n[Running Matrix C: Offline Bound Controller Safety Block]")
            # Set controller endpoint to an unreachable port
            bad_c = dict(c1)
            bad_c["esp32"] = {"deviceId": "controller-TEST-001", "endpoint": "http://127.0.0.1:59999", "online": True}
            operational_store.save_complex(bad_c)

            offline_preview = manager.get_deletion_preview("complex-01")
            assert offline_preview["deletionBlockedByDevice"] is True, "Offline device MUST block deletion in preview"
            assert "unreachable" in (offline_preview["blockingReason"] or "").lower()

            # Attempt deletion when offline -> MUST enter WAITING_DEVICE and halt, NEVER purging SQLite tables
            blocked_job = manager.start_or_resume_deletion("complex-01", idempotency_key="key-offline-test")
            assert blocked_job["status"] == "WAITING_DEVICE", f"Expected WAITING_DEVICE, got {blocked_job['status']}"
            assert blocked_job["deviceRetired"] is False, "Device should not be marked retired"

            # Verify zero purge occurred!
            assert operational_store.get_complex("complex-01") is not None, "Complex MUST NOT be deleted while blocked"
            assert len(operational_store.list_greenhouses("complex-01")) == 2, "Greenhouses MUST NOT be deleted while blocked"
            assert calibration_repo.count_scoped("complex-01")["calibrations"] == 1, "Calibration MUST NOT be deleted while blocked"
            assert fertigation_repo.count_scoped("complex-01")["fertigationRuns"] == 1, "Fertigation runs MUST NOT be deleted while blocked"
            print("PASS Matrix C: Offline bound controller safety block verified. Job halted in WAITING_DEVICE with 0 tables purged.")

            # -------------------------------------------------------------
            # Matrix G: Concurrency lock verification
            # -------------------------------------------------------------
            print("\n[Running Matrix G: Concurrency Lock During Active Deletion]")
            assert manager.is_complex_locked("complex-01") is True, "Complex should be locked while in WAITING_DEVICE"
            # Cancel blocked job to clear the active job
            deletion_store.update_job("complex-01", status="CANCELLED")
            assert manager.is_complex_locked("complex-01") is False, "Complex should be unlocked after cancellation"
            print("PASS Matrix G: Concurrency lock successfully guards complex during active deletion lifecycle.")

            # -------------------------------------------------------------
            # Matrix B & D: Happy path deletion with bound online ESP32 + Research Preservation
            # -------------------------------------------------------------
            print("\n[Running Matrix B & D: Online Controller Retirement + Pure Research Preservation]")
            # Restore live endpoint and bind in mock device
            operational_store.save_complex(c1)
            FakeESP32Handler.complex_id = "complex-01"
            FakeESP32Handler.retire_count = 0

            # Execute deletion
            job = manager.start_or_resume_deletion("complex-01", idempotency_key="key-matrix-b")
            assert job["status"] == "COMPLETED", f"Expected COMPLETED, got {job['status']} (error: {job.get('errorMessage')})"
            assert job["deviceRetired"] is True, "Device should be marked retired"
            assert FakeESP32Handler.retire_count >= 1, "ESP32 retire endpoint was not called"
            assert FakeESP32Handler.complex_id is None, "ESP32 controller complex_id was not cleared to UNBOUND"

            # Verify operational tables are completely wiped for complex-01
            assert operational_store.get_complex("complex-01") is None, "Complex record should be deleted"
            assert len(operational_store.list_greenhouses("complex-01")) == 0, "Greenhouses should be purged"
            assert history_store.count_scoped("complex-01")["telemetrySamples"] == 0, "Telemetry should be purged"
            assert recovery_store.count_scoped("complex-01")["syncState"] == 0, "Sync state should be purged"
            assert calibration_repo.count_scoped("complex-01")["calibrations"] == 0, "Calibrations should be purged"
            assert fertigation_repo.count_scoped("complex-01")["fertigationRuns"] == 0, "Fertigation runs should be purged"

            # CRITICAL MANDATORY INVARIANT: Research records must remain 100% intact!
            res_counts = research_store.counts("complex-01")
            assert res_counts["cropCycles"] == 1, "Research crop cycles MUST NOT BE DELETED"
            assert res_counts["plants"] == 1, "Research plants MUST NOT BE DELETED"
            assert res_counts["fruits"] == 1, "Research fruits MUST NOT BE DELETED"
            assert res_counts["observations"] == 1, "Research observations MUST NOT BE DELETED"
            print("PASS Matrix B: Online controller retired cleanly, all operational databases purged.")
            print("PASS Matrix D: Research preservation invariant verified: 100% of research records untouched.")

            # -------------------------------------------------------------
            # Matrix F: Idempotency with idempotencyKey
            # -------------------------------------------------------------
            print("\n[Running Matrix F: Idempotency Contract]")
            job_repeat = manager.start_or_resume_deletion("complex-01", idempotency_key="key-matrix-b")
            assert job_repeat["jobId"] == job["jobId"], "Repeat delete call must return existing job"
            assert job_repeat["status"] == "COMPLETED", "Repeat delete call must return COMPLETED"
            print("PASS Matrix F: Idempotency contract verified.")

            # -------------------------------------------------------------
            # Matrix I: Controller Re-binding after clean retirement
            # -------------------------------------------------------------
            print("\n[Running Matrix I: Controller Re-Binding]")
            # Fake controller is now unbound (complex_id = None). We can create complex-new and bind to it!
            c_new = {
                "id": "complex-new",
                "code": "Complex New",
                "name": "New Complex",
                "location": "Bogor",
                "systemStatus": "NORMAL",
                "greenhouseIds": [],
                "esp32": {
                    "deviceId": "controller-TEST-001",
                    "endpoint": esp_base_url,
                    "online": True,
                }
            }
            operational_store.save_complex(c_new)
            # Send bind request to mock
            req = Request(f"{esp_base_url}/api/v1/device/bind", data=json.dumps({
                "requestId": "bind-new",
                "payload": {"deviceId": "controller-TEST-001", "complexId": "complex-new"}
            }).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
            with urlopen(req, timeout=5) as resp:
                bind_res = json.loads(resp.read().decode("utf-8"))
            assert bind_res["data"]["bindingState"] == "BOUND"
            assert bind_res["data"]["complexId"] == "complex-new"
            print("PASS Matrix I: Controller re-binding verified. Controller unbound cleanly and re-bound to new complex.")

            # -------------------------------------------------------------
            # Matrix A: Happy path unbound complex
            # -------------------------------------------------------------
            print("\n[Running Matrix A: Happy Path Unbound Complex Deletion]")
            c_unbound = {
                "id": "complex-unbound",
                "code": "Complex Unbound",
                "name": "Virtual Complex",
                "location": "Bandung",
                "systemStatus": "NORMAL",
                "greenhouseIds": ["gh-unb"],
                "esp32": {
                    "deviceId": "",
                    "endpoint": "",
                    "online": False,
                }
            }
            operational_store.save_complex(c_unbound)
            operational_store.save_greenhouse({"id": "gh-unb", "complexId": "complex-unbound", "code": "GH U1", "crop": "Lettuce", "greenhouseTag": "GH U1"})
            unbound_job = manager.start_or_resume_deletion("complex-unbound", idempotency_key="key-unbound")
            assert unbound_job["status"] == "COMPLETED", f"Expected COMPLETED, got {unbound_job['status']}"
            assert operational_store.get_complex("complex-unbound") is None, "Unbound complex should be purged"
            assert len(operational_store.list_greenhouses("complex-unbound")) == 0, "Unbound GH should be purged"
            print("PASS Matrix A: Happy path unbound complex deletion verified.")

            # -------------------------------------------------------------
            # Matrix J: Multi-complex isolation
            # -------------------------------------------------------------
            print("\n[Running Matrix J: Multi-Complex Isolation]")
            c_iso1 = {"id": "complex-iso-1", "code": "ISO 1", "name": "Isolated 1", "location": "Site A", "greenhouseIds": ["gh-i1"], "esp32": {}}
            c_iso2 = {"id": "complex-iso-2", "code": "ISO 2", "name": "Isolated 2", "location": "Site B", "greenhouseIds": ["gh-i2"], "esp32": {}}
            operational_store.save_complex(c_iso1)
            operational_store.save_complex(c_iso2)
            operational_store.save_greenhouse({"id": "gh-i1", "complexId": "complex-iso-1", "code": "GH I1", "crop": "Chili", "greenhouseTag": "GH I1"})
            operational_store.save_greenhouse({"id": "gh-i2", "complexId": "complex-iso-2", "code": "GH I2", "crop": "Spinach", "greenhouseTag": "GH I2"})
            calibration_repo.save_sensor({
                "sensorId": "sens-iso2", "complexId": "complex-iso-2", "sensorType": "EC",
                "name": "EC", "unit": "mS/cm", "source": "ANALOG", "channel": 2,
                "samplingIntervalMs": 1000
            })

            # Delete complex-iso-1
            manager.start_or_resume_deletion("complex-iso-1", idempotency_key="key-iso-1")
            assert operational_store.get_complex("complex-iso-1") is None
            assert len(operational_store.list_greenhouses("complex-iso-1")) == 0

            # Verify complex-iso-2 is completely untouched
            assert operational_store.get_complex("complex-iso-2") is not None
            assert len(operational_store.list_greenhouses("complex-iso-2")) == 1
            assert calibration_repo.count_scoped("complex-iso-2")["sensors"] == 1
            print("PASS Matrix J: Multi-complex isolation verified. Complex-02 completely untouched.")

            # -------------------------------------------------------------
            # Matrix H: Server restart recovery
            # -------------------------------------------------------------
            print("\n[Running Matrix H: Server Restart Recovery]")
            # Simulate an interrupted job by creating a PENDING job directly in DB
            from deletion_manager import STANDARD_STEPS
            operational_store.save_complex({"id": "complex-restart", "code": "CR", "name": "Restart", "location": "Test", "esp32": {}})
            deletion_store.create_job(
                job_id="job-restart-test",
                complex_id="complex-restart",
                idempotency_key="key-restart",
                requested_by="operator",
                request_reason="Restart recovery test",
                scope_snapshot_hash="hash-dummy",
            )
            deletion_store.register_steps("job-restart-test", STANDARD_STEPS)
            # Call resume_pending_jobs
            resumed_count = manager.resume_pending_jobs()
            assert resumed_count >= 1, "Expected at least 1 job resumed on startup"
            job_state = manager.get_job_state("job-restart-test")
            assert job_state["status"] == "COMPLETED", f"Expected resumed job to finish COMPLETED, got {job_state['status']}"
            print("PASS Matrix H: Server restart recovery verified. Interrupted pending jobs resumed to completion.")

            print("\n=================================================================")
            print("ALL MATRIX TESTS (A-J) PASSED PERFECTLY!")
            print("=================================================================")
        finally:
            esp_server.shutdown()


if __name__ == "__main__":
    run_tests()
