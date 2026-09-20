"""Durable telemetry/event history and raw ESP32 ingestion.

M13 rule: store raw records first, then project them into queryable telemetry/events.
Ingestion is idempotent by stable record identity. Device occurrence time is preserved
separately from backend receipt/processing time.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from threading import RLock
from typing import Any, Iterable


class HistoryStore:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.getenv("AGROTECH_HISTORY_DB", "./agrotech_history.sqlite3")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._init()

    def _init(self) -> None:
        with self._db:
            self._db.execute(
                """
                CREATE TABLE IF NOT EXISTS raw_records (
                    record_id TEXT PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    complex_id TEXT NOT NULL,
                    record_type TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    device_timestamp TEXT,
                    received_at TEXT NOT NULL,
                    processed_at TEXT NOT NULL,
                    payload TEXT NOT NULL
                )
                """
            )
            self._db.execute(
                """
                CREATE TABLE IF NOT EXISTS telemetry_samples (
                    device_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    complex_id TEXT NOT NULL,
                    gh_id TEXT,
                    device_timestamp TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    component_id TEXT NOT NULL,
                    metric_id TEXT,
                    source TEXT,
                    value REAL,
                    unit TEXT NOT NULL,
                    quality TEXT NOT NULL,
                    measurement_type TEXT NOT NULL,
                    calibration_id TEXT,
                    calibration_version INTEGER,
                    raw_record_id TEXT NOT NULL,
                    PRIMARY KEY (device_id, sequence, component_id),
                    FOREIGN KEY(raw_record_id) REFERENCES raw_records(record_id)
                )
                """
            )
            self._db.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    complex_id TEXT,
                    gh_id TEXT,
                    device_timestamp TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    category TEXT,
                    component_id TEXT,
                    command_id TEXT,
                    resource_id TEXT,
                    configuration_version INTEGER,
                    payload TEXT NOT NULL,
                    raw_record_id TEXT NOT NULL,
                    FOREIGN KEY(raw_record_id) REFERENCES raw_records(record_id)
                )
                """
            )
            self._db.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_complex_seq ON telemetry_samples(complex_id, sequence)")
            self._db.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_gh_seq ON telemetry_samples(complex_id, gh_id, sequence)")
            self._db.execute("CREATE INDEX IF NOT EXISTS idx_events_complex_seq ON events(complex_id, sequence)")
            self._db.execute("CREATE INDEX IF NOT EXISTS idx_events_gh_seq ON events(complex_id, gh_id, sequence)")
            self._db.execute("CREATE INDEX IF NOT EXISTS idx_raw_device_type_seq ON raw_records(device_id, record_type, sequence)")
            self._ensure_column("telemetry_samples", "metric_id", "TEXT")
            self._ensure_column("telemetry_samples", "source", "TEXT")
            self._ensure_column("events", "category", "TEXT")

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        columns = {row[1] for row in self._db.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            self._db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    @staticmethod
    def _now_iso() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    @staticmethod
    def _payload(value: Any) -> str:
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)

    def _insert_raw(self, record_id: str, device_id: str, complex_id: str, record_type: str,
                    sequence: int, device_timestamp: str | None, payload: Any,
                    received_at: str, processed_at: str) -> bool:
        cur = self._db.execute(
            """INSERT OR IGNORE INTO raw_records
               (record_id, device_id, complex_id, record_type, sequence, device_timestamp, received_at, processed_at, payload)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (record_id, device_id, complex_id, record_type, int(sequence), device_timestamp,
             received_at, processed_at, self._payload(payload)),
        )
        return cur.rowcount == 1

    def ingest_telemetry_snapshot(self, payload: dict[str, Any], *, received_at: str | None = None) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("telemetry payload must be an object")
        data = payload.get("data", payload)
        if isinstance(data, dict) and isinstance(data.get("payload"), dict):
            data = data["payload"]
        if not isinstance(data, dict):
            raise ValueError("telemetry payload data must be an object")
        device_id = str(data.get("deviceId") or payload.get("deviceId") or "unknown-device")
        complex_id = str(data.get("complexId") or "")
        if not complex_id:
            raise ValueError("telemetry complexId is required")
        sequence = int(data.get("sequence") or data.get("latestSequence") or 0)
        if sequence <= 0:
            raise ValueError("telemetry sequence must be positive")
        device_timestamp = str(data.get("deviceTimestamp") or data.get("timestamp") or "")
        if not device_timestamp:
            raise ValueError("telemetry deviceTimestamp is required")
        gh_id = data.get("ghId")
        received = received_at or self._now_iso()
        processed = self._now_iso()
        record_id = str(data.get("recordId") or f"{device_id}:telemetry:{sequence}")
        samples = data.get("samples") or []
        if not isinstance(samples, list):
            raise ValueError("telemetry samples must be an array")

        with self._lock, self._db:
            inserted_raw = self._insert_raw(record_id, device_id, complex_id, "TELEMETRY", sequence,
                                            device_timestamp, data, received, processed)
            for sample in samples:
                if not isinstance(sample, dict):
                    continue
                component_id = str(sample.get("componentId") or "")
                if not component_id:
                    continue
                value = sample.get("value")
                if value is not None:
                    try:
                        value = float(value)
                    except (TypeError, ValueError):
                        value = None
                quality = str(sample.get("quality") or "BAD").upper()
                measurement_type = str(sample.get("measurementType") or "UNAVAILABLE").upper()
                self._db.execute(
                    """INSERT OR IGNORE INTO telemetry_samples
                       (device_id, sequence, complex_id, gh_id, device_timestamp, received_at,
                        component_id, metric_id, source, value, unit, quality, measurement_type, calibration_id,
                        calibration_version, raw_record_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (device_id, sequence, complex_id, sample.get("ghId", gh_id), device_timestamp, received,
                     component_id, sample.get("metricId"), sample.get("source"), value, str(sample.get("unit") or ""), quality, measurement_type,
                     sample.get("calibrationId"), sample.get("calibrationVersion"), record_id),
                )
        return {"recordId": record_id, "deviceId": device_id, "complexId": complex_id,
                "sequence": sequence, "inserted": inserted_raw, "sampleCount": len(samples),
                "receivedAt": received, "processedAt": processed}

    def ingest_event(self, event: dict[str, Any], *, received_at: str | None = None) -> dict[str, Any]:
        if not isinstance(event, dict):
            raise ValueError("event must be an object")
        data = event.get("data", event)
        if isinstance(data, dict) and isinstance(data.get("payload"), dict) and "eventId" in data["payload"]:
            data = data["payload"]
        if not isinstance(data, dict):
            raise ValueError("event payload must be an object")
        device_id = str(data.get("deviceId") or "unknown-device")
        event_id = str(data.get("eventId") or data.get("id") or "")
        sequence = int(data.get("sequence") or 0)
        complex_id = data.get("complexId")
        if not event_id or sequence <= 0 or not complex_id:
            raise ValueError("eventId, sequence and complexId are required")
        device_timestamp = str(data.get("deviceTimestamp") or data.get("at") or "")
        if not device_timestamp:
            raise ValueError("event deviceTimestamp is required")
        received = received_at or self._now_iso()
        processed = self._now_iso()
        payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
        record_id = str(data.get("recordId") or event_id)
        with self._lock, self._db:
            inserted_raw = self._insert_raw(record_id, device_id, str(complex_id), "EVENT", sequence,
                                            device_timestamp, data, received, processed)
            self._db.execute(
                """INSERT OR IGNORE INTO events
                   (event_id, device_id, sequence, complex_id, gh_id, device_timestamp, received_at,
                    event_type, severity, category, component_id, command_id, resource_id, configuration_version,
                    payload, raw_record_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (event_id, device_id, sequence, complex_id, data.get("ghId"), device_timestamp, received,
                 str(data.get("eventType") or data.get("code") or "EVENT"),
                 str(data.get("severity") or data.get("level") or "INFO").upper(),
                 str(data.get("category") or "SYSTEM"),
                 data.get("componentId"), data.get("commandId"), data.get("resourceId"),
                 data.get("configurationVersion"), self._payload(payload), record_id),
            )
        return {"eventId": event_id, "deviceId": device_id, "complexId": complex_id,
                "sequence": sequence, "inserted": inserted_raw, "receivedAt": received,
                "processedAt": processed}

    def ingest_bundle(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = payload.get("data", payload) if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise ValueError("ingest payload must be an object")
        telemetry = data.get("telemetry") or []
        events = data.get("events") or []
        if isinstance(telemetry, dict): telemetry = [telemetry]
        if isinstance(events, dict): events = [events]
        results = {"telemetry": [], "events": []}
        for item in telemetry:
            results["telemetry"].append(self.ingest_telemetry_snapshot(item))
        for item in events:
            results["events"].append(self.ingest_event(item))
        return results

    def latest_telemetry(self, complex_id: str, gh_id: str | None = None) -> dict[str, Any] | None:
        where = ["complex_id = ?"]
        params: list[Any] = [complex_id]
        if gh_id:
            where.append("gh_id = ?")
            params.append(gh_id)
        row = self._db.execute(
            f"SELECT * FROM telemetry_samples WHERE {' AND '.join(where)} ORDER BY sequence DESC, rowid DESC LIMIT 1",
            params,
        ).fetchone()
        if row is None:
            return None
        return dict(row)

    def list_telemetry(self, complex_id: str, *, gh_id: str | None = None,
                       after_sequence: int = 0, limit: int = 50) -> dict[str, Any]:
        limit = max(1, min(int(limit), 200))
        where = ["complex_id = ?", "sequence > ?"]
        params: list[Any] = [complex_id, int(after_sequence)]
        if gh_id:
            where.append("gh_id = ?")
            params.append(gh_id)
        # Cursor semantics operate on snapshot sequence, not individual samples.
        seq_rows = self._db.execute(
            f"SELECT DISTINCT sequence FROM telemetry_samples WHERE {' AND '.join(where)} ORDER BY sequence ASC LIMIT ?",
            [*params, limit + 1],
        ).fetchall()
        has_more = len(seq_rows) > limit
        sequences = [int(r["sequence"]) for r in seq_rows[:limit]]
        if not sequences:
            return {"samples": [], "nextSequence": None, "hasMore": has_more}
        placeholders = ",".join("?" for _ in sequences)
        sample_where = ["complex_id = ?", f"sequence IN ({placeholders})"]
        sample_params: list[Any] = [complex_id, *sequences]
        if gh_id:
            sample_where.append("gh_id = ?")
            sample_params.append(gh_id)
        sample_rows = self._db.execute(
            f"SELECT * FROM telemetry_samples WHERE {' AND '.join(sample_where)} ORDER BY sequence ASC, component_id ASC",
            sample_params,
        ).fetchall()
        return {"samples": [self._telemetry_row(r) for r in sample_rows],
                "nextSequence": sequences[-1],
                "hasMore": has_more}

    def list_events(self, complex_id: str, *, gh_id: str | None = None,
                    after_sequence: int = 0, limit: int = 50) -> dict[str, Any]:
        limit = max(1, min(int(limit), 200))
        where = ["complex_id = ?", "sequence > ?"]
        params: list[Any] = [complex_id, int(after_sequence)]
        if gh_id:
            where.append("gh_id = ?")
            params.append(gh_id)
        rows = self._db.execute(
            f"SELECT * FROM events WHERE {' AND '.join(where)} ORDER BY sequence ASC LIMIT ?",
            [*params, limit + 1],
        ).fetchall()
        has_more = len(rows) > limit
        rows = rows[:limit]
        return {"events": [self._event_row(r) for r in rows],
                "nextSequence": int(rows[-1]["sequence"]) if rows else None,
                "hasMore": has_more}

    def latest_events(self, complex_id: str, *, gh_id: str | None = None, limit: int = 50) -> dict[str, Any]:
        limit = max(1, min(int(limit), 200))
        where = ["complex_id = ?"]
        params: list[Any] = [complex_id]
        if gh_id:
            where.append("gh_id = ?")
            params.append(gh_id)
        rows = self._db.execute(
            f"SELECT * FROM events WHERE {' AND '.join(where)} ORDER BY sequence DESC LIMIT ?",
            [*params, limit],
        ).fetchall()
        rows = list(reversed(rows))
        return {"events": [self._event_row(r) for r in rows],
                "nextSequence": int(rows[-1]["sequence"]) if rows else None,
                "hasMore": False}

    def latest_telemetry_history(self, complex_id: str, *, gh_id: str | None = None, limit: int = 200) -> dict[str, Any]:
        limit = max(1, min(int(limit), 200))
        where = ["complex_id = ?"]
        params: list[Any] = [complex_id]
        if gh_id:
            where.append("gh_id = ?")
            params.append(gh_id)
        seq_rows = self._db.execute(
            f"SELECT DISTINCT sequence FROM telemetry_samples WHERE {' AND '.join(where)} ORDER BY sequence DESC LIMIT ?",
            [*params, limit],
        ).fetchall()
        sequences = sorted((int(r["sequence"]) for r in seq_rows))
        if not sequences:
            return {"samples": [], "nextSequence": None, "hasMore": False}
        placeholders = ",".join("?" for _ in sequences)
        sample_where = ["complex_id = ?", f"sequence IN ({placeholders})"]
        sample_params: list[Any] = [complex_id, *sequences]
        if gh_id:
            sample_where.append("gh_id = ?")
            sample_params.append(gh_id)
        rows = self._db.execute(
            f"SELECT * FROM telemetry_samples WHERE {' AND '.join(sample_where)} ORDER BY sequence ASC, component_id ASC",
            sample_params,
        ).fetchall()
        return {"samples": [self._telemetry_row(r) for r in rows], "nextSequence": sequences[-1], "hasMore": False}

    def query_telemetry_window(self, complex_id: str, gh_id: str | None, start: str | None, end: str | None, limit: int = 5000) -> list[dict[str, Any]]:
        where=["complex_id=?"]; params:[Any]=[complex_id]
        if gh_id: where.append("gh_id=?"); params.append(gh_id)
        if start: where.append("device_timestamp>=?"); params.append(start)
        if end: where.append("device_timestamp<=?"); params.append(end)
        params.append(max(1,min(int(limit),20000)))
        rows=self._db.execute(f"SELECT * FROM telemetry_samples WHERE {' AND '.join(where)} ORDER BY sequence ASC, component_id ASC LIMIT ?",params).fetchall()
        return [self._telemetry_row(r) for r in rows]

    def query_events_window(self, complex_id: str, gh_id: str | None, start: str | None, end: str | None, limit: int = 5000) -> list[dict[str, Any]]:
        where=["complex_id=?"]; params:[Any]=[complex_id]
        if gh_id: where.append("gh_id=?"); params.append(gh_id)
        if start: where.append("device_timestamp>=?"); params.append(start)
        if end: where.append("device_timestamp<=?"); params.append(end)
        params.append(max(1,min(int(limit),20000)))
        rows=self._db.execute(f"SELECT * FROM events WHERE {' AND '.join(where)} ORDER BY sequence ASC LIMIT ?",params).fetchall()
        return [self._event_row(r) for r in rows]

    def event_bounds(self, complex_id: str, gh_id: str | None = None) -> dict[str, int | None]:
        where = ["complex_id = ?"]
        params: list[Any] = [complex_id]
        if gh_id:
            where.append("gh_id = ?")
            params.append(gh_id)
        row = self._db.execute(
            f"SELECT MIN(sequence) AS min_seq, MAX(sequence) AS max_seq FROM events WHERE {' AND '.join(where)}",
            params,
        ).fetchone()
        return {"earliestSequence": int(row["min_seq"]) if row and row["min_seq"] is not None else None,
                "latestSequence": int(row["max_seq"]) if row and row["max_seq"] is not None else None}

    def telemetry_bounds(self, complex_id: str, gh_id: str | None = None) -> dict[str, int | None]:
        where = ["complex_id = ?"]
        params: list[Any] = [complex_id]
        if gh_id:
            where.append("gh_id = ?"); params.append(gh_id)
        row = self._db.execute(f"SELECT MIN(sequence) AS min_seq, MAX(sequence) AS max_seq FROM telemetry_samples WHERE {' AND '.join(where)}", params).fetchone()
        return {"earliestSequence": int(row["min_seq"]) if row and row["min_seq"] is not None else None,
                "latestSequence": int(row["max_seq"]) if row and row["max_seq"] is not None else None}

    @staticmethod
    def _telemetry_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "sequence": int(row["sequence"]),
            "deviceTimestamp": row["device_timestamp"],
            "receivedAt": row["received_at"],
            "recordId": row["raw_record_id"],
            "componentId": row["component_id"],
            "metricId": row["metric_id"],
            "source": row["source"],
            "ghId": row["gh_id"],
            "value": row["value"],
            "unit": row["unit"],
            "quality": row["quality"],
            "measurementType": row["measurement_type"],
            "calibrationId": row["calibration_id"],
            "calibrationVersion": row["calibration_version"],
        }

    @staticmethod
    def _event_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "eventId": row["event_id"],
            "sequence": int(row["sequence"]),
            "deviceTimestamp": row["device_timestamp"],
            "eventType": row["event_type"],
            "severity": row["severity"],
            "category": row["category"],
            "deviceId": row["device_id"],
            "recordId": row["raw_record_id"],
            "complexId": row["complex_id"],
            "ghId": row["gh_id"],
            "componentId": row["component_id"],
            "commandId": row["command_id"],
            "resourceId": row["resource_id"],
            "configurationVersion": row["configuration_version"],
            "payload": json.loads(row["payload"] or "{}"),
            "receivedAt": row["received_at"],
        }


HISTORY_STORE = HistoryStore()
