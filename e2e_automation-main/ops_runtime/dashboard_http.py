# -*- coding: utf-8 -*-
"""Creator와 Runner를 함께 보여주는 가용성 우선 loopback 웹 대시보드."""
from __future__ import annotations

import datetime
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import secrets
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

from . import (creator_app, custom_logic_jobs, loopback_http, runner_app,
               task_reset, util)
from .dashboard_input_jobs import DashboardInputJobs
from .connected_http import ConnectedHTTP


_MAX_BODY = 2 * 1024 * 1024
_OPERATION_HISTORY_LIMIT = 100
_OPERATION_HISTORY_SECONDS = 7 * 24 * 60 * 60
_EVENT_HISTORY_LIMIT = 100
_CLAUDE_MESSAGE_TTL_SECONDS = 60
_CLAUDE_MESSAGE_LIMIT = 4000
_CLAUDE_DELTA_LIMIT = 64 * 1024
_CLAUDE_MESSAGE_BUFFER_LIMIT = 256 * 1024


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _dashboard_runner_job(project_root, boundary):
    """Dashboard AI 작업은 다음 user 경계를 채팅에 반환하지 않는 명령을 사용한다."""
    result = runner_app._decorate_result(project_root, boundary)
    job = result.get("job") or {}
    if (
        result.get("status") != "paused"
        or job.get("actor") != "agent"
        or not result.get("payload_file")
    ):
        return result
    payload_path = os.path.realpath(os.path.join(
        project_root, result["payload_file"].replace("/", os.sep)))
    command = [
        os.path.abspath(sys.executable),
        "-B",
        "-m",
        "ops_runtime.dashboard_app",
        "runner-agent-submit",
        "--project-root",
        project_root,
        "--run-ref",
        result["run_ref"],
        "--job-id",
        job["job_id"],
        "--expected-revision",
        result["revision"],
        "--result-file",
        payload_path,
    ]
    result["mode"] = "integrated_local_dashboard"
    result["dashboard_user_interaction"] = "dashboard_only"
    result["resume_command"] = runner_app._command_line(command)
    return result


class _DashboardAuthorSession:
    """Dashboard 포트에 ConnectedHTTP 저작 세션 하나를 연결하고 단계 전환을 관리한다."""

    def __init__(self, dashboard, task_ref, intent="author", launch_id=None):
        self.dashboard = dashboard
        self.controller = dashboard.controller
        self.task_path = self.controller._task_path(task_ref)
        self.task_ref = self.controller._ref(self.task_path)
        self.intent = intent
        self.launch_id = launch_id or secrets.token_urlsafe(24)
        self.state_path = creator_app._state_path(
            self.controller, self.launch_id)
        self.bridge = ConnectedHTTP(
            self.controller,
            open_browser=False,
            session_seconds=dashboard.session_seconds,
            launch_id=self.launch_id,
            require_access_token=False,
            completion_url="/dashboard?tab=creator",
            assistant_status_provider=self._assistant_status,
            draft_generation_handler=self._begin_draft_generation,
            custom_logic_queue_handler=self._queue_custom_logic,
        )
        # 별도 포트를 열지 않고 Dashboard의 HTTP server를 그대로 사용한다.
        self.bridge._server = dashboard._server
        self.bridge.base_url = dashboard.base_url
        self.session_id = None
        self.url = None
        self.stage = None
        self.revision_questionnaire = False
        self._stopped = threading.Event()
        self._thread = None
        self._session_guard = threading.RLock()
        self._cleanup_guard = threading.Lock()
        self._runtime_cleaned = False
        if not os.path.isfile(self.state_path):
            creator_app._write_state(self.state_path, {
                "status": "starting",
                "mode": "integrated_local_dashboard",
                "launch_id": self.launch_id,
                "task_ref": self.task_ref,
                "intent": self.intent,
                "dashboard_owned": True,
                "started_at": _now(),
                "browser_open_requested": False,
                "pid": os.getpid(),
            })

    def _queue_custom_logic(self, task_ref, remaining, task_revision):
        return custom_logic_jobs.queue_from_remaining(
            self.controller, self.launch_id, task_ref, remaining, task_revision)

    def start(self):
        self._ensure_view(initial=True)
        self._thread = threading.Thread(
            target=self._monitor,
            name=f"ops-dashboard-author-{self.launch_id[:8]}",
            daemon=True,
        )
        self._thread.start()
        return self

    def stop(self):
        self._stopped.set()
        if (
            self._thread
            and self._thread.is_alive()
            and self._thread is not threading.current_thread()
        ):
            self._thread.join(timeout=1)
        self._release_runtime_resources()
        self.dashboard._retire_author(self)

    def _release_runtime_resources(self):
        """감시 종료 후 launch 전용 리소스를 한 번만 정리한다."""
        with self._cleanup_guard:
            if self._runtime_cleaned:
                return
            self._runtime_cleaned = True
            node_tests = self.bridge.node_tests
            self.bridge.node_tests = None
            self.bridge.assistant_status_provider = None
            self.bridge.draft_generation_handler = None
        if node_tests is not None:
            node_tests.cleanup()

    def public(self):
        try:
            state = creator_app._load_state(
                self.controller, self.launch_id)
        except (OSError, ValueError, json.JSONDecodeError):
            state = {}
        return {
            "launch_id": self.launch_id,
            "task_ref": self.task_ref,
            "intent": self.intent,
            "launch_status": state.get("status"),
            "stage": state.get("stage") or self.stage,
            "url": self.url,
        }

    def _write(self, **changes):
        try:
            current = creator_app._load_state(
                self.controller, self.launch_id)
        except (OSError, ValueError, json.JSONDecodeError):
            current = {
                "launch_id": self.launch_id,
                "task_ref": self.task_ref,
                "intent": self.intent,
                "started_at": _now(),
            }
        current.update({
            "mode": "integrated_local_dashboard",
            "dashboard_owned": True,
            "pid": os.getpid(),
            **changes,
        })
        return creator_app._write_state(self.state_path, current)

    @staticmethod
    def _public_stage(stage):
        if stage in ("structure_gate", "io_gate"):
            return "design_gate"
        return "ready_to_validate" if stage == "ready" else stage

    def _drafts(self, kinds=None, node_ids=None):
        jobs, submitted, missing = creator_app._draft_gate(
            self.controller, self.task_path, self.launch_id,
            kinds=kinds, node_ids=node_ids,
            detail_questions=self.revision_questionnaire)
        return jobs, submitted, missing

    def _draft_request_state(self):
        try:
            state = creator_app._load_state(
                self.controller, self.launch_id)
        except (OSError, ValueError, json.JSONDecodeError):
            return {}, False
        requested = bool(
            (
                state.get("draft_generation_requested")
                and state.get("draft_request_revision")
                == self.controller._revision(self.task_path)
            )
            or (
                "draft_generation_requested" not in state
                and state.get("status") == "awaiting_agent_drafts"
            )
        )
        return state, requested

    @staticmethod
    def _draft_kinds(state, requested):
        """새 요청은 판단 노드만, 예전 대기 상태는 당시의 전체 작업 계약을 유지한다."""
        if "draft_kinds" in state:
            return state.get("draft_kinds")
        if requested and "draft_generation_requested" not in state:
            return None
        return ["decision_prompt"]

    @staticmethod
    def _draft_node_ids(state, requested):
        """새 상태는 선택 노드만, 예전 상태는 기존 kind 단위 계약을 유지한다."""
        if "draft_node_ids" in state:
            value = state.get("draft_node_ids")
            return value if isinstance(value, list) else []
        return None

    def _begin_draft_generation(self, payload=None):
        # ThreadingHTTPServer에서 여러 노드 버튼을 빠르게 눌러도 선택 목록 갱신이
        # 서로 덮어쓰이지 않도록 launch 상태의 read-modify-write를 직렬화한다.
        with self._session_guard:
            return self._begin_draft_generation_locked(payload)

    def _begin_draft_generation_locked(self, payload=None):
        """요청한 한 노드만 AI 초안 작업 큐에 추가한다.

        payload가 없는 호출은 이전의 판단 노드 일괄 요청 계약을 유지한다.
        """
        if self.stage != "questionnaire":
            return self.controller._conflict(
                "creator_not_in_questionnaire",
                "상세 설정 화면에서만 AI 초안을 갱신할 수 있습니다",
            )

        state, requested = self._draft_request_state()
        all_jobs, all_submitted, _all_missing = self._drafts()
        available = all_jobs.get("jobs") or []
        if payload is None:
            selected_jobs = [
                item for item in available
                if item.get("kind") == "decision_prompt"
            ]
            requested_node_ids = [
                item.get("node_id") for item in selected_jobs
                if item.get("node_id")
            ]
        else:
            if not isinstance(payload, dict):
                raise ValueError("AI 초안 수정 요청 형식이 올바르지 않습니다")
            node_id = payload.get("node_id")
            if not isinstance(node_id, str) or not node_id.strip():
                raise ValueError("node_id가 필요합니다")
            node_id = node_id.strip()
            job = next(
                (item for item in available if item.get("node_id") == node_id),
                None,
            )
            if job is None:
                return self.controller._conflict(
                    "unknown_draft_node",
                    "현재 상세 설정에 AI로 수정할 수 있는 초안이 없습니다",
                )
            if payload.get("job_id") not in (None, job.get("job_id")):
                return self.controller._conflict(
                    "stale_draft_job",
                    "초안 정보가 변경되었습니다. 화면을 새로고침해 주세요",
                )
            if payload.get("revision") not in (None, job.get("revision")):
                return self.controller._conflict(
                    "stale_draft_revision",
                    "노드 의미가 변경되었습니다. 화면을 새로고침해 주세요",
                )
            prior_node_ids = (
                self._draft_node_ids(state, requested) if requested else []
            )
            if prior_node_ids is None:
                prior_node_ids = []
                if requested:
                    prior_kinds = self._draft_kinds(state, requested)
                    prior_node_ids = [
                        item.get("node_id") for item in available
                        if (
                            prior_kinds is None
                            or item.get("kind") in set(prior_kinds)
                        )
                    ]
            if node_id in prior_node_ids:
                return self.controller._conflict(
                    "draft_already_requested",
                    "이 노드의 AI 초안 수정은 이미 요청되었습니다",
                )
            stored_ids = {
                item.get("job_id")
                for item in (all_submitted.get("drafts") or [])
                if isinstance(item, dict)
            }
            if job.get("job_id") in stored_ids:
                return self.controller._conflict(
                    "draft_already_completed",
                    "이 노드의 AI 초안 수정은 이미 완료되었습니다",
                )
            requested_node_ids = [
                *[value for value in prior_node_ids if value],
                node_id,
            ]
            selected_jobs = [
                item for item in available
                if item.get("node_id") in set(requested_node_ids)
            ]

        kinds = sorted({
            item.get("kind") for item in selected_jobs if item.get("kind")
        })
        jobs, submitted, missing = self._drafts(
            kinds=kinds, node_ids=requested_node_ids)
        submitted.update({
            "generation_requested": True,
            "requested_kinds": kinds,
            "requested_node_ids": requested_node_ids,
        })
        self.bridge.set_agent_drafts(submitted)
        revision = self.controller._revision(self.task_path)
        self._write(
            status="awaiting_agent_drafts" if missing else "open",
            stage=self.stage,
            draft_generation_requested=True,
            draft_request_revision=revision,
            draft_kinds=kinds,
            draft_node_ids=requested_node_ids,
            draft_job_count=len(jobs.get("jobs") or []),
            remaining_drafts=len(missing),
            draft_processing_started_at=None,
        )
        return {
            "status": "ok",
            "draft_generation_state": (
                "requested" if missing else "complete"
            ),
            "draft_progress": {
                "total": len(jobs.get("jobs") or []),
                "completed": max(
                    0, len(jobs.get("jobs") or []) - len(missing)),
                "remaining": len(missing),
            },
            "draft_requests": self._draft_request_items(
                jobs, submitted, missing, processing=False),
        }

    @staticmethod
    def _draft_request_items(jobs, submitted, pending, processing=False):
        completed_ids = {
            item.get("job_id")
            for item in (submitted.get("drafts") or [])
            if isinstance(item, dict)
        }
        pending_ids = {
            item.get("job_id") for item in (pending or [])
            if isinstance(item, dict)
        }
        return [
            {
                "job_id": item.get("job_id"),
                "node_id": item.get("node_id"),
                "revision": item.get("revision"),
                "state": (
                    "complete" if item.get("job_id") in completed_ids
                    else "processing" if (
                        processing and item.get("job_id") in pending_ids
                    )
                    else "requested"
                ),
            }
            for item in (jobs.get("jobs") or [])
        ]

    def _assistant_status(self):
        """Creator 화면에 내부 식별자 없이 연결·초안 진행 상황을 제공한다."""
        from . import agent_jobs

        result = {
            "assistant_watch": agent_jobs.assistant_watch_status(
                self.controller.project_root),
        }
        try:
            state = creator_app._load_state(
                self.controller, self.launch_id)
        except (OSError, ValueError, json.JSONDecodeError):
            state = {}
        requested = bool(
            (
                state.get("draft_generation_requested")
                and state.get("draft_request_revision")
                == self.controller._revision(self.task_path)
            )
            or (
                "draft_generation_requested" not in state
                and state.get("status") == "awaiting_agent_drafts"
            )
        )
        result["draft_generation_state"] = (
            "idle" if not requested else
            "processing" if state.get("draft_processing_started_at") else
            "requested" if state.get("remaining_drafts") else
            "complete"
        )
        if not requested:
            return result
        try:
            jobs, submitted, pending = self._drafts(
                kinds=self._draft_kinds(state, requested),
                node_ids=self._draft_node_ids(state, requested))
        except (OSError, ValueError, json.JSONDecodeError):
            return result
        pending = pending or []
        total = len(jobs.get("jobs") or [])
        remaining = len(pending)
        labels = []
        for item in pending[:5]:
            label = str(
                item.get("node_label")
                or ((item.get("context") or {}).get("node") or {}).get("name")
                or "AI 초안"
            ).strip()
            if label:
                labels.append(label[:120])
        result["draft_progress"] = {
            "total": total,
            "completed": max(0, total - remaining),
            "remaining": remaining,
            "labels": labels,
        }
        result["draft_updates"] = [
            {
                "job_id": item.get("job_id"),
                "node_id": next(
                    (
                        job.get("node_id")
                        for job in (jobs.get("jobs") or [])
                        if job.get("job_id") == item.get("job_id")
                    ),
                    None,
                ),
                "revision": item.get("revision"),
                "content": item.get("content"),
            }
            for item in (submitted.get("drafts") or [])
            if (
                isinstance(item, dict)
                and item.get("job_id")
                and item.get("revision")
                and isinstance(item.get("content"), str)
            )
        ]
        result["draft_requests"] = self._draft_request_items(
            jobs,
            submitted,
            pending,
            processing=bool(state.get("draft_processing_started_at")),
        )
        return result

    def _register_opened(self, opened, jobs=None, missing=None):
        self.session_id = opened["session_id"]
        self.url = opened.get("url")
        self.stage = self._public_stage(opened.get("stage"))
        self.dashboard._register_author_bridge(self.session_id, self.bridge)
        jobs = jobs or {"jobs": []}
        missing = missing or []
        _state, requested = self._draft_request_state()
        waiting_for_drafts = (
            self.stage == "questionnaire" and requested and bool(missing)
        )
        changes = {
            "status": (
                "awaiting_agent_drafts"
                if waiting_for_drafts else "open"
            ),
            "stage": self.stage,
            "revision_questionnaire": bool(self.revision_questionnaire),
            "draft_job_count": len(jobs.get("jobs") or []),
            "remaining_drafts": len(missing),
        }
        if not waiting_for_drafts and not requested:
            changes["draft_processing_started_at"] = None
        self._write(
            **changes,
        )

    def _reopen_expired_session(self):
        """만료된 HTTP 연결만 같은 Creator launch 안에서 새로 만든다."""
        with self._session_guard:
            session_id = self.session_id
            if session_id is None:
                return False
            if self.bridge._session(session_id) is not None:
                return False
            observed = self.bridge.session_status(
                session_id, self.task_path)
            if observed.get("status") != "unknown_session":
                return False
            self.dashboard._unregister_author_bridge(
                session_id, self.bridge)
            self.session_id = None
            self.url = None
            self._ensure_view()
            return True

    def _ensure_view(self, initial=False):
        task = util.load_json(self.task_path)
        internal_stage = self.controller._author_stage(task, self.task_path)
        needs_questionnaire = (
            internal_stage == "questionnaire"
            or (
                self.revision_questionnaire
                and internal_stage == "ready_to_validate"
            )
        )
        if needs_questionnaire:
            state, requested = self._draft_request_state()
            kinds = self._draft_kinds(state, requested)
            node_ids = self._draft_node_ids(state, requested)
            jobs, submitted, missing = self._drafts(
                kinds=kinds, node_ids=node_ids)
            submitted.update({
                "generation_requested": requested,
                "requested_kinds": kinds,
                "requested_node_ids": node_ids,
            })
            if not requested:
                missing = []
        else:
            jobs = {"jobs": []}
            submitted = {
                "type": "ops_author_drafts",
                "launch_id": self.launch_id,
                "task_ref": self.task_ref,
                "drafts": [],
            }
            missing = []

        self.bridge.set_agent_drafts(submitted)
        if self.session_id is None:
            opened = self.bridge.create_author_session(
                self.task_path, intent=self.intent)
        else:
            opened = self.bridge.advance_author_session(
                self.session_id,
                self.task_path,
                drafts=submitted,
                revision_questionnaire=self.revision_questionnaire,
            )
            opened["url"] = self.url
        self._register_opened(opened, jobs=jobs, missing=missing)
        return True

    def _monitor(self):
        last_heartbeat = 0.0
        next_draft_sync = 0.0
        while not self._stopped.wait(0.2):
            if self.session_id is None:
                self._ensure_view()
            else:
                observed = self.bridge.session_status(
                    self.session_id, self.task_path)
                status = observed.get("status")
                if status == "submitted":
                    detail = observed.get("last_submission") or {}
                    if detail.get("status") == "ok":
                        if detail.get("next_stage") == "awaiting_agent_custom_logic":
                            pending = custom_logic_jobs.list_jobs(
                                self.controller, self.launch_id)
                            if pending.get("job_count"):
                                self._write(
                                    status="awaiting_agent_custom_logic",
                                    stage="questionnaire",
                                    custom_logic_job_count=pending.get("job_count"),
                                )
                                continue
                            with self.bridge._guard:
                                current = self.bridge._sessions.get(self.session_id)
                                if current:
                                    current["last_submission"] = None
                            self.revision_questionnaire = False
                            self._ensure_view()
                            if self.stage == "ready_to_validate":
                                self._write(
                                    status="completed",
                                    stage="ready_to_validate",
                                    next_action="task_validate",
                                    custom_logic_job_count=0,
                                )
                            continue
                        prior_stage = self.stage
                        if self.intent == "revise" and prior_stage == "design_gate":
                            self.revision_questionnaire = True
                        elif (
                            self.revision_questionnaire
                            and prior_stage == "questionnaire"
                        ):
                            self.revision_questionnaire = False
                        self._ensure_view()
                        if self.stage == "ready_to_validate":
                            self._write(
                                status="completed",
                                stage="ready_to_validate",
                                next_action="task_validate",
                            )
                    else:
                        self._write(
                            status="open",
                            reason_code=detail.get("reason_code"),
                            reason=detail.get("reason"),
                        )
                elif status in ("conflict", "invalid", "busy"):
                    detail = observed.get("last_submission") or {}
                    self._write(
                        status="open",
                        reason_code=detail.get("reason_code"),
                        reason=detail.get("reason"),
                    )
                elif status == "unknown_session":
                    try:
                        self._reopen_expired_session()
                    except (OSError, ValueError, KeyError,
                            json.JSONDecodeError) as exc:
                        self._write(
                            status="error",
                            reason_code="creator_author_session_reopen_failed",
                            reason=str(exc),
                        )
            state, requested = self._draft_request_state()
            terminal_status = state.get("status")
            if terminal_status in creator_app._FINAL_STATUSES:
                self._stopped.set()
                self._release_runtime_resources()
                self.dashboard._retire_author(
                    self, keep_bridge=terminal_status == "completed")
                return
            if (
                self.stage == "questionnaire"
                and requested
                and time.monotonic() >= next_draft_sync
            ):
                try:
                    kinds = self._draft_kinds(state, requested)
                    node_ids = self._draft_node_ids(state, requested)
                    jobs, submitted, missing = self._drafts(
                        kinds=kinds, node_ids=node_ids)
                    submitted.update({
                        "generation_requested": True,
                        "requested_kinds": kinds,
                        "requested_node_ids": node_ids,
                    })
                    self.bridge.set_agent_drafts(submitted)
                    current = creator_app._load_state(
                        self.controller, self.launch_id)
                    if current.get("status") == "awaiting_agent_drafts":
                        self._write(
                            status=(
                                "awaiting_agent_drafts"
                                if missing else "open"
                            ),
                            draft_job_count=len(jobs.get("jobs") or []),
                            remaining_drafts=len(missing),
                            draft_processing_started_at=(
                                current.get("draft_processing_started_at")
                                if missing else None
                            ),
                        )
                except (OSError, ValueError, json.JSONDecodeError):
                    pass
                next_draft_sync = time.monotonic() + 0.8
            if time.monotonic() >= last_heartbeat:
                try:
                    state = creator_app._load_state(
                        self.controller, self.launch_id)
                    if state.get("status") not in creator_app._FINAL_STATUSES:
                        self._write()
                except (OSError, ValueError, json.JSONDecodeError):
                    pass
                last_heartbeat = time.monotonic() + 3


