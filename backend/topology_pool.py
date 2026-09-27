"""Canonical System Topology Pool implementation for AgroTech.

Architecture & SSOT:
- Schema: agrotech.system-topology-pool
- Version: 1
- ESP32 is authoritative operational source for Complexes it owns.
- Topology Pool is replicated across ESP32 controllers.
- Backend is a coordination, processing, history, and mirror/reconciliation layer.
- Browser is an ephemeral view/cache only (zero persistent client storage for topology).
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

SCHEMA_ID = "agrotech.system-topology-pool"
SCHEMA_VERSION = 1

# Deterministic contract hash of the canonical schema definition
CANONICAL_SCHEMA_DEFINITION = (
    "agrotech.system-topology-pool:v1:complex:greenhouse:device:tombstone:change"
)
CONTRACT_HASH = "sha256:" + hashlib.sha256(CANONICAL_SCHEMA_DEFINITION.encode("utf-8")).hexdigest()

ERROR_CONTRACT_MISMATCH = "TOPOLOGY_CONTRACT_MISMATCH"
ERROR_REVISION_CONFLICT = "TOPOLOGY_REVISION_CONFLICT"
ERROR_OWNER_CONFLICT = "TOPOLOGY_OWNER_CONFLICT"
ERROR_PARENT_NOT_FOUND = "TOPOLOGY_PARENT_NOT_FOUND"
ERROR_ENTITY_TOMBSTONED = "TOPOLOGY_ENTITY_TOMBSTONED"
ERROR_HASH_MISMATCH = "TOPOLOGY_HASH_MISMATCH"
ERROR_CONFLICT = "TOPOLOGY_CONFLICT"

TOPOLOGY_SCHEMA_ID = SCHEMA_ID
TOPOLOGY_SCHEMA_VERSION = SCHEMA_VERSION
TOPOLOGY_CONTRACT_HASH = CONTRACT_HASH
TOPOLOGY_ERRORS = {
    "CONTRACT_MISMATCH": ERROR_CONTRACT_MISMATCH,
    "REVISION_CONFLICT": ERROR_REVISION_CONFLICT,
    "OWNER_CONFLICT": ERROR_OWNER_CONFLICT,
    "PARENT_NOT_FOUND": ERROR_PARENT_NOT_FOUND,
    "ENTITY_TOMBSTONED": ERROR_ENTITY_TOMBSTONED,
    "HASH_MISMATCH": ERROR_HASH_MISMATCH,
    "CONFLICT": ERROR_CONFLICT,
}


def canonical_json_bytes(obj: Any) -> bytes:
    """Format object as compact canonical UTF-8 JSON with sorted keys."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def calculate_pool_hash(pool: dict[str, Any]) -> str:
    """Calculate deterministic SHA-256 hash over stable topology pool contents.

    Excludes volatile fields such as network probe timestamps, latencies,
    and temporary session markers.
    """
    stable_devices = []
    for d in sorted(pool.get("devices", []), key=lambda x: str(x.get("deviceId", ""))):
        stable_devices.append({
            "contractVersion": int(d.get("contractVersion", SCHEMA_VERSION)),
            "deviceId": str(d.get("deviceId", "")),
            "deviceState": str(d.get("deviceState", "KNOWN")),
            "hostname": str(d.get("hostname", "")),
            "ownerComplexIds": sorted([str(cid) for cid in d.get("ownerComplexIds", [])]),
        })

    stable_complexes = []
    for c in sorted(pool.get("complexes", []), key=lambda x: str(x.get("complexId", ""))):
        gh_list = sorted([str(gid) for gid in c.get("greenhouses", [])])
        stable_complexes.append({
            "complexId": str(c.get("complexId", "")),
            "greenhouses": gh_list,
            "name": str(c.get("name", "")),
            "ownerDeviceId": str(c.get("ownerDeviceId", "")),
            "recordRevision": int(c.get("recordRevision", 1)),
            "state": str(c.get("state", "ACTIVE")),
        })

    stable_greenhouses = []
    for g in sorted(pool.get("greenhouses", []), key=lambda x: str(x.get("ghId", ""))):
        stable_greenhouses.append({
            "complexId": str(g.get("complexId", "")),
            "ghId": str(g.get("ghId", "")),
            "name": str(g.get("name", "")),
            "recordRevision": int(g.get("recordRevision", 1)),
            "state": str(g.get("state", "ACTIVE")),
        })

    stable_tombstones = []
    for t in sorted(pool.get("tombstones", []), key=lambda x: (str(x.get("entityType", "")), str(x.get("entityId", "")))):
        stable_tombstones.append({
            "deletedAt": str(t.get("deletedAt", "")),
            "deletionChangeId": str(t.get("deletionChangeId", "")),
            "entityId": str(t.get("entityId", "")),
            "entityType": str(t.get("entityType", "")),
            "recordRevision": int(t.get("recordRevision", 1)),
        })

    canonical_payload = {
        "complexes": stable_complexes,
        "devices": stable_devices,
        "greenhouses": stable_greenhouses,
        "poolRevision": int(pool.get("poolRevision", 1)),
        "schemaId": SCHEMA_ID,
        "schemaVersion": SCHEMA_VERSION,
        "tombstones": stable_tombstones,
    }

    raw = canonical_json_bytes(canonical_payload)
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def create_empty_pool(origin_device_id: str = "SYSTEM") -> dict[str, Any]:
    """Create a minimal valid empty topology pool."""
    pool: dict[str, Any] = {
        "schemaId": SCHEMA_ID,
        "schemaVersion": SCHEMA_VERSION,
        "contractHash": CONTRACT_HASH,
        "poolRevision": 1,
        "poolHash": "",
        "originDeviceId": origin_device_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "devices": [],
        "complexes": [],
        "greenhouses": [],
        "tombstones": [],
        "changes": [],
    }
    pool["poolHash"] = calculate_pool_hash(pool)
    return pool


