import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.sensor_calibration import (
    CalibrationRepository,
    build_dosing_calibration,
    build_linear_calibration,
    normalize_sensor_sample,
    validate_sensor_definition,
)
from backend.fertigation_engine import (
    FertigationRunRepository,
    precheck_fertigation,
    prepare_run,
)
from tests.support.fertigation_simulation import simulate_run


def comp(cid, role, rid, gh=None, shared=False):
    return {
        "componentId": cid,
        "supportedTypeId": role,
        "name": cid,
        "role": role,
        "resourceId": rid,
        "lifecycleState": "COMMISSIONED",
        "assignment": {"complexId": "CX", "ghId": gh},
    }


def cfg():
    comps = [
        comp("raw-pump", "WELL_PUMP", "r-raw"),
        comp("raw-flow", "FLOW_METER", "r-rflow", "GH-01"),
        comp("level", "LEVEL_SENSOR", "r-level", "GH-01"),
        comp("mix", "MIXING_TANK", "r-mix", "GH-01"),
        comp("mix-pump", "MIXING_PUMP", "r-mix-pump", "GH-01"),
        comp("dist", "DELIVERY_PUMP", "r-dist", "GH-01"),
        comp("dist-flow", "DELIVERY_FLOW_SENSOR", "r-dflow", "GH-01"),
        comp("pressure", "PRESSURE_SENSOR", "r-pressure", "GH-01"),
    ]
    for i in range(1, 8):
        comps.append(comp(f"dose-{i}", f"DOSING_{i}", f"r-dose-{i}", "GH-01"))
    resources = []
    for c in comps:
        resources.append({
            "resourceId": c["resourceId"],
            "componentId": c["componentId"],
            "type": c["role"],
            "shared": c["resourceId"] == "r-raw-shared",
            "available": True,
        })
    return {
        "complexId": "CX",
        "version": 12,
        "configurationHash": "hash12",
        "greenhouses": [{"ghId": "GH-01", "complexId": "CX"}],
        "components": comps,
        "resources": resources,
        "assignments": [
            {"assignmentId": f"a-{c['componentId']}", "resourceId": c["resourceId"], "scope": "GH", "ghId": c["assignment"]["ghId"]}
            for c in comps
        ],
        "topology": [
            {"pathId": "raw", "sourceResourceId": "r-raw", "targetResourceId": "r-mix", "mode": "AUTOMATIC", "shared": False, "enabled": True, "targetGhId": "GH-01"},
            {"pathId": "delivery", "sourceResourceId": "r-mix", "targetResourceId": "r-dist", "mode": "AUTOMATIC", "shared": False, "enabled": True, "targetGhId": "GH-01"},
        ],
        "recipes": [{"recipeId": "R1", "version": 3, "name": "Recipe 3", "type": "FERTIGATION", "mixingDurationSec": 42}],
        "sensorDefinitions": {
            "r-rflow": {"sensorId": "raw-flow", "sensorType": "FLOW", "source": "GPIO", "unit": "L/min", "samplingIntervalMs": 1000, "complexId": "CX", "installed": True, "calibrationReference": "CAL-RAW-FLOW-V1", "calibrationVersion": 1},
            "r-level": {"sensorId": "level", "sensorType": "LEVEL", "source": "GPIO", "unit": "state", "samplingIntervalMs": 1000, "complexId": "CX", "installed": True},
            "r-dflow": {"sensorId": "dist-flow", "sensorType": "FLOW", "source": "GPIO", "unit": "L/min", "samplingIntervalMs": 1000, "complexId": "CX", "installed": True, "calibrationReference": "CAL-DELIVERY-FLOW-V1", "calibrationVersion": 1},
        },
    }


