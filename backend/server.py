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

try:
    from .deletion_store import DELETION_STORE
    from .deletion_manager import DELETION_MANAGER
except ImportError:
    from deletion_store import DELETION_STORE
    from deletion_manager import DELETION_MANAGER

CALIBRATION_REPO = CalibrationRepository(os.getenv("AGROTECH_CALIBRATION_DB", "./agrotech_calibration.sqlite3"))
FERTIGATION_REPO = FertigationRunRepository(os.getenv("AGROTECH_FERTIGATION_DB", "./agrotech_fertigation.sqlite3"))

try:
    from .topology_pool import SystemTopologyPool, TopologyConflictError
except ImportError:
    from topology_pool import SystemTopologyPool, TopologyConflictError

TOPOLOGY_POOL = SystemTopologyPool(os.getenv("AGROTECH_OPERATIONAL_DB", "./agrotech_operational.sqlite3"), local_device_id="BACKEND-MIRROR")


def _decode_bytes_tolerantly(raw: bytes) -> str:
    """Decode bytes to str, trying UTF-8 first, falling back to Latin-1, then errors='replace'."""
    if not raw:
        return ""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return raw.decode("latin-1")
        except Exception:
            return raw.decode("utf-8", errors="replace")


def _decode_and_load_json(raw: bytes) -> Any:
    """Decode bytes tolerantly and parse as JSON."""
    if not raw:
        return {}
    text = _decode_bytes_tolerantly(raw)
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON response ({len(raw)} bytes): {text[:200]!r}") from exc


def _sync_topology_pool_with_store() -> None:
    try:
        ctx = OPERATIONAL_STORE.context()
        for c in ctx.get("complexes", []):
            cid = c.get("id")
            name = c.get("name") or cid
            owner = (c.get("esp32") or {}).get("deviceId") or "BACKEND-MIRROR"
            try:
                TOPOLOGY_POOL.apply_mutation({
                    "operation": "CREATE_COMPLEX",
                    "complexId": cid,
                    "name": name,
                    "ownerDeviceId": owner
                })
            except Exception:
                pass
            if owner and owner != "BACKEND-MIRROR":
                endpoint = (c.get("esp32") or {}).get("endpoint") or ""
                TOPOLOGY_POOL.register_device(owner, endpoint=endpoint, owner_complex_ids=[cid], device_state="BOUND")
        for g in ctx.get("greenhouses", []):
            gid = g.get("id")
            cid = g.get("complexId")
            name = g.get("name") or gid
            try:
                TOPOLOGY_POOL.apply_mutation({
                    "operation": "CREATE_GREENHOUSE",
                    "ghId": gid,
                    "complexId": cid,
                    "name": name
                })
            except Exception:
                pass
    except Exception:
        pass

