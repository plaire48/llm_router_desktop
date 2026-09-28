# -*- coding: utf-8 -*-
"""프로젝트 로컬 Creator 저작 폼을 제공하는 HTTP 연결 계층."""
import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import secrets
import threading
import time
from urllib.parse import parse_qs, urlsplit
import webbrowser

from . import (
    author_drafts, author_form, author_questions, author_structure,
    loopback_http, mcp_status, task_catalog, util,
)
from .node_tests import NodeTestService


_MAX_BODY = 2 * 1024 * 1024
_SESSION_SECONDS = 30 * 60
_DASHBOARD_CREATOR_AGENT_REQUEST = (
    "e2e-agent-creator와 e2e-agent-runner 스킬을 사용해서 현재 프로젝트 "
    "대시보드의 Creator AI 작업을 모두 처리하고, 처리 후 Creator와 Runner "
    "작업을 자동으로 이어갈 수 있도록 대시보드 연결 대기를 시작해줘"
)
_DISCONNECTED_ASSISTANT_WATCH = {
    "connected": False,
    "state": "disconnected",
    "domain": None,
}
_UNKNOWN_ASSISTANT_WATCH = {
    "connected": None,
    "state": "unknown",
    "domain": None,
}


class ConnectedHTTP:
    """127.0.0.1의 임시 포트에서 저작 UI만 제공한다."""

    def __init__(self, controller, open_browser=False, session_seconds=_SESSION_SECONDS,
                 create_state=True, agent_drafts=None, launch_id=None,
                 mcp_statuses=None, require_access_token=True,
                 completion_url=None, assistant_status_provider=None,
                 draft_generation_handler=None,
                 custom_logic_queue_handler=None):
        self.controller = controller
        self.open_browser = bool(open_browser)
        self.session_seconds = int(session_seconds)
        self.create_state = bool(create_state)
        self.launch_id = launch_id
        self.require_access_token = bool(require_access_token)
        if (
            completion_url is not None
            and (
                not isinstance(completion_url, str)
                or not completion_url.startswith("/")
                or completion_url.startswith("//")
            )
        ):
            raise ValueError("completion_url은 같은 서버의 절대 경로여야 합니다")
        self.completion_url = completion_url
        if (
            assistant_status_provider is not None
            and not callable(assistant_status_provider)
        ):
            raise ValueError("assistant_status_provider는 호출 가능해야 합니다")
        self.assistant_status_provider = assistant_status_provider
        if (
            draft_generation_handler is not None
            and not callable(draft_generation_handler)
        ):
            raise ValueError("draft_generation_handler는 호출 가능해야 합니다")
        self.draft_generation_handler = draft_generation_handler
        if (
            custom_logic_queue_handler is not None
            and not callable(custom_logic_queue_handler)
        ):
            raise ValueError("custom_logic_queue_handler는 호출 가능해야 합니다")
        self.custom_logic_queue_handler = custom_logic_queue_handler
        self.mcp_statuses = mcp_status.normalize(mcp_statuses)
        self.node_tests = (
            NodeTestService(controller, launch_id)
            if launch_id is not None else None
        )
        self._sessions = {}
        self._guard = threading.RLock()
        self._agent_drafts = {}
        self._agent_drafts_enabled = False
        if agent_drafts is not None:
            self.set_agent_drafts(agent_drafts)
        self._server = None
        self._thread = None
        self.base_url = None
        self.receipt_dir = os.path.join(
            controller.project_root, ".ops", "controller", "author-receipts")
        if self.create_state:
            os.makedirs(self.receipt_dir, exist_ok=True)

    def set_agent_drafts(self, value):
        """다음 질문지 렌더링에 사용할 Agent 초안 상태를 교체한다."""
        if value is None:
            copied = {}
        elif not isinstance(value, dict):
            raise ValueError("agent_drafts는 객체여야 합니다")
        else:
            # 외부 호출자가 이후 원본을 바꿔 진행 중 렌더가 달라지지 않게 복제한다.
            copied = json.loads(json.dumps(value, ensure_ascii=False))
        with self._guard:
            self._agent_drafts_enabled = True
            self._agent_drafts = copied
        return self

    def _draft_processing_started(self):
        """Code Assistant가 초안 처리를 시작했다고 기록한 경우만 로딩을 표시한다."""
        if (
            not isinstance(self.launch_id, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", self.launch_id)
        ):
            return False
        folder = os.path.realpath(os.path.join(
            self.controller.controller_dir, "creator-launches"))
        path = os.path.realpath(os.path.join(
            folder, self.launch_id + ".json"))
        if not self.controller._inside(path, folder):
            return False
        try:
            state = util.load_json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            return False
        return bool(
            state.get("launch_id") == self.launch_id
            and state.get("draft_processing_started_at")
        )

    def _assistant_status(self):
        """대시보드가 제공하는 공개 AI 연결·초안 진행 상태만 반환한다."""
        if self.assistant_status_provider is None:
            return {}
        try:
            value = self.assistant_status_provider()
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            return {"assistant_watch": dict(_UNKNOWN_ASSISTANT_WATCH)}
        if not isinstance(value, dict):
            return {"assistant_watch": dict(_UNKNOWN_ASSISTANT_WATCH)}
        return value

    def _connect_assistant_status(self, connected):
        if self.assistant_status_provider is None:
            return connected
        connected["automatic_agent_processing"] = True
        connected["assistant_request_prompt"] = (
            _DASHBOARD_CREATOR_AGENT_REQUEST)
        connected.update(self._assistant_status())
        connected.setdefault(
            "assistant_watch", dict(_DISCONNECTED_ASSISTANT_WATCH))
        return connected

    def _connect_node_test_assistant_status(self, result):
        """Dashboard 노드 테스트 응답에 현재 AI 연결 감시 상태만 덧붙인다."""
        if (
            self.assistant_status_provider is None
            or not isinstance(result, dict)
        ):
            return result
        value = dict(result)
        status = self._assistant_status()
        watch = status.get("assistant_watch")
        value["assistant_watch"] = (
            dict(watch)
            if isinstance(watch, dict)
            else dict(_DISCONNECTED_ASSISTANT_WATCH)
        )
        return value

    def start(self):
        if self._server is not None:
            return self
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "ops-local-author"
            sys_version = ""

            def do_GET(self):
                bridge._handle_get(self)

            def do_POST(self):
                bridge._handle_post(self)

            def log_message(self, _format, *_args):
                # 업무 payload나 URL token이 stdout/stderr 접근 로그로 흘러가지 않게 한다.
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        port = self._server.server_address[1]
        self.base_url = f"http://127.0.0.1:{port}"
        self._thread = threading.Thread(
            target=self._server.serve_forever, name="ops-local-author", daemon=True)
        self._thread.start()
        return self

    def stop(self):
        server = self._server
        self._server = None
        if server is not None:
            server.shutdown()
            server.server_close()
        thread = self._thread
        self._thread = None
        if thread and thread.is_alive():
            thread.join(timeout=2)
        if self.node_tests is not None:
            self.node_tests.cleanup()

    def _render_author_html(self, task_path, stage, connected,
                            revision_questionnaire=False,
                            regenerate_configured_drafts=False):
        task = util.load_json(task_path)
        if stage in ("structure_gate", "io_gate"):
            catalog = task_catalog.build_previous_output_catalog(task, task_path)
            return author_structure.build_editor_html(
                task,
                self.controller._fingerprint(task_path),
                connected=connected,
                previous_task_catalog=catalog,
            )
        if stage == "questionnaire":
            # 신규와 수정 모두 같은 현재값 기반 상세 설정 모델을 사용한다.
            questions = author_questions.collect_detail_questions(
                task, os.path.dirname(task_path))
            questions = [
                question for question in questions
                if question.get("qtype") != "io_confirm"
            ]
            with self._guard:
                agent_drafts_enabled = self._agent_drafts_enabled
                drafts = json.loads(json.dumps(
                    self._agent_drafts, ensure_ascii=False))
            if agent_drafts_enabled:
                questions = author_drafts.overlay_questions(
                    task, questions, drafts,
                    base_dir=os.path.dirname(task_path),
                    detail_questions=regenerate_configured_drafts)
            catalog = task_catalog.build_previous_output_catalog(task, task_path)
            return author_form.build_form_html(
                task,
                questions,
                previous_task_catalog=catalog,
                connected=connected,
                payload_type="ops_author_answers",
                form_title=(
                    "기존 상세 설정 수정"
                    if revision_questionnaire else
                    "상세 설정 및 AI 초안 확인"
                    if agent_drafts_enabled else "상세 설정"
                ),
                agent_draft_mode=agent_drafts_enabled,
                mcp_statuses=self.mcp_statuses,
            )
        return self._ready_html(task)

    def create_author_session(self, task_path, requested_stage="auto",
                              intent="author"):
        if self._server is None:
            self.start()
        if intent not in ("author", "revise"):
            raise ValueError(f"지원하지 않는 저작 intent입니다: {intent}")
        task = util.load_json(task_path)
        canonical_stage = self.controller._author_stage(task, task_path)
        # 완성된 Task의 재수정은 정본의 완료 플래그를 되돌리지 않고, 이
        # 서버 세션에만 설계 편집 화면을 강제한다.
        stage = (
            "structure_gate"
            if intent == "revise" and canonical_stage == "ready_to_validate"
            else canonical_stage
        )
        if requested_stage not in ("auto", stage):
            raise ValueError(
                f"요청한 저작 단계({requested_stage})와 현재 단계({stage})가 다릅니다")
        session_id = secrets.token_urlsafe(24)
        access_token = (
            secrets.token_urlsafe(32) if self.require_access_token else None)
        csrf = secrets.token_urlsafe(32)
        now = time.time()
        submit_url = f"{self.base_url}/author/{session_id}/submit"
        state_url = f"{self.base_url}/author/{session_id}/state"
        activity_url = f"{self.base_url}/author/{session_id}/activity"
        node_test_url = f"{self.base_url}/author/{session_id}/node-test"
        node_test_state_url = f"{self.base_url}/author/{session_id}/node-tests"
        connected = {
            "submit_url": submit_url,
            "state_url": state_url,
            "activity_url": activity_url,
            "csrf_token": csrf,
            "view_generation": 0,
        }
        if self.draft_generation_handler is not None:
            connected["draft_generate_url"] = (
                f"{self.base_url}/author/{session_id}/draft-generate")
        self._connect_assistant_status(connected)
        if self.completion_url:
            connected["completion_url"] = self.completion_url
        if self.node_tests is not None:
            connected.update({
                "node_test_url": node_test_url,
                "node_test_state_url": node_test_state_url,
            })
        detail_editor = stage == "questionnaire"
        html = self._render_author_html(
            task_path, stage, connected,
            revision_questionnaire=detail_editor,
            regenerate_configured_drafts=False)
        expires = now + self.session_seconds
        session = {
            "session_id": session_id,
            "task_path": os.path.realpath(task_path),
            "task_ref": self.controller._ref(task_path),
            "stage": stage,
            "intent": intent,
            "phase": (
                "design"
                if intent == "revise" and stage in (
                    "structure_gate", "io_gate")
                else "revision_questionnaire"
                if detail_editor else "canonical"
            ),
            "regenerate_configured_drafts": False,
            "revision": self.controller._revision(task_path),
            "access_token": access_token,
            "token_used": not self.require_access_token,
            "csrf": csrf,
            "created_at": now,
            "expires_at": expires,
            "last_activity_at": now,
            "activity_generation": 0,
            "html": html,
            "view_generation": 0,
            "last_submission": None,
            # 같은 브라우저가 단계 전환 직후 성공 요청을 재전송해도 당시
            # 결과를 그대로 돌려준다. phase가 바뀐 요청으로 다시 적용하지 않는다.
            "successful_submissions": {},
        }
        with self._guard:
            self._prune()
            self._sessions[session_id] = session
        url = (
            f"{self.base_url}/author/{session_id}?token={access_token}"
            if self.require_access_token
            else f"{self.base_url}/author/{session_id}"
        )
        if self.open_browser:
            threading.Thread(
                target=webbrowser.open, args=(url,), kwargs={"new": 2},
                name="ops-local-author-open-ui", daemon=True).start()
        return {
            "session_id": session_id,
            "stage": stage,
            "url": url,
            "expires_at": datetime.datetime.fromtimestamp(expires).isoformat(
                timespec="seconds"),
            "activity_generation": 0,
        }

    def advance_author_session(self, session_id, task_path, drafts=None,
                               revision_questionnaire=False):
        """기존 쿠키/URL을 유지한 채 다음 Creator 화면으로 교체한다."""
        if drafts is not None:
            self.set_agent_drafts(drafts)
        real_path = os.path.realpath(task_path)
        with self._guard:
            session = self._sessions.get(session_id)
            if not session or session.get("task_path") != real_path:
                raise ValueError("이어갈 Creator 화면 세션을 찾을 수 없습니다")
            generation = int(session.get("view_generation") or 0) + 1
            connected = {
                "submit_url": f"{self.base_url}/author/{session_id}/submit",
                "state_url": f"{self.base_url}/author/{session_id}/state",
                "activity_url": f"{self.base_url}/author/{session_id}/activity",
                "csrf_token": session["csrf"],
                "view_generation": generation,
            }
            if self.draft_generation_handler is not None:
                connected["draft_generate_url"] = (
                    f"{self.base_url}/author/{session_id}/draft-generate")
            self._connect_assistant_status(connected)
            if self.completion_url:
                connected["completion_url"] = self.completion_url
            if self.node_tests is not None:
                connected.update({
                    "node_test_url": (
                        f"{self.base_url}/author/{session_id}/node-test"),
                    "node_test_state_url": (
                        f"{self.base_url}/author/{session_id}/node-tests"),
                })
        task = util.load_json(task_path)
        canonical_stage = self.controller._author_stage(task, task_path)
        stage = (
            "questionnaire"
            if revision_questionnaire
            and canonical_stage in ("questionnaire", "ready_to_validate")
            else canonical_stage
        )
        detail_editor = stage == "questionnaire"
        html = self._render_author_html(
            task_path, stage, connected,
            revision_questionnaire=detail_editor,
            regenerate_configured_drafts=bool(revision_questionnaire))
        now = time.time()
        with self._guard:
            session = self._sessions.get(session_id)
            if not session or session.get("task_path") != real_path:
                raise ValueError("이어갈 Creator 화면 세션이 만료되었습니다")
            session.update({
                "stage": stage,
                "phase": (
                    "revision_questionnaire"
                    if detail_editor else "canonical"
                ),
                "regenerate_configured_drafts": bool(
                    revision_questionnaire),
                "revision": self.controller._revision(task_path),
                "html": html,
                "view_generation": generation,
                "last_submission": None,
                "expires_at": now + self.session_seconds,
                "last_activity_at": now,
                "activity_generation": (
                    int(session.get("activity_generation") or 0) + 1),
            })
            activity_generation = session["activity_generation"]
        if self.node_tests is not None:
            self.node_tests.cleanup_session(session_id)
        return {
            "session_id": session_id,
            "stage": stage,
            "view_generation": generation,
            "expires_at": datetime.datetime.fromtimestamp(
                now + self.session_seconds).isoformat(timespec="seconds"),
            "activity_generation": activity_generation,
        }

    def session_status(self, session_id, task_path):
        with self._guard:
            session = self._sessions.get(session_id)
            if session and os.path.realpath(task_path) == session.get("task_path"):
                result = {
                    "status": (
                        session["last_submission"].get("status", "submitted")
                        if session.get("last_submission") else "open"),
                    "session_id": session_id,
                    "activity_generation": int(
                        session.get("activity_generation") or 0),
                    "expires_at": datetime.datetime.fromtimestamp(
                        session["expires_at"]).isoformat(timespec="seconds"),
                }
                if session.get("last_submission"):
                    result.update(session["last_submission"])
                return result
        receipt_path = self._receipt_path(session_id)
        if os.path.isfile(receipt_path):
            receipt = util.load_json(receipt_path)
            if receipt.get("task_ref") == self.controller._ref(task_path):
                return receipt
        return {"status": "unknown_session", "session_id": session_id}

    # ------------------------------------------------------------------ request handlers

    def _handle_get(self, handler):
        if not self._valid_host(handler):
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "error", "reason_code": "invalid_host"})
        parsed = urlsplit(handler.path)
        pieces = [part for part in parsed.path.split("/") if part]
        is_state = (
            len(pieces) == 3
            and pieces[0] == "author"
            and pieces[2] == "state"
        )
        is_node_tests = (
            len(pieces) == 3
            and pieces[0] == "author"
            and pieces[2] == "node-tests"
        )
        if ((len(pieces) != 2 and not is_state and not is_node_tests)
                or pieces[0] != "author"):
            return self._json(handler, HTTPStatus.NOT_FOUND, {
                "status": "error", "reason_code": "not_found"})
        session_id = pieces[1]
        session = self._session(session_id)
        if session is None:
            return self._json(handler, HTTPStatus.GONE, {
                "status": "error", "reason_code": "expired_session"})
        token = (parse_qs(parsed.query).get("token") or [None])[0]
        if token is not None and not is_state and not is_node_tests:
            with self._guard:
                if session.get("token_used") or not secrets.compare_digest(
                        str(token), session["access_token"]):
                    return self._json(handler, HTTPStatus.GONE, {
                        "status": "error", "reason_code": "used_or_invalid_token"})
                session["token_used"] = True
            clean = f"/author/{session_id}"
            handler.send_response(HTTPStatus.SEE_OTHER)
            handler.send_header("Location", clean)
            handler.send_header(
                "Set-Cookie",
                f"ops_session={session_id}; HttpOnly; SameSite=Strict; "
                f"Path=/author/{session_id}")
            self._security_headers(handler)
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return
        if (
            not self.require_access_token
            and not is_state
            and not is_node_tests
            and not self._valid_cookie(handler, session_id)
        ):
            handler.send_response(HTTPStatus.SEE_OTHER)
            handler.send_header("Location", f"/author/{session_id}")
            handler.send_header(
                "Set-Cookie",
                f"ops_session={session_id}; HttpOnly; SameSite=Strict; "
                f"Path=/author/{session_id}")
            self._security_headers(handler)
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return
        if not session.get("token_used") or not self._valid_cookie(handler, session_id):
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "session_cookie_required"})
        if is_state:
            result = {
                "status": (
                    "ready"
                    if session.get("last_submission") is None
                    else "waiting"
                ),
                "stage": session.get("stage"),
                "processing": self._draft_processing_started(),
                "view_generation": int(
                    session.get("view_generation") or 0),
            }
            result.update(self._assistant_status())
            return self._json(handler, HTTPStatus.OK, result)
        if is_node_tests:
            if self.node_tests is None:
                return self._json(handler, HTTPStatus.NOT_FOUND, {
                    "status": "failed",
                    "reason_code": "node_test_unavailable",
                    "reason": "이 Creator 화면에서는 노드 테스트를 지원하지 않습니다",
                })
            query = parse_qs(parsed.query)
            node_id = (query.get("node_id") or [None])[0]
            test_id = (query.get("test_id") or [None])[0]
            try:
                result = self.node_tests.list_session(
                    session_id, node_id=node_id, test_id=test_id)
            except FileNotFoundError as exc:
                return self._json(handler, HTTPStatus.NOT_FOUND, {
                    "status": "failed",
                    "reason_code": "node_test_not_found",
                    "reason": str(exc),
                })
            except (ValueError, PermissionError, KeyError,
                    json.JSONDecodeError) as exc:
                return self._json(handler, HTTPStatus.BAD_REQUEST, {
                    "status": "invalid",
                    "reason_code": "invalid_node_test_request",
                    "reason": str(exc),
                })
            result = self._connect_node_test_assistant_status(result)
            return self._json(handler, HTTPStatus.OK, result)
        raw = session["html"].encode("utf-8")
        handler.send_response(HTTPStatus.OK)
        handler.send_header("Content-Type", "text/html; charset=utf-8")
        self._security_headers(handler)
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Content-Length", str(len(raw)))
        handler.end_headers()
        handler.wfile.write(raw)

    def _handle_post(self, handler):
        if not self._valid_host(handler):
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "error", "reason_code": "invalid_host"})
        if not self._valid_origin(handler):
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "invalid_origin"})
        parsed = urlsplit(handler.path)
        pieces = [part for part in parsed.path.split("/") if part]
        if (len(pieces) != 3 or pieces[0] != "author"
                or pieces[2] not in (
                    "submit", "activity", "node-test", "draft-generate"
                )):
            return self._json(handler, HTTPStatus.NOT_FOUND, {
                "status": "error", "reason_code": "not_found"})
        action = pieces[2]
        session_id = pieces[1]
        session = self._session(session_id)
        if session is None:
            return self._json(handler, HTTPStatus.GONE, {
                "status": "error", "reason_code": "expired_session"})
        if not self._valid_cookie(handler, session_id):
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "session_cookie_required"})
        supplied_csrf = handler.headers.get("X-Ops-CSRF") or ""
        if not secrets.compare_digest(supplied_csrf, session["csrf"]):
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error", "reason_code": "csrf_failed"})
        if action == "activity":
            return self._record_activity(handler, session_id, session)
        if action == "draft-generate":
            if self.draft_generation_handler is None:
                return self._json(handler, HTTPStatus.NOT_FOUND, {
                    "status": "error",
                    "reason_code": "draft_generation_unavailable",
                })
            try:
                length = int(handler.headers.get("Content-Length") or "0")
                if length < 0 or length > _MAX_BODY:
                    return self._json(
                        handler, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                            "status": "invalid",
                            "reason_code": "invalid_body_size",
                        })
                if length:
                    content_type = (
                        handler.headers.get("Content-Type") or ""
                    ).split(";", 1)[0].strip()
                    if content_type != "application/json":
                        return self._json(
                            handler, HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {
                                "status": "invalid",
                                "reason_code": "json_required",
                            })
                    payload = json.loads(
                        handler.rfile.read(length).decode("utf-8"))
                    result = self.draft_generation_handler(payload)
                else:
                    # 이전 전체 갱신 호출자의 무본문 요청도 계속 허용한다.
                    result = self.draft_generation_handler()
            except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
                return self._json(handler, HTTPStatus.BAD_REQUEST, {
                    "status": "invalid",
                    "reason_code": "draft_generation_failed",
                    "reason": str(exc),
                })
            status = (
                HTTPStatus.OK
                if result.get("status") == "ok"
                else HTTPStatus.CONFLICT
            )
            return self._json(handler, status, result)
        try:
            length = int(handler.headers.get("Content-Length") or "0")
        except ValueError:
            length = -1
        if length < 1 or length > _MAX_BODY:
            return self._json(handler, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                "status": "invalid", "reason_code": "invalid_body_size"})
        content_type = (handler.headers.get("Content-Type") or "").split(";", 1)[0].strip()
        if content_type != "application/json":
            return self._json(handler, HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {
                "status": "invalid", "reason_code": "json_required"})
        try:
            payload = json.loads(handler.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "invalid", "reason_code": "invalid_json"})
        if not isinstance(payload, dict):
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "invalid", "reason_code": "json_object_required"})
        if action == "node-test":
            return self._handle_node_test(
                handler, session_id, session, payload)
        submission_digest = self.controller._digest(payload)[:24]
        with self._guard:
            cached = (
                session.get("successful_submissions") or {}
            ).get(submission_digest)
        if cached is not None:
            return self._json(handler, HTTPStatus.OK, dict(cached))
        result = self.controller.apply_author_submission(
            session["task_ref"], payload, session["revision"],
            idempotency_key=f"author-ui-{session_id}-{submission_digest}",
            author_intent=session.get("intent", "author"),
            author_phase=session.get("phase"))
        custom_requests = [
            item for item in (result.get("remaining") or [])
            if isinstance(item, dict) and item.get("action") == "custom_logic"
        ]
        if (
            result.get("status") == "ok"
            and custom_requests
            and self.custom_logic_queue_handler is not None
        ):
            try:
                queued = self.custom_logic_queue_handler(
                    session["task_ref"], custom_requests,
                    result.get("revision"))
            except (OSError, ValueError, PermissionError, KeyError) as exc:
                result = {
                    **result,
                    "status": "conflict",
                    "reason_code": "custom_logic_queue_failed",
                    "reason": str(exc),
                }
            else:
                if queued.get("status") == "ok" and queued.get("job_count"):
                    result = {
                        **result,
                        "next_stage": "awaiting_agent_custom_logic",
                        "custom_logic_job_count": queued.get("job_count"),
                    }
        if (
            result.get("status") == "ok"
            and session.get("intent") == "revise"
            and session.get("phase") == "design"
            and payload.get("type") == "ops_design_commit"
        ):
            # 정본은 여전히 ready_to_validate일 수 있지만 수정 세션은 기존
            # 상세 설정 질문지를 한 번 거친 뒤에만 완료한다.
            result = dict(result)
            result["next_stage"] = "questionnaire"
        if (
            result.get("status") == "ok"
            and result.get("next_stage") == "ready_to_validate"
        ):
            result = dict(result)
            result["validation"] = self.controller.task_validate(
                session["task_ref"], rehearsal=True)
        if result.get("status") == "ok":
            with self._guard:
                current = self._sessions.get(session_id)
                if current is session:
                    current.setdefault(
                        "successful_submissions", {}
                    )[submission_digest] = dict(result)
        submitted_at = datetime.datetime.now().isoformat(timespec="seconds")
        receipt = {
            "status": "submitted" if result.get("status") == "ok" else result.get("status"),
            "session_id": session_id,
            "task_ref": session["task_ref"],
            "submitted_at": submitted_at,
            "last_submission": {
                "status": result.get("status"),
                "next_stage": result.get("next_stage"),
                "revision": result.get("revision"),
                "reason_code": result.get("reason_code"),
                "reason": result.get("reason"),
                "validation": result.get("validation"),
                "custom_logic_job_count": result.get("custom_logic_job_count"),
            },
        }
        with self._guard:
            session["last_submission"] = {
                "status": receipt["status"],
                "submitted_at": submitted_at,
                "last_submission": receipt["last_submission"],
            }
        # 제출 payload는 저장하지 않고 결과 메타데이터만 복구용으로 남긴다.
        util.atomic_write_json(self._receipt_path(session_id), receipt)
        code = HTTPStatus.OK
        if result.get("status") == "conflict":
            code = HTTPStatus.CONFLICT
        elif result.get("status") == "invalid":
            code = HTTPStatus.BAD_REQUEST
        elif result.get("status") == "busy":
            code = HTTPStatus.LOCKED
        elif result.get("status") == "error":
            code = HTTPStatus.INTERNAL_SERVER_ERROR
        return self._json(handler, code, result)

    def _handle_node_test(self, handler, session_id, session, payload):
        if self.node_tests is None:
            return self._json(handler, HTTPStatus.NOT_FOUND, {
                "status": "failed",
                "reason_code": "node_test_unavailable",
                "reason": "이 Creator 화면에서는 노드 테스트를 지원하지 않습니다",
            })
        action = payload.get("action") or "prepare"
        try:
            if action == "prepare":
                result = self.node_tests.prepare(
                    session_id,
                    session["task_ref"],
                    payload.get("node_id"),
                    payload,
                    session["revision"],
                    revision_questionnaire=(
                        session.get("phase") == "revision_questionnaire"),
                )
            elif action == "start":
                result = self.node_tests.start(
                    session_id,
                    payload.get("test_id"),
                    values=payload.get("values") or {},
                    system=payload.get("system"),
                )
            elif action == "user_submit":
                result = self.node_tests.submit_user(
                    session_id,
                    payload.get("test_id"),
                    payload.get("result"),
                    expected_revision=payload.get("expected_revision"),
                    job_id=payload.get("job_id"),
                )
            elif action == "cancel":
                result = self.node_tests.cancel(
                    session_id,
                    payload.get("test_id"),
                    deferred=bool(payload.get("deferred")),
                )
            else:
                result = {
                    "status": "invalid",
                    "reason_code": "unknown_node_test_action",
                    "reason": f"지원하지 않는 노드 테스트 action입니다: {action}",
                }
        except FileNotFoundError as exc:
            return self._json(handler, HTTPStatus.NOT_FOUND, {
                "status": "failed",
                "reason_code": "node_test_not_found",
                "reason": str(exc),
            })
        except (ValueError, PermissionError, KeyError,
                json.JSONDecodeError) as exc:
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "invalid",
                "reason_code": "invalid_node_test_request",
                "reason": str(exc),
            })
        result = self._connect_node_test_assistant_status(result)
        code = HTTPStatus.OK
        if result.get("status") == "invalid":
            code = HTTPStatus.BAD_REQUEST
        elif result.get("status") == "conflict":
            code = HTTPStatus.CONFLICT
        elif result.get("status") == "busy":
            code = HTTPStatus.LOCKED
        elif result.get("status") == "error":
            code = HTTPStatus.INTERNAL_SERVER_ERROR
        return self._json(handler, code, result)

    def _record_activity(self, handler, session_id, session):
        """브라우저가 활동 신호를 명시적으로 보낸 경우에만 Creator 세션을 연장한다."""
        now = time.time()
        with self._guard:
            current = self._sessions.get(session_id)
            if current is not session:
                return self._json(handler, HTTPStatus.GONE, {
                    "status": "error", "reason_code": "expired_session"})
            current["last_activity_at"] = now
            # 해상도가 낮거나 고정된 시계에서도 명시적인 사용자 활동은 기존
            # 만료 시각을 반드시 연장해야 한다.
            current["expires_at"] = max(
                now + self.session_seconds,
                float(current.get("expires_at") or 0) + 0.000001,
            )
            current["activity_generation"] = (
                int(current.get("activity_generation") or 0) + 1)
            generation = current["activity_generation"]
            expires_at = current["expires_at"]
        return self._json(handler, HTTPStatus.OK, {
            "status": "ok",
            "session_id": session_id,
            "activity_generation": generation,
            "expires_at": datetime.datetime.fromtimestamp(
                expires_at).isoformat(timespec="seconds"),
        })

    # ------------------------------------------------------------------ validation/render

    def _session(self, session_id):
        with self._guard:
            session = self._sessions.get(session_id)
            if not session:
                return None
            if session.get("expires_at", 0) < time.time():
                self._sessions.pop(session_id, None)
                return None
            return session

    def _prune(self):
        now = time.time()
        stale = [key for key, value in self._sessions.items()
                 if value.get("expires_at", 0) < now]
        for key in stale:
            self._sessions.pop(key, None)

    def _valid_host(self, handler):
        port = self._server.server_address[1]
        return loopback_http.valid_host(handler, port)

    def _valid_origin(self, handler):
        origin = (handler.headers.get("Origin") or "").lower().rstrip("/")
        port = self._server.server_address[1]
        return origin in {
            f"http://127.0.0.1:{port}", f"http://localhost:{port}",
        }

    @staticmethod
    def _valid_cookie(handler, session_id):
        values = {}
        for item in (handler.headers.get("Cookie") or "").split(";"):
            if "=" in item:
                key, value = item.strip().split("=", 1)
                values[key] = value
        supplied = values.get("ops_session") or ""
        return secrets.compare_digest(supplied, session_id)

    def _receipt_path(self, session_id):
        safe = "".join(ch for ch in str(session_id) if ch.isalnum() or ch in "-_")
        return os.path.join(self.receipt_dir, safe + ".json")

    @staticmethod
    def _ready_html(task):
        name = str(task.get("task_name") or task.get("task_id") or "")
        safe = (name.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))
        return (
            "<!doctype html><html lang='ko'><head><meta charset='utf-8'>"
            f"<title>{safe}</title></head><body><main><h1>{safe}</h1>"
            "<p>저작 입력이 모두 반영되었습니다. 이 창을 닫아도 됩니다.</p>"
            "</main></body></html>")

    @staticmethod
    def _security_headers(handler):
        loopback_http.security_headers(
            handler,
            content_security_policy=loopback_http.CONNECTED_CSP,
        )

    @classmethod
    def _json(cls, handler, status, value):
        loopback_http.json_response(
            handler,
            status,
            value,
            content_security_policy=loopback_http.CONNECTED_CSP,
        )
