"""Durable offline/recovery synchronization state for each Complex/device."""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from threading import RLock
from typing import Any


class RecoveryStore:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.getenv("AGROTECH_RECOVERY_DB", "./agrotech_recovery.sqlite3")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._db:
            self._db.execute(
                """CREATE TABLE IF NOT EXISTS sync_state (
                    complex_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    telemetry_cursor INTEGER NOT NULL DEFAULT 0,
                    event_cursor INTEGER NOT NULL DEFAULT 0,
                    last_sync_at TEXT,
                    last_sync_status TEXT NOT NULL DEFAULT 'NEVER',
                    last_sync_error TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (complex_id, device_id)
                )"""
            )
            self._db.execute(
                """CREATE TABLE IF NOT EXISTS deployment_state (
                    complex_id TEXT PRIMARY KEY,
                    deployment_id TEXT,
                    desired_version INTEGER NOT NULL DEFAULT 0,
                    desired_hash TEXT,
                    device_version INTEGER NOT NULL DEFAULT 0,
                    device_hash TEXT,
                    previous_version INTEGER NOT NULL DEFAULT 0,
                    previous_hash TEXT,
                    status TEXT NOT NULL DEFAULT 'UNKNOWN',
                    updated_at TEXT NOT NULL
                )"""
            )
            cols = {row[1] for row in self._db.execute("PRAGMA table_info(deployment_state)").fetchall()}
            for name, ddl in (("deployment_id", "TEXT"), ("previous_version", "INTEGER NOT NULL DEFAULT 0"), ("previous_hash", "TEXT")):
                if name not in cols:
                    self._db.execute(f"ALTER TABLE deployment_state ADD COLUMN {name} {ddl}")

    @staticmethod
    def _now() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def get_sync(self, complex_id: str, device_id: str = "unknown-device") -> dict[str, Any]:
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM sync_state WHERE complex_id=? AND device_id=?",
                (complex_id, device_id),
            ).fetchone()
        if row is None:
            return {"complexId": complex_id, "deviceId": device_id, "telemetryCursor": 0, "eventCursor": 0,
                    "lastSyncAt": None, "lastSyncStatus": "NEVER", "lastSyncError": None}
        return {"complexId": row["complex_id"], "deviceId": row["device_id"],
                "telemetryCursor": int(row["telemetry_cursor"]), "eventCursor": int(row["event_cursor"]),
                "lastSyncAt": row["last_sync_at"], "lastSyncStatus": row["last_sync_status"],
                "lastSyncError": row["last_sync_error"]}

    def update_sync(self, complex_id: str, device_id: str, *, telemetry_cursor: int | None = None,
                    event_cursor: int | None = None, status: str | None = None, error: str | None = None) -> dict[str, Any]:
        current = self.get_sync(complex_id, device_id)
        tcur = int(current["telemetryCursor"] if telemetry_cursor is None else telemetry_cursor)
        ecur = int(current["eventCursor"] if event_cursor is None else event_cursor)
        now = self._now()
        sync_at = now if status == "SYNCED" else current["lastSyncAt"]
        with self._lock, self._db:
            self._db.execute(
                """INSERT INTO sync_state(complex_id,device_id,telemetry_cursor,event_cursor,last_sync_at,last_sync_status,last_sync_error,updated_at)
                   VALUES(?,?,?,?,?,?,?,?)
                   ON CONFLICT(complex_id,device_id) DO UPDATE SET
                     telemetry_cursor=excluded.telemetry_cursor,event_cursor=excluded.event_cursor,
                     last_sync_at=excluded.last_sync_at,last_sync_status=excluded.last_sync_status,
                     last_sync_error=excluded.last_sync_error,updated_at=excluded.updated_at""",
                (complex_id, device_id, tcur, ecur, sync_at, status or current["lastSyncStatus"], error, now),
            )
        return self.get_sync(complex_id, device_id)

    def get_deployment(self, complex_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._db.execute("SELECT * FROM deployment_state WHERE complex_id=?", (complex_id,)).fetchone()
        if row is None:
            return {"complexId": complex_id, "deploymentId": None, "desiredVersion": 0, "desiredHash": None,
                    "deviceVersion": 0, "deviceHash": None, "previousVersion": 0, "previousHash": None,
                    "status": "UNKNOWN", "updatedAt": None}
        return {"complexId": complex_id, "deploymentId": row["deployment_id"], "desiredVersion": int(row["desired_version"]), "desiredHash": row["desired_hash"],
                "deviceVersion": int(row["device_version"]), "deviceHash": row["device_hash"],
                "previousVersion": int(row["previous_version"]), "previousHash": row["previous_hash"],
                "status": row["status"], "updatedAt": row["updated_at"]}

    def set_deployment(self, complex_id: str, *, desired_version: int, desired_hash: str | None,
                       device_version: int | None = None, device_hash: str | None = None,
                       status: str = "PENDING_DEPLOYMENT", deployment_id: str | None = None,
                       previous_version: int | None = None, previous_hash: str | None = None) -> dict[str, Any]:
        current = self.get_deployment(complex_id)
        now = self._now()
        with self._lock, self._db:
            self._db.execute(
                """INSERT INTO deployment_state(complex_id,deployment_id,desired_version,desired_hash,device_version,device_hash,previous_version,previous_hash,status,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(complex_id) DO UPDATE SET deployment_id=excluded.deployment_id,desired_version=excluded.desired_version,
                     desired_hash=excluded.desired_hash,device_version=excluded.device_version,device_hash=excluded.device_hash,
                     previous_version=excluded.previous_version,previous_hash=excluded.previous_hash,status=excluded.status,updated_at=excluded.updated_at""",
                (complex_id, deployment_id if deployment_id is not None else current["deploymentId"], int(desired_version), desired_hash,
                 int(current["deviceVersion"] if device_version is None else device_version),
                 device_hash if device_hash is not None else current["deviceHash"],
                 int(current["previousVersion"] if previous_version is None else previous_version),
                 previous_hash if previous_hash is not None else current["previousHash"], status, now),
            )
        return self.get_deployment(complex_id)


RECOVERY_STORE = RecoveryStore()
