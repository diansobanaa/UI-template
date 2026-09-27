"""Automated regression test verifying the 1 Complex + 3 GH topology acceptance criteria,
tombstone enforcement, and research database quarantine.
"""
import json
import sqlite3
import urllib.request

BACKEND_URL = "http://127.0.0.1:8090"

def request_json(url: str, method: str = "GET", data: dict | None = None) -> dict:
    body = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))

def test_acceptance_flow():
    print("--- 1. Resetting Topology Pool & Operational Store ---")
    reset_res = request_json(f"{BACKEND_URL}/api/v1/topology-pool/reset", method="POST", data={})
    assert reset_res.get("status") == "RESET_SUCCESS", f"Reset failed: {reset_res}"
    
    pool = request_json(f"{BACKEND_URL}/api/v1/topology-pool")
    assert len(pool["complexes"]) == 0, "Expected 0 complexes after reset"
    assert len(pool["greenhouses"]) == 0, "Expected 0 greenhouses after reset"
    assert len(pool["tombstones"]) == 0, "Expected 0 tombstones after reset"
    print("[OK] Initial state clean (0 complexes, 0 greenhouses, 0 tombstones)")

    print("--- 2. Creating 1 Complex ---")
    c_res = request_json(f"{BACKEND_URL}/api/complexes", method="POST", data={
        "name": "Complex Test",
        "location": "Test Address 001"
    })
    c_id = c_res["id"]
    print(f"[OK] Created Complex: {c_id} ({c_res['name']})")

    print("--- 3. Editing Complex Name and Address ---")
    c_edit = request_json(f"{BACKEND_URL}/api/complexes/{c_id}", method="POST", data={
        "name": "Complex Test Renamed",
        "location": "Test Address 002"
    })
    assert c_edit["name"] == "Complex Test Renamed"
    assert c_edit["location"] == "Test Address 002"
    print("[OK] Complex updated to 'Complex Test Renamed' and 'Test Address 002'")

    print("--- 4. Creating 3 Greenhouses (GH-01, GH-02, GH-03) ---")
    gh1 = request_json(f"{BACKEND_URL}/api/complexes/{c_id}/greenhouses", method="POST", data={"crop": "Tomato"})
    gh2 = request_json(f"{BACKEND_URL}/api/complexes/{c_id}/greenhouses", method="POST", data={"crop": "Cucumber"})
    gh3 = request_json(f"{BACKEND_URL}/api/complexes/{c_id}/greenhouses", method="POST", data={"crop": "Bell Pepper"})
    assert gh1["id"] == "gh-01" and gh2["id"] == "gh-02" and gh3["id"] == "gh-03"
    print("[OK] Created 3 Greenhouses: gh-01 (Tomato), gh-02 (Cucumber), gh-03 (Bell Pepper)")

    print("--- 5. Editing GH-02 ---")
    gh2_edit = request_json(f"{BACKEND_URL}/api/greenhouses/gh-02", method="POST", data={
        "code": "GH-02 Renamed",
        "greenhouseTag": "GH-02 Renamed"
    })
    assert gh2_edit["code"] == "GH-02 Renamed"
    print("[OK] GH-02 updated to 'GH-02 Renamed'")

    print("--- 6. Deleting GH-03 and Verifying Tombstone ---")
    del_res = request_json(f"{BACKEND_URL}/api/greenhouses/gh-03", method="DELETE")
    assert del_res.get("deleted") is True
    print("[OK] Deleted GH-03")

    pool = request_json(f"{BACKEND_URL}/api/v1/topology-pool")
    assert len(pool["complexes"]) == 1, f"Expected 1 complex, got {len(pool['complexes'])}"
    assert len(pool["greenhouses"]) == 2, f"Expected 2 active greenhouses, got {len(pool['greenhouses'])}"
    active_gh_ids = [g["ghId"] for g in pool["greenhouses"]]
    assert "gh-01" in active_gh_ids and "gh-02" in active_gh_ids
    assert "gh-03" not in active_gh_ids

    tombstone_ids = [t["entityId"] for t in pool.get("tombstones", []) if t.get("entityType") == "GREENHOUSE"]
    assert "gh-03" in tombstone_ids, "Expected gh-03 tombstone in topology pool"
    print("[OK] Topology pool verified: 1 complex, 2 greenhouses, 1 tombstone (gh-03)")

    print("--- 7. Verifying Research Database Quarantine ---")
    db = sqlite3.connect("./agrotech_research.sqlite3")
    for table in ["crop_cycles", "plants", "fruits", "observations"]:
        count = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        assert count == 0, f"Table {table} count is {count}, expected 0!"
    db.close()
    print("[OK] Research database strictly untouched (all counts = 0)")

    print("\n=== ALL REGRESSION ACCEPTANCE CHECKS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    test_acceptance_flow()
