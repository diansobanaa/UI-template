#!/usr/bin/env python3
import json
import tempfile
from pathlib import Path

from backend.history_store import HistoryStore


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    with tempfile.TemporaryDirectory() as td:
        store = HistoryStore(str(Path(td) / "history.sqlite3"))

        snap10 = {
            "recordType": "TELEMETRY",
            "recordId": "dev-01:telemetry:10",
            "deviceId": "dev-01",
            "complexId": "complex-01",
            "ghId": None,
            "sequence": 10,
            "deviceTimestamp": "2026-09-19T00:00:10Z",
            "samples": [
                {"componentId": "temp-gh01", "metricId": "TEMPERATURE", "source": "DS18B20", "ghId": "gh-01", "value": 29.5, "unit": "C", "quality": "GOOD", "measurementType": "MEASURED", "calibrationId": "cal-temp-1", "calibrationVersion": 3},
                {"componentId": "hum-gh01", "metricId": "HUMIDITY", "source": "SHT31", "ghId": "gh-01", "value": None, "unit": "%", "quality": "BAD", "measurementType": "UNAVAILABLE"},
                {"componentId": "temp-gh02", "metricId": "TEMPERATURE", "source": "DS18B20", "ghId": "gh-02", "value": 30.1, "unit": "C", "quality": "GOOD", "measurementType": "MEASURED"},
            ],
        }
        r1 = store.ingest_telemetry_snapshot(snap10, received_at="2026-09-19T00:01:00Z")
        check(r1["inserted"] is True, "first telemetry record must insert raw record")
        r2 = store.ingest_telemetry_snapshot(snap10, received_at="2026-09-19T00:02:00Z")
        check(r2["inserted"] is False, "duplicate telemetry record must be idempotent")

        snap11 = dict(snap10)
        snap11["recordId"] = "dev-01:telemetry:11"
        snap11["sequence"] = 11
        snap11["deviceTimestamp"] = "2026-09-19T00:00:12Z"
        snap11["samples"] = [dict(snap10["samples"][0], value=30.0)]
        store.ingest_telemetry_snapshot(snap11, received_at="2026-09-19T00:02:00Z")

        hist = store.list_telemetry("complex-01", gh_id="gh-01", after_sequence=0, limit=1)
        check(hist["hasMore"] is True, "telemetry cursor must expose more snapshots")
        check(sorted(set(s["sequence"] for s in hist["samples"])) == [10], "telemetry cursor must paginate by snapshot sequence")
        hist2 = store.list_telemetry("complex-01", gh_id="gh-01", after_sequence=10, limit=10)
        check([s["sequence"] for s in hist2["samples"]] == [11], "telemetry cursor must resume after snapshot sequence")
        gh2 = store.latest_telemetry("complex-01", "gh-02")
        check(gh2 and gh2["value"] == 30.1, "GH association must be preserved")
        missing = next(s for s in store.latest_telemetry_history("complex-01", gh_id="gh-01")["samples"] if s["componentId"] == "hum-gh01")
        check(missing["value"] is None and missing["measurementType"] == "UNAVAILABLE", "missing telemetry must remain unavailable, not zero")
        check(missing["metricId"] == "HUMIDITY" and missing["source"] == "SHT31", "metric/source metadata must persist")

        event = {
            "recordType": "EVENT",
            "recordId": "evt-dev-01-20",
            "eventId": "evt-dev-01-20",
            "deviceId": "dev-01",
            "sequence": 20,
            "deviceTimestamp": "2026-09-19T00:00:20Z",
            "eventType": "FERTIGATION_COMPLETED",
            "severity": "INFO",
            "category": "FERTIGATION",
            "complexId": "complex-01",
            "ghId": "gh-01",
            "componentId": "pump-gh01",
            "commandId": "run-gh01-1",
            "resourceId": "res-gh01",
            "configurationVersion": 9,
            "payload": {"deliveredMl": 12000},
        }
        e1 = store.ingest_event(event, received_at="2026-09-19T00:01:20Z")
        check(e1["inserted"] is True, "first event must insert")
        e2 = store.ingest_event(event, received_at="2026-09-19T00:02:20Z")
        check(e2["inserted"] is False, "duplicate event must be idempotent")
        ev = store.latest_events("complex-01", gh_id="gh-01", limit=10)["events"]
        check(len(ev) == 1, "duplicate event must not create second event")
        got = ev[0]
        check(got["deviceId"] == "dev-01" and got["recordId"] == "evt-dev-01-20", "event identity must persist")
        check(got["commandId"] == "run-gh01-1" and got["resourceId"] == "res-gh01" and got["configurationVersion"] == 9, "event traceability must persist")
        check(got["category"] == "FERTIGATION" and got["payload"]["deliveredMl"] == 12000, "event category/payload must persist")

        raw = store._db.execute("SELECT payload FROM raw_records WHERE record_id = ?", ("dev-01:telemetry:10",)).fetchone()
        check(raw is not None and json.loads(raw["payload"])["samples"][0]["componentId"] == "temp-gh01", "raw record must be retained")

    print("M13 history/ingestion gate PASS")


if __name__ == "__main__":
    main()
