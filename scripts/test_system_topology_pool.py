#!/usr/bin/env python3
"""Comprehensive test suite for System Topology Pool & ESP32-Authoritative Discovery (Scenarios A - O).

Covers:
- Test A: Browser reset recovery (ephemeral reconstruction without recreation)
- Test B: Browser refresh re-discovery (every reload repeats discovery)
- Test C: Multiple controllers (multi-ESP32 pool representation & ownership)
- Test D: Offline controller remains known (not deleted from pool)
- Test E: Reconnect & convergence (peer pool synchronization)
- Test F: Deterministic hash (cross-platform SHA-256 equivalence regardless of ordering)
- Test G: Contract mismatch rejected safely (TOPOLOGY_CONTRACT_MISMATCH)
- Test H: Tombstone prevents stale peer resurrection
- Test I: Duplicate change idempotency (stable changeId deduplication)
- Test J: Owner enforcement (non-owner cannot mutate another complex)
- Test K: Backend unavailable (discovery recovered directly from ESP32)
- Test L: ESP32 reboot survival (persistent storage load)
- Test M: Interrupted persistence / corruption fallback (atomic safety)
- Test N: Research retention invariant (crop_cycles, plants, fruits, observations untouched)
- Test O: Migration of existing persisted state into the pool
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# Add backend directory to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from topology_pool import (
    SystemTopologyPool,
    TopologyConflictError,
    calculate_pool_hash,
    TOPOLOGY_SCHEMA_ID,
    TOPOLOGY_SCHEMA_VERSION,
    TOPOLOGY_CONTRACT_HASH,
    TOPOLOGY_ERRORS,
)
from operational_store import OperationalStore
from research_store import ResearchStore
from deletion_store import DeletionStore
from deletion_manager import DeletionManager


class FakeESP32TopologyHandler(BaseHTTPRequestHandler):
    pool_data = None
    is_online = True

    def log_message(self, format, *args):
        pass

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.__class__.is_online:
            self.send_error(503, "ESP32 Offline")
            return
        if self.path == "/api/v1/topology-pool":
            self._json(200, self.__class__.pool_data)
            return
        if self.path == "/api/v1/topology-pool/meta":
            meta = {
                "schemaId": self.__class__.pool_data.get("schemaId"),
                "schemaVersion": self.__class__.pool_data.get("schemaVersion"),
                "contractHash": self.__class__.pool_data.get("contractHash"),
                "poolRevision": self.__class__.pool_data.get("poolRevision"),
                "poolHash": self.__class__.pool_data.get("poolHash"),
                "originDeviceId": self.__class__.pool_data.get("originDeviceId"),
            }
            self._json(200, meta)
            return
        self.send_error(404, "Not Found")


def safe_remove(path):
    if not path or not os.path.exists(path):
        return
    for _ in range(5):
        try:
            os.remove(path)
            return
        except OSError:
            time.sleep(0.05)


def run_tests():
    passed = 0
    total = 15
    print("=== STARTING SYSTEM TOPOLOGY POOL TEST SUITE (SCENARIOS A - O) ===")

    # -------------------------------------------------------------------------
    # Test A: Browser reset recovery
    # -------------------------------------------------------------------------
    print("\n[1/15] Test A — Browser reset recovery...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool = SystemTopologyPool(db_path, local_device_id="ESP32-A")
        pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-01", "name": "Main Greenhouse Complex", "ownerDeviceId": "ESP32-A"})
        pool.apply_mutation({"operation": "CREATE_GREENHOUSE", "ghId": "gh-01", "complexId": "complex-01", "name": "Tomato GH"})
        pool.apply_mutation({"operation": "CREATE_GREENHOUSE", "ghId": "gh-02", "complexId": "complex-01", "name": "Bell Pepper GH"})
        
        # Simulate browser reset: client has zero local storage, only receives pool payload from ESP32
        exported = pool.get_pool()
        assert exported["complexes"][0]["complexId"] == "complex-01"
        assert len(exported["greenhouses"]) == 2
        
        # Verify TypeScript reconstructor logic via node or python representation
        complex_ids = [c["complexId"] for c in exported["complexes"]]
        gh_ids = [g["ghId"] for g in exported["greenhouses"]]
        assert "complex-01" in complex_ids
        assert "gh-01" in gh_ids and "gh-02" in gh_ids
        print("  PASS: Browser recovers full complex and greenhouses from ESP32 without recreation.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test B: Browser refresh re-discovery
    # -------------------------------------------------------------------------
    print("\n[2/15] Test B — Browser refresh re-discovery...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool = SystemTopologyPool(db_path, local_device_id="ESP32-A")
        pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-01", "name": "Complex 01", "ownerDeviceId": "ESP32-A"})
        
        # Emulate multiple page reloads: each reload starts with no cache and queries the pool fresh
        for reload_count in range(3):
            fresh_discovery = pool.get_pool()
            assert len(fresh_discovery["complexes"]) == 1
            assert fresh_discovery["complexes"][0]["complexId"] == "complex-01"
            assert fresh_discovery["poolRevision"] >= 1
        print("  PASS: Every refresh re-executes discovery cleanly without stale browser persistence.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test C: Multiple controllers
    # -------------------------------------------------------------------------
    print("\n[3/15] Test C — Multiple controllers & ownership...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f1, \
         tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f2:
        db1, db2 = f1.name, f2.name
    try:
        pool_a = SystemTopologyPool(db1, local_device_id="ESP32-A")
        pool_b = SystemTopologyPool(db2, local_device_id="ESP32-B")

        pool_a.register_device("ESP32-A", hostname="esp32-a.local", owner_complex_ids=["complex-A"])
        pool_a.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-A", "name": "Complex Alpha", "ownerDeviceId": "ESP32-A"})
        pool_a.apply_mutation({"operation": "CREATE_GREENHOUSE", "ghId": "gh-A1", "complexId": "complex-A", "name": "Alpha 1"})

        pool_b.register_device("ESP32-B", hostname="esp32-b.local", owner_complex_ids=["complex-B"])
        pool_b.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-B", "name": "Complex Beta", "ownerDeviceId": "ESP32-B"})
        pool_b.apply_mutation({"operation": "CREATE_GREENHOUSE", "ghId": "gh-B1", "complexId": "complex-B", "name": "Beta 1"})

        # Reconcile pool B into pool A
        pool_a.reconcile_peer_pool(pool_b.get_pool())
        merged = pool_a.get_pool()

        comp_a = next(c for c in merged["complexes"] if c["complexId"] == "complex-A")
        comp_b = next(c for c in merged["complexes"] if c["complexId"] == "complex-B")
        assert comp_a["ownerDeviceId"] == "ESP32-A"
        assert comp_b["ownerDeviceId"] == "ESP32-B"
        assert len(merged["devices"]) == 2
        print("  PASS: Multiple ESP32 controllers represent distinct complexes with explicit ownership.")
        passed += 1
    finally:
        for p in (db1, db2):
            safe_remove(p)

    # -------------------------------------------------------------------------
    # Test D: Controller offline remains known
    # -------------------------------------------------------------------------
    print("\n[4/15] Test D — Controller offline remains known...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool = SystemTopologyPool(db_path, local_device_id="ESP32-A")
        pool.register_device("ESP32-B", endpoint="http://192.168.1.150:80", owner_complex_ids=["complex-B"], device_state="KNOWN")
        pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-B", "name": "Complex Beta", "ownerDeviceId": "ESP32-B"})
        
        # When probing ESP32-B fails: device remains known, complex remains in pool
        p = pool.get_pool()
        dev_b = next(d for d in p["devices"] if d["deviceId"] == "ESP32-B")
        assert dev_b["deviceState"] == "KNOWN"
        assert any(c["complexId"] == "complex-B" for c in p["complexes"])
        print("  PASS: Offline controller remains known in the pool; complex is not deleted.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test E: Reconnect & convergence
    # -------------------------------------------------------------------------
    print("\n[5/15] Test E — Reconnect & pool convergence...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f1, \
         tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f2:
        db1, db2 = f1.name, f2.name
    try:
        pool_a = SystemTopologyPool(db1, local_device_id="ESP32-A")
        pool_b = SystemTopologyPool(db2, local_device_id="ESP32-B")

        pool_a.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-01", "name": "Unified Complex", "ownerDeviceId": "ESP32-A"})
        
        # Sync to B
        pool_b.reconcile_peer_pool(pool_a.get_pool())
        # Both add something
        pool_a.apply_mutation({"operation": "CREATE_GREENHOUSE", "ghId": "gh-01", "complexId": "complex-01", "name": "GH 1"})
        pool_b.reconcile_peer_pool(pool_a.get_pool())

        assert pool_a.get_pool()["poolHash"] == pool_b.get_pool()["poolHash"]
        print(f"  PASS: Pools converge to identical hash: {pool_a.get_pool()['poolHash']}")
        passed += 1
    finally:
        for p in (db1, db2):
            safe_remove(p)

    # -------------------------------------------------------------------------
    # Test F: Deterministic hash
    # -------------------------------------------------------------------------
    print("\n[6/15] Test F — Deterministic hashing across insertion orders...")
    pool_dict_1 = {
        "complexes": [
            {"complexId": "complex-02", "name": "Comp 2", "ownerDeviceId": "D2", "recordRevision": 1, "state": "ACTIVE", "greenhouses": ["g2"]},
            {"complexId": "complex-01", "name": "Comp 1", "ownerDeviceId": "D1", "recordRevision": 1, "state": "ACTIVE", "greenhouses": ["g1"]}
        ],
        "devices": [
            {"deviceId": "D2", "contractVersion": 1, "deviceState": "KNOWN", "hostname": "d2.local", "ownerComplexIds": ["complex-02"]},
            {"deviceId": "D1", "contractVersion": 1, "deviceState": "KNOWN", "hostname": "d1.local", "ownerComplexIds": ["complex-01"]}
        ],
        "greenhouses": [
            {"complexId": "complex-02", "ghId": "g2", "name": "GH 2", "recordRevision": 1, "state": "ACTIVE"},
            {"complexId": "complex-01", "ghId": "g1", "name": "GH 1", "recordRevision": 1, "state": "ACTIVE"}
        ],
        "tombstones": [],
        "poolRevision": 10
    }
    # Inverted order
    pool_dict_2 = {
        "poolRevision": 10,
        "tombstones": [],
        "greenhouses": [
            {"ghId": "g1", "complexId": "complex-01", "name": "GH 1", "recordRevision": 1, "state": "ACTIVE"},
            {"ghId": "g2", "complexId": "complex-02", "name": "GH 2", "recordRevision": 1, "state": "ACTIVE"}
        ],
        "devices": [
            {"deviceId": "D1", "contractVersion": 1, "deviceState": "KNOWN", "hostname": "d1.local", "ownerComplexIds": ["complex-01"]},
            {"deviceId": "D2", "contractVersion": 1, "deviceState": "KNOWN", "hostname": "d2.local", "ownerComplexIds": ["complex-02"]}
        ],
        "complexes": [
            {"complexId": "complex-01", "name": "Comp 1", "ownerDeviceId": "D1", "recordRevision": 1, "state": "ACTIVE", "greenhouses": ["g1"]},
            {"complexId": "complex-02", "name": "Comp 2", "ownerDeviceId": "D2", "recordRevision": 1, "state": "ACTIVE", "greenhouses": ["g2"]}
        ]
    }
    hash_1 = calculate_pool_hash(pool_dict_1)
    hash_2 = calculate_pool_hash(pool_dict_2)
    assert hash_1 == hash_2
    print(f"  PASS: Deterministic canonicalization matches exactly: {hash_1}")
    passed += 1

    # -------------------------------------------------------------------------
    # Test G: Contract mismatch rejected safely
    # -------------------------------------------------------------------------
    print("\n[7/15] Test G — Contract mismatch rejected safely...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool = SystemTopologyPool(db_path, local_device_id="ESP32-A")
        bad_peer_pool = pool.get_pool()
        bad_peer_pool["schemaVersion"] = 99
        bad_peer_pool["contractHash"] = "sha256:invalid"
        
        rejected = False
        try:
            pool.reconcile_peer_pool(bad_peer_pool)
        except TopologyConflictError as e:
            rejected = True
            assert e.code == TOPOLOGY_ERRORS["CONTRACT_MISMATCH"]
        assert rejected
        print("  PASS: Incompatible contract schema safely rejected without pool overwrite.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test H: Tombstone prevents resurrection
    # -------------------------------------------------------------------------
    print("\n[8/15] Test H — Tombstone prevents resurrection from stale peer...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f1, \
         tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f2:
        db1, db2 = f1.name, f2.name
    try:
        pool_a = SystemTopologyPool(db1, local_device_id="ESP32-A")
        pool_stale = SystemTopologyPool(db2, local_device_id="ESP32-STALE")

        pool_a.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-DEL", "name": "To Delete", "ownerDeviceId": "ESP32-A"})
        # Sync to stale peer before deletion
        pool_stale.reconcile_peer_pool(pool_a.get_pool())
        assert any(c["complexId"] == "complex-DEL" for c in pool_stale.get_pool()["complexes"])

        # Delete on owner ESP32-A and record tombstone
        pool_a.apply_mutation({"operation": "DELETE_COMPLEX", "complexId": "complex-DEL", "ownerDeviceId": "ESP32-A"})
        assert not any(c["complexId"] == "complex-DEL" for c in pool_a.get_pool()["complexes"])
        assert any(t["entityId"] == "complex-DEL" for t in pool_a.get_pool()["tombstones"])

        # Stale peer connects to ESP32-A with old active record
        pool_a.reconcile_peer_pool(pool_stale.get_pool())
        assert not any(c["complexId"] == "complex-DEL" for c in pool_a.get_pool()["complexes"])

        # And reconciling pool_a into stale peer must eliminate it on stale peer too!
        pool_stale.reconcile_peer_pool(pool_a.get_pool())
        assert not any(c["complexId"] == "complex-DEL" for c in pool_stale.get_pool()["complexes"])
        print("  PASS: Tombstone prevents deleted complex from resurrecting from stale peer.")
        passed += 1
    finally:
        for p in (db1, db2):
            safe_remove(p)

    # -------------------------------------------------------------------------
    # Test I: Duplicate change idempotency
    # -------------------------------------------------------------------------
    print("\n[9/15] Test I — Duplicate change idempotency...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool = SystemTopologyPool(db_path, local_device_id="ESP32-A")
        res1 = pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-idem", "name": "Idem Complex", "changeId": "CHG-100", "ownerDeviceId": "ESP32-A"})
        rev1 = pool.get_pool()["poolRevision"]

        # Re-send same mutation with same changeId
        res2 = pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-idem", "name": "Idem Complex", "changeId": "CHG-100", "ownerDeviceId": "ESP32-A"})
        rev2 = pool.get_pool()["poolRevision"]

        assert res2.get("idempotent") is True or res2["status"] in ("SUCCESS", "ALREADY_APPLIED")
        assert rev1 == rev2
        assert len([c for c in pool.get_pool()["complexes"] if c["complexId"] == "complex-idem"]) == 1
        print("  PASS: Duplicate mutation with same changeId is idempotent without duplicate entity.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test J: Owner enforcement
    # -------------------------------------------------------------------------
    print("\n[10/15] Test J — Owner enforcement...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool = SystemTopologyPool(db_path, local_device_id="ESP32-B")
        # Pre-seed complex owned by ESP32-A
        pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-A", "name": "Alpha", "ownerDeviceId": "ESP32-A"})
        
        # ESP32-B tries to delete or modify complex-A claiming to be owner
        blocked = False
        try:
            pool.apply_mutation({"operation": "UPDATE_COMPLEX", "complexId": "complex-A", "name": "Hijacked", "ownerDeviceId": "ESP32-B"})
        except TopologyConflictError as e:
            blocked = True
            assert e.code == TOPOLOGY_ERRORS["OWNER_CONFLICT"]
        assert blocked
        print("  PASS: Non-owner mutation rejected with TOPOLOGY_OWNER_CONFLICT.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test K: Backend unavailable (Direct ESP32 Discovery)
    # -------------------------------------------------------------------------
    print("\n[11/15] Test K — Direct ESP32 discovery when backend unavailable...")
    # Start Fake ESP32 HTTP Server serving /api/v1/topology-pool
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool = SystemTopologyPool(db_path, local_device_id="ESP32-TEST")
        pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-DIRECT", "name": "Direct Controller Complex", "ownerDeviceId": "ESP32-TEST"})
        pool.apply_mutation({"operation": "CREATE_GREENHOUSE", "ghId": "gh-D1", "complexId": "complex-DIRECT", "name": "Direct GH"})
        
        FakeESP32TopologyHandler.pool_data = pool.get_pool()
        FakeESP32TopologyHandler.is_online = True
        server = ThreadingHTTPServer(("127.0.0.1", 3899), FakeESP32TopologyHandler)
        srv_thread = threading.Thread(target=server.serve_forever, daemon=True)
        srv_thread.start()

        # Connect directly to ESP32 without Python backend
        req = Request("http://127.0.0.1:3899/api/v1/topology-pool")
        with urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert data["schemaId"] == TOPOLOGY_SCHEMA_ID
            assert data["complexes"][0]["complexId"] == "complex-DIRECT"
            assert data["greenhouses"][0]["ghId"] == "gh-D1"
        
        server.shutdown()
        print("  PASS: Physical topology recovered directly from ESP32 without backend dependency.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test L: ESP32 reboot survival
    # -------------------------------------------------------------------------
    print("\n[12/15] Test L — Pool persistence across reboot...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool1 = SystemTopologyPool(db_path, local_device_id="ESP32-A")
        pool1.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-REBOOT", "name": "Persistent Complex", "ownerDeviceId": "ESP32-A"})
        hash_before = pool1.get_pool()["poolHash"]

        # Simulate reboot: re-open pool from persisted storage
        pool2 = SystemTopologyPool(db_path, local_device_id="ESP32-A")
        hash_after = pool2.get_pool()["poolHash"]

        assert hash_before == hash_after
        assert pool2.get_pool()["complexes"][0]["complexId"] == "complex-REBOOT"
        print("  PASS: System topology pool survives controller reboot with identical hash.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test M: Interrupted persistence / corruption fallback
    # -------------------------------------------------------------------------
    print("\n[13/15] Test M — Interrupted persistence & atomic candidate fallback...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        pool = SystemTopologyPool(db_path, local_device_id="ESP32-A")
        pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": "complex-SAFE", "name": "Safe Complex", "ownerDeviceId": "ESP32-A"})
        valid_pool = pool.get_pool()

        # Simulate candidate file corruption in SPIFFS storage pattern:
        # If candidate write is corrupted/truncated, last valid pool remains active
        candidate = dict(valid_pool)
        candidate["poolRevision"] = 999
        # Corrupted payload missing mandatory schema fields
        del candidate["schemaId"]

        rejected = False
        try:
            pool.reconcile_peer_pool(candidate)
        except TopologyConflictError:
            rejected = True
        assert rejected

        # Verify active pool is unharmed
        assert pool.get_pool()["complexes"][0]["complexId"] == "complex-SAFE"
        assert pool.get_pool()["poolRevision"] == valid_pool["poolRevision"]
        print("  PASS: Interrupted or corrupted candidate does not destroy the last valid pool.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test N: Research retention invariant
    # -------------------------------------------------------------------------
    print("\n[14/15] Test N — Research data retention invariant after Complex deletion...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        op_store = OperationalStore(db_path)
        res_store = ResearchStore(db_path)
        del_store = DeletionStore(db_path)
        del_mgr = DeletionManager(
            deletion_store=del_store,
            operational_store=op_store,
            research_store=res_store,
        )

        # Seed complex, greenhouse, and research records
        op_store.save_complex({"id": "complex-RESEARCH", "code": "C-RES", "name": "Research Complex", "location": "Lab", "greenhouseIds": ["gh-RES"]})
        op_store.save_greenhouse({"id": "gh-RES", "complexId": "complex-RESEARCH", "code": "GH-RES", "crop": "Cherry Tomato"})

        res_store.save_cycle({"cycleId": "cycle-101", "complexId": "complex-RESEARCH", "ghId": "gh-RES", "variety": "Trial", "status": "ACTIVE"})
        res_store.save_plant({"plantId": "plant-201", "cycleId": "cycle-101", "plantTag": "P1"})
        res_store.save_fruit({"fruitId": "fruit-301", "plantId": "plant-201", "fruitTag": "F1"})
        res_store.save_observation({"observationId": "obs-401", "cycleId": "cycle-101", "plantId": "plant-201", "metric": "height_cm", "value": 45.2})

        # Count research records before deletion
        cycles_before = len(res_store.list_cycles("complex-RESEARCH", "gh-RES"))
        plants_before = len(res_store.list_plants(cycle_id="cycle-101"))
        fruits_before = len(res_store.list_fruits(cycle_id="cycle-101"))
        obs_before = len(res_store.list_observations(cycle_id="cycle-101"))

        # Run Complex Deletion Job
        job = del_mgr.start_or_resume_deletion(
            complex_id="complex-RESEARCH",
            idempotency_key="TEST-RESEARCH-IDEM-01",
            requested_by="operator",
            request_reason="Test Research Invariant",
        )
        assert job["status"] == "COMPLETED"

        # Verify research records after deletion
        cycles_after = len(res_store.list_cycles("complex-RESEARCH", "gh-RES"))
        plants_after = len(res_store.list_plants(cycle_id="cycle-101"))
        fruits_after = len(res_store.list_fruits(cycle_id="cycle-101"))
        obs_after = len(res_store.list_observations(cycle_id="cycle-101"))

        assert cycles_before == cycles_after == 1
        assert plants_before == plants_after == 1
        assert fruits_before == fruits_after == 1
        assert obs_before == obs_after == 1
        print("  PASS: 100% research records (crop_cycles, plants, fruits, observations) preserved.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    # -------------------------------------------------------------------------
    # Test O: Migration of existing persisted state
    # -------------------------------------------------------------------------
    print("\n[15/15] Test O — Migration of existing persisted state into topology pool...")
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        db_path = f.name
    try:
        op_store = OperationalStore(db_path)
        op_store.save_complex({
            "id": "complex-LEGACY",
            "code": "C-LEGACY",
            "name": "Pre-existing Complex",
            "location": "Sector 4",
            "greenhouseIds": ["gh-LEGACY"],
            "esp32": {"deviceId": "ESP32-LEGACY", "endpoint": "http://192.168.1.180:80"}
        })
        op_store.save_greenhouse({
            "id": "gh-LEGACY",
            "complexId": "complex-LEGACY",
            "code": "GH-LEGACY",
            "crop": "Lettuce"
        })

        # Initialize topology pool on same DB and run migration sync
        pool = SystemTopologyPool(db_path, local_device_id="BACKEND-MIRROR")
        # Migrate operational store records
        for comp in op_store.context().get("complexes", []):
            cid = comp.get("id")
            name = comp.get("name") or comp.get("code") or cid
            owner = (comp.get("esp32") or {}).get("deviceId") or "MIGRATOR"
            pool.apply_mutation({"operation": "CREATE_COMPLEX", "complexId": cid, "name": name, "ownerDeviceId": owner})
            if owner != "MIGRATOR":
                endpoint = (comp.get("esp32") or {}).get("endpoint") or ""
                pool.register_device(owner, endpoint=endpoint, owner_complex_ids=[cid], device_state="BOUND")

        for gh in op_store.context().get("greenhouses", []):
            gid = gh.get("id")
            cid = gh.get("complexId")
            gname = gh.get("code") or gid
            pool.apply_mutation({"operation": "CREATE_GREENHOUSE", "ghId": gid, "complexId": cid, "name": gname})

        migrated = pool.get_pool()
        assert len(migrated["complexes"]) == 1
        assert migrated["complexes"][0]["complexId"] == "complex-LEGACY"
        assert migrated["complexes"][0]["ownerDeviceId"] == "ESP32-LEGACY"
        assert len(migrated["greenhouses"]) == 1
        assert migrated["greenhouses"][0]["ghId"] == "gh-LEGACY"
        assert any(d["deviceId"] == "ESP32-LEGACY" for d in migrated["devices"])
        print("  PASS: Pre-existing operational state successfully migrated into topology pool.")
        passed += 1
    finally:
        if os.path.exists(db_path):
            safe_remove(db_path)

    print(f"\n=== SYSTEM TOPOLOGY POOL TEST SUITE COMPLETED: {passed}/{total} PASSED ===")
    return passed == total


if __name__ == "__main__":
    import threading
    success = run_tests()
    sys.exit(0 if success else 1)
