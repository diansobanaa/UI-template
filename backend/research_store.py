"""Persistent crop/research data model built on top of M13 operational history."""
from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def _days_from(start: str | None, end: str | None = None) -> int | None:
    if not start:
        return None
    try:
        a = datetime.fromisoformat(str(start)[:10]).date()
        b = datetime.fromisoformat(str(end or _now())[:10]).date()
        return max(0, (b - a).days)
    except ValueError:
        return None


class ResearchStore:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.getenv("AGROTECH_RESEARCH_DB", "./agrotech_research.sqlite3")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._init()

    def _init(self) -> None:
        with self._db:
            self._db.executescript("""
            CREATE TABLE IF NOT EXISTS crop_cycles (
                cycle_id TEXT PRIMARY KEY, complex_id TEXT NOT NULL, gh_id TEXT NOT NULL,
                status TEXT NOT NULL, planting_date TEXT, pollination_date TEXT,
                expected_harvest_date TEXT, actual_harvest_date TEXT, variety TEXT,
                plant_count INTEGER NOT NULL DEFAULT 0, mortality_count INTEGER NOT NULL DEFAULT 0,
                notes TEXT, yield_kg REAL, grade TEXT, source TEXT, source_device_id TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS plants (
                plant_id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, complex_id TEXT NOT NULL, gh_id TEXT NOT NULL,
                plant_tag TEXT NOT NULL, position TEXT, planted_at TEXT, status TEXT NOT NULL DEFAULT 'ALIVE',
                mortality_date TEXT, mortality_reason TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fruits (
                fruit_id TEXT PRIMARY KEY, plant_id TEXT NOT NULL, cycle_id TEXT NOT NULL, complex_id TEXT NOT NULL, gh_id TEXT NOT NULL,
                fruit_tag TEXT, pollination_date TEXT, development_status TEXT NOT NULL DEFAULT 'DEVELOPING',
                harvested_at TEXT, weight_g REAL, grade TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS observations (
                observation_id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, complex_id TEXT NOT NULL, gh_id TEXT NOT NULL,
                plant_id TEXT, fruit_id TEXT, observed_at TEXT NOT NULL, metric TEXT NOT NULL,
                value REAL, text_value TEXT, unit TEXT, notes TEXT, observer TEXT, source TEXT, photo_ref TEXT,
                height_cm REAL, leaf_count INTEGER, fruit_count INTEGER, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cycles_complex_gh ON crop_cycles(complex_id,gh_id,updated_at);
            CREATE INDEX IF NOT EXISTS idx_plants_cycle ON plants(cycle_id);
            CREATE INDEX IF NOT EXISTS idx_fruits_cycle ON fruits(cycle_id);
            CREATE INDEX IF NOT EXISTS idx_observations_cycle_time ON observations(cycle_id,observed_at);
            CREATE INDEX IF NOT EXISTS idx_observations_gh_time ON observations(gh_id,observed_at);
            """)
        with self._lock, self._db:
            cols = {r[1] for r in self._db.execute("PRAGMA table_info(observations)").fetchall()}
            for name, definition in (("height_cm", "REAL"), ("leaf_count", "INTEGER"), ("fruit_count", "INTEGER")):
                if name not in cols:
                    self._db.execute(f"ALTER TABLE observations ADD COLUMN {name} {definition}")

    @staticmethod
    def _cycle(r: sqlite3.Row) -> dict[str, Any]:
        d = dict(r)
        return {
            "cycleId": d["cycle_id"], "complexId": d["complex_id"], "ghId": d["gh_id"], "status": d["status"],
            "plantingDate": d["planting_date"], "pollinationDate": d["pollination_date"], "expectedHarvestDate": d["expected_harvest_date"],
            "actualHarvestDate": d["actual_harvest_date"], "variety": d["variety"], "plantCount": d["plant_count"], "mortalityCount": d["mortality_count"],
            "notes": d["notes"], "yieldKg": d["yield_kg"], "grade": d["grade"], "source": d["source"], "sourceDeviceId": d["source_device_id"],
            "createdAt": d["created_at"], "updatedAt": d["updated_at"], "version": d["version"],
            "hst": _days_from(d["planting_date"]), "hsp": _days_from(d["pollination_date"]) if d["pollination_date"] else None,
        }

    @staticmethod
    def _plant(r: sqlite3.Row) -> dict[str, Any]:
        d=dict(r); return {"plantId":d["plant_id"],"cycleId":d["cycle_id"],"complexId":d["complex_id"],"ghId":d["gh_id"],"plantTag":d["plant_tag"],"position":d["position"],"plantedAt":d["planted_at"],"status":d["status"],"mortalityDate":d["mortality_date"],"mortalityReason":d["mortality_reason"],"notes":d["notes"],"createdAt":d["created_at"],"updatedAt":d["updated_at"]}

    @staticmethod
    def _fruit(r: sqlite3.Row) -> dict[str, Any]:
        d=dict(r); return {"fruitId":d["fruit_id"],"plantId":d["plant_id"],"cycleId":d["cycle_id"],"complexId":d["complex_id"],"ghId":d["gh_id"],"fruitTag":d["fruit_tag"],"pollinationDate":d["pollination_date"],"developmentStatus":d["development_status"],"harvestedAt":d["harvested_at"],"weightG":d["weight_g"],"grade":d["grade"],"notes":d["notes"],"createdAt":d["created_at"],"updatedAt":d["updated_at"]}

    @staticmethod
    def _observation(r: sqlite3.Row) -> dict[str, Any]:
        d=dict(r); return {"observationId":d["observation_id"],"cycleId":d["cycle_id"],"complexId":d["complex_id"],"ghId":d["gh_id"],"plantId":d["plant_id"],"fruitId":d["fruit_id"],"observedAt":d["observed_at"],"metric":d["metric"],"value":d["value"],"textValue":d["text_value"],"unit":d["unit"],"notes":d["notes"],"observer":d["observer"],"source":d["source"],"photoRef":d["photo_ref"],"heightCm":d["height_cm"],"leafCount":d["leaf_count"],"fruitCount":d["fruit_count"],"createdAt":d["created_at"]}

    def list_cycles(self, complex_id: str, gh_id: str | None = None, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        where=["complex_id=?"]; p:[Any]=[complex_id]
        if gh_id: where.append("gh_id=?"); p.append(gh_id)
        if status: where.append("status=?"); p.append(status)
        p.append(max(1,min(int(limit),500)))
        with self._lock: rows=self._db.execute(f"SELECT * FROM crop_cycles WHERE {' AND '.join(where)} ORDER BY planting_date DESC, cycle_id DESC LIMIT ?",p).fetchall()
        return [self._cycle(r) for r in rows]

    def get_cycle(self, cycle_id: str) -> dict[str, Any] | None:
        with self._lock: r=self._db.execute("SELECT * FROM crop_cycles WHERE cycle_id=?",(cycle_id,)).fetchone()
        return self._cycle(r) if r else None

    def current_cycle(self, complex_id: str, gh_id: str) -> dict[str, Any] | None:
        with self._lock: r=self._db.execute("SELECT * FROM crop_cycles WHERE complex_id=? AND gh_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1",(complex_id,gh_id)).fetchone()
        return self._cycle(r) if r else None

    def save_cycle(self, data: dict[str, Any], cycle_id: str | None = None) -> dict[str, Any]:
        cid=cycle_id or str(data.get("cycleId") or _id("cycle")); now=_now(); current=self.get_cycle(cid) or {}
        def pick(key: str, alt: str | None = None):
            return data.get(key, data.get(alt, current.get(key))) if alt else data.get(key,current.get(key))
        row={"cycle_id":cid,"complex_id":str(data.get("complexId") or current.get("complexId") or ""),"gh_id":str(data.get("ghId") or current.get("ghId") or ""),"status":str(data.get("status") or current.get("status") or "ACTIVE"),
             "planting_date":pick("plantingDate","tanggalTanam"),"pollination_date":pick("pollinationDate","tanggalPolinasi"),"expected_harvest_date":pick("expectedHarvestDate"),"actual_harvest_date":pick("actualHarvestDate","harvestDate"),
             "variety":pick("variety"),"plant_count":int(data.get("plantCount",current.get("plantCount",0)) or 0),"mortality_count":int(data.get("mortalityCount",current.get("mortalityCount",0)) or 0),"notes":pick("notes"),
             "yield_kg":float(data["yieldKg"]) if data.get("yieldKg") is not None else current.get("yieldKg"),"grade":pick("grade"),"source":pick("source") or "BACKEND_RESEARCH", "source_device_id":pick("sourceDeviceId"),
             "created_at":current.get("createdAt") or now,"updated_at":now,"version":int(current.get("version",0))+1}
        if not row["complex_id"] or not row["gh_id"]: raise ValueError("complexId and ghId are required")
        if row["status"] == "ACTIVE":
            with self._lock:
                active = self._db.execute("SELECT cycle_id FROM crop_cycles WHERE complex_id=? AND gh_id=? AND status='ACTIVE' AND cycle_id<>? LIMIT 1", (row["complex_id"], row["gh_id"], cid)).fetchone()
            if active: raise ValueError("An active crop cycle already exists for this greenhouse")
        if row["pollination_date"] and row["planting_date"] and str(row["pollination_date"])[:10] < str(row["planting_date"])[:10]:
            raise ValueError("pollinationDate cannot precede plantingDate")
        if row["actual_harvest_date"] and row["planting_date"] and str(row["actual_harvest_date"])[:10] < str(row["planting_date"])[:10]:
            raise ValueError("actualHarvestDate cannot precede plantingDate")
        vals=tuple(row[k] for k in ("cycle_id","complex_id","gh_id","status","planting_date","pollination_date","expected_harvest_date","actual_harvest_date","variety","plant_count","mortality_count","notes","yield_kg","grade","source","source_device_id","created_at","updated_at","version"))
        with self._lock,self._db:
            self._db.execute("""INSERT INTO crop_cycles(cycle_id,complex_id,gh_id,status,planting_date,pollination_date,expected_harvest_date,actual_harvest_date,variety,plant_count,mortality_count,notes,yield_kg,grade,source,source_device_id,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cycle_id) DO UPDATE SET status=excluded.status,planting_date=excluded.planting_date,pollination_date=excluded.pollination_date,expected_harvest_date=excluded.expected_harvest_date,actual_harvest_date=excluded.actual_harvest_date,variety=excluded.variety,plant_count=excluded.plant_count,mortality_count=excluded.mortality_count,notes=excluded.notes,yield_kg=excluded.yield_kg,grade=excluded.grade,source=excluded.source,source_device_id=excluded.source_device_id,updated_at=excluded.updated_at,version=excluded.version""",vals)
            r=self._db.execute("SELECT * FROM crop_cycles WHERE cycle_id=?",(cid,)).fetchone()
        return self._cycle(r)

    def upsert_cycle_from_device(self,payload:dict[str,Any],complex_id:str,device_id:str|None=None)->dict[str,Any]:
        h=payload.get("lastHarvestSummary") or {}
        return self.save_cycle({"cycleId":payload.get("cycleId"),"complexId":complex_id,"ghId":payload.get("ghId"),"status":payload.get("status"),"tanggalTanam":payload.get("tanggalTanam"),"tanggalPolinasi":payload.get("tanggalPolinasi"),"variety":payload.get("variety"),"plantCount":payload.get("plantCount"),"notes":payload.get("notes"),"harvestDate":h.get("harvestDate"),"yieldKg":h.get("yieldKg"),"grade":h.get("grade"),"source":"ESP32","sourceDeviceId":device_id},payload.get("cycleId"))

    def list_plants(self,cycle_id:str|None=None,gh_id:str|None=None,limit:int=1000)->list[dict[str,Any]]:
        where=[];p=[]
        if cycle_id:where.append("cycle_id=?");p.append(cycle_id)
        if gh_id:where.append("gh_id=?");p.append(gh_id)
        p.append(max(1,min(int(limit),2000)));sql="SELECT * FROM plants"+(" WHERE "+" AND ".join(where) if where else "")+" ORDER BY plant_tag,plant_id LIMIT ?"
        with self._lock:rows=self._db.execute(sql,p).fetchall()
        return [self._plant(r) for r in rows]

    def save_plant(self,data:dict[str,Any],plant_id:str|None=None)->dict[str,Any]:
        pid=plant_id or str(data.get("plantId") or _id("plant"));cycle=self.get_cycle(str(data.get("cycleId") or ""));
        if not cycle:raise ValueError("cycleId must reference an existing cycle")
        tag=str(data.get("plantTag") or data.get("tag") or pid).strip()
        if not tag: raise ValueError("plantTag is required")
        with self._lock:
            dup=self._db.execute("SELECT plant_id FROM plants WHERE cycle_id=? AND plant_tag=? AND plant_id<>?",(cycle["cycleId"],tag,pid)).fetchone()
        if dup: raise ValueError("plantTag must be unique within a crop cycle")
        status=str(data.get("status") or "ALIVE").upper()
        if status not in {"ALIVE","DEAD","MORTALITY","REMOVED"}: raise ValueError("unsupported plant status")
        if status in {"DEAD","MORTALITY","REMOVED"} and not data.get("mortalityDate"): data["mortalityDate"]=_now()
        now=_now();row={"plant_id":pid,"cycle_id":cycle["cycleId"],"complex_id":cycle["complexId"],"gh_id":cycle["ghId"],"plant_tag":tag,"position":data.get("position"),"planted_at":data.get("plantedAt") or cycle.get("plantingDate"),"status":status,"mortality_date":data.get("mortalityDate"),"mortality_reason":data.get("mortalityReason"),"notes":data.get("notes"),"created_at":now,"updated_at":now}
        with self._lock,self._db:
            self._db.execute("""INSERT INTO plants(plant_id,cycle_id,complex_id,gh_id,plant_tag,position,planted_at,status,mortality_date,mortality_reason,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(plant_id) DO UPDATE SET plant_tag=excluded.plant_tag,position=excluded.position,planted_at=excluded.planted_at,status=excluded.status,mortality_date=excluded.mortality_date,mortality_reason=excluded.mortality_reason,notes=excluded.notes,updated_at=excluded.updated_at""",tuple(row.values()))
            r=self._db.execute("SELECT * FROM plants WHERE plant_id=?",(pid,)).fetchone()
        self._sync_cycle_counts(cycle["cycleId"]);return self._plant(r)

    def _sync_cycle_counts(self,cycle_id:str)->None:
        with self._lock,self._db:
            total=self._db.execute("SELECT COUNT(*) FROM plants WHERE cycle_id=?",(cycle_id,)).fetchone()[0];dead=self._db.execute("SELECT COUNT(*) FROM plants WHERE cycle_id=? AND UPPER(status) IN ('DEAD','MORTALITY','REMOVED')",(cycle_id,)).fetchone()[0]
            self._db.execute("UPDATE crop_cycles SET plant_count=?,mortality_count=?,updated_at=? WHERE cycle_id=?",(total,dead,_now(),cycle_id))

    def list_fruits(self,cycle_id:str|None=None,gh_id:str|None=None,limit:int=2000)->list[dict[str,Any]]:
        where=[];p=[]
        if cycle_id:where.append("cycle_id=?");p.append(cycle_id)
        if gh_id:where.append("gh_id=?");p.append(gh_id)
        p.append(max(1,min(int(limit),3000)));sql="SELECT * FROM fruits"+(" WHERE "+" AND ".join(where) if where else "")+" ORDER BY fruit_tag,fruit_id LIMIT ?"
        with self._lock:rows=self._db.execute(sql,p).fetchall()
        return [self._fruit(r) for r in rows]

    def save_fruit(self,data:dict[str,Any],fruit_id:str|None=None)->dict[str,Any]:
        fid=fruit_id or str(data.get("fruitId") or _id("fruit"));plant_id=str(data.get("plantId") or "")
        with self._lock:pr=self._db.execute("SELECT * FROM plants WHERE plant_id=?",(plant_id,)).fetchone()
        if not pr:raise ValueError("plantId must reference an existing plant")
        p=dict(pr); tag=data.get("fruitTag")
        if tag is not None:
            tag=str(tag).strip() or None
            if tag:
                with self._lock:
                    dup=self._db.execute("SELECT fruit_id FROM fruits WHERE plant_id=? AND fruit_tag=? AND fruit_id<>?",(p["plant_id"],tag,fid)).fetchone()
                if dup: raise ValueError("fruitTag must be unique within a plant")
        weight=float(data["weightG"]) if data.get("weightG") is not None else None
        if weight is not None and weight < 0: raise ValueError("weightG cannot be negative")
        now=_now();row={"fruit_id":fid,"plant_id":p["plant_id"],"cycle_id":p["cycle_id"],"complex_id":p["complex_id"],"gh_id":p["gh_id"],"fruit_tag":tag,"pollination_date":data.get("pollinationDate"),"development_status":str(data.get("developmentStatus") or "DEVELOPING").upper(),"harvested_at":data.get("harvestedAt"),"weight_g":weight,"grade":data.get("grade"),"notes":data.get("notes"),"created_at":now,"updated_at":now}
        with self._lock,self._db:
            self._db.execute("""INSERT INTO fruits(fruit_id,plant_id,cycle_id,complex_id,gh_id,fruit_tag,pollination_date,development_status,harvested_at,weight_g,grade,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fruit_id) DO UPDATE SET fruit_tag=excluded.fruit_tag,pollination_date=excluded.pollination_date,development_status=excluded.development_status,harvested_at=excluded.harvested_at,weight_g=excluded.weight_g,grade=excluded.grade,notes=excluded.notes,updated_at=excluded.updated_at""",tuple(row.values()));r=self._db.execute("SELECT * FROM fruits WHERE fruit_id=?",(fid,)).fetchone()
        return self._fruit(r)

    def list_observations(self,cycle_id:str|None=None,gh_id:str|None=None,plant_id:str|None=None,fruit_id:str|None=None,limit:int=2000)->list[dict[str,Any]]:
        where=[];p=[]
        for key,val in (("cycle_id",cycle_id),("gh_id",gh_id),("plant_id",plant_id),("fruit_id",fruit_id)):
            if val:where.append(key+"=?");p.append(val)
        p.append(max(1,min(int(limit),3000)));sql="SELECT * FROM observations"+(" WHERE "+" AND ".join(where) if where else "")+" ORDER BY observed_at DESC,observation_id DESC LIMIT ?"
        with self._lock:rows=self._db.execute(sql,p).fetchall()
        return [self._observation(r) for r in rows]

    def save_observation(self,data:dict[str,Any],observation_id:str|None=None)->dict[str,Any]:
        oid=observation_id or str(data.get("observationId") or _id("obs"));cycle_id=str(data.get("cycleId") or "");cycle=self.get_cycle(cycle_id)
        if not cycle and data.get("ghId"):cycle=self.current_cycle(str(data.get("complexId") or ""),str(data["ghId"]))
        if not cycle:raise ValueError("cycleId or an active GH cycle is required")
        val=data.get("value")
        if val is not None:
            try:val=float(val)
            except (TypeError,ValueError):val=None
        plant_id=data.get("plantId"); fruit_id=data.get("fruitId")
        if plant_id:
            with self._lock: pr=self._db.execute("SELECT cycle_id FROM plants WHERE plant_id=?",(str(plant_id),)).fetchone()
            if not pr or pr["cycle_id"]!=cycle["cycleId"]: raise ValueError("plantId must belong to the observation cycle")
        if fruit_id:
            with self._lock: fr=self._db.execute("SELECT cycle_id FROM fruits WHERE fruit_id=?",(str(fruit_id),)).fetchone()
            if not fr or fr["cycle_id"]!=cycle["cycleId"]: raise ValueError("fruitId must belong to the observation cycle")
        if val is not None and val < 0 and str(data.get("metric") or "").lower() in {"height","height_cm","leaf_count","fruit_count"}: raise ValueError("observation value cannot be negative")
        row={"observation_id":oid,"cycle_id":cycle["cycleId"],"complex_id":cycle["complexId"],"gh_id":cycle["ghId"],"plant_id":plant_id,"fruit_id":fruit_id,"observed_at":str(data.get("observedAt") or _now()),"metric":str(data.get("metric") or "plant_check"),"value":val,"text_value":data.get("textValue"),"unit":data.get("unit"),"notes":data.get("notes"),"observer":data.get("observer"),"source":data.get("source") or "WEB","photo_ref":data.get("photoRef"),"height_cm":float(data["heightCm"]) if data.get("heightCm") is not None else None,"leaf_count":int(data["leafCount"]) if data.get("leafCount") is not None else None,"fruit_count":int(data["fruitCount"]) if data.get("fruitCount") is not None else None,"created_at":_now()}
        with self._lock,self._db:
            self._db.execute("""INSERT INTO observations(observation_id,cycle_id,complex_id,gh_id,plant_id,fruit_id,observed_at,metric,value,text_value,unit,notes,observer,source,photo_ref,height_cm,leaf_count,fruit_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(observation_id) DO UPDATE SET observed_at=excluded.observed_at,metric=excluded.metric,value=excluded.value,text_value=excluded.text_value,unit=excluded.unit,notes=excluded.notes,observer=excluded.observer,source=excluded.source,photo_ref=excluded.photo_ref,height_cm=excluded.height_cm,leaf_count=excluded.leaf_count,fruit_count=excluded.fruit_count""",tuple(row.values()));r=self._db.execute("SELECT * FROM observations WHERE observation_id=?",(oid,)).fetchone()
        return self._observation(r)

    def delete_observation(self,observation_id:str)->bool:
        with self._lock,self._db:return self._db.execute("DELETE FROM observations WHERE observation_id=?",(observation_id,)).rowcount>0

    def summary_for_gh(self,complex_id:str,gh_id:str)->dict[str,Any]:
        current=self.current_cycle(complex_id,gh_id);cycles=self.list_cycles(complex_id,gh_id)
        cycle=current or (cycles[0] if cycles else None)
        plants=self.list_plants(cycle["cycleId"] if cycle else None,gh_id);fruits=self.list_fruits(cycle["cycleId"] if cycle else None,gh_id);obs=self.list_observations(cycle["cycleId"] if cycle else None,gh_id,limit=100)
        heights=[x["heightCm"] for x in obs if x.get("heightCm") is not None]
        return {"complexId":complex_id,"ghId":gh_id,"currentCycle":current,"cycles":cycles,"plants":plants,"fruits":fruits,"recentObservations":obs[:10],"plantStats":{"total":len(plants),"alive":sum(1 for x in plants if str(x.get("status")).upper()=="ALIVE"),"dead":sum(1 for x in plants if str(x.get("status")).upper() in {"DEAD","MORTALITY","REMOVED"}),"avgHeightCm":sum(heights)/len(heights) if heights else 0,"totalFruits":len(fruits)}}

    def enrich_greenhouse(self,greenhouse:dict[str,Any])->dict[str,Any]:
        summary=self.summary_for_gh(str(greenhouse.get("complexId")),str(greenhouse.get("id")));out=dict(greenhouse)
        out["research"]={"currentCycle":summary["currentCycle"],"cycles":summary["cycles"],"plants":summary["plants"],"fruits":summary["fruits"],"recentObservations":summary["recentObservations"]}
        stats=summary["plantStats"];out["plants"]={**out.get("plants",{}),"total":stats["total"],"tracked":stats["total"],"alive":stats["alive"],"dead":stats["dead"],"avgHeightCm":stats["avgHeightCm"],"totalFruits":stats["totalFruits"],"latestObservation":summary["recentObservations"][0]["observedAt"] if summary["recentObservations"] else "—"}
        c=summary["currentCycle"]
        if c:out["cropCycle"]={"status":c["status"],"tanggalTanam":c.get("plantingDate"),"tanggalPolinasi":c.get("pollinationDate"),"variety":c.get("variety"),"plantCount":c.get("plantCount"),"notes":c.get("notes"),"hst":c.get("hst"),"hsp":c.get("hsp"),"cycleId":c.get("cycleId"),"lastHarvestSummary":None}
        return out

    def analysis(self,complex_id:str,cycle_id:str,history_store:Any,fertigation_repo:Any,calibration_repo:Any)->dict[str,Any]:
        cycle=self.get_cycle(cycle_id)
        if not cycle or cycle["complexId"]!=complex_id:raise ValueError("cycle not found")
        plants=self.list_plants(cycle_id);fruits=self.list_fruits(cycle_id);obs=self.list_observations(cycle_id)
        start=cycle.get("plantingDate");end=cycle.get("actualHarvestDate") or _now();tele=history_store.query_telemetry_window(complex_id,cycle["ghId"],start,end);events=history_store.query_events_window(complex_id,cycle["ghId"],start,end)
        runs=[]
        from datetime import datetime, timezone
        def _timeline_value(value):
            if value is None:
                return None
            if isinstance(value, (int, float)):
                return datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc).isoformat().replace("+00:00", "Z")
            return str(value)
        for run in fertigation_repo.list(complex_id,cycle["ghId"]):
            v=run.get("startedAt") or run.get("startTimestamp") or run.get("createdAt") or run.get("startTimestampMs")
            normalized=_timeline_value(v)
            if normalized and (not start or normalized>=str(start)) and normalized<=str(end):runs.append(run)
        cals=[{"calibrationId":r.calibrationId,"componentId":r.componentId,"version":r.version,"type":r.calibrationType,"state":r.state} for r in calibration_repo.history(complex_id=complex_id)]
        recipes=sorted({str(r.get("recipeId")) for r in runs if r.get("recipeId")})
        return {"cycle":cycle,"counts":{"plants":len(plants),"fruits":len(fruits),"observations":len(obs),"telemetrySamples":len(tele),"events":len(events),"fertigationRuns":len(runs)},"plants":plants,"fruits":fruits,"observations":obs,"telemetry":tele,"events":events,"fertigationRuns":runs,"calibrations":cals,"recipeIds":recipes,"relationships":{"telemetryWindow":[start,end],"fertigationRuns":True,"recipeReferences":recipes,"calibrationReferences":cals}}


RESEARCH_STORE=ResearchStore()