class TopologyConflictError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class SystemTopologyPool:
    """Thread-safe System Topology Pool manager with persistence,

    deterministic hashing, single-writer ownership verification,
    tombstone enforcement, and convergence.
    """

    def __init__(self, db_path: Optional[str] = None, local_device_id: str = "BACKEND-MIRROR"):
        self._lock = threading.RLock()
        self.local_device_id = local_device_id
        self.db_path = db_path
        self._pool: dict[str, Any] = create_empty_pool(local_device_id)

        if self.db_path:
            self._init_db()
            self._load_from_db()

    def _init_db(self) -> None:
        if not self.db_path:
            return
        db = sqlite3.connect(self.db_path)
        try:
            db.execute("""
                CREATE TABLE IF NOT EXISTS system_topology_pool (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    schema_id TEXT NOT NULL,
                    schema_version INTEGER NOT NULL,
                    contract_hash TEXT NOT NULL,
                    pool_revision INTEGER NOT NULL,
                    pool_hash TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            db.commit()
        finally:
            db.close()

    def _load_from_db(self) -> None:
        if not self.db_path:
            return
        db = sqlite3.connect(self.db_path)
        try:
            row = db.execute("SELECT payload FROM system_topology_pool WHERE id = 1").fetchone()
            if row and row[0]:
                try:
                    loaded = json.loads(row[0])
                    if loaded.get("schemaId") == SCHEMA_ID and loaded.get("schemaVersion") == SCHEMA_VERSION:
                        self._pool = loaded
                except Exception:
                    pass
        finally:
            db.close()

    def _save_to_db(self) -> None:
        if not self.db_path:
            return
        db = sqlite3.connect(self.db_path)
        try:
            payload_str = json.dumps(self._pool, separators=(",", ":"))
            db.execute("""
                INSERT INTO system_topology_pool (id, schema_id, schema_version, contract_hash, pool_revision, pool_hash, payload, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    schema_id=excluded.schema_id,
                    schema_version=excluded.schema_version,
                    contract_hash=excluded.contract_hash,
                    pool_revision=excluded.pool_revision,
                    pool_hash=excluded.pool_hash,
                    payload=excluded.payload,
                    updated_at=excluded.updated_at
            """, (
                self._pool["schemaId"],
                self._pool["schemaVersion"],
                self._pool["contractHash"],
                self._pool["poolRevision"],
                self._pool["poolHash"],
                payload_str,
                datetime.now(timezone.utc).isoformat(),
            ))
            db.commit()
        finally:
            db.close()

    def reset_pool(self) -> dict[str, Any]:
        """Reset the pool to a clean empty state and persist."""
        with self._lock:
            self._pool = create_empty_pool(self.local_device_id)
            self._save_to_db()
            return self.get_pool()

    def get_pool(self) -> dict[str, Any]:
        """Return a deep copy of the full active topology pool."""
        with self._lock:
            pool_copy = json.loads(json.dumps(self._pool))
            pool_copy["poolHash"] = calculate_pool_hash(pool_copy)
            return pool_copy

    def get_meta(self) -> dict[str, Any]:
        """Return cheap metadata envelope for compatibility/revision check."""
        with self._lock:
            return {
                "schemaId": self._pool["schemaId"],
                "schemaVersion": self._pool["schemaVersion"],
                "contractHash": self._pool["contractHash"],
                "poolRevision": self._pool["poolRevision"],
                "poolHash": self._pool["poolHash"],
                "deviceId": self.local_device_id,
            }

    def register_device(
        self,
        device_id: str,
        hostname: str = "",
        endpoint: str = "",
        owner_complex_ids: Optional[list[str]] = None,
        device_state: str = "KNOWN",
        contract_version: int = SCHEMA_VERSION,
        pool_revision: int = 1,
        pool_hash: str = "",
    ) -> None:
        """Register or update a controller observation in the pool."""
        with self._lock:
            now_iso = datetime.now(timezone.utc).isoformat()
            devices = self._pool.setdefault("devices", [])
            found = False
            for d in devices:
                if d.get("deviceId") == device_id:
                    found = True
                    d["deviceState"] = device_state
                    if hostname:
                        d["hostname"] = hostname
                    if endpoint:
                        d["endpoint"] = endpoint
                    if owner_complex_ids is not None:
                        d["ownerComplexIds"] = sorted(list(set(owner_complex_ids)))
                    d["lastSeenAt"] = now_iso
                    d["lastSeenByDeviceId"] = self.local_device_id
                    if pool_revision > d.get("poolRevision", 0):
                        d["poolRevision"] = pool_revision
                    if pool_hash:
                        d["poolHash"] = pool_hash
                    d["contractVersion"] = contract_version
                    break
            if not found:
                devices.append({
                    "deviceId": device_id,
                    "deviceState": device_state,
                    "ownerComplexIds": sorted(list(set(owner_complex_ids or []))),
                    "hostname": hostname,
                    "endpoint": endpoint,
                    "lastSeenAt": now_iso,
                    "lastSeenByDeviceId": self.local_device_id,
                    "poolRevision": pool_revision,
                    "poolHash": pool_hash,
                    "contractVersion": contract_version,
                })
            if device_state == "BOUND" and owner_complex_ids:
                for cid in owner_complex_ids:
                    for comp in self._pool.get("complexes", []):
                        if comp.get("complexId") == cid and comp.get("ownerDeviceId") in ("BACKEND-MIRROR", "SYSTEM", "", device_id):
                            comp["ownerDeviceId"] = device_id
            self._pool["poolHash"] = calculate_pool_hash(self._pool)
            self._save_to_db()

    def is_tombstoned(self, entity_type: str, entity_id: str) -> bool:
        """Check if an entity has been deleted/tombstoned."""
        with self._lock:
            return any(
                t.get("entityType") == entity_type and t.get("entityId") == entity_id
                for t in self._pool.get("tombstones", [])
            )

    def apply_mutation(self, mutation: dict[str, Any]) -> dict[str, Any]:
        """Apply an ownership-aware, idempotent topology mutation.

        Supported operations:
        - CREATE_COMPLEX
        - UPDATE_COMPLEX
        - DELETE_COMPLEX
        - CREATE_GREENHOUSE
        - UPDATE_GREENHOUSE
        - DELETE_GREENHOUSE
        """
        with self._lock:
            change_id = str(mutation.get("changeId") or f"chg-{time.time_ns()}")
            op = str(mutation.get("operation") or "").upper()
            actor_device_id = str(mutation.get("originDeviceId") or self.local_device_id)

            # Check duplicate idempotency
            for chg in self._pool.get("changes", []):
                if chg.get("changeId") == change_id:
                    return {"status": "ALREADY_APPLIED", "idempotent": True, "pool": self.get_pool(), "changeId": change_id}

            now_iso = datetime.now(timezone.utc).isoformat()
            new_rev = self._pool["poolRevision"] + 1

            if op == "CREATE_COMPLEX":
                complex_id = str(mutation.get("complexId") or "").strip()
                name = str(mutation.get("name") or complex_id).strip()
                owner_device_id = str(mutation.get("ownerDeviceId") or actor_device_id).strip()
                if not complex_id:
                    raise TopologyConflictError("VALIDATION_FAILED", "complexId is required.")
                if self.is_tombstoned("COMPLEX", complex_id):
                    raise TopologyConflictError(ERROR_ENTITY_TOMBSTONED, f"Complex '{complex_id}' is tombstoned.")

                # Check if complexId already exists
                for c in self._pool.get("complexes", []):
                    if c.get("complexId") == complex_id:
                        if c.get("ownerDeviceId") != owner_device_id:
                            raise TopologyConflictError(ERROR_OWNER_CONFLICT, f"Complex '{complex_id}' is already owned by '{c.get('ownerDeviceId')}'.")
                        # Already exists with same owner -> idempotent success
                        return {"status": "ALREADY_APPLIED", "idempotent": True, "pool": self.get_pool(), "changeId": change_id}

                location = str(mutation.get("location") or mutation.get("address") or "").strip()
                new_record = {
                    "complexId": complex_id,
                    "name": name,
                    "ownerDeviceId": owner_device_id,
                    "state": "ACTIVE",
                    "greenhouses": [],
                    "recordRevision": 1,
                }
                if location:
                    new_record["location"] = location
                self._pool.setdefault("complexes", []).append(new_record)
                self.register_device(owner_device_id, owner_complex_ids=[complex_id])

            elif op == "UPDATE_COMPLEX":
                complex_id = str(mutation.get("complexId") or "").strip()
                name = str(mutation.get("name") or "").strip()
                location = str(mutation.get("location") or mutation.get("address") or "").strip()
                if self.is_tombstoned("COMPLEX", complex_id):
                    raise TopologyConflictError(ERROR_ENTITY_TOMBSTONED, f"Complex '{complex_id}' is tombstoned.")
                c = next((item for item in self._pool.get("complexes", []) if item.get("complexId") == complex_id), None)
                if not c:
                    raise TopologyConflictError("NOT_FOUND", f"Complex '{complex_id}' not found.")
                # Single-writer ownership check: only owner or verified actor
                if actor_device_id not in (c.get("ownerDeviceId"), "BACKEND-MIRROR", "SYSTEM"):
                    raise TopologyConflictError(ERROR_OWNER_CONFLICT, f"Only owner '{c.get('ownerDeviceId')}' can mutate Complex '{complex_id}'.")
                if name:
                    c["name"] = name
                if location:
                    c["location"] = location
                c["recordRevision"] = c.get("recordRevision", 1) + 1

            elif op == "DELETE_COMPLEX":
                complex_id = str(mutation.get("complexId") or "").strip()
                c = next((item for item in self._pool.get("complexes", []) if item.get("complexId") == complex_id), None)
                if c:
                    if actor_device_id not in (c.get("ownerDeviceId"), "BACKEND-MIRROR", "SYSTEM"):
                        raise TopologyConflictError(ERROR_OWNER_CONFLICT, f"Only owner '{c.get('ownerDeviceId')}' can delete Complex '{complex_id}'.")
                    # Remove from complexes
                    self._pool["complexes"] = [item for item in self._pool.get("complexes", []) if item.get("complexId") != complex_id]
                    # Cascade tombstone for associated GHs
                    for gh_id in c.get("greenhouses", []):
                        if not self.is_tombstoned("GREENHOUSE", gh_id):
                            self._pool.setdefault("tombstones", []).append({
                                "entityType": "GREENHOUSE",
                                "entityId": gh_id,
                                "deletedAt": now_iso,
                                "deletionChangeId": change_id,
                                "recordRevision": 1,
                            })
                    self._pool["greenhouses"] = [g for g in self._pool.get("greenhouses", []) if g.get("complexId") != complex_id]

                # Append complex tombstone
                if not self.is_tombstoned("COMPLEX", complex_id):
                    self._pool.setdefault("tombstones", []).append({
                        "entityType": "COMPLEX",
                        "entityId": complex_id,
                        "deletedAt": now_iso,
                        "deletionChangeId": change_id,
                        "recordRevision": (c.get("recordRevision", 0) + 1) if c else 1,
                    })

            elif op == "CREATE_GREENHOUSE":
                gh_id = str(mutation.get("ghId") or "").strip()
                complex_id = str(mutation.get("complexId") or "").strip()
                name = str(mutation.get("name") or gh_id).strip()
                if not gh_id or not complex_id:
                    raise TopologyConflictError("VALIDATION_FAILED", "ghId and complexId are required.")
                if self.is_tombstoned("GREENHOUSE", gh_id):
                    raise TopologyConflictError(ERROR_ENTITY_TOMBSTONED, f"Greenhouse '{gh_id}' is tombstoned.")
                if self.is_tombstoned("COMPLEX", complex_id):
                    raise TopologyConflictError(ERROR_ENTITY_TOMBSTONED, f"Parent Complex '{complex_id}' is tombstoned.")

                parent = next((c for c in self._pool.get("complexes", []) if c.get("complexId") == complex_id), None)
                if not parent:
                    raise TopologyConflictError(ERROR_PARENT_NOT_FOUND, f"Parent Complex '{complex_id}' not found.")
                if actor_device_id not in (parent.get("ownerDeviceId"), "BACKEND-MIRROR", "SYSTEM"):
                    raise TopologyConflictError(ERROR_OWNER_CONFLICT, f"Only owner '{parent.get('ownerDeviceId')}' can add GH to Complex '{complex_id}'.")

                # Check if GH exists
                existing_gh = next((g for g in self._pool.get("greenhouses", []) if g.get("ghId") == gh_id), None)
                if existing_gh:
                    if existing_gh.get("complexId") != complex_id:
                        raise TopologyConflictError(ERROR_CONFLICT, f"Greenhouse '{gh_id}' already assigned to Complex '{existing_gh.get('complexId')}'.")
                    return {"status": "ALREADY_APPLIED", "pool": self.get_pool(), "changeId": change_id}

                new_gh = {
                    "ghId": gh_id,
                    "complexId": complex_id,
                    "name": name,
                    "state": "ACTIVE",
                    "recordRevision": 1,
                }
                self._pool.setdefault("greenhouses", []).append(new_gh)
                if gh_id not in parent.get("greenhouses", []):
                    parent.setdefault("greenhouses", []).append(gh_id)
                    parent["greenhouses"].sort()

            elif op == "DELETE_GREENHOUSE":
                gh_id = str(mutation.get("ghId") or "").strip()
                g = next((item for item in self._pool.get("greenhouses", []) if item.get("ghId") == gh_id), None)
                if g:
                    parent = next((c for c in self._pool.get("complexes", []) if c.get("complexId") == g.get("complexId")), None)
                    if parent:
                        if actor_device_id not in (parent.get("ownerDeviceId"), "BACKEND-MIRROR", "SYSTEM"):
                            raise TopologyConflictError(ERROR_OWNER_CONFLICT, f"Only owner '{parent.get('ownerDeviceId')}' can delete GH '{gh_id}'.")
                        parent["greenhouses"] = [gid for gid in parent.get("greenhouses", []) if gid != gh_id]
                    self._pool["greenhouses"] = [item for item in self._pool.get("greenhouses", []) if item.get("ghId") != gh_id]

                if not self.is_tombstoned("GREENHOUSE", gh_id):
                    self._pool.setdefault("tombstones", []).append({
                        "entityType": "GREENHOUSE",
                        "entityId": gh_id,
                        "deletedAt": now_iso,
                        "deletionChangeId": change_id,
                        "recordRevision": (g.get("recordRevision", 0) + 1) if g else 1,
                    })

            else:
                raise TopologyConflictError("INVALID_OPERATION", f"Unknown operation '{op}'.")

            # Record change for idempotency journal (keep max 100 recent)
            changes = self._pool.setdefault("changes", [])
            changes.append({
                "changeId": change_id,
                "originDeviceId": actor_device_id,
                "operation": op,
                "createdAt": now_iso,
                "baseRevision": self._pool["poolRevision"],
                "newRevision": new_rev,
            })
            if len(changes) > 100:
                self._pool["changes"] = changes[-100:]

            self._pool["poolRevision"] = new_rev
            self._pool["poolHash"] = calculate_pool_hash(self._pool)
            self._save_to_db()

            return {"status": "SUCCESS", "pool": self.get_pool(), "changeId": change_id}

    def reconcile_peer_pool(self, peer_pool: dict[str, Any]) -> dict[str, Any]:
        """Reconcile a peer's topology pool with the local pool.

        Guarantees convergence to identical content and deterministic hash.
        Rejects contract mismatches.
        Prevents resurrection of tombstoned entities.
        Detects ownership conflicts.
        """
        with self._lock:
            # 1. Contract validation
            if peer_pool.get("schemaId") != SCHEMA_ID or int(peer_pool.get("schemaVersion", 0)) != SCHEMA_VERSION:
                raise TopologyConflictError(ERROR_CONTRACT_MISMATCH, "Peer schemaId or schemaVersion does not match.")
            if peer_pool.get("contractHash") != CONTRACT_HASH:
                raise TopologyConflictError(ERROR_CONTRACT_MISMATCH, "Peer contractHash is incompatible.")

            peer_hash = calculate_pool_hash(peer_pool)
            local_hash = calculate_pool_hash(self._pool)

            # If identical hash, already synchronized
            if peer_hash == local_hash and self._pool["poolRevision"] == peer_pool.get("poolRevision"):
                return {"status": "IN_SYNC", "pool": self.get_pool()}

            # 2. Merge tombstones first (tombstones are monotonic)
            merged_tombstones = {
                (t["entityType"], t["entityId"]): t for t in self._pool.get("tombstones", [])
            }
            for pt in peer_pool.get("tombstones", []):
                key = (pt.get("entityType"), pt.get("entityId"))
                if key not in merged_tombstones:
                    merged_tombstones[key] = pt
                else:
                    # Keep highest recordRevision
                    if pt.get("recordRevision", 0) > merged_tombstones[key].get("recordRevision", 0):
                        merged_tombstones[key] = pt

            tombstoned_complexes = {k[1] for k in merged_tombstones if k[0] == "COMPLEX"}
            tombstoned_ghs = {k[1] for k in merged_tombstones if k[0] == "GREENHOUSE"}

            # 3. Merge devices
            merged_devices: dict[str, dict[str, Any]] = {
                d["deviceId"]: dict(d) for d in self._pool.get("devices", [])
            }
            for pd in peer_pool.get("devices", []):
                did = pd.get("deviceId")
                if not did:
                    continue
                if did not in merged_devices:
                    merged_devices[did] = dict(pd)
                else:
                    existing = merged_devices[did]
                    # Update metadata
                    if pd.get("hostname"):
                        existing["hostname"] = pd["hostname"]
                    if pd.get("endpoint"):
                        existing["endpoint"] = pd["endpoint"]
                    # Merge owned complexes
                    c_set = set(existing.get("ownerComplexIds", [])).union(pd.get("ownerComplexIds", []))
                    existing["ownerComplexIds"] = sorted(list(c_set))
                    if pd.get("poolRevision", 0) > existing.get("poolRevision", 0):
                        existing["poolRevision"] = pd["poolRevision"]
                        existing["poolHash"] = pd.get("poolHash", "")

            # 4. Merge complexes (enforcing owner single-writer authority & tombstones)
            merged_complexes: dict[str, dict[str, Any]] = {
                c["complexId"]: dict(c) for c in self._pool.get("complexes", [])
                if c["complexId"] not in tombstoned_complexes
            }
            for pc in peer_pool.get("complexes", []):
                cid = pc.get("complexId")
                if not cid or cid in tombstoned_complexes:
                    continue
                if cid not in merged_complexes:
                    merged_complexes[cid] = dict(pc)
                else:
                    existing = merged_complexes[cid]
                    # Verify owner conflict
                    if existing.get("ownerDeviceId") != pc.get("ownerDeviceId"):
                        raise TopologyConflictError(
                            ERROR_OWNER_CONFLICT,
                            f"Complex '{cid}' has conflicting owners: '{existing.get('ownerDeviceId')}' vs '{pc.get('ownerDeviceId')}'."
                        )
                    # Keep latest record revision
                    if pc.get("recordRevision", 0) > existing.get("recordRevision", 0):
                        merged_complexes[cid] = dict(pc)
                    else:
                        # Union greenhouse IDs
                        combined_gh = set(existing.get("greenhouses", [])).union(pc.get("greenhouses", []))
                        existing["greenhouses"] = sorted([g for g in combined_gh if g not in tombstoned_ghs])

            # 5. Merge greenhouses
            merged_ghs: dict[str, dict[str, Any]] = {
                g["ghId"]: dict(g) for g in self._pool.get("greenhouses", [])
                if g["ghId"] not in tombstoned_ghs and g.get("complexId") in merged_complexes
            }
            for pg in peer_pool.get("greenhouses", []):
                gid = pg.get("ghId")
                cid = pg.get("complexId")
                if not gid or gid in tombstoned_ghs:
                    continue
                if cid not in merged_complexes:
                    # Drop or reject orphaned GH from tombstoned/missing complex
                    continue
                if gid not in merged_ghs:
                    merged_ghs[gid] = dict(pg)
                else:
                    existing = merged_ghs[gid]
                    if existing.get("complexId") != cid:
                        raise TopologyConflictError(
                            ERROR_CONFLICT,
                            f"Greenhouse '{gid}' assigned to different complexes: '{existing.get('complexId')}' vs '{cid}'."
                        )
                    if pg.get("recordRevision", 0) > existing.get("recordRevision", 0):
                        merged_ghs[gid] = dict(pg)

            # Ensure all complex greenhouse references reflect merged greenhouses
            for cid, comp in merged_complexes.items():
                gh_for_c = [g["ghId"] for g in merged_ghs.values() if g.get("complexId") == cid and g["ghId"] not in tombstoned_ghs]
                comp["greenhouses"] = sorted(list(set(gh_for_c)))

            # 6. Merge idempotency change journals
            merged_changes = {chg["changeId"]: chg for chg in self._pool.get("changes", [])}
            for pchg in peer_pool.get("changes", []):
                if pchg.get("changeId") and pchg["changeId"] not in merged_changes:
                    merged_changes[pchg["changeId"]] = pchg

            # 7. Update pool state with proper revision convergence
            local_change_ids = {c["changeId"] for c in self._pool.get("changes", []) if "changeId" in c}
            peer_change_ids = {c["changeId"] for c in peer_pool.get("changes", []) if "changeId" in c}

            local_has_unseen = bool(local_change_ids - peer_change_ids)
            peer_has_unseen = bool(peer_change_ids - local_change_ids)

            if peer_has_unseen and not local_has_unseen:
                new_rev = peer_pool.get("poolRevision", 1)
            elif local_has_unseen and not peer_has_unseen:
                new_rev = self._pool.get("poolRevision", 1)
            elif local_has_unseen and peer_has_unseen:
                new_rev = max(self._pool.get("poolRevision", 1), peer_pool.get("poolRevision", 1)) + 1
            else:
                new_rev = max(self._pool.get("poolRevision", 1), peer_pool.get("poolRevision", 1))

            self._pool["devices"] = sorted(list(merged_devices.values()), key=lambda x: x["deviceId"])
            self._pool["complexes"] = sorted(list(merged_complexes.values()), key=lambda x: x["complexId"])
            self._pool["greenhouses"] = sorted(list(merged_ghs.values()), key=lambda x: x["ghId"])
            self._pool["tombstones"] = sorted(list(merged_tombstones.values()), key=lambda x: (x["entityType"], x["entityId"]))
            self._pool["changes"] = list(merged_changes.values())[-100:]
            self._pool["poolRevision"] = new_rev
            self._pool["poolHash"] = calculate_pool_hash(self._pool)
            self._save_to_db()

            return {"status": "CONVERGED", "pool": self.get_pool()}
