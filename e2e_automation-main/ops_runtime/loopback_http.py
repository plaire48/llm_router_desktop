# -*- coding: utf-8 -*-
"""프로젝트 로컬 HTTP 서버가 공유하는 주소 검사, 보안 헤더와 JSON 응답 함수."""
from __future__ import annotations

import json


CONNECTED_CSP = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; "
    "base-uri 'none'"
)
RUNNER_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
DASHBOARD_HTML_CSP = (
    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)


def valid_host(handler, port):
    host = (handler.headers.get("Host") or "").lower()
    return host in {f"127.0.0.1:{port}", f"localhost:{port}"}


def security_headers(handler, *, content_security_policy=None):
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("X-Frame-Options", "DENY")
    if content_security_policy:
        handler.send_header(
            "Content-Security-Policy", content_security_policy)


def json_response(handler, status, value, *, content_security_policy=None):
    raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
    handler.send_response(int(status))
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    security_headers(
        handler, content_security_policy=content_security_policy)
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)