class M11M12Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cal = CalibrationRepository(Path(self.tmp.name) / "cal.sqlite3")
        self.runs = FertigationRunRepository(Path(self.tmp.name) / "run.sqlite3")
        self.configuration = cfg()

    def tearDown(self):
        self.tmp.cleanup()

    def _seed_cals(self, n=7):
        self.cal.save(build_linear_calibration("raw-flow", "FLOW", 0, 0, 10, 10, "tech", version=1, calibration_id="CAL-RAW-FLOW-V1", complex_id="CX", pulses_per_liter=450.0))
        self.cal.save(build_linear_calibration("dist-flow", "FLOW", 0, 0, 10, 10, "tech", version=1, calibration_id="CAL-DELIVERY-FLOW-V1", complex_id="CX", pulses_per_liter=450.0))
        for i in range(1, n + 1):
            self.cal.save(build_dosing_calibration(f"dose-{i}", 100 + i, 10, "tech", version=1, calibration_id=f"CAL-DOSE-{i}-V1", complex_id="CX"))

    def _request(self, n=2):
        return {
            "ghId": "GH-01",
            "recipeId": "R1",
            "targetWaterMl": 100000,
            "dosingChannels": [{"componentId": f"dose-{i}", "requestedMl": 100, "calibrationId": f"CAL-DOSE-{i}-V1", "calibrationVersion": 1} for i in range(1, n + 1)],
            "deliveryMode": "VOLUME",
            "safetyAcknowledged": True,
            "operator": "tech",
            "triggerType": "MANUAL",
        }

    def test_sensor_schema_all_required_fields(self):
        good = {"sensorId": "s1", "sensorType": "TEMPERATURE", "source": "GPIO", "channel": 4, "unit": "C", "samplingIntervalMs": 1000, "minValue": -40, "maxValue": 80, "installed": True, "complexId": "CX"}
        self.assertEqual(validate_sensor_definition(good), [])
        self.assertTrue(any(x["code"] == "SENSOR_ID_REQUIRED" for x in validate_sensor_definition({"sensorType": "TEMPERATURE", "source": "GPIO", "unit": "C", "samplingIntervalMs": 1})))
        self.assertTrue(any(x["code"] == "INVALID_SENSOR_CHANNEL" for x in validate_sensor_definition({**good, "channel": -1})))

    def test_sensor_quality_valid_stale_unavailable_out_of_range_invalid(self):
        d = {"sensorId": "s1", "sensorType": "TEMPERATURE", "source": "GPIO", "unit": "C", "samplingIntervalMs": 1000, "minValue": -40, "maxValue": 80, "installed": True, "complexId": "CX"}
        self.assertEqual(normalize_sensor_sample(d, 25, 1000)["quality"], "VALID")
        d_stale = {**d, "lastSampleTimestampMs": 0}
        self.assertEqual(normalize_sensor_sample(d_stale, 25, 10000)["quality"], "STALE")
        d_uninstalled = {**d, "installed": False}
        unavailable = normalize_sensor_sample(d_uninstalled, 25, 1000)
        self.assertEqual(unavailable["quality"], "UNAVAILABLE")
        self.assertIsNone(unavailable["value"])
        self.assertEqual(normalize_sensor_sample(d, 99, 1000)["quality"], "OUT_OF_RANGE")
        self.assertEqual(normalize_sensor_sample(d, "not-a-number", 1000)["quality"], "INVALID")

    def test_linear_calibration_types_and_history(self):
        for idx, ctype in enumerate(("FLOW", "LEVEL", "PH", "EC"), start=1):
            record = build_linear_calibration(f"sensor-{idx}", ctype, 0, 0, 10, 20, "tech", version=1, calibration_id=f"CAL-{ctype}-1", complex_id="CX")
            self.cal.save(record)
            self.assertTrue(self.cal.active(f"sensor-{idx}", ctype).usable)
            self.assertAlmostEqual(self.cal.active(f"sensor-{idx}", ctype).apply(5), 10.0)
        self.assertEqual(len(self.cal.history()), 4)

    def test_calibration_version_conflict_rejected(self):
        first = build_dosing_calibration("dose-1", 100, 10, "tech", version=1, calibration_id="CAL-DOSE-1-V1", complex_id="CX")
        self.cal.save(first)
        with self.assertRaises(ValueError) as ctx:
            self.cal.save(build_dosing_calibration("dose-1", 120, 10, "tech", version=1, calibration_id="CAL-DOSE-1-V1-NEW", complex_id="CX"))
        self.assertEqual(str(ctx.exception), "CALIBRATION_VERSION_CONFLICT")

    def test_exact_calibration_reference_integrity_and_complex_boundary(self):
        self._seed_cals(1)
        good = self.cal.exact("CX", "dose-1", "DOSING_RATE", "CAL-DOSE-1-V1", 1)
        self.assertIsNotNone(good)
        self.assertIsNone(self.cal.exact("OTHER", "dose-1", "DOSING_RATE", "CAL-DOSE-1-V1", 1))
        self.assertIsNone(self.cal.exact("CX", "dose-1", "DOSING_RATE", "CAL-FAKE", 999))
        self.assertIsNone(self.cal.exact("CX", "dose-2", "DOSING_RATE", "CAL-DOSE-1-V1", 1))

    def test_exact_reference_blocks_silent_latest_fallback(self):
        self._seed_cals(1)
        self.cal.save(build_dosing_calibration("dose-1", 200, 10, "tech", version=2, calibration_id="CAL-DOSE-1-V2", complex_id="CX"))
        req = self._request(1)
        req["dosingChannels"][0].update({"calibrationId": "CAL-FAKE", "calibrationVersion": 999})
        result = precheck_fertigation(self.configuration, req, self.cal)
        self.assertFalse(result["valid"])
        self.assertTrue(any(x["code"] == "CALIBRATION_REFERENCE_INVALID" for x in result["issues"]))

    def test_flow_volume_requires_exact_flow_calibration(self):
        self._seed_cals(1)
        req=self._request(1)
        req["executionPlan"]={"components":{"rawFlow":"raw-flow","deliveryFlow":"dist-flow"}}
        ok=precheck_fertigation(self.configuration,req,self.cal)
        self.assertTrue(ok["valid"])
        self.configuration["sensorDefinitions"]["r-rflow"]["calibrationReference"]="CAL-FAKE"
        bad=precheck_fertigation(self.configuration,req,self.cal)
        self.assertFalse(bad["valid"])
        self.assertTrue(any(x["code"]=="FLOW_CALIBRATION_REFERENCE_INVALID" for x in bad["issues"]))

    def test_missing_calibration_reference_is_blocked(self):
        self._seed_cals(1)
        req = self._request(1)
        req["dosingChannels"][0].pop("calibrationId")
        req["dosingChannels"][0].pop("calibrationVersion")
        result = precheck_fertigation(self.configuration, req, self.cal)
        self.assertFalse(result["valid"])
        self.assertTrue(any(x["code"] == "CALIBRATION_REFERENCE_REQUIRED" for x in result["issues"]))

    def test_plan_binds_exact_components_and_configuration_version(self):
        self._seed_cals(1)
        prepared = prepare_run(self.configuration, self._request(1), self.cal)
        self.assertTrue(prepared["valid"])
        plan = prepared["run"]["executionPlan"]
        self.assertEqual(plan["configurationVersion"], 12)
        self.assertEqual(plan["components"]["mixingTank"], "mix")
        self.assertEqual(plan["dosingChannels"][0]["calibrationId"], "CAL-DOSE-1-V1")
        broken = deepcopy(plan); broken["configurationVersion"] = 11
        from backend.fertigation_engine import validate_execution_plan
        self.assertTrue(any(x["code"] == "PLAN_CONFIGURATION_VERSION_MISMATCH" for x in validate_execution_plan(self.configuration, broken, self.cal)))

    def test_expired_and_suspect_calibration_not_usable(self):
        expired = build_dosing_calibration("dose-1", 100, 10, "tech", state="EXPIRED", version=1, calibration_id="CAL-EXPIRED", complex_id="CX")
        suspect = build_dosing_calibration("dose-2", 100, 10, "tech", state="SUSPECT", version=1, calibration_id="CAL-SUSPECT", complex_id="CX")
        self.cal.save(expired); self.cal.save(suspect)
        self.assertFalse(self.cal.active("dose-1", "DOSING_RATE").usable)
        self.assertFalse(self.cal.active("dose-2", "DOSING_RATE").usable)


    def test_exact_reference_rejects_stale_version_and_unusable_state(self):
        self._seed_cals(1)
        valid_v1 = self.cal.exact("CX", "dose-1", "DOSING_RATE", "CAL-DOSE-1-V1", 1)
        self.assertIsNotNone(valid_v1)
        self.cal.save(build_dosing_calibration("dose-1", 150, 10, "tech", version=2, calibration_id="CAL-DOSE-1-V2", complex_id="CX", state="SUSPECT"))
        self.assertIsNone(self.cal.exact("CX", "dose-1", "DOSING_RATE", "CAL-DOSE-1-V1", 2))
        self.assertIsNone(self.cal.exact("CX", "dose-1", "DOSING_RATE", "CAL-DOSE-1-V2", 2))
        req = self._request(1)
        req["dosingChannels"][0].update({"calibrationId": "CAL-DOSE-1-V2", "calibrationVersion": 2})
        result = precheck_fertigation(self.configuration, req, self.cal)
        self.assertFalse(result["valid"])
        self.assertTrue(any(x["code"] == "CALIBRATION_SUSPECT" for x in result["issues"]))

    def test_calibration_error_precedence_matrix(self):
        # Exact reference errors must be deterministic and must never substitute
        # a different calibration record.
        self._seed_cals(7)
        self.cal.save(build_dosing_calibration("dose-2", 100, 10, "tech", version=2, calibration_id="CAL-WRONG-COMP", complex_id="CX"))
        self.cal.save(build_dosing_calibration("dose-3", 100, 10, "tech", version=2, calibration_id="CAL-WRONG-CX", complex_id="OTHER"))
        self.cal.save(build_dosing_calibration("dose-4", 100, 10, "tech", version=2, calibration_id="CAL-VERSION", complex_id="CX"))
        self.cal.save(build_dosing_calibration("dose-5", 100, 10, "tech", state="EXPIRED", version=2, calibration_id="CAL-EXPIRED-EXACT", complex_id="CX"))
        self.cal.save(build_dosing_calibration("dose-6", 100, 10, "tech", state="SUSPECT", version=2, calibration_id="CAL-SUSPECT-EXACT", complex_id="CX"))
        self.cal.save(build_dosing_calibration("dose-7", 100, 10, "tech", state="REMOVED", version=2, calibration_id="CAL-REMOVED-EXACT", complex_id="CX"))

        cases = [
            ("dose-1", "CAL-UNKNOWN", 999, "CALIBRATION_REFERENCE_INVALID"),
            ("dose-1", "CAL-DOSE-1-V1", 999, "CALIBRATION_VERSION_MISMATCH"),
            ("dose-1", "CAL-WRONG-COMP", 2, "CALIBRATION_COMPONENT_MISMATCH"),
            ("dose-1", "CAL-WRONG-CX", 2, "CALIBRATION_COMPLEX_MISMATCH"),
            ("dose-5", "CAL-EXPIRED-EXACT", 2, "CALIBRATION_EXPIRED"),
            ("dose-6", "CAL-SUSPECT-EXACT", 2, "CALIBRATION_SUSPECT"),
            ("dose-7", "CAL-REMOVED-EXACT", 2, "CALIBRATION_REMOVED"),
        ]
        for component_id, calibration_id, version, expected in cases:
            req = self._request(1)
            req["dosingChannels"][0].update({"componentId": component_id, "calibrationId": calibration_id, "calibrationVersion": version})
            result = precheck_fertigation(self.configuration, req, self.cal)
            self.assertFalse(result["valid"], (component_id, calibration_id, result))
            self.assertIn(expected, {x["code"] for x in result["issues"]}, (component_id, result["issues"]))

    def test_removed_calibration_is_retained_in_history_but_not_usable(self):
        record = build_dosing_calibration("dose-1", 100, 10, "tech", state="REMOVED", version=1, calibration_id="CAL-REMOVED", complex_id="CX")
        self.cal.save(record)
        history = self.cal.history(component_id="dose-1", complex_id="CX")
        self.assertEqual(history[0].calibrationId, "CAL-REMOVED")
        self.assertFalse(history[0].usable)
        self.assertIsNone(self.cal.exact("CX", "dose-1", "DOSING_RATE", "CAL-REMOVED", 1))

    def test_execution_plan_sensor_calibration_reference_matches_descriptor(self):
        self._seed_cals(1)
        prepared = prepare_run(self.configuration, self._request(1), self.cal)
        self.assertTrue(prepared["valid"])
        plan = deepcopy(prepared["run"]["executionPlan"])
        plan["sensorCalibrations"]["rawFlow"]["calibrationId"] = "CAL-FAKE"
        from backend.fertigation_engine import validate_execution_plan
        issues = validate_execution_plan(self.configuration, plan, self.cal)
        self.assertTrue(any(x["code"] == "PLAN_SENSOR_CALIBRATION_REFERENCE_INVALID" for x in issues))

    def test_multi_gh_fertigation_isolation(self):
        self._seed_cals(1)
        cfg2 = deepcopy(self.configuration)
        cfg2["greenhouses"].append({"ghId": "GH-02", "complexId": "CX"})
        clones = []
        resource_clones = []
        for cid, rid, role in (("mix-2","r-mix-2","MIXING_TANK"),("mix-pump-2","r-mix-pump-2","MIXING_PUMP"),("dist-2","r-dist-2","DELIVERY_PUMP"),("dist-flow-2","r-dflow-2","DELIVERY_FLOW_SENSOR"),("level-2","r-level-2","LEVEL_SENSOR"),("raw-flow-2","r-rflow-2","FLOW_METER"),("dose-2a","r-dose-2a","DOSING_A"),("dose-2b","r-dose-2b","DOSING_B")):
            base = {"mix-2":"mix","mix-pump-2":"mix-pump","dist-2":"dist","dist-flow-2":"dist-flow","level-2":"level","raw-flow-2":"raw-flow","dose-2a":"dose-1","dose-2b":"dose-2"}[cid]
            item = deepcopy(next(c for c in cfg2["components"] if c["componentId"] == base))
            item["componentId"] = cid; item["name"] = cid; item["resourceId"] = rid; item["assignment"]["ghId"] = "GH-02"
            clones.append(item); resource_clones.append({"resourceId":rid,"componentId":cid,"type":role,"shared":False,"available":True})
        # The raw-water pump is intentionally shared infrastructure for both GHs.
        for resource in cfg2["resources"]:
            if resource["resourceId"] == "r-raw":
                resource["shared"] = True
        cfg2["components"].extend(clones); cfg2["resources"].extend(resource_clones)
        cfg2["assignments"].extend({"assignmentId":f"a-{x['componentId']}","resourceId":x["resourceId"],"scope":"GH","ghId":"GH-02"} for x in clones)
        cfg2["topology"].extend([
            {"pathId":"raw-gh2","sourceResourceId":"r-raw","targetResourceId":"r-mix-2","mode":"AUTOMATIC","shared":False,"enabled":True,"targetGhId":"GH-02"},
            {"pathId":"delivery-gh2","sourceResourceId":"r-mix-2","targetResourceId":"r-dist-2","mode":"AUTOMATIC","shared":False,"enabled":True,"targetGhId":"GH-02"},
        ])
        cfg2["recipes"].append({"recipeId":"R2","version":1,"name":"Recipe GH2","type":"FERTIGATION","mixingDurationSec":10})
        cfg2["sensorDefinitions"]["r-rflow-2"]={"sensorId":"raw-flow-2","sensorType":"FLOW","source":"GPIO","unit":"L/min","samplingIntervalMs":1000,"complexId":"CX","installed":True,"calibrationReference":"CAL-RAW-FLOW-GH2-V1","calibrationVersion":1}
        cfg2["sensorDefinitions"]["r-dflow-2"]={"sensorId":"dist-flow-2","sensorType":"FLOW","source":"GPIO","unit":"L/min","samplingIntervalMs":1000,"complexId":"CX","installed":True,"calibrationReference":"CAL-DELIVERY-FLOW-V2","calibrationVersion":1}
        self.cal.save(build_linear_calibration("raw-flow-2","FLOW",0,0,10,10,"tech",version=1,calibration_id="CAL-RAW-FLOW-GH2-V1",complex_id="CX",pulses_per_liter=450.0))
        self.cal.save(build_linear_calibration("dist-flow-2","FLOW",0,0,10,10,"tech",version=1,calibration_id="CAL-DELIVERY-FLOW-V2",complex_id="CX",pulses_per_liter=450.0))
        self.cal.save(build_dosing_calibration("dose-2a",100,10,"tech",version=1,calibration_id="CAL-DOSE-2A-V1",complex_id="CX"))
        self.cal.save(build_dosing_calibration("dose-2b",100,10,"tech",version=1,calibration_id="CAL-DOSE-2B-V1",complex_id="CX"))
        req1=self._request(1); req2={**self._request(2),"ghId":"GH-02","recipeId":"R2","dosingChannels":[{"componentId":"dose-2a","requestedMl":100,"calibrationId":"CAL-DOSE-2A-V1","calibrationVersion":1},{"componentId":"dose-2b","requestedMl":100,"calibrationId":"CAL-DOSE-2B-V1","calibrationVersion":1}]}
        p1=prepare_run(cfg2,req1,self.cal); p2=prepare_run(cfg2,req2,self.cal)
        self.assertTrue(p1["valid"], p1); self.assertTrue(p2["valid"], p2)
        self.assertEqual(p1["run"]["ghId"],"GH-01"); self.assertEqual(p2["run"]["ghId"],"GH-02")
        self.assertNotEqual(p1["run"]["executionPlan"]["components"]["mixingTank"], p2["run"]["executionPlan"]["components"]["mixingTank"])
        self.assertNotEqual(p1["run"]["executionPlan"]["components"]["deliveryPump"], p2["run"]["executionPlan"]["components"]["deliveryPump"])
        self.assertEqual(p1["run"]["executionPlan"]["components"]["rawFlow"], "raw-flow")
        self.assertEqual(p2["run"]["executionPlan"]["components"]["rawFlow"], "raw-flow-2")
        self.assertEqual(p1["run"]["executionPlan"]["components"]["mixingPump"], "mix-pump")
        self.assertEqual(p2["run"]["executionPlan"]["components"]["mixingPump"], "mix-pump-2")
        self.assertEqual(set(p1["run"]["resourceIds"]) & set(p2["run"]["resourceIds"]), {"r-raw"})
        broken_cfg = deepcopy(cfg2)
        broken_cfg["components"] = [c for c in broken_cfg["components"] if c["componentId"] not in {"raw-flow-2", "mix-pump-2"}]
        broken_cfg["resources"] = [r for r in broken_cfg["resources"] if r["resourceId"] not in {"r-rflow-2", "r-mix-pump-2"}]
        broken_req = deepcopy(req2)
        blocked = prepare_run(broken_cfg, broken_req, self.cal)
        self.assertFalse(blocked["valid"])
        self.assertIn("RAW_FLOW_SENSOR_REQUIRED", {x["code"] for x in blocked["issues"]})
        self.assertIn("MIXING_PUMP_REQUIRED", {x["code"] for x in blocked["issues"]})


    def test_legacy_ab_payload_is_not_an_execution_fallback(self):
        self._seed_cals(2)
        request = self._request(0)
        request.pop("dosingChannels", None)
        request.update({"dosingAMl": 100, "dosingBMl": 100})
        result = precheck_fertigation(self.configuration, request, self.cal)
        self.assertFalse(result["valid"], result)
        self.assertIn("DOSING_CHANNELS_REQUIRED", {x["code"] for x in result["issues"]})

    def test_flow_calibration_reference_is_exact_and_never_latest_fallback(self):
        self._seed_cals(1)
        self.cal.save(build_linear_calibration("raw-flow", "FLOW", 0, 0, 10, 10, "tech", state="SUSPECT", version=2, calibration_id="CAL-RAW-FLOW-V2-SUSPECT", complex_id="CX", pulses_per_liter=450.0))
        cfg2 = deepcopy(self.configuration)
        cfg2["sensorDefinitions"]["r-rflow"]["calibrationReference"] = "CAL-RAW-FLOW-V2-SUSPECT"
        cfg2["sensorDefinitions"]["r-rflow"]["calibrationVersion"] = 2
        result = precheck_fertigation(cfg2, self._request(1), self.cal)
        self.assertFalse(result["valid"], result)
        self.assertIn("FLOW_CALIBRATION_SUSPECT", {x["code"] for x in result["issues"]})
        cfg3 = deepcopy(self.configuration)
        cfg3["sensorDefinitions"]["r-rflow"]["calibrationVersion"] = 999
        result2 = precheck_fertigation(cfg3, self._request(1), self.cal)
        self.assertFalse(result2["valid"], result2)
        self.assertIn("FLOW_CALIBRATION_VERSION_MISMATCH", {x["code"] for x in result2["issues"]})

    def test_validity_expiry_window(self):
        expired = build_dosing_calibration("dose-1", 100, 10, "tech", state="EXPIRED", version=1, calibration_id="CAL-EXPIRED-WINDOW", complex_id="CX")
        self.cal.save(expired)
        self.assertFalse(self.cal.active("dose-1", "DOSING_RATE").usable)

    def test_missing_target_gh_and_recipe_block(self):
        self._seed_cals(1)
        bad = self._request(1); bad["ghId"] = "GH-404"
        self.assertFalse(precheck_fertigation(self.configuration, bad, self.cal)["valid"])
        bad2 = self._request(1); bad2["recipeId"] = "R404"
        self.assertFalse(precheck_fertigation(self.configuration, bad2, self.cal)["valid"])

    def test_required_safety_ack_blocks(self):
        self._seed_cals(1)
        req = self._request(1); req["safetyAcknowledged"] = False
        result = precheck_fertigation(self.configuration, req, self.cal)
        self.assertFalse(result["valid"])
        self.assertTrue(any(x["code"] == "SAFETY_ACK_REQUIRED" for x in result["issues"]))

    def test_required_delivery_sensor_modes(self):
        self._seed_cals(1)
        no_flow = deepcopy(self.configuration)
        no_flow["components"] = [c for c in no_flow["components"] if c["componentId"] != "dist-flow"]
        req = self._request(1)
        self.assertFalse(precheck_fertigation(no_flow, req, self.cal)["valid"])
        req["deliveryMode"] = "PRESSURE_FLOW"; req["targetPressureKpa"] = 100
        self.assertFalse(precheck_fertigation(no_flow, req, self.cal)["valid"])
        req["deliveryMode"] = "DURATION"; req["allowDurationFallback"] = True; req["deliveryDurationSec"] = 60
        self.assertTrue(precheck_fertigation(no_flow, req, self.cal)["valid"])

    def test_flow_and_pressure_targets_are_required(self):
        self._seed_cals(1)
        req = self._request(1); req["deliveryMode"] = "FLOW"
        self.assertFalse(precheck_fertigation(self.configuration, req, self.cal)["valid"])
        req["targetFlowLpm"] = 5
        self.assertTrue(precheck_fertigation(self.configuration, req, self.cal)["valid"])
        req = self._request(1); req["deliveryMode"] = "PRESSURE_FLOW"
        self.assertFalse(precheck_fertigation(self.configuration, req, self.cal)["valid"])
        req["targetPressureKpa"] = 100
        self.assertTrue(precheck_fertigation(self.configuration, req, self.cal)["valid"])

    def test_seven_channels_and_unknown_duplicate(self):
        self._seed_cals(7)
        result = precheck_fertigation(self.configuration, self._request(7), self.cal)
        self.assertTrue(result["valid"])
        dup = self._request(2); dup["dosingChannels"][1]["componentId"] = dup["dosingChannels"][0]["componentId"]
        self.assertFalse(precheck_fertigation(self.configuration, dup, self.cal)["valid"])
        unknown = self._request(1); unknown["dosingChannels"][0]["componentId"] = "dose-999"
        self.assertFalse(precheck_fertigation(self.configuration, unknown, self.cal)["valid"])
        too_many = {**self._request(7), "dosingChannels": [{"componentId": f"dose-{i}", "requestedMl": 1} for i in range(1, 9)]}
        self.assertFalse(precheck_fertigation(self.configuration, too_many, self.cal)["valid"])

    def test_dosing_runtime_policy(self):
        self._seed_cals(1)
        req = self._request(1); req["minDosingRuntimeSec"] = 1000
        self.assertFalse(precheck_fertigation(self.configuration, req, self.cal)["valid"])
        req = self._request(1); req["minDosingRuntimeSec"] = 10; req["maxDosingRuntimeSec"] = 5
        self.assertFalse(precheck_fertigation(self.configuration, req, self.cal)["valid"])

    def test_resource_conflict_exclusive_vs_shared(self):
        self._seed_cals(1)
        req = self._request(1)
        active = [{"runId": "r-live", "status": "PREPARED", "resourceIds": ["r-dist"]}]
        self.assertFalse(precheck_fertigation(self.configuration, req, self.cal, active)["valid"])
        shared_cfg = deepcopy(self.configuration)
        for r in shared_cfg["resources"]:
            if r["resourceId"] == "r-dist": r["shared"] = True
        self.assertTrue(precheck_fertigation(shared_cfg, req, self.cal, active)["valid"])

    def test_prepare_run_immutable_recipe_configuration_snapshot(self):
        self._seed_cals(3)
        prepared = prepare_run(self.configuration, self._request(3), self.cal)
        self.assertTrue(prepared["valid"])
        recipe_snapshot = deepcopy(prepared["run"]["recipeSnapshot"])
        cal_refs = deepcopy(prepared["run"]["calibrationReferences"])
        self.configuration["recipes"][0]["mixingDurationSec"] = 999
        self.assertEqual(prepared["run"]["recipeSnapshot"], recipe_snapshot)
        self.assertEqual(prepared["run"]["calibrationReferences"], cal_refs)
        self.assertEqual(prepared["run"]["configurationVersion"], 12)

    def test_simulation_phase_records_and_mixed_vs_delivered(self):
        self._seed_cals(3)
        prepared = prepare_run(self.configuration, self._request(3), self.cal)
        run = simulate_run(prepared, delivered_ml=100000, actual_water_ml=100100, now_ms=100000)
        self.assertEqual(run["status"], "COMPLETE")
        self.assertEqual(run["actualWaterMl"], 100100)
        self.assertEqual(run["actualDeliveredMl"], 100000)
        self.assertTrue(run["mixingCompleted"])
        self.assertTrue(run["deliveredVolumeVerified"])
        self.assertLess(run["actualDeliveredMl"], run["actualWaterMl"])
        self.assertEqual(set(run["phaseTimestamps"]), {"PRECHECK", "FILLING", "DOSING", "FINAL_MIXING", "DELIVERY", "COMPLETE"})


    def test_simulation_flow_mode_requires_actual_flow_measurement(self):
        self._seed_cals(1)
        req = self._request(1); req.update({"deliveryMode": "FLOW", "targetFlowLpm": 5})
        prepared = prepare_run(self.configuration, req, self.cal)
        self.assertTrue(prepared["valid"])
        missing = simulate_run(prepared, delivered_ml=100000, actual_water_ml=100000, now_ms=100000)
        self.assertEqual(missing["status"], "FAULTED")
        self.assertEqual(missing["fault"], "DELIVERY_FLOW_MEASUREMENT_REQUIRED")
        measured = simulate_run(prepared, delivered_ml=100000, actual_water_ml=100000, now_ms=100000, actual_flow_lpm=6)
        self.assertEqual(measured["status"], "COMPLETE")
        self.assertTrue(measured["deliveredVolumeVerified"])

    def test_simulation_pressure_flow_mode_requires_actual_pressure_measurement(self):
        self._seed_cals(1)
        req = self._request(1); req.update({"deliveryMode": "PRESSURE_FLOW", "targetPressureKpa": 100})
        prepared = prepare_run(self.configuration, req, self.cal)
        self.assertTrue(prepared["valid"])
        missing = simulate_run(prepared, delivered_ml=100000, actual_water_ml=100000, now_ms=100000, actual_flow_lpm=6)
        self.assertEqual(missing["status"], "FAULTED")
        self.assertEqual(missing["fault"], "DELIVERY_PRESSURE_MEASUREMENT_REQUIRED")
        measured = simulate_run(prepared, delivered_ml=100000, actual_water_ml=100000, now_ms=100000, actual_flow_lpm=6, actual_pressure_kpa=120)
        self.assertEqual(measured["status"], "COMPLETE")
        self.assertTrue(measured["deliveredVolumeVerified"])

    def test_simulation_run_record_distinguishes_calculated_dosing_and_delivery_measurement(self):
        self._seed_cals(2)
        prepared = prepare_run(self.configuration, self._request(2), self.cal)
        run = simulate_run(prepared, delivered_ml=100000, actual_water_ml=100100, now_ms=100000)
        self.assertEqual(len(run["dosingChannels"]), 2)
        self.assertTrue(all(c["actualDosedMl"] > 0 for c in run["dosingChannels"]))
        self.assertTrue(all(c["measurementSource"] == "CALIBRATION_RATE_X_OBSERVED_RUNTIME" for c in run["dosingChannels"]))
        self.assertEqual(run["mixedVolumeMeasurementQuality"], "CALCULATED")
        self.assertEqual(run["deliveredVolumeMeasurementSource"], "SIMULATION_INPUT")
        self.assertTrue(run["deliveredVolumeVerified"])

    def test_duration_fallback_is_explicit_and_not_verified_volume(self):
        self._seed_cals(1)
        req = self._request(1); req.update({"deliveryMode": "DURATION", "allowDurationFallback": True, "deliveryDurationSec": 60})
        prepared = prepare_run(self.configuration, req, self.cal)
        self.assertTrue(prepared["valid"])
        run = simulate_run(prepared, delivered_ml=0, actual_water_ml=100000, now_ms=100000)
        self.assertFalse(run["deliveredVolumeVerified"])
        self.assertEqual(run["deliveryMode"], "DURATION")

    def test_durable_run_record_round_trip(self):
        self._seed_cals(3)
        prepared = prepare_run(self.configuration, self._request(3), self.cal)
        run = simulate_run(prepared, delivered_ml=100000, actual_water_ml=100100, now_ms=100000)
        self.runs.save(run)
        loaded = self.runs.list("CX", "GH-01")[0]
        self.assertEqual(loaded["runId"], run["runId"])
        self.assertEqual(loaded["status"], "COMPLETE")
        self.assertEqual(len(loaded["calibrationReferences"]), 3)

    def test_run_record_uses_actual_runtime_for_mixed_volume(self):
        self._seed_cals(1)
        prepared = prepare_run(self.configuration, self._request(1), self.cal)
        run = simulate_run(prepared, delivered_ml=100000, actual_water_ml=100000, now_ms=100000)
        self.assertAlmostEqual(run["actualMixedVolumeMl"], run["actualWaterMl"] + run["actualDosedMl"])
        self.assertEqual(run["mixedVolumeMeasurementSource"], "CALCULATED_FROM_MEASURED_WATER_AND_CALIBRATED_DOSING")
        self.assertEqual(run["mixedVolumeMeasurementQuality"], "CALCULATED")

    def test_run_repository_replace_preserves_latest_record(self):
        self._seed_cals(1)
        prepared = prepare_run(self.configuration, self._request(1), self.cal)
        run = simulate_run(prepared, now_ms=100000)
        self.runs.save(run)
        changed = deepcopy(run); changed["status"] = "FAULTED"; changed["fault"] = "TEST"
        self.runs.save(changed)
        loaded = self.runs.list("CX", "GH-01")[0]
        self.assertEqual(loaded["status"], "FAULTED")
        self.assertEqual(loaded["fault"], "TEST")

if __name__ == "__main__":
    unittest.main(verbosity=2)
