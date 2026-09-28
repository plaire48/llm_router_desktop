# -*- coding: utf-8 -*-
"""프로젝트당 하나만 실행되는 선택형 Creator·Runner 웹 대시보드."""
from __future__ import annotations

import argparse
import datetime
import json
import os
import secrets
import sys
import time
from urllib import error as urlerror
from urllib import request as urlrequest
import webbrowser

from . import (agent_jobs, dashboard_events, local_process, mutation_lock,
               runner_app, util, workspace)
from .controller import Controller
from .dashboard_input_jobs import DashboardInputJobs
from .dashboard_http import DashboardHTTP


_DEFAULT_IDLE_SECONDS = 8 * 60 * 60
_DEFAULT_STARTUP_SECONDS = 10
_HEARTBEAT_SECONDS = 30
_LOOPBACK_NO_PROXY = ("127.0.0.1", "localhost")


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


_canonical_root = local_process.canonical_root


def _ensure_loopback_no_proxy():
    """기존 프록시 우회 설정을 보존하면서 Dashboard의 로컬 주소를 추가한다."""
    values = []
    seen = set()
    for key in ("NO_PROXY", "no_proxy"):
        for raw in str(os.environ.get(key) or "").split(","):
            value = raw.strip()
            normalized = value.lower()
            if value and normalized not in seen:
                values.append(value)
                seen.add(normalized)
    for value in _LOOPBACK_NO_PROXY:
        if value.lower() not in seen:
            values.append(value)
            seen.add(value.lower())
    combined = ",".join(values)
    os.environ["NO_PROXY"] = combined
    os.environ["no_proxy"] = combined


def _dashboard_dir(controller):
    path = os.path.realpath(os.path.join(
        controller.project_root, ".ops", "dashboard"))
    if not controller._inside(path, controller.project_root):
        raise ValueError("Dashboard 상태 경로가 프로젝트 밖입니다")
    os.makedirs(path, exist_ok=True)
    return path


def _record_path(controller):
    return os.path.join(_dashboard_dir(controller), "server.json")


def _stop_path(controller):
    return os.path.join(_dashboard_dir(controller), "stop.json")


_write_private = local_process.write_private


def _read_record(controller):
    value = util.load_json(_record_path(controller))
    if value.get("type") != "ops_dashboard_server":
        raise ValueError("Dashboard 서버 상태 형식이 올바르지 않습니다")
    if _canonical_root(value.get("project_root") or "") != controller.project_root:
        raise ValueError("Dashboard 서버의 프로젝트 루트가 일치하지 않습니다")
    return value


def _health(record, timeout=2):
    try:
        with urlrequest.urlopen(
                str(record["base_url"]) + "/api/health",
                timeout=timeout) as response:
            value = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, KeyError, json.JSONDecodeError,
            urlerror.URLError):
        return None
    return value if isinstance(value, dict) else None


def _live_record(controller):
    try:
        record = _read_record(controller)
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    if not local_process.process_alive(record.get("pid")):
        return None
    health = _health(record)
    if (
        not health
        or health.get("status") != "ok"
        or health.get("server_id") != record.get("server_id")
        or _canonical_root(health.get("project_root") or "")
            != controller.project_root
    ):
        return None
    return record


def _remove_owned_record(controller, server_id=None):
    path = _record_path(controller)
    try:
        current = util.load_json(path)
    except (OSError, ValueError, json.JSONDecodeError):
        current = None
    if (
        current
        and server_id is not None
        and current.get("server_id") != server_id
    ):
        return False
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    return True


def _worker_argv(project_root, idle_seconds):
    return [
        os.path.abspath(sys.executable),
        "-B",
        "-m",
        "ops_runtime.dashboard_app",
        "_serve",
        "--project-root",
        project_root,
        "--idle-seconds",
        str(idle_seconds),
    ]


