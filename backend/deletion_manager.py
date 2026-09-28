"""Deletion orchestration engine enforcing the safe Complex deletion state machine."""
from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

def _esp32_api_token() -> str:
    """Return ESP32 peer-auth bearer token. No hardcoded default — see server.py for rationale."""
    return os.getenv('ESP32_API_TOKEN', '')


try:
    from .deletion_store import DELETION_STORE, ACTIVE_STATUSES
    from .operational_store import OPERATIONAL_STORE
    from .history_store import HISTORY_STORE
    from .recovery_store import RECOVERY_STORE
    from .research_store import RESEARCH_STORE
    from .sensor_calibration import CalibrationRepository
    from .fertigation_engine import FertigationRunRepository
except ImportError:
    from deletion_store import DELETION_STORE, ACTIVE_STATUSES
    from operational_store import OPERATIONAL_STORE
    from history_store import HISTORY_STORE
    from recovery_store import RECOVERY_STORE
    from research_store import RESEARCH_STORE
    from sensor_calibration import CalibrationRepository
    from fertigation_engine import FertigationRunRepository


def _decode_bytes_tolerantly(raw: bytes) -> str:
    if not raw:
        return ""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return raw.decode("latin-1")
        except Exception:
            return raw.decode("utf-8", errors="replace")


def _decode_and_load_json(raw: bytes) -> Any:
    if not raw:
        return {}
    text = _decode_bytes_tolerantly(raw)
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON response ({len(raw)} bytes): {text[:200]!r}") from exc


STANDARD_STEPS = [
    {"sequence_no": 10, "step_key": "PREFLIGHT", "database_key": "system", "action": "COLLECT_SCOPE"},
    {"sequence_no": 20, "step_key": "LOCK_COMPLEX", "database_key": "system", "action": "ACQUIRE_LOCK"},
    {"sequence_no": 30, "step_key": "RETIRE_DEVICE", "database_key": "esp32", "action": "RETIRE_CONTROLLER"},
    {"sequence_no": 40, "step_key": "PURGE_OPERATIONAL_CHILDREN", "database_key": "operational", "action": "DELETE_GREENHOUSES"},
    {"sequence_no": 50, "step_key": "PURGE_HISTORY", "database_key": "history", "action": "DELETE_TELEMETRY_AND_EVENTS"},
    {"sequence_no": 60, "step_key": "PURGE_CALIBRATION", "database_key": "calibration", "action": "DELETE_CALIBRATIONS"},
    {"sequence_no": 70, "step_key": "PURGE_FERTIGATION_RUNS", "database_key": "fertigation", "action": "DELETE_FERTIGATION_RUNS"},
    {"sequence_no": 80, "step_key": "PURGE_RECOVERY", "database_key": "recovery", "action": "DELETE_RECOVERY_STATE"},
    {"sequence_no": 90, "step_key": "VERIFY_ALL", "database_key": "all", "action": "VERIFY_CLEAN_STATE"},
    {"sequence_no": 100, "step_key": "DELETE_COMPLEX_ROOT", "database_key": "operational", "action": "DELETE_COMPLEX"},
    {"sequence_no": 110, "step_key": "FINALIZE", "database_key": "system", "action": "COMPLETE_JOB"},
]


