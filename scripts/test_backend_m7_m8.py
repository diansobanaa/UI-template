import sys
import unittest
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from backend.schedule_compiler import compile_schedule, compile_schedule_set, topology_capabilities, validate_topology
from backend.sensor_calibration import CalibrationRepository, build_dosing_calibration, build_linear_calibration
from backend.fertigation_engine import prepare_run
import tempfile


def component(cid, role, rid, gh=None):
    return {
        "componentId": cid,
        "supportedTypeId": role,
        "name": cid,
        "role": role,
        "resourceId": rid,
        "lifecycleState": "COMMISSIONED",
        "assignment": {"complexId": "complex-A", "ghId": gh},
    }


def config():
    comps = [
        component("well", "WELL_PUMP", "r-well"),
        component("dose-a", "DOSING_A", "r-dose-a"),
        component("dose-b", "DOSING_B", "r-dose-b"),
        component("raw-flow", "FLOW_METER", "r-raw-flow"),
        component("raw-level", "LEVEL_SENSOR", "r-raw-level"),
        component("mix-1", "MIXING_TANK", "r-mix-1", "GH-01"),
        component("dist-1", "DISTRIBUTION_PUMP", "r-dist-1", "GH-01"),
        component("mix-2", "MIXING_TANK", "r-mix-2", "GH-02"),
        component("dist-2", "DISTRIBUTION_PUMP", "r-dist-2", "GH-02"),
        component("flow-1", "FLOW_METER", "r-flow-1", "GH-01"),
        component("flow-2", "FLOW_METER", "r-flow-2", "GH-02"),
        component("level-1", "LEVEL_SENSOR", "r-level-1", "GH-01"),
        component("level-2", "LEVEL_SENSOR", "r-level-2", "GH-02"),
        component("fan-1", "FAN", "r-fan-1", "GH-01"),
        component("fan-2", "FAN", "r-fan-2", "GH-02"),
        component("route-1", "ROUTING_VALVE", "r-route-1"),
        component("route-2", "ROUTING_VALVE", "r-route-2"),
    ]
    resources = [{"resourceId": c["resourceId"], "type": c["role"], "componentId": c["componentId"], "shared": c["assignment"]["ghId"] is None, "available": True} for c in comps]
    assignments = [{"assignmentId": f"a-{i}", "resourceId": c["resourceId"], "scope": "GH" if c["assignment"]["ghId"] else "COMPLEX", "ghId": c["assignment"]["ghId"]} for i, c in enumerate(comps, 1)]
    return {
        "complexId": "complex-A", "version": 7, "configurationHash": "cfg7",
        "complexes": [{"complexId": "complex-A"}],
        "greenhouses": [{"ghId": "GH-01", "complexId": "complex-A"}, {"ghId": "GH-02", "complexId": "complex-A"}],
        "components": comps, "resources": resources, "assignments": assignments,
        "topology": [
            {"pathId": "raw1", "sourceResourceId": "r-well", "targetResourceId": "r-mix-1", "mode": "AUTOMATIC", "shared": True, "enabled": True, "targetGhId": "GH-01", "valveResourceId": "r-route-1"},
            {"pathId": "raw2", "sourceResourceId": "r-well", "targetResourceId": "r-mix-2", "mode": "AUTOMATIC", "shared": True, "enabled": True, "targetGhId": "GH-02", "valveResourceId": "r-route-2"},
            {"pathId": "mix1", "sourceResourceId": "r-mix-1", "targetResourceId": "r-dist-1", "mode": "AUTOMATIC", "shared": False, "enabled": True, "targetGhId": "GH-01"},
            {"pathId": "mix2", "sourceResourceId": "r-mix-2", "targetResourceId": "r-dist-2", "mode": "AUTOMATIC", "shared": False, "enabled": True, "targetGhId": "GH-02"},
        ],
        "recipes": [{"recipeId": "recipe-1", "name": "Base", "type": "FERTIGATION"}],
    }


