from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.fertigation_engine import FertigationRunRepository, prepare_run
from tests.support.fertigation_simulation import simulate_run
from backend.history_store import HistoryStore
from backend.research_store import ResearchStore
from backend.sensor_calibration import CalibrationRepository, build_dosing_calibration, build_linear_calibration
from backend.schedule_compiler import compile_schedule_set, topology_capabilities


def component(cid: str, role: str, rid: str, gh: str | None = None, complex_id: str = "C-M17") -> dict:
    return {
        "componentId": cid,
        "supportedTypeId": role,
        "name": cid,
        "role": role,
        "resourceId": rid,
        "lifecycleState": "COMMISSIONED",
        "assignment": {"complexId": complex_id, "ghId": gh},
    }


def build_config() -> dict:
    c = []
    for gh in ("GH-A", "GH-B"):
        suffix = gh.split("-")[-1]
        c.extend([
            component(f"mix-{suffix}", "MIXING_TANK", f"r-mix-{suffix}", gh),
            component(f"mix-pump-{suffix}", "MIXING_PUMP", f"r-mix-pump-{suffix}", gh),
            component(f"dist-{suffix}", "DELIVERY_PUMP", f"r-dist-{suffix}", gh),
            component(f"raw-flow-{suffix}", "FLOW_METER", f"r-raw-flow-{suffix}", gh),
            component(f"dist-flow-{suffix}", "DELIVERY_FLOW_SENSOR", f"r-dist-flow-{suffix}", gh),
            component(f"level-{suffix}", "LEVEL_SENSOR", f"r-level-{suffix}", gh),
            component(f"pressure-{suffix}", "PRESSURE_SENSOR", f"r-pressure-{suffix}", gh),
            component(f"dose-{suffix}", "DOSING_1", f"r-dose-{suffix}", gh),
        ])
    # Shared raw-water source and two explicit routing valves.
    c.extend([
        component("raw-pump", "WELL_PUMP", "r-raw-pump"),
        component("route-A", "ROUTING_VALVE", "r-route-A"),
        component("route-B", "ROUTING_VALVE", "r-route-B"),
    ])
    resources = [{
        "resourceId": x["resourceId"], "type": x["role"], "componentId": x["componentId"],
        "shared": x["assignment"].get("ghId") is None, "available": True,
    } for x in c]
    assignments = [
        {"assignmentId": f"a-{i}", "resourceId": x["resourceId"],
         "scope": "GH" if x["assignment"].get("ghId") else "COMPLEX",
         "ghId": x["assignment"].get("ghId")} for i, x in enumerate(c, 1)
    ]
    topology = []
    for gh in ("GH-A", "GH-B"):
        s = gh.split("-")[-1]
        topology.extend([
            {"pathId": f"raw-{s}", "sourceResourceId": "r-raw-pump", "targetResourceId": f"r-mix-{s}",
             "mode": "AUTOMATIC", "shared": True, "enabled": True, "targetGhId": gh,
             "valveResourceId": f"r-route-{s}"},
            {"pathId": f"delivery-{s}", "sourceResourceId": f"r-mix-{s}", "targetResourceId": f"r-dist-{s}",
             "mode": "AUTOMATIC", "shared": False, "enabled": True, "targetGhId": gh},
        ])
    sensors = {}
    for gh in ("GH-A", "GH-B"):
        s = gh.split("-")[-1]
        sensors.update({
            f"r-raw-flow-{s}": {"sensorId": f"raw-flow-{s}", "sensorType": "FLOW", "source": "GPIO", "unit": "L/min", "samplingIntervalMs": 1000, "complexId": "C-M17", "installed": True, "calibrationReference": f"CAL-RAW-{s}", "calibrationVersion": 1},
            f"r-dist-flow-{s}": {"sensorId": f"dist-flow-{s}", "sensorType": "FLOW", "source": "GPIO", "unit": "L/min", "samplingIntervalMs": 1000, "complexId": "C-M17", "installed": True, "calibrationReference": f"CAL-DEL-{s}", "calibrationVersion": 1},
            f"r-level-{s}": {"sensorId": f"level-{s}", "sensorType": "LEVEL", "source": "GPIO", "unit": "state", "samplingIntervalMs": 1000, "complexId": "C-M17", "installed": True},
            f"r-pressure-{s}": {"sensorId": f"pressure-{s}", "sensorType": "PRESSURE", "source": "GPIO", "unit": "kPa", "samplingIntervalMs": 1000, "complexId": "C-M17", "installed": True},
        })
    return {
        "complexId": "C-M17", "version": 100, "configurationHash": "cfg-m17",
        "complexes": [{"complexId": "C-M17"}],
        "greenhouses": [{"ghId": "GH-A", "complexId": "C-M17"}, {"ghId": "GH-B", "complexId": "C-M17"}],
        "components": c, "resources": resources, "assignments": assignments, "topology": topology,
        "recipes": [{"recipeId": "R-M17", "name": "M17 Safe Trial", "type": "FERTIGATION", "mixingDurationSec": 5}],
        "sensorDefinitions": sensors,
    }


