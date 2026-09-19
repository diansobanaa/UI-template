"""Stdlib REST backend for M7-M12 configuration, scheduling, sensors, calibration and fertigation."""
from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

try:
    from .operational_store import OPERATIONAL_STORE
    from .history_store import HISTORY_STORE
    from .recovery_store import RECOVERY_STORE
    from .research_store import RESEARCH_STORE
except ImportError:
    from operational_store import OPERATIONAL_STORE
    from history_store import HISTORY_STORE
    from recovery_store import RECOVERY_STORE
    from research_store import RESEARCH_STORE

try:
    from .schedule_compiler import compile_schedule_set, topology_capabilities
    from .resource_manager import list_resources, transfer_resource
    from .sensor_calibration import CalibrationRepository, build_dosing_calibration, build_linear_calibration, normalize_sensor_sample, validate_sensor_definition
    from .fertigation_engine import FertigationRunRepository, prepare_run
except ImportError:
    from schedule_compiler import compile_schedule_set, topology_capabilities
    from resource_manager import list_resources, transfer_resource
    from sensor_calibration import CalibrationRepository, build_dosing_calibration, build_linear_calibration, normalize_sensor_sample, validate_sensor_definition
    from fertigation_engine import FertigationRunRepository, prepare_run

CALIBRATION_REPO = CalibrationRepository(os.getenv("AGROTECH_CALIBRATION_DB", "./agrotech_calibration.sqlite3"))
FERTIGATION_REPO = FertigationRunRepository(os.getenv("AGROTECH_FERTIGATION_DB", "./agrotech_fertigation.sqlite3"))