def ensure_dashboard_server(project_root, idle_seconds=_DEFAULT_IDLE_SECONDS,
                      startup_seconds=_DEFAULT_STARTUP_SECONDS):
    _ensure_loopback_no_proxy()
    root = _canonical_root(project_root)
    controller = Controller(root)
    idle_seconds = int(idle_seconds)
    startup_seconds = float(startup_seconds)
    if not 5 <= idle_seconds <= 24 * 60 * 60:
        raise ValueError("idle_seconds는 5초 이상 24시간 이하여야 합니다")
    if not 0.1 <= startup_seconds <= 60:
        raise ValueError("startup_seconds는 0.1초 이상 60초 이하여야 합니다")
    live = _live_record(controller)
    if live:
        return live
    with mutation_lock.resource_mutation_lock(
            root, "dashboard-startup", root, blocking=True):
        live = _live_record(controller)
        if live:
            return live
        try:
            stale = _read_record(controller)
        except (OSError, ValueError, json.JSONDecodeError):
            stale = None
        # A live PID is not ownership proof: Windows may reuse it and an old
        # Dashboard can be alive but fenced by a newer generation.  Replace
        # only the record; never wait for or terminate a process we did not
        # spawn in this call.
        _remove_owned_record(controller)
        try:
            os.remove(_stop_path(controller))
        except FileNotFoundError:
            pass
        child = local_process.spawn_worker(
            _worker_argv(root, idle_seconds), root)
        local_process.reap_later(child, "dashboard-app-reaper")
        deadline = time.time() + startup_seconds
        last_error = None
        while time.time() < deadline:
            live = _live_record(controller)
            if live:
                return live
            if child.poll() is not None:
                last_error = (
                    f"Dashboard worker가 준비 중 종료되었습니다(exit {child.returncode})")
                break
            time.sleep(0.05)
        if child.poll() is None:
            try:
                child.terminate()
            except OSError:
                pass
        raise RuntimeError(last_error or "Dashboard 서버 시작 시간이 초과되었습니다")


def start_dashboard(project_root, tab="creator", idle_seconds=_DEFAULT_IDLE_SECONDS,
              startup_seconds=_DEFAULT_STARTUP_SECONDS, open_browser=True):
    if tab not in ("creator", "runner"):
        raise ValueError("tab은 creator 또는 runner여야 합니다")
    record = ensure_dashboard_server(
        project_root,
        idle_seconds=idle_seconds,
        startup_seconds=startup_seconds,
    )
    url = f'{record["base_url"]}/dashboard?tab={tab}'
    opened = False
    if open_browser:
        try:
            opened = bool(webbrowser.open(url, new=2))
        except Exception:
            opened = False
    return {
        "status": "open",
        "mode": "integrated_local_dashboard",
        "tab": tab,
        "url": url,
        "browser_open_requested": bool(open_browser),
        "browser_opened": opened,
        "started_at": record.get("started_at"),
        "idle_seconds": record.get("idle_seconds"),
        "next_action": "dashboard_watch",
        "watch_command": (
            "python -m ops_runtime.agent_jobs wait --project-root . "
            "--domain all --timeout-seconds 540 "
            "--watch-window-seconds 540 --dashboard-watch"
        ),
    }


def dashboard_status(project_root):
    controller = Controller(_canonical_root(project_root))
    record = _live_record(controller)
    if not record:
        return {"status": "stopped", "mode": "integrated_local_dashboard"}
    return {
        "status": "running",
        "mode": "integrated_local_dashboard",
        "started_at": record.get("started_at"),
        "heartbeat_at": record.get("heartbeat_at"),
        "idle_seconds": record.get("idle_seconds"),
        "url": record.get("base_url") + "/dashboard",
    }


def stop_dashboard(project_root, wait_seconds=5):
    controller = Controller(_canonical_root(project_root))
    record = _live_record(controller)
    if not record:
        _remove_owned_record(controller)
        return {"status": "stopped", "mode": "integrated_local_dashboard"}
    _write_private(_stop_path(controller), {
        "type": "ops_dashboard_stop",
        "server_id": record.get("server_id"),
        "requested_at": _now(),
    })
    deadline = time.time() + max(0, min(float(wait_seconds), 10))
    while time.time() < deadline:
        if not local_process.process_alive(record.get("pid")):
            _remove_owned_record(controller, record.get("server_id"))
            return {"status": "stopped", "mode": "integrated_local_dashboard"}
        time.sleep(0.05)
    return {"status": "stop_requested", "mode": "integrated_local_dashboard"}