def _to_schedule_intent(raw: dict[str, Any], complex_id: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return raw
    if "action" in raw and "trigger" in raw:
        item = dict(raw)
        if not item.get("complexId"):
            item["complexId"] = complex_id
        return item
    item = dict(raw)
    sid = str(item.get("id") or item.get("scheduleId") or "")
    repeat_str = str(item.get("repeat") or "Daily").lower()
    time_str = str(item.get("time") or "08:00")
    try:
        hour, minute = [int(x) for x in time_str.split(":")[:2]]
    except Exception:
        hour, minute = 8, 0
    days_of_week = 31 if "weekday" in repeat_str else (96 if "weekend" in repeat_str else 127)
    trigger = {"type": "DAILY", "hour": hour, "minute": minute, "daysOfWeek": days_of_week}

    if "targetWaterL" in item or sid.startswith("fs-") or sid.startswith("fert-"):
        target_water_l = float(item.get("targetWaterL") or 100)
        return {
            "scheduleId": sid,
            "ownerId": sid,
            "complexId": complex_id,
            "ghId": item.get("ghId"),
            "action": "FERTIGATION",
            "enabled": item.get("enabled", True),
            "priority": 100,
            "trigger": trigger,
            "recipeId": item.get("recipeId"),
            "missedRunPolicy": str(item.get("missedPolicy") or "SKIP").upper(),
            "parameters": {
                "rawWaterVolumeMl": int(target_water_l * 1000),
                "targetMode": item.get("targetMode", "recipe"),
                "targetPpm": item.get("targetPpm"),
                "durationSec": max(1, int(target_water_l * 30)),
                "automaticDosing": True,
            }
        }
    elif "task" in item or sid.startswith("wp-") or sid.startswith("pump-"):
        dur_sec = int(item.get("durationSeconds") or 0)
        if dur_sec <= 0:
            dur_min = float(item.get("durationMin") or 15)
            dur_sec = max(1, int(dur_min * 60))
        interval_min = int(item.get("intervalMinutes") or 0)
        if interval_min > 0:
            trigger = {"type": "INTERVAL", "intervalMin": interval_min}
        return {
            "scheduleId": sid,
            "ownerId": sid,
            "complexId": complex_id,
            "action": "WATER_PUMP",
            "enabled": item.get("enabled", True),
            "priority": 100,
            "trigger": trigger,
            "missedRunPolicy": "SKIP",
            "parameters": {
                "durationSec": dur_sec
            }
        }
    else:
        duration_min = float(item.get("durationMin") or 15)
        return {
            "scheduleId": sid,
            "ownerId": sid,
            "complexId": complex_id,
            "ghId": item.get("ghId"),
            "action": "FAN_TOGGLE",
            "enabled": item.get("enabled", True),
            "priority": 100,
            "trigger": trigger,
            "missedRunPolicy": "SKIP",
            "parameters": {
                "durationSec": max(1, int(duration_min * 60)),
                "controlMode": "TEMPERATURE" if item.get("mode") == "temperature" else "TIME",
                "onAboveC": item.get("onAboveC"),
                "offBelowC": item.get("offBelowC"),
            }
        }


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
    _controller_health_cache: dict[str, tuple[float, bool, dict[str, Any]]] = {}

    def _probe_controller_live(self, endpoint: str) -> tuple[bool, dict[str, Any]]:
        if not endpoint:
            return False, {}
        now = time.time()
        cached = Handler._controller_health_cache.get(endpoint)
        if cached and (now - cached[0]) < 4.0:
            return cached[1], cached[2]

        clean_ep = endpoint.rstrip("/")
        try:
            req = Request(
                f"{clean_ep}/api/v1/health",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"
                }
            )
            with urlopen(req, timeout=1.5) as res:
                if res.status == 200:
                    data = _decode_and_load_json(res.read())
                    health = self._unwrap_esp32_payload(data)
                    info = health if isinstance(health, dict) else {}
                    Handler._controller_health_cache[endpoint] = (now, True, info)
                    return True, info
        except Exception:
            pass
        Handler._controller_health_cache[endpoint] = (now, False, {})
        return False, {}

    def _context_with_research(self) -> dict[str, Any]:
        context = OPERATIONAL_STORE.context()
        complexes = context.get("complexes", [])
        greenhouses = context.get("greenhouses", [])
        complex_online_map: dict[str, bool] = {}

        for c in complexes:
            cid = c.get("id")
            ep = self._get_esp32_endpoint_for_complex(cid)
            esp32 = dict(c.get("esp32") or {})
            if ep:
                is_live, health = self._probe_controller_live(ep)
                if is_live:
                    esp32["online"] = True
                    esp32["endpoint"] = ep
                    esp32["lastSync"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    if health.get("deviceId"): esp32["deviceId"] = health["deviceId"]
                    if health.get("firmwareVersion"): esp32["firmwareVersion"] = health["firmwareVersion"]
                    if health.get("hardwareModel"): esp32["hardwareModel"] = health["hardwareModel"]
                    if health.get("apiVersion"): esp32["apiVersion"] = health["apiVersion"]
                    if health.get("schemaVersion"): esp32["schemaVersion"] = health["schemaVersion"]
                    c["status"] = "Active"
                    c["systemStatus"] = "NORMAL"
                else:
                    esp32["online"] = False
                    c["systemStatus"] = "WARNING"
            c["esp32"] = esp32
            complex_online_map[cid] = bool(esp32.get("online"))

        enriched_ghs = []
        for g in greenhouses:
            g_dict = dict(g)
            cid = str(g_dict.get("complexId") or "")
            is_parent_online = complex_online_map.get(cid, False)
            g_dict["online"] = is_parent_online
            if is_parent_online:
                g_dict["health"] = "NORMAL"
            enriched_ghs.append(RESEARCH_STORE.enrich_greenhouse(g_dict))

        return {"complexes": complexes, "greenhouses": enriched_ghs}

    def _sync_snapshot(self, complex_id: str) -> dict[str, Any]:
        complex_record = OPERATIONAL_STORE.get_complex(complex_id)
        if not complex_record:
            raise ValueError("COMPLEX_NOT_FOUND")
        ep = self._get_esp32_endpoint_for_complex(complex_id)
        esp32 = dict(complex_record.get("esp32") or {})
        if ep:
            is_live, health = self._probe_controller_live(ep)
            esp32["online"] = is_live
            if is_live:
                esp32["endpoint"] = ep
                if health.get("deviceId"): esp32["deviceId"] = health["deviceId"]
                if health.get("firmwareVersion"): esp32["firmwareVersion"] = health["firmwareVersion"]
                complex_record["status"] = "Active"
                complex_record["systemStatus"] = "NORMAL"
            else:
                complex_record["systemStatus"] = "WARNING"
        complex_record["esp32"] = esp32
        ghs = []
        for g in OPERATIONAL_STORE.list_greenhouses(complex_id):
            g_dict = dict(g)
            g_dict["online"] = bool(esp32.get("online"))
            if esp32.get("online"):
                g_dict["health"] = "NORMAL"
            ghs.append(RESEARCH_STORE.enrich_greenhouse(g_dict))
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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept,Content-Type,Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        size = int(self.headers.get("Content-Length", "0"))
        if size > 512 * 1024:
            raise ValueError("request body too large")
        return _decode_and_load_json(self.rfile.read(size))

    def _assert_complex_unlocked(self, complex_id: str | None) -> bool:
        if not complex_id:
            return True
        if DELETION_MANAGER.is_complex_locked(complex_id):
            self._json(409, {
                "error": {
                    "code": "COMPLEX_DELETION_IN_PROGRESS",
                    "message": f"Complex '{complex_id}' deletion is in progress.",
                }
            })
            return False
        return True


    @staticmethod
    def _unwrap_esp32_payload(device: Any) -> Any:
        if not isinstance(device, dict):
            return device
        data = device.get("data", device)
        if isinstance(data, dict) and "payload" in data:
            return data["payload"]
        return data

    def _get_esp32_endpoint_for_complex(self, complex_id: str | None) -> str:
        base = str(os.getenv("ESP32_API_BASE", "")).rstrip("/")
        if not complex_id:
            if base: return base
            for dev in TOPOLOGY_POOL.devices.values():
                if dev.get("endpoint"): return str(dev["endpoint"]).rstrip("/")
            return ""
        c = OPERATIONAL_STORE.get_complex(complex_id)
        if c:
            ep = (c.get("esp32") or {}).get("endpoint")
            if ep:
                return str(ep).rstrip("/")
            owner = c.get("ownerDeviceId")
            if owner and owner in TOPOLOGY_POOL.devices:
                ep = TOPOLOGY_POOL.devices[owner].get("endpoint")
                if ep:
                    return str(ep).rstrip("/")
        for dev in TOPOLOGY_POOL.devices.values():
            if dev.get("endpoint"):
                return str(dev["endpoint"]).rstrip("/")
        return base

    def _get_esp32_endpoint_for_gh(self, gh_id: str | None) -> str:
        if not gh_id:
            return str(os.getenv("ESP32_API_BASE", "")).rstrip("/")
        gh = OPERATIONAL_STORE.get_greenhouse(gh_id)
        if gh:
            cid = str(gh.get("complexId") or "")
            if cid:
                return self._get_esp32_endpoint_for_complex(cid)
        return str(os.getenv("ESP32_API_BASE", "")).rstrip("/")

    def _esp32_forward_request(
        self, endpoint: str, path: str, method: str = "GET", payload: dict[str, Any] | None = None, timeout: float = 6.0
    ) -> tuple[int, Any]:
        """Forward request to authoritative ESP32, returning (status_code, response_data)."""
        esp32_base = str(endpoint or "").rstrip("/")
        if not esp32_base:
            return 503, {"error": {"code": "DEVICE_OFFLINE", "message": "ESP32 endpoint is not configured."}}
        data_bytes = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = Request(
            f"{esp32_base}{path}",
            data=data_bytes,
            method=method,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}",
            },
        )
        try:
            with urlopen(req, timeout=timeout) as response:
                body = _decode_and_load_json(response.read())
                return response.status, body
        except HTTPError as exc:
            try:
                body = _decode_and_load_json(exc.read())
            except Exception:
                body = {"error": {"code": "UPSTREAM_HTTP_ERROR", "message": str(exc)}}
            return exc.code, body
        except Exception as exc:
            return 502, {"error": {"code": "DEVICE_UNREACHABLE", "message": str(exc)}}

    @staticmethod
    def _format_crop_cycle_data(cycle: dict[str, Any] | None, gh_id: str) -> dict[str, Any]:
        if not cycle or cycle.get("status") in ("NO_CYCLE", None):
            return {
                "ghId": gh_id,
                "cycleId": None,
                "status": "NO_CYCLE",
                "tanggalTanam": None,
                "tanggalPolinasi": None,
                "variety": None,
                "plantCount": None,
                "notes": None,
                "hst": None,
                "hsp": None,
                "targetHarvestHst": None,
                "cropTimelineConfig": None,
                "version": 0,
                "lastHarvestSummary": None,
            }
        import datetime
        now_dt = datetime.datetime.now(datetime.timezone.utc).date()
        hst = None
        hsp = None
        status = str(cycle.get("status", "ACTIVE")).upper()
        tanam_str = cycle.get("plantingDate") or cycle.get("tanggalTanam")
        polinasi_str = cycle.get("pollinationDate") or cycle.get("tanggalPolinasi")
        if status == "ACTIVE" and tanam_str:
            try:
                p_date = datetime.date.fromisoformat(str(tanam_str)[:10])
                hst = max(0, (now_dt - p_date).days)
            except Exception:
                hst = cycle.get("hst")
        if status == "ACTIVE" and polinasi_str:
            try:
                pol_date = datetime.date.fromisoformat(str(polinasi_str)[:10])
                hsp = max(0, (now_dt - pol_date).days)
            except Exception:
                hsp = cycle.get("hsp")
        harvest_summary = None
        if cycle.get("actualHarvestDate") or cycle.get("harvestDate"):
            harvest_summary = {
                "harvestDate": cycle.get("actualHarvestDate") or cycle.get("harvestDate"),
                "yieldKg": cycle.get("yieldKg"),
                "grade": cycle.get("grade"),
                "notes": cycle.get("notes"),
            }
        target_harvest_hst = cycle.get("targetHarvestHst")
        timeline_config = cycle.get("cropTimelineConfig")
        if (target_harvest_hst is None or timeline_config is None) and gh_id:
            gh_rec = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if gh_rec:
                if target_harvest_hst is None:
                    target_harvest_hst = (gh_rec.get("cropCycle") or {}).get("targetHarvestHst") or (gh_rec.get("cropTimelineConfig") or {}).get("targetHarvestHst")
                if timeline_config is None:
                    timeline_config = (gh_rec.get("cropCycle") or {}).get("cropTimelineConfig") or gh_rec.get("cropTimelineConfig")
        return {
            "cycleId": cycle.get("cycleId"),
            "ghId": gh_id,
            "status": status,
            "tanggalTanam": tanam_str,
            "tanggalPolinasi": polinasi_str,
            "variety": cycle.get("variety"),
            "plantCount": cycle.get("plantCount"),
            "notes": cycle.get("notes"),
            "hst": hst if hst is not None else cycle.get("hst"),
            "hsp": hsp if hsp is not None else cycle.get("hsp"),
            "targetHarvestHst": target_harvest_hst,
            "cropTimelineConfig": timeline_config,
            "version": int(cycle.get("version") or 1),
            "lastHarvestSummary": harvest_summary,
        }

    def _envelope_crop_cycle(self, cycle: dict[str, Any] | None, gh_id: str, req_id: str | None = None) -> dict[str, Any]:
        data = self._format_crop_cycle_data(cycle, gh_id)
        import datetime
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        return {
            "requestId": req_id or f"req-cc-{int(time.time()*1000)}",
            "success": True,
            "deviceTimestamp": now_iso,
            "data": data,
        }

    def _esp32_get_json(self, endpoint: str, path: str, expected_complex_id: str | None = None) -> Any:
        """GET an authoritative ESP32 endpoint and return its unwrapped data."""
        esp32_base = str(endpoint or "").rstrip("/")
        if not esp32_base:
            raise RuntimeError("ESP32 endpoint is not configured")
        request = Request(
            f"{esp32_base}{path}",
            method="GET",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}",
            },
        )
        with urlopen(request, timeout=8) as response:
            payload = _decode_and_load_json(response.read())
        data = self._unwrap_esp32_payload(payload)
        if expected_complex_id and isinstance(data, dict) and data.get("complexId") and data.get("complexId") != expected_complex_id:
            raise ValueError("ESP32 response belongs to another Complex")
        return data

    def _esp32_request_json(self, complex_id: str, path: str) -> Any:
        """Read an authoritative device endpoint configured for an existing Complex."""
        esp32_base = self._get_esp32_endpoint_for_complex(complex_id)
        if not esp32_base:
            raise RuntimeError("ESP32_API_BASE is not configured")
        return self._esp32_get_json(esp32_base, path, expected_complex_id=complex_id)

    def _esp32_post_json(self, endpoint: str, path: str, payload: dict[str, Any]) -> Any:
        """POST JSON to an authoritative ESP32 endpoint."""
        esp32_base = str(endpoint or "").rstrip("/")
        if not esp32_base:
            return None
        request = Request(
            f"{esp32_base}{path}",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}",
            },
        )
        with urlopen(request, timeout=5) as response:
            return _decode_and_load_json(response.read())

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
        esp32_base = str(command.get("esp32BaseUrl") or self._get_esp32_endpoint_for_complex(complex_id)).rstrip("/")
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
                device = _decode_and_load_json(response.read())
                self._json(response.status, self._unwrap_esp32_payload(device))
        except HTTPError as exc:
            try:
                body = _decode_and_load_json(exc.read())
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
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept,Content-Type,Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]

        # Favicon handler to avoid browser 404 console noise
        if parts == ["favicon.ico"]:
            self.send_response(204)
            self.end_headers()
            return

        # System Topology Pool mirror endpoints
        if parts in (["api", "v1", "topology-pool"], ["v1", "topology-pool"], ["api", "topology-pool"], ["topology-pool"]):
            self._json(200, TOPOLOGY_POOL.get_pool())
            return
        if parts in (["api", "v1", "topology-pool", "meta"], ["v1", "topology-pool", "meta"], ["api", "topology-pool", "meta"], ["topology-pool", "meta"]):
            self._json(200, TOPOLOGY_POOL.get_meta())
            return

        # Health check
        if parts in (["health"], ["api", "health"], ["api", "v1", "health"]):
            self._json(200, {"status": "OK", "backend": "Python"})
            return

        # Python-owned permanent Complex/GH master context.
        if parts == ["api", "context"]:
            self._json(200, self._context_with_research())
            return
        if len(parts) == 4 and parts[:2] == ["api", "complexes"] and parts[3] == "deletion-preview":
            cid = parts[2]
            try:
                preview = DELETION_MANAGER.get_deletion_preview(cid)
                self._json(200, preview)
            except ValueError as exc:
                if str(exc) == "COMPLEX_NOT_FOUND":
                    self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                else:
                    self._json(400, {"error": {"code": "INVALID_PREVIEW_REQUEST", "message": str(exc)}})
            except Exception as exc:
                self._json(500, {"error": {"code": "PREVIEW_FAILED", "message": str(exc)}})
            return
        if len(parts) == 3 and parts[:2] == ["api", "deletion-jobs"]:
            job_id = parts[2]
            try:
                job = DELETION_MANAGER.get_job_state(job_id)
                self._json(200, job)
            except ValueError as exc:
                if str(exc) == "JOB_NOT_FOUND":
                    self._json(404, {"error": {"code": "JOB_NOT_FOUND", "message": "Deletion job not found."}})
                else:
                    self._json(400, {"error": {"code": "INVALID_JOB_REQUEST", "message": str(exc)}})
            except Exception as exc:
                self._json(500, {"error": {"code": "GET_JOB_FAILED", "message": str(exc)}})
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
            ep = self._get_esp32_endpoint_for_complex(cid)
            is_online = bool((complex_record.get("esp32") or {}).get("online"))
            if ep:
                is_live, _ = self._probe_controller_live(ep)
                is_online = is_live
            self._json(200, {"complexId": cid, "online": is_online,
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
        if len(parts) == 4 and parts[0:2] == ["api", "complexes"] and parts[3] == "deletion-preview":
            complex_id = parts[2]
            try:
                preview = DELETION_MANAGER.get_deletion_preview(complex_id)
                self._json(200, preview)
            except ValueError:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "deletion-jobs":
            job_id = parts[2]
            try:
                job = DELETION_MANAGER.get_job_state(job_id)
                self._json(200, job)
            except ValueError:
                self._json(404, {"error": {"code": "JOB_NOT_FOUND", "message": "Deletion job not found."}})
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
        # Crop-cycle GET routes (canonical OpenAPI & backend mirror proxy)
        is_cc_single = (len(parts) == 5 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycle") or \
                       (len(parts) == 4 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycle")
        if is_cc_single:
            gh_id = parts[3] if len(parts) == 5 else parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycle", method="GET")
                if status_code == 200 and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    self._json(200, device_resp)
                    return
            c = RESEARCH_STORE.current_cycle(cid, gh_id)
            self._json(200, self._envelope_crop_cycle(c, gh_id))
            return

        is_cc_list = (len(parts) == 5 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles") or \
                     (len(parts) == 4 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles")
        if is_cc_list:
            gh_id = parts[3] if len(parts) == 5 else parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles", method="GET")
                if status_code == 200 and isinstance(device_resp, dict) and "data" in device_resp:
                    self._json(200, device_resp)
                    return
            cycles = RESEARCH_STORE.list_cycles(cid, gh_id)
            formatted = [self._format_crop_cycle_data(c, gh_id) for c in cycles]
            self._json(200, {
                "requestId": f"req-list-{int(time.time()*1000)}",
                "success": True,
                "data": {"items": formatted, "total": len(formatted), "hasMore": False, "nextCursor": None}
            })
            return

        if len(parts) == 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "esp32" and parts[4] in {"inventory", "configuration"}:
            complex_id = parts[2]
            c_rec = OPERATIONAL_STORE.get_complex(complex_id)
            saved_cfg = (c_rec or {}).get("configuration") if isinstance(c_rec, dict) else None

            esp32_base = self._get_esp32_endpoint_for_complex(complex_id)
            if not esp32_base:
                if parts[4] == "configuration":
                    if saved_cfg:
                        self._json(200, saved_cfg)
                        return
                    if c_rec:
                        ghs = OPERATIONAL_STORE.list_greenhouses(complex_id)
                        baseline = {
                            "complexId": complex_id,
                            "version": 0,
                            "configurationHash": None,
                            "complexes": [{"complexId": complex_id, "name": c_rec.get("name", complex_id)}],
                            "greenhouses": [{"ghId": g.get("id"), "complexId": complex_id, "name": g.get("code") or g.get("name")} for g in ghs],
                            "components": [],
                            "resources": [],
                            "assignments": [],
                            "topology": [],
                            "recipes": [r for g in ghs for r in g.get("recipes", [])],
                        }
                        self._json(200, baseline)
                        return
                elif parts[4] == "inventory":
                    if saved_cfg and saved_cfg.get("components") is not None:
                        self._json(200, {"deviceId": complex_id, "complexId": complex_id, "inventoryVersion": saved_cfg.get("version", 1), "components": saved_cfg.get("components")})
                        return
                self._json(503, {"error": {"code": "DEVICE_OFFLINE", "message": "ESP32 read target is not configured."}})
                return
            upstream_path = "/api/v1/inventory" if parts[4] == "inventory" else "/api/v1/configuration"
            request = Request(
                f"{esp32_base}{upstream_path}",
                method="GET",
                headers={"Accept": "application/json", "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"},
            )
            try:
                with urlopen(request, timeout=3) as response:
                    device = _decode_and_load_json(response.read())
                    unwrapped = self._unwrap_esp32_payload(device)
                    if isinstance(unwrapped, dict):
                        if parts[4] == "inventory" and (not unwrapped.get("components")) and saved_cfg and saved_cfg.get("components"):
                            unwrapped["components"] = saved_cfg["components"]
                            unwrapped["inventoryVersion"] = saved_cfg.get("version", 1)
                        elif parts[4] == "configuration" and (not unwrapped.get("components")) and saved_cfg and saved_cfg.get("components"):
                            unwrapped = saved_cfg
                    self._json(response.status, unwrapped)
            except HTTPError as exc:
                if parts[4] == "configuration":
                    if saved_cfg:
                        self._json(200, saved_cfg)
                        return
                    if exc.code == 404 and c_rec:
                        ghs = OPERATIONAL_STORE.list_greenhouses(complex_id)
                        baseline = {
                            "complexId": complex_id,
                            "version": 0,
                            "configurationHash": None,
                            "complexes": [{"complexId": complex_id, "name": c_rec.get("name", complex_id)}],
                            "greenhouses": [{"ghId": g.get("id"), "complexId": complex_id, "name": g.get("code") or g.get("name")} for g in ghs],
                            "components": [],
                            "resources": [],
                            "assignments": [],
                            "topology": [],
                            "recipes": [r for g in ghs for r in g.get("recipes", [])],
                        }
                        self._json(200, baseline)
                        return
                elif parts[4] == "inventory" and saved_cfg and saved_cfg.get("components") is not None:
                    self._json(200, {"deviceId": complex_id, "complexId": complex_id, "inventoryVersion": saved_cfg.get("version", 1), "components": saved_cfg.get("components")})
                    return
                try:
                    body = _decode_and_load_json(exc.read())
                except Exception:
                    body = {"error": {"code": "DEVICE_READ_FAILED", "message": str(exc)}}
                self._json(exc.code, body)
            except Exception as exc:
                if parts[4] == "configuration":
                    if saved_cfg:
                        self._json(200, saved_cfg)
                        return
                    if c_rec:
                        ghs = OPERATIONAL_STORE.list_greenhouses(complex_id)
                        baseline = {
                            "complexId": complex_id,
                            "version": 0,
                            "configurationHash": None,
                            "complexes": [{"complexId": complex_id, "name": c_rec.get("name", complex_id)}],
                            "greenhouses": [{"ghId": g.get("id"), "complexId": complex_id, "name": g.get("code") or g.get("name")} for g in ghs],
                            "components": [],
                            "resources": [],
                            "assignments": [],
                            "topology": [],
                            "recipes": [r for g in ghs for r in g.get("recipes", [])],
                        }
                        self._json(200, baseline)
                        return
                elif parts[4] == "inventory" and saved_cfg and saved_cfg.get("components") is not None:
                    self._json(200, {"deviceId": complex_id, "complexId": complex_id, "inventoryVersion": saved_cfg.get("version", 1), "components": saved_cfg.get("components")})
                    return
                self._json(502, {"error": {"code": "DEVICE_READ_FAILED", "message": str(exc)}})
            return
        if len(parts) == 6 and parts[0:3] == ["api", "complexes", parts[2] if len(parts) > 2 else ""] and parts[3:6] == ["esp32", "configuration", "deployment"]:
            cid = parts[2]
            if not OPERATIONAL_STORE.get_complex(cid):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            self._json(200, RECOVERY_STORE.get_deployment(cid))
            return
        if parts in (["api", "v1", "configuration", "deployment"], ["api", "configuration", "deployment"]):
            self._json(200, RECOVERY_STORE.get_deployment("complex-01"))
            return
        if parts in (["api", "v1", "configuration"], ["api", "configuration"]):
            c_rec = OPERATIONAL_STORE.get_complex("complex-01")
            saved_cfg = (c_rec or {}).get("configuration") if isinstance(c_rec, dict) else None
            if saved_cfg:
                self._json(200, saved_cfg)
                return
            self._json(200, {"complexId": "complex-01", "version": 0, "components": [], "assignments": [], "schedules": [], "recipes": [], "topology": [], "settings": {}})
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

        # System Topology Pool mirror endpoints
        if parts in (["api", "v1", "topology-pool", "sync"], ["v1", "topology-pool", "sync"], ["api", "topology-pool", "sync"], ["topology-pool", "sync"]):
            try:
                target_pool = body.get("pool", body) if isinstance(body, dict) else {}
                res = TOPOLOGY_POOL.reconcile_peer_pool(target_pool)
                self._json(200, res)
            except TopologyConflictError as exc:
                status_code = 409 if "OWNER" in exc.code else 422
                self._json(status_code, {"error": {"code": exc.code, "message": str(exc)}})
            except Exception as exc:
                self._json(500, {"error": {"code": "SYNC_FAILED", "message": str(exc)}})
            return

        if parts in (["api", "v1", "topology-pool", "reset"], ["v1", "topology-pool", "reset"], ["api", "topology-pool", "reset"], ["topology-pool", "reset"]):
            OPERATIONAL_STORE.clear_all()
            res = TOPOLOGY_POOL.reset_pool()
            self._json(200, {"status": "RESET_SUCCESS", "pool": res})
            return

        if parts in (["api", "v1", "topology-pool", "mutate"], ["v1", "topology-pool", "mutate"], ["api", "topology-pool", "mutate"], ["topology-pool", "mutate"]):
            try:
                res = TOPOLOGY_POOL.apply_mutation(body)
                self._json(200, res)
            except TopologyConflictError as exc:
                status_code = 409 if "OWNER" in exc.code else 422
                self._json(status_code, {"error": {"code": exc.code, "message": str(exc)}})
            except Exception as exc:
                self._json(500, {"error": {"code": "MUTATION_FAILED", "message": str(exc)}})
            return

        if len(parts) == 6 and parts[0:3] == ["api", "complexes", parts[2] if len(parts) > 2 else ""] and parts[3:5] == ["esp32", "configuration"] and parts[5] in {"validate", "deploy", "rollback"}:
            cid = parts[2]
            if not self._assert_complex_unlocked(cid):
                return
            if not OPERATIONAL_STORE.get_complex(cid):
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            esp32_base = self._get_esp32_endpoint_for_complex(cid)
            if not esp32_base:
                self._json(503, {"error": {"code": "DEVICE_OFFLINE", "message": "ESP32 API target is not configured.", "retryable": True}})
                return
            upstream = f"{esp32_base}/api/v1/configuration/{parts[5]}"
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
                    device = _decode_and_load_json(response.read())
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
                try: err_body = _decode_and_load_json(exc.read())
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
                data = body.get("data", body) if isinstance(body, dict) else body
                device_id = str(data.get("deviceId") or "").strip() if isinstance(data, dict) else ""
                complex_id = str(data.get("complexId") or "").strip() if isinstance(data, dict) else ""
                if device_id and complex_id:
                    complex_record = OPERATIONAL_STORE.get_complex(complex_id)
                    if complex_record:
                        esp32 = dict(complex_record.get("esp32") or {})
                        registered_device_id = str(esp32.get("deviceId") or "").strip()
                        if registered_device_id and registered_device_id != device_id:
                            self._json(409, {"accepted": False, "error": {"code": "DEVICE_COMPLEX_MISMATCH", "message": "ESP32 device identity does not match the controller registered to this Complex."}})
                            return
                        if registered_device_id == device_id:
                            esp32.update({"online": True, "deviceId": device_id, "lastSync": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
                            complex_record["esp32"] = esp32
                            OPERATIONAL_STORE.save_complex(complex_record)
                result = HISTORY_STORE.ingest_bundle(body)
                self._json(202, {"accepted": True, **result})
            except (ValueError, TypeError) as exc:
                self._json(422, {"accepted": False, "error": {"code": "INVALID_ESP32_INGEST", "message": str(exc)}})
            except Exception as exc:
                self._json(503, {"accepted": False, "error": {"code": "ESP32_INGEST_FAILED", "message": str(exc), "retryable": True}})
            return
        if len(parts) == 5 and parts[:4] == ["api", "complexes", parts[2] if len(parts)>2 else "", "esp32"] and parts[4] == "sync":
            cid = parts[2]
            if not self._assert_complex_unlocked(cid):
                return
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
            if not self._assert_complex_unlocked(cid):
                return
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
        if parts == ["api", "v1", "topology-pool", "sync"] or parts == ["api", "topology-pool", "sync"]:
            try:
                pool_data = body.get("pool") if isinstance(body, dict) and "pool" in body else body
                res = TOPOLOGY_POOL.reconcile_peer_pool(pool_data)
                self._json(200, res)
            except TopologyConflictError as e:
                status = 422 if "CONTRACT" in e.code else 409
                self._json(status, {"error": {"code": e.code, "message": e.message}})
            except Exception as e:
                self._json(500, {"error": {"code": "SYNC_FAILED", "message": str(e)}})
            return
        if parts == ["api", "v1", "topology-pool", "mutate"] or parts == ["api", "topology-pool", "mutate"]:
            try:
                mutation_data = body.get("payload") if isinstance(body, dict) and "payload" in body else body
                res = TOPOLOGY_POOL.apply_mutation(mutation_data)
                self._json(200, res)
            except TopologyConflictError as e:
                status = 422 if "VALIDATION" in e.code else 409
                self._json(status, {"error": {"code": e.code, "message": e.message}})
            except Exception as e:
                self._json(500, {"error": {"code": "MUTATION_FAILED", "message": str(e)}})
            return
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
            try:
                TOPOLOGY_POOL.apply_mutation({
                    "operation": "CREATE_COMPLEX",
                    "complexId": complex_id,
                    "name": name,
                    "ownerDeviceId": "BACKEND-MIRROR"
                })
            except Exception:
                pass
            self._json(201, record)
            return
        if len(parts) == 5 and parts[:3] == ["api", "complexes", parts[2] if len(parts) > 2 else ""] and parts[3:] == ["controller", "bind"]:
            complex_id = parts[2]
            if not self._assert_complex_unlocked(complex_id):
                return
            record = OPERATIONAL_STORE.get_complex(complex_id)
            if not record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            device_id = str(body.get("deviceId", "")).strip()
            endpoint = str(body.get("endpoint", "")).strip().rstrip("/")
            if not device_id or not endpoint:
                self._json(422, {"error": {"code": "CONTROLLER_BINDING_INVALID", "message": "deviceId and endpoint are required."}})
                return
            if not endpoint.lower().startswith(("http://", "https://")):
                self._json(422, {"error": {"code": "CONTROLLER_BINDING_INVALID", "message": "endpoint must use http:// or https://."}})
                return
            for other in OPERATIONAL_STORE.context()["complexes"]:
                if str(other.get("id")) != complex_id and str((other.get("esp32") or {}).get("deviceId") or "") == device_id:
                    self._json(409, {"error": {"code": "CONTROLLER_ALREADY_BOUND", "message": "This ESP32 controller is already bound to another Complex."}})
                    return

            # The browser-provided identity is advisory only. The backend must
            # prove that the endpoint actually belongs to the requested controller.
            try:
                health = self._esp32_get_json(endpoint, "/api/v1/health")
                if not isinstance(health, dict):
                    raise ValueError("ESP32 health response is not an object")
                actual_device_id = str(health.get("deviceId") or "")
                actual_complex_id = str(health.get("complexId") or "")
                if actual_device_id != device_id:
                    self._json(409, {"error": {"code": "DEVICE_ID_MISMATCH", "message": "ESP32 endpoint reports a different deviceId."}})
                    return
                if str(health.get("apiVersion") or "") != "v1" or int(health.get("schemaVersion", -1)) != 1:
                    self._json(422, {"error": {"code": "DEVICE_API_INCOMPATIBLE", "message": "ESP32 API/schema version is incompatible with this onboarding contract."}})
                    return
                if actual_complex_id and actual_complex_id != complex_id:
                    self._json(409, {"error": {"code": "CONTROLLER_ALREADY_BOUND", "message": "ESP32 is already bound to a different Complex."}})
                    return

                bind_request = {
                    "requestId": f"backend-bind-{time.time_ns()}",
                    "client": {"type": "PythonBackend", "version": "0.1.0"},
                    "payload": {"deviceId": device_id, "complexId": complex_id},
                }
                request = Request(
                    f"{endpoint}/api/v1/device/bind",
                    data=json.dumps(bind_request).encode("utf-8"),
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}",
                    },
                )
                with urlopen(request, timeout=8) as response:
                    bind_body = _decode_and_load_json(response.read())
                bind_data = self._unwrap_esp32_payload(bind_body)
                if not isinstance(bind_data, dict) or bind_data.get("deviceId") != device_id or bind_data.get("complexId") != complex_id:
                    self._json(502, {"error": {"code": "DEVICE_BINDING_UNVERIFIED", "message": "ESP32 did not confirm the requested binding.", "retryable": True, "reconcileRequired": True}})
                    return

                status = self._esp32_get_json(endpoint, "/api/v1/status", expected_complex_id=complex_id)
                status_device = (status.get("device") or {}) if isinstance(status, dict) else {}
                status_network = (status.get("network") or {}) if isinstance(status, dict) else {}
                if str(status_device.get("deviceId") or device_id) != device_id:
                    self._json(409, {"error": {"code": "DEVICE_ID_MISMATCH", "message": "ESP32 status identity changed during binding."}})
                    return
                current = dict(record.get("esp32") or {})
                current.update({
                    "online": bool(status_network.get("connected", False)),
                    "lastSync": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "deviceId": device_id,
                    "endpoint": endpoint,
                    "apiVersion": health.get("apiVersion"),
                    "schemaVersion": health.get("schemaVersion"),
                    "inventoryVersion": health.get("inventoryVersion"),
                    "firmwareVersion": health.get("firmwareVersion"),
                    "hardwareModel": status_device.get("hardwareModel"),
                    "synchronized": False,
                })
                record["esp32"] = current
                try:
                    OPERATIONAL_STORE.save_complex(record)
                except Exception as exc:
                    self._json(503, {"error": {"code": "BINDING_RECONCILE_REQUIRED", "message": f"ESP32 binding succeeded but backend persistence failed: {exc}", "retryable": True, "reconcileRequired": True}})
                    return
                try:
                    TOPOLOGY_POOL.register_device(device_id, endpoint=endpoint, owner_complex_ids=[complex_id], device_state="BOUND")
                except Exception:
                    pass
                self._json(200, record)
            except HTTPError as exc:
                try:
                    upstream = _decode_and_load_json(exc.read())
                except Exception:
                    upstream = {"error": {"code": "DEVICE_BINDING_REJECTED", "message": str(exc)}}
                self._json(exc.code if exc.code in {400, 401, 403, 409, 422} else 502, upstream)
            except (TimeoutError, OSError, ValueError, RuntimeError) as exc:
                self._json(502, {"error": {"code": "DEVICE_BINDING_FAILED", "message": str(exc), "retryable": True}})
            return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "complexes":
            complex_id = parts[2]
            if not self._assert_complex_unlocked(complex_id):
                return
            record = OPERATIONAL_STORE.get_complex(complex_id)
            if not record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return
            record.update({k: body[k] for k in ("code", "name", "location", "status") if k in body})
            if isinstance(body.get("esp32"), dict):
                merged_esp32 = dict(record.get("esp32") or {}); merged_esp32.update(body["esp32"]); record["esp32"] = merged_esp32
            OPERATIONAL_STORE.save_complex(record)
            try:
                c_up_mutation = {
                    "operation": "UPDATE_COMPLEX",
                    "complexId": complex_id,
                    "name": str(record.get("name") or record.get("code") or complex_id),
                    "location": str(record.get("location") or "")
                }
                TOPOLOGY_POOL.apply_mutation(c_up_mutation)
                esp32_ep = (record.get("esp32") or {}).get("endpoint")
                if esp32_ep:
                    try:
                        self._esp32_post_json(esp32_ep, "/api/v1/topology-pool/mutate", c_up_mutation)
                    except Exception:
                        pass
            except Exception:
                pass
            self._json(200, record)
            return
        if len(parts) == 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "greenhouses":
            complex_id = parts[2]
            if not self._assert_complex_unlocked(complex_id):
                return
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
            try:
                gh_mutation = {
                    "operation": "CREATE_GREENHOUSE",
                    "ghId": gh_id,
                    "complexId": complex_id,
                    "name": code
                }
                TOPOLOGY_POOL.apply_mutation(gh_mutation)
                esp32_ep = (complex_record.get("esp32") or {}).get("endpoint")
                if esp32_ep:
                    try:
                        self._esp32_post_json(esp32_ep, "/api/v1/topology-pool/mutate", gh_mutation)
                    except Exception:
                        pass
            except Exception:
                pass
            self._json(201, RESEARCH_STORE.enrich_greenhouse(dict(record)))
            return
        # Crop-cycle POST routes
        # 1. Start new crop cycle: /api/v1/greenhouses/{ghId}/crop-cycles
        is_cc_start = (len(parts) == 5 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles") or \
                      (len(parts) == 4 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles")
        if is_cc_start:
            gh_id = parts[3] if len(parts) == 5 else parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            payload = body.get("payload", body) if isinstance(body, dict) else {}
            req_id = body.get("requestId") if isinstance(body, dict) else None
            tanam = payload.get("tanggalTanam")
            if not tanam:
                self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "tanggalTanam is required."}})
                return

            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles", method="POST", payload=body
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    record["cropCycle"] = {
                        "status": "ACTIVE",
                        "tanggalTanam": device_resp["data"].get("tanggalTanam"),
                        "tanggalPolinasi": device_resp["data"].get("tanggalPolinasi"),
                        "variety": device_resp["data"].get("variety"),
                        "plantCount": device_resp["data"].get("plantCount"),
                        "notes": device_resp["data"].get("notes"),
                    }
                    OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return
                elif status_code == 409:
                    self._json(409, device_resp)
                    return

            existing = RESEARCH_STORE.current_cycle(cid, gh_id)
            if existing:
                self._json(409, {"error": {"code": "CONFLICT", "message": "Siklus tanam sudah aktif pada greenhouse ini."}})
                return
            cycle_id = f"cc-{int(time.time())}"
            cycle = RESEARCH_STORE.save_cycle({
                "cycleId": cycle_id,
                "complexId": cid,
                "ghId": gh_id,
                "status": "ACTIVE",
                "plantingDate": tanam,
                "variety": payload.get("variety"),
                "plantCount": payload.get("plantCount", 0),
                "notes": payload.get("notes"),
                "source": "ESP32",
                "version": 1,
            })
            record["cropCycle"] = {
                "status": "ACTIVE",
                "tanggalTanam": cycle.get("plantingDate"),
                "tanggalPolinasi": None,
                "variety": cycle.get("variety"),
                "plantCount": cycle.get("plantCount"),
                "notes": cycle.get("notes"),
            }
            OPERATIONAL_STORE.save_greenhouse(record)
            self._json(201, self._envelope_crop_cycle(cycle, gh_id, req_id))
            return

        # 2. Import active crop cycle: /api/v1/greenhouses/{ghId}/crop-cycles/import-active
        is_cc_import = (len(parts) == 6 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4:6] == ["crop-cycles", "import-active"]) or \
                       (len(parts) == 5 and parts[0:2] == ["api", "greenhouses"] and parts[3:5] == ["crop-cycles", "import-active"])
        if is_cc_import:
            gh_id = parts[3] if len(parts) == 6 else parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            payload = body.get("payload", body) if isinstance(body, dict) else {}
            req_id = body.get("requestId") if isinstance(body, dict) else None
            tanam = payload.get("tanggalTanam")
            if not tanam:
                self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "tanggalTanam is required."}})
                return

            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles/import-active", method="POST", payload=body
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    record["cropCycle"] = {
                        "status": "ACTIVE",
                        "tanggalTanam": device_resp["data"].get("tanggalTanam"),
                        "tanggalPolinasi": device_resp["data"].get("tanggalPolinasi"),
                        "variety": device_resp["data"].get("variety"),
                        "plantCount": device_resp["data"].get("plantCount"),
                        "notes": device_resp["data"].get("notes"),
                    }
                    OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return
                elif status_code == 409:
                    self._json(409, device_resp)
                    return

            existing = RESEARCH_STORE.current_cycle(cid, gh_id)
            if existing:
                self._json(409, {"error": {"code": "CONFLICT", "message": "Siklus tanam sudah aktif pada greenhouse ini."}})
                return
            cycle_id = f"import-{int(time.time())}"
            cycle = RESEARCH_STORE.save_cycle({
                "cycleId": cycle_id,
                "complexId": cid,
                "ghId": gh_id,
                "status": "ACTIVE",
                "plantingDate": tanam,
                "pollinationDate": payload.get("tanggalPolinasi"),
                "variety": payload.get("variety"),
                "plantCount": payload.get("plantCount", 0),
                "notes": payload.get("notes"),
                "source": "ESP32",
                "version": 1,
            })
            record["cropCycle"] = {
                "status": "ACTIVE",
                "tanggalTanam": cycle.get("plantingDate"),
                "tanggalPolinasi": cycle.get("pollinationDate"),
                "variety": cycle.get("variety"),
                "plantCount": cycle.get("plantCount"),
                "notes": cycle.get("notes"),
            }
            OPERATIONAL_STORE.save_greenhouse(record)
            self._json(201, self._envelope_crop_cycle(cycle, gh_id, req_id))
            return

        # 3. Record pollination: POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination
        is_cc_poll_post = (len(parts) == 7 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles" and parts[6] == "pollination") or \
                          (len(parts) == 6 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles" and parts[5] == "pollination")
        if is_cc_poll_post:
            gh_id = parts[3] if len(parts) == 7 else parts[2]
            cycle_id_param = parts[5] if len(parts) == 7 else parts[4]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            payload = body.get("payload", body) if isinstance(body, dict) else {}
            req_id = body.get("requestId") if isinstance(body, dict) else None
            pol_date = payload.get("tanggalPolinasi")
            if not pol_date:
                self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "tanggalPolinasi is required."}})
                return

            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles/{cycle_id_param}/pollination", method="POST", payload=body
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    if record.get("cropCycle"):
                        record["cropCycle"]["tanggalPolinasi"] = device_resp["data"].get("tanggalPolinasi")
                        OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return

            c = RESEARCH_STORE.current_cycle(cid, gh_id)
            if not c:
                self._json(404, {"error": {"code": "CYCLE_NOT_FOUND", "message": "No active crop cycle found."}})
                return
            c["pollinationDate"] = pol_date
            c["version"] = int(c.get("version") or 1) + 1
            cycle = RESEARCH_STORE.save_cycle(c, c["cycleId"])
            if record.get("cropCycle"):
                record["cropCycle"]["tanggalPolinasi"] = pol_date
                OPERATIONAL_STORE.save_greenhouse(record)
            self._json(200, self._envelope_crop_cycle(cycle, gh_id, req_id))
            return

        # 4. Cancel crop cycle: POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/cancel
        is_cc_cancel = (len(parts) == 7 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles" and parts[6] == "cancel") or \
                       (len(parts) == 6 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles" and parts[5] == "cancel")
        if is_cc_cancel:
            gh_id = parts[3] if len(parts) == 7 else parts[2]
            cycle_id_param = parts[5] if len(parts) == 7 else parts[4]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            req_id = body.get("requestId") if isinstance(body, dict) else None

            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles/{cycle_id_param}/cancel", method="POST", payload=body
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    record["cropCycle"] = {"status": "NO_CYCLE", "tanggalTanam": None, "tanggalPolinasi": None}
                    OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return

            c = RESEARCH_STORE.current_cycle(cid, gh_id)
            if not c:
                self._json(404, {"error": {"code": "CYCLE_NOT_FOUND", "message": "No active crop cycle found."}})
                return
            c["status"] = "CANCELLED"
            c["version"] = int(c.get("version") or 1) + 1
            cycle = RESEARCH_STORE.save_cycle(c, c["cycleId"])
            record["cropCycle"] = {"status": "NO_CYCLE", "tanggalTanam": None, "tanggalPolinasi": None}
            OPERATIONAL_STORE.save_greenhouse(record)
            self._json(200, self._envelope_crop_cycle(cycle, gh_id, req_id))
            return

        # 5. Harvest crop cycle: POST /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/harvest
        is_cc_harvest = (len(parts) == 7 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles" and parts[6] == "harvest") or \
                        (len(parts) == 6 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles" and parts[5] == "harvest")
        if is_cc_harvest:
            gh_id = parts[3] if len(parts) == 7 else parts[2]
            cycle_id_param = parts[5] if len(parts) == 7 else parts[4]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            payload = body.get("payload", body) if isinstance(body, dict) else {}
            req_id = body.get("requestId") if isinstance(body, dict) else None

            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles/{cycle_id_param}/harvest", method="POST", payload=body
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    record["cropCycle"] = {
                        "status": "NO_CYCLE", "tanggalTanam": None, "tanggalPolinasi": None,
                        "lastHarvestSummary": device_resp["data"].get("lastHarvestSummary")
                    }
                    OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return

            c = RESEARCH_STORE.current_cycle(cid, gh_id)
            if not c:
                self._json(404, {"error": {"code": "CYCLE_NOT_FOUND", "message": "No active crop cycle found."}})
                return
            c["status"] = "HARVESTED"
            c["actualHarvestDate"] = payload.get("harvestDate") or _now()[:10]
            if "yieldKg" in payload: c["yieldKg"] = payload["yieldKg"]
            if "grade" in payload: c["grade"] = payload["grade"]
            if "notes" in payload: c["notes"] = payload["notes"]
            c["version"] = int(c.get("version") or 1) + 1
            cycle = RESEARCH_STORE.save_cycle(c, c["cycleId"])
            record["cropCycle"] = {
                "status": "NO_CYCLE", "tanggalTanam": None, "tanggalPolinasi": None,
                "lastHarvestSummary": {
                    "harvestDate": c.get("actualHarvestDate"),
                    "yieldKg": c.get("yieldKg"),
                    "grade": c.get("grade")
                }
            }
            OPERATIONAL_STORE.save_greenhouse(record)
            self._json(200, self._envelope_crop_cycle(cycle, gh_id, req_id))
            return

        if len(parts) == 3 and parts[0] == "api" and parts[1] == "greenhouses":
            gh_id = parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            if not self._assert_complex_unlocked(str(record.get("complexId"))):
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
            try:
                gh_up_mutation = {
                    "operation": "UPDATE_GREENHOUSE",
                    "ghId": gh_id,
                    "name": str(record.get("code") or gh_id)
                }
                TOPOLOGY_POOL.apply_mutation(gh_up_mutation)
                cid = str(record.get("complexId") or "")
                c_rec = OPERATIONAL_STORE.get_complex(cid) if cid else None
                esp32_ep = (c_rec.get("esp32") or {}).get("endpoint") if c_rec else None
                if esp32_ep:
                    try:
                        self._esp32_post_json(esp32_ep, "/api/v1/topology-pool/mutate", gh_up_mutation)
                    except Exception:
                        pass
            except Exception:
                pass
            self._json(200, RESEARCH_STORE.enrich_greenhouse(dict(record)))
            return

        if len(parts) == 4 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "schedules":
            complex_id = parts[2]
            if not self._assert_complex_unlocked(complex_id):
                return
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
                owner_cid = str(owner.get("id") if owner_kind == "complex" else owner.get("complexId"))
                if not self._assert_complex_unlocked(owner_cid):
                    return
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
            if not self._assert_complex_unlocked(complex_id):
                return
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
            if not self._assert_complex_unlocked(complex_id):
                return
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
            if not self._assert_complex_unlocked(complex_id):
                return
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
            if not self._assert_complex_unlocked(complex_id):
                return
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
            if not self._assert_complex_unlocked(complex_id):
                return
            configuration = body.get("configuration") or {}
            if configuration.get("complexId") != complex_id:
                self._json(409, {"error": {"code": "COMPLEX_MISMATCH", "message": "Path complexId does not match configuration."}})
                return
            result = prepare_run(configuration, body.get("request") or body, CALIBRATION_REPO, FERTIGATION_REPO.list(complex_id))
            self._json(200 if result.get("valid") else 422, result)
            return
        if len(parts) == 6 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "resources" and parts[5] == "transfer":
            complex_id, resource_id = parts[2], parts[4]
            if not self._assert_complex_unlocked(complex_id):
                return
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
            if not self._assert_complex_unlocked(complex_id):
                return
            configuration = body.get("configuration") or {}
            if not configuration or not configuration.get("complexId"):
                c_rec = OPERATIONAL_STORE.get_complex(complex_id)
                ghs = OPERATIONAL_STORE.list_greenhouses(complex_id) if c_rec else []
                configuration = {
                    "complexId": complex_id,
                    "version": 0,
                    "configurationHash": None,
                    "complexes": [{"complexId": complex_id, "name": (c_rec or {}).get("name", complex_id)}],
                    "greenhouses": [{"ghId": g.get("id"), "complexId": complex_id, "name": g.get("code") or g.get("name")} for g in ghs],
                    "components": [],
                    "resources": [],
                    "assignments": [],
                    "topology": [],
                    "recipes": [r for g in ghs for r in g.get("recipes", [])],
                }
            if configuration.get("complexId") != complex_id:
                self._json(409, {"error": {"code": "COMPLEX_MISMATCH", "message": "Path complexId does not match configuration."}})
                return
            input_schedules = body.get("schedules")
            if input_schedules is None:
                c_rec = OPERATIONAL_STORE.get_complex(complex_id) or {}
                ghs = OPERATIONAL_STORE.list_greenhouses(complex_id)
                input_schedules = [
                    *c_rec.get("wellPumpSchedules", []),
                    *[s for g in ghs for s in g.get("fertigationSchedules", [])],
                    *[s for g in ghs for s in g.get("fanSchedules", [])],
                ]
            normalized_intents = [_to_schedule_intent(s, complex_id) for s in input_schedules]
            schedules, fertigation_blocks = _enrich_fertigation_schedules(configuration, normalized_intents)
            result = compile_schedule_set(configuration, schedules, body.get("activeLocks") or [])
            if fertigation_blocks:
                result["blocked"] = [*result.get("blocked", []), *fertigation_blocks]
            if parts[3] == "compile":
                self._json(200 if result["valid"] else 422, result)
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
                    device = _decode_and_load_json(response.read())
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
        if parts in (["api", "v1", "configuration"], ["api", "configuration"]):
            parts = ["api", "complexes", "complex-01", "esp32", "configuration"]
        if len(parts) == 5 and parts[0:3] == ["api", "complexes", parts[2] if len(parts) > 2 else ""] and parts[3:5] == ["esp32", "configuration"]:
            cid = parts[2]
            if not self._assert_complex_unlocked(cid):
                return
            c_rec = OPERATIONAL_STORE.get_complex(cid)
            if not c_rec:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}}); return

            config = body.get("configuration") if isinstance(body, dict) else None
            if not isinstance(config, dict): config = body

            # 1. Authoritatively persist configuration in OPERATIONAL_STORE complex record
            c_rec["configuration"] = config
            OPERATIONAL_STORE.save_complex(c_rec)

            # 2. Sync equipment list per scope
            components = config.get("components", []) if isinstance(config, dict) else []

            # 2a. Complex-level equipment (shared, ghId=null) → store on the complex record itself
            complex_comps = [c for c in components if isinstance(c, dict) and not c.get("assignment", {}).get("ghId")]
            complex_eq_list = []
            for comp in complex_comps:
                complex_eq_list.append({
                    "name": comp.get("name", ""),
                    "type": comp.get("componentType", comp.get("supportedTypeId", "")),
                    "category": comp.get("role", comp.get("componentType", "")),
                    "status": "OK" if comp.get("lifecycleState") in ("COMMISSIONED", "ACTIVE", "ENABLED") else "OFFLINE",
                    "gpio": (comp.get("wiring") or {}).get("gpio") if isinstance(comp.get("wiring"), dict) else None,
                    "scope": "SHARED",
                })
            c_rec["equipment"] = complex_eq_list
            OPERATIONAL_STORE.save_complex(c_rec)

            # 2b. Per-GH equipment → store on each greenhouse record
            for gh in OPERATIONAL_STORE.list_greenhouses(cid):
                gh_id = gh.get("id")
                assigned_comps = [c for c in components if isinstance(c, dict) and c.get("assignment", {}).get("ghId") == gh_id]

                eq_list = []
                for comp in assigned_comps:
                    eq_list.append({
                        "name": comp.get("name", ""),
                        "type": comp.get("componentType", comp.get("supportedTypeId", "")),
                        "category": comp.get("role", comp.get("componentType", "")),
                        "status": "OK" if comp.get("lifecycleState") in ("COMMISSIONED", "ACTIVE", "ENABLED") else "OFFLINE",
                        "gpio": (comp.get("wiring") or {}).get("gpio") if isinstance(comp.get("wiring"), dict) else None,
                        "scope": "PER_GH",
                    })
                gh["equipment"] = eq_list
                OPERATIONAL_STORE.save_greenhouse(gh)

            if "assignments" not in config: config["assignments"] = []
            if "schedules" not in config: config["schedules"] = []
            if "recipes" not in config: config["recipes"] = []
            if "topology" not in config: config["topology"] = []
            if not config.get("updatedAt"):
                config["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            # Sanitize components for physical ESP32 validator
            for comp in components:
                if isinstance(comp, dict):
                    asgn = comp.get("assignment")
                    if isinstance(asgn, dict) and "ghId" in asgn and asgn["ghId"] is None:
                        del asgn["ghId"]

            esp32_base = self._get_esp32_endpoint_for_complex(cid)
            expected = body.get("expectedVersion") if isinstance(body, dict) else None
            deployment_id = body.get("deploymentId") or (f"deploy-{time.time_ns()}" if isinstance(body, dict) else f"deploy-{time.time_ns()}")

            if esp32_base:
                def _do_put_esp(exp_ver: Any, cfg_payload: dict):
                    inner_payload: dict[str, Any] = {
                        "deploymentId": deployment_id,
                        "configuration": cfg_payload,
                    }
                    if exp_ver is not None:
                        inner_payload["expectedVersion"] = exp_ver
                    pl = {
                        "requestId": f"backend-deploy-{time.time_ns()}",
                        "client": {"type": "PythonBackend", "version": "0.1.0"},
                        "payload": inner_payload,
                    }
                    raw_bytes = json.dumps(pl, separators=(',', ':')).encode("utf-8")
                    req = Request(f"{esp32_base}/api/v1/configuration", data=raw_bytes, method="PUT",
                                  headers={"Content-Type": "application/json", "Accept": "application/json", "Authorization": f"Bearer {os.getenv('ESP32_API_TOKEN', 'agrotech-secret-key')}"})
                    with urlopen(req, timeout=2.5) as response:
                        return response.status, _decode_and_load_json(response.read())

                try:
                    status_code, device = _do_put_esp(expected, config)
                    envelope_data = device.get("data", device) if isinstance(device, dict) else device
                    data = envelope_data.get("payload", envelope_data) if isinstance(envelope_data, dict) else envelope_data
                    if isinstance(envelope_data, dict):
                        active_version = int(envelope_data.get("configurationVersion") or (data.get("version", 0) if isinstance(data, dict) else 0))
                        RECOVERY_STORE.set_deployment(cid, deployment_id=envelope_data.get("deploymentId") or deployment_id,
                                                      desired_version=active_version, desired_hash=envelope_data.get("configurationHash"),
                                                      device_version=active_version, device_hash=envelope_data.get("configurationHash"),
                                                      previous_version=int(envelope_data.get("previousConfigurationVersion") or 0), status=str(envelope_data.get("deploymentStatus") or "ACTIVE"))
                    self._json(status_code, data); return
                except HTTPError as exc:
                    try: err_body = _decode_and_load_json(exc.read())
                    except Exception: err_body={"error":{"code":"DEVICE_REQUEST_FAILED","message":str(exc)}}

                    # Auto-resolve version conflict by reading device version and applying
                    if exc.code == 409 and (err_body.get("error", {}).get("code") == "CONFLICT"):
                        try:
                            dev_cfg = self._esp32_get_json(esp32_base, "/api/v1/configuration")
                            cur_ver = int(dev_cfg.get("version", 0)) if isinstance(dev_cfg, dict) else 0
                            config["version"] = cur_ver + 1
                            status_code, device = _do_put_esp(cur_ver, config)
                            envelope_data = device.get("data", device) if isinstance(device, dict) else device
                            data = envelope_data.get("payload", envelope_data) if isinstance(envelope_data, dict) else envelope_data
                            self._json(status_code, data); return
                        except Exception:
                            pass

                    self._json(exc.code, err_body); return
                except Exception:
                    # ESP32 offline or unreachable in local dev: store as pending and return saved configuration
                    RECOVERY_STORE.set_deployment(cid, deployment_id=deployment_id, desired_version=int(config.get("version",0) or 0), desired_hash=config.get("configurationHash"), status="PENDING_DEPLOYMENT")
                    self._json(200, config); return
            else:
                RECOVERY_STORE.set_deployment(cid, deployment_id=deployment_id, desired_version=int(config.get("version",0) or 0), desired_hash=config.get("configurationHash"), status="ACTIVE")
                self._json(200, config); return
        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Endpoint not found."}})

    def do_DELETE(self) -> None:  # noqa: N802
        parts = [p for p in urlparse(self.path).path.split("/") if p]
        if len(parts) >= 6 and parts[0:2] == ["api", "complexes"] and parts[3] == "research":
            cid, resource, record_id = parts[2], parts[4], parts[5]
            if not self._assert_complex_unlocked(cid):
                return
            if resource == "observations":
                deleted = RESEARCH_STORE.delete_observation(record_id)
                self._json(200, {"deleted": deleted, "observationId": record_id, "complexId": cid}); return
            self._json(405, {"error": {"code": "RESEARCH_DELETE_NOT_SUPPORTED", "message": "Only observations can be deleted; plant/fruit/cycle records are retained for research history."}}); return
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "complexes":
            complex_id = parts[2]
            record = OPERATIONAL_STORE.get_complex(complex_id)
            if not record:
                self._json(404, {"error": {"code": "COMPLEX_NOT_FOUND", "message": "Complex not found."}})
                return

            body = {}
            try:
                body = self._read_json()
            except Exception:
                pass

            idempotency_key = str(
                self.headers.get("Idempotency-Key") or body.get("idempotencyKey") or f"del-key-{complex_id}-{int(time.time())}"
            ).strip()

            try:
                job = DELETION_MANAGER.start_or_resume_deletion(
                    complex_id=complex_id,
                    idempotency_key=idempotency_key,
                    requested_by=str(body.get("requestedBy", "operator")),
                    request_reason=str(body.get("requestReason", "User requested deletion")),
                )
                if job.get("status") == "COMPLETED":
                    try:
                        TOPOLOGY_POOL.apply_mutation({
                            "operation": "DELETE_COMPLEX",
                            "complexId": complex_id,
                            "deletionChangeId": job.get("jobId"),
                            "recordTombstone": True,
                        })
                    except Exception:
                        pass
                status_code = 200 if job.get("status") in {"COMPLETED", "FAILED_TERMINAL", "CANCELLED"} else 202
                self._json(status_code, job)
            except Exception as exc:
                self._json(500, {"error": {"code": "DELETION_INITIALIZATION_FAILED", "message": str(exc)}})
            return

        if len(parts) == 3 and parts[0] == "api" and parts[1] == "schedules":
            schedule_id = parts[2]
            found = _find_schedule(schedule_id)
            if not found:
                self._json(404, {"error": {"code": "SCHEDULE_NOT_FOUND", "message": "Schedule not found."}})
                return
            owner_kind, owner, schedules, bucket = found
            owner_cid = str(owner.get("id") if owner_kind == "complex" else owner.get("complexId"))
            if not self._assert_complex_unlocked(owner_cid):
                return
            owner[bucket] = [x for x in schedules if str(x.get("id")) != schedule_id]
            if owner_kind == "greenhouse": OPERATIONAL_STORE.save_greenhouse(owner)
            else: OPERATIONAL_STORE.save_complex(owner)
            self._json(200, {"deleted": True, "scheduleId": schedule_id})
            return

        if (len(parts) == 3 and parts[0] == "api" and parts[1] == "greenhouses") or (len(parts) == 5 and parts[0] == "api" and parts[1] == "complexes" and parts[3] == "greenhouses"):
            gh_id = parts[4] if len(parts) == 5 else parts[2]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            complex_id = str(record.get("complexId") or "")
            if complex_id and not self._assert_complex_unlocked(complex_id):
                return
            if complex_id:
                complex_record = OPERATIONAL_STORE.get_complex(complex_id)
                if complex_record:
                    gh_ids = [gid for gid in complex_record.get("greenhouseIds", []) if gid != gh_id]
                    complex_record["greenhouseIds"] = gh_ids
                    OPERATIONAL_STORE.save_complex(complex_record)
            OPERATIONAL_STORE.delete_greenhouse(gh_id)
            try:
                gh_del_mutation = {
                    "operation": "DELETE_GREENHOUSE",
                    "ghId": gh_id
                }
                TOPOLOGY_POOL.apply_mutation(gh_del_mutation)
                if complex_id:
                    c_rec = OPERATIONAL_STORE.get_complex(complex_id)
                    esp32_ep = (c_rec.get("esp32") or {}).get("endpoint") if c_rec else None
                    if esp32_ep:
                        try:
                            self._esp32_post_json(esp32_ep, "/api/v1/topology-pool/mutate", gh_del_mutation)
                        except Exception:
                            pass
            except Exception:
                pass
            self._json(200, {"deleted": True, "ghId": gh_id})
            return

        # Delete pollination: DELETE /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination
        is_cc_poll_del = (len(parts) == 7 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles" and parts[6] == "pollination") or \
                         (len(parts) == 6 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles" and parts[5] == "pollination")
        if is_cc_poll_del:
            gh_id = parts[3] if len(parts) == 7 else parts[2]
            cycle_id_param = parts[5] if len(parts) == 7 else parts[4]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles/{cycle_id_param}/pollination", method="DELETE"
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    if record.get("cropCycle"):
                        record["cropCycle"]["tanggalPolinasi"] = None
                        OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return

            c = RESEARCH_STORE.current_cycle(cid, gh_id)
            if not c:
                self._json(404, {"error": {"code": "CYCLE_NOT_FOUND", "message": "No active crop cycle found."}})
                return
            c["pollinationDate"] = None
            c["version"] = int(c.get("version") or 1) + 1
            cycle = RESEARCH_STORE.save_cycle(c, c["cycleId"])
            if record.get("cropCycle"):
                record["cropCycle"]["tanggalPolinasi"] = None
                OPERATIONAL_STORE.save_greenhouse(record)
            self._json(200, self._envelope_crop_cycle(cycle, gh_id))
            return

        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Endpoint not found."}})

    def do_PATCH(self) -> None:  # noqa: N802
        try:
            body = self._read_json()
        except Exception:
            body = {}
        parts = [p for p in urlparse(self.path).path.split("/") if p]

        # 1. Update pollination date: PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/pollination
        is_cc_poll_patch = (len(parts) == 7 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles" and parts[6] == "pollination") or \
                           (len(parts) == 6 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles" and parts[5] == "pollination")
        if is_cc_poll_patch:
            gh_id = parts[3] if len(parts) == 7 else parts[2]
            cycle_id_param = parts[5] if len(parts) == 7 else parts[4]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            payload = body.get("payload", body) if isinstance(body, dict) else {}
            req_id = body.get("requestId") if isinstance(body, dict) else None
            pol_date = payload.get("tanggalPolinasi")
            if not pol_date:
                self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "tanggalPolinasi is required."}})
                return

            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles/{cycle_id_param}/pollination", method="PATCH", payload=body
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    if record.get("cropCycle"):
                        record["cropCycle"]["tanggalPolinasi"] = device_resp["data"].get("tanggalPolinasi")
                        OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return

            c = RESEARCH_STORE.current_cycle(cid, gh_id)
            if not c:
                self._json(404, {"error": {"code": "CYCLE_NOT_FOUND", "message": "No active crop cycle found."}})
                return
            c["pollinationDate"] = pol_date
            c["version"] = int(c.get("version") or 1) + 1
            cycle = RESEARCH_STORE.save_cycle(c, c["cycleId"])
            if record.get("cropCycle"):
                record["cropCycle"]["tanggalPolinasi"] = pol_date
                OPERATIONAL_STORE.save_greenhouse(record)
            self._json(200, self._envelope_crop_cycle(cycle, gh_id, req_id))
            return

        # 2. Update planting date: PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId}/planting-date
        is_cc_plant_patch = (len(parts) == 7 and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles" and parts[6] == "planting-date") or \
                            (len(parts) == 6 and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles" and parts[5] == "planting-date")
        if is_cc_plant_patch:
            gh_id = parts[3] if len(parts) == 7 else parts[2]
            cycle_id_param = parts[5] if len(parts) == 7 else parts[4]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            payload = body.get("payload", body) if isinstance(body, dict) else {}
            req_id = body.get("requestId") if isinstance(body, dict) else None
            tanam = payload.get("tanggalTanam")
            if not tanam:
                self._json(422, {"error": {"code": "VALIDATION_FAILED", "message": "tanggalTanam is required."}})
                return

            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles/{cycle_id_param}/planting-date", method="PATCH", payload=body
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    if record.get("cropCycle"):
                        record["cropCycle"]["tanggalTanam"] = device_resp["data"].get("tanggalTanam")
                        OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return

            c = RESEARCH_STORE.current_cycle(cid, gh_id)
            if not c:
                self._json(404, {"error": {"code": "CYCLE_NOT_FOUND", "message": "No active crop cycle found."}})
                return
            c["plantingDate"] = tanam
            c["version"] = int(c.get("version") or 1) + 1
            cycle = RESEARCH_STORE.save_cycle(c, c["cycleId"])
            if record.get("cropCycle"):
                record["cropCycle"]["tanggalTanam"] = tanam
                OPERATIONAL_STORE.save_greenhouse(record)
            self._json(200, self._envelope_crop_cycle(cycle, gh_id, req_id))
            return

        # 3. Update metadata: PATCH /api/v1/greenhouses/{ghId}/crop-cycles/{cycleId} (optional /metadata)
        is_cc_meta_patch = (len(parts) in (6, 7) and parts[0:3] == ["api", "v1", "greenhouses"] and parts[4] == "crop-cycles" and (len(parts) == 6 or parts[6] == "metadata")) or \
                           (len(parts) in (5, 6) and parts[0:2] == ["api", "greenhouses"] and parts[3] == "crop-cycles" and (len(parts) == 5 or parts[5] == "metadata"))
        if is_cc_meta_patch:
            gh_id = parts[3] if parts[1] == "v1" else parts[2]
            cycle_id_param = parts[5] if parts[1] == "v1" else parts[4]
            record = OPERATIONAL_STORE.get_greenhouse(gh_id)
            if not record:
                self._json(404, {"error": {"code": "GREENHOUSE_NOT_FOUND", "message": "Greenhouse not found."}})
                return
            cid = str(record.get("complexId") or "")
            payload = body.get("payload", body) if isinstance(body, dict) else {}
            req_id = body.get("requestId") if isinstance(body, dict) else None

            esp32_ep = self._get_esp32_endpoint_for_gh(gh_id)
            if esp32_ep:
                status_code, device_resp = self._esp32_forward_request(
                    esp32_ep, f"/api/v1/greenhouses/{gh_id}/crop-cycles/{cycle_id_param}", method="PATCH", payload=body
                )
                if status_code in (200, 201) and isinstance(device_resp, dict) and "data" in device_resp:
                    RESEARCH_STORE.upsert_cycle_from_device(device_resp["data"], cid)
                    if record.get("cropCycle"):
                        if "variety" in device_resp["data"]: record["cropCycle"]["variety"] = device_resp["data"]["variety"]
                        if "plantCount" in device_resp["data"]: record["cropCycle"]["plantCount"] = device_resp["data"]["plantCount"]
                        if "notes" in device_resp["data"]: record["cropCycle"]["notes"] = device_resp["data"]["notes"]
                        if "targetHarvestHst" in device_resp["data"]: record["cropCycle"]["targetHarvestHst"] = device_resp["data"]["targetHarvestHst"]
                        if "cropTimelineConfig" in device_resp["data"]:
                            record["cropCycle"]["cropTimelineConfig"] = device_resp["data"]["cropTimelineConfig"]
                            record["cropTimelineConfig"] = device_resp["data"]["cropTimelineConfig"]
                        OPERATIONAL_STORE.save_greenhouse(record)
                    self._json(status_code, device_resp)
                    return

            c = RESEARCH_STORE.current_cycle(cid, gh_id)
            if not c:
                self._json(404, {"error": {"code": "CYCLE_NOT_FOUND", "message": "No active crop cycle found."}})
                return
            if "variety" in payload: c["variety"] = payload["variety"]
            if "plantCount" in payload: c["plantCount"] = payload["plantCount"]
            if "notes" in payload: c["notes"] = payload["notes"]
            if "targetHarvestHst" in payload: c["targetHarvestHst"] = payload["targetHarvestHst"]
            if "cropTimelineConfig" in payload: c["cropTimelineConfig"] = payload["cropTimelineConfig"]
            c["version"] = int(c.get("version") or 1) + 1
            cycle = RESEARCH_STORE.save_cycle(c, c["cycleId"])
            if record.get("cropCycle"):
                if "variety" in payload: record["cropCycle"]["variety"] = payload["variety"]
                if "plantCount" in payload: record["cropCycle"]["plantCount"] = payload["plantCount"]
                if "notes" in payload: record["cropCycle"]["notes"] = payload["notes"]
                if "targetHarvestHst" in payload: record["cropCycle"]["targetHarvestHst"] = payload["targetHarvestHst"]
                if "cropTimelineConfig" in payload:
                    record["cropCycle"]["cropTimelineConfig"] = payload["cropTimelineConfig"]
                    record["cropTimelineConfig"] = payload["cropTimelineConfig"]
                OPERATIONAL_STORE.save_greenhouse(record)
            self._json(200, self._envelope_crop_cycle(cycle, gh_id, req_id))
            return

        self._json(404, {"error": {"code": "NOT_FOUND", "message": "Endpoint not found."}})


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8090"))
    try:
        DELETION_MANAGER.resume_pending_jobs()
    except Exception as exc:
        print(f"Warning: Failed to resume pending deletion jobs: {exc}")
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
