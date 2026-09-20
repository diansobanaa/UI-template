"""Durable deletion state store for system-level Complex retirement jobs."""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from threading import RLock
from typing import Any

JOB_STATUSES = {
    "REQUESTED",
    "PREFLIGHTING",
    "WAITING_DEVICE",
    "LOCKED",
    "RETIRING_DEVICE",
    "PURGING",
    "VERIFYING",
    "COMPLETED",
    "FAILED_RETRYABLE",
    "FAILED_TERMINAL",
    "CANCELLED",
}

ACTIVE_STATUSES = {
    "REQUESTED",
    "PREFLIGHTING",
    "WAITING_DEVICE",
    "LOCKED",
    "RETIRING_DEVICE",
    "PURGING",
    "VERIFYING",
    "FAILED_RETRYABLE",
}

STEP_STATUSES = {
    "PENDING",
    "RUNNING",
    "SUCCEEDED",
    "SKIPPED",
    "FAILED_RETRYABLE",
    "FAILED_TERMINAL",
}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class DeletionStore:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.getenv("AGROTECH_SYSTEM_DB", "./agrotech_system.sqlite3")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, timeout=10.0)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        self._init()

    def _init(self) -> None:
        with self._lock, self._db:
            self._db.execute(
                """
                CREATE TABLE IF NOT EXISTS deletion_jobs (
                    job_id TEXT PRIMARY KEY,
                    complex_id TEXT NOT NULL,
                    device_id TEXT,
                    mode TEXT NOT NULL,
                    status TEXT NOT NULL,
                    current_step_no INTEGER NOT NULL DEFAULT 0,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    requested_by TEXT,
                    request_reason TEXT,
                    scope_snapshot_json TEXT,
                    scope_hash TEXT,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    lease_owner TEXT,
                    lease_expires_at TEXT,
                    last_error_code TEXT,
                    last_error_message TEXT,
                    requested_at TEXT NOT NULL,
                    started_at TEXT,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    version INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            self._db.execute(
                """
                CREATE TABLE IF NOT EXISTS deletion_job_steps (
                    step_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    sequence_no INTEGER NOT NULL,
                    step_key TEXT NOT NULL,
                    database_key TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    rows_expected INTEGER,
                    rows_affected INTEGER,
                    checkpoint_json TEXT,
                    verification_json TEXT,
                    last_error_code TEXT,
                    last_error_message TEXT,
                    started_at TEXT,
                    heartbeat_at TEXT,
                    finished_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES deletion_jobs(job_id) ON DELETE CASCADE,
                    UNIQUE(job_id, sequence_no),
                    UNIQUE(job_id, step_key)
                )
                """
            )
            self._db.execute(
                """
                CREATE TABLE IF NOT EXISTS deletion_job_events (
                    event_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    from_status TEXT,
                    to_status TEXT,
                    step_id TEXT,
                    actor TEXT,
                    message TEXT,
                    detail_json TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES deletion_jobs(job_id) ON DELETE CASCADE
                )
                """
            )
            self._db.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_active_deletion_complex
                ON deletion_jobs(complex_id)
                WHERE status IN (
                    'REQUESTED', 'PREFLIGHTING', 'WAITING_DEVICE', 'LOCKED',
                    'RETIRING_DEVICE', 'PURGING', 'VERIFYING', 'FAILED_RETRYABLE'
                )
                """
            )

    @staticmethod
    def _decode_job(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        res = dict(row)
        if res.get("scope_snapshot_json"):
            try:
                res["scopeSnapshot"] = json.loads(res["scope_snapshot_json"])
            except Exception:
                res["scopeSnapshot"] = None
        return res

    @staticmethod
    def _decode_step(row: sqlite3.Row) -> dict[str, Any]:
        res = dict(row)
        if res.get("checkpoint_json"):
            try:
                res["checkpoint"] = json.loads(res["checkpoint_json"])
            except Exception:
                pass
        if res.get("verification_json"):
            try:
                res["verification"] = json.loads(res["verification_json"])
            except Exception:
                pass
        return res

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM deletion_jobs WHERE job_id = ?", (job_id,)).fetchone()
            return self._decode_job(row)

    def get_job_by_idempotency_key(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM deletion_jobs WHERE idempotency_key = ?", (key,)).fetchone()
            return self._decode_job(row)

    def get_active_job_for_complex(self, complex_id: str) -> dict[str, Any] | None:
        with self._lock:
            active_placeholders = ",".join(f"'{s}'" for s in ACTIVE_STATUSES)
            row = self._db.execute(
                f"SELECT * FROM deletion_jobs WHERE complex_id = ? AND status IN ({active_placeholders})",
                (complex_id,),
            ).fetchone()
            return self._decode_job(row)

    def create_job(
        self,
        complex_id: str,
        idempotency_key: str,
        device_id: str | None = None,
        mode: str = "NORMAL",
        requested_by: str = "operator",
        request_reason: str = "User requested complex deletion",
        scope_snapshot: dict[str, Any] | None = None,
        scope_hash: str | None = None,
        job_id: str | None = None,
        scope_snapshot_hash: str | None = None,
    ) -> dict[str, Any]:
        with self._lock, self._db:
            # Check for existing idempotency key
            existing = self._db.execute("SELECT * FROM deletion_jobs WHERE idempotency_key = ?", (idempotency_key,)).fetchone()
            if existing:
                return self._decode_job(existing)  # type: ignore[return-value]

            # Check if active job already exists for this complex
            active = self.get_active_job_for_complex(complex_id)
            if active:
                raise ValueError("ACTIVE_DELETION_JOB_EXISTS")

            jid = job_id or f"del-{uuid.uuid4().hex[:16]}"
            shash = scope_hash or scope_snapshot_hash
            now = _now()
            scope_json = json.dumps(scope_snapshot, separators=(",", ":")) if scope_snapshot else None

            self._db.execute(
                """
                INSERT INTO deletion_jobs (
                    job_id, complex_id, device_id, mode, status, current_step_no,
                    idempotency_key, requested_by, request_reason, scope_snapshot_json,
                    scope_hash, attempt_count, requested_at, updated_at
                ) VALUES (?, ?, ?, ?, 'REQUESTED', 0, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    jid,
                    complex_id,
                    device_id,
                    mode,
                    idempotency_key,
                    requested_by,
                    request_reason,
                    scope_json,
                    shash,
                    now,
                    now,
                ),
            )

            self.record_event(
                jid,
                event_type="JOB_CREATED",
                from_status=None,
                to_status="REQUESTED",
                actor=requested_by,
                message=f"Deletion job {jid} created for complex {complex_id}",
            )

            return self.get_job(jid)  # type: ignore[return-value]

    def update_job_status(
        self,
        job_id: str,
        new_status: str,
        current_step_no: int | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        actor: str = "system",
        detail: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if new_status not in JOB_STATUSES:
            raise ValueError(f"Invalid job status: {new_status}")
        with self._lock, self._db:
            job = self.get_job(job_id)
            if not job:
                raise ValueError("JOB_NOT_FOUND")

            old_status = job["status"]
            now = _now()
            completed_at = now if new_status in {"COMPLETED", "FAILED_TERMINAL", "CANCELLED"} else None
            started_at = job["started_at"] or (now if new_status != "REQUESTED" else None)

            step_no = current_step_no if current_step_no is not None else job["current_step_no"]

            self._db.execute(
                """
                UPDATE deletion_jobs SET
                    status = ?,
                    current_step_no = ?,
                    last_error_code = ?,
                    last_error_message = ?,
                    started_at = COALESCE(started_at, ?),
                    completed_at = ?,
                    updated_at = ?,
                    version = version + 1
                WHERE job_id = ?
                """,
                (
                    new_status,
                    step_no,
                    error_code,
                    error_message,
                    started_at,
                    completed_at,
                    now,
                    job_id,
                ),
            )

            self.record_event(
                job_id,
                event_type="STATUS_CHANGED",
                from_status=old_status,
                to_status=new_status,
                actor=actor,
                message=error_message or f"Job status transitioned to {new_status}",
                detail=detail,
            )

            return self.get_job(job_id)  # type: ignore[return-value]

    def update_job(self, job_or_complex_id: str, **kwargs) -> dict[str, Any]:
        with self._lock:
            job = self.get_job(job_or_complex_id)
            if not job:
                job = self.get_active_job_for_complex(job_or_complex_id)
            if not job:
                row = self._db.execute(
                    "SELECT job_id FROM deletion_jobs WHERE complex_id = ? ORDER BY requested_at DESC LIMIT 1",
                    (job_or_complex_id,),
                ).fetchone()
                if row:
                    job = self.get_job(row["job_id"])
            if not job:
                raise ValueError("JOB_NOT_FOUND")

            new_status = kwargs.get("status") or job["status"]
            return self.update_job_status(
                job["job_id"],
                new_status=new_status,
                current_step_no=kwargs.get("current_step_no"),
                error_code=kwargs.get("error_code"),
                error_message=kwargs.get("error_message"),
                actor=kwargs.get("actor", "system"),
                detail=kwargs.get("detail"),
            )

    def register_steps(self, job_id: str, steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        now = _now()
        with self._lock, self._db:
            for s in steps:
                step_id = s.get("step_id") or f"step-{uuid.uuid4().hex[:12]}"
                self._db.execute(
                    """
                    INSERT INTO deletion_job_steps (
                        step_id, job_id, sequence_no, step_key, database_key,
                        action, status, rows_expected, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
                    ON CONFLICT(job_id, sequence_no) DO UPDATE SET
                        database_key = excluded.database_key,
                        action = excluded.action,
                        rows_expected = excluded.rows_expected
                    """,
                    (
                        step_id,
                        job_id,
                        s["sequence_no"],
                        s["step_key"],
                        s["database_key"],
                        s["action"],
                        s.get("rows_expected", 0),
                        now,
                    ),
                )
            return self.list_steps(job_id)

    def list_steps(self, job_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM deletion_job_steps WHERE job_id = ? ORDER BY sequence_no ASC",
                (job_id,),
            ).fetchall()
            return [self._decode_step(r) for r in rows]

    def update_step_status(
        self,
        job_id: str,
        step_key: str,
        status: str,
        rows_affected: int | None = None,
        verification: dict[str, Any] | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        if status not in STEP_STATUSES:
            raise ValueError(f"Invalid step status: {status}")
        now = _now()
        verif_json = json.dumps(verification, separators=(",", ":")) if verification else None
        with self._lock, self._db:
            finished_at = now if status in {"SUCCEEDED", "SKIPPED", "FAILED_TERMINAL", "FAILED_RETRYABLE"} else None
            started_clause = "started_at = COALESCE(started_at, ?)," if status == "RUNNING" else ""

            query = f"""
                UPDATE deletion_job_steps SET
                    status = ?,
                    {started_clause}
                    heartbeat_at = ?,
                    finished_at = ?,
                    rows_affected = COALESCE(?, rows_affected),
                    verification_json = COALESCE(?, verification_json),
                    last_error_code = ?,
                    last_error_message = ?,
                    attempt_count = attempt_count + 1
                WHERE job_id = ? AND step_key = ?
            """
            params: list[Any] = [status]
            if status == "RUNNING":
                params.append(now)
            params.extend([now, finished_at, rows_affected, verif_json, error_code, error_message, job_id, step_key])

            self._db.execute(query, params)

            row = self._db.execute(
                "SELECT * FROM deletion_job_steps WHERE job_id = ? AND step_key = ?",
                (job_id, step_key),
            ).fetchone()
            if not row:
                raise ValueError("STEP_NOT_FOUND")
            return self._decode_step(row)

    def record_event(
        self,
        job_id: str,
        event_type: str,
        from_status: str | None = None,
        to_status: str | None = None,
        step_id: str | None = None,
        actor: str = "system",
        message: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        now = _now()
        event_id = f"ev-{uuid.uuid4().hex[:16]}"
        detail_json = json.dumps(detail, separators=(",", ":")) if detail else None
        with self._lock, self._db:
            self._db.execute(
                """
                INSERT INTO deletion_job_events (
                    event_id, job_id, event_type, from_status, to_status,
                    step_id, actor, message, detail_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    job_id,
                    event_type,
                    from_status,
                    to_status,
                    step_id,
                    actor,
                    message,
                    detail_json,
                    now,
                ),
            )

    def list_events(self, job_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM deletion_job_events WHERE job_id = ? ORDER BY created_at ASC",
                (job_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def list_active_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            active_placeholders = ",".join(f"'{s}'" for s in ACTIVE_STATUSES)
            rows = self._db.execute(
                f"SELECT * FROM deletion_jobs WHERE status IN ({active_placeholders}) ORDER BY requested_at ASC"
            ).fetchall()
            return [self._decode_job(r) for r in rows]  # type: ignore[misc]


DELETION_STORE = DeletionStore()
