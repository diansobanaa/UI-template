"""Backend-side M7/M8 topology and schedule compiler.

This module intentionally uses only Python's standard library so it can run in the
existing project without introducing a dependency that changes the production stack.
The compiler consumes a canonical configuration snapshot and emits the same wire-level
fields expected by the ESP32 compiled-schedule endpoint.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


EXECUTABLE_STATES = {"ACTIVE"}
RECURRENCE_TYPES = {"DAILY", "INTERVAL", "ONCE"}
ACTIONS = {"FERTIGATION", "WATER_PUMP", "FAN_TOGGLE"}
MISSED_POLICIES = {"EXECUTE", "SKIP"}


def _id(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _arr(value: Any) -> list[dict[str, Any]]:
    return value if isinstance(value, list) else []


def _operational(component: dict[str, Any] | None) -> bool:
    return bool(component) and component.get("lifecycleState") in {None, "COMMISSIONED", "ENABLED"}


def _component_text(component: dict[str, Any]) -> str:
    return " ".join(str(component.get(k, "")) for k in ("componentId", "role", "supportedTypeId", "name")).upper()


def _component_for_resource(configuration: dict[str, Any], resource_id: str) -> dict[str, Any] | None:
    for component in _arr(configuration.get("components")):
        if _id(component.get("resourceId")) == resource_id:
            return component
    return None


def _resource_map(configuration: dict[str, Any]) -> dict[str, dict[str, Any]]:
    resources = {}
    for resource in _arr(configuration.get("resources")):
        rid = _id(resource.get("resourceId"))
        if rid:
            resources[rid] = deepcopy(resource)
    for component in _arr(configuration.get("components")):
        rid = _id(component.get("resourceId"))
        if rid and rid not in resources:
            resources[rid] = {
                "resourceId": rid,
                "type": component.get("role") or component.get("supportedTypeId") or "COMPONENT",
                "componentId": component.get("componentId"),
                "shared": False,
                "available": True,
            }
    for rid, resource in resources.items():
        component = _component_for_resource(configuration, rid)
        resource["component"] = component
        resource["available"] = resource.get("available", True)
        resource["shared"] = bool(resource.get("shared", False))
    return resources


def resource_operational(configuration: dict[str, Any], resource_id: str) -> bool:
    resources = _resource_map(configuration)
    resource = resources.get(resource_id)
    if not resource or resource.get("available") is False:
        return False
    return _operational(resource.get("component"))


def validate_resource_assignments(configuration: dict[str, Any]) -> list[dict[str, Any]]:
    resources = _resource_map(configuration)
    assignments = _arr(configuration.get("assignments"))
    issues: list[dict[str, Any]] = []
    seen: set[str] = set()
    by_resource: dict[str, list[dict[str, Any]]] = {}
    for assignment in assignments:
        aid = _id(assignment.get("assignmentId"))
        rid = _id(assignment.get("resourceId"))
        if not aid:
            issues.append({"code": "ASSIGNMENT_ID_REQUIRED", "message": "Assignment ID is required."})
        elif aid in seen:
            issues.append({"code": "DUPLICATE_ASSIGNMENT_ID", "message": f"Duplicate assignment '{aid}'."})
        else:
            seen.add(aid)
        if rid not in resources:
            issues.append({"code": "UNKNOWN_RESOURCE", "message": f"Assignment '{aid}' references unknown resource '{rid}'.", "resourceId": rid})
        by_resource.setdefault(rid, []).append(assignment)
    for rid, resource in resources.items():
        if resource.get("shared"):
            continue
        owners = {_id(a.get("ghId")) or _id(a.get("ownerId")) for a in by_resource.get(rid, [])}
        owners.discard("")
        if len(owners) > 1:
            issues.append({"code": "EXCLUSIVE_RESOURCE_CONFLICT", "message": f"Exclusive resource '{rid}' has multiple owners.", "resourceId": rid})
    return issues


def validate_topology(configuration: dict[str, Any]) -> list[dict[str, Any]]:
    resources = _resource_map(configuration)
    ghs = {_id(g.get("ghId") or g.get("id")) for g in _arr(configuration.get("greenhouses"))}
    issues: list[dict[str, Any]] = []
    seen: set[str] = set()
    pairs: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for path in _arr(configuration.get("topology")):
        path_id = _id(path.get("pathId"))
        source = _id(path.get("sourceResourceId"))
        target = _id(path.get("targetResourceId"))
        mode = _id(path.get("mode") or ("AUTOMATIC" if path.get("automatic") else "MANUAL")).upper()
        if not path_id:
            issues.append({"code": "TOPOLOGY_PATH_ID_REQUIRED", "message": "Topology pathId is required."})
        elif path_id in seen:
            issues.append({"code": "DUPLICATE_TOPOLOGY_PATH_ID", "message": f"Duplicate topology path '{path_id}'.", "pathId": path_id})
        else:
            seen.add(path_id)
        if not source or source not in resources:
            issues.append({"code": "UNKNOWN_TOPOLOGY_SOURCE", "message": f"Unknown topology source '{source}'.", "pathId": path_id, "resourceId": source})
        if not target or target not in resources:
            issues.append({"code": "UNKNOWN_TOPOLOGY_TARGET", "message": f"Unknown topology target '{target}'.", "pathId": path_id, "resourceId": target})
        if source and target and source == target:
            issues.append({"code": "TOPOLOGY_SELF_LOOP", "message": f"Topology path '{path_id}' cannot connect a resource to itself.", "pathId": path_id})
        if mode not in {"AUTOMATIC", "MANUAL"}:
            issues.append({"code": "INVALID_ROUTING_MODE", "message": f"Topology path '{path_id}' has invalid mode '{mode}'.", "pathId": path_id})
        for key in ("pumpResourceId", "valveResourceId", "tankResourceId"):
            rid = _id(path.get(key))
            if rid and rid not in resources:
                issues.append({"code": "UNKNOWN_TOPOLOGY_RESOURCE", "message": f"Topology path '{path_id}' references unknown {key} '{rid}'.", "pathId": path_id, "resourceId": rid})
            elif rid:
                text = _component_text(resources[rid].get("component") or resources[rid])
                expected = "PUMP" if key == "pumpResourceId" else "VALVE" if key == "valveResourceId" else "TANK"
                if expected not in text:
                    issues.append({"code": "TOPOLOGY_RESOURCE_TYPE_MISMATCH", "message": f"Topology path '{path_id}' {key} must reference a {expected.lower()} resource.", "pathId": path_id, "resourceId": rid, "expectedType": expected})
        target_gh = _id(path.get("targetGhId"))
        owner_gh = _id(path.get("routeOwnerGhId"))
        if target_gh and target_gh not in ghs:
            issues.append({"code": "UNKNOWN_TOPOLOGY_GREENHOUSE", "message": f"Topology path '{path_id}' references unknown greenhouse '{target_gh}'.", "pathId": path_id, "ghId": target_gh})
        if owner_gh and owner_gh not in ghs:
            issues.append({"code": "UNKNOWN_ROUTE_OWNER", "message": f"Topology path '{path_id}' references unknown route owner '{owner_gh}'.", "pathId": path_id, "ghId": owner_gh})
        if path.get("enabled", True) is not False and source in resources and target in resources:
            pairs.setdefault((source, target), []).append({**path, "mode": mode, "pathId": path_id})
    for (source, target), same_pair in pairs.items():
        exclusive = [p for p in same_pair if p.get("shared") is False]
        owners = {_id(p.get("routeOwnerGhId")) for p in exclusive if _id(p.get("routeOwnerGhId"))}
        if len(exclusive) > 1 and len(owners) <= 1:
            issues.append({"code": "TOPOLOGY_PATH_CONFLICT", "message": f"Multiple exclusive active paths connect '{source}' to '{target}'.", "sourceResourceId": source, "targetResourceId": target})
    return issues


def topology_capabilities(configuration: dict[str, Any]) -> dict[str, Any]:
    resources = _resource_map(configuration)
    components = _arr(configuration.get("components"))
    ghs = { _id(g.get("ghId") or g.get("id")): g for g in _arr(configuration.get("greenhouses")) if _id(g.get("ghId") or g.get("id")) }
    for component in components:
        gh_id = _id((component.get("assignment") or {}).get("ghId"))
        if gh_id:
            ghs.setdefault(gh_id, {})

    states: dict[str, dict[str, Any]] = {}
    topology_issues = validate_topology(configuration)
    resource_issues = validate_resource_assignments(configuration)
    for gh_id, gh in ghs.items():
        assigned_components = [c for c in components if _id((c.get("assignment") or {}).get("ghId")) == gh_id]
        mix_tanks = { _id(c.get("resourceId")) for c in assigned_components if "MIX" in _component_text(c) and "TANK" in _component_text(c) and _operational(c) }
        delivery = any(any(t in _component_text(c) for t in ("DISTRIBUTION_PUMP", "DELIVERY_PUMP", "DIST_PUMP", "FERTIGATION_PUMP")) and _operational(c) for c in assigned_components)
        dosing = any("DOSING" in _component_text(c) and _operational(c) for c in components if _id((c.get("assignment") or {}).get("ghId")) in ("", gh_id))
        raw_source = any(any(t in _component_text(c) for t in ("WELL_PUMP", "RAW_WATER", "RAW_SUBMERSIBLE")) and _operational(c) and not _id((c.get("assignment") or {}).get("ghId")) for c in components)
        flow = any(any(t in _component_text(c) for t in ("FLOW_METER", "FLOW_SENSOR")) and _operational(c) for c in assigned_components)
        level = any(any(t in _component_text(c) for t in ("LEVEL", "FLOAT", "RADAR", "TANK_SENSOR")) and _operational(c) for c in assigned_components)
        ec = any(any(t in _component_text(c) for t in ("EC", "CONDUCTIVITY")) and _operational(c) for c in assigned_components)
        ph = any("PH" in _component_text(c) and _operational(c) for c in assigned_components)
        climate = any(any(t in _component_text(c) for t in ("FAN", "BLOWER", "CLIMATE", "TEMPERATURE", "HUMIDITY")) and _operational(c) for c in assigned_components)
        hydraulic = False
        delivery_reachable = False
        auto_route = False
        manual_route = False
        shared_route = False
        routing_control_required = False
        owner = _id(configuration.get("manualRouteOwnerGhId")) or None
        paths = [p for p in _arr(configuration.get("topology")) if p.get("enabled", True) is not False]
        configured_gh_count = len([gh for gh in ghs if gh])
        source_to_ghs: dict[str, set[str]] = {}
        for other_gh, _other in ghs.items():
            other_tanks = {
                _id(c.get("resourceId")) for c in components
                if _id((c.get("assignment") or {}).get("ghId")) == other_gh
                and "MIX" in _component_text(c) and "TANK" in _component_text(c) and _operational(c)
            }
            for other_path in paths:
                if _id(other_path.get("targetResourceId")) in other_tanks:
                    src = _id(other_path.get("sourceResourceId"))
                    if src:
                        source_to_ghs.setdefault(src, set()).add(other_gh)
        for path in paths:
            source_id = _id(path.get("sourceResourceId"))
            target_id = _id(path.get("targetResourceId"))
            if source_id in mix_tanks:
                target_resource = resources.get(target_id, {})
                target_component = target_resource.get("component") if isinstance(target_resource, dict) else None
                if target_component and any(token in _component_text(target_component) for token in ("DISTRIBUTION_PUMP", "DELIVERY_PUMP", "DIST_PUMP", "FERTIGATION_PUMP")) and resource_operational(configuration, source_id) and resource_operational(configuration, target_id):
                    aux_ok = all(not _id(path.get(key)) or resource_operational(configuration, _id(path.get(key))) for key in ("pumpResourceId", "valveResourceId", "tankResourceId"))
                    if aux_ok:
                        delivery_reachable = True
            if target_id not in mix_tanks:
                continue
            source = _id(path.get("sourceResourceId"))
            target = _id(path.get("targetResourceId"))
            if not (resource_operational(configuration, source) and resource_operational(configuration, target)):
                continue
            aux_ok = True
            for key in ("valveResourceId", "pumpResourceId", "tankResourceId"):
                rid = _id(path.get(key))
                if rid and not resource_operational(configuration, rid):
                    aux_ok = False
            if not aux_ok:
                continue
            hydraulic = True
            mode = _id(path.get("mode") or "AUTOMATIC").upper()
            shared = bool(path.get("shared", False))
            auto_allowed = not (configured_gh_count > 1 and len(source_to_ghs.get(source, set())) > 1 and not _id(path.get("valveResourceId")))
            if configured_gh_count > 1 and len(source_to_ghs.get(source, set())) > 1 and not _id(path.get("valveResourceId")):
                routing_control_required = True
            if mode == "AUTOMATIC" and auto_allowed:
                auto_route = True
            elif mode == "MANUAL" or shared:
                manual_route = True
            if shared:
                shared_route = True
            route_owner = _id(path.get("routeOwnerGhId"))
            if route_owner and not owner:
                owner = route_owner

        can_auto_route = auto_route
        manual_granted = owner == gh_id if owner else False
        current_route_active = can_auto_route or manual_granted
        can_auto_fill = raw_source and hydraulic and current_route_active
        can_auto_dose = dosing
        can_auto_mix = bool(mix_tanks) and can_auto_dose and hydraulic
        delivery = delivery and delivery_reachable
        route_ok = current_route_active or (not shared_route and not routing_control_required)
        can_run = bool(gh.get("complexId", configuration.get("complexId")) == configuration.get("complexId") and delivery and can_auto_dose and can_auto_mix and route_ok)
        states[gh_id] = {
            "ghId": gh_id,
            "configured": bool(gh and gh.get("complexId", configuration.get("complexId")) == configuration.get("complexId")),
            "hydraulicallyReachable": hydraulic,
            "deliveryReachable": delivery_reachable,
            "automaticallyRoutable": can_auto_route,
            "manuallyRoutable": manual_route or can_auto_route,
            "currentSharedManualTarget": gh_id if manual_granted else None,
            "sharedPath": shared_route,
            "routingControlRequired": routing_control_required,
            "capabilities": {
                "CAN_DELIVER": delivery,
                "CAN_AUTO_FILL": can_auto_fill,
                "CAN_AUTO_DOSE": can_auto_dose,
                "CAN_AUTO_MIX": can_auto_mix,
                "CAN_AUTO_ROUTE": can_auto_route,
                "CAN_MONITOR_FLOW": flow,
                "CAN_MONITOR_LEVEL": level,
                "CAN_MONITOR_EC": ec,
                "CAN_MONITOR_PH": ph,
                "CAN_CLIMATE_CONTROL": climate,
                "CAN_RUN_AUTONOMOUSLY": can_run,
            },
        }
    return {
        "topologyVersion": int(configuration.get("version") or 0),
        "capabilitiesVersion": int(configuration.get("version") or 0),
        "valid": not bool(topology_issues or resource_issues),
        "issues": [*topology_issues, *resource_issues],
        "byGh": states,
    }


def _find_complex(configuration: dict[str, Any], complex_id: str) -> bool:
    complexes = _arr(configuration.get("complexes"))
    if not complexes:
        return complex_id == _id(configuration.get("complexId"))
    return any(_id(c.get("complexId") or c.get("id")) == complex_id for c in complexes)


def _find_gh(configuration: dict[str, Any], complex_id: str, gh_id: str) -> dict[str, Any] | None:
    return next((g for g in _arr(configuration.get("greenhouses")) if _id(g.get("ghId") or g.get("id")) == gh_id and _id(g.get("complexId")) == complex_id), None)


def _find_components(configuration: dict[str, Any], gh_id: str | None, tokens: tuple[str, ...], include_complex: bool = True) -> list[dict[str, Any]]:
    out = []
    for component in _arr(configuration.get("components")):
        assigned = _id((component.get("assignment") or {}).get("ghId"))
        if assigned != (gh_id or "") and not (include_complex and not assigned):
            continue
        if component.get("lifecycleState") not in (None, "COMMISSIONED", "ENABLED"):
            continue
        text = _component_text(component)
        if any(token in text for token in tokens):
            out.append(component)
    return out


def compile_schedule(configuration: dict[str, Any], intent: dict[str, Any], active_locks: list[dict[str, Any]] | None = None, now_ms: int | None = None) -> dict[str, Any]:
    intent = deepcopy(intent)
    sid = _id(intent.get("scheduleId") or intent.get("id"))
    complex_id = _id(intent.get("complexId"))
    gh_id = _id(intent.get("ghId")) or None
    owner_id = _id(intent.get("ownerId")) or sid
    action = _id(intent.get("action")).upper()
    enabled = intent.get("enabled", True) is not False
    priority = int(intent.get("priority", 100)) if isinstance(intent.get("priority", 100), (int, float)) else 100
    trigger = intent.get("trigger") or {}
    if not isinstance(trigger, dict):
        return {"scheduleId": sid, "status": "INVALID", "activationState": "INVALID", "errors": [{"code": "INVALID_TRIGGER", "message": "trigger must be an object."}], "blockedReasons": [], "compiled": None}
    trigger_type = _id(trigger.get("type") or intent.get("type")).upper()
    parameters = deepcopy(intent.get("parameters") or {})

    errors: list[dict[str, Any]] = []
    if not sid: errors.append({"code": "SCHEDULE_ID_REQUIRED", "message": "Schedule ID is required."})
    if not complex_id: errors.append({"code": "COMPLEX_REQUIRED", "message": "Target Complex is required."})
    if not action: errors.append({"code": "ACTION_REQUIRED", "message": "Schedule action is required."})
    if not trigger_type: errors.append({"code": "TRIGGER_TYPE_REQUIRED", "message": "Schedule trigger type is required."})
    if errors: return {"scheduleId": sid, "status": "INVALID", "activationState": "INVALID", "errors": errors, "blockedReasons": [], "compiled": None}
    if _id(intent.get("activationState") or intent.get("status")).upper() == "DRAFT":
        return {"scheduleId": sid, "status": "DRAFT", "activationState": "DRAFT", "errors": [], "blockedReasons": [], "compiled": None}
    if not _find_complex(configuration, complex_id):
        errors.append({"code": "UNKNOWN_COMPLEX", "message": f"Target Complex '{complex_id}' does not exist."})
    if gh_id and not _find_gh(configuration, complex_id, gh_id):
        errors.append({"code": "UNKNOWN_GREENHOUSE", "message": f"Target GH '{gh_id}' does not belong to Complex '{complex_id}'."})
    if not enabled:
        return {"scheduleId": sid, "status": "DISABLED", "activationState": "DISABLED", "errors": errors, "blockedReasons": [], "compiled": None}
    if action not in ACTIONS:
        errors.append({"code": "UNSUPPORTED_ACTION", "message": f"Action '{action}' is not supported by the compiler."})
    if trigger_type not in RECURRENCE_TYPES:
        errors.append({"code": "INVALID_RECURRENCE_TYPE", "message": f"Unsupported recurrence type '{trigger_type}'."})
    if trigger_type == "DAILY":
        try:
            hour, minute, days = int(trigger.get("hour")), int(trigger.get("minute")), int(trigger.get("daysOfWeek"))
            if not 0 <= hour <= 23: errors.append({"code": "INVALID_HOUR", "message": "DAILY hour must be 0..23."})
            if not 0 <= minute <= 59: errors.append({"code": "INVALID_MINUTE", "message": "DAILY minute must be 0..59."})
            if not 1 <= days <= 127: errors.append({"code": "INVALID_DAYS_OF_WEEK", "message": "DAILY daysOfWeek must be 1..127."})
        except (TypeError, ValueError):
            errors.append({"code": "INVALID_DAILY_TRIGGER", "message": "DAILY trigger values must be integers."})
    elif trigger_type == "INTERVAL" and (not isinstance(trigger.get("intervalMin"), (int, float)) or int(trigger["intervalMin"]) <= 0):
        errors.append({"code": "INVALID_INTERVAL", "message": "INTERVAL intervalMin must be > 0."})
    elif trigger_type == "ONCE":
        try: datetime.fromisoformat(str(trigger.get("timestamp")).replace("Z", "+00:00"))
        except Exception: errors.append({"code": "INVALID_ONCE_TIMESTAMP", "message": "ONCE timestamp must be a valid ISO timestamp."})
    if not 0 <= priority <= 1000:
        errors.append({"code": "INVALID_PRIORITY", "message": "Priority must be 0..1000."})
    missed = _id(intent.get("missedRunPolicy") or "SKIP").upper()
    fallback_enabled = intent.get("fallbackEnabled") is True
    fallback_id = _id(intent.get("fallbackScheduleId")) or None
    if fallback_enabled and not fallback_id:
        errors.append({"code": "FALLBACK_SCHEDULE_REQUIRED", "message": "fallbackScheduleId is required when fallbackEnabled is true."})
    if fallback_id and fallback_id == sid:
        errors.append({"code": "FALLBACK_SELF_REFERENCE", "message": "A schedule cannot use itself as its fallback."})
    if missed not in MISSED_POLICIES:
        errors.append({"code": "INVALID_MISSED_RUN_POLICY", "message": "missedRunPolicy must be EXECUTE or SKIP."})
    if action == "FERTIGATION":
        execution_plan = parameters.get("executionPlan")
        if not isinstance(execution_plan, dict) or not execution_plan.get("components"):
            errors.append({"code": "EXECUTION_PLAN_REQUIRED", "message": "FERTIGATION schedules must carry an authoritative resolved executionPlan."})
        water = parameters.get("rawWaterVolumeMl")
        if not isinstance(water, (int, float)) or water <= 0: errors.append({"code": "INVALID_RAW_WATER_VOLUME", "message": "FERTIGATION requires rawWaterVolumeMl > 0."})
        duration = parameters.get("durationSec")
        if duration is not None and (not isinstance(duration, int) or duration <= 0): errors.append({"code": "INVALID_DURATION", "message": "durationSec must be a positive integer."})
        for key, value in parameters.items():
            if key.lower().startswith("dosing") and key.lower().endswith("ml") and (not isinstance(value, (int, float)) or value < 0):
                errors.append({"code": "INVALID_DOSING_VOLUME", "message": f"{key} must be non-negative."})
        if parameters.get("targetMode") == "ppm" and (not isinstance(parameters.get("targetPpm"), (int, float)) or parameters["targetPpm"] <= 0):
            errors.append({"code": "INVALID_TARGET_PPM", "message": "targetPpm must be > 0 for ppm target mode."})
        recipe_id = _id(intent.get("recipeId"))
        if recipe_id and not any(_id(r.get("recipeId")) == recipe_id for r in _arr(configuration.get("recipes"))):
            errors.append({"code": "UNKNOWN_RECIPE", "message": f"Recipe '{recipe_id}' does not exist."})
    elif action in {"WATER_PUMP", "FAN_TOGGLE"}:
        duration = parameters.get("durationSec")
        if not isinstance(duration, int) or duration <= 0:
            errors.append({"code": "INVALID_DURATION", "message": f"{action} requires a positive integer durationSec."})
        if action == "FAN_TOGGLE" and str(parameters.get("controlMode", "")).upper() == "TEMPERATURE":
            errors.append({"code": "UNSUPPORTED_CONDITION_TRIGGER", "message": "Temperature-controlled fan schedules require a condition scheduler."})
    if errors:
        return {"scheduleId": sid, "status": "INVALID", "activationState": "INVALID", "errors": errors, "blockedReasons": [], "compiled": None}

    topo = topology_capabilities(configuration)
    resources = _resource_map(configuration)
    if not topo.get("valid", False):
        blocked = [{"code": issue.get("code", "TOPOLOGY_INVALID"), "message": issue.get("message", "Topology configuration is invalid.")} for issue in topo.get("issues", [])]
        return {"scheduleId": sid, "status": "BLOCKED", "activationState": "BLOCKED", "errors": [], "blockedReasons": blocked, "compiled": None}
    resolved_components: list[dict[str, Any]] = []
    required: list[str] = []
    blocked: list[dict[str, Any]] = []
    if action == "FERTIGATION":
        tank = _find_components(configuration, gh_id, ("MIXING_TANK", "MIX_TANK"), False)[:1]
        delivery = _find_components(configuration, gh_id, ("DIST_PUMP", "DISTRIBUTION_PUMP", "DELIVERY_PUMP", "FERTIGATION_PUMP"), False)[:1]
        dosing = _find_components(configuration, gh_id, ("DOSING",), True)
        raw = _find_components(configuration, None, ("WELL_PUMP", "RAW_SUBMERSIBLE", "RAW_WATER"), True)
        if not tank: blocked.append({"code": "MISSING_MIXING_TANK", "message": f"No mixing tank assigned to '{gh_id}'."})
        if not delivery: blocked.append({"code": "MISSING_DELIVERY_PUMP", "message": f"No delivery pump assigned to '{gh_id}'."})
        if parameters.get("automaticDosing", True) and not dosing: blocked.append({"code": "MISSING_DOSING_RESOURCE", "message": f"No dosing resource available for '{gh_id}'."})
        if not raw: blocked.append({"code": "MISSING_RAW_WATER_SOURCE", "message": "No raw-water source is installed."})
        resolved_components = tank + delivery + dosing + raw
        required = ["MIXING_TANK", "DELIVERY_PUMP", "DOSING", "RAW_WATER_PATH"]
    elif action == "WATER_PUMP":
        pumps = _find_components(configuration, None, ("WELL_PUMP", "WATER_PUMP", "RAW_SUBMERSIBLE"), True)[:1]
        if not pumps: blocked.append({"code": "MISSING_WELL_PUMP", "message": "No well/raw-water pump is installed."})
        resolved_components = pumps
        required = ["WELL_PUMP"]
        flow_sensors = _find_components(configuration, None, ("FLOW_METER", "FLOW_SENSOR"), True)
        level_sensors = _find_components(configuration, None, ("LEVEL_SENSOR", "LEVEL", "RADAR", "FLOAT"), True)
        if not flow_sensors: blocked.append({"code": "MISSING_FLOW_SENSOR", "message": "Raw-water pump requires an operational flow sensor for safety."})
        if not level_sensors: blocked.append({"code": "MISSING_LEVEL_SENSOR", "message": "Raw-water pump requires an operational level sensor for overfill protection."})
    else:
        fans = _find_components(configuration, gh_id, ("FAN", "BLOWER"), False)
        if not fans: blocked.append({"code": "MISSING_FAN", "message": f"No fan resource is assigned to '{gh_id}'."})
        resolved_components = fans
        required = ["FAN"]

    state = topo.get("byGh", {}).get(gh_id or "") if gh_id else None
    if gh_id and not state:
        blocked.append({"code": "TOPOLOGY_CONTEXT_UNAVAILABLE", "message": f"No topology context for '{gh_id}'."})
    if action == "FERTIGATION" and state:
        caps = state["capabilities"]
        if not caps["CAN_AUTO_MIX"]: blocked.append({"code": "CAPABILITY_AUTO_MIX_UNAVAILABLE", "message": f"GH '{gh_id}' cannot automatically mix."})
        if not caps["CAN_DELIVER"]: blocked.append({"code": "CAPABILITY_DELIVERY_UNAVAILABLE", "message": f"GH '{gh_id}' cannot automatically deliver."})
        if parameters.get("automaticDosing", True) and not caps["CAN_AUTO_DOSE"]: blocked.append({"code": "CAPABILITY_AUTO_DOSE_UNAVAILABLE", "message": f"GH '{gh_id}' cannot automatically dose."})
        if ((state.get("sharedPath") or state.get("routingControlRequired")) and not state.get("automaticallyRoutable")
                and state.get("currentSharedManualTarget") != gh_id):
            blocked.append({"code": "MANUAL_ROUTE_NOT_OWNED", "message": f"GH '{gh_id}' does not have an executable independent route.", "ghId": gh_id, "routeOwnerGhId": state.get("currentSharedManualTarget")})

    resource_ids: list[str] = []
    for component in resolved_components:
        rid = _id(component.get("resourceId"))
        if not rid:
            blocked.append({"code": "COMPONENT_RESOURCE_REQUIRED", "message": f"Component '{component.get('componentId')}' has no resourceId."})
            continue
        if rid not in resources:
            blocked.append({"code": "RESOURCE_NOT_REGISTERED", "message": f"Resource '{rid}' is not registered.", "resourceId": rid})
            continue
        if not resource_operational(configuration, rid):
            blocked.append({"code": "RESOURCE_NOT_OPERATIONAL", "message": f"Resource '{rid}' is not operational.", "resourceId": rid})
        resource_ids.append(rid)

    locks = active_locks or []
    for rid in set(resource_ids):
        resource = resources[rid]
        if resource.get("shared"):
            continue
        for lock in locks:
            if _id(lock.get("resourceId")) == rid and _id(lock.get("ownerId")) not in {"", owner_id} and _id(lock.get("lockType") or "EXCLUSIVE").upper() != "SHARED":
                blocked.append({"code": "RESOURCE_LOCK_CONFLICT", "message": f"Resource '{rid}' is locked by '{lock.get('ownerId')}'.", "resourceId": rid})

    if blocked:
        return {"scheduleId": sid, "status": "BLOCKED", "activationState": "BLOCKED", "errors": [], "blockedReasons": blocked, "compiled": None}

    now_ms = int(now_ms if now_ms is not None else datetime.now(tz=timezone.utc).timestamp() * 1000)
    requested_start_ms = now_ms
    if trigger_type == "ONCE":
        try:
            requested_start_ms = int(datetime.fromisoformat(str(trigger.get("timestamp")).replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            requested_start_ms = now_ms
    elif isinstance(intent.get("validity"), dict) and intent["validity"].get("startsAt"):
        try:
            requested_start_ms = int(datetime.fromisoformat(str(intent["validity"]["startsAt"]).replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            requested_start_ms = now_ms
    duration_sec = int(parameters.get("durationSec") or 60)
    recipe_id = _id(intent.get("recipeId")) or None
    recipe = next((r for r in _arr(configuration.get("recipes")) if _id(r.get("recipeId")) == recipe_id), None) if recipe_id else None
    compiled = {
        "compiledId": f"{sid}:v{int(configuration.get('version') or 0)}:{now_ms}",
        "scheduleId": sid,
        "status": "ACTIVE",
        "activationState": "ACTIVE",
        "complexId": complex_id,
        "ghId": gh_id,
        "action": action,
        "ownerId": owner_id,
        "priority": priority,
        "startTimestamp": requested_start_ms,
        "endTimestamp": requested_start_ms + duration_sec * 1000,
        "trigger": deepcopy(trigger),
        "resourceIds": sorted(set(resource_ids)),
        "resourceLocks": [
            {"resourceId": rid, "lockType": "SHARED" if resources.get(rid, {}).get("shared") else "EXCLUSIVE"}
            for rid in sorted(set(resource_ids))
        ],
        "componentIds": sorted({_id(c.get("componentId")) for c in resolved_components if _id(c.get("componentId"))}),
        "dependencies": {
            "requirements": required,
            "topology": deepcopy(state),
            "capabilities": deepcopy(state.get("capabilities") if state else None),
        },
        "safety": {"emergencyStopRequiredClear": True, "sensorValidationRequired": action == "FERTIGATION", "maxRuntimeSec": duration_sec},
        "recurrence": deepcopy(trigger),
        "missedRunPolicy": missed,
        "recoveryWindowH": max(1, int(intent.get("recoveryWindowH") or parameters.get("recoveryWindowH") or 2)),
        "recoveryWindowSec": max(60, int(intent.get("recoveryWindowH") or parameters.get("recoveryWindowH") or 2) * 3600),
        "fallback": {"enabled": fallback_enabled, "scheduleId": fallback_id},
        "timezone": _id(intent.get("timezone") or trigger.get("timezone")) or None,
        "validity": deepcopy(intent.get("validity")),
        "compiledAtTimestamp": now_ms,
        "recipeSnapshot": deepcopy(recipe),
        "configurationVersion": int(configuration.get("version") or 0),
        "configurationHash": _id(configuration.get("configurationHash")) or None,
        "parameters": parameters,
        "executionPlan": deepcopy(parameters.get("executionPlan")) if action == "FERTIGATION" and isinstance(parameters.get("executionPlan"), dict) else None,
    }
    return {"scheduleId": sid, "status": "ACTIVE", "activationState": "ACTIVE", "errors": [], "blockedReasons": [], "warnings": [], "compiled": compiled}


def compile_schedule_set(configuration: dict[str, Any], schedules: list[dict[str, Any]], active_locks: list[dict[str, Any]] | None = None, now_ms: int | None = None) -> dict[str, Any]:
    locks = list(active_locks or [])
    results = []
    compiled = []
    seen_ids: set[str] = set()
    resources = _resource_map(configuration)
    all_ids = {_id(intent.get("scheduleId") or intent.get("id")) for intent in schedules if isinstance(intent, dict)}
    for intent in schedules:
        sid = _id(intent.get("scheduleId") or intent.get("id")) if isinstance(intent, dict) else ""
        if sid and sid in seen_ids:
            result = {"scheduleId": sid, "status": "INVALID", "activationState": "INVALID", "errors": [{"code": "DUPLICATE_SCHEDULE_ID", "message": f"Duplicate schedule ID '{sid}'."}], "blockedReasons": [], "compiled": None}
        else:
            if sid:
                seen_ids.add(sid)
            result = compile_schedule(configuration, intent, locks, now_ms=now_ms)
        fallback_id = _id(intent.get("fallbackScheduleId")) if isinstance(intent, dict) else ""
        if result.get("status") == "ACTIVE" and result.get("compiled") and intent.get("fallbackEnabled") is True:
            if not fallback_id or fallback_id == sid:
                result = {"scheduleId": sid, "status": "INVALID", "activationState": "INVALID", "errors": [{"code": "INVALID_FALLBACK", "message": "Fallback schedule reference is invalid."}], "blockedReasons": [], "compiled": None}
            elif fallback_id not in all_ids:
                result = {"scheduleId": sid, "status": "BLOCKED", "activationState": "BLOCKED", "errors": [], "blockedReasons": [{"code": "MISSING_FALLBACK_SCHEDULE", "message": f"Fallback schedule '{fallback_id}' is not present in this schedule set."}], "compiled": None}
            else:
                result["compiled"]["fallback"] = {"enabled": True, "scheduleId": fallback_id}
        results.append(result)
        if result.get("status") == "ACTIVE" and result.get("compiled"):
            compiled.append(result["compiled"])
            for rid in result["compiled"].get("resourceIds", []):
                lock_type = "SHARED" if resources.get(rid, {}).get("shared") else "EXCLUSIVE"
                locks.append({"resourceId": rid, "ownerId": result["compiled"]["ownerId"], "lockType": lock_type})
    return {
        "configurationVersion": int(configuration.get("version") or 0),
        "valid": not any(r["status"] == "INVALID" for r in results),
        "results": results,
        "compiled": compiled,
        "blocked": [r for r in results if r["status"] == "BLOCKED"],
        "invalid": [r for r in results if r["status"] == "INVALID"],
    }