class DashboardHTTP:
    """브라우저용 통합 대시보드. RunnerHTTP의 bearer API는 노출하지 않는다."""

    def __init__(self, controller, server_id, session_seconds=8 * 60 * 60):
        self.controller = controller
        self.server_id = server_id
        self.session_seconds = int(session_seconds)
        self._dashboard_cookie_name = (
            "ops_dashboard_session_"
            + hashlib.sha256(str(server_id).encode("utf-8")).hexdigest()[:16]
        )
        self._server = None
        self._thread = None
        self.base_url = None
        self._guard = threading.RLock()
        self._sessions = {}
        self._author_bridges = {}
        self._retired_author_bridges = {}
        self._authors = {}
        self._operations = {}
        self._event_condition = threading.Condition(self._guard)
        self._events = []
        self._event_id = 0
        self._event_stopping = False
        self._claude_message_chunks = {}
        self._claude_completed_messages = {}
        # Intentionally in-memory: shared only while this Dashboard server lives.
        self._dependency_dummy_cache = {}
        self._last_activity = time.monotonic()
        self._active_requests = 0
        self.operations_dir = os.path.join(
            controller.project_root, ".ops", "dashboard", "operations")
        os.makedirs(self.operations_dir, exist_ok=True)
        self.input_jobs = DashboardInputJobs(controller)

    @property
    def last_activity(self):
        with self._guard:
            return self._last_activity

    @property
    def active_commands(self):
        with self._guard:
            active_ops = sum(
                1 for item in self._operations.values()
                if item.get("status") == "running")
            return self._active_requests + active_ops

    def start(self):
        if self._server is not None:
            return self
        self._event_stopping = False
        self._recover_operations()
        dashboard = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "ops-local-dashboard"
            sys_version = ""

            def do_GET(self):
                dashboard._request(self, "GET")

            def do_POST(self):
                dashboard._request(self, "POST")

            def log_message(self, _format, *_args):
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.base_url = (
            f"http://127.0.0.1:{self._server.server_address[1]}")
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="ops-local-dashboard",
            daemon=True,
        )
        self._thread.start()
        self._restore_authors()
        return self

    def stop(self):
        authors = list(self._authors.values())
        for author in authors:
            author.stop()
        with self._guard:
            self._authors.clear()
            self._author_bridges.clear()
            self._retired_author_bridges.clear()
            self._dependency_dummy_cache.clear()
            self._event_stopping = True
            self._event_condition.notify_all()
        server = self._server
        self._server = None
        if server is not None:
            server.shutdown()
            server.server_close()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self._thread = None

    def _publish_event(self, event):
        value = dict(event)
        with self._event_condition:
            self._event_id += 1
            value["event_id"] = self._event_id
            self._events.append(value)
            if len(self._events) > _EVENT_HISTORY_LIMIT:
                del self._events[:-_EVENT_HISTORY_LIMIT]
            self._event_condition.notify_all()
        return value

    @staticmethod
    def _public_message_text(value):
        text = str(value or "").replace("\x00", "")
        text = "".join(
            character for character in text
            if character in "\n\r\t" or ord(character) >= 32
        )
        return text[:_CLAUDE_MESSAGE_LIMIT]

    def _active_runner_agent_job(self):
        from . import agent_jobs

        watch = agent_jobs.assistant_watch_status(
            self.controller.project_root)
        if not (
            watch.get("connected")
            and watch.get("state") == "processing"
        ):
            return None
        active = watch.get("active_job")
        if not isinstance(active, dict):
            return None
        try:
            boundary = self.controller.run_status(active.get("run_ref"))
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            return None
        job = boundary.get("job") or {}
        if not (
            boundary.get("status") == "paused"
            and job.get("actor") == "agent"
            and job.get("job_id") == active.get("job_id")
            and boundary.get("revision") == active.get("revision")
        ):
            return None
        return {
            "run_ref": boundary.get("run_ref") or active.get("run_ref"),
            "revision": boundary.get("revision"),
            "job": job,
        }

    def _prune_claude_messages(self, now):
        cutoff = now - _CLAUDE_MESSAGE_TTL_SECONDS
        for collection in (
                self._claude_message_chunks,
                self._claude_completed_messages):
            stale = [
                key for key, value in collection.items()
                if float(value.get("updated_at") or 0) < cutoff
            ]
            for key in stale:
                collection.pop(key, None)

    def _ingest_claude_message(self, payload):
        session_id = payload.get("session_id")
        message_id = payload.get("message_id")
        index = payload.get("index")
        final = payload.get("final")
        delta = payload.get("delta")
        if not (
            payload.get("provider") == "claude"
            and isinstance(session_id, str) and 1 <= len(session_id) <= 200
            and isinstance(message_id, str) and 1 <= len(message_id) <= 200
            and isinstance(index, int) and 0 <= index <= 10000
            and isinstance(final, bool)
            and isinstance(delta, str) and len(delta) <= _CLAUDE_DELTA_LIMIT
        ):
            return {
                "status": "invalid",
                "reason_code": "invalid_agent_message_event",
            }
        key = (session_id, message_id)
        now = time.monotonic()
        complete_text = None
        with self._guard:
            self._prune_claude_messages(now)
            if key in self._claude_completed_messages:
                return {"status": "ok", "accepted": True, "duplicate": True}
            entry = self._claude_message_chunks.setdefault(key, {
                "chunks": {},
                "final_index": None,
                "size": 0,
                "updated_at": now,
            })
            previous = entry["chunks"].get(index, "")
            entry["size"] = int(entry.get("size") or 0) - len(previous) + len(delta)
            entry["chunks"][index] = delta
            entry["updated_at"] = now
            if entry["size"] > _CLAUDE_MESSAGE_BUFFER_LIMIT:
                self._claude_message_chunks.pop(key, None)
                return {
                    "status": "invalid",
                    "reason_code": "agent_message_too_large",
                }
            if final:
                entry["final_index"] = index
            final_index = entry.get("final_index")
            if (
                final_index is not None
                and all(position in entry["chunks"]
                        for position in range(final_index + 1))
            ):
                complete_text = self._public_message_text("".join(
                    entry["chunks"][position]
                    for position in range(final_index + 1)
                ))
                self._claude_message_chunks.pop(key, None)
                self._claude_completed_messages[key] = {"updated_at": now}
        if complete_text and complete_text.strip():
            job = self._active_runner_agent_job()
            if job is not None:
                self._publish_event({
                    "type": "agent_message",
                    "provider": "claude",
                    "run_ref": job.get("run_ref"),
                    "job_id": (job.get("job") or {}).get("job_id"),
                    "message_id": message_id,
                    "message": complete_text,
                })
                return {"status": "ok", "accepted": True, "published": True}
        return {"status": "ok", "accepted": True, "published": False}

    def _internal_event(self, payload):
        event_type = payload.get("type")
        if event_type == "agent_message_delta":
            return self._ingest_claude_message(payload)
        if event_type == "run_updated":
            run_ref = payload.get("run_ref")
            if not isinstance(run_ref, str) or not run_ref:
                return {
                    "status": "invalid",
                    "reason_code": "invalid_run_event",
                }
            boundary = self.controller.run_status(run_ref)
            if boundary.get("status") not in ("paused", "done", "error"):
                return {
                    "status": "invalid",
                    "reason_code": "invalid_run_event",
                }
            published = self._publish_event({
                "type": "run_updated",
                "run_ref": boundary.get("run_ref") or run_ref,
                "revision": boundary.get("revision"),
                "status": boundary.get("status"),
            })
            return {
                "status": "ok",
                "accepted": True,
                "event_id": published["event_id"],
            }
        return {"status": "invalid", "reason_code": "invalid_event_type"}

    def _restore_authors(self):
        folder = creator_app._launch_dir(self.controller)
        try:
            names = sorted(os.listdir(folder))
        except OSError:
            return
        for name in names:
            if not name.endswith(".json") or name.endswith((
                    ".drafts.json", ".logic-jobs.json", ".stop.json")):
                continue
            launch_id = name[:-5]
            try:
                state = creator_app._load_state(self.controller, launch_id)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            if (
                not (
                    state.get("dashboard_owned")
                    or state.get("hub_owned")
                    or state.get("mode") == "integrated_local_hub"
                )
                or state.get("status") in creator_app._FINAL_STATUSES
            ):
                continue
            try:
                author = _DashboardAuthorSession(
                    self,
                    state["task_ref"],
                    intent=state.get("intent") or "author",
                    launch_id=launch_id,
                ).start()
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                continue
            self._authors[launch_id] = author

    def _register_author_bridge(self, session_id, bridge):
        with self._guard:
            self._author_bridges[session_id] = bridge
            self._retired_author_bridges.pop(session_id, None)

    def _unregister_author_bridge(self, session_id, bridge):
        with self._guard:
            if self._author_bridges.get(session_id) is bridge:
                self._author_bridges.pop(session_id, None)
            if self._retired_author_bridges.get(session_id) is bridge:
                self._retired_author_bridges.pop(session_id, None)

    def _retire_author(self, author, keep_bridge=False):
        """완료/중지된 저작 세션을 활성 목록에서 안전하게 제거한다."""
        with self._guard:
            if self._authors.get(author.launch_id) is author:
                self._authors.pop(author.launch_id, None)
            session_id = author.session_id
            if not session_id:
                return
            if self._author_bridges.get(session_id) is not author.bridge:
                return
            if keep_bridge:
                self._retired_author_bridges[session_id] = author.bridge
            else:
                self._author_bridges.pop(session_id, None)
                self._retired_author_bridges.pop(session_id, None)

    def _prune_retired_author_bridges(self):
        """최종 화면의 만료된 라우팅을 별도 감시 스레드 없이 정리한다."""
        with self._guard:
            retired = list(self._retired_author_bridges.items())
        stale = [
            (session_id, bridge)
            for session_id, bridge in retired
            if bridge._session(session_id) is None
        ]
        if not stale:
            return
        with self._guard:
            for session_id, bridge in stale:
                if self._retired_author_bridges.get(session_id) is not bridge:
                    continue
                self._retired_author_bridges.pop(session_id, None)
                if self._author_bridges.get(session_id) is bridge:
                    self._author_bridges.pop(session_id, None)

    def _open_author(self, task_ref, intent):
        task_path = self.controller._task_path(task_ref)
        canonical_ref = self.controller._ref(task_path)
        task = util.load_json(task_path)
        if self.controller._author_stage(task, task_path) == "ready_to_validate":
            intent = "revise"
        active_author = None
        replaced = []
        with self._guard:
            for author in self._authors.values():
                public = author.public()
                if (
                    public.get("task_ref") == canonical_ref
                    and public.get("launch_status")
                        not in creator_app._FINAL_STATUSES
                ):
                    if author.intent == intent:
                        active_author = author
                        break
                    replaced.append(author)
        for author in replaced:
            author._write(
                status="completed",
                reason_code="creator_intent_replaced",
                reason="다른 편집 의도로 새 Creator 세션을 열어 기존 세션을 종료했습니다",
            )
            author.stop()
        if active_author is not None:
            active_author._reopen_expired_session()
            public = active_author.public()
            if public.get("launch_status") not in creator_app._FINAL_STATUSES:
                return {"status": "ok", **public}
        author = _DashboardAuthorSession(self, canonical_ref, intent=intent).start()
        with self._guard:
            self._authors[author.launch_id] = author
        return {"status": "ok", **author.public()}

    def _task_delete_operation_ids(self, manifest, running_only=False):
        task_ref = manifest["task_ref"]
        run_refs = set(manifest["run_refs"])
        matches = []
        with self._guard:
            operations = list(self._operations.items())
        for operation_id, record in operations:
            if running_only and record.get("status") != "running":
                continue
            metadata = record.get("metadata") or {}
            if (
                metadata.get("task_ref") == task_ref
                or metadata.get("run_ref") in run_refs
            ):
                matches.append(operation_id)
        return matches

    def _prepare_task_delete(self, manifest):
        if self._task_delete_operation_ids(manifest, running_only=True):
            return self.controller._conflict(
                "task_operation_running",
                "이 Task의 Dashboard 작업이 진행 중입니다. 완료 후 다시 시도해 주세요",
            )

        task_ref = manifest["task_ref"]
        with self._guard:
            authors = [
                author for author in self._authors.values()
                if author.task_ref == task_ref
            ]
        handled = set()
        for author in authors:
            handled.add(author.launch_id)
            author._write(
                status="stopped",
                reason_code="task_deleted",
                reason="Task가 Dashboard에서 삭제되었습니다",
            )
            author.stop()

        launch_root = creator_app._launch_dir(self.controller)
        for launch_id in manifest["launch_ids"]:
            if launch_id in handled:
                continue
            state_path = os.path.join(launch_root, launch_id + ".json")
            try:
                state = util.load_json(state_path)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            if state.get("status") in creator_app._FINAL_STATUSES:
                continue
            dashboard_owned = bool(
                state.get("dashboard_owned")
                or state.get("hub_owned")
                or state.get("mode") in (
                    "integrated_local_dashboard", "integrated_local_hub")
            )
            if dashboard_owned:
                creator_app._write_state(state_path, {
                    **state,
                    "status": "stopped",
                    "reason_code": "task_deleted",
                    "reason": "Task가 Dashboard에서 삭제되었습니다",
                })
                continue
            stopped = creator_app.stop_creator(
                self.controller.project_root, launch_id)
            if stopped.get("status") == "stop_requested":
                return self.controller._conflict(
                    "creator_stop_pending",
                    "열려 있는 Creator 화면을 정리하고 있습니다. 잠시 후 다시 시도해 주세요",
                )
        return {"status": "ok"}

    def _delete_task(self, payload):
        try:
            manifest = task_reset.build_manifest(
                self.controller, payload.get("task_ref"))
        except ValueError as exc:
            if str(exc) == "yaml_task_required":
                return self.controller._invalid(
                    "YAML에서 만든 Task만 처음부터 다시 만들 수 있습니다",
                    reason_code="yaml_task_required",
                )
            raise
        prepared = self._prepare_task_delete(manifest)
        if prepared.get("status") != "ok":
            return prepared
        operation_ids = self._task_delete_operation_ids(manifest)
        result = self.controller.task_delete(
            payload.get("task_ref"),
            expected_task_fingerprint=payload.get(
                "expected_task_fingerprint"),
            confirmation_task_name=payload.get("confirmation_task_name"),
            idempotency_key=payload.get("idempotency_key"),
        )
        if result.get("status") == "ok":
            with self._guard:
                for operation_id in operation_ids:
                    self._operations.pop(operation_id, None)
                self._dependency_dummy_cache.clear()
        return result

    def creator_jobs(self):
        jobs = []
        sessions = []
        folder = creator_app._launch_dir(self.controller)
        try:
            names = sorted(os.listdir(folder))
        except OSError:
            names = []
        for name in names:
            if not name.endswith(".json") or name.endswith((
                    ".drafts.json", ".logic-jobs.json", ".stop.json")):
                continue
            launch_id = name[:-5]
            try:
                state = creator_app._load_state(self.controller, launch_id)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            if state.get("status") in creator_app._FINAL_STATUSES:
                continue
            dashboard_owned = bool(
                state.get("dashboard_owned")
                or state.get("hub_owned")
                or state.get("mode") in (
                    "integrated_local_dashboard",
                    "integrated_local_hub",
                )
            )
            sessions.append({
                "launch_id": launch_id,
                "task_ref": state.get("task_ref"),
                "status": state.get("status"),
                "stage": state.get("stage"),
                "owner": "dashboard" if dashboard_owned else "standalone",
            })
            if state.get("status") == "awaiting_agent_drafts":
                result = creator_app.creator_draft_jobs(
                    self.controller.project_root, launch_id)
                for item in result.get("jobs") or []:
                    jobs.append({
                        "domain": "creator",
                        "kind": "draft",
                        "launch_id": launch_id,
                        "task_ref": state.get("task_ref"),
                        "job": item,
                    })
            if state.get("status") == "awaiting_agent_custom_logic":
                try:
                    custom = creator_app.creator_custom_logic_jobs(
                        self.controller.project_root, launch_id)
                except (OSError, ValueError, json.JSONDecodeError):
                    custom = {}
                for item in custom.get("jobs") or []:
                    jobs.append({
                        "domain": "creator",
                        "kind": "custom_logic",
                        "launch_id": launch_id,
                        "task_ref": state.get("task_ref"),
                        "job": item,
                    })
            try:
                tests = creator_app.creator_node_test_jobs(
                    self.controller.project_root, launch_id)
            except (OSError, ValueError, json.JSONDecodeError):
                tests = {}
            for item in tests.get("jobs") or []:
                jobs.append({
                    "domain": "creator",
                    "kind": "node_test",
                    "launch_id": launch_id,
                    "task_ref": state.get("task_ref"),
                    **item,
                })
        return {
            "status": "ok",
            "domain": "creator",
            "job_count": len(jobs),
            "jobs": jobs,
            "active_session_count": len(sessions),
            "active_sessions": sessions,
        }

    def runner_jobs(self):
        jobs = list(self.input_jobs.list_jobs())
        seen = set()
        for indexed_runs in self.controller._run_index().values():
            for run_path, run in indexed_runs:
                if run.get("status") != "waiting":
                    continue
                run_ref = self.controller._ref(run_path)
                if not run_ref or run_ref in seen:
                    continue
                seen.add(run_ref)
                boundary = self.controller.run_status(run_ref)
                job = boundary.get("job") or {}
                if boundary.get("status") != "paused" or job.get("actor") != "agent":
                    continue
                try:
                    task_ref = self.controller._ref(
                        self.controller._task_path(run.get("task_ref")))
                except (OSError, ValueError, PermissionError):
                    continue
                jobs.append({
                    "domain": "runner",
                    "kind": "run_pause",
                    "task_ref": task_ref,
                    **_dashboard_runner_job(
                        self.controller.project_root, boundary),
                })
        return {"status": "ok", "domain": "runner",
                "job_count": len(jobs), "jobs": jobs}

    def _request(self, handler, method):
        if not self._valid_host(handler):
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "error", "reason_code": "invalid_host"})
        parsed = urlsplit(handler.path)
        if method == "GET" and parsed.path == "/api/events":
            with self._guard:
                self._last_activity = time.monotonic()
            return self._event_stream(handler)
        self._prune_retired_author_bridges()
        with self._guard:
            self._last_activity = time.monotonic()
            self._active_requests += 1
        try:
            if method == "POST" and parsed.path == "/api/internal/events":
                return self._post_internal_event(handler)
            pieces = [part for part in parsed.path.split("/") if part]
            if pieces and pieces[0] == "author":
                bridge = (
                    self._author_bridges.get(pieces[1])
                    if len(pieces) >= 2 else None)
                if bridge is None:
                    return self._json(handler, HTTPStatus.GONE, {
                        "status": "error",
                        "reason_code": "expired_author_session",
                    })
                if method == "GET":
                    return bridge._handle_get(handler)
                return bridge._handle_post(handler)
            if method == "GET":
                return self._get(handler, parsed)
            return self._post(handler, parsed)
        finally:
            with self._guard:
                self._active_requests -= 1
                self._last_activity = time.monotonic()

    def _post_internal_event(self, handler):
        token = handler.headers.get("X-Ops-Dashboard-Token") or ""
        if not secrets.compare_digest(token, str(self.server_id)):
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "invalid_event_token"})
        payload = self._read_json(handler)
        if isinstance(payload, tuple):
            return self._json(handler, payload[0], payload[1])
        result = self._internal_event(payload)
        status = (
            HTTPStatus.OK
            if result.get("status") == "ok"
            else HTTPStatus.BAD_REQUEST
        )
        return self._json(handler, status, result)

    def _event_stream(self, handler):
        if self._dashboard_session(handler) is None:
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "dashboard_session_required"})
        raw_cursor = handler.headers.get("Last-Event-ID")
        with self._event_condition:
            if raw_cursor is None:
                cursor = self._event_id
            else:
                try:
                    cursor = max(0, int(raw_cursor))
                except ValueError:
                    cursor = self._event_id
        handler.send_response(HTTPStatus.OK)
        handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
        handler.send_header("Connection", "keep-alive")
        self._security_headers(handler)
        handler.end_headers()
        try:
            handler.wfile.write(b"retry: 1500\n\n")
            handler.wfile.flush()
            while True:
                with self._event_condition:
                    pending = [
                        event for event in self._events
                        if int(event.get("event_id") or 0) > cursor
                    ]
                    if not pending and not self._event_stopping:
                        self._event_condition.wait(timeout=15)
                        pending = [
                            event for event in self._events
                            if int(event.get("event_id") or 0) > cursor
                        ]
                    stopping = self._event_stopping
                if pending:
                    for event in pending:
                        cursor = int(event["event_id"])
                        name = str(event.get("type") or "message")
                        data = json.dumps(
                            event, ensure_ascii=False,
                            separators=(",", ":"),
                        )
                        raw = (
                            f"id: {cursor}\n"
                            f"event: {name}\n"
                            f"data: {data}\n\n"
                        ).encode("utf-8")
                        handler.wfile.write(raw)
                    handler.wfile.flush()
                else:
                    handler.wfile.write(b": keepalive\n\n")
                    handler.wfile.flush()
                if stopping:
                    handler.close_connection = True
                    return
        except (BrokenPipeError, ConnectionResetError, OSError):
            handler.close_connection = True
            return

    def _get(self, handler, parsed):
        if parsed.path in ("/", "/dashboard"):
            return self._serve_dashboard(handler, parse_qs(parsed.query))
        if parsed.path == "/api/health":
            return self._json(handler, HTTPStatus.OK, {
                "status": "ok",
                "mode": "integrated_local_dashboard",
                "server_id": self.server_id,
                "project_root": self.controller.project_root,
            })
        session = self._dashboard_session(handler)
        if session is None:
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "dashboard_session_required"})
        query = parse_qs(parsed.query)
        if parsed.path == "/api/signal":
            from . import agent_jobs
            domain = (query.get("domain") or ["all"])[0]
            try:
                result = agent_jobs.signature_document(self, domain)
            except ValueError as exc:
                result = {
                    "status": "invalid",
                    "reason_code": "invalid_signal_domain",
                    "reason": str(exc),
                }
            return self._json(handler, HTTPStatus.OK, result)
        if parsed.path == "/api/catalog":
            return self._json(
                handler, HTTPStatus.OK, self.controller.project_catalog())
        if parsed.path == "/api/task/delete-preview":
            task_ref = (query.get("task_ref") or [None])[0]
            return self._json(
                handler, HTTPStatus.OK,
                self.controller.task_delete_preview(task_ref))
        if parsed.path == "/api/jobs":
            domain = (query.get("domain") or ["all"])[0]
            if domain == "creator":
                result = self.creator_jobs()
            elif domain == "runner":
                result = self.runner_jobs()
            else:
                creator = self.creator_jobs()
                runner = self.runner_jobs()
                result = {
                    "status": "ok",
                    "domain": "all",
                    "creator": creator,
                    "runner": runner,
                    "job_count": (
                        creator.get("job_count", 0)
                        + runner.get("job_count", 0)),
                }
            return self._json(handler, HTTPStatus.OK, result)
        if parsed.path == "/api/runs":
            task_ref = (query.get("task_ref") or [None])[0]
            return self._json(
                handler, HTTPStatus.OK,
                self.controller.run_list(task_ref))
        if parsed.path == "/api/run/status":
            run_ref = (query.get("run_ref") or [None])[0]
            return self._json(
                handler, HTTPStatus.OK,
                self._decorate_dependency_cache(
                    self.input_jobs.decorate_boundary(
                        self.controller.run_status(run_ref))))
        if parsed.path == "/api/run/file-preview":
            run_ref = (query.get("run_ref") or [None])[0]
            file_id = (query.get("file_id") or [None])[0]
            result = self.controller.run_file_preview(run_ref, file_id)
            return self._json(
                handler,
                HTTPStatus.OK if result.get("status") == "ok"
                else HTTPStatus.BAD_REQUEST,
                result,
            )
        if parsed.path == "/api/run":
            run_ref = (query.get("run_ref") or [None])[0]
            return self._json(
                handler, HTTPStatus.OK,
                self._decorate_dependency_cache(
                    self.input_jobs.decorate_boundary(
                        self.controller.run_status(run_ref))))
        if parsed.path == "/api/operation":
            operation_id = (query.get("id") or [None])[0]
            with self._guard:
                result = self._operations.get(operation_id)
            if result is None:
                path = self._operation_path(operation_id)
                if path and os.path.isfile(path):
                    result = util.load_json(path)
            return self._json(
                handler,
                HTTPStatus.OK if result else HTTPStatus.NOT_FOUND,
                result or {
                    "status": "error",
                    "reason_code": "operation_not_found",
                },
            )
        return self._json(handler, HTTPStatus.NOT_FOUND, {
            "status": "error", "reason_code": "not_found"})

    def _post(self, handler, parsed):
        if not self._valid_origin(handler):
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "invalid_origin"})
        session = self._dashboard_session(handler)
        if session is None:
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "dashboard_session_required"})
        if not secrets.compare_digest(
                handler.headers.get("X-Ops-CSRF") or "", session["csrf"]):
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "csrf_failed"})
        payload = self._read_json(handler)
        if isinstance(payload, tuple):
            return self._json(handler, payload[0], payload[1])
        try:
            if parsed.path == "/api/task/create":
                result = self.controller.task_create_draft(
                    payload.get("yaml_ref"),
                    payload.get("task_id"),
                    expected_yaml_fingerprint=payload.get(
                        "expected_yaml_fingerprint"),
                    idempotency_key=payload.get("idempotency_key"),
                )
                if result.get("status") in ("ok", "exists_same_source"):
                    result = {
                        **result,
                        "author": self._open_author(
                            result["task_ref"], "author"),
                    }
            elif parsed.path == "/api/task/open":
                result = self._open_author(
                    payload.get("task_ref"),
                    "revise" if payload.get("intent") == "revise" else "author",
                )
            elif parsed.path == "/api/task/validate":
                result = self.controller.task_validate(
                    payload.get("task_ref"), rehearsal=True)
            elif parsed.path == "/api/task/delete":
                result = self._delete_task(payload)
            elif parsed.path == "/api/run/start":
                result = self._start_operation(
                    "run_start",
                    lambda: self._auto_reuse_dependency_dummy(
                        self.controller.dashboard_run_start(
                        payload.get("task_ref"),
                        payload.get("key"),
                        expected_task_fingerprint=payload.get(
                            "expected_task_fingerprint"),
                        idempotency_key=payload.get("idempotency_key"),
                    )),
                    {"task_ref": payload.get("task_ref"),
                     "key": payload.get("key")},
                )
            elif parsed.path == "/api/run/next":
                result = self._start_operation(
                    "run_next",
                    lambda: self._auto_reuse_dependency_dummy(
                        self.controller.run_next(
                        payload.get("run_ref"),
                        expected_revision=payload.get("expected_revision"),
                        idempotency_key=payload.get("idempotency_key"),
                    )),
                    {"run_ref": payload.get("run_ref")},
                )
            elif parsed.path == "/api/run/delete":
                result = self.controller.run_delete(
                    payload.get("run_ref"),
                    expected_revision=payload.get("expected_revision"),
                    idempotency_key=payload.get("idempotency_key"),
                )
            elif parsed.path == "/api/run/human-submit":
                result = self._start_operation(
                    "run_human_submit",
                    lambda: self._complete_dashboard_human(payload),
                    {"run_ref": payload.get("run_ref"),
                     "job_id": payload.get("job_id")},
                )
            elif parsed.path == "/api/run/parse-request":
                result = self.input_jobs.create(
                    payload.get("run_ref"),
                    payload.get("job_id"),
                    payload.get("revision"),
                    payload.get("raw_input"),
                )
            elif parsed.path == "/api/run/dummy-draft-request":
                result = self.input_jobs.create_dependency_dummy(
                    payload.get("run_ref"), payload.get("job_id"),
                    payload.get("revision"))
            elif parsed.path == "/api/assistant-watch/stop":
                from . import agent_jobs
                result = agent_jobs.stop_assistant_watch(
                    self.controller.project_root)
            else:
                return self._json(handler, HTTPStatus.NOT_FOUND, {
                    "status": "error", "reason_code": "not_found"})
        except (OSError, ValueError, KeyError, TypeError,
                json.JSONDecodeError) as exc:
            # str(exc)는 파일 경로·Python 타입명이 섞여 사용자에게 보여줄 문구가
            # 아니다. 진단용으로 detail에만 남기고, 화면 문구는 reason_code로 만든다.
            result = {
                "status": "error",
                "reason_code": "dashboard_command_failed",
                "detail": str(exc),
            }
        code = HTTPStatus.OK
        if (
            result.get("status") == "invalid"
            and parsed.path != "/api/task/validate"
        ):
            code = HTTPStatus.BAD_REQUEST
        elif result.get("status") == "conflict":
            code = HTTPStatus.CONFLICT
        elif result.get("status") == "busy":
            code = HTTPStatus.LOCKED
        elif result.get("status") == "error":
            code = HTTPStatus.INTERNAL_SERVER_ERROR
        return self._json(handler, code, result)

    def _dependency_cache_context(self, run_ref):
        run_path = self.controller._run_path(run_ref)
        run = self.controller._load_json(run_path)
        task_path = self.controller._task_path(run.get("task_ref"))
        task = self.controller._load_json(task_path)
        source_yaml = task.get("source_yaml")
        workflow = task.get("source_yaml_sha256")
        if not workflow and source_yaml:
            workflow = os.path.realpath(os.path.join(
                os.path.dirname(task_path), str(source_yaml)))
        if not workflow:
            workflow = os.path.dirname(os.path.realpath(task_path))
        return str(workflow), run

    @staticmethod
    def _dependency_source_key(field):
        return json.dumps([
            field.get("from_task"), field.get("from_node"),
            field.get("from_field")], ensure_ascii=False, separators=(",", ":"))

    def _decorate_dependency_cache(self, boundary):
        if not isinstance(boundary, dict):
            return boundary
        job = boundary.get("job") or {}
        if boundary.get("status") != "paused" or job.get("kind") != "ask_dependency_dummy":
            return boundary
        try:
            workflow, _run = self._dependency_cache_context(boundary.get("run_ref"))
        except (OSError, ValueError, KeyError, TypeError):
            return boundary
        cached = {}
        with self._guard:
            workflow_cache = self._dependency_dummy_cache.get(workflow) or {}
            for field in job.get("fields") or []:
                key = self._dependency_source_key(field)
                if key in workflow_cache:
                    cached[field.get("id")] = workflow_cache[key]["value"]
        if not cached:
            return boundary
        result = dict(boundary)
        result["dependency_dummy_cache"] = {
            "available": True, "count": len(cached), "output": cached,
        }
        return result

    def _remember_dependency_dummy(self, before, submitted_output):
        job = (before or {}).get("job") or {}
        if job.get("kind") != "ask_dependency_dummy" or not isinstance(submitted_output, dict):
            return
        try:
            workflow, run = self._dependency_cache_context(before.get("run_ref"))
        except (OSError, ValueError, KeyError, TypeError):
            return
        provenance = run.get("dependency_dummy_inputs") or {}
        with self._guard:
            workflow_cache = self._dependency_dummy_cache.setdefault(workflow, {})
            for field in job.get("fields") or []:
                field_id = field.get("id")
                if field_id not in provenance or field_id not in run.get("inputs_from", {}):
                    continue
                workflow_cache[self._dependency_source_key(field)] = {
                    "value": run["inputs_from"][field_id], "saved_at": _now(),
                }

    def _complete_dashboard_human(self, payload):
        run_ref = payload.get("run_ref")
        before = self.controller.run_status(run_ref)
        result_payload = payload.get("result")
        result_payload = dict(result_payload) if isinstance(result_payload, dict) else result_payload
        result = self.controller.run_complete_human_job(
            run_ref, payload.get("job_id"), payload.get("revision"),
            payload.get("idempotency_key"), result_payload)
        if isinstance(result_payload, dict):
            self._remember_dependency_dummy(before, result_payload.get("output"))
        return self._auto_reuse_dependency_dummy(result)

    def _auto_reuse_dependency_dummy(self, result):
        """Resume automatically when every dependency field is in this server's cache."""
        current = result
        for _attempt in range(8):
            current = self._decorate_dependency_cache(current)
            job = (current or {}).get("job") or {}
            cache = (current or {}).get("dependency_dummy_cache") or {}
            fields = job.get("fields") or []
            output = cache.get("output") or {}
            if (
                current.get("status") != "paused"
                or job.get("kind") != "ask_dependency_dummy"
                or not fields
                or any(field.get("id") not in output for field in fields)
            ):
                return current
            current = self.controller.run_complete_human_job(
                current.get("run_ref"), job.get("job_id"), current.get("revision"),
                "dashboard-dummy-reuse-" + str(job.get("job_id")),
                {"output": output, "dependency_dummy_origin": "reuse"},
            )
        return current

    def _start_operation(self, kind, action, metadata):
        operation_id = secrets.token_urlsafe(18)
        record = {
            "type": "ops_dashboard_operation",
            "operation_id": operation_id,
            "server_id": self.server_id,
            "kind": kind,
            "status": "running",
            "metadata": metadata,
            "started_at": _now(),
        }
        self._write_operation(record)

        def worker():
            try:
                result = action()
            except Exception as exc:  # 서버 thread가 죽지 않도록 결과로 격리한다.
                result = {
                    "status": "error",
                    "reason_code": "dashboard_operation_failed",
                    "detail": str(exc),
                }
            with self._guard:
                record.update({
                    "status": "done",
                    "completed_at": _now(),
                    "result": result,
                })
            self._write_operation(record)
            self._prune_operation_history()

        threading.Thread(
            target=worker,
            name=f"ops-dashboard-operation-{operation_id[:8]}",
            daemon=True,
        ).start()
        return {
            "status": "accepted",
            "operation_id": operation_id,
        }

    @staticmethod
    def _operation_time(record):
        raw = record.get("completed_at") or record.get("started_at")
        try:
            return datetime.datetime.fromisoformat(str(raw)).timestamp()
        except (TypeError, ValueError):
            return 0.0

    def _recover_operations(self):
        """이전 Dashboard가 남긴 실행 중 기록을 중단 결과로 복구한다."""
        try:
            names = sorted(os.listdir(self.operations_dir))
        except OSError:
            names = []
        for name in names:
            if not name.endswith(".json"):
                continue
            path = os.path.join(self.operations_dir, name)
            try:
                record = util.load_json(path)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            if (
                record.get("type") != "ops_dashboard_operation"
                or record.get("status") != "running"
            ):
                continue
            record.update({
                "status": "done",
                "completed_at": _now(),
                "interrupted": True,
                "result": {
                    "status": "error",
                    "reason_code": "dashboard_operation_interrupted",
                    "detail": "이전 Dashboard가 작업 완료 전에 종료되었습니다.",
                },
            })
            self._write_operation(record)
        self._prune_operation_history()

    def _prune_operation_history(self):
        """완료된 Dashboard 내부 작업 기록을 기간과 개수 기준으로 제한한다."""
        completed = []
        try:
            names = sorted(os.listdir(self.operations_dir))
        except OSError:
            names = []
        for name in names:
            if not name.endswith(".json"):
                continue
            path = os.path.join(self.operations_dir, name)
            try:
                record = util.load_json(path)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            if (
                record.get("type") == "ops_dashboard_operation"
                and record.get("status") != "running"
            ):
                completed.append((self._operation_time(record), path, record))
        completed.sort(key=lambda item: item[0], reverse=True)
        cutoff = time.time() - _OPERATION_HISTORY_SECONDS
        for index, (timestamp, path, record) in enumerate(completed):
            if index < _OPERATION_HISTORY_LIMIT and timestamp >= cutoff:
                continue
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
            with self._guard:
                self._operations.pop(record.get("operation_id"), None)

    def _operation_path(self, operation_id):
        if (
            not isinstance(operation_id, str)
            or not operation_id
            or any(ch not in
                   "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
                   for ch in operation_id)
        ):
            return None
        path = os.path.realpath(os.path.join(
            self.operations_dir, operation_id + ".json"))
        return path if self.controller._inside(
            path, self.operations_dir) else None

    def _write_operation(self, record):
        path = self._operation_path(record["operation_id"])
        util.atomic_write_json(path, record)
        with self._guard:
            self._operations[record["operation_id"]] = record

    def _serve_dashboard(self, handler, query):
        session = self._dashboard_session(handler)
        if session is None:
            session_id = secrets.token_urlsafe(18)
            csrf = secrets.token_urlsafe(24)
            session = {
                "session_id": session_id,
                "csrf": csrf,
                "created_at": time.time(),
            }
            with self._guard:
                self._sessions[session_id] = session
        else:
            session_id = session["session_id"]
            csrf = session["csrf"]
        tab = (query.get("tab") or ["creator"])[0]
        if tab not in ("creator", "runner"):
            tab = "creator"
        raw = self._dashboard_html(csrf, tab).encode("utf-8")
        handler.send_response(HTTPStatus.OK)
        handler.send_header("Content-Type", "text/html; charset=utf-8")
        handler.send_header(
            "Set-Cookie",
            f"{self._dashboard_cookie_name}={session_id}; "
            "HttpOnly; SameSite=Strict; Path=/")
        self._security_headers(handler, html=True)
        handler.send_header("Content-Length", str(len(raw)))
        handler.end_headers()
        handler.wfile.write(raw)

    def _dashboard_session(self, handler):
        cookies = {}
        for part in (handler.headers.get("Cookie") or "").split(";"):
            if "=" in part:
                key, value = part.strip().split("=", 1)
                cookies[key] = value
        with self._guard:
            return self._sessions.get(cookies.get(
                self._dashboard_cookie_name))

    def _read_json(self, handler):
        content_type = (
            handler.headers.get("Content-Type") or "").split(";", 1)[0].strip()
        if content_type != "application/json":
            return HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {
                "status": "invalid", "reason_code": "json_required"}
        try:
            length = int(handler.headers.get("Content-Length") or "0")
        except ValueError:
            length = -1
        if length < 2 or length > _MAX_BODY:
            return HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                "status": "invalid", "reason_code": "invalid_body_size"}
        try:
            value = json.loads(handler.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return HTTPStatus.BAD_REQUEST, {
                "status": "invalid", "reason_code": "invalid_json"}
        if not isinstance(value, dict):
            return HTTPStatus.BAD_REQUEST, {
                "status": "invalid", "reason_code": "json_object_required"}
        return value

    def _valid_host(self, handler):
        port = self._server.server_address[1]
        return loopback_http.valid_host(handler, port)

    def _valid_origin(self, handler):
        origin = handler.headers.get("Origin") or ""
        return origin in {
            self.base_url,
            self.base_url.replace("127.0.0.1", "localhost"),
        }

    @staticmethod
    def _security_headers(handler, html=False):
        loopback_http.security_headers(
            handler,
            content_security_policy=(
                loopback_http.DASHBOARD_HTML_CSP if html else None),
        )
        handler.send_header("Cache-Control", "no-store")

    @classmethod
    def _json(cls, handler, status, value):
        loopback_http.json_response(handler, status, value)

    @staticmethod
    def _dashboard_html(csrf, initial_tab):
        # 외부 프론트엔드 의존성 없이 현재 Creator와 같은 단일 HTML 방식으로 제공한다.
        return """<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>E2E-Automation</title>
<style>
:root{--blue:#1736b6;--line:#d9deea;--bg:#f5f7fb;--text:#172033;--muted:#657087}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);
font-family:Arial,"Noto Sans KR",sans-serif}.top{height:64px;background:#fff;
border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 28px;
gap:28px;position:sticky;top:0;z-index:4}.top h1{font-size:20px;margin:0}.tabs{
display:flex;gap:0;padding:3px;background:#f0f2f7;border:1px solid #d5d9e3;
border-radius:10px}.tab{border:0;background:transparent;color:#6b7280;border-radius:7px;
padding:9px 16px;font-weight:700;cursor:pointer}.tab.active{background:var(--blue);
color:#fff;box-shadow:inset 0 -3px #0b2b91,0 2px 6px #173cad40}.btn{
border:1px solid var(--blue);background:#fff;color:var(--blue);border-radius:7px;
padding:9px 15px;font-weight:700;cursor:pointer}.btn.primary{background:var(--blue);
color:#fff}.btn:disabled{border-color:#cbd0dc;background:#eef0f4;color:#9aa1af;
cursor:not-allowed}.btn.danger{border-color:#d14343;color:#b42318;background:#fff}
.btn.danger:hover{background:#fff1f1}.wrap{max-width:1280px;margin:24px auto;padding:0 20px}
.summary,.panel,.card{background:#fff;border:1px solid var(--line);border-radius:10px}
.summary{padding:18px 20px;margin-bottom:18px;display:flex;justify-content:space-between;
align-items:center}.panel{padding:20px;margin-bottom:18px}.panel h2{margin:0 0 14px;font-size:18px}
.panel-heading{display:flex;align-items:center;gap:9px;margin-bottom:14px}.panel-heading h2{margin:0}
.connection-status{padding:4px 8px;border-radius:999px;background:#fff3d8;color:#8a5a00;
font-size:12px;font-weight:800}.connection-status.connected{background:#e6f5ec;color:#26734d}
.workflow{border-top:1px solid var(--line);padding-top:16px;margin-top:16px}
.workflow:first-child{border-top:0;padding-top:0;margin-top:0}.grid{display:grid;
grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px}.card{padding:16px}
.runner-section+.runner-section{border-top:1px solid var(--line);margin-top:20px;
padding-top:20px}.runner-section-head{margin-bottom:14px}.runner-section-head h2{
margin:0 0 4px}.runner-section .card.setup-required{background:#fafbfc}
.card h3{font-size:16px;margin:0 0 8px}.meta{font-size:13px;color:var(--muted);
line-height:1.6}.task-ref{min-height:21px}.badges{display:flex;gap:6px;flex-wrap:wrap;
margin:11px 0}.badge{
padding:4px 8px;border-radius:999px;background:#edf1ff;color:var(--blue);font-size:12px;
font-weight:700}.badge.warn{background:#fff3d8;color:#8a5a00}.badge.err{background:#ffe8e8;
color:#a21d1d}.actions{display:flex;gap:7px;flex-wrap:wrap}.btn{font-size:13px;padding:7px 10px}
.hidden{display:none!important}.empty{color:var(--muted);padding:20px 0}.jobs{display:grid;
grid-template-columns:1fr 1fr;gap:14px}.jobs.single{grid-template-columns:1fr}.job{
border:1px solid var(--line);border-radius:8px;padding:14px}.jobs-empty{display:flex;
align-items:center;gap:12px;padding:15px 16px;background:#f6f8fc;border:1px solid var(--line);
border-radius:8px}.jobs-empty strong{display:block;margin-bottom:3px}.jobs-empty-mark{
display:grid;place-items:center;width:28px;height:28px;flex:0 0 28px;border-radius:50%;
background:#e6f5ec;color:#26734d;font-weight:800}.jobs-empty .btn{margin-left:auto;
flex:0 0 auto}.jobs-empty-actions{display:flex;gap:8px;margin-left:auto}
.jobs-empty-actions .btn{margin-left:0}.jobs-action{display:flex;align-items:center;gap:12px;margin-top:12px}
.jobs-empty-mark.disconnected{background:#fff3d8;color:#8a5a00}
.copy-success{color:#26734d;font-size:13px;font-weight:700}.dialog{position:fixed;inset:0;
background:#0008;display:flex;align-items:center;
justify-content:center;z-index:10}.dialog>div{background:#fff;border-radius:12px;width:min(980px,94vw);
max-height:86vh;overflow:auto;padding:24px}.dialog h2{margin-top:0}input,textarea{width:100%;
border:1px solid #b9c1d3;border-radius:7px;padding:10px;font:inherit;margin:6px 0 12px}
textarea{min-height:170px;font-family:Consolas,monospace}.notice{padding:12px;border-radius:8px;
background:#eef2ff;margin:10px 0;white-space:pre-wrap}.error{background:#ffeaea;color:#941f1f}
.runtime-fields{display:grid;gap:14px;margin:18px 0}.runtime-field{display:grid;gap:7px}
.runtime-field>label{font-weight:800}.runtime-field textarea{margin:0;min-height:92px}
.runtime-help{font-size:13px;color:var(--muted);line-height:1.55}.runtime-actions{
display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.runtime-select{width:100%;
border:1px solid #b9c1d3;border-radius:7px;padding:10px;font:inherit;margin:6px 0 12px}
.runtime-input-tabs{display:flex;gap:4px;width:max-content;max-width:100%;margin-top:18px;
padding:4px;border:1px solid var(--line);border-radius:9px 9px 0 0;background:#eef1f7}
.runtime-input-tab{border:0;border-radius:6px;background:transparent;color:var(--muted);
padding:9px 14px;font:inherit;font-weight:800;cursor:pointer}.runtime-input-tab.active{
background:#fff;color:var(--blue);box-shadow:0 1px 4px #203a791f}
.runtime-input-tab:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.runtime-method{padding:16px;border:1px solid var(--line);border-radius:9px;
background:#fafbfe}.runtime-input-panel{margin-top:-1px;border-radius:0 9px 9px 9px}
.runtime-method h4{margin:0 0 5px}.runtime-method textarea{margin-bottom:8px}
.dependency-source-list{display:grid;gap:14px;margin:18px 0}.dependency-source{
border:1px solid var(--line);border-radius:10px;padding:18px;background:#fafbfe}
.dependency-data-title{display:grid;gap:3px;margin-bottom:14px}.dependency-data-title span{
font-size:12px;font-weight:800;color:var(--blue)}.dependency-data-title strong{font-size:20px}
.dependency-source-flow-wrap{display:grid;gap:7px;margin-bottom:14px}.dependency-source-flow-title,
.dependency-usage-label{font-size:12px;font-weight:800;color:var(--muted)}
.dependency-source-flow{display:grid;grid-template-columns:minmax(0,1.2fr) 22px minmax(0,1fr) 22px minmax(0,.8fr);
gap:5px;align-items:stretch}.dependency-source-step{display:grid;align-content:start;gap:4px;
padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff}
.dependency-source-step span{font-size:11px;font-weight:800;color:var(--blue)}
.dependency-source-step strong{font-size:14px;line-height:1.45;overflow-wrap:anywhere}
.dependency-source-arrow{display:grid;place-items:center;color:#8490a8;font-weight:800}
.dependency-usage{display:grid;gap:7px;padding-bottom:14px;margin-bottom:14px;
border-bottom:1px solid var(--line)}.dependency-consumers{display:flex;gap:6px;flex-wrap:wrap}
.dependency-consumer{padding:6px 9px;border-radius:7px;background:#edf1ff;color:#304b9b;
font-size:13px;font-weight:700;line-height:1.4}.dependency-source label{display:block;
font-weight:800;margin-bottom:6px}
.dependency-source textarea{font-family:inherit;min-height:88px;margin:0;background:#fff}
@media(max-width:680px){.dependency-source-flow{grid-template-columns:1fr}.dependency-source-arrow{
height:12px;transform:rotate(90deg)}}
.dummy-badge{display:inline-flex;padding:4px 8px;border-radius:999px;
background:#fff3d8;color:#8a5a00;font-size:12px;font-weight:800}.run-head-badges{display:flex;
gap:7px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.dummy-provenance{
padding:10px 12px;border:1px solid #ead29a;border-radius:8px;background:#fffbef;margin-top:12px;
font-size:13px}.ai-draft-status{display:flex;gap:9px;align-items:center;margin:12px 0;
padding:10px 12px;border-radius:8px;background:#eef2ff}.ai-draft-status.error{background:#ffeaea}
.validation-result{display:grid;gap:16px}.validation-result h2{margin:0}
.validation-section{border-top:1px solid var(--line);padding-top:14px}
.validation-section h3{margin:0 0 9px;font-size:16px}.validation-list{margin:0;padding-left:22px}
.validation-list li{margin:7px 0;line-height:1.55}.validation-flow{display:grid;gap:9px}
.validation-step{padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:#f8f9fc}
.validation-step strong{display:block;margin-bottom:4px}.validation-step .meta{white-space:pre-wrap}
.task-delete-scope{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;
margin:14px 0}.task-delete-scope div{padding:10px 12px;border:1px solid var(--line);
border-radius:8px;background:#fafbfe}.task-delete-scope strong{display:block;font-size:18px;
margin-top:2px}.task-delete-warning{padding:13px 14px;border:1px solid #efb2b2;
border-radius:8px;background:#fff4f4;color:#842424}.task-delete-warning ul{margin:8px 0 0;
padding-left:22px}.task-delete-confirm{margin-top:16px}.task-delete-confirm label{font-weight:800}
.task-delete-confirm code{font-family:inherit;color:#941f1f;font-weight:800}
.run-list{display:grid;gap:9px;margin:12px 0 20px}.run-list-row{display:flex;
align-items:center;justify-content:space-between;gap:16px;padding:13px 14px;border:1px solid var(--line);
border-radius:9px}.run-list-actions{display:flex;gap:7px;flex:0 0 auto}.run-section-title{
margin:18px 0 8px;font-size:15px}.run-shell{display:flex;flex-direction:column;min-height:560px}
.runner-dialog>div{scroll-padding-top:108px}.runner-dialog #closeDialog{display:none}.run-head{
position:sticky;top:-24px;z-index:3;display:flex;justify-content:space-between;align-items:flex-start;
gap:16px;margin:-24px -24px 0;padding:20px 24px 14px;background:#fff;
border-bottom:1px solid var(--line)}.run-head h2{margin:0 0 5px}.run-close{flex:0 0 auto}
.run-status-badge{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;
background:#edf1ff;color:var(--blue);font-size:12px;font-weight:800;white-space:nowrap}
.run-progress-summary{display:flex;align-items:center;gap:12px;padding:15px 2px 10px;
font-size:13px}.run-progress-summary progress{width:min(300px,42vw);height:8px;accent-color:var(--blue)}
.run-current{flex:1;min-height:280px;padding:24px 4px}.run-current h3{
margin:0 0 12px;font-size:20px}.run-current .notice{max-width:760px}.run-current-context{
margin:14px 0;padding:0 13px;border:1px solid var(--line);border-radius:9px;background:#fafbfe}
.run-current-context>summary,.run-step-support>summary{min-height:44px;display:flex;align-items:center;
cursor:pointer;color:#3b465c;font-size:13px;font-weight:800}.run-current-context>summary{
justify-content:space-between;gap:14px}.run-current-context>summary:hover{color:var(--blue)}
.run-current-context>summary:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.run-disclosure-copy{display:grid;gap:2px}.run-disclosure-copy small{color:var(--muted);font-weight:500}
.run-disclosure-action{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;color:var(--blue)}
.run-disclosure-open{display:none}.run-current-context[open] .run-disclosure-closed{display:none}
.run-current-context[open] .run-disclosure-open{display:inline}.run-disclosure-chevron{
display:inline-block;transition:transform .15s ease}.run-current-context[open] .run-disclosure-chevron{
transform:rotate(180deg)}
.run-presentation{display:grid;gap:18px;padding:20px 0;border-top:1px solid var(--line)}
.run-presentation h3{margin:0;font-size:17px}.run-outline{display:flex;gap:8px;
overflow-x:auto;padding:2px 2px 8px;scroll-snap-type:x proximity}.run-outline-step{min-width:170px;
scroll-snap-align:start;display:grid;gap:5px;
padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:#f8f9fc}
.run-outline-step.completed{border-color:#a8d8ba;background:#f0faf4}.run-outline-step.current{
border:2px solid var(--blue);background:#edf1ff;padding:9px 11px}.run-outline-step.not_run{
opacity:.62}.run-outline-step span{font-size:11px;color:var(--muted);font-weight:800}
.run-outline-step strong{font-size:13px;line-height:1.4}.run-route-list{display:flex;gap:7px;
flex-wrap:wrap}.run-route{padding:7px 10px;border-radius:999px;background:#f1edff;
color:#503d91;font-size:12px;font-weight:800}.run-highlight-label{display:inline-flex;
padding:4px 7px;margin-bottom:8px;border-radius:999px;background:#e4e9ff;color:var(--blue);
font-size:11px;font-weight:800}.run-step-list{display:grid;gap:10px}.run-step{border:1px solid
var(--line);border-radius:10px;background:#fff;overflow:hidden}.run-step[open]{box-shadow:0 4px 16px #22345b12}
.run-step>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:13px 14px;
cursor:pointer;background:#fafbfe}.run-step>summary::-webkit-details-marker{display:none}.run-step-index{
display:grid;place-items:center;width:28px;height:28px;flex:0 0 28px;border-radius:50%;
background:#edf1ff;color:var(--blue);font-size:12px;font-weight:900}.run-step.completed .run-step-index{
background:#e3f5e9;color:#26734d}.run-step.current .run-step-index{background:var(--blue);color:#fff}
.run-step-title{min-width:0;flex:1}.run-step-title strong{display:block;font-size:14px}
.run-step-result{max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
font-size:12px;color:#3b465c}.run-step-state{font-size:12px;font-weight:800;color:#26734d}
.run-step.error{border-color:#e5a1a1}.run-step.error .run-step-state{color:#a21d1d}
.run-step.error .run-step-index{background:#ffe8e8;color:#a21d1d}
.run-step-body{display:grid;gap:14px;padding:15px}.run-detail-section{display:grid;gap:8px}
.run-detail-section h4{margin:0;font-size:13px;color:#3b465c}.run-field-list{display:grid}
.run-field{min-width:0;padding:14px 0;border-top:1px solid var(--line)}.run-field:first-child{
padding-top:0;border-top:0}.run-field-head{display:flex;align-items:flex-start;
justify-content:space-between;gap:16px;margin-bottom:8px}.run-field-head strong{font-size:13px}
.run-field-actions{display:flex;gap:7px;flex:0 0 auto}.run-field-actions .btn{
padding:5px 8px;font-size:11px}.run-source{font-size:12px;color:var(--blue);margin-top:3px}
.run-value-preview{white-space:pre-wrap;overflow-wrap:anywhere;
font:14px/1.65 Arial,"Noto Sans KR",sans-serif}.run-value-preview.is-code{
font:12px/1.55 Consolas,monospace}.run-value-preview.is-markdown{white-space:pre-wrap}
.run-value-preview.is-markdown .run-markdown-h1{font-size:1.55em}.run-value-preview.is-markdown
.run-markdown-h2{font-size:1.35em}.run-value-preview.is-markdown .run-markdown-h3{
font-size:1.18em}.run-value-preview.is-markdown .run-markdown-h4{font-size:1.1em}
.run-value-preview.is-markdown .run-markdown-h5{font-size:1em}.run-value-preview.is-markdown
.run-markdown-h6{font-size:.92em}.run-value-preview.is-markdown [class^="run-markdown-h"]{margin:10px 0 5px;
font-weight:800;line-height:1.35}.run-value-preview.is-markdown [class^="run-markdown-h"]:first-child{
margin-top:0}.run-value-preview.is-markdown code{padding:1px 4px;border-radius:4px;
background:#e9edf7;font:12px/1.5 Consolas,monospace}.run-value-preview.is-markdown
.run-markdown-blank{height:.7em}.run-value-preview.is-collapsed{display:-webkit-box;
-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden}.run-value-note{display:block;
margin-top:7px;font-size:12px;color:var(--muted)}.run-step-support{padding:0 12px;
border:1px solid var(--line);border-radius:8px;background:#fafbfe}.run-step-support>.run-field-list,
.run-step-support>.run-evidence{margin-bottom:12px}.run-evidence{padding:12px;
border-left:3px solid var(--blue);
background:#f5f7ff;border-radius:0 8px 8px 0}.run-evidence p{margin:0;white-space:pre-wrap;
line-height:1.55}.run-source-files{display:grid;gap:7px;margin-top:9px}.run-source-file{
padding:8px 9px;border:1px solid #cfd8f7;border-radius:7px;background:#fff}.run-source-file code{
display:block;font-size:12px;overflow-wrap:anywhere}.run-source-file span{display:block;margin-top:4px;
font-size:12px;color:var(--muted)}.run-handoffs{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.run-handoff{padding:4px 7px;border-radius:6px;background:#edf1ff;color:#304b9b;
font-size:11px;font-weight:700}.run-legacy-note{font-size:12px;color:var(--muted)}
.run-written-file{display:grid;gap:8px}.run-written-file-content{padding:13px 14px;
border:1px solid var(--line);border-radius:8px;background:#fafbfe}.run-written-file-path{
display:flex;align-items:baseline;gap:7px;color:var(--muted);font-size:11px}
.run-written-file-path code{font-size:11px;overflow-wrap:anywhere}.run-written-file .run-handoffs{
margin-top:0}
.run-file-preview-dialog{z-index:20}.run-file-preview-dialog>div{width:min(1100px,96vw);
height:min(86vh,900px);max-height:86vh;display:flex;flex-direction:column;overflow:hidden}
.run-file-preview-head{display:flex;flex:0 0 auto;align-items:flex-start;justify-content:space-between;
gap:16px;margin-bottom:12px}.run-file-preview-head h2{margin:0}.run-file-preview-path{
margin-top:4px;overflow-wrap:anywhere}.run-file-preview-scroll{flex:1;min-height:0;max-height:70vh;overflow:auto;
padding:18px;border:1px solid var(--line);border-radius:9px;background:#fafbfe}
.run-file-preview-scroll .run-value-preview{min-width:0}.run-file-preview-loading{
padding:32px;text-align:center;color:var(--muted)}
.run-agent-wait{min-height:250px;display:flex;flex-direction:column;align-items:center;
justify-content:center;text-align:center;padding:24px}.run-agent-wait h3{margin:0 0 8px}
.run-agent-wait .meta{max-width:620px}.run-agent-wait .spinner{margin-bottom:18px}
.run-agent-message{width:min(720px,100%);margin-top:18px;padding:14px 16px;
border:1px solid #cbd5ff;border-radius:10px;background:#f6f8ff;text-align:left}
.run-agent-message-label{display:block;margin-bottom:7px;color:var(--blue);font-size:12px;
font-weight:800}.run-agent-message p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;
line-height:1.6}.run-agent-message details{margin-top:9px}.run-agent-message summary{
cursor:pointer;color:var(--blue);font-size:13px;font-weight:800}.run-agent-message pre{
margin:9px 0 0;max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;
font:13px/1.6 inherit}
.busy>div{width:min(430px,90vw);text-align:center}.spinner{width:38px;height:38px;
margin:0 auto 16px;border:4px solid #dbe2ff;border-top-color:var(--blue);border-radius:50%;
animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:760px){.jobs{grid-template-columns:1fr}.top{padding:0 12px}.wrap{padding:0 10px}
.jobs-empty{flex-wrap:wrap}.jobs-empty-actions{width:100%;margin-left:0}
.jobs-empty .btn{width:100%;margin-left:0}.jobs-action{align-items:stretch;
flex-direction:column}.jobs-action .btn{width:100%}.run-list-row{align-items:flex-start;
flex-direction:column}.run-shell{min-height:auto}.run-head{gap:10px}.run-head h2{font-size:18px}
.run-progress-summary{align-items:flex-start;flex-direction:column;gap:6px}.run-progress-summary progress{
width:100%}.run-current{min-height:240px}.run-field-head{flex-direction:column;gap:8px}
.run-field-actions{width:100%}.run-field-actions .btn{flex:1}.run-step-result{display:none}
.runtime-input-tabs{width:100%}.runtime-input-tab{flex:1;padding:9px 8px}}
</style></head><body>
<header class="top"><h1>E2E-Automation</h1>
<nav class="tabs" role="tablist" aria-label="대시보드 화면">
<button class="tab" role="tab" aria-controls="creatorPanel"
data-tab="creator">Creator</button>
<button class="tab" role="tab" aria-controls="runnerPanel"
data-tab="runner">Runner</button></nav></header>
<main class="wrap"><section class="summary"><div><strong id="summaryTitle">프로젝트 현황</strong>
<div class="meta">프로젝트의 업무와 실행 기록을 불러왔습니다.</div></div>
<button class="btn" id="refresh">새로고침</button></section>
<section class="panel"><div class="panel-heading"><h2 id="assistantJobsTitle">Agent 작업</h2>
<span id="assistantConnectionStatus" class="connection-status">연결 끊김</span></div>
<div id="assistantJobsEmpty" class="jobs-empty hidden">
<span class="jobs-empty-mark disconnected" aria-hidden="true">!</span><div>
<strong id="assistantJobsEmptyTitle">Agent가 연결되어 있지 않습니다.</strong>
<span class="meta" id="assistantJobsEmptyHelp">Creator와 Runner의 Agent 작업을 계속 처리하려면
Agent를 다시 연결해 주세요.</span>
</div><div class="jobs-empty-actions">
<button class="btn primary" id="assistantEmptyCopy" data-copy=""
data-copy-message="assistantEmptyCopyMessage">Agent 재연결 요청문 복사</button>
<button class="btn hidden" data-watch-stop>연결 종료</button></div></div>
<span id="assistantEmptyCopyMessage" class="copy-success hidden" role="status"></span>
<div id="assistantJobsActive" class="hidden">
<p class="meta" id="assistantJobsHelp"></p>
<div class="jobs" id="assistantJobCards">
<div class="job" id="creatorJob"><strong>Creator에서 요청한 작업</strong>
<div id="creatorJobs" class="meta"></div></div>
<div class="job" id="runnerJob"><strong>Runner에서 요청한 작업</strong>
<div id="runnerJobs" class="meta"></div></div>
</div><div class="jobs-action">
<button class="btn primary" id="assistantJobCopy"
data-copy="" data-copy-message="assistantJobCopyMessage">Agent 재연결 요청문 복사</button>
<button class="btn hidden" data-watch-stop>연결 종료</button>
<span id="assistantJobCopyMessage" class="copy-success hidden" role="status"></span>
</div></div></section>
<section id="creatorPanel" class="panel"><h2>업무 목록</h2><div id="catalog"></div></section>
<section id="runnerPanel" class="panel hidden"><div id="runnerCatalog"></div></section>
</main><div id="dialog" class="dialog hidden"><div><button class="btn" id="closeDialog"
style="float:right">닫기</button><div id="dialogBody"></div></div></div>
<div id="runFilePreviewDialog" class="dialog run-file-preview-dialog hidden" role="dialog"
aria-modal="true" aria-labelledby="runFilePreviewTitle"><div>
<div class="run-file-preview-head"><div><h2 id="runFilePreviewTitle">파일 전체 보기</h2>
<div id="runFilePreviewPath" class="meta run-file-preview-path"></div></div>
<button class="btn" data-run-file-preview-close>닫기</button></div>
<div id="runFilePreviewContent" class="run-file-preview-scroll"></div></div></div>
<div id="busy" class="dialog busy hidden" role="status" aria-live="polite"><div>
<div class="spinner" aria-hidden="true"></div><h2 id="busyTitle">처리 중</h2>
<div id="busyMessage" class="meta"></div></div></div>
<script>
const CSRF=""" + json.dumps(csrf) + """;
let currentTab=""" + json.dumps(initial_tab) + """;
let catalog=null,jobs=null,lastLoadedAt=0,loadPromise=null,lastSignal=null;
let assistantWatch={connected:null,state:'unknown',domain:null};
let assistantWatchRefreshPromise=null,assistantWatchChecking=true;
let currentRunRef=null,currentRunSignature=null,runInputDirty=false;
let autoPresenceAt=Date.now();
let dialogReturnFocus=null;
let runFilePreviewReturnFocus=null;
let runFilePreviewRequestToken=0;
let operationPollToken=0;
let dashboardEventSource=null,runRefreshPromise=null,autoTickBusy=false;
let currentAgentMessage=null,runnerMessageExpanded=false,runValueSequence=0;
const AUTO_REFRESH_MS=3000,AUTO_PRESENCE_MS=30*60*1000;
// 진행 폴링 — 고정 500ms 무한 반복이었다. 점점 늘리고, 오래 걸리면 빠져나갈 길을 준다.
const OP_POLL_MIN_MS=500,OP_POLL_MAX_MS=2000,OP_SLOW_MS=15000;
function closeDialog(){operationPollToken+=1;$('#dialog').classList.add('hidden');
currentRunRef=null;currentRunSignature=null;runInputDirty=false;
const back=dialogReturnFocus;dialogReturnFocus=null;
if(back&&document.contains(back)&&typeof back.focus==='function'){try{back.focus()}catch(_e){}}}
function closeRunFilePreview(){runFilePreviewRequestToken+=1;
const dialog=$('#runFilePreviewDialog');dialog.classList.add('hidden');
$('#runFilePreviewContent').innerHTML='';const back=runFilePreviewReturnFocus;
runFilePreviewReturnFocus=null;if(back&&document.contains(back)&&typeof back.focus==='function'){
try{back.focus()}catch(_e){}}}
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',
'"':'&quot;',"'":'&#39;'}[c]));
function idem(prefix){return 'dashboard-'+prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
// reason_code는 기계용 식별자다. 화면에는 한국어 문구만 내보내고, 원본 코드와
// 진단용 detail은 콘솔로 보낸다.
const REASON_TEXT={
csrf_failed:'보안 토큰이 만료되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
dashboard_session_required:'세션이 만료되었습니다. 화면을 새로고침해 주세요.',
session_cookie_required:'세션이 만료되었습니다. 화면을 새로고침해 주세요.',
expired_session:'세션이 만료되었습니다. 화면을 새로고침해 주세요.',
expired_author_session:'편집 세션이 만료되었습니다. 업무 설정을 다시 열어 주세요.',
creator_author_session_lost:'편집 세션이 끊어졌습니다. 업무 설정을 다시 열어 주세요.',
invalid_host:'허용되지 않은 주소로 접속했습니다. 대시보드 주소로 다시 열어 주세요.',
invalid_origin:'허용되지 않은 출처의 요청입니다. 대시보드 주소로 다시 열어 주세요.',
browser_origin_forbidden:'허용되지 않은 출처의 요청입니다. 대시보드 주소로 다시 열어 주세요.',
invalid_body_size:'요청 내용이 너무 큽니다. 입력을 줄여 다시 시도해 주세요.',
invalid_json:'요청 형식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
json_required:'요청 형식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
json_object_required:'요청 형식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
post_required:'요청 형식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
invalid_request:'요청 형식이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
not_found:'대상을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
operation_not_found:'진행 중이던 작업 정보를 찾을 수 없습니다. 목록을 새로고침해 주세요.',
project_mutation_busy:'다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.',
resource_mutation_busy:'같은 작업을 저장하고 있습니다. 잠시 후 자동으로 다시 확인해 주세요.',
idempotency_uncertain:'이전 요청의 반영 여부를 현재 실행 상태에서 확인해 주세요.',
stale_revision:'화면에 표시된 내용이 최신이 아닙니다. 새로고침한 뒤 다시 시도해 주세요.',
stale_task_revision:'업무 설정이 그 사이 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.',
missing_revision:'화면이 최신 상태가 아닙니다. 새로고침한 뒤 다시 시도해 주세요.',
missing_task_fingerprint:'업무 정보가 최신이 아닙니다. 새로고침한 뒤 다시 시도해 주세요.',
duplicate_run_key:'이미 사용 중인 업무 식별자입니다. 다른 값을 입력해 주세요.',
task_setup_incomplete:'Creator에서 업무 설정을 완료한 뒤 실행해 주세요.',
yaml_task_required:'YAML에서 만든 Task만 처음부터 다시 만들 수 있습니다.',
task_delete_confirmation_mismatch:'Task 이름을 정확히 입력해 주세요.',
task_operation_running:'이 Task의 작업이 진행 중입니다. 완료된 뒤 다시 시도해 주세요.',
creator_stop_pending:'Creator 화면을 정리하고 있습니다. 잠시 후 다시 시도해 주세요.',
invalid_run_key:'업무 식별자 형식이 올바르지 않습니다.',
invalid_idempotency_key:'요청 식별자가 올바르지 않습니다. 다시 시도해 주세요.',
task_validation_failed:'업무 검증에 실패했습니다. 검증 결과를 확인해 주세요.',
creator_start_timeout:'Creator를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
creator_process_start_failed:'Creator를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
creator_process_exited:'Creator가 예기치 않게 종료되었습니다. 다시 열어 주세요.',
creator_worker_failed:'Creator 처리 중 문제가 발생했습니다. 다시 시도해 주세요.',
creator_idle_timeout:'Creator가 대기 시간을 넘겨 종료되었습니다. 다시 열어 주세요.',
creator_browser_open_failed:'브라우저 창을 열지 못했습니다. 표시된 주소를 직접 열어 주세요.',
creator_command_failed:'Creator 요청을 처리하지 못했습니다. 다시 시도해 주세요.',
runner_command_failed:'Runner 요청을 처리하지 못했습니다. 다시 시도해 주세요.',
runner_draining:'실행이 정리 중입니다. 잠시 후 다시 시도해 주세요.',
runner_transport_failed:'실행 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.',
runner_transport_uncertain:'응답을 확인하지 못했습니다. 새로고침해 상태를 확인해 주세요.',
runner_protocol_error:'실행 서버 응답을 해석하지 못했습니다. 다시 시도해 주세요.',
runner_protocol_failed:'실행 서버 응답을 해석하지 못했습니다. 다시 시도해 주세요.',
dashboard_command_failed:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
dashboard_operation_failed:'작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
dashboard_operation_interrupted:'이전 Dashboard가 종료되어 작업이 중단되었습니다. 다시 시도해 주세요.',
dashboard_app_failed:'대시보드 처리 중 문제가 발생했습니다. 새로고침해 주세요.',
agent_jobs_failed:'Agent 작업 목록을 불러오지 못했습니다. 새로고침해 주세요.',
agent_job_snapshot_failed:'Agent 작업 상태를 확인하지 못했습니다. 새로고침해 주세요.',
draft_generation_failed:'AI 초안 생성에 실패했습니다. 다시 시도해 주세요.',
draft_generation_unavailable:'지금은 AI 초안을 만들 수 없습니다. Agent 연결을 확인해 주세요.',
prompt_file_conflict:'프롬프트 파일이 그 사이 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.',
stale_prompt_file:'프롬프트 파일이 최신이 아닙니다. 새로고침한 뒤 다시 시도해 주세요.',
node_test_not_found:'노드 테스트 정보를 찾을 수 없습니다. 다시 실행해 주세요.',
node_test_unavailable:'지금은 노드 테스트를 실행할 수 없습니다.',
invalid_control_token:'요청 토큰이 올바르지 않습니다. 화면을 새로고침해 주세요.',
used_or_invalid_token:'이미 사용했거나 만료된 요청입니다. 화면을 새로고침해 주세요.',
interrupted:'작업이 중단되었습니다. 상태를 확인한 뒤 다시 시도해 주세요.',
auto_step_limit:'자동 진행 한도에 도달했습니다. 상태를 확인해 주세요.',
unknown_node:'대상 노드를 찾을 수 없습니다. 새로고침해 주세요.',
wrong_task:'다른 업무의 요청입니다. 새로고침해 주세요.',
file_preview_not_found:'파일을 찾거나 읽을 수 없습니다.',
file_preview_not_text:'UTF-8 텍스트 파일만 대시보드에서 열 수 있습니다.',
file_preview_too_large:'10MiB를 넘는 파일은 대시보드에서 열 수 없습니다.'};
function reasonMessage(value,fallback){
const info=value&&typeof value==='object'?value:{};
const code=info.reason_code;
if(info.detail||info.reason||code)console.warn('[dashboard]',code||'(no code)',info.detail||info.reason||'');
// status:error의 reason은 Controller가 보존한 예외 문자열일 수 있으므로 화면에 쓰지 않는다.
if(info.status==='error')return REASON_TEXT[code]||fallback||'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
// 서버가 사람이 읽을 문구를 준 경우에만 그대로 쓴다 — 영문 코드는 걸러낸다.
if(typeof info.reason==='string'&&info.reason&&!/^[a-z0-9_]+$/.test(info.reason))return info.reason;
return REASON_TEXT[code]||fallback||'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'}
async function get(url){const r=await fetch(url,{cache:'no-store'});const value=await r.json();
if(!r.ok||value?.status==='error'){const error=new Error(reasonMessage(value,'요청 실패'));
error.terminal=true;throw error}return value}
async function post(url,body){const r=await fetch(url,{method:'POST',
headers:{'Content-Type':'application/json','X-Ops-CSRF':CSRF},body:JSON.stringify(body)});
const value=await r.json();if(!r.ok&&(value.reason_code==='csrf_failed'
||value.reason_code==='dashboard_session_required')){window.location.reload();
return new Promise(()=>{})}
if(!r.ok||value?.status==='error')throw new Error(reasonMessage(value,'요청 실패'));return value}
function badge(text,state){let c='badge';if(/오류|변경|필요/.test(text))c+=' warn';
if(state==='invalid'||state==='error')c+=' err';return `<span class="${c}">${esc(text)}</span>`}
function canValidateTask(task){return task.validation_state==='valid'||task.validation_state==='invalid'}
function validationMessages(result,groupNames,fallback){
const groups=result.groups||{};let messages=[];
groupNames.forEach(name=>{messages=messages.concat((groups[name]?.issues||[]).map(
issue=>issue?.message||issue).filter(Boolean))});
return messages.length?messages:(fallback||[])}
function validationNodeLabels(result){const labels={};
(result.rehearsal||[]).forEach(step=>{if(step?.node&&step?.label)labels[step.node]=step.label});
return labels}
function presentValidationMessage(message,labels){let text=String(message??'');
Object.keys(labels).sort((a,b)=>b.length-a.length).forEach(
id=>{text=text.split('['+id+']').join(labels[id])});return text}
function validationList(title,messages,labels){if(!messages.length)return '';
return `<section class="validation-section"><h3>${esc(title)} ${messages.length}건</h3>
<ul class="validation-list">${messages.map(
message=>`<li>${esc(presentValidationMessage(message,labels))}</li>`).join('')}</ul></section>`}
function validationResultHtml(result){const labels=validationNodeLabels(result);
const errors=validationMessages(result,['structure','incomplete'],result.errors);
const warnings=validationMessages(result,['advisory'],result.warnings);
const rehearsal=result.rehearsal||[];const passed=result.ok===true;
return `<div class="validation-result"><h2>${passed?'검증 통과':'검증 실패'}</h2>
<div class="notice ${passed?'':'error'}">${passed
?'업무를 실행할 수 있는 상태입니다.'
:'아래 항목을 수정한 뒤 다시 검증해 주세요.'}</div>
${validationList('오류',errors,labels)}
${validationList('권고사항',warnings,labels)}
${rehearsal.length?`<section class="validation-section"><h3>실행 흐름 ${rehearsal.length}단계</h3>
<div class="validation-flow">${rehearsal.map((step,index)=>`<div class="validation-step">
<strong>${index+1}. ${esc(step.label||'이름 없는 단계')}</strong>
${step.detail?`<div class="meta">${esc(step.detail)}</div>`:''}</div>`).join('')}</div></section>`:''}
</div>`}
function assistantWatchSignature(){return JSON.stringify([
assistantWatch.connected===true,assistantWatch.state||'',assistantWatch.domain||'',
assistantWatch.dashboard_generation||'',assistantWatch.watch_epoch||0,
assistantWatch.active_job?.run_ref||'',assistantWatch.active_job?.job_id||''])}
async function refreshAssistantWatch(){if(assistantWatchRefreshPromise)return assistantWatchRefreshPromise;
assistantWatchRefreshPromise=(async()=>{try{const signal=await get('/api/signal');
if(signal.status==='ok'){assistantWatch=signal.assistant_watch||assistantWatch;
lastSignal=signal.signature;assistantWatchChecking=false;renderAssistantJobs()}return signal}
catch(_error){return null}})();try{return await assistantWatchRefreshPromise}
finally{assistantWatchRefreshPromise=null}}
function allTasks(){let out=[];(catalog.workflows||[]).forEach(w=>(w.tasks||[]).forEach(t=>out.push(t)));
return out.concat(catalog.standalone_tasks||[])}
function taskCard(t,runner=false,w=null,setupRequired=false){const exists=!!t.task_ref;let buttons='';
const validateButton=canValidateTask(t)
?`<button class="btn" data-validate="${esc(t.task_ref)}">검증</button>`:'';
if(!exists){buttons=`<button class="btn" data-create="${esc(w.yaml_ref)}"
data-yaml-fp="${esc(w.yaml_fingerprint)}" data-task="${esc(t.id)}">Agent 만들기</button>`}
else if(runner&&setupRequired){buttons=`<button class="btn" data-open="${esc(t.task_ref)}"
data-intent="author">Creator에서 설정 계속하기</button>`}
else if(runner){buttons=`<button class="btn primary" data-runs="${esc(t.task_ref)}">실행</button>
${validateButton}`}
else{buttons=`<button class="btn" data-open="${esc(t.task_ref)}"
data-intent="${t.author_stage==='ready_to_validate'?'revise':'author'}">${t.author_stage==='ready_to_validate'?'수정':'계속 작성'}</button>
${validateButton}${w?`<button class="btn danger" data-task-delete="${esc(t.task_ref)}">Task 삭제</button>`:''}`}
const taskName=t.name||t.task_name||t.id;
const displayName=Number(t.display_index)>0?`${Number(t.display_index)}. ${taskName}`:taskName;
return `<article class="card${setupRequired?' setup-required':''}"><h3>${esc(displayName)}</h3>
<div class="meta task-ref"${t.task_ref?'':' aria-hidden="true"'}>${t.task_ref?esc(t.task_ref):'&nbsp;'}</div>
<div class="badges">
${badge(setupRequired?'설정 완료 필요':t.author_label||'Agent 미생성',t.author_state)}
${badge(t.run_label||'실행 이력 없음',t.run_state)}</div><div class="actions">${buttons}</div></article>`}
function render(){const cp=$('#catalog'),rp=$('#runnerCatalog');cp.innerHTML='';rp.innerHTML='';
(catalog.workflows||[]).forEach(w=>{const h=document.createElement('div');h.className='workflow';
h.innerHTML=`<h3>${esc(w.yaml_ref)}</h3><div class="grid">${(w.tasks||[]).map(t=>taskCard(t,false,w)).join('')}</div>`;
cp.appendChild(h)});if((catalog.standalone_tasks||[]).length){const h=document.createElement('div');
h.className='workflow';h.innerHTML=`<h3>독립 업무</h3><div class="grid">${catalog.standalone_tasks.map(t=>taskCard(t)).join('')}</div>`;
cp.appendChild(h)}const runnerTasks=allTasks().filter(t=>t.task_ref);
const runnable=runnerTasks.filter(t=>t.author_stage==='ready_to_validate');
const setupRequired=runnerTasks.filter(t=>t.author_stage!=='ready_to_validate');
rp.innerHTML=`<section class="runner-section"><div class="runner-section-head">
<h2>실행 가능한 업무</h2><div class="meta">설정이 완료된 업무입니다. 검증 결과와 관계없이 실행할 수 있습니다.</div></div>
${runnable.length?`<div class="grid">${runnable.map(t=>taskCard(t,true)).join('')}</div>`
:'<div class="empty">현재 실행 가능한 업무가 없습니다.</div>'}</section>
${setupRequired.length?`<section class="runner-section"><div class="runner-section-head">
<h2>설정이 필요한 업무</h2><div class="meta">Creator에서 설정을 마치면 실행 가능한 업무로 이동합니다.</div></div>
<div class="grid">${setupRequired.map(t=>taskCard(t,true,null,true)).join('')}</div></section>`:''}`;
$('#summaryTitle').textContent=`워크플로 ${catalog.summary?.workflow_count||0}개 · 업무 ${allTasks().length}개`;
bindActions()}
function bindActions(){document.querySelectorAll('[data-create]').forEach(b=>b.onclick=async()=>{
const target=openLoadingWindow();
showBusy('Agent를 만들고 있습니다.','완료되면 노드 구성 화면이 새 창에서 열립니다.');
try{const r=await post('/api/task/create',{yaml_ref:b.dataset.create,task_id:b.dataset.task,
expected_yaml_fingerprint:b.dataset.yamlFp,idempotency_key:idem('create')});
const a=r.author||{};if(a.url){openAuthorResult(target,a.url);await load(false)}
else{closeLoadingWindow(target);alert('AI 초안 처리가 필요합니다. Creator 대기 작업을 처리해 주세요.');await load(false)}}
catch(e){closeLoadingWindow(target);alert(e.message)}finally{hideBusy()}});
document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>
guarded(b,'업무 설정을 여는 중입니다.','노드 구성 화면을 준비하고 있습니다.',async()=>{
try{const a=await post('/api/task/open',{task_ref:b.dataset.open,intent:b.dataset.intent});
if(a.url)location.href=a.url;else{alert('AI 초안 처리가 필요합니다. Creator 대기 작업을 처리해 주세요.');load(false)}}
catch(e){alert(e.message)}}));
document.querySelectorAll('[data-validate]').forEach(b=>b.onclick=()=>
guarded(b,'업무를 검증하고 있습니다.','노드 설정과 참고자료를 확인하고 리허설을 진행합니다.',async()=>{
try{const r=await post('/api/task/validate',{task_ref:b.dataset.validate});
if(r.status==='error')throw new Error(reasonMessage(r,'검증 요청 실패'));
showDialog(validationResultHtml(r));load(false)}catch(e){alert(e.message)}}));
document.querySelectorAll('[data-task-delete]').forEach(b=>b.onclick=()=>
guarded(b,'삭제 범위를 확인하고 있습니다.','Task와 연결된 실행 기록을 찾고 있습니다.',async()=>{
try{const p=await get('/api/task/delete-preview?task_ref='+encodeURIComponent(b.dataset.taskDelete));
if(p.status!=='ok')throw new Error(reasonMessage(p,'삭제 범위를 확인하지 못했습니다.'));
showTaskDeleteDialog(p)}catch(e){alert(e.message)}}));
document.querySelectorAll('[data-runs]').forEach(b=>b.onclick=()=>
guarded(b,'실행 목록을 불러오고 있습니다.','기존 실행 기록을 확인하고 있습니다.',
()=>showRuns(b.dataset.runs).catch(e=>alert(reasonMessage(e,e.message)))))}
function showTaskDeleteDialog(p){const c=p.delete_counts||{};
const dependents=(p.dependent_tasks||[]).map(item=>`<li>${esc(item.task_name||'이름 없는 Task')}</li>`).join('');
showDialog(`<h2>Task를 처음부터 다시 만들기</h2>
<div class="task-delete-warning"><strong>이 작업은 되돌릴 수 없습니다.</strong>
<div>Task 설정과 모든 실행 기록을 영구 삭제합니다.</div>
${dependents?`<div style="margin-top:10px"><strong>이 Task의 결과를 사용하는 후행 Task</strong>
<ul>${dependents}</ul><div class="meta">후행 Task는 삭제하지 않으며, 재생성 전에는 예시 데이터로 개발할 수 있습니다.</div></div>`:''}</div>
<div class="task-delete-scope">
<div><span class="meta">Task 설정</span><strong>${c.task||0}개</strong></div>
<div><span class="meta">실행 기록</span><strong>${c.runs||0}개</strong></div>
<div><span class="meta">판단 Prompt</span><strong>${c.prompt_folders||0}개</strong></div>
<div><span class="meta">Custom Logic</span><strong>${c.custom_logic_folders||0}개</strong></div>
<div><span class="meta">로컬 작업 상태</span><strong>${c.local_state||0}개</strong></div>
<div><span class="meta">공유 자원 보존</span><strong>${p.preserved_shared_assets||0}개</strong></div></div>
<div class="task-delete-confirm"><label for="taskDeleteName">확인을 위해 Task 이름을 입력해 주세요.</label>
<div class="meta">입력할 이름: <code>${esc(p.task_name)}</code></div>
<input id="taskDeleteName" autocomplete="off" placeholder="Task 이름 입력">
<button class="btn danger" id="confirmTaskDelete" disabled>완전히 삭제</button></div>`);
const input=$('#taskDeleteName'),confirm=$('#confirmTaskDelete');
input.addEventListener('input',()=>{confirm.disabled=input.value!==p.task_name});
confirm.onclick=()=>guarded(confirm,'Task를 삭제하고 있습니다.','설정과 실행 기록을 안전하게 정리하고 있습니다.',async()=>{
try{const result=await post('/api/task/delete',{task_ref:p.task_ref,
expected_task_fingerprint:p.task_fingerprint,confirmation_task_name:input.value,
idempotency_key:idem('task-delete')});
if(result.status!=='ok')throw new Error(reasonMessage(result,'Task를 삭제하지 못했습니다.'));
await load(false);showDialog(`<h2>Task 삭제 완료</h2>
<div class="notice">${esc(p.task_name)} Task를 삭제했습니다.</div>
<div class="meta">업무 카드가 ‘Agent 미생성’ 상태로 돌아갔습니다. ‘Agent 만들기’를 눌러 처음부터 다시 구현할 수 있습니다.</div>
<div class="runtime-actions"><button class="btn primary" id="finishTaskDelete">확인</button></div>`);
$('#finishTaskDelete').onclick=closeDialog}catch(e){alert(e.message)}})}
// 느린 동작에는 진행 표시를 띄우고 버튼을 잠근다 — 예전에는 눌러도 아무 반응이
// 없어 같은 작업을 두세 번 실행시키기 쉬웠다.
async function guarded(button,title,message,run){
if(button&&button.disabled)return;
if(button)button.disabled=true;
showBusy(title,message);
try{return await run()}
finally{hideBusy();if(button)button.disabled=false}}
function showBusy(title,message){$('#busyTitle').textContent=title;$('#busyMessage').textContent=message;
$('#busy').classList.remove('hidden')}
function hideBusy(){$('#busy').classList.add('hidden')}
function openLoadingWindow(){const target=window.open('','_blank');if(!target)return null;
try{target.document.title='Agent 생성 중';target.document.body.innerHTML=
'<main style="font-family:Arial,sans-serif;padding:48px;text-align:center"><h1 style="font-size:22px">Agent를 만들고 있습니다…</h1><p style="color:#657087">완료되면 노드 구성 화면으로 이동합니다.</p></main>'}
catch(_error){}return target}
function closeLoadingWindow(target){if(target&&!target.closed)target.close()}
function openAuthorResult(target,url){if(target&&!target.closed){target.opener=null;target.location.replace(url)}
else{location.href=url}}
function startCatalogLoading(){const messages=[
'프로젝트에서 YAML/YML 파일을 찾고 있습니다.',
'워크플로 형식을 확인하고 업무 목록을 읽고 있습니다.',
'기존 업무 설정 파일과 실행 상태를 연결하고 있습니다.'
];let index=0;showBusy('프로젝트를 불러오고 있습니다.',messages[index]);
const timer=setInterval(()=>{$('#busyMessage').textContent=messages[Math.min(++index,messages.length-1)]},700);
return()=>clearInterval(timer)}
function renderAssistantJobs(){if(!jobs)return;
const creatorCount=jobs.creator?.job_count||0,runnerCount=jobs.runner?.job_count||0;
const totalCount=creatorCount+runnerCount;
const watchConnected=assistantWatch.connected===true;
const watchChecking=assistantWatchChecking&&!watchConnected;
const workLabel=creatorCount&&runnerCount?'Creator와 Runner'
:creatorCount?'Creator':runnerCount?'Runner':'Creator와 Runner';
const watchProcessing=watchConnected&&assistantWatch.state==='processing';
const waitingForChange=watchConnected&&assistantWatch.waiting_for_change===true;
$('#assistantJobsTitle').textContent=watchChecking?'Agent 연결 상태를 확인하고 있습니다'
:watchConnected&&watchProcessing&&totalCount
?`Agent가 ${workLabel} 작업 ${totalCount}개를 처리하고 있습니다`
:totalCount&&!watchConnected
?`처리를 기다리는 Agent 작업이 ${totalCount}개 있습니다.`
:'Agent 작업';
$('#assistantConnectionStatus').textContent=watchChecking?'연결 확인 중'
:watchConnected?'연결됨':'연결 끊김';
$('#assistantConnectionStatus').classList.toggle('connected',watchConnected);
$('#assistantJobsEmpty').classList.toggle('hidden',totalCount!==0);
$('#assistantJobsActive').classList.toggle('hidden',totalCount===0);
$('#assistantJobsEmptyTitle').textContent=watchChecking?'Agent 연결 상태 확인 중'
:watchConnected?'Agent 연결 유지 중':'Agent가 연결되어 있지 않습니다.';
$('#assistantJobsEmptyHelp').textContent=watchChecking?'연결 상태를 다시 확인하고 있습니다.'
:watchConnected?'필요한 Agent 작업이 생기면 자동으로 이어서 처리합니다.'
:'Creator와 Runner의 Agent 작업을 계속 처리하려면 Agent를 다시 연결해 주세요.';
$('#assistantJobsHelp').textContent=watchChecking?'연결 상태를 다시 확인하고 있습니다.'
:watchConnected
?(waitingForChange?'대시보드 입력이 변경되면 이 작업을 자동으로 다시 처리합니다.'
:watchProcessing?'요청문을 다시 복사할 필요가 없습니다.'
:'필요한 Agent 작업이 생기면 자동으로 이어서 처리합니다.')
:'작업을 계속하려면 Agent를 다시 연결해 주세요.';
$('#creatorJobs').textContent=`처리할 작업 ${creatorCount}개`;
$('#runnerJobs').textContent=`처리할 작업 ${runnerCount}개`;
$('#creatorJob').classList.toggle('hidden',creatorCount===0);
$('#runnerJob').classList.toggle('hidden',runnerCount===0);
$('#assistantJobCards').classList.toggle('single',(creatorCount>0)!==(runnerCount>0));
const reconnectPrompt=`e2e-agent-creator와 e2e-agent-runner 스킬을 사용해서 현재 프로젝트 대시보드의 ${workLabel} AI 작업을 모두 처리하고, 처리 후 Creator와 Runner 작업을 자동으로 이어갈 수 있도록 대시보드 연결 대기를 시작해줘`;
$('#assistantJobCopy').dataset.copy=reconnectPrompt;
$('#assistantEmptyCopy').dataset.copy=reconnectPrompt;
$('#assistantJobCopy').classList.toggle('hidden',watchConnected||watchChecking);
$('#assistantJobCopy').disabled=watchConnected||watchChecking;
$('#assistantEmptyCopy').classList.toggle('hidden',watchConnected||watchChecking);
$('#assistantEmptyCopy').disabled=watchConnected||watchChecking;
$('.jobs-empty-mark').textContent=watchChecking?'…':watchConnected?'✓':'!';
$('.jobs-empty-mark').classList.toggle('disconnected',!watchConnected&&!watchChecking);
document.querySelectorAll('[data-watch-stop]').forEach(button=>{
button.classList.toggle('hidden',watchChecking||!watchConnected||watchProcessing);button.disabled=false})}
async function load(showLoading=false){if(loadPromise)return loadPromise;loadPromise=(async()=>{
const stopLoading=showLoading?startCatalogLoading():()=>{};$('#refresh').disabled=true;
try{const loaded=await Promise.all([get('/api/catalog'),get('/api/jobs'),refreshAssistantWatch()]);
catalog=loaded[0];jobs=loaded[1];render();renderAssistantJobs();
$('#assistantJobCopyMessage').textContent='';
$('#assistantJobCopyMessage').classList.add('hidden');
$('#assistantEmptyCopyMessage').textContent='';
$('#assistantEmptyCopyMessage').classList.add('hidden');lastLoadedAt=Date.now()}
finally{stopLoading();if(showLoading)hideBusy();$('#refresh').disabled=false;loadPromise=null}})();return loadPromise}
function switchTab(tab){currentTab=tab;document.querySelectorAll('.tab').forEach(b=>{
const selected=b.dataset.tab===tab;b.classList.toggle('active',selected);
b.setAttribute('aria-selected',String(selected))});
$('#creatorPanel').classList.toggle('hidden',tab!=='creator');$('#runnerPanel').classList.toggle('hidden',tab!=='runner');
history.replaceState(null,'','/dashboard?tab='+tab)}
function runMarkdown(text){let budget=5000;
const inline=value=>{const source=String(value??'');if(budget<=0)return esc(source);
const tokenPattern=/(`[^`\\n]+`)|\\*\\*(.+?)\\*\\*|__(.+?)__/g;
let result='';let cursor=0;let token;
while(budget>0&&(token=tokenPattern.exec(source))){result+=esc(source.slice(cursor,token.index));
if(token[1])result+=`<code>${esc(token[1].slice(1,-1))}</code>`;
else result+=`<strong>${esc(token[2]??token[3])}</strong>`;
budget-=1;cursor=token.index+token[0].length}
return result+esc(source.slice(cursor))};
const source=String(text??'').replace(/\\r\\n?/g,'\\n');
const headingPattern=/^ {0,3}(#{1,6})(?:[ \\t]+([^\\n]*?))?[ \\t]*(?:\\n|$)/gm;
let result='';let cursor=0;let heading;
while(budget>0&&(heading=headingPattern.exec(source))){result+=inline(source.slice(cursor,heading.index));
if(budget<=0)return result+esc(source.slice(heading.index));
const level=heading[1].length;const content=(heading[2]||'').replace(/(?:^|[ \\t]+)#+[ \\t]*$/,'');
budget-=1;
result+=`<div class="run-markdown-h${level}">${inline(content)}</div>`;
cursor=heading.index+heading[0].length}
return result+inline(source.slice(cursor))}
function runDisplayValue(value){if(!value)return '<span class="run-legacy-note">실행 당시 값 미리보기가 없습니다.</span>';
const text=String(value.text??'');const code=value.kind&&value.kind!=='text';
const markdown=value.markdown===true;
const expandable=!value.file_preview&&(value.truncated||text.length>240||text.split('\\n').length>5);
const collapsed=!!value.file_preview||expandable;
const valueId=`runValue-${++runValueSequence}`;
const openLabel='더 보기';
const closeLabel='접기';
const fullView=expandable?`<button class="btn" data-run-value-toggle data-open-label="${openLabel}"
data-close-label="${closeLabel}" aria-controls="${valueId}" aria-expanded="false">${openLabel}</button>`:'';
return `<div id="${valueId}" class="run-value-preview ${collapsed?'is-collapsed ':''}${code?'is-code ':''}${markdown?'is-markdown':''}">${markdown?runMarkdown(text):esc(text)}</div>
${fullView?`<div class="run-field-actions">${fullView}</div>`:''}
${value.truncated?'<span class="run-value-note">일부 내용만 표시했습니다.</span>':''}`}
function runSourceLabel(source){if(!source)return '출처 기록 없음';
return [source.node,source.output].filter(Boolean).join(' · ')}
async function openRunFilePreview(fileId,button){if(!currentRunRef||!fileId)return;
const requestToken=++runFilePreviewRequestToken;
runFilePreviewReturnFocus=button||document.activeElement;const dialog=$('#runFilePreviewDialog');
$('#runFilePreviewTitle').textContent='파일 전체 보기';$('#runFilePreviewPath').textContent='';
$('#runFilePreviewContent').innerHTML='<div class="run-file-preview-loading">파일을 불러오고 있습니다…</div>';
dialog.classList.remove('hidden');try{const result=await get('/api/run/file-preview?run_ref='
+encodeURIComponent(currentRunRef)+'&file_id='+encodeURIComponent(fileId));
if(requestToken!==runFilePreviewRequestToken||dialog.classList.contains('hidden'))return;
$('#runFilePreviewTitle').textContent=result.name||'파일 전체 보기';
$('#runFilePreviewPath').textContent=result.path||'';const text=String(result.text??'');
const markdown=result.markdown===true;$('#runFilePreviewContent').innerHTML=
`<div class="run-value-preview ${markdown?'is-markdown':'is-code'}">${markdown?runMarkdown(text):esc(text)}</div>`}
catch(error){if(requestToken!==runFilePreviewRequestToken||dialog.classList.contains('hidden'))return;
$('#runFilePreviewContent').innerHTML=`<div class="notice error">${esc(error.message)}</div>`}
if(requestToken!==runFilePreviewRequestToken||dialog.classList.contains('hidden'))return;
const close=dialog.querySelector('[data-run-file-preview-close]');if(close)close.focus()}
function runEvidenceHtml(evidence){if(!evidence)return '';
const outputReasons=(evidence.outputs||[]).map(item=>`<div class="run-field">
<strong>${esc(item.name)}</strong><div>${esc(item.reason)}</div></div>`).join('');
const sources=(evidence.sources||[]).map(item=>{const lines=item.line_start
?` · ${item.line_start}${item.line_end&&item.line_end!==item.line_start?'-'+item.line_end:''}행`:'';
return `<div class="run-source-file"><code>${esc(item.path)}${esc(lines)}</code>
<span>${esc(item.reason)}</span></div>`}).join('');
return `<div class="run-evidence">
${evidence.summary?`<p>${esc(evidence.summary)}</p>`:''}
${outputReasons?`<div class="run-field-list" style="margin-top:10px">${outputReasons}</div>`:''}
${sources?`<div class="run-source-files">${sources}</div>`:''}</div>`}
function runFieldHtml(item,output=false){const handoffs=output?(item.handoffs||[]).map(target=>
`<span class="run-handoff">다음 단계에서 사용: ‘${esc(target.node)}’의 ‘${esc(target.field)}’</span>`).join(''):'';
const filePreview=item.file_preview?`<div class="run-field-actions"><button class="btn"
data-run-file-preview="${esc(item.file_preview.id)}">전체 보기</button></div>`:'';
return `<div class="run-field"><div class="run-field-head"><div><strong>${esc(item.name)}</strong>
${output?'':`<div class="run-source">${esc(runSourceLabel(item.source))}</div>`}</div></div>
${runDisplayValue(item.file_preview?{...(item.value||{}),file_preview:item.file_preview}:item.value)}
${filePreview}${handoffs?`<div class="run-handoffs">${handoffs}</div>`:''}</div>`}
function runWrittenFileHtml(file){if(!file)return '';
const handoffs=(file.handoffs||[]).map(target=>
`<span class="run-handoff">다음 단계에서 사용: ‘${esc(target.node)}’의 ‘${esc(target.field)}’</span>`).join('');
const markdown=/\\.(?:md|markdown)$/i.test(file.path||'');
const value={...(file.value||{}),markdown,file_preview:file.file_preview};
const filePreview=file.file_preview?`<div class="run-field-actions"><button class="btn"
data-run-file-preview="${esc(file.file_preview.id)}">전체 보기</button></div>`:'';
return `<div class="run-detail-section run-written-file"><h4>작성한 내용</h4>
<div class="run-written-file-content">${runDisplayValue(value)}</div>
${filePreview}
<div class="run-written-file-path"><span>파일 경로</span><code>${esc(file.path||'-')}</code></div>
${handoffs?`<div class="run-handoffs">${handoffs}</div>`:''}</div>`}
function runTimeLabel(value){if(!value)return '';
const date=new Date(value);if(Number.isNaN(date.getTime()))return `${esc(value)} 완료`;
return `${new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date)} 완료`}
function runCurrentContext(r){const step=(r.presentation?.steps||[]).find(item=>item.state==='current');
const inputs=step?.inputs||[];if(!inputs.length)return '';
return `<details class="run-current-context"><summary><span class="run-disclosure-copy">
<strong>이번 단계에서 참고하는 정보</strong><small>실행에 사용할 입력 ${inputs.length}개</small></span>
<span class="run-disclosure-action" aria-hidden="true"><span class="run-disclosure-closed">입력 내용 보기</span>
<span class="run-disclosure-open">입력 내용 접기</span><span class="run-disclosure-chevron">⌄</span></span>
</summary><div class="run-field-list">${inputs.map(item=>runFieldHtml(item)).join('')}</div></details>`}
function runStepHtml(step,index){const open=step.state==='completed'||step.state==='error';
const inputs=(step.inputs||[]).map(item=>runFieldHtml(item)).join('');
const writtenFile=runWrittenFileHtml(step.written_file);
const outputs=(step.outputs||[]).map(item=>{const handoffs=(item.handoffs||[]).map(target=>
`<span class="run-handoff">다음 단계에서 사용: ‘${esc(target.node)}’의 ‘${esc(target.field)}’</span>`).join('');
return `<div class="run-field"><div class="run-field-head"><strong>${esc(item.name)}</strong></div>
${runDisplayValue(item.value)}${handoffs?`<div class="run-handoffs">${handoffs}</div>`:''}</div>`}).join('');
const time=step.completed_at?runTimeLabel(step.completed_at):step.state==='error'?'오류':'기록됨';
const iteration=step.iteration>1?` · ${step.iteration}회차`:'';
return `<details class="run-step ${esc(step.state)}" ${open?'open':''}><summary>
<span class="run-step-index">${esc(step.position||index+1)}</span><span class="run-step-title">
<strong>${esc(step.node)}</strong><span class="meta">${esc(step.action||'업무 처리')}${iteration}</span></span>
${step.label?`<span class="run-step-result">결정: ${esc(step.label)}</span>`:''}
<span class="run-step-state">${time}</span></summary><div class="run-step-body">
${step.label?`<div><span class="run-highlight-label">결정: ${esc(step.label)}</span></div>`:''}
${writtenFile}
${outputs?`<div class="run-detail-section"><h4>이 단계에서 만든 결과</h4><div class="run-field-list">${outputs}</div></div>`:''}
${inputs?`<details class="run-step-support"><summary>사용한 정보 ${step.inputs.length}개</summary><div class="run-field-list">${inputs}</div></details>`:''}
${step.evidence?`<details class="run-step-support"><summary>판단 근거</summary>${runEvidenceHtml(step.evidence)}</details>`:''}
${step.path?`<div class="meta">관련 파일 · ${esc(step.path)}</div>`:''}
${step.actor==='legacy'?'<div class="run-legacy-note">과거 실행이라 수행 당시의 상세 입력 기록은 제공되지 않습니다.</div>':''}
</div></details>`}
function runOutline(r){const p=r.presentation;if(!p)return '';
const outline=(p.outline||[]).map(item=>`<div class="run-outline-step ${esc(item.state)}">
<span>${esc(item.position)}단계${item.iterations>1?' · '+item.iterations+'회 수행':''}</span>
<strong>${esc(item.node)}</strong></div>`).join('');
const routes=(p.routes||[]).map(item=>`<span class="run-route">${esc(item.label||'분기')} → ${esc(item.next)}</span>`).join('');
return `<section class="run-detail-section"><h3>전체 진행 단계</h3><div class="run-outline">${outline}</div>
${routes?`<div class="run-route-list">${routes}</div>`:''}</section>`}
function runPresentation(r){const p=r.presentation;if(!p)return '';
const history=(p.steps||[]).filter(step=>step.state==='completed'||(r.status==='error'&&step.state==='current')).reverse();
const steps=history.map((step,index)=>runStepHtml(r.status==='error'&&step.state==='current'
?{...step,state:'error'}:step,index)).join('');
return steps?`<section class="run-presentation"><h3>단계별 실행 기록</h3>
<div class="run-step-list">${steps}</div></section>`:''}
function runFrame(r,body){runValueSequence=0;const n=r.navigation||{};const completed=n.completed??0,total=n.total??0;
const dummy=r.dependency_dummy||n.dependency_dummy||{};
const originNames={manual:'수동 입력',ai:'AI 초안',reuse:'자동 재사용'};
const originText=Object.entries(dummy.origins||{}).map(([k,v])=>`${originNames[k]||k} ${v}개`).join(' · ');
const dummyInfo=dummy.used?`<div class="dummy-provenance"><strong>예시 데이터 사용</strong>
${originText?`<span> · ${esc(originText)}</span>`:''}</div>`:'';
const currentContext=runCurrentContext(r);const currentBody=currentContext&&body.includes('</h3>')
?body.replace('</h3>',`</h3>${currentContext}`):body+currentContext;
const currentPosition=n.current?.position?` · 현재 ${n.current.position}단계`:'';
return `<div class="run-shell"><header class="run-head"><div>
<h2>${esc(n.task_name||'Runner 실행')}</h2><div class="meta">업무 식별자 · ${esc(n.key||'-')}</div>
</div><div class="run-head-badges">${dummy.used?'<span class="dummy-badge">예시 데이터 사용</span>':''}
<span class="run-status-badge">${esc(n.status_label||r.status||'진행 중')}</span>
<button class="btn run-close" data-run-close>닫기</button></div></header>
<div class="run-progress-summary"><progress max="${Math.max(total,1)}" value="${completed}" aria-label="업무 진행률"></progress>
<span><strong>${completed} / ${total}단계 완료</strong>${currentPosition}</span></div>
${dummyInfo}${runOutline(r)}<main class="run-current">${currentBody}</main>${runPresentation(r)}</div>`}
function runStatusLabel(x){return x.navigation?.status_label||({
waiting:'사용자 입력 대기',running:'진행 중',error:'실행 오류',done:'실행 완료'
}[x.status]||x.status||'진행 중')}
function runListRow(x,resumeLabel=''){return `<div class="run-list-row"><div><strong>${esc(x.key)}</strong>
${x.dependency_dummy?.used?' <span class="dummy-badge">예시 데이터 사용</span>':''}
<div class="meta">${esc(runStatusLabel(x))}${x.waiting_node_label?' · '+esc(x.waiting_node_label):''}
${x.dependency_dummy?.used?' · '+esc(Object.keys(x.dependency_dummy.origins||{}).join('/')):''}</div></div>
<div class="run-list-actions">${resumeLabel?`<button class="btn primary" data-resume="${esc(x.run_ref)}"
data-rev="${esc(x.revision)}">${esc(resumeLabel)}</button>`:`<button class="btn primary" data-view="${esc(x.run_ref)}">결과 보기</button>`}<button class="btn danger" data-delete="${esc(x.run_ref)}"
data-rev="${esc(x.revision)}" data-key="${esc(x.key)}">기록 삭제</button></div></div>`}
async function showRuns(ref){const r=await get('/api/runs?task_ref='+encodeURIComponent(ref));
currentRunRef=null;currentRunSignature=null;runInputDirty=false;
const active=(r.active_runs||[]).filter(x=>x.status!=='error')
.map(x=>runListRow(x,'계속 진행')).join('');
const failed=(r.runs||[]).filter(x=>x.status==='error')
.slice(0,10).map(x=>runListRow(x,'다시 시도')).join('');
const completed=(r.runs||[]).filter(x=>x.status==='done')
.slice(0,10).map(x=>runListRow(x)).join('');
const readyKeys=(r.ready_keys||[]).map(item=>{const readyTime=item.ready_at
?runTimeLabel(item.ready_at):'완료 시간 기록 없음';
return `<div class="run-list-row"><div><strong>${esc(item.key)}</strong>
<div class="meta">선행 Task ${esc(item.prerequisite_count||0)}개 완료 · ${readyTime}</div></div>
<div class="run-list-actions"><button class="btn" data-ready-key="${esc(item.key)}">선택</button></div></div>`}).join('');
showDialog(`<h2>${esc(r.task_name)} 실행 관리</h2>
<h3 class="run-section-title">진행 중인 업무</h3><div class="run-list">
${active||'<div class="empty">진행 중인 업무가 없습니다.</div>'}</div>
${failed?`<h3 class="run-section-title">재시도가 필요한 업무</h3><div class="run-list">${failed}</div>`:''}
${completed?`<h3 class="run-section-title">최근 완료 업무</h3><div class="run-list">${completed}</div>`:''}
${readyKeys?`<h3 class="run-section-title">실행 준비된 Issue Key</h3><div class="run-list">${readyKeys}</div>`:''}
<h3 class="run-section-title">신규 실행</h3><label for="newKey"><strong>업무 식별자</strong></label>
<input id="newKey" placeholder="예: CHANGE-2026-015">
<button class="btn primary" id="startRun">시작</button>`);
const validatedRunKey=()=>{const input=$('#newKey'),value=input.value.trim();let message='';
if(!value)message='업무 식별자를 입력해 주세요.';
else if(value.length>100||value.includes('/')||[...value].some(char=>
char.charCodeAt(0)<32||char.charCodeAt(0)===92))message='업무 식별자 형식이 올바르지 않습니다.';
else if((r.runs||[]).some(item=>item.key===value))message='이미 사용 중인 업무 식별자입니다. 다른 값을 입력해 주세요.';
if(message){alert(message);input.focus();return null}return value};
const startRun=()=>{const key=validatedRunKey();if(key===null)return;
guarded($('#startRun'),'실행을 시작하고 있습니다.','다음 작업 지점까지 진행합니다.',async()=>{
try{const o=await post('/api/run/start',{task_ref:ref,key,
expected_task_fingerprint:r.task_fingerprint,idempotency_key:idem('run-start')});
pollOperation(o.operation_id)}catch(e){alert(e.message)}})};
$('#startRun').onclick=startRun;
document.querySelectorAll('[data-ready-key]').forEach(button=>button.onclick=()=>{
$('#newKey').value = button.dataset.readyKey;$('#newKey').focus()});
// Key 입력칸에서 Enter로도 시작한다 — 예전에는 마우스로 버튼까지 가야 했다.
$('#newKey').addEventListener('keydown',event=>{
if(event.key==='Enter'){event.preventDefault();startRun()}});
document.querySelectorAll('[data-resume]').forEach(b=>b.onclick=()=>
guarded(b,'실행을 재개하고 있습니다.','다음 작업 지점까지 진행합니다.',async()=>{
try{const o=await post('/api/run/next',
{run_ref:b.dataset.resume,expected_revision:b.dataset.rev,idempotency_key:idem('run-next')});
pollOperation(o.operation_id)}catch(e){alert(e.message)}}));
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=async()=>{
try{const result=await get('/api/run/status?run_ref='+encodeURIComponent(b.dataset.view));
showRunResult(result)}catch(e){alert(e.message)}});
document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{
if(!window.confirm(`'${b.dataset.key}' 실행 기록을 정말 삭제하시겠습니까?\n삭제한 기록은 복구할 수 없습니다.`))return;
await guarded(b,'실행 기록을 삭제하고 있습니다.','',async()=>{
try{await post('/api/run/delete',{run_ref:b.dataset.delete,expected_revision:b.dataset.rev,
idempotency_key:idem('run-delete')});alert('실행 기록을 삭제했습니다.');await showRuns(ref);await load(false)}
catch(e){alert(e.message)}})})}
async function pollOperation(id){
const token=++operationPollToken;
showDialog(`<h2>실행 중</h2><div class="notice">다음 작업 지점까지 진행하고 있습니다…</div>
<div class="meta" id="opElapsed" role="status" aria-live="polite">경과 0초</div>
<div id="opSlow" class="hidden"><div class="meta">시간이 오래 걸리고 있습니다.
이 창을 닫아도 작업은 계속 진행되며, 나중에 '실행 관리'에서 상태를 확인할 수 있습니다.</div>
<button class="btn" id="opDetach">닫고 나중에 확인</button></div>`);
runInputDirty=false;
const startedAt=Date.now();let wait=OP_POLL_MIN_MS;
const detachButton=$('#opDetach');
if(detachButton)detachButton.onclick=()=>{closeDialog();load(false)};
const tick=async()=>{
if(token!==operationPollToken)return;
const elapsed=Date.now()-startedAt;
const label=$('#opElapsed');if(label)label.textContent=`경과 ${Math.round(elapsed/1000)}초`;
if(elapsed>=OP_SLOW_MS){const slow=$('#opSlow');if(slow)slow.classList.remove('hidden')}
let o=null;try{o=await get('/api/operation?id='+encodeURIComponent(id))}
catch(error){if(token!==operationPollToken)return;if(error.terminal){
showDialog(`<h2>실행 상태 확인 실패</h2><div class="notice error">${esc(error.message)}</div>`);return}
wait=Math.min(Math.round(wait*1.5),OP_POLL_MAX_MS);return setTimeout(tick,wait)}
if(token!==operationPollToken)return;
if(o.status==='running'){wait=Math.min(Math.round(wait*1.5),OP_POLL_MAX_MS);
return setTimeout(tick,wait)}
if(o.status!=='done'){showDialog(`<h2>실행 상태 확인 실패</h2><div class="notice error">${esc(reasonMessage(o,'작업 상태를 확인하지 못했습니다.'))}</div>`);return}
if(!o.result||['error','invalid','conflict','busy','uncertain'].includes(o.result.status)){
showDialog(`<h2>실행을 시작하지 못했습니다</h2><div class="notice error">${esc(reasonMessage(o.result,'업무를 실행하지 못했습니다.'))}</div>`);return}
await refreshAssistantWatch();const result=o.result?.run_ref
?await get('/api/run/status?run_ref='+encodeURIComponent(o.result.run_ref)):o.result;
if(token===operationPollToken)showRunResult(result)};tick()}
function runSignature(r){const j=r.job||{};return JSON.stringify([
r.status,r.revision,j.job_id,j.actor,j.kind,r.navigation?.completed,
r.input_parse?.status,r.input_parse?.updated_at])}
function runtimeValue(value){if(value===null||value===undefined)return '';
return typeof value==='object'?JSON.stringify(value,null,2):String(value)}
function runtimeField(field,index,draftOutput){const id=field.id||`field_${index+1}`;
const name=field.display_name||field.name||id;
const hasDraft=Object.prototype.hasOwnProperty.call(draftOutput||{},id);
const suggested=hasDraft?draftOutput[id]:(field.suggested??'');
return `<div class="runtime-field"><label for="runtimeField${index}">${esc(name)}</label>
<textarea id="runtimeField${index}" data-human-field="${esc(id)}"
placeholder="${esc(name)}">${esc(runtimeValue(suggested))}</textarea></div>`}
function dependencyText(value){if(value===null||value===undefined)return '';
if(Array.isArray(value))return value.map(dependencyText).filter(Boolean).join('\\n');
if(typeof value==='object')return Object.entries(value).map(([key,item])=>
`${key}: ${dependencyText(item)}`).join('\\n');return String(value)}
function dependencyDummyEditor(r,j){const parseState=r.input_parse||{};
const cacheOutput=r.dependency_dummy_cache?.output||{};
const draftOutput=parseState.status==='review_ready'?parseState.draft_output:cacheOutput;
const fields=j.fields||[];const sources=fields.map((field,index)=>{const id=field.id||`field_${index+1}`;
const hasDraft=Object.prototype.hasOwnProperty.call(draftOutput||{},id);
const suggested=hasDraft?draftOutput[id]:(field.suggested??'');
const consumers=(field.consumer_node_names||[]).map(name=>
`<span class="dependency-consumer">${esc(name)}</span>`).join('');
return `<section class="dependency-source">
<div class="dependency-data-title"><span>입력할 데이터</span>
<strong>${esc(field.source_field_name||'선행 결과')}</strong></div>
<div class="dependency-source-flow-wrap"><span class="dependency-source-flow-title">데이터 출처</span>
<div class="dependency-source-flow"><div class="dependency-source-step"><span>Task</span>
<strong>${esc(field.source_task_name||'이전 Task')}</strong></div>
<div class="dependency-source-arrow" aria-hidden="true">→</div>
<div class="dependency-source-step"><span>Node</span><strong>${esc(field.source_node_name||'선행 단계')}</strong></div>
<div class="dependency-source-arrow" aria-hidden="true">→</div>
<div class="dependency-source-step"><span>Output</span><strong>${esc(field.source_field_name||'선행 결과')}</strong></div></div></div>
${consumers?`<div class="dependency-usage"><span class="dependency-usage-label">이 Output을 사용할 현재 Node</span>
<div class="dependency-consumers">${consumers}</div></div>`:''}
<label for="runtimeField${index}">예시 데이터</label>
<textarea id="runtimeField${index}" data-human-field="${esc(id)}"
placeholder="예시 데이터를 입력해주세요.">${esc(dependencyText(suggested))}</textarea></section>`}).join('');
const aiConnected=assistantWatch.connected===true;
const review=parseState.status==='review_ready';const failed=parseState.status==='needs_user_input';
const status=review?'<div class="ai-draft-status"><strong>예시값 채우기가 완료되었습니다.</strong><span>수정 후 진행하여 주세요.</span></div>'
:failed?`<div class="ai-draft-status error"><strong>예시값을 채우지 못했습니다.</strong><span>${esc(parseState.message||'직접 입력해 주세요.')}</span></div>`
:!aiConnected?'<div class="ai-draft-status"><span>AI로 예시값을 채우려면 Code Assistant에 Agent를 연결해 주세요.</span></div>':'';
return `<div class="notice">이번 Task를 수행하기 위한 이전 Task의 선행 데이터가 없습니다. 예시 데이터를 입력해주세요.</div>
${status}<div class="dependency-source-list">${sources}</div>
<div class="runtime-actions"><button class="btn" id="requestDummyDraft" ${aiConnected?'':'disabled'}>AI로 예시 데이터 채우기</button>
<button class="btn primary" id="submitHuman">입력한 데이터로 Task 시작</button></div>`}
function humanEditor(r,j){const slot=j.slot||'';const fields=j.fields||[];
if(j.kind==='ask_dependency_dummy')return dependencyDummyEditor(r,j);
const parseState=r.input_parse||{};const parseRejected=parseState.status==='needs_user_input';
const parseReady=parseState.status==='review_ready';
const missing=(parseState.missing_fields||[]).filter(Boolean);
const parseFeedback=parseRejected?`<div class="notice error">
<strong>붙여넣은 내용을 항목별로 정리하지 못했습니다.</strong>
<div>${esc(parseState.message||'붙여넣은 내용에서 필요한 항목을 확인하지 못했습니다.')}</div>
${missing.length?`<div class="meta">확인하지 못한 항목: ${missing.map(esc).join(', ')}</div>`:''}
<div class="meta">문서 전체를 다시 붙여넣거나 ‘항목별로 직접 입력’을 사용해 주세요.</div></div>`:'';
const guide=`<div class="notice">${esc(j.prompt||'필요한 결과를 입력해 주세요.')}</div>`;
if(slot==='output'||slot==='inputs'){
const controls=fields.map((field,index)=>runtimeField(
field,index,parseState.draft_output||{})).join('');
const deferrable=j.kind==='ask_user_deferrable';
return `${parseFeedback}${guide}<div class="runtime-input-tabs" role="tablist" aria-label="입력 방식">
<button type="button" class="runtime-input-tab${parseReady?' active':''}" role="tab"
aria-selected="${parseReady?'true':'false'}"
aria-controls="runtimeDirectPanel" data-runtime-tab="direct">항목별로 직접 입력</button>
<button type="button" class="runtime-input-tab${parseReady?'':' active'}" role="tab"
aria-selected="${parseReady?'false':'true'}"
aria-controls="runtimePastePanel" data-runtime-tab="paste">내용 전체 붙여넣기</button></div>
<div id="runtimeDirectPanel" class="runtime-method runtime-input-panel${parseReady?'':' hidden'}"
role="tabpanel"
data-runtime-panel="direct">
<div class="runtime-help">아래 항목에 필요한 결과를 입력해 주세요.</div>
<div class="runtime-fields">${controls}</div><div class="runtime-actions">
<button class="btn primary" id="submitHuman">결과 반영</button>
${deferrable?'<button class="btn" id="skipHuman">미진행(결과 없이 진행)</button><button class="btn" id="deferHuman">다음에 재진행</button>':''}</div></div>
<div id="runtimePastePanel" class="runtime-method runtime-input-panel${parseReady?' hidden':''}"
role="tabpanel"
data-runtime-panel="paste">
<div class="runtime-help">화면이나 문서의 내용을 통째로 붙여넣으면 Agent가 위 항목에 맞게 정리합니다.</div>
<textarea id="rawHumanInput" placeholder="화면이나 문서에서 복사한 내용을 붙여넣어 주세요">${esc(parseState.raw_input||'')}</textarea>
<button class="btn" id="requestHumanParse">Agent가 정리하도록 요청</button></div>`}
if(slot==='system'){const choices=(((j.result_schema||{}).properties||{}).system||{}).enum||[];
return `${guide}<select class="runtime-select" id="humanSystem">
<option value="">시스템을 선택해 주세요</option>${choices.map(v=>`<option>${esc(v)}</option>`).join('')}</select>
<button class="btn primary" id="submitHuman">선택 반영</button>`}
if(slot==='confirm'||slot==='approval'||slot==='confirm_retry'||slot==='confirm_done'){
return `${guide}<div class="runtime-actions"><button class="btn primary" id="confirmHuman">확인</button>
<button class="btn" id="rejectHuman">취소</button></div>`}
return `${guide}<div class="runtime-fields"><div class="runtime-field">
<label for="humanValue">결과</label><textarea id="humanValue"></textarea></div></div>
<button class="btn primary" id="submitHuman">결과 반영</button>`}
function bindHumanEditor(r,j){const submit=async result=>{try{const o=await post('/api/run/human-submit',
{run_ref:r.run_ref,job_id:j.job_id,revision:r.revision,result,idempotency_key:idem('human')});
pollOperation(o.operation_id)}catch(e){alert(e.message)}};
const switchRuntimeInputMode=mode=>{
document.querySelectorAll('[data-runtime-tab]').forEach(tab=>{
const selected=tab.dataset.runtimeTab===mode;tab.classList.toggle('active',selected);
tab.setAttribute('aria-selected',String(selected))});
document.querySelectorAll('[data-runtime-panel]').forEach(panel=>{
panel.classList.toggle('hidden',panel.dataset.runtimePanel!==mode)});
const target=document.querySelector(`[data-runtime-panel="${CSS.escape(mode)}"]`);
const first=target?.querySelector('textarea:not(:disabled),input:not(:disabled),select:not(:disabled)');
if(first)first.focus()};
document.querySelectorAll('[data-runtime-tab]').forEach(tab=>{
tab.onclick=()=>switchRuntimeInputMode(tab.dataset.runtimeTab)});
const slot=j.slot||'';const submitButton=$('#submitHuman');
if(submitButton)submitButton.onclick=()=>{if(slot==='output'||slot==='inputs'){
const output={};let missing=null;document.querySelectorAll('[data-human-field]').forEach(control=>{
const key=control.dataset.humanField;if(!control.value.trim())missing=missing||control;
else output[key]=control.value});if(missing){alert('필요한 결과를 모두 입력해 주세요.');
missing.focus();return}const result={output};if(j.kind==='ask_dependency_dummy'){
result.dependency_dummy_origin=r.input_parse?.status==='review_ready'?'ai':'manual'}submit(result)}else if(slot==='system'){const value=$('#humanSystem').value;
if(!value){alert('시스템을 선택해 주세요.');return}submit({system:value})}
else{const value=$('#humanValue').value;if(!value.trim()){alert('결과를 입력해 주세요.');return}
const result={};result[slot||'content']=value;submit(result)}};
const skip=$('#skipHuman');if(skip)skip.onclick=()=>{const output={};(j.fields||[]).forEach(f=>output[f.id]=null);
submit({output})};const defer=$('#deferHuman');if(defer)defer.onclick=()=>$('#dialog').classList.add('hidden');
const confirm=$('#confirmHuman');if(confirm)confirm.onclick=()=>submit({confirmed:true});
const reject=$('#rejectHuman');if(reject)reject.onclick=()=>submit({confirmed:false});
const parse=$('#requestHumanParse');if(parse)parse.onclick=async()=>{const raw=$('#rawHumanInput').value;
if(!raw.trim()){alert('정리할 내용을 붙여넣어 주세요.');$('#rawHumanInput').focus();return}
try{await post('/api/run/parse-request',{run_ref:r.run_ref,job_id:j.job_id,revision:r.revision,
raw_input:raw});runInputDirty=false;await refreshAssistantWatch();
const next=await get('/api/run/status?run_ref='+encodeURIComponent(r.run_ref));
showRunResult(next)}catch(e){alert(e.message)}};
const dummyDraft=$('#requestDummyDraft');if(dummyDraft)dummyDraft.onclick=async()=>{
dummyDraft.disabled=true;dummyDraft.textContent='예시 데이터 채우는 중…';
try{await post('/api/run/dummy-draft-request',{run_ref:r.run_ref,job_id:j.job_id,revision:r.revision});
runInputDirty=false;await refreshAssistantWatch();const next=await get('/api/run/status?run_ref='+encodeURIComponent(r.run_ref));
showRunResult(next)}catch(e){dummyDraft.disabled=false;dummyDraft.textContent='AI로 예시 데이터 채우기';
alert(e.message)}}}
function showRunResult(r,watchVerified=false){const nextRunRef=r.run_ref||null;const j=r.job||{};
const sameAgentMessage=currentAgentMessage&&currentAgentMessage.run_ref===nextRunRef
&&(!currentAgentMessage.job_id||currentAgentMessage.job_id===j.job_id);
if(currentRunRef!==nextRunRef||r.status!=='paused'||j.actor!=='agent'||!sameAgentMessage){
currentAgentMessage=null;runnerMessageExpanded=false}
currentRunRef=nextRunRef;currentRunSignature=runSignature(r);
runInputDirty=false;if(r.status==='paused'){if(j.actor==='agent'){
showDialog(runFrame(r,`<h3>${esc(j.node_label||'Agent 처리')}</h3>
<div class="notice">이 노드의 AI 처리가 필요합니다. 요청문을 복사해 Agent 채팅에 붙여넣어 주세요.</div>
<button class="btn primary" data-copy="e2e-agent-runner 스킬을 사용해서 현재 프로젝트 대시보드의 Runner AI 작업을 모두 처리하고, 각 실행을 다음 사용자 입력 또는 완료 지점까지 진행해줘">Agent 요청문 복사</button>`),watchVerified);
bindCopy();return}
if(r.input_parse?.status==='waiting_agent'){
const dependencyDraft=j.kind==='ask_dependency_dummy';
showDialog(runFrame(r,`<h3>${dependencyDraft?'예시 데이터 채우는 중':esc(j.node_label||'사용자 입력 정리')}</h3>
<div class="notice">${dependencyDraft?'AI가 예시 데이터를 작성하고 있습니다. 작성이 끝나면 확인하고 수정할 수 있습니다.':'붙여넣은 내용을 Agent가 항목별로 정리하고 있습니다.'}</div>
<button class="btn primary" data-copy="e2e-agent-runner 스킬을 사용해서 현재 프로젝트 대시보드의 Runner AI 작업을 모두 처리하고, 각 실행을 다음 사용자 입력 또는 완료 지점까지 진행해줘">Agent 요청문 복사</button>`),watchVerified);
bindCopy();return}
showDialog(runFrame(r,`<h3>${j.kind==='ask_dependency_dummy'?'실행 전 예시 데이터 입력':esc(j.node_label||'사용자 입력')}</h3>
${humanEditor(r,j)}`));bindHumanEditor(r,j);
document.querySelectorAll('#dialog input,#dialog textarea,#dialog select').forEach(control=>{
control.addEventListener('input',()=>{runInputDirty=true},{once:true})});return}if(r.status==='done')showDialog(runFrame(r,
'<h3>업무 실행 완료</h3><div class="notice">모든 노드의 실행이 완료되었습니다.</div>'));
else showDialog(runFrame(r,`<h3>실행 결과</h3><div class="notice ${r.status==='error'?'error':''}">
${esc(reasonMessage(r,r.status))}</div>`))}
function runnerAgentMessageHtml(){if(!currentAgentMessage||
currentAgentMessage.run_ref!==currentRunRef)return '';
const text=String(currentAgentMessage.message||'');if(!text.trim())return '';
const characters=Array.from(text);const long=characters.length>180;
const preview=long?characters.slice(0,180).join('')+'…':text;
return `<section class="run-agent-message"><span class="run-agent-message-label">Claude Code 메시지</span>
<p>${esc(preview)}</p>${long?`<details id="runnerAgentMessageDetail" ${runnerMessageExpanded?'open':''}>
<summary>전체 내용 펼치기</summary><pre>${esc(text)}</pre></details>`:''}</section>`}
function bindRunnerAgentMessage(){const detail=$('#runnerAgentMessageDetail');if(!detail)return;
detail.open=runnerMessageExpanded;detail.addEventListener('toggle',()=>{
runnerMessageExpanded=detail.open})}
function runnerAgentLoadingHtml(){return `<div class="run-agent-wait">
<div class="spinner" aria-hidden="true"></div>
<h3>Agent가 작업을 처리하고 있습니다</h3>
<div class="meta">완료되면 실행 화면이 자동으로 바뀝니다.</div>
${runnerAgentMessageHtml()}</div>`}
function runnerAgentCheckingHtml(){return `<div class="run-agent-wait run-agent-checking">
<div class="spinner" aria-hidden="true"></div>
<h3>Agent 연결 상태를 확인하고 있습니다</h3>
<div class="meta">확인이 끝나면 이 화면이 자동으로 바뀝니다.</div></div>`}
function runnerAgentBody(html){const template=document.createElement('template');template.innerHTML=html;
const main=template.content.querySelector('main.run-current');if(!main)return html;
const context=main.querySelector('.run-current-context');main.innerHTML=runnerAgentLoadingHtml();
if(context)main.append(context);return template.innerHTML}
function updateRunnerAgentMessage(message){if(!message||message.provider!=='claude'
||!currentRunRef||message.run_ref!==currentRunRef)return;
currentAgentMessage=message;const wait=document.querySelector('#dialogBody .run-agent-wait');
if(!wait)return;wait.outerHTML=runnerAgentLoadingHtml();bindRunnerAgentMessage()}
function bindRunValueActions(){document.querySelectorAll('[data-run-value-toggle]').forEach(button=>{
button.onclick=()=>{const value=document.getElementById(button.getAttribute('aria-controls'));if(!value)return;
const expanded=button.getAttribute('aria-expanded')!=='true';value.classList.toggle('is-collapsed',!expanded);
button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded
?button.dataset.closeLabel:button.dataset.openLabel}});
document.querySelectorAll('[data-run-file-preview]').forEach(button=>{
button.onclick=()=>openRunFilePreview(button.dataset.runFilePreview,button)})}
function showDialog(html,watchVerified=false){const body=$('#dialogBody');
// 닫은 뒤 원래 누른 버튼으로 포커스를 되돌리기 위해 기억해 둔다.
if($('#dialog').classList.contains('hidden'))dialogReturnFocus=document.activeElement;
const runnerHandoff=html.includes('data-copy="e2e-agent-runner');
const render=()=>{body.innerHTML=runnerHandoff&&assistantWatch.connected===true
?runnerAgentBody(html)
:html;if(runnerHandoff&&assistantWatch.connected===true){
const badge=body.querySelector('.run-status-badge');
if(badge)badge.textContent='Agent 처리 중';bindRunnerAgentMessage()}
const runnerClose=body.querySelector('[data-run-close]');if(runnerClose)runnerClose.onclick=closeDialog;
bindRunValueActions();bindCopy();
$('#dialog').classList.toggle('runner-dialog',!!body.querySelector('.run-shell'));
$('#dialog').classList.remove('hidden')};
if(runnerHandoff&&assistantWatch.connected!==true&&!watchVerified){
assistantWatchChecking=true;renderAssistantJobs();body.innerHTML=runnerAgentCheckingHtml();
$('#dialog').classList.remove('runner-dialog');
$('#dialog').classList.remove('hidden');refreshAssistantWatch().then(signal=>{
if(!signal||signal.status!=='ok')return;render();
if(assistantWatch.connected!==true)bindCopy()});
return}render()}
async function refreshCurrentRun(force=false,watchVerified=false){if(!currentRunRef
||$('#dialog').classList.contains('hidden')||runInputDirty)return null;
if(runRefreshPromise)return runRefreshPromise;const runRef=currentRunRef;
runRefreshPromise=(async()=>{const next=await get('/api/run/status?run_ref='+encodeURIComponent(runRef));
if(currentRunRef!==runRef||$('#dialog').classList.contains('hidden')||runInputDirty)return next;
if(force||runSignature(next)!==currentRunSignature)showRunResult(next,watchVerified);return next})();
try{return await runRefreshPromise}finally{runRefreshPromise=null}}
async function refreshAssistantSignal(){const watchBefore=assistantWatchSignature();
const runnerWatchChecking=!!document.querySelector('#dialogBody .run-agent-checking');
const signal=await refreshAssistantWatch();if(!signal||signal.status!=='ok')return signal;
if(currentRunRef&&(watchBefore!==assistantWatchSignature()||runnerWatchChecking))
await refreshCurrentRun(true,true);
return signal}
function connectDashboardEvents(){if(dashboardEventSource||!window.EventSource)return;
const source=new EventSource('/api/events');dashboardEventSource=source;
source.addEventListener('agent_message',event=>{try{
updateRunnerAgentMessage(JSON.parse(event.data))}catch(_error){}});
source.addEventListener('run_updated',event=>{try{const update=JSON.parse(event.data);
if(update.run_ref===currentRunRef){refreshCurrentRun(true).catch(()=>{});
refreshAssistantSignal().catch(()=>{})}
else if($('#dialog').classList.contains('hidden'))load(false).catch(()=>{})
}catch(_error){}})}
async function autoTick(){if(document.hidden||loadPromise!==null||autoTickBusy
||!$('#busy').classList.contains('hidden')
||Date.now()-autoPresenceAt>AUTO_PRESENCE_MS)return;autoTickBusy=true;
try{if(currentRunRef&&!$('#dialog').classList.contains('hidden')){
if(runInputDirty)return;await refreshCurrentRun(false);await refreshAssistantSignal();return}
const knownSignal=lastSignal;const signal=await refreshAssistantWatch();
if(!signal||signal.status!=='ok')return;
if(!$('#dialog').classList.contains('hidden'))return;
if(knownSignal===null||signal.signature===knownSignal)return;await load(false)
}catch(_error){}finally{autoTickBusy=false}}
async function copyToClipboard(value){try{if(navigator.clipboard?.writeText){
const copied=await Promise.race([
navigator.clipboard.writeText(value).then(()=>true).catch(()=>false),
new Promise(resolve=>setTimeout(()=>resolve(false),500))]);
if(copied)return true}}catch(_error){}
const area=document.createElement('textarea');area.value=value;area.setAttribute('readonly','');
area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();
try{return document.execCommand('copy')}catch(_error){return false}finally{area.remove()}}
function bindCopy(){document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{
const copied=await copyToClipboard(b.dataset.copy);
const message=b.dataset.copyMessage?document.getElementById(b.dataset.copyMessage):null;
if(message){message.textContent=copied
?'복사되었습니다. Agent 채팅창에 붙여넣어 주세요.'
:'자동 복사에 실패했습니다. 버튼을 다시 눌러 주세요.';
message.classList.remove('hidden')}else{b.textContent=copied?'복사됨':'복사 실패'}})}
function bindWatchStop(){document.querySelectorAll('[data-watch-stop]').forEach(button=>{
button.onclick=async()=>{document.querySelectorAll('[data-watch-stop]').forEach(b=>b.disabled=true);
try{await post('/api/assistant-watch/stop',{});await load(false)}
catch(error){alert(error.message);document.querySelectorAll('[data-watch-stop]').forEach(b=>b.disabled=false)}}})}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('#refresh').onclick=()=>load(true);$('#closeDialog').onclick=()=>closeDialog();
document.querySelectorAll('[data-run-file-preview-close]').forEach(button=>{
button.onclick=closeRunFilePreview});$('#runFilePreviewDialog').onclick=event=>{
if(event.target===event.currentTarget)closeRunFilePreview()};
document.addEventListener('pointerdown',()=>{autoPresenceAt=Date.now()},{passive:true});
document.addEventListener('keydown',event=>{autoPresenceAt=Date.now();
// 대화상자가 <div>라 Escape가 공짜로 오지 않는다 — Creator 쪽 <dialog>와 동작을 맞춘다.
if(event.key==='Escape'&&!$('#runFilePreviewDialog').classList.contains('hidden')){
event.preventDefault();closeRunFilePreview();return}
if(event.key==='Escape'&&!$('#dialog').classList.contains('hidden')){
event.preventDefault();closeDialog()}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){autoPresenceAt=Date.now();autoTick()}});
setInterval(autoTick,AUTO_REFRESH_MS);
async function initialLoad(){try{await load(true)}
catch(e){$('#summaryTitle').textContent=e.message}}
bindCopy();bindWatchStop();switchTab(currentTab);connectDashboardEvents();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialLoad,{once:true});
else initialLoad();
window.addEventListener('pageshow',event=>{if(event.persisted)initialLoad()});
window.addEventListener('focus',()=>{if(Date.now()-lastLoadedAt>1000)
load(false).catch(e=>{$('#summaryTitle').textContent=e.message})});
</script></body></html>"""