def dashboard_jobs(project_root, domain):
    controller = Controller(_canonical_root(project_root))
    view = DashboardHTTP(controller, "offline-job-reader")
    if domain == "creator":
        return view.creator_jobs()
    if domain == "runner":
        return view.runner_jobs()
    raise ValueError("domain은 creator 또는 runner여야 합니다")


def _refresh_owned_record(controller, record):
    """Refresh a heartbeat only while this server still owns the record."""
    root = controller.project_root
    with mutation_lock.resource_mutation_lock(
            root, "dashboard-startup", root, blocking=True):
        try:
            owner = _read_record(controller)
        except (OSError, ValueError, json.JSONDecodeError):
            owner = None
        if owner is None or owner.get("server_id") != record.get("server_id"):
            return False
        record["heartbeat_at"] = _now()
        _write_private(_record_path(controller), record)
        return True


def _dashboard_runner_submission_result(boundary):
    """Dashboard 소유 경계는 Code Assistant가 질문으로 해석하지 않게 축약한다."""
    if not isinstance(boundary, dict):
        return boundary
    if boundary.get("status") not in ("paused", "done"):
        return boundary
    job = boundary.get("job") or {}
    if boundary.get("status") == "done":
        outcome = "dashboard_run_done"
        message = "Dashboard 실행이 완료되었습니다."
    elif job.get("actor") == "user":
        outcome = "dashboard_user_input_ready"
        message = (
            "사용자 입력 단계는 Dashboard에 표시되었습니다. "
            "채팅에서 질문·선택·확인을 요청하지 마세요."
        )
    else:
        outcome = "dashboard_agent_work_ready"
        message = "다음 Agent 작업이 Dashboard 작업 목록에 준비되었습니다."
    return {
        "status": "ok",
        "mode": "integrated_local_dashboard",
        "outcome": outcome,
        "run_ref": boundary.get("run_ref"),
        "run_revision": boundary.get("revision"),
        "next_action": "continue_dashboard_watch",
        "message": message,
    }


def submit_dashboard_runner_agent(
        project_root, run_ref, job_id, expected_revision, result_file,
        claim_token=None):
    """Dashboard AI 결과를 제출하되 다음 user 경계는 Dashboard에만 남긴다."""
    controller = Controller(_canonical_root(project_root))
    submitted, result_path = runner_app._read_result_file(
        controller, result_file)
    action = "run_complete_agent_job"
    idempotency_key = runner_app._idempotency_key(action, {
        "run_ref": run_ref,
        "job_id": job_id,
        "revision": expected_revision,
        "result": submitted,
    })

    def accept_result():
        accepted = controller.run_complete_agent_job(
            run_ref,
            job_id,
            expected_revision,
            idempotency_key,
            submitted,
            defer_pump=True,
        )
        if accepted.get("status") == "running":
            agent_jobs.mark_dashboard_runner_submission_accepted(
                project_root,
                accepted.get("run_ref") or run_ref,
                job_id,
                expected_revision,
                claim_token=claim_token,
            )
        return accepted

    boundary = agent_jobs.apply_claim_fence(
        project_root, claim_token, accept_result)
    if boundary.get("status") == "running":
        continuation_key = runner_app._idempotency_key("run_next", {
            "run_ref": run_ref,
            "revision": boundary.get("revision"),
        })
        boundary = controller.run_next(
            run_ref,
            expected_revision=boundary.get("revision"),
            idempotency_key=continuation_key,
        )
    if boundary.get("status") in ("paused", "done", "error"):
        agent_jobs.clear_dashboard_runner_job(
            project_root,
            boundary.get("run_ref") or run_ref,
            job_id,
            expected_revision,
            claim_token=claim_token,
            reset_wait_window=boundary.get("status") in ("paused", "done"),
        )
        dashboard_events.publish_to_live_dashboard(project_root, {
            "type": "run_updated",
            "run_ref": boundary.get("run_ref") or run_ref,
            "revision": boundary.get("revision"),
            "status": boundary.get("status"),
        })
    if (
        boundary.get("status") in ("paused", "done")
        and workspace.is_consumable_payload(result_path)
    ):
        try:
            os.remove(result_path)
        except OSError:
            pass
    return _dashboard_runner_submission_result(boundary)


