"""TEST-ONLY fertigation simulation helper. Never import from production runtime.

This module exists solely to preserve host-side regression coverage after the production
simulation endpoint was removed. Its values are explicitly simulated and are not physical evidence.
"""
from __future__ import annotations

import time
from copy import deepcopy
from typing import Any

def simulate_run(prepared: dict[str, Any], delivered_ml: float | None = None, actual_water_ml: float | None = None, now_ms: int | None = None, actual_flow_lpm: float | None = None, actual_pressure_kpa: float | None = None) -> dict[str, Any]:
    if not prepared.get("valid"):
        raise ValueError("Cannot simulate an invalid fertigation preparation")
    run = deepcopy(prepared["run"])
    start = int(now_ms if now_ms is not None else time.time() * 1000)
    phases = ["PRECHECK", "FILLING", "DOSING", "FINAL_MIXING", "DELIVERY", "COMPLETE"]
    run["startTimestampMs"] = start
    for i, phase in enumerate(phases):
        run["phaseTimestamps"][phase] = start + i * 1000
    run["actualWaterMl"] = float(actual_water_ml if actual_water_ml is not None else run["targetWaterMl"])
    run["dosingChannels"] = []
    for c in run["targetDosing"]:
        runtime = float(c["runtimeSec"])
        run["actualDosingRuntimesSec"][c["componentId"]] = runtime
        run["dosingChannels"].append({
            "componentId": c["componentId"],
            "requestedMl": float(c["requestedMl"]),
            "actualRuntimeSec": runtime,
            "actualDosedMl": runtime * float(c["rateMlPerSec"]),
            "measurementSource": "CALIBRATION_RATE_X_OBSERVED_RUNTIME",
            "measurementQuality": "SIMULATED",
            "calibrationId": c["calibrationId"],
            "calibrationVersion": c["calibrationVersion"],
        })
    run["actualDosedMl"] = sum(float(c["actualDosedMl"]) for c in run["dosingChannels"])
    run["actualMixedVolumeMl"] = run["actualWaterMl"] + run["actualDosedMl"]
    run["mixedVolumeMeasurementSource"] = "CALCULATED_FROM_MEASURED_WATER_AND_CALIBRATED_DOSING"
    run["mixedVolumeMeasurementQuality"] = "CALCULATED"
    run["actualDeliveredMl"] = float(delivered_ml if delivered_ml is not None else run["deliveryTargetMl"])
    run["deliveredVolumeMeasurementSource"] = "SIMULATION_INPUT" if delivered_ml is not None else "SIMULATION_TARGET"
    run["deliveredVolumeMeasurementQuality"] = "SIMULATED"
    run["actualFlowLpm"] = actual_flow_lpm
    run["actualPressureKpa"] = actual_pressure_kpa
    run["endTimestampMs"] = start + len(phases) * 1000
    run["mixingCompleted"] = True
    target = float(run["deliveryTargetMl"] or 0)
    tolerance = float(run.get("deliveryToleranceMl") or 0)
    volume_ok = run["deliveryMode"] == "DURATION" or run["actualDeliveredMl"] + tolerance >= target
    flow_required = run["deliveryMode"] == "FLOW"
    pressure_required = run["deliveryMode"] == "PRESSURE_FLOW"
    flow_ok = not flow_required or (actual_flow_lpm is not None and float(actual_flow_lpm) >= float(run["targetFlowLpm"]))
    pressure_ok = not pressure_required or (actual_pressure_kpa is not None and float(actual_pressure_kpa) >= float(run["targetPressureKpa"]))
    run["deliveredVolumeVerified"] = run["deliveryMode"] != "DURATION" and delivered_ml is not None and volume_ok and flow_ok and pressure_ok
    run["deliveryConditionVerified"] = run["deliveryMode"] == "DURATION" or (delivered_ml is not None and volume_ok and flow_ok and pressure_ok)
    if not volume_ok:
        run["status"] = "FAULTED"
        run["fault"] = "DELIVERY_TARGET_NOT_REACHED"
    elif not flow_ok:
        run["status"] = "FAULTED"
        run["fault"] = "DELIVERY_FLOW_MEASUREMENT_REQUIRED" if actual_flow_lpm is None else "DELIVERY_FLOW_TARGET_NOT_REACHED"
    elif not pressure_ok:
        run["status"] = "FAULTED"
        run["fault"] = "DELIVERY_PRESSURE_MEASUREMENT_REQUIRED" if actual_pressure_kpa is None else "DELIVERY_PRESSURE_TARGET_NOT_REACHED"
    else:
        run["status"] = "COMPLETE"
    return run