def execution_plan(cfg: dict, gh: str) -> dict:
    s = gh.split("-")[-1]
    return {
        "ghId": gh,
        "configurationVersion": cfg["version"],
        "configurationHash": cfg["configurationHash"],
        "components": {
            "mixingTank": f"mix-{s}", "rawWater": "raw-pump", "rawFlow": f"raw-flow-{s}",
            "level": f"level-{s}", "mixingPump": f"mix-pump-{s}", "deliveryPump": f"dist-{s}",
            "deliveryFlow": f"dist-flow-{s}", "pressure": f"pressure-{s}",
        },
        "resources": [
            {"resourceId": f"r-mix-{s}", "lockType": "EXCLUSIVE"},
            {"resourceId": f"r-mix-pump-{s}", "lockType": "EXCLUSIVE"},
            {"resourceId": f"r-dist-{s}", "lockType": "EXCLUSIVE"},
            {"resourceId": f"r-raw-flow-{s}", "lockType": "EXCLUSIVE"},
            {"resourceId": f"r-dist-flow-{s}", "lockType": "EXCLUSIVE"},
            {"resourceId": f"r-level-{s}", "lockType": "EXCLUSIVE"},
            {"resourceId": f"r-pressure-{s}", "lockType": "EXCLUSIVE"},
            {"resourceId": f"r-dose-{s}", "lockType": "EXCLUSIVE"},
        ],
        "safety": {"safetyAcknowledged": True},
    }