def _serve_dashboard(project_root, idle_seconds):
    root = _canonical_root(project_root)
    controller = Controller(root)
    server_id = secrets.token_urlsafe(18)
    bridge = DashboardHTTP(
        controller, server_id, session_seconds=idle_seconds).start()
    record = {
        "type": "ops_dashboard_server",
        "mode": "integrated_local_dashboard",
        "server_id": server_id,
        "dashboard_generation": server_id,
        "project_root": root,
        "pid": os.getpid(),
        "base_url": bridge.base_url,
        "started_at": _now(),
        "heartbeat_at": _now(),
        "idle_seconds": int(idle_seconds),
    }
    _write_private(_record_path(controller), record)
    next_heartbeat = time.monotonic() + _HEARTBEAT_SECONDS
    replaced = False
    try:
        while True:
            if replaced:
                if bridge.active_commands == 0:
                    return 0
                time.sleep(0.1)
                continue
            stop_requested = False
            try:
                stop = util.load_json(_stop_path(controller))
                stop_requested = stop.get("server_id") in (None, server_id)
            except (OSError, ValueError, json.JSONDecodeError):
                pass
            if stop_requested and bridge.active_commands == 0:
                return 0
            if (
                bridge.active_commands == 0
                and time.monotonic() - bridge.last_activity >= idle_seconds
            ):
                return 0
            try:
                owner = _read_record(controller)
            except (OSError, ValueError, json.JSONDecodeError):
                owner = None
            if not owner or owner.get("server_id") != server_id:
                replaced = True
                if bridge.active_commands == 0:
                    return 0
                continue
            if time.monotonic() >= next_heartbeat:
                if not _refresh_owned_record(controller, record):
                    replaced = True
                    if bridge.active_commands == 0:
                        return 0
                    continue
                next_heartbeat = time.monotonic() + _HEARTBEAT_SECONDS
            time.sleep(0.1)
    finally:
        bridge.stop()
        _remove_owned_record(controller, server_id)
        try:
            stop = util.load_json(_stop_path(controller))
            if stop.get("server_id") in (None, server_id):
                os.remove(_stop_path(controller))
        except (OSError, ValueError, json.JSONDecodeError):
            pass


def _parser():
    parser = argparse.ArgumentParser(prog="python -m ops_runtime.dashboard_app")
    sub = parser.add_subparsers(dest="command", required=True)
    start = sub.add_parser("start")
    start.add_argument("--project-root", required=True)
    start.add_argument("--tab", choices=("creator", "runner"), default="creator")
    start.add_argument("--idle-seconds", type=int, default=_DEFAULT_IDLE_SECONDS)
    start.add_argument("--startup-seconds", type=float,
                       default=_DEFAULT_STARTUP_SECONDS)
    start.add_argument("--no-open-browser", action="store_true")
    status = sub.add_parser("status")
    status.add_argument("--project-root", required=True)
    stop = sub.add_parser("stop")
    stop.add_argument("--project-root", required=True)
    for name in ("creator-jobs", "runner-jobs"):
        command = sub.add_parser(name)
        command.add_argument("--project-root", required=True)
    agent_submit = sub.add_parser("runner-agent-submit")
    agent_submit.add_argument("--project-root", required=True)
    agent_submit.add_argument("--run-ref", required=True)
    agent_submit.add_argument("--job-id", required=True)
    agent_submit.add_argument("--expected-revision", required=True)
    agent_submit.add_argument("--result-file", required=True)
    agent_submit.add_argument("--claim-token")
    agent_claim = sub.add_parser("runner-agent-claim")
    agent_claim.add_argument("--project-root", required=True)
    agent_claim.add_argument("--watcher-id", required=True)
    agent_claim.add_argument("--run-ref", required=True)
    agent_claim.add_argument("--job-id", required=True)
    agent_claim.add_argument("--expected-revision", required=True)
    agent_claim.add_argument("--claim-token")
    input_draft = sub.add_parser("runner-input-draft")
    input_draft.add_argument("--project-root", required=True)
    input_draft.add_argument("--parse-job-id", required=True)
    input_draft.add_argument("--expected-revision", required=True)
    input_draft.add_argument("--result-file", required=True)
    input_draft.add_argument("--claim-token")
    input_submit = sub.add_parser("runner-input-submit")
    input_submit.add_argument("--project-root", required=True)
    input_submit.add_argument("--parse-job-id", required=True)
    input_submit.add_argument("--expected-revision", required=True)
    input_submit.add_argument("--result-file", required=True)
    input_submit.add_argument("--claim-token")
    input_reject = sub.add_parser("runner-input-reject")
    input_reject.add_argument("--project-root", required=True)
    input_reject.add_argument("--parse-job-id", required=True)
    input_reject.add_argument("--expected-revision", required=True)
    input_reject.add_argument("--result-file", required=True)
    input_reject.add_argument("--claim-token")
    serve = sub.add_parser("_serve")
    serve.add_argument("--project-root", required=True)
    serve.add_argument("--idle-seconds", type=int, required=True)
    return parser