def _enrich_fertigation_schedules(configuration: dict[str, Any], schedules: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Resolve each scheduled fertigation once into a deterministic execution plan.

    The plan is created by the same production M12 precheck path used by manual
    execution.  The scheduler compiler then transports that plan unchanged to ESP32;
    firmware does not rediscover hardware independently.
    """
    enriched: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    for raw_intent in schedules:
        intent = json.loads(json.dumps(raw_intent)) if isinstance(raw_intent, dict) else raw_intent
        if not isinstance(intent, dict) or str(intent.get("action", "")).upper() != "FERTIGATION":
            enriched.append(intent)
            continue
        params = intent.setdefault("parameters", {})
        if not isinstance(params, dict):
            blocked.append({"scheduleId": intent.get("scheduleId") or intent.get("id"), "code": "INVALID_FERTIGATION_PARAMETERS", "message": "FERTIGATION parameters must be an object."})
            continue
        request = {**params,
                   "ghId": intent.get("ghId"),
                   "recipeId": intent.get("recipeId"),
                   "scheduleId": intent.get("scheduleId") or intent.get("id"),
                   "triggerType": "SCHEDULE",
                   "source": "SCHEDULER",
                   "operator": intent.get("ownerId") or "SCHEDULER",
                   "deliveryMode": params.get("deliveryMode", "VOLUME"),
                   "safetyAcknowledged": params.get("safetyAcknowledged", True)}
        if request.get("targetDeliveredMl") is None:
            request["targetDeliveredMl"] = request.get("targetWaterMl", 0)
        prepared = prepare_run(configuration, request, CALIBRATION_REPO, FERTIGATION_REPO.list(configuration.get("complexId"), intent.get("ghId")))
        if not prepared.get("valid") or not isinstance(prepared.get("run"), dict) or not isinstance(prepared["run"].get("executionPlan"), dict):
            blocked.append({"scheduleId": intent.get("scheduleId") or intent.get("id"),
                            "code": "FERTIGATION_EXECUTION_PLAN_BLOCKED",
                            "message": "; ".join(i.get("message", "") for i in prepared.get("issues", [])) or "Fertigation execution plan could not be prepared."})
            continue
        params["executionPlan"] = prepared["run"]["executionPlan"]
        enriched.append(intent)
    return enriched, blocked


def _new_complex_payload(complex_id: str, code: str, name: str, location: str) -> dict[str, Any]:
    return {
        "id": complex_id,
        "code": code,
        "name": name,
        "location": location,
        "status": "Active",
        "emergencyStopped": False,
        "esp32": {
            "online": False,
            "lastSync": "",
            "configVersion": 0,
            "esp32ConfigVersion": 0,
            "synchronized": False,
            "deviceId": None,
            "apiVersion": None,
            "schemaVersion": None,
            "inventoryVersion": None,
            "endpoint": None,
            "firmwareVersion": None,
            "hardwareModel": None,
        },
        "systemStatus": "WARNING",
        "greenhouseIds": [],
        "water": {"wellPumpOn": False, "rawTankPct": 0, "flowTodayL": 0, "flowDeltaPct": 0},
        "wellPumpSchedules": [],
    }


def _new_greenhouse_payload(gh_id: str, complex_id: str, code: str, crop: str, tag: str) -> dict[str, Any]:
    return {
        "id": gh_id,
        "code": code,
        "crop": crop,
        "complexId": complex_id,
        "online": False,
        "health": "WARNING",
        "greenhouseTag": tag,
        "fertigationState": "IDLE",
        "telemetry": {
            "temperatureC": None,
            "humidityPct": None,
            "lightLux": None,
            "tempDeltaC": None,
            "humidityDeltaPct": None,
            "tankPct": 0,
            "tankL": 0,
            "tankCapacityL": 0,
            "waterTodayL": None,
            "waterYesterdayL": None,
            "waterDeltaPct": None,
            "hstDays": 0,
            "hspDays": None,
        },
        "plants": {"total": 0, "tracked": 0, "alive": 0, "dead": 0, "avgHeightCm": 0, "avgFruitWeightG": 0, "totalFruits": 0, "latestObservation": "—"},
        "equipment": [],
        "cameras": [],
        "cropCycle": {"status": "NO_CYCLE", "tanggalTanam": None, "tanggalPolinasi": None},
        "research": {"currentCycle": None, "cycles": [], "plants": [], "fruits": [], "recentObservations": []},
        "recipes": [],
        "fertigationSchedules": [],
        "fanSchedules": [],
        "currentRun": None,
        "queue": [],
        "history": [],
        "fruitDevSeries": [],
    }


def _schedule_bucket(kind: str) -> str:
    key = str(kind or "").strip().lower()
    mapping = {"fertigation": "fertigationSchedules", "fan": "fanSchedules", "wellpump": "wellPumpSchedules", "well_pump": "wellPumpSchedules"}
    if key not in mapping:
        raise ValueError("kind must be fertigation, fan, or wellPump")
    return mapping[key]


def _find_schedule(schedule_id: str) -> tuple[str, dict[str, Any], list[dict[str, Any]], str] | None:
    context = OPERATIONAL_STORE.context()
    for greenhouse in context["greenhouses"]:
        for bucket in ("fertigationSchedules", "fanSchedules"):
            for item in greenhouse.get(bucket, []):
                if str(item.get("id")) == schedule_id:
                    return ("greenhouse", greenhouse, greenhouse[bucket], bucket)
    for complex_record in context["complexes"]:
        bucket = "wellPumpSchedules"
        for item in complex_record.get(bucket, []):
            if str(item.get("id")) == schedule_id:
                return ("complex", complex_record, complex_record[bucket], bucket)
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "AgroTechBackend/0.1"

    @staticmethod
    def _context_with_research() -> dict[str, Any]:
        context = OPERATIONAL_STORE.context()
        return {"complexes": context["complexes"],
                "greenhouses": [RESEARCH_STORE.enrich_greenhouse(dict(g)) for g in context["greenhouses"]]}

    @staticmethod
    def _sync_snapshot(complex_id: str) -> dict[str, Any]:
        complex_record = OPERATIONAL_STORE.get_complex(complex_id)
        if not complex_record:
            raise ValueError("COMPLEX_NOT_FOUND")
        ghs = [RESEARCH_STORE.enrich_greenhouse(dict(g)) for g in OPERATIONAL_STORE.list_greenhouses(complex_id)]
        return {
            "complexId": complex_id,
            "complex": complex_record,
            "greenhouses": ghs,
            "deployment": RECOVERY_STORE.get_deployment(complex_id),
            "sync": RECOVERY_STORE.get_sync(complex_id),
            "history": {"telemetry": HISTORY_STORE.telemetry_bounds(complex_id), "events": HISTORY_STORE.event_bounds(complex_id)},
            "serverTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", os.getenv("CORS_ORIGIN", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept,Content-Type,Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        size = int(self.headers.get("Content-Length", "0"))
        if size > 512 * 1024:
            raise ValueError("request body too large")
        return json.loads(self.rfile.read(size).decode("utf-8"))

    @staticmethod
    def _unwrap_esp32_payload(device: Any) -> Any:
        if not isinstance(device, dict):
            return device
        data = device.get("data", device)
        if isinstance(data, dict) and "payload" in data:
            return data["payload"]
        return data

    def _esp32_request_json(self, complex_id: str, path: str) -> Any:
        """Read an authoritative device endpoint and return its unwrapped data."""
        esp32_base = str(os.getenv("ESP32_API_BASE", "")).rstrip("/")
        if not esp32_base:
            raise RuntimeError("ESP32_API_BASE is not configured")
        request = Request(
            f"{esp32_base}{path}",
            method="GET",
            headers={"Accept": "application/json", "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"},
        )
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        data = self._unwrap_esp32_payload(payload)
        if isinstance(data, dict) and data.get("complexId") and data.get("complexId") != complex_id:
            raise ValueError("ESP32 response belongs to another Complex")
        return data

    def _pull_esp32_history(self, complex_id: str, resource: str, query: dict[str, list[str]]) -> bool:
        """Pull device records and project them into durable Python history. Returns True on successful upstream read."""
        params = []
        for key in ("ghId", "afterSequence", "limit"):
            value = (query.get(key) or [None])[0]
            if value not in (None, ""):
                params.append(f"{key}={value}")
        path = f"/api/v1/{resource}" + ("?" + "&".join(params) if params else "")
        data = self._esp32_request_json(complex_id, path)
        if not isinstance(data, dict):
            return False
        if resource == "telemetry":
            snapshots = data.get("snapshots") or data.get("items")
            if isinstance(snapshots, list):
                for snapshot in snapshots:
                    if isinstance(snapshot, dict): HISTORY_STORE.ingest_telemetry_snapshot(snapshot)
            else:
                HISTORY_STORE.ingest_telemetry_snapshot(data)
        elif resource == "events":
            events = data.get("events") or data.get("items") or []
            for event in events:
                if isinstance(event, dict):
                    HISTORY_STORE.ingest_event(event)
        return True

    def _telemetry_response(self, complex_id: str, query: dict[str, list[str]], live_error: Exception | None = None) -> dict[str, Any]:
        gh_id = (query.get("ghId") or [None])[0]
        after_raw = (query.get("afterSequence") or [None])[0]
        after = int(after_raw or 0)
        limit = max(1, min(int((query.get("limit") or [50])[0] or 50), 200))
        live_ok = False
        try:
            pull_query = dict(query)
            if after_raw in (None, ""):
                pull_query["limit"] = ["1"]
            live_ok = self._pull_esp32_history(complex_id, "telemetry", pull_query)
        except Exception as exc:
            live_error = exc
        bounds = HISTORY_STORE.telemetry_bounds(complex_id, gh_id=gh_id)
        if after_raw in (None, ""):
            latest_history = HISTORY_STORE.latest_telemetry_history(complex_id, gh_id=gh_id, limit=limit)
            history = {**latest_history, "hasMore": False}
        else:
            history = HISTORY_STORE.list_telemetry(complex_id, gh_id=gh_id, after_sequence=after, limit=limit)
        latest = HISTORY_STORE.latest_telemetry(complex_id, gh_id=gh_id)
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if latest is None:
            return {
                "complexId": complex_id, "ghId": gh_id, "deviceId": None, "sequence": 0,
                "deviceTimestamp": now, "timestamp": now, "samples": [], "nextSequence": None,
                "hasMore": False, "earliestSequence": None, "latestSequence": None,
                "source": "UNAVAILABLE", "stale": True,
                "error": str(live_error) if live_error else None,
            }
        latest_seq = int(latest["sequence"])
        latest_rows = HISTORY_STORE.list_telemetry(complex_id, gh_id=gh_id, after_sequence=max(0, latest_seq - 1), limit=200)["samples"]
        latest_rows = [x for x in latest_rows if int(x["sequence"]) == latest_seq]
        samples = history["samples"] if after_raw not in (None, "") else latest_rows
        return {
            "complexId": complex_id, "ghId": gh_id, "deviceId": latest["device_id"],
            "sequence": latest_seq, "deviceTimestamp": latest["device_timestamp"],
            "timestamp": latest["device_timestamp"], "samples": samples,
            "nextSequence": history["nextSequence"], "hasMore": history["hasMore"],
            "earliestSequence": bounds["earliestSequence"], "latestSequence": bounds["latestSequence"],
            "source": "ESP32" if live_ok else "HISTORY", "stale": not live_ok,
            "receivedAt": latest["received_at"],
            "historyTruncated": False,
            "historyGap": bool(after_raw not in (None, "") and bounds["earliestSequence"] is not None and after < int(bounds["earliestSequence"]) - 1),
            "error": None if live_ok else (str(live_error) if live_error else None),
        }

    def _events_response(self, complex_id: str, query: dict[str, list[str]], live_error: Exception | None = None) -> dict[str, Any]:
        gh_id = (query.get("ghId") or [None])[0]
        after_raw = (query.get("afterSequence") or query.get("cursor") or [None])[0]
        after = int(after_raw or 0)
        limit = max(1, min(int((query.get("limit") or [50])[0] or 50), 200))
        live_ok = False
        try:
            pull_query = dict(query)
            if after_raw in (None, ""):
                bounds = HISTORY_STORE.event_bounds(complex_id, gh_id=gh_id)
                pull_query["afterSequence"] = [str(bounds["latestSequence"] or 0)]
                pull_query["limit"] = [str(limit)]
            live_ok = self._pull_esp32_history(complex_id, "events", pull_query)
        except Exception as exc:
            live_error = exc
        result = HISTORY_STORE.latest_events(complex_id, gh_id=gh_id, limit=limit) if after_raw in (None, "") else HISTORY_STORE.list_events(complex_id, gh_id=gh_id, after_sequence=after, limit=limit)
        bounds = HISTORY_STORE.event_bounds(complex_id, gh_id=gh_id)
        return {**result, "items": result["events"], "earliestSequence": bounds["earliestSequence"],
                "latestSequence": bounds["latestSequence"], "source": "ESP32" if live_ok else "HISTORY",
                "stale": not live_ok,
                "nextCursor": str(result["nextSequence"]) if result.get("hasMore") else None,
                "historyGap": bool(after_raw not in (None, "") and bounds["earliestSequence"] is not None and after < int(bounds["earliestSequence"]) - 1),
                "error": None if live_ok else (str(live_error) if live_error else None)}


    def _proxy_esp32_command(self, complex_id: str, command: dict[str, Any]) -> None:
        target_complex = command.get("targetComplexId") or command.get("complexId") or complex_id
        if target_complex != complex_id:
            self._json(409, {"error": {"code": "COMPLEX_MISMATCH", "message": "Path complexId does not match command target."}})
            return
        esp32_base = str(command.get("esp32BaseUrl") or os.getenv("ESP32_API_BASE", "")).rstrip("/")
        if not esp32_base:
            self._json(503, {"error": {"code": "DEVICE_OFFLINE", "message": "ESP32 command target is not configured."}})
            return
        command.pop("esp32BaseUrl", None)
        request_id = command.pop("requestId", None) or f"backend-cmd-{command.get('commandId', 'unknown')}"
        payload = {
            "requestId": request_id,
            "client": {"type": "PythonBackend", "version": "0.1.0"},
            "payload": command,
        }
        request = Request(
            f"{esp32_base}/api/v1/commands",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"},
        )
        try:
            with urlopen(request, timeout=8) as response:
                device = json.loads(response.read().decode("utf-8"))
                self._json(response.status, self._unwrap_esp32_payload(device))
        except HTTPError as exc:
            try:
                body = json.loads(exc.read().decode("utf-8"))
            except Exception:
                body = {"error": {"code": "DEVICE_COMMAND_REJECTED", "message": str(exc)}}
            self._json(exc.code, body)
        except Exception as exc:
            self._json(502, {"error": {"code": "DEVICE_COMMAND_FAILED", "message": str(exc)}})

    @staticmethod
    def _record_json(record: Any) -> dict[str, Any]:
        return {
            "calibrationId": record.calibrationId, "componentId": record.componentId,
            "calibrationType": record.calibrationType, "version": record.version,
            "state": record.state, "createdAtMs": record.createdAtMs,
            "validFromMs": record.validFromMs, "validUntilMs": record.validUntilMs,
            "operator": record.operator, "parameters": record.parameters, "complexId": record.complexId,
        }

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", os.getenv("CORS_ORIGIN", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept,Content-Type,Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]

        # Python-owned permanent Complex/GH master context.
        if parts == ["api", "context"]:
            self._json(200, self._context_with_research())
            return
        if len(parts) == 4 and parts[:2] == ["api", "complexes"] and parts[3] == "sync-snapshot":
            try:
                self._json(200, self._sync_snapshot(parts[2]))
            except ValueError:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
            return
        if len(parts) == 4 and parts[:2] == ["api", "complexes"] and parts[3] == "offline-status":
            cid = parts[2]
            complex_record = OPERATIONAL_STORE.get_complex(cid)
            if not complex_record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            self._json(200, {"complexId": cid, "online": bool((complex_record.get("esp32") or {}).get("online")),
                              "sync": RECOVERY_STORE.get_sync(cid), "deployment": RECOVERY_STORE.get_deployment(cid)})
            return
        if len(parts) >= 5 and parts[0:2] == ["api", "complexes"] and parts[3] == "research":
            cid = parts[2]
            resource = parts[4]
            query = parse_qs(urlparse(self.path).query)
            if resource == "cycles":
                self._json(200, {"complexId": cid, "cycles": RESEARCH_STORE.list_cycles(cid, (query.get("ghId") or [None])[0], (query.get("status") or [None])[0], int((query.get("limit") or [100])[0]))})
                return
            if resource == "plants":
                self._json(200, {"complexId": cid, "plants": RESEARCH_STORE.list_plants((query.get("cycleId") or [None])[0], (query.get("ghId") or [None])[0])})
                return
            if resource == "fruits":
                self._json(200, {"complexId": cid, "fruits": RESEARCH_STORE.list_fruits((query.get("cycleId") or [None])[0], (query.get("ghId") or [None])[0])})
                return
            if resource == "observations":
                self._json(200, {"complexId": cid, "observations": RESEARCH_STORE.list_observations((query.get("cycleId") or [None])[0], (query.get("ghId") or [None])[0], (query.get("plantId") or [None])[0], (query.get("fruitId") or [None])[0])})
                return
            if resource == "summary" and len(parts) >= 6:
                gh_id = parts[5]
                gh = OPERATIONAL_STORE.get_greenhouse(gh_id)
                if not gh or str(gh.get("complexId")) != str(cid):
                    self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}}); return
                self._json(200, RESEARCH_STORE.summary_for_gh(cid, gh_id)); return
            if resource == "analysis" and len(parts) >= 6:
                try:
                    self._json(200, RESEARCH_STORE.analysis(cid, parts[5], HISTORY_STORE, FERTIGATION_REPO, CALIBRATION_REPO))
                except ValueError:
                    self._json(404, {"error": {"code": "CYCLE_NOT_FOUND", "message": "Research cycle not found."}})
                return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "complexes":
            complex_id = parts[2]
            record = OPERATIONAL_STORE.get_complex(complex_id)
            if not record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            self._json(200, record)
            return
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "greenhouses":
            complex_id = parts[2]
            if not OPERATIONAL_STORE.get_complex(complex_id):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            self._json(200, {"complexId": complex_id, "greenhouses": [RESEARCH_STORE.enrich_greenhouse(dict(g)) for g in OPERATIONAL_STORE.list_greenhouses(complex_id)]})
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "greenhouses":
            gh_id = parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            self._json(200, RESEARCH_STORE.enrich_greenhouse(dict(record)))
            return
        if len(parts) == 5 and parts[0:2] == ["api", "greenhouses"] and parts[3:] == ["research", "summary"]:
            gh_id = parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}}); return
            self._json(200, RESEARCH_STORE.summary_for_gh(str(record.get("complexId")), gh_id)); return
        if len(parts) == 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "esp32" and parts[4] in {"inventory", "configuration"}:
            complex_id = parts[2]
            esp32_base = str(os.getenv("ESP32_API_BASE", "")).rstrip("/")
            if not esp32_base:
                self._json(503, {"error": {"code": "DEVICE_OFFLINE", "message": "ESP32 read target is not configured."}})
                return
            upstream_path = "/api/v1/inventory" if parts[4] == "inventory" else "/api/v1/configuration"
            request = Request(
                f"{esp32_base}{upstream_path}",
                method="GET",
                headers={"Accept": "application/json", "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"},
            )
            try:
                with urlopen(request, timeout=8) as response:
                    device = json.loads(response.read().decode("utf-8"))
                    self._json(response.status, self._unwrap_esp32_payload(device))
            except HTTPError as exc:
                try:
                    body = json.loads(exc.read().decode("utf-8"))
                except Exception:
                    body = {"error": {"code": "DEVICE_READ_FAILED", "message": str(exc)}}
                self._json(exc.code, body)
            except Exception as exc:
                self._json(502, {"error": {"code": "DEVICE_READ_FAILED", "message": str(exc)}})
            return
        if len(parts) == 6 and parts[0:3] == ["api", "complexes", parts[2] if len(parts) > 2 else ""] and parts[3:6] == ["esp32", "configuration", "deployment"]:
            cid = parts[2]
            if not OPERATIONAL_STORE.get_complex(cid):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            self._json(200, RECOVERY_STORE.get_deployment(cid))
            return
        if len(parts) == 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "telemetry" and parts[4] == "history":
            complex_id = parts[2]
            if not OPERATIONAL_STORE.get_complex(complex_id):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            query = parse_qs(urlparse(self.path).query)
            gh_id = (query.get("ghId") or [None])[0]
            limit = max(1, min(int((query.get("limit") or [200])[0] or 200), 200))
            after_raw = (query.get("afterSequence") or [None])[0]
            after = int(after_raw or 0)
            bounds = HISTORY_STORE.telemetry_bounds(complex_id, gh_id=gh_id)
            pull_query = dict(query)
            pull_query["ghId"] = [gh_id] if gh_id else []
            pull_query["afterSequence"] = [str(bounds["latestSequence"] or 0)] if after_raw in (None, "") else [str(after)]
            pull_query["limit"] = [str(limit)]
            live_ok = False
            live_error: Exception | None = None
            try:
                live_ok = self._pull_esp32_history(complex_id, "telemetry", pull_query)
            except Exception as exc:
                live_error = exc
            if after_raw in (None, ""):
                history = HISTORY_STORE.latest_telemetry_history(complex_id, gh_id=gh_id, limit=limit)
            else:
                history = HISTORY_STORE.list_telemetry(complex_id, gh_id=gh_id, after_sequence=after, limit=limit)
            bounds = HISTORY_STORE.telemetry_bounds(complex_id, gh_id=gh_id)
            self._json(200, {"complexId": complex_id, "ghId": gh_id, "samples": history["samples"],
                             "nextSequence": history["nextSequence"], "hasMore": history["hasMore"],
                             "earliestSequence": bounds["earliestSequence"], "latestSequence": bounds["latestSequence"],
                             "source": "ESP32" if live_ok else "HISTORY", "stale": not live_ok,
                             "historyGap": bool(after_raw not in (None, "") and bounds["earliestSequence"] is not None and after < int(bounds["earliestSequence"]) - 1),
                             "error": None if live_ok else (str(live_error) if live_error else None)})
            return
        if len(parts) >= 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "telemetry":
            complex_id = parts[2]
            if not OPERATIONAL_STORE.get_complex(complex_id):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            query = parse_qs(urlparse(self.path).query)
            try:
                payload = self._telemetry_response(complex_id, query)
                self._json(200, payload)
            except Exception as exc:
                self._json(503, {"error": {"code": "TELEMETRY_HISTORY_UNAVAILABLE", "message": str(exc), "retryable": True}})
            return
        if len(parts) >= 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "events":
            complex_id = parts[2]
            if not OPERATIONAL_STORE.get_complex(complex_id):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            query = parse_qs(urlparse(self.path).query)
            try:
                self._json(200, self._events_response(complex_id, query))
            except Exception as exc:
                self._json(503, {"error": {"code": "EVENT_HISTORY_UNAVAILABLE", "message": str(exc), "retryable": True}})
            return
        if len(parts) >= 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "sensors":
            complex_id = parts[2]
            self._json(200, {"complexId": complex_id, "sensors": CALIBRATION_REPO.sensors(complex_id)})
            return
        if len(parts) == 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "calibrations":
            complex_id, calibration_id = parts[2], parts[4]
            rec = next((r for r in CALIBRATION_REPO.history(complex_id=complex_id) if r.calibrationId == calibration_id), None)
            if not rec:
                self._json(404, {"error": {"code": "CALIBRATION_NOT_FOUND", "message": "Calibration record not found for this Complex."}})
                return
            self._json(200, {"complexId": complex_id, "calibration": self._record_json(rec)})
            return
        if len(parts) >= 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "calibrations":
            complex_id = parts[2]
            self._json(200, {"complexId": complex_id, "calibrations": [self._record_json(r) for r in CALIBRATION_REPO.history(complex_id=complex_id)]})
            return
        if len(parts) >= 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "fertigation" and parts[4] == "runs":
            complex_id = parts[2]
            query = parse_qs(urlparse(self.path).query)
            gh_id = (query.get("ghId") or [None])[0]
            self._json(200, {"complexId": complex_id, "ghId": gh_id, "runs": FERTIGATION_REPO.list(complex_id, gh_id)})
            return
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "resources":
            complex_id = parts[2]
            if not OPERATIONAL_STORE.get_complex(complex_id):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}}); return
            try:
                esp_cfg = self._esp32_request_json(complex_id, "/api/v1/configuration")
                self._json(200, {"complexId": complex_id, "resources": list_resources(esp_cfg)})
            except Exception as exc:
                self._json(503, {"error": {"code": "RESOURCE_STATE_UNAVAILABLE", "message": str(exc), "retryable": True}})
            return
        if parts[-1:] == ["topology-capabilities"] and len(parts) >= 4:
            complex_id = parts[-2]
            body = self._read_json() if False else {}
            # GET topology currently reads a supplied config only in test/dev usage.
            self._json(400, {"error": {"code": "CONFIGURATION_REQUIRED", "message": f"Provide configuration through compile for Complex '{complex_id}'."}})
            return
        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Endpoint not found."}})

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self._read_json()
        except Exception as exc:
            self._json(400, {"error": {"code": "INVALID_JSON", "message": str(exc)}})
            return

        parts = [p for p in urlparse(self.path).path.split("/") if p]

        if len(parts) == 6 and parts[0:3] == ["api", "complexes", parts[2] if len(parts) > 2 else ""] and parts[3:5] == ["esp32", "configuration"] and parts[5] in {"validate", "deploy", "rollback"}:
            cid = parts[2]
            if not OPERATIONAL_STORE.get_complex(cid):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            upstream = f"{str(os.getenv('ESP32_API_BASE', '')).rstrip('/')}/api/v1/configuration/{parts[5]}"
            if not os.getenv("ESP32_API_BASE"):
                self._json(503, {"error": {"code": "DEVICE_OFFLINE", "message": "ESP32 API target is not configured.", "retryable": True}})
                return
            payload = body
            if parts[5] == "validate":
                payload = {"requestId": body.get("requestId") or f"backend-validate-{time.time_ns()}",
                           "client": body.get("client") or {"type": "PythonBackend", "version": "0.1.0"},
                           "payload": {"expectedVersion": body.get("expectedVersion", body.get("version", 0)),
                                       "configuration": body.get("configuration", body.get("payload", body))}}
            elif parts[5] == "deploy":
                payload = {"requestId": body.get("requestId") or f"backend-deploy-{time.time_ns()}",
                           "client": body.get("client") or {"type": "PythonBackend", "version": "0.1.0"},
                           "payload": {"expectedVersion": body.get("expectedVersion", 0),
                                       "deploymentId": body.get("deploymentId") or f"deploy-{time.time_ns()}",
                                       "configuration": body.get("configuration", body)}}
            else:
                payload = {"requestId": body.get("requestId") or f"backend-rollback-{time.time_ns()}",
                           "client": body.get("client") or {"type": "PythonBackend", "version": "0.1.0"},
                           "payload": {}}
            try:
                request = Request(upstream, data=json.dumps(payload).encode("utf-8"), method="POST",
                                  headers={"Content-Type": "application/json", "Accept": "application/json",
                                           "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"})
                with urlopen(request, timeout=8) as response:
                    device = json.loads(response.read().decode("utf-8"))
                    envelope_data = device.get("data", device) if isinstance(device, dict) else device
                    data = envelope_data.get("payload", envelope_data) if isinstance(envelope_data, dict) else envelope_data
                    if parts[5] in {"deploy", "rollback"} and isinstance(envelope_data, dict):
                        dep_id = envelope_data.get("deploymentId") or body.get("deploymentId")
                        status = str(envelope_data.get("deploymentStatus") or "ACTIVE")
                        desired_ver = int(envelope_data.get("configurationVersion") or (data.get("version", 0) if isinstance(data, dict) else 0))
                        desired_hash = envelope_data.get("configurationHash")
                        previous_ver = int(envelope_data.get("previousConfigurationVersion") or 0)
                        RECOVERY_STORE.set_deployment(cid, deployment_id=dep_id, desired_version=desired_ver, desired_hash=desired_hash,
                                                      device_version=desired_ver, device_hash=desired_hash,
                                                      previous_version=previous_ver, status=status)
                    self._json(response.status, data)
            except HTTPError as exc:
                try: err_body = json.loads(exc.read().decode("utf-8"))
                except Exception: err_body = {"error": {"code": "DEVICE_REQUEST_FAILED", "message": str(exc)}}
                if parts[5] in {"deploy", "rollback"}:
                    RECOVERY_STORE.set_deployment(cid, deployment_id=body.get("deploymentId"), desired_version=int(body.get("configuration", {}).get("version", 0) or 0), desired_hash=body.get("configuration", {}).get("configurationHash"), status="FAILED")
                self._json(exc.code, err_body)
            except Exception as exc:
                if parts[5] in {"deploy", "rollback"}:
                    RECOVERY_STORE.set_deployment(cid, deployment_id=body.get("deploymentId"), desired_version=int(body.get("configuration", {}).get("version", 0) or 0), desired_hash=body.get("configuration", {}).get("configurationHash"), status="PENDING_DEPLOYMENT")
                self._json(502, {"error": {"code": "DEVICE_REQUEST_FAILED", "message": str(exc), "retryable": True, "reconcileRequired": True}})
            return

        if parts == ["api", "ingest", "esp32"]:
            try:
                result = HISTORY_STORE.ingest_bundle(body)
                self._json(202, {"accepted": True, **result})
            except (ValueError, TypeError) as exc:
                self._json(422, {"accepted": False, "error": {"code": "INVALID_ESP32_INGEST", "message": str(exc)}})
            except Exception as exc:
                self._json(503, {"accepted": False, "error": {"code": "ESP32_INGEST_FAILED", "message": str(exc), "retryable": True}})
            return
        if len(parts) == 5 and parts[:4] == ["api", "complexes", parts[2] if len(parts)>2 else "", "esp32"] and parts[4] == "sync":
            cid = parts[2]
            try:
                if not OPERATIONAL_STORE.get_complex(cid): raise ValueError("COMPLEX_NOT_FOUND")
                sync = RECOVERY_STORE.get_sync(cid)
                self._pull_esp32_history(cid, "telemetry", {"afterSequence":[str(sync["telemetryCursor"])],"limit":["200"]})
                self._pull_esp32_history(cid, "events", {"afterSequence":[str(sync["eventCursor"])],"limit":["200"]})
                device_id = "unknown-device"
                try:
                    status = self._esp32_request_json(cid, "/api/v1/status")
                    if isinstance(status, dict): device_id = str((status.get("device") or {}).get("deviceId") or status.get("deviceId") or device_id)
                except Exception: pass
                tb = HISTORY_STORE.telemetry_bounds(cid); eb = HISTORY_STORE.event_bounds(cid)
                sync = RECOVERY_STORE.update_sync(cid, device_id, telemetry_cursor=int(tb["latestSequence"] or sync["telemetryCursor"]), event_cursor=int(eb["latestSequence"] or sync["eventCursor"]), status="SYNCED", error=None)
                self._json(200, {"accepted": True, "sync": sync, **self._sync_snapshot(cid)})
            except Exception as exc:
                sync = RECOVERY_STORE.update_sync(cid, "unknown-device", status="ERROR", error=str(exc))
                self._json(502, {"accepted": False, "sync": sync, "error": {"code":"SYNC_FAILED","message":str(exc),"retryable":True}})
            return
        if len(parts) >= 5 and parts[0:2] == ["api", "complexes"] and parts[3] == "research":
            cid=parts[2]; resource=parts[4]
            try:
                if not OPERATIONAL_STORE.get_complex(cid): raise ValueError("COMPLEX_NOT_FOUND")
                if resource == "cycles" and len(parts) >= 6:
                    self._json(200,{"cycle":RESEARCH_STORE.save_cycle({**body,"complexId":cid}, cycle_id=parts[5])}); return
                if resource == "plants" and len(parts) >= 6:
                    self._json(200,{"plant":RESEARCH_STORE.save_plant(body, plant_id=parts[5])}); return
                if resource == "fruits" and len(parts) >= 6:
                    self._json(200,{"fruit":RESEARCH_STORE.save_fruit(body, fruit_id=parts[5])}); return
                if resource == "cycles": self._json(201,{"cycle":RESEARCH_STORE.save_cycle({**body,"complexId":cid})}); return
                if resource == "plants": self._json(201,{"plant":RESEARCH_STORE.save_plant(body)}); return
                if resource == "fruits": self._json(201,{"fruit":RESEARCH_STORE.save_fruit(body)}); return
                if resource == "observations": self._json(201,{"observation":RESEARCH_STORE.save_observation({**body,"complexId":cid})}); return
            except ValueError as exc:
                self._json(422,{"error":{"code":"RESEARCH_VALIDATION_FAILED","message":str(exc)}}); return
        if parts == ["api", "complexes"]:
            location = str(body.get("location", "")).strip()
            if not location:
                self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "Location is required."}})
                return
            existing = OPERATIONAL_STORE.context()["complexes"]
            next_num = 1
            used = {str(x.get("id", "")) for x in existing}
            while f"complex-{next_num:02d}" in used:
                next_num += 1
            complex_id = str(body.get("id") or f"complex-{next_num:02d}")
            code = str(body.get("code") or f"Complex {next_num:02d}").strip()
            name = str(body.get("name") or "Greenhouse Complex").strip()
            record = _new_complex_payload(complex_id, code, name, location)
            OPERATIONAL_STORE.save_complex(record)
            self._json(201, record)
            return
        if len(parts) == 5 and parts[:3] == ["api", "complexes", parts[2] if len(parts) > 2 else ""] and parts[3:] == ["controller", "bind"]:
            complex_id = parts[2]
            record = OPERATIONAL_STORE.get_complex(complex_id)
            if not record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            device_id = str(body.get("deviceId", "")).strip()
            endpoint = str(body.get("endpoint", "")).strip().rstrip("/")
            if not device_id or not endpoint:
                self._json(422, {"error": {"code": "CONTROLLER_BINDING_INVALID", "message": "deviceId and endpoint are required."}})
                return
            for other in OPERATIONAL_STORE.context()["complexes"]:
                if str(other.get("id")) != complex_id and str((other.get("esp32") or {}).get("deviceId") or "") == device_id:
                    self._json(409, {"error": {"code": "CONTROLLER_ALREADY_BOUND", "message": "This ESP32 controller is already bound to another Complex."}})
                    return
            current = dict(record.get("esp32") or {})
            current.update({
                "online": True,
                "lastSync": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "deviceId": device_id,
                "endpoint": endpoint,
                "apiVersion": body.get("apiVersion"),
                "schemaVersion": body.get("schemaVersion"),
                "inventoryVersion": body.get("inventoryVersion"),
                "firmwareVersion": body.get("firmwareVersion"),
                "hardwareModel": body.get("hardwareModel"),
                "synchronized": False,
            })
            record["esp32"] = current
            OPERATIONAL_STORE.save_complex(record)
            self._json(200, record)
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "complexes":
            complex_id = parts[2]
            record = OPERATIONAL_STORE.get_complex(complex_id)
            if not record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            record.update({k: body[k] for k in ("code", "name", "location", "status") if k in body})
            if isinstance(body.get("esp32"), dict):
                merged_esp32 = dict(record.get("esp32") or {}); merged_esp32.update(body["esp32"]); record["esp32"] = merged_esp32
            OPERATIONAL_STORE.save_complex(record)
            self._json(200, record)
            return
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "greenhouses":
            complex_id = parts[2]
            complex_record = OPERATIONAL_STORE.get_complex(complex_id)
            if not complex_record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            crop = str(body.get("crop", "")).strip()
            if not crop:
                self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "Crop is required."}})
                return
            existing = OPERATIONAL_STORE.list_greenhouses(complex_id)
            next_num = 1
            used = {str(x.get("id", "")) for x in existing}
            while f"gh-{next_num:02d}" in used:
                next_num += 1
            gh_id = str(body.get("id") or f"gh-{next_num:02d}")
            code = str(body.get("code") or f"GH {next_num:02d}").strip()
            tag = str(body.get("greenhouseTag") or code).strip()
            record = _new_greenhouse_payload(gh_id, complex_id, code, crop, tag)
            OPERATIONAL_STORE.save_greenhouse(record)
            complex_record["greenhouseIds"] = [*complex_record.get("greenhouseIds", []), gh_id]
            OPERATIONAL_STORE.save_complex(complex_record)
            self._json(201, RESEARCH_STORE.enrich_greenhouse(dict(record)))
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "greenhouses":
            gh_id = parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            for key in ("code", "crop", "greenhouseTag"):
                if key in body:
                    value = str(body[key]).strip()
                    if not value:
                        self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": f"{key} is required."}})
                        return
                    record[key] = value
            if "cropTimelineConfig" in body:
                timeline = body["cropTimelineConfig"]
                if timeline is not None and (not isinstance(timeline, dict) or not isinstance(timeline.get("targetHarvestHst"), (int, float)) or timeline.get("targetHarvestHst") <= 0 or not isinstance(timeline.get("points"), list) or not isinstance(timeline.get("maintenance", []), list)):
                    self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "Invalid cropTimelineConfig."}})
                    return
                record["cropTimelineConfig"] = timeline
            OPERATIONAL_STORE.save_greenhouse(record)
            self._json(200, RESEARCH_STORE.enrich_greenhouse(dict(record)))
            return

        if len(parts) == 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "schedules":
            complex_id = parts[2]
            complex_record = OPERATIONAL_STORE.get_complex(complex_id)
            if not complex_record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            kind = str(body.get("kind", ""))
            item = body.get("item")
            try:
                bucket = _schedule_bucket(kind)
                if not isinstance(item, dict): raise ValueError("item is required")
                if not item.get("id"):
                    prefix = {"fertigationSchedules": "fs", "fanSchedules": "fan", "wellPumpSchedules": "wp"}[bucket]
                    item["id"] = f"{prefix}-{complex_id}-{__import__('time').time_ns()}"
                if bucket == "wellPumpSchedules":
                    if str(item.get("complexId")) != complex_id: raise ValueError("Schedule complexId does not match route")
                    schedules = list(complex_record.get(bucket, []))
                    schedules = [*schedules, item]
                    complex_record[bucket] = schedules
                    OPERATIONAL_STORE.save_complex(complex_record)
                else:
                    gh_id = str(item.get("ghId", ""))
                    greenhouse = OPERATIONAL_STORE.get_greenhouse(gh_id)
                    if not greenhouse or greenhouse.get("complexId") != complex_id: raise ValueError("Schedule GH does not belong to this Complex")
                    schedules = list(greenhouse.get(bucket, []))
                    schedules = [*schedules, item]
                    greenhouse[bucket] = schedules
                    OPERATIONAL_STORE.save_greenhouse(greenhouse)
                self._json(201, {"schedule": item})
            except ValueError as exc:
                self._json(422, {"error": {"code": "INVALID_SCHEDULE", "message": str(exc)}})
            return

        if len(parts) == 3 and parts[0] == "api" and parts[1] == "schedules":
            schedule_id = parts[2]
            found = _find_schedule(schedule_id)
            if not found:
                self._json(404, {"error": {"code": "SCHEDULE_NOT_FOUND", "message": "Schedule not found."}})
                return
            kind = str(body.get("kind", ""))
            item = body.get("item")
            if not isinstance(item, dict):
                self._json(422, {"error": {"code": "INVALID_SCHEDULE", "message": "item is required."}})
                return
            try:
                bucket = _schedule_bucket(kind)
                if bucket != found[3]: raise ValueError("Schedule kind does not match stored schedule")
                owner_kind, owner, schedules, _ = found
                for index, existing in enumerate(schedules):
                    if str(existing.get("id")) == schedule_id:
                        item["id"] = schedule_id
                        if owner_kind == "greenhouse": owner[bucket][index] = item; OPERATIONAL_STORE.save_greenhouse(owner)
                        else: owner[bucket][index] = item; OPERATIONAL_STORE.save_complex(owner)
                        self._json(200, {"schedule": item})
                        return
            except ValueError as exc:
                self._json(422, {"error": {"code": "INVALID_SCHEDULE", "message": str(exc)}})
            return

        if len(parts) >= 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "esp32" and parts[4] == "commands":
            complex_id = parts[2]
            if "commandId" not in body or "type" not in body:
                self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "commandId and type are required."}})
                return
            self._proxy_esp32_command(complex_id, body)
            return
        if len(parts) >= 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "esp32" and parts[4] == "emergency-stop":
            complex_id = parts[2]
            command_id = body.get("commandId") or f"estop-{__import__('time').time_ns()}"
            command = {
                "commandId": command_id,
                "type": "EMERGENCY_STOP",
                "targetComplexId": complex_id,
                "source": "PYTHON_BACKEND",
                "parameters": {"reason": body.get("reason", "Emergency stop requested through backend")},
            }
            self._proxy_esp32_command(complex_id, command)
            return
        if len(parts) >= 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "sensors":
            complex_id = parts[2]
            errors = validate_sensor_definition(body)
            if errors:
                self._json(422, {"valid": False, "errors": errors})
                return
            body["complexId"] = complex_id
            sensors = CALIBRATION_REPO.sensors()
            if body.get("complexId") != complex_id:
                self._json(409, {"error": {"code": "COMPLEX_MISMATCH", "message": "Sensor complexId must match the route."}})
                return
            duplicate_channel = next((s for s in sensors if s.get("sensorId") != body.get("sensorId") and s.get("source") == body.get("source") and s.get("channel") == body.get("channel") and body.get("channel") is not None), None)
            if duplicate_channel:
                self._json(409, {"error": {"code": "SENSOR_CHANNEL_CONFLICT", "message": "Source/channel is already assigned to another sensor."}})
                return
            self._json(200, {"valid": True, "sensor": CALIBRATION_REPO.save_sensor(body)})
            return
        if len(parts) >= 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "sensors" and parts[4] == "sample":
            complex_id = parts[2]
            sensor_id = body.get("sensorId")
            definition = next((x for x in CALIBRATION_REPO.sensors(complex_id) if x.get("sensorId") == sensor_id), None)
            if not definition:
                self._json(404, {"error": {"code": "SENSOR_NOT_FOUND", "message": "Sensor definition not found for this Complex."}})
                return
            if definition.get("complexId") != complex_id:
                self._json(409, {"error": {"code": "COMPLEX_MISMATCH", "message": "Sensor belongs to another Complex."}})
                return
            sample = normalize_sensor_sample(definition, body.get("value"), body.get("timestampMs"), body.get("quality"))
            definition["lastSampleTimestampMs"] = sample["timestampMs"]
            CALIBRATION_REPO.save_sensor(definition)
            self._json(200, {"complexId": complex_id, "sample": sample})
            return
        if len(parts) >= 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "calibrations":
            complex_id = parts[2]
            ctype = str(body.get("calibrationType", "")).upper()
            cid = str(body.get("componentId", ""))
            operator = str(body.get("operator", "")).strip()
            requested_version = body.get("version")
            version = int(requested_version) if isinstance(requested_version, (int, float)) and int(requested_version) > 0 else CALIBRATION_REPO.next_version(cid, ctype, complex_id)
            calibration_id = str(body.get("calibrationId") or "").strip() or None
            try:
                if not cid or not operator or not complex_id:
                    raise ValueError("componentId, operator and Complex ownership are required")
                if ctype == "DOSING_RATE":
                    record = build_dosing_calibration(cid, float(body["measuredMl"]), float(body["durationSec"]), operator, version=version, state=str(body.get("state", "CALIBRATED")), calibration_id=calibration_id, valid_for_days=body.get("validForDays"), complex_id=complex_id)
                else:
                    record = build_linear_calibration(cid, ctype, float(body["inputOne"]), float(body["outputOne"]), float(body["inputTwo"]), float(body["outputTwo"]), operator, version=version, state=str(body.get("state", "CALIBRATED")), calibration_id=calibration_id, valid_until_ms=body.get("validUntilMs"), complex_id=complex_id)
                self._json(201, {"complexId": complex_id, "calibration": self._record_json(CALIBRATION_REPO.save(record))})
            except (KeyError, TypeError, ValueError) as exc:
                self._json(422, {"error": {"code": "INVALID_CALIBRATION", "message": str(exc)}})
            return
        if len(parts) >= 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "fertigation" and parts[4] == "prepare":
            complex_id = parts[2]
            configuration = body.get("configuration") or {}
            if configuration.get("complexId") != complex_id:
                self._json(409, {"error": {"code": "COMPLEX_MISMATCH", "message": "Path complexId does not match configuration."}})
                return
            result = prepare_run(configuration, body.get("request") or body, CALIBRATION_REPO, FERTIGATION_REPO.list(complex_id))
            self._json(200 if result.get("valid") else 422, result)
            return
        if len(parts) == 6 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "resources" and parts[5] == "transfer":
            complex_id, resource_id = parts[2], parts[4]
            configuration = body.get("configuration") or {}
            if configuration.get("complexId") != complex_id:
                self._json(409, {"error": {"code": "COMPLEX_MISMATCH", "message": "Path complexId does not match configuration."}}); return
            try:
                result = transfer_resource(configuration, resource_id, body.get("targetGhId"), physical_move_confirmed=bool(body.get("physicalMoveConfirmed")), operator=body.get("operator"))
                self._json(200, result)
            except (TypeError, ValueError, KeyError) as exc:
                self._json(422, {"error": {"code": "RESOURCE_TRANSFER_BLOCKED", "message": str(exc)}})
            return
        if len(parts) >= 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] in {"compile", "deploy"}:
            complex_id = parts[2]
            configuration = body.get("configuration") or {}
            if configuration.get("complexId") != complex_id:
                self._json(409, {"error": {"code": "COMPLEX_MISMATCH", "message": "Path complexId does not match configuration."}})
                return
            schedules, fertigation_blocks = _enrich_fertigation_schedules(configuration, body.get("schedules") or [])
            if fertigation_blocks:
                result = compile_schedule_set(configuration, schedules, body.get("activeLocks") or [])
                result["valid"] = False
                result["blocked"] = [*result.get("blocked", []), *fertigation_blocks]
                if parts[3] == "compile":
                    self._json(422, result)
                    return
                self._json(422, result)
                return
            result = compile_schedule_set(configuration, schedules, body.get("activeLocks") or [])
            if parts[3] == "compile":
                self._json(200, result)
                return
            if not result["valid"]:
                self._json(422, result)
                return
            RECOVERY_STORE.set_deployment(complex_id, desired_version=int(configuration.get("version") or 0), desired_hash=configuration.get("configurationHash"), status="PENDING_DEPLOYMENT")
            esp32_base = str(body.get("esp32BaseUrl") or os.getenv("ESP32_API_BASE", "")).rstrip("/")
            if not esp32_base:
                self._json(202, {"status": "READY_FOR_DEVICE", "deployment": RECOVERY_STORE.get_deployment(complex_id), **result})
                return
            payload = {
                "deploymentId": body.get("deploymentId") or f"deployment-{configuration.get('version', 0)}",
                "configurationVersion": configuration.get("version", 0),
                "configurationHash": configuration.get("configurationHash"),
                "compiled": result["compiled"],
            }
            request = Request(
                f"{esp32_base}/api/v1/schedules/compiled",
                data=json.dumps({"requestId": body.get("requestId", "backend-schedule-deploy"), "client": {"type": "PythonBackend", "version": "0.1.0"}, "payload": payload}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"},
            )
            try:
                with urlopen(request, timeout=8) as response:
                    device = json.loads(response.read().decode("utf-8"))
            except Exception as exc:
                self._json(502, {"status": "DEVICE_DEPLOY_FAILED", "error": str(exc), "compiled": result["compiled"]})
                return
            self._json(200, {"status": "DEPLOYED", "result": result, "device": device})
            return
        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Endpoint not found."}})


    def do_PUT(self) -> None:  # noqa: N802
        try:
            body = self._read_json()
        except Exception as exc:
            self._json(400, {"error": {"code": "INVALID_JSON", "message": str(exc)}})
            return
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if len(parts) == 5 and parts[0:3] == ["api", "complexes", parts[2] if len(parts) > 2 else ""] and parts[3:5] == ["esp32", "configuration"]:
            cid = parts[2]
            if not OPERATIONAL_STORE.get_complex(cid):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}}); return
            if not os.getenv("ESP32_API_BASE"):
                self._json(503, {"error": {"code": "DEVICE_OFFLINE", "message": "ESP32 API target is not configured.", "retryable": True}}); return
            config = body.get("configuration") if isinstance(body, dict) else None
            if not isinstance(config, dict): config = body
            expected = body.get("expectedVersion", config.get("version", 0)) if isinstance(body, dict) else 0
            payload = {"requestId": body.get("requestId") or f"backend-deploy-{time.time_ns()}",
                       "client": body.get("client") or {"type": "PythonBackend", "version": "0.1.0"},
                       "payload": {"expectedVersion": expected,
                                   "deploymentId": body.get("deploymentId") or f"deploy-{time.time_ns()}",
                                   "configuration": config}}
            try:
                request = Request(f"{str(os.getenv('ESP32_API_BASE')).rstrip('/')}/api/v1/configuration", data=json.dumps(payload).encode("utf-8"), method="PUT",
                                  headers={"Content-Type": "application/json", "Accept": "application/json", "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"})
                with urlopen(request, timeout=8) as response:
                    device = json.loads(response.read().decode("utf-8"))
                    envelope_data = device.get("data", device) if isinstance(device, dict) else device
                    data = envelope_data.get("payload", envelope_data) if isinstance(envelope_data, dict) else envelope_data
                    if isinstance(envelope_data, dict):
                        active_version = int(envelope_data.get("configurationVersion") or (data.get("version", 0) if isinstance(data, dict) else 0))
                        RECOVERY_STORE.set_deployment(cid, deployment_id=envelope_data.get("deploymentId") or payload["payload"]["deploymentId"],
                                                      desired_version=active_version, desired_hash=envelope_data.get("configurationHash"),
                                                      device_version=active_version, device_hash=envelope_data.get("configurationHash"),
                                                      previous_version=int(envelope_data.get("previousConfigurationVersion") or 0), status=str(envelope_data.get("deploymentStatus") or "ACTIVE"))
                    self._json(response.status, data); return
            except HTTPError as exc:
                try: err_body=json.loads(exc.read().decode("utf-8"))
                except Exception: err_body={"error":{"code":"DEVICE_REQUEST_FAILED","message":str(exc)}}
                self._json(exc.code, err_body); return
            except Exception as exc:
                RECOVERY_STORE.set_deployment(cid, deployment_id=payload["payload"]["deploymentId"], desired_version=int(config.get("version",0) or 0), desired_hash=config.get("configurationHash"), status="PENDING_DEPLOYMENT")
                self._json(502, {"error":{"code":"DEVICE_REQUEST_FAILED","message":str(exc),"retryable":True,"reconcileRequired":True}}); return
        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Endpoint not found."}})

    def do_DELETE(self) -> None:  # noqa: N802
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if len(parts) >= 6 and parts[0:2] == ["api", "complexes"] and parts[3] == "research":
            cid, resource, record_id = parts[2], parts[4], parts[5]
            if resource == "observations":
                deleted = RESEARCH_STORE.delete_observation(record_id)
                self._json(200, {"deleted": deleted, "observationId": record_id, "complexId": cid}); return
            self._json(405, {"error": {"code": "RESEARCH_DELETE_NOT_SUPPORTED", "message": "Only observations can be deleted; plant/fruit/cycle records are retained for research history."}}); return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "schedules":
            schedule_id = parts[2]
            found = _find_schedule(schedule_id)
            if not found:
                self._json(404, {"error": {"code": "SCHEDULE_NOT_FOUND", "message": "Schedule not found."}})
                return
            owner_kind, owner, schedules, bucket = found
            owner[bucket] = [x for x in schedules if str(x.get("id")) != schedule_id]
            if owner_kind == "greenhouse": OPERATIONAL_STORE.save_greenhouse(owner)
            else: OPERATIONAL_STORE.save_complex(owner)
            self._json(200, {"deleted": True, "scheduleId": schedule_id})
            return
        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Endpoint not found."}})


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8090"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"AgroTech backend listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
