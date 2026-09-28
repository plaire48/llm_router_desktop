# -*- coding: utf-8 -*-
"""Creator와 Runner의 AI 작업을 조회하고 새 작업을 일정 시간 기다린다."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shlex
import subprocess
import sys
import time

from . import mutation_lock, util
from .controller import Controller


_DEFAULT_TIMEOUT_SECONDS = 90.0
_WATCH_WINDOW_SECONDS = 540.0
_MAX_TIMEOUT_SECONDS = _WATCH_WINDOW_SECONDS
_POLL_START_SECONDS = 1.0
_POLL_MAX_SECONDS = 3.0
_WATCH_TYPE = "ops_dashboard_assistant_watch"
_WATCH_LEASE_SECONDS = 15.0
# 정상 반환 뒤 다음 foreground wait가 같은 소유권을 이어받을 짧은 유예다.
_WATCH_HANDOFF_SECONDS = 90.0
# Processing presence is informational, not an exclusive lease.  Keep it
# visible while the delivered job is being handled; a newer watcher can still
# replace it immediately and fence the older result.
_WATCH_PROCESSING_SECONDS = 600.0
_DELIVERY_LEASE_SECONDS = _WATCH_PROCESSING_SECONDS
_UNCHANGED = object()


def _canonical_root(value):
    return os.path.realpath(os.path.abspath(value))


def _watch_path(project_root):
    return os.path.join(
        _canonical_root(project_root), ".ops", "dashboard",
        "assistant-watch.json")


def _dashboard_generation(project_root):
    """Return the current Dashboard boot generation without trusting its PID."""
    root = _canonical_root(project_root)
    path = os.path.join(root, ".ops", "dashboard", "server.json")
    try:
        value = util.load_json(path)
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    if value.get("type") != "ops_dashboard_server":
        return None
    if _canonical_root(value.get("project_root") or "") != root:
        return None
    return str(
        value.get("dashboard_generation")
        or value.get("server_id")
        or "") or None


def _load_watch(project_root):
    try:
        value = util.load_json(_watch_path(project_root))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return value if value.get("type") == _WATCH_TYPE else None


def _watch_is_active(value, now=None):
    if not isinstance(value, dict):
        return False
    now = time.time() if now is None else float(now)
    try:
        expires_at = float(value.get("expires_at") or 0)
    except (TypeError, ValueError):
        return False
    return (
        value.get("type") == _WATCH_TYPE
        and value.get("state") in ("waiting", "processing")
        and expires_at > now
    )


def _watch_budget(value, default_window=_WATCH_WINDOW_SECONDS):
    value = value if isinstance(value, dict) else {}
    try:
        window_seconds = float(
            value.get("window_seconds") or default_window)
    except (TypeError, ValueError):
        window_seconds = float(default_window)
    try:
        waited_seconds = float(value.get("waited_seconds") or 0)
    except (TypeError, ValueError):
        waited_seconds = 0.0
    window_seconds = max(0.1, window_seconds)
    waited_seconds = max(0.0, min(waited_seconds, window_seconds))
    return (
        window_seconds,
        waited_seconds,
        max(0.0, window_seconds - waited_seconds),
    )


def _active_delivery_leases(value, now=None):
    """Return unexpired job deliveries, including legacy list-only records."""
    value = value if isinstance(value, dict) else {}
    keys = value.get("delivered_job_keys")
    if not isinstance(keys, list):
        return {}
    leases = value.get("delivered_job_leases")
    leases = leases if isinstance(leases, dict) else {}
    now = time.time() if now is None else float(now)
    try:
        legacy_expiry = float(value.get("heartbeat_at") or 0) + float(
            _DELIVERY_LEASE_SECONDS)
    except (TypeError, ValueError):
        legacy_expiry = 0.0
    active = {}
    for key in keys:
        if not isinstance(key, str) or not key.startswith("v1:"):
            continue
        try:
            expiry = float(leases.get(key, legacy_expiry))
        except (TypeError, ValueError):
            continue
        if expiry > now:
            active[key] = expiry
    return active


def assistant_watch_status(project_root, now=None):
    value = _load_watch(project_root)
    current_generation = _dashboard_generation(project_root)
    generation_matches = (
        current_generation is None
        or (
            isinstance(value, dict)
            and value.get("dashboard_generation") == current_generation
        )
    )
    if not generation_matches or not _watch_is_active(value, now=now):
        return {
            "connected": False,
            "state": "disconnected",
            "domain": None,
        }
    window_seconds, waited_seconds, remaining_seconds = _watch_budget(value)
    result = {
        "connected": True,
        "state": value.get("state"),
        "domain": value.get("domain") or "all",
        "window_seconds": round(window_seconds, 3),
        "waited_seconds": round(waited_seconds, 3),
        "remaining_seconds": round(remaining_seconds, 3),
    }
    if value.get("dashboard_generation"):
        result["dashboard_generation"] = value["dashboard_generation"]
    if value.get("watch_epoch") is not None:
        result["watch_epoch"] = int(value.get("watch_epoch") or 0)
    if isinstance(value.get("active_job"), dict):
        result["active_job"] = dict(value["active_job"])
    return result


def _write_watch(project_root, watcher_id, domain, state, ttl_seconds,
                 window_seconds=_WATCH_WINDOW_SECONDS,
                 add_waited_seconds=0.0, reset_window=False,
                 delivered_signature=_UNCHANGED,
                 delivered_job_keys=_UNCHANGED,
                 active_job=_UNCHANGED,
                 accepted_job=_UNCHANGED,
                 handoff=_UNCHANGED,
                 dashboard_generation=_UNCHANGED,
                 watch_epoch=_UNCHANGED,
                 claim_token=_UNCHANGED):
    now = time.time()
    path = _watch_path(project_root)
    current = _load_watch(project_root)
    current_leases = _active_delivery_leases(current, now=now)
    same_window = (
        not reset_window
        and isinstance(current, dict)
        and current.get("watcher_id") == watcher_id
    )
    same_owner = same_window
    if same_window:
        stored_window, stored_waited, _remaining = _watch_budget(
            current, default_window=window_seconds)
        started_at = current.get("window_started_at") or now
        stored_delivered = current.get("delivered_signature")
        stored_delivered_at = current.get("delivered_signature_at")
        stored_active_job = current.get("active_job")
        stored_accepted_job = current.get("accepted_job")
        stored_handoff = bool(current.get("handoff"))
        stored_generation = current.get("dashboard_generation")
        stored_epoch = int(current.get("watch_epoch") or 0)
        stored_claim_token = current.get("claim_token")
        stored_job_keys = (
            current.get("delivered_job_keys")
            if "delivered_job_keys" in current else _UNCHANGED
        )
    else:
        stored_window = max(0.1, float(window_seconds))
        stored_waited = 0.0
        started_at = now
        same_owner = (
            isinstance(current, dict)
            and current.get("watcher_id") == watcher_id
            and (
                dashboard_generation is _UNCHANGED
                or current.get("dashboard_generation")
                    == dashboard_generation
            )
        )
        stored_delivered = (
            current.get("delivered_signature") if same_owner else None)
        stored_delivered_at = (
            current.get("delivered_signature_at") if same_owner else None)
        stored_active_job = None
        stored_accepted_job = (
            current.get("accepted_job") if same_owner else None)
        stored_handoff = (
            bool(current.get("handoff")) if same_owner else False)
        stored_generation = (
            current.get("dashboard_generation") if same_owner else None)
        stored_epoch = int(current.get("watch_epoch") or 0) if same_owner else 0
        stored_claim_token = current.get("claim_token") if same_owner else None
        if same_owner:
            stored_job_keys = (
                current.get("delivered_job_keys")
                if "delivered_job_keys" in current else _UNCHANGED
            )
        else:
            stored_job_keys = []
    stored_job_leases = current_leases if same_owner else {}
    if delivered_signature is not _UNCHANGED:
        stored_delivered = delivered_signature
        stored_delivered_at = now if delivered_signature else None
    if delivered_job_keys is not _UNCHANGED:
        stored_job_keys = sorted(set(delivered_job_keys))
        stored_job_leases = {
            key: stored_job_leases.get(key, now + _DELIVERY_LEASE_SECONDS)
            for key in stored_job_keys
        }
    elif stored_job_keys is not _UNCHANGED:
        stored_job_keys = sorted(
            key for key in stored_job_keys if key in stored_job_leases)
    if active_job is not _UNCHANGED:
        stored_active_job = active_job
    if accepted_job is not _UNCHANGED:
        stored_accepted_job = accepted_job
    if handoff is not _UNCHANGED:
        stored_handoff = bool(handoff)
    if dashboard_generation is not _UNCHANGED:
        stored_generation = dashboard_generation
    if watch_epoch is not _UNCHANGED:
        stored_epoch = int(watch_epoch)
    if claim_token is not _UNCHANGED:
        stored_claim_token = claim_token
    stored_waited = min(
        stored_window,
        stored_waited + max(0.0, float(add_waited_seconds)),
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    value = {
        "type": _WATCH_TYPE,
        "version": 4,
        "watcher_id": watcher_id,
        "domain": domain,
        "state": state,
        "pid": os.getpid(),
        "heartbeat_at": now,
        "expires_at": now + float(ttl_seconds),
        "window_started_at": started_at,
        "window_seconds": stored_window,
        "waited_seconds": stored_waited,
        "delivered_signature": stored_delivered,
        "watch_epoch": stored_epoch,
        "handoff": stored_handoff,
    }
    if stored_delivered_at is not None:
        value["delivered_signature_at"] = stored_delivered_at
    if stored_generation:
        value["dashboard_generation"] = stored_generation
    if stored_claim_token:
        value["claim_token"] = stored_claim_token
    if stored_job_keys is not _UNCHANGED:
        value["delivered_job_keys"] = stored_job_keys
        if stored_job_leases:
            value["delivered_job_leases"] = stored_job_leases
    if isinstance(stored_active_job, dict):
        value["active_job"] = stored_active_job
    if isinstance(stored_accepted_job, dict):
        value["accepted_job"] = stored_accepted_job
    util.atomic_write_json(path, value)


def _active_runner_claim_is_live_or_unknown(project_root, value):
    """Runner claim이 유효하거나 일시적 조회 실패로 판정 불가한지 확인한다."""
    active = value.get("active_job") if isinstance(value, dict) else None
    if not (
        isinstance(active, dict)
        and active.get("domain") == "runner"
        and active.get("kind") == "run_pause"
        and active.get("run_ref")
        and active.get("job_id")
        and active.get("revision")
    ):
        return False
    try:
        boundary = Controller(_canonical_root(project_root)).run_status(
            active["run_ref"])
    except (OSError, PermissionError, ValueError, KeyError,
            json.JSONDecodeError):
        return True
    status = boundary.get("status") if isinstance(boundary, dict) else None
    if status not in ("paused", "running", "done"):
        return True
    job = boundary.get("job") or {}
    return (
        status == "paused"
        and job.get("actor") == "agent"
        and job.get("job_id") == active.get("job_id")
        and boundary.get("revision") == active.get("revision")
    )


def _accepted_runner_submission_matches(value):
    """승인 뒤 다음 경계를 계산 중인 Runner claim인지 확인한다."""
    active = value.get("active_job") if isinstance(value, dict) else None
    accepted = value.get("accepted_job") if isinstance(value, dict) else None
    return (
        isinstance(active, dict)
        and isinstance(accepted, dict)
        and active.get("domain") == "runner"
        and active.get("kind") == "run_pause"
        and accepted.get("run_ref") == active.get("run_ref")
        and accepted.get("job_id") == active.get("job_id")
        and accepted.get("revision") == active.get("revision")
    )


def _claim_watch(project_root, domain, watcher_id=None,
                  window_seconds=_WATCH_WINDOW_SECONDS):
    root = _canonical_root(project_root)
    requested = str(watcher_id or "").strip()
    if requested and not 8 <= len(requested) <= 200:
        raise ValueError("watcher-id는 8~200자여야 합니다")
    requested = requested or secrets.token_urlsafe(18)
    with mutation_lock.resource_mutation_lock(
            root, "assistant-watch", root, blocking=True):
        current = _load_watch(root)
        generation = _dashboard_generation(root)
        same_owner = (
            isinstance(current, dict)
            and current.get("watcher_id") == requested
            and current.get("state") in ("waiting", "processing")
            and current.get("dashboard_generation") == generation
        )
        active_same_owner = same_owner and _watch_is_active(current)
        live_waiting = (
            active_same_owner
            and current.get("state") == "waiting"
            # 필드가 없는 legacy v4는 기존처럼 새 호출이 upgrade한다.
            and current.get("handoff") is False
        )
        owned_processing = (
            active_same_owner
            and current.get("state") == "processing"
            and (
                _active_runner_claim_is_live_or_unknown(root, current)
                or _accepted_runner_submission_matches(current)
            )
        )
        if live_waiting or owned_processing:
            return (
                None,
                assistant_watch_status(root),
                "watch_already_active",
                int(current.get("watch_epoch") or 0),
                current.get("claim_token"),
            )
        _stored_window, _stored_waited, remaining = _watch_budget(
            current, default_window=window_seconds)
        reset_window = not same_owner or remaining <= 0
        epoch = int((current or {}).get("watch_epoch") or 0) + 1
        claim_token = secrets.token_urlsafe(24)
        _write_watch(
            root, requested, domain, "waiting", _WATCH_LEASE_SECONDS,
            window_seconds=window_seconds, reset_window=reset_window,
            active_job=None, accepted_job=None, handoff=False,
            dashboard_generation=generation,
            watch_epoch=epoch,
            claim_token=claim_token)
    return requested, assistant_watch_status(root), None, epoch, claim_token


def _renew_watch(project_root, watcher_id, domain, state="waiting",
                  ttl_seconds=_WATCH_LEASE_SECONDS, add_waited_seconds=0.0,
                  delivered_signature=_UNCHANGED,
                  delivered_job_keys=_UNCHANGED,
                  handoff=_UNCHANGED,
                  watch_epoch=None):
    root = _canonical_root(project_root)
    with mutation_lock.resource_mutation_lock(
            root, "assistant-watch", root, blocking=True):
        current = _load_watch(root)
        if (
            not current
            or current.get("watcher_id") != watcher_id
            or current.get("state") not in ("waiting", "processing")
            or current.get("dashboard_generation")
                != _dashboard_generation(root)
            or (
                watch_epoch is not None
                and int(current.get("watch_epoch") or 0) != int(watch_epoch)
            )
        ):
            return False
        _write_watch(
            root, watcher_id, domain, state, ttl_seconds,
            add_waited_seconds=add_waited_seconds,
            delivered_signature=delivered_signature,
            delivered_job_keys=delivered_job_keys,
            handoff=handoff)
    return True


def _settle_watch(project_root, watcher_id, domain, has_work,
                   waited_seconds=0.0, delivered_signature=None,
                   delivered_job_keys=_UNCHANGED, watch_epoch=None):
    state = "processing" if has_work else "waiting"
    ttl = (
        _WATCH_PROCESSING_SECONDS
        if has_work else _WATCH_HANDOFF_SECONDS
    )
    _renew_watch(
        project_root, watcher_id, domain, state, ttl,
        add_waited_seconds=waited_seconds,
        delivered_signature=(
            delivered_signature if has_work else _UNCHANGED),
        delivered_job_keys=(
            delivered_job_keys if has_work else _UNCHANGED),
        handoff=not has_work,
        watch_epoch=watch_epoch)
    return assistant_watch_status(project_root)


def stop_assistant_watch(project_root):
    """대시보드 감시를 중단하고 진행 중인 대기를 다음 확인 때 종료한다."""
    root = _canonical_root(project_root)
    with mutation_lock.resource_mutation_lock(
            root, "assistant-watch", root, blocking=True):
        current = _load_watch(root)
        if not isinstance(current, dict):
            return {
                "status": "ok",
                "stopped": False,
                "assistant_watch": assistant_watch_status(root),
            }
        watcher_id = current.get("watcher_id")
        if not watcher_id:
            return {
                "status": "ok",
                "stopped": False,
                "assistant_watch": assistant_watch_status(root),
            }
        _write_watch(
            root,
            watcher_id,
            current.get("domain") or "all",
            "stopped",
            0,
            active_job=None,
            accepted_job=None,
            handoff=False,
        )
    return {
        "status": "ok",
        "stopped": True,
        "assistant_watch": assistant_watch_status(root),
    }


def validate_claim_token(project_root, claim_token):
    """Fence new Dashboard deliveries without changing legacy submissions."""
    if claim_token in (None, ""):
        return None
    current = _load_watch(project_root) or {}
    current_token = str(current.get("claim_token") or "")
    current_generation = _dashboard_generation(project_root)
    # Fence only when there is positive evidence that a newer watcher owns the
    # work.  A missing/crash-truncated watch record must not turn a valid result
    # into a successful-looking no-op.
    if not current_token:
        return None
    generation_matches = (
        not current_generation
        or current.get("dashboard_generation") == current_generation
    )
    if generation_matches and secrets.compare_digest(
            current_token, str(claim_token)):
        return None
    return {
        "status": "ok",
        "outcome": "superseded_claim",
        "superseded": True,
        "next_action": "resume_normal_flow",
        "message": "작업이 새 Code Assistant 연결로 인계되었습니다.",
    }


def apply_claim_fence(project_root, claim_token, action):
    """Validate a watch claim atomically with the state-changing action."""
    if claim_token in (None, ""):
        return action()
    root = _canonical_root(project_root)
    with mutation_lock.multi_resource_mutation_lock(
            root,
            (("assistant-watch", root), ("dashboard-startup", root)),
            blocking=True):
        fenced = validate_claim_token(root, claim_token)
        return fenced if fenced else action()


def claim_dashboard_runner_job(
        project_root, watcher_id, run_ref, job_id, expected_revision,
        claim_token=None):
    """현재 Code Assistant가 처리할 Dashboard Runner 작업을 명시한다."""
    fenced = validate_claim_token(project_root, claim_token)
    if fenced:
        return fenced
    values = (watcher_id, run_ref, job_id, expected_revision)
    if not all(isinstance(value, str) and value for value in values):
        return {
            "status": "invalid",
            "reason_code": "invalid_dashboard_runner_claim",
        }
    root = _canonical_root(project_root)
    controller = Controller(root)
    boundary = controller.run_status(run_ref)
    job = boundary.get("job") or {}
    if not (
        boundary.get("status") == "paused"
        and job.get("actor") == "agent"
        and job.get("job_id") == job_id
        and boundary.get("revision") == expected_revision
    ):
        return {
            "status": "invalid",
            "reason_code": "stale_dashboard_runner_claim",
        }
    active_job = {
        "domain": "runner",
        "kind": "run_pause",
        "run_ref": boundary.get("run_ref") or run_ref,
        "job_id": job_id,
        "revision": expected_revision,
    }
    with mutation_lock.resource_mutation_lock(
            root, "assistant-watch", root, blocking=True):
        current = _load_watch(root)
        current_generation = _dashboard_generation(root)
        if not (
            current
            and current.get("watcher_id") == watcher_id
            and current.get("state") == "processing"
            and (
                not current_generation
                or current.get("dashboard_generation") == current_generation
            )
            and (
                claim_token in (None, "")
                or secrets.compare_digest(
                    str(current.get("claim_token") or ""), str(claim_token))
            )
        ):
            return {
                "status": "invalid",
                "reason_code": "dashboard_watch_not_processing",
            }
        _write_watch(
            root,
            watcher_id,
            current.get("domain") or "all",
            "processing",
            _WATCH_PROCESSING_SECONDS,
            active_job=active_job,
            accepted_job=None,
        )
    return {
        "status": "ok",
        "claimed": True,
        "active_job": active_job,
    }


def mark_dashboard_runner_submission_accepted(
        project_root, run_ref, job_id, expected_revision, claim_token=None):
    """승인된 결과의 후속 경계를 계산하는 동안 기존 claim을 유지한다."""
    root = _canonical_root(project_root)
    with mutation_lock.resource_mutation_lock(
            root, "assistant-watch", root, blocking=True):
        current = _load_watch(root)
        current_generation = _dashboard_generation(root)
        active_job = (
            current.get("active_job") if isinstance(current, dict) else None)
        owns_claim = (
            isinstance(current, dict)
            and current.get("state") == "processing"
            and (
                not current_generation
                or current.get("dashboard_generation") == current_generation
            )
            and (
                claim_token in (None, "")
                or secrets.compare_digest(
                    str(current.get("claim_token") or ""),
                    str(claim_token),
                )
            )
        )
        matches = (
            owns_claim
            and isinstance(active_job, dict)
            and active_job.get("domain") == "runner"
            and active_job.get("kind") == "run_pause"
            and active_job.get("run_ref") == run_ref
            and active_job.get("job_id") == job_id
            and active_job.get("revision") == expected_revision
        )
        if not matches:
            return {"status": "ok", "marked": False}
        _write_watch(
            root,
            current.get("watcher_id"),
            current.get("domain") or "all",
            "processing",
            _WATCH_PROCESSING_SECONDS,
            accepted_job={
                "run_ref": run_ref,
                "job_id": job_id,
                "revision": expected_revision,
            },
        )
    return {"status": "ok", "marked": True}


def clear_dashboard_runner_job(
        project_root, run_ref, job_id, expected_revision=None,
        claim_token=None, reset_wait_window=False):
    """일치하는 Runner claim을 해제하고 정상 제출이면 새 대기 구간을 연다."""
    root = _canonical_root(project_root)
    with mutation_lock.resource_mutation_lock(
            root, "assistant-watch", root, blocking=True):
        current = _load_watch(root)
        current_generation = _dashboard_generation(root)
        owns_claim = (
            claim_token in (None, "")
            or (
                isinstance(current, dict)
                and secrets.compare_digest(
                    str(current.get("claim_token") or ""),
                    str(claim_token),
                )
                and (
                    not current_generation
                    or current.get("dashboard_generation")
                        == current_generation
                )
            )
        )
        active_job = (
            current.get("active_job") if isinstance(current, dict) else None)
        matches = (
            owns_claim
            and isinstance(active_job, dict)
            and active_job.get("run_ref") == run_ref
            and active_job.get("job_id") == job_id
            and (
                expected_revision is None
                or active_job.get("revision") == expected_revision
            )
        )
        if not matches:
            return {"status": "ok", "cleared": False}
        if reset_wait_window:
            _write_watch(
                root,
                current.get("watcher_id"),
                current.get("domain") or "all",
                "waiting",
                _WATCH_HANDOFF_SECONDS,
                window_seconds=_WATCH_WINDOW_SECONDS,
                reset_window=True,
                active_job=None,
                accepted_job=None,
                handoff=True,
            )
            return {"status": "ok", "cleared": True}
        remaining_ttl = max(
            0.0, float(current.get("expires_at") or 0) - time.time())
        _write_watch(
            root,
            current.get("watcher_id"),
            current.get("domain") or "all",
            current.get("state") or "processing",
            remaining_ttl,
            active_job=None,
            accepted_job=None,
        )
    return {"status": "ok", "cleared": True}


def _reader(project_root):
    from .dashboard_http import DashboardHTTP
    controller = Controller(os.path.realpath(os.path.abspath(project_root)))
    return DashboardHTTP(controller, "offline-agent-job-reader")


def _digest(value):
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), default=str).encode("utf-8")
    return "v1:" + hashlib.sha256(raw).hexdigest()


def _job_identity(item):
    job = item.get("job") or {}
    return [
        item.get("kind"),
        item.get("launch_id"),
        item.get("run_ref"),
        item.get("parse_job_id"),
        item.get("test_id"),
        job.get("job_id"),
        item.get("revision") or job.get("revision"),
    ]


def _command_line(argv):
    return subprocess.list2cmdline(argv) if os.name == "nt" else shlex.join(argv)


def _with_claim_token(command, claim_token):
    if not isinstance(command, str) or not command.strip():
        return command
    return command + " --claim-token " + shlex.quote(claim_token)


def _attach_claims(value, project_root, watcher_id, claim_token):
    result = json.loads(json.dumps(value, ensure_ascii=False))
    for domain in ("creator", "runner"):
        section = result.get(domain) or {}
        jobs = []
        for original in section.get("jobs") or []:
            item = dict(original)
            item["claim_token"] = claim_token
            for key in ("resume_command", "submit_command", "reject_command"):
                if key in item:
                    item[key] = _with_claim_token(item[key], claim_token)
            jobs.append(item)
        result[domain] = {**section, "jobs": jobs}

    runner = result.get("runner") or {}
    jobs = []
    for original in runner.get("jobs") or []:
        item = dict(original)
        job = item.get("job") or {}
        if (
            item.get("kind") == "run_pause"
            and item.get("run_ref")
            and job.get("job_id")
            and item.get("revision")
        ):
            item["claim_command"] = _command_line([
                os.path.abspath(sys.executable),
                "-B",
                "-m",
                "ops_runtime.dashboard_app",
                "runner-agent-claim",
                "--project-root",
                _canonical_root(project_root),
                "--watcher-id",
                watcher_id,
                "--run-ref",
                item["run_ref"],
                "--job-id",
                job["job_id"],
                "--expected-revision",
                item["revision"],
                "--claim-token",
                claim_token,
            ])
        jobs.append(item)
    result["runner"] = {**runner, "jobs": jobs}
    result["claim_token"] = claim_token
    return result


def _job_delivery_key(item):
    return _digest(_job_identity(item))


def _snapshot_job_keys(value):
    keys = set()
    for domain in ("creator", "runner"):
        section = value.get(domain) or {}
        keys.update(
            _job_delivery_key(item)
            for item in section.get("jobs") or []
        )
    return keys


def _watch_delivered_job_keys(watch, current=None):
    stored = watch.get("delivered_job_keys")
    if isinstance(stored, list):
        return set(_active_delivery_leases(watch))
    if (
        current is not None
        and watch.get("delivered_signature") == current.get("signature")
    ):
        try:
            delivered_at = float(
                watch.get("delivered_signature_at")
                or watch.get("heartbeat_at")
                or 0)
        except (TypeError, ValueError):
            delivered_at = 0.0
        if delivered_at + _DELIVERY_LEASE_SECONDS <= time.time():
            return set()
        # 이 필드가 없던 기존 watch는 전체 signature가 그대로일 때만
        # 당시 작업을 이미 전달한 것으로 안전하게 복원한다.
        return _snapshot_job_keys(current)
    return set()


def _undelivered_jobs(value, delivered_job_keys):
    result = {**value}
    total = 0
    for domain in ("creator", "runner"):
        section = {**(value.get(domain) or {})}
        jobs = [
            item for item in section.get("jobs") or []
            if _job_delivery_key(item) not in delivered_job_keys
        ]
        section["jobs"] = jobs
        section["job_count"] = len(jobs)
        result[domain] = section
        total += len(jobs)
    result["job_count"] = total
    return result


def _active_runs(reader):
    items = []
    for indexed in reader.controller._run_index().values():
        for run_path, run in indexed:
            status = run.get("status")
            if status in ("done", "error"):
                continue
            items.append([
                reader.controller._ref(run_path),
                status,
                run.get("waiting_node"),
                run.get("waiting_kind"),
                reader.controller._revision(run_path),
            ])
    return sorted(items, key=lambda item: tuple(str(x or "") for x in item))


def _active_operations(reader, domain):
    items = []
    folder = reader.operations_dir
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        names = []
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            record = util.load_json(os.path.join(folder, name))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if (
            record.get("type") == "ops_dashboard_operation"
            and record.get("status") == "running"
        ):
            kind = str(record.get("kind") or "")
            operation_domain = "runner" if kind.startswith("run_") else "creator"
            if domain != "all" and operation_domain != domain:
                continue
            metadata = record.get("metadata") or {}
            items.append([
                record.get("operation_id"),
                kind,
                metadata.get("run_ref"),
                metadata.get("job_id"),
            ])
    return items


def snapshot(project_root, domain="all", reader=None):
    if domain not in ("all", "creator", "runner"):
        raise ValueError("domain은 all, creator, runner 중 하나여야 합니다")
    view = reader or _reader(project_root)
    creator = (
        view.creator_jobs() if domain in ("all", "creator")
        else {"status": "ok", "job_count": 0, "jobs": [],
              "active_session_count": 0, "active_sessions": []}
    )
    runner = (
        view.runner_jobs() if domain in ("all", "runner")
        else {"status": "ok", "job_count": 0, "jobs": []}
    )
    active_runs = _active_runs(view) if domain in ("all", "runner") else []
    operations = _active_operations(view, domain)
    document = {
        "v": 1,
        "domain": domain,
        "creator": {
            "sessions": sorted([
                [
                    item.get("launch_id"),
                    item.get("status"),
                    item.get("stage"),
                    item.get("task_ref"),
                    item.get("owner"),
                ]
                for item in creator.get("active_sessions") or []
            ], key=lambda item: tuple(str(x or "") for x in item)),
            "jobs": sorted(
                [_job_identity(item) for item in creator.get("jobs") or []],
                key=lambda item: tuple(str(x or "") for x in item),
            ),
        },
        "runner": {
            "active_runs": active_runs,
            "jobs": sorted(
                [_job_identity(item) for item in runner.get("jobs") or []],
                key=lambda item: tuple(str(x or "") for x in item),
            ),
        },
        "operations": operations,
    }
    job_count = (
        int(creator.get("job_count") or 0)
        + int(runner.get("job_count") or 0)
    )
    active_session_count = int(creator.get("active_session_count") or 0)
    return {
        "status": "ok",
        "domain": domain,
        "signature": _digest(document),
        "job_count": job_count,
        "active_session_count": active_session_count,
        "active_run_count": len(active_runs),
        "active_operation_count": len(operations),
        "idle": (
            job_count == 0
            and active_session_count == 0
            and len(active_runs) == 0
            and len(operations) == 0
        ),
        "creator": creator,
        "runner": runner,
    }


def signature_document(reader, domain="all"):
    current = snapshot(reader.controller.project_root, domain, reader=reader)
    jobs_signature = current["signature"]
    watch = assistant_watch_status(reader.controller.project_root)
    stored_watch = _load_watch(reader.controller.project_root) or {}
    delivered_job_keys = _watch_delivered_job_keys(
        stored_watch, current=current)
    pending = _undelivered_jobs(current, delivered_job_keys)
    watch["waiting_for_change"] = bool(
        watch.get("connected")
        and watch.get("state") == "waiting"
        and current.get("job_count", 0) > 0
        and pending.get("job_count", 0) == 0
    )
    public = {
        key: current[key] for key in (
            "status", "domain", "signature", "job_count",
            "active_session_count", "active_run_count",
            "active_operation_count", "idle",
        )
    }
    public["jobs_signature"] = jobs_signature
    public["assistant_watch"] = watch
    public["signature"] = _digest({
        "jobs": jobs_signature,
        "assistant_watch": [
            watch.get("connected"),
            watch.get("state"),
            watch.get("domain"),
        ],
    })
    return public


def wait_for_agent_work(project_root, domain="all",
                        timeout_seconds=_DEFAULT_TIMEOUT_SECONDS,
                        since=None, poll_seconds=_POLL_START_SECONDS,
                        max_poll_seconds=_POLL_MAX_SECONDS, reader=None,
                        dashboard_watch=False, watcher_id=None,
                        watch_window_seconds=_WATCH_WINDOW_SECONDS):
    timeout = max(0.1, min(float(timeout_seconds), _MAX_TIMEOUT_SECONDS))
    delay = max(0.05, min(float(poll_seconds), _POLL_MAX_SECONDS))
    max_delay = max(delay, min(float(max_poll_seconds), _POLL_MAX_SECONDS))
    view = reader or _reader(project_root)
    started = time.monotonic()
    read_errors = 0
    claimed_watcher_id = None
    claimed_watch_epoch = None
    claimed_token = None
    delivered_job_keys = set()

    if dashboard_watch:
        (claimed_watcher_id, active_watch, claim_reason,
         claimed_watch_epoch, claimed_token) = _claim_watch(
            project_root, domain, watcher_id=watcher_id,
            window_seconds=watch_window_seconds)
        if claimed_watcher_id is None:
            return {
                "status": "ok",
                "reason_code": claim_reason,
                "domain": domain,
                "job_count": 0,
                "assistant_watch": active_watch,
                "next_action": "resume_normal_flow",
            }

    def read():
        nonlocal read_errors
        try:
            return snapshot(project_root, domain, reader=view)
        except (OSError, PermissionError, ValueError, KeyError,
                json.JSONDecodeError):
            read_errors += 1
            return None

    current = None
    for _ in range(3):
        current = read()
        if current is not None:
            break
        time.sleep(0.1)
    if current is None:
        if claimed_watcher_id:
            _renew_watch(
                project_root, claimed_watcher_id, domain,
                ttl_seconds=0, watch_epoch=claimed_watch_epoch)
        return {
            "status": "error",
            "reason_code": "agent_job_snapshot_failed",
            "domain": domain,
            "read_error_count": read_errors,
        }

    def finish(reason, value):
        waited = round(time.monotonic() - started, 3)
        has_work = reason == "agent_work_available"
        next_action = (
            "process_agent_jobs"
            if has_work
            else "wait_again"
            if dashboard_watch or not value.get("idle")
            else "resume_normal_flow"
        )
        result = {
            **value,
            "status": "ok",
            "reason_code": reason,
            "timeout_seconds": timeout,
            "waited_seconds": waited,
            "read_error_count": read_errors,
            "next_action": next_action,
        }
        if claimed_watcher_id:
            settled_job_keys = _UNCHANGED
            if has_work:
                settled_job_keys = (
                    delivered_job_keys | _snapshot_job_keys(value))
            result["watcher_id"] = claimed_watcher_id
            result["assistant_watch"] = _settle_watch(
                project_root,
                claimed_watcher_id,
                domain,
                has_work,
                waited_seconds=waited,
                delivered_signature=value.get("signature"),
                delivered_job_keys=settled_job_keys,
                watch_epoch=claimed_watch_epoch,
            )
            result["watch_epoch"] = claimed_watch_epoch
            result["claim_token"] = claimed_token
            if active_watch.get("dashboard_generation"):
                result["dashboard_generation"] = active_watch[
                    "dashboard_generation"]
            watch = _load_watch(project_root)
            window_seconds, waited_total, remaining = _watch_budget(
                watch, default_window=watch_window_seconds)
            result["watch_window_seconds"] = round(window_seconds, 3)
            result["watch_waited_seconds"] = round(waited_total, 3)
            result["watch_remaining_seconds"] = round(remaining, 3)
            same_epoch = (
                isinstance(watch, dict)
                and watch.get("watcher_id") == claimed_watcher_id
                and int(watch.get("watch_epoch") or 0)
                    == int(claimed_watch_epoch or 0)
                and watch.get("dashboard_generation")
                    == _dashboard_generation(project_root)
            )
            if not same_epoch or watch.get("state") == "stopped":
                result["reason_code"] = (
                    "watch_stopped"
                    if same_epoch and watch.get("state") == "stopped"
                    else "watch_replaced"
                )
                result["next_action"] = "resume_normal_flow"
            elif reason == "timeout" and remaining <= 0:
                result["reason_code"] = "watch_window_expired"
                result["next_action"] = "wait_again"
            if has_work and same_epoch:
                result = _attach_claims(
                    result, project_root, claimed_watcher_id, claimed_token)
        return result

    if claimed_watcher_id:
        stored_watch = _load_watch(project_root) or {}
        delivered_job_keys = _watch_delivered_job_keys(
            stored_watch, current=current)
        _window_seconds, _waited_seconds, window_remaining = _watch_budget(
            stored_watch,
            default_window=watch_window_seconds,
        )
        if window_remaining <= 0:
            return finish(
                "watch_window_expired",
                _undelivered_jobs(current, delivered_job_keys),
            )
        timeout = min(timeout, window_remaining)

    if dashboard_watch:
        available = _undelivered_jobs(current, delivered_job_keys)
        if available["job_count"] > 0:
            return finish("agent_work_available", available)
    if since and current["signature"] != since and not dashboard_watch:
        return finish("state_changed", current)
    if current["job_count"] > 0 and not dashboard_watch:
        return finish("agent_work_available", current)
    if current["idle"] and not dashboard_watch:
        return finish("idle", current)

    baseline = current
    poll_count = 0
    pending_disappearance = None
    deadline = started + timeout
    while time.monotonic() < deadline:
        if claimed_watcher_id and not _renew_watch(
                project_root, claimed_watcher_id, domain,
                watch_epoch=claimed_watch_epoch):
            stored_watch = _load_watch(project_root) or {}
            stopped = (
                stored_watch.get("watcher_id") == claimed_watcher_id
                and stored_watch.get("state") == "stopped"
            )
            return {
                **current,
                "status": "ok",
                "reason_code": (
                    "watch_stopped" if stopped else "watch_replaced"),
                "assistant_watch": assistant_watch_status(project_root),
                "next_action": "resume_normal_flow",
            }
        remaining = deadline - time.monotonic()
        time.sleep(max(0.0, min(delay, remaining)))
        poll_count += 1
        candidate = read()
        if candidate is None:
            delay = min(max_delay, delay * 1.5)
            continue
        available = (
            _undelivered_jobs(candidate, delivered_job_keys)
            if dashboard_watch else candidate
        )
        if available["job_count"] > 0:
            result = finish("agent_work_available", available)
            result["poll_count"] = poll_count
            return result
        if candidate["idle"] and not dashboard_watch:
            result = finish("idle", candidate)
            result["poll_count"] = poll_count
            return result
        if candidate["signature"] != baseline["signature"]:
            if dashboard_watch:
                baseline = candidate
                pending_disappearance = None
                delay = min(max_delay, delay * 1.5)
                continue
            disappeared = candidate["job_count"] < baseline["job_count"]
            if disappeared and pending_disappearance != candidate["signature"]:
                pending_disappearance = candidate["signature"]
            else:
                result = finish("state_changed", candidate)
                result["poll_count"] = poll_count
                return result
        else:
            pending_disappearance = None
        delay = min(max_delay, delay * 1.5)

    latest = read() or baseline
    if dashboard_watch:
        latest = _undelivered_jobs(latest, delivered_job_keys)
    if claimed_watcher_id:
        stored_watch = _load_watch(project_root) or {}
        same_epoch = (
            stored_watch.get("watcher_id") == claimed_watcher_id
            and int(stored_watch.get("watch_epoch") or 0)
                == int(claimed_watch_epoch or 0)
            and stored_watch.get("dashboard_generation")
                == _dashboard_generation(project_root)
        )
        if not same_epoch or stored_watch.get("state") == "stopped":
            return {
                **latest,
                "status": "ok",
                "reason_code": (
                    "watch_stopped"
                    if same_epoch and stored_watch.get("state") == "stopped"
                    else "watch_replaced"
                ),
                "assistant_watch": assistant_watch_status(project_root),
                "next_action": "resume_normal_flow",
            }
    result = finish("timeout", latest)
    result["poll_count"] = poll_count
    return result


def _parser():
    parser = argparse.ArgumentParser(prog="python -m ops_runtime.agent_jobs")
    sub = parser.add_subparsers(dest="command", required=True)
    wait = sub.add_parser("wait")
    wait.add_argument("--project-root", required=True)
    wait.add_argument("--domain", choices=("all", "creator", "runner"),
                      default="all")
    wait.add_argument("--timeout-seconds", type=float,
                      default=_DEFAULT_TIMEOUT_SECONDS)
    wait.add_argument("--since")
    wait.add_argument("--dashboard-watch", action="store_true")
    wait.add_argument("--watcher-id")
    wait.add_argument("--watch-window-seconds", type=float,
                      default=_WATCH_WINDOW_SECONDS)
    snapshot_command = sub.add_parser("snapshot")
    snapshot_command.add_argument("--project-root", required=True)
    snapshot_command.add_argument(
        "--domain", choices=("all", "creator", "runner"), default="all")
    return parser


def main(argv=None):
    util.utf8_stdout()
    args = _parser().parse_args(argv)
    try:
        if args.command == "wait":
            result = wait_for_agent_work(
                args.project_root,
                domain=args.domain,
                timeout_seconds=args.timeout_seconds,
                since=args.since,
                dashboard_watch=args.dashboard_watch,
                watcher_id=args.watcher_id,
                watch_window_seconds=args.watch_window_seconds,
            )
        else:
            result = snapshot(args.project_root, domain=args.domain)
    except KeyboardInterrupt:
        result = {"status": "interrupted", "reason_code": "interrupted"}
        print(json.dumps(result, ensure_ascii=False))
        return 130
    except mutation_lock.MutationBusy as exc:
        result = {
            "status": "ok",
            "reason_code": "watch_lock_busy",
            "reason": str(exc),
            "retryable": True,
            "next_action": "wait_again",
        }
    except (OSError, PermissionError, ValueError, KeyError,
            json.JSONDecodeError) as exc:
        result = {
            "status": "error",
            "reason_code": "agent_jobs_failed",
            "reason": str(exc),
        }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
