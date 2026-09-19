"""M11 sensor abstraction and versioned calibration persistence.

Stdlib-only so the engineering/test environment does not require an additional package.
The module deliberately represents unavailable/stale measurements explicitly rather than
inventing numeric values.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SENSOR_TYPES = {
    "TEMPERATURE", "HUMIDITY", "LIGHT", "LEVEL", "FLOW", "PRESSURE",
    "PH", "EC", "DOSING_OUTPUT",
}
QUALITY_STATES = {"VALID", "INVALID", "STALE", "TIMEOUT", "DISCONNECTED", "OUT_OF_RANGE", "UNAVAILABLE"}
CAL_STATES = {"NOT_CALIBRATED", "CALIBRATED", "VERIFIED", "EXPIRED", "SUSPECT", "RECALIBRATED", "REMOVED"}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def validate_sensor_definition(sensor: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not isinstance(sensor, dict):
        return [{"code": "SENSOR_DEFINITION_REQUIRED", "message": "Sensor definition must be an object."}]
    if not _text(sensor.get("sensorId")):
        errors.append({"code": "SENSOR_ID_REQUIRED", "message": "sensorId is required."})
    stype = _text(sensor.get("sensorType")).upper()
    if stype not in SENSOR_TYPES:
        errors.append({"code": "INVALID_SENSOR_TYPE", "message": f"Unsupported sensor type '{stype}'."})
    channel = sensor.get("channel")
    if channel is not None and (not isinstance(channel, int) or isinstance(channel, bool) or channel < 0):
        errors.append({"code": "INVALID_SENSOR_CHANNEL", "message": "channel must be a non-negative integer when provided."})
    if not _text(sensor.get("source")):
        errors.append({"code": "SENSOR_SOURCE_REQUIRED", "message": "source is required."})
    if not _text(sensor.get("unit")):
        errors.append({"code": "SENSOR_UNIT_REQUIRED", "message": "unit is required."})
    if not _text(sensor.get("complexId")):
        errors.append({"code": "SENSOR_COMPLEX_REQUIRED", "message": "complexId is required for sensor ownership."})
    interval = sensor.get("samplingIntervalMs")
    if not isinstance(interval, int) or isinstance(interval, bool) or interval <= 0:
        errors.append({"code": "INVALID_SAMPLING_INTERVAL", "message": "samplingIntervalMs must be a positive integer."})
    minimum = sensor.get("minValue")
    maximum = sensor.get("maxValue")
    if minimum is not None and not isinstance(minimum, (int, float)):
        errors.append({"code": "INVALID_MIN_VALUE", "message": "minValue must be numeric or null."})
    if maximum is not None and not isinstance(maximum, (int, float)):
        errors.append({"code": "INVALID_MAX_VALUE", "message": "maxValue must be numeric or null."})
    if isinstance(minimum, (int, float)) and isinstance(maximum, (int, float)) and minimum >= maximum:
        errors.append({"code": "INVALID_VALIDITY_RANGE", "message": "minValue must be less than maxValue."})
    return errors


def normalize_sensor_sample(definition: dict[str, Any], value: Any, timestamp_ms: int | None = None, quality: str | None = None) -> dict[str, Any]:
    errors = validate_sensor_definition(definition)
    if errors:
        raise ValueError(errors[0]["message"])
    now = int(timestamp_ms if timestamp_ms is not None else time.time() * 1000)
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return {"sensorId": definition["sensorId"], "timestampMs": now, "value": None, "unit": definition["unit"], "quality": "INVALID", "measurementType": "INVALID"}
    q = (quality or "VALID").upper()
    maximum_age = max(int(definition["samplingIntervalMs"]) * 3, 1000)
    last_sample = definition.get("lastSampleTimestampMs")
    if last_sample is not None and now - int(last_sample) > maximum_age:
        q = "STALE"
    minimum = definition.get("minValue")
    maximum = definition.get("maxValue")
    if q == "VALID" and isinstance(minimum, (int, float)) and numeric < minimum:
        q = "OUT_OF_RANGE"
    if q == "VALID" and isinstance(maximum, (int, float)) and numeric > maximum:
        q = "OUT_OF_RANGE"
    if definition.get("installed", True) is False:
        q = "UNAVAILABLE"
    return {
        "sensorId": definition["sensorId"],
        "timestampMs": now,
        "value": numeric if q == "VALID" else None,
        "unit": definition["unit"],
        "quality": q if q in QUALITY_STATES else "INVALID",
        "measurementType": "MEASURED" if q == "VALID" else "UNAVAILABLE" if q == "UNAVAILABLE" else "INVALID",
        "calibrationId": definition.get("calibrationReference"),
    }


@dataclass(frozen=True)
class CalibrationRecord:
    calibrationId: str
    componentId: str
    calibrationType: str
    version: int
    state: str
    createdAtMs: int
    validFromMs: int
    validUntilMs: int | None
    operator: str
    parameters: dict[str, Any]
    complexId: str = ""

    @property
    def usable(self) -> bool:
        now = int(time.time() * 1000)
        if self.state not in {"CALIBRATED", "VERIFIED", "RECALIBRATED"}:
            return False
        return self.validUntilMs is None or now <= self.validUntilMs


    def apply(self, input_value: float) -> float:
        if not self.usable or not self.parameters:
            raise ValueError("CALIBRATION_REQUIRED")
        if self.calibrationType == "DOSING_RATE":
            raise ValueError("CALIBRATION_TYPE_NOT_LINEAR")
        return float(self.parameters.get("slope", 0.0)) * float(input_value) + float(self.parameters.get("offset", 0.0))

    def rate_ml_per_sec(self, requested_ml: float) -> float:
        if self.calibrationType != "DOSING_RATE" or not self.usable:
            raise ValueError("CALIBRATION_REQUIRED")
        rate = float(self.parameters.get("rateMlPerSec", 0))
        if rate <= 0:
            raise ValueError("CALIBRATION_RATE_INVALID")
        return rate


def build_dosing_calibration(component_id: str, measured_ml: float, duration_sec: float, operator: str, state: str = "CALIBRATED", version: int = 1, valid_for_days: int | None = None, calibration_id: str | None = None, complex_id: str = "") -> CalibrationRecord:
    if measured_ml <= 0 or duration_sec <= 0:
        raise ValueError("Measured volume and duration must be > 0")
    now = int(time.time() * 1000)
    return CalibrationRecord(
        calibrationId=calibration_id or f"cal-{uuid.uuid4().hex[:12]}",
        componentId=component_id,
        calibrationType="DOSING_RATE",
        version=version,
        state=state,
        createdAtMs=now,
        validFromMs=now,
        validUntilMs=None if valid_for_days is None else now + valid_for_days * 86400000,
        operator=operator,
        parameters={"measuredMl": measured_ml, "durationSec": duration_sec, "rateMlPerSec": measured_ml / duration_sec},
        complexId=complex_id,
    )


def build_linear_calibration(component_id: str, calibration_type: str, input_one: float, output_one: float, input_two: float, output_two: float, operator: str, version: int = 1, state: str = "CALIBRATED", calibration_id: str | None = None, valid_for_days: int | None = None, valid_until_ms: int | None = None, complex_id: str = "", pulses_per_liter: float | None = None) -> CalibrationRecord:
    calibration_type = _text(calibration_type).upper()
    if calibration_type not in {"FLOW","LEVEL","PH","EC"}:
        raise ValueError("INVALID_CALIBRATION_TYPE")
    if not _text(operator):
        raise ValueError("CALIBRATION_OPERATOR_REQUIRED")
    if version < 1:
        raise ValueError("INVALID_CALIBRATION_VERSION")
    if input_one == input_two:
        raise ValueError("Calibration points must have different inputs")
    slope = (output_two - output_one) / (input_two - input_one)
    offset = output_one - slope * input_one
    now = int(time.time() * 1000)
    return CalibrationRecord(
        calibrationId=calibration_id or f"cal-{uuid.uuid4().hex[:12]}",
        componentId=component_id,
        calibrationType=calibration_type,
        version=version,
        state=state,
        createdAtMs=now,
        validFromMs=now,
        validUntilMs=valid_until_ms if valid_until_ms is not None else (None if valid_for_days is None else now + valid_for_days * 86400000),
        operator=operator,
        parameters={"slope": slope, "offset": offset, "points": [[input_one, output_one], [input_two, output_two]], **({"pulsesPerLiter": float(pulses_per_liter)} if pulses_per_liter is not None else {})},
        complexId=complex_id,
    )


def validate_calibration_record(record: CalibrationRecord, *, expected_complex_id: str | None = None, expected_component_id: str | None = None, expected_calibration_id: str | None = None, expected_version: int | None = None) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not _text(record.calibrationId):
        errors.append({"code": "CALIBRATION_ID_REQUIRED", "message": "calibrationId is required."})
    if not _text(record.componentId):
        errors.append({"code": "CALIBRATION_COMPONENT_REQUIRED", "message": "componentId is required."})
    if record.calibrationType not in {"DOSING_RATE", "FLOW", "LEVEL", "PH", "EC"}:
        errors.append({"code": "INVALID_CALIBRATION_TYPE", "message": "Unsupported calibration type."})
    if record.version < 1:
        errors.append({"code": "INVALID_CALIBRATION_VERSION", "message": "Calibration version must be >= 1."})
    if record.state not in CAL_STATES:
        errors.append({"code": "INVALID_CALIBRATION_STATE", "message": "Unsupported calibration lifecycle state."})
    if not _text(record.operator):
        errors.append({"code": "CALIBRATION_OPERATOR_REQUIRED", "message": "Calibration operator is required."})
    if not _text(record.complexId):
        errors.append({"code": "CALIBRATION_COMPLEX_REQUIRED", "message": "Complex ownership is required."})
    if expected_complex_id is not None and record.complexId != expected_complex_id:
        errors.append({"code": "CALIBRATION_COMPLEX_MISMATCH", "message": "Calibration belongs to another Complex."})
    if expected_component_id is not None and record.componentId != expected_component_id:
        errors.append({"code": "CALIBRATION_COMPONENT_MISMATCH", "message": "Calibration belongs to another component."})
    if expected_calibration_id is not None and record.calibrationId != expected_calibration_id:
        errors.append({"code": "CALIBRATION_ID_MISMATCH", "message": "Calibration ID does not match the requested record."})
    if expected_version is not None and record.version != expected_version:
        errors.append({"code": "CALIBRATION_VERSION_MISMATCH", "message": "Calibration version does not match the requested record."})
    if record.validUntilMs is not None and record.validUntilMs < record.validFromMs:
        errors.append({"code": "CALIBRATION_VALIDITY_INVALID", "message": "validUntilMs cannot precede validFromMs."})
    return errors


class CalibrationRepository:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _connect(self):
        con = sqlite3.connect(self.db_path)
        con.row_factory = sqlite3.Row
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()

    def _init_db(self) -> None:
        with self._connect() as con:
            con.executescript("""
            CREATE TABLE IF NOT EXISTS sensor_definitions (
              sensor_id TEXT PRIMARY KEY, definition_json TEXT NOT NULL,
              created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS calibration_records (
              calibration_id TEXT PRIMARY KEY, component_id TEXT NOT NULL,
              calibration_type TEXT NOT NULL, version INTEGER NOT NULL,
              state TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
              valid_from_ms INTEGER NOT NULL, valid_until_ms INTEGER,
              operator TEXT NOT NULL, parameters_json TEXT NOT NULL,
              complex_id TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_cal_component ON calibration_records(complex_id, component_id, calibration_type, version DESC);
            """)
            cols = {row[1] for row in con.execute("PRAGMA table_info(calibration_records)").fetchall()}
            if "complex_id" not in cols:
                con.execute("ALTER TABLE calibration_records ADD COLUMN complex_id TEXT NOT NULL DEFAULT ''")

    def save_sensor(self, definition: dict[str, Any]) -> dict[str, Any]:
        errors = validate_sensor_definition(definition)
        if errors:
            raise ValueError(errors[0]["code"])
        definition = dict(definition)
        definition["sensorType"] = _text(definition.get("sensorType")).upper()
        definition["complexId"] = _text(definition.get("complexId"))
        now = int(time.time() * 1000)
        definition.setdefault("installed", True)
        with self._connect() as con:
            existing = con.execute("SELECT definition_json FROM sensor_definitions WHERE sensor_id=?", (definition["sensorId"],)).fetchone()
            if existing:
                prior = json.loads(existing["definition_json"])
                prior_complex = _text(prior.get("complexId"))
                if prior_complex and prior_complex != definition["complexId"]:
                    raise ValueError("SENSOR_COMPLEX_MISMATCH")
            con.execute("INSERT INTO sensor_definitions(sensor_id,definition_json,created_at_ms,updated_at_ms) VALUES(?,?,?,?) ON CONFLICT(sensor_id) DO UPDATE SET definition_json=excluded.definition_json,updated_at_ms=excluded.updated_at_ms", (definition["sensorId"], json.dumps(definition, separators=(",", ":")), now, now))
        return definition

    def sensors(self, complex_id: str | None = None) -> list[dict[str, Any]]:
        with self._connect() as con:
            rows = con.execute("SELECT definition_json FROM sensor_definitions ORDER BY sensor_id").fetchall()
        sensors = [json.loads(row["definition_json"]) for row in rows]
        if complex_id:
            sensors = [s for s in sensors if s.get("complexId") == complex_id]
        return sensors

    def save(self, record: CalibrationRecord) -> CalibrationRecord:
        errors = validate_calibration_record(record)
        if errors:
            raise ValueError(errors[0]["code"])
        with self._connect() as con:
            latest = con.execute("SELECT MAX(version) v FROM calibration_records WHERE complex_id=? AND component_id=? AND calibration_type=?", (record.complexId, record.componentId, record.calibrationType)).fetchone()[0]
            if latest is not None and record.version <= int(latest):
                raise ValueError("CALIBRATION_VERSION_CONFLICT")
            con.execute("INSERT INTO calibration_records(calibration_id,component_id,calibration_type,version,state,created_at_ms,valid_from_ms,valid_until_ms,operator,parameters_json,complex_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                record.calibrationId, record.componentId, record.calibrationType, record.version,
                record.state, record.createdAtMs, record.validFromMs, record.validUntilMs,
                record.operator, json.dumps(record.parameters, separators=(",", ":")), record.complexId,
            ))
        return record

    def next_version(self, component_id: str, calibration_type: str, complex_id: str = "") -> int:
        with self._connect() as con:
            row = con.execute("SELECT COALESCE(MAX(version),0)+1 v FROM calibration_records WHERE complex_id=? AND component_id=? AND calibration_type=?", (complex_id, component_id, calibration_type)).fetchone()
            return int(row["v"])

    def exact(self, complex_id: str, component_id: str, calibration_type: str, calibration_id: str, version: int | None = None) -> CalibrationRecord | None:
        record, reason = self.resolve_exact(complex_id, component_id, calibration_type, calibration_id, version)
        return record if reason is None else None

    def resolve_exact(self, complex_id: str, component_id: str, calibration_type: str, calibration_id: str, version: int | None = None) -> tuple[CalibrationRecord | None, str | None]:
        """Resolve an explicitly referenced calibration without substituting another record.

        Returns (record, reason). reason is deterministic and ordered from identity to usability:
        UNKNOWN, COMPLEX_MISMATCH, COMPONENT_MISMATCH, TYPE_MISMATCH, VERSION_MISMATCH,
        REMOVED, EXPIRED, SUSPECT, NOT_USABLE.
        """
        if not complex_id or not component_id or not calibration_type or not calibration_id:
            return None, "UNKNOWN"
        with self._connect() as con:
            row = con.execute("SELECT * FROM calibration_records WHERE calibration_id=?", (calibration_id,)).fetchone()
        if not row:
            return None, "UNKNOWN"
        if row["complex_id"] != complex_id:
            return None, "COMPLEX_MISMATCH"
        if row["component_id"] != component_id:
            return None, "COMPONENT_MISMATCH"
        if row["calibration_type"].upper() != calibration_type.upper():
            return None, "TYPE_MISMATCH"
        if version is not None and int(row["version"]) != int(version):
            return None, "VERSION_MISMATCH"
        record = self._row_record(row)
        if record.state == "REMOVED":
            return None, "REMOVED"
        if record.state == "SUSPECT":
            return None, "SUSPECT"
        if record.state == "EXPIRED" or (record.validUntilMs is not None and int(time.time() * 1000) > int(record.validUntilMs)):
            return None, "EXPIRED"
        if not record.usable:
            return None, "NOT_USABLE"
        return record, None

    def active(self, component_id: str, calibration_type: str, complex_id: str = "") -> CalibrationRecord | None:
        with self._connect() as con:
            if complex_id:
                row = con.execute("SELECT * FROM calibration_records WHERE complex_id=? AND component_id=? AND calibration_type=? ORDER BY version DESC LIMIT 1", (complex_id, component_id, calibration_type)).fetchone()
            else:
                row = con.execute("SELECT * FROM calibration_records WHERE component_id=? AND calibration_type=? ORDER BY version DESC LIMIT 1", (component_id, calibration_type)).fetchone()
        return self._row_record(row) if row else None

    @staticmethod
    def _row_record(row: sqlite3.Row) -> CalibrationRecord:
        return CalibrationRecord(row["calibration_id"], row["component_id"], row["calibration_type"], row["version"], row["state"], row["created_at_ms"], row["valid_from_ms"], row["valid_until_ms"], row["operator"], json.loads(row["parameters_json"]), row["complex_id"] or "")

    def history(self, component_id: str | None = None, complex_id: str | None = None) -> list[CalibrationRecord]:
        query = "SELECT * FROM calibration_records WHERE 1=1"
        args: list[Any] = []
        if complex_id:
            query += " AND complex_id=?"; args.append(complex_id)
        if component_id:
            query += " AND component_id=?"; args.append(component_id)
        query += " ORDER BY component_id, calibration_type, version DESC"
        with self._connect() as con:
            rows = con.execute(query, args).fetchall()
        return [self._row_record(r) for r in rows]

    def snapshot(self, component_id: str, calibration_type: str, complex_id: str = "", calibration_id: str | None = None, version: int | None = None) -> dict[str, Any]:
        rec = self.exact(complex_id, component_id, calibration_type, calibration_id, version) if calibration_id else self.active(component_id, calibration_type, complex_id)
        if not rec:
            raise ValueError("CALIBRATION_REQUIRED")
        return {"calibrationId": rec.calibrationId, "componentId": rec.componentId, "calibrationType": rec.calibrationType, "version": rec.version, "state": rec.state, "createdAtMs": rec.createdAtMs, "validFromMs": rec.validFromMs, "validUntilMs": rec.validUntilMs, "parameters": rec.parameters, "operator": rec.operator, "complexId": rec.complexId}