def main(argv=None):
    util.utf8_stdout()
    args = _parser().parse_args(argv)
    try:
        if args.command == "start":
            result = start_dashboard(
                args.project_root,
                tab=args.tab,
                idle_seconds=args.idle_seconds,
                startup_seconds=args.startup_seconds,
                open_browser=not args.no_open_browser,
            )
        elif args.command == "status":
            result = dashboard_status(args.project_root)
        elif args.command == "stop":
            result = stop_dashboard(args.project_root)
        elif args.command == "creator-jobs":
            result = dashboard_jobs(args.project_root, "creator")
        elif args.command == "runner-jobs":
            result = dashboard_jobs(args.project_root, "runner")
        elif args.command == "runner-agent-submit":
            result = submit_dashboard_runner_agent(
                args.project_root,
                args.run_ref,
                args.job_id,
                args.expected_revision,
                args.result_file,
                args.claim_token,
            )
        elif args.command == "runner-agent-claim":
            result = agent_jobs.claim_dashboard_runner_job(
                args.project_root,
                args.watcher_id,
                args.run_ref,
                args.job_id,
                args.expected_revision,
                args.claim_token,
            )
        elif args.command == "runner-input-draft":
            controller = Controller(_canonical_root(args.project_root))
            result = agent_jobs.apply_claim_fence(
                args.project_root, args.claim_token,
                lambda: DashboardInputJobs(controller).draft(
                    args.parse_job_id,
                    args.expected_revision,
                    args.result_file,
                ),
            )
        elif args.command == "runner-input-submit":
            controller = Controller(_canonical_root(args.project_root))
            input_jobs = DashboardInputJobs(controller)
            result = agent_jobs.apply_claim_fence(
                args.project_root, args.claim_token,
                lambda: input_jobs.submit(
                    args.parse_job_id,
                    args.expected_revision,
                    args.result_file,
                    defer_pump=True,
                ),
            )
            if result.get("status") == "running":
                boundary = controller.run_next(
                    result.get("run_ref"),
                    expected_revision=result.get("revision"),
                    idempotency_key=runner_app._idempotency_key("run_next", {
                        "run_ref": result.get("run_ref"),
                        "revision": result.get("revision"),
                    }),
                )
                if boundary.get("status") in ("paused", "done", "error"):
                    result = input_jobs.complete_submit(
                        args.parse_job_id, boundary, result.get("result_path"))
                else:
                    result = boundary
        elif args.command == "runner-input-reject":
            controller = Controller(_canonical_root(args.project_root))
            result = agent_jobs.apply_claim_fence(
                args.project_root, args.claim_token,
                lambda: DashboardInputJobs(controller).reject(
                    args.parse_job_id,
                    args.expected_revision,
                    args.result_file,
                ),
            )
        else:
            return _serve_dashboard(args.project_root, args.idle_seconds)
    except (OSError, ValueError, RuntimeError, KeyError,
            json.JSONDecodeError) as exc:
        result = {
            "status": "error",
            "reason_code": "dashboard_app_failed",
            "reason": str(exc),
        }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") not in ("error", "invalid") else 1


if __name__ == "__main__":
    raise SystemExit(main())
