# -*- coding: utf-8 -*-
"""등록 없이 자동으로 실행되는 프로젝트 로컬 Runner.

각 CLI 명령은 프로젝트의 로컬 Runner를 확인하고, 없으면 현재 Python으로 백그라운드
프로세스를 실행한다. 요청은 AI 작업, 사용자 입력, 완료 또는 오류가 나올 때까지 처리하고
그 결과를 표준 출력의 JSON으로 반환한다.

Task JSON과 run JSON은 기존 Engine/Controller 형식을 그대로 사용한다. 서버가 유휴 종료되거나
비정상 종료되어도 다음 CLI 명령이 새 서버를 자동 실행하므로 대기 중 run에는 영향이 없다.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import build_opener, ProxyHandler, Request

from . import agent_jobs, local_process, mutation_lock, util, workspace
from .controller import Controller
from .runner_http import RunnerHTTP


_DEFAULT_IDLE_SECONDS = 30 * 60
_DEFAULT_STARTUP_SECONDS = 10
_DEFAULT_CALL_SECONDS = 3660
_HEARTBEAT_SECONDS = 3
_MAX_RESULT_BYTES = 2 * 1024 * 1024
_SERVER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,80}$")
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,160}$")


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


_canonical_root = local_process.canonical_root


def _record_path(controller):
    path = os.path.realpath(os.path.join(
        controller.controller_dir, "runner-server.json"))
    if not controller._inside(path, controller.project_root):
        raise ValueError("Runner 서버 상태 경로가 프로젝트 루트 밖을 가리킵니다")
    return path


def _stop_path(controller):
    path = os.path.realpath(os.path.join(
        controller.controller_dir, "runner-server.stop.json"))
    if not controller._inside(path, controller.project_root):
        raise ValueError("Runner 서버 중지 경로가 프로젝트 루트 밖을 가리킵니다")
    return path


_write_private = local_process.write_private


def _read_record(controller):
    path = _record_path(controller)
    if not os.path.isfile(path):
        return None
    value = util.load_json(path)
    if not isinstance(value, dict) or value.get("type") != "ops_runner_server":
        raise ValueError("Runner 서버 상태 파일 형식이 올바르지 않습니다")
    if _canonical_root(str(value.get("project_root") or "")) != controller.project_root:
        raise ValueError("Runner 서버 상태의 프로젝트 루트가 일치하지 않습니다")
    if not _SERVER_ID_RE.fullmatch(str(value.get("server_id") or "")):
        raise ValueError("Runner server_id 형식이 올바르지 않습니다")
    if not _TOKEN_RE.fullmatch(str(value.get("control_token") or "")):
        raise ValueError("Runner control token 형식이 올바르지 않습니다")
    return value


def _remove_owned_record(controller, server_id=None):
    path = _record_path(controller)
    if not os.path.isfile(path):
        return
    try:
        current = _read_record(controller)
    except (OSError, ValueError, json.JSONDecodeError):
        current = None
    if server_id is not None and (
            not current or current.get("server_id") != server_id):
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


_process_alive = local_process.process_alive


def _worker_argv(project_root, idle_seconds):
    return [
        os.path.abspath(sys.executable),
        "-B",
        "-m",
        "ops_runtime.runner_app",
        "_serve",
        "--project-root",
        project_root,
        "--idle-seconds",
        str(idle_seconds),
    ]


_spawn_worker = local_process.spawn_worker


def _reap_later(child):
    local_process.reap_later(child, "runner-app-reaper")


def _validated_base_url(value):
    parsed = urlsplit(str(value or ""))
    if (
        parsed.scheme != "http"
        or parsed.hostname not in ("127.0.0.1", "localhost")
        or parsed.port is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Runner 서버 주소가 안전한 loopback URL이 아닙니다")
    return f"http://127.0.0.1:{parsed.port}"


def _post_record(record, payload, timeout=30):
    try:
        base_url = _validated_base_url(record.get("base_url"))
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            base_url + "/v1/command",
            data=raw,
            method="POST",
            headers={
                "Authorization": "Bearer " + record["control_token"],
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return {
            "status": "error",
            "reason_code": "runner_protocol_failed",
            "reason": str(exc),
        }
    opener = build_opener(ProxyHandler({}))
    try:
        try:
            response = opener.open(request, timeout=timeout)
        except HTTPError as exc:
            response = exc
        with response:
            body = response.read(_MAX_RESULT_BYTES + 1)
    except (OSError, TimeoutError, URLError) as exc:
        return {
            "status": "error",
            "reason_code": "runner_transport_failed",
            "reason": str(exc),
        }
    try:
        if len(body) > _MAX_RESULT_BYTES:
            raise ValueError("Runner 서버 응답이 허용 크기를 초과했습니다")
        result = json.loads(body.decode("utf-8"))
        if not isinstance(result, dict):
            raise ValueError("Runner 서버 응답이 JSON 객체가 아닙니다")
        return result
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        return {
            "status": "error",
            "reason_code": "runner_protocol_failed",
            "reason": str(exc),
        }


def _live_record(controller):
    try:
        record = _read_record(controller)
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    if not record or not _process_alive(record.get("pid")):
        return None
    health = _post_record(record, {"action": "health"}, timeout=2)
    if (
        health.get("status") != "ok"
        or health.get("server_id") != record.get("server_id")
        or _canonical_root(str(health.get("project_root") or ""))
        != controller.project_root
    ):
        return None
    return record


def _request_stop(controller, record, wait_seconds=2):
    stop_path = _stop_path(controller)
    _write_private(stop_path, {
        "type": "ops_runner_stop",
        "server_id": record.get("server_id"),
        "requested_at": _now(),
    })
    deadline = time.time() + max(0, float(wait_seconds))
    while time.time() < deadline and _process_alive(record.get("pid")):
        time.sleep(0.05)
    stopped = not _process_alive(record.get("pid"))
    if stopped:
        try:
            os.remove(stop_path)
        except FileNotFoundError:
            pass
    return stopped


def ensure_runner_server(project_root, idle_seconds=_DEFAULT_IDLE_SECONDS,
                         startup_seconds=_DEFAULT_STARTUP_SECONDS):
    """필요하면 백그라운드 서버를 시작하고 검증된 접속 정보를 반환한다."""
    root = _canonical_root(project_root)
    controller = Controller(root)
    try:
        idle_seconds = int(idle_seconds)
        startup_seconds = float(startup_seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError("Runner 서버 시간 설정이 숫자가 아닙니다") from exc
    if not 5 <= idle_seconds <= 24 * 60 * 60:
        raise ValueError("idle_seconds는 5초 이상 24시간 이하여야 합니다")
    if not 0.1 <= startup_seconds <= 60:
        raise ValueError("startup_seconds는 0.1초 이상 60초 이하여야 합니다")
    live = _live_record(controller)
    if live:
        return live

    # 동시 첫 호출에서 detached worker가 여러 개 생기지 않도록 프로젝트 락 안에서
    # 상태를 한 번 더 확인하고 오직 하나만 실행한다.
    with mutation_lock.resource_mutation_lock(
            root, "runner-startup", root, blocking=True):
        live = _live_record(controller)
        if live:
            return live
        try:
            stale = _read_record(controller)
        except (OSError, ValueError, json.JSONDecodeError):
            stale = None
        # PID liveness alone is not ownership proof.  Replace an unhealthy
        # record without waiting for or signalling an unrelated/reused PID.
        # Any genuinely old worker observes the lost server_id and drains.
        _remove_owned_record(controller)
        try:
            os.remove(_stop_path(controller))
        except FileNotFoundError:
            pass
        child = _spawn_worker(_worker_argv(root, idle_seconds), root)
        _reap_later(child)
        deadline = time.time() + startup_seconds
        last_error = None
        while time.time() < deadline:
            live = _live_record(controller)
            if live:
                return live
            if child.poll() is not None:
                last_error = (
                    f"Runner worker가 시작 중 종료되었습니다(exit {child.returncode})")
                break
            time.sleep(0.05)
        if child.poll() is None:
            try:
                _request_stop(controller, {
                    "server_id": None,
                    "pid": child.pid,
                }, wait_seconds=1)
            except OSError:
                pass
        raise RuntimeError(last_error or "Runner 서버 시작 시간을 초과했습니다")


def call_runner(project_root, payload, idle_seconds=_DEFAULT_IDLE_SECONDS,
                startup_seconds=_DEFAULT_STARTUP_SECONDS,
                timeout=_DEFAULT_CALL_SECONDS):
    """Standalone 서버를 호출하고 유실된 응답은 안전하게 한 번 재시도한다.

    Mutation callers must include an idempotency key. If the first response is lost,
    retrying the same payload cannot repeat the underlying mutation.
    """
    root = _canonical_root(project_root)
    controller = Controller(root)
    last = None
    record = None
    for _attempt in range(2):
        if record is None:
            record = ensure_runner_server(
                root, idle_seconds=idle_seconds,
                startup_seconds=startup_seconds)
        last = _post_record(record, payload, timeout=timeout)
        if last.get("reason_code") == "runner_draining":
            # health 확인 직후 idle 종료가 시작될 수 있다. dispatch 전에 거절된
            # 요청이므로 기존 worker의 정상 종료를 잠깐 기다렸다 새 worker에 같은
            # payload를 한 번 보내는 것은 안전하다.
            deadline = time.time() + min(2.0, float(startup_seconds))
            while (
                time.time() < deadline
                and _process_alive(record.get("pid"))
            ):
                time.sleep(0.05)
            if _process_alive(record.get("pid")):
                return last
            _remove_owned_record(controller, record.get("server_id"))
            record = None
            continue
        if last.get("reason_code") != "runner_transport_failed":
            return last
        if not _process_alive(record.get("pid")):
            _remove_owned_record(controller, record.get("server_id"))
            record = None
            continue
        # 응답만 유실됐고 같은 서버가 살아 있으면 같은 payload/idempotency로
        # 그 서버에 재시도한다. health도 응답하지 않는 살아 있는 프로세스는 작업
        # 중일 수 있으므로 record를 지우거나 새 worker로 교체하지 않는다.
        health = _post_record(record, {"action": "health"}, timeout=2)
        if not (
            health.get("status") == "ok"
            and health.get("server_id") == record.get("server_id")
            and _canonical_root(str(health.get("project_root") or ""))
                == controller.project_root
        ):
            return {
                "status": "error",
                "reason_code": "runner_transport_uncertain",
                "reason": (
                    "Runner 응답을 받지 못했지만 서버 프로세스가 살아 있어 "
                    "실행 중인 작업을 강제 종료하지 않았습니다. 잠시 뒤 상태를 "
                    "다시 조회하세요"
                ),
                "retryable": True,
            }
    if last and last.get("reason_code") == "runner_transport_failed":
        return {
            **last,
            "reason_code": "runner_transport_uncertain",
            "reason": (
                "같은 Runner 서버에 안전하게 재시도했지만 응답을 받지 못했습니다. "
                "실행 중인 작업을 강제 종료하지 않았으므로 잠시 뒤 상태를 다시 "
                "조회하세요"
            ),
            "retryable": True,
        }
    return last or {
        "status": "error",
        "reason_code": "runner_transport_failed",
        "reason": "Runner 서버 응답을 받지 못했습니다",
    }


def runner_server_status(project_root):
    controller = Controller(_canonical_root(project_root))
    record = _live_record(controller)
    if not record:
        return {
            "status": "stopped",
            "mode": "standalone_local_runner",
        }
    health = _post_record(record, {"action": "health"}, timeout=2)
    return {
        "status": "running" if health.get("status") == "ok" else "error",
        "mode": "standalone_local_runner",
        "started_at": record.get("started_at"),
        "heartbeat_at": record.get("heartbeat_at"),
        "idle_seconds": record.get("idle_seconds"),
        **({
            "reason_code": health.get("reason_code"),
            "reason": health.get("reason"),
        } if health.get("status") != "ok" else {}),
    }


def stop_runner_server(project_root, wait_seconds=5):
    controller = Controller(_canonical_root(project_root))
    try:
        record = _read_record(controller)
    except (OSError, ValueError, json.JSONDecodeError):
        record = None
    if not record or not _process_alive(record.get("pid")):
        _remove_owned_record(controller)
        return {"status": "stopped", "mode": "standalone_local_runner"}
    stopped = _request_stop(controller, record, wait_seconds=wait_seconds)
    alive = not stopped
    if not alive:
        _remove_owned_record(controller, record.get("server_id"))
    return {
        "status": "stop_requested" if alive else "stopped",
        "mode": "standalone_local_runner",
    }


def _refresh_owned_record(controller, record):
    """Refresh a heartbeat only while this Runner still owns the record."""
    root = controller.project_root
    with mutation_lock.resource_mutation_lock(
            root, "runner-startup", root, blocking=True):
        try:
            owner = _read_record(controller)
        except (OSError, ValueError, json.JSONDecodeError):
            owner = None
        if owner is None or owner.get("server_id") != record.get("server_id"):
            return False
        record["heartbeat_at"] = _now()
        _write_private(_record_path(controller), record)
        return True


def _serve_runner(project_root, idle_seconds):
    root = _canonical_root(project_root)
    controller = Controller(root)
    idle_seconds = int(idle_seconds)
    if not 5 <= idle_seconds <= 24 * 60 * 60:
        return 2
    server_id = secrets.token_urlsafe(24)
    control_token = secrets.token_urlsafe(48)
    bridge = RunnerHTTP(controller, control_token, server_id)
    record_path = _record_path(controller)
    stop_path = _stop_path(controller)
    record = None
    draining = False
    try:
        bridge.start()
        record = {
            "type": "ops_runner_server",
            "project_root": root,
            "pid": os.getpid(),
            "server_id": server_id,
            "server_generation": server_id,
            "control_token": control_token,
            "base_url": bridge.base_url,
            "started_at": _now(),
            "heartbeat_at": _now(),
            "idle_seconds": idle_seconds,
        }
        _write_private(record_path, record)
        next_heartbeat = time.monotonic() + _HEARTBEAT_SECONDS
        while True:
            if not draining and os.path.isfile(stop_path):
                try:
                    request = util.load_json(stop_path)
                except (OSError, ValueError, json.JSONDecodeError):
                    request = {}
                requested = request.get("server_id")
                if requested in (None, server_id):
                    bridge.begin_shutdown()
                    draining = True
            try:
                owner = _read_record(controller)
            except (OSError, ValueError, json.JSONDecodeError):
                owner = None
            if (
                not draining
                and (not owner or owner.get("server_id") != server_id)
            ):
                bridge.begin_shutdown()
                draining = True
            if (
                not draining
                and bridge.active_commands == 0
                and time.monotonic() - bridge.last_activity >= idle_seconds
            ):
                bridge.begin_shutdown()
                draining = True
            if draining:
                if bridge.active_commands == 0:
                    return 0
                time.sleep(0.1)
                continue
            if (
                owner
                and owner.get("server_id") == server_id
                and time.monotonic() >= next_heartbeat
            ):
                if not _refresh_owned_record(controller, record):
                    bridge.begin_shutdown()
                    draining = True
                    continue
                next_heartbeat = time.monotonic() + _HEARTBEAT_SECONDS
            time.sleep(0.1)
    finally:
        bridge.stop()
        _remove_owned_record(controller, server_id)
        try:
            if os.path.isfile(stop_path):
                request = util.load_json(stop_path)
                if request.get("server_id") in (None, server_id):
                    os.remove(stop_path)
        except (OSError, ValueError, json.JSONDecodeError):
            pass


def _idempotency_key(action, value, nonce=None):
    material = {
        "action": action,
        "value": value,
        "nonce": nonce,
    }
    raw = json.dumps(
        material, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), default=str).encode("utf-8")
    return f"runner-{action}-" + hashlib.sha256(raw).hexdigest()[:32]


def _command_line(argv):
    return subprocess.list2cmdline(argv) if os.name == "nt" else shlex.join(argv)


def _decorate_result(project_root, result):
    if not isinstance(result, dict):
        return result
    out = json.loads(json.dumps(result, ensure_ascii=False))
    out.setdefault("mode", "standalone_local_runner")
    if out.get("status") != "paused" or not isinstance(out.get("job"), dict):
        return out
    job = out["job"]
    run_ref = out.get("run_ref")
    job_id = str(job.get("job_id") or "")
    revision = str(out.get("revision") or job.get("revision") or "")
    actor = job.get("actor")
    if not run_ref or not job_id or not revision or actor not in ("agent", "user"):
        return out
    root = _canonical_root(project_root)
    payload_dir = workspace.ensure_dirs(root)["payloads"]
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(run_ref))[:80]
    payload_path = os.path.join(payload_dir, f"{stem}__{job_id}.json")
    subcommand = "agent-submit" if actor == "agent" else "human-submit"
    argv = [
        os.path.abspath(sys.executable),
        "-B",
        "-m",
        "ops_runtime.runner_app",
        subcommand,
        "--project-root",
        root,
        "--run-ref",
        run_ref,
        "--job-id",
        job_id,
        "--revision",
        revision,
        "--result-file",
        payload_path,
    ]
    out["payload_file"] = os.path.relpath(
        payload_path, root).replace(os.sep, "/")
    out["resume_command"] = _command_line(argv)
    handoff = out.get("handoff")
    if (
        isinstance(handoff, dict)
        and handoff.get("url")
        and not handoff.get("opened")
    ):
        open_argv = [
            os.path.abspath(sys.executable),
            "-B",
            "-m",
            "ops_runtime.runner_app",
            "open-url",
            "--project-root",
            root,
            "--run-ref",
            run_ref,
            "--job-id",
            job_id,
            "--revision",
            revision,
        ]
        handoff["open_command"] = _command_line(open_argv)
    return out


def _choose_run(project_root, listed, selection_text):
    """Controller run_list의 번호 응답을 submit 방식과 동일하게 결정적으로 해석한다."""
    if not isinstance(listed, dict) or listed.get("status") != "ok":
        return listed
    selection = listed.get("selection") or {}
    choices = selection.get("choices") or []
    text = str(selection_text or "").strip()
    match = re.match(r"^(\d+)\s*(?:[.)]\s*)?(.*)$", text)
    if not match:
        return {
            "status": "invalid",
            "reason_code": "invalid_run_selection",
            "reason": "기존 건은 <번호>, 신규 건은 <마지막 번호>. <새 Key>로 입력하세요",
            "selection": selection,
        }
    number, suffix = int(match.group(1)), match.group(2).strip()
    choice = next(
        (item for item in choices if item.get("number") == number), None)
    if choice is None:
        return {
            "status": "invalid",
            "reason_code": "invalid_run_selection",
            "reason": "목록에 있는 번호를 입력하세요",
            "selection": selection,
        }
    if choice.get("action") == "resume":
        if suffix:
            return {
                "status": "invalid",
                "reason_code": "invalid_run_selection",
                "reason": "기존 건 번호 뒤에는 Key를 입력하지 마세요",
                "selection": selection,
            }
        key = choice.get("key")
    else:
        if not suffix:
            return {
                "status": "invalid",
                "reason_code": "invalid_run_selection",
                "reason": "신규 작업에는 Key를 직접 입력해야 합니다",
                "selection": selection,
            }
        if len(suffix) > 100 or re.search(r"[\\/\r\n\x00-\x1f]", suffix):
            return {
                "status": "invalid",
                "reason_code": "invalid_run_key",
                "reason": "Key는 100자 이하이며 경로 문자나 제어 문자를 포함할 수 없습니다",
            }
        existing = {str(item.get("key")) for item in listed.get("runs") or []}
        if suffix in existing:
            return {
                "status": "conflict",
                "reason_code": "duplicate_run_key",
                "reason": f"이미 존재하는 Key입니다: {suffix}",
            }
        key = suffix
    root = _canonical_root(project_root)
    task_ref = listed.get("task_ref")
    fingerprint = listed.get("task_fingerprint")
    argv = [
        os.path.abspath(sys.executable),
        "-B",
        "-m",
        "ops_runtime.runner_app",
    ]
    if choice.get("action") == "resume":
        run_ref = choice.get("run_ref")
        revision = choice.get("revision")
        if not run_ref or not revision:
            return {
                "status": "invalid",
                "reason_code": "invalid_run_selection_contract",
                "reason": "선택한 기존 run의 식별 정보가 없습니다. 목록을 다시 조회하세요",
            }
        argv.extend([
            "next",
            "--project-root",
            root,
            "--run-ref",
            str(run_ref),
            "--expected-revision",
            str(revision),
        ])
    else:
        argv.extend([
            "start",
            "--project-root",
            root,
            "--task-ref",
            task_ref,
            "--key",
            str(key),
            "--expected-task-fingerprint",
            str(fingerprint),
        ])
    return {
        "status": "ok",
        "mode": "standalone_local_runner",
        "action": choice.get("action"),
        "key": key,
        "task_ref": task_ref,
        "task_fingerprint": fingerprint,
        "start_command": _command_line(argv),
    }


def _read_result_file(controller, value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("result-file 경로가 비었습니다")
    path = controller.authorize_path(value.strip(), "read")
    if os.path.splitext(path)[1].lower() != ".json":
        raise ValueError("result-file은 .json 파일이어야 합니다")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"result-file을 찾을 수 없습니다: {value}")
    if os.path.getsize(path) > _MAX_RESULT_BYTES:
        raise ValueError("result-file이 허용 크기를 초과했습니다")
    result = util.load_json(path)
    if not isinstance(result, dict):
        raise ValueError("result-file 최상위 값은 JSON 객체여야 합니다")
    return result, path


def _read_stdin_result():
    if hasattr(sys.stdin, "isatty") and sys.stdin.isatty():
        raise ValueError("result JSON을 stdin으로 전달하거나 --result-file을 사용하세요")
    stream = getattr(sys.stdin, "buffer", sys.stdin)
    raw = stream.read(_MAX_RESULT_BYTES + 1)
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if len(raw) > _MAX_RESULT_BYTES:
        raise ValueError("stdin result가 허용 크기를 초과했습니다")
    result = json.loads(raw.decode("utf-8"))
    if not isinstance(result, dict):
        raise ValueError("stdin result 최상위 값은 JSON 객체여야 합니다")
    return result


def _print_result(value):
    print(json.dumps(value, ensure_ascii=False))


def _add_project(parser, idle=True):
    parser.add_argument("--project-root", required=True)
    if idle:
        parser.add_argument(
            "--idle-seconds", type=int, default=_DEFAULT_IDLE_SECONDS,
            help=argparse.SUPPRESS)
        parser.add_argument(
            "--startup-seconds", type=float, default=_DEFAULT_STARTUP_SECONDS,
            help=argparse.SUPPRESS)


def main(argv=None):
    util.utf8_stdout()
    parser = argparse.ArgumentParser(
        description="등록 없이 자동 실행되는 Standalone Runner")
    sub = parser.add_subparsers(dest="command", required=True)

    runs = sub.add_parser("runs")
    _add_project(runs)
    runs.add_argument("--task-ref", required=True)

    choose = sub.add_parser("choose-run")
    _add_project(choose)
    choose.add_argument("--task-ref", required=True)
    choose.add_argument("--selection", required=True)

    start = sub.add_parser("start")
    _add_project(start)
    start.add_argument("--task-ref", required=True)
    start.add_argument("--key", required=True)
    start.add_argument("--expected-task-fingerprint", required=True)
    start.add_argument("--idempotency-key")

    status = sub.add_parser("status")
    _add_project(status)
    status.add_argument("--run-ref", required=True)

    nxt = sub.add_parser("next")
    _add_project(nxt)
    nxt.add_argument("--run-ref", required=True)
    nxt.add_argument("--expected-revision", required=True)
    nxt.add_argument("--idempotency-key")

    for name in ("agent-submit", "human-submit"):
        submit = sub.add_parser(name)
        _add_project(submit)
        submit.add_argument("--run-ref", required=True)
        submit.add_argument("--job-id", required=True)
        submit.add_argument("--revision", required=True)
        submit.add_argument("--idempotency-key")
        submit.add_argument("--result-file")
        submit.add_argument("--claim-token")

    open_url = sub.add_parser("open-url")
    _add_project(open_url)
    open_url.add_argument("--run-ref", required=True)
    open_url.add_argument("--job-id", required=True)
    open_url.add_argument("--revision", required=True)
    open_url.add_argument("--delay", type=int, default=2)
    open_url.add_argument("--idempotency-key")

    server_status = sub.add_parser("server-status")
    _add_project(server_status, idle=False)

    stop = sub.add_parser("stop-server")
    _add_project(stop, idle=False)
    stop.add_argument("--wait-seconds", type=float, default=5)

    serve = sub.add_parser("_serve", help=argparse.SUPPRESS)
    _add_project(serve, idle=False)
    serve.add_argument("--idle-seconds", type=int, required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "_serve":
            return _serve_runner(args.project_root, args.idle_seconds)
        if args.command == "server-status":
            _print_result(runner_server_status(args.project_root))
            return 0
        if args.command == "stop-server":
            result = stop_runner_server(
                args.project_root, wait_seconds=args.wait_seconds)
            _print_result(result)
            return 0 if result.get("status") == "stopped" else 1

        submission_claim_token = None
        if args.command in ("runs", "choose-run"):
            payload = {
                "action": "run_list",
                "task_ref": args.task_ref,
            }
        elif args.command == "start":
            idem = args.idempotency_key or _idempotency_key(
                "start",
                {
                    "task_ref": args.task_ref,
                    "key": args.key,
                    "task_fingerprint": args.expected_task_fingerprint,
                },
                nonce=secrets.token_hex(8),
            )
            payload = {
                "action": "run_start",
                "task_ref": args.task_ref,
                "key": args.key,
                "expected_task_fingerprint": args.expected_task_fingerprint,
                "idempotency_key": idem,
            }
        elif args.command == "status":
            payload = {
                "action": "run_status",
                "run_ref": args.run_ref,
            }
        elif args.command == "next":
            idem = args.idempotency_key or _idempotency_key(
                "next", {
                    "run_ref": args.run_ref,
                    "revision": args.expected_revision,
                })
            payload = {
                "action": "run_next",
                "run_ref": args.run_ref,
                "expected_revision": args.expected_revision,
                "idempotency_key": idem,
            }
        elif args.command in ("agent-submit", "human-submit"):
            submission_claim_token = args.claim_token
            controller = Controller(_canonical_root(args.project_root))
            result_path = None
            if args.result_file:
                submitted, result_path = _read_result_file(
                    controller, args.result_file)
            else:
                submitted = _read_stdin_result()
            action = (
                "run_complete_agent_job"
                if args.command == "agent-submit"
                else "run_complete_human_job"
            )
            idem = args.idempotency_key or _idempotency_key(
                action, {
                    "run_ref": args.run_ref,
                    "job_id": args.job_id,
                    "revision": args.revision,
                    "result": submitted,
                })
            payload = {
                "action": action,
                "run_ref": args.run_ref,
                "job_id": args.job_id,
                "revision": args.revision,
                "idempotency_key": idem,
                "result": submitted,
            }
            if submission_claim_token:
                payload["defer_pump"] = True
        else:
            idem = args.idempotency_key or _idempotency_key(
                "open-url", {
                    "run_ref": args.run_ref,
                    "job_id": args.job_id,
                    "revision": args.revision,
                    "delay": args.delay,
                }, nonce=secrets.token_hex(8))
            payload = {
                "action": "run_open_url",
                "run_ref": args.run_ref,
                "job_id": args.job_id,
                "revision": args.revision,
                "delay": args.delay,
                "idempotency_key": idem,
            }

        result = agent_jobs.apply_claim_fence(
            args.project_root, submission_claim_token,
            lambda: call_runner(
                args.project_root,
                payload,
                idle_seconds=args.idle_seconds,
                startup_seconds=args.startup_seconds,
            ),
        )
        if submission_claim_token and result.get("status") == "running":
            continuation_key = _idempotency_key("run_next", {
                "run_ref": args.run_ref,
                "revision": result.get("revision"),
            })
            result = call_runner(
                args.project_root,
                {
                    "action": "run_next",
                    "run_ref": args.run_ref,
                    "expected_revision": result.get("revision"),
                    "idempotency_key": continuation_key,
                },
                idle_seconds=args.idle_seconds,
                startup_seconds=args.startup_seconds,
            )
        if args.command == "choose-run":
            result = _choose_run(
                args.project_root, result, args.selection)
        decorated = _decorate_result(args.project_root, result)
        if (
            args.command in ("agent-submit", "human-submit")
            and result_path
            and result.get("status") in ("paused", "done")
            and workspace.is_consumable_payload(result_path)
        ):
            try:
                os.remove(result_path)
            except OSError:
                pass
        _print_result(decorated)
        return 0 if result.get("status") in ("ok", "paused", "done") else 1
    except (
        OSError, ValueError, PermissionError, RuntimeError,
        mutation_lock.MutationBusy, json.JSONDecodeError,
    ) as exc:
        _print_result({
            "status": "error",
            "mode": "standalone_local_runner",
            "reason_code": "runner_command_failed",
            "reason": str(exc),
        })
        return 1


if __name__ == "__main__":
    sys.exit(main())
