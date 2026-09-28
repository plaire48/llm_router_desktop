# -*- coding: utf-8 -*-
"""프로젝트 로컬 Runner가 사용하는 내부 JSON API."""
from __future__ import annotations

from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import threading
import time
from urllib.parse import urlsplit

from . import loopback_http


_MAX_BODY = 2 * 1024 * 1024


class RunnerHTTP:
    """Controller의 Runner 메서드만 127.0.0.1에 노출한다.

    브라우저용 API가 아니다. 같은 프로젝트의 ``runner_app`` CLI만 임의 bearer
    token으로 호출하며, 모든 실행 요청은 다음 실제 경계가 나올 때까지 동기로
    Controller를 기다린다.
    """

    def __init__(self, controller, control_token, server_id):
        if not isinstance(control_token, str) or len(control_token) < 32:
            raise ValueError("Runner control token이 너무 짧습니다")
        if not isinstance(server_id, str) or len(server_id) < 16:
            raise ValueError("Runner server_id가 올바르지 않습니다")
        self.controller = controller
        self.control_token = control_token
        self.server_id = server_id
        self._server = None
        self._thread = None
        self.base_url = None
        self._guard = threading.RLock()
        self._last_activity = time.monotonic()
        self._active_commands = 0
        self._accepting = True

    @property
    def last_activity(self):
        with self._guard:
            return self._last_activity

    @property
    def active_commands(self):
        with self._guard:
            return self._active_commands

    def begin_shutdown(self):
        """새 요청을 막고 현재 처리 중인 응답 수를 반환한다."""
        with self._guard:
            self._accepting = False
            return self._active_commands

    def start(self):
        if self._server is not None:
            return self
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "ops-standalone-runner"
            sys_version = ""

            def do_POST(self):
                bridge._handle_post(self)

            def do_GET(self):
                bridge._json(self, HTTPStatus.METHOD_NOT_ALLOWED, {
                    "status": "error",
                    "reason_code": "post_required",
                })

            def log_message(self, _format, *_args):
                # 업무 입력과 bearer token이 접근 로그에 남지 않게 한다.
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        port = self._server.server_address[1]
        self.base_url = f"http://127.0.0.1:{port}"
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="ops-standalone-runner",
            daemon=True,
        )
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

    def _handle_post(self, handler):
        if not self._valid_host(handler):
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "error",
                "reason_code": "invalid_host",
            })
        # 이 API는 browser fetch 대상이 아니다. Origin이 붙은 요청을 모두 막아
        # 사용자가 방문한 웹 페이지가 loopback Runner를 조작하지 못하게 한다.
        if handler.headers.get("Origin") is not None:
            return self._json(handler, HTTPStatus.FORBIDDEN, {
                "status": "error",
                "reason_code": "browser_origin_forbidden",
            })
        supplied = handler.headers.get("Authorization") or ""
        expected = "Bearer " + self.control_token
        if not secrets.compare_digest(supplied, expected):
            return self._json(handler, HTTPStatus.UNAUTHORIZED, {
                "status": "error",
                "reason_code": "invalid_control_token",
            })
        parsed = urlsplit(handler.path)
        if parsed.path != "/v1/command" or parsed.query or parsed.fragment:
            return self._json(handler, HTTPStatus.NOT_FOUND, {
                "status": "error",
                "reason_code": "not_found",
            })
        content_type = (
            handler.headers.get("Content-Type") or ""
        ).split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return self._json(handler, HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {
                "status": "invalid",
                "reason_code": "json_required",
            })
        try:
            length = int(handler.headers.get("Content-Length") or "0")
        except ValueError:
            length = -1
        if length < 2 or length > _MAX_BODY:
            return self._json(handler, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                "status": "invalid",
                "reason_code": "invalid_body_size",
            })
        try:
            payload = json.loads(handler.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "invalid",
                "reason_code": "invalid_json",
            })
        if not isinstance(payload, dict):
            return self._json(handler, HTTPStatus.BAD_REQUEST, {
                "status": "invalid",
                "reason_code": "json_object_required",
            })
        action = payload.get("action")
        updates_idle = action != "health"
        with self._guard:
            draining = not self._accepting
            if not draining:
                # health를 포함해 응답 쓰기가 끝날 때까지 활성 요청으로 센다.
                # health만 유휴 시간을 연장하지 않는다.
                self._active_commands += 1
                if updates_idle:
                    self._last_activity = time.monotonic()
        if draining:
            return self._json(handler, HTTPStatus.SERVICE_UNAVAILABLE, {
                "status": "busy",
                "reason_code": "runner_draining",
                "reason": "Runner 서버가 처리 중인 요청을 마친 뒤 종료 중입니다",
                "retryable": True,
            })
        try:
            try:
                result = self._dispatch(payload)
            except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                result = {
                    "status": "error",
                    "reason_code": "runner_command_failed",
                    "reason": str(exc),
                }
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
        finally:
            with self._guard:
                self._active_commands -= 1
                if updates_idle:
                    self._last_activity = time.monotonic()

    def _dispatch(self, payload):
        action = payload.get("action")
        if action == "health":
            return {
                "status": "ok",
                "mode": "standalone_local_runner",
                "server_id": self.server_id,
                "project_root": self.controller.project_root,
                "compat": {
                    "task_schema": ["2.0", "2.1", "2.2"],
                    "existing_ops_runs": True,
                    "legacy_engine_cli": True,
                },
            }
        if action == "run_list":
            result = self.controller.run_list(payload.get("task_ref"))
        elif action == "run_start":
            result = self.controller.run_start(
                payload.get("task_ref"),
                payload.get("key"),
                expected_task_fingerprint=payload.get(
                    "expected_task_fingerprint"),
                idempotency_key=payload.get("idempotency_key"),
            )
        elif action == "run_status":
            result = self.controller.run_status(payload.get("run_ref"))
        elif action == "run_next":
            result = self.controller.run_next(
                payload.get("run_ref"),
                expected_revision=payload.get("expected_revision"),
                idempotency_key=payload.get("idempotency_key"),
            )
        elif action == "run_complete_agent_job":
            result = self.controller.run_complete_agent_job(
                payload.get("run_ref"),
                payload.get("job_id"),
                payload.get("revision"),
                payload.get("idempotency_key"),
                payload.get("result"),
                defer_pump=bool(payload.get("defer_pump")),
            )
        elif action == "run_complete_human_job":
            result = self.controller.run_complete_human_job(
                payload.get("run_ref"),
                payload.get("job_id"),
                payload.get("revision"),
                payload.get("idempotency_key"),
                payload.get("result"),
                defer_pump=bool(payload.get("defer_pump")),
            )
        elif action == "run_open_url":
            result = self.controller.run_open_url(
                payload.get("run_ref"),
                payload.get("job_id"),
                payload.get("revision"),
                payload.get("idempotency_key"),
                delay=payload.get("delay", 2),
            )
        else:
            return {
                "status": "invalid",
                "reason_code": "unknown_runner_action",
                "reason": f"지원하지 않는 Runner action입니다: {action}",
            }
        return result if isinstance(result, dict) else {
            "status": "error",
            "reason_code": "runner_protocol_error",
            "reason": "Controller 응답이 JSON 객체가 아닙니다",
        }

    def _valid_host(self, handler):
        port = self._server.server_address[1]
        return loopback_http.valid_host(handler, port)

    @staticmethod
    def _security_headers(handler):
        loopback_http.security_headers(
            handler,
            content_security_policy=loopback_http.RUNNER_CSP,
        )
        handler.send_header("Cache-Control", "no-store")

    @classmethod
    def _json(cls, handler, status, value):
        loopback_http.json_response(
            handler,
            status,
            value,
            content_security_policy=loopback_http.RUNNER_CSP,
        )
