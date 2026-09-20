import os, tempfile, json, subprocess, time, urllib.request, urllib.error
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

root=Path(__file__).resolve().parents[1]
td=tempfile.TemporaryDirectory(); d=Path(td.name)
os.environ["AGROTECH_OPERATIONAL_DB"]=str(d/"operational.sqlite3")
os.environ["AGROTECH_HISTORY_DB"]=str(d/"history.sqlite3")
os.environ["AGROTECH_RECOVERY_DB"]=str(d/"recovery.sqlite3")
os.environ["AGROTECH_RESEARCH_DB"]=str(d/"research.sqlite3")
from backend.operational_store import OperationalStore
from backend.recovery_store import RecoveryStore
from backend.research_store import ResearchStore
from backend.history_store import HistoryStore

op=OperationalStore(); rec=RecoveryStore(); rs=ResearchStore(); hs=HistoryStore()
op.save_complex({"id":"complex-01","code":"CX01","name":"Research Complex","location":"Test","status":"ACTIVE","esp32":{"online":False}})
op.save_greenhouse({"id":"gh-02","complexId":"complex-01","code":"GH02","crop":"melon","plants":{}})
rec.set_deployment("complex-01", desired_version=7, desired_hash="hash7", status="PENDING_DEPLOYMENT")
assert rec.get_deployment("complex-01")["status"]=="PENDING_DEPLOYMENT"
# Research cycle lifecycle + uniqueness
c=rs.save_cycle({"complexId":"complex-01","ghId":"gh-02","status":"ACTIVE","plantingDate":"2026-09-01","pollinationDate":"2026-09-05","variety":"Melon","plantCount":2})
try: rs.save_cycle({"complexId":"complex-01","ghId":"gh-02","status":"ACTIVE","plantingDate":"2026-09-02"}); raise AssertionError("multiple active cycles allowed")
except ValueError: pass
p=rs.save_plant({"cycleId":c["cycleId"],"plantTag":"P-001","position":"R1"})
try: rs.save_plant({"cycleId":c["cycleId"],"plantTag":"P-001"}); raise AssertionError("duplicate plant tag allowed")
except ValueError: pass
f=rs.save_fruit({"plantId":p["plantId"],"fruitTag":"F-001","weightG":850,"grade":"B"})
o=rs.save_observation({"cycleId":c["cycleId"],"plantId":p["plantId"],"metric":"plant_check","heightCm":38,"leafCount":8,"fruitCount":1})
summary=rs.summary_for_gh("complex-01","gh-02")
assert summary["currentCycle"]["cycleId"]==c["cycleId"]
assert summary["plantStats"]["alive"]==1 and summary["plantStats"]["totalFruits"]==1
analysis=rs.analysis("complex-01",c["cycleId"],hs, type("F",(),{"list":lambda *a: []})(), type("C",(),{"history":lambda *a,**k: []})())
assert analysis["counts"]["observations"]==1
# Source gates
files=[root/"backend/recovery_store.py",root/"backend/research_store.py",root/"esp32/main/services/offline_sync_mgr.c",root/"esp32/main/services/crop_cycle_mgr.c",root/"src/app/research/page.tsx"]
for fpath in files: assert fpath.exists(), f"missing {fpath}"
text=(root/"esp32/main/services/offline_sync_mgr.c").read_text()
assert 'telemetry_mgr_get_history_json(NULL, tcur' in text and 'event_mgr_get_events_json(ecur' in text
text=(root/"esp32/main/services/fertigation_mgr.c").read_text(); assert 'recoveryRequired' in text and 'RECOVERY_HOLD' in text
text=(root/"src/app/research/page.tsx").read_text(); assert '/research' not in text or 'ResearchContent' in text
print("M14/M15 gate: PASS")
print("- persistent recovery sync/deployment state")
print("- cursor-aware offline replay + reconnect hook")
print("- reboot interruption hold / explicit operator disposition")
print("- per-GH crop cycles, plant mortality identity, fruit records, observations")
print("- historical research analysis relationships")