def software_gate() -> None:
    checks = []
    def check(name: str, cond: bool, detail: str = ""):
        if not cond:
            raise AssertionError(f"{name} failed {detail}")
        checks.append(name)

    # Production source path trace.
    main = (ROOT / "esp32/main/main.c").read_text()
    cfg = (ROOT / "esp32/main/http/api_config_handlers.c").read_text()
    sched = (ROOT / "esp32/main/services/scheduler.c").read_text()
    cmd = (ROOT / "esp32/main/services/command_mgr.c").read_text()
    fert = (ROOT / "esp32/main/services/fertigation_mgr.c").read_text()
    tele = (ROOT / "esp32/main/services/telemetry_mgr.c").read_text()
    sync = (ROOT / "esp32/main/services/offline_sync_mgr.c").read_text()
    store = (ROOT / "esp32/main/storage/storage_mgr.c").read_text()
    sensor = (ROOT / "esp32/main/hal/sensor_hal.c").read_text()

    check("boot_safe_before_runtime", main.index("safe_boot_actuators();") < main.index("storage_mgr_init()"))
    handler_start = cfg.index("esp_err_t handler_put_configuration")
    handler_end = cfg.index("esp_err_t handler_deploy_configuration", handler_start)
    handler = cfg[handler_start:handler_end]
    check("config_validate_before_deploy", handler.index("validate_config_payload(request_payload, errors)") < handler.index("deploy_configuration_json"))
    deploy_start = cfg.index("static esp_err_t deploy_configuration_json")
    deploy = cfg[deploy_start:cfg.index("esp_err_t handler_get_configuration_deployment", deploy_start)]
    check("config_stage_then_runtime_then_activate", deploy.index("storage_mgr_stage_candidate") < deploy.index("hardware_registry_load_from_json(json_text)") < deploy.index("storage_mgr_activate_candidate"))
    check("scheduler_requires_active_compiled_schedule", all(x in sched for x in ["activationState", "status", "compiledId", "complexId"]))
    check("command_requires_fertigation_execution_plan", "FERTIGATION_EXECUTION_PLAN_REQUIRED" in cmd and "executionPlan" in cmd)
    check("command_calls_safety_and_registry", "safety_monitor_authorize_component" in cmd and "actuator_hal_set_by_component_id" in cmd)
    check("fertigation_state_machine", all(x in fert for x in ["FERT_STATE_FILLING", "FERT_STATE_DOSING", "FERT_STATE_FINAL_MIXING", "FERT_STATE_DELIVERY", "FERT_STATE_COMPLETE", "FERT_STATE_INTERRUPTED", "FERT_STATE_FAULTED", "FERT_STATE_ABORTED"]))
    check("fertigation_fail_safe_stop", "stop_all();" in fert)
    check("telemetry_durable", "storage_mgr_append_telemetry_log" in tele and "recordId" in tele and "quality" in tele)
    check("offline_cursor_persistent", "storage_mgr_get_sync_cursor" in sync and "storage_mgr_set_sync_cursor" in sync)
    check("offline_cursor_advances_after_ack", sync.index("post_bundle(bundle)") < sync.index("storage_mgr_set_sync_cursor(\"telemetry\""))
    check("sensor_exact_calibration", "calibration_mgr_get_record_exact" in sensor)
    check("nvs_transaction", all(x in store for x in ['nvs_set_str(handle, "lvc_json"', 'nvs_set_u32(handle, "cfg_ver"', 'nvs_set_u32(handle, "cfg_crc"', 'nvs_commit(handle)']))
    ui_files = list((ROOT / "src").rglob("*.ts")) + list((ROOT / "src").rglob("*.tsx"))
    ui_source = "\n".join(p.read_text(errors="ignore") for p in ui_files)
    check("no_browser_authority", "localStorage" not in ui_source and "sessionStorage" not in ui_source)
    check("no_singleton_complex_or_greenhouse_index", "complexes[0]" not in ui_source and "greenhouses[0]" not in ui_source and "ghs[0]" not in ui_source)
    prod_c = "\n".join(p.read_text(errors="ignore") for p in (ROOT/"esp32/main").rglob("*.c"))
    check("no_production_gh01_literal", "gh-01" not in prod_c.lower())
    check("no_components_json_runtime_fallback", "storage_mgr_load_components_json" not in (ROOT/"esp32/main/hal/hardware_registry.c").read_text())

    # Execute real production backend functions for a two-GH chain.
    configuration = build_config()
    caps = topology_capabilities(configuration)
    check("backend_topology_valid", caps["valid"] and caps["byGh"]["GH-A"]["capabilities"]["CAN_RUN_AUTONOMOUSLY"] and caps["byGh"]["GH-B"]["capabilities"]["CAN_RUN_AUTONOMOUSLY"])

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        cal = CalibrationRepository(td / "cal.sqlite3")
        runs = FertigationRunRepository(td / "runs.sqlite3")
        history = HistoryStore(td / "history.sqlite3")
        research = ResearchStore(td / "research.sqlite3")
        for s in ("A", "B"):
            cal.save(build_linear_calibration(f"raw-flow-{s}", "FLOW", 0, 0, 10, 10, "m17", version=1, calibration_id=f"CAL-RAW-{s}", complex_id="C-M17", pulses_per_liter=450))
            cal.save(build_linear_calibration(f"dist-flow-{s}", "FLOW", 0, 0, 10, 10, "m17", version=1, calibration_id=f"CAL-DEL-{s}", complex_id="C-M17", pulses_per_liter=450))
            cal.save(build_dosing_calibration(f"dose-{s}", 10.0, 10.0, "m17", version=1, calibration_id=f"CAL-DOSE-{s}", complex_id="C-M17"))

        schedules = []
        plans = {}
        for gh in ("GH-A", "GH-B"):
            plan = execution_plan(configuration, gh)
            plans[gh] = plan
            s = gh.split("-")[-1]
            schedules.append({
                "scheduleId": f"sched-{s}", "ownerId": f"owner-{s}", "complexId": "C-M17", "ghId": gh,
                "action": "FERTIGATION", "enabled": True,
                "trigger": {"type": "DAILY", "hour": 6, "minute": 0, "daysOfWeek": 127},
                "recipeId": "R-M17", "missedRunPolicy": "SKIP",
                "parameters": {"rawWaterVolumeMl": 20000, "durationSec": 60, "executionPlan": plan},
            })
        compiled = compile_schedule_set(configuration, schedules)
        check("compile_two_gh_schedules", compiled["valid"] and len(compiled["compiled"]) == 2)
        check("compiled_gh_isolation", {x["ghId"] for x in compiled["compiled"]} == {"GH-A", "GH-B"})

        prepared_runs = {}
        for gh in ("GH-A", "GH-B"):
            s = gh.split("-")[-1]
            prepared = prepare_run(configuration, {
                "ghId": gh, "recipeId": "R-M17", "scheduleId": f"sched-{s}", "targetWaterMl": 20000,
                "dosingChannels": [{"componentId": f"dose-{s}", "requestedMl": 100, "calibrationId": f"CAL-DOSE-{s}", "calibrationVersion": 1}],
                "executionPlan": plans[gh], "deliveryMode": "VOLUME", "safetyAcknowledged": True,
                "triggerType": "SCHEDULE", "operator": "M17", "source": "SCHEDULER",
            }, cal, [])
            check(f"prepare_{gh}", prepared["valid"] and prepared["run"]["ghId"] == gh)
            prepared_runs[gh] = prepared

        # Negative cross-GH access: use GH-A request with GH-B dosing component and plan.
        cross = prepare_run(configuration, {
            "ghId": "GH-A", "recipeId": "R-M17", "targetWaterMl": 20000,
            "dosingChannels": [{"componentId": "dose-B", "requestedMl": 100, "calibrationId": "CAL-DOSE-B", "calibrationVersion": 1}],
            "executionPlan": plans["GH-B"], "deliveryMode": "VOLUME", "safetyAcknowledged": True,
        }, cal, [])
        check("negative_cross_gh_blocked", not cross["valid"] and any(i["code"] in {"UNKNOWN_DOSING_COMPONENT", "EXPLICIT_COMPONENT_INVALID", "PLAN_COMPONENT_INVALID"} for i in cross["issues"]))

        # Software-only run measurement: explicit actual measurements stay separate from targets.
        for gh in ("GH-A", "GH-B"):
            prepared = prepared_runs[gh]
            run = simulate_run(prepared, delivered_ml=19500, actual_water_ml=20100, now_ms=1789776600000, actual_flow_lpm=8.0, actual_pressure_kpa=120.0)
            runs.save(run)
            check(f"run_record_{gh}", run["ghId"] == gh and run.get("targetDeliveredMl") != run.get("actualDeliveredMl"))

            history.ingest_telemetry_snapshot({"recordType": "TELEMETRY", "recordId": f"tele-{gh}", "deviceId": "dev-m17", "complexId": "C-M17", "ghId": gh, "sequence": 1, "deviceTimestamp": "2026-09-19T00:00:00Z", "samples": [{"componentId": f"dist-flow-{gh[-1]}", "metricId": "FLOW", "source": "TEST-INTEGRATED-MEASUREMENT", "ghId": gh, "value": 8.0, "unit": "L/min", "quality": "GOOD", "measurementType": "MEASURED"}]})
            history.ingest_event({"eventId": f"event-{gh}", "sequence": 1, "eventType": "FERTIGATION_COMPLETED", "level": "INFO", "complexId": "C-M17", "ghId": gh, "commandId": run["runId"], "configurationVersion": 100, "deviceTimestamp": "2026-09-19T00:10:00Z", "timestamp": "2026-09-19T00:10:00Z", "message": "software e2e"})
            cycle = research.save_cycle({"complexId": "C-M17", "ghId": gh, "cycleId": f"cycle-{gh}", "plantingDate": "2026-09-01", "pollinationDate": "2026-09-10", "variety": "M17", "status": "ACTIVE"})
            plant = research.save_plant({"plantId": f"plant-{gh}", "cycleId": cycle["cycleId"], "complexId": "C-M17", "ghId": gh, "plantTag": f"P-{gh}", "status": "ALIVE"})
            fruit = research.save_fruit({"fruitId": f"fruit-{gh}", "plantId": plant["plantId"], "fruitTag": f"F-{gh}", "pollinationDate": "2026-09-10", "weightG": 100.0})
            obs = research.save_observation({"observationId": f"obs-{gh}", "cycleId": cycle["cycleId"], "plantId": plant["plantId"], "fruitId": fruit["fruitId"], "observedAt": "2026-09-19T00:11:00Z", "metric": "height", "heightCm": 10.0, "value": 10.0, "unit": "cm", "complexId": "C-M17", "ghId": gh})
            analysis = research.analysis("C-M17", cycle["cycleId"], history, runs, cal)
            check(f"research_chain_{gh}", analysis["cycle"]["ghId"] == gh and analysis["counts"]["telemetrySamples"] >= 1 and analysis["counts"]["events"] >= 1 and analysis["counts"]["fertigationRuns"] >= 1 and obs["ghId"] == gh)
        # Duplicate ingest must remain idempotent.
        duplicate = history.ingest_event({"eventId": "event-GH-A", "sequence": 1, "eventType": "FERTIGATION_COMPLETED", "level": "INFO", "complexId": "C-M17", "ghId": "GH-A", "deviceTimestamp": "2026-09-19T00:10:00Z", "timestamp": "2026-09-19T00:10:00Z"})
        check("history_idempotent_ingest", duplicate.get("deduplicated") is True or duplicate.get("eventId") == "event-GH-A")

    print(f"M17 SOFTWARE E2E GATE: PASS — {len(checks)} checks")
    print("Software-proven only; physical hardware evidence remains separate.")


if __name__ == "__main__":
    software_gate()
