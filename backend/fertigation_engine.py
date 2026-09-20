"""Configuration-driven production fertigation preparation and run-record engine (M12)."""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

try:
    from .schedule_compiler import topology_capabilities
    from .sensor_calibration import CalibrationRepository
except ImportError:
    from schedule_compiler import topology_capabilities
    from sensor_calibration import CalibrationRepository

MAX_DOSING_CHANNELS = 7
DELIVERY_MODES = {"VOLUME", "FLOW", "PRESSURE_FLOW", "DURATION"}
TERMINAL = {"COMPLETE", "INTERRUPTED", "FAULTED", "ABORTED"}


def _id(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _arr(value: Any) -> list[dict[str, Any]]:
    return value if isinstance(value, list) else []


def _components(configuration: dict[str, Any]) -> list[dict[str, Any]]:
    return _arr(configuration.get("components"))


def _operational(c: dict[str, Any]) -> bool:
    return c.get("lifecycleState") in {None, "REGISTERED", "COMMISSIONED", "ENABLED"} and c.get("lifecycleState") not in {"DISABLED", "FAULTED", "REMOVED"}


def _component_text(c: dict[str, Any]) -> str:
    return " ".join(str(c.get(k, "")) for k in ("componentId", "role", "supportedTypeId", "name")).upper()


def _assigned(c: dict[str, Any], gh_id: str) -> bool:
    a = c.get("assignment") or {}
    return _id(a.get("ghId")) in {"", gh_id}


def _find(configuration: dict[str, Any], gh_id: str, *needles: str) -> dict[str, Any] | None:
    matches: list[dict[str, Any]] = []
    for c in _components(configuration):
        if not _operational(c) or not _assigned(c, gh_id):
            continue
        text = _component_text(c)
        if any(n in text for n in needles):
            matches.append(c)
    return matches[0] if len(matches) == 1 else None


def _find_issue_code(configuration: dict[str, Any], gh_id: str, *needles: str) -> str | None:
    matches: list[dict[str, Any]] = []
    for c in _components(configuration):
        if not _operational(c) or not _assigned(c, gh_id):
            continue
        text = _component_text(c)
        if any(n in text for n in needles):
            matches.append(c)
    if len(matches) > 1:
        return "AMBIGUOUS_COMPONENT"
    if not matches:
        return "MISSING_COMPONENT"
    return None


def _resolve_component(configuration: dict[str, Any], gh_id: str, requested_id: str | None, *needles: str) -> tuple[dict[str, Any] | None, str | None]:
    if requested_id:
        component = next((c for c in _components(configuration) if _id(c.get("componentId")) == requested_id), None)
        if not component or not _operational(component) or not _assigned(component, gh_id):
            return None, "EXPLICIT_COMPONENT_INVALID"
        return component, None
    issue = _find_issue_code(configuration, gh_id, *needles)
    if issue:
        return None, issue
    return _find(configuration, gh_id, *needles), None


def _resolve_flow_sensor(configuration: dict[str, Any], gh_id: str, requested_id: str | None, *, delivery: bool) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve a flow sensor without confusing raw-inlet and delivery flow sensors.

    A generic FLOW_METER/FLOW_SENSOR token can match multiple sensors. Delivery sensors
    are intentionally excluded from the raw-water selector and vice versa.
    """
    if requested_id:
        return _resolve_component(configuration, gh_id, requested_id, "DELIVERY_FLOW", "FERT_FLOW", "RAW_FLOW", "FLOW_METER", "FLOW_SENSOR")
    matches: list[dict[str, Any]] = []
    for c in _components(configuration):
        if not _operational(c) or not _assigned(c, gh_id):
            continue
        text = _component_text(c)
        is_flow = "FLOW" in text or "FLOW_METER" in text
        if not is_flow:
            continue
        is_delivery = any(token in text for token in ("DELIVERY_FLOW", "FERT_FLOW", "DELIVERY FLOW"))
        is_raw = "RAW_FLOW" in text or "RAW FLOW" in text
        if delivery and is_delivery and not is_raw:
            matches.append(c)
        elif not delivery and is_raw and not is_delivery:
            matches.append(c)
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        return None, "AMBIGUOUS_COMPONENT"
    # For backward-compatible deployments where the semantic name is only FLOW_METER,
    # select a sole non-delivery flow sensor for raw-water measurement.
    if not delivery:
        fallback = []
        for c in _components(configuration):
            if not _operational(c) or not _assigned(c, gh_id):
                continue
            text = _component_text(c)
            if ("FLOW_METER" in text or "FLOW_SENSOR" in text) and not any(token in text for token in ("DELIVERY", "FERT_FLOW")):
                fallback.append(c)
        if len(fallback) == 1:
            return fallback[0], None
        if len(fallback) > 1:
            return None, "AMBIGUOUS_COMPONENT"
    return None, "MISSING_COMPONENT"


def _sensor_definitions(configuration: dict[str, Any]) -> list[dict[str, Any]]:
    raw = configuration.get("sensorDefinitions")
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, dict):
        result=[]
        for key, value in raw.items():
            if isinstance(value, dict):
                item=dict(value)
                item.setdefault("resourceId", key)
                result.append(item)
        return result
    return []


def _sensor_definition_for_component(configuration: dict[str, Any], component: dict[str, Any] | None) -> dict[str, Any] | None:
    if not component:
        return None
    cid=_id(component.get("componentId")); rid=_id(component.get("resourceId"))
    for sensor in _sensor_definitions(configuration):
        if _id(sensor.get("sensorId")) in {cid, rid} or _id(sensor.get("componentId")) == cid or _id(sensor.get("resourceId")) == rid:
            return sensor
    return None


def _flow_calibration_error(reason: str | None) -> str:
    mapping = {
        "UNKNOWN": "FLOW_CALIBRATION_REFERENCE_INVALID",
        "COMPLEX_MISMATCH": "FLOW_CALIBRATION_COMPLEX_MISMATCH",
        "COMPONENT_MISMATCH": "FLOW_CALIBRATION_COMPONENT_MISMATCH",
        "TYPE_MISMATCH": "FLOW_CALIBRATION_TYPE_MISMATCH",
        "VERSION_MISMATCH": "FLOW_CALIBRATION_VERSION_MISMATCH",
        "REMOVED": "FLOW_CALIBRATION_REMOVED",
        "EXPIRED": "FLOW_CALIBRATION_EXPIRED",
        "SUSPECT": "FLOW_CALIBRATION_SUSPECT",
        "NOT_USABLE": "FLOW_CALIBRATION_NOT_USABLE",
    }
    return mapping.get(reason or "UNKNOWN", "FLOW_CALIBRATION_REFERENCE_INVALID")


def _resolve_flow_calibration(cal_repo: CalibrationRepository, configuration: dict[str, Any], component: dict[str, Any] | None) -> tuple[dict[str, Any] | None, str | None]:
    sensor=_sensor_definition_for_component(configuration, component)
    if not sensor:
        return None, "FLOW_CALIBRATION_DEFINITION_REQUIRED"
    cal_id=_id(sensor.get("calibrationReference") or sensor.get("calibrationId"))
    version_raw=sensor.get("calibrationVersion", sensor.get("version"))
    try:
        version=int(version_raw) if version_raw is not None else 0
    except (TypeError,ValueError):
        version=0
    if not cal_id:
        return None, "FLOW_CALIBRATION_REFERENCE_REQUIRED"
    if version < 1:
        return None, "FLOW_CALIBRATION_VERSION_REQUIRED"
    rec, reason = cal_repo.resolve_exact(_id(configuration.get("complexId")), _id(component.get("componentId")), "FLOW", cal_id, version)
    if not rec:
        return None, _flow_calibration_error(reason)
    pulses=rec.parameters.get("pulsesPerLiter") if isinstance(rec.parameters, dict) else None
    if not isinstance(pulses,(int,float)) or float(pulses)<=0:
        return None, "FLOW_CALIBRATION_PULSES_PER_LITER_REQUIRED"
    return {"calibrationId": rec.calibrationId, "version": rec.version, "state": rec.state, "pulsesPerLiter": float(pulses), "componentId": rec.componentId}, None


def _topology_paths(configuration: dict[str, Any], gh_id: str, mix: dict[str, Any] | None, raw: dict[str, Any] | None, delivery: dict[str, Any] | None) -> list[dict[str, Any]]:
    mix_rid = _id(mix.get("resourceId")) if mix else ""
    raw_rid = _id(raw.get("resourceId")) if raw else ""
    delivery_rid = _id(delivery.get("resourceId")) if delivery else ""
    paths: list[dict[str, Any]] = []
    for path in _arr(configuration.get("topology")):
        if path.get("enabled", True) is False:
            continue
        if _id(path.get("targetGhId")) not in {"", gh_id}:
            continue
        src, dst = _id(path.get("sourceResourceId")), _id(path.get("targetResourceId"))
        if (raw_rid and dst == mix_rid) or (mix_rid and src == mix_rid and delivery_rid and dst == delivery_rid):
            paths.append(deepcopy(path))
    return paths


def _find_all_dosing(configuration: dict[str, Any], gh_id: str) -> list[dict[str, Any]]:
    found = []
    for c in _components(configuration):
        if _operational(c) and _assigned(c, gh_id) and "DOSING" in _component_text(c):
            found.append(c)
    return found


def _recipe(configuration: dict[str, Any], recipe_id: str) -> dict[str, Any] | None:
    return next((r for r in _arr(configuration.get("recipes")) if _id(r.get("recipeId")) == recipe_id), None)


def _calibration(cal_repo: CalibrationRepository, component_id: str, complex_id: str, calibration_id: str | None = None, calibration_version: int | None = None):
    if not calibration_id:
        raise ValueError("CALIBRATION_REFERENCE_REQUIRED")
    if calibration_version is None or int(calibration_version) < 1:
        raise ValueError("CALIBRATION_VERSION_REQUIRED")
    rec, reason = cal_repo.resolve_exact(complex_id, component_id, "DOSING_RATE", calibration_id, int(calibration_version))
    if reason == "UNKNOWN":
        raise ValueError("CALIBRATION_REFERENCE_INVALID")
    if reason == "COMPLEX_MISMATCH":
        raise ValueError("CALIBRATION_COMPLEX_MISMATCH")
    if reason == "COMPONENT_MISMATCH":
        raise ValueError("CALIBRATION_COMPONENT_MISMATCH")
    if reason == "TYPE_MISMATCH":
        raise ValueError("CALIBRATION_TYPE_MISMATCH")
    if reason == "VERSION_MISMATCH":
        raise ValueError("CALIBRATION_VERSION_MISMATCH")
    if reason == "REMOVED":
        raise ValueError("CALIBRATION_REMOVED")
    if reason == "EXPIRED":
        raise ValueError("CALIBRATION_EXPIRED")
    if reason == "SUSPECT":
        raise ValueError("CALIBRATION_SUSPECT")
    if reason == "NOT_USABLE" or rec is None:
        raise ValueError("CALIBRATION_NOT_USABLE")
    return rec


def _resource_conflicts(configuration: dict[str, Any], gh_id: str, active_runs: list[dict[str, Any]]) -> list[dict[str, str]]:
    resource_map = {str(r.get("resourceId")): r for r in _arr(configuration.get("resources")) if _id(r.get("resourceId"))}
    target_resources = {c.get("resourceId") for c in _components(configuration) if _assigned(c, gh_id) and c.get("resourceId")}
    issues = []
    for run in active_runs:
        if run.get("status") in {"COMPLETE", "INTERRUPTED", "FAULTED", "ABORTED", "CANCELLED"}:
            continue
        for rid in target_resources.intersection(set(run.get("resourceIds") or [])):
            resource = resource_map.get(rid, {})
            if not bool(resource.get("shared", False)):
                issues.append({"code": "RESOURCE_CONFLICT", "message": f"Exclusive resource '{rid}' is already used by an active run."})
    return issues


def precheck_fertigation(configuration: dict[str, Any], request: dict[str, Any], cal_repo: CalibrationRepository, active_runs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    active_runs = active_runs or []
    gh_id = _id(request.get("ghId") or request.get("targetGhId"))
    if not gh_id:
        return {"valid": False, "status": "BLOCKED", "issues": [{"code": "TARGET_GH_REQUIRED", "message": "Target GH is required."}]}
    gh = next((g for g in _arr(configuration.get("greenhouses")) if _id(g.get("ghId") or g.get("id")) == gh_id), None)
    if not gh:
        return {"valid": False, "status": "BLOCKED", "issues": [{"code": "UNKNOWN_TARGET_GH", "message": f"Unknown target GH '{gh_id}'."}]}
    recipe_id = _id(request.get("recipeId"))
    recipe = _recipe(configuration, recipe_id) if recipe_id else None
    if not recipe:
        return {"valid": False, "status": "BLOCKED", "issues": [{"code": "RECIPE_REQUIRED", "message": "A valid recipe is required."}]}
    raw_target = request.get("targetWaterMl")
    if raw_target is None:
        raw_target = float(request.get("targetWaterL", 0) or 0) * 1000
    try:
        target_water_ml = float(raw_target)
    except (TypeError, ValueError):
        target_water_ml = 0.0

    issues: list[dict[str, str]] = []
    if target_water_ml <= 0:
        issues.append({"code": "TARGET_WATER_REQUIRED", "message": "targetWaterMl/targetWaterL must be > 0."})
    topo = topology_capabilities(configuration)
    topo_gh = (topo.get("byGh") or {}).get(gh_id) or {}
    if not topo.get("valid", False):
        issues.append({"code": "TOPOLOGY_INVALID", "message": "Configuration topology is invalid for fertigation."})
    caps = topo_gh.get("capabilities") or {}
    if not caps.get("CAN_AUTO_MIX", False):
        issues.append({"code": "CAN_AUTO_MIX_REQUIRED", "message": f"GH '{gh_id}' cannot currently auto-mix from configured topology."})
    if not caps.get("CAN_DELIVER", False):
        issues.append({"code": "CAN_DELIVER_REQUIRED", "message": f"GH '{gh_id}' has no validated delivery path."})

    plan_hint = request.get("executionPlan") if isinstance(request.get("executionPlan"), dict) else {}
    plan_components = plan_hint.get("components") if isinstance(plan_hint.get("components"), dict) else {}
    mix, mix_err = _resolve_component(configuration, gh_id, _id(plan_components.get("mixingTank")) or None, "MIXING_TANK", "MIX_TANK")
    raw, raw_err = _resolve_component(configuration, gh_id, _id(plan_components.get("rawWater")) or None, "WELL_PUMP", "RAW_SUBMERSIBLE", "RAW_WATER")
    raw_flow, raw_flow_err = _resolve_flow_sensor(configuration, gh_id, _id(plan_components.get("rawFlow")) or None, delivery=False)
    level, level_err = _resolve_component(configuration, gh_id, _id(plan_components.get("level")) or None, "LEVEL", "FLOAT", "RADAR", "TANK_SENSOR")
    delivery, delivery_err = _resolve_component(configuration, gh_id, _id(plan_components.get("deliveryPump")) or None, "DELIVERY_PUMP", "DISTRIBUTION_PUMP", "DIST_PUMP", "FERTIGATION_PUMP")
    delivery_flow, delivery_flow_err = _resolve_flow_sensor(configuration, gh_id, _id(plan_components.get("deliveryFlow")) or None, delivery=True)
    pressure, pressure_err = _resolve_component(configuration, gh_id, _id(plan_components.get("pressure")) or None, "PRESSURE")
    mixing_duration_requested = float(request.get("mixingDurationSec", recipe.get("mixingDurationSec", recipe.get("durationSec", 0))) or 0)
    mixing_pump, mixing_pump_err = _resolve_component(configuration, gh_id, _id(plan_components.get("mixingPump")) or None, "MIXING_PUMP", "MIX_PUMP", "MIXER_PUMP", "AGITATOR") if mixing_duration_requested > 0 else (None, None)
    if mixing_duration_requested > 0 and mixing_pump_err not in {None, "MISSING_COMPONENT"}:
        issues.append({"code": mixing_pump_err, "message": f"Mixing pump selection for GH '{gh_id}' is invalid."})
    for selected, err, label in ((mix,mix_err,"mixing tank"),(raw,raw_err,"raw water source"),(raw_flow,raw_flow_err,"raw flow sensor"),(level,level_err,"level sensor"),(delivery,delivery_err,"delivery pump"),(delivery_flow,delivery_flow_err,"delivery flow sensor"),(pressure,pressure_err,"pressure sensor"),(mixing_pump,mixing_pump_err,"mixing pump")):
        if err == "AMBIGUOUS_COMPONENT":
            issues.append({"code": "AMBIGUOUS_COMPONENT", "message": f"Multiple operational {label} components match; an explicit execution-plan component ID is required."})
        elif err == "EXPLICIT_COMPONENT_INVALID":
            issues.append({"code": "EXPLICIT_COMPONENT_INVALID", "message": f"Execution plan references an invalid {label} component for GH '{gh_id}'."})
    if not mix: issues.append({"code": "MIXING_TANK_REQUIRED", "message": "Target GH mixing tank is unavailable."})
    if not raw: issues.append({"code": "RAW_WATER_SOURCE_REQUIRED", "message": "Configured raw-water source is unavailable."})
    if not raw_flow: issues.append({"code": "RAW_FLOW_SENSOR_REQUIRED", "message": "Incoming-water measurement sensor is required."})
    if not level: issues.append({"code": "LEVEL_SENSOR_REQUIRED", "message": "Mixing-tank level protection sensor is required."})
    if not delivery: issues.append({"code": "DELIVERY_PUMP_REQUIRED", "message": "Delivery pump is unavailable."})
    if mixing_duration_requested > 0 and not mixing_pump: issues.append({"code": "MIXING_PUMP_REQUIRED", "message": "A mixing pump is required when mixingDurationSec is greater than zero."})
    delivery_mode = _id(request.get("deliveryMode") or "VOLUME").upper()
    if delivery_mode not in DELIVERY_MODES:
        issues.append({"code": "INVALID_DELIVERY_MODE", "message": f"Unsupported delivery mode '{delivery_mode}'."})
    if delivery_mode in {"VOLUME", "FLOW"} and not delivery_flow:
        issues.append({"code": "DELIVERY_FLOW_SENSOR_REQUIRED", "message": "A delivery flow sensor is required for measured volume/flow mode."})
    if delivery_mode == "PRESSURE_FLOW" and (not delivery_flow or not pressure):
        issues.append({"code": "PRESSURE_FLOW_READINESS_REQUIRED", "message": "Pressure + delivery flow sensors are required for pressure/flow delivery."})
    if delivery_mode == "DURATION" and not bool(request.get("allowDurationFallback", False)):
        issues.append({"code": "DURATION_FALLBACK_NOT_EXPLICIT", "message": "Duration delivery requires explicit allowDurationFallback=true."})

    raw_flow_calibration, raw_flow_cal_error = _resolve_flow_calibration(cal_repo, configuration, raw_flow)
    if raw_flow_cal_error:
        issues.append({"code": raw_flow_cal_error, "message": "Raw-water flow sensor must have an exact usable FLOW calibration with pulsesPerLiter."})
    delivery_flow_calibration = None
    if delivery_mode != "DURATION":
        delivery_flow_calibration, delivery_flow_cal_error = _resolve_flow_calibration(cal_repo, configuration, delivery_flow)
        if delivery_flow_cal_error:
            issues.append({"code": delivery_flow_cal_error, "message": "Delivery flow sensor must have an exact usable FLOW calibration with pulsesPerLiter."})
    if not bool(request.get("safetyAcknowledged", False)):
        issues.append({"code": "SAFETY_ACK_REQUIRED", "message": "Safety preconditions must be explicitly acknowledged by the caller."})
    issues.extend(_resource_conflicts(configuration, gh_id, active_runs))

    channels = request.get("dosingChannels")
    if not isinstance(channels, list):
        issues.append({"code": "DOSING_CHANNELS_REQUIRED", "message": "Configuration-driven fertigation requires explicit logical dosingChannels; legacy A/B volume fields are not an execution fallback."})
        channels = []
    if len(channels) > MAX_DOSING_CHANNELS:
        issues.append({"code": "DOSING_CHANNEL_LIMIT", "message": f"At most {MAX_DOSING_CHANNELS} logical dosing channels are supported."})
        channels = [] if not isinstance(channels, list) else channels[:MAX_DOSING_CHANNELS]
    seen: set[str] = set()
    resolved_channels = []
    max_runtime_sec = float(request.get("maxDosingRuntimeSec", 1800) or 1800)
    min_runtime_sec = float(request.get("minDosingRuntimeSec", 0) or 0)
    if min_runtime_sec < 0 or max_runtime_sec <= 0 or min_runtime_sec > max_runtime_sec:
        issues.append({"code": "INVALID_DOSING_RUNTIME_POLICY", "message": "Dosing runtime limits are invalid."})
    for ch in channels:
        cid = _id(ch.get("componentId"))
        requested = float(ch.get("requestedMl", 0) or 0)
        if not cid or requested <= 0:
            issues.append({"code": "INVALID_DOSING_CHANNEL", "message": "Each dosing channel requires componentId and requestedMl > 0."})
            continue
        if cid in seen:
            issues.append({"code": "DUPLICATE_DOSING_CHANNEL", "message": f"Dosing channel '{cid}' is duplicated."})
            continue
        seen.add(cid)
        component = next((c for c in _components(configuration) if _id(c.get("componentId")) == cid), None)
        if not component or not _operational(component) or not _assigned(component, gh_id) or "DOSING" not in _component_text(component):
            issues.append({"code": "UNKNOWN_DOSING_COMPONENT", "message": f"Dosing component '{cid}' is not a valid operational channel for GH '{gh_id}'."})
            continue
        requested_cal = ch.get("calibration") if isinstance(ch.get("calibration"), dict) else {}
        parameters = component.get("parameters") if isinstance(component.get("parameters"), dict) else {}
        requested_cal_id = _id(ch.get("calibrationId") or requested_cal.get("calibrationId") or component.get("calibrationReference") or parameters.get("calibrationId")) or None
        requested_cal_version = ch.get("calibrationVersion", requested_cal.get("version", component.get("calibrationVersion", parameters.get("calibrationVersion"))))
        if not requested_cal_id:
            issues.append({"code": "CALIBRATION_REFERENCE_REQUIRED", "message": f"An explicit calibrationId is required for dosing channel '{cid}'."})
            continue
        if requested_cal_version is not None:
            try:
                requested_cal_version = int(requested_cal_version)
            except (TypeError, ValueError):
                issues.append({"code": "CALIBRATION_VERSION_INVALID", "message": f"Invalid calibration version for '{cid}'."})
                continue
        try:
            cal = _calibration(cal_repo, cid, configuration.get("complexId", ""), requested_cal_id, requested_cal_version)
        except ValueError as exc:
            issues.append({"code": str(exc), "message": f"Requested calibration reference for '{cid}' could not be resolved exactly."})
            continue
        if not cal or not cal.usable:
            issues.append({"code": "CALIBRATION_REQUIRED", "message": f"No usable dosing calibration for '{cid}'."})
            continue
        if requested_cal_id and cal.calibrationId != requested_cal_id:
            issues.append({"code": "CALIBRATION_REFERENCE_MISMATCH", "message": f"Resolved calibration for '{cid}' does not match requested calibrationId."})
            continue
        if requested_cal_version is not None and cal.version != requested_cal_version:
            issues.append({"code": "CALIBRATION_VERSION_MISMATCH", "message": f"Resolved calibration for '{cid}' does not match requested version."})
            continue
        rate = cal.rate_ml_per_sec(requested)
        runtime = requested / rate
        if runtime < min_runtime_sec or runtime > max_runtime_sec:
            issues.append({"code": "DOSING_RUNTIME_LIMIT", "message": f"Calculated runtime for '{cid}' is outside configured min/max runtime."})
        resolved_channels.append({"componentId": cid, "requestedMl": requested, "rateMlPerSec": rate, "runtimeSec": runtime, "calibrationId": cal.calibrationId, "calibrationVersion": cal.version})

    selected_path_components = [mix, raw, raw_flow, level, delivery, mixing_pump]
    if delivery_mode in {"VOLUME", "FLOW", "PRESSURE_FLOW"}: selected_path_components.append(delivery_flow)
    if delivery_mode == "PRESSURE_FLOW": selected_path_components.append(pressure)
    resource_ids = [c.get("resourceId") for c in selected_path_components if c and c.get("resourceId")]
    resource_ids.extend(c.get("resourceId") for c in _components(configuration) if c.get("componentId") in {x["componentId"] for x in resolved_channels} and c.get("resourceId"))
    resource_map = {str(r.get("resourceId")): deepcopy(r) for r in _arr(configuration.get("resources")) if _id(r.get("resourceId"))}
    for rid in sorted(set(resource_ids)):
        resource = resource_map.get(rid)
        if resource is None:
            issues.append({"code": "UNKNOWN_RESOURCE", "message": f"Selected resource '{rid}' is not defined in the active configuration."})
        elif resource.get("available") is False:
            issues.append({"code": "RESOURCE_UNAVAILABLE", "message": f"Selected resource '{rid}' is unavailable."})
    if delivery_mode == "FLOW" and float(request.get("targetFlowLpm", 0) or 0) <= 0:
        issues.append({"code": "TARGET_FLOW_REQUIRED", "message": "FLOW delivery requires targetFlowLpm > 0."})
    if delivery_mode == "PRESSURE_FLOW" and float(request.get("targetPressureKpa", 0) or 0) <= 0:
        issues.append({"code": "TARGET_PRESSURE_REQUIRED", "message": "PRESSURE_FLOW delivery requires targetPressureKpa > 0."})
    if delivery_mode == "DURATION" and float(request.get("deliveryDurationSec", 0) or 0) <= 0:
        issues.append({"code": "DELIVERY_DURATION_REQUIRED", "message": "Duration delivery requires deliveryDurationSec > 0."})
    status = "READY" if not issues else "BLOCKED"
    selected_components = {
        "mixingTank": mix.get("componentId") if mix else None,
        "rawWater": raw.get("componentId") if raw else None,
        "fillPump": raw.get("componentId") if raw else None,
        "rawFlow": raw_flow.get("componentId") if raw_flow else None,
        "level": level.get("componentId") if level else None,
        "mixingPump": mixing_pump.get("componentId") if mixing_pump else None,
        "deliveryPump": delivery.get("componentId") if delivery else None,
        "deliveryFlow": delivery_flow.get("componentId") if delivery_flow else None,
        "pressure": pressure.get("componentId") if pressure else None,
    }
    plan_resources = []
    for rid in sorted(set(resource_ids)):
        resource = resource_map.get(rid, {})
        owner_component = _id(resource.get("componentId"))
        if not owner_component:
            owner_component = next((_id(c.get("componentId")) for c in _components(configuration) if _id(c.get("resourceId")) == rid), "")
        plan_resources.append({
            "resourceId": rid,
            "componentId": owner_component or None,
            "type": resource.get("type"),
            "shared": bool(resource.get("shared", False)),
            "available": resource.get("available", True) is not False,
        })

    routing_valves = []
    routing_paths = []
    for path in _topology_paths(configuration, gh_id, mix, raw, delivery):
        path_id = _id(path.get("pathId") or path.get("id"))
        if path_id:
            routing_paths.append(path_id)
        valve_id = _id(path.get("valveResourceId"))
        if valve_id and valve_id not in routing_valves:
            routing_valves.append(valve_id)

    execution_plan = {
        "planVersion": 1,
        "complexId": configuration.get("complexId"),
        "ghId": gh_id,
        "configurationVersion": configuration.get("version"),
        "configurationHash": configuration.get("configurationHash"),
        "targetWaterMl": target_water_ml,
        "components": selected_components,
        "resources": plan_resources,
        "topologyPaths": _topology_paths(configuration, gh_id, mix, raw, delivery),
        "routingPaths": routing_paths,
        "routingValves": routing_valves,
        "resourceResolution": {rid: next((r for r in plan_resources if r["resourceId"] == rid), None) for rid in sorted(set(resource_ids))},
        "sensorCalibrations": {
            "rawFlow": deepcopy(raw_flow_calibration),
            **({"deliveryFlow": deepcopy(delivery_flow_calibration)} if delivery_flow_calibration else {}),
        },
        "measurementRequirements": {
            "incomingVolume": {"sensorId": selected_components.get("rawFlow"), "measurement": "FLOW_PULSE_ACCUMULATION", "calibrationId": raw_flow_calibration.get("calibrationId") if raw_flow_calibration else None, "calibrationVersion": raw_flow_calibration.get("version") if raw_flow_calibration else None},
            "deliveryVolume": ({"sensorId": selected_components.get("deliveryFlow"), "measurement": "FLOW_PULSE_ACCUMULATION", "calibrationId": delivery_flow_calibration.get("calibrationId"), "calibrationVersion": delivery_flow_calibration.get("version")} if delivery_flow_calibration else {"measurement": "DURATION_FALLBACK"}),
        },
        "dosingChannels": deepcopy(resolved_channels),
        "recipe": {"recipeId": recipe.get("recipeId"), "version": recipe.get("version") or recipe.get("recipeVersion") or 1, "snapshot": deepcopy(recipe)},
        "mixingDurationSec": max(0.0, mixing_duration_requested),
        "delivery": {"mode": delivery_mode, "targetDeliveredMl": float(request.get("targetDeliveredMl", target_water_ml) or 0), "targetFlowLpm": float(request.get("targetFlowLpm", 0) or 0), "targetPressureKpa": float(request.get("targetPressureKpa", 0) or 0), "durationSec": float(request.get("deliveryDurationSec", 0) or 0), "toleranceMl": float(request.get("deliveryToleranceMl", request.get("toleranceMl", 0)) or 0), "allowDurationFallback": bool(request.get("allowDurationFallback", False))},
        "timeouts": {"maxRuntimeSec": float(request.get("maxRuntimeSec", max_runtime_sec) or max_runtime_sec), "minDosingRuntimeSec": float(min_runtime_sec), "maxDosingRuntimeSec": float(max_runtime_sec), "fillTimeoutSec": float(request.get("fillTimeoutSec", 180) or 180), "deliveryTimeoutSec": float(request.get("deliveryTimeoutSec", 180) or 180)},
        "safety": {
            "safetyAcknowledged": bool(request.get("safetyAcknowledged", False)),
            "requiredSensors": [x for x in (selected_components.get("rawFlow"), selected_components.get("level"), selected_components.get("deliveryFlow"), selected_components.get("pressure")) if x],
            "emergencyStopRequired": True,
        },
    }
    return {"valid": not issues, "status": status, "issues": issues, "targetGhId": gh_id, "recipe": deepcopy(recipe), "channels": resolved_channels, "resources": sorted(set(resource_ids)), "deliveryMode": delivery_mode, "components": selected_components, "executionPlan": execution_plan}


def validate_execution_plan(configuration: dict[str, Any], plan: dict[str, Any], cal_repo: CalibrationRepository) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    if not isinstance(plan, dict):
        return [{"code": "EXECUTION_PLAN_REQUIRED", "message": "A resolved execution plan is required."}]
    if _id(plan.get("complexId")) != _id(configuration.get("complexId")):
        issues.append({"code": "PLAN_COMPLEX_MISMATCH", "message": "Execution plan Complex does not match active configuration."})
    if int(plan.get("configurationVersion") or 0) != int(configuration.get("version") or 0):
        issues.append({"code": "PLAN_CONFIGURATION_VERSION_MISMATCH", "message": "Execution plan configurationVersion does not match active configuration."})
    if configuration.get("configurationHash"):
        if not plan.get("configurationHash"):
            issues.append({"code": "PLAN_CONFIGURATION_HASH_REQUIRED", "message": "Execution plan must carry the active configuration hash."})
        elif plan.get("configurationHash") != configuration.get("configurationHash"):
            issues.append({"code": "PLAN_CONFIGURATION_HASH_MISMATCH", "message": "Execution plan configuration hash does not match active configuration."})
    gh_id = _id(plan.get("ghId"))
    if not any(_id(g.get("ghId") or g.get("id")) == gh_id for g in _arr(configuration.get("greenhouses"))):
        issues.append({"code": "PLAN_GH_INVALID", "message": "Execution plan targets an unknown GH."})
    comps = plan.get("components") if isinstance(plan.get("components"), dict) else {}
    for key, cid in comps.items():
        if not cid:
            continue
        c = next((x for x in _components(configuration) if _id(x.get("componentId")) == cid), None)
        if not c or not _operational(c) or not _assigned(c, gh_id):
            issues.append({"code": "PLAN_COMPONENT_INVALID", "message": f"Execution plan component '{cid}' is invalid for GH '{gh_id}'."})

    # The execution plan is authoritative: every selected resource must still
    # resolve to the exact component identity used when the plan was compiled.
    config_resources = { _id(r.get("resourceId")): r for r in _arr(configuration.get("resources")) if _id(r.get("resourceId")) }
    for resource in _arr(plan.get("resources")):
        if not isinstance(resource, dict):
            issues.append({"code": "PLAN_RESOURCE_INVALID", "message": "Every execution-plan resource must be an object."})
            continue
        rid = _id(resource.get("resourceId")); expected_component = _id(resource.get("componentId"))
        current = config_resources.get(rid)
        if not rid or not current:
            issues.append({"code": "PLAN_RESOURCE_INVALID", "message": f"Execution plan resource '{rid}' is not present in the active configuration."})
            continue
        actual_component = _id(current.get("componentId"))
        if expected_component and actual_component and expected_component != actual_component:
            issues.append({"code": "PLAN_RESOURCE_COMPONENT_MISMATCH", "message": f"Resource '{rid}' no longer resolves to component '{expected_component}'."})
        if current.get("available") is False:
            issues.append({"code": "PLAN_RESOURCE_UNAVAILABLE", "message": f"Execution-plan resource '{rid}' is no longer available."})

    # Topology IDs/valves are also bound to the compiled plan; a changed path
    # must invalidate the plan instead of allowing a second heuristic route.
    config_paths = { _id(p.get("pathId") or p.get("id")): p for p in _arr(configuration.get("topology")) if _id(p.get("pathId") or p.get("id")) }
    for path_id in _arr(plan.get("routingPaths")):
        current = config_paths.get(_id(path_id))
        if not current or current.get("enabled", True) is False:
            issues.append({"code": "PLAN_TOPOLOGY_PATH_INVALID", "message": f"Execution plan references unavailable topology path '{path_id}'."})
    sensor_cals = plan.get("sensorCalibrations") if isinstance(plan.get("sensorCalibrations"), dict) else {}
    for sensor_key, sensor_ref in sensor_cals.items():
        if not isinstance(sensor_ref, dict):
            issues.append({"code": "PLAN_SENSOR_CALIBRATION_INVALID", "message": f"Sensor calibration reference '{sensor_key}' is invalid."})
            continue
        sid=_id(sensor_ref.get("sensorId") or sensor_ref.get("componentId")); cal_id=_id(sensor_ref.get("calibrationId")); version=sensor_ref.get("version")
        if not sid or not cal_id or not isinstance(version,(int,float)):
            issues.append({"code": "PLAN_SENSOR_CALIBRATION_REQUIRED", "message": f"Sensor calibration '{sensor_key}' requires sensorId/componentId, calibrationId and version."})
            continue
        rec=cal_repo.exact(_id(configuration.get("complexId")), sid, "FLOW", cal_id, int(version))
        sensor_def = _sensor_definition_for_component(configuration, next((c for c in _components(configuration) if _id(c.get("componentId")) == sid), None))
        if not rec or not rec.usable:
            issues.append({"code": "PLAN_SENSOR_CALIBRATION_REFERENCE_INVALID", "message": f"Sensor calibration '{cal_id}' v{int(version)} is not usable for '{sid}'."})
        elif not sensor_def or _id(sensor_def.get("complexId")) != _id(configuration.get("complexId")):
            issues.append({"code": "PLAN_SENSOR_COMPLEX_MISMATCH", "message": f"Sensor '{sid}' is not owned by the active Complex."})
        elif _id(sensor_def.get("calibrationReference")) != cal_id or int(sensor_def.get("calibrationVersion") or 0) != int(version):
            issues.append({"code": "PLAN_SENSOR_CALIBRATION_DESCRIPTOR_MISMATCH", "message": f"Sensor '{sid}' calibration descriptor does not match the execution-plan reference."})
        elif not isinstance(rec.parameters.get("pulsesPerLiter"), (int,float)) or float(rec.parameters.get("pulsesPerLiter"))<=0:
            issues.append({"code": "PLAN_SENSOR_CALIBRATION_PULSES_INVALID", "message": f"Sensor calibration '{cal_id}' lacks valid pulsesPerLiter."})

    for ch in _arr(plan.get("dosingChannels")):
        cid = _id(ch.get("componentId")); cal_id = _id(ch.get("calibrationId")); version = ch.get("calibrationVersion")
        if not cid or not cal_id or not isinstance(version, (int, float)):
            issues.append({"code": "PLAN_CALIBRATION_REFERENCE_REQUIRED", "message": "Every dosing channel in the execution plan requires calibrationId and calibrationVersion."})
            continue
        rec = cal_repo.exact(_id(configuration.get("complexId")), cid, "DOSING_RATE", cal_id, int(version))
        if not rec or not rec.usable:
            issues.append({"code": "PLAN_CALIBRATION_REFERENCE_INVALID", "message": f"Execution plan calibration {cal_id} v{int(version)} is not usable for '{cid}'."})
        elif abs(float(ch.get("rateMlPerSec") or 0) - float(rec.parameters.get("rateMlPerSec") or 0)) > 1e-6:
            issues.append({"code": "PLAN_CALIBRATION_RATE_MISMATCH", "message": f"Execution plan rate for '{cid}' does not match the exact calibration record."})
    recipe = plan.get("recipe") if isinstance(plan.get("recipe"), dict) else {}
    if not _id(recipe.get("recipeId")) or not isinstance(recipe.get("snapshot"), dict):
        issues.append({"code": "PLAN_RECIPE_SNAPSHOT_REQUIRED", "message": "Execution plan must carry an immutable recipe snapshot."})
    else:
        current_recipe = _recipe(configuration, _id(recipe.get("recipeId")))
        if not current_recipe:
            issues.append({"code": "PLAN_RECIPE_INVALID", "message": "Execution plan recipe no longer exists in active configuration."})
        elif int(current_recipe.get("version") or current_recipe.get("recipeVersion") or 1) != int(recipe.get("version") or 0):
            issues.append({"code": "PLAN_RECIPE_VERSION_MISMATCH", "message": "Execution plan recipe version is stale relative to active configuration."})
    return issues


def prepare_run(configuration: dict[str, Any], request: dict[str, Any], cal_repo: CalibrationRepository, active_runs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    pre = precheck_fertigation(configuration, request, cal_repo, active_runs)
    if not pre["valid"]:
        return pre
    target_water_ml = float(request.get("targetWaterMl") if request.get("targetWaterMl") is not None else float(request.get("targetWaterL", 0)) * 1000)
    if target_water_ml <= 0:
        return {**pre, "valid": False, "status": "BLOCKED", "issues": [{"code": "TARGET_WATER_REQUIRED", "message": "targetWaterMl/targetWaterL must be > 0."}]}
    plan_issues = validate_execution_plan(configuration, pre.get("executionPlan") or {}, cal_repo)
    if plan_issues:
        return {**pre, "valid": False, "status": "BLOCKED", "issues": plan_issues}
    run_id = _id(request.get("runId")) or f"run-{uuid.uuid4().hex[:12]}"
    snapshot = {
        "runId": run_id,
        "complexId": configuration.get("complexId"),
        "ghId": pre["targetGhId"],
        "triggerType": _id(request.get("triggerType") or request.get("source") or "MANUAL").upper(),
        "scheduleId": _id(request.get("scheduleId")) or None,
        "recipeId": pre["recipe"].get("recipeId"),
        "recipeVersion": pre["recipe"].get("version") or pre["recipe"].get("recipeVersion") or 1,
        "recipeSnapshot": deepcopy(pre["recipe"]),
        "configurationVersion": configuration.get("version"),
        "configurationHash": configuration.get("configurationHash"),
        "targetWaterMl": target_water_ml,
        "targetDosing": deepcopy(pre["channels"]),
        "actualWaterMl": 0.0,
        "actualDosingRuntimesSec": {c["componentId"]: 0.0 for c in pre["channels"]},
        "calibrationReferences": {c["componentId"]: {"calibrationId": c["calibrationId"], "version": c["calibrationVersion"], "state": "CALIBRATED"} for c in pre["channels"]},
        "mixingDurationSec": max(0.0, float(request.get("mixingDurationSec", pre["recipe"].get("mixingDurationSec", pre["recipe"].get("durationSec", 0))) or 0)),
        "deliveryMode": pre["deliveryMode"],
        "deliveryTargetMl": float(request.get("targetDeliveredMl", target_water_ml)),
        "deliveryDurationSec": float(request.get("deliveryDurationSec", 0) or 0),
        "targetFlowLpm": float(request.get("targetFlowLpm", 0) or 0),
        "targetPressureKpa": float(request.get("targetPressureKpa", 0) or 0),
        "deliveryToleranceMl": float(request.get("deliveryToleranceMl", request.get("toleranceMl", 0)) or 0),
        "allowDurationFallback": bool(request.get("allowDurationFallback", False)),
        "resourceIds": pre["resources"],
        "executionPlan": deepcopy(pre.get("executionPlan")),
        "actualMixedVolumeMl": 0.0,
        "actualDeliveredMl": 0.0,
        "mixedVolumeMeasurementSource": "NOT_AVAILABLE",
        "mixedVolumeMeasurementQuality": "UNAVAILABLE",
        "deliveredVolumeMeasurementSource": "NOT_AVAILABLE",
        "deliveredVolumeMeasurementQuality": "UNAVAILABLE",
        "operator": _id(request.get("operator")) or None,
        "source": _id(request.get("source") or request.get("triggerType") or "MANUAL"),
        "status": "PREPARED",
        "fault": None,
        "phaseTimestamps": {},
        "startTimestampMs": None,
        "endTimestampMs": None,
    }
    return {"valid": True, "status": "READY", "run": snapshot}



class FertigationRunRepository:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.db_path)) as con:
            con.execute("CREATE TABLE IF NOT EXISTS fertigation_runs (run_id TEXT PRIMARY KEY, complex_id TEXT, gh_id TEXT, status TEXT, started_at_ms INTEGER, ended_at_ms INTEGER, run_json TEXT NOT NULL)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_fert_run_complex ON fertigation_runs(complex_id, gh_id, started_at_ms DESC)")
            con.commit()

    def save(self, run: dict[str, Any]) -> dict[str, Any]:
        with closing(sqlite3.connect(self.db_path)) as con:
            con.execute("INSERT OR REPLACE INTO fertigation_runs VALUES (?,?,?,?,?,?,?)", (run["runId"], run.get("complexId"), run.get("ghId"), run.get("status"), run.get("startTimestampMs"), run.get("endTimestampMs"), json.dumps(run, separators=(",", ":"))))
            con.commit()
        return deepcopy(run)

    def list(self, complex_id: str | None = None, gh_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT run_json FROM fertigation_runs WHERE 1=1"
        args: list[Any] = []
        if complex_id:
            query += " AND complex_id=?"; args.append(complex_id)
        if gh_id:
            query += " AND gh_id=?"; args.append(gh_id)
        query += " ORDER BY started_at_ms DESC"
        with closing(sqlite3.connect(self.db_path)) as con:
            rows = con.execute(query, args).fetchall()
        return [json.loads(row[0]) for row in rows]
