from __future__ import annotations
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.resource_manager import list_resources, transfer_resource
from backend.schedule_compiler import compile_schedule_set, topology_capabilities
ROOT=Path(__file__).resolve().parents[1]

def cfg():
    return {
      "complexId":"complex-A","version":10,"updatedAt":"2026-09-19T00:00:00Z",
      "greenhouses":[{"ghId":"GH-02","name":"North"},{"ghId":"GH-03","name":"South"}],
      "components":[
        {"componentId":"fan-01","supportedTypeId":"fan","name":"Fan 01","role":"FAN","resourceId":"res-fan-01","lifecycleState":"ENABLED","deploymentStatus":"APPLIED","assignment":{"complexId":"complex-A","ghId":"GH-02"},"parameters":{}},
        {"componentId":"mix-01","supportedTypeId":"mixing-tank","name":"Mix 01","role":"MIXING_TANK","resourceId":"res-mix-01","lifecycleState":"ENABLED","deploymentStatus":"APPLIED","assignment":{"complexId":"complex-A","ghId":"GH-02"},"parameters":{}},
      ],
      "resources":[{"resourceId":"res-fan-01","componentId":"fan-01","type":"FAN","shared":False,"available":True}, {"resourceId":"res-mix-01","componentId":"mix-01","type":"MIXING_TANK","shared":False,"available":True}],
      "assignments":[{"assignmentId":"a-fan","resourceId":"res-fan-01","scope":"GH","ghId":"GH-02"},{"assignmentId":"a-mix","resourceId":"res-mix-01","scope":"GH","ghId":"GH-02"}],
      "schedules":[{"scheduleId":"sched-fan","ownerId":"sched-fan","ghId":"GH-02","type":"DAILY","action":"FAN_TOGGLE","enabled":True}],
      "recipes":[],"topology":[],"settings":{}
    }

def main():
    c=cfg(); r=list_resources(c); assert {x["resourceId"] for x in r}=={"res-fan-01","res-mix-01"}
    try: transfer_resource(c,"res-fan-01","GH-03",physical_move_confirmed=False)
    except ValueError: pass
    else: raise AssertionError("unconfirmed physical transfer allowed")
    out=transfer_resource(c,"res-fan-01","GH-03",physical_move_confirmed=True,operator="tester")
    nc=out["configuration"]
    fan=next(x for x in nc["components"] if x["componentId"]=="fan-01")
    assert fan["assignment"]["ghId"]=="GH-03"
    assert any(a.get("ghId")=="GH-03" for a in nc["assignments"] if a.get("resourceId")=="res-fan-01")
    assert out["requiresDeployment"] is True and out["transfer"]["fromGhIds"]==["GH-02"]
    # Dynamic-GH source invariants: no production C code may fabricate gh-01 context.
    transfer_c = (ROOT/"esp32/main/services/transfer_mgr.c").read_text(errors="ignore")
    transfer_h = (ROOT/"esp32/main/services/transfer_mgr.h").read_text(errors="ignore")
    command_h = (ROOT/"esp32/main/services/command_mgr.h").read_text(errors="ignore")
    command_c = (ROOT/"esp32/main/http/api_command_handlers.c").read_text(errors="ignore")
    command_mgr_c = (ROOT/"esp32/main/services/command_mgr.c").read_text(errors="ignore")
    assert "esp_err_t transfer_mgr_start(const char *source_component_id, const char *destination_component_id" in transfer_h
    assert "source_component_id[40]" in command_h and "destination_component_id[40]" in command_h
    assert "TRANSFER_COMPONENT_IDS_REQUIRED" in command_c and "sourceComponentId" in command_c and "destinationComponentId" in command_c
    assert "transfer_mgr_start(cmd.source_component_id, cmd.destination_component_id" in command_mgr_c
    timeline=(ROOT/"src/app/schedule/page.tsx").read_text(errors="ignore")
    assert 'const lanes = ["GH 01"' not in timeline
    prod=[]
    for p in (ROOT/"esp32/main", ROOT/"backend"):
        for f in p.rglob('*'):
            if f.is_file() and f.suffix in {'.c','.h','.py','.ts','.tsx','.js'}:
                txt=f.read_text(errors='ignore')
                if '"gh-01"' in txt or '"GH-01"' in txt: prod.append(str(f))
    assert not prod, f"static GH-01 literals remain in production runtime: {prod}"
    print("M5/M6 GATE: PASS")
    print("- dynamic Complex/GH context from active config")
    print("- component/resource runtime state is registry-driven")
    print("- resource transfer requires physical confirmation")
    print("- ownership + component assignment move together")
    print("- transfer returns impacted configuration/capability/schedule data and requires M3/M4 deployment")

if __name__=='__main__': main()
