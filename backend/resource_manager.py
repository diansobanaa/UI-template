"""Configuration-driven resource ownership and transfer manager (M6)."""
from __future__ import annotations
from copy import deepcopy
from typing import Any
try:
    from .schedule_compiler import compile_schedule_set, topology_capabilities
except ImportError:
    from schedule_compiler import compile_schedule_set, topology_capabilities


def _id(v: Any) -> str:
    return str(v).strip() if isinstance(v, str) else ""


def _arr(v: Any) -> list[dict[str, Any]]:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _resource_map(configuration: dict[str, Any]) -> dict[str, dict[str, Any]]:
    resources: dict[str, dict[str, Any]] = {}
    for r in _arr(configuration.get("resources")):
        rid = _id(r.get("resourceId"))
        if rid: resources[rid] = deepcopy(r)
    for c in _arr(configuration.get("components")):
        rid = _id(c.get("resourceId"))
        if rid and rid not in resources:
            resources[rid] = {"resourceId": rid, "componentId": _id(c.get("componentId")), "type": c.get("role") or c.get("supportedTypeId") or "COMPONENT", "shared": False, "available": True}
        if rid and rid in resources:
            resources[rid]["component"] = c
            resources[rid].setdefault("componentId", _id(c.get("componentId")))
    return resources


def list_resources(configuration: dict[str, Any]) -> list[dict[str, Any]]:
    resources = _resource_map(configuration)
    assignments = _arr(configuration.get("assignments"))
    by_resource: dict[str, list[dict[str, Any]]] = {}
    for a in assignments:
        rid = _id(a.get("resourceId"))
        if rid: by_resource.setdefault(rid, []).append(a)
    out=[]
    for rid,r in resources.items():
        x=deepcopy(r)
        x["resourceId"]=rid
        x["assignments"]=by_resource.get(rid,[])
        owners=[]
        for a in x["assignments"]:
            owner=_id(a.get("ghId") or a.get("ownerId") or a.get("complexId"))
            if owner: owners.append(owner)
        x["owners"]=owners
        x["ownerId"]=r.get("currentOwnerId") or (owners[0] if owners else None)
        if x["shared"]:
            x["currentOwnerId"]=None
        elif owners:
            x["currentOwnerId"]=owners[0]
        else:
            x["currentOwnerId"]=None
        x["shared"]=bool(r.get("shared",False))
        x["available"]=bool(r.get("available",True))
        out.append(x)
    return sorted(out,key=lambda x:x["resourceId"])


def _schedule_resource_ids(schedule: dict[str, Any], resource_by_component: dict[str, str]) -> set[str]:
    ids={_id(x.get("resourceId")) for x in _arr(schedule.get("resourceLocks"))}
    ids |= {_id(x.get("resourceId")) for x in _arr(schedule.get("resourceClaims"))}
    rid=_id(schedule.get("resourceId"));
    if rid: ids.add(rid)
    for c in _arr(schedule.get("componentIds")):
        cid=_id(c.get("componentId") if isinstance(c,dict) else c)
        if cid and cid in resource_by_component: ids.add(resource_by_component[cid])
    return {x for x in ids if x}


def transfer_resource(configuration: dict[str, Any], resource_id: str, target_gh_id: str, *, physical_move_confirmed: bool = False, operator: str | None = None) -> dict[str, Any]:
    """Return a proposed configuration transfer plus impacted schedules/capabilities.

    M3/M4 owns activation/deployment. This function only mutates the proposed
    configuration and refuses unsafe ownership changes; callers must deploy it
    through the configuration authority before it becomes active on ESP32.
    """
    config=deepcopy(configuration)
    rid=_id(resource_id); target=_id(target_gh_id)
    if not rid or not target: raise ValueError("resourceId and targetGhId are required")
    ghs={_id(g.get("ghId") or g.get("id")) for g in _arr(config.get("greenhouses"))}
    if target not in ghs: raise ValueError(f"Target GH '{target}' is not present in configuration")
    resources=_resource_map(config); resource=resources.get(rid)
    if not resource: raise ValueError(f"Resource '{rid}' is not registered")
    if resource.get("available") is False: raise ValueError(f"Resource '{rid}' is unavailable")
    if not physical_move_confirmed: raise ValueError("Physical move confirmation is required before ownership transfer")

    assignments=_arr(config.get("assignments"))
    old_owners=[]
    new_assignments=[]
    for a in assignments:
        a2=deepcopy(a)
        if _id(a2.get("resourceId"))==rid:
            old=_id(a2.get("ghId") or a2.get("ownerId"))
            if old: old_owners.append(old)
            if resource.get("shared") is True:
                # Shared resources may keep their assignment record; add target if missing.
                new_assignments.append(a2)
            else:
                continue
        else:
            new_assignments.append(a2)
    if resource.get("shared") is True:
        if not any(_id(a.get("resourceId"))==rid and _id(a.get("ghId"))==target for a in new_assignments):
            new_assignments.append({"assignmentId":f"assign-{rid}-{target}","resourceId":rid,"scope":"GH","ghId":target})
    else:
        new_assignments.append({"assignmentId":f"assign-{rid}-{target}","resourceId":rid,"scope":"GH","ghId":target})
    config["assignments"]=new_assignments

    # Keep component assignment aligned with the resource ownership model.
    component_ids={_id(c.get("componentId")) for c in _arr(resource.get("component"))} if False else {_id(resource.get("componentId"))}
    for c in _arr(config.get("components")):
        if _id(c.get("resourceId"))==rid or _id(c.get("componentId")) in component_ids:
            a=c.get("assignment") if isinstance(c.get("assignment"),dict) else {}
            a=deepcopy(a); a["complexId"]=_id(config.get("complexId")); a["ghId"]=target; c["assignment"]=a

    version=int(config.get("version") or 0)+1
    config["version"]=version
    config["updatedAt"]=config.get("updatedAt") or ""
    transfer={"resourceId":rid,"fromGhIds":sorted(set(old_owners)),"toGhId":target,"physicalMoveConfirmed":True,"operator":operator,"configurationVersion":version}
    config.setdefault("resourceTransfers",[]).append(transfer)

    resource_by_component={_id(c.get("componentId")):_id(c.get("resourceId")) for c in _arr(config.get("components")) if _id(c.get("componentId")) and _id(c.get("resourceId"))}
    schedules=_arr(config.get("schedules"))
    affected=[]
    affected_ids=set()
    impacted_ghs=set(old_owners) | {target}
    for s in schedules:
        schedule_gh=_id(s.get("ghId"))
        if rid in _schedule_resource_ids(s, resource_by_component) or schedule_gh in impacted_ghs:
            sid=_id(s.get("scheduleId") or s.get("id"));
            if sid: affected_ids.add(sid); affected.append(deepcopy(s))
    compiled=compile_schedule_set(config,schedules,[])
    impacted_results=[r for r in compiled.get("results",[]) if _id(r.get("scheduleId")) in affected_ids]
    capabilities=topology_capabilities(config)
    return {"configuration":config,"resource":next(x for x in list_resources(config) if x["resourceId"]==rid),"transfer":transfer,"affectedSchedules":impacted_results,"capabilities":capabilities,"requiresDeployment":True,"deploymentStatus":"READY_FOR_CONFIGURATION_DEPLOYMENT"}