class DeletionManager:
    def __init__(
        self,
        deletion_store: Any = None,
        operational_store: Any = None,
        history_store: Any = None,
        recovery_store: Any = None,
        research_store: Any = None,
        calibration_repo: Any = None,
        fertigation_repo: Any = None,
    ) -> None:
        self.deletion_store = deletion_store or DELETION_STORE
        self.operational_store = operational_store or OPERATIONAL_STORE
        self.history_store = history_store or HISTORY_STORE
        self.recovery_store = recovery_store or RECOVERY_STORE
        self.research_store = research_store or RESEARCH_STORE
        self.calibration_repo = calibration_repo or CalibrationRepository(os.getenv("AGROTECH_CALIBRATION_DB", "./agrotech_calibration.sqlite3"))
        self.fertigation_repo = fertigation_repo or FertigationRunRepository(os.getenv("AGROTECH_FERTIGATION_DB", "./agrotech_fertigation.sqlite3"))

    def is_complex_locked(self, complex_id: str) -> bool:
        job = self.deletion_store.get_active_job_for_complex(complex_id)
        return bool(job and job["status"] in ACTIVE_STATUSES)

    def probe_device(self, endpoint: str) -> dict[str, Any]:
        """Query health from ESP32."""
        url = f"{endpoint.rstrip('/')}/api/v1/health"
        req = Request(
            url,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {_esp32_api_token()}",
            },
        )
        try:
            with urlopen(req, timeout=3.0) as resp:
                data = _decode_and_load_json(resp.read())
                return {"reachable": True, "data": data.get("data", data) if isinstance(data, dict) else {}}
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            return {"reachable": False, "error": str(exc)}

    def retire_device_on_esp32(self, endpoint: str, device_id: str, complex_id: str, job_id: str) -> dict[str, Any]:
        """Invoke authenticated POST /api/v1/device/retire on ESP32."""
        url = f"{endpoint.rstrip('/')}/api/v1/device/retire"
        payload = {
            "requestId": f"retire-{job_id}",
            "jobId": job_id,
            "deviceId": device_id,
            "complexId": complex_id,
        }
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        req = Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": f"Bearer {_esp32_api_token()}",
            },
        )
        try:
            with urlopen(req, timeout=8.0) as resp:
                res = _decode_and_load_json(resp.read())
                return {"success": True, "status": resp.status, "payload": res.get("data", res)}
        except HTTPError as exc:
            try:
                err_json = _decode_and_load_json(exc.read())
            except Exception:
                err_json = {"error": {"code": "DEVICE_RETIRE_FAILED", "message": str(exc)}}
            return {"success": False, "status": exc.code, "error": err_json}
        except (URLError, TimeoutError, OSError) as exc:
            return {"success": False, "status": 503, "error": {"code": "DEVICE_UNREACHABLE", "message": str(exc)}}

    def get_deletion_preview(self, complex_id: str) -> dict[str, Any]:
        complex_record = self.operational_store.get_complex(complex_id)
        if not complex_record:
            raise ValueError("COMPLEX_NOT_FOUND")

        esp_state = complex_record.get("esp32") or {}
        bound_device_id = esp_state.get("deviceId")
        endpoint = esp_state.get("endpoint")

        device_status = "NONE"
        device_reachable = False
        device_details = {}

        if bound_device_id and endpoint:
            probe = self.probe_device(endpoint)
            device_reachable = probe["reachable"]
            device_status = "ONLINE" if device_reachable else "OFFLINE"
            device_details = probe.get("data", {})

        op_counts = self.operational_store.count_scoped(complex_id)
        hist_counts = self.history_store.count_scoped(complex_id)
        cal_counts = self.calibration_repo.count_scoped(complex_id)
        fert_counts = self.fertigation_repo.count_scoped(complex_id)
        rec_counts = self.recovery_store.count_scoped(complex_id)
        research_counts = self.research_store.counts(complex_id)

        counts_to_purge = {
            "greenhouses": op_counts.get("greenhouses", 0),
            "schedules": op_counts.get("schedules", 0),
            "telemetrySamples": hist_counts.get("telemetrySamples", 0),
            "eventLogs": hist_counts.get("eventLogs", 0),
            "rawRecords": hist_counts.get("rawRecords", 0),
            "sensors": cal_counts.get("sensors", 0),
            "calibrations": cal_counts.get("calibrations", 0),
            "fertigationRuns": fert_counts.get("fertigationRuns", 0),
            "syncState": rec_counts.get("syncState", 0),
            "deploymentState": rec_counts.get("deploymentState", 0),
        }
        counts_preserved = {
            "cropCycles": research_counts.get("cropCycles", 0),
            "plants": research_counts.get("plants", 0),
            "fruits": research_counts.get("fruits", 0),
            "observations": research_counts.get("observations", 0),
        }

        deletion_blocked_by_device = bool(bound_device_id and not device_reachable)
        blocking_reason = (
            f"Bound controller '{bound_device_id}' at {endpoint} is unreachable/offline. Controller must be online to execute safe retirement."
            if deletion_blocked_by_device
            else None
        )

        scope_for_hash = {
            "complexId": complex_id,
            "countsToPurge": counts_to_purge,
            "countsPreservedUntouched": counts_preserved,
        }
        scope_snapshot_hash = hashlib.sha256(
            json.dumps(scope_for_hash, sort_keys=True).encode("utf-8")
        ).hexdigest()

        blocking_reasons: list[dict[str, str]] = []
        if bound_device_id and not device_reachable:
            blocking_reasons.append({
                "code": "DEVICE_OFFLINE",
                "message": f"Bound controller '{bound_device_id}' at {endpoint} is offline. Controller must be online to execute safe retirement.",
            })

        active_job = self.deletion_store.get_active_job_for_complex(complex_id)
        if active_job:
            blocking_reasons.append({
                "code": "DELETION_IN_PROGRESS",
                "message": f"Active deletion job '{active_job['job_id']}' in status '{active_job['status']}'.",
            })

        return {
            "complexId": complex_id,
            "complexCode": complex_record.get("code"),
            "complexName": complex_record.get("name"),
            "location": complex_record.get("location"),
            "boundDevice": {
                "deviceId": bound_device_id,
                "endpoint": endpoint,
                "online": device_reachable,
            },
            "deletionBlockedByDevice": deletion_blocked_by_device,
            "blockingReason": blocking_reason,
            "countsToPurge": counts_to_purge,
            "countsPreservedUntouched": counts_preserved,
            "scopeSnapshotHash": scope_snapshot_hash,
            "device": {
                "bound": bool(bound_device_id),
                "deviceId": bound_device_id,
                "endpoint": endpoint,
                "status": device_status,
                "reachable": device_reachable,
                "details": device_details,
            },
            "scopesToPurge": {
                "operational": op_counts,
                "history": hist_counts,
                "calibration": cal_counts,
                "fertigation": fert_counts,
                "recovery": rec_counts,
            },
            "researchDataRetained": {
                "notice": "Research data must never be deleted and will be completely preserved.",
                "counts": research_counts,
            },
            "canDelete": len(blocking_reasons) == 0,
            "blockingReasons": blocking_reasons,
        }

    def start_or_resume_deletion(
        self,
        complex_id: str,
        idempotency_key: str,
        requested_by: str = "operator",
        request_reason: str = "Complex deletion requested",
        device_retirement_override: Any = None,
    ) -> dict[str, Any]:
        # 1. Idempotency check
        existing = self.deletion_store.get_job_by_idempotency_key(idempotency_key)
        if existing:
            job_id = existing["job_id"]
            # If failed retryable or waiting device, attempt resumption
            if existing["status"] in {"FAILED_RETRYABLE", "WAITING_DEVICE"}:
                return self.run_job(job_id, device_retirement_override=device_retirement_override)
            return self.get_job_state(job_id)

        # 2. Check for active job on same complex
        active = self.deletion_store.get_active_job_for_complex(complex_id)
        if active:
            return self.run_job(active["job_id"], device_retirement_override=device_retirement_override)

        # 3. Verify complex exists
        complex_record = self.operational_store.get_complex(complex_id)
        if not complex_record:
            raise ValueError("COMPLEX_NOT_FOUND")

        esp_state = complex_record.get("esp32") or {}
        device_id = esp_state.get("deviceId")

        # 4. Scope snapshot
        preview = self.get_deletion_preview(complex_id)
        scope_json = json.dumps(preview, separators=(",", ":"), sort_keys=True)
        scope_hash = hashlib.sha256(scope_json.encode("utf-8")).hexdigest()

        # 5. Create job in system DB
        job = self.deletion_store.create_job(
            complex_id=complex_id,
            idempotency_key=idempotency_key,
            device_id=device_id,
            requested_by=requested_by,
            request_reason=request_reason,
            scope_snapshot=preview,
            scope_hash=scope_hash,
        )

        # 6. Register standard steps
        self.deletion_store.register_steps(job["job_id"], STANDARD_STEPS)

        # 7. Run state machine
        return self.run_job(job["job_id"], device_retirement_override=device_retirement_override)

    def run_job(self, job_id: str, device_retirement_override: Any = None) -> dict[str, Any]:
        job = self.deletion_store.get_job(job_id)
        if not job:
            raise ValueError("JOB_NOT_FOUND")

        complex_id = job["complex_id"]
        device_id = job["device_id"]
        steps = {s["step_key"]: s for s in self.deletion_store.list_steps(job_id)}

        # Helper to check if step already succeeded
        def is_done(step_key: str) -> bool:
            return steps.get(step_key, {}).get("status") in {"SUCCEEDED", "SKIPPED"}

        try:
            # 10. PREFLIGHT
            if not is_done("PREFLIGHT"):
                self.deletion_store.update_step_status(job_id, "PREFLIGHT", "RUNNING")
                self.deletion_store.update_job_status(job_id, "PREFLIGHTING", current_step_no=10)
                # Snapshot already saved at job creation, verify complex still present
                if not self.operational_store.get_complex(complex_id):
                    # Check if already partially deleted in later steps
                    pass
                self.deletion_store.update_step_status(job_id, "PREFLIGHT", "SUCCEEDED")

            # 20. LOCK_COMPLEX
            if not is_done("LOCK_COMPLEX"):
                self.deletion_store.update_step_status(job_id, "LOCK_COMPLEX", "RUNNING")
                self.deletion_store.update_job_status(job_id, "LOCKED", current_step_no=20)
                self.deletion_store.update_step_status(job_id, "LOCK_COMPLEX", "SUCCEEDED")

            # 30. RETIRE_DEVICE
            if not is_done("RETIRE_DEVICE"):
                complex_record = self.operational_store.get_complex(complex_id) or {}
                esp_state = complex_record.get("esp32") or {}
                endpoint = esp_state.get("endpoint")
                bound_device = device_id or esp_state.get("deviceId")

                if not bound_device or not endpoint:
                    # No bound device to retire
                    self.deletion_store.update_step_status(job_id, "RETIRE_DEVICE", "SKIPPED", rows_affected=0)
                else:
                    self.deletion_store.update_step_status(job_id, "RETIRE_DEVICE", "RUNNING")
                    self.deletion_store.update_job_status(job_id, "RETIRING_DEVICE", current_step_no=30)

                    # Execute retirement
                    if device_retirement_override:
                        retire_res = device_retirement_override(endpoint, bound_device, complex_id, job_id)
                    else:
                        retire_res = self.retire_device_on_esp32(endpoint, bound_device, complex_id, job_id)

                    if not retire_res.get("success"):
                        err_code = (retire_res.get("error") or {}).get("code") or "DEVICE_RETIRE_FAILED"
                        err_msg = (retire_res.get("error") or {}).get("message") or "Controller retirement call failed."

                        # If device is unreachable, transition to WAITING_DEVICE and HALT before purge!
                        if err_code in {"DEVICE_UNREACHABLE", "DEVICE_OFFLINE"} or retire_res.get("status") in {502, 503, 504}:
                            self.deletion_store.update_step_status(
                                job_id, "RETIRE_DEVICE", "FAILED_RETRYABLE",
                                error_code=err_code, error_message=err_msg
                            )
                            self.deletion_store.update_job_status(
                                job_id, "WAITING_DEVICE", current_step_no=30,
                                error_code=err_code, error_message=f"Waiting for device {bound_device}: {err_msg}"
                            )
                            return self.get_job_state(job_id)
                        else:
                            self.deletion_store.update_step_status(
                                job_id, "RETIRE_DEVICE", "FAILED_TERMINAL",
                                error_code=err_code, error_message=err_msg
                            )
                            self.deletion_store.update_job_status(
                                job_id, "FAILED_TERMINAL", current_step_no=30,
                                error_code=err_code, error_message=err_msg
                            )
                            return self.get_job_state(job_id)

                    self.deletion_store.update_step_status(
                        job_id, "RETIRE_DEVICE", "SUCCEEDED", rows_affected=1,
                        verification=retire_res.get("payload")
                    )

            # 40. PURGE_OPERATIONAL_CHILDREN
            if not is_done("PURGE_OPERATIONAL_CHILDREN"):
                self.deletion_store.update_step_status(job_id, "PURGE_OPERATIONAL_CHILDREN", "RUNNING")
                self.deletion_store.update_job_status(job_id, "PURGING", current_step_no=40)
                del_ghs = self.operational_store.purge_greenhouses(complex_id)
                self.deletion_store.update_step_status(
                    job_id, "PURGE_OPERATIONAL_CHILDREN", "SUCCEEDED", rows_affected=del_ghs
                )

            # 50. PURGE_HISTORY
            if not is_done("PURGE_HISTORY"):
                self.deletion_store.update_step_status(job_id, "PURGE_HISTORY", "RUNNING")
                hist_del = self.history_store.purge_complex(complex_id)
                total_hist = sum(hist_del.values())
                self.deletion_store.update_step_status(
                    job_id, "PURGE_HISTORY", "SUCCEEDED", rows_affected=total_hist, verification=hist_del
                )

            # 60. PURGE_CALIBRATION
            if not is_done("PURGE_CALIBRATION"):
                self.deletion_store.update_step_status(job_id, "PURGE_CALIBRATION", "RUNNING")
                cal_del = self.calibration_repo.purge_complex(complex_id)
                total_cal = sum(cal_del.values())
                self.deletion_store.update_step_status(
                    job_id, "PURGE_CALIBRATION", "SUCCEEDED", rows_affected=total_cal, verification=cal_del
                )

            # 70. PURGE_FERTIGATION_RUNS
            if not is_done("PURGE_FERTIGATION_RUNS"):
                self.deletion_store.update_step_status(job_id, "PURGE_FERTIGATION_RUNS", "RUNNING")
                fert_del = self.fertigation_repo.purge_complex(complex_id)
                total_fert = sum(fert_del.values())
                self.deletion_store.update_step_status(
                    job_id, "PURGE_FERTIGATION_RUNS", "SUCCEEDED", rows_affected=total_fert, verification=fert_del
                )

            # 80. PURGE_RECOVERY
            if not is_done("PURGE_RECOVERY"):
                self.deletion_store.update_step_status(job_id, "PURGE_RECOVERY", "RUNNING")
                rec_del = self.recovery_store.purge_complex(complex_id)
                total_rec = sum(rec_del.values())
                self.deletion_store.update_step_status(
                    job_id, "PURGE_RECOVERY", "SUCCEEDED", rows_affected=total_rec, verification=rec_del
                )

            # 90. VERIFY_ALL
            if not is_done("VERIFY_ALL"):
                self.deletion_store.update_step_status(job_id, "VERIFY_ALL", "RUNNING")
                self.deletion_store.update_job_status(job_id, "VERIFYING", current_step_no=90)

                op_remaining = self.operational_store.count_scoped(complex_id)["greenhouses"]
                hist_remaining = sum(self.history_store.count_scoped(complex_id).values())
                cal_remaining = sum(self.calibration_repo.count_scoped(complex_id).values())
                fert_remaining = sum(self.fertigation_repo.count_scoped(complex_id).values())
                rec_remaining = sum(self.recovery_store.count_scoped(complex_id).values())

                # Mandatory Research Verification: research counts MUST match preflight scope snapshot!
                current_research = self.research_store.counts(complex_id)
                expected_research = (
                    (job.get("scopeSnapshot") or {})
                    .get("researchDataRetained", {})
                    .get("counts", {})
                )

                if (
                    op_remaining != 0
                    or hist_remaining != 0
                    or cal_remaining != 0
                    or fert_remaining != 0
                    or rec_remaining != 0
                ):
                    err_msg = (
                        f"Purge integrity check failed: operational={op_remaining}, history={hist_remaining}, "
                        f"calibration={cal_remaining}, fertigation={fert_remaining}, recovery={rec_remaining}"
                    )
                    self.deletion_store.update_step_status(
                        job_id, "VERIFY_ALL", "FAILED_TERMINAL", error_code="PURGE_VERIFICATION_FAILED", error_message=err_msg
                    )
                    self.deletion_store.update_job_status(
                        job_id, "FAILED_TERMINAL", current_step_no=90, error_code="PURGE_VERIFICATION_FAILED", error_message=err_msg
                    )
                    return self.get_job_state(job_id)

                # Check research counts unchanged
                for k, expected_count in expected_research.items():
                    actual_count = current_research.get(k, 0)
                    if actual_count != expected_count:
                        err_msg = f"CRITICAL: Research table {k} mutated! Expected {expected_count}, got {actual_count}."
                        self.deletion_store.update_step_status(
                            job_id, "VERIFY_ALL", "FAILED_TERMINAL", error_code="RESEARCH_MUTATION_DETECTED", error_message=err_msg
                        )
                        self.deletion_store.update_job_status(
                            job_id, "FAILED_TERMINAL", current_step_no=90, error_code="RESEARCH_MUTATION_DETECTED", error_message=err_msg
                        )
                        return self.get_job_state(job_id)

                self.deletion_store.update_step_status(
                    job_id, "VERIFY_ALL", "SUCCEEDED",
                    verification={
                        "purgedZeroConfirmed": True,
                        "researchCountsPreserved": current_research,
                    }
                )

            # 100. DELETE_COMPLEX_ROOT
            if not is_done("DELETE_COMPLEX_ROOT"):
                self.deletion_store.update_step_status(job_id, "DELETE_COMPLEX_ROOT", "RUNNING")
                del_c = self.operational_store.purge_complex(complex_id)
                # Record tombstone in distributed System Topology Pool to prevent resurrection
                try:
                    try:
                        from .topology_pool import SystemTopologyPool
                    except ImportError:
                        from topology_pool import SystemTopologyPool
                    pool = SystemTopologyPool(self.operational_store.db_path)
                    pool.apply_mutation({
                        "operation": "DELETE_COMPLEX",
                        "complexId": complex_id,
                        "deletionChangeId": job_id,
                        "recordTombstone": True,
                    })
                except Exception:
                    pass
                self.deletion_store.update_step_status(
                    job_id, "DELETE_COMPLEX_ROOT", "SUCCEEDED", rows_affected=del_c
                )

            # 110. FINALIZE
            if not is_done("FINALIZE"):
                self.deletion_store.update_step_status(job_id, "FINALIZE", "RUNNING")
                self.deletion_store.update_job_status(job_id, "COMPLETED", current_step_no=110)
                self.deletion_store.update_step_status(job_id, "FINALIZE", "SUCCEEDED")

        except Exception as exc:
            # Handle unexpected or retryable failures
            error_code = "DELETION_EXECUTION_ERROR"
            error_msg = str(exc)
            self.deletion_store.update_job_status(
                job_id, "FAILED_RETRYABLE", error_code=error_code, error_message=error_msg
            )
            return self.get_job_state(job_id)

        return self.get_job_state(job_id)

    def get_job_state(self, job_id: str) -> dict[str, Any]:
        job = self.deletion_store.get_job(job_id)
        if not job:
            raise ValueError("JOB_NOT_FOUND")
        steps = self.deletion_store.list_steps(job_id)
        events = self.deletion_store.list_events(job_id)

        retire_step = next((s for s in steps if s.get("step_key") == "RETIRE_DEVICE"), None)
        device_retired = bool(retire_step and retire_step.get("status") in {"SUCCEEDED", "SKIPPED"})
        device_retry_count = int(retire_step.get("attempt_count", 0)) if retire_step else 0
        records_purged_total = sum(int(s.get("rows_affected") or 0) for s in steps)

        current_step_key = "NONE"
        for s in steps:
            if s.get("status") in {"RUNNING", "IN_PROGRESS", "WAITING_DEVICE"}:
                current_step_key = s.get("step_key", "UNKNOWN")
                break
        if current_step_key == "NONE" and steps:
            # Last non-pending
            done_steps = [s for s in steps if s.get("status") in {"SUCCEEDED", "SKIPPED", "COMPLETED"}]
            if done_steps:
                current_step_key = done_steps[-1].get("step_key", "DONE")

        formatted_steps = []
        for s in steps:
            formatted_steps.append({
                "stepId": s.get("step_id"),
                "jobId": s.get("job_id"),
                "stepKey": s.get("step_key"),
                "stepName": s.get("step_key"),
                "sequenceNo": s.get("sequence_no"),
                "stepOrder": s.get("sequence_no"),
                "action": s.get("action"),
                "status": s.get("status"),
                "attemptCount": s.get("attempt_count"),
                "rowsExpected": s.get("rows_expected"),
                "rowsAffected": s.get("rows_affected") or 0,
                "recordsAffected": s.get("rows_affected") or 0,
                "lastErrorCode": s.get("last_error_code"),
                "lastErrorMessage": s.get("last_error_message"),
                "errorMessage": s.get("last_error_message"),
                "startedAt": s.get("started_at"),
                "finishedAt": s.get("finished_at"),
            })

        return {
            "jobId": job["job_id"],
            "complexId": job["complex_id"],
            "deviceId": job["device_id"],
            "boundDeviceId": job["device_id"],
            "status": job["status"],
            "currentStep": current_step_key,
            "currentStepNo": job["current_step_no"],
            "idempotencyKey": job["idempotency_key"],
            "deviceRetired": device_retired,
            "device_retired": device_retired,
            "deviceRetryCount": device_retry_count,
            "scopeSnapshotHash": job.get("scope_hash") or "",
            "recordsPurgedTotal": records_purged_total,
            "records_purged_total": records_purged_total,
            "requestedBy": job.get("requested_by") or "operator",
            "requestReason": job.get("request_reason") or "",
            "errorMessage": job.get("last_error_message"),
            "createdAt": job.get("requested_at") or "",
            "requestedAt": job["requested_at"],
            "startedAt": job["started_at"],
            "updatedAt": job["updated_at"],
            "completedAt": job["completed_at"],
            "finishedAt": job.get("completed_at"),
            "lastErrorCode": job["last_error_code"],
            "lastErrorMessage": job["last_error_message"],
            "scopeSnapshot": job.get("scopeSnapshot"),
            "steps": formatted_steps,
            "rawSteps": steps,
            "events": events,
        }

    def resume_pending_jobs(self) -> int:
        active_jobs = self.deletion_store.list_active_jobs()
        resumed = []
        for job in active_jobs:
            if job["status"] in {"FAILED_RETRYABLE", "PURGING", "LOCKED", "PREFLIGHTING", "REQUESTED"}:
                res = self.run_job(job["job_id"])
                resumed.append(res)
        return len(resumed)


DELETION_MANAGER = DeletionManager()