class BackendM7M8Tests(unittest.TestCase):
    def test_topology_and_capabilities_are_derived(self):
        view = topology_capabilities(config())
        self.assertTrue(view["valid"])
        self.assertTrue(view["byGh"]["GH-01"]["hydraulicallyReachable"])
        self.assertTrue(view["byGh"]["GH-02"]["automaticallyRoutable"])
        self.assertTrue(view["byGh"]["GH-01"]["capabilities"]["CAN_AUTO_DOSE"])

    def test_topology_unknown_reference_invalid(self):
        cfg = config()
        cfg["topology"][0]["targetGhId"] = "GH-99"
        issues = validate_topology(cfg)
        self.assertTrue(any(x["code"] == "UNKNOWN_TOPOLOGY_GREENHOUSE" for x in issues))
        self.assertFalse(topology_capabilities(cfg)["valid"])

    def test_shared_source_without_routing_valves_is_not_auto_independent(self):
        cfg = config()
        cfg["topology"] = [{**path, "valveResourceId": None} for path in cfg["topology"]]
        view = topology_capabilities(cfg)
        self.assertTrue(view["byGh"]["GH-01"]["hydraulicallyReachable"])
        self.assertFalse(view["byGh"]["GH-01"]["automaticallyRoutable"])
        self.assertFalse(view["byGh"]["GH-01"]["capabilities"]["CAN_AUTO_FILL"])

    def test_fertigation_compiles_with_recipe_snapshot_and_config_version(self):
        cfg = config()
        cfg["components"].append(component("mix-pump-1", "MIXING_PUMP", "r-mix-pump-1", "GH-01"))
        cfg["resources"].append({"resourceId": "r-mix-pump-1", "type": "MIXING_PUMP", "componentId": "mix-pump-1", "shared": False, "available": True})
        cfg["assignments"].append({"assignmentId": "a-mix-pump-1", "resourceId": "r-mix-pump-1", "scope": "GH", "ghId": "GH-01"})
        cfg["sensorDefinitions"] = {
            "r-raw-flow": {"sensorId": "raw-flow", "sensorType": "FLOW", "source": "GPIO", "unit": "L/min", "samplingIntervalMs": 1000, "complexId": "complex-A", "installed": True, "calibrationReference": "CAL-RAW-V1", "calibrationVersion": 1},
            "r-flow-1": {"sensorId": "flow-1", "sensorType": "FLOW", "source": "GPIO", "unit": "L/min", "samplingIntervalMs": 1000, "complexId": "complex-A", "installed": True, "calibrationReference": "CAL-DEL-V1", "calibrationVersion": 1},
            "r-level-1": {"sensorId": "level-1", "sensorType": "LEVEL", "source": "GPIO", "unit": "state", "samplingIntervalMs": 1000, "complexId": "complex-A", "installed": True},
        }
        with tempfile.TemporaryDirectory() as td:
            repo = CalibrationRepository(Path(td) / "cal.sqlite3")
            repo.save(build_linear_calibration("raw-flow", "FLOW", 0, 0, 10, 10, "tester", version=1, calibration_id="CAL-RAW-V1", complex_id="complex-A", pulses_per_liter=450))
            repo.save(build_linear_calibration("flow-1", "FLOW", 0, 0, 10, 10, "tester", version=1, calibration_id="CAL-DEL-V1", complex_id="complex-A", pulses_per_liter=450))
            repo.save(build_dosing_calibration("dose-a", 100, 10, "tester", version=1, calibration_id="CAL-DOSE-A-V1", complex_id="complex-A"))
            prepared = prepare_run(cfg, {
                "ghId": "GH-01", "recipeId": "recipe-1", "targetWaterMl": 20000,
                "dosingChannels": [{"componentId": "dose-a", "requestedMl": 100, "calibrationId": "CAL-DOSE-A-V1", "calibrationVersion": 1}],
                "executionPlan": {"components": {"mixingTank": "mix-1", "rawWater": "well", "rawFlow": "raw-flow", "level": "level-1", "deliveryPump": "dist-1", "deliveryFlow": "flow-1", "mixingPump": "mix-pump-1"}},
                "deliveryMode": "VOLUME", "safetyAcknowledged": True, "triggerType": "SCHEDULE", "scheduleId": "s1", "operator": "owner-s1",
            }, repo, [])
            self.assertTrue(prepared["valid"], prepared.get("issues"))
            plan = prepared["executionPlan"] if "executionPlan" in prepared else prepared["run"]["executionPlan"]
            result = compile_schedule(cfg, {
                "scheduleId": "s1", "ownerId": "owner-s1", "complexId": "complex-A", "ghId": "GH-01",
                "action": "FERTIGATION", "enabled": True,
                "trigger": {"type": "DAILY", "hour": 6, "minute": 0, "daysOfWeek": 127},
                "recipeId": "recipe-1", "missedRunPolicy": "SKIP",
                "parameters": {"rawWaterVolumeMl": 20000, "executionPlan": plan},
            })
            self.assertEqual(result["status"], "ACTIVE")
            self.assertEqual(result["compiled"]["configurationVersion"], 7)
            self.assertEqual(result["compiled"]["recipeSnapshot"]["recipeId"], "recipe-1")
            self.assertEqual(result["compiled"]["activationState"], "ACTIVE")

    def test_shared_resource_does_not_block_second_compiled_schedule(self):
        cfg = config()
        schedules = [
            {"scheduleId": "pump-1", "complexId": "complex-A", "action": "WATER_PUMP", "enabled": True, "trigger": {"type": "DAILY", "hour": 6, "minute": 0, "daysOfWeek": 127}, "parameters": {"durationSec": 60}},
            {"scheduleId": "pump-2", "complexId": "complex-A", "action": "WATER_PUMP", "enabled": True, "trigger": {"type": "DAILY", "hour": 7, "minute": 0, "daysOfWeek": 127}, "parameters": {"durationSec": 60}},
        ]
        result = compile_schedule_set(cfg, schedules)
        self.assertEqual(len(result["compiled"]), 2)
        self.assertEqual(result["invalid"], [])

    def test_duplicate_schedule_id_is_invalid(self):
        cfg = config()
        intent = {"scheduleId": "dup", "complexId": "complex-A", "action": "WATER_PUMP", "enabled": True, "trigger": {"type": "DAILY", "hour": 6, "minute": 0, "daysOfWeek": 127}, "parameters": {"durationSec": 60}}
        result = compile_schedule_set(cfg, [intent, deepcopy(intent)])
        self.assertTrue(any(x["code"] == "DUPLICATE_SCHEDULE_ID" for x in result["invalid"][0]["errors"]))
        self.assertFalse(result["valid"])

    def test_temperature_fan_is_invalid(self):
        result = compile_schedule(config(), {
            "scheduleId": "fan-temp", "complexId": "complex-A", "ghId": "GH-01", "action": "FAN_TOGGLE", "enabled": True,
            "trigger": {"type": "DAILY", "hour": 10, "minute": 0, "daysOfWeek": 127}, "parameters": {"durationSec": 60, "controlMode": "TEMPERATURE"},
        })
        self.assertEqual(result["status"], "INVALID")
        self.assertTrue(any(x["code"] == "UNSUPPORTED_CONDITION_TRIGGER" for x in result["errors"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
