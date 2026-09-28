# -*- coding: utf-8 -*-
"""필요할 때 자동으로 실행되는 프로젝트 로컬 Creator 서버.

Creator 스킬이 ``start``를 호출하면 현재 Python으로 백그라운드 프로세스를 실행한다.
이 프로세스는 :class:`ConnectedHTTP`와 :class:`Controller`를 재사용하며,
브라우저 저작 단계가 끝나거나 유휴 시간이 지나거나 ``stop`` 요청을 받으면 종료한다.

CLI:
  python -m ops_runtime.creator_app start  --project-root . --task-ref <task.json>
  python -m ops_runtime.creator_app revise --project-root . --task-ref <task.json>
  python -m ops_runtime.creator_app status --project-root . --launch-id <id>
  python -m ops_runtime.creator_app stop   --project-root . --launch-id <id>

``_serve``는 실행기가 사용하는 내부 명령이다. 브라우저 접근 토큰과 CSRF 값은
명령 인자, 표준 출력, 실행 상태 파일 어디에도 기록하지 않는다.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
import webbrowser

from .connected_http import ConnectedHTTP
from .controller import Controller
from .node_tests import NodeTestService
from . import (agent_jobs, author_drafts, custom_logic_jobs, local_process, mcp_status,
               util, workspace)


_LAUNCH_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,80}$")
_DEFAULT_IDLE_SECONDS = 30 * 60
_DEFAULT_STARTUP_SECONDS = 10
_HEARTBEAT_SECONDS = 3
_FINAL_STATUSES = {"completed", "expired", "stopped", "error"}
_DRAFT_INPUT_MAX_BYTES = 1024 * 1024
_NODE_TEST_INPUT_MAX_BYTES = 2 * 1024 * 1024
_CREATOR_INTENTS = {"author", "revise"}


class _BrowserOpenError(RuntimeError):
    pass


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


_canonical_root = local_process.canonical_root


def _launch_dir(controller):
    path = os.path.realpath(os.path.join(
        controller.controller_dir, "creator-launches"))
    if not controller._inside(path, controller.project_root):
        raise ValueError("Creator 상태 경로가 프로젝트 루트 밖을 가리킵니다")
    os.makedirs(path, exist_ok=True)
    return path


def _validate_launch_id(value):
    if not isinstance(value, str) or not _LAUNCH_ID_RE.fullmatch(value):
        raise ValueError("launch_id 형식이 잘못되었습니다")
    return value


def _state_path(controller, launch_id):
    launch_id = _validate_launch_id(launch_id)
    folder = _launch_dir(controller)
    path = os.path.realpath(os.path.join(folder, launch_id + ".json"))
    if not controller._inside(path, folder):
        raise ValueError("Creator 상태 파일 경로가 잘못되었습니다")
    return path


def _stop_path(controller, launch_id):
    launch_id = _validate_launch_id(launch_id)
    folder = _launch_dir(controller)
    path = os.path.realpath(os.path.join(folder, launch_id + ".stop.json"))
    if not controller._inside(path, folder):
        raise ValueError("Creator 중지 파일 경로가 잘못되었습니다")
    return path


def _draft_path(controller, launch_id):
    launch_id = _validate_launch_id(launch_id)
    folder = _launch_dir(controller)
    path = os.path.realpath(os.path.join(folder, launch_id + ".drafts.json"))
    if not controller._inside(path, folder):
        raise ValueError("Creator 초안 상태 파일 경로가 잘못되었습니다")
    return path


def _load_state(controller, launch_id):
    path = _state_path(controller, launch_id)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Creator 실행 상태가 없습니다: {launch_id}")
    value = util.load_json(path)
    if value.get("launch_id") != launch_id:
        raise ValueError("Creator 실행 상태의 launch_id가 일치하지 않습니다")
    task_ref = value.get("task_ref")
    controller._task_path(task_ref)
    return value


def _load_drafts(controller, launch_id, task_ref=None):
    path = _draft_path(controller, launch_id)
    if not os.path.isfile(path):
        return {
            "type": "ops_author_drafts",
            "launch_id": launch_id,
            "task_ref": task_ref,
            "drafts": [],
        }
    value = util.load_json(path)
    if (not isinstance(value, dict)
            or value.get("type") != "ops_author_drafts"
            or value.get("launch_id") != launch_id):
        raise ValueError("Creator AI 초안 상태가 올바르지 않습니다")
    stored_ref = value.get("task_ref")
    if task_ref is not None and stored_ref not in (None, task_ref):
        raise ValueError("Creator AI 초안의 task_ref가 일치하지 않습니다")
    value.setdefault("task_ref", task_ref)
    value.setdefault("drafts", [])
    return value


def _write_drafts(controller, launch_id, value):
    path = _draft_path(controller, launch_id)
    document = {
        "type": "ops_author_drafts",
        "launch_id": launch_id,
        "task_ref": value.get("task_ref"),
        "drafts": value.get("drafts") or [],
        "updated_at": _now(),
    }
    util.atomic_write_json(path, document)
    try:
        os.chmod(path, 0o600)
    except OSError:
        # Windows에서는 프로젝트 폴더의 사용자 ACL을 그대로 사용한다.
        pass
    return document


def _cleanup_drafts(controller, launch_id):
    try:
        path = _draft_path(controller, launch_id)
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def _write_state(path, value):
    data = dict(value)
    data["updated_at"] = _now()
    util.atomic_write_json(path, data)
    return data


def _public_state(value):
    """CLI에 노출해도 되는 상태만 반환한다."""
    allowed = (
        "status", "mode", "launch_id", "task_ref", "stage",
        "started_at", "updated_at", "submitted_at",
        "browser_open_requested", "reason_code", "reason",
        "next_action", "draft_job_count", "remaining_drafts",
        "draft_processing_started_at", "custom_logic_job_count",
    )
    out = {key: value[key] for key in allowed if key in value}
    out.setdefault("mode", "standalone_local_creator")
    return out


_process_alive = local_process.process_alive


def _worker_argv(project_root, task_ref, launch_id, idle_seconds, open_browser,
                 intent="author", mcp_statuses=None):
    argv = [
        os.path.abspath(sys.executable),
        "-B",
        "-m",
        "ops_runtime.creator_app",
        "_serve",
        "--project-root",
        project_root,
        "--task-ref",
        task_ref,
        "--launch-id",
        launch_id,
        "--idle-seconds",
        str(idle_seconds),
        "--intent",
        intent,
    ]
    if not open_browser:
        argv.append("--no-open-browser")
    if mcp_statuses is not None:
        snapshot = mcp_status.normalize(mcp_statuses)
        for service in mcp_status.SERVICES:
            argv.extend([
                f"--mcp-{service}-status",
                snapshot[service],
            ])
    return argv


_spawn_worker = local_process.spawn_worker


def _reap_later(child):
    local_process.reap_later(child, "creator-app-reaper")


def _draft_jobs_document(controller, task_path, detail_questions=False):
    task = util.load_json(task_path)
    return author_drafts.build_jobs(
        task,
        base_dir=os.path.dirname(task_path),
        task_ref=controller._ref(task_path),
        task_revision=controller._revision(task_path),
        detail_questions=detail_questions,
    )


def _draft_gate(controller, task_path, launch_id, kinds=None, node_ids=None,
                detail_questions=False):
    jobs = _draft_jobs_document(
        controller, task_path, detail_questions=detail_questions)
    if kinds is not None or node_ids is not None:
        kinds = set(kinds) if kinds is not None else None
        node_ids = set(node_ids) if node_ids is not None else None
        selected = [
            item for item in (jobs.get("jobs") or [])
            if (
                (kinds is None or item.get("kind") in kinds)
                and (node_ids is None or item.get("node_id") in node_ids)
            )
        ]
        jobs = {
            **jobs,
            "job_count": len(selected),
            "jobs": selected,
        }
    submitted = _load_drafts(
        controller, launch_id, task_ref=controller._ref(task_path))
    matched, missing = author_drafts.matching_drafts(jobs, submitted)
    current = {
        "type": "ops_author_drafts",
        "launch_id": launch_id,
        "task_ref": controller._ref(task_path),
        "drafts": list(matched.values()),
    }
    return jobs, current, missing


def creator_draft_jobs(project_root, launch_id):
    """현재 launch에 필요한 미제출 Agent 초안 작업만 반환한다."""
    controller = Controller(_canonical_root(project_root))
    launch_id = _validate_launch_id(launch_id)
    state = _load_state(controller, launch_id)
    if state.get("status") in _FINAL_STATUSES:
        return controller._conflict(
            "creator_launch_finished",
            "이미 종료된 Creator 실행의 AI 초안 작업은 조회할 수 없습니다")
    task_path = controller._task_path(state["task_ref"])
    requested_kinds = state.get("draft_kinds")
    requested_node_ids = state.get("draft_node_ids")
    jobs, _current, missing = _draft_gate(
        controller, task_path, launch_id,
        kinds=requested_kinds, node_ids=requested_node_ids,
        detail_questions=bool(state.get("revision_questionnaire")))
    decorated = []
    for original in missing:
        item = dict(original)
        item["submit_command"] = (
            "python -m ops_runtime.creator_app draft-submit "
            f'--project-root . --launch-id "{launch_id}" '
            f'--job-id "{item.get("job_id")}" '
            f'--expected-revision "{item.get("revision")}" '
            "--idempotency-key <8~200자-고유-키>"
        )
        decorated.append(item)
    return {
        **jobs,
        "job_count": len(decorated),
        "total_job_count": len(jobs.get("jobs") or []),
        "jobs": decorated,
    }


def begin_creator_draft_processing(project_root, launch_id):
    """사용자 완료 입력 뒤 Code Assistant가 초안 처리를 시작했음을 표시한다."""
    controller = Controller(_canonical_root(project_root))
    launch_id = _validate_launch_id(launch_id)
    state = _load_state(controller, launch_id)
    if state.get("status") != "awaiting_agent_drafts":
        return controller._conflict(
            "creator_not_waiting_for_agent_drafts",
            "AI 초안 처리를 시작할 단계가 아닙니다")
    jobs = creator_draft_jobs(project_root, launch_id)
    if jobs.get("status") == "conflict":
        return jobs
    if not jobs.get("job_count"):
        return controller._conflict(
            "creator_has_no_pending_agent_drafts",
            "처리할 AI 초안 작업이 없습니다")
    state["draft_processing_started_at"] = _now()
    written = _write_state(_state_path(controller, launch_id), state)
    return {
        "status": "ok",
        "launch_id": launch_id,
        "task_ref": state.get("task_ref"),
        "job_count": jobs.get("job_count"),
        "draft_processing_started_at": written["draft_processing_started_at"],
    }


def _read_content_file(controller, value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("content-file 경로가 비었습니다")
    candidate = value.strip()
    path = os.path.realpath(
        candidate if os.path.isabs(candidate)
        else os.path.join(controller.project_root, candidate))
    if not controller._inside(path, controller.project_root):
        raise PermissionError("content-file은 프로젝트 내부 파일만 허용됩니다")
    if os.path.splitext(path)[1].lower() not in (".md", ".txt"):
        raise ValueError("content-file은 .md 또는 .txt 파일만 허용됩니다")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"content-file을 찾을 수 없습니다: {candidate}")
    if os.path.getsize(path) > _DRAFT_INPUT_MAX_BYTES:
        raise ValueError("content-file이 허용 크기를 초과했습니다")
    with open(path, "rb") as handle:
        raw = handle.read(_DRAFT_INPUT_MAX_BYTES + 1)
    if len(raw) > _DRAFT_INPUT_MAX_BYTES:
        raise ValueError("content-file이 허용 크기를 초과했습니다")
    return raw.decode("utf-8"), path


def submit_creator_draft(project_root, launch_id, job_id, expected_revision,
                         idempotency_key, content, claim_token=None):
    """revision과 idempotency 조건을 확인한 뒤 AI 초안을 실행 상태에 저장한다."""
    controller = Controller(_canonical_root(project_root))
    launch_id = _validate_launch_id(launch_id)
    state = _load_state(controller, launch_id)
    task_path = controller._task_path(state["task_ref"])
    try:
        content = author_drafts.validate_content(content)
    except ValueError as exc:
        return controller._invalid(str(exc), reason_code="invalid_draft_content")
    content_digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    request = {
        "launch_id": launch_id,
        "job_id": job_id,
        "expected_revision": expected_revision,
        # idempotency receipt에 업무 본문을 남기지 않는다.
        "content_digest": content_digest,
    }

    def action():
        current_state = _load_state(controller, launch_id)
        if current_state.get("status") in _FINAL_STATUSES:
            return controller._conflict(
                "creator_launch_finished",
                "이미 종료된 Creator 실행에는 초안을 제출할 수 없습니다")
        requested_kinds = current_state.get("draft_kinds")
        requested_node_ids = current_state.get("draft_node_ids")
        jobs, current, _missing = _draft_gate(
            controller, task_path, launch_id,
            kinds=requested_kinds, node_ids=requested_node_ids,
            detail_questions=bool(
                current_state.get("revision_questionnaire")))
        job = next(
            (item for item in jobs.get("jobs") or []
             if item.get("job_id") == job_id),
            None,
        )
        if job is None:
            return controller._conflict(
                "unknown_draft_job",
                "현재 Creator 단계에 없는 AI 초안 작업입니다")
        if not isinstance(expected_revision, str) or not expected_revision:
            return controller._invalid(
                "expected_revision이 필요합니다",
                reason_code="missing_draft_revision")
        if expected_revision != job.get("revision"):
            return controller._conflict(
                "stale_draft_revision",
                "AI 초안 작업을 받은 뒤 노드 의미가 변경되었습니다",
                current_revision=job.get("revision"))
        task = util.load_json(task_path)
        normalized_content = author_drafts.validate_content(
            author_drafts.normalize_generated_content(
                task, job, content))

        stored = author_drafts.submitted_draft_map(
            _load_drafts(
                controller, launch_id,
                task_ref=controller._ref(task_path)))
        existing = stored.get(job_id)
        if (existing
                and existing.get("revision") == expected_revision
                and existing.get("content") != normalized_content):
            return controller._conflict(
                "draft_already_submitted",
                "같은 revision의 AI 초안이 이미 제출되었습니다")

        # 현재 의미와 맞는 항목만 남겨 오래된 본문이 상태 파일에 쌓이지 않게 한다.
        accepted = {
            item["job_id"]: item
            for item in current.get("drafts") or []
        }
        accepted[job_id] = {
            "job_id": job_id,
            "revision": expected_revision,
            "content": normalized_content,
        }
        saved = _write_drafts(controller, launch_id, {
            "task_ref": controller._ref(task_path),
            "drafts": list(accepted.values()),
        })
        _matched, remaining = author_drafts.matching_drafts(jobs, saved)
        return {
            "status": "ok",
            "launch_id": launch_id,
            "accepted_job_id": job_id,
            "remaining_drafts": len(remaining),
        }

    return agent_jobs.apply_claim_fence(
        project_root, claim_token,
        lambda: controller._idempotent(
            "creator_draft_submit", idempotency_key, request, action),
    )


def creator_node_test_jobs(project_root, launch_id):
    """브라우저가 대기시킨 Code Assistant 소유 노드 테스트 작업을 반환한다."""
    controller = Controller(_canonical_root(project_root))
    launch_id = _validate_launch_id(launch_id)
    state = _load_state(controller, launch_id)
    if state.get("status") in _FINAL_STATUSES:
        return controller._conflict(
            "creator_launch_finished",
            "이미 종료된 Creator 실행의 노드 테스트는 진행할 수 없습니다")
    service = NodeTestService(controller, launch_id)
    result = service.list_agent_jobs()
    workspace.ensure_dirs(controller.project_root)
    for item in result.get("jobs") or []:
        test_id = item.get("test_id")
        job = item.get("job") or {}
        payload_path = os.path.join(
            controller.project_root, ".ops", "payloads",
            f"creator-node-test-{test_id}.json")
        item["payload_file"] = controller._ref(payload_path)
        item["submit_command"] = (
            "python -m ops_runtime.creator_app node-test-submit "
            f'--project-root . --launch-id "{launch_id}" '
            f'--test-id "{test_id}" --job-id "{job.get("job_id")}" '
            f'--expected-revision "{job.get("revision")}" '
            "--idempotency-key <8~200자 고유 키> "
            f'--result-file "{controller._ref(payload_path)}"'
        )
    return result


def creator_custom_logic_jobs(project_root, launch_id):
    """현재 launch의 미완료 커스텀 로직 생성 작업을 반환한다."""
    controller = Controller(_canonical_root(project_root))
    launch_id = _validate_launch_id(launch_id)
    state = _load_state(controller, launch_id)
    if state.get("status") in _FINAL_STATUSES:
        return controller._conflict(
            "creator_launch_finished",
            "이미 종료된 Creator 실행에는 커스텀 로직 작업이 없습니다")
    result = custom_logic_jobs.list_jobs(controller, launch_id)
    workspace.ensure_dirs(controller.project_root)
    for item in result.get("jobs") or []:
        payload_path = os.path.join(
            controller.project_root, ".ops", "payloads",
            f'creator-custom-logic-{item["job_id"]}.json')
        item["payload_file"] = controller._ref(payload_path)
        item["submit_command"] = (
            "python -m ops_runtime.creator_app custom-logic-submit "
            f'--project-root . --launch-id "{launch_id}" '
            f'--job-id "{item["job_id"]}" '
            f'--expected-revision "{item["revision"]}" '
            "--idempotency-key <8~200자 고유 키> "
            f'--result-file "{controller._ref(payload_path)}"'
        )
    return result


def submit_creator_custom_logic(project_root, launch_id, job_id,
                                expected_revision, idempotency_key, result,
                                claim_token=None):
    """AI가 제출한 LOGIC.md/run.py 본문을 revision 조건 아래 원자 적용한다."""
    controller = Controller(_canonical_root(project_root))
    launch_id = _validate_launch_id(launch_id)
    request = {
        "launch_id": launch_id,
        "job_id": job_id,
        "expected_revision": expected_revision,
        "result_digest": controller._digest(result),
    }

    def action():
        state = _load_state(controller, launch_id)
        if state.get("status") in _FINAL_STATUSES:
            return controller._conflict(
                "creator_launch_finished",
                "이미 종료된 Creator 실행에는 결과를 제출할 수 없습니다")
        return custom_logic_jobs.submit(
            controller, launch_id, job_id, expected_revision, result)

    return agent_jobs.apply_claim_fence(
        project_root, claim_token,
        lambda: controller._idempotent(
            "creator_custom_logic_submit", idempotency_key, request, action),
    )


def _read_node_test_result_file(controller, value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("result-file 경로가 비었습니다")
    candidate = value.strip()
    path = os.path.realpath(
        candidate if os.path.isabs(candidate)
        else os.path.join(controller.project_root, candidate))
    if not controller._inside(path, controller.project_root):
        raise PermissionError("result-file은 프로젝트 내부 파일만 허용됩니다")
    if os.path.splitext(path)[1].lower() != ".json":
        raise ValueError("result-file은 .json 파일만 허용됩니다")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"result-file을 찾을 수 없습니다: {candidate}")
    if os.path.getsize(path) > _NODE_TEST_INPUT_MAX_BYTES:
        raise ValueError("result-file이 허용 크기를 초과했습니다")
    with open(path, "rb") as handle:
        raw = handle.read(_NODE_TEST_INPUT_MAX_BYTES + 1)
    if len(raw) > _NODE_TEST_INPUT_MAX_BYTES:
        raise ValueError("result-file이 허용 크기를 초과했습니다")
    result = json.loads(raw.decode("utf-8"))
    if not isinstance(result, dict):
        raise ValueError("노드 테스트 result는 JSON 객체여야 합니다")
    return result, path


def submit_creator_node_test(project_root, launch_id, test_id, job_id,
                             expected_revision, idempotency_key, result,
                             claim_token=None):
    """Code Assistant의 판단·생성 결과를 격리된 노드 테스트 run에 제출한다."""
    controller = Controller(_canonical_root(project_root))
    launch_id = _validate_launch_id(launch_id)
    state = _load_state(controller, launch_id)
    if state.get("status") in _FINAL_STATUSES:
        return controller._conflict(
            "creator_launch_finished",
            "이미 종료된 Creator 실행에는 노드 테스트 결과를 제출할 수 없습니다")
    service = NodeTestService(controller, launch_id)
    accepted = agent_jobs.apply_claim_fence(
        project_root, claim_token,
        lambda: service.submit_agent(
            test_id, result, expected_revision, job_id, idempotency_key,
            defer_pump=True),
    )
    if accepted.get("status") == "processing":
        return service.continue_agent(test_id)
    return accepted


def start_creator(project_root, task_ref, idle_seconds=_DEFAULT_IDLE_SECONDS,
                  startup_seconds=_DEFAULT_STARTUP_SECONDS, open_browser=True,
                  intent="author", mcp_statuses=None):
    root = _canonical_root(project_root)
    controller = Controller(root)
    task_path = controller._task_path(task_ref)
    task_ref = controller._ref(task_path)
    if intent not in _CREATOR_INTENTS:
        raise ValueError(f"지원하지 않는 Creator intent입니다: {intent}")
    sanitized_mcp_statuses = (
        None if mcp_statuses is None else mcp_status.normalize(mcp_statuses)
    )
    try:
        idle_seconds = int(idle_seconds)
        startup_seconds = int(startup_seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError("대기 시간은 정수여야 합니다") from exc
    if not 5 <= idle_seconds <= 24 * 60 * 60:
        raise ValueError("idle_seconds는 5초 이상 24시간 이하여야 합니다")
    if not 1 <= startup_seconds <= 60:
        raise ValueError("startup_seconds는 1~60초여야 합니다")

    launch_id = secrets.token_urlsafe(24)
    state_path = _state_path(controller, launch_id)
    initial = _write_state(state_path, {
        "status": "starting",
        "mode": "standalone_local_creator",
        "launch_id": launch_id,
        "task_ref": task_ref,
        "intent": intent,
        "started_at": _now(),
        "browser_open_requested": bool(open_browser),
    })
    child = None
    try:
        child = _spawn_worker(
            _worker_argv(
                root, task_ref, launch_id, idle_seconds, open_browser, intent,
                mcp_statuses=sanitized_mcp_statuses),
            root)
    except OSError as exc:
        failed = _write_state(state_path, {
            **initial,
            "status": "error",
            "reason_code": "creator_process_start_failed",
            "reason": f"로컬 Creator 프로세스를 시작하지 못했습니다: {exc}",
        })
        return _public_state(failed)

    deadline = time.monotonic() + startup_seconds
    while time.monotonic() < deadline:
        try:
            current = util.load_json(state_path)
        except (OSError, ValueError, json.JSONDecodeError):
            current = initial
        if current.get("status") != "starting":
            if current.get("status") in _FINAL_STATUSES:
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    _reap_later(child)
                try:
                    current = util.load_json(state_path)
                except (OSError, ValueError, json.JSONDecodeError):
                    pass
            else:
                _reap_later(child)
            return _public_state(current)
        if child.poll() is not None:
            child.wait()
            time.sleep(0.05)
            try:
                current = util.load_json(state_path)
            except (OSError, ValueError, json.JSONDecodeError):
                pass
            if current.get("status") != "starting":
                return _public_state(current)
            failed = _write_state(state_path, {
                **current,
                "status": "error",
                "reason_code": "creator_process_exited",
                "reason": "로컬 Creator 프로세스가 준비되기 전에 종료되었습니다",
            })
            return _public_state(failed)
        time.sleep(0.05)

    util.atomic_write_json(_stop_path(controller, launch_id), {
        "launch_id": launch_id, "requested_at": _now()})
    _reap_later(child)
    failed = _write_state(state_path, {
        **initial,
        "status": "error",
        "reason_code": "creator_start_timeout",
        "reason": "로컬 Creator 서버가 제한 시간 안에 준비되지 않았습니다",
    })
    return _public_state(failed)


def creator_status(project_root, launch_id):
    controller = Controller(_canonical_root(project_root))
    value = _load_state(controller, _validate_launch_id(launch_id))
    if value.get("status") not in _FINAL_STATUSES:
        updated = value.get("updated_at")
        try:
            heartbeat = datetime.datetime.fromisoformat(updated)
            age = (datetime.datetime.now() - heartbeat).total_seconds()
        except (TypeError, ValueError):
            age = None
        if age is not None and age > 15:
            value = dict(value)
            value["status"] = "stale"
            value["reason_code"] = "creator_process_unresponsive"
            value["reason"] = "로컬 Creator 프로세스의 응답이 중단되었습니다"
    return _public_state(value)


def stop_creator(project_root, launch_id, wait_seconds=5):
    controller = Controller(_canonical_root(project_root))
    launch_id = _validate_launch_id(launch_id)
    current = _load_state(controller, launch_id)
    if (current.get("status") in _FINAL_STATUSES
            and current.get("worker_exited_at")
            and not _process_alive(current.get("pid"))):
        return _public_state(current)
    if current.get("status") not in _FINAL_STATUSES:
        util.atomic_write_json(_stop_path(controller, launch_id), {
            "launch_id": launch_id, "requested_at": _now()})
    deadline = time.monotonic() + max(0, min(float(wait_seconds), 10))
    while time.monotonic() < deadline:
        time.sleep(0.05)
        try:
            current = _load_state(controller, launch_id)
        except (OSError, ValueError, json.JSONDecodeError):
            break
        if (current.get("status") in _FINAL_STATUSES
                and current.get("worker_exited_at")
                and not _process_alive(current.get("pid"))):
            return _public_state(current)
    result = _public_state(current)
    result["status"] = "stop_requested"
    return result


def _submission_status(observed):
    detail = observed.get("last_submission")
    return detail if isinstance(detail, dict) else {}


def _public_author_stage(value):
    # 노드 구성과 입출력은 사용자 관점에서 하나의 설계 단계다. 내부에서는
    # 화면 생성을 위해 둘을 나누지만 공개 상태에는 구현 세부를 노출하지 않는다.
    if value in ("structure_gate", "io_gate"):
        return "design_gate"
    return "ready_to_validate" if value == "ready" else value


def _open_author_session(bridge, task_path, open_browser, drafts=None,
                         intent="author"):
    if hasattr(bridge, "set_agent_drafts"):
        bridge.set_agent_drafts(drafts or {"drafts": []})
    opened = bridge.create_author_session(task_path, intent=intent)
    if open_browser:
        try:
            browser_opened = webbrowser.open(opened["url"], new=2)
        except Exception as exc:
            raise _BrowserOpenError(
                f"브라우저를 열지 못했습니다 ({type(exc).__name__})") from exc
        if not browser_opened:
            raise _BrowserOpenError("기본 브라우저가 Creator 화면을 열지 못했습니다")
    return opened


def _serve_creator(project_root, task_ref, launch_id, idle_seconds,
                   open_browser=True, intent="author", mcp_statuses=None):
    """백그라운드 Creator 프로세스를 실행하고 내부 종료 코드를 반환한다."""
    root = _canonical_root(project_root)
    launch_id = _validate_launch_id(launch_id)
    if intent not in _CREATOR_INTENTS:
        raise ValueError(f"지원하지 않는 Creator intent입니다: {intent}")
    controller = Controller(root)
    task_path = controller._task_path(task_ref)
    task_ref = controller._ref(task_path)
    state_path = _state_path(controller, launch_id)
    stop_path = _stop_path(controller, launch_id)
    bridge = None
    state = {
        "status": "starting",
        "mode": "standalone_local_creator",
        "launch_id": launch_id,
        "task_ref": task_ref,
        "intent": intent,
        "started_at": _now(),
        "browser_open_requested": bool(open_browser),
        "pid": os.getpid(),
        "server_id": secrets.token_urlsafe(18),
    }
    try:
        def queue_custom_logic(task_ref_value, remaining, task_revision):
            return custom_logic_jobs.queue_from_remaining(
                controller, launch_id, task_ref_value, remaining, task_revision)

        bridge = ConnectedHTTP(
            controller, open_browser=False,
            session_seconds=idle_seconds,
            launch_id=launch_id,
            mcp_statuses=mcp_statuses,
            custom_logic_queue_handler=queue_custom_logic).start()
        controller.attach_ui(bridge)
        deadline = time.monotonic() + idle_seconds
        next_heartbeat = 0
        author_session_id = None
        waiting_session_id = None
        last_activity_generation = None
        stage = None
        revision_questionnaire_pending = False
        pending_open_reason_code = None
        pending_open_reason = None

        def waiting_expiry():
            remaining = max(0, deadline - time.monotonic())
            return (
                datetime.datetime.now() + datetime.timedelta(seconds=remaining)
            ).isoformat(timespec="seconds")

        def ensure_author_session(reopen_reason_code=None, reopen_reason=None):
            """현재 의미와 맞는 초안이 모인 뒤에만 브라우저 세션을 만든다."""
            nonlocal author_session_id, waiting_session_id, stage, deadline
            nonlocal last_activity_generation
            nonlocal revision_questionnaire_pending
            nonlocal pending_open_reason_code, pending_open_reason
            if reopen_reason_code:
                pending_open_reason_code = reopen_reason_code
                pending_open_reason = reopen_reason
            current_task = util.load_json(task_path)
            internal_stage = controller._author_stage(current_task, task_path)
            revision_questionnaire = (
                intent == "revise"
                and revision_questionnaire_pending
                and internal_stage in (
                    "questionnaire", "ready_to_validate")
            )
            stage = (
                "questionnaire"
                if revision_questionnaire
                else _public_author_stage(internal_stage)
            )
            if internal_stage == "questionnaire" or revision_questionnaire:
                jobs, submitted, missing = _draft_gate(
                    controller, task_path, launch_id,
                    detail_questions=revision_questionnaire)
            else:
                # 구성 및 입출력 확인이 먼저다. 이 단계에서 의미가 바뀔 수
                # 있으므로 Agent 초안을 선행 생성하지 않는다.
                jobs = {"jobs": []}
                submitted = {
                    "type": "ops_author_drafts",
                    "launch_id": launch_id,
                    "task_ref": task_ref,
                    "drafts": [],
                }
                missing = []
            if missing:
                author_session_id = None
                was_waiting = state.get("status") == "awaiting_agent_drafts"
                previous = (
                    state.get("stage"),
                    state.get("draft_job_count"),
                    state.get("remaining_drafts"),
                    state.get("reason_code"),
                )
                state.update({
                    "status": "awaiting_agent_drafts",
                    "stage": stage,
                    "revision_questionnaire": revision_questionnaire,
                    "expires_at": (
                        state.get("expires_at")
                        if was_waiting else waiting_expiry()),
                    "draft_job_count": len(jobs.get("jobs") or []),
                    "remaining_drafts": len(missing),
                })
                state.pop("next_action", None)
                if pending_open_reason_code:
                    state["reason_code"] = (
                        "agent_drafts_required_after_task_change")
                    state["reason"] = (
                        "Task 의미가 변경되어 Code Assistant의 새 AI 초안을 기다립니다")
                else:
                    state.pop("reason_code", None)
                    state.pop("reason", None)
                current = (
                    state.get("stage"),
                    state.get("draft_job_count"),
                    state.get("remaining_drafts"),
                    state.get("reason_code"),
                )
                if not was_waiting or current != previous:
                    _write_state(state_path, state)
                return False

            if waiting_session_id is not None:
                opened = bridge.advance_author_session(
                    waiting_session_id, task_path, drafts=submitted,
                    revision_questionnaire=revision_questionnaire)
                waiting_session_id = None
            else:
                opened = _open_author_session(
                    bridge, task_path, open_browser, drafts=submitted,
                    intent=intent)
            author_session_id = opened["session_id"]
            last_activity_generation = int(
                opened.get("activity_generation") or 0)
            stage = _public_author_stage(opened["stage"])
            deadline = time.monotonic() + idle_seconds
            state.update({
                "status": "open",
                "stage": stage,
                "revision_questionnaire": revision_questionnaire,
                "expires_at": opened["expires_at"],
                "draft_job_count": len(jobs.get("jobs") or []),
                "remaining_drafts": 0,
            })
            state.pop("draft_processing_started_at", None)
            if pending_open_reason_code:
                state["reason_code"] = pending_open_reason_code
                state["reason"] = pending_open_reason
            else:
                state.pop("reason_code", None)
                state.pop("reason", None)
            pending_open_reason_code = None
            pending_open_reason = None
            _write_state(state_path, state)
            return True

        def observe_user_activity(observed):
            """브라우저 활동 신호를 백그라운드 프로세스의 유휴 종료 시각에 반영한다."""
            nonlocal deadline, last_activity_generation
            generation = observed.get("activity_generation")
            if generation is None:
                return False
            generation = int(generation)
            if last_activity_generation is None:
                last_activity_generation = generation
                return False
            if generation <= last_activity_generation:
                return False
            last_activity_generation = generation
            deadline = time.monotonic() + idle_seconds
            state["expires_at"] = (
                observed.get("expires_at") or waiting_expiry())
            return True

        ensure_author_session()
        if stage == "ready_to_validate" and author_session_id is not None:
            state.update({
                "status": "completed",
                "next_action": "task_validate",
            })
            _write_state(state_path, state)
            # 브라우저가 일회용 URL을 소비할 짧은 여유를 준다.
            time.sleep(0.5)
            return 0

        while True:
            if os.path.isfile(stop_path):
                state.update({
                    "status": "stopped",
                    "reason_code": "creator_stop_requested",
                })
                _write_state(state_path, state)
                return 0
            observed = None
            if (time.monotonic() >= deadline
                    and author_session_id is not None):
                observed = bridge.session_status(
                    author_session_id, task_path)
                observe_user_activity(observed)
            if time.monotonic() >= deadline:
                state.update({
                    "status": "expired",
                    "reason_code": "creator_idle_timeout",
                    "reason": "입력이 없어 로컬 Creator 서버를 종료했습니다",
                })
                _write_state(state_path, state)
                return 0

            if author_session_id is None:
                # draft-submit은 별도 짧은 프로세스이므로 안전한 atomic 상태 파일만
                # 폴링한다. 일부 초안만 도착했을 때는 남은 개수만 갱신한다.
                ensure_author_session()
                if stage == "ready_to_validate" and author_session_id is not None:
                    state.update({
                        "status": "completed",
                        "next_action": "task_validate",
                    })
                    _write_state(state_path, state)
                    time.sleep(0.5)
                    return 0
                if time.monotonic() >= next_heartbeat:
                    _write_state(state_path, state)
                    next_heartbeat = time.monotonic() + _HEARTBEAT_SECONDS
                time.sleep(0.1)
                continue

            if observed is None:
                observed = bridge.session_status(
                    author_session_id, task_path)
            observe_user_activity(observed)
            observed_status = observed.get("status")
            if observed_status == "submitted":
                submission = _submission_status(observed)
                if submission.get("status") == "ok":
                    if submission.get("next_stage") == "awaiting_agent_custom_logic":
                        pending_logic = custom_logic_jobs.list_jobs(
                            controller, launch_id)
                        if pending_logic.get("job_count"):
                            state.update({
                                "status": "awaiting_agent_custom_logic",
                                "stage": "questionnaire",
                                "custom_logic_job_count": pending_logic.get("job_count"),
                            })
                            _write_state(state_path, state)
                            time.sleep(0.1)
                            continue
                        bridge.advance_author_session(
                            author_session_id, task_path,
                            revision_questionnaire=False)
                    current_task = util.load_json(task_path)
                    next_stage = _public_author_stage(
                        controller._author_stage(current_task, task_path))
                    state["submitted_at"] = observed.get("submitted_at")
                    if intent == "revise" and stage == "design_gate":
                        # 완성된 JSON 수정은 설계 확인만으로 끝내지 않는다.
                        # 정본의 완료 상태는 건드리지 않고 이 세션에서만 현재값
                        # 기반 상세 설정 질문지를 이어서 연다.
                        revision_questionnaire_pending = True
                        waiting_session_id = author_session_id
                        author_session_id = None
                        deadline = time.monotonic() + idle_seconds
                        ensure_author_session(
                            "author_stage_advanced",
                            "기존 상세 설정 수정 화면을 열었습니다")
                        continue
                    if next_stage == "ready_to_validate":
                        state.update({
                            "status": "completed",
                            "stage": next_stage,
                            "next_action": "task_validate",
                        })
                        state.pop("reason_code", None)
                        state.pop("reason", None)
                        _write_state(state_path, state)
                        time.sleep(0.5)
                        return 0

                    # 구조 편집으로 노드 의미가 달라졌다면 낡은 Agent 초안을 쓰지
                    # 않는다. 의미 revision이 같은 초안은 그대로 재사용한다.
                    waiting_session_id = author_session_id
                    author_session_id = None
                    deadline = time.monotonic() + idle_seconds
                    ensure_author_session(
                        "author_stage_advanced",
                        "다음 Creator 단계를 열었습니다")
                else:
                    state.update({
                        "status": "open",
                        "reason_code": (
                            submission.get("reason_code")
                            or "author_submission_rejected"),
                        "reason": submission.get("reason"),
                    })
                    _write_state(state_path, state)
            elif observed_status in ("conflict", "invalid", "busy"):
                submission = _submission_status(observed)
                reason_code = (
                    submission.get("reason_code")
                    or f"author_submission_{observed_status}")
                reason = submission.get("reason")
                if reason_code == "stale_revision":
                    if (
                        intent == "revise"
                        and revision_questionnaire_pending
                        and stage == "questionnaire"
                    ):
                        waiting_session_id = author_session_id
                    author_session_id = None
                    deadline = time.monotonic() + idle_seconds
                    ensure_author_session(
                        "stale_revision_reopened",
                        "Task가 변경되어 최신 Creator 화면을 다시 열었습니다")
                    continue
                if (state.get("reason_code") != reason_code
                        or state.get("reason") != reason):
                    state.update({
                        "status": "open",
                        "reason_code": reason_code,
                        "reason": reason,
                    })
                    _write_state(state_path, state)
            elif observed_status in ("unknown_session", "error"):
                state.update({
                    "status": "error",
                    "reason_code": "creator_author_session_lost",
                    "reason": "Creator 화면 세션을 이어갈 수 없습니다",
                })
                _write_state(state_path, state)
                return 1

            if time.monotonic() >= next_heartbeat:
                _write_state(state_path, state)
                next_heartbeat = time.monotonic() + _HEARTBEAT_SECONDS
            time.sleep(0.1)
    except _BrowserOpenError as exc:
        state.update({
            "status": "error",
            "reason_code": "creator_browser_open_failed",
            "reason": str(exc),
        })
        try:
            _write_state(state_path, state)
        except OSError:
            pass
        return 1
    except Exception as exc:  # worker stderr는 DEVNULL이므로 안전한 상태만 남긴다.
        state.update({
            "status": "error",
            "reason_code": "creator_worker_failed",
            "reason": f"로컬 Creator 서버 오류: {type(exc).__name__}: {exc}",
        })
        try:
            _write_state(state_path, state)
        except OSError:
            pass
        return 1
    finally:
        if bridge is not None:
            bridge.stop()
        _cleanup_drafts(controller, launch_id)
        state["worker_exited_at"] = _now()
        try:
            _write_state(state_path, state)
        except OSError:
            pass
        try:
            if os.path.isfile(stop_path):
                os.remove(stop_path)
        except OSError:
            pass


def _print_result(value):
    print(json.dumps(value, ensure_ascii=False))


def _read_stdin_content():
    if hasattr(sys.stdin, "isatty") and sys.stdin.isatty():
        raise ValueError(
            "AI 초안 Markdown을 stdin으로 전달하거나 --content-file을 사용하세요")
    stream = getattr(sys.stdin, "buffer", sys.stdin)
    raw = stream.read(_DRAFT_INPUT_MAX_BYTES + 1)
    if isinstance(raw, str):
        if len(raw.encode("utf-8")) > _DRAFT_INPUT_MAX_BYTES:
            raise ValueError("stdin AI 초안이 허용 크기를 초과했습니다")
        return raw
    if len(raw) > _DRAFT_INPUT_MAX_BYTES:
        raise ValueError("stdin AI 초안이 허용 크기를 초과했습니다")
    return raw.decode("utf-8")


def _read_stdin_node_test_result():
    if hasattr(sys.stdin, "isatty") and sys.stdin.isatty():
        raise ValueError(
            "노드 테스트 result JSON을 stdin으로 전달하거나 --result-file을 사용하세요")
    stream = getattr(sys.stdin, "buffer", sys.stdin)
    raw = stream.read(_NODE_TEST_INPUT_MAX_BYTES + 1)
    if isinstance(raw, str):
        if len(raw.encode("utf-8")) > _NODE_TEST_INPUT_MAX_BYTES:
            raise ValueError("stdin 노드 테스트 result가 허용 크기를 초과했습니다")
        text = raw
    else:
        if len(raw) > _NODE_TEST_INPUT_MAX_BYTES:
            raise ValueError("stdin 노드 테스트 result가 허용 크기를 초과했습니다")
        text = raw.decode("utf-8")
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("노드 테스트 result는 JSON 객체여야 합니다")
    return value


def main(argv=None):
    util.utf8_stdout()
    parser = argparse.ArgumentParser(
        description="일회용 Standalone local Creator 서버")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start")
    start.add_argument("--project-root", required=True)
    start.add_argument("--task-ref", required=True)
    start.add_argument("--idle-seconds", type=int, default=_DEFAULT_IDLE_SECONDS)
    start.add_argument("--startup-seconds", type=int, default=_DEFAULT_STARTUP_SECONDS)
    start.add_argument(
        "--no-open-browser", action="store_true", help=argparse.SUPPRESS)
    start.add_argument(
        "--mcp-knox-status", choices=mcp_status.STATES,
        help="Code Assistant가 확인한 Knox MCP 상태")
    start.add_argument(
        "--mcp-confluence-status", choices=mcp_status.STATES,
        help="Code Assistant가 확인한 Confluence MCP 상태")

    revise = sub.add_parser("revise")
    revise.add_argument("--project-root", required=True)
    revise.add_argument("--task-ref", required=True)
    revise.add_argument("--idle-seconds", type=int, default=_DEFAULT_IDLE_SECONDS)
    revise.add_argument(
        "--startup-seconds", type=int, default=_DEFAULT_STARTUP_SECONDS)
    revise.add_argument(
        "--no-open-browser", action="store_true", help=argparse.SUPPRESS)
    revise.add_argument(
        "--mcp-knox-status", choices=mcp_status.STATES,
        help="Code Assistant가 확인한 Knox MCP 상태")
    revise.add_argument(
        "--mcp-confluence-status", choices=mcp_status.STATES,
        help="Code Assistant가 확인한 Confluence MCP 상태")

    status = sub.add_parser("status")
    status.add_argument("--project-root", required=True)
    status.add_argument("--launch-id", required=True)

    stop = sub.add_parser("stop")
    stop.add_argument("--project-root", required=True)
    stop.add_argument("--launch-id", required=True)
    stop.add_argument("--wait-seconds", type=float, default=5)

    draft_jobs = sub.add_parser("draft-jobs")
    draft_jobs.add_argument("--project-root", required=True)
    draft_jobs.add_argument("--launch-id", required=True)

    draft_begin = sub.add_parser("draft-begin")
    draft_begin.add_argument("--project-root", required=True)
    draft_begin.add_argument("--launch-id", required=True)

    draft_submit = sub.add_parser("draft-submit")
    draft_submit.add_argument("--project-root", required=True)
    draft_submit.add_argument("--launch-id", required=True)
    draft_submit.add_argument("--job-id", required=True)
    draft_submit.add_argument("--expected-revision", required=True)
    draft_submit.add_argument("--idempotency-key", required=True)
    draft_submit.add_argument("--claim-token")
    draft_submit.add_argument(
        "--content-file",
        help="stdin을 연결할 수 없을 때만 사용하는 프로젝트 내부 UTF-8 Markdown 파일")

    node_test_jobs = sub.add_parser("node-test-jobs")
    node_test_jobs.add_argument("--project-root", required=True)
    node_test_jobs.add_argument("--launch-id", required=True)

    node_test_submit = sub.add_parser("node-test-submit")
    node_test_submit.add_argument("--project-root", required=True)
    node_test_submit.add_argument("--launch-id", required=True)
    node_test_submit.add_argument("--test-id", required=True)
    node_test_submit.add_argument("--job-id", required=True)
    node_test_submit.add_argument("--expected-revision", required=True)
    node_test_submit.add_argument("--idempotency-key", required=True)
    node_test_submit.add_argument("--claim-token")
    node_test_submit.add_argument(
        "--result-file",
        help="stdin을 연결할 수 없을 때만 사용하는 프로젝트 내부 UTF-8 JSON 파일")

    custom_logic_jobs_parser = sub.add_parser("custom-logic-jobs")
    custom_logic_jobs_parser.add_argument("--project-root", required=True)
    custom_logic_jobs_parser.add_argument("--launch-id", required=True)

    custom_logic_submit = sub.add_parser("custom-logic-submit")
    custom_logic_submit.add_argument("--project-root", required=True)
    custom_logic_submit.add_argument("--launch-id", required=True)
    custom_logic_submit.add_argument("--job-id", required=True)
    custom_logic_submit.add_argument("--expected-revision", required=True)
    custom_logic_submit.add_argument("--idempotency-key", required=True)
    custom_logic_submit.add_argument("--claim-token")
    custom_logic_submit.add_argument("--result-file", required=True)

    serve = sub.add_parser("_serve", help=argparse.SUPPRESS)
    serve.add_argument("--project-root", required=True)
    serve.add_argument("--task-ref", required=True)
    serve.add_argument("--launch-id", required=True)
    serve.add_argument("--idle-seconds", type=int, required=True)
    serve.add_argument(
        "--intent", choices=sorted(_CREATOR_INTENTS), default="author")
    serve.add_argument("--no-open-browser", action="store_true")
    serve.add_argument(
        "--mcp-knox-status", choices=mcp_status.STATES,
        default=mcp_status.DEFAULT_STATE)
    serve.add_argument(
        "--mcp-confluence-status", choices=mcp_status.STATES,
        default=mcp_status.DEFAULT_STATE)

    args = parser.parse_args(argv)
    try:
        if args.command in ("start", "revise"):
            start_kwargs = {
                "idle_seconds": args.idle_seconds,
                "startup_seconds": args.startup_seconds,
                "open_browser": not args.no_open_browser,
                "intent": (
                    "revise" if args.command == "revise" else "author"
                ),
            }
            if (
                args.mcp_knox_status is not None
                or args.mcp_confluence_status is not None
            ):
                start_kwargs["mcp_statuses"] = {
                    "knox": (
                        args.mcp_knox_status
                        or mcp_status.DEFAULT_STATE
                    ),
                    "confluence": (
                        args.mcp_confluence_status
                        or mcp_status.DEFAULT_STATE
                    ),
                }
            result = start_creator(
                args.project_root, args.task_ref,
                **start_kwargs)
            _print_result(result)
            return 0 if result.get("status") in (
                "open", "completed", "awaiting_agent_drafts") else 1
        if args.command == "status":
            result = creator_status(args.project_root, args.launch_id)
            _print_result(result)
            return 0
        if args.command == "stop":
            result = stop_creator(
                args.project_root, args.launch_id, args.wait_seconds)
            _print_result(result)
            return 0 if result.get("status") != "stop_requested" else 1
        if args.command == "draft-jobs":
            result = creator_draft_jobs(
                args.project_root, args.launch_id)
            _print_result(result)
            return 0 if result.get("status") == "ok" else 1
        if args.command == "draft-begin":
            result = begin_creator_draft_processing(
                args.project_root, args.launch_id)
            _print_result(result)
            return 0 if result.get("status") == "ok" else 1
        if args.command == "draft-submit":
            content_path = None
            if args.content_file:
                controller = Controller(_canonical_root(args.project_root))
                content, content_path = _read_content_file(
                    controller, args.content_file)
            else:
                content = _read_stdin_content()
            result = submit_creator_draft(
                args.project_root, args.launch_id, args.job_id,
                args.expected_revision, args.idempotency_key, content,
                args.claim_token)
            if (result.get("status") == "ok"
                    and content_path
                    and workspace.is_consumable_payload(content_path)):
                try:
                    os.remove(content_path)
                except OSError:
                    pass
            _print_result(result)
            return 0 if result.get("status") == "ok" else 1
        if args.command == "node-test-jobs":
            result = creator_node_test_jobs(
                args.project_root, args.launch_id)
            _print_result(result)
            return 0 if result.get("status") == "ok" else 1
        if args.command == "custom-logic-jobs":
            result = creator_custom_logic_jobs(
                args.project_root, args.launch_id)
            _print_result(result)
            return 0 if result.get("status") == "ok" else 1
        if args.command == "custom-logic-submit":
            controller = Controller(_canonical_root(args.project_root))
            result_payload, result_path = _read_node_test_result_file(
                controller, args.result_file)
            result = submit_creator_custom_logic(
                args.project_root, args.launch_id, args.job_id,
                args.expected_revision, args.idempotency_key, result_payload,
                args.claim_token)
            if (result.get("status") == "ok"
                    and workspace.is_consumable_payload(result_path)):
                try:
                    os.remove(result_path)
                except OSError:
                    pass
            _print_result(result)
            return 0 if result.get("status") == "ok" else 1
        if args.command == "node-test-submit":
            result_path = None
            if args.result_file:
                controller = Controller(_canonical_root(args.project_root))
                result_payload, result_path = _read_node_test_result_file(
                    controller, args.result_file)
            else:
                result_payload = _read_stdin_node_test_result()
            result = submit_creator_node_test(
                args.project_root, args.launch_id, args.test_id,
                args.job_id, args.expected_revision,
                args.idempotency_key, result_payload, args.claim_token)
            if (
                result.get("status") in (
                    "completed", "waiting_agent", "waiting_user",
                    "preview_only")
                and result_path
                and workspace.is_consumable_payload(result_path)
            ):
                try:
                    os.remove(result_path)
                except OSError:
                    pass
            _print_result(result)
            return 0 if result.get("status") in (
                "completed", "waiting_agent", "waiting_user",
                "preview_only") else 1
        return _serve_creator(
            args.project_root, args.task_ref, args.launch_id,
            args.idle_seconds, open_browser=not args.no_open_browser,
            intent=args.intent,
            mcp_statuses={
                "knox": args.mcp_knox_status,
                "confluence": args.mcp_confluence_status,
            })
    except (OSError, ValueError, PermissionError, json.JSONDecodeError) as exc:
        _print_result({
            "status": "error",
            "mode": "standalone_local_creator",
            "reason_code": "creator_command_failed",
            "reason": str(exc),
        })
        return 1


if __name__ == "__main__":
    sys.exit(main())
