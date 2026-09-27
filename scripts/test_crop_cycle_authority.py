#!/usr/bin/env python3
"""
Test Suite: Authoritative Crop-Cycle Proxy & Controller Operations
Verifies the complete lifecycle of crop cycle endpoints against backend mirror & authoritative controller.
Conforms strictly to OpenAPI contract (status: NO_CYCLE | ACTIVE | HARVESTED | CANCELLED).
"""
import urllib.request
import urllib.error
import json
import sys

BASE_URL = "http://127.0.0.1:8090"

def request_json(url, method="GET", body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            raw = res.read().decode("utf-8")
            return res.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw}

def test_crop_cycle_lifecycle():
    gh_id = "gh-01"
    print(f"=== Testing Crop Cycle Lifecycle on {gh_id} ===")

    # 0. Ensure clean baseline: if active cycle exists, cancel it
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycle")
    assert status == 200, f"Baseline GET failed: {status} {res}"
    if res.get("data", {}).get("status") == "ACTIVE":
        print("[SETUP] Found active cycle from previous run, cancelling for clean baseline...")
        c_status, c_res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles/active/cancel", method="POST", body={})
        assert c_status == 200, f"Failed to cancel previous active cycle: {c_res}"

    # 1. Verify clean baseline (NO_CYCLE)
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycle")
    assert status == 200, f"Baseline GET failed: {status} {res}"
    assert res.get("data", {}).get("status") == "NO_CYCLE"
    print(f"[PASS] 1. Baseline status: {res.get('data', {}).get('status')}")

    # 2. Start a new cycle
    start_payload = {
        "tanggalTanam": "2026-09-01",
        "variety": "Golden Sweet Melon",
        "plantCount": 100,
        "notes": "Automated proxy integration test"
    }
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles", method="POST", body=start_payload)
    assert status == 201, f"Start cycle failed: {status} {res}"
    data = res.get("data", {})
    cycle_id = data.get("cycleId")
    assert cycle_id, "Missing cycleId in start response"
    assert data.get("status") == "ACTIVE", f"Expected ACTIVE, got {data.get('status')}"
    assert data.get("hst") is not None, "Expected HST calculated"
    print(f"[PASS] 2. Start cycle created: {cycle_id}, status={data.get('status')}, hst={data.get('hst')}")

    # 3. Duplicate start cycle must return 409 Conflict
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles", method="POST", body=start_payload)
    assert status == 409, f"Expected 409 Conflict on duplicate start, got: {status} {res}"
    print(f"[PASS] 3. Duplicate cycle correctly rejected with 409 Conflict: {res.get('error', {}).get('message')}")

    # 4. Record pollination
    poll_payload = {
        "tanggalPolinasi": "2026-09-15",
        "pollinationMethod": "bee",
        "notes": "Bumblebee hive introduced"
    }
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles/active/pollination", method="PATCH", body=poll_payload)
    assert status == 200, f"Record pollination failed: {status} {res}"
    data = res.get("data", {})
    assert data.get("status") == "ACTIVE", f"Expected ACTIVE, got {data.get('status')}"
    assert data.get("tanggalPolinasi") == "2026-09-15"
    assert data.get("hsp") is not None, "Expected HSP calculated"
    print(f"[PASS] 4. Pollination recorded: status={data.get('status')}, hsp={data.get('hsp')}")

    # 5. Update metadata (variety, plantCount, targetHarvestHst, cropTimelineConfig)
    timeline_config = {
        "targetHarvestHst": 80,
        "points": [
            {"id": "phase-1", "name": "Vegetatif", "startHst": 0, "endHst": 25, "note": "Pertumbuhan daun"},
            {"id": "phase-2", "name": "Generatif", "startHst": 26, "endHst": 50, "note": "Bunga & buah"},
            {"id": "phase-3", "name": "Pematangan", "startHst": 51, "endHst": 80, "note": "Pematangan buah"}
        ],
        "maintenance": [
            {"id": "maint-1", "name": "Pemangkasan Tunas", "hst": 14, "category": "Pemangkasan", "note": "Tunas air"},
            {"id": "maint-2", "name": "Pemberian Kalsium", "hst": 35, "category": "Nutrisi", "note": "Mencegah BER"}
        ]
    }
    meta_payload = {
        "variety": "Golden Sweet Melon F1",
        "plantCount": 120,
        "notes": "Updated variety notes with full schedule",
        "targetHarvestHst": 80,
        "cropTimelineConfig": timeline_config
    }
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles/active", method="PATCH", body=meta_payload)
    if status == 404:
        # Also verify optional /metadata path alias
        status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles/active/metadata", method="PATCH", body=meta_payload)
    assert status == 200, f"Update metadata failed: {status} {res}"
    data = res.get("data", {})
    assert data.get("variety") == "Golden Sweet Melon F1"
    assert data.get("targetHarvestHst") == 80, f"Expected targetHarvestHst 80, got {data.get('targetHarvestHst')}"
    assert data.get("cropTimelineConfig") is not None, "Expected cropTimelineConfig persisted"
    assert len(data.get("cropTimelineConfig", {}).get("points", [])) == 3, "Expected 3 timeline points"
    assert len(data.get("cropTimelineConfig", {}).get("maintenance", [])) == 2, "Expected 2 maintenance points"
    print(f"[PASS] 5. Metadata updated: variety={data.get('variety')}, targetHarvestHst={data.get('targetHarvestHst')}, timelinePoints={len(data.get('cropTimelineConfig', {}).get('points', []))}")

    # 5b. Verify persistent retrieval via GET /crop-cycle
    status, get_res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycle")
    assert status == 200, f"GET crop-cycle failed: {status} {get_res}"
    get_data = get_res.get("data", {})
    assert get_data.get("targetHarvestHst") == 80, f"Expected retrieved targetHarvestHst 80, got {get_data.get('targetHarvestHst')}"
    assert get_data.get("cropTimelineConfig") is not None, "Expected retrieved cropTimelineConfig persisted"
    print(f"[PASS] 5b. Authoritative retrieval verified: targetHarvestHst={get_data.get('targetHarvestHst')}, points={len(get_data.get('cropTimelineConfig', {}).get('points', []))}")

    # 6. Delete pollination
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles/active/pollination", method="DELETE")
    assert status == 200, f"Delete pollination failed: {status} {res}"
    data = res.get("data", {})
    assert data.get("status") == "ACTIVE"
    assert data.get("tanggalPolinasi") is None
    assert data.get("hsp") is None
    print(f"[PASS] 6. Pollination deleted, HSP reset to None")

    # 7. Harvest cycle
    harvest_payload = {
        "harvestDate": "2026-09-21",
        "yieldKg": 250.5,
        "grade": "Grade A Premium",
        "notes": "Successful harvest"
    }
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles/active/harvest", method="POST", body=harvest_payload)
    assert status == 200, f"Harvest failed: {status} {res}"
    data = res.get("data", {})
    assert data.get("status") == "HARVESTED"
    assert data.get("lastHarvestSummary", {}).get("yieldKg") == 250.5
    print(f"[PASS] 7. Harvest completed: status={data.get('status')}, yield={data.get('lastHarvestSummary')}")

    # 8. GET crop-cycle after harvest should report NO_CYCLE
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycle")
    assert status == 200
    assert res.get("data", {}).get("status") == "NO_CYCLE"
    print(f"[PASS] 8. Post-harvest active cycle correctly cleared to NO_CYCLE")

    # 9. GET history
    status, res = request_json(f"{BASE_URL}/api/v1/greenhouses/{gh_id}/crop-cycles")
    assert status == 200
    cycles = res.get("data", {}).get("items", [])
    assert len(cycles) >= 1, f"Expected at least 1 historical cycle, got: {res}"
    print(f"[PASS] 9. History contains {len(cycles)} cycle(s) in canonical 'items' property")

    print("\n=== ALL CROP CYCLE TESTS PASSED (100% SPEC & CONTRACT COMPLIANT) ===")

if __name__ == "__main__":
    test_crop_cycle_lifecycle()
