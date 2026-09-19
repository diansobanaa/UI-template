"""Persistent Python-owned master/operational data store.

This replaces the browser mock database for Complex/GH metadata and UI-managed
schedule/recipe state.  It intentionally starts empty unless records are created
through the API; there is no demo/seed dataset in the production path.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from threading import RLock
from typing import Any


class OperationalStore:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.getenv("AGROTECH_OPERATIONAL_DB", "./agrotech_operational.sqlite3")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._init()

    def _init(self) -> None:
        with self._db:
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS complexes (id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
            )
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS greenhouses (id TEXT PRIMARY KEY, complex_id TEXT NOT NULL, payload TEXT NOT NULL)"
            )

    @staticmethod
    def _json(payload: Any) -> str:
        return json.dumps(payload, separators=(",", ":"))

    @staticmethod
    def _decode(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        return json.loads(row["payload"])

    def context(self) -> dict[str, list[dict[str, Any]]]:
        with self._lock:
            complexes = [json.loads(r["payload"]) for r in self._db.execute("SELECT payload FROM complexes ORDER BY id")]
            greenhouses = [json.loads(r["payload"]) for r in self._db.execute("SELECT payload FROM greenhouses ORDER BY id")]
        return {"complexes": complexes, "greenhouses": greenhouses}

    def get_complex(self, complex_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT payload FROM complexes WHERE id = ?", (complex_id,)).fetchone()
            return self._decode(row)

    def save_complex(self, payload: dict[str, Any]) -> dict[str, Any]:
        complex_id = str(payload["id"])
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO complexes(id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                (complex_id, self._json(payload)),
            )
        return payload

    def get_greenhouse(self, gh_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT payload FROM greenhouses WHERE id = ?", (gh_id,)).fetchone()
            return self._decode(row)

    def list_greenhouses(self, complex_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [json.loads(r["payload"]) for r in self._db.execute("SELECT payload FROM greenhouses WHERE complex_id = ? ORDER BY id", (complex_id,))]

    def save_greenhouse(self, payload: dict[str, Any]) -> dict[str, Any]:
        gh_id = str(payload["id"])
        complex_id = str(payload["complexId"])
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO greenhouses(id, complex_id, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET complex_id=excluded.complex_id, payload=excluded.payload",
                (gh_id, complex_id, self._json(payload)),
            )
        return payload


OPERATIONAL_STORE = OperationalStore()
